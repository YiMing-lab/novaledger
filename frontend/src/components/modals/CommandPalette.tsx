import React, { useState, useEffect } from "react";
import { TransactionItem } from "../../api/types";
import { formatCurrency } from "../../lib/utils";
import { Search, Plus, Upload, RefreshCw, FileText, PieChart, Wallet, Settings, Receipt } from "lucide-react";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  transactions: TransactionItem[];
  onNavigate: (view: "transactions" | "accounts" | "analytics" | "settings", subTab?: string) => void;
  onOpenRecord: () => void;
  onTriggerMailSync: () => void;
  onSelectTx: (tx: TransactionItem) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onClose,
  transactions,
  onNavigate,
  onOpenRecord,
  onTriggerMailSync,
  onSelectTx,
}) => {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const matchedTxs = q
    ? transactions
        .filter(
          (t) =>
            (t.payee || "").toLowerCase().includes(q) ||
            (t.narration || "").toLowerCase().includes(q) ||
            (t.category || "").toLowerCase().includes(q) ||
            String(t.amount).includes(q)
        )
        .slice(0, 8)
    : [];

  const quickActions = [
    {
      label: "记一笔账 (快捷键 N)",
      icon: Plus,
      action: () => {
        onClose();
        onOpenRecord();
      },
    },
    {
      label: "同步银行账单邮件",
      icon: RefreshCw,
      action: () => {
        onClose();
        onTriggerMailSync();
      },
    },
    {
      label: "导入微信 / 支付宝 / 银行账单",
      icon: Upload,
      action: () => {
        onClose();
        onNavigate("settings", "import");
      },
    },
    {
      label: "导出 Beancount (.bean) / Excel (.csv) 账本",
      icon: FileText,
      action: () => {
        onClose();
        onNavigate("settings", "backup");
      },
    },
    {
      label: "前往：账单明细",
      icon: Receipt,
      action: () => {
        onClose();
        onNavigate("transactions");
      },
    },
    {
      label: "前往：账户与负债",
      icon: Wallet,
      action: () => {
        onClose();
        onNavigate("accounts");
      },
    },
    {
      label: "前往：统计分析",
      icon: PieChart,
      action: () => {
        onClose();
        onNavigate("analytics");
      },
    },
    {
      label: "前往：邮箱与 AI 设置",
      icon: Settings,
      action: () => {
        onClose();
        onNavigate("settings", "services");
      },
    },
  ].filter((a) => !q || a.label.toLowerCase().includes(q));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/65 backdrop-blur-xs pt-20 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-xl border bg-card text-card-foreground shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center border-b px-4 py-3 gap-2.5">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索历史交易商户、备注、金额，或输入快捷指令..."
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">ESC</kbd>
        </div>

        <div className="max-h-96 overflow-y-auto p-2 space-y-3">
          {quickActions.length > 0 && (
            <div>
              <div className="px-2.5 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                快捷操作与导航
              </div>
              <div className="space-y-0.5 mt-1">
                {quickActions.map((act, idx) => {
                  const Icon = act.icon;
                  return (
                    <button
                      key={idx}
                      onClick={act.action}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium hover:bg-accent hover:text-accent-foreground transition-colors text-left"
                    >
                      <Icon className="h-4 w-4 text-primary shrink-0" />
                      <span>{act.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {matchedTxs.length > 0 && (
            <div>
              <div className="px-2.5 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                匹配的交易流水 ({matchedTxs.length})
              </div>
              <div className="space-y-0.5 mt-1">
                {matchedTxs.map((tx) => (
                  <button
                    key={tx.id}
                    onClick={() => {
                      onClose();
                      onSelectTx(tx);
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs hover:bg-accent transition-colors text-left"
                  >
                    <div>
                      <span className="font-semibold">{tx.payee || "未命名商户"}</span>
                      <span className="text-muted-foreground ml-2">{tx.narration}</span>
                      <span className="text-muted-foreground ml-2 text-[11px]">({tx.date})</span>
                    </div>
                    <span className="font-mono font-semibold">{formatCurrency(tx.amount)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {quickActions.length === 0 && matchedTxs.length === 0 && (
            <div className="py-8 text-center text-xs text-muted-foreground">未找到匹配的交易或命令</div>
          )}
        </div>
      </div>
    </div>
  );
};
