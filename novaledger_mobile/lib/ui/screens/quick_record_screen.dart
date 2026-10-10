import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../core/accounting/accounting_service.dart';
import '../../core/ai/multi_ai_service.dart';
import '../../core/database/database_helper.dart';
import '../../core/models/account.dart';
import '../../core/models/category.dart';
import '../../core/models/debt.dart';
import '../widgets/category_picker_sheet.dart';
import '../widgets/custom_keypad.dart';

class QuickRecordScreen extends StatefulWidget {
  const QuickRecordScreen({super.key});

  @override
  State<QuickRecordScreen> createState() => _QuickRecordScreenState();
}

class _QuickRecordScreenState extends State<QuickRecordScreen> {
  int _recordTypeIndex = 0; // 0: 支出, 1: 收入, 2: 转账
  bool _isOffset = false;   // 支出模式下：是否为消费退款 (红字冲减)
  String _amountExpression = '0';
  DateTime _selectedDate = DateTime.now();

  final TextEditingController _payeeController = TextEditingController();
  final TextEditingController _narrationController = TextEditingController();

  List<Account> _accounts = [];
  List<Debt> _debts = [];
  List<Category> _categories = [];
  Account? _selectedAccount;
  
  // 转账目标
  String? _targetAccountName;
  String? _targetAccountBeancount;
  bool _isTargetDebt = false;

  Category? _selectedCategory;
  bool _isSaving = false;
  bool _isAiQuerying = false;

  @override
  void initState() {
    super.initState();
    _loadInitialData();
  }

  Future<void> _loadInitialData() async {
    final accounts = await DatabaseHelper.instance.getAccounts();
    final debts = await DatabaseHelper.instance.getDebts();
    final categories = await DatabaseHelper.instance.getCategories();
    setState(() {
      _accounts = accounts;
      _debts = debts;
      _categories = categories;
      if (accounts.isNotEmpty) {
        _selectedAccount = accounts.first;
        if (accounts.length > 1) {
          _targetAccountName = accounts[1].name;
          _targetAccountBeancount = accounts[1].beancountAccount;
        } else if (debts.isNotEmpty) {
          _targetAccountName = debts.first.name;
          _targetAccountBeancount = debts.first.beancountAccount;
          _isTargetDebt = true;
        }
      }
      _updateCategoryFilter();
    });
  }

  void _updateCategoryFilter() {
    final targetType = _recordTypeIndex == 1 ? 'income' : 'expense';
    final filtered = _categories.where((c) => c.type == targetType).toList();
    if (filtered.isNotEmpty) {
      _selectedCategory = filtered.first;
    } else {
      _selectedCategory = null;
    }
  }

  void _onKeyPressed(String key) {
    setState(() {
      if (_amountExpression == '0' && key != '.') {
        _amountExpression = key;
      } else {
        _amountExpression += key;
      }
    });
  }

  void _onDelete() {
    setState(() {
      if (_amountExpression.length > 1) {
        _amountExpression = _amountExpression.substring(0, _amountExpression.length - 1);
      } else {
        _amountExpression = '0';
      }
    });
  }

  double _evaluateAmount() {
    try {
      String expr = _amountExpression;
      if (expr.endsWith('+') || expr.endsWith('-')) {
        expr = expr.substring(0, expr.length - 1);
      }
      double total = 0.0;
      List<String> plusParts = expr.split('+');
      for (var p in plusParts) {
        if (p.contains('-')) {
          var minusParts = p.split('-');
          double sub = double.tryParse(minusParts.first) ?? 0.0;
          for (int i = 1; i < minusParts.length; i++) {
            sub -= double.tryParse(minusParts[i]) ?? 0.0;
          }
          total += sub;
        } else {
          total += double.tryParse(p) ?? 0.0;
        }
      }
      return total;
    } catch (_) {
      return double.tryParse(_amountExpression) ?? 0.0;
    }
  }

  Future<void> _onAiSuggest() async {
    if (_payeeController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('请先输入商户或交易备注以便 AI 识别')),
      );
      return;
    }
    final amt = _evaluateAmount();
    final catKeys = _categories.map((c) => c.key).toList();

    setState(() => _isAiQuerying = true);
    try {
      final provider = await MultiAIService.getCurrentProvider();
      final suggestedKey = await MultiAIService.suggestCategory(
        payee: _payeeController.text.trim(),
        narration: _narrationController.text.trim(),
        amount: amt,
        availableCategories: catKeys,
      );

      if (suggestedKey != null) {
        final match = _categories.firstWhere(
          (c) => c.key == suggestedKey,
          orElse: () => _categories.first,
        );
        setState(() {
          _selectedCategory = match;
        });
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('✨ [${provider.name.toUpperCase()}] 建议分类: ${match.name}')),
          );
        }
      } else {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('未获取到 AI 分类建议，请先在设置中配置 ${provider.name.toUpperCase()} API Key')),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('AI 建议失败: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _isAiQuerying = false);
    }
  }

  Future<void> _onSave() async {
    final amt = _evaluateAmount();
    if (amt <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('请输入有效金额')));
      return;
    }

    if (_selectedAccount == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('请选择出资账户')));
      return;
    }

    setState(() => _isSaving = true);
    try {
      final payee = _payeeController.text.trim().isEmpty ? '日常消费' : _payeeController.text.trim();
      final narr = _narrationController.text.trim();

      if (_recordTypeIndex == 0) {
        // 支出 (支持普通支出与退款冲减)
        final catKey = _selectedCategory?.key ?? 'Expenses:Other:General';
        await AccountingService.recordExpense(
          date: _selectedDate,
          payee: payee,
          narration: narr,
          amount: amt,
          categoryAccount: catKey,
          sourceAccount: _selectedAccount!.beancountAccount,
          isOffset: _isOffset,
        );
      } else if (_recordTypeIndex == 1) {
        // 收入
        final catKey = _selectedCategory?.key ?? 'Income:Other';
        await AccountingService.recordIncome(
          date: _selectedDate,
          payee: payee,
          narration: narr,
          amount: amt,
          categoryAccount: catKey,
          targetAccount: _selectedAccount!.beancountAccount,
        );
      } else {
        // 转账 (支持账户互转与债务归还本金)
        if (_targetAccountBeancount == null ||
            _targetAccountBeancount == _selectedAccount!.beancountAccount) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('转入账户不能与出资账户相同')),
          );
          setState(() => _isSaving = false);
          return;
        }
        await AccountingService.recordTransfer(
          date: _selectedDate,
          narration: narr,
          amount: amt,
          fromAccount: _selectedAccount!.beancountAccount,
          toAccount: _targetAccountBeancount!,
        );
      }

      if (mounted) {
        Navigator.pop(context, true);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('记账失败: $e')));
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  void _showTargetAccountPicker() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => DraggableScrollableSheet(
        initialChildSize: 0.6,
        minChildSize: 0.4,
        maxChildSize: 0.9,
        expand: false,
        builder: (_, scrollController) => ListView(
          controller: scrollController,
          padding: const EdgeInsets.symmetric(vertical: 12),
          children: [
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Text(
                '选择转入账户 / 债务还款',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
              ),
            ),
            const Divider(),
            if (_accounts.isNotEmpty) ...[
              const Padding(
                padding: EdgeInsets.fromLTRB(16, 8, 16, 4),
                child: Text('资金账户', style: TextStyle(color: Colors.grey, fontSize: 13)),
              ),
              ..._accounts.where((a) => a.id != _selectedAccount?.id).map((a) => ListTile(
                    leading: const CircleAvatar(
                      backgroundColor: Colors.blueGrey,
                      child: Icon(Icons.account_balance_wallet, color: Colors.white, size: 20),
                    ),
                    title: Text(a.name),
                    subtitle: Text(a.beancountAccount),
                    onTap: () {
                      setState(() {
                        _targetAccountName = a.name;
                        _targetAccountBeancount = a.beancountAccount;
                        _isTargetDebt = false;
                      });
                      Navigator.pop(ctx);
                    },
                  )),
            ],
            if (_debts.isNotEmpty) ...[
              const Padding(
                padding: EdgeInsets.fromLTRB(16, 12, 16, 4),
                child: Text('债务 / 贷款 (还款将直接递减未还本金)', style: TextStyle(color: Colors.orange, fontSize: 13)),
              ),
              ..._debts.map((d) => ListTile(
                    leading: const CircleAvatar(
                      backgroundColor: Colors.deepOrange,
                      child: Icon(Icons.assignment_turned_in, color: Colors.white, size: 20),
                    ),
                    title: Text(d.name),
                    subtitle: Text('${d.beancountAccount} · 待还: ¥${d.remainingAmount.toStringAsFixed(2)}'),
                    trailing: const Chip(
                      label: Text('贷款核销', style: TextStyle(fontSize: 11, color: Colors.deepOrange)),
                      backgroundColor: Color(0x22FF5722),
                      visualDensity: VisualDensity.compact,
                    ),
                    onTap: () {
                      setState(() {
                        _targetAccountName = d.name;
                        _targetAccountBeancount = d.beancountAccount;
                        _isTargetDebt = true;
                      });
                      Navigator.pop(ctx);
                    },
                  )),
            ],
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dateStr = DateFormat('yyyy-MM-dd').format(_selectedDate);

    return Scaffold(
      appBar: AppBar(
        title: SegmentedButton<int>(
          segments: const [
            ButtonSegment(value: 0, label: Text('支出')),
            ButtonSegment(value: 1, label: Text('收入')),
            ButtonSegment(value: 2, label: Text('转账')),
          ],
          selected: {_recordTypeIndex},
          onSelectionChanged: (val) {
            setState(() {
              _recordTypeIndex = val.first;
              _updateCategoryFilter();
            });
          },
        ),
      ),
      body: Column(
        children: [
          // 顶部金额与基础信息
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      _recordTypeIndex == 0 && _isOffset ? '退款 ¥' : '¥',
                      style: theme.textTheme.headlineMedium?.copyWith(
                        color: _recordTypeIndex == 0 && _isOffset
                            ? Colors.teal
                            : theme.colorScheme.primary,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        _amountExpression,
                        textAlign: TextAlign.right,
                        style: theme.textTheme.displayMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                          color: _recordTypeIndex == 0 && _isOffset
                              ? Colors.teal
                              : theme.colorScheme.onSurface,
                        ),
                      ),
                    ),
                  ],
                ),
                const Divider(),
                // 商户与备注输入
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _payeeController,
                        decoration: InputDecoration(
                          hintText: _recordTypeIndex == 2
                              ? (_isTargetDebt ? '用途: 偿还贷款本金' : '用途: 内部资金调拨')
                              : (_recordTypeIndex == 0 && _isOffset
                                  ? '原消费商户 (如: 淘宝退货退款)'
                                  : '商户 (如: 星巴克)'),
                          border: InputBorder.none,
                          isDense: true,
                        ),
                      ),
                    ),
                    if (_recordTypeIndex != 2)
                      IconButton(
                        icon: _isAiQuerying
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.auto_awesome, color: Colors.amber),
                        tooltip: 'AI 自动分类推荐',
                        onPressed: _isAiQuerying ? null : _onAiSuggest,
                      ),
                  ],
                ),
                TextField(
                  controller: _narrationController,
                  decoration: const InputDecoration(
                    hintText: '备注说明 (选填)',
                    border: InputBorder.none,
                    isDense: true,
                  ),
                ),
              ],
            ),
          ),

          // 快捷标签选择栏 (账户、分类、日期、退款模式切换)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Wrap(
              spacing: 8,
              runSpacing: 4,
              children: [
                // 日期选择
                ActionChip(
                  avatar: const Icon(Icons.calendar_today, size: 16),
                  label: Text(dateStr),
                  onPressed: () async {
                    final d = await showDatePicker(
                      context: context,
                      initialDate: _selectedDate,
                      firstDate: DateTime(2000),
                      lastDate: DateTime(2100),
                    );
                    if (d != null) setState(() => _selectedDate = d);
                  },
                ),

                // 出资/入账账户选择
                ActionChip(
                  avatar: const Icon(Icons.credit_card, size: 16),
                  label: Text(
                    _recordTypeIndex == 2
                        ? '出资: ${_selectedAccount?.name ?? "选择账户"}'
                        : (_selectedAccount?.name ?? '选择账户'),
                  ),
                  onPressed: () {
                    showModalBottomSheet(
                      context: context,
                      builder: (ctx) => ListView(
                        children: _accounts
                            .map((a) => ListTile(
                                  title: Text(a.name),
                                  subtitle: Text(a.beancountAccount),
                                  onTap: () {
                                    setState(() => _selectedAccount = a);
                                    Navigator.pop(ctx);
                                  },
                                ))
                            .toList(),
                      ),
                    );
                  },
                ),

                // 分类选择 (转账模式下隐藏)
                if (_recordTypeIndex != 2)
                  ActionChip(
                    avatar: const Icon(Icons.category, size: 16),
                    label: Text(_selectedCategory?.name ?? '选择分类'),
                    onPressed: () async {
                      final filtered = _categories
                          .where((c) =>
                              c.type == (_recordTypeIndex == 1 ? 'income' : 'expense'))
                          .toList();
                      final cat = await CategoryPickerSheet.show(
                        context,
                        categories: filtered,
                        selectedKey: _selectedCategory?.key ?? '',
                      );
                      if (cat != null) setState(() => _selectedCategory = cat);
                    },
                  ),

                // 支出模式专属：退款/红字冲减开关
                if (_recordTypeIndex == 0)
                  FilterChip(
                    avatar: Icon(
                      Icons.replay,
                      size: 16,
                      color: _isOffset ? Colors.white : Colors.teal,
                    ),
                    label: Text(_isOffset ? '已开启退款 (红字抵扣)' : '普通支出'),
                    selected: _isOffset,
                    selectedColor: Colors.teal.shade700,
                    checkmarkColor: Colors.white,
                    labelStyle: TextStyle(
                      color: _isOffset ? Colors.white : Colors.teal.shade700,
                      fontWeight: _isOffset ? FontWeight.bold : FontWeight.normal,
                    ),
                    onSelected: (val) {
                      setState(() => _isOffset = val);
                    },
                  ),

                // 转入账户 / 债务还款 (转账模式下显示)
                if (_recordTypeIndex == 2)
                  ActionChip(
                    avatar: Icon(
                      _isTargetDebt ? Icons.assignment_turned_in : Icons.arrow_forward,
                      size: 16,
                      color: _isTargetDebt ? Colors.deepOrange : null,
                    ),
                    label: Text(
                      '转入: ${_targetAccountName ?? "选择账户"}${_isTargetDebt ? " (还款)" : ""}',
                      style: TextStyle(
                        color: _isTargetDebt ? Colors.deepOrange : null,
                        fontWeight: _isTargetDebt ? FontWeight.bold : FontWeight.normal,
                      ),
                    ),
                    onPressed: _showTargetAccountPicker,
                  ),
              ],
            ),
          ),

          const Spacer(),

          // 极速定制数字键盘
          CustomKeypad(
            onKeyPressed: _onKeyPressed,
            onDelete: _onDelete,
            onConfirm: _isSaving ? () {} : _onSave,
            confirmLabel: _isSaving ? '保存中...' : '完成',
          ),
        ],
      ),
    );
  }
}
