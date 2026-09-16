# 追踪的视频：嵌入播放 + 平台分区 + VOD 过期下架（规格）

> **冻结日期 2026-09-16。** 上一轮的规格是 `docs/video-tracking-spec.md`（迁移 020 + 抓取那条路）。
> 本规格是它的**后续**：只改「**怎么显示**」与「**上游没有了的怎么办**」，
> **抓取那条路的判据一个字都不动**（§5.1 的三行表、§5.4 的到底判据、§10 的限额中已有那三格）。
>
> 上一轮的执行记录与遗留项在 `docs/progress.md` §二十三 / §二十四、
> `docs/pending.md` §5.85–§5.94。

---

## §1 用户原话与四条裁决

原话（2026-09-16，两段）：

> 「能否将三个平台的视频均改为嵌入式播放？bilibili 暂时只能跳转播放（就像"视频"板块那样），
> 至于封面的话能否在不在服务器中储存所有封面的情况下展示出来？」
>
> 「可以，但"追踪的博主"一栏也将 bilibili、youtube、twitch 分开，直播 vod 过期后应用里就不显示了。」

四个问题的答复（我按上面第一段的设计逐条问过）：

| 问题 | 裁决 |
|---|---|
| 三个平台的视频怎么分开？ | **和上面「用户贴的视频」那面墙**的分区**完全一致**：`全部` / `B站` / `YouTube` / `Twitch` 几个按钮 |
| 管理面板的博主名单要不要也分组？ | **要**，按平台分三段 |
| "VOD 过期"用什么当判据？ | **定期向上游核对**（批量问"这些 id 还在不在"） |
| 核对要不要也覆盖 bilibili / YouTube？ | **不要**，只做 Twitch |

⚠️ 本规格**不含**任何法律/ToS 层面的判断（用户 2026-09-15 的裁决：不考虑法律因素）。

---

## §2 实测事实（本规格的全部技术依据）

### 2.1 三个平台的凭据（2026-09-16 实测，第一次）

生产服务器上 `/etc/mcsr-helper/track.env` 配好之后，**适配器真正会打的那几条请求**全部实测通过：

```
YouTube  channels.list?part=snippet,contentDetails&forHandle=@GoogleDevelopers → 200
         playlistItems.list?maxResults=5&playlistId=UU_…                       → 200（5 个 videoId）
         videos.list?part=contentDetails,statistics,liveStreamingDetails&id=…   → 200
Twitch   POST id.twitch.tv/oauth2/token（client_credentials）                   → 200（token 30 字符）
         GET  helix/users?login=twitchdev                                      → 200
         GET  helix/videos?user_id=…&first=3&type=all                          → 200
              （duration="53m58s"、created_at、type="archive"、thumbnail_url 带 %{width}x%{height}）
```

⇒ 「凭据本身有效」这一格从"未知"变成"已测"。⚠️ 但**过期 VOD 在 `helix/videos?id=` 里的表现**
仍然只是**文档**（§11）。

### 2.2 三个平台的播放器页（Referer = 我们站点，实测）

```
bilibili  https://player.bilibili.com/player.html?bvid=BV…&page=1&high_quality=1&danmaku=0 → 200
YouTube   https://www.youtube.com/embed/FVkp6tc2rNY                                        → 200
Twitch    https://player.twitch.tv/?video=335921245&parent=mcsrhelper.com                  → 200
          （响应头 Content-Security-Policy: frame-ancestors https://mcsrhelper.com
            —— parent 是**服务端强校验**的）
Twitch    同一个地址**不带** parent → 302 /embed-error.html?errorCode=NoParent
```

### 2.3 线上 CSP **已经放行三个播放器**，这一轮一行都不用改

```
frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com
                https://player.twitch.tv https://player.bilibili.com https://www.bilibili.com
img-src   'self' data: https:
Referrer-Policy: strict-origin-when-cross-origin
```

### 2.4 封面防盗链：**bilibili 的图在我们站上是 403**（这一条是"封面为什么不显示"的答案）

同一个 URL、只换 Referer：

| Referer | bilibili CDN（`i*.hdslb.com`） | YouTube CDN（`i.ytimg.com`） | Twitch CDN（`static-cdn.jtvnw.net`） |
|---|---|---|---|
| 不带 | **200**（1.36 MB 图片） | 200 | 200 |
| `https://www.bilibili.com/` | 200 | — | — |
| **`https://mcsrhelper.com/`（浏览器现在会发的）** | **403**（170 B HTML） | 200 | 200 |

⇒ 判据是 Referer 白名单，而 **`strict-origin-when-cross-origin` 会让浏览器在跨域取图时发我们域名**
⇒ bilibili 的封面今天全是破图。
⇒ 修法：给那张 `<img>` 加 `referrerpolicy="no-referrer"`（不带 Referer 就是 200）。
⚠️ **不落盘**：库里存的从来就是**图片 URL**（`tracked_videos.thumbnail_url`），
没有任何图片经过我们的服务器 —— 这条要求今天就已经满足，缺的只是上面那个属性。

### 2.5 「点一下才加载」的嵌入实现**已经有一份**（`ClickToPlayEmbed`）

- 它是**全站唯一**一份嵌入实现，注释里写着"要嵌视频就必须走这个组件"；
  视频墙与资源库的视频资料都在用它。
- 它默认画一个**门面**，只有被点过的那一个才挂 `iframe`（理由：一页几十条同时挂 iframe 会把主线程占满，
  而且"加载不出来的卡片是一片白"与"我们数据坏了"长得一样）。
- 它把平台差异收在一处：`allow` 按平台给、B站 不支持起播偏移要如实说明、
  Twitch 的 `parent` 用 `location.hostname`。
- ⚠️ **它现在的门面上没有封面**，理由是 `packages/shared/src/videos.ts` 的铁律
  「绝不抓取任何元数据」（封面 URL 必须从平台接口取）—— 而那条铁律**只约束用户自贴那条路**，
  追踪这条路的立身之本**就是**抓元数据（`video-tracking-spec.md` §8.1 已把两条路分开写死）。
  ⇒ 见 §8.1。

### 2.6 上面那面墙的分区按钮长什么样（要**照抄**的东西）

`apps/web/src/routes/Videos.tsx`：`<div class="tagcloud">` 里一个 `tagcloud__label`
（词条 `videos.allPlatforms`）+ 一个「全部」chip + 每个平台一个 chip；
chip 的类名是 `tagchip`，选中态是 `tagchip--on`；平台名走 `videos.platform{Bilibili,Youtube,Twitch}`；
**筛选在服务端做**（`?platform=` 进 URL，换条件时 `page` 被删掉 = 回到第 1 页），
所以分页是"筛选之后"的分页，`total` 也是筛选后的。

---

## §3 数据模型（迁移 021，下一个编号）

`tracked_videos` 加**三列**（都可为 `NULL`），列单位与前两张表一致：**Unix 秒**
（`video-tracking-spec.md` §4 的 ★★ 块：本栏目一律秒，`audit_log` 才是毫秒）。

```sql
ALTER TABLE tracked_videos ADD COLUMN verify_checked_at INTEGER;   -- 上一次向上游核对"还在不在"的时刻
ALTER TABLE tracked_videos ADD COLUMN hidden_at         INTEGER;   -- 被隐藏的时刻
ALTER TABLE tracked_videos ADD COLUMN hidden_reason     TEXT;      -- 为什么隐藏（词表见 §3.2）
```

- **迁移文件**：`services/api/src/db/migrations/021_tracked_video_visibility.ts`，
  导出 `m021TrackedVideoVisibility`（命名照 020）。
- ⚠️★ **必须在 `services/api/src/db/migrate.ts` 里 import 并登记**（`{ name: '021_tracked_video_visibility', sql: … }`）。
  **没登记的迁移根本不会跑**，而它的表现是"代码看着对、库里没有那三列"
  （上一轮 T1 就是栽在这里，见 `progress.md` 的 Ruling）。
- ⚠️ 迁移只用 `ALTER TABLE … ADD COLUMN`（SQLite 支持，且**不需要**重建表）；
  **不要**建新索引：候选查询的规模是"每个博主几百到几千行"，现有的
  `idx_tracked_videos_recent`（`platform, published_at`）够用。
- 迁移是**幂等**的（本仓迁移框架按名字记账，只跑一次）。

### 3.1 三列的语义

| 列 | 写入者 | 语义 |
|---|---|---|
| `verify_checked_at` | CLI 的核对阶段（§6） | "我们上一次问上游'这条还在不在'是什么时候"。**每一批问到的 id 都要写**（在的与不在的都写），它同时是**轮转游标** |
| `hidden_at` | CLI 的核对阶段 | 被隐藏的时刻（§4 DDL 冻结的 `status` 那一列由 `visible` 变 `hidden` 的同时写） |
| `hidden_reason` | CLI 的核对阶段 | 见 §3.2 |

⚠️ `status` 这一列**早就存在**（迁移 020），公开列表在**数据层**过滤 `status = 'visible'`
（`tracked-videos.ts` 的 `listTrackedVideos`）⇒ **不需要**为"不显示"改任何查询条件。

### 3.2 `hidden_reason` 的词表（冻结）

| 值 | 谁写 | 含义 |
|---|---|---|
| `upstream_gone` | CLI 核对阶段 | 上游的批量查询**不再返回**这个 id（过期 / 被删 / 转私享都在这一格里） |

⚠️ 今天只写这一个值。词表留在这里是为了**下一个人不必猜**：看到 `upstream_gone`
就是"核对时上游没认它"，而不是"管理员手动隐藏"（那种情况以后要加新值，不许复用这一个）。

⚠️ `storedVideoCount()`（bilibili 到底判据读的那个数）**必须继续数所有行，包括隐藏的**
（`video-tracking-spec.md` §5.1 的 ★★：少算了会让回填提前收尾）。**本规格不许碰它。**

---

## §4 平台契约（适配器）：一个**可选**能力

`services/api/src/tracking/types.ts` 的 `PlatformAdapter` 加一个**可选**方法：

```ts
/**
 * 批量问上游："这些 id 你还认不认？" —— 返回**仍然存在**的那些 id。
 *
 * ★ 只有 Twitch 实现它（用户裁决：只做 Twitch）。别的平台**不实现**，
 *   调用方按"方法不存在 = 这个平台没有这个能力"处理 —— 平台差异不进公共层。
 *
 * ⚠️★ 失败**必须抛**（复用本文件已有的错误类型），**绝不许**把
 *    "请求失败"当成"这些 id 都不存在" —— 那是一次**静默的批量下架**。
 * ⚠️ 响应形状不对（`data` 不是数组、条目没有 `id`）也要**抛**，
 *    不许把"我们读不懂"当成"上游没有"。
 * ⚠️ 返回的是**集合**；调用方自己算差集（`ids - existing`）。
 */
existingVideoIds?(ids: readonly string[]): Promise<ReadonlySet<string>>;
```

Twitch 的实现（`tracking/twitch.ts`）：

```
GET https://api.twitch.tv/helix/videos?id=<id>&id=<id>…      （请求头同现有 helix 调用）
```

- **一次最多 100 个 id**（文档值，见 §11）—— 适配器内部按 `TWITCH_VERIFY_BATCH = 100` 自己切批，
  **调用方给多少它都收**（调用方那一侧的上限见 §6）。
- 复用现有的 `helixJson`（它已经带 `Client-Id` + `Bearer` 两个头，并且把 401/403/429/5xx
  都归到已有的错误类型上）。
- 只读：**不写库、不改游标、不动 `last_error`**。

⚠️ **不许**为了这个能力给 YouTube / bilibili 写空实现（返回"全都还在"）——
那会让"上游其实已经没有了"变成一条**永远不会响**的假话。

---

## §5 HTTP 与界面

### 5.1 接口：`GET /api/tracking/videos` 加一个查询参数

| 参数 | 取值 | 缺省 | 非法值 |
|---|---|---|---|
| `page` / `pageSize` | 同今天 | 1 / 24 | 400 `invalid_query` |
| **`platform`** | `bilibili` \| `youtube` \| `twitch`（**对着 `TRACK_PLATFORMS` 校验**） | 不传 = 全部 | 400 `invalid_query`（与上面那面墙同一条纪律：**封闭枚举，空串不是它的取值**） |

- 响应形状不变：`{ items, total, page, pageSize }`，但 **`total` 是"该分区内的总数"**
  （筛选在**数据层**，与 `status = 'visible'` 同一个 `WHERE`）。
- 数据层：`listTrackedVideos(opts)` 的 `opts` 加**可选** `platform?: TrackPlatform`；
  `items` 与 `total` 必须跑**同一个条件**（上一轮那条注释守的就是这件事）。

### 5.2 追踪那一栏的分区按钮（**照抄 §2.6**）

- 位置：`TrackedVideos.tsx` 里列表**上方**，与上面那面墙同一个视觉（同 `tagcloud` / `tagchip` 类名，
  **不新增 CSS**）。
- 四个按钮：`全部`（词条 `videos.allPlatforms`）+ `TRACK_PLATFORMS` 逐个
  （词条复用 `videos.platformBilibili` / `videos.platformYoutube` / `videos.platformTwitch`）。
- **URL 参数是 `tplatform`**，不是 `platform` —— 理由见 §8.2。
- 换分区时**把 `tpage` 删掉**（= 回到第 1 页），与那面墙"换筛选回第一页"一致；
  并且**不许碰** `platform` / `page`（上面那面墙的状态）。
- 地址栏里的 `tplatform` 要**先对着 `TRACK_PLATFORMS` 校验再用**：
  手打 `?tplatform=foo` 必须退化成"全部"，**不许**变成一个 400 错误页
  （那面墙的注释里写着同一条）。

### 5.3 卡片：封面变成"点一下才播"的门面

`TrackedVideos.tsx` 的卡片里，今天那张纯 `<img>` 换成 `ClickToPlayEmbed`：

| 传什么 | 值 |
|---|---|
| `platform` | `video.platform` |
| `idLabel` | `video.externalId`（BV 号 / YouTube videoId / Twitch 数字 VOD id） |
| `title` | `video.title` |
| `startOffsetSec` | **`null`**（追踪这条路上没有起播偏移这个概念） |
| `src` | **不传**（由 `buildEmbedUrl` 按平台拼，三个平台都已经在它里面） |
| `coverUrl` | `video.thumbnailUrl`（**新加的可选 prop**，见下） |
| `children` | **今天那条"去原站"外链，原样保留**（域名与形状仍走 `watchUrl`） |

`ClickToPlayEmbed` 加**一个可选 prop**：

```ts
/** 门面上的封面图地址。**只有追踪这条路会传**（用户自贴那条路按铁律没有封面，见 §8.1）。 */
coverUrl?: string | null;
```

- 传了就把封面画在门面上（上面盖播放三角），**没传时外观一个像素都不变**。
- ⚠️ `coverUrl` 为 `null`（YouTube / Twitch 都可能没有封面）时，门面回到**今天那个纯色块**
  —— **不许**为了"看起来统一"画一个空框或一条破图边框：那种东西每一次都要求人解释一次。
- 封面 `<img>` 的三个属性是**契约**：`alt=""`（**装饰性** —— 按钮自己带
  `aria-label`，标题就在下方标题里，不该再让读屏念一遍）、`loading="lazy"`、
  **`referrerpolicy="no-referrer"`**（§2.4 那个 403 就是它修的）。
- 点下去 = 真的挂 iframe，`data-embed-src` 上挂着**将要加载的地址**（自检要断言它，见 §9）。

### 5.4 管理面板：博主名单按平台分三段

- `TrackedVideos.tsx` 的面板里，名单按 `platform` 分成三段（顺序照 `TRACK_PLATFORMS`），
  每段一个小标题（复用 `videos.platform*` 词条）+ 该段条数。
  ⚠️★ **段内不排序**：那一段只是把名单接口返回的那个数组按 `platform` **过滤**一遍
  （`creators.filter(...)`），所以段内顺序就是**名单查询给的顺序** ——
  `listCreators` 的 `ORDER BY c.created_at DESC, c.id ASC`，即**新加入的排在前面**。
  界面这一层**一次都不许再排**（再排一次就是第二份"谁在前"的口径）；也**不许**照
  "加入顺序"去补一句 `created_at ASC` 的排序 —— 那会把整份名单**倒过来**。
- 三段各自的表头列不变（启用/停用、显示名、视频数、上次同步、错误、动作）。
- ⚠️ **空的分段不渲染**（那个平台一个博主都没有时，连小标题一起不画）—— 与"空容器不渲染"
  同一条纪律；而**三段都空**时，保留今天那句空态文案。
- 每段的"视频数"那一格：当该博主有被隐藏的行时，显示成 **`N（隐藏 M）`**，
  M = 0 时**不显示括号**（与"空容器不渲染"同一条纪律：不存在的状态不需要解释）。
  ⇒ `TrackedCreator`（`packages/shared/src/tracking.ts`）加 `hiddenCount: number`，
  `listCreators()` 的 SQL 用 `SUM(CASE WHEN v.status = 'hidden' THEN 1 ELSE 0 END)` 算；
  ⚠️ `videoCount` 的语义**不变**（库里有多少条，含隐藏）—— 理由同 §3.2 的 ★★。

---

## §6 CLI：多一个"下架核对"阶段

`services/api/src/track.ts` 的 `runOnce` 今天有两个阶段（回填、增量）。加**第三个**：

```
③ 核对：挑出"可能需要核对"的行 → 按平台能力分批问上游 → 上游没返回的标成 hidden
```

### 6.1 候选怎么挑（数据层新函数）

```ts
/** 挑这一轮要核对的视频（只有实现了 existingVideoIds 的平台才会被挑到）。 */
pickVerifiableVideos(opts: { platform: TrackPlatform; minAgeSec: number; limit: number }):
  Array<{ id: string; externalId: string; platform: TrackPlatform }>;
```

```sql
SELECT id, external_id, platform FROM tracked_videos
 WHERE platform = ? AND status = 'visible' AND published_at <= ?      -- published_at <= now - minAgeSec
 ORDER BY COALESCE(verify_checked_at, 0) ASC, id ASC
 LIMIT ?
```

- **`ORDER BY COALESCE(verify_checked_at, 0)` 是轮转游标**，不是"最新的优先"：
  最新优先会让同一批新视频每轮都被查一遍，而**老的那些永远轮不到**（上一轮 `pickDueCreators`
  的排序注释里写着同一条理由）。
- `minAgeSec` 是**粗筛**：Twitch 的存档最早 7 天过期，所以刚发出来的根本没得可查
  ⇒ `VERIFY_MIN_AGE_SEC = 6 * 86400`（6 天），省掉大量无意义请求。
- `limit` = §10 冻结表里的 `verify`（**200**）。

### 6.2 一轮里的行为（★ 四条安全线）

0. **★ 先决定核对哪些平台**（这一步写错 = 永远不核对，而且**不响**）：
   逐个走 `TRACK_PLATFORMS` ——
   · `platformStatus()` 是 `skipped:no-credentials` 的**直接跳过**（连适配器都不要，
     要了会抛 `NoCredentialsError`）；
   · 拿到适配器之后判 **`typeof adapter.existingVideoIds === 'function'`**，
     不是函数就跳过（今天只有 Twitch 是）。
   ⇒ "没有这个能力的平台"与"这个平台没配凭据"是**两件事**，都不算失败、都不影响退出码。
   ⚠️ `TRACK_LIMITS.verify` 是**每个平台各自**的上限（今天只有一个平台会走这条路，
   但把它写成"全局共享 200"会在加第四个平台时静默地少查一半）。
1. **一批问一次**：`existingVideoIds(ids)` 拿到"还在的集合"，`ids - existing` = 消失的。
2. **写库**：
   - 每一个被问到的 id 都写 `verify_checked_at = now`（在的与不在的都写，否则轮转会卡住）；
   - 消失的那些：`status = 'hidden'`、`hidden_at = now`、`hidden_reason = 'upstream_gone'`。
3. **★ 失败时一条都不隐藏**：`existingVideoIds` 抛了 ⇒ 这一批**什么都不写**
   （连 `verify_checked_at` 都不写，理由：下一次再问一次是幂等的，而"记成查过了"会让它轮到队尾）。
   ⇒ 这条是"静默批量下架"的**唯一**防线，§9 里有专门的断言。
4. **★ 一批里"消失得太多" ⇒ 整批放弃**（2026-09-16 终审加的这一条，冻结值）：
   一次上游回答 `200`、而 `data` 短得离谱（或者干脆是空数组）**不是**"这一批都过期了"的
   正常形状 —— 它更像"上游换了形状"或"我们问错了 id"。而一次核对最多能埋掉
   `TRACK_LIMITS.verify`（**200**）行、退出码还留在 0，**并且应用里根本没有"恢复显示"
   这个动作**（§7 第 2 条：`status` 一旦变 `hidden` 就只由人改回来）⇒ 一次坏的 `200`
   就是一次**手工改库**。
   - 判据（两个常量都从 `services/api/src/track.ts` 导出，挨着别的核对常量）：
     **这一批问到的 id 至少 `VERIFY_MIN_BATCH_FOR_RATIO = 10` 个**，
     **且消失的个数 `missing > ids.length / 2`**（`VERIFY_MAX_MISSING_RATIO = 0.5`）
     ⇒ 这一批**一条都不隐藏、一个字段都不写**（连 `verify_checked_at` 都不写），
     只记**一条** `verifyErrors`，消息里写明"**多少个里的多少个**不见了、这一批被放弃"，
     于是退出码非零（§6.3）—— 它**不是**静默的，而是"响"的。
   - ⚠️ **那个 10 的下限不是装饰**：刚加的博主手上可能只有三五条 VOD，而它们**真的**会
     一起过期（Twitch 的存档最早 7 天）⇒ 批次小于 10 时这条闸不生效，
     否则"新博主的第一批"永远下不掉、那一栏永远留着几条已经没了的视频。
   - ⚠️ 比较是**严格大于**一半：12 个里 6 个不见了 = **照常隐藏**那 6 个（边界值有一条
     专门的测试钉着，见 `tracking-run.test.ts` 的「核对阶段」那一组）。
   - ⚠️ 它**不**替代第 3 条：`existingVideoIds` 抛错照样是"这批没问清"（什么都不写），
     而这一条管的是"问清了、但答案长得不像真的"。

### 6.3 摘要与退出码

摘要加一行（`formatSummary`）：

```
  核对: 查 200 个 / 隐藏 3 个
```

- **永远打印这一行**（没有可核对的平台时是 `查 0 个 / 隐藏 0 个`）——
  与 `回填:` / `增量:` 两行同一个姿态：数字本身是"这一轮做过什么"的证据。
- 核对失败**不算创作者失败**（`failures` 那一列是"某个博主抓不动"），单独记：

```ts
RunSummary.verify = { checked: number; hidden: number; failed: number };
RunSummary.verifyErrors: Array<{ platform: TrackPlatform; error: string }>;  // 一批一条，最多几批
```

- 打印：每条一行，前缀与创作者失败**分开**：`  ⚠️ 核对失败: platform=twitch error=…`
- `exitCodeFor`：`verifyErrors.length > 0` **也算失败**（非零退出）。理由与今天一致：
  "上游没接上"必须让 `systemctl --failed` 变红，否则它会静默地永远不隐藏任何东西
  （而"什么都没隐藏"与"全都还在"在界面上完全一样）。

### 6.4 `dryRunPlan` 也要说这件事

`--dry-run` 的正文加一行：这一轮**会核对多少条**（候选数，不打印 id）。

---

## §7 非目标

1. **不做** YouTube / bilibili 的存在性核对（用户裁决：只做 Twitch）。理由写在这里：
   YouTube 能批量查（便宜），bilibili 只能一条一个请求（按今天几千条的量会很贵）。
2. **不做**"隐藏之后自动恢复"：`status` 一旦变 `hidden` 就**只由人改回来**
   （今天面板上还没有这个动作；真需要时是另一次改动，不许顺手加）。
3. **不动**抓取那条路的任何判据（§5.1 三行游标表、§5.4 到底判据、`storedVideoCount` 的语义、
   §10 已有的三格限额）。
4. **不给**追踪这条路加起播偏移（没有这个需求，而 B站 的嵌入播放器本来也不支持）。
5. **不存**任何图片：封面继续只存 URL（§2.4）。
6. **不改** `deploy/Caddyfile` 的 CSP（§2.3 已经放行）。
7. **不做**"过期前预判"（不按 7/14/60 天的保留期推算）—— 用户选了实测那条路，
   而且 Twitch 的 highlight 是永久保留的，按天数推会误伤。

---

## §8 与既有裁决的关系（写清楚，否则下一个人会以为我们自相矛盾）

### 8.1 门面上有封面 ≠ 破了「绝不抓取任何元数据」的铁律

- 那条铁律住在 `packages/shared/src/videos.ts` 的文件头，约束的是**用户自贴那条路**
  （用户只给一个链接，我们承诺不去扒它的标题/封面）。
- 追踪这条路**存在的意义就是抓元数据**（`video-tracking-spec.md` §8.1 已经逐字裁决过：
  "两条路并存，不是例外关系"）。它的封面来自适配器，存进 `tracked_videos.thumbnail_url`。
- ⇒ `ClickToPlayEmbed` 的注释里那段「门面上为什么没有封面图」要**改准**：
  从"因为铁律"改成"**因为调用方没有封面**；要嵌的这条路若自己有封面（追踪），可以传进来"。
  ⚠️ **一个字的结论都不许改**：用户自贴那条路**仍然不许**去取封面。

### 8.2 为什么分区参数叫 `tplatform` 而不是复用 `platform`

`/videos` 一个页面上有**两**面墙：用户贴的（`?platform=&authorId=&page=`）与追踪的（`?tpage=`）。
共用一个 `platform` 的后果是**两个区块互相改对方的筛选**，而它只有在两处都被用过时才看得见
（`setTrackedPage` 的注释里已经为 `tpage` 写过一遍同样的理由）。
⇒ 追踪那一栏的参数一律带 `t` 前缀：`tpage`（已有）、`tplatform`（本规格新增）。

### 8.3 为什么"隐藏"而不是"删除"

用户要的是"**不显示**"，不是"从库里抹掉"。保留行有三个作用：
① 审计（它曾经存在过、什么时候被隐藏、为什么）；② `storedVideoCount` 的语义不被破坏（§3.2）；
③ 上游哪天又返回它了，我们手上还有那一行的历史。
⚠️ 而"隐藏"这件事**必须留痕**（`hidden_at` + `hidden_reason`）：一次静默的批量隐藏
与"抓取从来没成功过"在界面上完全一样 —— 这正是本仓反复写下来的那一类失败。

### 8.4 上一轮的验收项 R4「六个字段都在」**一格没少**

标题、封面、发布时间、时长、播放量、评论数六格全部照旧显示；变的是封面那一格的
**可访问名从 `<img alt>` 挪到了包住它的按钮上**（`aria-label` = 播放 + 标题，`img alt=""`）。
⇒ 渲染自检里"封面（`src`+`alt`+`lazy`+16:9）"那条断言要**改成**断言
`aria-label` 含标题 + `src`/`lazy`/`referrerpolicy` 三样，**不是**把这一格删掉。

---

## §9 验收（逐条可测）

**适配器（Twitch）**

1. `existingVideoIds(['1','2'])` → 上游只返回 `1` ⇒ 结果是 `{1}`，**调用方**据此隐藏 2。
2. 上游返回非 200 / 非 JSON / `data` 不是数组 ⇒ **抛**，而且**没有任何**"全都还在"的回落。
3. 超过 100 个 id 时**自己切批**（断言请求次数 = `ceil(n/100)`）。

**数据层**

4. `pickVerifiableVideos` 只挑 `platform` 匹配 + `status='visible'` + `published_at <= now-6d` 的行；
   顺序是 `COALESCE(verify_checked_at,0) ASC`（断言：先挑没查过的，再挑查得最早的）。
5. `listTrackedVideos({ platform })` 的 `items` 与 `total` **同条件**（断言：隐藏一行之后两个数一起减）。
6. `listCreators()` 的 `hiddenCount` 数与库里隐藏行数一致；`videoCount` **不受隐藏影响**（这条最重要，
   因为它是 bilibili 到底判据的输入）。

**CLI**

7. ★★ **上游失败 ⇒ 零隐藏**：mock 适配器抛错 ⇒ `status` 一条都没变、`verify_checked_at` 一条都没写、
   摘要里出现 `⚠️ 核对失败:`、`exitCodeFor` 返回 1。
8. 上游少返回一个 id ⇒ **只有那一条**变成 `hidden`，三列同时写上，别的行不动。
9. 没有 Twitch 博主（或平台没实现这个能力）⇒ 一轮照常跑完，摘要里是 `核对: 查 0 个 / 隐藏 0 个`，退出码 0。
10. `--dry-run` 里出现"这一轮会核对 N 条"，且**不发任何请求**。

**API**

11. `GET /api/tracking/videos?platform=twitch` 只回 Twitch 的，`total` 是 Twitch 的总数；
    `platform=foo` ⇒ 400 `invalid_query`；不传 ⇒ 与今天完全一致。
12. 匿名可读（与今天一样，不需要登录）。

**界面（渲染自检 `apps/web/scripts/videorender.tsx`，中英各一遍）**

13. 分区按钮四个（全部 + 三个平台），选中态跟着 `tplatform` 走；`全部` 选中时**只有它**带 `--on`
    （与上面那面墙一致 —— T7 的实现者指出本行原来那句"`全部` 时没有 chip 带 `--on`"与 §5.2
    和 §2.6 要照抄的行为矛盾，2026-09-16 改正）。
14. 三张卡各自的 `data-embed-src` 形状：bilibili 含 `bvid=`、YouTube 含 `/embed/`、
    Twitch 含 `video=v` 与 `parent=`。
15. 封面 `<img>`：`referrerpolicy="no-referrer"`、`loading="lazy"`、`alt=""`；
    门面按钮的 `aria-label` 含标题（§8.4）。
16. 面板：三段小标题 + 段内条数；`hiddenCount>0` 的行显示 `N（隐藏 M）`，`=0` 的行**没有括号**。

**生产核对（上线后由人跑一次，不算进流水线）**

17. 加一个 Twitch 博主 ⇒ 抓取正常；等一轮核对之后，隐藏条数与 `hidden_reason` 分布读得出来。

---

## §10 冻结表

| 项 | 冻结值 |
|---|---|
| 迁移编号与名字 | `021_tracked_video_visibility`（**必须登记进 `migrate.ts`**） |
| 新列 | `verify_checked_at INTEGER` / `hidden_at INTEGER` / `hidden_reason TEXT`（**Unix 秒**） |
| `hidden_reason` 词表 | `upstream_gone`（今天只有这一个） |
| 适配器方法 | `PlatformAdapter.existingVideoIds?(ids: readonly string[]): Promise<ReadonlySet<string>>`（**只有 Twitch 实现**） |
| Twitch 批量上限 | `TWITCH_VERIFY_BATCH = 100`（适配器内部切批） |
| 核对的最小年龄 | `VERIFY_MIN_AGE_SEC = 6 * 86400` |
| 批量核对的比值闸 | `VERIFY_MIN_BATCH_FOR_RATIO = 10`（一批问到这么多 id 才受闸）与 `VERIFY_MAX_MISSING_RATIO = 0.5`（消失的**超过一半** ⇒ 这一批一条都不隐藏、一个字段都不写、记一条 `verifyErrors`，退出码非零；§6.2 第 4 条） |
| 每轮核对上限 | `TRACK_LIMITS.verify = 200`（**每个平台各自**；`{ backfill: 20, pages: 20, incremental: 40, verify: 200 }`） |
| 候选排序 | `COALESCE(verify_checked_at, 0) ASC, id ASC` |
| 摘要新增行 | `  核对: 查 N 个 / 隐藏 M 个`（**永远打印**） |
| 核对失败前缀 | `  ⚠️ 核对失败: platform=… error=…`（与创作者的 `⚠️ 失败样例:` 分开） |
| API 查询参数 | `platform`（枚举 = `TRACK_PLATFORMS`；非法 ⇒ 400 `invalid_query`） |
| 前端 URL 参数 | `tplatform`（换分区时删 `tpage`；**不碰** `platform` / `page`） |
| 分区按钮的类名 | 复用 `tagcloud` / `tagcloud__label` / `tagchip` / `tagchip--on`（**不新增 CSS**） |
| 词条 | 复用 `videos.allPlatforms` / `videos.platform*` / `videos.play` / `videos.playHint` / `videos.embedUnavailable`；**新增只允许两个**：`tracked.hiddenCount`（面板那格的 `N（隐藏 M）`）与 `tracked.emptyPlatform`（**分区里**空的时候那一句 —— 2026-09-16 的 Ruling 9 放行：分区为空时若沿用"还没有追踪到视频 / 抓取每 10 分钟跑一轮"，会把用户送去等一次永远不会发生的抓取）。中英都要，且都要进渲染自检。 |
| 封面 `<img>` 的属性 | `referrerpolicy="no-referrer"` + `loading="lazy"` + `alt=""` |
| `ClickToPlayEmbed` 新 prop | `coverUrl?: string \| null`（不传时外观零变化） |
| 共享类型新增 | `TrackedCreator.hiddenCount: number` |
| 可见性过滤 | 仍在**数据层**（`status = 'visible'`），本规格不改它 |
| 不改的东西 | `deploy/Caddyfile` 的 CSP、`storedVideoCount` 的语义、抓取那条路的判据 |

---

## §11 文档有、实测没有（不许当成已经验过）

1. **`helix/videos?id=` 一次最多 100 个 id** —— Twitch 文档值，**没有实测**（我们只有一个能用的
   client id，而"发 101 个 id 看它报什么"不值得）。⇒ 实现时按 100 切批，并且
   **不要**依赖"超了会报错"来发现写错。
2. **过期的 VOD 在 `helix/videos?id=` 里到底怎么表现** —— 文档说"查不到的 id 就不在 `data` 里"，
   但我们**没有一条真正过期的 VOD** 可以拿来量。"消失=隐藏"这条判据的实测要等第一次
   真的有人过期（§9 的生产核对第 17 条会看到第一批）。
3. **`highlight` / `upload` 的永久性** —— 官方帮助页的说法，没有实测；所以核对**只用"
   上游还认不认"**当判据，**不**用"类型/天数"推算（那样才不会因为文档变了而误伤）。
4. **bilibili 的防盗链策略** —— §2.4 那张表是今天量的，但它随时可能变；
   `no-referrer` 是"我们不提供 Referer"，**不是**"上游承诺放行"。
5. **Twitch VOD 的保留期档位**（普通 7 / 合作 60 天等）—— 与我们**无关**（§7 第 7 条），
   写在这里只是为了下一个人别把它当判据。
