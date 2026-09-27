from datetime import datetime
import email
from email import policy
import email.utils
import html
from pathlib import Path
import re
from typing import Any, Dict, List, Optional, Tuple

from novaledger_free.core.models import SourceType, to_decimal
from novaledger_free.parsers.base import RawRecord


# 国内 14 家主流银行特征指纹库（六大国有行 + 八大股份行）
BANK_PROFILES: List[Dict[str, Any]] = [
    {"code": "icbc", "name": "工商银行", "short": "工行", "keywords": ["工商银行", "工行", "icbc.com.cn", "工银", "融e联"]},
    {"code": "abc", "name": "农业银行", "short": "农行", "keywords": ["农业银行", "农行", "abchina.com", "金穗"]},
    {"code": "boc", "name": "中国银行", "short": "中行", "keywords": ["中国银行", "中行", "bankofchina.com", "中银"]},
    {"code": "ccb", "name": "建设银行", "short": "建行", "keywords": ["建设银行", "建行", "ccb.com", "龙卡"]},
    {"code": "bocom", "name": "交通银行", "short": "交行", "keywords": ["交通银行", "交行", "bankcomm.com", "买单吧", "沃德"]},
    {"code": "psbc", "name": "邮储银行", "short": "邮储", "keywords": ["邮政储蓄银行", "邮储银行", "邮储", "psbc.com"]},
    {"code": "cmb", "name": "招商银行", "short": "招行", "keywords": ["招商银行", "招行", "cmbchina.com", "一卡通", "掌上生活"]},
    {"code": "citic", "name": "中信银行", "short": "中信", "keywords": ["中信银行", "中信", "citicbank.com", "动卡空间"]},
    {"code": "spdb", "name": "浦发银行", "short": "浦发", "keywords": ["浦发银行", "浦发", "spdb.com.cn", "spdbccc", "浦大喜奔"]},
    {"code": "cgb", "name": "广发银行", "short": "广发", "keywords": ["广发银行", "广发", "cgbchina.com.cn", "发现精彩"]},
    {"code": "pab", "name": "平安银行", "short": "平安", "keywords": ["平安银行", "平安口袋", "pingan.com.cn", "平安信用卡"]},
    {"code": "cib", "name": "兴业银行", "short": "兴业", "keywords": ["兴业银行", "兴业", "cib.com.cn", "好兴动"]},
    {"code": "cmbc", "name": "民生银行", "short": "民生", "keywords": ["民生银行", "民生", "cmbc.com.cn", "全民生活"]},
    {"code": "ceb", "name": "光大银行", "short": "光大", "keywords": ["光大银行", "光大", "cebbank.com", "阳光惠生活"]},
]

NON_TRANSACTION_KEYWORDS = [
    "限额修改", "修改POS", "关闭境外", "关闭取款", "开通功能", "限额调整",
    "验证码", "登录提醒", "密码修改", "积分到期", "优惠券", "安全提示",
]


class EMLParser:
    """
    多银行混合邮件账单/动账通知解析器 (v1.5)
    支持国内 14 家主流银行：
    - 第 1 层：银行身份指纹识别（避免将其他银行的“尾号xxxx”误判为招行）
    - 第 2 层：HTML 电子账单明细表提取 + 多句式动账通知正则矩阵（消费、快捷支付、退款对冲、转入收入、信用卡还款）
    - 第 3 层：可选 AI 语义兜底解析（当规则未命中且已启用 AI 时，自动提取并送入待确认队列）
    """

    def __init__(self, ai_service: Optional[Any] = None):
        self.ai_service = ai_service

    @staticmethod
    def get_supported_banks() -> List[Dict[str, str]]:
        return [{"code": b["code"], "name": b["name"], "short": b["short"]} for b in BANK_PROFILES]

    def identify_bank(self, sender: str, subject: str, body: str) -> Dict[str, str]:
        """根据发件人、主题与正文识别所属银行"""
        header_text = f"{sender} {subject}".lower()
        full_text = f"{sender} {subject} {body}".lower()

        # 优先匹配发件人和邮件主题
        for prof in BANK_PROFILES:
            for kw in prof["keywords"]:
                if kw.lower() in header_text:
                    return {"code": prof["code"], "name": prof["name"], "short": prof["short"]}

        # 再匹配邮件正文
        for prof in BANK_PROFILES:
            for kw in prof["keywords"]:
                if kw.lower() in full_text:
                    return {"code": prof["code"], "name": prof["name"], "short": prof["short"]}

        return {"code": "bank", "name": "银行卡", "short": "银行"}

    def _extract_body_and_html(self, msg: email.message.EmailMessage) -> Tuple[str, str]:
        """同时提取清洗后的纯文本与原始 HTML 内容（用于表格账单解析）"""
        plain_parts: List[str] = []
        html_parts: List[str] = []

        if msg.is_multipart():
            for part in msg.walk():
                ct = part.get_content_type()
                if ct in ("text/plain", "text/html"):
                    payload = part.get_payload(decode=True)
                    if payload:
                        charset = part.get_content_charset() or "utf-8"
                        for enc in [charset, "utf-8", "gb18030", "gbk", "latin1"]:
                            try:
                                decoded = payload.decode(enc)
                                if ct == "text/html":
                                    html_parts.append(decoded)
                                    cleaned = re.sub(r"<style[^>]*>.*?</style>", " ", decoded, flags=re.DOTALL | re.IGNORECASE)
                                    cleaned = re.sub(r"<script[^>]*>.*?</script>", " ", cleaned, flags=re.DOTALL | re.IGNORECASE)
                                    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
                                    plain_parts.append(html.unescape(cleaned))
                                else:
                                    plain_parts.append(decoded)
                                break
                            except UnicodeDecodeError:
                                continue
        else:
            payload = msg.get_payload(decode=True)
            ct = msg.get_content_type()
            if payload:
                charset = msg.get_content_charset() or "utf-8"
                for enc in [charset, "utf-8", "gb18030", "gbk", "latin1"]:
                    try:
                        decoded = payload.decode(enc)
                        if ct == "text/html":
                            html_parts.append(decoded)
                            cleaned = re.sub(r"<style[^>]*>.*?</style>", " ", decoded, flags=re.DOTALL | re.IGNORECASE)
                            cleaned = re.sub(r"<script[^>]*>.*?</script>", " ", cleaned, flags=re.DOTALL | re.IGNORECASE)
                            cleaned = re.sub(r"<[^>]+>", " ", cleaned)
                            plain_parts.append(html.unescape(cleaned))
                        else:
                            plain_parts.append(decoded)
                        break
                    except UnicodeDecodeError:
                        continue
            else:
                try:
                    content_str = str(msg.get_content())
                    if "<tr" in content_str.lower() or "<td" in content_str.lower():
                        html_parts.append(content_str)
                        cleaned = re.sub(r"<[^>]+>", " ", content_str)
                        plain_parts.append(html.unescape(cleaned))
                    else:
                        plain_parts.append(content_str)
                except Exception:
                    pass

        plain_text = re.sub(r"\s+", " ", " ".join(plain_parts)).strip()
        raw_html = "\n".join(html_parts).strip()
        return plain_text, raw_html

    def _parse_date_time(self, text: str, fallback_dt: datetime) -> Tuple[str, str]:
        """从文本中提取交易日期与时间，兼容多种中文银行格式"""
        # 1. 完整年月日: 2026年09月16日 14:20(:30) 或 2026-09-16 14:20(:30) 或 2026/09/16
        full_dt_match = re.search(
            r"(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})日?(?:\s*(\d{1,2}:\d{2}(?::\d{2})?))?",
            text
        )
        if full_dt_match:
            y, m, d = int(full_dt_match.group(1)), int(full_dt_match.group(2)), int(full_dt_match.group(3))
            t_raw = full_dt_match.group(4) or "12:00:00"
            time_str = f"{t_raw}:00" if len(t_raw) == 5 else t_raw
            return f"{y:04d}-{m:02d}-{d:02d}", time_str

        # 2. 月日格式: (于)09月16日14:20 或 9月16日 14时20分
        md_match = re.search(
            r"(\d{1,2})月(\d{1,2})日(?:\s*(\d{1,2})[:时](\d{2})(?:[:分](\d{2}))?)?",
            text
        )
        if md_match:
            m, d = int(md_match.group(1)), int(md_match.group(2))
            hh = md_match.group(3)
            mm = md_match.group(4)
            ss = md_match.group(5) or "00"
            time_str = f"{int(hh):02d}:{int(mm):02d}:{int(ss):02d}" if (hh and mm) else "12:00:00"
            return f"{fallback_dt.year:04d}-{m:02d}-{d:02d}", time_str

        # 3. 紧凑 8 位日期: 20260916
        compact_match = re.search(r"\b(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b", text)
        if compact_match:
            y, m, d = int(compact_match.group(1)), int(compact_match.group(2)), int(compact_match.group(3))
            return f"{y:04d}-{m:02d}-{d:02d}", fallback_dt.strftime("%H:%M:%S")

        return fallback_dt.strftime("%Y-%m-%d"), fallback_dt.strftime("%H:%M:%S")

    def _extract_card_tail(self, text: str) -> str:
        """提取 4 位卡号尾号"""
        patterns = [
            r"(?:尾号|末四位|尾数为|尾号为)\s*(?:为)?\s*(\d{4})",
            r"(?:账户|卡号|信用卡|借记卡|一卡通|龙卡|储蓄卡)\s*(?:\*+|\d*\*)?(\d{4})",
            r"\*{2,}(\d{4})",
        ]
        for pat in patterns:
            m = re.search(pat, text)
            if m:
                return m.group(1)
        return "0000"

    def _extract_balance(self, text: str) -> Optional[float]:
        bal_match = re.search(r"(?:可用)?余额(?:为)?(?:人民币|CNY|RMB|¥|￥|\s)*([0-9,]+(?:\.\d+)?)", text)
        if bal_match:
            try:
                return float(bal_match.group(1).replace(",", ""))
            except Exception:
                return None
        return None

    def _clean_payee(self, raw_payee: str, default_label: str) -> str:
        p = (raw_payee or "").strip()
        p = re.sub(r"^[【\[（(：:\s]+|[】\]）)，。；;！!\s]+$", "", p)
        # 剥离尾随的“完成”、“处”、“进行”等连接词
        p = re.sub(r"(?:完成|进行|发生|成功|处)$", "", p).strip()
        if not p or p in ("人民币", "CNY", "RMB"):
            return default_label
        return p[:60]

    def _extract_html_table_records(
        self,
        raw_html: str,
        bank: Dict[str, str],
        subject: str,
        fallback_dt: datetime,
        default_card_tail: str
    ) -> List[RawRecord]:
        """从 HTML 电子账单/日账单表格 (<tr><td>...</td></tr>) 中提取多笔流水明细"""
        if not raw_html or "<tr" not in raw_html.lower():
            return []

        records: List[RawRecord] = []
        tr_blocks = re.findall(r"<tr[^>]*>(.*?)</tr>", raw_html, flags=re.DOTALL | re.IGNORECASE)
        header_skip_words = ("交易日期", "记账日期", "交易摘要", "商户名称", "交易金额", "入账金额", "卡号末四位", "本期应还", "最低还款额")

        for idx, tr in enumerate(tr_blocks):
            tds = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, flags=re.DOTALL | re.IGNORECASE)
            if len(tds) < 3:
                continue

            cells = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", td))).strip() for td in tds]
            row_joined = " | ".join(cells)
            if any(hw in row_joined for hw in header_skip_words):
                continue

            # 1. 寻找日期单元格
            tx_date = None
            date_cell_idx = -1
            for c_i, cell in enumerate(cells):
                m_full = re.search(r"^(20\d{2})[年\-/\.](0?[1-9]|1[0-2])[月\-/\.](0?[1-9]|[12]\d|3[01])日?$", cell)
                if m_full:
                    tx_date = f"{int(m_full.group(1)):04d}-{int(m_full.group(2)):02d}-{int(m_full.group(3)):02d}"
                    date_cell_idx = c_i
                    break
                m_compact = re.search(r"^(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$", cell)
                if m_compact:
                    tx_date = f"{int(m_compact.group(1)):04d}-{int(m_compact.group(2)):02d}-{int(m_compact.group(3)):02d}"
                    date_cell_idx = c_i
                    break
                m_md = re.search(r"^(0?[1-9]|1[0-2])[\-/月](0?[1-9]|[12]\d|3[01])日?$", cell)
                if m_md:
                    tx_date = f"{fallback_dt.year:04d}-{int(m_md.group(1)):02d}-{int(m_md.group(2)):02d}"
                    date_cell_idx = c_i
                    break

            if not tx_date:
                continue

            # 2. 寻找金额单元格 (通常在行尾或倒数第二列)
            amt_val = None
            is_negative_amt = False
            amt_cell_idx = -1
            for c_i in range(len(cells) - 1, -1, -1):
                if c_i == date_cell_idx:
                    continue
                cell = cells[c_i]
                # 排除 4 位纯数字卡尾号或日期
                if re.match(r"^\d{4}$", cell) or re.match(r"^20\d{6}$", cell):
                    continue
                m_amt = re.search(r"^(?:人民币|CNY|RMB|¥|￥)?\s*([+\-]?\d[\d,]*\.\d{2})\s*(?:元|CNY|RMB)?$", cell, re.IGNORECASE)
                if m_amt:
                    raw_num = m_amt.group(1).replace(",", "")
                    if raw_num.startswith("-"):
                        is_negative_amt = True
                    amt_val = to_decimal(raw_num.lstrip("+-"))
                    amt_cell_idx = c_i
                    break

            if amt_val is None or amt_val <= 0:
                continue

            # 3. 寻找卡尾号与商户描述单元格
            card_tail = default_card_tail
            desc_candidates = []
            for c_i, cell in enumerate(cells):
                if c_i in (date_cell_idx, amt_cell_idx) or not cell:
                    continue
                if re.match(r"^\d{4}$", cell):
                    card_tail = cell
                    continue
                if re.match(r"^(?:20\d{2}[\-/]\d{1,2}[\-/]\d{1,2}|\d{1,2}[\-/]\d{1,2}|\d{2}:\d{2}(?::\d{2})?)$", cell):
                    continue
                if cell.upper() in ("CNY", "RMB", "人民币"):
                    continue
                desc_candidates.append(cell)

            raw_desc = " ".join(desc_candidates).strip() or f"{bank['short']}账单明细"
            is_refund = any(w in raw_desc for w in ("退款", "退货", "冲正", "退回", "撤销")) or (is_negative_amt and "还款" not in raw_desc)
            is_repayment = any(w in raw_desc for w in ("还款", "自动扣款", "本行自动还款", "他行还款"))

            if is_refund:
                direction = "收入"
                status_text = "退款"
                cat_hint = "退款"
            elif is_repayment:
                direction = "支出"
                status_text = "还款"
                cat_hint = "信用卡还款"
            else:
                direction = "支出"
                status_text = "成功"
                cat_hint = "银行账单"

            payee = self._clean_payee(raw_desc, f"{bank['short']}商户")
            narration = f"{bank['short']}卡({card_tail}) {raw_desc}"
            rec = RawRecord(
                date=tx_date,
                time_str=f"12:00:{idx % 60:02d}",
                payee=payee,
                narration=narration,
                amount=amt_val,
                direction=direction,
                status_text=status_text,
                source_type=SourceType.BANK_EMAIL,
                source_tx_id=f"eml_{bank['code']}_{card_tail}_{tx_date}_row{idx}_{amt_val}",
                channel=f"{bank['name']}({card_tail})",
                category_hint=cat_hint,
                raw_payload={
                    "subject": subject,
                    "card": card_tail,
                    "bank_code": bank["code"],
                    "bank_name": bank["name"],
                    "source": f"{bank['code']}_email_table",
                    "is_refund": is_refund,
                    "is_repayment": is_repayment,
                    "direction": direction,
                },
            )
            records.append(rec)

        return records

    def _build_record(
        self,
        bank: Dict[str, str],
        card_tail: str,
        date_str: str,
        time_str: str,
        payee: str,
        action_label: str,
        amt_str: str,
        direction: str,
        subject: str,
        card_balance: Optional[float],
        is_refund: bool = False,
        is_repayment: bool = False,
        extra_meta: Optional[Dict[str, Any]] = None,
    ) -> RawRecord:
        amt = to_decimal(amt_str.replace(",", "").lstrip("+-"))
        clean_payee = self._clean_payee(payee, f"{bank['short']}卡({card_tail})动账")
        status_text = "退款" if is_refund else ("还款" if is_repayment else "成功")
        cat_hint = "退款" if is_refund else ("信用卡还款" if is_repayment else "银行通知")
        narration = f"{bank['short']}卡({card_tail}) {action_label}".strip()

        payload: Dict[str, Any] = {
            "subject": subject,
            "card": card_tail,
            "balance": card_balance,
            "bank_code": bank["code"],
            "bank_name": bank["name"],
            "source": f"{bank['code']}_email",
            "is_refund": is_refund,
            "is_repayment": is_repayment,
            "direction": direction,
        }
        if extra_meta:
            payload.update(extra_meta)

        return RawRecord(
            date=date_str,
            time_str=time_str,
            payee=clean_payee,
            narration=narration,
            amount=amt,
            direction=direction,
            status_text=status_text,
            source_type=SourceType.BANK_EMAIL,
            source_tx_id=f"eml_{bank['code']}_{card_tail}_{date_str}_{time_str.replace(':', '')}_{amt}",
            channel=f"{bank['name']}({card_tail})",
            category_hint=cat_hint,
            raw_payload=payload,
        )

    def _extract_sentence_records(
        self,
        body: str,
        bank: Dict[str, str],
        subject: str,
        fallback_dt: datetime,
        card_tail: str
    ) -> List[RawRecord]:
        """从单笔或多笔动账通知正文句式中提取交易记录（覆盖 14 家主流银行常见句式）"""
        date_str, time_str = self._parse_date_time(body, fallback_dt)
        card_balance = self._extract_balance(body)
        amt_pat = r"(?:人民币|CNY|RMB|¥|￥|\s)*([0-9,]+(?:\.\d+)?)\s*(?:元|CNY|RMB)?"

        # 1. 退款 / 退货 / 冲正 / 撤销匹配（高优先级，防止被普通消费误捕获）
        # 句式 1A: 在【商户】(的)退款/退货/冲正 1400.00元
        m_ref_a = re.search(rf"在\s*(.+?)\s*(?:的|完成|发生)?(退款|退货|冲正|撤销|退回){amt_pat}", body)
        if m_ref_a:
            return [self._build_record(
                bank, card_tail, date_str, time_str,
                payee=m_ref_a.group(1),
                action_label=m_ref_a.group(2),
                amt_str=m_ref_a.group(3),
                direction="收入",
                subject=subject,
                card_balance=card_balance,
                is_refund=True,
            )]

        # 句式 1B: 发生(退货/退款/冲正)人民币1400.00元...[商户/对方/摘要]
        m_ref_b = re.search(
            rf"(?:发生|完成|入账|收到)?(退货|退款|冲正|消费退货|撤销交易)(?:入账)?{amt_pat}(?:.*?(?:商户[名称为：:]*|对方(?:户名)?[为：:]*|摘要[：:]*|在【|【)([^，。；\s】]+))?",
            body
        )
        if m_ref_b:
            payee = m_ref_b.group(3) or "商户退款"
            return [self._build_record(
                bank, card_tail, date_str, time_str,
                payee=payee,
                action_label=m_ref_b.group(1),
                amt_str=m_ref_b.group(2),
                direction="收入",
                subject=subject,
                card_balance=card_balance,
                is_refund=True,
            )]

        # 2. 信用卡还款匹配
        m_repay = re.search(
            rf"(信用卡还款|自动还款|账单还款|还款入账|成功还款|已还款){amt_pat}",
            body
        )
        if m_repay:
            return [self._build_record(
                bank, card_tail, date_str, time_str,
                payee=f"{bank['name']}信用卡还款",
                action_label=m_repay.group(1),
                amt_str=m_repay.group(2),
                direction="支出",
                subject=subject,
                card_balance=card_balance,
                is_repayment=True,
            )]

        # 3. 消费 / 快捷支付 / 支取 / 扣款匹配
        # 句式 3A: 于/在【商户名称】(消费/快捷支付/支付) 128.00元
        m_pay_bracket = re.search(
            rf"(?:于|在)?【([^】]+)】\s*(?:完成)?(快捷支付|银联无卡支付|POS消费|网联支付|网络消费|线上消费|扫码支付|消费|支付|支出|扣款){amt_pat}",
            body
        )
        if m_pay_bracket:
            return [self._build_record(
                bank, card_tail, date_str, time_str,
                payee=m_pay_bracket.group(1),
                action_label=m_pay_bracket.group(2),
                amt_str=m_pay_bracket.group(3),
                direction="支出",
                subject=subject,
                card_balance=card_balance,
            )]

        # 句式 3B (招行/平安/中信/广发/浦发/光大/兴业常见): 在[商户](完成)(快捷支付/消费/支付)人民币38.00元
        m_pay_in = re.search(
            rf"在\s*([^，。；\n]+?)\s*(?:完成|发生|进行)?(快捷支付|银联无卡支付|POS消费|网联支付|网络消费|线上消费|扫码支付|消费|支付|代扣){amt_pat}",
            body
        )
        if m_pay_in:
            return [self._build_record(
                bank, card_tail, date_str, time_str,
                payee=m_pay_in.group(1),
                action_label=m_pay_in.group(2),
                amt_str=m_pay_in.group(3),
                direction="支出",
                subject=subject,
                card_balance=card_balance,
            )]

        # 句式 3C (工行/农行/中行/建行/交行/邮储/民生常见): (消费/支出/支取/快捷支付/网上支付)人民币100.00元...(对方为/商户/摘要: xxx)
        m_pay_state = re.search(
            rf"(快捷支付|网上支付|银联消费|财付通消费|支付宝消费|微信支付|POS消费|消费|支出|支取|转出|扣款|代扣)(?:人民币|CNY|RMB|¥|￥|\s)*([0-9,]+(?:\.\d+)?)\s*(?:元|CNY|RMB)?(?:.*?(?:对方(?:户名)?[为：:]+|商户(?:名称)?[为：:]+|交易地点[为：:]+|摘要[为：:]+|特约商户[为：:]+|【)([^，。；\s】]+))?",
            body
        )
        if m_pay_state:
            action_label = m_pay_state.group(1)
            amt_str = m_pay_state.group(2)
            payee = m_pay_state.group(3) or f"{bank['short']}卡({card_tail})动账"
            return [self._build_record(
                bank, card_tail, date_str, time_str,
                payee=payee,
                action_label=action_label,
                amt_str=amt_str,
                direction="支出",
                subject=subject,
                card_balance=card_balance,
            )]

        # 4. 收入 / 转入 / 工资 / 存入匹配
        m_income = re.search(
            rf"(他行实时转入|实时转入|转账存入|代发工资|工资入账|报销入账|转入|存入|入账){amt_pat}(?:.*?(?:付方|对方(?:户名)?|摘要)[为：:\s]*([^，。；\s]+))?",
            body
        )
        if m_income:
            action_label = m_income.group(1)
            amt_str = m_income.group(2)
            payer = (m_income.group(3) or "").strip()
            payee = f"付方:{payer}" if payer else f"{bank['short']}存入({action_label})"
            return [self._build_record(
                bank, card_tail, date_str, time_str,
                payee=payee,
                action_label=action_label,
                amt_str=amt_str,
                direction="收入",
                subject=subject,
                card_balance=card_balance,
            )]

        return []

    def parse_bytes(self, raw_bytes: bytes, fallback_date: Optional[datetime] = None) -> List[RawRecord]:
        """直接解析 raw eml 字节流"""
        msg = email.message_from_bytes(raw_bytes, policy=policy.default)
        subject = str(msg.get("Subject", ""))
        sender = str(msg.get("From", ""))
        body, raw_html = self._extract_body_and_html(msg)

        email_date_hdr = msg.get("Date")
        fallback_dt = None
        if email_date_hdr:
            try:
                fallback_dt = email.utils.parsedate_to_datetime(email_date_hdr)
            except Exception:
                pass
        if not fallback_dt:
            fallback_dt = fallback_date or datetime.now()

        records, _ = self._parse_core(
            subject=subject,
            sender=sender,
            body=body,
            raw_html=raw_html,
            fallback_dt=fallback_dt,
            use_ai_fallback=True,
        )
        return records

    def _parse_core(
        self,
        subject: str,
        sender: str,
        body: str,
        raw_html: str,
        fallback_dt: datetime,
        use_ai_fallback: bool = True
    ) -> Tuple[List[RawRecord], Dict[str, Any]]:
        """核心三层解析流水线，返回 (RawRecord列表, 诊断元数据)"""
        bank = self.identify_bank(sender, subject, body)
        meta: Dict[str, Any] = {
            "bank_code": bank["code"],
            "bank_name": bank["name"],
            "engine": "none",
        }

        if any(kw in body for kw in NON_TRANSACTION_KEYWORDS):
            meta["skipped_reason"] = "安全/非动账提醒邮件"
            return [], meta

        card_tail = self._extract_card_tail(body)

        # 第 2A 层：优先尝试 HTML 账单明细表解析（若包含多行交易）
        if raw_html:
            table_records = self._extract_html_table_records(raw_html, bank, subject, fallback_dt, card_tail)
            if table_records:
                meta["engine"] = "builtin_html_table"
                return table_records, meta

        # 第 2B 层：动账通知正文句式矩阵解析
        sentence_records = self._extract_sentence_records(body, bank, subject, fallback_dt, card_tail)
        if sentence_records:
            meta["engine"] = "builtin_regex"
            return sentence_records, meta

        # 第 3 层：可选 AI 语义兜底解析
        looks_like_bank_mail = (bank["code"] != "bank") or any(
            w in f"{subject} {body}" for w in ("尾号", "账单", "消费", "人民币", "CNY", "还款", "转入", "支出")
        )
        if use_ai_fallback and looks_like_bank_mail and self.ai_service and getattr(self.ai_service, "is_available", lambda: False)():
            ai_items = self.ai_service.parse_bank_email_fallback(
                subject=subject,
                sender=sender,
                body_text=body,
                default_date=fallback_dt.strftime("%Y-%m-%d")
            )
            if ai_items:
                ai_records: List[RawRecord] = []
                for idx, item in enumerate(ai_items):
                    b_name = item.get("bank_name") or bank["name"]
                    c_tail = item.get("card_tail") or card_tail
                    rec = self._build_record(
                        bank={"code": bank["code"], "name": b_name, "short": b_name[:2]},
                        card_tail=c_tail,
                        date_str=item.get("date") or fallback_dt.strftime("%Y-%m-%d"),
                        time_str=item.get("time_str") or f"12:00:{idx % 60:02d}",
                        payee=item.get("payee") or f"{b_name}商户",
                        action_label=item.get("narration") or "AI解析动账",
                        amt_str=str(item.get("amount", "0")),
                        direction=item.get("direction", "支出"),
                        subject=subject,
                        card_balance=None,
                        is_refund=bool(item.get("is_refund", False)),
                        is_repayment=bool(item.get("is_repayment", False)),
                        extra_meta={"parsed_by": "ai_fallback"}
                    )
                    ai_records.append(rec)
                if ai_records:
                    meta["engine"] = "ai_fallback"
                    meta["bank_name"] = ai_items[0].get("bank_name") or bank["name"]
                    return ai_records, meta

        return [], meta

    def parse_sample_text(
        self,
        raw_text: str,
        subject: str = "",
        sender: str = "",
        use_ai_fallback: bool = True
    ) -> Dict[str, Any]:
        """供前端『银行邮件解析测试器』调用的即时解析预览方法（不写入数据库）"""
        text = (raw_text or "").strip()
        if not text:
            return {"success": False, "message": "邮件内容不能为空", "records": []}

        raw_html = ""
        body = text
        if "<tr" in text.lower() or "<td" in text.lower() or "<html" in text.lower():
            raw_html = text
            cleaned = re.sub(r"<style[^>]*>.*?</style>", " ", text, flags=re.DOTALL | re.IGNORECASE)
            cleaned = re.sub(r"<script[^>]*>.*?</script>", " ", cleaned, flags=re.DOTALL | re.IGNORECASE)
            cleaned = re.sub(r"<[^>]+>", " ", cleaned)
            body = re.sub(r"\s+", " ", html.unescape(cleaned)).strip()

        records, meta = self._parse_core(
            subject=subject,
            sender=sender,
            body=body,
            raw_html=raw_html,
            fallback_dt=datetime.now(),
            use_ai_fallback=use_ai_fallback
        )

        serialized = []
        for r in records:
            serialized.append({
                "date": r.date,
                "time_str": r.time_str,
                "payee": r.payee,
                "narration": r.narration,
                "amount": float(r.amount),
                "direction": r.direction,
                "status_text": r.status_text,
                "channel": r.channel,
                "card_tail": r.raw_payload.get("card", "0000"),
                "is_refund": bool(r.raw_payload.get("is_refund", False)),
                "is_repayment": bool(r.raw_payload.get("is_repayment", False)),
                "parsed_by": r.raw_payload.get("parsed_by", meta.get("engine", "builtin_regex")),
            })

        return {
            "success": len(serialized) > 0,
            "bank_code": meta.get("bank_code"),
            "bank_name": meta.get("bank_name"),
            "engine": meta.get("engine"),
            "skipped_reason": meta.get("skipped_reason"),
            "records": serialized,
            "message": f"成功识别为【{meta.get('bank_name')}】，提取出 {len(serialized)} 笔交易流水" if serialized else (
                meta.get("skipped_reason") or "未匹配到标准动账句式（如开启 AI 服务可自动尝试语义提取）"
            )
        }

    def parse_file(self, file_path: Path) -> List[RawRecord]:
        raw_bytes = file_path.read_bytes()
        return self.parse_bytes(raw_bytes)
