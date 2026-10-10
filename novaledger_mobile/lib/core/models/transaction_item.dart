import 'posting.dart';

class TransactionItem {
  final String id;
  final String date; // YYYY-MM-DD
  final String payee;
  final String narration;
  final String status; // cleared, pending
  final String sourceType; // manual, wechat_csv, alipay_csv, migration, bank_email
  final String? sourceTxId;
  final String? sourceFingerprint;
  final String? importBatch;
  final bool isOffset; // Scheme B 消费退款/红字冲销标志
  final bool isNew; // 新导入未查看标志 (小蓝点)
  final String createdAt;
  final List<Posting> postings;

  TransactionItem({
    required this.id,
    required this.date,
    this.payee = '',
    this.narration = '',
    this.status = 'cleared',
    this.sourceType = 'manual',
    this.sourceTxId,
    this.sourceFingerprint,
    this.importBatch,
    this.isOffset = false,
    this.isNew = false,
    required this.createdAt,
    this.postings = const [],
  });

  /// 校验交易借贷是否严格平衡 (代数和为 0)
  bool get isBalanced {
    if (postings.isEmpty) return false;
    final sum = postings.fold<double>(0.0, (acc, p) => acc + p.amount);
    return sum.abs() < 0.005;
  }

  /// 获取主要金额（通常取支出的正值或主要资金变动金额）
  double get primaryAmount {
    if (postings.isEmpty) return 0.0;
    for (final p in postings) {
      if (p.account.startsWith('Expenses:')) {
        return p.amount.abs();
      } else if (p.account.startsWith('Income:')) {
        return p.amount.abs();
      }
    }
    return postings.first.amount.abs();
  }

  /// 获取主要分类或对方科目
  String get primaryCategory {
    for (final p in postings) {
      if (p.account.startsWith('Expenses:') || p.account.startsWith('Income:')) {
        return p.account;
      }
    }
    return postings.isNotEmpty ? postings.first.account : '';
  }

  /// 获取主要资金账户
  String get primaryAccount {
    for (final p in postings) {
      if (p.account.startsWith('Assets:') || p.account.startsWith('Liabilities:')) {
        return p.account;
      }
    }
    return postings.length > 1 ? postings[1].account : '';
  }

  factory TransactionItem.fromMap(Map<String, dynamic> map, {List<Posting>? postings}) {
    return TransactionItem(
      id: map['id'] ?? '',
      date: map['date'] ?? '',
      payee: map['payee'] ?? '',
      narration: map['narration'] ?? '',
      status: map['status'] ?? 'cleared',
      sourceType: map['source_type'] ?? 'manual',
      sourceTxId: map['source_tx_id'],
      sourceFingerprint: map['source_fingerprint'],
      importBatch: map['import_batch'],
      isOffset: (map['is_offset'] is int)
          ? map['is_offset'] == 1
          : (map['is_offset'] as bool? ?? false),
      isNew: (map['is_new'] is int)
          ? map['is_new'] == 1
          : (map['is_new'] as bool? ?? false),
      createdAt: map['created_at'] ?? '',
      postings: postings ?? [],
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'date': date,
      'payee': payee,
      'narration': narration,
      'status': status,
      'source_type': sourceType,
      'source_tx_id': sourceTxId,
      'source_fingerprint': sourceFingerprint,
      'import_batch': importBatch,
      'is_offset': isOffset ? 1 : 0,
      'is_new': isNew ? 1 : 0,
      'created_at': createdAt,
    };
  }
}
