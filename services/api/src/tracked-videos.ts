/**
 * 追踪的博主与他们的全部视频 —— **数据层**。
 *
 * 三个消费方，各有各要的东西：
 *   · **T5 的路由** —— 名单（含采集状态）、公开视频列表、加/改/删；
 *   · **T6 的 CLI** —— `pickDueCreators` 挑待办、`upsertVideos` 写回来、
 *     `advanceCursor` / `recordFailure` 记录这一轮的结果；
 *   · **T8 的适配器** —— 它自己不碰数据库，判 bilibili"到底了"的那个
 *     `storedTotal` 由 CLI 拿 `storedVideoCount()` 喂进去（spec §5.4）。
 *
 * 表结构与每一列的由来在 `db/migrations/020_tracked_videos.ts` 的文件头；
 * 对外形状在 `packages/shared/src/tracking.ts` 的文件头。这里只写**本层自己的**决定。
 *
 * ===========================================================================
 * 一、这一层不判权限、不看请求、也不猜：收的是已经归一化好的形状
 * ===========================================================================
 * 与 `live-shares.ts` / `contributors.ts` 同一分工：入参解析（zod）在路由层，
 * 平台解析（链接 → CreatorRef）在适配器，这里只做"形状 ↔ 行"的往返。
 * ⚠️ 唯一的例外是 `createCreator` 的重复：它不只是"插进去"，还要把数据库那条
 *    `UNIQUE (platform, external_id)` 的拒绝翻译成一个**调用方能用的理由**
 *    （见那个函数的注释）—— 那是本层必须回答的问题，不是路由能猜的。
 *
 * ===========================================================================
 * 二、★★ `storedVideoCount` 必须**恰好**是"这个 creator 的行数"
 * ===========================================================================
 * 它是 spec §5.1 那个"到底了"判据的一半（`returned < ps` **且**
 * `storedTotal >= page.count`），而 §5.1 底下那段**残余风险**就是关于它的。
 * ⇒ 判据只有一句话：**这一行**。不许按 `status` 过滤、不许按平台过滤、不许按时间过滤。
 *
 * 两个方向都试过，两边都是"不报错的错"：
 *   · **少算**（比如只数 `status = 'visible'` 的）⇒ 一个 UP 主的视频里有几条被隐藏
 *     （核对的 `upstream_gone` 或手工改库）时，`storedTotal` 永远比上游的 `count` 小
 *     ⇒ `reachedEnd` **永远不为真** ⇒ 回填永远翻不完（不是丢数据，是这个频道
 *     **永远停不下来**，每轮都在重翻）。
 *   · **多算**（比如把别的 creator 的行也算进来）⇒ `reachedEnd` **提前**为真 ⇒
 *     这个 UP 主最后那几条真视频**永远抓不到**，而且没有任何异常可抓（§2.4 那类静默丢数据）。
 * ⇒ 所以这个函数短得"没什么可看的"，那是它的优点，不是它偷懒。改它之前先读 §5.1。
 *
 * ⚠️ 与它**故意不一样**的那个数是公开列表的 `total`：那是给人看的，隐藏了就不该出现
 *    （`videos.ts:274` 同一条纪律）。两个数都叫"有多少条"，回答的却是两个问题 ——
 *    别把它们"统一"掉。
 *
 * ===========================================================================
 * 三、★★ 时长不是正整数 ⇒ 存 `NULL`（本层是那个 `0` 的最后一道闸）
 * ===========================================================================
 * spec §4.3 的判据是**字面**的：`duration_sec <= 60` ⇒ `short`。所以
 * `deriveTags({ durationSec: 0 })` 返回 `['short']`，而这是**裁决过**的行为
 * （T2 的文件头写了：`packages/shared/src/tracking.ts:59` 的"填 0 会让 short 打错"）。
 * T2 的三个解析器因此一个 0 都不产出，也没有负数出口。
 *
 * ⚠️ 但"写库"是**另一条路**（T2 的文件头原话）。将来某个适配器自己算出时长、
 *    有人手工补数据、或者第五个平台带着自己的算法进来，都会走到这里 ——
 *    而那时的表现是**库里多出一支"0 秒短视频"**，带着一个看起来完全正常的 `short` 标签，
 *    没有任何异常可抓。⇒ 这一层的契约：`duration_sec` **只接受正整数**，其余一律 `NULL`
 *    （`NULL` 是允许的状态：§4.3 说没有时长就一个时长标签都不打）。
 *
 * 被否掉的两种做法与各自的代价：
 *   · **在迁移 020 上加 `CHECK (duration_sec IS NULL OR duration_sec > 0)`** ——
 *     那是**结构上**更结实的做法，但 DDL 已按 spec §4.1/§4.2 冻结、并且有一条逐列
 *     比对的测试钉着（`tracking-schema.test.ts` ②）；改它要动的是 spec 的冻结表，
 *     而这一轮的裁决是"把这条规则路由到数据层"。代价：这道闸只在**走本层**的写路径上生效。
 *   · **信任上游**（"T2 已经保证只出 null 或正整数"）—— 代价写在上面：它防的是将来越界的那条路，
 *     而那正是"看起来完全正常"的错标签会长出来的地方。
 *
 * ⚠️ 归一化后的那个值**同时**喂给 `deriveTags`：`duration_sec` 与 `tags` 必须说同一件事。
 *    分开取的话会出现"库里时长是 NULL、标签却是 `["short"]`"的行 —— 两个字段互相矛盾，
 *    而界面上只是显示出一个小标签。
 *
 * ===========================================================================
 * 四、★★ upsert 的列与绑定：**位置绑定错了不会抛，只会写错列**
 * ===========================================================================
 * `INSERT ... VALUES (?,?,?)` 是按**位置**绑的。把 `view_count` 与 `comment_count`
 * 的参数调换，SQL 依然合法、`CHECK` 依然过得去、行照样写进去 —— 只是两列的值互换了，
 *    而**没有任何地方会报错**（spec §4.2 的"看起来像一条真实数据"，另一种形状）。
 * ⇒ 两个防线：`.run(...)` 的每一个实参后面都跟着一行注释说明它进的是哪一列；
 *    以及 `tracking-store.test.ts` 里那条**逐列**断言的用例（只断言"有几行"抓不到这个）。
 * 同理，`ON CONFLICT` 的列清单必须与迁移 020 声明的
 * `UNIQUE (platform, external_id)` **完全一致** —— 对不上时 SQLite 会当场报
 * `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`（这一条会抛，算是幸运的）。
 *
 * ===========================================================================
 * 五、`DO UPDATE` 里有三列**故意不在**（每条都有它防的事）
 * ===========================================================================
 *   · `creator_id` —— 视频换不了作者。跟着更新的话，一批视频会**悄悄换归属**
 *     （A 的条数掉了、B 的多出来了，两边都不报错）。
 *   · `first_seen_at` —— "第一次见到它"的时刻。补录旧视频时它与 `published_at`
 *     能差好几年，被后来的抓取改写之后，那个信息就真没了。
 *   · `status` —— ★ 被隐藏过的视频不许被抓取放回来。今天的写入者**只有一个**：
 *     核对阶段（`applyVerifyResult`，上游不再认这条 id 时写 `upstream_gone`），
 *     外加**手工改库**（v1 没有隐藏端点，spec §6.1 里只有五个）。
 *     `DO UPDATE` 里捎上 `status = excluded.status` 的表现是"隐藏过的那支过十分钟又出现了"
 *     —— 而它现在会**抵消掉**核对刚做的那件事（下架了又自己回来），且没有任何地方报错。
 *     `tracking-store.test.ts` 里有一条专门钉它（plans/task-4 mutation 表点名的那条）。
 *
 * ===========================================================================
 * 六、时钟：`now` 一律由调用方传进来（**两处签名因此与计划里的列表不同**）
 * ===========================================================================
 * 本仓的既有纪律（`live-shares.ts` 文件头）：**这一层不看时钟** ——
 * `createShare` 的 `now` 由路由在一个请求里取一次，`serverNow` 与它同源。
 *
 * ⚠️ 计划（task-4-brief）给的两个签名**没有** `now`：
 *    `createCreator(ref, addedBy)` 与 `updateCreator(id, patch)`。照字面实现的话，
 *    这一层就得自己读 `Date.now()`，后果是**具体的两件事**：
 *      · `created_at` / `updated_at` 在测试里不可控 ⇒ "改过就要动 updated_at"
 *        这类断言只能写成"大概差不多"，而那种断言不会红；
 *      · 同一次 CLI 运行里写进去的几行会各带一个**不同**的时间戳，
 *        而 spec §6.3 的摘要、管理面板的"上次同步"都是按这些时间读的。
 *    ⇒ 两个函数各加一个**必填**的 `now`（不加默认值：有默认值就等于允许不传，
 *      而那正是上面那两件事的入口）。代价写清楚：T5 的路由要多取一次时钟
 *      （与它给 `recordFailure` / `advanceCursor` 的是同一个 `now`）。
 *    `deleteCreator(id)` 保持**没有** `now` —— 它一个时间列都不写。
 *    其余五个函数本来就有 `now`（计划里逐字带着）。
 *
 * ===========================================================================
 * 七、待办**从状态推导**，没有队列表（spec §3.2 / §3.4）
 * ===========================================================================
 *   · 该回填的：`backfill_done = 0 AND enabled = 1`
 *   · 该增量的：`backfill_done = 1 AND enabled = 1 AND last_synced_at < now - 3600`
 * ★ `enabled = 0` 要在**两边**都排除（裁决 2）：停用的博主只是停了 ——
 *   行与视频都留着，但既不回填也不增量。漏掉一边的表现是"停用之后他还在被增量同步"，
 *   而管理面板上那一行明明写着"已停用"。
 *
 * ★★ **排序是公平性的一部分，不是装饰**（2026-09-16 裁决，两条查询同一条规则）：
 *
 * ```sql
 * ORDER BY consecutive_failures ASC, COALESCE(last_synced_at, 0) ASC, id ASC
 * ```
 *
 * 它防的是**饿死**，而饿死是这一层**唯一**能造成的"整份名单停摆"：返回是**有界**的
 * （`limits.backfill` / `limits.incremental` 是 spec §3.3 表达"一次运行有界"的**唯一**一处），
 * 而 `recordFailure` **故意不动 `last_synced_at`**（那是**成功**的水位，见那个函数）。
 * 两件事合起来之后，一个**永远抓不到**的博主（频道被删、链接永久 404、持续 -412 风控）
 * 在库里与"刚加进来、还没抓过"的行**长得一模一样**：`last_synced_at` 是 NULL、
 * `backfill_done` 是 0 ⇒ 它**每一轮**都算"到点"。今天没有顺序的话，
 * `LIMIT 20` 每次挑出来的都可能是同样的 20 个坏博主（SQLite 不保证顺序，实际就是扫描顺序）
 * ⇒ 名单上其余的人**永远轮不到**，而且每一轮都"成功跑完"、日志里一行错都没有。
 * 具体到数字：`limits.backfill = 20` 遇上 20 个永久坏掉的频道 = **全名单饿死**。
 *
 * ⇒ 用**两个已经存在的列**表达（不加列、不动迁移 020）：
 *   · `consecutive_failures ASC` —— 失败过的沉到后面，**一直失败的越沉越深**
 *     （那一列只在一次成功时清零，所以"起来了"的博主会自己回到前面）；
 *   · `COALESCE(last_synced_at, 0) ASC` —— 同一档里**从没成功过**的排最前
 *     （NULL ⇒ `0` ⇒ 最小，这正是想要的：新加的博主先跑一轮），然后是最久没同步的。
 *     ⚠️ `COALESCE` 写出来而不是靠 `ORDER BY last_synced_at ASC` 那条隐式规则
 *     （SQLite 里 NULL 在 ASC 时排最前）：两者的结果**今天**一样，但后者依赖一条
 *     "读的人得知道 SQL 怎么排 NULL"的规则，而这条 SQL 的意图必须自己读得出来 ——
 *     与下面那个 `IS NULL` 分支同一条理由。
 *   · `id ASC` 只负责**稳定性**，与公平无关：id 是随机 UUID，它保证的是
 *     "同一个状态查两次给同一个顺序"（重试、翻页、日志对照都靠它）。
 *
 * 被否掉的做法（代价写在明面上）：**给失败的博主做退避**（写一个 `next_due_at` 列）——
 *   那是"更彻底"的方案，但它要动迁移 020 的 DDL（已冻结、有逐列测试钉着），
 *   而且当场要回答"退避多久"这个**没有依据**的问题（5 分钟？1 小时？指数？）。
 *   现成的两列表达的是同一条意图（坏的在后面、新来的在前面），代价是：
 *   **坏博主仍然每轮占一个名额，只是排在最后** —— 真要把它彻底隔离在限额之外，
 *   那是 T6 的事（`consecutive_failures` 到了某个数就跳过），不是这一层的。
 *
 * ★★ **2026-09-17 补：那次退避真的做了**（`docs/pending.md` §5.98 的处置，
 *    迁移 **022** 的 `cooldown_until`）。当年列出的两个障碍现在都有答案：
 *      · DDL 冻结 ⇒ **不动 020**，加**一条新迁移**（020 一个字没改，逐列测试照旧钉着）；
 *      · "退避多久没依据" ⇒ 依据来了，而且是外部的：生产的出口 IP 被 bilibili 风控
 *        盯上之后每 10 分钟喂一次失败请求（`-352`/`412`），冻结值因此是
 *        **连续 3 次失败 ⇒ 冷却 3600 秒**（`COOLDOWN_AFTER_FAILURES` / `COOLDOWN_SEC`，
 *        §10 那张表里也记着）。
 *    ⚠️ 与上面那段的关系：**排序那两键一个字都没改**（成功的水位、饿死的分析全都还成立），
 *    冷却只是多了一句 `WHERE`（"还在冷却里的不挑"）。两者不重叠 —— 冷却解决的是
 *    "别再喂一个已经明显失败的目标"，排序解决的是"没在冷却的那些人之间的公平"。
 *    ⚠️ 代价也跟着换了位置：坏博主不再占名额（好事），但冷却窗口内那个频道
 *    **一次都不会被试**（窗口一到自动回来，不是放弃他 —— `RECORD_FAILURE_SQL` 那条 CASE）。
 *
 * ⚠️ 另两处**不照字面**的地方，都写在这里：
 *   ① `last_synced_at IS NULL` 也进增量。字面照抄的话 `NULL < 任何数` 是 NULL ⇒
 *      这一行**永远不会**到点。它在今天的写入路径上到不了（`advanceCursor` 把
 *      `backfill_done` 与 `last_synced_at` 一起写），但真出现时的表现是"这个博主
 *      再也不会被同步"，而**没有任何地方会报错** —— 与本功能最怕的那个坑同一类。
 *      （`tracking-store.test.ts` ④ 有一条专门钉它。）
 *   ② `limits` 里的非正整数一律当 0。⚠️ `LIMIT -1` 在 SQLite 里是"**不限**"，
 *      不是"最多 -1 个"：一个负数漏进来的表现是**这一轮把整份名单都抓一遍** ——
 *      spec §3.3 的"每次运行是有界的"全靠这几个 LIMIT 表达，而它就这么没了。
 *      被否掉的做法是"负数就抛"：代价是把一个调用方的笔误变成一个运行期异常，
 *      而"这一轮什么都不做"是安全的那一侧（下一轮照常）。
 *
 * ===========================================================================
 * 八、行 → 形状只有一处；SQL 里一个 `SELECT *` 都没有
 * ===========================================================================
 * `toCreator` / `toStoredCreator` / `toTrackedVideo` 是唯一的三个转换点。
 * 列名**逐列写出来**（不用星号），理由与 `live-shares.ts:89-93` 同一条：
 * 多带一列从响应上看不出来，所以每一列都必须显式加一行。
 * （`pickVerifiableVideos` 是唯一的例外，见第九节末尾。）
 *
 * ===========================================================================
 * 九、★ 核对：**轮转游标** + "在的与不在的都写"（spec §6.1 / §6.2）
 * ===========================================================================
 * 两句话，各防一件**不报错**的事：
 *   · **挑**（`pickVerifiableVideos`）：`COALESCE(verify_checked_at, 0) ASC` 是轮转游标，
 *     不是"最新的优先" —— 理由与 `pickDueCreators` 的排序**逐字相同**（第七节）：
 *     最新优先会让同一批新视频每轮都被问一遍，而**老的那些永远轮不到**，
 *     每一轮还"成功跑完"、日志里一行错都没有。
 *   · **写**（`applyVerifyResult`）：每一个被问到的 id 都写 `verify_checked_at`，
 *     **包括上游还在的那些**。只写"消失的"那些的话，轮转游标会把整批再挑一次 ——
 *     那不算错（再问一遍是幂等的），只是白问，而且**永远白问同一批**。
 *
 * ⚠️★ 这一层**不做"部分成功"**：`existingVideoIds` 要么给出完整集合、要么抛
 *    （`tracking/types.ts` 里那个方法头上写着"失败必须抛，绝不许当成这些 id 都不存在"），
 *    所以"失败 ⇒ 一条都不隐藏、连 `verify_checked_at` 都不写"这条防线长在**调用方**
 *    （`track.ts` 的核对阶段），不在这里。
 *    在这里"猜一半"的表现会是**静默的批量下架**：请求超时 ⇒ 差集=全部 ⇒ 整批转 hidden。
 *    ⚠️★ 而**第三种情形**（答案完整、但长得不像真的 ⇒ 调用方的比值闸选择不照它动手）
 *    走的是本文件的 `markCheckedWithoutHiding`：**只盖章、不隐藏** ——
 *    "不问"与"问了但不作数"是两件事，那个函数头上写着为什么。
 *
 * ⚠️ `status = 'hidden'` 今天**只有一个写入者**：本文件的 `applyVerifyResult`（CLI 的核对阶段
 *    用 `upstream_gone` 写它，spec §6.2）。**它不是"编辑直接改库"设的**了 ——
 *    而 v1 仍然**没有隐藏端点**（spec §6.1 里只有五个端点），所以除了这一条路之外，
 *    改它只有"手工动数据库"这一种办法。`hidden_reason` 的词表今天只有一个值
 *    `upstream_gone`（spec §3.2 冻结）；将来要加"人工隐藏"必须加**新值**，不许复用这一个。
 *
 * ⚠️ 第九节唯一的"不算转换点"的地方：`pickVerifiableVideos` 的列少（三格）、形状平，
 *    再摆一个 `toVerifiableVideo` 只会多一处将来会漂的东西 —— 所以它直接在 SQL 里
 *    用 `external_id AS externalId` 起别名（这一条是本文件里**唯一**的驼峰别名；
 *    其余每一处都是 snake_case + 上面的三个转换点，例如同一句里的 `video_count`）。
 */
import type {
  TrackedCreator,
  TrackedCreatorSummary,
  TrackedSort,
  TrackedVideo,
  TrackedVideoTag,
  TrackPlatform,
} from '@mcsr/shared';
import { newId } from './auth/tokens';
import { getDb } from './db';
import { deriveTags } from './tracking/parse';
import type { CreatorRef, FetchedVideo } from './tracking/types';

/** 增量同步的间隔（秒）。spec §3.2 / §10 冻结值：一小时。 */
const INCREMENTAL_INTERVAL_SEC = 3600;

/**
 * 连续失败满几次就进**冷却**（spec §10 冻结值，2026-09-17 加）。
 *
 * ★ 为什么是 3：timer 每 10 分钟一轮，所以 3 次 = **连续半小时**都在失败 ——
 *   比"一次抖动"（bilibili 的 `-412` 是概率性的，下一轮自己会好）长得多，
 *   又比"等一小时再试"短得多。这个数**不是**用来判断"这个频道坏了"的
 *   （那是 `enabled`，编辑的决定），它只回答"现在还要不要继续喂这一次失败"。
 */
export const COOLDOWN_AFTER_FAILURES = 3;

/**
 * 冷却多久（**秒**）。spec §10 冻结值：一小时。
 *
 * ⚠️ 与 `INCREMENTAL_INTERVAL_SEC` **数值相同但语义完全无关**，别合并成一个常量：
 *   那一个是"多久算'该增量了'"（正常节奏），这一个是"失败之后多久再碰他"（退避）。
 *   哪天调其中一个（比如把增量间隔改成 20 分钟），合并过的那个常量会让另一件事
 *   跟着悄悄变 —— 而症状是"退避窗口莫名其妙变短了"，从名字上完全看不出来。
 */
export const COOLDOWN_SEC = 3600;

// ---------------------------------------------------------------------------
// 行与形状
// ---------------------------------------------------------------------------

/**
 * `tracked_creators` 的一行（snake_case）+ 联结出来的 `video_count`。
 *
 * ⚠️ `platform` / `enabled` / `backfill_done` 都标成"库里那个类型"：
 *    迁移 020 的 `CHECK` 把前者的值域钉死了，`enabled` / `backfill_done` 是 0/1。
 *    换算成对外形状（boolean）只发生一次，就在 `toCreator` 里。
 */
interface CreatorRow {
  id: string;
  platform: TrackPlatform;
  external_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  platform_meta: string | null;
  backfill_done: number;
  last_cursor: string | null;
  last_synced_at: number | null;
  last_error: string | null;
  consecutive_failures: number;
  /** 迁移 022：冷却到什么时候（Unix 秒）。`NULL` = 不在冷却中（见 `cooldownUntil`）。 */
  cooldown_until: number | null;
  enabled: number;
  created_at: number;
  video_count: number;
  hidden_count: number;
}

/** `tracked_videos` 的一行（只取对外的形状要用的那些列）。 */
interface VideoRow {
  id: string;
  creator_id: string;
  platform: TrackPlatform;
  external_id: string;
  title: string;
  thumbnail_url: string | null;
  published_at: number | null;
  duration_sec: number | null;
  view_count: number | null;
  comment_count: number | null;
  is_live_replay: number;
  tags: string | null;
  status: string;
  first_seen_at: number;
  /**
   * ★ 联结出来的博主显示名（2026-09-19，用户第 8 条）。
   *
   * ⚠️ `NULL` 只可能来自"联结不到那一行"（外键 `ON DELETE CASCADE` 下不该发生），
   *    而**空串**是真实存在的（`display_name` 是 NOT NULL，但没人拦着它写空）——
   *    ⇒ 对外形状里两者都保持原样，界面上"没有名字"就**不画那一格**，
   *      绝不用 handle 顶上、也不印一个空框（两种都会让人以为数据坏了）。
   */
  creator_name: string | null;
}

/**
 * 列名逐列写出来（见文件头第八节）。`updated_at` 不在里面：对外的
 * `TrackedVideo` 没有这一格，多读一列只是多一处将来会漂的地方。
 *
 * ⚠️ 这里的每一列都必须是 `tracked_videos` 的列（`t.`）或联结出来带别名的列：
 *    语句没有前缀限定，`id` / `platform` / `status` 这些名字两份表里**都有** ——
 *    一旦有前缀写漏，SQLite 会对"两份表都有的列名"直接抛
 *    `ambiguous column name`（这一条会抛，算是幸运的），但**别指望它**：
 *    真正的风险是"某个列名将来只在一份表里出现"，那时它会静默读到另一份表的那一列。
 */
const VIDEO_COLUMNS = `
  t.id, t.creator_id, t.platform, t.external_id, t.title, t.thumbnail_url, t.published_at,
  t.duration_sec, t.view_count, t.comment_count, t.is_live_replay, t.tags, t.status,
  t.first_seen_at, c.display_name AS creator_name
`;

const CREATOR_COLUMNS = `
  c.id, c.platform, c.external_id, c.handle, c.display_name, c.avatar_url, c.platform_meta,
  c.backfill_done, c.last_cursor, c.last_synced_at, c.last_error, c.consecutive_failures,
  c.cooldown_until, c.enabled, c.created_at
`;

/**
 * 名单 + 每个博主的条数（两个数，各回答一个问题）。
 *
 * ⚠️ `COUNT(v.id)`（**不是** `COUNT(*)`）：`LEFT JOIN` 对没有视频的博主会补一行全 NULL，
 *    而 `COUNT(*)` 会把那一行也数进去 ⇒ 每个"还没抓过"的博主都显示 1 条，
 *    而这正是管理面板上最需要说老实话的那一格（`COUNT(v.id)` 不数 NULL）。
 * ⚠️ 一次 `GROUP BY` 拿回来，不是每个博主查一次条数（与 `resources.ts:173-180`
 *    那条"列表一页 24 条就是 48 次查询"同一个理由）。
 *
 * ★ `video_count` 与 `hidden_count` **故意是两个数**（文件头第二节那对）：
 *   前者是"库里有多少行"（含隐藏）—— spec §5.1 那个 bilibili 到底判据的输入，
 *   一个过滤条件都不许加；后者是"其中几行是隐藏的"，只给管理面板显示 `N（隐藏 M）`。
 *   ⇒ 别把它们"统一"掉：一个少算会让回填永远翻不完，另一个少算只是面板上少一个数字。
 * ⚠️★ `COALESCE(..., 0)` 不是装饰：一个博主**一条视频都没有**时 `SUM` 返回 `NULL`
 *   （`LEFT JOIN` 补的那一行），而 `hiddenCount` 对外是 `number` ——
 *   少了它，管理面板上会拿 `null > 0` 去比、并在 JSON 里发出一个 `null`。
 *   同一句里的 `SUM` 只认 `'hidden'`：`status` 的值域是迁移 020 的 `CHECK` 钉的，
 *   所以这里不需要（也不该）写 `NOT IN (...)` 那种反向判据。
 */
const CREATOR_SELECT = `
  SELECT ${CREATOR_COLUMNS}, COUNT(v.id) AS video_count,
         COALESCE(SUM(CASE WHEN v.status = 'hidden' THEN 1 ELSE 0 END), 0) AS hidden_count
    FROM tracked_creators c
    LEFT JOIN tracked_videos v ON v.creator_id = c.id
`;

/** 见过一次就不该再变的那两列（见文件头第五节）：读回来做对照时用得上。 */
function toCreator(row: CreatorRow): TrackedCreator {
  return {
    id: row.id,
    platform: row.platform,
    externalId: row.external_id,
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    backfillDone: row.backfill_done === 1,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
    consecutiveFailures: row.consecutive_failures,
    /*
     * ★ 冷却死线（迁移 022）**原样走出去**：它是 `number | null`，而 `NULL` 是
     *   "不在冷却中"这个状态本身。
     * ⚠️ 这里**不许**写 `?? 0` 之类的兜底：0 秒是 1970-01-01，而管理面板那一格会把它
     *   渲染成"冷却中，至 1970/1/1"—— 一句**看起来像真数据**的谎（本仓既有纪律，
     *   见 `packages/shared/src/tracking.ts` 里那一格与 `toMillis` 的说明）。
     */
    cooldownUntil: row.cooldown_until,
    // 0/1 → boolean 只在这里换算一次（spec §4.3 的边界纪律）
    enabled: row.enabled === 1,
    videoCount: row.video_count,
    /*
     * ★ 真读数，从 `CREATOR_SELECT` 里那一格数出来（`SUM(CASE WHEN v.status = 'hidden' …)`）。
     *
     * ⚠️ 这里曾经是**占位 0**（T1 为了让 `TrackedCreator.hiddenCount` 这个必填格编译得过，
     *    在每一个构造点上补的零），并留了一句"真值要 T3 数出来"。
     *    T3 到了：管理面板那一格显示的 `N（隐藏 M）` 现在数的是库里真的有几行 hidden。
     *    写回 0 的话**编译得过、测试也可能绿**，只有界面会永远说"隐藏 0 条"。
     */
    hiddenCount: row.hidden_count,
    createdAt: row.created_at,
  };
}

/**
 * 同步那条路上要的**超集**：`TrackedCreator` 之外多带两样只有同步用得上的东西。
 *
 * ⚠️ 为什么不把它们加进 shared 的 `TrackedCreator`：那一份是**管理面板/公开列表**的形状
 *    （T5 直接把它塞进 JSON），而这两样是**跑同步**才需要的：
 *      · `lastCursor` —— CLI 拿它当 `fetchPage` 的 cursor（否则每次都从第一页重翻）；
 *      · `platformMeta` —— T8 的 YouTube 适配器靠它拿到 uploads 播放列表 ID
 *        （§5.5：不存它就得每轮多打一次 `channels.list`）。
 *    ⇒ 它是 `TrackedCreator` 的**子类型**，所以"返回 `TrackedCreator[]`"这个约定仍然成立，
 *      而 CLI 那边拿到的是完整的那个。放在这里而不是 shared：多带一个仅供同步的字段，
 *      泄露的是"我们内部怎么翻页"，那是这一层的事。
 */
export interface StoredCreator extends TrackedCreator {
  lastCursor: string | null;
  platformMeta: Record<string, unknown>;
}

function toStoredCreator(row: CreatorRow): StoredCreator {
  return {
    ...toCreator(row),
    lastCursor: row.last_cursor,
    platformMeta: parsePlatformMeta(row.platform_meta),
  };
}

/**
 * `platformMeta`（适配器给的对象）→ 存进 `platform_meta` 的那个值。
 *
 * ★ 没有就是 `NULL`，**不是** `'{}'`、也不是空串：这一列是两个状态的载体 ——
 *   "这个平台在库里没有自己的小东西"（bilibili 今天就是这样）与"有一组空的小东西"，
 *   而空串进 JSON 解析会走 `parsePlatformMeta` 的 catch 分支（读出来仍是 `{}`），
 *   于是**坏值**与**没有**在库里长得一样，将来查"这一列到底有没有人写"就查不出来了。
 * ⚠️ 反向的 `parsePlatformMeta` 把 `NULL` 读成 `{}`：那是**读**那一侧的选择
 *   （调用方要多一层 `?.` 才能用，而它几乎总是"取里面的某个键"），
 *   与这里"写的时候把两个状态分开存"不矛盾：库里分得开，读出来才好按需归一化。
 */
function storedPlatformMeta(meta: Record<string, unknown> | null | undefined): string | null {
  if (meta === undefined || meta === null) return null;
  return JSON.stringify(meta);
}

/**
 * `platform_meta`（JSON 文本）→ 对象。
 *
 * ⚠️ 数据库**不知道它的形状**（迁移 020 第五节），所以这里必须防御性解析：
 *    一次手改库、一次回滚、将来某次迁移都可能留下半截 JSON，
 *    而那时抛出去的异常会让**整条待办查询**挂掉 —— 表现是"这一轮一个博主都没同步"，
 *    比"少一个 uploads id"严重得多（与 `live-shares.ts` 的 `parsePayloadOf` 同一手法）。
 * ⚠️ 数组与 `null` 也算坏值：`typeof null === 'object'`，而它们都不是"一组平台小东西"。
 */
function parsePlatformMeta(raw: string | null): Record<string, unknown> {
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

/**
 * 库里的 `tags`（JSON 数组文本，沿用 `live_channels.tags` 的先例）→ 数组。
 *
 * ⚠️ 坏值当作**空数组**，不是抛：标签是"有更好、没有也能看"的东西，
 *    而一次坏值不该让整个公开列表读不出来（理由同上一条）。
 */
function parseTags(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((tag): tag is string => typeof tag === 'string');
  } catch {
    return [];
  }
}

function toTrackedVideo(row: VideoRow): TrackedVideo {
  return {
    id: row.id,
    creatorId: row.creator_id,
    platform: row.platform,
    externalId: row.external_id,
    title: row.title,
    thumbnailUrl: row.thumbnail_url,
    publishedAt: row.published_at,
    durationSec: row.duration_sec,
    viewCount: row.view_count,
    commentCount: row.comment_count,
    isLiveReplay: row.is_live_replay === 1,
    tags: parseTags(row.tags),
    status: row.status,
    firstSeenAt: row.first_seen_at,
    /*
     * ★ 博主显示名（2026-09-19，用户第 8 条）——**公开列表也要**。
     *
     * ⚠️★ 这里原来写着"不填 `creatorName`：shared 的注释写明它只有管理面板要"，
     *    而那一句话连同 shared 里的注释现在都改了：用户要在每张卡上看到博主名称，
     *    而"这位博主是谁"只能在服务端 JOIN 出来（公开列表本来不带谁的名字）。
     *    代价：**每一条**公开查询多一次 `JOIN tracked_creators`（`id` 是主键，
     *    这是索引命中，不是全表扫）。
     * ⚠️ `NULL`（联结不到那一行）在这里收成**空串**，而 `''`（真的有这一行、只是没名字）
     *    原样过去 —— 两者是**同一个状态**："这张卡上没有名字"。界面靠空值决定
     *    **不画那一格**，而任何占位值（`'?'` / handle / 平台名）都会让它画出来
     *    （本仓纪律：拿不到就是 null/空，不许退化成看起来像真数据的值）。
     *    外键 `ON DELETE CASCADE` 下 `NULL` 本来不该出现，收成空串只是为了不让
     *    "联结不到"变成界面上的一个 `undefined`。
     */
    creatorName: row.creator_name ?? '',
  };
}

/**
 * 把调用方给的限额/偏移收成一个非负整数（理由见文件头第七节 ②）。
 *
 * ⚠️ 它守着的是**静默**失效：`LIMIT -1` 是"不限"，`LIMIT 5.5` 会被 SQLite 当成 5 ——
 *    两者都不报错，而"这一轮抓了多少个博主/取了多少条视频"正是 spec §3.3 唯一的界。
 */
function nonNegativeInt(value: number): number {
  return Number.isInteger(value) && value > 0 ? value : 0;
}

// ---------------------------------------------------------------------------
// 读：公开列表
// ---------------------------------------------------------------------------

/**
 * 公开列表：**只出 `visible` 的**，按发布时间倒序；`platform` 可选地只出某一个分区。
 *
 * ⚠️ 为什么要过滤 `status`：v1 没有隐藏端点（spec §6.1 里只有五个端点），所以
 *    `hidden` 这个状态**只有两个来源** —— CLI 的核对阶段（`applyVerifyResult`，
 *    上游不再认这条 id 时写 `upstream_gone`）以及**手工改库**。而一个没人读的状态
 *    等于没有那个状态：不过滤的话，"隐藏"这件事在界面上**一点也不生效**
 *    （`videos.ts:274` 那条纪律同理）。
 *    代价：这个 `total` 与 `storedVideoCount` 因此是两个数（见文件头第二节）——
 *    刻意的，两个数回答的是两个问题。
 *
 * ★ `platform`（spec §5.1）是**界面那几个分区按钮**的服务端那一半：不传 = 全部，
 *   传了 = 只出那个平台。⚠️ 它**必须同时进 `items` 与 `total` 的 `WHERE`** ——
 *   两处漂移的表现是"第 1 页对、翻到第 2 页开始串平台"（**不是**报错），
 *   所以下面把条件与其参数写成**一处**常量，两个查询都从它拼。
 *   ⚠️ 非法值的判定**不在这里**：这一层收的是已经归一化好的 `TrackPlatform`
 *   （文件头第一节的分工），`?platform=foo` 那件事是路由层的 400（spec §5.1）。
 *
 * ⚠️ `published_at` 为 NULL 的排在**最后**（SQLite 里 NULL 最小，`DESC` 就把它排到末尾），
 *    那正是想要的：日期不知道的视频不该顶在"最新的"位置上冒充今天发的。
 * ⚠️ 第二个排序键不是装饰（`videos.ts:266-270` 写过同一条理由）：同一秒发布的两支视频
 *    SQLite 不保证稳定顺序，翻页时会有记录重复出现或被整页跳过，而界面上看起来
 *    只是"好像漏了几条"。
 *
 * ===========================================================================
 * ★★ 第 9 条（2026-09-19）：筛选与排序 —— **全部在 SQL 里，全部在分页之前**
 * ===========================================================================
 * 六个新条件（`creatorId` / `tag` / `durMin` / `durMax` / `since` / `until`）与两个
 * 排序键。三件事在这里说清楚，因为它们的错法都是**静默**的：
 *
 * ① **筛选必须在 `LIMIT/OFFSET` 之前**。取一页再在内存里筛，表现是"这一页只剩两三条、
 *    而 `total` 说有一百条"（甚至翻到某一页整个空）—— 而服务端一次错都没报。
 *    ⇒ 同一个 `where` 同时喂 `COUNT(*)` 与 `items`（下面那段常量），这是它的全部理由。
 * ② **排序也在 SQL 里**（同一条理由：分页是在这一层切的）。
 * ③ ★★ **绝不为缺失值填 0**（本仓既有纪律，见 `packages/shared/src/tracking.ts` 的 ★★）：
 *    · `view_count` 为 `NULL` 的行在 `sort=views` 下**排在最后**，不是当成 0 ——
 *      "这支视频没人看"与"这一轮上游没回播放量"是两件事，而当 0 之后它们**长得一样**；
 *    · `duration_sec` 为 `NULL` 的行在**给了时长范围**时**不出现**（`IS NOT NULL` 那一句）：
 *      说一条"不知道多长"的视频落在 1–5 分钟里，是编的。
 *
 * ⚠️ 标签筛选用 `json_each`（SQLite 的 JSON1，本机实测可用：3.53.4）而不是
 *    `tags LIKE '%"short"%'`：后者是**文本**匹配 —— 它今天恰好也对（值都带引号），
 *    但它把"值的相等"变成了"子串的出现"，而这两件事在有人往 `tags` 里写别的东西
 *    （手工改库、或者将来多一个自由文本标签）时**不一样**。`json_each` 比的是
 *    数组元素本身。代价：这条 `WHERE` 走不了索引（`tags` 本来也没有索引），
 *    与 LIKE 相同 —— 所以这里没有多付什么。
 */
export interface TrackedVideoListFilters {
  /** 分区（spec §5.1）。`undefined` = 全部。 */
  platform?: TrackPlatform;
  /** 只看这一位博主。`undefined` = 全部。⚠️ 不存在的 id ⇒ 空列表（**不是** 400）。 */
  creatorId?: string;
  /** 标签。`undefined` = 全部。 */
  tag?: TrackedVideoTag;
  /** 时长下界（秒，闭区间）。给了任一端 ⇒"不知道多长"的行整批排除（见上面 ③）。 */
  durMin?: number;
  durMax?: number;
  /** 发布时间的下界（Unix 秒，闭区间）。 */
  since?: number;
  until?: number;
}

export function listTrackedVideos(
  opts: {
    limit: number;
    offset: number;
    /** 排序键。`undefined` 与 `'new'` 同义（`published_at DESC`，即今天的行为）。 */
    sort?: TrackedSort;
  } & TrackedVideoListFilters,
): {
  items: TrackedVideo[];
  total: number;
} {
  const db = getDb();
  const limit = nonNegativeInt(opts.limit);
  const offset = nonNegativeInt(opts.offset);

  /*
   * `total` 与 `items` 跑的是**同一个条件**（可见性 + 全部分区/筛选条件），
   * 所以把它连同它的参数绑成一对：两处各写一遍的话，某天给列表再加一个筛选条件时
   * 很容易只改一处 —— 而那种漏掉的表现是"翻到第三页就没有了"。
   *
   * ⚠️ 条件的**追加顺序**必须与参数的追加顺序**逐条对齐**（SQLite 是按位置绑的）：
   *    调换两行的顺序不会抛错，只会让两个筛选条件互相拿到对方的值 ——
   *    而症状是"筛 B站 出来的是短片的那些"，看起来像数据坏了。
   *    ⇒ 每个 `if` 的上面一行写条件、下一行紧接着 push 它的参数，中间不留别的东西。
   */
  const conditions: string[] = ["t.status = 'visible'"];
  const params: Array<string | number> = [];

  if (opts.platform !== undefined) {
    conditions.push('t.platform = ?');
    params.push(opts.platform);
  }
  if (opts.creatorId !== undefined) {
    conditions.push('t.creator_id = ?');
    params.push(opts.creatorId);
  }
  if (opts.tag !== undefined) {
    // JSON1：比的是数组**元素**，不是文本子串（上面那段 ⚠️）
    conditions.push('EXISTS (SELECT 1 FROM json_each(t.tags) WHERE json_each.value = ?)');
    params.push(opts.tag);
  }
  /*
   * 时长：给了任一端就把**不知道多长**的行排除掉，并套上那几个界。
   *
   * ⚠️★ 那两句比较**自己**就把 NULL 行排除了（SQL 的三值逻辑：`NULL >= 60` 是 NULL，
   *    而 `WHERE` 只收 true），所以 `IS NOT NULL` 那一句**今天不是承重的** ——
   *    2026-09-19 实测：把它换成恒真条件，六条夹具的每一条断言结果都不变。
   *    ⇒ 它留着是为了**意图**，不是为了行为：下一个读的人不必知道 SQL 怎么比 NULL
   *      就能看出"不知道多长的不算数"，而将来谁把这一段改成"给两个界都补默认值"
   *      （`durMin ?? 0`）时，少掉的正是这一句。
   *    ⇒ ⚠️ 所以**不许**把"NULL 被排除"这件事写成"靠 `IS NOT NULL` 实现的"：
   *      那句话我量过，是假的（本仓最贵的那类缺陷就是这种"看起来很有道理"的假注释）。
   *
   * ⚠️ 也不能写成 `(duration_sec IS NULL OR (duration_sec >= ? AND duration_sec <= ?))` ——
   *    那个写法会让"不知道多长"的行**永远**出现在每一次时长筛选里（等于没筛），
   *    而界面上看起来只是"多出来几条"。
   */
  if (opts.durMin !== undefined || opts.durMax !== undefined) {
    conditions.push('t.duration_sec IS NOT NULL');
    if (opts.durMin !== undefined) {
      conditions.push('t.duration_sec >= ?');
      params.push(opts.durMin);
    }
    if (opts.durMax !== undefined) {
      conditions.push('t.duration_sec <= ?');
      params.push(opts.durMax);
    }
  }
  /*
   * 发布时间：与时长**故意不同** —— 这里**不加** `published_at IS NOT NULL`。
   * 理由：`published_at` 为 NULL 的行在**任何**排序下都已经排在最后（上面那句），
   * 而"我只看最近 7 天"这句话对一条没有日期的视频来说，答案只能是"它不在最近 7 天里"。
   * ⚠️ 但也不能靠 `published_at >= ?` 单独表达：SQLite 里 `NULL >= 5` 是 **NULL**
   * （不是 true 也不是 false），`WHERE` 只收 true ⇒ NULL 的行**确实**被排除了。
   * 这一条是"靠 SQL 的三值逻辑工作"的，所以写在这里说清楚：**它是对的，但读的人
   * 必须知道为什么**（换成 `NOT (published_at < ?)` 就是另一回事了：那是 NULL）。
   */
  if (opts.since !== undefined) {
    conditions.push('t.published_at >= ?');
    params.push(opts.since);
  }
  if (opts.until !== undefined) {
    conditions.push('t.published_at <= ?');
    params.push(opts.until);
  }

  const where = conditions.join(' AND ');

  /*
   * ★ 两个排序键的差别只有一件事：`views` 先按"有没有播放量"分两档（`IS NULL` 是 0/1，
   *   `ASC` ⇒ 有播放量的在前），再按播放量降序。
   *
   * ⚠️★ 这里**实测过**，而且结论与"直觉"不同（2026-09-19，node:sqlite / SQLite 3.53.4）：
   *   · `ORDER BY view_count DESC` **单独写**已经把 NULL 排在**最后**了
   *     （SQLite 把 NULL 当最小值，`DESC` 于是把它放到末尾——`ASC` 才是 NULL 在最前）；
   *   · 所以前两个键**今天**与裸 `DESC` 结果逐条相同 ⇒ "NULL 排最后"这条断言
   *     **区分不出**这两版。⇒ 那条断言真正守的是**另一件事**：
   *     `COALESCE(view_count, 0)`（把"没有播放量"当成 0）——它会与一条**真的 0 播放**
   *     的行并列，然后由 `published_at DESC` 决定谁在前面，于是"没有播放量"的行
   *     会插到一条真有 0 次播放的视频前面。测试夹具里专门有一条 0 播放的行
   *     （`tracking-routes.test.ts` 的 `v-zero`），就是为了让这个错法能被抓住。
   *   · 那两个显式键**仍然留着**：它们把意图写出来（下一个读的人不必知道 SQLite
   *     怎么排 NULL），而且别的方言的默认值正好相反（PostgreSQL 里 `DESC` 默认
   *     NULLS FIRST）。代价：一句看起来"多余"的 SQL —— 比"哪天换了数据库/驱动，
   *     没有播放量的那批突然排到最前面，而没有任何断言会红"便宜得多。
   *   ⚠️ 写这一段的教训（本仓最贵的那类缺陷）：第一版注释断言的是"`DESC` 会把没有
   *   播放量的顶到最前面" —— 那句话**没有量过**，而实测它正好是反的。
   *
   * ⚠️ 两个键都把 `published_at DESC, id ASC` 接在后面：前者是同分/同秒的次序，
   *   后者只负责**稳定**（同一次状态查两次必须给同一个顺序，翻页才不会重复/漏记录）。
   */
  const orderBy =
    opts.sort === 'views'
      ? 't.view_count IS NULL ASC, t.view_count DESC, t.published_at DESC, t.id ASC'
      : 't.published_at DESC, t.id ASC';

  /*
   * ⚠️ 两句 SQL 的**表与联结必须逐字相同**：`COUNT(*)` 那一句只要少一个 `JOIN`，
   *    带 `creatorId` 的筛选就会在 `total` 与 `items` 上得到两个不同的答案
   *    （症状同上：分页器说 40 条、列表里只有 3 条）。
   *    ⇒ 所以联结写成一处常量，两句从它拼。
   */
  const from = 'FROM tracked_videos t JOIN tracked_creators c ON c.id = t.creator_id';

  const totalRow = db.prepare(`SELECT COUNT(*) AS n ${from} WHERE ${where}`).get(...params) as
    | { n: number }
    | undefined;

  const rows = db
    .prepare(
      `SELECT ${VIDEO_COLUMNS} ${from}
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as unknown as VideoRow[];

  return { items: rows.map(toTrackedVideo), total: totalRow?.n ?? 0 };
}

/**
 * 公开名册（下拉框那一份）：**每一条只出五个键**。
 *
 * ★★ 为什么要有它（用户第 9 条要一个"所有追踪的博主"的下拉框）：
 *    `GET /api/tracking/creators` 需要 `live.manage`（线上匿名实测 **401**），
 *    而"只筛某一位博主"是所有人都要用的功能 ⇒ 需要一条**公开只读**的路由。
 *
 * ⚠️★ 它**不是** `listCreators()` 的别名，别把它改回去：那个函数带着采集状态
 *    （`lastError` / `consecutiveFailures` / `cooldownUntil` …），公开出去等于
 *    把"这个频道最近老失败"贴在所有人的下拉框里。这里逐列写出来（不用 `*`），
 *    转换点也**只有这一处** —— 多带一列从响应上看不出来，所以每一列都必须显式加一行。
 * ⚠️ 可见性：**不过滤 `enabled`**。停用的博主**他的旧视频仍然在公开列表里**
 *    （`listTrackedVideos` 只过滤视频自己的 `status`，不看博主的 `enabled`）——
 *    下拉框要是把他藏起来，就会出现"列表里有他的视频、却没法按他筛"这种状态。
 *    停用只回答"还抓不抓"，不回答"他的视频还算不算数"。
 * ⚠️★ `videoCount` 只数 `status = 'visible'` 的行（口径写在
 *    `packages/shared/src/tracking.ts` 的 `TrackedCreatorSummary` 上）——
 *    公开端点数隐藏的条数等于对外宣布"我们下架过东西"。
 * ⚠️ 排序按**显示名**（下拉框是"找人"的控件，只有字典序能让人找得到），
 *    并列与空名字用 `id` 兜底保证稳定。空显示名会排在**最前**（`''` 最小）——
 *    界面那一侧对空名字有回落（见 `TrackedVideos.tsx` 的 `creatorLabel`）。
 */
export function listPublicCreators(): TrackedCreatorSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.platform, c.display_name, c.handle,
              COUNT(v.id) AS video_count
         FROM tracked_creators c
         LEFT JOIN tracked_videos v ON v.creator_id = c.id AND v.status = 'visible'
        GROUP BY c.id
        ORDER BY c.display_name ASC, c.id ASC`,
    )
    .all() as unknown as Array<{
    id: string;
    platform: TrackPlatform;
    display_name: string;
    handle: string;
    video_count: number;
  }>;
  return rows.map((row) => ({
    id: row.id,
    platform: row.platform,
    displayName: row.display_name,
    handle: row.handle,
    videoCount: row.video_count,
  }));
}

// ---------------------------------------------------------------------------
// 读：名单
// ---------------------------------------------------------------------------

/** 名单（管理面板那一个）。**含停用的** —— 那是要点：管理面板要能把它启回来。 */
export function listCreators(): TrackedCreator[] {
  const rows = getDb()
    .prepare(
      `${CREATOR_SELECT}
        GROUP BY c.id
        ORDER BY c.created_at DESC, c.id ASC`,
    )
    .all() as unknown as CreatorRow[];
  return rows.map(toCreator);
}

/**
 * 单个博主（对外形状）。不存在 ⇒ `null`。
 *
 * ⚠️ **导出**是 T5 要的（2026-09-16）：`DELETE /api/tracking/creators/:id` 必须在删之前
 * 先读一眼 —— 删掉之后 `platform` / `externalId` 就再也查不到了，而审计的 `reason`
 * 要留下"删的是哪个平台的谁"（`routes/live.ts` 的 DELETE 为同一件事预读了一次）。
 * 被否掉的替代做法是"读整份 `listCreators()` 再 find"：那条查询带着
 * `LEFT JOIN tracked_videos` 的聚合，为了取一行而去数几万条视频不划算。
 * ⚠️ 它**不是**给"公开读"用的（公开列表走 `listTrackedVideos`），也不判权限 ——
 * 权限在路由层（本文件头第一节那条分工没变）。
 */
export function getCreator(id: string): TrackedCreator | null {
  const row = getDb()
    .prepare(`${CREATOR_SELECT} WHERE c.id = ? GROUP BY c.id`)
    .get(id) as unknown as CreatorRow | undefined;
  return row ? toCreator(row) : null;
}

// ---------------------------------------------------------------------------
// 写：名单
// ---------------------------------------------------------------------------

/**
 * `INSERT ... ON CONFLICT (platform, external_id) DO UPDATE` 里那三列**故意不在**。
 * 见文件头第五节；这里再点名一次，因为改这一行的人八成是从这里读起的。
 *
 * ⚠️ `platform_meta` **建行时就落**（照 spec §5.5 与 §5 那个补上的可选字段）：
 *    YouTube 的 uploads 播放列表 ID 只有 `resolveCreator` 知道（`channels.list` 那一次），
 *    不在建行时存下来的话，**每轮同步都要重新 `channels.list`** ——
 *    那是白烧配额，而且烧得静悄悄（`tracking/types.ts` 的 `CreatorRef.platformMeta`
 *    那段写着这条路的来龙去脉）。`CreatorRef` 没带它 ⇒ 这一列就是 `NULL`
 *    （**不是**空串、也**不是** `'{}'`：`NULL` 是"这个平台没有小东西"，
 *    而 `'{}'` 是"有一组空的小东西"—— 两个不同的状态，读出来一个 `{}` 一个 `{}`，
 *    所以关键是别把"没有"写成"空的"，`tracking-store.test.ts` ③ 两条各钉一边）。
 */
const INSERT_CREATOR_SQL = `
  INSERT INTO tracked_creators (
    id, platform, external_id, handle, display_name, avatar_url, platform_meta,
    backfill_done, last_cursor, last_synced_at, last_error, consecutive_failures,
    enabled, added_by, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, 0, 1, ?, ?, ?)
`;

/**
 * 加一个博主的结果。
 *
 * ⚠️ 为什么是**联合**而不是抛（本仓 `createShare` / `setContributors` 的既有形状）：
 *    "这个博主已经在名单上了"是一件**正常会发生**的事（管理员手滑贴了两遍，
 *    或者两个编辑同时加同一个人），不是异常。抛出去的话，T5 只能靠 message 文本来
 *    分辨"重复"与"数据库坏了"，而那根线挂在中文文案上，改一个标点就断 ——
 *    断的时候表现是"重复添加"变成 500（与 `tracking/types.ts` 里那条
 *    "不要按 message 判"的裁决同一个理由）。
 *
 * ⚠️ 计划（task-4-brief）这一行的签名是 `createCreator(ref, addedBy): TrackedCreator`。
 *    改成长这样是**刻意的**，代价与理由都写在这里：照字面实现的话，重复只能靠"抛"，
 *    而 T5 需要的是"一个能翻译成 400 + reason 的值"（spec §6.1 ④ 那条纪律：
 *    入参的问题不许长成 500）。附带的那一个 `now` 见文件头第六节。
 */
export type CreateCreatorResult =
  | { ok: true; creator: TrackedCreator }
  | { ok: false; reason: 'duplicate'; existingId: string };

/**
 * 加一个博主。
 *
 * ⚠️ `ref.platformMeta` **落库**（JSON 文本，没有就是 `NULL`）：那是 spec §5.5 要存的
 *    YouTube uploads 播放列表 ID 唯一进得了库的地方 —— 它不在对外形状里
 *    （`TrackedCreator` 不带它），所以建行这一次是**唯一**的写入口，
 *    漏掉的表现是"每轮同步都重新 `channels.list`"（`INSERT_CREATOR_SQL` 那段写着）。
 *
 * ⚠️ 重复的判定靠**再查一次**，不是靠匹配错误文本（`/UNIQUE constraint failed/`）：
 *    那条文本属于 SQLite 的版本，而"按 message 判"这件事本仓已经否过一次
 *    （`tracking/types.ts` 的文件头）。真出了别的写库错误时，这里把原异常**重新抛出去** ——
 *    那时确实是我们的 bug，不该被伪装成一个"已经加过了"。
 */
export function createCreator(
  ref: CreatorRef,
  addedBy: string | null,
  now: number,
): CreateCreatorResult {
  const db = getDb();
  const id = newId();

  try {
    db.prepare(INSERT_CREATOR_SQL).run(
      id, // id
      ref.platform, // platform
      ref.externalId, // external_id
      ref.handle, // handle（可读标识；没有就是空串，库里 DEFAULT ''）
      ref.displayName, // display_name
      ref.avatarUrl ?? null, // avatar_url（拿不到就是 NULL，不是空串）
      // platform_meta（JSON 文本；没有就是 NULL —— 见 storedPlatformMeta）
      storedPlatformMeta(ref.platformMeta),
      addedBy, // added_by（谁加进来的；`ON DELETE SET NULL`，人没了只擦这一格）
      now, // created_at
      now, // updated_at
    );
  } catch (error) {
    const existing = db
      .prepare('SELECT id FROM tracked_creators WHERE platform = ? AND external_id = ?')
      .get(ref.platform, ref.externalId) as { id: string } | undefined;
    if (existing) return { ok: false, reason: 'duplicate', existingId: existing.id };
    throw error;
  }

  /*
   * 回读：返回的是**库里现在真正的那一行**，不是"我以为我写进去的那一行"
   * （`live-shares.ts` 的 `createShare` 同一条纪律）。
   * ⚠️ 读不回来在逻辑上不可能（刚插进去），所以 throw 而不是写 `?? null`：
   *    真发生了就是我们自己的 bug，宁可炸在测试里，也不要往下传一个空对象。
   */
  const creator = getCreator(id);
  if (!creator) throw new Error('刚插入的博主行读不回来 —— 说明这次写入根本没落库');
  return { ok: true, creator };
}

/**
 * 改一个博主：显示名 / 停用启用 / 重新回填。不存在 ⇒ `null`。
 *
 * ⚠️ `updated_at` 只在**真的写了东西**时才动：一个字段都没给（或只给了 `false`）
 *    是一次空操作，而 `updated_at` 那一列的语义是"最后一次真的改到它"。
 *
 * ⚠️★ `reBackfill` **只把 `backfill_done` 置 0**（spec §6.1 对这个动作的定义就这一句）。
 *    顺手把 `last_cursor` 清成 `NULL` 是更容易想到的做法（"重新"听起来就该从头），
 *    但一次回填是**有界**的（每轮最多 20 页，§3.3），一个 500 条的 UP 要跑好几轮 ——
 *    每轮都清游标的话，它**永远只抓得到前 20 页**。⇒ 窄读 spec：只改那一列。
 *    代价写清楚：手工"重新回填"一个翻到一半的博主时，它是**接着翻**的，不是从第一页重来
 *    （视频本来就是 upsert，重复看到一批是常态）。
 *
 * ⚠️ 它**不清** `last_error` / `consecutive_failures`：那两个是"上一轮采集怎么样"，
 *    而重新回填的第一个成功页面会经 `advanceCursor` 把它们清掉 —— 让数据自己说话，
 *    比在这里替它擦掉更少一处会漂的地方。
 */
export function updateCreator(
  id: string,
  patch: { displayName?: string; enabled?: boolean; reBackfill?: boolean },
  now: number,
): TrackedCreator | null {
  const db = getDb();
  const sets: string[] = [];
  const params: Array<string | number> = [];

  if (patch.displayName !== undefined) {
    sets.push('display_name = ?');
    params.push(patch.displayName);
  }
  if (patch.enabled !== undefined) {
    sets.push('enabled = ?');
    // ⚠️ 库里是 INTEGER 0/1（`CHECK (enabled IN (0,1))`），而 node:sqlite 不收 boolean。
    params.push(patch.enabled ? 1 : 0);
  }
  // ⚠️ 只有 `true` 才是"重新回填"：`false` 是一次空操作，
  //    不是"把回填标记成完成"（那两件事都写成 `backfill_done = ?` 才是真容易搞错）
  if (patch.reBackfill === true) sets.push('backfill_done = 0');

  if (sets.length > 0) {
    sets.push('updated_at = ?');
    params.push(now);
    db.prepare(`UPDATE tracked_creators SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  }

  return getCreator(id);
}

/**
 * 删一个博主。真删掉了 ⇒ `true`；本来就不在 ⇒ `false`。
 *
 * ⚠️ 他的视频靠 `ON DELETE CASCADE` 跟着走（迁移 020 第三节），而外键在
 *    `db/index.ts:45` 已经 `PRAGMA foreign_keys = ON` 打开了 —— 没有那个 PRAGMA，
 *    这里写着的 `REFERENCES` 一行都不生效，表现是删除成功、视频全变成孤儿行。
 *    `tracking-store.test.ts` ② 用**行为**钉住它（删完数一遍他的视频）。
 * ⚠️ 返回值说的是"名单上那一行"删掉了没有，**不含**级联掉的视频条数
 *    （SQLite 的 `changes()` 不计外键动作带来的删除）—— 别拿它当"删了多少条视频"。
 */
export function deleteCreator(id: string): boolean {
  const result = getDb().prepare('DELETE FROM tracked_creators WHERE id = ?').run(id);
  return Number(result.changes) > 0;
}

// ---------------------------------------------------------------------------
// 待办
// ---------------------------------------------------------------------------

/**
 * 挑这一轮要处理的博主：**先回填，再增量**（spec §3.2 / §3.3）。
 *
 * 返回的是 `StoredCreator`（`TrackedCreator` 的超集，多带游标与平台小东西）——
 * 见那个类型的注释：CLI 拿游标去调 `fetchPage`。
 *
 * ⚠️ `now` 是**参数**（裁决 2）：这一层不看时钟。测试因此不用冻结时间就能钉住
 *    "超过一小时才算到点"那条边界（3599 / 3600 / 3601）。
 *
 * ★★ 两条查询的排序**完全一样**，而且它防的是**饿死**（理由与两个键各自的道理
 *    写在文件头第七节，冒号后面是那句 SQL）：
 *
 * ```sql
 * ORDER BY consecutive_failures ASC, COALESCE(last_synced_at, 0) ASC, id ASC
 * ```
 *
 *    · `consecutive_failures ASC` —— 失败的博主沉到后面。**没有这一条的话**，
 *      一个永远抓不到的博主（`recordFailure` 不动 `last_synced_at` ⇒ 它每一轮都"到点"）
 *      会把 `limits.backfill = 20` 里的名额**每轮**占住，名单上其余的人永远轮不到，
 *      而每一轮都"成功跑完"、日志里一行错都没有。
 *    · `COALESCE(last_synced_at, 0) ASC` —— 同档里从没成功过的排最前（NULL ⇒ 0 ⇒ 最小），
 *      然后是最久没同步的 ⇒ 到点的博主多于限额时（限额 40、名单 60），
 *      后 20 个不会**永远**轮不到。
 *    · `id ASC` —— 只保证同一个状态查两次给同一个顺序（公平性由前两个键表达）。
 * ⚠️ 被否掉的"给失败者加退避列"与它的代价写在文件头第七节（要动已冻结的 DDL +
 *    当场要回答"退避多久"这个没依据的问题）。改这两个 ORDER BY 之前先读那一段。
 *
 * ★★ 两个 `WHERE` 里的**冷却那一行**（迁移 022，2026-09-17 加）：
 *
 * ```sql
 * AND (c.cooldown_until IS NULL OR c.cooldown_until <= ?)   -- 参数是 now
 * ```
 *
 *   它接的是文件头第七节末尾那句"真要把它彻底隔离在限额之外，那是 T6 的事" ——
 *   现在**真的做了**，而且判据是一个**列**而不是 `consecutive_failures >= 3`：
 *   差别在"什么时候放他回来"。只看计数的话，一个连续失败 5 次的博主会**永远**不在待办里
 *   （它的计数要等一次成功才清零，而它已经不再被挑了 ⇒ 永远等不到那次成功）。
 *   冷却写的是"到几点为止"，所以**到点自动回来**，不需要任何别的动作去解锁他。
 *
 *   ⚠️★ 这条判据**不是**把排序换成"按冷却排序"，ORDER BY 一个字都没动：冷却只是
 *   "这一轮**不挑**他"，而不冷却的那些博主之间的公平性仍然由 `consecutive_failures ASC`
 *   那三个键表达（第七节）。两件事回答的是不同的问题，改这一行的人别把它们合起来。
 *   ⚠️ 边界是**闭**的（`<=`）：`cooldown_until === now` 就到期了 —— 一小时整过去之后
 *   第一轮就该重试他，否则那个"一小时"实际变成"一小时零几分钟"（而它取决于 timer 相位）。
 *   ⚠️ 两条查询都要这一行：漏掉一条的表现是"冷却中的博主仍然被回填"（或者反过来），
 *   而它们各自看起来都完全正常。
 *   ⚠️ 被冷却的不进待办 ⇒ CLI 连适配器都不会为他要一个（`track.ts` 那一步只在待办里循环）
 *   —— 这正是这一列的目的：**别再喂**。代价写清楚：冷却期间这个博主**一次都不会被试**，
 *   所以"他是不是已经好了"只能等到窗口结束才知道（一小时，不是永久）。
 */
export function pickDueCreators(
  now: number,
  limits: { backfill: number; incremental: number },
): { backfill: StoredCreator[]; incremental: StoredCreator[] } {
  const db = getDb();

  const backfill = db
    .prepare(
      `${CREATOR_SELECT}
        WHERE c.backfill_done = 0 AND c.enabled = 1
          AND (c.cooldown_until IS NULL OR c.cooldown_until <= ?)
        GROUP BY c.id
        ORDER BY c.consecutive_failures ASC, COALESCE(c.last_synced_at, 0) ASC, c.id ASC
        LIMIT ?`,
    )
    .all(
      now, // 冷却死线的判据（见上面那条 ★★：`<=` 是闭的）
      nonNegativeInt(limits.backfill),
    ) as unknown as CreatorRow[];

  /*
   * ⚠️ `last_synced_at IS NULL` 那半条**不是**多余的（文件头第七节 ①）：
   *    SQL 里 `NULL < 任何数` 是 NULL ⇒ 少了它，这样一行**永远不会**到点，
   *    而且没有任何地方会报错。加上它的代价只是一个分支，与"静默停在原地"不成比例。
   */
  const incremental = db
    .prepare(
      `${CREATOR_SELECT}
        WHERE c.backfill_done = 1 AND c.enabled = 1
          AND (c.last_synced_at IS NULL OR c.last_synced_at < ?)
          AND (c.cooldown_until IS NULL OR c.cooldown_until <= ?)
        GROUP BY c.id
        ORDER BY c.consecutive_failures ASC, COALESCE(c.last_synced_at, 0) ASC, c.id ASC
        LIMIT ?`,
    )
    .all(
      now - INCREMENTAL_INTERVAL_SEC, // 到点判据（spec §3.2 的 `now - 3600`）
      now, // 冷却死线的判据（与上面那条查询同一个 `now`，同一条 ★★）
      nonNegativeInt(limits.incremental),
    ) as unknown as CreatorRow[];

  return {
    backfill: backfill.map(toStoredCreator),
    incremental: incremental.map(toStoredCreator),
  };
}

// ---------------------------------------------------------------------------
// 写：视频
// ---------------------------------------------------------------------------

/**
 * upsert 一条视频。**列清单与绑定顺序逐字对应**（文件头第四节）。
 *
 * 三列不在 `DO UPDATE` 里（`creator_id` / `first_seen_at` / `status`）—— 理由见文件头第五节。
 * `status` 那一列的默认值 `'visible'` 写在 VALUES 里（新写进去的行就是可见的），
 * 而它**不在** `DO UPDATE` 那一侧。
 */
const UPSERT_VIDEO_SQL = `
INSERT INTO tracked_videos (
  id, creator_id, platform, external_id, title, thumbnail_url, published_at,
  duration_sec, view_count, comment_count, is_live_replay, tags, status,
  first_seen_at, updated_at
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'visible',?,?)
ON CONFLICT (platform, external_id) DO UPDATE SET
  title = excluded.title, thumbnail_url = excluded.thumbnail_url,
  published_at = excluded.published_at, duration_sec = excluded.duration_sec,
  view_count = excluded.view_count, comment_count = excluded.comment_count,
  is_live_replay = excluded.is_live_replay, tags = excluded.tags,
  updated_at = excluded.updated_at
`;

/**
 * 时长 → 存进 `duration_sec` 的那个值（见文件头第三节）。
 *
 * ★ 只接受**正整数**：`0` / 负数 / 小数 / `NaN` / `Infinity` 一律 `NULL`。
 *   其中 `0` 是最要命的一个 —— `deriveTags` 按 spec §4.3 的**字面**判据
 *   （`0 <= 60`）会给它打上 `short`，而那是一个看起来完全正常的标签。
 * ⚠️ 它同时是喂给 `deriveTags` 的那个值：两个字段必须说同一件事。
 */
function storedDurationSec(raw: number | null): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : null;
}

/**
 * 把一页抓回来的视频写进库。**幂等**（spec §9.1 断言 5）：同一批抓两次，行数不变。
 *
 * 返回 `{ inserted, updated }`：`inserted` 是"库里因此多了几行"（按**这个 creator 的行数**
 * 前后差算的），`updated` 是其余的。CLI 拿它们拼 spec §6.3 那行"新增 g 条 / 更新 h 条"。
 *
 * ⚠️ 整个批次在一个事务里：一次 50 条写到第 30 条时上游/驱动出问题的话，
 *    半个页面的数据不该留在库里 —— 那一页下次会被重看（翻页重叠是常态），
 *    所以"要么整页进、要么整页不进"正是 upsert 想要的那条线。
 */
export function upsertVideos(
  creatorId: string,
  platform: TrackPlatform,
  videos: FetchedVideo[],
  now: number,
): { inserted: number; updated: number } {
  /*
   * ⚠️ 空的一页**什么都不做**（§2.4：`code=0` 但 `vlist=[]` 是常态，不是异常）：
   *    没有东西可写，也就没有事务要开。这里**先**返回还有一个具体的好处 ——
   *    管理员在 CLI 跑着的时候把博主删了，剩下那几页（都可能是空的）不会凭白
   *    造成一轮失败记录。
   */
  if (videos.length === 0) return { inserted: 0, updated: 0 };

  const db = getDb();

  /*
   * ★ 这一批视频的平台必须与这个博主自己的平台一致。
   *
   * ⚠️ 它防的是**不会抛**的那一类错：`platform` 是调用方单独传进来的一个参数
   *    （计划里就是这么定的，CLI 传 `creator.platform`），而它与 `creator_id`
   *    表达的是同一件事 —— 传错的时候数据库**拦不住**（两张表各自都是合法的），
   *    表现是整批视频被记到错的平台下、还会在 `UNIQUE (platform, external_id)` 里
   *    多占一个位置，日后同一个 bvid 在"另一个平台"下再多出一行。
   *    代价：每页多一次按主键的查询（50 条一批里可以忽略）。
   * ⚠️ 顺带把"博主不在名单上"变成一个说人话的错误（外键会拦，但它的报错
   *    是 `FOREIGN KEY constraint failed`，看不出是哪个 id）。
   */
  const owner = db.prepare('SELECT platform FROM tracked_creators WHERE id = ?').get(creatorId) as
    | { platform: TrackPlatform }
    | undefined;
  if (!owner) {
    throw new Error(`博主 ${creatorId} 不在名单上 —— upsertVideos 只该被喂名单里的博主`);
  }
  if (owner.platform !== platform) {
    throw new Error(`平台对不上：博主 ${creatorId} 是 ${owner.platform}，这一批却标成 ${platform}`);
  }

  const before = storedVideoCount(creatorId);

  db.exec('BEGIN');
  try {
    const statement = db.prepare(UPSERT_VIDEO_SQL);
    for (const video of videos) {
      // ★ 归一化**一次**，然后同时喂给 duration_sec 与 deriveTags（文件头第三节）
      const durationSec = storedDurationSec(video.durationSec);

      statement.run(
        newId(), // id
        creatorId, // creator_id —— 不在 DO UPDATE 里（视频换不了主人）
        platform, // platform
        video.externalId, // external_id —— 与 platform 一起构成 UNIQUE
        video.title, // title
        video.thumbnailUrl ?? null, // thumbnail_url
        video.publishedAt ?? null, // published_at（Unix 秒；没有就是 NULL，不是 0）
        durationSec, // duration_sec（见 storedDurationSec）
        video.viewCount ?? null, // view_count（拿不到就是 NULL：0 是"没人看"，那是另一件事）
        video.commentCount ?? null, // comment_count
        // ⚠️ `CHECK (is_live_replay IN (0,1))` 只收 0/1，而 node:sqlite 不收 boolean
        video.isLiveReplay ? 1 : 0, // is_live_replay
        JSON.stringify(deriveTags({ durationSec, isLiveReplay: video.isLiveReplay })), // tags
        now, // first_seen_at —— 不在 DO UPDATE 里（第一次见到它的时刻）
        now, // updated_at
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  /*
   * ⚠️ `inserted` 是**数出来**的（前后行数之差），不是从驱动的返回值里拿的：
   *    `INSERT ... ON CONFLICT DO UPDATE` 的 `changes` 对"插入"与"更新"都是 1，
   *    分不出来。前后差算出来的插入数是**这个 creator 新增的行数**，
   *    而"其余的都算更新"对同一批里重复出现的同一个 id 也成立
   *    （第一次插进去、第二次更新它 —— 1 插入 / 1 更新，这正是发生过的事）。
   */
  const inserted = storedVideoCount(creatorId) - before;
  return { inserted, updated: videos.length - inserted };
}

/**
 * 这个 creator 在库里**有多少行**（spec §5.1 那个 `storedTotal` 的唯一来源）。
 *
 * ★★ 判据只有一句话，**一个过滤条件都没有** —— 隐藏的也数、什么平台都数。
 *    理由与两个方向的代价写在文件头第二节，改它之前先读 §5.1 的残余风险那一段。
 */
export function storedVideoCount(creatorId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM tracked_videos WHERE creator_id = ?')
    .get(creatorId) as { n: number } | undefined;
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// 核对：挑候选 / 写结果（spec §6.1 / §6.2）
// ---------------------------------------------------------------------------

/** 一条"可以被核对"的视频（spec §6.1）。 */
export interface VerifiableVideo {
  id: string;
  externalId: string;
  platform: TrackPlatform;
}

/**
 * 挑这一轮要核对的视频（spec §6.1）。
 *
 * ⚠️★ 排序是**轮转游标**，不是"最新的优先"：`COALESCE(verify_checked_at, 0) ASC` 保证
 *    没查过的先查、查得最早的接着查。最新优先会让同一批新视频每轮都被问一遍，
 *    而老的那些**永远轮不到**（`pickDueCreators` 的排序注释里写着同一条理由）。
 * ⚠️ `published_at <= now - minAgeSec` 是**粗筛**：Twitch 的存档最早 7 天过期，
 *    刚发出来的根本没得可查；`published_at` 为 NULL 的行**永远不挑**（判据是"够老"，
 *    而"不知道多老"不该被当成够老）。
 * ⚠️ 只挑 `status = 'visible'`：已经隐藏的不用再问一次。
 * ⚠️ LIMIT 要挡住非正整数（SQLite 里 `LIMIT -1` 是"不限"）—— 与 `pickDueCreators` 同一条纪律，
 *    所以用的是同一个 `nonNegativeInt`（连非整数一起挡：`LIMIT 5.5` 会被 SQLite 悄悄当成 5）。
 * ⚠️ `platform` 是**必填**的（不是可选筛选项）：能问上游"这些 id 还在不在"的能力是**按平台**
 *    给的（spec §4，今天只有 Twitch 有），而集合是按平台**整批**问的 ——
 *    把几个平台的行混进一批，问回来的集合就没法解释是哪个平台的答案。
 */
export function pickVerifiableVideos(opts: {
  platform: TrackPlatform;
  minAgeSec: number;
  limit: number;
  now: number;
}): VerifiableVideo[] {
  const limit = nonNegativeInt(opts.limit);
  if (limit === 0) return [];
  return getDb()
    .prepare(
      `SELECT id, external_id AS externalId, platform FROM tracked_videos
        WHERE platform = ? AND status = 'visible'
          AND published_at IS NOT NULL AND published_at <= ?
        ORDER BY COALESCE(verify_checked_at, 0) ASC, id ASC
        LIMIT ?`,
    )
    .all(opts.platform, opts.now - opts.minAgeSec, limit) as unknown as VerifiableVideo[];
}

/**
 * 把一次核对的结果写进库（spec §6.2）。**整个批次一个事务**（与 `upsertVideos` 同一条纪律）。
 *
 * · 每一个被问到的 id 都写 `verify_checked_at = now`（在的与不在的都写）——
 *   不写的话轮转游标会把它再挑一次（那不算错，只是白问一遍）。
 * · 上游**没返回**的那些：`status = 'hidden'` + `hidden_at` + `hidden_reason = 'upstream_gone'`。
 *
 * ⚠️★ `now` 的单位是 **Unix 秒**（计划 Global Constraint 2：本栏目两张表一律秒，
 *    `audit_log` 才是毫秒）。它一次写**两列**：`verify_checked_at` 与 `hidden_at`。
 *    传毫秒的话两件事都不会报错：`hidden_at` 与同表的 `published_at` 差 1000 倍，
 *    而轮转游标 `COALESCE(verify_checked_at, 0) ASC` 会把毫秒值**永远**排在秒值后面 ——
 *    这些行此后**永远挑不到**，每一轮还"成功跑完"（第九节那条饿死，这是它的另一个入口）。
 *
 * ⚠️ 调用方**只在整批都成功时**才调它：失败时"一条都不隐藏"这条防线在 `track.ts` 里
 *    （这里不做"部分成功"的处理，因为 `existingVideoIds` 要么给出完整集合、要么抛）。
 *    ⚠️ 那意味着：`existingExternalIds` **空集合**是"上游说这些一条都不在了"，
 *    不是"这次没问到" —— 后者根本走不到这里。
 * ⚠️ `hidden` 只数**真的被改动的行**（`changes`），不是"差集里有几个"：
 *    `hide` 那句带着 `AND status = 'visible'`，所以已经隐藏过的行不会被重复计数
 *    （今天挑不到这样的行，但那个前缀是**第二道闸** —— 它保证"隐藏"这件事只发生一次，
 *    时间与原因因此是**第一次**判定的那一刻，不会被后来的一轮改写）。
 * ⚠️ 返回的 `checked` 是**这一批问了几个**（`checked.length`），不是"写得动几个"：
 *    调用方拿它拼 spec §6.3 那行 `核对: 查 N 个 / 隐藏 M 个`。
 */
export function applyVerifyResult(
  checked: ReadonlyArray<{ id: string; externalId: string }>,
  existingExternalIds: ReadonlySet<string>,
  now: number,
): { checked: number; hidden: number } {
  if (checked.length === 0) return { checked: 0, hidden: 0 };

  const db = getDb();
  // ★ `now` 是 **Unix 秒**（与 `published_at` 同一单位；`audit_log` 才是毫秒）—— 下面两个 UPDATE
  //   都拿它写 `verify_checked_at` / `hidden_at`：传 `Date.now()` 会把这些行钉在轮转游标的末尾。
  const markChecked = db.prepare('UPDATE tracked_videos SET verify_checked_at = ? WHERE id = ?');
  const hide = db.prepare(
    `UPDATE tracked_videos SET verify_checked_at = ?, status = 'hidden',
            hidden_at = ?, hidden_reason = 'upstream_gone'
      WHERE id = ? AND status = 'visible'`,
  );

  let hidden = 0;
  db.exec('BEGIN');
  try {
    for (const row of checked) {
      if (existingExternalIds.has(row.externalId)) {
        markChecked.run(now, row.id);
      } else {
        // ⚠️ `changes` 的类型是 `number | bigint`（node:sqlite），`Number()` 与 `deleteCreator` 一致
        hidden += Number(hide.run(now, now, row.id).changes);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { checked: checked.length, hidden };
}

/**
 * 只盖 `verify_checked_at = now`、**判定一个都不碰**（比值闸那条路，spec §6.2 第 4 条）。
 *
 * ★★ 它与 `applyVerifyResult` 的**失败形状**是两件事，别把它们合并成一个"算了"：
 *   · **失败**（适配器抛了）⇒ 调用方一条都不写：我们**什么都不知道**，再问一遍是幂等的，
 *     而给这批行盖一个"查过了"会把它们**送到队尾**（`COALESCE(verify_checked_at, 0) ASC`）；
 *   · **这道闸**（拿到了完整答案、但答案长得不像真的）⇒ 答案是**完整的**，
 *     我们只是**选择不照它动手**（一条都不隐藏），所以这一批不能被记成"从没问过"。
 *     ⚠️ 不盖章的代价是**整个功能被钉死在这一批上**：它的 `verify_checked_at` 停在 `NULL`，
 *        而轮转游标把"没查过的"排在最前面 ⇒ 这一批**每一轮**都被第一个挑中，同平台其余的行
 *        **永远排在它后面轮不到**（文件头第九节那条饿死），并且 CLI 每一轮都以非零退出码收场。
 *        一次多日没核对（timer 停了、部署窗口、或者库里本来就有上游早就清掉的行）就够触发。
 *     ⇒ 盖了章它就在队列里**排到后面**去：等别的行都轮过一遍，它会被**重问一次**
 *       （重问是幂等的）—— 而"这一批这次不作数"仍然由调用方那条 `verifyErrors`
 *       （含非零退出码）响亮地记着。
 *
 * ⚠️★ `now` 的单位是 **Unix 秒**（计划 Global Constraint 2；`audit_log` 才是毫秒）——
 *    与 `applyVerifyResult` 写的那两列**同一个单位**。传毫秒的话这些行会**永远**排在秒值的后面，
 *    而每一轮的摘要看起来都正常（第九节那条饿死的另一个入口）。
 *
 * ⚠️ 返回的是**真的写进去几行**（`changes` 之和），不是 `rows.length`：管理员在 CLI 跑着的时候
 *    删掉一个博主，他的行已经跟着级联没了 —— 与 `applyVerifyResult` 里 `hidden` 数 `changes`
 *    同一条纪律（"写动了几个"才是调用方要知道的数）。
 */
export function markCheckedWithoutHiding(rows: ReadonlyArray<{ id: string }>, now: number): number {
  // 没有要盖的行 ⇒ 连事务都不开（与 `applyVerifyResult` 同一句）。
  if (rows.length === 0) return 0;

  const db = getDb();
  // ★ `now` 是 **Unix 秒**：这一句与 `applyVerifyResult` 里的 `markChecked` **逐字一样**，
  //   只是**不碰** `status` / `hidden_at` / `hidden_reason`（这一条路一条都不隐藏）。
  const markChecked = db.prepare('UPDATE tracked_videos SET verify_checked_at = ? WHERE id = ?');

  let stamped = 0;
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      // ⚠️ `changes` 的类型是 `number | bigint`（node:sqlite），`Number()` 与 `applyVerifyResult` 一致
      stamped += Number(markChecked.run(now, row.id).changes);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return stamped;
}

// ---------------------------------------------------------------------------
// 写：这一轮的结果
// ---------------------------------------------------------------------------

/**
 * 记一次**推进**：游标到哪了、要不要收尾，顺手把上一轮的失败状态清掉。
 *
 * ⚠️ 三条故意不在字面里的决定：
 *   ① `done = false` **不清** `backfill_done`。增量那条路也调这个函数
 *      （它带的游标是增量自己那一页的），把 `backfill_done` 打成 0 的话，
 *      一个**已经回填完**的博主会被扔回回填队列 ⇒ 每轮都从第一页重抓一遍，
 *      而且没有任何报错。⇒ 用 `CASE` 只让 `done = true` 能把那一列置 1。
 *   ② `last_synced_at` **每成功一次就推到现在**（不只是收尾那次）：
 *      spec §3.2 的"该增量了"读的就是它。不推的话，一个博主每 10 分钟
 *      就会被判定成"该增量"，整份名单每轮都全量重扫（§3.3 的有界设计白写）。
 *      ⚠️ 它因此是**成功**的水位 —— `recordFailure` 绝不碰它（见那个函数）。
 *   ③ `consecutive_failures` 归零、`last_error` 抹成 `NULL`：一次成功就是一次成功，
 *      计数从 0 重新开始（"要不要放弃这个频道"那个判据读的就是它）。
 *      ⚠️ 留着 last_error 的话，管理面板上会一直显示一条早就好了的错误。
 *   ④ `cooldown_until` 也**必须**清成 `NULL`（迁移 022）：不清的表现是"他已经好了，
 *      但接下来一小时还是不被挑"—— 而界面上那一行仍然写着"冷却中"，看不出任何异常。
 *      它与 ③ 是同一件事的两半（冷却的**唯一**来源是连续失败），所以两条一起写在这里。
 *      ⚠️ 现实里这条路走得通：冷却期间这一列会被 `pickDueCreators` 跳过，而窗口一到
 *      他又被挑中 ⇒ 一次成功就落在这里（这就是"到点自己回来"那条闭环的下半截）。
 *
 * ⚠️ 博主不存在时静默无事发生（UPDATE 影响 0 行）：现实里会有 ——
 *    管理员在 CLI 跑着的时候把他删了，视频也跟着级联没了。
 */
const ADVANCE_CURSOR_SQL = `
  UPDATE tracked_creators
     SET last_cursor = ?, last_synced_at = ?, last_error = NULL, consecutive_failures = 0,
         cooldown_until = NULL,
         updated_at = ?,
         backfill_done = CASE WHEN ? = 1 THEN 1 ELSE backfill_done END
   WHERE id = ?
`;

export function advanceCursor(
  creatorId: string,
  cursor: string | null,
  done: boolean,
  now: number,
): void {
  getDb()
    .prepare(ADVANCE_CURSOR_SQL)
    .run(
      cursor, // last_cursor（收尾时是 NULL：翻完了，下一次从第一页开始）
      now, // last_synced_at
      now, // updated_at
      done ? 1 : 0, // 只有 1 才把 backfill_done 置 1（见上面 ①）
      creatorId,
    );
}

/**
 * 记一次**失败**：原文写进 `last_error`，计数**加一**。
 *
 * ⚠️ 计数写成 `consecutive_failures + 1`（SQL 自己的加法），不是"读出来加一写回去"：
 *    后者在同一个进程里也许看不出来，但它把"两个地方同时写"变成了一个会丢更新的形状，
 *    而这里根本不需要读那一列。
 * ⚠️ `last_synced_at` **不动**：它是**成功**的水位。失败时顺手写上"刚刚试过了"
 *    会让这个博主在一小时内不再到点 —— 表现是"它一直在失败，但下一轮日志里根本没有它"，
 *    比失败本身难查得多。
 * ⚠️ `enabled` 也不动：连续失败不是自动停用。停用是编辑的决定（spec §6.3 的
 *    `consecutive_failures` 是给人看的判据，不是自动开关）。
 *
 * ★★ 冷却那一列（迁移 022）的三条规矩，**全部在这一句 SQL 里**表达：
 *
 * ```sql
 * cooldown_until = CASE
 *   WHEN consecutive_failures + 1 >= ?                          -- 满 3 次
 *        AND (cooldown_until IS NULL OR cooldown_until <= ?)     -- 而且现在不在冷却里
 *     THEN ? + ?                                                 -- now + 3600
 *   ELSE cooldown_until                                          -- 否则原样留着
 * END
 * ```
 *
 *   ① **满了才设**：`consecutive_failures + 1 >= ?` 读的是**这一句之前的**旧值
 *      （SQLite 的 UPDATE 里，等号右边的列名一律是更新前的值）⇒ 第 3 次失败才落死线，
 *      第 1、2 次什么都不做（一次抖动不该让他歇一小时，见 `COOLDOWN_AFTER_FAILURES`）。
 *   ② **不续期**：已经在冷却里（`cooldown_until > now`）时走 `ELSE`，死线**原地不动**。
 *      ⚠️★ 反过来（每次失败都写 `now + 3600`）的后果**正好与这个功能的目的相反**：
 *      一个被风控盯上的 IP 每 10 分钟失败一次 ⇒ 死线每 10 分钟往后推一小时 ⇒
 *      **永远出不来**。而这个错的现场特别难认：库里那一列看着"一直在更新"，
 *      日志里也一直在记失败，只有"这个频道再也不被抓了"这件事是静默的。
 *   ③ **过期之后重新计**：`cooldown_until <= now` 就是"窗口已经过去了"，那时再一次失败
 *      会设一条新的死线（`now + COOLDOWN_SEC`）—— 也就是"还是不行就再歇一小时"。
 *      ⚠️ 判据是"**这一刻还在不在冷却里**"而不是"计数到没到 3"：计数在成功时清零，
 *      而冷却期内的失败会让它停在 ≥3，用计数当判据就分不出这两种情形了。
 *
 *   ⚠️ 三件事挤在一句 SQL 里（而不是"读出来、在 TS 里算、再写回去"）的理由与
 *   计数那一条**逐字相同**：读-改-写会把一次并发写入变成丢更新，而这里根本不需要读。
 */
const RECORD_FAILURE_SQL = `
  UPDATE tracked_creators
     SET last_error = ?, consecutive_failures = consecutive_failures + 1,
         cooldown_until = CASE
           WHEN consecutive_failures + 1 >= ?
                AND (cooldown_until IS NULL OR cooldown_until <= ?)
             THEN ? + ?
           ELSE cooldown_until
         END,
         updated_at = ?
   WHERE id = ?
`;

export function recordFailure(creatorId: string, message: string, now: number): void {
  getDb().prepare(RECORD_FAILURE_SQL).run(
    message, // last_error（原文；管理面板与 spec §6.3 的摘要都读它）
    COOLDOWN_AFTER_FAILURES, // 上面 CASE 的阈值（3）
    now, // 上面 CASE 的"现在" —— 死线还没到才算"在冷却里"（不续期那条）
    now, // 死线的基数是**这一次**失败的时刻（不是上一轮的死线）
    COOLDOWN_SEC, // …加上一小时（`? + ?` 由 SQL 自己算，与 `+ 1` 同一手法）
    now, // updated_at
    creatorId,
  );
}

/**
 * 名单上现在**还在冷却里**的博主有几个（给 `track --dry-run` 那一行用）。
 *
 * ★ 它存在的理由是**可读性**，不是可观测性：一个冷却中的博主**不在待办里**
 *   （`pickDueCreators` 跳过），所以预演的列表里根本没有他 —— 没有这一行的话，
 *   操作者看到的就只是"名单上 20 个人，待办里 3 个"，然后去怀疑抓取漏了谁。
 *   `docs/pending.md` §5.98 就是这条：那一次的现象正是"两个 bilibili 频道从 09:30 起
 *   没再更新"，而摘要里一行错都没有（失败**被记下来**了，但没人知道它已经进了冷却）。
 *
 * ⚠️ 判据与 `pickDueCreators` **逐字对齐**：`enabled = 1` 且 `cooldown_until > now`。
 *    · 带 `enabled = 1` 是因为停用的博主不在待办里的原因是**另一件事** ——
 *      把他数进来的话，这一行会指着一个错的病因（"他在冷却"），而编辑该看的是"他停用了"；
 *    · 边界也是闭的（`> now` 才算还在冷却），与待办那条 `<=` 是同一根线，少写一个等号
 *      就会出现"预演说 1 个在冷却、而待办里他已经回来了"这种自相矛盾的输出。
 *
 * ⚠️ 它**只读**（一句 SELECT）：预演那句"不抓任何一页、不动名单与视频的任何一行"照旧成立。
 * ⚠️ 它**不按平台分组**：冷却是一个博主的状态，与平台无关（三个平台各有各的失败，
 *   而风控那件事今天只在 bilibili 上发生过 —— 但判据不该只对某一个平台成立）。
 */
export function countCoolingCreators(now: number): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM tracked_creators WHERE enabled = 1 AND cooldown_until > ?')
    .get(now) as { n: number } | undefined;
  return row?.n ?? 0;
}
