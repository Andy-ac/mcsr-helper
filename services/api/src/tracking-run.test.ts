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
const {
  exitCodeFor,
  formatSummary,
  main,
  runOnce,
  TRACK_LIMITS,
  VERIFY_MAX_MISSING_RATIO,
  VERIFY_MIN_BATCH_FOR_RATIO,
} = await import('./track');
const { createBilibiliAdapter } = await import('./tracking/bilibili');
const { TwitchRejectedError } = await import('./tracking/twitch');
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
/**
 * spec §10 冻结的每次运行上限：回填 20 / 翻 20 页 / 增量 40 / **核对 200**。
 *
 * ⚠️ 第四格（`verify`）是 T5 加的，而且它**必须在 `depsFor` 的默认值里**：
 *    `RunDeps.limits` 是一个整体，核对阶段读的就是 `deps.limits.verify`
 *    （少了它 ⇒ `undefined` ⇒ 一条候选都挑不出来 ⇒ 那一组断言全变成"没查"）。
 */
const LIMITS = { backfill: 20, pages: 20, incremental: 40, verify: 200 };

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

/**
 * 造一支**已经躺在库里**的视频，返回它的行 id（`tracked_videos.id`，不是 `external_id`）。
 *
 * ⚠️ 它走 `upsertVideos`，**不自己写一句 INSERT**（`tracking-store.test.ts` 的 `insertRaw`
 *    是另一种，那边要的初值"只有同步过程才会产生"：隐藏的、发布得很早的）。这一组要的初值
 *    恰好是**今天的写入路径会给出来的那一种**：`status = 'visible'`、`first_seen_at = NOW`、
 *    迁移 021 那三列是 `NULL`（"从没查过、没被隐藏过"）—— 而核对那一组的断言正是对着这三列。
 *    少写一句 SQL 就少一处会漂的列清单：`upsertVideos` 的列清单已经由 T3 的测试钉着了。
 * ⚠️ `publishedAt` 没给就是 `NULL`（不是 0，Global Constraint 6）：`pickVerifiableVideos`
 *    对 `published_at IS NULL` 的行**永远不挑**（"不知道多老"不等于"够老"）。
 */
function insertRaw(
  creatorId: string,
  platform: TrackPlatform,
  externalId: string,
  over: { publishedAt?: number | null } = {},
): string {
  upsertVideos(
    creatorId,
    platform,
    [video(externalId, { publishedAt: over.publishedAt ?? null })],
    NOW,
  );
  const row = getDb()
    .prepare('SELECT id FROM tracked_videos WHERE creator_id = ? AND external_id = ?')
    .get(creatorId, externalId) as { id: string } | undefined;
  assert.ok(row, `夹具没写进去：${platform}/${externalId}`);
  return row.id;
}

/**
 * 把 `node:sqlite` 读出来的一行/一批行**展开成普通对象**再断言。
 *
 * ⚠️★ 不是洁癖：`node:sqlite` 的行对象**原型不是 `Object.prototype`**，而本文件从
 *    `node:assert/strict` 拿的 `assert.deepEqual` 就是 `deepStrictEqual` —— 它会**连原型一起比**，
 *    于是"字段一模一样"的两行也会红在原型上（`user-live-links.test.ts:176` 记着同一个坑，
 *    那里用的也是 `{ ...row }`；`tracking-store.test.ts` 则把行拍成元组来绕开它）。
 *    ⚠️ 这个坑很容易被读成"数据真的不对"：报错里那两行长得一样，只有 `[Object: null prototype]`
 *    那一行小字不同。
 */
function plain<T extends object>(row: T): T {
  return { ...row };
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

/**
 * 核对的今天（spec §7 第 1 条的用户裁决：**只做 Twitch**）：只有 twitch 能用。
 *
 * ⚠️ 那两句 `skipped:no-credentials` 不是装饰：核对阶段**第一步**就按它跳过平台
 *    （照抄回填/增量那条路，理由也一样 —— 没凭据的平台适配器会抛）。前两个平台
 *    写成 `ok` 的话，`adapterRegistry` 里没给它们适配器 ⇒ 那一步会抛
 *    `NoCredentialsError`，而"跳过"就变成了"整轮崩"。
 */
const ONLY_TWITCH: Record<TrackPlatform, 'ok' | 'skipped:no-credentials'> = {
  bilibili: 'skipped:no-credentials',
  youtube: 'skipped:no-credentials',
  twitch: 'ok',
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
     * ⚠️ 断言的是"**只有 bilibili** 被问过"，不是"恰好被问一次"：T5 的核对阶段同样要先
     *   拿到适配器才看得出这个平台有没有 `existingVideoIds` 那个能力，所以它每一轮也会问一次
     *   （见下一条用例的下一段注释）。跳过的那两个平台**一次都到不了这里**，这才是本句钉的。
     */
    assert.deepEqual(
      [...new Set(registry.asked)],
      ['bilibili'],
      `只有 bilibili 该被问到，实到：${JSON.stringify(registry.asked)}`,
    );
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
      /*
       * ⚠️ 核对的空格子**必须显式写出来**（T5 之后 `RunSummary` 多了这两个字段）：
       *    这一条是**直接**造一个摘要对象喂给 `formatSummary`（不走 `runOnce`），
       *    少一格就是运行期 TypeError（"读不到 undefined 的 checked"）——
       *    而它看起来会像摘要函数坏了，不是夹具少了一格。
       */
      verify: { checked: 0, hidden: 0, failed: 0 },
      verifyErrors: [],
      inserted: 0,
      updated: 0,
      platforms: { ...ONLY_BILIBILI },
      failures: [],
    };
    const out = formatSummary(summary, NOW, NOW + 1);
    assert.match(out, /回填: 试 3 个 \/ 完成 1 个 \/ 失败 0 个（还有 2 个没翻完，下一轮接着翻）/);
    assert.equal(exitCodeFor(summary), 0);
  });

  it('★ 限额就是 spec §10 冻结的那四个数（改了它，§3.3 的配额算术就不成立）', () => {
    /*
     * ⚠️ 四个数是**整体**冻结的：前三格是 §3.3 那条"40 个频道/次 ≈ 1000–2000 units/天"的
     *    前提，第四格（`verify`，T5 加的）是"每轮最多问上游 200 个 id"。
     *    把这一条断言放宽成"包含这几个键"就等于把冻结表变成可调的 —— 那正是 `TRACK_LIMITS`
     *    那段注释里说的"顺手能调大"。
     */
    assert.deepEqual(TRACK_LIMITS, { backfill: 20, pages: 20, incremental: 40, verify: 200 });
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

  it('★ --dry-run 也报核对的待办数，而且照旧一个字段都不写（只读）', async () => {
    const c = addCreator('twitch', 'dry-verify');
    const old = insertRaw(c.id, 'twitch', 'v-old', { publishedAt: NOW - 30 * 86400 });
    // 太新 ⇒ 不算待办（6 天粗筛）：预演报的数必须与核对阶段真会问的那些**一致**。
    insertRaw(c.id, 'twitch', 'v-fresh', { publishedAt: NOW - 3600 });
    const registry = adapterRegistry({
      twitch: makeAdapter(() => {
        throw new Error('--dry-run 不该抓任何一页');
      }).adapter,
    });

    const { result, out } = await captureStdout(() =>
      main(['--dry-run'], depsFor({ adapters: registry.adapters, platformStatus: ONLY_TWITCH })),
    );

    assert.equal(result, 0);
    assert.match(out, /核对 待办 1 个（每平台上限 200）/);
    assert.equal(registry.asked.length, 0, '★ 预演连适配器都不去要（核对那一行是纯 SELECT）');
    /*
     * ⚠️ 这一格是"预演只读"里最容易破的一处：`pickVerifiableVideos` 看起来像"挑出来就要写回去"，
     *    而它只是一句 SELECT。发了预演却发现一批 `verify_checked_at` 被盖上，
     *    会让轮转游标整轮错位，而预演的输出看起来完全正常。
     */
    assert.deepEqual(
      plain(
        getDb()
          .prepare('SELECT status, hidden_at, verify_checked_at FROM tracked_videos WHERE id = ?')
          .get(old) as {
          status: string;
          hidden_at: number | null;
          verify_checked_at: number | null;
        },
      ),
      { status: 'visible', hidden_at: null, verify_checked_at: null },
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

// ---------------------------------------------------------------------------
// ④ 第三个阶段「核对」（spec §6）—— 问上游"这些 VOD 你还认不认"，不认的转 hidden
// ---------------------------------------------------------------------------

/**
 * 这一组守的是**同一类故障的第三个入口**：不抛、只是结果变成另一个样子。
 *   · 上游失败被当成"这些 id 都不存在" ⇒ **一次静默的批量下架**（spec §4 那条 ★★）；
 *   · 上游失败**什么都不写**（连 `verify_checked_at` 都不写）⇒ 下一轮再问一遍是幂等的，
 *     而"记成查过了"会让这一批轮到队尾（`tracked-videos.ts` 第九节）；
 *   · 平台**没有这个能力**却去调它 ⇒ 每个平台每轮一条假失败，退出码永远是 1（狼来了）。
 *
 * ⚠️★ 前两条用例都带 `limits: { backfill: 0 }`，这是**有意**的（本任务对夹具的唯一一处补充）：
 *    `addCreator` 造出来的博主是**待回填**的，而这两条造的假适配器里 `fetchPage` 是
 *    `throw`（"不该走到这里"）⇒ 不关掉回填，那一下会先记下一条**创作者级**失败，
 *    退出码于是**与核对无关地**变成 1 —— 下一条用例的 `exitCodeFor === 0` 会红，
 *    而上一条的 `=== 1` 会**假绿**（它的理由从"核对失败"漂成"抓取失败"）。
 *    ⇒ 关掉回填与增量之后，退出码只可能来自核对那一行，断言才是它看上去的那个意思。
 *    ⚠️ 另一条路（把 `fetchPage` 改成返回一个成功的空页）也能让 0/1 对上，但那样
 *      "核对确实是退出码的唯一来源"就没被钉住。核对的成功**不依赖**抓取做过什么
 *      （`track.ts` 第四节那条裁决），所以让它单独站着才是这一组要表达的东西。
 *    ⚠️ 另一层保险在下面那条 `★★ 创作者级的错误类型` 用例里：那里抓取是**成功**的，
 *      所以"一个阶段失败不影响另一个阶段"是**正面**钉住的，不是靠关掉它。
 */
describe('★ 核对阶段（spec §6）', () => {
  it('★★ 上游失败 ⇒ 零隐藏：状态没变、verify_checked_at 没写、摘要里有一行核对失败、退出码 1', async () => {
    const c = addCreator('twitch', 'tw-fail');
    const v = insertRaw(c.id, 'twitch', 'v-1', { publishedAt: NOW - 30 * 86400 });
    const adapter: PlatformAdapter = {
      async resolveCreator() {
        throw new Error('不该走到这里');
      },
      async fetchPage() {
        throw new Error('不该走到这里');
      },
      async existingVideoIds() {
        throw new Error('twitch: 500 boom');
      },
    };
    const summary = await runOnce(
      depsFor({
        adapters: adapterRegistry({ twitch: adapter }).adapters,
        platformStatus: ONLY_TWITCH,
        limits: { backfill: 0 },
      }),
    );

    /*
     * ★★ 一次断言**四列**：这一批**什么都不许写**。
     *    `status` / `hidden_at` / `hidden_reason` 三列是"一条都没隐藏"；
     *    而 `verify_checked_at` 那一格才是**最容易漏**的一半 —— 写它的后果不是当场出错，
     *    而是这一行**掉到轮转游标的队尾**（`COALESCE(verify_checked_at, 0) ASC`），
     *    要等所有别的行都轮过一遍才回来，而每一轮的摘要看起来都正常。
     */
    const row = plain(
      getDb()
        .prepare(
          'SELECT status, hidden_at, hidden_reason, verify_checked_at FROM tracked_videos WHERE id = ?',
        )
        .get(v) as {
        status: string;
        hidden_at: number | null;
        hidden_reason: string | null;
        verify_checked_at: number | null;
      },
    );
    assert.deepEqual(row, {
      status: 'visible',
      hidden_at: null,
      hidden_reason: null,
      verify_checked_at: null,
    });
    assert.equal(summary.verify.failed, 1);
    assert.equal(summary.verify.hidden, 0);
    assert.match(formatSummary(summary, NOW, NOW), /⚠️ 核对失败: platform=twitch/);
    assert.equal(exitCodeFor(summary), 1);
  });

  it('★ 上游少返回一个 ⇒ 只隐藏那一个；每行都写了 verify_checked_at', async () => {
    const c = addCreator('twitch', 'tw-ok');
    const keep = insertRaw(c.id, 'twitch', 'v-keep', { publishedAt: NOW - 30 * 86400 });
    const gone = insertRaw(c.id, 'twitch', 'v-gone', { publishedAt: NOW - 30 * 86400 });
    const adapter: PlatformAdapter = {
      async resolveCreator() {
        throw new Error('x');
      },
      async fetchPage() {
        throw new Error('x');
      },
      async existingVideoIds() {
        return new Set(['v-keep']);
      },
    };
    const summary = await runOnce(
      depsFor({
        adapters: adapterRegistry({ twitch: adapter }).adapters,
        platformStatus: ONLY_TWITCH,
        // 同上：这一条量的也是核对阶段（回填关掉才谈得上"退出码 0 是核对给的"）。
        limits: { backfill: 0 },
      }),
    );
    assert.deepEqual(summary.verify, { checked: 2, hidden: 1, failed: 0 });
    assert.match(formatSummary(summary, NOW, NOW), /核对: 查 2 个 \/ 隐藏 1 个/);
    assert.equal(exitCodeFor(summary), 0, '隐藏了几条**不是**失败 —— 这一轮是成功的');
    const statuses = getDb()
      .prepare('SELECT external_id, status FROM tracked_videos ORDER BY external_id')
      .all()
      .map(plain);
    assert.deepEqual(statuses, [
      { external_id: 'v-gone', status: 'hidden' },
      { external_id: 'v-keep', status: 'visible' },
    ]);

    /*
     * ★ 标题承诺的另一半：**在的和不在的都写**了 `verify_checked_at`（`applyVerifyResult`
     *   那句"每一个被问到的 id 都写"）。只写"还在的"那些的代价很具体：消失的那一行
     *   停在轮转游标的最前面，**每一轮都被挑回来重问一遍**，而每一轮看起来都正常。
     */
    const checkedAt = (id: string): number | null => {
      const checked = getDb()
        .prepare('SELECT verify_checked_at FROM tracked_videos WHERE id = ?')
        .get(id) as { verify_checked_at: number | null } | undefined;
      assert.ok(checked, `库里没有这一行：${id}`);
      return checked.verify_checked_at;
    };
    assert.equal(checkedAt(keep), NOW, '还在的那一行也要写 —— 不写它会被再挑一次');
    assert.equal(checkedAt(gone), NOW, '★ 消失的那一行更要写：不写就每轮重问一遍');
  });

  it('★ 平台没有这个能力 ⇒ 一条都不查，摘要里是 0/0，退出码 0', async () => {
    const c = addCreator('bilibili', 'bi-no-verify');
    /*
     * ⚠️ 夹具**故意放一条够老的可见视频**：核对阶段因此**有活可干**，
     *    "一条都不查"才是可观测的。没有它的话这一条在"能力检查整个漏掉"的实现下
     *    照样通过（候选是 0 ⇒ 循环体压根不进 ⇒ 摘要还是 0/0/0，一条断言都不会红）。
     */
    const bv = insertRaw(c.id, 'bilibili', 'BV-no-verify', { publishedAt: NOW - 30 * 86400 });
    const { adapter } = makeAdapter(() => ({ videos: [], nextCursor: null, reachedEnd: true }));
    // 前提本身也要钉住：bilibili 适配器**根本没有**这个能力（spec §4：今天只有 Twitch 有）。
    assert.equal(adapter.existingVideoIds, undefined, 'bilibili 不该有核对能力');

    const summary = await runOnce(
      depsFor({
        adapters: adapterRegistry({ bilibili: adapter }).adapters,
        platformStatus: ONLY_BILIBILI,
      }),
    );
    assert.deepEqual(summary.verify, { checked: 0, hidden: 0, failed: 0 });
    assert.match(formatSummary(summary, NOW, NOW), /核对: 查 0 个 \/ 隐藏 0 个/);
    assert.equal(exitCodeFor(summary), 0);

    // ★ "一条都不查"必须真的**一个字段都没写**：那一行的三列原封不动。
    assert.deepEqual(
      plain(
        getDb()
          .prepare('SELECT status, hidden_at, verify_checked_at FROM tracked_videos WHERE id = ?')
          .get(bv) as {
          status: string;
          hidden_at: number | null;
          verify_checked_at: number | null;
        },
      ),
      { status: 'visible', hidden_at: null, verify_checked_at: null },
    );
  });

  it('★★ 上游用一个**创作者级**的错误类型拒绝 ⇒ 一行核对失败 + 非零退出码，而这一轮照样跑完', async () => {
    /*
     * 这一条钉的是 T2 评审量到的那个**真风险**（不是假想）：`existingVideoIds` 里
     * 收到的若不是 401/403/429/5xx（比如"一批 100 个 id"那个假设不成立时的 400），
     * 抛出来的是 `TwitchRejectedError` **原样** —— 一个平时表示"**这个 creator** 的
     * 数据有问题"的类型（`twitch.ts` 那一段注释把这条不对称写明了）。
     *
     * ★ 核对**不是按 creator 问的**：一批里混着好几个博主的视频，没有任何一个"坏博主"
     *   可指。所以这条路只有两种正确形状，而这一条把**两种都钉住**：
     *   · 记成 `verifyErrors` 里的**一行**（与 `failures` 分开，摘要里指不出人，也不指错人）；
     *   · 退出码非零（§6.3 那条护栏：否则"每轮核对都失败"在 journald 里看不出来）。
     * ⚠️ 认不出来的错误类型漏出去（比如只 `catch` 已知的那几个类）会让整轮**崩在核对这一步**，
     *    表现是"每次同步都被打断"——**回填与增量已经做的工作全部作废**，而库里还留着半轮的结果。
     *    所以这一条**故意让抓取成功**：抓取写进去的那条新视频必须还在（另两个阶段的工作
     *    不受影响），而且一条都没隐藏。
     */
    const c = addCreator('twitch', 'tw-rejected');
    insertRaw(c.id, 'twitch', 'v-stale', { publishedAt: NOW - 30 * 86400 });

    const adapter: PlatformAdapter = {
      async resolveCreator() {
        throw new Error('不该走到这里');
      },
      /** 抓取这一侧**正常**：它这一轮真的会写进去一条新视频（就是"别的阶段的工作"）。 */
      async fetchPage() {
        return { videos: [video('v-new')], nextCursor: null, reachedEnd: true };
      },
      async existingVideoIds() {
        throw new TwitchRejectedError('Get Videos 回了 400（一批 100 个 id 的假设不成立）');
      },
    };

    const summary = await runOnce(
      depsFor({
        adapters: adapterRegistry({ twitch: adapter }).adapters,
        platformStatus: ONLY_TWITCH,
      }),
    );

    // ① 摘要里**恰好一行**核对失败，而且它**不是**创作者级的失败。
    assert.equal(summary.verify.failed, 1);
    assert.equal(summary.verifyErrors.length, 1);
    assert.equal(summary.verifyErrors[0]?.platform, 'twitch');
    assert.match(summary.verifyErrors[0]?.error ?? '', /Get Videos 回了 400/);
    assert.deepEqual(summary.failures, [], '核对失败不是某个博主的错 —— 不许混进 failures');
    assert.equal(summary.platforms.twitch, 'ok', '抓取成功了就是 ok，核对失败不改这个值');
    assert.match(formatSummary(summary, NOW, NOW), /⚠️ 核对失败: platform=twitch/);

    // ② 退出码非零（这一轮确实有一步没做成）。
    assert.equal(exitCodeFor(summary), 1);

    // ③ 这一轮**跑完了**：回填那一条新视频真的落库了（另两个阶段的工作不受影响）。
    assert.deepEqual(summary.backfill, { tried: 1, done: 1, failed: 0 });
    assert.equal(summary.inserted, 1);
    const fresh = getDb()
      .prepare('SELECT status FROM tracked_videos WHERE creator_id = ? AND external_id = ?')
      .get(c.id, 'v-new') as { status: string } | undefined;
    assert.equal(fresh?.status, 'visible');

    // ④ 而核对那一批**什么都不写**：一条都没隐藏、连 verify_checked_at 都没写。
    assert.deepEqual(
      getDb()
        .prepare(
          `SELECT external_id, status, hidden_at, verify_checked_at FROM tracked_videos
            WHERE creator_id = ? ORDER BY external_id`,
        )
        .all(c.id)
        .map(plain),
      [
        { external_id: 'v-new', status: 'visible', hidden_at: null, verify_checked_at: null },
        { external_id: 'v-stale', status: 'visible', hidden_at: null, verify_checked_at: null },
      ],
    );
  });

  it('★★ 回填失败**不妨碍**核对：同一个平台，抓取挂了，该下架的照下架', async () => {
    /*
     * ★ 这是"三个阶段互相独立"的**另一半**（`runOnce` 里那条 ★★ 说的是"反之亦然"）。
     *    上面几条都把核对单独关起门来量（`backfill: 0`），而这一条**故意让抓取失败**。
     *    核对的判据与抓取无关 ⇒ 抓取失败只该让摘要多一条 `failures`、退出码变成 1，
     *    而"这批 id 上游还认不认"照问、该隐藏的照隐藏。
     * ⚠️★ 写成"一个阶段挂了就整轮收手"（读起来更保守）的代价很具体：bilibili 的拒绝是
     *    **概率性**的（§2.3），于是 Twitch 的过期下架会跟着它的抖动一轮一轮地停 ——
     *    而两者之间没有任何因果关系。表现是"过期的 VOD 有时下架、有时不下架"，
     *    没有任何地方会报错。
     * ⚠️ 这条也顺带钉住"退出码 1 的**来源**"：这里的 1 是抓取失败给的，
     *    而不是核对失败（`verifyErrors` 是空的）。
     */
    const c = addCreator('twitch', 'tw-mixed');
    const gone = insertRaw(c.id, 'twitch', 'v-gone', { publishedAt: NOW - 30 * 86400 });
    const adapter: PlatformAdapter = {
      async resolveCreator() {
        throw new Error('不该走到这里');
      },
      async fetchPage() {
        throw new Error('twitch: 500 抓取挂了');
      },
      async existingVideoIds() {
        return new Set<string>(); // 上游说这一条不在了
      },
    };

    const summary = await runOnce(
      depsFor({
        adapters: adapterRegistry({ twitch: adapter }).adapters,
        platformStatus: ONLY_TWITCH,
      }),
    );

    // 抓取那一侧一个字都没变：记一条失败、平台报 failed。
    assert.equal(summary.backfill.failed, 1);
    assert.equal(summary.failures.length, 1);
    assert.equal(summary.platforms.twitch, 'failed');

    // ★ 而核对照跑：查了 1 个、隐藏了 1 个，一条核对失败都没有。
    assert.deepEqual(summary.verify, { checked: 1, hidden: 1, failed: 0 });
    assert.deepEqual(summary.verifyErrors, []);
    assert.deepEqual(
      plain(
        getDb()
          .prepare('SELECT status, hidden_reason FROM tracked_videos WHERE id = ?')
          .get(gone) as { status: string; hidden_reason: string | null },
      ),
      { status: 'hidden', hidden_reason: 'upstream_gone' },
    );

    // 退出码 1 是**抓取**那条失败给的（核对自己没有出问题）。
    assert.equal(exitCodeFor(summary), 1);
  });

  it('★ 上游返回空集合 ⇒ 那一批全部隐藏（"都没了"与"没问到"是两件事）', async () => {
    /*
     * ⚠️ 这是**失败**那几条的对照面：空集合走的是同一条路，而它**必须**隐藏。
     *    把它和"请求失败"混成一件事，就是 spec §4 那条 ★★ 要防的静默下架；
     *    反过来，因为怕下架而把空集合也当成失败，等于**永远不隐藏任何东西** ——
     *    那一片视频过期之后会永远留在墙上（本功能存在的理由）。
     */
    const c = addCreator('twitch', 'tw-allgone');
    insertRaw(c.id, 'twitch', 'v-a', { publishedAt: NOW - 30 * 86400 });
    insertRaw(c.id, 'twitch', 'v-b', { publishedAt: NOW - 30 * 86400 });
    const adapter: PlatformAdapter = {
      async resolveCreator() {
        throw new Error('x');
      },
      async fetchPage() {
        throw new Error('x');
      },
      async existingVideoIds() {
        return new Set<string>();
      },
    };

    const summary = await runOnce(
      depsFor({
        adapters: adapterRegistry({ twitch: adapter }).adapters,
        platformStatus: ONLY_TWITCH,
        limits: { backfill: 0 },
      }),
    );

    assert.deepEqual(summary.verify, { checked: 2, hidden: 2, failed: 0 });
    assert.equal(exitCodeFor(summary), 0);
    assert.deepEqual(
      getDb()
        .prepare(
          'SELECT external_id, status, hidden_reason FROM tracked_videos ORDER BY external_id',
        )
        .all()
        .map(plain),
      [
        { external_id: 'v-a', status: 'hidden', hidden_reason: 'upstream_gone' },
        { external_id: 'v-b', status: 'hidden', hidden_reason: 'upstream_gone' },
      ],
    );
  });

  /*
   * ★★ 比值闸（spec §6.2 第 4 条，2026-09-16 终审冻结）：一次 `200` + 一个短得离谱的
   *    `data` 与"这一批真的都过期了"在代码里长得一模一样，而它的代价是**一次最多
   *    埋掉 200 行、退出码还留在 0、而且应用里没有"恢复显示"这个动作**。
   *
   * ⚠️★ 三条用例是**一组**，缺一条这道闸就有一种坏法没人看得见：
   *    · 12/12（超过一半）⇒ 一条都不隐藏 + 记一条核对失败 + 退出码 1；
   *    · 12/6（**恰好一半**）⇒ 那 6 条照常隐藏、**没有**核对失败 —— 判据是"严格大于"，
   *      把 `>` 写成 `>=` 只有这一条会红；
   *    · 3/3（**不够大**）⇒ 全部照常隐藏 —— 把下限去掉（或写小）只有这一条会红，
   *      而它守的是"新博主那几条真的过期的 VOD 还下得掉"。
   */
  it('★★ 一批 12 个上游一个都不认 ⇒ **一条都不隐藏**、记一条核对失败、退出码 1', async () => {
    const c = addCreator('twitch', 'tw-ratio-all');
    const ids = Array.from({ length: 12 }, (_, i) => `v-ratio-${String(i)}`);
    for (const id of ids) insertRaw(c.id, 'twitch', id, { publishedAt: NOW - 30 * 86400 });
    const adapter: PlatformAdapter = {
      async resolveCreator() {
        throw new Error('x');
      },
      async fetchPage() {
        throw new Error('x');
      },
      async existingVideoIds() {
        // 空的 `data`：这正是"上游形状变了"与"这一批全过期了"分不开的那一种回答。
        return new Set<string>();
      },
    };

    const summary = await runOnce(
      depsFor({
        adapters: adapterRegistry({ twitch: adapter }).adapters,
        platformStatus: ONLY_TWITCH,
        // 同核对那一组别的用例：关掉回填，退出码只可能来自核对这一行。
        limits: { backfill: 0 },
      }),
    );

    // ① 一条都没隐藏，而且**一个字段都没写**（`verify_checked_at` 与隐藏三列一起看）。
    const rows = getDb()
      .prepare(
        'SELECT status, hidden_at, hidden_reason, verify_checked_at FROM tracked_videos ORDER BY external_id',
      )
      .all()
      .map(plain);
    assert.equal(rows.length, 12, '★ 探针：这一批确实是 12 行（不然下面那条在验一个空集合）');
    assert.deepEqual(
      rows,
      ids.map(() => ({
        status: 'visible',
        hidden_at: null,
        hidden_reason: null,
        verify_checked_at: null,
      })),
      '★★ 整批放弃 ⇒ 12 行一个字段都不许动（连 `verify_checked_at` 都不写）',
    );

    // ② 一条核对失败（不是 12 条），消息里写清"多少个里的多少个不见了 + 整批放弃"。
    assert.deepEqual(summary.verify, { checked: 0, hidden: 0, failed: 1 });
    assert.equal(summary.verifyErrors.length, 1, '★★ 一批记**一条**（不是每个 id 一条）');
    assert.equal(summary.verifyErrors[0]?.platform, 'twitch');
    const message = summary.verifyErrors[0]?.error ?? '';
    assert.match(message, /12/, `★★ 消息里要有"多少个"（实读「${message}」）`);
    assert.match(message, /整批放弃/, `★★ 而且要写明这一批被放弃了（实读「${message}」）`);
    assert.match(
      formatSummary(summary, NOW, NOW),
      /⚠️ 核对失败: platform=twitch/,
      '★★ 它按核对失败那一行打印（与创作者的 `⚠️ 失败样例:` 分开）',
    );
    assert.equal(exitCodeFor(summary), 1, '★★ 退出码非零 —— 否则这一批是**静默**埋掉的');
  });

  it('★★ 12 个里消失 6 个（**恰好一半**）⇒ 那 6 个照常隐藏、没有核对失败', async () => {
    /*
     * ⚠️ 这是那道闸的**边界**：判据是"**超过**一半"（`missing > ids.length / 2`）。
     *    写成 `>=` 的话这一条会红 —— 而它红了才是对的：半数消失是"上游确实少了一半"，
     *    不是"我们问错了 id"，照常隐藏才符合这个功能的全部理由（过期的就该下架）。
     */
    const c = addCreator('twitch', 'tw-ratio-half');
    const gone = Array.from({ length: 6 }, (_, i) => `v-gone-${String(i)}`);
    const kept = Array.from({ length: 6 }, (_, i) => `v-kept-${String(i)}`);
    for (const id of [...gone, ...kept]) {
      insertRaw(c.id, 'twitch', id, { publishedAt: NOW - 30 * 86400 });
    }
    const adapter: PlatformAdapter = {
      async resolveCreator() {
        throw new Error('x');
      },
      async fetchPage() {
        throw new Error('x');
      },
      async existingVideoIds() {
        return new Set(kept);
      },
    };

    const summary = await runOnce(
      depsFor({
        adapters: adapterRegistry({ twitch: adapter }).adapters,
        platformStatus: ONLY_TWITCH,
        limits: { backfill: 0 },
      }),
    );

    assert.deepEqual(summary.verify, { checked: 12, hidden: 6, failed: 0 });
    assert.deepEqual(summary.verifyErrors, [], '★★ 恰好一半不算异常 ⇒ 一条核对失败都没有');
    assert.equal(exitCodeFor(summary), 0, '★ 而退出码 0：这一轮是成功的');
    const hiddenIds = getDb()
      .prepare(
        "SELECT external_id FROM tracked_videos WHERE status = 'hidden' ORDER BY external_id",
      )
      .all()
      .map((row) => (row as { external_id: string }).external_id);
    assert.deepEqual(hiddenIds, gone, '★★ 隐藏的**恰好**是消失的那 6 条（留在库里的 6 条不动）');
  });

  it('★★ 一批只有 3 个、3 个都不认 ⇒ **照常全部隐藏**（低于下限，闸不生效）', async () => {
    /*
     * ⚠️ 下限（`VERIFY_MIN_BATCH_FOR_RATIO = 10`）守的是这半边：刚加的博主手上可能只有
     *    三五条 VOD，而它们**真的**会一起过期（Twitch 的存档最早 7 天）。
     *    没有下限（或下限写得比 3 小）的话，那几条**永远下不掉** —— 而那一栏会一直
     *    留着几条已经没了的视频，界面上解释不了。
     */
    const c = addCreator('twitch', 'tw-ratio-small');
    for (const id of ['v-s-1', 'v-s-2', 'v-s-3']) {
      insertRaw(c.id, 'twitch', id, { publishedAt: NOW - 30 * 86400 });
    }
    const adapter: PlatformAdapter = {
      async resolveCreator() {
        throw new Error('x');
      },
      async fetchPage() {
        throw new Error('x');
      },
      async existingVideoIds() {
        return new Set<string>();
      },
    };

    const summary = await runOnce(
      depsFor({
        adapters: adapterRegistry({ twitch: adapter }).adapters,
        platformStatus: ONLY_TWITCH,
        limits: { backfill: 0 },
      }),
    );

    assert.deepEqual(summary.verify, { checked: 3, hidden: 3, failed: 0 });
    assert.deepEqual(summary.verifyErrors, [], '★★ 3 < 10 ⇒ 这道闸根本不看这一批');
    assert.equal(exitCodeFor(summary), 0);
    const hiddenCount = getDb()
      .prepare("SELECT COUNT(*) AS n FROM tracked_videos WHERE status = 'hidden'")
      .get() as { n: number };
    assert.equal(hiddenCount.n, 3, '★★ 三条全部隐藏（"新的博主那几条真的过期了"必须下得掉）');
  });

  it('★ 两个比值闸常量就是 spec §10 冻结的那两个值（改了它，那道闸的形状就变了）', () => {
    /*
     * ⚠️ 与 `TRACK_LIMITS` 那条同一条纪律：这两个数不是"随手能调"的参数 ——
     *    10 决定"新博主的第一批还能不能下架"，0.5 决定"多坏的一批算坏"。
     *    改它们要连着改 spec §6.2 第 4 条与 §10 的冻结表。
     */
    assert.equal(VERIFY_MIN_BATCH_FOR_RATIO, 10);
    assert.equal(VERIFY_MAX_MISSING_RATIO, 0.5);
  });

  it('★ 刚发出来的不查（§6.1 的 6 天粗筛）：只查够老的那些', async () => {
    /*
     * ⚠️ 这条与"少返回一个"那条的差别只有时间：`published_at` 在 6 天以内的一律不查
     *    （Twitch 的存档最早 7 天过期 ⇒ 刚发的根本没得可查）。
     *    写错这一步的代价是**每轮白问一批**（而且还按 200 的上限占着名额，
     *    真正该核对的那些排在后面），一个异常都不会有。
     */
    const c = addCreator('twitch', 'tw-age');
    const fresh = insertRaw(c.id, 'twitch', 'v-fresh', { publishedAt: NOW - 3600 }); // 太新
    const old = insertRaw(c.id, 'twitch', 'v-old', { publishedAt: NOW - 30 * 86400 });
    /** 边界那一条：差一秒就不算够老（`<=` 的哪一侧由它钉住）。 */
    const edge = insertRaw(c.id, 'twitch', 'v-edge', {
      publishedAt: NOW - 6 * 86400 + 1,
    });
    const asked: string[][] = [];
    const adapter: PlatformAdapter = {
      async resolveCreator() {
        throw new Error('x');
      },
      async fetchPage() {
        throw new Error('x');
      },
      async existingVideoIds(ids) {
        asked.push([...ids]);
        return new Set(ids);
      },
    };

    const summary = await runOnce(
      depsFor({
        adapters: adapterRegistry({ twitch: adapter }).adapters,
        platformStatus: ONLY_TWITCH,
        limits: { backfill: 0 },
      }),
    );

    assert.equal(asked.length, 1);
    assert.deepEqual(asked[0], ['v-old'], '★ 只问够老的那一条（太新与差一秒的都留下）');
    assert.deepEqual(summary.verify, { checked: 1, hidden: 0, failed: 0 });
    assert.equal(exitCodeFor(summary), 0);
    // 没被问到的两条一个字段都不许动（"没查"不是"查过且还在"）。
    assert.deepEqual(
      getDb()
        .prepare('SELECT id, verify_checked_at FROM tracked_videos ORDER BY external_id')
        .all()
        .map(plain),
      [
        { id: edge, verify_checked_at: null },
        { id: fresh, verify_checked_at: null },
        { id: old, verify_checked_at: NOW },
      ],
    );
  });

  it('★ 核对按平台整批问，且一次问不超过 limits.verify 个（spec §10 的第四格）', async () => {
    /*
     * ⚠️ 两件事一起钉，因为它们各自都会**静默**出错：
     *   · 批里混进别的平台的 id ⇒ 问回来的集合没法解释是哪个平台的答案
     *     （`pickVerifiableVideos` 的 `platform` 因此是必填的）；
     *   · 上限没生效 ⇒ 一次把整库的 Twitch 视频问出去（§3.3 那条"一次运行有界"
     *     在这里的入口），而上游是按**每个 id** 记账的。
     */
    const c = addCreator('twitch', 'tw-limit');
    for (const id of ['v-1', 'v-2', 'v-3']) {
      insertRaw(c.id, 'twitch', id, { publishedAt: NOW - 30 * 86400 });
    }
    const other = addCreator('bilibili', 'bi-mixed');
    insertRaw(other.id, 'bilibili', 'BV-mixed', { publishedAt: NOW - 30 * 86400 });

    const asked: string[][] = [];
    const adapter: PlatformAdapter = {
      async resolveCreator() {
        throw new Error('x');
      },
      async fetchPage() {
        throw new Error('x');
      },
      async existingVideoIds(ids) {
        asked.push([...ids]);
        return new Set(ids);
      },
    };

    const summary = await runOnce(
      depsFor({
        adapters: adapterRegistry({ twitch: adapter }).adapters,
        platformStatus: ONLY_TWITCH,
        limits: { backfill: 0, verify: 2 },
      }),
    );

    assert.equal(asked.length, 1, '一次运行里每个平台只问一批');
    assert.equal(asked[0]?.length, 2, '★ limits.verify = 2 ⇒ 一批最多 2 个 id');
    assert.ok(
      asked[0]?.every((id) => id.startsWith('v-')),
      `批里不许混进别的平台的 id：${JSON.stringify(asked[0])}`,
    );
    assert.deepEqual(summary.verify, { checked: 2, hidden: 0, failed: 0 });
    /*
     * ⚠️ 被上限截掉的那一条**一个字段都不写**（它这一轮根本没被问到）：
     *    写了 `verify_checked_at` 就等于"查过了还在"，而它其实还没查。
     */
    const unchecked = getDb()
      .prepare('SELECT COUNT(*) AS n FROM tracked_videos WHERE verify_checked_at IS NULL')
      .get() as { n: number };
    assert.equal(unchecked.n, 2, '一条 bilibili + 一条被上限截掉的 twitch');
  });
});
