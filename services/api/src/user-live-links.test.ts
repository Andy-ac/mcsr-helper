/**
 * 014 + ④ 服务端：私人直播链接（`user_live_links` / `/api/live/mine`）。
 *
 * ---------------------------------------------------------------------------
 * 这个文件里最要紧的三条
 * ---------------------------------------------------------------------------
 * 1. **越权隔离**（acceptance #3/#4）：别人的行必须**看不见、改不动、删不掉**。
 *    这里断言的是**真跑**的结果 —— 不只是"路由存在"，而是
 *    "A 打过去拿到 404，而且 B 那一行在库里**逐字段没变**"。
 *    为什么是这个形状：私人数据连"存在性"都不该泄漏，所以一律 404（**不是 403**）；
 *    而"改不动"必须落到**数据**上才有意义（回一个 404 却把行改了是最坏的情况）。
 *
 * 2. **入参宽松、存储严格**（acceptance #5）：`{ url, title? }` 进来，
 *    服务端用 `parseLiveLink` 归一化后**只落库标识** —— 库里 `handle` 那一列
 *    **永远不可能是一条链接**。这条不变量正是"以后能按平台拼链接"的前提。
 *
 * 3. **不新增能力、不要求邮箱验证**（acceptance #2）：桌面上的"权限"很容易
 *    被顺手加严（加一个 `live.submit`、加一道 `requireVerified`），
 *    而两者在这个功能上都是错的（私人数据不是公开内容）。
 *    所以这里有两条**真跑**的断言：未登录 401；**登录但邮箱未验证**照样 200/201。
 */

import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.MCSR_MAIL_DRIVER = 'console';
process.env.MCSR_SCRYPT_TEST_PARAMS = 'N=1024,r=8,p=1';

const { app } = await import('./index');
const { closeDb, getDb } = await import('./db');
const { resetAll } = await import('./auth/ratelimit');
const { SESSION_COOKIE } = await import('./auth/middleware');
const { generateToken, hashToken, SESSION_TTL_MS } = await import('./auth/tokens');
const { createSession } = await import('./users');
const { SITE } = await import('@mcsr/shared');
const { CAPABILITIES } = await import('@mcsr/shared/permissions');
const { LiveChannelInputSchema } = await import('@mcsr/shared/live');
const { m014UserLiveLinks } = await import('./db/migrations/014_user_live_links');

const PASSWORD = 'a good long passphrase';

after(() => closeDb());
beforeEach(() => {
  resetAll();
  // 只清业务数据，不动 schema —— 这一组里有几条测的就是 schema 本身
  getDb().exec('DELETE FROM user_live_links');
  getDb().exec('DELETE FROM live_channels');
});

async function call(
  method: string,
  path: string,
  options: { json?: unknown; cookie?: string } = {},
): Promise<{
  status: number;
  body: Record<string, unknown>;
  text: string;
  cacheControl: string | null;
}> {
  const headers: Record<string, string> = { origin: SITE.productionOrigin };
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
    text,
    cacheControl: response.headers.get('cache-control'),
    body: (() => {
      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        return {};
      }
    })(),
  };
}

let seq = 0;

/** 注册一个账号并把邮箱标成已验证，然后登录 —— 拿到一个"正常用户"的会话。 */
async function makeUser(role: 'user' | 'editor' = 'user') {
  seq += 1;
  const email = `userlive${String(seq)}.${Date.now()}@example.com`;
  await call('POST', '/api/auth/register', {
    json: { email, password: PASSWORD, displayName: `私人${String(seq)}`, locale: 'zh-CN' },
  });
  getDb()
    .prepare('UPDATE users SET email_verified_at = ?, role = ? WHERE email = ?')
    .run(Date.now(), role, email);
  return { email, id: userIdOf(email), cookie: await loginCookie(email) };
}

/** 注册一个账号，**不验证邮箱**，然后**在会话层**给它一个登录态。 */
async function makeUnverifiedUser() {
  seq += 1;
  const email = `userlive-unverified${String(seq)}.${Date.now()}@example.com`;
  await call('POST', '/api/auth/register', {
    json: { email, password: PASSWORD, displayName: `未验证${String(seq)}`, locale: 'zh-CN' },
  });

  const row = getDb()
    .prepare('SELECT id, email_verified_at FROM users WHERE email = ?')
    .get(email) as { id: string; email_verified_at: number | null } | undefined;
  assert.ok(row, '注册之后应当能在库里查到账号');
  /*
   * ⚠️ 前提断言：**登录接口对未验证邮箱的账号是 403**（routes/auth.ts:331），
   *    所以"登录着但邮箱没验证"这个状态**没法通过正常登录流程**造出来。
   *    这里直接在会话层造一个 —— 那不是绕过被测代码，而是**精确地**造出
   *    "requireAuth 能过、requireVerified 过不了"的那一格，用来证明
   *    `/api/live/mine` 的中间件链里**没有**邮箱验证那道闸门。
   */
  assert.equal(row.email_verified_at, null, '前提：注册出来的账号邮箱应当是未验证的');
  const refused = await call('POST', '/api/auth/login', { json: { email, password: PASSWORD } });
  assert.equal(refused.status, 403, '前提：未验证邮箱的账号登录会被拒（这才是那个状态难造的原因）');

  const token = generateToken();
  const now = Date.now();
  createSession({
    tokenHash: hashToken(token),
    userId: row.id,
    expiresAt: now + SESSION_TTL_MS,
    userAgent: null,
    now,
  });
  return { email, id: row.id, cookie: `${SESSION_COOKIE}=${token}` };
}

function userIdOf(email: string): string {
  const row = getDb().prepare('SELECT id FROM users WHERE email = ?').get(email) as
    | { id: string }
    | undefined;
  return row?.id ?? '';
}

/**
 * 登录并取出会话 cookie。
 *
 * ⚠️ cookie 在 `set-cookie` **响应头**上，而上面的 `call` 只回 body ——
 *    所以这一条要单独走一次 `app.request`（和 live.test.ts 里同样的做法）。
 */
async function loginCookie(email: string): Promise<string> {
  const response = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { origin: SITE.productionOrigin, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  assert.equal(response.status, 200, '前提：邮箱已验证的账号应当能登录');
  const setCookie = response.headers.getSetCookie?.()[0] ?? '';
  return setCookie.split(';')[0] ?? '';
}

/** `SELECT COUNT(*) n ...` → number（`.get()` 回 unknown，所以收成一处断言）。 */
const countOf = (sql: string, ...args: unknown[]): number =>
  Number(
    (
      getDb()
        .prepare(sql)
        .get(...(args as never[])) as { n: number } | undefined
    )?.n ?? 0,
  );

/** `SELECT ...` 一行的原始形状（断言"逐字段没变"用）。 */
function rowOf(id: string): Record<string, unknown> {
  const row = getDb().prepare('SELECT * FROM user_live_links WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  assert.ok(row, `库里应当有 ${id} 这一行`);
  // ⚠️ 展开成普通对象：node:sqlite 的行对象原型不是 Object.prototype，deepEqual 会比较原型
  return { ...row };
}

const itemsOf = (body: Record<string, unknown>): Array<Record<string, unknown>> =>
  (body.items ?? []) as Array<Record<string, unknown>>;

const linkOf = (body: Record<string, unknown>): Record<string, unknown> =>
  (body.link ?? {}) as Record<string, unknown>;

// ---------------------------------------------------------------------------
// 迁移 014
// ---------------------------------------------------------------------------

describe('★ 014：user_live_links 建出来了，而 live_channels 一动没动', () => {
  it('列 / 索引 / 外键 / 迁移编号 都在', () => {
    const cols = getDb()
      .prepare('PRAGMA table_info(user_live_links)')
      .all()
      .map((c) => c.name);

    for (const name of [
      'id',
      'user_id',
      'url',
      'platform',
      'handle',
      'live_video_id',
      'title',
      'created_at',
      'updated_at',
    ]) {
      assert.ok(cols.includes(name), `user_live_links 缺列 ${name}`);
    }

    const indexes = getDb()
      .prepare(
        "SELECT name FROM sqlite_master WHERE tbl_name='user_live_links' AND type='index' AND sql IS NOT NULL",
      )
      .all()
      .map((r) => r.name);
    assert.deepEqual(
      indexes,
      ['idx_user_live_user'],
      '按 (user_id, created_at DESC) 的那条索引必须在',
    );

    const fks = getDb().prepare('PRAGMA foreign_key_list(user_live_links)').all();
    assert.ok(
      fks.some((fk) => fk.table === 'users' && fk.on_delete === 'CASCADE'),
      'user_id 必须指向 users 且是 CASCADE（账号删掉之后私人数据不该留在库里）',
    );

    const applied = getDb()
      .prepare('SELECT name FROM _migrations ORDER BY name')
      .all()
      .map((r) => r.name);
    assert.ok(applied.includes('014_user_live_links'), '_migrations 里必须有 014');
  });

  it('★ platform 只允许三个平台或 NULL；**故意没有** UNIQUE(platform, handle)', async () => {
    // ⚠️ 外键指向 users，所以必须用**真账号**的 id（随手编一个会撞 FOREIGN KEY）
    const u = await makeUser();
    const insert = (id: string, platform: string | null) =>
      getDb()
        .prepare(
          `INSERT INTO user_live_links (id, user_id, url, platform, handle, created_at, updated_at)
           VALUES (?, ?, 'https://www.twitch.tv/someone', ?, 'someone', 0, 0)`,
        )
        .run(id, u.id, platform);

    assert.doesNotThrow(() => insert('a', 'twitch'));
    assert.doesNotThrow(() => insert('b', null), 'platform 可空：解析不出来的链接也要能存');
    assert.throws(() => insert('c', 'kick'), /CHECK/i, 'CHECK 挡掉不认识的平台');

    // 同一 (platform, handle) 两条都允许 —— 个人化模型下"判重"不再是问题（D4b.2）
    assert.doesNotThrow(
      () => insert('d', 'twitch'),
      '同一个人加两条同一个频道必须能存（没有 UNIQUE(platform, handle)）',
    );
  });

  it('删掉账号 → 他的私人行跟着走（CASCADE 真的生效）', async () => {
    const u = await makeUser();
    const created = await call('POST', '/api/live/mine', {
      json: { url: 'https://www.twitch.tv/Someone' },
      cookie: u.cookie,
    });
    assert.equal(created.status, 201);
    const id = String(linkOf(created.body).id);

    getDb().prepare('DELETE FROM users WHERE id = ?').run(u.id);
    assert.equal(
      countOf('SELECT COUNT(*) n FROM user_live_links WHERE id = ?', id),
      0,
      '账号没了，他的私人链接不该留在库里',
    );
  });

  it('★★ live_channels 没被重建、也没被加 pending 态（acceptance #1）', () => {
    /*
     * 「不重建」这件事事后**观察不到**（重建完的表看起来一样），所以这里断言
     * **能守的那一半**：
     *   ① 公开表的列一个不多一个不少；
     *   ② 014 的 SQL **语句**里不出现 `live_channels`，也没有 `ALTER` / `DROP` / `RENAME`
     *      （注释里提到它只是为了说明"为什么不动它"，所以先把注释去掉再判）；
     *   ③ 状态 CHECK 仍然拒绝 `pending` —— "不给它加 pending"就是这条。
     */
    const cols = getDb()
      .prepare('PRAGMA table_info(live_channels)')
      .all()
      .map((c) => c.name)
      .sort();
    /*
     * ⚠️ **2026-09-13：这一行加过一项 `'tags'`，而它不影响这条测试要问的问题。**
     *    015 给 `live_channels` 加了一列标签（用户要求「可输入多个标签」）——
     *    那是**另一个迁移、一次 ADD COLUMN**，不是重建，也不属于 014 的验收范围。
     *    ⇒ 判据仍然是"**014 之后这张表的列集合是确定的**"：多出 `pending` 之类的
     *      （重建才会干的事）照样会被这条抓住。下面 ③ 那句状态 CHECK 才是
     *      "没给它加 pending" 的真正守卫。
     */
    assert.deepEqual(cols, [
      'created_at',
      'display_name',
      'embed_channel',
      'handle',
      'id',
      'live_video_id',
      'note',
      'platform',
      'sort_order',
      'status',
      'tags',
      'updated_at',
    ]);

    const statementsOnly = m014UserLiveLinks
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/--[^\n]*/g, ' ');

    assert.deepEqual(
      [...statementsOnly.matchAll(/CREATE\s+TABLE\s+(\w+)/gi)].map((m) => m[1]),
      ['user_live_links'],
      '014 只建这一张表',
    );
    assert.equal(
      /\b(alter|drop|rename)\b/i.test(statementsOnly),
      false,
      '014 必须是纯建表 / 建索引（不做重建，因而留在事务里、失败即回滚）',
    );
    assert.equal(
      /live_channels/i.test(statementsOnly),
      false,
      '014 的语句一个字都不碰公开名单那张表',
    );
    assert.equal(/pending/i.test(statementsOnly), false, '014 里不该出现 pending');

    assert.throws(
      () =>
        getDb()
          .prepare(
            `INSERT INTO live_channels (id, platform, handle, display_name, status, sort_order, created_at, updated_at)
             VALUES ('y', 'twitch', 'someone', 'n', 'pending', 1, 0, 0)`,
          )
          .run(),
      /CHECK/i,
      '公开名单是编辑维护的，刻意没有 pending 态 —— 这条 014 一个字都没改它',
    );
  });

  it('★ 没有新增任何能力名（尤其没有 live.submit）', () => {
    const liveCaps = CAPABILITIES.filter((c) => c.startsWith('live.'));
    assert.deepEqual(
      liveCaps,
      ['live.manage'],
      '直播相关的能力只有 live.manage 一个：私人列表走 requireAuth，公开名单一个字不改（D4b.1）',
    );
  });
});

// ---------------------------------------------------------------------------
// 权限形状
// ---------------------------------------------------------------------------

describe('★ /api/live/mine 的权限形状', () => {
  it('未登录：四个端点一律 401（界面隐藏不是安全边界）', async () => {
    const mine = { url: 'https://www.twitch.tv/Someone' };
    assert.equal((await call('GET', '/api/live/mine')).status, 401);
    assert.equal((await call('POST', '/api/live/mine', { json: mine })).status, 401);
    assert.equal((await call('PATCH', '/api/live/mine/x', { json: { title: 't' } })).status, 401);
    assert.equal((await call('DELETE', '/api/live/mine/x')).status, 401);
  });

  it('★ 登录但**邮箱未验证**照样能用四个端点（不要求邮箱验证、不要求任何能力）', async () => {
    const u = await makeUnverifiedUser();

    const created = await call('POST', '/api/live/mine', {
      json: { url: 'https://www.twitch.tv/Someone', title: '我的链接' },
      cookie: u.cookie,
    });
    assert.equal(created.status, 201, `未验证邮箱不该被挡：${created.text}`);
    const id = String(linkOf(created.body).id);

    assert.equal((await call('GET', '/api/live/mine', { cookie: u.cookie })).status, 200);
    assert.equal(
      (await call('PATCH', `/api/live/mine/${id}`, { json: { title: '改过' }, cookie: u.cookie }))
        .status,
      200,
    );
    assert.equal((await call('DELETE', `/api/live/mine/${id}`, { cookie: u.cookie })).status, 200);
  });

  it('普通用户（不是编辑）就是这一组端点的目标用户', async () => {
    const plain = await makeUser();
    const created = await call('POST', '/api/live/mine', {
      json: { url: 'https://live.bilibili.com/12345' },
      cookie: plain.cookie,
    });
    assert.equal(created.status, 201, '贴自己的链接不需要 live.manage');
    assert.equal(linkOf(created.body).platform, 'bilibili');
  });

  it('响应形状就是契约里那四个（items / ok+link / ok+id）', async () => {
    const u = await makeUser();
    const created = await call('POST', '/api/live/mine', {
      json: { url: 'https://www.twitch.tv/Someone', title: 'x' },
      cookie: u.cookie,
    });
    assert.equal(created.status, 201);
    const id = String(linkOf(created.body).id);

    const list = await call('GET', '/api/live/mine', { cookie: u.cookie });
    assert.equal(list.status, 200);
    assert.equal(itemsOf(list.body).length, 1);
    assert.equal(itemsOf(list.body)[0]?.id, id);

    const patched = await call('PATCH', `/api/live/mine/${id}`, {
      json: { title: 'y' },
      cookie: u.cookie,
    });
    assert.equal(patched.status, 200);
    assert.equal(linkOf(patched.body).title, 'y');

    const deleted = await call('DELETE', `/api/live/mine/${id}`, { cookie: u.cookie });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.ok, true);
    assert.equal(deleted.body.id, id);
  });
});

// ---------------------------------------------------------------------------
// 越权隔离（acceptance #3 / #4）
// ---------------------------------------------------------------------------

describe('★★ 越权隔离：别人的行看不见、改不动、删不掉', () => {
  it('★★ A 对 B 的行一律 404（不是 403），而且 B 的行**逐字段没变**', async () => {
    const a = await makeUser();
    const b = await makeUser();

    const created = await call('POST', '/api/live/mine', {
      json: { url: 'https://www.twitch.tv/Someone', title: 'B 自己的行' },
      cookie: b.cookie,
    });
    assert.equal(created.status, 201);
    const bId = String(linkOf(created.body).id);
    const before = rowOf(bId);

    // ① 看不到：A 的列表里没有 B 那一行（连 id 都不出现）
    const aList = await call('GET', '/api/live/mine', { cookie: a.cookie });
    assert.equal(aList.status, 200);
    assert.deepEqual(itemsOf(aList.body), [], 'A 的列表必须是空的 —— 他一条都没贴过');

    // ② 改不动：404（**不是 403** —— 否则就泄漏了"这一行存在"）
    const patch = await call('PATCH', `/api/live/mine/${bId}`, {
      json: { url: 'https://www.twitch.tv/hacked', title: 'hacked' },
      cookie: a.cookie,
    });
    assert.equal(patch.status, 404, `A 改 B 的行必须是 404：${patch.text}`);
    assert.notEqual(patch.status, 403, '404 而不是 403：私人数据连存在性都不该泄漏');

    // ③ 删不掉
    const del = await call('DELETE', `/api/live/mine/${bId}`, { cookie: a.cookie });
    assert.equal(del.status, 404, `A 删 B 的行必须是 404：${del.text}`);

    /*
     * ★ 这一条才是"改不动 / 删不掉"的**证据**：上面两个 404 只说明"回了 404"，
     *   而真正要守的是**数据没被碰**（回 404 却把行改了是最坏的情况）。
     */
    assert.deepEqual(rowOf(bId), before, 'A 的两下之后，B 那一行必须逐字段原样');

    // ④ 读 B 的行也没有门路：契约里只有四条端点（没有 GET /live/mine/:id），
    //    所以这条请求命中 404（not_found），永远不可能拿到 403 或 B 的数据
    const readOther = await call('GET', `/api/live/mine/${bId}`, { cookie: a.cookie });
    assert.equal(readOther.status, 404);

    // ⑤ 反过来：B 自己照样看得见、改得动
    assert.equal(
      itemsOf((await call('GET', '/api/live/mine', { cookie: b.cookie })).body).length,
      1,
    );
    assert.equal(
      (
        await call('PATCH', `/api/live/mine/${bId}`, {
          json: { title: 'B 改自己的' },
          cookie: b.cookie,
        })
      ).status,
      200,
    );
  });

  it('A 贴的行也不在 B 的列表里（两个方向都要成立）', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await call('POST', '/api/live/mine', {
      json: { url: 'https://www.youtube.com/@A' },
      cookie: a.cookie,
    });
    assert.equal(
      itemsOf((await call('GET', '/api/live/mine', { cookie: b.cookie })).body).length,
      0,
    );
    assert.equal(
      itemsOf((await call('GET', '/api/live/mine', { cookie: a.cookie })).body).length,
      1,
    );
  });

  it('别人的 id 不存在时也一模一样是 404（不区分"不是你的"和"根本没有"）', async () => {
    const a = await makeUser();
    assert.equal(
      (
        await call('PATCH', '/api/live/mine/does-not-exist', {
          json: { title: 'x' },
          cookie: a.cookie,
        })
      ).status,
      404,
    );
    assert.equal(
      (await call('DELETE', '/api/live/mine/does-not-exist', { cookie: a.cookie })).status,
      404,
    );
  });
});

// ---------------------------------------------------------------------------
// no-store（acceptance #6）
// ---------------------------------------------------------------------------

describe('★ /api/live/mine 一律 no-store（因人而异，不许沿用公开那份缓存）', () => {
  it('四个端点的响应都是 no-store，且不出现 public, max-age=60', async () => {
    const u = await makeUser();
    const created = await call('POST', '/api/live/mine', {
      json: { url: 'https://www.twitch.tv/Someone' },
      cookie: u.cookie,
    });
    const id = String(linkOf(created.body).id);

    const responses = [
      await call('GET', '/api/live/mine', { cookie: u.cookie }),
      created,
      await call('PATCH', `/api/live/mine/${id}`, { json: { title: 'x' }, cookie: u.cookie }),
      await call('DELETE', `/api/live/mine/${id}`, { cookie: u.cookie }),
    ];

    for (const response of responses) {
      assert.equal(
        response.cacheControl,
        'no-store',
        `必须是 no-store，实际是 ${response.cacheControl}`,
      );
      assert.equal(
        response.cacheControl?.includes('public'),
        false,
        '私人列表绝不能沿用公开名单那套 public, max-age=60',
      );
    }

    // 连 401 也是 no-store（全局中间件给的，别哪天被顺手改掉）
    assert.equal((await call('GET', '/api/live/mine')).cacheControl, 'no-store');
  });

  it('公开名单那条仍然是公开缓存（两组不共用缓存规则）', async () => {
    const pub = await call('GET', '/api/live');
    assert.equal(pub.status, 200);
    assert.ok(
      pub.cacheControl?.includes('public'),
      `公开名单应当仍是公开缓存：${String(pub.cacheControl)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// 入参与归一化（acceptance #5）
// ---------------------------------------------------------------------------

describe('★ 入参形状：只有 { url, title? }，平台与标识全部由服务端推导', () => {
  it('缺 url / 空 url / 太长 / 多余字段 一律 400（.strict()）', async () => {
    const u = await makeUser();
    const bad: unknown[] = [
      {},
      { url: '' },
      { url: '   ' },
      { url: `https://www.twitch.tv/${'x'.repeat(600)}` },
      { url: 'https://www.twitch.tv/Someone', platform: 'twitch' },
      { url: 'https://www.twitch.tv/Someone', handle: 'Someone' },
      { url: 'https://www.twitch.tv/Someone', owner: 'me' },
      { title: '没有链接' },
    ];
    for (const payload of bad) {
      const res = await call('POST', '/api/live/mine', { json: payload, cookie: u.cookie });
      assert.equal(res.status, 400, `${JSON.stringify(payload)} 应当被拒：${res.text}`);
      assert.equal(res.body.error, 'invalid_input');
    }
    assert.equal(countOf('SELECT COUNT(*) n FROM user_live_links'), 0, '被拒的请求不该留下任何行');
  });

  it('★ 一条链接 → 只落库**标识**（`handle` 列里绝不会是链接）', async () => {
    const u = await makeUser();

    const cases = [
      { url: 'https://www.twitch.tv/Someone', platform: 'twitch', handle: 'Someone' },
      { url: 'twitch.tv/Someone', platform: 'twitch', handle: 'Someone' },
      { url: 'https://m.twitch.tv/Someone/', platform: 'twitch', handle: 'Someone' },
      { url: 'https://www.youtube.com/@Someone', platform: 'youtube', handle: '@Someone' },
      {
        url: 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv',
        platform: 'youtube',
        handle: 'UCabcdefghijklmnopqrstuv',
      },
      { url: 'https://live.bilibili.com/12345', platform: 'bilibili', handle: '12345' },
      { url: 'https://space.bilibili.com/12345', platform: 'bilibili', handle: '12345' },
      // 正在直播的那一场：链接里**没有**频道标识 ⇒ handle 为 NULL、视频 ID 有值
      {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        platform: 'youtube',
        handle: null,
        liveVideoId: 'dQw4w9WgXcQ',
      },
    ];

    for (const expected of cases) {
      const res = await call('POST', '/api/live/mine', {
        json: { url: expected.url },
        cookie: u.cookie,
      });
      assert.equal(res.status, 201, `${expected.url} 应当收下：${res.text}`);
      const link = linkOf(res.body);
      assert.equal(link.platform, expected.platform, `${expected.url} 的平台`);
      assert.equal(link.handle, expected.handle, `${expected.url} 的标识（必须是归一化后的）`);
      if ('liveVideoId' in expected) assert.equal(link.liveVideoId, expected.liveVideoId);

      // 库里那一行：handle 只可能是 NULL 或标识，**绝不是链接**
      const row = rowOf(String(link.id));
      assert.notEqual(row.url, row.handle, `${expected.url}：url 与 handle 不可能是同一个东西`);
      if (row.handle !== null) {
        assert.equal(
          /^https?:\/\//i.test(String(row.handle)),
          false,
          `handle 列里出现了链接：${String(row.handle)}`,
        );
      }
    }
  });

  it('★ 认不出的链接**照样收**（201）：原样保留 url，platform/handle 为 NULL', async () => {
    const u = await makeUser();
    for (const raw of [
      'https://example.com/some/stream', // 我们能打开的链接，但不认识的平台
      '不是链接也不是标识', // **没有空格的中文**：不是标识（白名单只认 ASCII 的标识字符）
      '这是 一个句子', // 有空格 ⇒ 更不是标识
      'javascript:alert(1)', // 非 http(s) 协议 ⇒ 认不出（绝不进 href）
      'ftp://files.example.com/x',
    ]) {
      const res = await call('POST', '/api/live/mine', {
        json: { url: raw, title: '认不出' },
        cookie: u.cookie,
      });
      assert.equal(res.status, 201, `${raw} 应当被收下（解析失败不是错误）：${res.text}`);
      const link = linkOf(res.body);
      assert.equal(link.platform, null, `${raw} 不该被判出平台`);
      assert.equal(link.handle, null, `${raw} 不该被判出标识`);
      assert.equal(link.url, raw, '用户原样粘贴的那条链接必须留下（D4b.2）');
    }
    const publicList = await call('GET', '/api/live');
    assert.deepEqual(
      itemsOf(publicList.body),
      [],
      '私人链接永远不进公开名单（公开名单只由编辑维护）',
    );
  });

  it('★ 裸标识：是标识、但判不出平台（platform 为 NULL，handle 保留原样）', async () => {
    const u = await makeUser();
    const res = await call('POST', '/api/live/mine', {
      json: { url: '@Someone' },
      cookie: u.cookie,
    });
    assert.equal(res.status, 201);
    const link = linkOf(res.body);
    assert.equal(link.platform, null, '裸标识判不出平台 —— 这一档只出现在私人列表');
    assert.equal(link.handle, '@Someone');
  });

  it('★ 判重不存在：同一个人加两条同一个频道都成功（没有 409）', async () => {
    const u = await makeUser();
    const first = await call('POST', '/api/live/mine', {
      json: { url: 'https://www.twitch.tv/Someone' },
      cookie: u.cookie,
    });
    const second = await call('POST', '/api/live/mine', {
      json: { url: 'https://www.twitch.tv/Someone' },
      cookie: u.cookie,
    });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201, '个人化模型下"同一个人加两条同一个频道"是允许的（D4b.2）');
    assert.equal(
      itemsOf((await call('GET', '/api/live/mine', { cookie: u.cookie })).body).length,
      2,
    );
  });
});

// ---------------------------------------------------------------------------
// PATCH 的细节
// ---------------------------------------------------------------------------

describe('★ PATCH：改链接会重解析，只改名字不动平台；空 patch 是 400', () => {
  it('改 url → platform/handle/liveVideoId 跟着重算（不会留下旧平台的残影）', async () => {
    const u = await makeUser();
    const created = await call('POST', '/api/live/mine', {
      json: { url: 'https://www.twitch.tv/Someone', title: 't' },
      cookie: u.cookie,
    });
    const id = String(linkOf(created.body).id);

    const patched = await call('PATCH', `/api/live/mine/${id}`, {
      json: { url: 'https://live.bilibili.com/999' },
      cookie: u.cookie,
    });
    assert.equal(patched.status, 200);
    const link = linkOf(patched.body);
    assert.equal(link.platform, 'bilibili');
    assert.equal(link.handle, '999');
    assert.equal(link.url, 'https://live.bilibili.com/999');

    const row = rowOf(id);
    assert.equal(row.platform, 'bilibili');
    assert.equal(row.handle, '999');
    assert.equal(row.title, 't', '没传的字段不动');
  });

  it('只改 title 时平台/标识原样不动；title: null 是清空', async () => {
    const u = await makeUser();
    const created = await call('POST', '/api/live/mine', {
      json: { url: 'https://www.twitch.tv/Someone', title: '原名' },
      cookie: u.cookie,
    });
    const id = String(linkOf(created.body).id);

    const renamed = await call('PATCH', `/api/live/mine/${id}`, {
      json: { title: '新名' },
      cookie: u.cookie,
    });
    assert.equal(linkOf(renamed.body).platform, 'twitch');
    assert.equal(linkOf(renamed.body).handle, 'Someone');
    assert.equal(linkOf(renamed.body).title, '新名');

    const cleared = await call('PATCH', `/api/live/mine/${id}`, {
      json: { title: null },
      cookie: u.cookie,
    });
    assert.equal(cleared.status, 200);
    assert.equal(linkOf(cleared.body).title, null, 'title: null 是"清空"，与"没传"不同');
  });

  it('空 patch / 多余字段 → 400', async () => {
    const u = await makeUser();
    const created = await call('POST', '/api/live/mine', {
      json: { url: 'https://www.twitch.tv/Someone' },
      cookie: u.cookie,
    });
    const id = String(linkOf(created.body).id);

    assert.equal(
      (await call('PATCH', `/api/live/mine/${id}`, { json: {}, cookie: u.cookie })).status,
      400,
      '什么都没改的 PATCH 是客户端 bug，不是"成功"',
    );
    assert.equal(
      (
        await call('PATCH', `/api/live/mine/${id}`, {
          json: { title: 'x', platform: 'twitch' },
          cookie: u.cookie,
        })
      ).status,
      400,
    );
    assert.equal(
      (await call('PATCH', `/api/live/mine/${id}`, { json: { url: '' }, cookie: u.cookie })).status,
      400,
    );
  });
});

// ---------------------------------------------------------------------------
// 公开名单那侧的入参形状（acceptance #5 的另一半）
// ---------------------------------------------------------------------------

describe('★ 公开名单：handle 一个字段收"标识或链接"，服务端归一化后只落标识', () => {
  it('入参里**没有**独立的 url 字段（(i) 方案已否决）', () => {
    const parsed = LiveChannelInputSchema.safeParse({
      platform: 'youtube',
      handle: 'https://www.youtube.com/@Someone',
      displayName: '某位选手',
      url: 'https://www.youtube.com/@Someone',
    });
    assert.ok(parsed.success, '粘一条频道页链接必须能过');
    assert.equal(
      'url' in parsed.data,
      false,
      '入参形状里没有独立的 url 字段，也没有"恰有一个"规则（F29 的 (i) 已否决）',
    );
    assert.equal(parsed.data.handle, '@Someone', '归一化后**只留标识**');
  });

  it('★ 编辑粘链接 → 201，而且落库的是**标识**（不是链接）', async () => {
    const editor = await makeUser('editor');
    const created = await call('POST', '/api/live', {
      json: {
        platform: 'youtube',
        handle: 'https://www.youtube.com/@Someone',
        displayName: '某位选手',
      },
      cookie: editor.cookie,
    });
    assert.equal(created.status, 201, created.text);
    const channel = created.body.channel as Record<string, unknown>;
    assert.equal(channel.handle, '@Someone');

    const row = getDb()
      .prepare('SELECT handle FROM live_channels WHERE id = ?')
      .get(String(channel.id)) as { handle: string };
    assert.equal(row.handle, '@Someone', '库里必须只有标识');
  });

  it('链接指向的平台与选的平台不一致 → 400 invalid_input（字段级 issue）', async () => {
    const editor = await makeUser('editor');
    const res = await call('POST', '/api/live', {
      json: { platform: 'twitch', handle: 'https://www.youtube.com/@Someone', displayName: 'x' },
      cookie: editor.cookie,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_input');
    assert.equal(
      (res.body.issues as Array<{ field: string }>)[0]?.field,
      'handle',
      '错要指在 handle 这一栏上',
    );
  });

  it('认不出的位置 / 只有视频 ID 的链接 / 带空格的标识 → 400', async () => {
    const editor = await makeUser('editor');
    for (const handle of [
      'https://example.com/someone', // 我们不认识的网站
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ', // 只有"这一场"的视频 ID，没有频道
      '@a b', // 标识里不能有空格
      'javascript:alert(1)',
    ]) {
      const res = await call('POST', '/api/live', {
        json: { platform: 'youtube', handle, displayName: 'x' },
        cookie: editor.cookie,
      });
      assert.equal(res.status, 400, `${handle} 应当被拒：${res.text}`);
    }
  });

  it('★ 私人链接不会混进公开名单（两组互不写入）', async () => {
    const plain = await makeUser();
    await call('POST', '/api/live/mine', {
      json: { url: 'https://www.twitch.tv/Someone', title: '我的' },
      cookie: plain.cookie,
    });
    assert.deepEqual(itemsOf((await call('GET', '/api/live')).body), []);
    assert.equal(
      itemsOf((await call('GET', '/api/live/mine', { cookie: plain.cookie })).body).length,
      1,
    );
  });
});
