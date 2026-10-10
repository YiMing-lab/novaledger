import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:csv/csv.dart';
import '../models/posting.dart';
import '../models/transaction_item.dart';

class ParsedBillItem {
  final TransactionItem transaction;
  final List<Posting> postings;
  final String sourceChannel; // wechat or alipay

  ParsedBillItem({
    required this.transaction,
    required this.postings,
    required this.sourceChannel,
  });
}

class CsvBillParser {
  /// 解析微信或支付宝导出的 CSV 账单
  static Future<List<ParsedBillItem>> parseCsvFile(File file, {
    required String defaultAssetAccount, // 对应绑定的资产账户 (如 Assets:EWallet:WeChat 或 Assets:EWallet:Alipay)
  }) async {
    final bytes = await file.readAsBytes();
    String content = '';
    try {
      content = utf8.decode(bytes);
    } catch (_) {
      // 若非 utf8，尝试 gbk/utf-16
      content = latin1.decode(bytes);
    }

    final rows = const CsvToListConverter(eol: '\n', shouldParseNumbers: false).convert(content);
    if (rows.isEmpty) return [];

    final isWeChat = content.contains('微信支付账单明细') || content.contains('交易单号');
    final isAlipay = content.contains('支付宝交易记录明细') || content.contains('支付宝交易号');

    final List<ParsedBillItem> result = [];

    int headerIndex = -1;
    for (int i = 0; i < rows.length; i++) {
      final lineStr = rows[i].join(',');
      if (lineStr.contains('交易时间') && (lineStr.contains('金额') || lineStr.contains('金额(元)'))) {
        headerIndex = i;
        break;
      }
    }

    if (headerIndex == -1) return [];

    final headers = rows[headerIndex].map((e) => e.toString().trim()).toList();
    final timeIdx = headers.indexOf('交易时间');
    final payeeIdx = headers.indexWhere((h) => h.contains('交易对方') || h.contains('交易对方名称'));
    final descIdx = headers.indexWhere((h) => h.contains('商品') || h.contains('商品名称') || h.contains('商品说明'));
    final typeIdx = headers.indexWhere((h) => h.contains('收/支') || h.contains('收支'));
    final amtIdx = headers.indexWhere((h) => h.contains('金额') || h.contains('金额(元)'));
    final txIdIdx = headers.indexWhere((h) => h.contains('交易单号') || h.contains('支付宝交易号') || h.contains('交易号'));

    for (int i = headerIndex + 1; i < rows.length; i++) {
      final row = rows[i];
      if (row.length <= timeIdx || row.length <= amtIdx) continue;

      final timeStr = row[timeIdx].toString().trim();
      if (timeStr.isEmpty || timeStr.startsWith('------')) continue;

      final dateStr = timeStr.length >= 10 ? timeStr.substring(0, 10) : timeStr;
      final payeeStr = payeeIdx != -1 && row.length > payeeIdx ? row[payeeIdx].toString().trim() : '微信/支付宝商户';
      final descStr = descIdx != -1 && row.length > descIdx ? row[descIdx].toString().trim() : '';
      final inOut = typeIdx != -1 && row.length > typeIdx ? row[typeIdx].toString().trim() : '支出';
      final amtRaw = row[amtIdx].toString().replaceAll('¥', '').replaceAll(',', '').trim();
      final amount = double.tryParse(amtRaw) ?? 0.0;
      final sourceTxId = txIdIdx != -1 && row.length > txIdIdx ? row[txIdIdx].toString().trim() : '';

      if (amount <= 0) continue;

      final fingerprint = md5.convert(utf8.encode('$dateStr|$payeeStr|$descStr|$amount|$sourceTxId')).toString();
      final txId = 'nl_imp_${fingerprint.substring(0, 16)}';

      final List<Posting> postings = [];
      if (inOut.contains('收') || inOut == '收入') {
        // 收入：资产借记增加 (+)，收入贷记 (-)
        postings.add(Posting(transactionId: txId, account: defaultAssetAccount, amount: amount));
        postings.add(Posting(transactionId: txId, account: 'Income:Other', amount: -amount));
      } else {
        // 支出：费用借记增加 (+)，资产贷记减少 (-)
        postings.add(Posting(transactionId: txId, account: 'Expenses:Other:General', amount: amount));
        postings.add(Posting(transactionId: txId, account: defaultAssetAccount, amount: -amount));
      }

      final tx = TransactionItem(
        id: txId,
        date: dateStr,
        payee: payeeStr,
        narration: descStr,
        sourceType: isWeChat ? 'wechat_csv' : (isAlipay ? 'alipay_csv' : 'generic_csv'),
        sourceTxId: sourceTxId,
        sourceFingerprint: fingerprint,
        createdAt: DateTime.now().toIso8601String(),
      );

      result.add(ParsedBillItem(
        transaction: tx,
        postings: postings,
        sourceChannel: isWeChat ? 'wechat' : 'alipay',
      ));
    }

    return result;
  }
}
