'use strict';

const { readJson, writeJson } = require('./store');
const { log } = require('./logger');
const tiktok = require('./tiktok');

const FILE = 'automations.json';
const FIRED_FILE = 'automation_runs.json';

function uid(prefix = 'seg') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function getAutomations() {
  return readJson(FILE, []);
}

function saveAutomations(list) {
  writeJson(FILE, list);
  return list;
}

function getRuns() {
  return readJson(FIRED_FILE, []);
}

function pushRun(entry) {
  const runs = readJson(FIRED_FILE, []);
  runs.unshift({ ts: new Date().toISOString(), ...entry });
  if (runs.length > 400) runs.length = 400;
  writeJson(FIRED_FILE, runs);
}

function parseLocalDT(s) {
  // 'YYYY-MM-DDTHH:mm' or 'YYYY-MM-DD HH:mm'
  if (!s) return null;
  const t = String(s).trim().replace(' ', 'T');
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function localDateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localHHMM(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultSegments() {
  return [
    {
      id: uid('seg'),
      enabled: true,
      start: '',
      end: '',
    },
  ];
}

/** 一周 × 24 小时网格：hours[星期][小时] = 是否投放（0=Sun，24 格=00:00–24:00） */
function emptyHours() {
  return Array.from({ length: 7 }, () => Array(24).fill(false));
}

function normalizeHours(raw) {
  const hours = emptyHours();
  if (Array.isArray(raw)) {
    raw.forEach((row, day) => {
      if (day > 6 || !Array.isArray(row)) return;
      row.forEach((v, hour) => {
        if (hour < 24) hours[day][hour] = !!v;
      });
    });
  }
  return hours;
}

/**
 * 按具体日期：dayHours['YYYY-MM-DD'] = [48 个布尔]
 * 每个槽 30 分钟：slot = hour*2 + (minute >= 30 ? 1 : 0)
 * 兼容旧的 24 格（每小时一格）数据：拆成两个相同槽
 */
function normalizeDayHours(raw) {
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const key of Object.keys(raw)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
      const arr = raw[key];
      if (!Array.isArray(arr)) continue;
      if (arr.length <= 24) {
        // 旧的小时粒度 → 半小时粒度
        out[key] = arr.flatMap((v) => [!!v, !!v]);
      } else {
        out[key] = Array.from({ length: 48 }, (_, i) => !!arr[i]);
      }
    }
  }
  return out;
}

/**
 * 当前时刻应处的状态：'enable' | 'disable' | null（null = 不干预）
 * allday：全天投放
 * days：按具体日期的半小时网格；一个日期都没配置时不干预（避免误关）
 * weekly：旧的按星期循环（兼容保留）
 * window：旧的绝对日期时间窗，仍由 segments 分支处理
 */
function desiredAction(auto, now = new Date()) {
  if (auto.masterEnabled === false) return null;
  if (auto.mode === 'allday') return 'enable';
  // oneshot 是"到点执行一次"的事件，不走状态对齐（由 tick 单独处理）
  if (auto.mode === 'oneshot') return null;
  if (auto.mode === 'days') {
    const map = normalizeDayHours(auto.dayHours);
    if (!Object.keys(map).length) return null;
    const arr = map[localDateKey(now)];
    if (!arr) return 'disable';
    const slot = now.getHours() * 2 + (now.getMinutes() >= 30 ? 1 : 0);
    return arr[slot] ? 'enable' : 'disable';
  }
  if (auto.mode === 'weekly') {
    const hours = normalizeHours(auto.hours);
    return hours[now.getDay()][now.getHours()] ? 'enable' : 'disable';
  }
  return null;
}

/** Get or create automation config for a campaign */
function getAutomation(campaignId) {
  const list = getAutomations();
  return list.find((a) => a.campaignId === String(campaignId)) || null;
}

function upsertAutomation(partial) {
  if (!partial || !partial.campaignId) throw new Error('缺少 campaignId');
  const list = getAutomations();
  const campaignId = String(partial.campaignId);
  let idx = list.findIndex((a) => a.campaignId === campaignId);
  const base =
    idx >= 0
      ? list[idx]
      : {
          id: uid('auto'),
          campaignId,
          campaignName: partial.campaignName || campaignId,
          country: partial.country || '',
          masterEnabled: true,
          mode: 'days',
          dayHours: {},
          hours: emptyHours(),
          segments: defaultSegments(),
          updatedAt: new Date().toISOString(),
        };
  const next = {
    ...base,
    ...partial,
    campaignId,
    segments: Array.isArray(partial.segments) ? partial.segments : base.segments,
    hours: normalizeHours(partial.hours !== undefined ? partial.hours : base.hours),
    dayHours: normalizeDayHours(
      partial.dayHours !== undefined ? partial.dayHours : base.dayHours
    ),
    updatedAt: new Date().toISOString(),
  };
  // ensure segment ids
  next.segments = next.segments.map((s) => ({
    id: s.id || uid('seg'),
    enabled: s.enabled !== false,
    start: s.start || '',
    end: s.end || '',
  }));
  // 过期排期剪枝（与前端同一口径）：
  // 早于今天的整天删除；今天只保留结束时刻还在未来的半小时槽（00:00-01:00 在 01:00 后过期）
  const nowMs = Date.now();
  const today = localDateKey(new Date());
  for (const k of Object.keys(next.dayHours)) {
    const arr = next.dayHours[k];
    if (k < today) {
      delete next.dayHours[k];
      continue;
    }
    if (k === today && Array.isArray(arr)) {
      const dayStart = new Date(`${k}T00:00`).getTime();
      const kept = arr.map((v, slot) =>
        v && dayStart + (slot + 1) * 30 * 60 * 1000 > nowMs ? true : false
      );
      if (kept.some(Boolean)) next.dayHours[k] = kept;
      else delete next.dayHours[k];
    }
  }
  // 旧 window 时间窗：完整但已过期的段自动清除（避免徽章误报"有排期"）
  const nowIso = `${today}T${String(new Date().getHours()).padStart(2, '0')}:${String(
    new Date().getMinutes()
  ).padStart(2, '0')}`;
  next.segments = (next.segments || []).filter(
    (s) => !(s.start && s.end) || s.end >= nowIso
  );
  // 单次定时开关规范化；显式传 null 表示清除
  next.oneshot =
    partial.oneshot && partial.oneshot.date && partial.oneshot.time
      ? {
          date: String(partial.oneshot.date),
          time: String(partial.oneshot.time),
          action: partial.oneshot.action === 'disable' ? 'disable' : 'enable',
          done: !!partial.oneshot.done,
        }
      : null;
  // 调度配置变了就清掉已执行状态，下一次 tick 重新对齐到当前时段
  const scheduleChanged =
    base.mode !== next.mode ||
    base.masterEnabled !== next.masterEnabled ||
    JSON.stringify(base.hours) !== JSON.stringify(next.hours) ||
    JSON.stringify(base.dayHours) !== JSON.stringify(next.dayHours) ||
    JSON.stringify(base.segments) !== JSON.stringify(next.segments) ||
    JSON.stringify(base.oneshot || null) !== JSON.stringify(next.oneshot || null);
  if (scheduleChanged) next.lastDesired = '';
  if (idx >= 0) list[idx] = next;
  else list.unshift(next);
  saveAutomations(list);
  return next;
}

function removeAutomation(campaignId) {
  const list = getAutomations().filter((a) => a.campaignId !== String(campaignId));
  saveAutomations(list);
  return list;
}

function setMasterEnabled(campaignId, enabled) {
  const auto = getAutomation(campaignId);
  if (!auto) throw new Error('未找到该计划的自动化配置');
  return upsertAutomation({ ...auto, masterEnabled: !!enabled });
}

function setSegmentEnabled(campaignId, segmentId, enabled) {
  const auto = getAutomation(campaignId);
  if (!auto) throw new Error('未找到该计划的自动化配置');
  const segments = auto.segments.map((s) =>
    s.id === segmentId ? { ...s, enabled: !!enabled } : s
  );
  return upsertAutomation({ ...auto, segments });
}

function fireKey(segId, kind, dateKey) {
  return `auto|${segId}|${kind}|${dateKey}`;
}

/**
 * Expand automations into executable fire points for "now".
 * For each enabled segment with master on:
 *  - at start local time → enable
 *  - at end local time → disable
 */
async function tick(now = new Date()) {
  // MOCK 演示模式不参与调度：它只打日志不调 API，却会写 lastDesired，
  // 导致真实桌面端 tick 时以为已执行而跳过（实测：MOCK 实例抢跑了 15:00 的开启）
  if (tiktok.isMock()) return [];

  const dateKey = localDateKey(now);
  const hhmm = localHHMM(now);
  const fired = new Set(getRuns().map((r) => r.key).filter(Boolean));
  const autos = getAutomations();
  const results = [];
  let autosDirty = false;

  for (const auto of autos) {
    if (auto.masterEnabled === false) continue;

    // 单次定时开关：到点执行一次后自动失效；过期未执行的按天作废
    if (auto.mode === 'oneshot') {
      const os = auto.oneshot;
      if (os && os.date && os.time && !os.done) {
        if (os.date < dateKey) {
          auto.oneshot = { ...os, done: true };
          autosDirty = true;
          log(
            'info',
            'scheduler',
            `单次开关过期作废 → ${auto.campaignName || auto.campaignId} (${os.date} ${os.time})`
          );
        } else if (os.date === dateKey && os.time === hhmm) {
          const lastErr = auto.lastErrorAt ? Date.parse(auto.lastErrorAt) : 0;
          if (!lastErr || Date.now() - lastErr > 60_000) {
            const key = fireKey(auto.id, 'oneshot', dateKey);
            try {
              await tiktok.updateCampaignStatus(auto.campaignId, os.action);
              auto.oneshot = { ...os, done: true };
              auto.lastErrorAt = '';
              autosDirty = true;
              const run = {
                key,
                source: 'automation',
                automationId: auto.id,
                campaignId: auto.campaignId,
                campaignName: auto.campaignName || '',
                action: os.action,
                status: 'ok',
                mode: 'oneshot',
                local: `${dateKey} ${hhmm}`,
              };
              pushRun(run);
              results.push(run);
              log(
                'info',
                'scheduler',
                `定时开关${os.action === 'enable' ? '开启' : '关闭'} → ${auto.campaignName || auto.campaignId} (${os.date} ${os.time})`
              );
            } catch (err) {
              auto.lastErrorAt = new Date().toISOString();
              autosDirty = true;
              const run = {
                key,
                source: 'automation',
                automationId: auto.id,
                campaignId: auto.campaignId,
                campaignName: auto.campaignName || '',
                action: os.action,
                status: 'error',
                error: err.message,
                mode: 'oneshot',
                local: `${dateKey} ${hhmm}`,
              };
              pushRun(run);
              results.push(run);
              log('error', 'scheduler', `定时开关执行失败: ${err.message}`);
            }
          }
        }
      }
      continue;
    }

    // 全天 / 每周分时段：与“当前应处状态”对齐（变了才调 API）
    const desired = desiredAction(auto, now);
    if (desired) {
      if (auto.lastDesired !== desired) {
        // 上次失败 60s 内不重试，避免刷屏
        const lastErr = auto.lastErrorAt ? Date.parse(auto.lastErrorAt) : 0;
        if (!lastErr || Date.now() - lastErr > 60_000) {
          const key = fireKey(auto.id, desired, dateKey);
          try {
            await tiktok.updateCampaignStatus(auto.campaignId, desired);
            const run = {
              key,
              source: 'automation',
              automationId: auto.id,
              campaignId: auto.campaignId,
              campaignName: auto.campaignName || '',
              action: desired,
              status: 'ok',
              mode: auto.mode,
              local: `${dateKey} ${hhmm}`,
            };
            pushRun(run);
            results.push(run);
            auto.lastDesired = desired;
            auto.lastErrorAt = '';
            autosDirty = true;
            log(
              'info',
              'scheduler',
              `${desired === 'enable' ? '到时段开启' : '出时段暂停'} → ${auto.campaignName || auto.campaignId}`
            );
          } catch (err) {
            const run = {
              key,
              source: 'automation',
              automationId: auto.id,
              campaignId: auto.campaignId,
              campaignName: auto.campaignName || '',
              action: desired,
              status: 'error',
              error: err.message,
              mode: auto.mode,
              local: `${dateKey} ${hhmm}`,
            };
            pushRun(run);
            results.push(run);
            auto.lastErrorAt = new Date().toISOString();
            autosDirty = true;
            log('error', 'scheduler', `时段对齐失败: ${err.message}`);
          }
        }
      }
      continue;
    }

    // 旧版绝对日期时间窗（segments）仍兼容执行
    for (const seg of auto.segments || []) {
      if (!seg.enabled) continue;
      const start = parseLocalDT(seg.start);
      const end = parseLocalDT(seg.end);
      const points = [];
      if (start && localDateKey(start) === dateKey && localHHMM(start) === hhmm) {
        points.push({ kind: 'start', action: 'enable', label: '开启', at: start });
      }
      if (end && localDateKey(end) === dateKey && localHHMM(end) === hhmm) {
        points.push({ kind: 'end', action: 'disable', label: '暂停', at: end });
      }
      for (const p of points) {
        const key = fireKey(seg.id, p.kind, dateKey);
        if (fired.has(key)) continue;
        try {
          await tiktok.updateCampaignStatus(auto.campaignId, p.action);
          const run = {
            key,
            source: 'automation',
            automationId: auto.id,
            segmentId: seg.id,
            campaignId: auto.campaignId,
            campaignName: auto.campaignName || '',
            action: p.action,
            status: 'ok',
            local: `${dateKey} ${hhmm}`,
            segmentStart: seg.start,
            segmentEnd: seg.end,
          };
          pushRun(run);
          results.push(run);
          log(
            'info',
            'scheduler',
            `时间窗 ${p.label} → ${auto.campaignName || auto.campaignId} (${seg.start}~${seg.end})`
          );
        } catch (err) {
          const run = {
            key,
            source: 'automation',
            automationId: auto.id,
            segmentId: seg.id,
            campaignId: auto.campaignId,
            campaignName: auto.campaignName || '',
            action: p.action,
            status: 'error',
            error: err.message,
            local: `${dateKey} ${hhmm}`,
          };
          pushRun(run);
          results.push(run);
          log('error', 'scheduler', `时间窗执行失败: ${err.message}`);
        }
      }
    }
  }
  if (autosDirty) saveAutomations(autos);
  return results;
}

/** Execution table: expand segments into start/end rows with switches */
function listExecutionItems() {
  const autos = getAutomations();
  const items = [];
  for (const auto of autos) {
    for (const seg of auto.segments || []) {
      if (!seg.start && !seg.end) continue;
      items.push({
        automationCampaignId: auto.campaignId,
        campaignName: auto.campaignName || auto.campaignId,
        country: auto.country || '',
        masterEnabled: auto.masterEnabled !== false,
        segmentId: seg.id,
        segmentEnabled: seg.enabled !== false,
        start: seg.start || '',
        end: seg.end || '',
        keyStart: fireKey(seg.id, 'start', localDateKey(parseLocalDT(seg.start) || new Date())),
        keyEnd: seg.end
          ? fireKey(seg.id, 'end', localDateKey(parseLocalDT(seg.end) || new Date()))
          : '',
      });
    }
  }
  return items;
}

module.exports = {
  getAutomations,
  saveAutomations,
  getAutomation,
  upsertAutomation,
  removeAutomation,
  setMasterEnabled,
  setSegmentEnabled,
  listExecutionItems,
  getRuns,
  tick,
  defaultSegments,
  emptyHours,
  normalizeHours,
  normalizeDayHours,
  desiredAction,
  parseLocalDT,
  localDateKey,
  localHHMM,
};
