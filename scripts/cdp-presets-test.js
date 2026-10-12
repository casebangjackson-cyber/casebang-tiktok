'use strict';
// 验证「今天」「近7天」两个快捷按钮仍正常
const http = require('http');
const WebSocket = require('ws');

const EXPR = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const snap = () => JSON.stringify({
    start: document.getElementById('dashStartDate')?.value,
    end: document.getElementById('dashEndDate')?.value,
    spend: document.getElementById('kpiSpend')?.textContent
  });
  const out = {};
  document.querySelector('#rangePresets .preset[data-days="0"]').click();
  await sleep(3500);
  out.today = await snap();
  document.querySelector('#rangePresets .preset[data-days="7"]').click();
  await sleep(4500);
  out.last7 = await snap();
  return out;
})()`;

http.get('http://127.0.0.1:9333/json', (res) => {
  let d = '';
  res.on('data', (c) => (d += c));
  res.on('end', () => {
    const page = JSON.parse(d).find((p) => p.type === 'page' && p.url.includes('index.html'));
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.on('open', () =>
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { returnByValue: true, awaitPromise: true, expression: EXPR } }))
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
