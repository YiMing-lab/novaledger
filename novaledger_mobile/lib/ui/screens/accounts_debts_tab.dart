import 'package:flutter/material.dart';
import '../../core/database/database_helper.dart';
import '../../core/models/account.dart';
import '../../core/models/debt.dart';

class AccountsDebtsTab extends StatefulWidget {
  const AccountsDebtsTab({super.key});

  @override
  State<AccountsDebtsTab> createState() => AccountsDebtsTabState();
}

class AccountsDebtsTabState extends State<AccountsDebtsTab> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  List<Account> _accounts = [];
  List<Debt> _debts = [];
  Map<String, double> _realBalances = {};
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    refreshData();
  }

  Future<void> refreshData() async {
    setState(() => _isLoading = true);
    final db = DatabaseHelper.instance;
    final accounts = await db.getAccounts();
    final debts = await db.getDebts();
    final balancesData = await db.calculateBalances();

    setState(() {
      _accounts = accounts;
      _debts = debts;
      _realBalances = (balancesData['account_balances'] as Map<String, double>?) ?? {};
      _isLoading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('资金与负债', style: TextStyle(fontWeight: FontWeight.bold)),
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: '资金账户 (Assets)'),
            Tab(text: '贷款与债务 (Debts)'),
          ],
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : TabBarView(
              controller: _tabController,
              children: [
                // 1. 资金账户列表
                RefreshIndicator(
                  onRefresh: refreshData,
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _accounts.length,
                    itemBuilder: (context, index) {
                      final acc = _accounts[index];
                      final currentBalance = _realBalances[acc.beancountAccount] ?? acc.initialBalance;

                      return Card(
                        elevation: 0,
                        margin: const EdgeInsets.only(bottom: 10),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                        color: theme.colorScheme.surfaceContainerLow,
                        child: ListTile(
                          leading: CircleAvatar(
                            backgroundColor: theme.colorScheme.primaryContainer,
                            child: Icon(Icons.account_balance_wallet_outlined, color: theme.colorScheme.primary),
                          ),
                          title: Text(acc.name, style: const TextStyle(fontWeight: FontWeight.bold)),
                          subtitle: Text(
                            acc.cardTail.isNotEmpty ? '尾号 ${acc.cardTail} · ${acc.beancountAccount}' : acc.beancountAccount,
                            style: const TextStyle(fontSize: 12),
                          ),
                          trailing: Text(
                            '¥${currentBalance.toStringAsFixed(2)}',
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 15,
                              color: currentBalance >= 0 ? theme.colorScheme.onSurface : Colors.red,
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ),

                // 2. 债务列表
                RefreshIndicator(
                  onRefresh: refreshData,
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _debts.length,
                    itemBuilder: (context, index) {
                      final debt = _debts[index];
                      // 负债在复式记账中贷记为负，取绝对值
                      final currentLiability = (_realBalances[debt.beancountAccount] ?? -debt.initialAmount).abs();
                      final pct = debt.initialAmount > 0
                          ? ((debt.initialAmount - currentLiability) / debt.initialAmount).clamp(0.0, 1.0)
                          : 0.0;

                      return Card(
                        elevation: 0,
                        margin: const EdgeInsets.only(bottom: 12),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                        color: theme.colorScheme.surfaceContainerLow,
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(debt.name, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                                  Text(
                                    '剩余: ¥${currentLiability.toStringAsFixed(2)}',
                                    style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.red),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 6),
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    '初始总额: ¥${debt.initialAmount.toStringAsFixed(2)}',
                                    style: TextStyle(fontSize: 12, color: theme.colorScheme.outline),
                                  ),
                                  if (debt.monthlyPayment != null)
                                    Text(
                                      '月供: ¥${debt.monthlyPayment!.toStringAsFixed(2)}',
                                      style: TextStyle(fontSize: 12, color: theme.colorScheme.outline),
                                    ),
                                ],
                              ),
                              const SizedBox(height: 10),
                              LinearProgressIndicator(
                                value: pct,
                                backgroundColor: theme.colorScheme.surfaceContainerHighest,
                                color: Colors.green,
                                minHeight: 6,
                                borderRadius: BorderRadius.circular(3),
                              ),
                              const SizedBox(height: 4),
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text('还款进度: ${(pct * 100).toStringAsFixed(1)}%', style: const TextStyle(fontSize: 11)),
                                  if (debt.dueDate.isNotEmpty)
                                    Text('到期日: ${debt.dueDate}', style: const TextStyle(fontSize: 11)),
                                ],
                              ),
                              if (debt.note.isNotEmpty) ...[
                                const SizedBox(height: 4),
                                Text('备注: ${debt.note}', style: TextStyle(fontSize: 11, color: theme.colorScheme.outline)),
                              ],
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ],
            ),
    );
  }
}
