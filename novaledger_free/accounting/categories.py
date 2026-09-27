import secrets
from typing import Any, Dict, List, Optional, Tuple
from novaledger_free.core.config import ConfigManager
from novaledger_free.core.ledger import LedgerManager

DEFAULT_CATEGORIES = [
    {"id": "cat_food_dining", "name": "餐饮美食", "account": "Expenses:Food:Dining", "type": "expense", "icon": "restaurant"},
    {"id": "cat_food_groceries", "name": "买菜生鲜", "account": "Expenses:Food:Groceries", "type": "expense", "icon": "shopping_cart"},
    {"id": "cat_food_snacks", "name": "零食水果", "account": "Expenses:Food:Snacks", "type": "expense", "icon": "icecream"},
    {"id": "cat_transport_taxi", "name": "打车出行", "account": "Expenses:Transport:Taxi", "type": "expense", "icon": "local_taxi"},
    {"id": "cat_transport_transit", "name": "交通通行", "account": "Expenses:Transport:Transit", "type": "expense", "icon": "directions_subway"},
    {"id": "cat_housing_rent", "name": "住房房租", "account": "Expenses:Housing:Rent", "type": "expense", "icon": "home"},
    {"id": "cat_housing_utilities", "name": "水电物业", "account": "Expenses:Housing:Utilities", "type": "expense", "icon": "bolt"},
    {"id": "cat_shopping_daily", "name": "日常百货", "account": "Expenses:Shopping:Daily", "type": "expense", "icon": "local_mall"},
    {"id": "cat_shopping_digital", "name": "数码配件", "account": "Expenses:Shopping:Digital", "type": "expense", "icon": "devices"},
    {"id": "cat_shopping_clothing", "name": "服饰鞋包", "account": "Expenses:Shopping:Clothing", "type": "expense", "icon": "checkroom"},
    {"id": "cat_entertainment", "name": "休闲娱乐", "account": "Expenses:Entertainment", "type": "expense", "icon": "sports_esports"},
    {"id": "cat_health_medical", "name": "医疗健康", "account": "Expenses:Health:Medical", "type": "expense", "icon": "medical_services"},
    {"id": "cat_travel_lodging", "name": "酒店住宿", "account": "Expenses:Travel:Lodging", "type": "expense", "icon": "hotel"},
    {"id": "cat_financial_interest", "name": "贷款利息", "account": "Expenses:Financial:Interest", "type": "expense", "icon": "account_balance"},
    {"id": "cat_other_general", "name": "日常其他", "account": "Expenses:Other:General", "type": "expense", "icon": "more_horiz"},
    {"id": "cat_other", "name": "其他杂项", "account": "Expenses:Other", "type": "expense", "icon": "category"},
    {"id": "cat_income_salary", "name": "工资薪金", "account": "Income:Salary", "type": "income", "icon": "payments"},
    {"id": "cat_income_invest", "name": "投资收益", "account": "Income:Investment", "type": "income", "icon": "trending_up"},
    {"id": "cat_income_other", "name": "其他收入", "account": "Income:Other", "type": "income", "icon": "attach_money"},
    {"id": "cat_income_transfer", "name": "转账存入", "account": "Income:Transfer:Incoming", "type": "income", "icon": "savings"}
]


class CategoryManager:
    """分类元数据管理：增删改查、Beancount 开户关联与安全归档"""

    def __init__(self, config_mgr: ConfigManager, ledger_mgr: LedgerManager):
        self.config_mgr = config_mgr
        self.ledger = ledger_mgr
        self._ensure_initialized()

    def _ensure_initialized(self) -> None:
        """确保 config.json 中存在 categories 键，若无则初始化默认分类"""
        cats = self.config_mgr.config.get("categories")
        if cats is None:
            self.config_mgr.config["categories"] = [dict(c) for c in DEFAULT_CATEGORIES]
            self.config_mgr.save_config()

    def list_categories(self, include_archived: bool = False) -> List[Dict[str, Any]]:
        self._ensure_initialized()
        cats = self.config_mgr.config.get("categories", [])
        if not include_archived:
            cats = [c for c in cats if not c.get("is_archived", False)]
        return cats

    def get_category_by_id(self, cat_id: str) -> Optional[Dict[str, Any]]:
        for c in self.list_categories(include_archived=True):
            if c["id"] == cat_id:
                return c
        return None

    def get_category_by_account(self, account: str) -> Optional[Dict[str, Any]]:
        acc = account.strip()
        for c in self.list_categories(include_archived=True):
            if c["account"] == acc:
                return c
        return None

    def add_category(
        self,
        name: str,
        account: str,
        cat_type: str = "expense",
        icon: str = ""
    ) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        name = name.strip()
        account = account.strip()
        if not name:
            return False, "分类名称不能为空", None
        if not account:
            return False, "Beancount 科目不能为空", None

        # 校验科目格式
        if cat_type == "expense" and not account.startswith("Expenses:"):
            account = f"Expenses:{account}"
        elif cat_type == "income" and not account.startswith("Income:"):
            account = f"Income:{account}"

        # 检查是否已存在
        for c in self.list_categories(include_archived=True):
            if c["account"] == account:
                if c.get("is_archived"):
                    c["is_archived"] = False
                    c["name"] = name
                    if icon:
                        c["icon"] = icon
                    self.config_mgr.save_config()
                    return True, "分类已从归档中恢复", c
                return False, f"科目 {account} 已存在", None

        # 确保在 accounts.bean 中开户
        self.ledger.ensure_account_open(account)

        cat_id = f"cat_{secrets.token_hex(4)}"
        new_cat = {
            "id": cat_id,
            "name": name,
            "account": account,
            "type": cat_type,
            "icon": icon or ("restaurant" if cat_type == "expense" else "attach_money"),
            "is_archived": False
        }

        self.config_mgr.config.setdefault("categories", []).append(new_cat)
        self.config_mgr.save_config()
        return True, "分类添加成功", new_cat

    def update_category(
        self,
        cat_id: str,
        name: Optional[str] = None,
        icon: Optional[str] = None,
        is_archived: Optional[bool] = None
    ) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        self._ensure_initialized()
        cats = self.config_mgr.config.get("categories", [])
        target = None
        for c in cats:
            if c["id"] == cat_id:
                target = c
                break

        if not target:
            return False, f"未找到 ID 为 {cat_id} 的分类", None

        if name is not None and name.strip():
            target["name"] = name.strip()
        if icon is not None and icon.strip():
            target["icon"] = icon.strip()
        if is_archived is not None:
            target["is_archived"] = bool(is_archived)

        self.config_mgr.save_config()
        return True, "分类更新成功", target

    def delete_or_archive_category(self, cat_id: str) -> Tuple[bool, str]:
        """
        删除或归档分类：
        若历史交易中有使用该分类，为了保护复式记账一致性，将其设为 is_archived=True；
        若无历史引用，则彻底从配置中移除。
        """
        self._ensure_initialized()
        cats = self.config_mgr.config.get("categories", [])
        target = None
        for c in cats:
            if c["id"] == cat_id:
                target = c
                break

        if not target:
            return False, f"未找到 ID 为 {cat_id} 的分类"

        target_acc = target["account"]
        # 检查是否有关联交易
        has_tx = False
        try:
            txs = self.ledger.get_all_transactions()
            for t in txs:
                for p in t.get("postings", []):
                    if p.get("account") == target_acc:
                        has_tx = True
                        break
                if has_tx:
                    break
        except Exception:
            has_tx = True

        if has_tx:
            target["is_archived"] = True
            self.config_mgr.save_config()
            return True, "该分类已有历史交易关联，为保证账本平衡已安全归档"
        else:
            self.config_mgr.config["categories"] = [c for c in cats if c["id"] != cat_id]
            self.config_mgr.save_config()
            return True, "分类已彻底删除"
