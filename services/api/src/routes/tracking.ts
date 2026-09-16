/**
 * 追踪的博主与他们全部视频 —— **HTTP 面**（spec §6.1 那五个端点）。
 *
 *   GET    /api/tracking/videos          **公开**      追踪到的视频（分页 published_at DESC，可带 `?platform=` 分区，spec §5.1）
 *   GET    /api/tracking/creators        live.manage  名单（含采集状态）
 *   POST   /api/tracking/creators        live.manage  加一个（入参是**一个链接或 @handle**）
 *   PATCH  /api/tracking/creators/:id    live.manage  改显示名 / 停用启用 / 重新回填
 *   DELETE /api/tracking/creators/:id    live.manage  删（视频靠外键级联跟着走）
 *
 * 挂载由 `index.ts` 做：`app.route('/api/tracking', trackingRoute)`。
 * ⚠️ 路由文件里写的是**相对路径**（`/creators`，没有 `/api/tracking` 前缀）——
 *    与 seeds / shares / ranked 三处同形，与 videosRoute 那种"自带前缀"的写法相反。
 *    两种写法不能混：混了的症状是**整组路由一起 404**，而不是某一条 404
 *    （index.ts 在每一处挂载点上都写了这句话）。
 *
 * ===========================================================================
 * 一、适配器注册表是**注入**的，而且**必填**
 * ===========================================================================
 * `POST /creators` 是这五个端点里**唯一**会碰上游的那一个（`resolveCreator`
 * 要握手、要跟短链），而测试里绝不许打真网络（brief 的 ⚠️）。
 * ⇒ 注册表从参数进来（`createTrackingRoute({ adapters })`），`index.ts` 传真那一个
 *   （`tracking/index.ts` 的 `adapterFor`），测试传假的。
 *
 * ⚠️ 被否掉的做法：在测试里**mock `globalThis.fetch`**（`seeds-proxy.test.ts` 是这样），
 *    或者给 `adapters` 一个默认值。两条的代价是同一个：mock 只能挡住"我以为会走的那条路"，
 *    而默认值让"忘了注入"这件事在生产上**看不出来**、在测试上**照样绿** ——
 *    那时 `POST /creators` 打到的是真的 bilibili，而唯一的证据在日志里。
 *    必填参数把这件事变成一次**编译错误**。
 *
 * ===========================================================================
 * 二、★★ 适配器失败 → 状态码：**一张表**（裁决 2，2026-09-16；两处补于 T5 复审）
 * ===========================================================================
 * 判据是一句话：**这是谁的问题**，而不是"谁抛的"。一律 500 的代价不是难看 ——
 * 是"管理员贴错了一条链接"和"我们的适配层和上游脱节了"在日志与界面上长得一模一样，
 * 而这两件事要的人、要的动作完全不同（重贴一次 vs 去看代码）。
 *
 * ```text
 * 抛出来的东西                      状态码  谁的问题             响应体                              日志
 * --------------------------------  ------  -------------------  ----------------------------------  ----
 * InvalidCreatorInputError           400    调用方（重贴一次）   invalid_input + unresolvable_input  有
 * BilibiliRejectedError(code=-404)   400    调用方（mid 不存在） invalid_input + creator_not_found   有
 * NoCredentialsError                 503    我们没配（不是崩）   platform_not_configured             有
 * BilibiliRateLimitError             429    上游在限流我们       rate_limited                        有
 * BilibiliRejectedError（其余）      502    我们的适配层要改     upstream_bad_response               有
 * PlatformHandshakeError             502    同上                 upstream_bad_response               有
 * PlatformUnavailableError           502    上游暂时联系不上     upstream_bad_response               有
 * ```
 *
 * 七行各自的理由与**被否掉的替代方案**（每一条的代价都写在明处）：
 *
 *   · **400 / invalid_input + reason**：与 `routes/seeds.ts` 的 `invalidInput` 同形
 *     （一个通用错误码 + 一个机器可读的 reason），而不是给"认不出的链接"新开一个错误码 ——
 *     错误码那张表（`error-codes.test.ts`）是给"用户能看到的失败结果"用的，
 *     字段级的问题全挤进去会变成一份没人看得完的清单。裁决 1 让**重复添加**也走这个形状。
 *     ★ 代价与收益同时在这里：`invalid_input` 这一个码下现在有**三个** reason
 *     （`unresolvable_input` / `creator_not_found` / `duplicate`），前端**必须按 reason
 *     分派**——这就是"一个通用码 + 机器可读的 reason"这个形状的账。
 *   · **`-404` 单独一行，400 而不是 404**（T5 复审的 Important 1，原来它与别的
 *     `BilibiliRejectedError` 一起报 502）：
 *     `bilibili.ts:215` 写明 `-404` 是"**这个 UP 不存在**"，而"加一个博主"这条路
 *     每次贴一个不存在的 mid 都会走到它（`lookupDisplayName` 对任何非零 code 都抛）。
 *     报 502 的代价是**编辑被送到错的地方修**：`upstream_bad_response` 在界面上没有
 *     自己的文案，落进 `apiErrorText` 的兜底「出错了，请稍后再试。」—— 于是他会一遍遍
 *     重贴同一条坏链接，而真正要做的事（改链接）永远不会发生。
 *     ⇒ 400 + `invalid_input` + `reason: 'creator_not_found'`，**不是** 404：
 *       · 400 是这个端点为"入参不对"已经在用的那一档（`unresolvable_input` / `duplicate`），
 *         前端因此只需要**一个**读者（按 reason 定位输入框）—— 这是裁决 1 定下的形状；
 *       · 404 在本仓是"**这个 URL 指向的东西不存在**"（PATCH/DELETE `/creators/:id`），
 *         而这里 POST 的 URL 是好的，坏的是 body 里的那一串；更要紧的是 **404 也没有前端文案**
 *         （`apiErrorText` 对认不出的码与 404 回的是同一句「出错了，请稍后再试。」），
 *         换一个状态码**修不好这个缺陷**，只有机器可读的 reason 才修得好。
 *       · reason 不与 `unresolvable_input` 合并：两者要人做的事不同 ——
 *         前者是"上游说没有这个人"（改输入即可），后者可能意味着我们的分发/解析表要改。
 *     ⚠️ `code` 仍然留在日志行里（`kind` 就写着 `-404`）：万一上游哪天用 `-404`
 *       表示别的意思，日志是唯一还看得见这个区别的地方。
 *   · **503** 而不是 400：没凭据是**我们的配置**，不是调用方贴错了东西；也不是 500，
 *     因为它不是崩溃（spec §9.1 ⑧：没凭据的平台要"跳过并说明原因"）。
 *   · **429** 而不是 500：适配器内部那 3 次 10 秒重试**已经跑完了**（spec §5.1 的冻结口径），
 *     所以走到这里的语义只剩"上游正在限我们的流，过一会儿再来"。
 *     ⚠️ 它**不带 `Retry-After`**，也没有 `retryAfterSec`：我们**不知道** bilibili 的
 *     风控什么时候松（spec §2.3 说它是概率性的），编一个数字等于承诺一件做不到的事
 *     （`routes/seeds.ts` 的 `seed_write_disabled` 那条 503 写着同一条理由）。
 *   · **502** 而不是 500（后三行）：它们都意味着**不是调用方的问题** —— 上游改了字段、
 *     形状变了、`-352` 风控挡住了签名，或者干脆联系不上。细节（上游的 code、原文）
 *     **只进日志**，一个字都不进响应体。
 *   · ★ **`PlatformUnavailableError` 由适配器抛，不是路由兜的**（T5 复审的 Important 2）：
 *     "联系不上上游"这件事的归属方是**唯一知道 HTTP 层发生了什么的那一层**（适配器），
 *     所以它在 `bilibili.ts` 里把两处裸 `fetch` 的拒翻译成这个类型，路由只认类型。
 *     ⚠️ **被否掉的替代方案：这里加一个 `catch` 兜住一切 ⇒ 502。** 代价是双向的：
 *     我们自己的 bug（拼错的字段、坏掉的签名构造器抛的普通 Error）会被报成
 *     "上游今天不行"，于是没人去看代码，而**这类错重试永远不会成功**；
 *     同时"第六类必须是 500"这条纪律（下面）也就不存在了。
 *     ⇒ 认不出的异常继续 `throw`，让它去 `onError` 拿那行堆栈。
 *
 * ⚠️ **表外那一类（不是上面七种的异常）绝不映射**：它是我们的 bug，必须走 `throw`
 *    → `index.ts` 的 `onError`（500 + 堆栈在日志里）。把任意异常都归进上面某一行，
 *    表现是我们自己的错被报成"上游在限流"或"管理员贴错了链接" —— 两种都会让人
 *    往错的方向找，而代码里那个错永远不会被看见。
 *
 * ===========================================================================
 * 三、★ 为什么要先判"这是哪个平台"（而不是挨个问适配器）
 * ===========================================================================
 * `resolveCreator` 是**每个平台各一个**的（spec §5.1–5.3 的输入形状也各不相同），
 * 所以分发这件事必须有人做。这里用一个小的 host 表（`platformOfInput`）：
 * 它只回答"交给谁"，**不抠 id、不联网**，抠 id 仍然是适配器的事。
 *
 * ⚠️ 被否掉的做法：**挨个问每个适配器**（"第一个能解析出来的就算"）。代价很具体，
 *    而且两边的错都是**答错方向**：
 *      · 管理员贴了一条**完全有效**的 YouTube 链接，而 youtube 今天没有适配器
 *        （`NoCredentialsError`）—— 挨个问得到的答案是 400「认不出这是谁」，
 *        于是他会一直重贴那条**本来就没问题**的链接，而真正要做的
 *        （配 `MCSR_YOUTUBE_KEY`）没有人会去做；
 *      · 反过来，管理员贴了一串乱码时，得到的是"youtube 没有配置"。
 *    分发的代价写清楚：**这张表要在 T8 加平台时跟着改**，而漏了的表现是
 *    "明明能解析的链接被 400" —— 那不是静默的（管理员当场看得见），
 *    所以这个代价可以接受；换来的是一句**说对了是谁的问题**的回答。
 *
 * ===========================================================================
 * 四、裁决 3：纯空白的 displayName 当"没填"
 * ===========================================================================
 * `TrackedCreatorInputSchema` 的注释写明：`'   '` 会被 `.trim()` 成 `''`，而
 * `max(80)` 对空串是通的 ⇒ **空白是通过校验的**。不特判的话，库里会多一行
 * **空白的显示名**（既不是名字，也看不出是"没填"），而且没有任何地方会报错。
 * ⇒ 这里只认**非空**的覆盖值（`if (override)` 一行同时兜住 `''` / `null` / `undefined`）。
 *
 * ⚠️ PATCH 那一侧**不能**这么做：那里没有"平台给的名字"可以回落（`display_name`
 *    这一列存的就是最终值），所以 `displayName: '   '` 是 **400**（`min(1)`）——
 *    "把显示名清空"这件事本身没有意义，而静默忽略它等于让编辑以为自己改成功了。
 *
 * ===========================================================================
 * 五、审计与缓存
 * ===========================================================================
 * ★ 加/改/删各写一条（spec §6.1 的 ★）：这是**对外可见的内容变更**，出问题时要知道是谁做的。
 *   · `entityType` 一律 `tracked_creator`、`entityId` 是那一行的 id（照 live 的 `live_channel`）；
 *   · `reason` **必须带上 platform + externalId**：删掉之后那一行就查不到了，
 *     而"删的是谁"正是事后唯一想知道的东西（`routes/live.ts` 的 DELETE 为此预读了一次）；
 *   · 被拒的请求（400 / 403 / 401 / 404）**一条审计都不写**：审计说的是"谁把什么改成了什么"，
 *     记一条没有发生的改动比少记一条更糟。
 *   · ★ `ip` 取 `x-real-ip`（`c.req.header('x-real-ip') ?? null`），**不用** `clientIp(c)`
 *     （T5 复审顺手修的一处）：后者优先读 `x-forwarded-for` 的**最左段**
 *     （`auth/ratelimit.ts` 那一行是**为限流**写的），而最左段是**调用方自己填得进去**的。
 *     审计是事后才翻的东西，没有任何东西会去核对它 —— 一条能自己编的"是谁"比没有更糟。
 *     本仓每一处内容审计都是这一行（`live.ts:249`、`videos.ts:257`、`resources.ts:406`、
 *     `calendar.ts:285`、`shares.ts:216`、`admin.ts:232`），追踪这三条原来是个**静默的例外**
 *     （没有任何断言看得见它）。现在有了一条：`tracking-routes.test.ts` 那一条同时喂两个头。
 * · 缓存：公开列表给 60 秒公开缓存（与视频墙、直播清单同一条）；两个 `live.manage`
 *   的端点一律 `no-store`（它们含只有编辑能看的采集状态，缓存住会漏给别人）。
 *
 * ===========================================================================
 * 六、★★ 这个文件里有**两个**时钟单位，选错哪一个都是"看起来对"的 bug
 * ===========================================================================
 * spec §4 的 ★★ 块（2026-09-16 补写）裁决：`tracked_creators` / `tracked_videos`
 * **整张表一律 Unix 秒**，理由是"上游给的就是秒"（bilibili 的 `created`），
 * 而**同一行里两个单位**是这一整类 bug 里最难查的一种（排序对、渲染错）。
 *
 * ⚠️ 但本文件**不能**把 `Date.now()` 一律换成秒 —— 它同时喂两张单位不同的表：
 *   · `tracked_creators.created_at / updated_at`（`createCreator` / `updateCreator`）
 *     → **秒**。数据层拿它直接做 `now - INCREMENTAL_INTERVAL_SEC`（= 3600）的比较，
 *     毫秒进来会让规格里的"一小时"变成 3.6 秒。
 *   · `audit_log.created_at`（`writeAudit` 的 `now`）→ **毫秒**。那张表是全仓的：
 *     `writeAudit` 一共 50 个调用点，除本文件这三处之外 **47 处全都传 `Date.now()`**
 *     （或由它赋值的局部 `now`）—— 那是核过的，不是印象。管理页也按毫秒渲染，
 *     这里给秒会让审计时间显示成 1970 年。
 * ⇒ 所以是"同一个时刻、两种表示"：`const nowMs = Date.now()` 读一次，
 *   `const nowSec = Math.floor(nowMs / 1000)` 由它换算（不取第二次 —— 见下）。
 *   ⚠️ 上一版缺的正是下半句：三处都只取了毫秒，于是 `created_at` 是毫秒、
 *   `last_synced_at`（T6 的 CLI 写）是秒，**同一行两个单位**。
 *   ⚠️ 不取两次 `Date.now()`：一次请求只有一个时刻，取两次会在跨过整秒边界时
 *   让同一件事的两条记录差一秒（`routes/calendar.ts:109` 是同一条纪律）。
 *   ⚠️ 界面渲染这类秒值**必须**经 `toMillis()`（`@mcsr/shared` 的 `tracking.ts`）——
 *   那里是这两张表唯一被允许跨单位的地方。裸的 `new Date(row.createdAt)` 就是一条真缺陷。
 */
import {
  TrackedCreatorInputSchema,
  TrackedVideoQuerySchema,
  type TrackPlatform,
} from '@mcsr/shared';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { type AuthVariables, requireCapability } from '../auth/middleware';
import {
  createCreator,
  deleteCreator,
  getCreator,
  listCreators,
  listTrackedVideos,
  updateCreator,
} from '../tracked-videos';
import { adapterFor } from '../tracking';
/*
 * ⚠️ 错误类型**住在两个文件里**，这不是笔误，是 T3 定下的分工
 * （`tracking/types.ts` 的文件头写着理由）：
 *   · `NoCredentialsError` / `PlatformHandshakeError` / `PlatformUnavailableError` /
 *     `InvalidCreatorInputError` 是**跨平台**的（注册表抛、三个适配器都抛），
 *     住在不依赖任何平台实现的 `types.ts`；
 *   · `BilibiliRateLimitError` / `BilibiliRejectedError` 只有 bilibili 会抛，
 *     就住在 `bilibili.ts` 里 —— 把它们搬进 `types.ts` 等于让"这个平台独有的
 *     风控语义"变成一个所有适配器都要知道的类型。
 * ⇒ 下面这张表因此从**两个**文件里取类型。那是"分类"本身的代价：
 *   要给一个平台专属的错误一个专属的回答，就得认识那个错误。
 */
import { BilibiliRateLimitError, BilibiliRejectedError } from '../tracking/bilibili';
import {
  type CreatorRef,
  InvalidCreatorInputError,
  NoCredentialsError,
  type PlatformAdapter,
  PlatformHandshakeError,
  PlatformUnavailableError,
} from '../tracking/types';
import { writeAudit } from '../users';

type TrackingContext = Context<{ Variables: AuthVariables }>;

/** 公开列表的缓存策略，与视频墙 / 直播清单保持一致。 */
const PUBLIC_CACHE = 'public, max-age=60, stale-while-revalidate=300';

// ---------------------------------------------------------------------------
// 依赖注入
// ---------------------------------------------------------------------------

/** 平台 → 适配器。生产上传的是 `tracking/index.ts` 的 `adapterFor`。 */
export type AdapterRegistry = (platform: TrackPlatform) => PlatformAdapter;

export interface TrackingRouteDeps {
  /**
   * 适配器注册表。⚠️ **必填、没有默认值** —— 理由见文件头第一节：
   * 默认值让"忘了注入"在生产上静默、在测试里全绿。
   */
  adapters: AdapterRegistry;
}

// ---------------------------------------------------------------------------
// 入参（形状与既有路由一致）
// ---------------------------------------------------------------------------

/** 校验失败时把 Zod 的问题整理成人能读的形态（与 videos / live 两处逐字相同）。 */
function formatIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues.map((i) => ({
    field: i.path.map(String).join('.') || '(root)',
    message: i.message,
  }));
}

/**
 * 公开列表的查询参数 —— ★ T7 起它住在 `packages/shared/src/tracking.ts`，**只有一份**。
 *
 * ⚠️ 这里原来自己写着这一份，并附了一条"schema 留在路由层"的理由。T7 落地时那条理由
 *    失效了（原话就写着"T7 落地时如果两处真的一样，这里该跟着搬"）：界面那一侧要按
 *    同一套规则拼 `?page=&pageSize=`，还要用同两个数字算总页数 ⇒ 两处各写一份的话，
 *    改一处就会让界面与服务端各说各的（表现是"翻到第 5 页 400"或"翻页静默回到第 1 页"）。
 *    完整的理由与被认下的代价（`z.coerce` 那条"HTTP 性质"跟着搬进了 shared）
 *    写在 shared 那份 schema 自己的注释里 —— 这里不再抄第二遍。
 */

/**
 * 改一个博主的入参：**三个字段都可选，但至少要给一个**。
 *
 * ⚠️ `.strict()` + `refine` 与本仓既有的 PATCH schema 逐字同形
 *    （`UserLiveLinkPatchSchema`）：多传一个不认识的键直接 400（不是被悄悄丢掉），
 *    而一个字段都没给也 400 —— 后者防的是"界面算错了差分、发来一个空补丁"，
 *    那种请求看着成功、实际什么都没改，而它连一条审计都不会留下。
 * ⚠️ `displayName` 的 `min(1)` 是**裁决 3 在 PATCH 那一侧的对应物**：`.trim()` 之后
 *    为空就是 400。理由见文件头第四节（这一侧没有"平台给的名字"可以回落）。
 * ⚠️ 上限 80 与 `TrackedCreatorInputSchema` 里那个 80 是**两处**（那个 schema 在
 *    `packages/shared/src/tracking.ts`，没有把数字导出成常量）。两者漂移的代价很小
 *    （一个显示名多几个字），但知道它们是一对就好 —— 改一处记得看另一处。
 */
const CreatorPatchSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1, { message: '显示名不能是空白（要清空就把它留空并提交？那件事这里没有）' })
      .max(80),
    enabled: z.boolean(),
    reBackfill: z.boolean(),
  })
  .partial()
  .strict()
  .refine(
    (value) =>
      value.displayName !== undefined ||
      value.enabled !== undefined ||
      value.reBackfill !== undefined,
    { message: '至少要改一个字段（displayName / enabled / reBackfill）' },
  );

// ---------------------------------------------------------------------------
// ★★ 适配器失败 → 状态码：唯一的映射表（七行）
// ---------------------------------------------------------------------------

/**
 * 入参那一侧的三个 reason。前端**按 reason 分派**（不是按 `invalid_input` 这个码：
 * 它同时兜着三种不同的入参问题），所以这三个字符串是**契约**，不是日志文案。
 *
 * · `unresolvable_input` —— 我们解析不出一个博主（贴错形状 / 平台判不出来）；
 * · `creator_not_found`  —— ★ 上游明确说"没有这个 mid"（`-404`，T5 复审的 Important 1）。
 *   ⚠️ 它**不**与上面那个合并：要人做的事不同（"改输入"vs"可能我们的分发/解析表要改"），
 *   而这两件事在日志里必须分得开。
 * · `duplicate`（下面用到时写的是字面量）—— 已经在名单上了。
 */
const UNRESOLVABLE_INPUT = 'unresolvable_input';
const CREATOR_NOT_FOUND = 'creator_not_found';

/**
 * 400：管理员贴进来的东西我们解析不出一个博主。
 *
 * ⚠️ 两个来源共用**同一个**回答，而且只此一处（`InvalidCreatorInputError` 那一行
 *    与"连平台都判不出来"那一条都调它）—— 分头写两份 body 的话，改了一处另一处
 *    就静默不一样了，而前端是**按 reason 定位输入框**的。
 * ⚠️ `creator_not_found`（`-404`）那一行**不走这里**：它的 reason 不同、含义也不同
 *    （一个是"我认不出"，一个是"上游说没有"），共用这个函数就等于把两者又合并回去。
 */
function unresolvable(c: TrackingContext) {
  return c.json({ error: 'invalid_input', reason: UNRESOLVABLE_INPUT }, 400);
}

/**
 * 分类表的一行。
 *
 * `body` 收 `unknown` 而不是某个具体错误类型：这张表要**混装**六个不同的类
 * （七行：`BilibiliRejectedError` 按 `-404` 占两行），
 * 而 TypeScript 的逆变会让"每行只收自己那个类型"的写法根本组不成数组。
 * 每一行自己的 `is` 就是判据，`body` 里要取字段就顺手再窄化一次（不用 `as`）。
 */
interface FailureRule {
  /** 日志里的分类名（也是这张表的行名，出问题时能直接对上文件头那张表）。 */
  kind: string;
  is: (error: unknown) => boolean;
  status: 400 | 429 | 502 | 503;
  body: (error: unknown) => Record<string, unknown>;
}

/**
 * ★★ **七类失败与它们的 HTTP 回答**（裁决 2 + T5 复审的两处，共七行）。
 * 理由与代价写在文件头第二节。
 *
 * ⚠️ 行**顺序即匹配顺序**：`BilibiliRejectedError` 那两行**不是**两两不重叠的 ——
 *    第一行按 `code === -404` 再分一次，所以**它必须在前面**（`find` 取第一个命中的行）。
 *    其余行的 `instanceof` 两两不重叠，顺序今天不影响结果；但整张表仍然是从
 *    "最具体"往"最泛"排的，将来加有继承关系的错误类型时同样是对的。
 * ⚠️ 这七类之外的异常**故意不在表里**：调用方拿 `null` 之后必须 `throw`（见下面的
 *    `classifyAdapterFailure`），让它走 index.ts 的 onError。
 */
const ADAPTER_FAILURES: readonly FailureRule[] = [
  {
    kind: 'InvalidCreatorInputError',
    is: (error) => error instanceof InvalidCreatorInputError,
    status: 400,
    // 详情（认不出的原因 + 管理员贴的原文）在 message 里，只进日志
    body: () => ({ error: 'invalid_input', reason: UNRESOLVABLE_INPUT }),
  },
  {
    /*
     * ★★ T5 复审的 Important 1：`-404` 从"我们的适配层和上游脱节了"里**拆出来**。
     *
     * `bilibili.ts:215` 逐字写着 `-404` 是"**这个 UP 不存在**"，而这条路每次贴一个
     * 不存在的 mid 都会走到它（`lookupDisplayName` 对任何非零 code 都抛）。
     * 报 502 时编辑看到的是 `apiErrorText` 的兜底「出错了，请稍后再试。」
     * —— 一句让他**一遍遍重贴同一条坏链接**的话，而真正要做的事（改链接）不会发生。
     * ⇒ 400 + `invalid_input` + `reason: 'creator_not_found'`（理由与被否掉的 404
     *   写在文件头第二节：400 是这个端点为"入参不对"已经在用的那一档，前端只需要
     *   一个按 reason 分派的读者；404 在本仓是"这个 URL 指向的东西不存在"，而且
     *   它在界面上同样是那句没用的兜底话）。
     * ⚠️ `kind` 里带着 `-404`：日志行因此仍然看得见上游的原始 code，
     *   万一上游哪天用 `-404` 表示别的意思，这里是唯一还记得区别的地方。
     */
    kind: 'BilibiliRejectedError(-404)',
    is: (error) => error instanceof BilibiliRejectedError && error.code === -404,
    status: 400,
    body: () => ({ error: 'invalid_input', reason: CREATOR_NOT_FOUND }),
  },
  {
    kind: 'NoCredentialsError',
    is: (error) => error instanceof NoCredentialsError,
    status: 503,
    body: (error) => ({
      error: 'platform_not_configured',
      // `is` 已经判过类型，这里再窄化一次只是为了让编译器看见（不用 `as`）
      platform: error instanceof NoCredentialsError ? error.platform : null,
    }),
  },
  {
    kind: 'BilibiliRateLimitError',
    is: (error) => error instanceof BilibiliRateLimitError,
    status: 429,
    // 不带 Retry-After / retryAfterSec：不知道风控什么时候松（文件头第二节那条）
    body: () => ({ error: 'rate_limited' }),
  },
  {
    kind: 'BilibiliRejectedError',
    is: (error) => error instanceof BilibiliRejectedError,
    status: 502,
    // 走到这里的 `-352` / 形状变了 / 非 JSON 都是"我们要改"（`-404` 已被上一行接走）
    body: () => ({ error: 'upstream_bad_response' }),
  },
  {
    kind: 'PlatformHandshakeError',
    is: (error) => error instanceof PlatformHandshakeError,
    status: 502,
    body: () => ({ error: 'upstream_bad_response' }),
  },
  {
    /*
     * ★ T5 复审的 Important 2：适配器**联系不上上游**（fetch 被拒 / 20 秒超时）。
     *   与握手失败同一个处置（502 "过一会儿再来"）—— 因为对调用方它就是同一句话。
     * ⚠️ 这一行**必须**由适配器抛出的类型接住，而不是靠这里加一个笼统的 `catch`：
     *   一个兜住一切的 `catch` 会把我们自己的 bug 也报成上游的天气，而**那类错
     *   重试永远不会成功**（代价写在文件头第二节末）。类型是这个分工的凭据。
     */
    kind: 'PlatformUnavailableError',
    is: (error) => error instanceof PlatformUnavailableError,
    status: 502,
    body: () => ({ error: 'upstream_bad_response' }),
  },
];

/**
 * 把上面七类翻译成 HTTP 回答；**不是这七类就返回 `null`**（调用方必须重新抛）。
 *
 * ★ 每一类都记一行日志，包括 400 那几条：这些动作都很罕见（管理员偶尔加一个博主），
 *   而"这条链接为什么认不出"将来唯一的证据就是那行 message（里面有输入原文）。
 *   ⚠️ 细节**只**在这行日志里 —— 响应体里永远没有上游的 code / 原文 / 平台内部状态。
 *   ⚠️ 这行日志**也有断言**（`tracking-routes.test.ts` 的 `postAsEditorWithLog`）：
 *      它是"细节只进日志"这句话的另一半 —— 少了它，一次失败在两边都留不下痕迹，
 *      而删掉这一行不会让任何"响应体里没有细节"的断言变红。
 */
function classifyAdapterFailure(c: TrackingContext, error: unknown): Response | null {
  const rule = ADAPTER_FAILURES.find((row) => row.is(error));
  if (!rule) return null;

  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[tracking] 加博主失败（${rule.kind}）：${detail}`);
  return c.json(rule.body(error), rule.status);
}

// ---------------------------------------------------------------------------
// 平台分发（只回答"交给谁"，见文件头第三节）
// ---------------------------------------------------------------------------

/** 纯数字的 mid（spec §5.1：bilibili 的 `resolveCreator` 直接收一串数字）。 */
const BARE_MID = /^\d{1,20}$/;
/** `@handle`（spec §5.2）。⚠️ 它的形状要**够具体**：光看首字符的话，`'@'` 也会被派给 youtube。 */
const AT_HANDLE = /^@[A-Za-z0-9._-]{1,64}$/;

/** host → 平台。⚠️ 认的是**主机名**，不是"包含某个词"（`evil.com/?x=bilibili.com` 必须是认不出）。 */
const PLATFORM_HOSTS: ReadonlyArray<{ platform: TrackPlatform; hosts: readonly string[] }> = [
  { platform: 'bilibili', hosts: ['space.bilibili.com', 'b23.tv', 'bilibili.com'] },
  { platform: 'youtube', hosts: ['youtube.com', 'm.youtube.com', 'youtu.be'] },
  { platform: 'twitch', hosts: ['twitch.tv', 'm.twitch.tv'] },
];

/**
 * "这条输入是哪个平台的" —— **只分发，不解析**。
 *
 * 返回 `null` = 我们连它是哪个平台都判不出来 ⇒ 400（不问任何适配器，因为问了也没人认领）。
 * ⚠️ 它认的是 spec §5.1–5.3 逐字写下的那三种输入形状（链接 / 纯数字 mid / `@handle`）。
 */
function platformOfInput(raw: string): TrackPlatform | null {
  const input = raw.trim();
  if (input === '') return null;
  if (BARE_MID.test(input)) return 'bilibili';
  if (AT_HANDLE.test(input)) return 'youtube';

  let url: URL;
  try {
    /*
     * 没有协议的（`space.bilibili.com/123`）补一个 https 再解析 —— 从地址栏复制出来的
     * 东西通常没有协议（bilibili 的适配器里也写着同一条）。
     */
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  for (const entry of PLATFORM_HOSTS) {
    if (entry.hosts.includes(host)) return entry.platform;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 审计
// ---------------------------------------------------------------------------

/**
 * PATCH 的审计里"改了什么"。
 *
 * ⚠️ 它列的是**调用方给了的字段**，不是"真的变了的字段"：路由手里没有 changed 标志
 *    （`updateCreator` 不返回它），而"给了哪几个字段"就是这次请求本身。
 *    代价写在明面上：把 `enabled` 改成它本来就有的值也会留下一条 update 审计 ——
 *    与 `routes/live.ts` 的 PATCH 同一条（那条也是"成功即写审计"；
 *    "空操作不写审计"那条纪律属于**有 changed 标志**的那类端点，比如 live 的 visibility）。
 */
function patchReason(patch: {
  displayName?: string;
  enabled?: boolean;
  reBackfill?: boolean;
}): string {
  const parts: string[] = [];
  if (patch.displayName !== undefined) parts.push(`displayName=${patch.displayName}`);
  if (patch.enabled !== undefined) parts.push(`enabled=${String(patch.enabled)}`);
  if (patch.reBackfill !== undefined) parts.push(`reBackfill=${String(patch.reBackfill)}`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------

export function createTrackingRoute(deps: TrackingRouteDeps): Hono<{ Variables: AuthVariables }> {
  const trackingRoute = new Hono<{ Variables: AuthVariables }>();

  // -------------------------------------------------------------------------
  // 读：公开列表
  // -------------------------------------------------------------------------

  /**
   * 追踪到的视频。**公开**（不挂任何鉴权中间件）—— 浏览不设门槛是访问模型
   * （`docs/v1-plan.md §0.1`）的核心。
   *
   * ⚠️★ `status = 'visible'` 的过滤在**数据层**（`listTrackedVideos`），这里一个条件都不加、
   *    也不开 `?includeHidden=1` 那样的口子（裁决 4）：加第二道过滤或开一个口子，
   *    都会让"公开列表该显示什么"有两个答案，而两处一旦漂移，
   *    表现是"编辑隐藏过的视频还挂在公开列表上"（spec §6.1 那一行就是为这件事写的）。
   *
   * ★ `?platform=` 是**另一件事**（spec §5.1）：它筛的是**分区**（界面上那排按钮，
   *    T7 会把 URL 上的 `tplatform` 译成它）—— 它不回答"什么能出现在公开列表上"，
   *    那句话仍然只有数据层那一个 `WHERE` 说了算（`listTrackedVideos` 把分区条件与
   *    `status` 拼在**同一处**，`items` 与 `total` 共用它）。
   *    ⚠️ 所以透传它**不**违反上面那一条：多一个分区的筛选项，不等于可见性多一个答案。
   */
  trackingRoute.get('/videos', (c) => {
    const parsed = TrackedVideoQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: 'invalid_query', issues: formatIssues(parsed.error) }, 400);
    }

    const { page, pageSize, platform } = parsed.data;
    /*
     * ⚠️ `...(platform === undefined ? {} : { platform })` 是计划（brief step 4）逐字冻结的形状，
     *    **不要简化成 `platform,`**：它要说的是"这个键**不在**"，而不是"传一个 `undefined` 进去"——
     *    而 `listTrackedVideos` 的 `platform?: TrackPlatform` 读的正是"键在不在"这件事
     *    （不传 = 全部，传了 = 只出那个平台）。
     *    ⚠️ 照实记一句（别照抄计划给的那个理由）：计划说它"是 `exactOptionalPropertyTypes`
     *    逼出来的、直传过不了编译"，而**本仓那个开关是 `false`**（`tsconfig.base.json:17`）——
     *    实测直传 `platform,` 今天能过 `tsc`（T4 报告 §7.1 的四次对照）。
     *    这一行因此不是"今天必须这么写"，而是"那个开关哪天打开时**唯一**在这里不红的写法"
     *    （同一次对照：强制打开之后这一处是 TS2379，展开这版不是）。
     */
    const { items, total } = listTrackedVideos({
      limit: pageSize,
      offset: (page - 1) * pageSize,
      ...(platform === undefined ? {} : { platform }),
    });

    c.header('Cache-Control', PUBLIC_CACHE);
    // 形状与视频墙逐字一致（items / total / page / pageSize）：两个列表共用一套分页控件
    return c.json({ items, total, page, pageSize });
  });

  /**
   * 名单（管理面板那一份，含采集状态）。**必须 no-store**：它含只有编辑能看的东西
   * （上次错误、连续失败次数），任何一层缓存住都会漏给别人
   * （`routes/live.ts` 的 `/live/manage` 写着同一条）。
   */
  trackingRoute.get('/creators', requireCapability('live.manage'), (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ items: listCreators() });
  });

  // -------------------------------------------------------------------------
  // 写：加一个博主
  // -------------------------------------------------------------------------

  /**
   * 加一个博主。入参**只有 `input`**（一个链接或 `@handle`）—— 平台与 id 全由服务端
   * 推导（spec §5.1 的裁决，与 `VideoInputSchema` 同一条：用户手里就是一条链接，
   * 逼他拆成两个字段一定会有人把 mid 填进 platform 那一栏）。
   */
  trackingRoute.post('/creators', requireCapability('live.manage'), async (c) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'unauthorized' }, 401);

    const body = await c.req.json().catch(() => null);
    const parsed = TrackedCreatorInputSchema.safeParse(body ?? {});
    if (!parsed.success) {
      // 形状问题走 issues（前端按字段渲染），语义问题才走 reason —— 两种形状各有各的读者
      return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
    }

    const input = parsed.data.input;
    const platform = platformOfInput(input);
    if (platform === null) {
      // 连"交给谁"都判不出来 ⇒ 不问任何适配器（问了也没人认领，而 b23 那条路会联网）
      console.error(`[tracking] 加博主失败（认不出平台）：${input.slice(0, 300)}`);
      return unresolvable(c);
    }

    let ref: CreatorRef;
    try {
      ref = await deps.adapters(platform).resolveCreator(input);
      /*
       * ⚠️ 适配器回的平台必须与它自己所属的平台一致。它防的是**不会抛**的那一类错
       * （同一个纪律见 `tracked-videos.ts` 的 `upsertVideos`）：某个适配器复制粘贴时
       * 忘了改 `platform`，表现是这个博主的**全部视频**被记在另一个平台下，
       * 而两张表各自都是合法的、数据库拦不住。代价是一个比较。
       */
      if (ref.platform !== platform) {
        throw new Error(`适配器 ${platform} 回了一个 ${ref.platform} 的 CreatorRef`);
      }
    } catch (error) {
      const classified = classifyAdapterFailure(c, error);
      // 不是那五类 ⇒ 我们的 bug ⇒ 重新抛（index.ts 的 onError 会记 500 与堆栈）
      if (!classified) throw error;
      return classified;
    }

    /*
     * ★ 裁决 3：`if (override)` 一行同时兜住 `''`（纯空白 trim 之后的形状）、
     *   `null` 与 `undefined` —— 三种都是"没填"。理由见文件头第四节。
     */
    const override = parsed.data.displayName;
    if (override) ref = { ...ref, displayName: override };

    /*
     * ★★ 这个请求里有**两个**时钟单位 —— 两个都要，而且判据不同（spec §4 的 ★★ 裁决）：
     *   · `nowSec` → 本栏目的**两张表**（`tracked_creators` / `tracked_videos`）：
     *     一律 **Unix 秒**。上游 bilibili 的 `created` 就是秒，而 `tracked-videos.ts` 的
     *     `INCREMENTAL_INTERVAL_SEC = 3600` 是**直接**与这个数相减的 ⇒ 这里给毫秒的话，
     *     规格里那个"一小时"会变成 3.6 秒，整份名单每一轮都被判成"该增量了"。
     *   · `nowMs` → `audit_log.created_at`：那是**全仓毫秒**的表（`users.ts` 的
     *     `writeAudit` 只是把传进来的数原样写进去，而它的另外 47 个调用点给的都是
     *     `Date.now()`，管理页也按毫秒渲染）。这里给秒的话，审计时间会变成 1970 年。
     * ⇒ 两个都从**同一次** `Date.now()` 读出来换算，不取两次：一次请求只有一个时刻，
     *   取两次会在跨过整秒边界时让同一件事的两条记录差一秒（同一条纪律见
     *   `routes/calendar.ts:109`）。
     */
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const result = createCreator(ref, user.id, nowSec);
    if (!result.ok) {
      /*
       * ★ 裁决 1：重复**是 400 + 机器可读的 reason**，不是 500。
       *   数据层返回的是一个**联合**（`{ok:false, reason:'duplicate', existingId}`），
       *   因为它拒绝按 message 文本判"重复"（那段注释在 `tracked-videos.ts`）——
       *   也就是说这个分支不认它的话，重复添加就只能变成一次内部错误。
       * ⚠️ `existingId` 一起带上：加的人需要的是"去看那一条"，不是一句"出错了"
       *   （与 `live_exists` / `video_exists` 同一条；这里用 reason 而不是新错误码，
       *   因为 400 的读者是**输入框**，不是错误提示）。
       */
      return c.json(
        { error: 'invalid_input', reason: 'duplicate', existingId: result.existingId },
        400,
      );
    }

    writeAudit({
      actorId: user.id,
      action: 'tracked_creator.create',
      entityType: 'tracked_creator',
      entityId: result.creator.id,
      reason: `${ref.platform} ${ref.externalId}`,
      ip: c.req.header('x-real-ip') ?? null,
      now: nowMs,
    });

    return c.json({ ok: true, creator: result.creator }, 201);
  });

  // -------------------------------------------------------------------------
  // 写：改 / 删
  // -------------------------------------------------------------------------

  /** 改显示名 / 停用启用 / 重新回填（spec §6.1）。不存在的 id ⇒ 404。 */
  trackingRoute.patch('/creators/:id', requireCapability('live.manage'), async (c) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'unauthorized' }, 401);

    const body = await c.req.json().catch(() => null);
    const parsed = CreatorPatchSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
    }

    const id = c.req.param('id');
    // ★★ 与 POST 同一条裁决：两张表吃**秒**、`audit_log` 吃**毫秒**（那段理由写在上面）
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    /*
     * ⚠️ `nowSec` 由**这里**取一次再传进去（数据层不看时钟：那是 2026-09-16 的裁决，
     *    理由写在 `tracked-videos.ts` 的文件头第六节）。返回 `null` = 这一行不存在。
     */
    const creator = updateCreator(id, parsed.data, nowSec);
    if (!creator) return c.json({ error: 'not_found' }, 404);

    writeAudit({
      actorId: user.id,
      action: 'tracked_creator.update',
      entityType: 'tracked_creator',
      entityId: id,
      reason: patchReason(parsed.data),
      ip: c.req.header('x-real-ip') ?? null,
      now: nowMs,
    });

    return c.json({ ok: true, creator });
  });

  /** 删一个博主。他的视频靠 `ON DELETE CASCADE` 跟着走（spec §4.2）。 */
  trackingRoute.delete('/creators/:id', requireCapability('live.manage'), (c) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'unauthorized' }, 401);

    const id = c.req.param('id');
    /*
     * ★ 预读一次（`routes/live.ts` 的 DELETE 是同一条）：删掉之后那一行就查不到了，
     *   而审计里的 `reason` 要留下"删的是哪个平台的谁" —— 那是事后唯一想知道的东西。
     *   ⚠️ 不用"读整份名单再 find"来省一次导出：`listCreators` 带着
     *   `LEFT JOIN tracked_videos` 的聚合，为了取一行而去数几万条视频不划算。
     */
    const existing = getCreator(id);
    if (!existing) return c.json({ error: 'not_found' }, 404);

    /*
     * ⚠️ 这一条路上**只有毫秒**：`deleteCreator(id)` 一个时间列都不写
     *    （`tracked-videos.ts` 的文件头第六节点名说过），所以这里没有"秒"的那一半，
     *    `nowMs` 只喂 `audit_log`（那是全仓毫秒的表 —— 见 POST 那段）。
     */
    const nowMs = Date.now();
    // 预读到、删不到：只有并发（另一个编辑同时删了它）能走到这里 ⇒ 与"本来就没有"同一个回答
    if (!deleteCreator(id)) return c.json({ error: 'not_found' }, 404);

    writeAudit({
      actorId: user.id,
      action: 'tracked_creator.delete',
      entityType: 'tracked_creator',
      entityId: id,
      reason: `${existing.platform} ${existing.externalId}`,
      ip: c.req.header('x-real-ip') ?? null,
      now: nowMs,
    });

    return c.json({ ok: true, id });
  });

  return trackingRoute;
}

/**
 * 生产上挂的那一个（`index.ts` 用的就是这个）。
 *
 * ⚠️ 它传的是**真的**注册表（`adapterFor`）：youtube / twitch 今天会在这里抛
 * `NoCredentialsError`（spec §2.7 实测生产上一个 key 都没有），而那条路正好被
 * 上面那张表的第二行接住 ⇒ **503 "这个平台没有配置"**，不是崩、也不是 500。
 * 这正是 spec §9.1 ⑧ 要的形状。
 */
export const trackingRoute = createTrackingRoute({ adapters: adapterFor });
