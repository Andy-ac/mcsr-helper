# Ranked 实时信息（ranked live info）：可实施方案（冻结契约）

> 2026-09-16 · 用户第五个栏目 · 上游是 **MCSR Ranked 公开 REST API**（第三方）
>
> 这份文档的读法与前一份 `docs/live-shares-spec.md` 相同：
> **§2 是实测回来的事实（权威）**，§13 是冻结值总表，实现者按它对齐、不要自己发明。
> 与文档冲突时以**本节写下的实测结果**为准 —— 上游文档有三处与真实响应不一致，
> 那三处都在 §2.3 列着。

---

## 0. 一句话结论

新增一个**公开**栏目「Ranked 实时信息」（`/ranked`），顶部一排**四个标签页**：
**状况与人数**、**实时高分对局**、**Elo 排行榜**、**周赛榜单**。
数据全部由**我们自己的 API 代理**（`/api/ranked/*`），服务端缓存 + 合并并发，
因为浏览器**不能**直连上游（站点 CSP 是 `connect-src 'self'`），
而上游的限流是 **500 次 / 10 分钟 / IP**，我们整站只有一个出口 IP。

**不落库、不加迁移、不动 CSP、不动其它栏目。**

---

## 1. 用户原话与逐条落地

> 新增一个大栏目"Ranked实时信息"，放在"排位赛种子"下面，包含以下内容，
> 每个内容做成一栏在顶部放成一排……
> 1、ranked当前状况及实时人数（Get Service Heartbeats -> 2; Get Online Players api第一项players）
> 2、实时高分对局（Live Stream Matches api liveMatches的内容，将每场比赛的eloRate平均后排序，
>    取前10场展示，每个卡片一行，从左往右依次显示玩家名、elo、#排名、当前进度[data->timeline->type]、
>    当前时间，然后第二名玩家信息对称摆放，点击卡片可下拉两个直播框[data->liveurl]）
> 3、ranked leaderboard（Get Elo Leaderboard，显示前100名，顶部显示赛季数、起始截止时间，
>    每名玩家显示排名, nickname, elorate, highest, phasepoint）
> 4、周赛榜单（Get Weekly Race Leaderboard，用切换页面显示每周周赛情况，默认为本周周赛，
>    顶部显示周数[id]，种子[3个]，截止时间，每名玩家显示排名, nickname, time, elorate, elorank）

| 原话 | 落地 |
|---|---|
| 大栏目、放在「排位赛种子」下面 | `NAV_SECTIONS` 里 `seeds` 之后、`profile` 之前；路由前缀 `/ranked` |
| 每个内容做成一栏，在顶部放成一排 | **四个标签页**（用户 2026-09-16 选的）：`/ranked/status` `/ranked/live` `/ranked/elo` `/ranked/weekly` |
| ① 状况 + 实时人数 | 上游 **两个**端点合成一栏（心跳 + `/live` 的 `data.players`） §6.2 |
| ② 高分对局 | `liveMatches` 按**两人 elo 平均**降序取前 10，卡片左右对称，点击展开两个直播框 §6.3 |
| ③ 排行榜 | 前 100 名 + 顶部赛季号与起止 §6.4 |
| ④ 周赛 | 默认本周，可前后翻页；顶部周数 + **4 个种子**（用户 2026-09-16 改口：数据里有 4 个就显示 4 个）+ 截止时间 §6.5 |
| 当前进度的显示 | **英文原样**显示，同时在 `zh-CN.ts` 里为每个已知标识配一条词条（值暂时写成英文，用户稍后自行校准翻译）§7.2 |

---

## 2. 上游：实测事实（**权威**，写代码前先读这一节）

### 2.1 端点与延迟（2026-09-16 从**生产服务器**实测）

上游有两个等价入口（文档明说）：

| 入口 | 文档说的缓存 | 用途 |
|---|---|---|
| `https://api.mcsrranked.com` | 5 秒 | **默认**（缓存期短） |
| `https://mcsrranked.com/api` | 30 秒 | **兜底**：主入口网络失败时重试一次 |

| 我们用的端点 | 实测 | 说明 |
|---|---|---|
| `GET /live` | **351 ms** | 在线人数 + 直播对局（①②都要它） |
| `GET /leaderboard` | **268 ms** | Elo 排行榜（③） |
| `GET /weekly-race` | **233 ms** | 本周周赛（④，默认页） |
| `GET /weekly-race/{id}` | ≈230 ms | 某一周周赛（④，翻页） |
| `GET https://status.mcsrranked.com/api/status-page/heartbeat/mcsrranked` | **68 ms** | 服务心跳（①） |

⚠️ 上游的**限流是 500 次 / 10 分钟 / IP**（文档原文），而**我们整站只有一个出口 IP**。
⇒ 服务端缓存 + 合并并发不是优化，是这个栏目能不能上线的前提（§5 有算术）。

⚠️ 实测响应头里带 `cache-control: max-age=14400`（**4 小时**）与 `cf-cache-status: EXPIRED`，
与文档写的"5 秒"**不一致**。⇒ **我们自己那一层 TTL 才是唯一保证**（§5），
并且把这一条写进风险表（§12）：如果哪天发现面板"冻住不动"，第一个要查的就是这个头。

### 2.2 真实响应形状（逐字段，**这是实现依据**）

```jsonc
// GET /live
{
  "status": "success",
  "data": {
    "players": 1257,                       // ★ ① 的"实时人数"
    "liveMatches": [                       // 实测 10–14 场
      {
        "currentTime": 918454,             // 毫秒（这场比赛已经进行了多久）
        // ⚠️ 没有 id 字段 —— 卡片不能挂链接，React key 只能用 uuid 对（§6.3）
        "players": [ /* 恰好 2 个 UserProfile */ ],
        "data": {                          // ★ 以 uuid 为键的对象，不是数组
          "<uuid>": {
            "liveUrl": "https://twitch.tv/hufterl",   // ⚠️ 驼峰 liveUrl；可以是 null
            "timeline": { "time": 221649, "type": "nether.find_bastion" }  // 可以是 null
          }
        }
      }
    ]
  }
}

// GET /leaderboard
{
  "status": "success",
  "data": {
    "season": { "number": 12, "startsAt": 1789430400, "endsAt": 1798588800 },  // ★ 秒，不是毫秒
    "users": [                               // ★ 实测 150 条（不是 100）
      {
        "uuid": "…", "nickname": "edcr", "roleType": 1,
        "eloRate": 2349, "eloRank": 1, "country": "gb",
        "seasonResult": {                    // ⚠️ 文档只写了 {eloRate, eloRank, phasePoint}
          "eloRate": 2349, "eloRank": 1, "phasePoint": 0,
          "highest": 2385, "phaseHighest": 2385   // ★ 文档里没有，但真实存在
        }
      }
    ]
  }
}

// GET /weekly-race  与  GET /weekly-race/{id}
{
  "status": "success",
  "data": {
    "id": 103,
    "endsAt": 1789948800,                    // 秒
    "seed": { "overworld": "…", "nether": "…", "theEnd": "…", "rng": "…", "flags": 207 },
    "leaderboard": [                         // 实测 50 条
      {
        "rank": 1,
        "player": { "uuid": "…", "nickname": "xiamoys", "roleType": 0,
                    "eloRate": null, "eloRank": null, "country": "cn" },   // ⚠️ 都可以是 null
        "time": 244241,                      // 毫秒
        "replayExist": true
      }
    ]
  }
}

// GET https://status.mcsrranked.com/api/status-page/heartbeat/mcsrranked
{
  "heartbeatList": {
    "2": [ { "status": 1, "time": "2026-09-15 13:36:27", "msg": "", "ping": 380 }, /* …100 条 */ ],
    "3": [/* API */], "4": [/* Store */], "5": [/* Wiki */]
  },
  "uptimeList": { "2_24": 1, "3_24": 1, "4_24": 1, "5_24": 1 }
}
```

`UserProfile`（上面到处都在用）= `{uuid, nickname, roleType, eloRate|null, eloRank|null, country|null}`。

### 2.3 ★ 五处"文档/直觉"与实测不一致的地方（**每一条都改到了设计**）

| # | 事实 | 后果 |
|---|---|---|
| 1 | `highest` **不在文档 schema 里**，真实位置是 `users[].seasonResult.highest` | ③ 的 highest 列取 `seasonResult.highest`，并且**必须有兜底**（`undefined`/null 时渲染 `—`，不是 `undefined`） |
| 2 | `eloRank` 是**竞赛排名**：实测序列 `…,13,14,14,14,17,18,19,19,21,…` —— **有并列、并列之后有跳号** | ③ 的排名列**必须用 `eloRank`**，不能用"下标 + 1"（那样会印出一个与 Elo 矛盾的排名）。测试夹具里**必须有一条并列** |
| 3 | ② 的 `data` 是**以 uuid 为键的对象**，而 `players` 是**数组**；字段是**驼峰 `liveUrl`** | 配对要按 uuid 查表；`liveUrl` 拼错（写成 `liveurl`）在 TS 里不会报错，因为响应是 `unknown` ⇒ §11 有一条形状守卫 |
| 4 | ② 的 `timeline` **可以是 null**（实测 10 场里有 6 个玩家块是 null）；`eloRate` 也可以是 null | 「当前进度」null ⇒ 渲染 `—`（**不是**把那一格删掉：删掉会让左右不对称）；平均 elo 的 null 口径见 §6.3 |
| 5 | ④ 的周赛 id 空间**不是单调的**：`104` → **400 `race is not found`**；`0` → **返回第 103 周**（0 是"当前"的别名）；`-1` → **真的存在第 -1 周**（43 条，endsAt 2026-04-30） | 翻页边界按 §6.5 冻结：**周数显示响应里的 `data.id`，不是 URL 里那个**（请求 0 会拿到 103）；「下一周」在 `id >= 最新周` 时禁用；「上一周」在 `id <= 1` 时禁用（第 -1 周不可达，写进 §10） |

其它实测值（写进夹具与文档，免得下一个人以为是随手编的）：

- ③ 前 150 名里 `seasonResult` 的键**恒为** `{eloRate, eloRank, phasePoint, highest, phaseHighest}`，
  `highest`/`phasePoint` **零缺失**、`eloRate` **零 null**（今天如此，不代表永远；兜底仍然要有）。
- 今天赛季 12：`2026-09-15T00:00:00Z` → `2026-12-30T00:00:00Z`；`phasePoint` **全为 0**（第 1 阶段刚开始）
  ⇒ ③ 的 phasepoint 列今天是一排 0，夹具不要假设它非零。
- 本周周赛 id 103：`endsAt` = `2026-09-21T00:00:00Z`（周一 00:00 UTC），种子四个值今天**相同**
  （周赛是"全维度同一个种子"），`flags` 新周是 `207`、老周（52、1）是 **null** ⇒ 我们不显示 flags，但形状上必须允许 null。
- ② 的直播率：一次采样 10 场 / 20 个玩家块中 **12 个有 `liveUrl`**、`uuid` 配对 **10/10 全中**、
  `players` 恒为 2 个 ⇒ 配对失败仍然要有兜底（缺块时那一侧显示"无数据"），但它是**防御**，不是常态。
- ② 出现过的 `timeline.type`（今天）：`nether.find_bastion`、`nether.find_fortress`、
  `projectelo.timeline.blind_travel`、`story.enter_the_end`、`story.enter_the_nether`
  ⇒ 命名空间深度不一（有的是两段、有的三段），所以词条表用**扁平 key**（§7.2）。

### 2.4 CSP 与直播框（**不用改 CSP**）

`deploy/Caddyfile` 的 CSP（现读第 74 行）：

```
frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.twitch.tv
          https://player.bilibili.com https://www.bilibili.com;
connect-src 'self';
```

- ⇒ **浏览器不能直连 `api.mcsrranked.com`**（`connect-src 'self'`）⇒ 代理是必须的，不是偏好。
- ⇒ **Twitch / YouTube / B站 的直播框能嵌**，CSP 一个字不用改；其它平台（kick 等）嵌不了。
- ⛔ 因此**不改 CSP**。真要嵌别的平台，那是一次独立的安全决策，不在这一轮。

---

## 3. 数据通路：为什么走我们自己的服务器

三条路，用户 2026-09-16 选了 A（我推荐的那条）：

| | 形状 | 结论 |
|---|---|---|
| **A ★ 我们代理** | 浏览器 → 我们（`/api/ranked/*`）→ 上游 | **选它**。CSP 不动；限流额度由我们**集中**省着花；上游挂了有兜底数据；上游的字段名/形状变了只改一处 |
| B 浏览器直连 | 需要把 `connect-src` 放开到上游 | ❌ 三个代价：放开 CSP；每个访客打一次上游（第三方看到访客 IP）；失败时前端拿不到任何兜底 |
| C 定时任务预热 | 服务端定时抓 + 存快照 | ❌ "实时"没了；而且周赛翻页/历史仍要现取，等于两套机制 |

---

## 4. 我们的接口契约（冻结）

四个端点，全部 **无需登录**（公开数据，与站内其它只读栏目一致），
全部 `Cache-Control: no-store`（响应里有 `serverNow`，进任何共享缓存都是错的）。

| 端点 | 上游 | 说明 |
|---|---|---|
| `GET /api/ranked/status` | 心跳 + `/live` | ①（一次请求打两个上游 URL，但都吃 §5 的缓存） |
| `GET /api/ranked/live` | `/live` | ②（与上面**共用同一份** `/live` 缓存） |
| `GET /api/ranked/elo` | `/leaderboard` | ③，取前 100 |
| `GET /api/ranked/weekly` | `/weekly-race` | ④ 本周 |
| `GET /api/ranked/weekly/:id` | `/weekly-race/{id}` | ④ 指定周 |

响应统一带 `serverNow`（服务端取的毫秒时刻，**一次请求只取一次**）与 `fetchedAt`
（这一份数据是上游**什么时候**产的），以及 `stale`（布尔：这一份是兜底的旧数据）。

```ts
// GET /api/ranked/status
interface RankedStatusResponse {
  monitor: {
    /** 0 down / 1 up / 2 pending / 3 maintenance —— 原样给前端，映射在界面那一层。 */
    state: 0 | 1 | 2 | 3;
    /** 上游那一条心跳的时间戳（秒）。 */
    checkedAt: number;
    ping: number | null;
    /** 24 小时可用率 0–1。 */
    uptime24: number | null;
  };
  /** 在线人数。上游给了 null / 缺字段时是 null（不是 0 —— "0 人在线"是另一件事）。 */
  players: number | null;
  serverNow: number;
  fetchedAt: number;
  stale: boolean;
}

// GET /api/ranked/live
interface RankedLiveMatch {
  /** 卡片的 key：两个 uuid 排序后拼起来（上游没有 match id）。 */
  key: string;
  /** 这场比赛已经进行了多久（毫秒）。 */
  currentTime: number;
  /** 两人 elo 的平均值；两边都是 null 时是 null（排最后）。 */
  avgElo: number | null;
  /** 两名玩家，**顺序固定**：先 elo 高的那个（null 排后）。 */
  players: [RankedLivePlayer, RankedLivePlayer];
}
interface RankedLivePlayer {
  nickname: string;
  eloRate: number | null;
  eloRank: number | null;
  /** 当前进度标识，原样给前端（词条映射在界面那一层）。null = 上游还没给。 */
  timelineType: string | null;
  /** 那一个节点的时间点（毫秒）。 */
  timelineTime: number | null;
  /** 直播间地址，null = 这个人没在直播。 */
  liveUrl: string | null;
  /** 由 liveUrl 的域名判出来（§6.3 的嵌入白名单）；认不出就是 null。 */
  livePlatform: 'twitch' | 'youtube' | 'bilibili' | null;
}
interface RankedLiveResponse {
  matches: RankedLiveMatch[];   // 最多 10 场，已按 avgElo 降序
  /** 上游这一份里一共有几场（用来在界面上说"从 N 场里取前 10"）。 */
  total: number;
  serverNow: number;
  fetchedAt: number;
  stale: boolean;
}

// GET /api/ranked/elo
interface RankedEloResponse {
  season: { number: number; startsAt: number; endsAt: number };   // 秒
  users: Array<{
    /** ★ 上游的 eloRank（并列会重复、并列之后会跳号），**不是**下标 + 1。 */
    rank: number | null;
    nickname: string;
    eloRate: number | null;
    highest: number | null;
    phasePoint: number | null;
  }>;
  serverNow: number;
  fetchedAt: number;
  stale: boolean;
}

// GET /api/ranked/weekly  与  /api/ranked/weekly/:id
interface RankedWeeklyResponse {
  /** ★ 上游**响应里**的周数（请求 0 会拿到 103），显示用的是它。 */
  id: number;
  endsAt: number;                                  // 秒
  seed: { overworld: string; nether: string; theEnd: string; rng: string };
  entries: Array<{
    rank: number;
    nickname: string;
    /** 毫秒。 */
    timeMs: number;
    eloRate: number | null;
    eloRank: number | null;
  }>;
  /** 最新一周的 id（`/weekly-race` 给的），用来决定「下一周」能不能点。 */
  latestId: number;
  serverNow: number;
  fetchedAt: number;
  stale: boolean;
}
```

**拒绝码**（沿用本仓既有形状 `{error, …}`）：

| 情况 | 我们的回答 |
|---|---|
| 上游说"这一周不存在"（400 `race is not found`） | **404 `not_found`** —— 这是**用户**点了不存在的周，不是故障 |
| `:id` 不是整数 / 越界（> 最新周且上游不认） | 400 `invalid_input`（先自己判一遍，别让上游替我们判） |
| 上游 429（它在限我们的流） | 503 `ranked_busy` +（有旧数据时照旧给旧数据，`stale: true`） |
| 上游 5xx / 超时 / 连不上 | 503 `upstream_unavailable` + 旧数据兜底 |
| 上游回的 JSON 形状不对（字段改名等） | 502 `upstream_bad_response`（**日志里带上是哪个字段**，这是适配层出问题，不是上游抖动） |
| 我们自己的每 IP 限流 | 429 `rate_limited`（沿用全站那个码） |

⚠️ `not_found` / `invalid_input` / `rate_limited` / `upstream_unavailable` 都已在
`services/api/src/error-codes.test.ts` 的 `KNOWN_CODES` 里；**新增的只有 `ranked_busy` 与
`upstream_bad_response`** ⇒ 那两条要同时加到那个清单里，并决定前端拿它们说什么话（§7.3）。

---

## 5. 缓存、并发与限流（冻结）

### 5.1 缓存按**上游 URL**记，不按我们的端点记

`/api/ranked/status` 与 `/api/ranked/live` 都用 `/live` 这一份数据 ⇒
**缓存键 = 上游 URL**，两个端点共享同一条缓存、也共享同一次"合并并发"。
否则同一秒里两个标签页各打一次上游，缓存反而让额度花得更快。

| 上游 URL | TTL | 理由 |
|---|---|---|
| `/live` | **10 秒** | 面板写着"实时"，而上游自己只缓存 5 秒；10 秒是"看起来实时"与"额度"之间的平衡 |
| 心跳 | **30 秒** | 心跳一分钟才一条，30 秒足够 |
| `/leaderboard` | **60 秒** | 排行榜一分钟变不了几名 |
| `/weekly-race`（含任意周） | **60 秒** | 同上；历史周其实可以更长，但统一一个数更简单 |

### 5.2 合并并发（single-flight）

同一个 URL 同时有 N 个请求在飞时，**只打一次上游**，其余等同一份结果。
⚠️ 这一条是**必须**的，不是优化：面板会自动刷新，只要有几个标签页同时开着，
没有它就会出现"同一秒打 10 次上游"，而额度是 500/10min。

### 5.3 全局上游预算（防止自己把额度烧光）

- 计数窗口：**60 秒**，上限 **40 次上游调用**（额度是 50 次/分钟，留 20% 余量）。
- 超预算时：**不再打上游**，直接回上次的好数据（`stale: true`）并在服务端日志里喊一句。
- ⚠️ 这一条会让"上游其实很健康、但我们在自我限流"看起来像"上游慢了" ⇒
  **日志里必须能分辨**（`[ranked] 本分钟上游预算用尽(40)` 与 `[ranked] 上游故障`是两句话）。

### 5.4 兜底（stale-if-error）

- 上游失败/超预算时，回**上一份好数据**，`stale: true`，并把 `fetchedAt` 一起给出去
  ⇒ 界面说「这是 N 秒前的数据」+ 一颗重试（与「实时分享」的 `refreshFailed` 同一形状）。
- 旧数据**最多留 10 分钟**；超过就回 503（宁可说实话，也不拿一份十分钟前的东西冒充实时）。
- ⚠️ 每个 URL **只留一份**旧数据（不做多版本）：这一栏要的是"最近一次成功"。

### 5.5 每 IP 限流与其它

- 我们的四个端点：**每 IP 每分钟 60 次**（自动刷新最快 10 秒一次 ⇒ 正常用户 6 次/分钟；
  60 是很宽的上限，只挡脚本）。沿用 `services/api/src/auth/ratelimit.ts` 的 `hit()`。
- 上游超时：**8 秒**（`AbortSignal.timeout`，与 `seeds/upstream.ts` 同一手法）。
- 主入口网络失败时，**对兜底入口重试一次**（`https://mcsrranked.com/api`）；
  ⚠️ 只在**网络错误/超时**时重试，4xx/5xx 不重试（那是上游在回答我们，不是网络问题）。
- 上游地址与超时可配：`MCSR_RANKED_API_BASE`（默认主入口）、`MCSR_RANKED_TIMEOUT_MS`。
  ⚠️ 它们同时是**测试的桩入口**（`services/api` 的测试靠替换 `globalThis.fetch` 杜绝真实网络，
  与 `seeds-proxy.test.ts` 同一条纪律）。
- 上游调用一律带 `user-agent: mcsr-helper/0.3 (+https://mcsrhelper.com)`（对第三方的基本礼貌，
  也让对方能认出我们）。

---

## 6. 页面与交互（冻结）

### 6.1 路由与四个标签页

| 路由 | 面板 |
|---|---|
| `/ranked` | ⇒ **重定向**到 `/ranked/status`（`<Navigate replace>`） |
| `/ranked/status` | ① 状况与人数（**默认页**） |
| `/ranked/live` | ② 实时高分对局 |
| `/ranked/elo` | ③ Elo 排行榜 |
| `/ranked/weekly` | ④ 周赛榜单 |
| `/ranked/<其它>` | 404 |

- 四个标签页是**真链接**（与「实时分享」两个标签页同一条理由：分享出去的 URL、刷新、
  前进后退都要落在同一屏），当前页用 `aria-current="page"` 标出来。
- ⚠️ `/ranked` 必须**真的有路由**：`homerender.tsx` 有一条"可点的栏目必须在 `App.tsx` 里有真路由"
  的守卫，而侧栏那一行指向 `/ranked`（§8）。重定向那一行就是它的答案，别用 `milestone` 规避。
- ⚠️ **只有当前标签页会去取数**（另外三个不挂载）⇒ 一次只有一个轮询在跑。
  这与"四个轮询同时打"是 4 倍的额度差。

### 6.2 ① 状况与人数 `/ranked/status`

| 元素 | 规则 |
|---|---|
| 服务状态徽章 | `state` → 文案与颜色：`1` 正常（绿）/ `0` 故障（红）/ `2` 等待（黄）/ `3` 维护（蓝）—— **四种都要有话说**，不许只判 up/down |
| 心跳详情 | `ping` → 「延迟 380 ms」；`null` → 「延迟未知」（不是 0） |
| 24 小时可用率 | `uptime24` → 「24 小时可用率 100%」（`1` → 100%）；`null` → 整行不渲染 |
| 实时人数 | `players` → 大号数字 + 「人正在玩 Ranked」；`null` → 「—」+ 一句"暂时读不到" |
| 新鲜度 | 「N 秒前更新」（本地计时每秒往前走，与看板同一条做法） |
| 失败 | 有旧数据 ⇒ 旧数据 + 「上次刷新失败了…」+ 重试；没旧数据 ⇒ 一句错误 + 重试 |

⚠️ **`players` 是 `null` 与 `players === 0` 是两件事**：前者是"没读到"，后者是"真的没人"。
界面上必须分得开（0 会印出「0 人正在玩」，那是真话；null 印出「—」）。

### 6.3 ② 实时高分对局 `/ranked/live`

- **排序**：`avgElo` 降序，`avgElo` 相同再按 `key` 升序（稳定排序，与全站列表同一条规矩）。
  `avgElo` = 两人 `eloRate` 的**非 null 平均**；一人 null 就用另一个人的值；
  两人都 null ⇒ `null`，**排最后**（不是排最前：未定级不该占榜首）。
- **取前 10**（上游今天 10–14 场，所以正常情况下是全部）。
- **卡片**（一行，左右对称）—— 字段顺序按用户原话：**玩家名 → elo → #排名 → 当前进度 → 当前时间**：

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  HufterL              1658   #161                     #163   1656      WhyIP   │
│  nether.find_bastion  2:21                             12:30  story.enter_the_end│
│  ────────────────────────────  已进行 15:18  ────────────────────────────────  │
│  ▸ 展开直播（1 个）                                                            │
└────────────────────────────────────────────────────────────────────────────────┘
   左半边 = 玩家 A：名字 / elo / #排名 / 进度标识 / 那个节点的时间
   右半边 = 玩家 B：**同一组字段、镜像摆放**（名字与 #排名 靠最外侧）
   中间   = 这场比赛已经进行的时间（currentTime）
```

  ⚠️ `timelineType` **原样显示**（英文标识，见 §7.2）—— 上面那张草图里的
  `nether.find_bastion` 就是**界面上真正会出现的字面**，不要把它「翻译」成中文。
  ⚠️ 一人没有 `timeline` ⇒ 那一格渲染 `—`（**不删**：删掉会让左右不对称）。
  ⚠️ 两人顺序固定为"elo 高的在左"（null 排后），这样同一场比赛在两次刷新之间**不会左右乱跳**。
- **点击展开两个直播框**：
  - 只在 **`liveUrl` 存在**时渲染那一侧的框；一项都没有 ⇒ 整张卡片没有展开入口（不是一颗点不动的按钮）。
  - 嵌哪些：`livePlatform ∈ {twitch, youtube, bilibili}`（CSP 允许的那三个），
    其余域名（kick 等）**给外链**（新窗口），并说明"这个平台不能内嵌"。
  - ⚠️★ **点击才加载 iframe**（沿用 `components/ClickToPlayEmbed.tsx` 的做法）：
    一屏 10 张卡片最多 20 个直播框，全部预先加载会把浏览器与带宽打满，
    而这台服务器只有 1 核。
  - 地址由 `packages/shared` 里现成的嵌入函数拼（Twitch 必须带 `parent`，见 §11 的一条测试）。
- **空态**：此刻没有对局 ⇒ 「现在没有直播中的对局。」（不是空白，也不是"加载中"）。
- **轮询**：**10 秒**，页面不可见时停（回到前台先推本地时钟再立刻刷一次 —— 与看板同形）。

### 6.4 ③ Elo 排行榜 `/ranked/elo`

- 顶部：**赛季 12** + 「2026-09-15 → 2026-12-30」（**上游给的是秒**，`startsAt/endsAt`，
  显示按**本地时区**还是 UTC？⇒ 与本仓其它日期一致：按**本地时区**渲染，
  因为用户在本地读日历；时间戳原样给出去，格式化只在界面那一层做）。
- 表格：**排名 / 昵称 / elo / highest / phasepoint**（用户原话的五个字段）。
  ⚠️ 上游每条还带着 `country`，**我们不发、也不显示**：用户没要这一列，而"给每个国家配一面旗"
  要另备一份图标资源（emojify 还是图片、缺旗怎么办），那是另一次需求（§9）。
- ⚠️★ **排名列用 `eloRank`**（并列会重复、并列之后跳号），**不是下标 + 1**。
- 取**前 100**（上游给 150）。⚠️ 并发取到第 100 名时如果正好卡在并列中间，**照上游给的原样显示**
  （不做"补齐并列"这种自作聪明的处理）。
- 空态：赛季刚开、一条都没有 ⇒ 「这个赛季还没有人上榜。」
- 轮询：**60 秒**。

### 6.5 ④ 周赛榜单 `/ranked/weekly`

- 默认 `GET /api/ranked/weekly`（本周）。
- 顶部：**第 103 周** + **4 个种子**（主世界 / 下界 / 末地 / RNG）+ 截止时间（本地时区）。
- 表格：**排名 / 昵称 / 时间 / elo / 排名（elorank）**（用户原话的五个字段）。
- 翻页：
  - 「上一周」`id - 1`，「下一周」`id + 1`（`id` 取**响应里**的那个）。
  - **下一周在 `id >= latestId` 时禁用**（上游对未开赛的周回 400）。
  - **上一周在 `id <= 1` 时禁用**（`id = 0` 会被上游当成"本周"，第 -1 周是一个真实但不可达的记录 §10）。
  - ⚠️ 翻页用**真链接**（`/ranked/weekly?id=102`？还是 `/ranked/weekly/102`？）
    ⇒ 用**路径** `/ranked/weekly/:id`（与 §6.1 那张表一致），真链接、可刷新、可分享。
- 时间格式：**`m:ss.mmm`**（`244241` → 「4:04.241」），超过一小时是 `h:mm:ss.mmm`。
  ⚠️ 它必须是**纯函数**（`packages/shared` 里，能被测试钉住），不要写在组件里 ——
  本仓的立场：能被断言的那一半不要藏在组件里。
- 空态：这一周还没有人完赛 ⇒ 「这一周还没有人完赛。」
- 轮询：**60 秒**（历史周不轮询：`id < latestId` 时**完全不刷新**，那些数据不会再变了）。

### 6.6 四种整体画面（每一栏都要有，且必须能被断言）

| 画面 | 要求 |
|---|---|
| 正常 | 数据 + 「N 秒前更新」 |
| 加载中（第一次） | 「加载中…」 |
| 失败·无旧数据 | 一句话 + **可点**的重试 |
| 失败·有旧数据 | **保留旧数据** + 「上次刷新失败了，下面是 N 秒前的数据」+ 重试（**绝不清空**） |
| 上游给了空集合 | 各自的空态（"没有对局"≠"加载中"≠"出错了"） |

---

## 7. i18n（冻结清单）

命名空间 `ranked.*`（与 `block` 短名一致）。中文值写给实现者，英文值由实现者写、**必须零汉字**。

### 7.1 栏目名与标签页

| key | 中文 | 英文（**冻结**） |
|---|---|---|
| `nav.ranked` | 「Ranked 实时信息」 | **"Ranked now"** |
| `home.desc.ranked` | 「正在打的对局、在线人数、排行榜与周赛。」 | "Who is playing right now: live matches, online count, leaderboards and the weekly race." |
| `ranked.tabStatus` | 「状况」 | "Status" |
| `ranked.tabLive` | 「高分对局」 | "Top matches" |
| `ranked.tabElo` | 「排行榜」 | "Leaderboard" |
| `ranked.tabWeekly` | 「周赛」 | "Weekly race" |

⚠️ 英文名**不能叫 "Ranked live" 或 "Live"**：侧栏「直播」已经是 "Live"，
而本仓为"侧栏出现两个 Live"这种事花过一轮。`ranked.tabLive` 在标签页里是安全的
（作用域在这一栏内部），但**栏目名**必须与 "Live" 分得开。

### 7.2 当前进度（`timeline.type`）—— **英文原样 + 词条表**

用户 2026-09-16 的裁决：**界面暂时显示英文原样**，同时在 `zh-CN.ts` 里配好对应的词条，
值先写成英文，**用户稍后自行校准并翻译**。

形状（`packages/shared/src/ranked/timeline.ts`）：

```ts
/** 上游 timeline.type → 我们的词条 key。**扁平 key**（上游的命名空间深度不一）。 */
export const TIMELINE_LABEL_KEYS: Record<string, string> = {
  'story.enter_the_nether': 'ranked.timeline.enterTheNether',
  'nether.find_fortress': 'ranked.timeline.findFortress',
  'nether.find_bastion': 'ranked.timeline.findBastion',
  'projectelo.timeline.blind_travel': 'ranked.timeline.blindTravel',
  'story.follow_ender_eye': 'ranked.timeline.followEnderEye',
  'story.enter_the_end': 'ranked.timeline.enterTheEnd',
  'end.enter_end_portal': 'ranked.timeline.enterEndPortal',
  'end.kill_dragon': 'ranked.timeline.killDragon',
  // …今天实测出现过的都在这里；上游加了新值 ⇒ **回落到原样显示**，不会印出裸 key
};

/** 认不出就回原样（**绝不**返回 key 本身，也绝不返回空串）。 */
export function timelineLabel(type: string | null, t: (k: string) => string): string { … }
```

- ⚠️★ **回落到原始标识**是这条设计的核心：上游随时可能加一个 `nether.find_ruined_portal`，
  而界面必须**照样有话说**。`t()` 查不到 key 时 i18next **原样返回 key**
  （见 `sharerender.tsx` 文件头那条注释）⇒ 直接 `t(...)` 会印出 `ranked.timeline.xxx`，
  这正是 §11 里"裸 key 泄漏"那条扫描要抓的东西。
- ⚠️ `zh-CN.ts` 里这些**值先写成英文原文**（用户要自己校准）。**不许**留空、
  **不许**写成 `TBD`（那会在界面上印出 TBD）。
- 词条 key 的**存在性**由渲染自检逐条断言（表里有 N 条就断言 N 条，与「实时分享」的 `FROZEN_KEYS` 同一手法）。

### 7.3 其余词条（面板用）

| key | 中文 |
|---|---|
| `ranked.statusUp/statusDown/statusPending/statusMaintenance` | 「正常」/「故障」/「等待」/「维护」 |
| `ranked.statusPing` | 「延迟 {{ms}} ms」 |
| `ranked.statusPingUnknown` | 「延迟未知」 |
| `ranked.statusUptime` | 「24 小时可用率 {{pct}}%」 |
| `ranked.players` | 「{{n}} 人正在玩 Ranked」 |
| `ranked.playersUnknown` | 「人数暂时读不到」 |
| `ranked.playersZero` | 「现在没有人在玩 Ranked」 |
| `ranked.liveTitle` / `ranked.liveEmpty` | 「正在直播的高分对局」/「现在没有直播中的对局。」 |
| `ranked.liveFrom` | 「{{total}} 场里按平均 elo 取前 10」 |
| `ranked.liveExpand` / `ranked.liveCollapse` | 「展开直播（{{n}} 个）」/「收起直播」 |
| `ranked.liveNoStream` | 「这一场没有人在直播」 |
| `ranked.liveExternal` | 「这个平台不能内嵌，在新窗口打开」 |
| `ranked.progress` | 「当前进度」 |
| `ranked.matchTime` | 「已进行 {{time}}」 |
| `ranked.eloTitle` | 「Elo 排行榜」 |
| `ranked.season` | 「赛季 {{n}}」 |
| `ranked.seasonRange` | 「{{from}} → {{to}}」 |
| `ranked.colRank/colNickname/colElo/colHighest/colPhasePoint` | 「排名」/「昵称」/「elo」/「最高」/「阶段分」 |
| `ranked.eloEmpty` | 「这个赛季还没有人上榜。」 |
| `ranked.weeklyTitle` | 「周赛」 |
| `ranked.weeklyNumber` | 「第 {{n}} 周」 |
| `ranked.weeklyEndsAt` | 「截止 {{when}}」 |
| `ranked.weeklySeed` | 「种子」 |
| `ranked.weeklyPrev/Next` | 「上一周」/「下一周」 |
| `ranked.colTime` / `ranked.colEloRank` | 「时间」/「elo 排名」 |
| `ranked.weeklyEmpty` | 「这一周还没有人完赛。」 |
| `ranked.updatedAgo` | 「{{secs}} 秒前更新」（**复用实时分享那条的措辞与做法**，但 key 归本栏目） |
| `ranked.refreshFailed` | 「上次刷新失败了，下面是 {{secs}} 秒前的数据。」 |
| `ranked.loadFailed` | 「读不到数据。」 |
| `ranked.retry` | 复用 `common.retry`（不新写） |
| `ranked.errBusy` | 「上游有点忙，稍后再试。」 |
| `ranked.errUnavailable` | 「上游暂时读不到，稍后再试。」 |
| `ranked.errBadResponse` | 「上游返回的数据看不懂，已经记下来了。」 |
| `ranked.errNotFound` | 「没有这一周。」 |
| `ranked.errRateLimited` | 复用全站的 `rate_limited` 文案 |
| `ranked.unknown` | 「—」（占位符本身也要有词条：`—` 在两种语言里都一样，但**不许**在组件里写死） |

⚠️ `ranked.unknown` 这条看着多余，其实是**故意的**：组件里写死一个 `—` 的话，
中文界面与英文界面就再也没法分开调（本仓在别处吃过"两种语言的空占位不一样"的亏）。

---

## 8. 导航与 block 短名（冻结）

```ts
// apps/web/src/lib/nav.ts —— 放在 seeds 之后、profile 之前
{ to: '/ranked', labelKey: 'nav.ranked', block: 'ranked', milestone: '' },
```

`block` 短名 `ranked` 同时连着**四样东西**（改它等于同时改四处）：

1. 侧栏小方块的 CSS：`.sidebar__block--ranked`（`styles.css`）
2. 首页那一句说明：`home.desc.ranked`（少了首页会印裸 key，`check:home` 会红）
3. 词条命名空间：`ranked.*`
4. `/ranked` 路由（`App.tsx` 里必须真有；`homerender.tsx` 那条守卫会红）

⚠️ 与「排位赛种子」（`/seeds`，英文 "Ranked seeds"）**名字要分得开**：
一个讲"种子"，一个讲"现在正在发生什么"。

---

## 9. 这次明确不做（逐条给理由）

| 不做 | 理由 |
|---|---|
| 落库 / 缓存表 | 上游给的就是"此刻"，存下来只会产生"库里的时刻"与"上游的时刻"两份真相 |
| 用户页 / 点名字跳转 | 上游有 `/users/{identifier}`，但那是**另一个栏目**的体量（含赛季史、成就、统计）；这一轮只做用户点名的那四块 |
| 比赛详情 / 种子详情 | `/matches/{id}` 与我们的 `排位赛种子` 有重叠，且 `liveMatches` **没有 match id**（§2.2） |
| 历史赛季排行榜 | 上游支持 `?season=`，但用户只要"当前赛季"；加一个赛季选择器是一次独立需求 |
| 第 -1 周 | 它真实存在（43 条），但 `0` 是"本周"的别名 ⇒ 正常翻页永远到不了它（§10 记着） |
| 嵌入 Twitch/YouTube/B站 之外的平台 | 要改 CSP 的 `frame-src`，那是一次独立的安全决策（§2.4） |
| 未定级玩家过滤 | `eloRate: null` 是真实状态（周赛冠军就可能没定级），过滤掉等于把榜单第一删掉 |
| 国家 / 国旗一列 | 用户没要这一列，而上游给的 `country` 要变成界面上的一面旗，得另备一份资源（emoji？图片？缺旗怎么办）—— 一次独立需求 |
| 把上游数据写进任何**公开**接口的响应 | 公开面零泄漏那条纪律（§11.1 第 6 条）仍然适用于新端点 |

---

## 10. 边界与已知限制（实现者与评审都要知道）

1. **上游没有 SLA，也没有 API key**。500/10min 是**共享**额度（全世界的调用者按 IP 分），
   我们只是把它缓存起来，并不能保证它永远够用。
2. **`max-age=14400` 的响应头与文档说的 5 秒不一致**（§2.1）⇒ 面板"冻住"时先查它。
3. **周数不单调**：`0` = 本周的别名，`-1` 是真实存在的第 -1 周且**不可达**。
   翻页边界按 §6.5，**显示用响应里的 id**。
4. **`liveMatches` 没有 id** ⇒ 卡片没有外链、React key 用 uuid 对；
   同一场比赛在两次刷新之间玩家顺序稳定（按 elo 排），但**卡片顺序会随 elo 变化**。
5. **未定级（`eloRate: null`）是常态不是异常**：周赛冠军今天就是 null。
6. **赛季刚开时 `phasePoint` 全是 0**：不要把它当成"字段坏了"。
7. **上游字段可能悄悄改**（`highest` 就不在文档里）⇒ §11.1 有一组"形状守卫"用例，
   形状对不上时**回 502 并记日志**，不是把 `undefined` 印到界面上。
8. 本栏目**不产生任何内容**（只读代理）⇒ 没有审核、没有权限、没有审计（除了错误日志）。

---

## 11. 验收与验证清单（给 verifier / reviewer 用）

### 11.1 服务端：`services/api/src/ranked.test.ts`（**真打 HTTP 到我们自己的 app，但上游用桩**）

⚠️ 与 `seeds-proxy.test.ts` 同一条纪律：**替换 `globalThis.fetch`，绝不出真实网络**
（一个测试意外打到第三方 API 是这一条最不能犯的错）。

- [ ] 四个端点各自的**正常路径**：字段逐个断言（不是"有没有 data"），含
      `serverNow` / `fetchedAt` / `stale: false`
- [ ] ★ **TTL**：TTL 内的第二次请求**不打上游**（桩的调用计数 == 1）；过了 TTL 再打一次（== 2）
- [ ] ★★ **合并并发**：`Promise.all` 十个并发请求 ⇒ 上游调用计数 **== 1**
- [ ] ★ **兜底**：上游 500 / 超时 / 非 JSON ⇒ 有旧数据时回 `stale: true` + 旧数据；无旧数据时 503
- [ ] ★ **预算**：把预算调到 2，连打 5 次 ⇒ 上游只被打了 2 次，后 3 次是兜底/503，且日志能分辨
- [ ] 上游 429 ⇒ 503 `ranked_busy`；上游形状不对 ⇒ 502 `upstream_bad_response`（日志带字段名）
- [ ] ★★ **排序与取前 10**：夹具含一场 avgElo 最高但**一人 null** 的、一场两人都 null 的
      ⇒ 两人都 null 的**排最后**、一人的按另一个人的值算
- [ ] ★★ **排名用 eloRank 不用下标**：夹具里造 `…,3,3,5,…`（并列 + 跳号）
      ⇒ 输出必须原样是 `3,3,5`
- [ ] ★ `highest` 缺失 ⇒ `null`（不是 `undefined`、不是 0）
- [ ] ★ **周赛 id**：请求 `/weekly/0` 时**响应里的 id 是上游给的那个**（103），
      不是请求里那个（0）；请求未来周 ⇒ 404 `not_found`；请求非整数 ⇒ 400
- [ ] ★ `timeline: null` / `liveUrl: null` / `players` 只有一个 ⇒ 形状仍然是合法的 `[A, B]`，缺的一侧是 null 字段
- [ ] ★ 直播平台判定：twitch/youtube/bilibili 认得出，kick 等是 `null`，**从 URL 解析而不是字符串包含**
- [ ] 每 IP 限流：超过 60 次/分钟 ⇒ 429 `rate_limited`
- [ ] `Cache-Control: no-store` 在四个端点上
- [ ] ★ **公开面零泄漏**：四个端点**匿名可访问**（200），响应里**不含** `live_shares` 那类别的栏目数据；
      同时既有公开接口（`/api/resources` 等）的响应里**不含** `ranked` 相关的新字段
- [ ] `error-codes.test.ts`：`ranked_busy` / `upstream_bad_response` 两条已进 `KNOWN_CODES`
- [ ] 时间格式化纯函数：`244241` → `4:04.241`；`3_600_000` → `1:00:00.000`；边界与进位各有断言

### 11.2 前端：`apps/web/scripts/rankedrender.tsx`（新增，进 `check:all`，中英各一遍）

⚠️ 与 `sharerender.tsx` 同一个形状：**渲染的是纯视图**（容器自己取数，
`renderToStaticMarkup` 不跑 effect ⇒ 页面级断言全是空跑）。

- [ ] 四个标签页：名字、真链接、`aria-current` 在**当前**那一页上
- [ ] ① 四种状态徽章各有话说（**不许**只判 up/down）；`players` 的 0 与 null **是两句不同的话**
- [ ] ② 卡片：左右两半**各自五个字段**都在；`timeline: null` ⇒ `—`；一人 null elo ⇒ `—`；
      两名玩家顺序 = elo 高的在左
- [ ] ② 展开入口：有 `liveUrl` 时在、一个都没有时**不在**（正反两半）；
      **展开态在初始产物里不存在**（点击才有）；「这一个平台不能内嵌」那一句在 kick 那一档出现
- [ ] ③ 表格五列都在；**并列排名照原样印**（夹具 `3,3,5`）；赛季号与起止都在
- [ ] ④ 顶部：周数、**4 个种子**、截止时间；表格五列；
      `id >= latestId` 时「下一周」**禁用**、`id <= 1` 时「上一周」**禁用**（正反两半）
- [ ] 四种整体画面（正常/加载中/失败无旧数据/失败有旧数据）各自的产物，**旧数据那一档绝不清空**
- [ ] ★ **进度词条表逐条断言**：`TIMELINE_LABEL_KEYS` 的每一条在两种语言里都存在且有真值；
      **未知标识**回落到原样（给一个不在表里的 type，产物里必须出现那个标识本身）
- [ ] 裸 key 泄漏扫描 + 字面 `**` 扫描（沿用既有那两条）+ 英文界面零汉字
- [ ] **组数探针**（手抄的组数，删掉一段就红）
- [ ] ★ **没有 CSS 规则的新类名** —— 本栏目新增的每个类名都要能在 `styles.css` 里找到
      （`pending.md §5.70`：全仓没有门禁能发现这件事，所以这一条只能靠人+这份清单）

### 11.3 门禁与 mutation

- [ ] `pnpm -F @mcsr/web check:all` **两遍**，同一份字节，exit 0
- [ ] 上游**只**在测试的桩里出现：`grep -r "mcsrranked.com" services/api/src` 只命中
      配置默认值与注释（**测试文件里不许有真实域名**）
- [ ] ★ mutation ①：删掉 single-flight ⇒ 「十个并发只打一次上游」必须**红**
- [ ] ★ mutation ②：把 TTL 改成 0 ⇒ 「TTL 内不打第二次」必须**红**
- [ ] ★ mutation ③：排名改成 `index + 1` ⇒ 「并列排名」那条必须**红**
- [ ] ★ mutation ④：周数改成用请求里的 id ⇒ 「请求 0 拿到 103」那条必须**红**
- [ ] ★ mutation ⑤：排序改成"取第一个玩家的 elo" ⇒ 「一人 null 的那一场」必须**红**
- [ ] ★ mutation ⑥：把 `timelineLabel` 的回落从"原样"改成 `t(key)` ⇒ 未知标识那条必须**红**
- [ ] 每处 mutation 之后**字节级还原**并用哈希证明（本仓一贯做法）

---

## 12. 风险表

| 风险 | 影响 | 处置 |
|---|---|---|
| **上游限流 500/10min 且我们只有一个出口 IP** | 打满之后整栏变成旧数据 | 服务端 TTL 缓存 + single-flight + 40 次/分钟的全局预算（§5）；超预算只回旧数据 |
| **上游响应头写 `max-age=14400`**（与文档的 5 秒不符） | 数据可能"冻住"而没有任何报错 | 我们自己的 TTL 是唯一保证；§12 这一条 + 面板上的「N 秒前更新」能直接看出来 |
| 上游字段悄悄改名（`highest` 就不在文档里） | 界面上印出 `undefined` | 读的那一遍过形状守卫；对不上回 502 + 日志带字段名，绝不透传 |
| 第三方整体挂掉 | 面板空白 | stale-if-error（≤10 分钟）+ 说清"这是 N 秒前的数据"+ 重试 |
| 直播框把浏览器打满 | 页面卡顿 | **点击才加载** iframe；一屏最多 20 个框，只有点开的那张才加载 |
| 上游把某个平台加了/换了域名 | 嵌不进去 | 只有白名单那三个内嵌，其余给外链；**改白名单要同时想 CSP** |
| 赛季/周次切换时的边界（0 是别名、-1 存在） | 显示"第 0 周"或翻到不存在的周 | §6.5 的三条边界 + §11.1 的三条用例 |
| 这一栏把 1 核服务器拖慢 | 全站变慢 | 只有当前标签页轮询、页面不可见时停、响应只带界面要的字段、`no-store` 不加压 |

---

## 13. 冻结的契约总表（实现者按这张表对齐，不要自己发明）

| 类别 | 冻结值 |
|---|---|
| 路由 | `/ranked`（⇒ 302 到 `/ranked/status`）、`/ranked/status`、`/ranked/live`、`/ranked/elo`、`/ranked/weekly`、`/ranked/weekly/:id` |
| `block` 短名 | `ranked` |
| 词条命名空间 | `ranked.*`（+ `nav.ranked` + `home.desc.ranked`） |
| 英文栏目名 | **"Ranked now"** |
| 我们的端点 | `GET /api/ranked/status`、`/live`、`/elo`、`/weekly`、`/weekly/:id` |
| 上游端点 | `api.mcsrranked.com` 的 `/live`、`/leaderboard`、`/weekly-race`、`/weekly-race/{id}`；`status.mcsrranked.com` 的心跳 |
| 上游兜底入口 | `https://mcsrranked.com/api`（**只在网络错误时**重试一次） |
| 缓存 TTL | `/live` 10s、心跳 30s、`/leaderboard` 60s、`/weekly-race*` 60s |
| 缓存键 | **上游 URL**（两个端点共享同一份 `/live`） |
| 全局上游预算 | 40 次 / 60 秒，超了只回旧数据 |
| 兜底留存 | 每个 URL 保留最近一次成功，最多 10 分钟 |
| 上游超时 | 8 秒（`MCSR_RANKED_TIMEOUT_MS`） |
| 每 IP 限流 | 60 次 / 分钟 |
| 排行榜条数 | 前 **100**（上游 150） |
| 高分对局条数 | 前 **10**，按 `avgElo` 降序、`key` 升序 |
| 排序口径 | `avgElo` = 非 null 的平均；两人都 null ⇒ null ⇒ **排最后** |
| 排名口径 | **上游的 `eloRank`**（并列会重复、之后会跳号） |
| 进度显示 | `timeline.type` **原样**（词条表 + 未知回落，§7.2） |
| 直播嵌入白名单 | `twitch` / `youtube` / `bilibili`（CSP 允许的三个）；其余给外链 |
| 兜底码 | 404 `not_found`（周不存在）、400 `invalid_input`、429 `rate_limited`、503 `ranked_busy`、503 `upstream_unavailable`、502 `upstream_bad_response` |
| 时间单位 | 上游 `Date` = **秒**（赛季起止、心跳、周赛 endsAt）；`Time` = **毫秒**（对局时间、周赛成绩） |
| 周数边界 | `0` = 本周的别名（显示用响应里的 id）；`-1` 存在但不可达；「下一周」在 `id >= latestId` 时禁用、「上一周」在 `id <= 1` 时禁用 |
| 刷新间隔 | 状况 30s / 对局 10s / 排行榜 60s / 周赛 60s（历史周**不刷新**）；页面不可见时停 |
| 渲染自检 | `apps/web/scripts/rankedrender.tsx` → `check:ranked`，进 `check:all` |
| 迁移 | **没有**（不落库） |
| CSP | **不动** |
