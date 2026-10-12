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

  // discover promotion types
  const typeLists = [
    ['ALL'],
    ['LIVE'],
    ['VIDEO'],
    ['PRODUCT'],
    ['SHOP'],
    ['GMV_MAX'],
    ['1', '2', '3'],
    ['LIVE_SHOPPING'],
    ['VIDEO_SHOPPING'],
  ];
  for (const types of typeLists) {
    const filtering = JSON.stringify({
      page: 1,
      page_size: 10,
      gmv_max_promotion_types: types,
    });
    const p =
      '/open_api/v1.3/gmv_max/campaign/get/?advertiser_id=' +
      adv +
      '&filtering=' +
      encodeURIComponent(filtering);
    const r = await req('GET', p);
    let msg = r.d;
    try {
      const j = JSON.parse(r.d);
      msg = JSON.stringify({
        code: j.code,
        message: (j.message || '').slice(0, 220),
        n: (j.data && j.data.list && j.data.list.length) || 0,
        total: j.data && j.data.page_info && j.data.page_info.total_number,
      });
    } catch {}
    console.log('types', JSON.stringify(types), r.s, msg);
    if (r.d.includes('"code":0')) {
      console.log('HIT', r.d.slice(0, 1200));
      break;
    }
  }

  // store_ids discovery
  const storePaths = [
    '/open_api/v1.3/advertiser/store/list/?advertiser_id=' + adv,
    '/open_api/v1.3/shop/list/?advertiser_id=' + adv,
    '/open_api/v1.3/store/list/?advertiser_id=' + adv,
    '/open_api/v1.3/bc/store/list/?advertiser_id=' + adv,
    '/open_api/v1.3/market/store/list/?advertiser_id=' + adv,
    '/open_api/v1.3/gmv_max/store/list/?advertiser_id=' + adv,
    '/open_api/v1.3/seller/store/list/?advertiser_id=' + adv,
    '/open_api/v1.3/shop/store/get/?advertiser_id=' + adv,
  ];
  for (const p of storePaths) {
    const r = await req('GET', p);
    console.log('store', p.split('?')[0], r.s, r.d.slice(0, 300));
  }

  // report with placeholder store
  const stores = ['0', 'all', adv];
  for (const sid of stores) {
    const p =
      '/open_api/v1.3/gmv_max/report/get/?advertiser_id=' +
      adv +
      '&store_ids=' +
      encodeURIComponent(sid) +
      '&start_date=2026-09-29&end_date=2026-09-29';
    const r = await req('GET', p);
    console.log('report store', sid, r.s, r.d.slice(0, 400));
  }
}

main().catch(console.error);
