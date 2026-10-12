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
  const paths = [
    // GMV Max / shop ad candidates
    '/open_api/v1.3/gmv_max/campaign/get/?advertiser_id=' + adv,
    '/open_api/v1.3/shop_ads/campaign/get/?advertiser_id=' + adv,
    '/open_api/v1.3/promotion/get/?advertiser_id=' + adv,
    '/open_api/v1.3/market_seller/get/?advertiser_id=' + adv,
    '/open_api/v1.3/bc/asset/advertiser/authorization/list/',
    '/open_api/v1.3/advertiser/info/?advertiser_ids=["' + adv + '"]',
    '/open_api/v1.3/report/gmv_max/get/?advertiser_id=' + adv,
    '/open_api/v1.3/report/promotion/get/?advertiser_id=' + adv,
    '/open_api/v1.3/report/shop_ads/get/?advertiser_id=' + adv,
    '/open_api/v1.3/data/gmv_max/get/?advertiser_id=' + adv,
    '/open_api/v1.3/promotion_report/get/?advertiser_id=' + adv,
    '/open_api/v1.3/shop/promotion/get/?advertiser_id=' + adv,
    '/open_api/v1.3/seller_center/report/get/?advertiser_id=' + adv,
  ];
  for (const p of paths) {
    try {
      const r = await req('GET', p);
      let note = r.d.slice(0, 280);
      try {
        const j = JSON.parse(r.d);
        note = JSON.stringify({ code: j.code, message: (j.message || '').slice(0, 180) });
      } catch {}
      console.log(r.s, p.split('?')[0], note);
    } catch (e) {
      console.log('ERR', p.split('?')[0], e.message);
    }
  }
}

main().catch(console.error);
