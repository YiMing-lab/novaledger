from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple
from novaledger_free.core.ledger import LedgerManager
from novaledger_free.core.models import (
    SourceType,
    TransactionModel,
    to_decimal
)


class TransactionOperations:
    """标准财务业务流：收支、内转、信用卡核销、退款费用冲减、拆分记账、借贷本息拆分"""

    def __init__(self, ledger_mgr: LedgerManager):
        self.ledger = ledger_mgr

    def record_income(
        self,
        date: str,
        payee: str,
        narration: str,
        amount: Any,
        target_account: str,
        income_category: str = "Income:Salary",
        currency: str = "CNY"
    ) -> Tuple[bool, str, Optional[TransactionModel]]:
        amt = to_decimal(amount)
        if amt <= Decimal("0.00"):
            return False, "收入金额必须大于0", None

        postings = [
            (target_account, amt, currency),
            (income_category, -amt, currency)
        ]
        return self.ledger.append_transaction(
            tx_date=date,
            payee=payee,
            narration=narration or "收入",
            postings=postings
        )

    def record_expense(
        self,
        date: str,
        payee: str,
        narration: str,
        amount: Any,
        source_account: str,
        expense_category: str,
        currency: str = "CNY"
    ) -> Tuple[bool, str, Optional[TransactionModel]]:
        amt = to_decimal(amount)
        if amt <= Decimal("0.00"):
            return False, "支出金额必须大于0", None

        postings = [
            (expense_category, amt, currency),
            (source_account, -amt, currency)
        ]
        return self.ledger.append_transaction(
            tx_date=date,
            payee=payee,
            narration=narration,
            postings=postings
        )

    def record_transfer(
        self,
        date: str,
        narration: str,
        amount: Any,
        from_account: str,
        to_account: str,
        payee: str = "",
        currency: str = "CNY"
    ) -> Tuple[bool, str, Optional[TransactionModel]]:
        amt = to_decimal(amount)
        if amt <= Decimal("0.00"):
            return False, "转账金额必须大于0", None
        if from_account == to_account:
            return False, "转出账户与转入账户不能相同", None

        default_payee = "内部转账"
        if to_account.startswith("Liabilities:Loan:"):
            default_payee = "归还贷款"
        elif to_account.startswith("Liabilities:CreditCard:"):
            default_payee = "信用卡还款"

        postings = [
            (to_account, amt, currency),
            (from_account, -amt, currency)
        ]
        return self.ledger.append_transaction(
            tx_date=date,
            payee=(payee or "").strip() or default_payee,
            narration=narration or f"{from_account} -> {to_account}",
            postings=postings
        )

    def record_credit_card_repayment(
        self,
        date: str,
        amount: Any,
        from_bank_account: str,
        to_credit_card_account: str,
        narration: str = "信用卡还款",
        currency: str = "CNY"
    ) -> Tuple[bool, str, Optional[TransactionModel]]:
        """
        信用卡还款：核销信用卡负债，绝不计入日常消费，保持借贷平衡
        """
        amt = to_decimal(amount)
        if amt <= Decimal("0.00"):
            return False, "还款金额必须大于0", None

        postings = [
            (to_credit_card_account, amt, currency),
            (from_bank_account, -amt, currency)
        ]
        return self.ledger.append_transaction(
            tx_date=date,
            payee="信用卡还款",
            narration=narration,
            postings=postings
        )

    def record_debt_repayment(
        self,
        date: str,
        amount: Any,
        from_bank_account: str,
        to_debt_account: str,
        payee: str = "偿还借款",
        narration: str = "",
        currency: str = "CNY"
    ) -> Tuple[bool, str, Optional[TransactionModel]]:
        """
        偿还借款/债务：从资产账户（银行卡/零钱）向负债借款账户（Liabilities:Loan:...）还款
        Beancount 分录：
          to_debt_account       amt CNY  (负债核销，负数绝对值减少)
          from_bank_account    -amt CNY  (银行存款资产减少)
        借贷严格平衡，不计入日常消费 Expenses，真实反映资产与负债变动。
        """
        amt = to_decimal(amount)
        if amt <= Decimal("0.00"):
            return False, "还款金额必须大于0", None
        if not from_bank_account or not from_bank_account.strip():
            return False, "请选择还款出资账户", None
        if not to_debt_account or not to_debt_account.strip():
            return False, "请选择偿还的债务账户", None

        postings = [
            (to_debt_account.strip(), amt, currency),
            (from_bank_account.strip(), -amt, currency)
        ]
        return self.ledger.append_transaction(
            tx_date=date,
            payee=payee or "偿还借款",
            narration=narration or f"偿还借款 - {to_debt_account}",
            postings=postings
        )

    def record_refund(
        self,
        date: str,
        payee: str,
        narration: str,
        refund_amount: Any,
        refund_to_account: str,
        original_expense_category: str = "Expenses:Other:General",
        original_tx_id: Optional[str] = None,
        currency: str = "CNY"
    ) -> Tuple[bool, str, Optional[TransactionModel]]:
        """
        消费退款：冲减原支出科目的费用（借记退款入账账户，贷记原支出科目），关联原消费
        """
        amt = to_decimal(refund_amount)
        if amt <= Decimal("0.00"):
            return False, "退款金额必须大于0", None

        postings = [
            (refund_to_account, amt, currency),
            (original_expense_category, -amt, currency)
        ]
        extra_meta = {}
        if original_tx_id:
            extra_meta["refund_of"] = original_tx_id

        return self.ledger.append_transaction(
            tx_date=date,
            payee=payee,
            narration=f"退款: {narration}" if narration else "消费退款",
            postings=postings,
            extra_metadata=extra_meta
        )

    def record_income_offset(
        self,
        date: str,
        payee: str,
        narration: str,
        offset_amount: Any,
        source_account: str,
        income_category: str = "Income:Other",
        original_tx_id: Optional[str] = None,
        currency: str = "CNY"
    ) -> Tuple[bool, str, Optional[TransactionModel]]:
        """
        收入对冲/扣还：冲减原收入科目的金额（借记收入科目，贷记扣款资金账户），使当期净收入真实下降
        """
        amt = to_decimal(offset_amount)
        if amt <= Decimal("0.00"):
            return False, "对冲金额必须大于0", None

        postings = [
            (income_category, amt, currency),
            (source_account, -amt, currency)
        ]
        extra_meta = {}
        if original_tx_id:
            extra_meta["offset_of"] = original_tx_id

        return self.ledger.append_transaction(
            tx_date=date,
            payee=payee,
            narration=narration or "收入退还/扣减",
            postings=postings,
            extra_metadata=extra_meta
        )

    def record_split_transaction(
        self,
        date: str,
        payee: str,
        narration: str,
        total_amount: Any,
        source_account: str,
        splits: List[Tuple[str, Any, str]],
        currency: str = "CNY"
    ) -> Tuple[bool, str, Optional[TransactionModel]]:
        """
        多科目拆分记账：一笔总扣款拆为多个分类（例如超市购物 = 食品 + 日用品），校验合计严格平账
        splits 格式: [(category_account, amount, note)]
        """
        total_dec = to_decimal(total_amount)
        split_sum = Decimal("0.00")
        postings = []

        for item in splits:
            cat_acc, cat_amt, _ = item
            d_amt = to_decimal(cat_amt)
            split_sum += d_amt
            postings.append((cat_acc, d_amt, currency))

        if split_sum != total_dec:
            return False, f"拆分项合计 ¥{split_sum:.2f} 与总金额 ¥{total_dec:.2f} 不一致", None

        postings.append((source_account, -total_dec, currency))
        return self.ledger.append_transaction(
            tx_date=date,
            payee=payee,
            narration=narration or "多分类拆分交易",
            postings=postings
        )

    def record_loan_repayment_with_interest(
        self,
        date: str,
        principal_amount: Any,
        interest_amount: Any,
        from_account: str,
        loan_liability_account: str,
        interest_expense_category: str = "Expenses:Financial:Interest",
        narration: str = "贷款还本付息",
        currency: str = "CNY"
    ) -> Tuple[bool, str, Optional[TransactionModel]]:
        """
        贷款还本付息：本金归还核销负债，利息计入财务利息支出，扣除银行资产
        """
        p_amt = to_decimal(principal_amount)
        i_amt = to_decimal(interest_amount)
        total = p_amt + i_amt

        postings = [
            (loan_liability_account, p_amt, currency),
            (interest_expense_category, i_amt, currency),
            (from_account, -total, currency)
        ]
        return self.ledger.append_transaction(
            tx_date=date,
            payee="贷款还款",
            narration=narration,
            postings=postings
        )
