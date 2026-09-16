/**
 * 一轮同步（`track.ts` 的 `runOnce`）与它那个 CLI 壳的行为契约。
 *
 * ===========================================================================
 * 为什么这一层要单独钉死
 * ===========================================================================
 * 前面五个任务交付的是"能被调到的东西"：表、解析器、适配器、数据层、端点。
 * **这一层是唯一让它们自己跑起来的东西**，而它守的恰好是本功能最怕的那一类故障：
 * **不抛异常、只是结果变成另一个样子**。下面每一条断言都对应其中一种：
 *
 *   · 游标先推后写 ⇒ 一次崩在写库上，那一页的视频**永久丢失**（下次从下一页开始翻），
 *     而日志里只有一行"这一轮失败了"；
 *   · 失败就不推游标 ⇒ 这个博主**永远停在第一页**，每轮重抓同一页（§5.1 那个
 *     被 T3 评审量到的错），表面上"每轮都在跑"；
 *   · 一个平台挂了带着别的平台一起挂 ⇒ 违反 spec §3.5，而表现是"这一轮什么都没增量"；
 *   · 没凭据被当成失败 ⇒ youtube/twitch 每轮刷 40 条失败记录（spec §9.1 ⑧ 要的是跳过）；
 *   · 限流失效 ⇒ `limits` 不再有界，一次运行把整份名单抓一遍（spec §3.3 唯一的那道界）；
 *   · `storedTotal` 传成"过滤过的条数" ⇒ bilibili 的"到底了"判据提前成立
 *     （spec §5.1 那段残余风险），**最后几条真视频永远抓不到**，没有任何异常可抓。
 *
 * ===========================================================================
 * 两条夹具纪律（和 tracking-store.test.ts 同一套）
 * ===========================================================================
 * ① **零网络**：`runOnce` 收的是注入的适配器注册表（`RunDeps.adapters`），
 *    所以这里连一个真实请求都不可能发出去 —— 不是"我们记得别打网络"，是**没有可打的**。
 * ② **假时钟**（`RunDeps.now`）：所有时间断言都对着一个固定的 `NOW`，
 *    而不是"大概差不多"（那种断言不会红）。
 */

process.env.DB_PATH = ':memory:';

const { closeDb, getDb } = await import('./db');
const { createCreator, upsertVideos } = await import('./tracked-videos');
const { exitCodeFor, formatSummary, main, runOnce, TRACK_LIMITS } = await import('./track');
const { createBilibiliAdapter } = await import('./tracking/bilibili');
const { NoCredentialsError, PlatformHandshakeError } = await import('./tracking/types');
type FetchedVideo = import('./tracking/types').FetchedVideo;
type FetchPage = import('./tracking/types').FetchPage;
type CreatorRef = import('./tracking/types').CreatorRef;
type PlatformAdapter = import('./tracking/types').PlatformAdapter;

import type { TrackedCreator, TrackPlatform } from '@mcsr/shared';

type RunDeps = import('./track').RunDeps;

import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

after(() => closeDb());

/**
 * 每个用例开头**清空两张表**。
 *
 * ⚠️ 这与本仓另外两个测试文件的"默认不清表"（`tracking-store.test.ts` 夹具决定 ②）
 *    **故意相反**，理由是本文件的断言形状不一样：那边的断言都按 `creator_id` 收窄，
 *    而这里断言的是**整轮**的数（试/完成/失败、新增/更新），并且假适配器对**所有**
 *    creator 都作答 ⇒ 上一个用例留下的博主会被算进下一个用例的计数。
 *    留下的那些是"还没回填完"的行（`backfill_done = 0`），而它们**每一轮都算到点**
 *    —— 这是设计如此（回填没做完就要接着做），所以污染是必然的、不是偶发。
 *    代价：污染**不会红**，只会让期望值与真实行为对不上（写测试时踩过一次）。
 * ⚠️ 两条 DELETE 都写出来，不靠外键级联：级联由迁移 020 保证（T5 有测试钉着），
 *    但"这一行是干什么的"不该要求读者去别处确认一遍。
 */
function resetTables(): void {
  getDb().exec('DELETE FROM tracked_videos');
  getDb().exec('DELETE FROM tracked_creators');
}

beforeEach(() => {
  resetTables();
});

/** 所有用例共用的"现在"。**秒**，与两张表里那几个时间列的语义一致。 */
const NOW = 1_788_600_000;
/** 增量同步的间隔（spec §3.2：一小时）。 */
const HOUR = 3600;
/** spec §10 冻结的每次运行上限：回填 20 / 翻 20 页 / 增量 40。 */
const LIMITS = { backfill: 20, pages: 20, incremental: 40 };

/** 一个 mid（`addCreator` 的 `externalId`）。真适配器那条用例拿它当 bilibili 的博主 id。 */
const MID = '703007996';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${String(seq)}`;
}

/** 造一个博主。`createCreator` 造出来的新行**永远是待回填**的（`backfill_done = 0`）。 */
function addCreator(platform: TrackPlatform, externalId?: string): TrackedCreator {
  const ref: CreatorRef = {
    platform,
    externalId: externalId ?? nextId('mid'),
    handle: '',
    displayName: `测试博主 ${nextId('n')}`,
    avatarUrl: null,
  };
  const result = createCreator(ref, null, NOW);
  assert.equal(result.ok, true, '夹具博主没建起来 —— 后面的断言全都无从谈起');
  return (result as { ok: true; creator: TrackedCreator }).creator;
}

/** 直接改库造出**只有同步过程才会出现**的状态（和 tracking-store.test.ts 的夹具同一条理由）。 */
function forceCreatorState(
  id: string,
  patch: { backfillDone?: boolean; lastSyncedAt?: number | null; lastCursor?: string | null },
): void {
  getDb()
    .prepare(
      `UPDATE tracked_creators
          SET backfill_done = ?, last_synced_at = ?, last_cursor = ?
        WHERE id = ?`,
    )
    .run(patch.backfillDone ? 1 : 0, patch.lastSyncedAt ?? null, patch.lastCursor ?? null, id);
}

/** `tracked_creators` 那一行里与本文件有关的那几列（**逐列写出来**，不用星号）。 */
function creatorRow(id: string): {
  backfill_done: number;
  last_cursor: string | null;
  last_synced_at: number | null;
  consecutive_failures: number;
  last_error: string | null;
  enabled: number;
} {
  const row = getDb()
    .prepare(
      `SELECT backfill_done, last_cursor, last_synced_at, consecutive_failures, last_error, enabled
         FROM tracked_creators WHERE id = ?`,
    )
    .get(id) as
    | {
        backfill_done: number;
        last_cursor: string | null;
        last_synced_at: number | null;
        consecutive_failures: number;
        last_error: string | null;
        enabled: number;
      }
    | undefined;
  assert.ok(row, `库里没有博主 ${id}`);
  return row;
}

function video(externalId: string, overrides: Partial<FetchedVideo> = {}): FetchedVideo {
  return {
    externalId,
    title: `标题 ${externalId}`,
    thumbnailUrl: null,
    publishedAt: NOW - 86_400,
    durationSec: 300,
    viewCount: null,
    commentCount: null,
    isLiveReplay: false,
    ...overrides,
  };
}

/** 一次 `fetchPage` 调用留下的痕迹。 */
interface FetchCall {
  creatorId: string;
  externalId: string;
  platform: TrackPlatform;
  cursor: string | null;
  storedTotal: number;
}

/**
 * 假适配器。`handler` 拿得到**这次调用的全部入参**（含 `storedTotal`）与它是第几次被调，
 * 所以"第几页开始失败""游标传的是不是上一页给的那个"都能被钉住。
 */
function makeAdapter(handler: (call: FetchCall, index: number) => FetchPage | Promise<FetchPage>): {
  adapter: PlatformAdapter;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const adapter: PlatformAdapter = {
    async resolveCreator() {
      throw new Error('runOnce 不该走到 resolveCreator —— 把链接解析成博主是路由（T5）的事');
    },
    async fetchPage(creator, cursor, ctx) {
      const call: FetchCall = {
        creatorId: creator.id,
        externalId: creator.externalId,
        platform: creator.platform,
        cursor,
        storedTotal: ctx.storedTotal,
      };
      calls.push(call);
      return await handler(call, calls.length - 1);
    },
  };
  return { adapter, calls };
}

/**
 * 假注册表 —— **形状与 `tracking/index.ts` 的真注册表逐字对齐**：没给这个平台的适配器就抛
 * `NoCredentialsError`（而不是返回 null）。这样"CLI 会不会去要一个它拿不到的适配器"
 * 这条就真的能被测到：真注册表在那种情况下抛的就是这个类型。
 */
function adapterRegistry(fakes: Partial<Record<TrackPlatform, PlatformAdapter>>): {
  adapters: RunDeps['adapters'];
  asked: TrackPlatform[];
} {
  const asked: TrackPlatform[] = [];
  return {
    asked,
    adapters: (platform) => {
      asked.push(platform);
      const fake = fakes[platform];
      if (!fake) throw new NoCredentialsError(platform, ['MCSR_TEST_KEY']);
      return fake;
    },
  };
}

const ALL_OK: Record<TrackPlatform, 'ok' | 'skipped:no-credentials'> = {
  bilibili: 'ok',
  youtube: 'ok',
  twitch: 'ok',
};

/** spec §2.7 的今天：只有 bilibili 能用，另外两个平台被跳过。 */
const ONLY_BILIBILI: Record<TrackPlatform, 'ok' | 'skipped:no-credentials'> = {
  bilibili: 'ok',
  youtube: 'skipped:no-credentials',
  twitch: 'skipped:no-credentials',
};

function depsFor(init: {
  adapters: RunDeps['adapters'];
  platformStatus?: Record<TrackPlatform, 'ok' | 'skipped:no-credentials'>;
  now?: number;
  limits?: Partial<RunDeps['limits']>;
}): RunDeps {
  return {
    adapters: init.adapters,
    platformStatus: () => ({ ...(init.platformStatus ?? ALL_OK) }),
    now: () => init.now ?? NOW,
    limits: { ...LIMITS, ...init.limits },
  };
}

/** 把 `console.log` 换成收集器（本文件内用例是顺序跑的，所以这样是安全的）。 */
async function captureStdout<T>(fn: () => Promise<T>): Promise<{ result: T; out: string }> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(' '));
  };
  try {
    const result = await fn();
    return { result, out: lines.join('\n') };
  } finally {
    console.log = original;
  }
}

// ---------------------------------------------------------------------------
// ① 一轮同步的骨架
// ---------------------------------------------------------------------------

describe('runOnce —— 一轮同步的骨架', () => {
  it('① 一个待回填的博主抓到底 ⇒ backfill_done 置 1、游标清空、last_synced_at 前进', async () => {
    const creator = addCreator('bilibili', nextId('done'));
    /*
     * ⚠️ 这个夹具**故意自相矛盾**：`reachedEnd: true` 却还留着一个非空游标
     *    （真适配器到底时会给 `null` —— `FetchPage.nextCursor` 的注释就是"null = 没有下一页"）。
     *    它不是笔误：钉的正是"到底了就不许留游标"，也就是 `reachedEnd` 压过 `nextCursor`。
     *    留着的代价很具体：增量同步**总是从第一页翻新的**，一个停在半路的游标会让
     *    新视频永远看不到（`track.ts` 那一处注释写了两个方向的代价对比）。
     */
    const { adapter, calls } = makeAdapter(() => ({
      videos: [video(`${creator.externalId}-v1`), video(`${creator.externalId}-v2`)],
      nextCursor: '2',
      reachedEnd: true,
    }));

    const summary = await runOnce(
      depsFor({ adapters: adapterRegistry({ bilibili: adapter }).adapters }),
    );

    assert.deepEqual(summary.backfill, { tried: 1, done: 1, failed: 0 });
    assert.deepEqual(summary.incremental, { tried: 0, done: 0, failed: 0 });
    assert.equal(summary.inserted, 2);
    assert.equal(summary.updated, 0);
    assert.deepEqual(summary.failures, []);

    // 三样一起断言：只写 backfill_done 而没清游标，下一次增量会从旧游标接着翻。
    const row = creatorRow(creator.id);
    assert.equal(row.backfill_done, 1, '回填完成必须落库 —— 否则每轮都从第一页重抓');
    assert.equal(row.last_cursor, null, '到底了就要清游标（收尾）；留着它下次会从中间翻');
    assert.equal(row.last_synced_at, NOW, 'last_synced_at 是增量那条查询的输入');
    assert.equal(row.consecutive_failures, 0);
    assert.equal(row.last_error, null);

    // 第一页拿到的游标必须是库里那个（新博主是 null），storedTotal 是 0 条。
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.cursor, null);
    assert.equal(calls[0]?.storedTotal, 0);
  });

  it('② 一个博主失败 ⇒ 只有它自己记失败，同平台的另一个照常完成', async () => {
    const bad = addCreator('bilibili', 'boom-2');
    const good = addCreator('bilibili', 'fine-2');
    const { adapter, calls } = makeAdapter((call) => {
      if (call.externalId === 'boom-2') throw new Error('上游 500：假装这一页炸了');
      return { videos: [video(`${call.externalId}-v1`)], nextCursor: null, reachedEnd: true };
    });

    const summary = await runOnce(
      depsFor({ adapters: adapterRegistry({ bilibili: adapter }).adapters }),
    );

    assert.equal(summary.backfill.tried, 2);
    assert.equal(summary.backfill.done, 1);
    assert.equal(summary.backfill.failed, 1);
    assert.equal(summary.failures.length, 1);
    /*
     * ⚠️ `?.` 是本仓测试里读数组元素的既有写法（`ranked.test.ts:354`）：没有调用时
     *    取到 `undefined`，而 `assert.equal` 在 strict 下 `undefined !== null`、
     *    也 `!== '3'` ⇒ **断言照样会红**，不会因为"没这一页"而静默通过。
     */
    assert.equal(summary.failures[0]?.creatorId, bad.id);
    assert.equal(summary.failures[0]?.platform, 'bilibili');
    const [failure] = summary.failures;
    assert.ok(failure, '必须记下一条失败 —— 这是 spec §6.3 那句"全量失败要看得见"');
    assert.match(failure.error, /上游 500/);

    // 失败那一行：计数 +1、原文留下、**水位不动**（动了就等于"刚试过"，下一轮它不再到点）。
    const badRow = creatorRow(bad.id);
    assert.equal(badRow.consecutive_failures, 1);
    assert.match(String(badRow.last_error), /上游 500/);
    assert.equal(badRow.last_synced_at, null, '失败不许推 last_synced_at —— 它是成功的水位');
    assert.equal(badRow.backfill_done, 0);

    // 健康那一行照常收尾 —— 一个博主坏了不能连坐另一个。
    const goodRow = creatorRow(good.id);
    assert.equal(goodRow.backfill_done, 1);
    assert.equal(goodRow.last_synced_at, NOW);
    assert.equal(goodRow.consecutive_failures, 0);

    /*
     * ⚠️ 失败的那个**只被试了一次**（第二次调用属于另一个博主）：一个博主挂了不该
     *    把这个平台的剩余请求全打光（那是"带着坏状态继续打"的另一种形状）。
     */
    assert.equal(calls.length, 2);
  });

  it('②-跨平台 一个平台全挂，另一个平台照常完成（spec §3.5 各自独立失败）', async () => {
    const bi = addCreator('bilibili', 'bi-3');
    const yt = addCreator('youtube', 'yt-3');
    const biFake = makeAdapter(() => {
      throw new Error('bilibili 今天不行');
    });
    const ytFake = makeAdapter(() => ({
      videos: [video('yt-3-v1')],
      nextCursor: null,
      reachedEnd: true,
    }));

    const summary = await runOnce(
      depsFor({
        adapters: adapterRegistry({ bilibili: biFake.adapter, youtube: ytFake.adapter }).adapters,
      }),
    );

    assert.equal(summary.platforms.bilibili, 'failed');
    assert.equal(summary.platforms.youtube, 'ok');
    assert.equal(summary.backfill.failed, 1);
    assert.equal(summary.backfill.done, 1);
    // bilibili 挂了，youtube 那一行必须**真的被同步了**（不是"没报错"就算过）。
    assert.equal(creatorRow(yt.id).backfill_done, 1);
    assert.equal(creatorRow(bi.id).consecutive_failures, 1);
    assert.equal(ytFake.calls.length, 1);
  });

  it('③ 没凭据的平台被跳过而不是崩：不记失败、不动那一行、连适配器都不去要', async () => {
    const bi = addCreator('bilibili', 'bi-4');
    const yt = addCreator('youtube', 'yt-4');
    const registry = adapterRegistry({
      // ⚠️ 故意**不给** youtube 的适配器：真注册表在这条路上抛 NoCredentialsError。
      bilibili: makeAdapter(() => ({ videos: [], nextCursor: null, reachedEnd: true })).adapter,
    });

    const summary = await runOnce(
      depsFor({ adapters: registry.adapters, platformStatus: ONLY_BILIBILI }),
    );

    assert.equal(summary.platforms.youtube, 'skipped:no-credentials');
    assert.equal(summary.platforms.twitch, 'skipped:no-credentials');
    assert.equal(summary.platforms.bilibili, 'ok');
    assert.deepEqual(summary.failures, [], '没凭据是**跳过**，不是失败（spec §9.1 ⑧）');
    assert.equal(summary.backfill.failed, 0);
    assert.equal(summary.backfill.tried, 1, '被跳过的平台不该计入 tried');

    // 跳过 = 那一行一个字段都不许动（动了就是"伪装成跑过了"）。
    const ytRow = creatorRow(yt.id);
    assert.equal(ytRow.backfill_done, 0);
    assert.equal(ytRow.last_synced_at, null);
    assert.equal(ytRow.consecutive_failures, 0);
    assert.equal(ytRow.last_error, null);
    assert.equal(creatorRow(bi.id).backfill_done, 1);

    /*
     * ★ 顺序：先看 `platformStatus()` 再要适配器（`tracking/index.ts` 的文件头写着这条）。
     *   反过来的话这里会抛 NoCredentialsError —— 而"跳过"就变成了"整轮崩在这儿"。
     */
    assert.deepEqual(registry.asked, ['bilibili']);
  });

  it('④-首面 第一页就被限流 ⇒ 游标停在原地，下一轮从同一页继续', async () => {
    const creator = addCreator('bilibili', 'throttled-5');
    forceCreatorState(creator.id, { lastCursor: '3', lastSyncedAt: NOW - HOUR });

    const first = makeAdapter(() => {
      throw new Error('bilibili: -412 风控');
    });
    const summary = await runOnce(
      depsFor({ adapters: adapterRegistry({ bilibili: first.adapter }).adapters }),
    );

    assert.equal(summary.backfill.failed, 1);
    const row = creatorRow(creator.id);
    assert.equal(row.last_cursor, '3', '★ 失败时游标必须停在原地 —— 否则那一页永远丢了');
    assert.equal(row.consecutive_failures, 1);
    assert.equal(row.last_synced_at, NOW - HOUR, '失败不许推水位');

    // 下一轮：游标必须还是 '3'（"下次从同一页继续"就是这一条）。
    const second = makeAdapter(() => ({ videos: [], nextCursor: null, reachedEnd: true }));
    await runOnce(depsFor({ adapters: adapterRegistry({ bilibili: second.adapter }).adapters }));
    assert.equal(second.calls.length, 1);
    assert.equal(second.calls[0]?.cursor, '3');
  });

  it('④-中间 翻到第二页才被限流 ⇒ 第一页写进去了、游标停在第二页，下一轮从那一页继续', async () => {
    const creator = addCreator('bilibili', 'mid-6');
    const attempts = makeAdapter((call) => {
      // 第一页成功（游标 null → '2'），第二页开始被限流。
      if (call.cursor === '2') throw new Error('bilibili: -412 风控（第二页）');
      return {
        videos: [video('mid-6-v1')],
        nextCursor: '2',
        reachedEnd: false,
      };
    });

    const summary = await runOnce(
      depsFor({ adapters: adapterRegistry({ bilibili: attempts.adapter }).adapters }),
    );

    assert.equal(attempts.calls.length, 2, '第一页成功后要接着翻第二页');
    assert.equal(summary.inserted, 1, '第一页的视频必须已经落库（先写后推游标）');
    assert.equal(summary.backfill.tried, 1);
    assert.equal(summary.backfill.done, 0);
    assert.equal(summary.backfill.failed, 1);

    const row = creatorRow(creator.id);
    assert.equal(row.last_cursor, '2', '★ 停在**成功那一页给的**游标上，不是 null、也不是 3');
    assert.equal(row.backfill_done, 0, '没翻到底就不许置 1');
    assert.equal(row.consecutive_failures, 1);

    // 下一轮从 '2' 开始 —— 也就是从"失败的那一页"继续，而不是从头、也不是跳过它。
    const resumed = makeAdapter(() => ({ videos: [], nextCursor: null, reachedEnd: true }));
    await runOnce(depsFor({ adapters: adapterRegistry({ bilibili: resumed.adapter }).adapters }));
    assert.equal(resumed.calls[0]?.cursor, '2');
  });

  it('★★ 真适配器 + 真 CLI：最后一页不满的回填要**跨两轮**才收尾（2026-09-16 最终评审）', async () => {
    /*
     * 为什么这一条要用**真**适配器（本文件唯一的一处）：
     *   本文件其它用例的假适配器是**自己**决定游标怎么走的，所以它们钉住的是
     *   "CLI 拿到一个停在原地的游标会怎么办"，而钉不住"bilibili 适配器**真的**会给一个
     *   停在原地的游标"。最终评审在后者上找到了不一致（spec §5.1 那张表第 2 行 vs 代码），
     *   而它的下游后果正好是这一条：**不满页但没存够 ⇒ 游标不许前进**
     *   （前进一页 = 上游截掉的那几条永久跳过）。于是"这一页之后就地收手"成为必然，
     *   这一轮也就**不可能**再判到底了 ⇒ 只能下一轮用涨上去的 `storedTotal` 再判一次。
     *   ⇒ "跨两轮收尾"不是副作用，是这条裁决的**形状**，所以它要被钉住：
     *     只要 `pickDueCreators` 不再捡回没翻完的博主，或者 `advanceCursor` 的
     *     `backfill_done` 判据漂了，这个博主的回填就**永远停在最后一页** ——
     *     每轮重抓、永不收尾，而摘要里看起来"每轮都在跑"（本文件开头列的那类故障）。
     */
    const creator = addCreator('bilibili', MID);

    /** 实测到的那对 WBI 密钥（`docs/platform-api-feasibility-notes.md:763`）⇒ 握手那条路才会给 mixinKey。 */
    const IMG_URL = 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png';
    const SUB_URL = 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png';

    /** 124 条：第 1/2 页各满 50，第 3 页只有 24（这就是"最后一页不满"）。 */
    const vlistFor = (pn: number): unknown[] => {
      const start = (pn - 1) * 50;
      const size = Math.max(0, Math.min(50, 124 - start));
      return Array.from({ length: size }, (_, index) => ({
        bvid: `BV1pn${String(pn)}v${String(index)}`,
        title: `第 ${String(pn)} 页第 ${String(index)} 条`,
        pic: 'http://i1.hdslb.com/bfs/archive/cover.jpg',
        created: NOW - 86_400,
        length: '05:00',
        play: 10,
        comment: 2,
      }));
    };

    const calls: string[] = [];
    const warns: string[] = [];
    const jsonResponse = (body: unknown): Response =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    /** 每一轮都是**新的**适配器实例（生产上每轮就是一个新进程）⇒ 会话不跨轮复用。 */
    const freshAdapter = (): PlatformAdapter => {
      const fetchImpl = (async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : String(input);
        calls.push(url);

        if (url.includes('/x/frontend/finger/spi')) {
          return jsonResponse({ code: 0, data: { b_3: 'buvid3', b_4: 'buvid4' } });
        }
        if (url.includes('/x/web-interface/nav')) {
          // 实测形状：未登录的 `-101`，而 WBI 密钥照样在。
          return jsonResponse({
            code: -101,
            message: '账号未登录',
            data: { wbi_img: { img_url: IMG_URL, sub_url: SUB_URL } },
          });
        }
        if (!url.includes('/arc/search')) {
          throw new Error(`假上游收到一个没预料到的请求：${url}`);
        }
        const pn = Number(new URL(url).searchParams.get('pn'));
        return jsonResponse({
          code: 0,
          message: 'ok',
          data: { list: { vlist: vlistFor(pn) }, page: { count: 124, pn, ps: 50 } },
        });
      }) as typeof fetch;

      return createBilibiliAdapter({
        fetchImpl,
        // 假上游从不回 `-412` ⇒ 走到退避就是这条用例的假设坏了，要红。
        sleep: async () => {
          throw new Error('这一轮不该出现退避（假上游从不回 -412）');
        },
        warn: (message: string) => {
          warns.push(message);
        },
      });
    };

    const listCalls = (): string[] => calls.filter((url) => url.includes('/arc/search'));

    // ---- 第一轮：翻到不满的那一页就收手，不收尾 ----
    const first = await runOnce(
      depsFor({
        adapters: adapterRegistry({ bilibili: freshAdapter() }).adapters,
        platformStatus: ONLY_BILIBILI,
      }),
    );

    assert.equal(first.backfill.tried, 1);
    assert.equal(first.backfill.failed, 0, '这一轮没有任何失败 —— 它只是"还没翻完"');
    assert.equal(first.backfill.done, 0, '★ 不满页那一轮不许收尾（收尾要靠下一轮的 storedTotal）');
    assert.equal(first.inserted, 124, '第 3 页那 24 条也必须已经落库（先写库、再决定游标）');
    assert.equal(listCalls().length, 3, 'pn=1/2/3 各一次；第 3 页之后就地收手，不许接着翻 pn=4');

    const rowAfterFirst = creatorRow(creator.id);
    assert.equal(
      rowAfterFirst.last_cursor,
      '3',
      '★ 停在**不满的那一页**上 —— 前进一页就是从第 50 条开始，被截掉的 26 条再也拿不到',
    );
    assert.equal(rowAfterFirst.backfill_done, 0);
    assert.equal(rowAfterFirst.last_synced_at, NOW, '没翻完也是成功的一轮，水位照常前进');

    /*
     * ★ 三页里**只有**第 3 页留了痕迹：前两页是满页，而"我们 50、上游 124"是回填的
     *   正常落后，不是异常（spec §5.1 那条痕迹的触发条件里必须有"在候选的结尾上"）。
     */
    assert.equal(warns.length, 1, `只该有最后一页那一行，实到：${JSON.stringify(warns)}`);
    assert.match(warns[0] ?? '', /我们已存=100/);

    // ---- 第二轮：同一个游标、同一页，这次 storedTotal 已经等于 count ⇒ 到底 ----
    const second = await runOnce(
      depsFor({
        adapters: adapterRegistry({ bilibili: freshAdapter() }).adapters,
        platformStatus: ONLY_BILIBILI,
        now: NOW + 600,
      }),
    );

    assert.equal(
      second.backfill.tried,
      1,
      '第一轮没翻完的博主必须**仍然到点**（否则回填永不收尾）',
    );
    assert.equal(second.backfill.done, 1);
    assert.equal(second.backfill.failed, 0);
    assert.equal(second.inserted, 0, '第二轮重复抓的是同一页，`ON CONFLICT` 幂等');
    assert.equal(second.updated, 24, '那 24 条是"更新"，不是"新增"');
    assert.equal(listCalls().length, 4, '第二轮只补 1 个请求：停在 pn=3，就从 pn=3 再判一次');

    const rowAfterSecond = creatorRow(creator.id);
    assert.equal(rowAfterSecond.backfill_done, 1, '★ 第二轮才收尾（这就是"可以慢点"买到的东西）');
    assert.equal(rowAfterSecond.last_cursor, null, '收尾 ⇒ 游标清空（下一次从第一页开始看新的）');
    assert.equal(rowAfterSecond.consecutive_failures, 0);
    assert.equal(warns.length, 1, '第二轮两个数相等 ⇒ 一行都不该多');
  });

  it('⑤-回填 limits.backfill 是硬上限：5 个待办只处理 2 个（spec §3.3）', async () => {
    const ids = ['lim-1', 'lim-2', 'lim-3', 'lim-4', 'lim-5'].map(
      (e) => addCreator('bilibili', e).id,
    );
    const { adapter, calls } = makeAdapter(() => ({
      videos: [],
      nextCursor: null,
      reachedEnd: true,
    }));

    const summary = await runOnce(
      depsFor({
        adapters: adapterRegistry({ bilibili: adapter }).adapters,
        limits: { backfill: 2 },
      }),
    );

    assert.equal(summary.backfill.tried, 2);
    assert.equal(summary.backfill.done, 2);
    assert.equal(calls.length, 2, '一个博主都不许多抓');
    assert.equal(new Set(calls.map((c) => c.creatorId)).size, 2);

    /*
     * ⚠️ 挑中哪两个**不许**被断言：5 行的前两个排序键全平（都是 0 次失败、都没同步过），
     *    最终落到随机 UUID 的 `id` 序 ⇒ 写死"是某两个"的断言会随机变红。
     *    这里断言的是那条不变量本身：恰好 2 行被推了水位，其余 3 行一动不动。
     */
    const synced = ids.filter((id) => creatorRow(id).last_synced_at === NOW);
    assert.equal(synced.length, 2);
    const untouched = ids.filter((id) => creatorRow(id).last_synced_at === null);
    assert.equal(untouched.length, 3, '没被处理到的那 3 个必须原封不动（它们下一轮还在）');
  });

  it('⑤-翻页 limits.pages 是硬上限：每轮最多翻那么多页（没翻完不是失败）', async () => {
    const creator = addCreator('bilibili', 'pages-7');
    const { adapter, calls } = makeAdapter((call) => ({
      videos: [video(`pages-7-v${String(Number(call.cursor ?? '1'))}`)],
      nextCursor: String(Number(call.cursor ?? '1') + 1),
      reachedEnd: false, // 永远没到底：只能靠 limits.pages 收手
    }));

    const summary = await runOnce(
      depsFor({ adapters: adapterRegistry({ bilibili: adapter }).adapters, limits: { pages: 3 } }),
    );

    assert.equal(calls.length, 3, 'limits.pages = 3 ⇒ 最多 3 次 fetchPage');
    assert.equal(new Set(calls.map((c) => c.creatorId)).size, 1);
    assert.deepEqual(summary.backfill, { tried: 1, done: 0, failed: 0 }, '没翻完 ≠ 失败');
    assert.deepEqual(summary.failures, []);
    assert.equal(summary.inserted, 3);

    // 3 页之后游标停在下一页的入口（'4'），下一轮接着翻。
    const row = creatorRow(creator.id);
    assert.equal(row.last_cursor, '4');
    assert.equal(row.backfill_done, 0);
  });

  it('★ 适配器拿到的 storedTotal 恰好是"这个 creator 的行数"（连隐藏的也算）', async () => {
    const creator = addCreator('bilibili', 'total-8');
    // 两行：一行可见、一行被编辑手工隐藏过。spec §5.1 的残余风险就在这一条上。
    upsertVideos(creator.id, 'bilibili', [video('total-8-a'), video('total-8-b')], NOW);
    getDb()
      .prepare('UPDATE tracked_videos SET status = ? WHERE platform = ? AND external_id = ?')
      .run('hidden', 'bilibili', 'total-8-b');

    const { adapter, calls } = makeAdapter((call) => {
      if (call.cursor === null) {
        return { videos: [video('total-8-c')], nextCursor: '2', reachedEnd: false };
      }
      return { videos: [], nextCursor: null, reachedEnd: true };
    });

    await runOnce(depsFor({ adapters: adapterRegistry({ bilibili: adapter }).adapters }));

    /*
     * ★★ 两件事各一个断言，它们防的是两类不同的静默故障：
     *    · 2 而不是 1 ⇒ **不许**按 `status = 'visible'` 过滤。过滤了的话，
     *      一个被手工隐藏过几条的 UP 主 `storedTotal` 永远追不上上游的 `count`，
     *      `reachedEnd` 永远不为真 ⇒ 这个频道**每轮都在重翻、永远停不下来**。
     *    · 3 而不是 2 ⇒ 每一页都**重算**（第一页写进去的那条要算进第二页）。
     */
    assert.equal(calls[0]?.storedTotal, 2, 'storedTotal 必须是这个 creator 的**行数**，不过滤隐藏');
    assert.equal(calls[1]?.storedTotal, 3, '写完第一页之后要重新数一遍，不能把旧值带过去');
  });

  it('★ 游标没前进（§2.4 那个空页）⇒ 立刻收手，不把 limits.pages 次请求全打在风控上', async () => {
    const creator = addCreator('bilibili', 'stuck-9');
    forceCreatorState(creator.id, { lastCursor: '5', lastSyncedAt: NOW - HOUR });
    const { adapter, calls } = makeAdapter(() => ({
      // §2.4 实测到的形态：code=0、vlist=[]，而游标按 §5.1 的表格停在原地。
      videos: [],
      nextCursor: '5',
      reachedEnd: false,
    }));

    const summary = await runOnce(
      depsFor({ adapters: adapterRegistry({ bilibili: adapter }).adapters, limits: { pages: 20 } }),
    );

    assert.equal(calls.length, 1, '★ 游标没前进就是这一页没进展，再打 19 次只是推高风险分');
    assert.equal(summary.backfill.failed, 0, '上游回了一个正常的空页 —— 这不是失败');
    assert.equal(summary.backfill.done, 0, '也没到底，所以不是"完成"');
    const row = creatorRow(creator.id);
    assert.equal(row.last_cursor, '5', '游标原地');
    assert.equal(row.consecutive_failures, 0);
  });

  it('③-握手失败 ⇒ 本轮放弃这个平台的**其余**博主，且平台报 failed（spec §5.1）', async () => {
    const first = addCreator('bilibili', 'hand-10a');
    const second = addCreator('bilibili', 'hand-10b');
    const other = addCreator('youtube', 'hand-10c');
    const biFake = makeAdapter(() => {
      throw new PlatformHandshakeError('bilibili', 'finger/spi', '连不上');
    });
    const ytFake = makeAdapter(() => ({ videos: [], nextCursor: null, reachedEnd: true }));
    const registry = adapterRegistry({ bilibili: biFake.adapter, youtube: ytFake.adapter });

    const summary = await runOnce(depsFor({ adapters: registry.adapters }));

    assert.equal(summary.platforms.bilibili, 'failed');
    assert.equal(summary.failures.length, 1, '握手失败只记一次 —— 不是每个博主各记一条');
    assert.equal(biFake.calls.length, 1, '★ 握手失败后不许再用同样的空 cookie 去碰下一个博主');
    // 两个 bilibili 博主里只有一个被"试"过；另一个只是没轮到（它下一轮照旧到点）。
    assert.equal(summary.backfill.tried, 2, 'youtube 那个仍然要试');
    const untouched = [first.id, second.id].find((id) => creatorRow(id).consecutive_failures === 0);
    assert.ok(untouched, '总得有一个 bilibili 博主没被碰过');
    assert.equal(creatorRow(untouched).last_synced_at, null);
    assert.equal(creatorRow(other.id).backfill_done, 1, '另一个平台必须跑完');
  });

  it('增量那条路：backfill_done=1 且久未同步的博主会被增量同步', async () => {
    const creator = addCreator('bilibili', 'inc-11');
    forceCreatorState(creator.id, {
      backfillDone: true,
      lastSyncedAt: NOW - HOUR - 1,
      lastCursor: null,
    });
    const { adapter, calls } = makeAdapter(() => ({
      videos: [],
      nextCursor: null,
      reachedEnd: true,
    }));

    const summary = await runOnce(
      depsFor({ adapters: adapterRegistry({ bilibili: adapter }).adapters }),
    );

    assert.deepEqual(
      summary.backfill,
      { tried: 0, done: 0, failed: 0 },
      '回填过了就不该再进回填队列',
    );
    assert.deepEqual(summary.incremental, { tried: 1, done: 1, failed: 0 });
    assert.equal(calls[0]?.cursor, null, '收尾过的那一行游标是 NULL ⇒ 增量从第一页（最新的）开始');
    assert.equal(creatorRow(creator.id).last_synced_at, NOW);
  });
});

// ---------------------------------------------------------------------------
// ② 运行摘要与退出码 —— "今天没有新视频"与"今天全挂了"必须能分开
// ---------------------------------------------------------------------------

describe('运行摘要与退出码（spec §6.3）', () => {
  it('★ 全都失败：退出码非零，摘要里点得出 creator / platform / 错误原文', async () => {
    const a = addCreator('bilibili', 'allfail-12a');
    const b = addCreator('bilibili', 'allfail-12b');
    const { adapter } = makeAdapter(() => {
      throw new Error('bilibili: -412 风控');
    });

    const summary = await runOnce(
      depsFor({
        adapters: adapterRegistry({ bilibili: adapter }).adapters,
        platformStatus: ONLY_BILIBILI,
      }),
    );
    const out = formatSummary(summary, NOW, NOW + 3);

    assert.equal(summary.inserted, 0, '一条新视频都没有 —— 这和"今天没有新视频"要能分开');
    assert.equal(
      exitCodeFor(summary),
      1,
      '★ 全平台失败必须是非零码，否则 journald 里它和空轮询一模一样',
    );
    assert.match(out, /回填: 试 2 个 \/ 完成 0 个 \/ 失败 2 个/);
    assert.match(out, /新增视频 0 条 \/ 更新 0 条/);
    assert.match(
      out,
      /平台: bilibili failed \/ youtube skipped:no-credentials \/ twitch skipped:no-credentials/,
    );
    for (const id of [a.id, b.id]) {
      assert.ok(
        out.includes(`⚠️ 失败样例: creator=${id} platform=bilibili error=bilibili: -412 风控`),
        `摘要里必须有 ${id} 这一条失败（只打一条样例的话，另一条就看不见了）`,
      );
    }
  });

  it('★ 今天没有新视频：退出码 0，摘要里一条失败都没有（与上一条恰好相反）', async () => {
    const creator = addCreator('bilibili', 'quiet-13');
    const { adapter } = makeAdapter(() => ({ videos: [], nextCursor: null, reachedEnd: true }));

    const summary = await runOnce(
      depsFor({
        adapters: adapterRegistry({ bilibili: adapter }).adapters,
        platformStatus: ONLY_BILIBILI,
      }),
    );
    const out = formatSummary(summary, NOW, NOW + 1);

    assert.equal(summary.inserted, 0);
    assert.equal(summary.updated, 0);
    assert.equal(exitCodeFor(summary), 0, '空轮询是正常的 —— 它不该让 timer 记成 failed');
    assert.match(out, /回填: 试 1 个 \/ 完成 1 个 \/ 失败 0 个/);
    assert.match(out, /新增视频 0 条 \/ 更新 0 条/);
    assert.match(
      out,
      /平台: bilibili ok \/ youtube skipped:no-credentials \/ twitch skipped:no-credentials/,
    );
    assert.ok(!out.includes('失败样例'), '没有失败就不该有那一行');
    assert.notEqual(creatorRow(creator.id).last_synced_at, null);
  });

  it('没凭据的平台不影响退出码（跳过不是失败）', async () => {
    addCreator('youtube', 'skipped-14');
    const { adapter } = makeAdapter(() => ({ videos: [], nextCursor: null, reachedEnd: true }));

    const summary = await runOnce(
      depsFor({
        adapters: adapterRegistry({ bilibili: adapter }).adapters,
        platformStatus: ONLY_BILIBILI,
      }),
    );

    assert.equal(exitCodeFor(summary), 0);
    assert.match(formatSummary(summary, NOW, NOW + 1), /youtube skipped:no-credentials/);
  });

  it('还没翻完的博主会被点名（否则摘要里"试 3 / 完成 1"看不出剩下两个去哪了）', () => {
    const summary = {
      backfill: { tried: 3, done: 1, failed: 0 },
      incremental: { tried: 0, done: 0, failed: 0 },
      inserted: 0,
      updated: 0,
      platforms: { ...ONLY_BILIBILI },
      failures: [],
    };
    const out = formatSummary(summary, NOW, NOW + 1);
    assert.match(out, /回填: 试 3 个 \/ 完成 1 个 \/ 失败 0 个（还有 2 个没翻完，下一轮接着翻）/);
    assert.equal(exitCodeFor(summary), 0);
  });

  it('★ 限额就是 spec §10 冻结的那三个数（改了它，§3.3 的配额算术就不成立）', () => {
    assert.deepEqual(TRACK_LIMITS, { backfill: 20, pages: 20, incremental: 40 });
  });
});

// ---------------------------------------------------------------------------
// ③ CLI 壳：--dry-run 与退出码真的接上去了
// ---------------------------------------------------------------------------

describe('CLI 壳', () => {
  it('★ --dry-run 只列将要处理谁：不抓、不写、不碰网络', async () => {
    const bi = addCreator('bilibili', 'dry-15bi');
    const yt = addCreator('youtube', 'dry-15yt');
    const registry = adapterRegistry({
      bilibili: makeAdapter(() => {
        throw new Error('--dry-run 不该抓任何一页');
      }).adapter,
    });

    const { result, out } = await captureStdout(() =>
      main(['--dry-run'], depsFor({ adapters: registry.adapters, platformStatus: ONLY_BILIBILI })),
    );

    assert.equal(result, 0, '预演不是失败');
    assert.ok(out.includes(bi.id), '要列出待办的博主 id');
    assert.ok(out.includes(yt.id), 'youtube 那个也在待办里（只是这轮会被跳过）');
    // 一个字段都不许动。
    assert.equal(creatorRow(bi.id).last_synced_at, null);
    assert.equal(creatorRow(bi.id).last_cursor, null);
    assert.equal(creatorRow(bi.id).backfill_done, 0);
    assert.equal(
      registry.asked.length,
      0,
      '★ 预演连适配器都不去要 —— 不抓网络是结构上的，不是靠自觉',
    );
  });

  it('★ 有失败时 main 返回 1（`process.exitCode` 就是照着它设的）', async () => {
    addCreator('bilibili', 'exit-16');
    const { adapter } = makeAdapter(() => {
      throw new Error('bilibili: -412 风控');
    });

    const { result, out } = await captureStdout(() =>
      main([], depsFor({ adapters: adapterRegistry({ bilibili: adapter }).adapters })),
    );

    assert.equal(result, 1);
    assert.match(out, /失败样例/);
  });

  it('全部成功时 main 返回 0', async () => {
    addCreator('bilibili', 'exit-17');
    const { adapter } = makeAdapter(() => ({ videos: [], nextCursor: null, reachedEnd: true }));

    const { result, out } = await captureStdout(() =>
      main([], depsFor({ adapters: adapterRegistry({ bilibili: adapter }).adapters })),
    );

    assert.equal(result, 0);
    assert.match(out, /track: 本轮 开始=/);
    assert.match(out, /结束=/);
  });
});
