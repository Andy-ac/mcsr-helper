/**
 * 日历接进**通用审核引擎**之后的端到端验收。
 *
 * ---------------------------------------------------------------------------
 * 这个文件补的是哪一块空白
 * ---------------------------------------------------------------------------
 * `calendar.test.ts` 守的是日历数据层的语义，但它的审核那一步是**直接调
 * `calendar/events.ts` 的 approve/reject** 的 —— 因为那时日历还没在
 * `review/registry.ts` 里注册，HTTP 审核路由（`/api/admin/review/calendar/:id`）
 * 会返回 404 unknown_type。
 *
 * 也就是说：在注册表接上之前，"日历的审核"这件事**只有测试能触发**，
 * 用户和审核员都够不到它。这个文件就是来关掉那个缺口的 ——
 * 它全程走 HTTP，走的是一行行真实的中间件、权限判定和审计留痕。
 *
 * ---------------------------------------------------------------------------
 * 三条最要紧的
 * ---------------------------------------------------------------------------
 * 1. **改已发布的事件，审核期间线上一个字都不能变**（设计约束 2）
 * 2. **驳回一次修改，线上那一版必须留在原地** —— 否则一次被驳回的修改
 *    会让线上内容凭空消失，那比"没改成功"严重得多
 * 3. **过去的事件仍然在队列里，而且被标成 expired**（Q4c）
 *
 * 还有一条不是日历特有的，但它只有在这里才能被验到：
 * **职责分离** —— reviewer 不能批准自己提交的日历事件（`canSelfReview`）。
 * 那条规则写在 shared/permissions.ts，但它在日历这条路上是否真的生效，
 * 取决于注册表有没有把 `mine` 算对。
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
  /*
   * 和 calendar.test.ts 一样：`:memory:` 库在整个文件里是同一个，
   * `resetAll()` 只清限流计数。上一个用例留下的待审条目会让下一个用例
   * 的"队列里应该有 N 条"直接错 —— 而症状是"过滤逻辑坏了"，很有迷惑性。
   */
  getDb().exec('DELETE FROM content_revisions');
  getDb().exec('DELETE FROM calendar_events');
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
async function makeUser(role: 'user' | 'reviewer' | 'editor' = 'user') {
  seq += 1;
  const email = `calrev${String(seq)}.${Date.now()}@example.com`;
  await call('POST', '/api/auth/register', {
    json: { email, password: PASSWORD, displayName: `日历审核${String(seq)}`, locale: 'zh-CN' },
  });
  getDb()
    .prepare('UPDATE users SET email_verified_at = ?, role = ? WHERE email = ?')
    .run(Date.now(), role, email);

  const login = await call('POST', '/api/auth/login', { json: { email, password: PASSWORD } });
  assert.equal(login.status, 200, '登录应当成功');
  return { email, cookie: (login.setCookie ?? '').split(';')[0] as string };
}

/** 一份合法的赛事入参。默认是**将来**的时间。 */
function input(overrides: Record<string, unknown> = {}) {
  return {
    title: '第 11 赛季资格赛',
    startsAtLocal: '2030-09-05T16:00',
    startsAtTz: 'Asia/Shanghai',
    tags: ['TOURNAMENT'],
    ...overrides,
  };
}

/** 提交一个事件，返回它的 id。 */
async function submit(cookie: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const created = await call('POST', '/api/calendar', { json: input(overrides), cookie });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body.id as string;
}

/** 直接读库里的那一行 —— 也就是"线上"的真实状态。 */
function row(id: string) {
  return getDb().prepare('SELECT * FROM calendar_events WHERE id = ?').get(id) as unknown as {
    title: string;
    starts_at_local: string;
    status: string;
    current_revision: number | null;
    pending_revision: number | null;
  };
}

// ---------------------------------------------------------------------------

describe('★ 日历接进审核引擎（走 HTTP，不再是数据层直调）', () => {
  it('★ 日历出现在队列里，而且带自己的计数 —— 注册表真的接上了', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    const id = await submit(author.cookie);

    const queue = await call('GET', '/api/admin/queue', { cookie: reviewer.cookie });
    assert.equal(queue.status, 200);
    assert.deepEqual(queue.body.types, ['resource', 'calendar']);

    const items = queue.body.items as Array<Record<string, unknown>>;
    const mine = items.find((i) => i.id === id);
    assert.ok(mine, '刚提交的日历事件应当出现在队列里');
    assert.equal(mine.type, 'calendar');
    assert.equal(mine.revision, 1);
    assert.equal(mine.title, '第 11 赛季资格赛');
    assert.equal(mine.isEdit, false, '全新事件不是"修改"');
    assert.equal(mine.mine, false, '审核员不是提交者');
    /*
     * ★ 副标题必须是**时间 + 时区**。
     *
     * 两场同名的比赛（同一届赛事的资格赛和正赛）唯一的区别就是时间，
     * 所以时间在列表里就得看得见。而时区名不能省 —— 单独一个 "16:00"
     * 是没有意义的信息（那是哪个 16:00？）。
     */
    assert.equal(mine.subtitle, '2030-09-05 16:00 · Asia/Shanghai');
    assert.equal(mine.expired, false, '将来的事件不是"已结束"');

    const counts = queue.body.counts as Record<string, number>;
    assert.equal(counts.calendar, 1, '日历的待审计数应当被算出来');
  });

  it('详情：新条目的 live 是 null，pending 是快照，note 单独摆出来', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    const id = await submit(author.cookie, {
      descriptionMd: '资格赛说明',
      noteToReviewer: '这是第 11 赛季的第一场，麻烦确认时间。',
      location: '线上',
    });

    const detail = await call('GET', `/api/admin/review/calendar/${id}`, {
      cookie: reviewer.cookie,
    });
    assert.equal(detail.status, 200, JSON.stringify(detail.body));

    const item = detail.body.item as Record<string, unknown>;
    assert.equal(item.type, 'calendar');
    assert.equal(item.isEdit, false);
    assert.equal(item.subtitle, '2030-09-05 16:00 · Asia/Shanghai');

    assert.equal(detail.body.live, null, '从未发布过的事件没有线上版本');

    const pending = detail.body.pending as Record<string, unknown>;
    assert.equal(pending.title, '第 11 赛季资格赛');
    assert.equal(pending.descriptionMd, '资格赛说明');
    assert.deepEqual(pending.tags, ['TOURNAMENT'], 'tags 应当是真数组，不是 JSON 字符串');
    assert.equal(pending.allDay, false, 'allDay 应当是布尔，不是 0/1');

    /*
     * ⚠️ 给审核员的话必须**单独一个字段**，不能混在 pending 里。
     *    混进去的话，审核员既可能把它当成要上线的正文，
     *    也可能在"改动对比"里把它当成一处内容改动。
     */
    assert.equal(detail.body.note, '这是第 11 赛季的第一场，麻烦确认时间。');
    assert.ok(!('noteToReviewer' in pending), 'noteToReviewer 不该出现在内容快照里');
  });

  it('★ 批准：事件上线，并出现在公开列表与 ICS 订阅里', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    const id = await submit(author.cookie);

    const approved = await call('POST', `/api/admin/review/calendar/${id}/approve`, {
      cookie: reviewer.cookie,
    });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.revision, 1);
    assert.equal(approved.body.status, 'published');
    assert.equal(approved.body.type, 'calendar');

    const after = row(id);
    assert.equal(after.status, 'published');
    assert.equal(after.current_revision, 1);
    assert.equal(after.pending_revision, null);

    // 公开列表里看得到了
    const list = await call('GET', '/api/calendar');
    assert.equal(list.status, 200);
    const ids = (list.body.items as Array<{ id: string }>).map((e) => e.id);
    assert.ok(ids.includes(id), '批准之后应当出现在公开日历里');

    // ICS 里也看得到了 —— 这是 M4 的第一条验收标准
    const ics = await call('GET', '/api/calendar.ics');
    assert.equal(ics.status, 200);
    assert.ok(ics.text.includes('SUMMARY:第 11 赛季资格赛'), 'ICS 里应当有这条事件');

    // 审核留痕：谁批的、批的哪一版
    const audit = await call('GET', '/api/admin/audit', { cookie: reviewer.cookie });
    const actions = (audit.body.items as Array<{ action: string }>).map((a) => a.action);
    assert.ok(actions.includes('calendar.approve'), '应当记一条 calendar.approve');
  });

  it('★ 驳回一个全新事件：它变成 rejected，公开接口再也看不到', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    const id = await submit(author.cookie);

    const rejected = await call('POST', `/api/admin/review/calendar/${id}/reject`, {
      cookie: reviewer.cookie,
      json: { reason: '时间写错了，应该是 17:00（Asia/Shanghai）。' },
    });
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
    assert.equal(rejected.body.status, 'rejected');
    assert.equal(rejected.body.liveVersionKept, false, '本来就没有线上版本，谈不上保留');

    assert.equal(row(id).status, 'rejected');

    const list = await call('GET', '/api/calendar');
    const ids = (list.body.items as Array<{ id: string }>).map((e) => e.id);
    assert.ok(!ids.includes(id), '被驳回的事件不该出现在公开列表里');

    const ics = await call('GET', '/api/calendar.ics');
    assert.ok(!ics.text.includes('第 11 赛季资格赛'), '被驳回的事件绝不能进订阅');
  });

  it('★★ 改已发布事件：审核期间线上一个字都没变', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    const id = await submit(author.cookie, {
      title: '原始标题',
      startsAtLocal: '2030-09-05T16:00',
    });

    await call('POST', `/api/admin/review/calendar/${id}/approve`, { cookie: reviewer.cookie });

    // 提一次修改
    const revised = await call('PATCH', `/api/calendar/${id}`, {
      cookie: author.cookie,
      json: input({ title: '改过的标题', startsAtLocal: '2030-09-05T18:00' }),
    });
    assert.equal(revised.status, 200, JSON.stringify(revised.body));
    assert.equal(revised.body.revision, 2);

    /*
     * ★ 这是整个设计的核心断言：**线上那一行没有被碰过**。
     *   不是"状态还是 published"，而是标题、时间都还是旧的那一份。
     */
    const during = row(id);
    assert.equal(during.title, '原始标题', '待审期间线上标题必须不变');
    assert.equal(during.starts_at_local, '2030-09-05T16:00', '待审期间线上时间必须不变');
    assert.equal(during.status, 'published');
    assert.equal(during.current_revision, 1, '线上仍然是 r1');
    assert.equal(during.pending_revision, 2, '待审的是 r2');

    // 详情里同时给出旧版和新版 —— 没有 live 就没法做"改了什么"的对照
    const detail = await call('GET', `/api/admin/review/calendar/${id}`, {
      cookie: reviewer.cookie,
    });
    assert.equal(detail.status, 200);
    assert.equal((detail.body.item as Record<string, unknown>).isEdit, true);
    assert.equal((detail.body.live as Record<string, unknown>).title, '原始标题');
    assert.equal((detail.body.pending as Record<string, unknown>).title, '改过的标题');

    // 公开页面也仍然是旧版
    const publicDetail = await call('GET', `/api/calendar/${id}`);
    assert.equal((publicDetail.body.event as Record<string, unknown>).title, '原始标题');

    // 批准之后才替换
    const approved = await call('POST', `/api/admin/review/calendar/${id}/approve`, {
      cookie: reviewer.cookie,
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.revision, 2);
    assert.equal(row(id).title, '改过的标题');
    assert.equal(row(id).current_revision, 2);
    assert.equal(row(id).pending_revision, null);
  });

  it('★★ 驳回对已发布事件的修改：线上那一版完整留在原地', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    const id = await submit(author.cookie, { title: '线上标题' });
    await call('POST', `/api/admin/review/calendar/${id}/approve`, { cookie: reviewer.cookie });

    await call('PATCH', `/api/calendar/${id}`, {
      cookie: author.cookie,
      json: input({ title: '被驳回的标题' }),
    });

    const rejected = await call('POST', `/api/admin/review/calendar/${id}/reject`, {
      cookie: reviewer.cookie,
      json: { reason: '标题改成这样会让老订阅者认不出来。' },
    });
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
    assert.equal(rejected.body.revision, 2);

    /*
     * ★ 两条都要：
     *   · status 仍然是 published（不是 rejected）—— 事件没有从站上消失
     *   · liveVersionKept 是 true —— 界面据此告诉审核员"老版本还在"
     *
     * 这正是 routes/review.ts 里那段注释说的事：它**不能**自己推
     * `resourceRejected ? 'rejected' : 'published'`，而要用服务端实际写进去的状态。
     */
    assert.equal(rejected.body.status, 'published');
    assert.equal(rejected.body.liveVersionKept, true);

    const after = row(id);
    assert.equal(after.status, 'published', '被驳回的修改不能让线上事件消失');
    assert.equal(after.title, '线上标题', '线上内容必须还是旧的那一版');
    assert.equal(after.current_revision, 1);
    assert.equal(after.pending_revision, null, '待审指针要清空，否则这个事件再也改不动');

    // 公开页面照旧
    const publicDetail = await call('GET', `/api/calendar/${id}`);
    assert.equal(publicDetail.status, 200);
    assert.equal((publicDetail.body.event as Record<string, unknown>).title, '线上标题');
  });

  it('★ 被驳回一次之后还能再改 —— 版本号不会撞车', async () => {
    /*
     * 这是 calendar/events.ts 的 reviseEvent 里被测试抓出来的那个真实 bug：
     * 版本号原来取 `max(current, pending) + 1`，而驳回会把 pending 清成 NULL，
     * 于是"已发布 r1 + 修改被驳回"之后再改一次又算出 2，撞上 UNIQUE 约束 ——
     * 那个事件从此再也改不动，而用户只看到一句服务器错误。
     */
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    const id = await submit(author.cookie);
    await call('POST', `/api/admin/review/calendar/${id}/approve`, { cookie: reviewer.cookie });

    await call('PATCH', `/api/calendar/${id}`, {
      cookie: author.cookie,
      json: input({ title: 'v2' }),
    });
    await call('POST', `/api/admin/review/calendar/${id}/reject`, {
      cookie: reviewer.cookie,
      json: { reason: '不行' },
    });

    const again = await call('PATCH', `/api/calendar/${id}`, {
      cookie: author.cookie,
      json: input({ title: 'v3' }),
    });
    assert.equal(again.status, 200, `被驳回之后必须还能再改：${JSON.stringify(again.body)}`);
    assert.equal(again.body.revision, 3, '版本号必须取历史最大值 + 1，不能从指针推');

    // 而且这一版还能正常批
    const approved = await call('POST', `/api/admin/review/calendar/${id}/approve`, {
      cookie: reviewer.cookie,
    });
    assert.equal(approved.status, 200);
    assert.equal(row(id).title, 'v3');
  });

  it('★ Q4c：已经结束的事件**仍然进队列**，并被标成已结束', async () => {
    /*
     * 用户明确要求"过去的事件仍然进审核队列"（而不是自动过期不进队列）。
     * 后果是队列里**真的会**出现三个月前那场比赛 —— 审核界面必须
     * 把这件事显著标出来，否则审核员会以为时间填错了。
     */
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');

    const id = await submit(author.cookie, {
      title: '很久以前的比赛',
      startsAtLocal: '2020-01-01T12:00',
      startsAtTz: 'Asia/Shanghai',
    });

    const queue = await call('GET', '/api/admin/queue', { cookie: reviewer.cookie });
    const mine = (queue.body.items as Array<Record<string, unknown>>).find((i) => i.id === id);
    assert.ok(mine, '过去的事件必须仍然在队列里（Q4c）');
    assert.equal(mine.expired, true, '必须被标成"已结束"');

    const detail = await call('GET', `/api/admin/review/calendar/${id}`, {
      cookie: reviewer.cookie,
    });
    assert.equal((detail.body.item as Record<string, unknown>).expired, true);

    /*
     * 而且它**能被批准** —— "时间在过去"不是拒绝的理由。
     * 如果哪天有人给这里加一条"过期不许批"的规则，这条断言会红。
     */
    const approved = await call('POST', `/api/admin/review/calendar/${id}/approve`, {
      cookie: reviewer.cookie,
    });
    assert.equal(approved.status, 200, '历史条目也应当可以被收录');

    // 但它**不进 ICS 订阅** —— 订阅导出的是"接下来会发生什么"（Q5）
    const ics = await call('GET', '/api/calendar.ics');
    assert.ok(!ics.text.includes('很久以前的比赛'), '已结束的事件不该出现在订阅里');
  });

  it('处理完之后再批准 → 409 nothing_pending（并发审核的正常结果）', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    const id = await submit(author.cookie);

    const first = await call('POST', `/api/admin/review/calendar/${id}/approve`, {
      cookie: reviewer.cookie,
    });
    assert.equal(first.status, 200);

    const second = await call('POST', `/api/admin/review/calendar/${id}/approve`, {
      cookie: reviewer.cookie,
    });
    assert.equal(second.status, 409);
    assert.equal(second.body.error, 'nothing_pending');

    // 详情也必须 404 —— 不能出现"队列里没有了但直接敲 URL 还能开"
    const detail = await call('GET', `/api/admin/review/calendar/${id}`, {
      cookie: reviewer.cookie,
    });
    assert.equal(detail.status, 404);
  });

  it('★ 职责分离：reviewer 不能批准自己提交的日历事件，但可以驳回', async () => {
    /*
     * 规则写在 shared/permissions.ts 的 canSelfReview 里，但它在日历这条路上
     * 是否真的生效，取决于注册表有没有把 `mine` 算对 —— 而 `mine` 是
     * `pending.editorId === viewerId`。填错的话这条测试会绿得毫无意义，
     * 所以下面还回过头验了一遍"另一个人批就没问题"。
     */
    const reviewer = await makeUser('reviewer');
    const id = await submit(reviewer.cookie, { title: '审核员自己提的' });

    const detail = await call('GET', `/api/admin/review/calendar/${id}`, {
      cookie: reviewer.cookie,
    });
    assert.equal((detail.body.item as Record<string, unknown>).mine, true, 'mine 必须算对');

    const selfApprove = await call('POST', `/api/admin/review/calendar/${id}/approve`, {
      cookie: reviewer.cookie,
    });
    assert.equal(selfApprove.status, 403);
    assert.equal(selfApprove.body.error, 'self_review');
    assert.equal(row(id).status, 'pending', '被拒之后必须还是待审');

    // 驳回自己提的 = 撤回，是允许的（否则 reviewer 没有退路）
    const other = await makeUser('reviewer');
    const othersView = await call('GET', `/api/admin/review/calendar/${id}`, {
      cookie: other.cookie,
    });
    assert.equal((othersView.body.item as Record<string, unknown>).mine, false);

    const otherApprove = await call('POST', `/api/admin/review/calendar/${id}/approve`, {
      cookie: other.cookie,
    });
    assert.equal(otherApprove.status, 200, '另一位审核员批准就没问题');
  });

  it('★ 审核员能驳回自己提的（等于撤回）', async () => {
    const reviewer = await makeUser('reviewer');
    const id = await submit(reviewer.cookie);

    const res = await call('POST', `/api/admin/review/calendar/${id}/reject`, {
      cookie: reviewer.cookie,
      json: { reason: '我自己撤回。' },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(row(id).status, 'rejected');
  });

  it('普通用户碰不到日历的审核（403），未登录 401', async () => {
    const author = await makeUser();
    const plain = await makeUser();
    const id = await submit(author.cookie);

    // 队列本身就需要至少一个审核能力
    assert.equal((await call('GET', '/api/admin/queue', { cookie: plain.cookie })).status, 403);

    const detail = await call('GET', `/api/admin/review/calendar/${id}`, { cookie: plain.cookie });
    assert.equal(detail.status, 403);
    assert.equal(detail.body.capability, 'calendar.review');

    const approve = await call('POST', `/api/admin/review/calendar/${id}/approve`, {
      cookie: plain.cookie,
    });
    assert.equal(approve.status, 403);

    const anon = await call('POST', `/api/admin/review/calendar/${id}/approve`);
    assert.equal(anon.status, 401);

    assert.equal(row(id).status, 'pending', '越权的尝试一次都不能改变状态');
  });

  it('驳回必须给理由（理由会原样发给提交者）', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    const id = await submit(author.cookie);

    const empty = await call('POST', `/api/admin/review/calendar/${id}/reject`, {
      cookie: reviewer.cookie,
      json: { reason: '   ' },
    });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error, 'invalid_input');
    assert.equal(row(id).status, 'pending', '没给理由就不能驳回');
  });

  it('editor 也有日历审核权（编辑是审核员的超集）', async () => {
    const author = await makeUser();
    const editor = await makeUser('editor');
    const id = await submit(author.cookie);

    const approved = await call('POST', `/api/admin/review/calendar/${id}/approve`, {
      cookie: editor.cookie,
    });
    assert.equal(approved.status, 200);
    assert.equal(row(id).status, 'published');
  });

  it('作者被驳回过几次 —— 统计只算**日历这一类**，不串到资源库头上', async () => {
    /*
     * 多态表（content_revisions）上的统计必须带 type 条件。
     * 不带的话，同一个人改资源库被驳回的记录也会算到他的日历提交头上，
     * 审核员看到的"被驳回过 5 次"里有一半来自另一个版块。
     */
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');

    // 先在**资源库**里制造一条被驳回的记录
    const resSubmit = await call('POST', '/api/resources', {
      cookie: author.cookie,
      json: {
        kind: 'website',
        title: '一个会被驳回的站点',
        titleEn: null,
        url: `https://rejected-${String(++seq)}.example.com/`,
        imageUrl: null,
        summary: null,
        body: '正文',
        lang: 'zh-CN',
        tags: [],
      },
    });
    assert.equal(resSubmit.status, 201, JSON.stringify(resSubmit.body));
    await call('POST', `/api/admin/review/resource/${String(resSubmit.body.id)}/reject`, {
      cookie: reviewer.cookie,
      json: { reason: '资源库那条驳回' },
    });

    const id = await submit(author.cookie);
    const detail = await call('GET', `/api/admin/review/calendar/${id}`, {
      cookie: reviewer.cookie,
    });
    assert.equal(detail.body.previousRejections, 0, '资源库的驳回记录不该算进日历的统计里');
  });
});
