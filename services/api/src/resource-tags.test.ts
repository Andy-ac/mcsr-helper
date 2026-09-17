/**
 * 删标签（`DELETE /api/resources/tags/:tag`）的服务端行为。
 *
 * ===========================================================================
 * 它守的是什么
 * ===========================================================================
 * 用户原话：
 *   「允许编辑者删除资源库标签，被删除的标签对应的资源保留，只是去掉其标签」
 *
 * 这句话里有**两半**，而且两半的失败形状完全不同：
 *
 *   · 「去掉其标签」—— 漏掉一半（只清 `resources`、不清待审版本）**不会报错**：
 *     标签云立刻干净了（它只数 `status='published'` 的行），看起来完全成功，
 *     而那个待审版本一旦被批准，**已经删掉的标签又回来了**。
 *   · 「资源保留」—— 做过头（顺手把资源也删了、或者把 status 改了）同样
 *     不会报错：接口返回 200，只是半个资源库没了。
 *
 * 所以本文件逐条钉住这两半：**标签真的没了**（`resources` + 待审版本）、
 * **行一个都没少**（行数、每一行除 `tags` 外的每一列、`status`、`updated_at`
 * 都对照过）。
 *
 * ===========================================================================
 * 另外三条同样是"不会报错"的那一类
 * ===========================================================================
 *   ③ **谁能删**：漏了判据 = 每个登录用户都能一次清掉全站的一个标签；
 *   ④ **空标签**：`DELETE /tags/%20` 如果被当成一次合法删除，最好的情况是静默
 *      什么都没做（调用方以为删掉了），最坏的情况是**触发一次全表清洗**。
 *      这里要求 400，而且要求"碰数据库之前"就回绝（有断言逐行对照调用前后）；
 *   ⑤ **报告的数字**：界面那句「会影响 N 条资源，资源本身保留」直接引用它。
 *      说大了是吓人，说小了是**骗人**。⇒ 有一条用例是拿"调用前后真的变了的行"
 *      去对响应里的两个数，而不是拿我手写的常量去对（常量与实现对不上时，
 *      那条断言会跟着一起错，两边都是绿的）。
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
const { deleteTagEverywhere, upsertResource } = await import('./resources');
const { SITE } = await import('@mcsr/shared');

const PASSWORD = 'a good long passphrase';

after(() => closeDb());
beforeEach(() => {
  resetAll();
  const db = getDb();
  db.exec('DELETE FROM content_contributors');
  db.exec('DELETE FROM resource_marks');
  db.exec('DELETE FROM resource_revisions');
  db.exec('DELETE FROM resources');
  db.exec('DELETE FROM audit_log');
});

interface Res {
  status: number;
  body: Record<string, unknown>;
  setCookie: string | null;
}

/**
 * 每个请求一个**不同的转发 IP**（递增的假地址）—— 与 `contributors.test.ts` 同一条
 * 理由：`index.ts` 的限流是**按 IP** 的 240 次/分钟，而本文件每个用例都要造好几个
 * 用户（注册 + 登录各一次）。共用同一个 key 的话会拿到 429，而它表现成的是
 * 「登录失败：invalid_credentials」—— 看起来像账号问题，与限流毫无关系。
 */
let ipSeq = 0;
function testIp(): string {
  ipSeq += 1;
  return `10.2.${String(Math.floor(ipSeq / 250))}.${String(ipSeq % 250)}`;
}

async function call(
  method: string,
  path: string,
  options: { json?: unknown; cookie?: string } = {},
): Promise<Res> {
  const headers: Record<string, string> = {
    origin: SITE.productionOrigin,
    'x-forwarded-for': testIp(),
  };
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
  const email = `tagdel${String(seq)}.${Date.now()}@example.com`;

  await call('POST', '/api/auth/register', {
    json: { email, password: PASSWORD, displayName: `删标签${String(seq)}`, locale: 'zh-CN' },
  });
  // ⚠️ 顺序：登录要求邮箱已验证，所以"先验证、先登录"（`contributors.test.ts` 有同一句）
  getDb()
    .prepare('UPDATE users SET email_verified_at = ?, role = ? WHERE email = ?')
    .run(Date.now(), role, email);

  const login = await call('POST', '/api/auth/login', { json: { email, password: PASSWORD } });
  assert.ok(login.setCookie, `登录失败：${JSON.stringify(login.body)}`);

  const row = getDb().prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string };
  return { email, id: row.id, cookie: (login.setCookie ?? '').split(';')[0] as string };
}

let urlSeq = 0;
function input(overrides: Record<string, unknown> = {}) {
  urlSeq += 1;
  return {
    kind: 'website',
    title: '删标签测试条目',
    url: `https://tagdel-${String(urlSeq)}.example.com/`,
    body: '正文',
    lang: 'zh-CN',
    tags: ['tools'],
    ...overrides,
  };
}

/** 用户提交 → 审核员批准，得到一条**已上架**的条目（revision 1 是 approved 的历史快照）。 */
async function published(author: string, reviewer: string, tags: string[]): Promise<string> {
  const submitted = await call('POST', '/api/resources', { json: input({ tags }), cookie: author });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  const id = submitted.body.id as string;
  const approved = await call('POST', `/api/admin/review/resource/${id}/approve`, {
    cookie: reviewer,
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  return id;
}

/** 一条资源的**全部列**（对照"其它字段一个都没变"用它，而不是挑几个字段看）。 */
function resourceRow(id: string): Record<string, unknown> {
  const row = getDb().prepare('SELECT * FROM resources WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  assert.ok(row, `资源 ${id} 不见了 —— "资源保留"这句话在库里已经不成立了`);
  return row;
}

function revisionRows(id: string): Array<Record<string, unknown>> {
  return getDb()
    .prepare('SELECT * FROM resource_revisions WHERE resource_id = ? ORDER BY revision')
    .all(id) as unknown as Array<Record<string, unknown>>;
}

function tagsOf(id: string): string[] {
  return JSON.parse(String(resourceRow(id).tags)) as string[];
}

function revisionTagsOf(id: string, revision: number): string[] {
  const row = getDb()
    .prepare('SELECT tags FROM resource_revisions WHERE resource_id = ? AND revision = ?')
    .get(id, revision) as { tags: string } | undefined;
  assert.ok(row, `资源 ${id} 的 revision ${String(revision)} 不见了`);
  return JSON.parse(row.tags) as string[];
}

/**
 * 全库的 `id → tags 原文`。
 *
 * ⚠️ 比的是**原文**而不是"解析出来一样"：把 `[]` 写进每一行不会改变行数、
 *    也不会让任何一个标签"看起来还在"，但整个标签体系就没了。原文对照能抓到它。
 */
function tagsMap(table: 'resources' | 'resource_revisions'): Record<string, string> {
  const rows = getDb()
    .prepare(`SELECT id, tags FROM ${table} ORDER BY id`)
    .all() as unknown as Array<{ id: string; tags: string }>;
  return Object.fromEntries(rows.map((r) => [r.id, r.tags]));
}

/** 两份快照里**真的变了**的那些 id。 */
function changedKeys(before: Record<string, string>, after: Record<string, string>): string[] {
  return Object.keys(before).filter((key) => before[key] !== after[key]);
}

/** 某个标签上的审计行，**按插入顺序**（`rowid`：`id` 是随机 UUID、`created_at` 是毫秒）。 */
function auditRows(tag: string) {
  return getDb()
    .prepare(
      `SELECT action, actor_id, entity_type, entity_id, reason
       FROM audit_log WHERE entity_id = ? ORDER BY rowid`,
    )
    .all(tag) as unknown as Array<{
    action: string;
    actor_id: string | null;
    entity_type: string;
    entity_id: string | null;
    reason: string | null;
  }>;
}

function deleteTag(tag: string, cookie?: string): Promise<Res> {
  return call('DELETE', `/api/resources/tags/${tag}`, cookie ? { cookie } : {});
}

// ---------------------------------------------------------------------------
// ① 「去掉其标签」—— 已上架的资源；而这条资源**保留**
// ---------------------------------------------------------------------------

describe('① 已上架的资源：标签没了，资源还在（其它字段一个都没变）', () => {
  it('只少了那个标签，行数、status、updated_at 与其它列都和调用前一模一样', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const editor = await makeUser('editor');

    const id = await published(author.cookie, reviewer.cookie, ['tools', 'video']);
    const before = resourceRow(id);
    assert.deepEqual(tagsOf(id), ['tools', 'video'], '夹具：上架之后线上就该带着这两个标签');
    assert.equal(before.status, 'published');

    const res = await deleteTag('tools', editor.cookie);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { ok: true, tag: 'tools', resources: 1, revisions: 0 });

    assert.deepEqual(tagsOf(id), ['video'], '★ 目标标签必须从这一行消失，别的标签一个都不许动');

    /*
     * ★★ 「资源本身保留」的**完整**断言：把这一行的每一列都对照一遍，只排除 `tags`。
     *
     * ⚠️ 用 `SELECT *` 而不是挑几个字段看：挑字段的话，"这次顺手把 featured 清零了"、
     *    "把 status 从 published 改成 pending 了"这类**不会报错**的副作用恰好就落在
     *    没被挑中的那一列上。`updated_at` 也在里面 —— 数据层那段注释说明了为什么
     *    这次**刻意不推**它（推一次等于让全库重新洗一遍列表顺序，而用户只是点了个 ✕）。
     */
    const after = resourceRow(id);
    assert.deepEqual(
      { ...after, tags: null },
      { ...before, tags: null },
      '★ 除了 tags，这一行的每一列都必须与调用前**逐字相同**（updated_at 也算）',
    );
    assert.equal(
      (getDb().prepare('SELECT COUNT(*) AS n FROM resources').get() as { n: number }).n,
      1,
      '★ 资源行数必须没变 —— 这个接口**一行都不许删**',
    );
  });

  it('标签从标签云里消失、标签筛选也查不到了，而那条资源还在列表里', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const editor = await makeUser('editor');

    const id = await published(author.cookie, reviewer.cookie, ['tools', 'video']);

    const tagsBefore = await call('GET', '/api/resources/tags');
    assert.deepEqual(
      (tagsBefore.body.tags as Array<{ tag: string }>).map((t) => t.tag),
      ['tools', 'video'],
      '夹具：两个标签都该在标签云里（按出现次数排，都是 1 次时按字典序）',
    );

    assert.equal((await deleteTag('tools', editor.cookie)).status, 200);

    /*
     * ★ 这一条是"标签表是**数出来的**、不是存下来的"那个设计的证据：服务端没有任何
     *   "同步标签表"的副作用去改这一份列表 —— 它自己就少了一条。
     */
    const tagsAfter = await call('GET', '/api/resources/tags');
    assert.deepEqual(
      (tagsAfter.body.tags as Array<{ tag: string }>).map((t) => t.tag),
      ['video'],
      '★ 标签云里不该再有 tools（`listTopTags` 是从 published 行上数出来的）',
    );

    const filtered = await call('GET', '/api/resources?tag=tools');
    assert.equal(filtered.body.total, 0, '★ 按 tools 筛选必须查不到了');

    const all = await call('GET', '/api/resources');
    assert.equal(all.body.total, 1, '★★ 那条资源**必须还在**（用户原话：资源保留）');
    assert.equal((all.body.items as Array<{ id: string }>)[0]?.id, id);
  });
});

// ---------------------------------------------------------------------------
// ② 待审版本也要去 —— 以及**历史快照不能动**
// ---------------------------------------------------------------------------

describe('② 待审版本也去掉这个标签；approved / rejected 的历史快照一个字都不动', () => {
  it('待审快照少掉标签，而 approved 的那一版原样保留（历史不许改写）', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const editor = await makeUser('editor');

    const id = await published(author.cookie, reviewer.cookie, ['tools', 'video']);

    /*
     * 提一份修改 ⇒ revision 2（status = 'pending'，带 tools）。
     * ⚠️ 线上那一行（resources.tags）**不会**跟着变 —— 那是"线上仍是旧版"这条约束的
     *    另一半，也正是本用例能在同一次调用里同时验到两条写入路径的原因。
     * ⚠️ 标签在写入时被规范化（去重 + 排序 + 转小写，见 `snapshotFields`），
     *    所以 `['tools','texture']` 存下来是 `["texture","tools"]`。
     */
    const revised = await call('PATCH', `/api/resources/${id}`, {
      json: input({ tags: ['tools', 'texture'] }),
      cookie: author.cookie,
    });
    assert.equal(revised.status, 200, JSON.stringify(revised.body));
    assert.deepEqual(tagsOf(id), ['tools', 'video'], '夹具：改完之后线上仍是旧的那一版');
    assert.deepEqual(revisionTagsOf(id, 2), ['texture', 'tools']);
    assert.equal(revisionRows(id)[1]?.status, 'pending');

    const revisionsBefore = revisionRows(id);
    const res = await deleteTag('tools', editor.cookie);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(
      res.body,
      { ok: true, tag: 'tools', resources: 1, revisions: 1 },
      '★ 一条资源 + 一个待审版本 ⇒ { 1, 1 }',
    );

    assert.deepEqual(tagsOf(id), ['video'], '线上那一行的标签要清掉');
    assert.deepEqual(
      revisionTagsOf(id, 2),
      ['texture'],
      '★★ 待审版本也必须清掉 —— 否则它一旦被批准，已经删掉的标签就**回来了**（那时没人会想起这次删除）',
    );
    assert.deepEqual(
      revisionTagsOf(id, 1),
      ['tools', 'video'],
      '★★ revision 1 是 approved 的**历史快照**：必须原样保留 —— 改写它等于篡改历史' +
        '（005 迁移：这是拍摄的那一刻的样子，之后不再变）',
    );

    /*
     * 待审那一行除了 tags 之外一个字节都不许变（status / editor_id / created_at…）：
     * 它还得是"同一份待审内容"，否则审核员看到的与作者提交的不是一份东西。
     */
    const revisionsAfter = revisionRows(id);
    assert.equal(revisionsAfter.length, revisionsBefore.length, '★ 版本行数必须没变');
    assert.deepEqual(
      revisionsAfter.map((r) => ({ ...r, tags: null })),
      revisionsBefore.map((r) => ({ ...r, tags: null })),
      '★ 除了 tags，每一个版本行的每一列都必须与调用前相同',
    );
  });

  it('被驳回的版本同样不动（它也是历史）', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const editor = await makeUser('editor');

    const id = await published(author.cookie, reviewer.cookie, ['tools']);
    assert.equal(
      (
        await call('PATCH', `/api/resources/${id}`, {
          json: input({ tags: ['tools', 'video'] }),
          cookie: author.cookie,
        })
      ).status,
      200,
    );
    const rejected = await call('POST', `/api/admin/review/resource/${id}/reject`, {
      json: { reason: '不合适' },
      cookie: reviewer.cookie,
    });
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
    assert.equal(revisionRows(id)[1]?.status, 'rejected');

    const res = await deleteTag('tools', editor.cookie);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(
      res.body,
      { ok: true, tag: 'tools', resources: 1, revisions: 0 },
      '★ 被驳回的版本不算 —— 只有 pending 才可能将来冒到线上',
    );
    assert.deepEqual(tagsOf(id), [], '线上那一行的 tools 要清掉（它本来就只剩这一个标签）');
    assert.deepEqual(revisionTagsOf(id, 2), ['tools', 'video'], '★ rejected 的版本是历史，不动它');
  });
});

// ---------------------------------------------------------------------------
// ③ 权限
// ---------------------------------------------------------------------------

describe('③ 判据：`resource.moderate`（editor 及以上）', () => {
  it('匿名 401；普通用户 / reviewer 403；editor / admin / owner 200', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const plain = await makeUser('user');
    const editor = await makeUser('editor');
    const admin = await makeUser('admin');
    const owner = await makeUser('owner');

    const id = await published(author.cookie, reviewer.cookie, ['tools']);

    assert.equal((await deleteTag('tools')).status, 401, '未登录 ⇒ 401（下一步是去登录）');
    for (const who of [plain, reviewer]) {
      const denied = await deleteTag('tools', who.cookie);
      assert.equal(
        denied.status,
        403,
        `${who.email} 必须 403：${JSON.stringify(denied.body)} —— 审核 ≠ 治理，普通用户更不能删标签`,
      );
      assert.equal(denied.body.error, 'forbidden');
    }
    assert.deepEqual(tagsOf(id), ['tools'], '★ 被拒的请求**一个字都不许改**（403 不是"删了一半"）');

    /*
     * 正向对照：有权限的人真的删得掉 —— 少了它，上面那三条"被拒"在
     * "接口根本不能用"（比如路由没注册、永远 404）时也照样成立。
     */
    for (const who of [editor, admin, owner]) {
      assert.deepEqual(tagsOf(id), ['tools'], '（对照）每个角色各删一次，所以每次都得先有标签');
      const ok = await deleteTag('tools', who.cookie);
      assert.equal(ok.status, 200, `${who.email} 应当能删：${JSON.stringify(ok.body)}`);
      assert.deepEqual(tagsOf(id), []);
      // 直接写库复原，给下一个角色用（不必再走一遍提交 + 审核）
      getDb().prepare('UPDATE resources SET tags = ? WHERE id = ?').run('["tools"]', id);
    }
  });

  it('权限不够的人连"这个标签存在吗"都不该问出来：403 的响应体里没有计数', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const plain = await makeUser('user');
    await published(author.cookie, reviewer.cookie, ['tools']);

    const denied = await deleteTag('tools', plain.cookie);
    assert.equal(denied.status, 403);
    assert.equal('resources' in denied.body, false, '403 的响应体里不该有"影响了多少条"的计数');
    assert.equal('revisions' in denied.body, false);
  });
});

// ---------------------------------------------------------------------------
// ④ 空标签：400，而且**碰数据库之前**就回绝
// ---------------------------------------------------------------------------

describe('④ 空标签 / 纯空白：400 `invalid_input`，而且一行都没被碰过', () => {
  it('`%20` / `%20%20%20` / `%09` 都是 400，调用前后全库的 tags 逐字相同', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const editor = await makeUser('editor');

    const id = await published(author.cookie, reviewer.cookie, ['tools', 'video']);
    assert.equal(
      (
        await call('PATCH', `/api/resources/${id}`, {
          json: input({ tags: ['tools'] }),
          cookie: author.cookie,
        })
      ).status,
      200,
    );

    const resourcesBefore = tagsMap('resources');
    const revisionsBefore = tagsMap('resource_revisions');
    assert.ok(Object.keys(resourcesBefore).length > 0 && Object.keys(revisionsBefore).length > 0);

    for (const path of ['%20', '%20%20%20', '%09']) {
      const res = await deleteTag(path, editor.cookie);
      assert.equal(res.status, 400, `\`${path}\` 必须是 400：${JSON.stringify(res.body)}`);
      assert.equal(res.body.error, 'invalid_input');
      assert.equal(
        (res.body.issues as Array<{ field: string }>)[0]?.field,
        'tag',
        '★ issues 里要指名是哪个字段（与 POST /api/resources 的错误形状一致）',
      );
    }

    /*
     * ★★ 这一条是**防"全表清洗"**的那一半：空标签最坏的失败方式不是"没删掉"，
     *    而是"把每一个标签都删掉了" —— 而那种事看起来像一次成功的删除。
     * ⚠️ 对照的是**每一行的 tags 原文**（不是"行数没变"）：把 `[]` 写进每一行
     *    不会改变行数，却会让整个标签体系消失。
     */
    assert.deepEqual(tagsMap('resources'), resourcesBefore, '★ 空标签不许改动任何一行的 tags');
    assert.deepEqual(
      tagsMap('resource_revisions'),
      revisionsBefore,
      '★ 空标签不许改动任何版本行的 tags',
    );
    assert.deepEqual(
      tagsOf(id),
      ['tools', 'video'],
      '（对照）线上那一行的标签还在、连顺序都没变 —— 说明那三次请求什么都没做' +
        '（上面那次 PATCH 只写了待审快照，线上仍是旧的这一版）',
    );
    assert.deepEqual(
      auditRows(''),
      [],
      '★ 被回绝的请求不该留下审计（它没有改任何东西，而审计是"这次动了什么"的记录）',
    );
  });

  it('（数据层）绕过路由直接调，空标签也只得到 0/0 —— 它匹配不到任何合法标签', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const id = await published(author.cookie, reviewer.cookie, ['tools']);

    const before = tagsMap('resources');
    assert.deepEqual(deleteTagEverywhere(''), { resources: 0, revisions: 0 });
    assert.deepEqual(deleteTagEverywhere('   '), { resources: 0, revisions: 0 });
    /*
     * ⚠️ 判据是**精确相等**（不是 `includes`）：`''` 若是子串匹配，每一行都会被清成 `[]`。
     *    这一条盯的就是"哪天有人把过滤改成 `!t.includes(target)`"。
     */
    assert.deepEqual(tagsMap('resources'), before);
    assert.deepEqual(tagsOf(id), ['tools']);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 报告的数字与审计
// ---------------------------------------------------------------------------

describe('⑤ 响应里的数字 == 真的改了几行；审计里有一条', () => {
  it('resources / revisions 与"调用前后真的变了的行"逐个对得上', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const editor = await makeUser('editor');

    // 三条资源：两条带 tools（其中一条还带别的标签），一条完全不带
    const a = await published(author.cookie, reviewer.cookie, ['tools', 'video']);
    const b = await published(author.cookie, reviewer.cookie, ['tools']);
    upsertResource({
      kind: 'website',
      id: 'no-tools',
      title: '没有这个标签的',
      titleEn: null,
      url: 'https://notools.example/',
      imageUrl: null,
      summary: null,
      body: '正文',
      lang: 'zh-CN',
      tags: ['video'],
      featured: false,
      official: false,
      status: 'published',
    });

    // 两个待审版本：一个带 tools、一个不带
    for (const [id, tags] of [
      [a, ['tools', 'texture']],
      [b, ['video']],
    ] as const) {
      assert.equal(
        (
          await call('PATCH', `/api/resources/${id}`, {
            json: input({ tags: [...tags] }),
            cookie: author.cookie,
          })
        ).status,
        200,
      );
    }

    const resourcesBefore = tagsMap('resources');
    const revisionsBefore = tagsMap('resource_revisions');

    const res = await deleteTag('tools', editor.cookie);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    /*
     * ★★ "reality" 是**算出来的**，不是手写常量：拿调用前后两份快照比出真的变了的行。
     *    ⚠️ 常量与实现对不上时（比如实现漏了新加的那种行），手写的期望值只会
     *    和服务端一起错 —— 这条断言两边都是绿的。快照对照没有这个盲区。
     */
    const changedResources = changedKeys(resourcesBefore, tagsMap('resources'));
    const changedRevisions = changedKeys(revisionsBefore, tagsMap('resource_revisions'));

    assert.equal(res.body.resources, changedResources.length, '★ 资源的数字必须等于真的变了的行数');
    assert.equal(res.body.revisions, changedRevisions.length, '★ 版本的数字必须等于真的变了的行数');
    assert.deepEqual(res.body, { ok: true, tag: 'tools', resources: 2, revisions: 1 });

    // 夹具对照：真的是 a、b 两条资源 + a 的那个待审版本
    assert.deepEqual(changedResources.slice().sort(), [a, b].slice().sort());
    assert.equal(changedRevisions.length, 1);
    assert.equal(
      changedResources.includes('no-tools'),
      false,
      '★ 没带这个标签的行不该被算进来、也不该被写',
    );
    assert.equal(
      resourcesBefore['no-tools'],
      tagsMap('resources')['no-tools'],
      '★ 没带这个标签的行的 tags 原文必须一个字节都没变',
    );

    /*
     * 探针：上面那套"比快照"的写法本身必须**能命中**变化 —— 喂一份故意改过的快照，
     * 它必须指出那一个 id。写坏成恒空数组时，"数字对上了"就变成 0 == 0 的假绿。
     */
    assert.deepEqual(
      changedKeys(resourcesBefore, { ...resourcesBefore, [a]: '["video"]' }),
      [a],
      '探针：快照对照法本身必须能找出变了的行',
    );
  });

  it('审计：一条 `resource.tagDelete`，写清了是谁、哪个标签、改了几行', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const editor = await makeUser('editor');

    const id = await published(author.cookie, reviewer.cookie, ['tools', 'video']);
    assert.equal(
      (
        await call('PATCH', `/api/resources/${id}`, {
          json: input({ tags: ['tools'] }),
          cookie: author.cookie,
        })
      ).status,
      200,
    );
    /*
     * 先造一条**同 entity_id** 的其它审计：证明下面挑到的是"动作对得上的那一条"，
     * 而不是"这个标签上随便一条记录"。
     */
    getDb()
      .prepare(
        `INSERT INTO audit_log (id, actor_id, action, entity_type, entity_id, reason, ip, created_at)
         VALUES ('probe-audit', 'probe', 'resource.hide', 'resource', 'tools', '别的动作', NULL, 0)`,
      )
      .run();

    const res = await deleteTag('tools', editor.cookie);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const rows = auditRows('tools');
    assert.equal(rows.length, 2, '★ 标签 `tools` 上应当有两行审计（探针那一条 + 这次删除）');
    const mine = rows[1];
    assert.ok(mine, '找不到这次删除的审计行');
    assert.equal(mine.action, 'resource.tagDelete');
    assert.equal(mine.actor_id, editor.id, '★ 审计里要能回答"是谁删的"');
    assert.equal(mine.entity_type, 'tag', '★ 实体是**那个标签**（一次动作一条记录）');
    assert.equal(mine.entity_id, 'tools');
    assert.equal(
      mine.reason,
      '删除标签「tools」：去掉 1 条资源的标签、1 条待审版本的标签（资源与版本都没有被删除）',
    );
  });

  it('标签不存在 ⇒ 200 + 0/0（幂等，不是 404）；连删两次也不会出错', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const editor = await makeUser('editor');
    await published(author.cookie, reviewer.cookie, ['tools']);

    const miss = await deleteTag('nope', editor.cookie);
    assert.equal(miss.status, 200, '标签是数出来的、没有词表 ⇒ "从来没存在过"与"刚被删掉"分不开');
    assert.deepEqual(miss.body, { ok: true, tag: 'nope', resources: 0, revisions: 0 });

    const first = await deleteTag('tools', editor.cookie);
    const second = await deleteTag('tools', editor.cookie);
    assert.deepEqual(first.body, { ok: true, tag: 'tools', resources: 1, revisions: 0 });
    assert.deepEqual(second.body, { ok: true, tag: 'tools', resources: 0, revisions: 0 });
  });

  it('大小写与首尾空白被规范化成同一个标签（与写入路径同一条规则）', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const editor = await makeUser('editor');
    const id = await published(author.cookie, reviewer.cookie, ['tools']);

    // 标签在写入时已经被转成小写（normalizeResourceInput），所以 `Tools` 必须也能删掉 `tools`
    const res = await deleteTag('%20Tools%20', editor.cookie);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.tag, 'tools', '★ 回显的是**规范化之后**的那个标签（trim + 小写）');
    assert.deepEqual(tagsOf(id), []);
  });
});

// ---------------------------------------------------------------------------
// ⑥ 边界：这个接口不该顺手动别的东西
// ---------------------------------------------------------------------------

describe('⑥ 它只动 tags 这一列', () => {
  it('未上架（pending / hidden）的资源也要清 —— 否则它们一上架那个标签就回来了', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const editor = await makeUser('editor');

    // 一条"提了但从没审过"的条目：resources.status = 'pending'，同时 revision 1 也是 pending
    const submitted = await call('POST', '/api/resources', {
      json: input({ tags: ['tools'] }),
      cookie: author.cookie,
    });
    assert.equal(submitted.status, 201);
    const pendingId = submitted.body.id as string;
    assert.equal(resourceRow(pendingId).status, 'pending');

    // 一条已上架、随后被下架的
    const hiddenId = await published(author.cookie, reviewer.cookie, ['tools']);
    const hidden = await call('PATCH', `/api/resources/${hiddenId}/visibility`, {
      json: { published: false },
      cookie: editor.cookie,
    });
    assert.equal(hidden.status, 200, JSON.stringify(hidden.body));
    assert.equal(resourceRow(hiddenId).status, 'hidden');

    const res = await deleteTag('tools', editor.cookie);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(
      res.body,
      { ok: true, tag: 'tools', resources: 2, revisions: 1 },
      '★ 两行资源（pending + hidden）+ 一个待审版本（hidden 那条的 revision 1 是 approved，不算）',
    );
    assert.deepEqual(tagsOf(pendingId), [], '★ 未上架的草稿也要清（它上架时标签会冒出来）');
    assert.deepEqual(resourceRow(hiddenId).tags, '[]', '★ 下架的内容也要清');
    assert.equal(resourceRow(hiddenId).status, 'hidden', '★ 但 status 一点都不许动');
    assert.equal(resourceRow(pendingId).status, 'pending');
  });

  it('没有这个标签的资源、以及同一行上别的标签，一个字节都不动', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const editor = await makeUser('editor');

    const withTools = await published(author.cookie, reviewer.cookie, ['tools', 'video']);
    const without = await published(author.cookie, reviewer.cookie, ['video', 'texture']);

    const before = tagsMap('resources');
    const res = await deleteTag('tools', editor.cookie);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { ok: true, tag: 'tools', resources: 1, revisions: 0 });

    assert.equal(
      tagsMap('resources')[without],
      before[without],
      '★ 没有这个标签的行必须**逐字**不变',
    );
    assert.deepEqual(tagsOf(withTools), ['video'], '★ 同一行上别的标签也一个都不许动');
    assert.deepEqual(tagsOf(without), ['texture', 'video'], '（对照）另一条资源原样');
  });
});
