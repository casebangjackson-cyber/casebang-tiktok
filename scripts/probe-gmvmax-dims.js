'use strict';
const fs = require('fs');
const https = require('https');

const t = JSON.parse(
  fs.readFileSync('data/tiktok_tokens.json', 'utf8').replace(/^﻿/, '')
);

function req(path) {
  return new Promise((resolve, reject) => {
    const r = https.request(
      {
        hostname: 'business-api.tiktok.com',
        path,
        method: 'GET',
        headers: { 'Access-Token': t.accessToken, 'Content-Type': 'application/json' },
      },
      (x) => {
        let d = '';
        x.on('data', (c) => (d += c));
        x.on('end', () => resolve({ s: x.statusCode, d }));
      }
    );
    r.on('error', reject);
    r.end();
  });
}

async function tryDims(adv, store, dims, metrics, extra = '') {
  const u =
    `/open_api/v1.3/gmv_max/report/get/?advertiser_id=${adv}` +
    `&store_ids=${encodeURIComponent(JSON.stringify([store]))}` +
    `&start_date=2026-09-23&end_date=2026-09-29` +
    `&dimensions=${encodeURIComponent(JSON.stringify(dims))}` +
    `&metrics=${encodeURIComponent(JSON.stringify(metrics))}` +
    extra;
  const r = await req(u);
  let out;
  try {
    const j = JSON.parse(r.d);
    out = {
      code: j.code,
      message: (j.message || '').slice(0, 200),
      n: j.data && j.data.list ? j.data.list.length : null,
      sample: j.data && j.data.list ? j.data.list[0] : null,
      dataKeys: j.data ? Object.keys(j.data) : null,
    };
  } catch {
    out = r.d.slice(0, 300);
  }
  console.log(JSON.stringify({ dims, metrics, extra, s: r.s, out }, null, 2));
}

async function main() {
  const adv = '7592491286763044881';
  const store = '8647482557446587982';
  const metricSets = [
    ['spend'],
    ['cost'],
    ['total_cost'],
    ['spend', 'gmv'],
    ['cost', 'gmv'],
    ['cost', 'orders'],
    ['spend', 'sku_orders'],
    ['advertiser_id'],
  ];
  const dimSets = [
    ['campaign_id'],
    ['stat_datetime'],
    ['stat_time'],
    ['promotion_id'],
    ['store_id'],
    ['campaign_id', 'stat_datetime'],
  ];
  for (const dims of dimSets) {
    for (const metrics of metricSets.slice(0, 4)) {
      await tryDims(adv, store, dims, metrics);
    }
  }
}

main().catch(console.error);
