'use strict';
// 连接1：注入加载动画；连接2：直接截图；连接3：恢复数据
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

function connect() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9333/json', (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        const page = JSON.parse(d).find((p) => p.type === 'page' && p.url.includes('index.html'));
        const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
        ws.on('error', reject);
        ws.on('open', () => resolve(ws));
      });
    }).on('error', reject);
  });
}

function evaluate(ws, expression) {
  return new Promise((resolve) => {
    const handler = (m) => {
      const j = JSON.parse(String(m));
      if (j.id === 1) {
        ws.off('message', handler);
        resolve(j.result?.result?.value);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { returnByValue: true, expression } }));
  });
}

function shot(ws) {
  return new Promise((resolve, reject) => {
    const handler = (m) => {
      const j = JSON.parse(String(m));
      if (j.id === 1 && j.result && j.result.data) {
        ws.off('message', handler);
        resolve(j.result.data);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
    setTimeout(() => reject(new Error('shot timeout')), 15000);
  });
}

(async () => {
  const ws1 = await connect();
  // 切到看板会触发 loadDashboard，其加载态就是我们要截的真实状态
  const r = await evaluate(
    ws1,
    `(() => {
      document.querySelector('.nav-item[data-view="dashboard"]').click();
      setTimeout(() => document.getElementById('dashTableBody')?.scrollIntoView({ block: 'center' }), 200);
      return 'switched, view=' + (document.querySelector('.view.active')?.dataset.view || '');
    })()`
  );
  console.log('switch:', r);
  ws1.close();
  await new Promise((s) => setTimeout(s, 350));

  const ws2 = await connect();
  const data = await shot(ws2);
  const out = path.join(__dirname, '..', 'output', 'dash-loading.png');
  fs.writeFileSync(out, Buffer.from(data, 'base64'));
  console.log('saved', out);
  ws2.close();

  const ws3 = await connect();
  await evaluate(ws3, 'loadDashboard(), 1');
  console.log('data restored');
  ws3.close();
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
