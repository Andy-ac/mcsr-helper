# 架构总览

> 这份文件写给**第一次看这个仓库的人**：它讲这个项目是什么、由哪些部分组成、
> 一次页面请求与一次部署分别经过谁、配置放在哪里、**少了哪一项会坏成什么样**。
>
> 它**不讲**"我们踩过哪些坑" —— 那些留在 `docs/` 里的过程记录中（`v1-plan.md` 说为什么这么设计，
> `pending.md` / `progress.md` 是维护者的工作台账）。这里只讲**现在成立的事实**。
>
> 想自己部署：看 `deploy/README.md`；想读代码：先看本文第 2 节。

---

## 1. 这个产品是什么

**MCSR Helper** 是给 Minecraft 速通（MCSR）社区用的一个聚合站点：资源库 + 赛事日历 +
Ranked 排行与直播看板 + 视频/直播追踪。它自己**不生产内容** —— 做的是把社区已有的东西
（资源链接、赛事信息、Ranked 榜单、各平台直播与视频）整理成一处能查、能筛、能订阅的样子。

两个前端载体，**同一套代码**：

| 载体 | 形态 | 说明 |
|---|---|---|
| 浏览器 | React SPA + 我们的 API | 主形态。Caddy 直接发静态产物，`/api/*` 反代到 Node |
| Windows 桌面端 | Electron 壳 | 加载**线上同一个源**（不是打包一份离线副本），带自动更新 |

后端 = 一个 Hono HTTP 进程（监听 `127.0.0.1:3001`）+ 一个 SQLite 文件 + 三个 systemd 定时作业。
**没有**常驻的消息队列、缓存服务或外部数据库。

几个贯穿全仓的口径，先记住，读代码时会一直遇到：

- **拿不到的值一律存 `NULL`，绝不许填 0** —— `0` 看起来像一条真实数据，比空值危险得多。
- **Minecraft 种子是字符串，永远不要变成 `number`** —— 64 位整数用 `Number` 会**静默截断**。
  规则与理由写在 `packages/shared/src/seed.ts` 顶部。
- **上游域名只出现在一个文件里** —— 见 `packages/shared/src/ranked/const.ts` 的文件头。
- **读接口与写接口的形状不同**：写入走"提交 → 待审修订 → 发布"（第 4 节）。

---

## 2. 仓库结构：五个包，各自管一件事

`pnpm-workspace.yaml` 圈定 `apps/*`、`packages/*`、`services/*`：

```
mcsr-helper/
├─ apps/
│  ├─ web/          React 19 + Vite 8 的 SPA —— 唯一的前端产物（浏览器与 Electron 共用）
│  └─ desktop/      Electron 主进程 + preload + 自动更新 + NSIS 打包
├─ services/
│  └─ api/          Hono 4 + node:sqlite —— HTTP API，外加 5 个 systemd 跑的 CLI 入口
├─ packages/
│  ├─ shared/       类型、常量、zod 契约、i18n 词典、种子与 Ranked 领域逻辑
│  └─ ui/           两个共享组件（刻意保持极小）
├─ deploy/          Caddyfile、systemd 单元、一键部署脚本
├─ content/         resources.json（部署时导入的资源种子）+ file-catalog.json（**不导入**，接口每次请求现读）
├─ docs/            设计文档、事实表与维护者台账
└─ scripts/         开发辅助脚本（如按端口清理孤儿 dev server）
```

| 包 | 名字 | 职责 | 依赖 |
|---|---|---|---|
| `apps/web` | `@mcsr/web` | 全部界面。`src/routes/` 是路由页，`src/components/` 是组件，`src/lib/api.ts` 是同源 API 客户端，`src/lib/rankedDirect.ts` 是**浏览器直连上游**那一层（见 §3.3）。字体自托管，不引外链 | `@mcsr/shared`、`@mcsr/ui` |
| `apps/desktop` | `@mcsr/desktop` | Electron 主进程、preload、`electron-updater` 自动更新、NSIS 安装包 | `@mcsr/shared` |
| `services/api` | `@mcsr/api` | HTTP API（`src/routes/` 16 个路由模块）+ 数据层（`src/db/`，含迁移）+ 采集适配器（`src/tracking/`）+ 鉴权（`src/auth/`）+ 发信（`src/email/`）+ 5 个 CLI 入口（`admin-cli.ts` / `import.ts` / `track.ts` / `ranked-streams.ts` / `live-status.ts`） | `@mcsr/shared` |
| `packages/shared` | `@mcsr/shared` | 前后端**共享的那份契约**：类型、常量、zod schema、`i18n/zh-CN.ts` 与 `i18n/en.ts`、权限矩阵（`src/permissions.ts`）、Ranked 与种子的纯逻辑。**以 TypeScript 源码形式被引用**（靠 `exports` 暴露子路径），所以**没有构建步骤** | 只有 `zod` |
| `packages/ui` | `@mcsr/ui` | 两个共享组件 + barrel | `@mcsr/shared` |

构建产物只有一个来源：`apps/web` 用 Vite，`services/api` 用 esbuild（`build.mjs`，
先清空 `dist/` 再打 6 个入口 —— HTTP 服务 + 5 个 CLI）。`packages/shared` 与 `packages/ui`
不产出 `dist/`，服务端与前端都直接吃源码，所以**它们的改动不需要额外构建步骤**。

---

## 3. 运行时：一次页面加载经过了谁

### 3.1 全貌

```
访客浏览器 / Electron
   │  HTTPS
   ▼
Caddy（:443，自动 Let's Encrypt）           ← 站点安全头都在这里定义
   ├─ handle /api/*      → reverse_proxy 127.0.0.1:3001   （我们的 Hono API）
   ├─ handle /installer/* → file_server  /srv/mcsr-helper/releases  （Electron 安装包 + 更新源）
   └─ handle（其余全部）  → file_server  /srv/mcsr-helper/web，try_files {path} /index.html
   ▼
React SPA 启动 → 按路由取数 →（有的是同源 /api，有的是浏览器直连上游，见 §3.3）
```

两处细节值得单独点名，因为它们都是**故意的**：

- **Node 进程只服务 `/api/*`**：`services/api` 里没有任何静态文件中间件，未匹配的路径
  一律落成 JSON 404（`services/api/src/index.ts` 的 `notFound`）。静态产物由 Caddy 发。
- **`Referrer-Policy` 不能改**：YouTube 要求嵌入客户端通过 `Referer` 头标识自己，
  抑制它会触发 `Error 153`，三个平台的播放器会直接播不出来。这个策略写在
  `apps/web/index.html` 与 `deploy/Caddyfile` 两处，都有注释说明原因。
- **CSP 只在一个地方定义**：`deploy/Caddyfile`。Hono 侧刻意不设 CSP —— 免得两处打架。

### 3.2 我们的 HTTP API（`services/api`）

Hono 应用，`src/index.ts` 里挂全局中间件链，顺序是：

1. `logger()`（`NODE_ENV=test` 时整条跳过）
2. `secureHeaders()`（Hono 默认表）
3. **内存级全局限流**：60 秒窗口 / 240 次，按 `x-forwarded-for`（退 `x-real-ip`）分桶，
   超限回 `429 {"error":"rate_limited"}` + `Retry-After`
4. **默认 `Cache-Control: no-store`**：想公开缓存的端点必须自己覆写（例如资源列表用 60 秒）
5. **`sameOriginOnly`（CSRF 第二层）**：只对会改状态的方法生效；带了 `Origin` 就必须同源
6. **`loadUser`**：读 `mcsr_session` cookie → 查未过期会话 → 挂到上下文。**它不拦截请求**

端点规模与访问模型：**共 90 个端点**（`src/routes/` 里 88 个 + `src/index.ts` 内联 2 个），
其中 **34 个匿名可读、56 个要登录或要有某项能力**。能力（capability）矩阵在
`packages/shared/src/permissions.ts`：

| 角色 | 能力 |
|---|---|
| `user` | 提交资源/日历/视频/种子、改自己的东西 |
| `reviewer` | user + 审核资源/日历/种子、读审计 |
| `editor` | reviewer + 精选、下架、编辑未发布内容、维护直播与视频名单 |
| `admin` | editor + 管理用户 |
| `owner` | 能力集与 admin **相同**，多出来的是"等级"而不是能力（`canHardDelete`） |

少数能力**额外要求邮箱已验证**（`REQUIRES_VERIFIED`）；`content.author` 故意不在其中。

会话 cookie：`httpOnly` + `sameSite=Lax` + 生产环境 `secure` + 30 天滑动过期。
错误契约是一层扁平的 `{error: "..."}`，校验失败再带 `issues: [{field, message}]`。

### 3.3 ★ 哪些调用走浏览器直连、哪些走我们的服务器代理（这是本仓最值得读的一段）

**同一个前端里，对上游的请求走了两条完全不同的路**，而且两条都有明确的、非风格性的理由：

| 上游 | 走哪条 | 为什么 |
|---|---|---|
| `api.mcsrranked.com` / `mcsrranked.com`（Ranked 的四个面板） | **浏览器直连** | 上游限流是 **500 次 / 10 分钟 / 访客 IP**。让每个访客花**自己的**额度，服务器那个唯一出口 IP 就几乎全空着 —— 只有状态心跳用它 |
| `status.mcsrranked.com`（状态栏心跳） | **我们的服务器代理**（`GET /api/ranked/status`） | 这个上游**不发 `access-control-allow-origin`**，浏览器物理上读不到它的响应。这是唯一一个**被逼出来的**例外，不是设计偏好。代价是它花我们的 IP 额度，所以端点做了单飞 + 30 秒 TTL + 最多 10 分钟 stale 兜底 + 每 IP 60/分钟 |
| Ranked 种子服务（`MCSR_SEED_API_BASE`） | **我们的服务器代理** | 上游是**明文 HTTP**。https 页面永远 fetch 不到它（混合内容，必然失败），所以只有"浏览器 → 我们（同源 https）→ 上游（http）"这一种形状。代理因此必须自己担起**限流**与**超时** |
| YouTube / Twitch / bilibili 的**播放器** | **浏览器直连**（iframe） | 第三方播放器只能由浏览器加载；允许谁由 CSP 的 `frame-src` 白名单决定 |
| YouTube / Twitch / bilibili 的 **API** | **只在服务器侧** | 由 §5 的定时作业与 `/api/tracking/*` 调用，**从不从页面调用**（凭据不能进浏览器） |

配套的三条硬规则（写在 `apps/web/src/lib/rankedDirect.ts` 的注释里，是这个设计的组成部分）：

- `cache: 'no-store'` —— 上游会回 4 小时的 `Cache-Control`，不强制关掉的话"实时"面板
  会静默冻在 4 小时前的数据上，而且网络面板里**连请求都看不到**。
- **只用 CORS 安全列表内的头** —— 任何自定义头都会触发 `OPTIONS` 预检，而那条预检的响应
  从来没验证过，失败时的症状看起来像"网络问题"。
- `credentials: 'omit'` + `referrerPolicy: 'no-referrer'`。

这个选择是**公开承认代价**的：这三条直连的失败**我们一条都看不见**（不进我们的日志），
所以界面上的错误文案必须写得很具体；访客的 IP 会直接到达第三方；并且**不做**服务端兜底
（"失败就回退到我们的代理"被明确否掉了 —— 那等于把刚否掉的代理又建回来，
而且是一条几乎没人走过的代码路径）。

CSP 与这个决定是同一个决定的两次表达：`deploy/Caddyfile` 的 `connect-src` 里枚举了那两个
直连域名 —— 也就是说，"允许浏览器直连"在服务器配置里也是显式的。

---

## 4. 数据模型（高层）

一个 SQLite 文件（默认 `services/api/data/mcsr.db`，生产由 `DB_PATH` 指定）。
**库由 API 进程在启动时创建并迁移**：`src/db/index.ts` 调 `src/db/migrate.ts`，
迁移脚本在 `src/db/migrations/`（编号递增，目前到 `023_*`），已跑的记录写在 `_migrations` 表里。
⇒ **"重启 API"就等于"应用迁移"**，部署脚本不需要单独跑迁移。

19 张表，按职责分五组：

| 组 | 表 | 说明 |
|---|---|---|
| 内容与修订 | `resources`、`resource_revisions`、`content_revisions`、`content_contributors` | 公开读的是**已发布的修订**；写入是"提交 ⇒ 产生一条待审修订"，审核后才发布。所以"编辑"从不直接改已发布的内容 |
| 账号与审计 | `users`、`sessions`、`email_tokens`、`audit_log` | 审计表**没有外键** —— 这是**故意**的：审计轨迹不该因为账号被删而消失 |
| 互动 | `resource_marks`、`uploads` | 收藏/评分；上传的图片落盘在 `data/uploads/`，库里只存路径 |
| 日历 | `calendar_events`、`calendar_series` | 一场赛事可以有多段时间（JSON 数组），原来那 6 个时间列退化成**派生包络**；系列是一等实体，带颜色键 |
| 视频与直播 | `videos`、`live_channels`、`user_live_links`、`live_shares`、`tracked_creators`、`tracked_videos` | 分两条路：**用户自贴**（只存平台 + 视频 ID + 手填标题）与**服务器追踪**（存抓来的标题/封面/时长/播放量/评论数，另有一张冷却表字段） |

两条与"删数据"有关的既有口径，写在这里以免有人重新推导：

- **级联是被设计过的**：会话、邮件令牌、收藏都 `ON DELETE CASCADE`；
  上传物是 `ON DELETE SET NULL`（图片留下，上传者变空）；而 `resources` /
  `resource_revisions` **没有外键** —— 内容不会跟着账号消失，但会留下悬空的 `author_id`。
  真要删账号，必须**同时**把这些内容的作者字段置空，否则界面会显示不出作者。
- **种子是 `TEXT`**，不是整数（见第 1 节）。

---

## 5. 三个后台作业

三个都在 `deploy/` 里成对出现（`.service` + `.timer`），形态完全一致：
`Type=oneshot`、`User=mcsr`、`ExecStart` 外面套一层 `flock -n`（锁文件在各自的
`RuntimeDirectory=/run/mcsr-helper-<job>` 下）、输出进 journald。

| 单位 | 节奏 | 做什么 | 要不要凭据 |
|---|---|---|---|
| `mcsr-helper-track` | `OnCalendar=*:0/10`（10 分钟） | **追踪视频同步**。遍历追踪名单，先全量回填、再增量、再核对过期；每轮有上限（回填/翻页/增量/核对各自封顶）。有失败就以非 0 退出 —— 这是**预期形状**，不是故障 | 需要 `track.env`（YouTube/Twitch）；**bilibili 不需要任何凭据** |
| `mcsr-helper-ranked-streams` | `*:0/5`（5 分钟） | 打一次 Ranked 的 `/live`，把其中的 Twitch 直播**插入** `live_channels`（只插不更新） | **刻意不挂 `EnvironmentFile`** —— 它一个凭据都不需要 |
| `mcsr-helper-live-status` | `*:0/3`（3 分钟） | 查 Twitch `helix/streams`（一次最多 100 个 login）与 bilibili 的房间接口，把 `is_live` / `viewer_count` / `live_checked_at` 一次事务写回 | 需要 `track.env`（Twitch app token） |

三个 timer 都设了 `Persistent=true` 与 `RandomizedDelaySec=30`。**timer 与 service 靠同名配对**
（没有声明 `Unit=`），所以改名字的时候必须两边一起改。

`flock` 不是装饰：`Type=oneshot` + timer **不保证**上一轮跑完了，而 SQLite 的
`busy_timeout` 会让重叠的进程排队而不是报错 ⇒ 没有锁就会出现"同一页被处理两次"。
`RuntimeDirectory` 也是必需的 —— `/run` 是 tmpfs，重启后目录会消失，所以锁目录由 systemd 每次启动创建。

另外注意：**同一个 `track.env` 被一个常驻进程（API）和两个 oneshot 作业一起读**。
改完它必须 `systemctl restart mcsr-helper-api`（`EnvironmentFile` 只在进程启动时读），
否则会出现"作业里 `youtube ok`、管理面板却回 `503 platform_not_configured`"这种自相矛盾的状态。

---

## 6. 部署是怎么做的

一条命令：`bash deploy/deploy.sh`（首次加 `--bootstrap`）。脚本在 `deploy/` 里，卷宗在 `deploy/README.md`。

**本地阶段**

1. 读 `deploy/deploy.env`（**没有就拒绝运行**）并 `source`，所以里面的变量都变成环境变量。
   必需 `MCSR_SSH_HOST` 与 `MCSR_DOMAIN`；`MCSR_LEGACY_DOMAIN` **默认为空**，
   而空 = 不生成旧域名的 301 片段（Caddyfile 那一处是 `import` 一个空 glob，
   空 glob 不是错误）、并把上次留下的陈旧片段删掉；显式给了值才生成。
2. **在本地构建**（`@mcsr/web` + `@mcsr/api` 两个包，**不在服务器上构建**）：产物加起来不到 5 MB，
   而服务器通常很小，在上面跑 Vite 又慢又吃内存。
3. 打两个 tar 包，`--with-installer` 时再带上 Electron 安装包（`latest.yml` 必须**先于**
   那个 `.exe` 上传，否则会有一个"更新源指向还不存在的文件"的窗口）。

**上传 + 远端阶段**（一段以 root 执行的 heredoc）

4. 域名通过 systemd drop-in 注入 Caddy，所以它**每次部署都要重新同步**；drop-in 变了要
   `restart`（`reload` 只重读 Caddyfile，不重读进程环境）。
5. Caddyfile 永远安装，且**带 `MCSR_DOMAIN` 环境变量**先 `caddy validate`，再 `reload`。
   校验失败就保留旧配置继续跑，并打印错误尾巴。
6. 前端产物**原子替换**：解到 `<WEB_DIR>.new` → 旧的挪开 → 换进来 → `chown`。
   解包失败不会留下半张站点。
7. API 产物**直接解压覆盖** `${API_DIR}`（**不清理**旧文件 —— 所以旧版本遗留的入口文件会一直在，
   改过入口名之后要留意）。
8. 7 个 systemd 单元与 Caddyfile 都先用 `cmp` 比对再安装，变了才 `daemon-reload`；
   三个 timer **无条件** `systemctl enable --now`，**不吞错误** —— timer 起不来的话这个功能
   永远不会跑，而"部署成功"就成了假话。
9. 导入 `content/resources.json`（**以 `mcsr` 用户、带显式 `DB_PATH`** 跑 `import.js`）。
   用 `mcsr` 而不是 root 不是形式主义：root 跑出来的 `-wal`/`-shm` 归 root，
   之后服务就**静默写不进去**。这一步失败**不致命**（沿用现有数据继续启动）。
10. 重启 API，`sleep 1`，断言 `is-active`；失败就打印 `journalctl -u … -n 30` 并以非 0 退出。
    最后本机 `curl /api/health`。设了 `MCSR_HEALTHCHECK_URL` 时再做一次公网自检
    （用 `--resolve` 把域名钉到服务器 IP，绕开本地 DNS 污染与 NAT hairpin）。

**它明确不做的事**（都是读出来的，不是猜的）：不跑测试；不在服务器上构建；**不建库**
（由 API 启动时建并迁移）；**不创建/管理密钥文件**（只发 `.env.example`，真文件要手动放一次）；
**自己不含任何密钥**；**不备份、也不装备份计划**；不清理 `${API_DIR}` / `${WEB_DIR}` 的历史文件；
不删旧安装包、不删旧备份；不校验部署产物与本地构建是否一致（只做健康检查）。

**服务器上的目录形态**

```
/srv/mcsr-helper/
├─ api/        构建产物（server.js + 5 个 CLI）+ data/（mcsr.db、backup-*.db、uploads/）
├─ web/        SPA 静态产物
├─ content/    resources.json（部署时导入）+ file-catalog.json（不导入，`GET /api/file-catalog` 每次请求现读）
└─ releases/   Electron 安装包 + latest.yml（Caddy 在 /installer/* 对外发）
/etc/mcsr-helper/     密钥文件（0600 root，见 §7）
/etc/systemd/system/  7 个单元 + Caddy 的 drop-in
/run/mcsr-helper-{track,ranked-streams,live-status}/  各作业的 flock 锁
```

**仓库与服务器的分工**很清楚：**代码与配置**在仓库里，服务器的副本应当与仓库逐字节相同
（`deploy.sh` 每次部署都会重新同步）；**状态与密钥**只在服务器上（数据库、上传物、备份、安装包、日志）；
**构建产物与临时文件**只在本地。⇒ 服务器上没有 `node_modules`，`packages/` 也不存在。

---

## 7. 配置放在哪

分三层，**名字都能在仓库里看到，值都不在仓库里**。

### 7.1 部署机上的 `deploy/deploy.env`（gitignored，模板 `deploy.env.example`）

| 变量 | 作用 |
|---|---|
| `MCSR_SSH_HOST` / `MCSR_SSH_PORT` / `MCSR_SSH_KEY` | 部署目标与私钥路径 |
| `MCSR_DOMAIN` | 站点域名（同时进 Caddy 的 systemd drop-in） |
| `MCSR_LEGACY_DOMAIN` | 旧域名的 301 源。**默认为空 = 不生成**；自建部署应该留空，而不是把别人的旧域名继承过来 |
| `MCSR_WEB_DIR` / `MCSR_API_DIR` / `MCSR_API_SERVICE` | 服务器路径与单元名 |
| `MCSR_BOOTSTRAP` | 是否允许首次初始化（装 Node、Caddy、建用户与目录） |
| `MCSR_HEALTHCHECK_URL` | 部署后的公网自检地址（可选） |

### 7.2 服务器上的密钥文件（**手动创建，0600 root**）

| 文件 | 变量 | 谁读它 |
|---|---|---|
| `/etc/mcsr-helper/mail.env` | `RESEND_API_KEY` | API 进程（发信） |
| `/etc/mcsr-helper/track.env` | `MCSR_YOUTUBE_KEY`、`MCSR_TWITCH_ID`、`MCSR_TWITCH_SECRET` | **API 进程 + track + live-status 两个作业** |

0600-root 是刻意的：systemd 以 root 读文件、把变量交给以 `mcsr` 跑的子进程，
所以**服务自身读不到这些值** —— Web 服务被攻破也拿不到长期凭据。
`ranked-streams` 连 `EnvironmentFile` 都没有，它的爆炸半径是零。

### 7.3 进程环境（`services/api`）

| 变量 | 作用 | 少了/错了会怎样 |
|---|---|---|
| `PORT` / `HOST` | 监听端口/地址 | 默认 `3001` / `127.0.0.1`（Caddy 硬编码反代到 3001，不是就没有 `/api`）；设成 `0.0.0.0` 等于绕过 Caddy 的 TLS，别这么干 |
| `NODE_ENV` | 模式开关 | 不设 ⇒ 会话 cookie **丢掉 `Secure`** |
| `DB_PATH` | SQLite 文件位置 | 默认 `./data/mcsr.db`；每个单元都显式指定 —— 路径一变就是"另一个空库"，症状是"数据全没了" |
| `UPLOAD_DIR` | 上传图片根目录 | 默认 `./data/uploads`；**必须**落在单元的 `ReadWritePaths` 之内，否则写不进去 |
| `MCSR_RELEASES_DIR` | 读 `latest.yml` 的位置 | 没有它 ⇒ `/api/desktop/release` 404，首页不显示下载入口（这是正常状态，不是错误） |
| `MCSR_CONTENT_DIR` | 读 `file-catalog.json` 的位置（桌面端「本地文件」那一栏的条目来源） | 默认 `/srv/mcsr-helper/content`；**只在本地开发/测试时**指到别处（`file-catalog.test.ts` 就是靠它造坏目录）。文件不在 / 内容不合法 ⇒ `GET /api/file-catalog` **500**（不是空目录 —— 空目录的表现是"界面上什么都没有"，没人会去查原因） |
| `content/mod-catalog.json` | mc.sr 的 mod 目录（`GET /api/mod-catalog` 的条目来源） | schema 2 / 70 个 mod / 555 条 release；**由 `services/api/scripts/build-mod-catalog.mjs` 从 `content/upstream/` 的快照 + `content/mod-overrides.json` 生成**，手改它会被下一次 `--check` 判红；文件不在 / 内容不合法 ⇒ **500**（不是空目录）。⚠️ 仓库里这一份与 `content/upstream/` 被 `biome.json` 的 `files.includes` **排除在格式化之外**（`!**/mod-catalog.json`、`!**/upstream`）：它们是**机器产物 / 上游快照，字节由来源决定**（生成物要能重新生成后逐字节相等，快照要能逐字节等于上游响应），所以格式化检查对它们不成立；手写的那几份（`content/resources.json`、`content/file-catalog.json`、`content/mod-overrides.json`）**仍然被检查** |
| `MCSR_PUBLIC_ORIGIN` | 邮件里验证/重置链接的绝对前缀 | 错了 ⇒ 链接指向错误的主机；而 cookie 是 host-only，用户会"看起来没登录" |
| `MCSR_MAIL_DRIVER` | `resend` / `file` / `console` | **默认 `console`**：邮件只打进 journald。见第 8 节第 1 条 |
| `MCSR_MAIL_FROM` / `MCSR_MAIL_FROM_NAME` / `MCSR_MAIL_DIR` | 发信人地址/显示名/`file` 驱动的输出目录 | 用 `resend` 而 `MCSR_MAIL_FROM` 未设 ⇒ 启动时告警，且 `@localhost` 发信人会被拒或进垃圾箱 |
| `MCSR_YOUTUBE_KEY` / `MCSR_TWITCH_ID` / `MCSR_TWITCH_SECRET` | 采集凭据 | 三个都是可选的：**空字符串等于没配**。没配的平台**跳过并打印原因**（退出码 0），不是崩。注意 Twitch 的 id 与 secret 必须成对 |
| `MCSR_SEED_API_BASE` | Ranked 种子上游基址 | **没有默认值**：不配就整栏返回 `503 seed_not_configured`（一句明确的话，不是 500）。上游是明文 HTTP，本仓不再指向任何具体地址 |
| `MCSR_SEED_TIMEOUT_MS` | 种子上游超时 | 默认 15 秒；调小会把上游本来就慢的查询（实测 3–8 秒）判成失败 |
| `MCSR_SEED_WRITE_ENABLED` | 种子**写**路径的开关 | **默认关**：不开就 `POST /api/ranked-seeds/save` 在鉴权**之前**回 `503`。⚠️ 只有在自己配了 `MCSR_SEED_API_BASE`、且确认那个库是你自己的之后，才该打开它 |
| `MCSR_RANKED_STATUS_URL` / `_TIMEOUT_MS` / `_TTL_MS` | 状态页心跳上游 / 超时 / 缓存 TTL | TTL 默认 30 秒并被夹到 ≤10 分钟（再大就会把"过期数据说成实时"，那是这个端点唯一禁止的形状） |
| `MCSR_RANKED_LIVE_URL` / `_TIMEOUT_MS` / `_TTL_MS` | `ranked-streams` 作业的上游 / 超时 / 缓存 | 上游不可达 ⇒ 这一轮失败，直播名单不再增长 |
| `MCSR_SCRYPT_TEST_PARAMS` | 降低密码哈希强度 | **只在 `NODE_ENV=test` 下生效**，且只能降不能升 —— **永远不要在生产设它** |

**没有任何凭据是"启动必需"的**：唯一会让进程直接退出的原因是文件系统/数据库不可用
（`getDb()` 失败）。所有凭据问题都退化成"那个功能不可用 + 启动时告警"。

前端只有一个变量：`API_TARGET`（Vite dev server 的 `/api` 代理目标，**仅开发期**，
生产路由由 Caddy 决定）。**没有 `VITE_*` 变量。**

---

## 8. 自建部署最容易搞错的三件事

1. **选了邮件驱动就以为完事了。** 默认驱动是 `console`，所以一次全新部署**看起来是健康的** ——
   注册返回 200、启动日志干净 —— 但验证邮件从来没发出去；而登录口径要求"邮箱已验证"，
   于是**每一个新账号都被永久锁在门外**。发信失败只是告警，注册在没有邮件时也回同一个 200，
   所以日志和界面都不会说"你的站点没有可用的邮件"。
2. **只改一处域名。** 站点源出现在 `packages/shared/src/constants.ts`（会被编进 SPA **和**
   Electron 壳）、Caddy 站点块用的是 `{$MCSR_DOMAIN}`、邮件链接回落 `MCSR_PUBLIC_ORIGIN`、
   浏览器直连那一组还被 CSP 的 `connect-src` 钉着。改一半的典型症状是：
   cookie 是 host-only，于是用户在第二个域名上"看起来没登录"。
3. **以为默认指向的那些东西会为你存在。** 种子服务**没有默认值**了（`MCSR_SEED_API_BASE`
   不配就整栏 503，写路径也默认关着），但另两处仍是别人的：桌面端更新源
   （`apps/desktop/electron-builder.yml` 的 `publish.url`，指向本仓作者的站点）、
   以及邮件链接与 Electron 壳用的站点源（`packages/shared/src/constants.ts`）。
   这两处不换，你的自建部署会指向别人的站点（更新源尤其明显：它会提示用户去下载别人的安装包）。

---

## 9. 数据来源与许可

- **运行时上游**（都在 §3.3 的表里）：MCSR Ranked 的公开 API 与状态页、YouTube Data API v3、
  Twitch Helix、bilibili 的公开 web 接口、以及一个可配置的 Ranked 种子服务。
  bilibili 那一路按上游的要求做握手与签名（实现见 `services/api/src/tracking/bilibili.ts`）；
  失败会以 `-352` / `412` 的形状回来，我们按"退避重试 + 按博主冷却"处理，
  **出口 IP 被挡是已知的运行状况**，只能等或换出口。
- **字体**：自托管的 CJK 像素字体，许可原文在 `apps/web/src/fonts/OFL.txt`（SIL OFL 1.1），
  加粗字面来自另一个上游 —— 出处写在 `apps/web/src/styles.css` 的注释里。
- **图标**：`apps/web/public/icons/` 下是各站点图标的**自托管**副本（不是热链），
  逐个标注了来源、并说明商标仍归各站点所有、按指名性使用；见该目录的 `README.md`。
- **赛事日历里的历史数据**：15 场历史赛事（MCSR Ranked Playoffs / Midoffs）的起止日期、
  奖金池与部分比赛日**取自 Liquipedia** 的页面 infobox 字段。Liquipedia 的内容按其自己的
  版权条款发布，署名与相同方式共享的要求见其
  [`Liquipedia:Copyrights`](https://liquipedia.net/liquipedia/Liquipedia:Copyrights)
  —— 再使用者请自行核对并满足那份条款。**本仓库里没有任何 Liquipedia 的正文文本**，
  只有从 infobox 抽出的**事实性字段**；那段抽取的过程记录与逐条数据留在 `docs/progress.md` 的
  第十节（C），并在那里附了同一段署名。
- 仓库自身**不含第三方 API 密钥**：`deploy/*.env.example` 里全是占位符。
