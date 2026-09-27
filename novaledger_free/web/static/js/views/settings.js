/**
 * Settings View Controller (系统设置与工具箱)
 * 账单导入与撤回、分类管理、待确认事项、邮箱/AI服务、备份还原与对账校准
 */

const SettingsView = {
  currentTab: 'import', // 'import', 'categories', 'pending', 'services', 'backup', 'recon'

  init() {
    this.bindEvents();
  },

  bindEvents() {
    // 切换设置子选项卡
    document.querySelectorAll('#settingsSubTabs .m3-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.dataset.tab;
        this.switchTab(tab);
      });
    });

    // 账单拖拽上传
    const dropZone = document.getElementById('importDropZone');
    const fileInput = document.getElementById('importFileInput');
    if (dropZone && fileInput) {
      dropZone.addEventListener('click', () => fileInput.click());
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--md-sys-color-primary)';
        dropZone.style.backgroundColor = 'var(--md-sys-color-surface-container-high)';
      });
      dropZone.addEventListener('dragleave', () => {
        dropZone.style.borderColor = 'var(--md-sys-color-outline)';
        dropZone.style.backgroundColor = 'transparent';
      });
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--md-sys-color-outline)';
        dropZone.style.backgroundColor = 'transparent';
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          fileInput.files = e.dataTransfer.files;
          this.handleFileSelected();
        }
      });
      fileInput.addEventListener('change', () => this.handleFileSelected());
    }
  },

  switchTab(tab) {
    this.currentTab = tab;
    document.querySelectorAll('#settingsSubTabs .m3-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    ['importTab', 'categoriesTab', 'pendingTab', 'servicesTab', 'backupTab', 'reconTab'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

    const activeEl = document.getElementById(`${tab}Tab`);
    if (activeEl) activeEl.style.display = 'block';

    if (tab === 'categories') this.renderCategories();
    if (tab === 'pending') this.renderPending();
    if (tab === 'services') this.loadConfig();
    if (tab === 'backup') this.renderLedgerStatus();
  },

  render() {
    this.populateAccountSelects();
    this.loadConfig();
    if (this.currentTab === 'categories') this.renderCategories();
    if (this.currentTab === 'pending') this.renderPending();
    if (this.currentTab === 'backup') this.renderLedgerStatus();
  },

  populateAccountSelects() {
    const importAcc = document.getElementById('importDefaultAccount');
    if (importAcc) {
      importAcc.innerHTML = State.getActiveAccounts().map(a => `
        <option value="${a.account}">${a.name}${a.card_tail ? ` (${a.card_tail})` : ''}</option>
      `).join('');
    }

    const reconAcc = document.getElementById('reconAccountSelect');
    if (reconAcc) {
      reconAcc.innerHTML = State.getActiveAccounts().map(a => `
        <option value="${a.account}">${a.name}${a.card_tail ? ` (${a.card_tail})` : ''}</option>
      `).join('');
    }
  },

  // ------------------------------------------------------------------------
  // 1. 账单导入
  // ------------------------------------------------------------------------
  handleFileSelected() {
    const input = document.getElementById('importFileInput');
    const label = document.getElementById('importSelectedFileName');
    if (input && input.files && input.files[0]) {
      const f = input.files[0];
      if (label) label.textContent = `已选择文件: ${f.name} (${(f.size / 1024).toFixed(1)} KB)`;
    }
  },

  async submitUpload() {
    const input = document.getElementById('importFileInput');
    const sourceType = document.getElementById('importSourceType').value;
    const defaultAccount = document.getElementById('importDefaultAccount').value;

    if (!input || !input.files || !input.files[0]) {
      Toast.warning('请先选择要导入的账单文件！');
      return;
    }

    const file = input.files[0];
    const btn = document.getElementById('importUploadBtn');
    if (btn) btn.disabled = true;
    Toast.info('正在解析与去重入账，请稍候...');

    try {
      const res = await API.uploadImportFile(file, sourceType, defaultAccount);
      Toast.success('账单导入处理成功！');
      
      const summaryDiv = document.getElementById('importResultSummary');
      if (summaryDiv && res.summary) {
        const s = res.summary;
        summaryDiv.innerHTML = `
          <div class="m3-card" style="background: var(--md-sys-color-surface-container-high); margin-top: 16px;">
            <div class="card-title">🎉 导入批次汇总 (批次 ID: <code>${s.batch_id || '-'}</code>)</div>
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 12px;">
              <div>总读取条数: <b>${s.total_records || 0}</b></div>
              <div style="color: var(--md-sys-color-success);">成功入账: <b>${s.added_count || 0}</b></div>
              <div style="color: var(--md-sys-color-warning);">待人工确认: <b>${s.pending_count || 0}</b></div>
              <div style="color: var(--md-sys-color-on-surface-variant);">重复跳过: <b>${s.skipped_duplicates || 0}</b></div>
            </div>
            ${s.batch_id ? `
              <div style="margin-top: 12px; text-align: right;">
                <button class="m3-btn btn-outlined btn-sm" onclick="SettingsView.rollbackBatch('${s.batch_id}')">↩️ 一键撤回该批次</button>
              </div>
            ` : ''}
          </div>
        `;
      }
      await App.refreshData();
    } catch (e) {
      Toast.error(`导入失败: ${e.message}`);
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  async rollbackBatch(batchId) {
    const ok = await Dialog.confirm({
      title: '撤回导入批次',
      message: `确定要撤回批次 ${batchId} 导入的所有交易记录吗？`,
      confirmText: '确认撤回',
      isDanger: true
    });
    if (!ok) return;

    try {
      const res = await API.rollbackImportBatch(batchId);
      Toast.success(`批次已成功撤回，移除了 ${res.rolled_back_count} 笔分录！`);
      await App.refreshData();
    } catch (e) {
      Toast.error(`撤回失败: ${e.message}`);
    }
  },

  // ------------------------------------------------------------------------
  // 2. 分类管理 (增删改查、归档与合并)
  // ------------------------------------------------------------------------
  renderCategories() {
    const container = document.getElementById('categoriesList');
    if (!container) return;

    const cats = State.categories;
    const activeCats = cats.filter(c => !c.is_archived);
    const archivedCats = cats.filter(c => c.is_archived);

    const expenseCats = activeCats.filter(c => c.type !== 'income');
    const incomeCats = activeCats.filter(c => c.type === 'income');

    const renderCard = (c, isArchived = false) => {
      const safeCat = encodeURIComponent(JSON.stringify(c));
      return `
        <div class="m3-card" style="padding: 12px 14px; display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: 8px; opacity: ${isArchived ? '0.75' : '1'}; min-width: 0; box-sizing: border-box;">
          <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
            <span style="font-size: 22px; flex-shrink: 0; line-height: 1;">${escapeHtml(State.getCategoryIcon(c.icon))}</span>
            <div style="min-width: 0; flex: 1;">
              <div style="font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(c.name)}">
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(c.name)}</span>
                ${isArchived ? '<span class="m3-chip" style="height: 18px; font-size: 10px; padding: 0 6px; flex-shrink: 0;">已归档</span>' : ''}
              </div>
              <div style="font-size: 11px; color: var(--md-sys-color-on-surface-variant); font-family: var(--md-sys-typescale-font-family-code); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(c.account)}">
                ${escapeHtml(c.account)}
              </div>
            </div>
          </div>
          <div style="display: flex; gap: 4px; align-items: center; flex-shrink: 0;">
            <button class="m3-btn btn-text btn-sm" onclick="SettingsView.openEditCategoryModal(decodeURIComponent('${safeCat}'))">编辑</button>
            ${isArchived ? `
              <button class="m3-btn btn-text btn-sm" style="color: var(--md-sys-color-primary);" onclick="SettingsView.unarchiveCategory('${c.id}')">恢复</button>
            ` : `
              <button class="m3-btn btn-text btn-sm" style="color: var(--md-sys-color-error);" title="删除或归档分类" onclick="SettingsView.deleteCategory('${c.id}')">✕</button>
            `}
          </div>
        </div>
      `;
    };

    const renderGroup = (title, list, isArchived = false) => `
      <div style="margin-bottom: 24px;">
        <div style="font: var(--md-sys-typescale-title-small); color: ${isArchived ? 'var(--md-sys-color-outline)' : 'var(--md-sys-color-primary)'}; margin-bottom: 12px;">
          ${title} (${list.length})
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px;">
          ${list.map(c => renderCard(c, isArchived)).join('')}
        </div>
      </div>
    `;

    let html = renderGroup('支出分类', expenseCats) + renderGroup('收入分类', incomeCats);
    if (archivedCats.length > 0) {
      html += renderGroup('📁 已归档分类', archivedCats, true);
    }
    container.innerHTML = html;
  },

  callerModal: null,

  categoryPresets: {
    expense: [
      { label: '✈️ 旅行差旅 (Expenses:Travel)', account: 'Expenses:Travel', icon: '✈️', name: '旅行差旅' },
      { label: '🍔 餐饮美食 (Expenses:Food)', account: 'Expenses:Food', icon: '🍔', name: '餐饮美食' },
      { label: '🛒 购物消费 (Expenses:Shopping)', account: 'Expenses:Shopping', icon: '🛒', name: '购物消费' },
      { label: '🚕 交通出行 (Expenses:Transport)', account: 'Expenses:Transport', icon: '🚕', name: '交通出行' },
      { label: '🎮 休闲娱乐 (Expenses:Entertainment)', account: 'Expenses:Entertainment', icon: '🎮', name: '休闲娱乐' },
      { label: '🏠 居家生活 (Expenses:Housing)', account: 'Expenses:Housing', icon: '🏠', name: '居家生活' },
      { label: '💊 医疗健康 (Expenses:Health)', account: 'Expenses:Health', icon: '💊', name: '医疗健康' },
      { label: '📚 学习教育 (Expenses:Education)', account: 'Expenses:Education', icon: '📚', name: '学习教育' },
      { label: '📱 数码配件 (Expenses:Digital)', account: 'Expenses:Digital', icon: '📱', name: '数码配件' },
      { label: '🐶 宠物相关 (Expenses:Pet)', account: 'Expenses:Pet', icon: '🐶', name: '宠物支出' },
      { label: '🎁 人情社交 (Expenses:Social)', account: 'Expenses:Social', icon: '🎁', name: '人情送礼' },
      { label: '📦 其他杂项 (Expenses:Other)', account: 'Expenses:Other', icon: '📦', name: '其他杂项' },
      { label: '⚙️ 自定义一级科目...', account: '__custom__', icon: '🏷️', name: '' }
    ],
    income: [
      { label: '💰 劳动报酬/工资 (Income:Salary)', account: 'Income:Salary', icon: '💰', name: '工资薪酬' },
      { label: '📈 投资理财收益 (Income:Investment)', account: 'Income:Investment', icon: '📈', name: '理财收益' },
      { label: '🎁 奖金津贴福利 (Income:Bonus)', account: 'Income:Bonus', icon: '🎁', name: '奖金津贴' },
      { label: '💼 副业兼职收入 (Income:Freelance)', account: 'Income:Freelance', icon: '💼', name: '副业兼职' },
      { label: '💵 亲友赠与/转账 (Income:Transfer)', account: 'Income:Transfer', icon: '💵', name: '转账存入' },
      { label: '🏷️ 其他收入 (Income:Other)', account: 'Income:Other', icon: '🏷️', name: '其他收入' },
      { label: '⚙️ 自定义一级科目...', account: '__custom__', icon: '🏷️', name: '' }
    ]
  },

  quickEmojis: ['✈️', '🏨', '🍔', '☕', '🛒', '🚕', '🚇', '🎮', '🎬', '🏠', '💊', '📚', '🐶', '🐱', '📱', '💰', '📈', '🎁', '⚡', '🛍️', '🚗', '🍲'],

  sanitizeAccountSegment(str) {
    if (!str) return '';
    let s = str.trim().replace(/[\s_]+/g, '-');
    s = s.replace(/[^A-Za-z0-9-]/g, '');
    if (!s) return '';
    return s.split('-').map(part => part ? part.charAt(0).toUpperCase() + part.slice(1) : '').join('-');
  },

  renderQuickEmojis() {
    const picker = document.getElementById('addCatEmojiPicker');
    if (!picker) return;
    picker.innerHTML = this.quickEmojis.map(emoji => `
      <button type="button" class="m3-btn btn-text btn-xs" style="font-size: 16px; padding: 4px 6px; min-width: 32px; height: 32px;" onclick="SettingsView.selectQuickEmoji('${emoji}')">${emoji}</button>
    `).join('');
  },

  selectQuickEmoji(emoji) {
    const iconInput = document.getElementById('addCatIcon');
    if (iconInput) {
      iconInput.value = emoji;
    }
  },

  openAddCategoryModal(caller = null, defaultType = 'expense') {
    this.callerModal = caller;
    const form = document.getElementById('addCatForm');
    if (form) form.reset();
    
    // 初始化单选类型
    const typeRadios = document.getElementsByName('addCatTypeRadio');
    for (const r of typeRadios) {
      r.checked = (r.value === defaultType);
    }
    const typeHidden = document.getElementById('addCatType');
    if (typeHidden) typeHidden.value = defaultType;

    this.renderQuickEmojis();
    this.populateCategoryPresets(defaultType);
    this.onCategoryPresetChange();

    Dialog.open('addCategoryModal');
  },

  onCategoryTypeChange(type) {
    const typeHidden = document.getElementById('addCatType');
    if (typeHidden) typeHidden.value = type;
    this.populateCategoryPresets(type);
    this.onCategoryPresetChange();
  },

  populateCategoryPresets(type) {
    const select = document.getElementById('addCatPreset');
    if (!select) return;
    const presets = this.categoryPresets[type] || this.categoryPresets.expense;
    select.innerHTML = presets.map((p, idx) => `
      <option value="${p.account}" data-icon="${p.icon}" data-name="${p.name}" ${idx === 0 ? 'selected' : ''}>${p.label}</option>
    `).join('');
  },

  onCategoryPresetChange() {
    const select = document.getElementById('addCatPreset');
    if (!select) return;
    const opt = select.options[select.selectedIndex];
    if (!opt) return;

    const val = opt.value;
    const defaultIcon = opt.getAttribute('data-icon') || '🏷️';
    const defaultName = opt.getAttribute('data-name') || '';

    const isCustom = (val === '__custom__');
    const customGroup = document.getElementById('addCatCustomGroup');
    const subGroup = document.getElementById('addCatSubGroup');
    const nameInput = document.getElementById('addCatName');
    const iconInput = document.getElementById('addCatIcon');

    if (customGroup) customGroup.style.display = isCustom ? 'flex' : 'none';
    if (subGroup) subGroup.style.display = isCustom ? 'none' : 'flex';

    if (!isCustom) {
      if (nameInput && (!nameInput.value.trim() || this.isPresetDefaultName(nameInput.value.trim()))) {
        nameInput.value = defaultName;
      }
      if (iconInput && (!iconInput.value.trim() || this.isPresetDefaultIcon(iconInput.value.trim()))) {
        iconInput.value = defaultIcon;
      }
    }

    this.updateCategoryPreview();
  },

  isPresetDefaultName(name) {
    for (const t of ['expense', 'income']) {
      if ((this.categoryPresets[t] || []).some(p => p.name === name)) return true;
    }
    return false;
  },

  isPresetDefaultIcon(icon) {
    for (const t of ['expense', 'income']) {
      if ((this.categoryPresets[t] || []).some(p => p.icon === icon)) return true;
    }
    return false;
  },

  onCategoryNameInput() {
    this.updateCategoryPreview();
  },

  updateCategoryPreview() {
    const type = (document.getElementById('addCatType') || {}).value || 'expense';
    const defaultPrefix = type === 'income' ? 'Income' : 'Expenses';
    const presetSelect = document.getElementById('addCatPreset');
    const selectedPreset = presetSelect ? presetSelect.value : '';
    const subVal = (document.getElementById('addCatSub') || {}).value || '';
    const customVal = (document.getElementById('addCatCustomAccount') || {}).value || '';

    let finalAccount = '';
    let isValid = true;

    if (selectedPreset === '__custom__') {
      const raw = customVal.trim();
      if (!raw) {
        finalAccount = `${defaultPrefix}:YourCategory`;
        isValid = false;
      } else {
        const segments = raw.replace('/', ':').replace('\\\\', ':').split(':').filter(s => s.trim());
        if (segments.length > 0) {
          const root = segments[0];
          const validRoots = ['Assets', 'Liabilities', 'Equity', 'Income', 'Expenses'];
          const matchedRoot = validRoots.find(r => r.toLowerCase() === root.toLowerCase());
          if (matchedRoot) {
            segments[0] = matchedRoot;
          } else {
            segments.unshift(defaultPrefix);
          }
          finalAccount = segments.map(s => this.sanitizeAccountSegment(s)).filter(Boolean).join(':');
        } else {
          finalAccount = `${defaultPrefix}:YourCategory`;
          isValid = false;
        }
      }
    } else {
      const sanitizedSub = this.sanitizeAccountSegment(subVal);
      if (sanitizedSub) {
        finalAccount = `${selectedPreset}:${sanitizedSub}`;
      } else {
        finalAccount = selectedPreset;
      }
    }

    const previewEl = document.getElementById('addCatPreviewAccount');
    const badgeEl = document.getElementById('addCatFormatBadge');
    const hiddenAcc = document.getElementById('addCatAccount');

    if (previewEl) previewEl.textContent = finalAccount;
    if (hiddenAcc) hiddenAcc.value = finalAccount;

    if (badgeEl) {
      if (isValid && finalAccount && finalAccount.includes(':')) {
        badgeEl.textContent = '✓ 格式规范且自动开户';
        badgeEl.style.color = 'var(--md-sys-color-primary)';
      } else {
        badgeEl.textContent = '⚠️ 请完善英文科目代码';
        badgeEl.style.color = 'var(--md-sys-color-error)';
      }
    }
  },

  async submitAddCategory() {
    const name = document.getElementById('addCatName').value.trim();
    const account = document.getElementById('addCatAccount').value.trim();
    const type = document.getElementById('addCatType').value;
    const icon = document.getElementById('addCatIcon').value.trim() || '🏷️';

    if (!name || !account) {
      Toast.warning('请填写分类名称和 Beancount 科目代码！');
      return;
    }

    try {
      const res = await API.createCategory({ name, account, type, icon });
      const newCat = res.category || { name, account, type, icon };
      Toast.success('分类创建成功！已自动在账本开户');
      Dialog.close('addCategoryModal');
      await App.refreshData();

      // 联动唤起方 (如果是记账或编辑弹窗触发)
      if (this.callerModal === 'recordModal') {
        TransactionsView.populateRecordSelects();
        const recCat = document.getElementById('recCategory');
        if (recCat) {
          recCat.value = newCat.account;
        }
      } else if (this.callerModal === 'editTxModal') {
        const curFrom = document.getElementById('editTxAccount') ? document.getElementById('editTxAccount').value : null;
        const curTo = document.getElementById('editTxToAccount') ? document.getElementById('editTxToAccount').value : null;
        TransactionsView.populateEditSelects(curFrom, curTo, newCat.account);
        const editCat = document.getElementById('editTxCategory');
        if (editCat) {
          editCat.value = newCat.account;
        }
      } else {
        this.renderCategories();
      }
    } catch (e) {
      Toast.error(`创建分类失败: ${e.message}`);
    }
  },

  openEditCategoryModal(catJsonStr) {
    const cat = typeof catJsonStr === 'string' ? JSON.parse(catJsonStr) : catJsonStr;
    document.getElementById('editCatId').value = cat.id;
    document.getElementById('editCatName').value = cat.name;
    document.getElementById('editCatAccount').value = cat.account;
    document.getElementById('editCatIcon').value = cat.icon || '';
    document.getElementById('editCatArchived').checked = !!cat.is_archived;
    Dialog.open('editCategoryModal');
  },

  async submitEditCategory() {
    const catId = document.getElementById('editCatId').value;
    const name = document.getElementById('editCatName').value.trim();
    const icon = document.getElementById('editCatIcon').value.trim();
    const is_archived = document.getElementById('editCatArchived').checked;

    if (!name) {
      Toast.warning('分类名称不能为空！');
      return;
    }

    try {
      await API.updateCategory(catId, { name, icon, is_archived });
      Toast.success('分类修改成功！');
      Dialog.close('editCategoryModal');
      await App.refreshData();
      this.renderCategories();
    } catch (e) {
      Toast.error(`修改分类失败: ${e.message}`);
    }
  },

  async unarchiveCategory(catId) {
    try {
      await API.updateCategory(catId, { is_archived: false });
      Toast.success('分类已恢复启用！');
      await App.refreshData();
      this.renderCategories();
    } catch (e) {
      Toast.error(`恢复失败: ${e.message}`);
    }
  },

  async deleteCategory(catId) {
    const ok = await Dialog.confirm({
      title: '删除/停用分类',
      message: '确定要删除该分类吗？若该分类已有历史记账流水，系统将进行安全归档以确保 Beancount 账本平衡。',
      confirmText: '确认删除/归档',
      isDanger: true
    });
    if (!ok) return;

    try {
      const res = await API.deleteCategory(catId);
      Toast.success(res.message || '分类已处理！');
      await App.refreshData();
      this.renderCategories();
    } catch (e) {
      Toast.error(`删除失败: ${e.message}`);
    }
  },

  openMergeCategoryModal() {
    const srcSelect = document.getElementById('mergeSrcCategory');
    const tgtSelect = document.getElementById('mergeTgtCategory');
    if (!srcSelect || !tgtSelect) return;

    const cats = State.categories;
    const opts = cats.map(c => `
      <option value="${c.account}">${State.getCategoryIcon(c.icon)} ${c.name} (${c.account})</option>
    `).join('');

    srcSelect.innerHTML = opts;
    tgtSelect.innerHTML = opts;
    if (cats.length > 1) {
      tgtSelect.selectedIndex = 1;
    }
    Dialog.open('mergeCategoryModal');
  },

  async submitMergeCategory() {
    const src = document.getElementById('mergeSrcCategory').value;
    const tgt = document.getElementById('mergeTgtCategory').value;

    if (!src || !tgt) {
      Toast.warning('请选择原分类与目标分类');
      return;
    }
    if (src === tgt) {
      Toast.warning('原分类与目标分类不能相同！');
      return;
    }

    const srcName = State.getCategoryByAccount(src)?.name || src;
    const tgtName = State.getCategoryByAccount(tgt)?.name || tgt;

    const ok = await Dialog.confirm({
      title: '🔀 确认合并记账分类',
      message: `确定要将「${srcName}」下的所有历史记账流水全部合并转移至「${tgtName}」吗？\n\n此操作将平滑重定向 Beancount 账本中相应借贷分录，原分类将被安全清理。`,
      confirmText: '确认合并并迁移流水',
      isDanger: false
    });
    if (!ok) return;

    try {
      Toast.info('正在更新 Beancount 账本并合并分类流水...');
      const res = await API.mergeCategories(src, tgt);
      Toast.success(res.message || '分类合并成功！');
      Dialog.close('mergeCategoryModal');
      await App.refreshData();
      this.renderCategories();
    } catch (e) {
      Toast.error(`合并失败: ${e.message}`);
    }
  },

  // ------------------------------------------------------------------------
  // 3. 待确认交易清单
  // ------------------------------------------------------------------------
  renderPending() {
    const container = document.getElementById('pendingTableBody');
    if (!container) return;

    const items = State.pendingItems;
    const countTag = document.getElementById('pendingCountTag');
    if (countTag) countTag.textContent = `${items.length} 笔待处理`;

    // 更新全局侧边栏 Badge
    const railBadge = document.getElementById('railPendingBadge');
    if (railBadge) {
      railBadge.textContent = items.length;
      railBadge.style.display = items.length > 0 ? 'inline-block' : 'none';
    }

    if (items.length === 0) {
      container.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--md-sys-color-on-surface-variant);">当前所有导入交易均已确认入账，无待办事项 ✨</td></tr>`;
      return;
    }

    const activeAccs = State.getActiveAccounts();
    const expCats = State.categories.filter(c => !c.is_archived);

    container.innerHTML = items.map(item => {
      const isRefund = !!(item.raw_payload?.is_refund || item.reason?.includes('退款') || item.narration?.includes('退款'));
      const isNormalIncome = (item.raw_payload?.direction === '收入' || item.direction === '收入') && !isRefund;
      const filteredCats = expCats.filter(c => isNormalIncome ? c.type === 'income' : c.type === 'expense');
      const catsToUse = filteredCats.length > 0 ? filteredCats : expCats;

      const amountHtml = isRefund
        ? `<div style="display: flex; align-items: center; justify-content: flex-end; gap: 4px;">
             <span class="amount-display amount-income" style="font-weight: 600;">+¥${Number(item.amount).toFixed(2)}</span>
             <span class="m3-badge badge-expense-offset" style="font-size: 11px; padding: 2px 6px;">↩️ 退款冲减</span>
           </div>`
        : (isNormalIncome
            ? `<div style="display: flex; align-items: center; justify-content: flex-end; gap: 4px;">
                 <span class="amount-display amount-income" style="font-weight: 600;">+¥${Number(item.amount).toFixed(2)}</span>
                 <span class="m3-badge badge-income" style="font-size: 11px; padding: 2px 6px;">收入</span>
               </div>`
            : `<div style="text-align: right;"><span class="amount-display amount-expense" style="font-weight: 600;">-¥${Number(item.amount).toFixed(2)}</span></div>`);

      return `
      <tr>
        <td style="font-family: var(--md-sys-typescale-font-family-code);">${item.date}</td>
        <td style="font-weight: 600;">${item.payee || '-'}</td>
        <td style="color: var(--md-sys-color-on-surface-variant); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.narration || '-'}</td>
        <td>${amountHtml}</td>
        <td>
          <select id="pendingAcc_${item.item_id}" class="m3-select compact" style="width: 160px;">
            ${activeAccs.map(a => `<option value="${a.account}" ${a.account === item.suggested_account ? 'selected' : ''}>${a.name}</option>`).join('')}
          </select>
        </td>
        <td>
          <select id="pendingCat_${item.item_id}" class="m3-select compact" style="width: 180px;" title="${isRefund ? '选择被冲减的支出分类' : ''}">
            ${catsToUse.map(c => `<option value="${c.account}" ${c.account === item.suggested_category ? 'selected' : ''}>${State.getCategoryIcon(c.icon)} ${c.name}</option>`).join('')}
          </select>
        </td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="m3-btn btn-filled btn-sm" onclick="SettingsView.resolvePendingItem('${item.item_id}', 'confirm')">✓ 入账</button>
          <button class="m3-btn btn-text btn-sm" onclick="SettingsView.resolvePendingItem('${item.item_id}', 'ignore')">✕ 忽略</button>
        </td>
      </tr>
      `;
    }).join('');
  },

  async resolvePendingItem(itemId, action) {
    const accEl = document.getElementById(`pendingAcc_${itemId}`);
    const catEl = document.getElementById(`pendingCat_${itemId}`);
    const account = accEl ? accEl.value : '';
    const category = catEl ? catEl.value : '';

    try {
      const res = await API.resolvePending(itemId, action, account, category);
      Toast.success(res.message || '处理成功！');
      await App.refreshData();
      this.renderPending();
    } catch (e) {
      Toast.error(`处理失败: ${e.message}`);
    }
  },

  // ------------------------------------------------------------------------
  // 4. 服务配置 (AI & 邮箱)
  // ------------------------------------------------------------------------
  async loadConfig() {
    try {
      const cfg = await API.getConfig();
      if (!cfg) return;

      // 邮箱
      const mailSync = cfg.mail_sync || {};
      const elHost = document.getElementById('cfgImapHost');
      const elPort = document.getElementById('cfgImapPort');
      const elUser = document.getElementById('cfgImapUser');
      if (elHost) elHost.value = mailSync.imap_host || '';
      if (elPort) elPort.value = mailSync.imap_port || 993;
      if (elUser) elUser.value = mailSync.username || '';

      const creds = cfg.credentials || {};
      const mailStatus = document.getElementById('cfgMailCodeStatus');
      if (mailStatus) {
        if (creds.email_auth_code?.configured) {
          mailStatus.textContent = `已配置 (${creds.email_auth_code.masked})`;
          mailStatus.style.color = 'var(--md-sys-color-success)';
        } else {
          mailStatus.textContent = '未配置';
          mailStatus.style.color = 'var(--md-sys-color-warning)';
        }
      }

      // AI
      const aiStatus = document.getElementById('cfgAIKeyStatus');
      if (aiStatus) {
        if (creds.gemini_api_key?.configured) {
          aiStatus.textContent = `已配置 (${creds.gemini_api_key.masked})`;
          aiStatus.style.color = 'var(--md-sys-color-success)';
        } else {
          aiStatus.textContent = '未配置';
          aiStatus.style.color = 'var(--md-sys-color-warning)';
        }
      }
    } catch (e) {
      console.error('获取系统配置失败:', e);
    }
  },

  async saveMailConfig() {
    const imap_host = document.getElementById('cfgImapHost').value.trim();
    const imap_port = parseInt(document.getElementById('cfgImapPort').value || '993', 10);
    const username = document.getElementById('cfgImapUser').value.trim();
    const auth_code = document.getElementById('cfgImapCode').value.trim();

    const payload = {
      mail_sync: { imap_host, imap_port, username, enabled: true },
      credentials: auth_code ? { email_auth_code: auth_code } : {}
    };

    try {
      await API.updateConfig(payload);
      Toast.success('邮箱同步配置已保存！');
    } catch (e) {
      Toast.error(`保存失败: ${e.message}`);
    }
  },

  async testMail() {
    const imap_host = document.getElementById('cfgImapHost').value.trim();
    const imap_port = parseInt(document.getElementById('cfgImapPort').value || '993', 10);
    const username = document.getElementById('cfgImapUser').value.trim();
    const auth_code = document.getElementById('cfgImapCode').value.trim();

    Toast.info('正在测试 IMAP 连接...');
    try {
      const res = await API.testMailSync({ imap_host, imap_port, username, auth_code });
      if (res.success) Toast.success(res.message);
      else Toast.error(res.message);
    } catch (e) {
      Toast.error(`测试失败: ${e.message}`);
    }
  },

  async saveAIConfig() {
    const apiKey = document.getElementById('cfgGeminiKey').value.trim();
    if (!apiKey) {
      Toast.warning('请输入 API 密钥');
      return;
    }

    try {
      await API.updateConfig({ credentials: { gemini_api_key: apiKey } });
      Toast.success('Gemini API 密钥已加密保存！');
      document.getElementById('cfgGeminiKey').value = '';
      this.loadConfig();
    } catch (e) {
      Toast.error(`保存失败: ${e.message}`);
    }
  },

  async testAI() {
    const apiKey = document.getElementById('cfgGeminiKey').value.trim();
    Toast.info('正在测试 Gemini 连通性...');
    try {
      const res = await API.testAIKey(apiKey);
      if (res.success) Toast.success(res.message);
      else Toast.error(res.message);
    } catch (e) {
      Toast.error(`测试失败: ${e.message}`);
    }
  },

  // ------------------------------------------------------------------------
  // 5. 备份与还原
  // ------------------------------------------------------------------------
  renderLedgerStatus() {
    const statusBox = document.getElementById('ledgerValidationStatus');
    if (!statusBox) return;

    const st = State.status;
    if (st && st.ledger_valid) {
      statusBox.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; color: var(--md-sys-color-success); font-weight: 600;">
          <span class="status-dot"></span> Beancount 复式账本校验成功：0 错误，借贷完全平衡！
        </div>
      `;
    } else if (st && st.validation_errors) {
      statusBox.innerHTML = `
        <div style="color: var(--md-sys-color-error);">
          <div style="font-weight: bold; margin-bottom: 6px;">⚠ 账本校验发现警告/差额：</div>
          <ul style="padding-left: 20px; font-size: 13px;">
            ${st.validation_errors.map(err => `<li>${err}</li>`).join('')}
          </ul>
        </div>
      `;
    }
  },

  async triggerExportBackup() {
    Toast.info('正在打包并生成账本备份压缩包 (ZIP)...');
    try {
      await API.exportBackup();
      Toast.success('备份文件已成功生成并下载！');
    } catch (e) {
      Toast.error(`备份导出失败: ${e.message}`);
    }
  },

  async triggerImportBackup(fileInput) {
    if (!fileInput.files || !fileInput.files[0]) return;
    const file = fileInput.files[0];

    const ok = await Dialog.confirm({
      title: '还原账本数据确认',
      message: `确定要从备份包 ${file.name} 还原账本吗？当前数据将自动生成还原前快照。`,
      confirmText: '确认还原',
      isDanger: true
    });
    if (!ok) {
      fileInput.value = '';
      return;
    }

    Toast.info('正在解压并校验还原数据...');
    try {
      const res = await API.importBackup(file);
      Toast.success(res.message || '账本数据还原成功！');
      fileInput.value = '';
      await App.refreshData();
    } catch (e) {
      Toast.error(`还原失败: ${e.message}`);
    }
  },

  // ------------------------------------------------------------------------
  // 6. 对账校准
  // ------------------------------------------------------------------------
  async checkReconciliation() {
    const account = document.getElementById('reconAccountSelect').value;
    const date = document.getElementById('reconDate').value;
    const actualBalance = parseFloat(document.getElementById('reconActualBalance').value);

    if (!account || !date || isNaN(actualBalance)) {
      Toast.warning('请填写完整的对账账户、日期与实际银行对账单余额！');
      return;
    }

    try {
      const res = await API.checkReconciliation(account, date, actualBalance);
      const diff = Number(res.difference || 0);
      const resDiv = document.getElementById('reconResultDiv');
      resDiv.style.display = 'block';

      if (diff === 0) {
        resDiv.innerHTML = `
          <div style="padding: 16px; background: var(--md-sys-color-success-container); color: var(--md-sys-color-on-success-container); border-radius: var(--md-shape-sm);">
            ✓ 账目完美匹配！账面余额 (¥${Number(res.book_balance).toFixed(2)}) 与银行对账单完全一致。
          </div>
        `;
      } else {
        resDiv.innerHTML = `
          <div style="padding: 16px; background: var(--md-sys-color-warning-container); color: var(--md-sys-color-on-warning-container); border-radius: var(--md-shape-sm);">
            <div>存在差额: <b>¥${diff.toFixed(2)}</b> (账面: ¥${Number(res.book_balance).toFixed(2)}，实际: ¥${actualBalance.toFixed(2)})</div>
            <div style="margin-top: 12px;">
              <button class="m3-btn btn-filled btn-sm" onclick="SettingsView.applyReconAdjustment('${account}', '${date}', ${actualBalance})">⚡ 一键生成月末对账校准分录</button>
            </div>
          </div>
        `;
      }
    } catch (e) {
      Toast.error(`核对失败: ${e.message}`);
    }
  },

  async applyReconAdjustment(account, date, actualBalance) {
    try {
      await API.adjustReconciliation({ account, date, actual_balance: actualBalance, reason: '月末对账校准' });
      Toast.success('对账校准分录生成成功！账本已完成平衡');
      await App.refreshData();
      document.getElementById('reconResultDiv').style.display = 'none';
    } catch (e) {
      Toast.error(`校准失败: ${e.message}`);
    }
  }
};

window.SettingsView = SettingsView;
