from datetime import datetime
import email
from email import policy
import email.utils
import re
from pathlib import Path
from typing import List, Optional
from novaledger_free.core.models import SourceType, to_decimal
from novaledger_free.parsers.base import RawRecord


class EMLParser:
    """本地 .eml 邮件账单/交易通知解析器 (已针对招商银行、工商银行脱敏样本验证)"""

    def _extract_body(self, msg: email.message.EmailMessage) -> str:
        parts = []
        if msg.is_multipart():
            for part in msg.walk():
                ct = part.get_content_type()
                if ct in ("text/plain", "text/html"):
                    payload = part.get_payload(decode=True)
                    if payload:
                        charset = part.get_content_charset() or "utf-8"
                        enc_list = [charset, "utf-8", "gb18030", "gbk", "latin1"]
                        for enc in enc_list:
                            try:
                                text = payload.decode(enc)
                                if ct == "text/html":
                                    text = re.sub(r"<[^>]+>", " ", text)
                                parts.append(text)
                                break
                            except UnicodeDecodeError:
                                continue
        else:
            payload = msg.get_payload(decode=True)
            if payload:
                charset = msg.get_content_charset() or "utf-8"
                enc_list = [charset, "utf-8", "gb18030", "gbk", "latin1"]
                for enc in enc_list:
                    try:
                        text = payload.decode(enc)
                        if msg.get_content_type() == "text/html":
                            text = re.sub(r"<[^>]+>", " ", text)
                        parts.append(text)
                        break
                    except UnicodeDecodeError:
                        continue
            else:
                try:
                    parts.append(str(msg.get_content()))
                except Exception:
                    pass
        res = " ".join(parts)
        return re.sub(r"\s+", " ", res).strip()

    def parse_bytes(self, raw_bytes: bytes, fallback_date: Optional[datetime] = None) -> List[RawRecord]:
        """直接解析 raw eml 字节流"""
        msg = email.message_from_bytes(raw_bytes, policy=policy.default)
        subject = str(msg.get("Subject", ""))
        body = self._extract_body(msg)

        # 尝试从邮件 Date 标头提取备用时间
        email_date_hdr = msg.get("Date")
        fallback_dt = None
        if email_date_hdr:
            try:
                fallback_dt = email.utils.parsedate_to_datetime(email_date_hdr)
            except Exception:
                pass
        if not fallback_dt:
            fallback_dt = fallback_date or datetime.now()

        # 过滤非动账类安全提醒通知（如修改限额、密码修改、关闭取款等）
        if any(kw in body for kw in ["限额修改", "修改POS", "关闭境外", "关闭取款", "开通功能", "限额调整"]):
            return []

        records: List[RawRecord] = []

        # 1. 招商银行动账通知匹配
        tail_match = re.search(r'(?:账户|尾号)(\d{4})', body)
        if tail_match:
            card_last4 = tail_match.group(1)
            date_match = re.search(r'于(\d{1,2})月(\d{1,2})日(?:\s*(\d{1,2}:\d{2}))?', body)
            if date_match:
                m = int(date_match.group(1))
                d = int(date_match.group(2))
                t_str = date_match.group(3) or "12:00"
                time_str = f"{t_str}:00" if len(t_str) == 5 else t_str
                date_str = f"{fallback_dt.year:04d}-{m:02d}-{d:02d}"
            else:
                date_str = fallback_dt.strftime("%Y-%m-%d")
                time_str = fallback_dt.strftime("%H:%M:%S")

            bal_match = re.search(r'余额\s*(\d+(?:\.\d+)?)', body)
            card_balance = float(bal_match.group(1)) if bal_match else None

            # 支出：在...快捷支付...元
            pay_match = re.search(r'在(.+?)(快捷支付|银联无卡支付|POS消费|消费|扫码支付|支付)\s*(\d+(?:\.\d+)?)元', body)
            if pay_match:
                payee = pay_match.group(1).strip()
                pay_type = pay_match.group(2).strip()
                amt = to_decimal(pay_match.group(3))
                rec = RawRecord(
                    date=date_str,
                    time_str=time_str,
                    payee=payee,
                    narration=f"招行卡({card_last4}) {pay_type}",
                    amount=amt,
                    direction="支出",
                    status_text="成功",
                    source_type=SourceType.BANK_EMAIL,
                    source_tx_id=f"eml_cmb_{card_last4}_{date_str}_{time_str.replace(':', '')}_{amt}",
                    channel=f"招商银行({card_last4})",
                    category_hint="银行通知",
                    raw_payload={
                        "subject": subject,
                        "card": card_last4,
                        "balance": card_balance,
                        "source": "cmb_email"
                    }
                )
                records.append(rec)
                return records

            # 退款：在...退款...元 或 退款...元
            refund_match = re.search(r'在(.+?)(?:的)?(退款)\s*(\d+(?:\.\d+)?)元', body)
            if not refund_match:
                refund_match = re.search(r'(退款)\s*(\d+(?:\.\d+)?)元', body)

            if refund_match:
                if refund_match.lastindex and refund_match.lastindex >= 3:
                    payee = refund_match.group(1).strip()
                    pay_type = refund_match.group(2).strip()
                    amt = to_decimal(refund_match.group(3))
                else:
                    payee = "商户退款"
                    pay_type = "退款"
                    amt = to_decimal(refund_match.group(2) if refund_match.lastindex and refund_match.lastindex >= 2 else refund_match.group(1))

                rec = RawRecord(
                    date=date_str,
                    time_str=time_str,
                    payee=payee,
                    narration=f"招行卡({card_last4}) {pay_type}",
                    amount=amt,
                    direction="收入",
                    status_text="退款",
                    source_type=SourceType.BANK_EMAIL,
                    source_tx_id=f"eml_cmb_{card_last4}_{date_str}_{time_str.replace(':', '')}_{amt}",
                    channel=f"招商银行({card_last4})",
                    category_hint="退款",
                    raw_payload={
                        "subject": subject,
                        "card": card_last4,
                        "balance": card_balance,
                        "source": "cmb_email",
                        "is_refund": True,
                        "direction": "收入"
                    }
                )
                records.append(rec)
                return records

            # 收入：实时转入/他行实时转入/代发工资
            transfer_match = re.search(r'(他行实时转入|转入|转账存入|代发工资|实时转入)人民币?\s*(\d+(?:\.\d+)?)(?:[，,]\s*付方(.+?))?', body)
            if transfer_match:
                pay_type = transfer_match.group(1).strip()
                amt = to_decimal(transfer_match.group(2))
                payer = (transfer_match.group(3) or "").strip()
                payee = f"付方:{payer}" if payer else f"招行存入({pay_type})"
                rec = RawRecord(
                    date=date_str,
                    time_str=time_str,
                    payee=payee,
                    narration=f"招行卡({card_last4}) {pay_type}",
                    amount=amt,
                    direction="收入",
                    status_text="成功",
                    source_type=SourceType.BANK_EMAIL,
                    source_tx_id=f"eml_cmb_{card_last4}_{date_str}_{time_str.replace(':', '')}_{amt}",
                    channel=f"招商银行({card_last4})",
                    category_hint="银行通知",
                    raw_payload={
                        "subject": subject,
                        "card": card_last4,
                        "balance": card_balance,
                        "source": "cmb_email"
                    }
                )
                records.append(rec)
                return records

            # 通用兜底
            generic_match = re.search(r'(支出|存入|转出|转入|扣款|消费|退款).*?(\d+(?:\.\d+)?)元', body)
            if generic_match:
                action = generic_match.group(1)
                amt = to_decimal(generic_match.group(2))
                is_refund = (action == "退款")
                direction = "支出" if action in ["支出", "转出", "扣款", "消费"] else "收入"
                status_text = "退款" if is_refund else "成功"
                rec = RawRecord(
                    date=date_str,
                    time_str=time_str,
                    payee=f"招行卡({card_last4})动账",
                    narration=f"招行卡({card_last4}) {action}",
                    amount=amt,
                    direction=direction,
                    status_text=status_text,
                    source_type=SourceType.BANK_EMAIL,
                    source_tx_id=f"eml_cmb_{card_last4}_{date_str}_{time_str.replace(':', '')}_{amt}",
                    channel=f"招商银行({card_last4})",
                    category_hint="退款" if is_refund else "银行通知",
                    raw_payload={
                        "subject": subject,
                        "card": card_last4,
                        "balance": card_balance,
                        "source": "cmb_email",
                        "is_refund": is_refund,
                        "direction": direction
                    }
                )
                records.append(rec)
                return records

        # 2. 工商银行消费通知匹配
        icbc_match = re.search(r"(?:账户|尾号)(\d{4})卡.*?(?:消费|支出)\s*([0-9,.]+)\s*元.*?对方为([^\s，。]+)", body)
        if icbc_match:
            card_last4, amt_str, payee = icbc_match.groups()
            date_str = fallback_dt.strftime("%Y-%m-%d")
            time_str = fallback_dt.strftime("%H:%M:%S")
            amt = to_decimal(amt_str.replace(",", ""))

            rec = RawRecord(
                date=date_str,
                time_str=time_str,
                payee=payee.strip(),
                narration=f"工行卡({card_last4}) 消费",
                amount=amt,
                direction="支出",
                status_text="成功",
                source_type=SourceType.BANK_EMAIL,
                source_tx_id=f"eml_icbc_{card_last4}_{date_str}_{time_str.replace(':', '')}_{amt}",
                channel=f"工商银行({card_last4})",
                category_hint="银行通知",
                raw_payload={"subject": subject, "card": card_last4, "source": "icbc_email"}
            )
            records.append(rec)
            return records

        return records

    def parse_file(self, file_path: Path) -> List[RawRecord]:
        raw_bytes = file_path.read_bytes()
        return self.parse_bytes(raw_bytes)
