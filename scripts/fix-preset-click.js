'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

// --- CSS append ---
const cssPath = path.join(root, 'styles.css');
let css = fs.readFileSync(cssPath, 'utf8');
if (!css.includes('.control-stack')) {
  css += `
/* stacked country/promo */
.control-stack {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: 12px;
}
.chip-label {
  font-size: 12px;
  color: var(--muted);
  font-weight: 600;
  margin-top: 4px;
}

/* calendar with left presets like reference */
.range-calendar {
  min-width: 640px;
  max-width: calc(100vw - 40px);
}
.range-calendar-inner {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.range-presets {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: transparent;
  border: none;
  padding: 0;
  min-width: 100px;
}
.preset {
  width: 100%;
  text-align: left;
  border: 1px solid var(--line);
  background: var(--panel2);
  color: var(--text);
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  pointer-events: auto !important;
}
.preset:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.preset.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.range-calendar-main {
  flex: 1;
  min-width: 380px;
}
`;
  fs.writeFileSync(cssPath, css);
  console.log('css-added');
} else {
  console.log('css-ok');
}

// --- dash-ui: make presets always clickable via delegation ---
const dashPath = path.join(root, 'dash-ui.js');
let dash = fs.readFileSync(dashPath, 'utf8');
if (!dash.includes('/* preset-delegate */')) {
  // remove fragile forEach if present
  dash = dash.replace(
    /document\.querySelectorAll\('#rangePresets \.preset'\)\.forEach\([\s\S]*?\}\);\s*/,
    ''
  );
  dash += `
/* preset-delegate */
(function bindPresets() {
  const rp = document.getElementById('rangePresets');
  if (!rp || rp.dataset.bound) return;
  rp.dataset.bound = '1';
  rp.addEventListener('click', (e) => {
    const btn = e.target.closest('.preset');
    if (!btn) return;
    applyPresetDays(btn.dataset.days);
    const cal = $('rangeCalendar');
    if (cal) {
      cal.classList.remove('hidden');
      renderCal();
    }
    if (typeof guard === 'function') guard('刷新看板', loadDashboard);
    else loadDashboard();
  });
})();
`;
  fs.writeFileSync(dashPath, dash);
  console.log('dash-ui-bound');
} else {
  console.log('dash-ui-ok');
}

console.log('patch-done');
