/**
 * Ranked 共享层（解析 / 派生 / 纯函数）的测试。
 * ⚠️ 夹具是**从真实响应裁下来的**（2026-09-16 实测），字段名逐个照抄 ——
 *    形状写错的话，这一层"宽容"会把整格变成 null，而界面上只表现为一个「—」。
 * ⚠️ 本文件里**不许出现真实域名**（上游一律用内联对象，不打网络）。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const {
  parseLive,
  parseLeaderboard,
  parseWeekly,
  parseHeartbeat,
  sortLiveMatches,
  topLiveMatches,
  topEloEntries,
  rankedLiveChannel,
  RANKED_LIVE_TOP,
  RANKED_ELO_TOP,
  RANKED_POLL_MS,
  RANKED_FETCH_OPTIONS,
  RANKED_FETCH_HEADERS,
} = await import('@mcsr/shared/ranked');

/** 四个场次，覆盖：正常 / timeline 为 null / 一人未定级 / 没有直播 / 认不出的平台。 */
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
    ],
  },
};

describe('冻结常量', () => {
  it('★ 条数与刷新间隔（spec §13）', () => {
    assert.equal(RANKED_LIVE_TOP, 10);
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
    assert.equal(d.matches.length, 4);
  });

  it('★ 两人 elo 的平均：一人 null 时用另一个人的值；两人都 null 时是 null', () => {
    const d = parseLive(LIVE_FIXTURE);
    assert.ok(d);
    assert.equal(d.matches[1]?.avgElo, 2000, '一人 null ⇒ 取另一个人的');
    assert.equal(d.matches[3]?.avgElo, null, '两人都 null ⇒ null');
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

describe('sortLiveMatches / topLiveMatches', () => {
  it('★★ 按平均 elo 降序，两人都 null 的排最后', () => {
    const d = parseLive(LIVE_FIXTURE);
    assert.ok(d);
    const sorted = sortLiveMatches(d.matches);
    // 四场的平均 elo 分别是 1657 / 2000（一人 null）/ 2278.5 / null（两人都 null）
    assert.deepEqual(
      sorted.map((m) => m.avgElo),
      [2278.5, 2000, 1657, null],
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

  it('★ 取前 10（`RANKED_LIVE_TOP`），且不修改入参', () => {
    const d = parseLive(LIVE_FIXTURE);
    assert.ok(d);
    assert.equal(RANKED_LIVE_TOP, 10);
    const before = d.matches.map((m) => m.key);
    assert.equal(topLiveMatches(d).length, 4, '不足 10 场就全给');
    assert.deepEqual(
      d.matches.map((m) => m.key),
      before,
      '入参没被就地排序',
    );
  });
});

describe('parseLeaderboard：并列与跳号', () => {
  const FIXTURE = {
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
      ],
    },
  };

  it('★ 排名取上游的 eloRank（并列照原样重复），不是下标 + 1', () => {
    const d = parseLeaderboard(FIXTURE);
    assert.ok(d);
    assert.deepEqual(
      d.users.map((u) => u.rank),
      [1, 3, 3],
    );
  });

  it('★ highest 缺了就 null（不是 undefined、不是 0）', () => {
    const d = parseLeaderboard(FIXTURE);
    assert.equal(d?.users[0]?.highest, 2385);
    assert.equal(d?.users[2]?.highest, null);
  });

  it('赛季起止与号数照抄（秒）', () => {
    const d = parseLeaderboard(FIXTURE);
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

describe('parseWeekly：id 用响应里的那个', () => {
  const FIXTURE = {
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

  it('周数、截止、四个种子、条目逐格', () => {
    const d = parseWeekly(FIXTURE);
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
        ...FIXTURE.data,
        seed: { overworld: '1', nether: '2', theEnd: '3', rng: '4', flags: null },
      },
    };
    assert.ok(parseWeekly(noFlags));
  });

  it('整份不成形状 ⇒ null', () => {
    assert.equal(parseWeekly({ status: 'success', data: { id: 1 } }), null);
  });
});

describe('parseHeartbeat：取最后一条心跳', () => {
  const FIXTURE = {
    heartbeatList: {
      2: [
        { status: 0, time: '2026-09-15 13:35:27', msg: '', ping: null },
        { status: 1, time: '2026-09-15 13:36:27', msg: '', ping: 380 },
      ],
    },
    uptimeList: { '2_24': 0.999, '3_24': 1 },
  };

  it('★ 取 monitor 2 的**最后一条**（数组是旧→新）', () => {
    assert.deepEqual(parseHeartbeat(FIXTURE), {
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
    const m = parseHeartbeat(FIXTURE);
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
