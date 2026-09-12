/**
 * 内容治理接口的权限与行为。
 *
 * 这是 M2 之后新增的一块**权限面**：精选 / 官方 / 下架。
 * 它和审核不同 —— 审核作用在"待审版本"上，治理直接作用在"线上那一行"上，
 * 所以"谁能下架别人的内容"必须被钉死：那是一个能影响全站展示的动作。
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
async function makeUser(role: 'user' | 'reviewer' | 'editor' | 'admin' = 'user') {
  seq += 1;
  const email = `mod${String(seq)}.${Date.now()}@example.com`;
  await call('POST', '/api/auth/register', {
    json: { email, password: PASSWORD, displayName: `用户${String(seq)}`, locale: 'zh-CN' },
  });
  getDb()
    .prepare('UPDATE users SET email_verified_at = ?, role = ? WHERE email = ?')
    .run(Date.now(), role, email);
  const login = await call('POST', '/api/auth/login', { json: { email, password: PASSWORD } });
  assert.equal(login.status, 200);
  return { email, cookie: (login.setCookie ?? '').split(';')[0] as string };
}

/** 造一条已上架的内容（直接写库，不走完整审核流程）。 */
/**
 * 造一条已上架的内容（直接写库，不走完整审核流程）。
 *
 * ⚠️ id 必须每次不同：同一个测试文件里的用例共享一个内存库，用固定 id
 *    的话第二条用例会撞主键 —— 而报错是 "UNIQUE constraint failed"，
 *    看起来像被测代码的问题，其实是测试脚手架自己的。
 */
function seedPublished(id = `mod-entry-${String(++seq)}`): string {
  getDb()
    .prepare(
      `INSERT INTO resources (id, kind, title, url, body, lang, tags, featured, official, status, source, created_at, updated_at)
       VALUES (?, 'website', '治理测试条目', ?, '正文', 'zh-CN', '[]', 0, 0, 'published', 'import', ?, ?)`,
    )
    .run(id, `https://${id}.example/`, Date.now(), Date.now());
  return id;
}

function statusOf(id: string): string {
  const row = getDb().prepare('SELECT status FROM resources WHERE id = ?').get(id) as {
    status: string;
  };
  return row.status;
}

function flagsOf(id: string): { featured: number; official: number } {
  const row = getDb().prepare('SELECT featured, official FROM resources WHERE id = ?').get(id) as {
    featured: number;
    official: number;
  };
  // ⚠️ 展开成普通对象字面量：node:sqlite 的行对象原型不是 Object.prototype，
  //    而 deepStrictEqual 会比较原型 —— 失败信息里两边打印出来一模一样。
  return { featured: row.featured, official: row.official };
}

/** 线上那一行的标题 —— 用来确认"两次编辑都没碰到线上内容"。 */
function liveContentOf(id: string): string {
  const row = getDb().prepare('SELECT title FROM resources WHERE id = ?').get(id) as {
    title: string;
  };
  return row.title;
}

function inPublicList(id: string): boolean {
  const rows = getDb()
    .prepare("SELECT id FROM resources WHERE status = 'published'")
    .all() as unknown as Array<{ id: string }>;
  return rows.some((r) => r.id === id);
}

describe('★ 内容治理：精选 / 官方', () => {
  it('editor 和 admin 能设置，评审员和普通用户不能', async () => {
    const id = seedPublished();

    for (const [role, expected] of [
      ['user', 403],
      ['reviewer', 403],
      ['editor', 200],
      ['admin', 200],
    ] as const) {
      const user = await makeUser(role);
      const res = await call('PATCH', `/api/admin/resources/${id}/flags`, {
        json: { featured: true },
        cookie: user.cookie,
      });
      assert.equal(res.status, expected, `${role} 设置精选应当是 ${String(expected)}`);
    }
  });

  it('只改传了的那个字段（取消精选不会把官方一起清掉）', async () => {
    /*
     * ⚠️ 这条守的是一个很容易写错的地方：把"没传"当成 false。
     *    那样一次"取消精选"会顺手把 official 也清掉 ——
     *    在界面上表现为"我只点了一个按钮，另一个标记也没了"。
     */
    const editor = await makeUser('editor');
    const id = seedPublished();

    await call('PATCH', `/api/admin/resources/${id}/flags`, {
      json: { featured: true, official: true },
      cookie: editor.cookie,
    });
    assert.deepEqual(flagsOf(id), { featured: 1, official: 1 });

    await call('PATCH', `/api/admin/resources/${id}/flags`, {
      json: { featured: false },
      cookie: editor.cookie,
    });
    assert.deepEqual(flagsOf(id), { featured: 0, official: 1 }, '官方标记不该被连带清掉');
  });
});

describe('★ 内容治理：下架 / 恢复', () => {
  it('editor 能把内容下架，之后它从公开列表消失；恢复之后回来', async () => {
    const editor = await makeUser('editor');
    const id = seedPublished();
    assert.equal(inPublicList(id), true, '前提：它本来在站上');

    const hide = await call('PATCH', `/api/admin/resources/${id}/visibility`, {
      json: { published: false },
      cookie: editor.cookie,
    });
    assert.equal(hide.status, 200);
    assert.equal(hide.body.status, 'hidden');
    assert.equal(inPublicList(id), false, '下架之后不该出现在公开列表里');

    const restore = await call('PATCH', `/api/admin/resources/${id}/visibility`, {
      json: { published: true },
      cookie: editor.cookie,
    });
    assert.equal(restore.status, 200);
    assert.equal(restore.body.status, 'published');
    assert.equal(inPublicList(id), true);
  });

  it('普通用户不能下架任何内容', async () => {
    const user = await makeUser();
    const id = seedPublished();
    const res = await call('PATCH', `/api/admin/resources/${id}/visibility`, {
      json: { published: false },
      cookie: user.cookie,
    });
    assert.equal(res.status, 403);
    assert.equal(statusOf(id), 'published', '被拒绝的请求不能改到任何东西');
  });

  it('includeHidden 只有有下架权的人说了算', async () => {
    /*
     * ⚠️ 这条是这个开关存在的**理由**：下架之后条目从列表消失，
     *    编辑者必须还能看到它，否则就无法恢复 —— 那不是下架，是单向的路。
     *    但也正因为它能把"不该公开的东西"翻出来，权限必须在服务端判：
     *    普通用户传 includeHidden=1 不该有任何效果。
     */
    const editor = await makeUser('editor');
    const user = await makeUser();
    const id = seedPublished();

    await call('PATCH', `/api/admin/resources/${id}/visibility`, {
      json: { published: false },
      cookie: editor.cookie,
    });

    const asEditor = await call('GET', '/api/resources?includeHidden=1', { cookie: editor.cookie });
    assert.ok(
      (asEditor.body.items as Array<{ id: string }>).some((i) => i.id === id),
      '编辑者应当仍能看到已下架的内容（否则无法恢复）',
    );

    const asUser = await call('GET', '/api/resources?includeHidden=1', { cookie: user.cookie });
    assert.ok(
      !(asUser.body.items as Array<{ id: string }>).some((i) => i.id === id),
      '普通用户传了 includeHidden 也不能看到已下架的内容',
    );

    const a = await call('GET', '/api/resources?includeHidden=1');
    assert.ok(!(a.body.items as Array<{ id: string }>).some((i) => i.id === id), '未登录同理');
  });
});

describe('★ 职责分离：谁能批准自己提交的内容', () => {
  it('reviewer 不能批准自己提交的内容，但**可以**驳回它（等于撤回）', async () => {
    /*
     * ---------------------------------------------------------------------
     * 审核的全部意义是"有第二个人看过"。
     * ---------------------------------------------------------------------
     * 如果提改动的人自己就能批，审核就退化成一个人的两步操作 ——
     * 而且**从外面完全看不出来**：审计里只有 submit 和 approve 两条记录，
     * 看不出是同一个人做的。
     *
     * ⚠️ 驳回必须放行：那是 reviewer 唯一的"撤回"。要求别人来驳回
     *    他自己提交的东西，只会让一条明显的错误在队列里卡着。
     */
    const reviewer = await makeUser('reviewer');
    const created = await call('POST', '/api/resources', {
      json: {
        kind: 'website',
        title: '审核员自己提交的条目',
        url: 'https://self-review.example/',
        body: '正文',
        lang: 'zh-CN',
        tags: [],
      },
      cookie: reviewer.cookie,
    });
    const id = created.body.id as string;
    assert.equal(created.status, 201);

    const selfApprove = await call('POST', `/api/admin/review/resource/${id}/approve`, {
      cookie: reviewer.cookie,
    });
    assert.equal(selfApprove.status, 403, 'reviewer 不该能批准自己提交的内容');
    assert.equal(selfApprove.body.error, 'self_review');

    // 批准被拒之后，条目**一点都没动**（不能出现"拒了但还是上架了"）
    assert.equal(statusOf(id), 'pending');
    assert.equal(inPublicList(id), false);

    // 但驳回可以 —— 撤回不需要别人的许可
    const selfReject = await call('POST', `/api/admin/review/resource/${id}/reject`, {
      json: { reason: '自己撤回' },
      cookie: reviewer.cookie,
    });
    assert.equal(selfReject.status, 200, 'reviewer 应当能驳回自己提交的内容');
  });

  it('另一位 reviewer 可以批准', async () => {
    const a = await makeUser('reviewer');
    const b = await makeUser('reviewer');
    const created = await call('POST', '/api/resources', {
      json: {
        kind: 'website',
        title: '甲提的条目',
        url: 'https://two-reviewers.example/',
        body: '正文',
        lang: 'zh-CN',
        tags: [],
      },
      cookie: a.cookie,
    });
    const id = created.body.id as string;

    const byOther = await call('POST', `/api/admin/review/resource/${id}/approve`, {
      cookie: b.cookie,
    });
    assert.equal(byOther.status, 200, '另一位审核员应当能批准');
    assert.equal(inPublicList(id), true);
  });

  it('editor 和 admin 可以批准自己提交/修改的内容', async () => {
    for (const role of ['editor', 'admin'] as const) {
      const user = await makeUser(role);
      const created = await call('POST', '/api/resources', {
        json: {
          kind: 'website',
          title: `${role} 自己提的条目`,
          url: `https://self-review-${role}.example/`,
          body: '正文',
          lang: 'zh-CN',
          tags: [],
        },
        cookie: user.cookie,
      });
      const id = created.body.id as string;

      const approve = await call('POST', `/api/admin/review/resource/${id}/approve`, {
        cookie: user.cookie,
      });
      assert.equal(approve.status, 200, `${role} 应当能批准自己提交的内容`);
      assert.equal(inPublicList(id), true);
    }
  });

  it('reviewer **修改**别人的条目之后，也不能自己批那一版', async () => {
    /*
     * ⚠️ 这条是关键：规则要按**每一版是谁提的**判，而不是按"这条条目是谁的"。
     *    否则一个 reviewer 只要先在别人的条目上改一刀，就能自己批准 ——
     *    等于绕过了整条规则。
     */
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    const otherReviewer = await makeUser('reviewer');

    const created = await call('POST', '/api/resources', {
      json: {
        kind: 'website',
        title: '原作者的条目',
        url: 'https://edit-self-review.example/',
        body: '正文',
        lang: 'zh-CN',
        tags: [],
      },
      cookie: author.cookie,
    });
    const id = created.body.id as string;
    await call('POST', `/api/admin/review/resource/${id}/approve`, {
      cookie: otherReviewer.cookie,
    });

    // reviewer 改了别人的条目（wiki 式编辑）
    const edit = await call('PATCH', `/api/resources/${id}`, {
      json: {
        kind: 'website',
        title: '审核员改过的标题',
        url: 'https://edit-self-review.example/',
        body: '正文',
        lang: 'zh-CN',
        tags: [],
      },
      cookie: reviewer.cookie,
    });
    assert.equal(edit.status, 200);

    const selfApprove = await call('POST', `/api/admin/review/resource/${id}/approve`, {
      cookie: reviewer.cookie,
    });
    assert.equal(selfApprove.status, 403, '自己提的那一版不能被自己批');
    assert.equal(selfApprove.body.error, 'self_review');

    // 另一位审核员可以
    const byOther = await call('POST', `/api/admin/review/resource/${id}/approve`, {
      cookie: otherReviewer.cookie,
    });
    assert.equal(byOther.status, 200);
  });
});

describe('★ 两个人同时改一条内容', () => {
  it('第一条改动可以提交，第二条拿到 409（一条内容同时只允许一份待审修改）', async () => {
    /*
     * ---------------------------------------------------------------------
     * 这是"并发编辑"在这个系统里的答案：**先到先得，不做合并**。
     * ---------------------------------------------------------------------
     * 为什么不做合并：两份对同一段正文的改动没有安全的自动合并方式，
     * 硬合出来的中间状态可能两边都不想要 —— 而它还会直接进入审核队列，
     * 审核员看到的是一份谁都没写过的内容。
     *
     * 代价是后来者的输入会丢，所以界面必须在**他动手之前**告诉他
     * （编辑页现在会读 pendingRevision 并拦住，见 EditResource.tsx）。
     * 下面这条测试守的就是那条服务端规则本身。
     */
    const a = await makeUser();
    const b = await makeUser();
    const id = seedPublished();

    const body = (title: string) => ({
      kind: 'website',
      title,
      url: `https://${id}.example/`,
      body: '正文',
      lang: 'zh-CN',
      tags: [],
    });

    const first = await call('PATCH', `/api/resources/${id}`, {
      json: body('甲改的标题'),
      cookie: a.cookie,
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.revision, 1);

    const second = await call('PATCH', `/api/resources/${id}`, {
      json: body('乙改的标题'),
      cookie: b.cookie,
    });
    assert.equal(second.status, 409);
    assert.equal(second.body.error, 'already_pending');

    // 后来者一个字都没写进库里 —— 半途而废的版本比"没提交"更难查
    const revisions = getDb()
      .prepare('SELECT COUNT(*) n FROM resource_revisions WHERE resource_id = ?')
      .get(id) as { n: number };
    assert.equal(revisions.n, 1, '被拒绝的那次不该留下任何版本');
    assert.equal(liveContentOf(id), '治理测试条目', '线上更不能被这两次操作碰到');
  });

  it('编辑接口会告诉界面"现在有人在改"（pendingRevision）', async () => {
    /*
     * ⚠️ 用 editor 来读，不是随便一个登录用户。
     *    编辑接口的规则是"作者本人，或者有 editUnpublished 的人"——
     *    而 seedPublished 造的是一条**导入条目**（author_id 为 NULL），
     *    所以普通用户读它得到的是 404（这个行为本身是对的，
     *    见"编辑页用的读接口"那条测试）。
     */
    const a = await makeUser('editor');
    const id = seedPublished();

    // 没人改的时候是 null
    const before = await call('GET', `/api/resources/${id}/edit`, { cookie: a.cookie });
    assert.equal(before.status, 200);
    assert.equal(before.body.pendingRevision, null, '没有待审改动时应当是 null');

    await call('PATCH', `/api/resources/${id}`, {
      json: {
        kind: 'website',
        title: '有人改了',
        url: `https://${id}.example/`,
        body: '正文',
        lang: 'zh-CN',
        tags: [],
      },
      cookie: a.cookie,
    });

    const after = await call('GET', `/api/resources/${id}/edit`, { cookie: a.cookie });
    assert.equal(after.body.pendingRevision, 1, '有待审改动时要返回版本号');
  });

  it('待审版本被处理掉之后，第二个人才改得动', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const reviewer = await makeUser('reviewer');
    const id = seedPublished();

    await call('PATCH', `/api/resources/${id}`, {
      json: {
        kind: 'website',
        title: '甲改的',
        url: `https://${id}.example/`,
        body: '正文',
        lang: 'zh-CN',
        tags: [],
      },
      cookie: a.cookie,
    });

    // 审核员驳回那一份 → 待审指针清空
    await call('POST', `/api/admin/review/resource/${id}/reject`, {
      json: { reason: '不接受' },
      cookie: reviewer.cookie,
    });

    const second = await call('PATCH', `/api/resources/${id}`, {
      json: {
        kind: 'website',
        title: '乙改的',
        url: `https://${id}.example/`,
        body: '正文',
        lang: 'zh-CN',
        tags: [],
      },
      cookie: b.cookie,
    });
    assert.equal(second.status, 200, '待审的走掉之后，别人应当能接着改');
    assert.equal(second.body.revision, 2);
  });
});

describe('★ 内容治理：改别人的草稿', () => {
  it('editor 能改任何条目（含未上架的），普通用户不能', async () => {
    const author = await makeUser();
    const editor = await makeUser('editor');
    const other = await makeUser();

    // 作者提交一条，处于待审（未上架）
    const created = await call('POST', '/api/resources', {
      json: {
        kind: 'website',
        title: '还没上架的草稿',
        url: 'https://draft-edit.example/',
        body: '正文',
        lang: 'zh-CN',
        tags: [],
      },
      cookie: author.cookie,
    });
    const id = created.body.id as string;
    assert.equal(created.status, 201);

    /*
     * ⚠️ 先让审核员**驳回**它。
     *
     * 刚提交的条目本身带着一条待审版本（pending_revision = 1），这时候谁都
     * 不能再提一版（409 already_pending）—— 那是"重复提交"的规则，不是权限规则。
     * 要测权限，得先把它变成"没有待审版本"的状态：驳回一个从没上架过的条目，
     * 正好得到 status='rejected' 且 pending_revision=NULL。
     */
    const reviewer = await makeUser('reviewer');
    const rejected = await call('POST', `/api/admin/review/resource/${id}/reject`, {
      json: { reason: '先驳回，用来构造一个没有待审版本的草稿' },
      cookie: reviewer.cookie,
    });
    assert.equal(rejected.status, 200);

    const asOther = await call('PATCH', `/api/resources/${id}`, {
      json: {
        kind: 'website',
        title: '路人改的',
        url: 'https://draft-edit.example/',
        body: 'x',
        lang: 'zh-CN',
        tags: [],
      },
      cookie: other.cookie,
    });
    assert.equal(asOther.status, 403, '普通用户不该能改别人的未上架内容');
    assert.equal(asOther.body.reason, 'not_published');

    const asEditor = await call('PATCH', `/api/resources/${id}`, {
      json: {
        kind: 'website',
        title: '编辑改的',
        url: 'https://draft-edit.example/',
        body: 'x',
        lang: 'zh-CN',
        tags: [],
      },
      cookie: editor.cookie,
    });
    assert.equal(asEditor.status, 200, 'editor 应当能改未上架的条目');
    assert.equal(asEditor.body.isAuthor, false);
  });

  it('编辑页用的读接口：作者和 editor 能读未上架内容，其他人 404', async () => {
    const author = await makeUser();
    const editor = await makeUser('editor');
    const other = await makeUser();

    const created = await call('POST', '/api/resources', {
      json: {
        kind: 'website',
        title: '草稿读权限',
        url: 'https://draft-read.example/',
        body: '正文',
        lang: 'zh-CN',
        tags: [],
      },
      cookie: author.cookie,
    });
    const id = created.body.id as string;

    assert.equal(
      (await call('GET', `/api/resources/${id}/edit`, { cookie: author.cookie })).status,
      200,
    );
    assert.equal(
      (await call('GET', `/api/resources/${id}/edit`, { cookie: editor.cookie })).status,
      200,
    );
    assert.equal(
      (await call('GET', `/api/resources/${id}/edit`, { cookie: other.cookie })).status,
      404,
    );
    assert.equal((await call('GET', `/api/resources/${id}/edit`)).status, 401, '未登录应当是 401');
  });
});
