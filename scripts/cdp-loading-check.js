'use strict';
// 触发看板刷新，轮询检查 tbody 是否渲染出 list-loading 动画
const http = require('http');
const WebSocket = require('ws');

const CHECK = `(() => {
  const tb = document.getElementById('dashTableBody');
  const load = tb ? tb.querySelector('.list-loading') : null;
  return JSON.stringify({
    fn: typeof window.listLoadingHtml,
    hasLoading: !!load,
    hasLambda: !!(tb && tb.querySelector('.load-lambda')),
    hasCaption: !!(tb && tb.querySelector('.load-caption')),
    rows: tb ? tb.querySelectorAll('tr').length : 0,
    cellClass: tb && tb.firstElementChild ? tb.firstElementChild.className : ''
  });
})()`;

http.get('http://127.0.0.1:9333/json', (res) => {
  let d = '';
  res.on('data', (c) => (d += c));
  res.on('end', () => {
    const page = JSON.parse(d).find((p) => p.type === 'page' && p.url.includes('index.html'));
    const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
    ws.on('open', () => {
      // 先确认函数存在
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { returnByValue: true, expression: CHECK } }));
    });
    let sawLoading = null;
    ws.on('message', (m) => {
      const j = JSON.parse(String(m));
      if (j.id === 1) {
        console.log('before:', j.result.result.value);
        // 触发刷新
        ws.send(JSON.stringify({ id: 2, method: 'Runtime.evaluate', params: { returnByValue: true, expression: 'loadDashboard(); 1' } }));
        // 密集轮询 5 秒
        let n = 0;
        const t = setInterval(() => {
          n++;
          ws.send(JSON.stringify({ id: 100 + n, method: 'Runtime.evaluate', params: { returnByValue: true, expression: CHECK } }));
          if (n >= 25) {
            clearInterval(t);
            setTimeout(() => {
              console.log('saw loading during refresh:', sawLoading);
              process.exit(sawLoading ? 0 : 2);
            }, 300);
          }
        }, 160);
      }
      if (j.id >= 100) {
        const v = j.result.result.value;
        if (v.includes('"hasLoading":true')) {
          if (!sawLoading) {
            sawLoading = v;
            console.log('during:', v);
          }
        }
      }
    });
    setTimeout(() => {
      console.log('timeout, saw:', sawLoading);
      process.exit(sawLoading ? 0 : 1);
    }, 12000);
  });
});
