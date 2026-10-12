'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

// ---- HTML ----
const htmlPath = path.join(root, 'index.html');
let h = fs.readFileSync(htmlPath, 'utf8');
const re = /<div class="range-inputs range-unified"[\s\S]*?<\/div>/;
if (!re.test(h)) {
  console.error('range-unified block not found');
  process.exit(1);
}
h = h.replace(
  re,
  `<div class="range-inputs range-unified" role="group" aria-label="日期范围">
                  <span class="range-icon" aria-hidden="true">📅</span>
                  <input type="date" id="dashStartDate" aria-label="开始日期" />
                  <span class="range-sep">—</span>
                  <input type="date" id="dashEndDate" aria-label="结束日期" />
                  <button type="button" id="btnCal" class="btn sm cal-trigger" title="打开日历">日历</button>
                </div>`
);
fs.writeFileSync(htmlPath, h);
console.log('html-ok', h.includes('range-icon'));

// ---- CSS ----
const cssPath = path.join(root, 'styles.css');
let c = fs.readFileSync(cssPath, 'utf8');
// strip previous range-unified blocks
c = c.replace(/\.range-unified\s*\{[\s\S]*?\n\}/g, '');
c += `
.range-unified {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  background: linear-gradient(180deg, #ffffff, #f8f9fb);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 8px 10px 8px 16px;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
  max-width: 100%;
  min-width: 300px;
}
.range-unified .range-icon {
  font-size: 15px;
  opacity: 0.8;
  user-select: none;
}
.range-unified input[type='date'] {
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 14px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  padding: 6px 4px;
  min-width: 0;
  width: auto;
}
.range-unified input[type='date']:focus {
  outline: none;
  box-shadow: none;
  background: rgba(255, 105, 0, 0.08);
  border-radius: 8px;
}
.range-unified input[type='date']::-webkit-calendar-picker-indicator {
  opacity: 0.55;
  cursor: pointer;
  margin: 0 2px;
}
.range-unified .range-sep {
  color: var(--muted);
  font-weight: 600;
  padding: 0 4px;
}
.range-unified .cal-trigger {
  margin-left: 4px;
  border: none;
  background: var(--accent);
  color: #fff;
  border-radius: 999px;
  font-weight: 650;
  padding: 8px 16px;
  font-size: 13px;
  box-shadow: 0 3px 10px rgba(255, 105, 0, 0.28);
}
.range-unified .cal-trigger:hover {
  filter: brightness(1.05);
  background: var(--accent);
}
`;
fs.writeFileSync(cssPath, c);
console.log('css-ok', c.includes('.range-unified .cal-trigger'));
