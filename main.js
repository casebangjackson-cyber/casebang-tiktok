'use strict';

const { app, BrowserWindow, ipcMain, shell, Tray, Menu } = require('electron');
const path = require('path');
const { config } = require('./lib/config');
const tiktok = require('./lib/tiktok');
const feishu = require('./lib/feishu');
const scheduler = require('./lib/scheduler');
const automations = require('./lib/automations');
const reports = require('./lib/reports');
const api = require('./lib/api-server');
const { log, appendLog } = require('./lib/logger');
const { readJson } = require('./lib/store');

let win = null;
let tray = null;
let isQuitting = false;

function showWindow() {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  // Windows 下优先 .ico，失败则退回 png
  const iconPath = path.join(__dirname, 'assets', process.platform === 'win32' ? 'app-icon.ico' : 'app-icon.png');
  try {
    tray = new Tray(iconPath);
  } catch (e) {
    try {
      tray = new Tray(path.join(__dirname, 'assets', 'app-icon.png'));
    } catch (e2) {
      log('warn', 'app', '创建托盘图标失败: ' + e2.message);
      return;
    }
  }

  tray.setToolTip('CASEBANG TK广告中心 — 右键可退出');
  const menu = Menu.buildFromTemplate([
    { label: '打开主界面', click: () => showWindow() },
    { type: 'separator' },
    {
      label: '退出程序',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => showWindow());
  tray.on('double-click', () => showWindow());
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 560,
    show: false,
    title: 'CASEBANG TK广告中心',
    icon: path.join(__dirname, 'assets', 'app-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 打开即全屏最大化
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

  // 点关闭：收进托盘，不退出（防误关导致定时任务停摆）
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
      log('info', 'app', '窗口已最小化到托盘，程序继续后台运行');
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function pushState() {
  api.notify();
  if (!win || win.isDestroyed()) return;
  win.webContents.send('app:state', api.getStatus());
}

function setupIpc() {
  ipcMain.handle('app:status', () => api.getStatus());

  ipcMain.handle('tiktok:startAuth', async () => {
    try {
      log('info', 'tiktok', '开始 TikTok 授权流程…');
      const r = await tiktok.startOAuthCallbackServer();
      // 主进程直接拉起系统浏览器（比渲染层 window.open 更可靠）
      if (r?.authorizeUrl) {
        await shell.openExternal(r.authorizeUrl);
        log('info', 'tiktok', '已在系统浏览器打开授权页', {
          portBusy: !!r.portBusy,
          url: r.authorizeUrl,
        });
      }
      return { ok: true, ...r };
    } catch (e) {
      log('error', 'tiktok', '授权启动失败: ' + e.message);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('app:openExternal', async (_e, url) => {
    if (!/^https?:\/\//i.test(String(url || ''))) {
      return { ok: false, error: '非法链接' };
    }
    await shell.openExternal(url);
    return { ok: true };
  });

  // 顶栏「重启客户端」：关掉托盘逻辑后整进程重启
  ipcMain.handle('app:relaunch', () => {
    try {
      log('info', 'app', '用户触发重启客户端');
      isQuitting = true;
      app.relaunch();
      app.exit(0);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('tiktok:advertisers', async () => {
    try {
      const list = await tiktok.getAdvertisers();
      return { ok: true, list };
    } catch (e) {
      return { ok: false, error: e.message, list: [] };
    }
  });

  ipcMain.handle('tiktok:setAdvertiser', async (_e, advertiserId) => {
    tiktok.saveTokens({ advertiserId });
    if (!config.tiktok.advertiserId) {
      // 覆盖运行时配置
      config.tiktok.advertiserId = advertiserId;
    }
    pushState();
    return { ok: true };
  });

  ipcMain.handle('tiktok:campaigns', async () => {
    try {
      // 计划与 country 都由 listCampaigns 给出（直播 GMV Max 口径）
      const list = await tiktok.listCampaigns();
      return { ok: true, list, country: list[0]?.country || '' };
    } catch (e) {
      return { ok: false, error: e.message, list: [] };
    }
  });

  ipcMain.handle('tiktok:toggle', async (_e, { campaignId, action }) => {
    try {
      await tiktok.updateCampaignStatus(campaignId, action);
      pushState();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // —— 直播时间窗自动化 ——
  ipcMain.handle('auto:list', () => automations.getAutomations());
  ipcMain.handle('auto:get', (_e, campaignId) => automations.getAutomation(campaignId));
  ipcMain.handle('auto:upsert', (_e, payload) => {
    try {
      const a = automations.upsertAutomation(payload);
      pushState();
      return { ok: true, automation: a };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('auto:remove', (_e, campaignId) => {
    automations.removeAutomation(campaignId);
    pushState();
    return { ok: true };
  });
  ipcMain.handle('auto:master', (_e, { campaignId, enabled }) => {
    try {
      const a = automations.setMasterEnabled(campaignId, enabled);
      pushState();
      return { ok: true, automation: a };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('auto:segmentEnabled', (_e, { campaignId, segmentId, enabled }) => {
    try {
      const a = automations.setSegmentEnabled(campaignId, segmentId, enabled);
      pushState();
      return { ok: true, automation: a };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('auto:execItems', () => automations.listExecutionItems());
  ipcMain.handle('auto:runs', () => automations.getRuns());

  ipcMain.handle('sched:list', () => scheduler.getSchedules());
  ipcMain.handle('sched:runs', () => scheduler.getRuns());
  ipcMain.handle('sched:upsert', (_e, item) => {
    const list = scheduler.upsertSchedule(item);
    pushState();
    return list;
  });
  ipcMain.handle('sched:remove', (_e, id) => {
    const list = scheduler.removeSchedule(id);
    pushState();
    return list;
  });
  ipcMain.handle('sched:start', () => {
    const r = scheduler.startScheduler();
    pushState();
    return r;
  });
  ipcMain.handle('sched:stop', () => {
    const r = scheduler.stopScheduler();
    pushState();
    return r;
  });
  ipcMain.handle('sched:tick', async () => {
    const r = await scheduler.tick();
    pushState();
    return r;
  });

  ipcMain.handle('feishu:connect', async () => {
    try {
      const r = await feishu.connectFeishu();
      pushState();
      return { ok: true, ...r };
    } catch (e) {
      log('error', 'feishu', e.message);
      pushState();
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('feishu:disconnect', () => {
    feishu.disconnectFeishu();
    pushState();
    return { ok: true };
  });

  ipcMain.handle('app:logs', () => readJson('logs.json', []).slice(0, 100));

  ipcMain.handle('reports:dashboard', async (_e, range) => {
    try {
      const data = await reports.getCampaignReport(range || {});
      return { ok: true, ...data, summary: reports.summarize(data.daily || []) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

app.whenReady().then(() => {
  // 任务栏/Alt-Tab 也用同一套图标
  try {
    app.setIcon(path.join(__dirname, 'assets', 'app-icon.png'));
  } catch {
    /* 部分平台不支持 setIcon */
  }
  setupIpc();
  // 局域网手机端：同一 Wi-Fi 下用手机打开控制台
  api.start();
  createWindow();
  createTray();
  scheduler.startScheduler();
  // 启动即挂好 OAuth 回调，避免授权时才起服务
  tiktok.startOAuthCallbackServer()
    .then((r) => log('info', 'tiktok', `回调就绪 ${r?.portBusy ? '(端口占用，沿用现有监听)' : 'OK'} ${config.tiktok.redirectUri}`))
    .catch((e) => log('error', 'tiktok', '回调启动失败: ' + e.message));
  // 自动尝试连飞书（失败仅记日志）
  feishu.connectFeishu().catch((e) => log('warn', 'feishu', '自动连接失败: ' + e.message));
  log('info', 'app', '桌面端已启动');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  // 托盘模式下：窗口被关掉也不退出，等托盘「退出程序」才真正结束
  if (isQuitting) {
    app.quit();
    return;
  }
  if (process.platform === 'darwin') app.quit();
});
