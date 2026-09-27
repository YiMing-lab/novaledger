import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient

from novaledger_free.ai.provider import AIService
from novaledger_free.ai.sanitization import sanitize_text_for_display, validate_category_whitelist
from novaledger_free.core.config import ConfigManager
from novaledger_free.core.security import SecurityManager
from novaledger_free.web.app import create_app


class TestM5AISecurity(unittest.TestCase):
    """M5 阶段测试：XSS 清洗、无 Key 优雅降级、Host 安全校验与会话令牌防护"""

    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.sandbox_path = Path(self.tmp_dir.name)

        self.cfg = ConfigManager(data_dir=self.sandbox_path)
        self.sec = SecurityManager(self.sandbox_path / "secrets.json")
        self.ai = AIService(self.cfg, self.sec)

        self.app = create_app(data_dir=self.sandbox_path)
        self.client = TestClient(self.app)

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_01_sanitization_defense(self):
        """测试文本与 AI 输出防 XSS 清洗"""
        dangerous_input = '星巴克咖啡 <script>alert("hacked")</script> <img src=x onerror="alert(1)">'
        cleaned = sanitize_text_for_display(dangerous_input)
        self.assertNotIn("<script>", cleaned)
        self.assertNotIn('onerror="alert(1)"', cleaned)
        self.assertIn("星巴克咖啡", cleaned)

    def test_02_whitelist_validation(self):
        """测试科目白名单校验"""
        whitelist = ["Expenses:Food:Dining", "Expenses:Food:Groceries"]
        self.assertEqual(validate_category_whitelist("Expenses:Food:Dining", whitelist), "Expenses:Food:Dining")
        self.assertEqual(validate_category_whitelist("expenses:food:dining", whitelist), "Expenses:Food:Dining")
        # 非法伪造科目返回 None
        self.assertIsNone(validate_category_whitelist("Expenses:Evil:MaliciousAccount", whitelist))

    def test_03_offline_and_no_key_graceful_fallback(self):
        """测试在断网或无 Key 状态下，AI 服务安全返回本地默认降级建议，绝不抛出未捕获异常"""
        self.assertFalse(self.ai.is_available())
        sug = self.ai.get_category_suggestion("未知商户", "某交易", "100.00", ["Expenses:Food:Dining"])
        self.assertFalse(sug["available"])
        self.assertEqual(sug["suggested_category"], "Expenses:Other:General")
        self.assertEqual(sug["source"], "fallback")

    def test_04_api_host_and_token_protection(self):
        """测试 API 网关的主机头防御与会话 Token 鉴权"""
        # 1. 模拟跨域 DNS 重绑定伪造 Host (如 evil.com) -> 应拒绝 403
        bad_host_resp = self.client.get("/api/status", headers={"Host": "evil.com"})
        self.assertEqual(bad_host_resp.status_code, 403)

        # 2. 正常 Host 访问 status 获取 Token
        status_resp = self.client.get("/api/status", headers={"Host": "127.0.0.1"})
        self.assertEqual(status_resp.status_code, 200)
        token = status_resp.json()["session_token"]
        self.assertTrue(bool(token))

        # 3. 伪造错误 Token 提交记账 -> 应拒绝 401
        post_bad_token = self.client.post(
            "/api/transactions",
            headers={"Host": "127.0.0.1", "x-session-token": "bad_token_123"},
            json={"type": "expense", "date": "2026-09-01", "payee": "test", "amount": 10.0, "account": "Assets:Bank:Default:Card001"}
        )
        self.assertEqual(post_bad_token.status_code, 401)

        # 4. 携带合法 Token 提交记账 -> 正常通过 200
        post_good_token = self.client.post(
            "/api/transactions",
            headers={"Host": "127.0.0.1", "x-session-token": token},
            json={"type": "expense", "date": "2026-09-01", "payee": "test", "amount": 10.0, "account": "Assets:Bank:Default:Card001", "category": "Expenses:Food:Dining"}
        )
        self.assertEqual(post_good_token.status_code, 200)


if __name__ == "__main__":
    unittest.main()
