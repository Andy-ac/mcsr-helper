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
 *
 * ===========================================================================
 * 本文件有**两半**：上半是数据层，下半是 HTTP 层（spec §11.1）
 * ===========================================================================
 * 分界在文件中间那道横线（「HTTP 层：spec §11.1 那一份验收清单」）。
 * 上半调函数、下半 `app.request(...)` **真打路由**，两半共用下面这批夹具 ——
 * HTTP 那半有几条恰恰要靠 `insertRawShare` 才能造出被测状态（比如"已经到点的行"），
 * 因为路由层的时间**只能来自服务端**，塞不进一个 `now` 去。
 * ⚠️ spec §11.1 把这个文件写成 `shares.test.ts`，而计划把它挂在 `live-shares.test.ts`
 *    上：两半共用一套夹具与一个测试库，拆开就要把 `insertRawShare` 那一套抄两遍。
 */
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import type { ShareKind, ShareStatus } from '@mcsr/shared';
import { SHARE_BOARD_LIMIT, SHARE_LIMITS, SHARE_RETENTION_MS, SITE } from '@mcsr/shared';

// ⚠️ 必须在**任何** getDb() 之前设置：下面的 import 是动态的，就是为了让这一行先跑。
process.env.DB_PATH = ':memory:';
/*
 * 下面这几行只在 HTTP 那一半起作用（上半是纯数据层，不过 HTTP、不发信、不加密）：
 *   · NODE_ENV=test —— index.ts 用它关掉请求日志。那条日志不只是"吵"：
 *     Windows 匿名管道的缓冲区只有几十 KB，写满会阻塞事件循环，
 *     于是子进程发给 `node --test` 的 IPC 消息错位，运行器报出
 *     "Unable to deserialize cloned data"（一个看起来像并发问题的假故障）。
 *   · 发信驱动用 console（测试里它只打一行），scrypt 参数调小 ——
 *     不然每注册一个用户要等几百毫秒，而这一半要注册几十个。
 *   · `MCSR_SEED_API_BASE` 指向 RFC 2606 保证**不可解析**的 `.invalid`：
 *     公开面那一条会去扫种子代理的响应，而它的上游是用户自己的生产服务
 *     （seeds-proxy.test.ts 的文件头写了为什么绝不能真的打上去）。
 */
process.env.NODE_ENV = 'test';
process.env.MCSR_MAIL_DRIVER = 'console';
process.env.MCSR_SCRYPT_TEST_PARAMS = 'N=1024,r=8,p=1';
process.env.MCSR_SEED_API_BASE = 'http://upstream.invalid/api/v2';

const { app } = await import('./index');
const { closeDb, getDb } = await import('./db');
const { resetAll } = await import('./auth/ratelimit');
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
  /*
   * 认证端点的限流计数（注册 5 次/小时/IP）会跨用例累积：下半那一半每个用例都要
   * 注册两三个用户，不清的话跑到后面某个用例会开始拿 429，而它表现成的是
   * "注册/登录失败"，看起来像账号问题。每个请求换一个 IP 是第二道保险
   * （见 `testIp` 的注释）。
   */
  resetAll();
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

// ===========================================================================
// HTTP 层：spec §11.1 那一份验收清单（**真打路由**，不是直接调函数）
// ===========================================================================
// 上下两半守的是两件事：上半证明"库里现在是什么状态"，这一半证明"接口答应给前端
// 的那份合同"—— 状态码、拒绝码的形状、响应里到底有哪些字段、审计留了什么痕迹。
// §11.3 的 mutation 也是按这两层分开的靶子。
//
// ⚠️ 这一侧的时间**只能来自服务端**（`Date.now()` 在 handler 里取，spec §5.3 明文
//    不接受客户端传时间），所以过期的夹具不能像上半那样"传一个 now 进去" ——
//    只能把 `expires_at` 写到过去（`insertRawShare` 正是为此存在的）。
// ===========================================================================

/**
 * 每个请求一个不同的转发 IP。
 *
 * ⚠️ `index.ts` 的全局限流是**按 IP** 的 240 次/分钟，而这一半有两百来个请求
 *    （每个用例还要注册好几个用户）—— 全部走同一个 key 的话，跑到后面会开始拿
 *    **429**，而它表现成的是"注册/登录失败"，看起来像账号问题，与被限流毫无关系。
 *    `contributors.test.ts` 的文件头写了同一条。
 */
let httpIpSeq = 0;
function testIp(): string {
  httpIpSeq += 1;
  return `10.9.${String(Math.floor(httpIpSeq / 250))}.${String(httpIpSeq % 250)}`;
}

interface Res {
  status: number;
  body: Record<string, unknown>;
  /** 原始响应文本 —— 公开面那两条判据是**按文本**扫的。 */
  text: string;
  setCookie: string | null;
  cacheControl: string | null;
}

async function call(
  method: string,
  path: string,
  options: { json?: unknown; cookie?: string } = {},
): Promise<Res> {
  const headers: Record<string, string> = {
    origin: SITE.productionOrigin,
    'x-forwarded-for': testIp(),
  };
  if (options.json !== undefined) headers['content-type'] = 'application/json';
  if (options.cookie) headers.cookie = options.cookie;

  const response = await app.request(path, {
    method,
    headers,
    ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : {}),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (() => {
      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        return {};
      }
    })(),
    text,
    setCookie: response.headers.getSetCookie?.()[0] ?? null,
    cacheControl: response.headers.get('cache-control'),
  };
}

const PASSWORD = 'a good long passphrase';

type Role = 'user' | 'reviewer' | 'editor' | 'admin' | 'owner';

let httpUserSeq = 0;

/**
 * 注册 → 验证邮箱 → 登录，得到一个能用的 cookie。
 *
 * ⚠️ 顺序上的坑（与 `contributors.test.ts` 逐字相同）：**登录要求邮箱已验证**
 *    （`verify-required.test.ts`：没验证等于没注册完）。所以"未验证但已登录"
 *    这个状态只能**先验证、先登录、再把 `email_verified_at` 置回 NULL** 来构造 ——
 *    而那正是 §5.3 要的那一档（会话还在，但那一列是空的，每个请求读的是列）。
 *    倒过来写的话登录直接 403，拿不到 cookie，测的就变成"登录能不能过"了。
 */
async function signUp(role: Role = 'user', options: { verified?: boolean } = {}) {
  const verified = options.verified ?? true;
  httpUserSeq += 1;
  const email = `shares${String(httpUserSeq)}.${String(Date.now())}@example.com`;
  const displayName = `分享者${String(httpUserSeq)}`;

  const registered = await call('POST', '/api/auth/register', {
    json: { email, password: PASSWORD, displayName, locale: 'zh-CN' },
  });
  assert.equal(registered.status, 200, `注册失败：${registered.text}`);

  getDb()
    .prepare('UPDATE users SET email_verified_at = ?, role = ? WHERE email = ?')
    .run(Date.now(), role, email);

  const login = await call('POST', '/api/auth/login', { json: { email, password: PASSWORD } });
  assert.ok(login.setCookie, `登录失败：${login.text}`);

  if (!verified) {
    getDb().prepare('UPDATE users SET email_verified_at = NULL WHERE email = ?').run(email);
  }

  const row = getDb().prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string };
  return {
    id: row.id,
    email,
    displayName,
    cookie: (login.setCookie ?? '').split(';')[0] as string,
  };
}

/** room 的 body（默认 5 分钟 —— 那也是 §13 冻结的默认档）。 */
function roomBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { code: 'A7K2P', minutes: 5, ...overrides };
}

/** seed 的 body（默认 10 分钟）。 */
function seedBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { overworld: '1234', minutes: 10, ...overrides };
}

function postShare(kind: ShareKind, body: Record<string, unknown>, cookie?: string): Promise<Res> {
  return call('POST', `/api/shares/${kind}`, { json: body, cookie });
}

function board(kind: ShareKind, cookie: string): Promise<Res> {
  return call('GET', `/api/shares/${kind}`, { cookie });
}

function setVisible(id: string, visible: boolean, cookie: string): Promise<Res> {
  return call('PATCH', `/api/shares/${id}/visibility`, { json: { visible }, cookie });
}

/** 响应里的一条（§5.1 的形状）。 */
interface ShareItemView {
  id: string;
  kind: ShareKind;
  payload: Record<string, unknown>;
  note: string;
  authorName: string;
  createdAt: number;
  expiresAt: number;
  status: ShareStatus;
  mine: boolean;
}

function itemOf(res: Res): ShareItemView {
  const item = res.body.item as ShareItemView | undefined;
  assert.ok(item, `响应里应当有一条 item：${res.text}`);
  return item;
}

function itemsOf(res: Res): ShareItemView[] {
  return (res.body.items ?? []) as ShareItemView[];
}

function mineOf(res: Res): ShareItemView[] {
  return (res.body.mine ?? []) as ShareItemView[];
}

function idsOf(items: ShareItemView[]): string[] {
  return items.map((item) => item.id);
}

function firstOf(items: ShareItemView[]): ShareItemView {
  const one = items[0];
  assert.ok(one, '这一组里应当至少有一条');
  return one;
}

/** 那一条实体上的审计（按写入顺序）。 */
interface AuditRow {
  action: string;
  actor_id: string | null;
  entity_type: string;
  reason: string | null;
}

function auditsOf(entityId: string): AuditRow[] {
  return getDb()
    .prepare(
      'SELECT action, actor_id, entity_type, reason FROM audit_log WHERE entity_id = ? ORDER BY rowid',
    )
    .all(entityId) as unknown as AuditRow[];
}

/** 某条实体上某个动作**最后一次**的 reason。 */
function latestReason(entityId: string, action: string): string | null {
  const row = getDb()
    .prepare(
      'SELECT reason FROM audit_log WHERE entity_id = ? AND action = ? ORDER BY rowid DESC LIMIT 1',
    )
    .get(entityId, action) as { reason: string | null } | undefined;
  return row?.reason ?? null;
}

// ---------------------------------------------------------------------------
// 权限与拒绝码（spec §6.1 / §5.3）
// ---------------------------------------------------------------------------

describe('HTTP：权限与拒绝码', () => {
  it('匿名：两个读接口与发布一律 401 —— 不是空列表', async () => {
    const room = await call('GET', '/api/shares/room');
    const summary = await call('GET', '/api/shares/summary');
    const post = await postShare('room', roomBody());

    for (const res of [room, summary, post]) {
      assert.equal(res.status, 401, res.text);
      assert.deepEqual(res.body, { error: 'unauthorized' });
    }
    /*
     * ⚠️ 401 而不是 `{ items: [] }`（spec §5.1 明文要求）：空列表会让游客以为
     *    "这里现在没人分享"，那是**另一件**事 —— 而它对游客与登录用户长得一样。
     */
    assert.equal('items' in room.body, false);
    assert.equal('room' in summary.body, false);
  });

  it('★★ 未验证邮箱发布 ⇒ 403 email_not_verified，它与 401 是**两个**码', async () => {
    const author = await signUp('user', { verified: false });

    const anon = await postShare('room', roomBody());
    const unverified = await postShare('room', roomBody(), author.cookie);

    assert.equal(anon.status, 401);
    assert.deepEqual(anon.body, { error: 'unauthorized' }, '没登录 = 去登录');
    assert.equal(unverified.status, 403);
    assert.deepEqual(
      unverified.body,
      { error: 'email_not_verified' },
      '登录了只是没验证 = 去验证邮箱（前端据此换那一屏，不是跳登录页）',
    );
    // 两个码不是同一种"不行"：401 的下一步是登录，403 的下一步是去点邮件里的链接
    assert.notEqual(unverified.status, anon.status);
  });

  it('已验证邮箱 ⇒ 201，而且回读的是库里真正的那一行', async () => {
    const author = await signUp();
    const res = await postShare(
      'room',
      { code: 'A7K2P', note: '1.16 RSG 三缺一', minutes: 15 },
      author.cookie,
    );
    assert.equal(res.status, 201, res.text);

    const item = itemOf(res);
    assert.deepEqual(Object.keys(item).sort(), [
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
    assert.deepEqual(item.payload, { code: 'A7K2P' });
    assert.equal(item.note, '1.16 RSG 三缺一');
    assert.equal(item.authorName, author.displayName, '作者名来自 users（不是客户端传的）');
    assert.equal(item.status, 'active');
    assert.equal(item.mine, true, '自己发的：mine 必须是 true');
    assert.equal(item.expiresAt - item.createdAt, 15 * 60_000, '15 分钟真的写进了 expires_at');
    // 回读：响应里那一行与库里的那一行一致
    assert.equal(statusOf(item.id), 'active');
    assert.equal(hiddenAtOf(item.id), null);
  });

  it('下架别人的 ⇒ 403（什么都没改）；持有 share.moderate 的人 ⇒ 200', async () => {
    const author = await signUp();
    const stranger = await signUp();
    const editor = await signUp('editor');
    const created = await postShare('room', roomBody(), author.cookie);
    assert.equal(created.status, 201, created.text);
    const id = itemOf(created).id;

    const denied = await setVisible(id, false, stranger.cookie);
    assert.equal(denied.status, 403, denied.text);
    assert.deepEqual(denied.body, { error: 'forbidden' });
    assert.equal(statusOf(id), 'active', '被拒的那一次必须什么都没改');

    const moderated = await setVisible(id, false, editor.cookie);
    assert.equal(moderated.status, 200, moderated.text);
    assert.equal(itemOf(moderated).status, 'hidden');
    assert.equal(statusOf(id), 'hidden', '库里真的变了');
  });

  it('★★ 管理员能下架别人的，但**恢复**别人的一律 403（管理动作是单向的）', async () => {
    const author = await signUp();
    const editor = await signUp('editor');
    const created = await postShare('room', roomBody(), author.cookie);
    assert.equal(created.status, 201, created.text);
    const id = itemOf(created).id;

    assert.equal((await setVisible(id, false, editor.cookie)).status, 200);

    /*
     * ★ 裁决 11 / spec §4.2：管理员能"拿下来"是因为他代表站点，而"放回去"
     *   要么是作者的判断，要么不该由第三方代劳 —— 否则一条被下架的内容可以
     *   绕过作者被悄悄复活，而作者**不会收到任何通知**（界面上它自己那一条
     *   下架时是消失的，复活时又回来，他分不清是谁干的）。
     */
    const restoredByAdmin = await setVisible(id, true, editor.cookie);
    assert.equal(restoredByAdmin.status, 403, restoredByAdmin.text);
    assert.deepEqual(restoredByAdmin.body, { error: 'forbidden' });
    assert.equal(statusOf(id), 'hidden', '被拒之后它必须还是 hidden');

    // 作者本人可以放回去 —— 403 挡的是"别人"，不是"恢复"这件事本身
    assert.equal((await setVisible(id, true, author.cookie)).status, 200);
    assert.equal(statusOf(id), 'active');
  });
});

// ---------------------------------------------------------------------------
// 到点：判据不经过任何任务
// ---------------------------------------------------------------------------

describe('HTTP：到点', () => {
  it('★ 直接插一条已过期的行 ⇒ 看板与 mine 里都没有它（不调回收、不 mock 时间）', async () => {
    const author = await signUp();
    /*
     * ⚠️ 这一条的判据**不经过任何任务**：只插一行、只读一次，回收函数一次都没调、
     *    时间也没有被 mock。这正是 §4.1 "到点是一个查询条件，不是一次状态变更"的
     *    证据 —— 判据一旦挪进后台任务，这里立刻红，而线上表现是
     *    "任务没跑/跑挂了 ⇒ 过期内容还挂在看板上，界面看上去一切正常"。
     */
    const expired = insertRawShare({ kind: 'room', userId: author.id, expiresAt: now - 1 });

    const res = await board('room', author.cookie);
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(itemsOf(res), []);
    assert.deepEqual(mineOf(res), [], 'mine 也不含它 —— 到点之后连"恢复"都没有意义了');

    assert.equal(countRows('live_shares', expired), 1, '到点不是删除：那一行还在库里');
    assert.equal(statusOf(expired), 'active', '到点也不是一次状态变更：它仍然是 active');
  });

  it('到点后恢复 ⇒ 409 invalid_state，reason 是 expired', async () => {
    const author = await signUp();
    // hidden 且已到点：两个条件各自都对（它是 hidden 的、但它也已经没意义了）
    const expired = insertRawShare({
      kind: 'room',
      userId: author.id,
      status: 'hidden',
      expiresAt: now - 1,
    });

    const res = await setVisible(expired, true, author.cookie);
    assert.equal(res.status, 409, res.text);
    assert.deepEqual(res.body, { error: 'invalid_state', reason: 'expired' });
    assert.equal(statusOf(expired), 'hidden');
  });

  it('到点后下架 ⇒ 409 invalid_state，reason 是 expired', async () => {
    const author = await signUp();
    const expired = insertRawShare({ kind: 'room', userId: author.id, expiresAt: now - 1 });

    const res = await setVisible(expired, false, author.cookie);
    assert.equal(res.status, 409, res.text);
    assert.deepEqual(res.body, { error: 'invalid_state', reason: 'expired' });
    assert.equal(statusOf(expired), 'active', '被拒的那一次什么都没改');
  });
});

// ---------------------------------------------------------------------------
// 下架 / 恢复
// ---------------------------------------------------------------------------

describe('HTTP：下架 / 恢复（spec §4.2）', () => {
  it('下架 ⇒ 不在看板、但在 mine 里（hidden + hidden_at 有值）；恢复 ⇒ 回来，hidden_at 变回 null', async () => {
    const author = await signUp();
    const created = await postShare('room', roomBody(), author.cookie);
    assert.equal(created.status, 201, created.text);
    const id = itemOf(created).id;

    const hidden = await setVisible(id, false, author.cookie);
    assert.equal(hidden.status, 200, hidden.text);
    assert.equal(itemOf(hidden).status, 'hidden');

    const afterHide = await board('room', author.cookie);
    assert.deepEqual(itemsOf(afterHide), [], '看板上没有它了');
    /*
     * ⚠️ 但 `mine` 里必须还在：作者要看得见自己刚下架的那一条。不然"下架"对他
     *    表现为"凭空消失"，他会再发一遍（那正是 `listMine` 的注释写下的理由）。
     */
    const mineHidden = firstOf(mineOf(afterHide));
    assert.equal(mineHidden.id, id);
    assert.equal(mineHidden.status, 'hidden');
    assert.notEqual(hiddenAtOf(id), null, 'hidden_at 要有值（它与 status=hidden 同进同退）');

    const restored = await setVisible(id, true, author.cookie);
    assert.equal(restored.status, 200, restored.text);
    assert.equal(itemOf(restored).status, 'active');

    const afterRestore = await board('room', author.cookie);
    assert.deepEqual(idsOf(itemsOf(afterRestore)), [id], '回到看板上了');
    assert.equal(firstOf(mineOf(afterRestore)).status, 'active');
    assert.equal(hiddenAtOf(id), null, '恢复要把 hidden_at 清掉');
  });

  it('重复下架 ⇒ 409 invalid_state（再下架一次没有意义）', async () => {
    const author = await signUp();
    const created = await postShare('room', roomBody(), author.cookie);
    const id = itemOf(created).id;

    assert.equal((await setVisible(id, false, author.cookie)).status, 200);
    const again = await setVisible(id, false, author.cookie);
    assert.equal(again.status, 409, again.text);
    assert.deepEqual(again.body, { error: 'invalid_state', reason: 'not_active' });
  });

  it('★ 恢复一条 replaced 的行 ⇒ 409 invalid_state（它已经回不来了）', async () => {
    const author = await signUp();
    const first = await postShare('room', roomBody({ code: 'AAAA1' }), author.cookie);
    assert.equal(first.status, 201, first.text);
    const firstId = itemOf(first).id;

    // 再发一条 ⇒ 上一条被置 replaced（§3.4：这一步是让索引能成立的必需步骤）
    const second = await postShare('room', roomBody({ code: 'BBBB2' }), author.cookie);
    assert.equal(second.status, 201, second.text);
    assert.equal(statusOf(firstId), 'replaced');

    const res = await setVisible(firstId, true, author.cookie);
    assert.equal(res.status, 409, res.text);
    assert.deepEqual(res.body, { error: 'invalid_state', reason: 'not_hidden' });
    assert.equal(statusOf(firstId), 'replaced');
  });
});

// ---------------------------------------------------------------------------
// 恢复与额度的交互（§4.3）
// ---------------------------------------------------------------------------

describe('HTTP：恢复与额度的交互', () => {
  it('★★ room：下架 → 发新的 → 恢复旧的 ⇒ 409 `at_limit`，而且**不**顶掉新的那条', async () => {
    const author = await signUp();
    const first = await postShare('room', roomBody({ code: 'AAAA1' }), author.cookie);
    assert.equal(first.status, 201, first.text);
    const firstId = itemOf(first).id;

    assert.equal((await setVisible(firstId, false, author.cookie)).status, 200);

    const second = await postShare('room', roomBody({ code: 'BBBB2' }), author.cookie);
    assert.equal(second.status, 201, second.text);
    const secondId = itemOf(second).id;

    const res = await setVisible(firstId, true, author.cookie);
    /*
     * ★★ `at_limit` 是一个**独立的拒绝码**，不是 `invalid_state` 的一种
     *    （spec §4.2 那两行 + §13 的拒绝码表）：前端的恢复按钮只认
     *    `error === 'at_limit'`，它有一句专门的话（「你已经在展示另一条了，
     *    先把它下架，再恢复这条」）。塞进 `invalid_state` 的 reason 里到不了它手里。
     */
    assert.equal(res.status, 409, res.text);
    assert.deepEqual(res.body, { error: 'at_limit' });

    // (a) 那个"自动顶掉当前这条"的做法被明确否决了（§4.3）：恢复按钮上写着"恢复这条"，
    //     谁也不会预期它顺手杀掉另一条 —— 一次"你没按、但东西被顶掉了"。
    assert.equal(statusOf(secondId), 'active', '新的那条必须还在展示');
    assert.equal(
      statusOf(firstId),
      'hidden',
      '被拒之后它仍然是 hidden，可以等新的那条过期/下架后再恢复',
    );
  });

  it('★ seed 满 20 条时恢复一条已下架的 ⇒ 也是 409 `at_limit`（§4.2 最后一行）', async () => {
    const author = await signUp();
    // 20 条在展示的 + 一条已下架的（直接写库：它们不是被测行为）
    for (let i = 0; i < SHARE_LIMITS.seed; i += 1) {
      insertRawShare({ kind: 'seed', userId: author.id, expiresAt: now + 600_000 });
    }
    const hidden = insertRawShare({
      kind: 'seed',
      userId: author.id,
      status: 'hidden',
      expiresAt: now + 600_000,
    });

    const res = await setVisible(hidden, true, author.cookie);
    assert.equal(res.status, 409, res.text);
    assert.deepEqual(res.body, { error: 'at_limit' }, '恢复这条路也会给出 at_limit');
    assert.equal(statusOf(hidden), 'hidden');
  });
});

// ---------------------------------------------------------------------------
// kind 的两种限额
// ---------------------------------------------------------------------------

describe('HTTP：两种限额（room 靠索引，seed 靠事务里数一遍）', () => {
  it('room：发第二条 ⇒ 看板上只有新的那条，旧行变成 replaced', async () => {
    const author = await signUp();
    const first = await postShare('room', roomBody({ code: 'AAAA1' }), author.cookie);
    assert.equal(first.status, 201, first.text);
    const firstId = itemOf(first).id;

    const second = await postShare('room', roomBody({ code: 'BBBB2' }), author.cookie);
    assert.equal(second.status, 201, second.text);
    const secondId = itemOf(second).id;

    const res = await board('room', author.cookie);
    assert.deepEqual(idsOf(itemsOf(res)), [secondId], '看板上只有新的那一条');
    assert.equal(statusOf(firstId), 'replaced');
    assert.equal(statusOf(secondId), 'active');
  });

  it('★ room：上一条已过期但没被回收时，仍然发得出新的（§3.4）', async () => {
    const author = await signUp();
    /*
     * 回收任务只删 `expires_at < now - 24h` 的行 ⇒ "已过期、但仍是 active"
     * 这个状态最长存在约 24 小时，而部分唯一索引的谓词
     * （kind='room' AND status='active'）**不看过期** —— 那一行仍然占着名额。
     * ⇒ 发布事务里的"先把我自己所有 active 的 room 行置 replaced"
     *   是**让索引能成立的必需步骤**，不是顺手清理。
     * 谁把它改成"先查有没有、有就报错"，这一条立刻红（而且失败的样子是 500 ——
     * 撞索引是 SQLite 抛出来的错，路由层接不住）。
     */
    const stale = insertRawShare({ kind: 'room', userId: author.id, expiresAt: now - 1 });

    const res = await postShare('room', roomBody({ code: 'NEW01' }), author.cookie);
    assert.equal(res.status, 201, res.text);
    assert.equal(statusOf(stale), 'replaced');
    assert.equal(statusOf(itemOf(res).id), 'active');
  });

  it('★ seed：第 21 条 ⇒ 409 at_limit + limit:20；下架一条之后又能发', async () => {
    const author = await signUp();
    const ids: string[] = [];
    for (let i = 0; i < SHARE_LIMITS.seed; i += 1) {
      ids.push(insertRawShare({ kind: 'seed', userId: author.id, expiresAt: now + 600_000 }));
    }

    const denied = await postShare('seed', seedBody(), author.cookie);
    assert.equal(denied.status, 409, denied.text);
    assert.deepEqual(
      denied.body,
      { error: 'at_limit', limit: SHARE_LIMITS.seed },
      '§5.3：这一档要带上 limit（前端那句"已经 20 条了"要用它）',
    );
    assert.equal(liveRows(author.id, 'seed'), SHARE_LIMITS.seed, '被拒的那一次一行都没多写');

    const one = ids[0];
    assert.ok(one);
    assert.equal((await setVisible(one, false, author.cookie)).status, 200);

    const allowed = await postShare('seed', seedBody({ overworld: '9999' }), author.cookie);
    assert.equal(allowed.status, 201, allowed.text);
    assert.equal(
      liveRows(author.id, 'seed'),
      SHARE_LIMITS.seed + 1,
      'seed 是**加**一条（不是替换）—— 所以是 21 行，而在展示的仍然是 20',
    );
    assert.equal(itemsOf(await board('seed', author.cookie)).length, SHARE_LIMITS.seed);
  });

  it('★★ seed：19 条时并发发两条 ⇒ 恰好一条 201、一条 409（检查在事务里）', async () => {
    const author = await signUp();
    for (let i = 0; i < SHARE_LIMITS.seed - 1; i += 1) {
      insertRawShare({ kind: 'seed', userId: author.id, expiresAt: now + 600_000 });
    }

    /*
     * ★★ 这条用例成立的**前提**是 spec §3.3 写下的一件事实：这个服务是
     *    **单进程 + 同步 SQLite 驱动（`node:sqlite`）** ⇒ `createShare` 里
     *    "数一遍"与"插进去"那两句之间**不可能**插进另一个请求（它们之间没有
     *    任何 `await`，而且都在同一个事务里）。两个请求确实会交错 ——
     *    `await c.req.json()` 那里让出去过一次 —— 但交错不了那两句。
     * ⚠️★ 它钉的是**必须的终态**（恰好一条 201、一条 409、库里恰好 20 行），
     *    **不是**"检查必须与写入在同一个事务里"这个机制：那个机制是一条
     *    **设计论证**（spec §3.3 的单进程 + 同步驱动），而这个部署形态恰好让它
     *    **不可证伪** —— 安全性正来自"读与写之间没有让出点"，所以把检查挪到
     *    事务外**在行为上完全看不出差别**，没有任何 mutation 能让这一条红。
     *    （这条注释原先写着"它是 mutation ③ 的靶子"，那是错的：那处 mutation
     *    已被 spec §11.3 撤掉。）
     * ⚠️★ 反过来才是要紧的那一半：**加一个让出点就当场失效，而所有测试仍然全绿**。
     *    哪天有人在"数一遍"与"插进去"之间补一个 `await`，两次请求就真的可能
     *    都读到 19 ⇒ 两条都 201 ⇒ 21 条在展示。那道前提写在 `createShare` 里
     *    "数一遍"那两行的注释上（`live-shares.ts`），动它之前先读那一段。
     */
    const results = await Promise.all([
      postShare('seed', seedBody({ overworld: 'AAAA' }), author.cookie),
      postShare('seed', seedBody({ overworld: 'BBBB' }), author.cookie),
    ]);

    assert.deepEqual(
      results.map((r) => r.status).sort((a, b) => a - b),
      [201, 409],
      `恰好一条成功、一条被拒：${results.map((r) => r.text).join(' | ')}`,
    );
    const refused = results.find((r) => r.status === 409);
    assert.deepEqual(refused?.body, { error: 'at_limit', limit: SHARE_LIMITS.seed });
    assert.equal(liveRows(author.id, 'seed'), SHARE_LIMITS.seed, '恰好 20 条，一条都没多');
  });

  it('★ seed 的额度只数**在展示的**：一条已过期未回收的 active 行不占额度', async () => {
    const author = await signUp();
    for (let i = 0; i < SHARE_LIMITS.seed - 1; i += 1) {
      insertRawShare({ kind: 'seed', userId: author.id, expiresAt: now + 600_000 });
    }
    // 第 20 行：已经到点，但回收任务还没删它（它只删 24 小时以上的行）
    const stale = insertRawShare({ kind: 'seed', userId: author.id, expiresAt: now - 1 });

    const res = await board('seed', author.cookie);
    /*
     * ★ `liveCount` 必须用**与看板完全相同的那一个判据**（§5.1），不能只数
     *   `status='active'`：一条刚过期、还没被回收的行**不占额度**（它已经不在
     *   看板上了，凭什么占）。这正是 §3.4 那个"索引不看过期"的另一半 ——
     *   索引与限额的口径不同，而它们**必须**不同。
     */
    assert.equal(res.body.liveCount, SHARE_LIMITS.seed - 1, '已到点的那一行不算用量');
    assert.equal(res.body.limit, SHARE_LIMITS.seed);
    assert.equal(itemsOf(res).length, SHARE_LIMITS.seed - 1);

    const posted = await postShare('seed', seedBody({ overworld: 'FFFF' }), author.cookie);
    assert.equal(
      posted.status,
      201,
      '按字面读法（只数 status=active）这一条会被 409 —— 而它必须发得出来',
    );
    assert.equal(statusOf(stale), 'active', '到点不是一次状态变更：那一行仍然是 active');
  });
});

// ---------------------------------------------------------------------------
// 输入校验
// ---------------------------------------------------------------------------

describe('HTTP：输入校验（400 invalid_input + issues）', () => {
  it('房间号：3–20 个字母数字与 - _ 通过；2 字符 / 21 字符 / 空格 / 中文 / 空 拒绝', async () => {
    const author = await signUp();

    for (const code of ['A7K2P', 'ab-12_x']) {
      const res = await postShare('room', roomBody({ code }), author.cookie);
      assert.equal(res.status, 201, `code=${code} 应当通过：${res.text}`);
      assert.deepEqual(itemOf(res).payload, { code });
    }

    for (const code of ['ab', 'a'.repeat(21), 'has space', '中文房间号', '']) {
      const res = await postShare('room', roomBody({ code }), author.cookie);
      assert.equal(res.status, 400, `code=${JSON.stringify(code)} 应当被拒：${res.text}`);
      assert.equal(res.body.error, 'invalid_input');
      // 本仓统一的 400 形状：`issues` 让前端能把错误指到具体那一格
      assert.ok(Array.isArray(res.body.issues), '要带上 issues');
      assert.ok((res.body.issues as unknown[]).length > 0);
    }
  });

  it('minutes：只接受四档里的值，而且它真的决定 expires_at', async () => {
    const author = await signUp();

    for (const minutes of [5, 10, 15, 20]) {
      const res = await postShare('room', roomBody({ minutes }), author.cookie);
      assert.equal(res.status, 201, `minutes=${String(minutes)} 应当通过：${res.text}`);
      const item = itemOf(res);
      assert.equal(item.expiresAt - item.createdAt, minutes * 60_000);
    }

    for (const minutes of [0, 25, 7, -5, 'abc', '5', null]) {
      const res = await postShare('room', roomBody({ minutes }), author.cookie);
      assert.equal(res.status, 400, `minutes=${JSON.stringify(minutes)} 应当被拒：${res.text}`);
      assert.equal(res.body.error, 'invalid_input');
    }
  });

  it('说明的宽度预算（room 40）：正好 40 个 ASCII ✓ / 41 ✗ / 20 个汉字 ✓ / 21 ✗', async () => {
    const author = await signUp();

    for (const note of ['a'.repeat(40), '汉'.repeat(20)]) {
      const res = await postShare('room', roomBody({ note }), author.cookie);
      assert.equal(res.status, 201, `note 宽度应当正好用满预算：${res.text}`);
      assert.equal(itemOf(res).note, note, '说明原样存下来');
    }

    for (const note of ['a'.repeat(41), '汉'.repeat(21)]) {
      const res = await postShare('room', roomBody({ note }), author.cookie);
      assert.equal(res.status, 400, `note 超预算应当被拒：${res.text}`);
      assert.equal(res.body.error, 'invalid_input');
    }
  });

  it('说明的宽度预算（seed 100）：50 个汉字 ✓ / 51 ✗', async () => {
    const author = await signUp();

    const ok = await postShare('seed', seedBody({ note: '汉'.repeat(50) }), author.cookie);
    assert.equal(ok.status, 201, ok.text);

    const tooWide = await postShare('seed', seedBody({ note: '汉'.repeat(51) }), author.cookie);
    assert.equal(tooWide.status, 400, tooWide.text);
    assert.equal(tooWide.body.error, 'invalid_input');
  });

  it('说明是选填的：不传 / 传空串都成功，而且库里存的是空串', async () => {
    const author = await signUp();

    const missing = await postShare('seed', { overworld: '1', minutes: 5 }, author.cookie);
    assert.equal(missing.status, 201, missing.text);
    assert.equal(itemOf(missing).note, '');

    const blank = await postShare('seed', { overworld: '2', minutes: 5, note: '' }, author.cookie);
    assert.equal(blank.status, 201, blank.text);
    assert.equal(itemOf(blank).note, '');

    /*
     * ⚠️ 库里也要是**空串**，不是 NULL、也不是 "undefined" 那几个字：
     *    前端的判据是"note 是不是空"（空就不渲染那一行），三种空会让它要判断三种。
     */
    const rows = getDb()
      .prepare('SELECT note FROM live_shares WHERE user_id = ? ORDER BY created_at')
      .all(author.id) as unknown as Array<{ note: string }>;
    assert.deepEqual(
      rows.map((r) => r.note),
      ['', ''],
    );
  });

  it('种子：只有主世界 ✓ / 四个都填 ✓ / 选填留空等于没填 ✓ / 主世界空 ✗ / 含空格 ✗ / 33 字符 ✗', async () => {
    const author = await signUp();

    const only = await postShare('seed', { overworld: '1234', minutes: 5 }, author.cookie);
    assert.equal(only.status, 201, only.text);
    assert.deepEqual(
      itemOf(only).payload,
      { overworld: '1234' },
      '只填主世界：payload 里只有这一格',
    );

    const all = await postShare(
      'seed',
      { overworld: '1', nether: '2', end: '3', rng: '4', minutes: 5 },
      author.cookie,
    );
    assert.equal(all.status, 201, all.text);
    assert.deepEqual(itemOf(all).payload, { overworld: '1', nether: '2', end: '3', rng: '4' });

    const blankOptional = await postShare(
      'seed',
      { overworld: '1', nether: '', end: '', rng: '', minutes: 5 },
      author.cookie,
    );
    assert.equal(blankOptional.status, 201, blankOptional.text);
    assert.deepEqual(
      itemOf(blankOptional).payload,
      { overworld: '1' },
      '留空 = 没填（空串在归一化时被去掉）',
    );

    for (const bad of [
      { overworld: '' },
      { overworld: '123 456' },
      { overworld: 'a'.repeat(33) },
      { overworld: '1', nether: 'has space' },
    ]) {
      const res = await postShare('seed', { ...bad, minutes: 5 }, author.cookie);
      assert.equal(res.status, 400, `${JSON.stringify(bad)} 应当被拒：${res.text}`);
      assert.equal(res.body.error, 'invalid_input');
    }
  });

  it('★ payload 形状对不上 kind 的手改行 ⇒ 被跳过（任何响应里都没有它）+ 不 500', async (t) => {
    const author = await signUp();
    /*
     * ⚠️ "跳过"与"跳过**并记日志**"是这条规矩的两半：一条谁也看不见的坏行如果连
     *    日志都没有，就再也没有地方能发现它了（上半有一条逐字相同的用例）。
     *    mock 传空实现：`t.mock.method` 默认会继续调用原方法，那样这一行故意的
     *    坏行会把日志打进测试输出里，而它已经被下面几条断言验过了。
     */
    t.mock.method(console, 'warn', () => {});
    // kind=seed 的行里放着一个 room 的 payload
    const bad = insertRawShare({
      kind: 'seed',
      userId: author.id,
      payload: JSON.stringify({ code: 'AAA1' }),
      expiresAt: now + 600_000,
    });
    // 正面控制：同一批里那一条**好**行必须照常出来。没有它的话，"整个查询挂了、
    // 回了个空列表"也能让下面两条断言通过。
    const good = await postShare('seed', seedBody(), author.cookie);
    assert.equal(good.status, 201, good.text);
    const goodId = itemOf(good).id;

    const res = await board('seed', author.cookie);
    assert.equal(res.status, 200, '一条坏行绝不能让整条查询 500');
    assert.deepEqual(idsOf(itemsOf(res)), [goodId], 'items 里只有好行');
    assert.deepEqual(idsOf(mineOf(res)), [goodId], 'mine 里也要跳过');
    assert.equal(res.text.includes(bad), false, '坏行**自己**不能出现在任何响应里');

    /*
     * ⚠️ 摘要与看板在这里**故意不同**，写下来免得下一个人以为漏了什么：
     *    摘要是 SQL 层的 COUNT，它数的是"库里有多少行满足看板条件"，
     *    而看板多一道"payload 得能解析"的过滤。所以一条坏行会被摘要数进去、
     *    却不会被渲染出来 —— 这一档只可能来自"手改过库"（§3.2），
     *    而摘要那一个数只用来写「N 条在展示」。这一条只要求它不 500。
     */
    const summary = await call('GET', '/api/shares/summary', { cookie: author.cookie });
    assert.equal(summary.status, 200, summary.text);
  });
});

// ---------------------------------------------------------------------------
// 摘要
// ---------------------------------------------------------------------------

describe('HTTP：GET /api/shares/summary', () => {
  it('★★ `/summary` 不会被 `/:kind` 抢走（Hono 按注册顺序匹配）', async () => {
    const author = await signUp();
    /*
     * ⚠️ 注册顺序反了的话，`/api/shares/summary` 会落进 `:kind='summary'`
     *    那条路由 —— 而它解析不出 kind，回 400 —— 于是介绍页永远拿不到条数。
     *    这种错在路由文件里**读不出来**（两条路由各自都是对的）。
     */
    const res = await call('GET', '/api/shares/summary', { cookie: author.cookie });
    assert.equal(res.status, 200, `被 :kind 抢走了：${res.text}`);
    assert.deepEqual(Object.keys(res.body).sort(), ['room', 'seed', 'serverNow']);

    // 反面：一个真的不认识的段落会落进 `:kind` 并 400 —— 那就是被抢走时的症状
    const unknown = await call('GET', '/api/shares/nope', { cookie: author.cookie });
    assert.equal(unknown.status, 400, unknown.text);
    assert.deepEqual(unknown.body, { error: 'invalid_input' });
  });

  it('★ 摘要里只有计数、没有任何一条内容（字段级断言），而且 live 是**全站**的', async () => {
    const asker = await signUp();
    const other = await signUp();
    assert.equal((await postShare('room', roomBody(), other.cookie)).status, 201);
    assert.equal((await postShare('seed', seedBody({ overworld: '1' }), other.cookie)).status, 201);
    assert.equal((await postShare('seed', seedBody({ overworld: '2' }), other.cookie)).status, 201);
    // 不在展示的两条：一条已下架的、一条已到点的 —— 都不该被数进去
    const hiddenOne = await postShare('seed', seedBody({ overworld: '3' }), other.cookie);
    assert.equal((await setVisible(itemOf(hiddenOne).id, false, other.cookie)).status, 200);
    insertRawShare({ kind: 'seed', userId: other.id, expiresAt: now - 1 });

    const res = await call('GET', '/api/shares/summary', { cookie: asker.cookie });
    assert.equal(res.status, 200, res.text);

    const room = res.body.room as { live: number; limit: number };
    const seed = res.body.seed as { live: number; limit: number };
    assert.deepEqual(Object.keys(res.body).sort(), ['room', 'seed', 'serverNow']);
    // 字段级：这两层各自**只有**这几个键（没有 id / payload / authorName 之类的任何一条内容）
    assert.deepEqual(Object.keys(room).sort(), ['limit', 'live']);
    assert.deepEqual(Object.keys(seed).sort(), ['limit', 'live']);
    assert.equal(room.live, 1);
    assert.equal(room.limit, SHARE_LIMITS.room);
    /*
     * ★ 2 而不是 4：已下架的那一条与已到点的那一条都不算（§5.2 说的是"在展示的条数"）。
     * ★ 而且这两条都是 **other** 发的，问的人 asker 一条都没发 —— `live` 是**全站**
     *   在展示的条数，不是"我的"（游客拿不到它，介绍页那句「N 条在展示」说的正是它）。
     */
    assert.equal(seed.live, 2);
    assert.equal(seed.limit, SHARE_LIMITS.seed);

    const serverNow = res.body.serverNow as number;
    assert.equal(typeof serverNow, 'number');
    assert.ok(
      Math.abs(serverNow - Date.now()) < 5_000,
      'serverNow 是服务端时间（前端拿它算偏移量）',
    );
  });

  it('两个读接口都带 Cache-Control: no-store', async () => {
    const author = await signUp();
    /*
     * 这是**只给登录用户的管理态数据 + 20 秒一变**（§7.6 的自动刷新）：进任何缓存
     * 都是错的。index.ts 那条全局中间件也设了 no-store，但这里要求路由**自己**
     * 也写明 —— 否则哪天有人为了别的端点放开一条缓存规则，这一条会跟着一起变。
     */
    assert.equal((await board('room', author.cookie)).cacheControl, 'no-store');
    assert.equal((await board('seed', author.cookie)).cacheControl, 'no-store');
    assert.equal(
      (await call('GET', '/api/shares/summary', { cookie: author.cookie })).cacheControl,
      'no-store',
    );
  });
});

// ---------------------------------------------------------------------------
// 公开面零泄漏
// ---------------------------------------------------------------------------

describe('HTTP：公开面零泄漏（§11.1 的判据就是那三条）', () => {
  it('★★ 三条判据：匿名 401 / 摘要只有计数 / 既有公开接口里没有新表名与能力名', async () => {
    const author = await signUp();
    const created = await postShare('room', roomBody({ code: 'SECRET1' }), author.cookie);
    assert.equal(created.status, 201, created.text);

    // ① 匿名访问两个读接口一律 401
    assert.equal((await call('GET', '/api/shares/room')).status, 401);
    assert.equal((await call('GET', '/api/shares/seed')).status, 401);
    assert.equal((await call('GET', '/api/shares/summary')).status, 401);

    // ② 摘要的响应里**只有计数，没有任何一条内容**（字段级断言，见上一条的注释）
    const summary = await call('GET', '/api/shares/summary', { cookie: author.cookie });
    assert.equal(summary.status, 200);
    assert.equal(summary.text.includes('SECRET1'), false, '摘要里不该有房间号');
    assert.equal(summary.text.includes(author.displayName), false, '也不该有作者名');

    /*
     * ③ 既有公开接口里没有新表名、也没有新能力名。
     * ⚠️ 断言**这两个具体的字符串**，不写成"扫一遍有没有 share 这个词"：
     *    `share` 是个常见英文词（"分享按钮""share this"），那种模糊断言要么恒真、
     *    要么以后天天假红。
     * ⚠️ 真正的"内容不出现在公开面"由前端那条产物级断言守（§11.2 第 1、2 条）。
     */
    for (const path of ['/api/resources', '/api/live', '/api/calendar']) {
      const res = await call('GET', path);
      assert.equal(res.status, 200, `${path}：${res.text}`);
      assert.equal(res.text.includes('live_shares'), false, `${path} 里不该出现这张表的名字`);
      assert.equal(res.text.includes('share.moderate'), false, `${path} 里不该出现这个能力名`);
    }
  });

  it('★ 种子代理也扫一遍（§11.1 写的是 /api/seeds；本仓的路径是 /api/ranked-seeds）', async (t) => {
    /*
     * ⚠️ 它的上游是**用户自己的生产服务**，而 seeds-proxy.test.ts 的文件头明令：
     *    那个文件里绝不能产生真实网络请求（其中一个端点会往上游库里写数据）。
     *    这里照那条规矩办：`MCSR_SEED_API_BASE` 指向 RFC 2606 保证**不可解析**的
     *    `.invalid`，再把 fetch 换掉，mock 里还断言请求确实落在 `.invalid` 上 ——
     *    万一 mock 没装上，请求会立刻失败而不是打到真上游。
     */
    t.mock.method(globalThis, 'fetch', (async (input: unknown) => {
      assert.ok(
        new URL(String(input)).hostname.endsWith('.invalid'),
        `测试里出现了一个不在约定主机上的请求：${String(input)}`,
      );
      return new Response(
        JSON.stringify({
          success: true,
          message: 'ok',
          data: {
            id: 1,
            overworldSeed: '7304888896886165976',
            netherSeed: '238703850641435',
            theEndSeed: '7304888896886165976',
            availableCounts: 1_039_488,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof globalThis.fetch);

    const res = await call('GET', '/api/ranked-seeds/random');
    assert.equal(res.status, 200, res.text);
    assert.equal(res.text.includes('live_shares'), false);
    assert.equal(res.text.includes('share.moderate'), false);
  });
});

// ---------------------------------------------------------------------------
// 审计
// ---------------------------------------------------------------------------

describe('HTTP：审计（spec §6.3 冻结的三个名字）', () => {
  it('share.create：reason 里有 kind 与分钟数；room 替换时写明「替换掉 N 条」', async () => {
    const author = await signUp();
    const first = await postShare('room', roomBody({ code: 'AAAA1', minutes: 5 }), author.cookie);
    const second = await postShare('room', roomBody({ code: 'BBBB2', minutes: 10 }), author.cookie);
    assert.equal(first.status, 201, first.text);
    assert.equal(second.status, 201, second.text);
    const firstId = itemOf(first).id;
    const secondId = itemOf(second).id;

    const created = auditsOf(secondId);
    assert.deepEqual(
      created.map((a) => a.action),
      ['share.create'],
    );
    const row = created[0];
    assert.ok(row);
    assert.equal(row.actor_id, author.id);
    assert.equal(row.entity_type, 'live_share');
    assert.match(row.reason ?? '', /room/, 'reason 里要有 kind');
    assert.match(row.reason ?? '', /10 分钟/, 'reason 里要有展示时长');
    assert.match(row.reason ?? '', /替换掉 1 条/, '§6.3：room 替换掉了旧行就必须写明几条');

    // 第一次发布没有替换任何东西 ⇒ 那一句不该出现（"替换掉 0 条"是噪音）
    assert.equal((auditsOf(firstId)[0]?.reason ?? '').includes('替换掉'), false);
    /*
     * ★ 被替换掉的那一行**没有**自己的审计（§6.3 明文）：它是同一次 share.create
     *   的后果，reason 里已经写明。两条记录会让"他发了几次"这个最简单的计数
     *   变成要人去重。
     */
    assert.deepEqual(
      auditsOf(firstId).map((a) => a.action),
      ['share.create'],
      '被替换的那一条只留它自己那次发布的审计',
    );
  });

  it('share.hide / share.restore：reason 里能分辨作者自己与治理者', async () => {
    const author = await signUp();
    const editor = await signUp('editor');
    const created = await postShare('room', roomBody(), author.cookie);
    assert.equal(created.status, 201, created.text);
    const id = itemOf(created).id;

    assert.equal((await setVisible(id, false, author.cookie)).status, 200);
    assert.equal(latestReason(id, 'share.hide'), '下架（作者自己）');

    assert.equal((await setVisible(id, true, author.cookie)).status, 200);
    assert.equal(latestReason(id, 'share.restore'), '恢复上架（作者自己）');

    /*
     * 治理者下架别人的那一条：**事后只有 reason 能分辨**是谁下的
     * （沿用 `PATCH /api/resources/:id/visibility` 那一条的写法）。
     */
    assert.equal((await setVisible(id, false, editor.cookie)).status, 200);
    assert.equal(latestReason(id, 'share.hide'), '下架（治理者）');
    assert.deepEqual(
      auditsOf(id)
        .filter((a) => a.action === 'share.hide')
        .map((a) => a.reason),
      ['下架（作者自己）', '下架（治理者）'],
      '两次下架各自留痕，而且读得出来是哪一种',
    );
    assert.equal(latestReason(id, 'share.restore'), '恢复上架（作者自己）');
  });
});

// ---------------------------------------------------------------------------
// 看板上限
// ---------------------------------------------------------------------------

describe('HTTP：看板上限（§5.1）', () => {
  it('★★ 201 条 ⇒ 200 行 + truncated:true；正好 200 条 ⇒ truncated:false（不许安静截断，也不许谎报）', async () => {
    const author = await signUp();
    for (let i = 0; i < SHARE_BOARD_LIMIT; i += 1) {
      insertRawShare({ kind: 'seed', expiresAt: now + 600_000 });
    }

    const exact = await board('seed', author.cookie);
    assert.equal(exact.status, 200, exact.text);
    assert.equal(itemsOf(exact).length, SHARE_BOARD_LIMIT);
    assert.equal(
      exact.body.truncated,
      false,
      '正好 200 行**没有**被截断 —— 按"拿到了 200 行"就报截断是撒谎',
    );

    insertRawShare({ kind: 'seed', expiresAt: now + 600_000 });
    const over = await board('seed', author.cookie);
    assert.equal(itemsOf(over).length, SHARE_BOARD_LIMIT, '一次最多回 200 行');
    assert.equal(over.body.truncated, true, '超出上限必须说出来（界面上有一句"只显示了一部分"）');
  });
});
