/**
 * 日历的筛选维度：`level`（专业程度）、`scope`（参与范围）、`access`（参赛门槛）、
 * `scopeDetail`（参与范围明细）。
 *
 * ---------------------------------------------------------------------------
 * 这个文件守的四件事
 * ---------------------------------------------------------------------------
 * 1. **筛选是"且"的语义**。三个单选维度各自等值匹配，叠加起来是 AND；
 *    而标签与 `scopeDetail` 是"任一命中"。两者语义不同 —— 把它们搞混的后果是
 *    "我筛了职业赛，结果业余的也出来了"，而那种错很难被看出来。
 * 2. **非法筛选值一律当"不限"，不能当"筛不到"**。查询参数是用户可以手打的，
 *    `?level=pro`（大小写错）如果被当成一个合法值原样送进 SQL，就会返回空集 ——
 *    看起来像"日历里没有这类赛事"，而库里明明有一条 PRO 的。
 *    宁可多给，也不要给一个**看起来像正确答案的**错误答案。
 * 3. **多选维度要认两种拼法**：`?scopeDetail=ASIA,OCEANIA` 与
 *    `?scopeDetail=ASIA&scopeDetail=OCEANIA`。后者是 `URLSearchParams.append`
 *    的自然产物，而 `c.req.query()` 只认**第一个** —— 少认一种的表现是
 *    "选了亚洲&大洋洲，澳洲的赛事一条都不出来"，而**不报错**。
 * 4. **改结构之前提交的待审快照仍然能审核通过**。011 之前的老快照的 JSON 里
 *    **没有** `level` / `scope` / `access` / `scopeDetail`（017 之前连 `slots` 都没有），
 *    直接取值会得到 `undefined`，而 node:sqlite 对 `undefined` 绑参是**报错**的 ——
 *    那条待审事件会在审批那一刻把整个动作炸掉，而报错信息指向绑参数量，
 *    和真正的原因（旧数据）毫无关系。
 *
 * ---------------------------------------------------------------------------
 * 2026-09-13（017）之后这一维模型的现状
 * ---------------------------------------------------------------------------
 *   · `level` 只剩 **PRO / AMATEUR**（原来的 CASUAL 被合并掉了）；
 *   · `access` 是**新的一维**（QUALIFIER / INVITE / OPEN），与 level/scope 同档；
 *   · `scopeDetail`（大洲/国家）与 `scope` 是**从属关系**：选到「大洲」「国家」
 *     之后才出现的那一行，多选、命中任一即显示；
 *   · **`stage`（轮次）被删掉了** —— 它不再是入参、不再是筛选维度，
 *     数据层那一列保留但不再读写（见下面"轮次"那条用例）。
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
const { CALENDAR_TYPE } = await import('./calendar/events');

const PASSWORD = 'a good long passphrase';

after(() => closeDb());
beforeEach(() => {
  resetAll();
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
async function makeUser(role: 'user' | 'reviewer' = 'user') {
  seq += 1;
  const email = `dim${String(seq)}.${Date.now()}@example.com`;
  await call('POST', '/api/auth/register', {
    json: { email, password: PASSWORD, displayName: `维度${String(seq)}`, locale: 'zh-CN' },
  });
  getDb()
    .prepare('UPDATE users SET email_verified_at = ?, role = ? WHERE email = ?')
    .run(Date.now(), role, email);
  const login = await call('POST', '/api/auth/login', { json: { email, password: PASSWORD } });
  return { email, cookie: (login.setCookie ?? '').split(';')[0] as string };
}

/**
 * 一份合法入参。默认**不填**那几维（它们都是可空的）。
 *
 * ⚠️ 017 起时间是 `slots`（多段）而不是 `startsAtLocal` —— 老写法会让每一笔
 *    提交都 400 `slots: expected array, received undefined`，
 *    而那看起来像"这个测试文件坏了"，不是"契约变了"。
 */
function input(overrides: Record<string, unknown> = {}) {
  return {
    title: '维度测试赛事',
    startsAtTz: 'Asia/Shanghai',
    slots: [{ startsAtLocal: '2030-09-05T16:00' }],
    tags: ['TOURNAMENT'],
    ...overrides,
  };
}

async function submit(cookie: string, overrides: Record<string, unknown> = {}) {
  const res = await call('POST', '/api/calendar', { json: input(overrides), cookie });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id as string;
}

/** 提交并直接批准（走真实 HTTP 审核路由）。 */
async function publish(cookie: string, reviewer: string, overrides: Record<string, unknown> = {}) {
  const id = await submit(cookie, overrides);
  const ok = await call('POST', `/api/admin/review/calendar/${id}/approve`, { cookie: reviewer });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  return id;
}

/** 公开列表的 id 集合。 */
async function listedIds(query = ''): Promise<string[]> {
  const res = await call('GET', `/api/calendar?from=0${query}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return (res.body.items as Array<{ id: string }>).map((e) => e.id);
}

/** 公开详情的事件对象。 */
async function detailOf(id: string): Promise<Record<string, unknown>> {
  const res = await call('GET', `/api/calendar/${id}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.event as Record<string, unknown>;
}

// ---------------------------------------------------------------------------

describe('★ 日历的筛选维度：迁移、往返与筛选', () => {
  it('迁移 011/017 的四列存在、可空、且默认是 NULL', () => {
    const cols = getDb().prepare('PRAGMA table_info(calendar_events)').all() as unknown as Array<{
      name: string;
      notnull: number;
      dflt_value: string | null;
    }>;

    for (const name of ['level', 'scope', 'access', 'scope_detail']) {
      const col = cols.find((c) => c.name === name);
      assert.ok(col, `calendar_events 里应当有 ${name} 列`);
      assert.equal(col.notnull, 0, `${name} 必须可空 —— 排位节点没有这一维，硬填会逼人瞎填`);
      assert.equal(col.dflt_value, null, `${name} 不该有默认值（NULL 才是"没填"）`);
    }
  });

  it('提交时填了就能读回来；没填就是 null（不是空串、不是 undefined）', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');

    const withDims = await publish(author.cookie, reviewer.cookie, {
      title: '有维度的',
      level: 'PRO',
      scope: 'COUNTRY',
      access: 'INVITE',
      scopeDetail: ['ASIA', 'CN'],
    });
    const without = await publish(author.cookie, reviewer.cookie, { title: '没维度的' });

    const event = await detailOf(withDims);
    assert.equal(event.level, 'PRO');
    assert.equal(event.scope, 'COUNTRY');
    // ★ 参赛门槛（017 的新维度）：一次完整的读写往返
    assert.equal(event.access, 'INVITE', 'access 必须原样存回来');
    assert.deepEqual(event.scopeDetail, ['ASIA', 'CN'], '明细是数组，顺序保持');

    const plainEvent = await detailOf(without);
    assert.equal(plainEvent.level, null, '没填就是 null，不是空字符串');
    assert.equal(plainEvent.scope, null);
    assert.equal(plainEvent.access, null);
    assert.deepEqual(plainEvent.scopeDetail, [], '明细没填时是空数组（界面按"没有明细"处理）');
  });

  it('★ 轮次（stage）已经不再是入参：提交时带上它会被忽略，落库是 null', async () => {
    /*
     * ⚠️ 用户在 2026-09-13 要求去掉这一维。它**没有**变成 400 ——
     *    `CalendarEventInputSchema` 里根本没有这个键，而 zod 默认**剥掉**未知键。
     *    这是刻意的（与 `?stage=` 被忽略同一个口径）：老的客户端/导入脚本
     *    仍然带着它，为此回 400 会把一次本来能成功的提交变成失败。
     *
     * ⚠️ 所以这条用例的价值是**写清楚"忽略"是当前的行为**：
     *    哪天有人把它改成"非法键一律 400"，这里会红 —— 那是有意的改动，
     *    但不该在没人注意的时候发生。
     */
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    const id = await publish(author.cookie, reviewer.cookie, {
      title: '带轮次的旧请求',
      stage: 'FINAL',
    });

    const event = await detailOf(id);
    assert.equal(event.stage, null, '轮次不再落库（列还在，只为兼容旧数据）');
    assert.equal(event.title, '带轮次的旧请求', '多余的那个键不该影响其余字段');
  });

  it('非法取值被 Zod 挡住 → 400（而不是静默存进去）', async () => {
    const author = await makeUser();

    for (const bad of [
      { level: 'pro' },
      // 'CASUAL' 曾经是合法档位，2026-09-13 被合并掉了 —— 现在必须被拒
      { level: 'CASUAL' },
      { level: 'SEMI' },
      { scope: 'WORLD' },
      { scope: '国家' },
      { access: 'invite' },
      { access: 'FREE' },
      { scopeDetail: ['ATLANTIS'] },
      { level: 'PRO', scope: '国家' },
    ]) {
      const res = await call('POST', '/api/calendar', { json: input(bad), cookie: author.cookie });
      assert.equal(res.status, 400, `${JSON.stringify(bad)} 应当被拒：${JSON.stringify(res.body)}`);
      assert.equal(res.body.error, 'invalid_input');
    }
  });

  it('★ 筛选是等值匹配，三个单选维度叠加是 AND', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');

    const proGlobalInvite = await publish(author.cookie, reviewer.cookie, {
      title: '职业全球邀请',
      level: 'PRO',
      scope: 'GLOBAL',
      access: 'INVITE',
    });
    const proCountryOpen = await publish(author.cookie, reviewer.cookie, {
      title: '职业国家级开放',
      level: 'PRO',
      scope: 'COUNTRY',
      access: 'OPEN',
    });
    const amateurGlobalOpen = await publish(author.cookie, reviewer.cookie, {
      title: '业余全球开放',
      level: 'AMATEUR',
      scope: 'GLOBAL',
      access: 'OPEN',
    });

    // 只筛 level
    const onlyPro = await listedIds('&level=PRO');
    assert.ok(onlyPro.includes(proGlobalInvite) && onlyPro.includes(proCountryOpen));
    assert.ok(!onlyPro.includes(amateurGlobalOpen), '筛 PRO 不该把 AMATEUR 带出来');

    // 只筛 scope
    const onlyGlobal = await listedIds('&scope=GLOBAL');
    assert.ok(onlyGlobal.includes(proGlobalInvite) && onlyGlobal.includes(amateurGlobalOpen));
    assert.ok(!onlyGlobal.includes(proCountryOpen));

    // ★ 只筛 access（第三维）—— 它必须真的在筛，而不是"看起来筛了"
    const onlyInvite = await listedIds('&access=INVITE');
    assert.deepEqual(onlyInvite, [proGlobalInvite], 'access=INVITE 必须只回邀请制的那些');

    // 三个一起 = AND，只剩一条
    const all = await listedIds('&level=PRO&scope=GLOBAL&access=INVITE');
    assert.deepEqual(all, [proGlobalInvite], '三个维度叠加必须是"且"，不是"或"');

    // 两两组合也要是 AND（只要其中一条不对就落到别的行上）
    assert.deepEqual(await listedIds('&level=PRO&access=OPEN'), [proCountryOpen]);
    assert.deepEqual(await listedIds('&scope=GLOBAL&access=OPEN'), [amateurGlobalOpen]);
  });

  it('★ 非法筛选值当"不限"，**不能**当"筛不到"', async () => {
    /*
     * 这正是"一个看起来像正确答案的错误答案"那一类：
     * `?level=pro` 如果原样进 SQL，会返回空集，而用户会以为
     * "日历里没有职业赛" —— 库里明明有。宁可多给几条。
     */
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    const id = await publish(author.cookie, reviewer.cookie, {
      title: '有维度的',
      level: 'PRO',
      scope: 'GLOBAL',
      access: 'INVITE',
    });

    for (const [dim, bad] of [
      ['level', 'pro'],
      ['level', 'CASUAL'],
      ['level', 'SEMI'],
      ['scope', 'WORLD'],
      ['scope', '国家'],
      ['access', 'invite'],
      ['access', 'FREE'],
    ] as const) {
      const ids = await listedIds(`&${dim}=${encodeURIComponent(bad)}`);
      assert.ok(
        ids.includes(id),
        `${dim}=${bad} 是非法值，应当当作"不限"（返回全部），而不是筛不到`,
      );
    }
    // 空串同样是不限
    for (const dim of ['level', 'scope', 'access'] as const) {
      assert.ok((await listedIds(`&${dim}=`)).includes(id), `${dim}= 空串是不限`);
    }
  });

  it('★★ 参与范围明细：多选、**命中任一即显示**，两种拼法都要认', async () => {
    /*
     * 用户原话是「选亚洲或大洋洲都会展示」（命中任一，OR）——
     * 与 `tags` 的多选语义一致，而与上面三个单选维度相反。
     *
     * ⚠️ 两种拼法都必须认，而且这是**会静默出错**的那一半：
     *    前端多选控件最自然的写法是 `params.append('scopeDetail', code)`
     *    （URLSearchParams），拼出来就是 `?scopeDetail=ASIA&scopeDetail=OCEANIA`。
     *    而 Hono 的 `c.req.query()` 对重复参数**只返回第一个** ——
     *    只认逗号那种写法的话，用户选了"亚洲&大洋洲"，澳洲的赛事一条都不出来，
     *    而那一屏看起来完全正常（"可能就这些吧"）。
     */
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');

    const asia = await publish(author.cookie, reviewer.cookie, {
      title: '亚洲赛',
      scope: 'CONTINENT',
      scopeDetail: ['ASIA'],
    });
    const oceania = await publish(author.cookie, reviewer.cookie, {
      title: '大洋洲赛',
      scope: 'CONTINENT',
      scopeDetail: ['OCEANIA'],
    });
    const china = await publish(author.cookie, reviewer.cookie, {
      title: '中国赛',
      scope: 'COUNTRY',
      scopeDetail: ['CN'],
    });
    const global = await publish(author.cookie, reviewer.cookie, {
      title: '全球赛（没有明细）',
      scope: 'GLOBAL',
    });

    // ① 逗号拼法（既有形状，已经分享出去的链接就是这个）
    const comma = await listedIds('&scopeDetail=ASIA,OCEANIA');
    assert.ok(comma.includes(asia) && comma.includes(oceania), '两个大洲都要出现');
    assert.ok(!comma.includes(china), '没选中国，中国赛不该出现');
    assert.ok(!comma.includes(global), '明细是等值匹配，没有明细的事件不该被"明细"筛出来');

    // ② 重复参数拼法（URLSearchParams.append 的自然产物）—— 结果必须一模一样
    const repeated = await listedIds('&scopeDetail=ASIA&scopeDetail=OCEANIA');
    assert.deepEqual(
      repeated.slice().sort(),
      comma.slice().sort(),
      '两种拼法必须给出同一批事件（只认第一种的话这里会少一半）',
    );

    // ③ 单值、以及国家与大洲混用（`scope_detail` 是一列，取值来自同一个并集）
    assert.deepEqual(await listedIds('&scopeDetail=CN'), [china]);
    assert.deepEqual(
      await listedIds('&scopeDetail=ASIA&scopeDetail=CN').then((v) => v.sort()),
      [asia, china].sort(),
    );

    // ④ 拼错的代码匹配不到任何事件 —— 那是**诚实**的结果（不做枚举校验，也不当"不限"）
    assert.deepEqual(await listedIds('&scopeDetail=ATLANTIS'), []);
  });

  it('保留"没填"的事件：它们不会出现在任何单选维度里，但永远出现在"不限"里', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    // 排位节点这类事件本来就没有专业程度/参与范围/参赛门槛
    const milestone = await publish(author.cookie, reviewer.cookie, {
      title: '排位节点',
      tags: ['RANKED_MILESTONE'],
    });

    assert.ok((await listedIds('')).includes(milestone), '不限的时候必须能看到它');

    for (const q of ['&level=PRO', '&level=AMATEUR', '&scope=GLOBAL', '&access=OPEN']) {
      const ids = await listedIds(q);
      assert.ok(
        !ids.includes(milestone),
        `${q} 是一个等值条件，没填这一维的事件不该匹配（而 \`= NULL\` 在 SQL 里本来就不成立）`,
      );
    }
  });

  it('★★ 011 之前提交的待审快照（JSON 里没有这几维）仍然能审核通过', async () => {
    /*
     * 这是本轮唯一一处**只有旧数据才能触发**的路径，所以必须显式造出来：
     * 直接写一条 payload 里缺 level/scope/access/scopeDetail/slots 的 content_revision，
     * 再把 pending_revision 指过去，然后走真实 HTTP 审核路由批准它。
     *
     * 没有 `?? null` / `?? []` 兜底的话，这里会在绑参时抛错，而错误信息是
     * "Wrong number of parameter bindings" 之类 —— 指向的是绑参数量，
     * 和真正的原因（旧快照缺字段）毫无关系。
     *
     * ⚠️ 这份 payload 是 **011 之前**的形状（连 `slots` 都没有），
     *    所以它同时覆盖了 017 那条"用包络合成一段"的兜底（`payloadSlots`）。
     */
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    const id = await submit(author.cookie, { title: '旧快照' });

    const oldPayload = JSON.stringify({
      title: '旧快照（011 之前提交的）',
      titleEn: null,
      descriptionMd: '',
      startsAtLocal: '2030-09-05T16:00',
      startsAtTz: 'Asia/Shanghai',
      endsAtLocal: null,
      endsAtTz: null,
      allDay: false,
      url: null,
      location: null,
      tags: ['TOURNAMENT'],
      stage: null,
      lang: 'zh-CN',
    });
    getDb()
      .prepare(
        `INSERT INTO content_revisions
           (id, type, entity_id, revision, payload, status, editor_id, note_to_reviewer, created_at)
         VALUES (?, ?, ?, 2, ?, 'pending', NULL, NULL, ?)`,
      )
      .run('rev-old-shape', CALENDAR_TYPE, id, oldPayload, Date.now());
    getDb().prepare('UPDATE calendar_events SET pending_revision = 2 WHERE id = ?').run(id);

    const approved = await call('POST', `/api/admin/review/calendar/${id}/approve`, {
      cookie: reviewer.cookie,
    });
    assert.equal(approved.status, 200, `旧快照必须能批：${JSON.stringify(approved.body)}`);

    const event = await detailOf(id);
    assert.equal(event.title, '旧快照（011 之前提交的）', '内容应当来自那份旧快照');
    assert.equal(event.level, null, '旧快照缺的字段落成 NULL，而不是炸掉');
    assert.equal(event.scope, null);
    assert.equal(event.access, null);
    assert.deepEqual(event.scopeDetail, []);
    // 旧快照没有 slots ⇒ 读路径用包络合成一段（否则日历上一条日期条都不画）
    assert.equal((event.slots as unknown[]).length, 1, '旧快照要合成出一段时间');
  });

  it('ICS 的 CATEGORIES 带上这几维，而且不出现空项', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');

    await publish(author.cookie, reviewer.cookie, {
      title: 'ICS 维度',
      level: 'PRO',
      scope: 'COUNTRY',
    });

    const ics = await call('GET', '/api/calendar.ics');
    const line = ics.text.split('\r\n').find((l) => l.startsWith('CATEGORIES'));
    assert.ok(line, 'ICS 里应当有 CATEGORIES 行');
    assert.equal(
      line,
      'CATEGORIES:TOURNAMENT,PRO,COUNTRY',
      `顺序是 标签 → 专业程度 → 参与范围，实际：${String(line)}`,
    );
    assert.ok(!line.includes(',,'), '不能出现空项（严格解析器会把带空项的值判为坏值）');
  });

  it('没填任一可选维度时，CATEGORIES 里不会多出空项', async () => {
    const author = await makeUser();
    const reviewer = await makeUser('reviewer');
    await publish(author.cookie, reviewer.cookie, { title: '只有标签' });

    const ics = await call('GET', '/api/calendar.ics');
    const line = ics.text.split('\r\n').find((l) => l.startsWith('CATEGORIES'));
    assert.equal(line, 'CATEGORIES:TOURNAMENT');
  });
});
