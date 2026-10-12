'use strict';
const fs = require('fs');
const llm = require('../lib/llm');

// 1x1 PNG
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

(async () => {
  const cfg = llm.getLlmConfig();
  if (!cfg) {
    console.log('NO_CONFIG');
    process.exit(2);
  }
  console.log(
    'CFG',
    cfg.providerId,
    cfg.modelId,
    cfg.baseURL,
    'keyLen=' + cfg.apiKey.length
  );

  try {
    const out = await llm.chat(
      [
        { role: 'system', content: '只输出 JSON，不要其它文字' },
        { role: 'user', content: '返回 {"ok":true}' },
      ],
      { timeoutMs: 60000, maxTokens: 512 }
    );
    console.log('CHAT_OK', out.slice(0, 200));
  } catch (e) {
    console.log('CHAT_FAIL', e.message);
    process.exitCode = 1;
  }

  try {
    const desc = await llm.describeImageBase64(PNG_1x1.toString('base64'), 'image/png');
    console.log('VISION_OK', desc.slice(0, 200));
  } catch (e) {
    console.log('VISION_FAIL', e.message);
    process.exitCode = 1;
  }
})();
