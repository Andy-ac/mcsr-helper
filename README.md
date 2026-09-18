# MCSR Helper

MCSR 社区的**资源库 / 日历 / 视频与直播聚合**站点 —— 一个不做内容抓取的公开聚合器，
外加一个装着同一套界面的桌面壳。

> **English one-liner:** a community resource library, calendar, video wall and live
> tracker for Minecraft speedrunning (React SPA + Hono API + Electron shell).
> Code comments and docs are in Chinese on purpose — see [`CONTRIBUTING.md`](CONTRIBUTING.md).

<!-- =========================================================================
     截图占位 —— 发布前请放一张真实截图上来，并把这一段注释删掉。
     ⚠️ 仓库里**现在没有任何截图文件**（这一条是 2026-09-19 开源检查时确认的），
        所以这里是一个**明确标出来的空位**，而不是一张来路不明的图。
     建议放两张：主页（资源库）+ /ranked（实时信息），都放 docs/ 或 .github/ 下。
     ========================================================================= -->
> 📷 **截图占位（本仓库里还没有截图文件）**
> 计划放两张：站点首页（资源库）与 `/ranked` 实时信息页。
> 在你看到这张占位的时候，请直接跑 `pnpm dev:web` 自己看一眼 —— 那比任何截图都准。

---

## 这是什么

一个给 Minecraft 速通（MCSR）社区用的站点：**把散落在各处的东西聚合到一个地方**，
并且尽量不做"我们替你抓内容"这件事（见下面「这个项目不是什么」）。

它同时是：

- 一个**浏览器站点**（React SPA，由 Caddy 提供静态文件 + `/api/*` 反代到后端）；
- 一个**桌面应用**（Electron 壳加载同一个站点，带自动更新 —— 界面只有一份，
  这也是 `apps/web` 是唯一前端产物的原因）。

## 功能

| 栏目 | 有什么 |
|---|---|
| **资源库** `/resources` | 社区提交的外部资源链接（工具 / 网站 / 视频 / 播客…），带分类、标签、平台图标、收藏与个人评分笔记。提交走**审核流程**（送审 → 通过才上架），编辑可以直接发布。 |
| **日历** `/calendar` | 社区赛事与活动：按时间/标签/级别/形式筛选、系列活动（同一系列多次开赛）、详情页，以及一个 **iCalendar 订阅源** `/api/calendar.ics`（日历客户端没有 cookie，所以它是**唯一**不需要登录的订阅入口）。 |
| **视频墙** `/videos` | 用户贴的 B 站 / YouTube / Twitch 链接。**解析链接不发任何网络请求**（见 `packages/shared/src/videos.ts`），播放用点击后加载的嵌入，支持起始时间码。 |
| **追踪的博主**（在 `/videos` 里） | 一份编辑维护的博主名单，由后台作业定时把他们的新视频同步进来（bilibili / YouTube / Twitch 三个平台各自一个适配器），带平台/博主/时间筛选与搜索。 |
| **直播** `/live` | 编辑维护的直播频道清单 + 每个人自己的直播链接；带"正在直播"徽章与**观看人数**（由另一个后台作业每 3 分钟刷新一次）。 |
| **实时分享** `/shares/room`、`/shares/seed` | 联机找人用的看板（房间号 / 种子），有发布额度、过期时间与自动消失 —— 这是本仓第一条"**游客完全看不到**"的内容。 |
| **Ranked 实时信息** `/ranked` | 上游服务状态、正在直播的高分玩家、排行榜、周赛、玩家的 Elo 与对局。 |
| **排位赛种子查询** `/seeds` | 按条件随机抽一条排位赛种子（主世界结构 / 下界结构 / 变种 / 完赛时间），按比赛 ID 查三个世界的种子值与结构详情，以及**补录**入口（写进上游的数据库 —— 见下面「配置」里关于写开关的说明）。 |
| **账号与权限** | 注册 / 登录 / 邮箱验证 / 重置密码；五个角色（user / reviewer / editor / admin / owner）由 `packages/shared/src/permissions.ts` 那张**能力矩阵**统一判定，页面上的按钮与接口上的检查读的是同一张表。 |
| **界面语言** | 简体中文与英文两套词条（`packages/shared/src/i18n/`），英文那一遍有独立的自检。 |

## 技术栈

| 层 | 用了什么 |
|---|---|
| 前端 | React 19 + react-router 8 + Vite 8，i18next 做双语，`rehype-sanitize` 渲染 Markdown。**没有 CSS 框架**（一份 `styles.css`）。 |
| 后端 | Hono 4 + `node:sqlite`（Node 内置，没有 ORM），zod 4 做校验。SQLite 迁移是仓库里的 23 个文件，**由进程启动时自动跑**。 |
| 桌面 | Electron 44 + electron-builder（NSIS 安装包）+ electron-updater。 |
| 定时作业 | 三个 systemd timer：视频同步（10 分钟）、直播链接收录（5 分钟）、直播状态与人数（3 分钟）。 |
| 提交闸门 | TypeScript 7（`tsc --noEmit`）+ `node --test`（约 1,200 条）+ Biome + **十一个渲染自检脚本**。 |
| 部署 | Caddy（HTTPS / 安全头 / CSP）+ systemd + 一个 bash 脚本。**没有容器、没有编排。** |

## 快速开始

```bash
# 前置：Node >= 22.15、pnpm >= 10
node -v && pnpm -v

pnpm install
pnpm dev:web          # Web(5173) + API(3001)，浏览器里开发 ← 平时用这个
```

打开 <http://localhost:5173> 即可。

> ⚠️ **Node ≥ 22.15 这一条是硬的，而且不是 pnpm 替你拦的。**
> 不满足时 pnpm 只打一行 `[WARN] Unsupported engine` 就**照常往下跑**，
> 真正红的是 `services/api/src/ranked-seed-errors.test.ts` —— 它用的 `node:module`
> 的 `registerHooks()` 是 **v22.15.0** 才有的，于是**整个 API 测试套件**在 import
> 那一刻就失败，而错误指向那个测试文件、不指向 node 版本。
> 完整理由（含"它其实不是门禁"这个实测结论）写在根 `package.json` 的 `//engines` 里。

**什么都不配也能跑**：邮件走 console 驱动（不真发信、把邮件写成 `.eml` 文件），
视频追踪在没有凭据时**跳过并打印原因**（不是崩）。

## 仓库结构

```
apps/
  web/          React 前端 —— **唯一**的前端产物（浏览器与 Electron 共用同一套）
                scripts/ 是那十一个渲染自检脚本（web 层唯一的自动化覆盖）
  desktop/      Electron 主进程 + preload + 自动更新 + 打包配置
services/
  api/          Hono HTTP API + node:sqlite；同一个 bundle 里还有三个定时作业的入口
packages/
  shared/       前后端共用的契约：类型、常量、zod schema、双语词条、种子与 Ranked 域逻辑
  ui/           两个共享组件（刻意很少）
deploy/         Caddyfile / systemd 单元 / 部署脚本 / 各种 .env.example（见 deploy/README.md）
content/        随部署导入的初始资源列表（JSON）
docs/           方案、规格与调研事实表。⚠️ 其中一部分是**内部过程记录**，不随公开仓库发布
```

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm dev:web` | **Web + API**（浏览器里开发）← 平时用这个 |
| `pnpm dev` | 上面两个 + Electron 桌面壳 |
| `pnpm dev:api` / `pnpm dev:desktop` | 只起其中一个 |
| `pnpm build` | 构建 web + api + desktop |
| `pnpm build:installer` | 打 Windows 安装包（NSIS） |
| `pnpm test` | 全部测试（`node --test`，约 1,200 条） |
| `pnpm typecheck` / `pnpm lint` / `pnpm format` | 类型检查 / Biome 检查 / 自动修复 |
| `pnpm -w check` | **门禁①**：typecheck + 全部测试 + lint |
| `pnpm -F @mcsr/web check:all` | **门禁②**：上面这些 + 十一个渲染自检 × 两种语言 |
| `pnpm deploy` | 部署到服务器（需先配 `deploy/deploy.env`） |

★ 贡献之前请读 [`CONTRIBUTING.md`](CONTRIBUTING.md)：两道门禁、以及几条
「读代码看不出来但必须守」的规矩（注释要写为什么与代价、绝不为缺失值填 `0`、
每一条断言都必须能红……）。

## 部署

见 [`deploy/README.md`](deploy/README.md)。一句话版本：

```bash
cp deploy/deploy.env.example deploy/deploy.env   # 填域名和服务器
bash deploy/deploy.sh --bootstrap                # 首次
bash deploy/deploy.sh                            # 之后每次
```

⚠️ **这套部署是为"一台具体的服务器"写的，不是通用方案**：它假设
Ubuntu + Caddy + systemd、本地构建后把产物传上去（因为目标机器只有 2 核 2G）、
并且用 root 通过 SSH 操作。自建时**必须逐条读 `deploy.sh` 与 `deploy/README.md`**
（尤其是"域名写在六个地方"这件事），不要直接照搬。

## 配置

环境变量分成三类，**安装位置不一样**，清单与说明在根目录的
[`.env.example`](.env.example)（只有**名字**，没有任何值）。最容易踩的三条：

- **部署机的配置**写进 `deploy/deploy.env`（模板 `deploy/deploy.env.example`）；
- **服务器上的密钥**住在 `/etc/mcsr-helper/*.env`（`RESEND_API_KEY`、
  `MCSR_YOUTUBE_KEY`、`MCSR_TWITCH_ID` / `MCSR_TWITCH_SECRET`），
  它们**不能**写进 systemd 单元 —— 单元文件在版本库里，而且每次部署都会被同步过去；
- **排位赛种子的上游地址**（`MCSR_SEED_API_BASE`）**没有默认值**：上游是**第三方**的机器，
  而补录接口会往那台机器的数据库里写记录，所以"不配"就整组端点回
  `503 seed_not_configured`（而不是悄悄指向某个陌生人的服务器）。
  写入（`MCSR_SEED_WRITE_ENABLED`）**默认关闭**，必须显式打开。

## 许可

[MIT](LICENSE)。社区项目，欢迎按 [`CONTRIBUTING.md`](CONTRIBUTING.md) 提 PR；
安全相关问题请先读 [`SECURITY.md`](SECURITY.md)（**不要开公开 issue**）。

---

## ⚠️ 两条改了会静默出 bug 的规则

这两条不会报错、不会让测试变红，只会在界面上悄悄出错 —— 所以写在这里。

**1. 种子必须是字符串，永远不要变成 number。**
Minecraft 种子是 64 位整数，`Number` 表示不了，会**静默截断**（不报错）。
规则与理由写在 [`packages/shared/src/seed.ts`](packages/shared/src/seed.ts) 顶部。
输入框用 `inputMode="text"`，不要用 `type="number"`（见 `packages/ui/src/SeedInput.tsx`）。

**2. `Referrer-Policy` 不能改成 `no-referrer` / `same-origin`。**
YouTube 要求嵌入客户端通过 `Referer` 头标识自己，抑制它会触发 `Error 153`，
三个平台的视频会直接播不出来。`apps/web/index.html` 与 `deploy/Caddyfile` 里都写了这个策略，
两处都有注释说明原因。

## 这个项目**不是**什么

- **不托管内容。** 视频、直播、种子数据、地图、工具，全部在各自的平台上；
  我们只存链接、元数据与社区自己的日历/资源条目。这也是为什么嵌入播放用的是
  各平台自己的 iframe，而不是把内容搬到我们这边。
- **不是官方的**，与 Mojang、微软、MCSR（Minecraft Speedrunning）官方、
  MCSR-Ranked 上游都没有隶属关系。名字里的 "MCSR" 指的是**社区**。
- **不是通用模板。** 部署脚本与运维细节是给一台具体服务器写的（见上面「部署」）；
  把它当"一键自建 SaaS"用会失望。
- **不是实时数据的源头。** `/ranked` 上的实时信息大多由**访客浏览器直连上游**取得
  （用访客自己的配额，见 `apps/web/src/lib/rankedDirect.ts` 的文件头），
  服务器只代理**不得不**代理的那一个端点（上游不发 CORS 头的那一个）。

---

## 发布前要改的占位符（维护者清单）

仓库里所有指向"这个仓库自己"的 URL 现在都是 `https://github.com/Andy-ac/mcsr-helper`
这种**占位符** —— 真实的仓库地址是 `https://github.com/Andy-ac/mcsr-helper`（改名的话这几处要一起改）：

| 位置 | 字段 |
|---|---|
| `package.json` | `repository.url` / `homepage` / `bugs.url` |
| `apps/web/package.json`、`apps/desktop/package.json`、`services/api/package.json`、`packages/shared/package.json`、`packages/ui/package.json` | 同样三个字段（各自带 `repository.directory`） |
| `deploy/mcsr-helper-api.service` | `Documentation=`（systemd 会显示它，所以占位符会跟着 unit 装到服务器上） |

> 五个 workspace 包都保留 `private: true`，这是**有意**的：它们的 `exports`
> 指向 TypeScript 源码、或者产物是站点/服务器/安装包，都不是能发布到 npm 的库
> （每个包的 `//publish` 里都写了理由）。这个仓库分发的是**源码**。
