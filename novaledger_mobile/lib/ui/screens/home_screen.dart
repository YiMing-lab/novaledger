import 'package:flutter/material.dart';
import 'dashboard_tab.dart';
import 'transactions_tab.dart';
import 'analytics_tab.dart';
import 'accounts_debts_tab.dart';
import 'settings_tab.dart';
import 'quick_record_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _currentIndex = 0;

  final GlobalKey<DashboardTabState> _dashboardKey = GlobalKey<DashboardTabState>();
  final GlobalKey<TransactionsTabState> _transactionsKey = GlobalKey<TransactionsTabState>();
  final GlobalKey<AnalyticsTabState> _analyticsKey = GlobalKey<AnalyticsTabState>();
  final GlobalKey<AccountsDebtsTabState> _accountsKey = GlobalKey<AccountsDebtsTabState>();

  void _refreshAllTabs() {
    _dashboardKey.currentState?.refreshData();
    _transactionsKey.currentState?.refreshTransactions();
    _analyticsKey.currentState?.refreshAnalytics();
    _accountsKey.currentState?.refreshData();
  }

  Future<void> _openQuickRecord() async {
    final result = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => const QuickRecordScreen()),
    );
    if (result == true) {
      _refreshAllTabs();
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    final tabs = [
      DashboardTab(
        key: _dashboardKey,
        onNavigateToRecord: _openQuickRecord,
      ),
      TransactionsTab(key: _transactionsKey),
      AnalyticsTab(key: _analyticsKey),
      AccountsDebtsTab(key: _accountsKey),
      SettingsTab(onDataChanged: _refreshAllTabs),
    ];

    return Scaffold(
      body: SafeArea(
        child: IndexedStack(
          index: _currentIndex,
          children: tabs,
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _openQuickRecord,
        backgroundColor: theme.colorScheme.primary,
        foregroundColor: theme.colorScheme.onPrimary,
        icon: const Icon(Icons.add),
        label: const Text('记一笔', style: TextStyle(fontWeight: FontWeight.bold)),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentIndex,
        onDestinationSelected: (idx) {
          setState(() => _currentIndex = idx);
          if (idx == 0) _dashboardKey.currentState?.refreshData();
          if (idx == 1) _transactionsKey.currentState?.refreshTransactions();
          if (idx == 2) _analyticsKey.currentState?.refreshAnalytics();
          if (idx == 3) _accountsKey.currentState?.refreshData();
        },
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.dashboard_outlined),
            selectedIcon: Icon(Icons.dashboard),
            label: '概览',
          ),
          NavigationDestination(
            icon: Icon(Icons.receipt_long_outlined),
            selectedIcon: Icon(Icons.receipt_long),
            label: '明细',
          ),
          NavigationDestination(
            icon: Icon(Icons.pie_chart_outline),
            selectedIcon: Icon(Icons.pie_chart),
            label: '统计',
          ),
          NavigationDestination(
            icon: Icon(Icons.account_balance_outlined),
            selectedIcon: Icon(Icons.account_balance),
            label: '资产',
          ),
          NavigationDestination(
            icon: Icon(Icons.settings_outlined),
            selectedIcon: Icon(Icons.settings),
            label: '设置',
          ),
        ],
      ),
    );
  }
}
