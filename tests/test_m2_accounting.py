from decimal import Decimal
import tempfile
import unittest
from pathlib import Path

from novaledger_free.accounting.accounts import AccountManager
from novaledger_free.accounting.reconciliation import ReconciliationEngine
from novaledger_free.accounting.transaction_ops import TransactionOperations
from novaledger_free.core.config import ConfigManager
from novaledger_free.core.db import DatabaseManager
from novaledger_free.core.ledger import LedgerManager


class TestM2Accounting(unittest.TestCase):
    """M2 阶段测试：完整复式记账业务流、还款核销、退款冲减、拆分记账与月末对账"""

    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.sandbox_path = Path(self.tmp_dir.name)

        self.cfg = ConfigManager(data_dir=self.sandbox_path)
        self.db = DatabaseManager(self.cfg.sqlite_db_path)
        self.ledger = LedgerManager(self.cfg, self.db)
        self.acc_mgr = AccountManager(self.cfg, self.ledger)
        self.ops = TransactionOperations(self.ledger)
        self.recon = ReconciliationEngine(self.ledger, self.db)

        self.bank = "Assets:Bank:Default:Card001"
        self.credit = "Liabilities:CreditCard:Default:Card001"
        self.dining = "Expenses:Food:Dining"
        self.groceries = "Expenses:Food:Groceries"
        self.snacks = "Expenses:Food:Snacks"

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_01_account_create_and_archive(self):
        """测试创建中文账户、期初建账与安全归档"""
        ok, msg, bean_acc = self.acc_mgr.create_account(
            account_id="cmb_card",
            name="招行储蓄卡",
            acc_type="debit",
            sub_name="CMB-Card8888",
            initial_balance=5000.00,
            opening_date="2026-01-01"
        )
        self.assertTrue(ok, msg)
        self.assertEqual(bean_acc, "Assets:Bank:CMB-Card8888")

        # 校验期初余额
        bals = self.ledger.get_balances()
        self.assertEqual(bals["account_balances"]["Assets:Bank:CMB-Card8888"], 5000.0)

        # 测试归档
        self.acc_mgr.archive_account("cmb_card")
        active_list = self.acc_mgr.list_accounts(include_archived=False)
        self.assertNotIn("cmb_card", [a["id"] for a in active_list])
        
        # 归档后历史资产不受影响
        bals_after = self.ledger.get_balances()
        self.assertEqual(bals_after["account_balances"]["Assets:Bank:CMB-Card8888"], 5000.0)

    def test_02_credit_card_repayment_no_double_expense(self):
        """测试信用卡消费与还款：消费计入支出与负债，还款仅核销负债，绝不双计支出"""
        # 1. 银行卡存入 1000 元
        self.ops.record_income("2026-09-01", "公司", "工资发放", 1000.00, self.bank)

        # 2. 信用卡消费 100 元晚餐
        ok_exp, _, _ = self.ops.record_expense("2026-09-02", "餐馆", "晚餐", 100.00, self.credit, self.dining)
        self.assertTrue(ok_exp)

        # 此时：资产 1000，负债 100，净资产 900，支出 100
        bals_mid = self.ledger.get_balances()
        self.assertEqual(bals_mid["total_assets"], 1000.0)
        self.assertEqual(bals_mid["total_liabilities"], 100.0)
        self.assertEqual(bals_mid["net_worth"], 900.0)

        # 3. 银行卡向信用卡还款 100 元
        ok_repay, _, _ = self.ops.record_credit_card_repayment("2026-09-05", 100.00, self.bank, self.credit)
        self.assertTrue(ok_repay)

        # 还款后：资产 900，负债 0，净资产 900，月度支出仍为 100（还款不作为支出）
        rep = self.ledger.get_financial_reports("2026-09")
        self.assertEqual(rep["balance_sheet"]["total_assets"], 900.0)
        self.assertEqual(rep["balance_sheet"]["total_liabilities"], 0.0)
        self.assertEqual(rep["balance_sheet"]["net_worth"], 900.0)
        self.assertEqual(rep["income_statement"]["total_expenses"], 100.0)

    def test_03_refund_offsets_expense(self):
        """测试消费退款：准确冲减原消费类别的费用支出"""
        # 消费 200 元餐饮
        self.ops.record_expense("2026-09-03", "某商家", "商品购买", 200.00, self.bank, self.dining)
        rep1 = self.ledger.get_financial_reports("2026-09")
        self.assertEqual(rep1["income_statement"]["total_expenses"], 200.0)

        # 部分退款 50 元退回银行卡
        ok_ref, _, _ = self.ops.record_refund("2026-09-04", "某商家", "部分退款", 50.00, self.bank, self.dining)
        self.assertTrue(ok_ref)

        # 退款冲减后，当月该类别及总支出为 150 元
        rep2 = self.ledger.get_financial_reports("2026-09")
        self.assertEqual(rep2["income_statement"]["total_expenses"], 150.0)
        self.assertEqual(rep2["income_statement"]["categories"][self.dining], 150.0)

    def test_04_split_transaction(self):
        """测试单笔交易多分类拆分与借贷严格平账"""
        splits = [
            (self.groceries, 60.00, "买菜买肉"),
            (self.snacks, 40.00, "零食饮料")
        ]
        # 拆分总额正好等于 100 元
        ok, msg, _ = self.ops.record_split_transaction("2026-09-05", "超市", "大采购", 100.00, self.bank, splits)
        self.assertTrue(ok, msg)

        rep = self.ledger.get_financial_reports("2026-09")
        self.assertEqual(rep["income_statement"]["total_expenses"], 100.0)
        self.assertEqual(rep["income_statement"]["categories"][self.groceries], 60.0)
        self.assertEqual(rep["income_statement"]["categories"][self.snacks], 40.0)

        # 测试拆分金额不相等时直接拒绝
        bad_splits = [(self.groceries, 50.00, "买菜")]
        bad_ok, bad_msg, _ = self.ops.record_split_transaction("2026-09-05", "超市", "少记", 100.00, self.bank, bad_splits)
        self.assertFalse(bad_ok)
        self.assertIn("不一致", bad_msg)

    def test_05_reconciliation_and_adjustment(self):
        """测试对账核对与调账分录生成"""
        # 初始向银行卡录入 500 元
        self.ops.record_income("2026-09-01", "存钱", "初始存入", 500.00, self.bank)

        # 此时账面余额 500，用户录入实际余额 520 (多出 20 元)
        chk = self.recon.check_reconciliation(self.bank, "2026-09-05", 520.00)
        self.assertFalse(chk["is_balanced"])
        self.assertEqual(chk["difference"], 20.0)

        # 执行调账
        adj_ok, adj_msg, _ = self.recon.apply_adjustment(self.bank, "2026-09-05", 520.00, reason="发现钱包现金补入")
        self.assertTrue(adj_ok, adj_msg)

        # 再次核对，已完全平账
        chk_after = self.recon.check_reconciliation(self.bank, "2026-09-05", 520.00)
        self.assertTrue(chk_after["is_balanced"])
        self.assertEqual(chk_after["difference"], 0.0)
        self.assertEqual(chk_after["ledger_balance"], 520.0)


if __name__ == "__main__":
    unittest.main()
