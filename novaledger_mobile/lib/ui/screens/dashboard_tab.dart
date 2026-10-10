import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../core/database/database_helper.dart';
import '../../core/models/transaction_item.dart';
import '../widgets/stat_card.dart';

class DashboardTab extends StatefulWidget {
  final VoidCallback onNavigateToRecord;

  const DashboardTab({super.key, required this.onNavigateToRecord});

  @override
  State<DashboardTab> createState() => DashboardTabState();
}

class DashboardTabState extends State<DashboardTab> {
  double _netWorth = 0.0;
  double _totalAssets = 0.0;
  double _totalLiabilities = 0.0;
  double _monthIncome = 0.0;
  double _monthExpense = 0.0;
  double _savingsRate = 0.0;
  List<TransactionItem> _recentTxs = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    refreshData();
  }

  Future<void> refreshData() async {
    setState(() => _isLoading = true);
    final db = DatabaseHelper.instance;
    final balances = await db.calculateBalances();

    final currentMonth = DateFormat('yyyy-MM').format(DateTime.now());
    final summary = await db.getMonthlySummary(currentMonth);
    final recent = await db.getTransactions(limit: 5);

    setState(() {
      _totalAssets = balances['total_assets'] ?? 0.0;
      _totalLiabilities = balances['total_liabilities'] ?? 0.0;
      _netWorth = balances['net_worth'] ?? 0.0;
      _monthIncome = summary['total_income'] ?? 0.0;
      _monthExpense = summary['total_expenses'] ?? 0.0;
      _savingsRate = summary['savings_rate'] ?? 0.0;
      _recentTxs = recent;
      _isLoading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final currentMonthName = DateFormat('M月').format(DateTime.now());

    if (_isLoading) {
      return const Center(child: CircularProgressIndicator());
    }

    return RefreshIndicator(
      onRefresh: refreshData,
      child: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        children: [
          // 净资产主卡片
          StatCard(
            title: '净资产总值 (Net Worth)',
            value: '¥${_netWorth.toStringAsFixed(2)}',
            icon: Icons.account_balance,
            color: _netWorth >= 0 ? theme.colorScheme.primary : theme.colorScheme.error,
            subtitle: '总资产: ¥${_totalAssets.toStringAsFixed(2)}   总负债: ¥${_totalLiabilities.toStringAsFixed(2)}',
          ),
          const SizedBox(height: 12),

          // 当月收支与储蓄率概览
          Row(
            children: [
              Expanded(
                child: StatCard(
                  title: '$currentMonthName收入',
                  value: '¥${_monthIncome.toStringAsFixed(2)}',
                  icon: Icons.trending_up,
                  color: Colors.green,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: StatCard(
                  title: '$currentMonthName支出',
                  value: '¥${_monthExpense.toStringAsFixed(2)}',
                  icon: Icons.trending_down,
                  color: Colors.orange,
                  subtitle: '储蓄率: ${_savingsRate.toStringAsFixed(1)}%',
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),

          // 最近流水标题
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('最近流水明细', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
              TextButton(
                onPressed: widget.onNavigateToRecord,
                child: const Text('记一笔'),
              ),
            ],
          ),

          if (_recentTxs.isEmpty)
            Card(
              elevation: 0,
              color: theme.colorScheme.surfaceContainerLow,
              child: Padding(
                padding: const EdgeInsets.all(24.0),
                child: Center(
                  child: Column(
                    children: [
                      Icon(Icons.receipt_long_outlined, size: 40, color: theme.colorScheme.outline),
                      const SizedBox(height: 8),
                      Text('暂无流水，点击右下角极速记一笔，或从电脑端导入', style: theme.textTheme.bodyMedium),
                    ],
                  ),
                ),
              ),
            )
          else
            ..._recentTxs.map((tx) {
              final isExpense = tx.primaryCategory.startsWith('Expenses:');
              final isIncome = tx.primaryCategory.startsWith('Income:');
              final color = isExpense ? Colors.orange : (isIncome ? Colors.green : Colors.blue);

              return Card(
                elevation: 0,
                margin: const EdgeInsets.only(bottom: 8),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                color: theme.colorScheme.surfaceContainerLow,
                child: ListTile(
                  leading: CircleAvatar(
                    backgroundColor: color.withOpacity(0.15),
                    child: Icon(
                      isExpense ? Icons.shopping_bag_outlined : (isIncome ? Icons.attach_money : Icons.swap_horiz),
                      color: color,
                      size: 20,
                    ),
                  ),
                  title: Text(tx.payee.isNotEmpty ? tx.payee : '交易', style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: Text('${tx.date}  ${tx.narration}'),
                  trailing: Text(
                    '${isExpense ? "-" : (isIncome ? "+" : "")}¥${tx.primaryAmount.toStringAsFixed(2)}',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 15,
                      color: color,
                    ),
                  ),
                ),
              );
            }),
        ],
      ),
    );
  }
}
