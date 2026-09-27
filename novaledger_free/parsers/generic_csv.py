import csv
from pathlib import Path
from typing import Dict, List, Optional
from novaledger_free.core.models import SourceType, to_decimal
from novaledger_free.parsers.base import RawRecord
from novaledger_free.parsers.wechat_csv import read_text_with_encodings


class GenericCSVParser:
    """通用 CSV 自定义列映射解析器"""

    def parse_file(self, file_path: Path, col_mapping: Dict[str, str]) -> List[RawRecord]:
        """
        col_mapping 示例:
        {
            "date": "交易日期",
            "payee": "商户/对手",
            "narration": "说明",
            "amount": "金额",
            "tx_id": "流水号"
        }
        """
        content = read_text_with_encodings(file_path)
        lines = [l for l in content.splitlines() if l.strip()]
        if not lines:
            return []

        csv_reader = csv.reader(lines)
        headers = [h.strip() for h in next(csv_reader)]
        header_map = {h: i for i, h in enumerate(headers)}

        date_col = col_mapping.get("date", "日期")
        payee_col = col_mapping.get("payee", "对方")
        narr_col = col_mapping.get("narration", "摘要")
        amt_col = col_mapping.get("amount", "金额")
        id_col = col_mapping.get("tx_id", "单号")

        records: List[RawRecord] = []
        for row_idx, row in enumerate(csv_reader):
            if not row:
                continue

            def val(cname: str) -> str:
                idx = header_map.get(cname)
                return row[idx].strip() if (idx is not None and idx < len(row)) else ""

            date_str = val(date_col)
            if not date_str:
                continue
            date_str = date_str[:10].replace("/", "-")

            payee = val(payee_col) or "外部交易"
            narration = val(narr_col) or payee
            amt_raw = val(amt_col).replace("¥", "").replace(",", "").strip()
            tx_id = val(id_col) or f"gen_csv_{row_idx}_{date_str}"

            try:
                amt = to_decimal(amt_raw)
            except Exception:
                continue

            rec = RawRecord(
                date=date_str,
                time_str="00:00:00",
                payee=payee,
                narration=narration,
                amount=abs(amt),
                direction="支出" if amt > 0 else "收入",
                status_text="成功",
                source_type=SourceType.GENERIC_CSV,
                source_tx_id=tx_id,
                channel="",
                category_hint="通用导入",
                raw_payload={"row_index": row_idx}
            )
            records.append(rec)

        return records
