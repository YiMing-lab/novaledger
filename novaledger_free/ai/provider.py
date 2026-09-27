import json
from typing import Any, Dict, List, Optional
from novaledger_free.ai.sanitization import sanitize_text_for_display, validate_category_whitelist
from novaledger_free.core.config import ConfigManager
from novaledger_free.core.security import SecurityManager


class AIService:
    """可选 AI 辅助服务：严格只提供建议，绝不直接改写正式账本，支持离线优雅降级"""

    def __init__(self, config_mgr: ConfigManager, security_mgr: SecurityManager):
        self.cfg = config_mgr
        self.sec = security_mgr

    def is_available(self) -> bool:
        ai_enabled = self.cfg.config.get("system", {}).get("ai_enabled", False)
        has_key = self.sec.has_credential("gemini_api_key")
        return bool(ai_enabled and has_key)

    def get_model_name(self) -> str:
        """获取当前配置的 AI 模型，默认首选 Gemini 3.8 Flash"""
        return self.cfg.config.get("system", {}).get("ai_model", "gemini-3.8-flash")

    def get_category_suggestion(
        self,
        payee: str,
        narration: str,
        amount: str,
        allowed_categories: List[str]
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
                "source": "fallback"
            }

        api_key = self.sec.get_credential("gemini_api_key")
        # 尝试使用 google.genai 调用
        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=api_key)
            prompt = (
                f"你是一个财务记账分类助手。请根据以下交易信息推荐最合适的支出或收入科目：\n"
                f"交易对手: {payee}\n"
                f"交易备注: {narration}\n"
                f"金额: {amount}\n"
                f"可选会计科目白名单: {', '.join(allowed_categories)}\n"
                f"请仅以JSON格式输出：{{\"suggested_category\": \"<选中的科目>\", \"confidence\": 0.95, \"explanation\": \"<简要理由>\"}}"
            )

            model_name = self.get_model_name()
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        temperature=0.1
                    )
                )
            except Exception:
                # 容错降级至备用 flash 模型
                response = client.models.generate_content(
                    model="gemini-3.6-flash",
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        temperature=0.1
                    )
                )

            raw_resp = response.text or "{}"
            data = json.loads(raw_resp)

            candidate_cat = data.get("suggested_category", "")
            valid_cat = validate_category_whitelist(candidate_cat, allowed_categories)
            if not valid_cat:
                valid_cat = "Expenses:Other:General"

            return {
                "available": True,
                "suggested_category": valid_cat,
                "confidence": float(data.get("confidence", 0.8)),
                "explanation": sanitize_text_for_display(data.get("explanation", "AI推荐分类")),
                "source": "ai_gemini"
            }
        except Exception as ex:
            return {
                "available": False,
                "suggested_category": "Expenses:Other:General",
                "confidence": 0.5,
                "explanation": f"AI请求失败或超时，已降级: {sanitize_text_for_display(str(ex))}",
                "source": "fallback_error"
            }

    def test_api_connection(self, test_key: Optional[str] = None) -> Dict[str, Any]:
        """测试 Gemini API Key 连通性"""
        key = test_key or self.sec.get_credential("gemini_api_key")
        if not key:
            return {"success": False, "message": "API Key 不能为空"}
        try:
            from google import genai
            client = genai.Client(api_key=key)
            model_name = self.get_model_name()
            try:
                resp = client.models.generate_content(
                    model=model_name,
                    contents="ping"
                )
            except Exception:
                resp = client.models.generate_content(
                    model="gemini-3.6-flash",
                    contents="ping"
                )
            if resp and resp.text:
                return {"success": True, "message": f"Gemini API 连通性测试成功！(模型: {model_name})"}
            return {"success": False, "message": "未收到有效响应"}
        except Exception as ex:
            return {"success": False, "message": f"连接失败: {str(ex)}"}

    def generate_monthly_financial_insights(self, report_data: Dict[str, Any]) -> Dict[str, Any]:
        """根据当月真实财务数据生成个性化 CFP 深度财务诊断与优化建议"""
        if not self.is_available():
            return {
                "available": False,
                "message": "AI服务未启用或未配置有效的 API Key",
                "insights": None
            }

        api_key = self.sec.get_credential("gemini_api_key")
        try:
            from google import genai
            from google.genai import types

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
                f"  \"overview\": \"<简明总评，评价本月资产积累与收支健康度>\",\n"
                f"  \"spending_assessment\": \"<针对刚需/欲望比例及头部商户开销的结构性分析>\",\n"
                f"  \"runway_evaluation\": \"<对防御性流动资金跑道的评估与对冲建议>\",\n"
                f"  \"actionable_recommendations\": [\"<建议1>\", \"<建议2>\", \"<建议3>\"]\n"
                f"}}"
            )

            client = genai.Client(api_key=api_key)
            model_name = self.get_model_name()
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        temperature=0.2
                    )
                )
            except Exception:
                response = client.models.generate_content(
                    model="gemini-3.6-flash",
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        temperature=0.2
                    )
                )

            raw_resp = response.text or "{}"
            data = json.loads(raw_resp)

            # XSS 安全清洗
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
                    "recommendations": recs
                }
            }
        except Exception as ex:
            return {
                "available": False,
                "message": f"生成 AI 财务洞察失败: {sanitize_text_for_display(str(ex))}",
                "insights": None
            }
