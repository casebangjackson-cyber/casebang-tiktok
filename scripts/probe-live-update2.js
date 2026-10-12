'use strict';
// 只读/幂等探测：update 参数名、其它广告户的直播计划、page_info
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

function show(name, r, n = 700) {
  console.log('=== ' + name + ' HTTP ' + r.s);
  console.log(String(r.d).slice(0, n));
  console.log('');
}

async function main() {
  const adv = '7592491286763044881';
  const id = '1875378730048658'; // 达人 i.bumbimm，当前 DISABLE

  // 1) update 参数名探测：非法 action，不会改状态
  show(
    'update campaign_id singular + illegal action',
    await req('POST', '/open_api/v1.3/campaign/update/', {
      access_token: t.accessToken,
      advertiser_id: adv,
      campaign_id: id,
      action: 'PROBE_ILLEGAL_ACTION',
    })
  );

  // 2) 各广告户直播计划 + page_info
  for (const a of ['7592491286763044881', '7592491009288994832', '7592490087661993992']) {
    const r = await req(
      'GET',
      '/open_api/v1.3/gmv_max/campaign/get/?advertiser_id=' +
        a +
        '&filtering=' +
        encodeURIComponent(
          JSON.stringify({ page: 1, page_size: 50, gmv_max_promotion_types: ['LIVE_GMV_MAX'] })
        )
    );
    try {
      const j = JSON.parse(r.d);
      const list = (j.data && j.data.list) || [];
      console.log(
        '=== adv ' + a + ' code=' + j.code + ' n=' + list.length,
        JSON.stringify(j.data && j.data.page_info)
      );
      console.log(
        list
          .slice(0, 30)
          .map((c) => `${c.campaign_id} ${c.operation_status} ${c.campaign_name}`)
          .join('\n')
      );
      console.log('');
    } catch (e) {
      show('adv ' + a, r);
    }
  }
}

main().catch(console.error);
