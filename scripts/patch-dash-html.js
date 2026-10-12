'use strict';
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'index.html');
let h = fs.readFileSync(file, 'utf8');

const startMarker = '<section class="view active" id="viewDashboard"';
const endMarker = '<!-- 模块 2：直播计划 -->';
const a = h.indexOf(startMarker);
const b = h.indexOf(endMarker);
if (a < 0 || b < 0 || b < a) {
  console.error('markers not found', { a, b });
  process.exit(1);
}

const neu = `<section class="view active" id="viewDashboard" data-view="dashboard">
            <div class="section-block">
              <div class="section-head">
                <div>
                  <h2 class="section-title" id="dashTitle">GMV Max · 泰国</h2>
                  <p class="section-sub" id="dashRangeLabel">直播 GMV Max · 成本 / 订单 / 收入 / ROI</p>
                </div>
                <div class="row gap date-bar">
                  <span id="dashMockBadge" class="badge warn hidden">MOCK 演示</span>
                  <button id="btnDashRefresh" class="btn primary" type="button">刷新数据</button>
                </div>
              </div>

              <div class="control-row">
                <div class="chip-row" id="countryChips">
                  <button type="button" class="chip active" data-country="TH">泰国</button>
                  <button type="button" class="chip" data-country="SG">新加坡</button>
                  <button type="button" class="chip" data-country="VN">越南</button>
                </div>
                <div class="chip-row" id="promoChips">
                  <button type="button" class="chip active" data-promo="LIVE">直播</button>
                  <button type="button" class="chip" data-promo="PRODUCT">商品</button>
                </div>
              </div>

              <div class="range-bar">
                <div class="range-presets" id="rangePresets">
                  <button type="button" class="preset" data-days="0">今天</button>
                  <button type="button" class="preset" data-days="1">昨天</button>
                  <button type="button" class="preset active" data-days="7">近 7 天</button>
                  <button type="button" class="preset" data-days="30">近 30 天</button>
                  <button type="button" class="preset" data-days="90">近 3 个月</button>
                </div>
                <div class="range-inputs">
                  <input type="date" id="dashStartDate" />
                  <span class="range-sep">—</span>
                  <input type="date" id="dashEndDate" />
                  <button type="button" id="btnApplyRange" class="btn sm">应用</button>
                  <button type="button" id="btnCal" class="btn sm ghost">日历</button>
                </div>
                <div class="range-calendar hidden" id="rangeCalendar">
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
                  <div class="cal-hint">先点开始日期，再点结束日期</div>
                </div>
              </div>

              <div id="dashNote" class="panel-note hidden"></div>

              <div class="kpi-row" id="kpiRow">
                <div class="kpi kpi-check"><span>成本 ⓘ</span><strong id="kpiSpend">—</strong></div>
                <div class="kpi kpi-check"><span>SKU 订单 ⓘ</span><strong id="kpiOrders">—</strong></div>
                <div class="kpi"><span>平均下单 ⓘ</span><strong id="kpiAov">—</strong></div>
                <div class="kpi"><span>总收入 ⓘ</span><strong id="kpiRevenue">—</strong></div>
                <div class="kpi"><span>ROI</span><strong id="kpiRoi">—</strong></div>
              </div>

              <div class="card nested-card chart-card">
                <div class="legend">
                  <span><i class="dot cost"></i> 成本</span>
                  <span><i class="dot orders"></i> SKU 订单数</span>
                </div>
                <div class="chart-wrap chart-dual">
                  <canvas id="chartDual" width="960" height="260"></canvas>
                </div>
              </div>

              <div class="card nested-card" style="margin-top:14px">
                <div class="card-h"><h3>计划表现（按成本降序）</h3></div>
                <div class="table-wrap">
                  <table class="data-table" id="dashTable">
                    <thead>
                      <tr>
                        <th>计划</th>
                        <th>成本</th>
                        <th>订单</th>
                        <th>总收入</th>
                        <th>ROI</th>
                      </tr>
                    </thead>
                    <tbody id="dashTableBody">
                      <tr><td colspan="5" class="empty">加载中…</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>

          `;

h = h.slice(0, a) + neu + h.slice(b);
fs.writeFileSync(file, h, 'utf8');
console.log('dashboard-html-ok', {
  country: h.includes('countryChips'),
  dual: h.includes('chartDual'),
  camp: h.includes('id="viewCampaign"'),
  dash: h.includes('id="viewDashboard"'),
});
