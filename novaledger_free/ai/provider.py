import json
import re
import time
from typing import Any, Dict, List, Optional
import urllib.error
import urllib.request

from novaledger_free.ai.sanitization import sanitize_text_for_display, validate_category_whitelist
from novaledger_free.core.config import ConfigManager
from novaledger_free.core.security import SecurityManager


def _extract_json_dict(raw_text: str) -> Dict[str, Any]:
    """从大模型原始回复中安全提取 JSON 字典，自动剥离 Markdown 围栏代码块与 <think> 思考标签"""
    text = (raw_text or "").strip()
    if not text:
        return {}
    # 剥离 DeepSeek-R1 等推理模型的 <think>...</think> 标签
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL | re.IGNORECASE).strip()
    # 剥离 ```json 与 ```
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
        text = text.strip()
    # 正则提取最外层花括号
    brace_match = re.search(r"(\{.*\})", text, re.DOTALL)
    if brace_match:
        text = brace_match.group(1)
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _normalize_openai_endpoint(base_url: str, provider: str = "openai") -> str:
    """
    智能归一化 OpenAI / DeepSeek 兼容接口地址：
    无论用户填写：
      - https://api.deepseek.com
      - https://api.deepseek.com/v1
      - https://api.deepseek.com/chat/completions
      - https://api.openai.com
      - https://api.openai.com/v1
    均自动补全为正确的 /chat/completions 完整地址。
    """
    url = (base_url or "").strip().rstrip("/")
    if not url:
        url = "https://api.deepseek.com" if provider == "deepseek" else "https://api.openai.com/v1"
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url

    if url.endswith("/chat/completions"):
        return url
    if re.search(r"/v\d+(?:beta)?(?:/openai)?$", url, flags=re.IGNORECASE):
        return f"{url}/chat/completions"
    if "api.deepseek.com" in url.lower():
        return f"{url}/chat/completions"
    return f"{url}/v1/chat/completions"


def _build_urllib_opener(proxy: str = "") -> urllib.request.OpenerDirector:
    """构建支持可选 HTTP/HTTPS 代理的 urllib Opener"""
    clean_proxy = (proxy or "").strip()
    if clean_proxy:
        if not clean_proxy.startswith("http://") and not clean_proxy.startswith("https://"):
            clean_proxy = f"http://{clean_proxy}"
        proxy_handler = urllib.request.ProxyHandler({
            "http": clean_proxy,
            "https": clean_proxy,
        })
        return urllib.request.build_opener(proxy_handler)
    return urllib.request.build_opener()


class AIService:
    """
    可选 AI 辅助服务：严格只提供建议与诊断，绝不擅自改写正式账本，支持断网离线优雅降级。
    支持三大独立服务商预设：
    1. DeepSeek (deepseek-chat / deepseek-reasoner，国内直连免代理)
    2. Google Gemini (gemini-2.5-flash / gemini-2.0-flash，支持自定义反代 Base URL 与本地 HTTP 代理)
    3. OpenAI 兼容协议 (OpenAI 官方 / 硅基流动 SiliconFlow / 通义千问 / Kimi / 本地 Ollama 等)
    """

    DEFAULT_PROFILES: Dict[str, Dict[str, str]] = {
        "deepseek": {
            "base_url": "https://api.deepseek.com",
            "model": "deepseek-chat",
            "proxy": "",
        },
        "gemini": {
            "base_url": "https://generativelanguage.googleapis.com",
            "model": "gemini-3.8-flash",
            "proxy": "",
        },
        "openai": {
            "base_url": "https://api.openai.com/v1",
            "model": "gpt-4o-mini",
            "proxy": "",
        },
    }

    def __init__(self, config_mgr: ConfigManager, security_mgr: SecurityManager):
        self.cfg = config_mgr
        self.sec = security_mgr

    def _normalize_provider_key(self, raw_provider: Optional[str] = None) -> str:
        p = (raw_provider or self.cfg.config.get("system", {}).get("ai_provider", "gemini")).strip().lower()
        if p in ("deepseek",):
            return "deepseek"
        if p in ("gemini", "google"):
            return "gemini"
        if p in ("openai", "openai_compatible"):
            if p == "openai_compatible":
                legacy_url = self.cfg.config.get("system", {}).get("ai_base_url", "")
                if "deepseek" in legacy_url.lower():
                    return "deepseek"
            return "openai"
        return "gemini"

    def get_provider(self) -> str:
        return self._normalize_provider_key()

    def get_profile(self, provider: Optional[str] = None) -> Dict[str, str]:
        p_key = self._normalize_provider_key(provider)
        sys_cfg = self.cfg.config.get("system", {})
        profiles = sys_cfg.get("ai_profiles", {})
        saved_prof = profiles.get(p_key, {}) if isinstance(profiles, dict) else {}
        defaults = self.DEFAULT_PROFILES.get(p_key, self.DEFAULT_PROFILES["gemini"])

        base_url = saved_prof.get("base_url") or (
            sys_cfg.get("ai_base_url") if self._normalize_provider_key(sys_cfg.get("ai_provider")) == p_key else ""
        ) or defaults["base_url"]

        model = saved_prof.get("model") or (
            sys_cfg.get("ai_model") if self._normalize_provider_key(sys_cfg.get("ai_provider")) == p_key else ""
        ) or defaults["model"]

        proxy = saved_prof.get("proxy") if "proxy" in saved_prof else sys_cfg.get("ai_proxy", "")

        return {
            "provider": p_key,
            "base_url": str(base_url).strip(),
            "model": str(model).strip(),
            "proxy": str(proxy or "").strip(),
        }

    def get_api_key(self, provider: Optional[str] = None, override_key: Optional[str] = None) -> str:
        if override_key and override_key.strip():
            return override_key.strip()
        p_key = self._normalize_provider_key(provider)
        cred_map = {
            "deepseek": "deepseek_api_key",
            "gemini": "gemini_api_key",
            "openai": "openai_api_key",
        }
        primary_cred = cred_map.get(p_key, "gemini_api_key")
        val = self.sec.get_credential(primary_cred)
        if val:
            return val
        # 向后兼容：若当前配置就是该 provider，回退读取旧版通用 gemini_api_key
        legacy_key = self.sec.get_credential("gemini_api_key")
        if p_key == "gemini":
            return legacy_key
        if legacy_key and legacy_key.startswith("sk-"):
            return legacy_key
        return ""

    def is_available(self) -> bool:
        ai_enabled = self.cfg.config.get("system", {}).get("ai_enabled", False)
        if not ai_enabled:
            return False
        return bool(self.get_api_key())

    def get_base_url(self) -> str:
        return self.get_profile()["base_url"]

    def get_model_name(self) -> str:
        return self.get_profile()["model"]

    def _call_openai_compatible(
        self,
        prompt: str,
        system_prompt: str = "",
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model_name: Optional[str] = None,
        proxy: Optional[str] = None,
        provider: str = "openai",
        max_tokens: Optional[int] = None,
        timeout: float = 22.0,
    ) -> str:
        """通过标准 OpenAI / DeepSeek Chat Completions 协议发起请求"""
        prof = self.get_profile(provider)
        key = self.get_api_key(provider, api_key)
        if not key:
            raise ValueError("未配置 API Key")

        target_base = base_url if base_url is not None else prof["base_url"]
        endpoint = _normalize_openai_endpoint(target_base, provider=provider)
        target_model = (model_name or prof["model"]).strip()
        target_proxy = proxy if proxy is not None else prof["proxy"]

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        payload: Dict[str, Any] = {
            "model": target_model,
            "messages": messages,
            "temperature": 0.1,
        }
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens

        data_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            endpoint,
            data=data_bytes,
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "NovaLedger/2.0",
            },
            method="POST",
        )

        opener = _build_urllib_opener(target_proxy)
        try:
            with opener.open(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8")
                res_obj = json.loads(raw)
                choices = res_obj.get("choices", [])
                if choices:
                    msg = choices[0].get("message", {})
                    return msg.get("content") or msg.get("reasoning_content") or ""
                return ""
        except urllib.error.HTTPError as ex:
            err_body = ex.read().decode("utf-8", errors="ignore")
            try:
                err_json = json.loads(err_body)
                err_msg = err_json.get("error", {}).get("message") or err_body[:200]
            except Exception:
                err_msg = err_body[:200]
            raise RuntimeError(f"HTTP {ex.code} ({endpoint}): {err_msg}")
        except urllib.error.URLError as ex:
            raise RuntimeError(f"网络连接失败 ({endpoint}): {ex.reason}")

    def _call_gemini(
        self,
        prompt: str,
        system_prompt: str = "",
        json_mode: bool = False,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model_name: Optional[str] = None,
        proxy: Optional[str] = None,
        timeout: float = 20.0,
    ) -> str:
        """
        调用 Google Gemini：
        1. 若 Base URL 为 OpenAI 兼容网关 (如 .../v1 或 .../v1beta/openai)，自动走 OpenAI 兼容协议；
        2. 否则通过 Gemini REST API ({base_url}/v1beta/models/{model}:generateContent) 发起请求，
           原生支持自定义反代域名与本地 HTTP 代理，并在模型名不匹配时自动回退 gemini-2.5-flash / gemini-2.0-flash。
        """
        prof = self.get_profile("gemini")
        key = self.get_api_key("gemini", api_key)
        if not key:
            raise ValueError("未配置 Gemini API Key")

        target_base = (base_url if base_url is not None else prof["base_url"]).strip().rstrip("/")
        if not target_base:
            target_base = "https://generativelanguage.googleapis.com"
        if not target_base.startswith("http://") and not target_base.startswith("https://"):
            target_base = "https://" + target_base

        target_model = (model_name or prof["model"] or "gemini-3.8-flash").strip()
        if target_model in ("gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"):
            target_model = "gemini-3.8-flash"
        target_proxy = proxy if proxy is not None else prof["proxy"]

        # 如果用户填写的是 OpenAI 格式的 Gemini 中转地址
        if re.search(r"/v1(?:beta/openai)?(?:/chat/completions)?$", target_base, flags=re.IGNORECASE):
            return self._call_openai_compatible(
                prompt=prompt,
                system_prompt=system_prompt,
                api_key=key,
                base_url=target_base,
                model_name=target_model,
                proxy=target_proxy,
                provider="gemini",
                timeout=timeout,
            )

        # 构建候选模型队列（用户填的模型优先，若 404/503 则自动尝试可用模型）
        candidate_models = [target_model]
        for fallback_m in ("gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"):
            if fallback_m not in candidate_models:
                candidate_models.append(fallback_m)

        full_prompt = f"{system_prompt}\n\n{prompt}".strip() if system_prompt else prompt
        payload: Dict[str, Any] = {
            "contents": [{"parts": [{"text": full_prompt}]}],
            "generationConfig": {"temperature": 0.1},
        }
        if json_mode:
            payload["generationConfig"]["responseMimeType"] = "application/json"

        data_bytes = json.dumps(payload).encode("utf-8")
        opener = _build_urllib_opener(target_proxy)
        last_error: Optional[Exception] = None

        for m_name in candidate_models:
            clean_m = m_name.replace("models/", "")
            endpoint = f"{target_base}/v1beta/models/{clean_m}:generateContent?key={key}"
            req = urllib.request.Request(
                endpoint,
                data=data_bytes,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "User-Agent": "NovaLedger/2.0",
                },
                method="POST",
            )
            try:
                with opener.open(req, timeout=timeout) as resp:
                    raw = resp.read().decode("utf-8")
                    res_obj = json.loads(raw)
                    candidates = res_obj.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        if parts:
                            return "".join(p.get("text", "") for p in parts)
                    return ""
            except urllib.error.HTTPError as ex:
                err_body = ex.read().decode("utf-8", errors="ignore")
                try:
                    err_json = json.loads(err_body)
                    err_msg = err_json.get("error", {}).get("message") or err_body[:200]
                except Exception:
                    err_msg = err_body[:200]
                last_error = RuntimeError(f"HTTP {ex.code} ({clean_m}): {err_msg}")
                # 若是 404 模型不存在或 429/5xx 瞬时高负载，自动尝试下一个候选模型；若是 400/401/403 Key 错误则立即终止
                if ex.code in (404, 429, 500, 502, 503, 504):
                    continue
                break
            except urllib.error.URLError as ex:
                last_error = RuntimeError(
                    f"无法连接 Google Gemini 接口 ({target_base}): {ex.reason}。"
                    f"如在国内网络直连官方接口，请填写「本地代理 Proxy」(如 http://127.0.0.1:7890) 或切换使用 DeepSeek。"
                )
                break
            except Exception as ex:
                last_error = ex
                break

        raise last_error or RuntimeError("Gemini 请求失败")

    def _invoke_llm(self, prompt: str, system_prompt: str = "", json_mode: bool = True) -> tuple[str, str]:
        """统一调度当前激活的 AI 服务商并返回 (响应文本, 来源标识)"""
        provider = self.get_provider()
        prof = self.get_profile(provider)
        if provider == "gemini":
            text = self._call_gemini(
                prompt=prompt,
                system_prompt=system_prompt,
                json_mode=json_mode,
            )
            return text, f"ai_gemini_{prof['model']}"
        else:
            text = self._call_openai_compatible(
                prompt=prompt,
                system_prompt=system_prompt,
                provider=provider,
            )
            return text, f"ai_{provider}_{prof['model']}"

    def get_category_suggestion(
        self,
        payee: str,
        narration: str,
        amount: str,
        allowed_categories: List[str],
    ) -> Dict[str, Any]:
        """
        获取智能分类建议。
        若 AI 未开启、无 Key 或调用超时，自动优雅降级为本地规则或通用分类。
        """
        if not self.is_available():
            return {
                "available": False,
                "suggested_category": "Expenses:Other:General",
                "confidence": 0.5,
                "explanation": "AI服务未启用或未配置API Key，使用默认分类",
                "source": "fallback",
            }

        prompt = (
            f"你是一个专业的个人财务记账分类助手。请根据以下交易信息推荐最合适的支出或收入科目：\n"
            f"交易对手: {payee}\n"
            f"交易备注: {narration}\n"
            f"金额: {amount}\n"
            f"可选会计科目白名单: {', '.join(allowed_categories)}\n"
            f'请仅以标准 JSON 格式输出：{{"suggested_category": "<选中的科目>", "confidence": 0.95, "explanation": "<简要理由>"}}'
        )

        try:
            raw_resp, source_label = self._invoke_llm(
                prompt=prompt,
                system_prompt="你是一个严谨的财务分类器，只输出合法 JSON。",
                json_mode=True,
            )
            data = _extract_json_dict(raw_resp)

            candidate_cat = data.get("suggested_category", "")
            valid_cat = validate_category_whitelist(candidate_cat, allowed_categories)
            if not valid_cat:
                valid_cat = "Expenses:Other:General"

            return {
                "available": True,
                "suggested_category": valid_cat,
                "confidence": float(data.get("confidence", 0.8)),
                "explanation": sanitize_text_for_display(data.get("explanation", "AI推荐分类")),
                "source": source_label,
            }
        except Exception as ex:
            return {
                "available": False,
                "suggested_category": "Expenses:Other:General",
                "confidence": 0.5,
                "explanation": f"AI请求失败或超时，已降级: {sanitize_text_for_display(str(ex))}",
                "source": "fallback_error",
            }

    def test_api_connection(
        self,
        test_key: Optional[str] = None,
        provider: Optional[str] = None,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        proxy: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        即时测试 AI 接口连通性：
        优先使用前端当前表单传入的 provider / base_url / model / proxy / test_key，
        无需先保存即可验证全套连接参数，并返回响应耗时与详细诊断信息。
        """
        p_key = self._normalize_provider_key(provider)
        prof = self.get_profile(p_key)
        key = self.get_api_key(p_key, test_key)
        if not key:
            return {
                "success": False,
                "message": f"请先输入 {p_key.upper()} 的 API Key（或先保存凭据）",
            }

        target_base = (base_url if base_url is not None and base_url.strip() else prof["base_url"]).strip()
        target_model = (model if model is not None and model.strip() else prof["model"]).strip()
        target_proxy = (proxy if proxy is not None else prof["proxy"]).strip()

        t0 = time.perf_counter()
        try:
            if p_key == "gemini":
                reply = self._call_gemini(
                    prompt="请仅回复 OK 两个字母",
                    system_prompt="",
                    json_mode=False,
                    api_key=key,
                    base_url=target_base,
                    model_name=target_model,
                    proxy=target_proxy,
                    timeout=12.0,
                )
                elapsed_ms = int((time.perf_counter() - t0) * 1000)
                return {
                    "success": True,
                    "provider": "gemini",
                    "model": target_model,
                    "endpoint": target_base,
                    "latency_ms": elapsed_ms,
                    "message": f"Google Gemini 连通成功！模型: {target_model} · 延迟: {elapsed_ms}ms · 回复: {(reply or 'OK').strip()[:20]}",
                }
            else:
                endpoint = _normalize_openai_endpoint(target_base, provider=p_key)
                reply = self._call_openai_compatible(
                    prompt="请仅回复 OK 两个字母",
                    system_prompt="",
                    api_key=key,
                    base_url=target_base,
                    model_name=target_model,
                    proxy=target_proxy,
                    provider=p_key,
                    max_tokens=10,
                    timeout=12.0,
                )
                elapsed_ms = int((time.perf_counter() - t0) * 1000)
                provider_label = "DeepSeek" if p_key == "deepseek" else "OpenAI 兼容接口"
                return {
                    "success": True,
                    "provider": p_key,
                    "model": target_model,
                    "endpoint": endpoint,
                    "latency_ms": elapsed_ms,
                    "message": f"{provider_label} 连通成功！模型: {target_model} · 延迟: {elapsed_ms}ms · 回复: {(reply or 'OK').strip()[:20]}",
                }
        except Exception as ex:
            elapsed_ms = int((time.perf_counter() - t0) * 1000)
            return {
                "success": False,
                "provider": p_key,
                "model": target_model,
                "latency_ms": elapsed_ms,
                "message": f"连接失败: {str(ex)}",
            }

    def generate_monthly_financial_insights(self, report_data: Dict[str, Any]) -> Dict[str, Any]:
        """根据当月真实财务数据生成个性化 CFP 深度财务诊断与优化建议"""
        if not self.is_available():
            return {
                "available": False,
                "message": "AI服务未启用或未配置有效的 API Key",
                "insights": None,
            }

        inc = report_data.get("income_statement", {})
        nws = report_data.get("needs_wants_savings", {})
        burn = report_data.get("daily_burn_rate", {})
        payees = report_data.get("top_payees", [])
        runway = report_data.get("emergency_runway", {})

        top_payees_list = [f"{p.get('payee')}(¥{p.get('amount')})" for p in payees[:3]]
        top_payees_str = ", ".join(top_payees_list) if top_payees_list else "无"

        summary_text = (
            f"月份: {report_data.get('month')}\n"
            f"总收入: ¥{inc.get('total_income', 0):.2f}\n"
            f"总支出: ¥{inc.get('total_expenses', 0):.2f}\n"
            f"结余储蓄率: {inc.get('savings_rate', 0)}% (净留存 ¥{inc.get('monthly_surplus', 0):.2f})\n"
            f"50/30/20比例: 刚需 ¥{nws.get('needs_amount', 0):.2f} ({nws.get('needs_ratio', 0)}%), 欲望 ¥{nws.get('wants_amount', 0):.2f} ({nws.get('wants_ratio', 0)}%)\n"
            f"日均开销 (Run Rate): ¥{burn.get('daily_run_rate', 0):.2f}/天, 月末推演支出: ¥{burn.get('projected_month_expense', 0):.2f}\n"
            f"主要消费商户 Top 3: {top_payees_str}\n"
            f"应急资金跑道: {runway.get('runway_months', 0)} 个月 ({runway.get('health_status', '未知')})\n"
        )

        prompt = (
            f"你是一位拥有 CFP 认证的高级私人财富规划顾问。请根据用户当月的脱敏财务统计指标，提供严谨客观、建设性的专业诊断与下月改善建议。\n\n"
            f"【财务指标摘要】\n{summary_text}\n"
            f"请严格按以下 JSON 格式输出：\n"
            f"{{\n"
            f'  "overview": "<简明总评，评价本月资产积累与收支健康度>",\n'
            f'  "spending_assessment": "<针对刚需/欲望比例及头部商户开销的结构性分析>",\n'
            f'  "runway_evaluation": "<对防御性流动资金跑道的评估与对冲建议>",\n'
            f'  "actionable_recommendations": ["<建议1>", "<建议2>", "<建议3>"]\n'
            f"}}"
        )

        try:
            raw_resp, _ = self._invoke_llm(
                prompt=prompt,
                system_prompt="你是一位拥有 CFP 国际理财师认证的资深私人财富顾问，只输出标准 JSON。",
                json_mode=True,
            )
            data = _extract_json_dict(raw_resp)

            overview = sanitize_text_for_display(data.get("overview", "暂无总评"))
            spending = sanitize_text_for_display(data.get("spending_assessment", "支出结构分析"))
            runway_eval = sanitize_text_for_display(data.get("runway_evaluation", "防御性资金评估"))
            recs = [sanitize_text_for_display(r) for r in data.get("actionable_recommendations", [])]

            return {
                "available": True,
                "insights": {
                    "overview": overview,
                    "spending_assessment": spending,
                    "runway_evaluation": runway_eval,
                    "recommendations": recs,
                },
            }
        except Exception as ex:
            return {
                "available": False,
                "message": f"生成 AI 财务洞察失败: {sanitize_text_for_display(str(ex))}",
                "insights": None,
            }

    def parse_bank_email_fallback(
        self,
        subject: str,
        sender: str,
        body_text: str,
        default_date: str = "",
    ) -> List[Dict[str, Any]]:
        """
        当内置银行正则未命中且 AI 开启时，调用大模型从银行动账/账单邮件文本中提取结构化交易流水。
        提取结果标记为 ai_fallback，进入待确认队列由人工审核入账。
        """
        if not self.is_available():
            return []

        clean_body = (body_text or "").strip()[:3500]
        if not clean_body:
            return []

        prompt = (
            f"你是一个精准的银行账单与动账通知邮件解析器。请从以下邮件内容中提取所有真实的资金交易流水（忽略广告、安全提醒、积分通知、纯账单汇总无明细等非单笔交易内容）。\n"
            f"发件人: {sender}\n"
            f"邮件主题: {subject}\n"
            f"默认参考日期: {default_date}\n"
            f"邮件正文:\n{clean_body}\n\n"
            f"请严格按以下 JSON 格式输出（若无具体交易流水，transactions 返回空数组 []）：\n"
            f"{{\n"
            f'  "bank_name": "<识别出的银行名称，如建设银行>",\n'
            f'  "transactions": [\n'
            f"    {{\n"
            f'      "date": "YYYY-MM-DD",\n'
            f'      "time_str": "HH:MM:SS",\n'
            f'      "amount": 123.45,\n'
            f'      "direction": "支出 或 收入",\n'
            f'      "is_refund": false,\n'
            f'      "is_repayment": false,\n'
            f'      "payee": "<商户名称或交易对手>",\n'
            f'      "narration": "<交易摘要，如消费/快捷支付/退款/转入>",\n'
            f'      "card_tail": "<4位卡号尾号，无则留空>"\n'
            f"    }}\n"
            f"  ]\n"
            f"}}"
        )

        try:
            raw_resp, _ = self._invoke_llm(
                prompt=prompt,
                system_prompt="你是一个精准的金融邮件结构化提取器，只输出合法 JSON 对象。",
                json_mode=True,
            )
            data = _extract_json_dict(raw_resp)

            bank_name = sanitize_text_for_display(str(data.get("bank_name") or "银行邮件"))
            tx_list = data.get("transactions", [])
            if not isinstance(tx_list, list):
                return []

            results: List[Dict[str, Any]] = []
            for item in tx_list:
                if not isinstance(item, dict):
                    continue
                amt = item.get("amount")
                if amt is None:
                    continue
                try:
                    amt_val = abs(float(str(amt).replace(",", "")))
                except Exception:
                    continue
                if amt_val <= 0:
                    continue
                results.append({
                    "bank_name": bank_name,
                    "date": str(item.get("date") or default_date)[:10],
                    "time_str": str(item.get("time_str") or "12:00:00")[:8],
                    "amount": amt_val,
                    "direction": "收入" if str(item.get("direction")) == "收入" else "支出",
                    "is_refund": bool(item.get("is_refund", False)),
                    "is_repayment": bool(item.get("is_repayment", False)),
                    "payee": sanitize_text_for_display(str(item.get("payee") or f"{bank_name}商户")),
                    "narration": sanitize_text_for_display(str(item.get("narration") or f"{bank_name}动账")),
                    "card_tail": re.sub(r"\D", "", str(item.get("card_tail") or ""))[-4:],
                })
            return results
        except Exception:
            return []
