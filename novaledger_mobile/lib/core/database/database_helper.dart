import 'dart:async';
import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';
import '../models/account.dart';
import '../models/category.dart';
import '../models/debt.dart';
import '../models/posting.dart';
import '../models/transaction_item.dart';

class DatabaseHelper {
  static final DatabaseHelper instance = DatabaseHelper._init();
  static Database? _database;

  DatabaseHelper._init();

  Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDB('novaledger.db');
    return _database!;
  }

  Future<Database> _initDB(String filePath) async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, filePath);

    return await openDatabase(
      path,
      version: 1,
      onCreate: _createDB,
    );
  }

  Future<void> _createDB(Database db, int version) async {
    await db.execute('''
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        beancount_account TEXT NOT NULL UNIQUE,
        card_tail TEXT,
        initial_balance REAL DEFAULT 0.0,
        current_balance REAL DEFAULT 0.0,
        is_archived INTEGER DEFAULT 0
      )
    ''');

    await db.execute('''
      CREATE TABLE debts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        beancount_account TEXT NOT NULL,
        initial_amount REAL NOT NULL,
        remaining_amount REAL NOT NULL,
        type TEXT NOT NULL,
        due_date TEXT,
        monthly_payment REAL,
        note TEXT
      )
    ''');

    await db.execute('''
      CREATE TABLE categories (
        key TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        parent_key TEXT,
        icon TEXT,
        color TEXT,
        type TEXT NOT NULL
      )
    ''');

    await db.execute('''
      CREATE TABLE transactions (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        payee TEXT,
        narration TEXT,
        status TEXT DEFAULT 'cleared',
        source_type TEXT DEFAULT 'manual',
        source_tx_id TEXT,
        source_fingerprint TEXT,
        import_batch TEXT,
        is_offset INTEGER DEFAULT 0,
        is_new INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      )
    ''');


    await db.execute('''
      CREATE TABLE postings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id TEXT NOT NULL,
        account TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'CNY',
        FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE CASCADE
      )
    ''');

    await db.execute('''
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    ''');

    await db.execute('CREATE INDEX idx_tx_date ON transactions(date)');
    await db.execute('CREATE INDEX idx_posting_tx ON postings(transaction_id)');
    await db.execute('CREATE INDEX idx_posting_account ON postings(account)');
  }

  // --------------------------------------------------------------------------
  // 账户操作
  // --------------------------------------------------------------------------
  Future<List<Account>> getAccounts({bool includeArchived = false}) async {
    final db = await database;
    final where = includeArchived ? null : 'is_archived = 0';
    final maps = await db.query('accounts', where: where, orderBy: 'type, name');
    return maps.map((e) => Account.fromMap(e)).toList();
  }

  Future<void> upsertAccount(Account account) async {
    final db = await database;
    await db.insert('accounts', account.toMap(), conflictAlgorithm: ConflictAlgorithm.replace);
  }

  // --------------------------------------------------------------------------
  // 债务操作
  // --------------------------------------------------------------------------
  Future<List<Debt>> getDebts() async {
    final db = await database;
    final maps = await db.query('debts', orderBy: 'due_date, name');
    return maps.map((e) => Debt.fromMap(e)).toList();
  }

  Future<void> upsertDebt(Debt debt) async {
    final db = await database;
    await db.insert('debts', debt.toMap(), conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<void> reduceDebtRemaining(String debtAccount, double amount) async {
    final db = await database;
    final debts = await db.query('debts', where: 'beancount_account = ?', whereArgs: [debtAccount]);
    if (debts.isNotEmpty) {
      final curRemaining = (debts.first['remaining_amount'] as num?)?.toDouble() ?? 0.0;
      final newRemaining = (curRemaining - amount).clamp(0.0, double.infinity);
      await db.update(
        'debts',
        {'remaining_amount': newRemaining},
        where: 'beancount_account = ?',
        whereArgs: [debtAccount],
      );
    }
  }

  Future<void> dismissAllNewDots() async {
    final db = await database;
    await db.update('transactions', {'is_new': 0}, where: 'is_new = 1');
  }


  // --------------------------------------------------------------------------
  // 分类操作
  // --------------------------------------------------------------------------
  Future<List<Category>> getCategories() async {
    final db = await database;
    final maps = await db.query('categories', orderBy: 'type, name');
    return maps.map((e) => Category.fromMap(e)).toList();
  }

  Future<void> upsertCategory(Category category) async {
    final db = await database;
    await db.insert('categories', category.toMap(), conflictAlgorithm: ConflictAlgorithm.replace);
  }

  // --------------------------------------------------------------------------
  // 交易操作 (复式借贷平衡校验)
  // --------------------------------------------------------------------------
  Future<bool> insertTransaction(TransactionItem tx, List<Posting> postings) async {
    // 严格检查借贷平衡 (代数和为 0)
    final sum = postings.fold<double>(0.0, (acc, p) => acc + p.amount);
    if (sum.abs() >= 0.005) {
      throw Exception('借贷不平衡: 借贷代数和差额为 $sum，无法入库');
    }

    final db = await database;
    await db.transaction((txn) async {
      await txn.insert('transactions', tx.toMap(), conflictAlgorithm: ConflictAlgorithm.replace);
      for (final p in postings) {
        await txn.insert('postings', p.toMap());
      }
    });
    return true;
  }

  Future<void> deleteTransaction(String txId) async {
    final db = await database;
    await db.transaction((txn) async {
      await txn.delete('postings', where: 'transaction_id = ?', whereArgs: [txId]);
      await txn.delete('transactions', where: 'id = ?', whereArgs: [txId]);
    });
  }

  Future<List<TransactionItem>> getTransactions({
    String? query,
    String? month,
    String? account,
    int limit = 100,
    int offset = 0,
  }) async {
    final db = await database;
    String whereClause = '';
    List<dynamic> whereArgs = [];

    if (month != null && month.isNotEmpty) {
      whereClause += 'date LIKE ?';
      whereArgs.add('$month%');
    }

    if (query != null && query.isNotEmpty) {
      if (whereClause.isNotEmpty) whereClause += ' AND ';
      whereClause += '(payee LIKE ? OR narration LIKE ?)';
      whereArgs.addAll(['%$query%', '%$query%']);
    }

    final txMaps = await db.query(
      'transactions',
      where: whereClause.isEmpty ? null : whereClause,
      whereArgs: whereArgs.isEmpty ? null : whereArgs,
      orderBy: 'date DESC, created_at DESC',
      limit: limit,
      offset: offset,
    );

    final List<TransactionItem> result = [];
    for (final map in txMaps) {
      final txId = map['id'] as String;
      final postingMaps = await db.query('postings', where: 'transaction_id = ?', whereArgs: [txId]);
      final postings = postingMaps.map((e) => Posting.fromMap(e)).toList();

      if (account != null && account.isNotEmpty) {
        final matches = postings.any((p) => p.account == account);
        if (!matches) continue;
      }

      result.add(TransactionItem.fromMap(map, postings: postings));
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // 财务统计与资产负债计算
  // --------------------------------------------------------------------------
  Future<Map<String, dynamic>> calculateBalances() async {
    final db = await database;
    final postingRows = await db.rawQuery('''
      SELECT account, SUM(amount) as balance
      FROM postings
      GROUP BY account
    ''');

    double totalAssets = 0.0;
    double totalLiabilities = 0.0;
    final Map<String, double> accountBalances = {};

    for (final row in postingRows) {
      final acc = row['account'] as String;
      final bal = (row['balance'] as num?)?.toDouble() ?? 0.0;
      accountBalances[acc] = bal;

      if (acc.startsWith('Assets:')) {
        totalAssets += bal;
      } else if (acc.startsWith('Liabilities:')) {
        // 负债在复式记账中贷记为负，取绝对值
        totalLiabilities += (-bal);
      }
    }

    final netWorth = totalAssets - totalLiabilities;

    return {
      'total_assets': totalAssets,
      'total_liabilities': totalLiabilities,
      'net_worth': netWorth,
      'account_balances': accountBalances,
    };
  }

  Future<Map<String, dynamic>> getMonthlySummary(String month) async {
    final db = await database;
    final rows = await db.rawQuery('''
      SELECT p.account, SUM(p.amount) as total
      FROM postings p
      JOIN transactions t ON p.transaction_id = t.id
      WHERE t.date LIKE ?
      GROUP BY p.account
    ''', ['$month%']);

    double totalIncome = 0.0;
    double totalExpenses = 0.0;
    final Map<String, double> categoryBreakdown = {};

    for (final r in rows) {
      final acc = r['account'] as String;
      final amt = (r['total'] as num?)?.toDouble() ?? 0.0;

      if (acc.startsWith('Income:')) {
        totalIncome += (-amt);
      } else if (acc.startsWith('Expenses:')) {
        totalExpenses += amt;
        categoryBreakdown[acc] = amt;
      }
    }

    final surplus = totalIncome - totalExpenses;
    final savingsRate = totalIncome > 0 ? (surplus / totalIncome * 100) : 0.0;

    return {
      'total_income': totalIncome,
      'total_expenses': totalExpenses,
      'surplus': surplus,
      'savings_rate': savingsRate,
      'categories': categoryBreakdown,
    };
  }

  // --------------------------------------------------------------------------
  // 设置存储
  // --------------------------------------------------------------------------
  Future<String?> getSetting(String key) async {
    final db = await database;
    final res = await db.query('settings', where: 'key = ?', whereArgs: [key], limit: 1);
    if (res.isNotEmpty) return res.first['value'] as String;
    return null;
  }

  Future<void> setSetting(String key, String value) async {
    final db = await database;
    await db.insert('settings', {'key': key, 'value': value}, conflictAlgorithm: ConflictAlgorithm.replace);
  }
}
