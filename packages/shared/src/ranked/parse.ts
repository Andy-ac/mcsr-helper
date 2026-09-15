/**
 * **宽容**解析：上游响应 → 我们这一栏的形状（spec §4.3）。
 *
 * ---------------------------------------------------------------------------
 * ★ 为什么这一层不做 zod 全量校验
 * ---------------------------------------------------------------------------
 * 一份 150 条 × 8 字段的排行榜逐条过 schema 是白花 CPU；更糟的是**上游加一个字段我们就会红**
 * （`highest` 就是这么冒出来的：它**不在上游文档的 schema 里**，spec §2.3 第 1 条）。
 * ⇒ 判据是「**这一格能不能渲染**」，不是「这份响应合不合 schema」：
 *   逐格类型检查 + 兜底，坏一格不毁一份（实测 14 场里坏 1 场，不该让另外 13 场消失）。
 *
 * 三档口径，别混：
 *   ① **整份不成形状** ⇒ 返回 `null`（`status` 不是 `success`、缺 `data`、
 *      或者那份响应里我们赖以成形的那个数组/对象根本不是数组/对象）。
 *      这时调用方按"读不到"处理 —— 而不是把一份看不懂的东西渲染出去。
 *   ② **一格坏了，但类型允许 `null`** ⇒ 那一格是 `null`，界面印「—」。
 *   ③ **一格坏了，而类型里没有 `| null`** ⇒ 要么整份 `null`（当这一格是**整份的骨架**时，
 *      例如周赛的 `id`/`endsAt`），要么**丢掉那一行**（当这一格只是一行里的一部分时）。
 *      ⚠️ 绝不**编**一个值出来：`0` 会印成「第 0 名」或 1970 年的时间，
 *      `undefined` 会让 `{{time}}` 变成空串 —— 两种都比"少一行"糟得多，因为它们**看不出来是错的**。
 *
 * ⚠️ 这一层是**纯函数**（spec §11.2 第一条）：不读时钟、不读全局状态、
 *    同一份响应解析两次必须得到**同一个**结果。"这份数据是什么时候拿到的"
 *    由调用方在收到响应时记一次（`fetchedAt`），那是另一个问题。
 * ⚠️ 本文件里**不许出现上游域名**（Global Constraints 第 1 条），也不打任何网络请求。
 */
import { RANKED_MONITOR_ID } from './const';
import { rankedLiveChannel } from './embed';
import type {
  RankedEloData,
  RankedEloEntry,
  RankedLiveData,
  RankedLiveMatch,
  RankedLivePlayer,
  RankedMonitor,
  RankedWeeklyData,
  RankedWeeklyEntry,
} from './types';

/*
 * ---------------------------------------------------------------------------
 * 五个助手 —— 这一层的**全部**技巧，每个都只干一件事
 * ---------------------------------------------------------------------------
 */

/**
 * 「这是一个对象吗」。
 * ⚠️ `Array.isArray` 也要排掉：数组也是 `typeof 'object'`，而
 *    `[1,2][0]` 与 `{0:1}[0]` 在 JS 里都取得到东西 —— 不排掉数组，
 *    一份"本该是对象却是数组"的响应会被我们读成一堆编号字段，而且**读不出错**。
 */
function rec(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** 「这是个数组吗，不是就当空的」。⚠️ 只有**逐格**用它；整份的骨架不用（见 ① 档）。 */
function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * 「这是一句有内容的文本吗」。
 * ⚠️ 空串与纯空白也算"没有"：上游给个 `''` 当昵称，界面上会是**一行空白**，
 *    看起来像渲染坏了，而 `null` 至少会印「—」。
 */
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/**
 * 「这是一个真的数吗」。
 * ⚠️ `Number.isFinite` 是必须的：`typeof NaN === 'number'`、`typeof Infinity === 'number'`，
 *    放进界面就是 `NaN` / `Infinity` 那两个字符串（时间、elo 都会印成它们）。
 */
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** 上游信封：`{status:'success', data:…}` —— `status` 不是 success 或缺 data 就是"整份不成形状"。 */
function envelope(raw: unknown): Record<string, unknown> | null {
  const root = rec(raw);
  /*
   * ⚠️ 写成 `root?.status !== 'success'` 而不是 `!root || root.status !== 'success'`：
   *    两者**逐字等价**（`root` 是 `null` 时左边是 `undefined !== 'success'` ⇒ 同样返回 null），
   *    但后一种写法是 biome 的 `useOptionalChain` 会报的那一种（本仓 lint 是硬门禁）。
   */
  if (root?.status !== 'success') return null;
  return rec(root.data);
}

/*
 * ---------------------------------------------------------------------------
 * ② 实时高分对局（`/live`）
 * ---------------------------------------------------------------------------
 */

/** 一场对局里的一侧，外加**只在这一层用**的 uuid（我们自己的形状里没有 uuid，规格 §4.3）。 */
interface PlayerSlot {
  player: RankedLivePlayer;
  uuid: string | null;
}

/** 空位：上游只给了一个玩家时的右侧那半。**字段全 null，不是把这一行删掉**。 */
function emptyPlayer(): RankedLivePlayer {
  return {
    nickname: null,
    eloRate: null,
    eloRank: null,
    timelineType: null,
    timelineTime: null,
    liveUrl: null,
    livePlatform: null,
  };
}

/**
 * 从上游的一行里读出**一场对局**。
 *
 * ⚠️ 玩家信息从 `players[]`（**数组**）取，直播与进度从 `data`（**以 uuid 为键的对象**）取
 *    —— 这两件事的形状不一样（spec §2.3 第 3 条），而字段名还都是驼峰（`liveUrl`）。
 *    配对**必须按 uuid 查表**：按"第几个"去配会在上游换个顺序时把 A 的直播间放到 B 的卡片上，
 *    而且一声不响 —— TS 管不到这里，因为整份响应对我们就是 `unknown`。
 */
function parseMatch(row: unknown): RankedLiveMatch {
  const m = rec(row);
  const blocks = m ? rec(m.data) : null;

  const slots: PlayerSlot[] = list(m?.players)
    .slice(0, 2)
    .map((p) => parseSlot(p, blocks));
  // 不足两个 ⇒ 补空位。⚠️ 上游实测恒为 2，但"索引越界"会让整张卡片崩掉，
  //    而一个空位只是左右不对称一点（spec §6.3 明确要求**不删**那一格）。
  while (slots.length < 2) slots.push({ player: emptyPlayer(), uuid: null });

  /*
   * ★ 顺序固定：elo 高的在左，`null` 排后，相等时**保持上游顺序**。
   *   为什么必须固定（而不是照上游数组顺序）：上游那一侧是"谁先开的房间"之类我们不知道的东西，
   *   它会随刷新变；顺序不固定的话，同一场比赛在两次刷新之间会**左右互换**，
   *   而用户正在看的直播框会跟着跳到另一边。
   * `Array.prototype.sort` 是**稳定**的（ES2019 起），所以"相等时保持原顺序"不必写 tie-breaker。
   */
  slots.sort((a, b) => {
    const x = a.player.eloRate;
    const y = b.player.eloRate;
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x;
  });

  const [left, right] = slots;
  const players: [RankedLivePlayer, RankedLivePlayer] = [
    left?.player ?? emptyPlayer(),
    right?.player ?? emptyPlayer(),
  ];

  return {
    /*
     * ⚠️ 两个 uuid **排序后**再拼（不是按玩家左右顺序）：左右顺序会随 elo 变，
     *    而它是 React 的 key —— 用左右顺序拼的话，一次 elo 变化就会让 React
     *    把整张卡片当成新的一张重建（展开的直播框塌掉）。空位用空串占位。
     */
    key: slots
      .map((s) => s.uuid ?? '')
      .sort()
      .join('|'),
    // 上游没给就是 0：界面会说「已进行 0:00.000」——这是**可见的**异常，比整卡片消失好。
    currentTime: num(m?.currentTime) ?? 0,
    avgElo: averageElo(players),
    players,
  };
}

/** 上游 `players[]` 的一项 → 我们的一侧（uuid、昵称、elo、进度、直播）。 */
function parseSlot(value: unknown, blocks: Record<string, unknown> | null): PlayerSlot {
  const p = rec(value);
  const uuid = str(p?.uuid);
  // ⚠️ 查不到 uuid 那一格**不是错误**：实测会有玩家块缺 `data`，
  //    而"缺的那一格是 null"正是宽容解析存在的理由。
  const block = uuid ? rec(blocks?.[uuid]) : null;
  const timeline = block ? rec(block.timeline) : null;
  const liveUrl = str(block?.liveUrl);

  return {
    uuid,
    player: {
      nickname: str(p?.nickname),
      eloRate: num(p?.eloRate),
      eloRank: num(p?.eloRank),
      timelineType: str(timeline?.type),
      timelineTime: num(timeline?.time),
      liveUrl,
      // 平台由**域名**判（`embed.ts`），认不出就是 null ⇒ 界面给外链
      livePlatform: rankedLiveChannel(liveUrl)?.platform ?? null,
    },
  };
}

/**
 * 两人的平均 elo：**只对非 null 的值取平均**（spec §6.3 的冻结口径）。
 *
 * ⚠️ 一人 `null` ⇒ 取另一个人的值（不是把 null 当 0 算）：当 0 算会把
 *    「2349 + 未定级」那场算成 1174，掉到所有普通场次后面 —— 而未定级是**常态**
 *    （周赛冠军今天就没定级），不是"这个人是 0 分"。
 * ⚠️ 两人都 `null` ⇒ `null`（排序时排最后，未定级不该占榜首）。
 */
function averageElo(players: [RankedLivePlayer, RankedLivePlayer]): number | null {
  const rates: number[] = [];
  for (const p of players) {
    if (p.eloRate !== null) rates.push(p.eloRate);
  }
  if (rates.length === 0) return null;
  let sum = 0;
  for (const rate of rates) sum += rate;
  return sum / rates.length;
}

/**
 * `GET /live` 的响应 → ① 的人数 + ② 的对局。
 *
 * ⚠️ 这里**不排序**：`matches` 保持上游顺序，排序是 `select.ts` 的事
 *    （`sortLiveMatches` / `topLiveMatches`）。
 *    否决了"顺手排一下"：那会把**展示口径**（谁在前）混进**解析**，
 *    而展示口径是会被改的（比如以后想按"比赛时长"排）——
 *    改它的那一天，会连"解析是否忠实"这个测试前提一起动到。
 */
export function parseLive(raw: unknown): RankedLiveData | null {
  const data = envelope(raw);
  if (!data) return null;
  /*
   * `players` 与 `liveMatches` 同源（同一个响应）。
   * ⚠️ `liveMatches` 不是数组 ⇒ **整份 null**，而不是"保住人数、丢掉对局"：
   *    一份连对局都不是数组的响应，我们并不知道它到底是什么东西，
   *    从里面捞一个数字出来显示就是"用一个我们看不懂的来源去印一个数字"。
   *    ⚠️ `players` 那一格则相反：它可以单独是 `null`（类型里就有 `| null`），
   *    界面上印「—」+「人数暂时读不到」（**与 `0` 是两句话**，spec §6.2）。
   */
  if (!Array.isArray(data.liveMatches)) return null;
  return { players: num(data.players), matches: data.liveMatches.map(parseMatch) };
}

/*
 * ---------------------------------------------------------------------------
 * ③ Elo 排行榜（`/leaderboard`）
 * ---------------------------------------------------------------------------
 */

/**
 * `GET /leaderboard` 的响应 → 赛季 + 前 N 名（截断在 `select.ts`，这里**不截**）。
 *
 * ★ 两个字段的位置与文档不一致，都是实测出来的（spec §2.3）：
 *   · `highest` **不在**上游文档的 schema 里，真实位置是 `users[].seasonResult.highest`；
 *   · 排名是**竞赛排名** `eloRank`：并列会重复、并列之后会跳号（实测 `…,13,14,14,14,17,…`）
 *     ⇒ 排名只能取上游给的那个数，**绝不能**用"下标 + 1"
 *       （那样会印出一个与 elo 矛盾的排名，而它看起来完全正常）。
 */
export function parseLeaderboard(raw: unknown): RankedEloData | null {
  const data = envelope(raw);
  if (!data) return null;

  /*
   * 赛季这一栏是**整份的骨架**：类型里三格都是必填的数字，没有 `| null` 可以放"不知道"。
   * ⇒ 缺一格就整份 `null`（调用方按"读不到"处理），而不是编一个 0 出来 ——
   *   0 会被界面渲染成 1970 年的时间，而用户会以为那是赛季开始时间。
   */
  const season = rec(data.season);
  const number = num(season?.number);
  const startsAt = num(season?.startsAt);
  const endsAt = num(season?.endsAt);
  if (number === null || startsAt === null || endsAt === null) return null;

  if (!Array.isArray(data.users)) return null;

  return {
    // ⚠️ 起止是**秒**（上游的 `Date` 是秒，spec §13 的时间单位表），不在这里乘 1000：
    //    单位换算是**渲染**的事，混进解析层以后就没有人知道手里那个数是什么单位了。
    season: { number, startsAt, endsAt },
    users: data.users.map(parseEloEntry),
  };
}

/**
 * 排行榜的一行。
 *
 * ⚠️ 每一格的空值口径不同，逐格写清：
 *   · `rank` / `eloRate`：`seasonResult` 里的那个是**本赛季**的数，
 *     外层那个是同一个数（实测两处相等）。取 `seasonResult` 优先、外层兜底 ——
 *     本栏目的名字是"赛季排行榜"，赛季那一份才是它的答案。
 *   · `highest`：**只有** `seasonResult` 有（外层根本没有这一格）。
 *   · `phasePoint`：只有 `seasonResult` 有。⚠️ 赛季刚开始时它**整列都是 0**（spec §2.3），
 *     所以"0"与"缺"必须分开：缺 ⇒ `null`（印「—」），0 ⇒ 真的印 0。
 *   ⚠️ 一行连对象都不是（`null`/字符串）⇒ 保留一行**全 null**：类型里每一格都可空，
 *     所以"这一行我们什么都没读懂"表达得出来；丢行则会让"前 100 名"的边界悄悄移动，
 *     而并列排名本来就来自上游 —— 丢一行在界面上看起来像上游**跳了号**。
 */
function parseEloEntry(row: unknown): RankedEloEntry {
  const user = rec(row);
  const seasonResult = user ? rec(user.seasonResult) : null;
  return {
    rank: num(seasonResult?.eloRank) ?? num(user?.eloRank),
    nickname: str(user?.nickname),
    eloRate: num(seasonResult?.eloRate) ?? num(user?.eloRate),
    highest: num(seasonResult?.highest),
    phasePoint: num(seasonResult?.phasePoint),
  };
}

/*
 * ---------------------------------------------------------------------------
 * ④ 周赛榜单（`/weekly-race`、`/weekly-race/{id}`）
 * ---------------------------------------------------------------------------
 */

/**
 * `GET /weekly-race{,/{id}}` 的响应 → 周数 + 种子 + 成绩表。
 *
 * ★ `id` 取**响应里**那个，不是 URL 里那个：请求"本周"会拿到 `103`，
 *   请求 `0`（"本周"的别名）也会拿到 103 —— 显示与翻页都必须用响应里的值（spec §2.3 第 5 条）。
 */
export function parseWeekly(raw: unknown): RankedWeeklyData | null {
  const data = envelope(raw);
  if (!data) return null;

  // 骨架三格：类型里都没有 `| null`（见 `parseLeaderboard` 的同一条理由）
  const id = num(data.id);
  const endsAt = num(data.endsAt);
  if (id === null || endsAt === null) return null;

  const seed = rec(data.seed);
  const overworld = str(seed?.overworld);
  const nether = str(seed?.nether);
  const theEnd = str(seed?.theEnd);
  const rng = str(seed?.rng);
  if (!overworld || !nether || !theEnd || !rng) return null;

  if (!Array.isArray(data.leaderboard)) return null;

  /*
   * ⚠️ `flags`（新周 207、老周 `null`）**我们不解析、不显示**（spec §2.3）：
   *    它不进我们的形状，所以"老周是 null"这件事在这里不需要任何兜底 ——
   *    这一层对它的态度是**完全不知道它存在**。
   */
  const entries: RankedWeeklyEntry[] = [];
  for (const row of data.leaderboard) {
    const entry = parseWeeklyEntry(row);
    // `null` = 这一行连"第几名、跑了多久"都没有 —— 类型里这两格没有 `| null`，
    // 所以我们**丢掉这一行**（而不是编一个 0:00.000 出来，那会看起来像打破世界纪录）。
    if (entry) entries.push(entry);
  }

  return { id, endsAt, seed: { overworld, nether, theEnd, rng }, entries };
}

/** 周赛成绩的一行；`rank`/`time` 缺一个就 `null`（丢掉这一行，理由见调用处）。 */
function parseWeeklyEntry(row: unknown): RankedWeeklyEntry | null {
  const r = rec(row);
  const rank = num(r?.rank);
  const timeMs = num(r?.time);
  if (rank === null || timeMs === null) return null;

  const player = r ? rec(r.player) : null;
  return {
    rank,
    nickname: str(player?.nickname),
    timeMs,
    // ⚠️ 上游这里的 elo 可以是 `null`（实测冠军就没定级）—— 不能当 0，也不能丢这一行
    eloRate: num(player?.eloRate),
    eloRank: num(player?.eloRank),
  };
}

/*
 * ---------------------------------------------------------------------------
 * ① 服务心跳（`const.ts` 里那个状态主机，只能由我们的服务器去取）
 * ---------------------------------------------------------------------------
 */

/**
 * 心跳响应 → 那一格服务器的状态。
 *
 * ⚠️ `heartbeatList` 里每个键是一个**数组**，实测 100 条，**旧 → 新** ⇒ 取**最后一条**。
 *    取第一条（或取平均）会让我们显示一个最多 100 分钟前的状态，
 *    而界面上写着"正在打的对局"—— 那是最坏的一种错：**数据是真的，时间是假的**。
 * ⚠️ `status` 只有 0/1/2/3 四档（故障/正常/等待/维护），四档都要认：
 *    只判 `status === 1 ? up : down` 会把「维护」说成「故障」（spec §6.2 明确四种都要有话说）。
 */
export function parseHeartbeat(raw: unknown): RankedMonitor | null {
  const root = rec(raw);
  if (!root) return null;

  const beats = rec(root.heartbeatList);
  const latest = list(beats?.[RANKED_MONITOR_ID]).at(-1);
  const beat = rec(latest);
  if (!beat) return null; // 没有这一格 / 数组是空的 ⇒ 整份不成形状

  const state = monitorState(beat.status);
  const checkedAt = str(beat.time);
  // ⚠️ 这两格没有 `| null` 可放：没有状态的徽章、没有时间的心跳都不是"心跳"，
  //    整份 `null` 让端点回 502 `upstream_bad_response`（那是真话，而且带日志）。
  if (state === null || checkedAt === null) return null;

  const uptime = rec(root.uptimeList);
  return {
    state,
    // ★ **原样**那串文本（`2026-09-15 13:36:27`）—— 一个时间戳都不换算（见 types.ts 的长注释）
    checkedAt,
    ping: num(beat.ping),
    // `uptimeList` 的键形如 `2_24`（monitor 2 的 24 小时可用率），与 `heartbeatList` **不同名**。
    uptime24: num(uptime?.[`${RANKED_MONITOR_ID}_24`]),
  };
}

/** `status` 的四档（写成比较链，让 TS 把 `unknown` 收窄成那个联合类型）。 */
function monitorState(v: unknown): 0 | 1 | 2 | 3 | null {
  return v === 0 || v === 1 || v === 2 || v === 3 ? v : null;
}
