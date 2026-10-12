'use strict';

const { config } = require('./config');
const { log } = require('./logger');
const tiktok = require('./tiktok');

/** 三个广告户 + 对应 GMV Max 店铺 */
const ACCOUNTS = [
  {
    id: '7592491286763044881',
    name: '泰国',
    country: 'TH',
    storeId: '8647482557446587982',
    storeName: 'CASEBANG TH',
    gmvMax: true,
  },
  {
    id: '7592491009288994832',
    name: '越南',
    country: 'VN',
    storeId: '8647481446410651214',
    storeName: 'CASEBANG VN',
    gmvMax: false,
  },
  {
    id: '7592490087661993992',
    name: '新加坡',
    country: 'SG',
    storeId: '8647482683811333710',
    storeName: 'CASEBANG SG',
    gmvMax: false,
  },
];

const METRICS = ['cost', 'orders', 'roi', 'gross_revenue', 'campaign_name'];

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dateAdd(base, days) {
  const d = new Date(base + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return dateStr(d);
}

function isMock() {
  return tiktok.isMock();
}

function mockDashboard(start, end) {
  const daily = [];
  let day = start || dateAdd(dateStr(), -6);
  const last = end || dateStr();
  let guard = 0;
  while (day <= last && guard < 40) {
    guard++;
    const seed = Number(day.slice(-2)) * 13;
    const cost = 180 + (seed % 90);
    const orders = 40 + (seed % 40);
    daily.push({
      date: day,
      cost,
      orders,
      gross_revenue: cost * (5 + (seed % 4)),
      roi: Number((cost ? (cost * 6) / cost : 0).toFixed(2)),
    });
    day = dateAdd(day, 1);
  }
  return daily;
}

function mockCampaigns() {
  return [
    { campaign_id: 'm1', campaign_name: '达人p姐', cost: 2733.19, orders: 1362, gross_revenue: 29072.11, roi: 10.64 },
    { campaign_id: 'm2', campaign_name: '达人i.jeejii', cost: 908.79, orders: 360, gross_revenue: 7818.02, roi: 8.6 },
    { campaign_id: 'm3', campaign_name: '达人mmild29', cost: 165.03, orders: 68, gross_revenue: 1422.83, roi: 8.62 },
  ];
}

/**
 * GMV Max report (商家中心口径)
 * @param {{advertiserId,storeId,startDate,endDate,promotionType?:'LIVE'|'PRODUCT'|'ALL'}} opts
 */
async function fetchGmvReport({
  advertiserId,
  storeId,
  startDate,
  endDate,
  promotionType = 'ALL',
}) {
  const base = config.tiktok.apiBase;
  // report/get 默认只回第一页 10 条，不翻页会漏计划、合计偏低
  const list = [];
  for (let page = 1; page <= 20; page++) {
    let url =
      `${base}/gmv_max/report/get/` +
      `?advertiser_id=${encodeURIComponent(advertiserId)}` +
      `&store_ids=${encodeURIComponent(JSON.stringify([String(storeId)]))}` +
      `&start_date=${startDate}&end_date=${endDate}` +
      `&dimensions=${encodeURIComponent(JSON.stringify(['campaign_id']))}` +
      `&metrics=${encodeURIComponent(JSON.stringify(METRICS))}` +
      `&page=${page}&page_size=100`;
    if (promotionType && promotionType !== 'ALL') {
      // report 过滤值为 PRODUCT / LIVE（已验证）
      url += `&filtering=${encodeURIComponent(
        JSON.stringify({ gmv_max_promotion_types: [promotionType] })
      )}`;
    }
    const data = await tiktok.rawGet(url);
    const rows = (data && data.list) || [];
    list.push(...rows);
    const totalPage = (data && data.page_info && data.page_info.total_page) || 1;
    if (page >= totalPage || !rows.length) break;
  }
  return { list };
}

function parseCampaignRows(data) {
  const list = (data && data.list) || [];
  return list.map((row) => {
    const d = row.dimensions || {};
    const m = row.metrics || {};
    const cost = Number(m.cost || 0);
    const orders = Number(m.orders || 0);
    const revenue = Number(m.gross_revenue || 0);
    return {
      campaign_id: String(d.campaign_id || ''),
      campaign_name: m.campaign_name || d.campaign_id || '',
      cost: Number(cost.toFixed(2)),
      orders,
      gross_revenue: Number(revenue.toFixed(2)),
      roi: Number(m.roi || 0),
      aov: orders > 0 ? Number((revenue / orders).toFixed(2)) : 0,
    };
  });
}

async function dailyCostForAccount(account, startDate, endDate, promotionType) {
  const rows = [];
  let day = startDate;
  let guard = 0;
  while (day <= endDate && guard < 45) {
    guard++;
    try {
      const data = await fetchGmvReport({
        advertiserId: account.id,
        storeId: account.storeId,
        startDate: day,
        endDate: day,
        promotionType,
      });
      const camps = parseCampaignRows(data);
      const agg = camps.reduce(
        (a, c) => ({
          cost: a.cost + c.cost,
          orders: a.orders + c.orders,
          gross_revenue: a.gross_revenue + c.gross_revenue,
        }),
        { cost: 0, orders: 0, gross_revenue: 0 }
      );
      rows.push({
        date: day,
        cost: Number(agg.cost.toFixed(2)),
        orders: agg.orders,
        gross_revenue: Number(agg.gross_revenue.toFixed(2)),
        account: account.name,
        country: account.country,
      });
    } catch (e) {
      log('warn', 'reports', `GMV 日数据失败 ${day} ${account.name}: ${e.message}`);
      rows.push({
        date: day,
        cost: 0,
        orders: 0,
        gross_revenue: 0,
        account: account.name,
        country: account.country,
      });
    }
    day = dateAdd(day, 1);
  }
  return rows;
}

/**
 * @param {{startDate?:string,endDate?:string,accountId?:string,promotionType?:'LIVE'|'PRODUCT'|'ALL'}} range
 */
async function getCampaignReport({ startDate, endDate, accountId, promotionType = 'ALL' } = {}) {
  const end = endDate || dateStr();
  const start =
    startDate ||
    (() => {
      const d = new Date();
      d.setDate(d.getDate() - 6);
      return dateStr(d);
    })();

  const targets = accountId
    ? ACCOUNTS.filter((a) => a.id === String(accountId))
    : ACCOUNTS;

  if (isMock()) {
    const daily = mockDashboard(start, end);
    return {
      ok: true,
      mock: true,
      source: 'gmv_max_mock',
      startDate: start,
      endDate: end,
      accountId: targets[0]?.id || '',
      promotionType,
      daily,
      campaigns: mockCampaigns(),
      accounts: targets,
      accountName: targets[0]?.name || '',
      country: targets[0]?.country || '',
      note: 'MOCK 演示数据',
    };
  }

  try {
    await tiktok.ensureToken();

    const byDay = new Map();
    for (const acc of targets) {
      const rows = await dailyCostForAccount(acc, start, end, promotionType);
      for (const r of rows) {
        const cur = byDay.get(r.date) || {
          date: r.date,
          cost: 0,
          orders: 0,
          gross_revenue: 0,
        };
        cur.cost += r.cost;
        cur.orders += r.orders;
        cur.gross_revenue += r.gross_revenue;
        byDay.set(r.date, cur);
      }
    }
    const daily = Array.from(byDay.values())
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((d) => {
        const aov = d.orders > 0 ? d.gross_revenue / d.orders : 0;
        return {
          date: d.date,
          spend: Number(d.cost.toFixed(2)),
          cost: Number(d.cost.toFixed(2)),
          orders: d.orders,
          conversions: d.orders,
          gross_revenue: Number(d.gross_revenue.toFixed(2)),
          revenue: Number(d.gross_revenue.toFixed(2)),
          aov: Number(aov.toFixed(2)),
          roi: d.cost > 0 ? Number((d.gross_revenue / d.cost).toFixed(2)) : 0,
          impressions: 0,
          clicks: 0,
          ctr: 0,
        };
      });

    const campaigns = [];
    for (const acc of targets) {
      try {
        const data = await fetchGmvReport({
          advertiserId: acc.id,
          storeId: acc.storeId,
          startDate: start,
          endDate: end,
          promotionType,
        });
        const rows = parseCampaignRows(data).map((r) => ({
          ...r,
          account: acc.name,
          country: acc.country,
          storeName: acc.storeName,
          advertiserId: acc.id,
        }));
        campaigns.push(...rows);
      } catch (e) {
        log('warn', 'reports', `${acc.name} GMV 计划报表失败: ${e.message}`);
      }
    }

    const acc0 = targets[0] || {};
    if (!daily.some((d) => d.cost > 0) && !campaigns.some((c) => c.cost > 0)) {
      return {
        ok: true,
        // 接口真实返回、只是该时段无消耗：不是演示数据，别打 MOCK 徽标
        mock: false,
        source: 'gmv_max_empty',
        startDate: start,
        endDate: end,
        accountId: acc0.id || '',
        promotionType,
        daily,
        campaigns,
        accounts: targets,
        accountName: acc0.name || '',
        country: acc0.country || '',
        note: '该日期范围 GMV Max 无消耗，或店铺未开通 GMV Max',
      };
    }

    return {
      ok: true,
      mock: false,
      source: 'gmv_max',
      startDate: start,
      endDate: end,
      accountId: acc0.id || '',
      promotionType,
      daily,
      campaigns,
      accounts: targets,
      accountName: acc0.name || '',
      country: acc0.country || '',
      note: `GMV Max · ${
        promotionType === 'PRODUCT' ? '商品' : promotionType === 'LIVE' ? '直播' : '全部'
      } · ${targets.length > 1 ? targets.map((t) => t.name).join('/') : acc0.name || ''}`,
    };
  } catch (e) {
    log('error', 'reports', 'GMV Max 报表失败: ' + e.message);
    return {
      ok: false,
      mock: true,
      source: 'gmv_max_error',
      error: e.message,
      startDate: start,
      endDate: end,
      accountId: targets[0]?.id || '',
      promotionType,
      daily: mockDashboard(start, end),
      campaigns: mockCampaigns(),
      accounts: targets,
      accountName: targets[0]?.name || '',
      country: targets[0]?.country || '',
      note: '真实报表失败，已用 MOCK：' + e.message,
    };
  }
}

function summarize(daily = []) {
  const sum = daily.reduce(
    (acc, d) => {
      acc.cost += d.cost || d.spend || 0;
      acc.orders += d.orders || d.conversions || 0;
      acc.revenue += d.gross_revenue || d.revenue || 0;
      acc.spend = acc.cost;
      acc.impressions += d.impressions || 0;
      acc.clicks += d.clicks || 0;
      acc.conversions = acc.orders;
      return acc;
    },
    { cost: 0, spend: 0, orders: 0, revenue: 0, impressions: 0, clicks: 0, conversions: 0 }
  );
  const aov = sum.orders > 0 ? sum.revenue / sum.orders : 0;
  const roi = sum.cost > 0 ? sum.revenue / sum.cost : 0;
  const ctr = sum.impressions > 0 ? (sum.clicks / sum.impressions) * 100 : 0;
  return {
    spend: Number(sum.cost.toFixed(2)),
    cost: Number(sum.cost.toFixed(2)),
    orders: sum.orders,
    revenue: Number(sum.revenue.toFixed(2)),
    gross_revenue: Number(sum.revenue.toFixed(2)),
    conversions: sum.orders,
    aov: Number(aov.toFixed(2)),
    roi: Number(roi.toFixed(2)),
    impressions: sum.impressions,
    clicks: sum.clicks,
    ctr: Number(ctr.toFixed(2)),
    cpa: sum.orders > 0 ? Number((sum.cost / sum.orders).toFixed(2)) : 0,
    cpm: 0,
    cpc: 0,
  };
}

module.exports = {
  getCampaignReport,
  summarize,
  mockDashboard,
  dateStr,
  ACCOUNTS,
};
