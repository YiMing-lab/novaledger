import React, { useEffect, useMemo, useState } from "react";
import {
  AccountItem,
  CategoryItem,
  DebtItem,
  FinancialReport,
  TransactionItem,
} from "../api/types";
import { api } from "../api/client";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Select,
  SheetDrawer,
  Switch,
  useToast,
} from "../components/ui/primitives";
import { formatCurrency, getTodayStr } from "../lib/utils";
import {
  Plus,
  Search,
  Edit3,
  Trash2,
  ArrowUpRight,
  ArrowDownRight,
  RotateCcw,
  ArrowRightLeft,
  Sparkles,
} from "lucide-react";

interface TransactionsViewProps {
  transactions: TransactionItem[];
  accounts: AccountItem[];
  categories: CategoryItem[];
  debts: DebtItem[];
  report: FinancialReport | null;
  selectedMonth: string;
  onMonthChange: (m: string) => void;
  onOpenRecord: (tx?: TransactionItem | null) => void;
  onRefresh: () => void;
}

export const TransactionsView: React.FC<TransactionsViewProps> = ({
  transactions,
  accounts,
  categories,
  debts,
  report,
  selectedMonth,
  onMonthChange,
  onOpenRecord,
  onRefresh,
}) => {
  const toast = useToast();
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [drawerTx, setDrawerTx] = useState<TransactionItem | null>(null);
  const [updatingRowId, setUpdatingRowId] = useState<string | null>(null);

  // 右侧编辑边栏表单状态
  const [editType, setEditType] = useState<"expense" | "income" | "transfer">("expense");
  const [editOffset, setEditOffset] = useState<boolean>(false);
  const [editDate, setEditDate] = useState<string>(getTodayStr());
  const [editAmount, setEditAmount] = useState<string>("");
  const [editAccount, setEditAccount] = useState<string>("");
  const [editCategory, setEditCategory] = useState<string>("");
  const [editPayee, setEditPayee] = useState<string>("");
  const [editNarration, setEditNarration] = useState<string>("");
  const [editRememberRule, setEditRememberRule] = useState<boolean>(false);
  const [editSaving, setEditSaving] = useState<boolean>(false);
  const [aiSuggesting, setAiSuggesting] = useState<boolean>(false);

  const activeAccounts = useMemo(() => accounts.filter((a) => !a.is_archived), [accounts]);
  const archivedAccounts = useMemo(() => accounts.filter((a) => a.is_archived), [accounts]);
  const activeDebts = useMemo(() => debts.filter((d) => !d.is_archived), [debts]);
  const archivedDebts = useMemo(() => debts.filter((d) => d.is_archived), [debts]);
  const expenseCats = useMemo(
    () => categories.filter((c) => !c.is_archived && c.type === "expense"),
    [categories]
  );
  const incomeCats = useMemo(
    () => categories.filter((c) => !c.is_archived && c.type === "income"),
    [categories]
  );

  const nameMap = useMemo(() => {
    const map: Record<string, string> = {
      "Equity:Opening-Balances": "期初余额",
    };
    accounts.forEach((a) => (map[a.account] = a.name));
    categories.forEach((c) => (map[c.account] = c.name));
    debts.forEach((d) => (map[d.account] = d.name));
    return map;
  }, [accounts, categories, debts]);

  const formatAccOption = (a: AccountItem) =>
    `${a.name}${a.card_tail ? ` (尾号${a.card_tail})` : ""}${a.is_archived ? " (已归档)" : ""}`;

  const getNormalizedTxType = (tx: TransactionItem): "expense" | "income" | "transfer" => {
    if (tx.type === "income") return "income";
    if (
      tx.type === "transfer" ||
      tx.type === "repayment" ||
      tx.type === "debt_repayment" ||
      (tx.category || "").startsWith("Assets:") ||
      (tx.category || "").startsWith("Liabilities:")
    ) {
      return "transfer";
    }
    return "expense";
  };

  // 当打开右侧边栏时，同步初始化编辑表单状态
  useEffect(() => {
    if (!drawerTx) return;
    const normType = getNormalizedTxType(drawerTx);
    setEditType(normType);
    setEditOffset(Boolean(drawerTx.is_offset));
    setEditDate(drawerTx.date || getTodayStr());
    setEditAmount(String(drawerTx.amount ?? ""));
    setEditAccount(drawerTx.account || activeAccounts[0]?.account || "");
    setEditCategory(drawerTx.category || "");
    setEditPayee(drawerTx.payee || "");
    setEditNarration((drawerTx.narration || "").replace(/^\[冲减\]\s*/, "").replace(/^\[确认\]\s*/, ""));
    setEditRememberRule(false);
  }, [drawerTx, activeAccounts]);

  const handleEditTypeChange = (newType: "expense" | "income" | "transfer") => {
    setEditType(newType);
    setEditOffset(false);
    if (newType === "expense") {
      if (!editCategory.startsWith("Expenses:")) {
        setEditCategory(expenseCats[0]?.account || "Expenses:Food:Dining");
      }
    } else if (newType === "income") {
      if (!editCategory.startsWith("Income:")) {
        setEditCategory(incomeCats[0]?.account || "Income:Salary");
      }
    } else if (newType === "transfer") {
      if (!editCategory.startsWith("Assets:") && !editCategory.startsWith("Liabilities:")) {
        const defaultTarget =
          activeAccounts.find((a) => a.account !== editAccount)?.account ||
          activeDebts[0]?.account ||
          activeAccounts[0]?.account ||
          "";
        setEditCategory(defaultTarget);
      }
    }
  };

  const handleAISuggestInDrawer = async () => {
    if (!editPayee.trim() && !editNarration.trim()) {
      toast.info("请先填写商户或备注，以便 AI 推荐分类");
      return;
    }
    setAiSuggesting(true);
    try {
      const res = await api.getAISuggestion(editPayee, editNarration, editAmount || "0");
      if (res.suggested_category) {
        setEditCategory(res.suggested_category);
        toast.success(`已推荐分类: ${nameMap[res.suggested_category] || res.suggested_category}`);
      }
    } catch (e: any) {
      toast.error(`AI 推荐失败: ${e.message}`);
    } finally {
      setAiSuggesting(false);
    }
  };

  const handleSaveDrawerEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!drawerTx) return;
    const numAmt = parseFloat(editAmount);
    if (!editDate || isNaN(numAmt) || numAmt <= 0) {
      toast.error("请填写有效的日期与大于 0 的金额");
      return;
    }
    if (!editAccount || !editCategory) {
      toast.error("请选择账户与分类/转入账户");
      return;
    }
    if (editType === "transfer" && editAccount === editCategory) {
      toast.error("转出账户与转入账户不能相同");
      return;
    }

    setEditSaving(true);
    try {
      const defaultPayee =
        editType === "transfer"
          ? editCategory.startsWith("Liabilities:Loan:")
            ? "归还贷款"
            : editCategory.startsWith("Liabilities:CreditCard:")
            ? "信用卡还款"
            : "内部转账"
          : "日常交易";

      await api.updateTransaction(drawerTx.id, {
        type: editType,
        date: editDate,
        payee: editPayee.trim() || defaultPayee,
        narration: editNarration.trim(),
        amount: numAmt,
        account: editAccount,
        category: editCategory,
        to_account: editType === "transfer" ? editCategory : undefined,
        is_offset: editType === "expense" || editType === "income" ? editOffset : false,
        remember_rule: editRememberRule,
      });
      toast.success("账单修改已保存");
      setDrawerTx(null);
      onRefresh();
    } catch (err: any) {
      toast.error(`保存失败: ${err.message}`);
    } finally {
      setEditSaving(false);
    }
  };

  // 表格行内快速修改分类 / 转入账户
  const handleQuickCategoryChange = async (tx: TransactionItem, newCategory: string) => {
    if (!newCategory || newCategory === tx.category) return;
    setUpdatingRowId(tx.id);
    try {
      const normType = getNormalizedTxType(tx);
      await api.updateTransaction(tx.id, {
        type: normType,
        category: newCategory,
        to_account: normType === "transfer" ? newCategory : undefined,
        account: tx.account,
        is_offset: tx.is_offset,
      });
      toast.success(`已修改为「${nameMap[newCategory] || newCategory}」`);
      onRefresh();
    } catch (err: any) {
      toast.error(`修改失败: ${err.message}`);
    } finally {
      setUpdatingRowId(null);
    }
  };

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    const cur = new Date().toISOString().slice(0, 7);
    set.add(cur);
    transactions.forEach((t) => {
      if (t.date && t.date.length >= 7) set.add(t.date.slice(0, 7));
    });
    return Array.from(set).sort().reverse();
  }, [transactions]);

  const filteredTxs = useMemo(() => {
    return transactions
      .filter((tx) => {
        if (selectedMonth !== "all" && !tx.date.startsWith(selectedMonth)) return false;
        const normType = getNormalizedTxType(tx);
        if (typeFilter === "offset") {
          if (!tx.is_offset) return false;
        } else if (typeFilter !== "all" && normType !== typeFilter) {
          return false;
        }
        if (accountFilter !== "all" && tx.account !== accountFilter && tx.category !== accountFilter) {
          return false;
        }
        if (categoryFilter !== "all" && tx.category !== categoryFilter) {
          return false;
        }
        if (searchQuery.trim()) {
          const q = searchQuery.trim().toLowerCase();
          const hit =
            (tx.payee || "").toLowerCase().includes(q) ||
            (tx.narration || "").toLowerCase().includes(q) ||
            (nameMap[tx.category] || tx.category || "").toLowerCase().includes(q) ||
            (nameMap[tx.account] || tx.account || "").toLowerCase().includes(q) ||
            String(tx.amount).includes(q);
          if (!hit) return false;
        }
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [transactions, selectedMonth, typeFilter, accountFilter, categoryFilter, searchQuery, nameMap]);

  const handleDelete = async (tx: TransactionItem) => {
    if (!window.confirm(`确定要删除「${tx.payee || tx.narration} (${formatCurrency(tx.amount)})」吗？`)) {
      return;
    }
    try {
      await api.deleteTransaction(tx.id);
      toast.success("账单已删除");
      if (drawerTx?.id === tx.id) setDrawerTx(null);
      onRefresh();
    } catch (e: any) {
      toast.error(`删除失败: ${e.message}`);
    }
  };

  const renderTypeBadge = (tx: TransactionItem) => {
    const normType = getNormalizedTxType(tx);
    if (normType === "expense" && tx.is_offset) {
      return (
        <Badge variant="info" className="gap-1">
          <RotateCcw className="h-3 w-3" /> 退款
        </Badge>
      );
    }
    if (normType === "income" && tx.is_offset) {
      return (
        <Badge variant="warning" className="gap-1">
          <RotateCcw className="h-3 w-3" /> 退回
        </Badge>
      );
    }
    if (normType === "expense") {
      return <Badge variant="destructive">支出</Badge>;
    }
    if (normType === "income") {
      return <Badge variant="success">收入</Badge>;
    }
    if (normType === "transfer") {
      if ((tx.category || "").startsWith("Liabilities:Loan:")) {
        return <Badge variant="info">转账 · 还贷款</Badge>;
      }
      if ((tx.category || "").startsWith("Liabilities:CreditCard:")) {
        return <Badge variant="warning">转账 · 还信用卡</Badge>;
      }
      return <Badge variant="secondary">转账</Badge>;
    }
    return <Badge variant="outline">{tx.type}</Badge>;
  };

  // 计算侧边栏实时预览的 Beancount 分录行
  const previewPostings = useMemo(() => {
    if (!drawerTx) return [];
    const numAmt = parseFloat(editAmount);
    const amt = !isNaN(numAmt) && numAmt > 0 ? numAmt : Number(drawerTx.amount || 0);
    if (!editAccount || !editCategory) return drawerTx.postings || [];

    if (editType === "transfer") {
      return [
        { account: editCategory, amount: amt, currency: "CNY" },
        { account: editAccount, amount: -amt, currency: "CNY" },
      ];
    }
    if (editType === "income") {
      if (editOffset) {
        return [
          { account: editCategory, amount: amt, currency: "CNY" },
          { account: editAccount, amount: -amt, currency: "CNY" },
        ];
      }
      return [
        { account: editAccount, amount: amt, currency: "CNY" },
        { account: editCategory, amount: -amt, currency: "CNY" },
      ];
    }
    // expense
    if (editOffset) {
      return [
        { account: editAccount, amount: amt, currency: "CNY" },
        { account: editCategory, amount: -amt, currency: "CNY" },
      ];
    }
    return [
      { account: editCategory, amount: amt, currency: "CNY" },
      { account: editAccount, amount: -amt, currency: "CNY" },
    ];
  }, [drawerTx, editType, editOffset, editAmount, editAccount, editCategory]);

  const incStmt = report?.income_statement;
  const balSheet = report?.balance_sheet;

  return (
    <div className="space-y-5">
      {/* 顶部 4 张汇总指标卡 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-card to-emerald-950/15 border-emerald-500/20">
          <CardContent className="p-4 pt-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>本月收入 ({selectedMonth === "all" ? "当前月" : selectedMonth})</span>
              <ArrowDownRight className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="mt-2 text-2xl font-bold text-emerald-400 font-mono">
              {formatCurrency(incStmt?.total_income ?? 0)}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">含工资、理财等收入</div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-card to-rose-950/15 border-rose-500/20">
          <CardContent className="p-4 pt-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>本月支出 ({selectedMonth === "all" ? "当前月" : selectedMonth})</span>
              <ArrowUpRight className="h-4 w-4 text-rose-400" />
            </div>
            <div className="mt-2 text-2xl font-bold text-rose-400 font-mono">
              {formatCurrency(incStmt?.total_expenses ?? 0)}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">已抵扣退款金额</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 pt-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>本月结余</span>
              <Badge variant={(incStmt?.monthly_surplus ?? 0) >= 0 ? "success" : "destructive"}>
                储蓄率 {incStmt?.savings_rate ?? 0}%
              </Badge>
            </div>
            <div className="mt-2 text-2xl font-bold font-mono">
              {formatCurrency(incStmt?.monthly_surplus ?? 0, true)}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              日均支出 {formatCurrency(report?.daily_burn_rate?.daily_run_rate ?? 0)}/天
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 pt-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>净资产</span>
              <ArrowRightLeft className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2 text-2xl font-bold text-primary font-mono">
              {formatCurrency(balSheet?.net_worth ?? 0)}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              总资产 {formatCurrency(balSheet?.total_assets ?? 0)} · 总负债 {formatCurrency(balSheet?.total_liabilities ?? 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 筛选工具栏 */}
      <Card>
        <CardContent className="p-3.5 pt-3.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <Select
              value={selectedMonth}
              onChange={(e) => onMonthChange(e.target.value)}
              className="w-36"
            >
              <option value="all">📅 全部月份</option>
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  📅 {m}
                </option>
              ))}
            </Select>

            <Select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-36"
            >
              <option value="all">全部类型</option>
              <option value="expense">支出</option>
              <option value="income">收入</option>
              <option value="transfer">转账 (含还卡/还贷)</option>
              <option value="offset">退款</option>
            </Select>

            <Select
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
              className="w-44"
            >
              <option value="all">全部账户</option>
              {activeAccounts.map((a) => (
                <option key={a.id} value={a.account}>
                  {a.name}
                </option>
              ))}
              {activeDebts.length > 0 && (
                <optgroup label="贷款与负债账户">
                  {activeDebts.map((d) => (
                    <option key={d.id} value={d.account}>
                      [贷款] {d.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {(archivedAccounts.length > 0 || archivedDebts.length > 0) && (
                <optgroup label="已归档账户与债务">
                  {archivedAccounts.map((a) => (
                    <option key={a.id} value={a.account}>
                      {a.name} (已归档)
                    </option>
                  ))}
                  {archivedDebts.map((d) => (
                    <option key={d.id} value={d.account}>
                      [贷款] {d.name} (已归档)
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>

            <Select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-44"
            >
              <option value="all">全部分类</option>
              {categories.map((c) => (
                <option key={c.id} value={c.account}>
                  {c.name}
                </option>
              ))}
            </Select>

            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索商户、备注、分类或金额..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>

            <Button onClick={() => onOpenRecord(null)}>
              <Plus className="h-4 w-4" /> 记一笔
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 账单明细表格 */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b px-5 py-3 bg-muted/30">
          <div className="text-xs font-semibold text-muted-foreground">
            共 <span className="text-foreground font-bold">{filteredTxs.length}</span> 笔账单
          </div>
          <div className="text-[11px] text-muted-foreground">
            可直接下拉修改分类，或点击任意账单在右侧编辑详情
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b bg-muted/20 text-muted-foreground">
                <th className="py-3 px-4 font-medium">日期</th>
                <th className="py-3 px-3 font-medium">类型</th>
                <th className="py-3 px-4 font-medium">商户 / 交易对方</th>
                <th className="py-3 px-4 font-medium">备注</th>
                <th className="py-3 px-4 font-medium">记账分类 / 转入账户</th>
                <th className="py-3 px-4 font-medium">账户</th>
                <th className="py-3 px-4 font-medium text-right">金额</th>
                <th className="py-3 px-4 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredTxs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-muted-foreground">
                    暂无符合条件的账单记录
                  </td>
                </tr>
              ) : (
                filteredTxs.map((tx) => {
                  const normType = getNormalizedTxType(tx);
                  const isPositiveFlow =
                    (normType === "income" && !tx.is_offset) || (normType === "expense" && tx.is_offset);

                  return (
                    <tr
                      key={tx.id}
                      onClick={() => setDrawerTx(tx)}
                      className="hover:bg-accent/40 transition-colors cursor-pointer group"
                    >
                      <td className="py-3 px-4 font-mono text-muted-foreground whitespace-nowrap">
                        {tx.date}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">{renderTypeBadge(tx)}</td>
                      <td className="py-3 px-4 font-semibold text-foreground max-w-[180px] truncate">
                        {tx.payee || "—"}
                      </td>
                      <td className="py-3 px-4 text-muted-foreground max-w-[200px] truncate">
                        {tx.narration || "—"}
                      </td>
                      {/* 行内快速下拉修改分类 / 转入账户 */}
                      <td
                        className="py-2.5 px-4 whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <select
                          value={tx.category}
                          disabled={updatingRowId === tx.id}
                          onChange={(e) => handleQuickCategoryChange(tx, e.target.value)}
                          aria-label="快速修改分类或转入账户"
                          className="h-7 max-w-[185px] rounded-md border border-border/70 bg-secondary/70 hover:bg-secondary px-2 text-[11px] font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer transition-colors"
                        >
                          {normType === "expense" && (
                            <>
                              {!expenseCats.some((c) => c.account === tx.category) && tx.category && (
                                <option value={tx.category}>{nameMap[tx.category] || tx.category}</option>
                              )}
                              {expenseCats.map((c) => (
                                <option key={c.id} value={c.account}>
                                  {c.name}
                                </option>
                              ))}
                            </>
                          )}
                          {normType === "income" && (
                            <>
                              {!incomeCats.some((c) => c.account === tx.category) && tx.category && (
                                <option value={tx.category}>{nameMap[tx.category] || tx.category}</option>
                              )}
                              {incomeCats.map((c) => (
                                <option key={c.id} value={c.account}>
                                  {c.name}
                                </option>
                              ))}
                            </>
                          )}
                          {normType === "transfer" && (
                            <>
                              <optgroup label="资金与信用卡账户">
                                {activeAccounts.map((a) => (
                                  <option key={a.id} value={a.account}>
                                    {a.name}
                                  </option>
                                ))}
                              </optgroup>
                              {activeDebts.length > 0 && (
                                <optgroup label="贷款与负债账户">
                                  {activeDebts.map((d) => (
                                    <option key={d.id} value={d.account}>
                                      [贷款] {d.name}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              {(archivedAccounts.length > 0 || archivedDebts.length > 0) && (
                                <optgroup label="已归档账户与债务">
                                  {archivedAccounts.map((a) => (
                                    <option key={a.id} value={a.account}>
                                      {a.name} (已归档)
                                    </option>
                                  ))}
                                  {archivedDebts.map((d) => (
                                    <option key={d.id} value={d.account}>
                                      [贷款] {d.name} (已归档)
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                            </>
                          )}
                        </select>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                        {nameMap[tx.account] || tx.account}
                      </td>
                      <td
                        className={`py-3 px-4 font-mono font-bold text-right whitespace-nowrap text-sm ${
                          tx.is_offset
                            ? "text-sky-400"
                            : isPositiveFlow
                            ? "text-emerald-400"
                            : normType === "expense"
                            ? "text-rose-400"
                            : "text-foreground"
                        }`}
                      >
                        {isPositiveFlow
                          ? "+"
                          : normType === "expense" || (normType === "income" && tx.is_offset)
                          ? "-"
                          : ""}
                        {formatCurrency(tx.amount)}
                      </td>
                      <td
                        className="py-3 px-4 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1 opacity-80 group-hover:opacity-100">
                          <Button
                            variant="ghost"
                            size="xs"
                            title="编辑账单"
                            onClick={() => setDrawerTx(tx)}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="xs"
                            title="删除账单"
                            className="text-rose-400 hover:text-rose-300"
                            onClick={() => handleDelete(tx)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 右侧账单编辑侧边栏 (直接可编辑全部字段 + 保留 Beancount 记录展示) */}
      <SheetDrawer
        open={Boolean(drawerTx)}
        onClose={() => setDrawerTx(null)}
        title="编辑账单"
        subtitle={drawerTx ? `ID: ${drawerTx.id}` : ""}
      >
        {drawerTx && (
          <form onSubmit={handleSaveDrawerEdit} className="space-y-4 text-xs">
            {/* 1. 交易类型切换：支出 / 收入 / 转账 */}
            <div className="space-y-1.5">
              <Label>交易类型</Label>
              <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-muted p-1">
                {(
                  [
                    { id: "expense", label: "支出" },
                    { id: "income", label: "收入" },
                    { id: "transfer", label: "转账" },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => handleEditTypeChange(tab.id)}
                    className={`rounded-md py-1.5 text-xs font-medium transition-all ${
                      editType === tab.id
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 2. 记为退款开关 (仅在支出/收入下显示) */}
            {(editType === "expense" || editType === "income") && (
              <div
                className={`flex items-center justify-between rounded-lg border px-3.5 py-2.5 transition-colors ${
                  editOffset
                    ? "border-sky-500/40 bg-sky-500/10 text-sky-300"
                    : "border-border bg-muted/40 text-muted-foreground"
                }`}
              >
                <div className="flex items-center gap-2">
                  <RotateCcw className="h-4 w-4 text-sky-400 shrink-0" />
                  <div>
                    <div className="text-xs font-semibold text-foreground">
                      {editType === "expense" ? "记为退款" : "记为退回"}
                    </div>
                    <div className="text-[11px] opacity-80">
                      {editType === "expense" ? "抵扣支出" : "抵扣收入"}
                    </div>
                  </div>
                </div>
                <Switch checked={editOffset} onCheckedChange={setEditOffset} />
              </div>
            )}

            {/* 3. 日期与金额 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>日期</Label>
                <Input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>金额 (¥)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  className="font-semibold font-mono text-sm"
                  required
                />
              </div>
            </div>

            {/* 4. 账户与分类 / 转入账户 */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>
                  {editType === "transfer"
                    ? "转出账户"
                    : editType === "income"
                    ? editOffset
                      ? "扣款账户"
                      : "收款账户"
                    : editOffset
                    ? "退回账户"
                    : "付款账户"}
                </Label>
                <Select value={editAccount} onChange={(e) => setEditAccount(e.target.value)}>
                  {activeAccounts.map((a) => (
                    <option key={a.id} value={a.account}>
                      {formatAccOption(a)}
                    </option>
                  ))}
                  {archivedAccounts.length > 0 && (
                    <optgroup label="已归档账户">
                      {archivedAccounts.map((a) => (
                        <option key={a.id} value={a.account}>
                          {formatAccOption(a)}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </Select>
              </div>

              {editType === "expense" || editType === "income" ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>记账分类</Label>
                    <button
                      type="button"
                      onClick={handleAISuggestInDrawer}
                      disabled={aiSuggesting}
                      className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                    >
                      <Sparkles className="h-3 w-3" />
                      {aiSuggesting ? "识别中..." : "AI 推荐"}
                    </button>
                  </div>
                  <Select value={editCategory} onChange={(e) => setEditCategory(e.target.value)}>
                    {(editType === "expense" ? expenseCats : incomeCats).map((c) => (
                      <option key={c.id} value={c.account}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>转入账户（含银行卡 / 信用卡 / 贷款）</Label>
                  <Select value={editCategory} onChange={(e) => setEditCategory(e.target.value)}>
                    <optgroup label="资金与信用卡账户">
                      {activeAccounts.map((a) => (
                        <option key={a.id} value={a.account}>
                          {formatAccOption(a)}
                        </option>
                      ))}
                    </optgroup>
                    {activeDebts.length > 0 && (
                      <optgroup label="贷款与负债账户（归还贷款）">
                        {activeDebts.map((d) => (
                          <option key={d.id} value={d.account}>
                            [贷款] {d.name} (待还 {formatCurrency(d.current_balance)})
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {(archivedAccounts.length > 0 || archivedDebts.length > 0) && (
                      <optgroup label="已归档账户与债务">
                        {archivedAccounts.map((a) => (
                          <option key={a.id} value={a.account}>
                            {formatAccOption(a)}
                          </option>
                        ))}
                        {archivedDebts.map((d) => (
                          <option key={d.id} value={d.account}>
                            [贷款] {d.name} (已归档)
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </Select>
                </div>
              )}
            </div>

            {/* 5. 商户与备注 */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>{editType === "transfer" ? "交易说明 / 对象" : "商户 / 交易对方"}</Label>
                <Input
                  value={editPayee}
                  onChange={(e) => setEditPayee(e.target.value)}
                  placeholder="商户或交易对方名称"
                />
              </div>
              <div className="space-y-1.5">
                <Label>备注</Label>
                <Input
                  value={editNarration}
                  onChange={(e) => setEditNarration(e.target.value)}
                  placeholder="选填备注信息..."
                />
              </div>
            </div>

            {(editType === "expense" || editType === "income") && editPayee.trim() && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none pt-1">
                <input
                  type="checkbox"
                  checked={editRememberRule}
                  onChange={(e) => setEditRememberRule(e.target.checked)}
                  className="rounded border-input"
                />
                <span>记住「{editPayee.trim()}」的默认分类，下次自动归类</span>
              </label>
            )}

            {/* 6. 保留 Beancount 记录展示 */}
            <div className="pt-2 border-t space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-muted-foreground">Beancount 记录</span>
                <span className="text-[11px] text-muted-foreground">
                  来源: {drawerTx.source_type || "manual"}
                </span>
              </div>
              <div className="rounded-lg border bg-muted/20 divide-y">
                {previewPostings.map((p, idx) => (
                  <div key={idx} className="flex items-center justify-between px-3 py-2">
                    <div>
                      <div className="font-medium">{nameMap[p.account] || p.account}</div>
                      <div className="text-[11px] font-mono text-muted-foreground">{p.account}</div>
                    </div>
                    <div
                      className={`font-mono font-bold ${
                        p.amount > 0 ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {p.amount > 0 ? `+${p.amount.toFixed(2)}` : p.amount.toFixed(2)}{" "}
                      {p.currency || "CNY"}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 7. 底部操作按钮 */}
            <div className="flex items-center justify-between gap-2 pt-3 border-t">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => handleDelete(drawerTx)}
              >
                <Trash2 className="h-3.5 w-3.5" /> 删除
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDrawerTx(null)}
                >
                  取消
                </Button>
                <Button type="submit" size="sm" disabled={editSaving}>
                  {editSaving ? "保存中..." : "保存修改"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </SheetDrawer>
    </div>
  );
};
