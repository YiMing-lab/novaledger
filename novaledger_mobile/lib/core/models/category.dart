class Category {
  final String key; // e.g. Expenses:Food:Dining
  final String name; // 餐饮
  final String? parentKey;
  final String icon;
  final String color;
  final String type; // expense, income

  Category({
    required this.key,
    required this.name,
    this.parentKey,
    this.icon = 'category',
    this.color = '#1976D2',
    required this.type,
  });

  factory Category.fromMap(Map<String, dynamic> map) {
    return Category(
      key: map['key'] ?? '',
      name: map['name'] ?? '',
      parentKey: map['parent_key'],
      icon: map['icon'] ?? 'category',
      color: map['color'] ?? '#1976D2',
      type: map['type'] ?? 'expense',
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'key': key,
      'name': name,
      'parent_key': parentKey,
      'icon': icon,
      'color': color,
      'type': type,
    };
  }
}
