'use strict';

const { readJson, writeJson } = require('./store');
const { log } = require('./logger');
const tiktok = require('./tiktok');
const automations = require('./automations');

const SCHED_FILE = 'schedules.json';
const RUN_FILE = 'schedule_runs.json';

function getSchedules() {
  return readJson(SCHED_FILE, []);
}

function saveSchedules(list) {
  writeJson(SCHED_FILE, list);
  return list;
}

function upsertSchedule(item) {
  const list = getSchedules();
  if (item.id) {
    const i = list.findIndex((s) => s.id === item.id);
    if (i >= 0) list[i] = { ...list[i], ...item };
    else list.unshift(item);
  } else {
    item.id = `sch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    list.unshift(item);
  }
  saveSchedules(list);
  return list;
}

function removeSchedule(id) {
  const list = getSchedules().filter((s) => s.id !== id);
  saveSchedules(list);
  return list;
}

function getRuns() {
  return readJson(RUN_FILE, []);
}

function pushRun(entry) {
  const runs = readJson(RUN_FILE, []);
  runs.unshift({ ts: new Date().toISOString(), ...entry });
  if (runs.length > 300) runs.length = 300;
  writeJson(RUN_FILE, runs);
}

function nowParts(d = new Date()) {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const day = d.getDay(); // 0=Sun
  return { hhmm: `${hh}:${mm}`, day, dateKey: d.toISOString().slice(0, 10) };
}

function shouldFireToday(schedule, day) {
  const days = Array.isArray(schedule.days) ? schedule.days : [0, 1, 2, 3, 4, 5, 6];
  if (!days.length) return true;
  return days.includes(day);
}

function fireKey(schedule, dateKey) {
  return `${schedule.id}|${dateKey}|${schedule.time}`;
}

async function tick() {
  const { hhmm, day, dateKey } = nowParts();
  const fired = new Set(readJson(RUN_FILE, []).map((r) => r.key).filter(Boolean));
  const schedules = getSchedules();
  const results = [];

  for (const s of schedules) {
    if (!s.enabled) continue;
    if (!s.time || s.time !== hhmm) continue;
    if (!shouldFireToday(s, day)) continue;
    const key = fireKey(s, dateKey);
    if (fired.has(key)) continue;

    try {
      await tiktok.updateCampaignStatus(s.campaignId, s.action);
      const run = {
        key,
        scheduleId: s.id,
        campaignId: s.campaignId,
        campaignName: s.campaignName || '',
        action: s.action,
        status: 'ok',
        time: hhmm,
      };
      pushRun(run);
      results.push(run);
      log('info', 'scheduler', `执行 ${s.action} → ${s.campaignName || s.campaignId}`);
    } catch (err) {
      const run = {
        key,
        scheduleId: s.id,
        campaignId: s.campaignId,
        campaignName: s.campaignName || '',
        action: s.action,
        status: 'error',
        error: err.message,
        time: hhmm,
      };
      pushRun(run);
      results.push(run);
      log('error', 'scheduler', `执行失败: ${err.message}`);
    }
  }

  // 多段时间窗（绝对日期）
  try {
    const autoRuns = await automations.tick();
    results.push(...autoRuns);
  } catch (err) {
    log('error', 'scheduler', '时间窗 tick 失败: ' + err.message);
  }
  return results;
}

let timer = null;

function startScheduler(intervalMs = 20_000) {
  if (timer) return { already: true };
  // 每 20s tick 一次；到点那一分钟内会命中
  timer = setInterval(() => {
    tick().catch((e) => log('error', 'scheduler', e.message));
  }, intervalMs);
  // 启动时立刻跑一次
  tick().catch((e) => log('error', 'scheduler', e.message));
  log('info', 'scheduler', '调度器已启动');
  return { ok: true };
}

function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  log('info', 'scheduler', '调度器已停止');
}

function isRunning() {
  return !!timer;
}

module.exports = {
  getSchedules,
  saveSchedules,
  upsertSchedule,
  removeSchedule,
  getRuns,
  startScheduler,
  stopScheduler,
  isRunning,
  tick,
};
