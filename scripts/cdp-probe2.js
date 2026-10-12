'use strict';
const http = require('http');
const WebSocket = require('ws');

const EXPR = `JSON.stringify({
  cells: document.querySelectorAll('#dashTableBody tr:first-child td').length,
  title: document.getElementById('dashTitle')?.textContent,
  spend: document.getElementById('kpiSpend')?.textContent,
  start: document.getElementById('dashStartDate')?.value,
  end: document.getElementById('dashEndDate')?.value
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
