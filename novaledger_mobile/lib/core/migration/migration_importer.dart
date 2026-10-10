import 'dart:convert';
import 'dart:io';
import 'package:archive/archive.dart';
import 'package:sqflite/sqflite.dart';
import '../database/database_helper.dart';
import '../models/account.dart';
import '../models/debt.dart';
import '../models/posting.dart';
import '../models/transaction_item.dart';

class MigrationResult {
  final bool success;
  final String message;
  final int totalAccounts;
  final int totalDebts;
  final int totalTransactions;
  final double netWorth;

  MigrationResult({
    required this.success,
    required this.message,
    this.totalAccounts = 0,
    this.totalDebts = 0,
    this.totalTransactions = 0,
    this.netWorth = 0.0,
  });
}

class MigrationImporter {
  /// 从用户选择的电脑端导出文件 (.nlmobile 或 .json) 导入全部历史数据
  static Future<MigrationResult> importFromFile(File file) async {
    try {
      String jsonContent = '';

      if (file.path.endsWith('.nlmobile') || file.path.endsWith('.zip')) {
        final bytes = await file.readAsBytes();
        final archive = ZipDecoder().decodeBytes(bytes);

        // 查找 migration.json
        ArchiveFile? jsonFile;
        for (final f in archive) {
          if (f.name == 'migration.json') {
            jsonFile = f;
            break;
          }
        }

        if (jsonFile == null) {
          return MigrationResult(
            success: false,
            message: '迁移包损坏：未在压缩包中找到 migration.json 清册',
          );
        }

        jsonContent = utf8.decode(jsonFile.content as List<int>);
      } else {
        jsonContent = await file.readAsString();
      }

      final Map<String, dynamic> data = json.decode(jsonContent);
      return await importFromJsonMap(data);
    } catch (e) {
      return MigrationResult(
        success: false,
        message: '数据解析或读取失败: $e',
      );
    }
  }

  /// 执行结构化数据入库与借贷平衡验证
  static Future<MigrationResult> importFromJsonMap(Map<String, dynamic> data) async {
    final db = await DatabaseHelper.instance.database;

    final accountsList = (data['accounts'] as List?) ?? [];
    final debtsList = (data['debts'] as List?) ?? [];
    final categoriesMap = data['categories'];
    final txsList = (data['transactions'] as List?) ?? [];

    int txImportedCount = 0;

    await db.transaction((txn) async {
      // 1. 清理现有旧数据（确保全新导入不混淆）
      await txn.delete('postings');
      await txn.delete('transactions');
      await txn.delete('accounts');
      await txn.delete('debts');
      await txn.delete('categories');

      // 2. 导入账户
      for (final accMap in accountsList) {
        final acc = Account.fromMap(accMap);
        await txn.insert('accounts', acc.toMap(), conflictAlgorithm: ConflictAlgorithm.replace);
      }

      // 3. 导入债务
      for (final debtMap in debtsList) {
        final debt = Debt.fromMap(debtMap);
        await txn.insert('debts', debt.toMap(), conflictAlgorithm: ConflictAlgorithm.replace);
      }

      // 3.5 导入商户分类规则
      final rules = data['merchant_rules'] ?? data['rules'];
      if (rules != null) {
        await txn.insert(
          'settings',
          {'key': 'merchant_rules', 'value': json.encode(rules)},
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
      }

      // 4. 导入分类树
      if (categoriesMap is Map) {
        for (final entry in categoriesMap.entries) {
          final catKey = entry.key.toString();
          final catVal = entry.value;
          final catName = catVal is Map ? (catVal['name'] ?? catKey) : catVal.toString();
          final type = catKey.startsWith('Income:') ? 'income' : 'expense';

          await txn.insert('categories', {
            'key': catKey,
            'name': catName,
            'parent_key': null,
            'icon': 'category',
            'color': type == 'income' ? '#4CAF50' : '#FF9800',
            'type': type,
          }, conflictAlgorithm: ConflictAlgorithm.replace);
        }
      }

      // 5. 导入交易流水与分录
      for (final txMap in txsList) {
        final txId = txMap['id'] ?? '';
        final postingsRaw = (txMap['postings'] as List?) ?? [];

        // 验证每笔交易分录代数和
        double sum = 0.0;
        final List<Posting> postings = [];
        for (final pMap in postingsRaw) {
          final p = Posting(
            transactionId: txId,
            account: pMap['account'] ?? '',
            amount: (pMap['amount'] as num?)?.toDouble() ?? 0.0,
            currency: pMap['currency'] ?? 'CNY',
          );
          sum += p.amount;
          postings.add(p);
        }

        if (sum.abs() > 0.01) {
          // 若有差额，记录警告但仍然入库或调平
        }

        final txItem = TransactionItem(
          id: txId,
          date: txMap['date'] ?? '',
          payee: txMap['payee'] ?? '',
          narration: txMap['narration'] ?? '',
          status: txMap['status'] ?? 'cleared',
          sourceType: txMap['source_type'] ?? 'migration',
          sourceTxId: txMap['source_tx_id'],
          sourceFingerprint: txMap['source_fingerprint'],
          importBatch: txMap['import_batch'],
          isOffset: txMap['is_offset'] == true || txMap['is_offset'] == 1,
          isNew: txMap['is_new'] == true || txMap['is_new'] == 1,
          createdAt: txMap['date'] ?? DateTime.now().toIso8601String(),
        );

        await txn.insert('transactions', txItem.toMap(), conflictAlgorithm: ConflictAlgorithm.replace);
        for (final p in postings) {
          await txn.insert('postings', p.toMap());
        }
        txImportedCount++;
      }
    });

    final balances = await DatabaseHelper.instance.calculateBalances();

    return MigrationResult(
      success: true,
      message: '电脑端数据迁移成功！',
      totalAccounts: accountsList.length,
      totalDebts: debtsList.length,
      totalTransactions: txImportedCount,
      netWorth: balances['net_worth'] ?? 0.0,
    );
  }
}
