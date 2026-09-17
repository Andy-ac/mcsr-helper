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

/*
 * ===========================================================================
 * ⑤ 行内展开：这位玩家的一场比赛（`/users/{id}/matches`）+ 他的汇总（`/users/{id}`）
 * ===========================================================================
 * 用户 2026-09-19 的原话：「点开后能查看最近比赛的情况/数据等」—— 点开是**行内展开**
 * （不是新路由、不是新页面），展开要拉**两份**数据：这位玩家的一份汇总，与他的最近比赛。
 *
 * ⚠️ 上游那些字段名（`data[].id` / `data[].changes[]` / `seasonResult.highest` …）
 *    **只活在 `parse.ts` 里**（文件头那条硬规矩）：这一层是我们自己的形状，
 *    上游改一次字段名时该改的地方永远只有一处。
 * ⚠️ 展开是**跨两位玩家**的（同一份 `matches[]` 里既要知道"他赢了没有"，
 *    也要知道"对手是谁"）⇒ 下面每个纯函数的入参都带着 `selfUuid`（`select.ts`），
 *    而不是把"我是谁"混进形状里 —— 同一份比赛数据被两个玩家看时，
 *    形状不该有两份不同的副本。
 */

/**
 * 一场比赛里的**一位玩家**。
 *
 * ---------------------------------------------------------------------------
 * ⚠️★ 红线（本轮唯一"会静默错"的字段）：
 * `eloRate` / `eloRank` 是**请求那一刻的现值**，不是那一场比赛当时的值
 * ---------------------------------------------------------------------------
 * 实测三场（findings §2.1 底部）：一场 **season 11** 的比赛里，这个块印的仍是
 * 本赛季**现在**的 elo；同一场的 `changes[].eloRate` 才是赛后值。
 * ⇒ 换句话说：把它当"当时的 elo"渲染，画面上会出现"当时 2349 / 赛后 2342"这种
 *   **自相矛盾但看不出来**的格子（两个数都是真的，只是其中一个根本不属于那一刻）。
 *   ⇒ 那一场的 elo 只能用 `changes[]`（`select.ts` 的 `eloChangeOf`）；
 *   这一格进界面前必须按"这位玩家**现在**多少分"来读（名字就叫 `eloRate`，不许改写它）。
 *   ⚠️ 代价写清：**赛前** elo 上游**根本没有**给（只有赛后值），
 *   想显示赛前只能拿 `changes[].eloRate - changes[].change` 去算 —— 而我们**不算**：
 *   私人房（type 3）的 `changes[]` 实测是空数组，算法会在那些行上凭空造一个数出来。
 * ⚠️ `eloRate` / `eloRank` 的 `| null` 不是装饰：未定级玩家实测就是 `null`
 *   （findings §3.1：`/users/inoutoftherain` 两格都是 null）。
 */
export interface RankedMatchPlayer {
  uuid: string;
  nickname: string;
  /** ⚠️★ 玩家**现在**的 elo（请求那一刻），**不是**这一场当时的值（见上面那段）。 */
  eloRate: number | null;
  eloRank: number | null;
}

/**
 * 这一场**一位玩家**的 elo 变化（上游 `changes[]` 的一项）。
 *
 * ⚠️★ `change` 是 `number | null`：上游文档说 placement（定级赛）时它是 `null`
 *    （`DOCUMENTED, NOT MEASURED` —— 100 行实测里没有一行是 placement，findings §7）。
 *    而我们**照文档留了 `| null`**：真遇到时那一格会说「—」，**不是 0**（本仓"绝不为缺失值填 0"）。
 * ⚠️★ 私人房（type 3）的 `changes[]` 实测**恒为空数组**（32/32 行）⇒ 那些行上
 *    "这一场他涨了多少分"是**读不到**，而不是"没变化"。这一格必须能表达"读不到"，
 *    所以 `eloChangeOf`（`select.ts`）对"没有那一条记录"回的是 `null`。
 */
export interface RankedMatchChange {
  uuid: string;
  /** 赛后 elo 变化量；`null` = placement（上游这么定）。 */
  change: number | null;
  /** 赛**后**的 elo（不是赛前）。 */
  eloRate: number | null;
}

/** 一条录像（上游 `vod[]` 的一项）。⚠️ 实测只有 Twitch 一种主机，长度只有 0 或 1。 */
export interface RankedMatchVod {
  uuid: string;
  url: string;
  /** ⚠️ **秒**（上游的 `Date` 一律是秒）：`date - startsAt` 才是"比赛在录像里的第几秒"。 */
  startsAt: number;
}

/**
 * **一场比赛**（`/users/{identifier}/matches` 的一行）。
 *
 * 上游那一行的键实测恒为 20 个（findings §2.1 逐个列过），这里只留下展开要用到的那些 ——
 * 其余的（`category` / `gameMode` / `spectators` / `decayed` / `rank` / `beginner` /
 * `botSource` / `tag`）**不进这个形状**：不进 = 界面不可能"顺手"印一个出来，
 * 这一层也不必为它们写兜底（spec 的"不加多余的信息"是同一条口径）。
 * ⚠️ 其中 `seed` 那一块我们**一个一个字段都没解析**：它的 `endTowers` 实测是 `null`
 *    而**不是** `[]`（文档说反了，findings 冲突 C1）⇒ 谁要读它就得先想清楚那件事，
 *    今天这里的态度是"完全不知道它存在"（`parse.ts` 里没有一行碰它）。
 */
export interface RankedMatch {
  id: number;
  /** 1 casual / 2 ranked / 3 private / 4 event（实测只见过 2 与 3）。 */
  type: number;
  /** 赛季号。`null` = 那一格读不到（实测 100 行里恒为 12，`| null` 是兜底）。 */
  season: number | null;
  /** ⚠️ **秒**（不是毫秒）：上游的 `Date` 一律是秒，乘 1000 是**渲染**的事（spec §13）。 */
  date: number;
  /**
   * ⚠️ 这一场在场上的人（实测 1 或 2 个 —— 1 个的那些是 forfeit / bot 局）。
   *    这一份数组是**判"谁赢了"与"对手是谁"的唯一来源**（`select.ts`），
   *    ⇒ 解析层保证它至少有一个**带 uuid 与昵称**的元素，否则整行丢掉（见 `parse.ts`）。
   */
  players: RankedMatchPlayer[];
  /**
   * ⚠️ **`time` 是毫秒**（`result.time == completions[0].time`，实测两场都成立）；
   *    **`uuid` 为 `null` = 平局**（实测 3/100 行）。
   *    ★ 正是因为 `null` 在这里**有确切含义**（平局），`parse.ts` 才会把"读不到 `result`"
   *    的一行**丢掉**：否则我们会把"不知道"印成"平局"（一件我们并不知道的事）。
   */
  result: { uuid: string | null; time: number | null };
  forfeited: boolean;
  /**
   * ★★ **空数组 = 这一场读不到 elo 变化**（私人房实测 32/32 是空的），不是"没变化"。
   * ⚠️ 空数组与 `null` 在**输出形状**里必须分得开：这里保留成空数组（不折成 `null`），
   *    于是"这一场没有变化记录"与"这一场他涨了 0 分"是两句不同的话。
   *    ⇒ 界面上那一格读 `eloChangeOf()`，它对空数组回 `null`（印「—」），**绝不回 0**。
   */
  changes: RankedMatchChange[];
  /** 空数组 = 这场比赛没有录像（实测 64/100 行是空的；有录像的 36 行恰好 1 条）。 */
  vod: RankedMatchVod[];
  /** 主世界结构类型；私人房实测是 `null`（那时整个 seed 都是空的）。 */
  seedType: string | null;
  /** 要塞类型；私人房实测是 `null`。 */
  bastionType: string | null;
}

/**
 * 一份**战绩**（`/users/{identifier}` 的 `statistics.season` 或 `statistics.total`）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️★ 上游每一个格子里其实有**两个数**（`{ranked, casual}`），我们只取 `ranked`
 * ---------------------------------------------------------------------------
 * 实测（findings §3.2）：`statistics` 恒有两个块（`season` / `total`），每块恒有 **10 个键**，
 * 每个叶子都是 `{"ranked": …, "casual": …}`。这一栏的名字是「**ranked** 实时信息」，
 * 排行榜也是赛季排位榜 ⇒ 四格取的都是 `ranked` 那一个（混进 casual 会把两件不同的事
 * 加在一起，而 `loses` 那个数会凭空翻倍 —— 看起来完全正常）。
 * ⚠️ 全是 `| null`：**"这一格读不到"必须与一个真的 0 分得开**（本仓那条纪律）。
 *    ⚠️ 实测 `casual` 那一侧倒是有很多真 0（`{"ranked": 96, "casual": 0}`），
 *    那是 casual 真的 0 场 —— 我们不取它，也就不会把它的 0 印到 ranked 那一列上。
 */
export interface RankedPlayerRecord {
  wins: number | null;
  loses: number | null;
  playedMatches: number | null;
  /** ⚠️ **毫秒**（上游给的就是毫秒；实测 387772 ms = 6:27.772）。 */
  bestTimeMs: number | null;
}

/**
 * **一位玩家的汇总**（`/users/{identifier}` 里我们真正要的那几格）。
 *
 * ---------------------------------------------------------------------------
 * ★ 为什么这里只有五格（上游那份响应有 12 个顶层键）
 * ---------------------------------------------------------------------------
 * 用户要的是"展开后看得到这位玩家的数据"，而这一栏的语义是**ranked 排位**：
 * 拿得出手的就是"现在多少分 / 排第几 / 本赛季与历史战绩"这几样。
 * ⚠️★ 2026-09-19 修复轮（T4）删掉过 `seasonHighest`（`seasonResult.highest`）：
 *    它那时候**没有任何渲染点**、也没有对应的词条 ⇒ 一条没有消费者的数据通路
 *    （卡片上已经有 elo / 排名 / 本赛季战绩 / 本赛季最佳用时四样）。当时那句
 *    "想要的话加回来是**一个字段**"就是**这一次**（第四轮）：搜索到的玩家变成
 *    榜上的一行之后，"最高"与"阶段分"这两列**必须**有值 —— 否则它们只能印「—」，
 *    而"页面布局和排行榜玩家相同"（用户原话）就是一句空话。
 * ⚠️ 于是这一版有**两格**是给那一行用的（`seasonHighest` / `seasonPhasePoint`）：
 *    它们是**表格列**的数据来源，扫描点只有一处（`RankedEloView` 里那一行）。
 *    卡片（`.ranked__detailstats`）**不**印这两格 —— 那五格是另一件事
 *    （见下面 `RankedPlayerRecord` 与词条表），两处混用会让"卡片有几格"漂。
 * `achievements` / `connections` / `weeklyRaces` / `timestamp` / `roleType` / `country`
 * **不进这个形状** —— 不进 = 界面不可能顺手印出来，这一层不为它们写兜底
 * （要加的人请连着这一段的理由一起改，别只加一格）。
 * ⚠️ `uuid` 与 `nickname` 是**骨架**：没有身份的一份响应我们无法归属到任何一行
 *    （展开是按行发生的），所以读不到它们时 `parsePlayerDetail` 回 `null`（整份"读不到"）。
 * ⚠️★ `nickname` 取的是**响应里的那个**（上游回的是**规范写法**）：实测 `/users/voxio`
 *    回 `nickname: "Voxio"`、`/users/EDCR` 回 `"edcr"` ⇒ 搜索框必须**读回**这个值，
 *    而不是相信用户敲进去的那串大小写（findings §6 最后一段）。
 */
export interface RankedPlayerDetail {
  uuid: string;
  nickname: string;
  /** 未定级玩家实测就是 `null`（**是真实状态**，不是缺数据）。 */
  eloRate: number | null;
  eloRank: number | null;
  /**
   * ★★ 本赛季**最高** elo（`seasonResult.highest`）—— 搜索行第四列的数据来源。
   *
   * ⚠️★ 它**只有** `seasonResult` 有（那一份响应的外层没有这一格，实测），
   *    所以读法只有一条，没有"两处取哪个"的问题。
   * ⚠️ 与 `RankedEloEntry.highest`（榜上那一列）**同源同义**：两处都读
   *    `seasonResult.highest` ⇒ 同一个人在榜上与他被搜出来时，这一列印的是同一个数
   *    （这一条正是"两种行的布局相同"要的东西，也是它可被断言的地方）。
   */
  seasonHighest: number | null;
  /**
   * ★★ 本赛季**当前赛段**的积分（`seasonResult.last.phasePoint`）—— 搜索行第五列。
   *
   * ⚠️★★ 上游把它埋在两层的里面（`seasonResult.last.phasePoint`），而榜上那一列读的是
   *    `seasonResult.phasePoint`（`parseEloEntry`）—— **两个位置的证据在两处，别混着引**
   *    （2026-09-19 复评 I5 订正：这一段原来只引了账本 `ranked-round4/progress.md` 那一份
   *    `/users/{id}` 的 `seasonResult` 读数，而那一份里**根本没有**顶层的 `phasePoint`
   *    ⇒ 榜那一半的证据引错了地方）：
   *      · `/users/{id}` 那一半 ⇒ 账本 `ranked-round4/progress.md`（"搜索行那五列的数据来源"）
   *        里那份实测读数：`{"last":{…,"phasePoint":0,…},"highest":2385,…}` —— 埋两层里面；
   *      · `/leaderboard` 那一半 ⇒ `docs/ranked-live-spec.md` §2.3：实测"③ 前 150 名里
   *        `seasonResult` 的键**恒为** `{eloRate, eloRank, phasePoint, highest, phaseHighest}`"
   *        （顶层的 `phasePoint`，**没有** `last` 这一层）。
   *    ⚠️ 换位置之前先把这两处读数都看一遍：读错了的表现是**整列 0 或整列「—」**，
   *    而这两者都不是故障，没有任何门禁看得见。
   * ⚠️★ **同一个玩家在两处出现时，这一列必须是同一个数**（同一屏里可能两行同名：固定那一行
   *    从这一格印、榜上那一行从 `RankedEloEntry.phasePoint` 印）。两条解析路径读的是**两个
   *    不同位置**，所以"它们一致"不是天上掉下来的：`services/api/src/ranked-shared.test.ts`
   *    里有一条**跨端点**的联合断言（同一份夹具里的同一个人，两条路径必须给出同一个值）。
   *    ⚠️ 代价写清：那条断言证的是**我们两条读法**一致；"上游这两个端点对同一个人给的是不是
   *    同一个数"只能人打两次请求去对（`docs/pending.md §5.101`）。
   * ⚠️★ `0` 是**真的值**（赛季刚开始时整列都是 0，spec §2.3），缺才是 `null`
   *    ⇒ 解析层绝不许把 0 折成 `null`（那会让"这个赛段才刚开始"变成"我们没读到"）。
   */
  seasonPhasePoint: number | null;
  season: RankedPlayerRecord;
  total: RankedPlayerRecord;
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
