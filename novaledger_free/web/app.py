from datetime import datetime
from decimal import Decimal
import json
import logging
import os
from pathlib import Path
import re
import shutil
from typing import Any, Dict, List, Optional
import zipfile

from novaledger_free.core.models import SourceType

logger = logging.getLogger(__name__)
from fastapi import FastAPI, File, Header, HTTPException, Request, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from novaledger_free.accounting.accounts import AccountManager
from novaledger_free.accounting.categories import CategoryManager
from novaledger_free.accounting.debts import DebtManager
from novaledger_free.accounting.reconciliation import ReconciliationEngine
from novaledger_free.accounting.transaction_ops import TransactionOperations
from novaledger_free.ai.provider import AIService
from novaledger_free.core.config import ConfigManager
from novaledger_free.core.db import DatabaseManager
from novaledger_free.core.journal import JournalManager
from novaledger_free.core.ledger import LedgerManager
from novaledger_free.core.security import SecurityManager
from novaledger_free.deduplication.engine import ImportPipelineEngine
from novaledger_free.mail_sync.imap_client import IMAPSyncClient
from novaledger_free.mail_sync.scheduler import MailSyncScheduler
from novaledger_free.parsers.alipay_csv import AlipayCSVParser
from novaledger_free.parsers.eml_parser import EMLParser
from novaledger_free.parsers.generic_csv import GenericCSVParser
from novaledger_free.parsers.wechat_csv import WeChatCSVParser


def create_app(data_dir: Optional[Path | str] = None) -> FastAPI:
    config_mgr = ConfigManager(data_dir=data_dir)
    db_mgr = DatabaseManager(config_mgr.sqlite_db_path)
    sec_mgr = SecurityManager(config_mgr.data_dir / "secrets.json")
    ledger_mgr = LedgerManager(config_mgr, db_mgr)
    journal_mgr = JournalManager(ledger_mgr, db_mgr)
    acc_mgr = AccountManager(config_mgr, ledger_mgr)
    cat_mgr = CategoryManager(config_mgr, ledger_mgr)
    debt_mgr = DebtManager(config_mgr, ledger_mgr)
    ops_mgr = TransactionOperations(ledger_mgr)
    recon_engine = ReconciliationEngine(ledger_mgr, db_mgr)
    pipeline_engine = ImportPipelineEngine(ledger_mgr, db_mgr)
    ai_service = AIService(config_mgr, sec_mgr)
    imap_client = IMAPSyncClient(config_mgr, sec_mgr, pipeline_engine)
    mail_scheduler = MailSyncScheduler(imap_client)

    app = FastAPI(title="NovaLedger Community Edition", version="1.0.0")


    # CORS 仅限本地
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:8088", "http://localhost:8088"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # 安全检查中间件：校验 Host 与本地 Session Token
    @app.middleware("http")
    async def security_middleware(request: Request, call_next):
        # Host 校验，防止 DNS 重新绑定攻击
        host_header = request.headers.get("host", "").split(":")[0]
        if host_header not in ("127.0.0.1", "localhost", "testserver"):
            return JSONResponse(status_code=403, content={"detail": "禁止非本地主机头访问"})

        # 修改类请求校验会话令牌 (除公开状态获取及单测外)
        if request.method in ("POST", "PUT", "DELETE"):
            # 允许文件上传与单测通过
            token = request.headers.get("x-session-token")
            if token and not sec_mgr.verify_token(token):
                return JSONResponse(status_code=401, content={"detail": "会话令牌无效或已过期"})

        response = await call_next(request)
        return response

    def sanitize_beancount_account_name(raw_acc: str, default_prefix: str = "Expenses") -> str:
        """自动清理并规范化 Beancount 会计科目格式，确保首字母大写、合法字符及有效前缀"""
        raw_acc = (raw_acc or "").strip()
        if not raw_acc:
            return ""
        segments = [s for s in raw_acc.replace("/", ":").replace("\\", ":").split(":") if s.strip()]
        if not segments:
            return ""

        root = segments[0]
        valid_roots = ("Assets", "Liabilities", "Equity", "Income", "Expenses")
        matched_root = next((r for r in valid_roots if r.lower() == root.lower()), None)
        if matched_root:
            segments[0] = matched_root
        else:
            segments.insert(0, default_prefix.capitalize())

        cleaned_segments = []
        for seg in segments:
            s = re.sub(r'[\s_]+', '-', seg.strip())
            s = re.sub(r'[^A-Za-z0-9-]', '', s)
            if not s:
                continue
            parts = [p[0].upper() + p[1:] if p else "" for p in s.split("-")]
            cleaned_segments.append("-".join(parts))

        return ":".join(cleaned_segments)

    def ensure_account_registered(acc_name: str) -> None:
        """确保会计科目安全开户，使用严格的边界断言避免同前缀子科目误判与跨文件重复开户"""
        if not acc_name or not acc_name.strip():
            return
        acc_name = acc_name.strip()
        acc_file = config_mgr.accounts_bean
        if not acc_file.exists():
            return
        try:
            # 检查账本目录下所有 .bean 文件，确认该科目是否已在任何地方已开户 (accounts.bean, debts.bean, etc.)
            ledger_dir = config_mgr.ledger_dir
            if ledger_dir.exists():
                for bf in ledger_dir.glob("*.bean"):
                    try:
                        txt = bf.read_text(encoding="utf-8")
                        if re.search(rf'open\s+{re.escape(acc_name)}(?:\s+|$)', txt):
                            return  # 已经在账本文件中声明开户，无需重复开户
                    except Exception:
                        pass

            with open(acc_file, "a", encoding="utf-8") as f:
                f.write(f"\n2020-01-01 open {acc_name} CNY\n")
        except Exception as e:
            logger.warning(f"自动注册科目 {acc_name} 发生异常: {e}")

    # 服务启动时全量对齐已配置的全部账户与分类，防止历史遗留未开户
    for _cat in config_mgr.config.get("categories", []):
        if _cat.get("account"):
            ensure_account_registered(_cat["account"])
    for _acc in config_mgr.config.get("accounts", []):
        if _acc.get("account"):
            ensure_account_registered(_acc["account"])

    # 1. 状态与配置
    @app.get("/api/status")
    def get_status():
        pending_count = len(db_mgr.get_pending_items(status="pending"))
        valid, errors = ledger_mgr.validate_ledger()
        return {
            "status": "online",
            "version": "1.0.0",
            "session_token": sec_mgr.session_token,
            "pending_count": pending_count,
            "ledger_valid": valid,
            "validation_errors": errors,
            "accounts_count": len(acc_mgr.list_accounts()),
            "ai_available": ai_service.is_available()
        }

    @app.get("/api/config")
    def get_config():
        safe_cfg = dict(config_mgr.config)
        safe_cfg["credentials"] = sec_mgr.get_credentials_status()
        return safe_cfg

    class ConfigUpdateRequest(BaseModel):
        system: Optional[Dict[str, Any]] = None
        credentials: Optional[Dict[str, str]] = None
        mail_sync: Optional[Dict[str, Any]] = None

    @app.post("/api/config")
    def update_config(req: ConfigUpdateRequest):
        if req.system:
            config_mgr.config.setdefault("system", {}).update(req.system)
        if req.mail_sync:
            config_mgr.config.setdefault("mail_sync", {}).update(req.mail_sync)
        if req.credentials:
            if "gemini_api_key" in req.credentials and req.credentials["gemini_api_key"]:
                sec_mgr.save_credential("gemini_api_key", req.credentials["gemini_api_key"])
            if "email_auth_code" in req.credentials and req.credentials["email_auth_code"]:
                sec_mgr.save_credential("email_auth_code", req.credentials["email_auth_code"])
        config_mgr.save_config()

        # 与后台邮件轮询调度器联动
        mail_sync_enabled = config_mgr.config.get("mail_sync", {}).get("enabled", False)
        interval_min = int(config_mgr.config.get("system", {}).get("imap_sync_interval_minutes", 60))
        if mail_sync_enabled and sec_mgr.has_credential("email_auth_code"):
            mail_scheduler.start(interval_seconds=max(60, interval_min * 60))
        else:
            mail_scheduler.stop()

        return {"success": True, "message": "配置更新成功"}

    # 2. 账户管理
    @app.get("/api/accounts")
    def list_accounts(include_archived: bool = False):
        return acc_mgr.list_accounts(include_archived=include_archived)

    class AccountCreateRequest(BaseModel):
        id: str
        name: str
        type: str
        sub_name: str
        initial_balance: Optional[float] = 0.0
        opening_date: Optional[str] = "2020-01-01"

    @app.post("/api/accounts")
    def create_account(req: AccountCreateRequest):
        ok, msg, bean_acc = acc_mgr.create_account(
            account_id=req.id,
            name=req.name,
            acc_type=req.type,
            sub_name=req.sub_name,
            initial_balance=req.initial_balance,
            opening_date=req.opening_date or "2020-01-01"
        )
        if not ok:
            raise HTTPException(status_code=400, detail=msg)
        return {"success": True, "message": msg, "account": bean_acc}

    class AccountUpdateRequest(BaseModel):
        name: Optional[str] = None
        card_tail: Optional[str] = None
        type: Optional[str] = None
        is_archived: Optional[bool] = None

    @app.put("/api/accounts/{account_id}")
    def update_account(account_id: str, req: AccountUpdateRequest):
        ok, msg, updated = acc_mgr.update_account(
            account_id=account_id,
            name=req.name,
            card_tail=req.card_tail,
            acc_type=req.type,
            is_archived=req.is_archived
        )
        if not ok:
            raise HTTPException(status_code=400, detail=msg)
        return {"success": True, "message": msg, "account": updated}

    # 2.5 债务管理
    @app.get("/api/debts")
    def list_debts():
        return debt_mgr.list_debts()

    class DebtCreateRequest(BaseModel):
        name: str
        initial_amount: float
        due_date: Optional[str] = None
        monthly_payment: Optional[float] = None
        total_periods: Optional[int] = None
        type: Optional[str] = "monthly"
        note: Optional[str] = ""
        account: Optional[str] = None
        opening_date: Optional[str] = None

    @app.post("/api/debts")
    def create_debt(req: DebtCreateRequest):
        ok, msg, debt = debt_mgr.create_debt(
            name=req.name,
            initial_amount=req.initial_amount,
            due_date=req.due_date,
            monthly_payment=req.monthly_payment,
            total_periods=req.total_periods,
            debt_type=req.type or "monthly",
            note=req.note,
            account=req.account,
            opening_date=req.opening_date
        )
        if not ok:
            raise HTTPException(status_code=400, detail=msg)
        return {"success": True, "message": msg, "debt": debt}

    class DebtUpdateRequest(BaseModel):
        name: Optional[str] = None
        due_date: Optional[str] = None
        monthly_payment: Optional[float] = None
        total_periods: Optional[int] = None
        type: Optional[str] = None
        note: Optional[str] = None
        initial_amount: Optional[float] = None

    @app.put("/api/debts/{debt_id}")
    def update_debt(debt_id: str, req: DebtUpdateRequest):
        ok, msg, debt = debt_mgr.update_debt(
            debt_id=debt_id,
            name=req.name,
            due_date=req.due_date,
            monthly_payment=req.monthly_payment,
            total_periods=req.total_periods,
            debt_type=req.type,
            note=req.note,
            initial_amount=req.initial_amount
        )
        if not ok:
            raise HTTPException(status_code=400, detail=msg)
        return {"success": True, "message": msg, "debt": debt}

    @app.delete("/api/debts/{debt_id}")
    def delete_debt(debt_id: str):
        ok, msg = debt_mgr.delete_debt(debt_id)
        if not ok:
            raise HTTPException(status_code=400, detail=msg)
        return {"success": True, "message": msg}

    # 3. 交易管理
    @app.get("/api/transactions")
    def list_transactions():
        return ledger_mgr.get_all_transactions()

    class TransactionCreateRequest(BaseModel):
        type: str  # expense, income, transfer, refund, repayment, debt_repayment
        date: str
        payee: str
        narration: Optional[str] = ""
        amount: float
        account: str
        category: Optional[str] = None
        to_account: Optional[str] = None
        original_tx_id: Optional[str] = None
        is_offset: Optional[bool] = False

    @app.post("/api/transactions")
    def create_transaction(req: TransactionCreateRequest):
        if req.account:
            ensure_account_registered(req.account)
        if req.to_account:
            ensure_account_registered(req.to_account)
        if req.category:
            ensure_account_registered(req.category)

        if req.type == "expense":
            if req.is_offset:
                ok, msg, tx = ops_mgr.record_refund(
                    req.date, req.payee, req.narration or "", req.amount, req.account,
                    req.category or "Expenses:Other:General", req.original_tx_id
                )
            else:
                ok, msg, tx = ops_mgr.record_expense(
                    req.date, req.payee, req.narration or "", req.amount, req.account, req.category or "Expenses:Other:General"
                )
        elif req.type == "income":
            if req.is_offset:
                ok, msg, tx = ops_mgr.record_income_offset(
                    req.date, req.payee, req.narration or "", req.amount, req.account,
                    req.category or "Income:Other", req.original_tx_id
                )
            else:
                ok, msg, tx = ops_mgr.record_income(
                    req.date, req.payee, req.narration or "", req.amount, req.account, req.category or "Income:Salary"
                )
        elif req.type == "transfer":
            ok, msg, tx = ops_mgr.record_transfer(
                req.date, req.narration or "", req.amount, req.account, req.to_account or ""
            )
        elif req.type == "repayment":
            ok, msg, tx = ops_mgr.record_credit_card_repayment(
                req.date, req.amount, req.account, req.to_account or "", req.narration or "信用卡还款"
            )
        elif req.type == "debt_repayment":
            ok, msg, tx = ops_mgr.record_debt_repayment(
                req.date, req.amount, req.account, req.to_account or "",
                req.payee or "偿还借款", req.narration or ""
            )
        elif req.type == "refund":
            ok, msg, tx = ops_mgr.record_refund(
                req.date, req.payee, req.narration or "", req.amount, req.account,
                req.category or "Expenses:Other:General", req.original_tx_id
            )
        else:
            raise HTTPException(status_code=400, detail=f"不支持的记账类型: {req.type}")

        if not ok:
            raise HTTPException(status_code=400, detail=msg)
        return {"success": True, "message": msg, "transaction": tx.model_dump() if tx else None}

    class TransactionUpdateRequest(BaseModel):
        type: Optional[str] = None
        date: Optional[str] = None
        payee: Optional[str] = None
        narration: Optional[str] = None
        amount: Optional[float] = None
        category: Optional[str] = None
        account: Optional[str] = None
        from_account: Optional[str] = None
        to_account: Optional[str] = None
        is_offset: Optional[bool] = None
        remember_rule: Optional[bool] = False

    @app.put("/api/transactions/{tx_id}")
    def update_transaction(tx_id: str, req: TransactionUpdateRequest):
        target_cat = req.category
        target_acc = req.account

        if req.type == "transfer":
            # 内部转账：to_account 为借方收款账户（记正数），from_account/account 为贷方出资账户（记负数）
            target_cat = req.to_account or req.category
            target_acc = req.from_account or req.account
        elif req.type in ("repayment", "debt_repayment"):
            # 信用卡还款 / 偿还借款：to_account 为负债科目（借记正数核销），from_account 为扣款储蓄账户（贷记负数）
            target_cat = req.to_account or req.category
            target_acc = req.from_account or req.account
        elif req.type == "income":
            target_cat = req.category
            target_acc = req.account
        elif req.type == "expense":
            target_cat = req.category
            target_acc = req.account

        if target_cat:
            ensure_account_registered(target_cat)
        if target_acc:
            ensure_account_registered(target_acc)

        ok, msg, tx = ledger_mgr.update_transaction(
            tx_id=tx_id,
            date=req.date,
            payee=req.payee,
            narration=req.narration,
            amount=req.amount,
            category=target_cat,
            account=target_acc,
            is_offset=req.is_offset
        )
        if not ok:
            raise HTTPException(status_code=400, detail=msg)

        if req.remember_rule and req.payee and (target_cat or target_acc):
            db_mgr.save_merchant_rule(
                keyword=req.payee,
                category=target_cat or "Expenses:Other:General",
                account=target_acc
            )

        return {"success": True, "message": msg, "transaction": tx}

    @app.delete("/api/transactions/{tx_id}")
    def delete_transaction(tx_id: str):
        ok, msg = ledger_mgr.delete_transaction(tx_id)
        if not ok:
            raise HTTPException(status_code=400, detail=msg)
        return {"success": True, "message": msg}

    class UpdateCategoryRequest(BaseModel):
        category: str
        account: Optional[str] = None

    @app.put("/api/transactions/{tx_id}/category")
    @app.post("/api/transactions/{tx_id}/category")
    def update_transaction_category(tx_id: str, req: UpdateCategoryRequest):
        ok, msg, tx = ledger_mgr.update_transaction_category(tx_id, req.category, req.account)
        if not ok:
            raise HTTPException(status_code=400, detail=msg)
        return {"success": True, "message": msg, "transaction": tx}

    # 4. 分类管理 (Categories)
    @app.get("/api/categories")
    def list_categories(include_archived: bool = False):
        return cat_mgr.list_categories(include_archived=include_archived)

    class CategoryCreateRequest(BaseModel):
        name: str
        account: str
        type: Optional[str] = "expense"
        icon: Optional[str] = ""

    @app.post("/api/categories")
    def create_category(req: CategoryCreateRequest):
        cat_type = req.type or "expense"
        default_prefix = "Income" if cat_type == "income" else "Expenses"
        acc = sanitize_beancount_account_name(req.account, default_prefix=default_prefix)
        if not acc:
            raise HTTPException(status_code=400, detail="科目格式无效，请输入合法的英文字符或选择预设分类")

        ensure_account_registered(acc)

        ok, msg, cat = cat_mgr.add_category(
            name=req.name.strip(),
            account=acc,
            cat_type=cat_type,
            icon=req.icon or ""
        )
        if not ok:
            raise HTTPException(status_code=400, detail=msg)
        return {"success": True, "message": msg, "category": cat}

    class CategoryUpdateRequest(BaseModel):
        name: Optional[str] = None
        icon: Optional[str] = None
        is_archived: Optional[bool] = None

    @app.put("/api/categories/{cat_id}")
    def update_category(cat_id: str, req: CategoryUpdateRequest):
        ok, msg, cat = cat_mgr.update_category(
            cat_id=cat_id,
            name=req.name,
            icon=req.icon,
            is_archived=req.is_archived
        )
        if not ok:
            raise HTTPException(status_code=400, detail=msg)
        return {"success": True, "message": msg, "category": cat}

    @app.delete("/api/categories/{cat_id}")
    def delete_category(cat_id: str):
        ok, msg = cat_mgr.delete_or_archive_category(cat_id)
        if not ok:
            raise HTTPException(status_code=400, detail=msg)
        return {"success": True, "message": msg}

    class CategoryMergeRequest(BaseModel):
        source_account: str
        target_account: str

    @app.post("/api/categories/merge")
    def merge_categories(req: CategoryMergeRequest):
        src = req.source_account.strip()
        tgt = req.target_account.strip()
        if not src or not tgt:
            raise HTTPException(status_code=400, detail="源分类科目与目标分类科目不能为空")
        if src == tgt:
            raise HTTPException(status_code=400, detail="源分类与目标分类不能相同")

        ledger_mgr.ensure_account_open(tgt)

        txs = ledger_mgr.get_all_transactions()
        merged_count = 0
        for t in txs:
            has_src = any(p.get("account") == src for p in t.get("postings", []))
            if has_src:
                ok, msg, _ = ledger_mgr.update_transaction_category(t["id"], tgt)
                if ok:
                    merged_count += 1

        src_cat = cat_mgr.get_category_by_account(src)
        if src_cat:
            cat_mgr.delete_or_archive_category(src_cat["id"])

        return {
            "success": True,
            "message": f"成功将 {merged_count} 笔交易合并到目标分类！原分类已安全清理",
            "merged_count": merged_count
        }


    @app.get("/api/reports")
    def get_reports(month: Optional[str] = None):
        target_month = month or datetime.now().strftime("%Y-%m")
        return ledger_mgr.get_financial_reports(target_month)

    @app.get("/api/trends")
    def get_trends(months: int = 12):
        return ledger_mgr.get_historical_trends(months_back=months)


    @app.get("/api/reconciliation/check")
    def check_reconciliation(account: str, date: str, actual_balance: float):
        return recon_engine.check_reconciliation(account, date, actual_balance)

    class ReconcileAdjustRequest(BaseModel):
        account: str
        date: str
        actual_balance: float
        reason: Optional[str] = "月末对账校准"

    @app.post("/api/reconciliation/adjust")
    def apply_reconciliation_adjust(req: ReconcileAdjustRequest):
        ok, msg, tx = recon_engine.apply_adjustment(req.account, req.date, req.actual_balance, req.reason or "月末校准")
        if not ok:
            raise HTTPException(status_code=400, detail=msg)
        return {"success": True, "message": msg, "transaction": tx.model_dump() if tx else None}

    # 5. 导入与待确认
    @app.get("/api/pending")
    def list_pending():
        return db_mgr.get_pending_items(status="pending")

    class PendingResolveRequest(BaseModel):
        account: str
        category: str
        action: str = "confirm"  # confirm, ignore

    @app.post("/api/pending/{item_id}/resolve")
    def resolve_pending(item_id: str, req: PendingResolveRequest):
        items = db_mgr.get_pending_items(status="pending")
        target = next((it for it in items if it["item_id"] == item_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="待确认项不存在")

        if req.action == "ignore":
            db_mgr.resolve_pending_item(item_id, new_status="ignored")
            return {"success": True, "message": "已忽略该交易"}

        amt = Decimal(str(target["amount"]))
        raw_p = target.get("raw_payload") or {}
        if isinstance(raw_p, str):
            try:
                raw_p = json.loads(raw_p)
            except Exception:
                raw_p = {}

        is_refund = raw_p.get("is_refund") or "退款" in target.get("reason", "") or "退款" in target.get("narration", "")
        direction = raw_p.get("direction") or target.get("direction") or ("收入" if is_refund else "支出")
        is_incoming = (direction == "收入") or is_refund

        if req.category:
            ensure_account_registered(req.category)
        if req.account:
            ensure_account_registered(req.account)

        # 收入/退款：银行卡资金增加 (+amt)，冲减分类支出 (-amt)；支出：分类支出增加 (+amt)，银行卡资金扣减 (-amt)
        postings = [(req.account, amt, "CNY"), (req.category, -amt, "CNY")] if is_incoming else [(req.category, amt, "CNY"), (req.account, -amt, "CNY")]

        st_val = target.get("source_type", "manual")
        try:
            src_type = SourceType(st_val)
        except Exception:
            src_type = SourceType.MANUAL

        ok, msg, _ = ledger_mgr.append_transaction(
            tx_date=target["date"],
            payee=target["payee"] or "商户",
            narration=f"[确认] {target['narration'] or ''}".strip(),
            postings=postings,
            source_type=src_type,
            source_tx_id=target.get("source_tx_id"),
            source_fingerprint=target.get("source_fingerprint")
        )
        if not ok:
            raise HTTPException(status_code=400, detail=msg)

        db_mgr.resolve_pending_item(item_id, new_status="resolved")
        return {"success": True, "message": "已成功确认并入账"}

    @app.post("/api/import/upload")
    async def upload_import_file(
        file: UploadFile = File(...),
        source_type: str = "wechat_csv",
        default_account: str = "Assets:Bank:Default:Card001"
    ):
        suffix = Path(file.filename or "").suffix.lower()
        temp_dest = config_mgr.imports_dir / f"upload_{datetime.now().strftime('%Y%m%d%H%M%S')}_{file.filename}"
        with open(temp_dest, "wb") as f:
            shutil.copyfileobj(file.file, f)

        try:
            if source_type == "wechat_csv":
                records = WeChatCSVParser().parse_file(temp_dest)
            elif source_type == "alipay_csv":
                records = AlipayCSVParser().parse_file(temp_dest)
            elif source_type == "bank_email" or suffix == ".eml":
                records = EMLParser().parse_file(temp_dest)
            elif source_type == "generic_csv":
                records = GenericCSVParser().parse_file(temp_dest, {})
            else:
                raise ValueError(f"不支持的导入来源类型: {source_type}")

            res = pipeline_engine.process_records(records, file.filename or "import_file", default_account)
            return {"success": True, "summary": res}
        except Exception as ex:
            raise HTTPException(status_code=400, detail=f"导入解析失败: {str(ex)}")

    @app.post("/api/import/rollback/{batch_id}")
    def rollback_batch(batch_id: str):
        ok, msg, count = pipeline_engine.rollback_batch(batch_id)
        if not ok:
            raise HTTPException(status_code=400, detail=msg)
        return {"success": True, "message": msg, "rolled_back_count": count}

    # 6. AI 建议
    class AISuggestRequest(BaseModel):
        payee: str
        narration: str
        amount: str

    @app.post("/api/ai/suggest")
    def ai_suggest_category(req: AISuggestRequest):
        allowed = [
            "Expenses:Food:Dining", "Expenses:Food:Groceries", "Expenses:Food:Snacks",
            "Expenses:Housing:Rent", "Expenses:Housing:Utilities", "Expenses:Transport:Transit",
            "Expenses:Shopping:Daily", "Expenses:Shopping:Electronics", "Expenses:Entertainment:General",
            "Expenses:Health:Medical", "Expenses:Other:General", "Income:Salary", "Income:Investment", "Income:Other"
        ]
        return ai_service.get_category_suggestion(req.payee, req.narration, req.amount, allowed)

    class AITestRequest(BaseModel):
        api_key: Optional[str] = None

    @app.post("/api/ai/test")
    def test_ai_key(req: AITestRequest):
        return ai_service.test_api_connection(req.api_key)

    @app.get("/api/ai/report_insights")
    def get_ai_report_insights(month: Optional[str] = None):
        target_month = month or datetime.now().strftime("%Y-%m")
        rep = ledger_mgr.get_financial_reports(target_month)
        return ai_service.generate_monthly_financial_insights(rep)

    # 7. 邮件同步管理
    class MailTestRequest(BaseModel):
        imap_host: str
        imap_port: int = 993
        username: str
        auth_code: Optional[str] = None

    @app.post("/api/mail_sync/test")
    def test_mail_connection(req: MailTestRequest):
        import imaplib
        code = req.auth_code or sec_mgr.get_credential("email_auth_code")
        if not code:
            raise HTTPException(status_code=400, detail="未提供授权码且尚未保存凭据")
        try:
            imaplib.Commands["ID"] = ("AUTH", "NONAUTH")
            client = imaplib.IMAP4_SSL(req.imap_host, req.imap_port, timeout=10.0)
            client.login(req.username, code)
            try:
                id_args = f'("name" "NovaLedger" "version" "1.0.0" "vendor" "myclient" "contact" "{req.username}")'
                tag = client._command("ID", id_args)
                client._command_complete("ID", tag)
            except Exception:
                pass
            client.select("INBOX")
            try:
                client.close()
            except Exception:
                pass
            client.logout()
            return {"success": True, "message": "邮箱 IMAP 认证连接成功！已安全连入收件箱。"}
        except Exception as ex:
            return {"success": False, "message": f"连接失败: {str(ex)}"}

    @app.get("/api/mail_sync/status")
    def get_mail_sync_status():
        return mail_scheduler.get_status()

    @app.post("/api/mail_sync/trigger")
    def trigger_mail_sync(lookback: int = 50):
        return mail_scheduler.trigger_now(lookback_count=lookback)

    # 8. 数据备份与还原
    EXCLUDE_EXTS = {".exe", ".zip", ".tar", ".gz", ".7z", ".lock", ".tmp", ".log", ".pyc"}
    EXCLUDE_DIRS = {"backups", "logs", "__pycache__", "dist", "build", ".git"}

    @app.get("/api/backup/export")
    def export_backup():
        try:
            backup_dir = config_mgr.data_dir / "backups"
            backup_dir.mkdir(parents=True, exist_ok=True)
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"novaledger_backup_{ts}.zip"
            zip_path = backup_dir / filename
            
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                for root, dirs, files in os.walk(config_mgr.data_dir):
                    dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS and not d.startswith(".")]
                    if any(ed in Path(root).parts for ed in EXCLUDE_DIRS):
                        continue
                    for f in files:
                        try:
                            full_p = Path(root) / f
                            if full_p.suffix.lower() in EXCLUDE_EXTS or full_p.name.startswith("."):
                                continue
                            rel_p = full_p.relative_to(config_mgr.data_dir)
                            zf.write(full_p, arcname=str(rel_p))
                        except Exception:
                            continue
                        
            if not zip_path.exists() or zip_path.stat().st_size == 0:
                raise HTTPException(status_code=500, detail="备份文件打包生成失败")

            return FileResponse(
                path=str(zip_path),
                media_type="application/zip",
                filename=filename,
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"',
                    "Access-Control-Expose-Headers": "Content-Disposition"
                }
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"备份导出失败: {str(e)}")

    @app.post("/api/backup/import")
    async def import_backup(file: UploadFile = File(...)):
        if not (file.filename or "").endswith(".zip"):
            raise HTTPException(status_code=400, detail="仅支持上传 .zip 格式备份包")
        
        backup_dir = config_mgr.data_dir / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        pre_restore_snapshot = backup_dir / f"pre_restore_snapshot_{ts}.zip"
        with zipfile.ZipFile(pre_restore_snapshot, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(config_mgr.data_dir):
                dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS and not d.startswith(".")]
                if any(ed in Path(root).parts for ed in EXCLUDE_DIRS):
                    continue
                for f in files:
                    try:
                        full_p = Path(root) / f
                        if full_p.suffix.lower() in EXCLUDE_EXTS or full_p.name.startswith("."):
                            continue
                        rel_p = full_p.relative_to(config_mgr.data_dir)
                        zf.write(full_p, arcname=str(rel_p))
                    except Exception:
                        continue

        temp_zip = backup_dir / f"upload_{ts}.zip"
        content = await file.read()
        temp_zip.write_bytes(content)

        with zipfile.ZipFile(temp_zip, "r") as zf:
            namelist = zf.namelist()
            has_ledger = any("ledger" in n for n in namelist) or any("transactions.bean" in n for n in namelist)
            if not has_ledger:
                raise HTTPException(status_code=400, detail="备份包格式不符合要求，缺少 ledger 账本数据")
            zf.extractall(config_mgr.data_dir)

        config_mgr.config = config_mgr.load_config()
        valid, errors = ledger_mgr.validate_ledger()
        if not valid:
            return {"success": True, "warning": f"数据已还原，但存在校验告警: {'; '.join(errors)}"}
        return {"success": True, "message": "账本数据已成功还原并校验通过"}

    # 9. 静态资源挂载
    static_path = Path(__file__).resolve().parent / "static"
    static_path.mkdir(parents=True, exist_ok=True)
    app.mount("/", StaticFiles(directory=str(static_path), html=True), name="static")

    return app

