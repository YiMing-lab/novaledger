from datetime import datetime
import threading
import time
from typing import Any, Dict, Optional
from novaledger_free.mail_sync.imap_client import IMAPSyncClient


class MailSyncScheduler:
    """后台邮件同步调度器：安全线程管理、定时补拉与即时触发"""

    def __init__(self, client: IMAPSyncClient):
        self.client = client
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._is_running = False
        self._last_result: Dict[str, Any] = {}

    def start(self, interval_seconds: int = 3600) -> None:
        if self._is_running:
            return
        self._stop_event.clear()
        self._is_running = True
        self._thread = threading.Thread(target=self._run_loop, args=(interval_seconds,), daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if not self._is_running:
            return
        self._stop_event.set()
        self._is_running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)

    def trigger_now(self, lookback_count: int = 50) -> Dict[str, Any]:
        """手动立即触发单次同步，默认带 lookback 兜底防止漏单"""
        self._last_result = self.client.sync_emails(lookback_count=lookback_count)
        return self._last_result

    def get_status(self) -> Dict[str, Any]:
        return {
            "is_running": self._is_running,
            "last_result": self._last_result,
            "last_sync_time": self.client.cfg.config.get("mail_sync", {}).get("last_sync_time"),
            "last_seen_uid": self.client.cfg.config.get("mail_sync", {}).get("last_seen_uid", 0)
        }

    def _run_loop(self, interval_seconds: int) -> None:
        while not self._stop_event.is_set():
            try:
                self._last_result = self.client.sync_emails(lookback_count=20)
            except Exception as ex:
                self._last_result = {"status": "error", "message": str(ex)}

            # 按照秒级间隔休眠，支持即刻响应 stop
            for _ in range(interval_seconds):
                if self._stop_event.is_set():
                    break
                time.sleep(1.0)
