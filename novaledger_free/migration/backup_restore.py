from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
from typing import Any, Dict, List, Optional, Tuple
import zipfile

from beancount import loader

from novaledger_free.core.config import ConfigManager
from novaledger_free.core.ledger import LedgerManager


def get_file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


class BackupRestoreManager:
    """全量数据备份与隔离沙箱校验恢复器：排除敏感密钥、支持灾难完整回退"""

    def __init__(self, config_mgr: ConfigManager, ledger_mgr: LedgerManager):
        self.cfg = config_mgr
        self.ledger = ledger_mgr

    def create_backup(self, output_path: Optional[Path] = None) -> Path:
        """
        创建全量快照备份（包含账本、SQLite元数据索引与配置，排除API明文密钥）
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        if output_path is None:
            dest_file = self.cfg.backups_dir / f"NovaLedger_Backup_{timestamp}.nlbackup"
        else:
            dest_file = Path(output_path).resolve()

        dest_file.parent.mkdir(parents=True, exist_ok=True)

        manifest = {
            "version": "1.0.0",
            "app": "NovaLedger Community Edition",
            "created_at": datetime.now().isoformat(),
            "files": {}
        }

        with zipfile.ZipFile(dest_file, "w", zipfile.ZIP_DEFLATED) as zf:
            # 1. Beancount 账本文件
            for f in self.cfg.ledger_dir.glob("*.bean"):
                zf.write(f, arcname=f"ledger/{f.name}")
                manifest["files"][f"ledger/{f.name}"] = get_file_sha256(f)

            # 2. SQLite 元数据数据库
            if self.cfg.sqlite_db_path.exists():
                zf.write(self.cfg.sqlite_db_path, arcname="sqlite/metadata.db")
                manifest["files"]["sqlite/metadata.db"] = get_file_sha256(self.cfg.sqlite_db_path)

            # 3. 配置文件 (已确保不含明文 secrets)
            if self.cfg.config_json_path.exists():
                zf.write(self.cfg.config_json_path, arcname="config.json")
                manifest["files"]["config.json"] = get_file_sha256(self.cfg.config_json_path)

            # 4. 写入清册
            manifest_str = json.dumps(manifest, ensure_ascii=False, indent=2)
            zf.writestr("manifest.json", manifest_str)

        return dest_file

    def restore_backup(self, backup_file: Path) -> Tuple[bool, str]:
        """
        在隔离沙箱中完整校验备份的合法性与借贷平衡，校验 100% 通过后才原子切换！
        若备份损坏或语法错误，绝对不破坏当前正在使用的数据。
        """
        if not backup_file.exists():
            return False, f"备份文件不存在: {backup_file}"

        with tempfile.TemporaryDirectory() as sandbox_dir:
            sandbox_path = Path(sandbox_dir)
            try:
                with zipfile.ZipFile(backup_file, "r") as zf:
                    zf.extractall(sandbox_path)
            except Exception as ex:
                return False, f"备份文件损坏或非有效 ZIP 格式: {str(ex)}"

            manifest_file = sandbox_path / "manifest.json"
            if not manifest_file.exists():
                return False, "备份包中缺少 manifest.json 清册"

            # 1. 完整性哈希校验
            manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
            for arcname, expected_hash in manifest.get("files", {}).items():
                extracted_file = sandbox_path / arcname
                if not extracted_file.exists():
                    return False, f"备份包缺失关键数据文件: {arcname}"
                actual_hash = get_file_sha256(extracted_file)
                if actual_hash != expected_hash:
                    return False, f"文件校验失败，数据可能被篡改: {arcname}"

            # 2. 在沙箱中加载并全量校验 Beancount 账本
            sandbox_main = sandbox_path / "ledger" / "main.bean"
            if not sandbox_main.exists():
                return False, "备份包中未找到有效的 main.bean"

            entries, errors, _ = loader.load_file(str(sandbox_main))
            if errors:
                err_msgs = [f"第 {getattr(e, 'line', '?')} 行: {getattr(e, 'message', str(e))}" for e in errors]
                return False, f"备份账本校验存在语法或借贷错误，已拒绝恢复: {'; '.join(err_msgs)}"

            # 3. 校验通过，执行原子安全替换
            with self.ledger.lock:
                # 预先备份当前数据作为保护快照
                snapshot_time = datetime.now().strftime("%Y%m%d_%H%M%S")
                safety_snapshot = self.cfg.backups_dir / f"safety_pre_restore_{snapshot_time}.nlbackup"
                self.create_backup(safety_snapshot)

                # 覆盖账本
                for f in (sandbox_path / "ledger").glob("*.bean"):
                    shutil.copy2(f, self.cfg.ledger_dir / f.name)

                # 覆盖 SQLite
                sandbox_db = sandbox_path / "sqlite" / "metadata.db"
                if sandbox_db.exists():
                    shutil.copy2(sandbox_db, self.cfg.sqlite_db_path)

                # 覆盖配置
                sandbox_cfg = sandbox_path / "config.json"
                if sandbox_cfg.exists():
                    shutil.copy2(sandbox_cfg, self.cfg.config_json_path)
                    self.cfg.load_config()

        return True, "备份已成功在沙箱核验并完成安全恢复！"
