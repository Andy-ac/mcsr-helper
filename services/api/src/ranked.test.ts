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
 * ⚠️ 第二个上游（`GET /api/ranked/live`，收录那一支的原料）同样指向 `.invalid`：
 *    这一栏从此有**两个**服务端上游，两条都必须在测试里被钉死，
 *    漏一条就会以**服务器的 IP** 打到真上游（文件头那段代价对两条都成立）。
 */
process.env.MCSR_RANKED_LIVE_URL = 'https://upstream.invalid/live';
/*
 * ⚠️ 这两个变量**本机可能已被设过**（它们的存在就是为了给运维与测试留接缝）——
 *    不清掉的话"TTL 内不重打"那条会随环境变红或变绿，而失败信息会指向一个
 *    与它无关的地方。要改的那两条用例自己设、beforeEach 再清回来。
 */
delete process.env.MCSR_RANKED_STATUS_TTL_MS;
delete process.env.MCSR_RANKED_STATUS_TIMEOUT_MS;
delete process.env.MCSR_RANKED_LIVE_TTL_MS;
delete process.env.MCSR_RANKED_LIVE_TIMEOUT_MS;

const { RANKED_STATUS_LIMIT, rankedRoute, resetRankedStatusCache } = await import(
  './routes/ranked'
);
const { loadUser, sameOriginOnly } = await import('./auth/middleware');
const { closeDb, getDb } = await import('./db');
const { resetAll } = await import('./auth/ratelimit');
const { resetRankedLiveFeed } = await import('./ranked/live-feed');
const { ingestRankedLiveChannels, RANKED_INGEST_SORT_ORDER } = await import('./ranked/ingest');
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
  // ★ 第二个上游的缓存同样必须清（不 clear 的话"收录"那些用例会互相串）
  resetRankedLiveFeed();
  /*
   * ⚠️ `live_channels` 是**跨用例存活**的（库是 :memory:，但整个文件共享同一个连接）：
   *    不清的话"只该有一行"那类断言会被上一个用例插进去的行蒙对/弄红，
   *    而失败信息会指向一个与它无关的地方（同 live.test.ts 的 beforeEach）。
   */
  getDb().exec('DELETE FROM live_channels');
  delete process.env.MCSR_RANKED_STATUS_TTL_MS;
  delete process.env.MCSR_RANKED_STATUS_TIMEOUT_MS;
  delete process.env.MCSR_RANKED_LIVE_TTL_MS;
  delete process.env.MCSR_RANKED_LIVE_TIMEOUT_MS;
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
  const lines = rankedLogLines(errors);
  assert.equal(lines.length, 1, `这次失败应该有且只有一条日志：${errors.join(' | ')}`);
  assert.ok(lines[0]?.includes(kind), `日志要带上 kind（${kind}）：${lines[0] ?? '(空)'}`);
}

/**
 * 本次用例里打出来的 `[ranked]` 日志行。
 *
 * ⚠️ 日志的**条数**是判据的一半：一次**尝试**一行 —— 一个请求一行日志，
 *    等于把一次上游故障看成 N 次（排障时最误导人的那种形状）。
 */
function rankedLogLines(errors: string[]): string[] {
  return errors.filter((line) => line.includes('[ranked]'));
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

/**
 * 等到条件成立（最多若干轮事件循环）。
 *
 * ⚠️ 不用 `sleep`：`app.request` 那条链上**没有真正的 I/O**（更好的做法是等条件，而不是
 *    猜一个足够长的毫秒数）—— 猜短了是偶发红，猜长了是给每条用例加一段白等。
 *    等不到就**当场失败**，而不是让后面那条断言用一个莫名其妙的方式红。
 */
async function waitFor(condition: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`等不到：${what}`);
}

/**
 * 让那条链跑到底（固定轮数），用于证明一件**没有**发生的事
 * （"它没有再去打一次上游"这种断言没法用 `waitFor` 等 —— 等不到的正是它）。
 */
async function drain(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
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
// 自动收录（`GET /api/ranked/live`）的夹具与读取器
// ---------------------------------------------------------------------------

let liveIpSeq = 0;

/**
 * 打 `GET /api/ranked/live` 的那一个请求。
 *
 * ⚠️ 它多带一个 `text`：有一条判据是**响应逐字节没变**，而那只比 `text` 才算数
 *    （比 `body` 测的是"字段一样"，不是"连键序与空白都一样"）。
 */
async function callLive(options: { ip?: string } = {}) {
  const headers: Record<string, string> = { origin: SITE.productionOrigin };
  headers['x-real-ip'] = options.ip ?? `10.8.0.${String(++liveIpSeq % 250)}`;

  const response = await app.request('/api/ranked/live', { method: 'GET', headers });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return {
    status: response.status,
    body,
    text,
    cacheControl: response.headers.get('cache-control'),
  };
}

/** 上游 `/live` 里的一侧（少了的那几格按上游实测补成 null）。 */
interface LiveSideFixture {
  uuid: string;
  liveUrl?: string | null;
  nickname?: string;
}

/**
 * 一场对局 —— **照 spec §2.2 的实测形状**造：`players` 是数组、`data` 是
 * **以 uuid 为键的对象**（这是上游最容易写错的一处，`parse.ts` 的注释里写着）。
 * `liveUrl` 放在 `data.<uuid>` 里，**不在** `players[]` 里。
 */
function liveMatchFixture(sides: [LiveSideFixture, LiveSideFixture]): Record<string, unknown> {
  return {
    currentTime: 918_454,
    players: sides.map((side, index) => ({
      uuid: side.uuid,
      nickname: side.nickname ?? `Player${String(index)}`,
      roleType: 0,
      // elo 一高一低：`parseLive` 会据此固定左右顺序，夹具里给全，免得落到"未定级"那一支
      eloRate: 2400 - index * 100,
      eloRank: index + 1,
      country: null,
    })),
    data: Object.fromEntries(
      sides.map((side) => [
        side.uuid,
        {
          liveUrl: side.liveUrl ?? null,
          timeline: { time: 221_649, type: 'nether.find_bastion' },
        },
      ]),
    ),
  };
}

/** 上游 `/live` 的响应信封（`status` + `data.players` / `data.liveMatches`）。 */
function livePayload(matches: Array<Record<string, unknown>>): Record<string, unknown> {
  return { status: 'success', data: { players: 1257, liveMatches: matches } };
}

/** `live_channels` 的那几列（**逐字段展开成普通对象字面量**，理由见下面的读取器）。 */
interface LiveChannelRow {
  platform: string;
  handle: string;
  display_name: string;
  note: string | null;
  tags: string | null;
  live_video_id: string | null;
  embed_channel: number;
  sort_order: number;
  status: string;
}

/**
 * 库里的直播频道清单。
 *
 * ⚠️ 逐字段展开，不返回 node:sqlite 的行对象：它的原型不是 `Object.prototype`，
 *    而测试里的 `deepEqual` 会比较原型 —— 两边打印出来一模一样却判不相等
 *    （这条坑在本仓踩过不止一次，见 `live.ts` 的 `toChannel` 注释）。
 */
function liveRows(): LiveChannelRow[] {
  const rows = getDb()
    .prepare(
      `SELECT platform, handle, display_name, note, tags, live_video_id, embed_channel,
              sort_order, status
         FROM live_channels ORDER BY handle ASC`,
    )
    .all() as unknown as LiveChannelRow[];
  return rows.map((row) => ({
    platform: row.platform,
    handle: row.handle,
    display_name: row.display_name,
    note: row.note,
    tags: row.tags,
    live_video_id: row.live_video_id,
    embed_channel: Number(row.embed_channel),
    sort_order: Number(row.sort_order),
    status: row.status,
  }));
}

/**
 * 库里那些行的 **id**（**只**用于钉"这是不是同一行"）。
 *
 * ⚠️ 它是"删掉再收回来"那条用例的判据：行号/内容都一样时，只有 id 能说明
 *    它是一次**新的**插入，而不是原来那一行被改了。
 */
function liveRowIds(): string[] {
  const rows = getDb()
    .prepare('SELECT id FROM live_channels ORDER BY handle ASC')
    .all() as unknown as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

/**
 * 本次用例里打出来的 `[ranked-live]` 行。
 *
 * ⚠️ 前缀与心跳的 `[ranked]` **不同**，所以这里必须自己筛一遍：用同一个前缀的话，
 *    "一次心跳故障有且只有一行日志"那些断言会被这一层的行数搅红 ——
 *    那是两个子系统的两件事（`ingest.ts` 里写着这条理由）。
 */
function liveLogLines(errors: string[]): string[] {
  return errors.filter((line) => line.includes('[ranked-live]'));
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

  it('★★ 先结算的那一次不许清掉**后来那一次**在飞的 promise（否则会并发打第二次上游）', async (t) => {
    /*
     * ⚠️ `MCSR_RANKED_STATUS_TTL_MS=0`：让第三次请求**必然走到 `load()`**。
     *    用默认 TTL 的话，第二次请求成功后会留下一份"新鲜"的缓存，
     *    第三次请求直接从缓存回答、根本碰不到 `load()` —— 那样这条用例就测不到它要测的东西
     *    （它在有缺陷的实现上也会绿，而这种"看着在测、其实没测"的用例比没有更糟）。
     */
    process.env.MCSR_RANKED_STATUS_TTL_MS = '0';
    const errors = captureErrors(t);
    // 上游"挂了不返回"：什么时候结算由用例决定，这样"在飞"是一个可以摆出来的状态
    const pending: Array<(response: Response) => void> = [];
    const fetchMock = mockUpstream(
      t,
      () =>
        new Promise<Response>((resolve) => {
          pending.push(resolve);
        }),
    );

    const first = call({ ip: '10.9.9.40' });
    await waitFor(() => pending.length === 1, '第一次请求到达上游');

    /*
     * ★ 这一句是这条用例的起因：`resetRankedStatusCache()` 会在**有请求还在飞**的时候
     *    清掉那份记录（它是测试用的接缝，两个用例之间要互不串味）。清完之后来的第二个请求
     *    会**新起**一个 promise（#2）。
     * ⚠️ 于是 #1 结算时那个 `finally` 只准清掉**它自己**（`inflight === 那个 promise`）——
     *    否则它把 #2 的槽位清空，第三个请求就会以为"没有人在飞"而再打一次上游：
     *    同一时刻两个上游调用，而那正是 single-flight 存在的理由
     *    （spec §5.3：这一处每分钟最多 2 次真实调用，多出来的每一次都在烧服务器 IP 的额度）。
     */
    resetRankedStatusCache();
    const second = call({ ip: '10.9.9.40' });
    await waitFor(() => pending.length === 2, '第二次请求到达上游');

    pending[0]?.(jsonResponse(heartbeatPayload()));
    const firstRes = await first;
    assert.equal(firstRes.status, 200);

    // ★ 此刻在飞的是 #2：第三次请求必须搭上它
    const third = call({ ip: '10.9.9.40' });
    await drain();
    // 无论它有没有再打一次上游，都把挂着的都放开：否则这条用例会因为"上游永不返回"挂到框架超时
    for (const resolve of pending) resolve(jsonResponse(heartbeatPayload()));
    const [secondRes, thirdRes] = await Promise.all([second, third]);

    assert.equal(
      upstreamCallCount(fetchMock),
      2,
      '★ 第三次请求该搭上 #2 那一次；变成了 3 就说明 #1 的 finally 把 #2 的槽位清掉了',
    );
    assert.equal(secondRes.status, 200);
    assert.equal(thirdRes.status, 200);
    assert.deepEqual(errors, [], '这条路径上没有失败，不该有日志');
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
    /*
     * ★ 429 也要 `no-store`：`no-store` 是**这个 handler 每一条响应**的性质
     *   （200 / 429 / 502 / 503 都是"此刻"的答案），不是"成功那条才有的"。
     *   实测过它曾经挂在限流判断**之后** ⇒ 被限流的响应没有这个头，
     *   而 429 恰好是最容易被中间层留住的那一种（"稍后再试"被缓存下来就再也不试了）。
     */
    assert.equal(limited.cacheControl, 'no-store', '429 也要 no-store');
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

// ---------------------------------------------------------------------------
// ⑤ 两个时刻：`fetchedAt`（数据多旧）与 `lastAttemptAt`（上次尝试打上游是什么时候）
// ---------------------------------------------------------------------------

/**
 * ★★ 这一组用例来自一次评审实测的缺陷。
 *
 * 判据只看 `fetchedAt` 时，**失败之后"该不该再打上游"这个判断永远为真**：
 * 失败不更新 `fetchedAt`（数据确实还是旧的）⇒ 每个请求都打一次上游、每个请求都记一条日志，
 * 而上游越慢/越挂，我们打得越狠 —— 正是 spec §5.3 那句"这一处每分钟最多 2 次真实上游调用"
 * 声称不可能发生的那个反馈环。
 * ⇒ 所以这两条用例的判据全是**桩的调用次数**（响应体在这个状态下看不出差别：
 *   有缺陷的实现回的是**另一次失败**，看起来一样是 503）。
 */
describe('★ 心跳端点：失败也要节流（两个时刻）', () => {
  it('★★ 连着两次失败（同一个 TTL 内）⇒ 上游只被打一次，第二次回的是**同一份**回答', async (t) => {
    const errors = captureErrors(t);
    let attempt = 0;
    const fetchMock = mockUpstream(t, () => {
      attempt += 1;
      /*
       * ⚠️ 第二次失败**故意换一种**（429 ⇒ 那一档本该是 502/`ranked_busy`）：
       *    这样"第二次到底有没有再去问上游"在**响应体**里也看得见，
       *    不必只靠桩计数 —— 只靠计数的话，一个"打了上游但把结果丢掉"的实现会被蒙对。
       */
      return attempt === 1
        ? jsonResponse({ detail: 'boom' }, 500)
        : jsonResponse({ detail: 'slow down' }, 429);
    });

    const first = await call();
    const second = await call();

    assert.equal(first.status, 503);
    assert.deepEqual(first.body, { error: 'upstream_unavailable' });

    assert.equal(
      upstreamCallCount(fetchMock),
      1,
      '★ 失败的那一次也要计入节流：一个 TTL 内最多打一次上游（否则上游一挂就变成"每个请求都打一次"）',
    );
    assert.equal(second.status, first.status, '第二次与第一次是**同一份**回答，不是重新问出来的');
    assert.deepEqual(
      second.body,
      first.body,
      '第二次不该变成 ranked_busy —— 变了就说明它又去打了一次上游',
    );
    // ★ 一次**尝试**一行日志：一个请求一行，等于把一次故障看成 60 次
    assertLoggedFailure(errors, 'unavailable');
  });

  it('★★ 上游挂着 + 有旧数据：同一个 TTL 内**换个人来**也不打上游（节流不是按 IP 的）', async (t) => {
    const errors = captureErrors(t);
    /*
     * ⚠️ 时间用 `t.mock.timers` 控制（同"旧数据超过 10 分钟"那条）：TTL 与兜底窗口都是
     *    "过了多久"的判断，而等待换不来任何多一点的证据。
     */
    t.mock.timers.enable({ apis: ['Date'] });
    const base = 1_800_000_000_000;
    t.mock.timers.setTime(base);

    let failing = false;
    const fetchMock = mockUpstream(t, () =>
      failing ? jsonResponse({ detail: 'boom' }, 500) : jsonResponse(heartbeatPayload()),
    );

    const first = await call({ ip: '10.9.9.50' }); // t0：成功，手上有一份数据了
    assert.equal(first.body.stale, false);

    failing = true;
    t.mock.timers.setTime(base + 31_000); // 过了 TTL ⇒ 这一次该真的打上游
    const second = await call({ ip: '10.9.9.51' });
    assert.equal(second.status, 200);
    assert.equal(second.body.stale, true);
    assert.equal(upstreamCallCount(fetchMock), 2);

    // ★★ 缺陷的那一面就在这里：**另一个 IP 的人**在同一个 TTL 里来了
    t.mock.timers.setTime(base + 40_000);
    const third = await call({ ip: '10.9.9.52' });
    assert.equal(third.status, 200);
    assert.equal(third.body.stale, true);
    assert.deepEqual(monitorOf(third.body), MONITOR, '还是那份旧数据');
    assert.equal(numField(third.body, 'fetchedAt'), base, 'fetchedAt 是那份**数据**的年龄');
    assert.equal(numField(third.body, 'serverNow'), base + 40_000, 'serverNow 才是"现在"');
    assert.equal(
      upstreamCallCount(fetchMock),
      2,
      '★ 上一次**失败**的尝试也要计入节流（按 fetchedAt 判的话这里会是 3）',
    );

    // 失败之后**再过**一个 TTL 才轮到下一次尝试
    t.mock.timers.setTime(base + 61_000);
    const fourth = await call({ ip: '10.9.9.53' });
    assert.equal(fourth.status, 200);
    assert.equal(
      upstreamCallCount(fetchMock),
      3,
      '过了 TTL 还是要再试：它是"上游好了没有"的唯一探针',
    );
    // ★ 真的打了上游的失败恰好两次 ⇒ 恰好两行日志（第三、四次请求没有再打，就不该多出日志）
    assert.equal(rankedLogLines(errors).length, 2, `日志条数不对：${errors.join(' | ')}`);
  });

  it('★ 过了 TTL，失败也允许再打一次（桩计数 2）—— 节流不是"失败之后就放弃"', async (t) => {
    const errors = captureErrors(t);
    const fetchMock = mockUpstream(t, () => jsonResponse({ detail: 'boom' }, 500));

    const first = await call();
    // ⚠️ TTL=0 与"时间推过 30 秒"走的是**同一支**判断（`now - lastAttemptAt >= ttlMs()`）
    process.env.MCSR_RANKED_STATUS_TTL_MS = '0';
    const second = await call();

    assert.equal(first.status, 503);
    assert.equal(second.status, 503);
    assert.equal(
      upstreamCallCount(fetchMock),
      2,
      '★ 过了 TTL 就要再试一次：手上有旧数据时，这条请求是我们唯一能发现"上游好了"的机会',
    );
    assert.equal(rankedLogLines(errors).length, 2, '两次真的打了上游的失败 ⇒ 两行日志');
  });

  it('★ TTL 被夹在 10 分钟上界：超窗的旧数据不能带着 stale:false 回给访客', async (t) => {
    const errors = captureErrors(t);
    t.mock.timers.enable({ apis: ['Date'] });
    const base = 1_800_000_000_000;
    t.mock.timers.setTime(base);
    /*
     * ★ 20 分钟 > 兜底窗口（10 分钟）。不夹的话，11 分钟前那份数据会被判成"新鲜"
     *   ⇒ 带着 `stale:false` 回给访客，也就是**面板上写着"实时"、数据却是十一分钟前的**
     *   —— 那是 spec §5.3 唯一明令不许出现的那种展示（数据是真的、时间是假的）。
     *   ⚠️ 否决了"只把默认值写对、不管覆盖值"：这个环境变量是**运维也能设**的接缝。
     */
    process.env.MCSR_RANKED_STATUS_TTL_MS = String(20 * 60_000);

    let failing = false;
    const fetchMock = mockUpstream(t, () =>
      failing ? jsonResponse({ detail: 'boom' }, 500) : jsonResponse(heartbeatPayload()),
    );

    const good = await call();
    assert.equal(numField(good.body, 'fetchedAt'), base);

    failing = true;
    t.mock.timers.setTime(base + 11 * 60_000); // 比兜底窗口多一分钟，但比那个没夹的 TTL 少
    const res = await call();

    assert.equal(res.status, 503, '★ 十一分钟前的心跳不是"实时"，宁可不给');
    assert.deepEqual(res.body, { error: 'upstream_unavailable' });
    assert.equal(
      upstreamCallCount(fetchMock),
      2,
      '它必须真的去重取一次（而不是拿十一分钟前那份当"新鲜"直接回）',
    );
    assertLoggedFailure(errors, 'unavailable');
  });
});

// ---------------------------------------------------------------------------
// ⑥ 自动收录：ranked 实时信息里的 twitch 直播链接 → 「直播」频道
// ---------------------------------------------------------------------------

/**
 * 用户要求 3：「从现在开始抓取 ranked 实时信息的 twitch 直播链接，自动添加至本应用的
 * 『直播』频道」。四条裁决：只要 twitch；`displayName` **就是** login（不是 MCSR 昵称）；
 * 标签是 `ranked`（不加额外标记）；在**请求路径**里做（不新开定时任务）。
 *
 * ⚠️ 这一节同时钉住两件**运维性质**的事（它们不是实现细节，是"下次该怎么做"）：
 *   · 编辑**隐藏**掉一行之后，再来多少次请求它都还是隐藏的（只插不改）；
 *   · 编辑**删掉**一行之后，下一个 30 秒窗口会把它**原样加回来** —— 所以正确的动作是隐藏。
 */
describe('★★ GET /api/ranked/live：twitch 直播链接自动收录进「直播」频道', () => {
  /** 一份"典型"载荷：一场有 twitch 的 + 一场 youtube/bilibili/没链接的。 */
  function mixedPayload(): Record<string, unknown> {
    return livePayload([
      liveMatchFixture([
        { uuid: 'aaa', nickname: 'StreamerA', liveUrl: 'https://twitch.tv/hufterl' },
        {
          uuid: 'bbb',
          nickname: 'StreamerB',
          liveUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
        },
      ]),
      liveMatchFixture([
        { uuid: 'ccc', nickname: 'StreamerC', liveUrl: 'https://live.bilibili.com/31288037' },
        { uuid: 'ddd', nickname: 'StreamerD', liveUrl: null },
      ]),
    ]);
  }

  it('★ 只收 twitch：**一行**、字段逐格照裁决；youtube / bilibili / 没有链接的都不收', async (t) => {
    const errors = captureErrors(t);
    mockUpstream(t, () => jsonResponse(mixedPayload()));

    const res = await callLive();

    assert.equal(res.status, 200);
    assert.equal(
      res.cacheControl,
      'no-store',
      '这条响应不能被任何一层缓存：请求到不了我们这里，收录就被**静默**关掉了',
    );
    // ★ 载荷原样回去：这一层不许为了收录改动响应（面板与它是逐字段一致的形状）
    assert.equal(res.body.players, 1257);
    assert.equal((res.body.matches as unknown[]).length, 2);

    const rows = liveRows();
    assert.equal(rows.length, 1, `只该有 twitch 那一行：${JSON.stringify(rows)}`);
    assert.deepEqual(rows[0], {
      platform: 'twitch',
      handle: 'hufterl',
      // ★ 裁决：显示名**就是**频道名（twitch login），不是选手的 MCSR 昵称（StreamerA）
      display_name: 'hufterl',
      note: null,
      // ★ 裁决：标签是 ranked —— 这就是"这批行是谁加进来的"的答案（不新增任何字段）
      tags: '["ranked"]',
      // ★ 裁决：这一列留空 —— 收的是**频道**，不是"这一场"
      live_video_id: null,
      embed_channel: 0,
      sort_order: RANKED_INGEST_SORT_ORDER,
      status: 'visible',
    });
    assert.equal(RANKED_INGEST_SORT_ORDER, 1000, '★ 冻结值：排在编辑那一批（表单默认 100）后面');
    assert.deepEqual(errors, [], '正常路径一个字都不该写进日志');
  });

  it('★★ 同一份载荷请求两次（两次都真的重取）：仍然**一行**，而且两次响应逐字节一样', async (t) => {
    captureErrors(t);
    // ★ TTL=0 让第二次也真的重取一次（与"时间推过 30 秒"走的是**同一支**判断）
    process.env.MCSR_RANKED_LIVE_TTL_MS = '0';
    const fetchMock = mockUpstream(t, () => jsonResponse(mixedPayload()));

    const first = await callLive();
    const second = await callLive();

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(upstreamCallCount(fetchMock), 2, 'TTL=0 ⇒ 两次都该真的打上游');
    assert.equal(
      second.text,
      first.text,
      '★★ 响应必须逐字节一样：收录是副作用，不许在响应上留下任何一个字节',
    );
    assert.equal(
      liveRows().length,
      1,
      '★ 幂等：第二次不许再插一行（`ON CONFLICT … DO NOTHING` 做不到这件事，见 live.ts）',
    );
  });

  it('★★ 编辑**隐藏**过的行：再一次请求之后仍然是隐藏的，而且仍然只有一行', async (t) => {
    captureErrors(t);
    process.env.MCSR_RANKED_LIVE_TTL_MS = '0';
    mockUpstream(t, () => jsonResponse(mixedPayload()));

    await callLive();
    assert.equal(liveRows()[0]?.status, 'visible', '先确认第一次真的收进去了');

    // 编辑隐藏它（编辑界面改的就是这一列）
    getDb().prepare("UPDATE live_channels SET status = 'hidden' WHERE handle = ?").run('hufterl');

    await callLive();

    const rows = liveRows();
    assert.equal(rows.length, 1, '仍然只有一行（不许插第二行，也不许把它变成两行）');
    assert.equal(rows[0]?.status, 'hidden', '★ "编辑说过它不该出现"比收录强：只插不改');
  });

  it('★ 认不出平台（kick）⇒ 一行都不加（但那个 kick 选手照常渲染）', async (t) => {
    const errors = captureErrors(t);
    mockUpstream(t, () =>
      jsonResponse(
        livePayload([
          liveMatchFixture([
            { uuid: 'aaa', nickname: 'StreamerA', liveUrl: 'https://kick.com/someone' },
            { uuid: 'bbb', nickname: 'StreamerB', liveUrl: 'https://twitch.tv/other' },
          ]),
        ]),
      ),
    );

    const res = await callLive();

    assert.equal(res.status, 200);
    const rows = liveRows();
    assert.equal(rows.length, 1, '★ kick 不收，twitch 那个照收');
    assert.equal(rows[0]?.handle, 'other');
    assert.deepEqual(errors, []);
  });

  it('★ 同一份载荷里同一个 login 出现两次 ⇒ 只加一行', async (t) => {
    captureErrors(t);
    const url = 'https://twitch.tv/hufterl';
    mockUpstream(t, () =>
      jsonResponse(
        livePayload([
          liveMatchFixture([
            { uuid: 'aaa', nickname: 'A', liveUrl: url },
            { uuid: 'bbb', nickname: 'B', liveUrl: null },
          ]),
          liveMatchFixture([
            { uuid: 'ccc', nickname: 'C', liveUrl: url },
            { uuid: 'ddd', nickname: 'D', liveUrl: null },
          ]),
        ]),
      ),
    );

    assert.equal((await callLive()).status, 200);
    assert.equal(liveRows().length, 1, '同一个人出现在两场里 ⇒ 只收一行');
  });

  it('★★ 收录只发生在**真的从上游取回来**的那一次：TTL 内（缓存命中）不入库', async (t) => {
    const errors = captureErrors(t);
    const fetchMock = mockUpstream(t, () => jsonResponse(mixedPayload()));

    // 默认 TTL（30 秒）：第二次请求**不会**再打上游
    assert.equal((await callLive()).status, 200);
    assert.equal(liveRows().length, 1);

    // 把那一行删掉（模拟"编辑真的删了"），然后在 TTL 内再请求一次
    getDb().exec('DELETE FROM live_channels');

    const second = await callLive();

    assert.equal(second.status, 200);
    assert.equal(upstreamCallCount(fetchMock), 1, 'TTL 内不该再打上游');
    assert.equal(
      liveRows().length,
      0,
      '★ 缓存命中的那一次**不入库** —— 否则"最多每 30 秒一个入库窗口"就是一句假话',
    );
    assert.deepEqual(errors, []);
  });

  it('★★ 删掉那一行之后，下一个窗口会把它**加回来**（所以正确动作是隐藏，不是删）', async (t) => {
    captureErrors(t);
    process.env.MCSR_RANKED_LIVE_TTL_MS = '0';
    mockUpstream(t, () => jsonResponse(mixedPayload()));

    await callLive();
    const before = liveRowIds();
    assert.equal(before.length, 1);

    // 编辑**删**掉它（不是隐藏）
    getDb().prepare('DELETE FROM live_channels WHERE handle = ?').run('hufterl');
    assert.equal(liveRows().length, 0);

    await callLive();

    const rows = liveRows();
    assert.equal(rows.length, 1, '★ 三列被腾空 ⇒ 它不再"已经记过"，于是又被收进来了');
    assert.equal(rows[0]?.status, 'visible', '新那一行是可见的（编辑要再隐藏一次）');
    assert.notEqual(
      liveRowIds()[0],
      before[0],
      '它是一行**新的**记录（新 id）—— 这就是"删掉不等于不要它"的意思',
    );
  });

  it('★ 上游 500 ⇒ 503 upstream_unavailable，且一行都不加', async (t) => {
    const errors = captureErrors(t);
    const fetchMock = mockUpstream(t, () => jsonResponse({ detail: 'boom' }, 500));

    const res = await callLive();

    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { error: 'upstream_unavailable' });
    assert.equal(res.cacheControl, 'no-store', '失败响应也要 no-store');
    assert.equal(liveRows().length, 0, '取不到就什么都不收');
    assert.equal(upstreamCallCount(fetchMock), 1);
    assert.equal(liveLogLines(errors).length, 1, `一次尝试一行日志：${errors.join(' | ')}`);
    assert.ok(liveLogLines(errors)[0]?.includes('unavailable'), '日志要带上那一档');
  });

  it('★ 超时（真的 abort）⇒ 503 upstream_unavailable，且一行都不加', async (t) => {
    process.env.MCSR_RANKED_LIVE_TIMEOUT_MS = '20';
    const errors = captureErrors(t);
    mockUpstream(
      t,
      (call) =>
        /*
         * ★ 同样挂住不返回、等**我们真的**把它 abort 掉（同心跳那条用例的理由：
         *   自己抛一个"超时错误"测的是"我们会不会处理超时"，而不是"超时会不会发生"）。
         */
        new Promise<Response>((_resolve, reject) => {
          const signal = call.signal;
          if (!(signal instanceof AbortSignal)) {
            reject(new Error('mock：上游请求没有带 AbortSignal，这条用例测不到超时'));
            return;
          }
          signal.addEventListener('abort', () => {
            reject(signal.reason);
          });
        }),
    );

    const res = await callLive();

    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { error: 'upstream_unavailable' });
    assert.equal(liveRows().length, 0);
    assert.equal(liveLogLines(errors).length, 1);
    assert.ok(
      liveLogLines(errors)[0]?.includes('TimeoutError'),
      `日志要说得清是超时：${errors.join(' | ')}`,
    );
  });

  it('★ 形状不对（200 但读不出对局）⇒ 502 upstream_bad_response，且一行都不加', async (t) => {
    const errors = captureErrors(t);
    mockUpstream(t, () => jsonResponse({ status: 'success', data: { players: 1257 } }));

    const res = await callLive();

    /*
     * ⚠️ 502 与 503 的区别是这一栏的**核心口径**（spec §4.2）：形状不对 = "我们的适配层要改"，
     *    上游抖了 = "等一下再试"。合并成一个码，排查方向就没了。
     */
    assert.equal(res.status, 502);
    assert.deepEqual(res.body, { error: 'upstream_bad_response' });
    assert.equal(liveRows().length, 0);
    assert.equal(liveLogLines(errors).length, 1);
    assert.ok(liveLogLines(errors)[0]?.includes('bad_response'));
  });

  it('★★ 写库失败（触发器拦住）⇒ 这次 GET 仍然正常，而且与没失败那次**逐字节一样**', async (t) => {
    const errors = captureErrors(t);
    process.env.MCSR_RANKED_LIVE_TTL_MS = '0';
    mockUpstream(t, () => jsonResponse(mixedPayload()));

    /*
     * ★ 把库真的弄坏：一个 `BEFORE INSERT` 触发器直接 ABORT。
     *   ⚠️ 用它而不是"把 `db.prepare` mock 掉"：这是**真的**写不进去（走的还是那条真实的
     *   SQL 与真实的错误类型），而 mock 掉一个原生对象的方法测的只是"我们以为自己处理了异常"。
     */
    getDb().exec(
      "CREATE TRIGGER test_block_live_insert BEFORE INSERT ON live_channels BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );

    let brokenStatus = 0;
    let brokenText = '';
    try {
      const res = await callLive();
      brokenStatus = res.status;
      brokenText = res.text;
    } finally {
      // ⚠️ 一定要拆掉：留着它，这个文件里之后每一条用例都会写不进去
      getDb().exec('DROP TRIGGER test_block_live_insert');
    }

    assert.equal(brokenStatus, 200, '★ 一次 GET 绝不许因为这次写库而失败');
    assert.equal(liveRows().length, 0, '这一次确实一行都没写进去（前提成立）');
    assert.equal(
      liveLogLines(errors).length,
      1,
      `要**正好一行** [ranked-live] 日志（吞掉，但不是静默）：${errors.join(' | ')}`,
    );

    // ★★ 库好着的时候再打一次同样的请求：两份响应必须一模一样
    const healthy = await callLive();
    assert.equal(healthy.status, 200);
    assert.equal(healthy.text, brokenText, '★★ 入库失败不许在响应上留下任何一个字节的痕迹');
    assert.equal(liveRows().length, 1, '库好着的时候那一行照常进去（上面那次失败没有留下副作用）');
  });

  it('★ ingest 自己**不抛**：写库失败时它 resolve(0)，而不是 reject（契约写在被调用方）', async (t) => {
    const errors = captureErrors(t);
    const { parseLive } = await import('@mcsr/shared/ranked');
    const data = parseLive(mixedPayload());
    assert.ok(data, '夹具必须解析得出来');

    getDb().exec(
      "CREATE TRIGGER test_block_live_insert BEFORE INSERT ON live_channels BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    let inserted = -1;
    try {
      /*
       * ⚠️ 这里**故意没有** try/catch：有的话它就变成"路由那一层也负责吞"，
       *    而"谁负责吞"有两个答案时，就一定会有第三种情况没人管。
       */
      inserted = await ingestRankedLiveChannels(data, Date.now());
    } finally {
      getDb().exec('DROP TRIGGER test_block_live_insert');
    }

    assert.equal(inserted, 0);
    assert.equal(liveLogLines(errors).length, 1);
  });
});
