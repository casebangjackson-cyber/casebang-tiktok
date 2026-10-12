'use strict';

const fs = require('fs');
const path = require('path');

let app = null;
try {
  app = require('electron').app || null;
} catch {
  app = null;
}

const projectData = path.join(__dirname, '..', 'data');
const userDataData = app?.getPath?.('userData')
  ? path.join(app.getPath('userData'), 'data')
  : projectData;
// 优先项目内 data/（便于查看日志与调试）
const activeDataDir = projectData;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  const p = path.join(activeDataDir, file);
  try {
    if (!fs.existsSync(p)) return fallback;
    let raw = fs.readFileSync(p, 'utf8');
    // strip UTF-8 BOM
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir(activeDataDir);
  const p = path.join(activeDataDir, file);
  fs.writeFileSync(p, JSON.stringify(value, null, 2), 'utf8');
}

function readText(file, fallback = '') {
  const p = path.join(activeDataDir, file);
  try {
    if (!fs.existsSync(p)) return fallback;
    return fs.readFileSync(p, 'utf8');
  } catch {
    return fallback;
  }
}

function writeText(file, text) {
  ensureDir(activeDataDir);
  fs.writeFileSync(path.join(activeDataDir, file), text, 'utf8');
}

function appendLog(entry) {
  const logs = readJson('logs.json', []);
  const item = {
    ts: new Date().toISOString(),
    level: entry.level || 'info',
    source: entry.source || 'app',
    message: entry.message,
    detail: entry.detail || null,
  };
  logs.unshift(item);
  if (logs.length > 500) logs.length = 500;
  writeJson('logs.json', logs);
  return item;
}

module.exports = {
  activeDataDir,
  readJson,
  writeJson,
  readText,
  writeText,
  appendLog,
  ensureDir,
};
