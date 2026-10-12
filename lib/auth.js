'use strict';

/**
 * 账号 / 会话 / 邮箱验证码。
 * - 密码：scrypt 加盐哈希
 * - 会话：服务端登记，不设过期，只有主动退出才失效
 * - 验证码：4 位数字，5 分钟有效，带冷却 / 每日上限 / 尝试次数限制
 * - 发信：SMTP（nodemailer），未配置时验证码登录自动禁用
 */
const crypto = require('crypto');
const { readJson, writeJson } = require('./store');

const USERS_FILE = 'users.json';
const SESSIONS_FILE = 'sessions.json';
const CODES_FILE = 'auth_codes.json';

const CODE_TTL_MS = 5 * 60 * 1000;
const CODE_COOLDOWN_MS = 60 * 1000;
const CODE_MAX_ATTEMPTS = 5;
const CODE_DAILY_LIMIT = 20;
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 60 * 1000;
const SESSION_TOUCH_MS = 5 * 60 * 1000;

/* ---------------- 邮箱 / 密码 ---------------- */

function normEmail(v) {
  return String(v || '').trim().toLowerCase();
}

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

function isValidPassword(v) {
  return typeof v === 'string' && v.length >= 6 && v.length <= 128;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `s1$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const parts = String(stored).split('$');
  if (parts.length !== 3 || parts[0] !== 's1') return false;
  const [, salt, hash] = parts;
  let calc;
  try {
    calc = crypto.scryptSync(String(password), salt, 64);
  } catch {
    return false;
  }
  const expect = Buffer.from(hash, 'hex');
  return expect.length === calc.length && crypto.timingSafeEqual(calc, expect);
}

/* ---------------- 用户 ---------------- */

function getUsers() {
  return readJson(USERS_FILE, []);
}

function findUser(email) {
  const e = normEmail(email);
  return getUsers().find((u) => u.email === e) || null;
}

function createUser(email) {
  const list = getUsers();
  const user = {
    id: 'u_' + crypto.randomBytes(8).toString('hex'),
    email: normEmail(email),
    passwordHash: '',
    createdAt: new Date().toISOString(),
  };
  list.push(user);
  writeJson(USERS_FILE, list);
  return user;
}

function setPassword(user, password) {
  const list = getUsers();
  const i = list.findIndex((u) => u.id === user.id);
  if (i < 0) return null;
  list[i] = { ...list[i], passwordHash: hashPassword(password), updatedAt: new Date().toISOString() };
  writeJson(USERS_FILE, list);
  return list[i];
}

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, email: u.email, hasPassword: !!u.passwordHash, createdAt: u.createdAt };
}

function authenticateWithPassword(email, password, allowBootstrap = false) {
  const key = normEmail(email);
  let user = findUser(key);

  if (!user) {
    // 没有发信渠道时无法验证邮箱归属，允许直接用密码建号（自举）
    if (!allowBootstrap) {
      return { ok: false, error: '该邮箱还没注册，请用「邮箱验证码」登录并设置密码' };
    }
    if (!isValidPassword(password)) return { ok: false, error: '密码至少 6 位' };
    user = createUser(key);
    user = setPassword(user, password) || user;
    return { ok: true, user, created: true };
  }

  if (!user.passwordHash) {
    return { ok: false, error: '该邮箱还没设置密码，请用「邮箱验证码」登录并设置密码' };
  }
  if (!verifyPassword(password, user.passwordHash)) return { ok: false, error: '邮箱或密码不正确' };
  return { ok: true, user };
}

/* ---------------- 登录失败限流 ---------------- */

const loginFails = new Map(); // email -> { count, windowStart }

function loginBlocked(email) {
  const rec = loginFails.get(normEmail(email));
  if (!rec) return false;
  if (Date.now() - rec.windowStart > LOGIN_WINDOW_MS) {
    loginFails.delete(normEmail(email));
    return false;
  }
  return rec.count >= LOGIN_MAX_ATTEMPTS;
}

function recordLoginFail(email) {
  const key = normEmail(email);
  const now = Date.now();
  const rec = loginFails.get(key);
  if (!rec || now - rec.windowStart > LOGIN_WINDOW_MS) {
    loginFails.set(key, { count: 1, windowStart: now });
    return;
  }
  rec.count += 1;
}

function clearLoginFails(email) {
  loginFails.delete(normEmail(email));
}

/* ---------------- 会话（不主动过期） ---------------- */

function getSessions() {
  return readJson(SESSIONS_FILE, []);
}

function createSession(userId, meta = {}) {
  const list = getSessions();
  const now = new Date().toISOString();
  const session = {
    token: crypto.randomBytes(32).toString('base64url'),
    userId,
    createdAt: now,
    lastSeen: now,
    ip: String(meta.ip || '').slice(0, 64),
    ua: String(meta.ua || '').slice(0, 200),
  };
  list.push(session);
  // 只保留最近 50 条会话，避免文件无限增长（新 token 不受影响）
  if (list.length > 50) list.splice(0, list.length - 50);
  writeJson(SESSIONS_FILE, list);
  return session;
}

/** 校验会话并回写 lastSeen（节流写盘）。返回 null 表示无效。 */
function findSession(token) {
  const t = String(token || '').trim();
  if (!t) return null;
  const list = getSessions();
  const i = list.findIndex((s) => s.token === t);
  if (i < 0) return null;
  const session = list[i];
  const user = getUsers().find((u) => u.id === session.userId);
  if (!user) return null;
  const now = Date.now();
  const last = Date.parse(session.lastSeen || 0) || 0;
  if (now - last > SESSION_TOUCH_MS) {
    list[i] = { ...session, lastSeen: new Date(now).toISOString() };
    writeJson(SESSIONS_FILE, list);
  }
  return { session: list[i], user };
}

function destroySession(token) {
  const t = String(token || '').trim();
  const list = getSessions();
  const next = list.filter((s) => s.token !== t);
  if (next.length === list.length) return false;
  writeJson(SESSIONS_FILE, next);
  return true;
}

/* ---------------- 验证码 ---------------- */

function getCodes() {
  return readJson(CODES_FILE, {});
}

function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function smtpMissingError() {
  return '尚未配置发信邮箱，请在 .env 里填写 SMTP_HOST / SMTP_USER / SMTP_PASS（授权码），或改用密码登录';
}

/** 生成并落盘 4 位验证码；返回 code，失败返回 { error } */
function issueCode(email) {
  const key = normEmail(email);
  const now = Date.now();
  const store = getCodes();
  const rec = store[key] || {};

  if (rec.sentAt && now - Number(rec.sentAt) < CODE_COOLDOWN_MS) {
    const wait = Math.ceil((CODE_COOLDOWN_MS - (now - Number(rec.sentAt))) / 1000);
    return { error: `发送太频繁，请 ${wait} 秒后再试` };
  }

  const today = new Date().toISOString().slice(0, 10);
  const dayCount = rec.day === today ? Number(rec.dayCount || 0) : 0;
  if (dayCount >= CODE_DAILY_LIMIT) return { error: '该邮箱今日验证码发送次数已达上限' };

  const code = String(crypto.randomInt(1000, 10000));
  store[key] = {
    code,
    expiresAt: now + CODE_TTL_MS,
    attempts: 0,
    sentAt: now,
    day: today,
    dayCount: dayCount + 1,
  };
  writeJson(CODES_FILE, store);
  return { code };
}

/** 发送失败时回滚，让用户能立刻重试 */
function rollbackCode(email) {
  const key = normEmail(email);
  const store = getCodes();
  if (store[key]) {
    delete store[key];
    writeJson(CODES_FILE, store);
  }
}

function verifyCode(email, code) {
  const key = normEmail(email);
  const store = getCodes();
  const rec = store[key];
  if (!rec) return { ok: false, error: '验证码不存在或已失效，请重新发送' };
  if (Date.now() > Number(rec.expiresAt)) {
    delete store[key];
    writeJson(CODES_FILE, store);
    return { ok: false, error: '验证码已过期，请重新发送' };
  }
  if (Number(rec.attempts) >= CODE_MAX_ATTEMPTS) {
    delete store[key];
    writeJson(CODES_FILE, store);
    return { ok: false, error: '尝试次数过多，验证码已作废，请重新发送' };
  }

  rec.attempts = Number(rec.attempts) + 1;
  const input = String(code || '').trim();
  if (rec.code !== input) {
    const left = CODE_MAX_ATTEMPTS - rec.attempts;
    store[key] = rec;
    writeJson(CODES_FILE, store);
    return { ok: false, error: left > 0 ? `验证码不正确，还可尝试 ${left} 次` : '尝试次数过多，请重新发送' };
  }

  delete store[key];
  writeJson(CODES_FILE, store);
  return { ok: true };
}

/* ---------------- SMTP 发信 ---------------- */

async function sendLoginCode(email, code) {
  if (!smtpConfigured()) return { ok: false, error: smtpMissingError() };

  const nodemailer = require('nodemailer');
  const port = Number(process.env.SMTP_PORT || 465);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
  });

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await transport.sendMail({
    from: `"CASEBANG 广告中心" <${from}>`,
    to: email,
    subject: `登录验证码 ${code}`,
    text:
      `你的登录验证码是 ${code}（5 分钟内有效）。\n` +
      `若不是你本人操作，请忽略本邮件，不要把验证码告诉任何人。`,
    html: `
      <div style="font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;padding:24px;color:#1f2329">
        <p style="font-size:14px;color:#86909c;margin:0 0 16px">CASEBANG TK 广告中心 · 登录验证码</p>
        <div style="font-size:34px;font-weight:700;letter-spacing:8px;color:#e60012">${code}</div>
        <p style="font-size:13px;color:#86909c;margin-top:16px">5 分钟内有效。若不是你本人操作，请忽略本邮件。</p>
      </div>`,
  });
  return { ok: true };
}

module.exports = {
  normEmail,
  isValidEmail,
  isValidPassword,
  findUser,
  createUser,
  setPassword,
  authenticateWithPassword,
  publicUser,
  loginBlocked,
  recordLoginFail,
  clearLoginFails,
  createSession,
  findSession,
  destroySession,
  issueCode,
  rollbackCode,
  verifyCode,
  smtpConfigured,
  sendLoginCode,
  hashPassword,
};
