import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../core/database/database_helper.dart';
import '../../core/models/transaction_item.dart';

class TransactionsTab extends StatefulWidget {
  const TransactionsTab({super.key});

  @override
  State<TransactionsTab> createState() => TransactionsTabState();
}

class TransactionsTabState extends State<TransactionsTab> {
  List<TransactionItem> _transactions = [];
  bool _isLoading = true;
  String _searchQuery = '';
  int _newCount = 0;

  @override
  void initState() {
    super.initState();
    refreshTransactions();
  }

  Future<void> refreshTransactions() async {
    setState(() => _isLoading = true);
    final txs = await DatabaseHelper.instance.getTransactions(
      query: _searchQuery.isEmpty ? null : _searchQuery,
      limit: 500,
    );
    final newItems = txs.where((t) => t.isNew).length;
    setState(() {
      _transactions = txs;
      _newCount = newItems;
      _isLoading = false;
    });
  }

  Future<void> _clearAllNewDots() async {
    await DatabaseHelper.instance.dismissAllNewDots();
    await refreshTransactions();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('已清除所有新导入标记')),
      );
    }
  }

  Future<void> _deleteTx(TransactionItem tx) async {
    await DatabaseHelper.instance.deleteTransaction(tx.id);
    refreshTransactions();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('已删除交易')),
      );
    }
  }

  /// 按日期分组流水
  Map<String, List<TransactionItem>> _groupByDate(List<TransactionItem> list) {
    final Map<String, List<TransactionItem>> map = {};
    for (final tx in list) {
      final d = tx.date;
      if (!map.containsKey(d)) {
        map[d] = [];
      }
      map[d]!.add(tx);
    }
    return map;
  }

  String _formatDateHeader(String dateStr) {
    try {
      final date = DateTime.parse(dateStr);
      final weekdayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
      final weekday = weekdayNames[date.weekday - 1];
      final now = DateTime.now();
      final todayStr = DateFormat('yyyy-MM-dd').format(now);
      final yesterdayStr = DateFormat('yyyy-MM-dd').format(now.subtract(const Duration(days: 1)));

      if (dateStr == todayStr) {
        return '$dateStr 今天 ($weekday)';
      } else if (dateStr == yesterdayStr) {
        return '$dateStr 昨天 ($weekday)';
      } else {
        return '$dateStr $weekday';
      }
    } catch (_) {
      return dateStr;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final grouped = _groupByDate(_transactions);
    final dates = grouped.keys.toList();

    return Scaffold(
      appBar: AppBar(
        title: const Text('流水明细', style: TextStyle(fontWeight: FontWeight.bold)),
        actions: [
          if (_newCount > 0)
            TextButton.icon(
              icon: const Icon(Icons.done_all, size: 18),
              label: Text('清除新标 ($_newCount)'),
              onPressed: _clearAllNewDots,
            ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(60),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: SearchBar(
              hintText: '搜索商户、分类、备注或金额...',
              leading: const Icon(Icons.search),
              elevation: const WidgetStatePropertyAll(0),
              backgroundColor: WidgetStatePropertyAll(theme.colorScheme.surfaceContainerHigh),
              onChanged: (val) {
                setState(() => _searchQuery = val);
                refreshTransactions();
              },
            ),
          ),
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _transactions.isEmpty
              ? Center(
                  child: Text(
                    _searchQuery.isEmpty ? '暂无交易流水，点击右下角快捷记账' : '未找到匹配的交易',
                    style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.outline),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: refreshTransactions,
                  child: ListView.builder(
                    itemCount: dates.length,
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    itemBuilder: (context, dateIndex) {
                      final dateKey = dates[dateIndex];
                      final dayTxs = grouped[dateKey]!;

                      // 计算单日统计 (支出与收入)
                      double dayExpense = 0;
                      double dayIncome = 0;
                      for (final tx in dayTxs) {
                        if (tx.isOffset) {
                          dayExpense -= tx.primaryAmount;
                        } else if (tx.primaryCategory.startsWith('Expenses:')) {
                          dayExpense += tx.primaryAmount;
                        } else if (tx.primaryCategory.startsWith('Income:')) {
                          dayIncome += tx.primaryAmount;
                        }
                      }

                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // 日期分组头部
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  _formatDateHeader(dateKey),
                                  style: TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 13,
                                    color: theme.colorScheme.outline,
                                  ),
                                ),
                                Row(
                                  children: [
                                    if (dayExpense != 0)
                                      Text(
                                        '支: ¥${dayExpense.toStringAsFixed(2)}  ',
                                        style: const TextStyle(fontSize: 12, color: Colors.orange),
                                      ),
                                    if (dayIncome != 0)
                                      Text(
                                        '收: ¥${dayIncome.toStringAsFixed(2)}',
                                        style: const TextStyle(fontSize: 12, color: Colors.green),
                                      ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                          // 该日期的所有交易卡片
                          ...dayTxs.map((tx) => _buildTransactionCard(context, tx, theme)),
                          const SizedBox(height: 6),
                        ],
                      );
                    },
                  ),
                ),
    );
  }

  Widget _buildTransactionCard(BuildContext context, TransactionItem tx, ThemeData theme) {
    final isOffset = tx.isOffset;
    final isExpense = tx.primaryCategory.startsWith('Expenses:');
    final isIncome = tx.primaryCategory.startsWith('Income:');
    
    Color color;
    IconData icon;
    String sign;

    if (isOffset) {
      color = Colors.teal;
      icon = Icons.replay;
      sign = '+';
    } else if (isExpense) {
      color = Colors.orange;
      icon = Icons.shopping_bag_outlined;
      sign = '-';
    } else if (isIncome) {
      color = Colors.green;
      icon = Icons.attach_money;
      sign = '+';
    } else {
      color = Colors.blue;
      icon = Icons.swap_horiz;
      sign = '';
    }

    return Dismissible(
      key: Key(tx.id),
      direction: DismissDirection.endToStart,
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        decoration: BoxDecoration(
          color: Colors.red,
          borderRadius: BorderRadius.circular(12),
        ),
        child: const Icon(Icons.delete, color: Colors.white),
      ),
      confirmDismiss: (direction) async {
        return await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('删除交易确认'),
            content: Text('确定删除 "${tx.payee}" (¥${tx.primaryAmount.toStringAsFixed(2)}) 吗？'),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
              TextButton(
                onPressed: () => Navigator.pop(ctx, true),
                style: TextButton.styleFrom(foregroundColor: Colors.red),
                child: const Text('删除'),
              ),
            ],
          ),
        );
      },
      onDismissed: (_) => _deleteTx(tx),
      child: Card(
        elevation: 0,
        margin: const EdgeInsets.only(bottom: 6),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        color: theme.colorScheme.surfaceContainerLow,
        child: ListTile(
          dense: true,
          leading: Stack(
            children: [
              CircleAvatar(
                backgroundColor: color.withOpacity(0.15),
                child: Icon(icon, color: color, size: 20),
              ),
              if (tx.isNew)
                Positioned(
                  right: 0,
                  top: 0,
                  child: Container(
                    width: 9,
                    height: 9,
                    decoration: const BoxDecoration(
                      color: Colors.blueAccent,
                      shape: BoxShape.circle,
                    ),
                  ),
                ),
            ],
          ),
          title: Row(
            children: [
              Expanded(
                child: Row(
                  children: [
                    Flexible(
                      child: Text(
                        tx.payee.isNotEmpty ? tx.payee : '交易',
                        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (isOffset) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                        decoration: BoxDecoration(
                          color: Colors.teal.shade50,
                          border: Border.all(color: Colors.teal.shade300, width: 0.8),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: const Text(
                          '抵扣支出',
                          style: TextStyle(fontSize: 10, color: Colors.teal, fontWeight: FontWeight.bold),
                        ),
                      ),
                    ],
                    if (tx.isNew) ...[
                      const SizedBox(width: 4),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                        decoration: BoxDecoration(
                          color: Colors.blue.shade50,
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: const Text(
                          'NEW',
                          style: TextStyle(fontSize: 9, color: Colors.blue, fontWeight: FontWeight.bold),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              Text(
                '$sign¥${tx.primaryAmount.toStringAsFixed(2)}',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: color),
              ),
            ],
          ),
          subtitle: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 2),
              Row(
                children: [
                  Text(
                    tx.primaryCategory.split(':').last,
                    style: TextStyle(fontSize: 11, color: theme.colorScheme.primary),
                  ),
                  if (tx.narration.isNotEmpty) ...[
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        tx.narration,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 11, color: theme.colorScheme.onSurfaceVariant),
                      ),
                    ),
                  ],
                ],
              ),
            ],
          ),
          onTap: () {
            _showTxDetail(context, tx);
          },
        ),
      ),
    );
  }

  void _showTxDetail(BuildContext context, TransactionItem tx) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(20.0),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  '交易明细',
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold),
                ),
                if (tx.isOffset)
                  const Chip(
                    label: Text('红字抵扣', style: TextStyle(color: Colors.white, fontSize: 11)),
                    backgroundColor: Colors.teal,
                    visualDensity: VisualDensity.compact,
                  ),
              ],
            ),
            const SizedBox(height: 12),
            Text('商户: ${tx.payee}'),
            if (tx.narration.isNotEmpty) Text('说明: ${tx.narration}'),
            Text('日期: ${tx.date}'),
            Text('来源: ${tx.sourceType}'),
            Text('唯一流水号: ${tx.id}', style: const TextStyle(fontSize: 11, color: Colors.grey)),
            const Divider(height: 24),
            const Text('复式记账借贷分录 (Postings):', style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            ...tx.postings.map((p) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Text(
                          p.account,
                          style: const TextStyle(fontSize: 12, fontFamily: 'monospace'),
                        ),
                      ),
                      Text(
                        '${p.amount >= 0 ? "+" : ""}${p.amount.toStringAsFixed(2)} ${p.currency}',
                        style: TextStyle(
                          fontFamily: 'monospace',
                          fontWeight: FontWeight.bold,
                          color: p.amount >= 0 ? Colors.green : Colors.red,
                        ),
                      ),
                    ],
                  ),
                )),
            const SizedBox(height: 20),
          ],
        ),
      ),
    );
  }
}
