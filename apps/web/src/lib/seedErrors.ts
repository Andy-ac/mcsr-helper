/**
 * Ranked Seeds 的失败 → **精确到某个控件**的一句话。
 *
 * ---------------------------------------------------------------------------
 * 这个文件存在的理由：种子表单有六个字段，把红字全堆在底部等于让用户自己找
 * ---------------------------------------------------------------------------
 * `/api/ranked-seeds/*` 的入参错误走的是 `{ error: 'invalid_input', reason: '...' }`：
 * 一个通用错误码 + 一个**机器可读**的 reason（见 `services/api/src/routes/seeds.ts`
 * 的 `invalidInput`）。服务端刻意没有为十五种入参错误各发明一个错误码 ——
 * 那会让 `KNOWN_CODES` 变成一份没人看得完的清单。
 *
 * 代价落在前端：**必须按 reason 分派**，不能按 code。`invalid_input` 这一个 code
 * 下面挂着十四种完全不同的原因，"主世界选错了"和"末地种子填错了"要出现在
 * 两个不同的控件下面。
 *
 * ---------------------------------------------------------------------------
 * ⚠️⚠️ 而这条路现在**是断的** —— 请读这一节再读下面的代码
 * ---------------------------------------------------------------------------
 * 服务端确实返回了 reason，但前端**拿不到**：
 *
 *   · `sendJson`（lib/api.ts）把响应体读成了 `ErrorPayload`，而那份接口里
 *     没有 `reason`，也没有 `min` / `allowed` / `maxMs` / `param` / `use`
 *   · `ApiError` 的构造器只接收 (message, status, code, retryAfterSec, issues, existing*)
 *
 * 所以 `apiReason()` 现在**永远返回 null**。这不是我的推断，是读出来的：
 * 两处都在 `lib/api.ts`，而那个文件不归我改。
 *
 * 下面的处理方式因此是：
 *   1. **不假装**能推断出 reason —— 拿不到时如实说"服务端说有一个字段不合法，
 *      但我们没拿到是哪一个"（`seedsPage.saveErrUnknownField`），而不是编一个
 *      看起来合理但可能指向**错误的输入框**的红字。指错输入框比不指更糟：
 *      用户会去改一个本来就填对的字段。
 *   2. 整套映射**写好并保持完整**，等 `lib/api.ts` 把 reason 接上（一行的事）
 *      就立刻生效，不需要再动这里的任何代码。
 *   3. 表单**先自己校验一遍**（`isSeedString` / `normalizeSeedInput` /
 *      和正则同形的 matchId 判断），让绝大多数 400 根本不会被发出去 ——
 *      那才是当下真正在起作用的那一道防线，而不是这里的映射。
 *
 * 这样做还有一个好处：`SEED_REASONS` 加一个新 reason 时，类型会逼着这个文件
 * 跟上（下面两张表是 `Record<联合类型, …>`，漏一个就编译不过）。
 * 服务端那条契约是单向的（它只守服务端 → 清单），这里补上了反方向的一半。
 */
import { ApiError } from '@/lib/api';

type Translate = (key: string, options?: Record<string, unknown>) => string;

// ---------------------------------------------------------------------------
// 下界：和 services/api/src/routes/seeds.ts 里的两个常量**同值**
// ---------------------------------------------------------------------------

/**
 * 种子值的 matchId 下界（种子数据从 2025-11-13 起）。
 *
 * ⚠️ 这两个数字在服务端是常量，前端这里是**第二份**，因为它要用来做
 *    输入提示和提前校验（不能等用户点了"查询"才告诉他下界是多少）。
 *
 *    服务端的 400 **会**带一个 `min` 字段，本来是让前端不用抄这份数字的 ——
 *    但那个字段目前传不到前端（见文件头）。所以：
 *      · `bad_match_id` 的文案优先用 `apiExtra(error, 'min')`（接上以后自动生效）；
 *      · 接不上时才回退到这里的数字。
 *    两处不一致的风险由"它们只在服务端被改过"这一点兜着 —— 真要改，
 *    改的是服务端那两个常量，而 400 的文案会立刻跟着变（它读的是 min）。
 */
export const MIN_MATCH_ID = 3_650_001;

/**
 * 详细信息（结构与变种）的 matchId 下界 —— **比上面低**。
 *
 * ⚠️ 两个端点不一样不是笔误：老比赛可能只有 info 而没有种子值。
 *    拿种子值的下界去卡 info，会让一部分明明存在的详细信息查不到。
 */
export const MIN_SEEDINFO_MATCH_ID = 100_876;

// ---------------------------------------------------------------------------
// 服务端的机器可读字段（目前取不到，见文件头）
// ---------------------------------------------------------------------------

/**
 * 读 `ApiError` 上服务端给的 `reason`。
 *
 * ⚠️ 取不到时返回 null，**不要**把它当成"未知原因"以外的任何东西 ——
 *    调用方必须走"我们没拿到"的那条路。
 */
export function apiReason(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const reason = (error as ApiError & { reason?: unknown }).reason;
  return typeof reason === 'string' ? reason : null;
}

/** 读 400 里附带的结构化字段（`min` / `allowed` / `maxMs` / `param` / `use`）。 */
export function apiExtra<T = unknown>(error: unknown, key: string): T | null {
  if (!(error instanceof ApiError)) return null;
  const value = (error as ApiError & Record<string, unknown>)[key];
  return value === undefined || value === null ? null : (value as T);
}

// ---------------------------------------------------------------------------
// reason 词表 —— 与 services/api/src/error-codes.test.ts 的 SEED_REASONS 对应
// ---------------------------------------------------------------------------

/**
 * ⚠️ 下面两个联合**必须合起来等于 `SEED_REASONS`**（多一个 `no_match`，
 *    它跟着 `seed_not_found` 走，不在这里的表里）。
 *
 * 服务端那边的契约是单向的：`error-codes.test.ts` 只守"源码扫出来的
 * reason ⊆ SEED_REASONS"。前端这一侧本来完全不在它的覆盖范围里 ——
 * 而这正是那个 bug（服务端 `url_exists` vs 前端 `duplicate_url`）
 * 往下沉一层之后的样子。
 *
 * 这里能补上的那一半是：两张表都写成 `Record<联合, …>`，于是
 * **漏写一个成员就编译不过**。服务端加 reason → 那边测试红 →
 * 有人来改这里 → 这里逼他当场决定红字放哪。中间断掉的那一环只有
 * "服务端加了我们没同步"这一种情况，而它已经被那边的测试拦住了。
 *
 * ⚠️ 写成显式联合而不是 `Exclude<…>`：这两组**不是**互补的
 *    （`bad_match_id` 两边都有），而"哪条路由能产生哪些 reason"是要照着
 *    `routes/seeds.ts` 读出来的事实，不该藏在一层类型运算里。
 */

/** `/random` 与 `/search` 会吐出来的 reason。 */
type QueryReason =
  | 'filter_too_long'
  | 'filter_bad_chars'
  | 'end_spawn_unsupported'
  | 'bad_overworld'
  | 'bad_nether'
  | 'bad_completion'
  | 'use_search_endpoint'
  | 'bad_match_id';

/** `/save` 会吐出来的 reason。 */
type SaveReason =
  | 'bad_match_id'
  | 'bad_overworld_seed'
  | 'bad_nether_seed'
  | 'bad_the_end_seed'
  | 'bad_match_date'
  | 'body_not_object';

/** 筛选面板上的控件名。`matchId` 属于"按 ID 查"那一块。 */
export type SeedFilterField = 'overworld' | 'nether' | 'variations' | 'completion';
export type SeedQueryField = SeedFilterField | 'matchId';

/** 补录表单上的控件名。 */
export type SeedSaveField = 'matchId' | 'overworldSeed' | 'netherSeed' | 'theEndSeed' | 'matchDate';

/**
 * 一个 reason 应该被显示在哪。
 *
 * ⚠️ 用**显式判别字段** `kind`，而不是靠 `'field' in target` 去窄化：
 *    后者在 tsgo（本仓用的是 TypeScript 7）下会把 `target.field` 窄化成
 *    `unknown`，于是 `fieldErrors[target.field]` 直接编译不过
 *    （TS2538：unknown 不能当索引）。
 *    写成一个判别联合同时也更好读 —— 一眼看得出"这条要么指控件、要么指整张表单"。
 */
type ReasonTarget<F extends string> =
  | { kind: 'field'; field: F; key: string }
  | { kind: 'form'; key: string };

/**
 * 400 `invalid_input` 的 reason → 红字该出现在哪个控件下面。
 *
 * ⚠️ 这张表是**穷尽**的（`Record<QueryReason, …>`）：
 *    SEED_REASONS 加一条而这里不加，类型检查就红。
 */
const QUERY_REASON_TARGET: Record<QueryReason, ReasonTarget<SeedQueryField>> = {
  // ---- 变种词条。三个原因都落在同一块控件上，因为它们说的是同一个字符串 ----
  filter_too_long: { kind: 'field', field: 'variations', key: 'seedsPage.errFilterTooLong' },
  filter_bad_chars: { kind: 'field', field: 'variations', key: 'seedsPage.errFilterBadChars' },
  /*
   * ⚠️ 这一条**只可能由手写的 URL 触发**（词条里根本不会出现 end_spawn，
   *    见 shared/seed.ts 的 isUnsupportedVariationFilter）。但文案仍要说清
   *    "它存在于结果里，只是不能拿来筛" —— 那句话是给好奇的人看的。
   */
  end_spawn_unsupported: {
    kind: 'field',
    field: 'variations',
    key: 'seedsPage.errEndSpawnUnsupported',
  },

  bad_overworld: { kind: 'field', field: 'overworld', key: 'seedsPage.errBadOverworld' },
  bad_nether: { kind: 'field', field: 'nether', key: 'seedsPage.errBadNether' },
  bad_completion: { kind: 'field', field: 'completion', key: 'seedsPage.errBadCompletion' },

  /*
   * ⚠️ 这一条**没有控件可以指**，因为它是"界面把筛选参数发到了 /random"。
   *    它一旦出现就说明是我们接错了端点 —— 所以它必须显示成一句
   *    「这是我们的问题」，而不是掉进"服务出错了"的兜底文案里
   *    （那会让一个真 bug 看起来像上游抖动，多活很久）。
   */
  use_search_endpoint: { kind: 'form', key: 'seedsPage.errUseSearchEndpoint' },

  bad_match_id: { kind: 'field', field: 'matchId', key: 'seedsPage.errMatchIdFormat' },
};

/** 补录表单的同一张表。 */
const SAVE_REASON_TARGET: Record<SaveReason, ReasonTarget<SeedSaveField>> = {
  bad_match_id: { kind: 'field', field: 'matchId', key: 'seedsPage.saveErrMatchId' },
  bad_overworld_seed: {
    kind: 'field',
    field: 'overworldSeed',
    key: 'seedsPage.saveErrOverworldSeed',
  },
  bad_nether_seed: { kind: 'field', field: 'netherSeed', key: 'seedsPage.saveErrNetherSeed' },
  bad_the_end_seed: { kind: 'field', field: 'theEndSeed', key: 'seedsPage.saveErrTheEndSeed' },
  bad_match_date: { kind: 'field', field: 'matchDate', key: 'seedsPage.saveErrMatchDate' },

  /*
   * 请求体不是一个对象 —— 只可能来自我们自己的 bug（用户填不出这种东西）。
   * 同样不给它指任何一个输入框：指错了用户会去改一个本来就对的字段。
   */
  body_not_object: { kind: 'form', key: 'seedsPage.saveErrBody' },
};

/**
 * 前端**已经映射到具体控件**的全部 reason —— 从上面两张表推导出来，
 * 所以不可能和它们漂移。
 *
 * ⚠️ 它现在的用途是"给人看 + 给将来的测试一个抓手"：`SEED_REASONS` 那一侧
 *    已经有一条跨层断言，而**前端这一侧没有**（要写它就得让
 *    `services/api` 的测试去读 `apps/web` 的文件，那条路目前不存在）。
 *    有人要补那条断言时，扫的就是这个名字，不需要再手工数一遍。
 *    导出它也是为了让 biome 的"未使用变量"不把它当成死代码删掉。
 */
export const MAPPED_SEED_REASONS: readonly string[] = [
  ...Object.keys(QUERY_REASON_TARGET),
  ...Object.keys(SAVE_REASON_TARGET),
  /**
   * ⚠️ `no_match` 不在这两张表里，因为它**不是**入参校验失败：
   *    它跟着 404 `seed_not_found` 走，由 `describeSeedQueryError` 的
   *    code 分支处理（那一条决定的是"放宽条件"而不是"红字放哪"）。
   */
  'no_match',
];

// ---------------------------------------------------------------------------
// 查询（/random、/search、/match/:matchId）
// ---------------------------------------------------------------------------

/**
 * 失败的性质。**界面靠它选下一步**，所以它不是分类学，而是真正不同的出路：
 *   · `not_found`  → 这场比赛不在上游（约 20%）→ **补录**（Q15）
 *   · `no_match`   → 条件太窄                  → **放宽条件**
 *   · `unavailable`/`rate_limited` → 等一会儿  → 重试
 *   · `not_configured` → 本站**没配上游**       → 重试没用，要有人去配（见下）
 */
export type SeedQueryFailureKind =
  | 'not_found'
  | 'no_match'
  | 'unavailable'
  | 'rate_limited'
  | 'not_configured'
  | 'field'
  | 'other';

export interface SeedQueryFailure {
  kind: SeedQueryFailureKind;
  message: string;
  hint?: string;
  /** 逐控件的红字（已经翻译好）。 */
  fieldErrors?: Partial<Record<SeedQueryField, string>>;
  /** 「请 N 秒后再试」里的 N。 */
  retryAfterSec?: number;
}

/**
 * 把查询类失败翻译成界面能用的结构。
 *
 * `context` 决定 404 怎么读：同一个 `seed_not_found`，在"按 ID 查"里是
 * "这场比赛不在库里"，在检索里则意味着上游对一个随机请求说了 not found
 * （罕见，且不是用户能处理的）。两者都**不是错误**，但不该说同一句话。
 *
 * `fallbackMin` 是"读不到服务端的 `min` 时显示哪条下界"：
 * 查种子值和查结构与变种的下界不同（3650001 / 100876），
 * 而调用方才知道自己刚才打的是哪个端点。
 */
export function describeSeedQueryError(
  error: unknown,
  t: Translate,
  fallback: (error: unknown) => string,
  context: 'search' | 'lookup',
  fallbackMin: number = MIN_MATCH_ID,
): SeedQueryFailure {
  if (!(error instanceof ApiError)) return { kind: 'other', message: fallback(error) };

  /*
   * ★★ 判据：**先看信封里的码，取不到时按状态码补一句 404**（2026-09-19 第四轮加）。
   *
   * ---------------------------------------------------------------------------
   * ⚠️★ 为什么必须有那一半：`error.code` 在这些端点上**恒为 undefined**
   * ---------------------------------------------------------------------------
   * `fetchSeedByMatchId` 走的是 `lib/api.ts` 的 `request()` ⇒ `requestCore(…, readErrorCode)`
   * 传的是 `false`，而那一行写着"唯一的差额。不读体的那一路**连读体的调用都不发生**"
   * （`api.ts:310`）⇒ **所有 GET** 的 `ApiError.code` 都是 `undefined`。
   * 于是这一整张 `switch` 里的每一个 case 都只在 **POST**（`sendJson` 会读体）上打得中，
   * 而"这场比赛不在种子库里"（404 `seed_not_found`，约 20% 的比赛）落到 `default:`，
   * 调用方拿到的是**通用那句"出错了"** —— 与这个文件头写着的设计（"404 是常态，
   * 界面要按补录来说"）正好相反，而且**没有任何门禁看得见**（每一档都渲染得出来）。
   *
   * ⚠️★ 为什么是 404 ⇒ `seed_not_found`，而不是"再读一遍响应体"：
   *    `services/api/src/routes/seeds.ts` 在这几条读路径上**只**回两种 404，
   *    而两种都是同一件事 —— `{"error":"seed_not_found"}`（`:292`）与
   *    `{"error":"seed_not_found","reason":"no_match"}`（`:305`，检索条件没命中）。
   *    让 `lib/api.ts` 去读体是**跨切面的改动**（那个文件自己写着为什么不做，见
   *    `fetchRankedStatus` 那一段：全站约三十条 GET 的错误形状会一起变），
   *    而写在这里的收益是**判据仍然只有一处**：谁要改"什么算 not_found"，
   *    改的是这个函数，不是十几个调用点。
   * ⚠️ 代价写在明面上：`apps/web/src/routes/Seeds.tsx` 的「按 ID 查」那一档
   *    从今天起**会**走 `not_found` 分支（在此之前它拿到的是 `other` + 通用文案）——
   *    那是这个文件头一直描述的行为，只是过去接不上（这一条**没有**自动化判据：
   *    `apps/web` 没有测试运行器，渲染自检也不喂这条路径）。
   */
  const code = error.code ?? (error.status === 404 ? 'seed_not_found' : undefined);

  switch (code) {
    /*
     * ★ 一个错误码，两种意思，只有 `reason` 能分开它们。
     *
     * ⚠️ 而 reason 现在读不到（见文件头）。**这个损失在这里最严重**：
     *    检索那一条路读不到 reason 时，`no_match`（"条件太窄"）与
     *    `not_found`（"不在库里"）会显示成同一句话，而两句的下一步完全相反
     *    —— 一个让你放宽条件，一个让你去补录。
     *    （lib/api.ts 接上 reason 之后，下面这两个分支会各自变精确。）
     *
     * ⚠️ 但**按 ID 查**这一侧即使读不到 reason 也是对的，所以 `context` 的判断
     *    放在 reason 之前：
     *      · `/match/:id` 的 404 只可能是"这场比赛不在库里"（上游只覆盖约 80%），
     *        这条路**根本没有筛选条件可以放宽** —— 显示"放宽条件"会指向一组
     *        界面上不存在的控件。
     *      · 而它**确实可能**带上 `reason: 'no_match'`：service 端把上游
     *        `success:false` 且文案像"没有找到符合条件的种子"的响应一律归成
     *        `empty`（见 seeds/upstream.ts 的 looksLikeNoResults，那段嗅探
     *        对读端点同样生效）。那句话对一次按 ID 的查询没有区分力，
     *        所以在这一侧必须先按"不在库里"来读。
     */
    case 'seed_not_found': {
      if (context === 'lookup') {
        return {
          kind: 'not_found',
          message: t('seedsPage.notFoundTitle'),
          hint: t('seedsPage.notFoundBody'),
        };
      }
      if (apiReason(error) === 'no_match') {
        return {
          kind: 'no_match',
          message: t('seedsPage.errNoMatch'),
          hint: t('seedsPage.errNoMatchHint'),
        };
      }
      /*
       * 检索路径上的无 reason 404。两种读法在这里的**下一步是同一个**
       * （放宽条件再试），所以合一不会误导用户 —— 这也正是它可以在
       * reason 接通之前先这样处理的原因。
       */
      return {
        kind: 'not_found',
        message: t('seedsPage.errNoMatch'),
        hint: t('seedsPage.errNoMatchHint'),
      };
    }

    case 'seed_service_unavailable':
      return {
        kind: 'unavailable',
        message: t('seedsPage.errUnavailable'),
        hint: t('seedsPage.errUnavailableHint'),
      };

    /*
     * ★ 本站**没配上游**（503 `seed_not_configured`，2026-09-19 开源前加）。
     *
     * ⚠️ 它必须与上面那条分开，因为它说的**不是同一件事**：
     *    "上游坏了"和"我们根本没接上游"在界面上是两句相反的话
     *    （一句让你等，一句告诉你等下去没用）。
     *
     * 而它现在是**默认状态** —— `MCSR_SEED_API_BASE` 没有默认值（写死一个
     * 第三方地址等于让每个照抄本仓的人把请求打到别人的机器上），所以自建者
     * 打开 /seeds 看到的多半就是这一条。文案因此必须包含"下一步是去配上它"，
     * 而不是"稍后再试"。
     */
    case 'seed_not_configured':
      return {
        kind: 'not_configured',
        message: t('seedsPage.errNotConfigured'),
        hint: t('seedsPage.errNotConfiguredHint'),
      };

    /*
     * 限流：`retryAfterSec` 是**已经打通**的（ApiError 有它，来自 Retry-After 头
     * 或响应体）。所以这一条是唯一一条现在就能给出准确下一步的分支。
     */
    case 'rate_limited': {
      const seconds = error.retryAfterSec ?? 60;
      return {
        kind: 'rate_limited',
        message: t('seedsPage.errRate', { seconds }),
        retryAfterSec: seconds,
      };
    }

    case 'invalid_input': {
      const reason = apiReason(error);
      const target = reason ? QUERY_REASON_TARGET[reason as QueryReason] : undefined;

      if (target?.kind === 'field') {
        /*
         * `bad_match_id` 的文案要带上服务端给的下界（两个端点不同）。
         * `min` 也读不到时回退到调用方给的数字 —— 它知道自己打的是哪个端点。
         */
        const min = apiExtra<number>(error, 'min') ?? fallbackMin;
        const fieldErrors: Partial<Record<SeedQueryField, string>> = {};
        fieldErrors[target.field] = t(target.key, { min });
        return { kind: 'field', message: t('seedsPage.errGeneric'), fieldErrors };
      }
      if (target) {
        return { kind: 'field', message: t(target.key) };
      }

      /*
       * ⚠️ 拿不到 reason 时**如实说**，不猜。
       *    猜错的代价是红字出现在一个填对的输入框下面 —— 用户会去改一个
       *    本来就对的值，然后再失败一次，而且这次连线索都没有了。
       *    这条兜底通常不会被看到：表单自己先校验一遍（见文件头第 3 条）。
       */
      return { kind: 'field', message: t('seedsPage.saveErrUnknownField') };
    }

    default:
      return { kind: 'other', message: fallback(error) };
  }
}

// ---------------------------------------------------------------------------
// 补录（/save）
// ---------------------------------------------------------------------------

export interface SeedSaveFailure {
  /** 逐控件的红字（已经翻译好）。 */
  fieldErrors: Partial<Record<SeedSaveField, string>>;
  /** 表单上方的一句话。没有字段级错误时它才是唯一的信息。 */
  formError: string | null;
  /** 可以点的下一步（登录 / 验证邮箱）。 */
  action?: { to: string; labelKey: string };
  /** 写入成功了（409 之外的正常路径不会走到这里，留给调用方判断）。 */
  reason?: string | null;
}

/**
 * 把补录失败的四种"用户能处理的"结果分开：
 *
 *   · 409 `seed_exists`          → 已经录过了，别让他再点一次
 *   · 429 `rate_limited`         → 还要等 N 秒（配额记的是成功写入，见文案）
 *   · 502 `seed_service_unavailable` → 上游坏了，等一会儿
 *   · 503 `seed_write_disabled`  → **我们**没打开写入（运维开关，不是他的权限问题）
 *   · 503 `seed_not_configured`  → **我们**根本没配上游（同 503，但下一步不同）
 *
 * 后面几条尤其不能混：一个说"上游坏了"，一个说"我们没开"，一个说"我们没配"，
 * 而用户能做的事完全不同（等 vs. 不用等了）。
 */
export function describeSeedSaveError(
  error: unknown,
  t: Translate,
  fallback: (error: unknown) => string,
): SeedSaveFailure {
  if (!(error instanceof ApiError)) {
    return { fieldErrors: {}, formError: fallback(error), reason: null };
  }

  const reason = apiReason(error);

  switch (error.code) {
    case 'seed_exists':
      return {
        fieldErrors: {},
        formError: `${t('seedsPage.saveErrExists')} —— ${t('seedsPage.saveErrExistsHint')}`,
        reason,
      };

    /*
     * ⚠️ 503 在前端必须和"登录/权限"分开。
     *
     * 服务端刻意把这个开关放在**认证之前**（一条命令就能停掉写入，不必等谁登录失败），
     * 代价是匿名访客也会拿到它。所以界面不能说"你没有权限"，
     * 也不能给 Retry-After —— 我们不知道什么时候重开。
     */
    case 'seed_write_disabled':
      return {
        fieldErrors: {},
        formError: `${t('seedsPage.saveErrDisabled')} —— ${t('seedsPage.saveErrDisabledHint')}`,
        reason,
      };

    case 'seed_service_unavailable':
      return {
        fieldErrors: {},
        formError: `${t('seedsPage.errUnavailable')} —— ${t('seedsPage.errUnavailableHint')}`,
        reason,
      };

    /*
     * ⚠️ 与 `seed_write_disabled`（上面那条）同样是 503，但两句话说的是
     *    两件事，所以它必须自己一支："我们没打开写入" vs "我们压根没接上游"。
     *    合成一句的代价是补录的人去等一个永远不会到来的恢复时间。
     */
    case 'seed_not_configured':
      return {
        fieldErrors: {},
        formError: `${t('seedsPage.errNotConfigured')} —— ${t('seedsPage.errNotConfiguredHint')}`,
        reason,
      };

    case 'rate_limited': {
      const seconds = error.retryAfterSec ?? 60;
      return { fieldErrors: {}, formError: t('seedsPage.errRate', { seconds }), reason };
    }

    /*
     * 未登录 / 未验证 / 无权限 —— 三种都由 `requireCapability` 产生，
     * 而它自己就会区分 401 / 403 forbidden / 403 email_not_verified。
     * 界面**也**在渲染之前就用 useCan 拦过一遍，但会话过期是一个真实状态：
     * 页面打开着，cookie 过期了，这时用户点下去就会拿到这里的 401。
     */
    case 'unauthorized':
      return {
        fieldErrors: {},
        formError: t('seedsPage.saveNeedLogin'),
        action: { to: '/login?next=%2Fseeds', labelKey: 'seedsPage.saveNeedLoginAction' },
        reason,
      };

    case 'email_not_verified':
      return {
        fieldErrors: {},
        formError: t('seedsPage.saveNeedVerify'),
        action: { to: '/me', labelKey: 'seedsPage.saveNeedVerifyAction' },
        reason,
      };

    case 'forbidden':
      return { fieldErrors: {}, formError: t('seedsPage.saveNeedCapability'), reason };

    case 'invalid_input': {
      const target = reason
        ? SAVE_REASON_TARGET[reason as keyof typeof SAVE_REASON_TARGET]
        : undefined;

      if (target?.kind === 'field') {
        const min = apiExtra<number>(error, 'min') ?? MIN_MATCH_ID;
        const fieldErrors: Partial<Record<SeedSaveField, string>> = {};
        fieldErrors[target.field] = t(target.key, { min });
        return { fieldErrors, formError: null, reason };
      }
      if (target) {
        return { fieldErrors: {}, formError: t(target.key), reason };
      }
      // 拿不到 reason → 如实说（见文件头）
      return { fieldErrors: {}, formError: t('seedsPage.saveErrUnknownField'), reason };
    }

    default:
      return { fieldErrors: {}, formError: fallback(error), reason };
  }
}
