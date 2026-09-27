import csv
import io
from pathlib import Path
import tempfile
import unittest

from beancount import loader
from fastapi.testclient import TestClient

from novaledger_free.core.config import ConfigManager
from novaledger_free.core.db import DatabaseManager
from novaledger_free.core.ledger import LedgerManager
from novaledger_free.core.security import SecurityManager
from novaledger_free.deduplication.engine import ImportPipelineEngine
from novaledger_free.parsers.eml_parser import EMLParser
from novaledger_free.web.app import create_app


class TestM9V15BanksAndExport(unittest.TestCase):
    """v1.5 专项测试：国内 14 家主流银行邮件解析矩阵、样本测试器 API 与 .bean/.csv 导出"""

    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.sandbox_path = Path(self.tmp_dir.name)

        self.cfg = ConfigManager(data_dir=self.sandbox_path)
        self.db = DatabaseManager(self.cfg.sqlite_db_path)
        self.sec = SecurityManager(self.sandbox_path / "secrets.json")
        self.ledger = LedgerManager(self.cfg, self.db)
        self.pipeline = ImportPipelineEngine(self.ledger, self.db)
        self.parser = EMLParser()

        self.app = create_app(data_dir=self.sandbox_path)
        self.client = TestClient(self.app)

        st = self.client.get("/api/status", headers={"Host": "127.0.0.1"}).json()
        self.session_token = st["session_token"]
        self.bank = "Assets:Bank:Default:Card001"
        self.dining = "Expenses:Food:Dining"

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_01_fourteen_banks_email_parsing_accuracy(self):
        """测试国内 14 家主流银行通知句式与 HTML 表格解析，验证不误判为招行"""
        bank_samples = [
            # 六大国有行
            ("icbc", "工商银行", "webmaster@icbc.com.cn", "工行融e联提醒",
             "您尾号1101卡于09月16日12:30快捷支付人民币68.50元，对方为美团外卖，余额5,120.00元。【工商银行】",
             "支出", 68.50, False),
            ("abc", "农业银行", "e-mail@abchina.com", "中国农业银行交易通知",
             "尊敬的客户，您尾号2202的金穗卡于2026年09月16日08:15消费RMB 35.00元，商户名称：瑞幸咖啡。【农业银行】",
             "支出", 35.00, False),
            ("boc", "中国银行", "95566@bankofchina.com", "中国银行交易提醒",
             "您的中国银行信用卡(尾号3303)于2026-09-16 15:20在京东商城的退货人民币1,400.00元已入账。【中国银行】",
             "收入", 1400.00, True),
            ("ccb", "建设银行", "service@vip.ccb.com", "中国建设银行龙卡消费提醒",
             "您尾号4404的龙卡信用卡于09月16日19:10在【山姆会员商店】消费人民币1,268.00元。【建设银行】",
             "支出", 1268.00, False),
            ("bocom", "交通银行", "dcc@bankcomm.com", "交通银行买单吧消费提醒",
             "您尾号5505的交通银行信用卡于09月16日14:00于【盒马鲜生】扫码支付人民币215.80元。【交通银行】",
             "支出", 215.80, False),
            ("psbc", "邮储银行", "service@psbc.com", "邮储银行账户变动通知",
             "您尾号6606账户于09月16日10:00代发工资人民币15,800.00元，对方户名：星芒科技。【邮储银行】",
             "收入", 15800.00, False),
            # 八大股份行
            ("cmb", "招商银行", "ccsvc@cmbchina.com", "招商银行消费提醒",
             "您尾号7707的招行一卡通于09月16日09:30在星巴克咖啡快捷支付38.00元，余额2,000.00元。",
             "支出", 38.00, False),
            ("citic", "中信银行", "creditcard@citicbank.com", "中信银行动卡空间通知",
             "您尾号8808的中信卡于09月16日20:10在海底捞火锅完成消费人民币456.00元。【中信银行】",
             "支出", 456.00, False),
            ("spdb", "浦发银行", "service@spdb.com.cn", "浦发银行交易通知",
             "您尾号9909的浦发卡于09月16日11:40在拼多多完成快捷支付人民币99.90元。【浦发银行】",
             "支出", 99.90, False),
            ("cgb", "广发银行", "creditcard@cgbchina.com.cn", "广发卡交易提醒",
             "您尾号1010广发卡于09月16日16:05在滴滴出行消费人民币42.50元。【广发银行】",
             "支出", 42.50, False),
            ("pab", "平安银行", "bank@pingan.com.cn", "平安口袋银行提醒",
             "您尾号1212的平安信用卡于09月16日13:20在麦当劳消费人民币55.00元。【平安银行】",
             "支出", 55.00, False),
            ("cib", "兴业银行", "95561@cib.com.cn", "兴业银行好兴动提醒",
             "您尾号1313兴业卡于09月16日17:30在网上支付人民币189.00元，商户为网易严选。【兴业银行】",
             "支出", 189.00, False),
            ("cmbc", "民生银行", "service@cmbc.com.cn", "民生银行交易通知",
             "您尾号1414民生卡于09月16日21:00消费人民币320.00元，对方为沃尔玛超市。【民生银行】",
             "支出", 320.00, False),
            ("ceb", "光大银行", "cebbank@cebbank.com", "光大银行阳光惠生活提醒",
             "您尾号1515的光大信用卡于09月16日18:00在喜茶消费人民币29.00元。【光大银行】",
             "支出", 29.00, False),
        ]

        for exp_code, exp_name, sender, subj, body, exp_dir, exp_amt, exp_refund in bank_samples:
            res = self.parser.parse_sample_text(body, subject=subj, sender=sender, use_ai_fallback=False)
            self.assertTrue(res["success"], f"{exp_name} 解析失败: {res}")
            self.assertEqual(res["bank_code"], exp_code, f"{exp_name} 银行代码误判: {res}")
            self.assertEqual(res["bank_name"], exp_name)
            rec = res["records"][0]
            self.assertEqual(rec["direction"], exp_dir)
            self.assertAlmostEqual(rec["amount"], exp_amt)
            self.assertEqual(rec["is_refund"], exp_refund)

    def test_02_html_table_statement_and_sample_api(self):
        """测试 HTML 电子账单多行表格解析与 /api/mail_sync/parse_sample 接口"""
        html_sample = """
        <html><body>
        <p>尊敬的浦发信用卡客户，您的电子账单明细如下：</p>
        <table>
          <tr><th>交易日期</th><th>卡号末四位</th><th>交易摘要</th><th>交易金额</th></tr>
          <tr><td>2026-09-14</td><td>6612</td><td>星巴克咖啡</td><td>CNY 38.00</td></tr>
          <tr><td>2026-09-15</td><td>6612</td><td>山姆会员商店</td><td>1,250.00</td></tr>
          <tr><td>2026-09-16</td><td>6612</td><td>Apple Store 退货</td><td>-899.00</td></tr>
        </table>
        </body></html>
        """
        resp = self.client.post(
            "/api/mail_sync/parse_sample",
            headers={"Host": "127.0.0.1", "x-session-token": self.session_token},
            json={
                "subject": "浦发银行信用卡电子账单",
                "sender": "service@spdbccc.com.cn",
                "body": html_sample,
                "use_ai_fallback": False
            }
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["bank_code"], "spdb")
        self.assertEqual(data["engine"], "builtin_html_table")
        self.assertEqual(len(data["records"]), 3)
        self.assertAlmostEqual(data["records"][1]["amount"], 1250.00)
        self.assertTrue(data["records"][2]["is_refund"])
        self.assertAlmostEqual(data["records"][2]["amount"], 899.00)

    def test_03_export_single_beancount_and_excel_csv(self):
        """测试导出合并单文件 .bean (通过 Beancount 严格校验) 与 UTF-8-BOM .csv"""
        # 1. 创建一笔日常消费与一笔红字退款冲减
        self.client.post(
            "/api/transactions",
            headers={"Host": "127.0.0.1", "x-session-token": self.session_token},
            json={
                "date": "2026-09-15",
                "type": "expense",
                "is_offset": False,
                "amount": 300.00,
                "account": self.bank,
                "category": self.dining,
                "payee": "海底捞火锅",
                "narration": "周末聚餐"
            }
        )
        self.client.post(
            "/api/transactions",
            headers={"Host": "127.0.0.1", "x-session-token": self.session_token},
            json={
                "date": "2026-09-16",
                "type": "expense",
                "is_offset": True,
                "amount": 50.00,
                "account": self.bank,
                "category": self.dining,
                "payee": "海底捞火锅",
                "narration": "菜品退差价"
            }
        )

        # 2. 导出单文件 .bean 并使用 Beancount 官方加载器验证 0 错误
        resp_bean = self.client.get("/api/backup/export_bean", headers={"Host": "127.0.0.1"})
        self.assertEqual(resp_bean.status_code, 200)
        bean_text = resp_bean.content.decode("utf-8")
        self.assertIn('option "operating_currency" "CNY"', bean_text)
        self.assertIn("海底捞火锅", bean_text)
        entries, errors, _ = loader.load_string(bean_text)
        self.assertEqual(len(errors), 0, f"导出的单文件 .bean 校验存在错误: {errors}")
        self.assertGreaterEqual(len(entries), 15)

        # 3. 导出 Excel .csv 并验证 UTF-8-BOM 头部与数据列
        resp_csv = self.client.get("/api/backup/export_csv", headers={"Host": "127.0.0.1"})
        self.assertEqual(resp_csv.status_code, 200)
        raw_csv_bytes = resp_csv.content
        # 必须包含 UTF-8 BOM (\xef\xbb\xbf) 以保证 Windows Excel 双击不乱码
        self.assertTrue(raw_csv_bytes.startswith(b"\xef\xbb\xbf"))

        csv_text = raw_csv_bytes.decode("utf-8-sig")
        reader = list(csv.reader(io.StringIO(csv_text)))
        self.assertEqual(len(reader), 3)  # 1 表头 + 2 笔交易
        header = reader[0]
        self.assertIn("是否冲减(红字)", header)
        self.assertIn("金额(CNY)", header)

        normal_row = next(r for r in reader[1:] if "周末聚餐" in r[5])
        offset_row = next(r for r in reader[1:] if "菜品退差价" in r[5])
        self.assertEqual(normal_row[2], "日常支出")
        self.assertEqual(normal_row[3], "否")
        self.assertEqual(normal_row[6], "300.00")

        self.assertEqual(offset_row[2], "支出冲减(退款)")
        self.assertEqual(offset_row[3], "是")
        self.assertEqual(offset_row[6], "50.00")


if __name__ == "__main__":
    unittest.main()
