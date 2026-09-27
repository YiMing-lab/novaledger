/**
 * Analytics View Controller (报表与财务分析)
 * 支出深度统计（分类下钻 + 日度横向分布）、商户多维分析、资产与趋势多线分析、CFP 专业财务分析与 AI 洞察
 */

const AnalyticsView = {
  currentTab: 'expense', // 'expense', 'merchants', 'trends', 'cfp', 'ai'
  expandedCategories: new Set(),
  dailyExpenseMode: 'all', // 'all', 'active'
  merchantSearchKeyword: '',
  merchantSortBy: 'amount', // 'amount', 'count', 'avg'
  assetTrendMode: 'monthly', // 'monthly', 'daily'
  hiddenAccounts: new Set(),

  init() {
    this.bindEvents();
  },

  getWeekday(dateStr) {
    if (!dateStr) return '';
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const d = new Date(dateStr + 'T00:00:00');
    return isNaN(d.getDay()) ? '' : days[d.getDay()];
  },

  bindEvents() {
    // 切换子选项卡
    document.querySelectorAll('#analyticsSubTabs .m3-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.dataset.tab;
        this.switchTab(tab);
      });
    });

    const monthSelect = document.getElementById('analyticsMonthPicker');
    if (monthSelect) {
      monthSelect.addEventListener('change', async (e) => {
        State.currentMonth = e.target.value;
        await this.loadMonthData(State.currentMonth);
      });
    }
  },

  switchTab(tab) {
    this.currentTab = tab;
    document.querySelectorAll('#analyticsSubTabs .m3-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    ['expenseTab', 'merchantsTab', 'trendsTab', 'cfpTab', 'aiTab'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

    const activeEl = document.getElementById(`${tab}Tab`);
    if (activeEl) activeEl.style.display = 'block';

    if (tab === 'expense') {
      this.renderExpenseBreakdown();
      this.renderDailyExpenses();
    } else if (tab === 'merchants') {
      this.renderMerchants();
    } else if (tab === 'trends') {
      this.renderAssetTrends();
      this.renderTrends();
    } else if (tab === 'cfp') {
      this.renderCFP();
    }
  },

  async loadMonthData(month) {
    try {
      const [rep, trends] = await Promise.all([
        API.getReports(month).catch(() => null),
        API.getTrends().catch(() => null)
      ]);
      State.reports = rep;
      if (trends) State.trends = trends;
      this.render();
    } catch (e) {
      console.error('加载月度报表失败:', e);
    }
  },

  render() {
    const picker = document.getElementById('analyticsMonthPicker');
    if (picker && !picker.value) {
      picker.value = State.currentMonth;
    }

    if (!State.reports) {
      this.loadMonthData(State.currentMonth);
      return;
    }

    if (this.currentTab === 'expense') {
      this.renderExpenseBreakdown();
      this.renderDailyExpenses();
    } else if (this.currentTab === 'merchants') {
      this.renderMerchants();
    } else if (this.currentTab === 'trends') {
      this.renderAssetTrends();
      this.renderTrends();
    } else if (this.currentTab === 'cfp') {
      this.renderCFP();
    }
  },

  renderCurrentMonth() {
    if (this.currentTab === 'expense') {
      this.renderExpenseBreakdown();
      this.renderDailyExpenses();
    } else if (this.currentTab === 'merchants') {
      this.renderMerchants();
    } else if (this.currentTab === 'trends') {
      this.renderAssetTrends();
      this.renderTrends();
    } else if (this.currentTab === 'cfp') {
      this.renderCFP();
    }
  },

  // --------------------------------------------------------------------------
  // 1. 分类支出与下钻展开 (Category Breakdown & Drilldown)
  // --------------------------------------------------------------------------
  toggleCategoryDrilldown(catAcc, event) {
    if (event) event.stopPropagation();
    if (this.expandedCategories.has(catAcc)) {
      this.expandedCategories.delete(catAcc);
    } else {
      this.expandedCategories.add(catAcc);
    }
    this.renderExpenseBreakdown();
  },

  renderExpenseBreakdown() {
    if (!State.reports) return;
    const rep = State.reports;
    const totalExp = Number(rep.income_statement?.total_expenses || (rep.expenses && rep.expenses.total) || 0);

    const catRanking = rep.category_ranking || (rep.expenses && rep.expenses.breakdown) || [];
    const chartItems = catRanking.map(item => {
      const catAcc = item.category || item.name || '';
      const catObj = (State.categories || []).find(c => c.account === catAcc);
      const friendlyName = catObj ? catObj.name : (item.name || catAcc.replace('Expenses:', ''));
      const icon = State.getCategoryIcon(catObj ? catObj.icon : catAcc);
      const amt = Number(item.amount || 0);
      const pct = item.percentage !== undefined ? Number(item.percentage) : (totalExp > 0 ? (amt / totalExp * 100) : 0);
      return {
        name: `${icon} ${friendlyName}`,
        category: catAcc,
        amount: amt,
        percentage: pct
      };
    });

    Charts.renderDonut('expenseDonutContainer', chartItems, totalExp);

    // 渲染排行榜表格 (支持点开下钻展开商户)
    const tableBody = document.getElementById('expenseRankTableBody');
    if (tableBody) {
      if (catRanking.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--md-sys-color-on-surface-variant); padding: 20px;">本月暂无分类支出明细</td></tr>`;
      } else {
        const rowsHtml = [];
        catRanking.forEach((item, idx) => {
          const catAcc = item.category || item.name || '';
          const catObj = (State.categories || []).find(c => c.account === catAcc);
          const friendlyName = catObj ? catObj.name : (item.name || catAcc.replace('Expenses:', ''));
          const icon = State.getCategoryIcon(catObj ? catObj.icon : catAcc);
          const amt = Number(item.amount || 0);
          const pct = item.percentage !== undefined ? Number(item.percentage).toFixed(1) : (totalExp > 0 ? (amt / totalExp * 100).toFixed(1) : '0.0');
          const merchants = item.merchants || [];
          const isExpanded = this.expandedCategories.has(catAcc);

          // 主分类行
          rowsHtml.push(`
            <tr style="cursor: pointer;" onclick="AnalyticsView.toggleCategoryDrilldown('${escapeHtml(catAcc)}')">
              <td style="font-weight: 600; width: 40px;">
                <span class="drilldown-arrow ${isExpanded ? 'expanded' : ''}">▶</span>${idx + 1}
              </td>
              <td style="font-weight: 500;">
                <span>${icon} ${escapeHtml(friendlyName)}</span>
                ${merchants.length > 0 ? `<span class="m3-chip" style="font-size: 10px; height: 18px; margin-left: 6px; padding: 0 6px; vertical-align: middle;">${merchants.length}商户</span>` : ''}
              </td>
              <td style="width: 120px;">
                <div style="background: var(--md-sys-color-surface-container-highest); height: 6px; border-radius: 3px; overflow: hidden;">
                  <div style="width: ${pct}%; height: 100%; background: var(--md-sys-color-primary); border-radius: 3px;"></div>
                </div>
              </td>
              <td class="amount-display amount-expense" style="text-align: right; white-space: nowrap;">
                ¥${amt.toFixed(2)} <span style="font-size: 11px; color: var(--md-sys-color-on-surface-variant);">(${pct}%)</span>
              </td>
            </tr>
          `);

          // 展开的手风琴子商户表格
          if (isExpanded) {
            let drillHtml = '';
            if (merchants.length === 0) {
              drillHtml = `<div style="color: var(--md-sys-color-on-surface-variant); padding: 8px 0; font-size: 12px;">该分类下暂无明确商户归集明细</div>`;
            } else {
              drillHtml = `
                <table class="drilldown-table">
                  <thead>
                    <tr>
                      <th style="width: 30px;">#</th>
                      <th>商户名称</th>
                      <th style="width: 70px; text-align: center;">消费频次</th>
                      <th style="width: 140px;">分类内占比</th>
                      <th style="text-align: right; width: 100px;">支出金额</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${merchants.map((m, mIdx) => {
                      const mPct = Number(m.percentage || 0).toFixed(1);
                      return `
                        <tr>
                          <td style="color: var(--md-sys-color-on-surface-variant); font-size: 11px;">${mIdx + 1}</td>
                          <td style="font-weight: 600;">${escapeHtml(m.payee)}</td>
                          <td style="text-align: center;"><span class="m3-chip" style="font-size: 10px; height: 18px; padding: 0 6px;">${m.count} 次</span></td>
                          <td>
                            <div style="display: flex; align-items: center; gap: 6px;">
                              <div style="flex: 1; background: var(--md-sys-color-surface-container-highest); height: 4px; border-radius: 2px; overflow: hidden;">
                                <div style="width: ${mPct}%; height: 100%; background: var(--md-sys-color-secondary); border-radius: 2px;"></div>
                              </div>
                              <span style="font-size: 10px; color: var(--md-sys-color-on-surface-variant); font-family: var(--md-sys-typescale-font-family-code);">${mPct}%</span>
                            </div>
                          </td>
                          <td class="amount-display amount-expense" style="text-align: right; font-weight: 600;">¥${Number(m.amount).toFixed(2)}</td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              `;
            }

            rowsHtml.push(`
              <tr class="drilldown-row">
                <td colspan="4">
                  <div class="drilldown-container">
                    <div style="font-size: 11px; font-weight: 600; color: var(--md-sys-color-primary); margin-bottom: 6px;">
                      🏷️ ${icon} ${escapeHtml(friendlyName)} 下属商户明细排行：
                    </div>
                    ${drillHtml}
                  </div>
                </td>
              </tr>
            `);
          }
        });

        tableBody.innerHTML = rowsHtml.join('');
      }
    }
  },

  // --------------------------------------------------------------------------
  // 2. 当月日度支出横向条形分布 (Daily Expense Horizontal Bars)
  // --------------------------------------------------------------------------
  switchDailyExpenseMode(mode) {
    this.dailyExpenseMode = mode;
    document.querySelectorAll('#dailyExpenseFilterGroup .segmented-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    this.renderDailyExpenses();
  },

  renderDailyExpenses() {
    if (!State.reports) return;
    const rep = State.reports;
    const dailySeries = rep.daily_series || [];
    const burn = rep.daily_burn_rate || {};
    const peak = burn.peak_day || { date: '-', amount: 0 };
    const activeDays = dailySeries.filter(d => Number(d.amount || 0) > 0).length;
    const dailyRate = Number(burn.daily_run_rate || 0).toFixed(2);

    const subEl = document.getElementById('dailyExpenseSubtitle');
    if (subEl) {
      subEl.textContent = `日均支出: ¥${dailyRate} | 峰值支出日: ${peak.date} (¥${Number(peak.amount || 0).toFixed(2)}) | 支出天数: ${activeDays}天`;
    }

    let targetSeries = dailySeries;
    if (this.dailyExpenseMode === 'active') {
      targetSeries = dailySeries.filter(d => Number(d.amount || 0) > 0);
    }

    const chartItems = targetSeries.map(item => {
      const weekday = this.getWeekday(item.date);
      const shortDate = item.date ? item.date.slice(5) : `${item.day}日`;
      return {
        label: `${shortDate} ${weekday}`,
        date: item.date,
        amount: Number(item.amount || 0),
        is_peak: Boolean(item.is_peak),
        tooltip: `${item.date} (${weekday}) 支出: ¥${Number(item.amount || 0).toFixed(2)}${item.is_peak ? ' (🔥 月度峰值日)' : ''}`
      };
    });

    Charts.renderHorizontalBar('dailyExpenseBarContainer', chartItems);
  },

  // --------------------------------------------------------------------------
  // 3. 商户支出多维分析 (Merchant Spending Analysis)
  // --------------------------------------------------------------------------
  onMerchantSearch(kw) {
    this.merchantSearchKeyword = kw || '';
    this.renderMerchantsTable();
  },

  switchMerchantSort(sortBy) {
    this.merchantSortBy = sortBy;
    document.querySelectorAll('#merchantSortGroup .segmented-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.sort === sortBy);
    });
    this.renderMerchantsTable();
  },

  renderMerchants() {
    if (!State.reports) return;
    const rep = State.reports;
    const merchants = rep.merchant_ranking || [];
    const totalExp = Number(rep.income_statement?.total_expenses || 0);

    // 1. 顶部摘要指标
    const totalCountEl = document.getElementById('merchantTotalCount');
    if (totalCountEl) totalCountEl.textContent = `${merchants.length} 家`;

    const topRatioEl = document.getElementById('merchantTopRatio');
    if (topRatioEl) {
      const top3Amt = merchants.slice(0, 3).reduce((acc, m) => acc + Number(m.amount || 0), 0);
      const ratio = totalExp > 0 ? (top3Amt / totalExp * 100).toFixed(1) : '0.0';
      topRatioEl.textContent = `${ratio}%`;
    }

    const avgPerTxEl = document.getElementById('merchantAvgPerTx');
    if (avgPerTxEl) {
      const totalTxCount = merchants.reduce((acc, m) => acc + Number(m.count || 0), 0);
      const avgAmt = totalTxCount > 0 ? (totalExp / totalTxCount).toFixed(2) : '0.00';
      avgPerTxEl.textContent = `¥${avgAmt}`;
    }

    this.renderMerchantsTable();
  },

  renderMerchantsTable() {
    if (!State.reports) return;
    const rep = State.reports;
    const merchants = rep.merchant_ranking || [];
    const tbody = document.getElementById('merchantRankTableBody');
    if (!tbody) return;

    const kw = (this.merchantSearchKeyword || '').trim().toLowerCase();
    let filtered = merchants.filter(m => {
      if (!kw) return true;
      if ((m.payee || '').toLowerCase().includes(kw)) return true;
      if ((m.categories || []).some(c => c.toLowerCase().includes(kw))) return true;
      return false;
    });

    if (this.merchantSortBy === 'count') {
      filtered.sort((a, b) => Number(b.count || 0) - Number(a.count || 0));
    } else if (this.merchantSortBy === 'avg') {
      filtered.sort((a, b) => Number(b.avg_amount || 0) - Number(a.avg_amount || 0));
    } else {
      filtered.sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
    }

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--md-sys-color-on-surface-variant); padding: 30px;">未检索到符合条件的商户数据</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map((m, idx) => {
      const pct = Number(m.percentage || 0).toFixed(1);
      const catsHtml = (m.categories || []).map(catAcc => {
        const catObj = (State.categories || []).find(c => c.account === catAcc);
        const name = catObj ? catObj.name : catAcc.replace('Expenses:', '');
        const icon = State.getCategoryIcon(catObj ? catObj.icon : catAcc);
        return `<span class="m3-chip compact" style="font-size: 11px; margin-right: 4px; padding: 1px 6px;">${icon} ${escapeHtml(name)}</span>`;
      }).join('') || '<span style="color: var(--md-sys-color-on-surface-variant);">-</span>';

      return `
        <tr>
          <td style="font-weight: 600; width: 40px;">${idx + 1}</td>
          <td style="font-weight: 600;">${escapeHtml(m.payee)}</td>
          <td style="text-align: center;">
            <span class="m3-chip" style="font-size: 11px; height: 20px; padding: 0 6px;">${m.count} 笔</span>
          </td>
          <td class="amount-display" style="text-align: right; font-weight: 500;">
            ¥${Number(m.avg_amount || 0).toFixed(2)}
          </td>
          <td>${catsHtml}</td>
          <td style="width: 120px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <div style="flex: 1; background: var(--md-sys-color-surface-container-highest); height: 6px; border-radius: 3px; overflow: hidden;">
                <div style="width: ${pct}%; height: 100%; background: var(--md-sys-color-primary); border-radius: 3px;"></div>
              </div>
              <span style="font-size: 11px; color: var(--md-sys-color-on-surface-variant); font-family: var(--md-sys-typescale-font-family-code);">${pct}%</span>
            </div>
          </td>
          <td class="amount-display amount-expense" style="text-align: right; font-weight: 600; white-space: nowrap;">
            ¥${Number(m.amount || 0).toFixed(2)}
          </td>
        </tr>
      `;
    }).join('');
  },

  // --------------------------------------------------------------------------
  // 4. 资产账户走势折线图与月度趋势 (Multi-Asset Trends & Monthly History)
  // --------------------------------------------------------------------------
  switchAssetTrendMode(mode) {
    this.assetTrendMode = mode;
    document.querySelectorAll('#assetTrendModeGroup .segmented-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    this.renderAssetTrends();
  },

  toggleAccountVisibility(accName) {
    if (this.hiddenAccounts.has(accName)) {
      this.hiddenAccounts.delete(accName);
    } else {
      this.hiddenAccounts.add(accName);
    }
    this.renderAssetTrends();
  },

  renderAssetTrends() {
    const palette = Charts.getPalette();
    let xLabels = [];
    let sourceAccounts = [];

    if (this.assetTrendMode === 'daily') {
      const dailyData = State.reports?.asset_daily_trends;
      if (dailyData) {
        xLabels = dailyData.days || [];
        sourceAccounts = dailyData.accounts || [];
      }
      const sub = document.getElementById('assetTrendsSubtitle');
      if (sub) sub.textContent = `${State.currentMonth} 当月每日 (01~${xLabels.length}日) 资金资产账户余额走势`;
    } else {
      const monthlyData = State.trends;
      if (monthlyData) {
        xLabels = monthlyData.months || [];
        sourceAccounts = monthlyData.asset_trends || [];
      }
      const sub = document.getElementById('assetTrendsSubtitle');
      if (sub) sub.textContent = `近 ${xLabels.length} 个月各银行卡与资金账户月末余额轨迹曲线`;
    }

    // 渲染账户开关 Chips
    const chipsContainer = document.getElementById('assetChipsContainer');
    if (chipsContainer) {
      chipsContainer.innerHTML = sourceAccounts.map((a, idx) => {
        const isVisible = !this.hiddenAccounts.has(a.account);
        const color = palette[idx % palette.length];
        return `
          <div class="asset-chip ${isVisible ? 'active' : ''}" onclick="AnalyticsView.toggleAccountVisibility('${escapeHtml(a.account)}')">
            <span class="asset-chip-dot" style="background-color: ${color};"></span>
            <span>${escapeHtml(a.name)}</span>
          </div>
        `;
      }).join('');
    }

    const seriesList = sourceAccounts.map((a, idx) => ({
      name: a.name,
      account: a.account,
      color: palette[idx % palette.length],
      data: a.balances || [],
      visible: !this.hiddenAccounts.has(a.account)
    }));

    Charts.renderMultiLine('assetMultiLineContainer', xLabels, seriesList);
  },

  renderTrends() {
    let trendsList = [];
    if (State.reports?.monthly_history && State.reports.monthly_history.length > 0) {
      trendsList = State.reports.monthly_history.map(m => {
        const inc = Number(m.income || 0);
        const exp = Number(m.expense || 0);
        const net = Number(m.surplus !== undefined ? m.surplus : (inc - exp));
        const rate = inc > 0 ? (net / inc) : 0;
        return {
          month: m.month,
          income: inc,
          expense: exp,
          net: net,
          savings_rate: rate
        };
      });
    } else if (State.trends?.monthly_trends) {
      trendsList = State.trends.monthly_trends;
    }

    const months = trendsList.map(t => t.month);
    const incomes = trendsList.map(t => Number(t.income || 0));
    const expenses = trendsList.map(t => Number(t.expense || 0));

    Charts.renderMonthlyTrends('trendsBarContainer', months, incomes, expenses);

    // 渲染历史明细小表格
    const tbody = document.getElementById('trendsTableBody');
    if (tbody) {
      if (trendsList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--md-sys-color-on-surface-variant); padding: 20px;">暂无历史月度趋势数据</td></tr>`;
      } else {
        tbody.innerHTML = trendsList.slice().reverse().map(t => {
          const net = t.net !== undefined ? t.net : (Number(t.income || 0) - Number(t.expense || 0));
          const rate = (t.savings_rate !== undefined && t.savings_rate !== null) ? `${(t.savings_rate * 100).toFixed(1)}%` : '-';
          return `
            <tr>
              <td style="font-family: var(--md-sys-typescale-font-family-code); font-weight: 600;">${escapeHtml(t.month)}</td>
              <td class="amount-display amount-income">¥${Number(t.income || 0).toFixed(2)}</td>
              <td class="amount-display amount-expense">¥${Number(t.expense || 0).toFixed(2)}</td>
              <td class="amount-display" style="color: ${net >= 0 ? 'var(--md-sys-color-success)' : 'var(--md-sys-color-error)'}; font-weight: 600;">
                ${net >= 0 ? '+' : ''}¥${Number(net).toFixed(2)}
              </td>
              <td style="font-weight: 600;">${rate}</td>
            </tr>
          `;
        }).join('');
      }
    }
  },

  // --------------------------------------------------------------------------
  // 5. CFP 专业财务指标 (CFP Metrics)
  // --------------------------------------------------------------------------
  renderCFP() {
    if (!State.reports) return;
    const rep = State.reports;
    const bs = rep.balance_sheet || {};
    const er = rep.emergency_runway || {};
    const is = rep.income_statement || {};

    const netWorth = bs.net_worth !== undefined ? bs.net_worth : 0;
    const totalAssets = bs.total_assets !== undefined ? bs.total_assets : 0;
    const totalLiabilities = bs.total_liabilities !== undefined ? bs.total_liabilities : 0;

    // 1. 核心净资产
    const elNetWorth = document.getElementById('cfpNetWorth');
    if (elNetWorth) {
      elNetWorth.textContent = `¥${Number(netWorth).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`;
      elNetWorth.style.color = netWorth >= 0 ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-error)';
    }

    // 2. 负债资产比率
    const elDebtRatio = document.getElementById('cfpDebtRatio');
    if (elDebtRatio) {
      if (totalAssets > 0) {
        const ratio = (totalLiabilities / totalAssets) * 100;
        elDebtRatio.textContent = `${ratio.toFixed(1)}%`;
        elDebtRatio.style.color = ratio < 50 ? 'var(--md-sys-color-success)' : 'var(--md-sys-color-error)';
      } else {
        elDebtRatio.textContent = totalLiabilities > 0 ? '100%+' : '0.0%';
      }
    }

    // 3. 流动性月度覆盖
    const elLiquidity = document.getElementById('cfpLiquidity');
    if (elLiquidity) {
      if (er.runway_months !== undefined) {
        elLiquidity.textContent = `${Number(er.runway_months).toFixed(1)} 个月`;
        elLiquidity.style.color = er.runway_months >= 3 ? 'var(--md-sys-color-success)' : 'var(--md-sys-color-error)';
      } else {
        elLiquidity.textContent = '-';
      }
    }

    // 4. 个人储蓄率
    const elSavingsRate = document.getElementById('cfpSavingsRate');
    if (elSavingsRate) {
      if (is.savings_rate !== undefined) {
        const rate = Number(is.savings_rate);
        elSavingsRate.textContent = `${rate.toFixed(1)}%`;
        elSavingsRate.style.color = rate >= 30 ? 'var(--md-sys-color-success)' : 'var(--md-sys-color-error)';
      } else {
        elSavingsRate.textContent = '-';
      }
    }

    // 5. 偿债压力比率 (月供总额 / 当月总收入)
    const elDebtService = document.getElementById('cfpDebtService');
    if (elDebtService) {
      const totalMonthlyDebt = (State.debts || []).reduce((sum, d) => sum + Number(d.monthly_payment || 0), 0);
      const totalInc = Number(is.total_income || 0);
      if (totalInc > 0) {
        const dsRatio = (totalMonthlyDebt / totalInc) * 100;
        elDebtService.textContent = `${dsRatio.toFixed(1)}%`;
        elDebtService.style.color = dsRatio < 35 ? 'var(--md-sys-color-success)' : 'var(--md-sys-color-error)';
      } else {
        elDebtService.textContent = totalMonthlyDebt > 0 ? '需关注' : '0.0%';
      }
    }
  },

  // --------------------------------------------------------------------------
  // 6. Gemini CFP AI 智能洞察
  // --------------------------------------------------------------------------
  async generateAIReport() {
    const btn = document.getElementById('generateAIBtn');
    const output = document.getElementById('aiReportOutput');
    if (btn) btn.disabled = true;
    if (output) output.innerHTML = `<p style="color: var(--md-sys-color-on-surface-variant);">正在唤起 Gemini 模型结合当月财务数据生成深度诊断，请稍候...</p>`;

    try {
      const res = await API.getAIReportInsights(State.currentMonth);
      if (res && res.insights) {
        const ins = res.insights;
        if (typeof ins === 'object') {
          const recHtml = (ins.recommendations || []).map(r => `<li style="margin-bottom: 6px;">${escapeHtml(r)}</li>`).join('');
          output.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 16px;">
              <div style="padding: 12px 14px; background: var(--md-sys-color-surface-container-high); border-radius: var(--md-shape-sm); border-left: 4px solid var(--md-sys-color-primary);">
                <div style="font-weight: 600; font-size: 14px; color: var(--md-sys-color-primary); margin-bottom: 4px;">📊 综合财务总评</div>
                <div style="font-size: 13px; line-height: 1.6; color: var(--md-sys-color-on-surface);">${escapeHtml(ins.overview || '暂无总评')}</div>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div style="padding: 12px 14px; background: var(--md-sys-color-surface-container-high); border-radius: var(--md-shape-sm);">
                  <div style="font-weight: 600; font-size: 14px; color: var(--md-sys-color-secondary); margin-bottom: 4px;">🛒 支出结构诊断</div>
                  <div style="font-size: 13px; line-height: 1.6; color: var(--md-sys-color-on-surface-variant);">${escapeHtml(ins.spending_assessment || '暂无分析')}</div>
                </div>
                <div style="padding: 12px 14px; background: var(--md-sys-color-surface-container-high); border-radius: var(--md-shape-sm);">
                  <div style="font-weight: 600; font-size: 14px; color: var(--md-sys-color-tertiary, var(--md-sys-color-primary)); margin-bottom: 4px;">🛡️ 防御资金与流动性评估</div>
                  <div style="font-size: 13px; line-height: 1.6; color: var(--md-sys-color-on-surface-variant);">${escapeHtml(ins.runway_evaluation || '暂无评估')}</div>
                </div>
              </div>

              <div style="padding: 12px 14px; background: var(--md-sys-color-surface-container-high); border-radius: var(--md-shape-sm);">
                <div style="font-weight: 600; font-size: 14px; color: var(--md-sys-color-primary); margin-bottom: 6px;">💡 CFP 财务行动建议清单</div>
                <ul style="margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.6; color: var(--md-sys-color-on-surface);">
                  ${recHtml || '<li>保持当前合理收支节奏，定期检视负债偿还与应急金积累。</li>'}
                </ul>
              </div>
            </div>
          `;
        } else {
          output.innerHTML = `<div style="line-height: 1.7; font-size: 14px; white-space: pre-wrap;">${escapeHtml(String(ins))}</div>`;
        }
      } else {
        const msg = (res && res.message) ? res.message : '未生成有效内容，请检查 AI 密钥配置与网络连通性。';
        output.innerHTML = `<p style="color: var(--md-sys-color-error);">${escapeHtml(msg)}</p>`;
      }
    } catch (e) {
      if (output) output.innerHTML = `<p style="color: var(--md-sys-color-error);">生成失败: ${escapeHtml(e.message)}</p>`;
    } finally {
      if (btn) btn.disabled = false;
    }
  }
};

window.AnalyticsView = AnalyticsView;
