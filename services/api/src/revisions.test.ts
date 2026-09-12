/**
 * 提交 → 待审 → 发布管线的测试。
 *
 * 这个文件里最重要的是「★ 验收标准」那几条 —— 它们锁住的是 M2 里
 * 一句话就能说清、但实现起来很容易搞错的行为：
 *
 *     用户改已发布条目 → 自动回 pending，且**线上仍是旧版**
 *
 * 这句话有两个要求，而它们在"用一个 status 字段表达一切"的模型里是矛盾的。
 * 测试必须**同时**验证两件事，只验一半的测试会让另一侧的 bug 溜过去：
 *   · 只验"回到 pending"  → 漏掉"线上被提前改掉了"
 *   · 只验"线上没变"      → 漏掉"修改实际上没提交成功"
 * 所以下面每条都用断言把两个方向都钉住。
 */
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.MCSR_MAIL_DRIVER = 'console';
process.env.MCSR_SCRYPT_TEST_PARAMS = 'N=1024,r=8,p=1';

// ⚠️ 这个文件在 src/ 根目录（不是 src/auth/），所以路径是 ./ 而不是 ../
//    写错之后的表现很特别：文件级的 ERR_MODULE_NOT_FOUND，
//    而同时其它测试文件照常跑完 —— 输出里只看得到"1 failed"，
//    很容易误以为是某条断言挂了。
const { app } = await import('./index');
const { closeDb, getDb } = await import('./db');
const { resetAll } = await import('./auth/ratelimit');
const { SITE } = await import('@mcsr/shared');

const PASSWORD = 'a good long passphrase';

interface Res {
  status: number;
  body: {
    ok?: boolean;
    error?: string;
    id?: string;
    revision?: number;
    status?: string;
    isEdit?: boolean;
    liveRevisionUnchanged?: boolean;
    liveVersionKept?: boolean;
    items?: Array<{
      resourceId: string;
      revision: number;
      isEdit: boolean;
      /** 只有 /admin/audit 的条目有这个字段 */
      action?: string;
    }>;
    total?: number;
    existingId?: string;
    [key: string]: unknown;
  };
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
    body: (await response.json().catch(() => ({}))) as Res['body'],
    setCookie: raw[0] ?? null,
  };
}

function cookiePair(setCookie: string | null): string {
  assert.ok(setCookie, '期望有 Set-Cookie');
  return setCookie.split(';')[0]!;
}

let seq = 0;
function uniqueEmail(): string {
  seq += 1;
  return `rev${String(seq)}.${Date.now()}-${String(Math.floor(Math.random() * 1000))}@example.com`;
}

/**
 * 造一个已验证邮箱的用户并登录。
 *
 * 直接用 SQL 把邮箱标记为已验证、顺手设好角色 —— 走接口的话要发一封邮件，
 * 而这里要测的是管线，不是邮箱验证（那部分在 auth.test.ts 里单独测）。
 */
async function makeUser(role: 'user' | 'reviewer' | 'admin' = 'user') {
  const email = uniqueEmail();
  await call('POST', '/api/auth/register', {
    json: { email, password: PASSWORD, displayName: `用户${String(seq)}`, locale: 'zh-CN' },
  });
  getDb()
    .prepare('UPDATE users SET email_verified_at = ?, role = ? WHERE email = ?')
    .run(Date.now(), role, email);

  const login = await call('POST', '/api/auth/login', { json: { email, password: PASSWORD } });
  assert.equal(login.status, 200, '登录应当成功');
  return { email, cookie: cookiePair(login.setCookie) };
}

const submission = (over: Record<string, unknown> = {}) => ({
  kind: 'website',
  title: '测试站点',
  titleEn: null,
  url: `https://example-${String(++seq)}.com/`,
  imageUrl: null,
  summary: '一句话简介',
  body: '正文内容',
  lang: 'en',
  tags: ['test'],
  ...over,
});

/** 公开列表里有没有这个 id。 */
function inPublicList(id: string): boolean {
  const rows = getDb()
    .prepare("SELECT id FROM resources WHERE status = 'published'")
    .all() as unknown as Array<{ id: string }>;
  return rows.some((r) => r.id === id);
}

/** resources 行上的内容 —— 也就是**线上版本**。 */
function liveContent(id: string): { title: string; body: string; current_revision: number | null } {
  const row = getDb()
    .prepare('SELECT title, body, current_revision FROM resources WHERE id = ?')
    .get(id) as { title: string; body: string; current_revision: number | null } | undefined;
  assert.ok(row, `条目 ${id} 应当存在`);

  /*
   * ⚠️ 显式展开成一个普通对象字面量，而不是直接把 row 返回。
   *
   * node:sqlite 返回的行对象的原型**不是 Object.prototype**，
   * 而 assert.deepEqual 在 strict 模式下是 deepStrictEqual —— 它会比较原型。
   * 于是 `assert.deepEqual(row, { ...同样的字段... })` 会失败，
   * 而失败信息里**实际值和期望值打印出来完全一样**，看得人一头雾水。
   * 展开之后两边都是普通字面量，既避免了这个问题，也让返回类型显式可读。
   */
  return { title: row.title, body: row.body, current_revision: row.current_revision };
}

/** 提交并批准一个条目，返回它的 id。 */
async function publishOne(author: { cookie: string }, reviewer: { cookie: string }, over = {}) {
  const created = await call('POST', '/api/resources', {
    json: submission(over),
    cookie: author.cookie,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id!;
  const approved = await call('POST', `/api/resources/${id}/approve`, { cookie: reviewer.cookie });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  return id;
}

beforeEach(() => {
  resetAll();
});

after(() => {
  closeDb();
});

// ---------------------------------------------------------------------------

describe('提交新条目', () => {
  it('未登录不能提交', async () => {
    const res = await call('POST', '/api/resources', { json: submission() });
    assert.equal(res.status, 401);
  });

  it('邮箱未验证不能提交（验证挡的是提交，不是登录）', async () => {
    const email = uniqueEmail();
    await call('POST', '/api/auth/register', {
      json: { email, password: PASSWORD, displayName: '没验证', locale: 'zh-CN' },
    });
    const login = await call('POST', '/api/auth/login', { json: { email, password: PASSWORD } });
    const cookie = cookiePair(login.setCookie);

    // 能登录（200），但提交会被 403 挡下，而且错误码要能区分于"没登录"
    const res = await call('POST', '/api/resources', { json: submission(), cookie });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'email_not_verified');
  });

  it('提交成功后是 pending，**不出现在公开列表里**', async () => {
    const author = await makeUser();
    const res = await call('POST', '/api/resources', { json: submission(), cookie: author.cookie });

    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'pending');
    assert.equal(res.body.isEdit, false);
    assert.equal(inPublicList(res.body.id!), false, '未审核的内容绝不能出现在公开列表里');
  });

  it('提交者不能自己设置 featured / official（服务端根本不接受这两个字段）', async () => {
    const author = await makeUser();
    const res = await call('POST', '/api/resources', {
      json: { ...submission(), featured: true, official: true },
      cookie: author.cookie,
    });
    assert.equal(res.status, 201);

    const row = getDb()
      .prepare('SELECT featured, official FROM resources WHERE id = ?')
      .get(res.body.id!) as { featured: number; official: number };
    assert.equal(row.featured, 0, '提交者不能把条目设成精选');
    assert.equal(row.official, 0, '提交者不能把条目设成官方');
  });

  it('同一个 URL 不能重复提交', async () => {
    const author = await makeUser();
    const payload = submission();
    const first = await call('POST', '/api/resources', { json: payload, cookie: author.cookie });
    assert.equal(first.status, 201);

    const second = await call('POST', '/api/resources', { json: payload, cookie: author.cookie });
    assert.equal(second.status, 409);
    assert.equal(second.body.error, 'url_exists');
    // 顺便把已有条目的 id 告诉他，前端可以直接给一个"去看那一条"的链接
    assert.equal(second.body.existingId, first.body.id);
  });

  it('末尾斜杠 / www 前缀 / 大小写不同的同一个 URL 也算重复', async () => {
    const author = await makeUser();
    await call('POST', '/api/resources', {
      json: submission({ url: 'https://Example.com/path' }),
      cookie: author.cookie,
    });
    for (const url of ['https://example.com/path/', 'https://www.example.com/path']) {
      const res = await call('POST', '/api/resources', {
        json: submission({ url }),
        cookie: author.cookie,
      });
      assert.equal(res.status, 409, `「${url}」应当被判为重复`);
    }
  });
});

describe('审核', () => {
  it('★ 普通用户提交 → 审核员通过 → 出现在公开列表', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');

    const id = await publishOne(author, reviewer);
    assert.equal(inPublicList(id), true);
  });

  it('普通用户不能审核', async () => {
    const author = await makeUser('user');
    const other = await makeUser('user');
    const created = await call('POST', '/api/resources', {
      json: submission(),
      cookie: author.cookie,
    });

    const res = await call('POST', `/api/resources/${created.body.id}/approve`, {
      cookie: other.cookie,
    });
    assert.equal(res.status, 403);
  });

  it('驳回必须给理由', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    const created = await call('POST', '/api/resources', {
      json: submission(),
      cookie: author.cookie,
    });

    const noReason = await call('POST', `/api/resources/${created.body.id}/reject`, {
      json: {},
      cookie: reviewer.cookie,
    });
    assert.equal(noReason.status, 400);

    const withReason = await call('POST', `/api/resources/${created.body.id}/reject`, {
      json: { reason: '这个站点已经关站了' },
      cookie: reviewer.cookie,
    });
    assert.equal(withReason.status, 200);
  });

  it('驳回一个**从未发布过**的条目 → 它不会出现在公开列表', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    const created = await call('POST', '/api/resources', {
      json: submission(),
      cookie: author.cookie,
    });
    const id = created.body.id!;

    await call('POST', `/api/resources/${id}/reject`, {
      json: { reason: '不符合收录标准' },
      cookie: reviewer.cookie,
    });

    assert.equal(inPublicList(id), false);
    const row = getDb().prepare('SELECT status FROM resources WHERE id = ?').get(id) as {
      status: string;
    };
    assert.equal(row.status, 'rejected');
  });

  it('重复批准返回 409，不会批准两次', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    const id = await publishOne(author, reviewer);

    const again = await call('POST', `/api/resources/${id}/approve`, { cookie: reviewer.cookie });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'nothing_pending');
  });

  it('待审队列里能看到待审项，并标出它是"新条目"还是"修改"', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    const created = await call('POST', '/api/resources', {
      json: submission(),
      cookie: author.cookie,
    });

    const queue = await call('GET', '/api/admin/queue', { cookie: reviewer.cookie });
    assert.equal(queue.status, 200);
    const item = queue.body.items!.find((i) => i.resourceId === created.body.id);
    assert.ok(item, '待审队列里应当有这条');
    assert.equal(item.isEdit, false, '新提交的条目 isEdit 应当是 false');
  });
});

describe('★ 验收标准：改已发布条目', () => {
  it('作者修改已发布条目 → 回到待审，**而线上内容一个字都没变**', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    const id = await publishOne(author, reviewer, { title: '原始标题', body: '原始正文' });

    // 前提确认
    assert.deepEqual(liveContent(id), { title: '原始标题', body: '原始正文', current_revision: 1 });

    // 作者提交修改
    const revised = await call('PATCH', `/api/resources/${id}`, {
      json: submission({ title: '改后的标题', body: '改后的正文', url: liveUrlOf(id) }),
      cookie: author.cookie,
    });
    assert.equal(revised.status, 200, JSON.stringify(revised.body));
    assert.equal(revised.body.status, 'pending');
    assert.equal(revised.body.isEdit, true);
    assert.equal(revised.body.liveRevisionUnchanged, true);

    // ★★ 这一条是整组测试的核心 ★★
    // 两个方向都要断言，缺一半就会漏掉另一侧的 bug。
    assert.deepEqual(
      liveContent(id),
      { title: '原始标题', body: '原始正文', current_revision: 1 },
      '线上内容必须仍然是旧版 —— 这就是整套管线的存在意义',
    );
    assert.equal(inPublicList(id), true, '条目必须仍然公开可见，不能因为有人改它就下线');

    // 再确认待审指针确实指向了新版本。
    //
    // ⚠️ 注意这里断言的是 `pending_revision`，**不是** `status === 'pending'`。
    //    我第一版就是写成后者，结果测试失败了 —— 而失败暴露的是我自己的理解偏差：
    //
    //    "回到待审"这件事由 `pending_revision` 表达。`resources.status`
    //    描述的是**线上内容**的状态，而线上内容没有变，所以它仍然是 published。
    //
    //    如果这里要求 status 变成 pending，那就等于要求"这条内容不再出现在
    //    公开列表里"（列表查的就是 status='published'）——
    //    那和验收标准的另一半「线上仍是旧版」直接矛盾。
    //    一句话里不可能同时要求"线上是旧版"和"线上不可见"。
    const row = getDb()
      .prepare('SELECT pending_revision, status FROM resources WHERE id = ?')
      .get(id) as { pending_revision: number | null; status: string };
    assert.equal(row.pending_revision, 2, '待审指针应当指向新版本');
    assert.equal(row.status, 'published', 'status 描述线上内容，线上没变所以它也不该变');

    // 而"回到待审"在功能上的落点是：审核队列里能重新看到它，
    // 并且标明这是一次**修改**（审核员需要对照旧版看改了什么）。
    const queue = await call('GET', '/api/admin/queue', { cookie: reviewer.cookie });
    const queued = queue.body.items!.find((i) => i.resourceId === id);
    assert.ok(queued, '修改应当重新出现在待审队列里');
    assert.equal(queued.isEdit, true, '队列必须标明这是对已发布条目的修改');
  });

  it('修改被批准后，线上才变成新版', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    const id = await publishOne(author, reviewer, { title: '原始标题', body: '原始正文' });

    await call('PATCH', `/api/resources/${id}`, {
      json: submission({ title: '改后的标题', body: '改后的正文', url: liveUrlOf(id) }),
      cookie: author.cookie,
    });

    const approved = await call('POST', `/api/resources/${id}/approve`, {
      cookie: reviewer.cookie,
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.revision, 2);

    assert.equal(liveContent(id).title, '改后的标题', '批准之后线上才更新');
    assert.equal(liveContent(id).current_revision, 2);
  });

  it('★ 修改被驳回 → 线上保留旧版，**条目不会从站上消失**', async () => {
    /*
     * 这一条防的是一类很具体的 bug：驳回时的状态回写。
     *
     * 如果驳回把 resources.status 一律设成 'rejected'，
     * 那么一个已经发布的老条目，只因为有人改了它一次没通过审核，
     * 就会**整条从站上消失**。而且这个 bug 只在"改已发布条目"这条路径上出现，
     * 新条目被驳回是看不出来的 —— 所以必须单独测。
     */
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    const id = await publishOne(author, reviewer, { title: '原始标题', body: '原始正文' });

    await call('PATCH', `/api/resources/${id}`, {
      json: submission({ title: '不该上线的标题', url: liveUrlOf(id), summary: 'x', body: 'y' }),
      cookie: author.cookie,
    });

    const rejected = await call('POST', `/api/resources/${id}/reject`, {
      json: { reason: '这次修改不行' },
      cookie: reviewer.cookie,
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.status, 'published', '条目应当保持已发布');
    assert.equal(rejected.body.liveVersionKept, true);

    assert.equal(inPublicList(id), true, '条目绝不能因为一次被驳回的修改就从站上消失');
    const live = liveContent(id);
    assert.equal(live.title, '原始标题', '线上仍是旧版');
    assert.equal(live.current_revision, 1);
  });

  it('有待审版本时，不能重复提交修改', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    const id = await publishOne(author, reviewer);
    const url = liveUrlOf(id);

    const first = await call('PATCH', `/api/resources/${id}`, {
      json: submission({ url, title: '改一次' }),
      cookie: author.cookie,
    });
    assert.equal(first.status, 200);

    const second = await call('PATCH', `/api/resources/${id}`, {
      json: submission({ url, title: '又改一次' }),
      cookie: author.cookie,
    });
    assert.equal(second.status, 409);
    assert.equal(second.body.error, 'already_pending');
  });

  it('别人不能改我的条目', async () => {
    const author = await makeUser();
    const other = await makeUser();
    const reviewer = await makeUser('reviewer');
    const id = await publishOne(author, reviewer);

    const res = await call('PATCH', `/api/resources/${id}`, {
      json: submission({ url: liveUrlOf(id) }),
      cookie: other.cookie,
    });
    assert.equal(res.status, 403);
    assert.deepEqual(liveContent(id).current_revision, 1, '被拒绝的修改不该动到任何东西');
  });

  it('导入的条目谁都不能编辑（author_id 为 NULL）', async () => {
    /*
     * 这条守的是"用严格相等比较来鉴别所有权"那个设计。
     * 如果实现里把 author_id 的 NULL 换成一个哨兵值（比如空字符串），
     * 这里就会变成"任何人都能改导入的条目"。
     */
    const reviewer = await makeUser('reviewer');
    const author = await makeUser();

    getDb()
      .prepare(
        `INSERT INTO resources (id, kind, title, url, body, lang, tags, featured, official, status, source, created_at, updated_at)
         VALUES ('imported-one', 'website', '导入的条目', 'https://imported.example/', '正文', 'en', '[]', 0, 0, 'published', 'import', ?, ?)`,
      )
      .run(Date.now(), Date.now());

    for (const [who, cookie] of [
      ['普通用户', author.cookie],
      ['审核员', reviewer.cookie],
    ] as const) {
      const res = await call('PATCH', '/api/resources/imported-one', {
        json: submission({ url: 'https://imported.example/' }),
        cookie,
      });
      assert.equal(res.status, 403, `${who} 不该能编辑导入的条目`);
    }
  });
});

describe('审计', () => {
  it('提交、批准、驳回都留下记录，而且是只读的', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    const created = await call('POST', '/api/resources', {
      json: submission(),
      cookie: author.cookie,
    });
    const id = created.body.id!;
    await call('POST', `/api/resources/${id}/approve`, { cookie: reviewer.cookie });

    const audit = await call('GET', '/api/admin/audit', { cookie: reviewer.cookie });
    assert.equal(audit.status, 200);
    const actions = (audit.body.items ?? []).map((i) => i.action);
    assert.ok(actions.includes('resource.submit'), '应当记录提交');
    assert.ok(actions.includes('resource.approve'), '应当记录批准');

    // 没有删除接口 —— §3 的约束之三：留痕但不可撤销
    const del = await call('DELETE', `/api/admin/audit/${id}`, { cookie: reviewer.cookie });
    assert.equal(del.status, 404, '不该存在删除审计的接口');
  });

  it('普通用户读不到审计', async () => {
    const user = await makeUser();
    const res = await call('GET', '/api/admin/audit', { cookie: user.cookie });
    assert.equal(res.status, 403);
  });
});

/** 取条目的真实 URL —— 修改时要带上，否则会撞上"URL 重复"的检查。 */
function liveUrlOf(id: string): string {
  const row = getDb().prepare('SELECT url FROM resources WHERE id = ?').get(id) as {
    url: string;
  };
  return row.url;
}
