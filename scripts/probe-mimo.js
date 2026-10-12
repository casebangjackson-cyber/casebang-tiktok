'use strict';
const fs = require('fs');

function getXiaomiKey() {
  const raw = fs.readFileSync(
    'C:/Users/Administrator/.config/mimocode/mimocode.jsonc',
    'utf8'
  );
  const m = raw.match(/"xiaomi"[\s\S]{0,500}?"apiKey"\s*:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

async function probe() {
  const key = getXiaomiKey();
  if (!key) {
    console.log('NO_KEY');
    process.exit(1);
  }
  const bases = [
    'https://api.xiaomimimo.com/v1',
    'https://api.xiaomimimo.com',
    'https://mimo.xiaomi.com/v1',
    'https://api.mimo.xiaomi.com/v1',
    'https://open.xiaomimimo.com/v1',
    'https://api.xiaomi.com/v1',
    'https://xiaomi-mimo.xiaomi.com/v1',
    'https://api-mimo.xiaomi.com/v1',
    'https://mimo-api.xiaomi.com/v1',
    'https://platform.xiaomimimo.com/v1',
    'https://api.xiaomimimo.com/openai/v1',
    'https://xiaomimimo.com/api/v1',
    'https://api.xiaomi.net/v1',
    'https://mimo.xiaomi.net/v1',
  ];

  for (const base of bases) {
    try {
      const r = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      const t = await r.text();
      console.log(r.status, base, t.slice(0, 160).replace(key, '***'));
      if (r.ok) {
        const c = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'mimo-v2.6-flash',
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 8,
          }),
        });
        const ct = await c.text();
        console.log('  CHAT', c.status, ct.slice(0, 220).replace(key, '***'));
      }
    } catch (e) {
      console.log('ERR', base, e.message);
    }
  }
}

probe().catch((e) => {
  console.error(e);
  process.exit(1);
});
