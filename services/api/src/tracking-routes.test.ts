/**
 * 追踪的博主与他们全部视频 —— **HTTP 面**（spec §6.1 那五个端点）。
 *
 * ===========================================================================
 * ★★ 这个文件不许打真网络 —— 而且这件事由**结构**保证，不靠自觉
 * ===========================================================================
 * 铁律与 `seeds-proxy.test.ts` 一样（那边防的是"往用户的生产库里写脏数据"），
 * 但手段不同：这里**不 mock `fetch`**，而是把适配器注册表**注入**进路由
 * （`createTrackingRoute({ adapters })`）。
 * mock 只能挡住"我以为会走的那条路"；而注入的假适配器在**类型上**就替代了真的那一个 ——
 * 真的 `tracking/bilibili.ts` 根本没有被 import 进这个文件，所以哪天路由多打了一次上游、
 * 或者有人把注入拆掉，这一套会**当场红**，而不是安静地打出去。
 *
 * ⚠️ 唯一碰真注册表的是最后那个 describe（挂载）：它**只**喂 youtube 链接，
 *    那条路上 `adapterFor('youtube')` 直接抛 `NoCredentialsError`（今天一个 key 都没有，
 *    spec §2.7），一个请求都发不出去。文件顶部还把那三个凭据环境变量删掉了，
 *    所以 T8 之后这条仍然是"没凭据 ⇒ 503"，不会变成一次真的 YouTube 调用。
 *
 * ===========================================================================
 * 五类失败的映射在这里被逐类钉住，表在 `routes/tracking.ts`
 * ===========================================================================
 * 裁决 2（2026-09-16）：适配器抛出来的东西**不许**一律变成 500。五类各有各的状态码，
 * 下面**一类一条用例**。每一条都额外断言"错误的原文**不在**响应体里" ——
 * 那一条正是"细节只进日志"的可执行形式：少了它，"顺手把 message 塞进 body"这种改法
 * 会让所有状态码断言照样全绿。
 */
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import type { TrackedCreator, TrackPlatform } from '@mcsr/shared';
import { Hono } from 'hono';
import type { AuthVariables } from './auth/middleware';
import type { CreatorRef, PlatformAdapter } from './tracking/types';

process.env.DB_PATH = ':memory:';
/*
 * 与 `live-shares.test.ts` 逐字相同的四行。NODE_ENV=test 那一行尤其重要：
 * index.ts 用它关掉请求日志，而 Windows 匿名管道的缓冲区只有几十 KB ——
 * 写满会阻塞事件循环，运行器接着报出 "Unable to deserialize cloned data"
 * （一个看起来像并发问题的假故障，见那个文件与 services/api/package.json 的注释）。
 */
process.env.NODE_ENV = 'test';
process.env.MCSR_MAIL_DRIVER = 'console';
process.env.MCSR_SCRYPT_TEST_PARAMS = 'N=1024,r=8,p=1';
/*
 * ★ 三个平台的凭据一律清掉。
 *   最后那个 describe 打的是**真注册表**，它靠"没有凭据"来保证那条路一次请求都不发；
 *   开发机上恰好配过 key 的话（T8 之后是常态），不清就会变成一次真的上游调用 ——
 *   而"测试有没有打网络"这件事不能取决于本机的环境变量。
 */
delete process.env.MCSR_YOUTUBE_KEY;
delete process.env.MCSR_TWITCH_ID;
delete process.env.MCSR_TWITCH_SECRET;

// ⚠️ 全部动态 import：上面那几行必须在任何 getDb() 之前生效
const { createTrackingRoute } = await import('./routes/tracking');
const { adapterFor } = await import('./tracking');
// ⚠️ 五类错误住在**两个**文件里（T3 的分工，理由见 `tracking/types.ts` 的文件头）：
//    跨平台的三类在 `types.ts`，bilibili 专属的两类在 `bilibili.ts`。
const { BilibiliRateLimitError, BilibiliRejectedError } = await import('./tracking/bilibili');
const { InvalidCreatorInputError, NoCredentialsError, PlatformHandshakeError } = await import(
  './tracking/types'
);
const { upsertVideos, storedVideoCount } = await import('./tracked-videos');
const { authRoute } = await import('./routes/auth');
const { loadUser, sameOriginOnly } = await import('./auth/middleware');
const { closeDb, getDb } = await import('./db');
const { resetAll } = await import('./auth/ratelimit');
const { app: realApp } = await import('./index');
const { SITE } = await import('@mcsr/shared');

after(() => closeDb());

// ---------------------------------------------------------------------------
// 请求脚手架（形状照 `live-shares.test.ts` 的 HTTP 那一半）
// ---------------------------------------------------------------------------

/**
 * 每个请求一个不同的转发 IP。
 *
 * ⚠️ 真 app（`./index`）上有全局限流 240 次/分钟/**IP**，而这里的请求都带同一个
 *    `x-forwarded-for` 的话，跑到后面会开始拿 429 —— 那个失败会表现成
 *    "注册/登录失败"，看起来像账号问题。`live-shares.test.ts` 的文件头写了同一条。
 */
let httpIpSeq = 0;
function testIp(): string {
  httpIpSeq += 1;
  return `10.7.${String(Math.floor(httpIpSeq / 250))}.${String(httpIpSeq % 250)}`;
}

interface Res {
  status: number;
  body: Record<string, unknown>;
  /** 原始响应文本 —— "错误原文有没有泄进响应体"那几条是按文本扫的。 */
  text: string;
  setCookie: string | null;
  cacheControl: string | null;
}

type TestApp = Hono<{ Variables: AuthVariables }>;

async function callOn(
  target: TestApp,
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

  const response = await target.request(path, {
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
    text,
    setCookie: response.headers.getSetCookie?.()[0] ?? null,
    cacheControl: response.headers.get('cache-control'),
  };
}

/** 打**当前用例那个** app（每个用例用新的假注册表重建，见 beforeEach）。 */
function call(method: string, path: string, options: { json?: unknown; cookie?: string } = {}) {
  return callOn(app, method, path, options);
}

const PASSWORD = 'a good long passphrase';
type Role = 'user' | 'reviewer' | 'editor' | 'admin' | 'owner';

let userSeq = 0;

/** 注册 → 验证邮箱 → 登录，得到一个能用的 cookie（照抄 `live-shares.test.ts`）。 */
async function signUp(role: Role = 'user', target: TestApp = app) {
  userSeq += 1;
  const email = `track${String(userSeq)}.${String(Date.now())}@example.com`;
  const displayName = `编辑${String(userSeq)}`;

  const registered = await callOn(target, 'POST', '/api/auth/register', {
    json: { email, password: PASSWORD, displayName, locale: 'zh-CN' },
  });
  assert.equal(registered.status, 200, `注册失败：${registered.text}`);

  getDb()
    .prepare('UPDATE users SET email_verified_at = ?, role = ? WHERE email = ?')
    .run(Date.now(), role, email);

  const login = await callOn(target, 'POST', '/api/auth/login', {
    json: { email, password: PASSWORD },
  });
  assert.ok(login.setCookie, `登录失败：${login.text}`);

  const row = getDb().prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string };
  return { id: row.id, email, cookie: (login.setCookie ?? '').split(';')[0] as string };
}

// ---------------------------------------------------------------------------
// 假适配器与假注册表
// ---------------------------------------------------------------------------

type Registry = (platform: TrackPlatform) => PlatformAdapter;

interface FakeAdapter extends PlatformAdapter {
  /** 这个假适配器被问过哪些输入（顺序即调用顺序）。 */
  inputs: string[];
}

/**
 * 一个假适配器。
 *
 * ⚠️ 它的类型是**真的** `PlatformAdapter`（从 `tracking/types.ts` 来，不是这里另画一个）：
 *    接口一改，这些假实现就编译不过 —— 而"测试里的假货和真货形状不一致"正是
 *    注入式测试最容易烂掉的地方。
 */
function fakeAdapter(resolve: (input: string) => CreatorRef | Promise<CreatorRef>): FakeAdapter {
  const inputs: string[] = [];
  return {
    inputs,
    async resolveCreator(input: string) {
      inputs.push(input);
      return resolve(input);
    },
    async fetchPage() {
      throw new Error('HTTP 层不该调 fetchPage —— 抓页是 T6 的 CLI 的事');
    },
  };
}

/**
 * bilibili 的假适配器：`…/703007996` ⇒ 一个 ref。
 *
 * ⚠️ 它**不是**在复刻真适配器（真的那个要握手、要跟短链），只复刻本层依赖的两件事：
 *   ① 认得出的输入 ⇒ ref，且**名字来自"平台"**（`UP <mid>`）——
 *      裁决 3 那条用例要靠它才能验"空白 displayName 没有覆盖平台给的名字"；
 *   ② 认不出的 ⇒ 抛 `InvalidCreatorInputError`（真的那个也是这么做的）。
 */
function bilibiliFake(): FakeAdapter {
  return fakeAdapter((input) => {
    const mid = /(\d+)\s*$/.exec(input)?.[1];
    if (!mid) throw new InvalidCreatorInputError('bilibili', input, '假适配器也认不出');
    return {
      platform: 'bilibili',
      externalId: mid,
      handle: mid,
      displayName: `UP ${mid}`,
      avatarUrl: null,
    };
  });
}

/**
 * 一个注册表：给了谁就用谁，**没给的抛 `NoCredentialsError`**。
 * 真注册表今天就是这样（`tracking/index.ts`：youtube / twitch 直接抛）。
 */
function registryOf(overrides: Partial<Record<TrackPlatform, PlatformAdapter>>): Registry {
  return (platform) => {
    const adapter = overrides[platform];
    if (!adapter) throw new NoCredentialsError(platform, ['MCSR_FAKE_KEY']);
    return adapter;
  };
}

/** 只挂本模块的测试应用（`index.ts` 那条链的形状：sameOriginOnly + loadUser + 路由）。 */
function testApp(registry: Registry): TestApp {
  const target = new Hono<{ Variables: AuthVariables }>();
  target.use('/api/*', sameOriginOnly);
  target.use('/api/*', loadUser);
  target.route('/api/auth', authRoute);
  target.route('/api/tracking', createTrackingRoute({ adapters: registry }));
  /*
   * ⚠️ 与 index.ts 同形（未知异常 ⇒ 500 + 通用码），但**不**打日志：
   *    有一条用例**故意**让适配器抛一个普通 Error，index.ts 那份会把整条堆栈
   *    打进测试输出，而这一套的输出量是有预算的（见 services/api/package.json 里
   *    关于 Windows 管道的那段）。真出 bug 时状态码会红，不需要那行日志。
   */
  target.onError((_error, c) => c.json({ error: 'internal_error' }, 500));
  return target;
}

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

/** 每个用例一个不同的 mid，免得跨用例撞上 `UNIQUE (platform, external_id)`。 */
let midSeq = 0;
function nextMid(): string {
  midSeq += 1;
  return String(7_000_000_000 + midSeq);
}

let app: TestApp;
let bilibili: FakeAdapter;
let now = 0;

beforeEach(() => {
  resetAll();
  /*
   * 只清这三张表，**顺序是先子后父**（tracked_videos 有外键指向 tracked_creators；
   * `PRAGMA foreign_keys = ON` 时倒过来删会当场报错）。
   * users 留着不管：id / email 都是新造的，而 live-shares 那一套也是这么做的。
   */
  getDb().exec('DELETE FROM tracked_videos');
  getDb().exec('DELETE FROM tracked_creators');
  getDb().exec('DELETE FROM audit_log');

  now = Date.now();
  bilibili = bilibiliFake();
  app = testApp(registryOf({ bilibili }));
});

/** 一条视频的 `FetchedVideo`（字段一个不少 —— 少一个就是类型错误，不是运行期默认值）。 */
function fetchedVideo(externalId: string, title: string, publishedAt: number | null) {
  return {
    externalId,
    title,
    thumbnailUrl: `https://i0.hdslb.com/${externalId}.jpg`,
    publishedAt,
    durationSec: 600,
    viewCount: 1,
    commentCount: 2,
    isLiveReplay: false,
  };
}

/** 直接往库里塞视频（路由**没有**加视频的端点 —— 那是 T6 的 CLI 的事）。 */
function seedVideos(creatorId: string, externalIds: string[], publishedBase = 1_700_000_000): void {
  upsertVideos(
    creatorId,
    'bilibili',
    externalIds.map((id, index) => fetchedVideo(id, `视频 ${id}`, publishedBase + index)),
    now,
  );
}

interface AuditRow {
  action: string;
  actor_id: string | null;
  entity_type: string;
  entity_id: string | null;
  reason: string | null;
}

function auditsOf(entityId: string): AuditRow[] {
  return getDb()
    .prepare(
      `SELECT action, actor_id, entity_type, entity_id, reason FROM audit_log
        WHERE entity_id = ? ORDER BY rowid`,
    )
    .all(entityId) as unknown as AuditRow[];
}

/** 库里一共有几条审计（"被拒的请求不该留下任何痕迹"那几条用它）。 */
function auditCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number };
  return row.n;
}

function creatorsOf(res: Res): TrackedCreator[] {
  return (res.body.items ?? []) as TrackedCreator[];
}

function videosOf(res: Res): Array<{ id: string; externalId: string; status: string }> {
  return (res.body.items ?? []) as Array<{ id: string; externalId: string; status: string }>;
}

/** 加一个博主（POST），返回它那一条。**所有需要"先有一个博主"的用例都走它。** */
async function addCreator(cookie: string, mid: string, extra: Record<string, unknown> = {}) {
  const res = await call('POST', '/api/tracking/creators', {
    json: { input: `https://space.bilibili.com/${mid}`, ...extra },
    cookie,
  });
  assert.equal(res.status, 201, `加博主应当 201：${res.text}`);
  return res.body.creator as TrackedCreator;
}

// ---------------------------------------------------------------------------
// 权限（spec §6.1：只有公开列表不要 live.manage）
// ---------------------------------------------------------------------------

describe('HTTP：能力门槛', () => {
  it('GET /videos 是公开的：匿名 200，而且形状与视频墙一致', async () => {
    const res = await call('GET', '/api/tracking/videos');

    assert.equal(res.status, 200, res.text);
    /*
     * ⚠️ 形状钉在这里是因为**前端分页控件吃它**：`videos.ts` 的公开列表回的也是
     *    items / total / page / pageSize，两个列表共用一套控件（T7）。
     *    少一个键在类型上是编译错误，但在 JSON 里只是"界面上那格是空的"。
     */
    assert.deepEqual(Object.keys(res.body).sort(), ['items', 'page', 'pageSize', 'total']);
    assert.deepEqual(res.body.items, []);
    assert.equal(res.body.total, 0);
    assert.equal(res.body.page, 1);
    assert.equal(res.body.pageSize, 24);
    // 公开列表给 60 秒公开缓存（与视频墙、直播清单一致）
    assert.match(String(res.cacheControl), /^public, max-age=60/);
    // 读接口不碰适配器（一个上游请求都不该发生）
    assert.equal(bilibili.inputs.length, 0);
  });

  it('其余四个：匿名 401 —— 不是空名单，也不是 403', async () => {
    const responses = [
      await call('GET', '/api/tracking/creators'),
      await call('POST', '/api/tracking/creators', { json: { input: 'anything' } }),
      await call('PATCH', '/api/tracking/creators/some-id', { json: { enabled: false } }),
      await call('DELETE', '/api/tracking/creators/some-id'),
    ];

    for (const res of responses) {
      assert.equal(res.status, 401, res.text);
      assert.deepEqual(res.body, { error: 'unauthorized' });
    }
    /*
     * ★ 401 而不是 `{ items: [] }`：空名单会让游客以为"名单是空的"，
     *   而事实是他还没登录 —— 与本仓 share / live 那几组逐字同一条理由。
     * ⚠️ 顺带钉住**顺序**：守卫必须跑在解析入参、更要在碰适配器之前 ——
     *   匿名请求把一个上游请求打出去，那不是"少一道权限"，是把我们的风控额度
     *   交给任何路过的人。
     */
    assert.equal(bilibili.inputs.length, 0);
  });

  it('登录但没有 live.manage ⇒ 403 forbidden（user 与 reviewer 都是）', async () => {
    const user = await signUp('user');
    const reviewer = await signUp('reviewer');

    for (const who of [user, reviewer]) {
      const responses = [
        await call('GET', '/api/tracking/creators', { cookie: who.cookie }),
        await call('POST', '/api/tracking/creators', {
          json: { input: 'https://space.bilibili.com/1' },
          cookie: who.cookie,
        }),
        await call('PATCH', '/api/tracking/creators/some-id', {
          json: { enabled: false },
          cookie: who.cookie,
        }),
        await call('DELETE', '/api/tracking/creators/some-id', { cookie: who.cookie }),
      ];
      for (const res of responses) {
        assert.equal(res.status, 403, res.text);
        // ⚠️ 必须是 forbidden：403 email_not_verified 会让界面说"去验证邮箱"，
        //    而 `live.manage` 刻意**不在** REQUIRES_VERIFIED 里（编辑身份是管理员核实过的）
        assert.equal(res.body.error, 'forbidden', res.text);
        assert.equal(res.body.capability, 'live.manage');
      }
    }

    assert.equal(bilibili.inputs.length, 0);
  });
});

// ---------------------------------------------------------------------------
// 加（POST /creators）
// ---------------------------------------------------------------------------

describe('HTTP：加一个博主', () => {
  it('一个能解析的链接 ⇒ 201，名单里立刻能看到它，名字是平台给的', async () => {
    const editor = await signUp('editor');
    const mid = nextMid();
    const link = `https://space.bilibili.com/${mid}`;

    const res = await call('POST', '/api/tracking/creators', {
      json: { input: link },
      cookie: editor.cookie,
    });

    assert.equal(res.status, 201, res.text);
    assert.equal(res.body.ok, true);
    const creator = res.body.creator as TrackedCreator;
    assert.equal(creator.platform, 'bilibili');
    assert.equal(creator.externalId, mid);
    assert.equal(creator.handle, mid);
    assert.equal(creator.displayName, `UP ${mid}`, '没给 displayName ⇒ 用平台给的名字');
    assert.equal(creator.enabled, true);
    assert.equal(creator.backfillDone, false, '新加的博主还没回填过');
    assert.equal(creator.lastSyncedAt, null, '从没同步过 ⇒ null（不是 0）');
    assert.equal(creator.lastError, null);
    assert.equal(creator.consecutiveFailures, 0);
    assert.equal(creator.videoCount, 0);
    // 路由把**原文**交给了适配器（平台拆分在服务端做，客户端只给一条链接）
    assert.deepEqual(bilibili.inputs, [link]);

    const list = await call('GET', '/api/tracking/creators', { cookie: editor.cookie });
    assert.equal(list.status, 200, list.text);
    assert.equal(list.cacheControl, 'no-store');
    const items = creatorsOf(list);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.id, creator.id);
    assert.equal(items[0]?.displayName, `UP ${mid}`);
  });

  it('解析不出来的输入 ⇒ 400 + 机器可读的 reason，而且一条都没写进去', async () => {
    const editor = await signUp('editor');
    /*
     * ⚠️ 基线要在注册/登录**之后**取：注册与登录自己就会写审计
     * （`routes/auth.ts` 那几条），拿 0 去比会红在一个与本用例无关的地方。
     */
    const auditsBefore = auditCount();

    // ① 连"这是哪个平台"都判不出来 ⇒ 连适配器都不问
    const unknown = await call('POST', '/api/tracking/creators', {
      json: { input: '今天天气不错' },
      cookie: editor.cookie,
    });
    assert.equal(unknown.status, 400, unknown.text);
    assert.equal(unknown.body.error, 'invalid_input');
    assert.equal(unknown.body.reason, 'unresolvable_input');
    assert.equal(bilibili.inputs.length, 0, '判不出平台就不该去问任何适配器');

    // ② 判得出平台，但适配器认不出（比如短链跳到了视频页）
    const rejected = await call('POST', '/api/tracking/creators', {
      json: { input: 'https://space.bilibili.com/不是数字' },
      cookie: editor.cookie,
    });
    assert.equal(rejected.status, 400, rejected.text);
    assert.equal(rejected.body.error, 'invalid_input');
    assert.equal(rejected.body.reason, 'unresolvable_input');
    assert.equal(bilibili.inputs.length, 1, '这一条**必须**问过适配器才算数');
    // 适配器给的细节（认不出的原因、原文）只进日志，不进响应体
    assert.ok(!rejected.text.includes('假适配器也认不出'), rejected.text);

    const list = await call('GET', '/api/tracking/creators', { cookie: editor.cookie });
    assert.deepEqual(creatorsOf(list), [], '失败的那两次不许留下任何行');
    assert.equal(auditCount(), auditsBefore, '失败了就不该有审计');
  });

  it('重复加同一个 ⇒ 400 duplicate（不是 500），并带上已经存在的那一条的 id', async () => {
    const editor = await signUp('editor');
    const mid = nextMid();
    const first = await addCreator(editor.cookie, mid);

    const again = await call('POST', '/api/tracking/creators', {
      json: { input: `https://space.bilibili.com/${mid}` },
      cookie: editor.cookie,
    });

    /*
     * ★ "已经在名单上了"是**正常结果**（手滑贴两遍、两个编辑同时加），调用方能自己处理 ⇒
     *   400 + 机器可读的 reason，而不是 500。裁决 1 逐字要求把这一条钉住：
     *   数据层返回的是 `{ok:false, reason:'duplicate'}` 这个**联合**（不是抛），
     *   路由若不认它，重复添加就会长成一次内部错误。
     */
    assert.equal(again.status, 400, again.text);
    assert.notEqual(again.status, 500);
    assert.equal(again.body.error, 'invalid_input');
    assert.equal(again.body.reason, 'duplicate');
    assert.equal(again.body.existingId, first.id);

    const list = await call('GET', '/api/tracking/creators', { cookie: editor.cookie });
    assert.equal(creatorsOf(list).length, 1, '第二次不该插进去第二行');
    assert.equal(auditsOf(first.id).length, 1, '被拒的那一次不是一次创建，不该多一条审计');
  });

  it('★ 纯空白的 displayName 不覆盖平台给的名字（裁决 3），但填了的要用填的', async () => {
    const editor = await signUp('editor');
    const blankMid = nextMid();

    /*
     * ⚠️`TrackedCreatorInputSchema` 的注释写明：`.trim()` 会把 `'   '` 变成 `''`，
     *   而 `max(80)` 对空串是通的 —— 也就是说**空白是通过校验的**。
     *   不特判的话，管理面板上会出现一行**空白的显示名**（既不是名字，也看不出是没填）。
     */
    const blank = await addCreator(editor.cookie, blankMid, { displayName: '   ' });
    assert.equal(blank.displayName, `UP ${blankMid}`, '空白 ⇒ 当没填，用平台给的名字');

    /*
     * ★ 后半条**不是**多余的：只断言前半条的话，"把覆盖那段代码整个删掉"照样绿 ——
     *   一个永远不会执行的覆盖逻辑和一个正确地忽略空白的覆盖逻辑，表现完全一样。
     */
    const namedMid = nextMid();
    const named = await addCreator(editor.cookie, namedMid, { displayName: '我给他的名字' });
    assert.equal(named.displayName, '我给他的名字', '填了就用填的');

    const list = await call('GET', '/api/tracking/creators', { cookie: editor.cookie });
    const byId = new Map(creatorsOf(list).map((c) => [c.id, c]));
    assert.equal(byId.get(blank.id)?.displayName, `UP ${blankMid}`);
    assert.equal(byId.get(named.id)?.displayName, '我给他的名字');
  });
});

// ---------------------------------------------------------------------------
// 适配器的五类失败（裁决 2）—— 一类一条
// ---------------------------------------------------------------------------

/** 加博主时让适配器/注册表炸掉的那个 app。 */
function appThatFails(overrides: Partial<Record<TrackPlatform, PlatformAdapter>>): TestApp {
  return testApp(registryOf(overrides));
}

/** 响应里不许出现的那段原文（每一类都用同一个记号，扫起来一致）。 */
const LEAK = '内部细节-DO-NOT-LEAK';

async function postAsEditor(target: TestApp, input = 'https://space.bilibili.com/1') {
  const editor = await signUp('editor', target);
  const res = await callOn(target, 'POST', '/api/tracking/creators', {
    json: { input },
    cookie: editor.cookie,
  });
  return res;
}

/*
 * ⚠️ 这一组里有**七**条：裁决 2 那张表的五类各一条，加两条"表外的" ——
 *    一个普通异常（必须是 500，不许被归进上面任何一类）和一个"适配器回错了平台"
 *    （那是我们自己的 bug，数据库拦不住）。名字里的"五类"指的是那张表。
 */
describe('HTTP：适配器失败（裁决 2 的那张表 + 表外的两种）', () => {
  it('InvalidCreatorInputError ⇒ 400（管理员贴错了，重贴一个就行）', async () => {
    const target = appThatFails({
      bilibili: fakeAdapter(() => {
        throw new InvalidCreatorInputError('bilibili', 'input', LEAK);
      }),
    });

    const res = await postAsEditor(target);

    assert.equal(res.status, 400, res.text);
    assert.equal(res.body.error, 'invalid_input');
    assert.equal(res.body.reason, 'unresolvable_input');
    assert.ok(!res.text.includes(LEAK), res.text);
  });

  it('NoCredentialsError ⇒ 503 platform_not_configured（是我们没配，不是调用方的错）', async () => {
    // 注册表里没有 bilibili ⇒ 真注册表今天对 youtube/twitch 的行为完全一样
    const target = appThatFails({});

    const res = await postAsEditor(target);

    assert.equal(res.status, 503, res.text);
    assert.equal(res.body.error, 'platform_not_configured');
    assert.equal(res.body.platform, 'bilibili');
    // 它**不是** 500：这不是崩溃，是"这个平台这一轮不可用"（spec §9.1 ⑧ 的同一条）
    assert.notEqual(res.status, 500);
  });

  it('BilibiliRateLimitError ⇒ 429 rate_limited（可重试，不是 500）', async () => {
    const target = appThatFails({
      bilibili: fakeAdapter(() => {
        throw new BilibiliRateLimitError(LEAK, 3);
      }),
    });

    const res = await postAsEditor(target);

    /*
     * ★ 适配器内部那 3 次 10 秒重试**已经跑完了**（spec §5.1 冻结口径），
     *   所以走到这里的语义只剩一句话："上游正在限我们的流，过一会儿再来"。
     *   429 就是这个意思；500 会让人去查代码，而那次查询什么都不会发现。
     */
    assert.equal(res.status, 429, res.text);
    assert.equal(res.body.error, 'rate_limited');
    assert.notEqual(res.status, 500);
    assert.ok(!res.text.includes(LEAK), res.text);
  });

  it('BilibiliRejectedError ⇒ 502（我们的适配层和上游脱节了，细节只在日志里）', async () => {
    const target = appThatFails({
      bilibili: fakeAdapter(() => {
        throw new BilibiliRejectedError(LEAK, -352);
      }),
    });

    const res = await postAsEditor(target);

    assert.equal(res.status, 502, res.text);
    assert.equal(res.body.error, 'upstream_bad_response');
    assert.ok(!res.text.includes(LEAK), res.text);
    assert.ok(!res.text.includes('bilibili'), '上游/适配器的细节一个字都不进响应体');
  });

  it('PlatformHandshakeError ⇒ 502（同上：这是"我们要改"，不是"上游抖了"）', async () => {
    const target = appThatFails({
      bilibili: fakeAdapter(() => {
        throw new PlatformHandshakeError('bilibili', 'nav', LEAK);
      }),
    });

    const res = await postAsEditor(target);

    assert.equal(res.status, 502, res.text);
    assert.equal(res.body.error, 'upstream_bad_response');
    assert.ok(!res.text.includes(LEAK), res.text);
  });

  it('第六种：别的异常**不**被映射成上面任何一种 —— 那是我们的 bug，走 500', async () => {
    const target = appThatFails({
      bilibili: fakeAdapter(() => {
        throw new Error(LEAK);
      }),
    });

    const res = await postAsEditor(target);

    /*
     * ⚠️ 这一条守的是"分类表有没有兜底成一个 500 以外的东西"：
     *    把任意异常都归进上面五类里的某一类，表现是**我们自己的 bug**
     *    被报成"上游在限流"或"管理员贴错了链接" —— 而这两种都会让人去错的
     *    方向找原因（前者等，后者重贴链接），代码里的那个错永远不会被看见。
     */
    assert.equal(res.status, 500, res.text);
    assert.deepEqual(res.body, { error: 'internal_error' });
    assert.ok(!res.text.includes(LEAK), res.text);
  });

  it('适配器回的 platform 与它自己的平台不一致 ⇒ 500，而且一行都不写', async () => {
    const target = appThatFails({
      // 一个 bilibili 的适配器回了一个 twitch 的 ref（复制粘贴时忘了改）
      bilibili: fakeAdapter(() => ({
        platform: 'twitch',
        externalId: '703007996',
        handle: '703007996',
        displayName: 'UP',
        avatarUrl: null,
      })),
    });
    const editor = await signUp('editor', target);

    const res = await callOn(target, 'POST', '/api/tracking/creators', {
      json: { input: 'https://space.bilibili.com/703007996' },
      cookie: editor.cookie,
    });

    /*
     * ⚠️ 这类错**数据库拦不住**：两张表的 `platform` 都是合法值，`CHECK` 也过得去。
     *   写进去的表现是这个博主的**全部视频**被记在另一个平台下，日后再多出一份
     *   同 bvid 的行 —— 而两边都不会报错（`tracked-videos.ts` 的 `upsertVideos`
     *   为同一件事也做了一次交叉校验）。
     */
    assert.equal(res.status, 500, res.text);
    assert.deepEqual(res.body, { error: 'internal_error' });
    const counted = getDb().prepare('SELECT COUNT(*) AS n FROM tracked_creators').get() as {
      n: number;
    };
    assert.equal(counted.n, 0);
  });
});

// ---------------------------------------------------------------------------
// 平台分发（只回答"交给谁"）
// ---------------------------------------------------------------------------

describe('HTTP：平台分发', () => {
  it('三种输入形状各自派给对的平台（纯数字 mid / @handle / 链接）', async () => {
    const youtube = fakeAdapter((input) => ({
      platform: 'youtube',
      // 每个输入一个不同的 externalId —— 否则同一个假适配器的第二次调用会撞上
      // `UNIQUE (platform, external_id)`，而那条用例想验的是**分发**，不是去重
      externalId: `yt:${input}`,
      handle: input,
      displayName: 'YouTube 频道',
      avatarUrl: null,
    }));
    const twitch = fakeAdapter((input) => ({
      platform: 'twitch',
      externalId: `tw:${input}`,
      handle: input,
      displayName: 'Twitch 频道',
      avatarUrl: null,
    }));
    const target = testApp(registryOf({ bilibili, youtube, twitch }));
    const editor = await signUp('editor', target);

    const cases: Array<{ input: string; platform: string; fake: FakeAdapter }> = [
      // spec §5.1：一串纯数字就是一个 mid
      { input: nextMid(), platform: 'bilibili', fake: bilibili },
      // spec §5.2：`@handle`
      { input: '@someone', platform: 'youtube', fake: youtube },
      { input: 'https://youtu.be/abcdef', platform: 'youtube', fake: youtube },
      // spec §5.3
      { input: 'https://twitch.tv/somebody', platform: 'twitch', fake: twitch },
    ];

    for (const item of cases) {
      const before = item.fake.inputs.length;
      const res = await callOn(target, 'POST', '/api/tracking/creators', {
        json: { input: item.input },
        cookie: editor.cookie,
      });
      assert.equal(res.status, 201, `${item.input} ⇒ ${res.text}`);
      assert.equal((res.body.creator as TrackedCreator).platform, item.platform);
      assert.deepEqual(
        item.fake.inputs.slice(before),
        [item.input],
        `${item.input} 应当**只**交给 ${item.platform} 的适配器（原文原样传）`,
      );
    }
  });

  it('认的是**主机名**：别的域名里带着 bilibili 也要 400，而不是派给适配器', async () => {
    const editor = await signUp('editor');

    /*
     * ⚠️ 这一条防的是"用 includes 判域名"那种写法：
     *    `evil.com/?x=space.bilibili.com/123` 里**含有**那个字符串，而它根本不是
     *    bilibili 的链接。派给适配器的话，b23 那条路（会**联网**）就是被一个
     *    外部字符串牵着走的 —— 而这条路上的输入完全来自管理员粘贴的任意文本。
     */
    for (const input of ['https://evil.com/space.bilibili.com/123', 'not-a-link-at-all']) {
      const res = await call('POST', '/api/tracking/creators', {
        json: { input },
        cookie: editor.cookie,
      });
      assert.equal(res.status, 400, `${input} ⇒ ${res.text}`);
      assert.equal(res.body.reason, 'unresolvable_input');
    }
    assert.equal(bilibili.inputs.length, 0, '一个适配器都不该被问到');
  });
});

// ---------------------------------------------------------------------------
// 改（PATCH /creators/:id）
// ---------------------------------------------------------------------------

describe('HTTP：改一个博主', () => {
  it('改显示名 / 停用 / 重新回填：库里真的变了，且各写一条审计', async () => {
    const editor = await signUp('editor');
    const creator = await addCreator(editor.cookie, nextMid());
    // 先把它标成"回填完了"，好让 reBackfill 那一步有东西可改
    getDb().prepare('UPDATE tracked_creators SET backfill_done = 1 WHERE id = ?').run(creator.id);

    const renamed = await call('PATCH', `/api/tracking/creators/${creator.id}`, {
      json: { displayName: '改名之后' },
      cookie: editor.cookie,
    });
    assert.equal(renamed.status, 200, renamed.text);
    assert.equal((renamed.body.creator as TrackedCreator).displayName, '改名之后');

    const disabled = await call('PATCH', `/api/tracking/creators/${creator.id}`, {
      json: { enabled: false },
      cookie: editor.cookie,
    });
    assert.equal(disabled.status, 200, disabled.text);
    assert.equal((disabled.body.creator as TrackedCreator).enabled, false);

    const again = await call('PATCH', `/api/tracking/creators/${creator.id}`, {
      json: { reBackfill: true },
      cookie: editor.cookie,
    });
    assert.equal(again.status, 200, again.text);
    assert.equal((again.body.creator as TrackedCreator).backfillDone, false, '重新回填 = 置 0');

    // 库里也是这些值（不是只有响应好看）
    // ⚠️ 逐字段断言，不用 deepEqual：`node:sqlite` 回的是 **null 原型**对象，
    //    而 `node:assert/strict` 的 deepEqual 连原型一起比（差一个原型就红，
    //    报错信息还看不出是为什么）。
    const row = getDb()
      .prepare('SELECT display_name, enabled, backfill_done FROM tracked_creators WHERE id = ?')
      .get(creator.id) as { display_name: string; enabled: number; backfill_done: number };
    assert.equal(row.display_name, '改名之后');
    assert.equal(row.enabled, 0);
    assert.equal(row.backfill_done, 0, '重新回填 = 置 0');

    // ★ 三次改动 = 三条审计（spec §6.1 的 ★：加/改/删都写审计）
    const audits = auditsOf(creator.id);
    assert.deepEqual(
      audits.map((a) => a.action),
      [
        'tracked_creator.create',
        'tracked_creator.update',
        'tracked_creator.update',
        'tracked_creator.update',
      ],
    );
    assert.deepEqual(
      audits.slice(1).map((a) => a.reason),
      ['displayName=改名之后', 'enabled=false', 'reBackfill=true'],
    );
    assert.equal(audits[0]?.reason, `bilibili ${creator.externalId}`);
    for (const audit of audits) {
      assert.equal(audit.entity_type, 'tracked_creator');
      assert.equal(audit.actor_id, editor.id, '审计要能回答"是谁做的"');
    }
  });

  it('不存在的 id ⇒ 404，且不写审计', async () => {
    const editor = await signUp('editor');

    const res = await call('PATCH', '/api/tracking/creators/not-a-real-id', {
      json: { enabled: false },
      cookie: editor.cookie,
    });

    assert.equal(res.status, 404, res.text);
    assert.deepEqual(res.body, { error: 'not_found' });
    assert.deepEqual(auditsOf('not-a-real-id'), []);
  });

  it('空补丁 / 多余字段 / 空白的显示名 ⇒ 一律 400，且一条审计都不写', async () => {
    const editor = await signUp('editor');
    const creator = await addCreator(editor.cookie, nextMid());

    const bodies = [
      {}, // 什么都没改（refine：至少要改一个字段）
      { enabled: false, nickname: 'x' }, // 多了一个不认识的键（.strict()）
      { displayName: '   ' }, // trim 之后是空串 ⇒ 会把显示名清空（裁决 3 的同一件事）
    ];
    for (const json of bodies) {
      const res = await call('PATCH', `/api/tracking/creators/${creator.id}`, {
        json,
        cookie: editor.cookie,
      });
      assert.equal(res.status, 400, `${JSON.stringify(json)} ⇒ ${res.text}`);
      assert.equal(res.body.error, 'invalid_input');
      assert.ok(
        Array.isArray(res.body.issues),
        '字段级错误走 issues 形状（与 live / resources 一致）',
      );
    }

    const row = getDb()
      .prepare('SELECT display_name, enabled FROM tracked_creators WHERE id = ?')
      .get(creator.id) as { display_name: string; enabled: number };
    assert.equal(row.display_name, `UP ${creator.externalId}`, '三次都没改到显示名');
    assert.equal(row.enabled, 1, '三次都没改到启用状态');
    assert.deepEqual(
      auditsOf(creator.id).map((a) => a.action),
      ['tracked_creator.create'],
      '被拒的补丁不是一次改动',
    );
  });
});

// ---------------------------------------------------------------------------
// 删（DELETE /creators/:id）
// ---------------------------------------------------------------------------

describe('HTTP：删一个博主', () => {
  it('删掉之后名单里没有它了，他的视频也跟着没了（外键级联）', async () => {
    const editor = await signUp('editor');
    const creator = await addCreator(editor.cookie, nextMid());
    seedVideos(creator.id, ['BV1', 'BV2']);
    assert.equal(storedVideoCount(creator.id), 2);
    assert.equal((await call('GET', '/api/tracking/videos')).body.total, 2);

    const res = await call('DELETE', `/api/tracking/creators/${creator.id}`, {
      cookie: editor.cookie,
    });

    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.body, { ok: true, id: creator.id });

    const list = await call('GET', '/api/tracking/creators', { cookie: editor.cookie });
    assert.deepEqual(creatorsOf(list), [], '名单里不该还有它');

    /*
     * ★ 视频跟着走靠的是迁移 020 那条 `ON DELETE CASCADE` + `PRAGMA foreign_keys = ON`。
     *   少了 PRAGMA（db/index.ts 里那一行）时删除照样成功，只是留下**孤儿行** ——
     *   而孤儿行在公开列表上看起来完全正常（spec §4.2 把这条写在建表理由里）。
     *   ⇒ 所以这里用**行为**钉住它：行数、以及公开列表的 total。
     */
    assert.equal(storedVideoCount(creator.id), 0);
    const videos = await call('GET', '/api/tracking/videos');
    assert.equal(videos.body.total, 0);
    assert.deepEqual(videosOf(videos), []);

    const audits = auditsOf(creator.id);
    assert.deepEqual(
      audits.map((a) => a.action),
      ['tracked_creator.create', 'tracked_creator.delete'],
    );
    // 删掉之后 platform / externalId 就查不到了 ⇒ 审计必须把它记下来（live.ts 同一条）
    assert.equal(audits[1]?.reason, `bilibili ${creator.externalId}`);
    assert.equal(audits[1]?.actor_id, editor.id);
  });

  it('删不存在的 ⇒ 404，且不写审计', async () => {
    const editor = await signUp('editor');

    const res = await call('DELETE', '/api/tracking/creators/not-a-real-id', {
      cookie: editor.cookie,
    });

    assert.equal(res.status, 404, res.text);
    assert.deepEqual(res.body, { error: 'not_found' });
    assert.deepEqual(auditsOf('not-a-real-id'), []);
  });
});

// ---------------------------------------------------------------------------
// 公开视频列表（GET /videos）
// ---------------------------------------------------------------------------

describe('HTTP：公开视频列表', () => {
  it('匿名可读，按发布时间倒序，分页形状与视频墙一致', async () => {
    const editor = await signUp('editor');
    const creator = await addCreator(editor.cookie, nextMid());
    seedVideos(creator.id, ['BV_old', 'BV_mid', 'BV_new']);

    const first = await call('GET', '/api/tracking/videos?page=1&pageSize=2');
    assert.equal(first.status, 200, first.text);
    assert.equal(first.body.total, 3, 'total 是全部条数，不是这一页的');
    assert.equal(first.body.page, 1);
    assert.equal(first.body.pageSize, 2);
    assert.deepEqual(
      videosOf(first).map((v) => v.externalId),
      ['BV_new', 'BV_mid'],
      '按 published_at DESC（最新的在最前）',
    );

    const second = await call('GET', '/api/tracking/videos?page=2&pageSize=2');
    assert.deepEqual(
      videosOf(second).map((v) => v.externalId),
      ['BV_old'],
      'offset 必须跟着 page 走，否则第二页会重复第一页',
    );
  });

  it('status = hidden 的不出现在公开列表里（spec §6.1 的过滤口径）', async () => {
    const editor = await signUp('editor');
    const creator = await addCreator(editor.cookie, nextMid());
    seedVideos(creator.id, ['BV_shown', 'BV_hidden']);

    /*
     * v1 **没有**隐藏端点（spec §6.1 只有这五个），编辑是直接改库设的 ——
     * 这正是 `status` 那一列存在的唯一理由，所以这里也只能直接改库来造这个状态。
     */
    getDb()
      .prepare("UPDATE tracked_videos SET status = 'hidden' WHERE external_id = ?")
      .run('BV_hidden');

    const res = await call('GET', '/api/tracking/videos');
    assert.deepEqual(
      videosOf(res).map((v) => v.externalId),
      ['BV_shown'],
    );
    assert.equal(res.body.total, 1, 'total 与 items 必须用同一个条件（否则会翻到空页）');
  });

  it('page / pageSize 不合法 ⇒ 400 invalid_query（不是静默当成 1）', async () => {
    for (const query of ['page=0', 'page=abc', 'pageSize=0', 'pageSize=101']) {
      const res = await call('GET', `/api/tracking/videos?${query}`);
      assert.equal(res.status, 400, `${query} ⇒ ${res.text}`);
      assert.equal(res.body.error, 'invalid_query');
    }
  });
});

// ---------------------------------------------------------------------------
// 挂载：真 app（index.ts）与真注册表
// ---------------------------------------------------------------------------

describe('HTTP：挂载与真注册表', () => {
  it('真 app 上就是这五条路径（匿名 GET /videos ⇒ 200）', async () => {
    const res = await callOn(realApp, 'GET', '/api/tracking/videos');
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.total, 0);
    // 没挂上的话 index.ts 的 notFound 会给出这个（它比一个 404 更容易被认出来）
    assert.equal(res.body.error, undefined, res.text);
  });

  it('真注册表 + 今天一个凭据都没有：youtube 链接 ⇒ 503，且一个上游请求都没发出去', async () => {
    const editor = await signUp('editor', realApp);

    /*
     * ★ 这是本文件**唯一**碰真注册表的一条，而它刻意只喂 youtube：
     *   `adapterFor('youtube')` 在没配 key 时**直接抛 NoCredentialsError**（spec §2.7 实测
     *   生产上一个 key 都没有），所以这条路上一次网络请求都不可能发生
     *   （b23 短链那条会联网的路在 bilibili 的适配器里，这里根本走不到）。
     * ⚠️ 这也顺带钉住了"index.ts 挂的是带真注册表的那个实例" ——
     *   只测 `createTrackingRoute({adapters: 假的})` 的话，index.ts 那一行改错了
     *   （挂错实例、挂错路径、忘了挂）不会有任何测试变红。
     */
    const res = await callOn(realApp, 'POST', '/api/tracking/creators', {
      json: { input: 'https://www.youtube.com/@someone' },
      cookie: editor.cookie,
    });

    assert.equal(res.status, 503, res.text);
    assert.equal(res.body.error, 'platform_not_configured');
    assert.equal(res.body.platform, 'youtube');
    // 真注册表仍然照 spec §9.1 ⑧ 说话：跳过并说明原因，而不是崩，也不是记成一次抓取失败
    assert.equal(typeof adapterFor, 'function');
  });
});
