'use strict';
const fs = require('fs');
const path = require('path');
const cssPath = path.join(__dirname, '..', 'styles.css');
let css = fs.readFileSync(cssPath, 'utf8');
if (!css.includes('max-height: min(70vh')) {
  css += `
/* 日历不裁切 + 跨月灰色 */
.range-calendar {
  max-height: min(70vh, 540px);
  overflow: auto;
}
.cal-grid .day.out {
  color: #c0c6d0;
  cursor: default;
}
.cal-grid .day.out:hover {
  background: transparent;
}
.cal-body {
  align-items: start;
}
`;
  fs.writeFileSync(cssPath, css);
  console.log('css-patched');
} else {
  console.log('css-ok');
}
