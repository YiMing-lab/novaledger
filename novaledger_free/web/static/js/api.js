/**
 * NovaLedger API Client
 * 集中管理所有后端 REST API 请求、会话令牌 (Session Token) 与错误拦截
 */

const API = {
  sessionToken: null,

  async request(endpoint, options = {}) {
    const headers = {
      'Accept': 'application/json',
      ...(options.headers || {})
    };

    // 自动附加当前有效 Session Token
    if (this.sessionToken) {
      headers['x-session-token'] = this.sessionToken;
    }

    if (options.body && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }

    const config = {
      ...options,
      headers
    };

    try {
      const response = await fetch(endpoint, config);
      
      // 处理二进制下载 (如备份导出)
      const disposition = response.headers.get('content-disposition');
      if (disposition && disposition.includes('attachment')) {
        if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}`);
        return response.blob();
      }

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const errorMsg = data.detail || data.message || `请求失败 (${response.status})`;
        throw new Error(errorMsg);
      }
      return data;
    } catch (err) {
      console.error(`[API Error] ${endpoint}:`, err);
      throw err;
    }
  },

  // 1. 系统状态与配置
  async getStatus() {
    const data = await this.request('/api/status');
    if (data.session_token) {
      this.sessionToken = data.session_token;
    }
    return data;
  },

  async getConfig() {
    return await this.request('/api/config');
  },

  async updateConfig(payload) {
    return await this.request('/api/config', { method: 'POST', body: payload });
  },

  // 2. 资金账户
  async getAccounts(includeArchived = true) {
    return await this.request(`/api/accounts?include_archived=${includeArchived}`);
  },

  async createAccount(payload) {
    return await this.request('/api/accounts', { method: 'POST', body: payload });
  },

  async updateAccount(accountId, payload) {
    return await this.request(`/api/accounts/${accountId}`, { method: 'PUT', body: payload });
  },

  // 3. 个人债务
  async getDebts() {
    const res = await this.request('/api/debts');
    if (res && Array.isArray(res.debts)) {
      return res.debts;
    }
    return Array.isArray(res) ? res : [];
  },

  async createDebt(payload) {
    return await this.request('/api/debts', { method: 'POST', body: payload });
  },

  async updateDebt(debtId, payload) {
    return await this.request(`/api/debts/${debtId}`, { method: 'PUT', body: payload });
  },

  async deleteDebt(debtId) {
    return await this.request(`/api/debts/${debtId}`, { method: 'DELETE' });
  },

  // 4. 流水明细与交易
  async getTransactions() {
    const list = await this.request('/api/transactions');
    if (!Array.isArray(list)) return [];
    return list.map(tx => this.normalizeTransaction(tx));
  },

  normalizeTransaction(tx) {
    if (!tx) return tx;
    const postings = tx.postings || [];
    let catPost = null;
    let fundPost = null;

    // 1. 优先寻找典型分类科目 (Expenses: / Income:)
    for (const p of postings) {
      const acc = p.account || '';
      if (acc.startsWith('Expenses:') || acc.startsWith('Income:')) {
        catPost = p;
        break;
      }
    }

    // 2. 优先寻找出资/入账资金账户 (Assets:)
    for (const p of postings) {
      const acc = p.account || '';
      if (acc.startsWith('Assets:')) {
        fundPost = p;
        break;
      }
    }

    // 3. 处理债务 (Liabilities:Loan) 与信用卡 (Liabilities:CreditCard)
    if (!catPost) {
      for (const p of postings) {
        const acc = p.account || '';
        if (acc.startsWith('Liabilities:Loan:') || acc.startsWith('Liabilities:CreditCard:')) {
          catPost = p;
          break;
        }
      }
    }

    // 4. 处理内部转账 (两个及以上 Assets 分录)
    const assetPosts = postings.filter(p => (p.account || '').startsWith('Assets:'));
    if (assetPosts.length >= 2) {
      const negA = assetPosts.find(p => (p.amount || 0) < 0);
      const posA = assetPosts.find(p => (p.amount || 0) > 0);
      if (negA && posA) {
        fundPost = negA;
        catPost = posA;
      }
    }

    // 5. 处理权益与期初调整 (Equity:)
    if (!catPost) {
      for (const p of postings) {
        const acc = p.account || '';
        if (acc.startsWith('Equity:')) {
          catPost = p;
          break;
        }
      }
    }

    // 6. 兜底策略
    if (!fundPost) {
      for (const p of postings) {
        if (p !== catPost) {
          fundPost = p;
          break;
        }
      }
    }
    if (!catPost && postings.length > 0) catPost = postings[0];
    if (!fundPost && postings.length > 1) fundPost = postings[1];
    if (!fundPost && catPost) fundPost = catPost;

    const catAcc = tx.category || (catPost ? catPost.account : '');
    const fundAcc = tx.account || (fundPost ? fundPost.account : '');

    // 金额推导 (若无显式金额，从分录中取绝对值)
    let amount = tx.amount;
    if (amount === undefined || amount === null || isNaN(amount)) {
      if (catPost && catPost.amount !== undefined) {
        amount = Math.abs(catPost.amount);
      } else if (fundPost && fundPost.amount !== undefined) {
        amount = Math.abs(fundPost.amount);
      } else if (postings.length > 0) {
        amount = Math.abs(postings[0].amount || 0);
      } else {
        amount = 0;
      }
    }

    // 业务类型与对冲模式 (is_offset) 推导
    let type = tx.type;
    let isOffset = Boolean(tx.is_offset);

    // 检查是否有明确的支出负分录 (红字退款) 或收入正分录 (扣还)
    const hasNegativeExpense = (catPost && (catPost.account || '').startsWith('Expenses:') && (catPost.amount || 0) < 0) ||
                               postings.some(p => (p.account || '').startsWith('Expenses:') && (p.amount || 0) < 0);
    const hasPositiveIncome = (catPost && (catPost.account || '').startsWith('Income:') && (catPost.amount || 0) > 0) ||
                              postings.some(p => (p.account || '').startsWith('Income:') && (p.amount || 0) > 0);

    if (type === 'refund') {
      type = 'expense';
      isOffset = true;
    }

    if (!type) {
      if (catAcc.startsWith('Expenses:')) {
        type = 'expense';
        if (hasNegativeExpense) isOffset = true;
      } else if (catAcc.startsWith('Income:')) {
        type = 'income';
        if (hasPositiveIncome) isOffset = true;
      } else if (catAcc.startsWith('Liabilities:Loan:')) {
        type = 'debt_repayment';
      } else if (catAcc.startsWith('Liabilities:CreditCard:')) {
        type = 'repayment';
      } else if (fundAcc.startsWith('Assets:') && catAcc.startsWith('Assets:')) {
        type = 'transfer';
      } else if (catAcc.startsWith('Equity:') || fundAcc.startsWith('Equity:')) {
        type = (fundPost && (fundPost.amount || 0) > 0) ? 'income' : 'expense';
      } else {
        type = 'expense';
      }
    } else {
      if (type === 'expense' && hasNegativeExpense) isOffset = true;
      if (type === 'income' && hasPositiveIncome) isOffset = true;
    }

    return {
      ...tx,
      amount,
      category: catAcc,
      account: fundAcc,
      type,
      is_offset: isOffset
    };
  },

  async createTransaction(payload) {
    return await this.request('/api/transactions', { method: 'POST', body: payload });
  },

  async updateTransaction(txId, payload) {
    return await this.request(`/api/transactions/${txId}`, { method: 'PUT', body: payload });
  },

  async deleteTransaction(txId) {
    return await this.request(`/api/transactions/${txId}`, { method: 'DELETE' });
  },

  async updateTxCategory(txId, category, account = null) {
    return await this.request(`/api/transactions/${txId}/category`, {
      method: 'POST',
      body: { category, account }
    });
  },

  // 5. 分类管理
  async getCategories(includeArchived = true) {
    return await this.request(`/api/categories?include_archived=${includeArchived}`);
  },

  async createCategory(payload) {
    return await this.request('/api/categories', { method: 'POST', body: payload });
  },

  async updateCategory(catId, payload) {
    return await this.request(`/api/categories/${catId}`, { method: 'PUT', body: payload });
  },

  async deleteCategory(catId) {
    return await this.request(`/api/categories/${catId}`, { method: 'DELETE' });
  },

  async mergeCategories(sourceAccount, targetAccount) {
    return await this.request('/api/categories/merge', {
      method: 'POST',
      body: { source_account: sourceAccount, target_account: targetAccount }
    });
  },

  // 6. 报表与分析
  async getReports(month = '') {
    return await this.request(`/api/reports${month ? `?month=${month}` : ''}`);
  },

  async getTrends(months = 12) {
    return await this.request(`/api/trends?months=${months}`);
  },

  // 7. 对账校准
  async checkReconciliation(account, date, actualBalance) {
    return await this.request(
      `/api/reconciliation/check?account=${encodeURIComponent(account)}&date=${date}&actual_balance=${actualBalance}`
    );
  },

  async adjustReconciliation(payload) {
    return await this.request('/api/reconciliation/adjust', { method: 'POST', body: payload });
  },

  // 8. 导入与待确认
  async getPending() {
    return await this.request('/api/pending');
  },

  async resolvePending(itemId, action, account, category) {
    return await this.request(`/api/pending/${itemId}/resolve`, {
      method: 'POST',
      body: { action, account, category }
    });
  },

  async uploadImportFile(file, sourceType, defaultAccount) {
    const formData = new FormData();
    formData.append('file', file);
    return await this.request(
      `/api/import/upload?source_type=${encodeURIComponent(sourceType)}&default_account=${encodeURIComponent(defaultAccount)}`,
      { method: 'POST', body: formData }
    );
  },

  async rollbackImportBatch(batchId) {
    return await this.request(`/api/import/rollback/${batchId}`, { method: 'POST' });
  },

  // 9. AI 建议与洞察
  async getAISuggestion(payee, narration, amount) {
    return await this.request('/api/ai/suggest', {
      method: 'POST',
      body: { payee, narration, amount: String(amount) }
    });
  },

  async testAIKey(apiKey = '') {
    return await this.request('/api/ai/test', {
      method: 'POST',
      body: { api_key: apiKey }
    });
  },

  async getAIReportInsights(month = '') {
    return await this.request(`/api/ai/report_insights${month ? `?month=${month}` : ''}`);
  },

  // 10. 邮件同步
  async testMailSync(payload) {
    return await this.request('/api/mail_sync/test', { method: 'POST', body: payload });
  },

  async getMailSyncStatus() {
    return await this.request('/api/mail_sync/status');
  },

  async triggerMailSync() {
    return await this.request('/api/mail_sync/trigger', { method: 'POST' });
  },

  // 11. 备份与还原
  async exportBackup() {
    const blob = await this.request('/api/backup/export');
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    const nowStr = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    a.href = url;
    a.download = `novaledger_backup_${nowStr}.zip`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  },

  async importBackup(file) {
    const formData = new FormData();
    formData.append('file', file);
    return await this.request('/api/backup/import', { method: 'POST', body: formData });
  }
};

window.API = API;
