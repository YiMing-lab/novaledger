import tempfile
import unittest
from pathlib import Path

from novaledger_free.core.config import ConfigManager
from novaledger_free.core.db import DatabaseManager
from novaledger_free.core.ledger import LedgerManager
from novaledger_free.migration.backup_restore import BackupRestoreManager
from novaledger_free.migration.legacy_migrator import LegacyMigrator


class TestM6BackupMigr(unittest.TestCase):
    """M6 阶段测试：旧版无损迁移、全量快照备份与沙箱校验灾难恢复"""

    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.sandbox_path = Path(self.tmp_dir.name)

        self.cfg = ConfigManager(data_dir=self.sandbox_path)
        self.db = DatabaseManager(self.cfg.sqlite_db_path)
        self.ledger = LedgerManager(self.cfg, self.db)
        self.bm = BackupRestoreManager(self.cfg, self.ledger)
        self.migrator = LegacyMigrator(self.ledger)

        self.bank = "Assets:Bank:Default:Card001"
        self.dining = "Expenses:Food:Dining"

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_01_backup_and_restore_sandbox(self):
        """测试全量备份包生成与沙箱校验恢复"""
        # 1. 记入一笔初始交易
        ok, _, _ = self.ledger.append_transaction(
            "2026-09-01", "初始记录", "测试备份前",
            [(self.dining, 66.00, "CNY"), (self.bank, -66.00, "CNY")]
        )
        self.assertTrue(ok)
        self.assertEqual(len(self.ledger.get_all_transactions()), 1)

        # 2. 生成快照备份
        backup_file = self.bm.create_backup()
        self.assertTrue(backup_file.exists())

        # 3. 产生后续变更（记入第二笔交易）
        self.ledger.append_transaction(
            "2026-09-02", "第二笔", "测试后续",
            [(self.dining, 33.00, "CNY"), (self.bank, -33.00, "CNY")]
        )
        self.assertEqual(len(self.ledger.get_all_transactions()), 2)

        # 4. 从快照恢复
        restore_ok, restore_msg = self.bm.restore_backup(backup_file)
        self.assertTrue(restore_ok, restore_msg)

        # 恢复后交易数量应精准回到 1 笔
        txs_restored = self.ledger.get_all_transactions()
        self.assertEqual(len(txs_restored), 1)
        self.assertEqual(txs_restored[0]["payee"], "初始记录")

    def test_02_corrupted_backup_safely_rejected(self):
        """测试损坏或非法语法的备份文件在沙箱中被拒绝，绝不破坏当前真实数据"""
        # 当前有1笔交易
        self.ledger.append_transaction(
            "2026-09-01", "安全测试", "有效交易",
            [(self.dining, 50.00, "CNY"), (self.bank, -50.00, "CNY")]
        )

        # 构造损坏的假备份
        bad_file = self.sandbox_path / "corrupted.nlbackup"
        bad_file.write_bytes(b"NOT_A_VALID_ZIP_HEADER")

        restore_ok, restore_msg = self.bm.restore_backup(bad_file)
        self.assertFalse(restore_ok)
        self.assertIn("损坏", restore_msg)

        # 当前数据完好无损
        txs = self.ledger.get_all_transactions()
        self.assertEqual(len(txs), 1)

    def test_03_legacy_migration(self):
        """测试从旧版目录导入迁移"""
        legacy_dir = self.sandbox_path / "legacy_source"
        (legacy_dir / "ledger").mkdir(parents=True)

        legacy_content = (
            'option "title" "Legacy"\n'
            'option "operating_currency" "CNY"\n'
            '2020-01-01 open Assets:Bank:CMB CNY\n'
            '2020-01-01 open Expenses:Food CNY\n\n'
            '2026-08-15 * "Old Merchant" "Lunch"\n'
            '  Expenses:Food  30.00 CNY\n'
            '  Assets:Bank:CMB  -30.00 CNY\n'
        )
        (legacy_dir / "ledger" / "main.bean").write_text(legacy_content, encoding="utf-8")

        # 确立目标账本中具备相应科目
        with open(self.cfg.accounts_bean, "a", encoding="utf-8") as f:
            f.write("2020-01-01 open Assets:Bank:CMB CNY\n2020-01-01 open Expenses:Food CNY\n")

        res = self.migrator.inspect_and_migrate(legacy_dir)
        self.assertTrue(res["success"])
        self.assertEqual(res["report"]["migrated_count"], 1)

        txs = self.ledger.get_all_transactions()
        self.assertEqual(len(txs), 1)
        self.assertEqual(txs[0]["payee"], "Old Merchant")


if __name__ == "__main__":
    unittest.main()
