'use strict';
const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const { log } = require('./logger');

function parseJsonc(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  let out = '';
  let inStr = false;
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if (inStr) {
      out += c;
      if (c === '\\') {
        out += raw[i + 1] || '';
        i += 2;
        continue;
      }
      if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      i++;
      continue;
    }
    if (c === '/' && raw[i + 1] === '/') {
      while (i < raw.length && raw[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && raw[i + 1] === '*') {
      i += 2;
      while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return JSON.parse(out);
}

function loadLlmFromMimocode() {
  const candidates = [
    process.env.MIMOCODE_CONFIG,
    path.join(process.env.USERPROFILE || '', '.config', 'mimocode', 'mimocode.jsonc'),
    path.join(process.env.USERPROFILE || '', '.config', 'mimocode', 'mimocode.json'),
    path.join(process.cwd(), '.mimocode', 'mimocode.jsonc'),
    path.join(process.cwd(), '.mimocode', 'mimocode.json'),
  ].filter(Boolean);

  let merged = null;
  for (const p of candidates) {
    try {
      const j = parseJsonc(p);
      if (j) {
        merged = {
          ...(merged || {}),
          ...j,
          provider: { ...((merged && merged.provider) || {}), ...((j && j.provider) || {}) },
        };
      }
    } catch {
      /* ignore */
    }
  }
  if (!merged || !merged.provider) return null;

  // 优先小米 MiMo（便宜），其次 deepseek
  const prefer = [
    ['xiaomi', 'mimo-v2.6-flash', 'https://api.xiaomimimo.com/v1'],
    ['xiaomi', 'mimo-v2.5', 'https://api.xiaomimimo.com/v1'],
    ['deepseek', 'deepseek-flash', 'https://api.deepseek.com/v1'],
  ];

  for (const [providerId, modelId, defaultBase] of prefer) {
    const provider = merged.provider[providerId];
    if (!provider?.options?.apiKey) continue;
    const models = Object.keys(provider.models || {});
    const useModel =
      process.env.LLM_MODEL && providerId === (process.env.LLM_PROVIDER || providerId)
        ? process.env.LLM_MODEL
        : models.includes(modelId)
          ? modelId
          : models[0];
    if (!useModel) continue;
    const baseURL =
      process.env.LLM_BASE_URL && process.env.LLM_PROVIDER === providerId
        ? process.env.LLM_BASE_URL
        : provider.options?.baseURL || defaultBase;
    if (!baseURL) continue;
    return {
      providerId,
      modelId: useModel,
      baseURL: String(baseURL).replace(/\/$/, ''),
      apiKey: provider.options.apiKey,
      fullModel: `${providerId}/${useModel}`,
      wireModel: useModel,
    };
  }

  // fallback: first with key
  for (const [providerId, provider] of Object.entries(merged.provider)) {
    if (!provider?.options?.apiKey) continue;
    const models = Object.keys(provider.models || {});
    if (!models[0]) continue;
    const baseURL =
      provider.options?.baseURL ||
      (providerId === 'xiaomi'
        ? 'https://api.xiaomimimo.com/v1'
        : providerId === 'deepseek'
          ? 'https://api.deepseek.com/v1'
          : null);
    if (!baseURL) continue;
    return {
      providerId,
      modelId: models[0],
      baseURL: String(baseURL).replace(/\/$/, ''),
      apiKey: provider.options.apiKey,
      fullModel: `${providerId}/${models[0]}`,
      wireModel: models[0],
    };
  }
  return null;
}

let cached = null;
function getLlmConfig() {
  if (cached !== null) return cached;
  if (process.env.LLM_DISABLE === '1') {
    cached = false;
    return cached;
  }
  try {
    cached = loadLlmFromMimocode() || false;
  } catch (e) {
    log('warn', 'llm', '加载模型配置失败: ' + e.message);
    cached = false;
  }
  if (cached) {
    log('info', 'llm', `已配置模型 ${cached.fullModel} @ ${cached.baseURL}`);
  }
  return cached;
}

async function chat(messages, { timeoutMs = 90000, temperature = 0.2, maxTokens = 4096 } = {}) {
  const llm = getLlmConfig();
  if (!llm) throw new Error('未配置可用大模型');

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${llm.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llm.apiKey}`,
      },
      body: JSON.stringify({
        model: llm.wireModel,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 300)}`);
    const json = JSON.parse(text);
    const content = json?.choices?.[0]?.message?.content;
    if (!content) throw new Error('LLM 返回空内容');
    return content;
  } finally {
    clearTimeout(t);
  }
}

function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function parseScheduleIntent({
  userText = '',
  campaigns = [],
  imageDescription = '',
  roster = '',
  rules = '',
}) {
  const campaignList = campaigns
    .slice(0, 50)
    .map((c) => `- ${c.campaign_name} (id=${c.campaign_id}, status=${c.status})`)
    .join('\n');

  const system = [
    '你是直播广告计划调度助手。既能解析排班创建定时，也能回答关于排班表/规则/计划的提问。',
    '输出必须是单个 JSON 对象，不要 markdown 解释。',
    'schema:',
    '{',
    '  "intent": "create_schedules" | "list" | "status" | "pause_now" | "enable_now" | "help" | "answer" | "unknown",',
    '  "reply": "给用户的中文回复。若是提问，这里就是完整答案；若是创建/启停，这里是简短说明。",',
    '  "schedules": [',
    '    {',
    '      "campaignKeyword": "用于匹配计划名的关键词",',
    '      "action": "enable" | "disable",',
    '      "time": "HH:MM",',
    '      "days": [0,1,2,3,4,5,6],',
    '      "date": "YYYY-MM-DD 可选"',
    '    }',
    '  ],',
    '  "targetCampaignKeyword": "紧急启停时的关键词"',
    '}',
    'intent 选择:',
    '- 用户要开/关/创建定时 → create_schedules',
    '- 用户问排班表内容、谁重点、几点开播、有哪些达人、规则是什么 → answer（在 reply 里直接答，不要编造表里没有的内容）',
    '- 用户要立刻暂停/开启某计划 → pause_now / enable_now',
    '排班规则:',
    '- 晚上开投=enable，下播/暂停=disable。',
    '- 多天多时段拆成多条 schedules。',
    '- 0=周日。工作日=[1,2,3,4,5]，周末=[0,6]，每天=[0..6]。',
    '- 中文 21:00-23:00 → enable 21:00 + disable 23:00。',
    '- 表里写“一直开”= enable，可无 disable（或到业务下播再关）。',
  ].join('\n');

  const user = [
    `【TikTok广告计划】\n${campaignList || '（暂无/未授权）'}`,
    roster ? `\n【排班表（最近上传）】\n${roster.slice(0, 6000)}` : '',
    rules ? `\n【已配置定时规则】\n${rules.slice(0, 3000)}` : '',
    imageDescription ? `\n【本次图片OCR】\n${imageDescription.slice(0, 6000)}` : '',
    `\n【用户消息】\n${userText}`,
  ]
    .filter(Boolean)
    .join('\n');

  const content = await chat([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]);
  const json = extractJson(content);
  if (!json) throw new Error('模型解析失败');
  return json;
}

async function describeImageBase64(imageBase64, mime = 'image/png') {
  const llm = getLlmConfig();
  if (!llm) throw new Error('未配置可用大模型');
  const dataUrl = `data:${mime};base64,${imageBase64}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(`${llm.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llm.apiKey}`,
      },
      body: JSON.stringify({
        model: llm.wireModel,
        temperature: 0,
        stream: false,
        max_tokens: 4096,
        messages: [
          {
            role: 'system',
            content:
              '你是表格 OCR 助手。把图片中的直播排班/达人/时间表完整转成纯文本，保留列意与换行，不要评论。',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: '请转写图片中的表格内容' },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`视觉模型 HTTP ${res.status}: ${text.slice(0, 400)}`);
    const json = JSON.parse(text);
    const content = json?.choices?.[0]?.message?.content;
    if (!content) throw new Error('视觉模型返回空');
    return content;
  } finally {
    clearTimeout(t);
  }
}

module.exports = {
  getLlmConfig,
  chat,
  parseScheduleIntent,
  describeImageBase64,
  extractJson,
};
