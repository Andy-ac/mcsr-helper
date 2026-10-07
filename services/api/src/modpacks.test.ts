/**
 * ★ B2：整合包的**数据层**（迁移 025 的那一张表）。
 *
 * ⚠️ 下面那四行 `process.env` 赋值**不是**"在任何 import 之前"生效的 —— ESM 的 import
 *    全部提升，真实顺序是**两组 import 先求值、然后才轮到这四行**（照 `mod-tags.test.ts` /
 *    `moderation.test.ts` 抄来的那句"必须在任何 import 之前设好"与本文件的实际形状不符）。
 *    今天安全**只因为** `getDb()` 是懒读 `process.env.DB_PATH`（`db/index.ts` 的 `dbPath()`）⇒
 *    赋值虽然在 import 之后，但那次读发生在**第一次调用 `getDb()`** 时。
 *    ⚠️ 危险场景很具体：将来任何一个 import 在模块顶层碰一次 `getDb()`，这个文件就会**静默
 *    去开 `./data/mcsr.db` 那个真文件**（写进去、清表）。⇒ describe 的第一条断言就是这件事的
 *    可执行形式（`PRAGMA database_list` 的 `main.file` 必须是空串）。
 * ⚠️ 本文件**只造 `actorId: null`**（不造用户）⇒ 不需要 `resetAll()`：那个 hook 是给
 *    "会撞 `POST /api/auth/register` 每 IP 每小时 5 次限流"的文件准备的（见 `mod-tags.test.ts`）。
 */
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.MCSR_MAIL_DRIVER = 'console';
process.env.MCSR_SCRYPT_TEST_PARAMS = 'N=1024,r=8,p=1';

import { closeDb, getDb } from './db';
import {
  createModPack,
  deleteModPack,
  listModPacks,
  readModPack,
  setModPackHot,
  updateModPack,
} from './modpacks';

after(() => closeDb());
beforeEach(() => {
  getDb().exec('DELETE FROM modpacks');
});

const NOW = 1_700_000_000_000;

describe('★ B2 数据层：modpacks 表', () => {
  it('★ 这个文件跑在 `:memory:` 上，不是一个真文件', () => {
    const rows = getDb().prepare('PRAGMA database_list').all() as unknown as {
      name: string;
      file: string;
    }[];
    assert.equal(
      rows.find((row) => row.name === 'main')?.file,
      '',
      '内存库的 `main.file` 是空串。它非空 ⇒ `DB_PATH` 没在第一次 `getDb()` 之前生效，而这个文件正在读写真库',
    );
  });

  it('建一条：读回来逐字段相同，modids **保序**', () => {
    const pack = createModPack({
      title: '平衡包',
      description: '一句话',
      gameVersion: '1.16.1',
      modids: ['z', 'a', 'm'],
      actorId: null,
      now: NOW,
    });
    assert.deepEqual(pack.modids, ['z', 'a', 'm'], '包里的顺序就是装的时候的顺序 ⇒ 读出来必须保序');
    assert.deepEqual(readModPack(pack.id), pack);
  });

  it('按版本过滤 + 按 created_at 升序', () => {
    createModPack({
      title: 'b',
      description: '',
      gameVersion: '1.16.1',
      modids: ['a'],
      actorId: null,
      now: NOW + 2,
    });
    createModPack({
      title: 'a',
      description: '',
      gameVersion: '1.16.1',
      modids: ['b'],
      actorId: null,
      now: NOW + 1,
    });
    createModPack({
      title: 'other',
      description: '',
      gameVersion: '1.7.10',
      modids: ['c'],
      actorId: null,
      now: NOW,
    });
    assert.deepEqual(
      listModPacks({ gameVersion: '1.16.1' }).map((p) => p.title),
      ['a', 'b'],
    );
    assert.equal(listModPacks({}).length, 3);
  });

  /*
   * ★★ 这一条与上面那条**故意相反**：标题顺序与 created_at 顺序对着给（`aaa` 是后建的、
   *    `zzz` 是先建的）。
   *    ⚠️ 上面那条（brief 给的夹具）里 `a`(NOW+1) / `b`(NOW+2) 的**标题顺序恰好与
   *       created_at 顺序一致** ⇒ 把 `ORDER BY created_at, rowid` 改成 `ORDER BY title`
   *       切进去**照样绿** —— 也就是说那条断言证明不了"顺序来自 created_at"。
   *       本仓纪律：一条在该红时不红的断言比没有断言更坏 ⇒ 这一条是专门给那把刀准备的靶子
   *       （读数：`order-by-title` ⇒ 本文件里红的正是这一条）。
   */
  it('★ 标题顺序与 created_at 顺序**相反**时，仍然按 created_at 升序（不是按标题）', () => {
    const earlier = createModPack({
      title: 'zzz',
      description: '',
      gameVersion: '1.16.1',
      modids: ['a'],
      actorId: null,
      now: NOW + 40,
    });
    const later = createModPack({
      title: 'aaa',
      description: '',
      gameVersion: '1.16.1',
      modids: ['b'],
      actorId: null,
      now: NOW + 50,
    });
    assert.deepEqual(
      listModPacks({ gameVersion: '1.16.1' }).map((p) => p.id),
      [earlier.id, later.id],
      '先建的排前面，哪怕它的标题在字母表后面（顺序来自 created_at，不来自 title）',
    );
  });

  /*
   * ★ `ORDER BY created_at, rowid` 里的第二个键：同一毫秒建的两个包，顺序不该未定义。
   *    它钉的是一条**可观察的性质**（同一毫秒建的两个包按建的时候的顺序读回来），值得留着。
   *
   *    ⚠️ **但这条夹具咬不动 `rowid` 那个平局键**（如实写明，别把它说成"少了 rowid 会红"）：
   *       它走的是 `WHERE game_version = ?` 的**索引路径**，而 `idx_modpacks_game_version`
   *       是 `(game_version, created_at)` ⇒ 索引键尾就是 rowid ⇒ 把 `, rowid` 拿掉之后
   *       顺序**照样**是插入序。读数：`order-by-created-only`（两条 SELECT 一起拿掉 `, rowid`）
   *       ⇒ 这一条**仍然绿**；真正会红的是下面那条走**无 WHERE 分支**的用例。
   *    ⚠️ 所以本文件里"平局键"这件事的靶子是**下一条**，不是这一条 —— 两条一起留着，
   *       是因为它们钉的分支不同（一条 WHERE、一条无 WHERE，见 `modpacks.ts` 里那两句 SELECT）。
   */
  it('★ 同一毫秒建的两个包：顺序就是**建的时候的顺序**（`created_at, rowid`）', () => {
    const first = createModPack({
      title: 'zzz',
      description: '',
      gameVersion: '1.16.1',
      modids: ['a'],
      actorId: null,
      now: NOW + 60,
    });
    const second = createModPack({
      title: 'aaa',
      description: '',
      gameVersion: '1.16.1',
      modids: ['b'],
      actorId: null,
      now: NOW + 60,
    });
    assert.deepEqual(
      listModPacks({ gameVersion: '1.16.1' }).map((p) => p.id),
      [first.id, second.id],
      'created_at 平局时按 rowid（插入顺序）—— 平局顺序未定义的话，同一毫秒建的两个包会随机换位',
    );
  });

  /*
   * ★ 同一毫秒 + **不带 `WHERE`** 的那条分支（`listModPacks({})`，`modpacks.ts` 里第一句 SELECT）。
   *    这是本文件里**唯一真的能咬住平局键 `rowid`** 的靶子：不带 `WHERE` 时
   *    `idx_modpacks_game_version`（`(game_version, created_at)`）的**前缀对不上** ⇒ 用不上它，
   *    SQLite 只能排一棵临时 B 树 ⇒ 拿掉 `, rowid` 之后平局顺序就不再是插入序。
   *    读数：`order-by-created-only-nowhere`（只把无 WHERE 那句的 `, rowid` 拿掉）⇒ 只有这一条红。
   *    ⚠️ 标题故意与插入顺序**反着给**（先插 `zzz`、后插 `aaa`）：万一平局顺序是"按标题"，
   *       这一条也会红。
   */
  it('★ 同一毫秒 + 不带 `gameVersion` 时（无 WHERE 那条分支）：顺序仍是**建的时候的顺序**', () => {
    const first = createModPack({
      title: 'zzz',
      description: '',
      gameVersion: '1.16.1',
      modids: ['a'],
      actorId: null,
      now: NOW + 70,
    });
    const second = createModPack({
      title: 'aaa',
      description: '',
      gameVersion: '1.16.1',
      modids: ['b'],
      actorId: null,
      now: NOW + 70,
    });
    assert.deepEqual(
      listModPacks({}).map((p) => p.id),
      [first.id, second.id],
      '无 WHERE 那条 SELECT 也必须带 `, rowid`：它那条路径上索引帮不上忙，平局键没了顺序就散了',
    );
  });

  it('★ 坏掉的 `modids` 那一格 ⇒ 整条**当作不存在**（不是塞一个空数组）', () => {
    getDb()
      .prepare(
        'INSERT INTO modpacks (id, title, description, game_version, modids, hot, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)',
      )
      .run('broken', 'x', '', '1.16.1', '{not json', NOW, NOW);
    assert.equal(readModPack('broken'), null);
    assert.equal(
      listModPacks({}).some((p) => p.id === 'broken'),
      false,
    );
  });

  /*
   * ★★ **`!Array.isArray` 那一支的唯一靶子**（照 `mod-tags.test.ts` 里 `insert.run('not-array', '{"a":1}', …)`
   *    那条补的；上一轮只抄了它上面那一条 `'{not json'`）。
   *
   *    为什么必须有这一条：`'{not json'` 在 `JSON.parse` 就抛，**根本到不了** `Array.isArray` 那行；
   *    而把那一行从 `throw` 改成 `return []`（语义翻面：`[]` = "管理员清空了它"）时，
   *    `'{not json'` 的读数一个字都不变 ⇒ **整套测试全绿而语义正好翻面**。
   *    本仓另外四处同位置（`calendar/events.ts` / `live.ts` / `resources.ts` / `review/registry.ts`）
   *    写的都是 `return []` ⇒ 谁照着先例改过来，今天没有一条测试会红。
   *    读数：`nonarray-return-empty` 那一刀 ⇒ 红的正是这一条（`'{not json'` 那条仍绿）。
   *
   *    ⚠️ 顺带把 `console.warn` 截下来当判据（`tracking-routes.test.ts` 的 `postAsEditorWithLog` 同一形状）：
   *       只断言"读不出来"的话，把 `console.warn` 那一行删掉照样全绿，而"哪个包坏了"这唯一的现场就没了。
   *       ⚠️ `console.warn` 是全局的 ⇒ 用 `try/finally` 换回去（同一文件里 node:test 是顺序跑的）。
   */
  it('★ 合法 JSON 但**不是数组**（`{"a":1}`）⇒ 同样整条当作不存在，并且留下一行日志', () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((arg) => String(arg)).join(' '));
    };
    try {
      getDb()
        .prepare(
          'INSERT INTO modpacks (id, title, description, game_version, modids, hot, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)',
        )
        .run('not-array', 'x', '', '1.16.1', '{"a":1}', NOW, NOW);

      assert.equal(
        readModPack('not-array'),
        null,
        '合法 JSON 但不是数组 ⇒ 与"解析不了"同一处置：整条当作不存在（不是塞一个空数组）',
      );
      assert.equal(
        listModPacks({}).some((p) => p.id === 'not-array'),
        false,
        '它不该出现在列表里',
      );
      assert.equal(
        listModPacks({ gameVersion: '1.16.1' }).some((p) => p.id === 'not-array'),
        false,
        '带 WHERE 的那条分支同样不该出现它',
      );
    } finally {
      console.warn = original;
    }
    assert.ok(
      warnings.some((line) => line.includes('modids') && line.includes('not-array')),
      `坏掉的那一格必须留一行日志（否则"哪个包坏了"就没有现场了）；截到的日志：${JSON.stringify(warnings)}`,
    );
  });

  it('hot 是布尔（表里存 0/1）', () => {
    const pack = createModPack({
      title: 'p',
      description: '',
      gameVersion: '1.16.1',
      modids: ['a'],
      actorId: null,
      now: NOW,
    });
    assert.equal(pack.hot, false);
    assert.equal(setModPackHot({ id: pack.id, hot: true, now: NOW + 1 })?.hot, true);
    assert.equal(readModPack(pack.id)?.hot, true);
  });

  it('改：只动该动的，updated_at 变、created_at 不变', () => {
    const pack = createModPack({
      title: 'old',
      description: '',
      gameVersion: '1.16.1',
      modids: ['a'],
      actorId: null,
      now: NOW,
    });
    const next = updateModPack({
      id: pack.id,
      title: 'new',
      description: 'd',
      gameVersion: '1.16.1',
      modids: ['a', 'b'],
      now: NOW + 5,
    });
    assert.equal(next?.title, 'new');
    assert.deepEqual(next?.modids, ['a', 'b']);
    assert.equal(next?.createdAt, NOW);
    assert.equal(next?.updatedAt, NOW + 5);
  });

  it('删：真的没了；删不存在的返回 false', () => {
    const pack = createModPack({
      title: 'x',
      description: '',
      gameVersion: '1.16.1',
      modids: ['a'],
      actorId: null,
      now: NOW,
    });
    assert.equal(deleteModPack(pack.id), true);
    assert.equal(readModPack(pack.id), null);
    assert.equal(deleteModPack(pack.id), false);
  });

  it('迁移 025 已登记，且 `modpacks` 这张表建出来了', () => {
    const names = (
      getDb().prepare('SELECT name FROM _migrations').all() as unknown as { name: string }[]
    ).map((r) => r.name);
    assert.equal(names.includes('025_modpacks'), true);
    assert.equal(
      (
        getDb()
          .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='modpacks'")
          .get() as unknown as { n: number }
      ).n,
      1,
    );
  });

  /*
   * ★ 迁移 025 的**约束与索引**（原来一条断言都没有 —— "现读核过"不是判据）。
   *    三条都是"删掉它就会红"的，不是形状朗读：
   *      ① 删掉 `CHECK (hot IN (0, 1))` ⇒ `hot = 2` 能插进去 ⇒ `assert.throws` 红；
   *      ② 删掉 `REFERENCES users (id)` ⇒ 不存在的 `created_by` 能插进去 ⇒ 红；
   *      ③ 删掉 `CREATE INDEX idx_modpacks_game_version` ⇒ `sqlite_master` 里查不到 ⇒ 红。
   *    末了再数一次行数：两条**被拒**的插入一个字节都不许落库（"抛了"与"没写进去"是两件事）。
   */
  it('★ 迁移 025 的约束与索引是真的：`hot` 只收 0/1、`created_by` 必须是真用户、索引建了', () => {
    const db = getDb();
    const insert = db.prepare(
      'INSERT INTO modpacks (id, title, description, game_version, modids, hot, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );

    assert.throws(
      () => insert.run('hot2', 'x', '', '1.16.1', '[]', 2, null, NOW, NOW),
      /CHECK constraint failed/,
      '`hot` 是 INTEGER ⇒ 没有 CHECK 的话 2 也能存进去（`hot === 1` 于是变成 false：静默地把热门包读成不热门）',
    );
    assert.throws(
      () => insert.run('fk', 'x', '', '1.16.1', '[]', 0, 'no-such-user', NOW, NOW),
      /FOREIGN KEY constraint failed/,
      '`created_by` 指向一个不存在的用户 ⇒ 必须被拒（`PRAGMA foreign_keys = ON` 写在 `db/index.ts` 里，默认是关的）',
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT count(*) AS n FROM sqlite_master WHERE type = 'index' AND name = 'idx_modpacks_game_version'",
          )
          .get() as unknown as { n: number }
      ).n,
      1,
      '`listModPacks({gameVersion})` 每次都要跑的那个排序靠它；索引没了不会报错，只会悄悄变成全表扫',
    );
    assert.equal(
      (db.prepare('SELECT count(*) AS n FROM modpacks').get() as unknown as { n: number }).n,
      0,
      '上面两条插入都被拒了 ⇒ 库里必须一行都没有（"抛了"不等于"没写进去"）',
    );
  });
});
