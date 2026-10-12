'use strict';
const fs = require('fs');
const https = require('https');

const t = JSON.parse(
  fs.readFileSync('data/tiktok_tokens.json', 'utf8').replace(/^﻿/, '')
);

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

async function main() {
  const adv = '7592491286763044881';

  // campaign get with filtering
  const filters = [
    '{"page":1,"page_size":10}',
    '{"ids":[]}',
    '{"status":"ENABLE"}',
    '{"advertiser_ids":["' + adv + '"]}',
  ];
  for (const f of filters) {
    const p =
      '/open_api/v1.3/gmv_max/campaign/get/?advertiser_id=' +
      adv +
      '&filtering=' +
      encodeURIComponent(f);
    const r = await req('GET', p);
    console.log('campaign', f, r.s, r.d.slice(0, 500));
  }

  // POST variants
  const posts = [
    ['/open_api/v1.3/gmv_max/campaign/get/?advertiser_id=' + adv, { filtering: { page: 1, page_size: 10 } }],
    ['/open_api/v1.3/gmv_max/campaign/list/?advertiser_id=' + adv, { page: 1, page_size: 10 }],
    ['/open_api/v1.3/gmv_max/report/get/?advertiser_id=' + adv, { start_date: '2026-09-29', end_date: '2026-09-29' }],
    ['/open_api/v1.3/gmv_max/metrics/get/?advertiser_id=' + adv, { start_date: '2026-09-29', end_date: '2026-09-29' }],
    ['/open_api/v1.3/gmv_max/report/integrated/get/?advertiser_id=' + adv, { start_date: '2026-09-29', end_date: '2026-09-29', report_type: 'BASIC' }],
  ];
  for (const [p, body] of posts) {
    const r = await req('POST', p, body);
    console.log('POST', p.split('?')[0], r.s, r.d.slice(0, 500));
  }

  // GET report candidates
  const gets = [
    '/open_api/v1.3/gmv_max/report/get/?advertiser_id=' + adv + '&start_date=2026-09-29&end_date=2026-09-29',
    '/open_api/v1.3/gmv_max/data/get/?advertiser_id=' + adv,
    '/open_api/v1.3/gmv_max/overview/get/?advertiser_id=' + adv,
    '/open_api/v1.3/gmv_max/performance/get/?advertiser_id=' + adv,
    '/open_api/v1.3/gmv_max/insight/get/?advertiser_id=' + adv,
    '/open_api/v1.3/gmv_max/ad/list/?advertiser_id=' + adv,
    '/open_api/v1.3/gmv_max/promotion/get/?advertiser_id=' + adv,
  ];
  for (const p of gets) {
    const r = await req('GET', p);
    console.log('GET', p.split('?')[0], r.s, r.d.slice(0, 400));
  }
}

main().catch(console.error);
