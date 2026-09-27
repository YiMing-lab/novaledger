/**
 * NovaLedger Global State & Event Bus
 * 集中式响应式状态管理，保持各视图数据同步
 */

const State = {
  currentView: 'transactions',
  currentMonth: new Date().toISOString().slice(0, 7), // YYYY-MM
  status: null,
  accounts: [],
  debts: [],
  transactions: [],
  categories: [],
  pendingItems: [],
  reports: null,
  trends: null,

  listeners: {},

  on(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  },

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => {
        try { cb(data); } catch (e) { console.error(`Error in event listener for ${event}:`, e); }
      });
    }
  },

  // 计算属性 Helpers
  getActiveAccounts() {
    return this.accounts.filter(a => !a.is_archived);
  },

  getArchivedAccounts() {
    return this.accounts.filter(a => a.is_archived);
  },

  getAccountByBean(beanAcc) {
    if (!beanAcc) return null;
    return this.accounts.find(a => a.account === beanAcc) || null;
  },

  getDebtByAccount(accStr) {
    if (!accStr) return null;
    return this.debts.find(d => d.account === accStr) || null;
  },

  getCategoryByAccount(catAcc) {
    if (!catAcc) return null;
    return this.categories.find(c => c.account === catAcc) || null;
  },

  getCategoryIcon(iconName) {
    if (!iconName) return '🏷️';
    const ICON_MAP = {
      restaurant: '🍔',
      shopping_cart: '🛒',
      icecream: '🍦',
      local_taxi: '🚕',
      directions_subway: '🚇',
      home: '🏠',
      bolt: '⚡',
      local_mall: '🛍️',
      devices: '💻',
      checkroom: '👕',
      sports_esports: '🎮',
      medical_services: '💊',
      hotel: '🏨',
      account_balance: '🏦',
      more_horiz: '📦',
      category: '🏷️',
      payments: '💰',
      trending_up: '📈',
      attach_money: '💵',
      savings: '🪙'
    };
    return ICON_MAP[iconName] || iconName;
  },

  // 格式化金额辅助方法
  formatCurrency(amount, currency = '¥') {
    if (amount === null || amount === undefined || isNaN(amount)) return `${currency}0.00`;
    const num = Number(amount);
    return `${currency}${num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
};

window.State = State;
window.escapeHtml = State.escapeHtml.bind(State);

