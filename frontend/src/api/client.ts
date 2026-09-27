import {
  AccountItem,
  CategoryItem,
  DebtItem,
  FinancialReport,
  HistoricalTrends,
  ImportBatchItem,
  PendingItem,
  PostingItem,
  TransactionItem,
} from "./types";

const getApiBase = (): string => {
  if (typeof window === "undefined") return "http://127.0.0.1:8088";
  const { protocol, hostname, port } = window.location;
  // In Tauri 2 production WebView2, origin is http://tauri.localhost or tauri://localhost
  if (hostname === "tauri.localhost" || protocol === "tauri:") {
    return "http://127.0.0.1:8088";
  }
  // If served directly from FastAPI on port 8088 or Vite dev proxy on 5173
  if (port === "8088" || port === "5173") {
    return "";
  }
  return "http://127.0.0.1:8088";
};

class ApiClient {
  sessionToken: string | null = null;

  async request<T = any>(endpoint: string, options: RequestInit & { rawBody?: any } = {}): Promise<T> {
    const base = getApiBase();
    const url = `${base}${endpoint}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.sessionToken) {
      headers["x-session-token"] = this.sessionToken;
    }

    let body = options.body;
    if (options.rawBody !== undefined) {
      if (options.rawBody instanceof FormData) {
        body = options.rawBody;
      } else {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(options.rawBody);
      }
    }

    const response = await fetch(url, {
      ...options,
      headers,
      body,
    });

    const disposition = response.headers.get("content-disposition");
    if (disposition && disposition.includes("attachment")) {
      if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}`);
      return (await response.blob()) as unknown as T;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorMsg = data.detail || data.message || `请求失败 (${response.status})`;
      throw new Error(errorMsg);
    }
    return data as T;
  }

  normalizeTransaction(tx: any): TransactionItem {
    const postings: PostingItem[] = tx.postings || [];
    let catPost: PostingItem | null = null;
    let fundPost: PostingItem | null = null;

    for (const p of postings) {
      const acc = p.account || "";
      if (acc.startsWith("Expenses:") || acc.startsWith("Income:")) {
        catPost = p;
        break;
      }
    }

    if (catPost) {
      fundPost = postings.find((p) => p !== catPost) || catPost;
    } else {
      const hasEquity = postings.find((p) => (p.account || "").startsWith("Equity:"));
      if (hasEquity) {
        catPost = hasEquity;
        fundPost = postings.find((p) => p !== hasEquity) || hasEquity;
      } else if (postings.length >= 2) {
        const negPost = postings.find((p) => (p.amount || 0) < 0);
        const posPost = postings.find((p) => (p.amount || 0) > 0);
        if (negPost && posPost) {
          fundPost = negPost;
          catPost = posPost;
        } else {
          catPost = postings[0];
          fundPost = postings[1];
        }
      } else if (postings.length === 1) {
        catPost = postings[0];
        fundPost = postings[0];
      }
    }

    const catAcc = tx.category || (catPost ? catPost.account : "");
    const fundAcc = tx.account || (fundPost ? fundPost.account : "");

    let amount = tx.amount;
    if (amount === undefined || amount === null || isNaN(amount)) {
      if (catPost && catPost.amount !== undefined) amount = Math.abs(catPost.amount);
      else if (fundPost && fundPost.amount !== undefined) amount = Math.abs(fundPost.amount);
      else if (postings.length > 0) amount = Math.abs(postings[0].amount || 0);
      else amount = 0;
    }

    let type = tx.type;
    let isOffset = Boolean(tx.is_offset);

    const hasNegativeExpense =
      (catPost && (catPost.account || "").startsWith("Expenses:") && (catPost.amount || 0) < 0) ||
      postings.some((p) => (p.account || "").startsWith("Expenses:") && (p.amount || 0) < 0);
    const hasPositiveIncome =
      (catPost && (catPost.account || "").startsWith("Income:") && (catPost.amount || 0) > 0) ||
      postings.some((p) => (p.account || "").startsWith("Income:") && (p.amount || 0) > 0);

    if (type === "refund") {
      type = "expense";
      isOffset = true;
    } else if (type === "repayment" || type === "debt_repayment") {
      type = "transfer";
    }

    if (!type) {
      if (catAcc.startsWith("Expenses:")) {
        type = "expense";
        if (hasNegativeExpense) isOffset = true;
      } else if (catAcc.startsWith("Income:")) {
        type = "income";
        if (hasPositiveIncome) isOffset = true;
      } else if (
        catAcc.startsWith("Liabilities:") ||
        catAcc.startsWith("Assets:")
      ) {
        type = "transfer";
      } else if (catAcc.startsWith("Equity:") || fundAcc.startsWith("Equity:")) {
        type = fundPost && (fundPost.amount || 0) > 0 ? "income" : "expense";
      } else {
        type = "expense";
      }
    } else {
      if (type === "expense" && hasNegativeExpense) isOffset = true;
      if (type === "income" && hasPositiveIncome) isOffset = true;
    }

    return {
      ...tx,
      amount: Number(amount),
      category: catAcc,
      account: fundAcc,
      type,
      is_offset: isOffset,
    };
  }

  async getStatus() {
    const data = await this.request("/api/status");
    if (data.session_token) {
      this.sessionToken = data.session_token;
    }
    return data;
  }

  async getConfig() {
    return await this.request("/api/config");
  }

  async updateConfig(payload: any) {
    return await this.request("/api/config", { method: "POST", rawBody: payload });
  }

  async getAccounts(includeArchived = true): Promise<AccountItem[]> {
    return await this.request(`/api/accounts?include_archived=${includeArchived}`);
  }

  async createAccount(payload: any) {
    return await this.request("/api/accounts", { method: "POST", rawBody: payload });
  }

  async updateAccount(accountId: string, payload: any) {
    return await this.request(`/api/accounts/${accountId}`, { method: "PUT", rawBody: payload });
  }

  async deleteAccount(accountId: string) {
    return await this.request(`/api/accounts/${accountId}`, { method: "DELETE" });
  }

  async getDebts(): Promise<DebtItem[]> {
    const res = await this.request("/api/debts");
    if (res && Array.isArray(res.debts)) return res.debts;
    return Array.isArray(res) ? res : [];
  }

  async createDebt(payload: any) {
    return await this.request("/api/debts", { method: "POST", rawBody: payload });
  }

  async updateDebt(debtId: string, payload: any) {
    return await this.request(`/api/debts/${debtId}`, { method: "PUT", rawBody: payload });
  }

  async deleteDebt(debtId: string) {
    return await this.request(`/api/debts/${debtId}`, { method: "DELETE" });
  }

  async getTransactions(): Promise<TransactionItem[]> {
    const list = await this.request("/api/transactions");
    if (!Array.isArray(list)) return [];
    return list.map((tx) => this.normalizeTransaction(tx));
  }

  async createTransaction(payload: any) {
    return await this.request("/api/transactions", { method: "POST", rawBody: payload });
  }

  async updateTransaction(txId: string, payload: any) {
    return await this.request(`/api/transactions/${txId}`, { method: "PUT", rawBody: payload });
  }

  async deleteTransaction(txId: string) {
    return await this.request(`/api/transactions/${txId}`, { method: "DELETE" });
  }

  async getCategories(includeArchived = true): Promise<CategoryItem[]> {
    return await this.request(`/api/categories?include_archived=${includeArchived}`);
  }

  async createCategory(payload: any) {
    return await this.request("/api/categories", { method: "POST", rawBody: payload });
  }

  async updateCategory(catId: string, payload: any) {
    return await this.request(`/api/categories/${catId}`, { method: "PUT", rawBody: payload });
  }

  async deleteCategory(catId: string) {
    return await this.request(`/api/categories/${catId}`, { method: "DELETE" });
  }

  async mergeCategories(sourceAccount: string, targetAccount: string) {
    return await this.request("/api/categories/merge", {
      method: "POST",
      rawBody: { source_account: sourceAccount, target_account: targetAccount },
    });
  }

  async getReports(month = ""): Promise<FinancialReport> {
    return await this.request(`/api/reports${month ? `?month=${month}` : ""}`);
  }

  async getTrends(months = 12): Promise<HistoricalTrends> {
    return await this.request(`/api/trends?months=${months}`);
  }

  async checkReconciliation(account: string, date: string, actualBalance: number) {
    return await this.request(
      `/api/reconciliation/check?account=${encodeURIComponent(account)}&date=${date}&actual_balance=${actualBalance}`
    );
  }

  async adjustReconciliation(payload: any) {
    return await this.request("/api/reconciliation/adjust", { method: "POST", rawBody: payload });
  }

  async getPending(): Promise<PendingItem[]> {
    return await this.request("/api/pending");
  }

  async resolvePending(
    itemId: string,
    action: string,
    account: string,
    category: string,
    type?: "expense" | "income" | "transfer",
    isOffset?: boolean
  ) {
    return await this.request(`/api/pending/${itemId}/resolve`, {
      method: "POST",
      rawBody: { action, account, category, type, is_offset: isOffset },
    });
  }

  async getImportBatches(): Promise<ImportBatchItem[]> {
    return await this.request("/api/import/batches");
  }

  async uploadImportFile(file: File, sourceType: string, defaultAccount: string) {
    const formData = new FormData();
    formData.append("file", file);
    return await this.request(
      `/api/import/upload?source_type=${encodeURIComponent(sourceType)}&default_account=${encodeURIComponent(defaultAccount)}`,
      { method: "POST", rawBody: formData }
    );
  }

  async rollbackImportBatch(batchId: string) {
    return await this.request(`/api/import/rollback/${batchId}`, { method: "POST" });
  }

  async getAISuggestion(payee: string, narration: string, amount: number | string) {
    return await this.request("/api/ai/suggest", {
      method: "POST",
      rawBody: { payee, narration, amount: String(amount) },
    });
  }

  async testAIKey(
    payloadOrKey:
      | string
      | {
          api_key?: string;
          provider?: string;
          base_url?: string;
          model?: string;
          proxy?: string;
        } = ""
  ) {
    const rawBody =
      typeof payloadOrKey === "string" ? { api_key: payloadOrKey } : payloadOrKey;
    return await this.request("/api/ai/test", {
      method: "POST",
      rawBody,
    });
  }

  async getAIReportInsights(month = "") {
    return await this.request(`/api/ai/report_insights${month ? `?month=${month}` : ""}`);
  }

  async testMailSync(payload: any) {
    return await this.request("/api/mail_sync/test", { method: "POST", rawBody: payload });
  }

  async getMailSyncStatus() {
    return await this.request("/api/mail_sync/status");
  }

  async triggerMailSync() {
    return await this.request("/api/mail_sync/trigger", { method: "POST" });
  }

  async parseMailSample(payload: { subject?: string; sender?: string; body: string; use_ai_fallback?: boolean }) {
    return await this.request("/api/mail_sync/parse_sample", { method: "POST", rawBody: payload });
  }

  private triggerBlobDownload(blob: Blob, filename: string) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  }

  async exportBackup() {
    const blob = await this.request<Blob>("/api/backup/export");
    const nowStr = new Date().toISOString().slice(0, 19).replace(/[^0-9]/g, "");
    this.triggerBlobDownload(blob, `novaledger_backup_${nowStr}.zip`);
  }

  async exportBeanFile() {
    const blob = await this.request<Blob>("/api/backup/export_bean");
    const nowStr = new Date().toISOString().slice(0, 19).replace(/[^0-9]/g, "");
    this.triggerBlobDownload(blob, `novaledger_ledger_${nowStr}.bean`);
  }

  async exportCsvFile() {
    const blob = await this.request<Blob>("/api/backup/export_csv");
    const nowStr = new Date().toISOString().slice(0, 19).replace(/[^0-9]/g, "");
    this.triggerBlobDownload(blob, `novaledger_transactions_${nowStr}.csv`);
  }

  async importBackup(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    return await this.request("/api/backup/import", { method: "POST", rawBody: formData });
  }
}

export const api = new ApiClient();
