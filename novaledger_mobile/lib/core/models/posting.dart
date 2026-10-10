class Posting {
  final int? id;
  final String transactionId;
  final String account;
  final double amount; // 正数为借(借方增加)，负数为贷(贷方减少)
  final String currency;

  Posting({
    this.id,
    required this.transactionId,
    required this.account,
    required this.amount,
    this.currency = 'CNY',
  });

  factory Posting.fromMap(Map<String, dynamic> map) {
    return Posting(
      id: map['id'],
      transactionId: map['transaction_id'] ?? '',
      account: map['account'] ?? '',
      amount: (map['amount'] as num?)?.toDouble() ?? 0.0,
      currency: map['currency'] ?? 'CNY',
    );
  }

  Map<String, dynamic> toMap() {
    return {
      if (id != null) 'id': id,
      'transaction_id': transactionId,
      'account': account,
      'amount': amount,
      'currency': currency,
    };
  }
}
