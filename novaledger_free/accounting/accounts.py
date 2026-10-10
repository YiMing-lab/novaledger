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
            bal_val = balances.get(bean_acc, a.get("initial_balance", 0.0))
            item["current_balance"] = bal_val
            item["balance"] = bal_val
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
        sub_name: Optional[str] = None,
        currency: str = "CNY",
        initial_balance: Optional[Decimal | float | str] = None,
        opening_date: str = "2020-01-01",
        account: Optional[str] = None
    ) -> Tuple[bool, str, Optional[str]]:
        """
        根据中文业务类型或指定 Beancount 科目创建账户并自动在 accounts.bean 中开户；
        若有期初余额，自动在 transactions.bean 中生成 Equity:Opening-Balances 平账分录。
        """
        raw_account = (account or "").strip()
        if raw_account:
            parts = [p.strip() for p in raw_account.split(":") if p.strip()]
            if len(parts) < 2 or parts[0] not in ("Assets", "Liabilities", "Equity", "Income", "Expenses"):
                return False, f"无效的 Beancount 会计科目路径: '{raw_account}' (必须以 Assets: 或 Liabilities: 等标准根科目开头)", None
            beancount_account = ":".join(parts)

            # 根据科目自动校正账户分类 (确保信用卡正确归入 Liabilities, 资金卡归入 Assets)
            if beancount_account.startswith("Liabilities:CreditCard"):
                acc_type = "credit"
            elif beancount_account.startswith("Liabilities:Loan"):
                acc_type = "loan"
            elif beancount_account.startswith("Liabilities:"):
                if acc_type not in ("credit", "loan", "payable"):
                    acc_type = "payable"
            elif beancount_account.startswith("Assets:Bank"):
                acc_type = "debit"
            elif beancount_account.startswith("Assets:EWallet"):
                acc_type = "e_wallet"
            elif beancount_account.startswith("Assets:Cash"):
                acc_type = "cash"
            elif beancount_account.startswith("Assets:Invest"):
                acc_type = "invest"
            elif beancount_account.startswith("Assets:Receivable"):
                acc_type = "receivable"
            elif beancount_account.startswith("Assets:"):
                if acc_type not in ("debit", "cash", "e_wallet", "invest", "receivable"):
                    acc_type = "debit"
        else:
            if acc_type not in ACCOUNT_TYPE_MAP:
                return False, f"不支持的账户类型: {acc_type}", None

            prefix = ACCOUNT_TYPE_MAP[acc_type][1]
            sub_raw = (sub_name or "").strip()
            # 允许字母数字、横杠、下划线及冒号 (支持如 CMB:Card8888 结构)
            clean_sub = "".join(c for c in sub_raw if c.isalnum() or c in "-_:")
            clean_sub = ":".join(p for p in clean_sub.split(":") if p)
            if not clean_sub:
                clean_sub = "Card001" if acc_type in ("debit", "credit") else "Acc001"

            if clean_sub.startswith(f"{prefix}:"):
                beancount_account = clean_sub
            else:
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
                if acc_type in ("credit", "loan") or beancount_account.startswith("Liabilities:"):
                    # 信用卡/贷款/负债期初欠款在 Beancount 中负债为负数
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
        is_archived: Optional[bool] = None,
        account: Optional[str] = None
    ) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        """更新账户的中文名称、卡号尾号、账户类型、科目路径或归档状态"""
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

        if account is not None and account.strip():
            new_acc = account.strip()
            if new_acc != target.get("account"):
                # 校验是否已被其他账户占用
                for a in accounts:
                    if a["id"] != account_id and a.get("account") == new_acc:
                        return False, f"科目 '{new_acc}' 已被其他账户占用", None
                target["account"] = new_acc
                # 确保写入 accounts.bean
                open_line = f"2020-01-01 open {new_acc} CNY\n"
                current_acc_text = self.config_mgr.accounts_bean.read_text(encoding="utf-8")
                if new_acc not in current_acc_text:
                    self.config_mgr.accounts_bean.write_text(current_acc_text.rstrip() + "\n" + open_line, encoding="utf-8")

        self.config_mgr.save_config()
        return True, "账户信息更新成功", target

    def delete_account(self, account_id: str) -> Tuple[bool, str]:
        """删除账户配置；若该账户仅存在期初建账分录而无其他业务流水，同步清理期初建账分录"""
        accounts = self.config_mgr.config.get("accounts", [])
        target = None
        for i, a in enumerate(accounts):
            if a.get("id") == account_id:
                target = accounts.pop(i)
                break

        if not target:
            return False, f"未找到账户 {account_id}"

        bean_acc = target.get("account", "")
        if bean_acc:
            try:
                all_txs = self.ledger.get_all_transactions()
                related_txs = [
                    t for t in all_txs
                    if any(p.get("account") == bean_acc for p in t.get("postings", []))
                ]
                opening_txs = [t for t in related_txs if t.get("payee") == "期初建账"]
                if related_txs and len(opening_txs) == len(related_txs):
                    for otx in opening_txs:
                        if otx.get("id"):
                            self.ledger.delete_transaction(otx["id"])
            except Exception:
                pass

        self.config_mgr.save_config()
        return True, f"已删除账户「{target.get('name', account_id)}」"

