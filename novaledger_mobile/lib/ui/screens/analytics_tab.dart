import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../core/database/database_helper.dart';

class AnalyticsTab extends StatefulWidget {
  const AnalyticsTab({super.key});

  @override
  State<AnalyticsTab> createState() => AnalyticsTabState();
}

class AnalyticsTabState extends State<AnalyticsTab> {
  String _selectedMonth = DateFormat('yyyy-MM').format(DateTime.now());
  double _income = 0.0;
  double _expense = 0.0;
  Map<String, double> _categories = {};
  bool _isLoading = true;

  final List<Color> _pieColors = const [
    Color(0xFFE57373),
    Color(0xFF81C784),
    Color(0xFF64B5F6),
    Color(0xFFFFB74D),
    Color(0xFFBA68C8),
    Color(0xFF4DB6AC),
    Color(0xFFFFD54F),
    Color(0xFFA1887F),
    Color(0xFF90A4AE),
  ];

  @override
  void initState() {
    super.initState();
    refreshAnalytics();
  }

  Future<void> refreshAnalytics() async {
    setState(() => _isLoading = true);
    final summary = await DatabaseHelper.instance.getMonthlySummary(_selectedMonth);
    setState(() {
      _income = summary['total_income'] ?? 0.0;
      _expense = summary['total_expenses'] ?? 0.0;
      _categories = (summary['categories'] as Map<String, double>?) ?? {};
      _isLoading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('统计与分析', style: TextStyle(fontWeight: FontWeight.bold)),
        actions: [
          IconButton(
            icon: const Icon(Icons.calendar_month),
            onPressed: () async {
              // 月份简易切换
              final d = await showDatePicker(
                context: context,
                initialDate: DateTime.now(),
                firstDate: DateTime(2020),
                lastDate: DateTime(2030),
              );
              if (d != null) {
                setState(() => _selectedMonth = DateFormat('yyyy-MM').format(d));
                refreshAnalytics();
              }
            },
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                // 月份选择与标题
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('$_selectedMonth 月度分析', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
                    Text(
                      '净结余: ¥${(_income - _expense).toStringAsFixed(2)}',
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        color: (_income - _expense) >= 0 ? Colors.green : Colors.red,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),

                // 分类支出占比饼图
                Card(
                  elevation: 0,
                  color: theme.colorScheme.surfaceContainerLow,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      children: [
                        Text('支出分类占比', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                        const SizedBox(height: 20),
                        if (_categories.isEmpty)
                          const Padding(
                            padding: EdgeInsets.symmetric(vertical: 40),
                            child: Text('本月暂无支出数据'),
                          )
                        else ...[
                          SizedBox(
                            height: 180,
                            child: PieChart(
                              PieChartData(
                                sectionsSpace: 2,
                                centerSpaceRadius: 40,
                                sections: _buildPieSections(),
                              ),
                            ),
                          ),
                          const SizedBox(height: 20),
                          // 分类明细列表
                          ..._buildCategoryList(theme),
                        ],
                      ],
                    ),
                  ),
                ),
              ],
            ),
    );
  }

  List<PieChartSectionData> _buildPieSections() {
    int colorIdx = 0;
    return _categories.entries.map((e) {
      final color = _pieColors[colorIdx % _pieColors.length];
      colorIdx++;
      final pct = _expense > 0 ? (e.value / _expense * 100) : 0.0;
      return PieChartSectionData(
        value: e.value,
        color: color,
        title: '${pct.toStringAsFixed(0)}%',
        radius: 45,
        titleStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.white),
      );
    }).toList();
  }

  List<Widget> _buildCategoryList(ThemeData theme) {
    int colorIdx = 0;
    return _categories.entries.map((e) {
      final color = _pieColors[colorIdx % _pieColors.length];
      colorIdx++;
      final pct = _expense > 0 ? (e.value / _expense * 100) : 0.0;
      final simpleName = e.key.split(':').last;

      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          children: [
            Container(width: 10, height: 10, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
            const SizedBox(width: 8),
            Expanded(child: Text(simpleName, style: const TextStyle(fontSize: 13))),
            Text('${pct.toStringAsFixed(1)}% ', style: TextStyle(fontSize: 12, color: theme.colorScheme.outline)),
            Text('¥${e.value.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
          ],
        ),
      );
    }).toList();
  }
}
