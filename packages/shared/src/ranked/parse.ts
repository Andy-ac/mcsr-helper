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
import { RANKED_STATUS_COMPONENTS } from './const';
import { rankedLiveChannel } from './embed';
import type {
  RankedEloData,
  RankedEloEntry,
  RankedLiveData,
  RankedLiveMatch,
  RankedLivePlayer,
  RankedMatch,
  RankedMatchChange,
  RankedMatchPlayer,
  RankedMatchVod,
  RankedPhaseData,
  RankedPlayerDetail,
  RankedPlayerRecord,
  RankedStatusComponent,
  RankedWeeklyData,
  RankedWeeklyEntry,
} from './types';

/*
 * ---------------------------------------------------------------------------
 * 六个助手 —— 这一层的**全部**技巧，每个都只干一件事
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

/**
 * 「这是一个真的布尔吗」。
 * ⚠️ 它必须是**严格**的 `typeof === 'boolean'`：上游那一格是 JSON 的 `true`/`false`
 *    （实测 100 行都有），而 `Boolean('false')` 是 `true` —— 谁要是把它写成宽松版本，
 *    字面量字符串 `"false"` 会被我们读成"是"（`forfeited` 那一格会印成"弃权"）。
 * ⚠️ 它今天只服务 `forfeited` 一格：那一格在类型里没有 `| null`
 *    （`RankedMatch.forfeited: boolean`，见 `types.ts`）⇒ 读不出来时**只能**丢那一行。
 */
function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

/**
 * 上游信封的**前半**：`status === 'success'` 的那一份根对象（其余一律 `null`）。
 *
 * ⚠️ 拆出它是因为 `data` 有两种形状：五个老端点给的是**对象**，而
 *    `/users/{id}/matches` 给的是**数组**（findings §2.1：`{"status":"success","data":[…]}`）
 *    —— `envelope()` 用 `rec(data)` 读它，数组会被判成"不是对象"，
 *    于是一整份好数据会变成 `null`（界面说"上游返回的数据看不懂"，而它其实好好的）。
 * ⚠️ "`status` 必须是 success"这条判据**只在这里写一次**：两处各写一遍的话，
 *    哪天上游多一个成功状态（比如 `success_with_warnings`），改了一处漏了另一处，
 *    表现是"有一个端点整份读不到"而另外几个照常 —— 那种不一致最难查。
 */
function envelopeRoot(raw: unknown): Record<string, unknown> | null {
  const root = rec(raw);
  return root?.status === 'success' ? root : null;
}

/** 上游信封：`{status:'success', data:…}` —— `status` 不是 success 或缺 data 就是"整份不成形状"。 */
function envelope(raw: unknown): Record<string, unknown> | null {
  const root = envelopeRoot(raw);
  if (!root) return null;
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
 *
 * ⚠️ `index` 是这一行在 `liveMatches[]` 里的位置，**只**用于"读不出 uuid"时的 key 兜底（见 key 那段）。
 */
function parseMatch(row: unknown, index: number): RankedLiveMatch {
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

  /*
   * ★ React 的 key：两个 uuid **排序后**再拼（不是按玩家左右顺序）。
   *   为什么要按排序拼：左右顺序会随 elo 变（上面刚固定过），而 key 用左右顺序拼的话，
   *   一次 elo 变化就会让 React 把整张卡片当成新的一张重建（用户展开的直播框会塌掉）。
   *
   * ⚠️ 为什么"一个 uuid 都读不出来"时要退回**位置**（`#index`），而不是拼出空串
   *   （旧写法：空位用空串占位 ⇒ 两行都读不出来时都得到 `'|'`）：**重复的 React key 是
   *   静默的渲染错乱** —— React 只往控制台丢一句警告，然后把两张卡片的状态串在一起，
   *   而界面上看起来"只是有点怪"，没有任何门禁会发现它。
   *   位置兜底在**同一份响应内**是稳定的，而 key 需要的**只是**这个（spec §6.3：卡片身份在一次会话内不跳）。
   *   否决了"退回随机数/时间戳"：那会让 React 每次刷新都重建卡片 —— 正是上面那条要防的事。
   *   否决了"读不出 uuid 就丢掉这一行"：那一场是真在打的（两人、有 elo），
   *   为一个 key 删掉一张卡片，是拿一件确定的事去换一件不确定的事。
   */
  const uuids = slots
    .map((s) => s.uuid)
    .filter((u): u is string => u !== null)
    .sort();

  return {
    key: uuids.length > 0 ? uuids.join('|') : `#${String(index)}`,
    /*
     * ⚠️ `?? 0` 是**防御**分支：上游的 `currentTime` 在上游 schema 的必填表里（实测每次都给），
     *    所以这里走不到；走到了只可能是"上游改了自己的形状"。
     *    兜底取 `0`，因为 `0` 是时长唯一的**下界**，它不编造任何一个具体信息。
     *    否决了"丢掉这一行"：那一场是真在打的，为了一个进度数字删掉整张卡片，
     *    是拿一件确定的事去换一件不确定的事。
     * ⚠️ 但**别声称这个异常"看得出来"**：一场已经打了 12 分钟的对局被印成 `0:00`，
     *    与一场刚开的对局**完全一样**（所以界面上的时间不能当作"这一场刚开始"的证据）。
     */
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
 *    （`sortLiveMatches` / `sliceLiveMatches`）。
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
  // ⚠️ 下标**必须**传进去：`parseMatch` 用它做 key 的位置兜底（读不出 uuid 的行之间不许撞 key）。
  return {
    players: num(data.players),
    matches: data.liveMatches.map((row, index) => parseMatch(row, index)),
  };
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
 * 心跳响应 → **四格组件的状态与最后更新时间**（① 的状态栏）。
 *
 * ---------------------------------------------------------------------------
 * ★★ 这里迭代的是**我们那张表**（`RANKED_STATUS_COMPONENTS`），不是 `heartbeatList` 的键
 * ---------------------------------------------------------------------------
 * 用户要的是"Game Server, API, Store, Wiki 四个的状态与最后更新时间"（2026-09-19）⇒
 * 界面上的行数必须是**四**，与上游那一刻回了几个监视器无关：
 *   · 上游少了某一格（改过 id、那一刻数据缺失）⇒ **那一行的状态是 `null`**，
 *     界面印「—」。悄悄少一行会让用户以为状态栏本来就长这样
 *     （而"少了的那一个正好是你关心的那个"看起来与"它不在状态栏上"一模一样）；
 *   · 上游多了第五个 ⇒ 它**不进**这一份（表里没有它）。要不要显示是产品决定，
 *     答案是"不要"（用户点了这四个名字），所以这里不按上游的键迭代。
 * ⚠️ 两者都是**刻意的**，改任何一个都要连着 `const.ts` 那张表的注释一起改。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 取的是每一格的**最后一条**（数组是旧 → 新），且数组里可以只有一条
 * ---------------------------------------------------------------------------
 * 实测：每格 100 条、旧→新（监 2 是 `03:01:27 … 11:16:27`）。取第一条（或取平均）
 * 会让我们显示一个最多 100 分钟前的状态 —— 那时界面上的字还是"正常"，
 * 而它说的是**一小时前**的正常。这是这一层最坏的一种错：**数据是真的，时间是假的**。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ `ping` / `uptimeList` 在这份响应里，但我们**一个字都不读**
 * ---------------------------------------------------------------------------
 * 延迟与 24 小时可用率是 2026-09-19 被用户明确删掉的两样东西（spec §6.2 的修订）。
 * 它们**不进我们的形状** ⇒ 界面不可能"顺手"再印一个出来，这一层也不为它们写兜底。
 *
 * @returns 四格组件（顺序由那张表定）；**整份不成形状**时返回 `null`。
 *   「整份不成形状」有两条判据，都在下面写着：响应不是对象、或者**四格全都没有状态**。
 */
export function parseHeartbeat(raw: unknown): RankedStatusComponent[] | null {
  const root = rec(raw);
  if (!root) return null;

  const beats = rec(root.heartbeatList);
  const components = RANKED_STATUS_COMPONENTS.map(({ id, nameKey }) => {
    // ⚠️ 一格坏掉**只坏那一格**（宽容解析的第②档）：拿不到就算了，别的三格照给。
    const beat = rec(list(beats?.[id]).at(-1));
    return {
      id,
      nameKey,
      state: monitorState(beat?.status),
      // ★ **原样**那串文本（`2026-09-17 11:16:27`）—— 一个时间戳都不换算（见 types.ts 的长注释）
      checkedAt: str(beat?.time),
    };
  });

  /*
   * ★★ 四格**全都没有状态** ⇒ 整份 `null`。
   *
   * 为什么这一条不能省：`heartbeatList` 还在（是一个对象）、但四个 id 一个都对不上，
   * 说明上游**换了键或者换了结构** —— 那是"我们的适配层要改"（服务端回 502 并记下是哪一格），
   * 而**不是**"四个服务刚好都读不到"。少了这条判据，界面上会出现四行整齐的「—」，
   * 看起来像"上游四个服务同时没数据"（一次我们永远查不出来的静默降级）。
   * ⚠️ 判据是**状态**而不是"有没有那条心跳"：状态是这一栏唯一的实质内容，
   *    一份只有时间的响应渲染出来是四行"最后更新 xxx、状态 —"，那是半个状态栏。
   */
  if (components.every((each) => each.state === null)) return null;

  return components;
}

/** `status` 的四档（写成比较链，让 TS 把 `unknown` 收窄成那个联合类型）。 */
function monitorState(v: unknown): 0 | 1 | 2 | 3 | null {
  return v === 0 || v === 1 || v === 2 || v === 3 ? v : null;
}

/**
 * `GET /phase-leaderboard` 的响应 → 赛季**赛段**（③ 顶部那并排的一格）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 这一份是**另一个端点**给的（93 字节），而且它**只为这一格**存在
 * ---------------------------------------------------------------------------
 * `/leaderboard` 里没有 phase 对象（findings §2.4），所以"赛段"必须多打一次请求。
 * 那个响应**很大一部分**是 `data.users`（一份赛段积分榜）—— 我们**不看它**：
 * 用户要的是"并排显示赛段信息"，不是"再来一张表"（`types.ts` 里写着同一句）。
 *
 * ⚠️★ 整份不成形状 ⇒ `null`，而**不是**"回一个三格全 null 的对象"：
 *    调用方（③ 那一页）对这两种情况的处理**不一样** ——
 *    `null` 时那一格说「赛段信息暂时读不到」（我们知道这次没读到），
 *    而"读到了但没有号数/截止" ⇒ 那一格按格印「—」。
 *    合成一种会让"这次请求失败了"与"上游没给这一格"看起来一模一样，
 *    而那两件事的下一步完全不同（重试 / 什么也不做）。
 * ⚠️ 三格**各自**可以是 `null`（文档 schema 里 `number` / `endsAt` 就是可空的）：
 *    号数读得出、截止读不出时，界面印「赛段 1」而不印那一句"读不到"。
 */
export function parsePhase(raw: unknown): RankedPhaseData | null {
  const data = envelope(raw);
  if (!data) return null;

  // ⚠️ `phase` 必须是一个**对象**：它是这份响应的骨架，不是可空的一行。
  const phase = rec(data.phase);
  if (!phase) return null;

  return {
    number: num(phase.number),
    // ⚠️ 秒（上游的 `Date` 一律是秒，spec §13），不在这里乘 1000
    endsAt: num(phase.endsAt),
    season: num(phase.season),
  };
}

/*
 * ---------------------------------------------------------------------------
 * ⑤ 行内展开：这位玩家的最近比赛（`/users/{id}/matches`）+ 他的汇总（`/users/{id}`）
 * ---------------------------------------------------------------------------
 * 用户 2026-09-19：「点开后能查看最近比赛的情况/数据等」⇒ 展开一次要拉**两份**数据。
 * 两份都在访客浏览器里**直连**上游（不新开我们的端点，spec §3 代价 2），
 * 而上游限流是 **500 次 / 10 分钟 / 每个 IP**（findings §5.1/§5.2，服务器每个响应都带着
 * `RateLimit-Policy`）⇒ **点开才发**是这一栏能不能用的前提，否则给 150 行预先拉详情
 * 一次就是 300 个请求。这两份响应能不能复用、什么时候过期由调用方管，这一层只是纯函数。
 */

/*
 * 四个"一行里的某一格"用的助手。⚠️ 它们都**只丢那一格**（回 `null`），不丢整行 ——
 * 唯一的例外写在下面各自的注释里（那些格在类型里没有 `| null`，我们表达不出"不知道"）。
 */

/**
 * 上游 `vod[].url` → 一个**只认 http(s)** 的地址（其余一律 `null`）。
 *
 * ⚠️★ 为什么解析层就要拦这一道：这个字符串会进界面的 `href`
 *    （「这场比赛有录像」那一条链接），而 `javascript:` 这类伪协议一旦进了 `<a href>`，
 *    点它就是**在我们页面的上下文里执行代码** —— 上游是第三方，它的一个字段
 *    就能变成我们页面上的脚本。判据与 `embed.ts` 的 `rankedLiveChannel` **逐字相同**
 *    （那里写着同一句话），它守着的是 `src`，这里守着的是 `href`。
 * ⚠️ 代价写清：上游哪天给一个非 http(s) 的录像地址，这一条录像**不显示**
 *    （而不是显示一条点不动的链接）。实测 36 条录像全是 `https://www.twitch.tv/…`
 *    （findings §2.3），所以这一支今天走不到 —— 它防的是"上游哪天变成别的样子"。
 * ⚠️ 返回的是**原来那串文本**（不是 `URL` 重新序列化过的）：上游给的地址原样进 `href`，
 *    我们不做任何规范化 —— `new URL().toString()` 会把一些字符重新编码，
 *    那是一种"我们改写了上游数据"的静默行为。
 */
function httpUrl(v: unknown): string | null {
  const raw = str(v);
  if (raw === null) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? raw : null;
  } catch {
    // 连 URL 都构造不出来（相对路径、空串以外的垃圾）⇒ 同上：不显示那一条
    return null;
  }
}

/**
 * `players[]` 的一项；`uuid` / `nickname` 是这一个人的**身份**，读不出来就回 `null`。
 *
 * ⚠️ 类型里这两格都没有 `| null`（`RankedMatchPlayer`）：一个没有身份的人
 *    **既当不了"对手"也当不了"是不是他赢了"的判据**（`select.ts` 三个函数全靠 uuid 比），
 *    而编一个空串当昵称会印出一个没有名字的玩家。⇒ 回 `null`，由调用方决定丢弃的粒度。
 * ⚠️ `eloRate` / `eloRank` 相反：它们可空（未定级玩家实测就是 `null`），坏掉只坏那一格。
 *    ⚠️★ 它们还是**现值**、不是那场比赛当时的值（`types.ts` 上那条红线写着这一条）。
 */
function parseMatchPlayer(value: unknown): RankedMatchPlayer | null {
  const p = rec(value);
  const uuid = str(p?.uuid);
  const nickname = str(p?.nickname);
  if (uuid === null || nickname === null) return null;
  return { uuid, nickname, eloRate: num(p?.eloRate), eloRank: num(p?.eloRank) };
}

/**
 * `changes[]` 的一项。⚠️ `uuid` 读不出来就丢**这一条**（不是丢整行）——
 * 代价是那一场的 elo 变化印「—」（`eloChangeOf` 找不到那一条就回 `null`），
 * 而"把这一条当成某个人的"是编的（`change` 那个数字一定属于**某一个** uuid）。
 */
function parseChange(value: unknown): RankedMatchChange | null {
  const c = rec(value);
  const uuid = str(c?.uuid);
  if (uuid === null) return null;
  return { uuid, change: num(c?.change), eloRate: num(c?.eloRate) };
}

/** `vod[]` 的一项。三格都没有 `| null` ⇒ 缺一格就丢这一条（**不丢整行**：那一场比赛还在）。 */
function parseVod(value: unknown): RankedMatchVod | null {
  const v = rec(value);
  const uuid = str(v?.uuid);
  const url = httpUrl(v?.url);
  const startsAt = num(v?.startsAt);
  if (uuid === null || url === null || startsAt === null) return null;
  return { uuid, url, startsAt };
}

/**
 * 比赛列表的**一行**；描述不完整就回 `null`（丢掉这一行，理由见 `parseMatches`）。
 *
 * 两条判据分开写，因为它们的**代价不一样**：
 *   · 骨架格（`id` / `type` / `date` / `forfeited` / `result` / 至少一个玩家）读不出来 ⇒ 丢**整行**；
 *   · 其余格（`season` / `seedType` / `bastionType` / 每个人的 elo / 每条 change 与 vod）
 *     坏掉只坏那一格。
 */
function parseMatchRow(row: unknown): RankedMatch | null {
  const m = rec(row);
  const id = num(m?.id);
  const type = num(m?.type);
  const date = num(m?.date);
  const forfeited = bool(m?.forfeited);
  if (id === null || type === null || date === null || forfeited === null) return null;

  /*
   * ★★ `result` 必须是一个**对象**（哪怕里面两格都是 `null`）。
   *
   * 为什么这一条非有不可：我们的形状只有 `result.uuid: null` 这一种写法能表达"上游说平局"
   * （`select.ts` 的 `matchOutcome` 就是按它判 `'draw'`）。而"这一行根本没有 `result`"
   * 是**另一件事**（我们不知道谁赢了）—— 让它落进 `uuid: null` 就是把"不知道"印成"平局"，
   * 而平局在界面上是一个**看起来完全正常**的结果（用户会以为这一场真的打平了）。
   * ⇒ 读不到 `result` 的行**丢掉**（`matchOutcome` 于是不可能对它有结论）。
   */
  const result = rec(m?.result);
  if (!result) return null;

  const players: RankedMatchPlayer[] = [];
  for (const entry of list(m?.players)) {
    const player = parseMatchPlayer(entry);
    /*
     * ⚠️★ 一个玩家块读不出来 ⇒ 丢**整行**（不是丢那一个人）。
     *    两个人都有身份是"谁赢了/对手是谁"的前提：少写一个，`opponentOf` 会把
     *    **另一个人**当成对手（一个陌生人被印成他的对手），而 `matchOutcome`
     *    会把一场他赢了的比赛说成输（因为 `result.uuid` 是那个被丢掉的人）。
     *    两个人的比赛丢一个 ⇒ 剩下的那一个人的行**不是**同一场比赛了。
     */
    if (player === null) return null;
    players.push(player);
  }
  // 空数组 = 这一行没有可用的在场者（实测恒为 1 或 2 个）⇒ 同上，丢掉这一行
  if (players.length === 0) return null;

  const changes: RankedMatchChange[] = [];
  for (const entry of list(m?.changes)) {
    const change = parseChange(entry);
    if (change) changes.push(change);
  }

  const vod: RankedMatchVod[] = [];
  for (const entry of list(m?.vod)) {
    const video = parseVod(entry);
    if (video) vod.push(video);
  }

  return {
    id,
    type,
    season: num(m?.season),
    // ⚠️ 秒（上游的 `Date`），不在这里乘 1000 —— 单位换算是渲染的事（同 `parseLeaderboard`）
    date,
    players,
    // ⚠️ 两格各自可空：`uuid: null` 是**平局**（上游的写法），`time: null` 是那一格读不到。
    //    两者都不许折成 0：`time: 0` 会印成"0 秒完赛"（一个世界纪录级的假数字）。
    result: { uuid: str(result.uuid), time: num(result.time) },
    forfeited,
    changes,
    vod,
    // 私人房（type 3）实测这两格都是 null（那一场的 seed 整个是空的）⇒ 保留 null，不编字符串
    seedType: str(m?.seedType),
    bastionType: str(m?.bastionType),
  };
}

/**
 * `GET /users/{identifier}/matches` 的响应 → 比赛数组（**上游顺序，一个字节都不排**）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️★ 这一份响应**不能走 `envelope()`**
 * ---------------------------------------------------------------------------
 * 它的 `data` 是一个**数组**（findings §2.1），而 `envelope()` 用 `rec()` 读 `data`
 * （数组会被判成"不是对象"）⇒ 一整份好数据会变成 `null`，界面上就是
 * 「上游返回的数据看不懂」—— 一句**指向错误方向**的话（上游什么都对）。
 * ⇒ 骨架判据只有两条：`status === 'success'`，以及 `data` **是不是数组**。
 *
 * ---------------------------------------------------------------------------
 * 行级丢弃：**描述不完整的一行丢掉**（`id` 是其中最要紧的一条判据）
 * ---------------------------------------------------------------------------
 * `id` 不是有限数字的行为什么丢掉：没有 `id` 的行**没有身份** —— 它做不了 React key
 * （展开那一行与它的卡片共用同一把 key），也进不了任何"按这一场分组/去重"的算法，
 * 而"第几行"这种编号是我们**编**出来的东西（编出来的 key 在列表重排时会让 React
 * 把两场比赛的状态串在一起）。⚠️ 早先这里写的是"展开会去打 `/matches/NaN`"——
 * **那是错的**：全仓没有任何地方请求 `/matches/{id}`（`grep` 过：`rankedDirect.ts` 里
 * 只有 `/users/…` 那几条路径，比赛详情端点从没被用过）⇒ 真实的代价是**身份**，不是一次坏请求。
 * ⚠️ 另外几条行级判据（`type` / `date` / `forfeited` / `result` /
 * 空 `players`）逐条写在 `parseMatchRow` 上，它们的共同点是：
 * **那几格在类型里没有 `| null`，我们表达不出"不知道"**。
 * ⚠️ 代价写清：**上游哪天改了自己的形状，界面上的表现是这几行消失**
 *    （不是一整份数据消失，也不是一个假数字）。`parseMatches` 的返回值长度因此
 *    可能小于上游给的条数 —— 界面上那句「最近 N 场」要读**我们这份数组**的长度。
 * ⚠️ 整份不成形状（`status` 不是 success / `data` 不是数组）⇒ `null`：
 *    那与"这一场都没有"是两件事，界面上一句"读不到"，另一句是空列表。
 */
export function parseMatches(raw: unknown): RankedMatch[] | null {
  const root = envelopeRoot(raw);
  if (!root) return null;
  if (!Array.isArray(root.data)) return null;

  const matches: RankedMatch[] = [];
  for (const row of root.data) {
    const match = parseMatchRow(row);
    if (match) matches.push(match);
  }
  return matches;
}

/**
 * 上游 `statistics.{season,total}` 里的一格 → 一个数（**只取 `ranked` 那一半**）。
 *
 * ⚠️★ 为什么只取 `ranked`：上游每一个叶子都是 `{"ranked": …, "casual": …}`（findings §3.2），
 *    而这一栏是「**ranked** 实时信息」的排位榜 ⇒ 把两半相加/取错那一半都是把两件不同的事
 *    合成一个数：`total.loses` 会从 1809 变成 1810（实测值），而那两个数**看起来都正常**。
 *    要显示 casual 的人请另开一格，别在这里做加法。
 * ⚠️ 读不到就是 `null`（印「—」），**不是 0**：0 胜与"读不到"在这一栏是两句话。
 */
function rankedCell(block: Record<string, unknown> | null, key: string): number | null {
  return num(rec(block?.[key])?.ranked);
}

/**
 * `statistics` 的一个块（`season` 或 `total`）→ 我们的战绩形状。
 *
 * ⚠️ 四格全是 `| null`，所以这一份**永远不会**因为"某格读不到"而失败：
 *    连整个 `statistics` 对象都没有时，我们得到的是四格全 `null` 的"一份读不到的战绩"，
 *    那正是界面上四行「—」—— 而不是整份玩家详情变成"读不到"（姓名与 elo 还是好的）。
 * ⚠️ `bestTimeMs` 取的是上游的**毫秒**（实测 `bestTime.ranked: 387772` = 6:27.772，
 *    findings §3.2），这一层不换算成秒（换算是渲染的事）。
 */
function parseRecord(
  stats: Record<string, unknown> | null,
  block: 'season' | 'total',
): RankedPlayerRecord {
  const cells = rec(stats?.[block]);
  return {
    wins: rankedCell(cells, 'wins'),
    loses: rankedCell(cells, 'loses'),
    playedMatches: rankedCell(cells, 'playedMatches'),
    bestTimeMs: rankedCell(cells, 'bestTime'),
  };
}

/**
 * `GET /users/{identifier}` 的响应 → 展开抽屉要的那一份汇总。
 *
 * ---------------------------------------------------------------------------
 * 骨架只有两格：`uuid` 与 `nickname`
 * ---------------------------------------------------------------------------
 * 展开是**按行**发生的（点的是榜单上某一行），所以"这一份是谁的"必须先成立：
 * 没有身份的一份响应我们无法归属到任何一行 ⇒ 整份 `null`。
 * ⚠️★ `nickname` 是这一份响应最有价值的东西之一：上游回的是**规范写法**
 *    （实测 `/users/voxio` → `"Voxio"`、`/users/EDCR` → `"edcr"`，findings §6 末段）
 *    ⇒ 搜索框"回车精确查一位玩家"之后，标题里该显示的是**这里这个**字符串，
 *    而不是用户敲进去的那串大小写。
 * ⚠️ `eloRate` / `eloRank` 是 `| null` 而**不是**骨架：未定级玩家实测就是两格 `null`
 *    （`/users/inoutoftherain`），那时界面上印「—」，这一份详情照样成立。
 *
 * ---------------------------------------------------------------------------
 * 其余每一格都是宽容的（第②档）
 * ---------------------------------------------------------------------------
 * `statistics` 缺了 ⇒ 两份战绩四格全 `null`。
 * 一处**整份失败都没有**：类型里每一格都表达得出"不知道"。
 * ⚠️★ `seasonResult`（上游给"本赛季最高 elo"那一块）**整个不读了**：修复轮（T4）
 *    删掉了它唯一的消费者 `seasonHighest`（没有渲染点、没有词条 ⇒ 见 `types.ts` 那段）。
 *    留着 `rec(data.seasonResult)` 会是一个**没有任何读者**的局部变量。
 */
export function parsePlayerDetail(raw: unknown): RankedPlayerDetail | null {
  const data = envelope(raw);
  if (!data) return null;

  const uuid = str(data.uuid);
  const nickname = str(data.nickname);
  if (uuid === null || nickname === null) return null;

  const statistics = rec(data.statistics);

  return {
    uuid,
    nickname,
    eloRate: num(data.eloRate),
    eloRank: num(data.eloRank),
    season: parseRecord(statistics, 'season'),
    total: parseRecord(statistics, 'total'),
  };
}
