'use strict';
const http = require('http');
const WebSocket = require('ws');

const EXPR = `JSON.stringify({
  fn: loadDashboard.toString().slice(0, 150),
  hasRangeParams: typeof dashRangeParams,
  hasReset: typeof resetDashDefaults,
  dashUiBound: !!document.getElementById('promoChips')?.dataset.bound || document.querySelectorAll('#promoChips .chip').length
})`;

http.get('http://127.0.0.1:9333/json', (res) => {
  let d = '';
  res.on('data', (c) => (d += c));
  res.on('end', () => {
    const page = JSON.parse(d).find((p) => p.type === 'page' && p.url.includes('index.html'));
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.on('open', () =>
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { returnByValue: true, expression: EXPR } }))
    );
    ws.on('message', (m) => {
      const j = JSON.parse(m);
      if (j.id === 1) {
        console.log(j.result.result.value);
        ws.close();
      }
    });
  });
});
