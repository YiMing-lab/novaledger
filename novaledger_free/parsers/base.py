from dataclasses import dataclass, field
from decimal import Decimal
import hashlib
from typing import Any, Dict, Optional
from novaledger_free.core.models import SourceType, to_decimal


@dataclass
class RawRecord:
    """解析器提取的标准化原始账单行"""
    date: str                          # YYYY-MM-DD
    time_str: str                      # HH:MM:SS
    payee: str                         # 交易对方 / 商户
    narration: str                     # 商品说明 / 备注
    amount: Decimal                    # 纯正数金额
    direction: str                     # "支出" | "收入" | "其他"
    status_text: str                   # 交易状态 (支付成功, 交易关闭, 已全额退款等)
    source_type: SourceType            # 来源类型
    source_tx_id: str                  # 来源平台交易订单号
    channel: str = ""                  # 支付方式 (如 零钱, 招商银行储蓄卡(6688))
    category_hint: str = ""            # 原始类别
    raw_payload: Dict[str, Any] = field(default_factory=dict)

    @property
    def fingerprint(self) -> str:
        """生成基于原始核心要素的 SHA-256 交易指纹"""
        raw_sig = f"{self.source_type.value}|{self.source_tx_id}|{self.date}|{self.payee}|{self.amount:.2f}|{self.direction}"
        return hashlib.sha256(raw_sig.encode("utf-8")).hexdigest()
