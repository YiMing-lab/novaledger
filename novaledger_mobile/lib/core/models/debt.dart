class Debt {
  final String id;
  final String name;
  final String beancountAccount;
  final double initialAmount;
  final double remainingAmount;
  final String type; // monthly, lump_sum
  final String dueDate;
  final double? monthlyPayment;
  final String note;

  Debt({
    required this.id,
    required this.name,
    required this.beancountAccount,
    required this.initialAmount,
    required this.remainingAmount,
    required this.type,
    this.dueDate = '',
    this.monthlyPayment,
    this.note = '',
  });

  factory Debt.fromMap(Map<String, dynamic> map) {
    return Debt(
      id: map['id'] ?? '',
      name: map['name'] ?? '',
      beancountAccount: map['beancount_account'] ?? map['account'] ?? '',
      initialAmount: (map['initial_amount'] as num?)?.toDouble() ?? 0.0,
      remainingAmount: (map['remaining_amount'] as num?)?.toDouble() ?? 
                       (map['initial_amount'] as num?)?.toDouble() ?? 0.0,
      type: map['type'] ?? 'monthly',
      dueDate: map['due_date'] ?? '',
      monthlyPayment: (map['monthly_payment'] as num?)?.toDouble(),
      note: map['note'] ?? '',
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'name': name,
      'beancount_account': beancountAccount,
      'initial_amount': initialAmount,
      'remaining_amount': remainingAmount,
      'type': type,
      'due_date': dueDate,
      'monthly_payment': monthlyPayment,
      'note': note,
    };
  }
}
