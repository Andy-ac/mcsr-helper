/**
 * 用户第 10 条的采集作业（`live-status.ts` + 两个取数层）。
 *
 * ---------------------------------------------------------------------------
 * 这个文件里最要紧的一条：**平台级失败一个字段都不许写**
 * ---------------------------------------------------------------------------
 * 一次网络抖动如果被写成"不在播"，界面上会**安静地**少掉所有徽章 ——
 * 而那是我们根本没验证过的一句话。所以这里每一条"上游失败"的用例都同时钉两件：
 *   ① `apply` 的**调用次数**（0 次，或只带答过的那些行）；
 *   ② 响应里那个平台那一段的文本（`failed（…）` 与原因）。
 * ⚠️ 只断言 ② 是不够的：`apply` 被调用成空数组也满足"没写东西"，
 *    而那种实现会在下一轮把一次抖动变成一次空写；只断言 ① 也不够 ——
 *    "什么都没写"和"这个作业根本没跑"在库上看起来一样。
 *
 * ⚠️ 这个文件**绝不产生真实网络请求**：两个取数层都接受注入的 `fetchImpl`，
 *    这里**每一个**碰上游的用例都传一个假的（没有一处依赖 `globalThis.fetch`）。
 *    URL 也一律是这条端点自己的地址 —— 断言里写死它，是为了让"请求打到别处"
 *    变成一次会红的断言，而不是"某天有人在测试里打到了真上游"。
 */
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.MCSR_MAIL_DRIVER = 'console';
process.env.MCSR_SCRYPT_TEST_PARAMS = 'N=1024,r=8,p=1';
/*
 * ⚠️ 清掉可能被开发机设过的凭据：`productionDeps()` 会读它们，而
 *    "缺凭据要跳过"那条用例必须与开发机的环境**无关**（照 `ranked.test.ts` 的写法）。
 */
delete process.env.MCSR_TWITCH_ID;
delete process.env.MCSR_TWITCH_SECRET;

/*
 * ⚠️ `type` 只能走**单独的类型导入**：把它写进 `const { …, type X } = await import(…)`
 *    里 esbuild 当场拒绝（`Expected "}" but found "LiveStatusTarget"`），
 *    而那个报错指着 import 那一行、看起来像语法坏了。
 *    类型导入在编译期被完全擦掉 ⇒ 放在这一堆"先设好 env 再 import"的上面是安全的
 *    （`ranked.test.ts:38-41` 写着同一条）。
 */
import type { LiveStatusTarget, LiveStatusUpdate } from './live';
import type { RunDeps } from './live-status';

const { closeDb, getDb } = await import('./db');
const { applyLiveStatus, listLiveChannels } = await import('./live');
const { BILIBILI_MAX_ROOMS, fetchBilibiliLiveRooms } = await import('./liveness/bilibili-rooms');
const { TWITCH_LOGIN_BATCH, fetchTwitchLiveStreams } = await import('./liveness/twitch-streams');
const { LIVE_STATUS_PLATFORMS, main, runOnce } = await import('./live-status');

after(() => closeDb());
beforeEach(() => {
  getDb().exec('DELETE FROM live_channels');
});

// ---------------------------------------------------------------------------
// 假的 fetch：记录每一次调用
// ---------------------------------------------------------------------------

interface Call {
  url: string;
  headers: Record<string, string>;
}

interface Fake {
  calls: Call[];
  fetchImpl: typeof fetch;
}

function fakeFetch(handler: (call: Call, index: number) => Response | Promise<Response>): Fake {
  const calls: Call[] = [];
  /*
   * ⚠️ 参数类型走 `Parameters<typeof fetch>[…]`，**不写 `RequestInfo` / `RequestInit`**：
   *    API 包的 tsconfig 只有 `lib: ES2023` + `types: node`（没有 DOM），
   *    而 `RequestInfo` 是 DOM 的类型 ⇒ 写了会编译不过，报的还是一句
   *    "Cannot find name 'RequestInfo'"，看起来像拼错了名字。
   */
  const fetchImpl = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const call: Call = {
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    return handler(call, calls.length - 1);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** 一个永远能换到 token 的假 token 源（不碰 `tracking/twitch.ts` 的网络路径）。 */
function fakeTokens(value = 'TOKEN-FOR-TEST') {
  let calls = 0;
  return {
    calls: () => calls,
    source: {
      get: async () => {
        calls += 1;
        return value;
      },
    },
  };
}

/** URL 里那个重复参数出现了几次（`user_login` 是**重复参数**，不能用 Record 装）。 */
function repeated(url: string, name: string): string[] {
  return new URL(url).searchParams.getAll(name);
}

// ===========================================================================
// Twitch：`helix/streams`
// ===========================================================================

describe('★ Twitch 取数层（helix/streams）', () => {
  it('URL 与请求头逐字：重复的 user_login + Client-Id + Bearer', async () => {
    const tokens = fakeTokens('T-123');
    const fake = fakeFetch(() => json({ data: [] }));
    await fetchTwitchLiveStreams(['alpha', 'beta'], {
      tokens: tokens.source,
      clientId: 'cid-1',
      fetchImpl: fake.fetchImpl,
    });

    assert.equal(fake.calls.length, 1);
    assert.equal(
      fake.calls[0]?.url,
      'https://api.twitch.tv/helix/streams?first=100&user_login=alpha&user_login=beta',
      '端点、参数名与顺序都要逐字钉住（`first=100` 先出现是因为它先被 set）',
    );
    assert.deepEqual(repeated(fake.calls[0]?.url ?? '', 'user_login'), ['alpha', 'beta']);
    assert.equal(fake.calls[0]?.headers['Client-Id'], 'cid-1');
    assert.equal(fake.calls[0]?.headers.Authorization, 'Bearer T-123');
  });

  it('183 个 login ⇒ 恰好 2 批（100 + 83），**没有一批超过 100**', async () => {
    const fake = fakeFetch(() => json({ data: [] }));
    const logins = Array.from({ length: 183 }, (_, i) => `user${String(i)}`);
    await fetchTwitchLiveStreams(logins, {
      tokens: fakeTokens().source,
      clientId: 'cid',
      fetchImpl: fake.fetchImpl,
    });

    assert.equal(fake.calls.length, 2, '183 / 100 ⇒ 2 批（多切或少切都会让若干行永远不更新）');
    assert.equal(repeated(fake.calls[0]?.url ?? '', 'user_login').length, TWITCH_LOGIN_BATCH);
    assert.equal(repeated(fake.calls[1]?.url ?? '', 'user_login').length, 83);
    for (const call of fake.calls) {
      assert.ok(
        repeated(call.url, 'user_login').length <= 100,
        '每一批都必须 ≤100 —— 实测 101 个当场 HTTP 400',
      );
    }
  });

  it('★ 上游真的回 101 个时那个 400 是 `bad_response`（不是 unavailable）', async () => {
    /*
     * 生产服务器上的**实测原文**（`.cache/videos-live-round/probe-twitch-streams.out.txt`）：
     *   HTTP 400 {"error":"Bad Request","status":400,
     *             "message":"The parameter \"user_login\" was malformed: the value must be less than or equal to 100"}
     * 这一档必须与"上游抖了"分开：它是**我们要改代码**，重试永远不会好。
     */
    const fake = fakeFetch(() =>
      json(
        {
          error: 'Bad Request',
          status: 400,
          message:
            'The parameter "user_login" was malformed: the value must be less than or equal to 100',
        },
        400,
      ),
    );
    const outcome = await fetchTwitchLiveStreams(['a'], {
      tokens: fakeTokens().source,
      clientId: 'cid',
      fetchImpl: fake.fetchImpl,
    });
    assert.deepEqual(outcome.answered, []);
    assert.equal(outcome.failures.length, 1);
    assert.equal(outcome.failures[0]?.kind, 'bad_response');
    assert.match(outcome.failures[0]?.detail ?? '', /less than or equal to 100/);
  });

  it('401 ⇒ handshake（整条 Twitch 放弃）；429 / 5xx ⇒ unavailable（下一轮再来）', async () => {
    for (const [status, kind] of [
      [401, 'handshake'],
      [403, 'handshake'],
      [429, 'unavailable'],
      [500, 'unavailable'],
      [503, 'unavailable'],
    ] as const) {
      const fake = fakeFetch(() => json({ error: 'x' }, status));
      const outcome = await fetchTwitchLiveStreams(['a', 'b'], {
        tokens: fakeTokens().source,
        clientId: 'cid',
        fetchImpl: fake.fetchImpl,
      });
      assert.equal(outcome.failures[0]?.kind, kind, `HTTP ${String(status)} 的档位`);
      assert.equal(outcome.answered.length, 0);
      assert.equal(outcome.failures.length, 1, '一次故障**一条**失败（不是每个 login 一条）');
      assert.equal(outcome.failures[0]?.logins.length, 2, '那一批有几个 login 要能看出来');
    }
  });

  it('响应不是 JSON / data 不是数组 ⇒ bad_response（当成空列表会把所有人标成不在播）', async () => {
    const notJson = fakeFetch(() => new Response('<html>502</html>', { status: 200 }));
    const a = await fetchTwitchLiveStreams(['a'], {
      tokens: fakeTokens().source,
      clientId: 'cid',
      fetchImpl: notJson.fetchImpl,
    });
    assert.equal(a.failures[0]?.kind, 'bad_response');

    const noData = fakeFetch(() => json({ streams: [] }));
    const b = await fetchTwitchLiveStreams(['a'], {
      tokens: fakeTokens().source,
      clientId: 'cid',
      fetchImpl: noData.fetchImpl,
    });
    assert.equal(b.failures[0]?.kind, 'bad_response');
    assert.match(b.failures[0]?.detail ?? '', /data/);
  });

  it('★ viewer_count：0 是 0，非数字/缺失是 null（**绝不把"没给"写成 0**）', async () => {
    const fake = fakeFetch(() =>
      json({
        data: [
          { user_login: 'zero', viewer_count: 0, type: 'live' },
          { user_login: 'many', viewer_count: 105955, type: 'live' },
          { user_login: 'none', viewer_count: null, type: 'live' },
          { user_login: 'text', viewer_count: '42', type: 'live' },
        ],
      }),
    );
    const outcome = await fetchTwitchLiveStreams(['zero', 'many', 'none', 'text'], {
      tokens: fakeTokens().source,
      clientId: 'cid',
      fetchImpl: fake.fetchImpl,
    });
    assert.deepEqual(
      outcome.answered[0]?.live,
      [
        { login: 'zero', viewerCount: 0 },
        { login: 'many', viewerCount: 105955 },
        { login: 'none', viewerCount: null },
        { login: 'text', viewerCount: null },
      ],
      '0 保留成 0（上游真的说了 0）；"没给"是 null',
    );
  });

  it('换 token 失败 ⇒ 一批都不发（不发请求也是一种断言：fetch 调用 0 次）', async () => {
    const fake = fakeFetch(() => json({ data: [] }));
    const outcome = await fetchTwitchLiveStreams(['a'], {
      tokens: { get: async () => Promise.reject(new Error('PlatformHandshakeError: 没有凭据')) },
      clientId: 'cid',
      fetchImpl: fake.fetchImpl,
    });
    assert.equal(fake.calls.length, 0, '换不到 token 就不该发请求');
    assert.equal(outcome.failures[0]?.kind, 'handshake');
    assert.match(outcome.failures[0]?.detail ?? '', /PlatformHandshakeError/);
  });

  it('★ 换 token 那一步的档位按**错误类型**分：打不出去是 unavailable，凭据不对才是 handshake', async () => {
    const { PlatformHandshakeError, PlatformUnavailableError } = await import('./tracking/types');
    const netDown = await fetchTwitchLiveStreams(['a'], {
      tokens: {
        get: async () =>
          Promise.reject(new PlatformUnavailableError('twitch', 'oauth2/token', 'fetch failed')),
      },
      clientId: 'cid',
      fetchImpl: fakeFetch(() => json({ data: [] })).fetchImpl,
    });
    assert.equal(
      netDown.failures[0]?.kind,
      'unavailable',
      '网络/超时不是"凭据不对"—— 记成 handshake 会让运维去查一个没问题的密钥',
    );

    const badCreds = await fetchTwitchLiveStreams(['a'], {
      tokens: {
        get: async () =>
          Promise.reject(new PlatformHandshakeError('twitch', 'oauth2/token', 'HTTP 401')),
      },
      clientId: 'cid',
      fetchImpl: fakeFetch(() => json({ data: [] })).fetchImpl,
    });
    assert.equal(badCreds.failures[0]?.kind, 'handshake');
  });
});

// ===========================================================================
// bilibili：`get_info?room_id=`
// ===========================================================================

describe('★ Bilibili 取数层（get_info?room_id=）', () => {
  it('URL 与浏览器请求头（与 bilibili 适配器**同一套** UA）', async () => {
    const fake = fakeFetch(() => json({ code: 0, data: { live_status: 1, online: 6548 } }));
    await fetchBilibiliLiveRooms(['12017579'], { fetchImpl: fake.fetchImpl });
    assert.equal(
      fake.calls[0]?.url,
      'https://api.live.bilibili.com/room/v1/Room/get_info?room_id=12017579',
      '按**房间号**查（库里 handle 存的是房间号 —— 卡片上那条链接与播放器用的是同一个数）',
    );
    assert.match(fake.calls[0]?.headers['user-agent'] ?? '', /Mozilla\/5\.0/);
    assert.equal(fake.calls[0]?.headers.referer, 'https://www.bilibili.com/');
  });

  it('★ live_status：1 = 在播（带 online）；**0 与 2 都是不在播**（两个都是实测读数）', async () => {
    const fake = fakeFetch((call) => {
      if (call.url.includes('111'))
        return json({ code: 0, data: { live_status: 1, online: 6548 } });
      if (call.url.includes('222')) return json({ code: 0, data: { live_status: 0, online: 0 } });
      return json({ code: 0, data: { live_status: 2, online: 0 } });
    });
    const outcome = await fetchBilibiliLiveRooms(['111', '222', '333'], {
      fetchImpl: fake.fetchImpl,
    });
    assert.deepEqual(outcome.answered, [
      { handle: '111', isLive: true, viewerCount: 6548 },
      { handle: '222', isLive: false, viewerCount: null },
      { handle: '333', isLive: false, viewerCount: null },
    ]);
    assert.equal(outcome.failures.length, 0);
  });

  it('在播但 upstream 没给数字 ⇒ viewer_count 是 null 而不是 0', async () => {
    const fake = fakeFetch(() => json({ code: 0, data: { live_status: 1, online: 'x' } }));
    const outcome = await fetchBilibiliLiveRooms(['111'], { fetchImpl: fake.fetchImpl });
    assert.deepEqual(outcome.answered, [{ handle: '111', isLive: true, viewerCount: null }]);
  });

  it('code=1（未找到该房间，**实测原文**）⇒ 不在播；别的非 0 码（例如 -352）⇒ 这一行不写', async () => {
    const notFound = fakeFetch(() => json({ code: 1, msg: '未找到该房间', data: [] }));
    const a = await fetchBilibiliLiveRooms(['99999999999'], { fetchImpl: notFound.fetchImpl });
    assert.deepEqual(a.answered, [{ handle: '99999999999', isLive: false, viewerCount: null }]);
    assert.equal(a.failures.length, 0);

    const risk = fakeFetch(() => json({ code: -352, msg: '风控校验失败', data: null }));
    const b = await fetchBilibiliLiveRooms(['555'], { fetchImpl: risk.fetchImpl });
    assert.deepEqual(b.answered, [], '风控不是对"这个人"的回答 ⇒ 这一行一个字段都不写');
    assert.equal(b.failures[0]?.kind, 'bad_response');
    assert.match(b.failures[0]?.detail ?? '', /-352/);
  });

  it('发不出去 / 超时 / 5xx ⇒ unavailable；4xx / 坏 JSON ⇒ bad_response', async () => {
    const boom = fakeFetch(() => Promise.reject(new Error('TimeoutError: signal timed out')));
    const a = await fetchBilibiliLiveRooms(['1'], { fetchImpl: boom.fetchImpl });
    assert.equal(a.failures[0]?.kind, 'unavailable');
    assert.match(a.failures[0]?.detail ?? '', /TimeoutError/);

    const server = fakeFetch(() => new Response('oops', { status: 502 }));
    const b = await fetchBilibiliLiveRooms(['1'], { fetchImpl: server.fetchImpl });
    assert.equal(b.failures[0]?.kind, 'unavailable');

    const client = fakeFetch(() => new Response('bad request', { status: 400 }));
    const c = await fetchBilibiliLiveRooms(['1'], { fetchImpl: client.fetchImpl });
    assert.equal(c.failures[0]?.kind, 'bad_response');

    const html = fakeFetch(() => new Response('<html>login</html>', { status: 200 }));
    const d = await fetchBilibiliLiveRooms(['1'], { fetchImpl: html.fetchImpl });
    assert.equal(d.failures[0]?.kind, 'bad_response');
  });

  it('★ 一轮最多问 100 个房间，超出的**报出来**（skipped>0，不是悄悄跳过）', async () => {
    const fake = fakeFetch(() => json({ code: 0, data: { live_status: 1, online: 1 } }));
    const handles = Array.from({ length: BILIBILI_MAX_ROOMS + 5 }, (_, i) => String(1000 + i));
    const outcome = await fetchBilibiliLiveRooms(handles, { fetchImpl: fake.fetchImpl });
    assert.equal(fake.calls.length, BILIBILI_MAX_ROOMS);
    assert.equal(outcome.answered.length, BILIBILI_MAX_ROOMS);
    assert.equal(outcome.skipped, 5, '没问的那 5 行必须可见（日志里会印出来）');
  });

  it('★ 墙钟预算用完就停手（一轮时长有上界），剩下的算 skipped', async () => {
    const fake = fakeFetch(() => json({ code: 0, data: { live_status: 1, online: 1 } }));
    /*
     * 假时钟每次被读就前进 300 ms，预算是 1000 ms：
     *   `startedAt` = 300（第 1 次读）；每一轮开头的检查各读一次（600 / 900 / 1200 …）。
     * ⇒ 前 3 个房间能问，第 4 个开始只剩 skipped。
     * ⚠️ 第一版把每次前进写成 5000 ms，于是**第一个**房间就被判超预算（`answered = 0`），
     *    断言红在"预算生效了"这条上 —— 而真正要测的是"**中途**停手、剩下的算 skipped"。
     */
    let clock = 0;
    const outcome = await fetchBilibiliLiveRooms(['1', '2', '3', '4'], {
      fetchImpl: fake.fetchImpl,
      budgetMs: 1000,
      nowMs: () => {
        clock += 300;
        return clock;
      },
    });
    assert.equal(outcome.answered.length, 3, '预算是 1000 ms、每次读时钟前进 300 ms ⇒ 问 3 个就停');
    assert.equal(outcome.skipped, 1, '没问的那 1 行必须**报出来**');
    assert.equal(fake.calls.length, 3, '停手之后不许再发请求');
  });
});

// ===========================================================================
// 一轮（runOnce / main）
// ===========================================================================

const NOW_SECONDS = 1_789_000_000;

function target(
  id: string,
  platform: LiveStatusTarget['platform'],
  handle: string,
): LiveStatusTarget {
  return { id, platform, handle };
}

interface Recorded {
  updates: LiveStatusUpdate[];
  checkedAt: number[];
}

/** 造一份假依赖；每个用例只覆盖它关心的那几格。 */
function deps(over: Partial<RunDeps> & { targets: LiveStatusTarget[] }): RunDeps & Recorded {
  const recorded: Recorded = { updates: [], checkedAt: [] };
  return {
    listTargets: () => over.targets,
    platformStatus: () => ({ twitch: 'ok', bilibili: 'ok', youtube: 'ok' }),
    fetchTwitch: async () => ({ answered: [], failures: [] }),
    fetchBilibili: async () => ({ answered: [], failures: [], skipped: 0 }),
    apply: (updates, checkedAt) => {
      recorded.updates.push(...updates);
      recorded.checkedAt.push(checkedAt);
      return updates.length;
    },
    nowSeconds: () => NOW_SECONDS,
    ...over,
    ...recorded,
  } as RunDeps & Recorded;
}

describe('★ 一轮：平台之间互不波及', () => {
  it('twitch 答了、bilibili 整条失败 ⇒ **只写 twitch 那些行**，这一轮仍然算成功', async () => {
    const d = deps({
      targets: [target('t1', 'twitch', 'alpha'), target('b1', 'bilibili', '12345')],
      fetchTwitch: async (logins) => ({
        answered: [{ logins: [...logins], live: [{ login: 'alpha', viewerCount: 42 }] }],
        failures: [],
      }),
      fetchBilibili: async () => ({
        answered: [],
        failures: [{ handle: '12345', kind: 'unavailable', detail: 'TimeoutError: x' }],
        skipped: 0,
      }),
    });
    const outcome = await runOnce(d);
    assert.equal(outcome.ok, true, '还有一个平台在工作 ⇒ 这一轮不是失败（用户那半个功能还在）');
    assert.deepEqual(
      d.updates,
      [{ id: 't1', isLive: 1, viewerCount: 42 }],
      'bilibili 那一行**一个字段都不许写** —— 它连 `is_live = 0` 都不许有',
    );
    assert.deepEqual(d.checkedAt, [NOW_SECONDS], '写库时刻是 Unix **秒**（迁移 023 定的）');
    assert.match(outcome.line, /twitch ok（问 1 \/ 在播 1 \/ 写 1）/);
    assert.match(
      outcome.line,
      /bilibili failed（问 0 \/ 在播 0 \/ 写 0；没答 1 行（原值保留：unavailable: TimeoutError: x）/,
    );
  });

  it('★ 两个平台都失败 ⇒ 这一轮失败，而且 **apply 一次都没被调用**', async () => {
    const d = deps({
      targets: [target('t1', 'twitch', 'alpha'), target('b1', 'bilibili', '12345')],
      fetchTwitch: async () => ({
        answered: [],
        failures: [{ logins: ['alpha'], kind: 'unavailable', detail: 'ConnectTimeoutError' }],
      }),
      fetchBilibili: async () => ({
        answered: [],
        failures: [{ handle: '12345', kind: 'unavailable', detail: 'TimeoutError' }],
        skipped: 0,
      }),
    });
    const outcome = await runOnce(d);
    assert.equal(outcome.ok, false);
    assert.deepEqual(
      d.updates,
      [],
      '平台上全失败时，一个字段都不许写（否则一次抖动把所有人标成不在播）',
    );
    assert.match(outcome.line, /twitch failed/);
    assert.match(outcome.line, /bilibili failed/);
    assert.match(outcome.line, /每一个有行要查的平台都失败了/);
  });

  it('★ 只有某一批失败 ⇒ 那一批的行不写，别的批照写（而且两件事都出现在日志里）', async () => {
    const targets = [target('a1', 'twitch', 'alpha'), target('b1', 'twitch', 'beta')];
    const d = deps({
      targets,
      // 真实世界里 183 个 login 会切成两批；这里用假的两批模拟
      fetchTwitch: async () => ({
        answered: [{ logins: ['alpha'], live: [{ login: 'alpha', viewerCount: 7 }] }],
        failures: [{ logins: ['beta'], kind: 'unavailable', detail: 'socket hang up' }],
      }),
    });
    const outcome = await runOnce(d);
    assert.equal(outcome.ok, true);
    assert.deepEqual(d.updates, [{ id: 'a1', isLive: 1, viewerCount: 7 }]);
    assert.match(outcome.line, /twitch ok（问 1 \/ 在播 1 \/ 写 1；没答 1 行/);
    assert.match(outcome.line, /socket hang up/);
  });

  it('上游没返回的 login = **不在播**（is_live 0、人数 NULL），不是"没查过"', async () => {
    const d = deps({
      targets: [target('a1', 'twitch', 'alpha'), target('a2', 'twitch', 'beta')],
      fetchTwitch: async () => ({
        answered: [{ logins: ['alpha', 'beta'], live: [{ login: 'alpha', viewerCount: 3 }] }],
        failures: [],
      }),
    });
    await runOnce(d);
    assert.deepEqual(d.updates, [
      { id: 'a1', isLive: 1, viewerCount: 3 },
      { id: 'a2', isLive: 0, viewerCount: null },
    ]);
  });

  it('同一个 login 有两行（去重键允许） ⇒ 两行都写，而且只问一次', async () => {
    let asked: readonly string[] = [];
    const d = deps({
      targets: [target('a1', 'twitch', 'alpha'), target('a2', 'twitch', 'alpha')],
      fetchTwitch: async (logins) => {
        asked = logins;
        return {
          answered: [{ logins: [...logins], live: [{ login: 'alpha', viewerCount: 9 }] }],
          failures: [],
        };
      },
    });
    const outcome = await runOnce(d);
    assert.deepEqual(
      asked,
      ['alpha'],
      '同一个 login 只问一次（上游按 login 回答，问两遍是白花额度）',
    );
    assert.deepEqual(d.updates, [
      { id: 'a1', isLive: 1, viewerCount: 9 },
      { id: 'a2', isLive: 1, viewerCount: 9 },
    ]);
    assert.match(outcome.line, /问 2 \/ 在播 2 \/ 写 2/);
  });

  it('标识形状不对的行：**一次都不问**，而且报出来（twitch 的非 login / bilibili 的非房间号）', async () => {
    const d = deps({
      targets: [
        target('t1', 'twitch', '有空格 的名字'),
        target('b1', 'bilibili', 'blanc-xyz'),
        target('b2', 'bilibili', '12345'),
      ],
      fetchBilibili: async () => ({
        answered: [{ handle: '12345', isLive: false, viewerCount: null }],
        failures: [],
        skipped: 0,
      }),
    });
    const outcome = await runOnce(d);
    assert.deepEqual(
      d.updates,
      [{ id: 'b2', isLive: 0, viewerCount: null }],
      '形状不对的那两行一个字段都不写',
    );
    assert.match(outcome.line, /twitch ok（问 0 \/ 在播 0 \/ 写 0；查不了 1 行/);
    assert.match(outcome.line, /bilibili ok（问 1 \/ 在播 0 \/ 写 1；查不了 1 行/);
  });

  it('缺凭据 ⇒ twitch 记成**跳过**（不是失败），一行都不写，退出码仍然是 0', async () => {
    const d = deps({
      targets: [target('t1', 'twitch', 'alpha')],
      platformStatus: () => ({ twitch: 'skipped:no-credentials', bilibili: 'ok', youtube: 'ok' }),
    });
    const outcome = await runOnce(d);
    assert.equal(outcome.ok, true, '缺凭据的机器不该每 3 分钟报一次红（与 track.ts 同一口径）');
    assert.deepEqual(d.updates, []);
    assert.match(outcome.line, /twitch 跳过（没有凭据；1 行保持原值）/);
  });

  it('youtube 行永远不进这一轮，而且日志里写着"本轮不查"', async () => {
    const d = deps({ targets: [target('y1', 'youtube', '@Someone')] });
    const outcome = await runOnce(d);
    assert.equal(outcome.ok, true, '没有行要查不算失败');
    assert.deepEqual(d.updates, []);
    assert.match(outcome.line, /youtube 本轮不查（1 行保持"从没查过"）/);
  });

  it('空名单：什么都不做、退出码 0（否则空名单的机器每 3 分钟红一次）', async () => {
    const d = deps({ targets: [] });
    const outcome = await runOnce(d);
    assert.equal(outcome.ok, true);
    assert.equal(d.checkedAt.length, 1, '仍然会调用一次 apply（空数组）—— 它自己会立刻返回 0');
    assert.match(outcome.line, /写入 0 行/);
  });

  it('写库失败 ⇒ 失败行是 `db` 那一档，而且说的是"一行都没写"（事务回滚）', async () => {
    const d = deps({
      targets: [target('t1', 'twitch', 'alpha')],
      fetchTwitch: async () => ({
        answered: [{ logins: ['alpha'], live: [{ login: 'alpha', viewerCount: 1 }] }],
        failures: [],
      }),
      apply: () => {
        throw new Error('database is locked');
      },
    });
    const outcome = await runOnce(d);
    assert.equal(outcome.ok, false);
    assert.match(outcome.line, /本轮失败（db）：database is locked/);
    assert.match(outcome.line, /一行都没写/);
  });
});

describe('★ CLI 壳：退出码', () => {
  it('不认识的参数 ⇒ 2（用法错误），而且**真的什么都没做**', async () => {
    const d = deps({ targets: [target('t1', 'twitch', 'alpha')] });
    assert.equal(await main(['--dry-run'], d), 2);
    assert.equal(d.checkedAt.length, 0, '拒绝参数时一次库都不该碰');
  });

  it('两个平台都失败 ⇒ 1；一半成功 ⇒ 0', async () => {
    const failing = deps({
      targets: [target('t1', 'twitch', 'alpha')],
      fetchTwitch: async () => ({
        answered: [],
        failures: [{ logins: ['alpha'], kind: 'unavailable', detail: 'boom' }],
      }),
    });
    assert.equal(await main([], failing), 1);

    const ok = deps({
      targets: [target('t1', 'twitch', 'alpha')],
      fetchTwitch: async () => ({
        answered: [{ logins: ['alpha'], live: [] }],
        failures: [],
      }),
    });
    assert.equal(await main([], ok), 0);
  });

  it('生产平台的清单就是三个（youtube 在里面只是为了让"本轮不查"说出来）', () => {
    assert.deepEqual([...LIVE_STATUS_PLATFORMS], ['twitch', 'bilibili', 'youtube']);
  });
});

// ===========================================================================
// 端到端：真的写进 `:memory:` 的那张表
// ===========================================================================

describe('★ 端到端（真库、真写入）', () => {
  function insertRow(
    id: string,
    platform: string,
    handle: string,
    opts: {
      isLive?: 0 | 1 | null;
      viewerCount?: number | null;
      liveCheckedAt?: number | null;
    } = {},
  ): void {
    getDb()
      .prepare(
        `INSERT INTO live_channels
           (id, platform, handle, display_name, note, tags, live_video_id, embed_channel,
            sort_order, status, created_at, updated_at, is_live, viewer_count, live_checked_at)
         VALUES (?, ?, ?, ?, NULL, NULL, NULL, 0, 100, 'visible', 0, 0, ?, ?, ?)`,
      )
      .run(
        id,
        platform,
        handle,
        id,
        opts.isLive === undefined ? null : opts.isLive,
        opts.viewerCount === undefined ? null : opts.viewerCount,
        opts.liveCheckedAt === undefined ? null : opts.liveCheckedAt,
      );
  }

  it('答过的行更新、没答的行**原封不动**（连 live_checked_at 都不动）', async () => {
    insertRow('t-live', 'twitch', 'alpha');
    insertRow('t-off', 'twitch', 'beta', { isLive: 1, viewerCount: 999, liveCheckedAt: 111 });
    insertRow('b-fail', 'bilibili', '12345', { isLive: 1, viewerCount: 777, liveCheckedAt: 222 });
    insertRow('y', 'youtube', '@Someone');

    const d = deps({
      targets: [
        target('t-live', 'twitch', 'alpha'),
        target('t-off', 'twitch', 'beta'),
        target('b-fail', 'bilibili', '12345'),
        target('y', 'youtube', '@Someone'),
      ],
      fetchTwitch: async (logins) => ({
        answered: [{ logins: [...logins], live: [{ login: 'alpha', viewerCount: 5000 }] }],
        failures: [],
      }),
      fetchBilibili: async () => ({
        answered: [],
        failures: [{ handle: '12345', kind: 'unavailable', detail: 'boom' }],
        skipped: 0,
      }),
      apply: applyLiveStatus,
    });
    const outcome = await runOnce(d);
    assert.equal(outcome.ok, true);

    const rows = new Map(listLiveChannels().map((channel) => [channel.id, channel]));
    assert.equal(rows.get('t-live')?.isLive, true);
    assert.equal(rows.get('t-live')?.viewerCount, 5000);
    assert.equal(rows.get('t-live')?.liveCheckedAt, NOW_SECONDS);
    assert.equal(rows.get('t-off')?.isLive, false, '上游没返回它就说明它不在播');
    assert.equal(
      rows.get('t-off')?.viewerCount,
      null,
      '不在播 ⇒ 人数 NULL（不是留着上一轮的 999）',
    );
    assert.equal(rows.get('b-fail')?.isLive, true, 'bilibili 那一行**原封不动**');
    assert.equal(rows.get('b-fail')?.viewerCount, 777);
    assert.equal(rows.get('b-fail')?.liveCheckedAt, 222, '连"什么时候查的"都不许动 —— 它没被查过');
    assert.equal(rows.get('y')?.isLive, null, 'youtube 永远是"从没查过"');
  });

  it('`live_checked_at` 写的是**秒**：写进去的就是 nowSeconds 给的那个数（与毫秒差 1000 倍）', async () => {
    insertRow('t', 'twitch', 'alpha');
    const d = deps({
      targets: [target('t', 'twitch', 'alpha')],
      fetchTwitch: async () => ({ answered: [{ logins: ['alpha'], live: [] }], failures: [] }),
      apply: applyLiveStatus,
      nowSeconds: () => 1_700_000_000,
    });
    await runOnce(d);
    const raw = {
      ...(getDb().prepare('SELECT live_checked_at FROM live_channels WHERE id = ?').get('t') as {
        live_checked_at: number;
      }),
    };
    assert.equal(raw.live_checked_at, 1_700_000_000, '秒；万一有人改成毫秒，这里会红');
  });
});
