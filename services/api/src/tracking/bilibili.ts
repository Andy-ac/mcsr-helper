/**
 * bilibili 适配器 —— 三个平台里**唯一不需要任何凭据**的那个（spec §2.7），
 * 所以它先跑通整条流水线。
 *
 * ===========================================================================
 * ★★ 这个文件要防的东西：`code=0` 但列表为空，而频道**还有**数据
 * ===========================================================================
 * 实测（spec §2.4）：同一个 UP 连翻 6 页 —— pn=1/2 各 50 条，pn=3/4 回 `-412`，
 * **pn=5/6 回 `code=0` 且 `vlist=[]`** —— 而这个 UP **有 124 条**。
 * 没有异常、没有非 200、没有非零 code。天真的实现把 pn=5 读成"到底了"，
 * 于是**只存了 100 条**，而**所有错误处理都不会响**。
 *
 * ⇒ 判据（spec §5.4 逐字）：`vlist.length < ps` **且** 已存条数 >= `page.count`。
 *   它被单独抽成 `bilibiliReachedEnd()` 导出，因为**它是这个文件里最值得单测的一行**：
 *   写错了没有任何东西会报错，只会少一批视频，而"少了一批"在界面上看起来
 *   和"这个 UP 就这么多"完全一样。
 * ⇒ 代价（认下且写清楚）：每翻完一个"看起来到底"的页，还要**多发一次请求**去确认
 *   （那个空页才是"真的到底"的信号）。一个 124 条投稿的 UP 是 4 个请求而不是 3 个 ——
 *   换的是"绝不静默少存"。这是本仓一以贯之的那一侧（`parse.ts` 文件头写着同一条）。
 *
 * ===========================================================================
 * ★ 两种拒绝不是一回事：`200 + code:-352` 与 `412`（spec §2.3）
 * ===========================================================================
 * · `HTTP 412`（`request was banned`）与 body 里 `code: -412` —— **限流/风控**，
 *   实测"等 10 秒就能恢复"（2s ❌ / 5s ❌ / 10s ✅），⇒ **等 10 秒重试，最多 3 次**。
 * · `200 + code: -352`（`风控校验失败`，还会回一张 `v_voucher` 挑战票）——
 *   这是**另一种**拒绝：它的成因是请求里缺了风控要的参数（`dm_img_*`，见下），
 *   **等 10 秒不会把它等好**。⇒ 立刻抛，不重试。
 * ⇒ 后果就是本文件必须**读 body 的 `code`**：只看 HTTP 状态码的检查**抓不到** `-352`
 *   （它是 200），于是那一路会被当成"这页就是空的"——又回到上面那个静默丢数据的坑。
 *
 * ===========================================================================
 * ★ `dm_img_*` 三个参数必须是"空"值，而且**必须在签名里**
 * ===========================================================================
 * 实测三组对照（spec §2.1）：
 *   不传              → ❌ `200 code=-352`
 *   **传空的**        → ✅ `200 code=0`，`vlist` 有数据
 *   传**编造的非空**指纹 → ❌ `HTTP 412` —— **比不传更糟**
 * ⇒ 三个空值逐字照抄，一个字都别改（`[]` / `V2ViR0wgMS` / `{"ds":[],"wh":[0,0,0],"of":[0,0,0]}`）。
 *
 * ⚠️ 它们在**签名里面**（和 mid/ps/pn 一起排序、一起算 `w_rid`）。依据是本仓做出那张
 *    对照表的那个探针（`.cache/bilibili-feasibility2.mjs:79`：`sign({…, ...dm})`，
 *    `dm_img_*` 是展开进参数对象**再**签名的），yt-dlp 合并到主干的
 *    "无登录抓 UP 空间"实现也是同一个形状（它的 `query` 字典里带 `dm_img_*`，整份送签名）。
 *    ⚠️ 代价写清楚：这一条**离线验不了**。真跑起来要是**每一页**都回 `-352`，
 *       第一个要试的就是"把这三个参数挪到签名之外"（改一行；测试钉着签名串，
 *       所以那次改动会是一条会红的断言，不是一次静默偏移）。
 *
 * ⚠️ 请求头（UA / referer / accept）也不在 spec §2.1 那五步的散文里，但**做出那张
 *    对照表的探针带了它们**（`.cache/bilibili-feasibility2.mjs:14-15`），
 *    外部的实践文章也一致要求"真 Chrome UA + Referer"。Node 的 `fetch` 默认发
 *    `User-Agent: node`——那是一个明显的机器人信号。⇒ 照那个探针逐字带上。
 *    不带的代价是不可知的：`-352`/`412` 都是**概率性**的，缺了它可能只是把成功率
 *    压低一截，而日志里看不出任何区别。
 *
 * ===========================================================================
 * ★ 「加一个博主」也要打上游：一次握手 + 一个 `ps=1` 的 `arc/search`（spec §5.1 裁决）
 * ===========================================================================
 * `displayName` 不许是 `mid <id>` 占位（2026-09-16 由 T3 评审提出、规格裁定）。
 * 真名在 `arc/search` 的 `vlist[].author` 里 —— 正是**这个适配器已经在打的**那个接口，
 * 所以取名字这条路的成本是"每加一个博主多一个请求"（一次性，**不是**每轮同步），
 * 换来管理面板里是一个名字。名字只在 `resolveCreator` 那条路上取，`fetchPage` 一个
 * 请求都没多，`FetchedVideo` / `FetchPage` / `CreatorRef` 三个接口**一个字都没改**
 * （它们按 spec §5 逐字冻结）。细节与代价见 `lookupDisplayName`。
 *
 * ===========================================================================
 * 依赖注入：`fetchImpl` 与 `sleep`
 * ===========================================================================
 * 测试**绝不打真网络**（本仓每一套测试都是离线的；一个"悄悄开始打 bilibili"的测试
 * 比没有测试更糟）。`sleep` 也必须能注入，否则那三条 10 秒退避会让测试真等 30 秒。
 *
 * ⚠️ 会话（cookie + mixinKey）**在适配器实例里缓存**，不是模块级：
 *    · spec §5.1 要的是"每个进程只握一次手"——CLI 一次运行建一个实例，正好对上；
 *    · 模块级缓存会让**第二个测试**拿到第一个测试的会话，于是假 `fetch` 收不到
 *      nav 请求 —— 那是"测试之间互相影响"，而它表现为"某些用例单独跑就绿"。
 *    · 缓存的是 **Promise 而不是结果**：并发的第一个请求不会各握一次手。
 */
import { createHash } from 'node:crypto';

import type { TrackedCreator } from '@mcsr/shared';

import { parseBilibiliLength } from './parse';
import {
  type CreatorRef,
  type FetchedVideo,
  type FetchPage,
  InvalidCreatorInputError,
  type PlatformAdapter,
  PlatformHandshakeError,
} from './types';

// ---------------------------------------------------------------------------
// 常量（照 `parse.ts` 的排法：先看见规则，再看见用它的人）
// ---------------------------------------------------------------------------

const API_BASE = 'https://api.bilibili.com';
const FINGER_SPI_PATH = '/x/frontend/finger/spi';
const NAV_PATH = '/x/web-interface/nav';
const ARC_SEARCH_PATH = '/x/space/wbi/arc/search';

/** 每页条数。spec §10 冻结表：`ps=50`（实测 ps=5/30/50 → 5/30/**50**，这就是上限）。 */
export const BILIBILI_PAGE_SIZE = 50;

/**
 * ★ 取 UP 主真名那一次 `arc/search` 的 `ps` —— spec §5.1 的裁决逐字写的是 `ps=1`
 * （2026-09-16 由 T3 评审提出、规格裁定；理由见 `lookupDisplayName`）。
 *
 * 1 与 50 在这一步没有任何区别：要的只是 `vlist[0].author`，多要 49 条只会把这一次请求
 * 变大（`ps` 进签名，也进风控的账），而名字就在第一条里。
 *
 * ⚠️ 残余风险：spec §10 那张冻结表里**实测过**的 `ps` 只有 5/30/50，`ps=1` 是这条裁决
 *    新引入的一格，本机（离线、不打真网络）无从验证。它要是被上游当脏值挡掉，
 *    表现是"加博主"这一步失败（响亮、可重试），而**不是**面板上悄悄出现一串数字。
 */
const AUTHOR_LOOKUP_PAGE_SIZE = 1;

/** `-412` 之后等多久。spec §2.3 实测：等 2s ❌ / 5s ❌ / **10s ✅**。 */
const RATE_LIMIT_SLEEP_MS = 10_000;

/**
 * `-412` 之后**重试**几次（不含第一次请求）。
 *
 * ⚠️ 这个数字有两种读法，这里选了跟任务书一致的那一种、并把另一种记下来：
 *    · 任务书写的是"`sleep(10000)` 重试，**最多 3 次**" ⇒ 首发 + 3 次重试 = 最多 4 个请求；
 *    · 而做出 spec §2.3 那组数字的探针是 `for (let a = 0; a < 3 && !got; a++)`
 *      （`.cache/bilibili-feasibility5.mjs:79`）⇒ 最多 **3 个请求**。
 *    ⇒ 差一个请求、最多 10 秒。取"多一次"是因为这一侧的代价只有时间，
 *      而另一侧（少一次）的代价是**这个频道这一轮白跑**；测试把 4 个请求 / 3 次 10 秒
 *      钉住了，所以改主意会是一次会红的改动。
 */
const MAX_RATE_LIMIT_RETRIES = 3;

/** 单次请求的超时。照探针的 20 秒（`.cache/bilibili-feasibility2.mjs:22`）。 */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * ★ 风控参数（spec §2.1 第 ④ 步）—— **空**才是对的，一个字都别改。
 *
 * `dm_img_str` 那串是 `"WebGL 1"` 的 base64。⚠️ 编造一组"看起来更像真的"指纹
 * （比如带上真实的屏幕尺寸）实测是 `HTTP 412`，**比不传还糟**（spec §2.1 的对照表）。
 * 所以这里没有"更真实"的余地：这三个值就是那三个字符串。
 */
const DM_IMG_LIST = '[]';
const DM_IMG_STR = 'V2ViR0wgMS';
const DM_IMG_INTER = '{"ds":[],"wh":[0,0,0],"of":[0,0,0]}';

/** 列表请求里那几个固定参数（spec §2.1 第 ⑤ 步逐字）。 */
const ARC_SEARCH_ORDER = 'pubdate';
const ARC_SEARCH_PLATFORM = 'web';
const ARC_SEARCH_WEB_LOCATION = '1550101';

/**
 * 请求头。**不在** spec §2.1 的散文里，但做出那张对照表的探针带了它们
 * （`.cache/bilibili-feasibility2.mjs:14-15` 逐字），理由见文件头。
 */
const BROWSER_HEADERS: Record<string, string> = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  referer: 'https://www.bilibili.com/',
  origin: 'https://www.bilibili.com',
  accept: 'application/json, text/plain, */*',
};

/** WBI 密钥拼起来必须是 64 个字符（spec §2.1 第 ② 步）。 */
const MIXIN_KEY_SOURCE_LENGTH = 64;
/** mixinKey 取重排后的**前 32 位**（spec §2.1 逐字）。 */
const MIXIN_KEY_LENGTH = 32;

/**
 * ★ mixinKey 的 **64 位重排表** —— 逐字抄 `docs/video-tracking-spec.md` §2.1
 * （"写错一位就全废"）。
 *
 * ⚠️ **为什么把它导出**：`slice(0, 32)` 意味着只有**前 32 个数字**会影响签名 ——
 *    后半段抄错一位，行为上**完全看不出来**，而它已经不是 spec 里那张表了。
 *    ⇒ 测试逐值钉住这 64 个数字（外加"它是 0–63 的一个排列"），
 *      这样"抄错一位"变成一次会红的断言。这条不是洁癖：这张表是本文件唯一一处
 *      **手抄的常量**，也是唯一一处错了之后"能跑、能返回、全是错数据"的地方。
 */
export const BILIBILI_MIXIN_KEY_TABLE: readonly number[] = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28,
  14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54,
  21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

// ---------------------------------------------------------------------------
// 错误：为什么"限流"与"被拒"必须是两个类型
// ---------------------------------------------------------------------------

/**
 * `-412` / `HTTP 412`，而且**重试预算已经用完**。可以下一轮再来。
 *
 * ⚠️ 与 `BilibiliRejectedError` 分开，是因为 CLI 对它们的处置**不一样**：
 *    限流是"过一会儿再来"（游标停在原地，下一轮从同一页继续），而被拒/形状变了是
 *    "这一轮这个频道没戏"。混成一个类型之后，日志里"这轮被限流了 20 次"与
 *    "接口改了"长得一模一样 —— 而后者要人去看。
 */
export class BilibiliRateLimitError extends Error {
  /** 给 CLI 一个机器可读的信号（"可以重试"，与另外两种失败不同）。 */
  readonly retryable = true;
  /** 重试了几次之后才放弃的（日志里能看出是不是刚好撞满预算）。 */
  readonly retries: number;

  constructor(detail: string, retries: number) {
    super(`bilibili: 被限流/风控拒绝，重试 ${retries} 次仍失败：${detail}`);
    this.name = 'BilibiliRateLimitError';
    this.retries = retries;
  }
}

/**
 * 这次抓取**被拒了**，而且**重试没有意义**。三个来源，同一种处置（这一轮放弃这个创作者，
 * 换下一个）：
 *   1. body 里 `code: -352`（风控校验失败）——等 10 秒**不会**把它等好，
 *      修它的是那三个空的 `dm_img_*`（spec §2.1），也就是说那是**代码**的事；
 *   2. 别的非零 `code`（比如 UP 不存在时的 `-404`）与非 412 的非 200；
 *   3. 响应不是 JSON（风控拦下来时 bilibili 会回**一整页 HTML**，实测见
 *      `docs/platform-tracking-feasibility.md:203`），以及**我们**拒了这份数据
 *      （`data.page.count` 缺失、条目形状变了、游标不是页码）。
 * ⚠️ 第 3 类与另外两类合并是**故意的**：它们对调用方是同一件事 ——
 *    "这一轮别指望这个频道了，去看日志"。差别留在 `code` 与 message 里。
 */
export class BilibiliRejectedError extends Error {
  /** 与 `BilibiliRateLimitError` 相对：这个**不要**重试。 */
  readonly retryable = false;
  /** 上游的 `code`，或者 `null`（HTTP 层/形状层的失败没有 code）。 */
  readonly code: number | null;

  constructor(detail: string, code: number | null) {
    super(`bilibili: ${detail}`);
    this.name = 'BilibiliRejectedError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// 三个纯函数（本文件里唯一能离线逐值钉住的部分）
// ---------------------------------------------------------------------------

/**
 * `img_url` / `sub_url` → mixinKey（spec §2.1 第 ② 步）。
 *
 * 各取**文件名去扩展名**，拼成 64 字符，按表重排，取**前 32 位**。
 *
 * ⚠️ `slice(0, 32)` 是 spec 逐字写的，也是公开实现里一致的那一版
 *    （`reduce(lambda s, i: s + orig[i], tab, '')[:32]`）。
 *    ⚠️ 本仓上一轮那个探针**没有** slice（`docs/platform-api-feasibility-notes.md:773` 记的
 *       那个 `w_rid=6465d4b8…`，用它抄下来的 64 字符整串才算得出来），
 *       所以**那一行观测值不能拿来当测试向量** —— 它抄的是探针自己的实现，
 *       而那个探针的请求当时回的是 412。这里以 spec 为准（spec 与实测冲突时以 spec 为准）。
 * ⚠️ 拼不出 64 个字符时**抛**而不是硬算：表的下标会指到 `undefined`，
 *    拼出来的 mixinKey 里会出现 `"undefined"` 这九个字符 —— 每一个签名都错，
 *    而服务端只会回一个 `-352`（和"缺 dm_img"长得一样），排查会从风控查起。
 */
export function deriveMixinKey(imgUrl: string, subUrl: string): string {
  const orig = `${fileNameWithoutExtension(imgUrl)}${fileNameWithoutExtension(subUrl)}`;
  if (orig.length !== MIXIN_KEY_SOURCE_LENGTH) {
    throw new PlatformHandshakeError(
      'bilibili',
      'nav',
      `WBI 密钥拼起来是 ${orig.length} 个字符，不是 ${MIXIN_KEY_SOURCE_LENGTH}（img_url / sub_url 的形状变了？）`,
    );
  }
  return BILIBILI_MIXIN_KEY_TABLE.map((index) => orig[index])
    .join('')
    .slice(0, MIXIN_KEY_LENGTH);
}

/** `https://i0.hdslb.com/bfs/wbi/<key>.png?x=1` → `<key>`。 */
function fileNameWithoutExtension(url: string): string {
  const withoutQuery = url.split('?')[0]?.split('#')[0] ?? '';
  const last = withoutQuery.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  return dot > 0 ? last.slice(0, dot) : last;
}

/**
 * WBI 签名（spec §2.1 第 ③ 步）—— **顺序就是规则**，写反一处全废。
 *
 * 逐字照 spec：`params + wts` ⇒ 键**字典序**排 ⇒ 值去掉 `!'()*` ⇒ URL 编码 ⇒
 * `w_rid = md5(query + mixinKey)`。
 *
 * ⚠️ 排序排的是**键**，不是"键=值"这种整串。两种做法在**真实参数集**上恰好给出同一个
 *    顺序（mid / ps / pn / order / platform / web_location / wts / dm_img_* 里没有谁是谁的
 *    前缀），所以只喂真实参数是**分不出来的** —— 测试里专门为此放了一组"一个键是另一个键
 *    的前缀"的参数，否则"把值编码放在排序之前"这个 mutation 会**绿着过去**。
 * ⚠️ 值里的 `!'()*` 先删再编码（顺序反了就会多出 `%21` 之类的转义，签名与上游算的不一样）。
 * ⚠️ `encodeURIComponent` 而不是"空格变 `+`"那种表单编码：bilibili 的前端是 JS 在算这个
 *    签名，公开实现里也是 `urlencode` 之外一律用 JS 的 `encodeURIComponent`。
 *    代价：真出现带空格的值时两种编码算出的 `w_rid` 不同；本适配器的参数全是数字、
 *    字母和那三段固定的 JSON，走不到那条路。
 */
export function signWbiQuery(
  params: Record<string, string | number>,
  mixinKey: string,
): { query: string; wRid: string } {
  const sorted = Object.entries(params).sort(([left], [right]) => byCodePoint(left, right));
  const query = sorted
    .map(([key, value]) => {
      const escaped = String(value).replace(/[!'()*]/g, '');
      return `${encodeURIComponent(key)}=${encodeURIComponent(escaped)}`;
    })
    .join('&');
  const wRid = createHash('md5').update(`${query}${mixinKey}`).digest('hex');
  return { query, wRid };
}

/**
 * 按**码点**比较，不用 `localeCompare`。
 *
 * `localeCompare` 是按语言的排序规则比（会忽略标点、把 `a-b` 与 `ab` 排到相邻），
 * 而上游算签名用的是"字典序" —— 两者在带 `-`/`_`/`.` 的键上给出不同顺序，
 * 于是我们会算出一个**没人认的** `w_rid`，且没有任何异常可抓（服务端只会回 `-352`）。
 */
function byCodePoint(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * ★★ bilibili 的"到底了"判据（spec §5.4 逐字）—— **本文件里最值得单测的一行**。
 *
 * `returned < pageSize` **且** `storedTotal >= pageCount`。
 *
 * 两个条件缺一不可，各自挡一种错：
 *   · 只看"返回不足一页" ⇒ 会把 §2.4 那个"`code=0` 但空列表"读成到底，
 *     **静默少存**（实测少存了 24 条，没有任何东西报错）；
 *   · 只看"已存够了" ⇒ 上游 `count` 比实际多（或我们存了别的来源的同名视频）时
 *     会在第二页就停，同样少存。
 *
 * ⚠️ 于是"不满足"只说明**现在还不能认定到底**，不说明到底了 —— 调用方（CLI）
 *    对它的处置是"**游标停在原地**，下一轮从同一页继续"（spec §5.1），
 *    而不是"往后翻一页"。实测那个空页连着出现两次（pn=5 与 pn=6 都空），
 *    往后翻只会连着拿到更多空页，并且**把中间那两页真的数据永久跳过**。
 */
export function bilibiliReachedEnd(input: {
  /** 上游给的 `data.page.count`（这个 UP 的总投稿数）。 */
  pageCount: number;
  /** 本页实际返回条数（`vlist.length`）。 */
  returned: number;
  /** `ps`。 */
  pageSize: number;
  /** 我们库里这个 creator 已有的条数（由调用方传进来，适配器不该知道数据库）。 */
  storedTotal: number;
}): boolean {
  return input.returned < input.pageSize && input.storedTotal >= input.pageCount;
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

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------
// 适配器
// ---------------------------------------------------------------------------

/** 纯数字的 mid（spec §5.1 接受的三种输入之一）。 */
const MID_INPUT = /^\d{1,20}$/;
/** `space.bilibili.com/<mid>`（允许 `www.` 前缀、允许后面跟 `/video` 与查询串）。 */
const SPACE_URL = /(?:^|\.)space\.bilibili\.com\/(\d{1,20})(?:\/|$|\?|#)/i;
/** `b23.tv/<code>` 短链。 */
const B23_URL = /(?:^|\.)b23\.tv\/[A-Za-z0-9]+/i;
/** 页游标：1 起、最多 6 位（`pn=999999` 已经是 5000 万条视频，再高是脏数据）。 */
const PAGE_CURSOR = /^[1-9]\d{0,5}$/;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** 握手换来的两样东西：cookie 与 mixinKey。都是一次运行内不变的东西。 */
interface BilibiliSession {
  cookie: string;
  mixinKey: string;
}

export interface BilibiliAdapterDeps {
  /** 注入假实现，测试里**绝不打真网络**。 */
  fetchImpl?: typeof fetch;
  /** 注入假实现，否则那三条 10 秒退避会让测试真等 30 秒。 */
  sleep?: (ms: number) => Promise<void>;
}

export function createBilibiliAdapter(deps: BilibiliAdapterDeps = {}): PlatformAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;

  /*
   * 会话缓存。⚠️ 存的是 **Promise**，不是结果：`fetchPage` 是被顺序调用的，
   * 但"第一个请求在路上、第二个请求也来了"是完全可能的（CLI 以后若并行抓两个频道），
   * 而 `if (session) return session` 那种写法会让他们**各握一次手**（多两个请求，
   * 而握手请求本身也在风控的账上）。
   * ⚠️ 失败**也**缓存：一次运行只握一次手是 spec §5.1 的要求，握不上就这一轮别碰 bilibili。
   * 不清空它的代价是"上游抽一下，这一轮整个平台不动"（等下一个 10 分钟）；
   * 清空它的代价是**每个 creator 各再握一次手** —— 3 个请求 × 20 个 creator 打在
   * 一个正在抽风/正在风控我们的上游上。取前者。
   */
  let sessionPromise: Promise<BilibiliSession> | null = null;

  const session = (): Promise<BilibiliSession> => {
    sessionPromise ??= handshake();
    return sessionPromise;
  };

  /**
   * 握手（spec §2.1 第 ①② 步，spec §5.1："每个进程一次"）。
   *
   * ⚠️ 任何一步失败都变成 `PlatformHandshakeError`（spec §5.1："握手失败要当作
   * '本轮放弃 bilibili'，**不能带着空 cookie 继续打**（那会白吃一堆 412）"）。
   * 包一层而不是直接往上抛的理由：调用方（CLI）要能**只凭类型**决定"放弃整个平台"，
   * 而不是去猜一句 message。
   */
  async function handshake(): Promise<BilibiliSession> {
    const spi = await handshakeStep('finger/spi', () => requestJson(FINGER_SPI_PATH, '', ''));
    const spiData = asRecord(asRecord(spi)?.data);
    const b3 = asString(spiData?.b_3);
    const b4 = asString(spiData?.b_4);
    if (!b3 || !b4) {
      throw new PlatformHandshakeError(
        'bilibili',
        'finger/spi',
        'data.b_3 / data.b_4 不是非空字符串（拿不到 buvid3/buvid4）',
      );
    }

    // `b_nut` 是"第一次访问的时间"，照探针写成当前的 Unix 秒。
    const cookie = `buvid3=${b3}; buvid4=${b4}; b_nut=${Math.floor(Date.now() / 1000)}`;

    const nav = await handshakeStep('nav', () => requestJson(NAV_PATH, '', cookie));
    /*
     * ⚠️★ 这里**不能**要求 `code === 0`：实测（`docs/platform-api-feasibility-notes.md:704`）
     * 未登录时 nav 回的是 `{"code":-101,"message":"账号未登录"}`，而**WBI 密钥照样在里面**。
     * 要求 code===0 的写法会让匿名抓取永远握不上手 —— 而"匿名可用"正是 bilibili
     * 先跑通整条流水线的原因（spec §2.7）。
     * ⇒ 判据是"密钥在不在"，不是"code 是不是 0"。
     */
    const wbiImg = asRecord(asRecord(asRecord(nav)?.data)?.wbi_img);
    const imgUrl = asString(wbiImg?.img_url);
    const subUrl = asString(wbiImg?.sub_url);
    if (!imgUrl || !subUrl) {
      throw new PlatformHandshakeError(
        'bilibili',
        'nav',
        'data.wbi_img.img_url / sub_url 不是非空字符串（拿不到 WBI 密钥）',
      );
    }

    return { cookie, mixinKey: deriveMixinKey(imgUrl, subUrl) };
  }

  /** 握手的一步：把这一层的任何失败都收成一个 `PlatformHandshakeError`（保留原文当 `cause`）。 */
  async function handshakeStep<T>(step: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof PlatformHandshakeError) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new PlatformHandshakeError('bilibili', step, detail, { cause: error });
    }
  }

  /**
   * 发一个 GET 并读出 JSON —— **限流与风控只在这一个地方判**（spec §2.3）。
   *
   * ⚠️ 判据有**四条**，缺一条就漏一种失败（顺序即优先级）：
   *   1. `HTTP 412` → 限流：等 10 秒重试；
   *   2. body 里 `code: -412` → 同一种限流（它是 200，只看状态码看不见）；
   *   3. body 里 `code: -352` → **风控校验失败，不重试**（等 10 秒等不好它）；
   *   4. 不是 JSON → **不重试**：实测风控拦下来时会回**一整页 HTML**
   *      （`docs/platform-tracking-feasibility.md:203`），把它当"空列表"读就又是那个坑。
   * ⚠️ 除了这三种，别的非零 `code` **不在这里判** —— 因为 `nav` 的 `-101 账号未登录`
   *    是**正常**的（见握手那段），"code 必须为 0"这条规则属于列表接口自己。
   */
  async function requestJson(path: string, query: string, cookie: string): Promise<unknown> {
    const url = query ? `${API_BASE}${path}?${query}` : `${API_BASE}${path}`;
    let retries = 0;

    for (;;) {
      const response = await fetchImpl(url, {
        headers: cookie ? { ...BROWSER_HEADERS, cookie } : { ...BROWSER_HEADERS },
        /*
         * ⚠️ `follow` 是默认值，这里写出来是因为 `resolveCreator` 依赖它：
         * b23.tv 短链必须跟到最终 URL 才能抠出 mid（spec §5.1）。
         */
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.status === 412) {
        await waitBeforeRetry(
          `HTTP 412 request was banned`,
          () => retries,
          (next) => {
            retries = next;
          },
        );
        continue;
      }
      if (!response.ok) {
        throw new BilibiliRejectedError(
          `HTTP ${response.status}（不是 412，也不成功），响应开头：${(await safeText(response)).slice(0, 200)}`,
          null,
        );
      }

      const text = await safeText(response);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new BilibiliRejectedError(
          `响应不是 JSON（很可能是风控拦下来的 HTML 页），响应开头：${text.slice(0, 200)}`,
          null,
        );
      }

      const envelope = asRecord(body);
      const code = asNumber(envelope?.code);

      if (code === -412) {
        await waitBeforeRetry(
          'code=-412',
          () => retries,
          (next) => {
            retries = next;
          },
        );
        continue;
      }
      if (code === -352) {
        /*
         * ★ 与 `-412` **分开**：`-352 风控校验失败`是"请求里缺了风控要的东西"，
         * 修它的是那三个空的 `dm_img_*`（`[]` / `V2ViR0wgMS` / 那个空形状），
         * 不是等 10 秒。实测里它还附一张 `v_voucher` 挑战票。
         * ⇒ 直接抛，`retryable = false`。
         */
        throw new BilibiliRejectedError(
          `code=-352 风控校验失败（不重试：等 10 秒不会修好它；修它的是空的 dm_img_* 那三个参数），message=${asString(envelope?.message) ?? '(无)'}`,
          -352,
        );
      }

      return body;
    }
  }

  /**
   * 等 10 秒再试一次，或者用完预算就抛。
   *
   * ⚠️ 单独一个函数是为了让"重试"与"还有没有预算"这两件事只有一处：
   *    写在两个分支里（HTTP 412 与 code -412）就会出现"只改了一处"的版本，
   *    而那一处的表现是**某一种限流永远不重试**——日志里看不出来（都只是"失败了"）。
   */
  async function waitBeforeRetry(
    detail: string,
    readRetries: () => number,
    writeRetries: (next: number) => void,
  ): Promise<void> {
    const used = readRetries();
    if (used >= MAX_RATE_LIMIT_RETRIES) {
      throw new BilibiliRateLimitError(`${detail}（重试预算用尽）`, used);
    }
    writeRetries(used + 1);
    await sleep(RATE_LIMIT_SLEEP_MS);
  }

  /**
   * 一次 `arc/search` 的**完整签名 query** —— 列表页与"加博主时取名字"那一次**共用这一个**。
   *
   * ⚠️ 单独抽出来，是因为 spec §5.1 的裁决要求的是"**多发一次请求**"，不是"再写一个
   *    请求构造器"：`dm_img_*` 三个空值、`order`/`platform`/`web_location` 那三个固定参数、
   *    以及"参数全在签名里面"这条属性（本文件头有依据），两份拷贝会出现
   *    "只改了一处"的版本 —— 而那一处的表现是**某一类请求永远回 `-352`**，
   *    看起来和"上游今天风控严"一模一样。
   */
  function arcSearchSignedQuery(
    mid: string,
    pageSize: number,
    page: number,
    mixinKey: string,
  ): { query: string; wRid: string } {
    /*
     * ⚠️ 参数顺序无所谓（下面要排序），但**放进来的键决定了签名**：
     *    `dm_img_*` 三个必须在这份参数**里面**（依据见文件头），
     *    `wts` 也在里面（spec §2.1 第 ③ 步："params + wts"）。
     */
    return signWbiQuery(
      {
        mid,
        ps: pageSize,
        pn: page,
        order: ARC_SEARCH_ORDER,
        platform: ARC_SEARCH_PLATFORM,
        web_location: ARC_SEARCH_WEB_LOCATION,
        dm_img_list: DM_IMG_LIST,
        dm_img_str: DM_IMG_STR,
        dm_img_inter: DM_IMG_INTER,
        wts: Math.floor(Date.now() / 1000),
      },
      mixinKey,
    );
  }

  /**
   * ★ 取 UP 主真名：握手之后**多发一个 `ps=1` 的 `arc/search`**，读 `data.list.vlist[0].author`。
   * 拿不到就回 `null`（调用方回落到 `mid <id>` 占位）。
   *
   * —— spec §5.1 的裁决（2026-09-16，T3 评审提出、规格裁定，原文见那里）：
   *    `x/space/wbi/acc/info`（拿昵称/头像那个接口）实测回 `-352`，所以"官方的"那条路是堵的；
   *    但 **`arc/search` 的每一条 `vlist` 里都带 `author`**（spec §2.1 的字段清单里就有），
   *    而 `arc/search` 正是这个适配器**已经在打**的那个接口。⇒ 名字从这条已有的路上顺带取。
   *    代价（写在这条裁决的明面上）：**每加一个博主多一次上游请求** ——
   *    一次性，不是每轮同步（`resolveCreator` 只在管理面板"加博主"那条路上被调用）。
   *    这就是它值的原因：换来的是管理面板里列出来的是**名字**，而不是一串 mid。
   *
   * ⇒ 为什么**不**改 `FetchedVideo`：它按 spec §5 逐字冻结（评审逐字核过），本来就没有
   *    `author` 字段；名字是在 `resolveCreator` 这条路上单独拿的，`fetchPage` 与它无关。
   *    所以 `fetchPage` 那条路**一个请求都没多**。
   *
   * ⚠️ 失败分类与文件里别处**完全一样**（这里不自己判，全部走 `requestJson`）：
   *    · `-412` ⇒ 等 10 秒重试，最多 3 次，耗尽抛 `BilibiliRateLimitError`；
   *    · `-352` ⇒ 立刻抛，**一次都不重试**；
   *    · 握手失败 ⇒ `PlatformHandshakeError`（连一个列表请求都不发）。
   *    ⇒ 于是**它是会抛的**：一次取名字失败 = "这一次加博主失败"，而**不是**静默把
   *      `mid <id>` 放进管理面板。宁可抛也不回落到占位，因为占位恰恰是那条裁决判定
   *      "必须修"的东西：一次明明白白的失败，管理员看得见、也可以立刻重试；
   *      而"面板上看起来像名字的一串数字"没有任何东西会提醒任何人去看。
   *
   * ⚠️ 残余风险（写下来，别当它已经关死）：`data.list.vlist` **不是数组**时这里**抛**
   *    （本文件的纪律：形状变了要响亮，`fetchPage` 对同一个字段也是这么办的 —— 见那里
   *    的 `data.list.vlist 不是数组` 分支）。代价是"一个投稿都没有、且上游连 `list` 都
   *    不发"的新 UP 会**加不进来**（而不是回落到占位）—— 那种情况第一次真跑就会看见，
   *    修它是一行（把这一分支并进下面的 `null`）。取另一侧（并进 `null`）的代价是
   *    "上游改了形状"与"这个 UP 没有投稿"从此**分不开**，而两者要做的处置不一样。
   */
  async function lookupDisplayName(mid: string): Promise<string | null> {
    const { cookie, mixinKey } = await session();
    const { query, wRid } = arcSearchSignedQuery(mid, AUTHOR_LOOKUP_PAGE_SIZE, 1, mixinKey);
    const body = await requestJson(ARC_SEARCH_PATH, `${query}&w_rid=${wRid}`, cookie);

    const envelope = asRecord(body);
    const code = asNumber(envelope?.code);
    if (code !== 0) {
      /*
       * ⚠️ 非零 code 照抛，**不**回落到占位。典型的是 `-404 啥都木有`：那不是"名字没拿到"，
       *    而是"这个 mid 在 bilibili 那边不存在"。回落到占位就等于让一次**打错字的输入**
       *    成功加进来一个空博主 —— 而它从第一轮同步起每一轮都会失败，
       *    还要人去管理面板里对着一串数字猜是哪儿错了。
       */
      throw new BilibiliRejectedError(
        `arc/search（取名字，ps=1）回 code=${code ?? '(没有 code)'} message=${asString(envelope?.message) ?? '(无)'}`,
        code,
      );
    }

    const vlist = asRecord(asRecord(envelope?.data)?.list)?.vlist;
    if (!Array.isArray(vlist)) {
      throw new BilibiliRejectedError(
        'data.list.vlist 不是数组（上游的字段形状变了）—— 分不清"没有投稿"与"形状变了"，猜一边就会静默把占位放进管理面板',
        null,
      );
    }

    /*
     * 「没有投稿」（空 `vlist`）与「`author` 缺失 / 空串 / 全空白」都在这里变成 `null`
     * ⇒ 调用方回落到 `mid <id>` 占位（spec §5.1 的裁决逐字列的三个回落条件）。
     * ⚠️ `trim()` 之后才判空：`author: '  '` 是一个**看起来有名字其实没有**的值，
     *    原样存进 `display_name` 的话，管理面板上那一格会是**空白**——
     *    既不是名字，也看不出是占位。
     */
    const author = asString(asRecord(vlist[0])?.author)?.trim();
    return author ? author : null;
  }

  async function resolveCreator(rawInput: string): Promise<CreatorRef> {
    const input = rawInput.trim();
    if (!input) {
      throw new InvalidCreatorInputError('bilibili', rawInput, '是空字符串');
    }

    const mid = MID_INPUT.test(input) ? input : await midFromInput(input);

    /*
     * ★ 名字：握手 + 一个 `ps=1` 的 `arc/search`（spec §5.1 的裁决，理由与代价见
     * `lookupDisplayName` 的注释）。拿不到才回落到 `mid <id>` 占位。
     *
     * ⚠️ 顺序是**先解析 mid，再握手取名字**，b23 那条路也一样：管理员的输入完全可能
     *    根本解析不出来（跳到视频页的短链、打错的链接），那种情况下
     *    `midFromInput` 先抛，那两次握手请求就**白打了** —— 而它们同样在风控的账上。
     *
     * ⚠️ `avatarUrl` 仍然是 `null`：能给出头像的只有 `acc/info`，而它实测回 `-352`
     *    （`docs/tracking-scale-feasibility.md:152`："同一套签名，arc/search 通而它不通
     *    —— 说明风控是**按接口**打的"）。这一次裁决只把**名字**从 `author` 里拿回来，
     *    头像没有第二个来源，所以它继续是 `null`（界面显示首字母/占位图那一路）。
     *    `handle` 填 mid：对 bilibili 来说 mid 就是那个可读标识（能直接拼进空间页 URL）。
     */
    const displayName = (await lookupDisplayName(mid)) ?? `mid ${mid}`;

    return {
      platform: 'bilibili',
      externalId: mid,
      handle: mid,
      displayName,
      avatarUrl: null,
    };
  }

  /**
   * 从链接里抠 mid。纯数字那条路不经过这里（它的 mid 就是输入本身）。
   *
   * ⚠️ 这里只有 b23 那一条会联网；「取名字」那一次请求在 `resolveCreator` 里、在这之后。
   */
  async function midFromInput(input: string): Promise<string> {
    let url: URL;
    try {
      /*
       * 先按 `URL` 解析；没有协议的（`space.bilibili.com/123`）补一个 https 再解析 ——
       * 管理员从浏览器地址栏复制出来的东西通常**没有**协议（那是地址栏的行为）。
       */
      url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
    } catch {
      throw new InvalidCreatorInputError('bilibili', input, '既不是 mid，也不是一个链接');
    }

    const direct = midInUrl(url);
    if (direct) return direct;

    if (B23_URL.test(`${url.host}${url.pathname}`)) {
      /*
       * ★ b23.tv 短链：**必须跟重定向**，再从**最终 URL** 里抠 mid（spec §5.1）。
       * ⚠️ 这一条是**解析阶段**唯一的网络请求，而它是**必需的**：短链本身不含 mid。
       *    它不需要 cookie（短链服务就是转发），所以这里**不**先握手 —— 握手要两个请求，
       *    而管理员的输入完全可能解析不出来，那两次请求就白打了（它们同样在风控的账上）。
       *    「取名字」那一次请求在这之后（`resolveCreator` 里），所以抠不出 mid 时
       *    一次上游请求都不多花。
       */
      const response = await fetchImpl(url.toString(), {
        headers: { ...BROWSER_HEADERS },
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      /*
       * ⚠️ 最终 URL 要**重新解析一遍**再抠 mid：`response.url` 是一个完整 URL
       * （`https://space.bilibili.com/123?spm_id_from=…`），而 `SPACE_URL` 认的是
       * "主机名 + 路径"那一截 —— 直接拿整串去 match，`^` 后面跟的是 `https://`，
       * 于是**明明跳到了 UP 主页也认不出来**（这条正是本文件的测试抓出来的）。
       */
      let finalUrl: URL;
      try {
        finalUrl = new URL(response.url);
      } catch {
        throw new InvalidCreatorInputError('bilibili', input, '短链没跟到（拿不到最终 URL）');
      }

      /*
       * ⚠️ 短链跳到哪儿由 bilibili 决定：它常常指向**一支视频**而不是 UP 主页，
       * 那种情况下这里抠不到 mid，于是**抛**（让管理员改用空间页链接），
       * 而不是去多发一次 `x/web-interface/view` 换 owner mid ——
       * 那是一条没实测过的路，而"没实测过就当能用"正是这份 spec 反复警告的事。
       */
      const fromFinal = midInUrl(finalUrl);
      if (fromFinal) return fromFinal;
      throw new InvalidCreatorInputError(
        'bilibili',
        input,
        `短链跳到了 ${response.url.slice(0, 120)}，那里没有 space.bilibili.com/<mid>`,
      );
    }

    throw new InvalidCreatorInputError(
      'bilibili',
      input,
      '只认 space.bilibili.com/<mid>、b23.tv 短链，或一串纯数字 mid',
    );
  }

  async function fetchPage(
    creator: TrackedCreator,
    cursor: string | null,
    ctx: { storedTotal: number },
  ): Promise<FetchPage> {
    const page = parsePageCursor(cursor);
    const { cookie, mixinKey } = await session();

    // ⚠️ 与"加博主时取名字"那一次**共用**这一个构造器（`arcSearchSignedQuery`）：见它的注释。
    const { query, wRid } = arcSearchSignedQuery(
      creator.externalId,
      BILIBILI_PAGE_SIZE,
      page,
      mixinKey,
    );

    const body = await requestJson(ARC_SEARCH_PATH, `${query}&w_rid=${wRid}`, cookie);
    const envelope = asRecord(body);
    const code = asNumber(envelope?.code);
    // 到这里 `requestJson` 已经把 -412/-352 挑出去了，剩下的非零 code 是"这个频道没戏"。
    if (code !== 0) {
      throw new BilibiliRejectedError(
        `arc/search 回 code=${code ?? '(没有 code)'} message=${asString(envelope?.message) ?? '(无)'}`,
        code,
      );
    }

    const data = asRecord(envelope?.data);
    const vlist = asRecord(data?.list)?.vlist;
    if (!Array.isArray(vlist)) {
      throw new BilibiliRejectedError(
        'data.list.vlist 不是数组（上游的字段形状变了）—— 当成空列表就会静默少存一整页',
        null,
      );
    }

    const pageCount = asNumber(asRecord(data?.page)?.count);
    if (pageCount === null) {
      /*
       * ★ 这里**抛**，不猜。`page.count` 是"到底了"判据的一半（spec §5.4），
       * 少了它只剩两种猜法，而**两种都会静默地错**：
       *   · 当作"永远没到底" ⇒ 每一轮都从同一页开始翻，回填永远不会 done（不丢数据，
       *     但每一轮都在空转，而且没人会知道原因）；
       *   · 当作 0 ⇒ 立刻满足"已存 >= 总数" ⇒ 一个"空但成功"的页就结束回填（**丢数据**，
       *     而且没有任何东西报错 —— 正是本文件要防的那个坑）。
       * ⇒ 抛出去，落进 `last_error`，人去看。
       */
      throw new BilibiliRejectedError(
        'data.page.count 不是数字（少一个判据就判不了"到底了"，猜哪一边都会静默出错）',
        null,
      );
    }

    const videos = vlist.map((item, index) => toFetchedVideo(item, index));
    const reachedEnd = bilibiliReachedEnd({
      pageCount,
      returned: videos.length,
      pageSize: BILIBILI_PAGE_SIZE,
      storedTotal: ctx.storedTotal,
    });

    /*
     * ★ 游标怎么走（spec §5.1："否则视为'被限流'，`reachedEnd = false` 并把游标停在原地"）。
     *
     * 两种"没到底"要分开，因为它们的意思完全不同：
     *   · **这一页有数据** ⇒ 正常翻页：`pn + 1`。
     *     ⚠️ 那种情况**必须**往前翻：不翻的话回填永远停在第一页（"游标停在原地"照字面
     *        用在满页上，就是分页功能直接没了）；
     *   · **这一页一条都没有** ⇒ §2.4 那个"被限流"的形状：游标**不动**。
     *     往前翻的代价是**永久跳过**这几页真数据（实测里连着两页都空），
     *     而重复抓同一页是幂等的（`UNIQUE (platform, external_id)` + upsert）。
     *     ⚠️ 调用方要注意：**这一页一条都没有时本轮应该停下这个 creator**，
     *        否则下一次请求还是同一页、还是空 —— 那是死循环，而 §3.3 的页数上限
     *        只是它的兜底。
     */
    const nextCursor = reachedEnd ? null : String(videos.length === 0 ? page : page + 1);

    return { videos, nextCursor, reachedEnd };
  }

  return { resolveCreator, fetchPage };
}

/**
 * 生产用的那个实例（注册表 `index.ts` 用它）。
 *
 * ⚠️ 在这里建实例是安全的：**构造它不发任何请求**（握手是第一次用的时候才做），
 *    所以模块级 `const` 不会在 import 时打网络 —— 这一点对测试同样重要
 *    （`tracking-bilibili.test.ts` 会 import 本文件所在的注册表）。
 * ⚠️ 需要注入假 `fetch` 的地方（测试）用 `createBilibiliAdapter({ fetchImpl })`，
 *    不要改这个常量：`deps` 是 `createBilibiliAdapter` 的参数，就为了这件事。
 */
export const bilibiliAdapter: PlatformAdapter = createBilibiliAdapter();

/**
 * 从**已解析的 URL** 里抠 mid，抠不到就是 `null`。
 *
 * ⚠️ 只喂 `host + pathname`，**不喂整串 URL**：`SPACE_URL` 是拿 `^` 或 `.` 起头的
 * （认得 `space.bilibili.com/123`、`www.space.bilibili.com/123`），
 * 整串给它的话前面挂着 `https://`，那个 `^` 就落空了 —— 结果就是"明明是对的空间页链接
 * 但认不出来"。b23 那条路（要拿最终 URL 再抠一次）正是踩在这里的，
 * 抓住它的是本文件的 b23 用例。
 */
function midInUrl(url: URL): string | null {
  const match = SPACE_URL.exec(`${url.host}${url.pathname}`);
  return match?.[1] ?? null;
}

/** A page number, or 1 when the caller has no cursor yet (spec §5.1: `cursor ?? '1'`). */
function parsePageCursor(cursor: string | null): number {
  if (cursor === null) return 1;
  if (!PAGE_CURSOR.test(cursor)) {
    /*
     * 游标来自 `tracked_creators.last_cursor`（CLI 写进去的），正常永远是页码或 null。
     * ⚠️ 不"顺手回退到第一页"：那会把一个坏游标变成一次**静默的重新扫描**
     * （不丢数据，但也没人知道游标坏了）。抛出去的代价是这一轮这个 creator 失败，
     * 而 message 直接说明"游标不是页码"。
     */
    throw new BilibiliRejectedError(
      `游标不是页码（last_cursor=${cursor.slice(0, 32)}）—— 本轮不抓，免得把 pn 送成脏值`,
      null,
    );
  }
  return Number(cursor);
}

/**
 * `vlist[i]` → `FetchedVideo`（spec §5.1 的字段映射逐字）。
 *
 * ⚠️★ 每个字段的"没有"都要走 `null`，**绝不许填 0**（本仓纪律，spec §4.3 与
 *    `packages/shared/src/tracking.ts:38-47`）：播放量 `0` 与"上游没回这个字段"
 *    在界面上长得一样，而后者是**接口悄悄变了**的信号。
 *    ⇒ `play: 0` 原样留 0（那是一次真实的量测），`play` 缺失才是 `null`。
 * ⚠️ `length` 走 Task 2 的 `parseBilibiliLength`：它自己已经定下"总和为 0 ⇒ null"
 *    （`'0:00'` 不是"一支 0 秒的视频"，而是"这一格没有时长"），所以这里不重复判。
 * ⚠️ `isLiveReplay` 恒为 `false`：spec §5.1 逐字（"v1 判不出"），它与 `durationSec`
 *    一起由数据层交给 `deriveTags`，本层不打标签（`FetchedVideo` 里没有那个字段）。
 */
function toFetchedVideo(raw: unknown, index: number): FetchedVideo {
  const item = asRecord(raw);
  const bvid = asString(item?.bvid);
  const title = asString(item?.title);

  if (!bvid || title === null) {
    /*
     * ★ 抛，不跳过。`bvid` 是 `UNIQUE (platform, external_id)` 的那一半：
     *   把它当空串就会让**下面每一支视频覆盖同一行**（`ON CONFLICT DO UPDATE`），
     *   而"跳过这一条"是**静默少一支视频**。两种都是本文件最想避免的那类错。
     *   抛出去 = 这个 creator 这一轮失败，日志里能看到上游改了形状。
     */
    throw new BilibiliRejectedError(
      `vlist[${index}] 的 ${bvid ? 'title' : 'bvid'} 不是字符串（上游的字段形状变了）—— 跳过它会静默少一支视频`,
      null,
    );
  }

  return {
    externalId: bvid,
    title,
    thumbnailUrl: toHttpsUrl(asString(item?.pic)),
    publishedAt: toUnixSeconds(asNumber(item?.created)),
    durationSec: typeof item?.length === 'string' ? parseBilibiliLength(item.length) : null,
    viewCount: asNumber(item?.play),
    commentCount: asNumber(item?.comment),
    isLiveReplay: false,
  };
}

/**
 * 封面地址一律升级成 `https`。
 *
 * ⚠️ 实测样例里 bilibili 给的是 `http://i1.hdslb.com/…`（spec §2.2），而线上站点是
 *    **https**：浏览器会按"混合内容"直接拦掉，而且 `deploy/Caddyfile` 的 CSP 是
 *    `img-src 'self' data: https:` —— `http:` 的图片**双重**被挡。
 *    两个阻挡都**不会报错**：界面上只是那一格没有图（本仓 `deploy/mcsr-helper-api.service:68-70`
 *    已经为同一类问题写过一次"代理不是顺手加的一层，它是这条功能成立的前提"）。
 * ⇒ 只改 `http://` 开头的那一种，别的一概不动（`//host/x.png` 这种协议相对地址留给前端）。
 * ⚠️ 认下的代价：万一某台 CDN 不再提供 https，那支视频的封面会 404 —— 一张看不见的图，
 *    与"被 CSP 拦掉"是同一类可见度，而另一侧是**所有**封面都看不见。
 */
function toHttpsUrl(value: string | null): string | null {
  if (!value) return null;
  return value.startsWith('http://') ? `https://${value.slice('http://'.length)}` : value;
}

/**
 * `created` → Unix 秒，`0` 当**没有**。
 *
 * ⚠️ `0` 是 1970-01-01，而本仓对这件事有一条写在三处的裁决
 * （`apps/web/src/components/SeedResultCard.tsx:154-155`、`packages/shared/src/tracking.ts:98`）：
 * "1970 年看起来像一条真实数据"。发布时间尤其糟 —— 它还是列表的排序键
 * （`published_at DESC`），一支 1970 年的视频会静静躺在最后一页。
 * ⇒ 与非零判据一致：`0` 归 `null`（界面上显示破折号）。
 * ⚠️ 代价：真有 1970 年的投稿会被读成"没有时间"。bilibili 2009 年才有，
 *    而 MCSR 速通的视频更晚，所以这个代价在现实里够不着。
 */
function toUnixSeconds(value: number | null): number | null {
  return value === null || value <= 0 ? null : value;
}

/** 读响应文本，读不到就把异常变成一句可读的话（别让它盖掉真正的失败原因）。 */
async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    return `(读响应体失败：${error instanceof Error ? error.message : String(error)})`;
  }
}
