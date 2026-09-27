from pathlib import Path
import secrets
from typing import Any, Dict, Optional, Tuple
from novaledger_free.core.db import DatabaseManager
from novaledger_free.core.ledger import LedgerManager
from novaledger_free.core.models import OperationType


class JournalManager:
    """事务操作日志与一键回滚/撤销管理器"""

    def __init__(self, ledger_mgr: LedgerManager, db_mgr: DatabaseManager):
        self.ledger = ledger_mgr
        self.db = db_mgr

    def rollback_operation(self, op_id: str) -> Tuple[bool, str]:
        """撤销指定操作，恢复历史状态"""
        op = self.db.get_operation_log(op_id)
        if not op:
            return False, f"未找到操作记录 {op_id}"

        op_type = op["op_type"]
        target_id = op["target_id"]
        before_state = op.get("before_state")

        if op_type == OperationType.APPEND.value:
            # 撤销追加：即删除该交易
            success, msg = self.ledger.delete_transaction(target_id)
            if success:
                new_op_id = f"op_undo_{secrets.token_hex(4)}"
                self.db.log_operation(
                    op_id=new_op_id,
                    op_type=OperationType.BATCH_ROLLBACK,
                    target_id=target_id,
                    description=f"已撤销操作 {op_id} (删除交易 {target_id})"
                )
            return success, msg

        elif op_type == OperationType.DELETE.value:
            # 撤销删除：将 before_state 分录重新追加回去
            if not before_state:
                return False, "历史状态为空，无法恢复分录"

            with self.ledger.lock:
                current_text = self.ledger.config_mgr.transactions_bean.read_text(encoding="utf-8")
                candidate_text = current_text.rstrip() + "\n\n" + before_state.strip() + "\n"
                valid, errors = self.ledger.validate_candidate_content(candidate_text)
                if not valid:
                    return False, f"恢复分录后校验失败: {'; '.join(errors)}"

                import os
                tmp_file = self.ledger.config_mgr.ledger_dir / f".transactions_{secrets.token_hex(4)}.tmp"
                tmp_file.write_text(candidate_text, encoding="utf-8")
                os.replace(str(tmp_file), str(self.ledger.config_mgr.transactions_bean))

                # 恢复 SQLite 状态
                with self.db.get_connection() as conn:
                    conn.execute("UPDATE transactions_meta SET status = 'active' WHERE id = ?", (target_id,))

                new_op_id = f"op_undo_{secrets.token_hex(4)}"
                self.db.log_operation(
                    op_id=new_op_id,
                    op_type=OperationType.BATCH_ROLLBACK,
                    target_id=target_id,
                    description=f"已撤销删除操作 {op_id} (恢复交易 {target_id})"
                )
                return True, "已成功恢复被删除的交易"

        return False, f"不支持对操作类型 {op_type} 自动回滚"
