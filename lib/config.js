'use strict';

const path = require('path');
const fs = require('fs');

// 支持在无 electron 的 web 模式下加载
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
  }
}

loadEnv();

const config = {
  tiktok: {
    clientKey: process.env.TIKTOK_CLIENT_KEY || '',
    clientSecret: process.env.TIKTOK_CLIENT_SECRET || '',
    redirectUri: process.env.TIKTOK_REDIRECT_URI || 'http://localhost:17890/callback',
    advertiserId: process.env.TIKTOK_ADVERTISER_ID || '',
    apiBase: 'https://business-api.tiktok.com/open_api/v1.3',
    authBase: 'https://business-api.tiktok.com/open_api/v1.3',
    callbackPort: 17890,
    // 同时兼容 localhost / 127.0.0.1 / ::1
    callbackHost: '0.0.0.0',
  },
  feishu: {
    appId: process.env.FEISHU_APP_ID || '',
    appSecret: process.env.FEISHU_APP_SECRET || '',
    allowedOpenIds: (process.env.FEISHU_ALLOWED_OPEN_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  mock: process.env.MOCK === '1' || process.env.MOCK === 'true',
};

module.exports = { config };
