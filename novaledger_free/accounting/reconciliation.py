from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple
from novaledger_free.core.db import DatabaseManager
from novaledger_free.core.ledger import LedgerManager
from novaledger_free.core.models import (
    SourceType,
    TransactionModel,
    to_decimal
)


class ReconciliationEngine:
    """月末及定期对账引擎：实际余额核对、差额分析与调账分录生成"""

    def __init__(self, ledger_mgr: LedgerManager, db_mgr: DatabaseManager):
        self.ledger = ledger_mgr
        self.db = db_mgr

    def check_reconciliation(
        self,
        account: str,
        statement_date: str,
        actual_balance: Any
    ) -> Dict[str, Any]:
        """核对指定日期指定账户的账面余额与实际余额"""
        act_dec = to_decimal(actual_balance)
        # 获取截至 statement_date 的账面余额
        bal_res = self.ledger.get_balances(cutoff_date=statement_date)
        ledger_bal = Decimal(str(bal_res["account_balances"].get(account, 0.0))).quantize(Decimal("0.01"))

        diff = act_dec - ledger_bal

        potential_issues = []
        if diff != Decimal("0.00"):
            # 自动探测相关待确认交易
            pending_items = self.db.get_pending_items(status="pending")
            for item in pending_items:
                if item.get("suggested_account") == account:
                    potential_issues.append({
                        "type": "unconfirmed_pending_item",
                        "date": item.get("date"),
                        "amount": float(item.get("amount", 0)),
                        "payee": item.get("payee"),
                        "narration": item.get("narration")
                    })

        return {
            "account": account,
            "statement_date": statement_date,
            "ledger_balance": float(ledger_bal),
            "actual_balance": float(act_dec),
            "difference": float(diff),
            "is_balanced": (diff == Decimal("0.00")),
            "potential_issues": potential_issues
        }

    def apply_adjustment(
        self,
        account: str,
        statement_date: str,
        actual_balance: Any,
        reason: str = "月末对账人工校准",
        offset_account: str = "Equity:Opening-Balances"
    ) -> Tuple[bool, str, Optional[TransactionModel]]:
        """
        生成受审计支持的对账差额调账分录，保留原因并允许随时撤销
        """
        chk = self.check_reconciliation(account, statement_date, actual_balance)
        diff = Decimal(str(chk["difference"]))
        if diff == Decimal("0.00"):
            return False, "账实相符，无需生成调账分录", None

        # diff > 0 说明实际余额大于账面，需补记资产；diff < 0 说明实际少于账面，需减计资产
        postings = [
            (account, diff, "CNY"),
            (offset_account, -diff, "CNY")
        ]
        return self.ledger.append_transaction(
            tx_date=statement_date,
            payee="余额校准",
            narration=f"对账校准 (差额 ¥{diff:+.2f}): {reason}",
            postings=postings,
            source_type=SourceType.RECONCILIATION,
            extra_metadata={
                "reconciliation_account": account,
                "reconciliation_diff": str(diff),
                "reconciliation_reason": reason
            }
        )
