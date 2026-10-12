'use strict';
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { config } = require('../lib/config');
const tiktok = require('../lib/tiktok');

function request(method, urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data.slice(0, 500) }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('mock?', tiktok.isMock());
  let tokens;
  try {
    tokens = await tiktok.ensureToken();
  } catch (e) {
    console.log('TOKEN_ERR', e.message);
    return;
  }
  if (!tokens.accessToken) {
    console.log('NO_ACCESS_TOKEN - 请先完成授权');
    return;
  }
  const adv = tokens.advertiserId || config.tiktok.advertiserId;
  const base = config.tiktok.apiBase;
  const at = tokens.accessToken;
  const dateQs =
    'start_date=2026-09-23&end_date=2026-09-24&data_level=AUCTION';
  const paths = [
    `${base}/report/campaign/get/?access_token=${at}&advertiser_id=${adv}&${dateQs}&dimensions=["campaign_id"]&metrics=["spend","impressions","clicks","ctr","cpm","cpc"]`,
    `${base}/report/integrated/get/?access_token=${at}&advertiser_id=${adv}&${dateQs}&dimensions=["campaign_id"]&metrics=["spend","impressions","clicks"]`,
    `${base}/ad/get/?access_token=${at}&advertiser_id=${adv}&page=1&page_size=3`,
    `${base}/campaign/get/?access_token=${at}&advertiser_id=${adv}&page=1&page_size=3`,
  ];
  for (const url of paths) {
    try {
      const r = await request('GET', url);
      let note = r.body;
      try {
        const j = JSON.parse(r.body);
        note = JSON.stringify({
          code: j.code,
          message: j.message || j.message_cn,
          listLen: j.data && j.data.list ? j.data.list.length : null,
        });
      } catch {}
      console.log(r.status, new URL(url).pathname, note);
    } catch (e) {
      console.log('ERR', e.message);
    }
  }
}

main().catch(console.error);
