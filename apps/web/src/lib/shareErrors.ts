/**
 * 实时分享的失败 → **用户能看懂的一句话**。
 *
 * ===========================================================================
 * 这一层为什么存在
 * ===========================================================================
 * 服务端说的是**机器码**（spec §5.3 / §5.4 的拒绝码表：`unauthorized` /
 * `email_not_verified` / `forbidden` / `invalid_input` / `at_limit` / `invalid_state`），
 * 界面要说人话。中间这一层住在**这个栏目自己**的文件里，而不是塞进
 * `lib/auth.tsx` 的 `apiErrorText`：那一份是**全站通用**的兜底，它没有
 * `kind`、也没有"这是发布还是恢复"的上下文，而这一栏有两条判断**只有这里**做得出来
 * （见下面 `at_limit` 与 `invalid_state` 两段）。
 *
 * 形状照 `lib/seedErrors.ts` / `lib/submissionErrors.ts`：一个纯函数，吃
 * `(error, t, fallback, kind)`，吐出一句**已经翻译好**的话。`fallback` 由调用方给
 * （`useApiErrorText()` 的结果），它负责那些通用的失败（连不上、限流、字段级校验）。
 *
 * ⚠️ 按 `error.code` 分派，**绝不匹配 message 文本**：本仓已经证伪过一次那种写法
 *    （服务端把中文改成英文之后所有分支静默失效，界面开始显示 "API 返回 HTTP 409"，
 *    而测试仍然全绿）。同一条规矩写在 `submissionErrors.ts` 的文件头。
 *
 * ===========================================================================
 * ⚠️★ `at_limit` 必须**按 kind 分叉**，而它的两份话不一样
 * ===========================================================================
 * `at_limit` 这个码有**两条完全不同**的来源，而且响应形状不同：
 *   · 发布 seed 超额度 → 409 `at_limit` + `{ limit }`（§5.3）；
 *   · 恢复 room（我正在展示另一条）→ 409 `at_limit`，**没有 `limit` 字段**（§5.4）。
 * ⇒ room 与 seed 的 `at_limit` 在响应上长得**一模一样**，只有调用方知道自己在哪条路上。
 * 所以这个函数要一个 `kind`，而不是去响应里找判据（那里根本没有判据）。
 *
 * ⚠️ seed 那一句要 `{{max}}`，而恢复那条路的响应里**没有** `limit` —— 从
 *    `SHARE_LIMITS.seed` 拿（客户端本来就有那个常量），**不要等响应给**：
 *    等响应给的结果是"恢复那条路的额度提示里有个空洞"。
 *
 * ===========================================================================
 * ⚠️ `invalid_state` 的三种 reason 各有各的下一句话 —— 以及**它们为什么长这样**
 * ===========================================================================
 * 服务端的 `invalid_state` 带一个 `reason`（`services/api/src/live-shares.ts` 的
 * `SetVisibilityFailure`），三种是**三种不同的处境**，绝不能揉成一句通用的
 * "操作失败"：本仓对"为什么不行"一向分开说，而这里"为什么不行"决定了用户下一步做什么。
 *
 * | reason | 服务端的判据 | 用户手上的事实 |
 * |---|---|---|
 * | `expired` | `expires_at <= now`（边界与看板判据**互为反面**） | 这条**到点**了，再也回不来 |
 * | `not_active` | 下架时它已经不是 `active`（已下架 / 已被替换） | 它已经不在展示中了 |
 * | `not_hidden` | 恢复时它不是 `hidden`（还在展示 / 已被替换） | 它还在展示中 |
 *
 * ⚠️★ **这三句各有专门的话**（`shares.errExpired` / `errNotActive` / `errNotHidden`，
 *    2026-09-15 Task 7 接线）。在它们进冻结清单之前，这里只能借用「你的一条」
 *    那几句**状态句**（`mineNone` / `mineHidden` / `mineActive`）—— 那三句
 *    **语法上说得通、语义上是假的**：一个手上还有别的条目的人点了一个刚过期的行，
 *    会看到「你现在没有挂东西。」，而那句话是假的。
 *    ⇒ 现在三种 reason 各说各的下一句话，谁也不借谁的。
 *
 * ⚠️ 也别以为这三句"到不了"：让一行**还挂在屏幕上**的窗口，是响应与每秒 tick
 *    之间的延迟，加上后台标签页的定时器节流（spec §8 的订正里点明了这一条）
 *    —— 一个挂着不管的标签页切回来时，屏幕上可以有一排早就过期的行。
 *
 * ⚠️ 调用方在收到 `invalid_state` 时**应当顺手刷新一次看板**（`routes/ShareBoard.tsx`
 *    的实现里就是这么做的）：这三个 reason 说的都是"你看的那份数据已经旧了"，
 *    刷新之后界面与这句话就一致了。（刷新在容器里做 —— 这个文件是纯函数，
 *    不碰任何状态。）
 *
 * ===========================================================================
 * ⚠️ `invalid_input` 走兜底，**不自己编一句**
 * ===========================================================================
 * 表单**先自己校验一遍**（`ShareForm`，用的是 shared 的同几个常量），
 * 所以走到服务端 400 的只有两种情况：规则本身变了、或者前端漏了一格。
 * 那时服务端带回来的 `issues` 比我们猜的准 —— `useApiErrorText()` 会把第一条
 * 逐字段的说明翻出来。编一句"输入不合法"等于**把服务端的原因吞掉**，
 * 而那正是这个栏目最不该做的事。
 */
import { SHARE_LIMITS, type ShareKind } from '@mcsr/shared';
import { ApiError } from '@/lib/api';

/** `t()` 的最小形状（与 `lib/shareTime.ts` 里那一个同形，各自独立、不互相 import）。 */
export type Translate = (key: string, options?: Record<string, unknown>) => string;

/** `invalid_state` 的三种 `reason`（服务端 `SetVisibilityFailure` 那一支）。 */
export type ShareStateReason = 'expired' | 'not_active' | 'not_hidden';

/**
 * ★★ 三个 `reason` → 它们各自那一句话 —— **本文件里唯一的一份映射**。
 *
 * ⚠️★ 它**导出**，唯一理由是：`apps/web` 没有测试运行器（见 `lib/shareTime.ts` 的文件头），
 *    而这三格对应关系是全仓最容易被一次"看起来像整理"的改动**无声换掉**的东西 ——
 *    两个 reason 对调之后：界面照样渲染、类型检查照样过（三格都是 `string`）、
 *    门禁一个都不看它。⇒ `apps/web/scripts/sharerender.tsx` 的 ①b **逐格**断言这张表，
 *    **并且**用记录器走一遍 `describeShareError` 的真实输出（表对了但派发不查表，也是缺陷）。
 *
 * ⚠️ 类型是**手抄**的联合（服务端给过来的是字符串）：服务端加第四种 reason 时这里
 *    不会有编译错误 —— 那一支由下面 `isShareStateReason` 挡住、走调用方的兜底，
 *    而不是在这里假装认识它。
 *
 * ⚠️ 这三条 key 不在 `services/api/src/i18n-keys.test.ts` 的"字面量 `t()`"扫描范围里了
 *    （它们现在是**表里的数据**，不再是 `t('shares.errExpired')` 那样的调用点），
 *    所以它们的**存在性**改由 `sharerender.tsx` 的 `FROZEN_KEYS` 那 ⑬ 条守着。
 */
export const SHARE_STATE_REASON_KEYS: Record<ShareStateReason, string> = {
  expired: 'shares.errExpired',
  not_active: 'shares.errNotActive',
  not_hidden: 'shares.errNotHidden',
};

/**
 * 服务端给的 `reason` 是不是表里认得的那三个之一 —— 顺带把它缩窄成联合类型，
 * 于是查表**不需要任何类型断言**。
 *
 * ⚠️ 判据用 `Object.hasOwn`，不能用 `in`、也不能直接查表：`in` 会认原型链上的名字，
 *    一句伪造的 `{"reason":"constructor"}` 就能把表对象的继承属性当成词条 key 交给 `t()`。
 */
function isShareStateReason(reason: unknown): reason is ShareStateReason {
  return typeof reason === 'string' && Object.hasOwn(SHARE_STATE_REASON_KEYS, reason);
}

/**
 * 发布 / 下架 / 恢复失败时给用户的那一句话。
 *
 * @param kind 我刚刚操作的那一栏（`room` | `seed`）—— **只有恢复 room 与发布 seed
 *   的 `at_limit` 需要它**，见文件头那张表。调用方一定知道，服务端一定不知道。
 */
export function describeShareError(
  error: unknown,
  t: Translate,
  fallback: (error: unknown) => string,
  kind: ShareKind,
): string {
  if (!(error instanceof ApiError)) return fallback(error);

  switch (error.code) {
    /*
     * ★ 两句话，一个码 —— 见文件头那张表。判据只有 `kind` 一个。
     */
    case 'at_limit':
      return kind === 'room'
        ? t('shares.atLimitRestore')
        : // ⚠️ `max` 从常量拿，**不是**从响应拿：恢复那条路的 409 里没有 `limit`
          t('shares.atLimitSeeds', { max: SHARE_LIMITS.seed });

    /*
     * ★ 三种 reason，三句话 —— 映射在 `SHARE_STATE_REASON_KEYS` 那张**导出**的表里，
     *   这一段只负责查表（理由写在那张表自己的注释里：表被渲染自检逐格断言，
     *   换掉两行的对应关系会当场红，而它以前是一条谁都看不见的 `switch`）。
     * ⚠️ 认不出的 reason（服务端加了第四种）依旧走兜底，不假装知道它是什么意思。
     */
    case 'invalid_state':
      return isShareStateReason(error.reason)
        ? t(SHARE_STATE_REASON_KEYS[error.reason])
        : fallback(error);

    /*
     * 发布那条路要求邮箱已验证（`requireVerified`，§6.1）。这一条**必须**和 401 分开：
     * 一个说"去登录"，另一个说"去收件箱"，而用户能做的事完全不同。
     */
    case 'email_not_verified':
      return t('shares.needVerify');

    /*
     * 会话过期（页面开着、cookie 到点了）也会走到这里。用这一栏自己的那句话 ——
     * 它已经把两件事都说清了（要登录、而且内容只在登录用户之间可见）。
     */
    case 'unauthorized':
      return t('shares.loginNeeded');

    /*
     * 其余全部走兜底：`forbidden` / `not_found` 从界面上**到不了**
     * （别人的行结构上就没有下架按钮，`mine` 里也只有自己的行），
     * 真到了这里说明界面与服务端不同步 —— 通用文案就够了。
     * `invalid_input` 也在这里，理由见文件头最后一节。
     */
    default:
      return fallback(error);
  }
}
