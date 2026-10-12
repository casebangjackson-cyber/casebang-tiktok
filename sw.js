'use strict';

/**
 * PWA service worker
 * - 页面/静态资源：网络优先（永远拿最新代码），失败才用缓存
 * - /api/*：完全不经过缓存，保证实时数据
 * - 离线时能打开外壳，登录态仍读 localStorage
 */
const CACHE = 'casebang-v2';

/** 预缓存整套外壳：网络一旦成功过一次，之后弱网/断网都能完整渲染 */
const PRECACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/dash-ui.js',
  '/manifest.webmanifest',
  '/assets/logo-casebang.png',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        // 逐个缓存、单个失败不拖垮整体（弱网下很关键）
        Promise.all(
          PRECACHE.map((url) =>
            cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
          )
        )
      )
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // 实时接口一律走网络，绝不缓存
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches
            .open(CACHE)
            .then((c) => c.put(req, copy))
            .catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        try {
          const cached = await caches.match(req, { ignoreSearch: true });
          if (cached) return cached;
          if (req.mode === 'navigate') {
            const shell = (await caches.match('/index.html')) || (await caches.match('/'));
            if (shell) return shell;
          }
        } catch {
          /* ignore */
        }
        return new Response('当前离线，且页面未缓存', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      })
  );
});
