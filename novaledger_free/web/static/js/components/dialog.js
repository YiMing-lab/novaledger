/**
 * Material Design 3 Modal Dialog Controller
 */

const Dialog = {
  activeDialogId: null,

  open(modalId) {
    const el = document.getElementById(modalId);
    if (!el) return;
    el.classList.add('active');
    this.activeDialogId = modalId;
    document.body.style.overflow = 'hidden';

    // 聚焦首个输入框
    const firstInput = el.querySelector('input:not([type="hidden"]), select, textarea');
    if (firstInput) {
      setTimeout(() => firstInput.focus(), 80);
    }
  },

  close(modalId) {
    const targetId = modalId || this.activeDialogId;
    if (!targetId) return;
    const el = document.getElementById(targetId);
    if (el) {
      el.classList.remove('active');
    }
    const remainingActive = document.querySelectorAll('.modal-scrim.active');
    if (remainingActive.length === 0) {
      this.activeDialogId = null;
      document.body.style.overflow = '';
    } else {
      this.activeDialogId = remainingActive[remainingActive.length - 1].id;
    }
  },

  confirm({ title = '确认操作', message, confirmText = '确定', cancelText = '取消', isDanger = false }) {
    return new Promise((resolve) => {
      const scrim = document.createElement('div');
      scrim.className = 'modal-scrim active';
      scrim.style.zIndex = '1100';

      const dialog = document.createElement('div');
      dialog.className = 'modal-dialog';
      dialog.style.maxWidth = '420px';

      dialog.innerHTML = `
        <div class="modal-header">
          <div class="modal-title">${title}</div>
        </div>
        <div class="modal-body" style="padding-top: 8px;">
          <p style="color: var(--md-sys-color-on-surface-variant); line-height: 1.5;">${message}</p>
        </div>
        <div class="modal-footer">
          <button class="m3-btn btn-text cancel-btn">${cancelText}</button>
          <button class="m3-btn ${isDanger ? 'btn-danger' : 'btn-filled'} confirm-btn">${confirmText}</button>
        </div>
      `;

      scrim.appendChild(dialog);
      document.body.appendChild(scrim);

      const cleanup = (result) => {
        scrim.remove();
        resolve(result);
      };

      dialog.querySelector('.confirm-btn').onclick = () => cleanup(true);
      dialog.querySelector('.cancel-btn').onclick = () => cleanup(false);
      scrim.onclick = (e) => {
        if (e.target === scrim) cleanup(false);
      };
    });
  },

  initGlobalEvents() {
    // ESC 关闭弹窗
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.activeDialogId) {
        this.close(this.activeDialogId);
      }
    });

    // 点击背景遮罩关闭
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-scrim')) {
        this.close(e.target.id);
      }
    });
  }
};

window.Dialog = Dialog;
