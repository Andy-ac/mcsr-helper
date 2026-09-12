/**
 * 个人标记（收藏 / 备注 / 评分）的测试。
 *
 * 这个文件里最重要的是**三条容易写错、错了也不会报错**的规则：
 *   1. 备注是私有的 —— 别人读不到；
 *   2. 没评过 ≠ 0 分 —— 没人评分时平均值是 null，不是 0；
 *   3. 只改传了的字段 —— 取消收藏不该顺手清掉备注和评分。
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
const { SITE } = await import('@mcsr/shared');

const PASSWORD = 'a good long passphrase';

after(() => closeDb());
beforeEach(() => resetAll());

interface Res {
  status: number;
  body: Record<string, unknown>;
  setCookie: string | null;
}

async function call(
  method: string,
  path: string,
  options: { json?: unknown; cookie?: string } = {},
): Promise<Res> {
  const headers: Record<string, string> = { origin: SITE.productionOrigin };
  if (options.json !== undefined) headers['content-type'] = 'application/json';
  if (options.cookie) headers.cookie = options.cookie;

  const response = await app.request(path, {
    method,
    headers,
    ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : {}),
  });
  const raw = response.headers.getSetCookie?.() ?? [];
  return {
    status: response.status,
    body: (await response.json().catch(() => ({}))) as Record<string, unknown>,
    setCookie: raw[0] ?? null,
  };
}

let seq = 0;
async function makeUser() {
  seq += 1;
  const email = `mark${String(seq)}.${Date.now()}@example.com`;
  await call('POST', '/api/auth/register', {
    json: { email, password: PASSWORD, displayName: `标记用户${String(seq)}`, locale: 'zh-CN' },
  });
  getDb().prepare('UPDATE users SET email_verified_at = ? WHERE email = ?').run(Date.now(), email);
  const login = await call('POST', '/api/auth/login', { json: { email, password: PASSWORD } });
  return { email, cookie: (login.setCookie ?? '').split(';')[0] as string };
}

/** 造一条已上架内容。 */
function seed(id = `mark-entry-${String(++seq)}`): string {
  getDb()
    .prepare(
      `INSERT INTO resources (id, kind, title, url, body, lang, tags, featured, official, status, source, created_at, updated_at)
       VALUES (?, 'website', '标记测试条目', ?, '正文', 'zh-CN', '[]', 0, 0, 'published', 'import', ?, ?)`,
    )
    .run(id, `https://${id}.example/`, Date.now(), Date.now());
  return id;
}

describe('★ 个人标记：收藏 / 备注 / 评分', () => {
  it('收藏、评分、备注各写一次，都能读回来', async () => {
    const user = await makeUser();
    const id = seed();

    const saved = await call('PUT', `/api/resources/${id}/marks`, {
      json: { favorite: true, rating: 4, note: '这个工具在 1.16.1 上要手动指定路径' },
      cookie: user.cookie,
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const marks = saved.body.marks as { favorite: boolean; rating: number; note: string };
    assert.equal(marks.favorite, true);
    assert.equal(marks.rating, 4);
    assert.equal(marks.note, '这个工具在 1.16.1 上要手动指定路径');

    const read = await call('GET', `/api/resources/${id}/marks`, { cookie: user.cookie });
    assert.deepEqual(
      {
        favorite: (read.body.marks as { favorite: boolean }).favorite,
        rating: (read.body.marks as { rating: number }).rating,
      },
      { favorite: true, rating: 4 },
    );
  });

  it('★ 备注是私有的：别人读不到', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const id = seed();

    await call('PUT', `/api/resources/${id}/marks`, {
      json: { favorite: true, note: '只有我能看到的一句话' },
      cookie: a.cookie,
    });

    // b 读自己的标记：不该看到 a 的备注
    const bMarks = await call('GET', `/api/resources/${id}/marks`, { cookie: b.cookie });
    const note = (bMarks.body.marks as { note: string | null } | null)?.note ?? null;
    assert.equal(note, null, 'b 不该看到 a 的备注');

    // 连公开的详情和列表里也不能出现它
    const detail = await call('GET', `/api/resources/${id}`);
    assert.ok(
      !JSON.stringify(detail.body).includes('只有我能看到'),
      '★ 公开详情里绝不能出现任何人的备注',
    );
    const list = await call('GET', '/api/resources');
    assert.ok(!JSON.stringify(list.body).includes('只有我能看到'), '★ 公开列表里同样不能');
  });

  it('★ 没评过 ≠ 0 分（没人评分时平均值是 null，人数是 0）', async () => {
    const id = seed();
    const detail = await call('GET', `/api/resources/${id}`);
    const rating = detail.body.rating as { average: number | null; count: number };
    assert.equal(rating.count, 0);
    assert.equal(rating.average, null, '没人评分时是 null —— 界面上要显示"暂无评分"，不是 0.0');
  });

  it('评分汇总：平均分保留一位小数，人数只算评过分的人', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const c = await makeUser();
    const id = seed();

    await call('PUT', `/api/resources/${id}/marks`, { json: { rating: 5 }, cookie: a.cookie });
    await call('PUT', `/api/resources/${id}/marks`, { json: { rating: 4 }, cookie: b.cookie });
    // c 只收藏、不评分 —— **不该进平均分**
    await call('PUT', `/api/resources/${id}/marks`, { json: { favorite: true }, cookie: c.cookie });

    const detail = await call('GET', `/api/resources/${id}`);
    const rating = detail.body.rating as { average: number; count: number };
    assert.equal(rating.count, 2, '只收藏没评分的人不算进人数');
    assert.equal(rating.average, 4.5);

    // 列表接口也要带上评分
    const list = await call('GET', '/api/resources');
    const item = (list.body.items as Array<{ id: string; rating: { average: number } }>).find(
      (i) => i.id === id,
    );
    assert.equal(item?.rating.average, 4.5, '列表项也要有评分（卡片上要显示）');
  });

  it('★ 只改传了的字段：取消收藏不会清掉备注和评分', async () => {
    /*
     * 这是最容易写错的一处。把"没传"当成 false/null 的话，
     * 用户点一下"取消收藏"，备注和评分会一起消失 ——
     * 而界面上只表现为"我点了一个按钮"。
     */
    const user = await makeUser();
    const id = seed();

    await call('PUT', `/api/resources/${id}/marks`, {
      json: { favorite: true, rating: 5, note: '别弄丢我' },
      cookie: user.cookie,
    });
    const after = await call('PUT', `/api/resources/${id}/marks`, {
      json: { favorite: false },
      cookie: user.cookie,
    });
    const marks = after.body.marks as { favorite: boolean; rating: number; note: string };
    assert.equal(marks.favorite, false);
    assert.equal(marks.rating, 5, '取消收藏不该清掉评分');
    assert.equal(marks.note, '别弄丢我', '取消收藏不该清掉备注');
  });

  it('取消评分用 null（和"没传"是两回事）', async () => {
    const user = await makeUser();
    const id = seed();

    await call('PUT', `/api/resources/${id}/marks`, {
      json: { favorite: true, rating: 3 },
      cookie: user.cookie,
    });
    const cleared = await call('PUT', `/api/resources/${id}/marks`, {
      json: { rating: null },
      cookie: user.cookie,
    });
    const marks = cleared.body.marks as { rating: number | null; favorite: boolean };
    assert.equal(marks.rating, null, 'null = 明确要求取消评分');
    assert.equal(marks.favorite, true, '取消评分不该影响收藏');

    // 取消之后平均分人数要减回去
    const detail = await call('GET', `/api/resources/${id}`);
    assert.equal((detail.body.rating as { count: number }).count, 0);
  });

  it('三项都清空之后不留空行（收藏列表不该出现"什么都没有"的条目）', async () => {
    const user = await makeUser();
    const id = seed();

    await call('PUT', `/api/resources/${id}/marks`, {
      json: { favorite: true, rating: 3 },
      cookie: user.cookie,
    });
    await call('PUT', `/api/resources/${id}/marks`, {
      json: { favorite: false, rating: null },
      cookie: user.cookie,
    });

    /*
     * ⚠️ 必须按**这条内容**数，不能数全表：同一个文件里的测试**共用内存库**，
     *    前面几条用例留下的标记会让 COUNT(*) 永远大于 0，
     *    而失败信息看起来像"删除逻辑没写"。
     */
    const rows = getDb()
      .prepare('SELECT COUNT(*) AS n FROM resource_marks WHERE resource_id = ?')
      .get(id) as { n: number };
    assert.equal(rows.n, 0, '全空了就该把行删掉');

    const favs = await call('GET', '/api/me/favorites', { cookie: user.cookie });
    assert.equal((favs.body.items as unknown[]).length, 0);
  });

  it('评分范围是 1–5', async () => {
    const user = await makeUser();
    const id = seed();
    for (const bad of [0, 6, -1, 3.5]) {
      const res = await call('PUT', `/api/resources/${id}/marks`, {
        json: { rating: bad },
        cookie: user.cookie,
      });
      assert.equal(res.status, 400, `${String(bad)} 应当被拒绝`);
    }
  });

  it('我的收藏列表：带备注与评分，下架的条目也还在（但标记为不可点）', async () => {
    const user = await makeUser();
    const id = seed();

    await call('PUT', `/api/resources/${id}/marks`, {
      json: { favorite: true, rating: 5, note: '收藏时的理由' },
      cookie: user.cookie,
    });

    const before = await call('GET', '/api/me/favorites', { cookie: user.cookie });
    const item = (before.body.items as Array<Record<string, unknown>>)[0];
    assert.ok(item, '收藏列表里应当有这一条');
    assert.equal(item.published, true);
    assert.equal((item.marks as { note: string }).note, '收藏时的理由');

    // 下架它
    getDb().prepare("UPDATE resources SET status = 'hidden' WHERE id = ?").run(id);

    const after = await call('GET', '/api/me/favorites', { cookie: user.cookie });
    const still = (after.body.items as Array<Record<string, unknown>>).find((i) => i.id === id);
    assert.ok(still, '★ 条目被下架之后仍应留在收藏里 —— 用户收藏的是"这个东西"');
    assert.equal(still?.published, false, '但要标成不可点（公开接口会 404）');
  });

  it('未登录能读（拿到 null），但不能写', async () => {
    const id = seed();
    const read = await call('GET', `/api/resources/${id}/marks`);
    assert.equal(read.status, 200);
    assert.equal(read.body.marks, null, '未登录时 marks 是 null（不是空对象）');

    const write = await call('PUT', `/api/resources/${id}/marks`, { json: { favorite: true } });
    assert.equal(write.status, 401);
  });

  it('登录即可用 —— 不需要任何**额外**权限（普通用户就行）', async () => {
    /*
     * ⚠️ 这条用例的措辞在 2026-09-12 变过。
     *    原来它证明的是"未验证邮箱也能收藏/评分"（当时的策略：验证挡的是提交）。
     *    现在未验证根本登不进来，那个状态不存在了 —— 所以
     *    "不要求邮箱验证"这句话已经由登录那一道闸门保证，无从在这里单独验证。
     *
     *    这里保留的是它**还有意义**的那一半：收藏/评分不需要任何额外权限，
     *    任何一个普通用户登录后就能用（不是只有审核员或编辑才行）。
     */
    const user = await makeUser();
    const id = seed();

    const me = await call('GET', '/api/auth/me', { cookie: user.cookie });
    assert.equal((me.body.user as { role: string }).role, 'user', '前提：这是最低权限的普通用户');

    const res = await call('PUT', `/api/resources/${id}/marks`, {
      json: { favorite: true, rating: 5 },
      cookie: user.cookie,
    });
    assert.equal(res.status, 200);
  });
});
