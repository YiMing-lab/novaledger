from datetime import datetime
import email
from email import policy
import imaplib
import re
from typing import Any, Callable, Dict, List, Optional, Tuple
from novaledger_free.core.config import ConfigManager
from novaledger_free.core.db import DatabaseManager
from novaledger_free.core.security import SecurityManager
from novaledger_free.deduplication.engine import ImportPipelineEngine
from novaledger_free.parsers.base import RawRecord
from novaledger_free.parsers.eml_parser import EMLParser


class IMAPSyncClient:
    """标准 IMAP 邮件同步客户端：支持 UIDVALIDITY 游标检查点、全量分页补拉与断网自愈"""

    def __init__(
        self,
        config_mgr: ConfigManager,
        security_mgr: SecurityManager,
        pipeline_engine: ImportPipelineEngine,
        eml_parser: Optional[EMLParser] = None
    ):
        self.cfg = config_mgr
        self.sec = security_mgr
        self.pipeline = pipeline_engine
        self.eml_parser = eml_parser or EMLParser()

    def sync_emails(
        self,
        mock_messages: Optional[List[bytes]] = None,
        lookback_count: int = 0
    ) -> Dict[str, Any]:
        """
        执行邮件同步流程。如果传入 mock_messages，则直接在沙箱中仿真，用于单测与离线环境。
        支持 lookback_count 回溯检索，防止因解析器更新或网络抖动遗漏历史邮件。
        """
        sync_cfg = self.cfg.config.get("mail_sync", {})
        host = sync_cfg.get("imap_host", "imap.exmail.qq.com")
        port = int(sync_cfg.get("imap_port", 993))
        user = sync_cfg.get("username", "")
        folder = sync_cfg.get("folder", "INBOX")
        auth_code = self.sec.get_credential("email_auth_code")

        last_seen_uid = int(sync_cfg.get("last_seen_uid", 0))
        last_uidvalidity = int(sync_cfg.get("uidvalidity", 0))

        if mock_messages is not None:
            # 沙箱测试路径
            return self._process_raw_bytes_list(mock_messages, last_seen_uid, 12345)

        if not user or not auth_code:
            return {
                "status": "skipped",
                "message": "未配置邮箱账号或授权码",
                "processed_count": 0
            }

        client = None
        try:
            client = imaplib.IMAP4_SSL(host, port, timeout=20.0)
            client.login(user, auth_code)

            # RFC 2971 客户端握手（网易163、QQ等邮箱必须发送 ID 命令方可安全 SELECT）
            try:
                imaplib.Commands["ID"] = ("AUTH", "NONAUTH")
                id_args = f'("name" "NovaLedger" "version" "1.0.0" "vendor" "myclient" "contact" "{user}")'
                tag = client._command("ID", id_args)
                client._command_complete("ID", tag)
            except Exception:
                pass

            res, data = client.select(folder)
            if res != "OK":
                return {"status": "error", "message": f"无法进入文件夹: {folder}", "processed_count": 0}

            # 校验 UIDVALIDITY
            res_val, val_data = client.status(folder, "(UIDVALIDITY)")
            current_uidval = 0
            if res_val == "OK" and val_data:
                m = re.search(r"UIDVALIDITY\s+(\d+)", val_data[0].decode("utf-8", errors="ignore"))
                if m:
                    current_uidval = int(m.group(1))

            if last_uidvalidity > 0 and current_uidval > 0 and current_uidval != last_uidvalidity:
                # 邮箱被重建或重命名，重置游标从头开始
                last_seen_uid = 0

            # 检索待处理的邮件 UID (支持安全回溯 lookback_count 以防漏检)
            if lookback_count > 0 and last_seen_uid > 0:
                start_uid = max(1, last_seen_uid - lookback_count)
                search_crit = f"UID {start_uid}:*"
                res_s, search_data = client.uid("search", None, search_crit)
                if res_s != "OK" or not search_data or not search_data[0]:
                    return {
                        "status": "success",
                        "message": "无邮件需要同步",
                        "processed_count": 0
                    }
                all_uids = [int(u) for u in search_data[0].split() if int(u) >= start_uid]
            else:
                search_crit = f"UID {last_seen_uid + 1}:*" if last_seen_uid > 0 else "ALL"
                res_s, search_data = client.uid("search", None, search_crit)
                if res_s != "OK" or not search_data or not search_data[0]:
                    return {
                        "status": "success",
                        "message": "无新邮件需要同步",
                        "processed_count": 0
                    }
                all_uids = [int(u) for u in search_data[0].split() if int(u) > last_seen_uid]
            all_uids.sort()

            if not all_uids:
                return {
                    "status": "success",
                    "message": "已是最新状态",
                    "processed_count": 0
                }

            # 分页拉取（每批 20 封，避免超时）
            chunk_size = 20
            all_records: List[RawRecord] = []
            max_fetched_uid = last_seen_uid

            for i in range(0, len(all_uids), chunk_size):
                chunk = all_uids[i : i + chunk_size]
                uid_set_str = ",".join(str(u) for u in chunk)
                res_f, fetch_data = client.uid("fetch", uid_set_str, "(BODY[])")
                if res_f != "OK":
                    continue

                for item in fetch_data:
                    if isinstance(item, tuple) and len(item) > 1:
                        raw_email_bytes = item[1]
                        try:
                            recs = self.eml_parser.parse_bytes(raw_email_bytes)
                            all_records.extend(recs)
                        except Exception:
                            pass

                max_fetched_uid = max(max_fetched_uid, max(chunk))

            # 智能映射卡号到会计账户 (如 6688 -> Assets:Bank:CMB:Card6688)
            card_tail_map = {
                str(acc.get("card_tail", "")).strip(): acc.get("account")
                for acc in self.cfg.config.get("accounts", [])
                if acc.get("card_tail")
            }
            for r in all_records:
                card = str(r.raw_payload.get("card", "")).strip()
                if card and card in card_tail_map:
                    r.raw_payload["account"] = card_tail_map[card]

            # 导入入账
            default_acc = "Assets:Bank:Default:Card001"
            import_res = self.pipeline.process_records(all_records, "IMAP_AutoSync", default_acc)

            # 更新检查点
            sync_cfg["last_seen_uid"] = max_fetched_uid
            sync_cfg["uidvalidity"] = current_uidval
            sync_cfg["last_sync_time"] = datetime.now().isoformat()
            self.cfg.save_config()

            return {
                "status": "success",
                "message": f"成功同步并处理 {len(all_records)} 笔交易通知",
                "processed_count": len(all_records),
                "details": import_res
            }

        except Exception as ex:
            return {
                "status": "error",
                "message": f"IMAP 同步异常: {str(ex)}",
                "processed_count": 0
            }
        finally:
            if client:
                try:
                    client.close()
                    client.logout()
                except Exception:
                    pass

    def _process_raw_bytes_list(self, raw_bytes_list: List[bytes], last_seen_uid: int, uidvalidity: int) -> Dict[str, Any]:
        """内部仿真处理 bytes 列表"""
        all_records = []
        for idx, raw_bytes in enumerate(raw_bytes_list, start=last_seen_uid + 1):
            import tempfile, os
            from pathlib import Path
            with tempfile.NamedTemporaryFile(suffix=".eml", delete=False) as tmp:
                tmp.write(raw_bytes)
                tmp_path = tmp.name
            try:
                recs = self.eml_parser.parse_file(Path(tmp_path))
                all_records.extend(recs)
            finally:
                os.remove(tmp_path)

        default_acc = "Assets:Bank:Default:Card001"
        import_res = self.pipeline.process_records(all_records, "Mock_IMAP", default_acc)

        sync_cfg = self.cfg.config.get("mail_sync", {})
        sync_cfg["last_seen_uid"] = last_seen_uid + len(raw_bytes_list)
        sync_cfg["uidvalidity"] = uidvalidity
        sync_cfg["last_sync_time"] = datetime.now().isoformat()
        self.cfg.save_config()

        return {
            "status": "success",
            "message": f"模拟同步成功，处理 {len(all_records)} 笔通知",
            "processed_count": len(all_records),
            "details": import_res
        }
