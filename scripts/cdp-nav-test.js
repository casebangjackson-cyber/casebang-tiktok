'use strict';
const http = require('http');
const WebSocket = require('ws');

const EXPR = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const snap = () => JSON.stringify({
    promo: document.querySelector('#promoChips .chip.active')?.dataset.promo,
    start: document.getElementById('dashStartDate')?.value,
    end: document.getElementById('dashEndDate')?.value,
    preset: document.querySelector('#rangePresets .preset.active')?.dataset.days,
    spend: document.getElementById('kpiSpend')?.textContent
  });
  const out = {};
  out.before = await snap();
  // 用户手动改成 直播 + 近7天
  document.querySelector('#promoChips .chip[data-promo="LIVE"]').click();
  document.querySelector('#rangePresets .preset[data-days="7"]').click();
  await sleep(600);
  out.afterManual = await snap();
  // 切到日志页
  document.querySelector('.nav-item[data-view="logs"]').click();
  await sleep(400);
  // 再回看板
  document.querySelector('.nav-item[data-view="dashboard"]').click();
  await sleep(1500);
  out.afterReturn = await snap();
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
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { returnByValue: true, awaitPromise: true, expression: EXPR },
        })
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
