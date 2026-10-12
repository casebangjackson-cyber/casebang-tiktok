'use strict';
// 通过 CDP 检查看板默认态：分流选中、日期、KPI、表格行数
const http = require('http');
const WebSocket = require('ws');

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(d));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  const pages = await getJson('http://127.0.0.1:9333/json');
  const page = pages.find((p) => p.type === 'page' && p.url.includes('index.html'));
  if (!page) throw new Error('no app page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    }
  });
  await new Promise((r) => ws.on('open', r));

  const expr = `(() => {
    const promo = document.querySelector('#promoChips .chip.active')?.dataset.promo || '';
    const country = document.querySelector('#countryChips .chip.active')?.dataset.country || '';
    const start = document.getElementById('dashStartDate')?.value || '';
    const end = document.getElementById('dashEndDate')?.value || '';
    const preset = document.querySelector('#rangePresets .preset.active')?.dataset.days ?? '';
    const title = document.getElementById('dashTitle')?.textContent || '';
    const label = document.getElementById('dashRangeLabel')?.textContent || '';
    const kpi = {
      spend: document.getElementById('kpiSpend')?.textContent || '',
      orders: document.getElementById('kpiOrders')?.textContent || '',
      roi: document.getElementById('kpiRoi')?.textContent || '',
    };
    const rows = document.querySelectorAll('#dashTableBody tr').length;
    const firstRow = document.querySelector('#dashTableBody tr')?.textContent?.trim().slice(0, 80) || '';
    const note = document.getElementById('dashNote')?.textContent || '';
    const mock = !document.getElementById('dashMockBadge')?.classList.contains('hidden');
    return JSON.stringify({ promo, country, start, end, preset, title, label, kpi, rows, firstRow, note, mock });
  })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.log(r.result.value);
  ws.close();
}

main().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
