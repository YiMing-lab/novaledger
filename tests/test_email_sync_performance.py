import unittest
from datetime import datetime
from novaledger_free.parsers.eml_parser import EMLParser

class TestEmailSyncEnhancements(unittest.TestCase):
    def setUp(self):
        self.parser = EMLParser()

    def test_overseas_authorization(self):
        text = "您账户8225于09月19日18:20境外线上消费授权USD25.00（人民币167.48），请留意后续扣款通知"
        records = self.parser._extract_sentence_records(
            body=text,
            bank={"code": "cmb", "name": "招商银行", "short": "招行"},
            subject="一卡通账户变动通知",
            fallback_dt=datetime(2026, 9, 19),
            card_tail="8225"
        )
        self.assertEqual(len(records), 1)
        self.assertEqual(str(records[0].amount), "167.48")
        self.assertEqual(records[0].direction, "支出")
        self.assertEqual(records[0].date, "2026-09-19")

    def test_credit_card_repayment(self):
        text = "您账户7861于09月27日01:36信用卡还款交易人民币1618.30"
        records = self.parser._extract_sentence_records(
            body=text,
            bank={"code": "cmb", "name": "招商银行", "short": "招行"},
            subject="一卡通账户变动通知",
            fallback_dt=datetime(2026, 9, 27),
            card_tail="7861"
        )
        self.assertEqual(len(records), 1)
        self.assertEqual(str(records[0].amount), "1618.30")
        self.assertTrue(records[0].raw_payload.get("is_repayment"))

    def test_counter_deposit(self):
        text = "您账户7861于2026年09月30日柜台存款人民币24000。本机构吸收的本外币存款受到保护。"
        records = self.parser._extract_sentence_records(
            body=text,
            bank={"code": "cmb", "name": "招商银行", "short": "招行"},
            subject="一卡通账户变动通知",
            fallback_dt=datetime(2026, 9, 30),
            card_tail="7861"
        )
        self.assertEqual(len(records), 1)
        self.assertEqual(str(records[0].amount), "24000.00")
        self.assertEqual(records[0].direction, "收入")

    def test_interbank_transfer(self):
        text = "您账户7861于10月01日15:15实时转至他行人民币20000.00，收款人赖智美"
        records = self.parser._extract_sentence_records(
            body=text,
            bank={"code": "cmb", "name": "招商银行", "short": "招行"},
            subject="一卡通账户变动通知",
            fallback_dt=datetime(2026, 10, 1),
            card_tail="7861"
        )
        self.assertEqual(len(records), 1)
        self.assertEqual(str(records[0].amount), "20000.00")
        self.assertEqual(records[0].payee, "赖智美")

    def test_marketing_email_skipped_without_ai(self):
        body = "Haowei Li您好，CSAE2025已被检索，欢迎您注册参会并完成消费支付"
        records, meta = self.parser._parse_core(
            subject="会议通知",
            sender="Organizer <no-reply@csae.org>",
            body=body,
            raw_html="",
            fallback_dt=datetime.now(),
            use_ai_fallback=True
        )
        self.assertEqual(len(records), 0)
        self.assertIn("skipped_reason", meta)

if __name__ == "__main__":
    unittest.main()
