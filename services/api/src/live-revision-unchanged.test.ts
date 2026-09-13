/**
 * §3.2b 的硬性契约：**每条写内容的路径都必须显式返回 `liveRevisionUnchanged`**。
 *
 * ---------------------------------------------------------------------------
 * 为什么这条必须靠测试守，而不能靠类型
 * ---------------------------------------------------------------------------
 * 这个字段回答的是界面上那句最要紧的话：**"这次改动到底生效了没有"**。
 * 猜错的方向恰好是最坏的那个 —— 用户以为已经上线了，其实还在待审队列里。
 *
 * 但它**没有任何编译期保护**：
 *   · 服务端的响应是**内联对象字面量**（不是共享类型），少一个键不会被 tsc 发现；
 *   · 前端那几个 `SubmissionResult` / `CalendarSubmitResult` / `VideoSubmitResult`
 *     是**手写的**（shared 里零命中），所以两边也不会因为类型不一致而报错。
 * ⇒ 漏写一处，全仓绿、测试全绿、界面开始撒谎。所以这里逐条把它按死。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 断言的是**存在性**，不只是真值
 * ---------------------------------------------------------------------------
 * 只写 `assert.equal(body.liveRevisionUnchanged, false)` 是**假通过**：
 * 字段缺失时取值是 `undefined`，而 `undefined !== false` 会红 —— 但如果有人把断言
 * 写成 `assert.ok(!body.liveRevisionUnchanged)`，`undefined` 就会冒充 `false`。
 * 所以下面一律先 `'liveRevisionUnchanged' in body`，再比值。
 * 第三条用**反面控制**证明这个 helper 在字段缺失时真的会红。
 *
 * ⚠️ 覆盖范围（2026-09-13 补齐）：`/api/authoring/{resources,calendar}`（POST/PATCH）与
 *    `/api/authoring/videos/:id`（PATCH）**全部在这一张表里** —— 这五条写路径里
 *    任何一条漏写字段，表现都是"界面开始撒谎"，而它**不会有任何编译错误**。
 *    新增写内容的端点时，必须同时在这里加一行，否则等于给未来的谎言留一个缺口。
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
  db.exec('DELETE FROM resource_revisions');
  db.exec('DELETE FROM resource_marks');
  db.exec('DELETE FROM resources');
  db.exec('DELETE FROM videos');
  db.exec('DELETE FROM calendar_events');
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
async function makeUser(role: 'user' | 'reviewer' | 'editor' = 'user') {
  seq += 1;
  const email = `rev${String(seq)}.${Date.now()}@example.com`;
  await call('POST', '/api/auth/register', {
    json: { email, password: PASSWORD, displayName: `修订${String(seq)}`, locale: 'zh-CN' },
  });
  getDb()
    .prepare('UPDATE users SET email_verified_at = ?, role = ? WHERE email = ?')
    .run(Date.now(), role, email);
  const login = await call('POST', '/api/auth/login', { json: { email, password: PASSWORD } });
  return { cookie: (login.setCookie ?? '').split(';')[0] as string };
}

/**
 * 契约检查：字段必须**存在**，且值等于期望。
 *
 * ⚠️ 两个断言缺一不可 —— 只看值的话 `undefined` 在某些写法下会冒充 `false`；
 *    只看存在性的话 `true`/`false` 写反了也没人发现。
 */
function expectFlag(label: string, body: Record<string, unknown>, expected: boolean): void {
  assert.ok(
    'liveRevisionUnchanged' in body,
    `${label}：响应里**没有** liveRevisionUnchanged —— 少一个键不会有任何编译错误，` +
      `所以只能靠这条断言挡住（spec §3.2b）`,
  );
  assert.equal(body.liveRevisionUnchanged, expected, `${label}：取值应当是 ${String(expected)}`);
}

let urlSeq = 0;
async function submitResource(cookie: string): Promise<string> {
  urlSeq += 1;
  const res = await call('POST', '/api/resources', {
    json: {
      kind: 'website',
      title: '契约测试条目',
      url: `https://rev-${String(urlSeq)}.example.com/`,
      body: '正文',
      lang: 'zh-CN',
      tags: ['tools'],
    },
    cookie,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  expectFlag('POST /api/resources', res.body, true);
  return res.body.id as string;
}

async function submitEvent(cookie: string): Promise<string> {
  const res = await call('POST', '/api/calendar', {
    json: {
      title: '契约测试赛事',
      startsAtTz: 'Asia/Shanghai',
      // ⚠️ 017（2026-09-13）起时间是 `slots`（一个时区 + 若干段）。
      //    顶层 `startsAtLocal` 已经不是入参 ⇒ 这一笔会 400
      //    `slots: expected array, received undefined`，于是下面那条
      //    `expectFlag` 会红在"响应里没有 liveRevisionUnchanged"上 ——
      //    看起来像服务端漏了字段，其实是**请求本身没被接受**。
      slots: [{ startsAtLocal: '2030-09-05T16:00' }],
      tags: ['TOURNAMENT'],
    },
    cookie,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  expectFlag('POST /api/calendar', res.body, true);
  return res.body.id as string;
}

describe('§3.2b liveRevisionUnchanged：每条写路径都必须显式返回', () => {
  it('提审路径：四条都是存在且为 true（线上仍是旧版）', async () => {
    const author = await makeUser();
    const editor = await makeUser('editor');
    const reviewer = await makeUser('reviewer');

    // ① 新建（两条内容类型）—— 提审新建也是 true："线上没有这一条"
    await submitResource(author.cookie);
    const eventId = await submitEvent(author.cookie);

    /*
     * ② 提审修改必须先有**已上架**的内容。刚提交的条目本身占着 `pending_revision`
     *    （一次只允许一份待审），再 PATCH 会 409 `already_pending` ——
     *    那是产品**正确**的行为，不是这里要验的东西。
     *    所以先用编辑的直编建一条已上架条目（顺便也验了直编那条路径）。
     */
    urlSeq += 1;
    const published = await call('POST', '/api/authoring/resources', {
      json: {
        kind: 'website',
        title: '已上架的条目',
        url: `https://rev-live-${String(urlSeq)}.example.com/`,
        body: '正文',
        lang: 'zh-CN',
        tags: ['tools'],
      },
      cookie: editor.cookie,
    });
    assert.equal(published.status, 201, JSON.stringify(published.body));
    expectFlag('POST /api/authoring/resources（先建出已上架内容）', published.body, false);
    const liveId = published.body.id as string;
    const before = await call('GET', `/api/resources/${liveId}`);

    // ③ PATCH /api/resources/:id → true，而且**线上真的没变**（字段与事实绑在一起验）
    urlSeq += 1;
    const suggestion = await call('PATCH', `/api/resources/${liveId}`, {
      json: {
        kind: 'website',
        title: '陌生人提的修改',
        url: `https://rev-${String(urlSeq)}.example.com/`,
        body: '正文',
        lang: 'zh-CN',
        tags: ['tools'],
      },
      cookie: author.cookie,
    });
    assert.equal(suggestion.status, 200, JSON.stringify(suggestion.body));
    expectFlag('PATCH /api/resources/:id', suggestion.body, true);
    const after = await call('GET', `/api/resources/${liveId}`);
    assert.equal(
      (after.body as { title?: string }).title,
      (before.body as { title?: string }).title,
      '说了 true 就必须真的没变 —— 这条断言把字段和事实绑在一起',
    );

    // ④ PATCH /api/calendar/:id → true（同样要先把赛事走到"已上架"）
    const approvedEvent = await call('POST', `/api/admin/review/calendar/${eventId}/approve`, {
      cookie: reviewer.cookie,
    });
    assert.equal(approvedEvent.status, 200, JSON.stringify(approvedEvent.body));

    const patchedEvent = await call('PATCH', `/api/calendar/${eventId}`, {
      json: {
        title: '改过的赛事标题',
        startsAtTz: 'Asia/Shanghai',
        // ⚠️ 同上：017 起时间只能写在 `slots` 里
        slots: [{ startsAtLocal: '2030-09-06T16:00' }],
        tags: ['TOURNAMENT'],
      },
      cookie: author.cookie,
    });
    assert.equal(patchedEvent.status, 200, JSON.stringify(patchedEvent.body));
    expectFlag('PATCH /api/calendar/:id', patchedEvent.body, true);
  });

  it('直编与视频路径：存在且为 false（已经生效）', async () => {
    const editor = await makeUser('editor');

    // 直编新建
    urlSeq += 1;
    const created = await call('POST', '/api/authoring/resources', {
      json: {
        kind: 'website',
        title: '直编新建',
        url: `https://rev-${String(urlSeq)}.example.com/`,
        body: '正文',
        lang: 'zh-CN',
        tags: ['tools'],
      },
      cookie: editor.cookie,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    expectFlag('POST /api/authoring/resources', created.body, false);

    // 直编修改
    urlSeq += 1;
    const edited = await call('PATCH', `/api/authoring/resources/${String(created.body.id)}`, {
      json: {
        kind: 'website',
        title: '直编改过的标题',
        url: `https://rev-${String(urlSeq)}.example.com/`,
        body: '正文',
        lang: 'zh-CN',
        tags: ['tools'],
      },
      cookie: editor.cookie,
    });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    expectFlag('PATCH /api/authoring/resources/:id', edited.body, false);

    // 视频没有审核：贴上来就是可见的
    const video = await call('POST', '/api/videos', {
      json: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: '契约测试视频' },
      cookie: editor.cookie,
    });
    assert.equal(video.status, 201, JSON.stringify(video.body));
    expectFlag('POST /api/videos', video.body, false);

    /*
     * 直编赛事：新建 + 修改两条都要显式给出。
     *
     * ⚠️ 这两条是**最容易漏的**：它们的响应形状和"提审"那两条长得几乎一样
     *    （同样有 `id` / `revision` / `status`），只差这个字段的**取值**。
     *    漏写时前端会按"没读到 ⇒ 当 false"去猜 —— 而这里恰好猜对了，
     *    所以它在日历那条 `true` 的路径上才会翻车：日历编辑页会说"已生效"。
     */
    const directEvent = await call('POST', '/api/authoring/calendar', {
      json: {
        title: '直编建的赛事',
        startsAtTz: 'Asia/Shanghai',
        // ⚠️ 017 起时间只能写在 `slots` 里（见 `submitEvent` 的注释）
        slots: [{ startsAtLocal: '2030-10-05T16:00' }],
        tags: ['TOURNAMENT'],
      },
      cookie: editor.cookie,
    });
    assert.equal(directEvent.status, 201, JSON.stringify(directEvent.body));
    expectFlag('POST /api/authoring/calendar', directEvent.body, false);

    const directEventEdit = await call(
      'PATCH',
      `/api/authoring/calendar/${String(directEvent.body.id)}`,
      {
        json: {
          title: '直编改过的赛事标题',
          startsAtTz: 'Asia/Shanghai',
          // ⚠️ 同上
          slots: [{ startsAtLocal: '2030-10-06T16:00' }],
          tags: ['TOURNAMENT'],
        },
        cookie: editor.cookie,
      },
    );
    assert.equal(directEventEdit.status, 200, JSON.stringify(directEventEdit.body));
    expectFlag('PATCH /api/authoring/calendar/:id', directEventEdit.body, false);

    /*
     * 直编视频：视频**没有版本表**，所以这个 false 的含义是"线上那一行刚被改过"，
     * 不是"失败了"（§3.2b 的三条语义边界之一）。
     *
     * ⚠️ 视频贴完的 id 在 `body.video.id`（不在 `body.id`）—— 这一条与资源/赛事不同，
     *    写错的表现是 PATCH 拿到 404，而它看起来像"权限或者路由不对"。
     */
    const videoId = (video.body.video as { id: string }).id;
    const videoEdit = await call('PATCH', `/api/authoring/videos/${videoId}`, {
      json: {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        title: '直编改过的视频标题',
        startOffsetSec: 90,
      },
      cookie: editor.cookie,
    });
    assert.equal(videoEdit.status, 200, JSON.stringify(videoEdit.body));
    expectFlag('PATCH /api/authoring/videos/:id', videoEdit.body, false);
  });

  it('★ 反面控制：字段缺失时这条断言必须红（否则 undefined 会冒充 false）', () => {
    // 真的响应体（有字段）
    expectFlag('正常情形', { liveRevisionUnchanged: false }, false);

    // 缺字段的响应体 —— 必须抛，而且抛的是"没有这个字段"那条消息
    assert.throws(
      () => {
        expectFlag('缺字段', { ok: true }, false);
      },
      /没有\*\*liveRevisionUnchanged|没有\*\*liveRevisionUnchanged|liveRevisionUnchanged/,
      '字段缺失时这里必须红 —— 这条反面控制证明上面的断言不是恒真的',
    );

    // 值写反了也要红（说明它不只查存在性）
    assert.throws(() => {
      expectFlag('值写反', { liveRevisionUnchanged: true }, false);
    }, /取值应当是 false/);
  });
});
