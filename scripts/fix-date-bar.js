'use strict';
const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'index.html');
let h = fs.readFileSync(htmlPath, 'utf8');

// 1) remove Apply button
const before = h;
h = h.replace(/<button[^>]*id="btnApplyRange"[\s\S]*?<\/button>\s*/g, '');
if (h !== before) console.log('apply-removed');
else console.log('apply-not-found');

// 2) unify date inputs into one bar
const inputRe = /<div class="range-inputs">[\s\S]*?<\/button>\s*<\/div>/;
if (inputRe.test(h)) {
  h = h.replace(
    inputRe,
    `<div class="range-inputs range-unified">
                  <input type="date" id="dashStartDate" aria-label="开始日期" />
                  <span class="range-sep">至</span>
                  <input type="date" id="dashEndDate" aria-label="结束日期" />
                  <button type="button" id="btnCal" class="btn sm cal-trigger" title="打开日历">日历</button>
                </div>`
  );
  console.log('unified-ok');
} else {
  console.log('range-inputs not found');
}

fs.writeFileSync(htmlPath, h);
console.log('hasApply', h.includes('btnApplyRange'));
console.log('hasUnified', h.includes('range-unified'));
console.log('hasBtnCal', h.includes('btnCal'));
