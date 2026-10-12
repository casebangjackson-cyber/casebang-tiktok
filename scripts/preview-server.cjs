const http = require('http');
const fs = require('fs');
const path = require('path');
const root = 'C:/Users/Administrator/XiaomiMiMoProjects/2026-09-23/tiktok-gmvmax';
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };
http
  .createServer((q, r) => {
    let p = q.url.split('?')[0];
    if (p === '/') p = '/index.html';
    const f = path.join(root, p);
    fs.readFile(f, (e, d) => {
      if (e) {
        r.writeHead(404);
        return r.end('no');
      }
      r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'text/plain' });
      r.end(d);
    });
  })
  .listen(17891, '127.0.0.1', () => console.log('up 17891'));
