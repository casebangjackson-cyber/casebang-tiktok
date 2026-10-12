'use strict';
const http = require('http');
const WebSocket = require('ws');

http.get('http://127.0.0.1:9333/json', (res) => {
  let d = '';
  res.on('data', (c) => (d += c));
  res.on('end', () => {
    const pages = JSON.parse(d).filter((p) => p.type === 'page');
    console.log('pages:', pages.map((p) => p.url).join(' | '));
    const page = pages.find((p) => p.url.includes('index.html'));
    if (!page) {
      console.log('no index page');
      process.exit(1);
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
    ws.on('error', (e) => console.log('ws error', e.message));
    ws.on('open', () => {
      console.log('ws open');
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { returnByValue: true, expression: '1+1' } }));
    });
    ws.on('message', (m) => {
      console.log('msg', String(m).slice(0, 200));
      ws.close();
    });
    setTimeout(() => {
      console.log('timeout');
      process.exit(1);
    }, 8000);
  });
});
