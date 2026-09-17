/**
 * 直播板块的数据层 —— **两份东西**，别混：
 *
 *   1. `live_channels` —— 编辑维护的**公开名单**（下面那群 `LiveChannel*` 函数）；
 *   2. `user_live_links` —— 每个登录用户自己的**私人链接**（④，见文件末尾）。
 *      它只给自己看、不进公开名单、不参与审核，两张表**互不写入**。
 *
 * 表结构和字段语义见 `packages/shared/src/live.ts` 的文件头。
 * 这里只管存取，不管"能不能嵌" —— 那是 `liveEmbedDecision()` 的事
 * （现在只有 `liveEmbedUrl()` 那一层薄封装，**不要再复制一份判定**）。
 */
import {
  type LiveChannelInput,
  type LivePlatform,
  parseLiveLink,
  type UserLiveLink,
  type UserLiveLinkInput,
  type UserLiveLinkPatch,
} from '@mcsr/shared/live';
import { newId } from './auth/tokens';
import { getDb } from './db';

interface LiveRow {
  id: string;
  platform: string;
  handle: string;
  display_name: string;
  note: string | null;
  /** JSON 数组文本（例如 `["速通","Ranked"]`），NULL = 没填。 */
  tags: string | null;
  live_video_id: string | null;
  embed_channel: number;
  sort_order: number;
  status: string;
  created_at: number;
  updated_at: number;
  /** 迁移 023 的三列：`is_live` 0/1/NULL、`viewer_count` 可空、`live_checked_at` Unix **秒**。 */
  is_live: number | null;
  viewer_count: number | null;
  live_checked_at: number | null;
}

/**
 * 标签列 → 数组。
 *
 * ⚠️ **读的时候必须容错**：这一列是 JSON 文本，而 SQLite 不校验它。手改过库、
 *    或者将来有人用别的脚本写进一段坏 JSON，都会让 `JSON.parse` 抛异常 ——
 *    那会让**整个直播列表**500，而不是只少几个标签。
 *    ⇒ 解析失败就当成"没有标签"，并且**不静默吞掉**：留一条 warn，方便排查。
 */
function tagsFromColumn(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is string => typeof t === 'string' && t.trim() !== '');
  } catch {
    console.warn(`[live] live_channels.tags 不是合法 JSON，按空标签处理：${raw.slice(0, 80)}`);
    return [];
  }
}

/** 数组 → 标签列。空数组存成 NULL（不是 `'[]'`）—— "没填"只有一种表示。 */
function tagsToColumn(tags: readonly string[]): string | null {
  return tags.length === 0 ? null : JSON.stringify(tags);
}

/**
 * 行 → 对外形状。
 *
 * ⚠️ 逐字段展开成普通对象字面量，不用 `{ ...row }`：
 *    node:sqlite 的行对象原型不是 `Object.prototype`，而测试里的
 *    `deepStrictEqual` 会比较原型 —— 不展开的话两边打印出来一模一样却判不相等。
 *    （这条坑在本仓踩过不止一次，见 videos.ts / calendar/events.ts 里同样的注释。）
 */
function toChannel(row: LiveRow) {
  return {
    id: row.id,
    platform: row.platform as LivePlatform,
    handle: row.handle,
    displayName: row.display_name,
    note: row.note,
    tags: tagsFromColumn(row.tags),
    liveVideoId: row.live_video_id,
    // SQLite 没有 boolean：0/1 → false/true，只在这一处转
    embedChannel: row.embed_channel === 1,
    sortOrder: Number(row.sort_order),
    status: row.status,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    /*
     * ★ 直播状态三列（迁移 023）。**`NULL` 必须原样传出去**：
     *   · `is_live IS NULL` ⇒ `isLive: null`（"从没查过 / 查不到"），
     *     ⚠️ **不是 `false`** —— 那是"问过，没在播"，一句我们没验证过的话；
     *   · `viewer_count IS NULL` ⇒ `viewerCount: null`（上游没给），**不是 0**。
     *   三个字段的语义写在 `packages/shared/src/live.ts` 的 `LiveChannel` 上。
     */
    isLive: row.is_live === null ? null : row.is_live === 1,
    viewerCount: row.viewer_count === null ? null : Number(row.viewer_count),
    liveCheckedAt: row.live_checked_at === null ? null : Number(row.live_checked_at),
  };
}

/**
 * 公开列表的排序键（用户第 10 条："正在直播的频道按观看人数递降的顺序排列在前面"）。
 *
 * ---------------------------------------------------------------------------
 * ★ 三段，每一段回答一个不同的问题
 * ---------------------------------------------------------------------------
 *   ① `CASE WHEN is_live = 1 THEN 0 ELSE 1 END ASC`
 *      —— 在播的整段在前。**写成 CASE 而不是 `is_live = 1 DESC`**：后者对
 *      `is_live IS NULL`（从没查过）求值是 **NULL**，而 SQLite 里 NULL 在 DESC 下排最后
 *      ⇒ 那些行会被挤到"不在播"**之后**，于是"其余保持今天的顺序"这句话当场变成假的
 *      （今天的顺序是整个尾部按 sort_order 排的）。本机实测过这个性质
 *      （`.cache/videos-live-round/probe-023-sqlite.mjs` 的 ②）。
 *   ② `CASE WHEN is_live = 1 THEN viewer_count ELSE NULL END DESC`
 *      —— 在播内部按人数降序；**人数为 NULL 的在播行排在有点数的后面**
 *      （SQLite 的 DESC 把 NULL 排最后，同一条实测）。**不是**把 NULL 当 0：
 *      当 0 的话，"上游没给人数"会排在"真的 0 人看"**前面**，而这两件事必须分得开。
 *      其它行在这一键上全是 NULL ⇒ 它们之间由一个**相等**的键分开，落到 ③。
 *   ③ `sort_order ASC, display_name ASC` —— **今天那两个键，一个字没改**（不在播的、
 *      从没查过的，全都按它排；第二键钉死顺序的理由见下面那段旧注释）。
 *
 * ⚠️ 索引：这一页一共 184 行（2026-09-18 生产快照实测），`EXPLAIN QUERY PLAN` 走
 *    `idx_live_listing (status, sort_order)` + `USE TEMP B-TREE FOR ORDER BY`，
 *    整条语句跑 20 次合计 **8.9 ms**（探针脚本 `probe-023-sqlite.mjs` 的 ④，
 *    `.cache/videos-live-round/probe-023-sqlite.out.txt`）。⚠️ 同一份快照上，迁移演练
 *    脚本 `rehearse-023.mjs` 另量到 **12.1 ms**（`rehearse-023.out.txt`）——
 *    终审 M5 之前这里写的是"10.7–12.1"，而**那个 10.7 没有任何留档**；现在只留
 *    两个有出处的读数，`023_live_status.ts` / `migrate.ts` 引的是同一对。
 *    ⇒ **不为它建索引**（要建就得建表达式索引，而每次写都要维护它）。理由与读数
 *    也写在 `023_live_status.ts` 的文件头第三节 —— 那儿是"决定不建"的地方。
 */
const LIVE_ORDER_BY = `
  CASE WHEN is_live = 1 THEN 0 ELSE 1 END ASC,
  CASE WHEN is_live = 1 THEN viewer_count ELSE NULL END DESC,
  sort_order ASC,
  display_name ASC`;

/**
 * 公开列表：只出 visible，按上面那段排序键。
 *
 * ⚠️ 排序的第二键（`sort_order` 之后）是 `display_name`，不是 `id`。
 *    只按 sort_order 排的话，同序的两行顺序由 SQLite 自己决定 ——
 *    而它对同一份数据可以给出不同的顺序（尤其是加了索引之后），
 *    表现是"刷新一次，两个主播换了位置"。第二键把顺序钉死。
 */
export function listLiveChannels(includeHidden = false) {
  const sql = includeHidden
    ? `SELECT * FROM live_channels ORDER BY ${LIVE_ORDER_BY}`
    : `SELECT * FROM live_channels WHERE status = 'visible' ORDER BY ${LIVE_ORDER_BY}`;
  const rows = getDb().prepare(sql).all() as unknown as LiveRow[];
  return rows.map(toChannel);
}

/** 一轮直播状态检查要问的那些行（见 `live-status.ts`）。 */
export interface LiveStatusTarget {
  id: string;
  platform: LivePlatform;
  /** Twitch 是 login、B站 是房间号；**这里不做形状判断**（那是适配层的事）。 */
  handle: string;
}

/**
 * ★ 采集作业要查哪些行 —— **只查 visible**。
 *
 * ⚠️ 为什么不管 hidden 行：这个作业存在的全部意义是"公开列表上那个『直播中』徽章
 *    是真的"，被隐藏的行不在这份列表上。代价（认下）：编辑把一行从隐藏改回显示之后，
 *    它的状态要等**下一轮**（≤3 分钟）才有；在那之前那一行什么标记都不显示 ——
 *    而"什么都不显示"正是这一页对"没查过"的既有说法，不是谎。
 * ⚠️ 顺序是 `platform, sort_order, display_name`：不是为了好看，是为了**确定性**
 *    （分批与日志里那一行在两次运行之间一致，排查时才能逐行对照）。
 */
export function listLiveStatusTargets(): LiveStatusTarget[] {
  const rows = getDb()
    .prepare(
      `SELECT id, platform, handle FROM live_channels
        WHERE status = 'visible'
        ORDER BY platform ASC, sort_order ASC, display_name ASC`,
    )
    .all() as unknown as Array<{ id: string; platform: string; handle: string }>;
  return rows.map((row) => ({
    id: row.id,
    platform: row.platform as LivePlatform,
    handle: row.handle,
  }));
}

/** 一行要写回去的直播状态。**`isLive` 只有 0 / 1** —— 这个作业从不写 NULL。 */
export interface LiveStatusUpdate {
  id: string;
  isLive: 0 | 1;
  /** `null` = 上游没给人数（**不是 0**）。 */
  viewerCount: number | null;
}

/**
 * ★ 把一批"查到了什么"写回去 —— 采集作业唯一的写入口。
 *
 * ---------------------------------------------------------------------------
 * 三条规矩（它们就是这一层的全部内容）
 * ---------------------------------------------------------------------------
 *   ① **只写传进来的那些行**：没传进来的行（这一轮没查、或那一批上游失败了）
 *      一个字节都不动 —— 包括 `live_checked_at`。这是"一次网络抖动不许把所有人
 *      标成不在播"这条要求在数据层的形状：**"不在播"必须由一次成功的回答产生**。
 *   ② **整批在一个事务里**：要么都进去，要么都不进。不然失败时库里会留下
 *      "一半是这一轮的时刻、一半是上一轮的时刻"，而日志上那一行数字只对一半
 *      （本仓 §5.47：一个错得不自洽的计数比没有计数更危险）。
 *   ③ `live_checked_at` 是 **Unix 秒**（三列里唯一的秒；`live_channels` 的
 *      `created_at` / `updated_at` 是**毫秒**）。填错的后果是不报错的：
 *      界面上的时刻会跑到 5 万年以后，而"这一格是什么时候查的"这件事
 *      就没有第二种方式能发现。
 *
 * @param checkedAt 这一批的时刻（Unix **秒**）。
 * @returns 真的写进去的行数（= `updates.length`，除非抛异常）。
 */
export function applyLiveStatus(updates: readonly LiveStatusUpdate[], checkedAt: number): number {
  if (updates.length === 0) return 0;

  const db = getDb();
  const statement = db.prepare(
    'UPDATE live_channels SET is_live = ?, viewer_count = ?, live_checked_at = ? WHERE id = ?',
  );

  db.exec('BEGIN');
  try {
    for (const update of updates) {
      statement.run(update.isLive, update.viewerCount, checkedAt, update.id);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return updates.length;
}

export function getLiveChannel(id: string) {
  const row = getDb().prepare('SELECT * FROM live_channels WHERE id = ?').get(id) as
    | LiveRow
    | undefined;
  return row ? toChannel(row) : null;
}

/**
 * 同平台同频道（或同一场直播）是否已经有了 —— `UNIQUE(platform, handle, live_video_id)`
 * 的友好版本。
 *
 * ⚠️ **2026-09-13 起去重键变成三列**（迁移 016），这个函数必须跟着变：
 *    只按 `(platform, handle)` 查的话，两行"只粘了直播视频链接"的记录
 *    （`handle` 都是空串、视频 ID 不同）会被判成重复 —— 而它们在库里是**合法的两行**。
 *    表现是"加第二个 YouTube 主播时被说成『这条已经记过了』"。
 * ⚠️ `live_video_id` 是**可空**列，而 SQL 的 `= NULL` 永远不成立 ⇒ 必须用
 *    `IS`（SQLite 支持 `IS` 做空值安全比较），否则"只粘频道链接"的行永远查不到自己。
 */
export function findLiveChannelByHandle(
  platform: string,
  handle: string,
  liveVideoId: string | null,
) {
  const row = getDb()
    .prepare('SELECT * FROM live_channels WHERE platform = ? AND handle = ? AND live_video_id IS ?')
    .get(platform, handle, liveVideoId) as LiveRow | undefined;
  return row ? toChannel(row) : null;
}

export function createLiveChannel(
  input: LiveChannelInput,
  now: number,
):
  | { ok: true; channel: ReturnType<typeof toChannel> }
  | { ok: false; existing: ReturnType<typeof toChannel> } {
  /*
   * ⚠️ 先查一次再插入，而不是靠 UNIQUE 异常发现重复：
   *    重复是这份清单最常见的**正常**结果（同一个主播被两个人加），
   *    让它走异常路径就等于让常见情况走异常路径（和资源库 / 视频那边同一个决定）。
   *    catch 仍然保留作竞态兜底。
   */
  const existing = findLiveChannelByHandle(input.platform, input.handle, input.liveVideoId ?? null);
  if (existing) return { ok: false, existing };

  const id = newId();
  try {
    getDb()
      .prepare(
        `INSERT INTO live_channels
           (id, platform, handle, display_name, note, tags, live_video_id, embed_channel,
            sort_order, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'visible', ?, ?)`,
      )
      .run(
        id,
        input.platform,
        input.handle,
        input.displayName,
        input.note ?? null,
        tagsToColumn(input.tags),
        input.liveVideoId ?? null,
        input.embedChannel ? 1 : 0,
        input.sortOrder,
        now,
        now,
      );
  } catch (error) {
    // 竞态兜底：只有真的能查到同一个 (platform, handle) 才当成重复
    const race = findLiveChannelByHandle(input.platform, input.handle, input.liveVideoId ?? null);
    if (race) return { ok: false, existing: race };
    throw error;
  }

  const created = getLiveChannel(id);
  if (!created) throw new Error(`直播频道 ${id} 插入成功却读不回来`);
  return { ok: true, channel: created };
}

/**
 * 「没有才插」要的几列 —— **窄**接口，不是 `LiveChannelInput`。
 *
 * ⚠️ 为什么不复用 `LiveChannelInput`：那个类型是**编辑表单的输出**，里面有一格
 *    `url`，而 `live_channels` 表**根本没有这一列**（链接是按平台 + handle 拼出来的）。
 *    ingest 没有"用户粘的那条链接"可以填，硬造一个出来只会让读的人以为它被存了。
 */
export interface LiveChannelInsert {
  platform: LivePlatform;
  handle: string;
  displayName: string;
  note?: string | null;
  tags: readonly string[];
  liveVideoId: string | null;
  embedChannel: boolean;
  sortOrder: number;
}

/**
 * ★ 「没有才插」—— 机器收录（ingest）专用的插入路径。
 *
 * ---------------------------------------------------------------------------
 * ⚠️⚠️ 为什么**不能**写成 `INSERT … ON CONFLICT (platform, handle, live_video_id) DO NOTHING`
 * ---------------------------------------------------------------------------
 * 那是这件事里最容易顺手写下的形状，而它**在这里根本不成立**：SQLite 的唯一索引把
 * **NULL 当成彼此不相同**（SQL 标准如此；本机 `node:sqlite` 3.53 实测：同一组
 * `('twitch','foo',NULL)` 连插三次，加 `ON CONFLICT … DO NOTHING` 得到的是**三行**）。
 * 而机器收录写的正是 `live_video_id = NULL` 的那些行 ⇒ 用它的话**每次请求都会多一行**，
 * 而且门禁全绿（每次插入都"成功"了，没有任何地方报错）。
 * ⇒ 判据必须**空值安全**：`WHERE NOT EXISTS (… live_video_id IS ?)`。
 *    这与本文件 `findLiveChannelByHandle` 用 `IS ?` 是同一条理由、同一个坑。
 *    （`ON CONFLICT` 那一句留着也没有意义：它只对三列全非 NULL 的行生效，
 *     而那些行本来就走不到这里。）
 *
 * ---------------------------------------------------------------------------
 * ★ 为什么是**一条**语句，而不是 `createLiveChannel` 那种"先查再插"
 * ---------------------------------------------------------------------------
 * `INSERT … SELECT … WHERE NOT EXISTS` 由 SQLite **原子**执行：多进程 / 多连接并发时
 * 不会出现"两边都查不到、两边都插进去"。`createLiveChannel` 的两段式是给**编辑表单**
 * 写的 —— 它要把撞上的那一行**读回**给用户看，好说一句「这条已经记过了」；
 * 而机器收录只需要"插进去了没有"这一个布尔，两段式在这里只是多一次查询和一个竞态。
 *
 * ⚠️ 它**只插不改**（没有 UPDATE、没有 DELETE、插入的行一律 `status='visible'`）：
 *    ingest 绝不许覆盖或隐藏编辑动过的东西 —— 那条运维结论写在 `ranked/ingest.ts`。
 *
 * @returns 真的插进去了 `true`；那一组三列已经存在（或并发下被别人先插了）`false`。
 */
export function insertLiveChannelIfAbsent(input: LiveChannelInsert, now: number): boolean {
  const inserted = getDb()
    .prepare(
      `INSERT INTO live_channels
         (id, platform, handle, display_name, note, tags, live_video_id, embed_channel,
          sort_order, status, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'visible', ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM live_channels
           WHERE platform = ? AND handle = ? AND live_video_id IS ?
        )`,
    )
    .run(
      newId(),
      input.platform,
      input.handle,
      input.displayName,
      input.note ?? null,
      tagsToColumn(input.tags),
      input.liveVideoId,
      input.embedChannel ? 1 : 0,
      input.sortOrder,
      now,
      now,
      input.platform,
      input.handle,
      input.liveVideoId,
    );
  return inserted.changes > 0;
}

/** 全量更新一行（编辑表单就是"把这一行改成这样"）。 */
export function updateLiveChannel(
  id: string,
  input: LiveChannelInput,
  now: number,
):
  | { ok: true; channel: NonNullable<ReturnType<typeof getLiveChannel>> }
  | { ok: false; reason: 'not_found' | 'taken' } {
  const db = getDb();
  const row = db
    .prepare('SELECT id, platform, handle, live_video_id FROM live_channels WHERE id = ?')
    .get(id) as
    | { id: string; platform: string; handle: string; live_video_id: string | null }
    | undefined;
  if (!row) return { ok: false, reason: 'not_found' };

  /*
   * 改 handle 之后可能撞上另一行 —— 先查出来并**指回那一行**，
   * 而不是让 UNIQUE 抛一个用户看不懂的错。
   */
  const clash = findLiveChannelByHandle(input.platform, input.handle, input.liveVideoId ?? null);
  if (clash && clash.id !== id) return { ok: false, reason: 'taken' };

  /*
   * ★ 身份变了（平台 / 标识 / 视频 ID 有一个不一样）⇒ 把那三列**清回 NULL**。
   *
   * 理由：`is_live` / `viewer_count` / `live_checked_at` 是**关于某个具体频道**的读数，
   * 而这个表单可以把这一行**改成另一个频道**（用户原话：「我只要当前直播的视频 ID 就够了」
   * ⇒ 编辑确实会把某一行的链接换成别的）。不清的话，`twitch/foo` 那一行的
   * 「直播中」徽章会跟着变成 `twitch/bar` 的读者看到 —— 一句我们**从来没验证过**的话，
   * 而且是这一页最坏的一种错（它看起来完全正常）。
   * ⇒ 清回 `NULL` = "没查过"：界面什么都不显示，下一轮（≤3 分钟）就会补上真话。
   *
   * ⚠️ 用 `CASE WHEN ? THEN NULL ELSE <原列> END` 而不是"先读出来、再写回去"：
   *    后者在读与写之间有一个窗口，状态作业正好在那一刻写这一行的话，
   *    结果就是"编辑保存一次，刚查到的人数被抹掉"（而两边都不报错）。
   *    写成一条语句时它自己就是原子的。代价：SQL 长了一句，参数多三个（可忽略）。
   */
  const identityChanged =
    row.platform !== input.platform ||
    row.handle !== input.handle ||
    row.live_video_id !== (input.liveVideoId ?? null);
  const reset = identityChanged ? 1 : 0;

  db.prepare(
    `UPDATE live_channels SET
       platform = ?, handle = ?, display_name = ?, note = ?, tags = ?, live_video_id = ?,
       embed_channel = ?, sort_order = ?, updated_at = ?,
       is_live = CASE WHEN ? THEN NULL ELSE is_live END,
       viewer_count = CASE WHEN ? THEN NULL ELSE viewer_count END,
       live_checked_at = CASE WHEN ? THEN NULL ELSE live_checked_at END
     WHERE id = ?`,
  ).run(
    input.platform,
    input.handle,
    input.displayName,
    input.note ?? null,
    tagsToColumn(input.tags),
    input.liveVideoId ?? null,
    input.embedChannel ? 1 : 0,
    input.sortOrder,
    now,
    reset,
    reset,
    reset,
    id,
  );

  const updated = getLiveChannel(id);
  if (!updated) throw new Error(`直播频道 ${id} 更新之后读不回来`);
  return { ok: true, channel: updated };
}

/**
 * 隐藏 / 显示。
 *
 * ⚠️ 和视频那边一样是**真删之外的第二条路**，而且顺序也一致：
 *    编辑先隐藏（可恢复），确认真不要了再删。
 *    直接删掉会让"手滑"变成一个不可撤销的动作。
 */
export function setLiveChannelStatus(
  id: string,
  status: 'visible' | 'hidden',
  now: number,
): { ok: true; status: string; changed: boolean } | { ok: false; reason: 'not_found' } {
  const db = getDb();
  const row = db.prepare('SELECT status FROM live_channels WHERE id = ?').get(id) as
    | { status: string }
    | undefined;
  if (!row) return { ok: false, reason: 'not_found' };

  const changed = row.status !== status;
  if (changed) {
    db.prepare('UPDATE live_channels SET status = ?, updated_at = ? WHERE id = ?').run(
      status,
      now,
      id,
    );
  }
  return { ok: true, status, changed };
}

export function deleteLiveChannel(id: string): boolean {
  return getDb().prepare('DELETE FROM live_channels WHERE id = ?').run(id).changes > 0;
}

// ---------------------------------------------------------------------------
// ④ 私人链接（`user_live_links`）—— 每个函数**都带 userId**
// ---------------------------------------------------------------------------
/*
 * ⚠️ 这一组的**每一条语句**都必须把 `user_id = ?` 写进 WHERE。
 *    把"这是谁的行"交给路由去判断（先查出来再看 user_id）迟早会漏一处，
 *    而漏一处就是"能看/能改别人的私人数据"。写在 SQL 里则漏不掉 ——
 *    别人的行在这里**根本不存在**（这也是路由上"一律 404、绝不 403"的根据：
 *    我们确实查不到它，而不是"查到了但不许"）。
 *
 * ⚠️ 这一组**不写审计**：私人、自有的数据，与收藏/备注/评分同一档
 *    （`routes/marks.ts` 一个字都没提审计）。审计是给"谁动了**别人能看到的东西**"
 *    准备的 —— 而这里连本人都只有自己能看。将来若出现滥用，手段是限流，不是审计。
 */

interface UserLiveLinkRow {
  id: string;
  user_id: string;
  url: string;
  platform: string | null;
  handle: string | null;
  live_video_id: string | null;
  title: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * 行 → 对外形状。
 *
 * ⚠️ 同 `toChannel`：逐字段展开成普通对象字面量，不用 `{ ...row }` ——
 *    node:sqlite 的行对象原型不是 `Object.prototype`，测试里的 `deepStrictEqual`
 *    会比较原型（两边打印出来一样却判不相等）。
 */
function toUserLiveLink(row: UserLiveLinkRow): UserLiveLink {
  return {
    id: row.id,
    url: row.url,
    platform: row.platform === null ? null : (row.platform as LivePlatform),
    handle: row.handle,
    liveVideoId: row.live_video_id,
    title: row.title,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

/**
 * 用户输入的一条链接 → 要落库的三列（平台 / 标识 / 视频 ID）。
 *
 * ⚠️ 归一化只在这一处发生（POST 与 PATCH 共用它），所以"库里到底存了什么"
 *    不可能因为走哪条路而不同。
 * ⚠️ **解析失败不是错误**：认不出的链接照样存（platform / handle 为 NULL，
 *    界面只给外链）—— 那是用户自己贴的链接，我们没有理由拒收（D4b.4）。
 * ⚠️ `handle` 是空串时存 NULL：`watch?v=…` 这种"某一场直播"的链接里
 *    本来就没有频道标识，存空串会让"有没有标识"变成一个假的真值。
 */
function deriveLinkFields(rawUrl: string): {
  platform: LivePlatform | null;
  handle: string | null;
  liveVideoId: string | null;
} {
  const parsed = parseLiveLink(rawUrl);
  if (!parsed) return { platform: null, handle: null, liveVideoId: null };
  return {
    platform: parsed.platform,
    handle: parsed.handle === '' ? null : parsed.handle,
    liveVideoId: parsed.liveVideoId,
  };
}

/**
 * 我的链接，新的在前。
 *
 * ⚠️ 第二键是 `id`：同一毫秒建的几行也要有**确定**的顺序 ——
 *    只按 `created_at DESC` 排的话，并列行的顺序由 SQLite 自己决定，
 *    表现是"刷新一次，两行换了位置"（和 `listLiveChannels` 同一个理由）。
 */
export function listUserLiveLinks(userId: string): UserLiveLink[] {
  const rows = getDb()
    .prepare('SELECT * FROM user_live_links WHERE user_id = ? ORDER BY created_at DESC, id DESC')
    .all(userId) as unknown as UserLiveLinkRow[];
  return rows.map(toUserLiveLink);
}

/** 我的一条。**别人的行在这里就是 null**（路由据此回 404）。 */
export function getUserLiveLink(id: string, userId: string): UserLiveLink | null {
  const row = getDb()
    .prepare('SELECT * FROM user_live_links WHERE id = ? AND user_id = ?')
    .get(id, userId) as UserLiveLinkRow | undefined;
  return row ? toUserLiveLink(row) : null;
}

export function createUserLiveLink(
  userId: string,
  input: UserLiveLinkInput,
  now: number,
): UserLiveLink {
  const id = newId();
  const derived = deriveLinkFields(input.url);

  getDb()
    .prepare(
      `INSERT INTO user_live_links
         (id, user_id, url, platform, handle, live_video_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      input.url,
      derived.platform,
      derived.handle,
      derived.liveVideoId,
      input.title ?? null,
      now,
      now,
    );

  const created = getUserLiveLink(id, userId);
  if (!created) throw new Error(`私人直播链接 ${id} 插入成功却读不回来`);
  return created;
}

/**
 * 改我的一条（`url` / `title`，只改传了的那些）。
 *
 * ⚠️ 改了 `url` 就**必须重解析**：平台/标识是 url 的函数，不重算的话
 *    "改完链接、平台还是旧的"—— 而界面上那两样都会显示，且两边都不报错。
 * ⚠️ 传 `title: null` 是**清空**（与"没传"不同），两个状态都要能表达。
 * ⚠️ 不存在/不是自己的 → `not_found`（路由回 404），**没有**"别人的行"这条分支。
 */
export function updateUserLiveLink(
  id: string,
  userId: string,
  patch: UserLiveLinkPatch,
  now: number,
): { ok: true; link: UserLiveLink } | { ok: false; reason: 'not_found' } {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM user_live_links WHERE id = ? AND user_id = ?')
    .get(id, userId) as UserLiveLinkRow | undefined;
  if (!row) return { ok: false, reason: 'not_found' };

  const url = patch.url ?? row.url;
  const title = patch.title === undefined ? row.title : patch.title;
  const derived =
    patch.url === undefined
      ? { platform: row.platform, handle: row.handle, liveVideoId: row.live_video_id }
      : deriveLinkFields(url);

  db.prepare(
    `UPDATE user_live_links SET
       url = ?, platform = ?, handle = ?, live_video_id = ?, title = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  ).run(url, derived.platform, derived.handle, derived.liveVideoId, title, now, id, userId);

  const updated = getUserLiveLink(id, userId);
  if (!updated) throw new Error(`私人直播链接 ${id} 更新之后读不回来`);
  return { ok: true, link: updated };
}

/** 删我的一条。删不到（不存在 / 不是自己的）返回 false ⇒ 路由回 404。 */
export function deleteUserLiveLink(id: string, userId: string): boolean {
  return (
    getDb().prepare('DELETE FROM user_live_links WHERE id = ? AND user_id = ?').run(id, userId)
      .changes > 0
  );
}
