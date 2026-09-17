/**
 * Ranked 共享层（解析 / 派生 / 纯函数）的测试。
 * ⚠️ 夹具是**从真实响应裁下来的**（2026-09-16 实测），字段名逐个照抄 ——
 *    形状写错的话，这一层"宽容"会把整格变成 null，而界面上只表现为一个「—」。
 * ⚠️ 本文件里**不许出现真实域名**（上游一律用内联对象，不打网络）。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RankedLiveData, RankedLiveMatch, RankedLivePlayer } from '@mcsr/shared/ranked';

const {
  parseLive,
  parseLeaderboard,
  parseWeekly,
  parseHeartbeat,
  sortLiveMatches,
  sliceLiveMatches,
  filterLiveMatches,
  bothStreaming,
  matchesNickname,
  topEloEntries,
  rankedLiveChannel,
  displayWeekNo,
  prevWeekId,
  nextWeekId,
  weekPath,
  formatRaceTime,
  formatClock,
  secondsAgo,
  TIMELINE_LABEL_KEYS,
  timelineLabel,
  RANKED_LIVE_BATCH,
  RANKED_ELO_TOP,
  RANKED_POLL_MS,
  RANKED_FETCH_OPTIONS,
  RANKED_FETCH_HEADERS,
} = await import('@mcsr/shared/ranked');

/**
 * `GET /live` 的五场，覆盖：正常 / timeline 为 null / 一人未定级 / 没有直播 / 认不出的平台，
 * 外加 spec §11.2 点名要的第五场 —— **平均 elo 最高，但其中一人 `null`**。
 * ⚠️ 第五场是**排序判据**，不是装饰：把 `null` 当 0 算的实现会让它的平均掉到 1250，
 *    于是**顺序**变了（不再排第一），而不只是某一个数字不对。
 */
const LIVE_FIXTURE = {
  status: 'success',
  data: {
    players: 1257,
    liveMatches: [
      {
        currentTime: 918454,
        players: [
          {
            uuid: 'aaa',
            nickname: 'HufterL',
            roleType: 1,
            eloRate: 1658,
            eloRank: 161,
            country: 'si',
          },
          {
            uuid: 'bbb',
            nickname: 'WhyIP',
            roleType: 2,
            eloRate: 1656,
            eloRank: 163,
            country: 'ro',
          },
        ],
        data: {
          aaa: {
            liveUrl: 'https://twitch.tv/hufterl',
            timeline: { time: 221649, type: 'nether.find_bastion' },
          },
          bbb: { liveUrl: null, timeline: { time: 750913, type: 'story.enter_the_end' } },
        },
      },
      {
        currentTime: 12_000,
        players: [
          {
            uuid: 'ccc',
            nickname: 'Newbie',
            roleType: 0,
            eloRate: null,
            eloRank: null,
            country: null,
          },
          {
            uuid: 'ddd',
            nickname: 'Veteran',
            roleType: 1,
            eloRate: 2000,
            eloRank: 12,
            country: 'us',
          },
        ],
        data: {
          ccc: { liveUrl: null, timeline: null },
          ddd: { liveUrl: 'https://kick.com/someone', timeline: { time: 500, type: 'story.root' } },
        },
      },
      {
        // 高分场：两个人 elo 都很高 ⇒ 必须排在第一位（验证排序不是"按数组顺序"）
        currentTime: 3_000,
        players: [
          { uuid: 'eee', nickname: 'Top1', roleType: 1, eloRate: 2349, eloRank: 1, country: 'gb' },
          { uuid: 'fff', nickname: 'Top2', roleType: 1, eloRate: 2208, eloRank: 2, country: 'hk' },
        ],
        data: { eee: { liveUrl: null, timeline: null }, fff: { liveUrl: null, timeline: null } },
      },
      {
        // 两个人**都没有** elo ⇒ avgElo 为 null ⇒ 必须排最后
        currentTime: 4_000,
        players: [
          {
            uuid: 'ggg',
            nickname: 'Unranked1',
            roleType: 0,
            eloRate: null,
            eloRank: null,
            country: null,
          },
          {
            uuid: 'hhh',
            nickname: 'Unranked2',
            roleType: 0,
            eloRate: null,
            eloRank: null,
            country: null,
          },
        ],
        data: { ggg: { liveUrl: null, timeline: null }, hhh: { liveUrl: null, timeline: null } },
      },
      {
        /*
         * ★★ 第五场（spec §11.2 明写："夹具含 `avgElo` 最高但一人 null"）：
         *    一人 2500、一人未定级 ⇒ 平均 **2500**（只对非 null 的值取平均）。
         *    ⚠️ 它是**全夹具平均最高**的那一场，所以"把 null 当 0 算"的实现会把它算成 1250，
         *       直接掉到 1657 后面 ⇒ **排序结果变了**。这正是这一场存在的理由：
         *       否则"null 当 0"只会让某一格数字不对（而排序看起来完全正常），没有断言钉得住它。
         */
        currentTime: 9_000,
        players: [
          { uuid: 'iii', nickname: 'Peak', roleType: 1, eloRate: 2500, eloRank: 1, country: 'us' },
          {
            uuid: 'jjj',
            nickname: 'Qualifier',
            roleType: 0,
            eloRate: null,
            eloRank: null,
            country: null,
          },
        ],
        data: { iii: { liveUrl: null, timeline: null }, jjj: { liveUrl: null, timeline: null } },
      },
    ],
  },
};

describe('冻结常量', () => {
  it('★ 条数与刷新间隔（spec §13）', () => {
    /*
     * ⚠️★ 2026-09-19：这一格从「取前 10」的 `RANKED_LIVE_TOP` 换成「一批渲染几场」的
     *    `RANKED_LIVE_BATCH`（用户要求**全部展示**，截断被"首批 + 加载更多"取代）。
     *    数从 10 抬到 20 的理由写在常量自己的注释里（实测常见量级是二三十场）。
     *    ⚠️ 钉死的仍然是**数**：改它要同时改 `const.ts` 的注释与 spec §13 那一行。
     */
    assert.equal(RANKED_LIVE_BATCH, 20);
    assert.equal(RANKED_ELO_TOP, 100);
    // ⚠️ 四个数逐个钉死：它们决定"多实时"与"多费访客的额度"，
    //    改一个都要同时改 spec §5.1 那张表。
    assert.deepEqual(RANKED_POLL_MS, { status: 15_000, live: 10_000, elo: 60_000, weekly: 60_000 });
  });

  it('★★ 直连的请求选项就是那四个（少一个都会让面板冻住或触发预检）', () => {
    assert.equal(RANKED_FETCH_OPTIONS.cache, 'no-store');
    assert.equal(RANKED_FETCH_OPTIONS.credentials, 'omit');
    assert.equal(RANKED_FETCH_OPTIONS.referrerPolicy, 'no-referrer');
    assert.deepEqual(
      RANKED_FETCH_HEADERS,
      { accept: 'application/json' },
      '只许有 CORS 安全列表内的头',
    );
  });
});

describe('parseLive：宽容解析 + 派生', () => {
  it('在线人数与场次数', () => {
    const d = parseLive(LIVE_FIXTURE);
    assert.ok(d);
    assert.equal(d.players, 1257);
    assert.equal(d.matches.length, 5);
  });

  it('★ 两人 elo 的平均：一人 null 时用另一个人的值；两人都 null 时是 null', () => {
    const d = parseLive(LIVE_FIXTURE);
    assert.ok(d);
    assert.equal(d.matches[1]?.avgElo, 2000, '一人 null ⇒ 取另一个人的');
    assert.equal(d.matches[3]?.avgElo, null, '两人都 null ⇒ null');
    assert.equal(d.matches[4]?.avgElo, 2500, '一人 2500、一人 null ⇒ 2500（不是 1250）');
  });

  it('★ 玩家顺序固定为 elo 高的在左（null 排后），而不是照上游数组顺序', () => {
    const d = parseLive(LIVE_FIXTURE);
    assert.equal(d?.matches[1]?.players[0]?.nickname, 'Veteran', '未定级的那位排到右边');
  });

  it('★ 当前进度与直播地址逐格照抄；timeline 为 null 时是 null 而不是丢字段', () => {
    const d = parseLive(LIVE_FIXTURE);
    const p = d?.matches[0]?.players[0];
    assert.equal(p?.timelineType, 'nether.find_bastion');
    assert.equal(p?.timelineTime, 221649);
    assert.equal(p?.liveUrl, 'https://twitch.tv/hufterl');
    assert.equal(d?.matches[1]?.players[1]?.timelineType, null);
  });

  it('★ 平台按域名判：twitch 认得出，kick 认不出（null）', () => {
    const d = parseLive(LIVE_FIXTURE);
    // ⚠️ 别忘了**玩家顺序已被固定**（elo 高的在左）：match[1] 左边是 Veteran（kick），
    //    右边是 Newbie（没有直播地址）—— 断言前先想清楚在哪一侧。
    assert.equal(d?.matches[0]?.players[0]?.livePlatform, 'twitch', 'match[0] 左边是 twitch');
    assert.equal(d?.matches[1]?.players[0]?.livePlatform, null, 'kick 不在白名单里');
    assert.equal(d?.matches[1]?.players[1]?.livePlatform, null, '没有直播地址 ⇒ null');
  });

  it('★ 整份不成形状 ⇒ null（缺 data / status 不是 success）', () => {
    assert.equal(parseLive({ status: 'error', data: null }), null);
    assert.equal(parseLive({ data: { players: 1 } }), null);
    assert.equal(parseLive(null), null);
    assert.equal(parseLive('nope'), null);
  });

  it('★★ 坏一格不毁一份：某一场的 data 缺一个 uuid ⇒ 那一格是 null，其它场次照常', () => {
    const broken = {
      status: 'success',
      data: {
        players: 5,
        liveMatches: [
          {
            currentTime: 1,
            players: [
              { uuid: 'x', nickname: 'X', roleType: 1, eloRate: 1000, eloRank: 10, country: 'us' },
              { uuid: 'y', nickname: 'Y', roleType: 1, eloRate: 900, eloRank: 20, country: 'us' },
            ],
            data: { x: { liveUrl: null, timeline: null } }, // y 那一格缺了
          },
          { currentTime: 2, players: [{ uuid: 'z', nickname: 'Z' }], data: {} },
        ],
      },
    };
    const d = parseLive(broken);
    assert.ok(d, '一份坏行不能让整份变 null');
    assert.equal(d.matches.length, 2);
    assert.equal(d.matches[0]?.players[1]?.nickname, 'Y', '玩家信息来自 players[]');
    assert.equal(d.matches[0]?.players[1]?.liveUrl, null, '缺的那一格是 null');
    assert.equal(d.matches[1]?.players[1]?.nickname, null, '只有一个玩家 ⇒ 右侧是空位');
  });
});

describe('RankedLiveMatch.key：卡片的身份（spec §4.3 / §6.3）', () => {
  it('★ 两个 uuid **排序后**拼起来 —— 与玩家的左右顺序无关', () => {
    // spec §4.3：上游没有 match id ⇒ 卡片的 key 只能是"两个 uuid 排序后拼起来"。
    assert.equal(parseLive(LIVE_FIXTURE)?.matches[0]?.key, 'aaa|bbb');
    /*
     * ⚠️ 第二行才是**真正钉住"排序"**的那一条：match[1] 的两人是"ccc 未定级 + ddd 2000"，
     *    而左右顺序被固定成"elo 高的在左" ⇒ 解析后**左边是 ddd**。
     *    于是"按左右顺序拼 key"的实现会给出 `'ddd|ccc'`（错），只有**排序后**拼才是 `'ccc|ddd'`。
     *    （match[0] 上两种情况恰好同形 —— 只用 match[0] 的话，这条断言看不出区别。）
     */
    assert.equal(parseLive(LIVE_FIXTURE)?.matches[1]?.key, 'ccc|ddd', '不是玩家左右顺序');

    /*
     * ⚠️ 为什么必须**排序**：左右顺序是按 elo 固定的（上面那条），而 elo 会变 ——
     *    同一场对局在两次刷新之间可能左右互换，key 若是按左右拼的，
     *    React 会把这张卡片当成**新的一张**重建（用户展开的直播框塌掉）。
     * ⚠️ 反向夹具用**克隆**：这条断言自己不许改动 LIVE_FIXTURE
     *    （下面那条"原始响应一字未改"的测试就是钉这个的）。
     */
    const swapped = structuredClone(LIVE_FIXTURE);
    const first = swapped.data.liveMatches[0];
    assert.ok(first, '夹具第一场必须在');
    first.players.reverse();
    assert.equal(parseLive(swapped)?.matches[0]?.key, 'aaa|bbb', '左右互换后 key 必须一字不差');
  });

  it('★★ 两行都读不出 uuid ⇒ 位置兜底 `#0` / `#1`，不会撞成同一个 key', () => {
    /*
     * ⚠️ 这一条防的是**静默的渲染错乱**，不是"上游一定会发这种响应"：上游实测恒发对象，
     *    但这一层是**宽容**层，而旧写法（空位拼空串）会让两行都拿到 `'|'` ——
     *    重复的 React key 只会让 React 在控制台嘟一句，然后把两张卡片的状态串在一起，
     *    界面上看起来"只是有点怪"，没有任何门禁会发现。
     * 兜底用**位置**：它在"同一份响应内"是稳定的，而 key 需要的**只是**这个。
     */
    const d = parseLive({
      status: 'success',
      data: { players: 1, liveMatches: [null, { players: [{ nickname: 'no uuid' }] }] },
    });
    assert.ok(d, '两行都读不出 ⇒ 也**不是**整份 null（坏一格不毁一份）');
    assert.equal(d.matches.length, 2);
    assert.equal(d.matches[1]?.players[0]?.nickname, 'no uuid', '读不出 uuid 的那一行照常保留');
    assert.deepEqual(
      d.matches.map((m) => m.key),
      ['#0', '#1'],
    );
  });
});

describe('sortLiveMatches', () => {
  it('★★ 按平均 elo 降序，两人都 null 的排最后', () => {
    const d = parseLive(LIVE_FIXTURE);
    assert.ok(d);
    const sorted = sortLiveMatches(d.matches);
    // 五场的平均 elo 分别是 1657 / 2000（一人 null）/ 2278.5 / null（两人都 null）/ 2500（一人 null）
    // ⚠️ 那个 2500 是**排序判据**，不只是个数字：把 null 当 0 算的实现会把它算成 1250，
    //    于是整串变成 [2278.5, 2000, 1657, 1250, null] —— 顺序变了，这条断言当场红。
    assert.deepEqual(
      sorted.map((m) => m.avgElo),
      [2500, 2278.5, 2000, 1657, null],
    );
  });

  it('★ 平均 elo 相同时按 key 升序（稳定排序，两次结果必须一样）', () => {
    const mk = (key: string, avg: number) =>
      ({ key, currentTime: 0, avgElo: avg, players: [] as never }) as never;
    const a = sortLiveMatches([mk('b', 100), mk('a', 100)]);
    assert.deepEqual(
      a.map((m) => m.key),
      ['a', 'b'],
    );
    assert.deepEqual(
      sortLiveMatches([mk('a', 100), mk('b', 100)]).map((m) => m.key),
      ['a', 'b'],
    );
  });

  it('★ 完全相同的 key 与平均 elo ⇒ 保持输入顺序（相等那一支不许把人往前挪）', () => {
    /*
     * 两项 key 与 avgElo 都相同 ⇒ 比较器必然走到"相等"那一支。它们在契约上**等价**，
     * 所以谁在前只由**输入顺序**决定（spec §6.3 / §11.2 第 2 条："并列按 `key` 升序（稳定排序）"）。
     * ⚠️ `currentTime` 是这两项之间唯一能看出"有没有被换位"的字段 —— 别处它们一模一样。
     * ⚠️ 两个方向都要断言：只调一次的话，某一次比较里的返回值有可能不影响结果。
     * ⚠️ 实测（修复报告 §11）：V8 的 `sort` **分不出** `0` 与 `1`（两者都把相等的元素留在原地），
     *    所以这条断言真正钉住的是"**相等不许返回负数**"（返回 -1 会当场把这两项对调），
     *    它**不能**证明实现恰好返回 `0`。写下这句是为了下一个人不要以为它守住了那个细节。
     */
    const a = { key: 'same', currentTime: 1, avgElo: 100, players: [] as never };
    const b = { key: 'same', currentTime: 2, avgElo: 100, players: [] as never };
    assert.deepEqual(
      sortLiveMatches([a, b]).map((m) => m.currentTime),
      [1, 2],
    );
    assert.deepEqual(
      sortLiveMatches([b, a]).map((m) => m.currentTime),
      [2, 1],
    );
  });

  it('★ 夹具不足一场批量时**全给**（不再截断），且不修改入参', () => {
    /*
     * ⚠️★ 这一条的前身是"取前 10"（`RANKED_LIVE_TOP`）。2026-09-19 用户要求
     *    **全部展示**，于是截断没了、`topLiveMatches` 也删了 —— 现在这一段钉的是
     *    "夹具那五场一场都不许少"：`sliceLiveMatches` 的可见段是"前 `shown` 张"，
     *    而 `shown` 由容器给（首批 `RANKED_LIVE_BATCH`）⇒ 少于一批时结果就是全部。
     */
    const d = parseLive(LIVE_FIXTURE);
    assert.ok(d);
    const before = d.matches.map((m) => m.key);
    const slice = sliceLiveMatches(d, { query: '', bothLiveOnly: false, shown: RANKED_LIVE_BATCH });
    assert.equal(slice.total, 5, '上游给了五场');
    assert.equal(slice.visible.length, 5, '不足一批就全给（**不**截断）');
    assert.equal(slice.remaining, 0, '还剩 0 场 ⇒ 界面上不该有「加载更多」');
    assert.deepEqual(
      d.matches.map((m) => m.key),
      before,
      '入参没被就地排序',
    );
  });
});

/* ---------------------------------------------------------------------------
 * ② 的筛选与分批（2026-09-19 用户要求：全部展示 + 昵称搜索 + 「只看双方都在直播」）
 * ------------------------------------------------------------------------- */

/**
 * 一段对局的形状。⚠️ 这里**直接造形状**、不经过 `parseLive`：
 *   · 上游实测里"双方都在直播"的对局很少，而那条判据的**正例**必须有一场
 *     （只有反例的话，一个"永远返回 false"的实现也能全绿）；
 *   · 混在一起的话，"筛选坏了"与"解析坏了"红了看起来一模一样。
 */
function livePlayer(o: {
  nickname?: string | null;
  eloRate?: number | null;
  liveUrl?: string | null;
  livePlatform?: 'twitch' | 'youtube' | 'bilibili' | null;
}): RankedLivePlayer {
  return {
    nickname: o.nickname ?? null,
    eloRate: o.eloRate ?? null,
    eloRank: null,
    timelineType: null,
    timelineTime: null,
    liveUrl: o.liveUrl ?? null,
    livePlatform: o.livePlatform ?? null,
  };
}

function liveMatch(
  key: string,
  avgElo: number | null,
  left: RankedLivePlayer,
  right: RankedLivePlayer,
): RankedLiveMatch {
  return { key, currentTime: 0, avgElo, players: [left, right] };
}

/** 一场对局：左 Twitch、右 **kick**（认不出的平台）。 */
const MATCH_BOTH_LIVE = liveMatch(
  'a|b',
  2200,
  livePlayer({
    nickname: 'StreamerA',
    eloRate: 2300,
    liveUrl: 'https://twitch.tv/streamera',
    livePlatform: 'twitch',
  }),
  livePlayer({ nickname: 'StreamerB', eloRate: 2100, liveUrl: 'https://kick.com/streamb' }),
);
/** 只有**左边**在直播 —— 「双方都直播」那条判据的反例。 */
const MATCH_ONE_LIVE = liveMatch(
  'c|d',
  2000,
  livePlayer({
    nickname: 'SoloC',
    eloRate: 2100,
    liveUrl: 'https://twitch.tv/soloc',
    livePlatform: 'twitch',
  }),
  livePlayer({ nickname: 'PlainD', eloRate: 1900 }),
);
/** 两人都没直播。 */
const MATCH_NO_LIVE = liveMatch(
  'e|f',
  1800,
  livePlayer({ nickname: 'OfflineE', eloRate: 1800 }),
  livePlayer({ nickname: 'OfflineF', eloRate: 1800 }),
);

/** 七场（**升序**入参：分最低的在最前面）：分批那几条断言要的场次比一批少，但足够看出切在哪。 */
const LIVE_SEVEN: RankedLiveData = {
  players: 1234,
  matches: Array.from({ length: 7 }, (_, i) =>
    liveMatch(
      `k${String(i)}|j${String(i)}`,
      /*
       * ⚠️★ 入参是**升序**塞进去的（第一项分最低、最后一项分最高）：`sliceLiveMatches` 会先
       *    按 `avgElo` 降序排 —— 照"分最高的在最前"塞的话，"取前 3 张"与"取输入前 3 项"
       *    分不出来，那几条关于切在哪里的断言就成了空跑。
       */
      1000 + i * 10,
      livePlayer({ nickname: `Player${String(i)}A`, eloRate: 1000 + i * 10 }),
      livePlayer({ nickname: `Player${String(i)}B`, eloRate: 1000 + i * 10 }),
    ),
  ),
};

/** 一段 `matched` / `visible` 的 key（断言里只关心"留下的是哪几场"）。 */
const keysOf = (matches: RankedLiveMatch[]): string[] => matches.map((m) => m.key);

describe('② 的筛选：bothStreaming / matchesNickname / filterLiveMatches', () => {
  it('★★ 双方都在直播：只有一方在直播的场次必须被藏掉（认不出的平台照样算）', () => {
    assert.equal(
      bothStreaming(MATCH_BOTH_LIVE),
      true,
      '★★ 两侧 `liveUrl` 都非 null ⇒ 命中（右边在 **kick** 上：判据是 liveUrl，不是平台白名单）',
    );
    assert.equal(bothStreaming(MATCH_ONE_LIVE), false, '★★ 只有一方在直播 ⇒ **不**命中');
    assert.equal(bothStreaming(MATCH_NO_LIVE), false, '★ 两人都没直播 ⇒ 不命中');

    /*
     * ⚠️★ 两条探针：下面那一对"正例 / 反例"必须真的分别是正例与反例 ——
     *    否则它们可能只是"同一场对局比了两次"（`§5.63` 那一族）。
     */
    assert.equal(
      MATCH_ONE_LIVE.players[0].liveUrl,
      'https://twitch.tv/soloc',
      '★ 探针：反例那一场**确实有一个人在直播**（否则它只是 `MATCH_NO_LIVE` 的复制品）',
    );
    assert.equal(
      MATCH_BOTH_LIVE.players[1].livePlatform,
      null,
      '★ 探针：正例的右侧是**认不出的平台** ⇒ 拿 `livePlatform` 当判据的实现会把它藏掉，这条当场红',
    );
    assert.notEqual(MATCH_BOTH_LIVE.players[1].liveUrl, null, '★ 探针：而它确实有 `liveUrl`');

    assert.deepEqual(
      keysOf(
        filterLiveMatches([MATCH_BOTH_LIVE, MATCH_ONE_LIVE, MATCH_NO_LIVE], {
          query: '',
          bothLiveOnly: true,
        }),
      ),
      ['a|b'],
      '★★ 开关开着时：三场里只留下双方都在直播的那一场',
    );
    assert.deepEqual(
      keysOf(
        filterLiveMatches([MATCH_BOTH_LIVE, MATCH_ONE_LIVE, MATCH_NO_LIVE], {
          query: '',
          bothLiveOnly: false,
        }),
      ),
      ['a|b', 'c|d', 'e|f'],
      '★ 正面对照：开关关着时三场一场都不许少（顺序 = 输入顺序，filter 不排序）',
    );
  });

  it('★★ 昵称搜索：两侧任一命中、忽略大小写、空词不筛（而且不搜地址）', () => {
    const all = [MATCH_BOTH_LIVE, MATCH_ONE_LIVE, MATCH_NO_LIVE];
    const search = (query: string): string[] =>
      keysOf(filterLiveMatches(all, { query, bothLiveOnly: false }));

    assert.deepEqual(
      search('streamerb'),
      ['a|b'],
      '★ 命中**右侧**那个人的昵称（不是只看左边那个人）',
    );
    assert.deepEqual(search('STREAMERB'), ['a|b'], '★★ 大写输入照样命中（大小写不敏感）');
    assert.deepEqual(search('reamer'), ['a|b'], '★★ 是**子串**匹配（搜昵称中段也要命中）');
    assert.deepEqual(
      search('StreamerB'),
      ['a|b'],
      '★ 与夹具原样大小写一致时当然也命中（正面对照）',
    );
    assert.deepEqual(search('plaind'), ['c|d'], '★ 另一场也搜得到（不是"只认第一场"）');
    assert.equal(matchesNickname(MATCH_BOTH_LIVE, 'streamera'), true, '★ 左侧那一册同样能命中');
    assert.deepEqual(search('nobodyhere'), [], '★★ 没有命中 ⇒ 一场都不留（不是"搜不到就全给"）');

    assert.equal(
      filterLiveMatches(all, { query: '', bothLiveOnly: false }).length,
      3,
      '★★ 空词 ⇒ 全都留下',
    );
    assert.equal(
      filterLiveMatches(all, { query: '   ', bothLiveOnly: false }).length,
      3,
      '★ 只有空白 ⇒ 与空词同一档（否则打一个空格进去整页会突然空掉）',
    );
    assert.deepEqual(search('  streamerb  '), ['a|b'], '★ 首尾空白被去掉（复制粘贴昵称时会带上）');
    /*
     * ⚠️★ 判据**只搜昵称**，不搜 `liveUrl`：这一条钉的是后半句 ——
     *    `MATCH_BOTH_LIVE` 右侧那条地址里就带着 `kick.com`，而它的昵称里没有。
     *    写成"搜地址"的实现会在这里多出一场，而界面上看起来只是"搜索结果比想的多一条"。
     */
    assert.deepEqual(search('kick.com'), [], '★★ 地址里的词不算命中（搜索框说的是「搜索选手」）');
  });

  it('★★ 两个条件是 AND：搜索命中的那一场只有一方在直播 ⇒ 照样被藏掉', () => {
    const all = [MATCH_BOTH_LIVE, MATCH_ONE_LIVE, MATCH_NO_LIVE];
    assert.deepEqual(
      keysOf(filterLiveMatches(all, { query: 'streamer', bothLiveOnly: true })),
      ['a|b'],
      '★★ 搜索命中 + 双方都直播 ⇒ 只剩那一场',
    );
    /*
     * ⚠️★ 这一条是"AND 还是 OR"的判据：`soloc` 只存在于 `MATCH_ONE_LIVE` 里，
     *    而那一场**只有一方在直播**。写成 OR 的实现会在这里返回 `['c|d']` —— 当场红。
     */
    assert.deepEqual(
      keysOf(filterLiveMatches(all, { query: 'soloc', bothLiveOnly: true })),
      [],
      '★★ 搜索命中但被开关筛掉 ⇒ 一场不剩（两个条件是 AND，不是 OR）',
    );
  });
});

describe('② 的分批：sliceLiveMatches', () => {
  it('★★ 四个数（总数 / 筛后 / 这一帧渲染的 / 还剩几场）来自同一次计算', () => {
    const slice = sliceLiveMatches(LIVE_SEVEN, {
      query: '',
      bothLiveOnly: false,
      shown: 3,
    });
    assert.equal(slice.total, 7, '★ total 是**上游的总场次**，与筛选无关');
    assert.equal(slice.matched.length, 7, '★ 没筛 ⇒ 筛后还是 7 场');
    assert.equal(slice.visible.length, 3, '★ 这一帧渲染前 3 张');
    assert.equal(slice.remaining, 4, '★★ 还剩 4 场 —— 界面那句「还有 N 场」必须就是它');
    assert.equal(
      slice.visible.length + slice.remaining,
      slice.matched.length,
      '★★ 渲染出来的 + 还剩的 = 筛后的总数（界面上那两处数字不许各算各的）',
    );
    /*
     * ⚠️ 取的是**分最高的那几张**（入参是升序塞进去的 ⇒ 照输入顺序取会拿到最低那几场）。
     */
    assert.deepEqual(keysOf(slice.visible), ['k6|j6', 'k5|j5', 'k4|j4']);
    assert.deepEqual(
      slice.visible.map((m) => m.avgElo),
      [1060, 1050, 1040],
    );
  });

  it('★★ 筛选与分批叠在一起时四个数跟着一起变（界面上那句"还有 N 场"不许虚报）', () => {
    const filtered = sliceLiveMatches(LIVE_SEVEN, {
      query: 'player2a',
      bothLiveOnly: false,
      shown: RANKED_LIVE_BATCH,
    });
    assert.equal(filtered.total, 7, '★ total 仍然是**上游的** 7 场（筛选不许把它改小）');
    assert.equal(filtered.matched.length, 1, '★ 只有一场命中');
    assert.equal(filtered.visible.length, 1);
    assert.equal(filtered.remaining, 0, '★★ 只剩一场 ⇒ 还剩 0 场（此时界面上不该有「加载更多」）');
    assert.deepEqual(keysOf(filtered.visible), ['k2|j2']);
    assert.notEqual(
      filtered.total,
      filtered.matched.length,
      '★ 探针：这份夹具里两个数确实不同（否则上面几条是空跑）',
    );
  });

  it('★ `shown` 小于一批时只给那么多；负数一律夹成 0（不许把最后一张悄悄吃掉）', () => {
    const none = sliceLiveMatches(LIVE_SEVEN, { query: '', bothLiveOnly: false, shown: 0 });
    assert.deepEqual(none.visible, [], '★ `shown: 0` ⇒ 一张都不渲染');
    assert.equal(none.remaining, 7, '★ 而"还剩 7 场"仍然是对的（界面上那句话说的是 truth）');

    /*
     * ⚠️★ `slice(0, -1)` 在 JS 里是"**从末尾往回数**"（= 除了最后一张），
     *    少的那张卡片在界面上看起来只是"这一场没了"，没有任何报错 ⇒ 夹成 0。
     */
    const negative = sliceLiveMatches(LIVE_SEVEN, { query: '', bothLiveOnly: false, shown: -1 });
    assert.deepEqual(negative.visible, [], '★★ 负数 ⇒ 0 张（**不是**"除了最后一张的 6 张"）');
    assert.equal(negative.remaining, 7);
  });

  it('★ 排序只做一次、入参一个字节都不动', () => {
    const data: RankedLiveData = {
      players: 1234,
      matches: [MATCH_NO_LIVE, MATCH_BOTH_LIVE, MATCH_ONE_LIVE],
    };
    const before = data.matches.map((m) => m.key);
    const slice = sliceLiveMatches(data, { query: '', bothLiveOnly: false, shown: 20 });
    assert.deepEqual(
      keysOf(slice.visible),
      ['a|b', 'c|d', 'e|f'],
      '★★ 输出按 `avgElo` 降序（夹具入参顺序是乱的：2200 那一场在中间）',
    );
    assert.deepEqual(
      data.matches.map((m) => m.key),
      before,
      '★★ 入参那份数组**不许被就地排序**（容器手上那份还要留给"上次刷新失败了"用）',
    );
  });
});

/**
 * `GET /leaderboard` 的那一段并列 + 跳号：`1, 3, 3, 5`（spec §11.2 明写 `…,3,3,5,…`）。
 * ⚠️ 第 3、4 行都**没有** `highest`（上游那格不在必填表里）：两处都必须印「—」，
 *    不是 `0`、不是 `undefined`（`0` 会印成"历史最高 0"，看起来像一个真数）。
 */
const LEADERBOARD_FIXTURE = {
  status: 'success',
  data: {
    season: { number: 12, startsAt: 1789430400, endsAt: 1798588800 },
    users: [
      {
        uuid: 'a',
        nickname: 'edcr',
        roleType: 1,
        eloRate: 2349,
        eloRank: 1,
        country: 'gb',
        seasonResult: {
          eloRate: 2349,
          eloRank: 1,
          phasePoint: 0,
          highest: 2385,
          phaseHighest: 2385,
        },
      },
      {
        uuid: 'b',
        nickname: 'A',
        roleType: 1,
        eloRate: 2000,
        eloRank: 3,
        country: 'us',
        seasonResult: { eloRate: 2000, eloRank: 3, phasePoint: 10, highest: 2010 },
      },
      {
        uuid: 'c',
        nickname: 'B',
        roleType: 1,
        eloRate: 2000,
        eloRank: 3,
        country: 'us',
        seasonResult: { eloRate: 2000, eloRank: 3, phasePoint: 10 },
      }, // 缺 highest
      {
        // ★ 并列之后**跳号**：3, 3 ⇒ 5（spec §11.2 明写 `…,3,3,5,…`）。这一行也缺 highest。
        uuid: 'd',
        nickname: 'C',
        roleType: 1,
        eloRate: 1990,
        eloRank: 5,
        country: 'us',
        seasonResult: { eloRate: 1990, eloRank: 5, phasePoint: 3 },
      }, // 缺 highest
    ],
  },
};

describe('parseLeaderboard：并列与跳号', () => {
  it('★ 排名取上游的 eloRank（并列照原样重复、并列之后跳号），不是下标 + 1', () => {
    const d = parseLeaderboard(LEADERBOARD_FIXTURE);
    assert.ok(d);
    assert.deepEqual(
      d.users.map((u) => u.rank),
      [1, 3, 3, 5],
    );
  });

  it('★ highest 缺了就 null（不是 undefined、不是 0）—— 并列那行与跳号那行各一处', () => {
    const d = parseLeaderboard(LEADERBOARD_FIXTURE);
    assert.equal(d?.users[0]?.highest, 2385);
    assert.equal(d?.users[2]?.highest, null, 'rank 3（并列的那一行）');
    assert.equal(d?.users[3]?.highest, null, 'rank 5（跳号的那一行）');
  });

  it('赛季起止与号数照抄（秒）', () => {
    const d = parseLeaderboard(LEADERBOARD_FIXTURE);
    assert.deepEqual(d?.season, { number: 12, startsAt: 1789430400, endsAt: 1798588800 });
  });

  it('★ 前 100（上游给 150）', () => {
    assert.equal(RANKED_ELO_TOP, 100);
    const many = Array.from({ length: 150 }, (_, i) => ({
      rank: i + 1,
      nickname: `u${i}`,
      eloRate: 1000 - i,
      highest: null,
      phasePoint: 0,
    }));
    assert.equal(topEloEntries(many).length, 100);
    assert.equal(topEloEntries(many)[99]?.rank, 100);
  });

  it('整份不成形状 ⇒ null', () => {
    assert.equal(parseLeaderboard({ status: 'success', data: { users: [] } }), null, '缺 season');
    assert.equal(
      parseLeaderboard({ status: 'success', data: { season: { number: 1 } } }),
      null,
      '缺 users',
    );
  });
});

/** `GET /weekly-race` 的一份响应（`flags` 我们不解析：新周是 207、老周是 `null`）。 */
const WEEKLY_FIXTURE = {
  status: 'success',
  data: {
    id: 103,
    endsAt: 1789948800,
    seed: {
      overworld: '146271395966650388',
      nether: '146271395966650388',
      theEnd: '146271395966650388',
      rng: '146271395966650388',
      flags: 207,
    },
    leaderboard: [
      {
        rank: 1,
        player: {
          uuid: 'a',
          nickname: 'xiamoys',
          roleType: 0,
          eloRate: null,
          eloRank: null,
          country: 'cn',
        },
        time: 244241,
        replayExist: true,
      },
      {
        rank: 2,
        player: {
          uuid: 'b',
          nickname: 'b',
          roleType: 1,
          eloRate: 1800,
          eloRank: 50,
          country: 'us',
        },
        time: 250000,
        replayExist: false,
      },
    ],
  },
};

describe('parseWeekly：id 用响应里的那个', () => {
  it('周数、截止、四个种子、条目逐格', () => {
    const d = parseWeekly(WEEKLY_FIXTURE);
    assert.ok(d);
    assert.equal(d.id, 103);
    assert.equal(d.endsAt, 1789948800);
    assert.equal(d.seed.overworld, '146271395966650388');
    assert.deepEqual(
      d.entries.map((e) => [e.rank, e.nickname, e.timeMs, e.eloRate, e.eloRank]),
      [
        [1, 'xiamoys', 244241, null, null],
        [2, 'b', 250000, 1800, 50],
      ],
    );
  });

  it('★ flags 不显示，但缺 flags 也要能解析（老周是 null）', () => {
    const noFlags = {
      status: 'success',
      data: {
        ...WEEKLY_FIXTURE.data,
        seed: { overworld: '1', nether: '2', theEnd: '3', rng: '4', flags: null },
      },
    };
    assert.ok(parseWeekly(noFlags));
  });

  it('整份不成形状 ⇒ null', () => {
    assert.equal(parseWeekly({ status: 'success', data: { id: 1 } }), null);
  });
});

/** 状态主机的两格：`heartbeatList` 里 monitor 2 的两条（旧→新）+ `uptimeList` 的 24 小时可用率。 */
const HEARTBEAT_FIXTURE = {
  heartbeatList: {
    2: [
      { status: 0, time: '2026-09-15 13:35:27', msg: '', ping: null },
      { status: 1, time: '2026-09-15 13:36:27', msg: '', ping: 380 },
    ],
  },
  uptimeList: { '2_24': 0.999, '3_24': 1 },
};

describe('parseHeartbeat：取最后一条心跳', () => {
  it('★ 取 monitor 2 的**最后一条**（数组是旧→新）', () => {
    assert.deepEqual(parseHeartbeat(HEARTBEAT_FIXTURE), {
      state: 1,
      checkedAt: '2026-09-15 13:36:27',
      ping: 380,
      uptime24: 0.999,
    });
  });

  it('★★ `checkedAt` 是**上游给的原样字符串**，不做时区换算（这一条防的是一类真缺陷）', () => {
    /*
     * ⚠️ 上游那个 `time` 形如 `2026-09-15 13:36:27`，**没有时区**。
     *    把它 `new Date(...)` 解析出来的话：JS 对非 ISO 形状按**本机时区**解释 ⇒
     *    ① 同一份数据在不同机器上算出不同的时刻；② 界面上显示的会随部署机器的 TZ 漂；
     *    ③ 测试要么在 UTC 机器上过、要么在 UTC+8 机器上红（本题的开发机是 UTC+8，
     *       所以一条"按本地解析"的实现会当场红 —— 这正是这条断言的用途）。
     * ⇒ 我们**原样带着这串字符**（界面上也原样显示「最后心跳 13:36:27」），
     *   不做任何时间戳换算。省掉的是一整类"时间显示得不对"的 bug。
     */
    const m = parseHeartbeat(HEARTBEAT_FIXTURE);
    assert.equal(m?.checkedAt, '2026-09-15 13:36:27');
    assert.notEqual(m?.checkedAt, undefined);
  });

  it('缺 uptime / 缺 ping 时各是 null（不是 0）', () => {
    const m = parseHeartbeat({
      heartbeatList: { 2: [{ status: 3, time: '2026-09-15 13:36:27' }] },
      uptimeList: {},
    });
    assert.equal(m?.uptime24, null);
    assert.equal(m?.ping, null);
    assert.equal(m?.state, 3, '维护态也要认');
  });

  it('整份不成形状 ⇒ null（没有 monitor 2 / 数组是空的）', () => {
    assert.equal(parseHeartbeat({ heartbeatList: {}, uptimeList: {} }), null);
    assert.equal(parseHeartbeat({ heartbeatList: { 2: [] } }), null);
    assert.equal(parseHeartbeat(null), null);
  });
});

describe('rankedLiveChannel：按域名认平台（不认字符串里出现过的域名）', () => {
  it('三个平台各认一种形状', () => {
    assert.deepEqual(rankedLiveChannel('https://twitch.tv/hufterl'), {
      platform: 'twitch',
      handle: 'hufterl',
      liveVideoId: null,
    });
    assert.deepEqual(rankedLiveChannel('https://www.youtube.com/watch?v=abcdefghijk'), {
      platform: 'youtube',
      handle: '',
      liveVideoId: 'abcdefghijk',
    });
    assert.deepEqual(rankedLiveChannel('https://live.bilibili.com/31288037'), {
      platform: 'bilibili',
      handle: '31288037',
      liveVideoId: null,
    });
  });

  it('★ 探针：域名里有 twitch.tv 但主机不是它 ⇒ null（不许用 includes 判）', () => {
    assert.equal(rankedLiveChannel('https://evil.example/?x=twitch.tv'), null);
    assert.equal(rankedLiveChannel('https://nottwitch.tv/x'), null);
  });

  it('认不出的平台与坏地址 ⇒ null', () => {
    assert.equal(rankedLiveChannel('https://kick.com/someone'), null);
    assert.equal(rankedLiveChannel(''), null);
    assert.equal(rankedLiveChannel(null), null);
    assert.equal(rankedLiveChannel('not a url'), null);
  });

  it('★ 余下的分支各有一条期望（每个分支都算一个判据）', () => {
    // youtu.be 短链：就是"某一场"，handle 按 live.ts 的约定是空串
    assert.deepEqual(rankedLiveChannel('https://youtu.be/abcdefghijk'), {
      platform: 'youtube',
      handle: '',
      liveVideoId: 'abcdefghijk',
    });
    // youtube.com/live/<id> 与 /embed/<id>：与 watch?v= 同形
    assert.deepEqual(rankedLiveChannel('https://www.youtube.com/live/abcdefghijk'), {
      platform: 'youtube',
      handle: '',
      liveVideoId: 'abcdefghijk',
    });
    assert.deepEqual(rankedLiveChannel('https://www.youtube.com/embed/abcdefghijk'), {
      platform: 'youtube',
      handle: '',
      liveVideoId: 'abcdefghijk',
    });
    // m.youtube.com 是**另一个主机名**，必须单独认（不是 www. 前缀那一条能覆盖的）
    assert.deepEqual(rankedLiveChannel('https://m.youtube.com/watch?v=abcdefghijk'), {
      platform: 'youtube',
      handle: '',
      liveVideoId: 'abcdefghijk',
    });
    // 频道页：只标出"这是频道页 + 频道级嵌入开着"，能不能嵌仍由 liveEmbedDecision 判
    assert.deepEqual(
      rankedLiveChannel('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv'),
      {
        platform: 'youtube',
        handle: 'UCabcdefghijklmnopqrstuv',
        liveVideoId: null,
        embedChannel: true,
      },
    );
    // @handle 形式的频道页 ⇒ null（频道级嵌入只认 UC 频道 ID；外链那一档不需要我们判平台）
    assert.equal(rankedLiveChannel('https://www.youtube.com/@someone'), null);
    // 协议白名单：javascript: / data: 既不是我们的链接，将来还会被放进 src/href
    assert.equal(rankedLiveChannel('javascript:alert(1)'), null);
    assert.equal(rankedLiveChannel('data:text/html,<b>x</b>'), null);
    // 光有主机名、没有标识的那一段
    assert.equal(rankedLiveChannel('https://twitch.tv/'), null);
    assert.equal(rankedLiveChannel('https://live.bilibili.com/'), null);
  });
});

/* ---------------------------------------------------------------------------
 * 跨**四条**解析函数的判据（spec §11.2 第 1 条）
 * ------------------------------------------------------------------------- */

describe('解析是纯函数（spec §11.2 第一条）', () => {
  it('★ 同一份响应解析两次，结果逐字段相同', () => {
    // ⚠️ 先钉"真的解析出了东西"：四个入口都返回 null 的话，下面四条 deepEqual 是**空过**的。
    assert.ok(parseLive(LIVE_FIXTURE), '这个夹具必须解析得出来');
    assert.ok(parseLeaderboard(LEADERBOARD_FIXTURE), '这个夹具必须解析得出来');
    assert.ok(parseWeekly(WEEKLY_FIXTURE), '这个夹具必须解析得出来');
    assert.ok(parseHeartbeat(HEARTBEAT_FIXTURE), '这个夹具必须解析得出来');

    assert.deepEqual(parseLive(LIVE_FIXTURE), parseLive(LIVE_FIXTURE));
    assert.deepEqual(parseLeaderboard(LEADERBOARD_FIXTURE), parseLeaderboard(LEADERBOARD_FIXTURE));
    assert.deepEqual(parseWeekly(WEEKLY_FIXTURE), parseWeekly(WEEKLY_FIXTURE));
    assert.deepEqual(parseHeartbeat(HEARTBEAT_FIXTURE), parseHeartbeat(HEARTBEAT_FIXTURE));
  });

  it('★★ 解析与排序都不改上游那份原始响应（不改入参、不就地排序）', () => {
    /*
     * ⚠️ 为什么这一条值得单独钉：`parseLive` 里有一处 `slots.sort()`（固定左右顺序），
     *    写在**调用方**那份数组上（而不是我们新建的那个）是很容易犯的错 ——
     *    而它不会抛错、不会变慢、界面看起来也正常，只是上游那份响应的顺序被悄悄改了。
     *    这一层刻意不读时钟（`fetchedAt` 由容器记，spec §4.4），所以"不碰入参"是同一类要求。
     */
    const before = structuredClone(LIVE_FIXTURE);
    const parsed = parseLive(LIVE_FIXTURE);
    assert.ok(parsed);
    const orderBefore = parsed.matches.map((m) => m.key);
    sortLiveMatches(parsed.matches);
    sliceLiveMatches(parsed, { query: '', bothLiveOnly: false, shown: RANKED_LIVE_BATCH });
    assert.deepEqual(
      parsed.matches.map((m) => m.key),
      orderBefore,
      'sortLiveMatches / sliceLiveMatches 不许就地排掉调用方那份 matches',
    );
    assert.deepEqual(LIVE_FIXTURE, before, '上游那份原始响应必须一字未改');

    // 另外三个入口同一类缺陷，一起钉：克隆在前、解析在后，逐个比对。
    const lbBefore = structuredClone(LEADERBOARD_FIXTURE);
    const weekBefore = structuredClone(WEEKLY_FIXTURE);
    const beatBefore = structuredClone(HEARTBEAT_FIXTURE);
    parseLeaderboard(LEADERBOARD_FIXTURE);
    parseWeekly(WEEKLY_FIXTURE);
    parseHeartbeat(HEARTBEAT_FIXTURE);
    assert.deepEqual(LEADERBOARD_FIXTURE, lbBefore, '排行榜那份原始响应必须一字未改');
    assert.deepEqual(WEEKLY_FIXTURE, weekBefore, '周赛那份原始响应必须一字未改');
    assert.deepEqual(HEARTBEAT_FIXTURE, beatBefore, '心跳那份原始响应必须一字未改');
  });
});

/* ---------------------------------------------------------------------------
 * 纯函数层的三张小表（spec §6.5 / §7.2）—— 全是**值**的断言，不打网络
 * ------------------------------------------------------------------------- */

describe('周数：-1 显示成第 0 周，1 起一一对应', () => {
  it('★ 显示映射', () => {
    assert.equal(displayWeekNo(-1), 0);
    assert.equal(displayWeekNo(1), 1);
    assert.equal(displayWeekNo(103), 103);
  });

  it('★★ 翻页是跨过 0 的阶梯函数：0 是"本周"的别名，永远不能请求它', () => {
    assert.equal(prevWeekId(103), 102);
    assert.equal(prevWeekId(2), 1);
    assert.equal(prevWeekId(1), -1, '第 1 周的上一页是第 -1 周（显示为第 0 周）');
    assert.equal(prevWeekId(-1), null, '第 0 周是最早的一页（-2/-3 实测不存在）');
    assert.equal(nextWeekId(-1, 103), 1, '第 0 周的下一页是第 1 周');
    assert.equal(nextWeekId(1, 103), 2);
    assert.equal(nextWeekId(103, 103), null);
  });

  it('★★ 两个函数都**永不**产出 0（这一条是本节的要点）', () => {
    /*
     * ⚠️ 为什么"永不产出 0"值得单独一条：上游把 `id = 0` 当成**"本周"的别名**，
     *    请求它会返回**另一周**的数据 ⇒ 界面闪一下然后跳到本周，而 URL 里写着 0。
     *    两个函数都是**结构上**跨过 0 的阶梯（不是 `id ± 1`），这一条就是那个形状的判据：
     *    把它们改回 `id ± 1`（mutation ③）会让 `prevWeekId(1)` / `nextWeekId(-1, 103)` 当场变 0。
     */
    const ids = [-1, 1, 2, 3, 50, 102, 103];
    for (const id of ids) {
      assert.notEqual(prevWeekId(id), 0, `prevWeekId(${id})`);
      assert.notEqual(nextWeekId(id, 103), 0, `nextWeekId(${id})`);
    }
  });

  it('链接形状', () => {
    assert.equal(weekPath(102), '/ranked/weekly/102');
  });
});

describe('时间格式', () => {
  it('★ 周赛成绩带毫秒；不足一小时不带小时位', () => {
    assert.equal(formatRaceTime(244241), '4:04.241');
    assert.equal(formatRaceTime(59_999), '0:59.999');
    assert.equal(formatRaceTime(0), '0:00.000');
    assert.equal(formatRaceTime(3_600_000), '1:00:00.000');
    assert.equal(formatRaceTime(3_661_001), '1:01:01.001');
  });

  it('★ 对局时间不带毫秒', () => {
    assert.equal(formatClock(918454), '15:18');
    assert.equal(formatClock(141_000), '2:21');
    assert.equal(formatClock(3_600_000), '1:00:00');
    assert.equal(formatClock(0), '0:00');
  });

  it('毫秒补零到三位（不是两位）', () => {
    assert.equal(formatRaceTime(1004), '0:01.004');
    assert.equal(formatRaceTime(1040), '0:01.040');
  });

  it('★ 进位边界：秒以下是**向下取整**，显示的时间不许跑到真实时间前面', () => {
    /*
     * ⚠️ 这两个数是"取整"与"四舍五入"唯一分得开的地方：
     *    四舍五入的实现会把 59_999 ms 印成 `1:00`、把 3_599_999 ms 印成 `1:00:00` ——
     *    也就是**显示一个还没到的时间**（对局已进行的时间、节点时间都是同一类）。
     *    四舍五入在这里不会抛错、也不会被别处发现，只会让人看到"刚刚明明还没到 1 分钟"。
     */
    assert.equal(formatClock(59_999), '0:59');
    assert.equal(formatClock(3_599_999), '59:59');
  });

  it('★ 负数是 0（钳位）：宁可显示 0:00 也不显示 "-1:-1.-1"', () => {
    // ⚠️ 上游理论上不会给负数。这一条钉的是"钳位是**有意**写的" ——
    //    去掉 `Math.max(0, …)` 的话，负毫秒会渲染成 `-1:-1.-1` 这种没有任何读者能解释的字符串。
    assert.equal(formatRaceTime(-1), '0:00.000');
    assert.equal(formatClock(-1), '0:00');
  });

  it('★★ 两个函数只收**毫秒**（上游 Date 是秒，换算在调用点做）', () => {
    /*
     * ⚠️ 上游 `Date` 一律是**秒**（赛季起止、心跳、周赛 endsAt），`Time` 一律是**毫秒**
     *    （对局时间、周赛成绩、节点时间）。单位搞混**不会抛错**，只会印出一个荒谬的时长
     *    （"0:04" 或 "4074:31"），而画面上看起来只是"这个数有点怪"。
     * ⇒ 这一层**不做**任何单位猜测（猜就可能猜错，代价是调用点必须自己乘 1000）：
     *    两个函数收到的数一律当毫秒。下面两个数就是**夹具里真实的毫秒**，
     *    所以"有人偷偷按秒解释"的话，它们会当场变成 `3:41` / `15:18` 之外的另一个值。
     */
    assert.equal(formatRaceTime(221_649), '3:41.649', '夹具里 timeline.time 那格（毫秒）');
    assert.equal(
      formatClock(750_913),
      '12:30',
      '夹具里另一格：750913 ms 就是 spec §6.3 草图上的 12:30',
    );
  });

  it('★★ 新鲜度（`secondsAgo`）：向下取整、钳到 0、没有数据回 `null`', () => {
    /*
     * ⚠️★ 这一条守的是 spec §6.6 那**两句冻结文案**里的数字（「{{secs}} 秒前更新」与
     *    「上次刷新失败了，下面是 {{secs}} 秒前的数据」）：两句话会在同一次渲染里同时出现，
     *    而它们的 N 来自**同一次调用**（两个容器里都是 `staleSecs = updatedAgoSecs`）。
     *    算式从容器里提进 shared 就是为了让这一条写得出（`apps/web` 没有测试运行器）。
     * ⚠️ 四栏各自都要有判据，缺一格就是"某个方向错了但没人发现"：
     *    取整方向（1.999 秒）／钳位（时钟往回跳）／`null`（这一行根本不该出现）。
     */
    assert.equal(secondsAgo(1_000_000, 940_000), 60, '60 秒整');
    assert.equal(secondsAgo(1_999, 0), 1, '★ 向下取整：1.999 秒 ⇒ 1（四舍五入会说"2 秒前"）');
    assert.equal(secondsAgo(1_000_000, 999_500), 0, '半秒 ⇒ 0（那一秒还没过去）');
    assert.equal(secondsAgo(1_000_000, 1_000_400), 0, '★★ 时钟往回跳 ⇒ 钳到 0（不是「-0 秒前」）');
    assert.equal(
      secondsAgo(1_000_000, null),
      null,
      '★★ 手上没有属于这一页的数据 ⇒ `null`（0 会让界面印一句「0 秒前更新」）',
    );
  });
});

describe('进度标识：表 + 未知回落', () => {
  const t = (key: string): string => `[${key}]`;

  it('★ 表里的标识走词条；不在表里的**原样**返回（不返回 key）', () => {
    assert.equal(timelineLabel('nether.find_bastion', t), '[ranked.timeline.findBastion]');
    assert.equal(
      timelineLabel('projectelo.timeline.blind_travel', t),
      '[ranked.timeline.blindTravel]',
    );
    assert.equal(timelineLabel('nether.find_ruined_portal', t), 'nether.find_ruined_portal');
  });

  it('★ null / 空串 ⇒ 占位符词条（不是空串、不是 key 本身）', () => {
    assert.equal(timelineLabel(null, t), '[ranked.unknown]');
    assert.equal(timelineLabel('', t), '[ranked.unknown]');
  });

  it('★ 表里每一条的 key 都是 `ranked.timeline.` 前缀且不重复（防止手抄时串行）', () => {
    const keys = Object.values(TIMELINE_LABEL_KEYS);
    assert.equal(new Set(keys).size, keys.length, '词条 key 不许重复');
    for (const k of keys) assert.ok(k.startsWith('ranked.timeline.'), k);
  });

  it('★★ 原型链上的名字不是表里的名字（`in` 会在这里骗过去）', () => {
    /*
     * ⚠️ 判据必须是"**这个 type 在不在表里**"，而 `type in TIMELINE_LABEL_KEYS` 问的是
     *    "在不在原型链上" —— `'constructor' in TIMELINE_LABEL_KEYS` 是 **true**，
     *    于是查表拿到 `Object.prototype.constructor`（一个函数），最后 `t(函数)` 把
     *    `function Object() { [native code] }` 印到界面上。上游只要发一个叫 `constructor`
     *    的节点就会命中，而这一层正是为了"上游随时会加新值"才存在的。
     *    ⇒ 用 `Object.hasOwn`；这一条就是它与 `in` / `!== undefined` 之间的判据。
     */
    assert.equal(timelineLabel('constructor', t), 'constructor');
    assert.equal(timelineLabel('toString', t), 'toString');
    assert.equal(timelineLabel('hasOwnProperty', t), 'hasOwnProperty');
  });
});
