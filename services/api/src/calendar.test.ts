/**
 * 日历：提交 → 审核 → 公开 → ICS 订阅。
 *
 * ---------------------------------------------------------------------------
 * 审核那一步是**直接调数据层**的，没有走 HTTP 审核路由
 * ---------------------------------------------------------------------------
 * 通用的审核路由（`/api/admin/queue` + `approve/reject`）按内容类型分发，
 * 而日历在注册表（`review/registry.ts`）里注册之前还不可达。
 * 这里先直接调 `calendar/events.ts` 的 approve/reject —— 它们是那条路由
 * **最终会调用**的同一份实现，所以这组测试守的是真实语义，不是一条影子路径。
 * 注册表接上之后，这里应当补一条"走 HTTP 审核一遍"的用例。
 *
 * ---------------------------------------------------------------------------
 * 最要紧的两条
 * ---------------------------------------------------------------------------
 * 1. **改已发布的事件，线上内容一个字都不能变** —— 这是设计约束 2，
 *    也是"先过审、后改成广告"的唯一防线。
 * 2. **驳回一次修改，线上那一版必须留在原地** —— 否则一次被驳回的修改
 *    会让线上内容凭空消失，而那是比"没改成功"严重得多的事故。
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
const { approveEvent, getEventRow, rejectEvent } = await import('./calendar/events');
const { SITE } = await import('@mcsr/shared');

const PASSWORD = 'a good long passphrase';

after(() => closeDb());
beforeEach(() => {
  resetAll();
  /*
   * ⚠️ `resetAll()` 只清**限流计数**，不删数据。而 `:memory:` 库在整个测试文件里
   *    是同一个，所以上一个用例建的事件会留到下一个用例里。
   *
   * 这一点最初漏了，症状很有迷惑性：报错是"过去的赛事不该堆在默认列表顶上"
   * 和标签筛选数量不对 —— 看起来像过滤逻辑写错了，其实是库里多了几条脏数据。
   */
  getDb().exec('DELETE FROM content_revisions');
  getDb().exec('DELETE FROM calendar_events');
});

async function call(
  method: string,
  path: string,
  options: { json?: unknown; cookie?: string; raw?: boolean } = {},
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
  const raw = response.headers.getSetCookie?.() ?? [];
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
    setCookie: raw[0] ?? null,
  };
}

let seq = 0;
async function makeUser(verify = true) {
  seq += 1;
  const email = `cal${String(seq)}.${Date.now()}@example.com`;
  await call('POST', '/api/auth/register', {
    json: { email, password: PASSWORD, displayName: `日历用户${String(seq)}`, locale: 'zh-CN' },
  });
  if (verify) {
    getDb()
      .prepare('UPDATE users SET email_verified_at = ? WHERE email = ?')
      .run(Date.now(), email);
  }
  const login = await call('POST', '/api/auth/login', { json: { email, password: PASSWORD } });
  return { email, cookie: (login.setCookie ?? '').split(';')[0] as string };
}

/**
 * 一份合法的赛事入参。
 *
 * ⚠️ 017（2026-09-13）起时间不再是"一对起止 + 每端一个时区"，而是
 *    **一个时区 + 若干段**：顶层只有 `startsAtTz`，每一段是
 *    `{ startsAtLocal, endsAtLocal? }`。老写法（顶层 `startsAtLocal`）现在会被
 *    Zod 当成未知键**剥掉**，于是每一笔提交都 400
 *    `slots: expected array, received undefined` —— 那条报错看起来像"这个
 *    测试文件坏了"，而不是"契约变了"。
 */
function input(overrides: Record<string, unknown> = {}) {
  return {
    title: '第 11 赛季资格赛',
    startsAtTz: 'Asia/Shanghai',
    slots: [{ startsAtLocal: '2030-09-05T16:00' }],
    tags: ['TOURNAMENT'],
    ...overrides,
  };
}

/** 提交一个事件并直接批准（绕过还没接上的审核路由）。 */
async function submitAndApprove(cookie: string, overrides: Record<string, unknown> = {}) {
  const created = await call('POST', '/api/calendar', { json: input(overrides), cookie });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id as string;
  approveEvent({ id, revision: 1, reviewerId: 'someone', now: Date.now() });
  return id;
}

describe('★ 日历（提交 / 审核 / ICS 订阅）', () => {
  it('未登录不能提交', async () => {
    const res = await call('POST', '/api/calendar', { json: input() });
    assert.equal(res.status, 401);
  });

  it('邮箱未验证不能提交（沿用登录闸门那条策略）', async () => {
    const user = await makeUser(false);
    // 未验证的账号登不进来，所以先给他一个合法的会话是做不到的 ——
    // 这里断言的是"没有会话就不能提交"
    const res = await call('POST', '/api/calendar', { json: input(), cookie: user.cookie });
    assert.ok(res.status === 401 || res.status === 403, `实际 ${String(res.status)}`);
  });

  it('★ 提交之后是 pending，公开列表里看不到它', async () => {
    const user = await makeUser();
    const created = await call('POST', '/api/calendar', { json: input(), cookie: user.cookie });
    assert.equal(created.status, 201);
    assert.equal(created.body.status, 'pending');

    const list = await call('GET', '/api/calendar');
    assert.equal((list.body.items as unknown[]).length, 0, '待审内容不该出现在公开列表里');

    const detail = await call('GET', `/api/calendar/${String(created.body.id)}`);
    assert.equal(detail.status, 404, '待审内容的公开详情也必须是 404（不是 403）');
  });

  it('★ 批准之后出现在公开列表和 ICS 里', async () => {
    const user = await makeUser();
    /*
     * ⚠️ 017 之后"时间"是**多段**，而列表里那对 `startsAt*` / `endsAt*` 是它派生出来的
     *    **包络**（最早那段的开始 → 最晚那段的结束）。这里刻意用**两段**：
     *    只给一段的话包络与"第一段"是同一个值，那样即便实现把包络算错
     *    （例如只取第一段）也看不出来。
     */
    const id = await submitAndApprove(user.cookie, {
      slots: [
        { startsAtLocal: '2030-09-05T16:00' },
        { startsAtLocal: '2030-09-12T16:00', endsAtLocal: '2030-09-12T18:00' },
      ],
    });

    const list = await call('GET', '/api/calendar');
    const items = list.body.items as Array<Record<string, unknown>>;
    assert.equal(items.length, 1);
    assert.equal(items[0]?.id, id);
    // 派生字段确实被算出来了（2030-09-05 16:00 @ Asia/Shanghai = 08:00Z）
    assert.equal(items[0]?.startsAtUtc, Date.UTC(2030, 8, 5, 8, 0, 0), '包络的开始 = 最早那一段');
    assert.equal(
      items[0]?.endsAtUtc,
      Date.UTC(2030, 8, 12, 10, 0, 0),
      '包络的结束 = 最晚那一段的结束（09-12 18:00 @ Asia/Shanghai = 10:00Z），不是第一段的',
    );

    const ics = await call('GET', '/api/calendar.ics');
    assert.equal(ics.status, 200);
    assert.ok(ics.text.includes('BEGIN:VCALENDAR'));
    assert.ok(ics.text.includes(`UID:${id}@`), 'ICS 里应当有这个事件');
  });

  it('ICS 的响应头与折行都正确', async () => {
    const user = await makeUser();
    // 25 个汉字正好撞 75 字节上限 —— 折行最容易出错的长度
    await submitAndApprove(user.cookie, {
      title: '这是一场名字非常长的中文赛事标题用来测试折行会不会把汉字劈成两半',
    });

    const res = await app.request('/api/calendar.ics');
    assert.match(res.headers.get('content-type') ?? '', /text\/calendar/);
    assert.match(res.headers.get('content-disposition') ?? '', /attachment|inline/);
    const body = await res.text();

    // 展开之后必须逐字符还原
    const unfolded = body.replace(/\r\n[ \t]/g, '').split('\r\n');
    assert.ok(
      unfolded.includes('SUMMARY:这是一场名字非常长的中文赛事标题用来测试折行会不会把汉字劈成两半'),
      '展开后标题必须与原文逐字符相同',
    );

    // 每个物理行的字节数不超上限，且单独都是合法 UTF-8（没有汉字被劈开）
    const encoder = new TextEncoder();
    const strict = new TextDecoder('utf-8', { fatal: true });
    for (const line of body.split('\r\n').filter(Boolean)) {
      assert.ok(encoder.encode(line).length <= 75, `行超长：${line.slice(0, 30)}`);
      assert.doesNotThrow(() => strict.decode(encoder.encode(line)));
    }
  });

  it('★ 改已发布的事件：线上内容一个字都不能变', async () => {
    const user = await makeUser();
    const id = await submitAndApprove(user.cookie, { title: '原标题' });

    const revised = await call('PATCH', `/api/calendar/${id}`, {
      json: input({ title: '改后的标题' }),
      cookie: user.cookie,
    });
    assert.equal(revised.status, 200);
    assert.equal(revised.body.revision, 2);

    // 线上那一行**完全没有被触碰**
    const row = getEventRow(id);
    assert.equal(row?.title, '原标题', '待审的改动不能影响线上标题');
    assert.equal(row?.status, 'published');
    assert.equal(row?.pending_revision, 2, 'pending_revision 应当指向新的待审版本');

    // 公开接口读到的也还是旧标题
    const pub = await call('GET', `/api/calendar/${id}`);
    assert.equal((pub.body.event as Record<string, unknown>).title, '原标题');
  });

  it('一条内容同时只允许一份待审修改（先到先得）', async () => {
    const user = await makeUser();
    const other = await makeUser();
    const id = await submitAndApprove(user.cookie);

    const first = await call('PATCH', `/api/calendar/${id}`, {
      json: input({ title: '甲的改动' }),
      cookie: user.cookie,
    });
    assert.equal(first.status, 200);

    const second = await call('PATCH', `/api/calendar/${id}`, {
      json: input({ title: '乙的改动' }),
      cookie: other.cookie,
    });
    assert.equal(second.status, 409);
    assert.equal(second.body.error, 'already_pending');

    // 后来者一个字都没写进库里
    const count = getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM content_revisions
         WHERE type = 'calendar' AND entity_id = ? AND status = 'pending'`,
      )
      .get(id) as { n: number };
    assert.equal(Number(count.n), 1);
  });

  it('★ 驳回一次修改，线上那一版必须留在原地', async () => {
    const user = await makeUser();
    const id = await submitAndApprove(user.cookie, { title: '线上标题' });

    await call('PATCH', `/api/calendar/${id}`, {
      json: input({ title: '被驳回的改动' }),
      cookie: user.cookie,
    });

    const result = rejectEvent({
      id,
      revision: 2,
      reason: '时间与公告不符',
      reviewerId: 'someone',
      now: Date.now(),
    });
    assert.ok(result);
    assert.equal(result.eventRejected, false, '驳回的是修改，不是事件本身');

    const row = getEventRow(id);
    assert.equal(row?.status, 'published', '线上必须还在站上');
    assert.equal(row?.title, '线上标题', '被驳回的改动绝不能写进线上');
    assert.equal(row?.pending_revision, null, '待审指针要清掉，否则再也改不动了');

    // 驳回之后必须能再次修改
    const again = await call('PATCH', `/api/calendar/${id}`, {
      json: input({ title: '再改一次' }),
      cookie: user.cookie,
    });
    assert.equal(again.status, 200, '驳回后必须能再次提交修改');
  });

  it('从未发布过的事件被驳回后，公开接口看不到它', async () => {
    const user = await makeUser();
    const created = await call('POST', '/api/calendar', { json: input(), cookie: user.cookie });
    const id = created.body.id as string;

    const result = rejectEvent({
      id,
      revision: 1,
      reason: '不是赛事',
      reviewerId: 'x',
      now: Date.now(),
    });
    assert.equal(result?.eventRejected, true);
    assert.equal(getEventRow(id)?.status, 'rejected');

    const detail = await call('GET', `/api/calendar/${id}`);
    assert.equal(detail.status, 404);
  });

  it('标签筛选：命中任意一个即可（多选语义）', async () => {
    const user = await makeUser();
    await submitAndApprove(user.cookie, { title: '只有赛事', tags: ['TOURNAMENT'] });
    await submitAndApprove(user.cookie, { title: '社区聚会', tags: ['COMMUNITY'] });

    const onlyCommunity = await call('GET', '/api/calendar?tags=COMMUNITY');
    const items = onlyCommunity.body.items as Array<Record<string, unknown>>;
    assert.equal(items.length, 1);
    assert.equal(items[0]?.title, '社区聚会');

    const both = await call('GET', '/api/calendar?tags=TOURNAMENT,COMMUNITY');
    assert.equal((both.body.items as unknown[]).length, 2);
  });

  it('★ 默认只列还没结束的；from=0 才显示历史', async () => {
    const user = await makeUser();
    /*
     * ⚠️ "很久以前"必须写进 `slots`：017 之后顶层 `startsAtLocal` 会被 Zod 剥掉，
     *    于是这一场仍然落在夹具默认的 2030 年、**混进"还没结束"那一档** ——
     *    那时这条用例红在"过去的赛事不该堆在默认列表顶上"，
     *    看起来像过滤逻辑写错了。
     *    （判据本身没变：读路径用的是包里那对 UTC 包络。）
     */
    await submitAndApprove(user.cookie, {
      title: '很久以前的比赛',
      slots: [{ startsAtLocal: '2020-01-01T12:00' }],
    });
    await submitAndApprove(user.cookie, { title: '未来的比赛' });

    const now = await call('GET', '/api/calendar');
    const future = (now.body.items as Array<Record<string, unknown>>).map((e) => e.title);
    assert.deepEqual(future, ['未来的比赛'], '过去的赛事不该堆在默认列表顶上');

    const all = await call('GET', '/api/calendar?from=0');
    assert.equal((all.body.items as unknown[]).length, 2);
  });

  it('入参非法时给出字段级错误（前端要能定位到具体哪一栏）', async () => {
    const user = await makeUser();
    const res = await call('POST', '/api/calendar', {
      json: input({ startsAtTz: 'Asia/Shangai' }),
      cookie: user.cookie,
    });
    assert.equal(res.status, 400);
    const issues = res.body.issues as Array<{ field: string; message: string }>;
    assert.ok(
      issues.some((i) => i.field === 'startsAtTz'),
      '错误要指向具体字段',
    );
  });
});
