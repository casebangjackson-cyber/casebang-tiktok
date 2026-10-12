'use strict';
// 验证：直播 GMV Max 列表 + 开关（对已暂停计划发 DISABLE，幂等不改变状态）
const tiktok = require('../lib/tiktok');

async function main() {
  const list = await tiktok.listCampaigns();
  console.log('count', list.length);
  for (const c of list) {
    console.log(`${c.campaign_id} ${c.status} ${c.campaign_type} ${c.campaign_name}`);
  }
  const off = list.find((c) => c.status === 'DISABLE');
  if (!off) {
    console.log('没有已暂停的计划，跳过开关验证');
    return;
  }
  const r = await tiktok.updateCampaignStatus(off.campaign_id, 'disable');
  console.log('toggle-noop', JSON.stringify(r));
  const again = await tiktok.listCampaigns();
  const after = again.find((c) => c.campaign_id === off.campaign_id);
  console.log('after', after && after.campaign_id, after && after.status);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
