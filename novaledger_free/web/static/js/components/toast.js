/**
 * Material Design 3 Snackbar / Toast Controller
 */

const Toast = {
  container: null,

  ensureContainer() {
    if (!this.container) {
      this.container = document.getElementById('toastContainer');
      if (!this.container) {
        this.container = document.createElement('div');
        this.container.id = 'toastContainer';
        this.container.className = 'toast-container';
        document.body.appendChild(this.container);
      }
    }
    return this.container;
  },

  show(message, type = 'info', duration = 3500) {
    const cont = this.ensureContainer();
    const snackbar = document.createElement('div');
    snackbar.className = `m3-snackbar ${type}`;

    const iconMap = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ'
    };

    snackbar.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-weight: bold;">${iconMap[type] || 'ℹ'}</span>
        <span>${message}</span>
      </div>
      <button style="background: transparent; border: none; color: inherit; cursor: pointer; font-size: 16px;" onclick="this.parentElement.remove()">✕</button>
    `;

    cont.appendChild(snackbar);

    setTimeout(() => {
      snackbar.style.opacity = '0';
      snackbar.style.transform = 'translateY(10px)';
      snackbar.style.transition = 'all 200ms ease';
      setTimeout(() => snackbar.remove(), 200);
    }, duration);
  },

  success(msg, duration) { this.show(msg, 'success', duration); },
  error(msg, duration) { this.show(msg, 'error', duration); },
  warning(msg, duration) { this.show(msg, 'warning', duration); },
  info(msg, duration) { this.show(msg, 'info', duration); }
};

window.Toast = Toast;
