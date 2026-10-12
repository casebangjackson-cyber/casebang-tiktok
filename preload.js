'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  status: () => ipcRenderer.invoke('app:status'),
  logs: () => ipcRenderer.invoke('app:logs'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  isDesktop: true,
  tiktok: {
    startAuth: () => ipcRenderer.invoke('tiktok:startAuth'),
    advertisers: () => ipcRenderer.invoke('tiktok:advertisers'),
    setAdvertiser: (id) => ipcRenderer.invoke('tiktok:setAdvertiser', id),
    campaigns: () => ipcRenderer.invoke('tiktok:campaigns'),
    toggle: (campaignId, action) => ipcRenderer.invoke('tiktok:toggle', { campaignId, action }),
  },
  auto: {
    list: () => ipcRenderer.invoke('auto:list'),
    get: (campaignId) => ipcRenderer.invoke('auto:get', campaignId),
    upsert: (payload) => ipcRenderer.invoke('auto:upsert', payload),
    remove: (campaignId) => ipcRenderer.invoke('auto:remove', campaignId),
    master: (campaignId, enabled) => ipcRenderer.invoke('auto:master', { campaignId, enabled }),
    segmentEnabled: (campaignId, segmentId, enabled) =>
      ipcRenderer.invoke('auto:segmentEnabled', { campaignId, segmentId, enabled }),
    execItems: () => ipcRenderer.invoke('auto:execItems'),
    runs: () => ipcRenderer.invoke('auto:runs'),
  },
  sched: {
    list: () => ipcRenderer.invoke('sched:list'),
    runs: () => ipcRenderer.invoke('sched:runs'),
    upsert: (item) => ipcRenderer.invoke('sched:upsert', item),
    remove: (id) => ipcRenderer.invoke('sched:remove', id),
    start: () => ipcRenderer.invoke('sched:start'),
    stop: () => ipcRenderer.invoke('sched:stop'),
    tick: () => ipcRenderer.invoke('sched:tick'),
  },
  feishu: {
    connect: () => ipcRenderer.invoke('feishu:connect'),
    disconnect: () => ipcRenderer.invoke('feishu:disconnect'),
  },
  onState: (cb) => ipcRenderer.on('app:state', (_e, s) => cb(s)),
  reports: {
    dashboard: (range) => ipcRenderer.invoke('reports:dashboard', range),
  },
});
