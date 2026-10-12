'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const tokenPath = path.join(__dirname, '..', 'data', 'tiktok_tokens.json');
function loadTokens() {
  let raw = fs.readFileSync(tokenPath, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return JSON.parse(raw);
}
function get(t, urlPath) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'business-api.tiktok.com',
        path: urlPath,
        method: 'GET',
        headers: { 'Access-Token': t.accessToken, 'Content-Type': 'application/json' },
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve({ s: res.statusCode, d }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const t = loadTokens();
  const adv = '7592491286763044881';
  const dims = encodeURIComponent('["campaign_id"]');
  const metrics = encodeURIComponent('["spend","impressions","clicks","ctr"]');
  const u =
    `/open_api/v1.3/report/integrated/get/?advertiser_id=${adv}` +
    `&start_date=2026-09-23&end_date=2026-09-29&report_type=BASIC&data_level=AUCTION_CAMPAIGN` +
    `&dimensions=${dims}&metrics=${metrics}`;
  const r = await get(t, u);
  console.log('camp', r.s, r.d.slice(0, 1200));

  const dims2 = encodeURIComponent('["stat_datetime"]');
  const u2 =
    `/open_api/v1.3/report/integrated/get/?advertiser_id=${adv}` +
    `&start_date=2026-09-23&end_date=2026-09-29&report_type=BASIC&data_level=AUCTION_CAMPAIGN` +
    `&dimensions=${dims2}&metrics=${metrics}`;
  const r2 = await get(t, u2);
  console.log('daily', r2.s, r2.d.slice(0, 1200));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
