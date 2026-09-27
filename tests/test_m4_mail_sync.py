import tempfile
import unittest
from pathlib import Path
from novaledger_free.core.config import ConfigManager
from novaledger_free.core.db import DatabaseManager
from novaledger_free.core.ledger import LedgerManager
from novaledger_free.core.security import SecurityManager
from novaledger_free.deduplication.engine import ImportPipelineEngine
from novaledger_free.mail_sync.imap_client import IMAPSyncClient
from novaledger_free.mail_sync.scheduler import MailSyncScheduler


class TestM4MailSync(unittest.TestCase):
    """M4 阶段测试：邮件同步游标检查点、全量补拉与后台调度器管理"""

    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.sandbox_path = Path(self.tmp_dir.name)

        self.cfg = ConfigManager(data_dir=self.sandbox_path)
        self.db = DatabaseManager(self.cfg.sqlite_db_path)
        self.sec = SecurityManager(self.sandbox_path / "secrets.json")
        self.ledger = LedgerManager(self.cfg, self.db)
        self.pipeline = ImportPipelineEngine(self.ledger, self.db)
        self.client = IMAPSyncClient(self.cfg, self.sec, self.pipeline)
        self.scheduler = MailSyncScheduler(self.client)

    def tearDown(self):
        self.scheduler.stop()
        self.tmp_dir.cleanup()

    def test_01_checkpoint_progression_and_dedup(self):
        """测试 UID 游标递增推进与重复邮件安全去重"""
        email_content_1 = (
            "From: cmb@cmbchina.com\r\n"
            "To: me@example.com\r\n"
            "Subject: 招商银行信用卡消费提醒\r\n"
            "Date: Wed, 03 Sep 2026 14:20:00 +0800\r\n\r\n"
            "您尾号7861的招行卡于09月03日14:20在星巴克咖啡完成消费人民币38.00元，详情请登录App查询。\r\n"
        ).encode("utf-8")

        email_content_2 = (
            "From: cmb@cmbchina.com\r\n"
            "To: me@example.com\r\n"
            "Subject: 招商银行信用卡消费提醒\r\n"
            "Date: Wed, 03 Sep 2026 19:30:00 +0800\r\n\r\n"
            "您尾号7861的招行卡于09月03日19:30在大董烤鸭店完成消费人民币288.00元，详情请登录App查询。\r\n"
        ).encode("utf-8")

        mock_batch_1 = [email_content_1, email_content_2]

        # 首次同步
        res1 = self.client.sync_emails(mock_messages=mock_batch_1)
        self.assertEqual(res1["status"], "success")
        self.assertEqual(res1["processed_count"], 2)
        self.assertEqual(self.cfg.config["mail_sync"]["last_seen_uid"], 2)

        # 账本记录确认
        txs = self.ledger.get_all_transactions()
        self.assertEqual(len(txs), 2)

        # 再次执行相同批次（模拟断网后重试）
        res2 = self.client.sync_emails(mock_messages=mock_batch_1)
        self.assertEqual(res2["status"], "success")
        # 由于指纹已存在，新增为0，重复为2
        self.assertEqual(res2["details"]["added"], 0)
        self.assertEqual(res2["details"]["duplicate"], 2)

    def test_02_scheduler_start_stop(self):
        """测试后台调度器启动与停止机制"""
        self.scheduler.start(interval_seconds=10)
        status = self.scheduler.get_status()
        self.assertTrue(status["is_running"])

        self.scheduler.stop()
        status_stopped = self.scheduler.get_status()
        self.assertFalse(status_stopped["is_running"])


if __name__ == "__main__":
    unittest.main()
