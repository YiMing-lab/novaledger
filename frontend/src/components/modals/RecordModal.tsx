import React, { useEffect, useState } from "react";
import { AccountItem, CategoryItem, DebtItem, TransactionItem } from "../../api/types";
import { api } from "../../api/client";
import { Button, DialogModal, Input, Label, Select, Switch, useToast } from "../ui/primitives";
import { getTodayStr, formatCurrency } from "../../lib/utils";
import { Sparkles, RotateCcw } from "lucide-react";

interface RecordModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  accounts: AccountItem[];
  categories: CategoryItem[];
  debts: DebtItem[];
  transactions: TransactionItem[];
  editingTx?: TransactionItem | null;
  presetDebtAccount?: string | null;
}

export const RecordModal: React.FC<RecordModalProps> = ({
  open,
  onClose,
  onSaved,
  accounts,
  categories,
  debts,
  transactions,
  editingTx,
  presetDebtAccount,
}) => {
  const toast = useToast();
  const isEdit = Boolean(editingTx);

  const [txType, setTxType] = useState<"expense" | "income" | "transfer">("expense");
  const [isOffset, setIsOffset] = useState(false);
  const [date, setDate] = useState(getTodayStr());
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState("");
  const [narration, setNarration] = useState("");
  const [account, setAccount] = useState("");
  const [category, setCategory] = useState("");
  const [toAccount, setToAccount] = useState("");
  const [rememberRule, setRememberRule] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  const activeAccounts = accounts.filter((a) => !a.is_archived);
  const archivedAccounts = accounts.filter((a) => a.is_archived);
  const activeDebts = debts.filter((d) => !d.is_archived);
  const archivedDebts = debts.filter((d) => d.is_archived);
  const assetAccounts = activeAccounts.filter((a) => !a.account.startsWith("Liabilities:"));
  const expenseCats = categories.filter((c) => !c.is_archived && c.type === "expense");
  const incomeCats = categories.filter((c) => !c.is_archived && c.type === "income");

  const formatAccOption = (a: AccountItem) =>
    `${a.name}${a.card_tail ? ` (尾号${a.card_tail})` : ""}${a.is_archived ? " (已归档)" : ""}`;

  useEffect(() => {
    if (!open) return;
    if (editingTx) {
      const normalizedType: "expense" | "income" | "transfer" =
        editingTx.type === "income"
          ? "income"
          : editingTx.type === "transfer" ||
            editingTx.type === "repayment" ||
            editingTx.type === "debt_repayment" ||
            (editingTx.category || "").startsWith("Assets:") ||
            (editingTx.category || "").startsWith("Liabilities:")
          ? "transfer"
          : "expense";

      setTxType(normalizedType);
      setIsOffset(Boolean(editingTx.is_offset));
      setDate(editingTx.date || getTodayStr());
      setAmount(String(editingTx.amount ?? ""));
      setPayee(editingTx.payee || "");
      setNarration((editingTx.narration || "").replace(/^\[冲减\]\s*/, ""));
      setAccount(editingTx.account || activeAccounts[0]?.account || "");
      if (normalizedType === "transfer") {
        setToAccount(editingTx.category || activeAccounts[1]?.account || activeDebts[0]?.account || "");
        setCategory(expenseCats[0]?.account || "Expenses:Food:Dining");
      } else {
        setCategory(editingTx.category || "");
        setToAccount(activeAccounts[1]?.account || activeDebts[0]?.account || "");
      }
      setRememberRule(false);
    } else if (presetDebtAccount) {
      setTxType("transfer");
      setIsOffset(false);
      setDate(getTodayStr());
      const targetDebt = activeDebts.find((d) => d.account === presetDebtAccount);
      setAmount(targetDebt?.monthly_payment ? String(targetDebt.monthly_payment) : "");
      setPayee(targetDebt ? `${targetDebt.name}还款` : "归还贷款");
      setNarration("");
      setAccount(assetAccounts[0]?.account || activeAccounts[0]?.account || "");
      setToAccount(presetDebtAccount);
      setCategory(expenseCats[0]?.account || "Expenses:Food:Dining");
    } else {
      setTxType("expense");
      setIsOffset(false);
      setDate(getTodayStr());
      setAmount("");
      setPayee("");
      setNarration("");
      setAccount(activeAccounts[0]?.account || "");
      setCategory(expenseCats[0]?.account || "Expenses:Food:Dining");
      setToAccount(activeAccounts[1]?.account || activeDebts[0]?.account || activeAccounts[0]?.account || "");
      setRememberRule(true);
    }
  }, [open, editingTx, presetDebtAccount]);

  const handleTypeChange = (newType: "expense" | "income" | "transfer") => {
    setTxType(newType);
    setIsOffset(false);
    if (newType === "expense") {
      if (!category || !category.startsWith("Expenses:")) {
        setCategory(expenseCats[0]?.account || "Expenses:Food:Dining");
      }
    } else if (newType === "income") {
      if (!category || !category.startsWith("Income:")) {
        setCategory(incomeCats[0]?.account || "Income:Salary");
      }
    } else if (newType === "transfer") {
      if (!toAccount) {
        const defaultTarget =
          activeAccounts.find((a) => a.account !== account)?.account ||
          activeDebts[0]?.account ||
          activeAccounts[0]?.account ||
          "";
        setToAccount(defaultTarget);
      }
    }
  };

  const handleToAccountChange = (val: string) => {
    setToAccount(val);
    const matchedDebt = debts.find((d) => d.account === val);
    if (matchedDebt && !isEdit) {
      if (!amount && matchedDebt.monthly_payment) {
        setAmount(String(matchedDebt.monthly_payment));
      }
      if (!payee.trim()) {
        setPayee(`${matchedDebt.name}还款`);
      }
    }
  };

  const handlePayeeBlur = () => {
    if (isEdit || !payee.trim()) return;
    if (txType !== "expense" && txType !== "income") return;
    const matched = [...transactions]
      .reverse()
      .find((t) => t.payee && (t.payee === payee.trim() || t.payee.includes(payee.trim())));
    if (matched && matched.category) {
      if (txType === "expense" && matched.category.startsWith("Expenses:")) {
        setCategory(matched.category);
      } else if (txType === "income" && matched.category.startsWith("Income:")) {
        setCategory(matched.category);
      }
    }
  };

  const handleAISuggest = async () => {
    if (!payee.trim() && !narration.trim()) {
      toast.info("请先填写商户或备注，以便 AI 推荐分类");
      return;
    }
    setAiLoading(true);
    try {
      const res = await api.getAISuggestion(payee, narration, amount || "0");
      if (res.suggested_category) {
        setCategory(res.suggested_category);
        const catObj = categories.find((c) => c.account === res.suggested_category);
        toast.success(`已推荐分类: ${catObj ? catObj.name : res.suggested_category}`);
      }
    } catch (e: any) {
      toast.error(`AI 推荐失败: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numAmt = parseFloat(amount);
    if (!date || isNaN(numAmt) || numAmt <= 0) {
      toast.error("请填写有效的日期与大于 0 的金额");
      return;
    }
    if (!account) {
      toast.error("请选择账户");
      return;
    }
    if (txType === "transfer" && account === toAccount) {
      toast.error("转出账户与转入账户不能相同");
      return;
    }

    setSubmitting(true);
    try {
      const targetCategory = txType === "transfer" ? toAccount : category;
      const defaultPayee =
        txType === "transfer"
          ? toAccount.startsWith("Liabilities:Loan:")
            ? "归还贷款"
            : toAccount.startsWith("Liabilities:CreditCard:")
            ? "信用卡还款"
            : "内部转账"
          : "日常交易";

      if (isEdit && editingTx) {
        await api.updateTransaction(editingTx.id, {
          type: txType,
          date,
          payee: payee.trim() || defaultPayee,
          narration: narration.trim(),
          amount: numAmt,
          account,
          category: targetCategory,
          to_account: txType === "transfer" ? toAccount : undefined,
          is_offset: txType === "expense" || txType === "income" ? isOffset : false,
          remember_rule: rememberRule,
        });
        toast.success("账单已更新");
      } else {
        await api.createTransaction({
          type: txType,
          is_offset: txType === "expense" || txType === "income" ? isOffset : false,
          date,
          amount: numAmt,
          payee: payee.trim() || defaultPayee,
          narration: narration.trim(),
          account,
          category: txType === "transfer" ? undefined : category,
          to_account: txType === "transfer" ? toAccount : undefined,
        });
        toast.success("已记入账本");
      }
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(`保存失败: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogModal
      open={open}
      onClose={onClose}
      title={isEdit ? "编辑账单" : "记一笔"}
      maxWidth="max-w-xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 交易类型切换栏：统一为 支出 / 收入 / 转账 */}
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
              onClick={() => handleTypeChange(tab.id)}
              className={`rounded-md py-1.5 text-xs font-medium transition-all ${
                txType === tab.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 退款开关 (仅在支出/收入模式下展示) */}
        {(txType === "expense" || txType === "income") && (
          <div
            className={`flex items-center justify-between rounded-lg border px-3.5 py-2.5 transition-colors ${
              isOffset
                ? "border-sky-500/40 bg-sky-500/10 text-sky-300"
                : "border-border bg-muted/40 text-muted-foreground"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <RotateCcw className="h-4 w-4 text-sky-400 shrink-0" />
              <div>
                <div className="text-xs font-semibold text-foreground">
                  {txType === "expense" ? "记为退款" : "记为退回"}
                </div>
                <div className="text-[11px] opacity-80">
                  {txType === "expense" ? "抵扣支出" : "抵扣收入"}
                </div>
              </div>
            </div>
            <Switch checked={isOffset} onCheckedChange={setIsOffset} />
          </div>
        )}

        {/* 日期与金额 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>日期</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label>金额 (¥)</Label>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="font-semibold text-base"
              required
            />
          </div>
        </div>

        {/* 账户与分类 / 转入账户 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>
              {txType === "transfer"
                ? "转出账户"
                : txType === "income"
                ? isOffset
                  ? "扣款账户"
                  : "收款账户"
                : isOffset
                ? "退回账户"
                : "付款账户"}
            </Label>
            <Select value={account} onChange={(e) => setAccount(e.target.value)}>
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

          {txType === "expense" || txType === "income" ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>记账分类</Label>
                <button
                  type="button"
                  onClick={handleAISuggest}
                  disabled={aiLoading}
                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  <Sparkles className="h-3 w-3" />
                  {aiLoading ? "识别中..." : "AI 推荐"}
                </button>
              </div>
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                {(txType === "expense" ? expenseCats : incomeCats).map((c) => (
                  <option key={c.id} value={c.account}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>转入账户（含银行卡 / 信用卡 / 贷款）</Label>
              <Select value={toAccount} onChange={(e) => handleToAccountChange(e.target.value)}>
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

        {/* 商户与备注 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>{txType === "transfer" ? "交易说明 / 对象" : "商户 / 交易对方"}</Label>
            <Input
              placeholder={
                txType === "transfer"
                  ? "例如: 信用卡还款 / 归还房贷"
                  : "例如: 星巴克 / 山姆会员店"
              }
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              onBlur={handlePayeeBlur}
            />
          </div>
          <div className="space-y-1.5">
            <Label>备注</Label>
            <Input
              placeholder="选填备注..."
              value={narration}
              onChange={(e) => setNarration(e.target.value)}
            />
          </div>
        </div>

        {/* 商户分类记忆规则勾选 */}
        {(txType === "expense" || txType === "income") && payee.trim() && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberRule}
              onChange={(e) => setRememberRule(e.target.checked)}
              className="rounded border-input"
            />
            <span>记住「{payee.trim()}」的默认分类，下次自动归类</span>
          </label>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "保存中..." : "保存"}
          </Button>
        </div>
      </form>
    </DialogModal>
  );
};
