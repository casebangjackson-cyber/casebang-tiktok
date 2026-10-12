'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const tokenPath = path.join(ROOT, 'data', 'tiktok_tokens.json');

function loadTokens() {
  let raw = fs.readFileSync(tokenPath, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return JSON.parse(raw);
}

function saveTokens(t) {
  fs.writeFileSync(tokenPath, JSON.stringify(t, null, 2), 'utf8');
}

function get(t, urlPath) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'business-api.tiktok.com',
        path: urlPath,
        method: 'GET',
        headers: {
          'Access-Token': t.accessToken,
          'Content-Type': 'application/json',
        },
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

const ACCOUNTS = [
  { id: '7592491286763044881', name: '泰国', country: 'TH' },
  { id: '7592491009288994832', name: '越南', country: 'VN' },
  { id: '7592490087661993992', name: '新加坡', country: 'SG' },
];

async function main() {
  const t = loadTokens();
  if (!t.accessToken) {
    console.log('NO_TOKEN');
    process.exit(1);
  }
  t.advertiserIds = ACCOUNTS.map((a) => a.id);
  t.advertiserId = ACCOUNTS[0].id;
  t.accounts = ACCOUNTS;
  saveTokens(t);
  console.log('saved accounts', t.advertiserId, t.advertiserIds);

  for (const acc of ACCOUNTS) {
    try {
      const r = await get(
        t,
        `/open_api/v1.3/campaign/get/?advertiser_id=${acc.id}&page=1&page_size=5`
      );
      let j;
      try {
        j = JSON.parse(r.d);
      } catch (e) {
        console.log(acc.name, 'JSON_ERR', r.d.slice(0, 200));
        continue;
      }
      const list = (j.data && j.data.list) || [];
      const total = (j.data && j.data.page_info && j.data.page_info.total_number) || 0;
      console.log(
        acc.name,
        acc.id,
        'code',
        j.code,
        'total',
        total,
        'names',
        list.map((c) => c.campaign_name)
      );
    } catch (e) {
      console.log(acc.name, 'ERR', e.message);
    }
  }

  // integrated report probe on TH
  const adv = ACCOUNTS[0].id;
  const dims = encodeURIComponent('["campaign_id"]');
  const metrics = encodeURIComponent('["spend","impressions","clicks","ctr"]');
  const u =
    `/open_api/v1.3/report/integrated/get/?advertiser_id=${adv}` +
    `&start_date=2026-09-23&end_date=2026-09-29&report_type=BASIC&data_level=AUCTION` +
    `&dimensions=${dims}&metrics=${metrics}`;
  try {
    const r = await get(t, u);
    console.log('integrated BASIC', r.s, r.d.slice(0, 800));
  } catch (e) {
    console.log('integrated ERR', e.message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
