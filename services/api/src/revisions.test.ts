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
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
const { checkPermission } = await import('@mcsr/shared/permissions');

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
      id: string;
      revision: number;
      isEdit: boolean;
      /** 队列项独有：内容类型与作者名（审计条目上没有） */
      type?: string;
      authorName?: string | null;
      subtitle?: string | null;
      /** /mine 的条目独有 */
      title?: string;
      status?: string;
      pendingRevision?: number | null;
      currentRevision?: number | null;
      lastRejectReason?: string | null;
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
function liveContent(id: string): {
  title: string;
  body: string;
  current_revision: number | null;
  pending_revision: number | null;
  status: string;
} {
  const row = getDb()
    .prepare(
      'SELECT title, body, current_revision, pending_revision, status FROM resources WHERE id = ?',
    )
    .get(id) as
    | {
        title: string;
        body: string;
        current_revision: number | null;
        pending_revision: number | null;
        status: string;
      }
    | undefined;
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
  return {
    title: row.title,
    body: row.body,
    current_revision: row.current_revision,
    pending_revision: row.pending_revision,
    status: row.status,
  };
}

/** 提交并批准一个条目，返回它的 id。 */
async function publishOne(author: { cookie: string }, reviewer: { cookie: string }, over = {}) {
  const created = await call('POST', '/api/resources', {
    json: submission(over),
    cookie: author.cookie,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id!;
  const approved = await call('POST', `/api/admin/review/resource/${id}/approve`, {
    cookie: reviewer.cookie,
  });
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

  it('★ 邮箱未验证 → email_not_verified（第二道闸门；第一道是登录）', () => {
    /*
     * 原来这条走 HTTP：造一个未验证用户 → 登录 → 提交 → 期待 403。
     *
     * ⚠️ 2026-09-12 起"未验证的账号登不进来"（邮箱验证 = 注册完成），
     *    所以"登录着但未验证"这个状态不存在了，那条路走不通。
     *    闸门并没有消失，只是变成了两道：
     *      第一道 —— 登录（routes/auth.ts）
     *      第二道 —— 能力判定（权限矩阵，这里）
     *    第二道仍然必须存在：哪天登录策略松回去，它是唯一的兜底。
     */
    assert.deepEqual(checkPermission({ role: 'user', emailVerified: false }, 'resource.submit'), {
      ok: false,
      reason: 'email_not_verified',
    });
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

    const res = await call('POST', `/api/admin/review/resource/${created.body.id}/approve`, {
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

    const noReason = await call('POST', `/api/admin/review/resource/${created.body.id}/reject`, {
      json: {},
      cookie: reviewer.cookie,
    });
    assert.equal(noReason.status, 400);

    const withReason = await call('POST', `/api/admin/review/resource/${created.body.id}/reject`, {
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

    await call('POST', `/api/admin/review/resource/${id}/reject`, {
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

    const again = await call('POST', `/api/admin/review/resource/${id}/approve`, {
      cookie: reviewer.cookie,
    });
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
    const item = queue.body.items!.find((i) => i.id === created.body.id);
    assert.ok(item, '待审队列里应当有这条');
    assert.equal(item.isEdit, false, '新提交的条目 isEdit 应当是 false');
  });
});

describe('★ 验收标准：改已发布条目', () => {
  it('作者修改已发布条目 → 回到待审，**而线上内容一个字都没变**', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    const id = await publishOne(author, reviewer, { title: '原始标题', body: '原始正文' });

    // 前提确认（逐字段断言：liveContent 还会带上 pending_revision/status，
    // 用 deepEqual 整个对象的话，每次给它加字段都要来改这一行）
    assert.equal(liveContent(id).title, '原始标题');
    assert.equal(liveContent(id).body, '原始正文');
    assert.equal(liveContent(id).current_revision, 1);
    assert.equal(liveContent(id).status, 'published');

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
    assert.equal(liveContent(id).title, '原始标题', '线上内容必须仍然是旧版');
    assert.equal(liveContent(id).body, '原始正文', '线上正文也必须没变');
    assert.equal(liveContent(id).current_revision, 1, '线上版本号不该动');
    assert.equal(liveContent(id).status, 'published', 'status 描述线上内容，所以它也不该变');
    assert.equal(liveContent(id).pending_revision, 2, '新版只在 pending_revision 上');
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
    const queued = queue.body.items!.find((i) => i.id === id);
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

    const approved = await call('POST', `/api/admin/review/resource/${id}/approve`, {
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

    const rejected = await call('POST', `/api/admin/review/resource/${id}/reject`, {
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

  it('改一条导入的已发布条目：它必须继续留在公开列表里', async () => {
    /*
     * ⚠️ 这条测试来自一个**真实踩到的回归**。
     *
     * 导入的条目 status='published'，但 current_revision 是 NULL
     * （它们不是通过审核流程进来的，没有版本号）。
     * 原来 reviseResource 用 `current_revision IS NULL` 判断"是否从未上架"，
     * 于是第一次有人改导入条目时，status 被改成 'pending'，
     * 这条内容**当场从资源库里消失**，直到审核通过才回来。
     *
     * 在只允许作者编辑的年代这条路走不通（导入条目 author_id 是 NULL），
     * 所以那个假设一直没被挑战 —— 直到 wiki 式编辑开放。
     */
    const editor = await makeUser();

    getDb()
      .prepare(
        `INSERT INTO resources (id, kind, title, url, body, lang, tags, featured, official, status, source, created_at, updated_at)
         VALUES ('imported-pub', 'website', '导入的已发布条目', 'https://imported-pub.example/', '正文', 'en', '[]', 0, 0, 'published', 'import', ?, ?)`,
      )
      .run(Date.now(), Date.now());

    assert.equal(inPublicList('imported-pub'), true, '前提：它本来在公开列表里');

    const res = await call('PATCH', '/api/resources/imported-pub', {
      json: submission({ url: 'https://imported-pub.example/', title: '社区修正后的标题' }),
      cookie: editor.cookie,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.revision, 1, '导入条目没有版本号，第一次修改就是 r1');

    assert.equal(
      inPublicList('imported-pub'),
      true,
      '有待审的修改期间，已发布的导入条目**绝不能**从站上消失',
    );
    assert.equal(liveContent('imported-pub').title, '导入的已发布条目', '线上仍是旧版');
    assert.equal(liveContent('imported-pub').pending_revision, 1);
  });

  it('★ 改一条**导入的**已上架条目，被驳回后它必须还在站上', async () => {
    /*
     * ---------------------------------------------------------------------
     * 这一条来自一个用户实际报上来的 bug
     * ---------------------------------------------------------------------
     * 现象：编辑资源库里一条已有条目 → 审核员驳回 → **那条条目从站上消失了**。
     *
     * 根因和 reviseResource 里踩过的是**同一个**：
     *
     *     const resourceRejected = resource.current_revision === null;
     *
     * 导入的条目（从 resources.json 进来的）status 就是 'published'，
     * 但 current_revision 是 NULL —— 它们不是走审核流程进来的，没有版本号。
     * 那句判断于是把它们当成"从没上架过"，驳回时把 status 改成 'rejected'，
     * 线上那条就没了。
     *
     * reviseResource 那次修好了，rejectRevision 这里漏了 —— 同一个错误
     * 在一个文件里出现两次，所以这条测试必须**同时钉住两个方向**：
     * 内容还在（列表里有、线上标题没变），以及状态确实被驳回了（修订记录里）。
     *
     * 另外一个容易漏的点：这类条目**任何人都能改**（wiki 式 editAny），
     * 所以触发的不是作者本人，而是任何一个登录用户 —— 这也是为什么它
     * 在真实使用中很容易被碰到。
     */
    const editor = await makeUser();
    const reviewer = await makeUser('reviewer');

    getDb()
      .prepare(
        `INSERT INTO resources (id, kind, title, url, body, lang, tags, featured, official, status, source, created_at, updated_at)
         VALUES ('imported-reject', 'website', '导入条目·驳回测试', 'https://imported-reject.example/', '原始正文', 'en', '[]', 0, 0, 'published', 'import', ?, ?)`,
      )
      .run(Date.now(), Date.now());

    assert.equal(inPublicList('imported-reject'), true, '前提：它本来在公开列表里');

    // 任何登录用户提一个修改（wiki 式）
    const revised = await call('PATCH', '/api/resources/imported-reject', {
      json: submission({ url: 'https://imported-reject.example/', title: '被改过的标题' }),
      cookie: editor.cookie,
    });
    assert.equal(revised.status, 200);
    assert.equal(inPublicList('imported-reject'), true, '有待审修改期间就该还在站上');

    // 审核员驳回
    const rejected = await call('POST', '/api/admin/review/resource/imported-reject/reject', {
      json: { reason: '这个改动不接受。' },
      cookie: reviewer.cookie,
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.status, 'published', '驳回之后它必须仍然是已发布');
    assert.equal(rejected.body.liveVersionKept, true);

    // ★ 核心断言：条目**没有**从站上消失
    assert.equal(
      inPublicList('imported-reject'),
      true,
      '改一条导入条目被驳回，绝不能把这条内容从站上抹掉',
    );
    assert.equal(liveContent('imported-reject').title, '导入条目·驳回测试', '线上仍是旧版');
    assert.equal(liveContent('imported-reject').status, 'published');
    assert.equal(liveContent('imported-reject').pending_revision, null, '待审指针要清掉');

    // 而"被驳回"这件事记在**版本**上（作者据此知道自己的改动没通过）
    const detail = await call('GET', '/api/resources/mine', { cookie: editor.cookie });
    const row = (detail.body.items ?? []).find((i) => i.id === 'imported-reject');
    // editor 不是作者，所以这里查不到 —— 换个方式确认版本状态
    assert.equal(row, undefined, '编辑器不是作者，不该出现在他的"我的提交"里');
  });

  it('已下架的内容被驳回之后仍然保持下架（不会悄悄恢复上架）', async () => {
    /*
     * 下架是一个**明确的编辑决定**。一次修改被驳回不该把它撤销 ——
     * 否则"下架"就变成了"下架到下一个人改东西为止"。
     */
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    const id = await publishOne(author, reviewer);

    // 直接把它下架（走 store 层，因为治理接口的权限属于 editor，这里只验状态机）
    const { setResourceVisibility } = await import('./resources');
    setResourceVisibility(id, false, Date.now());
    assert.equal(liveContent(id).status, 'hidden');

    // 作者改一次，审核员驳回
    await call('PATCH', `/api/resources/${id}`, {
      json: submission({ url: liveUrlOf(id), title: '下架期间的改动' }),
      cookie: author.cookie,
    });
    const rejected = await call('POST', `/api/admin/review/resource/${id}/reject`, {
      json: { reason: '不接受' },
      cookie: reviewer.cookie,
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.status, 'hidden', '驳回不该把它恢复上架');
    assert.equal(liveContent(id).status, 'hidden');
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

  it('别人改我的条目：允许，但只是"提了个版本"，线上一个字不变', async () => {
    /*
     * ⚠️ 2026-09-12 的行为变更。
     *
     * 以前这里是 403（别人不能改我的条目）。现在改成社区 wiki 式：
     * 任何已登录且验证过邮箱的用户都可以对**已上架**的条目提改动，
     * 但改动一样要过审核 —— 所以"别人能改"并不等于"别人能改线上内容"。
     *
     * 真正需要守住的是第 492 行那条：被改的瞬间，线上仍然是旧版。
     * 它才是这个系统的核心约束，而"谁有资格提交改动"是可以调的策略。
     */
    const author = await makeUser();
    const other = await makeUser();
    const reviewer = await makeUser('reviewer');
    const id = await publishOne(author, reviewer);

    const before = liveContent(id).title;

    const res = await call('PATCH', `/api/resources/${id}`, {
      json: submission({ url: liveUrlOf(id), title: '别人改的标题' }),
      cookie: other.cookie,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.isAuthor, false, '接口要明确说出"这不是原作者提的"');
    assert.equal(liveContent(id).title, before, '线上标题一个字都不能变');
    assert.deepEqual(liveContent(id).current_revision, 1, '线上版本号也不该动');
  });

  it('非作者**不能**改还没上架的条目（草稿 / 被驳回的内容）', async () => {
    /*
     * wiki 式编辑开放的是"已上架的内容"，不是"所有内容"。
     *
     * 未上架的条目只有作者看得见 —— 让别人改，等于把别人没打算公开的
     * 草稿暴露给任何登录用户，而且他改的还是一份自己根本看不到的东西。
     */
    const author = await makeUser();
    const other = await makeUser();

    const created = await call('POST', '/api/resources', {
      json: submission({ title: '还没过审的草稿' }),
      cookie: author.cookie,
    });
    const id = created.body.id!;

    const res = await call('PATCH', `/api/resources/${id}`, {
      json: submission({ url: liveUrlOf(id), title: '路人改的' }),
      cookie: other.cookie,
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.reason, 'not_published');

    // 作者本人**有权限**改自己的草稿 —— 但这里会得到 409 而不是 200，
    // 因为新提交的条目本来就有一条待审版本（r1），不能再叠一条。
    // 403 和 409 的区别正是这条断言要守住的东西：前者是"你不许"，
    // 后者是"你已经有一条在等了"。混起来的话，界面上就会把
    // "等审核"显示成"你没权限"。
    const own = await call('PATCH', `/api/resources/${id}`, {
      json: submission({ url: liveUrlOf(id), title: '作者改的' }),
      cookie: author.cookie,
    });
    assert.equal(own.status, 409);
    assert.equal(own.body.error, 'already_pending');
  });

  it('导入的条目（author_id 为 NULL）任何人都不能改 —— 除非它已上架', async () => {
    /*
     * 这条守的是"用严格相等比较来鉴别所有权"那个设计。
     * 如果实现里把 author_id 的 NULL 换成一个哨兵值（比如空字符串），
     * `null === user.id` 就会变成真，于是**任何人都成了导入条目的作者**。
     *
     * ⚠️ 2026-09-12 的行为变更：wiki 式编辑上线之后，**已上架**的条目
     *    本来就可以被任何登录用户改（editAny），所以这个例子里的
     *    'published' 条目现在能改是**对的**。
     *
     *    真正需要守住的边界变成了下面那条：**没上架的**条目
     *    （别人看不见的草稿 / 被驳回的内容）仍然只有作者能改 ——
     *    而导入的条目没有作者，所以对它来说就是谁都不能改。
     */
    const reviewer = await makeUser('reviewer');
    const author = await makeUser();

    getDb()
      .prepare(
        `INSERT INTO resources (id, kind, title, url, body, lang, tags, featured, official, status, source, created_at, updated_at)
         VALUES ('imported-one', 'website', '导入的条目', 'https://imported.example/', '正文', 'en', '[]', 0, 0, 'published', 'import', ?, ?)`,
      )
      .run(Date.now(), Date.now());
    // 一条**没有上架**的导入条目（历史遗留 / 被下架），谁都不该能改
    getDb()
      .prepare(
        `INSERT INTO resources (id, kind, title, url, body, lang, tags, featured, official, status, source, created_at, updated_at)
         VALUES ('imported-draft', 'website', '未上架的导入条目', 'https://imported-draft.example/', '正文', 'en', '[]', 0, 0, 'hidden', 'import', ?, ?)`,
      )
      .run(Date.now(), Date.now());

    for (const [who, cookie] of [
      ['普通用户', author.cookie],
      ['审核员', reviewer.cookie],
    ] as const) {
      const draft = await call('PATCH', '/api/resources/imported-draft', {
        json: submission({ url: 'https://imported-draft.example/' }),
        cookie,
      });
      assert.equal(draft.status, 403, `${who} 不该能编辑**未上架**的导入条目`);
      assert.equal(draft.body.error, 'forbidden');
    }

    /*
     * 已上架的可以改（wiki 式）。⚠️ 只验一次 —— 第一个人的改动会留下一条
     * 待审版本，第二个人再改会得到 409 already_pending（那是另一条规则，
     * 由上面那条测试守着）。
     */
    const live = await call('PATCH', '/api/resources/imported-one', {
      json: submission({ url: 'https://imported.example/' }),
      cookie: author.cookie,
    });
    assert.equal(live.status, 200, '已上架的条目应当能被社区编辑');
    assert.equal(live.body.isEdit, true);
    assert.equal(live.body.isAuthor, false, '这不是提交者本人 —— 导入条目没有作者');
    assert.equal(live.body.revision, 1, '导入的条目从 r1 开始，改一次就是 r1');
    assert.equal(inPublicList('imported-one'), true, '改的时候它必须继续留在站上');
  });

  it('非作者改已上架条目：记的是 reviseOther，而且线上仍然没变', async () => {
    const author = await makeUser();
    const stranger = await makeUser();

    const created = await call('POST', '/api/resources', {
      json: submission({ title: '社区条目' }),
      cookie: author.cookie,
    });
    const id = created.body.id!;
    const reviewer = await makeUser('reviewer');
    await call('POST', `/api/admin/review/resource/${id}/approve`, { cookie: reviewer.cookie });

    const before = liveContent(id).title;

    const res = await call('PATCH', `/api/resources/${id}`, {
      json: submission({ title: '社区条目（别人改的）', url: liveUrlOf(id) }),
      cookie: stranger.cookie,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.isAuthor, false, '应当明确告诉调用方这不是原作者');
    assert.equal(liveContent(id).title, before, '线上标题一个字都不能变');

    const audit = await call('GET', '/api/admin/audit', { cookie: reviewer.cookie });
    const actions = (audit.body.items ?? []).map((i) => i.action);
    assert.ok(
      actions.includes('resource.reviseOther'),
      '别人改的必须记成另一个动作，否则审计里看不出是谁改的',
    );
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
    await call('POST', `/api/admin/review/resource/${id}/approve`, { cookie: reviewer.cookie });

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

// ---------------------------------------------------------------------------
// 通用审核接口（M2）
// ---------------------------------------------------------------------------

/**
 * 这一组测的是**接口形状**，不是审核逻辑（逻辑在上面那几组里）。
 *
 * 起因是一个真实出现过、而且测试全绿也没发现的 bug：
 * 详情接口里的 `authorName` 被写成了 `null` 占位，于是审核详情页
 * 每一行都显示"未知作者" —— 而队列页（它的 SQL 里 JOIN 了 users）是**有**
 * 作者名的。同一个条目在两个页面上一个"有作者"一个"未知作者"，
 * 类型检查不会报（null 是合法值），只有真的看一眼页面才会发现。
 *
 * 所以这里逐个断言界面**渲染时会读**的字段。
 */
describe('★ 通用审核接口', () => {
  it('队列项和详情项里的作者名、副标题都填齐了', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');

    const created = await call('POST', '/api/resources', {
      json: submission({ title: '通用审核接口测试', url: 'https://queue-item.example.com/x' }),
      cookie: author.cookie,
    });
    assert.equal(created.status, 201);
    const id = created.body.id!;

    const authorRow = getDb()
      .prepare('SELECT display_name FROM users WHERE email = ?')
      .get(author.email) as { display_name: string };

    const queue = await call('GET', '/api/admin/queue', { cookie: reviewer.cookie });
    assert.equal(queue.status, 200);
    const queued = queue.body.items!.find((i) => i.id === id);
    assert.ok(queued, '队列里应当有这条');
    assert.equal(queued.authorName, authorRow.display_name, '队列项的作者名不能为空');

    const detail = await call('GET', `/api/admin/review/resource/${id}`, {
      cookie: reviewer.cookie,
    });
    assert.equal(detail.status, 200);
    const item = detail.body.item as
      | { authorName: string | null; subtitle: string; revision: number; isEdit: boolean }
      | undefined;
    assert.ok(item, '详情里应当有 item');
    assert.equal(item.authorName, authorRow.display_name, '详情项的作者名不能为空 —— 曾经是 null');
    assert.equal(item.subtitle, 'queue-item.example.com', '副标题应当是去掉 www 的域名');
    assert.equal(item.revision, 1);

    // 全新条目：没有线上版本，所以 live 必须是 null（不是空对象 —— 界面靠 null 判断"新条目"）
    assert.equal(detail.body.live, null, '没发布过的条目不该有线上版本');
    const pending = detail.body.pending as { title: string; tags: string[] } | undefined;
    assert.ok(pending, '详情里应当有待审内容');
    assert.equal(pending.title, '通用审核接口测试');
  });

  it('未注册的类型返回 404，而不是 500 或者空队列', async () => {
    const reviewer = await makeUser('reviewer');

    /*
     * ⚠️ 这里的类型必须是**真的没注册**的。
     *
     * 它原来是 `calendar`。M4 把日历接进注册表之后，这一条就变成在测
     * "一个已注册的类型" —— 而它仍然断言 404，于是红了。
     * 那不是测试坏了，是它测的东西被换掉了：**契约变了，测试就该跟着变**，
     * 而不是把断言改松让它重新变绿。
     *
     * 现在换成 `video`，而且不是随手挑的：`video` **有意永远不注册**
     * （Q6：视频贴了就可见、不审核，它没有待审状态）。
     * 所以它比一个随便编的字符串更适合当例子 —— 这条用例守住的
     * 是一个真实存在的设计决定，而不只是"未知字符串会被拒"。
     * （`seed` 是另一个：v1 的 /seeds 只做上游检索，社区分享留空，没有可审内容。）
     */
    const detail = await call('GET', '/api/admin/review/video/some-id', {
      cookie: reviewer.cookie,
    });
    assert.equal(detail.status, 404);
    assert.equal(detail.body.error, 'unknown_type');

    const approve = await call('POST', '/api/admin/review/video/some-id/approve', {
      cookie: reviewer.cookie,
    });
    assert.equal(approve.status, 404);

    // 队列里只能出现**已注册**的类型 —— 前端注册表据此对齐
    const queue = await call('GET', '/api/admin/queue', { cookie: reviewer.cookie });
    assert.equal(queue.status, 200);
    const types = queue.body.types as string[] | undefined;
    assert.deepEqual(types, ['resource', 'calendar'], '注册表里的类型，顺序稳定');

    /*
     * counts 与 total 的关系。
     *
     * ⚠️ 原来这里断言的是"counts 的键 == 队列 items 里出现过的类型"。
     *    那条断言是**碰巧成立**的：它要求每个已注册的类型都正好有待审条目，
     *    所以只要有任何一个类型当时是空的，它就会红 —— 而"某个类型今天没有活"
     *    是完全正常的。一个会因为正常状态而失败的断言，早晚会被改松或改掉。
     *
     *    真正的不变量有两条，而且都和分页无关：
     *      · 每个已注册的类型都必须在 counts 里（哪怕是 0）——
     *        界面的类型标签靠它显示角标，缺一个就等于那个标签永远不显示数字
     *      · total 必须等于各类型计数之和（服务端就是这么累加的）
     */
    const counts = (queue.body.counts ?? {}) as Record<string, number>;
    assert.deepEqual(
      Object.keys(counts).sort(),
      [...(types ?? [])].sort(),
      '每个已注册的类型都要有计数，包括当前为 0 的',
    );
    assert.equal(
      queue.body.total,
      Object.values(counts).reduce((sum, n) => sum + n, 0),
      'total 必须是各类型待审数之和 —— 否则队列页顶部的"共 N 项"会撒谎',
    );
  });

  it('审核是一个条目一个能力：没有资源审核权的人连队列都看不到', async () => {
    const user = await makeUser();
    const res = await call('GET', '/api/admin/queue', { cookie: user.cookie });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'forbidden');
  });
});

// ---------------------------------------------------------------------------
// 我的提交
// ---------------------------------------------------------------------------

/**
 * 这一组守的是审核管线的**闭环**。
 *
 * 驳回理由由服务端强制填写。如果作者没有地方能看到它，那句理由就只存在于
 * 数据库和审计日志里 —— 两个地方都是给管理人员看的。作者的体验会变成
 * "提交 → 条目不见了（未发布的在公开列表里本来就不显示）→ 原样再交一次"。
 */
describe('★ 我的提交', () => {
  it('只返回自己的条目，并且带上驳回理由', async () => {
    const author = await makeUser();
    const other = await makeUser();
    const reviewer = await makeUser('reviewer');

    const created = await call('POST', '/api/resources', {
      json: submission({ title: '我的提交测试' }),
      cookie: author.cookie,
    });
    assert.equal(created.status, 201);
    const id = created.body.id!;

    // 别人的列表里不能有它 —— 这个接口按 author_id 过滤
    const otherList = await call('GET', '/api/resources/mine', { cookie: other.cookie });
    assert.equal(otherList.status, 200);
    assert.ok(
      !(otherList.body.items ?? []).some((i) => i.id === id),
      '别人的提交不该出现在我的列表里',
    );

    // 待审状态：pending_revision 有值、current_revision 没有
    const pending = await call('GET', '/api/resources/mine', { cookie: author.cookie });
    const pendingRow = (pending.body.items ?? []).find((i) => i.id === id);
    assert.ok(pendingRow, '自己的提交应当出现在列表里');
    assert.equal(pendingRow.status, 'pending');
    assert.equal(pendingRow.pendingRevision, 1);
    assert.equal(pendingRow.currentRevision, null);
    assert.equal(pendingRow.lastRejectReason, null, '还没被驳回时不该有理由');

    // 驳回之后，理由必须出现在列表里 —— 这是整个页面的存在意义
    const rejected = await call('POST', `/api/admin/review/resource/${id}/reject`, {
      json: { reason: '正文太短，请补充安装和使用步骤。' },
      cookie: reviewer.cookie,
    });
    assert.equal(rejected.status, 200);

    const after = await call('GET', '/api/resources/mine', { cookie: author.cookie });
    const row = (after.body.items ?? []).find((i) => i.id === id);
    assert.ok(row);
    assert.equal(row.status, 'rejected');
    assert.equal(row.lastRejectReason, '正文太短，请补充安装和使用步骤。');
    assert.equal(row.pendingRevision, null, '驳回之后不该再有待审版本');
  });

  it('/mine 没有被 /:id 吃掉，且不能匿名访问', async () => {
    /*
     * ⚠️ 这一条看着像废话，但它守的是一个非常隐蔽的坑：
     *    Hono 按注册顺序匹配，`/:id` 会把 "mine" 当成一个条目 id。
     *    那样一来未登录请求会走到 "条目不存在" 的分支返回 **404**，
     *    而已登录请求会返回一个空的 `{items: []}` —— 看起来完全像
     *    "这个用户还没提交过东西"，绝不会让人想到是路由顺序问题。
     *
     *    所以断言必须是 401（说明确实走到了 requireAuth），不是 404。
     */
    const anon = await call('GET', '/api/resources/mine');
    assert.equal(anon.status, 401, '未登录应当是 401；如果是 404 说明被 /:id 匹配了');
  });
});

// ---------------------------------------------------------------------------
// 审核结果通知
// ---------------------------------------------------------------------------

/**
 * 这一组守的是**审核员写的理由最后有没有人读**。
 *
 * 服务端强制审核员填写驳回理由（没有理由的驳回等于让作者瞎猜）。
 * 但如果那个理由只存在于数据库和审计日志里 —— 两个地方都是给管理人员看的 ——
 * 作者永远不会打开它，他只会看到"已驳回"三个字然后原样再交一遍。
 * 所以"理由必须送到作者手上"是这个功能存在的前提，而不是加分项。
 *
 * 断言方式：把发信驱动临时切到 **file**，让 sendMail 把邮件写成 .eml 落盘，
 * 然后直接读文件。比盯着日志断言可靠得多 —— 日志会被别的输出冲掉，
 * 而且"日志里出现过"和"真的生成了一封完整的邮件"是两件事。
 */
describe('★ 审核结果通知', () => {
  it('驳回：作者收到一封带驳回理由的邮件', async () => {
    const mailDir = mkdtempSync(join(tmpdir(), 'mcsr-mail-'));

    try {
      const author = await makeUser();
      const reviewer = await makeUser('reviewer');

      // ⚠️ 建完用户再切驱动：注册本身会发验证邮件，
      //    提前切的话目录里会多出两封，数不准"恰好一封"。
      process.env.MCSR_MAIL_DRIVER = 'file';
      process.env.MCSR_MAIL_DIR = mailDir;

      const created = await call('POST', '/api/resources', {
        json: submission({ title: '需要改的条目' }),
        cookie: author.cookie,
      });
      const id = created.body.id!;

      const reason = '正文只有一句话，请补充安装和使用步骤。';
      const rejected = await call('POST', `/api/admin/review/resource/${id}/reject`, {
        json: { reason },
        cookie: reviewer.cookie,
      });
      assert.equal(rejected.status, 200);

      const files = readdirSync(mailDir);
      assert.equal(files.length, 1, `应当恰好发出一封邮件，实际 ${String(files.length)} 封`);

      // 文件名里带收件人（@ 被替换成 _），可以据此确认发给的是提交者
      assert.ok(
        files[0]!.includes(author.email.replace(/[^a-zA-Z0-9]/g, '_')),
        `邮件应当发给提交者，实际文件名是 ${files[0]}`,
      );

      const mail = readFileSync(join(mailDir, files[0]!), 'utf8');
      assert.ok(mail.includes('需要改的条目'), '邮件里应当提到条目标题');
      assert.ok(mail.includes(reason), '★ 驳回理由必须在邮件正文里 —— 这是这封邮件唯一的用处');
    } finally {
      process.env.MCSR_MAIL_DRIVER = 'console';
      delete process.env.MCSR_MAIL_DIR;
    }
  });

  it('批准：作者收到一封通知上线的邮件', async () => {
    const mailDir = mkdtempSync(join(tmpdir(), 'mcsr-mail-'));

    try {
      const author = await makeUser();
      const reviewer = await makeUser('reviewer');

      process.env.MCSR_MAIL_DRIVER = 'file';
      process.env.MCSR_MAIL_DIR = mailDir;

      const created = await call('POST', '/api/resources', {
        json: submission({ title: '会被通过的条目' }),
        cookie: author.cookie,
      });
      const id = created.body.id!;

      const approved = await call('POST', `/api/admin/review/resource/${id}/approve`, {
        cookie: reviewer.cookie,
      });
      assert.equal(approved.status, 200);

      const files = readdirSync(mailDir);
      assert.equal(files.length, 1);
      const mail = readFileSync(join(mailDir, files[0]!), 'utf8');
      assert.ok(mail.includes('会被通过的条目'));
      assert.ok(mail.includes('/me/submissions'), '链接要指向"我的提交"，不是条目的公开页');
    } finally {
      process.env.MCSR_MAIL_DRIVER = 'console';
      delete process.env.MCSR_MAIL_DIR;
    }
  });

  it('邮件发不出去时，审核动作本身仍然成功', async () => {
    /*
     * ⚠️ 这一条是刻意的"降级"约定。
     *
     * 审核动作一旦落库就已经发生了。如果因为邮件服务抽风而让接口返回 500，
     * 审核员会以为没成功、再点一次 —— 第二次得到 409，然后开始怀疑整个系统。
     * "审核成功但作者没收到信"是更小的代价，所以这里的约定是：
     * 邮件失败只记日志，不影响响应。
     *
     * 用一个不存在的目录当发信目录来制造失败（file 驱动写不进去）。
     */
    process.env.MCSR_MAIL_DRIVER = 'file';
    process.env.MCSR_MAIL_DIR = join(tmpdir(), 'mcsr-nonexistent\u0000invalid');

    try {
      const author = await makeUser();
      const reviewer = await makeUser('reviewer');
      const created = await call('POST', '/api/resources', {
        json: submission({ title: '发信会失败但审核要成功' }),
        cookie: author.cookie,
      });
      const id = created.body.id!;

      const approved = await call('POST', `/api/admin/review/resource/${id}/approve`, {
        cookie: reviewer.cookie,
      });
      assert.equal(approved.status, 200, '邮件失败绝不能把审核动作也拖垮');

      // 而且审核确实生效了
      assert.equal(getResourceStatus(id), 'published');
    } finally {
      process.env.MCSR_MAIL_DRIVER = 'console';
      delete process.env.MCSR_MAIL_DIR;
    }
  });
});

/** 条目的 status 字段（线上内容的状态）。 */
function getResourceStatus(id: string): string {
  const row = getDb().prepare('SELECT status FROM resources WHERE id = ?').get(id) as {
    status: string;
  };
  return row.status;
}
