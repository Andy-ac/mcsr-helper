# 视频线 + 直播线 · 第 8/9/10 条规格（冻结）

> 这一份是 **2026-09-19 那一轮**（用户第 8、9、10 条）的规格。
> 它**取代**下面两份里与本轮冲突的段落：
> · `docs/tracked-embed-spec.md` §2.2（bilibili 的 `danmaku` / `high_quality`）与 §5.1（`/api/tracking/videos` 的查询参数表）；
> · `docs/calendar-video-rework.md` §B2（「直播」= **只记录 streamer，不新增播放器** + 「记的是频道，不是某一场直播」）。
> 别的段落（数据模型、适配器、核对阶段、部署形状…）**一个字都没改**，照旧以那两份为准。

用户原话（三批，逐字）：

> **8、**「"视频"分区下面"追踪的博主"栏目 b 站视频嵌入的方式改成和上面栏目自己贴的视频相同，
> 目前"追踪的博主"栏目 b 站视频无法全屏、调整弹幕、声音。对于所有的平台去掉"去原站看"这个跳转链接，
> 然后显示视频博主名称。最后将两个栏目"自己贴的视频"和"追踪的博主"分开，在顶部切换」
> **9、**「"视频"分区"追踪的博主"允许用户按时间范围筛选 / 筛选标签 / 筛选时长范围，
> 按时间倒序 / 播放量倒序排列，用下拉框展示所有追踪的博主，允许用户选择某位博主仅查看他的视频」
> **10、**「"直播"分区检测是否正在直播，将正在直播的频道按观看人数递降的顺序排列在前面，
> 并显示观看人数，并允许用户在搜索栏搜索直播」

**一条被用户当场推翻的话**（以后者为准）：第 8 条里"去掉『去原站看』这个跳转链接"——
**保留原样**，博主名称是**额外加上去**的（`ask_user_question` 的答复：「"去原站看"保留原样」）。

---

## §1 第 8 条：嵌入参数与卡片宽度

### 1.1 `danmaku=0` → `danmaku=1`（**一次裁决反转**，连同它的代价）

| | 值 | 依据 |
|---|---|---|
| 改前 | `player.bilibili.com/player.html?bvid=<BV>&autoplay=0&danmaku=0` | 当时的判断是"弹幕默认关" |
| 改后 | `player.bilibili.com/player.html?bvid=<BV>&autoplay=0&danmaku=1` | 播放器页源码 `if (SP.danmaku != null && !SP.danmaku) featureList.add('noDanmaku')`，而播放器核心对那个 feature 直接 `return this.log.i('noDanmaku')` |

**为什么必须翻过来**：`danmaku=0` **不是**"弹幕关闭"，而是**连弹幕数据都不取** ——
玩家看到的"调不了弹幕"是**开关根本不存在**（用户第 8 条报的症状之一）。

⚠️ **代价（认下）**：弹幕默认**开**。想安静看的人要自己关一次；而播放器会不会记住这个选择
**不是我们能控制的**（那在 bilibili 的播放器里，跨站点、跨域）。
⇒ 判据见 §5「仍然没验的事」第 1 条：**这件事只有真浏览器能闭合**。

### 1.2 两个栏目**共用同一条嵌入路径**（本来就共用）

实测（`.superpowers/sdd/videos-live-round/findings.md` §A）：
全站只有一个 `<iframe>`（`apps/web/src/components/ClickToPlayEmbed.tsx`）与一个 URL 构造器
（`packages/shared/src/videos.ts` 的 `buildEmbedUrl`）；自贴墙与追踪栏**都不传 `src`**
⇒ 两条路产出**逐字节相同**的播放器地址与 `allowFullScreen`。

所以第 8 条那一半**不需要新代码**，需要的是**把差异找出来**。真正的差异有两处，都是本轮改的：

1. **`danmaku`**（上面 1.1，两条路共用 ⇒ 一起改）；
2. **卡片宽度**（下面 1.3）。

⚠️ 用户报的第三件事「**追踪那栏不能全屏**」在本仓代码里 **NOT REPRODUCED**
（两条路的 `allowFullScreen` 都在，生产 bundle 也复核过）—— 只能在真浏览器里点一次才闭合，
记在 §5 第 1 条。

### 1.3 `.tracked__grid` 的最小列宽与 `.video-wall` **取同一个数**（400px）

| 选择器 | 改前 | 改后 |
|---|---|---|
| `.video-wall`（`apps/web/src/styles.css:4039`） | `minmax(400px,1fr)` | **不变** |
| `.tracked__grid`（`:8695`） | `minmax(280px,1fr)` | `minmax(400px,1fr)` |

理由（本仓自己在 `.video-wall` 上面那句）：**"嵌入框一窄，播放器里的控件就挤成一团"** ——
追踪栏的播放器当时只有 ~280×157，而同一页上的自贴墙是 400×225：同样的播放器、两套控件密度。

⚠️ 代价（认下）：一屏显示的卡片变少（宽屏上大约少一列）—— 拿列数换"控件能用"，
而这一页的用法本来就是"点开一个看"。
⚠️★ 这个数字**现在是有人看着的**：`apps/web/scripts/videorender.tsx` 的 ⑪·b 读**那条规则的规则体**
（先剥 CSS 注释）里的 `grid-template-columns`，断言**两个栅格的下界相等**且**都不低于 400px**，
并配了一条能红证明（改回 280px 会当场不等）。把一个数字从"没人看得见"变成"改错会红"，
是这一条最值钱的地方。

### 1.4 卡片上的博主名（`tracked__creator`）

- 数据：`TrackedVideo.creatorName?`（`tracked_creators.display_name` 经 JOIN 带回来）。
  服务端把 `NULL` 收成 `''`（`toTrackedVideo`），界面判**值本身**：
  **空串 / 没有这一格 ⇒ 整格不渲染**（不退化成 handle、不画空框）。
- 断言：`videorender.tsx` ①·b 三档各一份产物（有名字 / `''` / 没有），加一条能红证明
  （恒渲染一个空 `<span>` 的旧写法会被同一个计数器数到）。
- `tracked__creator` 进了 ⑪ 的 `MUST_RENDER` —— 它新加的 CSS 规则从此有消费者。

---

## §2 第 9 条：筛选 / 排序 / 博主下拉（服务端参数 + 公开名册）

### 2.1 `GET /api/tracking/videos` 的查询参数表（**本轮新增七个**）

| 参数 | 取值 | 缺省 | 非法值 |
|---|---|---|---|
| `page` / `pageSize` | 同今天（1 / 24，上限 100） | 1 / 24 | 400 `invalid_query` |
| `platform` | `bilibili` \| `youtube` \| `twitch`（`TRACK_PLATFORMS`） | 不传 = 全部 | 400 |
| **`sort`** | `new` \| `views` | `new`（= 今天的顺序 `published_at DESC`） | 400 |
| **`creatorId`** | 博主 id，`min(1).max(64)` | 不传 = 全部博主 | 400（**空串也是 400**） |
| **`tag`** | `liveReplay` \| `short` \| `long`（`TRACKED_VIDEO_TAGS`） | 不传 = 全部 | 400 |
| **`durMin` / `durMax`** | 秒，闭区间，`0…TRACKED_MAX_DURATION_SEC` | 不传 = 不限 | 400；**`durMin > durMax` 也是 400** |
| **`since` / `until`** | Unix **秒**，闭区间，上界 `TRACKED_MAX_TIMESTAMP_SEC` | 不传 = 不限 | 400；**`since > until` 也是 400** |

⚠️★ 为什么七个参数**逐个都要进 schema**：实测（2026-09-19，生产）**未知查询参数被静默忽略** ——
`?sort=views` 与不带 `sort` 的顺序**逐条相同**、`?tag=ranked` 与不带参数**逐字节相同**。
⇒ 少写一个**不报错、只什么都不做**：界面看起来"点了没反应"，日志里一行异常都没有。

⚠️ 两条**跨字段**判据（`durMin > durMax` / `since > until`）不是洁癖：不拦的话结果是一个
**语法完全合法**的空列表，而用户手里那条地址看起来没有任何毛病 —— 他会以为这一栏真的没有内容。

**拼串只有一处**：`packages/shared/src/tracking.ts` 的 `buildTrackedVideoQuery`。
手写 `params.set` 的话，两个不同的筛选会拼出**同一个 URL**（`Cache-Control: public, max-age=60`），
它们互相串数据（"我明明选了播放量倒序，出来还是刚才那批"）。
`apps/web` 没有测试运行器 ⇒ 那条"键集合 ↔ schema 键集合"的成对断言住在
`services/api/src/tracking-routes.test.ts` / `tracking-shared.test.ts`。

### 2.2 `GET /api/tracking/roster`（**新端点**，公开只读）

```
GET /api/tracking/roster   →   200  { items: TrackedCreatorSummary[] }
Cache-Control: public, max-age=60, stale-while-revalidate=300      （与公开列表同档）
```

每一行**恰好五个键**：`id` / `platform` / `displayName` / `handle` / `videoCount`。

| 口径 | 值 | 为什么 |
|---|---|---|
| `videoCount` | **只数 `status = 'visible'`** 的行 | 公开端点数"隐藏了几条"等于对外宣布我们下架过东西。⚠️ 它与 `TrackedCreator.videoCount`（含隐藏、**是 bilibili 到底判据的输入**）**是两个数**，别统一 |
| 过滤 `enabled` | **不过滤** | 停用只回答"还抓不抓"；他的旧视频仍然在公开列表里 ⇒ 下拉框藏起来就会出现"列表里有他的视频、却没法按他筛" |
| 路径 | `/roster`，**不是** `/creators/public` | Hono 里"父路径有鉴权"**不保护**子路径：挂在 `/creators` 下面会让人以为它也吃 `live.manage` 那条中间件（今天那条是匿名 401） |
| 不泄露新东西 | 博主名字与平台今天就已经公开（追踪栏按平台分组的标题、每张卡上的平台徽章） | 这句话下一个人一定会问 |

界面那一侧：**空名册 ⇒ 只剩「全部博主」**（能接受的降级），而**列表照常画** ——
把"名册空"读成"没有内容"会得到一屏空白。断言在 `videorender.tsx` ⑬·b 末段。

### 2.3 界面：五个下拉框 + 三种空态 + 两个栏目

- **前端 URL 参数**：`vtab`（栏目）+ 这一栏的 `tpage` / `tplatform` / `tsort` / `ttag` / `tdur` /
  `ttime` / `tcreator`。⚠️ 带 `t` 前缀是因为**上面那面墙**已经占了 `platform` / `page`；
  共用的表现是"在追踪那一栏点一下 B站，上面那面墙的筛选和页码一起没了"。
- **先校验再用**：认不出的值一律退化成默认（`vtab` ⇒ `wall`，五档 ⇒ "不限"，`sort` ⇒ `new`）。
  服务端对非法值是 **400**，而"地址被改坏了"不该变成一个用户没法自救的错误页。
- **排序不算筛选**（`hasTrackedFilters` 排除 `sort`）：排序不改变结果集 ⇒
  "只是换了排序的空列表"不许说"这个筛选下没有视频"（那句话会让人去找一个不存在的筛选）。
  它同时决定"清除筛选"那颗按钮出不出现（两处消费者问**同一个**函数）。
- **三种空态互斥**（越具体越优先）：筛选 `tracked.emptyFilter` > 分区 `tracked.emptyPlatform` >
  什么都没筛（页面给的 `empty` + `tracked.emptyHint`）。
- **两个栏目互斥**：`?vtab=wall|tracked`，**同一时刻只渲染一块**，两块各自的状态都留在地址里
  （切过去再切回来，页码与筛选都还在）。断言是**数节点**（`videorender.tsx` ⑰ 渲染真页面）。

### 2.4 纯函数层（`apps/web/src/lib/trackedQuery.ts`）

页面那一层（`routes/Videos.tsx`）静态渲染够不到（不跑 effect、不点击）⇒ 那几条契约被抽成
纯函数，由 `videorender.tsx` 的 ⑯ / ⑯·b / ⑯·c 直接跑：

| 函数 | 契约 |
|---|---|
| `readVideosTab` | 认不出的 `vtab` ⇒ `wall` |
| `nextParamsForVideosTab` | 只碰 `vtab`；`wall` 时**删掉**它；其余键逐字符原样 |
| `readTrackedPlatform` / `readTrackedFilters` | 取值域里的才认，认不出的退化成默认 |
| `nextParamsForTrackedFilter` | `undefined` ⇒ 删键；**删 `tpage`**；不碰墙的四个键 |
| `clearedTrackedFilterParams` | 删这一栏的**七个**键，墙的四个原样 |
| `hasTrackedFilters` | **排除 `sort`** |

### 2.5 `high_quality` 那条**假记录**的订正（留痕）

`docs/tracked-embed-spec.md` §2.2 原先把
`…?bvid=BV…&page=1&high_quality=1&danmaku=0 → 200` 记成"**实测通过**"。**那是一条假记录**：

- `player.bilibili.com/player.html` 是一个**静态壳**：它对**任何**参数组合都回 200，且
  **字节数完全相同**（6660 / 6660 / 6660，`.cache/videos-live-round/headers.json`）——
  参数在**浏览器端**才被读（`bili-player-curated.body.txt:86-131` 的 `paramType` 表）；
- `high_quality` / `as_wide` **不在**官方参数表、也不在播放器页的参数表里
  （对照 `docs/platform-oauth-embed-factsheet.md:138`「Treat `high_quality` as undocumented/legacy」）。
- ⇒ **今天一个都不用**（`services/api/src/videos.test.ts` 有一条断言钉着"不许加它们"）。

**教训**：那个 200 之所以看起来像证据，是因为**没有人量过"参数不同、响应也应当不同"**。
一次"回 200"的实测，对静态壳来说等于什么都没测。

---

## §3 第 10 条：直播状态、人数、排序、搜索

> 这一条的**数据侧**（迁移 023 / 采集作业 / 排序 SQL / 缓存账）在
> `docs/calendar-video-rework.md` §C（本轮在那里就地补的，因为那份文档正是「直播」板块的出处）。

### 3.1 界面上那三样

| 位置 | 形状 |
|---|---|
| 「直播中」徽章 | `.badge--live`，**只在 `isLive === true`** 时渲染 |
| 人数 | `.live-card__viewers`，**只在 `viewerCount !== null`** 时渲染（`0` 照画；`null` ⇒ **零节点**） |
| 搜索框 | 受控 `<input type="search" id="live-q">`，标签（`sr-only`）与占位符**同一个词条** `live.searchLabel`；只在名单非空时渲染 |

`isLive` 是**三态**（`true` / `false` / `null`），**不许压成两态**：`null` = 没查过、`false` = 问过没在播。
两者在界面上都"什么都不画"（用户看到的一样），但在数据里必须分得开 —— 把 `null` 读成 `false`
是让界面说一句我们没验证过的话。断言：`liverender.tsx` 的「三档互斥」那一组（五档夹具 + 能红证明）。

### 3.2 顺序：**服务端给的顺序就是屏幕上的顺序**

- 服务端：`services/api/src/live.ts` 的 `LIVE_ORDER_BY` —— 在播（有人数）按人数降序 →
  在播（人数 NULL）→ 其余保持今天的顺序；**人数为 NULL 排在"人数为 0"之后**（NULL 不是 0）。
- 前端：**一次都不许再排**（`routes/Live.tsx` 里 `shown` 只做搜索过滤）。
  断言三层：五张卡**逐行**比对 / 倒过来喂也倒过来画 / 页面源码里**没有** `.sort(`。

### 3.3 搜索框：本地筛，两种空态分开说

- 纯函数 `filterLiveChannels`（`packages/shared/src/live.ts`）：判据是 `displayName` / `tags` / `note`
  三个字段的**子串**、**忽略大小写**、空查询返回**新数组**；**不搜 `handle`**
  （它已不是人填的、卡片上也不显示 ⇒ 搜一个用户看不见的字段会让结果看起来随机）。
- ⚠️ **没有 300ms 防抖**（`ResourceList.tsx` 那一套）：那个防抖的理由是"别让每一次按键变成一次请求"，
  而这里**没有请求**（纯本地筛，与「排行榜」那一栏逐字同形）。
  **代价（认下）**：搜索词**不写 URL** ⇒ 不能分享一个筛好的链接、刷新回到全部。
- 两种空态：`live.searchEmpty`（没命中）≠ `live.empty`（一条都没有）。

### 3.4 那句承诺的改写（**这一条线上最敏感的地方**）

**改前**：

- 中文：「这里记录的是 MCSR 相关的**直播频道**。」
- 英文："These are **channels**, not a "who is live right now" board — we do not detect liveness,
  so there is no live badge."
- 与之配套的是 `routes/Live.tsx` 与 `LiveCard.tsx` 文件头那段推理：「这一页**不检测直播状态**……
  所以**没有「直播中」标记**」，并点明那句话是这一页**能一直保持诚实的唯一原因**。

**改后**：

- 中文：「这里记录的是 MCSR 相关的**直播频道**；「直播中」和人数目前只查 Twitch 与 B站，
  每几分钟一次，所以可能晚几分钟。」
- 英文：'These are **channels**, not a real-time board — the "Live" badge and viewer counts are
  checked every few minutes for Twitch and Bilibili only, so they can lag behind.'

**为什么必须多说两件事（少一件都是新的谎）**：

1. **会迟到**：3 分钟（作业）+ 60 秒（`max-age`）+ 300 秒（`stale-while-revalidate`）
   ⇒ 徽章/人数最多旧到 **9 分钟**。一个会迟到的标记 + 一句"实时"就是一句新的谎。
2. **只查两个平台**：YouTube 行**永远**没有徽章（这一轮不做 YouTube 直播检测）。
   界面上"没查"与"没在播"长得一样（都是没有标记）⇒ 不点名平台的话，
   看的人会把"YouTube 那一行没徽章"读成"他没在播"。

处置**不是删掉**那句（删掉之后页面上不再有任何一句说明这页是什么），而是**换成仍然为真的说法**。
断言（`liverender.tsx` 的「承诺改写」那一组）：**两个方向都要断** ——
旧句不在（中文那侧只能断"不是原值"，因为新句仍然以它的前半段开头；英文那侧断"整句不在"）、
新句把两件事说全、页面用 `em()` 渲染它。只断一头的话，"删掉承诺"与"换成真话"在产物里长得一样。

---

## §4 验收（逐条可测，都指到具体的断言）

| # | 事 | 断言在哪 |
|---|---|---|
| 1 | `danmaku=1`（两条路各一次逐字符） | `liverender.tsx`（资源库播放器 + `VideoEmbed`）、`services/api/src/videos.test.ts` |
| 2 | 不许加 `high_quality` / `as_wide` | `services/api/src/videos.test.ts` |
| 3 | 两个栅格同一个下界（400px） | `videorender.tsx` ⑪·b（读规则体，剥注释，能红证明） |
| 4 | 博主名三档（有 / 空串 / 没有） | `videorender.tsx` ①·b |
| 5 | 五个下拉框逐格（可访问名 + 选项取值与文字 + 选中项） | `videorender.tsx` ⑬·b |
| 6 | 三种空态互斥 + 排序不算筛选 | `videorender.tsx` ④·b |
| 7 | 两个栏目互斥（数节点）+ 顶部按钮状态 | `videorender.tsx` ⑰（渲染真页面） |
| 8 | 七个查询参数的服务端行为 | `services/api/src/tracking-routes.test.ts` / `tracking-shared.test.ts` |
| 9 | `/roster` 五个键 + 公开可读 + 缓存 | `services/api/src/tracking-routes.test.ts`、`user-live-links.test.ts` |
| 10 | 「直播中」/人数三档互斥 | `liverender.tsx`（三档互斥那一组） |
| 11 | 顺序（逐行 + 不倒排） | `liverender.tsx`（顺序那一组）、`services/api/src/live-order.test.ts` |
| 12 | 搜索框结构 + 纯函数判据 | `liverender.tsx`（搜索框那一组）、`live-order.test.ts` |
| 13 | 承诺改写（旧句不在 + 新句说全） | `liverender.tsx`（承诺改写那一组） |
| 14 | 新类名 ↔ CSS | `liverender.tsx`（类名↔CSS 那一组）、`videorender.tsx` ⑪ |

---

## §5 仍然没验的事（不许当成已经验过）

1. **bilibili 的弹幕开关 / 音量 / 全屏在真浏览器里到底出没出现** —— 源码级证据只有
   "地址里有 `danmaku=1`"与播放器页的参数表；`allowFullScreen` 两条路逐字相同但没有人点过。
2. **五个下拉框与两个栏目点下去真的换了数据** —— 接线（谁调用谁、依赖数组）静态渲染看不见；
   请求参数真的变了、翻页真的回到第 1 页，都要真浏览器。
3. **直播那条**：Twitch 的真实覆盖（线上 183 个 login / 2 次调用 / 那一刻在播 37 个）、
   **「直播中」徽章最旧能到几分钟**、"bilibili 的 `online` 到底是不是并发观看人数"（上游字段名就叫
   `online`，口径**没有人能确认**）。
4. **YouTube 的直播检测这一轮没做**（`search.list?eventType=live` 是 100 次/天的独立桶）
   ⇒ `is_live` / `viewer_count` 对 youtube 那几行**永远是 NULL**。
5. **迁移 023 在生产上跑的那一刻**（演练只在生产库的**副本**上做过）。
6. 逐条代价与"要人做什么"见 `docs/pending.md §5.103`。
