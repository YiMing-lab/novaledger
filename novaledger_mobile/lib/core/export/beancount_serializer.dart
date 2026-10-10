import 'dart:io';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../database/database_helper.dart';

class BeancountSerializer {
  /// 将本地 SQLite 数据库完整序列化为标准 Beancount 纯文本账本并调用原生分享
  static Future<File> exportAndShare() async {
    final beancountContent = await generateBeancountString();

    final tempDir = await getTemporaryDirectory();
    final dateStr = DateFormat('yyyyMMdd_HHmmss').format(DateTime.now());
    final exportFile = File('${tempDir.path}/NovaLedger_Export_$dateStr.bean');
    await exportFile.writeAsString(beancountContent, encoding: const Utf8Codec());

    // 调起系统原生分享面板 (微信、QQ、网盘、保存到文件)
    await Share.shareXFiles(
      [XFile(exportFile.path)],
      text: '星芒账本 (NovaLedger) Beancount 纯文本导出账本',
      subject: 'NovaLedger_Export_$dateStr.bean',
    );

    return exportFile;
  }

  /// 生成 Beancount 语法的纯文本内容
  static Future<String> generateBeancountString() async {
    final dbHelper = DatabaseHelper.instance;
    final accounts = await dbHelper.getAccounts(includeArchived: true);
    final debts = await dbHelper.getDebts();
    final transactions = await dbHelper.getTransactions(limit: 100000);

    final sb = StringBuffer();
    sb.writeln('; -*- mode: beancount -*-');
    sb.writeln('; 由 星芒账本 · NovaLedger 独立安卓端生成');
    sb.writeln('; 导出时间: ${DateFormat("yyyy-MM-dd HH:mm:ss").format(DateTime.now())}\n');
    sb.writeln('option "title" "星芒账本 · NovaLedger"');
    sb.writeln('option "operating_currency" "CNY"\n');

    // 1. 账户开户 (Accounts)
    sb.writeln('; ========================================================');
    sb.writeln('; 一、账户开户声明 (Account Declarations)');
    sb.writeln('; ========================================================');
    for (final acc in accounts) {
      if (acc.beancountAccount.isNotEmpty) {
        sb.writeln('2020-01-01 open ${acc.beancountAccount} CNY');
      }
    }

    // 负债账户开户
    for (final debt in debts) {
      if (debt.beancountAccount.isNotEmpty &&
          !accounts.any((a) => a.beancountAccount == debt.beancountAccount)) {
        sb.writeln('2020-01-01 open ${debt.beancountAccount} CNY');
      }
    }
    sb.writeln('2020-01-01 open Equity:Opening-Balances CNY');
    sb.writeln('');

    // 2. 交易流水 (Transactions) - 按日期升序排列
    sb.writeln('; ========================================================');
    sb.writeln('; 二、复式记账交易流水 (Transactions)');
    sb.writeln('; ========================================================');

    final sortedTxs = List.of(transactions)..sort((a, b) => a.date.compareTo(b.date));

    for (final tx in sortedTxs) {
      final payeeStr = tx.payee.replaceAll('"', '\\"');
      final narrStr = tx.narration.replaceAll('"', '\\"');
      sb.writeln('${tx.date} * "$payeeStr" "$narrStr"');
      sb.writeln('  id: "${tx.id}"');
      if (tx.sourceType.isNotEmpty) {
        sb.writeln('  source_type: "${tx.sourceType}"');
      }
      if (tx.isOffset) {
        sb.writeln('  is_offset: "true"');
      }

      for (final p in tx.postings) {
        final amountStr = p.amount.toStringAsFixed(2);
        // 对齐格式：科目占宽至少 36
        final paddedAccount = p.account.padRight(36);
        final paddedAmount = amountStr.padLeft(12);
        sb.writeln('  $paddedAccount $paddedAmount ${p.currency}');
      }
      sb.writeln('');
    }

    return sb.toString();
  }
}
