'use strict';

/**
 * 手机端 / 浏览器模式：静态页面 + /api 控制接口 + 调度器。
 * 无 Electron 也能跑（定时规则、手机端实时控制都可用）。
 * 桌面端 npm start 时也会拉起同一个服务。
 */
const api = require('./lib/api-server');
const scheduler = require('./lib/scheduler');
const feishu = require('./lib/feishu');
const tiktok = require('./lib/tiktok');
const { log } = require('./lib/logger');

const server = api.start();

scheduler.startScheduler();
tiktok
  .startOAuthCallbackServer()
  .then((r) =>
    log('info', 'tiktok', `回调就绪 ${r?.portBusy ? '(端口占用，沿用现有监听)' : 'OK'}`)
  )
  .catch((e) => log('error', 'tiktok', '回调启动失败: ' + e.message));
feishu.connectFeishu().catch((e) => log('warn', 'feishu', '自动连接失败: ' + e.message));
log('info', 'app', '手机端服务已启动');

function shutdown() {
  try {
    server.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
