"""
NovaLedger 桌面原生窗口启动器
基于 Microsoft Edge WebView2 (Chromium) 与 pywebview，提供现代桌面窗口体验。
"""

import os
from pathlib import Path
import sys
import threading
import time
from typing import Optional
import uvicorn
import webview

from novaledger_free.core.config import ConfigManager
from novaledger_free.core.db import DatabaseManager
from novaledger_free.core.ledger import LedgerManager
from novaledger_free.web.app import create_app


class DesktopServerThread(threading.Thread):
    def __init__(self, app, host: str, port: int):
        super().__init__(daemon=True)
        self.app = app
        self.host = host
        self.port = port
        self.server = None

    def run(self):
        config = uvicorn.Config(
            self.app,
            host=self.host,
            port=self.port,
            log_level="warning",
            access_log=False,
        )
        self.server = uvicorn.Server(config)
        self.server.run()

    def stop(self):
        if self.server:
            self.server.should_exit = True


def launch_desktop(
    data_dir: Optional[str] = None,
    port: Optional[int] = 8088,
    width: int = 1380,
    height: int = 880,
    min_width: int = 1080,
    min_height: int = 700,
):
    if not data_dir:
        data_dir = os.environ.get("NOVALEDGER_DATA_DIR")
        if not data_dir:
            root_data = Path(__file__).resolve().parent / "data"
            if root_data.exists():
                data_dir = str(root_data.resolve())
    cfg = ConfigManager(data_dir=data_dir)
    app = create_app(data_dir=cfg.data_dir)

    # 启动后台服务
    server_thread = DesktopServerThread(app, host="127.0.0.1", port=port)
    server_thread.start()

    # 等待本地端口就绪
    url = f"http://127.0.0.1:{port}"
    time.sleep(0.6)

    # 寻找图标
    icon_path = None
    possible_icons = [
        Path(cfg.data_dir) / "app.ico",
        Path(__file__).resolve().parent / "app.ico",
        Path(__file__).resolve().parent / "novaledger_free" / "web" / "static" / "assets" / "app.ico",
    ]
    for p in possible_icons:
        if p.exists():
            icon_path = str(p.resolve())
            break

    # 创建桌面窗口
    window = webview.create_window(
        title="星芒账本 · NovaLedger",
        url=url,
        width=width,
        height=height,
        min_size=(min_width, min_height),
        background_color="#121316",
        text_select=True,
    )

    try:
        # 启动 GUI 事件循环 (Windows 上自动启用 Edge Chromium WebView2)
        webview.start(
            debug=False,
            icon=icon_path,
        )
    finally:
        server_thread.stop()


if __name__ == "__main__":
    launch_desktop()
