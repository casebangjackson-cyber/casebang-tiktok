'use strict';
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'index.html');
let h = fs.readFileSync(file, 'utf8');

// 1) stack country above promo
h = h.replace(
  `<div class="control-row">
                <div class="chip-row" id="countryChips">
                  <button type="button" class="chip active" data-country="TH">泰国</button>
                  <button type="button" class="chip" data-country="SG">新加坡</button>
                  <button type="button" class="chip" data-country="VN">越南</button>
                </div>
                <div class="chip-row" id="promoChips">
                  <button type="button" class="chip active" data-promo="LIVE">直播</button>
                  <button type="button" class="chip" data-promo="PRODUCT">商品</button>
                </div>
              </div>`,
  `<div class="control-stack">
                <div class="chip-label">国家</div>
                <div class="chip-row" id="countryChips">
                  <button type="button" class="chip active" data-country="TH">泰国</button>
                  <button type="button" class="chip" data-country="SG">新加坡</button>
                  <button type="button" class="chip" data-country="VN">越南</button>
                </div>
                <div class="chip-label">广告类型</div>
                <div class="chip-row" id="promoChips">
                  <button type="button" class="chip active" data-promo="LIVE">直播</button>
                  <button type="button" class="chip" data-promo="PRODUCT">商品</button>
                </div>
              </div>`
);

// 2) rebuild range bar: presets live INSIDE calendar panel (like reference)
const rangeRe = /<div class="range-bar">[\s\S]*?<\/div>\s*\n\s*<div id="dashNote"/;
const newRange = `<div class="range-bar">
                <div class="range-inputs">
                  <input type="date" id="dashStartDate" />
                  <span class="range-sep">—</span>
                  <input type="date" id="dashEndDate" />
                  <button type="button" id="btnCal" class="btn sm">选择日期</button>
                  <button type="button" id="btnApplyRange" class="btn sm ghost">应用</button>
                </div>
                <div class="range-calendar hidden" id="rangeCalendar">
                  <div class="range-calendar-inner">
                    <div class="range-presets" id="rangePresets">
                      <button type="button" class="preset" data-days="0">今天</button>
                      <button type="button" class="preset" data-days="1">昨天</button>
                      <button type="button" class="preset active" data-days="7">近 7 天</button>
                      <button type="button" class="preset" data-days="30">近 30 天</button>
                      <button type="button" class="preset" data-days="90">近 3 个月</button>
                      <button type="button" class="preset" data-days="180">近 6 个月</button>
                      <button type="button" class="preset" data-days="365">过去 12 个月</button>
                    </div>
                    <div class="range-calendar-main">
                      <div class="cal-head">
                        <button type="button" class="cal-nav" data-nav="py">«</button>
                        <button type="button" class="cal-nav" data-nav="pm">‹</button>
                        <span id="calLabelA">—</span>
                        <span class="cal-mid">至</span>
                        <span id="calLabelB">—</span>
                        <button type="button" class="cal-nav" data-nav="ny">›</button>
                        <button type="button" class="cal-nav" data-nav="nm">»</button>
                        <button type="button" class="cal-close" id="calClose">×</button>
                      </div>
                      <div class="cal-body">
                        <div class="cal-month" id="calMonthA"></div>
                        <div class="cal-month" id="calMonthB"></div>
                      </div>
                      <div class="cal-hint">先点开始日期，再点结束日期；或点左侧快捷范围</div>
                    </div>
                  </div>
                </div>
              </div>

              <div id="dashNote"`;

if (!rangeRe.test(h)) {
  console.error('range-bar block not found');
  process.exit(1);
}
h = h.replace(rangeRe, newRange);

fs.writeFileSync(file, h);
console.log('html-updated', {
  stack: h.includes('control-stack'),
  presetsInCal: h.includes('range-calendar-inner') && h.includes('rangePresets'),
  noSidePromo: !h.includes('chip-row" id="countryChips">\n                  <button') || h.includes('control-stack'),
});
