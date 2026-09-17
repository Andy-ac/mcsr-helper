/**
 * 「Ranked 实时信息」（`/ranked`）这一栏的**全部形状** —— 只放**我们**的形状。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 上游的原始形状**一个字段都不许进这个文件**
 * ---------------------------------------------------------------------------
 * 上游（`const.ts` 里那两个直连入口 + 那个状态主机）响应里的
 * `status` / `data` / `liveMatches` / `seasonResult` / `heartbeatList` 这些东西
 * 全部**只活在 `parse.ts` 里**。界面与直连层只认这里定义的类型。
 *
 * 为什么要把这条写成硬规矩（而不是"尽量"）：上游有两个等价入口
 * （地址只在 `const.ts` 里写一次）、形状还有五处与它自己的文档不一致
 * （spec §2.3）。一旦上游的字段名漏进界面层，**换入口或上游改一次字段名**就会变成
 * 一次全栏目的改错；而转换只住在 `parse.ts`，改动永远只有一处。
 *
 * ---------------------------------------------------------------------------
 * ★ 为什么这里到处都是 `| null`
 * ---------------------------------------------------------------------------
 * 判据只有一条，写在 `parse.ts` 的文件头：**这一格能不能渲染**。
 * 上游给的是第三方数据，`timeline` 实测 20 个玩家块里 6 个是 `null`、
 * `eloRate` 也会是 `null`（未定级是**常态**不是异常，spec §10 第 6 条）。
 * ⇒ 凡是我们**表达得出"不知道"**的地方一律是 `| null`，界面印「—」；
 *   凡是**表达不出**的地方（`rank`、`timeMs`、赛季起止…）宁可少一行，
 *   也绝不编一个 0 或 `undefined` 出来：
 *   `undefined` 会让界面上的 `{{time}}` 变成空串，而那看起来像"时间就是空的"，
 *   `0` 则会印出一个**假的名次**（第 0 名）或 1970 年的时间。
 *
 * ⚠️ `nickname` 是 `| null` 而不是 `string`：上游 `liveMatches[].players` 理论上恒为 2 个，
 *    但实测数据之外仍要有兜底（spec §2.3 第 4 条）—— 缺一个玩家块时那一侧是**空位**，
 *    而空位的名字只能是 `null`。把它写成 `string` 会逼着解析层"删掉那一行"或编一个空串，
 *    前者让左右不对称（spec §6.3 明确不许），后者会印出一个没有名字的玩家。
 */

/**
 * 四个标签页 —— 顺序就是界面上那一排的顺序（状况 → 高分对局 → 排行榜 → 周赛）。
 *
 * ⚠️ 它是**运行时的数组**（不是只有类型的联合），因为它还要给路由表与标签页栏用；
 *    单写一个 `type RankedTab` 会让"顺序"这件事在别处再抄一遍。
 */
export const RANKED_TABS = ['status', 'live', 'elo', 'weekly'] as const;

export type RankedTab = (typeof RANKED_TABS)[number];

/**
 * 能**内嵌播放**的直播平台（CSP 的 `frame-src` 只放开了这三个，spec §2.4/§13）。
 *
 * ⚠️ 与 `parse.ts` 里 `rankedLiveChannel()` 的返回值同源，但**故意不共用**
 *    `live.ts` 的 `LivePlatform`：这一栏的判据是"**从一条 liveUrl 里认得出哪个平台**"，
 *    而那一栏的判据是"我们记录哪些平台的频道"。两者今天取值相同，
 *    合并的那一刻，加一个平台就会被逼着同时改两件不同的事。
 *    （值相同，所以 `RankedLivePlatform | null` 与 `LivePlatform | null` 互相可赋值。）
 */
export type RankedLivePlatform = 'twitch' | 'youtube' | 'bilibili';

/** 一场对局里的**一侧**（用户原话的字段顺序：玩家名 → elo → #排名 → 当前进度 → 当前时间）。 */
export interface RankedLivePlayer {
  /** 玩家名。空位（上游只给了一个玩家）时是 `null`，界面印「—」。 */
  nickname: string | null;
  /** 未定级就是 `null` —— 这是**真实状态**，不是缺数据（spec §10 第 6 条）。 */
  eloRate: number | null;
  eloRank: number | null;
  /** 上游 `data.<uuid>.timeline.type` **原样**（如 `nether.find_bastion`）。 */
  timelineType: string | null;
  /** 那个节点的时间，**毫秒**（spec §13 的时间单位表）。 */
  timelineTime: number | null;
  liveUrl: string | null;
  /** 由 `liveUrl` 的**域名**判出来；认不出的平台（kick 等）是 `null`。 */
  livePlatform: RankedLivePlatform | null;
}

export interface RankedLiveMatch {
  /**
   * 卡片的 React key：两个 uuid **排序后**用 `|` 拼起来。
   *
   * ⚠️ 上游**没有 match id**（spec §2.3 第 3 条）⇒ 卡片不能挂详情链接，key 只能这么来。
   *    排序是必须的：玩家左右顺序按 elo 摆（见下），同一场比赛在两次刷新之间
   *    可能因为 elo 变化而左右互换 —— 不排序的话 key 会跟着换，React 会把整张卡片
   *    当成新的一场比赛重建（展开的直播框会跟着塌掉）。
   */
  key: string;
  /** 这场比赛已经进行了多久，**毫秒**。 */
  currentTime: number;
  /**
   * 两人 `eloRate` 的**非 null 平均**；两人都 `null` 时是 `null`（排序时排最后）。
   * ⚠️ 一人 `null` 时取**另一个人的值**，不是把 null 当 0 算 —— 当 0 算会让
   *    一场高分对局（2349 + 未定级）掉到 1174，排在所有普通场次后面。
   */
  avgElo: number | null;
  /**
   * **恰好两个**，顺序固定：`eloRate` 高的在左，`null` 排后，相等时保持上游数组顺序。
   * ⚠️ 写成元组（不是数组）是为了让界面**左右两半对称渲染**这件事在类型上成立 ——
   *    下标 0 与 1 都一定存在，组件里不必再写一次"可能没有右边"的分支。
   */
  players: [RankedLivePlayer, RankedLivePlayer];
}

/**
 * `GET /live` 里我们真正要的两格（② 的对局 + ① 的在线人数）。
 *
 * ⚠️ 这里**没有** `fetchedAt`：解析是**纯函数**（同一份响应解析两次必须得到同一个结果，
 *    不读时钟），"这份数据是什么时候拿到的"由调用方在拿到响应时记一次（spec §4.4）。
 *    把 `Date.now()` 塞进解析层会让这一层再也测不动（测试会变成"看机器跑多快"）。
 */
export interface RankedLiveData {
  /** ① 的"实时人数"。`null` = 人数那一格读不到（**与 `0` 是两句话**，spec §6.2）。 */
  players: number | null;
  /**
   * 上游顺序，**没有被排序**。
   * ⚠️ 排序是 `select.ts` 的事（`sortLiveMatches` / `sliceLiveMatches`）：
   *    解析层只管"把上游翻译成我们的形状"，额外做一次排序会让
   *    "解析"与"展示口径"两件事混在一起 —— 而展示口径是会被改的（谁在前谁在后）。
   */
  matches: RankedLiveMatch[];
}

/**
 * 状态栏里的**一个**组件（①）。四格由 `RANKED_STATUS_COMPONENTS` 那张表定序与命名。
 *
 * ---------------------------------------------------------------------------
 * ★★ 用户 2026-09-19 的裁决：只留"四个组件（状态 + 最后更新）+ 在线人数"
 * ---------------------------------------------------------------------------
 * 这一栏原来还有一个**单独的** Game Server 心跳行，上面挂着延迟（`ping`）、
 * 24 小时可用率（`uptime24`）与一串解释性文字。用户的原话是：
 * 「"状态栏"显示 Game Server, API, Store 和 Wiki 所有的状态和最后更新时间，
 *   下面显示当前在线人数，**不加其他多余的信息**」，追问后的口径是
 * **只留四行（状态 + 最后更新）与人数** ⇒ 延迟、可用率、心跳历史、那些解释性句子**全部删掉**。
 * ⚠️ 删掉的那几格上游**照样给**（`ping` / `uptimeList`），只是**不再进我们的形状**：
 *    不进形状 = 这一层不必为它们写任何兜底，界面也不可能"顺手"再印一个出来。
 *    想加回来的人请先看 `pending.md` —— 那不是"漏了"，是**被删掉的**。
 */
export interface RankedStatusComponent {
  /** `RANKED_STATUS_COMPONENTS` 里的那个 id（上游 `heartbeatList` 的键）。 */
  id: string;
  /**
   * 名字的**词条 key**（`ranked.componentGameServer` …）。
   * ⚠️★ 上游的响应里**没有名字**，这个名字来自那张人看的状态页（`const.ts` 那张表
   *    写着完整来历）—— 它是这一栏**唯一**一处未经 API 验证的东西。
   */
  nameKey: string;
  /**
   * 上游的四档原样取值（0 故障 / 1 正常 / 2 等待 / 3 维护），映射成词条是界面那一层的事
   * （spec §6.2：四种都要有话说）。
   *
   * ⚠️★ `null` = **上游这一份响应里没有这一格**（或者它那一格没有状态），
   *    它**不是**「故障」。界面对它印占位符 `—` —— 把一个读不到的组件画成红色的
   *    「故障」是在说一件我们并不知道的事（而那件事会让人去查一个没坏的服务）。
   */
  state: 0 | 1 | 2 | 3 | null;
  /**
   * ★ 上游那一条心跳的时间，**原样一串文本**（`2026-09-17 11:16:27`），不是时间戳。
   *
   * ⚠️★ 那串字符**没有时区** —— 这是这一格**唯一**需要写下来的一条判断：
   *    · 它来自上游状态页自己的监视器（Uptime Kuma 那一类），用的是**谁的表**我们没有证据；
   *    · `new Date('2026-09-17 11:16:27')` 会被 JS 按**本机时区**解释 ⇒ 同一份数据在
   *      UTC+8 的机器上会算出比 UTC 机器**早 8 小时**的时刻（本仓被这种静默的 8 小时
   *      偏移烧过一次）⇒ 显示值随部署机器漂，而测试变成"看机器运气"；
   *    · 判定：**它是一个字符串，我们一个时间戳都不换算**。界面上原样印
   *      （「最后更新 2026-09-17 11:16:27」），而"这份数据有多旧"由外壳那一行
   *      `updatedAgoSecs`（**本地**时钟算的）回答 —— 两件事，各说各的。
   *    ⚠️ 它同时意味着：**跨机器/跨时区比较这串文本是没有意义的**（我们从没这么做过，
   *      也不要开始做）。这条判断由 `ranked-shared.test.ts` 里那几条断言钉住：
   *      值是原样的字符串、类型是 `string`、换一份夹具就换成那一份的文本。
   *    `null` = 这一格没有心跳（上游没给 / 那一格不在）。
   */
  checkedAt: string | null;
}

/**
 * 我们**唯一**的服务端端点的响应（`GET /api/ranked/status`，公开、`no-store`）。
 *
 * ⚠️ 三个时间戳是**三件不同的事**，别合并：
 *   · `serverNow` —— 服务端取一次"现在"，给界面校准本地时钟（访客的机器可能差几分钟）；
 *   · `fetchedAt` —— 这份**心跳**是什么时候从上游取到的（= 心跳的年龄）；
 *   · `components[].checkedAt` —— **上游说**它最后一次检查是什么时候（一串没有时区的文本）。
 *
 * ⚠️★ `components` 是**四格**、顺序由 `RANKED_STATUS_COMPONENTS` 定（不是"上游给了几格就几格"）：
 *    上游少了某一格时，界面上那一行照样在、只是状态与时间是 `—`
 *    —— 悄悄少一行会让用户以为状态栏本来就长这样。
 */
export interface RankedStatusResponse {
  components: RankedStatusComponent[];
  serverNow: number;
  fetchedAt: number;
  /** 上游取不到时给的是上一次的成功结果 ⇒ `true`（界面上要说"这是旧数据"）。 */
  stale: boolean;
}

/** 排行榜的一行（③）。 */
export interface RankedEloEntry {
  /** ★ 上游的 `eloRank`：**竞赛排名**，并列会重复、之后会跳号（spec §2.3 第 2 条）。 */
  rank: number | null;
  nickname: string | null;
  eloRate: number | null;
  /** ★ 来自 `users[].seasonResult.highest`（**不在上游文档 schema 里**，spec §2.3 第 1 条）。 */
  highest: number | null;
  phasePoint: number | null;
}

export interface RankedEloData {
  /** ⚠️ 起止是**秒**（spec §13 的时间单位表），渲染时按本地时区乘 1000。 */
  season: { number: number; startsAt: number; endsAt: number };
  /** 上游顺序（已经按 eloRank 排好），我们**只截断不重排**（见 `select.ts`）。 */
  users: RankedEloEntry[];
}

/**
 * ★ "赛段"（上游叫 **phase**）—— 用户 2026-09-19 要求**并排显示在赛季时间旁边**的那一份。
 *
 * ---------------------------------------------------------------------------
 * ⚠️★ 它来自**另一个端点**（`/phase-leaderboard`，93 字节），不是 `/leaderboard`
 * ---------------------------------------------------------------------------
 * 实测：`/leaderboard` 的响应里**根本没有 phase 对象**（只有每一行各自的
 * `seasonResult.phasePoint` / `phaseHighest`）。赛段的号数与截止时间只在
 * `GET /phase-leaderboard` 的 `data.phase` 里，形状恰好就是文档的 `PhaseInfo`
 * = `{endsAt, number, season}` ⇒ 想要"赛季窗口旁边显示赛段"，就必须**多发一次请求**。
 * 那次请求很便宜（实测 93 字节、无参数），而它**失败不该让排行榜变空**：两件事，
 * 界面上也是两件事（`RankedEloView` 只把赛段那一格说成"读不到"）。
 *
 * ⚠️ 上游那个端点同时会回一份 `users`（实测：不带 `?predicted=true` 时是**空数组**）。
 *    我们**完全不看它** —— 这一栏要的是赛段的**时间窗口**，不是赛段积分榜
 *    （用户说的是"并排显示赛段信息"，不是"再来一张表"）。所以 `users` 不进这个形状。
 * ⚠️ 三格在文档的 schema 里 `number` / `endsAt` 是 `integer | null`、`season` 是必填；
 *    我们三格都按"可能读不到"处理（`| null`），判据还是那句"这一格能不能渲染"。
 */
export interface RankedPhaseData {
  /** 赛段号（实测今天是第 1 段）。`null` = 那一格读不到。 */
  number: number | null;
  /** 赛段截止时间，**秒**（与 `endsAt` 同一条单位规矩）。 */
  endsAt: number | null;
  /** 这个赛段属于哪个赛季。`null` = 读不到。 */
  season: number | null;
}

/** 周赛榜单的一行（④）。 */
export interface RankedWeeklyEntry {
  /**
   * ⚠️ 这里**没有** `| null`：上游每一行都给得出名次。
   *    表达不出"不知道"的位置，解析层只能**丢掉这一行**（见 `parse.ts` 里的说明）。
   */
  rank: number;
  nickname: string | null;
  /** 成绩，**毫秒**（`244241` ⇒ 界面上是「4:04.241」）。 */
  timeMs: number;
  eloRate: number | null;
  eloRank: number | null;
}

export interface RankedWeeklyData {
  /**
   * ★ 上游**响应里**那个周数（`parseWeekly` 从 `data.id` 取），**不是** URL 里那个。
   * ⚠️ 请求"本周"（`/weekly-race`）会拿到 `103`，请求 `0` 也会拿到 `103`
   *    （0 是"本周"的别名）⇒ 显示与翻页都必须用**响应里**这个值（spec §2.3 第 5 条）。
   */
  id: number;
  /** 截止时间，**秒**。 */
  endsAt: number;
  /**
   * 四个种子。⚠️ 上游还有第五格 `flags`（新周 207、老周 `null`）——
   *    我们**不显示**它，所以它**不进这个形状**（不进 = 不必为它写任何兜底）。
   */
  seed: { overworld: string; nether: string; theEnd: string; rng: string };
  entries: RankedWeeklyEntry[];
}
