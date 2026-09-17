/**
 * 迁移 020（`tracked_creators` / `tracked_videos`）的**结构契约**。
 *
 * ===========================================================================
 * ⚠️ 这个文件住在 `services/api` 下，是因为本仓的测试运行器只在这个工作区里
 *    （`packages/shared` 只有 typecheck）—— 与 `live-shares-schema.test.ts` 同一个理由。
 * ===========================================================================
 *
 * ===========================================================================
 * ★★ 两条唯一约束与那两个 `ON DELETE` 一律**用行为验，不读 SQL 文本**
 * ===========================================================================
 * 读一遍建表语句只证明"文件里写了那几行"，不证明"写进去的行真的过不去"：
 * 约束打错一个词（`UNIQUE` 漏了、`CASCADE` 写成 `NO ACTION`）在文本上仍然
 * 看着像对的。⇒ 每个约束都配一对用例：「插进去试试 / 删一次看看」，
 * 而且**都带反面控制**（同一个 id 换个平台插得进去、别人的视频一条没少）。
 * 没有反面控制的话，"整张表插不进任何东西"也能让 `assert.throws` 绿。
 *
 * ===========================================================================
 * `it` 名字里那个 ①②③④⑤ 对应任务清单点名的五条断言
 * ===========================================================================
 * ⑥⑦⑧ 是清单之外补的，三条都在 spec 里写着，只是清单没点名：
 *   · ⑥ `tracked_creators` 的 `UNIQUE (platform, external_id)` —— spec §9.1 断言 7
 *     （"同一个博主加两次 ⇒ 数据库拒绝"），而任务清单只点了 `tracked_videos` 那一条；
 *   · ⑦ 值域 CHECK —— spec §4.1 / §4.2 明文要求"全部 `CHECK`"照抄；
 *   · ⑧ `added_by` 的 `ON DELETE SET NULL` —— 它与 `tracked_videos` 那个 `CASCADE`
 *     是**相反**的两种处置（一个"跟着走"、一个"只把出处擦掉"），最容易一起写错：
 *     两处都写成 `CASCADE` 的话，"删一个账号"会顺手删掉他加进来的博主。
 *
 * ★ ⑤（清单点名的 `foreign_key_check`）拆成了三条：那一条在**本文件的夹具里恒定成立**
 *   （外键开着 + 每行的 creator_id 都是真行 ⇒ 库里不可能有悬空行），所以它旁边补了
 *   `PRAGMA foreign_keys` = 1 与"不存在的 creator_id 必须被拒"两条**能红**的邻位 ——
 *   详见那一节自己的注释。同理，每条"期望数据库报错"的用例都钉着**哪一种**错误
 *   （`/UNIQUE constraint failed/`，不是原来那个连 `NOT NULL constraint failed` 与
 *   `FOREIGN KEY constraint failed` 一起收的 `/UNIQUE|constraint/i`）：放宽成正则里
 *   通配的 `constraint`，夹具坏掉时这些用例会因为**别的原因**变绿。
 *
 * ===========================================================================
 * ⚠️ 这个文件也是**迁移能应用**的证据
 * ===========================================================================
 * 每个测试进程都用 `DB_PATH=':memory:'` 建一个**全新**的库，001…021 确实从头跑了一遍 ——
 * ⚠️ 但只在**进程内第一次** `getDb()` 时跑：`getDb()` 把连接缓存在模块级变量里
 * （`db/index.ts:23` 的 `instance`、`:30` 的提前返回、`:52` 的赋值），之后每条用例
 * 拿到的都是**同一个连接**，迁移不会再跑一遍。
 * （上一版这里写的是"每次 `getDb()` 都把 001…020 从头跑一遍"，那是假的：它把"每个进程
 *   一个新库"错读成了"每次调用都重建库"。真要是每次重建，上面那段"故意不清表"的理由
 *   也就不成立了 —— 每条用例刚插的行会立刻消失。）
 * ⚠️ 本仓规矩是**不在本机建磁盘库**（数据库只存在于服务器上；
 * `services/api/data/` 下曾经误提交过一个 `mcsr.db`）。
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

// ⚠️ 必须在**任何** getDb() 之前设置：下面的 import 是动态的，就是为了让这一行先跑。
process.env.DB_PATH = ':memory:';

const { closeDb, getDb } = await import('./db');

after(() => closeDb());

/** 所有用例共用的"现在"。**秒**，与两张表里那几个时间列的语义一致。 */
const NOW = 1_788_600_000;

/*
 * ⚠️ 这里**故意没有** `beforeEach` 清表。
 *
 * 本文件的每一行数据都是**按自增序号造出来的**（`tc-N` / `tv-N` / `mid-N` / `BV-tv-N`），
 * 所以用例之间本来就不会撞主键、也不会撞那两个 `UNIQUE`；而每一条计数断言都是
 * **按 `creator_id` 收窄**的（见 `videosOf`），所以别的用例留下的行不影响它。
 *
 * ⇒ 没有清理这一步的收益是实打实的：**表还没建出来时**（迁移 020 的那个 RED），
 *   清理语句会是第一个抛错的地方 ⇒ 十二条用例**全都**红在"no such table"上，
 *   而那正是"红得没有信息量"的形状：看上去像整套夹具坏了，而每条断言
 *   自己说不上话。没有清理，每一条就各红各的那一句。
 *   （`live-shares.test.ts` 有清理，是因为那一半要在**同一个用户名下**反复数额度。）
 */

// ---------------------------------------------------------------------------
// 夹具：绕过数据层直接写库
// ---------------------------------------------------------------------------
// ⚠️ 这一层**还没有数据层**（`tracked-videos.ts` 是后面任务的事），而且
//    "约束在不在"只能在 SQL 这一层问 —— 数据层自己写不出越界的行。
//    所以下面这几个 `insert*` 一律直接拼 INSERT，参数故意放宽成 `string` / `number`。

/** `PRAGMA table_info` 里一行（只留这一节要比的四格）。 */
interface ColumnSpec {
  name: string;
  type: string;
  /** 1 = NOT NULL。`PRAGMA` 报出来的就是数字 0/1。 */
  notnull: number;
  /** 默认值的**原文**（`DEFAULT ''` 报出来就是两个单引号）。`null` = 这一列没有默认值。 */
  dfltValue: string | null;
}

/** 某张表的列定义 —— 顺序也一起比（改列顺序会让 `INSERT ... VALUES` 那种写法错位）。 */
function columnsOf(table: 'tracked_creators' | 'tracked_videos'): ColumnSpec[] {
  const rows = getDb().prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
  }>;
  return rows.map((r) => ({
    name: r.name,
    type: r.type,
    notnull: r.notnull,
    dfltValue: r.dflt_value,
  }));
}

/** 库里所有表与索引的名字（`sqlite_master`）。 */
function schemaNames(): Set<string> {
  const rows = getDb()
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index')")
    .all() as unknown as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

interface RawCreator {
  id?: string;
  /** ⚠️ 故意是 `string` 而不是联合类型：值域的用例要塞一个非法值进去。 */
  platform?: string;
  externalId?: string;
  handle?: string;
  displayName?: string;
  backfillDone?: number;
  enabled?: number;
  addedBy?: string | null;
}

let creatorSeq = 0;

/** 插一行博主，返回它的 id。 */
function insertCreator(input: RawCreator = {}): string {
  creatorSeq += 1;
  const id = input.id ?? `tc-${String(creatorSeq)}`;
  getDb()
    .prepare(
      `INSERT INTO tracked_creators
         (id, platform, external_id, handle, display_name, added_by,
          backfill_done, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.platform ?? 'bilibili',
      input.externalId ?? `mid-${String(creatorSeq)}`,
      input.handle ?? '',
      input.displayName ?? `博主 ${id}`,
      input.addedBy ?? null,
      input.backfillDone ?? 0,
      input.enabled ?? 1,
      NOW,
      NOW,
    );
  return id;
}

interface RawVideo {
  id?: string;
  creatorId: string;
  platform?: string;
  externalId?: string;
  title?: string;
  publishedAt?: number | null;
  durationSec?: number | null;
  isLiveReplay?: number;
  status?: string;
}

let videoSeq = 0;

/** 插一行视频，返回它的 id。⚠️ `id` 默认**每次都不一样** —— 撞主键会盖住要验的那条约束。 */
function insertVideo(input: RawVideo): string {
  videoSeq += 1;
  const id = input.id ?? `tv-${String(videoSeq)}`;
  getDb()
    .prepare(
      `INSERT INTO tracked_videos
         (id, creator_id, platform, external_id, title,
          published_at, duration_sec, is_live_replay, status, first_seen_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.creatorId,
      input.platform ?? 'bilibili',
      input.externalId ?? `BV-${id}`,
      input.title ?? `视频 ${id}`,
      input.publishedAt ?? null,
      input.durationSec ?? null,
      input.isLiveReplay ?? 0,
      input.status ?? 'visible',
      NOW,
      NOW,
    );
  return id;
}

let userSeq = 0;

/** 造一个用户（只写 `users` 表 —— `added_by` 上有外键，所以必须有一个真的用户）。 */
function makeUser(): string {
  userSeq += 1;
  const id = `tu-${String(userSeq)}`;
  getDb()
    .prepare(
      `INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at)
       VALUES (?, ?, '', ?, ?, ?)`,
    )
    .run(id, `${id}@example.com`, `用户 ${id}`, NOW, NOW);
  return id;
}

/** 这个博主名下的视频条数 —— ★ 级联那一条的判据就是它。 */
function videosOf(creatorId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM tracked_videos WHERE creator_id = ?')
    .get(creatorId) as { n: number };
  return row.n;
}

/**
 * 删一个博主，把结果**收下来**而不是让它抛出去。
 *
 * ⚠️ 为什么不让它抛：`ON DELETE CASCADE` 被改成 `NO ACTION` 时，这一句会
 *    **当场扔一个外键错误**。抛出去的话，测试就停在这里了 —— 红是红了，
 *    红在一个"删除本身炸了"上，而那条真正的判据（"他的视频跟着没了"）
 *    根本走不到。⇒ 收成结果，让"视频还剩几条"那条断言先说话。
 */
function deleteCreator(id: string): { ok: true } | { ok: false; error: string } {
  try {
    getDb().prepare('DELETE FROM tracked_creators WHERE id = ?').run(id);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ---------------------------------------------------------------------------
// spec §4.1 / §4.2 逐列
// ---------------------------------------------------------------------------

const CREATOR_COLUMNS: ColumnSpec[] = [
  /*
   * ⚠️ `notnull: 0` 是**对的**，别看着别扭就把它改成 1：
   *    SQLite 里 `PRIMARY KEY` **不蕴含** `NOT NULL`（官方明文说这是早期版本留下的行为，
   *    只有 `INTEGER PRIMARY KEY`、`WITHOUT ROWID` 与 `STRICT` 表例外）。
   *    ⇒ `id TEXT PRIMARY KEY` 在 `PRAGMA table_info` 里就是"可空"。
   *    这一列照 spec §4.1 **逐字**抄（`live_shares` / `users` 那些表也都是这么写的），
   *    所以这里钉的是**它实际是什么**，不是"我们希望它是什么"。
   *    （真要收紧，那就是另开一次迁移给两张表的 `id` 补 `NOT NULL` —— 不归这个任务管。）
   */
  { name: 'id', type: 'TEXT', notnull: 0, dfltValue: null },
  { name: 'platform', type: 'TEXT', notnull: 1, dfltValue: null },
  { name: 'external_id', type: 'TEXT', notnull: 1, dfltValue: null },
  // ⚠️ `DEFAULT ''`（**不是** NULL）：handle 是"给人看的可读标识"，没有就是空串。
  //    它与 nullable 的 `avatar_url` 不是一回事（spec §4.1 逐列这么定的）。
  { name: 'handle', type: 'TEXT', notnull: 1, dfltValue: "''" },
  { name: 'display_name', type: 'TEXT', notnull: 1, dfltValue: null },
  { name: 'avatar_url', type: 'TEXT', notnull: 0, dfltValue: null },
  /*
   * ★★ spec §5.5 的裁决：平台自己的小东西（YouTube 的 uploads 播放列表 ID）放这里，
   *    不放进 `handle`（那是给人看的可读标识）。⚠️ T8 的适配器要拿它存那个 ID ——
   *    这一列漏掉的话，T8 就得再开一次迁移。
   */
  { name: 'platform_meta', type: 'TEXT', notnull: 0, dfltValue: null },
  { name: 'backfill_done', type: 'INTEGER', notnull: 1, dfltValue: '0' },
  { name: 'last_cursor', type: 'TEXT', notnull: 0, dfltValue: null },
  { name: 'last_synced_at', type: 'INTEGER', notnull: 0, dfltValue: null },
  { name: 'last_error', type: 'TEXT', notnull: 0, dfltValue: null },
  { name: 'consecutive_failures', type: 'INTEGER', notnull: 1, dfltValue: '0' },
  { name: 'enabled', type: 'INTEGER', notnull: 1, dfltValue: '1' },
  { name: 'added_by', type: 'TEXT', notnull: 0, dfltValue: null },
  { name: 'created_at', type: 'INTEGER', notnull: 1, dfltValue: null },
  { name: 'updated_at', type: 'INTEGER', notnull: 1, dfltValue: null },
  /*
   * ★ 这一列是**迁移 022** 加的（连续失败 3 次 ⇒ 冷却 3600 秒，`docs/pending.md` §5.98）。
   *   `ALTER TABLE … ADD COLUMN` 一律追加到末尾，所以它排在 `updated_at` **后面**
   *   （020 声明的列序一个都没动 —— 那张表没有被重建）。
   * ⚠️ 这一条 deepEqual 是**整表**比对，022 落地时它必须跟着长 —— 否则红的会是
   *   "这张表与 020 不一致"这个**假象**，而真正的原因只是"表按预期长大了"（021 那一轮
   *   为同一件事写过同一段话）。
   * ⚠️ 可空、没有默认值：`NULL` 就是"不在冷却中"这个状态本身，理由见本文件末尾
   *   「迁移 022」那一组与 `packages/shared/src/tracking.ts` 里那一格。
   */
  { name: 'cooldown_until', type: 'INTEGER', notnull: 0, dfltValue: null },
];

const VIDEO_COLUMNS: ColumnSpec[] = [
  // ⚠️ `id` 的 `notnull: 0` 与 `tracked_creators` 那边同一条理由（见上面那段注释）
  { name: 'id', type: 'TEXT', notnull: 0, dfltValue: null },
  { name: 'creator_id', type: 'TEXT', notnull: 1, dfltValue: null },
  { name: 'platform', type: 'TEXT', notnull: 1, dfltValue: null },
  { name: 'external_id', type: 'TEXT', notnull: 1, dfltValue: null },
  { name: 'title', type: 'TEXT', notnull: 1, dfltValue: null },
  // ⚠️ 下面六列**一个默认值都没有**：拿不到就是 NULL，见下面那条专门的断言。
  { name: 'thumbnail_url', type: 'TEXT', notnull: 0, dfltValue: null },
  { name: 'published_at', type: 'INTEGER', notnull: 0, dfltValue: null },
  { name: 'duration_sec', type: 'INTEGER', notnull: 0, dfltValue: null },
  { name: 'view_count', type: 'INTEGER', notnull: 0, dfltValue: null },
  { name: 'comment_count', type: 'INTEGER', notnull: 0, dfltValue: null },
  { name: 'is_live_replay', type: 'INTEGER', notnull: 1, dfltValue: '0' },
  { name: 'tags', type: 'TEXT', notnull: 0, dfltValue: null },
  { name: 'status', type: 'TEXT', notnull: 1, dfltValue: "'visible'" },
  { name: 'first_seen_at', type: 'INTEGER', notnull: 1, dfltValue: null },
  { name: 'updated_at', type: 'INTEGER', notnull: 1, dfltValue: null },
  /*
   * ★ 下面三列是**迁移 021** 加的。`ALTER TABLE … ADD COLUMN` 一律追加到末尾，
   *   所以这张表的形状从 020 的 15 列变成 18 列。
   * ⚠️ 这一条 deepEqual 是**整表**比对，021 落地时它必须跟着长 —— 否则红的会是
   *    "这张表与 020 不一致"这个**假象**，而真正的原因只是"表按预期长大了"。
   * ⚠️ 三列都可空、都没有默认值（`NULL` = 没查过 / 没隐藏过），理由见本文件末尾
   *    「迁移 021：可见性三列」那一组。
   */
  { name: 'verify_checked_at', type: 'INTEGER', notnull: 0, dfltValue: null },
  { name: 'hidden_at', type: 'INTEGER', notnull: 0, dfltValue: null },
  { name: 'hidden_reason', type: 'TEXT', notnull: 0, dfltValue: null },
];

// ---------------------------------------------------------------------------
// ① ② 结构
// ---------------------------------------------------------------------------

describe('迁移 020：两张表真的建出来了', () => {
  it('① `_migrations` 里记着 020_tracked_videos', () => {
    // ⚠️ 这一条守的是**注册**：迁移文件写得再对，没进 `migrate.ts` 的 MIGRATIONS
    //    就一行都不会跑 —— 而那时的表现是"所有用例都报表不存在"，
    //    读起来像建表语句写错了，跟"忘了注册"完全是两件事。
    const rows = getDb().prepare('SELECT name FROM _migrations').all() as unknown as Array<{
      name: string;
    }>;
    const names = rows.map((r) => r.name);

    assert.ok(
      names.includes('020_tracked_videos'),
      `_migrations 里没有 020_tracked_videos —— 迁移文件建了但没注册进 migrate.ts？实际有：${names.join(', ')}`,
    );
    // 前一条也得还在：它是"这一条是 020 而不是别的编号"的锚点
    assert.ok(names.includes('019_live_shares'), '019 必须还在（020 是它后面那一条）');
  });

  it('② tracked_creators 逐列与 spec §4.1 一致（含 platform_meta）', () => {
    assert.deepEqual(columnsOf('tracked_creators'), CREATOR_COLUMNS);
  });

  it('② tracked_videos 逐列与 spec §4.2 一致', () => {
    assert.deepEqual(columnsOf('tracked_videos'), VIDEO_COLUMNS);
  });

  it('② ★ 拿不到就 NULL：五个测量列可空、且一个默认值都没有', () => {
    /*
     * spec §4.2 的第二条理由，也是本仓既有纪律（`SeedRecord` 那条注释：
     * "null 是真实存在的…不能显示成 0，1970 年 1 月 1 日看起来像一条真实数据"）。
     * ⚠️ 这一条比上面那个整表 deepEqual 啰嗦，但**失败消息说了为什么** ——
     *    整表比对的输出是一大段 diff，读的人看不出"填 0 就是撒谎"这件事。
     */
    const byName = new Map(columnsOf('tracked_videos').map((c) => [c.name, c]));

    for (const name of [
      'published_at',
      'duration_sec',
      'view_count',
      'comment_count',
      'thumbnail_url',
    ]) {
      const col = byName.get(name);
      assert.ok(col, `列 ${name} 必须在 tracked_videos 上`);
      assert.equal(col.notnull, 0, `${name} 必须可空（拿不到时是 NULL，不是 0）`);
      assert.equal(
        col.dfltValue,
        null,
        `★ ${name} 不许有默认值 —— 补一个 0 上去，界面上就成了一次"真实的读数"`,
      );
    }

    // 反面控制：该有默认值的列**必须**有 —— 否则上面那一条在"整张表都没默认值"时也会绿
    assert.equal(byName.get('status')?.dfltValue, "'visible'", 'status 的默认值必须留着');
    assert.equal(byName.get('is_live_replay')?.dfltValue, '0');
  });

  it('② ★ 行为验：那几格不填 ⇒ 读回来是 NULL，不是 0 也不是空串', () => {
    /*
     * 上一条读的是 `PRAGMA` 的**元数据**（"这一列没有默认值"），这一条读的是**行本身**：
     * 少写的那几格到底落成了什么。两条合起来才是"拿不到就是 NULL"的完整证据 ——
     * 只有元数据的话，"值从别处补进来"（触发器、或将来数据层里一个手滑的 `?? 0`）
     * 在这一层是看不见的，而那正是这条纪律要防的东西。
     * ⚠️ 与 ③④ 一样，判据是**行为**，不是读建表语句。
     */
    const creator = insertCreator();
    const id = insertVideo({ creatorId: creator, externalId: 'BV-no-measurements' });

    const row = getDb()
      .prepare(
        `SELECT published_at, duration_sec, view_count, comment_count, thumbnail_url, tags
           FROM tracked_videos WHERE id = ?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    assert.ok(row, '前提：这一行插进去了');

    for (const col of [
      'published_at',
      'duration_sec',
      'view_count',
      'comment_count',
      'thumbnail_url',
      'tags',
    ]) {
      assert.equal(
        row[col],
        null,
        `★ ${col} 读回来必须是 NULL —— 0 会被当成一次真实的读数（spec §4.2）`,
      );
    }
  });

  it('② 两个索引都在库里', () => {
    /*
     * ⚠️ 名字打错的索引**照样建得出来、照样不报错**，只是不管用 ——
     *    所以"索引在不在"必须点名断言，不能靠后面那些查询用例顺带发现。
     *    （手法照 `live-shares.test.ts` 的第一条。）
     */
    const names = schemaNames();
    assert.ok(names.has('tracked_creators'), '表 tracked_creators 必须在库里');
    assert.ok(names.has('tracked_videos'), '表 tracked_videos 必须在库里');
    for (const index of ['idx_tracked_videos_recent', 'idx_tracked_videos_creator']) {
      assert.ok(names.has(index), `索引 ${index} 必须在库里`);
    }
  });
});

// ---------------------------------------------------------------------------
// ③ ★★ 幂等全靠它
// ---------------------------------------------------------------------------

describe('tracked_videos：UNIQUE (platform, external_id)', () => {
  it('③ 同一对插两次 ⇒ 数据库当场拒绝', () => {
    const creator = insertCreator();
    insertVideo({ creatorId: creator, id: 'tv-dup-1', externalId: 'BV1wHtm6rEK3' });

    // ⚠️ 正则钉的是**哪一种**失败，不是"反正报了个 constraint 错"：
    //    原来的 `/UNIQUE|constraint/i` 连 `NOT NULL constraint failed` 与
    //    `FOREIGN KEY constraint failed` 一起收 —— 夹具一旦坏掉（少给一列、creator_id 写错），
    //    这两条唯一约束就会**因为别的原因**变绿。`node:sqlite` 的原话就是
    //    `UNIQUE constraint failed: tracked_videos.platform, tracked_videos.external_id`。
    assert.throws(
      () => insertVideo({ creatorId: creator, id: 'tv-dup-2', externalId: 'BV1wHtm6rEK3' }),
      /UNIQUE constraint failed/,
      '★ 翻页会重复看到同一批视频 ⇒ 没有这条约束，每次增量都会插重复行',
    );
  });

  it('③ ★ 反面控制：约束在 (platform, external_id) 这一对上，不是只在 external_id 上', () => {
    const creator = insertCreator();
    insertVideo({
      creatorId: creator,
      id: 'tv-ctl-1',
      externalId: 'SHARED-ID',
      platform: 'bilibili',
    });

    /*
     * 同一个字符串在另一个平台上是**另一条视频**（三个平台的 id 空间互不相干）。
     * ⚠️ 这一条挡的是"把约束写成 `UNIQUE (external_id)`"那种过度收紧 ——
     *    它会让第二个平台的第一条视频永远插不进去，而错的表现是"某几个平台的视频
     *    一条都进不来"，看起来像适配器坏了。
     */
    assert.doesNotThrow(() =>
      insertVideo({
        creatorId: creator,
        id: 'tv-ctl-2',
        externalId: 'SHARED-ID',
        platform: 'youtube',
      }),
    );
  });
});

describe('tracked_creators：UNIQUE (platform, external_id)', () => {
  it('⑥ 同一个博主加两次 ⇒ 数据库拒绝（spec §9.1 断言 7）', () => {
    /*
     * ⚠️ 任务清单的断言列表里只点了 `tracked_videos` 那一条，但 spec §4.1 明文
     *    有这个 `UNIQUE`，理由也是同一句话："让『同一个博主被加两次』在**数据库**
     *    这一层就失败，而不是靠界面判断"（本仓 `live_channels` 是同一手法）。
     */
    insertCreator({ platform: 'twitch', externalId: '44322889' });

    assert.throws(
      () => insertCreator({ platform: 'twitch', externalId: '44322889' }),
      /UNIQUE constraint failed/,
      '★ 同一个博主加两次必须由数据库拒绝',
    );

    // 反面控制：同一个人在另一个平台上是另一个人（平台是键的一半）
    assert.doesNotThrow(() => insertCreator({ platform: 'youtube', externalId: '44322889' }));
  });
});

// ---------------------------------------------------------------------------
// ④ ★★ 级联
// ---------------------------------------------------------------------------

describe('tracked_videos.creator_id：ON DELETE CASCADE', () => {
  it('④ 删掉一个 creator ⇒ 他的视频跟着没了（行为验，整个动作在事务里）', () => {
    const doomed = insertCreator({ externalId: 'mid-doomed' });
    const kept = insertCreator({ externalId: 'mid-kept' });
    insertVideo({ creatorId: doomed, externalId: 'BV-doomed-1' });
    insertVideo({ creatorId: doomed, externalId: 'BV-doomed-2' });
    insertVideo({ creatorId: kept, externalId: 'BV-kept-1' });
    assert.equal(videosOf(doomed), 2, '前提：这个博主名下有两条');

    /*
     * ⚠️ 包在事务里（spec 与任务清单都点名"回滚事务"）：这一条验的是**外键的处置**，
     *    不是"删除这个动作"本身 —— 演练完必须把库恢复到原样，别让后面的用例
     *    在一个少了一个博主的库上跑。
     * ⚠️ 删除的结果由 `deleteCreator` 收下来（见它自己的注释）：写成 `CASCADE` →
     *    `NO ACTION` 时它扔的是外键错误，抛出去测试就停在那里，
     *    下面那条真正的判据根本走不到。
     */
    getDb().exec('BEGIN');
    try {
      const outcome = deleteCreator(doomed);

      assert.equal(
        videosOf(doomed),
        0,
        `★★ ON DELETE CASCADE：博主删了，他的视频必须跟着走（删除本身的结果：${JSON.stringify(outcome)}）`,
      );
      assert.equal(videosOf(kept), 1, '★ 别人的视频一条都不能少（级联不是"清空整张表"）');
      assert.deepEqual(
        outcome,
        { ok: true },
        '★ 而且删除本身必须成功 —— 写成 NO ACTION 的话它在这里就扔外键错误了',
      );
    } finally {
      getDb().exec('ROLLBACK');
    }

    assert.equal(videosOf(doomed), 2, '★ 回滚之后原样回来：这一条验的是外键，不改库');
    assert.equal(videosOf(kept), 1);
  });

  it('⑧ added_by 相反：删掉那个人，名单行留下、只是把出处擦掉（SET NULL）', () => {
    const user = makeUser();
    const creator = insertCreator({ addedBy: user });

    /*
     * ⚠️ 这两个 `ON DELETE` 是**相反**的两种处置，放在一起看：
     *      · 视频是博主的内容 ⇒ 博主没了，内容跟着走（CASCADE）；
     *      · `added_by` 只是"谁加进来的"这条出处 ⇒ 人没了，名单行还在，出处置 NULL。
     *    两处都写成 CASCADE 的话，"删一个账号"会**顺手删掉他加进来的博主**
     *    （连带那个博主的全部视频）—— 一次账号清理就静默丢一整份名单。
     */
    assert.doesNotThrow(() => {
      getDb().prepare('DELETE FROM users WHERE id = ?').run(user);
    }, '前提：删这个用户本身必须成功');

    const row = getDb()
      .prepare('SELECT added_by FROM tracked_creators WHERE id = ?')
      .get(creator) as { added_by: string | null } | undefined;

    assert.ok(row, '★ 名单行必须还在 —— 写成 CASCADE 的话它跟着账号一起没了');
    assert.equal(row.added_by, null, '★ 出处必须被置成 NULL（SET NULL）');
  });
});

// ---------------------------------------------------------------------------
// ⑦ 值域
// ---------------------------------------------------------------------------

describe('值域 CHECK（把不可能的状态变成插不进去的行）', () => {
  it('⑦ platform / 两个 0-1 开关 / status 都只收合法值', () => {
    /*
     * spec §4.1 / §4.2 的 `CHECK` 只说了一件事：**这张表里不可能存在越界的行**。
     * 它同时是数据层（与 `packages/shared/src/tracking.ts` 那三个联合类型）
     * 敢把这几列当成枚举的信心的来源 —— 手法与 019 那四条 CHECK 相同。
     *
     * ⚠️ 下面每一处正则都必须是 `/CHECK constraint failed/`，不能退回 `/CHECK|constraint/i`
     *    （原来就是那个）：后者连 `NOT NULL constraint failed` 与 `FOREIGN KEY constraint failed`
     *    一起收，而这两种失败**说明夹具坏了**（少给一列、或 creator_id 指向了不存在的行）。
     *    坏掉的夹具会让这一整块**因为别的原因**变绿，那比红还糟 —— 见文件头那条铁律。
     */
    const creator = insertCreator();

    // platform 的值域，两张表各一处
    assert.throws(
      () => insertCreator({ platform: 'niconico' }),
      /CHECK constraint failed/,
      'tracked_creators.platform 只收 bilibili/youtube/twitch',
    );
    assert.throws(
      () => insertVideo({ creatorId: creator, platform: 'niconico' }),
      /CHECK constraint failed/,
      'tracked_videos.platform 只收 bilibili/youtube/twitch',
    );

    // 两个 0/1 开关（`backfill_done` / `enabled`）
    assert.throws(
      () => insertCreator({ backfillDone: 2 }),
      /CHECK constraint failed/,
      'backfill_done',
    );
    assert.throws(() => insertCreator({ enabled: 2 }), /CHECK constraint failed/, 'enabled');
    assert.throws(
      () => insertVideo({ creatorId: creator, isLiveReplay: 2 }),
      /CHECK constraint failed/,
      'is_live_replay',
    );

    // status 的值域 + 正面控制（另一半必须真的插得进去）
    assert.throws(
      () => insertVideo({ creatorId: creator, status: 'deleted' }),
      /CHECK constraint failed/,
      'status 只收 visible/hidden',
    );
    assert.doesNotThrow(() => insertVideo({ creatorId: creator, status: 'hidden' }));
  });
});

// ---------------------------------------------------------------------------
// ⑤ 外键自检
// ---------------------------------------------------------------------------

describe('外键自检', () => {
  it('⑤ `PRAGMA foreign_keys` 必须是 1（下面两条的前提）', () => {
    /*
     * ⚠️ 先验这一条，因为**外键其余的一切都建立在它上面**：`PRAGMA foreign_keys` 的默认值
     *    是**关**，本仓是在建连接时显式打开的（`db/index.ts:44-45`，那里的注释写的就是
     *    "写了 REFERENCES 也不生效"）。关着的时候 `REFERENCES` 形同虚设 —— 悬空引用照插，
     *    `foreign_key_check` 也照样回 0 行（它没什么可查的）。
     *    ⇒ 少了这一条，下面那条"拒插"与"0 行"都可能只是"约束根本没开"造成的假绿。
     */
    const row = getDb().prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    assert.equal(row.foreign_keys, 1, '★★ 外键强制必须开着：关着的时候 REFERENCES 等于没写');
  });

  it('⑤ ★★ 不存在的 creator_id 必须被数据库拒绝（这一条才钉得住 REFERENCES）', () => {
    /*
     * ⚠️ 这一条是本轮补的"能红"的邻位。原来这一节只有下面那条 `foreign_key_check`，
     *    而它在**这个夹具里恒定成立**：外键是开的、每行的 creator_id 都是刚插进去的真行
     *    ⇒ 库里不可能有悬空行，于是把 `REFERENCES tracked_creators (id)` 整段删掉，
     *    它**照样绿**（只是没东西可查了）。"空集里没有反例"不是一条约束的证据。
     * ⇒ 真正的判据是**插一个不存在的 creator_id 试一试**：那个子句一旦不在，这一行会被
     *    静默写进库，变成 `content_contributors` 那种孤儿行（迁移 020 文件头第三节写了
     *    这类行的代价：它不报错，只在别处表现成奇怪的结果）。
     */
    assert.throws(
      () => insertVideo({ creatorId: 'tc-does-not-exist', externalId: 'BV-fk-orphan' }),
      /FOREIGN KEY constraint failed/,
      '★★ 指向不存在博主的视频行必须插不进去（没有 REFERENCES 的话它会静默入库）',
    );
  });

  it('⑤ PRAGMA foreign_key_check 回 0 行', () => {
    // 先真的写几条进去：空库上跑 foreign_key_check 永远是 0 行，什么也证明不了。
    // ⚠️ 但"写了几条进去"也**不足以**让它变得可证伪（理由见上面那条）：这一条是任务清单
    //    点名要的，留着当库的卫生检查；钉住外键的是上面那条"拒插"。
    const creator = insertCreator();
    insertVideo({ creatorId: creator, externalId: 'BV-fk-1' });
    insertVideo({ creatorId: creator, externalId: 'BV-fk-2' });

    const rows = getDb().prepare('PRAGMA foreign_key_check').all();
    assert.deepEqual(rows, [], `foreign_key_check 报出了悬空的行：${JSON.stringify(rows)}`);
  });
});

describe('★ 迁移 021：可见性三列（spec §3）', () => {
  it('★ 三列都在，类型对，而且可为 NULL', () => {
    const cols = getDb().prepare('PRAGMA table_info(tracked_videos)').all() as Array<{
      name: string;
      type: string;
      notnull: number;
    }>;
    const byName = new Map(cols.map((c) => [c.name, c]));
    for (const name of ['verify_checked_at', 'hidden_at', 'hidden_reason']) {
      const col = byName.get(name);
      assert.ok(
        col,
        `tracked_videos 少了 ${name} 这一列 —— 迁移 021 没跑（先看 migrate.ts 登记了没有）`,
      );
      assert.equal(col.notnull, 0, `${name} 必须是可空的：NULL 才表示"没查过 / 没隐藏过"`);
    }
    assert.equal(byName.get('verify_checked_at')?.type, 'INTEGER');
    assert.equal(byName.get('hidden_at')?.type, 'INTEGER');
    assert.equal(byName.get('hidden_reason')?.type, 'TEXT');
  });

  it('★ 021 在迁移登记表里（没登记 = 永远不跑）', () => {
    const applied = getDb()
      .prepare("SELECT name FROM _migrations WHERE name = '021_tracked_video_visibility'")
      .all();
    assert.equal(applied.length, 1);
  });
});

describe('★ 迁移 022：冷却死线（`docs/pending.md` §5.98 的处置）', () => {
  it('★ 这一列在、类型对、而且可为 NULL', () => {
    /*
     * ⚠️ 三条判据缺一不可，而每一条错了都不会抛：
     *   · **不在** ⇒ `recordFailure` 那句 UPDATE 会抛 "no such column"
     *     （这一条算是幸运的，会红在别处）；
     *   · 类型不是 INTEGER ⇒ SQLite 的动态类型会照样把它存下来，而
     *     `cooldown_until <= now` 的比较在**文本**上是字典序 —— 表现是
     *     "冷却窗口在一部分时间上生效、在另一部分上不生效"，没有报错；
     *   · **不许 NOT NULL**：`NULL` 是"不在冷却中"这个状态本身。给了默认值
     *     （比如 0）才是真麻烦：每一行**天生**带着一个 1970 年的死线，
     *     而"有没有在冷却"这件事从此分不出来（`toCreator` 那一格写着这件事）。
     */
    const cols = getDb().prepare('PRAGMA table_info(tracked_creators)').all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    const byName = new Map(cols.map((c) => [c.name, c]));
    const col = byName.get('cooldown_until');
    assert.ok(
      col,
      'tracked_creators 少了 cooldown_until 这一列 —— 迁移 022 没跑（先看 migrate.ts 登记了没有）',
    );
    assert.equal(
      col.type,
      'INTEGER',
      '它是 Unix **秒**，与 last_synced_at / published_at 同一单位',
    );
    assert.equal(col.notnull, 0, '必须可空：NULL 才是"不在冷却中"');
    assert.equal(
      col.dflt_value,
      null,
      '★ 不许有默认值 —— 一行天生的 1970 死线等于"这一列永远有值"',
    );
  });

  it('★ 022 在迁移登记表里（没登记 = 永远不跑）', () => {
    const applied = getDb()
      .prepare("SELECT name FROM _migrations WHERE name = '022_tracked_creator_cooldown'")
      .all();
    assert.equal(applied.length, 1);
  });
});
