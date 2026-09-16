/**
 * 数据层（`tracked-videos.ts`）的**行为契约** —— creators CRUD / videos upsert / 挑待办 / 水位。
 *
 * ===========================================================================
 * ⚠️ 这个文件住在 `services/api` 下：本仓的测试运行器只在这个工作区里
 *    （`packages/shared` 只有 typecheck）—— 与 `tracking-schema.test.ts` 同一个理由。
 * ===========================================================================
 *
 * ===========================================================================
 * ★★ 这一层要守住的几乎全是**静默**失败
 * ===========================================================================
 * 下面每一条断言都对应一类"不抛异常、只是数据长成另一个样子"的故障，
 * 而它们恰恰是"跑一遍、看有没有报错"发现不了的那一类：
 *   · 幂等坏了（upsert 退化成普通 INSERT）⇒ 每次增量都插一批重复行，
 *     界面上同一支视频出现 N 次 —— 行数本身是"合法"的，没有任何东西会报错；
 *   · 把拿不到的字段填成 0 ⇒ "没人看"与"上游这一轮没给这个字段"在库里分不开
 *     （spec §4.2 / 本仓既有纪律）；
 *   · 时长为 0 进了 `duration_sec` ⇒ spec §4.3 的 `short`（`<= 60`）**当场打错**，
 *     而那是一个看起来完全正常的标签（T2 的三个解析器已经堵住了自己的出口，
 *     这里是最后一道闸：见下面 ★ 那一组）；
 *   · `DO UPDATE` 里捎上 `status` ⇒ 编辑手工隐藏过的视频被下一轮同步**悄悄放回来**；
 *   · `LIMIT -1` 被当成"负的限额" ⇒ 它在 SQLite 里是"**不限**"，
 *     于是这一轮把整份名单都抓一遍，spec §3.3 的有界设计就没了。
 *
 * ===========================================================================
 * 两个夹具上的决定
 * ===========================================================================
 * ① **`insertCreator` 直接写库，不走 `createCreator`**：待办那一组要造出
 *    `backfill_done=1` / `last_synced_at=…` 这些**只有同步过程才会出现**的状态，
 *    而 `createCreator` 造出来的新行永远是"待回填"。用被测函数造夹具的话，
 *    "该回填的进 backfill"那条就永远只测得到一种输入。
 * ② **默认不清表**（与 `tracking-schema.test.ts` 同一条理由）：每一行数据都带自增序号，
 *    每条计数断言都**按 `creator_id` 收窄**，用例之间本来就不会互相影响。
 *    ⚠️ 例外是**公开列表**那一组 —— 它的 `total` 是**全表**的数（不是按 creator 收窄的），
 *    所以那一组开头显式清一次表并把理由写在那里。没有清理的话，
 *    "total 是匹配行数"会取决于另外三十条用例碰巧留下了什么。
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import type { TrackPlatform } from '@mcsr/shared';
import type { CreatorRef, FetchedVideo } from './tracking/types';

// ⚠️ 必须在**任何** getDb() 之前设置：下面的 import 是动态的，就是为了让这一行先跑。
process.env.DB_PATH = ':memory:';

const { closeDb, getDb } = await import('./db');
const {
  advanceCursor,
  createCreator,
  deleteCreator,
  listCreators,
  listTrackedVideos,
  pickDueCreators,
  recordFailure,
  storedVideoCount,
  updateCreator,
  upsertVideos,
} = await import('./tracked-videos');

after(() => closeDb());

/** 所有用例共用的"现在"。**秒**，与两张表里那几个时间列的语义一致。 */
const NOW = 1_788_600_000;

/** 增量同步的间隔（spec §3.2 / §10：一小时）。超过它才算"该增量了"。 */
const HOUR = 3600;

let seq = 0;
function nextName(prefix: string): string {
  seq += 1;
  return `${prefix}-${String(seq)}`;
}

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

/** 两张表的列名，**逐列写出来**（测试这边也不写 `SELECT *`：那条纪律没有"测试里可以放松"这一说）。 */
const VIDEO_COLUMNS = `
  id, creator_id, platform, external_id, title, thumbnail_url, published_at,
  duration_sec, view_count, comment_count, is_live_replay, tags, status,
  first_seen_at, updated_at
`;

const CREATOR_COLUMNS = `
  id, platform, external_id, handle, display_name, avatar_url, platform_meta,
  backfill_done, last_cursor, last_synced_at, last_error, consecutive_failures,
  enabled, added_by, created_at, updated_at
`;

/** `tracked_videos` 的一行，**列全是库里那个类型**（断言要能看出 0 与 NULL 的差别）。 */
interface RawVideoRow {
  id: string;
  creator_id: string;
  platform: string;
  external_id: string;
  title: string;
  thumbnail_url: string | null;
  published_at: number | null;
  duration_sec: number | null;
  view_count: number | null;
  comment_count: number | null;
  is_live_replay: number;
  tags: string | null;
  status: string;
  first_seen_at: number;
  updated_at: number;
}

interface RawCreatorRow {
  id: string;
  platform: string;
  external_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  platform_meta: string | null;
  backfill_done: number;
  last_cursor: string | null;
  last_synced_at: number | null;
  last_error: string | null;
  consecutive_failures: number;
  enabled: number;
  added_by: string | null;
  created_at: number;
  updated_at: number;
}

interface RawCreator {
  platform?: TrackPlatform;
  externalId?: string;
  displayName?: string;
  handle?: string;
  platformMeta?: string | null;
  backfillDone?: number;
  lastCursor?: string | null;
  lastSyncedAt?: number | null;
  lastError?: string | null;
  consecutiveFailures?: number;
  enabled?: number;
  createdAt?: number;
}

/**
 * 直接写库造一个博主（见文件头夹具决定 ①）。
 *
 * ⚠️ `created_at` 默认**每次都不同**：名单的排序按键是它，同一个时刻造的几行
 *    会让"顺序稳定"那条断言失去意义（顺序变成未定义的）。
 */
function insertCreator(input: RawCreator = {}): string {
  const name = nextName('tc');
  const id = input.externalId === undefined ? name : `${name}@${input.externalId}`;
  getDb()
    .prepare(
      `INSERT INTO tracked_creators (${CREATOR_COLUMNS})
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      id,
      input.platform ?? 'bilibili',
      input.externalId ?? name,
      input.handle ?? '',
      input.displayName ?? `博主 ${name}`,
      input.platformMeta ?? null,
      input.backfillDone ?? 0,
      input.lastCursor ?? null,
      input.lastSyncedAt ?? null,
      input.lastError ?? null,
      input.consecutiveFailures ?? 0,
      input.enabled ?? 1,
      input.createdAt ?? NOW,
      input.createdAt ?? NOW,
    );
  return id;
}

/** 走被测函数加一个博主（成功路径）。要看失败路径的用例自己调 `createCreator`。 */
function addCreator(over: { platform?: TrackPlatform; externalId?: string } = {}): string {
  const name = nextName('mid');
  const ref: CreatorRef = {
    platform: over.platform ?? 'bilibili',
    externalId: over.externalId ?? name,
    handle: '',
    displayName: `博主 ${name}`,
    avatarUrl: null,
  };
  const result = createCreator(ref, null, NOW);
  if (!result.ok) assert.fail(`夹具：加博主不该失败（${JSON.stringify(result)}）`);
  return result.creator.id;
}

/** 一条抓回来的视频，字段默认"上游什么都没给"。 */
function fetched(externalId: string, over: Partial<FetchedVideo> = {}): FetchedVideo {
  return {
    externalId,
    title: `视频 ${externalId}`,
    thumbnailUrl: null,
    publishedAt: null,
    durationSec: null,
    viewCount: null,
    commentCount: null,
    isLiveReplay: false,
    ...over,
  };
}

/**
 * 收下一次 upsert 的结果，**不让它抛出去**。
 *
 * ⚠️ 理由与 `tracking-schema.test.ts` 的 `deleteCreator` 完全一样：把 upsert 改成普通
 *    `INSERT` 之后，第二次那条会**当场扔一个 `UNIQUE constraint failed`**。
 *    让它抛的话，测试就停在"调用炸了"上，而真正的判据（"行数必须还是 N"）
 *    根本走不到 —— 红是红了，红得说不出是哪条规则坏了。
 */
function upsertQuietly(
  creatorId: string,
  platform: TrackPlatform,
  videos: FetchedVideo[],
  now: number,
): { ok: true; value: { inserted: number; updated: number } } | { ok: false; error: string } {
  try {
    return { ok: true, value: upsertVideos(creatorId, platform, videos, now) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 这个博主名下有几行 —— 逐条用例都按它收窄（见文件头夹具决定 ②）。 */
function videosOf(creatorId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM tracked_videos WHERE creator_id = ?')
    .get(creatorId) as { n: number };
  return row.n;
}

/** 按 (platform, external_id) 读回一行原样的库行。 */
function rawVideo(platform: TrackPlatform, externalId: string): RawVideoRow | undefined {
  return getDb()
    .prepare(`SELECT ${VIDEO_COLUMNS} FROM tracked_videos WHERE platform = ? AND external_id = ?`)
    .get(platform, externalId) as unknown as RawVideoRow | undefined;
}

function rawCreator(id: string): RawCreatorRow | undefined {
  return getDb()
    .prepare(`SELECT ${CREATOR_COLUMNS} FROM tracked_creators WHERE id = ?`)
    .get(id) as unknown as RawCreatorRow | undefined;
}

/** 手工隐藏一支视频 —— **v1 没有这个端点**，编辑是直接改库的（见 `status` 那一组）。 */
function hideByHand(platform: TrackPlatform, externalId: string): void {
  getDb()
    .prepare("UPDATE tracked_videos SET status = 'hidden' WHERE platform = ? AND external_id = ?")
    .run(platform, externalId);
}

// ---------------------------------------------------------------------------
// ① 幂等
// ---------------------------------------------------------------------------

describe('追踪数据层：① 幂等（同一批抓两次，行数不变）', () => {
  it('① ★ 连插两次：第二次是 0 插入 / N 更新，行数不变', () => {
    const creatorId = addCreator();
    const batch = [
      fetched('BV-one', { viewCount: 10 }),
      fetched('BV-two', { viewCount: 20 }),
      fetched('BV-three', { viewCount: 30 }),
    ];

    const first = upsertQuietly(creatorId, 'bilibili', batch, NOW);
    assert.deepEqual(
      first,
      { ok: true, value: { inserted: 3, updated: 0 } },
      '第一次抓回来三条全新的视频 ⇒ 3 插入 / 0 更新',
    );

    const second = upsertQuietly(creatorId, 'bilibili', batch, NOW + 600);
    assert.deepEqual(
      second,
      { ok: true, value: { inserted: 0, updated: 3 } },
      '★ 同一批再抓一次 ⇒ 0 插入 / 3 更新 —— 退化成普通 INSERT 的话这里会是 UNIQUE 冲突',
    );

    assert.equal(
      videosOf(creatorId),
      3,
      '★ 同一批视频连抓两次，行数必须还是 3（幂等），不是 6 —— 这是 spec §9.1 断言 5',
    );
  });

  it('① ★ 幂等的键是 (platform, external_id)：同一个 id 换个平台是另一支视频', () => {
    // ⚠️ 反面控制。没有它的话，"整张表只能有一条视频"也能让上面那条断言绿。
    const bili = addCreator({ platform: 'bilibili' });
    const youtube = addCreator({ platform: 'youtube' });

    upsertVideos(bili, 'bilibili', [fetched('SHARED-ID', { title: 'B站的那支' })], NOW);
    upsertVideos(youtube, 'youtube', [fetched('SHARED-ID', { title: 'YouTube 的那支' })], NOW);

    assert.equal(videosOf(bili), 1, 'bilibili 那边一条');
    assert.equal(videosOf(youtube), 1, 'YouTube 那边也是一条（它不该被上面那条吃掉）');
    assert.equal(rawVideo('youtube', 'SHARED-ID')?.title, 'YouTube 的那支');
  });

  it('① ★ 每一列都必须是绑进去的那一个（绑定顺序错了不会抛，只会写错列）', () => {
    /*
     * ★ 这是本文件里**唯一**能抓住"参数顺序写错"的东西。
     *   `INSERT ... VALUES (?,?,…)` 的绑定是**位置**的：把 view_count 与 comment_count
     *   调换，SQL 完全合法、CHECK 也过得去、行照样写进去 —— 只是两列的值互换了，
     *   而且**没有任何地方会报错**（spec §4.2 的"看起来像一条真实数据"的另一种形状）。
     *   ⇒ 每一个位置都要单独断言一次，不能只断言"有几行"。
     */
    const creatorId = addCreator();
    upsertVideos(
      creatorId,
      'bilibili',
      [
        fetched('BV-all', {
          title: '全都有的那一支',
          thumbnailUrl: 'https://example.invalid/cover.jpg',
          publishedAt: NOW - 86_400,
          durationSec: 3723,
          viewCount: 12_345,
          commentCount: 678,
          isLiveReplay: true,
        }),
      ],
      NOW,
    );

    const row = rawVideo('bilibili', 'BV-all');
    assert.ok(row, '这一行必须写进去了');
    assert.equal(row.id.length > 0, true, 'id 必须是新生成的（不能是空串）');
    assert.equal(row.creator_id, creatorId, 'creator_id 是传进来的那个博主');
    assert.equal(row.platform, 'bilibili', 'platform 是传进来的那个平台');
    assert.equal(row.external_id, 'BV-all', 'external_id 是平台侧的 id');
    assert.equal(
      row.title,
      '全都有的那一支',
      'title 绑对了（与 thumbnail_url 调换就会被抓到这里）',
    );
    assert.equal(row.thumbnail_url, 'https://example.invalid/cover.jpg', 'thumbnail_url 绑对了');
    assert.equal(row.published_at, NOW - 86_400, 'published_at 是发布时间的 Unix 秒');
    assert.equal(row.duration_sec, 3723, 'duration_sec 是秒数（3723 这种就被换列了）');
    assert.equal(
      row.view_count,
      12_345,
      'view_count 是播放量 —— 与 comment_count 调换位置时红的**就是这一行**',
    );
    assert.equal(row.comment_count, 678, 'comment_count 是评论数');
    assert.equal(row.is_live_replay, 1, 'is_live_replay 是 0/1，不是 true');
    assert.equal(row.tags, '["liveReplay","long"]', 'tags 是 JSON 数组文本（liveReplay 恒在前）');
    assert.equal(row.status, 'visible', '新写进去的默认可见');
    assert.equal(row.first_seen_at, NOW, 'first_seen_at 是第一次见到的时刻');
    assert.equal(row.updated_at, NOW, 'updated_at 是这一次写入的时刻');
  });

  it('① 再抓一遍要改写那些**会变**的值', () => {
    const creatorId = addCreator();
    upsertVideos(
      creatorId,
      'bilibili',
      [fetched('BV-move', { title: '旧标题', viewCount: 1, durationSec: 30 })],
      NOW,
    );
    upsertVideos(
      creatorId,
      'bilibili',
      [fetched('BV-move', { title: '新标题', viewCount: 999, durationSec: 2400 })],
      NOW + 600,
    );

    const row = rawVideo('bilibili', 'BV-move');
    assert.equal(row?.title, '新标题', '标题会变（UP 主改名）');
    assert.equal(row?.view_count, 999, '播放量会涨');
    assert.equal(row?.duration_sec, 2400, '时长会变（UP 主重新剪过）');
    assert.equal(row?.tags, '["long"]', '标签跟着时长一起重算');
    assert.equal(row?.updated_at, NOW + 600, 'updated_at 是"最后一次改到它"的时刻');
    assert.equal(row?.first_seen_at, NOW, '★ first_seen_at 是第一次见到它的时刻，不许被改写');
    assert.equal(videosOf(creatorId), 1);
  });

  it('① ★ 视频换不了主人：重抓到别人名下也不改 creator_id', () => {
    /*
     * spec §4 的裁决：`creator_id` 不在 `DO UPDATE` 里 —— 一支视频的作者不会变。
     * ⚠️ 那为什么还要测：因为"顺手把它也更新掉"看起来更完整，
     *    而它的后果是**整批视频悄悄换了归属**（名单上 A 的条数掉了、B 的多出来了，
     *    两边都不报错）。这条断言是为了让那个改动当场红。
     */
    const first = addCreator();
    const second = addCreator();

    upsertVideos(first, 'bilibili', [fetched('BV-owner')], NOW);
    const rowId = rawVideo('bilibili', 'BV-owner')?.id;
    upsertVideos(second, 'bilibili', [fetched('BV-owner')], NOW + 60);

    assert.equal(rawVideo('bilibili', 'BV-owner')?.creator_id, first, '归属必须还是第一个博主');
    assert.equal(
      rawVideo('bilibili', 'BV-owner')?.id,
      rowId,
      '连主键都不该变（它是指着这一行的 id）',
    );
    assert.equal(videosOf(second), 0, '第二个博主名下不该凭空多出一条');
  });

  it('★ 空的一页什么都不写（§2.4：空页是常态，不是错误）', () => {
    const creatorId = addCreator();
    assert.deepEqual(upsertVideos(creatorId, 'bilibili', [], NOW), { inserted: 0, updated: 0 });
    assert.equal(videosOf(creatorId), 0);
  });
});

// ---------------------------------------------------------------------------
// ② 删博主级联
// ---------------------------------------------------------------------------

describe('追踪数据层：② 删博主，他的视频跟着走', () => {
  it('② ★ 删掉博主之后，他的视频 0 行（用行为验，不读 SQL 文本）', () => {
    const doomed = addCreator();
    const other = addCreator();
    upsertVideos(doomed, 'bilibili', [fetched('BV-d1'), fetched('BV-d2'), fetched('BV-d3')], NOW);
    upsertVideos(other, 'bilibili', [fetched('BV-keep')], NOW);

    assert.equal(videosOf(doomed), 3, '先确认他的视频真进去了（否则下面的 0 是白来的）');
    assert.equal(deleteCreator(doomed), true, '删掉一个存在的博主必须回 true');

    assert.equal(
      videosOf(doomed),
      0,
      '★ 他的视频必须跟着没了 —— ON DELETE CASCADE 不生效的话这里是 3（外键被关掉过一次就会这样）',
    );
    assert.equal(videosOf(other), 1, '反面控制：别人的视频一条都不许少');
    assert.equal(
      getDb().prepare('SELECT COUNT(*) AS n FROM tracked_videos').get() !== undefined,
      true,
    );
  });

  it('② 删一个不存在的博主回 false，而不是抛', () => {
    assert.equal(deleteCreator('tc-does-not-exist'), false);
  });
});

// ---------------------------------------------------------------------------
// ③ 同一个博主加两次
// ---------------------------------------------------------------------------

describe('追踪数据层：③ 同一个博主加两次', () => {
  it('③ ★ createCreator 把它变成一个明确的 duplicate（不是崩）', () => {
    const first = createCreator(
      {
        platform: 'bilibili',
        externalId: 'mid-dup',
        handle: '',
        displayName: 'A',
        avatarUrl: null,
      },
      null,
      NOW,
    );
    assert.equal(first.ok, true, '第一次当然要成功');

    const again = createCreator(
      {
        platform: 'bilibili',
        externalId: 'mid-dup',
        handle: '',
        displayName: 'B',
        avatarUrl: null,
      },
      null,
      NOW + 10,
    );
    assert.deepEqual(
      again,
      { ok: false, reason: 'duplicate', existingId: first.ok ? first.creator.id : '' },
      '★ 第二次必须是一个**明确的** duplicate（spec §9.1 断言 7 要的"数据库拒绝"，' +
        '而调用方要能把它翻译成一句人话，不是 500）',
    );
    assert.equal(
      listCreators().filter((c) => c.externalId === 'mid-dup').length,
      1,
      '名单上只该有一行',
    );
  });

  it('③ ★ 反面控制：数据库那一层的 UNIQUE 必须还在', () => {
    /*
     * ⚠️ 上面那条测的是"`createCreator` 说了 duplicate"，它**不代表**数据库还拦得住 ——
     *    `createCreator` 完全可以靠"我先查一遍"就把重复挡掉，而那时并发下的表现是
     *    两个人同时点"添加"就会各插一行（迁移 020 的文件头第一节写的正是这件事）。
     *    所以这里绕过数据层直接插一次：它必须被约束打回来。
     */
    const creatorId = insertCreator({ externalId: 'mid-raw-dup' });
    assert.ok(creatorId);
    assert.throws(
      () => insertCreator({ externalId: 'mid-raw-dup' }),
      /UNIQUE constraint failed/,
      '同一个 (platform, external_id) 直接写库也必须被拒',
    );
  });

  it('③ ★ 反面控制：同一个 id 换个平台加得进去', () => {
    const bili = createCreator(
      {
        platform: 'bilibili',
        externalId: 'same-id',
        handle: '',
        displayName: 'A',
        avatarUrl: null,
      },
      null,
      NOW,
    );
    const yt = createCreator(
      { platform: 'youtube', externalId: 'same-id', handle: '', displayName: 'A', avatarUrl: null },
      null,
      NOW,
    );
    assert.equal(bili.ok && yt.ok, true, '两个平台各是一行 —— UNIQUE 是两列一起看的');
    assert.equal(listCreators().filter((c) => c.externalId === 'same-id').length, 2);
  });

  it('③ 新加的博主是"待回填"：backfill_done=0、没同步过（NULL 不是 0）', () => {
    const id = addCreator();
    const row = rawCreator(id);
    assert.ok(row);
    assert.equal(row.backfill_done, 0, '新加的要进回填队列');
    assert.equal(row.enabled, 1, '新加的默认启用');
    assert.equal(row.last_cursor, null, '还没翻过页');
    assert.equal(
      row.last_synced_at,
      null,
      '★ 从没同步过 ⇒ NULL（**不是 0**：0 是 1970 年，看起来像一次真实同步）',
    );
    assert.equal(row.consecutive_failures, 0);
    assert.equal(row.last_error, null);
    assert.equal(row.created_at, NOW);
    assert.equal(row.updated_at, NOW);
  });
});

// ---------------------------------------------------------------------------
// ④ 待办从状态推导
// ---------------------------------------------------------------------------

describe('追踪数据层：④ pickDueCreators（待办从状态推导，没有队列表）', () => {
  it('④ ★ backfill_done=0 的进 backfill，backfill_done=1 的不进', () => {
    const fresh = insertCreator({ backfillDone: 0 });
    const done = insertCreator({ backfillDone: 1, lastSyncedAt: NOW - 10 * HOUR });

    const due = pickDueCreators(NOW, { backfill: 20, incremental: 20 });
    const backfillIds = due.backfill.map((c) => c.id);
    const incrementalIds = due.incremental.map((c) => c.id);

    assert.equal(backfillIds.includes(fresh), true, '还没回填过的要进 backfill');
    assert.equal(backfillIds.includes(done), false, '已经回填过的**不**进 backfill');
    assert.equal(incrementalIds.includes(done), true, '回填完且超过一小时没同步的进 incremental');
  });

  it('④ ★ "距上次同步超过一小时"是**严格小于**：3599/3600 秒都不算到点', () => {
    const just = insertCreator({ backfillDone: 1, lastSyncedAt: NOW - (HOUR - 1) });
    const exact = insertCreator({ backfillDone: 1, lastSyncedAt: NOW - HOUR });
    const past = insertCreator({ backfillDone: 1, lastSyncedAt: NOW - (HOUR + 1) });

    const ids = pickDueCreators(NOW, { backfill: 20, incremental: 20 }).incremental.map(
      (c) => c.id,
    );
    assert.equal(ids.includes(just), false, `${HOUR - 1} 秒前刚同步过 ⇒ 不该又来一轮`);
    assert.equal(
      ids.includes(exact),
      false,
      `正好 ${HOUR} 秒：spec §3.2 写的是 "< now - 3600"，等号不算`,
    );
    assert.equal(ids.includes(past), true, `${HOUR + 1} 秒前同步过的要到点了`);
  });

  it('④ ★★ enabled=0 的博主两边都不进（停用就是停用）', () => {
    const offBackfill = insertCreator({ backfillDone: 0, enabled: 0 });
    const offIncremental = insertCreator({
      backfillDone: 1,
      lastSyncedAt: NOW - 10 * HOUR,
      enabled: 0,
    });

    const due = pickDueCreators(NOW, { backfill: 50, incremental: 50 });
    const all = [...due.backfill, ...due.incremental].map((c) => c.id);

    assert.equal(
      all.includes(offBackfill),
      false,
      '★ 停用的博主不许被回填（他只是停了，历史视频还在库里，但别再抓了）',
    );
    assert.equal(all.includes(offIncremental), false, '★ 停用的博主也不许被增量同步');
  });

  it('④ ★ 返回数量不超过 limits', () => {
    for (let i = 0; i < 3; i += 1) insertCreator({ backfillDone: 0, createdAt: NOW + i });
    for (let i = 0; i < 3; i += 1) {
      insertCreator({ backfillDone: 1, lastSyncedAt: NOW - 10 * HOUR, createdAt: NOW + i });
    }

    const due = pickDueCreators(NOW, { backfill: 2, incremental: 1 });
    assert.equal(due.backfill.length, 2, 'backfill 最多给 2 个');
    assert.equal(due.incremental.length, 1, 'incremental 最多给 1 个');
  });

  it('④ ★ limits 是 0 或负数时一个都不给（LIMIT -1 在 SQLite 里是"不限"）', () => {
    insertCreator({ backfillDone: 0 });
    insertCreator({ backfillDone: 0 });

    const zero = pickDueCreators(NOW, { backfill: 0, incremental: 0 });
    assert.equal(zero.backfill.length, 0, '0 就是 0');
    assert.equal(zero.incremental.length, 0, '0 就是 0');

    const negative = pickDueCreators(NOW, { backfill: -1, incremental: -1 });
    assert.equal(
      negative.backfill.length,
      0,
      '★ -1 绝不能被翻译成"不限"：那会让这一轮把整份名单都抓一遍（spec §3.3 的有界设计）',
    );
    assert.equal(negative.incremental.length, 0, '★ 同上');
  });

  it('④ ★ backfill_done=1 但从来没同步过的行，也要进 incremental', () => {
    /*
     * ⚠️ 这一行在今天的写入路径上到不了（`advanceCursor` 把 `backfill_done` 与
     *    `last_synced_at` 一起写）。但 spec §3.2 那条判据是 `last_synced_at < now - 3600`，
     *    而 SQL 里 `NULL < 任何数` 是 NULL ⇒ 这行**永远不会**到点。
     *    真出现（手工改库、以后某次迁移）时的表现是"这个博主再也不会被同步"，
     *    而**没有任何地方会报错** —— 与本功能最怕的那个坑（§2.4 静默丢数据）同一类。
     */
    const orphan = insertCreator({ backfillDone: 1, lastSyncedAt: null });
    const ids = pickDueCreators(NOW, { backfill: 50, incremental: 50 }).incremental.map(
      (c) => c.id,
    );
    assert.equal(ids.includes(orphan), true, '这条"卡死"的行必须被捡回来同步一次');
  });

  it('④ 挑出来的行带着 CLI 要用的东西：游标、平台小东西、条数', () => {
    const id = insertCreator({
      backfillDone: 0,
      lastCursor: 'pn=3',
      platformMeta: JSON.stringify({ uploadsPlaylistId: 'UU-abc' }),
    });
    pickDueCreators(NOW, { backfill: 50, incremental: 50 });

    const mine = pickDueCreators(NOW, { backfill: 50, incremental: 50 }).backfill.find(
      (c) => c.id === id,
    );
    assert.ok(mine, '这个博主必须在待办里');
    assert.equal(mine.lastCursor, 'pn=3', 'CLI 拿它当 fetchPage 的 cursor');
    assert.deepEqual(
      mine.platformMeta,
      { uploadsPlaylistId: 'UU-abc' },
      'T8 的 YouTube 适配器要靠它避免每轮多打一次 channels.list',
    );
    assert.equal(mine.videoCount, 0, '还没抓过 ⇒ 0 条');
  });

  it('④ ★ 平台小东西坏掉时当作空，而不是让整条待办读不出来', () => {
    const id = insertCreator({ platformMeta: '{ 这不是 JSON' });
    const mine = pickDueCreators(NOW, { backfill: 50, incremental: 50 }).backfill.find(
      (c) => c.id === id,
    );
    assert.deepEqual(mine?.platformMeta, {}, '坏 JSON ⇒ 空对象（一次手改库不该把整轮同步搞挂）');
  });

  it('④ ★ 待办里的 videoCount 与 storedVideoCount 说的是同一个数', () => {
    /*
     * ⚠️ 这两个数是**两个查询**算出来的（一个在名单的 GROUP BY 里，一个是那个窄函数），
     *    而它们必须永远相等：CLI 拿 `storedVideoCount` 当 `storedTotal` 去判 bilibili
     *    到底没到底（spec §5.4 / §5.1）。写法漂移的那一刻，判据就跟着漂 —— 这条断言
     *    是让那次漂移当场红，而不是等到某天发现少抓了视频。
     */
    const id = insertCreator({ backfillDone: 0 });
    upsertVideos(id, 'bilibili', [fetched('BV-c1'), fetched('BV-c2')], NOW);

    const mine = pickDueCreators(NOW, { backfill: 50, incremental: 50 }).backfill.find(
      (c) => c.id === id,
    );
    assert.equal(mine?.videoCount, 2);
    assert.equal(mine?.videoCount, storedVideoCount(id), '名单那一列与 storedVideoCount 必须相等');
  });
});

// ---------------------------------------------------------------------------
// ⑤ 拿不到的一律 NULL
// ---------------------------------------------------------------------------

describe('追踪数据层：⑤ 拿不到的一律 NULL，绝不许填 0', () => {
  it('⑤ ★ 上游给 null 的五个字段，库里就是 NULL（一个 0 都不许出现）', () => {
    const creatorId = addCreator();
    upsertVideos(creatorId, 'bilibili', [fetched('BV-nulls', { title: '只有标题' })], NOW);

    const row = rawVideo('bilibili', 'BV-nulls');
    assert.ok(row);
    for (const [name, value] of [
      ['thumbnail_url', row.thumbnail_url],
      ['published_at', row.published_at],
      ['duration_sec', row.duration_sec],
      ['view_count', row.view_count],
      ['comment_count', row.comment_count],
    ] as const) {
      assert.equal(
        value,
        null,
        `${name} 必须是 NULL —— 填 0 之后"没人看"与"上游没回这个字段"在库里分不开（spec §4.2）`,
      );
    }
    assert.equal(row.tags, '[]', '时长不知道 ⇒ 一个时长标签都不打');
  });

  it('⑤ ★ 真的 0 播放量照存（0 与 NULL 是两件事）', () => {
    // ⚠️ 反面控制：上面那条不能退化成"凡是 0 都写成 NULL"。
    const creatorId = addCreator();
    upsertVideos(
      creatorId,
      'bilibili',
      [fetched('BV-zero', { viewCount: 0, commentCount: 0 })],
      NOW,
    );
    const row = rawVideo('bilibili', 'BV-zero');
    assert.equal(
      row?.view_count,
      0,
      '上游说 0 次播放 ⇒ 就是 0（我们不许**编**一个 0，但也不许把它抹掉）',
    );
    assert.equal(row?.comment_count, 0);
  });

  it('⑤ ★★ 时长不是正整数一律存 NULL（0 / 负数 / 小数 / NaN）', () => {
    /*
     * ★★ 这一条是 spec §4.3 那个字面判据的**最后一道闸**，也是数据层这边刻意补的：
     *   `deriveTags({durationSec: 0})` 返回 `['short']`（`0 <= 60` 为真），而这是**裁决过的**
     *   字面行为（T2 的文件头写明了）。T2 的三个解析器因此一个 0 都不产出、
     *   负值也到不了这里；但"写库"是**另一条路**：将来某个适配器算出一个 0、
     *   有人手工补数据、或者第五个平台带着自己的算法进来，都会走到这里。
     * ⇒ 这一层的契约是：**`duration_sec` 只接受正整数**，别的一律 NULL。
     *   `NULL` 是允许的状态（§4.3：没有时长就一个时长标签都不打），
     *   而一个 0 会变成一支"0 秒短视频"、带着一个**看起来完全正常**的 `short` 标签入库。
     */
    const creatorId = addCreator();
    upsertVideos(
      creatorId,
      'bilibili',
      [
        fetched('BV-dur-zero', { durationSec: 0 }),
        fetched('BV-dur-neg', { durationSec: -90 }),
        fetched('BV-dur-frac', { durationSec: 90.5 }),
        fetched('BV-dur-nan', { durationSec: Number.NaN }),
        fetched('BV-dur-inf', { durationSec: Number.POSITIVE_INFINITY }),
      ],
      NOW,
    );

    for (const id of ['BV-dur-zero', 'BV-dur-neg', 'BV-dur-frac', 'BV-dur-nan', 'BV-dur-inf']) {
      assert.equal(
        rawVideo('bilibili', id)?.duration_sec,
        null,
        `${id} 的时长必须存成 NULL —— 0 会被 deriveTags 打成 short，负值与小数是脏数据`,
      );
      assert.equal(
        rawVideo('bilibili', id)?.tags,
        '[]',
        `${id} 的标签必须是空的 —— duration_sec 与 tags 说的是同一件事，不许一个 NULL 一个 short`,
      );
    }
  });

  it('⑤ ★ 正整数的时长照存，并按 §4.3 打标签', () => {
    // 反面控制：上面那条不能退化成"时长一律 NULL"。
    const creatorId = addCreator();
    upsertVideos(
      creatorId,
      'bilibili',
      [
        fetched('BV-short', { durationSec: 60 }),
        fetched('BV-mid', { durationSec: 61 }),
        fetched('BV-long', { durationSec: 1200 }),
        fetched('BV-replay', { durationSec: 10, isLiveReplay: true }),
      ],
      NOW,
    );

    assert.equal(rawVideo('bilibili', 'BV-short')?.duration_sec, 60);
    assert.equal(rawVideo('bilibili', 'BV-short')?.tags, '["short"]', '≤60 ⇒ short（60 含在内）');
    assert.equal(rawVideo('bilibili', 'BV-mid')?.tags, '[]', '61…1199 中间档 v1 不打标签');
    assert.equal(rawVideo('bilibili', 'BV-long')?.tags, '["long"]', '≥1200 ⇒ long');
    assert.equal(
      rawVideo('bilibili', 'BV-replay')?.tags,
      '["liveReplay","short"]',
      'liveReplay 恒在时长标签之前（顺序是契约）',
    );
  });
});

// ---------------------------------------------------------------------------
// status（编辑手工隐藏过的那一支）
// ---------------------------------------------------------------------------

describe('追踪数据层：status 是编辑的手工状态，同步不许覆盖它', () => {
  it('★★ 手工隐藏过的视频，下一次抓取不许把它放回 visible', () => {
    /*
     * ★★ 这条是 plans/task-4 的 mutation 表点名的：`DO UPDATE` 里捎上
     *    `status = excluded.status` 的话，编辑手工隐藏过的那一支会被**下一轮同步**
     *    悄悄放回来 —— 而且没有任何地方报错，界面上看起来只是"它又出现了"。
     *    v1 **没有**隐藏端点（编辑是直接改库的），所以这条路的唯一凭据就是这个测试。
     */
    const creatorId = addCreator();
    upsertVideos(creatorId, 'bilibili', [fetched('BV-hidden', { title: '不该再出现' })], NOW);

    hideByHand('bilibili', 'BV-hidden');
    assert.equal(rawVideo('bilibili', 'BV-hidden')?.status, 'hidden', '夹具：先真的隐藏掉');

    upsertVideos(
      creatorId,
      'bilibili',
      [fetched('BV-hidden', { title: '同步回来的新标题', viewCount: 42 })],
      NOW + 600,
    );

    const row = rawVideo('bilibili', 'BV-hidden');
    assert.equal(
      row?.status,
      'hidden',
      '★★ status 必须还是 hidden —— 它在 DO UPDATE 里的话，这里会变成 visible',
    );
    assert.equal(
      row?.title,
      '同步回来的新标题',
      '反面控制：别的字段**照常**被更新（不是整条不动）',
    );
    assert.equal(row?.view_count, 42, '反面控制：同上');
  });

  it('★ 隐藏的行不进公开列表，但 storedVideoCount 照样数它', () => {
    /*
     * ⚠️ 这两个数是**故意不一样**的，别把它们"统一"掉：
     *   · 公开列表是**给人看的** ⇒ 隐藏了就不该出现（`videos.ts:274` 同一条纪律）；
     *   · `storedVideoCount` 是**给适配器判"到底了"用的**（spec §5.1）⇒ 它必须恰好是
     *     "这个 creator 在库里的行数"。按 status 过滤会让它**少算**，
     *     而少算的直接后果是 bilibili 的 `storedTotal >= page.count` 永远不成立 ⇒
     *     回填永远翻不完（不是丢数据，是永远停不下来）。
     */
    const creatorId = addCreator();
    upsertVideos(
      creatorId,
      'bilibili',
      [fetched('BV-v1', { publishedAt: NOW - 10 }), fetched('BV-h1', { publishedAt: NOW - 20 })],
      NOW,
    );
    hideByHand('bilibili', 'BV-h1');

    const visible = listTrackedVideos({ limit: 200, offset: 0 }).items.filter(
      (v) => v.creatorId === creatorId,
    );
    assert.deepEqual(
      visible.map((v) => v.externalId),
      ['BV-v1'],
      '★ 公开列表只出 visible 的行',
    );
    assert.equal(
      storedVideoCount(creatorId),
      2,
      '★ storedVideoCount 是"这个 creator 有几行"，**不是**"有几行可见的"',
    );
  });
});

// ---------------------------------------------------------------------------
// ⑥ 失败计数与水位
// ---------------------------------------------------------------------------

describe('追踪数据层：⑥ 失败计数、成功清零、水位', () => {
  it('⑥ ★ recordFailure 累加 consecutive_failures，并写下失败原文', () => {
    const id = insertCreator();
    recordFailure(id, '第一次：#412 风控', NOW + 1);
    assert.equal(rawCreator(id)?.consecutive_failures, 1, '第一次失败 ⇒ 1');
    assert.equal(rawCreator(id)?.last_error, '第一次：#412 风控');

    recordFailure(id, '第二次：#412 还是被拒', NOW + 2);
    assert.equal(
      rawCreator(id)?.consecutive_failures,
      2,
      '★ 必须**累加**（`= ?` 那种写法会让它永远停在 1，于是"要不要放弃这个频道"永远判不出来）',
    );
    assert.equal(rawCreator(id)?.last_error, '第二次：#412 还是被拒', 'last_error 留最新的那条');
    assert.equal(rawCreator(id)?.updated_at, NOW + 2);
  });

  it('⑥ ★ 一次成功（advanceCursor）把计数清零、把 last_error 抹掉', () => {
    const id = insertCreator();
    recordFailure(id, '失败', NOW);
    recordFailure(id, '失败', NOW);
    assert.equal(rawCreator(id)?.consecutive_failures, 2, '夹具：先攒两次失败');

    advanceCursor(id, 'pn=2', false, NOW + 60);

    assert.equal(rawCreator(id)?.consecutive_failures, 0, '★ 成功一次就清零（不是慢慢衰减）');
    assert.equal(
      rawCreator(id)?.last_error,
      null,
      '★ last_error 要抹成 NULL —— 留着的话管理面板上会一直显示一条早就好了的错误',
    );
  });

  it('⑥ ★ recordFailure 不许动 last_synced_at（动了下一轮就要白等一小时）', () => {
    /*
     * ⚠️ `last_synced_at` 是**成功**的水位（spec §3.2 那条判据读的就是它）。
     *    失败时顺手写上"刚刚试过了"会让这个博主在一小时内不再到点 ——
     *    表现是"它一直在失败，但日志里下一轮根本没有它"，比失败本身更难查。
     */
    const id = insertCreator({ backfillDone: 1, lastSyncedAt: NOW - 10 * HOUR });
    recordFailure(id, '失败', NOW);
    assert.equal(rawCreator(id)?.last_synced_at, NOW - 10 * HOUR, '水位必须原地不动');
  });

  it('⑥ advanceCursor：游标与水位一起写；done=false 时不许碰 backfill_done', () => {
    /*
     * ⚠️ 增量同步的路也会调 advanceCursor（done=false，游标是它自己那一页的）。
     *    那时把 `backfill_done` 清成 0 的话，一个**已经回填完**的博主会被重新扔回
     *    回填队列，于是每轮都从第一页重抓一遍 —— 而这没有任何报错。
     */
    const id = insertCreator({ backfillDone: 1, lastSyncedAt: NOW - 10 * HOUR });
    advanceCursor(id, 'pn=2', false, NOW);

    const row = rawCreator(id);
    assert.equal(row?.last_cursor, 'pn=2', '游标写进去了');
    assert.equal(row?.last_synced_at, NOW, '水位推到现在');
    assert.equal(row?.updated_at, NOW);
    assert.equal(row?.backfill_done, 1, '★ done=false 只是"这一轮暂时到这"，不许把它打回待回填');
  });

  it('⑥ advanceCursor：done=true 时 backfill_done 变 1、游标清空', () => {
    const id = insertCreator({ backfillDone: 0, lastCursor: 'pn=7' });
    advanceCursor(id, null, true, NOW);

    const row = rawCreator(id);
    assert.equal(row?.backfill_done, 1, '往回填完了');
    assert.equal(row?.last_cursor, null, '★ 收尾要把游标清掉：留着的话下次会从半路开始翻');
    assert.equal(row?.last_synced_at, NOW);
  });

  it('⑥ 对一个不存在的博主记失败/推水位：什么都不发生，也不抛', () => {
    // 现实里会有：管理员在 CLI 跑着的时候把博主删了（视频跟着级联没了）。
    recordFailure('tc-gone', '失败', NOW);
    advanceCursor('tc-gone', null, true, NOW);
  });
});

// ---------------------------------------------------------------------------
// storedVideoCount（spec §5.1 的 load-bearing 那个数）
// ---------------------------------------------------------------------------

describe('追踪数据层：storedVideoCount', () => {
  it('★ 恰好是"这个 creator 的行数"：含隐藏的、不含别人的', () => {
    const mine = addCreator();
    const other = addCreator();
    upsertVideos(mine, 'bilibili', [fetched('BV-s1'), fetched('BV-s2')], NOW);
    upsertVideos(other, 'bilibili', [fetched('BV-s3')], NOW);
    hideByHand('bilibili', 'BV-s2');

    assert.equal(
      storedVideoCount(mine),
      2,
      '★ 隐藏的那一行也要数（spec §5.1：这个数就是 bilibili 判"到底了"的依据，' +
        '少算会让回填永远翻不完）',
    );
    assert.equal(
      storedVideoCount(other),
      1,
      '别的博主的行不许算进来（多算会让 bilibili 提前认定到底）',
    );
  });

  it('★ 没见过的博主是 0，不是抛、也不是 null', () => {
    assert.equal(storedVideoCount('tc-nobody'), 0);
  });
});

// ---------------------------------------------------------------------------
// 公开列表 / 名单
// ---------------------------------------------------------------------------

describe('追踪数据层：公开列表与名单', () => {
  it('★ 公开列表按发布时间倒序、NULL 排最后、total 是匹配行数', () => {
    // ⚠️ 这一组要清表：`total` 是**全表**的数，不是按 creator 收窄的（见文件头夹具决定 ②）。
    getDb().exec('DELETE FROM tracked_creators');

    const a = addCreator();
    const b = addCreator();
    upsertVideos(
      a,
      'bilibili',
      [
        fetched('BV-old', { publishedAt: NOW - 300 }),
        fetched('BV-new', { publishedAt: NOW - 100 }),
        fetched('BV-nodate', { publishedAt: null }),
      ],
      NOW,
    );
    upsertVideos(b, 'bilibili', [fetched('BV-mid', { publishedAt: NOW - 200 })], NOW);

    const page = listTrackedVideos({ limit: 10, offset: 0 });
    assert.deepEqual(
      page.items.map((v) => v.externalId),
      ['BV-new', 'BV-mid', 'BV-old', 'BV-nodate'],
      '★ 发布时间倒序；日期不知道的排最后（不是排最前面冒充最新的）',
    );
    assert.equal(page.total, 4, 'total 是匹配的行数，与这一页取多少条无关');
  });

  it('★ 分页：limit/offset 生效，且负数 limit 不许变成"全都要"', () => {
    getDb().exec('DELETE FROM tracked_creators');
    const a = addCreator();
    upsertVideos(
      a,
      'bilibili',
      [
        fetched('BV-p1', { publishedAt: NOW - 10 }),
        fetched('BV-p2', { publishedAt: NOW - 20 }),
        fetched('BV-p3', { publishedAt: NOW - 30 }),
      ],
      NOW,
    );

    const first = listTrackedVideos({ limit: 2, offset: 0 });
    const second = listTrackedVideos({ limit: 2, offset: 2 });
    assert.deepEqual(
      first.items.map((v) => v.externalId),
      ['BV-p1', 'BV-p2'],
    );
    assert.deepEqual(
      second.items.map((v) => v.externalId),
      ['BV-p3'],
      '翻页要能取到剩下那条',
    );
    assert.equal(second.total, 3, 'total 与翻到第几页无关');

    assert.equal(
      listTrackedVideos({ limit: -1, offset: 0 }).items.length,
      0,
      '★ `LIMIT -1` 在 SQLite 里是"不限" ⇒ 一个负的 limit 绝不能变成"把整张表倒出来"',
    );
    assert.equal(
      listTrackedVideos({ limit: 5.5, offset: 0 }).items.length,
      0,
      '非整数 limit 也不许悄悄变成"随便取几条"',
    );
  });

  it('★ 公开列表的形状：字段名、tags 解析好、isLiveReplay 是 boolean', () => {
    getDb().exec('DELETE FROM tracked_creators');
    const a = addCreator();
    upsertVideos(
      a,
      'bilibili',
      [fetched('BV-shape', { durationSec: 30, isLiveReplay: true, viewCount: 7 })],
      NOW,
    );

    const [item] = listTrackedVideos({ limit: 1, offset: 0 }).items;
    assert.ok(item);
    assert.equal(item.creatorId, a, 'creatorId 是驼峰的对外名字');
    assert.equal(item.externalId, 'BV-shape');
    assert.deepEqual(item.tags, ['liveReplay', 'short'], 'tags 在库里是文本，在这一层是数组');
    assert.equal(item.isLiveReplay, true, 'isLiveReplay 在这一层是 boolean（库里是 0/1）');
    assert.equal(item.viewCount, 7);
    assert.equal(item.durationSec, 30);
    assert.equal(item.status, 'visible');
    assert.equal(
      'creatorName' in item,
      false,
      '公开列表不填 creatorName（shared 的注释：那一格只有管理面板要）',
    );
  });

  it('★ 名单：带上每个博主的条数、含停用的、按加入时间倒序', () => {
    getDb().exec('DELETE FROM tracked_creators');
    const older = insertCreator({ createdAt: NOW - 1000, displayName: '先加的' });
    const newer = insertCreator({ createdAt: NOW - 10, displayName: '后加的', enabled: 0 });
    upsertVideos(older, 'bilibili', [fetched('BV-l1'), fetched('BV-l2')], NOW);

    const all = listCreators();
    assert.equal(all.length, 2, '停用的那一行也必须在名单上（管理面板要能把它启回来）');
    assert.deepEqual(
      all.map((c) => c.id),
      [newer, older],
      '按加入时间倒序：刚加的那个在最上面（管理面板上"我刚加的那个"最好找）',
    );
    const byId = new Map(all.map((c) => [c.id, c]));
    assert.equal(byId.get(older)?.videoCount, 2);
    assert.equal(byId.get(newer)?.videoCount, 0);
    assert.equal(byId.get(newer)?.enabled, false, 'enabled 在这一层是 boolean');
    assert.equal(byId.get(older)?.backfillDone, false);
    assert.equal(byId.get(older)?.lastSyncedAt, null, '从没同步过是 null，不是 0');
  });
});

// ---------------------------------------------------------------------------
// 改与删
// ---------------------------------------------------------------------------

describe('追踪数据层：updateCreator', () => {
  it('★ 改显示名 / 停用启用 / 重新回填', () => {
    const id = addCreator();

    const renamed = updateCreator(id, { displayName: '新名字' }, NOW + 1);
    assert.equal(renamed?.displayName, '新名字');
    assert.equal(rawCreator(id)?.updated_at, NOW + 1, '改过就要动 updated_at');

    const disabled = updateCreator(id, { enabled: false }, NOW + 2);
    assert.equal(disabled?.enabled, false);
    assert.equal(rawCreator(id)?.enabled, 0, '库里是 0/1（CHECK 只收这两个值）');

    const enabled = updateCreator(id, { enabled: true }, NOW + 3);
    assert.equal(enabled?.enabled, true);
  });

  it('★ 重新回填只把 backfill_done 置 0，不碰 last_cursor', () => {
    /*
     * ⚠️ spec §6.1 对这个动作的定义只有一句："把 `backfill_done` 置 0"。
     *    顺手把 `last_cursor` 也清成 NULL 是**更容易想到**的做法（"重新"听起来就该从头），
     *    代价是丢掉被中断的那次回填的续点：一次回填是**有界**的（每轮最多 20 页，§3.3），
     *    一个 500 条的 UP 要跑好几轮 —— 每轮都清游标的话，它永远只抓得到前 20 页。
     *    所以这里窄读 spec：只改那一列。代价写清楚：手工"重新回填"一个翻到一半的博主时，
     *    它是**接着翻**的，不是从第一页重来。
     */
    const id = insertCreator({ backfillDone: 1, lastCursor: 'pn=9' });
    const updated = updateCreator(id, { reBackfill: true }, NOW + 1);

    assert.equal(updated?.backfillDone, false, '重新回填 ⇒ 又进待回填队列');
    assert.equal(rawCreator(id)?.last_cursor, 'pn=9', '★ 游标不许被清掉（它是被中断那次的续点）');
  });

  it('reBackfill=false 是个空操作（不许被当成"把回填标成完成"）', () => {
    const id = insertCreator({ backfillDone: 0 });
    updateCreator(id, { reBackfill: false }, NOW + 1);
    assert.equal(rawCreator(id)?.backfill_done, 0);
  });

  it('★ 改一个不存在的 id 回 null（不是抛，也不是编一行出来）', () => {
    assert.equal(updateCreator('tc-nope', { displayName: 'x' }, NOW), null);
  });

  it('★ 一个字段都没给时什么都不写（updated_at 也不动）', () => {
    const id = addCreator();
    const before = rawCreator(id);
    const after = updateCreator(id, {}, NOW + 999);
    assert.equal(after?.displayName, before?.display_name);
    assert.equal(
      rawCreator(id)?.updated_at,
      NOW,
      '没有实质改动就不该动 updated_at —— 那一列是"最后一次真的改到它"',
    );
  });
});
