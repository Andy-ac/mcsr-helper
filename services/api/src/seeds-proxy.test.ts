/**
 * Ranked Seeds 代理的测试。
 *
 * ===========================================================================
 * ⚠️⚠️ 这个文件**绝不能**产生真实的网络请求
 * ===========================================================================
 * 上游是**别人**的生产服务（谁的上游由 `MCSR_SEED_API_BASE` 决定，地址不在
 * 版本库里），而其中一个端点（`POST /seed`）会往那台机器的数据库里**写入**记录。
 * 一个跑偏的测试不是"测试失败"，是往别人的生产库里塞脏数据 ——
 * 而那些记录只有对方能删。
 *
 * 所以这里有**两道**防线，任何一道单独都不够：
 *   1. `MCSR_SEED_API_BASE` 指向 `http://upstream.invalid/...` —— `.invalid`
 *      是 RFC 2606 保留的、**保证不可解析**的顶级域。万一 mock 没装上，
 *      请求会立刻失败，而不是打到真上游。
 *   2. 每个用例都用 `t.mock.method(globalThis, 'fetch', …)` 换掉 fetch，
 *      用例结束由 node:test 的 MockTracker 自动还原。mock 里还会**断言**
 *      请求落在 `.invalid` 上 —— 多一层"我们真的没打出去"的证据。
 *
 * 另外：这个文件里**没有**任何连通性测试。那种测试的性质是"我的测试能不能
 * 打别人的服务器"，它不该存在。上游的形状已经由 docs/ranked-seeds-api.md
 * 记录下来，下面用到的载荷就是照着它（外加一次只读实测）写死的。
 */
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { after, beforeEach, describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AuthVariables } from './auth/middleware';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.MCSR_MAIL_DRIVER = 'console';
process.env.MCSR_SCRYPT_TEST_PARAMS = 'N=1024,r=8,p=1';
// ★ 不可解析的 TLD，见文件头
process.env.MCSR_SEED_API_BASE = 'http://upstream.invalid/api/v2';
/*
 * ★ 写入**默认是关的**（2026-09-19 开源前改的极性：原来那个 `..._DISABLED`
 *   开关缺席时等于"写入是开的"，而它会往别人的库里插记录 —— 见 routes/seeds.ts
 *   的 writeEnabled）。所以这个文件要测写入，就必须先**显式**打开它，
 *   而"没打开时的行为"另有专门一条用例守着。
 */
process.env.MCSR_SEED_WRITE_ENABLED = '1';

const { clearSeedsCache, seedsRoute } = await import('./routes/seeds');
const { authRoute } = await import('./routes/auth');
const { loadUser, sameOriginOnly } = await import('./auth/middleware');
const { closeDb, getDb } = await import('./db');
const { resetAll } = await import('./auth/ratelimit');
const { SITE } = await import('@mcsr/shared');

/**
 * 只挂本模块的测试应用。
 *
 * ⚠️ 刻意**不** import index.ts：那条路由由用户自己挂（本次不允许改 index.ts），
 *    而测试里再挂一次会变成"同一路径两个 handler" —— 出问题时不知道测到的是
 *    哪一个。这里按 index.ts 的同一条链手工挂：sameOriginOnly（CSRF 第二层）
 *    + loadUser（还原登录用户），然后是我们的路由。
 *    挂载点 `/api/ranked-seeds` 与用户要求的完全一致。
 *    （/api/auth 也要挂：写接口的守卫就是"登录 + 邮箱已验证"，没有真的注册和
 *      登录就走不到那条路径，而用例里自己造一张会话表是在绕开被守护的东西。）
 */
const app = new Hono<{ Variables: AuthVariables }>();
app.use('/api/*', sameOriginOnly);
app.use('/api/*', loadUser);
app.route('/api/auth', authRoute);
app.route('/api/ranked-seeds', seedsRoute);

const PASSWORD = 'a good long passphrase';

after(() => closeDb());
beforeEach(() => {
  resetAll();
  // 模块级缓存会跨用例存活：不清的话"缓存有没有生效"这类用例会被上一个用例污染
  clearSeedsCache();
});

// ---------------------------------------------------------------------------
// 上游 mock
// ---------------------------------------------------------------------------

interface UpstreamCall {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

interface UpstreamInit {
  method?: string;
  body?: unknown;
  signal?: AbortSignal | null;
}

type UpstreamHandler = (call: UpstreamCall, init: UpstreamInit) => Response | Promise<Response>;

/** 本次用例里发生过的上游调用。 */
let calls: UpstreamCall[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** 上游成功的标准外壳（实测形状）。 */
function envelope(data: unknown, message = 'ok'): Response {
  return jsonResponse({ success: true, message, data });
}

/** 实测的 /seed 载荷形状：注意字段叫 `id`、availableCounts 在 data 里面。 */
function randomSeedData(id: number, availableCounts = 1_039_488) {
  return {
    id,
    overworldSeed: '7304888896886165976',
    netherSeed: '238703850641435',
    theEndSeed: '7304888896886165976',
    availableCounts,
  };
}

/** 实测的 /seedinfo/3650001 载荷（原文照抄，包括被字符串包住的 JSON）。 */
const REAL_SEEDINFO = {
  matchId: 3_650_001,
  overworld: 'VILLAGE',
  nether: 'BRIDGE',
  end_towers: '[76, 79, 85, 97]',
  variations:
    '["biome:structure:plains", "biome:structure:plains", "bastion:triple:1", "bastion:single:1", "biome:bastion:nether_wastes", "biome:fortress:crimson_forest", "end_spawn:buried:56", "end_tower:caged:front_center"]',
};

/**
 * 装上假的 fetch。
 *
 * ⚠️ 每个碰上游的用例都**必须**先调它 —— 不调就等于真的打上游。
 * 默认响应是 500 而不是一个"看起来正常"的数据：这样"忘了声明上游响应的用例"
 * 会立刻失败，而不是靠默认值蒙对。
 */
function mockUpstream(t: TestContext, handler?: UpstreamHandler): void {
  calls = [];

  const impl = async (input: unknown, init?: UpstreamInit): Promise<Response> => {
    const url = String(input);
    const call: UpstreamCall = {
      url,
      method: init?.method ?? 'GET',
      body:
        typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    };
    calls.push(call);

    // ★ 这条断言是"测试没有打出真实请求"的证据，不是形式
    assert.ok(
      new URL(url).hostname.endsWith('.invalid'),
      `测试里出现了一个不在约定主机上的请求：${url}`,
    );

    return handler
      ? await handler(call, init ?? {})
      : jsonResponse({ detail: '本用例未声明上游响应' }, 500);
  };

  /*
   * 双重的 `as`：@types/node 里 fetch 的具体类型来自 undici-types，
   * 直接写死那套类型名会让这个文件依赖 @types/node 的内部结构。
   * 这里只关心"能截到 (input, init) 并回一个 Response"。
   */
  t.mock.method(globalThis, 'fetch', impl as unknown as typeof globalThis.fetch);
}

// ---------------------------------------------------------------------------
// 调用我们的接口
// ---------------------------------------------------------------------------

interface Res {
  status: number;
  body: Record<string, unknown>;
  setCookie: string | null;
  cacheControl: string | null;
}

let ipSeq = 0;

async function call(
  method: string,
  path: string,
  options: { json?: unknown; cookie?: string; ip?: string } = {},
): Promise<Res> {
  const headers: Record<string, string> = { origin: SITE.productionOrigin };
  /*
   * 每个请求默认用一个**不同的** IP：我们自己那条"每 IP 每分钟 20 次"是按 IP
   * 计数的，用例之间必须互不干扰。需要"同一个 IP 连续请求"的用例（测限流）
   * 显式传 ip。
   */
  headers['x-real-ip'] = options.ip ?? `10.0.0.${String(++ipSeq % 250)}`;
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
    cacheControl: response.headers.get('cache-control'),
  };
}

let seq = 0;

/**
 * 一个"慢慢来"版的 call：每次调用先把（被 mock 的）时间往前拨 250ms。
 *
 * ⚠️ 为什么需要它：全局那道闸门是**每秒 5 次**（Q14 里保护上游的那条）。
 *    一个用例里连打 6 个请求就会撞上它 —— 于是失败信息看起来像"我要测的那条
 *    规则没生效"，而实际上是**另一条**规则先响了。把时间拨着走，
 *    测的就正好是我想测的那一条（每 250ms 一次 → 1 秒窗口内最多 4 次）。
 */
function paced(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date'] });
  let now = Date.now();
  return async (
    method: string,
    path: string,
    options: { json?: unknown; cookie?: string; ip?: string } = {},
  ): Promise<Res> => {
    now += 250;
    t.mock.timers.setTime(now);
    return await call(method, path, options);
  };
}

/** 造一个登录用户。`verified=false` 用来测"登录了但邮箱没验证"。 */
async function makeUser(verified = true): Promise<{ id: string; email: string; cookie: string }> {
  seq += 1;
  const email = `seeds${String(seq)}.${String(Date.now())}@example.com`;
  const registered = await call('POST', '/api/auth/register', {
    json: { email, password: PASSWORD, displayName: `种子用户${String(seq)}`, locale: 'zh-CN' },
  });
  // 显式断言：注册失败时"读不到用户行"会表现成一个和注册毫无关系的 TypeError
  assert.equal(registered.status, 200, `注册失败：${JSON.stringify(registered.body)}`);

  getDb().prepare('UPDATE users SET email_verified_at = ? WHERE email = ?').run(Date.now(), email);
  const login = await call('POST', '/api/auth/login', { json: { email, password: PASSWORD } });
  assert.equal(login.status, 200, `登录失败：${JSON.stringify(login.body)}`);
  if (!verified) {
    getDb().prepare('UPDATE users SET email_verified_at = NULL WHERE email = ?').run(email);
  }

  const row = getDb().prepare('SELECT id FROM users WHERE email = ?').get(email) as
    | { id: string }
    | undefined;
  assert.ok(row, '注册之后用户却不在库里');
  return { id: row.id, email, cookie: (login.setCookie ?? '').split(';')[0] as string };
}

function seedOf(res: Res): Record<string, unknown> {
  return (res.body.seed ?? {}) as Record<string, unknown>;
}

function infoOf(res: Res): Record<string, unknown> {
  return (res.body.info ?? {}) as Record<string, unknown>;
}

/** 审计表里 seed.create 的行数。断言时要用**前后差值**（同一文件共用内存库）。 */
function seedCreateAuditCount(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'seed.create'")
    .get() as { n: number };
  return row.n;
}

/** 一个合法的 /save 请求体。 */
function saveBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    matchId: 4_000_002,
    overworldSeed: '7304888896886165976',
    netherSeed: '-42',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 读：随机与筛选
// ---------------------------------------------------------------------------

describe('★ Ranked Seeds 代理：随机与筛选', () => {
  it('随机：拆开外壳、把 id 归一成 matchId、availableCounts 提到外层', async (t) => {
    mockUpstream(t, () => envelope(randomSeedData(6_124_756, 2_518_057)));

    const res = await call('GET', '/api/ranked-seeds/random');
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const seed = seedOf(res);
    // 上游在 /seed 上把这个字段叫 id（实测 id 就是 matchId），对外统一成 matchId
    assert.equal(seed.matchId, 6_124_756);
    assert.equal(seed.overworldSeed, '7304888896886165976');
    assert.equal(seed.netherSeed, '238703850641435');
    // availableCounts 是**查询**的属性，所以提到 seed 外面
    assert.equal(res.body.availableCounts, 2_518_057);
    assert.equal(seed.availableCounts, undefined, '不该在 data 里也留一份');
    // ★ 随机绝不能被缓存
    assert.equal(res.cacheControl, 'no-store');
  });

  it('★ 大小写：对外大写、发往上游小写', async (t) => {
    mockUpstream(t, () => envelope(randomSeedData(6_124_757)));

    // 我们对外用大写（和项目其它地方一致），所以大写必须被接受
    const res = await call('GET', '/api/ranked-seeds/search?overworld=VILLAGE&nether=Bridge', {
      ip: '10.2.0.1',
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const url = new URL(calls[0]?.url ?? '');
    // …而发出去的一定是小写（上游契约要小写）
    assert.equal(url.searchParams.get('overworld'), 'village');
    assert.equal(url.searchParams.get('nether'), 'bridge');
  });

  it('variations / without 原样转发（不做词条白名单，也不改大小写）', async (t) => {
    mockUpstream(t, () => envelope(randomSeedData(6_124_758, 247)));

    const variations = 'biome:structure:plains,chest:structure:diamond';
    const without = 'end_tower:caged:front,end_tower:caged:back';
    const res = await call(
      'GET',
      `/api/ranked-seeds/search?variations=${variations}&without=${without}&completion=600000`,
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const url = new URL(calls[0]?.url ?? '');
    // 一个字符都不能动：上游的词条会变，我们这边加白名单/做转换都会让新词条用不了
    assert.equal(url.searchParams.get('variations'), variations);
    assert.equal(url.searchParams.get('without'), without);
    assert.equal(url.searchParams.get('completion'), '600000');
  });

  it('非法 overworld / nether 给 400，而且**没有**打上游', async (t) => {
    mockUpstream(t);

    // plains 是"变种的值"，不是主世界结构 —— 很典型的接错了参数
    const bad1 = await call('GET', '/api/ranked-seeds/search?overworld=plains');
    assert.equal(bad1.status, 400);
    assert.equal(bad1.body.error, 'invalid_input');
    assert.equal(bad1.body.reason, 'bad_overworld');

    const bad2 = await call('GET', '/api/ranked-seeds/search?nether=fortress');
    assert.equal(bad2.status, 400);
    assert.equal(bad2.body.reason, 'bad_nether');

    assert.equal(calls.length, 0, '★ 入参不合法就不该打上游');
  });

  it('★ end_spawn:* 被拒绝（variations 与 without 都拒）', async (t) => {
    mockUpstream(t);

    const asInclude = await call(
      'GET',
      '/api/ranked-seeds/search?variations=end_tower:caged:front,end_spawn:buried:30',
    );
    assert.equal(asInclude.status, 400);
    assert.equal(asInclude.body.reason, 'end_spawn_unsupported');

    const asExclude = await call('GET', '/api/ranked-seeds/search?without=end_spawn:buried:56');
    assert.equal(asExclude.status, 400);
    assert.equal(asExclude.body.reason, 'end_spawn_unsupported');

    assert.equal(calls.length, 0);
  });

  it('筛选字符串有长度与字符集上限（防注入），但放行未知词条', async (t) => {
    mockUpstream(t, () => envelope(randomSeedData(6_124_759)));

    // 未知词条：放行（上游的词条会变，白名单会让新词条永远用不了）
    const unknown = await call('GET', '/api/ranked-seeds/search?variations=some:future:lexicon');
    assert.equal(unknown.status, 200);
    assert.equal(calls.length, 1);

    // 越界字符：拒绝（词条的语法里没有这些字符，所以这是有人在拿它做别的事）
    const injection = await call(
      'GET',
      `/api/ranked-seeds/search?variations=${encodeURIComponent("biome:structure:plains'; drop table seeds--")}`,
    );
    assert.equal(injection.status, 400);
    assert.equal(injection.body.reason, 'filter_bad_chars');

    const tooLong = await call('GET', `/api/ranked-seeds/search?variations=${'a'.repeat(513)}`);
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.body.reason, 'filter_too_long');

    assert.equal(calls.length, 1, '被拒的两个都不该打上游');
  });

  it('completion 必须是合理的毫秒数', async (t) => {
    mockUpstream(t);

    for (const bad of ['0', '-5', 'abc', '60000000000']) {
      const res = await call('GET', `/api/ranked-seeds/search?completion=${bad}`);
      assert.equal(res.status, 400, `completion=${bad} 应当被拒`);
      assert.equal(res.body.reason, 'bad_completion');
    }
    assert.equal(calls.length, 0);
  });

  it('★ /random 拒绝筛选参数（而不是静默忽略）', async (t) => {
    mockUpstream(t);

    /*
     * 静默忽略的后果是"界面把一条不符合条件的种子当成结果展示"——
     * 用户看得见、我们看不见。所以这里要的是一个立刻能定位到调用方的 400。
     */
    const res = await call('GET', '/api/ranked-seeds/random?overworld=village');
    assert.equal(res.status, 400);
    assert.equal(res.body.reason, 'use_search_endpoint');
    assert.equal(res.body.use, '/search');
    assert.equal(calls.length, 0);
  });

  it('★ 随机绝不缓存：两次请求打上游两次，拿到的是两条不同的种子', async (t) => {
    let n = 0;
    mockUpstream(t, () => envelope(randomSeedData(6_100_000 + n++, 100)));

    const first = await call('GET', '/api/ranked-seeds/random');
    const second = await call('GET', '/api/ranked-seeds/random');

    assert.equal(calls.length, 2, '★ 缓存了"随机"就等于把它变成"永远同一条"');
    assert.notEqual(seedOf(first).matchId, seedOf(second).matchId, '两次随机必须是两条不同的种子');
  });
});

// ---------------------------------------------------------------------------
// 读：按 matchId（缓存）
// ---------------------------------------------------------------------------

describe('★ Ranked Seeds 代理：按 matchId 查询与缓存', () => {
  it('★ 按 matchId 缓存 1 小时（种子值永远不会变）', async (t) => {
    t.mock.timers.enable({ apis: ['Date'] });
    const start = Date.now();

    mockUpstream(t, () =>
      envelope({
        matchId: 3_650_001,
        matchDate: 1_762_982_331_457,
        seeds: {
          overworldSeed: '306404093549845300',
          netherSeed: '238703850641435',
          theEndSeed: '306404093549845300',
        },
      }),
    );

    const first = await call('GET', '/api/ranked-seeds/match/3650001');
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.cached, false);

    // 平铺：上游把三个种子值包在 seeds 里，/seed 却是平铺的（不一致之四）
    const seed = seedOf(first);
    assert.equal(seed.matchId, 3_650_001);
    assert.equal(seed.matchDate, 1_762_982_331_457);
    assert.equal(seed.overworldSeed, '306404093549845300');
    assert.equal(seed.theEndSeed, '306404093549845300');

    // 一小时之内：不再打上游
    t.mock.timers.setTime(start + 60 * 60 * 1000 - 1);
    const second = await call('GET', '/api/ranked-seeds/match/3650001');
    assert.equal(second.body.cached, true);
    assert.equal(seedOf(second).overworldSeed, '306404093549845300');
    assert.equal(calls.length, 1, '★ 缓存生效时不该再打上游');

    // 过期之后：重新打上游
    t.mock.timers.setTime(start + 60 * 60 * 1000 + 1);
    await call('GET', '/api/ranked-seeds/match/3650001');
    assert.equal(calls.length, 2, '过期之后必须重新取');
  });

  it('★ 404 = "这条不在库里"，不是错误；而且**不**缓存', async (t) => {
    mockUpstream(t, () => jsonResponse({ detail: '未找到ID为 999999999 的种子数据' }, 404));

    const first = await call('GET', '/api/ranked-seeds/match/999999999');
    assert.equal(first.status, 404);
    assert.equal(first.body.error, 'seed_not_found');
    // 上游文案绝不外传（Q14）
    assert.ok(
      !JSON.stringify(first.body).includes('未找到ID为'),
      '★ 上游的原始错误文案不该出现在响应里',
    );

    const second = await call('GET', '/api/ranked-seeds/match/999999999');
    assert.equal(second.status, 404);
    /*
     * 缓存"查不到"会让刚补录的那条在接下来一小时里依然查不到 ——
     * 用户会以为保存失败了，然后再录一次（然后拿到"已经录过了"）。
     */
    assert.equal(calls.length, 2, '★ 404 不能被缓存');
  });

  it('matchId 的下界两个端点不同，且不合法时打不到上游', async (t) => {
    mockUpstream(t, () => envelope({ matchId: 100_876, overworld: 'village', nether: 'bridge' }));
    // 这个用例要连打十个请求，会把全局那条（5 次/秒）撞响，所以拨着时间走
    const pacedCall = paced(t);

    const tooSmall = await pacedCall('GET', '/api/ranked-seeds/match/3650000');
    assert.equal(tooSmall.status, 400);
    assert.equal(tooSmall.body.reason, 'bad_match_id');
    assert.equal(tooSmall.body.min, 3_650_001);

    for (const bad of ['abc', '3650001abc', '3.6e6', '+3650001', '-1', '99999999999999999999']) {
      const res = await pacedCall('GET', `/api/ranked-seeds/match/${bad}`);
      assert.equal(res.status, 400, `${bad} 应当被拒`);
    }
    assert.equal(calls.length, 0);

    // seedinfo 能追溯到更早（100876 < 3650001）：老比赛可能有 seedinfo 而没有种子值
    const infoOk = await pacedCall('GET', '/api/ranked-seeds/match/100876/info');
    assert.equal(infoOk.status, 200, JSON.stringify(infoOk.body));

    const infoTooSmall = await pacedCall('GET', '/api/ranked-seeds/match/100875/info');
    assert.equal(infoTooSmall.status, 400);
    assert.equal(infoTooSmall.body.min, 100_876);

    const seedTooSmall = await pacedCall('GET', '/api/ranked-seeds/match/100876');
    assert.equal(seedTooSmall.status, 400, '★ /seed 的下界更严，不能被 /info 的下界带偏');

    assert.equal(calls.length, 1);
  });

  it('★ seedinfo：把"被字符串包住的 JSON"解成真数组（用实测载荷）', async (t) => {
    mockUpstream(t, () => envelope(REAL_SEEDINFO));

    const res = await call('GET', '/api/ranked-seeds/match/3650001/info');
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const info = infoOf(res);
    assert.deepEqual(info.endTowers, [76, 79, 85, 97]);
    const variations = info.variations as string[];
    assert.ok(Array.isArray(variations), 'variations 必须是数组，不是那个字符串');
    assert.ok(variations.includes('biome:structure:plains'));
    assert.ok(variations.includes('end_tower:caged:front_center'));
    /*
     * ★ end_spawn 在这里**保留**：用户说上游那个**筛选项**有 bug（所以查询参数
     *   里我们拒绝它），但它是这条种子的真实属性 —— 从结果里剔掉等于撒谎。
     */
    assert.ok(
      variations.includes('end_spawn:buried:56'),
      '★ seedinfo 的结果里要保留 end_spawn（它只是不能用来筛选）',
    );
    // 词条是命名空间 id，不能被大写
    assert.ok(!variations.some((v) => v !== v.toLowerCase()), '词条不该被大写');
  });

  it('seedinfo：结构名统一大写（上游给小写也一样）', async (t) => {
    mockUpstream(t, () =>
      envelope({
        matchId: 3_650_003,
        overworld: 'village',
        nether: 'bridge',
        end_towers: '[]',
        variations: null,
      }),
    );

    const res = await call('GET', '/api/ranked-seeds/match/3650003/info');
    const info = infoOf(res);
    assert.equal(info.overworld, 'VILLAGE');
    assert.equal(info.nether, 'BRIDGE');
    // 空数组和 null 都要变成 []
    assert.deepEqual(info.endTowers, []);
    assert.deepEqual(info.variations, []);
  });

  it('seedinfo：某个字段坏掉时不让整个接口崩（进日志、返回空数组）', async (t) => {
    mockUpstream(t, () =>
      envelope({
        matchId: 3_650_004,
        overworld: 'VILLAGE',
        nether: 'BRIDGE',
        end_towers: '[76, 79',
        variations: '["biome:structure:plains"]',
      }),
    );

    const res = await call('GET', '/api/ranked-seeds/match/3650004/info');
    assert.equal(res.status, 200, '一个字段坏掉不该让整条记录打不开');
    const info = infoOf(res);
    assert.deepEqual(info.endTowers, []);
    assert.deepEqual(info.variations, ['biome:structure:plains']);
  });
});

// ---------------------------------------------------------------------------
// 上游故障
// ---------------------------------------------------------------------------

describe('★ Ranked Seeds 代理：上游故障的归一化', () => {
  it('★ 上游 500 → 我们自己的 502，**不透传**上游文案', async (t) => {
    mockUpstream(t, () => new Response('上游内部错误：数据库连接失败', { status: 500 }));

    const res = await call('GET', '/api/ranked-seeds/random');
    assert.equal(res.status, 502, '不能把上游的 500 原样透传过去');
    assert.equal(res.body.error, 'seed_service_unavailable');
    assert.ok(
      !JSON.stringify(res.body).includes('数据库连接失败'),
      '★ 上游的原始错误文案只能进服务端日志',
    );
  });

  it('上游不可达（连接被拒）→ 502', async (t) => {
    mockUpstream(t, () => {
      const error = new Error('fetch failed');
      (error as { cause?: unknown }).cause = { code: 'ECONNREFUSED' };
      throw error;
    });

    const res = await call('GET', '/api/ranked-seeds/random');
    assert.equal(res.status, 502);
    assert.equal(res.body.error, 'seed_service_unavailable');
  });

  it('★ 上游超时 → 502（走的是真实的 AbortSignal 路径）', async (t) => {
    /*
     * ⚠️ 这里把超时压到 30ms 并让 mock **像真实 fetch 一样尊重 abort**，
     *    所以测到的是"超时到底会不会发生"，而不是"我们会不会处理一个
     *    假装抛出来的超时"。mock 若不监听 signal，这个用例会永远挂着 ——
     *    那正是它必须监听的原因。
     */
    process.env.MCSR_SEED_TIMEOUT_MS = '30';
    try {
      mockUpstream(
        t,
        (_call, init) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(init.signal?.reason ?? new Error('aborted'));
            });
          }),
      );

      const res = await call('GET', '/api/ranked-seeds/random');
      assert.equal(res.status, 502, '超时绝不能让我们自己的页面一直转圈');
      assert.equal(res.body.error, 'seed_service_unavailable');
    } finally {
      delete process.env.MCSR_SEED_TIMEOUT_MS;
    }
  });

  it('上游说我们的请求不合法（4xx）→ 500 internal_error（那是我们的锅）', async (t) => {
    mockUpstream(t, () => jsonResponse({ detail: 'overworld 参数非法' }, 422));

    const res = await call('GET', '/api/ranked-seeds/search?overworld=village');
    // 归 500 而不是 502：这两件事的排查方向完全相反
    assert.equal(res.status, 500);
    assert.equal(res.body.error, 'internal_error');
    assert.ok(!JSON.stringify(res.body).includes('overworld 参数非法'));
  });

  it('★ 写路径：上游 200 + success:false 且说"已存在" → 409 seed_exists（兜底分类）', async (t) => {
    /*
     * 这是 `looksLikeDuplicate` 存在的**唯一**理由（修正 8）：重复录入按文档是
     * 409，但上游的 OpenAPI 只列了 200/422，而 409 那一条无法在不真的往
     * 用户数据库里插一条记录的前提下去核实。万一上游对重复用的是
     * 200 + success:false，用户会看到"出错了"而不是「已经录过了」。
     *
     * ⚠️ 所以它必须在**写**路径上验。原来这条用例发的是
     *    `GET /api/ranked-seeds/random` —— 一次随机查询被告知
     *    「这条比赛 ID 已经录过了」，而那句话对用户毫无意义：
     *    他没有录任何东西，却收到一句"不用再录一遍"，指向一个错误的下一步。
     *    分类器作用在读端点上是个 bug（D20），现在只对 POST 生效。
     */
    mockUpstream(t, () =>
      jsonResponse({ success: false, message: '该 matchId 已存在', data: null }),
    );
    const user = await makeUser();
    const auditsBefore = seedCreateAuditCount();

    const res = await call('POST', '/api/ranked-seeds/save', {
      json: saveBody(),
      cookie: user.cookie,
    });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.error, 'seed_exists');
    assert.ok(!JSON.stringify(res.body).includes('已存在'), '上游文案不外传');
    assert.equal(seedCreateAuditCount(), auditsBefore, '写失败不该记一条 seed.create');
  });

  it('★ 读路径：上游说"已存在"时**不能**回 409（那对一次查询毫无意义）', async (t) => {
    mockUpstream(t, () =>
      jsonResponse({ success: false, message: '该 matchId 已存在', data: null }),
    );

    const res = await call('GET', '/api/ranked-seeds/random');
    assert.notEqual(res.status, 409, `随机查询不该被回答"已经录过了"：${JSON.stringify(res.body)}`);
    assert.notEqual(res.body.error, 'seed_exists');
    // 上游在一个读端点上说"已存在"是它自己的语义错误 —— 归 500（我们的适配层
    // 和上游脱节了）而不是编一个用户能看懂的故事
    assert.equal(res.status, 500);
    assert.equal(res.body.error, 'internal_error');
    assert.ok(!JSON.stringify(res.body).includes('已存在'), '上游文案仍然不外传');
  });

  it('★ 零结果：上游 200 + success:false 说"没找到符合条件的种子" → 404 而不是 500', async (t) => {
    /*
     * 这条形状**原来一条测试都没有**，而它现在回 500 internal_error ——
     * 也就是"用户把筛选条件叠窄了"被报成"服务器出错了"。
     *
     * Q17 的两级联动 chip 就是让人叠加窄条件的，AND 语义叠几下必然空。
     * 把常态报成故障，用户唯一能做的反应是反复重试（而永远越试越少），
     * 然后认为站点坏了。
     */
    mockUpstream(t, () =>
      jsonResponse({ success: false, message: '没有找到符合条件的种子', data: null }),
    );

    const res = await call('GET', '/api/ranked-seeds/search?overworld=VILLAGE&nether=BRIDGE');
    assert.equal(res.status, 404, JSON.stringify(res.body));
    assert.equal(res.body.error, 'seed_not_found');
    // ⚠️ 必须和"这条 matchId 不在库里"分开：两者的下一步完全不同 ——
    //    一个是"放宽条件"，一个是"去补录这一条"。前端靠这个字段选按钮。
    assert.equal(res.body.reason, 'no_match');
  });

  it('★ 零结果：上游 200 + data 为 null（形状之二）→ 404，不是 502', async (t) => {
    /*
     * 另一种可能的形状：外壳说成功、`data` 是 null。
     * 原来它走 badShape → 502「上游坏了」，而事实上上游正常地说了"没有"。
     *
     * 判据的边界：`data` 压根不是对象 = 上游说没有；
     * `data` 是对象但字段坏了 = 真形状错误，仍然 502（见下一条）。
     */
    mockUpstream(t, () => envelope(null));

    const res = await call('GET', '/api/ranked-seeds/search?overworld=VILLAGE');
    assert.equal(res.status, 404, JSON.stringify(res.body));
    assert.equal(res.body.error, 'seed_not_found');
    assert.equal(res.body.reason, 'no_match');
  });

  it('data 是对象但种子字段坏掉 → 仍然是 502（形状错误，不是空结果）', async (t) => {
    // 边界另一侧：上游回了一个对象，但里面没有能用的种子值 —— 那是真 bug，
    // 不能被"没有符合条件的种子"这句话盖住
    mockUpstream(t, () => envelope({ id: 3_650_001, overworldSeed: 123, netherSeed: null }));

    const res = await call('GET', '/api/ranked-seeds/search?overworld=VILLAGE');
    assert.equal(res.status, 502, JSON.stringify(res.body));
    assert.equal(res.body.error, 'seed_service_unavailable');
  });

  it('上游返回的不是 JSON → 502（不是 500）', async (t) => {
    mockUpstream(t, () => new Response('<html>502 Bad Gateway</html>', { status: 200 }));

    const res = await call('GET', '/api/ranked-seeds/random');
    assert.equal(res.status, 502);
    assert.equal(res.body.error, 'seed_service_unavailable');
  });

  it('上游地址从 MCSR_SEED_API_BASE 读', async (t) => {
    process.env.MCSR_SEED_API_BASE = 'http://another-upstream.invalid/v9';
    try {
      mockUpstream(t, () => envelope(randomSeedData(6_124_760)));
      const res = await call('GET', '/api/ranked-seeds/random');
      assert.equal(res.status, 200);
      assert.ok(
        calls[0]?.url.startsWith('http://another-upstream.invalid/v9/seed'),
        `地址没跟着环境变量走：${calls[0]?.url ?? '(没有调用)'}`,
      );
    } finally {
      process.env.MCSR_SEED_API_BASE = 'http://upstream.invalid/api/v2';
    }
  });
});

// ---------------------------------------------------------------------------
// 写接口的守卫
// ---------------------------------------------------------------------------

describe('★ Ranked Seeds 代理：/save 的守卫', () => {
  it('★ 正常录入：请求体形状正确，而且**记了审计（是谁写的）**', async (t) => {
    mockUpstream(t, (call) =>
      envelope({
        matchId: call.body?.matchId,
        overworldSeed: call.body?.overworldSeed,
        netherSeed: call.body?.netherSeed,
        theEndSeed: call.body?.theEndSeed ?? null,
      }),
    );

    const user = await makeUser();
    const res = await call('POST', '/api/ranked-seeds/save', {
      json: saveBody({ theEndSeed: '7304888896886165976', matchDate: 1_762_982_331_457 }),
      cookie: user.cookie,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    assert.equal(res.body.matchId, 4_000_002);

    // 上游的请求体形状来自它自己的 OpenAPI（SeedCreateRequest）：平铺的字段
    const sent = calls[0]?.body;
    assert.equal(calls[0]?.method, 'POST');
    assert.equal(sent?.matchId, 4_000_002);
    /*
     * ★ 这个断言就是"绝不 parseInt"那条铁律的守卫：
     *   7304888896886165976 转换成 Number 会变成 7304888896886166000，
     *   而且**不报错** —— 只有比对字符串才发现得了。
     */
    assert.equal(sent?.overworldSeed, '7304888896886165976');
    assert.equal(sent?.netherSeed, '-42');
    assert.equal(sent?.theEndSeed, '7304888896886165976');
    // matchDate 上游 schema 要字符串（而它自己的 GET 返回数字）
    assert.equal(sent?.matchDate, '1762982331457');

    // ★ 审计：上游不知道"是谁"写进去的，只有我们知道
    const audit = getDb()
      .prepare(
        "SELECT actor_id, entity_type, entity_id, reason, ip FROM audit_log WHERE action = 'seed.create' ORDER BY created_at DESC LIMIT 1",
      )
      .get() as
      | { actor_id: string; entity_type: string; entity_id: string; reason: string; ip: string }
      | undefined;
    assert.ok(audit, '★ 每次写入都必须留下审计');
    assert.equal(audit.actor_id, user.id, '★ 审计里必须知道是谁写的');
    assert.equal(audit.entity_type, 'seed_record');
    assert.equal(audit.entity_id, '4000002');
    // 审计还要能回答"当时到底写了什么"，否则它只能证明"这个人点过保存"
    assert.ok(audit.reason.includes('overworldSeed=7304888896886165976'), audit.reason);
    assert.ok(audit.reason.includes('netherSeed=-42'), audit.reason);
  });

  it('未登录不能写（401），且没有打上游', async (t) => {
    mockUpstream(t);

    const res = await call('POST', '/api/ranked-seeds/save', { json: saveBody() });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'unauthorized');
    assert.equal(calls.length, 0, '★ 匿名用户绝不能触发上游的写入');
  });

  it('★ 邮箱未验证不能写（403 email_not_verified，不是 401）', async (t) => {
    mockUpstream(t);

    const user = await makeUser(false);
    const res = await call('POST', '/api/ranked-seeds/save', {
      json: saveBody(),
      cookie: user.cookie,
    });
    // 用户是登录着的，只是差一步 —— 前端据此显示"去验证邮箱"而不是跳登录页
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'email_not_verified');
    assert.equal(calls.length, 0);
  });

  it('★ 非法种子值被拒 —— 包括"数字形态"（数字走到这里精度可能已经丢了）', async (t) => {
    mockUpstream(t);
    const pacedCall = paced(t);
    const user = await makeUser();

    const cases: Array<[string, Record<string, unknown>]> = [
      /*
       * ★ 这是最要命的一条：JSON number 形态的种子。
       *   这里的 Number() 是**故意**的 —— 它演示的正是调用方那一侧发生的事：
       *   7304888896886165976 会变成 7304888896886166000，不报错、不抛异常。
       *   （写成字面量会被 biome 的 noPrecisionLoss 拦下来，那本身就是这条陷阱的证明。）
       */
      ['数字形态', { overworldSeed: Number('7304888896886165976') }],
      ['带小数', { overworldSeed: '7304888896886165976.0' }],
      ['科学计数法', { overworldSeed: '1e5' }],
      ['超范围（20 个 9）', { overworldSeed: '99999999999999999999' }],
      ['混了字母', { overworldSeed: '3650001abc' }],
      ['空串', { overworldSeed: '' }],
      ['没给下界种子', { netherSeed: undefined }],
      ['末地种子非法', { theEndSeed: 'not-a-seed' }],
    ];

    for (const [label, overrides] of cases) {
      const body = saveBody(overrides);
      for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) delete body[key];
      }
      const res = await pacedCall('POST', '/api/ranked-seeds/save', {
        json: body,
        cookie: user.cookie,
      });
      assert.equal(res.status, 400, `${label} 应当被拒：${JSON.stringify(res.body)}`);
      assert.equal(res.body.error, 'invalid_input');
    }

    assert.equal(calls.length, 0, '★ 一个脏记录都不能写进用户的数据库');
  });

  it('matchId 非法 / 缺省 → 400', async (t) => {
    mockUpstream(t);
    const pacedCall = paced(t);
    const user = await makeUser();

    for (const bad of [3_650_000, 'abc', 0, null, 4_000_002.5]) {
      const res = await pacedCall('POST', '/api/ranked-seeds/save', {
        json: saveBody({ matchId: bad }),
        cookie: user.cookie,
      });
      assert.equal(res.status, 400, `matchId=${String(bad)} 应当被拒`);
    }
    assert.equal(calls.length, 0);
  });

  it('种子值会被规范化（空格 / + 前缀 / 前导零），不因此给 400', async (t) => {
    mockUpstream(t, (call) =>
      envelope({
        matchId: call.body?.matchId,
        overworldSeed: call.body?.overworldSeed,
        netherSeed: call.body?.netherSeed,
      }),
    );
    const user = await makeUser();

    const res = await call('POST', '/api/ranked-seeds/save', {
      json: saveBody({ overworldSeed: ' +00042 ', netherSeed: '238703850641435' }),
      cookie: user.cookie,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    // 从聊天窗口里复制的种子几乎一定带空格，而那不该变成一个 400
    assert.equal(calls[0]?.body?.overworldSeed, '42');
  });

  it('★ 上游 409（matchId 已存在）→ seed_exists', async (t) => {
    mockUpstream(t, () => jsonResponse({ detail: '该 matchId 已经存在' }, 409));
    const user = await makeUser();
    /*
     * ⚠️ 必须按**前后差值**断言，不能数总数：同一个文件里的用例共用内存库，
     *    前面那些成功的录入已经留下审计行了 —— 直接 COUNT(*) 会永远大于 0，
     *    而失败信息看起来像"写失败也记了审计"。
     */
    const auditsBefore = seedCreateAuditCount();

    const res = await call('POST', '/api/ranked-seeds/save', {
      json: saveBody(),
      cookie: user.cookie,
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'seed_exists');
    assert.ok(!JSON.stringify(res.body).includes('已经存在'), '上游文案不外传');

    // 写失败**不**记审计：审计记的是"写进去过什么"，不是"试图写什么"
    assert.equal(seedCreateAuditCount(), auditsBefore, '写失败不该记一条 seed.create');
  });

  it('★ 写入**默认关闭**：不设 MCSR_SEED_WRITE_ENABLED 时 503，且没有打上游', async (t) => {
    /*
     * ⚠️★ 这条守的是 2026-09-19 开源前改过来的一件事，改之前它是反的：
     *    那个开关原来叫 `MCSR_SEED_WRITE_DISABLED`，而且单元模板里那行是
     *    **注释掉的** —— 也就是"什么都不做 = 写入是开的"。而这个端点会往
     *    **上游那台机器（别人的数据库）**里插记录：
     *
     *      一个自建者照着文档把上游地址配上之后，写入路径**立刻**就是通的。
     *      他以为自己拿到的是一个只读的种子查询，实际上已经能往对面的库里插数据，
     *      而对面那台机器的主人不会收到任何通知。
     *
     *    所以现在只有显式写 `MCSR_SEED_WRITE_ENABLED=1` 才允许写入，
     *    而"不设"这一个状态本身必须有断言（它就是自建者的默认状态）。
     */
    delete process.env.MCSR_SEED_WRITE_ENABLED;
    try {
      mockUpstream(t);
      const user = await makeUser();

      const withCookie = await call('POST', '/api/ranked-seeds/save', {
        json: saveBody(),
        cookie: user.cookie,
      });
      /*
       * ⚠️ 503 而不是 403。
       *
       * 403 的含义是"你没这个权限"，而事实是"运维没把这个功能打开"。
       * 前端的文案写的是"种子提交暂时被关掉了 —— 那是我们这边的事，
       * 不是你的问题"，配一个 403 是自相矛盾的：403 会把一个
       * **有权限**的用户说成没权限的。
       */
      assert.equal(withCookie.status, 503);
      assert.equal(withCookie.body.error, 'seed_write_disabled');

      // kill switch 在认证之前：连匿名请求也拿 503，不泄漏"这个人存不存在"
      const anonymous = await call('POST', '/api/ranked-seeds/save', { json: saveBody() });
      assert.equal(anonymous.status, 503);
      assert.equal(anonymous.body.error, 'seed_write_disabled');
      assert.equal(calls.length, 0, '写入没打开时一个上游请求都不该发生');

      /*
       * 显式的"假值"同样不算打开：`0` / `false` / 空串只是把这句话写出来，
       * 语义仍然是"关"。⚠️ 这一条防的是"有人把 `=0` 当成打开"——
       * 而这个端点的错误方向是**静默地打开**，不是静默地关闭。
       */
      for (const off of ['0', 'false', '', 'no']) {
        process.env.MCSR_SEED_WRITE_ENABLED = off;
        const res = await call('POST', '/api/ranked-seeds/save', {
          json: saveBody(),
          cookie: user.cookie,
        });
        assert.equal(res.status, 503, `MCSR_SEED_WRITE_ENABLED='${off}' 不该被当成打开`);
        assert.equal(res.body.error, 'seed_write_disabled');
      }
    } finally {
      process.env.MCSR_SEED_WRITE_ENABLED = '1';
    }
  });

  it('★ 上游没配时：五个端点一起 503 seed_not_configured（不是 500，也不是 502）', async (t) => {
    /*
     * ⚠️★ 这条是**自建者的默认状态**，所以它比别的降级用例更重要。
     *
     * `MCSR_SEED_API_BASE` 现在没有默认值：上游是第三方的机器，写死一个地址
     * 等于让每个照抄本仓的人都把请求打到别人的服务器上（写接口还会往对方库里
     * 插记录）。于是"没配"从"不可能发生"变成"最常见的状态"。
     *
     * 而它必须**明确**地降级，而且必须是**它自己的**错误码：
     *   · 500 internal_error → 被当成崩溃去查堆栈，而配置缺失不是 bug
     *   · 502 seed_service_unavailable → "上游挂了，过一会儿再试"，
     *     而这里根本没有上游：重试一万次也一样，**界面还说了件没发生的事**
     *   · 503 seed_not_configured → 唯一的准确说法（同 platform_not_configured
     *     那条已有裁决的形状）
     */
    delete process.env.MCSR_SEED_API_BASE;
    try {
      mockUpstream(t);
      const endpoints: Array<[string, string, unknown?]> = [
        ['GET', '/api/ranked-seeds/random'],
        ['GET', '/api/ranked-seeds/search?overworld=VILLAGE'],
        ['GET', '/api/ranked-seeds/match/3650001'],
        ['GET', '/api/ranked-seeds/match/3650001/info'],
        ['POST', '/api/ranked-seeds/save', saveBody()],
      ];
      const user = await makeUser();

      for (const [method, path, json] of endpoints) {
        const res = await call(method, path, json === undefined ? {} : { json });
        assert.equal(res.status, 503, `${method} ${path} → ${JSON.stringify(res.body)}`);
        assert.equal(res.body.error, 'seed_not_configured', `${method} ${path}`);
        assert.notEqual(res.status, 500, '配置缺失不该报成"服务器出错了"');
        assert.notEqual(res.status, 502, '这里没有上游，不能说成"上游不可用"');
      }

      /*
       * ⚠️ 匿名访客拿到的也是同一句话（那个守卫挂在认证**之前**）：
       *    这条降级没有泄漏"这个人存不存在"，而自建者看到的正是这一档
       *    —— 他还没注册就该看懂问题出在配置上。
       */
      const anonymous = await call('POST', '/api/ranked-seeds/save', { json: saveBody() });
      assert.equal(anonymous.status, 503);
      assert.equal(anonymous.body.error, 'seed_not_configured');

      assert.equal(calls.length, 0, '没配上游时一个上游请求都不该发生');
      assert.ok(user.cookie.length > 0);
    } finally {
      process.env.MCSR_SEED_API_BASE = 'http://upstream.invalid/api/v2';
    }
  });

  it('★ 配错的上游地址（`new URL()` 解析不了）仍然是 502，不是 503', async (t) => {
    /*
     * ⚠️ 这条与上一条是**边界的两侧**，而且它们说的话不一样：
     *   · 没配（空）    → 503 seed_not_configured：**有**一个明确的动作该去做
     *   · 配了但配坏了  → 502 seed_service_unavailable：地址是坏的，
     *                     与我们自己的适配层/运维状态是两回事，细节进日志
     * 合成一条的代价是"没配"的人拿不到正确的下一步。
     */
    process.env.MCSR_SEED_API_BASE = 'not-a-url';
    try {
      mockUpstream(t);
      const res = await call('GET', '/api/ranked-seeds/random');
      assert.equal(res.status, 502, JSON.stringify(res.body));
      assert.equal(res.body.error, 'seed_service_unavailable');
    } finally {
      process.env.MCSR_SEED_API_BASE = 'http://upstream.invalid/api/v2';
    }
  });

  it('★ 写接口有自己的、更严的配额（每用户每小时 10 次）', async (t) => {
    /*
     * 和查询的配额分开：写坏的是数据，不是速度。而且 21 次/分钟的查询配额
     * 对写来说太宽松了 —— 每一次成功都是一条进用户数据库的记录。
     *
     * ⚠️ 必须控制时间：全局那条是 5 次/秒，11 个请求挤在一秒里会先撞上它，
     *    那样测到的是另一条规则，而失败信息看起来像"写配额没生效"。
     */
    t.mock.timers.enable({ apis: ['Date'] });
    const start = Date.now();

    mockUpstream(t, (call) =>
      envelope({
        matchId: call.body?.matchId,
        overworldSeed: call.body?.overworldSeed,
        netherSeed: call.body?.netherSeed,
      }),
    );
    const user = await makeUser();

    for (let i = 0; i < 10; i += 1) {
      t.mock.timers.setTime(start + i * 250);
      const res = await call('POST', '/api/ranked-seeds/save', {
        json: saveBody({ matchId: 4_100_000 + i }),
        cookie: user.cookie,
      });
      assert.equal(res.status, 201, `第 ${i + 1} 次不该被限流：${JSON.stringify(res.body)}`);
    }

    t.mock.timers.setTime(start + 10 * 250);
    const blocked = await call('POST', '/api/ranked-seeds/save', {
      json: saveBody({ matchId: 4_100_100 }),
      cookie: user.cookie,
    });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error, 'rate_limited');
    assert.ok(Number(blocked.body.retryAfterSec) > 0);
    assert.equal(calls.length, 10, '被限流的那次不该打到上游');
  });

  it('★ 配额记的是"写进去"的次数，不是"试过"的次数', async (t) => {
    /*
     * ⚠️ 这条守的是一个真实的坑：原来配额挂在路由的中间件链上
     *    （跑在解析请求体之前），于是记的是**尝试次数**。
     *
     *    用户把种子值填错 10 次 → 被锁整整一小时 → 而库里一条数据都没有。
     *    他看到的只有 rate_limited，完全不知道是自己填错了，
     *    只会等一小时之后再填错一次。
     *
     *    而这条配额自己的理由是"写坏的是数据，不是速度"（文件头）——
     *    一个连入参校验都没过的请求写不坏任何数据。
     *
     * ⚠️ 冻结时间：全局那条是 5 次/秒，12 个请求挤在一秒里会先撞上它，
     *    那样测到的是另一条规则，而失败信息看起来像"写配额没生效"。
     */
    t.mock.timers.enable({ apis: ['Date'] });
    const start = Date.now();

    mockUpstream(t, (call) =>
      envelope({
        matchId: call.body?.matchId,
        overworldSeed: call.body?.overworldSeed,
        netherSeed: call.body?.netherSeed,
      }),
    );
    const user = await makeUser();

    // 12 次**不合法**的尝试，全部 400、一次都没写进去
    for (let i = 0; i < 12; i += 1) {
      t.mock.timers.setTime(start + i * 250);
      const res = await call('POST', '/api/ranked-seeds/save', {
        json: saveBody({ overworldSeed: 'not-a-seed' }),
        cookie: user.cookie,
      });
      assert.equal(
        res.status,
        400,
        `第 ${i + 1} 次非法尝试应当是 400：${JSON.stringify(res.body)}`,
      );
    }
    assert.equal(calls.length, 0, '校验没过就绝不该打到上游');

    // 然后一次合法写入必须能过 —— 12 次填错不该把用户锁在门外
    t.mock.timers.setTime(start + 12 * 250);
    const ok = await call('POST', '/api/ranked-seeds/save', {
      json: saveBody({ matchId: 4_200_001 }),
      cookie: user.cookie,
    });
    assert.equal(
      ok.status,
      201,
      `填错 12 次之后仍然应该能写入（配额记的是写入次数）：${JSON.stringify(ok.body)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// 限流
// ---------------------------------------------------------------------------

describe('★ Ranked Seeds 代理：限流（保护用户自己的上游）', () => {
  it('★ 全局每秒 5 次（冻结时间，6 个请求落在同一个窗口）', async (t) => {
    t.mock.timers.enable({ apis: ['Date'] });
    mockUpstream(t, () => envelope(randomSeedData(6_200_000)));

    // 每个请求换一个 IP：这样被挡住的只可能是**全局**那条规则
    for (let i = 0; i < 5; i += 1) {
      const res = await call('GET', '/api/ranked-seeds/random', { ip: `10.5.0.${String(i)}` });
      assert.equal(res.status, 200, `第 ${i + 1} 次不该被限流：${JSON.stringify(res.body)}`);
    }

    const blocked = await call('GET', '/api/ranked-seeds/random', { ip: '10.5.0.99' });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error, 'rate_limited');
    assert.ok(Number(blocked.body.retryAfterSec) >= 1, 'Retry-After 要给得出秒数');
    assert.equal(calls.length, 5);
  });

  it('★ 每 IP 每分钟 20 次（第 21 次 429）', async (t) => {
    /*
     * 时间必须一步一步走：21 个请求挤在同一秒里会先撞上全局闸门，
     * 那样测到的就不是这条规则了。每 250ms 一次 → 1 秒窗口内最多 4 次，
     * 全局那条永远不会响。
     */
    t.mock.timers.enable({ apis: ['Date'] });
    const start = Date.now();
    mockUpstream(t, () => envelope(randomSeedData(6_300_000)));

    const ip = '10.9.9.9';
    for (let i = 0; i < 20; i += 1) {
      t.mock.timers.setTime(start + i * 250);
      const res = await call('GET', '/api/ranked-seeds/random', { ip });
      assert.equal(res.status, 200, `第 ${i + 1} 次不该被限流：${JSON.stringify(res.body)}`);
    }

    t.mock.timers.setTime(start + 20 * 250);
    const blocked = await call('GET', '/api/ranked-seeds/random', { ip });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error, 'rate_limited');
    assert.ok(
      Number(blocked.body.retryAfterSec) > 50,
      `距窗口结束还有约 55 秒，实际 ${String(blocked.body.retryAfterSec)}`,
    );

    // 换个 IP 立刻就能用（限的是这个 IP，不是所有人）
    const other = await call('GET', '/api/ranked-seeds/random', { ip: '10.9.9.10' });
    assert.equal(other.status, 200);
  });
});

// ---------------------------------------------------------------------------
// 补录闭环：查不到 → 录进去 → 立刻查得到
// ---------------------------------------------------------------------------

/**
 * 这一条是 M4 第三条验收标准（"种子搜索一字不差"）真正依赖的流程，
 * 而它原来**一条测试都没有**。
 *
 * `routes/seeds.ts` 的文件头把这条流程当作"404 不缓存"的**理由**写下来了：
 *
 *   "404 不缓存 …… 这样'查不到 → 补录 → 查得到'的切换是立刻生效的"
 *
 * 理由是写对了，但没有任何用例把这条链路真的走一遍。而它恰恰是 owner
 * 会**亲手演示**的那条（也是 Q15 决定暴露写接口的全部意义）——
 * 一个"每一步都对、连起来不对"的问题最容易藏在那种地方。
 *
 * 这里能失败的方式很具体：
 *   · 有人为了省事把"404 也缓存一下"加上 → 补录完那一小时里依然查不到，
 *     而界面上看起来一切正常
 *   · 上游失败归一化改坏了 → 补录之后仍然 404
 *   · 写成功但读的 matchId 下界/形状对不上 → 同一个 id 写进去却读不回来
 */
describe('★ Ranked Seeds：查不到 → 补录 → 立刻查得到（验收标准 3 的链路）', () => {
  it('★ 404 之后补录，紧接着再查同一条必须查得到', async (t) => {
    const matchId = 4_500_007;

    /*
     * 上游的第一阶段：这条不在库里（404）。
     * 第二阶段：补录之后按 id 读得回来。
     *
     * 用一个可变的标志切换 mock 的行为 —— 这正是"上游那一侧的状态变了"，
     * 而不是我们这边缓存没刷新。
     */
    let recorded = false;
    mockUpstream(t, (_call, init) => {
      if (init.method === 'POST') {
        recorded = true;
        return jsonResponse({ success: true, message: 'ok', data: null });
      }
      if (!recorded) return jsonResponse({ detail: 'not found' }, 404);
      return envelope({
        id: matchId,
        overworldSeed: '7304888896886165976',
        netherSeed: '238703850641435',
        theEndSeed: '1234567890123456789',
      });
    });

    // ① 先查：不在库里。404 是**常态**（上游只覆盖约 80%），不是错误
    const before = await call('GET', `/api/ranked-seeds/match/${String(matchId)}`);
    assert.equal(before.status, 404, JSON.stringify(before.body));
    assert.equal(before.body.error, 'seed_not_found');

    // ② 补录
    const user = await makeUser();
    const saved = await call('POST', '/api/ranked-seeds/save', {
      json: saveBody({
        matchId,
        overworldSeed: '7304888896886165976',
        netherSeed: '238703850641435',
      }),
      cookie: user.cookie,
    });
    assert.equal(saved.status, 201, JSON.stringify(saved.body));

    // ③ 紧接着再查同一条：**立刻**要能查到
    const after = await call('GET', `/api/ranked-seeds/match/${String(matchId)}`);
    assert.equal(
      after.status,
      200,
      `补录之后必须立刻查得到（404 绝不能被缓存）：${JSON.stringify(after.body)}`,
    );
    const seed = seedOf(after);
    assert.equal(seed.overworldSeed, '7304888896886165976');
    assert.equal(
      seed.overworldSeed,
      '7304888896886165976',
      '★ 种子值必须逐字符相同 —— Number("7304888896886165976") 会变成 ...000',
    );
    assert.equal(after.body.cached, false, '第一次读到的是刚从上游取回来的');

    // ④ 而**成功**的结果是缓存的（Q14 定了 matchId 缓存 1 小时）
    const again = await call('GET', `/api/ranked-seeds/match/${String(matchId)}`);
    assert.equal(again.status, 200);
    assert.equal(again.body.cached, true, '成功的结果应当命中缓存');
  });

  it('★ 缓存的是"查得到"，不是"查不到" —— 两个方向的证据', async (t) => {
    /*
     * 上一条测的是整条链路，这一条**单独**把缓存策略的两个方向钉住：
     *   · 404 不缓存（缺了它，补录完一小时里依然查不到）
     *   · 200 缓存（缺了它，每次翻页都在打用户那台 1 核机器）
     * 方向搞反的话，两种症状都很难归因，所以分开断言。
     */
    const missId = 4_500_101;
    let upstreamCalls = 0;
    mockUpstream(t, () => {
      upstreamCalls += 1;
      return jsonResponse({ detail: 'not found' }, 404);
    });

    for (let i = 0; i < 3; i += 1) {
      const res = await call('GET', `/api/ranked-seeds/match/${String(missId)}`);
      assert.equal(res.status, 404);
    }
    assert.equal(upstreamCalls, 3, '★ "查不到"绝不能被缓存 —— 每次都要真的问上游');
  });
});
