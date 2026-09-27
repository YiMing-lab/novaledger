/**
 * Native Offline SVG/Canvas Chart Engine for Material Design 3
 * 零网络依赖，支持明暗主题自适应、平滑贝塞尔曲线与圆角条形图
 */

const Charts = {
  getPalette() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    return isDark ? [
      '#818cf8', '#34d399', '#f472b6', '#fbbf24', '#60a5fa', 
      '#a78bfa', '#f87171', '#38bdf8', '#fb923c', '#4ade80'
    ] : [
      '#4f46e5', '#059669', '#db2777', '#d97706', '#2563eb', 
      '#7c3aed', '#dc2626', '#0284c7', '#ea580c', '#16a34a'
    ];
  },

  /**
   * 绘制分类环形图 (Donut Chart)
   */
  renderDonut(containerId, items = [], totalAmount = 0) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    if (!items || items.length === 0 || totalAmount <= 0) {
      container.innerHTML = `
        <div style="display: flex; height: 260px; align-items: center; justify-content: center; color: var(--md-sys-color-on-surface-variant);">
          本月暂无支出数据
        </div>
      `;
      return;
    }

    const size = 260;
    const strokeWidth = 34;
    const radius = (size - strokeWidth) / 2;
    const center = size / 2;
    const circumference = 2 * Math.PI * radius;

    const palette = this.getPalette();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', `${size}px`);
    svg.style.overflow = 'visible';

    // 背景底环
    const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    bgCircle.setAttribute('cx', center);
    bgCircle.setAttribute('cy', center);
    bgCircle.setAttribute('r', radius);
    bgCircle.setAttribute('fill', 'none');
    bgCircle.setAttribute('stroke', 'var(--md-sys-color-surface-container-highest)');
    bgCircle.setAttribute('stroke-width', strokeWidth);
    svg.appendChild(bgCircle);

    let currentOffset = 0;
    items.forEach((item, index) => {
      const percentage = item.amount / totalAmount;
      const strokeDasharray = `${percentage * circumference} ${circumference}`;
      const color = palette[index % palette.length];

      const segment = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      segment.setAttribute('cx', center);
      segment.setAttribute('cy', center);
      segment.setAttribute('r', radius);
      segment.setAttribute('fill', 'none');
      segment.setAttribute('stroke', color);
      segment.setAttribute('stroke-width', strokeWidth);
      segment.setAttribute('stroke-dasharray', strokeDasharray);
      segment.setAttribute('stroke-dashoffset', -currentOffset);
      segment.setAttribute('transform', `rotate(-90 ${center} ${center})`);
      segment.style.transition = 'stroke-width 150ms ease';
      segment.style.cursor = 'pointer';

      // 悬浮放大
      segment.onmouseenter = () => segment.setAttribute('stroke-width', strokeWidth + 4);
      segment.onmouseleave = () => segment.setAttribute('stroke-width', strokeWidth);

      // Tooltip title
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${item.name}: ¥${item.amount.toFixed(2)} (${(percentage * 100).toFixed(1)}%)`;
      segment.appendChild(title);

      svg.appendChild(segment);
      currentOffset += percentage * circumference;
    });

    // 中心文本 (总计金额)
    const textGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    textGroup.setAttribute('text-anchor', 'middle');

    const totalLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    totalLabel.setAttribute('x', center);
    totalLabel.setAttribute('y', center - 8);
    totalLabel.setAttribute('fill', 'var(--md-sys-color-on-surface-variant)');
    totalLabel.setAttribute('font-size', '13');
    totalLabel.setAttribute('font-weight', '500');
    totalLabel.textContent = '总支出';

    const totalVal = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    totalVal.setAttribute('x', center);
    totalVal.setAttribute('y', center + 16);
    totalVal.setAttribute('fill', 'var(--md-sys-color-on-surface)');
    totalVal.setAttribute('font-size', '18');
    totalVal.setAttribute('font-weight', 'bold');
    totalVal.setAttribute('font-family', 'var(--md-sys-typescale-font-family-code)');
    totalVal.textContent = `¥${totalAmount.toFixed(0)}`;

    textGroup.appendChild(totalLabel);
    textGroup.appendChild(totalVal);
    svg.appendChild(textGroup);

    // 图例列表
    const legend = document.createElement('div');
    legend.style.display = 'grid';
    legend.style.gridTemplateColumns = 'repeat(auto-fill, minmax(130px, 1fr))';
    legend.style.gap = '8px 12px';
    legend.style.marginTop = '16px';

    items.forEach((item, index) => {
      const color = palette[index % palette.length];
      const pct = ((item.amount / totalAmount) * 100).toFixed(1);
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '6px';
      row.style.fontSize = '12px';
      row.innerHTML = `
        <span style="width: 10px; height: 10px; border-radius: 50%; background-color: ${color}; flex-shrink: 0;"></span>
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--md-sys-color-on-surface);">${item.name}</span>
        <span style="margin-left: auto; color: var(--md-sys-color-on-surface-variant); font-family: var(--md-sys-typescale-font-family-code);">${pct}%</span>
      `;
      legend.appendChild(row);
    });

    container.appendChild(svg);
    container.appendChild(legend);
  },

  /**
   * 绘制收支趋势柱状图与结余折线 (Monthly Trend Bars & Line)
   */
  renderMonthlyTrends(containerId, months = [], incomes = [], expenses = []) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    if (!months || months.length === 0) {
      container.innerHTML = `
        <div style="display: flex; height: 280px; align-items: center; justify-content: center; color: var(--md-sys-color-on-surface-variant);">
          暂无历史月度趋势数据
        </div>
      `;
      return;
    }

    const width = container.clientWidth || 700;
    const height = 300;
    const padding = { top: 30, right: 30, bottom: 40, left: 60 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const maxVal = Math.max(...incomes, ...expenses, 1000) * 1.15;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', `${height}px`);

    // Y 轴刻度参考线
    const gridCount = 4;
    for (let i = 0; i <= gridCount; i++) {
      const y = padding.top + (chartH / gridCount) * i;
      const val = maxVal - (maxVal / gridCount) * i;

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', padding.left);
      line.setAttribute('y1', y);
      line.setAttribute('x2', width - padding.right);
      line.setAttribute('y2', y);
      line.setAttribute('stroke', 'var(--md-sys-color-outline-variant)');
      line.setAttribute('stroke-dasharray', '3,3');
      line.setAttribute('opacity', '0.5');
      svg.appendChild(line);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', padding.left - 8);
      label.setAttribute('y', y + 4);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('fill', 'var(--md-sys-color-on-surface-variant)');
      label.setAttribute('font-size', '11');
      label.setAttribute('font-family', 'var(--md-sys-typescale-font-family-code)');
      label.textContent = `¥${Math.round(val / 1000)}k`;
      svg.appendChild(label);
    }

    const colW = chartW / months.length;
    const barW = Math.max(6, Math.min(20, (colW - 16) / 2));

    const netPoints = [];

    months.forEach((month, idx) => {
      const xCenter = padding.left + colW * idx + colW / 2;
      const inc = incomes[idx] || 0;
      const exp = expenses[idx] || 0;
      const incH = (inc / maxVal) * chartH;
      const expH = (exp / maxVal) * chartH;

      // 收入柱
      const incBar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      incBar.setAttribute('x', xCenter - barW - 2);
      incBar.setAttribute('y', padding.top + chartH - incH);
      incBar.setAttribute('width', barW);
      incBar.setAttribute('height', Math.max(2, incH));
      incBar.setAttribute('rx', '3');
      incBar.setAttribute('fill', 'var(--md-sys-color-success)');
      incBar.style.opacity = '0.85';
      const incTitle = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      incTitle.textContent = `${month} 收入: ¥${inc.toFixed(2)}`;
      incBar.appendChild(incTitle);
      svg.appendChild(incBar);

      // 支出柱
      const expBar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      expBar.setAttribute('x', xCenter + 2);
      expBar.setAttribute('y', padding.top + chartH - expH);
      expBar.setAttribute('width', barW);
      expBar.setAttribute('height', Math.max(2, expH));
      expBar.setAttribute('rx', '3');
      expBar.setAttribute('fill', 'var(--md-sys-color-error)');
      expBar.style.opacity = '0.85';
      const expTitle = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      expTitle.textContent = `${month} 支出: ¥${exp.toFixed(2)}`;
      expBar.appendChild(expTitle);
      svg.appendChild(expBar);

      // X 轴月份标签
      const xLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      xLabel.setAttribute('x', xCenter);
      xLabel.setAttribute('y', height - padding.bottom + 20);
      xLabel.setAttribute('text-anchor', 'middle');
      xLabel.setAttribute('fill', 'var(--md-sys-color-on-surface-variant)');
      xLabel.setAttribute('font-size', '11');
      xLabel.textContent = month.length > 5 ? month.slice(5) + '月' : month;
      svg.appendChild(xLabel);

      // 净结余点
      const net = inc - exp;
      const netY = padding.top + chartH - ((net + maxVal * 0.2) / (maxVal * 1.4)) * chartH;
      netPoints.push({ x: xCenter, y: Math.max(padding.top, Math.min(height - padding.bottom, netY)), net });
    });

    container.appendChild(svg);
  },

  /**
   * 绘制横向条形图 (Horizontal Bar Chart) - 适用于日度支出分布
   */
  renderHorizontalBar(containerId, items = [], options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    if (!items || items.length === 0) {
      container.innerHTML = `
        <div style="display: flex; height: 180px; align-items: center; justify-content: center; color: var(--md-sys-color-on-surface-variant);">
          暂无日度支出分布数据
        </div>
      `;
      return;
    }

    const width = container.clientWidth || 700;
    const rowHeight = 28;
    const padding = { top: 16, right: 90, bottom: 20, left: 110 };
    const chartW = Math.max(100, width - padding.left - padding.right);
    const height = items.length * rowHeight + padding.top + padding.bottom;

    const maxVal = Math.max(...items.map(it => Number(it.amount || 0)), 10) * 1.08;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', `${height}px`);
    svg.style.overflow = 'visible';

    items.forEach((item, idx) => {
      const y = padding.top + idx * rowHeight;
      const amt = Number(item.amount || 0);
      const barW = Math.max(amt > 0 ? 3 : 0, (amt / maxVal) * chartW);
      const isPeak = Boolean(item.is_peak);

      // Y 轴文本标签 (日期与星期)
      const labelText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      labelText.setAttribute('x', padding.left - 12);
      labelText.setAttribute('y', y + rowHeight / 2 + 4);
      labelText.setAttribute('text-anchor', 'end');
      labelText.setAttribute('fill', isPeak ? 'var(--md-sys-color-error)' : 'var(--md-sys-color-on-surface)');
      labelText.setAttribute('font-size', '12');
      labelText.setAttribute('font-weight', isPeak ? '700' : '500');
      labelText.setAttribute('font-family', 'var(--md-sys-typescale-font-family-code)');
      labelText.textContent = item.label || item.date || '';
      svg.appendChild(labelText);

      // 背景底槽
      const bgBar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bgBar.setAttribute('x', padding.left);
      bgBar.setAttribute('y', y + 4);
      bgBar.setAttribute('width', chartW);
      bgBar.setAttribute('height', rowHeight - 8);
      bgBar.setAttribute('rx', '4');
      bgBar.setAttribute('fill', 'var(--md-sys-color-surface-container-highest)');
      bgBar.setAttribute('opacity', '0.4');
      svg.appendChild(bgBar);

      // 数值条形
      if (amt > 0) {
        const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bar.setAttribute('x', padding.left);
        bar.setAttribute('y', y + 4);
        bar.setAttribute('width', barW);
        bar.setAttribute('height', rowHeight - 8);
        bar.setAttribute('rx', '4');
        bar.setAttribute('fill', isPeak ? 'var(--md-sys-color-error)' : 'var(--md-sys-color-primary)');
        bar.style.transition = 'opacity 150ms ease, width 300ms ease';
        bar.style.cursor = 'pointer';

        bar.onmouseenter = () => bar.style.opacity = '0.8';
        bar.onmouseleave = () => bar.style.opacity = '1';

        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = item.tooltip || `${item.label || item.date}: ¥${amt.toFixed(2)}${isPeak ? ' (🔥 月度峰值日)' : ''}`;
        bar.appendChild(title);
        svg.appendChild(bar);
      }

      // 右侧数值标签
      const valText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      valText.setAttribute('x', padding.left + barW + 8);
      valText.setAttribute('y', y + rowHeight / 2 + 4);
      valText.setAttribute('fill', isPeak ? 'var(--md-sys-color-error)' : 'var(--md-sys-color-on-surface-variant)');
      valText.setAttribute('font-size', '11');
      valText.setAttribute('font-weight', isPeak ? '700' : '500');
      valText.setAttribute('font-family', 'var(--md-sys-typescale-font-family-code)');
      valText.textContent = amt > 0 ? `¥${amt.toFixed(2)}${isPeak ? ' 🔥' : ''}` : '¥0.00';
      svg.appendChild(valText);
    });

    container.appendChild(svg);
  },

  /**
   * 绘制多资产趋势折线图 (Multi-Line Chart) - 支持按月/按日资产走势
   */
  renderMultiLine(containerId, xLabels = [], seriesList = [], options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    const activeSeries = (seriesList || []).filter(s => s.visible !== false);
    if (!xLabels || xLabels.length === 0 || activeSeries.length === 0) {
      container.innerHTML = `
        <div style="display: flex; height: 300px; align-items: center; justify-content: center; color: var(--md-sys-color-on-surface-variant);">
          暂无资产账户折线数据或所有账户均被隐藏
        </div>
      `;
      return;
    }

    const width = container.clientWidth || 720;
    const height = 320;
    const padding = { top: 25, right: 35, bottom: 45, left: 75 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    // 计算 Y 轴上下界
    const allVals = [];
    activeSeries.forEach(s => {
      (s.data || []).forEach(v => {
        if (v !== null && v !== undefined && !isNaN(v)) allVals.push(Number(v));
      });
    });

    let minVal = allVals.length > 0 ? Math.min(...allVals) : 0;
    let maxVal = allVals.length > 0 ? Math.max(...allVals) : 100;
    if (minVal > 0) minVal = 0; // 资产通常从 0 起算，除非有负债/透支

    const span = (maxVal - minVal) || 100;
    maxVal = maxVal + span * 0.12;
    minVal = minVal - (minVal < 0 ? Math.abs(minVal) * 0.05 : 0);
    const range = (maxVal - minVal) || 1;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', `${height}px`);
    svg.style.overflow = 'visible';

    // 绘制 Y 轴水平网格刻度线
    const gridCount = 4;
    for (let i = 0; i <= gridCount; i++) {
      const y = padding.top + (chartH / gridCount) * i;
      const val = maxVal - (range / gridCount) * i;

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', padding.left);
      line.setAttribute('y1', y);
      line.setAttribute('x2', width - padding.right);
      line.setAttribute('y2', y);
      line.setAttribute('stroke', 'var(--md-sys-color-outline-variant)');
      line.setAttribute('stroke-dasharray', '3,3');
      line.setAttribute('opacity', '0.45');
      svg.appendChild(line);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', padding.left - 8);
      label.setAttribute('y', y + 4);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('fill', 'var(--md-sys-color-on-surface-variant)');
      label.setAttribute('font-size', '11');
      label.setAttribute('font-family', 'var(--md-sys-typescale-font-family-code)');
      const formattedVal = Math.abs(val) >= 10000 ? `¥${(val / 1000).toFixed(1)}k` : `¥${Math.round(val)}`;
      label.textContent = formattedVal;
      svg.appendChild(label);
    }

    const xCount = xLabels.length;
    const getX = (idx) => {
      if (xCount <= 1) return padding.left + chartW / 2;
      return padding.left + (idx / (xCount - 1)) * chartW;
    };
    const getY = (val) => {
      return padding.top + chartH - ((val - minVal) / range) * chartH;
    };

    // 绘制 X 轴标签（自适应跳步，避免拥挤）
    const step = xCount > 18 ? (xCount > 25 ? 3 : 2) : 1;
    xLabels.forEach((xLabel, idx) => {
      if (idx % step === 0 || idx === xCount - 1) {
        const x = getX(idx);
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', x);
        text.setAttribute('y', height - padding.bottom + 20);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', 'var(--md-sys-color-on-surface-variant)');
        text.setAttribute('font-size', '11');
        text.setAttribute('font-family', 'var(--md-sys-typescale-font-family-code)');
        // 简化展示：若为 "2026-09" 呈现 "09月"，若为 "01日" 呈现 "01日"
        const cleanLabel = xLabel.length === 7 ? xLabel.slice(5) + '月' : xLabel;
        text.textContent = cleanLabel;
        svg.appendChild(text);
      }
    });

    const palette = this.getPalette();

    // 绘制各资产曲线与端点
    activeSeries.forEach((series, sIdx) => {
      const color = series.color || palette[sIdx % palette.length];
      const pts = (series.data || []).map((val, idx) => ({
        x: getX(idx),
        y: getY(Number(val || 0)),
        val: Number(val || 0),
        label: xLabels[idx] || ''
      }));

      if (pts.length === 0) return;

      // 折线路径
      const pathD = pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathD);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', '2.5');
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('stroke-linecap', 'round');
      svg.appendChild(path);

      // 数据圆点
      pts.forEach(p => {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', p.x.toFixed(1));
        circle.setAttribute('cy', p.y.toFixed(1));
        circle.setAttribute('r', xCount > 20 ? '2.5' : '3.5');
        circle.setAttribute('fill', 'var(--md-sys-color-surface)');
        circle.setAttribute('stroke', color);
        circle.setAttribute('stroke-width', '2');
        circle.style.cursor = 'pointer';
        circle.style.transition = 'r 150ms ease';

        circle.onmouseenter = () => circle.setAttribute('r', '5.5');
        circle.onmouseleave = () => circle.setAttribute('r', xCount > 20 ? '2.5' : '3.5');

        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = `${series.name} [${p.label}]: ¥${p.val.toFixed(2)}`;
        circle.appendChild(title);
        svg.appendChild(circle);
      });
    });

    container.appendChild(svg);
  }
};

window.Charts = Charts;

