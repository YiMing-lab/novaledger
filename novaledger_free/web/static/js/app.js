/**
 * NovaLedger Root Application Controller
 * 初始化应用、路由调度、全局事件总线与数据轮询
 */

const App = {
  async init() {
    console.log('🚀 正在初始化星芒账本 Material Design 3 桌面端...');

    // 初始化主题与弹窗全局事件
    ThemeManager.init();
    Dialog.initGlobalEvents();

    // 绑定侧边栏导航点击
    this.bindNavigation();

    // 绑定快捷键
    this.bindKeyboardShortcuts();

    // 初始化子视图控制器
    TransactionsView.init();
    AccountsView.init();
    AnalyticsView.init();
    SettingsView.init();

    // 初次加载全量数据
    await this.refreshData();

    // 激活默认路由
    this.navigate('transactions');

    console.log('✨ 星芒账本初始化完成！');
  },

  bindNavigation() {
    document.querySelectorAll('.nav-destinations .nav-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const targetView = btn.dataset.view;
        if (targetView) this.navigate(targetView);
      });
    });
  },

  navigate(viewName) {
    State.currentView = viewName;

    // 更新侧边栏高亮
    document.querySelectorAll('.nav-destinations .nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    // 隐藏所有视图容器，显示目标视图
    document.querySelectorAll('.view-pane').forEach(pane => {
      pane.classList.remove('active');
    });

    const targetPane = document.getElementById(`${viewName}View`);
    if (targetPane) {
      targetPane.classList.add('active');
    }

    // 更新 Top App Bar 标题
    const titles = {
      transactions: { title: '流水明细', subtitle: '复式记账明细分录与智能分类' },
      accounts: { title: '资产与债务', subtitle: '资金账户看板、归档专区与个人借款跟踪' },
      analytics: { title: '报表与分析', subtitle: '支出深度统计、历史趋势与 CFP 财务健康指标' },
      settings: { title: '系统设置与工具', subtitle: '账单导入回滚、分类管理、服务配置与账本备份' }
    };

    const cur = titles[viewName] || { title: '星芒账本', subtitle: '' };
    const titleEl = document.getElementById('topBarTitle');
    const subEl = document.getElementById('topBarSubtitle');
    if (titleEl) titleEl.textContent = cur.title;
    if (subEl) subEl.textContent = cur.subtitle;

    // 触发对应视图重绘
    if (viewName === 'transactions') TransactionsView.render();
    else if (viewName === 'accounts') AccountsView.render();
    else if (viewName === 'analytics') AnalyticsView.render();
    else if (viewName === 'settings') SettingsView.render();
  },

  async refreshData() {
    try {
      const [st, accs, debts, txs, cats, pending, reps, trends] = await Promise.all([
        API.getStatus().catch(() => null),
        API.getAccounts().catch(() => []),
        API.getDebts().catch(() => []),
        API.getTransactions().catch(() => []),
        API.getCategories().catch(() => []),
        API.getPending().catch(() => []),
        API.getReports(State.currentMonth).catch(() => null),
        API.getTrends().catch(() => null)
      ]);

      State.status = st;
      State.accounts = accs || [];
      State.debts = (debts && Array.isArray(debts.debts)) ? debts.debts : (Array.isArray(debts) ? debts : []);
      State.transactions = txs || [];
      State.categories = cats || [];
      State.pendingItems = pending || [];
      State.reports = reps;
      State.trends = trends;

      // 更新侧边栏状态指示
      this.updateStatusIndicator(st);

      // 更新待确认角标与流水页横幅
      const pCount = (pending || []).length;
      const railBadge = document.getElementById('railPendingBadge');
      if (railBadge) {
        railBadge.textContent = pCount;
        railBadge.style.display = pCount > 0 ? 'inline-block' : 'none';
      }
      this.updatePendingAlert(pending);

      // 重绘当前激活的视图
      this.navigate(State.currentView);
    } catch (err) {
      console.error('刷新数据异常:', err);
      Toast.error(`数据加载异常: ${err.message}`);
    }
  },

  updatePendingAlert(pending) {
    const banner = document.getElementById('txPendingAlertBanner');
    const titleEl = document.getElementById('pendingAlertTitle');
    const descEl = document.getElementById('pendingAlertDesc');
    const count = (pending || []).length;
    if (banner) {
      if (count > 0) {
        banner.style.display = 'block';
        if (titleEl) {
          titleEl.textContent = `发现 ${count} 笔待确认流水（商户退款/存疑入账）`;
        }
        if (descEl && count === 1) {
          const item = pending[0];
          descEl.textContent = `待处理：${item.payee || '未知商户'} ¥${item.amount || '0.00'} (${item.narration || '退款'})，需核对确认科目后计入账本`;
        } else if (descEl) {
          descEl.textContent = `有 ${count} 笔退款或存疑动账需核对冲减分类后计入账本与账户余额`;
        }
      } else {
        banner.style.display = 'none';
      }
    }
  },

  navigateToPending() {
    this.navigate('settings');
    if (typeof SettingsView !== 'undefined' && SettingsView.switchTab) {
      SettingsView.switchTab('pending');
    }
  },

  updateStatusIndicator(st) {
    const dot = document.getElementById('ledgerStatusDot');
    const text = document.getElementById('ledgerStatusText');
    if (!dot || !text) return;

    if (st && st.ledger_valid) {
      dot.className = 'status-dot';
      text.textContent = '账本借贷平衡';
    } else {
      dot.className = 'status-dot error';
      text.textContent = '账本存在差额/告警';
    }
  },

  async triggerMailSync() {
    const topBtn = document.getElementById('topSyncMailBtn');
    if (topBtn) {
      topBtn.disabled = true;
      topBtn.innerHTML = '<span>⏳ 正在同步...</span>';
    }
    Toast.info('正在连接邮箱拉取最新账单并入账 Beancount...');
    try {
      const res = await API.triggerMailSync();
      if (res && (res.status === 'success' || res.success)) {
        const details = res.details || {};
        const added = details.added ?? res.imported_count ?? 0;
        const pending = details.pending ?? 0;
        if (pending > 0) {
          Toast.warning(`邮箱同步完成：入账 ${added} 笔，另有 ${pending} 笔退款进入待确认列表，请点击顶部横幅处理`);
        } else {
          Toast.success(res.message || `邮箱同步完成！拉取入账 ${added} 笔新账单`);
        }
      } else if (res && res.status === 'skipped') {
        Toast.warning(res.message || '未配置邮箱账号或授权码');
      } else {
        Toast.error(res?.message || '邮箱同步遇到问题，请检查网络或授权码');
      }
      await this.refreshData();
    } catch (e) {
      Toast.error(`邮箱同步失败: ${e.message}`);
    } finally {
      if (topBtn) {
        topBtn.disabled = false;
        topBtn.innerHTML = '<span>📥 邮箱同步</span>';
      }
    }
  },

  bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // 当不在输入框中时触发快捷键
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
      if (isInput) return;

      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        TransactionsView.openRecordModal();
      }
    });
  }
};

window.App = App;

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
