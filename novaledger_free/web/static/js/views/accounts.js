/**
 * Accounts & Debts View Controller (资产与债务)
 * 处理资金账户、已归档专区、债务借款进度、对账校准
 */

const AccountsView = {
  isArchivedExpanded: false,
  isDebtsExpanded: true,

  init() {
    this.bindEvents();
  },

  bindEvents() {
    // 监听视图筛选或搜索
  },

  toggleArchivedSection() {
    this.isArchivedExpanded = !this.isArchivedExpanded;
    const body = document.getElementById('archivedAccountsBody');
    const arrow = document.getElementById('archivedArrow');
    if (body) {
      body.style.display = this.isArchivedExpanded ? 'block' : 'none';
    }
    if (arrow) {
      arrow.textContent = this.isArchivedExpanded ? '▼' : '▶';
    }
  },

  toggleDebtsSection() {
    this.isDebtsExpanded = !this.isDebtsExpanded;
    const body = document.getElementById('debtsBody');
    const arrow = document.getElementById('debtsArrow');
    if (body) {
      body.style.display = this.isDebtsExpanded ? 'block' : 'none';
    }
    if (arrow) {
      arrow.textContent = this.isDebtsExpanded ? '▼' : '▶';
    }
  },

  render() {
    this.renderSummaryMetrics();
    this.renderActiveAccounts();
    this.renderArchivedAccounts();
    this.renderDebts();
  },

  renderSummaryMetrics() {
    const activeAccs = State.getActiveAccounts();
    let totalAssets = 0;
    let totalLiabilities = 0;

    activeAccs.forEach(a => {
      const bal = Number(a.current_balance !== undefined ? a.current_balance : (a.balance || 0));
      if (a.type === 'credit') {
        if (bal < 0) totalLiabilities += Math.abs(bal);
      } else {
        if (bal >= 0) totalAssets += bal;
        else totalLiabilities += Math.abs(bal);
      }
    });

    // 加上债务待还总额
    State.debts.forEach(d => {
      totalLiabilities += Number(d.current_balance || 0);
    });

    const netWorth = totalAssets - totalLiabilities;

    const elAssets = document.getElementById('metricTotalAssets');
    const elLiab = document.getElementById('metricTotalLiabilities');
    const elNet = document.getElementById('metricNetWorth');

    if (elAssets) elAssets.textContent = `¥${totalAssets.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (elLiab) elLiab.textContent = `¥${totalLiabilities.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (elNet) {
      elNet.textContent = `¥${netWorth.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      elNet.style.color = netWorth >= 0 ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-error)';
    }
  },

  renderActiveAccounts() {
    const container = document.getElementById('activeAccountsList');
    if (!container) return;

    const activeAccs = State.getActiveAccounts();
    const countTag = document.getElementById('activeAccountsCount');
    if (countTag) countTag.textContent = `${activeAccs.length} 个活跃账户`;

    if (activeAccs.length === 0) {
      container.innerHTML = `
        <div style="padding: 30px; text-align: center; color: var(--md-sys-color-on-surface-variant);">
          暂无活跃资金账户，点击上方「＋ 添加资金账户」即可新建
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="m3-table-wrapper">
        <table class="m3-table">
          <thead>
            <tr>
              <th>账户名称</th>
              <th>账户类型</th>
              <th>卡尾号</th>
              <th>Beancount 科目</th>
              <th style="text-align: right;">当前余额</th>
              <th style="text-align: right;">操作</th>
            </tr>
          </thead>
          <tbody>
            ${activeAccs.map(a => {
              const safeAcc = encodeURIComponent(JSON.stringify(a));
              const bal = Number(a.current_balance !== undefined ? a.current_balance : (a.balance || 0));
              return `
                <tr>
                  <td style="font-weight: 600;">${a.name}</td>
                  <td><span class="m3-chip" style="height: 24px; font-size: 11px;">${this.getAccTypeLabel(a.type)}</span></td>
                  <td style="font-family: var(--md-sys-typescale-font-family-code);">${a.card_tail || '-'}</td>
                  <td style="font-family: var(--md-sys-typescale-font-family-code); color: var(--md-sys-color-on-surface-variant); font-size: 12px;">${a.account}</td>
                  <td class="amount-display" style="text-align: right; color: ${bal >= 0 ? 'var(--md-sys-color-on-surface)' : 'var(--md-sys-color-error)'}; font-size: 15px;">
                    ¥${bal.toFixed(2)}
                  </td>
                  <td style="text-align: right; white-space: nowrap;">
                    <button class="m3-btn btn-text btn-sm" onclick="AccountsView.openEditAccountModal(decodeURIComponent('${safeAcc}'))">编辑</button>
                    <button class="m3-btn btn-text btn-sm" onclick="AccountsView.archiveAccount('${a.id}')">📦 归档</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  renderArchivedAccounts() {
    const container = document.getElementById('archivedAccountsList');
    if (!container) return;

    const archived = State.getArchivedAccounts();
    const countTag = document.getElementById('archivedAccountsCount');
    if (countTag) countTag.textContent = `${archived.length} 个已归档`;

    if (archived.length === 0) {
      container.innerHTML = `
        <div style="padding: 20px; text-align: center; color: var(--md-sys-color-on-surface-variant); font-size: 13px;">
          暂无已归档账户
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="m3-table-wrapper">
        <table class="m3-table">
          <thead>
            <tr>
              <th>账户名称</th>
              <th>卡尾号</th>
              <th>对应科目</th>
              <th style="text-align: right;">结存余额</th>
              <th style="text-align: right;">操作</th>
            </tr>
          </thead>
          <tbody>
            ${archived.map(a => {
              const bal = Number(a.current_balance !== undefined ? a.current_balance : (a.balance || 0));
              return `
              <tr style="opacity: 0.75;">
                <td>${a.name} <span class="m3-badge badge-archived">已停用</span></td>
                <td style="font-family: var(--md-sys-typescale-font-family-code);">${a.card_tail || '-'}</td>
                <td style="font-size: 12px; color: var(--md-sys-color-on-surface-variant);">${a.account}</td>
                <td class="amount-display" style="text-align: right;">¥${bal.toFixed(2)}</td>
                <td style="text-align: right;">
                  <button class="m3-btn btn-text btn-sm" onclick="AccountsView.unarchiveAccount('${a.id}')">↩️ 恢复启用</button>
                </td>
              </tr>
            `;}).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  renderDebts() {
    const container = document.getElementById('debtsGrid');
    if (!container) return;

    const debts = State.debts;
    const countTag = document.getElementById('debtsCount');
    if (countTag) countTag.textContent = `${debts.length} 笔在册债务`;

    if (debts.length === 0) {
      container.innerHTML = `
        <div style="padding: 30px; text-align: center; color: var(--md-sys-color-on-surface-variant);">
          暂无在册个人借款或债务
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px;">
        ${debts.map(d => {
          const initAmt = Number(d.initial_amount || 0);
          const currBal = Number(d.current_balance || 0);
          const repaidAmt = Math.max(0, initAmt - currBal);
          const progress = initAmt > 0 ? Math.min(100, Math.round((repaidAmt / initAmt) * 100)) : 0;
          const safeDebt = encodeURIComponent(JSON.stringify(d));

          return `
            <div class="m3-card elevated" style="position: relative;">
              <div class="card-header" style="margin-bottom: 8px;">
                <div>
                  <div class="card-title" style="font-size: 16px;">📉 ${d.name}</div>
                  <div class="card-subtitle">科目: ${d.account}</div>
                </div>
                <span class="m3-chip" style="height: 24px; font-size: 11px;">${d.type === 'lump_sum' ? '一次性本息' : '按月等额'}</span>
              </div>

              <div style="margin: 12px 0;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                  <span style="font-size: 12px; color: var(--md-sys-color-on-surface-variant);">当前待还余额</span>
                  <span class="amount-display amount-expense" style="font-size: 18px;">¥${currBal.toFixed(2)}</span>
                </div>
                <div class="m3-linear-progress" style="margin: 8px 0;">
                  <div class="bar" style="width: ${progress}%; background-color: var(--md-sys-color-success);"></div>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--md-sys-color-on-surface-variant);">
                  <span>已还: ¥${repaidAmt.toFixed(2)} (${progress}%)</span>
                  <span>初始本金: ¥${initAmt.toFixed(2)}</span>
                </div>
              </div>

              <div style="background: var(--md-sys-color-surface-container); border-radius: var(--md-shape-sm); padding: 8px 12px; font-size: 12px; margin-bottom: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                <div>每月应还: <b>¥${Number(d.monthly_payment || 0).toFixed(2)}</b></div>
                <div>总期数: <b>${d.total_periods ? `${d.total_periods} 期` : '长期'}</b></div>
                <div style="grid-column: 1 / -1; color: var(--md-sys-color-on-surface-variant);">备注: ${d.note || '无'}</div>
              </div>

              <div style="display: flex; justify-content: flex-end; gap: 8px;">
                <button class="m3-btn btn-text btn-sm" onclick="AccountsView.quickRepay('${d.account}', '${d.name}', ${currBal})">⚡ 快速还款</button>
                <button class="m3-btn btn-text btn-sm" onclick="AccountsView.openEditDebtModal(decodeURIComponent('${safeDebt}'))">编辑</button>
                <button class="m3-btn btn-text btn-sm" style="color: var(--md-sys-color-error);" onclick="AccountsView.deleteDebt('${d.id}')">删除</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  },

  getAccTypeLabel(type) {
    const map = {
      debit: '💳 储蓄卡',
      credit: '💳 信用卡',
      cash: '💵 现金钱包',
      e_wallet: '📱 电子钱包',
      investment: '📈 证券投资'
    };
    return map[type] || type;
  },

  // ------------------------------------------------------------------------
  // 账户增删改与归档
  // ------------------------------------------------------------------------
  openAddAccountModal() {
    document.getElementById('addAccForm').reset();
    Dialog.open('addAccountModal');
  },

  async submitAddAccount() {
    const id = document.getElementById('addAccId').value.trim();
    const name = document.getElementById('addAccName').value.trim();
    const type = document.getElementById('addAccType').value;
    const subName = document.getElementById('addAccSubName').value.trim() || id;
    const initialBalance = parseFloat(document.getElementById('addAccInitialBalance').value || '0');

    if (!id || !name || !type) {
      Toast.warning('请填写必填的账户标识、名称和类型！');
      return;
    }

    try {
      await API.createAccount({ id, name, type, sub_name: subName, initial_balance: initialBalance });
      Toast.success('资金账户创建成功！');
      Dialog.close('addAccountModal');
      await App.refreshData();
    } catch (e) {
      Toast.error(`创建失败: ${e.message}`);
    }
  },

  openEditAccountModal(accJson) {
    const acc = typeof accJson === 'string' ? JSON.parse(accJson) : accJson;
    document.getElementById('editAccId').value = acc.id;
    document.getElementById('editAccName').value = acc.name;
    document.getElementById('editAccTail').value = acc.card_tail || '';
    document.getElementById('editAccType').value = acc.type || 'debit';
    document.getElementById('editAccArchived').checked = !!acc.is_archived;
    Dialog.open('editAccountModal');
  },

  async submitEditAccount() {
    const id = document.getElementById('editAccId').value;
    const name = document.getElementById('editAccName').value.trim();
    const cardTail = document.getElementById('editAccTail').value.trim();
    const type = document.getElementById('editAccType').value;
    const isArchived = document.getElementById('editAccArchived').checked;

    try {
      await API.updateAccount(id, { name, card_tail: cardTail, type, is_archived: isArchived });
      Toast.success('账户信息修改成功！');
      Dialog.close('editAccountModal');
      await App.refreshData();
    } catch (e) {
      Toast.error(`修改失败: ${e.message}`);
    }
  },

  async archiveAccount(accId) {
    const ok = await Dialog.confirm({
      title: '归档资金账户确认',
      message: '确定要将该账户移入「📁 已归档资金账户」专区吗？日常记账选择器中将隐藏该账户，但不影响历史已入账分录。',
      confirmText: '确认归档'
    });
    if (!ok) return;

    try {
      await API.updateAccount(accId, { is_archived: true });
      Toast.success('账户已归档并移入下方专区！');
      await App.refreshData();
    } catch (e) {
      Toast.error(`归档失败: ${e.message}`);
    }
  },

  async unarchiveAccount(accId) {
    try {
      await API.updateAccount(accId, { is_archived: false });
      Toast.success('账户已成功恢复启用！');
      await App.refreshData();
    } catch (e) {
      Toast.error(`恢复失败: ${e.message}`);
    }
  },

  // ------------------------------------------------------------------------
  // 债务增删改与还款跳转
  // ------------------------------------------------------------------------
  openAddDebtModal() {
    document.getElementById('addDebtForm').reset();
    Dialog.open('addDebtModal');
  },

  async submitAddDebt() {
    const name = document.getElementById('addDebtName').value.trim();
    const initialAmount = parseFloat(document.getElementById('addDebtInitialAmount').value);
    const type = document.getElementById('addDebtType').value;
    const monthlyPayment = parseFloat(document.getElementById('addDebtMonthlyPayment').value || '0');
    const totalPeriods = parseInt(document.getElementById('addDebtTotalPeriods').value || '0', 10);
    const dueDate = document.getElementById('addDebtDueDate').value;
    const note = document.getElementById('addDebtNote').value.trim();

    if (!name || isNaN(initialAmount) || initialAmount <= 0) {
      Toast.warning('请填写债务名称及有效的初始本金！');
      return;
    }

    try {
      await API.createDebt({
        name, initial_amount: initialAmount, type,
        monthly_payment: monthlyPayment, total_periods: totalPeriods,
        due_date: dueDate, note
      });
      Toast.success('债务已成功登记入 Beancount 账本！');
      Dialog.close('addDebtModal');
      await App.refreshData();
    } catch (e) {
      Toast.error(`登记失败: ${e.message}`);
    }
  },

  openEditDebtModal(debtJson) {
    const d = typeof debtJson === 'string' ? JSON.parse(debtJson) : debtJson;
    document.getElementById('editDebtId').value = d.id;
    document.getElementById('editDebtName').value = d.name;
    document.getElementById('editDebtType').value = d.type || 'monthly';
    document.getElementById('editDebtInitialAmount').value = d.initial_amount || 0;
    document.getElementById('editDebtMonthlyPayment').value = d.monthly_payment || 0;
    document.getElementById('editDebtTotalPeriods').value = d.total_periods || '';
    document.getElementById('editDebtDueDate').value = d.due_date || '';
    document.getElementById('editDebtNote').value = d.note || '';
    Dialog.open('editDebtModal');
  },

  async submitEditDebt() {
    const id = document.getElementById('editDebtId').value;
    const name = document.getElementById('editDebtName').value.trim();
    const type = document.getElementById('editDebtType').value;
    const initialAmount = parseFloat(document.getElementById('editDebtInitialAmount').value || '0');
    const monthlyPayment = parseFloat(document.getElementById('editDebtMonthlyPayment').value || '0');
    const totalPeriods = parseInt(document.getElementById('editDebtTotalPeriods').value || '0', 10);
    const dueDate = document.getElementById('editDebtDueDate').value;
    const note = document.getElementById('editDebtNote').value.trim();

    try {
      await API.updateDebt(id, {
        name, type, initial_amount: initialAmount,
        monthly_payment: monthlyPayment, total_periods: totalPeriods,
        due_date: dueDate, note
      });
      Toast.success('债务信息更新成功！');
      Dialog.close('editDebtModal');
      await App.refreshData();
    } catch (e) {
      Toast.error(`更新失败: ${e.message}`);
    }
  },

  async deleteDebt(debtId) {
    const ok = await Dialog.confirm({
      title: '删除债务确认',
      message: '确定要删除此债务登记吗？',
      confirmText: '确认删除',
      isDanger: true
    });
    if (!ok) return;

    try {
      await API.deleteDebt(debtId);
      Toast.success('债务登记已删除！');
      await App.refreshData();
    } catch (e) {
      Toast.error(`删除失败: ${e.message}`);
    }
  },

  quickRepay(debtAccount, debtName, currentBalance) {
    TransactionsView.openRecordModal();
    document.getElementById('recType').value = 'debt_repayment';
    TransactionsView.toggleRecordFields();
    document.getElementById('recToAccount').value = debtAccount;
    document.getElementById('recPayee').value = `偿还借款: ${debtName}`;
  }
};

window.AccountsView = AccountsView;
