# 视频博主追踪 —— 冻结规格（2026-09-16）

> 这份文件是**契约**，不是计划。计划（`docs/video-tracking-plan.md`）从它推出来，
> 冲突时**以这份为准**。
>
> ⚠️ **本轮的前提与上一轮不同**（用户 2026-09-16 明确）：
> **不考虑任何法律因素**、**只做视频**、**管理员维护博主名单**、
> **服务器自动抓全部视频（慢点没关系）**、**存全部并打标签**（标签将来用于筛选）。
>
> 上一轮的可行性证据在 `docs/tracking-scale-feasibility.md`（技术轴，本规格的实测依据）
> 与 `docs/platform-tracking-feasibility.md`（合规轴，**本轮不据此判断**，保留备查）。

---

## §1 用户原话与六条裁决

### 1.1 原话（逐字）

> 「先落一版单纯是视频的实现计划，并允许管理员增删视频博主，由服务器自动抓取其所有的视频
> （可以慢点，不考虑时间问题）」

以及前一轮的两条：
> 「不考虑任何法律因素，继续研究可行性，包括 bilibili 的视频抓取」
> 「暂时不需要允许用户自行增删查改，应用会把尽可能多的视频/直播贴出来，允许用户自行屏蔽」

### 1.2 六条裁决（用户当场选的）

| # | 问题 | 裁决 |
|---|---|---|
| R1 | 自动抓的视频放哪 | 现有 `/videos` 页里新增一块**「追踪的博主」分区**（不新开页面、不混进自贴列表） |
| R2 | "管理员"是哪一级 | **editor 及以上**，沿用现有的 `live.manage`（不新开能力） |
| R3 | 现有"用户自贴视频"那条路 | **原样保留**，与自动抓的**分开**（两条路互不影响） |
| R4 | 卡片显示哪些字段 | 标题 + 封面 + 发布时间 + 时长 + **播放量 + 评论数** |
| R5 | 抓取节奏 | **加博主时全量回填一次**，之后**每小时增量**；慢没关系 |
| R6 | 短视频 / 直播回放 | **全都存**，并**视情况打标签**；标签将来用于筛选 |

---

## §2 实测事实（本规格的全部技术依据）

全部来自 `docs/tracking-scale-feasibility.md` 的本轮实测。**逐条复述到这里，因为计划要照着它写。**

### 2.1 bilibili 视频列表 —— **能用**，配方如下（★ 关键）

```
① cookie     GET https://api.bilibili.com/x/frontend/finger/spi
             → data.b_3 / data.b_4  ⇒  cookie: buvid3=…; buvid4=…; b_nut=<unix秒>
② WBI 密钥   GET https://api.bilibili.com/x/web-interface/nav
             → data.wbi_img.img_url / sub_url，各取**文件名去扩展名**
             拼成 64 字符，按下面那张表取前 32 位 = mixinKey
③ 签名       params + wts=<unix秒>；键按字典序排；值去掉 !'()* 后 URL 编码
             w_rid = md5(排好的 query 串 + mixinKey)
④ ★ 风控参数  dm_img_list=[]                                  ← **空**才对
             dm_img_str=V2ViR0wgMS                             ← "WebGL 1" 的 base64
             dm_img_inter={"ds":[],"wh":[0,0,0],"of":[0,0,0]}   ← 空形状
⑤ 列表       GET https://api.bilibili.com/x/space/wbi/arc/search?<③④的参数>
             &mid=<uid>&ps=50&pn=<页>&order=pubdate&platform=web&web_location=1550101
```

**mixinKey 的 64 位重排表**（逐字抄，写错一位就全废）：

```
46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,
37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52
```

**第 ④ 步是分水岭，而且"空"才是对的**（实测三组对照）：

| 试法 | 结果 |
|---|---|
| 不传 `dm_img_*` | ❌ `HTTP 200 code=-352 风控校验失败`（并回一个 `v_voucher`） |
| **传空的 `dm_img_*`** | ✅ **`HTTP 200 code=0`，`vlist` 有数据** |
| 传一组**编造的非空**指纹 | ❌ `HTTP 412 request was banned` —— **比不传更糟** |

⇒ ⚠️ **两种拒绝不是一回事**：`200 + code:-352` 与 `412`。
**只看 HTTP 状态码的检查抓不到前者**，所以适配层必须**读 body 的 `code`**。

### 2.2 bilibili 能拿到什么（实测读数）

| 项 | 读数 |
|---|---|
| 每页条数 | `ps=5/30/50` → 5/30/**50** 条 ⇒ **每页最多 50** |
| 总量 | `data.page.count` = 该 UP 总投稿数（样例 124） |
| 翻页 | ✅ 能翻（pn=1→50、pn=2→50） |
| 字段 | `bvid` `title` `created`(发布 Unix 秒) `length`("01:51") `play` `comment` `pic`(封面) `description` `author` `mid` |
| 样例 | `bvid=BV1wHtm6rEK3 title="你有发现…" created=1788594186 length="01:51" play=59997 comment=1198` |

### 2.3 ★★ 限流：真正的成本（实测）

```
同一个**已知存在**的 UP（mid=703007996，粉丝 347722）连打 20 次、间隔 1.5 秒：
   成功 13 / -412 拒绝 7
对照组：随便递增编的 mid **全都真实存在**（relation/stat 一律 code=0），
   而它们的空间列表仍有 2 条回 -412
⇒ 结论：-412 **与 UP 存不存在无关**，是风控/限流；**放慢到 1.5 秒没有明显改善**
412 之后的恢复时间：等 2s ❌ / 5s ❌ / **10s ✅**
带 10 秒退避重试：8 个目标 **8/8 成功**，共 11 个请求，41.2s ⇒ **约 5.1 秒 / 频道**
```

### 2.4 ★★ 一个**会静默丢数据**的坑（实测）

同一个 UP 连翻 6 页：

```
pn=1 code=0  50 条      pn=2 code=0  50 条
pn=3 code=-412          pn=4 code=-412
pn=5 code=0   0 条  ← ⚠️★   pn=6 code=0   0 条  ← ⚠️★
```

而这个 UP **有 124 条**。
⇒ **`code=0` 但列表为空**，没有异常、没有非 200、没有非零 code。
天真的实现会把它读成"到底了"，于是**静默只存了 100 条**，而**所有错误处理都不会响**。

### 2.5 YouTube（【文档】，来自官方方法页原文）

```
默认配额：100 search.list calls / 100 videos.insert calls / 10,000 units per day（其余端点合计）
playlistItems.list → "Quota impact: A call to this method has a quota cost of 1 unit."
videos.list        → 1 unit       channels.list → 1 unit
search.list        → "100 calls per day"，**独立的桶**（不是从 10,000 里扣）
```

- 上传列表：`channels.list?part=contentDetails` 拿 `uploads` 播放列表 ID（1 unit，**每频道一次**）。
- ⚠️ **`playlistItems.list` 不给时长、不给播放量** ⇒ 要另发一次
  `videos.list?part=contentDetails,statistics&id=<最多 50 个 id>`（1 unit / 50 个）。
- ⚠️ **免费的那条路（`feeds/videos.xml` RSS）已经没了**：四种形式（channel_id / playlist_id / user /
  裸) **全部 404**，而 `youtube.com/` 是 200、`oembed` 返回真实数据（实测）。

### 2.6 Twitch（【文档】）

- `Get Videos` 返回 `duration` / `view_count` / `created_at` / `title` / `thumbnail_url` / `type`
  （`archive` | `highlight` | `upload`）。
- `Get Users?login=` 把 login 解析成 user id。
- 速率限制：token bucket，**每请求默认 1 点**，`Ratelimit-Limit: 800`/分钟，
  **app access token**（client credentials）即可，不需要用户登录。
- ⚠️ 缓存上限 **24 小时**、禁止 re-syndication（**本轮按用户要求不计入判断**，仅记录）。

### 2.7 依赖：**只有 bilibili 不需要凭据**

| 平台 | 需要什么 | 现在有吗 |
|---|---|---|
| **bilibili** | **什么都不需要** | ✅ **可以立刻做** |
| YouTube | 一个 Data API key | ❌ 生产上没有任何 key（实测 `systemctl show` 里没有） |
| Twitch | client id + secret | ❌ 同上 |

⇒ 这决定了**任务顺序**：bilibili 先跑通整条流水线，另两个平台**代码写好但端到端验收需要凭据**。

---

## §3 架构

### 3.1 一个**独立的 CLI + systemd timer**，不是长驻 worker

理由三条：

1. 本仓**已经有两个不跑 HTTP 的 CLI 先例**：`dist/import.js`（部署时跑一次）与
   `dist/admin.js`（"在服务器上跑，不经 HTTP"，见 `admin-cli.ts` 的文件头）。
   `build.mjs` 的 `entryPoints` 是**多入口**的，加一个 `track` 是一行。
2. deploy 把**整个 `dist/`** 打包上传（`tar -czf api.tgz -C services/api/dist .`），
   所以新 CLI **自动跟着上线**。
3. "可以慢点、不考虑时间"意味着**不需要长驻进程**：每次跑一段、做完就退，
   失败在 `journalctl` 里可见。长驻 worker 要多一套"它挂了谁发现"的机制。

⚠️ **不能做成 HTTP 里的后台任务**：bilibili 一个频道 5 秒、一次全量回填可能几十分钟，
挂在请求里会把 web 进程占住；而"懒轮询 + TTL 缓存"在这里更糟 ——
**访客一来就触发一轮扫描**，成本随访客量放大（与上一轮 ranked 的结论相反，因为成本结构不同）。

### 3.2 待办**从状态推导**，不建队列表

沿用本仓"**到点是查询条件，不是状态变更**"那条既有裁决（见 `docs/progress.md` §十六②）：

```sql
-- 该回填的：还没回填过的，且没被禁用
backfill_done = 0 AND enabled = 1
-- 该增量的：已经回填过，且距上次同步超过 1 小时
backfill_done = 1 AND enabled = 1 AND last_synced_at < now - 3600
```

⇒ **没有队列表要维护、没有"任务卡住"这个状态**。一次跑完就更新 `last_synced_at` / `last_cursor`。

### 3.3 每次运行是**有界的**

一次 CLI 运行：
- 最多回填 **N_creators** 个频道（默认 20），最多翻 **P_pages** 页（默认 20）
- 最多增量同步 **M_creators** 个频道（默认 40）

**【推算】配额算术**：YouTube 每频道一次增量 = 1 unit（`playlistItems`）+ 1 unit/50 条
（`videos.list`）⇒ 40 个频道/次 × 24 次/天 ≈ 1,000–2,000 units/天，**在 10,000 之内**。
⇒ **不需要配额账本**：有界的设计本身就是保护。⚠️ 但要**记日志**，见 §6.3。

### 3.4 timer 每 10 分钟跑一次，**策略在 SQL 里**

- 每 10 分钟一次 ⇒ **新加的博主最多 10 分钟内开始回填**（不必等一小时）。
- "每小时增量"由 §3.2 那条 `last_synced_at < now - 3600` 表达。
- ⚠️ **必须防重叠**：`Type=oneshot` 的 timer 不保证上一次没跑完时不再启动。
  用 `flock -n` 包住 ExecStart（标准做法），**不加锁的话两个进程会同时推进同一个 cursor**。

### 3.5 三个平台适配器**各自独立失败**

一个平台被限流/凭据没了/接口变了，**不能**影响另外两个。
⇒ 每个 creator 的失败只写它自己那一行的 `last_error` / `consecutive_failures`，
运行结束打印"本轮成功 a / 跳过 b / 失败 c"。

---

## §4 数据模型（迁移 020，下一个编号）

### 4.1 `tracked_creators`

```sql
CREATE TABLE tracked_creators (
  id                   TEXT PRIMARY KEY,
  platform             TEXT NOT NULL CHECK (platform IN ('bilibili','youtube','twitch')),
  external_id          TEXT NOT NULL,          -- mid / YouTube channelId / Twitch user id
  handle               TEXT NOT NULL DEFAULT '',-- 可读标识（@handle / 昵称），只为显示与排错
  display_name         TEXT NOT NULL,
  avatar_url           TEXT,
  /* 平台自己的小东西（JSON 文本）。见 §5.5 的裁决：
     YouTube 的 uploads 播放列表 ID 放这里 —— 不放 handle（那是给人看的可读标识）。
     ⚠️ 数据库不知道它的形状 ⇒ 读出时要过一遍防御性解析，坏了就当作空。 */
  platform_meta        TEXT,
  backfill_done        INTEGER NOT NULL DEFAULT 0 CHECK (backfill_done IN (0,1)),
  last_cursor          TEXT,                   -- 翻页游标（bilibili 是 pn，YouTube 是 pageToken）
  last_synced_at       INTEGER,
  last_error           TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  enabled              INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  added_by             TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  UNIQUE (platform, external_id)
);
```

⚠️ `UNIQUE (platform, external_id)` 是**必需**的：它让"同一个博主被加两次"在**数据库**这一层
就失败，而不是靠界面判断（本仓 `live_channels` 的 `UNIQUE (platform, handle, live_video_id)`
是同一手法）。

### 4.2 `tracked_videos`

```sql
CREATE TABLE tracked_videos (
  id             TEXT PRIMARY KEY,
  creator_id     TEXT NOT NULL REFERENCES tracked_creators (id) ON DELETE CASCADE,
  platform       TEXT NOT NULL CHECK (platform IN ('bilibili','youtube','twitch')),
  external_id    TEXT NOT NULL,                -- bvid / YouTube videoId / Twitch video id
  title          TEXT NOT NULL,
  thumbnail_url  TEXT,
  published_at   INTEGER,                      -- Unix 秒；拿不到时 NULL（**不要填 0**）
  duration_sec   INTEGER,                      -- 拿不到时 NULL
  view_count     INTEGER,
  comment_count  INTEGER,
  is_live_replay INTEGER NOT NULL DEFAULT 0 CHECK (is_live_replay IN (0,1)),
  tags           TEXT,                         -- JSON 数组文本（沿用 live_channels.tags 的先例）
  status         TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden')),
  first_seen_at  INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  UNIQUE (platform, external_id)
);

CREATE INDEX idx_tracked_videos_recent  ON tracked_videos (published_at DESC);
CREATE INDEX idx_tracked_videos_creator ON tracked_videos (creator_id, published_at DESC);
```

三条理由写在建表注释里：

- **`UNIQUE (platform, external_id)`**：翻页会重复看到同一批视频（增量重叠是常态），
  有它才能用 `INSERT ... ON CONFLICT DO UPDATE` 做成**幂等**；没有它每次增量都会插重复行。
- **拿不到的字段一律 `NULL`，不许填 0**：本仓既有纪律 ——
  `apps/web/src/components/SeedResultCard.tsx:154-155` 那条注释（贴在该卡
  `record.matchDate` 的渲染上）："null 是真实存在的…**不能**显示成 0 ——
  1970 年 1 月 1 日看起来像一条真实数据"。⚠️ 它**不在** `packages/shared/src/seed.ts` 里：
  那边的 `SeedRecord.matchDate`（`seed.ts:110`）是一个没有注释的字段，
  上一版这里是"`SeedRecord.matchDate` 那条注释"而不点名文件，于是被指认到了 `seed.ts` 上。
  播放量 0 与"上游没给"是两件事。
- **`ON DELETE CASCADE`**：删掉一个博主，他的视频跟着走（与 `content_contributors` 那类
  "没有外键所以必须手工清"的教训相反 —— 这里**能**用外键就用）。

### 4.3 标签（R6）

`tags` 是 **JSON 数组文本**，沿用 `live_channels.tags`（迁移 015 加的）那套。

**v1 只派生三个可由数据判定的标签**（不许凭感觉造标签）：

| 标签 | 判据 | 为什么它可判定 |
|---|---|---|
| `liveReplay` | `is_live_replay = 1` | Twitch 有 `type='archive'`；YouTube 有 `liveStreamingDetails`；bilibili 存档里 v1 判不出（见 §8） |
| `short` | `duration_sec <= 60` | bilibili 有 `length`；YouTube 有 `contentDetails.duration`；Twitch 有 `duration` |
| `long` | `duration_sec >= 1200` | 同上 |

⚠️ **判据必须能指到一个可执行的东西**（本仓纪律）。`duration_sec` 为 `NULL` 的**一律不打**
时长标签 —— 打一个"猜的"标签比不打更坏。

---

## §5 平台契约（适配器）

每个平台一个模块，导出**同一个形状**的接口：

```ts
export interface FetchedVideo {
  externalId: string;
  title: string;
  thumbnailUrl: string | null;
  publishedAt: number | null;   // Unix 秒
  durationSec: number | null;
  viewCount: number | null;
  commentCount: number | null;
  isLiveReplay: boolean;
}

export interface FetchPage {
  videos: FetchedVideo[];
  nextCursor: string | null;    // null = 没有下一页
  /** ⚠️ 见 §5.4：**不许**把"空列表"直接当成到底了 */
  reachedEnd: boolean;
}

export interface CreatorRef {
  platform: TrackPlatform;
  externalId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface PlatformAdapter {
  /** 管理员粘贴的链接/标识 → 规范化成 CreatorRef。解析不出来就抛。 */
  resolveCreator(input: string): Promise<CreatorRef>;
  /**
   * 抓一页。
   *
   * ⚠️ **第三个参数是预检扫描抓出来的一处订正**（2026-09-16）：
   * 本规格原来写的是两参 `fetchPage(creator, cursor)`，但 §5.4 要求 bilibili 的
   * "到底了"判据里含"**我们库里已存条数** >= `page.count`" —— 而适配器**不该知道数据库**。
   * ⇒ 裁决：把 `storedTotal` **由调用方传进来**（调用方本来就要查一次，顺手就有了）。
   * YouTube / Twitch 忽略它（它们的结束语义只看游标）。
   */
  fetchPage(creator: TrackedCreator, cursor: string | null, ctx: { storedTotal: number }): Promise<FetchPage>;
}
```

### 5.1 bilibili

- **握手**（每个进程一次）：`finger/spi` → buvid3/buvid4；`web-interface/nav` → mixinKey。
  ⚠️ **握手失败要当作"本轮放弃 bilibili"**，不能带着空 cookie 继续打（那会白吃一堆 412）。
- **游标**：`pn`（页码）。`fetchPage` 把 `cursor ?? '1'` 传进去。
- **到底了**：**依据 §2.4** —— 只有当 `vlist.length < ps` **且** 已存条数 >= `page.count`
  才算到底；否则**视为"被限流"**，`reachedEnd = false` 并把游标停在原地。
- **限流**：`code === -412` ⇒ 等 **10 秒**重试，最多 **3** 次；仍失败则本轮跳过这个频道。
- **字段映射**：`bvid`→externalId、`title`、`pic`→thumbnailUrl、
  `created`→publishedAt、`length`("MM:SS"/"HH:MM:SS")→durationSec、
  `play`→viewCount、`comment`→commentCount、`isLiveReplay=false`（v1 判不出，见 §8）。
- **resolveCreator**：接受 `space.bilibili.com/<mid>`、`b23.tv` 短链、
  或直接一串数字 mid。⚠️ **不接受"把 mid 填进 platform 那一栏"那种形状** ——
  与 `VideoInputSchema` 的既有裁决一致（入参是**一个链接**，拆分在服务端做）。

### 5.2 YouTube

- 需要 `MCSR_YOUTUBE_KEY`。**没配就整个平台跳过**并打印一行原因（不是崩）。
- `resolveCreator`：接受 `@handle` 或频道链接 → `channels.list?part=snippet,contentDetails&forHandle=`（或 `id=`）
  → 拿 `contentDetails.relatedPlaylists.uploads`（**这个 ID 要存下来**，
  否则每轮都要多发一次 `channels.list`）。
  ⇒ ⚠️ `tracked_creators.external_id` 存 **channelId**，upload 播放列表 ID 存在 `handle` 里吗？
  **不** —— 见 §5.5 的裁决。
- `fetchPage`：`playlistItems.list?part=snippet,contentDetails&playlistId=<uploads>&maxResults=50&pageToken=<cursor>`
  → 再对拿到的 id **批量补一次** `videos.list?part=contentDetails,statistics&id=<≤50 个>`
  （时长与播放量只有这里有）。
- **到底了**：`nextPageToken` 不存在即到底（这个接口的语义是可靠的，与 bilibili 不同）。

### 5.3 Twitch

- 需要 `MCSR_TWITCH_ID` + `MCSR_TWITCH_SECRET`。**没配就跳过**。
- app access token：client credentials，**进程内缓存**（有效期约 60 天，但按小时刷新足够）。
- `resolveCreator`：`twitch.tv/<login>` → `Get Users?login=` → user id + display_name + avatar。
- `fetchPage`：`Get Videos?user_id=<>&first=100&after=<cursor>&type=archive,highlight,upload`
  → `type==='archive'` ⇒ `isLiveReplay = true`。
- ⚠️ `duration` 是形如 `"1h2m3s"` 的字符串，**不是秒数** —— 要解析（见 §5.6）。

### 5.4 ★ 三个平台"到底了"的语义**不一样**，不许写成一个 if

| 平台 | 到底的判据 | 备注 |
|---|---|---|
| bilibili | `vlist.length < ps` **且** 已存 >= `page.count` | ⚠️ 单独看"空列表"会**静默丢数据**（§2.4） |
| YouTube | `nextPageToken` 缺失 | 语义可靠 |
| Twitch | `pagination.cursor` 缺失 | 语义可靠 |

⇒ 适配器各自回答 `reachedEnd`，**上层不许自己推断**。

### 5.5 裁决：`uploads` 播放列表 ID 存哪

**存进 `tracked_creators.handle`** 会污染语义（那个字段是给人看的可读标识）。
⇒ **裁决：加一列 `platform_meta TEXT`（JSON 文本）**，放各平台自己的小东西
（YouTube 的 uploads playlist id、Twitch 的 avatar 之类）。
理由：与 `live_shares.payload` / `live_channels.tags` 同一手法 —— **加字段不用迁移**。
代价：数据库不知道它的形状，所以读出时**要过一遍防御性解析**，坏了就当作空。

### 5.6 三个纯函数（必须可单测，放在能被 `services/api` 测试跑到的位置）

```ts
parseBilibiliLength('01:51')   -> 111
parseBilibiliLength('1:02:33') -> 3753
parseTwitchDuration('1h2m3s')  -> 3723
parseYouTubeDuration('PT1H2M3S')-> 3723    // ISO 8601
deriveTags({ durationSec, isLiveReplay }) -> string[]   // §4.3 那三条判据
```

⚠️ 这三个是**这一轮最值得写测试**的东西：它们错了不会抛异常，
只会让界面上显示一个错的时长、或者让标签全打错。

---

## §6 HTTP 与界面

### 6.1 端点（全部 `requireCapability('live.manage')`，除列表外）

| 端点 | 谁 | 干什么 |
|---|---|---|
| `GET /api/tracking/videos` | **公开** | 追踪到的视频列表（分页，按 `published_at DESC`） |
| `GET /api/tracking/creators` | `live.manage` | 名单（含采集状态：回填完没、上次同步、上次错误） |
| `POST /api/tracking/creators` | `live.manage` | 加一个（入参是**一个链接或 @handle**，服务端解析） |
| `PATCH /api/tracking/creators/:id` | `live.manage` | 改显示名 / 停用启用 / **重新回填**（把 `backfill_done` 置 0） |
| `DELETE /api/tracking/creators/:id` | `live.manage` | 删（视频靠外键级联跟着走） |

★ **加/改/删都写审计**（`tracked_creator.create` / `.update` / `.delete`），
理由与既有栏目一致：这是**对外可见的内容变更**，出问题时要知道是谁做的。

### 6.2 界面（R1：都在现有 `/videos` 页里）

- **对所有人**：一块「追踪的博主」分区 —— 卡片显示 R4 的六个字段，按发布时间倒序，
  分页（沿用本仓既有的分页样式）。**无视频时明确说"还没有追踪到视频"**，
  不是空白（既有纪律：空白看起来像坏了）。
- **对有 `live.manage` 的人**：同一页上一块管理面板 —— 名单表格（平台 / 名字 / 状态 /
  上次同步 / 上次错误 / 条数）+ 一个"加博主"输入框 + 每行停用/删除/重新回填。

⚠️ **纯视图拆分**（本仓铁律）：这两块都写成**只吃 props 的组件**，
页面负责取数 —— 因为 `renderToStaticMarkup` **不跑 effect**，
住在页面里的界面**断言不到**。

### 6.3 可观测性（没有它，这个功能会**静默**坏掉）

一次运行结束必须打印并以非零码退出的情形：

```
track: 本轮 开始=<iso> 结束=<iso>
  回填: 试 a 个 / 完成 b 个 / 失败 c 个
  增量: 试 d 个 / 完成 e 个 / 失败 f 个
  新增视频 g 条 / 更新 h 条
  平台: bilibili <ok|skipped:no-credentials|failed> / youtube … / twitch …
  ⚠️ 失败样例: creator=<id> platform=<> error=<原文>
```

★ **为什么必须有**：bilibili 的 `-412` 是**概率性**的。
⇒ "今天只贴了 10 条"与"今天没有新视频"在日志里**长得一模一样**。
不打印成功率的话，一次全量失败会看起来像一次正常的空轮询。

---

## §7 非目标

- **不做直播**（用户明确"单纯是视频"）。上一轮的直播结论留在 `tracking-scale-feasibility.md`。
- **不做用户增删查改**（用户明确不要）。名单只有 `live.manage` 能改。
- **不做"用户自行屏蔽"** —— 用户说那件事是给"尽可能多贴"准备的，而这一版**先只做视频**；
  §4.3 的标签是它的**前置条件**，等有了标签再做筛选/屏蔽。
- **不做自动发现博主**（不主动去搜"还有哪些 MCSR UP 主"）—— 只抓名单上的。
- **不改现有"用户自贴视频"那条路**（R3），也不把两种来源合并。
- **不抓评论内容 / 不抓弹幕 / 不做转码**。
- **不改 `videos.ts` 那条"绝不抓取元数据"的铁律** —— 见 §8.1。

---

## §8 与既有决定的关系（必须写清楚，否则下一个人会以为我们自相矛盾）

### 8.1 `videos.ts` 的铁律与新表**并存**，而且不冲突

`packages/shared/src/videos.ts:5` 写着「铁律：只存 `platform + video_id`，**绝不抓取任何元数据**」，
理由是合规（§1.2 引）。用户已明确**不计法律因素**，所以那条铁律的**理由**不成立了。

但 **R3 裁决是"现有自贴那条路原样保留"** ⇒ 两条路**各自成立**：

| | 用户自贴（不动） | 追踪抓取（新） |
|---|---|---|
| 存哪 | `videos` 表 | `tracked_videos` 表 |
| 元数据 | **只有 id + 手填标题** | 标题/封面/时长/播放量/评论数**全是抓来的** |
| 为什么这样 | 那条路上我们**没有**元数据可存 | 这条路上我们**有** |

⇒ **动作**：在 `videos.ts` 那条铁律的注释上加一句
「⚠️ 这只约束**用户自贴**这条路；`tracked_videos` 是另一条路，见 `docs/video-tracking-spec.md`」，
**不改**那一段原有文字（它描述的是那条路，仍然是真的）。

### 8.2 与 `live.manage` 的复用不冲突

`permissions.ts` 里 `live.manage` 的注释说那份名单"只有编辑及以上、不是 UGC"。
本轮 **R2 复用它**，语义**完全一致**（一份"记录重要 MCSR 创作者"的、编辑维护的名单）。
⇒ 动作：在注释里补一句"它也管视频博主名单（`tracked_creators`）"，**不改**原有结论。

---

## §9 验收

### 9.1 必须能演示的（每条都要有断言）

1. `parseBilibiliLength` / `parseTwitchDuration` / `parseYouTubeDuration` 逐值正确（含非法输入）。
2. `deriveTags`：`duration_sec = NULL` ⇒ **不打**时长标签；`liveReplay` 独立于时长。
3. **bilibili 的"到底了"判据**：喂一个"`code=0` 但 `vlist=[]`、而已存条数 < `page.count`"的响应
   ⇒ **不许**判定到底（这条直接对应 §2.4 那个坑，是**本轮最重要的一条断言**）。
4. `-412` ⇒ 退避 10 秒后重试；重试耗尽 ⇒ 本轮跳过，且 `consecutive_failures` +1。
5. 幂等：同一页抓两次，`tracked_videos` 行数**不变**（靠 `UNIQUE` + upsert）。
6. 删博主 ⇒ 他的视频**跟着没了**（外键级联，用行为验，不读 SQL 文本）。
7. 同一个博主加两次 ⇒ **数据库拒绝**（`UNIQUE`）。
8. 没有凭据时 YouTube/Twitch **被跳过而不是崩**，且运行输出里有一行说明。
9. `GET /api/tracking/videos` 匿名 200；其余端点匿名 401、非 `live.manage` 403。

### 9.2 mutation（每处都要点名一条断言）

| # | 改坏什么 | 期望红的那条 |
|---|---|---|
| ① | "到底了"判据改成 `vlist.length === 0` | 断言 3（★ 这条就是 §2.4 的坑） |
| ② | upsert 改成普通 INSERT | 断言 5 |
| ③ | 删掉 `UNIQUE (platform, external_id)` | 断言 7 |
| ④ | 时长解析把 `MM:SS` 当 `HH:MM:SS` | 断言 1 |
| ⑤ | `deriveTags` 在 `duration_sec` 为 NULL 时按 0 处理 | 断言 2 |
| ⑥ | 去掉 `flock` | 断言：两个进程同时跑 ⇒ 同一页被处理两次（**这一条要真的起两个进程**） |

---

## §10 冻结表

| 项 | 值 |
|---|---|
| 迁移编号 | **020** |
| 平台取值 | `bilibili` `youtube` `twitch` |
| bilibili 每页 | `ps=50` |
| bilibili 退避 | `-412` ⇒ 等 **10 秒**，最多 **3** 次 |
| bilibili 结束判据 | `vlist.length < ps` **且** 已存 >= `page.count` |
| 每次运行上限 | 回填 20 个 / 翻 20 页 / 增量 40 个 |
| timer | 每 **10 分钟**，`OnCalendar=*:0/10`，`Persistent=true`，`flock -n` |
| 增量口径 | `last_synced_at < now - 3600` |
| 标签 v1 | `liveReplay` / `short`(≤60s) / `long`(≥1200s) |
| 能力 | `live.manage`（editor+） |
| 凭据环境变量 | `MCSR_YOUTUBE_KEY` / `MCSR_TWITCH_ID` / `MCSR_TWITCH_SECRET` |
| 不动的 | `videos` 表、`video.submit` 那条路、`live_channels`、任何直播相关 |
