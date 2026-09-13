/**
 * ② 直编（`/api/authoring/*`）的服务端行为。
 *
 * ---------------------------------------------------------------------------
 * 这个文件守的是"直编没有把审核那条规则弄坏"
 * ---------------------------------------------------------------------------
 * 直编是**绕过审核快照、直接写线上那一行**的一条新路径。它最容易造成的破坏不是
 * 它自己出错，而是**悄悄改掉旧路径的语义**。所以这里每一条"直编生效了"的断言
 * 旁边，都有一条"审核那条路仍然照旧"的反向断言：
 *
 *   1. 直编**立刻**改线上（`liveRevisionUnchanged: false` + 详情页立刻变）；
 *      而普通用户 `PATCH /api/resources/:id` 仍然是**提审**（线上一个字不变）。
 *   2. 直编**必须**写一条 `approved` 快照并推进 `current_revision`（否则版本历史断链，
 *      而日历那边有一个"用版本号判断有没有上架过"的历史坑，同形状的判据会出错）。
 *   3. 直编新建的 `source` **必须是 `'user'`** —— 写成 `'import'` 的话，
 *      下一次部署会被导入脚本按"不在 JSON 里"**静默删掉**（D2.9）。
 *   4. **有待审改动时直编被拒**（409 `already_pending`）：那条待审快照是基于更早的
 *      线上版本拍的，批准时会把直编内容**静默回滚** —— 一次没有报错的数据丢失。
 *   5. 硬删**分两档，按"有没有连带数据"分，不按端点名**（captain 2026-09-13 裁定）：
 *      · **资源 / 视频**：两档 —— **owner** 一键（谓词 `canHardDelete`，跳过"先下架"）；
 *        **editor / admin** 两步（仍在线上 → 409 `invalid_state` + `reason: 'must_hide_first'`，
 *        先下架再删 → 200）；**reviewer / 普通用户 → 403**（能力判定，不是状态判定）。
 *      · **赛事**：**直删** —— editor/admin 一次调用就删掉已发布的事件（200）。
 *        它没有收藏/备注/评分这类连带数据，也**没有下架入口**（日历连 `hidden`
 *        都写不进去），所以那道缓冲在赛事上会退化成"editor 永远删不掉"，
 *        直接违反需求 ② 的"editor 及以上可直接增删改**赛事**"。
 *
 * ---------------------------------------------------------------------------
 * 覆盖范围
 * ---------------------------------------------------------------------------
 * 这个文件守**三个类型**：资源（`/resources`）、赛事（`/calendar`）、视频（`/videos/:id`）。
 * ⚠️ 三者的**删除规则并不相同**（见上面第 5 条）—— 照抄一个类型的删除断言到另一个类型，
 * 会红在本文件里，那是**对的**。
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
  /*
   * ⚠️ 三个类型的内容都要清：日历/视频的清理是本轮新增的。
   *    少了它们，第二个 `it` 会看见上一个 `it` 留下的行 ——
   *    而失败信息会是"这个视频已经在站上了"这种**看起来像业务规则**的断言失败。
   */
  db.exec('DELETE FROM content_revisions');
  db.exec('DELETE FROM resource_revisions');
  db.exec('DELETE FROM resource_marks');
  db.exec('DELETE FROM resources');
  db.exec('DELETE FROM calendar_events');
  db.exec('DELETE FROM videos');
});

async function call(
  method: string,
  path: string,
  options: { json?: unknown; cookie?: string } = {},
): Promise<{ status: number; body: Record<string, unknown>; setCookie: string | null }> {
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
async function makeUser(role: 'user' | 'reviewer' | 'editor' | 'owner') {
  seq += 1;
  const email = `auth${String(seq)}.${Date.now()}@example.com`;
  await call('POST', '/api/auth/register', {
    json: { email, password: PASSWORD, displayName: `直编${String(seq)}`, locale: 'zh-CN' },
  });
  getDb()
    .prepare('UPDATE users SET email_verified_at = ?, role = ? WHERE email = ?')
    .run(Date.now(), role, email);
  const login = await call('POST', '/api/auth/login', { json: { email, password: PASSWORD } });
  return { email, cookie: (login.setCookie ?? '').split(';')[0] as string };
}

let urlSeq = 0;
function input(overrides: Record<string, unknown> = {}) {
  urlSeq += 1;
  return {
    kind: 'website',
    title: '直编测试条目',
    url: `https://authoring-${String(urlSeq)}.example.com/`,
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

function auditActions(entityId: string): string[] {
  return (
    getDb()
      .prepare('SELECT action FROM audit_log WHERE entity_id = ? ORDER BY id')
      .all(entityId) as Array<{ action: string }>
  ).map((r) => r.action);
}

/** 计一下某张表里还有多少行属于这个 id（连带删除的断言用它）。 */
function countRows(table: string, column: string, id: string): number {
  return (
    getDb().prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${column} = ?`).get(id) as {
      n: number;
    }
  ).n;
}

/** 用直编建一场**已发布**的赛事（editor 及以上才能调）。 */
async function directEvent(
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const res = await call('POST', '/api/authoring/calendar', {
    json: {
      title: '直编测试赛事',
      startsAtLocal: '2030-09-05T16:00',
      startsAtTz: 'Asia/Shanghai',
      tags: ['TOURNAMENT'],
      ...overrides,
    },
    cookie,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id as string;
}

/** 赛事的一次合法入参（改标题用）。 */
function eventInput(overrides: Record<string, unknown> = {}) {
  return {
    title: '改过的赛事标题',
    startsAtLocal: '2030-09-06T16:00',
    startsAtTz: 'Asia/Shanghai',
    tags: ['TOURNAMENT'],
    ...overrides,
  };
}

/** 直接贴一个视频（走视频墙那条**本来就没有审核**的路径），返回它的 id。 */
async function postVideo(cookie: string, videoId = 'dQw4w9WgXcQ'): Promise<string> {
  const res = await call('POST', '/api/videos', {
    json: { url: `https://www.youtube.com/watch?v=${videoId}`, title: '直编测试视频' },
    cookie,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  /*
   * ⚠️ 视频贴完的 id 在 `body.video.id`，**不在**顶层 `body.id`（资源/赛事才是顶层）。
   *    取错的表现是后面每一步都 404 —— 而它看起来像路由或权限不对，
   *    不会有人想到是响应形状不同。
   */
  return (res.body.video as { id: string }).id;
}

/** 公开读一场赛事，返回它的标题（`undefined` 表示读不到/未发布）。 */
async function liveEventTitle(id: string): Promise<string | undefined> {
  const res = await call('GET', `/api/calendar/${id}`);
  if (res.status !== 200) return undefined;
  return (res.body.event as { title?: string }).title;
}

describe('② 直编：资源库', () => {
  it('★ 新建即上架，且 source 必须是 user（否则下次部署会被导入脚本静默删掉）', async () => {
    const editor = await makeUser('editor');

    const res = await call('POST', '/api/authoring/resources', {
      json: input({ title: '编辑直接建的一条' }),
      cookie: editor.cookie,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.status, 'published', '直编新建就是已上架');
    // ⚠️ §3.2b：直编不经过审核，线上那一版**被真的写出来了** ⇒ false
    assert.equal(res.body.liveRevisionUnchanged, false);

    const id = res.body.id as string;
    const row = getDb()
      .prepare('SELECT source, status, current_revision FROM resources WHERE id = ?')
      .get(id) as {
      source: string;
      status: string;
      current_revision: number | null;
    };
    /*
     * ⚠️ 这一条是 D2.9，也是本文件里最容易"看起来没事"的一条：
     *    `source='import'` 时条目照样能用、界面上完全正常，
     *    直到下一次部署跑导入脚本，它才**无声无息地消失**。
     */
    assert.equal(row.source, 'user', '直编新建必须是 user —— import 会被导入脚本删掉');
    assert.equal(row.status, 'published');
    assert.equal(row.current_revision, 1, '必须有第 1 版（否则版本历史断链、审核详情无对照）');

    const revs = getDb()
      .prepare('SELECT revision, status, reviewed_by FROM resource_revisions WHERE resource_id = ?')
      .all(id) as Array<{ revision: number; status: string; reviewed_by: string | null }>;
    assert.equal(revs.length, 1);
    assert.equal(revs[0]?.status, 'approved', '直编写的是 approved 快照，不留待审');
    assert.ok(revs[0]?.reviewed_by, 'reviewed_by 记的是操作者');

    // 公开详情立刻能看到（"已经生效"不是嘴上说的）
    const detail = await call('GET', `/api/resources/${id}`);
    assert.equal(detail.status, 200);
    assert.equal((detail.body as { title?: string }).title, '编辑直接建的一条');

    assert.deepEqual(auditActions(id), ['resource.directCreate']);
  });

  it('★ reviewer 直编 → 403（否则"审核员不能自批"会被掏空）', async () => {
    const reviewer = await makeUser('reviewer');
    const denied = await call('POST', '/api/authoring/resources', {
      json: input(),
      cookie: reviewer.cookie,
    });
    assert.equal(denied.status, 403, JSON.stringify(denied.body));
  });

  it('★ 直编立刻改线上；而普通用户走 PATCH 仍然只进待审（反向核对）', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const editor = await makeUser('editor');
    const id = await published(author.cookie, reviewer.cookie);

    // ① 普通用户改：线上**一个字都不变**，进待审
    const submitted = await call('PATCH', `/api/resources/${id}`, {
      json: input({ title: '用户提的修改' }),
      cookie: author.cookie,
    });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    assert.equal(submitted.body.status, 'pending');
    assert.equal(submitted.body.liveRevisionUnchanged, true, '提审路径必须说"线上没变"');
    const live1 = await call('GET', `/api/resources/${id}`);
    assert.equal((live1.body as { title?: string }).title, '直编测试条目', '线上仍是旧版');

    // ② 有待审改动时，**直编必须被拒**（否则批准那条快照会把直编静默回滚）
    const blocked = await call('PATCH', `/api/authoring/resources/${id}`, {
      json: input({ title: '直编撞上待审' }),
      cookie: editor.cookie,
    });
    assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
    assert.equal(blocked.body.error, 'already_pending');

    // ③ 清掉待审（驳回），直编才成立 —— 而且**立刻**生效
    const rejected = await call('POST', `/api/admin/review/resource/${id}/reject`, {
      json: { reason: '先把它驳掉再直编' },
      cookie: reviewer.cookie,
    });
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body));

    const direct = await call('PATCH', `/api/authoring/resources/${id}`, {
      json: input({ title: '编辑直编的标题' }),
      cookie: editor.cookie,
    });
    assert.equal(direct.status, 200, JSON.stringify(direct.body));
    assert.equal(direct.body.liveRevisionUnchanged, false, '直编必须说"线上已经改了"');
    assert.equal(direct.body.status, 'published');

    const live2 = await call('GET', `/api/resources/${id}`);
    assert.equal((live2.body as { title?: string }).title, '编辑直编的标题', '直编要立刻上线');

    // 审计能分辨"直编"与"自批"，所以 reason 里必须写清是怎么来的
    const rows = getDb()
      .prepare(
        "SELECT action, reason FROM audit_log WHERE entity_id = ? AND action LIKE '%direct%'",
      )
      .all(id) as Array<{ action: string; reason: string }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.action, 'resource.directEdit');
    assert.match(String(rows[0]?.reason), /直编（未走审核）/);
  });

  it('★ 直编不会顺手把"下架"撤销（status 返回真实值）', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const editor = await makeUser('editor');
    const id = await published(author.cookie, reviewer.cookie);

    const hidden = await call('PATCH', `/api/admin/resources/${id}/visibility`, {
      json: { published: false },
      cookie: editor.cookie,
    });
    assert.equal(hidden.status, 200, JSON.stringify(hidden.body));

    const direct = await call('PATCH', `/api/authoring/resources/${id}`, {
      json: input({ title: '下架条目也被直编了' }),
      cookie: editor.cookie,
    });
    assert.equal(direct.status, 200, JSON.stringify(direct.body));
    /*
     * ⚠️ 说真话：内容确实改了（liveRevisionUnchanged = false），
     *    但**这一条仍然不在站上** —— 界面必须两个字段一起读，
     *    只报"已生效"会让用户以为它回到了线上。
     */
    assert.equal(direct.body.status, 'hidden', '下架是明确的编辑决定，不该被改内容顺手撤销');
    assert.equal(direct.body.liveRevisionUnchanged, false);
    assert.equal((await call('GET', `/api/resources/${id}`)).status, 404, '它仍然不在公开视野里');
  });

  it('★ 删除**两档**：owner 一键；editor/admin 两步（must_hide_first → 先下架再删）；其它角色 403', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const editor = await makeUser('editor');
    const owner = await makeUser('owner');

    // ① 没有 content.author 的角色 → 403（reviewer 是那条边界；普通用户同理）
    const idForDenied = await published(author.cookie, reviewer.cookie);
    for (const who of [reviewer.cookie, author.cookie]) {
      const denied = await call('DELETE', `/api/authoring/resources/${idForDenied}`, {
        cookie: who,
      });
      assert.equal(
        denied.status,
        403,
        `无 content.author 必须是 403：${JSON.stringify(denied.body)}`,
      );
      assert.equal(denied.body.error, 'forbidden');
    }
    // 反面控制：被拒之后内容还在（403 不能顺手删掉东西）
    assert.equal((await call('GET', `/api/resources/${idForDenied}`)).status, 200);

    /*
     * ② editor（有 `content.author`、但**没有**那个谓词）→ **两步**
     *
     * ⚠️⚠️ 判据 = **两档**，captain 2026-09-13 的定稿口径原文：
     *    "两档只适用于**第二步走得通**的类型 —— 资源/视频有 `PATCH …/visibility`
     *     下架入口 ⇒ 两档；**日历没有下架入口 ⇒ 两档是死路** ⇒ 直删。
     *     *连带数据决定那道缓冲值不值，下架入口决定它能不能。*"
     *    ⇒ 资源有 `PATCH /api/admin/resources/:id/visibility`（可恢复）⇒ 两档成立：
     *      `published` → 409 `invalid_state` + `reason: 'must_hide_first'`；先下架再删 → 200。
     *
     * ⚠️ 这里**曾经被写成 (a)**（"非 owner 一律 403、`must_hide_first` 不可达"）——
     *    **那是错的**：用户原话把"删"放进了 editor+ 的能力里（需求 ②「修改/添加/**删除**」），
     *    而「**另外**允许 owner **一键**真正删除」只多出"**一键**"两个字。
     *    照 (a) 实现会让 editor/admin **永远删不掉任何一条资源**，
     *    表现就是本文件这里红在 `403 !== 409`（`routes/authoring.ts` 的删除块里也写着同一句话）。
     */
    const idForTwoStep = await published(author.cookie, reviewer.cookie);
    const marked = await call('PUT', `/api/resources/${idForTwoStep}/marks`, {
      json: { favorite: true, note: '别人的私人备注' },
      cookie: reviewer.cookie,
    });
    assert.equal(marked.status, 200, JSON.stringify(marked.body));

    const blocked = await call('DELETE', `/api/authoring/resources/${idForTwoStep}`, {
      cookie: editor.cookie,
    });
    assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
    assert.equal(blocked.body.error, 'invalid_state');
    assert.equal(blocked.body.reason, 'must_hide_first');
    /*
     * ★ 反面控制：409 之后**内容与别人的收藏都必须还在**。
     *   这道缓冲的全部意义就在这里 —— 一次手滑不能把别人写的私人备注带走。
     */
    assert.equal(
      (await call('GET', `/api/resources/${idForTwoStep}`)).status,
      200,
      '409 之后内容必须还在 —— 否则"两步"就只是个说法',
    );
    assert.equal(
      countRows('resource_marks', 'resource_id', idForTwoStep),
      1,
      '409 不能动别人的数据（私人备注没有备份）',
    );

    // 先下架（**可恢复**），再删 → 200
    const hidden = await call('PATCH', `/api/admin/resources/${idForTwoStep}/visibility`, {
      json: { published: false },
      cookie: editor.cookie,
    });
    assert.equal(hidden.status, 200, JSON.stringify(hidden.body));
    const afterHide = await call('DELETE', `/api/authoring/resources/${idForTwoStep}`, {
      cookie: editor.cookie,
    });
    assert.equal(afterHide.status, 200, JSON.stringify(afterHide.body));
    assert.equal(afterHide.body.status, 'deleted');

    // ③ owner → **一键**：已上架也直接删（不需要先下架）
    const idForOwner = await published(author.cookie, reviewer.cookie);
    await call('PUT', `/api/resources/${idForOwner}/marks`, {
      json: { favorite: true, note: '别人的私人备注' },
      cookie: reviewer.cookie,
    });
    const removed = await call('DELETE', `/api/authoring/resources/${idForOwner}`, {
      cookie: owner.cookie,
    });
    assert.equal(removed.status, 200, JSON.stringify(removed.body), 'owner 应当是"一键"，不是 409');
    assert.equal(removed.body.status, 'deleted');

    const left = (table: string, rid: string) =>
      (
        getDb().prepare(`SELECT COUNT(*) n FROM ${table} WHERE resource_id = ?`).get(rid) as {
          n: number;
        }
      ).n;
    // 连带删除是**预期**行为（写进断言，免得将来有人把它当 bug 修）
    assert.equal(left('resource_revisions', idForOwner), 0, '版本历史连带删除（预期）');
    assert.equal(left('resource_marks', idForOwner), 0, '所有人的收藏/备注/评分连带删除（预期）');
    assert.equal(left('resource_revisions', idForTwoStep), 0, '两步那条也一样连带删');
    assert.ok(
      auditActions(idForOwner).includes('resource.directDelete'),
      '两种档位都必须留审计（reason 里区分"一键"与"先下架后删"）',
    );
  });
});

describe('② 直编：赛事', () => {
  it('★ 新建即上架 + 第 1 版 approved 快照 + 公开详情立刻可见（审计 directCreate）', async () => {
    const editor = await makeUser('editor');

    const res = await call('POST', '/api/authoring/calendar', {
      json: {
        title: '编辑直接建的赛事',
        startsAtLocal: '2030-09-05T16:00',
        startsAtTz: 'Asia/Shanghai',
        tags: ['TOURNAMENT'],
      },
      cookie: editor.cookie,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.status, 'published', '直编新建就是已发布');
    assert.equal(res.body.revision, 1);
    assert.equal(res.body.liveRevisionUnchanged, false, '§3.2b：这条写路径不经过审核');

    const id = res.body.id as string;
    const row = getDb()
      .prepare(
        'SELECT status, current_revision, pending_revision, author_id FROM calendar_events WHERE id = ?',
      )
      .get(id) as {
      status: string;
      current_revision: number | null;
      pending_revision: number | null;
      author_id: string | null;
    };
    assert.equal(row.status, 'published');
    assert.equal(row.current_revision, 1, '第 1 版必须留下：否则版本历史断链');
    /*
     * ⚠️ `pending_revision` 必须是 NULL。写成 1 的话，这条**已经上架**的赛事会同时挂着
     *    "有一份待审修改"，之后任何一次编辑都被 409 挡住 —— 而界面上看不出原因
     *    （数据层 `submitEventDirect` 的注释专门写了这一条）。
     */
    assert.equal(row.pending_revision, null, '直编新建不留待审指针');

    const revs = getDb()
      .prepare(
        'SELECT revision, status, reviewed_by FROM content_revisions WHERE type = ? AND entity_id = ?',
      )
      .all('calendar', id) as Array<{
      revision: number;
      status: string;
      reviewed_by: string | null;
    }>;
    assert.equal(revs.length, 1);
    assert.equal(revs[0]?.status, 'approved', '直编写的是 approved 快照，不留待审');
    assert.ok(revs[0]?.reviewed_by, 'reviewed_by 记的是操作者');

    // 公开详情立刻能看到（"已经生效"不是嘴上说的）
    assert.equal(await liveEventTitle(id), '编辑直接建的赛事');

    assert.deepEqual(auditActions(id), ['calendar.directCreate']);
  });

  it('★ reviewer 与未登录都不能直编（403 / 401，而且不碰内容）', async () => {
    const editor = await makeUser('editor');
    const reviewer = await makeUser('reviewer');
    const id = await directEvent(editor.cookie);

    /*
     * ⚠️ 403 而不是 200：reviewer 一旦能直编，就变成"自己改、自己生效"，
     *    而 `canSelfReview` 明写他不能批准自己提交的内容 —— 那条规则会被掏空，
     *    审计里却只是两条互不相干的记录（spec D2.2）。
     */
    const created = await call('POST', '/api/authoring/calendar', {
      json: eventInput(),
      cookie: reviewer.cookie,
    });
    assert.equal(created.status, 403, JSON.stringify(created.body));

    const edited = await call('PATCH', `/api/authoring/calendar/${id}`, {
      json: eventInput({ title: '审核员改的' }),
      cookie: reviewer.cookie,
    });
    assert.equal(edited.status, 403, JSON.stringify(edited.body));

    const removed = await call('DELETE', `/api/authoring/calendar/${id}`, {
      cookie: reviewer.cookie,
    });
    assert.equal(removed.status, 403, JSON.stringify(removed.body));

    // 未登录是 401，不是 403 —— 两者对用户意味着两个不同的下一步
    const anon = await call('PATCH', `/api/authoring/calendar/${id}`, { json: eventInput() });
    assert.equal(anon.status, 401, JSON.stringify(anon.body));

    // 反面控制：三次被拒之后内容一个字都没变（拒绝不能顺手改掉东西）
    assert.equal(await liveEventTitle(id), '直编测试赛事');
  });

  it('★ 有待审改动时直编被拒（409）；驳回之后直编立刻生效（反向核对提审路径）', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const editor = await makeUser('editor');
    const id = await directEvent(editor.cookie, { title: '线上那一版' });

    // ① 普通用户提的修改：线上**一个字都不变**，进待审
    const suggestion = await call('PATCH', `/api/calendar/${id}`, {
      json: eventInput({ title: '用户提的修改' }),
      cookie: author.cookie,
    });
    assert.equal(suggestion.status, 200, JSON.stringify(suggestion.body));
    assert.equal(suggestion.body.liveRevisionUnchanged, true, '提审路径必须说"线上没变"');
    assert.equal(await liveEventTitle(id), '线上那一版', '提审之后线上仍是旧版');

    // ② 有待审时直编必须被拒：否则那条快照被批准时会把直编内容**静默回滚**
    const blocked = await call('PATCH', `/api/authoring/calendar/${id}`, {
      json: eventInput({ title: '直编撞上待审' }),
      cookie: editor.cookie,
    });
    assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
    assert.equal(blocked.body.error, 'already_pending');
    // 409 之后线上仍是旧版（"拒绝了"不能顺手写进去）
    assert.equal(await liveEventTitle(id), '线上那一版');

    // ③ 驳回那条待审，直编才成立 —— 而且立刻生效
    const rejected = await call('POST', `/api/admin/review/calendar/${id}/reject`, {
      json: { reason: '先把它驳掉再直编' },
      cookie: reviewer.cookie,
    });
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
    /*
     * ⚠️ 驳回**没有**把这场已发布的赛事撤下来（`liveVersionKept`）：
     *    那是 F3 那个坑的形状 —— 判据看 `status` 而不是 `current_revision`。
     *    这里顺手把它按死，因为直编新建的事件正是那个坑最容易踩到的一类。
     */
    assert.equal(
      rejected.body.liveVersionKept,
      true,
      '驳回一条已发布赛事的修改，不能把它从日历上抹掉',
    );
    assert.equal(await liveEventTitle(id), '线上那一版');

    const direct = await call('PATCH', `/api/authoring/calendar/${id}`, {
      json: eventInput({ title: '编辑直编的标题' }),
      cookie: editor.cookie,
    });
    assert.equal(direct.status, 200, JSON.stringify(direct.body));
    assert.equal(direct.body.liveRevisionUnchanged, false, '直编必须说"线上已经改了"');
    assert.equal(direct.body.status, 'published');
    assert.equal(await liveEventTitle(id), '编辑直编的标题', '直编要立刻上线');

    // 审计能分辨"直编"与"自批"，所以 reason 里必须写清是怎么来的
    /*
     * ⚠️ 精确匹配 `calendar.directEdit`，不要用 `LIKE 'calendar.direct%'`：
     *    这条赛事本身就是**直编新建**的，所以那份 `directCreate` 也会命中 ——
     *    拿到 2 条然后报"多了"，看起来像审计重复写了，其实只是过滤太宽。
     */
    const rows = getDb()
      .prepare(
        "SELECT reason FROM audit_log WHERE entity_id = ? AND action = 'calendar.directEdit'",
      )
      .all(id) as Array<{ reason: string }>;
    assert.equal(rows.length, 1);
    assert.match(String(rows[0]?.reason), /直编（未走审核）/);
    /*
     * 新建那一条也在，而提审/审核那两条（`reviseOther` / `reject`）**没有**被当成直编。
     * ⚠️ 这里必须**过滤 + 排序**再比：`auditActions` 是按 `id` 排的，而 id 是随机 UUID
     *    —— 它不表达时间顺序，直接 deepEqual 整个列表会因为顺序而随机红。
     */
    assert.deepEqual(
      auditActions(id)
        .filter((a) => a.startsWith('calendar.direct'))
        .sort(),
      ['calendar.directCreate', 'calendar.directEdit'],
    );
  });

  it('★ 版本号取 MAX(revision)+1 —— 被驳回的版本仍然占着号（不能从 current_revision 推）', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const editor = await makeUser('editor');
    const id = await directEvent(editor.cookie, { title: 'r1 的标题' });

    /*
     * r2：用户提的修改，然后**被驳回**。`current_revision` 仍然是 1，
     * 但 r2 这个号已经被那条被驳回的快照占住了。
     */
    const suggestion = await call('PATCH', `/api/calendar/${id}`, {
      json: eventInput({ title: 'r2 的标题' }),
      cookie: author.cookie,
    });
    assert.equal(suggestion.status, 200, JSON.stringify(suggestion.body));
    assert.equal(suggestion.body.revision, 2);

    const rejected = await call('POST', `/api/admin/review/calendar/${id}/reject`, {
      json: { reason: '驳回，但这一版仍然占着 r2' },
      cookie: reviewer.cookie,
    });
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body));

    const direct = await call('PATCH', `/api/authoring/calendar/${id}`, {
      json: eventInput({ title: 'r3 的标题' }),
      cookie: editor.cookie,
    });
    /*
     * ⚠️ 若从 `current_revision(1) + 1` 推，这里会算出 r2 —— 撞上
     *    `content_revisions` 的 `UNIQUE (type, entity_id, revision)`，
     *    直编整个 500，而错误信息是 `UNIQUE constraint failed`，
     *    和真正的原因（"驳回过的版本仍然占着号"）毫无关系。
     *    资源那边为同一个坑写过一段注释，这里是它的日历版。
     */
    assert.equal(direct.status, 200, JSON.stringify(direct.body));
    assert.equal(
      direct.body.revision,
      3,
      '版本号必须接在 MAX(revision) 之后，而不是 current_revision + 1',
    );

    const revs = getDb()
      .prepare(
        'SELECT revision, status FROM content_revisions WHERE type = ? AND entity_id = ? ORDER BY revision',
      )
      .all('calendar', id) as Array<{ revision: number; status: string }>;
    assert.deepEqual(
      revs.map((r) => [r.revision, r.status]),
      [
        [1, 'approved'],
        [2, 'rejected'],
        [3, 'approved'],
      ],
    );
    // 线上是 r3 那一版
    assert.equal(await liveEventTitle(id), 'r3 的标题');
  });

  it('★ 删除是**直删**（不是两档）：editor 一次调用删掉已发布赛事 → 200；其它角色 403', async () => {
    const author = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const editor = await makeUser('editor');
    const owner = await makeUser('owner');

    /*
     * ⚠️⚠️ 为什么赛事**没有**资源/视频那种"先下架再删"的两档（captain 2026-09-13 裁定）：
     *     那道缓冲的唯一理由是"不可逆地毁掉**别人**的数据"（资源的删除会 CASCADE 掉
     *     所有人的收藏/私人备注/评分）。赛事无收藏、无备注、无任何连带数据；
     *     而且日历**没有下架入口**（spec §7.7 明确本轮不新开）—— 在赛事上要"先下架"
     *     等于把删除变成**谁也走不通的死路**：editor 对任何一条已发布的赛事永远 409。
     *     ⇒ 判据只剩**能力**。本用例的 ② 就是需求 ② 的"editor 可删赛事"那条证据。
     */

    // ① 没有 content.author 的角色 → 403（reviewer 是那条边界；普通用户同理）
    const idDenied = await directEvent(editor.cookie);
    for (const who of [reviewer.cookie, author.cookie]) {
      const denied = await call('DELETE', `/api/authoring/calendar/${idDenied}`, { cookie: who });
      assert.equal(
        denied.status,
        403,
        `无 content.author 必须是 403：${JSON.stringify(denied.body)}`,
      );
      assert.equal(denied.body.error, 'forbidden');
    }
    // 未登录是 401（与 403 是两个不同的下一步：去登录 / 这个操作与你无关）
    const anon = await call('DELETE', `/api/authoring/calendar/${idDenied}`);
    assert.equal(anon.status, 401, JSON.stringify(anon.body));

    // ★ 反面控制：三次被拒之后**赛事仍在日历上**（403 不能顺手删掉东西）
    assert.equal(await liveEventTitle(idDenied), '直编测试赛事');

    // ② ★ editor **一次调用**删掉一条**已发布**的赛事 → 200（不许 409、不许要求先下架）
    const removed = await call('DELETE', `/api/authoring/calendar/${idDenied}`, {
      cookie: editor.cookie,
    });
    assert.equal(
      removed.status,
      200,
      `editor 应当一次删掉已发布赛事，而不是被状态挡住：${JSON.stringify(removed.body)}`,
    );
    assert.equal(removed.body.status, 'deleted');
    assert.equal(await liveEventTitle(idDenied), undefined, '删掉之后公开详情必须 404');

    // ③ owner 同样删得掉（这条路径上 owner 与 editor 的差别只剩审计 reason）
    const idForOwner = await directEvent(editor.cookie);
    const removedByOwner = await call('DELETE', `/api/authoring/calendar/${idForOwner}`, {
      cookie: owner.cookie,
    });
    assert.equal(removedByOwner.status, 200, JSON.stringify(removedByOwner.body));
    assert.equal(removedByOwner.body.status, 'deleted');

    // ④ 一条**还没上架**的（用户提的待审）也删得掉 —— 判据是能力，不是状态
    const pendingId = (
      await call('POST', '/api/calendar', {
        json: eventInput({ title: '用户提交、还没上架的' }),
        cookie: author.cookie,
      })
    ).body.id as string;
    assert.equal((await call('GET', `/api/calendar/${pendingId}`)).status, 404, '待审的不在站上');
    const removedPending = await call('DELETE', `/api/authoring/calendar/${pendingId}`, {
      cookie: editor.cookie,
    });
    assert.equal(removedPending.status, 200, JSON.stringify(removedPending.body));

    // ⑤ 审计：两种身份都留痕，且 reason 里写明**版本历史一并删除**（不可逆）
    for (const [label, id] of [
      ['editor 直删', idDenied],
      ['owner 直删', idForOwner],
    ] as const) {
      const row = getDb()
        .prepare(
          "SELECT reason FROM audit_log WHERE entity_id = ? AND action = 'calendar.directDelete'",
        )
        .get(id) as { reason: string } | undefined;
      assert.ok(row, `${label}：必须写一条 calendar.directDelete 审计`);
      assert.match(String(row.reason), /版本历史/, `${label}：连带删除要写进 reason`);
      assert.match(String(row.reason), /不可恢复/, `${label}：这是唯一不可逆的动作，要说清`);
    }

    // ⑥ 真删要**连快照一起删**：content_revisions 没有外键，不删就是永远查不到的孤儿行
    for (const id of [idDenied, idForOwner, pendingId]) {
      assert.equal(countRows('calendar_events', 'id', id), 0);
      assert.equal(
        countRows('content_revisions', 'entity_id', id),
        0,
        'content_revisions 必须一起删（那张表没有外键，不删会留下孤儿行、里面还可能有 pending 快照）',
      );
    }
  });
});

describe('② 直编：视频', () => {
  it('★ 改标题与起始偏移立刻生效；审计 video.directEdit', async () => {
    const editor = await makeUser('editor');
    const id = await postVideo(editor.cookie);

    const res = await call('PATCH', `/api/authoring/videos/${id}`, {
      json: {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        title: '编辑改过的标题',
        startOffsetSec: 90,
      },
      cookie: editor.cookie,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.liveRevisionUnchanged, false, '§3.2b：这条写路径已经生效');
    /*
     * ⚠️ 顶层 `status` 必须存在：前端的 `directWriteNotice`（`DirectOutcome`）
     *    读的就是"顶层 status + liveRevisionUnchanged"这一对。少了它，视频这条路径
     *    只能单独破例去读 `video.status` —— 那正是三个直编端点会漂移的起点。
     */
    assert.equal(res.body.status, 'visible', '顶层 status 必须与 video.status 一致');

    const video = res.body.video as {
      title: string;
      startOffsetSec: number | null;
      status: string;
    };
    assert.equal(video.title, '编辑改过的标题');
    assert.equal(video.startOffsetSec, 90);
    assert.equal(
      video.status,
      res.body.status,
      '顶层 status 是 video.status 的镜像，不许两份不一致',
    );

    // 公开视频墙立刻是新的（"已经生效"不是嘴上说的）
    const wall = await call('GET', '/api/videos');
    const found = (wall.body.items as Array<{ id: string; title: string }>).find(
      (v) => v.id === id,
    );
    assert.equal(found?.title, '编辑改过的标题');

    const rows = getDb()
      .prepare(
        "SELECT action, reason FROM audit_log WHERE entity_id = ? AND action LIKE 'video.direct%'",
      )
      .all(id) as Array<{ action: string; reason: string }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.action, 'video.directEdit');
    assert.match(String(rows[0]?.reason), /直编（未走审核）/);
  });

  it('★ 只改标题（链接不变）不能被判成"这个视频已经在站上了"（查重要排除自己）', async () => {
    const editor = await makeUser('editor');
    const id = await postVideo(editor.cookie);

    /*
     * ⚠️ 这是本端点最容易写成 bug 的一处：`(platform, video_id)` 上有**全表**
     *    UNIQUE，而"改标题、链接不动"是最常见的一次编辑。
     *    查重不排除自己的话，"改个标题"会拿到 409「这个视频已经在站上了」——
     *    用户改的正是那一条，而这句话对他毫无意义。
     */
    const res = await call('PATCH', `/api/authoring/videos/${id}`, {
      json: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: '只改了标题' },
      cookie: editor.cookie,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((res.body.video as { title: string }).title, '只改了标题');
  });

  it('★ 换成别人已经贴过的链接 → 409 video_exists + existingId（不是 500）', async () => {
    const editor = await makeUser('editor');
    const mineId = await postVideo(editor.cookie, 'dQw4w9WgXcQ');
    const otherId = await postVideo(editor.cookie, 'oHg5SJYRHA0');

    const res = await call('PATCH', `/api/authoring/videos/${mineId}`, {
      json: { url: 'https://www.youtube.com/watch?v=oHg5SJYRHA0', title: '撞车了' },
      cookie: editor.cookie,
    });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.error, 'video_exists');
    assert.equal(res.body.existingId, otherId, '必须告诉调用方撞上的是哪一条（前端据此给链接）');

    // 反面控制：409 之后两条都还在，而且标题没被改掉
    const kept = await call('GET', `/api/videos?authorId=`);
    const ids = (kept.body.items as Array<{ id: string }>).map((v) => v.id);
    assert.ok(ids.includes(mineId) && ids.includes(otherId), '409 不能顺手删掉或改掉任何一条');
  });

  it('★ 直编不会把"被隐藏"顺手撤销（status 不动），也检查未登录/权限', async () => {
    const editor = await makeUser('editor');
    const reviewer = await makeUser('reviewer');
    const viewer = await makeUser('user');
    const id = await postVideo(editor.cookie);

    // 先由治理动作（有 resource.moderate 的人）隐藏它
    const hidden = await call('PATCH', `/api/videos/${id}/visibility`, {
      json: { status: 'hidden' },
      cookie: editor.cookie,
    });
    assert.equal(hidden.status, 200, JSON.stringify(hidden.body));

    const direct = await call('PATCH', `/api/authoring/videos/${id}`, {
      json: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: '隐藏之后又改了' },
      cookie: editor.cookie,
    });
    assert.equal(direct.status, 200, JSON.stringify(direct.body));
    /*
     * ⚠️ 内容确实改了，但**这条仍然不在墙上**：隐藏是一个明确的治理决定，
     *    不该被一次内容修改顺手撤销 —— 否则"隐藏"就变成"随便改点什么就恢复"。
     */
    assert.equal((direct.body.video as { status: string }).status, 'hidden');
    /*
     * ★★ 这一条是 §3.2b 语义边界 #1 的**机器可判形式**，也是前端 `directWriteNotice`
     *    中间那一档（`false` + `status === 'hidden'` → "已保存 + 这条目前不在站上"）
     *    唯一的输入来源：顶层 `status` 必须是 `hidden`，不能是写死的 `'visible'`。
     *    写死的话，用户改完一条被隐藏的视频会看到"已直接发布，线上已可见" ——
     *    而他不会去点「恢复上架」，那条视频就一直躺在隐藏里（**没有任何报错**）。
     */
    assert.equal(
      direct.body.status,
      'hidden',
      '顶层 status 必须反映真实状态：否则界面会对一条被隐藏的视频说"线上已可见"',
    );
    const wall = await call('GET', '/api/videos');
    assert.ok(
      !(wall.body.items as Array<{ id: string }>).some((v) => v.id === id),
      '它仍然不在公开视频墙上',
    );

    // 权限：reviewer / 普通用户 403；未登录 401
    for (const who of [reviewer.cookie, viewer.cookie]) {
      const denied = await call('PATCH', `/api/authoring/videos/${id}`, {
        json: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: '别人改的' },
        cookie: who,
      });
      assert.equal(denied.status, 403, JSON.stringify(denied.body));
    }
    const anon = await call('PATCH', `/api/authoring/videos/${id}`, {
      json: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: '匿名改的' },
    });
    assert.equal(anon.status, 401, JSON.stringify(anon.body));

    // 不存在的 id 是 404（而不是把"改不动"混成权限问题）
    const missing = await call('PATCH', '/api/authoring/videos/does-not-exist', {
      json: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: '改空气' },
      cookie: editor.cookie,
    });
    assert.equal(missing.status, 404, JSON.stringify(missing.body));
  });

  it('★ 作者删自己那条路仍然照旧（直编删除与它是并存的，语义不变）', async () => {
    const editor = await makeUser('editor');
    const viewer = await makeUser('user');
    const id = await postVideo(viewer.cookie);

    /*
     * ⚠️ 这条是**反向验证**：新增一条"直编删除"最容易弄坏的就是原来那条
     *    "作者删自己的 / 治理者隐藏别人的"。两者语义必须都还在。
     */
    const byEditor = await call('DELETE', `/api/videos/${id}`, { cookie: editor.cookie });
    assert.equal(byEditor.status, 200, JSON.stringify(byEditor.body));
    assert.equal(byEditor.body.mode, 'hidden', '治理者删别人的仍然是**隐藏**，不是真删');
    assert.equal(countRows('videos', 'id', id), 1, '隐藏之后行还在（可恢复）');

    const byAuthor = await call('DELETE', `/api/videos/${id}`, { cookie: viewer.cookie });
    assert.equal(byAuthor.status, 200, JSON.stringify(byAuthor.body));
    assert.equal(byAuthor.body.mode, 'deleted', '作者删自己的仍然是真删');
    assert.equal(countRows('videos', 'id', id), 0);
  });

  it('★ 删除**两档**：owner 一键；editor/admin 对还在墙上的 409；hidden 的直接删；其它 403', async () => {
    const viewer = await makeUser('user');
    const reviewer = await makeUser('reviewer');
    const editor = await makeUser('editor');
    const owner = await makeUser('owner');

    // ① 没有 content.author 的角色 → 403
    const idDenied = await postVideo(editor.cookie, 'dQw4w9WgXcQ');
    for (const who of [reviewer.cookie, viewer.cookie]) {
      const denied = await call('DELETE', `/api/authoring/videos/${idDenied}`, { cookie: who });
      assert.equal(denied.status, 403, JSON.stringify(denied.body));
      assert.equal(denied.body.error, 'forbidden');
    }
    assert.equal(countRows('videos', 'id', idDenied), 1, '403 不能顺手删掉东西');

    /*
     * ② editor 删一条**还在墙上**的（`visible`）→ 409 `must_hide_first`
     *
     * ⚠️ 判据 = **两档**（captain 2026-09-13 定稿："两档只适用于**第二步走得通**的类型 ——
     *    资源/视频有 `PATCH …/visibility` 下架入口 ⇒ 两档；日历没有 ⇒ 直删。
     *    *连带数据决定那道缓冲值不值，下架入口决定它能不能。*"）。
     *    视频这条的第二步**走得通**，所以两档成立。
     *
     * ⚠️ 这里**曾经被写成 (a)**（"editor 一律 403，连隐藏之后再删也 403"）—— **那是错的**：
     *    用户原话把"删"放进了 editor+ 的能力里（需求 ②「修改/添加/**删除**」），
     *    「**另外**允许 owner **一键**真正删除」只多出"**一键**"两个字。
     *    照 (a) 实现会让 editor/admin 永远删不掉任何一条视频。
     */
    const blocked = await call('DELETE', `/api/authoring/videos/${idDenied}`, {
      cookie: editor.cookie,
    });
    assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
    assert.equal(blocked.body.error, 'invalid_state');
    assert.equal(blocked.body.reason, 'must_hide_first');
    assert.equal(countRows('videos', 'id', idDenied), 1, '409 之后行必须还在');

    // ③ 先隐藏（**可恢复**），再删 → 200。这才是"两步"的第二步
    const hidden = await call('PATCH', `/api/videos/${idDenied}/visibility`, {
      json: { status: 'hidden' },
      cookie: editor.cookie,
    });
    assert.equal(hidden.status, 200, JSON.stringify(hidden.body));
    const afterHide = await call('DELETE', `/api/authoring/videos/${idDenied}`, {
      cookie: editor.cookie,
    });
    assert.equal(afterHide.status, 200, JSON.stringify(afterHide.body));
    assert.equal(afterHide.body.mode, 'deleted');
    assert.equal(countRows('videos', 'id', idDenied), 0);

    // ④ owner → **一键**：还在墙上也直接删
    const idForOwner = await postVideo(owner.cookie, 'oHg5SJYRHA0');
    const removed = await call('DELETE', `/api/authoring/videos/${idForOwner}`, {
      cookie: owner.cookie,
    });
    assert.equal(removed.status, 200, JSON.stringify(removed.body), 'owner 应当是"一键"，不是 409');
    assert.equal(countRows('videos', 'id', idForOwner), 0);
    assert.ok(
      auditActions(idForOwner).includes('video.directDelete'),
      '两种档位都必须留审计（reason 里区分"一键"与"先下架后删"）',
    );
  });
});
