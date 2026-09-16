/**
 * 追踪的博主 —— 这一栏的失败 → **用户能看懂的一句话**（面板顶部）或**一格红字**（输入框下面）。
 *
 * ===========================================================================
 * 这一层为什么存在：服务端那五个码/三个 reason **自己不会说人话**
 * ===========================================================================
 * `routes/tracking.ts` 回的是机器码（`platform_not_configured` / `rate_limited` /
 * `upstream_bad_response` / `invalid_input` + `reason`）。界面要说人话，而**兜底那句话是错的**：
 * `apiErrorText` 对认不出的码回「出错了，请稍后再试。」—— 那句话把编辑送去**重试**，
 * 而这一栏最要紧的两种失败**重试一万次也没用**：
 *   · `platform_not_configured`（503）—— 我们服务器上没配这个平台的凭据（spec §2.7）。
 *     要做的是去配 key，不是重贴链接，也不是再点一次。
 *   · `creator_not_found`（400 + reason）—— 那条链接指向的人**不存在**（上游 `-404`）。
 *     要做的是改链接。
 * 所以这一层照 `lib/rankedErrors.ts` / `lib/shareErrors.ts` 那一套写：一个纯函数，
 * 吃 `(error, t, fallback)`，吐出一句**已经翻译好**的话；`fallback` 由调用方给
 * （`useApiErrorText()` 的结果），负责这一层**认不出来**的那些失败。
 *
 * ===========================================================================
 * ⚠️★ 映射写成一张**导出的表**，不是一串 if（`shareErrors.ts` 上真吃过的教训）
 * ===========================================================================
 * 一张谁都看不见的映射表被对调两行是**全静默**的：界面照样渲染、类型检查照样过
 * （每一格都是 `string`）、门禁一个都不看它。⇒ `TRACKED_ERRORS` **导出**，
 * `apps/web/scripts/videorender.tsx` 逐格断言它（key 存在、两种语言都有真值），
 * **并且**用真的 `ApiError` 走一遍 `describeTrackedError` 的派发 ——
 * 表对了但派发不查表，同样是一个缺陷。
 *
 * ===========================================================================
 * ⚠️ 为什么 `rate_limited` 在这里**另说一句**（不复用全站的 `auth.rateLimited`）
 * ===========================================================================
 * 全站那句是「尝试太频繁了，请等 60 秒后再试」—— 那个 60 来自 `Retry-After`
 * （`apiErrorText` 里写的是 `error.retryAfterSec ?? 60`）。而**这个端点刻意不发
 * `Retry-After`**（`routes/tracking.ts` 的文件头第二节写着为什么）：bilibili 的风控
 * 是**概率性**的（spec §2.3），我们不知道它什么时候松。**编一个 60 秒等于承诺一件
 * 做不到的事** —— 用户等满 60 秒再点，还是 429，然后他会认为这个功能坏了。
 * ⇒ 这里说的是事实："上游在限我们的流，过一会儿再试；这个数字我们给不了。"
 *
 * ===========================================================================
 * ⚠️ `upstream_bad_response`（502）：**这一栏必须自己说**，别落进通用兜底
 * ===========================================================================
 * 它与 `ranked` 那一栏的处境一样（那一栏为此给了一句 `ranked.errBadResponse`）：
 * 502 意味着"上游回了我们读不懂的东西 / 我们的适配层要改"，而通用兜底的
 * 「出错了，请稍后再试」把这件事说成"你再试试" —— 试也没用，该做的是来看代码。
 *
 * ⚠️ 它**不是** `PlatformHandshakeError` 与 `PlatformUnavailableError` 的区别所在：
 *    那两种（握手失败、连不上上游）在响应体里**合并成同一个码**
 *    （`routes/tracking.ts` 的七行表），所以界面这一侧**没有判据**能把它们分开 ——
 *    编一句"上游连不上"就会在"上游回了乱码"时是假话。⇒ 这一格说的是那句
 *    两者都成立的话（上游那边没谈成）。
 *
 * ===========================================================================
 * ⚠️ 认不出来的失败**不编一句话**（`trackedErrorSource` 因此回 `null`）
 * ===========================================================================
 * 最要紧的是 `status === 0`（连不上**我们自己的** API）：把它说成"上游有点问题"
 * 是**把责任推给第三方**，而真正没起来的是我们（`rankedErrors.ts` 的文件头为同一件事
 * 写过一整段）。⇒ 那一类走调用方的 `fallback`，由它说那句**真**话。
 */
import { ApiError } from '@/lib/api';

/** `t()` 的最小形状（与 `lib/shareErrors.ts` / `lib/rankedErrors.ts` 里那一个同形，各自独立）。 */
export type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * 这一栏**全部**认得出的失败 —— 八个，一个不多一个不少。
 *
 * ⚠️ 类型是**手抄**的联合（服务端给过来的是字符串）：服务端哪天多一个码，
 *    这里不会有编译错误 —— 那一支由 `trackedErrorSource` 的兜底挡住、
 *    走调用方的 `fallback`，而不是在这里假装认识它（`shareErrors.ts`
 *    的 `isShareStateReason` 是同一条规矩）。
 */
export type TrackedErrorSource =
  | 'platform_not_configured'
  | 'creator_not_found'
  | 'unresolvable_input'
  | 'duplicate'
  | 'rate_limited'
  | 'upstream_bad'
  | 'forbidden'
  | 'not_found';

/** 这句话/这格红字**挂在哪儿**：输入框下面（`input`）还是面板顶部（`panel`）。 */
export type TrackedErrorPlace = 'input' | 'panel';

/**
 * ★★ source → 词条 key + 挂的位置 —— **本文件里唯一的一份映射**。
 *
 * ⚠️★ 它**导出**，唯一理由是：`apps/web` 没有测试运行器，而
 *    `apps/web/scripts/videorender.tsx` 要**逐格**断言这张表 ——
 *    换掉两格的对应关系（或者把某一格从 `input` 挪到 `panel`）在全仓是**全静默**的。
 * ⚠️ 这八条 key 的**值**住在 `packages/shared/src/i18n/` 里；它们不是字面量
 *    `t('…')` 调用点，所以 `services/api/src/i18n-keys.test.ts` 的字面量扫描
 *    覆盖不到它们 ⇒ **存在性由渲染自检逐格守着**（八条 × 两种语言各查一次）。
 *    （`SHARE_STATE_REASON_KEYS` / `RANKED_ERROR_KEYS` 是同一处置，那两处的注释
 *    写着"表里的数据不再是调用点"。）
 */
export const TRACKED_ERRORS: Record<TrackedErrorSource, { key: string; place: TrackedErrorPlace }> =
  {
    /*
     * 503：**我们的配置**（不是调用方贴错了东西，也不是崩溃）。
     * ⚠️ 这一句必须点明"不是你的链接的问题"：不点明的话，编辑的第一反应是
     *    再贴一次、换一条链接 —— 而两件事都不会让它变好。
     */
    platform_not_configured: { key: 'tracked.errPlatformNotConfigured', place: 'panel' },
    /* 400 + reason：上游说没有这个人（`-404`）—— 改成"改链接"那句话。 */
    creator_not_found: { key: 'tracked.errCreatorNotFound', place: 'input' },
    /* 400 + reason：我们连"这是谁"都判不出来（形状不对 / 平台判不出）。 */
    unresolvable_input: { key: 'tracked.errUnresolvable', place: 'input' },
    /* 400 + reason：已经在名单上了（服务端另带 `existingId`，而那一行就在下面）。 */
    duplicate: { key: 'tracked.errDuplicate', place: 'input' },
    /* 429：上游在限我们的流 —— ⚠️ **不许承诺 60 秒**（见文件头）。 */
    rate_limited: { key: 'tracked.errRateLimited', place: 'panel' },
    /* 502：上游那边没谈成（握手失败 / 回了读不懂的东西 / 连不上，合成同一个码）。 */
    upstream_bad: { key: 'tracked.errUpstreamBad', place: 'panel' },
    /* 403：`live.manage` 没了（会话变了、或者权限被改过）。 */
    forbidden: { key: 'tracked.errForbidden', place: 'panel' },
    /* 404：这一行已经不在了（多半是另一个编辑刚删掉它）。 */
    not_found: { key: 'tracked.errNotFound', place: 'panel' },
  };

/**
 * 一次问出"这是哪一格失败"。**认不出来回 `null`**（调用方必须走 `fallback`）。
 *
 * ⚠️ 判据是 `error.code`，**绝不匹配 message 文本**：本仓已经证伪过一次那种写法
 *    （服务端把中文改成英文之后所有分支静默失效，界面开始显示 "API 返回 HTTP 409"，
 *    而测试仍然全绿。`submissionErrors.ts` 的文件头记着这件事）。
 * ⚠️ `invalid_input` 那一个码下**有三个** reason（T5 的裁决 1），所以必须看 `reason`：
 *    只看码的话，三种要人做的事完全不同的失败会共用一句"输入不合法"。
 * ⚠️ `reason` 认不出来时**不猜**（比如只有字段级 `issues` 的那一类）：
 *    回 `null` 让 `fallback`（`apiErrorText` 会把第一条 issue 翻出来）说话。
 */
export function trackedErrorSource(error: unknown): TrackedErrorSource | null {
  if (!(error instanceof ApiError)) return null;

  switch (error.code) {
    case 'platform_not_configured':
      return 'platform_not_configured';
    case 'rate_limited':
      return 'rate_limited';
    case 'upstream_bad_response':
      return 'upstream_bad';
    case 'forbidden':
      return 'forbidden';
    case 'not_found':
      return 'not_found';
    case 'invalid_input': {
      /*
       * ⚠️ 判据写成**三次字符串比较**，不是 `INPUT_REASONS.has(reason)` + 一个
       *    `as TrackedErrorSource` 断言。本仓对 `as` 的规矩是"能窄化就不断言"
       *    （`routes/tracking.ts` 的表里也写着"再窄化一次（不用 `as`）"），而这里
       *    断言有一个具体的代价：这三个字符串同时也是 `TRACKED_ERRORS` 的键，
       *    打错一个（`creator_notfound`）断言照样编过、测试照样绿，而那三格会
       *    **永远走兜底** —— 兜底那句话正是这一层存在的理由要避免的。
       *    窄化之后，"返回值就是那三个取值之一"由编译器保证。
       */
      const reason = error.reason;
      if (reason === 'creator_not_found') return reason;
      if (reason === 'unresolvable_input') return reason;
      if (reason === 'duplicate') return reason;
      return null;
    }
    default:
      return null;
  }
}

/**
 * 一次失败 → 两格文字（**最多一格非空**）。
 *
 * ⚠️ 返回值是**对象**而不是一个字符串：这一栏的失败有**两个去处**（输入框下面 vs
 *    面板顶部），而它们要的是两个不同 props（`fieldErrors.input` / `error`）。
 *    返回一个字符串的话，调用方得自己再判一次"这句话该挂哪儿" ——
 *    那就是**第二份**"哪一格失败"的规则，而它与这张表迟早会漂开
 *    （两条判据长得不一样时，红字会出现在**另一个**地方，且没有任何报错）。
 * ⚠️ `source` 一起返回：渲染自检要用它，界面不用（`null` = 走了兜底）。
 */
export interface TrackedErrorText {
  /** 面板顶部那一句；`null` = 这一格里没有要在那儿说的。 */
  message: string | null;
  /** 输入框下面那一格红字；`null` = 这一格里没有。 */
  input: string | null;
  /** 认出来的那一格（`null` = 认不出来，已经用了 `fallback`）。 */
  source: TrackedErrorSource | null;
}

/**
 * 失败 → 已经翻好的一两句话。四个发送者（`Videos.tsx`）都走这一个函数。
 *
 * ⚠️ 它必须**查表**（`t(TRACKED_ERRORS[source].key)`），不是自己再写一遍映射：
 *    表对了但派发不查表，同样是一个缺陷（`shareErrors.ts` 的注释原话）。
 * ⚠️ 认不出来的失败一律往 `message` 走（`fallback` 给的那一句）：那些失败与**具体哪个输入框**
 *    无关（会话过期、连不上、服务器 500），挂在输入框下面会把用户引到一个不需要改的地方。
 */
export function describeTrackedError(
  error: unknown,
  t: Translate,
  fallback: (error: unknown) => string,
): TrackedErrorText {
  const source = trackedErrorSource(error);
  if (source === null) return { message: fallback(error), input: null, source: null };

  const row = TRACKED_ERRORS[source];
  const text = t(row.key);
  return row.place === 'input'
    ? { message: null, input: text, source }
    : { message: text, input: null, source };
}
