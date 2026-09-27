import React, { useMemo, useState } from "react";
import {
  AccountItem,
  CategoryItem,
  CategoryRankingItem,
  FinancialReport,
  HistoricalTrends,
  MerchantRankingItem,
  TransactionItem,
} from "../api/types";
import { api } from "../api/client";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SheetDrawer,
  useToast,
} from "../components/ui/primitives";
import { formatCurrency } from "../lib/utils";
import {
  BarChart3,
  Store,
  TrendingUp,
  Sparkles,
  ShieldCheck,
  Flame,
  ChevronRight,
} from "lucide-react";

interface AnalyticsViewProps {
  report: FinancialReport | null;
  trends: HistoricalTrends | null;
  accounts: AccountItem[];
  categories: CategoryItem[];
  transactions: TransactionItem[];
  selectedMonth: string;
  onMonthChange: (m: string) => void;
}

const CHART_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#8b5cf6",
  "#06b6d4",
  "#f43f5e",
  "#84cc16",
];

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({
  report,
  trends,
  accounts,
  categories,
  transactions,
  selectedMonth,
  onMonthChange,
}) => {
  const toast = useToast();
  const [subTab, setSubTab] = useState<"overview" | "merchants" | "assets">("overview");
  const [assetGranularity, setAssetGranularity] = useState<"monthly" | "daily">("monthly");
  const [drillCategory, setDrillCategory] = useState<CategoryRankingItem | null>(null);
  const [drillMerchant, setDrillMerchant] = useState<MerchantRankingItem | null>(null);
  const [aiInsights, setAiInsights] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const activeMonth = selectedMonth === "all" ? report?.month || new Date().toISOString().slice(0, 7) : selectedMonth;

  const nameMap = useMemo(() => {
    const map: Record<string, string> = {};
    accounts.forEach((a) => (map[a.account] = a.name));
    categories.forEach((c) => (map[c.account] = c.name));
    return map;
  }, [accounts, categories]);

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    set.add(new Date().toISOString().slice(0, 7));
    transactions.forEach((t) => {
      if (t.date && t.date.length >= 7) set.add(t.date.slice(0, 7));
    });
    return Array.from(set).sort().reverse();
  }, [transactions]);

  const handleLoadAIInsights = async () => {
    setAiLoading(true);
    try {
      const res = await api.getAIReportInsights(activeMonth);
      if (res.available && res.insights) {
        setAiInsights(res.insights);
        toast.success("AI CFP 月度财务健康诊断已生成！");
      } else {
        toast.info(res.message || "AI 服务未启用，请先在『设置 -> 邮箱与AI设置』中配置 API Key");
      }
    } catch (e: any) {
      toast.error(`获取 AI 诊断失败: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  };

  const catRanking = report?.category_ranking || [];
  const merchantRanking = report?.merchant_ranking || [];
  const dailySeries = report?.daily_series || [];
  const dailyDays =
    dailySeries.length > 0
      ? dailySeries.map((d) => d.day)
      : (report?.daily_spending?.days || []);
  const dailyAmts =
    dailySeries.length > 0
      ? dailySeries.map((d) => d.amount)
      : (report?.daily_spending?.amounts || []);
  const maxDailyAmt = Math.max(...dailyAmts, 1);
  const burn = report?.daily_burn_rate;
  const runway = report?.emergency_runway;
  const nws = report?.needs_wants_savings;

  // 多资产折线图数据构建 (按月 vs 按日)
  const multiAssetSeries = useMemo(() => {
    if (assetGranularity === "daily" && report?.asset_daily_trends) {
      const adt = report.asset_daily_trends;
      return {
        labels: (adt.days || []).map((d) => {
          const s = String(d);
          return s.endsWith("日") ? s : `${s}日`;
        }),
        series: (adt.accounts || []).map((acc, idx) => ({
          account: acc.account,
          name: acc.name || nameMap[acc.account] || acc.account.split(":").pop() || acc.account,
          color: CHART_COLORS[idx % CHART_COLORS.length],
          values: acc.balances || [],
        })),
      };
    }
    const labels = trends?.months || [];
    const rawAssetTrends = trends?.asset_trends;
    if (Array.isArray(rawAssetTrends) && rawAssetTrends.length > 0) {
      return {
        labels,
        series: rawAssetTrends.map((acc, idx) => ({
          account: acc.account,
          name: acc.name || nameMap[acc.account] || acc.account.split(":").pop() || acc.account,
          color: CHART_COLORS[idx % CHART_COLORS.length],
          values: acc.balances || [],
        })),
      };
    }
    const accMap =
      rawAssetTrends && !Array.isArray(rawAssetTrends) ? rawAssetTrends.accounts || {} : {};
    const keys = Object.keys(accMap);
    if (keys.length > 0) {
      return {
        labels,
        series: keys.map((k, idx) => ({
          account: k,
          name: nameMap[k] || k.split(":").pop() || k,
          color: CHART_COLORS[idx % CHART_COLORS.length],
          values: accMap[k] || [],
        })),
      };
    }
    const nwTrend = trends?.net_worth_trend || [];
    if (nwTrend.length > 0) {
      return {
        labels,
        series: [
          {
            account: "total_assets",
            name: "总资产",
            color: "#10b981",
            values: nwTrend.map((n) => n.total_assets),
          },
          {
            account: "net_worth",
            name: "净资产",
            color: "#3b82f6",
            values: nwTrend.map((n) => n.net_worth),
          },
        ],
      };
    }
    return {
      labels,
      series: [],
    };
  }, [assetGranularity, report, trends, nameMap]);

  // SVG 折线图渲染辅助
  const renderMultiLineSvg = () => {
    const { labels, series } = multiAssetSeries;
    if (!labels.length || !series.length) {
      return <div className="py-12 text-center text-xs text-muted-foreground">暂无走势数据</div>;
    }
    const allVals = series.flatMap((s) => s.values);
    const minVal = Math.min(0, ...allVals);
    const maxVal = Math.max(100, ...allVals);
    const span = maxVal - minVal || 1;
    const W = 760;
    const H = 250;
    const padL = 68;
    const padR = 24;
    const padT = 20;
    const padB = 32;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const toX = (i: number) =>
      labels.length <= 1 ? padL + plotW / 2 : padL + (i / (labels.length - 1)) * plotW;
    const toY = (v: number) => padT + plotH - ((v - minVal) / span) * plotH;

    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-3 text-xs">
          {series.map((s) => {
            const latestVal = s.values[s.values.length - 1] ?? 0;
            return (
              <div key={s.account} className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 bg-background/60">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="font-medium">{s.name}</span>
                <span className="font-mono text-muted-foreground">{formatCurrency(latestVal)}</span>
              </div>
            );
          })}
        </div>

        <div className="w-full overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-64 overflow-visible">
            {[0, 0.25, 0.5, 0.75, 1].map((t, idx) => {
              const val = minVal + t * span;
              const y = toY(val);
              return (
                <g key={idx}>
                  <line
                    x1={padL}
                    y1={y}
                    x2={W - padR}
                    y2={y}
                    stroke="currentColor"
                    className="text-border"
                    strokeDasharray="3 3"
                  />
                  <text
                    x={padL - 8}
                    y={y + 4}
                    textAnchor="end"
                    className="fill-muted-foreground text-[10px] font-mono"
                  >
                    ¥{Math.round(val).toLocaleString()}
                  </text>
                </g>
              );
            })}

            {series.map((s) => {
              const pts = s.values.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");
              return (
                <g key={s.account}>
                  <polyline
                    fill="none"
                    stroke={s.color}
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={pts}
                  />
                  {s.values.map((v, i) => (
                    <circle key={i} cx={toX(i)} cy={toY(v)} r="3" fill={s.color}>
                      <title>{`${labels[i]} ${s.name}: ${formatCurrency(v)}`}</title>
                    </circle>
                  ))}
                </g>
              );
            })}

            {labels.map((lbl, i) => {
              const step = labels.length > 15 ? 3 : 1;
              if (i % step !== 0 && i !== labels.length - 1) return null;
              return (
                <text
                  key={i}
                  x={toX(i)}
                  y={H - 8}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px] font-mono"
                >
                  {lbl}
                </text>
              );
            })}
          </svg>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* 顶栏：月份选择与 3 大分析维度切换 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border bg-muted p-1 gap-1">
          <button
            onClick={() => setSubTab("overview")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-medium transition-all ${
              subTab === "overview"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <BarChart3 className="h-3.5 w-3.5" /> 分类与每日支出
          </button>
          <button
            onClick={() => setSubTab("merchants")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-medium transition-all ${
              subTab === "merchants"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Store className="h-3.5 w-3.5" /> 商户消费排行 ({merchantRanking.length})
          </button>
          <button
            onClick={() => setSubTab("assets")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-medium transition-all ${
              subTab === "assets"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <TrendingUp className="h-3.5 w-3.5" /> 资产与净值走势
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">统计月份:</span>
          <Select
            value={activeMonth}
            onChange={(e) => onMonthChange(e.target.value)}
            className="w-36"
          >
            {availableMonths.map((m) => (
              <option key={m} value={m}>
                📅 {m}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {/* 子视图 1：分类排行榜（支持点击查看商户） + 按日横向条形图 */}
      {subTab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* 左侧：支出分类排行榜 */}
          <Card className="lg:col-span-6">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>📊 支出分类排行 ({activeMonth})</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    点击分类可查看该分类下的商户消费明细
                  </p>
                </div>
                <Badge variant="outline">总支出 {formatCurrency(report?.income_statement?.total_expenses ?? 0)}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {catRanking.length === 0 ? (
                <div className="py-12 text-center text-xs text-muted-foreground">当月暂无支出数据</div>
              ) : (
                catRanking.map((item, idx) => {
                  const catName = nameMap[item.category] || item.category;
                  const merchantCount = item.merchants?.length || 0;
                  const itemPct = item.percentage ?? item.ratio ?? 0;
                  return (
                    <div
                      key={item.category}
                      onClick={() => setDrillCategory(item)}
                      className="group rounded-xl border bg-background/40 p-3.5 hover:border-primary/50 hover:bg-accent/30 transition-all cursor-pointer"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white"
                            style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                          >
                            {idx + 1}
                          </span>
                          <span className="font-semibold text-sm">{catName}</span>
                          <span className="text-[11px] text-muted-foreground">
                            ({merchantCount} 家商户)
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-sm">{formatCurrency(item.amount)}</span>
                          <Badge variant="secondary" className="font-mono">
                            {itemPct}%
                          </Badge>
                          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                        </div>
                      </div>
                      <div className="mt-2 h-2 w-full rounded-full bg-secondary overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${Math.min(100, itemPct)}%`,
                            backgroundColor: CHART_COLORS[idx % CHART_COLORS.length],
                          }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          {/* 右侧：每日支出分布 */}
          <Card className="lg:col-span-6">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>📅 每日支出统计</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    日均支出: {formatCurrency(burn?.daily_run_rate ?? 0)}/天 · 单日最高:{" "}
                    {burn?.peak_day?.date || "—"} ({formatCurrency(burn?.peak_day?.amount ?? 0)})
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="max-h-[430px] overflow-y-auto pr-2 space-y-1.5">
                {dailyDays.map((dayVal, idx) => {
                  const amt = dailyAmts[idx] || 0;
                  const pct = maxDailyAmt > 0 ? Math.max(amt > 0 ? 3 : 0, (amt / maxDailyAmt) * 100) : 0;
                  const cleanDay = String(dayVal).replace("日", "").padStart(2, "0");
                  const dateLabel = `${activeMonth}-${cleanDay}`;
                  const isPeak = burn?.peak_day?.date === dateLabel && amt > 0;

                  return (
                    <div
                      key={String(dayVal)}
                      className="grid grid-cols-12 items-center gap-2 text-xs py-1 px-2 rounded-md hover:bg-accent/30"
                    >
                      <div className="col-span-2 font-mono text-muted-foreground">{dateLabel.slice(5)}</div>
                      <div className="col-span-7 h-3 rounded-full bg-secondary/70 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            isPeak ? "bg-rose-500" : amt > 0 ? "bg-primary" : "bg-transparent"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="col-span-3 text-right font-mono font-semibold flex items-center justify-end gap-1">
                        {isPeak && <Flame className="h-3 w-3 text-rose-400 shrink-0" />}
                        <span className={amt > 0 ? "text-foreground" : "text-muted-foreground/50"}>
                          {formatCurrency(amt)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 子视图 2：按商户查看支出 (Merchant Ranking) */}
      {subTab === "merchants" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>🏪 商户消费排行 ({activeMonth})</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              点击任意商户可查看该商户当月的账单明细
            </p>
          </CardHeader>
          <CardContent>
            {merchantRanking.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted-foreground">当月暂无商户消费记录</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b bg-muted/20 text-muted-foreground">
                      <th className="py-2.5 px-3">排名</th>
                      <th className="py-2.5 px-3">商户名称</th>
                      <th className="py-2.5 px-3">关联分类</th>
                      <th className="py-2.5 px-3 text-center">消费次数</th>
                      <th className="py-2.5 px-3 text-right">单笔均价</th>
                      <th className="py-2.5 px-3 text-right">支出总额</th>
                      <th className="py-2.5 px-3 w-44">占总支出比</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {merchantRanking.map((m, idx) => {
                      const mPct = m.percentage ?? m.ratio ?? 0;
                      return (
                        <tr
                          key={m.payee}
                          onClick={() => setDrillMerchant(m)}
                          className="hover:bg-accent/40 cursor-pointer transition-colors"
                        >
                          <td className="py-3 px-3 font-mono font-bold text-muted-foreground">#{idx + 1}</td>
                          <td className="py-3 px-3 font-semibold text-sm">{m.payee}</td>
                          <td className="py-3 px-3">
                            <div className="flex flex-wrap gap-1">
                              {(m.categories || []).map((c) => (
                                <Badge key={c} variant="secondary">
                                  {nameMap[c] || c}
                                </Badge>
                              ))}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-center font-mono">{m.count} 次</td>
                          <td className="py-3 px-3 text-right font-mono text-muted-foreground">
                            {formatCurrency(m.avg_amount)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-rose-400 text-sm">
                            {formatCurrency(m.amount)}
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-2">
                              <div className="h-2 flex-1 rounded-full bg-secondary overflow-hidden">
                                <div
                                  className="h-full bg-primary rounded-full"
                                  style={{ width: `${Math.min(100, mPct)}%` }}
                                />
                              </div>
                              <span className="font-mono text-[11px] w-11 text-right">{mPct}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 子视图 3：按月/日绘制的各资产变化折线图 */}
      {subTab === "assets" && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle>📈 账户与资产余额走势</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                支持按月（过去 12 个月）或按日（{activeMonth}）查看各资金账户余额变化
              </p>
            </div>
            <div className="inline-flex rounded-lg border bg-muted p-1 gap-1">
              <button
                onClick={() => setAssetGranularity("monthly")}
                className={`rounded-md px-3 py-1 text-xs font-medium ${
                  assetGranularity === "monthly" ? "bg-background shadow-sm" : "text-muted-foreground"
                }`}
              >
                按月走势 (12个月)
              </button>
              <button
                onClick={() => setAssetGranularity("daily")}
                className={`rounded-md px-3 py-1 text-xs font-medium ${
                  assetGranularity === "daily" ? "bg-background shadow-sm" : "text-muted-foreground"
                }`}
              >
                按日走势 ({activeMonth})
              </button>
            </div>
          </CardHeader>
          <CardContent>{renderMultiLineSvg()}</CardContent>
        </Card>
      )}

      {/* 底部：支出结构与 AI 月度分析 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <Card className="lg:col-span-5">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-400" /> 备用金与支出结构
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-xs">
            <div className="rounded-xl border bg-emerald-500/5 border-emerald-500/20 p-3.5 flex items-center justify-between">
              <div>
                <div className="text-muted-foreground">应急可用月数 (按当前开销估算)</div>
                <div className="text-xl font-bold text-emerald-400 font-mono mt-1">
                  {runway?.runway_months ?? 0} 个月
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  流动资金 {formatCurrency(runway?.liquid_assets ?? 0)} · 状态: {runway?.health_status || "良好"}
                </div>
              </div>
              <Badge variant="success">{runway?.health_status || "稳健"}</Badge>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <span>日常必要支出 (餐饮/居住/交通/医疗)</span>
                <span className="font-mono font-semibold">
                  {formatCurrency(nws?.needs_amount ?? 0)} ({nws?.needs_ratio ?? 0}%)
                </span>
              </div>
              <div className="flex justify-between">
                <span>休闲与弹性支出 (购物/娱乐/零食)</span>
                <span className="font-mono font-semibold">
                  {formatCurrency(nws?.wants_amount ?? 0)} ({nws?.wants_ratio ?? 0}%)
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-7">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> AI 月度账单分析
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                根据当月收支汇总生成消费分析与储蓄建议
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={handleLoadAIInsights} disabled={aiLoading}>
              <Sparkles className="h-3.5 w-3.5" />
              {aiLoading ? "正在分析..." : "生成月度分析"}
            </Button>
          </CardHeader>
          <CardContent className="text-xs">
            {!aiInsights ? (
              <div className="py-6 text-center text-muted-foreground border rounded-xl border-dashed">
                点击右上角「生成月度分析」查看 {activeMonth} 的收支评估与建议
              </div>
            ) : (
              <div className="space-y-2.5 rounded-xl border bg-muted/30 p-4">
                <div>
                  <span className="font-semibold text-primary">总评：</span>
                  <span>{aiInsights.overview}</span>
                </div>
                <div>
                  <span className="font-semibold text-primary">支出结构：</span>
                  <span>{aiInsights.spending_assessment}</span>
                </div>
                <div>
                  <span className="font-semibold text-primary">备用金评估：</span>
                  <span>{aiInsights.runway_evaluation}</span>
                </div>
                {Array.isArray(aiInsights.recommendations) && aiInsights.recommendations.length > 0 && (
                  <ul className="list-disc pl-5 space-y-1 text-muted-foreground pt-1">
                    {aiInsights.recommendations.map((r: string, i: number) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 分类下钻商户抽屉 */}
      <SheetDrawer
        open={Boolean(drillCategory)}
        onClose={() => setDrillCategory(null)}
        title={drillCategory ? `分类明细：${nameMap[drillCategory.category] || drillCategory.category}` : ""}
        subtitle={
          drillCategory
            ? `${activeMonth} 共支出 ${formatCurrency(drillCategory.amount)} (占当月总支出 ${drillCategory.percentage ?? drillCategory.ratio ?? 0}%)`
            : ""
        }
      >
        {drillCategory && (
          <div className="space-y-4 text-xs">
            <div className="font-semibold text-muted-foreground">该分类下的商户排名与消费次数</div>
            <div className="space-y-2">
              {(drillCategory.merchants || []).map((m, idx) => {
                const subPct = m.percentage ?? m.ratio ?? 0;
                return (
                  <div key={m.payee} className="rounded-lg border p-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">#{idx + 1}</Badge>
                        <span className="font-semibold text-sm">{m.payee}</span>
                        <span className="text-muted-foreground">({m.count} 次)</span>
                      </div>
                      <div className="font-mono font-bold">{formatCurrency(m.amount)}</div>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${Math.min(100, subPct)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </SheetDrawer>

      {/* 商户流水明细下钻抽屉 */}
      <SheetDrawer
        open={Boolean(drillMerchant)}
        onClose={() => setDrillMerchant(null)}
        title={drillMerchant ? `商户明细：${drillMerchant.payee}` : ""}
        subtitle={
          drillMerchant
            ? `${activeMonth} 共消费 ${drillMerchant.count} 次 · 累计 ${formatCurrency(drillMerchant.amount)}`
            : ""
        }
      >
        {drillMerchant && (
          <div className="space-y-2.5 text-xs">
            {transactions
              .filter(
                (t) =>
                  t.date.startsWith(activeMonth) &&
                  (t.payee || "未命名商户") === drillMerchant.payee
              )
              .map((tx) => (
                <div key={tx.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <div className="font-medium">{tx.narration || tx.payee}</div>
                    <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                      {tx.date} · {nameMap[tx.category] || tx.category}
                    </div>
                  </div>
                  <div className="font-mono font-bold">
                    {tx.is_offset ? `-${formatCurrency(tx.amount)} (退款)` : formatCurrency(tx.amount)}
                  </div>
                </div>
              ))}
          </div>
        )}
      </SheetDrawer>
    </div>
  );
};
