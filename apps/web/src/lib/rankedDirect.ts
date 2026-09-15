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
  parseWeekly,
  RANKED_FETCH_HEADERS,
  RANKED_FETCH_OPTIONS,
  RANKED_UPSTREAM_ALT,
  RANKED_UPSTREAM_PRIMARY,
  type RankedEloData,
  type RankedLiveData,
  type RankedWeeklyData,
} from '@mcsr/shared/ranked';

/*
 * 三个直连路径。⚠️ **上游域名只在 `const.ts` 里写一次**（计划的 Global Constraints 第 1 条），
 * 所以这里只有路径 —— 换入口（或加第三个入口）时改的是常量，不是一个一个 URL。
 */
const PATH_LIVE = '/live';
const PATH_LEADERBOARD = '/leaderboard';
const PATH_WEEKLY = '/weekly-race';

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
async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
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

/** `GET /leaderboard` → ③ 的赛季与前 100 名（截断是 `select.ts` 的事，这里**不截**）。 */
export async function fetchRankedElo(signal?: AbortSignal): Promise<RankedEloData> {
  const data = parseLeaderboard(await getJson(PATH_LEADERBOARD, signal));
  if (data === null) throw new RankedDirectError('bad_response', 'leaderboard 响应形状对不上');
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
