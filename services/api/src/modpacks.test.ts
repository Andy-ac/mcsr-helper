/**
 * ★ B2：整合包的**数据层**（迁移 025 的那一张表）。
 *
 * ⚠️ 环境变量必须在任何 import 之前设好（照 `mod-tags.test.ts` / `moderation.test.ts` 的样板）。
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
   *       created_at 顺序一致** ⇒ Step 8 那把刀（把 `ORDER BY created_at, rowid` 改成
   *       `ORDER BY title`）切进去**照样绿** —— 也就是说那条断言证明不了"顺序来自 created_at"。
   *       本仓纪律：一条在该红时不红的断言比没有断言更坏 ⇒ 这一条是专门给那把刀准备的靶子。
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
   *   夹具的标题与插入顺序**反着给**（先插 `zzz`、后插 `aaa`）⇒ 少了 `rowid`
   *   或者写成 `ORDER BY title` 时，这一条会红。
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

  it('迁移 025 已登记，且两张表都在', () => {
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
});
