import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional


DEFAULT_SYSTEM_CONFIG: Dict[str, Any] = {
    "version": "2.0.0",
    "port": 8088,
    "host": "127.0.0.1",
    "enable_debt_module": True,
    "auto_open_browser": True,
    "ai_enabled": False,
    "ai_provider": "gemini",
    "ai_model": "gemini-3.8-flash",
    "imap_sync_interval_minutes": 60,
    "max_backup_count": 10,
}

DEFAULT_ACCOUNTS: List[Dict[str, Any]] = [
    {
        "id": "cash",
        "name": "现金钱包",
        "type": "cash",
        "account": "Assets:Cash:Wallet",
        "is_archived": False,
    },
    {
        "id": "bank_default",
        "name": "默认银行卡",
        "type": "debit",
        "account": "Assets:Bank:Default:Card001",
        "is_archived": False,
    },
    {
        "id": "wechat",
        "name": "微信零钱",
        "type": "e_wallet",
        "account": "Assets:EWallet:WeChat",
        "is_archived": False,
    },
    {
        "id": "alipay",
        "name": "支付宝余额",
        "type": "e_wallet",
        "account": "Assets:EWallet:Alipay",
        "is_archived": False,
    },
    {
        "id": "credit_default",
        "name": "默认信用卡",
        "type": "credit",
        "account": "Liabilities:CreditCard:Default:Card001",
        "is_archived": False,
    },
]


class ConfigManager:
    """独立的配置与数据目录管理器，支持动态注入数据根目录，杜绝与原程序数据混淆"""

    def _resolve_data_dir(self, data_dir: Optional[Path | str] = None) -> Path:
        import sys
        if data_dir is not None:
            return Path(data_dir).resolve()
        if os.environ.get("NOVALEDGER_DATA_DIR"):
            return Path(os.environ["NOVALEDGER_DATA_DIR"]).resolve()

        if getattr(sys, "frozen", False):
            # 独立 EXE 运行模式：绝对严格绑定到 EXE 同级目录的 data/ 文件夹，实现纯正绿色便携
            exe_dir = Path(sys.executable).resolve().parent
            return (exe_dir / "data").resolve()

        # 源码开发/测试模式
        candidates: List[Path] = []
        source_free_dir = Path(__file__).resolve().parent.parent
        candidates.append(source_free_dir.parent / "data")
        candidates.append(source_free_dir / "data")

        cwd = Path.cwd().resolve()
        candidates.append(cwd / "data")
        candidates.append(cwd / "novaledger_free" / "data")

        # 优先寻找包含已有 ledger/main.bean 或 config.json 的数据目录
        for c in candidates:
            if c.exists() and ((c / "ledger" / "main.bean").exists() or (c / "config.json").exists()):
                return c.resolve()

        return (source_free_dir.parent / "data").resolve()

    def __init__(self, data_dir: Optional[Path | str] = None):
        self.data_dir = self._resolve_data_dir(data_dir)

        self.ledger_dir = self.data_dir / "ledger"
        self.sqlite_dir = self.data_dir / "sqlite"
        self.backups_dir = self.data_dir / "backups"
        self.imports_dir = self.data_dir / "imports"
        self.logs_dir = self.data_dir / "logs"

        self.main_bean = self.ledger_dir / "main.bean"
        self.accounts_bean = self.ledger_dir / "accounts.bean"
        self.transactions_bean = self.ledger_dir / "transactions.bean"
        self.debts_bean = self.ledger_dir / "debts.bean"
        self.sqlite_db_path = self.sqlite_dir / "metadata.db"
        self.config_json_path = self.data_dir / "config.json"

        self.config: Dict[str, Any] = {}
        self.init_data_dir()
        self.load_config()

    def init_data_dir(self) -> None:
        """初始化必要子目录及初始 Beancount 账本模版"""
        for d in (self.ledger_dir, self.sqlite_dir, self.backups_dir, self.imports_dir, self.logs_dir):
            d.mkdir(parents=True, exist_ok=True)

        if not self.debts_bean.exists():
            self.debts_bean.write_text('; -*- mode: beancount -*-\n', encoding="utf-8")

        if not self.main_bean.exists():
            self.main_bean.write_text(
                '; -*- mode: beancount -*-\n'
                'option "title" "星芒账本 · NovaLedger"\n'
                'option "operating_currency" "CNY"\n\n'
                'include "accounts.bean"\n'
                'include "debts.bean"\n'
                'include "transactions.bean"\n',
                encoding="utf-8"
            )
        else:
            main_content = self.main_bean.read_text(encoding="utf-8")
            if 'include "debts.bean"' not in main_content:
                if 'include "transactions.bean"' in main_content:
                    main_content = main_content.replace('include "transactions.bean"', 'include "debts.bean"\ninclude "transactions.bean"')
                else:
                    main_content = main_content.rstrip() + '\ninclude "debts.bean"\n'
                self.main_bean.write_text(main_content, encoding="utf-8")

        if not self.accounts_bean.exists():
            # 基础科目预设
            initial_accounts = (
                '; -*- mode: beancount -*-\n'
                '2020-01-01 open Assets:Cash:Wallet CNY\n'
                '2020-01-01 open Assets:Bank:Default:Card001 CNY\n'
                '2020-01-01 open Assets:EWallet:WeChat CNY\n'
                '2020-01-01 open Assets:EWallet:Alipay CNY\n'
                '2020-01-01 open Liabilities:CreditCard:Default:Card001 CNY\n'
                '2020-01-01 open Income:Salary CNY\n'
                '2020-01-01 open Income:Investment CNY\n'
                '2020-01-01 open Income:Other CNY\n'
                '2020-01-01 open Expenses:Food:Dining CNY\n'
                '2020-01-01 open Expenses:Food:Groceries CNY\n'
                '2020-01-01 open Expenses:Food:Snacks CNY\n'
                '2020-01-01 open Expenses:Housing:Rent CNY\n'
                '2020-01-01 open Expenses:Housing:Utilities CNY\n'
                '2020-01-01 open Expenses:Transport:Transit CNY\n'
                '2020-01-01 open Expenses:Shopping:Daily CNY\n'
                '2020-01-01 open Expenses:Shopping:Electronics CNY\n'
                '2020-01-01 open Expenses:Entertainment:General CNY\n'
                '2020-01-01 open Expenses:Health:Medical CNY\n'
                '2020-01-01 open Expenses:Financial:Interest CNY\n'
                '2020-01-01 open Expenses:Other:General CNY\n'
                '2020-01-01 open Equity:Opening-Balances CNY\n'
            )
            self.accounts_bean.write_text(initial_accounts, encoding="utf-8")

        if not self.transactions_bean.exists():
            self.transactions_bean.write_text('; -*- mode: beancount -*-\n', encoding="utf-8")

    def load_config(self) -> Dict[str, Any]:
        """加载配置文件，若不存在则创建默认配置"""
        if self.config_json_path.exists():
            try:
                self.config = json.loads(self.config_json_path.read_text(encoding="utf-8"))
            except Exception:
                self.config = self._get_default_config()
                self.save_config()
        else:
            self.config = self._get_default_config()
            self.save_config()
        return self.config

    def _get_default_config(self) -> Dict[str, Any]:
        return {
            "system": dict(DEFAULT_SYSTEM_CONFIG),
            "accounts": list(DEFAULT_ACCOUNTS),
            "debts": [],
            "custom_rules": {},
            "mail_sync": {
                "enabled": False,
                "imap_host": "imap.exmail.qq.com",
                "imap_port": 993,
                "username": "",
                "folder": "INBOX",
                "last_sync_time": None,
                "last_seen_uid": 0,
                "uidvalidity": 0,
            }
        }

    def save_config(self) -> None:
        """持久化配置到 config.json (注意: 密码/密钥通过 security 模块单向加密保存，不存此处)"""
        self.config_json_path.write_text(
            json.dumps(self.config, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )
