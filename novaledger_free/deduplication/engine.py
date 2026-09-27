from datetime import datetime
from decimal import Decimal
from pathlib import Path
import secrets
from typing import Any, Dict, List, Optional, Tuple
from novaledger_free.core.db import DatabaseManager
from novaledger_free.core.ledger import LedgerManager
from novaledger_free.core.models import ImportStatus, SourceType, to_decimal
from novaledger_free.parsers.base import RawRecord


class ImportPipelineEngine:
    """可靠导入与四态去重引擎 (新增, 已匹配/重复, 待确认, 失败)"""

    def __init__(self, ledger_mgr: LedgerManager, db_mgr: DatabaseManager):
        self.ledger = ledger_mgr
        self.db = db_mgr

    def _match_merchant_rule(self, payee: str, narration: str) -> Optional[Dict[str, str]]:
        """按商户关键字长度倒序匹配，优先命中更具体的长词规则"""
        target_text = f"{payee} {narration}".lower()
        try:
            with self.db.get_connection() as conn:
                rows = conn.execute("SELECT * FROM merchant_rules ORDER BY LENGTH(keyword) DESC").fetchall()
                for r in rows:
                    kw = r["keyword"].lower()
                    if kw in target_text:
                        return {
                            "category": r["target_category"],
                            "account": r["target_account"] or ""
                        }
        except Exception:
            pass
        return self.db.match_merchant_rule(payee, narration)

    def _find_historical_category_for_payee(self, payee: str) -> Optional[str]:
        """从历史已入账流水中寻找同商户最近的支出分类"""
        if not payee:
            return None
        try:
            txs = self.ledger.get_all_transactions()
            clean_payee = payee.strip()
            for tx in reversed(txs):
                tx_p = (tx.get("payee") or "").strip()
                if not tx_p:
                    continue
                if tx_p == clean_payee or clean_payee in tx_p or tx_p in clean_payee:
                    for p in tx.get("postings", []):
                        acc = p.get("account", "")
                        if acc.startswith("Expenses:"):
                            return acc
        except Exception:
            pass
        return None

    def process_records(
        self,
        records: List[RawRecord],
        source_name: str,
        default_account: str,
        batch_id: Optional[str] = None
    ) -> Dict[str, Any]:
        actual_batch_id = batch_id or f"batch_{datetime.now().strftime('%Y%m%d%H%M%S')}_{secrets.token_hex(4)}"
        source_type_str = records[0].source_type.value if records else "unknown"

        self.db.create_batch(
            batch_id=actual_batch_id,
            filename=source_name,
            source_type=source_type_str,
            file_hash=secrets.token_hex(16)
        )

        added_count = 0
        duplicate_count = 0
        pending_count = 0
        failed_count = 0

        for r in records:
            # 1. 交易状态异常处理
            if any(fail_word in r.status_text for fail_word in ["失败", "已关闭", "交易关闭"]):
                failed_count += 1
                continue

            # 2. 精确来源订单号去重
            if r.source_tx_id:
                dup_tx = self.db.find_by_source_tx_id(r.source_type.value, r.source_tx_id)
                if dup_tx:
                    duplicate_count += 1
                    continue

            # 3. 核心要素指纹哈希去重
            dup_fp = self.db.find_by_fingerprint(r.fingerprint)
            if dup_fp:
                duplicate_count += 1
                continue

            # 4. 退款或存疑状态进入待确认队列 (不直接写入猜测账目)
            if "退款" in r.status_text or "退款" in r.direction or "退款" in r.narration:
                rule = self._match_merchant_rule(r.payee, r.narration)
                sugg_cat = rule["category"] if rule else None
                sugg_acc = (rule["account"] if (rule and rule.get("account")) else None) or r.raw_payload.get("account") or default_account
                if not sugg_cat:
                    orig_cat = self._find_historical_category_for_payee(r.payee)
                    sugg_cat = orig_cat or "Expenses:Other:General"
                payload_dict = dict(r.raw_payload) if isinstance(r.raw_payload, dict) else {}
                payload_dict["direction"] = r.direction
                payload_dict["is_refund"] = True
                self.db.add_pending_item({
                    "item_id": f"pend_{secrets.token_hex(6)}",
                    "batch_id": actual_batch_id,
                    "source_type": r.source_type.value,
                    "source_tx_id": r.source_tx_id,
                    "source_fingerprint": r.fingerprint,
                    "date": r.date,
                    "payee": r.payee,
                    "narration": r.narration,
                    "amount": str(r.amount),
                    "currency": "CNY",
                    "suggested_account": sugg_acc,
                    "suggested_category": sugg_cat,
                    "reason": f"检测到退款流程 ({r.status_text})，需人工确认冲减原消费科目",
                    "raw_payload": payload_dict
                })
                pending_count += 1
                continue

            # 5. 智能匹配商户记忆规则与默认科目
            rule = self._match_merchant_rule(r.payee, r.narration)
            target_cat = rule["category"] if rule else ("Income:Other" if r.direction == "收入" else "Expenses:Other:General")
            target_acc = (rule["account"] if (rule and rule.get("account")) else None) or r.raw_payload.get("account") or default_account

            if r.direction == "收入":
                postings = [
                    (target_acc, r.amount, "CNY"),
                    (target_cat, -r.amount, "CNY")
                ]
            else:
                postings = [
                    (target_cat, r.amount, "CNY"),
                    (target_acc, -r.amount, "CNY")
                ]

            ok, msg, _ = self.ledger.append_transaction(
                tx_date=r.date,
                payee=r.payee,
                narration=r.narration,
                postings=postings,
                source_type=r.source_type,
                source_tx_id=r.source_tx_id,
                source_fingerprint=r.fingerprint,
                import_batch=actual_batch_id
            )

            if ok:
                added_count += 1
            else:
                failed_count += 1

        self.db.update_batch_counts(actual_batch_id, added_count, duplicate_count, pending_count, failed_count)

        return {
            "batch_id": actual_batch_id,
            "total_processed": len(records),
            "added": added_count,
            "duplicate": duplicate_count,
            "pending": pending_count,
            "failed": failed_count
        }

    def rollback_batch(self, batch_id: str) -> Tuple[bool, str, int]:
        """安全撤销整批导入：查找所有标记有该 batch_id 的交易并批量原子回滚"""
        with self.db.get_connection() as conn:
            rows = conn.execute(
                "SELECT id FROM transactions_meta WHERE import_batch = ? AND status = 'active'",
                (batch_id,)
            ).fetchall()

        if not rows:
            return False, f"未找到批次 {batch_id} 的有效交易", 0

        rollback_success_count = 0
        for r in rows:
            ok, _ = self.ledger.delete_transaction(r["id"])
            if ok:
                rollback_success_count += 1

        return True, f"已成功撤销批次 {batch_id}，回滚 {rollback_success_count} 笔交易", rollback_success_count
