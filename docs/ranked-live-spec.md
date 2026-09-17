# Ranked 实时信息（ranked live info）：可实施方案（冻结契约）

> 2026-09-16 · 用户第五个栏目 · 上游是 **MCSR Ranked 公开 REST API**（第三方）
>
> **修订（2026-09-16，用户第二次裁决后）**：数据由**访客浏览器直连上游**（用**访客自己的 IP**），
> 不走我们的服务器代理 —— 但**心跳那一个端点必须例外**，因为
> `status.mcsrranked.com` **不发 CORS 头**（§2.5），浏览器读不到它。
> 这次修订同时改了两件事：数据通路（§3）与周数显示（§6.5）。
>
> ★★ **修订（2026-09-19，用户第三次裁决，四条）**——这一版改的是**界面内容**，
> **数据通路的裁决一个字没改**（仍然是"面板直连 / 心跳走我们"，见 §3、§13）：
>   1. **① 状态栏只留四格 + 在线人数**（§6.2）：Game Server / API / Store / Wiki 各自的
>      **状态**与**最后更新时间**，下面是在线人数；**延迟、24 小时可用率、心跳历史、
>      解释性文字全部删掉**（连同词条 —— 两种语言各删四条）。
>      ⚠️ 那四格**仍然全部来自那个只能由服务器去取的主机**（CORS 所迫），
>      所以 §3 那张表里"① 的服务心跳"那一行现在是**四格**，不是一个。
>   2. **③ 排行榜显示前 150**（§6.4）：150 是**上游的硬上限且没有分页**
>      （实测 `count` / `page` 被静默忽略）⇒ 界面上**没有**"下一页"，句子也别去别处找。
>   3. **③ 顶部并排显示赛段**（§6.4）：赛段来自**第二个**端点 `/phase-leaderboard`
>      （实测 93 字节），**浏览器直连**（那个主机发 `*`）⇒ 排行榜面板从此是**两次**直连。
>   4. **④ 翻页移到顶部 + 手输周数跳转 + 「本周」**（§6.5）。
>   ⚠️ 这一版**没有**新增服务端端点、**没有**新依赖、**没有**新迁移。
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
| ① 的**服务心跳**（★★ 2026-09-19 起是**四格**，不是一个） | **我们的服务器**（`/api/ranked/status`） | 那个域名没有 CORS 头，浏览器**读不到**（§2.5）——**四格全在同一个主机上**，所以这一条不是"某一格例外"，而是"整条状态栏都只能走我们" |
| ③ 的**赛段**（★ 2026-09-19 加） | **访客的浏览器**直连（`/phase-leaderboard`） | 它在 `api.mcsrranked.com` 上，实测回 `access-control-allow-origin: *` ⇒ 按同一张表的规矩直连；**不新增端点**（§6.4） |

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

第三次补充（**2026-09-19**，改的是 ② 那一栏）：

> 4、ranked 实时信息高分对局全部展示，然后在顶部加入搜索栏搜索选手，新添一个按钮允许用户筛选只展示双方均直播的对局

口径（用户当场选定）：**全部**对局（首批 + 「加载更多」）、**本地**昵称搜索（不加请求/查询串）、
「双方均直播」= **两个人都有一条 `liveUrl`，任何平台都算**（不是 Twitch 限定）。
⇒ 落地在 §6.3、§7.3（五条新 key）、§11.2/§11.3、§13。

| 原话 | 落地 |
|---|---|
| 大栏目、放在「排位赛种子」下面 | `NAV_SECTIONS` 里 `seeds` 之后、`profile` 之前；路由前缀 `/ranked`（§8） |
| 每个内容做成一栏，在顶部放成一排 | **四个标签页**（用户选）：`/ranked/status` `/ranked/live` `/ranked/elo` `/ranked/weekly`（§6.1） |
| ① 状况 + 实时人数 | 心跳（**我们的服务器**）+ `/live` 的 `data.players`（**访客浏览器**）（§6.2） |
| ② 高分对局 | 按**两人 elo 平均**降序**全部展示**（首批 20 + 「加载更多」，★ 2026-09-19 取代"取前 10"），卡片左右对称，点击展开直播框（§6.3） |
| ② 顶部搜索栏搜索选手 | 昵称**子串**匹配、忽略大小写、两侧任一命中；**只在本地筛**（★ 2026-09-19，§6.3） |
| ② 「只展示双方均直播的对局」 | 一颗开关「只看双方都在直播」：两侧 `liveUrl` 均非 null（**任何平台**）（★ 2026-09-19，§6.3） |
| ③ 排行榜 | 前 **150**（★ 2026-09-19） + 顶部赛季号与起止 **+ 并排的赛段**（§6.4） |
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

### 3.1 ★ 2026-09-17：面板**一个字都没改**，多的是一个后台作业

上面那张表与三条代价**原样有效**。这一节只记一件**新增**的事，免得下一个人把它读成"B 又回来了"：

**用户的新裁决**：把「抓取 ranked 实时信息的 twitch 直播链接，自动添加至本应用的『直播』频道」
做成一个**小的 systemd 作业** —— `oneshot` + 5 分钟 timer，
`deploy/mcsr-helper-ranked-streams.{service,timer}`，代码 `services/api/src/ranked-streams.ts`，
与视频追踪那一对（`mcsr-helper-track.{service,timer}`）同形。

**它取的是什么**：上游**同一个公开** `/live`（`api.mcsrranked.com/live`，与面板直连的是同一个入口），
用**我们服务器自己的 IP**，**每轮恰好一次 GET**（一个进程跑完就退）。

**额度账（§2.1 的 500 次 / 10 分钟 / IP）**：

| 谁 | 节拍 | 占额度 |
|---|---|---|
| 心跳（`/api/ranked/status`，唯一被迫过我们的端点） | 30 秒 TTL ⇒ ≤2 次/分钟 | **4%** |
| **新增**：直播链接收录作业 | 5 分钟一轮 ⇒ 0.2 次/分钟 | **0.4%** |
| 合计 | | **≈ 4.4%** |

⚠️★ **这里刻意不写"约 8%"**：那个数是"最多每 30 秒一次"那一版设计的账 ——
也就是把收录挂在**请求路径**上的 `GET /api/ranked/live`（commit `a0a597f`）。
那条路**已经被这次裁决否掉**（它依赖的那个端点**没有调用者**：面板是浏览器直连的，
所以线上一个频道都不会被收录），5 分钟一版的作业比它**便宜十倍**。
⇒ 别照抄那 8%：写错的那个数会让下一个人以为额度快满了，而去优化一件不需要优化的事。

**为什么这不算把被否决的 B 方案又建一遍（三条判据，缺一条都不成立）**：

1. **没有任何访客可见的东西经过我们**：② 的对局面板仍旧浏览器直连，我们这边**一个新端点都没有加** ——
   反而**删掉了一个**（`GET /api/ranked/live`，见 §13 那张表）。作业的产物只进
   `live_channels`（「直播」栏目已有的那张表），不当任何响应的原料。
2. **它不在任何请求路径上**：访客的一次 GET 与它无因果关系，也不会等它
   （`live-feed.ts` 那 351 ms 的延迟今天只让作业多跑一会儿，没有人等）。
3. **它的量是常数**：0.2 次/分钟，**与访客数无关**。被否决的 B 恰恰是"量随访客数放大"
   （几十个人同时开着页面就把 500/10min 打满）—— 这两件事的形状不同，不是因为"量小"就都算数。

**失败怎么被人看到**（这一条同时是运维说明）：那一轮打**一行**到 stderr（journald 里是 err 级）
并**退出码 1** ⇒ systemd 把这一轮记成 `failed`。四档（上游 `unavailable` / `busy` / `bad_response`
+ 写库 `db`）的完整说法在 `ranked-streams.ts` 文件头第三节与那个 `.service` 的诊断表里。

**收录的规则是冻结的**（用户裁决，逐条）：只要 **twitch**；`display_name` **就是** twitch login
（不是选手的 MCSR 昵称）；标签 `["ranked"]`（**不加**任何额外字段标记来源）；
`sort_order = 1000`（排在编辑录的那些后面）；`live_video_id = NULL`；**只插不改**
（`DO NOTHING` 的 NULL 安全版本 —— `UNIQUE (platform, handle, live_video_id)` 对 NULL 不生效，
那是本仓踩过的坑）。⚠️★ 因此编辑想让某个自动收录的频道消失，正确的动作是**隐藏**，不是删除：
删掉会把三列腾空，下一轮它就回来了。完整版（含两条诚实的边界）在 `pending.md §5.97`。

---

## 4. 数据形状（冻结）

### 4.1 一边一个来源，一边一份形状

界面**只认下面这四份形状**，不认上游的原始响应 —— 上游形状 → 我们的形状的转换
住在 `packages/shared/src/ranked/`（**同一份代码**给浏览器用；心跳那一支服务器也用）。

| 面板 | 谁产这份数据 | 上游 |
|---|---|---|
| ① 心跳 | 我们的 `GET /api/ranked/status` | `status.mcsrranked.com`（**四格**） |
| ① 人数 | 浏览器直连 | `/live` 的 `data.players` |
| ② 对局 | 浏览器直连 | `/live` 的 `data.liveMatches` |
| ③ 排行榜 | 浏览器直连 | `/leaderboard`（**前 150**，上游的硬上限） |
| ③ 赛段 | 浏览器直连 | `/phase-leaderboard` 的 `data.phase`（★ 2026-09-19 加的第二次直连） |
| ④ 周赛 | 浏览器直连 | `/weekly-race` / `/weekly-race/{id}` |

### 4.2 我们唯一的端点（心跳）

```ts
// GET /api/ranked/status   —— 公开、no-store
interface RankedStatusComponent {
  /** ★ 上游 `heartbeatList` 的键（`"2"` … `"5"`）。**字符串**：JSON 的键永远是字符串。 */
  id: string;
  /**
   * ★★ 这一格名字的**词条 key**（`ranked.componentGameServer` …）。
   * ⚠️⚠️ 上游的响应里**没有名字** —— 它只有 id。名字只出现在**人看的那张状态页**的内联脚本里
   *    （`window.preloadData.publicGroupList[0].monitorList[].name`），而那条路**没有 API**：
   *    `…/api/status-page/mcsrranked`、`…/config`、`/api/status` 三个实测全是 **403**。
   *    ⇒ 那四对 id→名字是**这一栏唯一一处未经 API 验证的映射**，写死在
   *      `packages/shared/src/ranked/const.ts` 的 `RANKED_STATUS_COMPONENTS` 上
   *      （那张表的注释写着完整来历与两个选择的代价）。
   *    ⚠️ 它错了长什么样：上游重新编号监视器 ⇒ 两格的名字互换，而**每一格都合法、每个状态都是真的**，
   *      没有任何门禁看得见（`pending.md §5.99` 里记着"要人对着状态页核一次"）。
   */
  nameKey: string;
  /** 0 down / 1 up / 2 pending / 3 maintenance —— 原样给前端，映射在界面那一层。 */
  state: 0 | 1 | 2 | 3 | null;
  /**
   * ★ 上游那一条心跳的时间，**原样一串文本**（`2026-09-17 11:16:27`），不是时间戳。
   * ⚠️ 那串字符**没有时区**，`new Date()` 会按**本机时区**解释 ⇒ 同一份数据在不同机器上
   *    会算出不同的时刻，显示值也会随部署机器漂（本仓被一次静默的 8 小时偏移烧过）。
   *    我们只把它当**文本**显示（「最后更新 2026-09-17 11:16:27」），一个时间戳都不换算。
   *    ⚠️ 这条判断由 `ranked-shared.test.ts` 里三条断言钉住（值是原样字符串、类型是 string、
   *      换一份夹具就换成那一份）——**"顺手转一下"会在那里红**。
   *    ⚠️ `null` = 上游这一份里没有这一格。它**不是**"故障"（`state: null` 也是）。
   */
  checkedAt: string | null;
}

interface RankedStatusResponse {
  /** ★★ **恒为四格**，顺序由 `RANKED_STATUS_COMPONENTS` 定。上游少给一格时那一格是 `null` 字段。 */
  components: RankedStatusComponent[];
  serverNow: number;   // 服务端取一次
  fetchedAt: number;   // 这份心跳是什么时候取的
  stale: boolean;      // 是不是兜底的旧数据
}
```

⚠️★ **四格全都没有状态 ⇒ 整份不成形状**（502 `upstream_bad_response`，日志带上那四个 id）：
"上游换了键"与"四个服务刚好都没数据"是两件事，而后者在界面上看起来是四行整齐的 `—`。
**只少一格 ⇒ 200 照给**，那一格印 `—`（界面不许替上游断言一个我们不知道的事实）。

⚠️★ 被删掉的两样（2026-09-19 用户口径「不加其他多余的信息」）：`ping` 与 24 小时可用率。
上游**照样在响应里给**（`ping` / `uptimeList`），我们**一个字节都不读** ——
它们不进这个形状，所以界面不可能"顺手"再印一个出来。

**拒绝码**：上游 5xx/超时 ⇒ 503 `upstream_unavailable`（有旧数据时照旧给旧数据 + `stale: true`）；
上游 429 ⇒ 503 `ranked_busy`；形状不对 ⇒ 502 `upstream_bad_response`（日志带字段名）。
⚠️ `ranked_busy` 与 `upstream_bad_response` 是**新码** ⇒ 要同时进
`services/api/src/error-codes.test.ts` 的 `KNOWN_CODES`，并决定前端拿它们说什么（§7.3）。

### 4.2.1 ★ ③ 的第二份数据（赛段）**不是**我们端点的一部分

`/phase-leaderboard` 由**访客浏览器直连**（与 `/leaderboard` 同一条路、同一套请求选项），
所以它**不进** `RankedStatusResponse`、也不新增任何服务端路由。它的形状：

```ts
interface RankedPhaseData {
  number: number | null;    // 赛段号（实测今天是 1）
  endsAt: number | null;    // 秒（与赛季起止同一条单位规矩）
  season: number | null;
}
```

- 整份不成形状（缺 `phase` / `phase` 不是对象 / `status !== 'success'`）⇒ 解析层回 `null`，
  界面说「赛段信息暂时读不到」——**与"读到但某一格是空的"（印 `—`）是两件事**。
- ⚠️★ 那一次请求失败**不许**让排行榜变空：容器按**辅助那一路**（`{ fatal: false }`）调它。

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
                 highest: number | null; phasePoint: number | null }>;   // 前 150（★ 2026-09-19）
  fetchedAt: number;
}

/** ★ 2026-09-19：**另一个端点**给的（93 字节），与上面那份各来各的。 */
interface RankedPhaseResponse {
  number: number | null;   // 赛段号
  endsAt: number | null;   // 秒
  season: number | null;
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

### 6.2 ① 状况与人数 `/ranked/status` ★★ 修订（2026-09-19）

用户原话：「"状态栏"显示 Game Server, API, Store 和 Wiki 所有的状态和最后更新时间，
下面显示当前在线人数，**不加其他多余的信息**」；追问后的口径是**只留四格（状态 + 最后更新）+ 人数**。

```
┌──────────────────────────────────────────────────────────────┐
│  ◤ Game Server      [正常]      最后更新 2026-09-17 11:16:27  │
│  ◤ API              [正常]      最后更新 2026-09-17 11:18:07  │
│  ◤ Store            [等待]      最后更新 2026-09-17 11:16:27  │
│  ◤ Wiki             [维护]      最后更新 2026-09-17 11:16:28  │
│                                                              │
│  1234                                                        │
│  1234 人正在玩 Ranked                                        │
└──────────────────────────────────────────────────────────────┘
```

| 元素 | 规则 |
|---|---|
| 四行 | **恒为四行**，顺序 = `RANKED_STATUS_COMPONENTS`（Game Server → API → Store → Wiki，**用户的顺序**） |
| 名字 | 来自那张表的词条 key（`ranked.componentGameServer` …）。⚠️ **不在任何 API 里**（§4.2 的长注释） |
| 状态徽章 | 四格各自的 `state` → `1` 正常 / `0` 故障 / `2` 等待 / `3` 维护 —— **四种都要有话说** |
| 读不到那一格 | `state: null` ⇒ 徽章是 `—` + **中性配色**（`--unknown`），**不是**「故障」；时间也是 `—` |
| 最后更新 | `checkedAt` **原样**（不做时区换算，§4.2）；词条是「最后更新 {{time}}」 |
| 实时人数 | `players` → 大号数字 + 一句说明；`null` → 「—」+「人数暂时读不到」 |
| 新鲜度 | 「N 秒前更新」（本地计时每秒往前）——**这是"这份数据多旧"的唯一答案** |
| 失败 | 有旧数据 ⇒ 旧数据 + 「上次刷新失败了…」+ 重试；没有 ⇒ 一句错误 + 重试 |

⛔ **这一屏不许再加东西**（2026-09-19 用户口径的字面意思）。被**删掉**的四样（不是遗漏）：
延迟（`statusPing` / `statusPingUnknown`）、24 小时可用率（`statusUptime`）、
单格心跳那一行（`statusCheckedAt`）、心跳历史（上游给 400 条，我们从来不显示）。
⇒ 那四条词条**从两份字典里一起删了**，而且渲染自检有一条断言"它们**不在**字典里"
（没有消费者的 key 留着，下一个人会以为它还挂着某个渲染点）。

⚠️ **`players === 0` 与 `players === null` 是两件事**：前者印「现在没有人在玩 Ranked」（真话），
后者印「—」+「人数暂时读不到」。两种都要有词条。

### 6.3 ② 实时高分对局 `/ranked/live`

- **排序**：`avgElo` 降序，相同再按 `key` 升序（稳定排序）。`avgElo` = 两人 `eloRate` 的**非 null 平均**；
  一人 null 就用另一个人的值；两人都 null ⇒ `null`，**排最后**（未定级不该占榜首）。
- **全部展示（★ 修订 2026-09-19，用户原话：「高分对局全部展示」）**：原来这里是「取前 10」，
  现在是**首批 + 「加载更多」**（`RANKED_LIVE_BATCH` = 20 场一批）。用户要的是"**能不能看到
  全部**"（截断没了），不是"同一帧里塞进 DOM"：这一页每 10 秒轮询一次、每轮重渲染整张列表，
  而上游 `/live` 没有上限 ⇒ 几百张卡片会按住主线程，且那个列表没人滚到底。
  ⚠️ 排序口径**一个字没改**（`avgElo` 降序）——用户要的是全部，不是换个顺序。
- **筛选条（★ 新增 2026-09-19，同一句用户原话的后半）**：面板顶部一个**昵称搜索框**
  （两侧任一命中、子串、忽略大小写、空词 = 不筛）与一颗开关「只看双方都在直播」
  —— 判据是**两侧 `liveUrl` 都非 null**（`bothStreaming`，**任何平台都算**：kick 等认不出
  平台的 `livePlatform` 是 `null`，但 `liveUrl` 有值 ⇒ 照样算"在直播"）。
  两者与分批**可组合**（AND），而且**全都只筛手上已经取到的那份数据**：
  **不发请求、不加查询串、不加服务端路由**（直连上游的额度是访客自己的，spec §3 代价 2）。
  ⚠️ 计数不许自相矛盾：`sliceLiveMatches` **一次**给出 total / matched / visible / remaining，
  界面那三处数字（共 N 场 / 符合条件 M 场 / 还有 K 场）与真的渲染出来的卡片同源。
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
  - **点击才加载** iframe（沿用 `components/ClickToPlayEmbed.tsx`）：一屏最多 40 个框
    （一批 `RANKED_LIVE_BATCH` = 20 张卡片，每张最多两个框；★ 2026-09-19 起是 40 而不是
    20 —— 原来那句"20"算的是"取前 10 × 2"），
    全预加载会把浏览器与带宽打满。
  - 白名单（`livePlatform`）：`twitch` / `youtube` / `bilibili` 内嵌；其余**外链** + 一句说明。
    地址由 `packages/shared` 现成的嵌入函数拼（Twitch 必须带 `parent`，§11.2 有一条测试）。
- **空态**：此刻没有对局 ⇒ 「现在没有直播中的对局。」
  ⚠️★ **"筛完一场不剩"是另一句话**（`ranked.liveNoMatch` =「没有符合条件的对局。」）：
  上游有对局、只是当前条件把它们全筛掉了 —— 拿 `liveEmpty` 顶上是一句假话
  （用户会以为上游空了，而该做的只是清掉搜索框里那个词）。
- **轮询**：10 秒（§5.1）。

### 6.4 ③ Elo 排行榜 `/ranked/elo` ★★ 修订（2026-09-19）

- 顶部**一行四格**（用户原话：「除了显示赛季时间，另外**并排**显示赛段信息」）：
  **赛季 12** · 「2026-09-15 → 2026-12-30」 · **赛段 1** · **结束 2026-09-30**。
  ⚠️★ "并排"= **同一个 `.ranked__meta`**（flex + gap 那一行），不是两行、不是两个 `<p>`。
- ⚠️★ **赛段来自第二次直连**（`/phase-leaderboard`，实测 93 字节）：`/leaderboard` 的响应里
  **没有** phase 对象（实测，只有每一行各自的 `seasonResult.phasePoint` / `phaseHighest`）。
  那一次失败时那一格说「赛段信息暂时读不到」，而**整张榜照常渲染**
  ——容器按辅助那一路（`{ fatal: false }`）调它，所以**不会**多出一句"读不到数据"。
  三格各自可空：号数读得出、截止读不出时印号数（不印那一句"读不到"）。
- 表格：**排名 / 昵称 / elo / highest / phasepoint**。
  ⚠️ 上游每条还带着 `country`，**我们不发、也不显示**（§9）。
- ⚠️★ **排名列用 `eloRank`**（并列会重复、之后跳号），**不是下标 + 1**。
- ★★ 取**前 150**（2026-09-19 用户口径）。
  ⚠️★ **150 是上游的硬上限，而且没有分页**：实测 `?count=200` / `?count=1` /
  `?page=1&count=150` 与不带参数的响应**字节完全相同**（都是 150 条）⇒ 上游**忽略**这两个参数
  ⇒ **第 151 行拿不到**。⇒ 界面上**没有**"下一页"、也没有"加载更多"，
  而且这不是"还没做"——**没有下一页**。`RANKED_ELO_TOP = 150` 是**上界**
  （上游哪天给得更多时由它截断，页面不会被撑爆）。
- 空态：赛季刚开 ⇒ 「这个赛季还没有人上榜。」
- 轮询：60 秒（两路请求在**同一轮**里发）。

### 6.5 ④ 周赛榜单 `/ranked/weekly` ★★ 修订（2026-09-19）

- 默认 `GET /weekly-race`（本周）。
- ★★ **顶部一行导航**（用户原话：「将'上一周/下一周'移**到顶部**，并允许用户直接输入对应周的
  数字跳转，添加'本周'按钮」）：**上一周 | 下一周 | [ 周数 ] 跳转 | 本周**
  —— 紧跟在面板的 `<h2>` 下面、**周数与四格种子之前**（原来它挂在成绩表**下面**）。
  ⚠️ 那一行**只有一处**（渲染自检同时断言"在种子/表格之前"与"`.ranked__weeknav` 只有一个"）
  —— 两处导航会各自漂，而"下面那一行还能点"会让用户以为那是两个不同的东西。
- 手输跳转：`<form>` + `<label class="sr-only">` + `type="text"` + `inputMode="numeric"` +
  **`type="submit"`** 的「跳转」。
  - ⚠️ `type="text"` 而**不是** `number`：number 输入框会把字母**吃掉**（值变成空串）
    ⇒ 我们就没法说「请输入一个周数。」了。
  - ★ **回车提交表单**（浏览器原生行为），所以键盘路径与点击走**同一个** `onWeekJump`。
  - ⛔ **不合法就一个请求都不发**（`parseWeekInput`，纯函数，被测试逐值钉住）：
    | 输入 | 结果 | 界面上说什么 |
    |---|---|---|
    | 空 / 字母 / `1.5` / `1e3` / `+5` / 全角数字 | `not_a_number` | 「请输入一个周数。」 |
    | `0`（**本周的别名**）/ `≤ -2` / 比最新周还大 | `no_such_week` | 「没有这一周。」（**复用**上游那一档的同一句） |
    | `-1` 或 `1 … latestId` | `ok` | 跳过去 |
  - ⚠️ `latestId` 还不知道时**不猜**（比 103 大的数照发，由上游的 400 说话）。
- 「本周」= **真链接**，落点 `weekPath(latestId)`（`latestId` 还不知道时是不带周号的
  `/ranked/weekly` —— 上游自己回答"此刻是第几周"）。它**永远可点**（与"上一周到头了"无关）。
- 顶部其余部分：**周数** + **4 个种子**（主世界 / 下界 / 末地 / RNG）+ 截止时间（本地时区）。
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
| `ranked.statusUp/Down/Pending/Maintenance` | 「正常」/「故障」/「等待」/「维护」（★ 2026-09-19 起被**四格**各自使用） |
| ★ `ranked.componentGameServer` / `componentApi` / `componentStore` / `componentWiki` | 「Game Server」/「API」/「Store」/「Wiki」—— ⚠️★ 这四个名字**不在任何 API 里**，来自状态页的 `preloadData`（§4.2）；两种语言同值（上游的专有名词） |
| ★ `ranked.componentCheckedAt` | 「最后更新 {{time}}」—— ⚠️ `{{time}}` 是上游那串 `2026-09-17 11:16:27` **原样**文本，**不做时区换算**（那串字符没有时区，`new Date()` 会按**本机**时区解释 ⇒ 显示值随部署机器漂；本仓被一次静默的 8 小时偏移烧过）。它取代码表里的 `statusCheckedAt` |
| ⛔ ~~`ranked.statusPing` / `statusPingUnknown` / `statusUptime` / `statusCheckedAt`~~ | **已删**（2026-09-19，用户口径「不加其他多余的信息」）：没有消费者的 key 留着，下一个人会以为它还挂着某个渲染点。渲染自检有一条断言"它们**不在**字典里" |
| `ranked.players` / `playersUnknown` / `playersZero` | 「{{n}} 人正在玩 Ranked」/「人数暂时读不到」/「现在没有人在玩 Ranked」 |
| `ranked.liveTitle` / `liveEmpty` | 「现在正在打的对局」/「现在没有直播中的对局。」—— ⚠️ `liveTitle` 早先写的是「正在直播的高分对局」（**2026-09-16 终审改掉**，英文同句改成 "Matches playing right now (top 10 by average elo)"）：一张卡片**可以完全没有直播**（"谁在直播"由每张卡片自己的 `liveExpand` 承载，夹具里榜首那张甚至就叫 `Nostream`），而"高分"也不是判据（判据是**平均** elo 的排序，未定级是常态 ⇒ §10 第 6 条）⇒ 标题只能说这一栏**真正在选择的东西**，排序口径由下面那行 `liveFrom` 说全。⚠️★ **2026-09-19** 又把括号里的「按平均 elo 排前 10」删掉了（用户要求全部展示）：那句"前 10"从这一天起是假话，而"按平均 elo 排"本来就由 `liveFrom` 说了一遍 |
| `ranked.liveFrom` | 「共 {{total}} 场，按平均 elo 排序」（**2026-09-19 改写**，原为「{{total}} 场里按平均 elo 取前 10」）。⚠️ `{{total}}` 是**上游的总场次**（`sliceLiveMatches().total`），不是筛后场次 —— 后者由 `liveMatched` 说，两个数不许互相冒充 |
| `ranked.liveSearch` | 「搜索选手」—— ★ 2026-09-19 加的搜索框：**同时**是占位符与 `<label class="sr-only">` 的文字（占位符在输入第一个字之后就没了，只给占位符等于控件没有名字）。⚠️ **不复用** `resources.searchPlaceholder`（跨栏目复用 = 改一栏的文案会顺手改掉另一栏） |
| `ranked.liveBothLive` | 「只看双方都在直播」—— ★ 2026-09-19 加的那颗开关。⚠️ 判据是**两侧 `liveUrl` 都非 null**（任何平台），不是平台白名单 |
| `ranked.liveNoMatch` | 「没有符合条件的对局。」—— ★ 与 `liveEmpty` **不是**一句话：上游有对局、只是被当前条件筛没了 |
| `ranked.liveMatched` | 「符合条件 {{matched}} 场」—— ★ 只在**筛掉过东西**时渲染（判据："筛后 < 总数"） |
| `ranked.liveMore` | 「加载更多（还有 {{n}} 场）」—— ★ `{{n}}` 是 `remaining`（还没渲染的场次），与上面列表**同一次**计算。⚠️ 不许写成"筛后总数 - 一批"那种第二份算式：它会印出比实际还剩的更大的数，而点一下什么都不会多出来 |
| `ranked.liveExpand` | 「展开直播（{{n}} 个）」—— ⚠️ **没有 `liveCollapse`**：展开态用的是原生 `<details>`/`<summary>`，收起由浏览器负责；为一个不存在的标签配一条词条＝一条**没有消费者的 key**（本仓为这种事删过 `shares.moderateHideReason`） |
| `ranked.liveExternal` | 「**这条链接**不能内嵌，在新窗口打开」—— ⚠️ 措辞刻意**不说"这个平台不支持"**：`livePlatform === null` 有两类来源（认不出的平台如 kick；以及"平台其实支持、只是这条地址里没有可嵌的视频"，例如 `youtube.com/@handle` 的频道页 ⇒ 见 `embed.ts` 的注释），说"平台不支持"对后者是**错话**。⚠️ **也没有 `liveNoStream`**：一场对局两个人都没在直播时，卡片**没有**展开入口 —— 一颗按下去什么都不发生的按钮比没有按钮更坏 |
| `ranked.seedOverworld` / `seedNether` / `seedEnd` / `seedRng` | 「主世界」/「下界」/「末地」/「RNG」—— ⚠️ **不复用 `shares.formOverworld` 那四条**：那是"实时分享"那一栏自己的词条，跨栏目复用意味着改一栏的文案会**顺手改掉**另一栏；而这四格说的是**周赛的种子**，是另一个语境 |
| `ranked.statusStale` | 「服务端这份数据是兜底的旧数据。」—— ⚠️ 它对应响应里的 `stale: true`，与「上次刷新失败了」**不是**一件事：这一次**我们的**刷新是成功的，是**服务端**拿了兜底（上游那一刻读不到）。两者混成一句会让用户以为是自己网络的问题 |
| `ranked.statusTitle` | 「服务状况」—— ① 那一栏的小标题。⚠️ 它**不是** `nav.ranked`：标签页那一行已经用了栏目名，这里再写一遍就是同一句话在同一个屏幕上出现两次；而 ②③④ 各自都有自己的 `<h2>`，① 没有的话它就成了唯一一个没有标题的面板 |
| `ranked.matchTime` | 「已进行 {{time}}」 |
| `ranked.eloTitle` / `season` / `seasonRange` | 「Elo 排行榜」/「赛季 {{n}}」/「{{from}} → {{to}}」 |
| ★ `ranked.phase` / `phaseEndsAt` / `phaseUnknown` | 「赛段 {{n}}」/「结束 {{when}}」/「赛段信息暂时读不到」—— ⚠️ 前两条与赛季那两条在**同一行**里（"并排"，§6.4）；`phaseUnknown` 是**那一次 `/phase-leaderboard` 请求失败**那一档（与"上游给了但某一格空着 ⇒ 印 `—`"是两件事）。⚠️ `{{when}}` 是**秒**、按本地时区渲染（与赛季起止同一条规矩） |
| `ranked.colRank/Nickname/Elo/Highest/PhasePoint` | 「排名」/「昵称」/「elo」/「最高」/「阶段分」 |
| `ranked.eloEmpty` | 「这个赛季还没有人上榜。」 |
| `ranked.weeklyTitle` / `weeklyNumber` / `weeklyEndsAt` / `weeklySeed` | 「周赛」/「第 {{n}} 周」/「截止 {{when}}」/「种子」 |
| `ranked.weeklyPrev` / `weeklyNext` | 「上一周」/「下一周」—— ★ 2026-09-19 起它们住在**顶部**那一行（§6.5） |
| ★ `ranked.weeklyJump` / `weeklyJumpGo` / `weeklyThisWeek` | 「跳到某一周」/「跳转」/「本周」—— ⚠️ `weeklyJump` **同时**是占位符与 `<label class="sr-only">`（占位符在输入第一个字之后就没了）；`weeklyThisWeek` 是一条**真链接** |
| ★ `ranked.weeklyBadNumber` | 「请输入一个周数。」—— ⚠️ 它**只**管"这不是一个周数"；"这个周数不存在"（0 / ≤ -2 / 比最新周还大）说的是 **`errNotFound`**（「没有这一周。」），因为那是**上游**对同一个问题的原话（对照表在 `WEEK_INPUT_ERROR_KEYS` 上） |
| `ranked.colTime` / `colEloRank` | 「时间」/「elo 排名」 |
| `ranked.weeklyEmpty` | 「这一周还没有人完赛。」 |
| `ranked.updatedAgo` | 「{{secs}} 秒前更新」 |
| `ranked.refreshFailed` | 「上次刷新失败了，下面是 {{secs}} 秒前的数据。」 |
| `ranked.loadFailed` | 「读不到数据。」 |
| `ranked.errBusy` / `errUnavailable` / `errBadResponse` | 「上游有点忙，稍后再试。」/「上游暂时读不到，稍后再试。」/「上游返回的数据看不懂。」—— ⚠️ `errBadResponse` 早先写的是「上游返回的数据看不懂，**已经记下来了**」（**2026-09-16 终审改掉**，英文那半句 "we have noted it" 同句删除）：它**与 §10 第 8 条矛盾** —— 那一节明写浏览器侧**不记日志**（Task 1 的评审判定"访客的控制台没有读者"，那条 `console.warn` 是装饰），而直连那一条路我们这一侧一个字都看不到 ⇒ 那句话是在说一件我们从来没做过的事（用户可能因此以为"有人会去看"，于是不再反馈）。现在说的只有我们确实知道的那件事 |
| `ranked.errNetwork` / `errHttp` / `errNotFound` | 「连不上上游，可能是网络或浏览器扩展拦了。」/「上游回了一个错误（HTTP {{status}}）。」/「没有这一周。」—— 这三条**直连**那三块面板时才有；`errNotFound` 对应上游对"不存在的周"回的 400（§6.5） |
| `ranked.errRateLimited` | 「请求有点频繁，过一会儿再试。」—— ⚠️ 与全站的 `rate_limited` 文案**分开**：这里被限的是**访客自己**打到上游的请求数（每 IP 500 次/10 分钟），不是我们服务器的限流，两句话说的不是一件事 |
| `ranked.unknown` | 「—」（占位符也要有词条：组件里写死 `—` 会让两种语言再也没法分开调） |

⚠️ 重试复用 `common.retry`（不新写）。
⚠️ 限流**不复用**全站的 `rate_limited` 文案（上一版这里写错了，2026-09-16 由 Task 4 的实现者指出）：
全站那句说的是"**我们对你的**请求限流"，而这一栏的限流是"**上游对你自己**的请求限流"
（每 IP 500 次/10 分钟，访客自己打出去的）—— 两句话对用户的下一步不同，所以 `ranked.errRateLimited` 是独立一条。

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
8. **上游字段可能悄悄改**（`highest` 就不在文档里）⇒ 解析层**逐格兜底**（缺的那一格是 `—`，
   整份数据不会因此消失）。⚠️ **浏览器侧不记日志**：spec 早先写着"记一条 `console.warn`"，
   2026-09-16 在 Task 1 的评审里判定**去掉**这一条 —— 访客的浏览器控制台**没有读者**，
   那条日志是装饰；真正能被我们看到的只有服务端那一侧（心跳端点在形状不对时回 502 并记下是哪一格，
   见 §4.2）。**代价写在明面上**：上游改字段名之后，我们能看到的只有"某一格变成 `—`"，
   而不是一条日志；发现它的路径是用户反馈，不是我们自己的监控。
9. **访客的 IP 会到达第三方**（这是用户为了避开服务器限流而选的代价）；我们只做
   `credentials: 'omit'` + `referrerPolicy: 'no-referrer'` 这两件能少给就少给的事。
10. 本栏目**不产生任何内容**（只读）⇒ 没有审核、没有权限、没有审计。

---

## 11. 验收与验证清单（给 verifier / reviewer 用）

### 11.1 服务端：`services/api/src/ranked.test.ts`（**上游用桩，绝不出真实网络**）

⚠️ 与 `seeds-proxy.test.ts` 同一条纪律：替换 `globalThis.fetch`。

- [ ] `GET /api/ranked/status` 正常路径：四格逐个断言 + `stale: false` + `no-store`
- [ ] ★ TTL 30 秒：TTL 内第二次请求**不打上游**（桩计数 == 1）；过了再打（== 2）
- [ ] ★★ single-flight：十个并发 ⇒ 上游计数 **== 1**
- [ ] ★ 兜底：上游 500 / 超时 / 非 JSON ⇒ 有旧数据时 `stale: true` + 旧数据；没有则 503
- [ ] 上游 429 ⇒ 503 `ranked_busy`；形状不对 ⇒ 502 `upstream_bad_response`（日志带字段名）
- [ ] ★★ 心跳解析：**四格**各取自己那一格的**最后一条**；**少一格 ⇒ 那一格 `null` 而 200 照给**；
      **四格全没状态 ⇒ 整份 `null`**（502）；响应里**没有** `ping` / `uptime24`（用户把它们删了）
- [ ] 每 IP 限流：> 60 次/分钟 ⇒ 429 `rate_limited`
- [ ] `error-codes.test.ts`：两个新码已进 `KNOWN_CODES`
- [ ] ★ **公开面零泄漏**：新端点匿名 200，且响应里不含其它栏目的数据；既有公开接口响应里不含 `ranked*` 新字段

### 11.2 共享解析层与纯函数（`packages/shared/src/ranked/`，测试放 `services/api`）

- [ ] ★ 解析是**纯函数**：同一份响应解析两次得到同样结果（不读时钟、不读全局状态）——**五个**入口
- [ ] ★★ **四格组件**（2026-09-19）：从一份真实的四格心跳体里逐格抽出 id / 名字 / 状态 / 时间；
      **含"少了某一格"那一档**（那一格 `null`、另外三格不受影响、整份不失败）；
      `checkedAt` 是**原样字符串**（类型 + 逐字 + 换夹具就换值三条一起钉）
- [ ] ★★ **赛段**（2026-09-19）：`{number, endsAt, season}` 三格；**缺 phase / phase 不是对象 ⇒ `null`**
      （而**不是**三格全 null 的对象）；三格各自可空
- [ ] ★★ **手输周数**（2026-09-19）：`1 … latestId` 与 `-1` 合法；空 / 字母 / `1.5` / `1e3` / `+5` /
      全角数字 ⇒ `not_a_number`；`0` / `≤ -2` / `> latestId` / 超长数字 ⇒ `no_such_week`；
      `latestId === null` 时**不猜**
- [ ] ★★ **排序与分段**（2026-09-19 起不再截断）：夹具含"avgElo 最高但一人 null"、"两人都 null"两场
      ⇒ 两人都 null **排最后**、一人的按另一个人的值算；并列按 `key` 升序
- [ ] ★★ **筛选与分批**（`bothStreaming` / `matchesNickname` / `filterLiveMatches` / `sliceLiveMatches`）：
      只有**一方**在直播的场次必须被「双方都直播」藏掉、**认不出的平台（kick）照样算**、
      昵称搜索**大小写不敏感且两侧都搜**（不搜 `liveUrl`）、两个条件是 **AND**（不是 OR）、
      `shown` 为 0 / 负数时的边界，以及 total / matched / visible / remaining 四个数彼此自洽
- [ ] ★★ **排名用 eloRank 不用下标**：夹具造 `…,3,3,5,…` ⇒ 输出原样是 `3,3,5`
- [ ] ★ `highest` 缺失 ⇒ `null`（不是 `undefined`、不是 0）
- [ ] ★ **前 150**（2026-09-19 用户口径）：150 条**一条都不少**，超过 150 条时截到 150（上界）
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
- [ ] ★★ ① **四行逐行**：名字（来自那张表）/ 状态（**每格说它自己那句**）/ 最后更新（**每格是它自己那个时间**）；
      **上游少一格的夹具** ⇒ 那一行还在、印 `—` 与「最后更新 —」、**不许**是「故障」；
      ★★ 还有一个**全屏文字逐字**的断言：这一屏**只有**四行 + 人数 + 外壳那一行新鲜度
      （多任何一件都会红 —— 这是"不加其他多余的信息"那条口径唯一的机器判据）
- [ ] ★ ① 那四条被删的词条**不在**两份字典里（`statusPing` / `statusPingUnknown` / `statusUptime` / `statusCheckedAt`）
- [ ] ① 四种状态徽章各有话说；`players` 的 **0 与 null 是两句不同的话**
- [ ] ② 卡片：左右两半**各自五个字段**都在；`timeline: null` ⇒ `—`；一人 null elo ⇒ `—`；
      两人顺序 = elo 高的在左
- [ ] ② 展开入口：有 `liveUrl` 时在、一个都没有时**不在**（正反两半）；**展开态在初始产物里不存在**
- [ ] ★★ ② 的筛选条与分批（③b，2026-09-19 加）：搜索框与开关都在、开关的 `aria-pressed` 与
      `tagchip--on` **取自同一份判据**（正反两半）；搜索**大小写不敏感**、搜不到时说
      `liveNoMatch`（而**不是** `liveEmpty`）、筛后那句 total 仍是**上游总场次**；
      「只看双方都在直播」只剩双方都有 `liveUrl` 的那一场（含 kick）；搜索 + 开关是 **AND**；
      「加载更多」那个数 = 还没渲染的场次，全部显示完之后**整颗不渲染**
      ⚠️★ 它钉的是"**视图拿着这三格状态渲染成什么样**"：三格状态住在容器里（`routes/Ranked.tsx`），
      而容器在 Node 里渲染不了 ⇒ **打字 / 点击真的换了状态**这一半要人点一次
- [ ] ③ 五列都在；**并列排名照原样印**（`3,3,5`）；赛季号与起止都在
- [ ] ★★ ③ **赛段并排在赛季那一行**（同一行四格：赛季号 / 起止 / 赛段号 / 赛段截止）；
      赛段是 `null` 时那一格说「赛段信息暂时读不到」而**整张榜一个格子都不少**、也**不**多一句"读不到数据"
- [ ] ★★ ③ **150 行**（夹具给 160 条 ⇒ 渲染 150 行 = 750 个格子）+ 常量钉死 `RANKED_ELO_TOP === 150`
- [ ] ④ 顶部：周数（**第 -1 周那份渲染成「第 0 周」**）、4 个种子、截止时间；五列；
      `id >= latestId` ⇒「下一周」**禁用**；`id === -1` ⇒「上一周」**禁用**（正反两半）
- [ ] ★★ ④ **导航在顶部**（位置断言：在周数那一行 / 四格种子 / 成绩表之**前**，且在面板标题之**后**）
      ＋ 那一行**只有一处**（`.ranked__weeknav` 的个数 == 1）
- [ ] ★★ ④ **手输框与「本周」**：输入框与 `type="submit"` 的按钮**在同一个 `<form>` 里**、
      `type="text"` + `inputMode="numeric"` + `sr-only` 的 `label for` 成对；
      受控（喂 `'95'` 就印 `value="95"`）；三格导航里有「本周」且它指向 `latestId`
      （`latestId` 为 `null` 时回落到不带周号的 `/ranked/weekly`）；
      两种不合法的输入各说一句（`not_a_number` / `no_such_week`），而且**导航与数据一个字都没少**
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
- [ ] ★ mutation ⑧（★ 2026-09-19）：`bothStreaming` 改成"**至少**一方在直播"（`||`）⇒
      「只看双方都在直播」那几条必须**红**（夹具里"只有一方在直播"的那一场会冒出来）
- [ ] ★ mutation ⑨（★ 2026-09-19）：`matchesNickname` 直接 `return true`（忽略搜索词）⇒
      搜索与 AND 组合那几条必须**红**（而"不筛"那几条照样绿 —— 说明它们不是同一条断言）
- [ ] ★ mutation ⑩（★ 2026-09-19）：`sliceLiveMatches` 的可见段改成 `matched`（忽略 `shown`）⇒
      「加载更多（还有 7 场）」与 `shown: 5` 那几条必须**红**
- [ ] ★ mutation ⑪（★ 2026-09-17）：把 `insertLiveChannelIfAbsent` 的 `live_video_id IS ?`
      改回 `= ?`（NULL trap 本身）⇒ 「同一份载荷跑两轮仍然一行」与「隐藏过的行还是隐藏的」
      必须**红**（实测：39 条里红 2 条）
- [ ] ★ mutation ⑫（★ 2026-09-17）：去掉 `rankedTwitchChannels` 里那句 `platform !== 'twitch'`
      ⇒ 「只收 twitch」与摘要那三个数必须**红**（实测：红 7 条）
- [ ] ★ mutation ⑬（★ 2026-09-17）：`ranked-streams.ts` 的失败分支改成 `return 0`
      ⇒ 四条「失败 ⇒ 退出码 1」的用例必须**红**（实测：红 4 条）
- [ ] ★ mutation ⑭（★ 2026-09-19）：**③ 的赛段那三格整个不渲染**
      ⇒ 「赛季那一行里并排着**赛段号**」必须**红**
- [ ] ★ mutation ⑮（★ 2026-09-19）：`RANKED_ELO_TOP` 150 → **100**
      ⇒ shared 两条（条数 / 前 150 一条都不少）**与**渲染自检那条常量断言必须**红**
- [ ] ★ mutation ⑯（★ 2026-09-19）：`parseWeekInput` 一律 `{ ok: true }`
      ⇒ 三条「不合法一律本地挡掉」的用例必须**红**
- [ ] ★ mutation ⑰（★ 2026-09-19）：缺的那一格 `state: null → 0`（解析层）**或**
      视图把 `state === null` 印成「故障」—— ⚠️ 这一件事有**两半**（住在两个文件里），
      要**两刀各砍一次**：只砍解析层时渲染自检**照旧绿**（实测），因为渲染脚本喂的是**已经解析好的**形状
- [ ] ★ mutation ⑱（★ 2026-09-19）：`checkedAt` 改成 `new Date(...).toISOString()`
      ⇒ 「上游给的原样字符串」那几条必须**红**
- [ ] 每处 mutation 之后**字节级还原**并用哈希证明

### 11.5 收录作业：`services/api/src/ranked-streams.ts`（★ 2026-09-17 加）

⚠️ 与 §11.1 同一条纪律：上游一律用桩。两条路都要钉死 ——
`depsFor()` 注入假的取数层（**结构上**打不到网络），`mockUpstream()` 换掉 `globalThis.fetch`
而 URL 指向 `.invalid`（测"真路径整条通不通"）。用例都在 `services/api/src/ranked.test.ts` ⑥。

- [ ] 只有 twitch：一行、`display_name` = login、`tags = ["ranked"]`、`sort_order = 1000`、
      `live_video_id = NULL`；youtube / bilibili / 没有链接的都不收
- [ ] 摘要那一行的**形状与三个数**：`载荷 N 个 twitch 频道 / 新增 M 条 / 已在库 K 条`（N = M + K），
      且印出来的时刻是注入时钟的 ISO（**毫秒**单位的那条判据）
- [ ] 同一份载荷跑两轮 ⇒ 仍然一行、而且是同一行；隐藏过的行还是隐藏的；
      **删掉**之后下一轮会以**新 id** 回来（所以正确动作是隐藏）
- [ ] 一轮 = **恰好一次**上游调用（桩计数 1）—— 这就是 §3.1 那笔 0.4% 的分子
- [ ] 上游四档都要**响**：`unavailable`（500 / 超时）/ `bad_response`（200 但读不出对局）/
      `db`（触发器拦住写库）⇒ **零写入 + 一行 stderr + 退出码 1**；
      写库失败那一行还要照实报"**已经写进去几条**"（不是笼统的"失败了"）
- [ ] `ingestRankedLiveChannels` **不抛**：写库失败时把错误**返回**（`inserted` / `candidates` / `error`）
- [ ] 载荷来自缓存（`fromUpstream: false`）⇒ 零写入、退出码 0、那一行说明原因
- [ ] 不认识的参数 ⇒ 退出码 2，且**连取数层都不碰**
- [ ] `runOnce` 一个字节都不打（"一轮恰好一行"是**结构上**成立的，打印只在 `main`）

---

## 12. 风险表

| 风险 | 影响 | 处置 |
|---|---|---|
| ★ **上游 `max-age=14400` + ETag** | 面板冻住，而且我们的网络日志里什么都看不到 | 每次直连都 `cache: 'no-store'`，并有专门的渲染断言与 mutation（§11.3/§11.4） |
| **我们看不到前端失败**（直连的代价） | 上游挂了只有访客知道 | 错误文案说具体 + 「N 秒前更新」常显；心跳那条路仍然过我们（能记日志） |
| **上游哪天撤掉 CORS** | 三个面板同时失效 | 界面上有明确错误 + 重试；真发生就做一次独立改动（加服务端兜底） |
| **浏览器扩展拦第三方请求** | 个别用户永远"读不到" | 错误里说明"可能是网络或扩展拦了"；手上有旧数据就留着 |
| **访客 IP 到达第三方** | 隐私 | 用户明确选了这个代价；只做 `omit` + `no-referrer` 两件事 |
| 上游字段悄悄改名 | 界面上出现 `—` 一片 | 逐格兜底；**浏览器侧不记日志**（没有读者，见 §10 第 8 条），能被我们看到的只有心跳那一条的 502 + 服务端日志 |
| 一个访客开多个标签页 | 烧他自己的额度（可能 429） | 只有当前标签页轮询、不可见时停、历史周不刷新 |
| 直播框把浏览器打满 | 卡顿 | 点击才加载；一屏最多 40 个（一批 20 张卡片 × 每张最多 2 个框） |
| 心跳那一处把服务器 IP 的额度花掉 | 每分钟 ≤2 次（4%） | TTL 30 秒 + single-flight；不做预算表（多一份没人走的状态） |

---

## 13. 冻结的契约总表（实现者按这张表对齐，不要自己发明）

| 类别 | 冻结值 |
|---|---|
| 路由 | `/ranked`（⇒ 重定向 `/ranked/status`）、`/ranked/status`、`/ranked/live`、`/ranked/elo`、`/ranked/weekly`、`/ranked/weekly/:id` |
| `block` 短名 | `ranked` |
| 词条命名空间 | `ranked.*`（+ `nav.ranked` + `home.desc.ranked`） |
| 英文栏目名 | **"Ranked now"** |
| 我们**唯一**的端点 | `GET /api/ranked/status`（**心跳，2026-09-19 起是四格**；CORS 所迫）。★ 2026-09-17：`GET /api/ranked/live` **已删除**（它**没有调用者** —— 面板是浏览器直连的；收录那一件事改走 systemd 作业，见 §3.1） |
| 服务器出网（ranked 上游） | 心跳 ≤2 次/分钟（**4%**）+ 直播链接收录作业 0.2 次/分钟（**0.4%**）⇒ 合计 **≈4.4%**（口径：500 次 / 10 分钟 / IP，§2.1）。⚠️ §3.1 说明了为什么**不**照抄那个"约 8%" |
| ★★ 状态栏那四格的**名字** | 写死在 `RANKED_STATUS_COMPONENTS`（`2/3/4/5 → Game Server/API/Store/Wiki`）。⚠️⚠️ **这是这一栏唯一一处未经 API 验证的映射**（心跳只给 id，名字只在状态页的 `preloadData` 里，那条路没有 API）—— 上游重新编号时**没有任何门禁看得见**（`pending.md §5.99` ①） |
| 浏览器直连的上游 | `api.mcsrranked.com` 的 `/live`、`/leaderboard`、**`/phase-leaderboard`（★ 2026-09-19 加）**、`/weekly-race{,/{id}}`（**主入口**）；`mcsrranked.com/api` 同路径（**兜底**，只在网络错误时） |
| 直连请求选项 | `cache: 'no-store'`、`credentials: 'omit'`、`referrerPolicy: 'no-referrer'`、**不带自定义头**（新增的赛段那一条**照旧**） |
| 心跳缓存 | TTL 30 秒 + single-flight + 兜底 ≤10 分钟 |
| 心跳限流 | 每 IP 60 次/分钟 |
| 刷新间隔 | 状况 15s（心跳 + 人数） / 对局 10s / 排行榜 60s（**两路请求同一轮**） / 周赛本周 60s / **历史周不刷新**；页面不可见时停 |
| 排行榜条数 | 前 **150**（★ 2026-09-19；**上游的硬上限，没有分页** —— `count`/`page` 被静默忽略） |
| ★ 赛段（③ 顶上那一格） | 来自 `/phase-leaderboard`（实测 **93 字节**）的 `data.phase = {number, endsAt, season}`；**浏览器直连**；失败**不许**清空排行榜（辅助那一路 `{ fatal: false }`） |
| 高分对局条数 | **全部**（不再截断，★ 2026-09-19 改；首批 + 「加载更多」每批 **20** 场，`RANKED_LIVE_BATCH`），`avgElo` 降序、`key` 升序 |
| 高分对局筛选 | 昵称搜索（两侧任一、子串、忽略大小写）+「只看双方都在直播」（两侧 `liveUrl` 均非 null，**任何平台**）；两者与分批**可组合**，且**只筛本地数据**（不发请求） |
| 排序口径 | `avgElo` = 非 null 平均；两人都 null ⇒ null ⇒ **排最后** |
| 排名口径 | 上游的 **`eloRank`**（并列会重复、之后会跳号） |
| 进度显示 | `timeline.type` **原样** + 词条表 + 未知回落（§7.2） |
| 周数显示 | `displayWeekNo(-1) = 0`，`≥1` 一一对应；**显示用响应里的 `data.id`** |
| ★ 周赛顶部那一行 | 上一周 / 下一周 / **手输周数 + 跳转** / **本周**；三轮都在**面板最上面**（§6.5） |
| ★ 手输周数的判定 | `parseWeekInput(raw, latestId)`（纯函数）：非整数 ⇒ `not_a_number`；`0` / `≤ -2` / `> latestId` / 超长 ⇒ `no_such_week`；**不合法一个请求都不发** |
| 翻页 | `prevWeekId(-1) = null`、`prevWeekId(1) = -1`、`nextWeekId(-1, latest) = 1`、`nextWeekId(latest, latest) = null`；**永不产出 0** |
| 直播嵌入白名单 | `twitch` / `youtube` / `bilibili`（CSP 允许的三个）；其余给外链；**点击才加载** |
| 兜底码 | **我们那一个端点**：429 `rate_limited` / 503 `ranked_busy` / 503 `upstream_unavailable` / 502 `upstream_bad_response`。**浏览器直连那三处不走拒绝码**：`RankedDirectError` 的四种原因（`network` / `http` / `not_found` / `bad_response`）由 `lib/rankedErrors.ts` 映射成界面文案（"这一周不存在"那一档来自上游的 400） |
| 时间单位 | 上游 `Date` = **秒**（赛季起止、心跳、周赛 endsAt）；`Time` = **毫秒**（对局时间、周赛成绩） |
| CSP | `connect-src 'self' https://api.mcsrranked.com https://mcsrranked.com`（**只改这一处**）；`frame-src` 不动 |
| 渲染自检 | `apps/web/scripts/rankedrender.tsx` → `check:ranked`，进 `check:all` |
| 迁移 | **没有**（ranked 的四个面板都不落库）。★ 2026-09-17：收录作业写的是 `live_channels` —— **「直播」栏目已有的那张表**（迁移 012/015/016 建的），不是 ranked 的表，所以**仍然没有新迁移** |
