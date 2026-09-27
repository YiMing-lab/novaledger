import csv
import io
from pathlib import Path
from typing import List, Tuple
from novaledger_free.core.models import SourceType, to_decimal
from novaledger_free.parsers.base import RawRecord


def read_text_with_encodings(file_path: Path) -> str:
    raw_bytes = file_path.read_bytes()
    for enc in ["utf-8-sig", "utf-8", "gb18030", "gbk"]:
        try:
            return raw_bytes.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw_bytes.decode("utf-8", errors="ignore")


class WeChatCSVParser:
    """微信支付官方 CSV 账单解析器"""

    HEADER_KEY = "交易单号"

    def parse_file(self, file_path: Path) -> List[RawRecord]:
        content = read_text_with_encodings(file_path)
        lines = content.splitlines()

        header_idx = -1
        for idx, line in enumerate(lines):
            if self.HEADER_KEY in line and "金额" in line:
                header_idx = idx
                break

        if header_idx == -1:
            raise ValueError("未在文件中检测到有效的微信支付账单表头")

        csv_reader = csv.reader(lines[header_idx:])
        headers = [h.strip() for h in next(csv_reader)]
        header_map = {h: i for i, h in enumerate(headers)}

        records: List[RawRecord] = []
        for row in csv_reader:
            if not row or len(row) < 5:
                continue

            def get_col(col_name: str) -> str:
                idx = header_map.get(col_name)
                return row[idx].strip() if (idx is not None and idx < len(row)) else ""

            tx_time = get_col("交易时间")
            if not tx_time or len(tx_time) < 10:
                continue

            date_str = tx_time[:10]
            time_str = tx_time[11:19] if len(tx_time) >= 19 else "00:00:00"

            tx_type = get_col("交易类型")
            payee = get_col("交易对方")
            goods = get_col("商品")
            direction = get_col("收/支")
            amount_raw = get_col("金额(元)").replace("¥", "").replace(",", "").strip()
            channel = get_col("支付方式")
            status_text = get_col("当前状态")
            tx_id = get_col("交易单号").strip()
            remarks = get_col("备注")

            narration = f"{goods} {remarks}".strip() if goods else remarks or tx_type

            try:
                amt = to_decimal(amount_raw)
            except Exception:
                continue

            record = RawRecord(
                date=date_str,
                time_str=time_str,
                payee=payee or "微信商户",
                narration=narration or tx_type,
                amount=amt,
                direction=direction or ("支出" if "/" not in direction else "其他"),
                status_text=status_text,
                source_type=SourceType.WECHAT_CSV,
                source_tx_id=tx_id,
                channel=channel,
                category_hint=tx_type,
                raw_payload={"type": tx_type, "goods": goods, "channel": channel, "status": status_text}
            )
            records.append(record)

        return records
