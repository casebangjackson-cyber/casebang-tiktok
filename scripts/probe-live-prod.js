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
        x.on('end', () => res(d));
      }
    );
    r.on('error', rej);
    r.end();
  });
}

async function main() {
  const adv = '7592491286763044881';
  const store = '8647482557446587982';
  const metrics = encodeURIComponent(JSON.stringify(['cost', 'orders', 'roi', 'gross_revenue', 'campaign_name']));
  const dims = encodeURIComponent(JSON.stringify(['campaign_id']));
  for (const types of [['PRODUCT'], ['LIVE'], ['PRODUCT', 'LIVE'], []]) {
    const filtering = encodeURIComponent(JSON.stringify({ gmv_max_promotion_types: types }));
    const u =
      `/open_api/v1.3/gmv_max/report/get/?advertiser_id=${adv}` +
      `&store_ids=${encodeURIComponent(JSON.stringify([store]))}` +
      `&start_date=2026-09-01&end_date=2026-09-07` +
      `&dimensions=${dims}&metrics=${metrics}` +
      (types.length ? `&filtering=${filtering}` : '');
    const d = await req(u);
    try {
      const j = JSON.parse(d);
      if (j.code !== 0) {
        console.log(JSON.stringify(types), j.code, j.message);
      } else {
        const list = j.data.list || [];
        const cost = list.reduce((a, c) => a + Number(c.metrics.cost || 0), 0);
        console.log(JSON.stringify(types), 'OK n=' + list.length, 'cost=' + cost.toFixed(2));
      }
    } catch (e) {
      console.log(JSON.stringify(types), 'parse err', d.slice(0, 200));
    }
  }
}
main().catch(console.error);
