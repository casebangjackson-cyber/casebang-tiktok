'use strict';
// 切回数据看板，确保成本降序，然后截图
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PREP = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('.nav-item[data-view="dashboard"]').click();
  await sleep(6000);
  const title = document.getElementById('dashTableTitle');
  const th = document.querySelector('#dashTable th[data-sort="cost"]');
  let g = 0;
  while (title && !title.textContent.includes('成本降序') && g < 3) {
    th.click();
    g++;
  }
  return (title ? title.textContent : 'no') + ' | rows=' + document.querySelectorAll('#dashTableBody tr').length;
})()`;

http.get('http://127.0.0.1:9333/json', (res) => {
  let d = '';
  res.on('data', (c) => (d += c));
  res.on('end', () => {
    const page = JSON.parse(d).find((p) => p.type === 'page' && p.url.includes('index.html'));
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.on('open', () =>
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { returnByValue: true, awaitPromise: true, expression: PREP } }))
    );
    ws.on('message', (m) => {
      const j = JSON.parse(m);
      if (j.id === 1) {
        console.log(j.result.result.value);
        ws.send(JSON.stringify({ id: 2, method: 'Page.captureScreenshot', params: { format: 'png' } }));
      }
      if (j.id === 2) {
        const out = path.join(__dirname, '..', 'output', 'dash-sort.png');
        fs.writeFileSync(out, Buffer.from(j.result.data, 'base64'));
        console.log('saved', out);
        ws.close();
      }
    });
  });
});
