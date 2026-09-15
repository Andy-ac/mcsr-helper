# Ranked 实时信息（ranked live info）：可实施方案（冻结契约）

> 2026-09-16 · 用户第五个栏目 · 上游是 **MCSR Ranked 公开 REST API**（第三方）
>
> **修订（2026-09-16，用户第二次裁决后）**：数据由**访客浏览器直连上游**（用**访客自己的 IP**），
> 不走我们的服务器代理 —— 但**心跳那一个端点必须例外**，因为
> `status.mcsrranked.com` **不发 CORS 头**（§2.5），浏览器读不到它。
> 这次修订同时改了两件事：数据通路（§3）与周数显示（§6.5）。
>
> 与文档冲突时以 **§2 的实测结果**为准 —— 上游文档有四处与真实响应不一致。

---

## 0. 一句话结论

新增一个**公开**栏目「Ranked 实时信息」（`/ranked`），顶部一排**四个标签页**：
**状况与人数**、**实时高分对局**、**Elo 排行榜**、**周赛榜单**。

数据通路分两半（§3）：

| 面板 | 谁发请求 | 为什么 |
|---|---|---|
| ①②③④ 的**主体数据** | **访客的浏览器**直连 `api.mcsrranked.com` | 用**访客自己的 IP**，不占服务器那条 500 次 / 10 分钟的额度 |
| ① 的**服务心跳** | **我们的服务器**（`/api/ranked/status`） | 那个域名没有 CORS 头，浏览器**读不到**（§2.5） |

⇒ **我们只新增一个端点**（心跳），它 30 秒才打一次上游（每分钟 ≤2 次）。
**不落库、不加迁移、不动 `frame-src`**；只把 CSP 的 `connect-src` 精确放开两个主机（§2.6）。

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

后续两次补充（2026-09-16）：

> 周赛 id 不单调问题：-1周在本应用里显示为"第0周"，第一周开始往后一一对应
> 至于"缓存数字"的问题，尽可能规划架构使得目前的请求ip是应用使用者的ip发出的，
> 而不占用服务器ip限流资源

| 原话 | 落地 |
|---|---|
| 大栏目、放在「排位赛种子」下面 | `NAV_SECTIONS` 里 `seeds` 之后、`profile` 之前；路由前缀 `/ranked`（§8） |
| 每个内容做成一栏，在顶部放成一排 | **四个标签页**（用户选）：`/ranked/status` `/ranked/live` `/ranked/elo` `/ranked/weekly`（§6.1） |
| ① 状况 + 实时人数 | 心跳（**我们的服务器**）+ `/live` 的 `data.players`（**访客浏览器**）（§6.2） |
| ② 高分对局 | 按**两人 elo 平均**降序取前 10，卡片左右对称，点击展开直播框（§6.3） |
| ③ 排行榜 | 前 100 + 顶部赛季号与起止（§6.4） |
| ④ 周赛 | 默认本周、可前后翻页；顶部周数 + **4 个种子** + 截止时间（§6.5） |
| 当前进度显示 | **英文原样**，同时 `zh-CN.ts` 里为每个已知标识配词条（值先写英文，用户稍后校准）（§7.2） |
| 周数显示 | `id = -1` ⇒ **「第 0 周」**；`id ≥ 1` ⇒ 「第 N 周」一一对应（§6.5） |
| 请求 IP | **访客的 IP**（浏览器直连）；只有心跳走我们的服务器（§3） |

---

## 2. 上游：实测事实（**权威**，写代码前先读这一节）

### 2.1 端点与延迟（2026-09-16 从**生产服务器**实测）

| 我们/浏览器用的端点 | 实测延迟 | 谁去请求 |
|---|---|---|
| `GET https://api.mcsrranked.com/live` | 351 ms | 浏览器（②，以及①的人数） |
| `GET https://api.mcsrranked.com/leaderboard` | 268 ms | 浏览器（③） |
| `GET https://api.mcsrranked.com/weekly-race` | 233 ms | 浏览器（④） |
| `GET https://api.mcsrranked.com/weekly-race/{id}` | ≈230 ms | 浏览器（④ 翻页） |
| `GET https://status.mcsrranked.com/api/status-page/heartbeat/mcsrranked` | 68 ms | **我们的服务器**（① 心跳，CORS 不允许浏览器直连） |

两个等价入口（文档明说）：`https://api.mcsrranked.com`（文档说缓存 5 秒，**推荐**）与
`https://mcsrranked.com/api`（文档说缓存 30 秒，**兜底**）。
浏览器侧的两条入口都会用（§5.3），所以我们**不依赖**"哪个更新"这种说法 —— 实测见 §2.5。

⚠️ 上游限流 **500 次 / 10 分钟 / IP**。改成访客直连之后，这个额度是**每个访客自己的**，
而我们服务器**只剩心跳**这一处消耗（30 秒一次 ⇒ 每分钟 ≤2 次）。

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

### 2.3 ★ 五处"文档/直觉"与实测不一致（**每一条都改到了设计**）

| # | 事实 | 后果 |
|---|---|---|
| 1 | `highest` **不在文档 schema 里**，真实位置是 `users[].seasonResult.highest` | ③ 的 highest 取 `seasonResult.highest`，并且**必须有兜底**（缺了就渲染 `—`，不是 `undefined`） |
| 2 | `eloRank` 是**竞赛排名**：实测 `…,13,14,14,14,17,18,19,19,21,…` —— **有并列、并列之后有跳号** | ③ 的排名列**必须用 `eloRank`**，不能用"下标 + 1"（那样会印出一个与 elo 矛盾的排名）。夹具里**必须有一条并列** |
| 3 | ② 的 `data` 是**以 uuid 为键的对象**，`players` 是**数组**；字段是**驼峰 `liveUrl`** | 配对要按 uuid 查表；拼错字段名（`liveurl`）在 TS 里不会报错（响应是 `unknown`）⇒ 解析层要过 zod（§4.3） |
| 4 | ② 的 `timeline` **可以是 null**（实测 20 个玩家块里 6 个 null）；`eloRate` 也可以是 null | 「当前进度」null ⇒ 渲染 `—`（**不删**：删掉会让左右不对称）；平均 elo 的 null 口径见 §6.3 |
| 5 | 周赛 id 空间**不单调**：`104` → 400；`0` → **返回第 103 周**（0 是"当前"的别名）；`-1` → **真的存在**（43 条，endsAt 2026-04-30）；`-2/-3/-10` → 400 | 翻页与显示按 §6.5 冻结；**周数显示用响应里的 `data.id`**，不是 URL 里那个 |

其它实测值（写进夹具，免得下一个人以为是随手编的）：

- ③ 前 150 名里 `seasonResult` 的键**恒为** `{eloRate, eloRank, phasePoint, highest, phaseHighest}`，
  `highest`/`phasePoint` **零缺失**、`eloRate` **零 null**（今天如此，不代表永远；兜底仍然要有）。
- 赛季 12：`2026-09-15T00:00:00Z` → `2026-12-30T00:00:00Z`；`phasePoint` **全为 0**（第 1 阶段刚开始）
  ⇒ ③ 的 phasepoint 列今天是一排 0，夹具不要假设它非零。
- 本周周赛 id 103：`endsAt` = `2026-09-21T00:00:00Z`；四个种子今天**相同**（周赛是"全维度同一个种子"）；
  `flags` 新周是 `207`、老周（52、1）是 **null** ⇒ 我们不显示 flags，但形状上必须允许 null。
- ② 直播率：一次采样 10 场 / 20 个玩家块中 **12 个有 `liveUrl`**；`uuid` 配对 **10/10 全中**；
  `players` 恒为 2 ⇒ 配对失败仍要有兜底（缺块时那一侧显示 `—`），但它是**防御**，不是常态。
- ② 出现过的 `timeline.type`（今天）：`nether.find_bastion`、`nether.find_fortress`、
  `projectelo.timeline.blind_travel`、`story.enter_the_end`、`story.enter_the_nether`
  ⇒ 命名空间深度不一（两段、三段都有），所以词条表用**扁平 key**（§7.2）。
- **周 -1 是唯一的负周**：`-2/-3/-10` 与 `104` 一样回 400 `race is not found`。
  ⇒ 「上一周」的链条是 `103, 102, …, 2, 1, -1`，**第 -1 周之后没有更早的了**。

### 2.4 CSP 与直播框

`deploy/Caddyfile` 的 CSP（现读第 74 行）：

```
frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.twitch.tv
          https://player.bilibili.com https://www.bilibili.com;
connect-src 'self';
```

- ⇒ **Twitch / YouTube / B站 的直播框能嵌**（`frame-src` 已经允许），**`frame-src` 不动**。
- ⇒ 其它平台（kick 等）嵌不了 ⇒ 给外链。
- ⇒ 访客直连上游**必须放开 `connect-src`**（§2.6），这是这一轮**唯一**的 CSP 改动。

### 2.5 ★★ CORS 与缓存头：**决定数据通路的两条实测**

```
主机                                      access-control-allow-origin   cache-control        浏览器能直连吗
api.mcsrranked.com                        *                             max-age=14400 + ETag ✅ 能
mcsrranked.com/api                        *                             no-store             ✅ 能
status.mcsrranked.com                     （**没有这个头**）              max-age=14400 + ETag ❌ **不能**
```

两条结论：

1. **心跳只能由我们的服务器去取**（那个主机不发 CORS 头 ⇒ 浏览器读不到响应体，
   而这不是"配置问题"，是对方没打算让浏览器直连）。
   ⇒ 我们**必须**保留一个极小的服务端端点；这一处会占服务器 IP 的额度，
   而它 30 秒才一次（每分钟 ≤2 次，占额度的 4%）。
2. ★ **`api.mcsrranked.com` 带 `ETag` + `cache-control: max-age=14400`（4 小时）**
   ⇒ 浏览器不特别指定的话，**第二次请求可能根本不发出去**，直接用 4 小时前的缓存
   ⇒ 「实时」面板会**冻住**，而且从网络上完全看不出来。
   ⇒ **每一次直连都必须 `cache: 'no-store'`**（`fetch` 的选项）。
   本仓有过同一个坑：`fetchLiveChannelsFresh` 就是为此存在的（那条注释里有实测证据）。

### 2.6 CSP 的改动（**唯一的改动，精确到主机**）

```
connect-src 'self' https://api.mcsrranked.com https://mcsrranked.com;
```

- 只放开这两个主机（**不加通配符**、不加 `https:`）。
- `status.mcsrranked.com` **不进 CSP**：它由我们的服务器请求，浏览器的 CSP 管不到它。
- 改在 `deploy/Caddyfile`（配置即代码，每次部署都会同步过去）。

---

## 3. 数据通路（**修订后**）

用户在 2026-09-16 的第二次裁决：**尽可能让请求的 IP 是使用者的 IP**，不占服务器那条限流额度。

| | 形状 | 结论 |
|---|---|---|
| **A（当前方案）** | ②③④ 与 ① 的人数：**浏览器直连上游**；① 的心跳：我们的服务器（CORS 所迫） | **选它**。访客自己的 IP 花自己的额度；服务器的额度只被心跳用掉一点点（≤2 次/分钟） |
| B（原方案，**已否决**） | 四个面板全走我们的服务器代理 | ❌ 服务器一个出口 IP 承担所有访客 ⇒ 500/10min 会被几十个人同时开着页面打满；用户明确要求避开这一点 |
| C 定时任务预热 | 服务端定时抓 + 存快照 | ❌ "实时"没了；周赛翻页仍要现取；而且同样占服务器 IP 的额度 |

**A 的代价（写在明面上，不是遗漏）**：

1. **我们看不到前端的失败**。上游挂了、被扩展拦了、CORS 哪天变了 —— 服务端日志里一个字都没有，
   只有访客屏幕上那句"读不到"。⇒ 界面上的错误必须**说得具体**（§6.6），
   而且每一条响应都要带上"这是什么时候的数据"（§4.4）。
2. **访客的 IP 会暴露给第三方**（mcsrranked.com 会看到 IP、UA、Referer）。
   ⇒ 请求里 `credentials: 'omit'`（不带 cookie）与 `referrerPolicy: 'no-referrer'`（不带来源页），
   把能少给的东西少给。
3. **没有服务端兜底**：浏览器两条入口都失败时，只能用手上那份旧数据 + 一句错误（§6.6）。
   ⛔ 这一轮**不做**"失败时回退到我们服务器"的那条路 —— 那等于把被否决的 B 又建一遍，
   而且是一条**几乎不会被走到**的代码（本仓对"没人走的代码会烂掉"有记录）。
   真到了那一天（上游把 CORS 撤掉），那是**一次独立改动**，不是这一轮的范围。

---

## 4. 数据形状（冻结）

### 4.1 一边一个来源，一边一份形状

界面**只认下面这四份形状**，不认上游的原始响应 —— 上游形状 → 我们的形状的转换
住在 `packages/shared/src/ranked/`（**同一份代码**给浏览器用；心跳那一支服务器也用）。

| 面板 | 谁产这份数据 | 上游 |
|---|---|---|
| ① 心跳 | 我们的 `GET /api/ranked/status` | `status.mcsrranked.com` |
| ① 人数 | 浏览器直连 | `/live` 的 `data.players` |
| ② 对局 | 浏览器直连 | `/live` 的 `data.liveMatches` |
| ③ 排行榜 | 浏览器直连 | `/leaderboard` |
| ④ 周赛 | 浏览器直连 | `/weekly-race` / `/weekly-race/{id}` |

### 4.2 我们唯一的端点（心跳）

```ts
// GET /api/ranked/status   —— 公开、no-store
interface RankedStatusResponse {
  monitor: {
    /** 0 down / 1 up / 2 pending / 3 maintenance —— 原样给前端，映射在界面那一层。 */
    state: 0 | 1 | 2 | 3;
    /**
     * ★ 上游那一条心跳的时间，**原样一串文本**（`2026-09-15 13:36:27`），不是时间戳。
     * ⚠️ 那串字符**没有时区**，`new Date()` 会按**本机时区**解释 ⇒ 同一份数据在不同机器上
     *    会算出不同的时刻，显示值也会随部署机器漂。我们只把它当**文本**显示
     *    （「最后心跳 13:36:27」），一个时间戳都不换算。
     */
    checkedAt: string;
    ping: number | null;
    /** 24 小时可用率 0–1。 */
    uptime24: number | null;
  };
  serverNow: number;   // 服务端取一次
  fetchedAt: number;   // 这份心跳是什么时候取的
  stale: boolean;      // 是不是兜底的旧数据
}
```

**拒绝码**：上游 5xx/超时 ⇒ 503 `upstream_unavailable`（有旧数据时照旧给旧数据 + `stale: true`）；
上游 429 ⇒ 503 `ranked_busy`；形状不对 ⇒ 502 `upstream_bad_response`（日志带字段名）。
⚠️ `ranked_busy` 与 `upstream_bad_response` 是**新码** ⇒ 要同时进
`services/api/src/error-codes.test.ts` 的 `KNOWN_CODES`，并决定前端拿它们说什么（§7.3）。

### 4.3 浏览器侧的形状（与上游解耦）

```ts
interface RankedLiveMatch {
  /** 卡片的 key：两个 uuid 排序后拼起来（上游没有 match id）。 */
  key: string;
  currentTime: number;                 // 毫秒
  avgElo: number | null;               // 两人 elo 的非 null 平均；都 null 时是 null（排最后）
  players: [RankedLivePlayer, RankedLivePlayer];   // 顺序固定：elo 高的在左（null 排后）
}
interface RankedLivePlayer {
  nickname: string;
  eloRate: number | null;
  eloRank: number | null;
  timelineType: string | null;         // 原样给界面（词条映射在界面那一层）
  timelineTime: number | null;         // 毫秒
  liveUrl: string | null;
  livePlatform: 'twitch' | 'youtube' | 'bilibili' | null;   // 由 liveUrl 的**域名**判出来
}
interface RankedLiveResponse { matches: RankedLiveMatch[]; total: number; fetchedAt: number }  // 最多 10 场

interface RankedEloResponse {
  season: { number: number; startsAt: number; endsAt: number };   // 秒
  users: Array<{ rank: number | null; nickname: string; eloRate: number | null;
                 highest: number | null; phasePoint: number | null }>;   // 前 100
  fetchedAt: number;
}

interface RankedWeeklyResponse {
  /** ★ 上游**响应里**的周数（请求 0 会拿到 103）；显示与翻页都用它。 */
  id: number;
  endsAt: number;                      // 秒
  seed: { overworld: string; nether: string; theEnd: string; rng: string };
  entries: Array<{ rank: number; nickname: string; timeMs: number;
                   eloRate: number | null; eloRank: number | null }>;
  fetchedAt: number;
}

interface RankedPlayersResponse { players: number | null; fetchedAt: number }
```

★ **解析层必须"宽容"**（`parseRankedLive(body): RankedLiveResponse | null` 这样的形状）：

- 上游字段缺失 / 类型不对 ⇒ 那**一格**取 `null`，**不让整份数据变成 null**
  （一份 liveMatches 里有 14 场，其中一场的 `timeline` 坏了不该让 13 场都消失）。
- 整份响应根本不是我们要的东西（`status !== 'success'` 或缺 `data`）⇒ 回 `null`，
  由调用方按"读不到"处理。
- ⚠️ 它**不 zod 全量校验**（一份 150 条 × 8 字段的响应逐条过 schema 是白花 CPU，
  而且上游加字段就会红）；用的是**逐格类型检查 + 兜底**。
  判据写在实现里：**"这一格能不能渲染"**，而不是"这份响应合不合 schema"。

### 4.4 每一份数据都带 `fetchedAt`

界面必须能说「N 秒前的数据」。⚠️ **它是本地时钟**（`Date.now()` 在拿到响应时记一次），
不是上游给的时间戳 —— 上游那个是"上游生成它的时刻"，两者差一次网络往返，
而我们要说的是"**你屏幕上这份东西有多旧**"。

---

## 5. 缓存、刷新与礼貌（冻结）

### 5.1 客户端是唯一的一层（除了心跳）

| 面板 | 刷新间隔 | 说明 |
|---|---|---|
| ① 状况与人数 | **15 秒**（一个定时器里同时做两件事：我们的心跳 + 直连的人数） | 心跳上游本身一分钟才一条，我们的端点缓存 30 秒 |
| ② 高分对局 | **10 秒** | 面板写着"实时" |
| ③ 排行榜 | **60 秒** | 一分钟变不了几名 |
| ④ 周赛（本周） | **60 秒** | 同上 |
| ④ 周赛（**历史周**） | **不刷新** | 那些数据不会再变了（省的是访客自己的额度） |

- ★ **只有当前标签页在轮询**（其它三个不挂载）⇒ 一次只有一路定时器。
- ★ **页面不可见时停**；回到前台**先推本地时钟、再立刻刷一次**（与看板同一条做法）。
- ★★ 每一次直连都必须 **`cache: 'no-store'`**（§2.5 的实测：上游给了 `max-age=14400`）。
  请求选项冻结为：`{ cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal }`
  —— ⚠️ **只带 CORS 安全列表内的头**（`accept`），**不带任何自定义头**
  （带了会触发预检，而上游的 `OPTIONS` 我们没有验过）。

### 5.2 上游入口的兜底（仍然用访客的 IP）

一次请求的形状：主入口 `api.mcsrranked.com` → **只在网络错误/超时时**对
`mcsrranked.com/api` 重试一次（4xx/5xx **不重试**：那是上游在回答我们）。
两条都失败 ⇒ 按"读不到"处理（用手上的旧数据 + 一句错误）。

### 5.3 我们服务器那一处（心跳）的缓存与预算

- 心跳 TTL **30 秒**；single-flight（同一时刻只打一次上游）。
- 兜底：上游失败时回上一次的成功结果（`stale: true`），最多留 **10 分钟**；
  超过 ⇒ 503。
- 每 IP 限流 **60 次/分钟**（15 秒一刷 ⇒ 正常用户 4 次/分钟）。
- 上游超时 8 秒（`AbortSignal.timeout`）；地址与超时可配
  （`MCSR_RANKED_STATUS_TIMEOUT_MS`，测试用桩）。
- ⚠️ 这一处**不做**全局预算表：它每分钟最多 2 次真实上游调用，
  再加一层预算反而多一份状态（本仓对"没人走的分支"有记录）。

---

## 6. 页面与交互（冻结）

### 6.1 路由与四个标签页

| 路由 | 面板 |
|---|---|
| `/ranked` | ⇒ **重定向**到 `/ranked/status`（`<Navigate replace>`） |
| `/ranked/status` | ① 状况与人数（**默认页**） |
| `/ranked/live` | ② 实时高分对局 |
| `/ranked/elo` | ③ Elo 排行榜 |
| `/ranked/weekly` | ④ 周赛（本周） |
| `/ranked/weekly/:id` | ④ 周赛（指定周） |
| `/ranked/<其它>` | 404 |

- 四个标签页是**真链接**（可刷新、可分享），当前页 `aria-current="page"`。
- ⚠️ `/ranked` **必须真的有路由**：`homerender.tsx` 有一条"可点的栏目必须在 `App.tsx` 里有真路由"
  的守卫，而侧栏那一行指向 `/ranked`。重定向那一行就是它的答案，别用 `milestone` 规避。
- ⚠️ ④ 的翻页也走**路径**（`/ranked/weekly/102`），不是查询串：真链接、可刷新、可分享。

### 6.2 ① 状况与人数 `/ranked/status`

| 元素 | 规则 |
|---|---|
| 服务状态徽章 | `state` → `1` 正常 / `0` 故障 / `2` 等待 / `3` 维护 —— **四种都要有话说**，不许只判 up/down |
| 心跳详情 | `ping` → 「延迟 380 ms」；`null` → 「延迟未知」（不是 0） |
| 24 小时可用率 | `uptime24` → 「24 小时可用率 100%」；`null` → 整行不渲染 |
| 实时人数 | `players` → 大号数字；`null` → 「—」+「人数暂时读不到」 |
| 新鲜度 | 「N 秒前更新」（本地计时每秒往前） |
| 失败 | 有旧数据 ⇒ 旧数据 + 「上次刷新失败了…」+ 重试；没有 ⇒ 一句错误 + 重试 |

⚠️ **`players === 0` 与 `players === null` 是两件事**：前者印「现在没有人在玩 Ranked」（真话），
后者印「—」+「人数暂时读不到」。两种都要有词条。

### 6.3 ② 实时高分对局 `/ranked/live`

- **排序**：`avgElo` 降序，相同再按 `key` 升序（稳定排序）。`avgElo` = 两人 `eloRate` 的**非 null 平均**；
  一人 null 就用另一个人的值；两人都 null ⇒ `null`，**排最后**（未定级不该占榜首）。
- **取前 10**。
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

  ⚠️ `timelineType` **原样显示**（英文标识）—— 草图上那串就是界面上真正会出现的字面。
  ⚠️ 一人没有 `timeline` ⇒ 那一格渲染 `—`（**不删**：删掉会让左右不对称）。
  ⚠️ 两人顺序固定为"elo 高的在左"（null 排后），同一场比赛在两次刷新之间不会左右乱跳。
- **点击展开直播框**：
  - 只在 **`liveUrl` 存在**时渲染那一侧的框；一个都没有 ⇒ 整张卡片没有展开入口（不是一颗点不动的按钮）。
  - **点击才加载** iframe（沿用 `components/ClickToPlayEmbed.tsx`）：一屏最多 20 个框，
    全预加载会把浏览器与带宽打满。
  - 白名单（`livePlatform`）：`twitch` / `youtube` / `bilibili` 内嵌；其余**外链** + 一句说明。
    地址由 `packages/shared` 现成的嵌入函数拼（Twitch 必须带 `parent`，§11.2 有一条测试）。
- **空态**：此刻没有对局 ⇒ 「现在没有直播中的对局。」
- **轮询**：10 秒（§5.1）。

### 6.4 ③ Elo 排行榜 `/ranked/elo`

- 顶部：**赛季 12** + 「2026-09-15 → 2026-12-30」（上游给的是**秒**；按**本地时区**渲染，
  与本仓其它日期一致）。
- 表格：**排名 / 昵称 / elo / highest / phasepoint**。
  ⚠️ 上游每条还带着 `country`，**我们不发、也不显示**（§9）。
- ⚠️★ **排名列用 `eloRank`**（并列会重复、之后跳号），**不是下标 + 1**。
- 取**前 100**（上游 150）。第 100 名卡在并列中间时**照上游给的原样显示**。
- 空态：赛季刚开 ⇒ 「这个赛季还没有人上榜。」
- 轮询：60 秒。

### 6.5 ④ 周赛榜单 `/ranked/weekly` ★ 修订

- 默认 `GET /weekly-race`（本周）。
- 顶部：**周数** + **4 个种子**（主世界 / 下界 / 末地 / RNG）+ 截止时间（本地时区）。
- 表格：**排名 / 昵称 / 时间 / elo / elo 排名**（用户原话的五个字段）。

**★ 周数显示（用户 2026-09-16 的裁决）**：

```ts
// packages/shared/src/ranked/week.ts —— 纯函数，被测试逐值钉住
/** 上游的周 id → 界面上那个周数。上游把"第 0 周"记成 -1（唯一的负周）。 */
export function displayWeekNo(id: number): number {
  return id === -1 ? 0 : id;      // 1 起一一对应；-1 显示成第 0 周
}
```

**★ 翻页（不是 `id ± 1`，而是一个**跨过 0** 的阶梯函数）**：

```ts
/** 上一周：1 → -1（跨过 0，因为 0 是"本周"的别名）；-1 之后没有更早的了。 */
export function prevWeekId(id: number): number | null {
  if (id === -1) return null;     // 第 0 周是最早的一页
  if (id <= 1) return -1;         // 第 1 周的上一页是第 -1 周（显示为第 0 周）
  return id - 1;
}
/** 下一周：-1 → 1（同样跨过 0）；到最新周就没有了。 */
export function nextWeekId(id: number, latestId: number): number | null {
  if (id >= latestId) return null;
  if (id === -1) return 1;
  return id + 1;
}
```

- ⛔ **永远不请求 `id = 0`**：它是"本周"的别名，上游会回**另一周**的数据
  ⇒ 界面会闪一下然后跳到本周，而 URL 里写着 0。这两个函数**结构上**不会产出 0。
- **显示用的是响应里的 `data.id`**（不是 URL 里那个）：请求 0 会拿到 103，而我们要显示 103。
- 「下一周」在 `nextWeekId(...) === null` 时**禁用**；「上一周」同理。
  ⚠️ 禁用是**渲染成不可点**（不是渲染一个会 400 的链接）。
- 时间格式：**`m:ss.mmm`**（`244241` → 「4:04.241」），超过一小时是 `h:mm:ss.mmm`。
  ⚠️ 它是**纯函数**（`packages/shared/src/ranked/time.ts`，被测试钉住），不写在组件里。
- 空态：这一周还没有人完赛 ⇒ 「这一周还没有人完赛。」
- 轮询：本周 60 秒；**历史周不轮询**。

### 6.6 四种整体画面（每一栏都要有，且必须能被断言）

| 画面 | 要求 |
|---|---|
| 正常 | 数据 + 「N 秒前更新」 |
| 加载中（第一次） | 「加载中…」 |
| 失败·无旧数据 | 一句**具体**的话 + **可点**的重试（§3 的代价 1：前端失败我们看不见，所以话要说得具体） |
| 失败·有旧数据 | **保留旧数据** + 「上次刷新失败了，下面是 N 秒前的数据」+ 重试（**绝不清空**） |
| 上游给了空集合 | 各自的空态（"没有对局" ≠ "加载中" ≠ "出错了"） |

---

## 7. i18n（冻结清单）

命名空间 `ranked.*`（与 `block` 短名一致）。中文值写给实现者；英文值由实现者写、**必须零汉字**。

### 7.1 栏目名与标签页

| key | 中文 | 英文（**冻结**） |
|---|---|---|
| `nav.ranked` | 「Ranked 实时信息」 | **"Ranked now"** |
| `home.desc.ranked` | 「正在打的对局、在线人数、排行榜与周赛。」 | "Who is playing right now: live matches, online count, leaderboards and the weekly race." |
| `ranked.tabStatus` | 「状况」 | "Status" |
| `ranked.tabLive` | 「高分对局」 | "Top matches" |
| `ranked.tabElo` | 「排行榜」 | "Leaderboard" |
| `ranked.tabWeekly` | 「周赛」 | "Weekly race" |

⚠️ 英文栏目名**不能叫 "Ranked live" / "Live"**：侧栏「直播」已经是 "Live"，
本仓为"侧栏出现两个 Live"花过一轮。`ranked.tabLive`（"Top matches"）在标签页内是安全的。

### 7.2 当前进度（`timeline.type`）—— **英文原样 + 词条表**

用户裁决：界面**暂时显示英文原样**，同时 `zh-CN.ts` 里配好对应词条（值先写英文），
**用户稍后自行校准翻译**。

```ts
// packages/shared/src/ranked/timeline.ts
/** 上游 timeline.type → 我们的词条 key。**扁平 key**（上游命名空间深度不一）。 */
export const TIMELINE_LABEL_KEYS: Record<string, string> = {
  'story.enter_the_nether': 'ranked.timeline.enterTheNether',
  'nether.find_fortress': 'ranked.timeline.findFortress',
  'nether.find_bastion': 'ranked.timeline.findBastion',
  'projectelo.timeline.blind_travel': 'ranked.timeline.blindTravel',
  'story.follow_ender_eye': 'ranked.timeline.followEnderEye',
  'story.enter_the_end': 'ranked.timeline.enterTheEnd',
  'end.enter_end_portal': 'ranked.timeline.enterEndPortal',
  'end.kill_dragon': 'ranked.timeline.killDragon',
  // …今天实测出现过的都在这里；上游加了新值 ⇒ **回落到原样显示**
};

/** 认不出就回原样（**绝不**返回 key 本身，也绝不返回空串）。 */
export function timelineLabel(type: string | null, t: (k: string) => string): string { … }
```

- ⚠️★ **回落到原始标识**是这条设计的核心：上游随时可能加一个新节点，界面必须**照样有话说**。
  i18next 查不到 key 时**原样返回 key** ⇒ 直接 `t(...)` 会印出 `ranked.timeline.xxx`，
  而那正是 §11.2"裸 key 泄漏"扫描要抓的东西。
- ⚠️ `zh-CN.ts` 里这些**值先写英文原文**（用户要自己校准）。**不许**留空、**不许**写 `TBD`。
- 词条 key 的**存在性**由渲染自检逐条断言（表里有 N 条就断言 N 条，与「实时分享」的 `FROZEN_KEYS` 同一手法）。

### 7.3 其余词条（面板用）

| key | 中文 |
|---|---|
| `ranked.statusUp/Down/Pending/Maintenance` | 「正常」/「故障」/「等待」/「维护」 |
| `ranked.statusPing` / `statusPingUnknown` | 「延迟 {{ms}} ms」/「延迟未知」 |
| `ranked.statusCheckedAt` | 「最后心跳 {{time}}」—— ⚠️ `{{time}}` 是上游那串 `2026-09-15 13:36:27` **原样**文本，**不做时区换算**（那串字符没有时区，`new Date()` 会按本机时区解释 ⇒ 显示值会随部署机器漂，而测试也会变成"看机器运气"） |
| `ranked.statusUptime` | 「24 小时可用率 {{pct}}%」 |
| `ranked.players` / `playersUnknown` / `playersZero` | 「{{n}} 人正在玩 Ranked」/「人数暂时读不到」/「现在没有人在玩 Ranked」 |
| `ranked.liveTitle` / `liveEmpty` | 「正在直播的高分对局」/「现在没有直播中的对局。」 |
| `ranked.liveFrom` | 「{{total}} 场里按平均 elo 取前 10」 |
| `ranked.liveExpand` / `liveCollapse` | 「展开直播（{{n}} 个）」/「收起直播」 |
| `ranked.liveNoStream` / `liveExternal` | 「这一场没有人在直播」/「这个平台不能内嵌，在新窗口打开」 |
| `ranked.matchTime` | 「已进行 {{time}}」 |
| `ranked.eloTitle` / `season` / `seasonRange` | 「Elo 排行榜」/「赛季 {{n}}」/「{{from}} → {{to}}」 |
| `ranked.colRank/Nickname/Elo/Highest/PhasePoint` | 「排名」/「昵称」/「elo」/「最高」/「阶段分」 |
| `ranked.eloEmpty` | 「这个赛季还没有人上榜。」 |
| `ranked.weeklyTitle` / `weeklyNumber` / `weeklyEndsAt` / `weeklySeed` | 「周赛」/「第 {{n}} 周」/「截止 {{when}}」/「种子」 |
| `ranked.weeklyPrev` / `weeklyNext` | 「上一周」/「下一周」 |
| `ranked.colTime` / `colEloRank` | 「时间」/「elo 排名」 |
| `ranked.weeklyEmpty` | 「这一周还没有人完赛。」 |
| `ranked.updatedAgo` | 「{{secs}} 秒前更新」 |
| `ranked.refreshFailed` | 「上次刷新失败了，下面是 {{secs}} 秒前的数据。」 |
| `ranked.loadFailed` | 「读不到数据。」 |
| `ranked.errBusy` / `errUnavailable` / `errBadResponse` | 「上游有点忙，稍后再试。」/「上游暂时读不到，稍后再试。」/「上游返回的数据看不懂，已经记下来了。」 |
| `ranked.unknown` | 「—」（占位符也要有词条：组件里写死 `—` 会让两种语言再也没法分开调） |

⚠️ 重试复用 `common.retry`，限流复用全站的 `rate_limited` 文案 —— 不新写。

---

## 8. 导航与 block 短名（冻结）

```ts
// apps/web/src/lib/nav.ts —— 放在 seeds 之后、profile 之前
{ to: '/ranked', labelKey: 'nav.ranked', block: 'ranked', milestone: '' },
```

`block` 短名 `ranked` 同时连着**四样东西**（改它等于同时改四处）：
① 侧栏小方块 CSS `.sidebar__block--ranked`；② 首页说明 `home.desc.ranked`（少了 `check:home` 会红）；
③ 词条命名空间 `ranked.*`；④ `/ranked` 路由（`App.tsx` 里必须真有）。

⚠️ 与「排位赛种子」（`/seeds`，英文 "Ranked seeds"）名字要分得开：一个讲种子，一个讲现在正在发生什么。

---

## 9. 这次明确不做（逐条给理由）

| 不做 | 理由 |
|---|---|
| **服务端代理 ②③④** | 用户要求用访客 IP；而且服务器一个出口 IP 承担全部访客会把 500/10min 打满（§3） |
| **"直连失败就回退到我们服务器"那条路** | 等于把被否决的 B 又建一遍，而且是一条几乎不会被走到的代码（会烂掉）。真需要时是一次独立改动（§3 代价 3） |
| 落库 / 缓存表 | 上游给的就是"此刻"；存下来只会产生两份真相 |
| 用户页 / 点名字跳转 | 上游有 `/users/{identifier}`，但那是另一个栏目的体量（赛季史、成就、统计） |
| 比赛详情 / 种子详情 | `liveMatches` **没有 match id**（§2.2），而种子详情与「排位赛种子」重叠 |
| 历史赛季排行榜 | 上游支持 `?season=`，但用户只要当前赛季；加赛季选择器是独立需求 |
| 国家 / 国旗一列 | 用户没要；上游的 `country` 要变成一面旗得另备资源（emoji？图片？缺旗怎么办） |
| 嵌入 Twitch/YouTube/B站 之外的平台 | 要改 `frame-src`，是一次独立的安全决策 |
| 过滤未定级玩家 | `eloRate: null` 是真实状态（周赛冠军今天就没定级），过滤掉等于把第一删掉 |
| 把上游数据写进任何**公开**接口的响应 | 「公开面零泄漏」那条纪律对新增端点同样适用（§11.1） |

---

## 10. 边界与已知限制（实现者与评审都要知道）

1. **上游没有 SLA、没有 API key**；500/10min 是**每个访客自己**的额度（改成直连之后），
   而一个访客开两个标签页就是两份在烧。
2. ★ **`api.mcsrranked.com` 的 `max-age=14400` + `ETag`**：不写 `cache: 'no-store'`
   就可能一直回浏览器缓存（面板冻住、网络面板里一条请求都没有）。**这是本栏目最容易犯的错。**
3. **心跳只能走我们的服务器**（那个主机没有 CORS 头）。它是我们唯一的上游流量。
4. **周数不单调**：`0` = 本周年别名（**永远不请求**）、`-1` = 第 0 周（**可达**）、
   `-2/-3` 不存在、`> latestId` 不存在。显示用响应里的 `id`。
5. **`liveMatches` 没有 id** ⇒ 卡片没有外链、key 用 uuid 对；玩家顺序按 elo 固定，但**卡片顺序会随 elo 变**。
6. **未定级（`eloRate: null`）是常态不是异常**。
7. **赛季刚开时 `phasePoint` 全是 0**：不是字段坏了。
8. **上游字段可能悄悄改**（`highest` 就不在文档里）⇒ 解析层逐格兜底 + 记一条日志（浏览器侧记 `console.warn`）。
9. **访客的 IP 会到达第三方**（这是用户为了避开服务器限流而选的代价）；我们只做
   `credentials: 'omit'` + `referrerPolicy: 'no-referrer'` 这两件能少给就少给的事。
10. 本栏目**不产生任何内容**（只读）⇒ 没有审核、没有权限、没有审计。

---

## 11. 验收与验证清单（给 verifier / reviewer 用）

### 11.1 服务端：`services/api/src/ranked.test.ts`（**上游用桩，绝不出真实网络**）

⚠️ 与 `seeds-proxy.test.ts` 同一条纪律：替换 `globalThis.fetch`。

- [ ] `GET /api/ranked/status` 正常路径：四个字段逐个断言 + `stale: false` + `no-store`
- [ ] ★ TTL 30 秒：TTL 内第二次请求**不打上游**（桩计数 == 1）；过了再打（== 2）
- [ ] ★★ single-flight：十个并发 ⇒ 上游计数 **== 1**
- [ ] ★ 兜底：上游 500 / 超时 / 非 JSON ⇒ 有旧数据时 `stale: true` + 旧数据；没有则 503
- [ ] 上游 429 ⇒ 503 `ranked_busy`；形状不对 ⇒ 502 `upstream_bad_response`（日志带字段名）
- [ ] 心跳解析：`heartbeatList['2']` 取**最后一条**；`uptimeList['2_24']`；缺字段 ⇒ null 而不是崩
- [ ] 每 IP 限流：> 60 次/分钟 ⇒ 429 `rate_limited`
- [ ] `error-codes.test.ts`：两个新码已进 `KNOWN_CODES`
- [ ] ★ **公开面零泄漏**：新端点匿名 200，且响应里不含其它栏目的数据；既有公开接口响应里不含 `ranked*` 新字段

### 11.2 共享解析层与纯函数（`packages/shared/src/ranked/`，测试放 `services/api`）

- [ ] ★ 解析是**纯函数**：同一份响应解析两次得到同样结果（不读时钟、不读全局状态）
- [ ] ★★ **排序与取前 10**：夹具含"avgElo 最高但一人 null"、"两人都 null"两场
      ⇒ 两人都 null **排最后**、一人的按另一个人的值算；并列按 `key` 升序
- [ ] ★★ **排名用 eloRank 不用下标**：夹具造 `…,3,3,5,…` ⇒ 输出原样是 `3,3,5`
- [ ] ★ `highest` 缺失 ⇒ `null`（不是 `undefined`、不是 0）
- [ ] ★ **周数映射与翻页**（逐值）：
      `displayWeekNo(-1) === 0`、`displayWeekNo(1) === 1`、`displayWeekNo(103) === 103`；
      `prevWeekId(1) === -1`、`prevWeekId(-1) === null`、`prevWeekId(103) === 102`；
      `nextWeekId(-1, 103) === 1`、`nextWeekId(103, 103) === null`；
      ★ **两个函数都永不返回 0**（这一条要单独断言）
- [ ] ★ **周赛 id 用响应里的**：桩返回 `data.id = 103` 而请求是 `/weekly/0` ⇒ 结果是 103
- [ ] ★ **时间格式化**：`244241 → "4:04.241"`、`3_600_000 → "1:00:00.000"`、`0 → "0:00.000"`、
      `59_999 → "0:59.999"`、进位边界各一条
- [ ] ★ 直播平台判定：twitch / youtube（含 `youtu.be`）/ bilibili 认得出，kick 等是 `null`，
      **按域名解析**（`https://evil.com/?x=twitch.tv` 不许被判成 twitch）
- [ ] ★ 宽容解析：`timeline: null` / `liveUrl: null` / `players` 只有一个 / `data` 缺一个 uuid
      ⇒ 形状仍然合法（缺的一侧是 null 字段），**不返回 null**
- [ ] ★ 词条表：`TIMELINE_LABEL_KEYS` 的每一条在两种语言里都存在
- [ ] ★ `timelineLabel('unknown.thing')` ⇒ 原样返回 `'unknown.thing'`（**不是** key）

### 11.3 前端：`apps/web/scripts/rankedrender.tsx`（新增，进 `check:all`，中英各一遍）

- [ ] 四个标签页：名字、真链接、`aria-current` 只在当前那一页
- [ ] ① 四种状态徽章各有话说；`players` 的 **0 与 null 是两句不同的话**
- [ ] ② 卡片：左右两半**各自五个字段**都在；`timeline: null` ⇒ `—`；一人 null elo ⇒ `—`；
      两人顺序 = elo 高的在左
- [ ] ② 展开入口：有 `liveUrl` 时在、一个都没有时**不在**（正反两半）；**展开态在初始产物里不存在**
- [ ] ③ 五列都在；**并列排名照原样印**（`3,3,5`）；赛季号与起止都在
- [ ] ④ 顶部：周数（**第 -1 周那份渲染成「第 0 周」**）、4 个种子、截止时间；五列；
      `id >= latestId` ⇒「下一周」**禁用**；`id === -1` ⇒「上一周」**禁用**（正反两半）
- [ ] ★★ **直连请求的选项**：这一栏唯一能验的地方就是"那个函数被调用时带了什么"——
      用记录器替换 `fetch`，断言 **`cache: 'no-store'`**、`credentials: 'omit'`、
      `referrerPolicy: 'no-referrer'`、**没有自定义头**（带了会触发预检）
      ⇒ 这是本栏目**最容易犯、也最难从画面上看出来**的错（§10 第 2 条），必须有断言
- [ ] ★ 直连兜底：主入口网络错误 ⇒ 打兜底入口一次；主入口 500 ⇒ **不**重试（正向对照）
- [ ] 四种整体画面各自的产物，**旧数据那一档绝不清空**
- [ ] ★ **进度词条表逐条断言** + **未知标识回落**（给一个不在表里的 type，产物里要出现它本身）
- [ ] 裸 key 泄漏扫描 + 字面 `**` 扫描 + 英文界面零汉字 + 组数探针
- [ ] ★ **新增的每个类名都要能在 `styles.css` 里找到规则**（`pending.md §5.70`：全仓没有门禁能发现这件事）

### 11.4 门禁与 mutation

- [ ] `pnpm -F @mcsr/web check:all` **两遍**，同一份字节，exit 0
- [ ] ★ **CSP 逐字核对**：`deploy/Caddyfile` 的 `connect-src` 恰好是
      `'self' https://api.mcsrranked.com https://mcsrranked.com`（**没有通配符**、没有 `https:`），
      而 `frame-src` **一个字没改**
- [ ] `grep -r "mcsrranked.com" services/api/src apps/web/src` 只命中预期那几处
      （**测试文件里不许出现真实域名** —— 上游一律用桩）
- [ ] ★ mutation ①：去掉 `cache: 'no-store'` ⇒ 「直连请求的选项」那条必须**红**
- [ ] ★ mutation ②：`displayWeekNo(-1)` 改成 `-1` ⇒ 第 0 周那条必须**红**
- [ ] ★ mutation ③：`prevWeekId`/`nextWeekId` 改成 `id ± 1` ⇒ 「永不返回 0」必须**红**
- [ ] ★ mutation ④：排名改成 `index + 1` ⇒ 并列排名那条必须**红**
- [ ] ★ mutation ⑤：排序改成"取第一个玩家的 elo" ⇒ 一人 null 那场必须**红**
- [ ] ★ mutation ⑥：`timelineLabel` 的回落改成 `t(key)` ⇒ 未知标识那条必须**红**
- [ ] ★ mutation ⑦：删掉 single-flight ⇒ 十并发只打一次上游那条必须**红**
- [ ] 每处 mutation 之后**字节级还原**并用哈希证明

---

## 12. 风险表

| 风险 | 影响 | 处置 |
|---|---|---|
| ★ **上游 `max-age=14400` + ETag** | 面板冻住，而且我们的网络日志里什么都看不到 | 每次直连都 `cache: 'no-store'`，并有专门的渲染断言与 mutation（§11.3/§11.4） |
| **我们看不到前端失败**（直连的代价） | 上游挂了只有访客知道 | 错误文案说具体 + 「N 秒前更新」常显；心跳那条路仍然过我们（能记日志） |
| **上游哪天撤掉 CORS** | 三个面板同时失效 | 界面上有明确错误 + 重试；真发生就做一次独立改动（加服务端兜底） |
| **浏览器扩展拦第三方请求** | 个别用户永远"读不到" | 错误里说明"可能是网络或扩展拦了"；手上有旧数据就留着 |
| **访客 IP 到达第三方** | 隐私 | 用户明确选了这个代价；只做 `omit` + `no-referrer` 两件事 |
| 上游字段悄悄改名 | 界面上出现 `—` 一片 | 逐格兜底 + `console.warn`；心跳那条在我们的日志里 |
| 一个访客开多个标签页 | 烧他自己的额度（可能 429） | 只有当前标签页轮询、不可见时停、历史周不刷新 |
| 直播框把浏览器打满 | 卡顿 | 点击才加载；一屏最多 20 个 |
| 心跳那一处把服务器 IP 的额度花掉 | 每分钟 ≤2 次（4%） | TTL 30 秒 + single-flight；不做预算表（多一份没人走的状态） |

---

## 13. 冻结的契约总表（实现者按这张表对齐，不要自己发明）

| 类别 | 冻结值 |
|---|---|
| 路由 | `/ranked`（⇒ 重定向 `/ranked/status`）、`/ranked/status`、`/ranked/live`、`/ranked/elo`、`/ranked/weekly`、`/ranked/weekly/:id` |
| `block` 短名 | `ranked` |
| 词条命名空间 | `ranked.*`（+ `nav.ranked` + `home.desc.ranked`） |
| 英文栏目名 | **"Ranked now"** |
| 我们**唯一**的端点 | `GET /api/ranked/status`（**心跳**；CORS 所迫） |
| 浏览器直连的上游 | `api.mcsrranked.com` 的 `/live`、`/leaderboard`、`/weekly-race{,/{id}}`（**主入口**）；`mcsrranked.com/api` 同路径（**兜底**，只在网络错误时） |
| 直连请求选项 | `cache: 'no-store'`、`credentials: 'omit'`、`referrerPolicy: 'no-referrer'`、**不带自定义头** |
| 心跳缓存 | TTL 30 秒 + single-flight + 兜底 ≤10 分钟 |
| 心跳限流 | 每 IP 60 次/分钟 |
| 刷新间隔 | 状况 15s（心跳 + 人数） / 对局 10s / 排行榜 60s / 周赛本周 60s / **历史周不刷新**；页面不可见时停 |
| 排行榜条数 | 前 **100**（上游 150） |
| 高分对局条数 | 前 **10**，`avgElo` 降序、`key` 升序 |
| 排序口径 | `avgElo` = 非 null 平均；两人都 null ⇒ null ⇒ **排最后** |
| 排名口径 | 上游的 **`eloRank`**（并列会重复、之后会跳号） |
| 进度显示 | `timeline.type` **原样** + 词条表 + 未知回落（§7.2） |
| 周数显示 | `displayWeekNo(-1) = 0`，`≥1` 一一对应；**显示用响应里的 `data.id`** |
| 翻页 | `prevWeekId(-1) = null`、`prevWeekId(1) = -1`、`nextWeekId(-1, latest) = 1`、`nextWeekId(latest, latest) = null`；**永不产出 0** |
| 直播嵌入白名单 | `twitch` / `youtube` / `bilibili`（CSP 允许的三个）；其余给外链；**点击才加载** |
| 兜底码 | **我们那一个端点**：429 `rate_limited` / 503 `ranked_busy` / 503 `upstream_unavailable` / 502 `upstream_bad_response`。**浏览器直连那三处不走拒绝码**：`RankedDirectError` 的四种原因（`network` / `http` / `not_found` / `bad_response`）由 `lib/rankedErrors.ts` 映射成界面文案（"这一周不存在"那一档来自上游的 400） |
| 时间单位 | 上游 `Date` = **秒**（赛季起止、心跳、周赛 endsAt）；`Time` = **毫秒**（对局时间、周赛成绩） |
| CSP | `connect-src 'self' https://api.mcsrranked.com https://mcsrranked.com`（**只改这一处**）；`frame-src` 不动 |
| 渲染自检 | `apps/web/scripts/rankedrender.tsx` → `check:ranked`，进 `check:all` |
| 迁移 | **没有**（不落库） |
