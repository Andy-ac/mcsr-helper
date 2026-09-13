/**
 * ③ 系列活动（rework-2）：系列实体、检索端点、事件的系列归属。
 *
 * ---------------------------------------------------------------------------
 * 这个文件守的五件事（每一条都是"错了不会报错"的那种）
 * ---------------------------------------------------------------------------
 * 1. **路由顺序**：`/calendar/series` 必须匹配上，而不是被 `/calendar/:id` 吃掉。
 *    被吃掉的表现是 404 `not_found` —— 而它看起来像"这个功能没做"。
 * 2. **匿名可读**（§9-5 的裁决）：不登录也能拿到真列表，既不是 401 也不是空数组。
 *    这两件事对用户的意义完全不同："你需要登录"和"还没有系列"。
 * 3. **重名判定**：大小写变体与空白变体都算同一个系列（`COLLATE NOCASE` + 归一化），
 *    否则栏目里会出现两行看起来一模一样的东西。这是本设计里最容易写成静默 bug 的一处。
 * 4. **计数口径**：只数**已发布**的事件。把待审/已下架的算进来，栏目里的数字
 *    与点进去看到的列表就对不上，而那种不一致**不会报错**。
 * 5. **系列名只有一份**：事件行上只存 `series_id`，名字由 LEFT JOIN 得到 ——
 *    改名之后事件列表里的名字必须**立刻**跟着变。在事件上冗余存名字的话，
 *    老事件会一直显示旧名字，而两边都不会报错。
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
beforeEach(() => {
  resetAll();
  const db = getDb();
  db.exec('DELETE FROM content_revisions');
  db.exec('DELETE FROM calendar_events');
  // ⚠️ 顺序要紧：事件先删（它们引用系列），否则外键会拦住 DELETE
  db.exec('DELETE FROM calendar_series');
});

async function call(
  method: string,
  path: string,
  options: { json?: unknown; cookie?: string } = {},
): Promise<{
  status: number;
  body: Record<string, unknown>;
  text: string;
  setCookie: string | null;
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
    body: (() => {
      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        return {};
      }
    })(),
    setCookie: response.headers.getSetCookie?.()[0] ?? null,
  };
}

let seq = 0;
async function makeUser(role: 'user' | 'reviewer' | 'editor') {
  seq += 1;
  const email = `series${String(seq)}.${Date.now()}@example.com`;
  await call('POST', '/api/auth/register', {
    json: { email, password: PASSWORD, displayName: `系列${String(seq)}`, locale: 'zh-CN' },
  });
  getDb()
    .prepare('UPDATE users SET email_verified_at = ?, role = ? WHERE email = ?')
    .run(Date.now(), role, email);
  const login = await call('POST', '/api/auth/login', { json: { email, password: PASSWORD } });
  return { email, cookie: (login.setCookie ?? '').split(';')[0] as string };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    title: '系列活动测试赛事',
    startsAtLocal: '2030-09-05T16:00',
    startsAtTz: 'Asia/Shanghai',
    tags: ['TOURNAMENT'],
    ...overrides,
  };
}

/** 提交并直接批准（走真实 HTTP 审核路由），返回事件 id。 */
async function publish(
  author: string,
  reviewer: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const submitted = await call('POST', '/api/calendar', { json: input(overrides), cookie: author });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  const id = submitted.body.id as string;
  const approved = await call('POST', `/api/admin/review/calendar/${id}/approve`, {
    cookie: reviewer,
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  return id;
}

/** 建一个系列（editor），返回 id。 */
async function createSeries(cookie: string, name: string): Promise<string> {
  const res = await call('POST', '/api/calendar/series', { json: { name }, cookie });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return ((res.body.series as { id: string }).id ?? '') as string;
}

async function seriesList(cookie?: string) {
  const res = await call('GET', '/api/calendar/series', cookie ? { cookie } : {});
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body as {
    items: Array<{
      id: string;
      name: string;
      count: number;
      pastCount: number;
      nextStartsAtUtc: number | null;
    }>;
    total: number;
  };
}

describe('③ 系列活动', () => {
  it('★ 未被 /calendar/:id 吃掉：匿名 GET 拿到的是列表而不是 404', async () => {
    /*
     * ⚠️ 这条是**路由注册顺序**的守门。`/calendar/series` 是字面量段，
     *    而 `/calendar/:id` 会把 `series` 当成事件 id —— 顺序写反时
     *    这里拿到的是 404 `not_found`，看起来完全像"这个功能还没做"。
     */
    const res = await call('GET', '/api/calendar/series');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.items, []);
    // 空库时 total 是 0（**系列数**，不是事件数）
    assert.equal(res.body.total, 0);
  });

  it('★ 匿名可读：不登录拿到的是真列表，不是 401 / 不是空数组', async () => {
    const editor = await makeUser('editor');
    await createSeries(editor.cookie, 'MCSR Ranked Season');

    const anon = await call('GET', '/api/calendar/series');
    assert.equal(anon.status, 200, '⑨-5 裁决：系列对匿名访客开放，不能回 401');
    const items = anon.body.items as Array<{ name: string }>;
    assert.equal(items.length, 1, '匿名必须看到真数据 —— 空数组会让用户以为"还没有系列"');
    assert.equal(items[0]?.name, 'MCSR Ranked Season');
  });

  it('新建系列：普通用户 403，editor 201（content.author）', async () => {
    const member = await makeUser('user');
    const denied = await call('POST', '/api/calendar/series', {
      json: { name: '被拒绝的系列' },
      cookie: member.cookie,
    });
    assert.equal(denied.status, 403, JSON.stringify(denied.body));

    const editor = await makeUser('editor');
    const ok = await call('POST', '/api/calendar/series', {
      json: { name: '被允许的系列' },
      cookie: editor.cookie,
    });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
  });

  it('★ 重名：大小写变体与空白变体都算同一个系列（409 series_name_taken）', async () => {
    const editor = await makeUser('editor');
    await createSeries(editor.cookie, 'MCSR Ranked');

    for (const variant of ['mcsr ranked', 'MCSR  Ranked', '  MCSR Ranked  ']) {
      const res = await call('POST', '/api/calendar/series', {
        json: { name: variant },
        cookie: editor.cookie,
      });
      assert.equal(res.status, 409, `${variant} 应当被判为重名：${JSON.stringify(res.body)}`);
      assert.equal(res.body.error, 'invalid_state');
      assert.equal(res.body.reason, 'series_name_taken');
    }

    // 反面控制：库里仍然只有一个系列（"拒绝了"必须真的什么都没建）
    const list = await seriesList();
    assert.equal(list.items.length, 1, '被拒绝的创建不能留下任何行');
    assert.equal(list.items[0]?.name, 'MCSR Ranked', '显示名保留第一次输入的那个');
  });

  it('事件挂系列：列表带出 seriesId + seriesName，且 ?seriesId= 只回该系列', async () => {
    const editor = await makeUser('editor');
    const reviewer = await makeUser('reviewer');
    const author = await makeUser('user');

    const inSeries = await createSeries(editor.cookie, 'MCSR Ranked Season 5');
    const otherSeries = await createSeries(editor.cookie, '另一个活动');

    const a = await publish(author.cookie, reviewer.cookie, { seriesId: inSeries });
    const b = await publish(author.cookie, reviewer.cookie, { seriesId: otherSeries });
    const none = await publish(author.cookie, reviewer.cookie); // 不属于任何系列

    const listed = await call('GET', '/api/calendar?from=0');
    assert.equal(listed.status, 200);
    const items = listed.body.items as Array<{
      id: string;
      seriesId: string | null;
      seriesName: string | null;
    }>;
    const byId = new Map(items.map((e) => [e.id, e]));

    assert.equal(byId.get(a)?.seriesId, inSeries);
    assert.equal(byId.get(a)?.seriesName, 'MCSR Ranked Season 5', '名字必须由 LEFT JOIN 带出来');
    assert.equal(byId.get(b)?.seriesName, '另一个活动');
    assert.equal(byId.get(none)?.seriesId, null, '不属于任何系列是 null，不是 undefined');
    assert.equal(byId.get(none)?.seriesName, null);

    const filtered = await call('GET', `/api/calendar?from=0&seriesId=${inSeries}`);
    const filteredIds = (filtered.body.items as Array<{ id: string }>).map((e) => e.id);
    assert.deepEqual(filteredIds, [a], '?seriesId= 必须只回这一个系列的事件');
  });

  it('★ 计数只数已发布的事件（待审的不算），并给出下一场时间', async () => {
    const editor = await makeUser('editor');
    const reviewer = await makeUser('reviewer');
    const author = await makeUser('user');
    const seriesId = await createSeries(editor.cookie, '计数口径');

    // 一场已发布、未结束（2030）
    await publish(author.cookie, reviewer.cookie, { seriesId });
    // 一场**待审**（不批准）—— 它绝不能进 count
    const pending = await call('POST', '/api/calendar', {
      json: input({ seriesId, title: '还没通过审核的场次' }),
      cookie: author.cookie,
    });
    assert.equal(pending.status, 201);
    // 一场已发布但**已经结束**（2020）—— 进 pastCount，不进 count
    await publish(author.cookie, reviewer.cookie, {
      seriesId,
      title: '早就结束的场次',
      startsAtLocal: '2020-09-05T16:00',
    });

    const list = await seriesList();
    const row = list.items.find((s) => s.id === seriesId);
    assert.ok(row, '系列必须出现在栏目里');
    assert.equal(row.count, 1, '只有那场未结束的已发布事件算"未结束场次"');
    assert.equal(row.pastCount, 1, '已结束的已发布事件算 pastCount');
    assert.equal(typeof row.nextStartsAtUtc, 'number', '未结束场次存在时必须给下一场时间');
    assert.equal(list.total, 1, 'total 是**系列数**');
  });

  it('★ 系列名只有一份：改名之后事件列表里的名字立刻跟着变', async () => {
    const editor = await makeUser('editor');
    const reviewer = await makeUser('reviewer');
    const author = await makeUser('user');
    const seriesId = await createSeries(editor.cookie, '改名前');
    const eventId = await publish(author.cookie, reviewer.cookie, { seriesId });

    const renamed = await call('PATCH', `/api/calendar/series/${seriesId}`, {
      json: { name: '改名后' },
      cookie: editor.cookie,
    });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body));

    const listed = await call('GET', '/api/calendar?from=0');
    const row = (listed.body.items as Array<{ id: string; seriesName: string | null }>).find(
      (e) => e.id === eventId,
    );
    /*
     * ⚠️ 这一条断言的全部意义在于"事件行上没有冗余存名字"：
     *    冗余存的话这里会一直是「改名前」，而没有任何报错。
     */
    assert.equal(row?.seriesName, '改名后', '事件没有自己的名字副本，读的是 JOIN 结果');
  });

  it('ICS 的 CATEGORIES 带上系列名（③/D3.11）', async () => {
    const editor = await makeUser('editor');
    const reviewer = await makeUser('reviewer');
    const author = await makeUser('user');
    const seriesId = await createSeries(editor.cookie, 'ICS 分类用系列');
    await publish(author.cookie, reviewer.cookie, { seriesId });

    const ics = await call('GET', '/api/calendar.ics');
    assert.equal(ics.status, 200);
    assert.match(ics.text, /CATEGORIES:[^\r\n]*ICS/);
  });
});
