from decimal import Decimal
import tempfile
import unittest
from pathlib import Path

from novaledger_free.core.config import ConfigManager
from novaledger_free.core.db import DatabaseManager
from novaledger_free.core.ledger import LedgerManager
from novaledger_free.deduplication.engine import ImportPipelineEngine
from novaledger_free.parsers.alipay_csv import AlipayCSVParser
from novaledger_free.parsers.generic_csv import GenericCSVParser
from novaledger_free.parsers.wechat_csv import WeChatCSVParser


class TestM3ImportDedup(unittest.TestCase):
    """M3 阶段测试：微信/支付宝/通用导入、四态去重、待确认流转与批次撤销"""

    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.sandbox_path = Path(self.tmp_dir.name)

        self.cfg = ConfigManager(data_dir=self.sandbox_path)
        self.db = DatabaseManager(self.cfg.sqlite_db_path)
        self.ledger = LedgerManager(self.cfg, self.db)
        self.pipeline = ImportPipelineEngine(self.ledger, self.db)

        self.wechat_parser = WeChatCSVParser()
        self.alipay_parser = AlipayCSVParser()
        self.generic_parser = GenericCSVParser()

        self.bank = "Assets:Bank:Default:Card001"

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_01_wechat_import_and_deduplication(self):
        """测试微信账单解析、新增入账与二次导入完全去重"""
        wechat_sample = (
            "微信支付账单明细\n"
            "----------------------\n"
            "交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注\n"
            "2026-09-03 08:30:00,商户消费,瑞幸咖啡,生椰拿铁,支出,¥18.00,微信零钱,支付成功,10001001,M101,早餐\n"
            "2026-09-03 12:30:00,商户消费,便利蜂,便当便当,支出,¥25.50,微信零钱,支付成功,10001002,M102,午餐\n"
            "2026-09-03 15:00:00,商户消费,测试商家,退货退货,/,¥10.00,微信零钱,已退款,10001003,M103,退款单\n"
            "2026-09-03 18:00:00,商户消费,取消订单,未支付,支出,¥50.00,微信零钱,交易关闭,10001004,M104,取消\n"
        )
        sample_file = self.sandbox_path / "wechat_test.csv"
        sample_file.write_text(wechat_sample, encoding="utf-8")

        records = self.wechat_parser.parse_file(sample_file)
        self.assertEqual(len(records), 4)

        # 首次导入：应有 2 笔新增，1 笔进入待确认 (退款)，1 笔失败/关闭
        res1 = self.pipeline.process_records(records, "wechat_test.csv", self.bank)
        self.assertEqual(res1["added"], 2)
        self.assertEqual(res1["duplicate"], 0)
        self.assertEqual(res1["pending"], 1)
        self.assertEqual(res1["failed"], 1)

        # 二次导入相同文件：新增为 0，重复为 2！
        res2 = self.pipeline.process_records(records, "wechat_test.csv", self.bank)
        self.assertEqual(res2["added"], 0)
        self.assertEqual(res2["duplicate"], 2)

    def test_02_alipay_import_and_batch_rollback(self):
        """测试支付宝导入与整批一键撤销"""
        alipay_sample = (
            "支付宝交易记录明细查询\n"
            "-------------------------------------------------------------------------------------\n"
            "交易时间,交易来源地,交易对方,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注\n"
            "2026-09-04 10:00:00,其他,淘宝商家,手机壳,支出,29.90,余额宝,交易成功,20260904001,S001,数码配件\n"
            "2026-09-04 14:00:00,其他,喜茶,芝芝莓莓,支出,19.00,余额宝,交易成功,20260904002,S002,下午茶\n"
        )
        sample_file = self.sandbox_path / "alipay_test.csv"
        sample_file.write_text(alipay_sample, encoding="utf-8")

        records = self.alipay_parser.parse_file(sample_file)
        self.assertEqual(len(records), 2)

        res = self.pipeline.process_records(records, "alipay_test.csv", self.bank)
        self.assertEqual(res["added"], 2)
        batch_id = res["batch_id"]

        # 验证账本中有2笔交易
        txs_before = self.ledger.get_all_transactions()
        self.assertEqual(len(txs_before), 2)

        # 执行批次撤销
        rb_ok, rb_msg, count = self.pipeline.rollback_batch(batch_id)
        self.assertTrue(rb_ok, rb_msg)
        self.assertEqual(count, 2)

        # 撤销后账本变回 0 笔
        txs_after = self.ledger.get_all_transactions()
        self.assertEqual(len(txs_after), 0)

    def test_03_generic_csv_import(self):
        """测试通用自定义列映射 CSV 解析与导入"""
        generic_sample = (
            "Date,Description,Payee,Amount,RefNum\n"
            "2026-09-01,Office lunch,Subway,35.00,REF991\n"
            "2026-09-02,Book purchase,Amazon,88.50,REF992\n"
        )
        sample_file = self.sandbox_path / "custom.csv"
        sample_file.write_text(generic_sample, encoding="utf-8")

        col_map = {
            "date": "Date",
            "payee": "Payee",
            "narration": "Description",
            "amount": "Amount",
            "tx_id": "RefNum"
        }
        records = self.generic_parser.parse_file(sample_file, col_map)
        self.assertEqual(len(records), 2)

        res = self.pipeline.process_records(records, "custom.csv", self.bank)
        self.assertEqual(res["added"], 2)


if __name__ == "__main__":
    unittest.main()
