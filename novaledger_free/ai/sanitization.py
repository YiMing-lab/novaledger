import html
import re
from typing import List, Optional


DANGEROUS_HTML_PATTERN = re.compile(
    r"<\s*(script|iframe|object|embed|style|link|meta|base|form)[^>]*>.*?</\s*\1\s*>|"
    r"<\s*(script|iframe|object|embed|style|link|meta|base|form)[^>]*/>|"
    r"javascript\s*:[^\"']+|on\w+\s*=\s*[\"'][^\"']*[\"']",
    re.IGNORECASE | re.DOTALL
)


def sanitize_text_for_display(text: str) -> str:
    """清洗不可信文本（包括 AI 响应和外部文本），消除 XSS 与脚本注入风险"""
    if not text:
        return ""
    # 移除危险标签与内联脚本事件
    cleaned = DANGEROUS_HTML_PATTERN.sub("", text)
    # 实体转义
    return html.escape(cleaned, quote=True)


def validate_category_whitelist(category: str, allowed_categories: List[str]) -> Optional[str]:
    """科目白名单校验：防止 AI 生成任意非法科目注入账本"""
    clean_cat = category.strip()
    if clean_cat in allowed_categories:
        return clean_cat
    for allowed in allowed_categories:
        if clean_cat.lower() == allowed.lower():
            return allowed
    return None
