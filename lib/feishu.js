'use strict';

const { config } = require('./config');
const { log } = require('./logger');
const tiktok = require('./tiktok');
const scheduler = require('./scheduler');
const llm = require('./llm');
const { readJson, writeJson } = require('./store');

const STATE_FILE = 'app_state.json';

function loadState() {
  return readJson(STATE_FILE, { feishuConnected: false, lastFeishuError: '' });
}

function saveState(partial) {
  const next = { ...loadState(), ...partial };
  writeJson(STATE_FILE, next);
  return next;
}

let wsClient = null;
let running = false;

function isAllowed(openId) {
  const allow = config.feishu.allowedOpenIds;
  if (!allow.length) return true; // 开发模式：先不限制
  return allow.includes(openId);
}

function extractText(message) {
  try {
    if (message?.message_type === 'text') {
      const content = JSON.parse(message.content || '{}');
      return String(content.text || '').trim();
    }
    if (message?.message_type === 'post') {
      const content = JSON.parse(message.content || '{}');
      const title = content.title || '';
      const lines = [];
      if (content.content) {
        for (const row of content.content) {
          for (const cell of row || []) {
            if (cell?.tag === 'text') lines.push(cell.text);
          }
        }
      }
      return (title + ' ' + lines.join(' ')).trim();
    }
  } catch {
    /* ignore */
  }
  return '';
}

function extractImageKey(message) {
  try {
    if (message?.message_type === 'image') {
      const content = JSON.parse(message.content || '{}');
      return content.image_key || '';
    }
  } catch {
    /* ignore */
  }
  return '';
}

async function downloadImageBase64(messageId, imageKey) {
  const client = global.__larkClient;
  if (!client) throw new Error('飞书客户端未就绪');
  const res = await client.im.messageResource.get({
    path: { message_id: messageId, file_key: imageKey },
    params: { type: 'image' },
  });
  // SDK may return Buffer, ArrayBuffer, or {data}
  let buf = res;
  if (res && res.data && !Buffer.isBuffer(res.data)) buf = res.data;
  if (buf instanceof ArrayBuffer) buf = Buffer.from(buf);
  if (buf && buf.type === 'Buffer' && Array.isArray(buf.data)) buf = Buffer.from(buf.data);
  if (!Buffer.isBuffer(buf)) {
    // some versions return ReadableStream-like or Uint8Array
    if (buf instanceof Uint8Array) buf = Buffer.from(buf);
    else if (buf && typeof buf.getBuffer === 'function') buf = buf.getBuffer();
  }
  if (!Buffer.isBuffer(buf)) throw new Error('无法读取图片二进制');
  return buf.toString('base64');
}

async function replyText(messageId, text) {
  if (!global.__larkClient) return;
  try {
    await global.__larkClient.im.message.reply({
      path: { message_id: messageId },
      data: {
        content: JSON.stringify({ text }),
        msg_type: 'text',
      },
    });
  } catch (err) {
    log('error', 'feishu', '回复失败: ' + err.message);
  }
}

function dayLabel(days) {
  const arr = Array.isArray(days) ? days : [0, 1, 2, 3, 4, 5, 6];
  if (arr.length === 7) return '每天';
  const names = ['日', '一', '二', '三', '四', '五', '六'];
  if (arr.join(',') === '1,2,3,4,5') return '工作日';
  if (arr.join(',') === '0,6') return '周末';
  return arr.map((d) => `周${names[d]}`).join('/') || '每天';
}

function formatSchedule(s) {
  const act = s.action === 'enable' ? '开启' : '暂停';
  return `• [${s.enabled ? '开' : '关'}] ${s.time} ${act} · ${s.campaignName || s.campaignId} · ${dayLabel(s.days)} · ${s.id}`;
}

async function findCampaign(keyword) {
  const campaigns = await tiktok.listCampaigns();
  const k = String(keyword).trim();
  return (
    campaigns.find((c) => String(c.campaign_id) === k) ||
    campaigns.find((c) => (c.campaign_name || '').toLowerCase() === k.toLowerCase()) ||
    campaigns.find((c) => (c.campaign_name || '').includes(k)) ||
    // 模糊：关键词拆词命中
    campaigns.find((c) => {
      const name = c.campaign_name || '';
      if (k.length >= 2 && name.includes(k)) return true;
      const parts = k.split(/[\s·\-_]+/).filter((p) => p.length >= 2);
      return parts.some((p) => name.includes(p));
    })
  );
}

function normalizeDays(days) {
  if (!Array.isArray(days) || !days.length) return [0, 1, 2, 3, 4, 5, 6];
  return days
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
}

function normalizeTime(time) {
  const m = String(time || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (!(hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59)) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Apply LLM-parsed schedule intents to local scheduler */
async function applySchedules(schedules, senderName, senderOpenId) {
  const created = [];
  const failed = [];
  const list = Array.isArray(schedules) ? schedules : [];
  for (const s of list.slice(0, 30)) {
    try {
      const time = normalizeTime(s.time);
      const action = s.action === 'disable' || s.action === 'pause' ? 'disable' : 'enable';
      if (!time) {
        failed.push(`时间无效: ${s.time || '?'}`);
        continue;
      }
      const hit = await findCampaign(s.campaignKeyword || s.campaign || '');
      if (!hit) {
        failed.push(`未匹配计划: ${s.campaignKeyword || '?'}`);
        continue;
      }
      const days = normalizeDays(s.days);
      scheduler.upsertSchedule({
        campaignId: String(hit.campaign_id),
        campaignName: hit.campaign_name || String(hit.campaign_id),
        action,
        time,
        days,
        enabled: true,
      });
      created.push({ hit, action, time, days });
      log('info', 'feishu', `LLM创建规则 ${action} ${time} ${hit.campaign_name}`);
    } catch (e) {
      failed.push(e.message);
    }
  }
  return { created, failed };
}

function formatCreated(created) {
  if (!created.length) return '';
  return created
    .map(
      (x) =>
        `• ${x.time} ${x.action === 'enable' ? '开启' : '暂停'} · ${x.hit.campaign_name} · ${dayLabel(x.days)}`
    )
    .join('\n');
}

function loadRoster() {
  const r = readJson('roster.json', { text: '', updatedAt: '' });
  return r && typeof r === 'object' ? r : { text: '', updatedAt: '' };
}

function saveRoster(text) {
  writeJson('roster.json', {
    text: String(text || '').slice(0, 50000),
    updatedAt: new Date().toISOString(),
  });
}

function rulesBrief() {
  const list = scheduler.getSchedules();
  if (!list.length) return '（暂无定时规则）';
  return list.map(formatSchedule).join('\n');
}

/** Natural-language / screenshot path via LLM */
async function handleNaturalLanguage(text, imageDescription, senderOpenId, messageId, senderName) {
  if (!llm.getLlmConfig()) {
    await replyText(
      messageId,
      '当前未配置大模型，只能用固定指令。发送「帮助」查看。\n也可用：创建 计划A 开启 20:00 每天'
    );
    return;
  }

  // 新截图：先入库，方便后续提问
  if (imageDescription && imageDescription.trim()) {
    saveRoster(imageDescription);
    log('info', 'feishu', '已保存排班表 OCR (' + imageDescription.length + ' 字)');
  }

  let campaigns = [];
  let campaignErr = '';
  try {
    campaigns = await tiktok.listCampaigns();
  } catch (e) {
    campaignErr = e.message;
    log('warn', 'feishu', '列计划失败(继续解析): ' + e.message);
  }

  const roster = loadRoster().text || '';
  const rules = rulesBrief();

  // 只有要动广告/建规则时才提示“理解中”；纯提问不打断
  const isActionHint = !imageDescription && /^(创建|帮我|把|设置|暂停|恢复|开启|停止|安排|定时)/i.test(text || '');
  if (isActionHint) {
    await replyText(messageId, '正在理解你的排班…');
  }

  try {
    const parsed = await llm.parseScheduleIntent({
      userText: text || (imageDescription ? '请根据截图整理排班，并回答/创建' : ''),
      campaigns,
      imageDescription: imageDescription || '',
      roster,
      rules,
    });

    const intent = parsed.intent || 'unknown';

    if (intent === 'list') {
      await handleCommand('列表', senderOpenId, messageId, senderName);
      return;
    }
    if (intent === 'status') {
      await handleCommand('状态', senderOpenId, messageId, senderName);
      return;
    }
    if (intent === 'help') {
      await handleCommand('帮助', senderOpenId, messageId, senderName);
      return;
    }

    // 提问/讲解：直接回 reply
    if (intent === 'answer' || intent === 'unknown') {
      let reply = parsed.reply || '';
      if (!reply) {
        reply = roster
          ? '我暂时没答上。可发「排班」看最近表，或换个更具体的问题。'
          : '我这边还没有排班表。先发一张表格截图，我保存后再回答。';
      }
      if (campaignErr && /授权|token|Unauthorized/i.test(campaignErr)) {
        reply += '\n\n（TikTok 尚未完成授权，计划状态可能不全）';
      }
      await replyText(messageId, reply);
      return;
    }

    if (intent === 'pause_now' || intent === 'enable_now') {
      const action = intent === 'enable_now' ? 'enable' : 'disable';
      const kw = parsed.targetCampaignKeyword || text;
      const hit = await findCampaign(kw);
      if (!hit) {
        await replyText(
          messageId,
          `未能匹配计划: ${kw}\n可先发「列表」。${campaignErr ? '\nTikTok错误: ' + campaignErr : ''}`
        );
        return;
      }
      try {
        await tiktok.updateCampaignStatus(hit.campaign_id, action);
        await replyText(
          messageId,
          `${action === 'enable' ? '已开启' : '已暂停'}: ${hit.campaign_name}\n操作人: ${senderName || senderOpenId}`
        );
      } catch (err) {
        await replyText(messageId, `操作失败: ${err.message}`);
      }
      return;
    }

    if (intent === 'create_schedules' && Array.isArray(parsed.schedules) && parsed.schedules.length) {
      const { created, failed } = await applySchedules(parsed.schedules, senderName, senderOpenId);
      const lines = [
        parsed.reply || '已按你的排班创建定时规则：',
        formatCreated(created),
        failed.length ? `\n未处理：\n• ${failed.join('\n• ')}` : '',
        '',
        created.length
          ? `共新建 ${created.length} 条。发「规则」可查看。到点需桌面端保持运行。`
          : '没有成功创建任何规则，请检查 TikTok 授权与计划名，或发「列表」。',
        campaignErr ? `TikTok提示: ${campaignErr}` : '',
      ].filter(Boolean);
      await replyText(messageId, lines.join('\n'));
      return;
    }

    await replyText(
      messageId,
      (parsed.reply || '我没看懂。') +
        '\n\n你可以：\n1) 先发表格截图（我保存后排班问题都能答）\n2) 问：pinkchompoo88 几点开？\n3) 说：给 pinkchompoo88 建 21-23 点定时\n4) 发「帮助」'
    );
  } catch (err) {
    log('error', 'feishu', 'NL失败: ' + err.message);
    await replyText(messageId, '处理失败: ' + err.message);
  }
}

async function handleCommand(rawText, senderOpenId, messageId, senderName) {
  let text = rawText.replace(/^@[^@\s]+/g, '').trim();
  if (!text) {
    await replyText(messageId, '收到空消息。发送「帮助」查看指令。');
    return;
  }

  if (!isAllowed(senderOpenId)) {
    log('warn', 'feishu', `未授权用户尝试操作: ${senderOpenId}`);
    await replyText(messageId, '你不在允许名单内，无法操作本机器人。');
    return;
  }

  // 统一全角空格
  text = text.replace(/[　]/g, ' ').replace(/\s+/g, ' ').trim();

  if (/^(帮助|help|\?)$/i.test(text)) {
    await replyText(
      messageId,
      [
        '【自然语言 / 截图】',
        '1) 先发表格截图（保存后才能答排班问题）',
        '2) 提问：pinkchompoo88 几点开？谁是重点？',
        '3) 建定时：给 pinkchompoo88 9/24-30 每天21点开23点关',
        '4) 看表：排班 · 规则 · 列表 · 状态',
        '',
        '固定指令：暂停 计划A / 恢复 计划A / 创建 计划A 开启 20:00 每天',
      ].join('\n')
    );
    return;
  }

  if (/^(状态|status)$/i.test(text)) {
    const tokens = tiktok.getTokens();
    const st = loadState();
    const authed = !!(tokens.accessToken || tiktok.isMock());
    const schCount = scheduler.getSchedules().length;
    await replyText(
      messageId,
      [
        `TikTok 授权: ${authed ? (tiktok.isMock() ? 'MOCK 演示' : '已授权') : '未授权'}`,
        `广告账户: ${tokens.advertiserId || config.tiktok.advertiserId || '未设置'}`,
        `飞书长连接: ${st.feishuConnected ? '在线' : '未连接/异常'}`,
        `调度器: ${scheduler.isRunning() ? '运行中' : '停止'} · 规则 ${schCount} 条`,
        `模式: ${tiktok.isMock() ? 'MOCK（不会真实调 API）' : 'LIVE'}`,
      ].join('\n')
    );
    return;
  }

  if (/^(列表|list|plans)$/i.test(text)) {
    try {
      const campaigns = await tiktok.listCampaigns();
      if (!campaigns.length) {
        await replyText(messageId, '没有查到计划。');
        return;
      }
      const lines = campaigns.slice(0, 30).map((c) => {
        const st = c.status === 'ENABLE' ? '开' : c.status === 'DISABLE' ? '停' : c.status;
        return `• [${st}] ${c.campaign_name} (${c.campaign_id})`;
      });
      await replyText(messageId, `共 ${campaigns.length} 条：\n${lines.join('\n')}`);
    } catch (err) {
      await replyText(messageId, '列表失败: ' + err.message);
    }
    return;
  }

  if (/^(排班|表格|roster|表)$/i.test(text)) {
    const r = loadRoster();
    if (!r.text) {
      await replyText(messageId, '还没有排班表。请先发一张表格截图，我会保存下来，之后就能回答排班问题。');
      return;
    }
    await replyText(
      messageId,
      `最近排班表（${(r.updatedAt || '').slice(0, 19)}）：\n\n${r.text.slice(0, 3500)}`
    );
    return;
  }

  if (/^(规则|定时|schedule|schedules)$/i.test(text)) {
    const list = scheduler.getSchedules();
    if (!list.length) {
      await replyText(messageId, '暂无定时规则。可用：\n创建 计划A 开启 20:00 每天');
      return;
    }
    await replyText(
      messageId,
      `共 ${list.length} 条规则：\n` + list.map(formatSchedule).join('\n')
    );
    return;
  }

  if (/^(最近|日志|runs|logs)$/i.test(text)) {
    const runs = scheduler.getRuns().slice(0, 10);
    if (!runs.length) {
      await replyText(messageId, '暂无执行记录。');
      return;
    }
    const lines = runs.map(
      (r) =>
        `• ${(r.ts || '').slice(5, 19)} ${r.status === 'ok' ? '✓' : '✗'} ${r.action} ${r.campaignName || r.campaignId}${r.error ? ' · ' + r.error : ''}`
    );
    await replyText(messageId, '最近执行：\n' + lines.join('\n'));
    return;
  }

  // 删除/停用/启用规则
  const mRule = text.match(/^(删除|停用|启用|取消)\s*(规则|定时)?\s*(\S+)$/i);
  if (mRule) {
    const verb = mRule[1];
    const id = mRule[3];
    const list = scheduler.getSchedules();
    const hit = list.find((s) => s.id === id || s.id.endsWith(id));
    if (!hit) {
      await replyText(messageId, `未找到规则: ${id}\n可发「规则」查看 ID。`);
      return;
    }
    if (verb === '删除' || verb === '取消') {
      scheduler.removeSchedule(hit.id);
      await replyText(messageId, `已删除规则 ${hit.id}\n${formatSchedule(hit)}`);
    } else if (verb === '停用') {
      scheduler.upsertSchedule({ id: hit.id, enabled: false });
      await replyText(messageId, `已停用规则 ${hit.id}`);
    } else {
      scheduler.upsertSchedule({ id: hit.id, enabled: true });
      await replyText(messageId, `已启用规则 ${hit.id}`);
    }
    return;
  }

  // 创建定时：创建 计划A 开启 20:00 每天
  // 创建 计划A 暂停 23:30 工作日
  const mCreate = text.match(
    /^(?:创建|新增|添加|定时|计划)\s+(.+?)\s+(开启|打开|启动|恢复|enable|暂停|停止|关闭|disable)\s+(\d{1,2}:\d{2})\s*(?:(每天|工作日|周末|一次|today|weekdays|weekends)?)?$/i
  );
  if (mCreate) {
    try {
      const keyword = mCreate[1].trim();
      const actionWord = mCreate[2].toLowerCase();
      const timeRaw = mCreate[3];
      const repeatRaw = (mCreate[4] || '每天').toLowerCase();
      const action = /^(开启|打开|启动|恢复|enable)$/i.test(actionWord) ? 'enable' : 'disable';
      const [hh, mm] = timeRaw.split(':').map((n) => parseInt(n, 10));
      if (!(hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59)) {
        await replyText(messageId, `时间格式不对: ${timeRaw}，请用 24 小时 HH:MM，例如 20:30`);
        return;
      }
      const time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      let days = [0, 1, 2, 3, 4, 5, 6];
      if (/工作日|weekdays/.test(repeatRaw)) days = [1, 2, 3, 4, 5];
      else if (/周末|weekends/.test(repeatRaw)) days = [0, 6];
      else if (/一次|today/.test(repeatRaw)) days = [new Date().getDay()];

      const hit = await findCampaign(keyword);
      if (!hit) {
        const campaigns = await tiktok.listCampaigns().catch(() => []);
        const names = campaigns.slice(0, 8).map((c) => c.campaign_name).join('、');
        await replyText(
          messageId,
          `未找到计划: ${keyword}\n可先发「列表」。示例名称: ${names || '（暂无）'}`
        );
        return;
      }

      const item = scheduler.upsertSchedule({
        campaignId: String(hit.campaign_id),
        campaignName: hit.campaign_name || String(hit.campaign_id),
        action,
        time,
        days,
        enabled: true,
      });
      const created = item.find((s) => s.campaignId === String(hit.campaign_id) && s.time === time && s.action === action);
      log('info', 'feishu', `创建规则 ${action} ${time} ${hit.campaign_name}`);
      await replyText(
        messageId,
        [
          '已创建定时规则：',
          formatSchedule(
            created || {
              id: 'new',
              time,
              action,
              days,
              enabled: true,
              campaignName: hit.campaign_name,
              campaignId: hit.campaign_id,
            }
          ),
          `操作人: ${senderName || senderOpenId}`,
          '可用「规则」查看，或「立即 计划A 暂停」做应急。',
        ].join('\n')
      );
    } catch (err) {
      await replyText(messageId, `创建失败: ${err.message}`);
    }
    return;
  }

  // 立即执行：立即 计划A 暂停 / 立即 计划A 开启
  const mNow = text.match(
    /^(?:立即|马上|现在)\s+(.+?)\s+(开启|打开|启动|恢复|暂停|停止|关闭)$/i
  );
  if (mNow) {
    try {
      const hit = await findCampaign(mNow[1]);
      if (!hit) {
        await replyText(messageId, `未找到计划: ${mNow[1]}`);
        return;
      }
      const action = /^(开启|打开|启动|恢复)$/i.test(mNow[2]) ? 'enable' : 'disable';
      await tiktok.updateCampaignStatus(hit.campaign_id, action);
      const msg = `${action === 'enable' ? '已开启' : '已暂停'}: ${hit.campaign_name} (${hit.campaign_id})\n操作人: ${senderName || senderOpenId}`;
      log('info', 'feishu', msg);
      await replyText(messageId, msg);
    } catch (err) {
      await replyText(messageId, `操作失败: ${err.message}`);
    }
    return;
  }

  const mPause = text.match(/^(暂停|停止|关闭|disable|pause)\s+(.+)$/i);
  const mEnable = text.match(/^(恢复|开启|打开|启动|enable|start)\s+(.+)$/i);

  if (mPause || mEnable) {
    const action = mPause ? 'disable' : 'enable';
    const keyword = (mPause ? mPause[2] : mEnable[2]).trim();
    try {
      const hit = await findCampaign(keyword);
      if (!hit) {
        await replyText(messageId, `未找到计划: ${keyword}\n可发送「列表」查看。`);
        return;
      }
      await tiktok.updateCampaignStatus(hit.campaign_id, action);
      const verb = action === 'enable' ? '已恢复/开启' : '已暂停/关闭';
      const msg = `${verb}: ${hit.campaign_name} (${hit.campaign_id})\n操作人: ${senderName || senderOpenId}`;
      log('info', 'feishu', msg);
      await replyText(messageId, msg);
    } catch (err) {
      await replyText(messageId, `操作失败: ${err.message}`);
    }
    return;
  }

  // 固定指令未命中 → 白话 / 截图交给大模型
  await handleNaturalLanguage(text, '', senderOpenId, messageId, senderName);
}

async function connectFeishu() {
  if (!config.feishu.appId || !config.feishu.appSecret) {
    throw new Error('缺少 FEISHU_APP_ID / FEISHU_APP_SECRET');
  }
  if (running) return { already: true };

  const lark = require('@larksuiteoapi/node-sdk');
  global.__larkClient = new lark.Client({
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
  });

  const eventDispatcher = new lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data) => {
      try {
        const msg = data?.message || {};
        const sender = data?.sender || {};
        const openId = sender?.sender_id?.open_id || '';
        const name = sender?.sender_id?.user_id || openId;
        const chatType = msg.chat_type;
        const text = extractText(msg);
        const imageKey = extractImageKey(msg);

        if (chatType === 'group' && !msg.mentions?.length && !/@/.test(text)) {
          return;
        }
        if (!isAllowed(openId)) {
          await replyText(msg.message_id, '你不在允许名单内，无法操作本机器人。');
          return;
        }

        // 图片消息 → 视觉转写 → 解析排班
        if (msg.message_type === 'image' && imageKey) {
          log('info', 'feishu', '收到图片消息，开始视觉解析');
          await replyText(msg.message_id, '收到截图，正在识别排班…');
          try {
            const b64 = await downloadImageBase64(msg.message_id, imageKey);
            const desc = await llm.describeImageBase64(b64, 'image/jpeg');
            await handleNaturalLanguage(text || '请根据截图创建直播计划定时开关', desc, openId, msg.message_id, name);
          } catch (err) {
            log('error', 'feishu', '图片解析失败: ' + err.message);
            await replyText(msg.message_id, '图片识别失败: ' + err.message + '\n可改用文字：创建 计划A 开启 21:00 每天');
          }
          return;
        }

        if (!text) {
          await replyText(msg.message_id, '发送文字指令或排班截图。发送「帮助」查看。');
          return;
        }

        log('info', 'feishu', `收到消息: ${text.slice(0, 120)}`);
        await handleCommand(text, openId, msg.message_id, name);
      } catch (err) {
        log('error', 'feishu', '处理消息异常: ' + err.message);
      }
    },
  });

  wsClient = new lark.WSClient({
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
  });

  wsClient.start({ eventDispatcher });
  running = true;
  saveState({ feishuConnected: true, lastFeishuError: '' });
  log('info', 'feishu', '长连接已启动');
  return { ok: true };
}

function disconnectFeishu() {
  running = false;
  wsClient = null;
  saveState({ feishuConnected: false });
  log('info', 'feishu', '飞书连接已标记断开');
}

function getFeishuStatus() {
  return loadState();
}

module.exports = {
  connectFeishu,
  disconnectFeishu,
  getFeishuStatus,
  handleCommand,
};
