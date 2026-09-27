from contextlib import contextmanager
from datetime import datetime
import json
from pathlib import Path
import sqlite3
from typing import Any, Dict, List, Optional
from novaledger_free.core.models import ImportStatus, OperationType, SourceType, TransactionModel, TransactionStatus


class DatabaseManager:
    """SQLite 元数据与操作日志引擎，管理导入队列、证据链、指纹去重与撤销回滚"""

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    @contextmanager
    def get_connection(self):
        conn = sqlite3.connect(str(self.db_path), timeout=30.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _init_db(self) -> None:
        with self.get_connection() as conn:
            conn.executescript("""
            CREATE TABLE IF NOT EXISTS transactions_meta (
                id TEXT PRIMARY KEY,
                date TEXT NOT NULL,
                payee TEXT,
                narration TEXT,
                source_type TEXT NOT NULL,
                source_tx_id TEXT,
                source_fingerprint TEXT,
                import_batch TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_tx_source ON transactions_meta(source_type, source_tx_id);
            CREATE INDEX IF NOT EXISTS idx_tx_fingerprint ON transactions_meta(source_fingerprint);
            CREATE INDEX IF NOT EXISTS idx_tx_batch ON transactions_meta(import_batch);
            CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions_meta(date);

            CREATE TABLE IF NOT EXISTS import_batches (
                batch_id TEXT PRIMARY KEY,
                filename TEXT,
                source_type TEXT NOT NULL,
                file_hash TEXT,
                total_count INTEGER DEFAULT 0,
                added_count INTEGER DEFAULT 0,
                duplicate_count INTEGER DEFAULT 0,
                pending_count INTEGER DEFAULT 0,
                failed_count INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS pending_items (
                item_id TEXT PRIMARY KEY,
                batch_id TEXT,
                source_type TEXT NOT NULL,
                source_tx_id TEXT,
                source_fingerprint TEXT,
                date TEXT,
                payee TEXT,
                narration TEXT,
                amount TEXT,
                currency TEXT DEFAULT 'CNY',
                suggested_account TEXT,
                suggested_category TEXT,
                reason TEXT,
                raw_payload TEXT,
                status TEXT DEFAULT 'pending',
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_pending_batch ON pending_items(batch_id);
            CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_items(status);

            CREATE TABLE IF NOT EXISTS operation_journal (
                op_id TEXT PRIMARY KEY,
                op_type TEXT NOT NULL,
                target_id TEXT,
                description TEXT,
                before_state TEXT,
                after_state TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS merchant_rules (
                keyword TEXT PRIMARY KEY,
                target_category TEXT NOT NULL,
                target_account TEXT,
                confidence REAL DEFAULT 1.0,
                source TEXT DEFAULT 'manual',
                updated_at TEXT NOT NULL
            );
            """)

    def record_transaction(self, tx: TransactionModel) -> None:
        now_str = datetime.now().isoformat()
        with self.get_connection() as conn:
            conn.execute("""
            INSERT OR REPLACE INTO transactions_meta
            (id, date, payee, narration, source_type, source_tx_id, source_fingerprint, import_batch, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                tx.id,
                tx.date,
                tx.payee,
                tx.narration,
                tx.source_type.value,
                tx.source_tx_id,
                tx.source_fingerprint,
                tx.import_batch,
                tx.status.value,
                now_str,
                now_str
            ))

    def get_transaction_meta(self, tx_id: str) -> Optional[Dict[str, Any]]:
        with self.get_connection() as conn:
            row = conn.execute("SELECT * FROM transactions_meta WHERE id = ?", (tx_id,)).fetchone()
            return dict(row) if row else None

    def find_by_source_tx_id(self, source_type: str, source_tx_id: str) -> Optional[Dict[str, Any]]:
        if not source_tx_id:
            return None
        with self.get_connection() as conn:
            row = conn.execute(
                "SELECT * FROM transactions_meta WHERE source_type = ? AND source_tx_id = ? AND status = 'active'",
                (source_type, source_tx_id)
            ).fetchone()
            return dict(row) if row else None

    def find_by_fingerprint(self, fingerprint: str) -> Optional[Dict[str, Any]]:
        if not fingerprint:
            return None
        with self.get_connection() as conn:
            row = conn.execute(
                "SELECT * FROM transactions_meta WHERE source_fingerprint = ? AND status = 'active'",
                (fingerprint,)
            ).fetchone()
            return dict(row) if row else None

    def delete_transaction_meta(self, tx_id: str) -> None:
        with self.get_connection() as conn:
            conn.execute("UPDATE transactions_meta SET status = 'deleted', updated_at = ? WHERE id = ?",
                         (datetime.now().isoformat(), tx_id))

    def create_batch(self, batch_id: str, filename: str, source_type: str, file_hash: str) -> None:
        with self.get_connection() as conn:
            conn.execute("""
            INSERT INTO import_batches (batch_id, filename, source_type, file_hash, created_at)
            VALUES (?, ?, ?, ?, ?)
            """, (batch_id, filename, source_type, file_hash, datetime.now().isoformat()))

    def update_batch_counts(self, batch_id: str, added: int, duplicate: int, pending: int, failed: int) -> None:
        with self.get_connection() as conn:
            conn.execute("""
            UPDATE import_batches
            SET total_count = ?, added_count = ?, duplicate_count = ?, pending_count = ?, failed_count = ?
            WHERE batch_id = ?
            """, (added + duplicate + pending + failed, added, duplicate, pending, failed, batch_id))

    def get_batch(self, batch_id: str) -> Optional[Dict[str, Any]]:
        with self.get_connection() as conn:
            row = conn.execute("SELECT * FROM import_batches WHERE batch_id = ?", (batch_id,)).fetchone()
            return dict(row) if row else None

    def list_batches(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self.get_connection() as conn:
            rows = conn.execute("SELECT * FROM import_batches ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
            return [dict(r) for r in rows]

    def add_pending_item(self, item: Dict[str, Any]) -> None:
        with self.get_connection() as conn:
            conn.execute("""
            INSERT INTO pending_items
            (item_id, batch_id, source_type, source_tx_id, source_fingerprint, date, payee, narration,
             amount, currency, suggested_account, suggested_category, reason, raw_payload, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                item["item_id"],
                item.get("batch_id"),
                item["source_type"],
                item.get("source_tx_id"),
                item.get("source_fingerprint"),
                item.get("date"),
                item.get("payee"),
                item.get("narration"),
                str(item.get("amount", "0.00")),
                item.get("currency", "CNY"),
                item.get("suggested_account"),
                item.get("suggested_category"),
                item.get("reason"),
                json.dumps(item.get("raw_payload", {}), ensure_ascii=False),
                "pending",
                datetime.now().isoformat()
            ))

    def get_pending_items(self, status: str = "pending") -> List[Dict[str, Any]]:
        with self.get_connection() as conn:
            rows = conn.execute(
                "SELECT * FROM pending_items WHERE status = ? ORDER BY date DESC, created_at DESC",
                (status,)
            ).fetchall()
            items = []
            for r in rows:
                d = dict(r)
                if d.get("raw_payload"):
                    try:
                        d["raw_payload"] = json.loads(d["raw_payload"])
                    except Exception:
                        pass
                items.append(d)
            return items

    def resolve_pending_item(self, item_id: str, new_status: str = "resolved") -> None:
        with self.get_connection() as conn:
            conn.execute("UPDATE pending_items SET status = ? WHERE item_id = ?", (new_status, item_id))

    def log_operation(self, op_id: str, op_type: OperationType, target_id: str, description: str,
                      before_state: Optional[str] = None, after_state: Optional[str] = None) -> None:
        with self.get_connection() as conn:
            conn.execute("""
            INSERT INTO operation_journal (op_id, op_type, target_id, description, before_state, after_state, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (op_id, op_type.value, target_id, description, before_state, after_state, datetime.now().isoformat()))

    def get_operation_log(self, op_id: str) -> Optional[Dict[str, Any]]:
        with self.get_connection() as conn:
            row = conn.execute("SELECT * FROM operation_journal WHERE op_id = ?", (op_id,)).fetchone()
            return dict(row) if row else None

    def list_operation_logs(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self.get_connection() as conn:
            rows = conn.execute("SELECT * FROM operation_journal ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
            return [dict(r) for r in rows]

    def save_merchant_rule(self, keyword: str, category: str, account: Optional[str] = None) -> None:
        kw = keyword.strip()
        if not kw:
            return
        with self.get_connection() as conn:
            conn.execute("""
            INSERT OR REPLACE INTO merchant_rules (keyword, target_category, target_account, confidence, source, updated_at)
            VALUES (?, ?, ?, 1.0, 'user', ?)
            """, (kw, category, account, datetime.now().isoformat()))

    def match_merchant_rule(self, payee: str, narration: str) -> Optional[Dict[str, str]]:
        target_text = f"{payee} {narration}".lower()
        with self.get_connection() as conn:
            rows = conn.execute("SELECT * FROM merchant_rules").fetchall()
            for r in rows:
                kw = r["keyword"].lower()
                if kw in target_text:
                    return {
                        "category": r["target_category"],
                        "account": r["target_account"] or ""
                    }
        return None
