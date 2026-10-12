'use strict';
/** 追加看板控件逻辑：国家/类型切换、日期快捷、双轴折线 */

function pad2n(n) {
  return String(n).padStart(2, '0');
}

function fmtDate(d) {
  return `${d.getFullYear()}-${pad2n(d.getMonth() + 1)}-${pad2n(d.getDate())}`;
}

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// 看板状态
const dashState = {
  country: 'TH',
  promo: 'ALL',
  calCursor: new Date(),
  calPickStart: null,
  calPickEnd: null,
};

function dashRangeParams() {
  const startDate = $('dashStartDate')?.value || '';
  const endDate = $('dashEndDate')?.value || '';
  const params = {
    promotionType: dashState.promo,
  };
  const map = { TH: '7592491286763044881', SG: '7592490087661993992', VN: '7592491009288994832' };
  if (dashState.country && map[dashState.country]) params.accountId = map[dashState.country];
  if (startDate) params.startDate = startDate;
  if (endDate) params.endDate = endDate;
  return params;
}

function drawDualLineChart(canvas, daily) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || canvas.width || 960;
  const cssH = cssW < 430 ? 190 : 260; // 手机上矮一点，少占屏幕
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const labels = (daily || []).map((d) => d.date || '');
  const costs = (daily || []).map((d) => Number(d.cost ?? d.spend ?? 0));
  const orders = (daily || []).map((d) => Number(d.orders ?? 0));
  if (!labels.length) {
    ctx.fillStyle = '#86909c';
    ctx.font = '13px sans-serif';
    ctx.fillText('暂无数据', 16, 28);
    return;
  }

  const padL = 48;
  const padR = 52;
  const padT = 22;
  const padB = 34;
  const maxCost = Math.max(...costs, 1);
  const maxOrders = Math.max(...orders, 1);
  const n = labels.length;
  const xAt = (i) =>
    n === 1 ? (padL + cssW - padR) / 2 : padL + ((cssW - padL - padR) * i) / (n - 1);
  const yCost = (v) => cssH - padB - ((cssH - padT - padB) * v) / maxCost;
  const yOrd = (v) => cssH - padB - ((cssH - padT - padB) * v) / maxOrders;

  // grid + left axis (cost)
  ctx.strokeStyle = '#eceff3';
  ctx.fillStyle = '#86909c';
  ctx.font = '11px sans-serif';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + ((cssH - padT - padB) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(cssW - padR, y);
    ctx.stroke();
    const lv = Math.round(maxCost * (1 - i / 4));
    ctx.textAlign = 'right';
    ctx.fillText(String(lv), padL - 6, y + 4);
    const rv = Math.round(maxOrders * (1 - i / 4));
    ctx.textAlign = 'left';
    ctx.fillText(String(rv), cssW - padR + 6, y + 4);
  }

  // x labels
  ctx.textAlign = 'center';
  const step = Math.max(1, Math.ceil(n / 8));
  labels.forEach((lb, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    const short = lb.length >= 8 ? lb.slice(5).replace(/-/g, ' ') : lb;
    ctx.fillText(short, xAt(i), cssH - 10);
  });

  const strokeSeries = (vals, yFn, color) => {
    ctx.beginPath();
    vals.forEach((v, i) => {
      const x = xAt(i);
      const y = yFn(v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    vals.forEach((v, i) => {
      ctx.beginPath();
      ctx.arc(xAt(i), yFn(v), 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });
  };

  strokeSeries(costs, yCost, '#00b5b8');
  strokeSeries(orders, yOrd, '#f06666');
}

// 丢弃过期响应：切换分流/日期/页面时若旧请求后到，不得覆盖新数据
let dashLoadSeq = 0;

// 计划表现排序：数据存内存，点列头只重渲染不重新请求
let dashCamps = [];
const dashSort = { key: 'cost', dir: 'desc' };
const SORT_LABEL = { name: '计划', cost: '成本', orders: '订单', revenue: '总收入', roi: 'ROI' };

function sortValue(c, key) {
  if (key === 'name') return String(c.campaign_name || '');
  if (key === 'orders') return Number(c.orders ?? 0);
  if (key === 'revenue') return Number(c.gross_revenue ?? 0);
  if (key === 'roi') return Number(c.roi ?? 0);
  return Number(c.cost ?? 0);
}

function renderDashTable() {
  const tbody = $('dashTableBody');
  if (!tbody) return;
  const rows = [...dashCamps].sort((a, b) => {
    const va = sortValue(a, dashSort.key);
    const vb = sortValue(b, dashSort.key);
    let cmp;
    if (typeof va === 'string') cmp = va.localeCompare(vb, 'zh-Hans-CN');
    else cmp = va - vb;
    return dashSort.dir === 'asc' ? cmp : -cmp;
  });
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">暂无计划数据</td></tr>';
  } else {
    tbody.innerHTML = rows
      .map(
        (c) => `<tr>
          <td>${escapeHtml(c.campaign_name)}</td>
          <td>${Number(c.cost ?? 0).toFixed(2)}</td>
          <td>${Number(c.orders ?? 0)}</td>
          <td>${Number(c.gross_revenue ?? 0).toFixed(2)}</td>
          <td>${Number(c.roi ?? 0).toFixed(2)}</td>
        </tr>`
      )
      .join('');
  }
  // 列头箭头跟随排序状态（标题已移除）
  document.querySelectorAll('#dashTable th.sortable').forEach((th) => {
    const on = th.dataset.sort === dashSort.key;
    th.classList.toggle('active', on);
    let arrow = th.querySelector('.sort-arrow');
    if (on) {
      if (!arrow) {
        arrow = document.createElement('span');
        arrow.className = 'sort-arrow';
        th.appendChild(arrow);
      }
      arrow.textContent = dashSort.dir === 'asc' ? '▲' : '▼';
    } else if (arrow) {
      arrow.remove();
    }
  });
}

function bindDashSort() {
  document.querySelectorAll('#dashTable th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (dashSort.key === key) {
        dashSort.dir = dashSort.dir === 'desc' ? 'asc' : 'desc';
      } else {
        dashSort.key = key;
        // 名称默认升序（A→Z），数值默认降序（大→小）
        dashSort.dir = key === 'name' ? 'asc' : 'desc';
      }
      renderDashTable();
    });
  });
}

async function loadDashboard() {
  const seq = ++dashLoadSeq;
  const tbody = $('dashTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">' + (window.listLoadingHtml ? window.listLoadingHtml() : '加载中…') + '</td></tr>';
  try {
    const range = dashRangeParams();
    const r = await bridge.reports.dashboard(range);
    if (seq !== dashLoadSeq) return; // 已有更新的请求，丢弃本次结果
    if (!r.ok) {
      toast(r.error || '看板加载失败', 'err');
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="empty">${escapeHtml(r.error || '失败')}</td></tr>`;
      return;
    }
    const s = r.summary || {};
    const set = (id, v) => {
      const el = $(id);
      if (el) el.textContent = v;
    };
    set('kpiSpend', Number(s.cost ?? s.spend ?? 0).toFixed(2));
    set('kpiOrders', String(s.orders ?? 0).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
    set('kpiAov', Number(s.aov ?? 0).toFixed(2));
    set('kpiRevenue', Number(s.revenue ?? 0).toFixed(2));
    set('kpiRoi', Number(s.roi ?? 0).toFixed(2));
    set('kpiCtr', Number(s.ctr ?? 0).toFixed(2));

    const note = $('dashNote');
    const mockBadge = $('dashMockBadge');
    if (note) {
      if (r.note) {
        note.classList.remove('hidden');
        note.textContent = r.note;
      } else note.classList.add('hidden');
    }
    if (mockBadge) {
      if (r.mock) mockBadge.classList.remove('hidden');
      else mockBadge.classList.add('hidden');
    }

    const accName = r.accountName || r.country || dashState.country;
    const title = $('dashTitle');
    if (title) title.textContent = `GMV Max · ${accName || '汇总'}`;
    const rangeLabel = $('dashRangeLabel');
    if (rangeLabel) {
      const promo =
        dashState.promo === 'PRODUCT' ? '商品' : dashState.promo === 'LIVE' ? '直播' : '全部';
      const tz = dashState.country === 'VN' ? 'UTC+07' : dashState.country === 'SG' ? 'UTC+08' : 'UTC+07';
      rangeLabel.textContent = `${promo} GMV Max · ${tz} · ${r.startDate || ''} ~ ${r.endDate || ''}`;
    }

    drawDualLineChart($('chartDual'), r.daily || []);

    dashCamps = r.campaigns || [];
    renderDashTable();
  } catch (err) {
    if (seq !== dashLoadSeq) return;
    toast('看板异常: ' + (err.message || err), 'err');
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="empty">${escapeHtml(err.message || '')}</td></tr>`;
  }
}

function setPresetActive(days) {
  document.querySelectorAll('#rangePresets .preset').forEach((btn) => {
    const match = String(btn.dataset.days) === String(days);
    btn.classList.toggle('active', match);
  });
}

function applyPresetDays(days) {
  const n = Number(days);
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  let start;
  let last;
  if (n === 1) {
    // 昨天：起止都是昨天，只统计昨天一天
    start = addDays(end, -1);
    last = addDays(end, -1);
  } else if (n <= 0) {
    start = new Date(end);
    last = new Date(end);
  } else {
    start = addDays(end, -(n - 1)); // 近 N 天 = 含今天共 N 天
    last = new Date(end);
  }
  const s = $('dashStartDate');
  const e = $('dashEndDate');
  const a = fmtDate(start);
  const b = fmtDate(last);
  if (s) s.value = a <= b ? a : b;
  if (e) e.value = a <= b ? b : a;
}

function renderMonth(container, cursor, pickStart, pickEnd) {
  if (!container) return;
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const first = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const week = ['一', '二', '三', '四', '五', '六', '日'];
  const startPad = (first.getDay() + 6) % 7;
  const prevDays = new Date(y, m, 0).getDate();
  let html = `<div class="cal-title">${y} 年 ${m + 1} 月</div>`;
  html += '<div class="cal-grid head">' + week.map((w) => `<div>${w}</div>`).join('') + '</div>';
  html += '<div class="cal-grid">';
  for (let i = 0; i < startPad; i++) {
    const d = prevDays - startPad + 1 + i;
    html += `<div class="day out">${d}</div>`;
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = fmtDate(new Date(y, m, d));
    let cls = 'day';
    if (pickStart && pickEnd) {
      if (key >= pickStart && key <= pickEnd) cls += ' in';
      if (key === pickStart || key === pickEnd) cls += ' edge';
    } else if (pickStart && key === pickStart) {
      cls += ' edge';
    }
    html += `<div class="${cls}" data-date="${key}">${d}</div>`;
  }
  const used = startPad + daysInMonth;
  const tail = used <= 35 ? 35 - used : 42 - used;
  for (let i = 1; i <= tail; i++) {
    html += `<div class="day out">${i}</div>`;
  }
  html += '</div>';
  container.innerHTML = html;
  container.querySelectorAll('.day[data-date]').forEach((el) => {
    el.addEventListener('click', () => onCalPick(el.dataset.date));
  });
}

function onCalPick(date) {
  // 单选模式（直播计划「定时开关」选日期）：选中即回填并关闭
  if ($('rangeCalendar')?.classList.contains('single')) {
    const t = dashState.calSingleTarget;
    if (t) {
      t.value = date;
      t.dispatchEvent(new Event('change'));
    }
    dashState.calPickStart = date;
    renderCal();
    closeRangeCalendar();
    return;
  }
  if (!dashState.calPickStart || (dashState.calPickStart && dashState.calPickEnd)) {
    dashState.calPickStart = date;
    dashState.calPickEnd = null;
  } else if (date >= dashState.calPickStart) {
    dashState.calPickEnd = date;
    const s = $('dashStartDate');
    const e = $('dashEndDate');
    if (s) s.value = dashState.calPickStart;
    if (e) e.value = dashState.calPickEnd;
    setPresetActive('custom');
    $('rangeCalendar')?.classList.add('hidden');
    guard('刷新看板', loadDashboard);
  } else {
    dashState.calPickStart = date;
    dashState.calPickEnd = null;
  }
  renderCal();
}

function renderCal() {
  const a = dashState.calCursor;
  const b = new Date(a.getFullYear(), a.getMonth() + 1, 1);
  const la = $('calLabelA');
  const lb = $('calLabelB');
  if (la) la.textContent = `${a.getFullYear()}-${pad2n(a.getMonth() + 1)}`;
  if (lb) lb.textContent = `${b.getFullYear()}-${pad2n(b.getMonth() + 1)}`;
  renderMonth($('calMonthA'), a, dashState.calPickStart, dashState.calPickEnd);
  renderMonth($('calMonthB'), b, dashState.calPickStart, dashState.calPickEnd);
}

/**
 * 打开日历
 * @param {'range'|'single'} mode range=看板起止日期（默认），single=单日期选择
 * @param {HTMLElement} target single 模式回填的 input
 */
function openRangeCalendar(mode, target) {
  const cal = $('rangeCalendar');
  if (!cal) return;
  const single = mode === 'single' && !!target;
  cal.classList.toggle('single', single);
  cal.classList.remove('hidden');

  // fixed 定位：挂在触发元素下方
  const anchor = single ? target : document.querySelector('.range-bar');
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    const w = cal.offsetWidth || 640;
    let left = Math.round(r.left);
    if (left + w > window.innerWidth - 12) left = Math.max(12, window.innerWidth - w - 12);
    cal.style.top = Math.round(r.bottom + 6) + 'px';
    cal.style.left = left + 'px';
  }

  const hint = document.querySelector('.cal-hint');
  if (single) {
    dashState.calSingleTarget = target;
    const v = target.value;
    dashState.calPickStart = v || null;
    dashState.calPickEnd = null;
    dashState.calCursor = v ? new Date(+v.slice(0, 4), +v.slice(5, 7) - 1, 1) : new Date();
    if (hint) hint.textContent = '点击选择日期';
  } else {
    dashState.calSingleTarget = null;
    dashState.calPickStart = $('dashStartDate')?.value || null;
    dashState.calPickEnd = $('dashEndDate')?.value || null;
    if (hint) hint.textContent = '先点开始日期，再点结束日期；或点左侧快捷范围';
  }
  renderCal();
}

function closeRangeCalendar() {
  $('rangeCalendar')?.classList.add('hidden');
}

(function bindPresets() {
  const rp = document.getElementById('rangePresets');
  if (!rp || rp.dataset.bound) return;
  rp.dataset.bound = '1';
  rp.addEventListener('click', (e) => {
    const btn = e.target.closest('.preset');
    if (!btn) return;
    setPresetActive(btn.dataset.days);
    applyPresetDays(btn.dataset.days);
    closeRangeCalendar();
    if (typeof guard === 'function') guard('刷新看板', loadDashboard);
    else if (typeof loadDashboard === 'function') loadDashboard();
  });
})();

function bindDashControls() {
  document.querySelectorAll('#countryChips .chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      dashState.country = btn.dataset.country;
      document.querySelectorAll('#countryChips .chip').forEach((b) => b.classList.toggle('active', b === btn));
      guard('刷新看板', loadDashboard);
    });
  });
  document.querySelectorAll('#promoChips .chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      dashState.promo = btn.dataset.promo;
      document.querySelectorAll('#promoChips .chip').forEach((b) => b.classList.toggle('active', b === btn));
      guard('刷新看板', loadDashboard);
    });
  });

  // 图二：点日期区域任意位置 → 弹出图三自定义日历（捕获阶段，避免原生日历抢跑）
  const rangeInputs = document.querySelector('.range-inputs');
  if (rangeInputs) {
    rangeInputs.addEventListener(
      'click',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        openRangeCalendar();
      },
      true
    );
  }
  $('btnCal')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const cal = $('rangeCalendar');
    if (!cal) return;
    if (cal.classList.contains('hidden')) openRangeCalendar();
    else closeRangeCalendar();
  });
  $('calClose')?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeRangeCalendar();
  });

  $('dashStartDate')?.addEventListener('change', () => {
    setPresetActive('custom');
    guard('刷新看板', loadDashboard);
  });
  $('dashEndDate')?.addEventListener('change', () => {
    setPresetActive('custom');
    guard('刷新看板', loadDashboard);
  });

  document.addEventListener(
    'click',
    (e) => {
      const cal = $('rangeCalendar');
      if (!cal || cal.classList.contains('hidden')) return;
      const t = e.target;
      if (
        cal.contains(t) ||
        t === $('btnCal') ||
        t === $('dashStartDate') ||
        t === $('dashEndDate') ||
        t === $('oneshotDate') ||
        (t.closest && (t.closest('.range-bar') || t.closest('#btnCal')))
      ) {
        return;
      }
      closeRangeCalendar();
    },
    true
  );

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeRangeCalendar();
  });

  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const k = btn.dataset.nav;
      if (k === 'pm') dashState.calCursor = new Date(dashState.calCursor.getFullYear(), dashState.calCursor.getMonth() - 1, 1);
      if (k === 'nm') dashState.calCursor = new Date(dashState.calCursor.getFullYear(), dashState.calCursor.getMonth() + 1, 1);
      if (k === 'py') dashState.calCursor = new Date(dashState.calCursor.getFullYear() - 1, dashState.calCursor.getMonth(), 1);
      if (k === 'ny') dashState.calCursor = new Date(dashState.calCursor.getFullYear() + 1, dashState.calCursor.getMonth(), 1);
      renderCal();
    });
  });
}

// 初始化：默认「全部」+ 今天（仅一次）
window.initDashDates = function initDashDates() {
  applyPresetDays(0);
  setPresetActive(0);
};

// 每次进入看板页都回到默认：全部 + 今天
window.resetDashDefaults = function resetDashDefaults() {
  dashState.promo = 'ALL';
  document.querySelectorAll('#promoChips .chip').forEach((b) => {
    b.classList.toggle('active', b.dataset.promo === 'ALL');
  });
  window.initDashDates();
};
window.initDashDates();

bindDashControls();
bindDashSort();

// 通知 app.js：看板控件与新版 loadDashboard 已就绪，可以拉首屏数据
if (typeof window.__markDashUiReady === 'function') window.__markDashUiReady();
