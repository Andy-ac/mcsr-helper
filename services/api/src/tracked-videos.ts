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
 *   · **少算**（比如只数 `status = 'visible'` 的）⇒ 一个 UP 主的视频里有几条被编辑
 *     手工隐藏过时，`storedTotal` 永远比上游的 `count` 小 ⇒ `reachedEnd` **永远不为真** ⇒
 *     回填永远翻不完（不是丢数据，是这个频道**永远停不下来**，每轮都在重翻）。
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
 *   · `status` —— ★ 编辑**手工隐藏**过的视频不许被抓取放回来。
 *     v1 还没有隐藏端点（§6.1 里没有），所以编辑是直接改库的；`DO UPDATE` 里捎上
 *     `status = excluded.status` 的表现是"隐藏过的那支过十分钟又出现了"，
 *     而且没有任何地方报错。`tracking-store.test.ts` 里有一条专门钉它
 *     （plans/task-4 mutation 表点名的那条）。
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
 */
import type { TrackedCreator, TrackedVideo, TrackPlatform } from '@mcsr/shared';
import { newId } from './auth/tokens';
import { getDb } from './db';
import { deriveTags } from './tracking/parse';
import type { CreatorRef, FetchedVideo } from './tracking/types';

/** 增量同步的间隔（秒）。spec §3.2 / §10 冻结值：一小时。 */
const INCREMENTAL_INTERVAL_SEC = 3600;

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
  enabled: number;
  created_at: number;
  video_count: number;
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
}

/**
 * 列名逐列写出来（见文件头第八节）。`updated_at` 不在里面：对外的
 * `TrackedVideo` 没有这一格，多读一列只是多一处将来会漂的地方。
 */
const VIDEO_COLUMNS = `
  id, creator_id, platform, external_id, title, thumbnail_url, published_at,
  duration_sec, view_count, comment_count, is_live_replay, tags, status,
  first_seen_at
`;

const CREATOR_COLUMNS = `
  c.id, c.platform, c.external_id, c.handle, c.display_name, c.avatar_url, c.platform_meta,
  c.backfill_done, c.last_cursor, c.last_synced_at, c.last_error, c.consecutive_failures,
  c.enabled, c.created_at
`;

/**
 * 名单 + 每个博主的条数。
 *
 * ⚠️ `COUNT(v.id)`（**不是** `COUNT(*)`）：`LEFT JOIN` 对没有视频的博主会补一行全 NULL，
 *    而 `COUNT(*)` 会把那一行也数进去 ⇒ 每个"还没抓过"的博主都显示 1 条，
 *    而这正是管理面板上最需要说老实话的那一格（`COUNT(v.id)` 不数 NULL）。
 * ⚠️ 一次 `GROUP BY` 拿回来，不是每个博主查一次条数（与 `resources.ts:173-180`
 *    那条"列表一页 24 条就是 48 次查询"同一个理由）。
 */
const CREATOR_SELECT = `
  SELECT ${CREATOR_COLUMNS}, COUNT(v.id) AS video_count
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
    // 0/1 → boolean 只在这里换算一次（spec §4.3 的边界纪律）
    enabled: row.enabled === 1,
    videoCount: row.video_count,
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
    // ⚠️ 这里**不填** `creatorName`：shared 的注释写明它只有管理面板要
    //（公开列表多一次 JOIN 只为拿一个不显示的字段，不值）。
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
 * 公开列表：**只出 `visible` 的**，按发布时间倒序。
 *
 * ⚠️ 为什么要过滤 `status`：v1 没有隐藏端点（spec §6.1 里只有五个端点），
 *    所以 `hidden` 是**编辑直接改库**设的 —— 而一个没人读的状态等于没有那个状态。
 *    不过滤的话，"隐藏"这件事在界面上**一点也不生效**（`videos.ts:274` 那条纪律同理）。
 *    代价：这个 `total` 与 `storedVideoCount` 因此是两个数（见文件头第二节）——
 *    刻意的，两个数回答的是两个问题。
 *
 * ⚠️ `published_at` 为 NULL 的排在**最后**（SQLite 里 NULL 最小，`DESC` 就把它排到末尾），
 *    那正是想要的：日期不知道的视频不该顶在"最新的"位置上冒充今天发的。
 * ⚠️ 第二个排序键不是装饰（`videos.ts:266-270` 写过同一条理由）：同一秒发布的两支视频
 *    SQLite 不保证稳定顺序，翻页时会有记录重复出现或被整页跳过，而界面上看起来
 *    只是"好像漏了几条"。
 */
export function listTrackedVideos(opts: { limit: number; offset: number }): {
  items: TrackedVideo[];
  total: number;
} {
  const db = getDb();
  const limit = nonNegativeInt(opts.limit);
  const offset = nonNegativeInt(opts.offset);

  /*
   * `total` 与 `items` 跑的是**同一个条件**（这里是 `status = 'visible'`），
   * 所以把条件写成一处常量：两处各写一遍的话，某天给列表加上一个筛选条件时
   * 很容易只改一处 —— 而那种漏掉的表现是"翻到第三页就没有了"。
   */
  const visible = "status = 'visible'";

  const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM tracked_videos WHERE ${visible}`).get() as
    | { n: number }
    | undefined;

  const rows = db
    .prepare(
      `SELECT ${VIDEO_COLUMNS} FROM tracked_videos
        WHERE ${visible}
        ORDER BY published_at DESC, id ASC
        LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as unknown as VideoRow[];

  return { items: rows.map(toTrackedVideo), total: totalRow?.n ?? 0 };
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

/** 单个博主（对外形状）。不存在 ⇒ `null`。 */
function getCreator(id: string): TrackedCreator | null {
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
        GROUP BY c.id
        ORDER BY c.consecutive_failures ASC, COALESCE(c.last_synced_at, 0) ASC, c.id ASC
        LIMIT ?`,
    )
    .all(nonNegativeInt(limits.backfill)) as unknown as CreatorRow[];

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
        GROUP BY c.id
        ORDER BY c.consecutive_failures ASC, COALESCE(c.last_synced_at, 0) ASC, c.id ASC
        LIMIT ?`,
    )
    .all(
      now - INCREMENTAL_INTERVAL_SEC,
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
 *
 * ⚠️ 博主不存在时静默无事发生（UPDATE 影响 0 行）：现实里会有 ——
 *    管理员在 CLI 跑着的时候把他删了，视频也跟着级联没了。
 */
const ADVANCE_CURSOR_SQL = `
  UPDATE tracked_creators
     SET last_cursor = ?, last_synced_at = ?, last_error = NULL, consecutive_failures = 0,
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
 */
const RECORD_FAILURE_SQL = `
  UPDATE tracked_creators
     SET last_error = ?, consecutive_failures = consecutive_failures + 1, updated_at = ?
   WHERE id = ?
`;

export function recordFailure(creatorId: string, message: string, now: number): void {
  getDb().prepare(RECORD_FAILURE_SQL).run(
    message, // last_error（原文；管理面板与 spec §6.3 的摘要都读它）
    now, // updated_at
    creatorId,
  );
}
