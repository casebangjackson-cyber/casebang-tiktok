'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

// 1) dash-ui.js at project root
const libDash = path.join(root, 'lib', 'dash-ui.js');
const rootDash = path.join(root, 'dash-ui.js');
if (fs.existsSync(libDash)) {
  fs.copyFileSync(libDash, rootDash);
  fs.unlinkSync(libDash);
}

// 2) inject script tag
const htmlPath = path.join(root, 'index.html');
let h = fs.readFileSync(htmlPath, 'utf8');
if (!h.includes('dash-ui.js')) {
  h = h.replace(
    '<script src="app.js"></script>',
    '<script src="dash-ui.js"></script>\n    <script src="app.js"></script>'
  );
  fs.writeFileSync(htmlPath, h);
}

// 3) avoid duplicate initDashDates in app.js
const appPath = path.join(root, 'app.js');
let a = fs.readFileSync(appPath, 'utf8');
if (a.includes('function initDashDates')) {
  a = a.replace('function initDashDates(', 'function _appInitDashDates(');
  a = a.replace(/\n  initDashDates\(\);/, '\n  (window.initDashDates || _appInitDashDates)();');
  fs.writeFileSync(appPath, a);
}

// 4) CSS
const cssPath = path.join(root, 'styles.css');
let css = fs.readFileSync(cssPath, 'utf8');
if (!css.includes('range-calendar')) {
  css += `
.control-row { display:flex; flex-wrap:wrap; gap:10px 16px; align-items:center; margin-bottom:12px; }
.chip-row { display:inline-flex; gap:8px; flex-wrap:wrap; }
.chip { appearance:none; border:1px solid var(--line); background:var(--panel); color:var(--muted); border-radius:999px; padding:7px 16px; font-size:13px; font-weight:650; cursor:pointer; }
.chip.active { background:var(--accent); border-color:var(--accent); color:#fff; box-shadow:0 3px 10px rgba(255,105,0,.25); }
.range-bar { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:12px; position:relative; }
.range-presets { display:inline-flex; gap:6px; flex-wrap:wrap; background:var(--panel2); border:1px solid var(--line); border-radius:10px; padding:4px; }
.preset { appearance:none; border:none; background:transparent; color:var(--muted); border-radius:8px; padding:6px 12px; font-size:12px; font-weight:600; cursor:pointer; }
.preset.active { background:#fff; color:var(--text); box-shadow:0 1px 4px rgba(0,0,0,.06); }
.range-inputs { display:inline-flex; align-items:center; gap:6px; flex-wrap:wrap; }
.range-inputs input[type=date] { border:1px solid var(--line); background:var(--panel); color:var(--text); border-radius:8px; padding:6px 8px; font-size:13px; }
.range-sep { color:var(--muted); }
.range-calendar { position:absolute; top:calc(100% + 6px); left:0; z-index:40; background:var(--panel); border:1px solid var(--line); border-radius:14px; box-shadow:0 12px 40px rgba(0,0,0,.12); padding:12px; min-width:520px; max-width:100%; }
.range-calendar.hidden { display:none; }
.cal-head { display:flex; align-items:center; gap:6px; margin-bottom:8px; font-size:13px; font-weight:650; flex-wrap:wrap; }
.cal-nav,.cal-close { appearance:none; border:1px solid var(--line); background:var(--panel2); border-radius:8px; width:28px; height:28px; cursor:pointer; color:var(--text); }
.cal-close { margin-left:auto; }
.cal-mid { color:var(--muted); font-weight:400; margin:0 4px; }
.cal-body { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.cal-title { text-align:center; font-size:13px; font-weight:650; margin-bottom:6px; }
.cal-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:2px; text-align:center; font-size:12px; }
.cal-grid.head { color:var(--muted); margin-bottom:4px; }
.cal-grid .empty { height:28px; }
.cal-grid .day { height:28px; line-height:28px; border-radius:6px; cursor:pointer; }
.cal-grid .day:hover { background:var(--accent-soft); }
.cal-grid .day.edge { background:var(--accent); color:#fff; }
.cal-grid .day.in { background:rgba(255,105,0,.15); }
.cal-hint { margin-top:8px; font-size:12px; color:var(--muted); text-align:center; }
.legend { display:flex; gap:16px; font-size:12px; color:var(--muted); align-items:center; }
.legend .dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; vertical-align:middle; }
.dot.cost { background:#00b5b8; }
.dot.orders { background:#ffb020; }
.chart-card .card-h { margin-bottom:4px; }
`;
  fs.writeFileSync(cssPath, css);
}

console.log('setup-done', {
  dashUi: fs.existsSync(rootDash),
  script: fs.readFileSync(htmlPath, 'utf8').includes('dash-ui.js'),
  css: fs.readFileSync(cssPath, 'utf8').includes('range-calendar'),
});
