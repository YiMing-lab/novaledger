import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, field_validator, model_validator


ACCOUNT_REGEX = re.compile(r"^(Assets|Liabilities|Equity|Income|Expenses)(:[A-Z0-9][A-Za-z0-9-]*)+$")


class SourceType(str, Enum):
    MANUAL = "manual"
    WECHAT_CSV = "wechat_csv"
    ALIPAY_CSV = "alipay_csv"
    BANK_EMAIL = "bank_email"
    GENERIC_CSV = "generic_csv"
    RECONCILIATION = "reconciliation"
    MIGRATION = "migration"


class ImportStatus(str, Enum):
    ADDED = "added"          # 确认为新交易，正式入账
    DUPLICATE = "duplicate"  # 判定为重复记录，保留证据关联，不重复入账
    PENDING = "pending"      # 信息存疑（如多对一匹配、退款未找到原单），进入待确认队列
    FAILED = "failed"        # 解析或格式校验失败


class TransactionStatus(str, Enum):
    ACTIVE = "active"
    ARCHIVED = "archived"
    RECONCILED = "reconciled"


class OperationType(str, Enum):
    APPEND = "append"
    UPDATE = "update"
    DELETE = "delete"
    RECONCILE = "reconcile"
    IMPORT_BATCH = "import_batch"
    BATCH_ROLLBACK = "batch_rollback"


def to_decimal(val: Any) -> Decimal:
    """安全转换为保留2位小数的有限 Decimal"""
    if isinstance(val, Decimal):
        d = val
    elif isinstance(val, (int, float, str)):
        try:
            d = Decimal(str(val).strip())
        except (InvalidOperation, TypeError):
            raise ValueError(f"无效的金额格式: {val}")
    else:
        raise ValueError(f"无法解析的金额类型: {type(val)}")

    if not d.is_finite():
        raise ValueError("金额必须为有限数值，不允许 NaN 或 Infinity")
    return d.quantize(Decimal("0.01"))


def escape_beancount_str(text: str) -> str:
    """转义 Beancount 字符串中的双引号并去除换行"""
    if not text:
        return ""
    cleaned = text.replace("\r", "").replace("\n", " ").strip()
    return cleaned.replace('"', '\\"')


def unescape_beancount_str(text: str) -> str:
    """还原转义的 Beancount 字符串"""
    if not text:
        return ""
    return text.replace('\\"', '"')


class Posting(BaseModel):
    account: str
    amount: Decimal
    currency: str = "CNY"

    @field_validator("account")
    @classmethod
    def validate_account_name(cls, v: str) -> str:
        v = v.strip()
        if not ACCOUNT_REGEX.match(v):
            raise ValueError(f"非法会计科目名称: '{v}'，必须符合 Beancount 命名规范 (如 Assets:Bank:CMB:Card001)")
        return v

    @field_validator("amount", mode="before")
    @classmethod
    def validate_amount(cls, v: Any) -> Decimal:
        return to_decimal(v)


class TransactionModel(BaseModel):
    id: str = Field(..., description="内部唯一稳定交易ID, 例如 nl_tx_...")
    date: str = Field(..., description="交易日期 YYYY-MM-DD")
    payee: str = Field(default="", description="收款方/商户")
    narration: str = Field(default="", description="交易备注/用途说明")
    postings: List[Posting] = Field(..., min_length=2, description="借贷记账分录，至少2条")
    source_type: SourceType = Field(default=SourceType.MANUAL)
    source_tx_id: Optional[str] = Field(default=None, description="外部来源原始单号")
    source_fingerprint: Optional[str] = Field(default=None, description="原始字段哈希指纹")
    import_batch: Optional[str] = Field(default=None, description="导入批次号")
    status: TransactionStatus = Field(default=TransactionStatus.ACTIVE)
    tags: List[str] = Field(default_factory=list)
    links: List[str] = Field(default_factory=list)
    extra_metadata: Dict[str, str] = Field(default_factory=dict)

    @field_validator("date")
    @classmethod
    def validate_date(cls, v: str) -> str:
        try:
            datetime.strptime(v.strip(), "%Y-%m-%d")
            return v.strip()
        except ValueError:
            raise ValueError(f"无效日期格式 '{v}'，必须为 YYYY-MM-DD")

    @model_validator(mode="after")
    def check_balance(self) -> "TransactionModel":
        """校验复式记账借贷平衡（各币种合计必须为0）"""
        balance_by_currency: Dict[str, Decimal] = {}
        for p in self.postings:
            balance_by_currency[p.currency] = balance_by_currency.get(p.currency, Decimal("0.00")) + p.amount
        
        for curr, bal in balance_by_currency.items():
            if bal != Decimal("0.00"):
                raise ValueError(f"分录借贷不平衡: 币种 {curr} 差额为 {bal}")
        return self

    def to_beancount_str(self) -> str:
        """格式化输出标准且严格转义的 Beancount 语法字符串"""
        payee_escaped = escape_beancount_str(self.payee)
        narration_escaped = escape_beancount_str(self.narration)
        
        header = f'{self.date} * "{payee_escaped}" "{narration_escaped}"'
        if self.tags:
            header += " " + " ".join(f"#{t}" for t in self.tags)
        if self.links:
            header += " " + " ".join(f"^{l}" for l in self.links)

        lines = [header]
        # Metadata
        lines.append(f'  id: "{self.id}"')
        lines.append(f'  source_type: "{self.source_type.value}"')
        if self.source_tx_id:
            lines.append(f'  source_tx_id: "{escape_beancount_str(self.source_tx_id)}"')
        if self.source_fingerprint:
            lines.append(f'  source_fingerprint: "{self.source_fingerprint}"')
        if self.import_batch:
            lines.append(f'  import_batch: "{self.import_batch}"')
        if self.status != TransactionStatus.ACTIVE:
            lines.append(f'  status: "{self.status.value}"')
            
        for k, v in self.extra_metadata.items():
            lines.append(f'  {k}: "{escape_beancount_str(str(v))}"')

        # Postings
        for p in self.postings:
            lines.append(f"  {p.account:<40}  {p.amount:>12.2f} {p.currency}")

        return "\n".join(lines)
