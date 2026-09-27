from datetime import datetime
from decimal import Decimal
import os
from pathlib import Path
import re
import secrets
from typing import Any, Dict, List, Optional, Tuple

from beancount import loader
from beancount.core.data import Transaction

from novaledger_free.core.ledger import LedgerManager
from novaledger_free.core.models import SourceType, to_decimal


class LegacyMigrator:
    """旧版账本迁移引擎：安全平滑迁移 v1/v2/v3 账本，保留原始文件，出具差异与可疑项报告"""

    def __init__(self, target_ledger: LedgerManager):
        self.target_ledger = target_ledger

    def inspect_and_migrate(self, legacy_data_dir: Path) -> Dict[str, Any]:
        legacy_dir = Path(legacy_data_dir).resolve()
        legacy_main = legacy_dir / "ledger" / "main.bean"
        legacy_tx_bean = legacy_dir / "ledger" / "transactions.bean"
        legacy_acc_bean = legacy_dir / "ledger" / "accounts.bean"

        if not legacy_main.exists() and not legacy_tx_bean.exists():
            return {
                "success": False,
                "message": f"在指定路径未找到有效的 Beancount 账本文件: {legacy_dir}",
                "report": {}
            }

        # 1. 尝试使用 loader 加载旧账本
        load_target = str(legacy_main) if legacy_main.exists() else str(legacy_tx_bean)
        entries, errors, _ = loader.load_file(load_target)

        report = {
            "source_dir": str(legacy_dir),
            "total_legacy_entries": len(entries),
            "legacy_errors_detected": [str(e) for e in errors],
            "migrated_count": 0,
            "suspicious_items": [],
            "skipped_count": 0
        }

        # 2. 逐笔转换迁移并赋予新版稳定 ID 与元数据
        migrated_transactions = []
        for e in entries:
            if isinstance(e, Transaction):
                tx_date = str(e.date)
                payee = e.payee or ""
                narration = e.narration or ""
                postings = []
                for p in e.postings:
                    if p.units:
                        amt = Decimal(str(p.units.number))
                        curr = p.units.currency or "CNY"
                        postings.append((p.account, amt, curr))

                # 可疑项检测：如果分录不足2条或借贷不平
                if len(postings) < 2:
                    report["suspicious_items"].append({
                        "date": tx_date,
                        "payee": payee,
                        "reason": "分录行不足2条，已跳过"
                    })
                    report["skipped_count"] += 1
                    continue

                sum_amt = sum(p[1] for p in postings)
                if abs(sum_amt) > Decimal("0.01"):
                    report["suspicious_items"].append({
                        "date": tx_date,
                        "payee": payee,
                        "reason": f"借贷存在差额 ¥{sum_amt}，进入可疑清单"
                    })
                    report["skipped_count"] += 1
                    continue

                # 正常入账
                stable_id = f"nl_mig_{secrets.token_hex(6)}"
                ok, msg, _ = self.target_ledger.append_transaction(
                    tx_date=tx_date,
                    payee=payee,
                    narration=f"[迁移] {narration}".strip(),
                    postings=postings,
                    source_type=SourceType.MIGRATION,
                    source_tx_id=f"legacy_{tx_date}_{payee}",
                    tx_id=stable_id
                )

                if ok:
                    report["migrated_count"] += 1
                else:
                    report["suspicious_items"].append({
                        "date": tx_date,
                        "payee": payee,
                        "reason": msg
                    })
                    report["skipped_count"] += 1

        # 3. 校验迁移后新账本
        valid, new_errors = self.target_ledger.validate_ledger()
        report["target_ledger_valid"] = valid
        report["target_validation_errors"] = new_errors

        return {
            "success": True,
            "message": f"迁移完成：成功转入 {report['migrated_count']} 笔交易，发现 {len(report['suspicious_items'])} 项存疑",
            "report": report
        }
