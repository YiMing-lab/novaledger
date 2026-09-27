import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient

from novaledger_free.core.config import ConfigManager
from novaledger_free.core.db import DatabaseManager
from novaledger_free.core.ledger import LedgerManager
from novaledger_free.core.security import SecurityManager
from novaledger_free.web.app import create_app


class TestM7Enhancements(unittest.TestCase):
    """测试功能增强：多维支出统计 (Top10商户、日均燃烧率、应急跑道)、邮箱测试与AI设置接口"""

    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.sandbox_path = Path(self.tmp_dir.name)

        self.cfg = ConfigManager(data_dir=self.sandbox_path)
        self.db = DatabaseManager(self.cfg.sqlite_db_path)
        self.sec = SecurityManager(self.sandbox_path / "secrets.json")
        self.ledger = LedgerManager(self.cfg, self.db)

        self.app = create_app(data_dir=self.sandbox_path)
        self.client = TestClient(self.app)

        st = self.client.get("/api/status", headers={"Host": "127.0.0.1"}).json()
        self.session_token = st["session_token"]

        self.bank = "Assets:Bank:Default:Card001"
        self.dining = "Expenses:Food:Dining"
        self.groceries = "Expenses:Food:Groceries"

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_01_enhanced_spending_statistics(self):
        """测试扩展的支出分析指标：Top10头部商户、日均燃烧率与应急跑道"""
        # 1. 存入流动资产 10000 元
        self.ledger.append_transaction(
            "2026-09-01", "初始存入", "资产",
            [(self.bank, 10000.00, "CNY"), ("Equity:Opening-Balances", -10000.00, "CNY")]
        )

        # 2. 发生多笔开销
        self.ledger.append_transaction(
            "2026-09-02", "星巴克咖啡", "拿铁",
            [(self.dining, 38.00, "CNY"), (self.bank, -38.00, "CNY")]
        )
        self.ledger.append_transaction(
            "2026-09-03", "星巴克咖啡", "美式",
            [(self.dining, 28.00, "CNY"), (self.bank, -28.00, "CNY")]
        )
        self.ledger.append_transaction(
            "2026-09-03", "山姆会员店", "买菜买肉",
            [(self.groceries, 300.00, "CNY"), (self.bank, -300.00, "CNY")]
        )

        rep = self.ledger.get_financial_reports("2026-09")

        # 校验 Top 10 商户排行
        top_payees = rep["top_payees"]
        self.assertGreaterEqual(len(top_payees), 2)
        # 第一名应为山姆会员店 (300元)
        self.assertEqual(top_payees[0]["payee"], "山姆会员店")
        self.assertEqual(top_payees[0]["amount"], 300.0)
        # 第二名应为星巴克咖啡 (38 + 28 = 66元)
        self.assertEqual(top_payees[1]["payee"], "星巴克咖啡")
        self.assertEqual(top_payees[1]["amount"], 66.0)

        # 校验日均燃烧率
        burn = rep["daily_burn_rate"]
        self.assertGreater(burn["daily_run_rate"], 0)
        self.assertGreater(burn["projected_month_expense"], 0)
        self.assertEqual(burn["peak_day"]["date"], "2026-09-03")

        # 校验应急跑道 (刚需 300 元，流动资产 10000 - 366 = 9634 元)
        runway = rep["emergency_runway"]
        self.assertGreater(runway["runway_months"], 10.0)
        self.assertIn("充裕", runway["health_status"])

    def test_02_mail_and_ai_api_endpoints(self):
        """测试邮箱连通性测试与 AI 配置接口"""
        # 测试空密码邮箱连接测试直接报错
        resp_mail = self.client.post(
            "/api/mail_sync/test",
            headers={"Host": "127.0.0.1"},
            json={"imap_host": "imap.example.invalid", "imap_port": 993, "username": "test@example.com"}
        )
        self.assertEqual(resp_mail.status_code, 400)

        # 测试无效 AI API Key 连通性测试返回失败但服务正常
        resp_ai = self.client.post(
            "/api/ai/test",
            headers={"Host": "127.0.0.1"},
            json={"api_key": "INVALID_KEY_12345"}
        )
        self.assertEqual(resp_ai.status_code, 200)
        self.assertFalse(resp_ai.json()["success"])

        # 测试 AI 未开启时的月报接口优雅降级
        resp_ins = self.client.get(
            "/api/ai/report_insights?month=2026-09",
            headers={"Host": "127.0.0.1"}
        )
        self.assertEqual(resp_ins.status_code, 200)
        self.assertFalse(resp_ins.json()["available"])

    def test_03_transaction_full_edit_and_merchant_rule(self):
        """测试交易全要素编辑 (日期、商户、备注、金额、分类、账户) 及商户规则记忆"""
        # 1. 记一笔初始账
        ok, msg, tx = self.ledger.append_transaction(
            "2026-09-05", "临时商户", "测试备注",
            [(self.dining, 50.00, "CNY"), (self.bank, -50.00, "CNY")]
        )
        self.assertTrue(ok)
        tx_id = tx.id

        # 2. 调用编辑接口，修改商户、分类、金额为 88.00 元，出资账户为 Card001，勾选记住规则
        new_cat = "Expenses:Food:Snacks"
        resp = self.client.put(
            f"/api/transactions/{tx_id}",
            headers={"Host": "127.0.0.1", "x-session-token": self.session_token},
            json={
                "date": "2026-09-06",
                "payee": "一点点奶茶",
                "narration": "大杯波霸奶茶",
                "amount": 88.00,
                "category": new_cat,
                "account": self.bank,
                "remember_rule": True
            }
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        res_data = resp.json()
        self.assertTrue(res_data["success"])

        # 3. 校验账本分录与合法性
        updated = self.ledger.get_transaction_by_id(tx_id)
        self.assertIsNotNone(updated)
        self.assertEqual(updated["date"], "2026-09-06")
        self.assertEqual(updated["payee"], "一点点奶茶")
        self.assertEqual(updated["narration"], "大杯波霸奶茶")
        # 验证金额已变更为 88.00
        amounts = [abs(p["amount"]) for p in updated["postings"]]
        self.assertIn(88.0, amounts)

        # 验证 Beancount 账本平衡无错
        valid, errs = self.ledger.validate_ledger()
        self.assertTrue(valid, f"账本校验报错: {errs}")

        # 4. 验证商户规则已成功记忆入库
        rule = self.db.match_merchant_rule("一点点奶茶", "")
        self.assertIsNotNone(rule)
        self.assertEqual(rule["category"], new_cat)

    def test_04_category_manager_and_endpoints(self):
        """测试分类管理接口：新增分类、修改分类、查询与安全归档"""
        # 1. 列表获取
        resp_list = self.client.get("/api/categories", headers={"Host": "127.0.0.1"})
        self.assertEqual(resp_list.status_code, 200)
        init_cats = resp_list.json()
        self.assertGreaterEqual(len(init_cats), 15)

        # 2. 新增自定义分类
        resp_add = self.client.post(
            "/api/categories",
            headers={"Host": "127.0.0.1", "x-session-token": self.session_token},
            json={"name": "宠物生活", "account": "Expenses:Pet:Care", "type": "expense", "icon": "pets"}
        )
        self.assertEqual(resp_add.status_code, 200)
        cat = resp_add.json()["category"]
        self.assertEqual(cat["name"], "宠物生活")
        cat_id = cat["id"]

        # 3. 重命名分类
        resp_put = self.client.put(
            f"/api/categories/{cat_id}",
            headers={"Host": "127.0.0.1", "x-session-token": self.session_token},
            json={"name": "萌宠世界"}
        )
        self.assertEqual(resp_put.status_code, 200)
        self.assertEqual(resp_put.json()["category"]["name"], "萌宠世界")

        # 4. 删除/归档分类
        resp_del = self.client.delete(
            f"/api/categories/{cat_id}",
            headers={"Host": "127.0.0.1", "x-session-token": self.session_token}
        )
        self.assertEqual(resp_del.status_code, 200)

    def test_05_account_update(self):
        """测试账户信息更新（修改名称、卡号尾号、归档状态）"""
        accs = self.cfg.config.get("accounts", [])
        self.assertGreater(len(accs), 0)
        target_acc_id = accs[0]["id"]

        resp = self.client.put(
            f"/api/accounts/{target_acc_id}",
            headers={"Host": "127.0.0.1", "x-session-token": self.session_token},
            json={"name": "招商主卡 (消费专享)", "card_tail": "9999"}
        )
        self.assertEqual(resp.status_code, 200)
        updated = resp.json()["account"]
        self.assertEqual(updated["name"], "招商主卡 (消费专享)")
        self.assertEqual(updated["card_tail"], "9999")

    def test_06_trends_and_backup_endpoints(self):
        """测试趋势走势接口与一键 Zip 备份导出与安全导入"""
        # 1. 走势接口
        resp_trends = self.client.get("/api/trends?months=6", headers={"Host": "127.0.0.1"})
        self.assertEqual(resp_trends.status_code, 200)
        t_data = resp_trends.json()
        self.assertIn("months", t_data)
        self.assertIn("asset_trends", t_data)
        self.assertIn("debt_trends", t_data)
        self.assertIn("category_trends", t_data)

        # 2. 导出备份 Zip
        resp_exp = self.client.get("/api/backup/export", headers={"Host": "127.0.0.1"})
        self.assertEqual(resp_exp.status_code, 200)
        zip_content = resp_exp.content
        self.assertGreater(len(zip_content), 100)

        # 3. 导入还原 Zip
        import io
        file_obj = io.BytesIO(zip_content)
        resp_imp = self.client.post(
            "/api/backup/import",
            headers={"Host": "127.0.0.1", "x-session-token": self.session_token},
            files={"file": ("test_backup.zip", file_obj, "application/zip")}
        )
        self.assertEqual(resp_imp.status_code, 200)
        self.assertTrue(resp_imp.json()["success"])

    def test_07_scheme_b_offset_transactions(self):
        """测试方案 B：统一对冲模型（支出冲减/退款、收入扣还与编辑状态保持）"""
        # 1. 创建一笔支出冲减（退款/报销）：资金卡入账 +834.64，冲减 Expenses:Food:Dining -834.64
        resp_exp_offset = self.client.post(
            "/api/transactions",
            headers={"Host": "127.0.0.1", "x-session-token": self.session_token},
            json={
                "date": "2026-09-13",
                "type": "expense",
                "is_offset": True,
                "amount": 834.64,
                "account": self.bank,
                "category": self.dining,
                "payee": "支付宝-飞猪旅行社",
                "narration": "退款-机票差价"
            }
        )
        self.assertEqual(resp_exp_offset.status_code, 200, resp_exp_offset.text)
        res_json = resp_exp_offset.json()
        self.assertTrue(res_json["success"])

        # 检查分录是否为：Assets: +834.64, Expenses: -834.64
        tx_list = self.ledger.get_all_transactions()
        refund_tx = next(t for t in tx_list if t["payee"] == "支付宝-飞猪旅行社")
        postings = {p["account"]: p["amount"] for p in refund_tx["postings"]}
        self.assertAlmostEqual(postings[self.bank], 834.64)
        self.assertAlmostEqual(postings[self.dining], -834.64)

        # 2. 创建一笔收入冲减（收入退还/追回扣款）：Income:Salary +150.00，资金卡出账 Assets: -150.00
        salary_cat = "Income:Salary"
        resp_inc_offset = self.client.post(
            "/api/transactions",
            headers={"Host": "127.0.0.1", "x-session-token": self.session_token},
            json={
                "date": "2026-09-14",
                "type": "income",
                "is_offset": True,
                "amount": 150.00,
                "account": self.bank,
                "category": salary_cat,
                "payee": "公司人事部",
                "narration": "薪资多发追回扣款"
            }
        )
        self.assertEqual(resp_inc_offset.status_code, 200, resp_inc_offset.text)
        tx_list = self.ledger.get_all_transactions()
        clawback_tx = next(t for t in tx_list if t["payee"] == "公司人事部")
        p_clawback = {p["account"]: p["amount"] for p in clawback_tx["postings"]}
        self.assertAlmostEqual(p_clawback[salary_cat], 150.00)
        self.assertAlmostEqual(p_clawback[self.bank], -150.00)

        # 3. 测试编辑支出冲减，验证不丢失冲减性质（关键防回归项）
        refund_id = refund_tx["id"]
        # 3a. 更新金额为 850.00，未传递 is_offset，系统应自动保持冲减性质
        resp_edit_1 = self.client.put(
            f"/api/transactions/{refund_id}",
            headers={"Host": "127.0.0.1", "x-session-token": self.session_token},
            json={
                "date": "2026-09-13",
                "payee": "支付宝-飞猪旅行社",
                "narration": "退款-机票差价(已调价)",
                "amount": 850.00,
                "category": self.dining,
                "account": self.bank
            }
        )
        self.assertEqual(resp_edit_1.status_code, 200, resp_edit_1.text)
        updated_1 = self.ledger.get_transaction_by_id(refund_id)
        p_up1 = {p["account"]: p["amount"] for p in updated_1["postings"]}
        self.assertAlmostEqual(p_up1[self.bank], 850.00, msg="银行资产卡应保持增加 +850.00")
        self.assertAlmostEqual(p_up1[self.dining], -850.00, msg="支出科目应保持负数冲减 -850.00")

        # 3b. 显式传递 is_offset=False，应将其转换为正常支出
        resp_edit_2 = self.client.put(
            f"/api/transactions/{refund_id}",
            headers={"Host": "127.0.0.1", "x-session-token": self.session_token},
            json={
                "date": "2026-09-13",
                "payee": "支付宝-飞猪旅行社",
                "narration": "重新转为正常消费",
                "amount": 850.00,
                "category": self.dining,
                "account": self.bank,
                "is_offset": False
            }
        )
        self.assertEqual(resp_edit_2.status_code, 200, resp_edit_2.text)
        updated_2 = self.ledger.get_transaction_by_id(refund_id)
        p_up2 = {p["account"]: p["amount"] for p in updated_2["postings"]}
        self.assertAlmostEqual(p_up2[self.bank], -850.00, msg="转为正常支出后银行应为扣减 -850.00")
        self.assertAlmostEqual(p_up2[self.dining], 850.00, msg="转为正常支出后分类应为增加 +850.00")

        # 4. 全账本合法性验证
        valid, errs = self.ledger.validate_ledger()
        self.assertTrue(valid, f"账本校验报错: {errs}")

    def test_08_analytics_drilldown_and_asset_trends(self):
        """测试统计页面新特性：分类下钻商户、全量商户排行榜与当月每日资产走势"""
        # 1. 记入多笔有规律的餐饮与购物消费
        self.ledger.append_transaction(
            "2026-09-02", "星巴克咖啡", "拿铁",
            [(self.dining, 38.00, "CNY"), (self.bank, -38.00, "CNY")]
        )
        self.ledger.append_transaction(
            "2026-09-05", "星巴克咖啡", "美式",
            [(self.dining, 28.00, "CNY"), (self.bank, -28.00, "CNY")]
        )
        self.ledger.append_transaction(
            "2026-09-10", "麦当劳", "巨无霸套餐",
            [(self.dining, 35.00, "CNY"), (self.bank, -35.00, "CNY")]
        )
        self.ledger.append_transaction(
            "2026-09-12", "山姆会员店", "日用品",
            [(self.groceries, 260.00, "CNY"), (self.bank, -260.00, "CNY")]
        )

        # 2. 调用 API 获取月度报告
        resp = self.client.get("/api/reports?month=2026-09", headers={"Host": "127.0.0.1"})
        self.assertEqual(resp.status_code, 200)
        rep = resp.json()

        # 3. 校验分类下钻商户 (Category Drilldown Merchants)
        cat_ranking = rep["category_ranking"]
        dining_cat = next((c for c in cat_ranking if c["category"] == self.dining), None)
        self.assertIsNotNone(dining_cat)
        self.assertIn("merchants", dining_cat)
        merchants = dining_cat["merchants"]
        self.assertGreaterEqual(len(merchants), 2)
        # 第一名应为星巴克咖啡 (38 + 28 = 66元, 2次)
        starbucks = next((m for m in merchants if m["payee"] == "星巴克咖啡"), None)
        self.assertIsNotNone(starbucks)
        self.assertEqual(starbucks["count"], 2)
        self.assertEqual(starbucks["amount"], 66.0)
        # 第二名应为麦当劳 (35元, 1次)
        mcd = next((m for m in merchants if m["payee"] == "麦当劳"), None)
        self.assertIsNotNone(mcd)
        self.assertEqual(mcd["count"], 1)
        self.assertEqual(mcd["amount"], 35.0)

        # 4. 校验全量商户排行榜 (Merchant Ranking)
        m_ranking = rep.get("merchant_ranking", [])
        self.assertGreaterEqual(len(m_ranking), 3)
        # 山姆会员店金额最高 (260元)
        self.assertEqual(m_ranking[0]["payee"], "山姆会员店")
        self.assertEqual(m_ranking[0]["amount"], 260.0)
        self.assertEqual(m_ranking[0]["count"], 1)
        self.assertEqual(m_ranking[0]["avg_amount"], 260.0)
        self.assertIn(self.groceries, m_ranking[0]["categories"])

        # 5. 校验当月每日各资产走势序列 (Asset Daily Trends)
        self.assertIn("asset_daily_trends", rep)
        adt = rep["asset_daily_trends"]
        self.assertEqual(len(adt["days"]), 30) # 9月有30天
        self.assertEqual(len(adt["dates"]), 30)
        # 资产账户列表中应包含 bank 账户
        target_acc = next((a for a in adt["accounts"] if a["account"] == self.bank), None)
        self.assertIsNotNone(target_acc)
        self.assertEqual(len(target_acc["balances"]), 30)


if __name__ == "__main__":
    unittest.main()

