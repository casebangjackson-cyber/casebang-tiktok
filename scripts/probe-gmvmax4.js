'use strict';
const fs = require('fs');
const https = require('https');

const t = JSON.parse(
  fs.readFileSync('data/tiktok_tokens.json', 'utf8').replace(/^﻿/, '')
);

function req(method, path) {
  return new Promise((resolve, reject) => {
    const r = https.request(
      {
        hostname: 'business-api.tiktok.com',
        path,
        method,
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

  const stores = await req(
    'GET',
    '/open_api/v1.3/gmv_max/store/list/?advertiser_id=' + adv
  );
  console.log('STORES_FULL');
  console.log(stores.d);

  let storeIds = [];
  try {
    const j = JSON.parse(stores.d);
    const list = (j.data && j.data.store_list) || [];
    storeIds = list
      .map((s) => s.store_id || s.shop_id || s.id || s.store_ids)
      .filter(Boolean)
      .map(String);
    console.log('storeIds', storeIds);
    // also print store names for mapping
    console.log(
      'storeMeta',
      list.map((s) => ({
        id: s.store_id || s.shop_id || s.id,
        name: s.store_name || s.shop_name || s.name,
        gmv: s.is_gmv_max_available,
        bc: s.store_authorized_bc_info && s.store_authorized_bc_info.bc_name,
      }))
    );
  } catch (e) {
    console.log('parse stores err', e.message);
  }

  // campaign with both types
  const filtering = JSON.stringify({
    page: 1,
    page_size: 20,
    gmv_max_promotion_types: ['LIVE_GMV_MAX', 'PRODUCT_GMV_MAX'],
  });
  const camp = await req(
    'GET',
    '/open_api/v1.3/gmv_max/campaign/get/?advertiser_id=' +
      adv +
      '&filtering=' +
      encodeURIComponent(filtering)
  );
  console.log('CAMPAIGNS');
  console.log(camp.d.slice(0, 3000));

  // report with array store_ids
  if (storeIds.length) {
    const sid = encodeURIComponent(JSON.stringify(storeIds));
    const rep = await req(
      'GET',
      '/open_api/v1.3/gmv_max/report/get/?advertiser_id=' +
        adv +
        '&store_ids=' +
        sid +
        '&start_date=2026-09-29&end_date=2026-09-29'
    );
    console.log('REPORT');
    console.log(rep.d.slice(0, 4000));
  }
}

main().catch(console.error);
