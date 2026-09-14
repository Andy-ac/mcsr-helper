/**
 * ⑤ 系列颜色（2026-09-13）：`PUT /api/calendar/series/:id/color`。
 *
 * ---------------------------------------------------------------------------
 * 这个文件守的六件事（每一条都是"错了不会报错"的那种）
 * ---------------------------------------------------------------------------
 * 1. **权限是 owner 或编辑（`content.author`）**（2026-09-14 用户裁决放宽），
 *    用 `canHardDelete(role) || can('content.author', role)` 判 —— 不是
 *    `role === 'owner'`，也不是新开一个能力。判错的后果是**双向的**：
 *    判宽了，reviewer / admin 也能改颜色；判窄了，**编辑点不动**（而系列是编辑建的，
 *    那等于"谁建的谁不能调"）—— 而两次都不会报错。
 * 2. **传的是键、不是色值**。`#ff0000` 必须 400：静默存进去的话，
 *    `seriesColorValue()` 会在渲染时把它当成"没上色"（那个函数只认键），
 *    表现是"owner 改了颜色但界面没变"，而库里从此多了一个永远不生效的值。
 * 3. **路由顺序**：`/calendar/series/:id/color` 必须在 `/calendar/:id` 之前。
 *    顺序写反的表现是 404 `not_found` —— 它看起来完全像"这个功能没做"。
 * 4. **颜色只有一份**（在 `calendar_series` 上），事件读的是 JOIN 出来的值：
 *    改一次颜色必须**立刻**在所有事件上生效，而且**一个事件行都不许碰**
 *    （见最后那条"改颜色前后 calendar_events 逐行相同"）。
 *    事件行上冗余存色的表现是"日历上大部分线变色了、少数几条还是旧颜色"。
 * 5. **回包里的 `previousColor` 是真的旧值**（审计与"改回上一个颜色"都靠它）。
 *    先更新再读、或者读错行，都会得到一个看起来合理的错值。
 * 6. **审计记的是"旧 → 新"**，只记新值等于没记（与 `series.rename` 同一条规则）。
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
const { setSeriesColor } = await import('./calendar/events');
const { SITE } = await import('@mcsr/shared');

const PASSWORD = 'a good long passphrase';

after(() => closeDb());
beforeEach(() => {
  resetAll();
  const db = getDb();
  db.exec('DELETE FROM content_revisions');
  // ⚠️ 顺序要紧：事件先删（它们引用系列），否则外键会拦住 DELETE
  db.exec('DELETE FROM calendar_events');
  db.exec('DELETE FROM calendar_series');
  // 审计也要清：下面有一条断言"审计里**多了一条**"，留着别的用例的行会让它数错
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

let seq = 0;
async function makeUser(role: 'user' | 'reviewer' | 'editor' | 'admin' | 'owner') {
  seq += 1;
  const email = `color${String(seq)}.${Date.now()}@example.com`;
  await call('POST', '/api/auth/register', {
    json: { email, password: PASSWORD, displayName: `颜色${String(seq)}`, locale: 'zh-CN' },
  });
  getDb()
    .prepare('UPDATE users SET email_verified_at = ?, role = ? WHERE email = ?')
    .run(Date.now(), role, email);
  const login = await call('POST', '/api/auth/login', { json: { email, password: PASSWORD } });
  return { email, cookie: (login.setCookie ?? '').split(';')[0] as string };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    title: '颜色测试赛事',
    /*
     * ⚠️ 017 起时间是 `slots`（多段）而不是 `startsAtLocal`。
     *    老写法会让每一笔提交都 400 `slots: expected array, received undefined`，
     *    而那看起来像"这个测试文件坏了"，不是"契约变了"。
     */
    startsAtTz: 'Asia/Shanghai',
    slots: [{ startsAtLocal: '2030-09-05T16:00' }],
    tags: ['TOURNAMENT'],
    ...overrides,
  };
}

/** 建一个系列（editor 及以上都行；返回 id）。 */
async function createSeries(cookie: string, name: string): Promise<string> {
  const res = await call('POST', '/api/calendar/series', { json: { name }, cookie });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return (res.body.series as { id: string }).id;
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

/** `GET /api/calendar/series` 里某个系列那一行。 */
async function seriesRow(id: string): Promise<{ name: string; color: string | null } | undefined> {
  const res = await call('GET', '/api/calendar/series');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const items = res.body.items as Array<{ id: string; name: string; color: string | null }>;
  return items.find((s) => s.id === id);
}

/** 某个系列的那条颜色审计。 */
function colorAuditEntries(id: string): Array<{ action: string; reason: string | null }> {
  return getDb()
    .prepare(
      `SELECT action, reason FROM audit_log
       WHERE entity_type = 'calendar_series' AND entity_id = ? AND action = 'series.color'
       ORDER BY created_at ASC`,
    )
    .all(id) as unknown as Array<{ action: string; reason: string | null }>;
}

/** `calendar_events` 全表快照（**逐行逐列**，用来证明"改颜色没碰任何事件"）。 */
function eventRowsSnapshot(): Array<Record<string, unknown>> {
  const rows = getDb()
    .prepare('SELECT * FROM calendar_events ORDER BY id')
    .all() as unknown as Array<Record<string, unknown>>;
  // ⚠️ 展开成普通对象：node:sqlite 的行对象原型不是 Object.prototype，
  //    而 deepStrictEqual 会比较原型（两边打印出来一模一样却判不相等）
  return rows.map((r) => ({ ...r }));
}

describe('⑤ 系列颜色：owner 与编辑可写的写路径', () => {
  it('★ 路由顺序：这个端点存在，而不是被 /calendar/:id 吃掉回 404', async () => {
    /*
     * ⚠️ 一条最便宜的守门：**匿名**打这个端点必须回 401（未登录），
     *    而不是 404。回 404 有两种可能：路由顺序反了（`series` 被当成事件 id），
     *    或者端点的路径压根写错了（少一段 `color`）—— 两者在用户眼里
     *    都是"这个功能没做"。
     */
    const res = await call('PUT', '/api/calendar/series/some-id/color', { json: { color: 'red' } });
    assert.equal(res.status, 401, JSON.stringify(res.body));
    assert.equal(res.body.error, 'unauthorized');
  });

  it('★ 匿名 401', async () => {
    const res = await call('PUT', '/api/calendar/series/anything/color', { json: { color: null } });
    assert.equal(res.status, 401, `匿名必须是 401，实际 ${String(res.status)}`);
  });

  it('★★ 编辑及以上（editor / admin / owner）都能改；reviewer 与普通用户 403', async () => {
    /*
     * ★ 2026-09-14 用户裁决**放宽**了这条权限：第一版做成了 owner 专属
     *    （照"允许 owner 修改颜色"的字面），用户随后选择"也放开给编辑"。
     *    理由与本仓那条通用规矩一致：**可逆的走 `content.author`，
     *    不可逆的才留给 owner** —— 换个颜色再点一下就回去了，
     *    而删系列是"一次动作硬删掉该系列下每一场赛事连同版本历史"。
     *    ⚠️ 现实理由同样重要：**系列是编辑建的**，要求 owner 才能上色
     *      等于"谁建的谁不能调"，那不是一条能长期维持的规则。
     *
     * ⚠️★ 判据就是**建系列 / 改系列名的那个能力** `content.author`，
     *    而它是"**editor 及以上**"：`MATRIX.admin` 与 `MATRIX.owner` 都包含
     *    `EDITOR_CAPS`。⇒ **admin 能改颜色是预期行为**，不是判宽了
     *    （第一版这条用例把 admin 也算进"该被挡住"，实测拿到 200 —— 那是**用例写错了**，
     *    不是实现错了。把它记在这里，免得下一个人再按"只有 editor 和 owner"去改实现）。
     *    真正被挡住的只有**没有那个能力**的两个：reviewer（只能审）与普通用户。
     *
     * ⚠️ 这里刻意**把五种角色都测一遍**，因为"判据写错"有好几种长相：
     *      · 写成 `role !== 'user'` → **reviewer 会被放行**（而它不该）；
     *      · 写成 `canHardDelete(role)` → **editor 会被挡住**（回到第一版的窄口径）；
     *      · 写成 `role === 'editor' || role === 'owner'`（硬编码角色名）→
     *        矩阵一改就**静默失效**，而所有测试依然全绿
     *        （这正是 `permissions.ts` 里那段长注释警告的失效方式）。
     *      · 只测一两个角色的话，上面几种都溜得过去。
     *
     * ⚠️ 判据是那个能力本身（`requireCapability('content.author')`），
     *    不是散在路由里的 `role === '…'`。
     */
    const owner = await makeUser('owner');
    const editor = await makeUser('editor');
    const admin = await makeUser('admin');
    const reviewer = await makeUser('reviewer');
    const member = await makeUser('user');
    const seriesId = await createSeries(owner.cookie, '权限边界');

    // ① 该被挡住的：没有 `content.author` 的那两个
    for (const [who, cookie] of [
      ['reviewer', reviewer.cookie],
      ['普通用户', member.cookie],
    ] as const) {
      const res = await call('PUT', `/api/calendar/series/${seriesId}/color`, {
        json: { color: 'red' },
        cookie,
      });
      assert.equal(res.status, 403, `${who} 不该能改颜色：${JSON.stringify(res.body)}`);
      assert.equal(res.body.error, 'forbidden');
    }

    // 反面控制：被拒之后库里**什么都没变**（"403"不能只是一句回复）
    assert.equal((await seriesRow(seriesId))?.color, null);
    assert.equal(colorAuditEntries(seriesId).length, 0);

    /*
     * ② 该被放行的三个：**editor / admin / owner**。
     *    ⚠️ 只断言"别人都不行"的话，一个把所有人都挡住的实现（比如错误地回 404）
     *      也能让上面两条全绿 —— 所以正面那一半必须有，而且要断言**库里真的落了值**。
     */
    /*
     * ⚠️ `previousColor` 逐次断言：第一次是 `null`（还没上过色），后面两次是 `'red'`
     *   —— 三个角色**依次**改同一个系列。写成"每次都 null"会红，而那不是实现的错：
     *   previousColor 的定义就是"这一次之前是什么"，第二次开始它就真的是 red。
     */
    let expectedPrevious: string | null = null;
    for (const [who, cookie] of [
      ['editor', editor.cookie],
      ['admin', admin.cookie],
      ['owner', owner.cookie],
    ] as const) {
      const res = await call('PUT', `/api/calendar/series/${seriesId}/color`, {
        json: { color: 'red' },
        cookie,
      });
      assert.equal(res.status, 200, `${who} 必须能改：${JSON.stringify(res.body)}`);
      assert.equal((await seriesRow(seriesId))?.color, 'red', `${who} 改完之后库里要真的是 red`);
      assert.equal(res.body.previousColor, expectedPrevious, `${who} 那一次的 previousColor`);
      expectedPrevious = 'red';
    }
    // 三次都写成功 ⇒ 审计三条（每次改色各留一条）
    assert.equal(colorAuditEntries(seriesId).length, 3);
  });

  it('★ 不存在的 id → 404', async () => {
    const owner = await makeUser('owner');
    const res = await call('PUT', '/api/calendar/series/no-such-series/color', {
      json: { color: 'red' },
      cookie: owner.cookie,
    });
    assert.equal(res.status, 404, JSON.stringify(res.body));
    assert.equal(res.body.error, 'not_found');
    // 也不该留下审计（一次没有发生的事不该在审计里）
    assert.equal(colorAuditEntries('no-such-series').length, 0);
  });

  it('★★ 非法键 400：色值（#ff0000）、大写（RED）、数字（42）、缺字段（{}）', async () => {
    /*
     * ⚠️ `#ff0000` 那一条是**这个测试文件里最要紧的一行**：色值存进库不会报错，
     *    而 `seriesColorValue()` 只认键 ⇒ 渲染时回退成"没上色"。
     *    于是 owner 看到的现象是"我改了颜色，可是那条线还是白的"，
     *    而库里躺着一个谁也看不懂的 `#ff0000`。
     *
     * ⚠️ `RED` 也必须在里面：键是 `red`，而 `z.enum` 是**大小写敏感**的。
     *    若哪天有人把它放宽成"大小写不敏感"，那 `RED` 就会被存进库 ——
     *    而 `SERIES_COLORS` 里没有 `RED` 这个键，于是又一次"存了但不生效"。
     *
     * ⚠️ `{}`（缺字段）与 `{ color: null }` 是**两件不同的事**：后者是"改成不上色"
     *    这条明确的指令，前者是客户端漏传了字段（bug）。所以 schema 用
     *    `.nullable()` 而不是 `.nullish()`，`{}` 必须被拒。
     */
    const owner = await makeUser('owner');
    const seriesId = await createSeries(owner.cookie, '非法输入');

    const bodies: Array<unknown> = [{ color: '#ff0000' }, { color: 'RED' }, { color: 42 }, {}];
    for (const json of bodies) {
      const res = await call('PUT', `/api/calendar/series/${seriesId}/color`, {
        json,
        cookie: owner.cookie,
      });
      assert.equal(
        res.status,
        400,
        `${JSON.stringify(json)} 应当被拒：${JSON.stringify(res.body)}`,
      );
      assert.equal(res.body.error, 'invalid_input');
    }

    // 反面控制：一个都没存进去
    assert.equal((await seriesRow(seriesId))?.color, null, '被拒的输入不能留下任何痕迹');
    assert.equal(colorAuditEntries(seriesId).length, 0);
  });

  it('★★ 数据层自己也会挡住认不出的键（zod 之外的第二层，直接调它也不许写进去）', async () => {
    /*
     * 上面那条走的是 HTTP + zod。而 `setSeriesColor` 的调用方**不只有路由**：
     *   · 一次性的数据脚本、将来的批量换色工具、别的内部调用，都不经过 zod；
     *   · 而"认不出的键"的后果是**静默的**：`seriesColorValue()` 会把它渲染成
     *     "没上色"（那个函数只认 `SERIES_COLORS` 里的键）。
     * ⇒ 所以数据层自己也断言一次，而且是**抛**（不是回一个 `{ok:false}`）：
     *   键非法是**我们的** bug，不是用户的一次失败请求 —— 它不该被当成
     *   "正常的拒绝"混进返回值的分支里。
     */
    const owner = await makeUser('owner');
    const seriesId = await createSeries(owner.cookie, '数据层断言');

    assert.throws(
      () => setSeriesColor(seriesId, 'reddd'),
      /调色板的键/,
      '认不出的键必须抛，否则它会静静地躺进库里而界面上什么都不变',
    );
    // 抛之后库里仍然是没上色（"抛了"必须真的什么都没写）
    assert.equal((await seriesRow(seriesId))?.color, null);

    // 对照：合法的键不抛，而且真的写进去了（否则上面那条断言可能只是"永远抛"）
    assert.deepEqual(setSeriesColor(seriesId, 'teal'), { ok: true, previousColor: null });
    assert.equal((await seriesRow(seriesId))?.color, 'teal');
    assert.deepEqual(setSeriesColor(seriesId, null), { ok: true, previousColor: 'teal' });
  });

  it('★★ owner 改成 red：回包、列表回读、previousColor、审计"旧 → 新"全都对上', async () => {
    const owner = await makeUser('owner');
    const seriesId = await createSeries(owner.cookie, 'MCSR Ranked Season 5');

    // 第一次：之前没上色 ⇒ previousColor 是 null（不是 undefined，也不是空字符串）
    const first = await call('PUT', `/api/calendar/series/${seriesId}/color`, {
      json: { color: 'red' },
      cookie: owner.cookie,
    });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.ok, true);
    assert.equal(first.body.id, seriesId);
    assert.equal(first.body.color, 'red', '回的是**键**，不是色值');
    assert.equal(first.body.previousColor, null, '之前没上色');

    // 回读：颜色真的落库了（而不是只回了一句 ok）
    assert.equal((await seriesRow(seriesId))?.color, 'red');

    // 第二次：改成另一个颜色 ⇒ previousColor 必须是 red
    const second = await call('PUT', `/api/calendar/series/${seriesId}/color`, {
      json: { color: 'teal' },
      cookie: owner.cookie,
    });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.color, 'teal');
    assert.equal(second.body.previousColor, 'red', 'previousColor 必须是真的旧值');

    /*
     * ★ 审计：两条记录，reason 都是"旧 → 新"。
     *   ⚠️ 只记新值的话，事后追查"颜色怎么变成 teal 的"就无从下手 ——
     *      那是 rename 那条路已经踩清楚的规则（同一条纪律）。
     *   ⚠️ `null` 写成「不上色」而不是字面 null：审计是**给人看的**。
     */
    const audits = colorAuditEntries(seriesId);
    assert.equal(audits.length, 2, `应当有两条 series.color 审计，实际：${JSON.stringify(audits)}`);
    assert.equal(audits[0]?.action, 'series.color');
    assert.equal(audits[0]?.reason, '不上色 → red');
    assert.equal(audits[1]?.reason, 'red → teal');
  });

  it('★ owner 改成 null（不上色）：previousColor 是改之前的颜色', async () => {
    const owner = await makeUser('owner');
    const seriesId = await createSeries(owner.cookie, '去掉颜色');

    await call('PUT', `/api/calendar/series/${seriesId}/color`, {
      json: { color: 'blue' },
      cookie: owner.cookie,
    });
    const cleared = await call('PUT', `/api/calendar/series/${seriesId}/color`, {
      json: { color: null },
      cookie: owner.cookie,
    });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
    assert.equal(cleared.body.color, null, 'null = 不上色（界面走白色 + 描边那一档）');
    assert.equal(cleared.body.previousColor, 'blue');
    assert.equal((await seriesRow(seriesId))?.color, null);

    // 审计同样要能读："blue → 不上色"
    const audits = colorAuditEntries(seriesId);
    assert.equal(audits[1]?.reason, 'blue → 不上色');
  });

  it('★★ 颜色只有一份：改颜色之后事件上的 seriesColor 立刻跟着变，且事件行一行都没动', async () => {
    /*
     * 这是"颜色存在系列上、不冗余到事件行"的**唯一**判据，分两半：
     *   · 改之前/之后，事件读出来的 `seriesColor` 变了（说明读路径是 JOIN 出来的）；
     *   · 与此同时 `calendar_events` 的**每一行每一个字节都没变**
     *     （说明写路径没有去改事件 —— 冗余存色的实现一定会在这里露馅）。
     *
     * ⚠️ 第二条还顺带证明了"改颜色不会碰别人的内容"：一场赛事的内容是**别人**
     *    提交的，一次换颜色把它改掉（哪怕只是 `updated_at`）都是不该发生的。
     */
    const owner = await makeUser('owner');
    const reviewer = await makeUser('reviewer');
    const author = await makeUser('user');
    const seriesId = await createSeries(owner.cookie, '颜色与事件');
    const inSeries = await publish(author.cookie, reviewer.cookie, { seriesId });
    // 一场**不属于任何系列**的事件：它永远是 null（白色那一档），改系列颜色不该影响它
    const noSeries = await publish(author.cookie, reviewer.cookie, { title: '无系列' });

    /** 详情端点（走 getEventRow）与列表端点（走 listEvents）里的 seriesColor。 */
    const colorsOf = async (
      id: string,
    ): Promise<{ detail: unknown; listed: unknown; seriesName: unknown }> => {
      const detail = await call('GET', `/api/calendar/${id}`);
      assert.equal(detail.status, 200, JSON.stringify(detail.body));
      const list = await call('GET', '/api/calendar?from=0');
      const listed = (list.body.items as Array<{ id: string }>).find((e) => e.id === id);
      return {
        detail: (detail.body.event as Record<string, unknown>).seriesColor,
        listed: (listed as Record<string, unknown> | undefined)?.seriesColor,
        seriesName: (detail.body.event as Record<string, unknown>).seriesName,
      };
    };

    // 改之前：没上色 ⇒ 两个端点都是 null
    const before = await colorsOf(inSeries);
    assert.equal(before.detail, null);
    assert.equal(before.listed, null);
    /*
     * ⚠️ 顺带守住那个"详情端点的 seriesName 永远是 null"的旧缺陷：
     *    详情页正是最该显示"它属于哪个系列"的地方，而那个 bug 从 013 一直待到现在 ——
     *    因为它**不报错**（null 是合法值，列表页又显示得好好的）。
     */
    assert.equal(before.seriesName, '颜色与事件', '详情端点必须 JOIN 出系列名');

    const rowsBefore = eventRowsSnapshot();

    const set = await call('PUT', `/api/calendar/series/${seriesId}/color`, {
      json: { color: 'red' },
      cookie: owner.cookie,
    });
    assert.equal(set.status, 200, JSON.stringify(set.body));

    // 改之后：详情与列表**都**立刻是 red（不需要重新发布事件、不需要刷新缓存）
    const after = await colorsOf(inSeries);
    assert.equal(after.detail, 'red', '详情端点走的是 JOIN —— 不 JOIN 的话这里会一直是 null');
    assert.equal(after.listed, 'red');

    // 不属于任何系列的那一场不受影响（白色那一档）
    assert.equal((await colorsOf(noSeries)).detail, null, '无系列的事件永远是 null');

    // ★ 事件行逐行逐列相同（改颜色只 UPDATE 了 calendar_series 那一列）
    assert.deepEqual(
      eventRowsSnapshot(),
      rowsBefore,
      '改颜色不许碰任何事件行 —— 碰了就说明颜色被冗余存进事件表了',
    );
    assert.equal(eventRowsSnapshot().length, 2);
  });
});
