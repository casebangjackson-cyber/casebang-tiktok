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

async function main() {
  const adv = '7592491286763044881';
  const thStore = '8647482557446587982';
  const storeArr = encodeURIComponent(JSON.stringify([thStore]));

  const urls = [
    `/open_api/v1.3/gmv_max/report/get/?advertiser_id=${adv}&store_ids=${storeArr}&start_date=2026-09-29&end_date=2026-09-29`,
    `/open_api/v1.3/gmv_max/report/get/?advertiser_id=${adv}&store_ids=${storeArr}&start_date=2026-09-23&end_date=2026-09-29`,
    `/open_api/v1.3/gmv_max/report/get/?advertiser_id=${adv}&store_ids=${storeArr}&start_date=2026-09-23&end_date=2026-09-29&dimensions=${encodeURIComponent('["stat_datetime"]')}`,
    `/open_api/v1.3/gmv_max/report/get/?advertiser_id=${adv}&store_ids=${storeArr}&start_date=2026-09-23&end_date=2026-09-29&dimensions=${encodeURIComponent('["campaign_id"]')}`,
    `/open_api/v1.3/gmv_max/report/get/?advertiser_id=${adv}&store_ids=${storeArr}&start_date=2026-09-29&end_date=2026-09-29&dimensions=${encodeURIComponent('["stat_time"]')}`,
  ];
  for (const u of urls) {
    const r = await req(u);
    let note = r.d.slice(0, 600);
    try {
      const j = JSON.parse(r.d);
      note = JSON.stringify({
        code: j.code,
        message: (j.message || '').slice(0, 160),
        listLen: j.data && j.data.list ? j.data.list.length : null,
        keys: j.data ? Object.keys(j.data) : null,
      });
      if (j.code === 0 && j.data) {
        note += '\n' + JSON.stringify(j.data).slice(0, 1500);
      }
    } catch {}
    console.log('---');
    console.log(u.slice(0, 140));
    console.log(note);
  }
}

main().catch(console.error);
