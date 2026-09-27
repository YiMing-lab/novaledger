import React, { useState, useEffect } from "react";
import { AccountItem, DebtItem, FinancialReport } from "../api/types";
import { api } from "../api/client";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DialogModal,
  Input,
  Label,
  Select,
  useToast,
} from "../components/ui/primitives";
import { formatCurrency } from "../lib/utils";
import {
  Plus,
  Edit3,
  Trash2,
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  CreditCard,
  Landmark,
  Wallet,
  Banknote,
} from "lucide-react";

interface AccountsViewProps {
  accounts: AccountItem[];
  debts: DebtItem[];
  report: FinancialReport | null;
  onRefresh: () => void;
  onOpenDebtRepayment: (debtAccount: string) => void;
}

export const AccountsView: React.FC<AccountsViewProps> = ({
  accounts,
  debts,
  report,
  onRefresh,
  onOpenDebtRepayment,
}) => {
  const toast = useToast();
  const balances = report?.balance_sheet?.account_balances || {};

  // Dropdown Menu & Archived Collapsible State
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [showArchivedAccounts, setShowArchivedAccounts] = useState(false);
  const [showArchivedDebts, setShowArchivedDebts] = useState(false);

  useEffect(() => {
    const closeMenu = () => setOpenMenuId(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  // Account Modal State
  const [accModalOpen, setAccModalOpen] = useState(false);
  const [editingAcc, setEditingAcc] = useState<AccountItem | null>(null);
  const [accName, setAccName] = useState("");
  const [accType, setAccType] = useState("debit");
  const [accCode, setAccCode] = useState("");
  const [accCardTail, setAccCardTail] = useState("");
  const [accInitBal, setAccInitBal] = useState("0");
  const [accArchived, setAccArchived] = useState(false);

  // Debt Modal State
  const [debtModalOpen, setDebtModalOpen] = useState(false);
  const [editingDebt, setEditingDebt] = useState<DebtItem | null>(null);
  const [debtName, setDebtName] = useState("");
  const [debtType, setDebtType] = useState("mortgage");
  const [debtInitAmt, setDebtInitAmt] = useState("");
  const [debtMonthlyPay, setDebtMonthlyPay] = useState("");
  const [debtDueDate, setDebtDueDate] = useState("每月 15 日");
  const [debtPeriods, setDebtPeriods] = useState("12");
  const [debtDepositAcc, setDebtDepositAcc] = useState("Equity:Opening-Balances");
  const [debtNote, setDebtNote] = useState("");
  const [debtArchived, setDebtArchived] = useState(false);

  const openCreateAccount = () => {
    setEditingAcc(null);
    setAccName("");
    setAccType("debit");
    setAccCode("Assets:Bank:CMB:Card001");
    setAccCardTail("");
    setAccInitBal("0");
    setAccArchived(false);
    setAccModalOpen(true);
  };

  const openEditAccount = (acc: AccountItem) => {
    setEditingAcc(acc);
    setAccName(acc.name);
    setAccType(acc.type || "debit");
    setAccCode(acc.account);
    setAccCardTail(acc.card_tail || "");
    setAccInitBal("0");
    setAccArchived(Boolean(acc.is_archived));
    setAccModalOpen(true);
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accName.trim()) {
      toast.error("请输入账户名称");
      return;
    }
    try {
      if (editingAcc) {
        await api.updateAccount(editingAcc.id, {
          name: accName.trim(),
          card_tail: accCardTail.trim(),
          is_archived: accArchived,
        });
        toast.success("账户信息已更新！");
      } else {
        await api.createAccount({
          name: accName.trim(),
          type: accType,
          account: accCode.trim(),
          card_tail: accCardTail.trim(),
          initial_balance: parseFloat(accInitBal || "0"),
        });
        toast.success("新资金账户已创建！");
      }
      setAccModalOpen(false);
      onRefresh();
    } catch (err: any) {
      toast.error(`保存账户失败: ${err.message}`);
    }
  };

  const handleToggleArchiveAccount = async (acc: AccountItem) => {
    const nextArchived = !acc.is_archived;
    try {
      await api.updateAccount(acc.id, { is_archived: nextArchived });
      toast.success(nextArchived ? `账户「${acc.name}」已归档` : `账户「${acc.name}」已恢复启用`);
      if (nextArchived) setShowArchivedAccounts(true);
      onRefresh();
    } catch (err: any) {
      toast.error(`操作失败: ${err.message}`);
    }
  };

  const handleDeleteAccount = async (acc: AccountItem) => {
    if (!window.confirm(`确定要删除账户「${acc.name}」吗？\n（若仅用于隐藏停用卡片，建议选择“归档”）`)) return;
    try {
      const res = await api.deleteAccount(acc.id);
      toast.success(res.message || `已删除账户「${acc.name}」`);
      setAccModalOpen(false);
      onRefresh();
    } catch (err: any) {
      toast.error(`删除失败: ${err.message}`);
    }
  };

  const openCreateDebt = () => {
    setEditingDebt(null);
    setDebtName("");
    setDebtType("mortgage");
    setDebtInitAmt("");
    setDebtMonthlyPay("");
    setDebtDueDate("每月 15 日");
    setDebtPeriods("12");
    setDebtDepositAcc("Equity:Opening-Balances");
    setDebtNote("");
    setDebtArchived(false);
    setDebtModalOpen(true);
  };

  const openEditDebt = (d: DebtItem) => {
    setEditingDebt(d);
    setDebtName(d.name);
    setDebtType(d.type || "personal");
    setDebtInitAmt(String(d.initial_amount || d.current_balance || 0));
    setDebtMonthlyPay(String(d.monthly_payment || 0));
    setDebtDueDate(d.due_date || "每月 15 日");
    setDebtPeriods(String(d.total_periods || 12));
    setDebtNote(d.note || "");
    setDebtArchived(Boolean(d.is_archived));
    setDebtModalOpen(true);
  };

  const handleSaveDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    const initAmt = parseFloat(debtInitAmt || "0");
    if (!debtName.trim() || isNaN(initAmt) || initAmt <= 0) {
      toast.error("请填写债务名称与大于 0 的借款本金总额");
      return;
    }
    try {
      if (editingDebt) {
        await api.updateDebt(editingDebt.id, {
          name: debtName.trim(),
          type: debtType,
          initial_amount: initAmt,
          monthly_payment: parseFloat(debtMonthlyPay || "0"),
          due_date: debtDueDate.trim(),
          total_periods: parseInt(debtPeriods || "12", 10),
          note: debtNote.trim(),
          is_archived: debtArchived,
        });
        toast.success("债务信息已成功更新！");
      } else {
        await api.createDebt({
          name: debtName.trim(),
          type: debtType,
          initial_amount: initAmt,
          monthly_payment: parseFloat(debtMonthlyPay || "0"),
          due_date: debtDueDate.trim(),
          total_periods: parseInt(debtPeriods || "12", 10),
          deposit_account: debtDepositAcc,
          note: debtNote.trim(),
        });
        toast.success("新债务已成功创建！");
      }
      setDebtModalOpen(false);
      onRefresh();
    } catch (err: any) {
      toast.error(`保存债务失败: ${err.message}`);
    }
  };

  const handleToggleArchiveDebt = async (d: DebtItem) => {
    const nextArchived = !d.is_archived;
    try {
      await api.updateDebt(d.id, { is_archived: nextArchived });
      toast.success(nextArchived ? `债务「${d.name}」已归档` : `债务「${d.name}」已恢复启用`);
      if (nextArchived) setShowArchivedDebts(true);
      onRefresh();
    } catch (err: any) {
      toast.error(`操作失败: ${err.message}`);
    }
  };

  const handleDeleteDebt = async (d: DebtItem) => {
    if (!window.confirm(`确定要删除债务「${d.name}」吗？\n（若已结清希望保留记录，建议选择“归档”）`)) return;
    try {
      const res = await api.deleteDebt(d.id);
      toast.success(res.message || "债务已删除");
      setDebtModalOpen(false);
      onRefresh();
    } catch (err: any) {
      toast.error(`删除失败: ${err.message}`);
    }
  };

  const activeAccounts = accounts.filter((a) => !a.is_archived);
  const archivedAccounts = accounts.filter((a) => a.is_archived);
  const activeDebts = debts.filter((d) => !d.is_archived);
  const archivedDebts = debts.filter((d) => d.is_archived);

  const totalDebtBalance = activeDebts.reduce((s, d) => s + Number(d.current_balance || 0), 0);
  const totalDebtInitial = activeDebts.reduce(
    (s, d) => s + Math.max(Number(d.initial_amount || 0), Number(d.current_balance || 0)),
    0
  );
  const totalDebtRepaid = Math.max(0, totalDebtInitial - totalDebtBalance);
  const overallDebtProgress =
    totalDebtInitial > 0 ? Math.min(100, Math.round((totalDebtRepaid / totalDebtInitial) * 100)) : 0;

  // 实时汇总各资金账户与信用卡余额 (优先使用账户实时 current_balance)
  const realtimeTotalAssets = activeAccounts
    .filter((a) => a.account.startsWith("Assets:"))
    .reduce((s, a) => s + Number(a.current_balance ?? a.balance ?? balances[a.account] ?? 0), 0);

  const realtimeCreditLiabilities = activeAccounts
    .filter((a) => a.type === "credit" || a.account.startsWith("Liabilities:CreditCard:"))
    .reduce((s, a) => {
      const b = Number(a.current_balance ?? a.balance ?? balances[a.account] ?? 0);
      return s + (b < 0 ? -b : 0);
    }, 0);

  const displayTotalAssets =
    activeAccounts.length > 0 ? realtimeTotalAssets : (report?.balance_sheet?.total_assets ?? 0);
  const displayCreditLiabilities =
    activeAccounts.length > 0
      ? realtimeCreditLiabilities
      : (report?.balance_sheet?.credit_card_liabilities ?? 0);
  const displayNetWorth =
    activeAccounts.length > 0 || activeDebts.length > 0
      ? displayTotalAssets - displayCreditLiabilities - totalDebtBalance
      : (report?.balance_sheet?.net_worth ?? 0);

  const debtTypeLabel: Record<string, string> = {
    mortgage: "🏠 房贷/按揭",
    car: "🚗 车贷",
    consumer: "💳 消费贷/白条",
    personal: "🤝 亲友拆借/个人贷款",
  };

  return (
    <div className="space-y-6">
      {/* 顶部资产负债总览 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 pt-4">
            <div className="text-xs text-muted-foreground">总资产</div>
            <div className="mt-1.5 text-2xl font-bold text-emerald-400 font-mono">
              {formatCurrency(displayTotalAssets)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 pt-4">
            <div className="text-xs text-muted-foreground">信用卡待还</div>
            <div className="mt-1.5 text-2xl font-bold text-amber-400 font-mono">
              {formatCurrency(displayCreditLiabilities)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 pt-4">
            <div className="text-xs text-muted-foreground">贷款与债务待还 ({activeDebts.length} 笔)</div>
            <div className="mt-1.5 text-2xl font-bold text-rose-400 font-mono">
              {formatCurrency(totalDebtBalance)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 pt-4">
            <div className="text-xs text-muted-foreground">净资产 (资产 - 负债)</div>
            <div className="mt-1.5 text-2xl font-bold text-primary font-mono">
              {formatCurrency(displayNetWorth)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 1. 资金与信用卡账户看板 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-primary" /> 资金与信用卡账户 ({activeAccounts.length})
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              填写银行卡 4 位尾号后，邮件同步的账单可自动匹配到对应银行卡
            </p>
          </div>
          <Button size="sm" onClick={openCreateAccount}>
            <Plus className="h-4 w-4" /> 新增账户
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {activeAccounts.map((acc) => {
              const bal = Number(acc.current_balance ?? acc.balance ?? balances[acc.account] ?? 0);
              const isCredit = acc.type === "credit" || acc.account.startsWith("Liabilities:CreditCard:");
              const menuKey = `acc_${acc.id}`;
              return (
                <div
                  key={acc.id}
                  className="relative flex flex-col justify-between rounded-xl border bg-background/50 p-4 hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="rounded-lg bg-primary/10 p-2 text-primary">
                        {isCredit ? (
                          <CreditCard className="h-4 w-4" />
                        ) : acc.type === "cash" ? (
                          <Banknote className="h-4 w-4" />
                        ) : (
                          <Landmark className="h-4 w-4" />
                        )}
                      </div>
                      <div>
                        <div className="font-semibold text-sm flex items-center gap-2">
                          <span>{acc.name}</span>
                          {acc.card_tail && (
                            <Badge variant="outline" className="font-mono text-[10px]">
                              尾号 {acc.card_tail}
                            </Badge>
                          )}
                        </div>
                        <div className="text-[11px] font-mono text-muted-foreground mt-0.5">
                          {acc.account}
                        </div>
                      </div>
                    </div>

                    {/* 右上角操作下拉菜单 */}
                    <div className="relative" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setOpenMenuId(openMenuId === menuKey ? null : menuKey)}
                        title="操作选项"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                      {openMenuId === menuKey && (
                        <div className="absolute right-0 top-7 z-30 w-32 rounded-lg border bg-card p-1 shadow-xl text-xs">
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              openEditAccount(acc);
                            }}
                            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-accent transition-colors"
                          >
                            <Edit3 className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>编辑账户</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              handleToggleArchiveAccount(acc);
                            }}
                            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-accent transition-colors"
                          >
                            <Archive className="h-3.5 w-3.5 text-amber-400" />
                            <span>归档账户</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              handleDeleteAccount(acc);
                            }}
                            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-rose-400 hover:bg-rose-500/10 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>删除账户</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex items-baseline justify-between border-t pt-3">
                    <span className="text-xs text-muted-foreground">
                      {isCredit ? "当前账单余额" : "账户可用余额"}
                    </span>
                    <span
                      className={`text-lg font-bold font-mono ${
                        bal < 0 ? "text-rose-400" : "text-emerald-400"
                      }`}
                    >
                      {formatCurrency(bal)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 已归档资金账户下拉折叠区 */}
          {archivedAccounts.length > 0 && (
            <div className="rounded-xl border bg-muted/20 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowArchivedAccounts((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Archive className="h-3.5 w-3.5" />
                  已归档账户 ({archivedAccounts.length})
                </span>
                <span className="flex items-center gap-1">
                  {showArchivedAccounts ? "收起" : "展开查看"}
                  {showArchivedAccounts ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </span>
              </button>
              {showArchivedAccounts && (
                <div className="divide-y border-t px-4 py-2">
                  {archivedAccounts.map((acc) => {
                    const bal = Number(acc.current_balance ?? acc.balance ?? balances[acc.account] ?? 0);
                    return (
                      <div
                        key={acc.id}
                        className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">已归档</Badge>
                          <span className="font-semibold">{acc.name}</span>
                          {acc.card_tail && (
                            <span className="text-muted-foreground font-mono">(尾号{acc.card_tail})</span>
                          )}
                          <span className="text-muted-foreground font-mono">{acc.account}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-muted-foreground">
                            余额 {formatCurrency(bal)}
                          </span>
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => handleToggleArchiveAccount(acc)}
                          >
                            <ArchiveRestore className="h-3.5 w-3.5" /> 恢复启用
                          </Button>
                          <Button
                            variant="ghost"
                            size="xs"
                            className="text-rose-400"
                            onClick={() => handleDeleteAccount(acc)}
                          >
                            <Trash2 className="h-3.5 w-3.5" /> 删除
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2. 个人债务与贷款管理面板 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              📋 个人债务与贷款明细 ({activeDebts.length} 笔)
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              总体偿还进度: 已还 {formatCurrency(totalDebtRepaid)} / 初始总本金{" "}
              {formatCurrency(totalDebtInitial)} ({overallDebtProgress}%)
            </p>
          </div>
          <Button size="sm" onClick={openCreateDebt}>
            <Plus className="h-4 w-4" /> 新增债务
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {activeDebts.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground border rounded-xl border-dashed">
              🎉 当前无未结清的个人债务记录
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4" id="debtsGrid">
              {activeDebts.map((d) => {
                const initVal = Math.max(Number(d.initial_amount || 0), Number(d.current_balance || 0));
                const curBal = Number(d.current_balance || 0);
                const repaidVal = Math.max(0, initVal - curBal);
                const pct = initVal > 0 ? Math.min(100, Math.round((repaidVal / initVal) * 100)) : 0;
                const menuKey = `debt_${d.id}`;

                return (
                  <div
                    key={d.id}
                    className="relative rounded-xl border bg-background/50 p-4 space-y-3.5 hover:border-primary/40 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm">{d.name}</span>
                          <Badge variant="secondary">
                            {debtTypeLabel[d.type] || d.type || "个人债务"}
                          </Badge>
                        </div>
                        <div className="text-[11px] font-mono text-muted-foreground mt-0.5">
                          {d.account}
                        </div>
                      </div>

                      {/* 右上角操作下拉菜单 */}
                      <div className="relative" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => setOpenMenuId(openMenuId === menuKey ? null : menuKey)}
                          title="操作选项"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                        {openMenuId === menuKey && (
                          <div className="absolute right-0 top-7 z-30 w-32 rounded-lg border bg-card p-1 shadow-xl text-xs">
                            <button
                              type="button"
                              onClick={() => {
                                setOpenMenuId(null);
                                openEditDebt(d);
                              }}
                              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-accent transition-colors"
                            >
                              <Edit3 className="h-3.5 w-3.5 text-muted-foreground" />
                              <span>编辑债务</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setOpenMenuId(null);
                                handleToggleArchiveDebt(d);
                              }}
                              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-accent transition-colors"
                            >
                              <Archive className="h-3.5 w-3.5 text-amber-400" />
                              <span>归档债务</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setOpenMenuId(null);
                                handleDeleteDebt(d);
                              }}
                              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-rose-400 hover:bg-rose-500/10 transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>删除债务</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-3 text-xs">
                      <div>
                        <div className="text-muted-foreground text-[11px]">当前剩余待还</div>
                        <div className="font-bold text-rose-400 font-mono text-sm mt-0.5">
                          {formatCurrency(curBal)}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-[11px]">借款初始本金</div>
                        <div className="font-semibold font-mono text-sm mt-0.5">
                          {formatCurrency(initVal)}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-[11px]">每期应还</div>
                        <div className="font-semibold font-mono text-sm mt-0.5">
                          {formatCurrency(d.monthly_payment || 0)}
                        </div>
                      </div>
                    </div>

                    {/* 进度条 */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] text-muted-foreground">
                        <span>
                          已偿还 {formatCurrency(repaidVal)} ({pct}%)
                        </span>
                        <span>
                          📅 {d.due_date || "按期"} · 剩余 {d.remaining_periods ?? d.total_periods ?? 0} 期
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 transition-all duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    {d.note && <div className="text-[11px] text-muted-foreground">备注: {d.note}</div>}

                    <div className="flex justify-end pt-1">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => onOpenDebtRepayment(d.account)}
                      >
                        ⚡ 记一笔还款
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 已归档债务下拉折叠区 */}
          {archivedDebts.length > 0 && (
            <div className="rounded-xl border bg-muted/20 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowArchivedDebts((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Archive className="h-3.5 w-3.5" />
                  已归档债务 ({archivedDebts.length})
                </span>
                <span className="flex items-center gap-1">
                  {showArchivedDebts ? "收起" : "展开查看"}
                  {showArchivedDebts ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </span>
              </button>
              {showArchivedDebts && (
                <div className="divide-y border-t px-4 py-2">
                  {archivedDebts.map((d) => (
                    <div
                      key={d.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">已归档</Badge>
                        <span className="font-semibold">{d.name}</span>
                        <span className="text-muted-foreground font-mono">{d.account}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-muted-foreground">
                          待还 {formatCurrency(d.current_balance || 0)}
                        </span>
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => handleToggleArchiveDebt(d)}
                        >
                          <ArchiveRestore className="h-3.5 w-3.5" /> 恢复启用
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          className="text-rose-400"
                          onClick={() => handleDeleteDebt(d)}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> 删除
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 新增/编辑资金账户弹窗 */}
      <DialogModal
        open={accModalOpen}
        onClose={() => setAccModalOpen(false)}
        title={editingAcc ? "编辑资金账户" : "新增资金账户"}
      >
        <form onSubmit={handleSaveAccount} className="space-y-4">
          <div className="space-y-1.5">
            <Label>账户显示名称</Label>
            <Input
              placeholder="例如: 招商银行工资卡"
              value={accName}
              onChange={(e) => setAccName(e.target.value)}
              required
            />
          </div>
          {!editingAcc && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>账户类型</Label>
                  <Select value={accType} onChange={(e) => setAccType(e.target.value)}>
                    <option value="debit">储蓄卡 / 借记卡</option>
                    <option value="credit">信用卡</option>
                    <option value="e_wallet">电子钱包 (微信/支付宝)</option>
                    <option value="cash">现金钱包</option>
                    <option value="invest">投资理财账户</option>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>期初余额 (¥)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={accInitBal}
                    onChange={(e) => setAccInitBal(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Beancount 会计科目路径</Label>
                <Input
                  placeholder="例如: Assets:Bank:CMB:Card8888"
                  value={accCode}
                  onChange={(e) => setAccCode(e.target.value)}
                  required
                />
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Label>银行卡 4 位尾号 (选填，用于邮件同步自动匹配账户)</Label>
            <Input
              placeholder="例如: 7861"
              maxLength={4}
              value={accCardTail}
              onChange={(e) => setAccCardTail(e.target.value)}
            />
          </div>
          {editingAcc && (
            <div className="space-y-1.5">
              <Label>账户状态</Label>
              <Select
                value={accArchived ? "archived" : "active"}
                onChange={(e) => setAccArchived(e.target.value === "archived")}
              >
                <option value="active">正常使用</option>
                <option value="archived">已归档（从主列表隐藏，在已归档下拉中显示）</option>
              </Select>
            </div>
          )}
          <div className="flex items-center justify-between pt-3 border-t">
            {editingAcc ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => handleDeleteAccount(editingAcc)}
              >
                <Trash2 className="h-3.5 w-3.5" /> 删除账户
              </Button>
            ) : (
              <div />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setAccModalOpen(false)}>
                取消
              </Button>
              <Button type="submit">保存账户</Button>
            </div>
          </div>
        </form>
      </DialogModal>

      {/* 新增/编辑个人债务弹窗 */}
      <DialogModal
        open={debtModalOpen}
        onClose={() => setDebtModalOpen(false)}
        title={editingDebt ? "编辑个人债务" : "新增个人债务 / 贷款"}
      >
        <form onSubmit={handleSaveDebt} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>债务名称</Label>
              <Input
                placeholder="例如: 招商银行消费贷 / 房贷"
                value={debtName}
                onChange={(e) => setDebtName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>债务类型</Label>
              <Select value={debtType} onChange={(e) => setDebtType(e.target.value)}>
                <option value="mortgage">🏠 房贷/按揭</option>
                <option value="car">🚗 车贷</option>
                <option value="consumer">💳 消费贷/白条</option>
                <option value="personal">🤝 亲友拆借/个人贷款</option>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>借款初始本金总额 (¥)</Label>
              <Input
                type="number"
                step="0.01"
                value={debtInitAmt}
                onChange={(e) => setDebtInitAmt(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>每期应还金额 (¥)</Label>
              <Input
                type="number"
                step="0.01"
                value={debtMonthlyPay}
                onChange={(e) => setDebtMonthlyPay(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>每月还款日提醒</Label>
              <Input
                placeholder="例如: 每月 15 日"
                value={debtDueDate}
                onChange={(e) => setDebtDueDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>分期总期数 (月)</Label>
              <Input
                type="number"
                value={debtPeriods}
                onChange={(e) => setDebtPeriods(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>备注说明</Label>
            <Input
              placeholder="选填利率、合同号等备注信息"
              value={debtNote}
              onChange={(e) => setDebtNote(e.target.value)}
            />
          </div>

          {editingDebt && (
            <div className="space-y-1.5">
              <Label>债务状态</Label>
              <Select
                value={debtArchived ? "archived" : "active"}
                onChange={(e) => setDebtArchived(e.target.value === "archived")}
              >
                <option value="active">正常待还</option>
                <option value="archived">已归档（从主列表隐藏，在已归档下拉中显示）</option>
              </Select>
            </div>
          )}

          <div className="flex items-center justify-between pt-3 border-t">
            {editingDebt ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => handleDeleteDebt(editingDebt)}
              >
                <Trash2 className="h-3.5 w-3.5" /> 删除债务
              </Button>
            ) : (
              <div />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setDebtModalOpen(false)}>
                取消
              </Button>
              <Button type="submit">保存债务</Button>
            </div>
          </div>
        </form>
      </DialogModal>
    </div>
  );
};
