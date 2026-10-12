'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { config } = require('./config');
const { readJson, writeJson } = require('./store');
const { log } = require('./logger');

const TOKEN_FILE = 'tiktok_tokens.json';

function getTokens() {
  return readJson(TOKEN_FILE, {
    accessToken: '',
    refreshToken: '',
    expiresAt: 0,
    advertiserId: config.tiktok.advertiserId || '',
    openIds: [],
  });
}

function saveTokens(partial) {
  const next = { ...getTokens(), ...partial };
  writeJson(TOKEN_FILE, next);
  return next;
}

function isMock() {
  return config.mock || !config.tiktok.clientKey;
}

function request(method, urlStr, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const finalHeaders = {
      'Content-Type': 'application/json',
      ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      ...headers,
    };
    // TikTok Ads API 要求 token 放在 Access-Token 头（不是 query）
    if (!finalHeaders['Access-Token'] && !finalHeaders['access-token']) {
      const tok = getTokens().accessToken;
      if (tok && !u.searchParams.has('oauth2')) {
        // 仅对 open_api 业务接口附加；oauth2 兑换接口不加
        if (u.pathname.includes('/open_api/')) {
          finalHeaders['Access-Token'] = tok;
        }
      }
    }
    const req = lib.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        headers: finalHeaders,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch {
            json = { raw: data };
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function buildAuthorizeUrl(state = 'gmvmax') {
  // 注意：open_api/v1.3/oauth2/authorize/ 对浏览器 GET 是 404
  // 官方门户授权页是 /portal/auth，参数用 app_id（不是 client_key）
  const advId = getTokens().advertiserId || config.tiktok.advertiserId || '';
  const q = new URLSearchParams({
    app_id: config.tiktok.clientKey,
    state,
    redirect_uri: config.tiktok.redirectUri,
    response_type: 'code',
  });
  if (advId) {
    // 部分账户可预选广告主；门户若不识别该参数会忽略
    q.set('advertiser_ids', advId);
    q.set('ad_authority', '1');
  }
  return `https://business-api.tiktok.com/portal/auth?${q.toString()}`;
}

function exchangeCode(authCode) {
  // 门户授权用 app_id；兑换接口部分版本仍要求 client_key —— 两个都带上
  return request('POST', `${config.tiktok.authBase}/oauth2/access_token/`, {
    app_id: config.tiktok.clientKey,
    client_key: config.tiktok.clientKey,
    secret: config.tiktok.clientSecret,
    grant_type: 'authorization_code',
    auth_code: authCode,
    code: authCode,
  });
}

async function refreshAccessToken() {
  const tokens = getTokens();
  if (!tokens.refreshToken) throw new Error('没有 refresh_token，请重新授权');
  const res = await request('POST', `${config.tiktok.authBase}/oauth2/refresh_access_token/`, {
    app_id: config.tiktok.clientKey,
    client_key: config.tiktok.clientKey,
    secret: config.tiktok.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
  });
  const j = res.json || {};
  if (j.code !== 0 || !j.access_token) {
    throw new Error(j.message || j.message_cn || `刷新 token 失败 HTTP ${res.status}`);
  }
  const expiresAt = Date.now() + (Number(j.expires_in) || 86400) * 1000;
  saveTokens({
    accessToken: j.access_token,
    refreshToken: j.refresh_token || tokens.refreshToken,
    expiresAt,
  });
  log('info', 'tiktok', 'access_token 已刷新');
  return getTokens();
}

async function probeToken(tokens) {
  const advId =
    (Array.isArray(tokens.advertiserIds) && tokens.advertiserIds[0]) ||
    tokens.advertiserId ||
    config.tiktok.advertiserId;
  if (!advId) return false;
  try {
    const res = await request(
      'GET',
      `${config.tiktok.apiBase}/advertiser/info/?advertiser_ids=${encodeURIComponent(
        JSON.stringify([String(advId)])
      )}&page=1&page_size=1`,
      null,
      { 'Access-Token': tokens.accessToken }
    );
    return res.json && res.json.code === 0;
  } catch {
    return false;
  }
}

async function ensureToken() {
  if (isMock()) return { mock: true };
  const tokens = getTokens();
  if (!tokens.accessToken) throw new Error('尚未完成 TikTok 授权');
  if (tokens.expiresAt && Date.now() > tokens.expiresAt - 60_000) {
    // 没有 refresh_token 时不能直接判死：本地记录的过期时间可能早于 TikTok 实际有效期
    if (!tokens.refreshToken) {
      const stillValid = await probeToken(tokens);
      if (stillValid) {
        saveTokens({ expiresAt: Date.now() + 3600_000 });
        log('info', 'tiktok', '本地已过期但 access_token 实测仍有效，顺延 1 小时');
        return getTokens();
      }
      throw new Error('access_token 已失效且无 refresh_token，请重新授权');
    }
    return refreshAccessToken();
  }
  return tokens;
}

async function getAdvertisers() {
  if (isMock()) {
    return [
      { advertiser_id: 'mock_adv_1', name: '示例广告账户（MOCK）', status: 'ENABLE' },
    ];
  }
  const tokens = await ensureToken();
  const advId = tokens.advertiserId || config.tiktok.advertiserId || '';
  const ids = Array.isArray(tokens.advertiserIds) && tokens.advertiserIds.length
    ? tokens.advertiserIds
    : advId
      ? [advId]
      : [];
  if (!ids.length) throw new Error('请先完成 TikTok 授权以获取广告账户');
  const res = await request(
    'GET',
    `${config.tiktok.apiBase}/advertiser/info/?access_token=${encodeURIComponent(tokens.accessToken)}` +
      `&advertiser_ids=${encodeURIComponent(JSON.stringify(ids))}&page=1&page_size=20`
  );
  const j = res.json || {};
  if (j.code !== 0) throw new Error(j.message || j.message_cn || '获取广告账户失败');
  return j.data?.list || [];
}

// 记录每个计划归属的广告户：切换 advertiser 后，旧计划的定时开关仍能找到原账户
const CAMPAIGN_ADV_FILE = 'campaign_adv.json';

function campaignAdvertisers() {
  return readJson(CAMPAIGN_ADV_FILE, {});
}

function saveCampaignAdvertisers(map) {
  writeJson(CAMPAIGN_ADV_FILE, map);
}

/**
 * 商家中心「直播 GMV Max」计划列表
 * GET /gmv_max/campaign/get/ · filtering.gmv_max_promotion_types = LIVE_GMV_MAX
 * 分页参数在 query 上（page / page_size），filtering 里只放过滤条件
 */
async function listLiveGmvCampaigns(advId) {
  const filtering = encodeURIComponent(
    JSON.stringify({ gmv_max_promotion_types: ['LIVE_GMV_MAX'] })
  );
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const res = await request(
      'GET',
      `${config.tiktok.apiBase}/gmv_max/campaign/get/?advertiser_id=${encodeURIComponent(advId)}` +
        `&filtering=${filtering}&page=${page}&page_size=100`
    );
    const j = res.json || {};
    if (j.code !== 0) throw new Error(j.message || j.message_cn || '获取直播 GMV Max 计划失败');
    const list = j.data?.list || [];
    out.push(...list);
    const totalPage = j.data?.page_info?.total_page || 1;
    if (page >= totalPage || !list.length) break;
  }
  return out;
}

/**
 * 投放市场（TH/VN/SG…）：advertiser/info 的 country 是公司注册地（HK），
 * 这里改用 GMV Max 店铺归属的 targeting_region_codes
 */
async function marketCountry(advId) {
  try {
    const data = await rawGet(
      `${config.tiktok.apiBase}/gmv_max/store/list/?advertiser_id=${encodeURIComponent(advId)}`
    );
    const stores = data.store_list || [];
    const hit = stores.find(
      (s) => String(s.exclusive_authorized_advertiser_info?.advertiser_id || '') === String(advId)
    );
    return (hit?.targeting_region_codes || [])[0] || '';
  } catch (e) {
    log('warn', 'tiktok', `识别投放市场失败 ${advId}: ${e.message}`);
    return '';
  }
}

/** 授权下的全部广告户：OAuth 返回的 advertiser_ids，兜底当前选中的那个 */
function authorizedAdvertiserIds(tokens) {
  const primary = String(tokens.advertiserId || config.tiktok.advertiserId || '');
  const ids = Array.isArray(tokens.advertiserIds)
    ? tokens.advertiserIds.filter(Boolean).map(String)
    : [];
  if (primary && !ids.includes(primary)) ids.unshift(primary);
  return ids;
}

async function listCampaigns() {
  if (isMock()) {
    return [
      {
        campaign_id: 'mock_c1',
        campaign_name: '直播计划A · GMV Max',
        status: 'ENABLE',
        campaign_type: 'GMV_MAX',
        budget: 100,
      },
      {
        campaign_id: 'mock_c2',
        campaign_name: '直播计划B · GMV Max',
        status: 'DISABLE',
        campaign_type: 'GMV_MAX',
        budget: 80,
      },
    ];
  }
  const tokens = await ensureToken();
  const advIds = authorizedAdvertiserIds(tokens);
  if (!advIds.length) throw new Error('请先选择/填写广告账户 advertiser_id');

  const advMap = campaignAdvertisers();
  const countryByAdv = new Map();
  const list = [];
  // 逐个授权账户拉取：单个账户失败不阻断其它国家
  for (const advId of advIds) {
    let raw;
    try {
      raw = await listLiveGmvCampaigns(advId);
    } catch (e) {
      log('warn', 'tiktok', `拉取直播计划失败 ${advId}: ${e.message}`);
      continue;
    }
    if (!raw.length) continue;
    if (!countryByAdv.has(advId)) countryByAdv.set(advId, await marketCountry(advId));
    const country = countryByAdv.get(advId);
    for (const c of raw) {
      const id = String(c.campaign_id || '');
      const owner = String(c.advertiser_id || advId);
      advMap[id] = owner;
      list.push({
        campaign_id: id,
        campaign_name: c.campaign_name || id,
        status: c.operation_status || '',
        campaign_type: 'LIVE_GMV_MAX',
        advertiser_id: owner,
        country,
      });
    }
  }
  saveCampaignAdvertisers(advMap);
  return list;
}

/**
 * 启停计划
 * action: 'enable' | 'disable'
 */
async function updateCampaignStatus(campaignId, action) {
  if (isMock()) {
    log('info', 'tiktok', `MOCK ${action} 计划 ${campaignId}`);
    // 更新 mock 列表内存不持久，仅打日志
    return { mock: true, campaign_id: campaignId, action };
  }
  const tokens = await ensureToken();
  const advMap = campaignAdvertisers();
  const advId =
    advMap[String(campaignId)] || tokens.advertiserId || config.tiktok.advertiserId;
  if (!advId) throw new Error('请先选择/填写广告账户 advertiser_id');
  // GMV Max 计划不能用 /campaign/update/（会报 GmvMax ads cannot be edited），开关走这个专用接口
  const operation_status = action === 'enable' ? 'ENABLE' : 'DISABLE';
  const res = await request('POST', `${config.tiktok.apiBase}/campaign/status/update/`, {
    advertiser_id: advId,
    campaign_ids: [String(campaignId)],
    operation_status,
  });
  const j = res.json || {};
  if (j.code !== 0) {
    const msg = j.message || j.message_cn || `启停失败 HTTP ${res.status}`;
    log('error', 'tiktok', msg, { campaignId, action });
    throw new Error(msg);
  }
  log('info', 'tiktok', `计划 ${campaignId} → ${operation_status}`);
  return j.data || { ok: true };
}

let callbackServer = null;
let callbackReady = null;

function extractTokenPayload(j) {
  if (!j || typeof j !== 'object') return {};
  const data = j.data && typeof j.data === 'object' ? j.data : {};
  const access =
    j.access_token || data.access_token || j.accessToken || data.accessToken || '';
  const refresh =
    j.refresh_token || data.refresh_token || j.refreshToken || data.refreshToken || '';
  const expires = j.expires_in || data.expires_in || j.expiresIn || data.expiresIn || 0;
  const code = j.code !== undefined ? j.code : data.code;
  const message = j.message || j.message_cn || data.message || '';
  return { access, refresh, expires, code, message, raw: j };
}

function handleCallback(req, res, serverRef) {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname !== '/callback') {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  const code = u.searchParams.get('code');
  const state = u.searchParams.get('state');
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('缺少 code');
    return;
  }
  exchangeCode(code)
    .then((r) => {
      const j = r.json || {};
      const rawText = typeof j.raw === 'string' ? j.raw : JSON.stringify(j);
      log('info', 'tiktok', `access_token 响应 HTTP ${r.status}`, {
        keys: Object.keys(j),
        hasAccess: !!(j.access_token || (j.data && j.data.access_token)),
        preview: String(rawText).slice(0, 500),
      });
      const p = extractTokenPayload(j);
      if (!p.access) {
        const err = new Error(
          p.message && p.message !== 'OK'
            ? p.message
            : `未解析到 access_token（HTTP ${r.status}）: ${String(rawText).slice(0, 300)}`
        );
        throw err;
      }
      const expiresAt = Date.now() + (Number(p.expires) || 86400) * 1000;
      const data = j.data && typeof j.data === 'object' ? j.data : {};
      const advIds = Array.isArray(data.advertiser_ids) ? data.advertiser_ids : [];
      const prev = getTokens();
      saveTokens({
        accessToken: p.access,
        refreshToken: p.refresh || prev.refreshToken || '',
        expiresAt,
        advertiserId: prev.advertiserId || advIds[0] || config.tiktok.advertiserId || '',
        advertiserIds: advIds,
      });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<h2 style="font-family:sans-serif">TikTok 授权成功</h2><p>可以关闭此页面，回到桌面端。</p>'
      );
      log('info', 'tiktok', 'OAuth 授权成功', {
        state,
        advertiserCount: advIds.length,
        defaultAdv: advIds[0] || '',
      });
    })
    .catch((err) => {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('授权失败: ' + err.message);
      log('error', 'tiktok', 'OAuth 失败: ' + err.message + (err.detail ? ' | ' + err.detail : ' '));
    });
}

function ensureCallbackServer() {
  if (callbackReady) return callbackReady;

  callbackReady = new Promise((resolve, reject) => {
    if (callbackServer) {
      resolve(callbackServer);
      return;
    }
    const server = http.createServer((req, res) => handleCallback(req, res, server));
    server.once('error', (err) => {
      callbackReady = null;
      if (err.code === 'EADDRINUSE') {
        // 端口已被占用（多半是本进程旧实例）——仍可返回授权链接
        resolve(null);
      } else {
        reject(err);
      }
    });
    server.listen(config.tiktok.callbackPort, config.tiktok.callbackHost || '0.0.0.0', () => {
      callbackServer = server;
      log('info', 'tiktok', `回调服务已监听 ${config.tiktok.callbackHost || '0.0.0.0'}:${config.tiktok.callbackPort} → ${config.tiktok.redirectUri}`);
      resolve(server);
    });
  });

  return callbackReady;
}

async function startOAuthCallbackServer() {
  if (!config.tiktok.clientKey) {
    throw new Error('缺少 TIKTOK_CLIENT_KEY，请检查 .env');
  }
  const server = await ensureCallbackServer();
  return {
    authorizeUrl: buildAuthorizeUrl(),
    portBusy: !server,
    callbackPort: config.tiktok.callbackPort,
  };
}

async function rawGet(url) {
  const res = await request('GET', url);
  const j = res.json || {};
  if (j.code !== 0) {
    const msg = j.message || j.message_cn || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.code = j.code;
    err.status = res.status;
    throw err;
  }
  return j.data || j;
}

module.exports = {
  getTokens,
  saveTokens,
  isMock,
  buildAuthorizeUrl,
  startOAuthCallbackServer,
  getAdvertisers,
  listCampaigns,
  updateCampaignStatus,
  ensureToken,
  rawGet,
};
