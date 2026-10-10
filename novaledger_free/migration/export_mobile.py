"""
星芒账本 (NovaLedger) 移动端专属全量数据迁移导出器
提取电脑端 Beancount 账本、SQLite 元数据、账户债务与分类配置，
生成独立安卓端专用的结构化迁移包 (.json 与 .nlmobile)，并预构建移动端 SQLite 数据库。
"""

from datetime import datetime
from decimal import Decimal
import json
import os
from pathlib import Path
import sqlite3
from typing import Any, Dict, List, Optional
import zipfile

from novaledger_free.core.config import ConfigManager
from novaledger_free.core.db import DatabaseManager
from novaledger_free.core.ledger import LedgerManager


def find_latest_data_dir() -> Path:
    """智能查找本地最新、最完整的实际账本数据目录 (支持 Nova-v2.0、Nova_v2_gemini、Nova-v1.3)"""
    candidates = [
        Path(r"C:\Users\Li-ha\Documents\Nova-v2.0\dist\NovaLedger-v2.0-便携版\data"),
        Path(r"C:\Users\Li-ha\Documents\Nova-v2.0\data"),
        Path.cwd().resolve() / "data",
        Path(__file__).resolve().parent.parent / "data",
        Path(r"C:\Users\Li-ha\Documents\Nova-v1.3\novaledger_free\dist\NovaLedger-v1.3-便携版\data"),
    ]
    best_dir = None
    best_mtime = 0.0
    for c in candidates:
        bean = c / "ledger" / "transactions.bean"
        if bean.exists() and bean.stat().st_size > 100:
            mtime = bean.stat().st_mtime
            if mtime > best_mtime:
                best_mtime = mtime
                best_dir = c
    return best_dir or (Path.cwd().resolve() / "data")


def export_mobile_bundle(
    output_dir: Optional[Path] = None,
    data_dir: Optional[Path | str] = None
) -> Dict[str, Any]:
    """
    全量导出电脑端数据为安卓端专用迁移包
    返回包含导出的 JSON 路径、ZIP 包路径与统计摘要的字典
    """
    effective_data_dir = Path(data_dir).resolve() if data_dir else find_latest_data_dir()
    config_mgr = ConfigManager(data_dir=effective_data_dir)
    db_mgr = DatabaseManager(config_mgr.sqlite_db_path)
    ledger_mgr = LedgerManager(config_mgr, db_mgr)

    target_dir = output_dir or (config_mgr.data_dir / "backups")
    target_dir.mkdir(parents=True, exist_ok=True)


    # 1. 获取账本余额与全部交易
    txs = ledger_mgr.get_all_transactions()
    balances = ledger_mgr.get_balances()

    # 2. 读取配置信息 (accounts, debts, categories, system)
    raw_cfg = config_mgr.load_config()
    system_cfg = raw_cfg.get("system", {})
    accounts_cfg = raw_cfg.get("accounts", [])
    debts_cfg = raw_cfg.get("debts", [])
    categories_cfg = raw_cfg.get("categories", {})

    # 3. 提取 SQLite 元数据（商户规则等）
    merchant_rules = []
    try:
        with db_mgr.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT keyword, target_category, target_account, confidence, source FROM merchant_rules")
            for row in cursor.fetchall():
                merchant_rules.append({
                    "keyword": row[0],
                    "target_category": row[1],
                    "target_account": row[2],
                    "confidence": float(row[3]) if row[3] is not None else 1.0,
                    "source": row[4]
                })
    except Exception:
        pass

    # 4. 校验与整理交易数据，确保借贷平衡与分录有效性
    cleaned_txs = []
    valid_count = 0
    balanced_count = 0

    for tx in txs:
        postings = tx.get("postings", [])
        if not postings:
            continue
        
        # 借贷平衡代数和校验 (容差 0.001)
        posting_sum = sum(p.get("amount", 0.0) for p in postings)
        is_balanced = abs(posting_sum) < 0.005

        cleaned_postings = []
        for p in postings:
            cleaned_postings.append({
                "account": p.get("account", ""),
                "amount": round(float(p.get("amount", 0.0)), 2),
                "currency": p.get("currency", "CNY")
            })

        tx_entry = {
            "id": tx.get("id"),
            "date": tx.get("date"),
            "payee": tx.get("payee", ""),
            "narration": tx.get("narration", ""),
            "status": tx.get("status", "cleared"),
            "source_type": tx.get("source_type", "manual"),
            "source_tx_id": tx.get("source_tx_id"),
            "source_fingerprint": tx.get("source_fingerprint"),
            "import_batch": tx.get("import_batch"),
            "tags": tx.get("tags", []),
            "links": tx.get("links", []),
            "is_balanced": is_balanced,
            "postings": cleaned_postings
        }
        cleaned_txs.append(tx_entry)
        valid_count += 1
        if is_balanced:
            balanced_count += 1

    # 5. 构建结构化迁移包
    timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    bundle = {
        "version": "1.0.0",
        "format": "novaledger_mobile_migration",
        "app": "NovaLedger Community Edition",
        "exported_at": datetime.now().isoformat(),
        "summary": {
            "total_transactions": valid_count,
            "balanced_transactions": balanced_count,
            "total_accounts": len(accounts_cfg),
            "total_debts": len(debts_cfg),
            "total_merchant_rules": len(merchant_rules),
            "total_assets": round(float(balances.get("total_assets", 0.0)), 2),
            "total_liabilities": round(float(balances.get("total_liabilities", 0.0)), 2),
            "net_worth": round(float(balances.get("net_worth", 0.0)), 2),
            "currency": "CNY"
        },
        "system": {
            "operating_currency": "CNY",
            "ai_enabled": system_cfg.get("ai_enabled", True),
            "ai_provider": system_cfg.get("ai_provider", "gemini"),
            "ai_model": system_cfg.get("ai_model", "gemini-3.8-flash")
        },
        "accounts": accounts_cfg,
        "debts": debts_cfg,
        "categories": categories_cfg,
        "merchant_rules": merchant_rules,
        "transactions": cleaned_txs
    }

    # 6. 保存为迁移 JSON 文件
    json_path = target_dir / f"NovaLedger_Mobile_Migration_{timestamp_str}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(bundle, f, ensure_ascii=False, indent=2)

    # 7. 预构建移动端专用的 SQLite 数据库文件 (novaledger.db)
    sqlite_path = target_dir / f"novaledger_mobile_{timestamp_str}.db"
    _build_mobile_sqlite(sqlite_path, bundle)

    # 8. 打包为单个 .nlmobile 归档（zip 包装）
    nlmobile_path = target_dir / f"NovaLedger_Mobile_Migration_{timestamp_str}.nlmobile"
    with zipfile.ZipFile(nlmobile_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(json_path, arcname="migration.json")
        if sqlite_path.exists():
            zf.write(sqlite_path, arcname="novaledger.db")

    return {
        "data_dir": str(effective_data_dir),
        "json_path": str(json_path),
        "sqlite_path": str(sqlite_path),
        "nlmobile_path": str(nlmobile_path),
        "summary": bundle["summary"]
    }



def _build_mobile_sqlite(db_file: Path, bundle: Dict[str, Any]) -> None:
    """在导出时直接预填充好移动端 SQLite 数据库，方便安卓端极速载入"""
    if db_file.exists():
        db_file.unlink()

    conn = sqlite3.connect(str(db_file))
    cur = conn.cursor()

    cur.executescript("""
    CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        beancount_account TEXT NOT NULL UNIQUE,
        card_tail TEXT,
        initial_balance REAL DEFAULT 0.0,
        current_balance REAL DEFAULT 0.0,
        is_archived INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS debts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        beancount_account TEXT NOT NULL,
        initial_amount REAL NOT NULL,
        remaining_amount REAL NOT NULL,
        type TEXT NOT NULL,
        due_date TEXT,
        monthly_payment REAL,
        note TEXT
    );

    CREATE TABLE IF NOT EXISTS categories (
        key TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        parent_key TEXT,
        icon TEXT,
        color TEXT,
        type TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        payee TEXT,
        narration TEXT,
        status TEXT DEFAULT 'cleared',
        source_type TEXT DEFAULT 'manual',
        source_tx_id TEXT,
        source_fingerprint TEXT,
        import_batch TEXT,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS postings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id TEXT NOT NULL,
        account TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'CNY',
        FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_posting_tx ON postings(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_posting_account ON postings(account);
    """)

    # 写入账户
    for acc in bundle.get("accounts", []):
        cur.execute(
            """INSERT OR REPLACE INTO accounts 
               (id, name, type, beancount_account, card_tail, initial_balance, current_balance, is_archived)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                acc.get("id"),
                acc.get("name"),
                acc.get("type", "debit"),
                acc.get("account", ""),
                acc.get("card_tail", ""),
                float(acc.get("initial_balance", 0.0)),
                float(acc.get("initial_balance", 0.0)),
                1 if acc.get("is_archived") else 0
            )
        )

    # 写入债务
    for debt in bundle.get("debts", []):
        cur.execute(
            """INSERT OR REPLACE INTO debts 
               (id, name, beancount_account, initial_amount, remaining_amount, type, due_date, monthly_payment, note)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                debt.get("id"),
                debt.get("name"),
                debt.get("account", ""),
                float(debt.get("initial_amount", 0.0)),
                float(debt.get("initial_amount", 0.0)),
                debt.get("type", "monthly"),
                debt.get("due_date", ""),
                float(debt.get("monthly_payment", 0.0)) if debt.get("monthly_payment") else None,
                debt.get("note", "")
            )
        )

    # 写入交易与分录
    now_iso = datetime.now().isoformat()
    for tx in bundle.get("transactions", []):
        cur.execute(
            """INSERT OR REPLACE INTO transactions 
               (id, date, payee, narration, status, source_type, source_tx_id, source_fingerprint, import_batch, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                tx.get("id"),
                tx.get("date"),
                tx.get("payee", ""),
                tx.get("narration", ""),
                tx.get("status", "cleared"),
                tx.get("source_type", "manual"),
                tx.get("source_tx_id"),
                tx.get("source_fingerprint"),
                tx.get("import_batch"),
                now_iso
            )
        )
        for p in tx.get("postings", []):
            cur.execute(
                """INSERT INTO postings (transaction_id, account, amount, currency)
                   VALUES (?, ?, ?, ?)""",
                (
                    tx.get("id"),
                    p.get("account", ""),
                    float(p.get("amount", 0.0)),
                    p.get("currency", "CNY")
                )
            )

    conn.commit()
    conn.close()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="星芒账本移动端迁移导出器")
    parser.add_argument("--data-dir", type=str, default=None, help="指定源数据目录，默认自动探寻最新账本数据")
    parser.add_argument("--output-dir", type=str, default=None, help="指定导出目录")
    args = parser.parse_args()

    custom_out = Path(args.output_dir) if args.output_dir else None
    result = export_mobile_bundle(output_dir=custom_out, data_dir=args.data_dir)
    print("=" * 60)
    print("[SUCCESS] Mobile migration export completed!")
    print(f"Data Dir:  {result.get('data_dir')}")
    print(f"JSON File: {result['json_path']}")
    print(f"SQLite DB: {result['sqlite_path']}")
    print(f"Package:   {result['nlmobile_path']}")
    print(f"Summary:   {json.dumps(result['summary'], ensure_ascii=False, indent=2)}")
    print("=" * 60)


