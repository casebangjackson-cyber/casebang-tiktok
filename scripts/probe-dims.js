'use strict';
const fs = require('fs');
const https = require('https');

const t = JSON.parse(
  fs.readFileSync('data/tiktok_tokens.json', 'utf8').replace(/^﻿/, '')
);

function get(p) {
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
  const dims = ['stat_time', 'date', 'stat_datetime', 'stat_date', 'campaign_id', 'datetime'];
  for (const d of dims) {
    const u =
      '/open_api/v1.3/report/integrated/get/?advertiser_id=' +
      adv +
      '&start_date=2026-09-23&end_date=2026-09-25&report_type=BASIC&data_level=AUCTION_CAMPAIGN&dimensions=' +
      encodeURIComponent(JSON.stringify([d])) +
      '&metrics=' +
      encodeURIComponent(JSON.stringify(['spend']));
    const r = await get(u);
    let msg = r.d;
    try {
      const j = JSON.parse(r.d);
      msg = JSON.stringify({ code: j.code, message: j.message, n: (j.data && j.data.list && j.data.list.length) || 0 });
    } catch {}
    console.log(d, r.s, msg);
  }
}

main().catch(console.error);
