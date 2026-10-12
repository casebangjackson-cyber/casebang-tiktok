'use strict';
const http = require('http');
const WebSocket = require('ws');

const EXPR = `JSON.stringify({
  start: document.getElementById('dashStartDate')?.value,
  end: document.getElementById('dashEndDate')?.value,
  spend: document.getElementById('kpiSpend')?.textContent,
  body: document.getElementById('dashTableBody')?.textContent.slice(0, 30)
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
