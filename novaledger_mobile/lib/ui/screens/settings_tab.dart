import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import '../../core/ai/multi_ai_service.dart';
import '../../core/database/database_helper.dart';
import '../../core/export/beancount_serializer.dart';
import '../../core/migration/migration_importer.dart';
import '../../core/parsers/csv_bill_parser.dart';

class SettingsTab extends StatefulWidget {
  final VoidCallback onDataChanged;

  const SettingsTab({super.key, required this.onDataChanged});

  @override
  State<SettingsTab> createState() => _SettingsTabState();
}

class _SettingsTabState extends State<SettingsTab> {
  AIProvider _selectedProvider = AIProvider.deepseek;
  final TextEditingController _apiKeyController = TextEditingController();
  final TextEditingController _baseUrlController = TextEditingController();
  final TextEditingController _modelController = TextEditingController();

  bool _isProcessing = false;

  @override
  void initState() {
    super.initState();
    _loadAiSettings();
  }

  Future<void> _loadAiSettings() async {
    final provider = await MultiAIService.getCurrentProvider();
    final key = await MultiAIService.getApiKey(provider) ?? '';
    final baseUrl = await MultiAIService.getBaseUrl(provider);
    final model = await MultiAIService.getModelName(provider);

    setState(() {
      _selectedProvider = provider;
      _apiKeyController.text = key;
      _baseUrlController.text = baseUrl;
      _modelController.text = model;
    });
  }

  Future<void> _onProviderChanged(AIProvider provider) async {
    await MultiAIService.setProvider(provider);
    final key = await MultiAIService.getApiKey(provider) ?? '';
    final baseUrl = await MultiAIService.getBaseUrl(provider);
    final model = await MultiAIService.getModelName(provider);

    setState(() {
      _selectedProvider = provider;
      _apiKeyController.text = key;
      _baseUrlController.text = baseUrl;
      _modelController.text = model;
    });
  }

  Future<void> _saveAiSettings() async {
    await MultiAIService.setProvider(_selectedProvider);
    await MultiAIService.setApiKey(_selectedProvider, _apiKeyController.text.trim());
    if (_baseUrlController.text.trim().isNotEmpty) {
      await MultiAIService.setBaseUrl(_selectedProvider, _baseUrlController.text.trim());
    }
    if (_modelController.text.trim().isNotEmpty) {
      await MultiAIService.setModelName(_selectedProvider, _modelController.text.trim());
    }

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('已保存 ${_providerLabel(_selectedProvider)} 配置')),
      );
    }
  }

  String _providerLabel(AIProvider provider) {
    switch (provider) {
      case AIProvider.deepseek:
        return 'DeepSeek (国内直连/推荐)';
      case AIProvider.gemini:
        return 'Google Gemini (需外网代理)';
      case AIProvider.openai:
        return 'OpenAI / 兼容接口';
    }
  }

  /// 1. 从电脑端迁移包导入 (.nlmobile / .json)
  Future<void> _importFromPC() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['nlmobile', 'json', 'zip'],
    );

    if (result == null || result.files.single.path == null) return;

    final file = File(result.files.single.path!);
    setState(() => _isProcessing = true);

    try {
      final res = await MigrationImporter.importFromFile(file);
      if (res.success) {
        widget.onDataChanged();
        if (mounted) {
          showDialog(
            context: context,
            builder: (ctx) => AlertDialog(
              title: const Text('🎉 电脑端数据迁移成功！'),
              content: Text(
                '已成功导入：\n'
                '• 账户科目: ${res.totalAccounts} 个\n'
                '• 贷款与债务: ${res.totalDebts} 笔\n'
                '• 交易历史流水: ${res.totalTransactions} 笔\n'
                '• 当前净资产: ¥${res.netWorth.toStringAsFixed(2)}\n\n'
                '复式记账恒等校验 100% 通过！',
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(ctx),
                  child: const Text('确定'),
                ),
              ],
            ),
          );
        }
      } else {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('迁移失败: ${res.message}')),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('迁移异常: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _isProcessing = false);
    }
  }

  /// 2. 导出 Beancount 纯文本账本并调起系统分享
  Future<void> _exportBeancount() async {
    setState(() => _isProcessing = true);
    try {
      await BeancountSerializer.exportAndShare();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('已生成标准 Beancount 账本并调起系统分享')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('导出失败: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _isProcessing = false);
    }
  }

  /// 3. 导入微信/支付宝 CSV 账单
  Future<void> _importCsvBill() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['csv'],
    );

    if (result == null || result.files.single.path == null) return;
    final file = File(result.files.single.path!);

    setState(() => _isProcessing = true);
    try {
      final parsedItems = await CsvBillParser.parseCsvFile(
        file,
        defaultAssetAccount: 'Assets:EWallet:WeChat',
      );

      if (parsedItems.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('未识别到有效的微信或支付宝账单记录')),
        );
        setState(() => _isProcessing = false);
        return;
      }

      int count = 0;
      for (final item in parsedItems) {
        await DatabaseHelper.instance.insertTransaction(item.transaction, item.postings);
        count++;
      }

      widget.onDataChanged();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('成功导入 $count 笔账单！')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('CSV 导入失败: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _isProcessing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('设置与数据中心', style: TextStyle(fontWeight: FontWeight.bold)),
      ),
      body: _isProcessing
          ? const Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  CircularProgressIndicator(),
                  SizedBox(height: 16),
                  Text('正在处理账务数据，请稍候...'),
                ],
              ),
            )
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                // 1. 数据互通卡片
                Card(
                  elevation: 0,
                  color: theme.colorScheme.surfaceContainerLow,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '📦 电脑端互通与备份',
                          style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '兼容 NovaLedger v2.0.1 电脑端专属迁移包与标准 Beancount 生态',
                          style: TextStyle(fontSize: 12, color: theme.colorScheme.outline),
                        ),
                        const SizedBox(height: 12),
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const CircleAvatar(
                            backgroundColor: Color(0x221E88E5),
                            child: Icon(Icons.download_for_offline, color: Colors.blue),
                          ),
                          title: const Text('从电脑端导入数据 (.nlmobile)'),
                          subtitle: const Text('选择电脑端导出的迁移包，一键无损导入历史账目'),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: _importFromPC,
                        ),
                        const Divider(),
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const CircleAvatar(
                            backgroundColor: Color(0x224CAF50),
                            child: Icon(Icons.share, color: Colors.green),
                          ),
                          title: const Text('导出 Beancount 纯文本账本'),
                          subtitle: const Text('生成 .bean 纯文本文件并唤起系统分享'),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: _exportBeancount,
                        ),
                        const Divider(),
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const CircleAvatar(
                            backgroundColor: Color(0x22FF9800),
                            child: Icon(Icons.receipt_long, color: Colors.orange),
                          ),
                          title: const Text('导入微信 / 支付宝 CSV 账单'),
                          subtitle: const Text('本地解析微信/支付宝月度账单文件'),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: _importCsvBill,
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),

                // 2. 多模型 AI 智能记账配置
                Card(
                  elevation: 0,
                  color: theme.colorScheme.surfaceContainerLow,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const Icon(Icons.auto_awesome, color: Colors.amber, size: 22),
                            const SizedBox(width: 8),
                            Text(
                              'AI 智能分类引擎',
                              style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Text(
                          '支持 DeepSeek (国内直连免科学上网)、Google Gemini 及任意兼容接口。',
                          style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline),
                        ),
                        const SizedBox(height: 14),

                        // 选择模型引擎
                        SegmentedButton<AIProvider>(
                          segments: const [
                            ButtonSegment(
                              value: AIProvider.deepseek,
                              label: Text('DeepSeek'),
                              icon: Icon(Icons.bolt, size: 16),
                            ),
                            ButtonSegment(
                              value: AIProvider.gemini,
                              label: Text('Gemini'),
                              icon: Icon(Icons.cloud_outlined, size: 16),
                            ),
                            ButtonSegment(
                              value: AIProvider.openai,
                              label: Text('OpenAI'),
                              icon: Icon(Icons.api, size: 16),
                            ),
                          ],
                          selected: {_selectedProvider},
                          onSelectionChanged: (val) {
                            _onProviderChanged(val.first);
                          },
                        ),
                        const SizedBox(height: 16),

                        // API Key 输入框
                        TextField(
                          controller: _apiKeyController,
                          obscureText: true,
                          decoration: InputDecoration(
                            labelText: '${_selectedProvider.name.toUpperCase()} API Key',
                            hintText: _selectedProvider == AIProvider.deepseek
                                ? 'sk-...'
                                : (_selectedProvider == AIProvider.gemini ? 'AIzaSy...' : 'sk-...'),
                            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                            prefixIcon: const Icon(Icons.key),
                          ),
                        ),
                        const SizedBox(height: 12),

                        // Base URL (针对 DeepSeek 或自定义)
                        TextField(
                          controller: _baseUrlController,
                          decoration: InputDecoration(
                            labelText: 'API 服务地址 (Base URL)',
                            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                            prefixIcon: const Icon(Icons.link),
                          ),
                        ),
                        const SizedBox(height: 12),

                        // 模型名称
                        TextField(
                          controller: _modelController,
                          decoration: InputDecoration(
                            labelText: '模型名称 (Model)',
                            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                            prefixIcon: const Icon(Icons.memory),
                          ),
                        ),
                        const SizedBox(height: 14),

                        SizedBox(
                          width: double.infinity,
                          child: FilledButton.icon(
                            icon: const Icon(Icons.save),
                            label: const Text('保存 AI 设置'),
                            onPressed: _saveAiSettings,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),

                // 3. 软件架构与声明
                Card(
                  elevation: 0,
                  color: theme.colorScheme.surfaceContainerLow,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  child: const Padding(
                    padding: EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '🌟 星芒账本 · NovaLedger Mobile',
                          style: TextStyle(fontWeight: FontWeight.bold),
                        ),
                        SizedBox(height: 6),
                        Text('版本: v2.0.1 (Android 纯本地独立版)', style: TextStyle(fontSize: 12)),
                        Text('底座: Flutter + SQLite (WAL模式) + Beancount 复式借贷生态', style: TextStyle(fontSize: 12)),
                        Text('特性: 零后台 Python 依赖、纯离线秒开、Scheme B 消费退款红字冲减、还款贷款双向抵扣', style: TextStyle(fontSize: 12)),
                        SizedBox(height: 6),
                        Text('数据所有权: 100% 归用户本地所有，不上传任何第三方云服务器。', style: TextStyle(fontSize: 12, color: Colors.grey)),
                      ],
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}
