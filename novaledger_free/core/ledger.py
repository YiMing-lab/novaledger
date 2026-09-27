import calendar
from datetime import datetime, date
from decimal import Decimal
import os
from pathlib import Path
import re
import secrets
import threading
from typing import Any, Dict, List, Optional, Tuple

from beancount import loader
from beancount.core.data import Transaction, Posting as BeanPosting

from novaledger_free.core.config import ConfigManager
from novaledger_free.core.db import DatabaseManager
from novaledger_free.core.models import (
    ImportStatus,
    OperationType,
    Posting,
    SourceType,
    TransactionModel,
    TransactionStatus,
    escape_beancount_str,
    to_decimal,
)


class LedgerManager:
    """可信 Beancount 账务核心管理器：单写者锁、候选沙箱校验、原子落盘、截止日资产核算"""

    def __init__(self, config_mgr: ConfigManager, db_mgr: DatabaseManager):
        self.config_mgr = config_mgr
        self.db = db_mgr
        self.lock = threading.RLock()
        self.file_lock_path = self.config_mgr.ledger_dir / ".transactions.lock"

    def _acquire_file_lock(self):
        """跨进程简易互斥文件锁"""
        import time
        start_time = time.time()
        while True:
            try:
                # O_CREAT | O_EXCL 提供原子排他创建
                fd = os.open(str(self.file_lock_path), os.O_CREAT | os.O_EXCL | os.O_RDWR)
                os.close(fd)
                return
            except FileExistsError:
                if time.time() - start_time > 10.0:
                    # 超时强行清理遗留锁
                    try:
                        os.remove(str(self.file_lock_path))
                    except Exception:
                        pass
                time.sleep(0.05)

    def _release_file_lock(self):
        try:
            if self.file_lock_path.exists():
                os.remove(str(self.file_lock_path))
        except Exception:
            pass

    def validate_candidate_content(self, candidate_transactions_text: str) -> Tuple[bool, List[str]]:
        """在内存沙箱中加载 accounts + 候选 transactions，校验语法与借贷平衡"""
        accounts_text = self.config_mgr.accounts_bean.read_text(encoding="utf-8")
        debts_text = self.config_mgr.debts_bean.read_text(encoding="utf-8") if getattr(self.config_mgr, "debts_bean", None) and self.config_mgr.debts_bean.exists() else ""
        full_text = (
            'option "title" "Validation Sandbox"\n'
            'option "operating_currency" "CNY"\n'
            f"{accounts_text}\n"
            f"{debts_text}\n"
            f"{candidate_transactions_text}\n"
        )
        try:
            entries, errors, options = loader.load_string(full_text)
            if errors:
                err_msgs = [f"第 {getattr(e, 'line', '?')} 行: {getattr(e, 'message', str(e))}" for e in errors]
                return False, err_msgs
            return True, []
        except Exception as ex:
            return False, [f"Beancount 解析器异常: {str(ex)}"]

    def append_transaction(
        self,
        tx_date: str,
        payee: str,
        narration: str,
        postings: List[Tuple[str, Any, str]],
        source_type: SourceType = SourceType.MANUAL,
        source_tx_id: Optional[str] = None,
        source_fingerprint: Optional[str] = None,
        import_batch: Optional[str] = None,
        tags: Optional[List[str]] = None,
        links: Optional[List[str]] = None,
        extra_metadata: Optional[Dict[str, str]] = None,
        tx_id: Optional[str] = None
    ) -> Tuple[bool, str, Optional[TransactionModel]]:
        """
        向账本追加一笔分录：
        1. 严格检查来源去重（不使用文本正则扫描，避免同日真实重复交易被误删，杜绝跨交易交叉误匹配）
        2. 构建强类型 TransactionModel 并生成标准 Beancount 语法
        3. 候选沙箱校验 0 错误后原子提交
        """
        with self.lock:
            self._acquire_file_lock()
            try:
                # 1. 来源去重校验
                if source_type != SourceType.MANUAL:
                    if source_tx_id:
                        dup = self.db.find_by_source_tx_id(source_type.value, source_tx_id)
                        if dup:
                            return False, f"交易已存在 (来源单号: {source_tx_id})", None
                    if source_fingerprint:
                        dup = self.db.find_by_fingerprint(source_fingerprint)
                        if dup:
                            return False, f"交易已存在 (指纹命中: {source_fingerprint})", None

                # 2. 构建模型
                actual_id = tx_id or f"nl_tx_{secrets.token_hex(8)}"
                posting_models = [
                    Posting(account=p[0], amount=to_decimal(p[1]), currency=p[2] if len(p) > 2 else "CNY")
                    for p in postings
                ]

                tx_model = TransactionModel(
                    id=actual_id,
                    date=tx_date,
                    payee=payee,
                    narration=narration,
                    postings=posting_models,
                    source_type=source_type,
                    source_tx_id=source_tx_id,
                    source_fingerprint=source_fingerprint,
                    import_batch=import_batch,
                    tags=tags or [],
                    links=links or [],
                    extra_metadata=extra_metadata or {}
                )

                # 3. 候选内容拼接与校验
                current_text = self.config_mgr.transactions_bean.read_text(encoding="utf-8")
                tx_beancount_str = tx_model.to_beancount_str()
                candidate_text = current_text.rstrip() + "\n\n" + tx_beancount_str + "\n"

                valid, errors = self.validate_candidate_content(candidate_text)
                if not valid:
                    return False, f"候选账本校验失败，已拒绝提交: {'; '.join(errors)}", None

                # 4. 原子安全落盘
                tmp_file = self.config_mgr.ledger_dir / f".transactions_{secrets.token_hex(4)}.tmp"
                tmp_file.write_text(candidate_text, encoding="utf-8")
                os.replace(str(tmp_file), str(self.config_mgr.transactions_bean))

                # 5. 元数据与操作日志记录
                self.db.record_transaction(tx_model)
                op_id = f"op_{secrets.token_hex(6)}"
                self.db.log_operation(
                    op_id=op_id,
                    op_type=OperationType.APPEND,
                    target_id=actual_id,
                    description=f"追加流水: {payee} - {narration}",
                    before_state=None,
                    after_state=tx_beancount_str
                )

                return True, "记账成功", tx_model
            finally:
                self._release_file_lock()

    def get_all_transactions(self) -> List[Dict[str, Any]]:
        """从官方 Beancount 账本中加载解析全部交易分录"""
        with self.lock:
            main_path = str(self.config_mgr.main_bean)
            entries, errors, _ = loader.load_file(main_path)
            transactions = []
            for e in entries:
                if isinstance(e, Transaction):
                    meta = e.meta or {}
                    postings = []
                    for p in e.postings:
                        postings.append({
                            "account": p.account,
                            "amount": float(p.units.number) if p.units else 0.0,
                            "currency": p.units.currency if p.units else "CNY"
                        })
                    transactions.append({
                        "id": meta.get("id", f"gen_{secrets.token_hex(6)}"),
                        "date": str(e.date),
                        "payee": e.payee or "",
                        "narration": e.narration or "",
                        "postings": postings,
                        "source_type": meta.get("source_type", "manual"),
                        "source_tx_id": meta.get("source_tx_id"),
                        "source_fingerprint": meta.get("source_fingerprint"),
                        "import_batch": meta.get("import_batch"),
                        "status": meta.get("status", "active"),
                        "tags": list(e.tags or []),
                        "links": list(e.links or [])
                    })
            return sorted(transactions, key=lambda x: (x["date"], x["id"]), reverse=True)

    def get_transaction_by_id(self, tx_id: str) -> Optional[Dict[str, Any]]:
        txs = self.get_all_transactions()
        for t in txs:
            if t["id"] == tx_id:
                return t
        return None

    def delete_transaction(self, tx_id: str) -> Tuple[bool, str]:
        """按 ID 删除指定交易，先在候选文本中移除并完成沙箱校验后原子更新"""
        with self.lock:
            self._acquire_file_lock()
            try:
                current_text = self.config_mgr.transactions_bean.read_text(encoding="utf-8")
                blocks = re.split(r'(?=\n[0-9]{4}-[0-9]{2}-[0-9]{2}\s+\*)', current_text)
                target_block = None
                for b in blocks:
                    if f'id: "{tx_id}"' in b:
                        target_block = b
                        break

                if not target_block:
                    return False, f"未找到 ID 为 {tx_id} 的交易分录"

                candidate_text = current_text.replace(target_block, "", 1)

                valid, errors = self.validate_candidate_content(candidate_text)
                if not valid:
                    return False, f"删除后账本校验失败，操作已回滚: {'; '.join(errors)}"

                tmp_file = self.config_mgr.ledger_dir / f".transactions_{secrets.token_hex(4)}.tmp"
                tmp_file.write_text(candidate_text, encoding="utf-8")
                os.replace(str(tmp_file), str(self.config_mgr.transactions_bean))

                self.db.delete_transaction_meta(tx_id)
                op_id = f"op_{secrets.token_hex(6)}"
                self.db.log_operation(
                    op_id=op_id,
                    op_type=OperationType.DELETE,
                    target_id=tx_id,
                    description=f"删除交易: {tx_id}",
                    before_state=target_block,
                    after_state=None
                )

                return True, "删除成功"
            finally:
                self._release_file_lock()

    def ensure_account_open(self, account_name: str) -> None:
        """确保会计科目已在 accounts.bean 中开户"""
        if not account_name:
            return
        current_accs = self.config_mgr.accounts_bean.read_text(encoding="utf-8")
        if not re.search(rf'open\s+{re.escape(account_name)}\b', current_accs):
            with open(self.config_mgr.accounts_bean, "a", encoding="utf-8") as f:
                f.write(f"\n2020-01-01 open {account_name} CNY\n")

    def update_transaction(
        self,
        tx_id: str,
        date: Optional[str] = None,
        payee: Optional[str] = None,
        narration: Optional[str] = None,
        amount: Optional[Any] = None,
        category: Optional[str] = None,
        account: Optional[str] = None,
        is_offset: Optional[bool] = None
    ) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        """
        全面更新指定交易要素（日期、商户、备注、金额、分类、出资账户、对冲状态）：
        严格保证借贷平衡，沙箱校验通过后原子落盘。
        """
        with self.lock:
            self._acquire_file_lock()
            try:
                old_tx = self.get_transaction_by_id(tx_id)
                if not old_tx:
                    return False, f"未找到 ID 为 {tx_id} 的交易分录", None

                current_text = self.config_mgr.transactions_bean.read_text(encoding="utf-8")
                blocks = re.split(r'(?=\n[0-9]{4}-[0-9]{2}-[0-9]{2}\s+\*)', current_text)
                target_block = None
                for b in blocks:
                    if f'id: "{tx_id}"' in b:
                        target_block = b
                        break

                if not target_block:
                    return False, f"未在账本源文件中定位到交易 {tx_id}", None

                # 提取目标字段
                new_date = date.strip() if date and date.strip() else old_tx["date"]
                new_payee = payee.strip() if payee is not None else old_tx["payee"]
                new_narration = narration.strip() if narration is not None else old_tx["narration"]

                # 识别当前分类与资金账户
                old_cat = None
                old_acc = None
                for p in old_tx.get("postings", []):
                    acc_name = p["account"]
                    if acc_name.startswith("Expenses:") or acc_name.startswith("Income:"):
                        old_cat = acc_name
                    elif acc_name.startswith("Assets:") or acc_name.startswith("Liabilities:"):
                        old_acc = acc_name

                if not old_cat and len(old_tx.get("postings", [])) >= 2:
                    old_cat = old_tx["postings"][0]["account"]
                if not old_acc and len(old_tx.get("postings", [])) >= 2:
                    old_acc = old_tx["postings"][1]["account"]

                target_cat = category.strip() if category and category.strip() else old_cat
                target_acc = account.strip() if account and account.strip() else old_acc

                if target_cat:
                    self.ensure_account_open(target_cat)
                if target_acc:
                    self.ensure_account_open(target_acc)

                # 计算金额
                if amount is not None:
                    target_amt = abs(to_decimal(amount))
                else:
                    if old_tx.get("postings"):
                        target_amt = abs(to_decimal(old_tx["postings"][0]["amount"]))
                    else:
                        target_amt = Decimal("0.00")

                # 判断当前交易是否为对冲交易 (Offset / Red-ink adjustment)
                if is_offset is None:
                    # 自动从原交易分录特征推导，杜绝编辑退款时被误反转为常规支出
                    inferred_offset = False
                    for p in old_tx.get("postings", []):
                        p_acc = p["account"]
                        p_amt = to_decimal(p["amount"])
                        if p_acc.startswith("Expenses:") and p_amt < 0:
                            inferred_offset = True
                            break
                        elif p_acc.startswith("Income:") and p_amt > 0:
                            inferred_offset = True
                            break
                    effective_offset = inferred_offset
                else:
                    effective_offset = bool(is_offset)

                # 构建 Posting 列表
                if len(old_tx.get("postings", [])) == 2 and target_cat and target_acc:
                    if target_cat.startswith("Income:"):
                        if effective_offset:
                            # 收入对冲（收入退还/追回扣款）：收入科目借记正数，扣款资金账户贷记负数
                            posting_models = [
                                Posting(account=target_cat, amount=target_amt),
                                Posting(account=target_acc, amount=-target_amt)
                            ]
                        else:
                            # 正常收入：资金账户借记正数，收入科目贷记负数
                            posting_models = [
                                Posting(account=target_acc, amount=target_amt),
                                Posting(account=target_cat, amount=-target_amt)
                            ]
                    else:
                        if effective_offset:
                            # 支出对冲（商户退款/报销）：资金账户借记正数，支出科目贷记负数（红字冲减）
                            posting_models = [
                                Posting(account=target_acc, amount=target_amt),
                                Posting(account=target_cat, amount=-target_amt)
                            ]
                        else:
                            # 正常支出/还款/通用：分类借记正数，出资账户贷记负数
                            posting_models = [
                                Posting(account=target_cat, amount=target_amt),
                                Posting(account=target_acc, amount=-target_amt)
                            ]
                else:
                    # 复杂多腿交易，若未调整科目与金额，保留原分录
                    posting_models = [
                        Posting(account=p["account"], amount=to_decimal(p["amount"]), currency=p.get("currency", "CNY"))
                        for p in old_tx.get("postings", [])
                    ]

                st_val = old_tx.get("source_type", "manual")
                try:
                    st_enum = SourceType(st_val)
                except Exception:
                    st_enum = SourceType.MANUAL

                new_model = TransactionModel(
                    id=tx_id,
                    date=new_date,
                    payee=new_payee,
                    narration=new_narration,
                    postings=posting_models,
                    source_type=st_enum,
                    source_tx_id=old_tx.get("source_tx_id"),
                    source_fingerprint=old_tx.get("source_fingerprint"),
                    import_batch=old_tx.get("import_batch"),
                    tags=old_tx.get("tags", []),
                    links=old_tx.get("links", [])
                )

                new_b_str = new_model.to_beancount_str()
                replacement = ("\n" if target_block.startswith("\n") else "") + new_b_str
                if target_block.endswith("\n") and not replacement.endswith("\n"):
                    replacement += "\n"

                candidate_text = current_text.replace(target_block, replacement, 1)

                valid, errors = self.validate_candidate_content(candidate_text)
                if not valid:
                    return False, f"修改后账本校验失败，操作已拒绝: {'; '.join(errors)}", None

                tmp_file = self.config_mgr.ledger_dir / f".transactions_{secrets.token_hex(4)}.tmp"
                tmp_file.write_text(candidate_text, encoding="utf-8")
                os.replace(str(tmp_file), str(self.config_mgr.transactions_bean))

                op_id = f"op_{secrets.token_hex(6)}"
                self.db.log_operation(
                    op_id=op_id,
                    op_type=OperationType.UPDATE,
                    target_id=tx_id,
                    description=f"编辑交易: {tx_id} ({new_payee} {target_amt})",
                    before_state=target_block,
                    after_state=new_b_str
                )

                updated_tx = self.get_transaction_by_id(tx_id)
                return True, "交易更新成功", updated_tx
            finally:
                self._release_file_lock()

    def update_transaction_category(
        self,
        tx_id: str,
        new_category: str,
        new_account: Optional[str] = None
    ) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        """向后兼容的分类修改方法"""
        return self.update_transaction(tx_id=tx_id, category=new_category, account=new_account)


    def get_balances(self, cutoff_date: Optional[str] = None) -> Dict[str, Any]:
        """
        计算指定截止日期（默认全部）的真实复式记账余额。
        真实会计事实不受前端任何模块显示开关影响！
        """
        with self.lock:
            main_path = str(self.config_mgr.main_bean)
            entries, _, _ = loader.load_file(main_path)
            account_balances: Dict[str, Decimal] = {}

            target_cutoff = cutoff_date.strip() if cutoff_date else "9999-12-31"

            for e in entries:
                if isinstance(e, Transaction):
                    if str(e.date) > target_cutoff:
                        continue
                    for p in e.postings:
                        if p.units:
                            curr_bal = account_balances.get(p.account, Decimal("0.00"))
                            account_balances[p.account] = curr_bal + Decimal(str(p.units.number))

            total_assets = Decimal("0.00")
            total_liabilities = Decimal("0.00")
            detailed_accounts = {}

            for acc, bal in account_balances.items():
                detailed_accounts[acc] = float(bal)
                if acc.startswith("Assets:"):
                    total_assets += bal
                elif acc.startswith("Liabilities:"):
                    # 负债科目在 Beancount 中贷记为负数，因此实际负债额为取负
                    total_liabilities += (-bal)

            net_worth = total_assets - total_liabilities

            return {
                "cutoff_date": target_cutoff if cutoff_date else "latest",
                "net_worth": float(net_worth),
                "total_assets": float(total_assets),
                "total_liabilities": float(total_liabilities),
                "account_balances": detailed_accounts
            }

    def get_financial_reports(self, target_month: str) -> Dict[str, Any]:
        """
        计算指定月份的真实财务分析报表：
        1. 资产负债表严格以该月最后一天作为 cutoff_date，禁止未来月份交易渗入！
        2. 内部投资划转属于资产重配置，绝不二次计入储蓄！
        3. 储蓄金额严格定义为：当月净结余 = 收入 - 支出。
        """
        with self.lock:
            year, month = map(int, target_month.split("-"))
            _, last_day = calendar.monthrange(year, month)
            cutoff_date_str = f"{year:04d}-{month:02d}-{last_day:02d}"

            # 1. 真实截止日资产负债
            balance_sheet = self.get_balances(cutoff_date=cutoff_date_str)

            # 2. 当月收支损益与商户统计
            main_path = str(self.config_mgr.main_bean)
            entries, _, _ = loader.load_file(main_path)

            income_total = Decimal("0.00")
            expense_total = Decimal("0.00")
            category_breakdown: Dict[str, Decimal] = {}
            needs_amount = Decimal("0.00")
            wants_amount = Decimal("0.00")
            payee_expenses: Dict[str, Decimal] = {}
            daily_expenses: Dict[str, Decimal] = {}

            category_counts: Dict[str, int] = {}
            category_merchants: Dict[str, Dict[str, Dict[str, Any]]] = {}
            payee_full_stats: Dict[str, Dict[str, Any]] = {}
            channel_expenses: Dict[str, Decimal] = {}
            large_transactions: List[Dict[str, Any]] = []

            for e in entries:
                if isinstance(e, Transaction):
                    tx_date_str = str(e.date)
                    if not tx_date_str.startswith(target_month):
                        continue

                    tx_meta = e.meta or {}
                    tx_id = tx_meta.get("id", "")
                    tx_expense_amt = Decimal("0.00")
                    tx_cat = ""
                    tx_acc = ""
                    payee_name = e.payee.strip() if e.payee else "未命名商户"

                    for p in e.postings:
                        if not p.units:
                            continue
                        acc = p.account
                        amt = Decimal(str(p.units.number))

                        if acc.startswith("Income:"):
                            income_total += (-amt)
                        elif acc.startswith("Expenses:"):
                            expense_total += amt
                            tx_expense_amt += amt
                            tx_cat = acc
                            category_breakdown[acc] = category_breakdown.get(acc, Decimal("0.00")) + amt
                            category_counts[acc] = category_counts.get(acc, 0) + 1

                            # 分类下钻商户统计
                            if acc not in category_merchants:
                                category_merchants[acc] = {}
                            if payee_name not in category_merchants[acc]:
                                category_merchants[acc][payee_name] = {"amount": Decimal("0.00"), "count": 0}
                            category_merchants[acc][payee_name]["amount"] += amt
                            category_merchants[acc][payee_name]["count"] += 1

                            if any(k in acc for k in ["Groceries", "Rent", "Utilities", "Medical", "Transit"]):
                                needs_amount += amt
                            else:
                                wants_amount += amt
                        elif acc.startswith("Assets:") or acc.startswith("Liabilities:"):
                            tx_acc = acc

                    if tx_expense_amt > Decimal("0.00"):
                        payee_expenses[payee_name] = payee_expenses.get(payee_name, Decimal("0.00")) + tx_expense_amt
                        daily_expenses[tx_date_str] = daily_expenses.get(tx_date_str, Decimal("0.00")) + tx_expense_amt
                        if tx_acc:
                            channel_expenses[tx_acc] = channel_expenses.get(tx_acc, Decimal("0.00")) + tx_expense_amt

                        # 全量商户多维统计
                        if payee_name not in payee_full_stats:
                            payee_full_stats[payee_name] = {
                                "amount": Decimal("0.00"),
                                "count": 0,
                                "categories": set(),
                                "last_date": tx_date_str
                            }
                        payee_full_stats[payee_name]["amount"] += tx_expense_amt
                        payee_full_stats[payee_name]["count"] += 1
                        if tx_cat:
                            payee_full_stats[payee_name]["categories"].add(tx_cat)
                        if tx_date_str > payee_full_stats[payee_name]["last_date"]:
                            payee_full_stats[payee_name]["last_date"] = tx_date_str

                        if tx_expense_amt >= Decimal("500.00"):
                            large_transactions.append({
                                "id": tx_id,
                                "date": tx_date_str,
                                "payee": payee_name,
                                "narration": e.narration or "",
                                "amount": float(tx_expense_amt),
                                "category": tx_cat or "Expenses:Other",
                                "account": tx_acc or ""
                            })

            large_transactions.sort(key=lambda x: x["amount"], reverse=True)

            # 3. 储蓄结余（严格以 收入 - 支出 计算，转账不改变结余）
            savings_amount = income_total - expense_total
            savings_rate = (float(savings_amount / income_total * 100)) if income_total > Decimal("0.00") else 0.0

            # 4. Top 10 头部商户排行与全量商户排行榜
            sorted_payees = sorted(payee_expenses.items(), key=lambda x: x[1], reverse=True)[:10]
            top_payees = [
                {
                    "payee": p_name,
                    "amount": float(p_amt),
                    "percentage": round(float(p_amt / expense_total * 100), 1) if expense_total > Decimal("0.00") else 0.0
                }
                for p_name, p_amt in sorted_payees
            ]

            merchant_ranking = [
                {
                    "rank": idx + 1,
                    "payee": p_name,
                    "amount": float(p_data["amount"]),
                    "count": p_data["count"],
                    "avg_amount": round(float(p_data["amount"] / p_data["count"]), 2) if p_data["count"] > 0 else 0.0,
                    "percentage": round(float(p_data["amount"] / expense_total * 100), 1) if expense_total > Decimal("0.00") else 0.0,
                    "categories": sorted(list(p_data["categories"])),
                    "last_date": p_data["last_date"]
                }
                for idx, (p_name, p_data) in enumerate(
                    sorted(payee_full_stats.items(), key=lambda x: x[1]["amount"], reverse=True)
                )
            ]

            # 5. 分类支出排行榜 (全量排序、占比及子商户下钻)
            sorted_cats = sorted(category_breakdown.items(), key=lambda x: x[1], reverse=True)
            category_ranking = [
                {
                    "rank": idx + 1,
                    "category": c_acc,
                    "amount": float(c_amt),
                    "percentage": round(float(c_amt / expense_total * 100), 1) if expense_total > Decimal("0.00") else 0.0,
                    "count": category_counts.get(c_acc, 0),
                    "merchants": [
                        {
                            "payee": p_name,
                            "amount": float(p_info["amount"]),
                            "count": p_info["count"],
                            "percentage": round(float(p_info["amount"] / c_amt * 100), 1) if c_amt > Decimal("0.00") else 0.0
                        }
                        for p_name, p_info in sorted(
                            category_merchants.get(c_acc, {}).items(),
                            key=lambda item: item[1]["amount"],
                            reverse=True
                        )
                    ]
                }
                for idx, (c_acc, c_amt) in enumerate(sorted_cats)
            ]

            # 6. 出资渠道分布
            channel_spending = [
                {
                    "account": ch_acc,
                    "amount": float(ch_amt),
                    "percentage": round(float(ch_amt / expense_total * 100), 1) if expense_total > Decimal("0.00") else 0.0
                }
                for ch_acc, ch_amt in sorted(channel_expenses.items(), key=lambda x: x[1], reverse=True)
            ]

            # 7. 日均燃烧率与月末预测 (Daily Burn Rate)
            today_str = datetime.now().strftime("%Y-%m-%d")
            is_current_month = (target_month == today_str[:7])
            elapsed_days = min(datetime.now().day, last_day) if is_current_month else last_day
            elapsed_days = max(1, elapsed_days)

            daily_run_rate = round(float(expense_total) / elapsed_days, 2)
            projected_month_expense = round(daily_run_rate * last_day, 2)

            peak_day = {"date": "-", "amount": 0.0}
            if daily_expenses:
                sorted_days = sorted(daily_expenses.items(), key=lambda x: x[1], reverse=True)
                peak_day = {"date": sorted_days[0][0], "amount": float(sorted_days[0][1])}

            # 8. 每日连续序列 (Daily Series 1..last_day)
            daily_series = []
            for d in range(1, last_day + 1):
                d_str = f"{year:04d}-{month:02d}-{d:02d}"
                d_amt = float(daily_expenses.get(d_str, Decimal("0.00")))
                daily_series.append({
                    "date": d_str,
                    "day": d,
                    "amount": d_amt,
                    "is_peak": (d_str == peak_day["date"] and d_amt > 0)
                })

            # 9. 周度序列 (Weekly Series: 第1~5周)
            weekly_series = []
            week_ranges = [
                (1, 7, "第1周 (01~07日)"),
                (8, 14, "第2周 (08~14日)"),
                (15, 21, "第3周 (15~21日)"),
                (22, 28, "第4周 (22~28日)"),
                (29, last_day, f"第5周 (29~{last_day:02d}日)")
            ]
            for start_d, end_d, label in week_ranges:
                if start_d > last_day:
                    continue
                actual_end = min(end_d, last_day)
                w_amt = Decimal("0.00")
                w_cnt = 0
                for d in range(start_d, actual_end + 1):
                    d_str = f"{year:04d}-{month:02d}-{d:02d}"
                    w_amt += daily_expenses.get(d_str, Decimal("0.00"))
                weekly_series.append({
                    "label": label,
                    "amount": float(w_amt)
                })

            # 10. 历史近6个月收支月度柱状图序列 (Monthly History)
            monthly_history = []
            for offset in range(5, -1, -1):
                cur_m_val = month - offset
                cur_y_val = year
                while cur_m_val <= 0:
                    cur_m_val += 12
                    cur_y_val -= 1
                hist_m_str = f"{cur_y_val:04d}-{cur_m_val:02d}"
                m_inc = Decimal("0.00")
                m_exp = Decimal("0.00")
                for e in entries:
                    if isinstance(e, Transaction) and str(e.date).startswith(hist_m_str):
                        for p in e.postings:
                            if p.units:
                                if p.account.startswith("Income:"):
                                    m_inc += (-Decimal(str(p.units.number)))
                                elif p.account.startswith("Expenses:"):
                                    m_exp += Decimal(str(p.units.number))
                monthly_history.append({
                    "month": hist_m_str,
                    "income": float(m_inc),
                    "expense": float(m_exp),
                    "surplus": float(m_inc - m_exp)
                })

            # 11. 流动资金与应急资金跑道 (Emergency Runway)
            liquid_assets = Decimal("0.00")
            for acc_name, acc_bal in balance_sheet.get("account_balances", {}).items():
                if any(acc_name.startswith(pfx) for pfx in ["Assets:Cash", "Assets:Bank", "Assets:EWallet"]):
                    liquid_assets += Decimal(str(acc_bal))

            monthly_needs_f = float(needs_amount)
            if monthly_needs_f > 0:
                runway_months = round(float(liquid_assets) / monthly_needs_f, 1)
            else:
                runway_months = 99.9 if liquid_assets > Decimal("0.00") else 0.0

            if runway_months >= 6.0:
                runway_status = "充裕 (6个月以上)"
            elif runway_months >= 3.0:
                runway_status = "稳健 (3~6个月)"
            else:
                runway_status = "预警 (不足3个月)"

            # 12. 当月每日各资金资产账户余额走势 (Asset Daily Trends)
            config_accounts = self.config_mgr.config.get("accounts", [])
            target_assets = [a for a in config_accounts if a.get("account", "").startswith("Assets:")]
            start_of_month = f"{year:04d}-{month:02d}-01"
            running_bals: Dict[str, Decimal] = {a["account"]: Decimal("0.00") for a in target_assets}

            for e in entries:
                if isinstance(e, Transaction):
                    d_str = str(e.date)
                    if d_str < start_of_month:
                        for p in e.postings:
                            if p.units and p.account in running_bals:
                                running_bals[p.account] += Decimal(str(p.units.number))

            month_tx_by_day: Dict[int, List[Transaction]] = {d: [] for d in range(1, last_day + 1)}
            for e in entries:
                if isinstance(e, Transaction):
                    d_str = str(e.date)
                    if d_str.startswith(target_month):
                        try:
                            day_num = int(d_str.split("-")[2])
                            if 1 <= day_num <= last_day:
                                month_tx_by_day[day_num].append(e)
                        except Exception:
                            pass

            daily_labels = [f"{d:02d}日" for d in range(1, last_day + 1)]
            daily_dates = [f"{year:04d}-{month:02d}-{d:02d}" for d in range(1, last_day + 1)]
            daily_acc_balances: Dict[str, List[float]] = {a["account"]: [] for a in target_assets}

            for d in range(1, last_day + 1):
                for e in month_tx_by_day[d]:
                    for p in e.postings:
                        if p.units and p.account in running_bals:
                            running_bals[p.account] += Decimal(str(p.units.number))
                for acc in running_bals:
                    daily_acc_balances[acc].append(round(float(running_bals[acc]), 2))

            asset_daily_trends = {
                "days": daily_labels,
                "dates": daily_dates,
                "accounts": [
                    {
                        "id": a.get("id", a["account"]),
                        "name": a.get("name", a["account"]),
                        "account": a["account"],
                        "balances": daily_acc_balances[a["account"]]
                    }
                    for a in target_assets
                ]
            }

            return {
                "month": target_month,
                "cutoff_date": cutoff_date_str,
                "balance_sheet": {
                    "total_assets": balance_sheet["total_assets"],
                    "total_liabilities": balance_sheet["total_liabilities"],
                    "net_worth": balance_sheet["net_worth"],
                    "liquid_assets": float(liquid_assets)
                },
                "income_statement": {
                    "total_income": float(income_total),
                    "total_expenses": float(expense_total),
                    "monthly_surplus": float(savings_amount),
                    "savings_rate": round(savings_rate, 2),
                    "categories": {k: float(v) for k, v in category_breakdown.items()}
                },
                "needs_wants_savings": {
                    "needs_amount": float(needs_amount),
                    "wants_amount": float(wants_amount),
                    "savings_amount": float(savings_amount),
                    "needs_ratio": round(float(needs_amount / expense_total * 100), 1) if expense_total > Decimal("0.00") else 0.0,
                    "wants_ratio": round(float(wants_amount / expense_total * 100), 1) if expense_total > Decimal("0.00") else 0.0
                },
                "daily_burn_rate": {
                    "elapsed_days": elapsed_days,
                    "total_days": last_day,
                    "daily_run_rate": daily_run_rate,
                    "projected_month_expense": projected_month_expense,
                    "peak_day": peak_day,
                    "daily_breakdown": {k: float(v) for k, v in sorted(daily_expenses.items())}
                },
                "daily_series": daily_series,
                "weekly_series": weekly_series,
                "monthly_history": monthly_history,
                "category_ranking": category_ranking,
                "merchant_ranking": merchant_ranking,
                "large_transactions": large_transactions,
                "channel_spending": channel_spending,
                "top_payees": top_payees,
                "emergency_runway": {
                    "runway_months": runway_months,
                    "health_status": runway_status,
                    "liquid_assets": float(liquid_assets),
                    "monthly_needs": monthly_needs_f
                },
                "asset_daily_trends": asset_daily_trends
            }

    def get_historical_trends(self, months_back: int = 12) -> Dict[str, Any]:
        """
        计算多维历史趋势走势数据：
        1. 历史各月份时间轴
        2. 各资产账户的期末余额走势曲线
        3. 各项负债的剩余本金递减曲线
        4. 各主要支出分类的月度花销走势
        5. 月度净资产总览走势
        """
        with self.lock:
            main_path = str(self.config_mgr.main_bean)
            entries, _, _ = loader.load_file(main_path)

            all_tx_dates = []
            for e in entries:
                if isinstance(e, Transaction):
                    all_tx_dates.append(str(e.date))

            today_month = datetime.now().strftime("%Y-%m")
            if all_tx_dates:
                min_m = min(all_tx_dates)[:7]
                max_m = max(max(all_tx_dates)[:7], today_month)
            else:
                min_m = today_month
                max_m = today_month

            start_y, start_m = map(int, min_m.split("-"))
            end_y, end_m = map(int, max_m.split("-"))
            
            all_months = []
            curr_y, curr_m = start_y, start_m
            while (curr_y < end_y) or (curr_y == end_y and curr_m <= end_m):
                all_months.append(f"{curr_y:04d}-{curr_m:02d}")
                curr_m += 1
                if curr_m > 12:
                    curr_m = 1
                    curr_y += 1

            if len(all_months) > months_back:
                months = all_months[-months_back:]
            else:
                months = all_months

            tx_entries = [e for e in entries if isinstance(e, Transaction)]
            tx_entries.sort(key=lambda x: str(x.date))

            config_accounts = self.config_mgr.config.get("accounts", [])
            config_debts = self.config_mgr.config.get("debts", [])

            month_end_balances: Dict[str, Dict[str, Decimal]] = {}
            monthly_category_expenses: Dict[str, Dict[str, Decimal]] = {m: {} for m in months}

            for target_m in months:
                y, m_int = map(int, target_m.split("-"))
                _, l_day = calendar.monthrange(y, m_int)
                cutoff = f"{target_m}-{l_day:02d}"

                acc_bals: Dict[str, Decimal] = {}
                for e in tx_entries:
                    d_str = str(e.date)
                    if d_str > cutoff:
                        break
                    for p in e.postings:
                        if p.units:
                            curr_b = acc_bals.get(p.account, Decimal("0.00"))
                            acc_bals[p.account] = curr_b + Decimal(str(p.units.number))

                    if d_str.startswith(target_m):
                        for p in e.postings:
                            if p.units and p.account.startswith("Expenses:"):
                                amt = Decimal(str(p.units.number))
                                monthly_category_expenses[target_m][p.account] = (
                                    monthly_category_expenses[target_m].get(p.account, Decimal("0.00")) + amt
                                )

                month_end_balances[target_m] = acc_bals

            asset_trends = []
            for a in config_accounts:
                bean_acc = a["account"]
                pts = [float(month_end_balances.get(m, {}).get(bean_acc, Decimal("0.00"))) for m in months]
                asset_trends.append({
                    "id": a["id"],
                    "name": a["name"],
                    "account": bean_acc,
                    "balances": pts
                })

            debt_trends = []
            for d in config_debts:
                debt_acc = d["account"]
                pts = [float(-month_end_balances.get(m, {}).get(debt_acc, Decimal("0.00"))) for m in months]
                debt_trends.append({
                    "id": d["id"],
                    "name": d["name"],
                    "account": debt_acc,
                    "balances": pts
                })

            cat_totals: Dict[str, Decimal] = {}
            for m in months:
                for cat, amt in monthly_category_expenses[m].items():
                    cat_totals[cat] = cat_totals.get(cat, Decimal("0.00")) + amt

            top_cats = sorted(cat_totals.items(), key=lambda x: x[1], reverse=True)[:8]
            category_trends = []
            for cat_acc, _ in top_cats:
                pts = [float(monthly_category_expenses.get(m, {}).get(cat_acc, Decimal("0.00"))) for m in months]
                category_trends.append({
                    "category": cat_acc,
                    "amounts": pts
                })

            net_worth_trend = []
            for m in months:
                bals = month_end_balances.get(m, {})
                tot_assets = sum(v for k, v in bals.items() if k.startswith("Assets:"))
                tot_liabs = sum(-v for k, v in bals.items() if k.startswith("Liabilities:"))
                net_worth_trend.append({
                    "month": m,
                    "total_assets": float(tot_assets),
                    "total_liabilities": float(tot_liabs),
                    "net_worth": float(tot_assets - tot_liabs)
                })

            return {
                "months": months,
                "asset_trends": asset_trends,
                "debt_trends": debt_trends,
                "category_trends": category_trends,
                "net_worth_trend": net_worth_trend
            }


    def validate_ledger(self) -> Tuple[bool, List[str]]:
        """全量校验当前正式账本"""
        main_path = str(self.config_mgr.main_bean)
        try:
            entries, errors, options = loader.load_file(main_path)
            if errors:
                return False, [f"行 {getattr(e, 'line', '?')}: {getattr(e, 'message', str(e))}" for e in errors]
            return True, []
        except Exception as ex:
            return False, [str(ex)]
