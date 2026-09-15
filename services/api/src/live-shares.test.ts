/**
 * 实时分享（`live_shares`）的**数据层**行为。
 *
 * ===========================================================================
 * ★★ 它守的是三件最容易被"优化"掉的事
 * ===========================================================================
 * ① **到点是一个查询条件，不是一次状态变更**（spec §4.1）。
 *    ⇒ 有一条用例直接插一行 `expires_at` 已经过去的行，然后只读一次：
 *      **既不调回收函数，也不 mock 时间**。过期必须不依赖任何后台任务 ——
 *      否则"任务没跑/跑挂"就变成"过期内容还挂在看板上，而界面一切正常"。
 *
 * ② **room 的"一人一条"由数据库强制**（spec §3.3）。
 *    ⇒ 有一条用例**绕过数据层的替换逻辑**硬插第二条 active，要求数据库当场报错。
 *      它同时是 spec §11.3 那条 mutation（删掉 `idx_live_shares_room_one`）的靶子：
 *      索引不在了，这一条必须变红。
 *
 * ③ **两种限额的口径刻意不同**（spec §3.4 与 §5.1 是一件事的两半）：
 *    发布 room 时"先把我自己的 active 行置 `replaced`"**不看过期**
 *    （部分唯一索引的谓词不看过期，挡住的正是那几行），
 *    而额度计数**看过期**（一条已经不在看板上的行凭什么占额度）。
 *    ⇒ 两条 ★ 用例各钉一半，谁把它们"统一"掉都会红。
 *
 * ===========================================================================
 * ⚠️ 这个文件同时是**迁移 019 的证据**
 * ===========================================================================
 * 每个测试进程都用 `DB_PATH=':memory:'` 建一个**全新**的库，也就是每次
 * `getDb()` 都把 001…019 从头跑一遍。⇒ "019 能跑过"这件事的证据就是这一整套
 * 用例（第一组还专门断言了那张表与四个索引真的建出来了）。
 * ⚠️ 本仓的规矩是**不在本机建磁盘库**（数据库只存在于服务器上；`services/api/data/`
 *    下曾经误提交过一个 `mcsr.db`）—— 对生产数据副本的演练在部署前单独做。
 *
 * ===========================================================================
 * 本文件的夹具
 * ===========================================================================
 * 计划点名的三个（`insertRawShare` / `statusOf` / `countRows`）是"**绕过数据层直接写库**"
 * 的工具，好让三类用例写得出来："造一条已经到点的行"、"造一条坏行"、"证明那个索引真的在"。
 * 数据层自己**造不出**这些行（它不会写出已过期的行，也不会写出坏 payload），
 * 所以它们只能从 SQL 进去。另外几个（`makeUser` / `ok` / `hiddenAtOf` / `liveRows`）
 * 是这套用例自己的小工具，没有它们每一段都要抄一遍同样的几行。
 */
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import type { ShareKind, ShareStatus } from '@mcsr/shared';
import { SHARE_BOARD_LIMIT, SHARE_LIMITS, SHARE_RETENTION_MS } from '@mcsr/shared';

// ⚠️ 必须在**任何** getDb() 之前设置：下面的 import 是动态的，就是为了让这一行先跑。
process.env.DB_PATH = ':memory:';

const { closeDb, getDb } = await import('./db');
const {
  buildItem,
  buildListResponse,
  countLive,
  createShare,
  deleteExpiredShares,
  getShareForEdit,
  listBoard,
  listMine,
  setShareHidden,
  setShareVisible,
  summarize,
} = await import('./live-shares');

after(() => closeDb());

/** 本用例内统一的"现在"。每个用例都拿一个新的 —— 不 mock 时间，只是别让它们相差太大。 */
let now = 0;
/** `insertRawShare` 不指定 userId 时用的那个用户（"谁发的"不是那几条用例要测的东西）。 */
let defaultUser = '';

beforeEach(() => {
  now = Date.now();
  // 只清这一张表：用户行留着不碍事（id / email 都是新造的），而 live_shares
  // 是本文件唯一会写的东西。⚠️ 顺序上必须先清子表再清父表 —— 这里只清子表，没问题。
  getDb().exec('DELETE FROM live_shares');
  defaultUser = makeUser('默认用户');
});

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

let userSeq = 0;

/**
 * 造一个用户（只写 `users` 表 —— 数据层不关心密码、登录态、邮箱验证）。
 *
 * ⚠️ 不用 `register` / 登录那一套：本文件不起 HTTP，也不需要会话。
 *    `live_shares.user_id` 上有外键（`ON DELETE CASCADE`）且 `foreign_keys=ON`，
 *    所以每一个 raw 行背后都必须有一个真的用户。
 */
function makeUser(displayName: string): string {
  userSeq += 1;
  const id = `ls-user-${String(userSeq)}`;
  getDb()
    .prepare(
      `INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at)
       VALUES (?, ?, '', ?, ?, ?)`,
    )
    .run(id, `${id}@example.com`, displayName, now, now);
  return id;
}

/** `insertRawShare` 的入参：除了 `expiresAt` 全部有默认值。 */
interface RawShare {
  id?: string;
  userId?: string;
  kind?: ShareKind;
  /** JSON 文本。默认按 `kind` 给一个**合法**的形状。 */
  payload?: string;
  note?: string;
  status?: ShareStatus;
  createdAt?: number;
  expiresAt: number;
  hiddenAt?: number | null;
}

let rawSeq = 0;

/**
 * 绕过数据层，直接插一行 —— 返回它的 id。
 *
 * ⚠️ `createdAt` 默认是"60 秒前"：迁移里那条 `CHECK (expires_at > created_at)`
 *    会把倒过来的行挡在库外，所以**要造"过期很久"的行时必须把 createdAt 一起往前推**
 *    （回收那一组用例就是这么做的）。
 * ⚠️ `status='hidden'` 时默认补一个 `hidden_at`：另一条 CHECK 要求这两件事
 *    **同时出现或同时缺席**（spec §3.1）。想造"不该存在的那一行"时就显式传 `hiddenAt`。
 */
function insertRawShare(input: RawShare): string {
  rawSeq += 1;
  const id = input.id ?? `ls-raw-${String(rawSeq)}`;
  const kind = input.kind ?? 'seed';
  const status = input.status ?? 'active';
  /*
   * ⚠️ 默认 payload **按 kind** 给成合法的形状：本函数主要用来造"库里有、界面不该有"
   *    的行（已到点 / 本该被替换掉）。默认值一旦是不合法的形状，那些用例的失败原因
   *    就会变成"payload 坏了"，而它测的其实是另一件事。
   */
  const payload = input.payload ?? (kind === 'room' ? '{"code":"RAW1"}' : '{"overworld":"1"}');
  const hiddenAt =
    input.hiddenAt === undefined ? (status === 'hidden' ? now : null) : input.hiddenAt;

  getDb()
    .prepare(
      `INSERT INTO live_shares
         (id, user_id, kind, payload, note, status, created_at, expires_at, hidden_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.userId ?? defaultUser,
      kind,
      payload,
      input.note ?? '',
      status,
      input.createdAt ?? now - 60_000,
      input.expiresAt,
      hiddenAt,
    );
  return id;
}

/**
 * 断言这次调用成功了，并把那一行拿到手。
 *
 * ⚠️ 失败消息里带上整个结果（含 `reason`）：只写一句"应当是 ok"的红，
 *    读的人还得回去读实现才知道到底哪个分支被走了。
 * ⚠️ 只用在本文件那些**前提**上（"第一条应当发得出来"）；被测行为本身仍旧直接断言
 *    （`assert.deepEqual(res, { ok: false, reason: 'at_limit' })`），不经过它。
 */
function ok<T extends { ok: true } | { ok: false }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`期望成功，实际是：${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

/** 那一行现在的 status —— **直接查库**（断言的是"库里真的变了"，不是数据层说的）。 */
function statusOf(id: string): ShareStatus {
  const row = getDb().prepare('SELECT status FROM live_shares WHERE id = ?').get(id) as
    | { status: ShareStatus }
    | undefined;
  assert.ok(row, `库里没有 id=${id} 这一行`);
  return row.status;
}

/** 那一行的 `hidden_at`（下架 / 恢复的判据之一）。 */
function hiddenAtOf(id: string): number | null {
  const row = getDb().prepare('SELECT hidden_at FROM live_shares WHERE id = ?').get(id) as
    | { hidden_at: number | null }
    | undefined;
  assert.ok(row, `库里没有 id=${id} 这一行`);
  return row.hidden_at;
}

/** 这张表里 `id = ?` 的行数 —— ★ "到点不是删除"那一条的判据就是它。 */
function countRows(table: 'live_shares', id: string): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE id = ?`).get(id) as {
    n: number;
  };
  return row.n;
}

/** 这个人在这个 kind 下**总共有几行**（不管状态、不管过没过期）。 */
function liveRows(userId: string, kind: ShareKind): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM live_shares WHERE user_id = ? AND kind = ?')
    .get(userId, kind) as { n: number };
  return row.n;
}

// ---------------------------------------------------------------------------
// 迁移 019
// ---------------------------------------------------------------------------

describe('迁移 019：表与四个索引真的建出来了', () => {
  it('★★ 每个测试库都是全新建的 ⇒ 019 每次都从头跑过（这就是"迁移能应用"的证据）', () => {
    /*
     * ⚠️ 这一条守的是**迁移本身**：其它用例都跑在同一个已经建好的库上，
     *    如果 019 忘了注册、或者某个索引名字打错了（打错名字的索引照样能建、
     *    照样不报错，只是**不管用**），那些用例报出来的是"查询结果不对"，
     *    看不出问题出在迁移上。
     */
    const rows = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index')")
      .all() as unknown as Array<{ name: string }>;
    const names = new Set(rows.map((r) => r.name));

    assert.ok(names.has('live_shares'), '019 必须把表建出来');
    for (const index of [
      'idx_live_shares_room_one',
      'idx_live_shares_board',
      'idx_live_shares_user',
      'idx_live_shares_sweep',
    ]) {
      assert.ok(names.has(index), `索引 ${index} 必须在库里`);
    }
  });

  it('★ 四条 CHECK 真的在：值域、窗口为正、hidden_at 与 hidden 同进同退', () => {
    /*
     * spec §3.1：「两条 CHECK 是刻意加的（都是『把不可能的状态变成插不进去的行』）」。
     * ⚠️ 它们只在**写库**这条路上生效，而数据层永远不会写出这些行 ——
     *    所以只能像这样从 SQL 硬插，否则"约束在不在"永远没人验过。
     */
    const user = makeUser('约束用户');

    // ① 展示窗口必须是正的
    assert.throws(
      () => insertRawShare({ userId: user, createdAt: now, expiresAt: now }),
      /CHECK|constraint/i,
      'expires_at > created_at 必须由数据库强制',
    );

    // ② kind 的值域
    assert.throws(
      () => insertRawShare({ userId: user, kind: 'nope' as ShareKind, expiresAt: now + 60_000 }),
      /CHECK|constraint/i,
    );

    // ③ 下架了却没有下架时间
    assert.throws(
      () =>
        insertRawShare({
          userId: user,
          status: 'hidden',
          hiddenAt: null,
          expiresAt: now + 60_000,
        }),
      /CHECK|constraint/i,
      '「已下架但不知道什么时候下架的」必须插不进去',
    );

    // ④ 没下架却带着下架时间（另一半）
    assert.throws(
      () =>
        insertRawShare({
          userId: user,
          status: 'active',
          hiddenAt: now,
          expiresAt: now + 60_000,
        }),
      /CHECK|constraint/i,
      '「没下架却带着下架时间」同样必须插不进去',
    );
  });
});

// ---------------------------------------------------------------------------
// ★★ 到点
// ---------------------------------------------------------------------------

describe('到点 = 查询条件，不是一次状态变更', () => {
  it('★ 直接插一条已过期的行 ⇒ 看板上没有它，库里还在', () => {
    const id = insertRawShare({
      kind: 'room',
      userId: defaultUser,
      expiresAt: now - 1,
      status: 'active',
    });

    /*
     * ⚠️ 这一条**不许调回收函数**、**不许 mock 时间** —— 它的全部意义就是
     *    "过期不依赖任何后台任务"。插一行、读一次，就这两步。
     */
    assert.equal(
      listBoard('room', now, defaultUser).some((s) => s.id === id),
      false,
    );

    assert.equal(countRows('live_shares', id), 1, '行还在 —— 到点不是删除');
    assert.equal(statusOf(id), 'active', '到点也不是一次状态变更：库里那一行一个字都没改');

    // §5.1 那条 ★ 的另一半：已经不在看板上的行**不占额度**。
    assert.equal(countLive('room', defaultUser, now), 0);
  });
});

// ---------------------------------------------------------------------------
// room：一人一条
// ---------------------------------------------------------------------------

describe('room：一人一条靠数据库', () => {
  it('发第二条 ⇒ 旧行变 replaced，看板上只有新的', () => {
    const first = ok(
      createShare({
        kind: 'room',
        userId: defaultUser,
        payload: { code: 'OLD1' },
        note: '',
        minutes: 5,
        now,
      }),
    );
    const second = ok(
      createShare({
        kind: 'room',
        userId: defaultUser,
        payload: { code: 'NEW1' },
        note: '',
        minutes: 5,
        now: now + 1000,
      }),
    );

    assert.equal(statusOf(first.share.id), 'replaced', '旧行必须被置成 replaced');
    assert.equal(statusOf(second.share.id), 'active');
    assert.deepEqual(
      listBoard('room', now + 1000, defaultUser).map((s) => s.id),
      [second.share.id],
      '看板上只剩下新的那条',
    );
    // 审计里那句"替换掉 N 条"就是从它来的（spec §6.3）—— 事后查 status='replaced'
    // 会把历史上被替换掉的行一起算进去，所以只能由这一次调用报出来。
    assert.equal(second.replaced, 1, '这一次替换掉了几条必须能报出来');

    /*
     * §4.2：被替换掉的那条**回不来**。这一格是状态机里唯一"永久"的一格
     * （到点是条件的失效，下架可逆，只有 replaced 是单向的）。
     */
    assert.deepEqual(setShareVisible(first.share.id, now + 2000, defaultUser), {
      ok: false,
      reason: 'not_hidden',
    });
    assert.equal(statusOf(first.share.id), 'replaced', '被拒之后它还是 replaced');
  });

  it('★ 上一条已过期但还没被回收时，仍然发得出新的', () => {
    /*
     * 这一条直接对应 spec §3.4：部分唯一索引的谓词是
     * `(kind='room' AND status='active')`，它**不看过期** ——
     * 所以一条 1 分钟前到点、但回收任务还没跑的行，照样占着那个名额。
     * ⇒ "先把我自己所有 active 的 room 行置 replaced"是索引能成立的**必需步骤**，
     *   不是顺手清理。把这一步改成"先查有没有、有就报错"，这一条就会红。
     */
    const old = insertRawShare({
      kind: 'room',
      userId: defaultUser,
      // ⚠️ createdAt 也要往前推：迁移里那条 CHECK 要求 expires_at > created_at
      createdAt: now - 120_000,
      expiresAt: now - 60_000,
      status: 'active',
    });

    const created = ok(
      createShare({
        kind: 'room',
        userId: defaultUser,
        payload: { code: 'NEW1' },
        note: '',
        minutes: 5,
        now,
      }),
    );

    assert.equal(
      statusOf(old),
      'replaced',
      '★ 那条已过期的行也必须是 replaced（它正是占名额的那一行）',
    );
    assert.equal(created.share.status, 'active');
    assert.deepEqual(
      listBoard('room', now, defaultUser).map((s) => s.id),
      [created.share.id],
    );
  });

  it('★ 绕过替换逻辑硬插第二条 active ⇒ 数据库报错（证明索引真的在）', () => {
    insertRawShare({ kind: 'room', userId: defaultUser, expiresAt: now + 60_000 });

    assert.throws(
      () => insertRawShare({ kind: 'room', userId: defaultUser, expiresAt: now + 60_000 }),
      /UNIQUE|constraint/i,
      '★ 这是 mutation 的靶子：把 idx_live_shares_room_one 删掉，这一条必须红',
    );

    /*
     * 反面控制：索引是**按人**的，不是按房间号的 —— 同一个码可以被两个人同时挂着
     * （spec §5.3：房间号不是去重键，现实里就是两个人抄了同一个房）。
     */
    const other = makeUser('另一个人');
    assert.doesNotThrow(() =>
      insertRawShare({ kind: 'room', userId: other, expiresAt: now + 60_000 }),
    );

    // 而**下架**之后名额就空出来了（谓词里的 status='active' 这一半）
    const mine = listMine('room', defaultUser, now);
    const active = mine.find((s) => s.status === 'active');
    assert.ok(active, '前提：我自己有一条 active 的 room');
    ok(setShareHidden(active.id, now));
    assert.doesNotThrow(() =>
      insertRawShare({ kind: 'room', userId: defaultUser, expiresAt: now + 60_000 }),
    );
  });
});

// ---------------------------------------------------------------------------
// seed：额度
// ---------------------------------------------------------------------------

describe('seed：额度在事务里数一遍', () => {
  it('第 21 条 → at_limit，而且一行都没多写', () => {
    const ids: string[] = [];
    for (let i = 0; i < SHARE_LIMITS.seed; i += 1) {
      ids.push(insertRawShare({ kind: 'seed', userId: defaultUser, expiresAt: now + 60_000 }));
    }

    const rejected = createShare({
      kind: 'seed',
      userId: defaultUser,
      payload: { overworld: '21' },
      note: '',
      minutes: 5,
      now,
    });
    assert.deepEqual(rejected, { ok: false, reason: 'at_limit', limit: SHARE_LIMITS.seed });
    assert.equal(liveRows(defaultUser, 'seed'), SHARE_LIMITS.seed, '★ 被拒之后一行都不能多写');

    /*
     * 下架一条之后又能发：额度数的是"**在展示的**"，而下架把它从展示里拿掉了。
     * ⚠️ 这与 room 那一步刻意不同（那一步**不看过期** —— 它要清掉的正是部分唯一索引
     *    挡着的那几行）。两处不一致是有意的，spec §3.4 / §5.1 各写了一半。
     */
    const first = ids[0];
    assert.ok(first, '前提：拿到了 20 条里的第一条');
    ok(setShareHidden(first, now));

    const created = ok(
      createShare({
        kind: 'seed',
        userId: defaultUser,
        payload: { overworld: '22' },
        note: '',
        minutes: 5,
        now,
      }),
    );
    assert.equal(created.share.status, 'active');
    assert.equal(liveRows(defaultUser, 'seed'), SHARE_LIMITS.seed + 1);
  });

  it('★ 已过期未回收的行不占额度', () => {
    // 20 条里放一条**已经到点**的：它有行、status 还是 active，但已经不在看板上了
    insertRawShare({ kind: 'seed', userId: defaultUser, expiresAt: now - 1, status: 'active' });
    for (let i = 1; i < SHARE_LIMITS.seed; i += 1) {
      insertRawShare({ kind: 'seed', userId: defaultUser, expiresAt: now + 60_000 });
    }

    assert.equal(
      countLive('seed', defaultUser, now),
      SHARE_LIMITS.seed - 1,
      '前提：额度只看在展示的',
    );

    const created = ok(
      createShare({
        kind: 'seed',
        userId: defaultUser,
        payload: { overworld: '99' },
        note: '',
        minutes: 5,
        now,
      }),
    );
    assert.equal(
      created.share.status,
      'active',
      '★ 已过期的那一条不占额度 ⇒ 在展示 19 条时照样发得出来',
    );
    assert.equal(countLive('seed', defaultUser, now), SHARE_LIMITS.seed);
    assert.equal(
      liveRows(defaultUser, 'seed'),
      SHARE_LIMITS.seed + 1,
      '★ 过期那一条还占着一行（回收任务才管删行），但它不占额度 —— 两件事是两个判据',
    );
  });
});

// ---------------------------------------------------------------------------
// 下架 / 恢复
// ---------------------------------------------------------------------------

describe('下架 / 恢复', () => {
  it('下架后不在看板、但在 mine 里，且 hidden_at 有值', () => {
    const created = ok(
      createShare({
        kind: 'seed',
        userId: defaultUser,
        payload: { overworld: '42' },
        note: '一句话说清这是什么局',
        minutes: 10,
        now,
      }),
    );

    const hidden = ok(setShareHidden(created.share.id, now));

    assert.equal(statusOf(created.share.id), 'hidden');
    assert.equal(hiddenAtOf(created.share.id), now, 'hidden_at 必须写上');
    assert.equal(
      listBoard('seed', now, defaultUser).some((s) => s.id === created.share.id),
      false,
    );

    const mine = listMine('seed', defaultUser, now);
    assert.deepEqual(
      mine.map((s) => s.id),
      [created.share.id],
      '★ 下架不是消失：作者必须还看得见它（否则他会再发一遍）',
    );
    assert.equal(mine[0]?.status, 'hidden');
    assert.equal(mine[0]?.mine, true);
    assert.equal(mine[0]?.note, '一句话说清这是什么局', '说明要原样带出来');
    assert.equal(hidden.share.status, 'hidden');
  });

  it('恢复后回来，hidden_at 变回 null', () => {
    const created = ok(
      createShare({
        kind: 'seed',
        userId: defaultUser,
        payload: { overworld: '7' },
        note: '',
        minutes: 5,
        now,
      }),
    );
    ok(setShareHidden(created.share.id, now));

    const restored = ok(setShareVisible(created.share.id, now, defaultUser));

    assert.equal(restored.share.status, 'active');
    assert.equal(statusOf(created.share.id), 'active');
    assert.equal(
      hiddenAtOf(created.share.id),
      null,
      'hidden_at 必须清掉（CHECK 要求它与 hidden 同进同退）',
    );
    assert.equal(
      listBoard('seed', now, defaultUser).some((s) => s.id === created.share.id),
      true,
    );
    assert.equal(listMine('seed', defaultUser, now)[0]?.status, 'active');

    // 已经在看板上的那条没什么可"恢复"的
    assert.deepEqual(setShareVisible(created.share.id, now, defaultUser), {
      ok: false,
      reason: 'not_hidden',
    });
  });

  it('★ room：下架 → 发新的 → 恢复旧的 ⇒ at_limit（**不**顶掉新的那条）', () => {
    /*
     * spec §4.3 的场景。恢复会让部分唯一索引当场报错（手上已经有一条 active 的 room），
     * 而"自动顶掉当前那条"是**你没按、但东西没了** —— 与限额满时拒绝是同一条原则。
     * 拒绝的代价是多一步，而那一步只在"下架过、又发过、又想恢复"这个组合里出现。
     */
    const first = ok(
      createShare({
        kind: 'room',
        userId: defaultUser,
        payload: { code: 'OLD1' },
        note: '',
        minutes: 5,
        now,
      }),
    );
    ok(setShareHidden(first.share.id, now));
    const second = ok(
      createShare({
        kind: 'room',
        userId: defaultUser,
        payload: { code: 'NEW1' },
        note: '',
        minutes: 5,
        now: now + 1000,
      }),
    );

    const res = setShareVisible(first.share.id, now + 2000, defaultUser);
    assert.deepEqual(res, { ok: false, reason: 'at_limit' });
    assert.equal(statusOf(second.share.id), 'active', '★ 新的那条必须原封不动');
    assert.equal(
      hiddenAtOf(second.share.id),
      null,
      '★ 而且一个字段都没被动过 —— 被拒的恢复不能顺手改写兄弟行',
    );
    assert.equal(
      statusOf(first.share.id),
      'hidden',
      '★ 旧的那条也必须是 hidden，不能被偷偷改成别的',
    );
    assert.equal(
      listBoard('room', now + 2000, defaultUser).some((s) => s.id === second.share.id),
      true,
      '恢复失败之后看板照旧',
    );
  });

  it('★ room：兄弟行**已过期**时恢复放行，并在同一个事务里把它置 replaced（spec §4.3）', () => {
    /*
     * ⚠️★ 这一条守的是一个**可达的 500** —— spec §4.3 的补记（2026-09-15）把它定死了；
     *    而上面那条 ★（兄弟行**没过期** ⇒ 仍然 at_limit）是它的另一半。
     *
     *    判据若用 `countLive`（带 `expires_at > now`），这里会认为"我一条在展示的 room 都没有"，
     *    于是放行恢复 —— 而紧接着的 UPDATE 撞上 `idx_live_shares_room_one`
     *    （它的谓词**不看过期**）⇒ SQLite 抛错 ⇒ 路由 500。
     *    界面给的正好是这个按钮：H 是 hidden、**没过期**，它就出现在 `mine` 里。
     *    ⚠️ 那条过期未回收的兄弟行最长能存在约 24 小时（回收任务只删 `expires_at < now - 24h`），
     *      而"把它清掉"的**唯一**办法就是发布或恢复时顺手置 replaced。
     *
     * ⚠️ 时间线**不靠 mock 时钟**摆出来：`now` 本来就是这一层的入参。
     *    H 挂 20 分钟，R 挂 5 分钟，恢复发生在 R 到点之后、H 到点之前。
     */
    const t0 = now;
    const h = ok(
      createShare({
        kind: 'room',
        userId: defaultUser,
        payload: { code: 'HOLD' },
        note: '',
        minutes: 20,
        now: t0,
      }),
    );
    ok(setShareHidden(h.share.id, t0 + 1000));
    const r = ok(
      createShare({
        kind: 'room',
        userId: defaultUser,
        payload: { code: 'RGONE' },
        note: '',
        minutes: 5,
        now: t0 + 60_000,
      }),
    );

    const t1 = t0 + 10 * 60_000;
    // 前提：R 已经到点（看板上没有它），但它**仍然是 active** —— 到点不是一次状态变更
    assert.equal(statusOf(r.share.id), 'active', '前提：到点什么都没做');
    assert.equal(listBoard('room', t1, defaultUser).length, 0, '前提：此刻看板是空的');
    assert.equal(countLive('room', defaultUser, t1), 0, '前提：按看板判据数，我一条都没在展示');

    const restored = ok(setShareVisible(h.share.id, t1, defaultUser));

    assert.equal(restored.share.status, 'active');
    assert.equal(statusOf(h.share.id), 'active');
    assert.equal(
      statusOf(r.share.id),
      'replaced',
      '★ 那条过期未回收的兄弟行必须在这里被置 replaced —— 否则索引挡着，恢复根本发不出去',
    );
    assert.deepEqual(
      listBoard('room', t1, defaultUser).map((s) => s.id),
      [h.share.id],
      '恢复之后看板上是 H，而且只有它',
    );
    assert.deepEqual(
      listMine('room', defaultUser, t1).map((s) => s.id),
      [h.share.id],
      '被顶掉的那条不再出现在 mine 里（replaced 是回不来的那一格）',
    );
  });

  it('不存在的 id：两个 setter 都回 not_found（而不是静默成功）', () => {
    assert.deepEqual(setShareHidden('ls-no-such-row', now), { ok: false, reason: 'not_found' });
    assert.deepEqual(setShareVisible('ls-no-such-row', now, defaultUser), {
      ok: false,
      reason: 'not_found',
    });
  });

  it('到点后恢复 → invalid_state/expired', () => {
    const id = insertRawShare({
      kind: 'seed',
      userId: defaultUser,
      status: 'hidden',
      expiresAt: now - 1,
    });

    assert.deepEqual(setShareVisible(id, now, defaultUser), { ok: false, reason: 'expired' });
    assert.equal(statusOf(id), 'hidden', '被拒之后那一行必须原封不动');
  });

  it('到点后下架 → invalid_state/expired', () => {
    const id = insertRawShare({
      kind: 'seed',
      userId: defaultUser,
      status: 'active',
      expiresAt: now - 1,
    });

    assert.deepEqual(setShareHidden(id, now), { ok: false, reason: 'expired' });
    assert.equal(statusOf(id), 'active', '★ 被拒的下架不能顺手改库');
    assert.equal(hiddenAtOf(id), null);
  });

  it('重复下架 → invalid_state，而且 hidden_at 不被第二次点击改写', () => {
    const created = ok(
      createShare({
        kind: 'seed',
        userId: defaultUser,
        payload: { overworld: '5' },
        note: '',
        minutes: 5,
        now,
      }),
    );
    ok(setShareHidden(created.share.id, now));

    assert.deepEqual(setShareHidden(created.share.id, now + 60_000), {
      ok: false,
      reason: 'not_active',
    });
    assert.equal(
      hiddenAtOf(created.share.id),
      now,
      '★ "什么时候下架的"不能被第二次点击改写成现在 —— 那是审计唯一能读到的那个数',
    );
  });

  it('★ 恢复只有本人能做：别人（含管理员走到这一层）一律 forbidden', () => {
    /*
     * 路由层已经先判过一次 403（它要把"局外人"与"管理员"分开），这里是**数据层这一道**：
     * spec §6.1 把"恢复 = 只有本人"写在数据层比对 `user_id` 上 ——
     * 管理动作是单向的，"放回去"要么是作者的判断，要么不该由第三方代劳。
     */
    const stranger = makeUser('局外人');
    const created = ok(
      createShare({
        kind: 'seed',
        userId: defaultUser,
        payload: { overworld: '8' },
        note: '',
        minutes: 5,
        now,
      }),
    );
    ok(setShareHidden(created.share.id, now));

    assert.deepEqual(setShareVisible(created.share.id, now, stranger), {
      ok: false,
      reason: 'forbidden',
    });
    assert.equal(statusOf(created.share.id), 'hidden', '被拒之后还是 hidden');
    assert.equal(hiddenAtOf(created.share.id), now);

    // 本人可以（同一时刻的正面对照，排除"这条路径整个坏了"）
    ok(setShareVisible(created.share.id, now, defaultUser));
    assert.equal(statusOf(created.share.id), 'active');
  });
});

// ---------------------------------------------------------------------------
// 坏行
// ---------------------------------------------------------------------------

describe('坏行（payload 形状对不上 kind）', () => {
  it('★ 被跳过，不出现在 items / mine 里，也不抛', (t) => {
    /*
     * spec §3.2：payload 的形状只有应用层知道，数据库挡不住它 ——
     * 一次手改库、一次回滚、将来某次迁移都可能留下"形状对不上 kind"的行。
     * 透传给前端的话，界面上会渲染出一排破折号，看起来像我们这个功能坏了。
     */
    // 记日志这件事也一起验（"跳过"与"跳过**并记日志**"是这条规矩的两半）：
    // ⚠️ 一条谁也看不见的坏行如果连日志都没有，就再也没有地方能发现它了。
    // ⚠️ 第三个参数是空实现：`t.mock.method` 默认会**继续调用**原方法，
    //    那样这几条故意的坏行会把日志打进测试输出里（而它们已经被下面两条断言验过了）。
    const warn = t.mock.method(console, 'warn', () => {});
    // ① kind=seed 的行里放着一个 room 的 payload
    const wrongShape = insertRawShare({
      kind: 'seed',
      userId: defaultUser,
      payload: JSON.stringify({ code: 'AAA1' }),
      expiresAt: now + 60_000,
    });
    // ② 另一种坏行：payload 根本不是 JSON（`JSON.parse` 会抛的那种）
    const notJson = insertRawShare({
      kind: 'seed',
      userId: defaultUser,
      payload: '{"overworld":',
      expiresAt: now + 60_000,
    });
    // ③ 正面控制：同一批里那一条**好**行必须照常出来。没有它的话，
    //    "整个查询返回空数组"也能让上面两条断言通过。
    const good = insertRawShare({
      kind: 'seed',
      userId: defaultUser,
      payload: JSON.stringify({ overworld: '1234567890123456789' }),
      expiresAt: now + 60_000,
    });

    assert.deepEqual(
      listBoard('seed', now, defaultUser).map((s) => s.id),
      [good],
    );
    assert.deepEqual(
      listMine('seed', defaultUser, now).map((s) => s.id),
      [good],
      '★ mine 里也要跳过（它是"我自己那几条"，坏行照样不该出现）',
    );

    // ★ 跳过的那两行都要能在日志里认出来 —— 否则坏行就是"静静地消失"
    const logged = warn.mock.calls.map((call) => String(call.arguments[0])).join('\n');
    assert.match(logged, new RegExp(wrongShape), '日志里要能指出是哪一行');
    assert.match(logged, new RegExp(notJson));

    /*
     * 而**单行**那条路（路由层拿一行来渲染 `{ item }` 的那种）是**拒绝**，
     * 不是"回一个空壳"：列表查询已经把它们跳过了，所以走到那里说明调用方
     * 绕过了那道过滤 —— 而回一个半个形状的对象正是整件事要避免的东西。
     * ⚠️ `getShareForEdit` 自己不解析 payload（路由层要用它读 user_id / status
     *    来决定 404 与 403），所以这里读到的是一个**原样**的行。
     */
    for (const badId of [wrongShape, notJson]) {
      const row = getShareForEdit(badId);
      assert.ok(row, '坏行照样读得出来 —— 判它坏不坏是上面那一步的事');
      assert.throws(
        () => buildItem(row, defaultUser, now),
        /payload/,
        '单行那条路必须拒绝，而不是把半个形状发出去',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 回收
// ---------------------------------------------------------------------------

describe('回收', () => {
  it('过期 25 小时的删掉，24 小时内的留着', () => {
    const longAgo = now - SHARE_RETENTION_MS - 60 * 60 * 1000; // 25 小时前到点

    const doomed = insertRawShare({
      userId: defaultUser,
      createdAt: longAgo - 60_000,
      expiresAt: longAgo,
    });
    const boundary = insertRawShare({
      userId: defaultUser,
      createdAt: now - SHARE_RETENTION_MS - 60_000,
      expiresAt: now - SHARE_RETENTION_MS,
    });
    const recent = insertRawShare({
      userId: defaultUser,
      createdAt: now - 3_660_000,
      expiresAt: now - 3_600_000,
    });
    const live = insertRawShare({ userId: defaultUser, expiresAt: now + 60_000 });
    // 下架 / 被替换的行一样是行：回收只看 expires_at，不看状态
    const hiddenOld = insertRawShare({
      userId: defaultUser,
      status: 'hidden',
      hiddenAt: longAgo,
      createdAt: longAgo - 60_000,
      expiresAt: longAgo,
    });

    assert.equal(deleteExpiredShares(now), 2, '删掉的正好是两条 25 小时前到点的（含下架的那条）');

    assert.equal(countRows('live_shares', doomed), 0);
    assert.equal(countRows('live_shares', hiddenOld), 0);
    assert.equal(
      countRows('live_shares', boundary),
      1,
      '★ 正好 24 小时的那条留着：判据是 expires_at < now - 24h，不是 ≤',
    );
    assert.equal(countRows('live_shares', recent), 1);
    assert.equal(countRows('live_shares', live), 1);

    // 任务只影响体积：看板上那一条照常在（它本来就没到点）
    assert.equal(listBoard('seed', now, defaultUser).length, 1);
  });
});

// ---------------------------------------------------------------------------
// §5.1 的响应
// ---------------------------------------------------------------------------

describe('§5.1 的响应：一次拼好，时间只有一份', () => {
  it('★ items / mine / limit / liveCount / serverNow / truncated 都出自同一个 now', () => {
    /*
     * ⚠️ 路由层只调 `buildListResponse` **一次**（spec §5.1）：`serverNow` 与
     *    `liveCount` 必须是同一个时刻算出来的。在路由里再拼一遍的话，两者之间
     *    隔着几毫秒 —— 而前端正是拿 serverNow 去算"还剩几分钟"的。
     */
    const other = makeUser('张三');
    const mineActive = ok(
      createShare({
        kind: 'seed',
        userId: defaultUser,
        payload: { overworld: '111' },
        note: '我的那条',
        minutes: 5,
        now,
      }),
    );
    const mineHidden = ok(
      createShare({
        kind: 'seed',
        userId: defaultUser,
        payload: { overworld: '222' },
        note: '',
        minutes: 5,
        now: now + 1,
      }),
    );
    ok(setShareHidden(mineHidden.share.id, now + 2));
    const theirs = ok(
      createShare({
        kind: 'seed',
        userId: other,
        payload: { overworld: '333' },
        note: '',
        minutes: 5,
        now: now + 3,
      }),
    );
    const expired = insertRawShare({
      kind: 'seed',
      userId: defaultUser,
      status: 'active',
      expiresAt: now - 1,
    });

    const res = buildListResponse('seed', defaultUser, now);

    assert.equal(res.kind, 'seed');
    assert.equal(res.serverNow, now, '★ 就是传进来那个 now');
    assert.equal(res.limit, SHARE_LIMITS.seed);
    assert.equal(res.liveCount, 1, '★ 额度用量与看板用**同一个**判据：已到点的 active 行不算');
    assert.equal(res.truncated, false);

    assert.deepEqual(
      res.items.map((s) => s.id),
      [theirs.share.id, mineActive.share.id],
      'items：在展示的（含我自己那条），created_at DESC —— 已下架 / 已到点的不在',
    );
    assert.equal(res.items.find((s) => s.id === theirs.share.id)?.mine, false);
    assert.equal(res.items.find((s) => s.id === mineActive.share.id)?.mine, true);
    assert.equal(
      res.items.find((s) => s.id === theirs.share.id)?.authorName,
      '张三',
      '作者名来自 users',
    );

    assert.deepEqual(
      res.mine.map((s) => s.id),
      [mineHidden.share.id, mineActive.share.id],
      'mine：我自己**未过期**的行（含已下架），同样是 created_at DESC',
    );
    assert.equal(
      res.mine.every((s) => s.mine),
      true,
    );
    assert.equal(
      res.mine.some((s) => s.id === expired),
      false,
      '到点的行不在 mine 里',
    );

    // 看板与 mine 用的是同一个形状（`buildItem` 只有一处实现）
    const first = res.items[0];
    assert.ok(first);
    assert.deepEqual(Object.keys(first).sort(), [
      'authorName',
      'createdAt',
      'expiresAt',
      'id',
      'kind',
      'mine',
      'note',
      'payload',
      'status',
    ]);
  });

  it('★ 看板超过 200 行 ⇒ 只回 200 行 + truncated: true（不许安静截断）', () => {
    for (let i = 0; i < SHARE_BOARD_LIMIT; i += 1) {
      insertRawShare({ kind: 'seed', userId: defaultUser, expiresAt: now + 60_000 });
    }

    // 正好 200 行时**不能**报截断 —— 那是"拿到了 200 行"这个实现细节泄漏到界面上
    assert.equal(buildListResponse('seed', defaultUser, now).truncated, false);

    insertRawShare({ kind: 'seed', userId: defaultUser, expiresAt: now + 60_000 });
    const res = buildListResponse('seed', defaultUser, now);
    assert.equal(res.items.length, SHARE_BOARD_LIMIT);
    assert.equal(res.truncated, true, '截断必须说出来（界面上有一句"只显示了一部分"）');
  });

  it('summarize：全站在展示的条数（不含已下架 / 已到点的），外加两种额度', () => {
    const a = makeUser('甲');
    const b = makeUser('乙');
    ok(
      createShare({
        kind: 'room',
        userId: a,
        payload: { code: 'AAA1' },
        note: '',
        minutes: 5,
        now,
      }),
    );
    ok(
      createShare({
        kind: 'seed',
        userId: a,
        payload: { overworld: '1' },
        note: '',
        minutes: 5,
        now,
      }),
    );
    ok(
      createShare({
        kind: 'seed',
        userId: b,
        payload: { overworld: '2' },
        note: '',
        minutes: 5,
        now,
      }),
    );
    const hiddenOne = ok(
      createShare({
        kind: 'seed',
        userId: b,
        payload: { overworld: '3' },
        note: '',
        minutes: 5,
        now: now + 1,
      }),
    );
    ok(setShareHidden(hiddenOne.share.id, now + 2));
    insertRawShare({ kind: 'seed', userId: a, status: 'active', expiresAt: now - 1 });

    assert.deepEqual(summarize(now), {
      // ⚠️ 这是**全站**在展示的条数（介绍页那句「N 条在展示」），不是"我的"
      room: { live: 1, limit: SHARE_LIMITS.room },
      seed: { live: 2, limit: SHARE_LIMITS.seed },
    });
  });
});
