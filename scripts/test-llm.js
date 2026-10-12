'use strict';
const llm = require('../lib/llm');

(async () => {
  const cfg = llm.getLlmConfig();
  if (!cfg) {
    console.log('NO_LLM_CONFIG');
    process.exit(2);
  }
  console.log('CFG', cfg.providerId, cfg.modelId, cfg.baseURL, 'keyLen=' + cfg.apiKey.length);
  try {
    const out = await llm.chat(
      [
        { role: 'system', content: '只输出 JSON' },
        { role: 'user', content: '把“21点开23点关”变成 {ok:true}' },
      ],
      { timeoutMs: 30000 }
    );
    console.log('CHAT_OK', out.slice(0, 200));
  } catch (e) {
    console.log('CHAT_FAIL', e.message);
    process.exitCode = 1;
  }
})();
