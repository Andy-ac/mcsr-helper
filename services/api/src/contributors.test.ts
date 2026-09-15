/**
 * 贡献者（`content_contributors`）的服务端行为。
 *
 * ===========================================================================
 * 它守的是什么
 * ===========================================================================
 * 用户原话：
 *   「对于资源库，在后台记录贡献者（不直接展示在资源库中），贡献者可以不经过审核
 *     直接修改/下架其拥有的资源（不实际删除），管理者可以在资源库中看到贡献者，
 *     并且能在每个资源里面随意修改（添加/删除）贡献者。资源可以没有贡献者。
 *     贡献者不单独作为一个身份组。这套逻辑之后在其他板块还要用到。」
 *
 * 逐条对应到本文件的用例：
 *   · **后台记录、不直接展示** → 公开列表/详情的 JSON 里**一个 contributor 字样都没有**
 *     （最后一组用例，直接扫响应文本）。
 *   · **不经过审核直接修改** → 纯贡献者（`user` 角色）`PATCH /api/authoring/resources/:id`
 *     → 200，**且线上立刻变**（不是进队列：`pending_revision` 仍然是 NULL）。
 *   · **下架**（以及**恢复**，两者都可逆） → `PATCH /api/resources/:id/visibility`
 *     两个方向都 200，回读 `status` 跟着变。
 *   · **不实际删除** → 纯贡献者对删除那条端点仍然是 403（判据一个字都没改）。
 *   · **管理者能看、能改名单** → 名单那两条接口要求 `resource.moderate`。
 *   · **资源可以没有贡献者** → 清空成 `[]` 是合法的，`total = 0`。
 *   · ★ **不单独作为一个身份组** → 本文件里每一个"贡献者能做什么"的用例，
 *     用的都是一个**纯 `user` 角色**的人：他能直编一条**别人的**内容，
 *     而他自己的 `useCan('content.author')` 从来都是假的。
 *     这一条就是把"按角色授权"和"按逐条内容授权"分开的那道证据。
 *
 * ===========================================================================
 * ★★ 另外两条守的是"没有外键"这个代价
 * ===========================================================================
 * `content_contributors` 是按 `(entity_type, entity_id)` 两段指向内容的，而
 * **SQLite 建不了这种外键** ⇒ 删内容**不会**自动清掉贡献者行，必须每一处硬删除
 * 自己调 `deleteContributors`。漏掉它**不会报错**，只会留下孤儿行。
 * 所以本文件里有两条用例专门钉它（删资源之后必须为 0、部署时的导入对齐删除也必须为 0）。
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
const { contributorEntityIds, isContributor, listContributors, setContributors } = await import(
  './contributors'
);
const { deleteImportedNotIn, upsertResource } = await import('./resources');
const { SITE, CONTRIBUTORS_MAX } = await import('@mcsr/shared');
const { canHardDelete } = await import('@mcsr/shared/permissions');

const PASSWORD = 'a good long passphrase';

after(() => closeDb());
beforeEach(() => {
  resetAll();
  const db = getDb();
  /*
   * ⚠️ `content_contributors` **必须清**，而且要在 `resources` 之前。
   *    这张表没有指向 resources 的外键（那正是本功能的代价），所以删资源
   *    不会带走它 —— 不清的话下一个用例会看见上一个用例留下的名单，
   *    而失败信息会是"名单里多了一个人"这种看起来像业务规则的断言失败。
   */
  db.exec('DELETE FROM content_contributors');
  db.exec('DELETE FROM content_revisions');
  db.exec('DELETE FROM resource_revisions');
  db.exec('DELETE FROM resource_marks');
  db.exec('DELETE FROM resources');
});

interface Res {
  status: number;
  body: Record<string, unknown>;
  setCookie: string | null;
}

/**
 * 每个请求一个**不同的转发 IP**（递增的假地址）。
 *
 * ⚠️ 这不是装饰：`index.ts` 的限流是**按 IP** 的 240 次/分钟，而本文件整套用例
 *    有 250+ 个请求（每个用户注册+登录两步、每个用例又要造 4~6 个用户）——
 *    全部走同一个 key 的话，跑到最后一组用例会开始拿 **429**，
 *    而它表现成的是「登录失败：{"error":"invalid_credentials"}」（注册那一步
 *    被限流了、账号根本没建出来），看起来像账号问题，**与被限流毫无关系**。
 *    给每个请求一个不同的 IP，模拟的正是真实部署里"很多人各自一个 IP"。
 *    ⚠️ 已有测试文件没有这个问题只是因为它们的请求数还没到 240。
 */
let ipSeq = 0;
function testIp(): string {
  ipSeq += 1;
  return `10.1.${String(Math.floor(ipSeq / 250))}.${String(ipSeq % 250)}`;
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
async function makeUser(role: Role, options: { verified?: boolean } = {}) {
  const verified = options.verified ?? true;
  seq += 1;
  const email = `contrib${String(seq)}.${Date.now()}@example.com`;
  const displayName = `贡献者${String(seq)}`;

  await call('POST', '/api/auth/register', {
    json: { email, password: PASSWORD, displayName, locale: 'zh-CN' },
  });

  /*
   * ⚠️ 顺序上的坑：**登录要求邮箱已验证**（`verify-required.test.ts`：没验证
   *    等于没注册完）。所以"未验证但已登录"这个状态只能**先验证、先登录、
   *    再把 `email_verified_at` 置回 NULL** 来构造 —— 而那正是我们要测的状态：
   *    会话还在，但那一列是空的（每次请求读的都是列，不是会话）。
   *    写成"先置 NULL 再登录"的话，登录直接 403 email_not_verified，拿不到 cookie。
   */
  getDb()
    .prepare('UPDATE users SET email_verified_at = ?, role = ? WHERE email = ?')
    .run(Date.now(), role, email);

  const login = await call('POST', '/api/auth/login', { json: { email, password: PASSWORD } });
  assert.ok(login.setCookie, `登录失败：${JSON.stringify(login.body)}`);
  if (!verified) {
    getDb().prepare('UPDATE users SET email_verified_at = NULL WHERE email = ?').run(email);
  }

  const row = getDb().prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string };
  return {
    email,
    id: row.id,
    displayName,
    cookie: (login.setCookie ?? '').split(';')[0] as string,
  };
}

let urlSeq = 0;
function input(overrides: Record<string, unknown> = {}) {
  urlSeq += 1;
  // ⚠️ URL 里刻意不含 "contributor" 这个词：最后那组用例会直接扫响应文本
  //    找有没有 contributor 字样，而 slug 会进 `url`/`id` 字段（假阳性）。
  return {
    kind: 'website',
    title: '贡献者测试条目',
    url: `https://cc-${String(urlSeq)}.example.com/`,
    body: '正文',
    lang: 'zh-CN',
    tags: ['tools'],
    ...overrides,
  };
}

/** 用户提交 → 审核员批准，得到一条**已上架**的条目。 */
async function published(author: string, reviewer: string): Promise<string> {
  const submitted = await call('POST', '/api/resources', { json: input(), cookie: author });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  const id = submitted.body.id as string;
  const approved = await call('POST', `/api/admin/review/resource/${id}/approve`, {
    cookie: reviewer,
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  return id;
}

/** 改名单（管理侧）。断言放在调用点上，方便每条用例说清自己在验什么。 */
function putContributors(id: string, userIds: string[], cookie: string): Promise<Res> {
  return call('PUT', `/api/resources/${id}/contributors`, { json: { userIds }, cookie });
}

/** 一条内容现在有几行贡献者记录（按实体查，**不看** entity 还在不在）。 */
function contributorRows(id: string): number {
  return (
    getDb()
      .prepare(
        "SELECT COUNT(*) AS n FROM content_contributors WHERE entity_type = 'resource' AND entity_id = ?",
      )
      .get(id) as { n: number }
  ).n;
}

/**
 * 某个实体上的审计行，**按插入顺序**。
 *
 * ⚠️⚠️ 这里必须用 `rowid`，**不能**用 `ORDER BY id`（本仓 authoring.test.ts 里
 *    有一行注释专门写过同一个坑）：`audit_log.id` 是**随机 UUID**，它不表达
 *    时间顺序 —— 两次连着写的审计，谁排前面全看运气。
 *    `created_at` 也不行：它是**毫秒**，而这两次调用（加人、删人）常常落在
 *    同一毫秒里，顺序的稳定与否取决于机器快不快 —— 那种测试会**偶发红**，
 *    而偶发红的测试很快就会被所有人忽略。
 *    `rowid` 是 SQLite 的隐式插入序号，只有它能回答"哪条先写的"。
 */
function auditRows(id: string, action: string): Array<{ action: string; reason: string | null }> {
  return getDb()
    .prepare(
      'SELECT action, reason FROM audit_log WHERE entity_id = ? AND action = ? ORDER BY rowid',
    )
    .all(id, action) as Array<{ action: string; reason: string | null }>;
}

/** 某个实体上的全部审计动作，**按插入顺序**（同样要用 rowid，理由见上）。 */
function auditActions(id: string): string[] {
  return (
    getDb()
      .prepare('SELECT action FROM audit_log WHERE entity_id = ? ORDER BY rowid')
      .all(id) as Array<{ action: string }>
  ).map((r) => r.action);
}

// ---------------------------------------------------------------------------
// 名单的读写（管理侧）
// ---------------------------------------------------------------------------

describe('贡献者：名单的读写', () => {
  it('看名单与改名单都要 **`user.moderate`**：匿名 401，reviewer / editor / 普通用户 403', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const plain = await makeUser('user');
    const id = await published(author.cookie, reviewer.cookie);

    // 未登录：401（去登录），与 403（这事与你无关）是两个不同的下一步
    assert.equal((await call('GET', `/api/resources/${id}/contributors`)).status, 401);
    assert.equal(
      (await call('PUT', `/api/resources/${id}/contributors`, { json: { userIds: [] } })).status,
      401,
    );

    for (const who of [reviewer.cookie, plain.cookie]) {
      const get = await call('GET', `/api/resources/${id}/contributors`, { cookie: who });
      assert.equal(get.status, 403, `看名单必须 403：${JSON.stringify(get.body)}`);

      const put = await putContributors(id, [plain.id], who);
      assert.equal(put.status, 403, `改名单必须 403：${JSON.stringify(put.body)}`);
      assert.equal(put.body.error, 'forbidden');
    }

    // ★ 反面控制：两次被拒之后**库里一行都没写**
    assert.equal(contributorRows(id), 0, '403 不能顺手改掉名单');
  });

  it('★★ 看名单与改名单都**只给管理员**（admin / owner）；★ editor 也不行', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const admin = await makeUser('admin');
    const owner = await makeUser('owner');
    const editor = await makeUser('editor');
    const person = await makeUser('user');
    const id = await published(author.cookie, reviewer.cookie);

    /*
     * ⚠️★ 这一条**改过一次判据**，两次的事实都值得留着（第一版写错了）。
     *
     *   第一版用的是 `resource.moderate`，并且上面有条注释在解释
     *   "为什么 editor 是 200"—— 那段推理本身没错（`resource.moderate`
     *   确实在 `EDITOR_CAPS` 里，`authoring.test.ts` 有一条 editor 下架资源 → 200），
     *   但它**对准的目标错了**：用户要的是"**只给管理员**，编辑看不到也改不了这份
     *   名单"。判据因此换成 **`user.moderate`** —— 它在矩阵里正好是 admin / owner
     *   比 editor 多出来的那一项（`[...EDITOR_CAPS, 'user.moderate']`），
     *   也是本仓「管理」入口用的同一把钥匙。
     *
     * ⚠️ 与**下架**那条路由刻意不同：下架是内容动作（editor 本来就干得了），
     *    改名单是**授权动作** —— 用同一个能力，就等于让所有编辑都能给自己发免审权限。
     */
    for (const [who, cookie, expected] of [
      ['reviewer', reviewer.cookie, 403],
      ['editor', editor.cookie, 403],
      ['普通用户', person.cookie, 403],
      ['admin', admin.cookie, 200],
      ['owner', owner.cookie, 200],
    ] as const) {
      const get = await call('GET', `/api/resources/${id}/contributors`, { cookie });
      assert.equal(get.status, expected, `${who} 看名单应当是 ${String(expected)}`);
    }

    // 名单本身用 admin 来改（下面几条断言的都是 admin 这一次的结果）
    const byEditor = await putContributors(id, [person.id], editor.cookie);
    assert.equal(byEditor.status, 403, 'editor 不该能改名单 —— 改名单是授权动作，不是内容动作');
    assert.equal(contributorRows(id), 0, 'editor 被拒之后库里不能有行');

    const put = await putContributors(id, [person.id], admin.cookie);
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal(put.body.added, 1);
    assert.equal(put.body.removed, 0);
    assert.equal(put.body.total, 1);

    const get = await call('GET', `/api/resources/${id}/contributors`, { cookie: admin.cookie });
    assert.equal(get.status, 200, JSON.stringify(get.body));
    const items = get.body.items as Array<{
      userId: string;
      displayName: string | null;
      addedBy: string | null;
      createdAt: number;
    }>;
    assert.equal(get.body.total, 1);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.userId, person.id);
    // 形状是 shared 的 Contributor：显示名、谁加的、什么时候
    assert.equal(items[0]?.displayName, person.displayName);
    assert.equal(items[0]?.addedBy, admin.id, 'added_by 记的是操作者');
    assert.equal(typeof items[0]?.createdAt, 'number');
  });

  it('资源不存在 ⇒ 404（看名单、改名单都是）', async () => {
    const admin = await makeUser('admin');
    const missing = 'no-such-resource';

    const get = await call('GET', `/api/resources/${missing}/contributors`, {
      cookie: admin.cookie,
    });
    assert.equal(get.status, 404, JSON.stringify(get.body));

    const put = await putContributors(missing, [], admin.cookie);
    assert.equal(put.status, 404, JSON.stringify(put.body));
    assert.equal(put.body.error, 'not_found');
  });

  it('body 不合法 ⇒ 400（不是数组 / 不是对象 / 空字符串 / 超上限 / 多余字段）', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const admin = await makeUser('admin');
    const person = await makeUser('user');
    const id = await published(author.cookie, reviewer.cookie);

    const bad: unknown[] = [
      { userIds: 'not-an-array' },
      { userIds: [123] },
      { userIds: [''] },
      { userIds: ['   '] },
      {}, // 缺 userIds
      { userIds: [] as string[], extra: 1 }, // .strict()
      { userIds: Array.from({ length: CONTRIBUTORS_MAX + 1 }, (_, i) => `u-${String(i)}`) },
    ];

    for (const json of bad) {
      const res = await call('PUT', `/api/resources/${id}/contributors`, {
        json,
        cookie: admin.cookie,
      });
      assert.equal(res.status, 400, `应当 400：${JSON.stringify(json)} → ${res.status}`);
      assert.equal(res.body.error, 'invalid_input');
    }

    // 反面控制：七次非法请求之后名单仍然一行都没有
    assert.equal(contributorRows(id), 0);
    // 合法的那个（空数组）反而必须成功 —— 上限是 50、清空是合法状态
    const ok = await putContributors(id, [person.id], admin.cookie);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });

  it('★ 传了不存在的 userId ⇒ 400，而且库里一行都没写（不能静默存成孤儿行）', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const admin = await makeUser('admin');
    const real = await makeUser('user');
    const id = await published(author.cookie, reviewer.cookie);

    /*
     * ⚠️ 这一条守的是"永远不会匹配上任何人的那一行"：
     *    静默跳过 / 静默存下来的表现都是"我明明加了他，他却没有权限"，
     *    而且**没有任何报错**。所以这里既要求 400，也要求那一个**真的存在**的
     *    id 也**没有被写进去**（整份替换是一个事务，不是"能写多少写多少"）。
     */
    const res = await putContributors(id, [real.id, 'definitely-not-a-user'], admin.cookie);
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.error, 'invalid_input');
    const issues = res.body.issues as Array<{ field: string; message: string }>;
    assert.equal(issues[0]?.field, 'userIds');
    assert.match(String(issues[0]?.message), /不存在/);
    assert.match(String(issues[0]?.message), /definitely-not-a-user/, '要说清是哪一个 id');

    assert.equal(contributorRows(id), 0, '校验失败必须整体不写 —— 连那个合法的 id 也不能留下');
  });

  it('★ 加人 → 回读有他；重复 PUT 幂等（added 0 / removed 0，名单不变）', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const admin = await makeUser('admin');
    const a = await makeUser('user');
    const b = await makeUser('user');
    const id = await published(author.cookie, reviewer.cookie);

    const first = await putContributors(id, [a.id, b.id], admin.cookie);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual(
      [first.body.added, first.body.removed, first.body.total],
      [2, 0, 2],
      '第一次加两个人：added 2 / removed 0 / total 2',
    );

    const listed = await call('GET', `/api/resources/${id}/contributors`, { cookie: admin.cookie });
    assert.deepEqual(
      (listed.body.items as Array<{ userId: string }>).map((c) => c.userId).sort(),
      [a.id, b.id].sort(),
    );

    /*
     * ★ 幂等：同一个请求再发一次 —— 这是"保存按钮被点两下"的答案。
     *   它必须**什么都不做**，而不是把 created_at 重写一遍
     *   （重写会让名单顺序跳，看起来像"名单自己在变"）。
     */
    const again = await putContributors(id, [a.id, b.id], admin.cookie);
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.deepEqual(
      [again.body.added, again.body.removed, again.body.total],
      [0, 0, 2],
      '整份替换必须幂等：没有变化就是 0 加 0 删',
    );
    const beforeRows = getDb()
      .prepare(
        'SELECT user_id, created_at FROM content_contributors WHERE entity_id = ? ORDER BY user_id',
      )
      .all(id) as Array<{ user_id: string; created_at: number }>;
    assert.equal(beforeRows.length, 2);
    assert.deepEqual(
      (again.body.items as Array<{ userId: string }>).map((c) => c.userId),
      (listed.body.items as Array<{ userId: string }>).map((c) => c.userId),
      '幂等的第二次调用不能改变名单的顺序',
    );

    // 去重：同一个 id 传两次 = 一个人（不是两行，也不是 500）
    const dup = await putContributors(id, [a.id, a.id], admin.cookie);
    assert.equal(dup.status, 200, JSON.stringify(dup.body));
    assert.equal(dup.body.total, 1, '同一个 id 传两次只能是一个人');
    assert.equal(dup.body.removed, 1, 'b 被移除了');
  });

  it('★ 删人 → 回读没有他；清空成 [] ⇒ total 0（**资源可以没有贡献者**）', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const admin = await makeUser('admin');
    const a = await makeUser('user');
    const b = await makeUser('user');
    const id = await published(author.cookie, reviewer.cookie);

    await putContributors(id, [a.id, b.id], admin.cookie);

    const removed = await putContributors(id, [a.id], admin.cookie);
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.deepEqual([removed.body.added, removed.body.removed, removed.body.total], [0, 1, 1]);

    const listed = await call('GET', `/api/resources/${id}/contributors`, { cookie: admin.cookie });
    assert.deepEqual(
      (listed.body.items as Array<{ userId: string }>).map((c) => c.userId),
      [a.id],
      '被移除的人必须立刻回读不到',
    );
    assert.equal(isContributor('resource', id, b.id), false, '数据层同样必须看不到他');

    /*
     * ★ 用户原话：「资源可以没有贡献者」。所以空数组是**合法状态**，不是错误，
     *   也不是"删到最后一个时顺手把它删掉"。这一条把它钉死。
     */
    const cleared = await putContributors(id, [], admin.cookie);
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
    assert.equal(cleared.body.total, 0);
    assert.equal(cleared.body.removed, 1);
    assert.deepEqual(cleared.body.items, []);
    assert.equal(contributorRows(id), 0);
    // 而资源本身照常在线上（清空名单不等于下架）
    assert.equal((await call('GET', `/api/resources/${id}`)).status, 200);

    // 再清一次：仍然是幂等的 200（不是"没有贡献者就报错"）
    const clearedAgain = await putContributors(id, [], admin.cookie);
    assert.equal(clearedAgain.status, 200);
    assert.deepEqual([clearedAgain.body.added, clearedAgain.body.removed], [0, 0]);
  });

  it('★ 审计写一条 resource.contributors，reason 里能看出加了谁、删了谁', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const admin = await makeUser('admin');
    const a = await makeUser('user');
    const b = await makeUser('user');
    const id = await published(author.cookie, reviewer.cookie);

    await putContributors(id, [a.id, b.id], admin.cookie);
    await putContributors(id, [b.id], admin.cookie); // 把 a 移掉

    const rows = auditRows(id, 'resource.contributors');
    assert.equal(rows.length, 2, '两次调用各写一条（**包括**没有变化的那次，见路由注释）');
    assert.equal(rows[0]?.action, 'resource.contributors');

    const firstReason = String(rows[0]?.reason ?? '');
    assert.match(firstReason, new RegExp(a.displayName), '第一条要说清加了谁');
    assert.match(firstReason, new RegExp(b.displayName));
    assert.match(firstReason, /加 /);

    const secondReason = String(rows[1]?.reason ?? '');
    assert.match(secondReason, new RegExp(a.displayName), '第二条要说清删了谁');
    assert.match(secondReason, /删 /);
    assert.match(secondReason, new RegExp(a.id), '显示名后面要带 id —— 名字会重名、也会被改');

    // 幂等那一次也留痕（"他点了一次保存"和"他没点过"是两件不同的事）
    await putContributors(id, [b.id], admin.cookie);
    const third = auditRows(id, 'resource.contributors')[2]?.reason ?? '';
    assert.match(String(third), /未变/);
  });
});

// ---------------------------------------------------------------------------
// 贡献者的能力：直编 / 下架 / **不能删**
// ---------------------------------------------------------------------------

describe('贡献者：能力（逐条授权，不是角色）', () => {
  it('★ 纯贡献者（user 角色）能直编：200，且**线上立刻变**（不是进队列）', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const admin = await makeUser('admin');
    const contributor = await makeUser('user');
    const id = await published(author.cookie, reviewer.cookie);

    // 加他进名单（管理侧那一把钥匙）
    assert.equal((await putContributors(id, [contributor.id], admin.cookie)).status, 200);

    /*
     * ★★ 这一条就是用户要求的那句「贡献者可以不经过审核直接修改」。
     *    ⚠️ 他是**纯 user 角色**：`can(actor, 'content.author')` 对他恒为假 ——
     *       也就是说他能直编**完全**来自"他是这一条的贡献者"这件事。
     */
    const direct = await call('PATCH', `/api/authoring/resources/${id}`, {
      json: input({ title: '贡献者直编的标题' }),
      cookie: contributor.cookie,
    });
    assert.equal(direct.status, 200, JSON.stringify(direct.body));
    assert.equal(direct.body.liveRevisionUnchanged, false, '直编必须说"线上已经改了"');
    assert.equal(direct.body.status, 'published');

    // 线上**立刻**是新的（不是进队列等审核）
    const live = await call('GET', `/api/resources/${id}`);
    assert.equal(live.status, 200);
    assert.equal((live.body as { title?: string }).title, '贡献者直编的标题');

    /*
     * 而且它**没有**进待审队列：`pending_revision` 仍然是 NULL。
     * ⚠️ 只看标题变了是不够的 —— 提审路径改的是快照表，标题同样会（在批准后）变；
     *    这两列才是"直接写线上那一行"与"提审"的分界线。
     */
    const row = getDb()
      .prepare('SELECT current_revision, pending_revision FROM resources WHERE id = ?')
      .get(id) as { current_revision: number | null; pending_revision: number | null };
    assert.equal(row.pending_revision, null, '直编不留待审指针');
    assert.equal(row.current_revision, 2, '直编推进线上版本号');

    // 审计：动作不变（还是 resource.directEdit），但 reason 里必须能看出身份
    const audits = auditRows(id, 'resource.directEdit');
    assert.equal(audits.length, 1);
    assert.match(String(audits[0]?.reason), /直编（未走审核）/);
    assert.match(
      String(audits[0]?.reason),
      /贡献者/,
      '贡献者是另一个物种（没有角色），事后追查必须能分辨是谁按的',
    );
  });

  it('★ 纯贡献者能下架能恢复：两个方向都 200，回读 status 跟着变', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const admin = await makeUser('admin');
    const contributor = await makeUser('user');
    const id = await published(author.cookie, reviewer.cookie);
    await putContributors(id, [contributor.id], admin.cookie);

    // ① 下架
    const hidden = await call('PATCH', `/api/resources/${id}/visibility`, {
      json: { published: false },
      cookie: contributor.cookie,
    });
    assert.equal(hidden.status, 200, JSON.stringify(hidden.body));
    assert.equal(hidden.body.status, 'hidden');
    assert.equal((await call('GET', `/api/resources/${id}`)).status, 404, '下架之后不在公开视野里');
    /*
     * ⚠️ 但**他自己还能打开编辑页**（下架不等于被剥夺）——
     *    这一条顺带守住了"/:id/edit 的读取判据要给贡献者留门"，
     *    否则他会连"把这条恢复上架"的入口都看不到。
     */
    const editable = await call('GET', `/api/resources/${id}/edit`, { cookie: contributor.cookie });
    assert.equal(editable.status, 200, JSON.stringify(editable.body));

    // ② 恢复（**可逆**：用户原话是"不实际删除"，下架与恢复是一对）
    const restored = await call('PATCH', `/api/resources/${id}/visibility`, {
      json: { published: true },
      cookie: contributor.cookie,
    });
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
    assert.equal(restored.body.status, 'published');
    assert.equal((await call('GET', `/api/resources/${id}`)).status, 200, '恢复之后回到站上');

    /*
     * ③ 重复下架 → 409 `invalid_state`（**与 admin 那条路由逐字同形**）。
     *    这一条守的是"两条路由共用同一个状态机"：判据不同是它们唯一的区别，
     *    所以"调了之后会发生什么"必须完全一样。
     */
    const publishedAgain = await call('PATCH', `/api/resources/${id}/visibility`, {
      json: { published: true },
      cookie: contributor.cookie,
    });
    assert.equal(publishedAgain.status, 409, JSON.stringify(publishedAgain.body));
    assert.equal(publishedAgain.body.error, 'invalid_state');

    // ④ 审计沿用既有的 action 名（与 admin 那条同名同义），按**写入顺序**核对
    assert.deepEqual(
      auditActions(id).filter((a) => a === 'resource.hide' || a === 'resource.restore'),
      ['resource.hide', 'resource.restore'],
      '两个方向都要留痕，而且动作名与 admin 那条路由一致（同名同义）',
    );

    // ⑤ 不是贡献者的普通用户：403（判据是逐条的，不是"任何登录用户"）
    const stranger = await makeUser('user');
    const denied = await call('PATCH', `/api/resources/${id}/visibility`, {
      json: { published: false },
      cookie: stranger.cookie,
    });
    assert.equal(denied.status, 403, JSON.stringify(denied.body));
    assert.equal(denied.body.error, 'forbidden');
    assert.equal((await call('GET', `/api/resources/${id}`)).status, 200, '403 之后内容照常在线上');
  });

  it('★★ 纯贡献者**不能删**：判据一个字都没改（`canHardDelete` / `content.author`）', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const admin = await makeUser('admin');
    const contributor = await makeUser('user');
    const id = await published(author.cookie, reviewer.cookie);
    await putContributors(id, [contributor.id], admin.cookie);

    /*
     * ⚠️⚠️ 用户原话是「贡献者可以不经过审核直接修改/下架其拥有的资源（**不实际删除**）」。
     *     所以删除那条路的判据**一个字都不能动** —— 它仍然是
     *     `canHardDelete(role)`（只有 owner）**或** `content.author`（editor 及以上），
     *     而**不是**"是不是贡献者"。
     *
     * ⚠️ 这里**如实**测的是那条路现在的判据：一个 `user` 角色既不是 owner、
     *    也没有 `content.author` ⇒ **403 `forbidden`**（`routes/authoring.ts` 的
     *    `DELETE` 处理里判的就是这两条；注意 `canHardDelete('user')` 为 false）。
     *    ⚠️ 不是 409 `must_hide_first`：那道缓冲是给 **editor/admin**（有
     *    `content.author` 的人）准备的、"先下架再删"的第一步 ——
     *    纯贡献者根本走不到状态判定那一步，他在**能力判定**就被拒了。
     *    （本仓对"两档"的定稿口径见 authoring.test.ts 里那段长注释。）
     */
    assert.equal(canHardDelete('user'), false, '前提：纯贡献者没有那个谓词');

    const denied = await call('DELETE', `/api/authoring/resources/${id}`, {
      cookie: contributor.cookie,
    });
    assert.equal(denied.status, 403, JSON.stringify(denied.body));
    assert.equal(denied.body.error, 'forbidden');

    /*
     * ★ 再下架一次、变成一个"不在线上"的条目，然后再删 —— **还是 403**。
     *   这一条排除了"他只是被状态挡住了"这个解释：他连下架之后都删不掉。
     */
    const hidden = await call('PATCH', `/api/resources/${id}/visibility`, {
      json: { published: false },
      cookie: contributor.cookie,
    });
    assert.equal(hidden.status, 200);
    const deniedAgain = await call('DELETE', `/api/authoring/resources/${id}`, {
      cookie: contributor.cookie,
    });
    assert.equal(deniedAgain.status, 403, JSON.stringify(deniedAgain.body));

    // 反面控制：两次被拒之后内容与名单都还在
    assert.equal(
      (getDb().prepare('SELECT COUNT(*) AS n FROM resources WHERE id = ?').get(id) as { n: number })
        .n,
      1,
      '403 不能顺手删掉内容',
    );
    assert.equal(contributorRows(id), 1, '403 不能顺手删掉名单');
  });

  it('★ 不是贡献者的人直编那条路仍然被拒（判据不是"任何登录用户"）', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const admin = await makeUser('admin');
    const contributor = await makeUser('user');
    const stranger = await makeUser('user');
    const id = await published(author.cookie, reviewer.cookie);
    await putContributors(id, [contributor.id], admin.cookie);

    /*
     * ⚠️ 这一条是"放宽判据"这类改动最常见的翻车方式：把
     *    `content.author` **或** 贡献者写成"任何登录用户"。
     *    被拒的是另一个**普通用户**（有会话、邮箱已验证、什么角色都没有），
     *    所以通过它就说明判据真的读到了那一行的名单。
     */
    const denied = await call('PATCH', `/api/authoring/resources/${id}`, {
      json: input({ title: '局外人改的' }),
      cookie: stranger.cookie,
    });
    assert.equal(denied.status, 403, JSON.stringify(denied.body));
    assert.equal(denied.body.error, 'forbidden');

    // 未登录 401（与 403 是两个不同的下一步）
    assert.equal(
      (
        await call('PATCH', `/api/authoring/resources/${id}`, {
          json: input({ title: '匿名改的' }),
        })
      ).status,
      401,
    );

    // 内容一个字都没变
    const live = await call('GET', `/api/resources/${id}`);
    assert.equal((live.body as { title?: string }).title, '贡献者测试条目');

    // 而真正的贡献者能改（同一时刻的正面对照，排除"这条端点整个坏了"）
    const ok = await call('PATCH', `/api/authoring/resources/${id}`, {
      json: input({ title: '贡献者改的' }),
      cookie: contributor.cookie,
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });

  it('★★ 未验证邮箱的贡献者也能直编 —— 与 editor 同一条理（判据改过一次）', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const admin = await makeUser('admin');
    // 会话有效，但 email_verified_at 是 NULL（构造方式见 makeUser 的注释）
    const unverified = await makeUser('user', { verified: false });
    const id = await published(author.cookie, reviewer.cookie);
    await putContributors(id, [unverified.id], admin.cookie);

    /*
     * ★★ 这一条**断言的方向反转过一次**，两版的事实都要留着。
     *
     *   第一版断言的是 403 `email_not_verified`，理由写得很像回事：
     *   "`content.author` 那条路不要求验证，但那份豁免不适用于贡献者 ——
     *    他的权力来自**别的用户**把这条内容交给他，不是来自管理员的任命。"
     *
     *   ⚠️ 那个前提当天就被推翻了：改名单的判据最终定成 **`user.moderate`**
     *      （admin / owner），也就是**只有管理员能任命贡献者** ——
     *      与 `content.author` 由管理员授予**完全同形**。
     *      ⇒ permissions.ts 里那条理由（"编辑身份是管理员已经核实过才授予的，
     *        再加一道验证不增加任何保证，却会在换邮箱、邮件投递出问题时
     *        把一个能干活的人挡在门外"）逐字适用于贡献者。
     *
     *   ⚠️ 还有一条硬理由：服务端自己在 `GET /api/resources/:id/edit` 里算
     *      `canDirectEdit` 送给前端，而那个布尔量**不看验证状态**。
     *      这一支若再要求验证，就会出现"服务端说能改、同一个服务端回 403"——
     *      前端照着它渲染按钮，用户点了失败，而两边都是我们写的。
     *      **同一个判断只能有一处**，所以是这里放宽，不是给那个布尔量加一维。
     */
    const direct = await call('PATCH', `/api/authoring/resources/${id}`, {
      json: input({ title: '未验证的贡献者改的' }),
      cookie: unverified.cookie,
    });
    assert.equal(direct.status, 200, JSON.stringify(direct.body));

    // 线上立刻变（这就是"不经过审核"的意思），不是进队列
    const live = await call('GET', `/api/resources/${id}`);
    assert.equal((live.body as { title?: string }).title, '未验证的贡献者改的');

    // 下架/恢复同理：判据里也不该混进验证状态
    const hidden = await call('PATCH', `/api/resources/${id}/visibility`, {
      json: { published: false },
      cookie: unverified.cookie,
    });
    assert.equal(hidden.status, 200, JSON.stringify(hidden.body));
    assert.equal(hidden.body.status, 'hidden');

    /*
     * 对照组：**editor 即使邮箱未验证也照旧能直编**（既有决定，见 permissions.ts
     * 的 REQUIRES_VERIFIED 那段）。放在这里是为了让"贡献者与 editor 同一条理"
     * 这件事**看得见**：两者都是管理员任命的，所以两者都不查验证。
     */
    const unverifiedEditor = await makeUser('editor', { verified: false });
    const byEditor = await call('PATCH', `/api/authoring/resources/${id}`, {
      json: input({ title: '未验证的 editor 改的' }),
      cookie: unverifiedEditor.cookie,
    });
    assert.equal(byEditor.status, 200, JSON.stringify(byEditor.body));
  });

  it('★ 编辑页取数带服务端算好的 canDirectEdit / canHide（前端不重算）', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const admin = await makeUser('admin');
    const contributor = await makeUser('user');
    const stranger = await makeUser('user');
    const editor = await makeUser('editor');
    const id = await published(author.cookie, reviewer.cookie);
    await putContributors(id, [contributor.id], admin.cookie);

    // 贡献者：两个都是 true（这正是"前端按 useCan 判断永远不亮"的那两个按钮）
    const asContributor = await call('GET', `/api/resources/${id}/edit`, {
      cookie: contributor.cookie,
    });
    assert.equal(asContributor.status, 200, JSON.stringify(asContributor.body));
    assert.equal(asContributor.body.canDirectEdit, true);
    assert.equal(asContributor.body.canHide, true);
    assert.equal(asContributor.body.pendingRevision, null, '原有字段一个都不能少（编辑页在读它）');

    // 作者本人：两个都是 false —— 他没有 content.author，也不是贡献者
    const asAuthor = await call('GET', `/api/resources/${id}/edit`, { cookie: author.cookie });
    assert.equal(asAuthor.status, 200, JSON.stringify(asAuthor.body));
    assert.equal(
      asAuthor.body.canDirectEdit,
      false,
      '作者走的是提审那条路；「直接保存」那个按钮不该为他亮',
    );
    assert.equal(asAuthor.body.canHide, false, '作者下架不了自己的内容（那要 resource.moderate）');

    // 有 content.author 的 editor：canDirectEdit true（与贡献者无关，是能力那条路）
    const asEditor = await call('GET', `/api/resources/${id}/edit`, { cookie: editor.cookie });
    assert.equal(asEditor.status, 200, JSON.stringify(asEditor.body));
    assert.equal(asEditor.body.canDirectEdit, true);
    assert.equal(asEditor.body.canHide, true, 'editor 有 resource.moderate');

    /*
     * 局外人：**404**（编辑页的读取判据没有放宽到所有人）。
     * ⚠️ 这一条是上面那些 true 的反面控制：如果判据被写成"只要登录就放行"，
     *    这里会变成 200 + 两个 false —— 那会泄漏"这条存在、内容长什么样"。
     */
    const asStranger = await call('GET', `/api/resources/${id}/edit`, { cookie: stranger.cookie });
    assert.equal(asStranger.status, 404, JSON.stringify(asStranger.body));

    // 未登录 401
    assert.equal((await call('GET', `/api/resources/${id}/edit`)).status, 401);
  });
});

// ---------------------------------------------------------------------------
// ★★ "没有外键"那个代价的落点：删内容要清贡献者行
// ---------------------------------------------------------------------------

describe('贡献者：删内容必须清干净（这张表没有指向内容的外键）', () => {
  it('★★ 硬删一条有贡献者的资源之后，那些行必须为 0', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const admin = await makeUser('admin');
    const owner = await makeUser('owner');
    const a = await makeUser('user');
    const b = await makeUser('user');
    const id = await published(author.cookie, reviewer.cookie);
    await putContributors(id, [a.id, b.id], admin.cookie);
    assert.equal(contributorRows(id), 2, '前提：这条资源确实有 2 个贡献者');

    /*
     * ⚠️⚠️ 这一条是本功能里**唯一**不会报错的失败方式：
     *    `content_contributors` 按 `(entity_type, entity_id)` 指向内容，
     *    而 SQLite 建不了这种外键 ⇒ 删资源**不会**带走它。
     *    漏了那句 `deleteContributors` 的表现是：几行指向不存在内容的记录
     *    安静地留在库里，谁也不会发现 —— 直到有人问"这个人为什么被列为
     *    某条已删内容的贡献者"。所以它必须有一条测试，而不是靠记性。
     *
     * owner 一键硬删（已上架也直接删，那是最短的一条路，最容易漏清理）。
     */
    const removed = await call('DELETE', `/api/authoring/resources/${id}`, {
      cookie: owner.cookie,
    });
    assert.equal(removed.status, 200, JSON.stringify(removed.body));

    assert.equal(
      (getDb().prepare('SELECT COUNT(*) AS n FROM resources WHERE id = ?').get(id) as { n: number })
        .n,
      0,
      '前提：资源真的被删掉了',
    );
    assert.equal(
      contributorRows(id),
      0,
      '★★ 资源删了，贡献者行必须一起清 —— 这张表没有外键，不清就是孤儿行（而且不报错）',
    );
    // 数据层同样查不到（接口与数据层两条路都要干净）
    assert.deepEqual(listContributors('resource', id), []);
  });

  it('★★ 部署时的导入对齐删除（`deleteImportedNotIn`）也要清贡献者行', async () => {
    /*
     * ⚠️ 这是第二条硬删除路径，而且比上面那条更阴：它是**部署时**按
     *    `content/resources.json` 对齐执行的，没有人盯着界面看 ——
     *    漏了清理，孤儿行会随**每次部署**累积。
     *    导入的条目同样可以被加贡献者（`author_id` 是 NULL 不碍事：
     *    名单是按资源 id 记的，与作者无关）。
     */
    const person = await makeUser('user');
    const now = Date.now();
    upsertResource(
      {
        id: 'imported-cc-1',
        kind: 'website',
        title: '导入的条目',
        titleEn: null,
        url: 'https://imported-cc-1.example.com/',
        body: '正文',
        lang: 'zh-CN',
        tags: ['tools'],
        featured: false,
        official: false,
        status: 'published',
      },
      { source: 'import', now },
    );

    const set = setContributors({
      entityType: 'resource',
      entityId: 'imported-cc-1',
      userIds: [person.id],
      actorId: null,
      now,
      exists: () => true,
    });
    assert.equal(set.ok, true);
    assert.equal(contributorRows('imported-cc-1'), 1);

    // 下一次部署：JSON 里没有它了 ⇒ 它会被删掉
    const doomed = deleteImportedNotIn([]);
    assert.deepEqual(doomed, ['imported-cc-1']);
    assert.equal(
      contributorRows('imported-cc-1'),
      0,
      '导入对齐删除同样是硬删除，也必须清贡献者行（否则每次部署都累积孤儿行）',
    );
  });

  it('数据层：批量的"我能直编哪几条"、幂等、以及三个失败分支', async () => {
    const person = await makeUser('user');
    const now = Date.now();
    for (const id of ['dl-1', 'dl-2']) {
      upsertResource(
        {
          id,
          kind: 'website',
          title: `数据层 ${id}`,
          titleEn: null,
          url: `https://${id}.example.com/`,
          body: '正文',
          lang: 'zh-CN',
          tags: [],
          featured: false,
          official: false,
          status: 'published',
        },
        { source: 'user', now },
      );
    }

    const first = setContributors({
      entityType: 'resource',
      entityId: 'dl-1',
      // 同一个 id 传两次 ⇒ 只能一个人（主键会挡住第二次，所以必须先去掉重复）
      userIds: [person.id, person.id],
      actorId: null,
      now,
      exists: () => true,
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.added.length, 1, '去重之后只加一个人');

    // 幂等：一模一样地再来一次 ⇒ 0 加 0 删
    const second = setContributors({
      entityType: 'resource',
      entityId: 'dl-1',
      userIds: [person.id],
      actorId: null,
      now: now + 1,
      exists: () => true,
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.deepEqual([second.added.length, second.removed.length], [0, 0]);
    // 而且 `created_at` **没有**被重写（重写会让名单顺序跳）
    assert.equal(second.items[0]?.createdAt, first.items[0]?.createdAt);

    // ★ 批量判断：一次查询回答"这个人能直编哪几条"（列表页要用的那个形状）
    assert.deepEqual([...contributorEntityIds(person.id, 'resource')], ['dl-1']);

    // 失败分支 ①：实体不存在 ⇒ not_found（路由给 404）
    const notFound = setContributors({
      entityType: 'resource',
      entityId: 'dl-404',
      userIds: [],
      actorId: null,
      now,
      exists: () => false,
    });
    assert.deepEqual(notFound, { ok: false, reason: 'not_found' });

    // 失败分支 ②：用户不存在 ⇒ unknown_user（路由给 400），**并带上是谁**
    const unknown = setContributors({
      entityType: 'resource',
      entityId: 'dl-1',
      userIds: [person.id, 'ghost-user', 'ghost-user-2'],
      actorId: null,
      now,
      exists: () => true,
    });
    assert.equal(unknown.ok, false);
    if (unknown.ok || unknown.reason !== 'unknown_user') throw new Error('应当是 unknown_user');
    assert.deepEqual(unknown.userIds, ['ghost-user', 'ghost-user-2']);
    // ⚠️ 而且名单一个字都没动（校验失败必须整体不写）
    assert.deepEqual(
      listContributors('resource', 'dl-1').map((c) => c.userId),
      [person.id],
    );

    // 失败分支 ③：去重后仍超过上限 ⇒ too_many（路由给 400）
    const tooMany = setContributors({
      entityType: 'resource',
      entityId: 'dl-1',
      userIds: Array.from({ length: CONTRIBUTORS_MAX + 1 }, (_, i) => `u-${String(i)}`),
      actorId: null,
      now,
      exists: () => true,
    });
    assert.equal(tooMany.ok, false);
    if (tooMany.ok || tooMany.reason !== 'too_many') throw new Error('应当是 too_many');
    assert.equal(tooMany.max, CONTRIBUTORS_MAX);
  });

  it('★ 公开读路径里**没有**贡献者字段（用户要求"不直接展示在资源库里"）', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const admin = await makeUser('admin');
    const contributor = await makeUser('user');
    const id = await published(author.cookie, reviewer.cookie);
    await putContributors(id, [contributor.id], admin.cookie);

    /*
     * ⚠️ 判据是**扫响应文本**，不是"看看有没有 contributors 这个键"：
     *    后者只能挡住最直白的那种泄漏，而"换一个名字塞进 items[0]"
     *    （contributorIds / editors / maintainers…）同样违反用户那句话。
     *    所以这里直接要求**整个响应里不出现 contributor 这个词**，
     *    也不出现那个人的 id。
     *    （用例造的 URL 里刻意不含这个词，否则 slug 会让它假阳性。）
     */
    const list = await call('GET', '/api/resources?pageSize=48');
    assert.equal(list.status, 200);
    const listText = JSON.stringify(list.body);
    assert.ok(listText.includes(id), '前提：这条资源确实在公开列表里');
    assert.ok(!/contributor/i.test(listText), `公开列表里有贡献者字样：${listText.slice(0, 400)}`);
    assert.ok(!listText.includes(contributor.id), '公开列表里不该出现贡献者的 id');

    const detail = await call('GET', `/api/resources/${id}`);
    assert.equal(detail.status, 200);
    const detailText = JSON.stringify(detail.body);
    assert.ok(!/contributor/i.test(detailText), `公开详情里有贡献者字样：${detailText}`);
    assert.ok(!detailText.includes(contributor.id), '公开详情里不该出现贡献者的 id');
    // 顺带把它钉成"确实没有这个键"，读代码的人一眼能看出这条断言在守什么
    assert.equal('contributors' in detail.body, false);
    assert.equal('canDirectEdit' in detail.body, false, '那两个布尔量只在编辑页取数里');

    /*
     * 而管理侧读得到（否则"管理者可以在资源库中看到贡献者"就落空了）——
     * 对照着断言，免得将来有人为了"不展示"把接口整个删掉。
     */
    const managed = await call('GET', `/api/resources/${id}/contributors`, {
      cookie: admin.cookie,
    });
    assert.equal(managed.status, 200);
    assert.equal(managed.body.total, 1);
  });
});
