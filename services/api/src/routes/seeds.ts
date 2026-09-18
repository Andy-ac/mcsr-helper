/**
 * Ranked Seeds 上游代理路由：`/api/ranked-seeds/*`
 *
 * ⚠️ 上游是**第三方**服务（谁的上游由 `MCSR_SEED_API_BASE` 决定，地址不写在
 *    版本库里 —— 见 seeds/upstream.ts 的说明）。本文件从头到尾不需要知道它是谁。
 *
 * ===========================================================================
 * 这个模块存在的唯一理由：混合内容（mixed content）
 * ===========================================================================
 * 上游是 **HTTP**，而本站是 **HTTPS**。浏览器**必定**拦掉 https 页面里对 http
 * 的 fetch/XHR —— 不是"可能有问题"，是必然失败，而且报的是 CORS / mixed-content
 * 一类看起来像"上游挂了"或"配置写错了"的错。所以链路只有一种可行形状：
 *
 *     浏览器 → 我们（https）→ 上游（http）   ← 服务器到服务器不受限制
 *
 * 因此这里的定位是**适配**，不是"把上游原样透传"。三件事必须在服务端抹平
 * （实现在 seeds/upstream.ts，那里有每一条的实测依据）：
 *   1. **大小写**：筛选参数要小写（`village`），`seedinfo` 返回大写（`VILLAGE`）
 *      → 对外统一**大写**，发往上游时转小写（见 pickFilter）
 *   2. **被字符串包住的 JSON**：`end_towers` / `variations` 要二次 JSON.parse
 *   3. **错误**：外壳 `{success,message,data}` 只覆盖成功路径；错误一律按
 *      HTTP 状态码归一化成**我们自己的**错误码，上游文案只进服务端日志（Q14）
 * 本文件只负责 HTTP 面：校验、限流、缓存、审计、状态码。
 *
 * 挂载（由 index.ts 做，本文件不自己挂）：
 *     app.route('/api/ranked-seeds', seedsRoute)
 *
 * ---------------------------------------------------------------------------
 * 缓存：随机**绝不**缓存，按 matchId 缓存 1 小时
 * ---------------------------------------------------------------------------
 * · 按 matchId 缓存 1 小时：种子的三个值一旦入库就**永远不会变**（它们描述的是
 *   那场比赛实际生成的世界），所以缓存没有正确性代价；收益是同一个 ID 被反复
 *   点开、被分享链接反复打开时不再打上游。
 * · **随机绝不缓存**。这一条不是权衡，是 bug 与否：缓存了"随机"，用户第一次之后
 *   拿到的永远是同一条种子。而它看起来还很正常 —— 筛选条件不同 key 就不同，
 *   所以"筛选生效了"的假象会一直在，这种 bug 极难被发现。
 * · **404（不在库里）不缓存**：上游只覆盖约 80%，而 `/save` 正是补上剩下那 20%
 *   的入口。缓存"查不到"会让刚补录的那条在接下来一小时里依然查不到 ——
 *   用户会以为保存失败了，然后再录一次（然后拿到"已经录过了"）。
 * · 只做**服务端**缓存：浏览器/反代那层保持 index.ts 默认的 no-store，
 *   这样"查不到 → 补录 → 查得到"的切换是立刻生效的。
 *
 * ---------------------------------------------------------------------------
 * 限流（Q14）
 * ---------------------------------------------------------------------------
 * 上游通常只有一台小机器（实测量级：1 核）。我们这边几百个用户同时点就能把它打挂 ——
 * 代理把"别人的服务"变成了"我们要负责的服务"，所以限流是代理的对价，不是可选项。
 *   · 每 IP 每分钟 20 次 + **全局每秒 5 次**（数字来自 Q14）
 *   · 写接口另有一条**更严**的：每用户每小时 10 次。写坏的是数据，不是速度
 * 全局那条用现有 ratelimit.ts 的 hit() 就够：它的 key 是我们自己给的字符串，
 * 传一个不带 IP 的常量 key 就是全局计数，不必再写一套滑动窗口。
 * （代价：hit 是固定窗口，"每秒 5 次"在窗口边界上最多能过 10 次。这和
 *   ratelimit.ts 文件头写下的取舍一致，对"保护上游"这个目的足够。）
 */

// ⚠️ 从 @mcsr/shared 根导入（index 会把 constants 重新导出），
//    因为 package.json 的 exports 里没有 "./constants" 这一条子路径。
//    routes/calendar.ts 取 SITE 用的也是同一个入口。
import { UPSTREAM_NETHER_FILTERS, UPSTREAM_OVERWORLD_FILTERS } from '@mcsr/shared';
import { isSeedString, normalizeSeedInput } from '@mcsr/shared/seed';
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import { type AuthVariables, requireAuth, requireCapability } from '../auth/middleware';
import { clientIp, hit, keyFor } from '../auth/ratelimit';
import {
  createSeedRecord,
  fetchRandomSeed,
  fetchSeedByMatchId,
  fetchSeedInfo,
  type SeedCreateInput,
  type SeedFilters,
  type SeedInfo,
  type SeedRecord,
  type UpstreamFailureResult,
  upstreamBaseUrl,
} from '../seeds/upstream';
import { writeAudit } from '../users';

export const seedsRoute = new Hono<{ Variables: AuthVariables }>();

type SeedsContext = Context<{ Variables: AuthVariables }>;

// ---------------------------------------------------------------------------
// 词表与下界
// ---------------------------------------------------------------------------

/**
 * 主世界 / 下界结构词表 —— **小写，发往上游的形状**（上游契约 §1.1）。
 *
 * ⚠️ 它们现在是 `packages/shared/constants.ts` 里的常量，不再定义在这里。
 *    这份词表前端也要用（Q17 的两级联动 chip），而**两份词表一定会漂移**，
 *    漂移的表现是"界面上有的选项点了 400" —— 一个只在用户点下去时才出现的错。
 *
 *    shared 那边同时存着大写的 `OVERWORLD_STRUCTURES`（自有库的真实取值），
 *    两者的差别（大小写、上游少一个 jungle_temple）写在常量的注释里，
 *    子集关系有 `constants.test.ts` 守着。
 *
 * ⚠️ 这里列的是"界面可以主动提供的选项"，**不是白名单**。校验只限长度和字符集
 *    （见 checkVariationFilter 与 pickFilter）—— 上游的词条会变，
 *    当白名单用的话，上游每加一种结构我们就先 400 一段时间。
 */

/**
 * matchId 的下界。
 *
 * ⚠️ 两个端点不一样，这不是笔误：种子数据从 2025-11-13 起（ID ≥ 3650001），
 *    而比赛/详细信息能追溯到更早（ID ≥ 100876）。也就是说老比赛**可能有
 *    seedinfo 而没有种子值** —— 拿 /seed 的下界去卡 /seedinfo，
 *    会让一部分明明存在的详细信息查不到。
 */
const MIN_MATCH_ID = 3_650_001;
const MIN_SEEDINFO_MATCH_ID = 100_876;

/** 筛选字符串（variations / without）的长度上限与字符集。见 checkVariationFilter。 */
const FILTER_MAX_CHARS = 512;
const FILTER_CHARSET = /^[a-z0-9_:,-]+$/;

/** completion 的上限，毫秒（24 小时）。见 parseSearchFilters 里的说明。 */
const MAX_COMPLETION_MS = 86_400_000;

// ---------------------------------------------------------------------------
// 缓存
// ---------------------------------------------------------------------------

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

/** key → 结果。**只放成功的结果**（理由见文件头）。 */
const cache = new Map<string, CacheEntry>();

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 1_000;

function cacheGet<T>(key: string, now: number): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

function cacheSet(key: string, value: unknown, now: number): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    /*
     * 上限挡的是"数量"而不是"内容"：每个 matchId 都是合法请求，
     * 所以内存能不能被撑爆只取决于有没有人愿意遍历 ID。
     * 先清过期的；仍然满就按插入顺序丢掉最早的一批（Map 保序）。
     */
    for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k);
    if (cache.size >= CACHE_MAX_ENTRIES) {
      const drop = Math.floor(CACHE_MAX_ENTRIES / 4);
      for (const k of [...cache.keys()].slice(0, drop)) cache.delete(k);
    }
  }
  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
}

/** 仅供测试：清空缓存（模块级 Map 会跨用例存活）。 */
export function clearSeedsCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// 限流
// ---------------------------------------------------------------------------

/**
 * 三条配额。前两条来自 Q14，第三条是 Q15 对写接口的要求。
 *
 * ⚠️ 放在这里而不是 ratelimit.ts 的 LIMITS 里：那个文件是**认证端点**的配额表，
 *    把种子代理的配额塞进去会让"认证限流"这个边界消失，
 *    下一个人就不知道该往哪张表里加东西了。
 */
const SEED_LIMITS = {
  /** 全局：我们打到上游的总速率。上游只有一台 1 核机器，这是给它留的余量。 */
  globalPerSecond: { limit: 5, windowMs: 1_000 },
  queryPerIp: { limit: 20, windowMs: 60_000 },
  savePerUser: { limit: 10, windowMs: 60 * 60 * 1000 },
} as const;

/**
 * 统一的 429。`Retry-After` 是 HTTP 标准字段，前端据此显示"请 N 秒后再试"，
 * 而不是干巴巴一句"请求过于频繁"（同 routes/auth.ts 的做法）。
 */
function rateLimited(c: SeedsContext, retryAfterSec: number) {
  c.header('Retry-After', String(retryAfterSec));
  return c.json({ error: 'rate_limited', retryAfterSec }, 429);
}

/**
 * 打上游之前的那道闸门。**所有**端点都过它，写接口也一样。
 *
 * 全局那条用常量 key：它限的是"我们打到上游的总速率"，与是谁在调无关。
 * 每个请求会**同时**消耗两个配额 —— 被拒的请求也是真的发生过的请求，
 * 不该因为被拒就不计数（否则被限流的人只要一直重试就能把全局配额算少）。
 */
const upstreamGate: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  const global = hit(
    'ranked-seeds|global',
    SEED_LIMITS.globalPerSecond.limit,
    SEED_LIMITS.globalPerSecond.windowMs,
  );
  const perIp = hit(
    keyFor('ranked-seeds', clientIp(c)),
    SEED_LIMITS.queryPerIp.limit,
    SEED_LIMITS.queryPerIp.windowMs,
  );
  if (!global.ok || !perIp.ok) {
    return rateLimited(c, Math.max(global.retryAfterSec, perIp.retryAfterSec));
  }
  await next();
};

/**
 * 上游**没配**时整组端点一起降级：503 `seed_not_configured`。
 *
 * ===========================================================================
 * 为什么这条降级必须有，而且必须是**它自己**的码
 * ===========================================================================
 * `MCSR_SEED_API_BASE` **没有默认值**（见 seeds/upstream.ts 顶上那段）：
 * 上游是第三方的机器，写死一个地址等于让每个照抄本仓的人都把请求打到
 * 别人的服务器上。所以"不配"是一个**正常且预期**的部署状态。
 *
 * 而"不配"必须和一个**临时故障**分开说，因为用户的下一步完全相反：
 *
 *   · 502 `seed_service_unavailable`（上游挂了）→ "过一会儿再试"，**有**下一次
 *   · 503 `seed_not_configured`（本站没配）    → 重试一万次也不会有变化，
 *                                                能做的是去把上游地址配上
 *
 * 复用 502 那条的代价不是"少一句话"，而是**界面明确地说了一件没发生的事**
 * （"这是上游那边的问题"—— 这里根本没有上游）。本仓对这种情况有一条已经
 * 写下来的裁决：`error-codes.test.ts` 里拒绝把 `seed_write_disabled` 复用到
 * 别处的理由（原话是"那个名字说的是种子写入被关了，出现在这条路上等于让日志
 * 说一件没发生的事"）与这里**是同一条**；`platform_not_configured` 也是同一个
 * 形状（"不是你的问题、也不是崩"的第三种回答）。
 *
 * 503 而不是 403 / 500：403 的含义是"你没这个权限"（匿名访客也会拿到它，
 * 那是自相矛盾），500 会被当成崩溃去查堆栈。**不带 Retry-After**：不知道
 * 什么时候会配上，编一个时间等于承诺一件做不到的事（同 seed_write_disabled）。
 *
 * ⚠️ 挂在**所有**端点之前（含 /save），而且用 `.use()` 而不是逐个端点传：
 *    "四个读 + 一个写都要过它"这件事只有一个地方能保证，逐个传迟早漏一个
 *    （漏掉的那个会以"上游不可用"的样子出现，看不出是配置问题）。
 */
let notConfiguredLogged = false;

const requireUpstream: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  if (upstreamBaseUrl() === null) {
    /*
     * ⚠️ 只打**一次**日志，而不是每个请求一行。
     *
     * 这五个端点都是匿名可达的（requireAuth 在后面），所以"每请求一行"
     * 等于把"少配一个环境变量"变成一个刷日志的入口 —— 一条配置疏漏不该
     * 附带一个可被外部放大的副作用。第一行就够运维看见并在 journalctl 里定位。
     *
     * 反过来，**完全不记**是不行的：那样这个功能会静默地消失，而"部署报成功、
     * 功能根本不动"正是本仓反复踩过的那类坑。
     */
    if (!notConfiguredLogged) {
      notConfiguredLogged = true;
      console.warn(
        '[seeds] 未配置 MCSR_SEED_API_BASE —— 种子相关接口整体返回 503 seed_not_configured（这条日志只打一次）',
      );
    }
    return c.json({ error: 'seed_not_configured' }, 503);
  }
  await next();
};

seedsRoute.use(requireUpstream);

/**
 * 写接口的独立配额。
 *
 * 按**用户**计数而不是 IP：写接口的守卫是账号（必须登录 + 邮箱已验证），
 * 换个网络不该重置配额；而 IP 那一道已经由 upstreamGate 盖住了。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 它不是中间件，要在 handler 里、**入参校验通过之后**才调用
 * ---------------------------------------------------------------------------
 * 原来它挂在路由的中间件链上（`saveGate`），也就是跑在解析请求体之前，
 * 于是配额记的是**尝试次数**而不是**写入次数**：
 *
 *   用户把两个种子值填错 10 次 → 被锁整整一小时 → 而库里一条数据都没有。
 *   他能看到的只有 rate_limited 和一句"请 N 秒后再试"，完全不知道
 *   是自己填错了，只会等一小时后再填错一次。
 *
 * 而这条配额**自己的理由**写的是"写坏的是数据，不是速度"（见文件头）——
 * 一个连入参校验都没过的请求写不坏任何数据。记账口径和理由是矛盾的，
 * 矛盾的那一侧是代码。
 *
 * ⚠️ `upstreamGate` 保持挂在最前面不动，那不是同一个问题：它保护的是
 *    **上游**，而被拒的请求确实占用了我们这一侧的入口，注释里
 *    （见 upstreamGate）已经写明"被拒的请求也要计数"的理由。
 */
function saveQuotaFor(userId: string): { retryAfterSec: number } | null {
  const limited = hit(
    keyFor('ranked-seeds-save', userId),
    SEED_LIMITS.savePerUser.limit,
    SEED_LIMITS.savePerUser.windowMs,
  );
  return limited.ok ? null : { retryAfterSec: limited.retryAfterSec };
}

/**
 * 写接口的总开关：**默认关闭**，只有 `MCSR_SEED_WRITE_ENABLED=1` 才打开。
 *
 * ===========================================================================
 * ⚠️★ 这个默认值原来反着来，公开之前必须掰正
 * ===========================================================================
 * 这个端点会往**上游那台机器（别人的数据库）**里插记录，所以正确的默认值
 * 只有"关"一种。原来它叫 `MCSR_SEED_WRITE_DISABLED`，而且单元模板里那行是
 * **注释掉的** —— 也就是说"什么都不做"等于**写入是开的**：
 *
 *   · 一个自建实例的人照文档把 `MCSR_SEED_API_BASE` 指向某个上游之后，
 *     写入路径**立刻**就是通的。他以为自己在用一个只读的种子查询，
 *     实际上已经能往那个库里插数据了；而对面那台机器的主人不会收到任何通知。
 *   · 那正是"上游地址**不再给**默认值"那条改动要防的事，只是换了另一条路径。
 *
 * 所以现在**必须显式**写 `MCSR_SEED_WRITE_ENABLED=1` 才允许写入；生产上
 * 要开，就写进服务器那个 0600 的 env 文件（见 deploy/mcsr-helper-api.service
 * 里那一段说明 —— 手改系统单元会被下一次部署**静默覆盖**）。
 *
 * ---------------------------------------------------------------------------
 * 为什么是"换成正向开关"而不是"把 DISABLED 的默认值反过来"
 * ---------------------------------------------------------------------------
 * 一个名叫 `..._DISABLED` 的变量，缺席时表示"已经禁用"，读起来是双重否定：
 * 下一个人看到 `if (!writeDisabled())` 必须先在脑子里绕一圈。而这种绕圈
 * 在本仓是有代价的 —— `error-codes.test.ts` 里那条"别把一个开关的名字复用到
 * 别处"的裁决说明我们对"名字与事实对不上"这件事是有纪律的：
 * 两个名字相反的开关是同类问题的温床（改一个忘一个，写入就开了）。
 * 所以**一个开关，正向语义**。
 *
 * 紧急关闭的做法与原来完全一样，而且不需要重新打包/上传产物：把它改成 `0`
 * 或直接删掉那一行，然后 `systemctl daemon-reload && systemctl restart`。
 * ⚠️ restart 是必须的：这两个开关都是 `Environment=` 注入的，而 reload
 *    只让 systemd 重读单元文件，进程的环境变量还是旧的。
 */
function writeEnabled(): boolean {
  const raw = (process.env.MCSR_SEED_WRITE_ENABLED ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

// ---------------------------------------------------------------------------
// 响应工具
// ---------------------------------------------------------------------------

/**
 * 400 的统一形状：一个通用 code + 一个**机器可读**的 reason。
 *
 * 前端按 reason 定位到具体控件（是"主世界选错了"还是"种子填错了"），
 * 而这正是我们**不**为每种入参错误单独发明错误码的原因 ——
 * 错误码那一张表（见 error-codes.test.ts）是给"用户能看到的失败结果"用的，
 * 不是给字段级校验用的。
 */
function invalidInput(c: SeedsContext, reason: string, extra: Record<string, unknown> = {}) {
  return c.json({ error: 'invalid_input', reason, ...extra }, 400);
}

/**
 * 把上游的失败归一化成**我们的**错误码。
 *
 * ⚠️ 这里一个字都不带上游的文案（Q14）：
 *   · 它对用户没有意义（说的是上游自己的内部状态），
 *   · 而且它会变 —— 前端一旦开始依赖它就永远甩不掉。
 * 真正的细节（上游的 HTTP 状态 + 原文片段）已经在 seeds/upstream.ts 里
 * console.error 过了，那里才有上下文。
 */
function upstreamFailed(c: SeedsContext, failure: UpstreamFailureResult) {
  switch (failure.kind) {
    case 'not_found':
      // 不是"错误"：上游只覆盖约 80%，查不到是常态。界面要按"这条不在库里"
      // 来显示（§3），所以它必须是**独立的**错误码，不能混进"出错了"。
      return c.json({ error: 'seed_not_found' }, 404);
    case 'empty':
      /*
       * 筛选条件没有命中任何一条 —— 也是常态，而且和上一条的下一步**不同**：
       *   · not_found → "这条比赛不在库里"，出路是补录（Q15 的 /save）
       *   · empty     → "条件太窄了"，出路是放宽条件
       * 所以复用同一个错误码（seed_not_found）但带上一个区分字段，
       * 让界面能选对那句话和那个按钮。
       *
       * ⚠️ 修之前这一支落到 `rejected` → 500 internal_error，
       *    也就是"用户叠窄了条件"被报成"服务器出错了"。见 upstream.ts 里
       *    对 UpstreamFailure 的说明。
       */
      return c.json({ error: 'seed_not_found', reason: 'no_match' }, 404);
    case 'conflict':
      // 上游说这条 matchId 已经有了。这是用户能自己处理的结果，别让他重试。
      return c.json({ error: 'seed_exists' }, 409);
    case 'rejected':
      // 上游说我们的请求本身不对 = 我们的适配层和上游脱节了（细节在日志里）。
      // 归 500 而不是"上游挂了"：这两件事的排查方向完全相反。
      return c.json({ error: 'internal_error' }, 500);
    default:
      // 超时 / 不可达 / 5xx / 上游限流：一句话，且**不承诺恢复时间**。
      /*
       * 用 502 而不是 503：503 会被理解成"我们自己正在维护"，
       * 而这里的事实是"我们的上游坏了"。也不用 504 —— 区分 502/504 对用户
       * 没有任何意义（他要做的都是"等一会儿再试"），而日志里有区分。
       */
      return c.json({ error: 'seed_service_unavailable' }, 502);
  }
}

/** 拼缓存 key。两个端点分开存，因为它们的下界和形状都不同。 */
function cacheKey(kind: string, matchId: number): string {
  return `${kind}:${String(matchId)}`;
}

// ---------------------------------------------------------------------------
// 入参校验
// ---------------------------------------------------------------------------

type Invalid = { ok: false; reason: string; extra?: Record<string, unknown> };

/**
 * matchId 解析。
 *
 * ⚠️ 先用正则确定**形状**再 Number()，绝不对任意字符串 parseInt：
 *    `'3650001abc'` / `'3.6e6'` / `'+3650001'` / `' 3650001 '` 在这里全是 400。
 *    parseInt 会把它们解释成某个数字，而那个数字对应的是**另一场比赛** ——
 *    用户会拿到一条别人的种子，而且看不出任何异常。
 */
function parseMatchId(raw: string, min: number): number | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min ? value : null;
}

/** 请求体里的 matchId（JSON 里可能是 number，也可能是字符串）。 */
function parseMatchIdValue(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) && raw >= MIN_MATCH_ID ? raw : null;
  }
  if (typeof raw === 'string') return parseMatchId(raw.trim(), MIN_MATCH_ID);
  return null;
}

/**
 * 白名单取值。**大小写不敏感**（我们对外是大写、上游要小写，两种写法都得接住），
 * 但返回值一定是**小写** —— 那是发往上游的形状。
 */
function pickFilter(raw: string, allowed: readonly string[]): string | null {
  const value = raw.trim().toLowerCase();
  return allowed.includes(value) ? value : null;
}

/**
 * variations / without 的校验 —— ⚠️ **不做词条白名单**。
 *
 * 为什么不加白名单（Q17）：上游的词条会随版本变（实测 seedinfo 里就有
 * `end_spawn:buried:56` 这种），我们加一份白名单意味着**上游新增的词条在我们
 * 这里默认不可用**，而且失败形式是 400 —— 界面上就是"这个选项点了没反应"。
 * 所以放行未知词条，只做两件"防注入"的事：
 *   · 长度上限（512 字符）—— 堵住"有人拿这个参数传一兆字节"
 *   · 字符集限制（小写字母/数字/下划线/冒号/逗号/连字符）—— 词条的语法就是这些，
 *     所以任何越界字符都不是"词条没收录"，而是**有人在拿它做别的事**
 * 另有一条明确的排除：`end_spawn:*`（见下）。
 *
 * ⚠️ 参数值**原样转发**，不做大小写转换。所以大写词条会在字符集这一步被 400 拒掉。
 *    这比"静默转发、上游匹配不上、界面显示 0 条"好：后者看起来像
 *    "库里没有这种种子"，而真相是我们发上去的东西上游根本不认识。
 */
function checkVariationFilter(raw: string): { ok: true; value: string } | Invalid {
  const value = raw.trim();
  if (value.length > FILTER_MAX_CHARS) return { ok: false, reason: 'filter_too_long' };
  if (!FILTER_CHARSET.test(value)) return { ok: false, reason: 'filter_bad_chars' };

  for (const entry of value.split(',')) {
    /*
     * `end_spawn:*` 上游有 bug（用户 2026-09-12 指出，见 §7），所以整条拒绝，
     * 而不是"忽略它继续查"。
     * ⚠️ 忽略等于我们用**别的**条件替用户做了一个他没要的查询，而他以为
     *    "排除掉 end_spawn 之后还剩这些" —— 一个静默错误的答案比一个 400 糟得多。
     * （字符集已经保证这里全是小写，所以不必再 toLowerCase 一遍。）
     */
    if (entry.startsWith('end_spawn')) return { ok: false, reason: 'end_spawn_unsupported' };
  }

  return { ok: true, value };
}

type ParsedFilters = { ok: true; filters: SeedFilters } | Invalid;

/** 解析 /search 的筛选参数。空串一律当"没给"。 */
function parseSearchFilters(c: SeedsContext): ParsedFilters {
  const filters: SeedFilters = {};

  const overworld = c.req.query('overworld');
  if (overworld !== undefined && overworld !== '') {
    const value = pickFilter(overworld, UPSTREAM_OVERWORLD_FILTERS);
    if (value === null) {
      // allowed 用**大写**回给调用方：那才是我们对外统一的形状
      return {
        ok: false,
        reason: 'bad_overworld',
        extra: { allowed: UPSTREAM_OVERWORLD_FILTERS.map((t) => t.toUpperCase()) },
      };
    }
    filters.overworld = value;
  }

  const nether = c.req.query('nether');
  if (nether !== undefined && nether !== '') {
    const value = pickFilter(nether, UPSTREAM_NETHER_FILTERS);
    if (value === null) {
      return {
        ok: false,
        reason: 'bad_nether',
        extra: { allowed: UPSTREAM_NETHER_FILTERS.map((t) => t.toUpperCase()) },
      };
    }
    filters.nether = value;
  }

  for (const name of ['variations', 'without'] as const) {
    const raw = c.req.query(name);
    if (raw === undefined || raw === '') continue;
    const checked = checkVariationFilter(raw);
    if (!checked.ok) return { ...checked, extra: { param: name, ...checked.extra } };
    filters[name] = checked.value;
  }

  const completion = c.req.query('completion');
  if (completion !== undefined && completion !== '') {
    const text = completion.trim();
    // 毫秒整数。上限 24 小时是个**理智边界**而不是业务规则：
    // 一场 MC 速通不可能超过一天，而放行任意大的数字只是白送一个
    // "让上游去扫全表"的口子。
    if (!/^\d{1,9}$/.test(text)) return { ok: false, reason: 'bad_completion' };
    const ms = Number(text);
    if (ms <= 0 || ms > MAX_COMPLETION_MS) {
      return { ok: false, reason: 'bad_completion', extra: { maxMs: MAX_COMPLETION_MS } };
    }
    filters.completion = ms;
  }

  return { ok: true, filters };
}

/**
 * /random 会拒绝的筛选参数。
 *
 * /random 与 /search 的分工（上游只有一个端点，我们拆成两个是给调用方的语义）：
 *   /random = 无条件随机；/search = 带筛选的随机。
 *
 * ⚠️ /random **拒绝**筛选参数而不是"忽略它们"：一个带着筛选去调 /random 的调用方
 *    （多半是前端把两条路径接混了）如果被静默忽略，界面会把一条**不符合条件**的
 *    种子当成结果展示 —— 而"结果不符合条件"是用户看得见、我们看不见的那类 bug。
 *    400 会立刻让它暴露，并且告诉他该用哪个端点。
 */
const RANDOM_REJECTED_PARAMS = ['overworld', 'nether', 'variations', 'without', 'completion'];

type ParsedSave = { ok: true; value: SeedCreateInput } | Invalid;

/**
 * /save 的请求体校验。
 *
 * ⚠️ 三个种子值是整个接口里最危险的一段入参，校验与规范化都集中在
 *    requireSeedString 里（判据是 shared/seed.ts 的 isSeedString，64 位整数），
 *    **绝不 parseInt / Number**：见那个文件的文件头 ——
 *    `Number('7304888896886165976')` 不报错，只是静默地给出一个错的种子，
 *    而玩家拿去开世界时才发现，那时已经无从知道是哪一层截断的。
 * ⚠️ **数字形态也拒绝**。一个 JSON number 走到我们这里时，精度可能已经在
 *    **调用方**丢掉了，我们无从判断 —— 只收字符串，"尽力而为"才是这里最危险的反应。
 */
function parseSaveInput(body: unknown): ParsedSave {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, reason: 'body_not_object' };
  }
  const raw = body as Record<string, unknown>;

  const matchId = parseMatchIdValue(raw.matchId);
  if (matchId === null) return { ok: false, reason: 'bad_match_id', extra: { min: MIN_MATCH_ID } };

  const overworldSeed = requireSeedString(raw.overworldSeed);
  if (overworldSeed === null) return { ok: false, reason: 'bad_overworld_seed' };

  const netherSeed = requireSeedString(raw.netherSeed);
  if (netherSeed === null) return { ok: false, reason: 'bad_nether_seed' };

  // theEndSeed 可选：缺省 / null / 空串（含只有空格）都当"没给"
  let theEndSeed: string | null = null;
  const endRaw = raw.theEndSeed;
  if (typeof endRaw === 'string' && endRaw.trim() === '') {
    theEndSeed = null;
  } else if (endRaw !== undefined && endRaw !== null) {
    theEndSeed = requireSeedString(endRaw);
    if (theEndSeed === null) return { ok: false, reason: 'bad_the_end_seed' };
  }

  const matchDate = parseMatchDate(raw.matchDate);
  if (!matchDate.ok) return { ok: false, reason: 'bad_match_date' };

  return {
    ok: true,
    value: { matchId, overworldSeed, netherSeed, theEndSeed, matchDate: matchDate.value },
  };
}

/**
 * 校验 + 规范化一个种子值。
 *
 * 只有**字符串**才可能合法（数字形态在调用方就被拒了，见 parseSaveInput）。
 * 规范化走 shared 的 normalizeSeedInput（去空格 / 去 `+` 前缀 / 去多余前导零）——
 * 用户从聊天窗口里复制种子时几乎一定带空格，而那不该变成一个 400。
 *
 * ⚠️ 判据仍然是 shared 的 isSeedString（normalizeSeedInput 内部用的就是它），
 *    这里对它再跑一遍不是多余：那是"**要发往上游的那个值**必须通过校验"的
 *    最后一道断言，而不是把清理逻辑抄成第二份（两套正则一定漂移，
 *    而种子这种"错了也不报错"的东西上漂移的代价极大）。
 */
function requireSeedString(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let normalized: string;
  try {
    normalized = normalizeSeedInput(raw);
  } catch {
    // normalizeSeedInput 对非法输入抛错（见 shared/seed.ts）——这里把它变成"不合法"
    return null;
  }
  return isSeedString(normalized) ? normalized : null;
}

/**
 * matchDate：可选，展示用。
 *
 * ⚠️ 上游的 schema 说它是**字符串**，而它自己的 GET 返回的是**数字毫秒**
 *    （实测 `/seed/3650001` → `matchDate: 1762982331457`，见 upstream.ts
 *    不一致之五）。所以两种都收下，转发时统一成字符串（按 schema 走）。
 * 校验从宽（它不是种子的一部分），但**仍然要有**长度与字符集上限：
 * 这个值会原样进用户自己的数据库。
 */
function parseMatchDate(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw) || raw <= 0) return { ok: false };
    return { ok: true, value: String(raw) };
  }
  if (typeof raw !== 'string') return { ok: false };

  const value = raw.trim();
  if (value === '') return { ok: true, value: null };
  // 只允许 ISO-8601 或毫秒数字符串里会出现的那几个字符
  if (value.length > 32 || !/^[0-9T:.Z+-]+$/.test(value)) return { ok: false };
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// 读接口
// ---------------------------------------------------------------------------

/** 条件随机的公共部分：/random 与 /search 只差"要不要解析筛选参数"。 */
async function randomResponse(c: SeedsContext, filters: SeedFilters) {
  const result = await fetchRandomSeed(filters);
  if (!result.ok) return upstreamFailed(c, result);

  /*
   * ★ 随机**绝不**缓存，也不允许任何一层缓存它。
   *
   * index.ts 对 /api/* 的默认就是 no-store，这里再显式写一遍是因为
   * "随机"这个语义**依赖**它：哪天有人为了别的端点放开一条缓存规则，
   * 这一条必须能自己站住，而不是靠默认值。
   */
  c.header('Cache-Control', 'no-store');
  return c.json({
    seed: { ...result.data.seed },
    availableCounts: result.data.availableCounts,
  });
}

/** 随机一条（无条件）。 */
seedsRoute.get('/random', upstreamGate, async (c) => {
  for (const name of RANDOM_REJECTED_PARAMS) {
    if (c.req.query(name) !== undefined) {
      return invalidInput(c, 'use_search_endpoint', { param: name, use: '/search' });
    }
  }
  return randomResponse(c, {});
});

/** 随机一条**满足条件**的。 */
seedsRoute.get('/search', upstreamGate, async (c) => {
  const parsed = parseSearchFilters(c);
  if (!parsed.ok) return invalidInput(c, parsed.reason, parsed.extra ?? {});
  return randomResponse(c, parsed.filters);
});

/** 按比赛 ID 取三个世界的种子值。**这一条会缓存 1 小时**。 */
seedsRoute.get('/match/:matchId', upstreamGate, async (c) => {
  const matchId = parseMatchId(c.req.param('matchId'), MIN_MATCH_ID);
  if (matchId === null) return invalidInput(c, 'bad_match_id', { min: MIN_MATCH_ID });

  const now = Date.now();
  const key = cacheKey('seed', matchId);
  const cached = cacheGet<SeedRecord>(key, now);
  if (cached) return c.json({ seed: { ...cached }, cached: true });

  const result = await fetchSeedByMatchId(matchId);
  if (!result.ok) return upstreamFailed(c, result);

  cacheSet(key, result.data, now);
  // cached 这个字段是给**我们**看的：它让"缓存到底有没有生效"在接口上直接可见，
  // 而不必去翻上游日志。前端可以忽略它。
  return c.json({ seed: { ...result.data }, cached: false });
});

/** 按比赛 ID 取详细信息（结构 + 变种）。同样缓存 1 小时。 */
seedsRoute.get('/match/:matchId/info', upstreamGate, async (c) => {
  // ⚠️ 下界和 /match/:matchId 不同（100876 < 3650001），理由见常量处的说明
  const matchId = parseMatchId(c.req.param('matchId'), MIN_SEEDINFO_MATCH_ID);
  if (matchId === null) return invalidInput(c, 'bad_match_id', { min: MIN_SEEDINFO_MATCH_ID });

  const now = Date.now();
  const key = cacheKey('info', matchId);
  const cached = cacheGet<SeedInfo>(key, now);
  if (cached) return c.json({ info: { ...cached }, cached: true });

  const result = await fetchSeedInfo(matchId);
  if (!result.ok) return upstreamFailed(c, result);

  cacheSet(key, result.data, now);
  return c.json({ info: { ...result.data }, cached: false });
});

// ---------------------------------------------------------------------------
// 写接口
// ---------------------------------------------------------------------------

/**
 * 把一条比赛记录录进上游的数据库。
 *
 * 用户决定暂时暴露它（Q15：「以便用户在客户端内保存种子」），而它正是上游
 * 那 20% 覆盖率之外的补录入口 —— 补录需要真人。但暴露写接口**必须**有守卫：
 *
 *   0. **上游已经配好**（requireUpstream，挂在整组端点前）：写接口也一样，
 *      没配上游时它拿 503 `seed_not_configured`，而不是一个"上游不可用"的故事
 *   1. **总开关**在最前：写入**默认关闭**，必须显式开（见 writeEnabled）；
 *      kill switch 的意义是"这条写入路径立刻彻底停掉"，所以连认证/审计
 *      这些没必要的事都不做
 *   2. **登录 + `seed.submit` 能力**：匿名用户绝不能写。用能力矩阵而不是
 *      裸的 requireVerified —— 理由见下面那段（这条原来是个真的缺口）
 *   3. **比查询严得多的独立配额**：写坏的是数据，不是速度。而且它记的是
 *      **写入次数**，不是尝试次数（见 saveQuotaFor）
 *   4. **每次成功写入记审计**：审计里要有**是谁**通过我们站点写进去的 ——
 *      上游不知道这件事，只有我们知道。同时记下写进去的三个值，
 *      否则一条 seed.create 记录将来只能证明"这个人点过保存"
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 第 2 条原来写的是 `requireAuth, requireVerified` —— 那是个真的缺口
 * ---------------------------------------------------------------------------
 * `seed.submit` 这个能力在 `shared/permissions.ts` 里定义了、发给 user 了、
 * 也列进了 `REQUIRES_VERIFIED`，但**全仓没有任何一条路由检查它**。
 * 也就是说：把 `seed.submit` 从某个角色上摘掉，这个写接口照样能写。
 *
 * 这不会造成越权（能写的人还是同一批），但它让权限矩阵里的那个开关变成了
 * 摆设 —— 而矩阵存在的全部意义就是"谁能在什么上做什么只有一处定义"。
 * 写接口是这里面后果最重的一个：它会往**用户自己的生产库**里插记录。
 *
 * `requireCapability` 自己就会返回 401 / 403 forbidden / 403 email_not_verified
 * 三种形状（`seed.submit` 在 REQUIRES_VERIFIED 里），所以换过来之后
 * 对外行为与之前**逐字节相同**。
 */
seedsRoute.post(
  '/save',
  async (c, next) => {
    /*
     * ⚠️ 503 而不是 403。
     *
     * 403 的含义是"你没这个权限"，而事实是"运维没把这个功能打开"。
     * 这个开关**刻意放在认证之前**（那是好设计：一条命令就能彻底停掉写入，
     * 不必等任何人登录失败），代价就是**包括匿名访客在内**的所有人都会拿到
     * 这个响应 —— 而前端为它准备的文案写的是"那是我们这边的事，不是你的问题"。
     * 一个"不是你的问题"的回复配上 403，是自相矛盾的。
     *
     * 不带 Retry-After：我们**不知道**什么时候会打开，编一个时间
     * 等于承诺一件做不到的事（同 requireUpstream 的 503）。
     *
     * ⚠️ 这条与 requireUpstream 的 503 是**两件事**，顺序也因此是行为：
     *    没配上游时整组端点先拿 `seed_not_configured`（更根本的状态），
     *    配了上游而写入没开时才轮到这条 `seed_write_disabled`。
     */
    if (!writeEnabled()) return c.json({ error: 'seed_write_disabled' }, 503);
    await next();
  },
  upstreamGate,
  requireAuth,
  requireCapability('seed.submit'),
  async (c) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'unauthorized' }, 401);

    const body = await c.req.json().catch(() => null);
    const input = parseSaveInput(body);
    if (!input.ok) return invalidInput(c, input.reason, input.extra ?? {});

    /*
     * ⚠️ 配额在**校验之后**才记账（见 saveQuotaFor 的注释）。
     *    到这里为止，请求的形状已经是合法的了。
     */
    const quota = saveQuotaFor(user.id);
    if (quota) return rateLimited(c, quota.retryAfterSec);

    const result = await createSeedRecord(input.value);
    // 上游没写成功 → 什么都不记（审计记的是"写进去过什么"，不是"试图写什么"）
    if (!result.ok) return upstreamFailed(c, result);

    writeAudit({
      actorId: user.id,
      action: 'seed.create',
      entityType: 'seed_record',
      entityId: String(input.value.matchId),
      reason: [
        `matchId=${String(input.value.matchId)}`,
        `overworldSeed=${input.value.overworldSeed}`,
        `netherSeed=${input.value.netherSeed}`,
        `theEndSeed=${input.value.theEndSeed ?? '(未提供)'}`,
      ].join(' '),
      ip: clientIp(c),
      now: Date.now(),
    });

    return c.json(
      {
        ok: true,
        matchId: input.value.matchId,
        record: result.data ? { ...result.data } : null,
      },
      // 201：确实**创建**了一条记录（和 routes/uploads.ts 一致）。
      // 不照抄上游的 200 是因为这个响应表达的是我们自己的语义。
      201,
    );
  },
);
