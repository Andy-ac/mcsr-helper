/**
 * Ranked 实时信息的**服务端抓取层**：把上游 `/live` 取回来、归一化、缓存 30 秒。
 *
 * ===========================================================================
 * ⚠️★ 这一层为什么存在（2026-09-17）
 * ===========================================================================
 * 用户要求「抓取 ranked 实时信息的 twitch 直播链接，自动加进"直播"频道」，
 * 并且裁决了**运行位置**：在请求路径里顺手做，**不要**新开一个定时任务。
 * 而请求路径要能顺手做，前提是**我们的服务器手上有一份 `/live` 载荷** ——
 * 上游那份载荷里的 `data.<uuid>.liveUrl` 正是要抓的东西。
 * ⚠️ 在这之前**一份都没有**：② 的对局是**访客浏览器直连**取的（spec §3 的 A 方案，
 *    2026-09-16 用户裁决），服务器只取心跳，而心跳那张载荷里**没有** `liveUrl`
 *    （`heartbeat.ts` 取的是状态页主机，与本文件不是同一个上游、也不是同一种形状）。
 * ⇒ 所以这一层是**新加的**，它是"自动收录"这件事唯一的原料来源。
 *
 * ===========================================================================
 * 代价（写在明面上）：我们服务器从此也打 `/live`
 * ===========================================================================
 * 上游限流是 **500 次 / 10 分钟 / IP**（spec §2.1）。在这之前服务器那个出口 IP
 * 只剩心跳一处消耗（30 秒一次 ⇒ ≤2 次/分钟，占额度 4%）。
 * 本层的 TTL 也是 30 秒 ⇒ **最多**再 +2 次/分钟，占用从 4% 变成约 **8%**。
 * ⚠️ 这个数是**上界**：缓存是模块级的、按 TTL 生效，**与访客数无关**
 *    （一百个人同时来也还是 30 秒一次），这正是"不做定时任务"也能安全的原因。
 * ⚠️ 实测 `/live` 的延迟是 **351 ms**（spec §2.1，从生产服务器量的）——
 *    也就是说触发抓取的那**一个**请求会多等这 351 ms。它是请求路径的固有代价
 *    （用户选的就是"顺手做"），而 30 秒里只有**一个**请求付这笔钱。
 *
 * ===========================================================================
 * 与 `heartbeat.ts` 的分工**刻意不同**：缓存也在这个文件里
 * ===========================================================================
 * 心跳那一支的缓存（TTL、single-flight、兜底窗口）住在 `routes/ranked.ts`，
 * 因为那一层要拿 `fetchedAt` 去算 `stale` 与 10 分钟兜底窗口 —— 缓存是**响应体的原料**。
 * 而本层的缓存与响应无关：它只回答"这一份载荷要不要重新取"以及
 * ——**这才是它对 ingest 的意义**——"这一份载荷是不是刚取回来的"。
 * 而且 `routes/ranked.ts` 的注释里已经写死了这条纪律：
 * 「加的是**另一个上游**（另一个文件、另一套形状），不是这个文件的第二把键」
 * ⇒ 取 + 缓存 + single-flight 都留在这里，路由只调 `loadRankedLive()` 一个函数。
 */
import {
  parseLive,
  RANKED_FETCH_HEADERS,
  RANKED_UPSTREAM_PRIMARY,
  type RankedLiveData,
} from '@mcsr/shared/ranked';

/**
 * 抓一次的结果。
 *
 * ★ 失败分**三档**，与 `heartbeat.ts` 的 `HeartbeatResult` 逐档对齐 —— 不是为了对称，
 *   是因为**下游要的下一步不同**（spec §4.2 的三个码就是照这三档定的）：
 *   · `unavailable` → 上游抖了 / 网络不通 / 超时 / 5xx ⇒ 等一下再试（503）；
 *   · `busy`        → 上游在限**我们的**流（429）⇒ 也是等一下，但那是我们打得太快（503 ranked_busy）；
 *   · `bad_response`→ 上游回的东西我们**读不懂**（字段改了）⇒ **我们的适配层要改**（502）。
 * ⚠️ 三档里**没有**"没有对局"这一档：`liveMatches` 是空数组是一份**正常**的成功响应。
 */
export type RankedLiveFeedResult =
  | {
      ok: true;
      data: RankedLiveData;
      /**
       * ★ 这份载荷是不是**这一次调用刚从上游取回来的**。
       *
       * ingest 只认 `true`：缓存命中/搭车的那几次不重复写库，
       * 于是"最多每 30 秒一个入库窗口"这句话才是真的（见 `ingest.ts` 的文件头）。
       */
      fromUpstream: boolean;
    }
  | { ok: false; kind: 'unavailable' | 'busy' | 'bad_response'; detail: string };

/**
 * 超时毫秒数。可用 `MCSR_RANKED_LIVE_TIMEOUT_MS` 覆盖。
 *
 * 8 秒与心跳同值（`heartbeat.ts` 的冻结值）：两个都是服务端到服务端的一次 GET，
 * 而这里**多一层理由** —— 触发它的那个请求要**等**它（用户选的就是请求路径里做），
 * 所以这个上界是"最坏情况下一个请求会被拖多久"。
 */
function timeoutMs(): number {
  const raw = Number(process.env.MCSR_RANKED_LIVE_TIMEOUT_MS ?? '');
  return Number.isFinite(raw) && raw > 0 ? raw : 8_000;
}

/**
 * 缓存时长（毫秒）。可用 `MCSR_RANKED_LIVE_TTL_MS` 覆盖，默认 30 秒。
 *
 * ⚠️ 与心跳那条一样，"没设 / 空串"必须先判断：`Number('')` 是 **0**（有限且 >= 0），
 *    写成 `Number(process.env.X ?? '')` 会让**没设**时得到 TTL = 0 ——
 *    缓存从不生效 ⇒ 每个请求都打一次上游，占满额度而我们自己看不出来。
 *    显式的 `0` 仍然要生效（测试靠它把"每个请求都算一次新抓取"变成确定的事）。
 */
function ttlMs(): number {
  const raw = process.env.MCSR_RANKED_LIVE_TTL_MS;
  if (raw === undefined || raw.trim() === '') return 30_000;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : 30_000;
}

/**
 * 把 fetch 抛出来的东西变成一句能排查的话（**只进日志**，绝不进响应体）。
 *
 * ⚠️ 同样只看 `message` 不够：undici 在连接层失败时给的是 "fetch failed"，
 *    真正的原因（ECONNREFUSED / ENOTFOUND / 证书…）塞在 `cause.code` 里
 *    （`heartbeat.ts` 与 `seeds/upstream.ts` 里有同一条注释与同一个理由）。
 */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause =
    typeof error.cause === 'object' && error.cause !== null
      ? (error.cause as Record<string, unknown>)
      : null;
  const code = cause?.code;
  return typeof code === 'string'
    ? `${error.name}: ${error.message}（${code}）`
    : `${error.name}: ${error.message}`;
}

/** 取一次上游（**不过缓存、不做 single-flight**，那是 `loadRankedLive` 的事）。 */
async function fetchFeed(): Promise<RankedLiveFeedResult> {
  /*
   * ⚠️ 路径拼在**常量**上（计划的 Global Constraints 第 1 条：上游域名只写在
   *    `const.ts` 里一次）。它和浏览器直连用的是**同一个入口**
   *    （`api.mcsrranked.com`，上游文档说缓存 5 秒、推荐那一个）——
   *    本层**不做**兜底入口重试：那是"访客的请求"值得做的事（spec §5.2），
   *    而这里的失败下一轮（30 秒后）会自动重来，重试只会让触发它的那个请求更慢。
   */
  const url = process.env.MCSR_RANKED_LIVE_URL ?? `${RANKED_UPSTREAM_PRIMARY}/live`;

  let response: Response;
  try {
    // ⚠️ 用 globalThis.fetch（不提前抓引用）—— 测试靠替换它来杜绝真实网络。
    response = await globalThis.fetch(url, {
      headers: {
        // ★ 复用浏览器那一侧冻结下来的头（`accept` 在 CORS 安全列表里），不抄第二份
        ...RANKED_FETCH_HEADERS,
        /*
         * ⚠️ 服务端**额外**带 UA：浏览器里它是 forbidden header、本来就设不了，
         *    而我们对第三方应当是"有名字的来访者"（与 `heartbeat.ts` 同一条理由：
         *    不带 UA 会让对方无法按来源联系我们）。
         */
        'user-agent': 'mcsr-helper/0.3 (+https://mcsrhelper.com)',
      },
      signal: AbortSignal.timeout(timeoutMs()),
    });
  } catch (error) {
    return { ok: false, kind: 'unavailable', detail: `网络失败：${describeError(error)}` };
  }

  if (!response.ok) {
    // ★ 429 单独成档（同 `heartbeat.ts`）：那是"上游在限我们的流"，不是"上游挂了"
    if (response.status === 429) return { ok: false, kind: 'busy', detail: 'HTTP 429' };
    return { ok: false, kind: 'unavailable', detail: `HTTP ${String(response.status)}` };
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (error) {
    /*
     * ⚠️ 200 却不是 JSON ⇒ `unavailable`（上游抖了 / 被前面的网关挡了），**不是**
     *    `bad_response`：那种响应体通常是一页 HTML 错误页，把它报成 502
     *    会把排查方向指向一个并不存在的字段名问题（同 `heartbeat.ts`）。
     */
    return {
      ok: false,
      kind: 'unavailable',
      detail: `响应体不是合法 JSON（${describeError(error)}）`,
    };
  }

  const data = parseLive(raw);
  if (!data) {
    /*
     * ⚠️ 这一档是**我们的适配层要改**（上游改了字段名/结构），不是"上游抖了一下"。
     *    与心跳的差别：心跳那条能把"缺的是哪一格"写进日志（它只查一格），
     *    而 `/live` 整份不成形状的可能是 `status` / `data` / `liveMatches` 三处，
     *    在这里猜一个具体字段名等于把猜测写进日志 ⇒ 只说这三处。
     */
    return {
      ok: false,
      kind: 'bad_response',
      detail: 'live 响应不成形状（status 不是 success / 缺 data / liveMatches 不是数组）',
    };
  }

  return { ok: true, data, fromUpstream: true };
}

// ---------------------------------------------------------------------------
// 缓存：一份数据 + 一个"上次尝试"的时刻 + 在飞的那一次
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 两个时刻必须分开，理由是心跳那一支**实测过的**缺陷（`routes/ranked.ts` 的 ★★）：
 *   · `fetchedAt`     —— 这份**数据**是什么时候拿到的（决定"还要不要重取"）；
 *   · `lastAttemptAt` —— 我们**上一次尝试打上游**是什么时候（决定"现在该不该再打"）。
 * 合在一起写（只看 `fetchedAt`）的话，**失败之后那个判据永远为真** ⇒
 * 每个请求都打一次上游，而上游越挂我们打得越狠（正好是要避免的那个反馈环）。
 */
let cached: { data: RankedLiveData; fetchedAt: number } | null = null;
let lastAttemptAt = 0;

/**
 * 最近一次**真的尝试**失败的那一档。
 *
 * ⚠️ 没有它，节流把这次请求的上游调用挡掉之后，这次请求**不知道**上游现在是什么毛病
 *    （429 还是形状漂移还是挂了），只能含糊回一句 `upstream_unavailable` ——
 *    而 502 / `ranked_busy` 的区分正是这套码存在的意义（spec §4.2）。
 */
let lastFailure: { kind: 'unavailable' | 'busy' | 'bad_response'; detail: string } | null = null;

/** 在飞的那一次上游调用（single-flight 就靠它）。 */
let inflight: Promise<RankedLiveFeedResult> | null = null;

/**
 * ⚠️ **仅供测试**：清掉缓存、尝试时钟、失败档与在飞的那一次。
 *
 * 为什么必须有它：这几份状态是**模块级**的，会跨用例存活 —— 不清的话
 * "TTL 内不再打上游"那类用例会被上一个用例留下的缓存蒙对
 * （同 `routes/ranked.ts` 的 `resetRankedStatusCache`，那是本仓为同一个问题开过的先例）。
 */
export function resetRankedLiveFeed(): void {
  cached = null;
  lastAttemptAt = 0;
  lastFailure = null;
  inflight = null;
}

/**
 * 取一份 `/live` 载荷 —— **最多每 TTL 打一次上游**（成功与失败一视同仁）。
 *
 * 顺序就是四句话，别调换：
 *   1. 手上有**新鲜**的 ⇒ 直接给它（`fromUpstream: false`，这次没有上游流量）；
 *   2. 有人在飞 ⇒ 搭上它（single-flight，`fromUpstream: false`：入库由发起者做）；
 *   3. 不到点 ⇒ **一次上游都不打**，按最近一次失败回答（缓存里那份如果还不够 TTL
 *      会在第 1 步就返回；走到这里说明上游最近出过问题）；
 *   4. 到点 ⇒ 打一次，成功就换缓存，失败就记下那一档。
 *
 * ⚠️ `fromUpstream` 只对**发起者**为 `true`：搭车的那几个请求拿到的载荷与发起者
 *    是同一份，若它们也去写库，就是"一个 30 秒窗口里入库 N 次"。
 *
 * ⚠️★ 本层**故意不做**"旧数据兜底"（心跳那一支有 10 分钟兜底，这里没有）：
 *    心跳的面板是一串数字，旁边说一句「这是旧数据」就够诚实了；而 ② 的对局是
 *    「**现在**正在打的对局」—— 一份 40 秒前的对局列表配上「实时」正是本仓明令
 *    不许出现的那种展示（数据是真的、时间是假的，spec §5.3）。
 *    旧数据该由**客户端**自己留着（spec §3 代价 3 写的就是这个形状），
 *    所以这里失败就老实按失败回答，不发明一个 `stale` 字段去撑住一个更旧的画面。
 */
export async function loadRankedLive(): Promise<RankedLiveFeedResult> {
  /*
   * 时间只在这里取一次（同心跳那一支的理由）：缓存判断与"该不该再打"必须是**同一个**时刻，
   * 在这一层取第二次会让它们差一个随时会变的数。
   */
  const now = Date.now();

  const hit = cached;
  if (hit !== null && now - hit.fetchedAt < ttlMs()) {
    return { ok: true, data: hit.data, fromUpstream: false };
  }

  const existing = inflight;
  if (existing) {
    /*
     * ⚠️ 搭车者把 `fromUpstream` 压成 `false`：载荷是同一次上游调用的产物，
     *    而**发起者**已经/即将为它入库一次。
     */
    const joined = await existing;
    return joined.ok ? { ok: true, data: joined.data, fromUpstream: false } : joined;
  }

  if (now - lastAttemptAt < ttlMs()) {
    const failure = lastFailure;
    return failure === null
      ? { ok: false, kind: 'unavailable', detail: '还没有成功取过一次 /live' }
      : { ok: false, kind: failure.kind, detail: failure.detail };
  }

  // ★ 真正发起一次尝试的时刻就在这里：**在 `await` 之前**，于是成功与失败对节流的影响一样
  lastAttemptAt = now;

  const attempt = fetchFeed().finally(() => {
    /*
     * ⚠️ 清之前必须做**身份判断**（同心跳那一支）：`resetRankedLiveFeed()` 可以在有请求
     *    还在飞的时候清掉这份记录，于是后来者可能已经新起了一个 promise ——
     *    无条件写 null 会清掉**别人**的槽位，下一个请求就会以为"没有人在飞"而再打一次上游。
     */
    if (inflight === attempt) inflight = null;
  });
  inflight = attempt;

  const result = await attempt;
  if (result.ok) {
    cached = { data: result.data, fetchedAt: Date.now() };
    lastFailure = null;
  } else {
    lastFailure = { kind: result.kind, detail: result.detail };
    /*
     * ★ 日志打**在这里**，不是打在路由里 —— 于是"一次**尝试**一行"是**结构上**成立的：
     *    · 搭车的那几个请求走的是上面 `existing` 那一支，根本到不了这里；
     *    · 被节流挡掉的那几个请求也到不了（它们连上游都没打）。
     *   否决了"在路由里按响应打"：一个请求一行，等于把一次上游故障看成 N 次
     *   （`routes/ranked.ts` 的心跳那一支为同一个理由把日志放在了尝试的位置）。
     * ⚠️ 前缀是 `[ranked-live]`，与心跳的 `[ranked]` 分开：`ranked.test.ts` 里
     *    "一次故障有且只有一行 `[ranked]` 日志"那些断言不该被这一层搅动。
     */
    console.error(`[ranked-live] /live 取不到（${result.kind}）：${result.detail}`);
  }
  return result;
}
