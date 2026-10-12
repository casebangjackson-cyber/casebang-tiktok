'use strict';
// 抽出加载动画为共用函数 listLoadingHtml()，并让看板表格加载时也用它
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const appPath = path.join(ROOT, 'app.js');
let app = fs.readFileSync(appPath, 'utf8');

// 1) 定位原动画 HTML（从 box.innerHTML = ` 到 </div>`;）
const anchor = "async function loadCampaigns(selectIntoForm) {\r\n  const box = $('campList');\r\n";
const anchorLf = "async function loadCampaigns(selectIntoForm) {\n  const box = $('campList');\n";
const useCrlf = app.includes(anchor);
const head = useCrlf ? anchor : anchorLf;
const idx = app.indexOf(head);
if (idx < 0) {
  console.error('anchor not found');
  process.exit(1);
}
const afterHead = idx + head.length;
const tplStart = app.indexOf('box.innerHTML = `', afterHead);
if (tplStart < 0) {
  console.error('template start not found');
  process.exit(1);
}
const tplEnd = app.indexOf('`;', tplStart);
if (tplEnd < 0) {
  console.error('template end not found');
  process.exit(1);
}
const html = app.slice(tplStart + 'box.innerHTML = '.length, tplEnd + 2); // 含反引号

// 2) 生成共用函数
const nl = useCrlf ? '\r\n' : '\n';
const fn =
  `// 共用加载动画：CASE BANG logo 里的红色 A（Λ 字形），红色液面带波浪从底部漫满字形${nl}` +
  `function listLoadingHtml() {${nl}` +
  `  return ${html.replace(/^`/, '`').replace(/\n/g, nl)};${nl}` +
  `}${nl}` +
  `window.listLoadingHtml = listLoadingHtml;${nl}${nl}`;

// 3) 用函数调用替换原内联模板
app =
  app.slice(0, tplStart) +
  'box.innerHTML = listLoadingHtml()'.replace(/\n/g, nl) +
  app.slice(tplEnd + 2);

// 4) 在 loadCampaigns 前插入函数定义
app = app.slice(0, idx) + fn + app.slice(idx);

fs.writeFileSync(appPath, app);
console.log('app.js patched');

// 5) dash-ui.js：表格加载占位改用同一动画
const dashPath = path.join(ROOT, 'dash-ui.js');
let dash = fs.readFileSync(dashPath, 'utf8');
const before = dash;
dash = dash.replace(
  /if \(tbody\) tbody\.innerHTML = '<tr><td colspan="5" class="empty">加载中…<\/td><\/tr>';/g,
  "if (tbody) tbody.innerHTML = '<tr><td colspan=\"5\" class=\"loading-cell\">' + (window.listLoadingHtml ? window.listLoadingHtml() : '加载中…') + '</td></tr>';"
);
if (dash === before) {
  console.error('dash-ui replace failed');
  process.exit(1);
}
fs.writeFileSync(dashPath, dash);
console.log('dash-ui.js patched');

// 6) app.js 里旧版 loadDashboard 的占位也换掉（避免别处用到）
let app2 = fs.readFileSync(appPath, 'utf8');
app2 = app2.replace(
  /if \(tbody\) tbody\.innerHTML = '<tr><td colspan="6" class="empty">加载中…<\/td><\/tr>';/g,
  "if (tbody) tbody.innerHTML = '<tr><td colspan=\"6\" class=\"loading-cell\">' + (window.listLoadingHtml ? window.listLoadingHtml() : '加载中…') + '</td></tr>';"
);
fs.writeFileSync(appPath, app2);
console.log('app.js dash placeholder patched');
