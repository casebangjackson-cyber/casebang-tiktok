'use strict';

/** 浏览器预览时的降级 API */
const browserFallback = {
  _mem: {
    campaigns: [
      { campaign_id: 'mock_c1', campaign_name: '直播计划A · GMV Max', status: 'ENABLE', campaign_type: 'GMV_MAX' },
      { campaign_id: 'mock_c2', campaign_name: '直播计划B · GMV Max', status: 'DISABLE', campaign_type: 'GMV_MAX' },
    ],
    schedules: [],
    runs: [],
    logs: [{ ts: new Date().toISOString(), level: 'warn', source: 'preview', message: '浏览器预览模式，无法真正控制' }],
    status: {
      mode: 'PREVIEW',
      mock: true,
      tiktok: { authorized: false, advertiserId: '' },
      feishu: { connected: false, appId: '' },
      scheduler: false,
      schedules: 0,
    },
  },
  status: async function () {
    return this._mem.status;
  },
  logs: async function () {
    return this._mem.logs;
  },
  tiktok: {
    startAuth: async () => ({ ok: false, error: '请在桌面端 (npm start) 中授权' }),
    advertisers: async () => ({ ok: false, error: 'preview', list: [] }),
    setAdvertiser: async () => ({ ok: false }),
    campaigns: async () => ({ ok: true, list: browserFallback._mem.campaigns }),
    toggle: async (id, action) => {
      const c = browserFallback._mem.campaigns.find((x) => x.campaign_id === id);
      if (c) c.status = action === 'enable' ? 'ENABLE' : 'DISABLE';
      return { ok: true };
    },
  },
  sched: {
    list: async () => browserFallback._mem.schedules,
    runs: async () => browserFallback._mem.runs,
    upsert: async (item) => {
      const list = browserFallback._mem.schedules;
      if (item.id) {
        const i = list.findIndex((s) => s.id === item.id);
        if (i >= 0) list[i] = { ...list[i], ...item };
        else list.unshift(item);
      } else {
        item.id = 'sch_' + Date.now();
        list.unshift(item);
      }
      return list;
    },
    remove: async (id) => {
      browserFallback._mem.schedules = browserFallback._mem.schedules.filter((s) => s.id !== id);
      return browserFallback._mem.schedules;
    },
    start: async () => ({ ok: false, error: 'preview' }),
    stop: async () => ({ ok: true }),
    tick: async () => [],
  },
  feishu: {
    connect: async () => ({ ok: false, error: '请在桌面端连接飞书' }),
    disconnect: async () => ({ ok: true }),
  },
  reports: {
    dashboard: async () => ({
      ok: true,
      mock: true,
      daily: [],
      campaigns: [],
      summary: { spend: 0, impressions: 0, clicks: 0, conversions: 0, ctr: 0, cpa: 0 },
      note: '浏览器预览',
      accountId: '7592491286763044881',
      accountName: '泰国',
      country: 'TH',
      accounts: [
        { id: '7592491286763044881', name: '泰国', country: 'TH', storeName: 'CASEBANG TH' },
        { id: '7592491009288994832', name: '越南', country: 'VN', storeName: 'CASEBANG VN' },
        { id: '7592490087661993992', name: '新加坡', country: 'SG', storeName: 'CASEBANG SG' },
      ],
    }),
  },
  onState: () => {},
  auto: {
    list: async () => [],
    get: async () => null,
    upsert: async () => ({ ok: false, error: 'preview' }),
    remove: async () => ({ ok: true }),
    master: async () => ({ ok: false, error: 'preview' }),
    segmentEnabled: async () => ({ ok: false, error: 'preview' }),
    execItems: async () => [],
    runs: async () => [],
  },
};

/** 会话 token：登录后写入，长期有效，只有主动退出才清掉 */
const SESSION_KEY = 'casebang_session';
function getSessionToken() {
  try {
    return localStorage.getItem(SESSION_KEY) || '';
  } catch {
    return '';
  }
}
function setSessionToken(t) {
  try {
    if (t) localStorage.setItem(SESSION_KEY, t);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* 隐私模式下 localStorage 可能不可用 */
  }
}

/** HTTP 桥：手机浏览器 / 局域网访问时，走 server 的 /api 接口（真实控制） */
const httpBridge = async function (path, opts) {
  const headers = { ...(opts && opts.headers) };
  const token = getSessionToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (opts && opts.body) headers['Content-Type'] = 'application/json';

  let r;
  try {
    r = await fetch(path, { ...opts, headers });
  } catch (e) {
    const err = new Error('无法连接电脑端服务');
    err.cause = e;
    throw err;
  }

  if (r.status === 401) {
    const j = await r.json().catch(() => ({}));
    if (j.needLogin) {
      showAuthGate();
      const e = new Error('请先登录');
      e.needLogin = true;
      throw e;
    }
    const e = new Error(j.error || 'HTTP 401');
    e.needLogin = true;
    throw e;
  }
  if (r.status === 404) {
    const e = new Error('接口不存在');
    e.notFound = true;
    throw e;
  }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
};

const httpApi = {
  isDesktop: false,
  status: () => httpBridge('/api/status'),
  logs: () => httpBridge('/api/logs'),
  openExternal: (url) => {
    window.open(url, '_blank', 'noopener');
    return Promise.resolve({ ok: true });
  },
  tiktok: {
    startAuth: () => httpBridge('/api/tiktok/auth', { method: 'POST', body: '{}' }),
    advertisers: () => httpBridge('/api/tiktok/advertisers'),
    setAdvertiser: (id) =>
      httpBridge('/api/tiktok/advertiser', { method: 'POST', body: JSON.stringify({ advertiserId: id }) }),
    campaigns: () => httpBridge('/api/tiktok/campaigns'),
    toggle: (campaignId, action) =>
      httpBridge('/api/tiktok/toggle', {
        method: 'POST',
        body: JSON.stringify({ campaignId, action }),
      }),
  },
  auto: {
    list: () => httpBridge('/api/auto/list'),
    get: (campaignId) => httpBridge('/api/auto/get?campaignId=' + encodeURIComponent(campaignId)),
    upsert: (payload) =>
      httpBridge('/api/auto/upsert', { method: 'POST', body: JSON.stringify(payload) }),
    remove: (campaignId) =>
      httpBridge('/api/auto/remove', { method: 'POST', body: JSON.stringify({ campaignId }) }),
    master: (campaignId, enabled) =>
      httpBridge('/api/auto/master', {
        method: 'POST',
        body: JSON.stringify({ campaignId, enabled }),
      }),
    segmentEnabled: (campaignId, segmentId, enabled) =>
      httpBridge('/api/auto/segment', {
        method: 'POST',
        body: JSON.stringify({ campaignId, segmentId, enabled }),
      }),
    execItems: () => httpBridge('/api/auto/execItems'),
    runs: () => httpBridge('/api/auto/runs'),
  },
  sched: {
    list: () => httpBridge('/api/sched/list'),
    runs: () => httpBridge('/api/sched/runs'),
    upsert: (item) =>
      httpBridge('/api/sched/upsert', { method: 'POST', body: JSON.stringify(item) }),
    remove: (id) =>
      httpBridge('/api/sched/remove', { method: 'POST', body: JSON.stringify({ id }) }),
    start: () => httpBridge('/api/sched/start', { method: 'POST', body: '{}' }),
    stop: () => httpBridge('/api/sched/stop', { method: 'POST', body: '{}' }),
    tick: () => httpBridge('/api/sched/tick', { method: 'POST', body: '{}' }),
  },
  feishu: {
    connect: () => httpBridge('/api/feishu/connect', { method: 'POST', body: '{}' }),
    disconnect: () => httpBridge('/api/feishu/disconnect', { method: 'POST', body: '{}' }),
  },
  reports: {
    dashboard: (range) =>
      httpBridge('/api/reports/dashboard', { method: 'POST', body: JSON.stringify(range || {}) }),
  },
  onState: null, // boot 时按需挂 SSE
};

// 注意：不能叫 api —— 会与 preload 的 window.api 全局名冲突导致 SyntaxError
let bridge = window.api || browserFallback;
const isDesktop = !!window.api;
/** 是否已连上电脑端 /api（手机端实时模式） */
let liveApi = false;

// 桌面端走 IPC、本地文件是演示模式，都不需要登录：先把登录门收起，避免闪一下
// 注意：这里在 $ 定义之前，必须直接用 document，不能用 $
if (isDesktop || !/^https?:$/.test(location.protocol)) {
  document.getElementById('authGate')?.setAttribute('hidden', '');
}

const canControl = () => isDesktop || liveApi;

/** 服务端是否配了发信渠道（决定注册入口怎么提示） */
let smtpEnabled = false;

/** 探测 /api 是否存在；手机直接打开本地文件时会失败 → 继续用演示数据 */
async function probeApi() {
  if (isDesktop) return false;
  if (!/^https?:$/.test(location.protocol)) return false;
  try {
    const r = await fetch('/api/ping', { headers: { Accept: 'application/json' } });
    if (!r.ok) return false;
    const j = await r.json();
    smtpEnabled = !!(j && j.smtp);
    return !!(j && j.ok);
  } catch {
    return false;
  }
}

/** 登录页底部提示：有没有发信渠道，注册入口不一样 */
function updateAuthTips() {
  const tip = document.querySelector('#formPassword .auth-tip');
  if (tip) {
    tip.textContent = smtpEnabled
      ? '还没注册的邮箱，请先用「邮箱验证码」登录并设置密码'
      : '还没注册的邮箱，填好密码即可直接创建账号';
  }
}

/** SSE 实时推送：EventSource 无法带请求头，token 走 query */
let sseClient = null;
let sseToken = '';

function attachStateListener() {
  if (!liveApi) return;
  const token = getSessionToken();
  if (!token || token === sseToken) return;
  detachStateListener();
  const refresh = () => {
    refreshStatus();
    loadSlotRuns();
    loadLogs();
  };
  try {
    sseClient = new EventSource('/api/stream?token=' + encodeURIComponent(token));
    sseToken = token;
    sseClient.onmessage = refresh;
    sseClient.onerror = () => {
      /* 断线由浏览器自动重连 */
    };
  } catch {
    sseClient = null;
    /* 不支持 SSE 就靠 15s 轮询 */
  }
}

function detachStateListener() {
  if (sseClient) {
    try {
      sseClient.close();
    } catch {
      /* ignore */
    }
  }
  sseClient = null;
  sseToken = '';
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

let toastTimer = null;
function toast(message, type = 'ok', ms = 3200) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast ' + type;
  }, ms);
}

function setHint(html, isErr = false) {
  const hint = document.getElementById('authHint');
  if (!hint) return;
  hint.classList.remove('hidden');
  hint.classList.toggle('err', !!isErr);
  hint.innerHTML = html;
}

function showModeBanner() {
  const banner = document.getElementById('modeBanner');
  const note = document.getElementById('previewNote');
  if (isDesktop) {
    banner?.classList.add('hidden');
    note?.classList.add('hidden');
    return;
  }
  if (liveApi) {
    banner?.classList.add('hidden');
    note?.classList.add('hidden');
    return;
  }
  // 既不是桌面端、也没连上 /api：只能演示
  banner?.classList.remove('hidden');
  if (banner) {
    banner.innerHTML =
      '当前是<strong>演示模式</strong>，数据与开关不会真实生效。要在手机上实时操作，请让电脑保持运行（<code>npm start</code>），' +
      '手机与电脑连同一个 Wi-Fi 后访问电脑打印的地址。';
  }
  note?.classList.remove('hidden');
}

const $ = (id) => document.getElementById(id);

let campaignsCache = [];
let autoMode = 'days';
let activeCountry = '__all__';
let selectedCampaignId = '';
const CAMP_PAGE_SIZE = 10;
let campPage = 1;
// 分时段草稿：dayHours['YYYY-MM-DD'] = [48 个布尔]（每格 30 分钟）
// slot = hour*2 + (minute >= 30 ? 1 : 0)
let dayHours = {};
// 网格当前显示的月份
let gridMonth = new Date();
// 定时开关「排期预览」网格的月份
let oneshotPreviewMonth = new Date();
const SLOT_COUNT = 48;

function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function cloneDayHours(src) {
  const out = {};
  if (src && typeof src === 'object') {
    for (const key of Object.keys(src)) {
      const arr = src[key];
      if (!Array.isArray(arr)) continue;
      if (arr.length <= 24) {
        // 旧的小时粒度 → 半小时粒度
        out[key] = arr.flatMap((v) => [!!v, !!v]);
      } else {
        out[key] = Array.from({ length: SLOT_COUNT }, (_, i) => !!arr[i]);
      }
    }
  }
  return out;
}

function dayHoursFor(key) {
  if (!Array.isArray(dayHours[key]) || dayHours[key].length !== SLOT_COUNT) {
    const prev = Array.isArray(dayHours[key]) ? dayHours[key] : [];
    dayHours[key] = Array.from(
      { length: SLOT_COUNT },
      (_, i) => (prev.length <= 24 ? !!prev[Math.floor(i / 2)] : !!prev[i])
    );
  }
  return dayHours[key];
}

/** 日期区间清空后不要留下“已配置空日期”，否则会被当成当天不投放 */
function dropEmptyDays() {
  for (const key of Object.keys(dayHours)) {
    if (!Array.isArray(dayHours[key]) || !dayHours[key].some(Boolean)) delete dayHours[key];
  }
}

function gridDaysInMonth() {
  return new Date(gridMonth.getFullYear(), gridMonth.getMonth() + 1, 0).getDate();
}

function fmtMonth(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fmtDayLabel(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][dt.getDay()];
  const base = `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} ${week}`;
  return y === new Date().getFullYear() ? base : `${y}-${base}`;
}

const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
let gridDrag = null; // { value: boolean }

/** 半小时槽 → HH:MM（slot 48 = 24:00） */
function slotLabel(slot) {
  const total = slot * 30;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 构建「当月 1~31 天 × 48 个半小时」网格（换月时重建） */
function buildDayGrid() {
  const grid = $('weekGrid');
  if (!grid) return;
  const stamp = `${gridMonth.getFullYear()}-${gridMonth.getMonth()}`;
  if (grid.dataset.built === stamp) return;
  grid.dataset.built = stamp;
  grid.innerHTML = '';
  const days = gridDaysInMonth();
  grid.style.setProperty('--wg-cols', String(days));

  const today = ymd(new Date());
  const head = document.createElement('div');
  head.className = 'wg-row wg-head';
  head.appendChild(Object.assign(document.createElement('div'), { className: 'wg-corner' }));
  for (let day = 1; day <= days; day++) {
    const date = new Date(gridMonth.getFullYear(), gridMonth.getMonth(), day);
    const c = document.createElement('div');
    c.className = 'wg-day';
    c.innerHTML = `<b>${date.getMonth() + 1}/${day}</b><i>${WEEK_CN[date.getDay()].slice(1)}</i>`;
    if (ymd(date) === today) c.classList.add('today');
    head.appendChild(c);
  }
  grid.appendChild(head);

  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const row = document.createElement('div');
    // 整点行正常显示，半点行弱化
    row.className = 'wg-row' + (slot % 2 === 1 ? ' half' : '');
    const lab = document.createElement('div');
    lab.className = 'wg-hour';
    lab.textContent = slotLabel(slot);
    row.appendChild(lab);
    for (let day = 1; day <= days; day++) {
      const cell = document.createElement('div');
      cell.className = 'wg-slot';
      cell.dataset.date = ymd(new Date(gridMonth.getFullYear(), gridMonth.getMonth(), day));
      cell.dataset.slot = String(slot);
      row.appendChild(cell);
    }
    grid.appendChild(row);
  }
  bindGridEvents();
}

function bindGridEvents() {
  const grid = $('weekGrid');
  if (!grid || grid.dataset.bound) return;
  grid.dataset.bound = '1';

  const cellOf = (e) => e.target.closest?.('.wg-slot');
  const paint = (cell, value) => {
    const key = cell.dataset.date;
    const slot = Number(cell.dataset.slot);
    dayHoursFor(key)[slot] = value;
    dropEmptyDays();
    cell.classList.toggle('on', value);
    renderSlotSummary();
    updateMonthHint();
  };

  // 统一用 pointer 事件：鼠标可拖动连选，手指点按切换（保留页面滚动）
  grid.addEventListener('pointerdown', (e) => {
    const cell = cellOf(e);
    if (!cell) return;
    const arr = dayHoursFor(cell.dataset.date);
    const next = !arr[Number(cell.dataset.slot)];
    if (e.pointerType !== 'mouse') {
      paint(cell, next);
      return;
    }
    e.preventDefault();
    gridDrag = { value: next };
    paint(cell, gridDrag.value);
  });

  grid.addEventListener('pointermove', (e) => {
    if (!gridDrag || e.pointerType !== 'mouse') return;
    if (!e.buttons) {
      gridDrag = null;
      return;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el && el.closest ? el.closest('.wg-slot') : null;
    if (cell && grid.contains(cell)) paint(cell, gridDrag.value);
  });
}

// 松开指针即结束拖选（含拖出网格外的情况）
document.addEventListener('pointerup', () => {
  gridDrag = null;
});
document.addEventListener('pointercancel', () => {
  gridDrag = null;
});

function refreshDayGrid() {
  buildDayGrid();
  const grid = $('weekGrid');
  if (grid) {
    grid.querySelectorAll('.wg-slot').forEach((cell) => {
      const arr = dayHours[cell.dataset.date];
      cell.classList.toggle('on', !!(arr && arr[Number(cell.dataset.slot)]));
    });
  }
  const label = $('monthLabel');
  if (label) label.textContent = fmtMonth(gridMonth);
  renderSlotSummary();
  updateMonthHint();
}

function updateMonthHint() {
  const hint = $('monthHint');
  if (!hint) return;
  const prefix = `${gridMonth.getFullYear()}-${String(gridMonth.getMonth() + 1).padStart(2, '0')}`;
  const n = Object.keys(dayHours).filter((k) => k.startsWith(prefix)).length;
  hint.textContent = n ? `本月已设置 ${n} 天` : '本月未设置';
}

/** 某天的连续半小时槽合并成区间 */
function rangesOf(arr) {
  const ranges = [];
  let start = -1;
  for (let slot = 0; slot <= SLOT_COUNT; slot++) {
    const on = slot < SLOT_COUNT && arr[slot];
    if (on && start < 0) start = slot;
    if (!on && start >= 0) {
      ranges.push([start, slot]);
      start = -1;
    }
  }
  return ranges;
}

function renderSlotSummary() {
  const box = $('slotSummary');
  if (!box) return;
  // 按天一行：日期 + 当天所有时段，全部展开不滚动
  const byDay = [];
  for (const key of Object.keys(dayHours).sort()) {
    const arr = dayHours[key];
    if (!arr || !arr.some(Boolean)) continue;
    byDay.push({ key, ranges: rangesOf(arr) });
  }
  if (!byDay.length) {
    box.innerHTML = '<div class="empty">暂无时段</div>';
    return;
  }
  box.innerHTML = byDay
    .map(
      (d) =>
        `<div class="sum-row"><span class="sum-day">${fmtDayLabel(d.key)}</span><span class="sum-chips">` +
        d.ranges
          .map(
            ([s, e]) =>
              `<button type="button" class="slot-chip" data-key="${d.key}" data-start="${s}" data-end="${e}">` +
              `${slotLabel(s)} - ${e >= SLOT_COUNT ? '24:00' : slotLabel(e)}` +
              `<span class="x">×</span></button>`
          )
          .join('') +
        `</span></div>`
    )
    .join('');
  box.querySelectorAll('.slot-chip').forEach((chip) => {
    chip.onclick = () => {
      const arr = dayHoursFor(chip.dataset.key);
      const s = Number(chip.dataset.start);
      const e = Number(chip.dataset.end);
      for (let slot = s; slot < e; slot++) arr[slot] = false;
      dropEmptyDays();
      refreshDayGrid();
    };
  });
}

function applyModeTabs() {
  document
    .querySelectorAll('.mode-tab')
    .forEach((b) => b.classList.toggle('active', (b.dataset.mode || 'days') === autoMode));
  $('panelWeekly')?.classList.toggle('hidden', autoMode !== 'days');
  $('panelAllday')?.classList.toggle('hidden', autoMode !== 'allday');
  $('panelOneshot')?.classList.toggle('hidden', autoMode !== 'oneshot');
  if (autoMode === 'oneshot') renderOneshotPreview();
}

function todayKey() {
  return ymd(new Date());
}

/**
 * 过期排期剪枝（统一口径：时段结束时刻 ≤ 当前时刻 = 过期）
 * - 日期早于今天 → 整天删除
 * - 日期是今天 → 只保留「结束时刻还在未来」的半小时槽（如 00:00-01:00 在 01:00 后即过期）
 * - 日期在今天之后 → 保留
 * 返回新的 dayHours（不改动入参）
 */
function pruneExpiredSlots(hours) {
  const nowMs = Date.now();
  const today = todayKey();
  const out = {};
  for (const key of Object.keys(hours || {})) {
    if (key < today) continue;
    const arr = hours[key];
    if (!Array.isArray(arr)) continue;
    if (key > today) {
      out[key] = arr;
      continue;
    }
    const dayStart = new Date(`${key}T00:00`).getTime();
    const kept = arr.map((v, slot) =>
      v && dayStart + (slot + 1) * 30 * 60 * 1000 > nowMs ? true : false
    );
    if (kept.some(Boolean)) out[key] = kept;
  }
  return out;
}

function renderOneshotStatus(os, mode) {
  const el = $('oneshotStatus');
  if (!el) return;
  if (mode !== 'oneshot' || !os || !os.date || !os.time) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.classList.remove('hidden');
  const today = todayKey();
  const act = os.action === 'disable' ? '关闭' : '开启';
  if (os.done) {
    el.textContent = `已完成：${os.date} ${os.time} ${act}（已失效，不再干预）`;
  } else if (os.date < today) {
    el.textContent = `已过期未执行：${os.date} ${os.time} ${act}（自动作废）`;
  } else {
    el.textContent = `待执行：${os.date} ${os.time} ${act} · 到点执行一次后自动失效`;
  }
}

/** 表单是草稿：点格子/改时间后即时刷新状态行（未保存前 done 视为 false） */
function refreshOneshotStatusFromDraft() {
  if (autoMode !== 'oneshot') return;
  const draft = {
    date: $('oneshotDate')?.value || '',
    time: $('oneshotTime')?.value || '',
    action: $('oneshotAction')?.value || 'enable',
    done: false,
  };
  renderOneshotStatus(draft.date && draft.time ? draft : null, 'oneshot');
}

/**
 * 定时开关排期预览：与「特定时段」同款月历网格（只读展示），
 * 当前配置的日期+时间标红；点击格子可直接写入日期和时间。
 */
function renderOneshotPreview() {
  const grid = $('oneshotGrid');
  if (!grid) return;
  const y = oneshotPreviewMonth.getFullYear();
  const m = oneshotPreviewMonth.getMonth();
  const days = new Date(y, m + 1, 0).getDate();
  const today = ymd(new Date());
  const selDate = $('oneshotDate')?.value || '';
  const selTime = $('oneshotTime')?.value || '';
  let selSlot = -1;
  if (selTime.length >= 5) {
    selSlot =
      parseInt(selTime.slice(0, 2), 10) * 2 + (parseInt(selTime.slice(3, 5), 10) >= 30 ? 1 : 0);
  }
  const label = $('osMonthLabel');
  if (label) label.textContent = `${y}-${String(m + 1).padStart(2, '0')}`;

  grid.style.setProperty('--wg-cols', String(days));
  grid.innerHTML = '';
  const dateOf = (d) => new Date(y, m, d);

  const head = document.createElement('div');
  head.className = 'wg-row wg-head';
  head.appendChild(Object.assign(document.createElement('div'), { className: 'wg-corner' }));
  for (let d = 1; d <= days; d++) {
    const dt = dateOf(d);
    const c = document.createElement('div');
    c.className = 'wg-day';
    c.innerHTML = `<b>${dt.getMonth() + 1}/${d}</b><i>${WEEK_CN[dt.getDay()].slice(1)}</i>`;
    if (ymd(dt) === today) c.classList.add('today');
    head.appendChild(c);
  }
  grid.appendChild(head);

  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const row = document.createElement('div');
    row.className = 'wg-row' + (slot % 2 === 1 ? ' half' : '');
    const lab = document.createElement('div');
    lab.className = 'wg-hour';
    lab.textContent = slotLabel(slot);
    row.appendChild(lab);
    for (let d = 1; d <= days; d++) {
      const dk = ymd(dateOf(d));
      const cell = document.createElement('div');
      cell.className = 'wg-slot';
      cell.dataset.date = dk;
      cell.dataset.slot = String(slot);
      if (dk === selDate && slot === selSlot) cell.classList.add('on');
      row.appendChild(cell);
    }
    grid.appendChild(row);
  }
  bindOneshotGridClicks();
}

function bindOneshotGridClicks() {
  const grid = $('oneshotGrid');
  if (!grid || grid.dataset.bound) return;
  grid.dataset.bound = '1';
  grid.addEventListener('click', (e) => {
    const cell = e.target.closest('.wg-slot');
    if (!cell) return;
    const d = $('oneshotDate');
    const t = $('oneshotTime');
    if (d) d.value = cell.dataset.date;
    if (t) t.value = slotLabel(Number(cell.dataset.slot));
    syncTimePopHighlight();
    renderOneshotPreview();
    refreshOneshotStatusFromDraft();
  });
}

/** 选中计划后：把它的时段配置灌进右侧卡片 */
async function loadSlotCard() {
  const nameEl = $('slotCampName');
  const c = campaignsCache.find((x) => String(x.campaign_id) === String(selectedCampaignId));
  if (!c) {
    selectedCampaignId = '';
    if (nameEl) nameEl.textContent = '未选择计划';
    $('slotEmpty')?.classList.remove('hidden');
    $('slotBody')?.classList.add('hidden');
    return;
  }
  if (nameEl) {
    nameEl.textContent = `${c.campaign_name || c.campaign_id}${c.country ? ' · ' + c.country : ''}`;
  }
  $('slotEmpty')?.classList.add('hidden');
  $('slotBody')?.classList.remove('hidden');

  let auto = null;
  try {
    auto = await bridge.auto.get(c.campaign_id);
  } catch {
    auto = null;
  }
  const master = $('autoMaster');
  if (master) master.checked = auto ? auto.masterEnabled !== false : true;
  autoMode =
    auto && auto.mode === 'allday' ? 'allday' : auto && auto.mode === 'oneshot' ? 'oneshot' : 'days';
  // 需求1：读取即剔除已过去的整天排期
  dayHours = pruneExpiredSlots(cloneDayHours(auto ? auto.dayHours : null));
  // 定时开关：回填日期/时间/动作（过期的日期显示为今天）
  const os = (auto && auto.oneshot) || {};
  if ($('oneshotDate')) $('oneshotDate').value = os.date && os.date >= todayKey() ? os.date : todayKey();
  if ($('oneshotTime')) $('oneshotTime').value = os.time || '';
  setOneshotAction(os.action);
  $('timePop')?.classList.add('hidden');
  $('actionPop')?.classList.add('hidden');
  $('actionBtn')?.classList.remove('open');
  renderOneshotStatus(auto && auto.mode === 'oneshot' ? os : null, autoMode);
  // 排期预览：定位到配置所在月（无配置则当前月）
  const osDate = $('oneshotDate')?.value || '';
  oneshotPreviewMonth =
    osDate && osDate >= todayKey()
      ? new Date(Number(osDate.slice(0, 4)), Number(osDate.slice(5, 7)) - 1, 1)
      : new Date();
  renderOneshotPreview();
  // 网格定位：有配置 → 第一个配置日期所在月；否则当前月
  const firstKey = Object.keys(dayHours).sort()[0];
  gridMonth = firstKey
    ? new Date(Number(firstKey.slice(0, 4)), Number(firstKey.slice(5, 7)) - 1, 1)
    : new Date();
  applyModeTabs();
  refreshDayGrid();
  await loadSlotRuns();
}

async function saveSlot() {
  if (!selectedCampaignId) {
    toast('请先选择直播计划', 'err');
    return;
  }
  const c = campaignsCache.find((x) => String(x.campaign_id) === String(selectedCampaignId));
  const payload = {
    campaignId: String(selectedCampaignId),
    campaignName: c?.campaign_name || selectedCampaignId,
    country: c?.country || '',
    masterEnabled: $('autoMaster') ? $('autoMaster').checked : true,
    mode: autoMode,
    // 需求1：保存时再次剔除过期日期
    dayHours: pruneExpiredSlots(dayHours),
    segments: [],
    oneshot: null,
  };
  if (autoMode === 'oneshot') {
    const date = $('oneshotDate')?.value || '';
    const time = $('oneshotTime')?.value || '';
    const action = $('oneshotAction')?.value === 'disable' ? 'disable' : 'enable';
    if (!date || !time) {
      toast('请选择定时开关的日期和时间', 'err');
      return;
    }
    if (date < todayKey()) {
      toast('定时开关不能设置为过去的时间', 'err');
      return;
    }
    payload.oneshot = { date, time, action, done: false };
  }
  const r = await bridge.auto.upsert(payload);
  if (!r.ok) {
    toast(r.error || '保存失败', 'err');
    return;
  }
  toast('时间设置已保存');
  await loadSlotCard();
  await refreshStatus();
}

/** 最近执行（仅当前选中计划） */
async function loadSlotRuns() {
  const box = $('slotRuns');
  if (!box) return;
  let runs = [];
  try {
    runs = (await bridge.auto.runs()) || [];
  } catch {
    runs = [];
  }
  const mine = runs.filter(
    (r) => !selectedCampaignId || String(r.campaignId) === String(selectedCampaignId)
  );
  if (!mine.length) {
    box.innerHTML = '<div class="empty">暂无执行记录</div>';
    return;
  }
  box.innerHTML = mine
    .slice(0, 20)
    .map((r) => {
      const ok = r.status === 'ok';
      const act = r.action === 'enable' ? '开启' : r.action === 'disable' ? '暂停' : r.action;
      return `<div>${escapeHtml((r.ts || '').slice(11, 19))} ${ok ? '✓' : '✗'} ${escapeHtml(act)}${
        r.error ? ' · ' + escapeHtml(r.error) : ''
      }</div>`;
    })
    .join('');
}

function setBadge(el, text, cls) {
  el.textContent = text;
  el.className = 'badge' + (cls ? ' ' + cls : '');
}

async function refreshStatus() {
  try {
    const s = await bridge.status();
    setBadge(
      $('modeBadge'),
      s.mode === 'MOCK' ? 'MOCK 演示' : s.mode === 'PREVIEW' ? '浏览器预览' : 'LIVE 实时',
      s.mode === 'LIVE' ? 'ok' : 'warn'
    );
    setBadge($('schedBadge'), s.scheduler ? '调度运行中' : '调度已停止', s.scheduler ? 'ok' : 'err');
    setBadge(
      $('feishuBadge'),
      s.feishu.connected ? '飞书在线' : '飞书未连接',
      s.feishu.connected ? 'ok' : 'warn'
    );

    $('stTiktok').textContent = s.tiktok.authorized
      ? s.mock || s.mode === 'MOCK' || s.mode === 'PREVIEW'
        ? 'MOCK/演示'
        : '已授权'
      : '未授权';
    $('stFeishu').textContent = s.feishu.connected ? '已连接' : '未连接';
    $('stSched').textContent = s.scheduler ? '运行中' : '已停止';
    if (s.tiktok.advertiserId && $('advInput')) $('advInput').value = s.tiktok.advertiserId;
  } catch (e) {
    console.error(e);
  }
}

function statusLine(c) {
  if (c.status === 'ENABLE') return '<span class="tag on">投放中</span>';
  if (c.status === 'DISABLE') return '<span class="tag off">已暂停</span>';
  return `<span class="tag">${c.status || '?'}</span>`;
}

function uniqueCountries(list) {
  const set = new Set();
  for (const c of list || []) {
    const v = (c.country || c.country_code || '').trim();
    if (v) set.add(v.toUpperCase());
  }
  return Array.from(set).sort();
}

function renderCountryTabs() {
  const box = $('countryTabs');
  if (!box) return;
  const countries = uniqueCountries(campaignsCache);
  const keep = activeCountry === '__all__' || countries.includes(activeCountry);
  if (!keep) activeCountry = '__all__';
  box.innerHTML = '';
  const tabs = ['__all__', ...countries];
  for (const code of tabs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'country-tab' + (code === activeCountry ? ' active' : '');
    btn.dataset.country = code;
    btn.textContent = code === '__all__' ? '全部' : code;
    btn.addEventListener('click', () => {
      activeCountry = code;
      campPage = 1;
      renderCountryTabs();
      renderCampaignList();
    });
    box.appendChild(btn);
  }
}

function filteredCampaigns() {
  if (activeCountry === '__all__') return campaignsCache;
  return campaignsCache.filter((c) => {
    const v = (c.country || c.country_code || '').trim().toUpperCase();
    return v === activeCountry;
  });
}

/** 投放中的排前面，其次按名称 */
function sortedCampaigns() {
  return filteredCampaigns()
    .slice()
    .sort((a, b) => {
      const ea = a.status === 'ENABLE' ? 0 : 1;
      const eb = b.status === 'ENABLE' ? 0 : 1;
      if (ea !== eb) return ea - eb;
      return String(a.campaign_name || '').localeCompare(String(b.campaign_name || ''), 'zh');
    });
}

/** campaignId → automation（用于列表显示「有排期 / 无排期」） */
let autoMapCache = {};

async function loadAutomationsMap() {
  try {
    const list = (await bridge.auto.list()) || [];
    const map = {};
    for (const a of list) map[String(a.campaignId)] = a;
    autoMapCache = map;
  } catch {
    /* 拿不到就按无排期显示 */
    autoMapCache = {};
  }
}

/** 该计划是否配置了投放时段 */
function hasSchedule(auto) {
  if (!auto) return false;
  if (auto.masterEnabled === false) return false;
  if (auto.mode === 'allday') return true;
  if (auto.mode === 'weekly') return true;
  if (auto.mode === 'days') {
    // 只要有未过期的时段就算有排期（剪掉早于今天 + 今天已过去的槽）
    return Object.keys(pruneExpiredSlots(auto.dayHours || {})).length > 0;
  }
  if (auto.mode === 'window') {
    // 过期的时间窗不算排期（否则会一直误报"有排期"）
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const nowIso = `${ymd(d)}T${p(d.getHours())}:${p(d.getMinutes())}`;
    return (auto.segments || []).some((s) => s.start && s.end && s.end >= nowIso);
  }
  if (auto.mode === 'oneshot') {
    const os = auto.oneshot;
    return !!(os && os.date && os.time && !os.done && os.date >= ymd(new Date()));
  }
  return false;
}

function renderCampPager(total, pages) {
  const box = $('campPager');
  if (!box) return;
  if (pages <= 1) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `
    <button type="button" class="btn sm ghost" data-pg="prev" ${campPage <= 1 ? 'disabled' : ''}>‹ 上一页</button>
    <span class="pager-info">${campPage} / ${pages}</span>
    <button type="button" class="btn sm ghost" data-pg="next" ${campPage >= pages ? 'disabled' : ''}>下一页 ›</button>`;
  box.querySelector('[data-pg="prev"]')?.addEventListener('click', () => {
    campPage = Math.max(1, campPage - 1);
    renderCampaignList();
  });
  box.querySelector('[data-pg="next"]')?.addEventListener('click', () => {
    campPage = Math.min(pages, campPage + 1);
    renderCampaignList();
  });
}

function selectCampaign(campaignId) {
  selectedCampaignId = String(campaignId);
  document.querySelectorAll('#campList .item').forEach((el) => {
    el.classList.toggle('selected', String(el.dataset.id) === selectedCampaignId);
  });
  guard('打开时间设置', loadSlotCard).then(() => {
    // 手机上设置卡片在列表下方，自动滚过去
    if (window.matchMedia('(max-width: 640px)').matches) {
      $('slotCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}

$('btnSlotBack')?.addEventListener('click', () => {
  selectedCampaignId = '';
  document.querySelectorAll('#campList .item').forEach((el) => el.classList.remove('selected'));
  $('slotCampName').textContent = '未选择计划';
  $('slotEmpty')?.classList.remove('hidden');
  $('slotBody')?.classList.add('hidden');
  $('sectionCampaign')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

function renderCampaignList() {
  const box = $('campList');
  if (!box) return;
  const all = sortedCampaigns();
  const countEl = $('campCount');
  const pages = Math.max(1, Math.ceil(all.length / CAMP_PAGE_SIZE));
  if (campPage > pages) campPage = pages;
  if (campPage < 1) campPage = 1;
  const startIdx = (campPage - 1) * CAMP_PAGE_SIZE;
  const list = all.slice(startIdx, startIdx + CAMP_PAGE_SIZE);

  if (countEl) {
    countEl.textContent = all.length
      ? `${startIdx + 1}-${startIdx + list.length} / ${all.length}`
      : `0 / ${campaignsCache.length}`;
  }
  renderCampPager(all.length, pages);

  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = `<div class="empty">${
      campaignsCache.length ? '当前国家下没有计划' : '没有计划'
    }</div>`;
    return;
  }
  for (const c of list) {
    const row = document.createElement('div');
    row.className = 'item';
    row.dataset.id = String(c.campaign_id);
    if (String(c.campaign_id) === selectedCampaignId) row.classList.add('selected');
    const on = c.status === 'ENABLE';
    const descCountry = c.country ? ` · ${escapeHtml(c.country)}` : '';
    const hasSched = hasSchedule(autoMapCache[String(c.campaign_id)]);
    row.innerHTML = `
      <div class="meta">
        <div class="title">${escapeHtml(c.campaign_name || c.campaign_id)}</div>
        <div class="desc">${escapeHtml(String(c.campaign_id))} · ${escapeHtml(c.campaign_type || '')}${descCountry} ${statusLine(c)}</div>
      </div>
      <div class="actions switch-row">
        <span class="sched-badge ${hasSched ? 'has' : 'none'}">${hasSched ? '有排期' : '无排期'}</span>
        <span class="switch-label">${on ? '投放中' : '已暂停'}</span>
        <label class="switch" title="开启 / 暂停计划">
          <input type="checkbox" data-camp-toggle data-id="${escapeAttr(c.campaign_id)}" ${on ? 'checked' : ''} />
          <span class="track"></span>
          <span class="knob"></span>
        </label>
      </div>`;
    // 点整行（开关区除外）→ 右侧弹出该计划的时间设置
    row.addEventListener('click', (e) => {
      if (e.target.closest('input, label, .switch')) return;
      selectCampaign(c.campaign_id);
    });
    const input = row.querySelector('input[data-camp-toggle]');
    input.addEventListener('change', async () => {
      input.disabled = true;
      const act = input.checked ? 'enable' : 'disable';
      const res = await bridge.tiktok.toggle(c.campaign_id, act);
      if (!res.ok) {
        input.checked = !input.checked;
        alert(res.error || '操作失败');
      }
      input.disabled = false;
      await loadCampaigns(false);
      await refreshStatus();
      await loadSlotRuns();
    });
    box.appendChild(row);
  }
}

// 共用加载动画：CASE BANG logo 里的红色 A（Λ 字形），红色液面带波浪从底部漫满字形
function listLoadingHtml() {
  return `
    <div class="list-loading">
      <div class="load-caption">加载中<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></div>
      <svg class="load-lambda" viewBox="0 0 100 100" aria-label="加载中">
        <defs>
          <clipPath id="lambdaClip">
            <path d="M49.4 5.5 Q50 3.4 50.6 5.5 L87 94 L73.6 94 L50.6 35.5 Q50 36.8 49.4 35.5 L26.4 94 L13 94 Z" />
          </clipPath>
        </defs>
        <path class="lambda-outline"
          d="M49.4 5.5 Q50 3.4 50.6 5.5 L87 94 L73.6 94 L50.6 35.5 Q50 36.8 49.4 35.5 L26.4 94 L13 94 Z" />
        <g clip-path="url(#lambdaClip)">
          <g class="liquid-group">
            <path class="liquid-wave"
            d="M-100 12 q5 -12 10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 L200 150 L-100 150 Z" />
          </g>
        </g>
      </svg>
    </div>`;;
}
window.listLoadingHtml = listLoadingHtml;

async function loadCampaigns(selectIntoForm) {
  const box = $('campList');
  // 加载动画：CASE BANG logo 里的红色 A（Λ 字形），红色液面带波浪从底部漫满字形
  box.innerHTML = listLoadingHtml();
  const r = await bridge.tiktok.campaigns();
  if (!r.ok) {
    box.innerHTML = `<div class="empty">加载失败：${escapeHtml(r.error || '')}</div>`;
    return;
  }
  campaignsCache = r.list || [];
  await loadAutomationsMap();
  renderCountryTabs();
  renderCampaignList();
}

async function loadLogs() {
  const logs = await bridge.logs();
  const box = $('logList');
  box.innerHTML = (logs || [])
    .slice(0, 40)
    .map((l) => {
      const cls = l.level === 'error' ? 'error' : l.level === 'warn' ? 'warn' : '';
      return `<div class="log ${cls}"><span class="t">${escapeHtml((l.ts || '').slice(11, 19))}</span>[${escapeHtml(l.source || '')}] ${escapeHtml(l.message || '')}</div>`;
    })
    .join('');
}

/* ---------------- 登录门 ---------------- */

let currentUser = null;
let appStarting = false;

function showAuthGate() {
  $('authGate')?.removeAttribute('hidden');
}
function hideAuthGate() {
  $('authGate')?.setAttribute('hidden', '');
}
function setAuthErr(id, msg) {
  const el = $(id);
  if (!el) return;
  if (msg) {
    el.textContent = msg;
    el.removeAttribute('hidden');
  } else {
    el.textContent = '';
    el.setAttribute('hidden', '');
  }
}
function setWho(user) {
  const el = $('whoAmI');
  if (!el) return;
  if (user && user.email) el.textContent = user.email;
  else if (isDesktop) el.textContent = '本机桌面端（无需登录）';
  else el.textContent = '—';
}

/** 返回 true 表示可以进入应用 */
async function ensureAuth() {
  if (isDesktop) {
    hideAuthGate();
    setWho(null);
    return true;
  }
  if (!liveApi) {
    // 演示模式：没有服务端，不需要登录
    hideAuthGate();
    setWho(null);
    return true;
  }
  if (!getSessionToken()) {
    showAuthGate();
    return false;
  }
  try {
    const me = await httpBridge('/api/auth/me');
    if (me && me.ok && me.user) {
      currentUser = me.user;
      setWho(me.user);
      hideAuthGate();
      return true;
    }
  } catch (e) {
    if (!e.needLogin) console.error('登录状态检查失败', e);
  }
  showAuthGate();
  return false;
}

// dash-ui.js 晚于本脚本加载；首屏看板必须等它就绪，否则会用到本文件里的旧版 loadDashboard
window.__dashUiReady = new Promise((resolve) => {
  window.__markDashUiReady = resolve;
});

async function startApp() {
  if (appStarting) return;
  appStarting = true;
  try {
    attachStateListener();
    await refreshStatus();
    await window.__dashUiReady;
    // 计划列表 / 日志 / 看板互不依赖，并行拉，手机上更快看到数
    await Promise.all([loadCampaigns(true), loadLogs(), loadDashboard()]);
  } finally {
    appStarting = false;
  }
}

function onLoginSuccess(r) {
  setSessionToken(r.token);
  currentUser = r.user || null;
  setWho(currentUser);
  hideAuthGate();
  setAuthErr('pwdErr', '');
  setAuthErr('codeErr', '');
  toast(`已登录：${(currentUser && currentUser.email) || ''}`);
  startApp();
}

async function boot() {
  // 手机 / 浏览器：先探测电脑端 /api，连上就走实时通道
  liveApi = await probeApi();
  if (liveApi) bridge = httpApi;
  showModeBanner();
  updateAuthTips();

  const ok = await ensureAuth();
  if (!ok) return; // 停在登录页，登录成功后由表单回调进入
  await startApp();
}

async function guard(name, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(name, err);
    toast(`${name}失败: ${err.message || err}`, 'err');
    throw err;
  }
}

$('btnRefresh').onclick = () =>
  guard('刷新', async () => {
    await refreshStatus();
    await loadLogs();
    await loadSlotRuns();
    toast('已刷新');
  });

$('btnAppReload')?.addEventListener('click', async () => {
  toast('正在重启客户端…', 'ok', 800);
  try {
    if (typeof bridge.relaunch === 'function') {
      const r = await bridge.relaunch();
      if (r && r.ok === false) throw new Error(r.error || '重启失败');
      return;
    }
  } catch (e) {
    console.error(e);
    toast('重启失败: ' + (e.message || e), 'err');
    return;
  }
  // 非桌面端：退回整页重载
  setTimeout(() => window.location.reload(), 120);
});

$('btnAuth').onclick = () =>
  guard('TikTok 授权', async () => {
    if (!canControl()) {
      showModeBanner();
      setHint(
        '演示模式无法跳转授权。请让电脑保持运行 <code>npm start</code>，手机连同一 Wi-Fi 访问电脑地址后再试。',
        true
      );
      toast('请连接电脑端后再授权', 'err');
      return;
    }
    setHint('正在启动授权…');
    toast('正在打开 TikTok 授权页…');
    const r = await bridge.tiktok.startAuth();
    if (r?.ok && r.authorizeUrl) {
      const link = escapeHtml(r.authorizeUrl);
      setHint(
        `已请求在电脑上打开授权页。若未自动打开，点此链接：<br><a href="${link}" target="_blank" rel="noreferrer">${link}</a>` +
          (r.portBusy ? `<br>提示：回调端口 ${r.callbackPort} 已被占用，仍可授权。` : '')
      );
      // 双保险：再走一次打开外链
      try {
        await bridge.openExternal?.(r.authorizeUrl);
      } catch {}
      toast('授权页已打开（请在浏览器完成登录）', 'ok');
    } else {
      const msg = r?.error || '启动授权失败';
      setHint(escapeHtml(msg), true);
      toast(msg, 'err');
    }
  });

$('btnFeishu').onclick = () =>
  guard('连接飞书', async () => {
    const r = await bridge.feishu.connect();
    if (!r.ok) toast(r.error || '连接失败', 'err');
    else toast('飞书连接指令已发送');
    await refreshStatus();
  });

$('btnFeishuOff').onclick = () =>
  guard('断开飞书', async () => {
    await bridge.feishu.disconnect();
    await refreshStatus();
    toast('已断开飞书（标记）');
  });

// 左侧模块切换
function switchView(name) {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === name);
  });
  document.querySelectorAll('.view').forEach((sec) => {
    const on = sec.dataset.view === name;
    sec.classList.toggle('active', on);
    if (on) sec.removeAttribute('hidden');
    else sec.setAttribute('hidden', '');
  });
  if (name === 'logs') loadLogs();
  if (name === 'dashboard') {
    // 每次进入看板都回到默认：全部 + 今天
    if (typeof window.resetDashDefaults === 'function') window.resetDashDefaults();
    loadDashboard();
  }
}

function drawBarChart(canvas, values, labels, color = '#e60012') {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 640;
  const cssH = 220;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  if (!values.length) {
    ctx.fillStyle = '#86909c';
    ctx.font = '13px sans-serif';
    ctx.fillText('暂无数据', 16, 24);
    return;
  }
  const padL = 44;
  const padR = 12;
  const padT = 16;
  const padB = 28;
  const max = Math.max(...values, 1);
  const n = values.length;
  const gap = 8;
  const barW = Math.max(8, (cssW - padL - padR - gap * (n - 1)) / n);

  // grid
  ctx.strokeStyle = '#e8e9ed';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + ((cssH - padT - padB) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(cssW - padR, y);
    ctx.stroke();
    ctx.fillStyle = '#86909c';
    ctx.font = '11px sans-serif';
    const gv = Math.round(max * (1 - i / 4));
    ctx.fillText(String(gv), 4, y + 4);
  }

  values.forEach((v, i) => {
    const h = ((cssH - padT - padB) * v) / max;
    const x = padL + i * (barW + gap);
    const y = cssH - padB - h;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, Math.max(h, 2), 4);
    ctx.fill();
    if (labels && labels[i]) {
      ctx.save();
      ctx.translate(x + barW / 2, cssH - 8);
      ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = '#86909c';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(String(labels[i]).slice(5), 0, 0);
      ctx.restore();
    }
  });
}

function drawDualChart(canvas, valuesA, valuesB, labels) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 640;
  const cssH = 220;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const n = Math.max(valuesA.length, valuesB.length, 1);
  if (!n) return;
  const padL = 36;
  const padR = 36;
  const padT = 16;
  const padB = 28;
  const maxA = Math.max(...valuesA, 1);
  const maxB = Math.max(...valuesB, 1);
  const groupW = (cssW - padL - padR) / n;
  const barW = Math.max(6, groupW * 0.3);

  for (let i = 0; i <= 4; i++) {
    const y = padT + ((cssH - padT - padB) * i) / 4;
    ctx.strokeStyle = '#e8e9ed';
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(cssW - padR, y);
    ctx.stroke();
  }

  valuesA.forEach((v, i) => {
    const h = ((cssH - padT - padB) * v) / maxA;
    const x = padL + i * groupW + groupW * 0.15;
    ctx.fillStyle = '#3d8bfd';
    ctx.fillRect(x, cssH - padB - h, barW, h);
  });
  valuesB.forEach((v, i) => {
    const h = ((cssH - padT - padB) * v) / maxB;
    const x = padL + i * groupW + groupW * 0.15 + barW + 4;
    ctx.fillStyle = '#00b578';
    ctx.fillRect(x, cssH - padB - h, barW, h);
  });

  // legend
  ctx.fillStyle = '#3d8bfd';
  ctx.fillRect(cssW - 120, 8, 10, 10);
  ctx.fillStyle = '#86909c';
  ctx.font = '11px sans-serif';
  ctx.fillText('点击', cssW - 106, 17);
  ctx.fillStyle = '#00b578';
  ctx.fillRect(cssW - 64, 8, 10, 10);
  ctx.fillStyle = '#86909c';
  ctx.fillText('转化', cssW - 50, 17);

  if (labels && labels.length) {
    labels.forEach((lb, i) => {
      ctx.save();
      ctx.translate(padL + i * groupW + groupW / 2, cssH - 6);
      ctx.fillStyle = '#86909c';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(lb).slice(5), 0, 0);
      ctx.restore();
    });
  }
}

async function loadDashboard() {
  const tbody = $('dashTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">' + (window.listLoadingHtml ? window.listLoadingHtml() : '加载中…') + '</td></tr>';
  try {
    const startDate = $('dashStartDate')?.value || '';
    const endDate = $('dashEndDate')?.value || '';
    const range =
      startDate && endDate
        ? { startDate, endDate }
        : endDate
          ? { endDate }
          : startDate
            ? { startDate }
            : {};
    const r = await bridge.reports.dashboard(range);
    if (!r.ok) {
      toast(r.error || '看板加载失败', 'err');
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="empty">${escapeHtml(r.error || '失败')}</td></tr>`;
      return;
    }
    const s = r.summary || {};
    const set = (id, v) => {
      const el = $(id);
      if (el) el.textContent = v;
    };
    set('kpiSpend', Number(s.cost ?? s.spend ?? 0).toFixed(2));
    set('kpiOrders', String(s.orders ?? s.conversions ?? 0));
    set('kpiAov', Number(s.aov ?? 0).toFixed(2));
    set('kpiRevenue', Number(s.revenue ?? s.gross_revenue ?? 0).toFixed(2));
    set('kpiRoi', Number(s.roi ?? 0).toFixed(2));
    set('kpiCtr', Number(s.ctr ?? 0).toFixed(2));
    // legacy ids if still present
    set('kpiImpr', String(s.impressions ?? 0));
    set('kpiClicks', String(s.clicks ?? 0));
    set('kpiConv', String(s.conversions ?? s.orders ?? 0));
    set('kpiCpa', Number(s.cpa ?? 0).toFixed(2));

    const note = $('dashNote');
    const mockBadge = $('dashMockBadge');
    if (note) {
      if (r.note) {
        note.classList.remove('hidden');
        note.textContent = r.note;
      } else {
        note.classList.add('hidden');
      }
    }
    if (mockBadge) {
      if (r.mock) mockBadge.classList.remove('hidden');
      else mockBadge.classList.add('hidden');
    }
    const rangeLabel = $('dashRangeLabel');
    if (rangeLabel && r.startDate) {
      rangeLabel.textContent = `${r.startDate} ~ ${r.endDate} · GMV Max 成本 / 订单 / 收入 / ROI`;
    }

    const daily = r.daily || [];
    const dates = daily.map((d) => d.date || '');
    drawBarChart($('chartSpend'), daily.map((d) => d.cost ?? d.spend ?? 0), dates, '#e60012');
    drawBarChart($('chartClicks'), daily.map((d) => d.orders ?? 0), dates, '#00b578');

    const camps = [...(r.campaigns || [])].sort((a, b) => (b.cost ?? b.spend ?? 0) - (a.cost ?? a.spend ?? 0));
    if (tbody) {
      if (!camps.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty">暂无计划数据</td></tr>';
      } else {
        tbody.innerHTML = camps
          .map(
            (c) => `<tr>
              <td>${escapeHtml(c.campaign_name)}</td>
              <td>${Number(c.cost ?? c.spend ?? 0).toFixed(2)}</td>
              <td>${Number(c.orders ?? 0)}</td>
              <td>${Number(c.gross_revenue ?? c.revenue ?? 0).toFixed(2)}</td>
              <td>${Number(c.roi ?? 0).toFixed(2)}</td>
              <td>${escapeHtml(c.account || c.country || '')}</td>
            </tr>`
          )
          .join('');
      }
    }
  } catch (err) {
    toast('看板异常: ' + (err.message || err), 'err');
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="empty">${escapeHtml(err.message || '')}</td></tr>`;
  }
}

function _appInitDashDates() {
  const end = $('dashEndDate');
  const start = $('dashStartDate');
  if (!end || !start) return;
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (!end.value) end.value = fmt(today);
  if (!start.value) {
    const s = new Date(today);
    s.setDate(s.getDate() - 6);
    start.value = fmt(s);
  }
}

$('dashStartDate')?.addEventListener('change', () => guard('刷新看板', loadDashboard));
$('dashEndDate')?.addEventListener('change', () => guard('刷新看板', loadDashboard));
$('btnDashRefresh')?.addEventListener('click', () => guard('刷新看板', loadDashboard));

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

$('btnLoadCamp').onclick = () => guard('刷新列表', () => loadCampaigns(true));

$('autoMaster')?.addEventListener('change', async (e) => {
  if (!selectedCampaignId) return;
  const r = await bridge.auto.master(selectedCampaignId, e.target.checked);
  if (!r.ok) toast(r.error || '总开关失败', 'err');
  else
    toast(
      e.target.checked ? '自动化总开关：开' : '总开关已关（不再干预该计划）',
      e.target.checked ? 'ok' : 'err'
    );
  await loadSlotRuns();
});

document.querySelectorAll('.mode-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    autoMode = btn.dataset.mode || 'days';
    applyModeTabs();
  });
});

/* ===== 定时开关控件：日历 / 时间列 / 动作下拉（红色主题，统一样式） ===== */

function setOneshotAction(v) {
  const val = v === 'disable' ? 'disable' : 'enable';
  const hidden = $('oneshotAction');
  if (hidden) hidden.value = val;
  const label = $('actionLabel');
  if (label) label.textContent = val === 'disable' ? '关闭' : '开启';
  document.querySelectorAll('#actionPop .select-opt').forEach((o) =>
    o.classList.toggle('on', o.dataset.v === val)
  );
}

function buildTimePop() {
  const hBox = $('timeHours');
  const mBox = $('timeMins');
  if (!hBox || hBox.dataset.built) return;
  hBox.dataset.built = '1';
  for (let h = 0; h < 24; h++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.v = String(h).padStart(2, '0');
    b.textContent = b.dataset.v;
    hBox.appendChild(b);
  }
  for (let m = 0; m < 60; m++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.v = String(m).padStart(2, '0');
    b.textContent = b.dataset.v;
    mBox.appendChild(b);
  }
  const bindCol = (box, key) => {
    box.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-v]');
      if (!btn) return;
      const input = $('oneshotTime');
      const cur = ((input && input.value) || '00:00').split(':');
      const hh = key === 'h' ? btn.dataset.v : cur[0] || '00';
      const mm = key === 'm' ? btn.dataset.v : cur[1] || '00';
      if (input) input.value = `${hh}:${mm}`;
      syncTimePopHighlight();
      renderOneshotPreview();
      refreshOneshotStatusFromDraft();
      if (key === 'm') {
        $('timePop')?.classList.add('hidden');
      }
    });
  };
  bindCol(hBox, 'h');
  bindCol(mBox, 'm');
}

function syncTimePopHighlight() {
  const input = $('oneshotTime');
  const v = (input && input.value) || '';
  const hh = v.slice(0, 2);
  const mm = v.slice(3, 5);
  $('timeHours')
    ?.querySelectorAll('button[data-v]')
    .forEach((b) => b.classList.toggle('on', b.dataset.v === hh));
  $('timeMins')
    ?.querySelectorAll('button[data-v]')
    .forEach((b) => b.classList.toggle('on', b.dataset.v === mm));
}

$('oneshotDate')?.addEventListener('click', (e) => {
  e.preventDefault();
  openRangeCalendar('single', $('oneshotDate'));
});

// 日期变更（日历单选回填）→ 刷新排期预览
$('oneshotDate')?.addEventListener('change', () => {
  const v = $('oneshotDate')?.value || '';
  if (v) {
    const y = Number(v.slice(0, 4));
    const m = Number(v.slice(5, 7)) - 1;
    if (!Number.isNaN(y) && !Number.isNaN(m)) oneshotPreviewMonth = new Date(y, m, 1);
  }
  renderOneshotPreview();
  refreshOneshotStatusFromDraft();
});

$('osPrevMonth')?.addEventListener('click', () => {
  oneshotPreviewMonth = new Date(
    oneshotPreviewMonth.getFullYear(),
    oneshotPreviewMonth.getMonth() - 1,
    1
  );
  renderOneshotPreview();
});

$('osNextMonth')?.addEventListener('click', () => {
  oneshotPreviewMonth = new Date(
    oneshotPreviewMonth.getFullYear(),
    oneshotPreviewMonth.getMonth() + 1,
    1
  );
  renderOneshotPreview();
});

$('oneshotTime')?.addEventListener('click', (e) => {
  e.stopPropagation();
  buildTimePop();
  syncTimePopHighlight();
  const pop = $('timePop');
  if (!pop) return;
  const open = pop.classList.contains('hidden');
  pop.classList.toggle('hidden');
  $('actionPop')?.classList.add('hidden');
  $('actionBtn')?.classList.remove('open');
  if (open) pop.querySelector('.on')?.scrollIntoView({ block: 'center' });
});

$('actionBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const pop = $('actionPop');
  if (!pop) return;
  pop.classList.toggle('hidden');
  $('actionBtn')?.classList.toggle('open', !pop.classList.contains('hidden'));
  $('timePop')?.classList.add('hidden');
});

document.querySelectorAll('#actionPop .select-opt').forEach((opt) => {
  opt.addEventListener('click', (e) => {
    e.stopPropagation();
    setOneshotAction(opt.dataset.v);
    $('actionPop')?.classList.add('hidden');
    $('actionBtn')?.classList.remove('open');
  });
});

document.addEventListener('click', (e) => {
  const tp = $('timePop');
  if (tp && !tp.classList.contains('hidden') && !tp.contains(e.target) && e.target !== $('oneshotTime')) {
    tp.classList.add('hidden');
  }
  const ap = $('actionPop');
  const btn = $('actionBtn');
  if (ap && !ap.classList.contains('hidden') && !ap.contains(e.target) && !(btn && btn.contains(e.target))) {
    ap.classList.add('hidden');
    btn?.classList.remove('open');
  }
});

$('btnPrevMonth')?.addEventListener('click', () => {
  gridMonth = new Date(gridMonth.getFullYear(), gridMonth.getMonth() - 1, 1);
  refreshDayGrid();
});

$('btnNextMonth')?.addEventListener('click', () => {
  gridMonth = new Date(gridMonth.getFullYear(), gridMonth.getMonth() + 1, 1);
  refreshDayGrid();
});

$('btnClearSlots')?.addEventListener('click', () => {
  dayHours = {};
  refreshDayGrid();
});

$('btnSaveSlot')?.addEventListener('click', () => guard('保存时间设置', saveSlot));

$('btnSlotTick')?.addEventListener('click', () =>
  guard('试跑', async () => {
    const r = await bridge.sched.tick();
    const list = Array.isArray(r) ? r : [];
    const mine = list.filter(
      (x) => !selectedCampaignId || String(x.campaignId) === String(selectedCampaignId)
    );
    toast(
      list.length ? `本次执行 ${mine.length}/${list.length} 条` : '当前时刻没有需要执行的开关',
      list.length ? 'ok' : 'err'
    );
    await loadSlotRuns();
    await loadLogs();
  })
);

$('btnLogs').onclick = () => guard('刷新日志', loadLogs);

/* ---------------- 登录页交互 ---------------- */
document.querySelectorAll('.auth-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach((b) => b.classList.toggle('active', b === btn));
    const mode = btn.dataset.auth;
    $('formPassword')?.classList.toggle('hidden', mode !== 'password');
    $('formCode')?.classList.toggle('hidden', mode !== 'code');
    setAuthErr('pwdErr', '');
    setAuthErr('codeErr', '');
  });
});

$('formPassword')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('.auth-submit');
  setAuthErr('pwdErr', '');
  if (btn) btn.disabled = true;
  try {
    const r = await httpBridge('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: $('pwdEmail').value, password: $('pwdPass').value }),
    });
    if (!r.ok) {
      setAuthErr('pwdErr', r.error || '登录失败');
      return;
    }
    onLoginSuccess(r);
  } catch (err) {
    if (!err.needLogin) setAuthErr('pwdErr', err.message || '登录失败');
  } finally {
    if (btn) btn.disabled = false;
  }
});

let codeCooldown = 0;
let codeTimer = null;

$('btnSendCode')?.addEventListener('click', async () => {
  const email = ($('codeEmail')?.value || '').trim();
  setAuthErr('codeErr', '');
  if (!email) {
    setAuthErr('codeErr', '请先填写邮箱');
    return;
  }
  const btn = $('btnSendCode');
  btn.disabled = true;
  btn.textContent = '发送中…';
  try {
    const r = await httpBridge('/api/auth/code', { method: 'POST', body: JSON.stringify({ email }) });
    if (!r.ok) {
      setAuthErr('codeErr', r.error || '发送失败');
      btn.disabled = false;
      btn.textContent = '发送验证码';
      return;
    }
    toast('验证码已发送，请查收邮箱');
    $('codeInput')?.focus();
    codeCooldown = Number(r.cooldown) || 60;
    btn.textContent = codeCooldown + 's';
    clearInterval(codeTimer);
    codeTimer = setInterval(() => {
      codeCooldown -= 1;
      if (codeCooldown <= 0) {
        clearInterval(codeTimer);
        btn.disabled = false;
        btn.textContent = '重新发送';
      } else {
        btn.textContent = codeCooldown + 's';
      }
    }, 1000);
  } catch (err) {
    setAuthErr('codeErr', err.message || '发送失败');
    btn.disabled = false;
    btn.textContent = '发送验证码';
  }
});

$('formCode')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('.auth-submit');
  setAuthErr('codeErr', '');
  const email = ($('codeEmail')?.value || '').trim();
  const code = ($('codeInput')?.value || '').trim();
  const password = $('codePass')?.value || '';
  if (!/^\d{4}$/.test(code)) {
    setAuthErr('codeErr', '请输入 4 位验证码');
    return;
  }
  if (btn) btn.disabled = true;
  try {
    const r = await httpBridge('/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ email, code, password }),
    });
    if (!r.ok) {
      setAuthErr('codeErr', r.error || '登录失败');
      return;
    }
    onLoginSuccess(r);
  } catch (err) {
    if (!err.needLogin) setAuthErr('codeErr', err.message || '登录失败');
  } finally {
    if (btn) btn.disabled = false;
  }
});

$('btnLogout')?.addEventListener('click', async () => {
  try {
    await httpBridge('/api/auth/logout', { method: 'POST', body: '{}' });
  } catch {
    /* 服务端可能已先删除会话 */
  }
  detachStateListener();
  setSessionToken('');
  currentUser = null;
  setWho(null);
  showAuthGate();
  toast('已退出登录');
});

window.addEventListener('error', (e) => {
  console.error(e);
  toast('脚本错误: ' + (e.message || 'unknown'), 'err');
});

// 桌面端直接显示；手机/浏览器等 boot() 探测完 /api 再决定横幅内容
if (isDesktop) showModeBanner();

if (bridge.onState) {
  bridge.onState(() => {
    refreshStatus();
    loadSlotRuns();
    loadLogs();
  });
}

// PWA：注册 service worker（HTTP 环境才有效，桌面端 file:// 自动跳过）
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service Worker 注册失败', e));
  });
}

boot();
// 状态轮询兜底（SSE 断开时仍能刷新）
setInterval(() => {
  refreshStatus();
}, 15000);
