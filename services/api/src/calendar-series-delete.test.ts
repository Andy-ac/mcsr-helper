/**
 * 删除系列（2026-09-13，用户裁决：**连它下面的赛事一起删**）。
 *
 * ---------------------------------------------------------------------------
 * 这个文件守的六件事（每一条错了都**不会**报错，只会静默骗人）
 * ---------------------------------------------------------------------------
 * 1. **级联真的删干净**：系列、它下面的赛事、以及**赛事的版本历史**。
 *    `content_revisions` 是多态引用、**没有外键**，漏删就留下永远查不到的孤儿行，
 *    里面还可能是 `status='pending'` 的快照 —— 表现是"审核队列里有一条已经不存在
 *    的事件，点进去 404"。
 * 2. **不越界**：只删这个系列。别的系列的事件、以及**不属于任何系列**的事件，
 *    一根都不能动。这是本文件里最像"数据丢失"的一条。
 * 3. **权限只给 owner**：editor / admin / reviewer / user 一律 403，匿名 401。
 *    判据是共享谓词 `canHardDelete` —— 系列没有"先隐藏"那一档，所以不能像
 *    `authoring.ts` 那样给 `content.author` 留后路。
 * 4. ★★ **确认框里那个数字必须数对**。列表行上的 `count` 是「**未结束且已发布**」
 *    的场次，而删除带走的是**所有**赛场。两者在最需要正确的那种系列上恰好相反：
 *    一个历届赛事系列在列表里 `count` 是 0 ⇒ 确认框会说"不会影响任何内容"，
 *    而它正要删掉全部。⇒ `impact` 必须与删除**同一个 WHERE**。
 * 5. **草稿也算数**：只提交未批准的事件同样挂在 `series_id` 上，同样会被删。
 *    漏掉它们的后果不只是数字少——`calendar_series` 上有外键（`on_delete: NO ACTION`），
 *    只删已发布的话，那一句 `DELETE FROM calendar_series` 会撞外键、整笔回滚，
 *    表现是"删不掉，而且不知道为什么"。
 * 6. **审计留痕**：`series.delete` 要写一条，且 `reason` 里带上连带数量 ——
 *    系列行本身已经不存在了，事后追查"这次真删带走了多少"只有审计里有。
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
  db.exec('DELETE FROM audit_log');
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

type Role = 'user' | 'reviewer' | 'editor' | 'admin' | 'owner';

let seq = 0;
async function makeUser(role: Role) {
  seq += 1;
  const email = `seriesdel${String(seq)}.${Date.now()}@example.com`;
  await call('POST', '/api/auth/register', {
    json: { email, password: PASSWORD, displayName: `删系${String(seq)}`, locale: 'zh-CN' },
  });
  getDb()
    .prepare('UPDATE users SET email_verified_at = ?, role = ? WHERE email = ?')
    .run(Date.now(), role, email);
  const login = await call('POST', '/api/auth/login', { json: { email, password: PASSWORD } });
  return { email, cookie: (login.setCookie ?? '').split(';')[0] as string };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    title: '系列删除测试赛事',
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

/** 只提交、**不**批准 ⇒ status = pending。 */
async function submitOnly(
  author: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const submitted = await call('POST', '/api/calendar', { json: input(overrides), cookie: author });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  return submitted.body.id as string;
}

async function createSeries(cookie: string, name: string): Promise<string> {
  const res = await call('POST', '/api/calendar/series', { json: { name }, cookie });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return ((res.body.series as { id: string }).id ?? '') as string;
}

function rowCount(table: string, id: string): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE id = ?`).get(id) as
    | { n: number }
    | undefined;
  return row?.n ?? -1;
}

/** 这些事件还剩多少版本快照（`content_revisions` 按 type + entity_id 多态引用）。 */
function revisionCount(ids: string[]): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM content_revisions WHERE entity_id IN (${placeholders})`)
    .get(...ids) as { n: number } | undefined;
  return row?.n ?? -1;
}

async function seriesRow(cookie: string, id: string) {
  const res = await call('GET', '/api/calendar/series', { cookie });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const items = (res.body as { items: Array<{ id: string; count: number; pastCount: number }> })
    .items;
  return items.find((s) => s.id === id) ?? null;
}

describe('★ 删除系列（连它下面的赛事一起删）', () => {
  it('★ 级联：系列、赛事、以及赛事的版本历史一起消失', async () => {
    const owner = await makeUser('owner');
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const sid = await createSeries(owner.cookie, '要删掉的系列');
    const e1 = await publish(author.cookie, reviewer.cookie, { seriesId: sid, title: '第一场' });
    const e2 = await publish(author.cookie, reviewer.cookie, { seriesId: sid, title: '第二场' });

    const before = revisionCount([e1, e2]);
    assert.ok(before >= 2, `前置条件：两场赛事至少各有一条版本快照（实际 ${String(before)}）`);

    const res = await call('DELETE', `/api/calendar/series/${sid}`, { cookie: owner.cookie });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.deletedEvents, 2, '必须把"连带删了几场"如实回报');

    assert.equal(rowCount('calendar_series', sid), 0, '系列必须消失');
    assert.equal(rowCount('calendar_events', e1), 0, '第一场必须消失');
    assert.equal(rowCount('calendar_events', e2), 0, '第二场必须消失');
    assert.equal(
      revisionCount([e1, e2]),
      0,
      '★ 版本历史也必须消失 —— 它是多态引用、没有外键，漏删会留下查不到的孤儿行',
    );
  });

  it('★★ 不越界：别的系列的事件、以及不属于任何系列的事件，一根都没动', async () => {
    const owner = await makeUser('owner');
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');

    const doomed = await createSeries(owner.cookie, '会被删的系列');
    const survivor = await createSeries(owner.cookie, '要活下来的系列');
    const inDoomed = await publish(author.cookie, reviewer.cookie, { seriesId: doomed });
    const inSurvivor = await publish(author.cookie, reviewer.cookie, { seriesId: survivor });
    const orphan = await publish(author.cookie, reviewer.cookie);

    const res = await call('DELETE', `/api/calendar/series/${doomed}`, { cookie: owner.cookie });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.deletedEvents, 1);

    assert.equal(rowCount('calendar_events', inDoomed), 0, '该删的没删');
    assert.equal(rowCount('calendar_series', survivor), 1, '★ 别的系列被误删了');
    assert.equal(rowCount('calendar_events', inSurvivor), 1, '★ 别的系列的事件被误删了');
    assert.equal(rowCount('calendar_events', orphan), 1, '★ 不属于任何系列的事件被误删了');
  });

  it('★ 权限：只有 owner 能删 —— editor / admin / reviewer / user 一律 403，匿名 401', async () => {
    const owner = await makeUser('owner');
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const sid = await createSeries(owner.cookie, '权限测试系列');
    const eventId = await publish(author.cookie, reviewer.cookie, { seriesId: sid });

    for (const role of ['editor', 'admin', 'reviewer', 'user'] as const) {
      /*
       * ⚠️ 每个角色之前必须清一次限流桶：登录限流是**内存态**的，一圈里连着注册+登录
       *    四次会把后面的请求限流掉 ⇒ 那一轮拿到的是**空 cookie** ⇒ 路由回 **401**，
       *    而这条测试想问的是 **403**。不重置的话失败信息会说"reviewer 不该能删系列：
       *    401" —— 看起来像权限没配对，其实是被限流了（`pending.md §5.39` 记过这条）。
       */
      resetAll();
      const actor = await makeUser(role);
      const res = await call('DELETE', `/api/calendar/series/${sid}`, { cookie: actor.cookie });
      assert.equal(res.status, 403, `${role} 不该能删系列：${JSON.stringify(res.body)}`);
    }

    const anon = await call('DELETE', `/api/calendar/series/${sid}`);
    assert.equal(anon.status, 401, '匿名必须是 401（不是 403）');

    // 而且这几次拒绝**没有删掉任何东西** —— 只断言状态码的话，"403 但已经删了"会漏网
    assert.equal(rowCount('calendar_series', sid), 1, '被拒绝的请求不该删掉系列');
    assert.equal(rowCount('calendar_events', eventId), 1, '被拒绝的请求不该删掉事件');
  });

  it('未知 id → 404（不是 200 的空操作）', async () => {
    const owner = await makeUser('owner');
    const res = await call('DELETE', '/api/calendar/series/does-not-exist', {
      cookie: owner.cookie,
    });
    assert.equal(res.status, 404, JSON.stringify(res.body));
  });

  it('★ 系列下只有未发布的草稿时也能删掉（外键不会把系列钉住）', async () => {
    const owner = await makeUser('owner');
    const author = await makeUser('user');
    const sid = await createSeries(owner.cookie, '只有草稿的系列');
    const draft = await submitOnly(author.cookie, { seriesId: sid });

    /*
     * ⚠️ 这一条是真实会炸的形状：`calendar_events.series_id` 是外键、
     *    `on_delete: NO ACTION`。级联若只删"已发布"的行，草稿会留在原地，
     *    于是 `DELETE FROM calendar_series` 撞外键、**整笔事务回滚** ——
     *    表现是"删不掉，而且不知道为什么"。
     */
    const res = await call('DELETE', `/api/calendar/series/${sid}`, { cookie: owner.cookie });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.deletedEvents, 1, '草稿也要算进连带数量');
    assert.equal(rowCount('calendar_series', sid), 0);
    assert.equal(
      rowCount('calendar_events', draft),
      0,
      '草稿也必须被删掉，否则它是一条没有系列的孤儿',
    );
  });

  it('审计：写一条 series.delete，entity 是 calendar_series，reason 里带连带数量', async () => {
    const owner = await makeUser('owner');
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const sid = await createSeries(owner.cookie, '审计用系列');
    await publish(author.cookie, reviewer.cookie, { seriesId: sid });
    await publish(author.cookie, reviewer.cookie, { seriesId: sid, title: '第二场' });

    await call('DELETE', `/api/calendar/series/${sid}`, { cookie: owner.cookie });

    const rows = getDb()
      .prepare(
        "SELECT actor_id, entity_type, entity_id, reason FROM audit_log WHERE action = 'series.delete'",
      )
      .all() as unknown as Array<{
      actor_id: string;
      entity_type: string;
      entity_id: string;
      reason: string;
    }>;
    /*
     * ⚠️ 先 `assert.ok(row)` 再取字段，而不是直接写 `rows[0].xxx`：
     *    `noUncheckedIndexedAccess` 下 `rows[0]` 的类型是 `T | undefined`，
     *    直接取字段过不了类型检查（这一版就是这么红的）。而 `assert.ok` 是
     *    TS 的断言函数，它同时**收窄类型**和**守住"恰好一条"**这件事。
     */
    const row = rows[0];
    assert.ok(row, `必须恰好写一条 series.delete（实际 ${String(rows.length)} 条）`);
    assert.equal(rows.length, 1);
    assert.equal(row.entity_type, 'calendar_series');
    assert.equal(row.entity_id, sid);
    assert.notEqual(row.actor_id, '', '必须记下是谁删的');
    assert.ok(
      /2/.test(row.reason),
      `★ reason 必须带上连带删掉的数量（系列行已经没了，这是唯一的追查依据）：${row.reason}`,
    );
  });
});

describe('★★ 删除影响（impact）：确认框里那个数字的来源', () => {
  it('★★ 全部场次都已结束的系列：列表 count = 0，而 impact 不是 0', async () => {
    const owner = await makeUser('owner');
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const sid = await createSeries(owner.cookie, '历届赛事');

    await publish(author.cookie, reviewer.cookie, {
      seriesId: sid,
      startsAtLocal: '2020-01-01T00:00',
      title: '很久以前那场',
    });
    await publish(author.cookie, reviewer.cookie, {
      seriesId: sid,
      startsAtLocal: '2021-01-01T00:00',
      title: '也很久以前那场',
    });

    const row = await seriesRow(owner.cookie, sid);
    assert.equal(row?.count, 0, '前置条件：已经结束的场次不算进 `count`');
    assert.equal(row?.pastCount, 2, '前置条件：它们落在 `pastCount` 里');

    const impact = await call('GET', `/api/calendar/series/${sid}/impact`, {
      cookie: owner.cookie,
    });
    assert.equal(impact.status, 200, JSON.stringify(impact.body));
    assert.equal(
      impact.body.events,
      2,
      '★ 必须数到 2 —— 那才是真正会被删掉的行数。拿列表的 count 填确认框的话，' +
        '这里会说"不会影响任何内容"，而它正要删掉两场',
    );
    assert.notEqual(
      impact.body.events,
      row?.count,
      '两者不同，正是这个端点存在的全部理由（相等的话它就没有意义了）',
    );
  });

  it('★ 未发布的草稿也算进 impact（它们同样会被删）', async () => {
    const owner = await makeUser('owner');
    const author = await makeUser('user');
    const sid = await createSeries(owner.cookie, '有草稿的系列');
    await submitOnly(author.cookie, { seriesId: sid });

    const row = await seriesRow(owner.cookie, sid);
    assert.equal(row?.count, 0, '前置条件：未发布的草稿不进列表计数');
    assert.equal(row?.pastCount, 0, '前置条件：同上');

    const impact = await call('GET', `/api/calendar/series/${sid}/impact`, {
      cookie: owner.cookie,
    });
    assert.equal(impact.status, 200, JSON.stringify(impact.body));
    assert.equal(impact.body.events, 1, '★ 草稿也要数进去 —— 它同样会被删掉');
  });

  it('impact 的权限与删除完全相同：匿名 401、非 owner 403、未知 id 404', async () => {
    const owner = await makeUser('owner');
    const sid = await createSeries(owner.cookie, 'impact 权限系列');

    const anon = await call('GET', `/api/calendar/series/${sid}/impact`);
    assert.equal(anon.status, 401, '匿名必须 401');

    for (const role of ['editor', 'admin', 'reviewer', 'user'] as const) {
      // ⚠️ 同「权限」那条：不重置限流桶的话，后面几轮会拿到空 cookie ⇒ 401 而不是 403。
      resetAll();
      const actor = await makeUser(role);
      const res = await call('GET', `/api/calendar/series/${sid}/impact`, { cookie: actor.cookie });
      assert.equal(
        res.status,
        403,
        `${role} 不该看到未发布计数（那等于向任何人汇报"这个系列里有几条还没发布的投稿"）`,
      );
    }

    const missing = await call('GET', '/api/calendar/series/nope/impact', { cookie: owner.cookie });
    assert.equal(missing.status, 404, '未知 id 是 404，不是 events: 0');
  });

  it('★ impact 是 0 与"系列不存在"是两件事（0 必须是真的 0）', async () => {
    const owner = await makeUser('owner');
    const sid = await createSeries(owner.cookie, '空系列');

    const impact = await call('GET', `/api/calendar/series/${sid}/impact`, {
      cookie: owner.cookie,
    });
    assert.equal(impact.status, 200, '空系列是 200 + events: 0，不是 404');
    assert.equal(impact.body.events, 0);

    // 反过来：不存在的系列绝不能回 200/0 —— 那会让"删一个不存在的 id"看起来像成功的空操作
    const missing = await call('GET', '/api/calendar/series/does-not-exist/impact', {
      cookie: owner.cookie,
    });
    assert.equal(missing.status, 404);
  });
});
