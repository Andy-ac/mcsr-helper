/**
 * 服务心跳端点（`GET /api/ranked/status`）的测试 —— 这一栏**唯一**走我们服务器的端点。
 *
 * ===========================================================================
 * ⚠️⚠️ 这个文件**绝不能**产生真实的网络请求
 * ===========================================================================
 * 上游是 MCSR Ranked 的**状态页心跳**（spec §2.2 实测的那一条）。它的地址**只在**
 * `packages/shared/src/ranked/const.ts` 里出现一次 —— 计划 Global Constraints 第 1 条
 * 明令"测试文件里一律不许出现上游 API 的主机名"，所以这个文件里**连注释都不写它**。
 * 它不是我们的服务，而这个端点存在的理由正是"**我们替所有访客去打它**"
 * （那个主机不发 CORS 头，spec §2.5）
 * —— 所以一个跑偏的用例会以**服务器的 IP** 打上去，占掉它那条 500 次 / 10 分钟的额度
 * （spec §5.3：心跳每分钟最多 2 次，只有 4% 的余量）。
 *
 * 所以这里有**两道**防线，任何一道单独都不够（与 seeds-proxy.test.ts 同一条纪律）：
 *   1. `MCSR_RANKED_STATUS_URL` 指向 `https://upstream.invalid/status` —— `.invalid`
 *      是 RFC 2606 保留的、**保证不可解析**的顶级域。万一 mock 没装上，
 *      请求会立刻失败，而不是打到真上游。
 *   2. 每个碰上游的用例都用 `t.mock.method(globalThis, 'fetch', …)` 换掉 fetch，
 *      用例结束由 node:test 的 MockTracker 自动还原。mock 里还会**断言**请求落在
 *      `.invalid` 上 —— 多一层"我们真的没有打出去"的证据。
 *
 * ---------------------------------------------------------------------------
 * ★ 缓存与 single-flight 的判据**只能**是桩的调用次数
 * ---------------------------------------------------------------------------
 * "有没有重新打上游"这件事在响应体里**看不出来**：TTL 内与 TTL 外回的是同一份数据
 * （这正是缓存的定义）。所以这个文件里每一条缓存类断言都配一个
 * `fetchMock.mock.callCount()`（或 `upstreamCallCount(fetchMock)`）—— 少一个，那条断言
 * 测的就只是"响应还是原来那份"，而**桩一次都没装**时它照样绿。
 * ⚠️ 同理：上游一律用桩，文件里也**没有**任何连通性测试（那种测试的性质是
 *    "我的测试能不能打到真上游"，它不该存在，见 seeds-proxy.test.ts 的文件头）。
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
// ★ 不可解析的 TLD，见文件头第 1 道防线
process.env.MCSR_RANKED_STATUS_URL = 'https://upstream.invalid/status';
/*
 * ⚠️ 这两个变量**本机可能已被设过**（它们的存在就是为了给运维与测试留接缝）——
 *    不清掉的话"TTL 内不重打"那条会随环境变红或变绿，而失败信息会指向一个
 *    与它无关的地方。要改的那两条用例自己设、beforeEach 再清回来。
 */
delete process.env.MCSR_RANKED_STATUS_TTL_MS;
delete process.env.MCSR_RANKED_STATUS_TIMEOUT_MS;

const { RANKED_STATUS_LIMIT, rankedRoute, resetRankedStatusCache } = await import(
  './routes/ranked'
);
const { loadUser, sameOriginOnly } = await import('./auth/middleware');
const { closeDb } = await import('./db');
const { resetAll } = await import('./auth/ratelimit');
const { SITE } = await import('@mcsr/shared');

/**
 * 只挂本模块的测试应用。
 *
 * ⚠️ 刻意**不** import index.ts：同一个路径再挂一次会变成"两个 handler"，
 *    出问题时不知道是哪一条答的（同 seeds-proxy.test.ts）。这里按 index.ts 的同一条链
 *    手工挂：sameOriginOnly（CSRF 第二层）+ loadUser（还原登录用户），然后是我们的路由。
 * ⚠️ index.ts 还有一条"给所有 /api/* 加 `Cache-Control: no-store`"的中间件，
 *    这里**故意不挂**：那样"这个端点自己设了 no-store"才是一句真的断言，
 *    而不是被上面那条中间件蒙对的。
 */
const app = new Hono<{ Variables: AuthVariables }>();
app.use('/api/*', sameOriginOnly);
app.use('/api/*', loadUser);
app.route('/api/ranked', rankedRoute);

after(() => closeDb());
beforeEach(() => {
  resetAll();
  /*
   * 模块级缓存与"在飞的那一次"会**跨用例存活**：不清的话，"TTL 内不重打"
   * 会被上一个用例留下的缓存蒙对（同 seeds-proxy.test.ts 调 clearSeedsCache 的理由）。
   */
  resetRankedStatusCache();
  delete process.env.MCSR_RANKED_STATUS_TTL_MS;
  delete process.env.MCSR_RANKED_STATUS_TIMEOUT_MS;
});

// ---------------------------------------------------------------------------
// 上游 mock
// ---------------------------------------------------------------------------

interface UpstreamCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  signal: AbortSignal | null;
}

type UpstreamHandler = (call: UpstreamCall) => Response | Promise<Response>;

/** 本次用例里发生过的上游调用。 */
let calls: UpstreamCall[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** 上游回了一个不是 JSON 的东西（网关错误页 / 被截断的响应体）。 */
function htmlResponse(status = 200): Response {
  return new Response('<html><body>502 Bad Gateway</body></html>', {
    status,
    headers: { 'content-type': 'text/html' },
  });
}

/**
 * 装上假的 fetch，并返回那个 mock —— **缓存与 single-flight 的判据是它的 `callCount()`**。
 *
 * ⚠️ 每个碰上游的用例都**必须**先调它：不调就等于真的打上游。
 *    默认没有 handler 时这一条会直接失败（而不是靠一个"看起来正常"的默认响应蒙对）。
 */
function mockUpstream(t: TestContext, handler: UpstreamHandler) {
  calls = [];

  const impl = async (
    input: unknown,
    init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal | null },
  ): Promise<Response> => {
    const url = String(input);
    const call: UpstreamCall = {
      url,
      method: init?.method ?? 'GET',
      headers: init?.headers ?? {},
      signal: init?.signal ?? null,
    };
    calls.push(call);

    // ★ 这条断言是"测试没有打出真实请求"的证据，不是形式（同 seeds-proxy.test.ts）
    assert.ok(
      new URL(url).hostname.endsWith('.invalid'),
      `测试里出现了一个不在约定主机上的请求：${url}`,
    );

    return await handler(call);
  };

  /*
   * 双重的 `as`：@types/node 里 fetch 的具体类型来自 undici-types，
   * 直接写死那套类型名会让这个文件依赖 @types/node 的内部结构。
   * 这里只关心"能截到 (input, init) 并回一个 Response"。
   */
  return t.mock.method(globalThis, 'fetch', impl as unknown as typeof globalThis.fetch);
}

/** 桩的调用次数。⚠️ 只认这个，不认"响应看起来没变"（见文件头）。 */
function upstreamCallCount(fetchMock: { mock: { callCount(): number } }): number {
  return fetchMock.mock.callCount();
}

/** 把 `console.error` 换成记录器。返回值是本次用例里打出来的每一行。 */
function captureErrors(t: TestContext): string[] {
  const lines: string[] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(' '));
  });
  return lines;
}

/**
 * ★ 每一次"上游读不到"都该有**且只有一条**日志，并且带上 kind。
 *
 * 这条日志存在的理由写在 routes/ranked.ts 里：它是我们唯一能看到上游出问题的地方
 * （另外三个面板由访客浏览器直连，它们的失败在我们这边一个字都没有，spec §3 代价 1）。
 * ⚠️ "只有一条"是它也钉的一半：一个失败打两行日志，等于在排障时把一个问题看成两个。
 */
function assertLoggedFailure(errors: string[], kind: string): void {
  const lines = errors.filter((line) => line.includes('[ranked]'));
  assert.equal(lines.length, 1, `这次失败应该有且只有一条日志：${errors.join(' | ')}`);
  assert.ok(lines[0]?.includes(kind), `日志要带上 kind（${kind}）：${lines[0] ?? '(空)'}`);
}

// ---------------------------------------------------------------------------
// 上游夹具（spec §2.2 的实测形状）
// ---------------------------------------------------------------------------

interface MonitorFixture {
  state: 0 | 1 | 2 | 3;
  checkedAt: string;
  ping: number | null;
  uptime24: number | null;
}

/** 上游那一条心跳（原文照抄实测：时间是一串**没有时区**的文本）。 */
const MONITOR: MonitorFixture = {
  state: 1,
  checkedAt: '2026-09-15 13:36:27',
  ping: 380,
  uptime24: 1,
};

/**
 * 心跳响应。
 *
 * ⚠️ `heartbeatList['2']` 故意放**两条**（前一条状态不同、时间更早）：数组是**旧 → 新**
 *    的，取第一条的实现会让我们显示一个最多 100 分钟前的状态，而界面上写着"实时"
 *    —— 那是**数据是真的、时间是假的**那一类错（spec §2.2）。
 * `'2'` 是 Game Server 那一格（spec §13 冻结值），另外三格（API / Store / Wiki）
 *    也照实写上：它们同时在钉"有没有把别的服务器的数据混进响应"。
 */
function heartbeatPayload(monitor: MonitorFixture = MONITOR): Record<string, unknown> {
  return {
    heartbeatList: {
      '2': [
        { status: 0, time: '2026-09-15 13:35:27', msg: '', ping: 900 },
        { status: monitor.state, time: monitor.checkedAt, msg: '', ping: monitor.ping },
      ],
      '3': [{ status: 1, time: '2026-09-15 13:36:20', msg: '', ping: 12 }],
      '4': [{ status: 2, time: '2026-09-15 13:36:21', msg: '', ping: 30 }],
      '5': [{ status: 3, time: '2026-09-15 13:36:22', msg: '', ping: 8 }],
    },
    uptimeList: { '2_24': monitor.uptime24, '3_24': 0.5, '4_24': 0.25, '5_24': 0.75 },
  };
}

/** 形状不对的那一份：`heartbeatList` 在，但**没有 monitor 2 那一格**（上游改了字段就是这种样子）。 */
function heartbeatPayloadMissingMonitor(): Record<string, unknown> {
  return {
    heartbeatList: { '3': [{ status: 1, time: '2026-09-15 13:36:20', msg: '', ping: 12 }] },
    uptimeList: { '3_24': 0.5 },
  };
}

// ---------------------------------------------------------------------------
// 打我们的端点
// ---------------------------------------------------------------------------

interface Res {
  status: number;
  body: Record<string, unknown>;
  cacheControl: string | null;
}

let ipSeq = 0;

/**
 * 一个请求。
 *
 * ⚠️ 默认每个请求换一个 IP：我们那条"每 IP 60 次/分钟"按 IP 计数，用例之间必须互不干扰；
 *    要测限流的用例显式传同一个 ip。
 * ⚠️ 带上 `origin` 是照真实浏览器发的（GET 下 sameOriginOnly 不检查它，但这与线上同形）。
 */
async function call(options: { ip?: string; cookie?: string } = {}): Promise<Res> {
  const headers: Record<string, string> = { origin: SITE.productionOrigin };
  headers['x-real-ip'] = options.ip ?? `10.9.0.${String(++ipSeq % 250)}`;
  if (options.cookie) headers.cookie = options.cookie;

  const response = await app.request('/api/ranked/status', { method: 'GET', headers });
  return {
    status: response.status,
    body: (await response.json().catch(() => ({}))) as Record<string, unknown>,
    cacheControl: response.headers.get('cache-control'),
  };
}

/** 读响应里的 `monitor`；不是一个对象就当场失败，而不是让后面每条断言都变成 undefined 比较。 */
function monitorOf(body: Record<string, unknown>): Record<string, unknown> {
  const monitor = body.monitor;
  if (typeof monitor !== 'object' || monitor === null) {
    assert.fail(`响应里的 monitor 不是一个对象：${JSON.stringify(body)}`);
  }
  return monitor as Record<string, unknown>;
}

/** 读一个**数字**字段（读错类型会静默变成 NaN 比较，所以这里当场失败）。 */
function numField(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  if (typeof value !== 'number') {
    assert.fail(`响应体里 ${key} 应该是一个数字，实际是 ${typeof value}：${JSON.stringify(body)}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// ① 正常路径
// ---------------------------------------------------------------------------

describe('★ 心跳端点：正常路径', () => {
  it('匿名也能拿到四格 + serverNow/fetchedAt + stale:false + no-store', async (t) => {
    const errors = captureErrors(t);
    const fetchMock = mockUpstream(t, () => jsonResponse(heartbeatPayload()));

    const res = await call();

    assert.equal(res.status, 200, '这一栏是公开的 —— 没有 cookie 也必须 200');
    assert.equal(res.cacheControl, 'no-store', '心跳不能进任何一层缓存（spec §4.2）');

    // ★ 公开面零泄漏：只有我们这一个端点的四格，没有别的栏目的数据
    assert.deepEqual(Object.keys(res.body).sort(), ['fetchedAt', 'monitor', 'serverNow', 'stale']);
    const monitor = monitorOf(res.body);
    assert.deepEqual(Object.keys(monitor).sort(), ['checkedAt', 'ping', 'state', 'uptime24']);
    assert.deepEqual(
      monitor,
      { state: 1, checkedAt: '2026-09-15 13:36:27', ping: 380, uptime24: 1 },
      '★ checkedAt 是上游那串文本**原样**（不是时间戳、也不是解析回来的本地时间）',
    );
    assert.equal(res.body.stale, false);

    /*
     * ⚠️ `serverNow` 与 `fetchedAt` 是**两件事**（"现在几点" vs "这份心跳多旧"），
     *    但第一次拿到数据时它们必须是**同一个** `Date.now()` —— 分了两次取，
     *    两者之间就会差一个随时会变的数，而界面拿它算"数据多旧"时会莫名偏小。
     */
    assert.equal(numField(res.body, 'serverNow'), numField(res.body, 'fetchedAt'));

    // ★ 打了一次上游，打在**配置里那个不可解析的地址**上
    assert.equal(upstreamCallCount(fetchMock), 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://upstream.invalid/status');
    assert.equal(calls[0]?.method, 'GET');
    assert.equal(calls[0]?.headers.accept, 'application/json');
    assert.ok(calls[0]?.signal instanceof AbortSignal, '上游请求必须带 AbortSignal（超时靠它）');
    // 我们对第三方是"有名字的"来访者（否决了"不带 UA"：那让对方无法按来源联系我们）
    assert.ok((calls[0]?.headers['user-agent'] ?? '').length > 0, '打上游要带 user-agent');

    // ★ 正常路径**一个字都不该写进错误日志**（自审那条"没有噪声"的可测形式）
    assert.deepEqual(errors, [], '正常路径不该有任何 console.error');
  });
});

// ---------------------------------------------------------------------------
// ② 缓存（TTL 30 秒）与 single-flight
// ---------------------------------------------------------------------------

describe('★ 心跳端点：缓存与 single-flight', () => {
  it('★ TTL 内第二次请求**不打上游**（桩计数 1）', async (t) => {
    // ⚠️ 这条用的是**默认 TTL（30 秒）**，两次请求之间**不等待** —— 见下一条的说明
    const fetchMock = mockUpstream(t, () => jsonResponse(heartbeatPayload()));

    const first = await call();
    const second = await call();

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    /*
     * ★ 判据只能是调用次数：TTL 内与 TTL 外回的是**同一份**数据（那正是缓存的定义），
     *    所以"响应没变"完全不能证明我们没有再打一次上游。
     */
    assert.equal(upstreamCallCount(fetchMock), 1, 'TTL（默认 30 秒）内不该再打上游');
    assert.equal(
      numField(second.body, 'fetchedAt'),
      numField(first.body, 'fetchedAt'),
      'fetchedAt 一动就说明真的又取了一次',
    );
    assert.equal(second.body.stale, false);
  });

  it('★ 过了 TTL 会重新打上游（桩计数 2），且回的是**新的**那一份', async (t) => {
    /*
     * ⚠️ 把 TTL 设成 0，而不是 `await sleep(30_000)`：后者会把这条用例变成 30 秒，
     *    而且它测的是"测试跑得比 TTL 慢"，不是"TTL 生效"（本仓已经为同类问题开过
     *    好几个 MCSR_* 接缝，MCSR_SEED_API_BASE 那一条就是先例）。
     *    TTL=0 与"时间推过 30 秒"走的是**同一支**判断（`now - fetchedAt >= ttlMs()`）。
     */
    process.env.MCSR_RANKED_STATUS_TTL_MS = '0';
    let state: 0 | 1 | 2 | 3 = 1;
    const fetchMock = mockUpstream(t, () => jsonResponse(heartbeatPayload({ ...MONITOR, state })));

    const first = await call();
    state = 3; // 第二份心跳换了状态：回的是不是**新的**那份，一眼可见
    const second = await call();

    assert.equal(upstreamCallCount(fetchMock), 2);
    assert.deepEqual(monitorOf(first.body), MONITOR);
    assert.deepEqual(monitorOf(second.body), { ...MONITOR, state: 3 });
  });

  it('★★ single-flight：十个并发 ⇒ 上游计数 1', async (t) => {
    // 上游"慢一点"（5ms）：不给它一点时间的话，"合成一次"可能只是碰巧赢了竞态
    const fetchMock = mockUpstream(
      t,
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(jsonResponse(heartbeatPayload())), 5);
        }),
    );

    const ip = '10.9.9.10';
    const results = await Promise.all(Array.from({ length: 10 }, () => call({ ip })));

    assert.equal(
      upstreamCallCount(fetchMock),
      1,
      '★ 十个同时到达的请求只该合成**一次**上游调用（15 秒一刷 × 多标签页时这才不会打爆上游）',
    );
    for (const res of results) {
      assert.equal(res.status, 200);
      assert.equal(res.cacheControl, 'no-store');
      assert.deepEqual(monitorOf(res.body), MONITOR, '十个响应必须是同一份心跳');
    }
  });
});

// ---------------------------------------------------------------------------
// ③ 上游失败：三种 kind → 三种回答 + 10 分钟兜底
// ---------------------------------------------------------------------------

describe('★ 心跳端点：上游失败（三种 kind 不许合并）', () => {
  it('上游 500 + 有旧数据 ⇒ 200 + stale:true + monitor 是**旧的那份**', async (t) => {
    const errors = captureErrors(t);
    let failing = false;
    const fetchMock = mockUpstream(t, () =>
      failing ? jsonResponse({ detail: 'boom' }, 500) : jsonResponse(heartbeatPayload()),
    );

    const good = await call();
    assert.equal(good.body.stale, false);

    // 让下一次请求真的去重取（不 sleep 30 秒，理由见上一条）
    process.env.MCSR_RANKED_STATUS_TTL_MS = '0';
    failing = true;
    const res = await call();

    assert.equal(res.status, 200, '有旧数据时不该给用户一个 5xx —— 这正是兜底存在的理由');
    assert.equal(res.body.stale, true, '★ 旧数据必须自己说自己是旧的');
    assert.deepEqual(monitorOf(res.body), MONITOR, '兜底给的是**上一次**那份心跳');
    assert.equal(
      numField(res.body, 'fetchedAt'),
      numField(good.body, 'fetchedAt'),
      'fetchedAt 是那份数据的年龄，不是这次请求的时间',
    );
    assert.ok(
      numField(res.body, 'serverNow') >= numField(good.body, 'serverNow'),
      'serverNow 才是"现在"',
    );
    assert.equal(upstreamCallCount(fetchMock), 2);
    /*
     * ★ 失败要进日志：这一处是我们**唯一**能看到上游出问题的地方
     *   （另外三个面板由访客浏览器直连，它们的失败在我们这边一个字都没有，spec §3 代价 1）。
     */
    assertLoggedFailure(errors, 'unavailable');
  });

  it('上游 500 + **没有**旧数据 ⇒ 503 upstream_unavailable', async (t) => {
    const errors = captureErrors(t);
    const fetchMock = mockUpstream(t, () => jsonResponse({ detail: 'boom' }, 500));

    const res = await call();

    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { error: 'upstream_unavailable' });
    assert.equal(res.cacheControl, 'no-store', '失败响应也要 no-store（否则 5xx 会被中间层缓存）');
    assert.equal(upstreamCallCount(fetchMock), 1);
    assertLoggedFailure(errors, 'unavailable');
    assert.ok(
      errors.some((line) => line.includes('500')),
      `日志要带上 detail（这里是 HTTP 500）：${errors.join(' | ')}`,
    );
  });

  it('★ 超时（真的 abort）+ 没有旧数据 ⇒ 503 upstream_unavailable', async (t) => {
    process.env.MCSR_RANKED_STATUS_TIMEOUT_MS = '20';
    const errors = captureErrors(t);
    const fetchMock = mockUpstream(
      t,
      (call) =>
        /*
         * ★ 挂住不返回，等**我们真的**把它 abort 掉 —— 而不是自己抛一个"超时错误"。
         *   后者测的是"我们会不会处理超时"，前者测的是"超时到底会不会发生"
         *   （同 seeds/upstream.ts 里那条 MCSR_SEED_TIMEOUT_MS 的理由）。
         */
        new Promise<Response>((_resolve, reject) => {
          const signal = call.signal;
          if (!(signal instanceof AbortSignal)) {
            // ⚠️ 没有 signal 就直接让这条用例红，而不是让它挂到 node --test 的超时
            reject(new Error('mock：上游请求没有带 AbortSignal，这条用例测不到超时'));
            return;
          }
          signal.addEventListener('abort', () => {
            reject(signal.reason);
          });
        }),
    );

    const res = await call();

    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { error: 'upstream_unavailable' });
    assert.equal(upstreamCallCount(fetchMock), 1);
    assertLoggedFailure(errors, 'unavailable');
    // ★ 日志里要说得清**是超时**（而不是只留一句 "fetch failed"）
    assert.ok(
      errors.some((line) => line.includes('TimeoutError')),
      `日志要说得清是超时：${errors.join(' | ')}`,
    );
  });

  it('★ 超时（真的 abort）+ 有旧数据 ⇒ stale:true', async (t) => {
    const errors = captureErrors(t);
    let hanging = false;
    const fetchMock = mockUpstream(t, (call) => {
      if (!hanging) return jsonResponse(heartbeatPayload());
      return new Promise<Response>((_resolve, reject) => {
        const signal = call.signal;
        if (!(signal instanceof AbortSignal)) {
          reject(new Error('mock：上游请求没有带 AbortSignal'));
          return;
        }
        signal.addEventListener('abort', () => {
          reject(signal.reason);
        });
      });
    });

    const good = await call();
    process.env.MCSR_RANKED_STATUS_TTL_MS = '0';
    hanging = true;
    process.env.MCSR_RANKED_STATUS_TIMEOUT_MS = '20';
    const res = await call();

    assert.equal(res.status, 200);
    assert.equal(res.body.stale, true);
    assert.deepEqual(monitorOf(res.body), MONITOR);
    assert.equal(numField(res.body, 'fetchedAt'), numField(good.body, 'fetchedAt'));
    assert.equal(upstreamCallCount(fetchMock), 2);
    assertLoggedFailure(errors, 'unavailable');
  });

  it('★ 非 JSON（200 + HTML 错误页）+ 没有旧数据 ⇒ 503 upstream_unavailable', async (t) => {
    const errors = captureErrors(t);
    const fetchMock = mockUpstream(t, () => htmlResponse());

    const res = await call();

    /*
     * ⚠️ 这一档归 `unavailable`（上游抖了 / 被网关挡了），**不是** `bad_response`
     *    （我们的适配层对不上了）：一个 200 却回 HTML 的响应来自网关错误页或被截断的
     *    传输，而 502 会把排查方向指向一个并不存在的字段名问题。
     *    ⚠️ 否决了"顺手把它并进 bad_response"：那会让 502 同时表示
     *    "上游改了字段名"与"上游前面那台网关坏了"这两件下一步完全不同的事。
     */
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { error: 'upstream_unavailable' });
    assert.equal(upstreamCallCount(fetchMock), 1);
    assertLoggedFailure(errors, 'unavailable');
  });

  it('★ 非 JSON + 有旧数据 ⇒ stale:true', async (t) => {
    const errors = captureErrors(t);
    let broken = false;
    const fetchMock = mockUpstream(t, () =>
      broken ? htmlResponse() : jsonResponse(heartbeatPayload()),
    );

    const good = await call();
    process.env.MCSR_RANKED_STATUS_TTL_MS = '0';
    broken = true;
    const res = await call();

    assert.equal(res.status, 200);
    assert.equal(res.body.stale, true);
    assert.deepEqual(monitorOf(res.body), MONITOR);
    assert.equal(numField(res.body, 'fetchedAt'), numField(good.body, 'fetchedAt'));
    assert.equal(upstreamCallCount(fetchMock), 2);
    assertLoggedFailure(errors, 'unavailable');
  });

  it('★ 形状不对（heartbeatList 缺 monitor 2）⇒ 502 upstream_bad_response，日志带字段名', async (t) => {
    const errors = captureErrors(t);
    const fetchMock = mockUpstream(t, () => jsonResponse(heartbeatPayloadMissingMonitor()));

    const res = await call();

    /*
     * ⚠️ 502 与 503 是**两句话**：502 说"我们的适配层要改"（上游改了字段），
     *    503 说"上游抖了一下，等一下"。合并成一个码就等于把"该我们动手"的事
     *    说成"等对方修"，而它会一直等下去。
     */
    assert.equal(res.status, 502);
    assert.deepEqual(res.body, { error: 'upstream_bad_response' });
    assert.equal(upstreamCallCount(fetchMock), 1);

    // ★ 这条日志的**唯一**意义是告诉我们上游改了哪一格 —— 所以字段名必须在里面
    assertLoggedFailure(errors, 'bad_response');
    const logged = errors.find((line) => line.includes('bad_response')) ?? '';
    assert.ok(logged.includes('heartbeatList'), `日志要带上字段名：${logged}`);
    assert.ok(logged.includes('monitor 2'), `日志要带上缺的那一格（monitor 2）：${logged}`);
  });

  it('形状不对但有 10 分钟内的旧数据 ⇒ 仍然给旧数据（兜底不看失败的种类）', async (t) => {
    const errors = captureErrors(t);
    let drifted = false;
    mockUpstream(t, () =>
      drifted ? jsonResponse(heartbeatPayloadMissingMonitor()) : jsonResponse(heartbeatPayload()),
    );

    await call();
    process.env.MCSR_RANKED_STATUS_TTL_MS = '0';
    drifted = true;
    const res = await call();

    /*
     * ⚠️ 502 是"我们没别的办法回答你"时的回答，不是"必须让用户看到"的状态：
     *    手上那份 1 分钟前的心跳仍然是真的（只是旧了），比一个错误页有用。
     *    我们这边不会因此漏掉它 —— 那次失败有一条带字段名的日志（见上一条）。
     */
    assert.equal(res.status, 200);
    assert.equal(res.body.stale, true);
    assert.deepEqual(monitorOf(res.body), MONITOR);
    assertLoggedFailure(errors, 'bad_response');
  });

  it('★ 上游 429 ⇒ 503 ranked_busy（**不是** upstream_unavailable）', async (t) => {
    const errors = captureErrors(t);
    const fetchMock = mockUpstream(t, () => jsonResponse({ detail: 'slow down' }, 429));

    const res = await call();

    /*
     * ★ 429 单独成档：那是"上游在限**我们的**流，等一下就好"，与"上游挂了（等它修）"
     *   对用户的下一步完全不同。合并成 unavailable 是最容易顺手做的"简化"，
     *   而它的后果正好相反：把一条**我们**该退让的信号说成对方的故障。
     */
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { error: 'ranked_busy' });
    assert.equal(upstreamCallCount(fetchMock), 1);
    assertLoggedFailure(errors, 'busy');
  });

  it('上游 429 + 有旧数据 ⇒ 兜底（stale），不是 503', async (t) => {
    const errors = captureErrors(t);
    let limited = false;
    const fetchMock = mockUpstream(t, () =>
      limited ? jsonResponse({ detail: 'slow down' }, 429) : jsonResponse(heartbeatPayload()),
    );

    await call();
    process.env.MCSR_RANKED_STATUS_TTL_MS = '0';
    limited = true;
    const res = await call();

    // 兜底排在 kind 之前：手上那份还在 10 分钟内 ⇒ 给数据，而不是一句"稍后再试"
    assert.equal(res.status, 200);
    assert.equal(res.body.stale, true);
    assert.deepEqual(monitorOf(res.body), MONITOR);
    assert.equal(upstreamCallCount(fetchMock), 2);
    assertLoggedFailure(errors, 'busy');
  });

  it('★ 旧数据超过 10 分钟 ⇒ 503（不拿十分钟前的东西冒充实时）', async (t) => {
    const errors = captureErrors(t);
    /*
     * ⚠️ 时间用 `t.mock.timers` 控制，而不是让测试真的等 10 分钟 ——
     *    等待换不来任何多一点的证据（走的还是同一支判断），只会让门禁变成十分钟。
     *    `apis: ['Date']` 只换掉 `Date`：`AbortSignal.timeout` 用的是内部计时器，
     *    顺便也就验证了它不受影响。
     */
    t.mock.timers.enable({ apis: ['Date'] });
    const base = 1_800_000_000_000; // 显式起点：不依赖机器时钟，也避开"epoch 0"那种怪值
    t.mock.timers.setTime(base);

    let failing = false;
    const fetchMock = mockUpstream(t, () =>
      failing ? jsonResponse({ detail: 'boom' }, 500) : jsonResponse(heartbeatPayload()),
    );

    const good = await call();
    assert.equal(numField(good.body, 'fetchedAt'), base);

    process.env.MCSR_RANKED_STATUS_TTL_MS = '0';
    failing = true;
    t.mock.timers.setTime(base + 11 * 60_000); // 11 分钟：比兜底窗口多一分钟
    const res = await call();

    assert.equal(res.status, 503, '十分钟前的数据不是"实时"，宁可不给');
    assert.deepEqual(res.body, { error: 'upstream_unavailable' });
    assert.equal(upstreamCallCount(fetchMock), 2);
    assertLoggedFailure(errors, 'unavailable');
  });
});

// ---------------------------------------------------------------------------
// ④ 每 IP 限流（60 次 / 分钟）
// ---------------------------------------------------------------------------

describe('★ 心跳端点：每 IP 限流', () => {
  it('两个冻结值：60 次 / 60 秒（spec §13）', () => {
    // 把它钉在测试里：改这个数就是在改"一个正常用户能刷多快"，那该是一次有意的改动
    assert.deepEqual(RANKED_STATUS_LIMIT, { limit: 60, windowMs: 60_000 });
  });

  it('★ 第 61 次 ⇒ 429 rate_limited，第 60 次仍然 200', async (t) => {
    const errors = captureErrors(t);
    const fetchMock = mockUpstream(t, () => jsonResponse(heartbeatPayload()));
    const ip = '10.9.9.20';

    const statuses: number[] = [];
    for (let i = 0; i < RANKED_STATUS_LIMIT.limit; i += 1) {
      statuses.push((await call({ ip })).status);
    }
    assert.ok(
      statuses.every((status) => status === 200),
      `前 60 次都该是 200：${statuses.join(',')}`,
    );

    const limited = await call({ ip }); // 第 61 次
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error, 'rate_limited');
    assert.ok(
      typeof limited.body.retryAfterSec === 'number' && limited.body.retryAfterSec > 0,
      '要带上还要等多少秒（界面据此说话）',
    );
    // ★ 被限流的请求不该再消耗上游额度：全程只有第一次真的打了上游
    assert.equal(upstreamCallCount(fetchMock), 1);
    // 这条路径上没有失败，所以也不该有任何错误日志
    assert.deepEqual(errors, []);
  });

  it('限流按 IP 计：换了 IP 的人不受影响', async (t) => {
    const errors = captureErrors(t);
    mockUpstream(t, () => jsonResponse(heartbeatPayload()));
    const heavy = '10.9.9.30';

    for (let i = 0; i < RANKED_STATUS_LIMIT.limit; i += 1) await call({ ip: heavy });
    assert.equal((await call({ ip: heavy })).status, 429);

    const other = await call({ ip: '10.9.9.31' });
    assert.equal(other.status, 200, '限流是按 IP 的，不是全局闸门（否则一个人能关掉整栏）');
    assert.deepEqual(errors, []);
  });
});
