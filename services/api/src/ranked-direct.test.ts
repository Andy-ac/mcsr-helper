/**
 * Ranked「行内展开 / 搜索玩家」那两条直连路径的测试（`apps/web/src/lib/rankedDirect.ts`）。
 *
 * ---------------------------------------------------------------------------
 * 为什么直连层的测试住在这里（`services/api`）
 * ---------------------------------------------------------------------------
 * `apps/web` **没有测试运行器**（本仓只有这一个：`node --import tsx --test`）⇒
 * 那两个新 fetcher 的 HTTP 层（"上游回 400 的两种 body → 哪一句话"）只能在这里断言。
 * ⚠️ 而且它**必须**被断言：那两档的判据只在响应体里（两种 400 的**状态码完全一样**），
 *    写错了的表现是"用户查一个不存在的玩家，读到的是'稍后再试'"——
 *    界面照常渲染、类型照常过（两边都是 `string`），没有任何门禁看得见。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 本文件**绝不出真实网络**（与 `ranked.test.ts` / `rankedrender.tsx` 同一条纪律）
 * ---------------------------------------------------------------------------
 * 两道保险：
 *   ① `setUpstreamFetchForTests(桩)` 换掉 `rankedDirect` 用的那一个 fetch
 *      （`rankedDirect.ts` 的文件头写着为什么它必须**在调用那一刻现读**）；
 *   ② 最后一个用例把 `globalThis.fetch` 换成**会记账的哨兵**：桩一旦漏复位，
 *      请求就会走到哨兵上并当场抛出 —— 而不是打到用户的生产上游。
 * ⚠️ 桩里还断言"每一次请求都在 `const.ts` 那两个主机上"（本文件因此**不写真实域名**，
 *    与 `ranked-shared.test.ts` 的文件头同一条规矩）。
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { RANKED_UPSTREAM_ALT, RANKED_UPSTREAM_PRIMARY } from '@mcsr/shared/ranked';

const {
  RankedDirectError,
  RankedLookupError,
  fetchRankedMatches,
  fetchRankedUser,
  rankedMatchesPath,
  rankedUserPath,
  setUpstreamFetchForTests,
} = await import('../../../apps/web/src/lib/rankedDirect');

/* ---------------------------------------------------------------------------
 * 桩：记录每一次请求，按 URL 回答
 * ------------------------------------------------------------------------- */

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** 本次用例里发生过的请求。 */
let calls: Call[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** 上游回了一个**不是 JSON** 的东西（网关错误页 —— 实测 400 也有 HTML 那种，findings §6 第 18 行）。 */
function htmlResponse(status: number): Response {
  return new Response('<html><head><title>400 Bad Request</title></head></html>', {
    status,
    headers: { 'content-type': 'text/html' },
  });
}

/**
 * 装上桩并记录请求；用例结束**自动复位**（漏掉的话那一个用例之后的请求会打向真实上游，
 * 而 `rankedDirect.ts` 的注释写着那种失败的样子是"自检全绿、请求照样发出去"）。
 *
 * ⚠️ 每一个碰请求的用例都**必须**先调它：不调就等于真的打上游。
 */
function stubUpstream(
  t: { after: (fn: () => void) => void },
  handler: (url: string) => Response | Promise<Response>,
): void {
  calls = [];
  const impl = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    /*
     * ★ 这一条断言是"测试没有打出真实请求"的**证据**，不是形式：
     *    没有它，一个拼错的路径会被桩安安静静地答上，而真实环境里它 404。
     */
    assert.ok(
      url.startsWith(RANKED_UPSTREAM_PRIMARY) || url.startsWith(RANKED_UPSTREAM_ALT),
      `测试里出现了一个不在约定主机上的请求：${url}`,
    );
    return await handler(url);
  };
  setUpstreamFetchForTests(impl as unknown as typeof globalThis.fetch);
  t.after(() => setUpstreamFetchForTests(null));
}

/** 每一次请求的**路径 + 查询串**（上游域名不进断言 —— 它只在 `const.ts` 里写一次）。 */
function pathsOf(): string[] {
  return calls.map((call) => {
    const url = new URL(call.url);
    return `${url.pathname}${url.search}`;
  });
}

/** 跑一次、把它抛出来的东西交回来（`null` = 没有抛）。比每个用例各写一遍 `.then` 短。 */
async function failureOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return null;
  } catch (error) {
    return error;
  }
}

/** 一个 `RankedDirectError` 的 `reason`（不是那一类时给 `undefined`，好让断言直接红在"种类不对"上）。 */
function directReason(error: unknown): string | undefined {
  return error instanceof RankedDirectError ? error.reason : undefined;
}

/* ---------------------------------------------------------------------------
 * 夹具：**实测**的响应（逐字照 findings，2026-09-17）
 * ------------------------------------------------------------------------- */

/**
 * `GET /users/edcr`（findings §3.1/§3.2 的真实值）。
 * ⚠️ `statistics` 只抄了我们真正要读的那四格 —— 而每个叶子**两个格子都留着**
 *    （`{ranked, casual}`），因为"取哪一个"正是被判据本身。
 */
const USER_FIXTURE = {
  status: 'success',
  data: {
    uuid: '635f35ee69ed4f0c94ff26ece4818956',
    nickname: 'edcr',
    roleType: 1,
    eloRate: 2349,
    eloRank: 1,
    country: 'gb',
    seasonResult: { last: { eloRate: 2349, eloRank: 1 }, highest: 2385, lowest: 1670, phases: [] },
    statistics: {
      season: {
        bestTime: { ranked: 387772, casual: null },
        playedMatches: { ranked: 110, casual: 0 },
        wins: { ranked: 96, casual: 0 },
        loses: { ranked: 14, casual: 0 },
      },
      total: {
        bestTime: { ranked: 353371, casual: null },
        playedMatches: { ranked: 5357, casual: 2 },
        wins: { ranked: 3448, casual: 0 },
        loses: { ranked: 1809, casual: 1 },
      },
    },
  },
};

/** 上游"查无此人"（findings §6 第 5 行，逐字；HTTP **400**，不是 404）。 */
const NOT_EXISTS_BODY = { status: 'error', data: { error: 'User is not exists.' } };

/** 上游"昵称不合法"（findings §6 第 9 行，逐字；实测边界：标识符 > 20 个字符）。 */
const BAD_IDENTIFIER_BODY = {
  status: 'error',
  data: { params: { identifier: ['Invalid user identifier'] } },
};

/**
 * `/users/{id}/matches` 的一行（findings §2.1 第一行**逐字**，这场比赛是私人房 type 3：
 * `changes` 与 `vod` 都是空数组、`seed.endTowers` 是 **`null`** 而不是 `[]`、两个 `*Type` 是 null）。
 */
const MATCH_ROW = {
  id: 13304815,
  type: 3,
  seed: { id: null, overworld: null, nether: null, endTowers: null, variations: [] },
  category: 'ANY',
  gameMode: 'default',
  players: [
    {
      uuid: '635f35ee69ed4f0c94ff26ece4818956',
      nickname: 'edcr',
      roleType: 1,
      eloRate: 2349,
      eloRank: 1,
      country: 'gb',
    },
    {
      uuid: '410e5776b03a424d8740557bac2d9014',
      nickname: 'lauveer',
      roleType: 1,
      eloRate: 1637,
      eloRank: 199,
      country: 'ci',
    },
  ],
  result: { uuid: '635f35ee69ed4f0c94ff26ece4818956', time: 515686 },
  forfeited: false,
  vod: [],
  changes: [],
  season: 12,
  date: 1789242779,
  seedType: null,
  bastionType: null,
};

/* ---------------------------------------------------------------------------
 * 路径函数（纯函数，直接断言字符串）
 * ------------------------------------------------------------------------- */

describe('两个路径函数：`encodeURIComponent`，不是表单编码', () => {
  it('★ 普通昵称', () => {
    assert.equal(rankedUserPath('edcr'), '/users/edcr');
    assert.equal(rankedMatchesPath('edcr', 10), '/users/edcr/matches?count=10');
  });

  it('★★ 空格必须是 `%20`（`+` 上游**不**解成空格：实测 `[Ranked Bot]` 只认 `%20`）', () => {
    /*
     * ⚠️★ 这一条就是那个坑的判据（findings §1.1 的实测表）：
     *    `/users/%5BRanked%20Bot%5D` ⇒ **200**；`/users/%5BRanked+Bot%5D` ⇒ 400「User is not exists.」。
     *    换成 `URLSearchParams`（或任何表单编码）的实现在这里**当场红**，
     *    而它的线上表现是"唯一那个名字里带空格的玩家永远查不到 + 界面说他不存在"——
     *    一句**假话**：他确实存在，只是我们问错了写法。
     */
    assert.equal(rankedUserPath('[Ranked Bot]'), '/users/%5BRanked%20Bot%5D');
    assert.ok(
      !rankedUserPath('[Ranked Bot]').includes('+'),
      '★★ `+` 在这里是**另一个昵称**（上游把它当普通字符，不当空格）',
    );
    // `matches` 那一半走同一个编码（两条路径拼的是同一段昵称）
    assert.equal(
      rankedMatchesPath('[Ranked Bot]', 10),
      '/users/%5BRanked%20Bot%5D/matches?count=10',
    );
  });

  it('★ 大小写原样送进去（我们不做任何规范化），斜杠编成 `%2F`', () => {
    /*
     * ⚠️ 上游的查询是"精确匹配、大小写不敏感"（findings §6）：`/users/EDCR` 与 `/users/edcr`
     *    回同一份数据。我们**不**在客户端转小写 —— 那不是我们的判据，
     *    而规范化会把 `[Ranked Bot]` 这种名字改掉（去掉方括号就查不到）。
     */
    assert.equal(rankedUserPath('EDCR'), '/users/EDCR');
    // ⚠️ 昵称里的 `/` 编成 `%2F`：上游对 `q%2F` 回的是"查无此人"，**不会**把它当第二段路径
    assert.equal(rankedUserPath('a/b'), '/users/a%2Fb');
  });

  it('★ `count` 原样拼进去（**不夹**到 1..100）', () => {
    /*
     * ⚠️ 夹数会造出一个"看起来成功"的错：调用方以为请求了 500 条、拿到的却是 100 条。
     *    越界由上游的 400 说话（findings §1.2：`0`/`101`/`abc` 全是 400），
     *    而那一路落进 `http`（那句话里带着**真的**状态码）。
     */
    assert.equal(rankedMatchesPath('edcr', 100), '/users/edcr/matches?count=100');
    assert.equal(rankedMatchesPath('edcr', 500), '/users/edcr/matches?count=500');
  });
});

/* ---------------------------------------------------------------------------
 * `fetchRankedUser`：200 / 两种 400 / 别的失败
 * ------------------------------------------------------------------------- */

describe('fetchRankedUser：200 ⇒ 详情', () => {
  it('★ 正常：读得出汇总，`nickname` 用的是**响应里的规范写法**', async (t) => {
    stubUpstream(t, () => jsonResponse(USER_FIXTURE));
    const detail = await fetchRankedUser('EDCR');
    /*
     * ⚠️★ 查的是 `EDCR`，回来的 `nickname` 必须是 `edcr`（上游回规范写法，实测 §6 末段）
     *    ⇒ 搜索框标题里显示的是这个字段，而不是用户敲进去的那串大小写。
     */
    assert.equal(detail.nickname, 'edcr');
    assert.equal(detail.uuid, '635f35ee69ed4f0c94ff26ece4818956');
    assert.equal(detail.eloRate, 2349);
    assert.equal(detail.eloRank, 1);
    assert.equal(detail.season.wins, 96);
    assert.equal(detail.season.loses, 14);
    assert.equal(detail.total.playedMatches, 5357);
    assert.equal(detail.season.bestTimeMs, 387772, '★ 毫秒（上游给的就是毫秒）');
    assert.deepEqual(pathsOf(), ['/users/EDCR'], '★ 一次请求，路径里是用户敲的那个写法');
  });

  it('★ 请求走的是既有的那条路（冻结的四个选项 + `signal` 透传）', async (t) => {
    /*
     * ⚠️★ 这一条是本栏最容易犯、也最难从画面上看出来的错（spec §10 第 2 条）：
     *    `cache: 'no-store'` 不是优化 —— 上游回 `cache-control: max-age=14400`（**4 小时**），
     *    少了它，第二次"点开"可能**根本不发出去**（抽屉冻在 4 小时前那一份上，
     *    而 DevTools 的网络面板里一条请求都没有）。
     *    ⚠️ 这件事只在**函数被调用时**成立：产物里一个字都看不出来。
     */
    stubUpstream(t, () => jsonResponse(USER_FIXTURE));
    const controller = new AbortController();
    await fetchRankedUser('edcr', controller.signal);
    const init = calls[0]?.init;
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.referrerPolicy, 'no-referrer');
    assert.deepEqual(init?.headers, { accept: 'application/json' }, '★ 只带 CORS 安全列表里的头');
    assert.equal(
      init?.signal,
      controller.signal,
      '★ `signal` 照既有 fetcher 的写法透传（换行/收起/卸载要能取消）',
    );
  });
});

describe('fetchRankedUser：400 的**两种** body 各自成一类', () => {
  it('★★ `data.error` ⇒ `not_found`（**不是** 404、**不是**"上游回了个错误"）', async (t) => {
    stubUpstream(t, () => jsonResponse(NOT_EXISTS_BODY, 400));
    const error = await failureOf(() => fetchRankedUser('nosuchplayerxyz'));
    assert.ok(error instanceof RankedLookupError, '必须是**可分辨**的那一族错误');
    assert.equal(error.kind, 'not_found');
    assert.equal(error.name, 'RankedLookupError');
    /*
     * ★★ 它不是 `RankedDirectError`：那一族的每一档在界面上都说"重试可能有用"，
     *    而"这个人不存在"重试一百次也是同一个答案（那一句由 `ranked.lookupNotFound` 说，
     *    渲染在搜索框下面的 `.ranked__lookup` 里，**不是**面板顶上那句失败提示）。
     */
    assert.ok(!(error instanceof RankedDirectError), '★★ 不许落进"上游回了个错误"那一族');
    assert.deepEqual(
      pathsOf(),
      ['/users/nosuchplayerxyz'],
      '★ 4xx **不重试**（换入口只会得到同一个答案，还白花一次额度）',
    );
  });

  it('★★ `params.identifier` ⇒ `invalid_identifier`（实测：标识符超过 20 个字符）', async (t) => {
    stubUpstream(t, () => jsonResponse(BAD_IDENTIFIER_BODY, 400));
    const error = await failureOf(() => fetchRankedUser('zzzz_no_such_player_9931'));
    assert.ok(error instanceof RankedLookupError);
    assert.equal(
      error.kind,
      'invalid_identifier',
      '★ 两种 400 的状态码**完全一样**，分得开它们的只有响应体 —— 这一条就是那个判据',
    );
  });

  it('★★ 认不出来的 400（HTML 错误页）⇒ 走既有的 `http`，**不编**一句"没有这个玩家"', async (t) => {
    /*
     * ⚠️★ 实测真会发生：`/users/q%00` 回的 400 是 **Cloudflare 的 HTML** 而不是 JSON（findings §6）。
     *    那时"没有这个玩家"是一句我们**并不知道**的话 ⇒ 交给 `http`（那句话里带着真的 400）。
     */
    stubUpstream(t, () => htmlResponse(400));
    const error = await failureOf(() => fetchRankedUser('edcr'));
    assert.ok(error instanceof RankedDirectError);
    assert.ok(!(error instanceof RankedLookupError), '认不出来的响应体不许被套上那两句话');
    assert.equal(error.reason, 'http');
    assert.equal(error.status, 400);
  });

  it('★ 认不出来的 JSON 400（别的字段）⇒ 同样走 `http`', async (t) => {
    stubUpstream(t, () =>
      jsonResponse({ status: 'error', data: { query: { count: ['nope'] } } }, 400),
    );
    assert.equal(directReason(await failureOf(() => fetchRankedUser('edcr'))), 'http');
  });

  it('★★ 读 400 的响应体时被取消 ⇒ **原样抛**（不许变成"上游回了一个错误"）', async (t) => {
    /*
     * ⚠️ 容器在换行/收起时会 abort，而 abort 会**同时中止读取** —— 那次中断不是上游的错。
     *    翻成 `http` 的话，用户切一下标签页就会看到"上游回了一个错误（HTTP 400）"，
     *    而真相是**我们自己**取消的。
     */
    const aborted = {
      ok: false,
      status: 400,
      json: async () => {
        throw new DOMException('aborted', 'AbortError');
      },
    } as unknown as Response;
    stubUpstream(t, () => aborted);
    const error = await failureOf(() => fetchRankedUser('edcr'));
    assert.ok(error instanceof DOMException);
    assert.equal(error.name, 'AbortError');
  });
});

describe('fetchRankedUser：别的失败走既有的那几档', () => {
  it('★ 500 ⇒ `http`（带着那个状态码）', async (t) => {
    stubUpstream(t, () => htmlResponse(500));
    const error = await failureOf(() => fetchRankedUser('edcr'));
    assert.ok(error instanceof RankedDirectError);
    assert.equal(error.reason, 'http');
    assert.equal(error.status, 500);
  });

  it('★ 两个入口都连不上 ⇒ `network`（**只**在网络层失败时换入口，且只换一次）', async (t) => {
    stubUpstream(t, () => {
      throw new TypeError('fetch failed');
    });
    assert.equal(directReason(await failureOf(() => fetchRankedUser('edcr'))), 'network');
    assert.equal(calls.length, 2, '★ 网络层失败 ⇒ 换兜底入口重试**一次**（spec §5.2）');
    assert.ok(calls[0]?.url.startsWith(RANKED_UPSTREAM_PRIMARY), '★ 第一次是主入口');
    assert.ok(calls[1]?.url.startsWith(RANKED_UPSTREAM_ALT), '★ 第二次是兜底入口');
    /*
     * ⚠️ 两次是**同一个路径**、**两个主机** —— 兜底入口那个主机自己带着 `/api` 前缀
     *    （`const.ts` 的 `RANKED_UPSTREAM_ALT`），所以这里比的是"结尾那段路径相同"，
     *    不是"两个 URL 逐字相同"（那会是一条永远红的断言）。
     */
    assert.ok(
      calls[0]?.url.endsWith('/users/edcr') && calls[1]?.url.endsWith('/users/edcr'),
      '★ 两次打的是同一条路径（换的只是主机）',
    );
    assert.notEqual(calls[0]?.url, calls[1]?.url, '★ 两次确实是两个不同的地址');
  });

  it('★★ 200 但形状不对 ⇒ `bad_response`（**不是**"没有这个玩家"）', async (t) => {
    stubUpstream(t, () => jsonResponse({ status: 'success', data: { eloRate: 2349 } }));
    assert.equal(directReason(await failureOf(() => fetchRankedUser('edcr'))), 'bad_response');
  });

  it('★ 200 但响应体不是 JSON ⇒ `bad_response`', async (t) => {
    stubUpstream(t, () => new Response('<html>gateway</html>', { status: 200 }));
    assert.equal(directReason(await failureOf(() => fetchRankedUser('edcr'))), 'bad_response');
  });

  it('★★ 读 200 的响应体时被取消 ⇒ 原样抛（`AbortError` 不是失败）', async (t) => {
    const aborted = {
      ok: true,
      status: 200,
      json: async () => {
        throw new DOMException('aborted', 'AbortError');
      },
    } as unknown as Response;
    stubUpstream(t, () => aborted);
    const error = await failureOf(() => fetchRankedUser('edcr'));
    assert.equal((error as { name?: string } | null)?.name, 'AbortError');
    assert.ok(!(error instanceof RankedDirectError), '★ 取消不是"上游返回的数据看不懂"');
  });
});

/* ---------------------------------------------------------------------------
 * `fetchRankedMatches`
 * ------------------------------------------------------------------------- */

describe('fetchRankedMatches：200 ⇒ 比赛数组', () => {
  it('★ 正常：解析出数组，路径带着调用点给的 `count`', async (t) => {
    stubUpstream(t, () => jsonResponse({ status: 'success', data: [MATCH_ROW] }));
    const matches = await fetchRankedMatches('edcr', 10);
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.id, 13304815);
    assert.equal(matches[0]?.result.time, 515686, '★ `result.time` 是**毫秒**');
    assert.deepEqual(matches[0]?.changes, [], '★ 私人房的 `changes` 实测是空数组（保留成空数组）');
    assert.deepEqual(pathsOf(), ['/users/edcr/matches?count=10']);
  });

  it('★★ 空数组**不是**失败（上游对空结果是 200 + `data: []`）', async (t) => {
    stubUpstream(t, () => jsonResponse({ status: 'success', data: [] }));
    assert.deepEqual(await fetchRankedMatches('edcr', 10), []);
  });

  it('★ 冻结的选项与 `signal` 透传（与另一个 fetcher 同一条）', async (t) => {
    stubUpstream(t, () => jsonResponse({ status: 'success', data: [] }));
    const controller = new AbortController();
    await fetchRankedMatches('edcr', 10, controller.signal);
    assert.equal(calls[0]?.init?.signal, controller.signal);
    assert.equal(calls[0]?.init?.cache, 'no-store');
    assert.equal(calls[0]?.init?.referrerPolicy, 'no-referrer');
    assert.deepEqual(calls[0]?.init?.headers, { accept: 'application/json' });
  });

  it('★★ 200 但 `data` 不是数组 ⇒ `bad_response`（**不是**"他最近没有比赛"）', async (t) => {
    /*
     * ⚠️★ "读不到"与"没有比赛"在这一格是两句话：合成一句会让用户以为这位玩家真的没打过，
     *    而真相是我们读不懂上游给的东西（空数组才是"没有比赛"，上游的实测形状是 `data: []`）。
     */
    stubUpstream(t, () => jsonResponse({ status: 'success', data: { matches: [] } }));
    const error = await failureOf(() => fetchRankedMatches('edcr', 10));
    assert.ok(error instanceof RankedDirectError);
    assert.equal(error.reason, 'bad_response');
  });

  it('★ `status` 不是 success ⇒ `bad_response`', async (t) => {
    stubUpstream(t, () => jsonResponse({ status: 'error', data: [] }));
    assert.equal(
      directReason(await failureOf(() => fetchRankedMatches('edcr', 10))),
      'bad_response',
    );
  });

  it('★ 500 ⇒ `http`', async (t) => {
    stubUpstream(t, () => htmlResponse(500));
    assert.equal(directReason(await failureOf(() => fetchRankedMatches('edcr', 10))), 'http');
  });

  it('★ 200 但响应体不是 JSON ⇒ `bad_response`', async (t) => {
    stubUpstream(t, () => new Response('not json', { status: 200 }));
    assert.equal(
      directReason(await failureOf(() => fetchRankedMatches('edcr', 10))),
      'bad_response',
    );
  });
});

/* ---------------------------------------------------------------------------
 * ★★ 值班的哨兵：本文件"绝不出真实网络"那句话的**证据**
 * ------------------------------------------------------------------------- */

/*
 * ⚠️★ 这一节原来还有两圈**源码层的表断言**（`RANKED_LOOKUP_ERROR_KEYS` 的两条映射 ×
 *    两份字典；以及"两族不许重名"的探针），**2026-09-19 修复轮（T4）连表一起删掉了**：
 *    那张表与 `describeRankedError` 里对应的一支**没有任何生产调用者**
 *    （渲染点在 `.ranked__lookup` 里的 `lookupNotFound` / `lookupInvalid`）。
 *    ⚠️ 别把删掉的那两圈读成"少了两条守卫"：**`RANKED_ERROR_KEYS` 那七格一圈都没少** ——
 *    它由渲染自检 ⑥b 用 `deepEqual` 逐格断言、七条 key 照样在两份字典里逐条查存在性
 *    （`apps/web/scripts/rankedrender.tsx`），那才是"表里的数据不再是 `t('…')` 调用点"
 *    这条处境的守卫。
 */

describe('★ 值班的哨兵', () => {
  it('★★ 桩漏复位时**任何**真实请求都会被记账并抛出', async (t) => {
    /*
     * ⚠️★ 这一条就是"本文件绝不出真实网络"那句话的证据（文件头第②道保险）：
     *    复位之后 `upstreamFetch` 是 `null` ⇒ 下一次调用会走 `globalThis.fetch`。
     *    这里把它临时换成一个会记账的哨兵，确认那**确实**是发送路径。
     *    （哨兵用 `t.mock.method` 装，用例结束自动还原 —— 与 `ranked.test.ts` 同一条写法。）
     */
    setUpstreamFetchForTests(null);
    let leaked = 0;
    t.mock.method(globalThis, 'fetch', (() => {
      leaked += 1;
      throw new Error('★★ 测试里不许发真实网络请求');
    }) as unknown as typeof globalThis.fetch);
    const error = await failureOf(() => fetchRankedUser('edcr'));
    assert.equal(leaked, 2, '★ 桩已复位 ⇒ 主入口与兜底入口各走一次**真的** fetch（都被哨兵拦下）');
    assert.equal(
      directReason(error),
      'network',
      '★ 哨兵抛的异常按网络层失败处理（这一条同时证明 `network` 那一支是活的）',
    );
  });
});

/* 复位兜底：任何用例漏复位时这里收尾（哨兵那一环只在它自己的用例内生效）。 */
before(() => setUpstreamFetchForTests(null));
after(() => setUpstreamFetchForTests(null));
