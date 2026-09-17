/**
 * Ranked 共享层（解析 / 派生 / 纯函数）的测试。
 * ⚠️ 夹具是**从真实响应裁下来的**（2026-09-16 与 **2026-09-17**（round 3：玩家详情与最近比赛）
 *    两次实测），字段名逐个照抄 —— 形状写错的话，这一层"宽容"会把整格变成 null，
 *    而界面上只表现为一个「—」。
 * ⚠️ 本文件里**不许出现真实域名**（上游一律用内联对象，不打网络）。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  RankedLiveData,
  RankedLiveMatch,
  RankedLivePlayer,
  RankedMatch,
} from '@mcsr/shared/ranked';

const {
  parseLive,
  parseLeaderboard,
  parseWeekly,
  parseHeartbeat,
  parsePhase,
  parseMatches,
  parsePlayerDetail,
  parseWeekInput,
  sortLiveMatches,
  sliceLiveMatches,
  filterLiveMatches,
  bothStreaming,
  matchesNickname,
  topEloEntries,
  filterEloUsers,
  opponentOf,
  matchOutcome,
  eloChangeOf,
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
  RANKED_STATUS_COMPONENTS,
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
    /*
     * ★★ 150 —— 用户 2026-09-19 的口径（「排行榜显示前 150 信息」），而且它**同时是**
     *    上游的硬上限：实测 `?count=200` / `?count=1` / `?page=1&count=150` 与不带参数的
     *    响应**字节完全相同**（都是 150 条）⇒ 上游**忽略**这两个参数，第 151 行拿不到。
     *    ⇒ 界面上没有"下一页"不是"还没做"，是**没有下一页**（`const.ts` 上写着这一段）。
     *    ⚠️ 这条断言钉的是数：改成 100（旧口径）或 200（上游给不出）都要在这里红。
     */
    assert.equal(RANKED_ELO_TOP, 150);
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

  it('★ 前 150（上游给的就是 150，所以这一层其实一条都没丢）', () => {
    assert.equal(RANKED_ELO_TOP, 150);
    const many = Array.from({ length: 150 }, (_, i) => ({
      rank: i + 1,
      nickname: `u${i}`,
      eloRate: 1000 - i,
      highest: null,
      phasePoint: 0,
    }));
    assert.equal(topEloEntries(many).length, 150, '★ 上游那 150 条**一条都不许少**');
    assert.equal(topEloEntries(many)[149]?.rank, 150, '★ 第 150 名在（这是用户点名要看的那一行）');
    /*
     * ⚠️ 上界那一半：上游哪天给得比 150 多（文档从没承诺过 150 是永久的），
     *    表格的长度由这个常量说了算 —— 它防的是"上游一变多，页面就被撑爆"。
     */
    const more = [
      ...many,
      { rank: 151, nickname: 'u150', eloRate: 800, highest: null, phasePoint: 0 },
    ];
    assert.equal(topEloEntries(more).length, 150, '★ 超过 150 条时截到 150（上界）');
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

/**
 * 状态主机的**真实形状**（2026-09-17 实测裁下来）：四格 `heartbeatList`
 * （键是**光秃秃的 id**）各带一串**旧 → 新**的心跳，外加 `uptimeList`。
 *
 * ⚠️★ 这份夹具比原来那份**真实**：原来只有 monitor 2 那一格（那时状态栏只显示 Game Server），
 *    而现在这一栏显示**四格**（用户 2026-09-19：Game Server / API / Store / Wiki
 *    的"状态 + 最后更新时间"）⇒ 夹具必须四格都有，否则"四格各自取自己那条"这件事
 *    根本测不到（只有一格在的时候，一个"把同一格印四遍"的实现照样绿）。
 * ⚠️ 每格放**两条**（状态不同、时间不同）：数组是旧 → 新的，取第一条的实现会取到
 *    **上一条**（状态与时间都错），而它在界面上看起来完全正常（都是真实取值）。
 * ⚠️ 四格的时间**不是两两不同的四个值**（照实测抄的，别顺手改成"四个都不一样"）：
 *    monitor 3 在 `11:18:07`（与 2/4/5 不在一个网格上），而 monitor 2 与 monitor 4
 *    落在**同一秒** `11:16:27` 上（monitor 5 是 `11:16:28`）。
 *    ⇒ 这份夹具证明的是"每一格取的是**自己那条**最后的心跳"这件事**可断言**：
 *    取第一条（旧的那条时间全都不同）、或把某一格的时间印到别的格上，下面都会红。
 *    ⚠️ 在**时间**这一项上唯一蒙得过去的，是把 monitor 2 与 monitor 4 的**时间对调**
 *    （这两格上游实测同秒）—— 为了让断言更强而把它改掉，就等于替上游断言一件不存在的事。
 * ⚠️ `ping` 与 `uptimeList` 照实测写上（上游确实给），但我们**不读**它们：
 *    延迟与 24 小时可用率被用户从状态栏删掉了（2026-09-19）⇒ 它们在形状里**没有位置**，
 *    下面那条"形状里只有四件事"的断言就是这件事的守卫。
 */
const HEARTBEAT_FIXTURE = {
  heartbeatList: {
    2: [
      { status: 0, time: '2026-09-17 11:15:27', msg: '', ping: null },
      { status: 1, time: '2026-09-17 11:16:27', msg: '', ping: 268 },
    ],
    3: [
      { status: 1, time: '2026-09-17 11:13:07', msg: '', ping: 164 },
      { status: 1, time: '2026-09-17 11:18:07', msg: '', ping: 164 },
    ],
    4: [
      { status: 2, time: '2026-09-17 11:14:27', msg: '', ping: 30 },
      { status: 2, time: '2026-09-17 11:16:27', msg: '', ping: 2 },
    ],
    5: [
      { status: 3, time: '2026-09-17 11:14:28', msg: '', ping: 8 },
      { status: 3, time: '2026-09-17 11:16:28', msg: '', ping: 1 },
    ],
  },
  uptimeList: { '2_24': 0.999, '3_24': 1, '4_24': 1, '5_24': 1 },
};

/** 那份夹具**期望**解析出来的四格（顺序 = `RANKED_STATUS_COMPONENTS` 那张表）。 */
const HEARTBEAT_EXPECTED = [
  { id: '2', nameKey: 'ranked.componentGameServer', state: 1, checkedAt: '2026-09-17 11:16:27' },
  { id: '3', nameKey: 'ranked.componentApi', state: 1, checkedAt: '2026-09-17 11:18:07' },
  { id: '4', nameKey: 'ranked.componentStore', state: 2, checkedAt: '2026-09-17 11:16:27' },
  { id: '5', nameKey: 'ranked.componentWiki', state: 3, checkedAt: '2026-09-17 11:16:28' },
];

describe('parseHeartbeat：四格组件、各取各自最后一条心跳', () => {
  it('★★ 四格逐格断言：id / 名字 / 状态 / 最后更新时间（顺序 = 那张表）', () => {
    /*
     * ⚠️★ 这条是 2026-09-19 改版的**中心断言**：状态栏从"一格（Game Server）"变成
     *    "四格（Game Server / API / Store / Wiki）"，四格各自有**自己的**状态与时间。
     *    一次 deepEqual 同时钉住四件事：顺序、id、名字 key、以及"每格取的是自己那条最后的心跳"
     *    （夹具里每格两条，取错了会拿到上一条的状态或时间）。
     */
    assert.deepEqual(parseHeartbeat(HEARTBEAT_FIXTURE), HEARTBEAT_EXPECTED);
  });

  it('★★ 上游少了某一格 ⇒ 那一格是 `null`（**不是**"故障"，也不是整份消失）', () => {
    /*
     * ⚠️★ 这是"宽容解析"在这一层的落点：上游某一刻少了 monitor 4 那一格（或它的数组是空的）
     *    时，**另外三格照给**，而 Store 那一行照样在界面上（`state: null` ⇒ 印 `—`）。
     *    三条否决过的做法，每条都有具体代价：
     *      · 整份返回 null ⇒ 端点回 502，一次"少了一格"变成整个状态栏不可用；
     *      · 悄悄少一行 ⇒ 用户以为状态栏本来就长这样（而少的那一格可能正是他关心的）；
     *      · 把 `null` 当成 0（故障）⇒ 替他断言一件我们不知道的事。
     */
    const missingStore = {
      ...HEARTBEAT_FIXTURE,
      heartbeatList: { ...HEARTBEAT_FIXTURE.heartbeatList, 4: [] },
    };
    const parsed = parseHeartbeat(missingStore);
    assert.ok(parsed, '少了一格**不该**让整份解析失败');
    assert.equal(parsed.length, 4, '★ 界面上的行数恒为四（表里那四个）');
    assert.deepEqual(parsed[2], {
      id: '4',
      nameKey: 'ranked.componentStore',
      state: null,
      checkedAt: null,
    });
    assert.equal(parsed[2]?.state === null, true, '★ 读不到 ≠ 故障（0 是"故障"）');
    // 正面对照：另外三格**一个字都没受影响**（少一格不该波及别人）
    assert.deepEqual(
      parsed.filter((_, i) => i !== 2),
      HEARTBEAT_EXPECTED.filter((_, i) => i !== 2),
    );
  });

  it('★ 整份不成形状 ⇒ null（响应不是对象 / 四格一个状态都没有）', () => {
    assert.equal(parseHeartbeat(null), null);
    assert.equal(parseHeartbeat('nope'), null);
    assert.equal(parseHeartbeat({ uptimeList: {} }), null, '缺 heartbeatList');
    /*
     * ⚠️★ 这一条是"上游换了键"与"四个服务刚好都没数据"之间的分界：四格**全都没有状态** ⇒
     *    那是我们的适配层对不上了（端点回 502 并记下是哪几个 id），而**不是**
     *    界面上出现四行整齐的「—」（那种静默降级我们永远查不出来）。
     */
    assert.equal(parseHeartbeat({ heartbeatList: { 7: [{ status: 1, time: 'x' }] } }), null);
    assert.equal(parseHeartbeat({ heartbeatList: {} }), null);
  });

  it('★★ `checkedAt` 是**上游给的原样字符串**，不做时区换算（这一条防的是一类真缺陷）', () => {
    /*
     * ⚠️★ 这是那一格**唯一**需要写下来的判断（`types.ts` 的长注释是全文）：
     *    上游那个 `time` 形如 `2026-09-17 11:16:27`，**没有时区**。
     *    把它 `new Date(...)` 解析出来的话：JS 对非 ISO 形状按**本机时区**解释 ⇒
     *    ① 同一份数据在不同机器上算出不同的时刻；② 界面上显示的会随部署机器的 TZ 漂
     *    （本仓被一次静默的 **8 小时**偏移烧过）；③ 测试要么在 UTC 机器上过、
     *    要么在 UTC+8 机器上红（本题的开发机是 UTC+8，所以一条"按本地解析"的实现会当场红）。
     * ⇒ 判定：**它就是一个字符串，我们一个时间戳都不换算**，界面上原样印
     *    「最后更新 2026-09-17 11:16:27」；而"这份数据有多旧"由外壳那一行
     *    `updatedAgoSecs`（**本地**时钟算的）回答 —— 两件事，各说各的。
     *    下面三条断言把这件事钉死：类型是 string、四格逐个是夹具里那一串、
     *    换一份夹具就换成那一份的文本（防"其实印的是某个常量"）。
     */
    const parsed = parseHeartbeat(HEARTBEAT_FIXTURE);
    assert.ok(parsed);
    for (const component of parsed) {
      assert.equal(
        typeof component.checkedAt,
        'string',
        `★ ${component.id} 那一格的时间必须是字符串（不是时间戳、不是 Date）`,
      );
    }
    assert.deepEqual(
      parsed.map((each) => each.checkedAt),
      HEARTBEAT_EXPECTED.map((each) => each.checkedAt),
      '★★ 四格各自上游那串文本**逐字**（差了任何一个字符都说明我们在格式化它）',
    );
    const other = parseHeartbeat({
      heartbeatList: { 2: [{ status: 1, time: '2026-01-02 03:04:05' }] },
    });
    assert.equal(other?.[0]?.checkedAt, '2026-01-02 03:04:05', '★ 换一份 ⇒ 印那一份（不是常量）');
    /*
     * ⚠️ 探针：把上游那串按**本地时区**解析出来的时刻，与按 UTC 解析出来的时刻
     *    **不是同一个**（在 UTC+8 这台机器上是 8 小时之差）—— 也就是说上面那条
     *    "当字符串用"的判据**确实**挡住了一类真实的缺陷，而不是形式主义。
     *    ⚠️ 判据写成"两个解析结果不同"而不是"相差 8 小时"：后者的数字取决于跑测试的机器，
     *    而这条断言必须在任何 TZ 下都成立（UTC 机器上这两个解析结果相同 ⇒ 那时
     *    "本地解析"与"UTC 解析"恰好一致，本来就无从分辨）。
     */
    const raw = '2026-09-17 11:16:27';
    const asLocal = new Date(raw).getTime();
    const asUtc = Date.parse(`${raw.replace(' ', 'T')}Z`);
    assert.notEqual(
      asLocal,
      asUtc,
      '★ 探针：这台机器上"按本地解析"与"按 UTC 解析"不是同一个时刻 —— 所以"只当文本用"挡住的是真缺陷',
    );
  });

  it('★★ 形状里**只有** id / 名字 / 状态 / 最后更新（延迟与可用率一个字都不读）', () => {
    /*
     * ⚠️★ 2026-09-19 用户删掉的四样东西里有两样在这份响应里**还在**（`ping` 与 `uptimeList`）：
     *    它们不进我们的形状 ⇒ 界面不可能"顺手"再印一个出来，这一层也不为它们写兜底。
     *    这条断言是那件事的守卫 —— 少了它，"把延迟加回来"不会有任何门禁看得见。
     */
    const parsed = parseHeartbeat(HEARTBEAT_FIXTURE);
    assert.ok(parsed);
    assert.deepEqual(
      Object.keys(parsed[0] ?? {}).sort(),
      ['checkedAt', 'id', 'nameKey', 'state'],
      '★★ 一格只有这四件事',
    );
    assert.equal(
      JSON.stringify(parsed).includes('ping'),
      false,
      '★★ 延迟不在解析结果里（用户把它删了）',
    );
    assert.equal(
      JSON.stringify(parsed).includes('uptime'),
      false,
      '★★ 24 小时可用率不在解析结果里（用户把它删了）',
    );
  });

  it('★ 四格的名字与 id 来自那张表（`RANKED_STATUS_COMPONENTS`）—— 表变了这里要跟着变', () => {
    /*
     * ⚠️★ 这张表是这一栏**唯一**一处从网页上抄来的知识（心跳响应里没有名字，
     *    `const.ts` 上写着完整来历）。这条断言把"解析结果里的名字"与"表"绑在一起：
     *    表里改一个名字而夹具没跟上时，这里会红 —— 而**真正**错位（上游换了监视器编号）
     *    是 API 验不出来的，只能靠人去对一次状态页（`pending.md` 里记着这件事）。
     */
    assert.deepEqual(
      RANKED_STATUS_COMPONENTS.map((each) => each.id),
      ['2', '3', '4', '5'],
      '★ 四个监视器 id（文档散文与用户原话的顺序：Game Server / API / Store / Wiki）',
    );
    assert.deepEqual(
      RANKED_STATUS_COMPONENTS.map((each) => each.nameKey),
      [
        'ranked.componentGameServer',
        'ranked.componentApi',
        'ranked.componentStore',
        'ranked.componentWiki',
      ],
      '★ 四个名字的 key（它们**不在**心跳响应里 —— 见那条注释）',
    );
  });
});

/**
 * ★★ `GET /phase-leaderboard` —— 实测那一份响应**整份就是 93 字节**
 * （2026-09-17 原文照抄，只把 `users` 留成空数组：不带 `?predicted=true` 时它就是空的，
 * 而我们**根本不用它** —— 要的是赛段的时间窗口，不是赛段积分榜）。
 * ⚠️ `/leaderboard` 的响应里**没有** phase 对象（实测），所以这一格必须走另一个端点。
 */
const PHASE_FIXTURE = {
  status: 'success',
  data: { phase: { endsAt: 1790726400, number: 1, season: 12 }, users: [] },
};

describe('parsePhase：赛段的号数与截止时间（③ 顶部那并排的一格）', () => {
  it('★ 三格逐格（`endsAt` 是**秒**，与赛季起止同一条单位规矩）', () => {
    assert.deepEqual(parsePhase(PHASE_FIXTURE), {
      number: 1,
      endsAt: 1790726400,
      season: 12,
    });
  });

  it('★★ 缺 phase / phase 不是对象 ⇒ null（**不是**三格全 null 的对象）', () => {
    /*
     * ⚠️★ 这两种情况的区别是**用户下一步做的事**，所以返回值也必须分开：
     *    · `null` ⇒ 容器那一路是辅助请求（`fatal: false`），界面说「赛段信息暂时读不到」；
     *    · "读到了但某一格是空的" ⇒ 那一格印 `—`（或只印另一格）。
     *    合成一种会让"这次请求失败了"与"上游没给这一格"看起来一模一样。
     */
    assert.equal(parsePhase({ status: 'success', data: { users: [] } }), null, '缺 phase');
    assert.equal(
      parsePhase({ status: 'success', data: { phase: 'nope', users: [] } }),
      null,
      'phase 是个字符串',
    );
    assert.equal(
      parsePhase({ status: 'success', data: { phase: [1, 2], users: [] } }),
      null,
      'phase 是数组（`rec()` 排掉数组，理由见它的注释）',
    );
    assert.equal(parsePhase({ status: 'error', data: {} }), null, 'status 不是 success');
    assert.equal(parsePhase(null), null);
  });

  it('★ 三格**各自**可以是 null（文档 schema 里 number / endsAt 就是可空的）', () => {
    const half = parsePhase({
      status: 'success',
      data: { phase: { number: null, endsAt: null, season: 12 }, users: [] },
    });
    assert.deepEqual(half, { number: null, endsAt: null, season: 12 });
    const garbage = parsePhase({
      status: 'success',
      data: { phase: { number: 'x', endsAt: 1790726400, season: 12 }, users: [] },
    });
    assert.deepEqual(
      garbage,
      { number: null, endsAt: 1790726400, season: 12 },
      '★ 坏一格只坏那一格（宽容解析的第②档）—— 截止时间照样给',
    );
  });
});

/**
 * ★★ 用户手输周数那件事的判定（③ 之外的第四处新逻辑）—— 2026-09-19 用户要求
 * "允许用户直接输入对应周的数字跳转"。
 *
 * ⚠️ 这些断言的意义不在"函数算得对"，而在**哪些输入不许发出请求**：
 * 每一个 `ok: false` 都是一次省下来的、拿访客自己 IP 额度换一屏错误的调用。
 */
describe('parseWeekInput：手输的周数（不合法就一个请求都不发）', () => {
  it('★ 合法：1 … latestId，以及 -1（显示成「第 0 周」的那一周）', () => {
    assert.deepEqual(parseWeekInput('103', 103), { ok: true, id: 103 });
    assert.deepEqual(parseWeekInput('1', 103), { ok: true, id: 1 });
    assert.deepEqual(parseWeekInput('-1', 103), { ok: true, id: -1 }, '-1 是真实存在的最早一周');
    assert.deepEqual(parseWeekInput(' 52 ', 103), { ok: true, id: 52 }, '手机键盘带上的空格要认');
  });

  it('★★ 不是整数 ⇒ `not_a_number`（空框 / 字母 / 小数 / 1e3 / +5 / 全角数字）', () => {
    /*
     * ⚠️★ 这一档的每一种都会让上游回 400（`/weekly-race/abc` 甚至不是一条路径），
     *    而发出去只是拿**访客自己**的额度换一屏错误（spec §10 的额度账）。
     *    ⚠️ `1e3` 与 `+5` 刻意**不认**：它们是数，但不是周号 —— 认了就等于替用户猜一个周数。
     *    ⚠️ 全角数字同理：`Number('１２３')` 是 NaN，它属于"打错了"。
     */
    for (const bad of ['', '   ', 'abc', '1.5', '1e3', '+5', '１２３', '10 3', '0x10']) {
      assert.deepEqual(
        parseWeekInput(bad, 103),
        { ok: false, reason: 'not_a_number' },
        `★ ${JSON.stringify(bad)} 不是周数`,
      );
    }
  });

  it('★★ `0` / `≤ -2` / 比最新周还大 ⇒ `no_such_week`（这几档我们**已经知道**答案）', () => {
    /*
     * ⚠️★ `0` 是最要紧的一条：上游把 0 当**"本周"的别名**（请求 `/weekly-race/0` 拿到的是
     *    当前那一周）⇒ 放它发出去就会得到"URL 写着 0、屏幕上是第 103 周"那个画面，
     *    而它**没有任何门禁**看得见（每一格都合法、每个数都是真的）。
     * ⚠️ `-2/-3` 实测全是 400（`-1` 是唯一的负周）。
     * ⚠️ `> latestId` 是"未来的周"：**我们已经知道**它不存在，没有理由再去问一次。
     */
    assert.deepEqual(parseWeekInput('0', 103), { ok: false, reason: 'no_such_week' }, '0 是别名');
    assert.deepEqual(parseWeekInput('00', 103), { ok: false, reason: 'no_such_week' });
    assert.deepEqual(parseWeekInput('-2', 103), { ok: false, reason: 'no_such_week' });
    assert.deepEqual(parseWeekInput('104', 103), { ok: false, reason: 'no_such_week' });
    /*
     * ⚠️ 超长的数字：`Number('99999999999999999999')` 是 1e20（**不是**安全整数），
     *    拼进路径会得到 `/weekly-race/1e+20` —— 那是把"打错了"变成一次真实的垃圾请求。
     */
    assert.deepEqual(parseWeekInput('99999999999999999999', 103), {
      ok: false,
      reason: 'no_such_week',
    });
  });

  it('★ 还不知道最新周号（`latestId === null`）时**不猜**：比 103 大的数照发', () => {
    /*
     * ⚠️★ 这一条是"不编事实"的落点：上游每周都会加一周，猜一个上限会把一个**真的存在**
     *    的新周挡在门外，而用户读到的是「没有这一周。」—— 一句我们编出来的假话。
     *    ⇒ 那时只有三种**确定的**不存在会被本地挡掉（0、≤ -2、非整数），
     *    其余交给上游：它回 400，界面走**已有的** `not_found` 那一档说同一句话。
     *    ⚠️ 实际走到这一支的窗口很窄（周赛面板渲染时 latestId 通常已经到了）。
     */
    assert.deepEqual(parseWeekInput('104', null), { ok: true, id: 104 });
    assert.deepEqual(parseWeekInput('0', null), { ok: false, reason: 'no_such_week' });
    assert.deepEqual(parseWeekInput('-2', null), { ok: false, reason: 'no_such_week' });
    assert.deepEqual(parseWeekInput('abc', null), { ok: false, reason: 'not_a_number' });
  });

  it('★ 判出来的 id 能拼成一条真路径（`weekPath`）—— 两者是配套的', () => {
    const verdict = parseWeekInput('52', 103);
    assert.ok(verdict.ok);
    assert.equal(weekPath(verdict.id), '/ranked/weekly/52');
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
 * 跨**七条**解析函数的判据（spec §11.2 第 1 条）
 * ------------------------------------------------------------------------- */

describe('解析是纯函数（spec §11.2 第一条）', () => {
  it('★ 同一份响应解析两次，结果逐字段相同', () => {
    // ⚠️ 先钉"真的解析出了东西"：几个入口都返回 null 的话，下面那几条 deepEqual 是**空过**的。
    assert.ok(parseLive(LIVE_FIXTURE), '这个夹具必须解析得出来');
    assert.ok(parseLeaderboard(LEADERBOARD_FIXTURE), '这个夹具必须解析得出来');
    assert.ok(parseWeekly(WEEKLY_FIXTURE), '这个夹具必须解析得出来');
    assert.ok(parseHeartbeat(HEARTBEAT_FIXTURE), '这个夹具必须解析得出来');
    assert.ok(parsePhase(PHASE_FIXTURE), '这个夹具必须解析得出来');
    assert.ok(parseMatches(MATCHES_FIXTURE), '这个夹具必须解析得出来');
    assert.ok(parsePlayerDetail(PLAYER_DETAIL_FIXTURE), '这个夹具必须解析得出来');

    assert.deepEqual(parseLive(LIVE_FIXTURE), parseLive(LIVE_FIXTURE));
    assert.deepEqual(parseLeaderboard(LEADERBOARD_FIXTURE), parseLeaderboard(LEADERBOARD_FIXTURE));
    assert.deepEqual(parseWeekly(WEEKLY_FIXTURE), parseWeekly(WEEKLY_FIXTURE));
    assert.deepEqual(parseHeartbeat(HEARTBEAT_FIXTURE), parseHeartbeat(HEARTBEAT_FIXTURE));
    assert.deepEqual(parsePhase(PHASE_FIXTURE), parsePhase(PHASE_FIXTURE));
    assert.deepEqual(parseMatches(MATCHES_FIXTURE), parseMatches(MATCHES_FIXTURE));
    assert.deepEqual(
      parsePlayerDetail(PLAYER_DETAIL_FIXTURE),
      parsePlayerDetail(PLAYER_DETAIL_FIXTURE),
    );
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

    // 另外几个入口同一类缺陷，一起钉：克隆在前、解析在后，逐个比对。
    const lbBefore = structuredClone(LEADERBOARD_FIXTURE);
    const weekBefore = structuredClone(WEEKLY_FIXTURE);
    const beatBefore = structuredClone(HEARTBEAT_FIXTURE);
    const phaseBefore = structuredClone(PHASE_FIXTURE);
    const matchesBefore = structuredClone(MATCHES_FIXTURE);
    const detailBefore = structuredClone(PLAYER_DETAIL_FIXTURE);
    parseLeaderboard(LEADERBOARD_FIXTURE);
    parseWeekly(WEEKLY_FIXTURE);
    parseHeartbeat(HEARTBEAT_FIXTURE);
    parsePhase(PHASE_FIXTURE);
    parseMatches(MATCHES_FIXTURE);
    parsePlayerDetail(PLAYER_DETAIL_FIXTURE);
    assert.deepEqual(LEADERBOARD_FIXTURE, lbBefore, '排行榜那份原始响应必须一字未改');
    assert.deepEqual(WEEKLY_FIXTURE, weekBefore, '周赛那份原始响应必须一字未改');
    assert.deepEqual(HEARTBEAT_FIXTURE, beatBefore, '心跳那份原始响应必须一字未改');
    assert.deepEqual(PHASE_FIXTURE, phaseBefore, '赛段那份原始响应必须一字未改');
    assert.deepEqual(
      MATCHES_FIXTURE,
      matchesBefore,
      '★★ 比赛列表那份原始响应必须一字未改（`seed.endTowers: null` 也在里面）',
    );
    assert.deepEqual(PLAYER_DETAIL_FIXTURE, detailBefore, '玩家详情那份原始响应必须一字未改');
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

/* ===========================================================================
 * ★★ Round 3（2026-09-17）：行内展开 —— 一位玩家的最近比赛 + 他的汇总
 * ===========================================================================
 * 用户 2026-09-19：「点开后能查看最近比赛的情况/数据等」⇒ 展开要读两份响应。
 * 这一节的两组夹具都是**实测**的（findings §2.1 / §2.2 / §3.1 / §3.2），
 * 逐字段都有出处；唯一**造**出来的那一行在它自己的注释里点名了（平局那行）。
 * ========================================================================= */

/**
 * `/users/edcr/matches?count=100` 的第一行 —— findings §2.1 **逐字**（私人房 type 3）。
 *
 * ⚠️★ 它同时是三条红线的载体，改这个夹具前先读它们：
 *   · `changes: []` —— 32/32 行私人房都是空数组 ⇒ 那一场的 elo 变化是**读不到**，不是 0；
 *   · `seed.endTowers: null` —— 文档说"未过滤的种子是空数组"，**实测是 `null`**
 *     （findings 冲突 C1）⇒ 谁在解析里对任何 seed 字段调 `.length` / `.map`，这一行会当场炸；
 *   · `players[].eloRate: 2349` —— 这是**请求那一刻**的 elo，不是这一场当时的
 *     （下一行的 `changes[].eloRate: 2342` 才是赛后值，而它俩不一样正是判据）。
 */
const MATCH_PRIVATE = {
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

/**
 * 一场**排位**（type 2，edcr vs Voxio，match `13279218`）—— 字段逐个来自 findings §2.1/§2.2。
 *
 * ⚠️★ 这场比赛是"现值 vs 当时值"那条红线的证据本身（findings §2.1 底部第一颗子弹）：
 *    `players[edcr].eloRate = 2349` 与 `GET /users/edcr` **今天**回的是同一个数
 *    （= 现值），而 `changes[edcr].eloRate = 2342` 才是**赛后**值。
 *    ⇒ 界面要显示"这一场涨了 7 分"就只能用 `changes[]`；
 *      而 `date`（2026-09-11）与 `players[].eloRate`（今天）**不是同一时刻**的数。
 */
const MATCH_RANKED = {
  id: 13279218,
  type: 2,
  seed: {
    id: 'mtf2yoaiujmokqvb',
    overworld: 'BURIED_TREASURE',
    nether: 'STABLES',
    endTowers: [94],
    variations: ['biome:structure:deep_cold_ocean'],
  },
  category: 'ANY',
  gameMode: 'default',
  players: [
    {
      uuid: '817a3f2e92da42ab89c64a787ce16d28',
      nickname: 'Voxio',
      roleType: 1,
      eloRate: 1757,
      eloRank: 86,
      country: 'fr',
    },
    {
      uuid: '635f35ee69ed4f0c94ff26ece4818956',
      nickname: 'edcr',
      roleType: 1,
      eloRate: 2349,
      eloRank: 1,
      country: 'gb',
    },
  ],
  result: { uuid: '635f35ee69ed4f0c94ff26ece4818956', time: 597266 },
  forfeited: false,
  vod: [
    {
      uuid: '817a3f2e92da42ab89c64a787ce16d28',
      url: 'https://www.twitch.tv/videos/2871547177',
      startsAt: 1789159348,
    },
  ],
  changes: [{ uuid: '635f35ee69ed4f0c94ff26ece4818956', change: 7, eloRate: 2342 }],
  season: 12,
  date: 1789169286,
  seedType: 'BURIED_TREASURE',
  bastionType: 'STABLES',
};

/**
 * ★ **平局**那一行 —— 这一行是我们**造的**，造的只有两格，都是实测的事实。
 *
 * findings §2.1：`result.uuid` 在 100 行里有 **3 行是 `null`**（ids `13304036` / `13303161` /
 * `13163525`），而 `result.time` 从来没有 null 过。那三行的原始 body 没有被单独存下来，
 * 所以这里取第一行的形状 + `id` 换成其中一个、`result.uuid` 换成 `null`，
 * **其余一个字节不改**（它只用来钉 `matchOutcome` 的 `'draw'` 那一支，
 * 以及"平局不是把结果折成 null"这件事）。
 */
const MATCH_DRAW = {
  ...MATCH_PRIVATE,
  id: 13304036,
  result: { uuid: null, time: MATCH_PRIVATE.result.time },
};

/** `parseMatches` 的那一份响应：三行（私人房 / 排位 / 平局）。 */
const MATCHES_FIXTURE = { status: 'success', data: [MATCH_PRIVATE, MATCH_RANKED, MATCH_DRAW] };

/**
 * 夹具里的第 `index` 场（0 = 私人房 / 1 = 排位 / 2 = 平局）。
 *
 * ⚠️ 为什么要有这个助手：`noUncheckedIndexedAccess` 让下标访问一律带上 `| undefined`
 *    （本仓 tsconfig 就是这么开的）⇒ 直接下标访问会把 `RankedMatch | undefined`
 *    传进下面那些纯函数，而那是**编译错误**。这里取不到就当场红（而不是 `as` 硬转 ——
 *    硬转会让"夹具空了"变成一个更难读的运行时错）。
 */
function matchAt(index: number): RankedMatch {
  const match = parseMatches(MATCHES_FIXTURE)?.[index];
  assert.ok(match, `夹具里必须有第 ${index} 场`);
  return match;
}

/** 一份**临时拼的**夹具里的第一场（取不到就当场红，理由同上）。 */
function firstMatchOf(raw: unknown): RankedMatch {
  const match = parseMatches(raw)?.[0];
  assert.ok(match, '这个临时夹具必须解析得出来');
  return match;
}

/**
 * `GET /users/edcr` —— findings §3.1/§3.2 的实测值（2026-09-17）。
 *
 * ⚠️ `statistics` 只抄了我们要读的四格，但每一格的**两个格子都留着**（`{ranked, casual}`）：
 *    "取哪一个"正是判据本身 —— 取 `casual` 的实现在 `loses` 上会拿到 `1`（total 那一块）
 *    而不是 `1809`，而那个数看起来完全正常。
 * ⚠️★ `seasonResult` 照**实测**抄（账本 `ranked-round4/progress.md` 的读数）：
 *    `last.phasePoint` 实测就是 **0**（不是缺），所以夹具里也必须是 0 ——
 *    "0 与 null 必须分开"这条如果夹具里没有 0，就永远验不到。
 */
const PLAYER_DETAIL_FIXTURE = {
  status: 'success',
  data: {
    uuid: '635f35ee69ed4f0c94ff26ece4818956',
    nickname: 'edcr',
    roleType: 1,
    eloRate: 2349,
    eloRank: 1,
    country: 'gb',
    seasonResult: {
      last: { eloRate: 2349, eloRank: 1, phasePoint: 0, percentile: 0 },
      highest: 2385,
      lowest: 1670,
      phases: [],
    },
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

const SELF_UUID = '635f35ee69ed4f0c94ff26ece4818956';
/** 私人房那一行（`MATCH_PRIVATE` = match `13304815`）的对手：lauveer。 */
const PRIVATE_RIVAL_UUID = '410e5776b03a424d8740557bac2d9014';
/** 排位那一行（`MATCH_RANKED` = match `13279218`）的对手：Voxio。 */
const RANKED_RIVAL_UUID = '817a3f2e92da42ab89c64a787ce16d28';

describe('parseMatches：三行 / 行级丢弃 / 整份不成形状', () => {
  it('★ 正常：三行都读得出来，逐格照抄（时间单位也在判据里）', () => {
    const matches = parseMatches(MATCHES_FIXTURE);
    assert.ok(matches);
    assert.equal(matches.length, 3);
    const [first] = matches;
    assert.equal(first?.id, 13304815);
    assert.equal(first?.type, 3);
    assert.equal(first?.season, 12);
    /*
     * ⚠️★ `date` 是**秒**（上游的 `Date` 一律是秒）：`1789242779 × 1000` = 2026-09-13 那次实测
     *    能对上的时刻。按毫秒解释会得到 1970 年 —— 而界面上只是一个"很旧的日期"。
     */
    assert.equal(first?.date, 1789242779);
    /*
     * ⚠️ `result.time` 是**毫秒**（同一个响应里两种单位并存，这就是那条规矩存在的理由）：
     *    515686 ms = 8:35.686。
     */
    assert.equal(first?.result.time, 515686);
    assert.equal(matches[0]?.result.uuid, SELF_UUID);
    // 私人房的两格文案字段：实测是 null（那时整个 seed 都是空的）
    assert.equal(first?.seedType, null);
    assert.equal(first?.bastionType, null);
    // 排位那一场有 seedType / bastionType（与 seed.overworld / .nether 同值）
    assert.equal(matches[1]?.seedType, 'BURIED_TREASURE');
    assert.equal(matches[1]?.bastionType, 'STABLES');
    assert.equal(matches[1]?.vod.length, 1);
    assert.equal(matches[1]?.vod[0]?.startsAt, 1789159348, '★ `vod[].startsAt` 也是**秒**');
  });

  it('★★ `changes: []` 保留成空数组（不折成 null）—— "这一场读不到"与"没变化"是两句话', () => {
    const matches = parseMatches(MATCHES_FIXTURE);
    assert.deepEqual(matches?.[0]?.changes, [], '私人房：空数组');
    assert.deepEqual(
      matches?.[1]?.changes,
      [{ uuid: SELF_UUID, change: 7, eloRate: 2342 }],
      '排位：有那一条记录（`eloRate` 是**赛后**值）',
    );
    assert.deepEqual(matches?.[2]?.changes, [], '平局那一行照第一行（空数组）');
  });

  it('★★ `players[].eloRate` 是**现值**、`changes[].eloRate` 是**赛后**值（两者不是同一个数）', () => {
    /*
     * ⚠️★ 这一条是那条红线的判据（findings §2.1 底部）：同一场比赛里
     *    `players[edcr].eloRate` 是 2349（**今天**的值）而 `changes[edcr].eloRate` 是 2342（赛后）。
     *    把前者当成"当时的 elo"渲染，就会出现"当时 2349、赛后 2342、变化 +7"这种
     *    **自相矛盾但看不出来**的格子（三个数都是真的，只是其中一个不属于那一刻）。
     *    解析层能做的是**不改名、不加算**：这两个数各自留着自己的出处。
     */
    const matches = parseMatches(MATCHES_FIXTURE);
    const ranked = matches?.[1];
    assert.equal(ranked?.players[1]?.eloRate, 2349, '★ 玩家块 = **现在**的值');
    assert.equal(ranked?.changes[0]?.eloRate, 2342, '★ 变化块 = **赛后**的值');
    assert.notEqual(
      ranked?.players[1]?.eloRate,
      ranked?.changes[0]?.eloRate,
      '★ 探针：这一场比赛里两个数确实不同（否则上面两条是空跑）',
    );
  });

  it('★★ `result.uuid: null` 照抄成 null（平局是上游的写法，不是我们的兜底）', () => {
    const matches = parseMatches(MATCHES_FIXTURE);
    assert.equal(matches?.[2]?.result.uuid, null);
  });

  it('★★ 坏行被丢掉、好行照旧（`id` 不是有限数字的行没有身份）', () => {
    /*
     * ⚠️ 丢掉的理由：没有 id 的行**没有身份** —— 它是展开那几场比赛的 React key
     *    （`RankedDetailBody` 里 `key={match.id}`），而"第几行"是我们**编**出来的编号
     *    （编出来的 key 在"上游删掉一场"时会整体错位一格）。
     *    ⚠️ 早先这里写的是"展开会去打 `/matches/NaN`"—— **那句话是错的**：全仓没有任何地方
     *    请求 `/matches/{id}`（`grep` 过，`rankedDirect.ts` 只有 `/users/…` 那几条路径）
     *    ⇒ 真实的代价是**身份**（React key / 任何按比赛去重的算法），不是一次坏请求。
     * ⚠️ 代价：这几行在界面上**消失**（不是整份"读不到"，也不是一个假数字）——
     *    所以界面上那句「最近 N 场」要读**返回值**的长度，不是读请求里的 `count`。
     */
    const withBadRows = {
      status: 'success',
      data: [
        { ...MATCH_PRIVATE, id: '13304815' },
        MATCH_PRIVATE,
        { ...MATCH_PRIVATE, id: null },
        { ...MATCH_RANKED, id: Number.NaN },
        MATCH_DRAW,
      ],
    };
    const matches = parseMatches(withBadRows);
    assert.ok(matches);
    assert.deepEqual(
      matches.map((m) => m.id),
      [13304815, 13304036],
      '★★ 三行没有身份的被丢掉，两行好的**照旧**（顺序也没变）',
    );
  });

  it('★★ `players` 是空数组 ⇒ 丢掉那一行（"这一场没有人"不是一场比赛）', () => {
    const matches = parseMatches({
      status: 'success',
      data: [{ ...MATCH_PRIVATE, players: [] }, MATCH_RANKED],
    });
    assert.deepEqual(
      matches?.map((m) => m.id),
      [13279218],
    );
  });

  it('★★ 缺 `result` 的一行**丢掉**（否则"读不到结果"会变成"平局"）', () => {
    /*
     * ⚠️★ 这一条守的是 `RankedMatch.result` 那个 `uuid: null` 的**含义**：
     *    我们的形状只有一种写法能表达"上游说平局"，而"这一行根本没有 result"
     *    是另一件事（我们不知道谁赢了）。让它落进 `uuid: null` 就是把"不知道"印成"平局"，
     *    而平局在界面上是一个看起来完全正常的结果。
     */
    const withoutResult: Record<string, unknown> = { ...MATCH_PRIVATE };
    delete withoutResult.result;
    const matches = parseMatches({ status: 'success', data: [withoutResult, MATCH_PRIVATE] });
    assert.deepEqual(
      matches?.map((m) => m.id),
      [13304815],
      '★★ 缺 result 的丢掉、好的照旧 —— 而且它**不会**变成一行平局',
    );
  });

  it('★ 整份不成形状 ⇒ null（三条判据）', () => {
    assert.equal(parseMatches({ status: 'error', data: [] }), null, 'status 不是 success');
    /*
     * ⚠️★ `data` 不是数组 ⇒ 整份 null。这一条同时钉住了"这个端点**不能**走 `envelope()`"：
     *    那一支用 `rec(data)` 读它，而数组会被 `rec` 判成"不是对象" ⇒ 好数据变 null。
     */
    assert.equal(parseMatches({ status: 'success', data: { matches: [] } }), null);
    assert.equal(parseMatches(null), null);
    assert.equal(parseMatches('<html>'), null);
  });

  it('★ 空数组是**一份好数据**（上游对空结果是 200 + `data: []`），不是 null', () => {
    assert.deepEqual(parseMatches({ status: 'success', data: [] }), []);
  });

  it('★ 一格坏只坏那一格（玩家 elo 是文本 / vod 地址不是 http）', () => {
    /*
     * 宽容解析的第②档：`eloRate` 在类型里可空 ⇒ 那一格是 null，整行照旧；
     * `vod[].url` 要进界面的 `href` ⇒ 只认 http(s)（`javascript:` 是被丢掉的那一条，
     * 与 `embed.ts` 的 `rankedLiveChannel` 同一条规矩），而**那一行还在**。
     */
    const messy = parseMatches({
      status: 'success',
      data: [
        {
          ...MATCH_PRIVATE,
          players: [
            { ...MATCH_PRIVATE.players[0], eloRate: '2349' },
            { ...MATCH_PRIVATE.players[1], eloRank: null },
          ],
          vod: [
            { uuid: 'x', url: 'javascript:alert(1)', startsAt: 1 },
            { uuid: 'y', url: '', startsAt: 1 },
            { uuid: 'z', url: 'https://example.invalid/v/1', startsAt: 1 },
          ],
        },
      ],
    });
    assert.equal(messy?.length, 1, '★ 这几格坏了**不丢行**');
    assert.equal(messy?.[0]?.players[0]?.eloRate, null, '★ 文本不是数 ⇒ null（不是 0）');
    assert.equal(messy?.[0]?.players[0]?.nickname, 'edcr', '★ 同一行别的格照旧');
    assert.deepEqual(
      messy?.[0]?.vod.map((v) => v.uuid),
      ['z'],
      '★★ 只留下 http(s) 的那一条（伪协议与空串都不进 href），而那**一行**还在',
    );
  });

  it('★ `seed.endTowers: null`（文档说反了的那一格）不影响解析', () => {
    /*
     * ⚠️ findings 冲突 C1：文档说"未过滤的种子这里是空数组"，**实测是 `null`**。
     *    这一层一个 seed 字段都不读 ⇒ 这条夹具（`null`）与那条（`[94]`）都能过。
     *    谁哪天顺手加一句 `seed.endTowers.length`，这一条会**当场抛错**（不是静默）。
     */
    const matches = parseMatches({
      status: 'success',
      data: [
        { ...MATCH_PRIVATE, seed: { id: null, overworld: null, nether: null, endTowers: null } },
        MATCH_RANKED,
      ],
    });
    assert.equal(matches?.length, 2);
  });
});

describe('parsePlayerDetail：五格 / 一格坏 / 整份不成形状', () => {
  it('★ 正常：身份与 elo 三格逐格（`nickname` 取响应里的规范写法）', () => {
    const detail = parsePlayerDetail(PLAYER_DETAIL_FIXTURE);
    assert.ok(detail);
    assert.equal(detail.uuid, SELF_UUID);
    assert.equal(detail.nickname, 'edcr');
    assert.equal(detail.eloRate, 2349);
    assert.equal(detail.eloRank, 1);
  });

  /*
   * ★★ 搜索到的玩家是**榜上的一行**（2026-09-19 第四轮）⇒ 那五列里有两列的数据
   *    必须来自这一份详情：`highest` 与 `last.phasePoint`。
   * ⚠️★ 这两格的期望值写**字面量**（2385 / 0）：从夹具现算的话，"印的是同一个数"
   *    就成了同义反复（夹具改了而实现没跟上时，两边会一起变）。
   * ⚠️★ 第三刀是非空断言：`0` 与 `null` 必须分开 —— 实现里写 `?? null` 之类的
   *    "顺手归一"时，`0` 会变成 `null`，而界面上只是一个小小的「—」。
   */
  it('★★ 第四、第五列那两格：`seasonHighest` 与 `seasonPhasePoint`（0 是**真的值**）', () => {
    const detail = parsePlayerDetail(PLAYER_DETAIL_FIXTURE);
    assert.ok(detail);
    assert.equal(detail.seasonHighest, 2385, '★ 最高那一列读的是 `seasonResult.highest`');
    assert.equal(
      detail.seasonPhasePoint,
      0,
      '★★ 阶段分那一列读的是 `seasonResult.last.phasePoint`，实测就是 0 —— **不许折成 null**',
    );
    assert.notEqual(
      detail.seasonPhasePoint,
      null,
      '★★ 探针方向的另一刀：0 不是"读不到"（把 0 折成 null 的实现过不了上面那条，也过不了这条）',
    );
  });

  it('★★ 两格各自可空：`last` 缺省 ⇒ 阶段分 null，而**最高那一格照旧**', () => {
    /*
     * ⚠️ 判据是**逐格**的（与 `parseEloEntry` 那三格同一条）：上游少了 `last` 时，
     *    `highest` 还在，那时把整块判成"读不到"会让排行榜那一行少印一个真数。
     */
    const noLast = parsePlayerDetail({
      ...PLAYER_DETAIL_FIXTURE,
      data: {
        ...PLAYER_DETAIL_FIXTURE.data,
        seasonResult: { highest: 2385, lowest: 1670, phases: [] },
      },
    });
    assert.ok(noLast);
    assert.equal(noLast.seasonPhasePoint, null, '★ `last` 不在 ⇒ null（不是 0）');
    assert.equal(noLast.seasonHighest, 2385, '★ 同一块里的 `highest` 不受影响');
  });

  it('★ 整块 `seasonResult` 缺省 ⇒ 两格都是 null（详情**照样成立**）', () => {
    /*
     * ⚠️ 它不是整份的骨架（骨架是 uuid + nickname）：缺了这一块时，
     *    这一行的 elo / 排名 / 战绩照旧，只有这两列印「—」。
     */
    const noSeason = parsePlayerDetail({
      status: 'success',
      data: {
        uuid: SELF_UUID,
        nickname: 'edcr',
        eloRate: 2349,
        eloRank: 1,
        statistics: PLAYER_DETAIL_FIXTURE.data.statistics,
      },
    });
    assert.ok(noSeason, '★ 缺 `seasonResult` **不是**整份失败');
    assert.equal(noSeason.seasonHighest, null);
    assert.equal(noSeason.seasonPhasePoint, null);
    assert.equal(noSeason.season.wins, 96, '★ 同一份里的战绩照旧');
  });

  it('★★ 战绩取的是 `ranked` 那一半，**不是** `casual`（两个格子都在夹具里）', () => {
    /*
     * ⚠️★ 上游每个叶子都是 `{ranked, casual}`，而这一栏是 **ranked** 排位榜的展开。
     *    取错那一半的两个数都"看起来正常"：`total.loses` 会是 1（casual）而不是 1809，
     *    `total.playedMatches` 会是 2 而不是 5357 —— 没有任何门禁看得见。
     */
    const detail = parsePlayerDetail(PLAYER_DETAIL_FIXTURE);
    assert.deepEqual(detail?.season, {
      wins: 96,
      loses: 14,
      playedMatches: 110,
      bestTimeMs: 387772,
    });
    assert.deepEqual(detail?.total, {
      wins: 3448,
      loses: 1809,
      playedMatches: 5357,
      bestTimeMs: 353371,
    });
    assert.notEqual(
      detail?.total.loses,
      (PLAYER_DETAIL_FIXTURE.data.statistics.total.loses as { casual: number }).casual,
      '★ 探针：这一格里两个数确实不同（否则上面那条是空跑）',
    );
  });

  it('★ 未定级玩家：`eloRate` / `eloRank` 是 null，而**详情照样成立**', () => {
    /*
     * ⚠️ 未定级是**真实状态**（实测 `/users/inoutoftherain` 两格都是 null），不是坏数据 ⇒
     *    它不是整份的骨架（骨架是 uuid + nickname）⇒ 界面上印「—」，别的格照旧。
     */
    const unplaced = parsePlayerDetail({
      ...PLAYER_DETAIL_FIXTURE,
      data: { ...PLAYER_DETAIL_FIXTURE.data, eloRate: null, eloRank: null },
    });
    assert.ok(unplaced);
    assert.equal(unplaced.eloRate, null);
    assert.equal(unplaced.eloRank, null);
    assert.equal(unplaced.season.wins, 96, '★ 同一份里的战绩照旧');
  });

  it('★ 一格坏只坏那一格：没有 `statistics` ⇒ 两份战绩四格全 null（详情还在）', () => {
    const noStats = parsePlayerDetail({
      status: 'success',
      data: { uuid: SELF_UUID, nickname: 'edcr', eloRate: 2349, eloRank: 1 },
    });
    assert.ok(noStats, '★ 缺 statistics **不是**整份失败');
    assert.deepEqual(noStats.season, {
      wins: null,
      loses: null,
      playedMatches: null,
      bestTimeMs: null,
    });
    assert.deepEqual(noStats.total, {
      wins: null,
      loses: null,
      playedMatches: null,
      bestTimeMs: null,
    });
  });

  it('★ 缺一格的战绩：`wins` 读得出、`loses` 读不出 ⇒ 只有那一格是 null', () => {
    const partial = parsePlayerDetail({
      status: 'success',
      data: {
        uuid: SELF_UUID,
        nickname: 'edcr',
        statistics: { season: { wins: { ranked: 96 }, loses: { casual: 3 } } },
      },
    });
    assert.equal(partial?.season.wins, 96);
    assert.equal(
      partial?.season.loses,
      null,
      '★ `loses.ranked` 不在 ⇒ null（**不是** 0，也不是 casual 的 3）',
    );
    assert.equal(partial?.season.playedMatches, null);
  });

  it('★ 整份不成形状 ⇒ null（四条判据，骨架是 uuid + nickname）', () => {
    assert.equal(parsePlayerDetail({ status: 'error', data: {} }), null, 'status 不是 success');
    assert.equal(parsePlayerDetail({ status: 'success' }), null, '缺 data');
    assert.equal(
      parsePlayerDetail({ status: 'success', data: { nickname: 'edcr' } }),
      null,
      '缺 uuid（没有身份的一份响应归属不到任何一行）',
    );
    assert.equal(
      parsePlayerDetail({ status: 'success', data: { uuid: SELF_UUID } }),
      null,
      '缺 nickname',
    );
  });
});

describe('④ 之外：行内展开的四个纯函数', () => {
  /** 排行榜用的那份夹具的简写（`RankedEloEntry` 只有五格）。 */
  const board = [
    { rank: 1, nickname: 'edcr', eloRate: 2349, highest: 2385, phasePoint: 0 },
    { rank: 3, nickname: 'Voxio', eloRate: 1757, highest: 1800, phasePoint: 10 },
    { rank: 3, nickname: 'lowk3y_', eloRate: 1757, highest: 1760, phasePoint: 10 },
    { rank: 9, nickname: null, eloRate: null, highest: null, phasePoint: null },
  ];

  it('★★ `filterEloUsers`：子串、忽略大小写', () => {
    assert.deepEqual(
      filterEloUsers(board, 'vox').map((u) => u.nickname),
      ['Voxio'],
      '★ 小写查大写',
    );
    assert.deepEqual(
      filterEloUsers(board, 'VOX').map((u) => u.nickname),
      ['Voxio'],
      '★ 大写查大写',
    );
    assert.deepEqual(
      filterEloUsers(board, 'k3y').map((u) => u.nickname),
      ['lowk3y_'],
      '★ 子串（不是前缀、不是精确）',
    );
  });

  it('★★ 空白 / 空串 ⇒ **不筛**（原样返回，内容与顺序都不动）', () => {
    /*
     * ⚠️ 连 `trim()` 都不做的实现会让"只打了个空格"变成"一个人都没有"——
     *    而输入框里那一眼看上去就是空的（用户只会以为榜单坏了）。
     */
    assert.deepEqual(filterEloUsers(board, ''), board);
    assert.deepEqual(filterEloUsers(board, '   '), board);
    assert.equal(filterEloUsers(board, '\t\n').length, board.length);
  });

  it('★★ **不重排**：筛出来的行保持上游顺序（排名列就是上游给的那个数）', () => {
    /*
     * ⚠️★ 榜单的顺序是上游按 `eloRank` 排的，而"第几名"那一列就是上游的数
     *    （并列会重复、之后跳号）。重排（比如把命中的排到前面）会让行序与排名列对不上，
     *    而那看起来像是**上游的排名有问题** —— 没人会怀疑搜索框。
     * ⚠️ 这条夹具里两行的 `rank` 都是 3（并列），所以"按 rank 再排一次"也看不出来 ——
     *    判据是"与入参顺序逐项相同"，它对任何重排都免疫。
     */
    const hit = filterEloUsers(board, 'o'); // Voxio / lowk3y_ 都命中，且它们的 rank 相同
    assert.deepEqual(
      hit.map((u) => u.nickname),
      ['Voxio', 'lowk3y_'],
      '★★ 顺序照入参（Voxio 在前），不是按 rank 或字母序重排',
    );
  });

  it('★ 昵称是 null 的行**匹配不上**任何非空查询（不是"空昵称匹配一切"）', () => {
    assert.deepEqual(filterEloUsers(board, 'z'), []);
    assert.equal(
      filterEloUsers(board, 'edcr').some((u) => u.nickname === null),
      false,
    );
  });

  it('★ 不改入参、两个分支都回**新数组**', () => {
    /*
     * ⚠️ 与文件头那条规矩同源：调用方那份 `users` 要留给"上次刷新失败了，下面是旧数据"用。
     *    交出同一个引用等于把两份数据绑在一起（谁往后 `sort` 一下都会改到原始那 150 行）。
     */
    const before = structuredClone(board);
    const all = filterEloUsers(board, '');
    const some = filterEloUsers(board, 'edcr');
    assert.notEqual(all, board, '★ 不筛时也是**新数组**（文件头：一律 `[...]` / `slice`）');
    assert.notEqual(some, board);
    assert.deepEqual(board, before, '★★ 入参一个字节都没动');
  });

  it('★★ `opponentOf`：他不在这一场里 ⇒ null（**不许**把陌生人当成对手）', () => {
    const ranked = matchAt(1);
    assert.equal(opponentOf(ranked, SELF_UUID)?.nickname, 'Voxio', '★ 另一个人');
    assert.equal(opponentOf(ranked, RANKED_RIVAL_UUID)?.nickname, 'edcr', '★ 反过来也成立');
    assert.equal(
      opponentOf(matchAt(0), SELF_UUID)?.nickname,
      'lauveer',
      '★ 私人房那一行（另一份夹具）同样对得上',
    );
    /*
     * ⚠️★ 这一条是"判据先看他在不在场"的落点：他不在 `players[]` 里时，
     *    "uuid 不等于 self 的那一个"会把 `players[0]` 当成他的对手 ——
     *    一个**陌生人**被印成他的对手，而那个名字看起来完全正常。
     */
    assert.equal(opponentOf(ranked, 'nobody-in-this-match'), null, '★★ 他不在这一场里 ⇒ null');
    // ⚠️ 探针：那份夹具里两个 uuid 确实都不是"他"（否则上面那条是空跑）
    assert.notEqual(PRIVATE_RIVAL_UUID, RANKED_RIVAL_UUID);
  });

  it('★ `opponentOf`：只有他自己（1 人的行）⇒ null（没有对手）', () => {
    const solo = firstMatchOf({
      status: 'success',
      data: [{ ...MATCH_PRIVATE, players: [MATCH_PRIVATE.players[0]] }],
    });
    assert.equal(opponentOf(solo, SELF_UUID), null);
  });

  it('★★ `matchOutcome`：赢 / 输 / 平局 / 读不到（四档都要有）', () => {
    const [priv, ranked, draw] = [matchAt(0), matchAt(1), matchAt(2)];
    assert.equal(matchOutcome(ranked, SELF_UUID), 'win', '★ `result.uuid` 是他自己');
    assert.equal(matchOutcome(ranked, RANKED_RIVAL_UUID), 'loss', '★ 对手视角');
    assert.equal(matchOutcome(draw, SELF_UUID), 'draw', '★ `result.uuid === null` 是平局');
    assert.equal(matchOutcome(priv, 'nobody-in-this-match'), 'unknown', '★ 他不在这一场里');
  });

  it('★★ 判据顺序：他不在场**且**结果是 null ⇒ `unknown`（不是"平局"）', () => {
    /*
     * ⚠️★ 这一条是两个顺序唯一分得开的地方（自己裁决的那一条）：
     *    先看 `result.uuid` 的实现会在这里回 `'draw'` —— 也就是把
     *    "这个人与这一行对不上"说成"他打平了"。而"他打平了"是一件我们**并不知道**的事，
     *    它还会直接改掉用户对这位玩家水平的判断（平局在战绩里看起来完全正常）。
     */
    const draw = matchAt(2);
    assert.equal(draw.result.uuid, null, '★ 夹具确实是"结果是 null"的那一行');
    assert.equal(
      matchOutcome(draw, 'nobody-in-this-match'),
      'unknown',
      '★★ 人不在场 ⇒ unknown（先问在场，再看结果）',
    );
  });

  it('★ `eloChangeOf`：有他的记录 ⇒ 那个数（赛后 +7）', () => {
    assert.equal(eloChangeOf(matchAt(1), SELF_UUID), 7);
  });

  it('★★ `eloChangeOf`：私人房（`changes: []`）⇒ `null`（**不是 0**）', () => {
    /*
     * ⚠️★ 私人房的 `changes[]` 实测**恒为空数组**（32/32 行，findings §2.1）：
     *    这里回 0 的话，界面上会出现"这一场 +0"—— 一个**看起来完全正常**的结论，
     *    而真相是"私人房根本不上报 elo 变化"（我们读不到那一格）。
     *    ⇒ 这一条与下一条是本轮"绝不为缺失值填 0"那条纪律的落点，
     *      两条**各自一个用例**：合成一个的话，前一条失败会把后一条挡住。
     */
    assert.equal(eloChangeOf(matchAt(0), SELF_UUID), null, '★★ 私人房读不到 ⇒ null，不是 0');
    assert.equal(eloChangeOf(matchAt(2), SELF_UUID), null, '★ 平局那一行同理');
  });

  it('★ `eloChangeOf`：`changes[]` 里**没有他**那一条 ⇒ `null`', () => {
    assert.equal(
      eloChangeOf(matchAt(1), RANKED_RIVAL_UUID),
      null,
      '★ 那一条记录里没有这个 uuid ⇒ null',
    );
  });

  it('★★ placement（`change: null`）⇒ `null`，不是 0', () => {
    /*
     * ⚠️ 上游文档：定级赛的 `change` / `eloRate` 是 null（`DOCUMENTED, NOT MEASURED` ——
     *    100 行实测里没有一行是 placement）。我们照文档留了 `| null`：
     *    真遇到时那一格说「—」，而不是"这一场 +0"。
     */
    const placement = firstMatchOf({
      status: 'success',
      data: [
        {
          ...MATCH_RANKED,
          changes: [{ uuid: SELF_UUID, change: null, eloRate: null }],
        },
      ],
    });
    assert.equal(eloChangeOf(placement, SELF_UUID), null);
    assert.equal(
      matchOutcome(placement, SELF_UUID),
      'win',
      '★ 结果与变化是两件事：结果照样读得出来',
    );
  });
});
