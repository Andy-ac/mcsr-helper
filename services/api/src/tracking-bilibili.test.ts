/**
 * bilibili 适配器 + 适配器注册表的**逐值契约**（spec §2.1 / §2.3 / §2.4 / §5.1 / §5.4）。
 *
 * ===========================================================================
 * ★★ 本文件里最重要的那一条
 * ===========================================================================
 * `code=0` 但 `vlist=[]`，而这个 UP **还有**数据（spec §2.4 实测：pn=5/6 都空，
 * 而那个 UP 有 124 条）。没有异常、没有非 200、没有非零 code —— 把它读成"到底了"
 * 就**静默少存 24 条**，而所有错误处理都不会响。
 * ⇒ 判据是"`vlist.length < ps` **且** 已存条数 >= `page.count`"，
 *   而本文件要把它**逐条钉住**，并且**再钉一次"`fetchPage` 真的用了它"** ——
 *   一个写对但没被调用的纯函数和没写是一样的，所以那两条断言是分开的：
 *   `bilibiliReachedEnd` 那一组管判据，`fetchPage` 那一组管接线。
 *
 * ===========================================================================
 * 为什么这个文件里所有的网络都是假的
 * ===========================================================================
 * 本仓每一套测试都是离线的，而这一层**真打出去**的代价不只"慢"：bilibili 的
 * 风控是**概率性**的（spec §2.3：同一批请求 13 成 / 7 败，放慢到 1.5 秒没改善），
 * 一个会真发请求的测试会产生**随机红**，而随机红的下场通常是被人加一个 `skip`。
 * ⇒ 所有网络都走 `createBilibiliAdapter({ fetchImpl, sleep })` 注入的假实现
 *   （`sleep` 也必须注入：那三条 10 秒退避会让测试真等 30 秒）。
 *
 * ===========================================================================
 * ★ 「加一个博主」的请求预算是 3 个：2 次握手 + 1 次 `ps=1` 的 `arc/search`
 * ===========================================================================
 * `displayName` 不许是 `mid <id>` 占位（spec §5.1 的裁决，2026-09-16）⇒ 名字从
 * `arc/search` 第一条的 `author` 里取，而那是**一次性**的（加一个博主一次，
 * 不是每轮同步）。这条"多发一次请求"在这里是**数出来的**（`h.calls.length === 3`、
 * `ps === '1'`），不是写在散文里的；回落（空 `vlist` / `author` 缺失或空白）
 * 与失败分类（`-412` 重试、`-352` 不重试）各自也有断言。
 *
 * ===========================================================================
 * 那些"外部锚"是怎么来的（免得下一个人以为是抄自己的代码）
 * ===========================================================================
 * · `MIXIN_KEY` 那 32 个字符：由 `docs/platform-api-feasibility-notes.md:763-765` 里
 *   实测到的那对 `img_url` / `sub_url` 推出来，而它与公开实现（`bilibili-API-collect`
 *   的 WBI 文档、以及 `stracker` 那份 Python 实现）里逐字给出的示例值一致。
 *   ⚠️ 本仓上一轮探针记下的那个 `w_rid=6465d4b8…`（同文件 `:773`）**不能**当锚：
 *      它只有把重排后的 **64** 个字符整串当 mixinKey 才算得出来，而 spec §2.1 与
 *      公开实现都是 `[:32]` —— 那行观测抄的是探针自己的实现（而它当时回的是 412）。
 *      拿它当期望值就是把一个 bug 钉进测试。
 * · `QUERY_A` / `WRID_A` 与 `QUERY_B` / `WRID_B`：参数串是**手写死的字面量**
 *   （不是调用被测代码生成的），md5 用 `node:crypto` 现算 —— 所以这两组断言
 *   是不循环的：被测代码算出的 md5 必须等于"另一条路"算出的同一个 md5。
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { adapterFor, platformStatus } from './tracking';
import {
  BILIBILI_MIXIN_KEY_TABLE,
  BILIBILI_PAGE_SIZE,
  BilibiliRateLimitError,
  BilibiliRejectedError,
  bilibiliAdapter,
  bilibiliReachedEnd,
  createBilibiliAdapter,
  deriveMixinKey,
  signWbiQuery,
} from './tracking/bilibili';
import {
  type AdapterCreator,
  InvalidCreatorInputError,
  NoCredentialsError,
  PlatformHandshakeError,
  PlatformUnavailableError,
} from './tracking/types';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

/** 所有用例共用的"现在"。⚠️ 固定值：`wts` 进签名，签名要能逐字断言。 */
const NOW_MS = 1_788_600_000_000;
const NOW_SEC = NOW_MS / 1000;

/** 实测到的那对 WBI 密钥（`docs/platform-api-feasibility-notes.md:763`）。 */
const IMG_URL = 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png';
const SUB_URL = 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png';
/** ⇒ 由上面两个推出来的 mixinKey。公开实现里逐字给的就是这个值。 */
const MIXIN_KEY = 'ea1db124af3c7062474693fa704f4ff8';

const BUVID3 = 'A1B2C3D4-0000-1111-2222-333344445555infoc';
const BUVID4 = 'E5F6A7B8-6666-7777-8888-9999AAAABBBBinfoc';
const MID = '703007996';

/** 真实形状的一条 `vlist` 条目（spec §2.2 的样例，字段一个不少）。 */
const ITEM = {
  bvid: 'BV1wHtm6rEK3',
  title: '你有发现今天的我跟过去哪里不一样么？',
  created: 1_788_594_186,
  length: '01:51',
  play: 59_997,
  comment: 1198,
  pic: 'http://i1.hdslb.com/bfs/archive/c4e0d891ff00b445c686d84e0a2a.jpg',
  description: '简介',
  author: '某UP',
  mid: 703_007_996,
  typeid: 1,
};

/**
 * `fetchPage` 的入参（`AdapterCreator`）。
 *
 * ⚠️ 类型从 `TrackedCreator` 换成 `AdapterCreator` 是 **T8 那处契约修订**的连带改动
 *    （`types.ts` 里 `AdapterCreator` 那段）：适配器收的是**同步那条路上的** creator，
 *    它比对外形状多一个 `platformMeta`。bilibili 一眼都不看那一格（它没有平台小东西，
 *    `resolveCreator` 不填、库里存 `NULL`，读出来归一化成 `{}`），
 *    但夹具必须交出**运行时会真的递过来**的那个形状 —— 否则这几百行测试断言的是一张
 *    "适配器永远收不到"的入参。
 */
function creator(overrides: Partial<AdapterCreator> = {}): AdapterCreator {
  return {
    id: 'tc-1',
    platform: 'bilibili',
    externalId: MID,
    handle: MID,
    displayName: `mid ${MID}`,
    avatarUrl: null,
    backfillDone: false,
    lastSyncedAt: null,
    lastError: null,
    consecutiveFailures: 0,
    enabled: true,
    videoCount: 0,
    // ⚠️ `TrackedCreator` 的必填格（迁移 021 那一轮加的）。夹具补 0 —— 适配器一眼都不看它
    hiddenCount: 0,
    // ⚠️ 同一条：迁移 022 加的冷却死线。`null` = 不在冷却里，而适配器同样一眼都不看它
    //    （冷却这件事决定的是"要不要调适配器"，那是 `pickDueCreators` 的事）
    cooldownUntil: null,
    createdAt: NOW_SEC,
    // ★ 库里 bilibili 这一列是 `NULL` → `parsePlatformMeta` 读成 `{}`（与 Twitch 那边同一条理由）
    platformMeta: {},
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function htmlResponse(text: string, status = 200): Response {
  return new Response(text, { status, headers: { 'content-type': 'text/html' } });
}

/**
 * 造一个"跟了重定向"的响应。
 *
 * ⚠️ `Response.url` 是**只读**的，而且只有真 `fetch` 会填它（`new Response()` 给的是 `''`），
 *    所以 b23 那条路只能用一个最小替身 —— 被测代码只用 `status` / `url`。
 */
function redirectedTo(finalUrl: string): Response {
  return {
    status: 200,
    ok: true,
    url: finalUrl,
    headers: new Headers(),
    text: async () => '',
  } as unknown as Response;
}

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

interface Harness {
  adapter: ReturnType<typeof createBilibiliAdapter>;
  /** 发出去的每一个请求（顺序即先后）。 */
  calls: FetchCall[];
  /** 每一次退避（毫秒），用来断言"等了 10 秒、等了 3 次"。 */
  sleeps: number[];
  /**
   * spec §5.1 那条痕迹（"已存行数与 `page.count` 不一致"）收到的每一行。
   *
   * ⚠️ 注入收集器而不是让默认的 `console.warn` 打到测试输出上：这条要求的**另一半**
   *    是"什么时候**不**写"（回填途中的满页天然不一致，写它就是把真信号淹掉），
   *    而那只有能数行数才断言得了。
   */
  warns: string[];
  /** 只数列表请求（`arc/search`），握手那两个不算。 */
  listCalls: () => FetchCall[];
}

/**
 * 一个假的 bilibili：默认握手成功（spi 给 buvid，nav 回**未登录**的 `-101`
 * 但带 WBI 密钥 —— 那是实测的形状），列表请求交给 `onList`。
 */
function harness(
  onList?: (call: FetchCall, listIndex: number) => Response | Promise<Response>,
): Harness {
  const calls: FetchCall[] = [];
  const sleeps: number[] = [];
  const warns: string[] = [];

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    calls.push({ url, init });

    if (url.includes('/x/frontend/finger/spi')) {
      return jsonResponse({ code: 0, message: 'ok', data: { b_3: BUVID3, b_4: BUVID4 } });
    }
    if (url.includes('/x/web-interface/nav')) {
      // ⚠️ 未登录的真形状：`code: -101`，而 WBI 密钥照样在（spec §2.1 第 ② 步实测）。
      return jsonResponse({
        code: -101,
        message: '账号未登录',
        data: { wbi_img: { img_url: IMG_URL, sub_url: SUB_URL } },
      });
    }

    const listIndex = calls.filter((call) => call.url.includes('/arc/search')).length - 1;
    if (onList) return onList({ url, init }, listIndex);
    return jsonResponse(listBody([{ ...ITEM }], 124));
  }) as typeof fetch;

  const adapter = createBilibiliAdapter({
    fetchImpl,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    warn: (message: string) => {
      warns.push(message);
    },
  });

  return {
    adapter,
    calls,
    sleeps,
    warns,
    listCalls: () => calls.filter((call) => call.url.includes('/arc/search')),
  };
}

function listBody(vlist: unknown[], count: number, code = 0): unknown {
  return { code, message: 'ok', data: { list: { vlist }, page: { count, pn: 1, ps: 50 } } };
}

/** 列表请求 URL 的参数视图（已解码 —— 断言里要看的是"值"，不是转义）。 */
function listParams(call: FetchCall): URL {
  return new URL(call.url);
}

/** 直接从 URL 里把 `w_rid` 与"它覆盖的那份 query"拆出来（用 node:crypto 现算 md5）。 */
function splitSignedQuery(url: string): { query: string; wRid: string } {
  const raw = new URL(url).search.slice(1);
  const marker = '&w_rid=';
  const at = raw.lastIndexOf(marker);
  assert.ok(at > 0, `URL 里没有 w_rid：${url}`);
  return { query: raw.slice(0, at), wRid: raw.slice(at + marker.length) };
}

const md5 = (text: string): string => createHash('md5').update(text).digest('hex');

// ---------------------------------------------------------------------------
// ★★ 判据本身
// ---------------------------------------------------------------------------

describe('★ bilibili 适配器（spec §2.1 / §2.3 / §2.4 / §5.1）', () => {
  describe('bilibiliReachedEnd —— ★★ §2.4 那个坑的判据', () => {
    it('★ 清单给的四种情形（逐条，一条都不许动）', () => {
      // 正常到底：返回不足一页，而且我们存够了。
      assert.equal(
        bilibiliReachedEnd({ pageCount: 124, returned: 24, pageSize: 50, storedTotal: 124 }),
        true,
      );
      // ★★ 那个坑：返回 0 条，但我们只存了 100 条，而上游说有 124 条 ⇒ **不许**判定到底。
      assert.equal(
        bilibiliReachedEnd({ pageCount: 124, returned: 0, pageSize: 50, storedTotal: 100 }),
        false,
        '空列表**不是**到底了（spec §2.4）—— 判 true 就是静默少存 24 条',
      );
      // 返回满页 ⇒ 当然没到底。
      assert.equal(
        bilibiliReachedEnd({ pageCount: 124, returned: 50, pageSize: 50, storedTotal: 50 }),
        false,
      );
      // 我们存够了，而上游多给了几条（增量重叠）⇒ 到底。
      assert.equal(
        bilibiliReachedEnd({ pageCount: 124, returned: 3, pageSize: 50, storedTotal: 124 }),
        true,
      );
    });

    it('+ 两个条件各自都是必需的（缺一个就会在另一个方向上错）', () => {
      // 只看"不足一页"：这一条会变成 true，而它还差 4 条没存。
      assert.equal(
        bilibiliReachedEnd({ pageCount: 124, returned: 49, pageSize: 50, storedTotal: 120 }),
        false,
      );
      // 只看"存够了"：满页也到底 —— 一个有 200 条的 UP 会在第一页就结束回填。
      assert.equal(
        bilibiliReachedEnd({ pageCount: 200, returned: 50, pageSize: 50, storedTotal: 200 }),
        false,
      );
      // 两个都满足才算到底：这是"刚好差一条"的那一格。
      assert.equal(
        bilibiliReachedEnd({ pageCount: 124, returned: 23, pageSize: 50, storedTotal: 123 }),
        false,
      );
    });

    it('+ 空频道（总数 0）是一条通路，不是死角', () => {
      // `0 < 50 && 0 >= 0` ⇒ 到底。一个还没投稿的 UP 不会让回填永远跑不完。
      assert.equal(
        bilibiliReachedEnd({ pageCount: 0, returned: 0, pageSize: 50, storedTotal: 0 }),
        true,
      );
    });
  });

  // -------------------------------------------------------------------------
  // 密钥与签名（唯一能离线逐值钉住的部分）
  // -------------------------------------------------------------------------

  describe('mixinKey 的重排表与推导', () => {
    it('★ 64 位表**逐字**就是 spec §2.1 那张表（写错一位全废）', () => {
      assert.deepEqual(
        [...BILIBILI_MIXIN_KEY_TABLE],
        [
          46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19,
          29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30,
          4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
        ],
        '这 64 个数字是手抄的；后半段抄错一位在行为上完全看不出来（只取前 32 位）',
      );
      assert.equal(BILIBILI_MIXIN_KEY_TABLE.length, 64);
    });

    it('+ 表是 0–63 的一个排列（所以重排不会取到 undefined 再拼进签名）', () => {
      const unique = new Set(BILIBILI_MIXIN_KEY_TABLE);
      assert.equal(unique.size, 64, '有重复的下标 ⇒ 必有另一个下标永远取不到');
      assert.equal(Math.min(...BILIBILI_MIXIN_KEY_TABLE), 0);
      assert.equal(Math.max(...BILIBILI_MIXIN_KEY_TABLE), 63);
    });

    it('★ 用实测到的那对密钥推出 mixinKey（外部锚：公开实现给的就是这 32 个字符）', () => {
      assert.equal(deriveMixinKey(IMG_URL, SUB_URL), MIXIN_KEY);
      // 换个 img/sub 就是另一把钥匙（证明它真的在用两个输入，不是抄一个常量）。
      assert.notEqual(deriveMixinKey(SUB_URL, IMG_URL), MIXIN_KEY);
    });

    it('+ 文件名去扩展名：带查询串、无扩展名、带 hash 都要抠对', () => {
      const expect = (img: string, sub: string) => deriveMixinKey(img, sub);
      assert.equal(
        expect('https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png?t=1', SUB_URL),
        MIXIN_KEY,
        '查询串不该进密钥',
      );
      assert.equal(
        expect('7cd084941338484aae1ad9425b84077c', '4932caff0ff746eab6f01bf08b70ac45'),
        MIXIN_KEY,
        '没有协议、没有扩展名的裸名字也要能算',
      );
    });

    it('★ 拼起来不是 64 个字符 ⇒ 抛握手错误（不许把 "undefined" 塞进签名）', () => {
      assert.throws(
        () => deriveMixinKey('https://i0.hdslb.com/bfs/wbi/short.png', SUB_URL),
        PlatformHandshakeError,
        '短了一个字符：表的下标会指到 undefined，而那个 mixinKey 只会在服务端变成一个 -352',
      );
    });
  });

  describe('signWbiQuery —— 顺序就是规则（§2.1 第 ③ 步）', () => {
    /** 一份真实形状的参数集（`ps=50`、`pn=2`、`wts` 固定）。 */
    const PARAMS_A = {
      mid: MID,
      ps: 50,
      pn: 2,
      order: 'pubdate',
      platform: 'web',
      web_location: 1550101,
      dm_img_list: '[]',
      dm_img_str: 'V2ViR0wgMS',
      dm_img_inter: '{"ds":[],"wh":[0,0,0],"of":[0,0,0]}',
      wts: NOW_SEC,
    };
    /** 手写死的期望串（不是被测代码生成的）。 */
    const QUERY_A = [
      'dm_img_inter=%7B%22ds%22%3A%5B%5D%2C%22wh%22%3A%5B0%2C0%2C0%5D%2C%22of%22%3A%5B0%2C0%2C0%5D%7D',
      'dm_img_list=%5B%5D',
      'dm_img_str=V2ViR0wgMS',
      `mid=${MID}`,
      'order=pubdate',
      'platform=web',
      'pn=2',
      'ps=50',
      'web_location=1550101',
      `wts=${NOW_SEC}`,
    ].join('&');
    const WRID_A = '64f8af83878d2732d8c8cf9b6a17d896';

    it('★ 固定参数的 query 与 w_rid（= md5(query + mixinKey)）', () => {
      const { query, wRid } = signWbiQuery(PARAMS_A, MIXIN_KEY);
      assert.equal(query, QUERY_A, "键字典序 ⇒ 值的 !'()* 先删 ⇒ URL 编码");
      assert.equal(wRid, WRID_A);
      // 与"另一条路"算出来的比对（node:crypto 现算，不经过被测代码）。
      assert.equal(wRid, md5(QUERY_A + MIXIN_KEY));
    });

    it("+ 值里的 !'()* 先删再编码；空格按 encodeURIComponent 编码", () => {
      // `o'k` ⇒ 去掉 ' ⇒ `ok`；`x y` ⇒ `x%20y`（不是 `x+y`）。
      const { query } = signWbiQuery({ a: "o'k", b: 'x y', c: '!()*' }, MIXIN_KEY);
      assert.equal(query, 'a=ok&b=x%20y&c=');
    });

    it('★ 排序排的是**键**，不是"键=值"整串（真实参数分不出这两种写法）', () => {
      /*
       * ⚠️ 为什么这条需要一组**专门造**的参数：
       *   真实参数集（`PARAMS_A`）里没有任何一个键是另一个键的前缀，
       *   所以"键排序"与"整串排序"给出**完全一样**的顺序 —— 拿它当判据的话，
       *   "把值编码放在排序之前"那个 mutation 会**绿着过去**。
       *   `a` 与 `a-b` 才能分开：`'-'`(0x2D) < `'='`(0x3D)，
       *   整串排序会把 `a-b=x%20y` 排到 `a=ok` **前面**。
       */
      const { query, wRid } = signWbiQuery({ a: 'ok', 'a-b': 'x y', zz: '' }, MIXIN_KEY);
      assert.equal(query, 'a=ok&a-b=x%20y&zz=');
      assert.equal(wRid, 'b7aac2b409991ae7127f6085f8d5d16e');
      assert.notEqual(wRid, '89868eef72502295de6e6f6084efe3ca', '后一个是"先编码再排序"算出来的');
    });
  });

  // -------------------------------------------------------------------------
  // 请求形状：★ 风控参数与签名
  // -------------------------------------------------------------------------

  describe('fetchPage 的请求形状（假 fetch，不打真网络）', () => {
    it('★ 列表请求那一串参数（ps/pn/order/platform/web_location）', async () => {
      const h = harness();
      await h.adapter.fetchPage(creator(), null, { storedTotal: 0 });

      assert.equal(h.listCalls().length, 1);
      const url = listParams(h.listCalls()[0] as FetchCall);
      assert.equal(url.origin + url.pathname, 'https://api.bilibili.com/x/space/wbi/arc/search');
      assert.equal(url.searchParams.get('mid'), MID);
      assert.equal(url.searchParams.get('ps'), String(BILIBILI_PAGE_SIZE));
      assert.equal(url.searchParams.get('ps'), '50', 'spec §10 冻结表：ps=50');
      assert.equal(url.searchParams.get('pn'), '1', 'cursor 为 null ⇒ pn=1');
      assert.equal(url.searchParams.get('order'), 'pubdate');
      assert.equal(url.searchParams.get('platform'), 'web');
      assert.equal(url.searchParams.get('web_location'), '1550101');
      assert.ok(url.searchParams.get('wts'), 'wts 必须带上（签名要用它）');
    });

    it('★ dm_img_* 三个必须是**空**值（编造非空实测是 412，比不传更糟）', async () => {
      const h = harness();
      await h.adapter.fetchPage(creator(), null, { storedTotal: 0 });
      const url = listParams(h.listCalls()[0] as FetchCall);

      assert.equal(url.searchParams.get('dm_img_list'), '[]', '不传是 -352；编造非空是 412');
      assert.equal(url.searchParams.get('dm_img_str'), 'V2ViR0wgMS');
      assert.equal(
        url.searchParams.get('dm_img_inter'),
        '{"ds":[],"wh":[0,0,0],"of":[0,0,0]}',
        '三个 0 就是"空形状"，不是占位符',
      );
      // 三缺一都不行：少任何一个都回到 -352（spec §2.1 的对照表）。
      for (const key of ['dm_img_list', 'dm_img_str', 'dm_img_inter']) {
        assert.ok(url.searchParams.has(key), `${key} 必须存在（存在但为空才对）`);
      }
    });

    it('★ w_rid 覆盖**整份** query（含 dm_img_*），且值就是 md5(query + mixinKey)', async () => {
      const h = harness();
      await h.adapter.fetchPage(creator(), null, { storedTotal: 0 });

      const { query, wRid } = splitSignedQuery((h.listCalls()[0] as FetchCall).url);
      assert.equal(wRid, md5(query + MIXIN_KEY), '用 node:crypto 从抓到的 URL 重算一遍');
      assert.ok(
        query.includes('dm_img_list=%5B%5D'),
        'dm_img_* 在签名里面（依据见 bilibili.ts 文件头）',
      );
      assert.ok(query.includes(`mid=${MID}`));
      assert.ok(!query.includes('w_rid'), 'w_rid 自己不进签名');
      assert.match(wRid, /^[0-9a-f]{32}$/);
    });

    it('+ cookie 与请求头：buvid3/buvid4/b_nut + 探针那套 UA/referer', async () => {
      const h = harness();
      await h.adapter.fetchPage(creator(), null, { storedTotal: 0 });
      const headers = new Headers((h.listCalls()[0] as FetchCall).init?.headers);

      assert.equal(
        headers.get('cookie'),
        `buvid3=${BUVID3}; buvid4=${BUVID4}; b_nut=${Math.floor(Date.now() / 1000)}`,
      );
      // ⚠️ Node 的 fetch 默认发 `User-Agent: node`，那是明显的机器人信号（见 bilibili.ts）。
      assert.match(headers.get('user-agent') ?? '', /^Mozilla\/5\.0 .*Chrome\//);
      assert.equal(headers.get('referer'), 'https://www.bilibili.com/');
      assert.equal(headers.get('accept'), 'application/json, text/plain, */*');
    });

    it('+ 一个实例只握一次手（3 次 fetchPage ⇒ 2 个握手请求 + 3 个列表请求）', async () => {
      const h = harness();
      await h.adapter.fetchPage(creator(), null, { storedTotal: 0 });
      await h.adapter.fetchPage(creator(), '2', { storedTotal: 50 });
      await h.adapter.fetchPage(creator(), '3', { storedTotal: 100 });

      assert.equal(h.listCalls().length, 3);
      assert.equal(h.calls.length, 5, '握手只有最开始那两次');
      assert.equal(
        h.calls.filter((call) => call.url.includes('/finger/spi')).length,
        1,
        'spec §5.1：每个进程一次',
      );
      assert.equal(h.calls.filter((call) => call.url.includes('/nav')).length, 1);
    });

    it('+ nav 回 `code:-101 账号未登录` 也照样拿到密钥（匿名可用是这条路的前提）', async () => {
      const h = harness();
      // harness 的 nav 就是那个未登录形状；能抓到东西就说明没有把 code!==0 当成失败。
      const page = await h.adapter.fetchPage(creator(), null, { storedTotal: 0 });
      assert.equal(page.videos.length, 1);
    });

    it('+ cursor 是页码（"3" ⇒ pn=3）；不是页码就抛，不把脏值送上游', async () => {
      const h = harness();
      await h.adapter.fetchPage(creator(), '3', { storedTotal: 100 });
      assert.equal(listParams(h.listCalls()[0] as FetchCall).searchParams.get('pn'), '3');

      await assert.rejects(
        () => h.adapter.fetchPage(creator(), 'abc', { storedTotal: 100 }),
        BilibiliRejectedError,
      );
      assert.equal(h.listCalls().length, 1, '脏游标不该产生请求');
    });
  });

  // -------------------------------------------------------------------------
  // 字段映射（§5.1）
  // -------------------------------------------------------------------------

  describe('字段映射（spec §5.1 逐字）', () => {
    it('★ 八个字段逐项对上', async () => {
      const h = harness();
      const page = await h.adapter.fetchPage(creator(), null, { storedTotal: 0 });

      assert.deepEqual(page.videos, [
        {
          externalId: 'BV1wHtm6rEK3',
          title: '你有发现今天的我跟过去哪里不一样么？',
          // ⚠️ `http://` 被升级成 `https://`：线上 CSP 是 `img-src 'self' data: https:`。
          thumbnailUrl: 'https://i1.hdslb.com/bfs/archive/c4e0d891ff00b445c686d84e0a2a.jpg',
          publishedAt: 1_788_594_186,
          durationSec: 111,
          viewCount: 59_997,
          commentCount: 1198,
          isLiveReplay: false,
        },
      ]);
    });

    it('★ 拿不到的字段是 null，**绝不是 0**（play=0 留着，缺 play 才是 null）', async () => {
      const h = harness(() =>
        jsonResponse(
          listBody(
            [
              { bvid: 'BV-zero', title: '零播放', play: 0, comment: 0, created: 1, length: '0:00' },
              { bvid: 'BV-missing', title: '上游没给这几格', created: 0 },
            ],
            2,
          ),
        ),
      );
      const page = await h.adapter.fetchPage(creator(), null, { storedTotal: 0 });
      const [zero, missing] = page.videos;

      assert.equal(zero?.viewCount, 0, '真量到的 0 是数据');
      assert.equal(zero?.commentCount, 0);
      assert.equal(zero?.durationSec, null, '`0:00` 是"这一格没有时长"（Task 2 的裁决）');
      assert.ok(zero?.thumbnailUrl === null || typeof zero.thumbnailUrl === 'string');

      assert.equal(missing?.viewCount, null, '缺 play ⇒ null，填 0 就是"没人看"的假数据');
      assert.equal(missing?.commentCount, null);
      assert.equal(missing?.durationSec, null);
      assert.equal(missing?.thumbnailUrl, null, '缺 pic ⇒ null，不是空串');
      assert.equal(missing?.publishedAt, null, 'created=0 是 1970，归 null');
    });

    it('★ 缺 bvid / title 不是字符串 ⇒ 抛（跳过它会静默少一支视频）', async () => {
      const noBvid = harness(() => jsonResponse(listBody([{ title: '没有 bvid' }], 1)));
      await assert.rejects(
        () => noBvid.adapter.fetchPage(creator(), null, { storedTotal: 0 }),
        /bvid 不是字符串/,
        'bvid 是 UNIQUE(platform, external_id) 的一半：当空串就会让后面每一条覆盖同一行',
      );

      const noTitle = harness(() => jsonResponse(listBody([{ bvid: 'BV-x' }], 1)));
      await assert.rejects(
        () => noTitle.adapter.fetchPage(creator(), null, { storedTotal: 0 }),
        /title 不是字符串/,
      );
    });

    it('+ vlist 不是数组 ⇒ 抛（当成空列表就是静默少存一整页）', async () => {
      const h = harness(() =>
        jsonResponse({ code: 0, message: 'ok', data: { list: {}, page: { count: 124 } } }),
      );
      await assert.rejects(
        () => h.adapter.fetchPage(creator(), null, { storedTotal: 0 }),
        /vlist 不是数组/,
      );
    });

    it('+ page.count 缺失 ⇒ 抛（两种猜法都会静默出错）', async () => {
      const h = harness(() =>
        jsonResponse({ code: 0, message: 'ok', data: { list: { vlist: [] }, page: {} } }),
      );
      await assert.rejects(
        () => h.adapter.fetchPage(creator(), null, { storedTotal: 0 }),
        /page\.count 不是数字/,
      );
    });
  });

  // -------------------------------------------------------------------------
  // ★★ 判据接进 fetchPage（写对但没接线 = 没写）
  // -------------------------------------------------------------------------

  describe('★★ 结束判据接进 fetchPage（spec §5.4 + §2.4）', () => {
    it('★ `code:0` 但空列表、而我们没存够 ⇒ **不许**判定到底，游标停在原地', async () => {
      const h = harness(() => jsonResponse(listBody([], 124)));
      const page = await h.adapter.fetchPage(creator(), '3', { storedTotal: 100 });

      assert.equal(
        page.reachedEnd,
        false,
        '这正是 §2.4 那个坑：判 true 就是静默只存了 100 条，而没有任何东西报错',
      );
      assert.equal(page.nextCursor, '3', '游标停在原地：这一页没有真数据，往后翻就永久跳过了它');
      assert.deepEqual(page.videos, []);
    });

    it('+ 首屏（cursor 为 null）遇到空页也是停在 pn=1', async () => {
      const h = harness(() => jsonResponse(listBody([], 124)));
      const page = await h.adapter.fetchPage(creator(), null, { storedTotal: 0 });
      assert.equal(page.reachedEnd, false);
      assert.equal(page.nextCursor, '1');
    });

    it('+ 满页 ⇒ 游标 +1（不前进的话回填永远停在第一页）', async () => {
      const fifty = Array.from({ length: 50 }, (_, index) => ({
        ...ITEM,
        bvid: `BV-page1-${index}`,
      }));
      const h = harness(() => jsonResponse(listBody(fifty, 200)));
      const page = await h.adapter.fetchPage(creator(), '4', { storedTotal: 150 });

      assert.equal(page.reachedEnd, false, '满页当然没到底');
      assert.equal(page.nextCursor, '5');
      assert.equal(page.videos.length, 50);
    });

    it('+ 真的到底（不足一页 + 存够了）⇒ reachedEnd=true 且 nextCursor=null', async () => {
      const h = harness(() => jsonResponse(listBody([{ ...ITEM, bvid: 'BV-last' }], 124)));
      const page = await h.adapter.fetchPage(creator(), '4', { storedTotal: 124 });

      assert.equal(page.reachedEnd, true);
      assert.equal(page.nextCursor, null, 'null = 没有下一页（spec §5）');
    });

    it('+ 空页但**已经存够** ⇒ 到底（那才是正常的结束信号）', async () => {
      const h = harness(() => jsonResponse(listBody([], 124)));
      const page = await h.adapter.fetchPage(creator(), '4', { storedTotal: 124 });
      assert.equal(page.reachedEnd, true);
      assert.equal(page.nextCursor, null);
    });

    it('★★ 不满页但**还有数据**（上游把这一页截断了）⇒ 游标**停在原地**', async () => {
      /*
       * ★★ 最终评审改掉的那一格。原来的判据是"**空页**才原地"：
       *     `videos.length === 0 ? page : page + 1` —— 于是"不满页但有数据"
       *     （`0 < returned < ps`）会**前进一页**，而代价是最坏的一种：
       *       · 上游截掉的那 26 条（`returned..ps`）**永久跳过**（下一页从第 50 条开始，
       *         而重抓同一页是幂等的：`UNIQUE (platform, external_id)` + upsert）；
       *       · 后面几页照常满页时 `storedTotal` 还能**凑到** `page.count`
       *         ⇒ `reachedEnd` 提前为真 ⇒ 丢掉的 26 条在库里、日志里、面板上
       *         **一个字都没有**。
       *     spec §5.1 那张表第 2 行写的就是这一格，逐字是"**原地**"。
       *     ⇒ 这条断言钉住它：改回去（或把 `isFullPage` 改成"非空"）这里会红。
       */
      const partial = Array.from({ length: 24 }, (_, index) => ({
        ...ITEM,
        bvid: `BV-partial-${String(index)}`,
      }));
      const h = harness(() => jsonResponse(listBody(partial, 124)));
      const page = await h.adapter.fetchPage(creator(), '3', { storedTotal: 100 });

      assert.equal(page.reachedEnd, false, '还差 24 条没存到，不能判到底');
      assert.equal(
        page.nextCursor,
        '3',
        '原地：前进一页就是从第 50 条开始，中间那 26 条再也拿不到',
      );
      assert.equal(page.videos.length, 24, '这 24 条本来就要收下（先写库、再决定游标）');
    });
  });

  // -------------------------------------------------------------------------
  // spec §5.1 那条痕迹
  // -------------------------------------------------------------------------

  describe('★ 痕迹：已存行数与 page.count 不一致（spec §5.1 强制要求）', () => {
    /** 一页 n 条（bvid 各不相同，免得两页的断言互相污染）。 */
    const pageOf = (n: number): unknown[] =>
      Array.from({ length: n }, (_, index) => ({
        ...ITEM,
        bvid: `BV-${String(n)}-${String(index)}`,
      }));

    it('★ 候选结尾上两个数不一致（不满页、而我们没存够）⇒ 留一行，且四个数都在里面', async () => {
      const h = harness(() => jsonResponse(listBody(pageOf(24), 124)));
      await h.adapter.fetchPage(creator(), '3', { storedTotal: 100 });

      assert.equal(h.warns.length, 1, 'spec §5.1：不一致时必须留下痕迹，否则只能靠猜');
      const line = h.warns[0] ?? '';
      assert.match(line, /已存行数与 page\.count 不一致/, '这句话要能在 journal 里被 grep 到');
      assert.match(line, /上游总数=124/, '上游那个数');
      assert.match(line, /我们已存=100/, '我们这一边的数 —— 两个数都在，人才能自己判');
      assert.match(line, new RegExp(MID), '要点名是哪个 UP（面板与库里找的都是 mid）');
      assert.match(line, /本页返回=24/);
    });

    it('★ 空页与"不满页"的措辞分开（§2.4 实测的那个形状要一眼认出来）', async () => {
      // ⚠️ 空页上**没有**数据，数据是上游的 `count` 说存在的 —— 一句话混起来就是在说
      //    "这一页上有数据"（2026-09-16 复审提的措辞问题）。
      const h = harness(() => jsonResponse(listBody([], 124)));
      await h.adapter.fetchPage(creator(), '5', { storedTotal: 100 });

      assert.equal(h.warns.length, 1);
      const line = h.warns[0] ?? '';
      assert.match(line, /本页返回=0/);
      assert.match(line, /空页/);
      assert.match(line, /我们已存=100/);
    });

    it('★ 反面：真的到底（两个数**相等**）⇒ 一行都不写', async () => {
      const h = harness(() => jsonResponse(listBody(pageOf(24), 124)));
      await h.adapter.fetchPage(creator(), '3', { storedTotal: 124 });

      assert.deepEqual(h.warns, [], '数字一致就是"我们信这个判据"的正常情形，不该有噪音');
    });

    it('★ 反面：回填途中的满页天然"不一致"（我们 150、上游 200）⇒ 不写', async () => {
      const h = harness(() => jsonResponse(listBody(pageOf(50), 200)));
      await h.adapter.fetchPage(creator(), '4', { storedTotal: 150 });

      /*
       * 这一条是"一个每页都响的痕迹等于没有痕迹"那一半：回填的正常状态**就是**
       * 我们落后于上游 —— 每页都写会刷出满屏"不一致"，把真正的那一次淹掉。
       * ⇒ 触发条件里必须有"在一条候选的结尾上"（`returned < ps`）。
       */
      assert.deepEqual(h.warns, []);
    });

    it('★★ 反方向（已存**多于**上游）⇒ 点明 §5.1 那个残余风险', async () => {
      const h = harness(() => jsonResponse(listBody([], 124)));
      const page = await h.adapter.fetchPage(creator(), '4', { storedTotal: 130 });

      assert.equal(page.reachedEnd, true, '已存 >= 总数 ⇒ 判据成立（这正是危险所在）');
      assert.equal(h.warns.length, 1);
      const line = h.warns[0] ?? '';
      assert.match(line, /上游总数=124/);
      assert.match(line, /我们已存=130/);
      assert.match(
        line,
        /残余风险/,
        '这一行的意义就是"到底"这个判断可能被 UP 删过视频这件事骗了 —— 必须写出来',
      );
    });
  });

  // -------------------------------------------------------------------------
  // 限流：★ 两种拒绝
  // -------------------------------------------------------------------------

  describe('限流与两种拒绝（spec §2.3）', () => {
    it('★ `code:-412` ⇒ 等 10 秒重试，最多 3 次（4 个请求 / 3 次 10 秒）', async () => {
      const h = harness(() => jsonResponse({ code: -412, message: '请求被拦截' }));

      await assert.rejects(
        () => h.adapter.fetchPage(creator(), null, { storedTotal: 0 }),
        (error: unknown) => {
          assert.ok(
            error instanceof BilibiliRateLimitError,
            `期望限流错误，实际是 ${String(error)}`,
          );
          assert.equal(error.retryable, true);
          assert.equal(error.retries, 3);
          return true;
        },
      );
      assert.equal(h.listCalls().length, 4, '首发 + 3 次重试');
      assert.deepEqual(
        h.sleeps,
        [10_000, 10_000, 10_000],
        'spec §2.3 实测：等 2s ❌ / 5s ❌ / 10s ✅',
      );
    });

    it('+ 第二次就成功 ⇒ 只发 2 个请求、只等 1 次', async () => {
      const h = harness((_call, index) =>
        index === 0
          ? jsonResponse({ code: -412, message: '请求被拦截' })
          : jsonResponse(listBody([{ ...ITEM }], 1)),
      );
      const page = await h.adapter.fetchPage(creator(), null, { storedTotal: 0 });

      assert.equal(h.listCalls().length, 2);
      assert.deepEqual(h.sleeps, [10_000]);
      assert.equal(page.videos.length, 1);
    });

    it('+ `HTTP 412`（状态码那种）走同一条退避', async () => {
      const h = harness(() => htmlResponse('request was banned', 412));
      await assert.rejects(
        () => h.adapter.fetchPage(creator(), null, { storedTotal: 0 }),
        BilibiliRateLimitError,
      );
      assert.equal(h.listCalls().length, 4);
      assert.equal(h.sleeps.length, 3);
    });

    it('★ `code:-352` ⇒ **立刻抛、不重试**（与 -412 是两种拒绝）', async () => {
      const h = harness(() => jsonResponse({ code: -352, message: '风控校验失败' }));

      await assert.rejects(
        () => h.adapter.fetchPage(creator(), null, { storedTotal: 0 }),
        (error: unknown) => {
          assert.ok(
            error instanceof BilibiliRejectedError,
            `-352 必须是"被拒"而不是"限流"，实际是 ${String(error)}`,
          );
          assert.equal(error.code, -352);
          assert.equal(error.retryable, false);
          assert.match(error.message, /-352/);
          return true;
        },
      );
      assert.equal(h.listCalls().length, 1, '等 10 秒修不好"缺风控参数"，所以一次都不重试');
      assert.deepEqual(h.sleeps, []);
    });

    it('+ 非 JSON（风控拦下来的 HTML 页）⇒ 抛，绝不当成"空列表"', async () => {
      const h = harness(() => htmlResponse('<!DOCTYPE html><html>风控</html>'));
      await assert.rejects(
        () => h.adapter.fetchPage(creator(), null, { storedTotal: 0 }),
        /响应不是 JSON/,
      );
      assert.deepEqual(h.sleeps, [], 'HTML 拦截页不是限流，重试它没有意义');
    });

    it('+ 别的非零 code（比如 UP 不存在）⇒ 抛，带上 code 与 message', async () => {
      const h = harness(() => jsonResponse({ code: -404, message: '啥都木有' }));
      await assert.rejects(
        () => h.adapter.fetchPage(creator(), null, { storedTotal: 0 }),
        (error: unknown) => {
          assert.ok(error instanceof BilibiliRejectedError);
          assert.equal(error.code, -404);
          assert.match(error.message, /啥都木有/);
          return true;
        },
      );
      assert.equal(h.listCalls().length, 1);
    });
  });

  // -------------------------------------------------------------------------
  // ★ 联系不上上游：两处裸 fetch 都要翻译成专用类型（T5 复审的 Important 2）
  // -------------------------------------------------------------------------

  describe('★ 联系不上上游 ⇒ PlatformUnavailableError（不是"我们的 bug"）', () => {
    /*
     * ★ 缺口是**同一个物理事件两个回答**：握手那两个请求被 `handshakeStep` 包着
     *   （失败 ⇒ `PlatformHandshakeError` ⇒ 502），而**取名字**那一个
     *   （`lookupDisplayName` → `requestJson`）与 **b23 短链**那一个当时是裸 `fetch` ——
     *   它们被拒/超时的时候抛的是 `TypeError` / `DOMException`，一路穿到路由的兜底，
     *   于是"上游连不上"变成了 500「我们崩了」，而 500 会把运维送去查堆栈。
     * ⇒ 归属由**适配器**判（只有它知道 HTTP 层发生了什么），这两条用例钉的就是它。
     */

    it('★ 取名字那一条：fetch 被拒（DNS/连接失败）⇒ PlatformUnavailableError', async () => {
      // 握手正常，列表请求（取名字那一个）在**网络层**炸掉 —— 假 fetch 直接抛就是这个形状
      const h = harness(() => {
        throw new TypeError('fetch failed');
      });

      await assert.rejects(
        () => h.adapter.resolveCreator(MID),
        (error: unknown) => {
          assert.ok(
            error instanceof PlatformUnavailableError,
            `取名字时连不上上游必须是 PlatformUnavailableError（路由据此报 502），实际是 ${String(error)}`,
          );
          assert.equal(error.platform, 'bilibili');
          assert.match(error.step, /arc\/search/, '日志里要能看出是哪一个请求没打出去');
          // 错误的名字与原文都要留下：TimeoutError 与 fetch failed 的排查方向不同
          assert.match(error.message, /TypeError: fetch failed/);
          assert.ok(error.cause instanceof TypeError, '原文当 cause 留着（别只留一句转述）');
          return true;
        },
      );
      assert.equal(h.listCalls().length, 1, '网络失败**不重试**：3×10 秒的预算是为 -412 定的');
      assert.deepEqual(h.sleeps, []);
    });

    it('★ 20 秒超时（`AbortSignal.timeout` 拒的是 DOMException: TimeoutError）也是同一个类型', async () => {
      const h = harness(() => {
        // 真 `AbortSignal.timeout` 超时抛的就是这个（name 是判据，message 是运行时文案）
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      });

      await assert.rejects(
        () => h.adapter.resolveCreator(MID),
        (error: unknown) => {
          assert.ok(error instanceof PlatformUnavailableError, `实际是 ${String(error)}`);
          assert.match(error.message, /TimeoutError/, '"超时"与"连不上"在日志里必须分得开');
          return true;
        },
      );
      assert.deepEqual(h.sleeps, [], '超时不重试：等 10 秒不会让一个 20 秒超时的请求变快');
    });

    it('★ b23 短链那一条：fetch 被拒 ⇒ 同一个类型（**不是** InvalidCreatorInputError）', async () => {
      const calls: string[] = [];
      const adapter = createBilibiliAdapter({
        fetchImpl: (async (input: string | URL | Request) => {
          calls.push(typeof input === 'string' ? input : String(input));
          throw new TypeError('fetch failed');
        }) as typeof fetch,
        sleep: async () => {},
      });

      await assert.rejects(
        () => adapter.resolveCreator('https://b23.tv/AbCdEf'),
        (error: unknown) => {
          /*
           * ⚠️ 这两个错误在这一层**长得像但完全不同**：`InvalidCreatorInputError`
           *   是"管理员贴错了"（路由 ⇒ 400，让他重贴），这条是"我们联系不上上游"
           *   （路由 ⇒ 502，过一会儿再来）。混成一个的话，一次网络抖动会被答成
           *   "这条链接认不出" —— 而管理员会去改一条本来就没问题的链接。
           */
          assert.ok(
            error instanceof PlatformUnavailableError,
            `短链跟不到是"联系不上上游"，不是"链接贴错了"；实际是 ${String(error)}`,
          );
          assert.equal(error.step, 'b23');
          return true;
        },
      );
      assert.equal(calls.length, 1, '第一个请求就炸了 ⇒ 后面一次握手都不该发生');
    });
  });

  // -------------------------------------------------------------------------
  // 握手：★ 失败要放弃整个平台
  // -------------------------------------------------------------------------

  describe('握手失败 ⇒ 放弃整个平台（spec §5.1）', () => {
    it('★ 握手的那个请求**连不上** ⇒ 仍然是 PlatformHandshakeError（放弃整个平台）', async () => {
      /*
       * ★ 这条钉的是一个**故意**的合并：`handshakeStep` 把 `requestJson` 抛出来的任何东西
       *   （包括上面那个 `PlatformUnavailableError`）都收成 `PlatformHandshakeError`。
       *   那是对的 —— 连不上上游时这一轮整个平台都不该继续碰（否则 20 个 creator
       *   会各等 20 秒去撞同一个连不上的上游），而"整轮放弃一个平台"正是这个类型的语义。
       *   代价：网络原因在握手这一步看不出来（类型说"握手失败"）——
       *   `cause` 里留着原文，日志里分得开。
       */
      const adapter = createBilibiliAdapter({
        fetchImpl: (async () => {
          throw new TypeError('fetch failed');
        }) as typeof fetch,
        sleep: async () => {},
      });

      await assert.rejects(
        () => adapter.fetchPage(creator(), null, { storedTotal: 0 }),
        (error: unknown) => {
          assert.ok(error instanceof PlatformHandshakeError, `实际是 ${String(error)}`);
          assert.equal(error.step, 'finger/spi');
          /*
           * ⚠️ `cause` 在这里是**两层**，而两层都该留着：
           *   `requestJson` 先把 `TypeError` 收成 `PlatformUnavailableError`
           *   （它自己用 cause 挂着原文），`handshakeStep` 再把它收成握手错误
           *   （同样用 cause 挂着中间那一层）。外面那层说"这一轮放弃这个平台"，
           *   里面两层说"为什么" —— 而 message 里也已经带着原文（见上一行断言）。
           */
          const cause: unknown = error.cause;
          assert.ok(cause instanceof PlatformUnavailableError, '中间那层是"联系不上上游"');
          assert.ok(cause.cause instanceof TypeError, '最里面是原始的网络错误');
          return true;
        },
      );
    });

    it('★ 拿不到 buvid ⇒ 专用错误，而且**一个列表请求都不发**', async () => {
      const calls: FetchCall[] = [];
      const adapter = createBilibiliAdapter({
        fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : String(input);
          calls.push({ url, init });
          return jsonResponse({ code: 0, message: 'ok', data: {} });
        }) as typeof fetch,
        sleep: async () => {},
      });

      await assert.rejects(
        () => adapter.fetchPage(creator(), null, { storedTotal: 0 }),
        (error: unknown) => {
          assert.ok(error instanceof PlatformHandshakeError);
          assert.equal(error.step, 'finger/spi');
          return true;
        },
      );
      assert.equal(calls.length, 1, '没有 buvid 就别接着打：那会白吃一堆 412（spec §5.1）');
      assert.equal(calls.filter((call) => call.url.includes('/arc/search')).length, 0);
    });

    it('+ 密钥拿不到（nav 里没有 wbi_img）⇒ 同样是握手错误', async () => {
      const adapter = createBilibiliAdapter({
        fetchImpl: (async (input: string | URL | Request) => {
          const url = typeof input === 'string' ? input : String(input);
          return url.includes('/nav')
            ? jsonResponse({ code: 0, message: 'ok', data: {} })
            : jsonResponse({ code: 0, message: 'ok', data: { b_3: BUVID3, b_4: BUVID4 } });
        }) as typeof fetch,
        sleep: async () => {},
      });

      await assert.rejects(
        () => adapter.fetchPage(creator(), null, { storedTotal: 0 }),
        (error: unknown) => {
          assert.ok(error instanceof PlatformHandshakeError);
          assert.equal(error.step, 'nav');
          return true;
        },
      );
    });

    it('+ 握手失败只握一次：后续调用不再发请求，抛的还是同一个类型', async () => {
      let attempts = 0;
      const adapter = createBilibiliAdapter({
        fetchImpl: (async () => {
          attempts += 1;
          return jsonResponse({ code: 0, message: 'ok', data: {} });
        }) as typeof fetch,
        sleep: async () => {},
      });

      await assert.rejects(() => adapter.fetchPage(creator(), null, { storedTotal: 0 }));
      await assert.rejects(
        () => adapter.fetchPage(creator(), '2', { storedTotal: 0 }),
        PlatformHandshakeError,
      );
      assert.equal(attempts, 1, '一次运行只握一次手 —— 失败也算握过了，别再拿同一个上游试 20 遍');
    });
  });

  // -------------------------------------------------------------------------
  // resolveCreator
  // -------------------------------------------------------------------------

  describe('resolveCreator（spec §5.1）', () => {
    it('★ 纯数字 mid 与 space 链接（带查询串 / 带 /video）', async () => {
      const h = harness();
      for (const input of [
        MID,
        `https://space.bilibili.com/${MID}`,
        `https://space.bilibili.com/${MID}/video`,
        `http://www.space.bilibili.com/${MID}?spm_id_from=333.999.0.0`,
        `space.bilibili.com/${MID}`,
      ]) {
        const ref = await h.adapter.resolveCreator(input);
        assert.equal(ref.platform, 'bilibili', input);
        assert.equal(ref.externalId, MID, input);
      }
      /*
       * ⚠️ 这一段原来断言的是 `h.calls.length === 0`（"这几种输入不需要联网"），
       *   而那个断言钉的正是**被裁定推翻的那一条**（"不为了一个显示名去打接口"）。
       *   现在的契约是：**解析**本身不联网（这几种输入里没有短链），但**取名字要**
       *   —— 一次握手 + 一个 `ps=1` 的 `arc/search`。
       */
      assert.equal(h.listCalls().length, 5, '五次 resolveCreator ⇒ 五次取名字（每加一个博主一次）');
      assert.equal(h.calls.length, 7, '2 次握手 + 5 次取名字：握手仍然只有一次');
    });

    it('★ 名字是 `arc/search` 第一条的 `author`（不是 `mid <id>` 占位）', async () => {
      const h = harness(() => jsonResponse(listBody([{ ...ITEM, author: 'Someone' }], 124)));
      const ref = await h.adapter.resolveCreator(MID);

      assert.equal(
        ref.displayName,
        'Someone',
        'spec §5.1（2026-09-16 裁决）：管理面板里要出现的是名字，不是 mid 703007996',
      );
      assert.equal(ref.externalId, MID);
      assert.equal(ref.platform, 'bilibili');
      assert.equal(ref.handle, MID, 'handle 还是 mid：它是能直接拼进空间页 URL 的那个可读标识');
      assert.equal(
        ref.avatarUrl,
        null,
        'acc/info 实测 -352，头像没有第二个来源 —— 这一次裁决只把名字拿回来',
      );
    });

    it('★ 一次 resolveCreator = 2 个握手请求 + **正好一个** `ps=1` 的 arc/search', async () => {
      const h = harness(() => jsonResponse(listBody([{ ...ITEM, author: 'Someone' }], 124)));
      await h.adapter.resolveCreator(MID);

      assert.equal(h.calls.length, 3, '2 次握手（finger/spi + nav）+ 1 次取名字');
      assert.equal(h.listCalls().length, 1, '"多发一次请求"就是一次，不是一整页');
      const lookup = h.listCalls()[0] as FetchCall;
      const url = listParams(lookup);
      assert.equal(url.searchParams.get('ps'), '1', 'spec §5.1 的裁决逐字写的是 ps=1');
      assert.equal(url.searchParams.get('pn'), '1', 'pn=1：名字在最新一条投稿里，这一趟不翻页');
      assert.equal(url.searchParams.get('mid'), MID);
      // 与列表页**同一套**签名与风控参数（不是第二个请求构造器）。
      const { query, wRid } = splitSignedQuery(lookup.url);
      assert.equal(wRid, md5(query + MIXIN_KEY));
      assert.equal(url.searchParams.get('dm_img_list'), '[]');
      assert.equal(url.searchParams.get('dm_img_str'), 'V2ViR0wgMS');
      assert.equal(url.searchParams.get('order'), 'pubdate');
      assert.equal(url.searchParams.get('platform'), 'web');
      assert.equal(url.searchParams.get('web_location'), '1550101');
      assert.ok(url.searchParams.get('wts'), 'wts 在签名里，取名字这一次也一样');
      assert.match(
        new Headers(lookup.init?.headers).get('cookie') ?? '',
        /^buvid3=/,
        '取名字那一次带着握手换来的 cookie',
      );

      /*
       * ★ 一次性（spec §5.1 裁决的代价写的就是"加一个博主时多一次"）：**不是每轮同步**。
       *   同步那一页是它自己的请求，取名字没有再来一次，握手也没有。
       */
      await h.adapter.fetchPage(creator(), null, { storedTotal: 0 });
      assert.equal(h.listCalls().length, 2, '同步一页 ⇒ 只多一个列表请求');
      assert.equal(h.calls.filter((call) => call.url.includes('/finger/spi')).length, 1);
      assert.equal(h.calls.filter((call) => call.url.includes('/nav')).length, 1);
    });

    it('★ 空 vlist（这个 UP 一个投稿都没有）⇒ 回落到 `mid <id>` 占位', async () => {
      const h = harness(() => jsonResponse(listBody([], 0)));
      const ref = await h.adapter.resolveCreator(MID);

      assert.equal(ref.displayName, `mid ${MID}`, 'spec §5.1 的裁决：没有投稿 ⇒ 占位');
      assert.equal(h.listCalls().length, 1, '这一次请求还是要发的 —— 不发就分不清"没名字"与"没打"');
    });

    it('★ `author` 缺失 / 空串 / 全空白 ⇒ 回落到占位（不许把空白当名字）', async () => {
      /*
       * ⚠️ `author: undefined` 经 `JSON.stringify` 会**整个键消失** ⇒ 那才是真正的"缺失"，
       *   而不是一个值为 undefined 的属性。
       */
      for (const first of [
        { ...ITEM, author: undefined },
        { ...ITEM, author: '' },
        { ...ITEM, author: '   ' },
      ]) {
        const h = harness(() => jsonResponse(listBody([first], 124)));
        const ref = await h.adapter.resolveCreator(MID);
        assert.equal(
          ref.displayName,
          `mid ${MID}`,
          `author=${JSON.stringify(first.author)} 不是一个名字`,
        );
      }
    });

    it('★ 取名字那一次也走**同一套**拒绝分类：`-352` 立刻抛、一次都不重试', async () => {
      const h = harness(() => jsonResponse({ code: -352, message: '风控校验失败' }));

      await assert.rejects(
        () => h.adapter.resolveCreator(MID),
        (error: unknown) => {
          assert.ok(
            error instanceof BilibiliRejectedError,
            `-352 是"被拒"而不是"限流"，实际是 ${String(error)}`,
          );
          assert.equal(error.code, -352);
          return true;
        },
      );
      assert.equal(h.listCalls().length, 1);
      assert.deepEqual(h.sleeps, [], '等 10 秒修不好它 —— 取名字这条路也一样');
    });

    it('★ 取名字那一次的 `-412` 也等 10 秒重试（同一套规则，不是另一条路）', async () => {
      const h = harness((_call, index) =>
        index === 0
          ? jsonResponse({ code: -412, message: '请求被拦截' })
          : jsonResponse(listBody([{ ...ITEM, author: 'Someone' }], 124)),
      );

      const ref = await h.adapter.resolveCreator(MID);
      assert.equal(ref.displayName, 'Someone', '重试成功之后名字照样要拿到');
      assert.equal(h.listCalls().length, 2, '首发 + 一次重试');
      assert.deepEqual(h.sleeps, [10_000]);
    });

    it('★ b23.tv 短链：跟重定向，再从**最终 URL** 里抠 mid，然后取名字', async () => {
      const calls: string[] = [];
      const adapter = createBilibiliAdapter({
        fetchImpl: (async (input: string | URL | Request) => {
          const url = typeof input === 'string' ? input : String(input);
          calls.push(url);
          if (url.includes('/x/frontend/finger/spi')) {
            return jsonResponse({ code: 0, message: 'ok', data: { b_3: BUVID3, b_4: BUVID4 } });
          }
          if (url.includes('/x/web-interface/nav')) {
            return jsonResponse({
              code: -101,
              message: '账号未登录',
              data: { wbi_img: { img_url: IMG_URL, sub_url: SUB_URL } },
            });
          }
          if (url.includes('/arc/search')) {
            return jsonResponse(listBody([{ ...ITEM, author: 'Someone' }], 124));
          }
          return redirectedTo(`https://space.bilibili.com/${MID}?spm_id_from=444`);
        }) as typeof fetch,
        sleep: async () => {},
      });

      const ref = await adapter.resolveCreator('https://b23.tv/AbCdEf');
      assert.equal(ref.externalId, MID, 'mid 要从**跳转之后**的 URL 里来，不是从短链里');
      assert.equal(ref.displayName, 'Someone', '抠出 mid 之后照样取名字 —— 这条路也不留占位');
      assert.equal(
        calls[0],
        'https://b23.tv/AbCdEf',
        '短链是第一个请求：它不需要 cookie，所以不先握手',
      );
      assert.equal(calls.length, 4, '1 次短链跳转 + 2 次握手 + 1 次取名字（不是先握手再解析）');
    });

    it('+ b23 跳到视频页（抠不到 mid）⇒ 认不出来，而不是瞎猜一个，也不白握手', async () => {
      const calls: string[] = [];
      const adapter = createBilibiliAdapter({
        fetchImpl: (async (input: string | URL | Request) => {
          calls.push(typeof input === 'string' ? input : String(input));
          return redirectedTo('https://www.bilibili.com/video/BV1wHtm6rEK3');
        }) as typeof fetch,
        sleep: async () => {},
      });
      await assert.rejects(
        () => adapter.resolveCreator('https://b23.tv/AbCdEf'),
        InvalidCreatorInputError,
      );
      assert.equal(calls.length, 1, '解析不出来就别接着握手：那两次请求同样在风控的账上');
    });

    it('+ 认不出来的输入 ⇒ InvalidCreatorInputError（路由把它变成 400）', async () => {
      const h = harness();
      for (const input of ['', '   ', '随便写的', 'https://youtube.com/@someone']) {
        await assert.rejects(
          () => h.adapter.resolveCreator(input),
          InvalidCreatorInputError,
          `"${input}" 不该被认成一个博主`,
        );
      }
      assert.equal(h.calls.length, 0, '认不出来就一个请求都不发（包括取名字那一次）');
    });
  });

  // -------------------------------------------------------------------------
  // 注册表
  // -------------------------------------------------------------------------

  describe('注册表（tracking/index.ts）', () => {
    /*
     * ★ T8 起 `adapterFor` / `platformStatus` 读的是**环境变量**（T3 那时 youtube/twitch
     *   还是写死的占位），所以这一组断言必须**自己把环境钉在"一个凭据都没有"那个状态**上。
     *
     * ⚠️ 不钉的代价有两条，第二条更要命：
     *   · 这台开发机上"配没配 MCSR_YOUTUBE_KEY"会决定这两个用例红不红，而那条红看起来
     *     像"注册表坏了"（没人会想到去查自己的 shell）；
     *   · `tracking-routes.test.ts` 最后那一条用的是**真注册表**（真 app）——
     *     配了 key 的机器上它会**真打一次 YouTube Data API**，而本仓铁律是
     *     测试绝不打网络。⇒ 那两个文件现在都显式控制环境（这是 T8 带来的新前提）。
     *
     * ⚠️ 还原是必须的：`node --test` 是一个文件一个进程，而**同一个文件里的用例共享**它。
     *    （没配过的那几个要 `delete`，不是赋空串 —— 空串也算"没配"，但那是另一条规则，
     *    这里要的是"与 T3 那时完全一样的起点"。）
     */
    const CREDENTIAL_ENV = ['MCSR_YOUTUBE_KEY', 'MCSR_TWITCH_ID', 'MCSR_TWITCH_SECRET'] as const;
    const savedEnv = new Map<string, string | undefined>();

    before(() => {
      for (const name of CREDENTIAL_ENV) {
        savedEnv.set(name, process.env[name]);
        delete process.env[name];
      }
    });

    after(() => {
      for (const [name, value] of savedEnv) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });

    it('★ bilibili 是真适配器；没凭据时 youtube/twitch 抛 NoCredentialsError', () => {
      const adapter = adapterFor('bilibili');
      assert.equal(typeof adapter.fetchPage, 'function');
      assert.equal(typeof adapter.resolveCreator, 'function');
      assert.equal(adapter, bilibiliAdapter);

      for (const [platform, env] of [
        ['youtube', 'MCSR_YOUTUBE_KEY'],
        ['twitch', 'MCSR_TWITCH_ID'],
      ] as const) {
        assert.throws(
          () => adapterFor(platform),
          (error: unknown) => {
            assert.ok(error instanceof NoCredentialsError, `${platform} 应当抛 NoCredentialsError`);
            assert.equal(error.platform, platform);
            assert.ok(
              error.requiredEnv.includes(env),
              `那句日志要告诉运维配什么：${error.requiredEnv.join(',')}`,
            );
            return true;
          },
        );
      }
    });

    it('★ platformStatus()：bilibili=ok，另两个 skipped:no-credentials', () => {
      assert.deepEqual(platformStatus(), {
        bilibili: 'ok',
        youtube: 'skipped:no-credentials',
        twitch: 'skipped:no-credentials',
      });
    });

    it('+ platformStatus() 返回副本（改它不影响下一次调用）', () => {
      const first = platformStatus();
      first.bilibili = 'skipped:no-credentials';
      assert.equal(platformStatus().bilibili, 'ok');
    });
  });
});
