"""
执行从旧版 data/ 目录到 novaledger_free/data/ 的全量真实数据平滑录入。
包含：
1. 账户科目合并与无缝开户 (accounts.bean)
2. 借款负债初始建账迁移 (debts.bean)
3. 历史真实交易流水迁移、赋予唯一稳定ID并建立SQLite索引 (transactions.bean & metadata.db)
4. 卡片配置、债务配置、邮箱自动轮询配置迁移 (config.json)
5. 邮箱授权码与 Gemini API Key 的 Windows DPAPI 硬件级加密落盘 (secrets.json)
6. 智能商户规则录入 (merchant_rules)
7. 账本 0 错误校验与 Card7861 余额核验 (50,622.00 CNY)
"""

import json
import os
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = Path(__file__).resolve().parent.parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

import yaml
from beancount import loader
from beancount.core.data import Transaction, Open
from beancount.core import realization

from novaledger_free.core.config import ConfigManager
from novaledger_free.core.db import DatabaseManager
from novaledger_free.core.ledger import LedgerManager
from novaledger_free.core.models import Posting, SourceType, TransactionModel, to_decimal
from novaledger_free.core.security import SecurityManager


def run_migration():
    base_dir = Path(__file__).resolve().parent.parent.parent
    legacy_dir = base_dir / "data"
    target_data_dir = base_dir / "novaledger_free" / "data"

    print("[1/7] 初始化目标环境...")
    config_mgr = ConfigManager(data_dir=target_data_dir)
    db_mgr = DatabaseManager(config_mgr.sqlite_db_path)
    sec_mgr = SecurityManager(config_mgr.data_dir / "secrets.json")
    ledger_mgr = LedgerManager(config_mgr, db_mgr)

    # 1. 迁移与合并 accounts.bean
    print("[2/7] 合并与补齐账户开户定义 (accounts.bean)...")
    legacy_acc_file = legacy_dir / "ledger" / "accounts.bean"
    target_acc_file = config_mgr.accounts_bean

    legacy_acc_text = legacy_acc_file.read_text(encoding="utf-8") if legacy_acc_file.exists() else ""
    target_acc_text = target_acc_file.read_text(encoding="utf-8") if target_acc_file.exists() else ""

    opened_accounts = set()
    open_regex = re.compile(r"^\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\s+open\s+([A-Za-z0-9:-]+)", re.MULTILINE)
    for m in open_regex.finditer(target_acc_text):
        opened_accounts.add(m.group(2))

    lines_to_add = []
    for line in legacy_acc_text.splitlines():
        line_clean = line.strip()
        m = open_regex.match(line_clean)
        if m:
            acc_name = m.group(2)
            if acc_name not in opened_accounts:
                opened_accounts.add(acc_name)
                lines_to_add.append(line)
        elif line_clean.startswith(";") and line_clean:
            # 注释分类标头
            if any(k in line_clean for k in ["资产", "负债", "权益", "收入", "支出", "动态"]):
                lines_to_add.append(line)

    if lines_to_add:
        updated_acc_text = target_acc_text.rstrip() + "\n\n; ----------------- 原账本迁移科目 -----------------\n" + "\n".join(lines_to_add) + "\n"
        target_acc_file.write_text(updated_acc_text, encoding="utf-8")
        print(f"   [OK] 已成功补全 {len(lines_to_add)} 行会计科目定义")

    # 2. 迁移 debts.bean
    print("[3/7] 迁移负债借款初始建账 (debts.bean)...")
    legacy_debts_file = legacy_dir / "ledger" / "debts.bean"
    if legacy_debts_file.exists():
        debts_content = legacy_debts_file.read_text(encoding="utf-8")
        config_mgr.debts_bean.write_text(debts_content, encoding="utf-8")
        print("   [OK] debts.bean 已成功迁移")

    # 3. 迁移 transactions.bean
    print("[4/7] 结构化迁移历史交易流水并建立唯一稳定 ID (transactions.bean)...")
    legacy_main_file = legacy_dir / "ledger" / "main.bean"
    entries, errors, _ = loader.load_file(str(legacy_main_file))
    if errors:
        print(f"   [WARN] 原账本加载存在 {len(errors)} 个错误")

    migrated_tx_models = []
    # 筛选出属于 transactions.bean 的交易（排除 debts.bean 中的期初待还借款）
    tx_entries = [e for e in entries if isinstance(e, Transaction)]
    debt_accounts = {"Liabilities:Loan:Debt1", "Liabilities:Loan:Debt2", "Liabilities:Loan:Debt3", "Liabilities:Loan:Debt4", "Liabilities:Loan:Debt5"}

    for idx, e in enumerate(tx_entries):
        # 检查是否全部是 debt 借款初始化分录
        is_pure_debt = all(p.account in debt_accounts or p.account.startswith("Equity:") for p in e.postings) and any(p.account in debt_accounts for p in e.postings)
        if is_pure_debt:
            # 已经在 debts.bean 中独立维护
            continue

        postings = [
            Posting(account=p.account, amount=to_decimal(p.units.number), currency=p.units.currency or "CNY")
            for p in e.postings if p.units
        ]
        tx_id = f"nl_mig_tx_{len(migrated_tx_models) + 1:04d}"
        tm = TransactionModel(
            id=tx_id,
            date=str(e.date),
            payee=e.payee or "",
            narration=e.narration or "",
            postings=postings,
            source_type=SourceType.MIGRATION,
            tags=list(e.tags or []),
            links=list(e.links or [])
        )
        migrated_tx_models.append(tm)

    # 写入 target transactions.bean
    header = "; -*- mode: beancount -*-\n; 星芒账本历史交易明细 (原程序平滑导入)\n\n"
    tx_blocks = [tm.to_beancount_str() for tm in migrated_tx_models]
    config_mgr.transactions_bean.write_text(header + "\n\n".join(tx_blocks) + "\n", encoding="utf-8")
    print(f"   [OK] 成功转入 {len(migrated_tx_models)} 笔交易明细")

    # 在 SQLite 中建立索引
    for tm in migrated_tx_models:
        db_mgr.record_transaction(tm)
    print("   [OK] SQLite transactions_meta 元数据索引同步完成")

    # 4. 迁移 config.json
    print("[5/7] 迁移账户卡片与系统设置 (config.json)...")
    legacy_cfg_file = legacy_dir / "config.yaml"
    legacy_cfg = {}
    if legacy_cfg_file.exists():
        with open(legacy_cfg_file, "r", encoding="utf-8") as f:
            legacy_cfg = yaml.safe_load(f) or {}

    # 用户账户卡片列表
    migrated_accounts = [
        {
            "id": "acc_cmb_8225",
            "name": "消费卡 (招商银行8225)",
            "type": "debit",
            "account": "Assets:Bank:CMB:Card8225",
            "card_tail": "8225",
            "initial_balance": 1000.0,
            "is_archived": False
        },
        {
            "id": "acc_cmb_7861",
            "name": "存钱卡 (招商银行7861)",
            "type": "debit",
            "account": "Assets:Bank:CMB:Card7861",
            "card_tail": "7861",
            "initial_balance": 10000.0,
            "is_archived": False
        },
        {
            "id": "acc_salary",
            "name": "工资卡",
            "type": "debit",
            "account": "Assets:Bank:Salary",
            "card_tail": "",
            "initial_balance": 0.0,
            "is_archived": False
        },
        {
            "id": "acc_invest",
            "name": "其他投资理财账户",
            "type": "invest",
            "account": "Assets:Invest:Broker",
            "card_tail": "",
            "initial_balance": 0.0,
            "is_archived": False
        },
        {
            "id": "wechat",
            "name": "微信零钱",
            "type": "e_wallet",
            "account": "Assets:EWallet:WeChat",
            "initial_balance": 0.0,
            "is_archived": False
        },
        {
            "id": "alipay",
            "name": "支付宝余额",
            "type": "e_wallet",
            "account": "Assets:EWallet:Alipay",
            "initial_balance": 0.0,
            "is_archived": False
        }
    ]

    config_mgr.config["accounts"] = migrated_accounts
    config_mgr.config["debts"] = legacy_cfg.get("debts", [])

    # 邮箱与AI配置
    config_mgr.config["mail_sync"] = {
        "enabled": True,
        "imap_host": "imap.163.com",
        "imap_port": 993,
        "username": "15218851337@163.com",
        "folder": "INBOX",
        "last_sync_time": None,
        "last_seen_uid": 0,
        "uidvalidity": 0
    }

    config_mgr.config["system"]["ai_enabled"] = True
    config_mgr.config["system"]["ai_provider"] = "gemini"
    config_mgr.config["system"]["ai_model"] = "gemini-3.8-flash"
    config_mgr.save_config()
    print("   [OK] config.json 已完整更新")

    # 5. 凭据迁移 (secrets.json via DPAPI)
    print("[6/7] 硬件级 DPAPI 加密迁移邮箱与 Gemini API Key 凭据...")
    legacy_env_file = legacy_dir / ".env"
    email_code = ""
    gemini_key = ""
    if legacy_env_file.exists():
        env_text = legacy_env_file.read_text(encoding="utf-8")
        for l in env_text.splitlines():
            if l.startswith("EMAIL_AUTH_CODE="):
                email_code = l.split("=", 1)[1].strip()
            elif l.startswith("GEMINI_API_KEY="):
                gemini_key = l.split("=", 1)[1].strip()

    if email_code:
        sec_mgr.save_credential("email_auth_code", email_code)
        print("   [OK] 邮箱授权码已安全加密落盘")
    if gemini_key:
        sec_mgr.save_credential("gemini_api_key", gemini_key)
        print("   [OK] Gemini API Key 已安全加密落盘 (适配 gemini-3.8-flash)")

    # 6. 商户规则迁移
    legacy_rules_file = legacy_dir / "user_rules.json"
    if legacy_rules_file.exists():
        with open(legacy_rules_file, "r", encoding="utf-8") as f:
            rules_data = json.load(f)
            for r in rules_data:
                kw = r.get("pattern") or r.get("clean_merchant")
                cat = r.get("account", "Expenses:Other:General")
                if kw:
                    db_mgr.save_merchant_rule(kw, cat)
        print(f"   [OK] 已导入 {len(rules_data)} 条商户智能分类规则")

    # 7. 全量验证与余额核算
    print("[7/7] 全面核验新账本...")
    valid, errs = ledger_mgr.validate_ledger()
    if not valid:
        print(f"   [FAIL] 新账本校验失败: {errs}")
        sys.exit(1)
    print("   [PASS] Beancount 复式记账引擎校验通过: 0 errors!")

    balances = ledger_mgr.get_balances()
    card7861_bal = balances.get("account_balances", {}).get("Assets:Bank:CMB:Card7861", 0.0)
    card8225_bal = balances.get("account_balances", {}).get("Assets:Bank:CMB:Card8225", 0.0)
    salary_bal = balances.get("account_balances", {}).get("Assets:Bank:Salary", 0.0)
    broker_bal = balances.get("account_balances", {}).get("Assets:Invest:Broker", 0.0)

    print("\n======== 录入后资产负债核对报告 ========")
    print(f"净资产 (Net Worth)       : ¥{balances['net_worth']:,.2f}")
    print(f"总资产 (Total Assets)    : ¥{balances['total_assets']:,.2f}")
    print(f"总负债 (Total Liabilities): ¥{balances['total_liabilities']:,.2f}")
    print("----------------------------------------")
    print(f"招商银行存钱卡 (Card7861): ¥{card7861_bal:,.2f}  (期望: ¥50,622.00)")
    print(f"招商银行消费卡 (Card8225): ¥{card8225_bal:,.2f}  (期望: ¥1,909.20)")
    print(f"工资卡账户     (Salary)  : ¥{salary_bal:,.2f}  (期望: ¥6,683.00)")
    print(f"投资理财账户   (Broker)  : ¥{broker_bal:,.2f}  (期望: ¥14,343.00)")
    print("========================================\n")

    assert abs(card7861_bal - 50622.00) < 0.001, f"Card7861 余额不符! 实际: {card7861_bal}"
    assert abs(card8225_bal - 1909.20) < 0.001, f"Card8225 余额不符! 实际: {card8225_bal}"
    assert abs(salary_bal - 6683.00) < 0.001, f"Salary 余额不符! 实际: {salary_bal}"
    assert abs(broker_bal - 14343.00) < 0.001, f"Broker 余额不符! 实际: {broker_bal}"
    print("[SUCCESS] 数据录入 100% 精确完成，所有账户余额分毫不差！")


if __name__ == "__main__":
    run_migration()
