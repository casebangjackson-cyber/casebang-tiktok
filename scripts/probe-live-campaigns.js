'use strict';
// 只读探测：找出能列出「直播 GMV Max」计划（含开关状态）的接口
const fs = require('fs');
const https = require('https');

const t = JSON.parse(fs.readFileSync('data/tiktok_tokens.json', 'utf8').replace(/^﻿/, ''));

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const r = https.request(
      {
        hostname: 'business-api.tiktok.com',
        path,
        method,
        headers: {
          'Access-Token': t.accessToken,
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (x) => {
        let d = '';
        x.on('data', (c) => (d += c));
        x.on('end', () => resolve({ s: x.statusCode, d }));
      }
    );
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function brief(d, n = 900) {
  try {
    const j = JSON.parse(d);
    return JSON.stringify(
      { code: j.code, message: (j.message || '').slice(0, 200), data: j.data },
      null,
      0
    ).slice(0, n);
  } catch {
    return String(d).slice(0, n);
  }
}

async function main() {
  const adv = '7592491286763044881'; // 泰国
  const store = '8647482557446587982';

  const tries = [
    [
      'gmv_max/campaign/get live',
      'GET',
      `/open_api/v1.3/gmv_max/campaign/get/?advertiser_id=${adv}&filtering=` +
        encodeURIComponent(
          JSON.stringify({ page: 1, page_size: 50, gmv_max_promotion_types: ['LIVE_GMV_MAX'] })
        ),
    ],
    [
      'gmv_max/campaign/get no-filter',
      'GET',
      `/open_api/v1.3/gmv_max/campaign/get/?advertiser_id=${adv}&page=1&page_size=50`,
    ],
    ['gmv_max/campaign/list', 'GET', `/open_api/v1.3/gmv_max/campaign/list/?advertiser_id=${adv}&page=1&page_size=50`],
    [
      'campaign/get filtering campaign_type',
      'GET',
      `/open_api/v1.3/campaign/get/?advertiser_id=${adv}&page=1&page_size=100&filtering=` +
        encodeURIComponent(JSON.stringify({ campaign_type: 'CAMPAIGN_TYPE_GMV_MAX' })),
    ],
    [
      'report campaign_id 7d',
      'GET',
      `/open_api/v1.3/gmv_max/report/get/?advertiser_id=${adv}&store_ids=` +
        encodeURIComponent(JSON.stringify([store])) +
        '&start_date=2026-09-17&end_date=2026-09-24&dimensions=' +
        encodeURIComponent(JSON.stringify(['campaign_id'])) +
        '&metrics=' +
        encodeURIComponent(JSON.stringify(['campaign_name', 'cost', 'orders'])),
    ],
    [
      'report promo type dim',
      'GET',
      `/open_api/v1.3/gmv_max/report/get/?advertiser_id=${adv}&store_ids=` +
        encodeURIComponent(JSON.stringify([store])) +
        '&start_date=2026-09-17&end_date=2026-09-24&dimensions=' +
        encodeURIComponent(JSON.stringify(['campaign_id', 'gmv_max_promotion_type'])) +
        '&metrics=' +
        encodeURIComponent(JSON.stringify(['campaign_name', 'cost'])),
    ],
  ];

  for (const [name, method, path] of tries) {
    try {
      const r = await req(method, path);
      console.log('=== ' + name + ' HTTP ' + r.s);
      console.log(brief(r.d, 1500));
    } catch (e) {
      console.log('=== ' + name + ' ERR ' + e.message);
    }
    console.log('');
  }
}

main().catch(console.error);
