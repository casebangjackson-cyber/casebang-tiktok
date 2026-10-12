'use strict';

/**
 * 局域网 HTTP 服务：静态页面 + /api/* 控制接口 + SSE 实时推送。
 * 手机与电脑在同一 Wi-Fi 下访问 http://<电脑IP>:<PORT> 即可实时看数据 / 操作计划。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { config } = require('./config');
const tiktok = require('./tiktok');
const feishu = require('./feishu');
const scheduler = require('./scheduler');
const automations = require('./automations');
const reports = require('./reports');
const auth = require('./auth');
const { log } = require('./logger');
const { readJson } = require('./store');

const ROOT = path.join(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function getStatus() {
  const tokens = tiktok.getTokens();
  const feishuStatus = feishu.getFeishuStatus();
  return {
    mode: tiktok.isMock() ? 'MOCK' : 'LIVE',
    mock: tiktok.isMock(),
    tiktok: {
      hasKey: !!config.tiktok.clientKey,
      authorized: !!(tokens.accessToken || tiktok.isMock()),
      advertiserId: tokens.advertiserId || config.tiktok.advertiserId || '',
      expiresAt: tokens.expiresAt || 0,
    },
    feishu: {
      appId: config.feishu.appId || '',
      connected: !!feishuStatus.feishuConnected,
      allowedCount: config.feishu.allowedOpenIds.length,
    },
    scheduler: scheduler.isRunning(),
    schedules: scheduler.getSchedules().length,
    automations: automations.getAutomations().length,
    logs: readJson('logs.json', []).slice(0, 50),
    runs: scheduler.getRuns().slice(0, 30),
    autoRuns: automations.getRuns().slice(0, 30),
  };
}

/* ---------- SSE：改动后推给手机端 ---------- */
const sseClients = new Set();

function notify() {
  for (const res of sseClients) {
    try {
      res.write('data: {}\n\n');
    } catch {
      sseClients.delete(res);
    }
  }
}

/** 未登录也允许访问的接口（登录流程本身 + 连通性探测） */
const PUBLIC_PATHS = new Set([
  '/api/ping',
  '/api/auth/login',
  '/api/auth/code',
  '/api/auth/verify',
]);

/** 会话 token：优先 Authorization，其次自定义头，最后 query（SSE 的 EventSource 只能走 query） */
function extractToken(req, url) {
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const hdr = String(req.headers['x-app-token'] || '');
  const q = url.searchParams.get('token') || '';
  return (bearer || hdr || q).trim();
}

function sendJson(res, code, obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-App-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(buf);
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

/** 所有会改动状态的接口成功后广播一次 */
function touched(res, payload) {
  notify();
  sendJson(res, 200, payload);
}

async function handleApi(req, res, url) {
  const method = req.method || 'GET';
  const p = url.pathname;
  const body = method === 'POST' ? await readBody(req) : {};

  // 会话认证：登录后拿到的 token，服务端不主动过期，只有退出登录才失效
  if (!PUBLIC_PATHS.has(p)) {
    const token = extractToken(req, url);
    const hit = auth.findSession(token);
    if (!hit) {
      return sendJson(res, 401, { ok: false, needLogin: true, error: '未登录或登录已失效' });
    }
    req.authUser = hit.user;
    req.sessionToken = token;
  }

  const want = (data) => touched(res, data);

  switch (`${method} ${p}`) {
    /* —— 登录 / 会话 —— */
    case 'POST /api/auth/login': {
      const email = auth.normEmail(body.email);
      const password = String(body.password || '');
      if (!auth.isValidEmail(email)) return sendJson(res, 200, { ok: false, error: '邮箱格式不正确' });
      if (!password) return sendJson(res, 200, { ok: false, error: '请输入密码' });
      if (auth.loginBlocked(email)) {
        return sendJson(res, 200, { ok: false, error: '失败次数过多，请 1 分钟后再试' });
      }
      // 未配置发信渠道时无法验证邮箱归属，允许用密码直接建号；配了 SMTP 就必须先验证码验证
      const r = auth.authenticateWithPassword(email, password, !auth.smtpConfigured());
      if (!r.ok) {
        auth.recordLoginFail(email);
        return sendJson(res, 200, { ok: false, error: r.error });
      }
      auth.clearLoginFails(email);
      if (r.created) log('info', 'auth', `创建账号: ${email}`);
      const s = auth.createSession(r.user.id, { ip: req.socket.remoteAddress, ua: req.headers['user-agent'] });
      log('info', 'auth', `密码登录成功: ${email}`);
      return sendJson(res, 200, { ok: true, token: s.token, user: auth.publicUser(r.user) });
    }

    case 'POST /api/auth/code': {
      const email = auth.normEmail(body.email);
      if (!auth.isValidEmail(email)) return sendJson(res, 200, { ok: false, error: '邮箱格式不正确' });
      const issued = auth.issueCode(email);
      if (issued.error) return sendJson(res, 200, { ok: false, error: issued.error });
      try {
        const sent = await auth.sendLoginCode(email, issued.code);
        if (!sent.ok) {
          auth.rollbackCode(email);
          return sendJson(res, 200, { ok: false, error: sent.error });
        }
      } catch (e) {
        auth.rollbackCode(email);
        log('error', 'auth', `验证码发送失败: ${e.message}`);
        return sendJson(res, 200, { ok: false, error: '验证码发送失败：' + e.message });
      }
      log('info', 'auth', `已发送登录验证码: ${email}`);
      return sendJson(res, 200, { ok: true, cooldown: 60 });
    }

    case 'POST /api/auth/verify': {
      const email = auth.normEmail(body.email);
      const password = String(body.password || '');
      if (!auth.isValidEmail(email)) return sendJson(res, 200, { ok: false, error: '邮箱格式不正确' });
      if (password && !auth.isValidPassword(password)) {
        return sendJson(res, 200, { ok: false, error: '密码至少 6 位' });
      }
      const ok = auth.verifyCode(email, body.code);
      if (!ok.ok) return sendJson(res, 200, { ok: false, error: ok.error });

      let user = auth.findUser(email);
      if (!user) user = auth.createUser(email);
      if (password) user = auth.setPassword(user, password) || user;

      const s = auth.createSession(user.id, { ip: req.socket.remoteAddress, ua: req.headers['user-agent'] });
      log('info', 'auth', `验证码登录成功: ${email}`);
      return sendJson(res, 200, { ok: true, token: s.token, user: auth.publicUser(user) });
    }

    case 'POST /api/auth/set-password': {
      const password = String(body.password || '');
      if (!auth.isValidPassword(password)) {
        return sendJson(res, 200, { ok: false, error: '密码至少 6 位' });
      }
      auth.setPassword(req.authUser, password);
      return sendJson(res, 200, { ok: true, user: { ...auth.publicUser(req.authUser), hasPassword: true } });
    }

    case 'POST /api/auth/logout':
      auth.destroySession(req.sessionToken);
      log('info', 'auth', `退出登录: ${req.authUser.email}`);
      return sendJson(res, 200, { ok: true });

    case 'GET /api/auth/me':
      return sendJson(res, 200, { ok: true, user: auth.publicUser(req.authUser) });

    case 'GET /api/ping':
      return sendJson(res, 200, {
        ok: true,
        app: 'casebang',
        ts: Date.now(),
        smtp: auth.smtpConfigured(),
      });

    case 'GET /api/status':
      return sendJson(res, 200, getStatus());

    case 'GET /api/logs':
      return sendJson(res, 200, readJson('logs.json', []).slice(0, 100));

    case 'GET /api/stream': {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no',
      });
      res.write(': connected\n\n');
      sseClients.add(res);
      const hb = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          /* 心跳失败由 close 清理 */
        }
      }, 20000);
      const clean = () => {
        clearInterval(hb);
        sseClients.delete(res);
      };
      req.on('close', clean);
      res.on('close', clean);
      return;
    }

    /* —— TikTok —— */
    case 'POST /api/tiktok/auth': {
      try {
        log('info', 'tiktok', '（手机端）开始 TikTok 授权流程…');
        const r = await tiktok.startOAuthCallbackServer();
        if (r?.authorizeUrl) {
          try {
            require('electron').shell?.openExternal?.(r.authorizeUrl);
          } catch {
            /* 无 Electron（纯 headless）时仅返回链接 */
          }
          log('info', 'tiktok', '授权页已就绪', { url: r.authorizeUrl, portBusy: !!r.portBusy });
        }
        return want({ ok: true, ...r });
      } catch (e) {
        return sendJson(res, 200, { ok: false, error: e.message });
      }
    }

    case 'GET /api/tiktok/advertisers': {
      try {
        return sendJson(res, 200, { ok: true, list: await tiktok.getAdvertisers() });
      } catch (e) {
        return sendJson(res, 200, { ok: false, error: e.message, list: [] });
      }
    }

    case 'POST /api/tiktok/advertiser': {
      tiktok.saveTokens({ advertiserId: String(body.advertiserId || '').trim() });
      if (!config.tiktok.advertiserId) config.tiktok.advertiserId = String(body.advertiserId || '');
      return want({ ok: true });
    }

    case 'GET /api/tiktok/campaigns': {
      try {
        const list = await tiktok.listCampaigns();
        return sendJson(res, 200, { ok: true, list, country: list[0]?.country || '' });
      } catch (e) {
        return sendJson(res, 200, { ok: false, error: e.message, list: [] });
      }
    }

    case 'POST /api/tiktok/toggle': {
      try {
        await tiktok.updateCampaignStatus(body.campaignId, body.action);
        return want({ ok: true });
      } catch (e) {
        return sendJson(res, 200, { ok: false, error: e.message });
      }
    }

    /* —— 投放时段自动化 —— */
    case 'GET /api/auto/list':
      return sendJson(res, 200, automations.getAutomations());

    case 'GET /api/auto/get':
      return sendJson(res, 200, automations.getAutomation(url.searchParams.get('campaignId') || ''));

    case 'POST /api/auto/upsert': {
      try {
        return want({ ok: true, automation: automations.upsertAutomation(body) });
      } catch (e) {
        return sendJson(res, 200, { ok: false, error: e.message });
      }
    }

    case 'POST /api/auto/remove':
      automations.removeAutomation(String(body.campaignId || ''));
      return want({ ok: true });

    case 'POST /api/auto/master': {
      try {
        return want({
          ok: true,
          automation: automations.setMasterEnabled(String(body.campaignId || ''), body.enabled !== false),
        });
      } catch (e) {
        return sendJson(res, 200, { ok: false, error: e.message });
      }
    }

    case 'POST /api/auto/segment': {
      try {
        return want({
          ok: true,
          automation: automations.setSegmentEnabled(
            String(body.campaignId || ''),
            String(body.segmentId || ''),
            body.enabled !== false
          ),
        });
      } catch (e) {
        return sendJson(res, 200, { ok: false, error: e.message });
      }
    }

    case 'GET /api/auto/runs':
      return sendJson(res, 200, automations.getRuns());

    /* —— 旧的定时规则 —— */
    case 'GET /api/sched/list':
      return sendJson(res, 200, scheduler.getSchedules());

    case 'GET /api/sched/runs':
      return sendJson(res, 200, scheduler.getRuns());

    case 'POST /api/sched/upsert':
      return want(scheduler.upsertSchedule(body.item || body));

    case 'POST /api/sched/remove':
      return want(scheduler.removeSchedule(String(body.id || '')));

    case 'POST /api/sched/start':
      return want(scheduler.startScheduler());

    case 'POST /api/sched/stop':
      return want(scheduler.stopScheduler());

    case 'POST /api/sched/tick':
      return want(await scheduler.tick());

    /* —— 飞书 —— */
    case 'POST /api/feishu/connect': {
      try {
        return want({ ok: true, ...(await feishu.connectFeishu()) });
      } catch (e) {
        log('error', 'feishu', e.message);
        return sendJson(res, 200, { ok: false, error: e.message });
      }
    }

    case 'POST /api/feishu/disconnect':
      feishu.disconnectFeishu();
      return want({ ok: true });

    /* —— 看板 —— */
    case 'GET /api/reports/dashboard':
    case 'POST /api/reports/dashboard': {
      const range =
        method === 'POST'
          ? body || {}
          : Object.fromEntries(
              ['startDate', 'endDate', 'accountId', 'promotionType', 'country'].filter((k) =>
                url.searchParams.get(k)
              ).map((k) => [k, url.searchParams.get(k)])
            );
      try {
        const data = await reports.getCampaignReport(range || {});
        return sendJson(res, 200, {
          ok: true,
          ...data,
          summary: reports.summarize(data.daily || []),
        });
      } catch (e) {
        return sendJson(res, 200, { ok: false, error: e.message });
      }
    }

    default:
      if (p.startsWith('/api/')) {
        return sendJson(res, 404, { ok: false, error: '未知接口 ' + method + ' ' + p });
      }
      return false; // 交给静态文件处理
  }
}

function serveStatic(req, res, url) {
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const it of ifaces[name] || []) {
      if (it.family === 'IPv4' && !it.internal) out.push(it.address);
    }
  }
  return out;
}

/**
 * HTTP 访问日志：记录每个请求的来源 IP、路径、状态码、耗时。
 * 用于诊断"手机请求到底到没到、哪个资源失败"。
 */
const ACCESS_LOG = path.join(ROOT, 'data', 'access.log');
const ACCESS_LOG_MAX = 300 * 1024;

function accessLog(t0, remote, method, target, status) {
  try {
    const ms = Date.now() - t0;
    const line = `${new Date().toISOString()} ${method || '-'} ${String(target || '-').slice(0, 140)} -> ${status} from ${remote || '-'} ${ms}ms\n`;
    fs.appendFileSync(ACCESS_LOG, line);
    const st = fs.statSync(ACCESS_LOG);
    if (st.size > ACCESS_LOG_MAX) {
      const lines = fs.readFileSync(ACCESS_LOG, 'utf8').split('\n');
      fs.writeFileSync(ACCESS_LOG, lines.slice(-400).join('\n'), 'utf8');
    }
  } catch {
    /* 日志失败不影响请求 */
  }
}

function start(options = {}) {
  const port = Number(options.port || process.env.PORT || 5173);
  const host = options.host || process.env.HOST || '0.0.0.0';

  const server = http.createServer(async (req, res) => {
    const t0 = Date.now();
    const remote = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');

    // 请求结束（正常或中断）都记一笔，便于定位"到没到 / 半途断了"
    const record = () => accessLog(t0, remote, req.method, req.url, res.statusCode || 0);
    res.on('finish', record);
    res.on('close', () => {
      if (!res.writableEnded) record();
    });

    let url;
    try {
      url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    } catch {
      res.writeHead(400);
      res.end('Bad Request');
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-App-Token',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      });
      res.end();
      return;
    }

    try {
      if (url.pathname.startsWith('/api/')) {
        const done = await handleApi(req, res, url);
        if (done === false) serveStatic(req, res, url);
        return;
      }
      serveStatic(req, res, url);
    } catch (e) {
      log('error', 'api', e.message);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: e.message });
      else res.end();
    }
  });

  server.listen(port, host, () => {
    const ips = lanAddresses();
    log('info', 'api', `手机端服务已启动 http://0.0.0.0:${port}`);
    console.log(`\n  CASEBANG 手机端服务`);
    console.log(`  本机:   http://127.0.0.1:${port}`);
    for (const ip of ips) console.log(`  手机:   http://${ip}:${port}   (同一 Wi-Fi)`);
    console.log(
      auth.smtpConfigured()
        ? '  登录:   密码 / 邮箱验证码 均可用'
        : '  登录:   仅密码登录（.env 填 SMTP_* 后开启邮箱验证码）'
    );
    console.log(`  会话:   登录后长期有效，仅退出登录才失效\n`);
    if (!ips.length) {
      console.log('  未检测到局域网 IP，请确认电脑已连接 Wi-Fi / 网线。\n');
    }
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`端口 ${port} 已被占用。若桌面端已在运行，手机直接访问它打印的地址即可。`);
    } else {
      console.error('手机端服务启动失败:', e.message);
    }
  });

  return server;
}

module.exports = { start, getStatus, notify, lanAddresses };
