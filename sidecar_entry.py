"""
NovaLedger v2.0 Python Sidecar 引擎启动器
由 Tauri 2 (Rust) 主进程在后台静默拉起，提供本地 127.0.0.1 Beancount 账务与多源解析 REST API。
"""
import argparse
import os
from pathlib import Path
import sys
import uvicorn

if sys.stdout is None:
    try:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    except Exception:
        pass
if sys.stderr is None:
    try:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")
    except Exception:
        pass

from novaledger_free.core.config import ConfigManager
from novaledger_free.core.db import DatabaseManager
from novaledger_free.core.ledger import LedgerManager
from novaledger_free.web.app import create_app


def main():
    parser = argparse.ArgumentParser(description="NovaLedger v2.0 Core Engine Sidecar")
    parser.add_argument("--port", type=int, default=8088, help="Local port to bind")
    parser.add_argument("--data-dir", type=str, default=None, help="Path to data directory")
    parser.add_argument("action", nargs="?", default="serve", help="serve or validate")
    args = parser.parse_args()

    cfg = ConfigManager(data_dir=args.data_dir)
    if args.action == "validate":
        db = DatabaseManager(cfg.sqlite_db_path)
        ledger = LedgerManager(cfg, db)
        valid, errors = ledger.validate_ledger()
        if valid:
            print("VALID: 0 errors")
            sys.exit(0)
        else:
            print("INVALID:", "; ".join(errors))
            sys.exit(1)

    app = create_app(data_dir=cfg.data_dir)
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=args.port,
        log_level="warning",
        access_log=False,
    )


if __name__ == "__main__":
    main()
