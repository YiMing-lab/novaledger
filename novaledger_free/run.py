import argparse
import os
from pathlib import Path
import socket
import sys

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

current_dir = Path(__file__).resolve().parent
parent_dir = current_dir.parent
if str(parent_dir) not in sys.path:
    sys.path.insert(0, str(parent_dir))

import threading
import time
import webbrowser
import uvicorn

from novaledger_free.core.config import ConfigManager
from novaledger_free.core.db import DatabaseManager
from novaledger_free.core.ledger import LedgerManager
from novaledger_free.web.app import create_app


def find_available_port(start_port: int = 8088, max_attempts: int = 20) -> int:
    for port in range(start_port, start_port + max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    return start_port


def main():
    parser = argparse.ArgumentParser(description="NovaLedger Community Edition (星芒账本免费版)")
    parser.add_argument("command", nargs="?", default="serve", choices=["serve", "validate", "version"])
    parser.add_argument("--port", type=int, default=None, help="指定监听端口")
    parser.add_argument("--data-dir", type=str, default=None, help="指定数据存放目录")
    parser.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")

    args = parser.parse_args()

    data_dir = args.data_dir or os.environ.get("NOVALEDGER_DATA_DIR")
    cfg = ConfigManager(data_dir=data_dir)
    db = DatabaseManager(cfg.sqlite_db_path)
    ledger = LedgerManager(cfg, db)

    if args.command == "version":
        print("NovaLedger Community Edition v1.0.0")
        return

    if args.command == "validate":
        valid, errors = ledger.validate_ledger()
        if valid:
            print("账本校验成功：0 错误，借贷完全平衡！")
            sys.exit(0)
        else:
            print(f"账本校验发现错误 ({len(errors)} 个):")
            for e in errors:
                print(f"  - {e}")
            sys.exit(1)

    # 启动 HTTP 服务
    port = args.port or cfg.config.get("system", {}).get("port", 8088)
    actual_port = find_available_port(port)

    app = create_app(data_dir=cfg.data_dir)

    def open_browser():
        time.sleep(1.0)
        webbrowser.open(f"http://127.0.0.1:{actual_port}")

    if not args.no_browser and cfg.config.get("system", {}).get("auto_open_browser", True):
        threading.Thread(target=open_browser, daemon=True).start()

    print(f"==================================================")
    print(f"  ✧ 星芒账本 · NovaLedger (社区免费版 v1.0.0)")
    print(f"  数据目录: {cfg.data_dir}")
    print(f"  控制台地址: http://127.0.0.1:{actual_port}")
    print(f"==================================================")

    uvicorn.run(app, host="127.0.0.1", port=actual_port, log_level="warning")


if __name__ == "__main__":
    main()
