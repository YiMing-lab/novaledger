import React, { useCallback, useEffect, useState } from "react";
import {
  AccountItem,
  CategoryItem,
  DebtItem,
  FinancialReport,
  HistoricalTrends,
  PendingItem,
  TransactionItem,
} from "./api/types";
import { api } from "./api/client";
import { Badge, Button, ToastProvider, useToast } from "./components/ui/primitives";
import { getCurrentMonthStr } from "./lib/utils";
import { TransactionsView } from "./views/TransactionsView";
import { AccountsView } from "./views/AccountsView";
import { AnalyticsView } from "./views/AnalyticsView";
import { SettingsView } from "./views/SettingsView";
import { RecordModal } from "./components/modals/RecordModal";
import { CommandPalette } from "./components/modals/CommandPalette";
import {
  Receipt,
  Wallet,
  PieChart,
  Settings,
  Plus,
  Search,
  Upload,
  RefreshCw,
  Sun,
  Moon,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
} from "lucide-react";

type ViewType = "transactions" | "accounts" | "analytics" | "settings";

const NovaLedgerShell: React.FC = () => {
  const toast = useToast();

  // Navigation & Theme
  const [activeView, setActiveView] = useState<ViewType>("transactions");
  const [settingsSubTab, setSettingsSubTab] = useState<string>("pending");
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return localStorage.getItem("novaledger_theme") === "dark";
  });

  // Global Data State
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonthStr());
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [debts, setDebts] = useState<DebtItem[]>([]);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [report, setReport] = useState<FinancialReport | null>(null);
  const [trends, setTrends] = useState<HistoricalTrends | null>(null);
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [ledgerValid, setLedgerValid] = useState<boolean>(true);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncingMail, setSyncingMail] = useState<boolean>(false);

  // Modals State
  const [recordOpen, setRecordOpen] = useState<boolean>(false);
  const [editingTx, setEditingTx] = useState<TransactionItem | null>(null);
  const [presetDebtAccount, setPresetDebtAccount] = useState<string | null>(null);
  const [cmdOpen, setCmdOpen] = useState<boolean>(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("novaledger_theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  const loadAllData = useCallback(async (monthOverride?: string) => {
    const targetMonth = monthOverride ?? selectedMonth;
    try {
      const statusRes = await api.getStatus().catch(() => ({
        ledger_valid: true,
        validation_errors: [] as string[],
        errors: [] as string[],
      }));

      const [
        accList,
        catList,
        debtList,
        txList,
        repRes,
        trendRes,
        pendList,
      ] = await Promise.all([
        api.getAccounts(true).catch(() => [] as AccountItem[]),
        api.getCategories(true).catch(() => [] as CategoryItem[]),
        api.getDebts().catch(() => [] as DebtItem[]),
        api.getTransactions().catch(() => [] as TransactionItem[]),
        api.getReports(targetMonth).catch(() => null),
        api.getTrends(12).catch(() => null),
        api.getPending().catch(() => [] as PendingItem[]),
      ]);

      setAccounts(Array.isArray(accList) ? accList : []);
      setCategories(Array.isArray(catList) ? catList : []);
      setDebts(Array.isArray(debtList) ? debtList : []);
      setTransactions(Array.isArray(txList) ? txList : []);
      if (repRes) setReport(repRes);
      if (trendRes) setTrends(trendRes);
      setPendingItems(Array.isArray(pendList) ? pendList : []);
      setLedgerValid(statusRes.ledger_valid !== false);
      const errs = statusRes.validation_errors || statusRes.errors || [];
      setValidationErrors(Array.isArray(errs) ? errs : []);
    } catch (err: any) {
      toast.error(err.message || "加载账本数据失败");
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, toast]);

  useEffect(() => {
    loadAllData(selectedMonth);
  }, [selectedMonth]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((prev) => !prev);
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isInput = tag === "input" || tag === "textarea" || tag === "select" || (e.target as HTMLElement)?.isContentEditable;
      if (!isInput && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setEditingTx(null);
        setPresetDebtAccount(null);
        setRecordOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleOpenRecord = (tx?: TransactionItem | null) => {
    setEditingTx(tx || null);
    setPresetDebtAccount(null);
    setRecordOpen(true);
  };

  const handleOpenDebtRepayment = (debtAccount: string) => {
    setEditingTx(null);
    setPresetDebtAccount(debtAccount);
    setRecordOpen(true);
  };

  const handleNavigate = (view: ViewType, subTab?: string) => {
    setActiveView(view);
    if (subTab) {
      setSettingsSubTab(subTab);
    }
  };

  const handleTriggerMailSync = async () => {
    setSyncingMail(true);
    try {
      const res = await api.triggerMailSync();
      const count = res.synced_count ?? res.imported ?? 0;
      toast.success(
        res.message || `邮件同步完成：新增 ${count} 笔待确认流水`
      );
      await loadAllData();
      if (count > 0) {
        setActiveView("settings");
        setSettingsSubTab("pending");
      }
    } catch (err: any) {
      toast.error(err.message || "邮件同步失败，请检查 IMAP 邮箱配置");
    } finally {
      setSyncingMail(false);
    }
  };

  const viewMeta: Record<ViewType, { title: string; subtitle: string }> = {
    transactions: {
      title: "账单明细",
      subtitle: "查看、筛选与编辑日常收支及转账记录",
    },
    accounts: {
      title: "账户与负债",
      subtitle: "管理储蓄卡、信用卡、电子钱包与贷款待还进度",
    },
    analytics: {
      title: "统计分析",
      subtitle: "按分类、按日、按商户统计支出与资产变化趋势",
    },
    settings: {
      title: "设置与工具",
      subtitle: "待确认账目、账单导入、邮箱同步、分类管理与数据备份",
    },
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground select-none">
      {/* Left Navigation Sidebar */}
      <aside className="w-60 shrink-0 border-r bg-card/75 backdrop-blur flex flex-col justify-between">
        <div className="p-4 space-y-5">
          {/* Brand Header */}
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-700 flex items-center justify-center text-white shadow-sm ring-1 ring-white/15">
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5 fill-current"
                  aria-hidden="true"
                >
                  <path d="M12 2.2C12.7 8.4 15.6 11.3 21.8 12C15.6 12.7 12.7 15.6 12 21.8C11.3 15.6 8.4 12.7 2.2 12C8.4 11.3 11.3 8.4 12 2.2Z" />
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold tracking-tight text-base">NovaLedger</span>
                  <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4">
                    v2.0
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">个人记账与资产管理</p>
              </div>
            </div>
          </div>

          {/* Primary Action Button */}
          <Button
            className="w-full justify-between shadow-sm font-medium"
            onClick={() => handleOpenRecord(null)}
          >
            <span className="flex items-center gap-2">
              <Plus className="h-4 w-4" /> 记一笔
            </span>
            <kbd className="text-[10px] bg-primary-foreground/20 px-1.5 py-0.5 rounded font-mono">
              N
            </kbd>
          </Button>

          {/* Navigation Menu */}
          <nav className="space-y-1">
            <button
              onClick={() => setActiveView("transactions")}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                activeView === "transactions"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Receipt className="h-4 w-4" />
                账单明细
              </span>
            </button>

            <button
              onClick={() => setActiveView("accounts")}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                activeView === "accounts"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Wallet className="h-4 w-4" />
                账户与负债
              </span>
              <span className="text-xs text-muted-foreground font-mono">
                {accounts.length}
              </span>
            </button>

            <button
              onClick={() => setActiveView("analytics")}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                activeView === "analytics"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <PieChart className="h-4 w-4" />
                统计分析
              </span>
            </button>

            <button
              onClick={() => setActiveView("settings")}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                activeView === "settings"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Settings className="h-4 w-4" />
                设置与工具
              </span>
              {pendingItems.length > 0 && (
                <Badge variant="warning" className="px-1.5 py-0 text-[11px]">
                  {pendingItems.length}
                </Badge>
              )}
            </button>
          </nav>
        </div>

        {/* Bottom Status & Theme Switcher */}
        <div className="p-4 border-t space-y-3">
          <div
            onClick={() => handleNavigate("settings", "backup")}
            className="flex items-center justify-between px-2.5 py-2 rounded-lg bg-muted/50 hover:bg-muted cursor-pointer transition-colors text-xs"
            title="点击查看账本导出与备份"
          >
            <span className="flex items-center gap-2 font-medium">
              {ledgerValid ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  <span>账本状态正常</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  <span className="text-amber-600 dark:text-amber-400">
                    发现 {validationErrors.length} 处告警
                  </span>
                </>
              )}
            </span>
            <span className="text-[10px] text-muted-foreground font-mono">.bean</span>
          </div>

          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-muted-foreground">界面主题</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1.5"
              onClick={() => setDarkMode((d) => !d)}
            >
              {darkMode ? (
                <>
                  <Sun className="h-3.5 w-3.5 text-amber-400" /> 浅色
                </>
              ) : (
                <>
                  <Moon className="h-3.5 w-3.5 text-slate-600" /> 深色
                </>
              )}
            </Button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header Bar */}
        <header className="h-14 shrink-0 border-b bg-card/50 backdrop-blur px-6 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-base font-bold tracking-tight truncate">
              {viewMeta[activeView].title}
            </h1>
            <p className="text-xs text-muted-foreground truncate hidden sm:block">
              {viewMeta[activeView].subtitle}
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {/* Command Palette Trigger */}
            <button
              onClick={() => setCmdOpen(true)}
              className="flex items-center gap-3 px-3 py-1.5 rounded-lg border bg-background/80 hover:bg-muted/60 text-xs text-muted-foreground transition-colors"
            >
              <Search className="h-3.5 w-3.5" />
              <span>搜索账单、跳转页面...</span>
              <kbd className="px-1.5 py-0.5 text-[10px] bg-muted rounded border font-mono">
                Ctrl+K
              </kbd>
            </button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => handleNavigate("settings", "import")}
            >
              <Upload className="h-3.5 w-3.5 mr-1.5" /> 导入账单
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleTriggerMailSync}
              disabled={syncingMail}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 mr-1.5 ${syncingMail ? "animate-spin" : ""}`}
              />
              {syncingMail ? "同步中..." : "同步邮件"}
            </Button>
          </div>
        </header>

        {/* Scrollable View Body */}
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-7xl mx-auto">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
                <Sparkles className="h-6 w-6 animate-pulse text-primary" />
                <p className="text-sm">正在加载账本数据...</p>
              </div>
            ) : (
              <>
                {activeView === "transactions" && (
                  <TransactionsView
                    transactions={transactions}
                    accounts={accounts}
                    categories={categories}
                    debts={debts}
                    report={report}
                    selectedMonth={selectedMonth}
                    onMonthChange={setSelectedMonth}
                    onOpenRecord={handleOpenRecord}
                    onRefresh={() => loadAllData()}
                  />
                )}

                {activeView === "accounts" && (
                  <AccountsView
                    accounts={accounts}
                    debts={debts}
                    report={report}
                    onRefresh={() => loadAllData()}
                    onOpenDebtRepayment={handleOpenDebtRepayment}
                  />
                )}

                {activeView === "analytics" && (
                  <AnalyticsView
                    report={report}
                    trends={trends}
                    accounts={accounts}
                    categories={categories}
                    transactions={transactions}
                    selectedMonth={selectedMonth}
                    onMonthChange={setSelectedMonth}
                  />
                )}

                {activeView === "settings" && (
                  <SettingsView
                    activeSubTab={settingsSubTab}
                    onSubTabChange={setSettingsSubTab}
                    accounts={accounts}
                    categories={categories}
                    debts={debts}
                    pendingItems={pendingItems}
                    ledgerValid={ledgerValid}
                    validationErrors={validationErrors}
                    onRefresh={() => loadAllData()}
                    onTriggerMailSync={handleTriggerMailSync}
                  />
                )}
              </>
            )}
          </div>
        </main>
      </div>

      {/* Global Quick Record / Edit Modal */}
      <RecordModal
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        onSaved={() => loadAllData()}
        accounts={accounts}
        categories={categories}
        debts={debts}
        transactions={transactions}
        editingTx={editingTx}
        presetDebtAccount={presetDebtAccount}
      />

      {/* Global Command Palette (Ctrl+K) */}
      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        transactions={transactions}
        onNavigate={handleNavigate}
        onOpenRecord={() => handleOpenRecord(null)}
        onTriggerMailSync={handleTriggerMailSync}
        onSelectTx={(tx) => handleOpenRecord(tx)}
      />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ToastProvider>
      <NovaLedgerShell />
    </ToastProvider>
  );
};

export default App;
