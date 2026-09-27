import csv
from pathlib import Path
from typing import List
from novaledger_free.core.models import SourceType, to_decimal
from novaledger_free.parsers.base import RawRecord
from novaledger_free.parsers.wechat_csv import read_text_with_encodings


class AlipayCSVParser:
    """支付宝官方 CSV 账单解析器"""

    HEADER_KEY = "交易订单号"

    def parse_file(self, file_path: Path) -> List[RawRecord]:
        content = read_text_with_encodings(file_path)
        lines = content.splitlines()

        header_idx = -1
        for idx, line in enumerate(lines):
            if (self.HEADER_KEY in line or "订单号" in line) and "金额" in line:
                header_idx = idx
                break

        if header_idx == -1:
            raise ValueError("未在文件中检测到有效的支付宝账单表头")

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

            payee = get_col("交易对方")
            goods = get_col("商品说明")
            direction = get_col("收/支")
            amount_raw = get_col("金额").replace("¥", "").replace(",", "").strip()
            channel = get_col("收/付款方式")
            status_text = get_col("交易状态")
            tx_id = get_col("交易订单号") or get_col("订单号")
            remarks = get_col("备注")

            narration = f"{goods} {remarks}".strip() if goods else remarks or "支付宝交易"

            try:
                amt = to_decimal(amount_raw)
            except Exception:
                continue

            record = RawRecord(
                date=date_str,
                time_str=time_str,
                payee=payee or "支付宝商户",
                narration=narration,
                amount=amt,
                direction=direction or "支出",
                status_text=status_text,
                source_type=SourceType.ALIPAY_CSV,
                source_tx_id=tx_id,
                channel=channel,
                category_hint="支付宝交易",
                raw_payload={"goods": goods, "channel": channel, "status": status_text}
            )
            records.append(record)

        return records
