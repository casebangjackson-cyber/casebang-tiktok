'use strict';
// 点「昨天」快捷按钮，验证起止日期都为昨天，且看板只请求这一天
const http = require('http');
const WebSocket = require('ws');

const EXPR = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  // 拦截 dashboard 请求参数
  const orig = bridge.reports.dashboard.bind(bridge.reports);
  bridge.reports.dashboard = (range) => { out.lastReq = range; return orig(range); };

  document.querySelector('#rangePresets .preset[data-days="1"]').click();
  await sleep(4000);

  out.start = document.getElementById('dashStartDate')?.value;
  out.end = document.getElementById('dashEndDate')?.value;
  out.preset = document.querySelector('#rangePresets .preset.active')?.dataset.days;
  out.kpi = {
    spend: document.getElementById('kpiSpend')?.textContent,
    orders: document.getElementById('kpiOrders')?.textContent
  };
  bridge.reports.dashboard = orig;
  return out;
})()`;

http.get('http://127.0.0.1:9333/json', (res) => {
  let d = '';
  res.on('data', (c) => (d += c));
  res.on('end', () => {
    const page = JSON.parse(d).find((p) => p.type === 'page' && p.url.includes('index.html'));
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.on('open', () =>
      ws.send(
        JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { returnByValue: true, awaitPromise: true, expression: EXPR } })
      )
    );
    ws.on('message', (m) => {
      const j = JSON.parse(m);
      if (j.id === 1) {
        console.log(JSON.stringify(j.result.result.value, null, 2));
        ws.close();
      }
    });
  });
});
