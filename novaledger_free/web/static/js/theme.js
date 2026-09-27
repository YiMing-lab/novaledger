/**
 * NovaLedger Material Design 3 Theme Manager
 * 负责亮色 / 暗色 / 跟随系统主题切换与持久化
 */

const ThemeManager = {
  currentTheme: 'dark', // 'light', 'dark', 'auto'

  init() {
    const saved = localStorage.getItem('novaledger_m3_theme') || 'dark';
    this.setTheme(saved);

    // 监听系统颜色模式变动
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      if (this.currentTheme === 'auto') {
        this.applyTheme(e.matches ? 'dark' : 'light');
      }
    });
  },

  setTheme(theme) {
    this.currentTheme = theme;
    localStorage.setItem('novaledger_m3_theme', theme);

    if (theme === 'auto') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      this.applyTheme(isDark ? 'dark' : 'light');
    } else {
      this.applyTheme(theme);
    }
  },

  applyTheme(effectiveTheme) {
    document.documentElement.setAttribute('data-theme', effectiveTheme);
    this.updateToggleUI();
  },

  toggle() {
    if (this.currentTheme === 'dark') {
      this.setTheme('light');
    } else {
      this.setTheme('dark');
    }
  },

  updateToggleUI() {
    const btn = document.getElementById('themeToggleBtn');
    if (!btn) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    btn.innerHTML = isDark ? '🌙 深色模式' : '☀️ 浅色模式';
  }
};

window.ThemeManager = ThemeManager;
