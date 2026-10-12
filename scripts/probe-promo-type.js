'use strict';
const fs = require('fs');
const https = require('https');
const t = JSON.parse(fs.readFileSync('data/tiktok_tokens.json', 'utf8').replace(/^﻿/, ''));

function req(p) {
  return new Promise((res, rej) => {
    const r = https.request(
      {
        hostname: 'business-api.tiktok.com',
        path: p,
        method: 'GET',
        headers: { 'Access-Token': t.accessToken, 'Content-Type': 'application/json' },
      },
      (x) => {
        let d = '';
        x.on('data', (c) => (d += c));
        x.on('end', () => res({ s: x.statusCode, d }));
      }
    );
    r.on('error', rej);
    r.end();
  });
}

async function main() {
  const adv = '7592491286763044881';
  const store = '8647482557446587982';
  const base =
    '/open_api/v1.3/gmv_max/report/get/?advertiser_id=' +
    adv +
    '&store_ids=' +
    encodeURIComponent(JSON.stringify([store])) +
    '&start_date=2026-09-01&end_date=2026-09-07&metrics=' +
    encodeURIComponent(JSON.stringify(['cost', 'orders']));
  const tests = [
    base + '&dimensions=' + encodeURIComponent(JSON.stringify(['campaign_id'])) + '&gmv_max_promotion_type=LIVE_GMV_MAX',
    base + '&dimensions=' + encodeURIComponent(JSON.stringify(['campaign_id'])) + '&promotion_type=LIVE_GMV_MAX',
    base + '&dimensions=' + encodeURIComponent(JSON.stringify(['campaign_id'])) + '&filtering=' + encodeURIComponent(JSON.stringify({ gmv_max_promotion_types: ['LIVE_GMV_MAX'] })),
    base + '&dimensions=' + encodeURIComponent(JSON.stringify(['campaign_id', 'gmv_max_promotion_type'])),
    base + '&dimensions=' + encodeURIComponent(JSON.stringify(['promotion_type', 'campaign_id'])),
    base + '&dimensions=' + encodeURIComponent(JSON.stringify(['campaign_id'])) + '&promotion_types=' + encodeURIComponent(JSON.stringify(['LIVE_GMV_MAX'])),
  ];
  for (const u of tests) {
    const r = await req(u);
    let m = r.d;
    try {
      const j = JSON.parse(r.d);
      m = JSON.stringify({ code: j.code, message: (j.message || '').slice(0, 180), n: j.data && j.data.list && j.data.list.length });
    } catch {}
    console.log(m);
  }
}
main().catch(console.error);
