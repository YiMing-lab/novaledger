from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple
from novaledger_free.core.config import ConfigManager
from novaledger_free.core.ledger import LedgerManager
from novaledger_free.core.models import to_decimal


ACCOUNT_TYPE_MAP = {
    "debit": ("储蓄卡/银行卡", "Assets:Bank"),
    "credit": ("信用卡", "Liabilities:CreditCard"),
    "cash": ("现金", "Assets:Cash"),
    "e_wallet": ("微信/支付宝钱包", "Assets:EWallet"),
    "invest": ("投资理财账户", "Assets:Invest"),
    "loan": ("贷款负债", "Liabilities:Loan"),
    "receivable": ("借出款/应收款", "Assets:Receivable"),
    "payable": ("向他人借入/应付款", "Liabilities:Payable"),
}


class AccountManager:
    """中文账户管理：科目生成、期初建账、账户安全归档/停用"""

    def __init__(self, config_mgr: ConfigManager, ledger_mgr: LedgerManager):
        self.config_mgr = config_mgr
        self.ledger = ledger_mgr

    def list_accounts(self, include_archived: bool = False) -> List[Dict[str, Any]]:
        accounts = self.config_mgr.config.get("accounts", [])
        if not include_archived:
            accounts = [a for a in accounts if not a.get("is_archived", False)]
        
        try:
            balances = self.ledger.get_balances().get("account_balances", {})
        except Exception:
            balances = {}

        result = []
        for a in accounts:
            item = dict(a)
            bean_acc = a.get("account", "")
            item["current_balance"] = balances.get(bean_acc, a.get("initial_balance", 0.0))
            result.append(item)
        return result

    def get_account_by_id(self, account_id: str) -> Optional[Dict[str, Any]]:
        for a in self.config_mgr.config.get("accounts", []):
            if a["id"] == account_id:
                return a
        return None

    def create_account(
        self,
        account_id: str,
        name: str,
        acc_type: str,
        sub_name: str,
        currency: str = "CNY",
        initial_balance: Optional[Decimal | float | str] = None,
        opening_date: str = "2020-01-01"
    ) -> Tuple[bool, str, Optional[str]]:
        """
        根据中文业务类型创建账户并自动在 accounts.bean 中开户；
        若有期初余额，自动在 transactions.bean 中生成 Equity:Opening-Balances 平账分录。
        """
        if acc_type not in ACCOUNT_TYPE_MAP:
            return False, f"不支持的账户类型: {acc_type}", None

        prefix = ACCOUNT_TYPE_MAP[acc_type][1]
        clean_sub = "".join(c for c in sub_name if c.isalnum() or c in "-_")
        if not clean_sub:
            clean_sub = "Acc001"
        beancount_account = f"{prefix}:{clean_sub}"

        # 检查是否已存在
        for a in self.config_mgr.config.get("accounts", []):
            if a["id"] == account_id or a["account"] == beancount_account:
                return False, f"账户 ID '{account_id}' 或科目 '{beancount_account}' 已存在", None

        # 1. 写入 accounts.bean
        open_line = f"{opening_date} open {beancount_account} {currency}\n"
        current_acc_text = self.config_mgr.accounts_bean.read_text(encoding="utf-8")
        if beancount_account not in current_acc_text:
            self.config_mgr.accounts_bean.write_text(current_acc_text.rstrip() + "\n" + open_line, encoding="utf-8")

        # 2. 保存配置
        account_info = {
            "id": account_id,
            "name": name,
            "type": acc_type,
            "account": beancount_account,
            "is_archived": False,
            "created_at": datetime.now().isoformat()
        }
        self.config_mgr.config.setdefault("accounts", []).append(account_info)
        self.config_mgr.save_config()

        # 3. 处理期初余额
        if initial_balance is not None:
            init_dec = to_decimal(initial_balance)
            if init_dec != Decimal("0.00"):
                if acc_type == "credit" or acc_type == "loan":
                    # 信用卡/贷款期初欠款在 Beancount 中负债为负数
                    postings = [
                        (beancount_account, -abs(init_dec), currency),
                        ("Equity:Opening-Balances", abs(init_dec), currency)
                    ]
                    narration = f"期初建账 (欠款: ¥{abs(init_dec):.2f})"
                else:
                    postings = [
                        (beancount_account, init_dec, currency),
                        ("Equity:Opening-Balances", -init_dec, currency)
                    ]
                    narration = f"期初建账 (余额: ¥{init_dec:.2f})"

                self.ledger.append_transaction(
                    tx_date=opening_date,
                    payee="期初建账",
                    narration=narration,
                    postings=postings
                )

        return True, "账户创建成功", beancount_account

    def archive_account(self, account_id: str) -> Tuple[bool, str]:
        """归档/停用账户：仅在界面选择列表中隐藏，历史流水与会计资产计算保持不变"""
        accounts = self.config_mgr.config.get("accounts", [])
        found = False
        for a in accounts:
            if a["id"] == account_id:
                a["is_archived"] = True
                found = True
                break
        if not found:
            return False, f"未找到账户 {account_id}"

        self.config_mgr.save_config()
        return True, "账户已安全归档"

    def unarchive_account(self, account_id: str) -> Tuple[bool, str]:
        accounts = self.config_mgr.config.get("accounts", [])
        for a in accounts:
            if a["id"] == account_id:
                a["is_archived"] = False
                self.config_mgr.save_config()
                return True, "账户已恢复启用"
        return False, f"未找到账户 {account_id}"

    def update_account(
        self,
        account_id: str,
        name: Optional[str] = None,
        card_tail: Optional[str] = None,
        acc_type: Optional[str] = None,
        is_archived: Optional[bool] = None
    ) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        """更新账户的中文名称、卡号尾号、账户类型或归档状态"""
        accounts = self.config_mgr.config.get("accounts", [])
        target = None
        for a in accounts:
            if a["id"] == account_id:
                target = a
                break

        if not target:
            return False, f"未找到账户 {account_id}", None

        if name is not None and name.strip():
            target["name"] = name.strip()
        if card_tail is not None:
            target["card_tail"] = card_tail.strip()
        if acc_type is not None and acc_type.strip():
            if acc_type in ACCOUNT_TYPE_MAP:
                target["type"] = acc_type.strip()
        if is_archived is not None:
            target["is_archived"] = bool(is_archived)

        self.config_mgr.save_config()
        return True, "账户信息更新成功", target

