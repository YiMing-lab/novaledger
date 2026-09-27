/**
 * Transactions View Controller (流水明细)
 * 处理流水筛选、搜索、增删改查、记一笔弹窗与 AI 智能建议
 */

const TransactionsView = {
  filterMonth: '',
  filterAccount: '',
  filterType: '',
  filterKeyword: '',
  currentPage: 1,
  pageSize: 25,

  getCategoryIcon(iconName) {
    return State.getCategoryIcon(iconName);
  },

  init() {
    this.bindEvents();
  },

  bindEvents() {
    const searchInput = document.getElementById('txSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.filterKeyword = e.target.value.trim().toLowerCase();
        this.currentPage = 1;
        this.render();
      });
    }

    const monthFilter = document.getElementById('txMonthFilter');
    if (monthFilter) {
      monthFilter.addEventListener('change', (e) => {
        this.filterMonth = e.target.value;
        this.currentPage = 1;
        this.render();
      });
    }

    const accFilter = document.getElementById('txAccountFilter');
    if (accFilter) {
      accFilter.addEventListener('change', (e) => {
        this.filterAccount = e.target.value;
        this.currentPage = 1;
        this.render();
      });
    }

    const typeFilter = document.getElementById('txTypeFilter');
    if (typeFilter) {
      typeFilter.addEventListener('change', (e) => {
        this.filterType = e.target.value;
        this.currentPage = 1;
        this.render();
      });
    }
  },

  populateFilters() {
    // 动态填充月份选项
    const monthSelect = document.getElementById('txMonthFilter');
    if (monthSelect) {
      const currentVal = this.filterMonth || monthSelect.value;
      const monthsSet = new Set();
      State.transactions.forEach(t => {
        if (t.date && t.date.length >= 7) {
          monthsSet.add(t.date.slice(0, 7));
        }
      });
      const sortedMonths = Array.from(monthsSet).sort().reverse();
      let html = '<option value="">全部月份</option>';
      sortedMonths.forEach(m => {
        html += `<option value="${m}" ${m === currentVal ? 'selected' : ''}>${m}</option>`;
      });
      monthSelect.innerHTML = html;
    }

    // 动态填充资金账户选项
    const accSelect = document.getElementById('txAccountFilter');
    if (accSelect) {
      const currentVal = this.filterAccount || accSelect.value;
      let html = '<option value="">全部资金账户</option>';
      State.getActiveAccounts().forEach(a => {
        html += `<option value="${a.account}" ${a.account === currentVal ? 'selected' : ''}>${a.name}${a.card_tail ? ` (${a.card_tail})` : ''}</option>`;
      });
      accSelect.innerHTML = html;
    }
  },

  getFilteredList() {
    return State.transactions.filter(tx => {
      if (this.filterMonth && !tx.date.startsWith(this.filterMonth)) return false;
      if (this.filterAccount && tx.account !== this.filterAccount && tx.category !== this.filterAccount) return false;
      
      if (this.filterType) {
        if (this.filterType === 'expense' && tx.type !== 'expense') return false;
        if (this.filterType === 'income' && tx.type !== 'income') return false;
        if (this.filterType === 'offset' && !tx.is_offset) return false;
        if (this.filterType === 'transfer' && tx.type !== 'transfer' && tx.type !== 'repayment' && tx.type !== 'debt_repayment') return false;
      }

      if (this.filterKeyword) {
        const kw = this.filterKeyword;
        const matchPayee = (tx.payee || '').toLowerCase().includes(kw);
        const matchNarration = (tx.narration || '').toLowerCase().includes(kw);
        const matchAmount = String(tx.amount || '').includes(kw);

        const accObj = State.getAccountByBean(tx.account);
        const accLabel = accObj ? `${accObj.name} ${accObj.card_tail || ''}` : (tx.account || '');
        const matchAccount = accLabel.toLowerCase().includes(kw);

        const catObj = State.getCategoryByAccount(tx.category);
        const debtObj = State.getDebtByAccount(tx.category);
        const catLabel = catObj ? catObj.name : (debtObj ? debtObj.name : (tx.category || ''));
        const matchCategory = catLabel.toLowerCase().includes(kw);

        if (!matchPayee && !matchNarration && !matchCategory && !matchAccount && !matchAmount) return false;
      }
      return true;
    });
  },

  render() {
    this.populateFilters();
    if (typeof App !== 'undefined' && App.updatePendingAlert) {
      App.updatePendingAlert(State.pendingItems);
    }

    const container = document.getElementById('txTableBody');
    if (!container) return;

    const list = this.getFilteredList();
    const countEl = document.getElementById('txFilteredCount');
    if (countEl) countEl.textContent = `共 ${list.length} 条流水`;

    if (list.length === 0) {
      container.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 40px; color: var(--md-sys-color-on-surface-variant);">
            暂无符合筛选条件的流水记录
          </td>
        </tr>
      `;
      this.renderPagination(0);
      return;
    }

    // 分页截取
    const start = (this.currentPage - 1) * this.pageSize;
    const paginated = list.slice(start, start + this.pageSize);

    container.innerHTML = paginated.map(tx => {
      // 匹配友好账户名与债务名
      let accName = tx.account || '-';
      const accObj = State.getAccountByBean(tx.account);
      if (accObj) {
        accName = `${accObj.name}${accObj.card_tail ? ` (${accObj.card_tail})` : ''}`;
      } else if (tx.account) {
        const debt = State.getDebtByAccount(tx.account);
        if (debt) {
          accName = debt.name;
        } else if (tx.account.startsWith('Equity:')) {
          accName = '🏛️ 系统期初/权益';
        } else {
          accName = tx.account.replace('Assets:Bank:', '').replace('Assets:', '');
        }
      }

      // 友好分类/科目名
      let catName = tx.category || '-';
      if (tx.category && tx.category.startsWith('Liabilities:Loan:')) {
        const debt = State.getDebtByAccount(tx.category);
        catName = debt ? `📉 ${debt.name}` : tx.category;
      } else if (tx.category && tx.category.startsWith('Liabilities:CreditCard:')) {
        const cardObj = State.getAccountByBean(tx.category);
        catName = cardObj ? `💳 ${cardObj.name}` : `💳 ${tx.category}`;
      } else if (tx.category && tx.category.startsWith('Assets:')) {
        const toAcc = State.getAccountByBean(tx.category);
        catName = toAcc ? `🔄 转入: ${toAcc.name}` : `🔄 ${tx.category}`;
      } else if (tx.category && tx.category.startsWith('Equity:')) {
        catName = '🏛️ 期初调账';
      } else {
        const catObj = State.getCategoryByAccount(tx.category);
        if (catObj) {
          const icon = this.getCategoryIcon(catObj.icon);
          catName = `${icon} ${catObj.name}`;
        } else if (tx.category) {
          catName = `🏷️ ${tx.category.replace('Expenses:', '').replace('Income:', '')}`;
        }
      }

      // 格式化金额与样式（统一对冲模型）
      let amountClass = 'amount-expense';
      let amountPrefix = '-';
      let badgeType = 'badge-expense';
      let typeLabel = '支出';

      if (tx.type === 'income') {
        if (tx.is_offset) {
          amountClass = 'amount-expense';
          amountPrefix = '-';
          badgeType = 'badge-income-offset';
          typeLabel = '↩️ 收入扣还';
        } else {
          amountClass = 'amount-income';
          amountPrefix = '+';
          badgeType = 'badge-income';
          typeLabel = '收入';
        }
      } else if (tx.type === 'expense') {
        if (tx.is_offset) {
          amountClass = 'amount-income';
          amountPrefix = '+';
          badgeType = 'badge-expense-offset';
          typeLabel = '↩️ 支出冲减';
        } else {
          amountClass = 'amount-expense';
          amountPrefix = '-';
          badgeType = 'badge-expense';
          typeLabel = '支出';
        }
      } else if (tx.type === 'transfer') {
        amountClass = 'amount-transfer';
        amountPrefix = '';
        badgeType = 'badge-transfer';
        typeLabel = '内部转账';
      } else if (tx.type === 'repayment' || tx.type === 'debt_repayment') {
        amountClass = 'amount-transfer';
        amountPrefix = '-';
        badgeType = 'badge-debt';
        typeLabel = tx.type === 'debt_repayment' ? '偿还借款' : '信用卡还款';
      }

      const catTooltip = tx.is_offset ? `${catName} (红字对冲冲减原分类)` : catName;
      const safeTxStr = encodeURIComponent(JSON.stringify(tx));

      return `
        <tr class="tx-row">
          <td class="cell-date">${escapeHtml(tx.date)}</td>
          <td class="cell-type"><span class="m3-badge ${badgeType}">${typeLabel}</span></td>
          <td class="cell-payee" title="${escapeHtml(tx.payee || '')}">${escapeHtml(tx.payee || '-')}</td>
          <td class="cell-narration" title="${escapeHtml(tx.narration || '')}">${escapeHtml(tx.narration || '-')}</td>
          <td class="cell-category" title="${escapeHtml(catTooltip)}">
            <span class="m3-tag-category">${escapeHtml(catName)}</span>
          </td>
          <td class="cell-account" title="${escapeHtml(accName)}">${escapeHtml(accName)}</td>
          <td class="cell-amount amount-display ${amountClass}">${amountPrefix}¥${Number(tx.amount || 0).toFixed(2)}</td>
          <td class="cell-actions">
            <button class="m3-btn btn-text btn-xs" onclick="TransactionsView.openEditModal(decodeURIComponent('${safeTxStr}'))">编辑</button>
            <button class="m3-btn btn-text btn-xs danger-text" onclick="TransactionsView.deleteTx('${escapeHtml(tx.id)}')">删除</button>
          </td>
        </tr>
      `;
    }).join('');

    this.renderPagination(list.length);
  },

  renderPagination(totalCount) {
    const cont = document.getElementById('txPagination');
    if (!cont) return;
    const totalPages = Math.ceil(totalCount / this.pageSize);
    if (totalPages <= 1) {
      cont.innerHTML = '';
      return;
    }

    cont.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 16px;">
        <span style="font-size: 13px; color: var(--md-sys-color-on-surface-variant);">
          第 ${this.currentPage} / ${totalPages} 页
        </span>
        <button class="m3-btn btn-outlined btn-sm" ${this.currentPage <= 1 ? 'disabled' : ''} onclick="TransactionsView.changePage(${this.currentPage - 1})">上一页</button>
        <button class="m3-btn btn-outlined btn-sm" ${this.currentPage >= totalPages ? 'disabled' : ''} onclick="TransactionsView.changePage(${this.currentPage + 1})">下一页</button>
      </div>
    `;
  },

  changePage(page) {
    this.currentPage = page;
    this.render();
  },

  // ------------------------------------------------------------------------
  // 记一笔弹窗
  // ------------------------------------------------------------------------
  openRecordModal() {
    document.getElementById('recForm').reset();
    document.getElementById('recDate').value = new Date().toISOString().slice(0, 10);
    const offsetCheckbox = document.getElementById('recIsOffset');
    if (offsetCheckbox) offsetCheckbox.checked = false;
    this.toggleRecordFields();
    this.populateRecordSelects();
    this.updatePostingPreview('rec');
    Dialog.open('recordModal');
  },

  toggleRecordFields() {
    let type = document.getElementById('recType').value;
    const toAccGroup = document.getElementById('recToAccountGroup');
    const catGroup = document.getElementById('recCategoryGroup');
    const offsetGroup = document.getElementById('recOffsetGroup');
    const offsetCheckbox = document.getElementById('recIsOffset');
    const toAccLabel = document.getElementById('recToAccountLabel');
    const fromAccLabel = document.getElementById('recAccountLabel');

    // 兼容老版本直接选择 refund
    if (type === 'refund') {
      type = 'expense';
      document.getElementById('recType').value = 'expense';
      if (offsetCheckbox) offsetCheckbox.checked = true;
    }

    if (type === 'transfer') {
      if (offsetGroup) offsetGroup.style.display = 'none';
      if (offsetCheckbox) offsetCheckbox.checked = false;
      toAccGroup.style.display = 'flex';
      catGroup.style.display = 'none';
      fromAccLabel.textContent = '转出出资账户 (扣款)';
      toAccLabel.textContent = '转入收款账户 (入账)';
    } else if (type === 'repayment') {
      if (offsetGroup) offsetGroup.style.display = 'none';
      if (offsetCheckbox) offsetCheckbox.checked = false;
      toAccGroup.style.display = 'flex';
      catGroup.style.display = 'none';
      fromAccLabel.textContent = '还款出资账户 (储蓄卡)';
      toAccLabel.textContent = '目标信用卡 (核销欠款)';
    } else if (type === 'debt_repayment') {
      if (offsetGroup) offsetGroup.style.display = 'none';
      if (offsetCheckbox) offsetCheckbox.checked = false;
      toAccGroup.style.display = 'flex';
      catGroup.style.display = 'none';
      fromAccLabel.textContent = '还款出资账户 (扣款银行卡/钱包)';
      toAccLabel.textContent = '偿还债务目标';
    } else {
      toAccGroup.style.display = 'none';
      catGroup.style.display = 'flex';
      if (offsetGroup) {
        offsetGroup.style.display = 'flex';
        const titleEl = document.getElementById('recOffsetTitle');
        const hintEl = document.getElementById('recOffsetHint');
        if (type === 'expense') {
          if (titleEl) titleEl.textContent = '↩️ 开启支出对冲/退款冲减模式';
          if (hintEl) hintEl.textContent = '将以红字冲减原支出科目，使该分类的实际开销净额下降';
        } else {
          if (titleEl) titleEl.textContent = '↩️ 开启收入对冲/退还扣减模式';
          if (hintEl) hintEl.textContent = '将以借方冲减原收入科目，使该来源的实际收入净额下降';
        }
      }
      this.onOffsetToggle('rec');
      return;
    }

    this.populateRecordSelects();
    this.updatePostingPreview('rec');
  },

  onOffsetToggle(prefix) {
    const isRec = prefix === 'rec';
    const typeEl = document.getElementById(isRec ? 'recType' : 'editTxType');
    if (!typeEl) return;
    const type = typeEl.value;
    const isOffset = Boolean(document.getElementById(isRec ? 'recIsOffset' : 'editTxIsOffset')?.checked);
    const fromAccLabel = document.getElementById(isRec ? 'recAccountLabel' : 'editTxAccountLabel');
    const catLabel = document.getElementById(isRec ? 'recCategoryLabel' : 'editTxCategoryLabel');

    if (type === 'expense') {
      if (fromAccLabel) fromAccLabel.textContent = isOffset ? '退款入账资金账户 (资金增加)' : '扣款出资账户 (资金支出)';
      if (catLabel) catLabel.textContent = isOffset ? '被冲减的支出分类 (红字冲减)' : '支出分类 / 用途';
    } else if (type === 'income') {
      if (fromAccLabel) fromAccLabel.textContent = isOffset ? '扣款出资账户 (资金减少)' : '入账收款账户 (资金增加)';
      if (catLabel) catLabel.textContent = isOffset ? '被冲减的收入分类 (冲减科目)' : '收入分类 / 来源';
    }

    if (isRec) {
      this.populateRecordSelects();
    } else {
      this.populateEditSelects();
    }
    this.updatePostingPreview(prefix);
  },

  updatePostingPreview(prefix) {
    const isRec = prefix === 'rec';
    const typeEl = document.getElementById(isRec ? 'recType' : 'editTxType');
    if (!typeEl) return;
    const type = typeEl.value;
    const isOffset = Boolean(document.getElementById(isRec ? 'recIsOffset' : 'editTxIsOffset')?.checked);
    const amountVal = parseFloat(document.getElementById(isRec ? 'recAmount' : 'editTxAmount')?.value || 0);
    const amtStr = !isNaN(amountVal) && amountVal > 0 ? amountVal.toFixed(2) : '0.00';
    const acc = document.getElementById(isRec ? 'recAccount' : 'editTxAccount')?.value || 'Assets:待选资金账户';
    const toAcc = document.getElementById(isRec ? 'recToAccount' : 'editTxToAccount')?.value || 'Assets:待选目标账户';
    const cat = document.getElementById(isRec ? 'recCategory' : 'editTxCategory')?.value || (type === 'income' ? 'Income:待选分类' : 'Expenses:待选分类');

    const contentEl = document.getElementById(isRec ? 'recPreviewContent' : 'editTxPreviewContent');
    const badgeEl = document.getElementById(isRec ? 'recPreviewBadge' : 'editTxPreviewBadge');
    if (!contentEl) return;

    let p1 = '', p2 = '';
    if (type === 'transfer') {
      p1 = `<span style="color: var(--md-sys-color-primary);">借 (Debit)</span>  : ${escapeHtml(toAcc)} <span style="font-weight: 600; color: #166534;">+${amtStr} CNY</span>`;
      p2 = `<span style="color: var(--md-sys-color-on-surface-variant);">贷 (Credit)</span> : ${escapeHtml(acc)} <span style="font-weight: 600; color: #991b1b;">-${amtStr} CNY</span>`;
    } else if (type === 'repayment' || type === 'debt_repayment') {
      p1 = `<span style="color: var(--md-sys-color-primary);">借 (Debit)</span>  : ${escapeHtml(toAcc)} <span style="font-weight: 600; color: #166534;">+${amtStr} CNY (核销债务)</span>`;
      p2 = `<span style="color: var(--md-sys-color-on-surface-variant);">贷 (Credit)</span> : ${escapeHtml(acc)} <span style="font-weight: 600; color: #991b1b;">-${amtStr} CNY</span>`;
    } else if (type === 'income') {
      if (isOffset) {
        p1 = `<span style="color: #c2410c;">借 (Debit)</span>  : ${escapeHtml(cat)} <span style="font-weight: 600; color: #c2410c;">+${amtStr} CNY (冲减收入)</span>`;
        p2 = `<span style="color: var(--md-sys-color-on-surface-variant);">贷 (Credit)</span> : ${escapeHtml(acc)} <span style="font-weight: 600; color: #991b1b;">-${amtStr} CNY</span>`;
      } else {
        p1 = `<span style="color: var(--md-sys-color-primary);">借 (Debit)</span>  : ${escapeHtml(acc)} <span style="font-weight: 600; color: #166534;">+${amtStr} CNY</span>`;
        p2 = `<span style="color: var(--md-sys-color-on-surface-variant);">贷 (Credit)</span> : ${escapeHtml(cat)} <span style="font-weight: 600; color: #166534;">-${amtStr} CNY</span>`;
      }
    } else {
      // expense
      if (isOffset) {
        p1 = `<span style="color: #0f766e;">借 (Debit)</span>  : ${escapeHtml(acc)} <span style="font-weight: 600; color: #0f766e;">+${amtStr} CNY</span>`;
        p2 = `<span style="color: var(--md-sys-color-on-surface-variant);">贷 (Credit)</span> : ${escapeHtml(cat)} <span style="font-weight: 600; color: #0f766e;">-${amtStr} CNY (红字冲减)</span>`;
      } else {
        p1 = `<span style="color: var(--md-sys-color-primary);">借 (Debit)</span>  : ${escapeHtml(cat)} <span style="font-weight: 600; color: #991b1b;">+${amtStr} CNY</span>`;
        p2 = `<span style="color: var(--md-sys-color-on-surface-variant);">贷 (Credit)</span> : ${escapeHtml(acc)} <span style="font-weight: 600; color: #991b1b;">-${amtStr} CNY</span>`;
      }
    }

    contentEl.innerHTML = `<div>${p1}</div><div>${p2}</div>`;
    if (badgeEl) {
      badgeEl.textContent = isOffset ? '红字对冲平衡' : '复式借贷平衡';
    }
  },

  populateRecordSelects() {
    const type = document.getElementById('recType').value;
    const accSelect = document.getElementById('recAccount');
    const toAccSelect = document.getElementById('recToAccount');
    const catSelect = document.getElementById('recCategory');

    const activeAccs = State.getActiveAccounts();

    // 填充出资账户
    if (accSelect) {
      const curAcc = accSelect.value;
      accSelect.innerHTML = activeAccs.map(a => {
        const bal = Number(a.current_balance !== undefined ? a.current_balance : (a.balance || 0));
        return `
          <option value="${a.account}" ${a.account === curAcc ? 'selected' : ''}>${a.name}${a.card_tail ? ` (${a.card_tail})` : ''} - 当前: ¥${bal.toFixed(2)}</option>
        `;
      }).join('');
    }

    // 填充目标账户
    if (toAccSelect) {
      if (type === 'debt_repayment') {
        toAccSelect.innerHTML = State.debts.map(d => `
          <option value="${d.account}">${d.name} (待还: ¥${Number(d.current_balance || 0).toFixed(2)})</option>
        `).join('');
      } else if (type === 'repayment') {
        toAccSelect.innerHTML = activeAccs.filter(a => a.type === 'credit').map(a => `
          <option value="${a.account}">${a.name}${a.card_tail ? ` (${a.card_tail})` : ''}</option>
        `).join('');
      } else {
        toAccSelect.innerHTML = activeAccs.map(a => `
          <option value="${a.account}">${a.name}${a.card_tail ? ` (${a.card_tail})` : ''}</option>
        `).join('');
      }
    }

    // 填充分类 (收入对冲依然显示收入分类，支出对冲依然显示支出分类)
    if (catSelect) {
      const isIncome = type === 'income';
      const cats = State.categories.filter(c => !c.is_archived && (isIncome ? c.type === 'income' : c.type === 'expense'));
      const curCat = catSelect.value;
      catSelect.innerHTML = cats.map(c => `
        <option value="${c.account}" ${c.account === curCat ? 'selected' : ''}>${this.getCategoryIcon(c.icon)} ${c.name}</option>
      `).join('');
    }
  },

  openAddCategoryModal(callerModal) {
    let catType = 'expense';
    if (callerModal === 'recordModal') {
      const recType = document.getElementById('recType') ? document.getElementById('recType').value : 'expense';
      catType = recType === 'income' ? 'income' : 'expense';
    } else if (callerModal === 'editTxModal') {
      const editType = document.getElementById('editTxType') ? document.getElementById('editTxType').value : 'expense';
      catType = editType === 'income' ? 'income' : 'expense';
    }
    SettingsView.openAddCategoryModal(callerModal, catType);
  },

  async requestAISuggestion() {
    const payee = document.getElementById('recPayee').value.trim();
    const narration = document.getElementById('recNarration').value.trim();
    const amount = document.getElementById('recAmount').value;

    if (!payee && !narration) {
      Toast.warning('请先填写商户或描述再请求 AI 建议');
      return;
    }

    try {
      Toast.info('正在请求 AI 建议分类...');
      const res = await API.getAISuggestion(payee, narration, amount);
      if (res && res.suggested_category) {
        const catSelect = document.getElementById('recCategory');
        if (catSelect) {
          catSelect.value = res.suggested_category;
        }
        Toast.success(`AI 推荐分类: ${res.suggested_category} (置信度: ${res.confidence || '高'})`);
      } else {
        Toast.info('AI 未返回合适分类，请手动选择');
      }
    } catch (e) {
      Toast.error(`AI 建议失败: ${e.message}`);
    }
  },

  async submitRecord() {
    const type = document.getElementById('recType').value;
    const date = document.getElementById('recDate').value;
    const payee = document.getElementById('recPayee').value.trim() || '日常消费';
    const narration = document.getElementById('recNarration').value.trim();
    const amount = parseFloat(document.getElementById('recAmount').value);
    const account = document.getElementById('recAccount').value;
    const toAccount = document.getElementById('recToAccount').value;
    const category = document.getElementById('recCategory').value;

    if (!date || isNaN(amount) || amount <= 0 || !account) {
      Toast.warning('请填写有效的日期、正数金额与资金账户！');
      return;
    }

    const isOffset = (type === 'expense' || type === 'income') && Boolean(document.getElementById('recIsOffset')?.checked);

    const payload = {
      type,
      date,
      payee,
      narration,
      amount,
      account,
      category,
      to_account: toAccount,
      is_offset: isOffset
    };

    try {
      const res = await API.createTransaction(payload);
      Toast.success(res.message || '记账成功！已成功录入 Beancount 账本');
      Dialog.close('recordModal');
      await App.refreshData();
    } catch (err) {
      Toast.error(`记账失败: ${err.message}`);
    }
  },

  // ------------------------------------------------------------------------
  // 编辑与删除流水
  // ------------------------------------------------------------------------
  openEditModal(txJsonStr) {
    const tx = typeof txJsonStr === 'string' ? JSON.parse(txJsonStr) : txJsonStr;
    document.getElementById('editTxId').value = tx.id;
    document.getElementById('editTxDate').value = tx.date;
    document.getElementById('editTxPayee').value = tx.payee || '';
    document.getElementById('editTxNarration').value = tx.narration || '';
    document.getElementById('editTxAmount').value = tx.amount ? Number(tx.amount).toFixed(2) : '0.00';

    // 智能识别交易类型
    let txType = tx.type || 'expense';
    const isOffset = Boolean(tx.is_offset);
    if (!tx.type) {
      if (tx.category && tx.category.startsWith('Income:')) txType = 'income';
      else if (tx.category && tx.category.startsWith('Liabilities:CreditCard:')) txType = 'repayment';
      else if (tx.category && tx.category.startsWith('Liabilities:Loan:')) txType = 'debt_repayment';
      else if (tx.account && tx.category && tx.account.startsWith('Assets:') && tx.category.startsWith('Assets:')) txType = 'transfer';
      else txType = 'expense';
    }

    const typeSelect = document.getElementById('editTxType');
    if (typeSelect) {
      typeSelect.value = txType;
    }
    const offsetCheckbox = document.getElementById('editTxIsOffset');
    if (offsetCheckbox) {
      offsetCheckbox.checked = isOffset;
    }

    // 确定选中的账户与分类
    const selectedFromAcc = tx.account;
    const selectedToAcc = tx.category;
    const selectedCat = tx.category;

    this.toggleEditFields(selectedFromAcc, selectedToAcc, selectedCat);
    this.updatePostingPreview('editTx');
    Dialog.open('editTxModal');
  },

  toggleEditFields(selectedFromAcc, selectedToAcc, selectedCat) {
    const type = document.getElementById('editTxType').value;
    const toAccGroup = document.getElementById('editTxToAccountGroup');
    const catGroup = document.getElementById('editTxCategoryGroup');
    const offsetGroup = document.getElementById('editTxOffsetGroup');
    const offsetCheckbox = document.getElementById('editTxIsOffset');
    const toAccLabel = document.getElementById('editTxToAccountLabel');
    const fromAccLabel = document.getElementById('editTxAccountLabel');
    const catLabel = document.getElementById('editTxCategoryLabel');

    if (type === 'transfer') {
      if (offsetGroup) offsetGroup.style.display = 'none';
      if (offsetCheckbox) offsetCheckbox.checked = false;
      toAccGroup.style.display = 'flex';
      catGroup.style.display = 'none';
      fromAccLabel.textContent = '转出出资账户 (扣款)';
      toAccLabel.textContent = '转入收款账户 (入账)';
    } else if (type === 'repayment') {
      if (offsetGroup) offsetGroup.style.display = 'none';
      if (offsetCheckbox) offsetCheckbox.checked = false;
      toAccGroup.style.display = 'flex';
      catGroup.style.display = 'none';
      fromAccLabel.textContent = '还款出资账户 (储蓄卡)';
      toAccLabel.textContent = '目标信用卡 (核销欠款)';
    } else if (type === 'debt_repayment') {
      if (offsetGroup) offsetGroup.style.display = 'none';
      if (offsetCheckbox) offsetCheckbox.checked = false;
      toAccGroup.style.display = 'flex';
      catGroup.style.display = 'none';
      fromAccLabel.textContent = '还款出资账户 (扣款银行卡/钱包)';
      toAccLabel.textContent = '偿还债务目标';
    } else {
      toAccGroup.style.display = 'none';
      catGroup.style.display = 'flex';
      if (offsetGroup) {
        offsetGroup.style.display = 'flex';
        const titleEl = document.getElementById('editTxOffsetTitle');
        const hintEl = document.getElementById('editTxOffsetHint');
        if (type === 'expense') {
          if (titleEl) titleEl.textContent = '↩️ 开启支出对冲/退款冲减模式';
          if (hintEl) hintEl.textContent = '将以红字冲减原支出科目，使该分类的实际开销净额下降';
        } else {
          if (titleEl) titleEl.textContent = '↩️ 开启收入对冲/退还扣减模式';
          if (hintEl) hintEl.textContent = '将以借方冲减原收入科目，使该来源的实际收入净额下降';
        }
      }
      this.onOffsetToggle('editTx');
      this.populateEditSelects(selectedFromAcc, selectedToAcc, selectedCat);
      this.updatePostingPreview('editTx');
      return;
    }

    this.populateEditSelects(selectedFromAcc, selectedToAcc, selectedCat);
    this.updatePostingPreview('editTx');
  },

  populateEditSelects(selectedFromAcc, selectedToAcc, selectedCat) {
    const type = document.getElementById('editTxType').value;
    const accSelect = document.getElementById('editTxAccount');
    const toAccSelect = document.getElementById('editTxToAccount');
    const catSelect = document.getElementById('editTxCategory');

    const activeAccs = State.getActiveAccounts();
    const curFromVal = selectedFromAcc || (accSelect ? accSelect.value : '');
    const curToVal = selectedToAcc || (toAccSelect ? toAccSelect.value : '');
    const curCatVal = selectedCat || (catSelect ? catSelect.value : '');

    // 1. 填充出资/入账主资金账户
    if (accSelect) {
      let accHtml = activeAccs.map(a => `
        <option value="${a.account}" ${a.account === curFromVal ? 'selected' : ''}>
          ${a.name}${a.card_tail ? ` (${a.card_tail})` : ''}
        </option>
      `).join('');
      if (curFromVal && !activeAccs.some(a => a.account === curFromVal)) {
        accHtml += `<option value="${curFromVal}" selected>${curFromVal}</option>`;
      }
      accSelect.innerHTML = accHtml;
    }

    // 2. 填充目标账户 (转入账户 / 还款卡 / 债务)
    if (toAccSelect) {
      let toHtml = '';
      if (type === 'debt_repayment') {
        toHtml = State.debts.map(d => `
          <option value="${d.account}" ${d.account === curToVal ? 'selected' : ''}>${d.name} (待还: ¥${Number(d.current_balance || 0).toFixed(2)})</option>
        `).join('');
      } else if (type === 'repayment') {
        toHtml = activeAccs.filter(a => a.type === 'credit').map(a => `
          <option value="${a.account}" ${a.account === curToVal ? 'selected' : ''}>${a.name}${a.card_tail ? ` (${a.card_tail})` : ''}</option>
        `).join('');
      } else {
        // transfer
        toHtml = activeAccs.map(a => `
          <option value="${a.account}" ${a.account === curToVal ? 'selected' : ''}>${a.name}${a.card_tail ? ` (${a.card_tail})` : ''}</option>
        `).join('');
      }
      if (curToVal && !toHtml.includes(`value="${curToVal}"`)) {
        toHtml += `<option value="${curToVal}" selected>${curToVal}</option>`;
      }
      toAccSelect.innerHTML = toHtml;
    }

    // 3. 填充分类
    if (catSelect) {
      const isIncome = type === 'income';
      const cats = State.categories.filter(c => !c.is_archived && (isIncome ? c.type === 'income' : c.type === 'expense'));
      let catHtml = cats.map(c => `
        <option value="${c.account}" ${c.account === curCatVal ? 'selected' : ''}>${this.getCategoryIcon(c.icon)} ${c.name}</option>
      `).join('');
      if (curCatVal && !cats.some(c => c.account === curCatVal)) {
        catHtml = `<option value="${curCatVal}" selected>🏷️ ${curCatVal.replace('Income:', '').replace('Expenses:', '')}</option>` + catHtml;
      }
      catSelect.innerHTML = catHtml;
    }
  },

  async submitEdit() {
    const txId = document.getElementById('editTxId').value;
    const type = document.getElementById('editTxType').value;
    const date = document.getElementById('editTxDate').value;
    const payee = document.getElementById('editTxPayee').value.trim();
    const narration = document.getElementById('editTxNarration').value.trim();
    const amount = parseFloat(document.getElementById('editTxAmount').value);
    const account = document.getElementById('editTxAccount').value;
    const toAccount = document.getElementById('editTxToAccount') ? document.getElementById('editTxToAccount').value : null;
    const category = document.getElementById('editTxCategory') ? document.getElementById('editTxCategory').value : null;
    const rememberRule = document.getElementById('editTxRememberRule').checked;
    const isOffset = (type === 'expense' || type === 'income') && Boolean(document.getElementById('editTxIsOffset')?.checked);

    if (!date || isNaN(amount) || amount <= 0 || !account) {
      Toast.warning('请填写有效的日期、正数金额与资金账户！');
      return;
    }

    if (type === 'transfer') {
      if (!toAccount) {
        Toast.warning('内部转账必须选择转入目标账户！');
        return;
      }
      if (account === toAccount) {
        Toast.warning('转出账户与转入账户不能相同！');
        return;
      }
    } else if (type === 'repayment' || type === 'debt_repayment') {
      if (!toAccount) {
        Toast.warning('还款必须选择目标信用卡或债务！');
        return;
      }
    } else {
      if (!category) {
        Toast.warning('请选择账单分类！');
        return;
      }
    }

    try {
      await API.updateTransaction(txId, {
        type,
        date,
        payee,
        narration,
        amount,
        account,
        from_account: account,
        to_account: toAccount,
        category,
        is_offset: isOffset,
        remember_rule: rememberRule
      });
      Toast.success('流水修改成功！账本已同步更新');
      Dialog.close('editTxModal');
      await App.refreshData();
    } catch (e) {
      Toast.error(`修改失败: ${e.message}`);
    }
  },

  async deleteTx(txId) {
    const ok = await Dialog.confirm({
      title: '删除流水确认',
      message: '确定要删除这条账目流水吗？删除后将从 Beancount 账本中永久抹去相应借贷分录。',
      confirmText: '确认删除',
      isDanger: true
    });
    if (!ok) return;

    try {
      await API.deleteTransaction(txId);
      Toast.success('流水删除成功！');
      await App.refreshData();
    } catch (e) {
      Toast.error(`删除失败: ${e.message}`);
    }
  }
};

window.TransactionsView = TransactionsView;
