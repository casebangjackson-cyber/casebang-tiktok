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

async function query(adv, store, dims, metrics, start, end) {
  const u =
    `/open_api/v1.3/gmv_max/report/get/?advertiser_id=${adv}` +
    `&store_ids=${encodeURIComponent(JSON.stringify([store]))}` +
    `&start_date=${start}&end_date=${end}` +
    `&dimensions=${encodeURIComponent(JSON.stringify(dims))}` +
    `&metrics=${encodeURIComponent(JSON.stringify(metrics))}`;
  const r = await req(u);
  try {
    return { s: r.s, j: JSON.parse(r.d) };
  } catch {
    return { s: r.s, j: { raw: r.d } };
  }
}

async function main() {
  const adv = '7592491286763044881';
  const store = '8647482557446587982';
  const start = '2026-09-01';
  const end = '2026-09-29';

  // discover valid metrics one by one with campaign_id
  const candidates = [
    'cost',
    'gmv',
    'total_gmv',
    'revenue',
    'orders',
    'order_count',
    'sku_orders',
    'sku_order_count',
    'transactions',
    'average_order_value',
    'aov',
    'roi',
    'roas',
    'sku_order',
    'paid_orders',
    'gross_revenue',
    'total_revenue',
    'advertiser_id',
    'promotion_id',
    'campaign_name',
  ];
  const valid = [];
  for (const m of candidates) {
    const { j } = await query(adv, store, ['campaign_id'], [m], start, end);
    if (j.code === 0) {
      valid.push(m);
      console.log('VALID', m, JSON.stringify(j.data && j.data.list && j.data.list.slice(0, 3)));
    } else {
      console.log('invalid', m, (j.message || '').slice(0, 120));
    }
  }
  console.log('validMetrics', valid);

  // try combined with cost
  if (valid.includes('cost')) {
    const combo = valid.filter((m) => m !== 'campaign_name' && m !== 'advertiser_id' && m !== 'promotion_id');
    if (combo.length) {
      const { j } = await query(adv, store, ['campaign_id'], combo, start, end);
      console.log('combo', j.code, (j.message || '').slice(0, 200));
      if (j.code === 0) {
        console.log(JSON.stringify(j.data, null, 2).slice(0, 2500));
      }
    }
  }

  // try time-ish dims with cost only
  for (const dim of ['stat_datetime', 'date', 'datetime', 'hour', 'time', 'stat_time', 'promotion_id', 'adgroup_id']) {
    const { j } = await query(adv, store, [dim], ['cost'], start, end);
    console.log('dim', dim, j.code, (j.message || '').slice(0, 140));
    if (j.code === 0) {
      console.log('sample', JSON.stringify(j.data && j.data.list && j.data.list.slice(0, 3)));
    }
  }
}

main().catch(console.error);
