/**
 * YouTube 适配器（spec §5.2 / §5.4 / §5.5）—— 需要 `MCSR_YOUTUBE_KEY`。
 *
 * ===========================================================================
 * 一、★★ uploads 播放列表 ID 的那条路（§5.5 + `CreatorRef.platformMeta`）
 * ===========================================================================
 * §5.2 写得很清楚：`resolveCreator` 拿到的 `contentDetails.relatedPlaylists.uploads`
 * **要存下来**，"否则每轮都要多发一次 `channels.list`"。
 *
 * T4 的实现者发现那一列**没有写入方**（`tracked_creators.platform_meta` 谁都不填），
 * 于是 §5 给 `CreatorRef` 补了一个可选字段 `platformMeta`。⇒ 本适配器两边都做：
 *   · `resolveCreator` 把它填进 `platformMeta`（`createCreator` 落库成 JSON 文本）；
 *   · `fetchPage` 从 **creator 上读回来**（`readUploadsPlaylistId`），一个
 *     `channels.list` 都不发。
 * ⚠️ 读不回来时**抛**，而且**不补**那次 `channels.list`。补上的代价很具体：
 *    那正是这一列想省掉的那一次请求，补上就等于把这个缺口藏起来 ——
 *    每轮白烧一次配额，而且从日志上完全看不出来（配额是 10,000/天，×40 个博主 ×144 轮/天）。
 *    抛出去的代价是"这一行数据缺一格"变成一件**看得见**的事（管理面板的"上次错误"那一列
 *    就写着 `last_error`），修法在 message 里。
 *
 * ===========================================================================
 * 二、★ 时间戳：ISO 8601 → **Unix 秒**（spec §4 那个 ★★ 块）
 * ===========================================================================
 * `snippet.publishedAt` / `contentDetails.videoPublishedAt` 是 ISO 8601，
 * 而本栏目两张表**一律 Unix 秒**（不是毫秒 —— 全仓其它表是毫秒，见 §4 的裁决）。
 * ⇒ `Math.floor(Date.parse(...) / 1000)`。
 * ⚠️ 写错这一格**没有任何东西会报错**：`published_at` 只是变成毫秒，
 *    而它是公开列表的**排序键**（`published_at DESC`）⇒ 顺序看着全对，
 *    界面上渲染出来是几万年之后。所以 `tracking-platforms.test.ts` 对着它逐值断言。
 * ⚠️ **必须带时区**（`Z` 或 `±HH:MM`）：`Date.parse('2015-03-06T20:23:34')` 在 JS 里
 *    是**本地时间**，而这台机器是 +08:00 ⇒ 会静默偏 8 小时。没有时区一律 `null`。
 * ⚠️ 与 `twitch.ts` 里那一份是**同一个规则的两份实现**（两份各自的理由与代价写在
 *    `twitch.ts` 的同名函数上）—— 测试里有一条"同一个时刻在两条路上必须是同一个秒数"
 *    钉着它们，**别删那条断言**。
 *
 * ===========================================================================
 * 三、★ 为什么这里要两次调用，以及那条 50 的硬边界
 * ===========================================================================
 * `playlistItems.list` **不给时长、也不给播放量**（spec §2.5 逐字）⇒ 拿到 id 之后
 * 还要 `videos.list?part=contentDetails,statistics&id=<逗号分隔>` 批量补一次。
 * ⚠️ `id=` 的硬上限是 **50 个**（spec §2.5 逐字的那句文档事实），所以这里是**分批**的
 *    （`chunk` 那个循环 + `YOUTUBE_ID_BATCH_MAX`）。超了上游回 HTTP 400，
 *    而"51 个"这种事**不会**在写代码的当天发生 —— 它发生在某天 `maxResults` 变大之后。
 *    ⇒ 测试喂 51 条，断言"两次调用、每批 ≤ 50"。
 * ⚠️ 配额：`playlistItems.list` 与 `videos.list` 各 **1 unit / 次**（**不是**每个 id 一个 unit），
 *    所以"一批 50 个"与"一批 5 个"的成本一样，而分批不会翻倍。
 *
 * ===========================================================================
 * 四、★ 失败分类（谁的问题，而不是"谁抛的"）
 * ===========================================================================
 * | 情况                                   | 抛什么                  | 处置 |
 * |---------------------------------------|-------------------------|------|
 * | 发不出去 / 20 秒超时                   | PlatformUnavailableError | 过一会儿再来 |
 * | HTTP 429 / 5xx                         | PlatformUnavailableError | 同上（这就是它的字面意思） |
 * | HTTP 401 / 403（key 无效、配额用尽）    | PlatformHandshakeError   | **本轮放弃整个 YouTube** |
 * | 200 但不是 JSON（网关拦下来的 HTML）     | PlatformHandshakeError   | 同上 |
 * | 顶层形状漂移（`items` 不是数组）        | PlatformHandshakeError   | 同上 |
 * | 单条坏了（缺 videoId / title）          | YouTubeRejectedError     | 这一个 creator 失败 |
 *
 * ★ 为什么凭据级与顶层形状漂移算**平台级**：这两件事在同一个平台的每个 creator 身上
 *   会**一模一样**地重演（同一个 key、同一个接口），而 §5.1 那句"握手失败要当作本轮
 *   放弃 bilibili，不能带着空 cookie 继续打（那会白吃一堆 412）"讲的正是这件事 ——
 *   YouTube 只是没有一个独立的"握手请求"，它的凭据是在**第一个业务请求**上被验证的。
 *   代价：真出现"只有某一个频道碰到的怪形状"时，这一轮整个 YouTube 都不抓（10 分钟后重来）。
 * ★ 为什么 `resolveCreator` 只抛**三种**类型（InvalidCreatorInputError /
 *   PlatformHandshakeError / PlatformUnavailableError）：它的唯一消费者是 HTTP 路由，
 *   而路由的失败分派是**按类型**的一张七行表（`routes/tracking.ts`），表外的异常会
 *   `throw` → 500"我们的 bug"。⇒ 这里把 `YouTubeRejectedError`（400/404 那种）
 *   重新贴成平台级，**一个文件里只做这一次转换**（见 `resolveCreator` 的 catch）。
 *   ⚠️ `fetchPage` **没有**这个约束：它只被 CLI 的 catch 接住、进 `last_error`，
 *     所以那边可以用 `YouTubeRejectedError` 说清楚"这是这一个 creator 的事"。
 *   ⚠️ 代价（认下并记在这里）：多一种类型还要别人去路由那张表里加一行 ——
 *     本任务的文件表里没有 `routes/tracking.ts`，所以这里选了"不新增路由看不懂的类型"。
 *
 * ===========================================================================
 * 五、⚠️ 哪些是**文档**、哪些是**实测**（本文件没有一条来自真实响应）
 * ===========================================================================
 * 本机与本仓**一个 key 都没有**（spec §2.7 实测；`systemctl show` 里也没有），
 * 所以下面每一处字段名与参数名都来自官方方法页原文，**不是**一次真实调用的读数：
 *   · `channels.list?part=snippet,contentDetails&forHandle=@handle` → `items[0].id`
 *     / `snippet.title` / `snippet.customUrl` / `snippet.thumbnails.*`
 *     / `contentDetails.relatedPlaylists.uploads`；
 *   · `playlistItems.list?maxResults=50`（文档：0–50，默认 5）、
 *     `contentDetails.videoId` / `contentDetails.videoPublishedAt` /
 *     `snippet.publishedAt`（**加进播放列表**的时间）/ `nextPageToken`；
 *   · `videos.list?id=`（逗号分隔、最多 50 个）、`statistics.viewCount` 是**字符串**
 *     （`"59997"`，不是数字 → 解析见 `asCount`）；
 *   · `liveStreamingDetails.actualEndTime`（这一条的**字段清单**是
 *     `docs/platform-api-feasibility-notes.md:237-263` 从官方页面抄下来的）。
 * **唯一量过**的东西是**报错信封**的形状：无 key 调用回 403
 * `{"error":{"code":403,…,"errors":[{"reason":"forbidden"}]}}`
 * （`docs/platform-api-feasibility-notes.md:280-286`）—— 本文件据此读 `reason`，
 * 但那是一次 **403**，不是一次成功响应。⇒ **不许把本文件读成"跑通了"。**
 *
 * ⚠️ 最后一次核对官方文档的日期：**2026-09-16 之后没有网络**（本机 `web_fetch` 全部失败），
 *    所以"文档如此"这四个字指的是"抄自本仓 `docs/` 里已经记下来的官方原文"，
 *    而不是"今天我重新读过一遍"。
 *
 * ===========================================================================
 * 六、为什么 `part` 比 §5.2 多了一格 `liveStreamingDetails`
 * ===========================================================================
 * §5.2 写的是 `part=contentDetails,statistics`，而 §4.3 那张标签表把 YouTube 的
 * `liveReplay` 判据**点名**成 `liveStreamingDetails`（"Twitch 有 `type='archive'`；
 * YouTube 有 `liveStreamingDetails`"）。⇒ 少这一格，YouTube 就永远打不出 `liveReplay`
 * 标签，而且**没有任何东西会报错**（那正是本仓最讨厌的失败形状）。
 * 代价：**0** —— `videos.list` 是"1 unit / 次"，多加一个 part 不多花钱
 * （`docs/platform-api-feasibility-notes.md:271`："`videos.list` with
 * `part=liveStreamingDetails` → 1 unit per call"）。
 * ⚠️ 判据取"**已经结束**的直播"（`actualEndTime` 在），不是"有 liveStreamingDetails"：
 *    正在直播的那一条也有这个对象（只有 `actualStartTime`），而它不是"回放"。
 *    取另一侧的代价是一个**会被人看见的错标签**（直播期间那个视频挂着 `liveReplay`）。
 *    代价（认下）：正在直播的那一条要到它结束之后的那一轮才会被改成 `true`
 *    （upsert 是幂等的，所以它会自己修好）。
 */
import type { TrackedCreator } from '@mcsr/shared';

import { parseYouTubeDuration } from './parse';
import {
  type CreatorRef,
  type FetchedVideo,
  type FetchPage,
  InvalidCreatorInputError,
  type PlatformAdapter,
  PlatformHandshakeError,
  PlatformUnavailableError,
} from './types';

// ---------------------------------------------------------------------------
// 常量（照 `parse.ts` / `bilibili.ts` 的排法：先看见规则，再看见用它的人）
// ---------------------------------------------------------------------------

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const CHANNELS_PATH = 'channels';
const PLAYLIST_ITEMS_PATH = 'playlistItems';
const VIDEOS_PATH = 'videos';

/**
 * 每页条数。§5.2 冻结值 `maxResults=50`，而它同时是**文档上限**（0–50，默认 5）。
 * ⚠️ 它也是 `videos.list` 那批 id 的天然来源：一页最多 50 条 ⇒ 一般的页正好一批。
 *    但**不许**因此省掉分批（见下面的 `YOUTUBE_ID_BATCH_MAX`）：这两个数字今天相等，
 *    而它们**不是同一条规则** —— 一个变了另一个不会跟着变，那一天 51 个 id 会变成一次 400。
 */
export const YOUTUBE_PAGE_SIZE = 50;

/**
 * ★ `videos.list` 的 `id=` 一次最多几个（文档硬上限，§2.5 逐字："最多 50 个 id"）。
 *
 * 超了的表现是一次 HTTP 400（"The request specifies more than 50 IDs"），
 * 而它**只会在有人改动 `YOUTUBE_PAGE_SIZE` 或上游放宽 maxResults 的那天才出现**。
 * ⇒ 测试把它钉死：喂 51 条 ⇒ 两次调用、每批 ≤ 50。
 */
export const YOUTUBE_ID_BATCH_MAX = 50;

/**
 * ★ `platform_meta` 里存 uploads 播放列表 ID 的那个键名。
 *
 * ⚠️ 键名是**跨任务约定**：`tracking-store.test.ts:719` 用的就是这个字面量
 *    （`JSON.stringify({ uploadsPlaylistId: 'UU-abc' })`），而数据层是**不透明**地
 *    存整份 JSON 的 —— 也就是说写错一个字母，两边都"能跑"，只是同步时读不到。
 */
export const UPLOADS_PLAYLIST_META_KEY = 'uploadsPlaylistId';

/** 单次请求的超时。照 `bilibili.ts` 那 20 秒（同一个上游可用性假设）。 */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * 缩略图与头像取哪一档（按顺序回落）。
 *
 * ⚠️ 缩略图先取 `medium`（320×180）：它与 Twitch 那边挑的 320×180 **同一个尺寸**，
 *    于是公开列表里同一排卡片的比例一致；`default` 是 120×90（4:3，自带黑边）。
 * ⚠️ 头像先取 `medium`（240×240）：够 retina，而 `high` 更大、管理面板那一格用不上。
 */
const THUMBNAIL_SIZES = ['medium', 'high', 'default'] as const;
const AVATAR_SIZES = ['medium', 'default', 'high'] as const;

/** `@handle`（照 `routes/tracking.ts` 的 `AT_HANDLE` 同形，它决定这条输入会派给谁）。 */
const AT_HANDLE = /^@[A-Za-z0-9._-]{3,64}$/;

/**
 * `UC…` channelId。文档（以及公开实现）里的形状是 24 个字符、以 `UC` 开头，
 * 这里放宽到 20–40 个字符 —— ⚠️ **本轮没有网络复核过这一条**（本机 `web_fetch` 全部失败），
 * 所以只把它当成"一个够用的形状"：这条正则只用来**决定送 `id=` 还是 `forHandle=`**
 * （送错上游会回空列表，而空列表在我们的分类里是"这个频道不存在"），
 * 宽一点比窄一点安全 —— 窄了会把一个真实但少见的 id 判成"认不出"。
 */
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{20,40}$/;

/** 时间戳末尾必须有的时区（`Z` 或 `±HH:MM`）。理由见文件头第二节。 */
const TIMEZONE_SUFFIX = /(?:Z|[+-]\d{2}:\d{2})$/i;

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

/**
 * 上游回了一个我们**用不了**的回答，而这件事是**这一个 creator** 的事
 * （比如它的 uploads 播放列表 404、某一条 item 缺 videoId）。
 *
 * ⚠️ 与 `PlatformHandshakeError` 分开，是因为 CLI 对它们的处置**不一样**：
 *    平台级的失败要**停止处理这个平台剩下的所有 creator**（§5.1），
 *    而这里的失败只让这一个 creator 这一轮失败、下一个照跑。
 * ⚠️ 没有 `retryable` / `code` 字段（bilibili 那个同名错误有）：那个类型要分开
 *    "等 10 秒能好的限流"与"等不好的拒绝"，而这里没有那两种成因 ——
 *    不加没人读的字段（`types.ts` 的四类错误也一样只带它们真被读到的东西）。
 */
export class YouTubeRejectedError extends Error {
  /** **没加平台前缀**的原文：需要"换个类型但保留原文"时用它（`resolveCreator` 那一处）。 */
  readonly detail: string;

  constructor(detail: string) {
    super(`youtube: ${detail}`);
    this.name = 'YouTubeRejectedError';
    this.detail = detail;
  }
}

// ---------------------------------------------------------------------------
// 响应体读取：一律"防御性解析"，坏形状一律抛（绝不静默当成空值）
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** 非空（trim 之后还有东西）的字符串，否则 `null`。 */
function asNonEmptyString(value: unknown): string | null {
  const text = asString(value);
  return text === null || text.trim() === '' ? null : text;
}

/**
 * YouTube 的 `statistics.*` 是**字符串**（`"59997"`），不是数字。
 *
 * ⚠️ 文档写的是**字符串**（`"59997"`）。这里**也收数字**：上游真给数字时，
 *    把它当成"没有读数"是一种静默的丢数据，而收下它没有任何代价。
 *    两者都必须能整成**非负整数** —— `Number('')` 是 `0`、`Number('1e3')` 是 `1000`、
 *    `Number('-5')` 是 `-5`，三种都会把一个坏值变成一条**看起来正常的读数**。
 * ⚠️ `'0'` **原样留 0**：那是一条真实的量测（"这支没人看"），
 *    与"上游没给这个字段"（⇒ `null`）是两件事（本仓纪律，spec §4.2）。
 */
function asCount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || !/^\d{1,15}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * ISO 8601 / RFC 3339 → Unix **秒**（`null` = 没有可用的时间）。
 * 规则与全部理由见文件头第二节（时区必须有、`0` 当成"没量到"）。
 */
function rfc3339ToUnixSeconds(raw: string | null): number | null {
  if (raw === null) return null;
  const text = raw.trim();
  if (!TIMEZONE_SUFFIX.test(text)) return null;
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return null;
  const sec = Math.floor(ms / 1000);
  return sec <= 0 ? null : sec;
}

/** 把 `fetch` 的**拒绝**翻译成一句能进日志的话（照 `bilibili.ts` 那一份：分类靠类型，日志靠名字+原文）。 */
function failureDetail(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** 读响应文本，读不到就把异常变成一句可读的话（别让它盖掉真正的失败原因）。 */
async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    return `(读响应体失败：${error instanceof Error ? error.message : String(error)})`;
  }
}

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Google 的错误信封 → 一句能进日志的话（`reason` + `message`）。
 * ⚠️ 信封形状是**量过的**（一次 403，见文件头第五节）。
 * ⚠️ 永远**不带 URL**：URL 里有 `key=`，而这句话会进 `last_error`，
 *    而那一格在管理面板上**给编辑看**。
 */
function googleErrorDetail(body: unknown): string {
  const error = asRecord(asRecord(body)?.error);
  if (error === null) return '（响应体里没有 error 对象）';
  const reason = asNonEmptyString(
    asRecord(Array.isArray(error.errors) ? error.errors[0] : null)?.reason,
  );
  const message = asNonEmptyString(error.message);
  const parts = [
    reason === null ? null : `reason=${reason}`,
    message === null ? null : `message=${message}`,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? '（error 里既没有 reason 也没有 message）' : `：${parts.join(' ')}`;
}

/**
 * 缩略图/头像：按 `order` 回落着取第一个非空 URL，都没有就 `null`。
 *
 * ⚠️ 一律 `null` 而不是空串：库里那一列是 `NULL` 可空的，而空串会让界面渲染一个
 *    "有值但是空的" `<img src="">`（它会向**当前页面**发一个请求）。
 */
function pickThumbnail(thumbnails: unknown, order: readonly string[]): string | null {
  const map = asRecord(thumbnails);
  if (map === null) return null;
  for (const size of order) {
    const url = asNonEmptyString(asRecord(map[size])?.url);
    if (url !== null) return url;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 适配器
// ---------------------------------------------------------------------------

/** 这条输入指向哪个频道：`forHandle=` 还是 `id=`（两者**二选一**）。 */
interface ChannelLookup {
  kind: 'handle' | 'id';
  value: string;
}

/**
 * 管理员那串东西 → 一次 `channels.list` 的查法。
 *
 * 接受的四种（§5.2："接受 `@handle` 或频道链接"）：
 *   · `@handle`；
 *   · `youtube.com/@handle`（后面跟着 `/videos` 之类的路径也认）；
 *   · `youtube.com/channel/<UC…>`；
 *   · 裸的 `UC…` channelId（与 bilibili 收"一串纯数字 mid"同形）。
 *
 * ⚠️ **不收** `youtube.com/c/<name>` 与 `youtube.com/user/<name>`：那两个没有可靠的
 *    参数（`forHandle` 吃的是 handle，旧式自定义名不是 handle；`forUsername` 是**另一个**
 *    接口参数，本机无从验证）。⇒ 宁可回一句"认不出、请用频道页链接"（管理员当场就能改），
 *    也不去猜一个没验证过的参数 —— 猜错的代价是一次静默的空列表（被读成"这个人不存在"）。
 * ⚠️ **不收** `youtu.be/<videoId>` 与 `youtube.com/watch?v=…`：那是**视频**链接。
 *    路由那边按 host 分发时 `youtu.be` 会落到 youtube（`routes/tracking.ts` 的
 *    `PLATFORM_HOSTS`），所以这一条必须在这里认出来并**明确拒绝** ——
 *    否则它会带着一个视频 id 去问 `forHandle`，得到的空列表会被读成"这个频道不存在"。
 */
function parseChannelInput(input: string): ChannelLookup | null {
  if (AT_HANDLE.test(input)) return { kind: 'handle', value: input };
  if (CHANNEL_ID.test(input)) return { kind: 'id', value: input };

  let url: URL;
  try {
    // 没有协议的（`youtube.com/@x`）补一个 https —— 从地址栏复制出来的东西通常没有协议。
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  if (host !== 'youtube.com' && host !== 'm.youtube.com') return null;

  const segments = url.pathname.split('/').filter(Boolean);
  const first = segments[0];
  if (first === undefined) return null;

  if (first === 'channel') {
    const id = segments[1];
    return id !== undefined && CHANNEL_ID.test(id) ? { kind: 'id', value: id } : null;
  }
  // `/@handle` 与 `/@handle/videos` 都落在这里；`/watch`、`/c`、`/user` 一律认不出。
  return AT_HANDLE.test(first) ? { kind: 'handle', value: first } : null;
}

/**
 * ★★ 从 creator 上把 uploads 播放列表 ID 读回来 —— 这个缺口就是为这一行补的
 * （§5.5 的裁决 + `CreatorRef.platformMeta`，理由与代价见文件头第一节）。
 *
 * ⚠️ 这行读法看着像"把一个 `TrackedCreator` 当字典读"，而那是**唯一不撒谎的读法**：
 *    契约里的形参类型 `TrackedCreator`（T3 冻结的 spec §5 逐字）**没有** `platformMeta`，
 *    而运行时那个对象是它的**超集** `StoredCreator`（`tracked-videos.ts` 追加的
 *    同步专用字段）。⇒ 这里不做 `as any`、也不改契约（那是别人的文件），
 *    而是把它当 `unknown` 走一遍**结构化**解析：不是对象、缺键、空串一律按"没有"处理。
 *    ⚠️ 于是"这一格没传到"与"这一格被手改坏了"表现相同 —— 两者要的动作也一样
 *       （删掉这个博主再加一次），所以合并没有代价。
 */
function readUploadsPlaylistId(creator: TrackedCreator): string {
  /*
   * ⚠️ 读法：`asRecord(creator)` 先把它变成一个字典（`Record<string, unknown>`），
   *    再按**键**取值 —— 这正是"契约里没有这一格、而运行时对象有"的唯一不撒谎的读法
   *    （bracket 与 dot 在这里等价，写 `asRecord(creator)?.platformMeta` 也一样）。
   */
  const meta = asRecord(asRecord(creator)?.platformMeta);
  const uploads = asNonEmptyString(meta?.[UPLOADS_PLAYLIST_META_KEY]);
  if (uploads === null) {
    /*
     * ★ 抛，**不补**那次 `channels.list`（文件头第一节写着为什么）。
     * ⚠️ 这句 message 会进 `last_error`，而管理面板上那一列是给编辑看的
     *    ⇒ 它必须同时说清"缺什么"与"怎么修"。
     */
    throw new YouTubeRejectedError(
      `这个 creator 的 platform_meta 里没有 ${UPLOADS_PLAYLIST_META_KEY}（§5.5 存的就是它）—— ` +
        '本轮不抓它。故意不在这里补发一次 channels.list：那正是 platform_meta 想省掉的那一次请求，' +
        '补上等于把这个缺口藏起来（每轮白烧一次配额，而日志上看不出来）。' +
        '修法：删掉这个博主再加一次（resolveCreator 会把 ID 重新写进 platform_meta）。',
    );
  }
  return uploads;
}

/** `videos.list` 拿回来的那一格（`videos.list` 才有，`playlistItems.list` 没有）。 */
interface VideoDetail {
  duration: string | null;
  viewCount: number | null;
  commentCount: number | null;
  isLiveReplay: boolean;
}

/** `playlistItems.list` 一条能提供的四个字段（时长/播放量/评论数/liveReplay 不在里面）。 */
interface PlaylistRow {
  externalId: string;
  title: string;
  thumbnailUrl: string | null;
  publishedAt: number | null;
}

export interface YouTubeAdapterDeps {
  /** Data API key（`MCSR_YOUTUBE_KEY`）。注册表读环境变量之后传进来。 */
  apiKey: string;
  /** 注入假实现，测试里**绝不打真网络**。 */
  fetchImpl?: typeof fetch;
}

export function createYouTubeAdapter(deps: YouTubeAdapterDeps): PlatformAdapter {
  const apiKey = deps.apiKey;
  const fetchImpl = deps.fetchImpl ?? fetch;

  /**
   * 发一个 GET 并读出 JSON —— 这一层的**所有**失败分类都只在这一个地方
   * （分类表见文件头第四节）。
   *
   * ⚠️ 这里**不重试**：YouTube 没有 bilibili 那种"等 10 秒就恢复"的实测依据
   *    （它是配额制：403 `quotaExceeded` 要等到太平洋时间午夜），
   *    而 `429/5xx` 的重试是**下一轮**（10 分钟后）—— 那一次退避是白给的，
   *    比在这里 sleep 一个猜出来的秒数诚实。
   * ⚠️ `key` 走查询串（§5.2 的样例就是这么写的，也是官方文档的两种用法之一）。
   *    代价：它会出现在 URL 里 ⇒ **任何日志与错误信息都不许带 URL**（见 `googleErrorDetail`）。
   */
  async function requestJson(
    path: string,
    params: Record<string, string>,
    step: string,
  ): Promise<unknown> {
    const query = new URLSearchParams({ ...params, key: apiKey });
    const url = `${API_BASE}/${path}?${query.toString()}`;

    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // "联系不上上游"的归属方是唯一知道 HTTP 层发生了什么的那一层（T5 复审的 Important 2）。
      throw new PlatformUnavailableError('youtube', step, failureDetail(error), { cause: error });
    }

    const text = await safeText(response);
    if (!response.ok) {
      const detail = `${step} 回 HTTP ${String(response.status)}${googleErrorDetail(parseJsonOrNull(text))}`;
      if (response.status === 401 || response.status === 403) {
        // ★ 凭据/配额：同一个 key 在下一个 creator 身上会一模一样地失败（§5.1 的同一条）。
        throw new PlatformHandshakeError(
          'youtube',
          step,
          `${detail}（凭据或配额的问题 —— 本轮放弃整个平台，不在这里重试）`,
        );
      }
      if (response.status === 429 || response.status >= 500) {
        throw new PlatformUnavailableError(
          'youtube',
          step,
          `${detail}（过一会儿再来：本适配器不在这里重试，下一轮是 10 分钟后）`,
        );
      }
      throw new YouTubeRejectedError(`${detail}：${text.slice(0, 200)}`);
    }

    const body = parseJsonOrNull(text);
    if (body === null) {
      /*
       * ★ 200 但不是 JSON：网关/门户把响应换掉了。**不重试、也不当成空列表**
       *   （bilibili 那边同一条：风控拦下来时会回一整页 HTML）。
       *   ⇒ 平台级：这类拦截不会只发生在某一个频道上。
       */
      throw new PlatformHandshakeError(
        'youtube',
        step,
        `响应不是 JSON（响应开头：${text.slice(0, 200)}）—— 当成空列表就会静默少存一整页`,
      );
    }
    return body;
  }

  /** 顶层容器不是我们认得的形状 ⇒ **平台级**（每一个 creator 都会撞上同一件事）。 */
  function requireArray(body: unknown, step: string, what: string): unknown[] {
    const items = asRecord(body)?.[what];
    if (!Array.isArray(items)) {
      throw new PlatformHandshakeError(
        'youtube',
        step,
        `${what} 不是数组（上游的字段形状变了）—— 当成空列表就会静默少存一整页`,
      );
    }
    return items;
  }

  /** `playlistItems.list` 的一条 → 四个字段，缺 `videoId` / `title` 就抛（理由见下）。 */
  function toPlaylistRow(raw: unknown, index: number): PlaylistRow {
    const item = asRecord(raw);
    const externalId = asNonEmptyString(asRecord(item?.contentDetails)?.videoId);
    const title = asString(asRecord(item?.snippet)?.title);

    if (externalId === null || title === null) {
      /*
       * ★ 抛，不跳过（与 `bilibili.ts` 的 `vlist[i]` 那一段同一条纪律）：
       *    · `externalId` 是 `UNIQUE (platform, external_id)` 的一半 ——
       *      空串会让**下面每一支视频覆盖同一行**（`ON CONFLICT DO UPDATE`）；
       *    · `title` 在库里是 `NOT NULL`；
       *    · "跳过这一条"是**静默少一支视频**。
       *    三种都是这一层最想避免的失败形状；抛出去 = 这个 creator 这一轮失败，日志里有原话。
       */
      throw new YouTubeRejectedError(
        `playlistItems.items[${String(index)}] 的 ${externalId === null ? 'contentDetails.videoId' : 'snippet.title'} 不是非空字符串（上游的字段形状变了）—— 跳过它会静默少一支视频`,
      );
    }

    const snippet = asRecord(item?.snippet);
    const details = asRecord(item?.contentDetails);
    /*
     * ⚠️ 发布时间取 `contentDetails.videoPublishedAt`（"这支视频什么时候发布的"），
     *    回落 `snippet.publishedAt`（**"什么时候被加进播放列表"**）。
     *    两者在 uploads 播放列表里通常相等，但语义不同 —— 而 `published_at` 是公开列表的
     *    排序键，取错那个的代价是"某支视频排错位置"，看起来完全正常。
     * ⚠️ 回落是按**"有没有"**判的，不是按"解析得出来吗"判的：`videoPublishedAt` 在、
     *    但带了坏值（没有时区之类）⇒ 结果是 `null`（上游的形状变了，**不猜**），
     *    而不是转去用另一个字段把这一格填上。
     */
    const publishedAt = rfc3339ToUnixSeconds(
      asNonEmptyString(details?.videoPublishedAt) ?? asNonEmptyString(snippet?.publishedAt),
    );

    return {
      externalId,
      title,
      thumbnailUrl: pickThumbnail(snippet?.thumbnails, THUMBNAIL_SIZES),
      publishedAt,
    };
  }

  /**
   * ★ 对拿到的 id **批量**补详情（`videos.list`）—— 时长、播放量、评论数、liveReplay
   * 都只有这里有（§5.2 / §2.5）。
   *
   * ⚠️ 分批（每批 ≤ `YOUTUBE_ID_BATCH_MAX`）：50 是文档的硬上限，超了是 HTTP 400。
   * ⚠️ 合并**按 id**（Map），**不按下标**：文档从不保证 `videos.list` 的返回顺序，
   *    按下标配对会把两支视频的时长/播放量对调 —— 而那在界面上看起来完全正常。
   *    ⇒ 测试喂一个"倒序返回"的响应来钉它。
   * ⚠️ 一条 id 不在返回里（下架/私享/地区限制）**不是错**：那一支就少几个字段
   *    （`null`），而它照样入库（拿不到的字段一律 NULL，绝不因为"详情没拿到"就把视频丢掉）。
   * ⚠️ `ids` 为空 ⇒ **一个请求都不发**（空页很常见：回填到底之后每一轮的第一页就是空的）。
   */
  async function fetchVideoDetails(ids: readonly string[]): Promise<Map<string, VideoDetail>> {
    const details = new Map<string, VideoDetail>();

    for (let at = 0; at < ids.length; at += YOUTUBE_ID_BATCH_MAX) {
      const batch = ids.slice(at, at + YOUTUBE_ID_BATCH_MAX);
      const body = await requestJson(
        VIDEOS_PATH,
        {
          part: 'contentDetails,statistics,liveStreamingDetails',
          id: batch.join(','),
        },
        'videos.list',
      );

      for (const raw of requireArray(body, 'videos.list', 'items')) {
        const item = asRecord(raw);
        const id = asNonEmptyString(item?.id);
        if (id === null) {
          /*
           * ★ 抛：分不出这一条对应哪一支视频。**不许按顺序配对**（上游不保证顺序），
           *   也不许丢掉它（那会让某一支视频静默地少掉时长与播放量）。
           */
          throw new PlatformHandshakeError(
            'youtube',
            'videos.list',
            '有一条 item 没有 id —— 分不出它属于哪一支视频（按顺序配对是错的：文档不保证顺序）',
          );
        }

        const contentDetails = asRecord(item?.contentDetails);
        details.set(id, {
          duration: asNonEmptyString(contentDetails?.duration),
          viewCount: asCount(asRecord(item?.statistics)?.viewCount),
          commentCount: asCount(asRecord(item?.statistics)?.commentCount),
          /*
           * ★ `liveStreamingDetails` 在**视频资源的顶层**（不在 contentDetails 里）。
           *   判据是"这一场直播**已经结束**"（`actualEndTime` 在）—— 理由与代价见文件头第六节。
           */
          isLiveReplay:
            asNonEmptyString(asRecord(item?.liveStreamingDetails)?.actualEndTime) !== null,
        });
      }
    }

    return details;
  }

  /**
   * 管理员那串东西 → `CreatorRef`。**一次** `channels.list`（§5.2）。
   *
   * ⚠️ 失败分类在这里被收成**三种**（都是路由那张表里认得的）：见文件头第四节。
   */
  async function resolveCreator(rawInput: string): Promise<CreatorRef> {
    const input = rawInput.trim();
    if (!input) {
      throw new InvalidCreatorInputError('youtube', rawInput, '是空字符串');
    }

    const lookup = parseChannelInput(input);
    if (lookup === null) {
      throw new InvalidCreatorInputError(
        'youtube',
        input,
        '只认 @handle、youtube.com/@handle、youtube.com/channel/<UC…> 或一个裸的 UC… channelId（youtu.be/<videoId>、/watch?v=、/c/、/user/ 都不是频道页）',
      );
    }

    try {
      const body = await requestJson(
        CHANNELS_PATH,
        {
          part: 'snippet,contentDetails',
          // ⚠️ 二选一，不许两个都送：`forHandle` 与 `id` 同时给的时候上游的行为没有文档保证。
          ...(lookup.kind === 'handle' ? { forHandle: lookup.value } : { id: lookup.value }),
        },
        'channels.list',
      );

      const items = requireArray(body, 'channels.list', 'items');
      if (items.length === 0) {
        /*
         * ★ 空列表 ⇒ **入参的问题**（400），不是 502：上游明确说"没有这个 handle/id"，
         *   而管理员当场就能改链接（与 bilibili 那边 `-404` 走 400 是同一条裁决）。
         *   报 502 的代价是编辑被送到"过一会儿再来"那个方向，于是一遍遍重贴同一条坏链接。
         */
        throw new InvalidCreatorInputError(
          'youtube',
          input,
          `上游没有${lookup.kind === 'handle' ? ` handle ${lookup.value}` : ` channelId ${lookup.value}`} 这个频道`,
        );
      }

      const item = asRecord(items[0]);
      const channelId = asNonEmptyString(item?.id);
      if (channelId === null) {
        throw new PlatformHandshakeError(
          'youtube',
          'channels.list',
          'items[0] 没有 id（上游的字段形状变了）',
        );
      }

      const uploads = asNonEmptyString(
        asRecord(asRecord(item?.contentDetails)?.relatedPlaylists)?.uploads,
      );
      if (uploads === null) {
        /*
         * ★ 抛：这一格是 §5.5 要存的东西，**没有第二来源**。
         *   猜一个（比如把 `UC…` 的前两个字符换成 `UU…`）会让我们每轮都去抓一个
         *   不存在的播放列表，而表现只是一个 404 —— 那比当场失败难查得多。
         */
        throw new PlatformHandshakeError(
          'youtube',
          'channels.list',
          'items[0] 没有 contentDetails.relatedPlaylists.uploads（§5.5 要存的就是它，猜一个会每轮都去抓一个不存在的播放列表）',
        );
      }

      const snippet = asRecord(item?.snippet);
      const customUrl = asNonEmptyString(snippet?.customUrl);
      const title = asNonEmptyString(snippet?.title);

      return {
        platform: 'youtube',
        externalId: channelId,
        /*
         * 可读标识：优先 `snippet.customUrl`（`@GoogleDevelopers` 那样），
         * 回落"管理员那次输入里的 @handle"，再回落 channelId。
         * ⚠️ 绝不回落空串：`handle` 在库里是 `NOT NULL DEFAULT ''`，
         *    而管理面板上"空白"既不是名字也看不出是占位（bilibili 那条裁决的同一件事）。
         */
        handle: customUrl ?? (lookup.kind === 'handle' ? lookup.value : channelId),
        /*
         * ⚠️ `snippet.title` 缺失时回落到 customUrl / channelId：那是**一眼能看出不对劲**的值，
         *    而 `display_name` 在库里是 `NOT NULL`（空名字会让面板那一格看起来是坏的）。
         */
        displayName: title ?? customUrl ?? channelId,
        avatarUrl: pickThumbnail(snippet?.thumbnails, AVATAR_SIZES),
        // ★★ §5.5 / §5.2："这个 ID 要存下来"—— 唯一的落点就是这里（见文件头第一节）。
        platformMeta: { [UPLOADS_PLAYLIST_META_KEY]: uploads },
      };
    } catch (error) {
      /*
       * ★ 把 `YouTubeRejectedError`（400/404 那种"我们的请求不对"）贴成平台级：
       *   这条路唯一的消费者是 HTTP 路由，而路由按**类型**分派（文件头第四节）。
       *   用 `error.detail`（不带平台前缀的那份原文）拼 message，免得出现两个 "youtube:"。
       *   ⚠️ 只在这一处转换，且 `fetchPage` 那条路上**没有**这个转换。
       */
      if (error instanceof YouTubeRejectedError) {
        throw new PlatformHandshakeError('youtube', 'channels.list', error.detail, {
          cause: error,
        });
      }
      throw error;
    }
  }

  /**
   * 抓一页：先 `playlistItems.list`，再对拿到的 id 批量 `videos.list`（§5.2）。
   *
   * ⚠️ `_ctx.storedTotal` **不读**：§5.4 说 YouTube 的"到底了"只看 `nextPageToken`
   *    （"这个接口的语义是可靠的，与 bilibili 不同"），所以那个参数在这里没有用武之地。
   *    参数本身照契约留着（T3 冻结的接口，而且它与 bilibili 那份是同一个签名）。
   */
  async function fetchPage(
    creator: TrackedCreator,
    cursor: string | null,
    _ctx: { storedTotal: number },
  ): Promise<FetchPage> {
    const playlistId = readUploadsPlaylistId(creator);

    const body = await requestJson(
      PLAYLIST_ITEMS_PATH,
      {
        part: 'snippet,contentDetails',
        playlistId,
        maxResults: String(YOUTUBE_PAGE_SIZE),
        // ⚠️ 首轮（`cursor === null`）不许送一个空的 `pageToken` —— 空串是一个**值**，
        //    上游对它的处置没有文档保证（bilibili 那边为此专门写了 `cursor ?? '1'`）。
        ...(cursor === null ? {} : { pageToken: cursor }),
      },
      'playlistItems.list',
    );

    const items = requireArray(body, 'playlistItems.list', 'items');
    const rows = items.map((raw, index) => toPlaylistRow(raw, index));
    const details = await fetchVideoDetails(rows.map((row) => row.externalId));

    const videos: FetchedVideo[] = rows.map((row) => {
      const detail = details.get(row.externalId) ?? null;
      return {
        externalId: row.externalId,
        title: row.title,
        thumbnailUrl: row.thumbnailUrl,
        publishedAt: row.publishedAt,
        // ★ 走 Task 2 那个纯函数（`PT1H2M3S` → 3723，`PT0S` → null），不自己解析。
        durationSec: detail === null ? null : parseYouTubeDuration(detail.duration),
        viewCount: detail?.viewCount ?? null,
        commentCount: detail?.commentCount ?? null,
        /*
         * ⚠️ 判不出时是 `false`（契约是 `boolean`，没有第三态）。代价：详情没拿到的那一支
         *    不会被打上 `liveReplay`，而那正是它该有的样子（我们确实不知道）。
         */
        isLiveReplay: detail?.isLiveReplay ?? false,
      };
    });

    /*
     * ★★ §5.4 逐字：**`nextPageToken` 缺失即到底**（"这个接口的语义是可靠的"）。
     *    · 这里**不**看"这一页是不是空的"：空页 + 有 token 的事实在这个接口上是可能的，
     *      而"空 ⇒ 到底"会让那一次静默少存（bilibili 那个坑的同一形状，只是成因不同）；
     *    · 也**不**看我们库里存了多少条（那是 bilibili 的判据，两个平台的语义不许写成一个）。
     */
    const nextPageToken = asNonEmptyString(asRecord(body)?.nextPageToken);
    const reachedEnd = nextPageToken === null;

    return { videos, nextCursor: reachedEnd ? null : nextPageToken, reachedEnd };
  }

  return { resolveCreator, fetchPage };
}
