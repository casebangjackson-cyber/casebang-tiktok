# TikTok GMV Max 直播计划桌面端

桌面端定时开关 TikTok GMV Max 直播广告计划，并通过 **飞书机器人** 在手机上下达紧急指令。

## 功能

- TikTok Ads API OAuth 授权、列表计划、启停计划
- 本地定时规则（时间 + 重复日）自动执行
- 飞书长连接机器人：`状态` / `列表` / `暂停 xxx` / `恢复 xxx`
- 运行日志与执行记录
- **手机端**：同一 Wi-Fi 下用手机打开控制台，实时看数据 / 开关计划 / 改投放时段
- **登录**：账号密码 + 邮箱验证码（4 位），任意邮箱可用；会话长期有效，只有主动退出才失效

## 环境要求

- Node.js 18+（推荐 20+）
- Windows / macOS / Linux

## 安装与启动

```bash
npm install
npm start
```

启动后控制台会打印手机访问地址，例如：

```text
  CASEBANG 手机端服务
  本机:   http://127.0.0.1:5173
  手机:   http://192.168.88.4:5173   (同一 Wi-Fi)
```

手机与电脑连**同一个 Wi-Fi**，用手机浏览器打开 `http://<电脑IP>:5173` 即可；界面是移动版
（底部标签栏、单列卡片、大触控开关），数据与桌面端实时同步（SSE 推送 + 15s 轮询）。

电脑不开图形界面、只跑调度 + 手机端时：

```bash
npm run mobile
```

> 页面直接双击打开（`file://`）时连不上电脑端，会自动降级为**演示模式**（数据与开关不生效）。

## 装成手机 APP

控制台带 PWA 支持（`manifest.webmanifest` + `sw.js`），手机浏览器打开后可安装成独立应用，
有桌面图标、全屏运行、无地址栏：

- **Android / Chrome**：打开控制台 → 菜单 → 「安装应用 / 添加到主屏幕」
- **iPhone / Safari**：打开控制台 → 分享 → 「添加到主屏幕」

安装后从桌面图标启动，登录态与浏览器共用（同一存储），只有主动退出登录才失效。
Service Worker 采用**网络优先**策略：`/api/*` 永不缓存，页面始终是最新代码，离线时才回退到缓存外壳。

## 登录

手机 / 浏览器打开控制台会先看到登录页，两种方式二选一：

- **密码登录**：未配置发信渠道时，任意邮箱填好密码即可直接创建账号；配了 SMTP 后新邮箱须先用验证码验证归属
- **邮箱验证码**：服务端发 4 位数字码，5 分钟有效，60 秒发送冷却，单邮箱每日 20 封，同一条码错 5 次作废

登录成功后 token 存在浏览器本地，**长期有效**——关页面、刷新、隔天再开都不会掉线，
只有在「连接状态 → 退出登录」才会失效。桌面端（Electron）走本机 IPC，不经过登录页。

「连接状态」页可以查看当前账号并退出登录。

### 在外网访问（Tailscale）

控制台默认只在同一局域网可达。人在外面用数据网络时，装 Tailscale 组虚拟内网即可：

1. 电脑：`winget install tailscale.tailscale`，登录 https://login.tailscale.com
2. 手机：装 Tailscale App，用**同一个账号**登录
3. 手机访问 `http://100.x.x.x:5173`（`tailscale ip -4` 查电脑地址）

## 配置

编辑项目根目录 `.env`：

| 变量 | 说明 |
|------|------|
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | TikTok for Business 开发者应用 |
| `TIKTOK_REDIRECT_URI` | 默认 `http://localhost:17890/callback`，需与后台「广告主重定向URL」完全一致 |
| `TIKTOK_ADVERTISER_ID` | 可选，也可在界面填写 |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | 飞书自建应用 |
| `FEISHU_ALLOWED_OPEN_IDS` | 允许操作的飞书 open_id，逗号分隔；**上线前务必配置** |
| `PORT` | 手机端服务端口，默认 `5173` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | 邮箱验证码发信；**留空 = 验证码登录不可用**（密码登录不受影响）。`SMTP_PASS` 填邮箱的「授权码」而非登录密码 |

设 `MOCK=1` 可强制走演示模式（不真实调用 TikTok）。

## TikTok 后台检查清单

1. 打开 https://business-api.tiktok.com/portal/
2. 确认应用已创建，拿到 `client_key` / `secret`
3. **广告主重定向 URL** 添加（与 `.env` 完全一致）：`http://localhost:17890/callback`  
   - 不要填进「TikTok 账号持有人重定向 URL」（那栏必须 https）
4. 权限：至少需要广告读写相关 scope（以门户显示为准）
5. 授权时选择你的广告账户，或在界面填写 `advertiser_id`
6. 确认账号内存在 **直播 GMV Max** 计划：
   - 列表：`gmv_max/campaign/get/`，`filtering.gmv_max_promotion_types=["LIVE_GMV_MAX"]`（分页参数 `page` / `page_size` 放 query）
   - 开关：`campaign/status/update/`（`operation_status` = `ENABLE` / `DISABLE`）
   - 注意：`campaign/update/` **不能**改 GMV Max 计划（会返回 `GmvMax ads cannot be edited by this API`）

> 若 `gmv_max/campaign/get/` 里看不到直播计划，说明该账户未开通 GMV Max 或未授权对应 TikTok Shop，需要在商家中心确认后再试。

## 飞书后台检查清单

1. 打开 https://open.feishu.cn/app → 你的应用
2. 启用 **机器人** 能力
3. 权限：`im:message` 发送、接收单聊/群聊@ 消息相关权限（以控制台为准）
4. 事件订阅方式选择 **长连接（WebSocket）**，订阅 `im.message.receive_v1`
5. 发布版本并让机器人可用
6. 把你的 `open_id` 填入 `.env` 的 `FEISHU_ALLOWED_OPEN_IDS`

## 飞书指令

```text
帮助
状态
列表
暂停 直播计划A
恢复 直播计划A
```

## 安全说明

- `.env` 已在 `.gitignore` 中，请勿提交密钥
- 曾明文粘贴过的密钥建议尽快在对应后台 **重置/轮换**
- 桌面端需尽量保持开机在线，定时规则才可靠
- 手机端服务监听 `0.0.0.0`（整个局域网可达）：**只在可信网络使用**，公共网络请设置 `APP_TOKEN`

## 目录

```text
index.html / styles.css / app.js   界面（桌面 + 手机自适应）
main.js / preload.js               Electron
lib/api-server.js                  局域网 HTTP 服务（静态页 + /api + SSE）
lib/tiktok.js lib/feishu.js        外部集成
lib/scheduler.js                   定时调度
data/                              运行数据与日志
.env                               密钥
```
