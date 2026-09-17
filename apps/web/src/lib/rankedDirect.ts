/**
 * Ranked 实时信息 —— 浏览器**直连**上游的那一层（2026-09-16 用户裁决）。
 *
 * ===========================================================================
 * 这一层为什么存在，以及它的三份代价（spec §3）
 * ===========================================================================
 * ②③④ 三个面板的数据由**访客自己的浏览器**直连上游：花的是访客自己 IP 的额度，
 * 我们服务器那个出口 IP 的限流额度只被心跳用掉一点。代价写在这里，不藏：
 *   1. **我们看不到前端的失败**（服务端日志里一个字都没有）⇒ 给访客那句话必须**说得具体**
 *      （`lib/rankedErrors.ts`），而这里只负责把失败**分成五种**、别揉成一种；
 *   2. **访客的 IP 会到第三方** ⇒ 见下面 `credentials` / `referrerPolicy` 那两条；
 *   3. **没有服务端兜底**：两个入口都失败时只能用手上那份旧数据 + 一句错误。
 *      ⛔ 否决了"失败时回退到我们服务器"：那等于把被否决的代理方案又建一遍，
 *      而且是一条**几乎不会被走到**的代码（spec §3 代价 3 —— 本仓对"没人走的代码会烂掉"有记录）。
 *
 * ===========================================================================
 * ★★ 三条不是"优化"、而是前提的规矩
 * ===========================================================================
 * ① **`cache: 'no-store'` 不是可选项。** 实测（spec §2.5）主入口那个主机回
 *    `ETag` + `cache-control: max-age=14400`（**4 小时**）⇒ 不显式绕开 HTTP 缓存的话，
 *    第二次请求可能**根本不发出去**：面板会冻在 4 小时前那一份上（人数不动、对局还是那几场），
 *    而**网络面板里一条请求都没有**、控制台里一个字都没有 —— 这是本栏目最难从画面上看出来的错。
 *    否决了"靠上游的 ETag 做条件请求"：它照样要一次网络往返，而 `max-age=14400` 说的是
 *    "4 小时内别再问了"，那句话对一个写着「实时」的面板是致命的。
 * ② **只带 CORS 安全列表内的头**（只有 `accept`，见 `RANKED_FETCH_HEADERS`）。
 *    加任何自定义头都会先发一次 `OPTIONS` 预检，而上游的 OPTIONS 响应我们**没验过**
 *    （spec §5.1）⇒ 一旦它不回 `access-control-allow-headers`，结果不是"少一个头"，
 *    而是**整个请求失败**，且看起来像网络问题。**也**不写 `content-type`：GET 没有请求体，
 *    写它只会平白多一次预检（同一条规矩写在 `const.ts` 里）。
 *    ⚠️ `user-agent` 是 forbidden header，浏览器里本来也设不了。
 * ③ `credentials: 'omit'` + `referrerPolicy: 'no-referrer'`：访客直连意味着访客的 IP 会到
 *    第三方（用户明确选的代价），既然躲不掉就把**能少给的东西少给** —— 不带 cookie、
 *    不带来源页地址。否决了"带 `credentials: 'include'` 也许能拿到更全的数据"：
 *    我们不登录，带 cookie 只会把访客的第三方身份一起送过去，换不到任何一个字段。
 * 三个选项都在 `RANKED_FETCH_OPTIONS` / `RANKED_FETCH_HEADERS` 里 —— **本文件不抄第二份**，
 * 否则改一处而另一处不动时，症状是"某个面板就是不实时"。
 *
 * ===========================================================================
 * ⚠️ 用 `globalThis.fetch`，而且**在调用那一刻现读**
 * ===========================================================================
 * 渲染自检（`apps/web/scripts/rankedrender.tsx` ⑦）靠 `setUpstreamFetchForTests(记录器)`
 * 替换掉 fetch 来**杜绝真实网络** —— `services/api/src/seeds/upstream.ts` 的文件头是同一条理由，
 * 而那里的代价更重（测试会真的打到用户的生产上游）。⇒ 模块加载时抓一份引用会让替换**静默失效**：
 * 那些断言测的会变成"我们以为发出去了什么"，而真实请求照样发出去。
 *
 * ===========================================================================
 * ⚠️ 这一层自己**不加超时**
 * ===========================================================================
 * 取消由容器（`routes/Ranked.tsx`）的 `AbortSignal` 管。否决了"这里再加一个
 * `AbortSignal.timeout(8 秒)`"：那个数字没有任何实测依据（心跳那 8 秒是服务端到服务端的
 * 本地延迟，和访客的手机网络不是一回事），而它会在慢网络上把一次**本来会成功**的请求掐掉 ——
 * 收益（更早显示错误）与容器那一层完全重复。代价：一个永远不回应的上游会让这一次请求一直挂着，
 * 直到容器自己 abort（它会在换标签页/卸载时立刻取消）。
 */
import {
  parseLeaderboard,
  parseLive,
  parseMatches,
  parsePhase,
  parsePlayerDetail,
  parseWeekly,
  RANKED_FETCH_HEADERS,
  RANKED_FETCH_OPTIONS,
  RANKED_UPSTREAM_ALT,
  RANKED_UPSTREAM_PRIMARY,
  type RankedEloData,
  type RankedLiveData,
  type RankedMatch,
  type RankedPhaseData,
  type RankedPlayerDetail,
  type RankedWeeklyData,
} from '@mcsr/shared/ranked';

/*
 * 四个直连路径。⚠️ **上游域名只在 `const.ts` 里写一次**（计划的 Global Constraints 第 1 条），
 * 所以这里只有路径 —— 换入口（或加第三个入口）时改的是常量，不是一个一个 URL。
 */
const PATH_LIVE = '/live';
const PATH_LEADERBOARD = '/leaderboard';
/** ★ 2026-09-19 加的那一条：赛段的号数与截止时间（实测 93 字节，`/leaderboard` 里没有）。 */
const PATH_PHASE = '/phase-leaderboard';
const PATH_WEEKLY = '/weekly-race';

/** `/users/{昵称}` 与它的 `/matches`（用户 2026-09-19：「点开看最近比赛」+「搜索玩家」）。 */
const PATH_USERS = '/users';

/**
 * `/users/{昵称}` —— 「回车精确查一位玩家」那一次请求的路径（**纯函数**，测试直接断言字符串）。
 *
 * ⚠️★ 必须 `encodeURIComponent`，**不是** `URLSearchParams` / 表单编码：
 *    实测（findings §1.1 的 `[Ranked Bot]` 那张表）空格**只有** `%20` 能被解成空格，
 *    `+` **不**被解 —— `/users/%5BRanked+Bot%5D` 回 400「User is not exists.」，
 *    而 `/users/%5BRanked%20Bot%5D` 回 200。用 `+` 的话，唯一那个名字里带空格的玩家
 *    **永远查不到**，而界面上那句话是「没有这个玩家」—— 一句**我们编出来的假话**
 *    （他确实存在，只是我们问错了写法）。
 * ⚠️ 上游的查询是**精确匹配、大小写不敏感**（`lowk3y` 查不到 `lowk3y_`），
 *    所以这个函数只负责"把用户敲的字原样送进去"，不做任何规范化（大写/小写/去空格）——
 *    规范化会把一次"查得到"变成一次"查不到"（`[Ranked Bot]` 去掉方括号就不存在了）。
 */
export function rankedUserPath(nickname: string): string {
  return `${PATH_USERS}/${encodeURIComponent(nickname)}`;
}

/**
 * `/users/{昵称}/matches?count=N` —— 展开抽屉的第二份数据（这位玩家的最近比赛）。
 *
 * ⚠️★ `count` 上游**是硬校验的**（findings §1.2）：合法区间 1..100、默认 20，
 *    而 `0` / `-1` / `101` / `abc` 一律 **400**（body 里带着 "Too small" / "Too big" /
 *    "Must be an integer" 那几句）—— 与 `/leaderboard` 的 `count` 被**静默忽略**完全不同。
 * ⇒ 这里**不夹**这个数（不去"帮"调用方把它掰回区间）：夹了以后调用方以为
 *    "我请求了 100 条"，而它拿到的其实是别的条数 —— 一个**看起来成功**的错。
 *    越界时上游回 400，`getJson` 把它归进 `http`（那句话里带着**真的**状态码）。
 * ⚠️ 也不做 NaN / 小数检查：`String(NaN)` 是 `"NaN"`，上游一样回 400（同上）。
 *    调用点给的是一个常量，这条兜底只保证"不在这里编一个数出来"。
 * ⚠️ **不传** `sort`（默认 `newest`：实测就是 id 降序 = 最近的在前，那正是"最近比赛"），
 *    也不传 `type` / `season` / `before` / `after` / `excludedecay`：
 *    这一栏要的就是"他最近的几场"，而每多一个参数就多一种没人验证过的上游行为。
 */
export function rankedMatchesPath(nickname: string, count: number): string {
  return `${rankedUserPath(nickname)}/matches?count=${String(count)}`;
}

/**
 * 上游那一侧失败的**五种**原因。
 *
 * ⚠️ 它们必须分开：`lib/rankedErrors.ts` 把它们映射成五句不同的话，而 §3 的代价 1 说得很直白
 *    —— 直连的失败**我们在服务端看不到**，「连不上」「上游回了看不懂的东西」「上游说没有这一周」
 *    「上游在限你的流」是四种不同的处境，笼统一句"出错了"是我们能得到的最少的信息。
 * ⚠️★ `not_found` 尤其不能并进 `http`：它是**用户**手改 URL 点了一周不存在的数据
 *    （上游对未来的周号与 −1 以下的周号回 400 `race is not found`，实测），
 *    并进 `http` 之后界面会说"上游回了个意外的状态码"，听起来像故障 ——
 *    而用户下一步该做的是**别等了**，不是重试。
 * ⚠️★ `rated` 同理，而且它就是 spec §7.3 那句话的来历：上游按**访客自己的 IP** 限流
 *    （每 IP 500 次/10 分钟）回的就是 429（§6.6）。它在界面上**不是**"上游回了个意外的状态码"，
 *    而是「请求有点频繁，过一会儿再试。」—— 那一句正是**为这一档**写的
 *    （§7.3 的 `ranked.errRateLimited` 注释：它与全站的 `rate_limited` 文案分开，
 *    因为被限的是访客自己打到上游的请求数，不是我们对他的限流）。
 *    ⇒ **只有 429** 从 `http` 里单列出来；其余每一个 4xx/5xx 仍旧是 `http`
 *    （不逐个成档：我们对其它的状态码没有实测，一个一个给它们编话就是把猜测写成事实）。
 */
export type RankedDirectErrorReason = 'network' | 'http' | 'not_found' | 'bad_response' | 'rated';

/**
 * 直连失败的**唯一**形状：一个原因 +（可能）一个上游状态码。
 *
 * ⚠️ 它**不是** `ApiError`：那是"**我们自己的 API** 回了错误"的形状（有服务端的码、有 issues、
 *    还有会话那一层的意思）。硬塞进去会让 `lib/rankedErrors.ts` 再也分不清
 *    "上游的事"与"我们服务器的事" —— 而分清这两件正是这一栏最需要的事
 *    （一个要等上游，一个要去看我们自己的服务）。
 * ⚠️ `message` 是给**排查**看的（中文，与本仓其它内部错误一致），**不直接进界面**：
 *    界面上那句话由 `reason` 翻出来（`describeRankedError`）。它进不去界面的另一个理由是
 *    它随时可能被改写，而"改写一句文案就静默换掉用户的提示"是本仓踩过的坑。
 */
export class RankedDirectError extends Error {
  readonly reason: RankedDirectErrorReason;
  /** 上游回的状态码。`http` 与 `rated` 上一定有；`not_found` 是那个 400。 */
  readonly status: number | undefined;

  constructor(reason: RankedDirectErrorReason, message: string, status?: number) {
    super(message);
    this.name = 'RankedDirectError';
    this.reason = reason;
    this.status = status;
  }
}

/**
 * 上游对**这个昵称**的回答：查无此人 / 昵称不合法。
 *
 * ⚠️ 上游对"查无此人"回的是 **400 而不是 404**（实测，findings §6），
 *    而两种 400 的 body **完全不一样**（判据写在 `lookupErrorFromResponse` 上）——
 *    它们在界面上是两句话（「没有这个玩家」/「这个昵称不合法」），那两句住在
 *    `ranked.lookupNotFound` / `ranked.lookupInvalid`（渲染在 `.ranked__lookup` 里，
 *    `RankedPanels.tsx` 的查询结果那一块）—— ⚠️ **不是** `lib/rankedErrors.ts` 那一层：
 *    它只管"这一次请求没成功"那七格（修复轮 T4 删掉的那两张重复词条曾在那里）。
 */
export type RankedLookupKind = 'not_found' | 'invalid_identifier';

/**
 * 「**这个昵称**有问题」那一族失败。
 *
 * ---------------------------------------------------------------------------
 * ⚠️★ 它与 `RankedDirectError` 是**两族**东西，故意不互相继承
 * ---------------------------------------------------------------------------
 * `RankedDirectError` 的每一档说的都是"**这一次请求**没成功"（连不上 / 上游回了别的状态码 /
 * 响应读不懂 / 被限流）—— 那几句话的方向都是"**重试可能有用**"；
 * 而这一族说的是"**这个昵称**不存在 / 上游不收"，重试**永远是白试一次**
 * （上游的查询是精确匹配：`lowk3y` 查不到 `lowk3y_`，findings §6 末段）。
 * ⇒ 如果它继承 `RankedDirectError`，仓里每一个 `instanceof RankedDirectError`
 *   （包括 `lib/rankedErrors.ts` 那张表）都会把它当成"上游回了一个错误"，
 *   用户读到的就是一句**方向错了**的话："稍后再试"——而再试一百次也是同一个结果。
 * ⚠️ `kind` 是**两格**的联合（不是一个字符串）：渲染层要按它分两句话说，
 *    而多出来的 kind 会在这里当场编译不过。
 */
export class RankedLookupError extends Error {
  readonly kind: RankedLookupKind;

  constructor(kind: RankedLookupKind, message: string) {
    super(message);
    this.name = 'RankedLookupError';
    this.kind = kind;
  }
}

/**
 * 测试用的 fetch 替身（`null` = 用真的那一个）。
 *
 * ⚠️ 声明成一个**模块级变量**而不是"在模块顶部抓一份 `globalThis.fetch` 的引用"：
 *    见文件头最后一节 —— 抓引用会让替换失效，而那个失败的样子是
 *    "自检全绿、真实请求照样发出去"。
 */
let upstreamFetch: typeof globalThis.fetch | null = null;

/**
 * 供**渲染自检**用：把"实际发出去的那一次请求"记下来。
 *
 * `apps/web` 没有测试运行器，这一栏唯一能断言的地方就是渲染自检（spec §11.3 ⑦），
 * 而"请求选项对不对"这件事**只存在于函数被调用时**（产物里看不出来）——
 * 它就是本栏目最容易犯、也最难从画面上看出来的那个错。
 * ⚠️ 传 `null` 恢复真实 fetch：自检**必须**在断言之后复位，否则那个脚本之后任何一次
 *    真实调用都会打到上游。
 * ⚠️★ 复位就写 `setUpstreamFetchForTests(null)`，**不要**写成把 `globalThis.fetch` 传进来：
 *    替身是以**裸函数**形式调用的（`stub(url, init)`，见 `send()`），而原生 `fetch` 要求
 *    `this` 是 `globalThis` ⇒ 把原生那个函数当替身传进来会当场抛 `Illegal invocation`，
 *    而那个错在界面上长得像"上游挂了"（真 fetch 那一支是**成员调用**，`this` 天然正确）。
 */
export function setUpstreamFetchForTests(fn: typeof globalThis.fetch | null): void {
  upstreamFetch = fn;
}

/**
 * 是不是**我们自己**取消的（容器换标签页 / 卸载时 abort）。
 *
 * ⚠️ 取消不是失败，必须**原样往上抛**：容器的 catch 正是靠 `name === 'AbortError'`
 *    把它认出来并直接 return（`routes/ShareBoard.tsx` 就是那个形状）。
 *    把它翻成 `bad_response`，用户切一下标签页就会看到"上游返回的数据看不懂"。
 * ⚠️ 判据只用**名字**：abort 抛的是 `DOMException`，而它是不是同时 `instanceof Error`
 *    在各运行环境里的表现并不一致（本机探针 `.cache/ranked-probe-abort.mjs` 量到 Node/undici
 *    两个都成立，浏览器里没量过）⇒ 两种都认，名字是唯一稳定的部分。
 * ⚠️ **超时不算"我们自己取消"**：探针量到超时抛的名字是 `TimeoutError`（不是 `AbortError`），
 *    于是它落到下面那条兜底支、按**网络层失败**处理（换兜底入口重试一次）——
 *    这正是 spec §5.2 那句"只在网络错误/超时时重试一次"。
 */
function isCallerAbort(error: unknown): boolean {
  return (error instanceof DOMException || error instanceof Error) && error.name === 'AbortError';
}

/** 主入口/兜底入口 + 路径。两个入口的路径**完全相同**（spec §13）。 */
function endpoint(base: string, path: string): string {
  return `${base}${path}`;
}

/**
 * 「这是一个对象吗」—— 与 `parse.ts` 里那个同名助手**逐字同形**（那一份是模块私有的）。
 * ⚠️ 数组要排掉：`typeof [] === 'object'`，而 `[]?.['error']` 取得到东西的写法
 *    会让一份"本该是对象却是数组"的 body 被读成一堆编号字段（而且读不出错）。
 */
function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * 「这一次非 2xx，你认得出来吗」—— `getJson` 的钩子。
 *
 * 返回一个 `Error` 就抛它；返回 `null` 表示"我不认识这一种"，`getJson` 继续走既有那三条判据
 * （周赛 400 ⇒ `not_found`、429 ⇒ `rated`、其余 ⇒ `http`）。
 * ⚠️ 钩子收的是**整个 Response**（不是状态码）：今天要用它的那两档**状态码完全一样**
 *    （都是 400），分得开它们的东西只在 body 里 —— 而 body 只能读一次，
 *    所以"谁来读"必须只有一处（读两次会抛 `Body is unusable`）。
 */
type NotOkHandler = (response: Response) => Promise<Error | null>;

/**
 * 上游「查无此人 / 昵称不合法」的**两种 400**（实测，findings §1.1 与 §6）。
 *
 * 判据是 body 里的**字段**，不是任何一句英文原文（原文是上游的文案，它会变；结构不会）：
 *   · `{"status":"error","data":{"error":"User is not exists."}}` ⇒ `not_found`
 *   · `{"status":"error","data":{"params":{"identifier":["Invalid user identifier"]}}}` ⇒ `invalid_identifier`
 *     ⚠️ 实测这条的**边界是 20 个字符**（`q`×20 ⇒ 前者、`q`×21 ⇒ 后者），
 *     而 `discord.338669823167037440`（26 字符）**仍然 200** ⇒
 *     这是"标识符的**形式**"被拒，不是"昵称最长 20 字"这条通用规则（我们只说上游回的那一种）。
 * ⚠️ 只有 400 走这里（别的状态码直接回 `null`，交回去走既有判据）：
 *    上游对未匹配路径回 **404**（`{"status":"error","data":{"error":"not found"}}`，实测）
 *    —— 把 404 也读成"没有这个玩家"是在**替上游**断言它没有的语义。
 * ⚠️ body 读不出来（Cloudflare 的 HTML 400 页实测真会发生）⇒ `null`：
 *    那时我们**不认识**这一种 400，交回 `http` 那一档 —— 那句话里带着真的状态码 400，
 *    而"没有这个玩家"是一句我们当时**并不知道**的话。
 * ⚠️ 两个字段实测**互斥**（一种 body 只有前者、另一种只有后者），判据顺序因此不承载语义；
 *    但两者同时出现时取前者（`data.error` 是上游更笼统的那一档）。
 */
async function lookupErrorFromResponse(
  response: Response,
  nickname: string,
): Promise<Error | null> {
  if (response.status !== 400) return null;

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    // ⚠️ 读 body 的过程中也可能被取消（abort 会同时中止读取）—— 那一支必须原样往上抛，
    //    翻成"不认识这一种 400"会让用户切标签页时看到一句"上游回了一个错误"。
    if (isCallerAbort(error)) throw error;
    return null;
  }

  const data = asRecord(asRecord(body)?.data);
  if (!data) return null;

  // ① 「User is not exists.」—— 昵称**格式没问题**，只是没有这个人
  const notExists = data.error;
  if (typeof notExists === 'string' && notExists.trim() !== '') {
    return new RankedLookupError('not_found', `上游说没有这个玩家：${nickname}`);
  }

  // ② 「Invalid user identifier」—— 昵称**这个写法**上游不收（实测：超过 20 个字符）
  const identifier = asRecord(data.params)?.identifier;
  if (Array.isArray(identifier) && identifier.length > 0) {
    return new RankedLookupError('invalid_identifier', `上游说这个昵称不合法：${nickname}`);
  }

  return null;
}

/**
 * 发一次直连请求 —— **本文件里唯一碰 `fetch` 的地方**。
 *
 * ⚠️ 请求选项**每一次现拼**，不是共享一个可变的模块级对象：`signal` 每次不同，
 *    而"共享一个对象再往上改"会让两个并发请求互相把对方的 signal 换掉，
 *    表现是其中一路永远不结束、或被另一路的取消误伤。
 *    `RANKED_FETCH_OPTIONS` / `RANKED_FETCH_HEADERS` 本身是**只读**常量，这里只展开、绝不写回
 *    （写回等于改掉这一栏所有请求的隐私与实时性设置，而且从调用点上看不出来）。
 */
async function send(url: string, signal: AbortSignal | undefined): Promise<Response> {
  const init: RequestInit = {
    ...RANKED_FETCH_OPTIONS,
    headers: RANKED_FETCH_HEADERS,
    signal,
  };
  const stub = upstreamFetch;
  // ⚠️ 真 fetch 以 `globalThis.fetch(...)` 的**成员调用**形式发出（`this` 必须是 globalThis）。
  return stub === null ? await globalThis.fetch(url, init) : await stub(url, init);
}

/**
 * 发一个直连请求并读成 JSON。
 *
 * 五种失败里有四种在这里定下来（`bad_response` 还有一半在调用方，见 `fetchRankedLive`）：
 *   · 两个入口都 reject（网络层/超时） ⇒ `network`
 *   · 上游回 429（它在按访客的 IP 限流） ⇒ `rated`
 *   · 上游回了个别的非 2xx ⇒ `http`，**除了**"带 id 的周赛回 400"那一支 ⇒ `not_found`
 *   · 响应体不是 JSON ⇒ `bad_response`
 */
async function getJson(
  path: string,
  signal?: AbortSignal,
  onNotOk?: NotOkHandler,
): Promise<unknown> {
  let response: Response;
  try {
    response = await send(endpoint(RANKED_UPSTREAM_PRIMARY, path), signal);
  } catch (error) {
    if (isCallerAbort(error)) throw error;
    /*
     * ★ 只有**网络层失败**（fetch reject / 超时）才换兜底入口，而且只换一次。
     *   4xx/5xx **不重试**：那是上游在回答我们，换一个入口只会得到**同一个**答案，
     *   而且会把访客自己的额度花两遍、把一个确定的答案变成一次慢等待（spec §5.2）。
     */
    try {
      response = await send(endpoint(RANKED_UPSTREAM_ALT, path), signal);
    } catch (second) {
      if (isCallerAbort(second)) throw second;
      throw new RankedDirectError('network', '两个入口都连不上');
    }
  }

  if (!response.ok) {
    /*
     * ★ 先问**调用方**的钩子，再走下面那三条通用判据。
     *   只有提问的那一条路径知道"我这个 4xx 的 body 是什么意思"——今天只有
     *   `/users/{昵称}`：上游"查无此人"回的是 **400 而不是 404**，而且两种 400 的 body
     *   不一样（`lookupErrorFromResponse`）。钩子说"不认识"（回 `null`）就往下走，
     *   这一条分支以前的行为**一个字节都没变**（四个老 fetcher 都不传钩子）。
     * ⚠️ 它是 async 的：读 body 要 await，而 body 只能读一次 ⇒ 这一处是唯一读它的地方。
     */
    if (onNotOk) {
      const known = await onNotOk(response);
      if (known !== null) throw known;
    }
    /*
     * ★ 400 单独成档，而且**只在带 id 的周赛那一路**上：上游对"这一周不存在"回的是
     *   400 `race is not found`（实测：104 / -2 / -3 都是这个回答）。那是**用户**手改 URL
     *   的结果，不是故障 ⇒ 界面该说「没有这一周。」而不是「连不上上游」。
     * ⚠️ 不带 id 的那一次（本周）**没有**"哪一周"这个概念，它回 400 说明是别的问题 ——
     *   那一支按 `http` 说才不撒谎（把一次真异常说成"这周不存在"，用户会以为是自己 URL 的问题）。
     */
    if (response.status === 400 && path.startsWith(`${PATH_WEEKLY}/`)) {
      throw new RankedDirectError('not_found', '上游说这一周不存在', 400);
    }
    /*
     * ★ 429 单独成档（**只有它**）：上游按访客自己的 IP 限流时回的就是这个码，
     *   而 spec §7.3 的 `ranked.errRateLimited`（「请求有点频繁，过一会儿再试。」）
     *   正是**为了这一档**才与全站的 `rate_limited` 分开写的 ——
     *   落进 `http` 的话，那一格会变成一句**永远走不到**的词条（`RANKED_ERROR_KEYS`
     *   里 `rated` 本来就是七格之一），而用户会看到一句方向不对的"上游回了个错误"。
     * ⚠️ 其余 4xx/5xx **不逐个成档**：我们对上游的其它状态码没有实测，
     *   一个一个给它们编话就是把猜测写成事实；它们一律 `http`（那句话里带着真实数字）。
     */
    if (response.status === 429) {
      throw new RankedDirectError('rated', '上游在限流', 429);
    }
    throw new RankedDirectError('http', `HTTP ${String(response.status)}`, response.status);
  }

  try {
    return await response.json();
  } catch (error) {
    /*
     * ⚠️ 读响应体的过程中也可能被取消（abort 会同时中止读取）—— 那一支同样是"我方取消"，
     *    不能变成一个 `bad_response`：容器靠名字识别取消，翻掉了它就等于在用户切标签页时
     *    显示一句"上游返回的数据看不懂"（"连上了但读到一半被掐掉"不是上游的错）。
     */
    if (isCallerAbort(error)) throw error;
    throw new RankedDirectError('bad_response', '响应体不是 JSON');
  }
}

/**
 * `GET /live` → ① 的在线人数 + ② 的高分对局。
 *
 * ⚠️ `parseLive` 回 `null` ⇒ `bad_response`，**不是崩在渲染里**，也不是"没有对局"：
 *    它代表**整份**响应不是我们要的东西（`status !== 'success'` / 缺 `data` /
 *    `liveMatches` 不是数组）。逐格坏掉的那些不会让它变 `null` —— 那是宽容解析的另一半
 *    （spec §4.3），所以"上游给的数据缺字段"这件事**到不了这里**，界面上的「—」负责它。
 */
export async function fetchRankedLive(signal?: AbortSignal): Promise<RankedLiveData> {
  const data = parseLive(await getJson(PATH_LIVE, signal));
  if (data === null) throw new RankedDirectError('bad_response', 'live 响应形状对不上');
  return data;
}

/** `GET /leaderboard` → ③ 的赛季与前 150 名（截断是 `select.ts` 的事，这里**不截**）。 */
export async function fetchRankedElo(signal?: AbortSignal): Promise<RankedEloData> {
  const data = parseLeaderboard(await getJson(PATH_LEADERBOARD, signal));
  if (data === null) throw new RankedDirectError('bad_response', 'leaderboard 响应形状对不上');
  return data;
}

/**
 * `GET /phase-leaderboard` → ③ 顶上那并排的一格（**赛段**的号数与截止时间）。
 *
 * ---------------------------------------------------------------------------
 * ★ 为什么它必须是一次**独立的**请求（用户 2026-09-19 要"并排显示赛段信息"）
 * ---------------------------------------------------------------------------
 * `/leaderboard` 的响应里**没有 phase 对象**（实测：只有每一行各自的
 * `seasonResult.phasePoint` / `phaseHighest`）—— 赛段的号数与截止时间只在
 * 这一个端点上，而且它极便宜（实测 93 字节、无参数、`users` 是空数组）。
 * ⇒ 排行榜面板因此变成**两次直连**，而两次都走访客自己的 IP（spec §3，没有新端点）。
 * ⚠️★ 这一路是**辅助**的：容器用 `{ fatal: false }` 调它（与"历史周补问一次最新周号"
 *    那一路同形）—— 它挂了时排行榜**照常渲染**，只有赛段那一格说"读不到"。
 *    把它写成主路（`fatal: true`）会让一次 93 字节的失败把一整张榜变成错误页。
 * ⚠️ 它带的那份 `users`（赛段积分榜）**我们不读**：用户要的是赛段的时间窗口
 *    （`types.ts` 的 `RankedPhaseData` 上写着同一句）。
 *
 * ⚠️ 它照样走 `getJson` ⇒ 也就是说它**继承**了那三条冻结规矩（`cache: 'no-store'`、
 *    只带 CORS 安全头、`credentials: 'omit'` + `no-referrer`）：实测这个端点与
 *    `/leaderboard` 一样回 `Access-Control-Allow-Origin: *` 与
 *    `cache-control: max-age=14400`（findings §3）⇒ 两者缺一不可。
 */
export async function fetchRankedPhase(signal?: AbortSignal): Promise<RankedPhaseData> {
  const data = parsePhase(await getJson(PATH_PHASE, signal));
  if (data === null)
    throw new RankedDirectError('bad_response', 'phase-leaderboard 响应形状对不上');
  return data;
}

/**
 * `GET /weekly-race[/{id}]` → ④ 的周赛榜单。
 *
 * ⚠️ `id === null` 是"**本周**"，走不带 id 的那条路径（上游会回当前周，并把周号放在响应里；
 *    响应里的那个周号才是权威值，所以调用方拿到的 `data.id` 可能**不等于**自己请求的那个，
 *    请求 0 更是直接回当前周 —— 那是 `parse.ts` 与 spec §2.3 第 5 条的事）。
 * ⚠️ 这里**不校验** id 的合法性（负数/未来的周号都是合法请求）：`-1` 是真实存在的最早一周
 *    （界面显示成「第 0 周」），而"不存在的周"由上游的 400 说话 ⇒ `not_found`。
 *    路由层把 `0` 判成不合法（它在本栏目里不可达），因为上游把 0 当"本周"的别名 ——
 *    放它进来会出现"URL 写着 0、界面显示第 103 周"的画面。
 */
export async function fetchRankedWeekly(
  id: number | null,
  signal?: AbortSignal,
): Promise<RankedWeeklyData> {
  const path = id === null ? PATH_WEEKLY : `${PATH_WEEKLY}/${String(id)}`;
  const data = parseWeekly(await getJson(path, signal));
  if (data === null) throw new RankedDirectError('bad_response', 'weekly-race 响应形状对不上');
  return data;
}

/**
 * `GET /users/{昵称}` → 展开抽屉里的那份汇总（也是「回车精确查一位玩家」要的那一次）。
 *
 * ---------------------------------------------------------------------------
 * ★ 三种失败在这里分成三档（用户下一步做的事完全不同）
 * ---------------------------------------------------------------------------
 *   · **200** ⇒ 解析好的详情（`parsePlayerDetail`；整份形状不对 ⇒ `bad_response`）；
 *   · **400 的两种 body** ⇒ `RankedLookupError`（`not_found` / `invalid_identifier`）：
 *     那是"**这个昵称**不行"，重试没用（`lookupErrorFromResponse` 认这两种）；
 *   · **其余**（网络 / 别的状态码 / 429 / 响应体不是 JSON）⇒ 既有的 `RankedDirectError`：
 *     界面沿用那几句通用文案（"重试可能有用"）。
 * ⚠️★ 钩子**只挂在这一条路径上**：`/users/{昵称}/matches` 那一侧上游的 400 body
 *    **我们没量过**（findings 里量的是 `/users/{id}`）⇒ 不替它断言（那一路的 400 会落进
 *    `http`，界面上那句话带着真的状态码）。要给它同一档，得先量一次它的两种 body。
 * ⚠️ `nickname` 原样交给 `rankedUserPath`（`encodeURIComponent`），**不**在这里 trim：
 *    用户敲了首尾空格时，上游回的是"查无此人"—— 那是**真的**（那个昵称确实不存在），
 *    而我们若自己 trim，就等于悄悄改了用户查的那个名字（`[Ranked Bot]` 那种名字
 *    里本来就可能有一个看起来多余的空格）。
 *
 * ⚠️ 它照样走 `getJson` ⇒ 继承那三条冻结规矩（`cache: 'no-store'`、只带 `accept`、
 *    `credentials: 'omit'` + `no-referrer`）。实测这个端点回 `Access-Control-Allow-Origin: *`
 *    与 `cache-control: max-age=14400`（findings §4）⇒ `no-store` 缺不得（4 小时的缓存
 *    会让"点开看到的"是四个小时前那个人）。
 */
export async function fetchRankedUser(
  nickname: string,
  signal?: AbortSignal,
): Promise<RankedPlayerDetail> {
  const raw = await getJson(rankedUserPath(nickname), signal, (response) =>
    lookupErrorFromResponse(response, nickname),
  );
  const data = parsePlayerDetail(raw);
  if (data === null) throw new RankedDirectError('bad_response', 'users 响应形状对不上');
  return data;
}

/**
 * `GET /users/{昵称}/matches?count=N` → 这位玩家的最近比赛。
 *
 * ⚠️ 形状不对（`status` 不是 success / `data` 不是数组）⇒ `bad_response`
 *    （**不是**"他没有比赛"）：空数组才是"没有比赛"（上游对空结果是
 *    `{"status":"success","data":[]}` + 200，findings §1.2）——
 *    两者在界面上是两句话（"读不到" / "最近没有比赛"）。
 * ⚠️ 行级丢弃发生在 `parseMatches` 里（没有身份的行），所以这里的返回长度
 *    **可能小于** `count` —— 界面那句「最近 N 场」要读这份数组的长度，不是读 `count`。
 * ⚠️ 这一路**不带** 400 的钩子（理由写在 `fetchRankedUser` 上）。
 * ⚠️ `signal` 照既有四个 fetcher 的写法透传：抽屉在换行/收起/卸载时要能取消
 *    （容器那一层的 `AbortSignal` 是唯一管取消的地方 —— 这一层自己不设超时）。
 */
export async function fetchRankedMatches(
  nickname: string,
  count: number,
  signal?: AbortSignal,
): Promise<RankedMatch[]> {
  const raw = await getJson(rankedMatchesPath(nickname, count), signal);
  const matches = parseMatches(raw);
  if (matches === null) throw new RankedDirectError('bad_response', 'matches 响应形状对不上');
  return matches;
}
