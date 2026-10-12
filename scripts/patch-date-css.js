'use strict';
const fs = require('fs');
const path = require('path');
const cssPath = path.join(__dirname, '..', 'styles.css');
let css = fs.readFileSync(cssPath, 'utf8');
if (css.includes('.range-unified')) {
  console.log('css-ok');
  process.exit(0);
}
css += `
.range-unified {
  display: inline-flex;
  align-items: center;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 4px 8px 4px 14px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
}
.range-unified input[type='date'] {
  border: none;
  background: transparent;
  color: var(--text);
  padding: 6px;
  font-size: 13px;
  font-weight: 600;
  min-width: 132px;
}
.range-unified input[type='date']:focus {
  outline: none;
  box-shadow: none;
}
.range-unified .range-sep {
  color: var(--muted);
  padding: 0 4px;
}
.range-unified .cal-trigger {
  margin-left: 4px;
  border: none;
  background: var(--accent-soft);
  color: var(--accent);
  border-radius: 999px;
  font-weight: 650;
  padding: 7px 14px;
}
.range-unified .cal-trigger:hover {
  background: var(--accent);
  color: #fff;
}
.preset {
  border: 1px solid var(--line);
  background: var(--panel2);
}
.preset.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  box-shadow: none;
}
`;
fs.writeFileSync(cssPath, css);
console.log('css-added');
