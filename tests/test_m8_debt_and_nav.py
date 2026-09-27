# -*- coding: utf-8 -*-
from datetime import datetime
from pathlib import Path
import tempfile
import unittest
from fastapi.testclient import TestClient

from novaledger_free.core.config import ConfigManager
from novaledger_free.core.db import DatabaseManager
from novaledger_free.core.ledger import LedgerManager
from novaledger_free.accounting.debts import DebtManager
from novaledger_free.web.app import create_app


class TestM8DebtAndNav(unittest.TestCase):
    """测试 M8 债务管理、多维下拉与导航整合接口"""

    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.sandbox_path = Path(self.tmp_dir.name)

        self.cfg = ConfigManager(data_dir=self.sandbox_path)
        self.db = DatabaseManager(self.cfg.sqlite_db_path)
        self.ledger = LedgerManager(self.cfg, self.db)
        self.debt_mgr = DebtManager(self.cfg, self.ledger)

        self.app = create_app(data_dir=self.sandbox_path)
        self.client = TestClient(self.app)

        st = self.client.get("/api/status", headers={"Host": "127.0.0.1"}).json()
        self.session_token = st["session_token"]
        self.headers = {
            "Host": "127.0.0.1",
            "x-session-token": self.session_token
        }

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_01_debt_manager_crud_and_validation(self):
        """测试 DebtManager 的新增、列表、修改、删除与 Beancount 借贷平衡"""
        # 1. 初始列表应为空（纯净环境）
        info = self.debt_mgr.list_debts()
        self.assertEqual(len(info["debts"]), 0)
        self.assertEqual(info["summary"]["total_remaining"], 0.0)

        # 2. 新增第一笔债务
        ok, msg, debt1 = self.debt_mgr.create_debt(
            name="房子抵押贷款",
            initial_amount=150000.00,
            due_date="2029-01",
            monthly_payment=2100.00,
            total_periods=60,
            debt_type="monthly",
            note="每月工资卡还款"
        )
        self.assertTrue(ok, msg)
        self.assertIsNotNone(debt1)
        self.assertEqual(debt1["name"], "房子抵押贷款")
        self.assertEqual(debt1["account"], "Liabilities:Loan:Debt1")

        # 校验账本 0 错误
        valid, errors = self.ledger.validate_ledger()
        self.assertTrue(valid, f"账本校验失败: {errors}")

        # 3. 再次查询，检查待还余额与汇总
        info = self.debt_mgr.list_debts()
        self.assertEqual(len(info["debts"]), 1)
        self.assertEqual(info["summary"]["count"], 1)
        self.assertEqual(info["summary"]["total_initial"], 150000.00)
        self.assertEqual(info["summary"]["total_remaining"], 150000.00)
        self.assertEqual(info["summary"]["total_monthly"], 2100.00)
        self.assertEqual(info["debts"][0]["current_balance"], 150000.00)

        # 4. 新增第二笔债务（到期一次性还清）
        ok, msg, debt2 = self.debt_mgr.create_debt(
            name="某行信用e贷",
            initial_amount=20000.00,
            due_date="2026-12",
            monthly_payment=0.00,
            total_periods=1,
            debt_type="lump_sum",
            note="到期还本"
        )
        self.assertTrue(ok, msg)
        self.assertEqual(debt2["account"], "Liabilities:Loan:Debt2")

        info = self.debt_mgr.list_debts()
        self.assertEqual(len(info["debts"]), 2)
        self.assertEqual(info["summary"]["total_remaining"], 170000.00)

        # 5. 更新债务信息
        ok, msg, updated = self.debt_mgr.update_debt(
            debt_id=debt1["id"],
            name="房子商业抵押贷款(已重命名)",
            monthly_payment=2150.00,
            note="调整为月供2150"
        )
        self.assertTrue(ok, msg)
        self.assertEqual(updated["name"], "房子商业抵押贷款(已重命名)")
        self.assertEqual(updated["monthly_payment"], 2150.00)

        # 校验修改后账本依旧平衡
        valid, errors = self.ledger.validate_ledger()
        self.assertTrue(valid, f"修改后账本校验失败: {errors}")

        # 6. 删除债务
        ok, msg = self.debt_mgr.delete_debt(debt2["id"])
        self.assertTrue(ok, msg)
        info = self.debt_mgr.list_debts()
        self.assertEqual(len(info["debts"]), 1)
        self.assertEqual(info["debts"][0]["id"], debt1["id"])

    def test_02_debts_api_endpoints(self):
        """测试 /api/debts RESTful 接口"""
        # 1. GET /api/debts
        res = self.client.get("/api/debts", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("debts", data)
        self.assertIn("summary", data)

        # 2. POST /api/debts (创建债务)
        payload = {
            "name": "装修消费分期",
            "initial_amount": 36000.00,
            "due_date": "2028-06",
            "monthly_payment": 1000.00,
            "total_periods": 36,
            "type": "monthly",
            "note": "信用卡分期手续费优惠"
        }
        res = self.client.post("/api/debts", json=payload, headers=self.headers)
        self.assertEqual(res.status_code, 200)
        resp_data = res.json()
        self.assertTrue(resp_data["success"])
        debt = resp_data["debt"]
        self.assertEqual(debt["name"], "装修消费分期")
        self.assertEqual(debt["initial_amount"], 36000.00)

        debt_id = debt["id"]

        # 3. PUT /api/debts/{debt_id} (修改债务)
        update_payload = {
            "name": "装修大额分期(修改)",
            "monthly_payment": 1050.00,
            "note": "每月20日扣款"
        }
        res = self.client.put(f"/api/debts/{debt_id}", json=update_payload, headers=self.headers)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["debt"]["name"], "装修大额分期(修改)")
        self.assertEqual(res.json()["debt"]["monthly_payment"], 1050.00)

        # 4. DELETE /api/debts/{debt_id} (删除债务)
        res = self.client.delete(f"/api/debts/{debt_id}", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["success"])

        # 确认列表中已删除
        res = self.client.get("/api/debts", headers=self.headers)
        self.assertEqual(len(res.json()["debts"]), 0)

    def test_03_debt_repayment_transaction(self):
        """测试偿还借款/债务记账流程，验证负债递减、卡余额扣减与借贷平衡"""
        # 1. 录入一笔初始债务 50,000 元
        ok, msg, debt = self.debt_mgr.create_debt(
            name="房子抵押借款",
            initial_amount=50000.00,
            due_date="2029-01",
            monthly_payment=2500.00,
            total_periods=20,
            debt_type="monthly"
        )
        self.assertTrue(ok, msg)
        debt_acc = debt["account"]

        # 2. 初始待还验证
        info = self.debt_mgr.list_debts()
        self.assertEqual(info["debts"][0]["current_balance"], 50000.00)

        # 3. 通过 API 发起一笔还款记账
        repay_payload = {
            "type": "debt_repayment",
            "date": "2026-09-06",
            "payee": "偿还借款: 房子抵押借款",
            "amount": 2500.00,
            "account": "Assets:Bank:Default:Card001",
            "to_account": debt_acc,
            "narration": "9月份月供偿还"
        }
        res = self.client.post("/api/transactions", json=repay_payload, headers=self.headers)
        self.assertEqual(res.status_code, 200, res.text)
        self.assertTrue(res.json()["success"])

        # 4. 严格校验 Beancount 账本完整平衡性
        valid, errors = self.ledger.validate_ledger()
        self.assertTrue(valid, f"账本出现差额: {errors}")

        # 5. 校验当前待还余额已准确扣减 2,500 元，变为 47,500 元
        info2 = self.debt_mgr.list_debts()
        self.assertEqual(info2["debts"][0]["current_balance"], 47500.00)
        self.assertEqual(info2["summary"]["total_remaining"], 47500.00)

        # 6. 校验银行卡资产已产生 -2,500.00 元分录
        balances = self.ledger.get_balances().get("account_balances", {})
        self.assertAlmostEqual(float(balances.get("Assets:Bank:Default:Card001", 0.0)), -2500.00, places=2)


if __name__ == "__main__":
    unittest.main()
