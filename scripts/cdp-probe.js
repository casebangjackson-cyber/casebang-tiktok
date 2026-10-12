'use strict';
const http = require('http');
const WebSocket = require('ws');

const EXPR = `JSON.stringify({
  hasLabelEl: !!document.getElementById('dashRangeLabel'),
  labelText: document.getElementById('dashRangeLabel')?.textContent ?? null,
  params: typeof dashRangeParams === 'function' ? dashRangeParams() : 'no fn',
  promo: typeof dashState !== 'undefined' ? dashState.promo : null,
  country: typeof dashState !== 'undefined' ? dashState.country : null,
  activePreset: document.querySelector('#rangePresets .preset.active')?.dataset.days ?? null
})`;

http.get('http://127.0.0.1:9333/json', (res) => {
  let d = '';
  res.on('data', (c) => (d += c));
  res.on('end', () => {
    const page = JSON.parse(d).find((p) => p.type === 'page' && p.url.includes('index.html'));
    if (!page) {
      console.log('no page');
      process.exit(1);
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { returnByValue: true, expression: EXPR } }));
    });
    ws.on('message', (m) => {
      const j = JSON.parse(m);
      if (j.id === 1) {
        console.log(j.result.result.value);
        ws.close();
      }
    });
  });
});
