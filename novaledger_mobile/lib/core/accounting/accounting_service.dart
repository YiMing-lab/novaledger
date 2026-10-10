import 'package:intl/intl.dart';
import 'package:uuid/uuid.dart';
import '../database/database_helper.dart';
import '../models/posting.dart';
import '../models/transaction_item.dart';

class AccountingService {
  static const _uuid = Uuid();

  /// 记录日常支出 (支持 Scheme B 消费退款红字冲减)
  static Future<bool> recordExpense({
    required DateTime date,
    required String payee,
    required String narration,
    required double amount,
    required String categoryAccount, // e.g. Expenses:Food:Dining
    required String sourceAccount,   // e.g. Assets:Bank:CMB:Card8225
    bool isOffset = false,           // 是否为消费退款 (冲减原支出)
  }) async {
    final txId = 'nl_tx_${_uuid.v4().replaceAll("-", "").substring(0, 16)}';
    final dateStr = DateFormat('yyyy-MM-dd').format(date);
    final nowIso = DateTime.now().toIso8601String();

    final tx = TransactionItem(
      id: txId,
      date: dateStr,
      payee: payee,
      narration: narration,
      sourceType: 'manual',
      isOffset: isOffset,
      createdAt: nowIso,
    );

    List<Posting> postings;
    if (isOffset) {
      // Scheme B 退款红字冲减：资金退回入账借记增加 (+)，原分类费用科目贷记冲减 (-)
      postings = [
        Posting(transactionId: txId, account: sourceAccount, amount: amount),
        Posting(transactionId: txId, account: categoryAccount, amount: -amount),
      ];
    } else {
      // 常规支出：费用科目借记增加 (+)，出资账户贷记减少 (-)
      postings = [
        Posting(transactionId: txId, account: categoryAccount, amount: amount),
        Posting(transactionId: txId, account: sourceAccount, amount: -amount),
      ];
    }

    return await DatabaseHelper.instance.insertTransaction(tx, postings);
  }

  /// 记录日常收入
  static Future<bool> recordIncome({
    required DateTime date,
    required String payee,
    required String narration,
    required double amount,
    required String categoryAccount, // e.g. Income:Salary
    required String targetAccount,   // e.g. Assets:Bank:CMB:Card8225
  }) async {
    final txId = 'nl_tx_${_uuid.v4().replaceAll("-", "").substring(0, 16)}';
    final dateStr = DateFormat('yyyy-MM-dd').format(date);
    final nowIso = DateTime.now().toIso8601String();

    final tx = TransactionItem(
      id: txId,
      date: dateStr,
      payee: payee,
      narration: narration,
      sourceType: 'manual',
      createdAt: nowIso,
    );

    // 复式借贷分录：入账账户借记增加 (+)，收入科目贷记 (-)
    final postings = [
      Posting(transactionId: txId, account: targetAccount, amount: amount),
      Posting(transactionId: txId, account: categoryAccount, amount: -amount),
    ];

    return await DatabaseHelper.instance.insertTransaction(tx, postings);
  }

  /// 记录转账 (卡互转 / 信用卡还款 / 贷款核销三合一)
  static Future<bool> recordTransfer({
    required DateTime date,
    required String narration,
    required double amount,
    required String fromAccount,
    required String toAccount,
  }) async {
    final txId = 'nl_tx_${_uuid.v4().replaceAll("-", "").substring(0, 16)}';
    final dateStr = DateFormat('yyyy-MM-dd').format(date);
    final nowIso = DateTime.now().toIso8601String();

    final isDebtRepayment = toAccount.startsWith('Liabilities:Loan:');
    final isCreditCardRepay = toAccount.startsWith('Liabilities:CreditCard:');

    String defaultPayee = '内部转账';
    if (isDebtRepayment) {
      defaultPayee = '归还贷款本金';
    } else if (isCreditCardRepay) {
      defaultPayee = '信用卡还款';
    }

    final tx = TransactionItem(
      id: txId,
      date: dateStr,
      payee: defaultPayee,
      narration: narration.isNotEmpty ? narration : '从 $fromAccount 转入 $toAccount',
      sourceType: 'manual',
      createdAt: nowIso,
    );

    // 转入方借记 (+)，出资方贷记 (-)
    final postings = [
      Posting(transactionId: txId, account: toAccount, amount: amount),
      Posting(transactionId: txId, account: fromAccount, amount: -amount),
    ];

    final ok = await DatabaseHelper.instance.insertTransaction(tx, postings);

    // 若归还贷款，自动递减对应债务的未还本金
    if (ok && isDebtRepayment) {
      await DatabaseHelper.instance.reduceDebtRemaining(toAccount, amount);
    }

    return ok;
  }
}
