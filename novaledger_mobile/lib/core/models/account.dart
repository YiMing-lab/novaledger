class Account {
  final String id;
  final String name;
  final String type; // debit, credit, e_wallet, invest, cash
  final String beancountAccount; // e.g. Assets:Bank:CMB:Card8225
  final String cardTail;
  final double initialBalance;
  final double currentBalance;
  final bool isArchived;

  Account({
    required this.id,
    required this.name,
    required this.type,
    required this.beancountAccount,
    this.cardTail = '',
    this.initialBalance = 0.0,
    this.currentBalance = 0.0,
    this.isArchived = false,
  });

  factory Account.fromMap(Map<String, dynamic> map) {
    return Account(
      id: map['id'] ?? '',
      name: map['name'] ?? '',
      type: map['type'] ?? 'debit',
      beancountAccount: map['beancount_account'] ?? map['account'] ?? '',
      cardTail: map['card_tail'] ?? '',
      initialBalance: (map['initial_balance'] as num?)?.toDouble() ?? 0.0,
      currentBalance: (map['current_balance'] as num?)?.toDouble() ?? 0.0,
      isArchived: (map['is_archived'] is int)
          ? map['is_archived'] == 1
          : (map['is_archived'] as bool? ?? false),
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'name': name,
      'type': type,
      'beancount_account': beancountAccount,
      'card_tail': cardTail,
      'initial_balance': initialBalance,
      'current_balance': currentBalance,
      'is_archived': isArchived ? 1 : 0,
    };
  }
}
