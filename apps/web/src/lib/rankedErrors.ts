/**
 * Ranked 实时信息 —— 这一栏的失败 → **用户能看懂的一句话**。
 *
 * ===========================================================================
 * 这一层为什么存在：这三句话就是我们全部的线索
 * ===========================================================================
 * ②③④ 三个面板由访客的浏览器**直连**上游，所以上游那一边的失败我们在服务端**看不到**
 * （spec §3 代价 1：日志里一个字都没有）。⇒ 访客屏幕上那句话，就是我们关于这次失败的
 * 全部信息。于是「连不上上游」「上游回了看不懂的东西」「上游说没有这一周」必须**分开说**，
 * 而不是都塌成一句"出错了" —— 用户下一步做的事完全不同（等 / 等 / 别等了）。
 *
 * 形状照 `lib/shareErrors.ts`：一个纯函数，吃 `(error, t, fallback)`，吐出一句**已经翻译好**的话。
 * `fallback` 由调用方给（`useApiErrorText()` 的结果），它负责那些**这一层认不出来**的失败。
 *
 * ===========================================================================
 * ⚠️★ 映射写成一张**导出的表**，不是一串 if
 * ===========================================================================
 * `lib/shareErrors.ts` 上有过教训：一张谁都看不见的 `switch` 被对调两行是**全静默**的 ——
 * 界面照样渲染、类型检查照样过（每一格都是 `string`）、门禁一个都不看它。
 * ⇒ `RANKED_ERROR_KEYS` **导出**，`apps/web/scripts/rankedrender.tsx` 逐格断言它，
 *   **并且**用记录器走一遍 `describeRankedError` 的真实输出：
 *   表对了但派发不查表，同样是一个缺陷（表在那里摆着、没人用它）。
 *
 * ===========================================================================
 * ⚠️⚠️ 我们那个端点的**码，现在读不到** —— 下面两段就是为此写的
 * ===========================================================================
 * 服务端回的是 `{ error: 'ranked_busy' }` 这样的码（`services/api/src/routes/ranked.ts`：
 * 429 `rate_limited` / 502 `upstream_bad_response` / 503 `ranked_busy` / 503 `upstream_unavailable`），
 * 但 `fetchRankedStatus` 走的是 `lib/api.ts` 的 `request()`，而那个 **GET 助手只读状态码、
 * 不读响应体**（`api.ts` 的 `if (!res.ok)` 那一段）⇒ `ApiError.code` 在**每一条 GET** 上
 * 都是 `undefined`。这个事实是**读出来的**，不是推断的（`lib/seedErrors.ts` 的文件头
 * 记着同一处断链，那里损失更大：它连 reason 都拿不到）。
 * ⇒ 于是这一层做两件事：
 *   1. **按码分派的那一支写满**（四个码都在）：`request()` 开始读响应体的那一天，
 *      它会**自动生效**，不需要再动这个文件；
 *   2. 今天真正起作用的是**状态码兜底**：429 / 502 / 503 是这一栏端点的契约
 *      （spec §13 的"兜底码"那一行 + `routes/ranked.ts`），而状态码现在读得到。
 *      ⚠️ 503 有**两档**（`ranked_busy` = 上游在限我们的流；`upstream_unavailable` = 上游挂了），
 *      码读不到时它们**在客户端长得一模一样** ⇒ 只能取其中**不会说错**的那一档：
 *      `unavailable`（"上游暂时读不到"）。反过来取 `busy` 会把一次**上游整个挂掉**说轻，
 *      而那会让用户以为"再等等就好"、实际上要等的是上游修好。
 *      代价（若取反了会好一些的话）：上游限我们流时，我们说的是"暂时读不到"，
 *      比真相模糊一档 —— 但它不会把人引到错的方向上。
 *
 * ===========================================================================
 * ⚠️ 认不出来的失败**不编一句话**（`rankedErrorSource` 因此回 `null`）
 * ===========================================================================
 * 第三个参数 `fallback` 必须在**这一类**上用掉：`ApiError` 的 `status === 0`
 * ——那是**我们自己的服务器**连不上（`api.ts` 给的那条 message 比任何兜底都准）。
 * 把它说成"上游暂时读不到"是**把责任推给第三方**：用户以为要等上游，而真正没起来的是我们。
 * ⇒ `rankedErrorSource` 表达得出"我认不出来"（`RankedErrorSource | null`），
 *   而不是硬塞进七个格子里的某一个。
 *   ⚠️ 计划里那个签名写的是非 null 的 `RankedErrorSource`。**这是一处有意的偏差**：
 *     那个签名会让 `describeRankedError` 的 `fallback` 永远不被调用 ——
 *     一个"给了却用不上"的参数，与 `shareErrors.ts` 那句"给认不出来的东西一个兜底"直接矛盾。
 *     改的只是 `rankedErrorSource` 的**返回类型**（多一个 `| null`），
 *     `describeRankedError` 的签名、七格表、七个 key 一个字没动。
 */
import { ApiError } from '@/lib/api';
import { RankedDirectError } from '@/lib/rankedDirect';

/** `t()` 的最小形状（与 `lib/shareErrors.ts` 里那一个同形，各自独立、不互相 import）。 */
export type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * 这一栏**全部**的失败来源 —— 七个，一个不多一个不少。
 *
 * 前四个来自**直连**（`RankedDirectError` 的四种原因），后三个来自**我们自己的端点**
 * （`GET /api/ranked/status` 的四个码，其中 503 的两个码在客户端分不开、由状态码兜底取舍）。
 * ⚠️ 类型是**手抄**的联合（上游给过来的是字符串）：服务端哪天加一个码，这里不会有编译错误
 *    —— 那一支由 `rankedErrorSource` 的兜底挡住、走调用方的 `fallback`，
 *    而不是在这里假装认识它（`shareErrors.ts` 里那条 `isShareStateReason` 是同一条规矩）。
 */
export type RankedErrorSource =
  | 'network'
  | 'http'
  | 'not_found'
  | 'bad_response'
  | 'rated'
  | 'busy'
  | 'unavailable';

/**
 * ★★ source → 词条 key —— **本文件里唯一的一份映射**。
 *
 * ⚠️★ 它**导出**，唯一理由是：`apps/web` 没有测试运行器，而 `apps/web/scripts/rankedrender.tsx`
 *    要**逐格**断言这张表，再用记录器走一遍 `describeRankedError` 的真实输出
 *    （换掉两格的对应关系在全仓是**全静默**的，理由见文件头）。
 * ⚠️ 这七条 key 的**值**（中文/英文）住在 `packages/shared/src/i18n/` 里，由 T7 落地；
 *    它们不是字面量 `t('…')` 调用点了，所以 `services/api/src/i18n-keys.test.ts` 的字面量扫描
 *    覆盖不到它们 —— 存在性由渲染自检守着（`shareErrors.ts` 的 `SHARE_STATE_REASON_KEYS`
 *    是同一处置，那条注释里写着"表里的数据不再是调用点"）。
 */
export const RANKED_ERROR_KEYS: Record<RankedErrorSource, string> = {
  network: 'ranked.errNetwork',
  http: 'ranked.errHttp',
  not_found: 'ranked.errNotFound',
  bad_response: 'ranked.errBadResponse',
  busy: 'ranked.errBusy',
  unavailable: 'ranked.errUnavailable',
  rated: 'ranked.errRateLimited',
};

/**
 * 我们那个端点回的码 → source。**认不出来的码回 `null`**（交给调用方的兜底）。
 *
 * ⚠️ 这一段今天**走不到**（`ApiError.code` 在 GET 上恒为 `undefined`，见文件头），
 *    但它是**完整**的：`request()` 开始读响应体的那一天它就生效。
 *    否决了"只按状态码写、不留这一段"：那样等码接通的那天，503 的两档就**永远**分不开了，
 *    而那一天没有人会记得回来补这一段。
 */
function apiCodeSource(code: string | undefined): RankedErrorSource | null {
  switch (code) {
    case 'ranked_busy':
      return 'busy';
    case 'upstream_unavailable':
      return 'unavailable';
    case 'upstream_bad_response':
      return 'bad_response';
    case 'rate_limited':
      return 'rated';
    default:
      return null;
  }
}

/**
 * 码读不到时的**状态码兜底**（今天真正起作用的那一支，见文件头第 2 条）。
 *
 * ⚠️ 只列**端点契约里钉死**的三个状态（`routes/ranked.ts`）：429 只可能是我们自己的限流、
 *    502 只可能是 `upstream_bad_response`、503 是那两档之一（取不会说错的那一档）。
 *    其余的（0 / 404 / 500 / …）一律回 `null` ⇒ 调用方的 `fallback`，
 *    因为"我们服务器 500"与"上游 500"是两件完全不同的事，这里没有判据能分开它们，
 *    编一句"上游"只会把排查方向带偏。
 */
function apiStatusSource(status: number): RankedErrorSource | null {
  switch (status) {
    case 429:
      return 'rated';
    case 502:
      return 'bad_response';
    case 503:
      return 'unavailable';
    default:
      return null;
  }
}

/**
 * 把三种失败（**直连错误** / 我们 API 的 `ApiError` / 其它）归一成一个 source。
 *
 * ⚠️ 认不出来时返回 `null` —— **不要**把它当成"未知"以外的东西，调用方必须走 `fallback`
 *    （文件头最后一节写了为什么这一档不能编一句话）。
 */
export function rankedErrorSource(error: unknown): RankedErrorSource | null {
  // 直连的四种原因**就是**四个 source，一一对应（`rankedDirect.ts` 的 `reason`）。
  if (error instanceof RankedDirectError) return error.reason;
  if (error instanceof ApiError) {
    // 按码优先：码是权威的那一个（它区分得开 503 的两档）。
    return apiCodeSource(error.code) ?? apiStatusSource(error.status);
  }
  return null;
}

/**
 * 失败 → **一句已经翻译好的话**。
 *
 * ⚠️★ 它必须**查表**（`t(RANKED_ERROR_KEYS[source])`），不是自己再写一遍映射：
 *    表对了但派发不查表，同样是一个缺陷（`shareErrors.ts` 的注释原话）。
 * ⚠️ 认不出来的失败走 `fallback`（`useApiErrorText()` 的结果）——见文件头最后一节：
 *    "我们自己的服务器连不上"那一档**只有**它能说对。
 */
export function describeRankedError(
  error: unknown,
  t: Translate,
  fallback: (error: unknown) => string,
): string {
  const source = rankedErrorSource(error);
  if (source === null) return fallback(error);
  return t(RANKED_ERROR_KEYS[source]);
}
