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
 * ⚠️★ **这三句用的是词条里现成的"状态句"**（`shares.mineNone` / `mineHidden` /
 *    `mineActive`），而不是三句专门为我写的拒绝话 —— 因为**词条已经冻结**
 *    （spec §8 是这一次的冻结清单，本轮**不许新增词条**），而那张清单里
 *    恰好**没有**为这三个 reason 写话。可选的处置只有三种：
 *      ① 借用现成的状态句（本文件的写法）；
 *      ② 全部掉进通用兜底 —— 那正是本节开头要避免的"揉成一句操作失败"；
 *      ③ 新增词条 —— 超出本轮的范围。
 *    ① 至少满足了两条硬要求：三句**互不相同**、而且都是**真人话**；
 *    它们也正是「你的一条」那一块对同一种状态用的句子 ⇒ 用户在两处看到同一套词汇。
 *    ⚠️ 代价写在明面上：`expired` 那一句（"你现在没有挂东西。"）在"我另外还挂着几条
 *       别的"时并不精确。它只有在**竞态**里才会出现（看板上的行到点就被本地计时摘掉了，
 *       正常点不到），所以这句话的可见机会极小。
 *
 * ⚠️ 调用方在收到 `invalid_state` 时**应当顺手刷新一次看板**：这三个 reason 说的都是
 *    "你看的那份数据已经旧了"，刷新之后界面与这句话就一致了。（刷新在容器里做 ——
 *    这个文件是纯函数，不碰任何状态。）
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
     * ★ 三种 reason，三句话 —— 见文件头那张表（以及它记下的那个妥协）。
     * ⚠️ 直接比 `error.reason`（服务端给的是**字符串**，不是联合类型）：
     *    写成一张 `Record<联合, string>` 反而要加一个断言，而那个联合是**手抄**的、
     *    服务端加了第四种它也不会报错 —— 那样只是把"认不出"从 `default` 挪到了断言里。
     */
    case 'invalid_state': {
      switch (error.reason) {
        case 'expired':
          return t('shares.mineNone');
        case 'not_active':
          return t('shares.mineHidden');
        case 'not_hidden':
          return t('shares.mineActive');
        default:
          // 认不出的 reason（服务端加了第四种）→ 兜底，不假装知道它是什么意思
          return fallback(error);
      }
    }

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
