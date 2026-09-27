# -*- coding: utf-8 -*-
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from novaledger_free.core.config import ConfigManager
from novaledger_free.core.ledger import LedgerManager
from novaledger_free.core.models import to_decimal


class DebtManager:
    """
    债务管理核心模块：
    1. 债务列表与待还余额实时计算（从 Beancount 聚合负债科目余额）
    2. 债务属性编辑（友好名称、还款方式、月供、到期年月、期数、备注）
    3. 新增债务（自动在 debts.bean 中开户并生成借贷平衡的期初负债分录）
    4. 债务删除/归档
    """

    def __init__(self, config_mgr: ConfigManager, ledger_mgr: LedgerManager):
        self.config_mgr = config_mgr
        self.ledger = ledger_mgr

    def list_debts(self) -> Dict[str, Any]:
        """返回全部债务清单及待还总额统计"""
        debts = self.config_mgr.config.get("debts", [])
        try:
            balances = self.ledger.get_balances().get("account_balances", {})
        except Exception:
            balances = {}

        total_initial = Decimal("0.00")
        total_remaining = Decimal("0.00")
        total_monthly = Decimal("0.00")
        active_count = 0

        enriched_debts: List[Dict[str, Any]] = []
        for d in debts:
            item = dict(d)
            item["is_archived"] = bool(d.get("is_archived", False))
            acc = d.get("account", "")
            init_amt = to_decimal(d.get("initial_amount", 0.0))

            # Beancount 中 Liabilities 为负数，当前待还余额为取绝对值正数
            bean_balance = balances.get(acc)
            if bean_balance is not None:
                rem_amt = abs(to_decimal(bean_balance))
            else:
                rem_amt = init_amt

            item["current_balance"] = float(rem_amt)

            if not item["is_archived"]:
                active_count += 1
                total_initial += init_amt
                total_remaining += rem_amt
                monthly_pay = to_decimal(d.get("monthly_payment", 0.0))
                if d.get("type") == "monthly":
                    total_monthly += monthly_pay

            enriched_debts.append(item)

        return {
            "debts": enriched_debts,
            "summary": {
                "count": active_count,
                "total_initial": float(total_initial),
                "total_remaining": float(total_remaining),
                "total_monthly": float(total_monthly)
            }
        }

    def get_debt_by_id(self, debt_id: str) -> Optional[Dict[str, Any]]:
        for d in self.config_mgr.config.get("debts", []):
            if d.get("id") == debt_id:
                return d
        return None

    def create_debt(
        self,
        name: str,
        initial_amount: float,
        due_date: Optional[str] = None,
        monthly_payment: Optional[float] = None,
        total_periods: Optional[int] = None,
        debt_type: str = "monthly",
        note: Optional[str] = "",
        account: Optional[str] = None,
        opening_date: Optional[str] = None
    ) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        """创建新债务并在 debts.bean 中生成合规的 Beancount 分录"""
        if not name or not name.strip():
            return False, "债务名称不能为空", None
        if initial_amount is None or initial_amount < 0:
            return False, "债务金额必须为非负数", None

        debts = self.config_mgr.config.setdefault("debts", [])

        # 生成账号科目名
        if not account or not account.strip():
            next_idx = len(debts) + 1
            account = f"Liabilities:Loan:Debt{next_idx}"
            # 保证唯一性
            existing_accounts = {d.get("account") for d in debts}
            while account in existing_accounts:
                next_idx += 1
                account = f"Liabilities:Loan:Debt{next_idx}"

        debt_id = f"debt_{int(datetime.now().timestamp())}_{len(debts)+1}"
        open_date = opening_date or "2026-01-01"

        # 写入 debts.bean
        debts_file = self.config_mgr.debts_bean
        content = debts_file.read_text(encoding="utf-8") if debts_file.exists() else "; -*- mode: beancount -*-\n"

        # 如果科目未开户，自动开户
        accounts_text = self.config_mgr.accounts_bean.read_text(encoding="utf-8") if self.config_mgr.accounts_bean.exists() else ""
        if account not in accounts_text and account not in content:
            content += f"\n{open_date} open {account} CNY\n"

        # 生成建账分录
        amt_dec = to_decimal(initial_amount)
        posting_text = (
            f"\n; 期初待还借款: {name} ({debt_type} 到期: {due_date or '未知'})\n"
            f"{open_date} * \"系统录入\" \"录入期初待还借款 - {name}\"\n"
            f"  {account}   -{amt_dec:.2f} CNY\n"
            f"  Equity:Opening-Balances   {amt_dec:.2f} CNY\n"
        )
        content += posting_text
        debts_file.write_text(content, encoding="utf-8")

        new_debt = {
            "id": debt_id,
            "name": name.strip(),
            "account": account.strip(),
            "initial_amount": float(amt_dec),
            "type": debt_type or "monthly",
            "due_date": due_date or "",
            "total_periods": total_periods or 1,
            "monthly_payment": float(to_decimal(monthly_payment or 0.0)),
            "note": note or "",
            "is_archived": False
        }
        debts.append(new_debt)
        self.config_mgr.save_config()

        # 校验账本
        valid, errors = self.ledger.validate_ledger()
        if not valid:
            return False, f"账本校验发现差额: {errors}", None

        return True, "债务录入成功", new_debt

    def update_debt(
        self,
        debt_id: str,
        name: Optional[str] = None,
        due_date: Optional[str] = None,
        monthly_payment: Optional[float] = None,
        total_periods: Optional[int] = None,
        debt_type: Optional[str] = None,
        note: Optional[str] = None,
        initial_amount: Optional[float] = None,
        is_archived: Optional[bool] = None
    ) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        """更新债务元数据信息、归档状态与 Beancount 初始金额"""
        debts = self.config_mgr.config.get("debts", [])
        target = None
        for d in debts:
            if d.get("id") == debt_id:
                target = d
                break

        if not target:
            return False, f"未找到 ID 为 '{debt_id}' 的债务", None

        old_account = target.get("account")
        old_name = target.get("name")
        old_amt = target.get("initial_amount", 0.0)

        if name is not None and name.strip():
            target["name"] = name.strip()
        if due_date is not None:
            target["due_date"] = due_date.strip()
        if monthly_payment is not None:
            target["monthly_payment"] = float(to_decimal(monthly_payment))
        if total_periods is not None:
            target["total_periods"] = int(total_periods)
        if debt_type is not None:
            target["type"] = debt_type.strip()
        if note is not None:
            target["note"] = note.strip()
        if is_archived is not None:
            target["is_archived"] = bool(is_archived)

        # 如果修改了 initial_amount，同步更新 debts.bean 中对应该科目的初始录入分录
        if initial_amount is not None and abs(initial_amount - old_amt) > 0.001:
            target["initial_amount"] = float(to_decimal(initial_amount))
            debts_file = self.config_mgr.debts_bean
            if debts_file.exists():
                lines = debts_file.read_text(encoding="utf-8").splitlines(keepends=True)
                new_lines = []
                in_target_tx = False
                new_amt_dec = to_decimal(initial_amount)
                for line in lines:
                    if f"录入期初待还借款 - {old_name}" in line or old_account in line:
                        in_target_tx = True
                    if in_target_tx and old_account in line and "CNY" in line:
                        indent = line[:len(line) - len(line.lstrip())]
                        new_lines.append(f"{indent}{old_account}   -{new_amt_dec:.2f} CNY\n")
                    elif in_target_tx and "Equity:Opening-Balances" in line and "CNY" in line:
                        indent = line[:len(line) - len(line.lstrip())]
                        new_lines.append(f"{indent}Equity:Opening-Balances   {new_amt_dec:.2f} CNY\n")
                        in_target_tx = False
                    else:
                        new_lines.append(line)
                debts_file.write_text("".join(new_lines), encoding="utf-8")

        self.config_mgr.save_config()

        # 校验账本平衡
        valid, errors = self.ledger.validate_ledger()
        if not valid:
            return False, f"修改后账本校验存在差额: {errors}", None

        return True, "债务更新成功", target

    def delete_debt(self, debt_id: str) -> Tuple[bool, str]:
        """移除债务配置"""
        debts = self.config_mgr.config.get("debts", [])
        target = None
        for i, d in enumerate(debts):
            if d.get("id") == debt_id:
                target = debts.pop(i)
                break

        if not target:
            return False, f"未找到 ID 为 '{debt_id}' 的债务"

        self.config_mgr.save_config()
        return True, f"已成功删除债务「{target.get('name')}」"

