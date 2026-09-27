from decimal import Decimal
import tempfile
import unittest
from pathlib import Path

from beancount import loader
from beancount.core.data import Transaction

from novaledger_free.core.config import ConfigManager
from novaledger_free.core.db import DatabaseManager
from novaledger_free.core.journal import JournalManager
from novaledger_free.core.ledger import LedgerManager
from novaledger_free.core.models import SourceType
from novaledger_free.core.security import SecurityManager


class TestM0M1Baseline(unittest.TestCase):
    """M0 与 M1 基线回归测试：彻底验证并消除审查报告中复现的 7 大缺陷及原子性"""

    def setUp(self):
        # 严格使用独立的临时目录沙箱，100% 隔离真实数据
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.sandbox_path = Path(self.tmp_dir.name)
        
        self.cfg = ConfigManager(data_dir=self.sandbox_path)
        self.db = DatabaseManager(self.cfg.sqlite_db_path)
        self.sec = SecurityManager(self.sandbox_path / "secrets.json")
        self.ledger = LedgerManager(self.cfg, self.db)
        self.journal = JournalManager(self.ledger, self.db)

        self.bank = "Assets:Bank:Default:Card001"
        self.expense = "Expenses:Food:Dining"

    def tearDown(self):
        self.tmp_dir.cleanup()

    def count_transactions(self) -> int:
        entries, errors, _ = loader.load_file(str(self.cfg.main_bean))
        self.assertEqual(len(errors), 0, f"账本加载出现意外错误: {errors}")
        return sum(1 for e in entries if isinstance(e, Transaction))

    def test_01_same_day_real_purchases(self):
        """复现缺陷1：同一天同商户两次20元消费，两者均应作为独立交易完整保留"""
        ok1, msg1, _ = self.ledger.append_transaction(
            tx_date="2026-09-03", payee="Coffee", narration="morning",
            postings=[(self.expense, 20.00, "CNY"), (self.bank, -20.00, "CNY")]
        )
        ok2, msg2, _ = self.ledger.append_transaction(
            tx_date="2026-09-03", payee="Coffee", narration="afternoon",
            postings=[(self.expense, 20.00, "CNY"), (self.bank, -20.00, "CNY")]
        )
        self.assertTrue(ok1, f"第一笔应成功: {msg1}")
        self.assertTrue(ok2, f"第二笔应成功: {msg2}")
        self.assertEqual(self.count_transactions(), 2, "两笔真实独立消费应全部记录到 Beancount 中")

    def test_02_unrelated_amount_no_skip(self):
        """复现缺陷2：禁止在整份文本中交叉模糊匹配，Coffee 20 与 Other 30 不会导致 Coffee 30 被跳过"""
        self.ledger.append_transaction("2026-09-02", "Other", "store", [(self.expense, 30.00, "CNY"), (self.bank, -30.00, "CNY")])
        self.ledger.append_transaction("2026-09-03", "Coffee", "cup1", [(self.expense, 20.00, "CNY"), (self.bank, -20.00, "CNY")])
        ok, msg, _ = self.ledger.append_transaction("2026-09-03", "Coffee", "cup2", [(self.expense, 30.00, "CNY"), (self.bank, -30.00, "CNY")])
        
        self.assertTrue(ok, f"Coffee 30 必须成功追加: {msg}")
        self.assertEqual(self.count_transactions(), 3, "三笔交易均应准确存在")

    def test_03_quote_and_special_chars_safe(self):
        """复现缺陷3：商户名称含有英文双引号与特殊字符时，安全转义，账本校验 100% 通过"""
        ok, msg, _ = self.ledger.append_transaction(
            tx_date="2026-09-03", payee='Cafe "A"', narration='Special "Quote" Narration',
            postings=[(self.expense, 15.50, "CNY"), (self.bank, -15.50, "CNY")]
        )
        self.assertTrue(ok, msg)
        valid, errors = self.ledger.validate_ledger()
        self.assertTrue(valid, f"含双引号账本必须校验合法: {errors}")

    def test_04_hide_debt_preserves_net_worth(self):
        """复现缺陷4：UI显示开关绝对不能改变底层会计真实事实"""
        self.ledger.append_transaction("2026-09-01", "Opening", "Initial", [(self.bank, 1000.00, "CNY"), ("Equity:Opening-Balances", -1000.00, "CNY")])
        loan_acc = "Liabilities:CreditCard:Default:Card001"
        self.ledger.append_transaction("2026-09-01", "Loan", "Borrow", [(self.bank, 200.00, "CNY"), (loan_acc, -200.00, "CNY")])
        
        # 此时资产: 1200, 负债: 200, 净资产: 1000
        bal1 = self.ledger.get_balances()
        self.assertEqual(bal1["total_assets"], 1200.0)
        self.assertEqual(bal1["total_liabilities"], 200.0)
        self.assertEqual(bal1["net_worth"], 1000.0)

        # 模拟关闭 UI 负债模块开关
        self.cfg.config["system"]["enable_debt_module"] = False
        bal2 = self.ledger.get_balances()
        self.assertEqual(bal1["net_worth"], bal2["net_worth"], "显示开关变更绝不能导致净资产发生变化")
        self.assertEqual(bal2["total_liabilities"], 200.0)

    def test_05_savings_calculation_no_double_count(self):
        """复现缺陷5：内部投资划转属于资产重配置，不得造成储蓄被二次重复计算"""
        # 开启投资账户
        with open(self.cfg.accounts_bean, "a", encoding="utf-8") as f:
            f.write("2020-01-01 open Assets:Invest:Broker CNY\n")
        
        # 工资 1000，转入投资 500，无消费
        self.ledger.append_transaction("2026-09-01", "Salary", "Payday", [(self.bank, 1000.00, "CNY"), ("Income:Salary", -1000.00, "CNY")])
        self.ledger.append_transaction("2026-09-02", "Transfer", "Invest", [("Assets:Invest:Broker", 500.00, "CNY"), (self.bank, -500.00, "CNY")])

        rep = self.ledger.get_financial_reports("2026-09")
        # 储蓄金额应严格等于 1000 (收入 1000 - 支出 0)
        self.assertEqual(rep["needs_wants_savings"]["savings_amount"], 1000.0)
        self.assertEqual(rep["income_statement"]["total_expenses"], 0.0)

    def test_06_past_month_balance_cutoff(self):
        """复现缺陷6：历史月报表必须严格以指定月末截止日计算，未来月份交易不得渗入"""
        # 9月份发生交易
        self.ledger.append_transaction("2026-09-01", "Salary", "", [(self.bank, 500.00, "CNY"), ("Income:Salary", -500.00, "CNY")])
        
        # 查询8月份报告，资产负债表总资产必须为 0
        rep_aug = self.ledger.get_financial_reports("2026-08")
        self.assertEqual(rep_aug["balance_sheet"]["total_assets"], 0.0)
        self.assertEqual(rep_aug["balance_sheet"]["net_worth"], 0.0)

        # 查询9月份报告，总资产为 500
        rep_sep = self.ledger.get_financial_reports("2026-09")
        self.assertEqual(rep_sep["balance_sheet"]["total_assets"], 500.0)

    def test_07_unauthenticated_config_secrets(self):
        """复现缺陷7：对外凭据配置输出仅提供脱敏掩码，绝不明文泄露"""
        self.sec.save_credential("gemini_api_key", "AIzaSySecret123456789")
        self.sec.save_credential("email_auth_code", "VerySecretPassword123")

        status = self.sec.get_credentials_status()
        self.assertTrue(status["gemini_api_key"]["configured"])
        self.assertTrue(status["email_auth_code"]["configured"])

        masked_key = status["gemini_api_key"]["masked"]
        masked_mail = status["email_auth_code"]["masked"]

        self.assertNotIn("AIzaSySecret123456789", masked_key)
        self.assertIn("AIz", masked_key)
        self.assertIn("89", masked_key)
        self.assertNotIn("VerySecretPassword123", masked_mail)

    def test_08_atomic_candidate_rejection(self):
        """测试写入前候选账本校验与原子排他：非法分录直接被拒，账本完好"""
        # 构造未开户非法科目
        ok, msg, _ = self.ledger.append_transaction(
            tx_date="2026-09-03", payee="Bad", narration="",
            postings=[("Assets:NonExistentAccount:Card999", 50.00, "CNY"), (self.bank, -50.00, "CNY")]
        )
        self.assertFalse(ok)
        self.assertIn("候选账本校验失败", msg)
        valid, errors = self.ledger.validate_ledger()
        self.assertTrue(valid, "原账本应保持 100% 有效")

    def test_09_operation_journal_rollback(self):
        """测试操作日志的一键回滚能力"""
        ok, _, tx = self.ledger.append_transaction(
            tx_date="2026-09-05", payee="UndoMe", narration="Test",
            postings=[(self.expense, 88.00, "CNY"), (self.bank, -88.00, "CNY")]
        )
        self.assertTrue(ok)
        self.assertEqual(self.count_transactions(), 1)

        # 获取最近追加操作并执行回滚
        ops = self.db.list_operation_logs(limit=1)
        self.assertEqual(len(ops), 1)
        rb_ok, rb_msg = self.journal.rollback_operation(ops[0]["op_id"])
        self.assertTrue(rb_ok, rb_msg)
        self.assertEqual(self.count_transactions(), 0, "回滚后该交易已被安全撤销")


if __name__ == "__main__":
    unittest.main()
