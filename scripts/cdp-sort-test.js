'use strict';
// 点列头验证升降序：成本降序 → 点成本变升序 → 点订单切到订单降序
const http = require('http');
const WebSocket = require('ws');

const EXPR = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const col = (i) => [...document.querySelectorAll('#dashTableBody tr')]
    .map((tr) => tr.children[i]?.textContent?.trim() ?? '');
  const head = () => [...document.querySelectorAll('#dashTable th')]
    .map((th) => th.textContent.trim() + (th.classList.contains('active') ? '*' : ''));
  const out = {};
  await sleep(5000); // 等首屏数据
  out.title0 = document.getElementById('dashTableTitle')?.textContent;
  out.head0 = head();
  out.costDesc = col(1).slice(0, 5);

  document.querySelector('#dashTable th[data-sort="cost"]').click(); // 切升序
  await sleep(200);
  out.title1 = document.getElementById('dashTableTitle')?.textContent;
  out.costAsc = col(1).slice(0, 5);

  document.querySelector('#dashTable th[data-sort="orders"]').click(); // 订单降序
  await sleep(200);
  out.title2 = document.getElementById('dashTableTitle')?.textContent;
  out.ordersDesc = col(2).slice(0, 5);

  document.querySelector('#dashTable th[data-sort="roi"]').click(); // ROI 降序
  await sleep(200);
  out.title3 = document.getElementById('dashTableTitle')?.textContent;
  out.roiDesc = col(4).slice(0, 5);

  document.querySelector('#dashTable th[data-sort="name"]').click(); // 名称升序
  await sleep(200);
  out.title4 = document.getElementById('dashTableTitle')?.textContent;
  out.nameAsc = col(0).slice(0, 5);

  out.headEnd = head();
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
        if (j.result.exceptionDetails) console.log('EXC', JSON.stringify(j.result.exceptionDetails));
        console.log(JSON.stringify(j.result.result.value, null, 2));
        ws.close();
      }
    });
  });
});
