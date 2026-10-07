/**
 * ★ B2 / Task 3：整合包的**六条端点**（公开两条读 + `pack.manage` 三条写 + `pack.feature` 一条热门）。
 *
 * ===========================================================================
 * ⚠️★ 与 brief 逐字给出的那份测试有四处**必须**不一样（brief 与实际不符，逐条写在报告里）
 * ===========================================================================
 * 1. **`app` 走动态 import**（`const { app } = await import('./index')`）。
 *    brief 写的是 `import { app } from './index'`，而 ESM 的 import 是**提升**的：
 *    静态 import 会在本文件那段 `process.env.* = …` **之前**求值 ——
 *    于是 `index.ts` 在 `NODE_ENV !== 'test'` 的分支里跑 `getDb()`（打开
 *    `./data/mcsr.db` 这个**真文件**）并 `serve()` 起一个真监听。
 *    本仓的样板一直是动态 import（`moderation.test.ts:16` / `mod-tags.test.ts:30,126`），
 *    brief 自己在 `makeUser` 上方的注释里指的也是那个样板。
 * 2. **`ROOT` 用 `fileURLToPath`**，不是 `new URL('../../../', import.meta.url).pathname`。
 *    后者在本机给出 `/C:/Users/…`，而 `path.join('/C:/Users/…', 'content/…')` 在 win32 上
 *    会拼成 `C:\C:\Users\…`（实测 ENOENT）⇒ `catalogNow()` 读不到目录、写端点全 500。
 *    同一形状的样板见 `mod-tags.test.ts:120-124`。
 * 3. **`makeUser` 照 `moderation.test.ts:55-67`**，不是 brief 里那个"拿 register 的 token"的版本：
 *    现读 `routes/auth.ts` ⇒ `POST /api/auth/register` 只回 `{ ok, message }`（**没有 token**），
 *    而 `POST /api/auth/login` 对 `email_verified_at === null` 的账号回 403。
 *    照 brief 那份写的话 cookie 会是 `session=`（空），每条断言都变成 401。
 * 4. `call()` 多回一个 `setCookie`（`makeUser` 要拿它），`readdirSync` 按 brief 的提醒补进 import。
 *    ⇒ 断言本身**一字未改**。
 *
 * ⚠️ 本文件会造**多个角色**的用户 ⇒ `beforeEach` 里必须 `resetAll()`（见那个 hook 的注释）。
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SITE } from '@mcsr/shared';
import { resetAll } from './auth/ratelimit';
import { closeDb, getDb } from './db';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.MCSR_MAIL_DRIVER = 'console';
process.env.MCSR_SCRYPT_TEST_PARAMS = 'N=1024,r=8,p=1';

/** 仓库根。⚠️ 必须走 `fileURLToPath`（见文件头第 2 条）。 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
process.env.MCSR_CONTENT_DIR = join(ROOT, 'content');

const { app } = await import('./index');

after(() => closeDb());
beforeEach(() => {
  /*
   * ⚠️★ 限流必须重置：`registerPerIp` 是 **5 次/小时/IP**（`auth/ratelimit.ts` 的 LIMITS，
   *    由 `routes/auth.ts` 施加）。本文件要造的用户数远超 5（第一条 `it` 一次就 4 个角色），
   *    不重置的话第 6 次 register 返回 429、**用户根本没被建出来**，
   *    于是 `makeUser` 里的 `login` 拿到 401 —— 症状长成"角色不对/密码不对"，
   *    与真实原因（限流）在输出里分不开。
   */
  resetAll();
  getDb().exec('DELETE FROM modpacks; DELETE FROM users;');
});

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  init?: { json?: unknown; cookie?: string },
): Promise<{ status: number; body: Record<string, unknown>; setCookie: string | null }> {
  const res = await app.request(path, {
    method,
    headers: {
      origin: SITE.productionOrigin,
      ...(init?.json === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init?.cookie === undefined ? {} : { cookie: init.cookie }),
    },
    ...(init?.json === undefined ? {} : { body: JSON.stringify(init.json) }),
  });
  const raw = res.headers.getSetCookie?.() ?? [];
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
    setCookie: raw[0] ?? null,
  };
}

/** 造一个指定角色的登录用户（照 `moderation.test.ts` 的样板，见文件头第 3 条）。 */
let seq = 0;
async function makeUser(role: string): Promise<string> {
  seq += 1;
  const email = `packer${String(seq)}.${String(Date.now())}@example.com`;
  const password = 'a good long passphrase';
  await call('POST', '/api/auth/register', {
    json: {
      email,
      password,
      displayName: `用户${String(seq)}`,
      locale: 'zh-CN',
    },
  });
  /*
   * ⚠️ 注册**不发**会话，而登录要求邮箱已验证 ⇒ 这两步都必须在 login 之前做
   *    （`moderation.test.ts:61-63` 同一段）。`pack.manage` / `pack.feature`
   *    两条能力都**不在** `REQUIRES_VERIFIED` 里，所以验证这一步只是为了过登录那一道闸。
   */
  getDb()
    .prepare('UPDATE users SET email_verified_at = ?, role = ? WHERE email = ?')
    .run(Date.now(), role, email);
  const login = await call('POST', '/api/auth/login', { json: { email, password } });
  assert.equal(login.status, 200, `${role} 登录失败`);
  return (login.setCookie ?? '').split(';')[0] as string;
}

const PACK = {
  title: '平衡包',
  description: '一句话',
  gameVersion: '1.16.1',
  modids: ['sodium', 'lithium'],
};

describe('★ B2 权限：建改删要 pack.manage，热门要 pack.feature', () => {
  it('user 建/改/删都是 403；reviewer / editor / admin 都能建改删', async () => {
    for (const role of ['user', 'reviewer', 'editor', 'admin']) {
      const cookie = await makeUser(role);
      const created = await call('POST', '/api/modpacks', { json: PACK, cookie });
      assert.equal(created.status, role === 'user' ? 403 : 201, `${role} 建包`);
      if (role === 'user') continue;
      const id = (created.body as { pack?: { id: string } }).pack?.id ?? '';
      assert.equal(
        (await call('PATCH', `/api/modpacks/${id}`, { json: { ...PACK, title: '改过' }, cookie }))
          .status,
        200,
        `${role} 改包`,
      );
      assert.equal(
        (await call('DELETE', `/api/modpacks/${id}`, { cookie })).status,
        200,
        `${role} 删包`,
      );
    }
  });

  it('★ 设热门：reviewer 403、editor 403、admin 200、owner 200（D2 那句"不复用 user.moderate"的判据）', async () => {
    const admin = await makeUser('admin');
    const created = await call('POST', '/api/modpacks', { json: PACK, cookie: admin });
    const id = (created.body as { pack?: { id: string } }).pack?.id ?? '';
    /*
     * ⚠️★ `editor` 这一格是**必须**有的，它不是"多测一个角色"：
     *    `pack.feature` 的陷阱正是"顺手加进 `EDITOR_CAPS`"（那一层同时喂给 editor / admin / owner）。
     *    只测 reviewer / admin / owner 的话，把 `pack.feature` 加进 `EDITOR_CAPS` 会让**全部**断言
     *    仍然绿：reviewer 不吃 `EDITOR_CAPS`（仍 403）、admin / owner 本来就该 200。
     *    ⇒ 只有 editor（该 403 而 `EDITOR_CAPS` 会把它变成 200）能抓住那次改动。
     */
    for (const [role, want] of [
      ['reviewer', 403],
      ['editor', 403],
      ['admin', 200],
      ['owner', 200],
    ] as const) {
      const cookie = await makeUser(role);
      const res = await call('PATCH', `/api/admin/modpacks/${id}/hot`, {
        json: { hot: true },
        cookie,
      });
      assert.equal(res.status, want, `${role} 设热门`);
    }
    /*
     * ★ 往返（hot 置 true 之后按 id 读回来）：只断 PATCH 的状态码证明不了"hot 真的落了盘"——
     *   `setModPackHot` 写成空操作（或 `hot` 恒 0）时，四条状态码断言**全绿**。
     *   而这条读端点正是**桌面主进程按 packId 取定义**要走的那条路。
     *   （上面最后一次 200 是 owner 设的 ⇒ 库里此刻是 true。）
     */
    const roundTrip = await call('GET', `/api/modpacks/${id}`);
    assert.equal(roundTrip.status, 200, '置热门之后按 id 必须读得回来');
    const wire = roundTrip.body as { hot?: boolean; modCount?: number };
    assert.equal(wire.hot, true, 'hot 必须读回来是 true（PATCH 回 200 而库里仍是 0 也照样绿）');
    assert.equal(wire.modCount, PACK.modids.length, 'modCount 必须等于 modids.length');
    for (const key of ['id', 'title', 'description', 'gameVersion', 'modids', 'hot', 'modCount']) {
      assert.equal(key in roundTrip.body, true, `按 id 读回来的形状缺 ${key}`);
    }
  });

  it('未登录三条写都是 401，且**不带** capability 键', async () => {
    const res = await call('POST', '/api/modpacks', { json: PACK });
    assert.equal(res.status, 401);
    assert.equal('capability' in res.body, false);
  });
});

describe('★ B2 校验：目录里没有的 modid 不许进包', () => {
  it('★ 塞一个目录里没有的 modid ⇒ 400 + unknown_mod + 那几个 id，而且**那条包没被写进去**', async () => {
    const cookie = await makeUser('editor');
    const res = await call('POST', '/api/modpacks', {
      json: { ...PACK, modids: ['sodium', 'nobody-defined-this'] },
      cookie,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.reason, 'unknown_mod');
    assert.deepEqual(res.body.modids, ['nobody-defined-this']);
    assert.equal(listModPacksAll().length, 0, '被拒的写不能留下痕迹');
  });

  it('65 个 / 空数组 / 空标题 / 超长简介 ⇒ 400 + issues', async () => {
    const cookie = await makeUser('editor');
    for (const json of [
      { ...PACK, modids: Array.from({ length: 65 }, (_, i) => `m${String(i)}`) },
      { ...PACK, modids: [] },
      { ...PACK, title: '' },
      { ...PACK, description: 'x'.repeat(401) },
      { ...PACK, gameVersion: '' },
    ]) {
      const res = await call('POST', '/api/modpacks', { json, cookie });
      assert.equal(res.status, 400, JSON.stringify(json).slice(0, 50));
      assert.equal(Array.isArray(res.body.issues), true);
    }
  });

  it('重复的 modid ⇒ 存进去的是**去重且保序**的', async () => {
    const cookie = await makeUser('editor');
    const res = await call('POST', '/api/modpacks', {
      json: { ...PACK, modids: ['lithium', 'sodium', 'lithium'] },
      cookie,
    });
    assert.deepEqual((res.body as { pack?: { modids: string[] } }).pack?.modids, [
      'lithium',
      'sodium',
    ]);
  });

  function listModPacksAll(): unknown[] {
    return getDb().prepare('SELECT id FROM modpacks').all() as unknown[];
  }
});

describe('★ B2 读：按版本过滤 + 保序 + hot 如实', () => {
  it('只返回该版本的包；modids 保序；modCount = modids.length', async () => {
    const cookie = await makeUser('admin');
    /*
     * ⚠️★ brief 这一段给的是 `['z', 'a']` / `['a']`，但**目录里既没有 `z` 也没有 `a`**
     *    （现读 `content/mod-catalog.json`：71 个 modid，两个都不在）——
     *    而 `POST /api/modpacks` 会因为 `unknown_mod` 当场 400（那正是上一节在守的东西）
     *    ⇒ 两个包一个都建不出来、列表是空的（实测：`[] !== ['v161']`）。
     *    ⇒ 改用**真实的** modid，但保留那条判据的形状：三个 id 按**非字母序**给
     *      （`krypton` < `lithium` < `sodium`）⇒ "存进去的顺序 == 拿出来的顺序"
     *      仍然可判 —— 哪天有人顺手对 modids 排序，这条会红。
     */
    const ordered = ['sodium', 'lithium', 'krypton'];
    await call('POST', '/api/modpacks', {
      json: { ...PACK, title: 'v161', modids: ordered },
      cookie,
    });
    await call('POST', '/api/modpacks', {
      json: { ...PACK, title: 'v1710', gameVersion: '1.7.10', modids: ['sodium'] },
      cookie,
    });
    const res = await call('GET', '/api/modpacks?gameVersion=1.16.1');
    assert.equal(res.status, 200);
    const items = (res.body as { items: { title: string; modids: string[]; modCount: number }[] })
      .items;
    assert.deepEqual(
      items.map((i) => i.title),
      ['v161'],
    );
    assert.deepEqual(items[0]?.modids, ordered);
    assert.equal(items[0]?.modCount, 3);
    assert.equal((res.body as { total: number }).total, 1);
  });

  it('两条读端点都带 no-store（管理数据不许被缓存住）', async () => {
    const res = await app.request('/api/modpacks?gameVersion=1.16.1', {
      headers: { origin: SITE.productionOrigin },
    });
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  it('取一个不存在的包 ⇒ 404', async () => {
    assert.equal((await call('GET', '/api/modpacks/no-such-id')).status, 404);
  });

  /*
   * ★ `GET /api/modpacks/:id` 的 **200** 那一条（原来这个 describe 里只有 404）。
   *
   * 为什么必须有：这条端点是**桌面主进程按 packId 取包定义**要走的路
   * （架构那一句"这个包里有哪些 mod 只有一处真相"就落在这里）——
   * 只测 404 的话，把 handler 写成恒 `not_found`、或者 `toWire` 漏字段，
   * 整套测试仍然全绿，而客户端拿到的是一个取不到的包。
   */
  it('★ 建包之后 `GET /:id` ⇒ 200 + 完整形状（桌面主进程按 packId 取定义走的就是这条）', async () => {
    const cookie = await makeUser('admin');
    const created = await call('POST', '/api/modpacks', { json: PACK, cookie });
    assert.equal(created.status, 201);
    const id = (created.body as { pack?: { id: string } }).pack?.id ?? '';
    assert.notEqual(id, '', '建包必须回一个 id');

    const res = await call('GET', `/api/modpacks/${id}`);
    assert.equal(res.status, 200, '按 id 取定义必须回 200（不是 404）');
    const wire = res.body as {
      id?: string;
      title?: string;
      description?: string;
      gameVersion?: string;
      modids?: string[];
      hot?: boolean;
      modCount?: number;
    };
    assert.equal(wire.id, id);
    assert.equal(wire.title, PACK.title);
    assert.equal(wire.description, PACK.description);
    assert.equal(wire.gameVersion, PACK.gameVersion);
    assert.deepEqual(wire.modids, PACK.modids, 'modids 必须保序原样回来');
    assert.equal(wire.hot, false, '刚建的包不是热门');
    assert.equal(wire.modCount, PACK.modids.length);
    /* ⚠️ 断"键在不在"而**不是**断键集合相等：实现里 `toWire` 是 `{...pack}` ⇒ 还带
       `createdAt` / `updatedAt`（brief 那张形状表没列它们）。断相等会把一个**加法**判成红。 */
    for (const key of ['id', 'title', 'description', 'gameVersion', 'modids', 'hot', 'modCount']) {
      assert.equal(key in res.body, true, `按 id 读回来的形状缺 ${key}`);
    }
  });
});

describe('★ B2 审计：四条各一条，pack.update 只记变了的那几格', () => {
  it('建/改/删/热门各一条', async () => {
    const cookie = await makeUser('admin');
    const created = await call('POST', '/api/modpacks', { json: PACK, cookie });
    const id = (created.body as { pack?: { id: string } }).pack?.id ?? '';
    /*
     * ★ **先断 create 那一条，再清表**（顺序是判据的一部分）。
     *
     * 原来这里是"建完之后先 `DELETE FROM audit_log`、再从改/删/热门三条断言"——
     * 于是 `routes/modpacks.ts` 里 `POST /` 那条 `writeAudit({ action: 'pack.create' })`
     * **整条删掉也全绿**，而这一节的标题写着"建/改/删/热门各一条"。
     * ⇒ 现在按 action 过滤着现读一次：写漏 / 写错 entity_id 都会在这里红。
     *   （`makeUser` 自己会写 register + login 两条 ⇒ 不能直接断整个表，见下面那句清理。）
     */
    const createdAudit = getDb()
      .prepare(
        "SELECT action, entity_type, entity_id FROM audit_log WHERE action = 'pack.create' ORDER BY created_at, rowid",
      )
      .all() as unknown as { action: string; entity_type: string; entity_id: string | null }[];
    assert.equal(createdAudit.length, 1, '建包必须写**一条** pack.create 审计');
    assert.equal(createdAudit[0]?.entity_type, 'modpack');
    assert.equal(createdAudit[0]?.entity_id, id, 'pack.create 的 entity_id 必须是返回的那个 id');
    /*
     * ⚠️ `makeUser` 自己会写 `register` + `login` 两条审计 ⇒ 不清的话下面那条
     *    deepEqual 必红，而红的原因与"审计写得对不对"完全无关（假失败）。
     */
    getDb().exec('DELETE FROM audit_log');
    await call('PATCH', `/api/modpacks/${id}`, { json: { ...PACK, title: '改过' }, cookie });
    await call('PATCH', `/api/admin/modpacks/${id}/hot`, { json: { hot: true }, cookie });
    await call('DELETE', `/api/modpacks/${id}`, { cookie });
    const rows = getDb()
      // `created_at, rowid`：三条写入可能落在同一毫秒，只按 created_at 排的话平局顺序未定义
      .prepare(
        'SELECT action, entity_type, entity_id, reason FROM audit_log ORDER BY created_at, rowid',
      )
      .all() as unknown as {
      action: string;
      entity_type: string;
      entity_id: string | null;
      reason: string | null;
    }[];
    assert.deepEqual(
      rows.map((r) => r.action),
      ['pack.update', 'pack.hot', 'pack.delete'],
    );
    // ★ 只记变了的那几格：改标题那一条的 reason 里必须**有** title、**没有** modids（没动它）
    assert.match(String(rows[0]?.reason), /title/);
    assert.equal(String(rows[0]?.reason).includes('modids'), false, '没动的字段不许抄进去');
    assert.equal(rows[1]?.entity_id, id);
  });
});

describe('★ B2：`content/**` 一个字节都没动（spec 断言 5）', () => {
  it('跑完这些写操作后，两份文件的 sha256 与文件跑之前相同，且没有 content/modpacks*', async () => {
    const files = ['content/mod-catalog.json', 'content/mod-overrides.json'].map((rel) =>
      join(ROOT, rel),
    );
    const fingerprint = (): string[] =>
      files.map((file) => createHash('sha256').update(readFileSync(file)).digest('hex'));
    const before = fingerprint();
    const cookie = await makeUser('admin');
    const created = await call('POST', '/api/modpacks', { json: PACK, cookie });
    const id = (created.body as { pack?: { id: string } }).pack?.id ?? '';
    await call('PATCH', `/api/modpacks/${id}`, { json: { ...PACK, title: 'x' }, cookie });
    await call('DELETE', `/api/modpacks/${id}`, { cookie });
    assert.deepEqual(fingerprint(), before, '写操作不许碰 `content/**`');
    assert.equal(
      readdirSync(join(ROOT, 'content')).some((name) => name.startsWith('modpacks')),
      false,
    );
  });
});
