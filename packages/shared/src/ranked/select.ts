/**
 * 派生：排序、筛选、分批。
 *
 * ⚠️ 这里全是**纯函数**，而且**都不改入参**（每一次都 `[...]` 或 `slice`）。
 *    调用方（容器组件）手上那份数据要留着给"上次刷新失败了，下面是 N 秒前的数据"用
 *    （spec §6.6：**绝不清空**）—— 就地排序会把它悄悄改掉，而那种错**没有任何门禁能发现**
 *    （界面看着正常，只是顺序变了）。测试里有一条专门钉它。
 */
import { RANKED_ELO_TOP } from './const';
import type { RankedEloEntry, RankedLiveData, RankedLiveMatch } from './types';

/**
 * 相同 `avgElo` 时的第二判据：`key` **升序**。
 *
 * ⚠️ **相等必须返回 `0`**，不能返回 `1`（`a.key < b.key ? -1 : 1` 那种写法）：
 *    `1` 等于在说"a 排在 b 之后"，于是同一个比较器对同一对数**两边都说"在后面"** ——
 *    比较函数不再是反对称的，`Array.prototype.sort` 的契约被破坏（规范里那是未定义行为，
 *    实际结果随引擎、随数组长度变）。⚠️ 它不会抛错、不会印出 NaN，只会让并列那几场的顺序
 *    在某次刷新里换一下 —— 又一次"界面看着正常"的错，所以这里不能省。
 *
 * 否决了"相等时也返回 `1`（靠 sort 的稳定性兜底）"：稳定性保证的是"**不比较**的相等元素保持原顺序"，
 * 而返回 `1` 是在**主动**声明一个错误的顺序，两者不是一回事。
 */
function byKey(a: RankedLiveMatch, b: RankedLiveMatch): number {
  if (a.key === b.key) return 0;
  return a.key < b.key ? -1 : 1;
}

/**
 * 按**平均 elo 降序**排（筛选与分批**之前**先排这一次）。
 *
 * 三条口径（spec §6.3 冻结）：
 *   · `avgElo` 为 `null` 的排**最后** —— 未定级不该占榜首（两个人今天都没定级，不代表他们菜，
 *     但也不代表他们强；把它排进榜单是按"没有信息"当成"最高分"）；
 *   · 相同 `avgElo` 再按 `key` **升序** —— 这条让顺序**稳定**：两次刷新之间
 *     并列的几场不会换来换去（否则 React 会重建卡片、用户眼睛也会被晃）；
 *   · ⚠️ 返回的是**新数组**，入参一个字节都不动。
 */
export function sortLiveMatches(matches: RankedLiveMatch[]): RankedLiveMatch[] {
  return [...matches].sort((a, b) => {
    if (a.avgElo === null && b.avgElo === null) return byKey(a, b);
    if (a.avgElo === null) return 1;
    if (b.avgElo === null) return -1;
    if (a.avgElo !== b.avgElo) return b.avgElo - a.avgElo;
    return byKey(a, b);
  });
}

/**
 * ② 的**筛选条件**（三格都由容器持有，视图只吃 props —— 见 `RankedLiveViewProps`）。
 */
export interface RankedLiveFilters {
  /** 昵称搜索词（`ranked.liveSearch` 那个框里的字）。空串 / 只有空白 ⇒ 不筛。 */
  query: string;
  /** 只看**双方都在直播**的场次（`ranked.liveBothLive` 那颗开关）。 */
  bothLiveOnly: boolean;
  /** 已经显示几张卡片（容器从 `RANKED_LIVE_BATCH` 起，点一次「加载更多」加一批）。 */
  shown: number;
}

/**
 * ★ 「双方都在直播」的判据：**两侧的 `liveUrl` 都非 `null`**。
 *
 * ⚠️★ 判据是 `liveUrl`，**不是** `livePlatform`（用户 2026-09-19 的裁决：**任何平台都算**）：
 *    `livePlatform` 是"**我们认不认得出这个平台**"，认不出时是 `null`（kick 等，
 *    见 `types.ts` 那条注释）⇒ 拿它当判据会把"在 kick 上直播的人"整场藏掉，
 *    而用户要的是"两个人都开着播" —— 哪怕他开在哪个我们没见过的站上。
 *    ⇔ 白名单（`twitch`/`youtube`/`bilibili`）回答的是**能不能内嵌**（`embed.ts`），
 *    那是另一件事，两件事**故意**不共用一条判据。
 * ⚠️ 写成"两个下标都判"而不是 `players.every(...)`：`every` 对**空数组返回 `true`**
 *    （空集上"所有人都…"恒真），而这里的判据是"**恰好这两个人**都在播"。
 *    上游一直给两个玩家块（spec §2.3 第 4 条），但兜底方向必须是"缺一个就不算"。
 */
export function bothStreaming(match: RankedLiveMatch): boolean {
  return match.players[0].liveUrl !== null && match.players[1].liveUrl !== null;
}

/**
 * ★ 昵称搜索：**两侧任一**的昵称包含搜索词就算命中（子串、忽略大小写、忽略首尾空白）。
 *
 * ⚠️★ 用 `toLowerCase()`，不用 `toLocaleLowerCase()`：后者跟着**宿主 locale** 走
 *    （土耳其语环境里 `I` 会变成 `ı`），于是同一份数据在不同机器上筛出不同的结果 ——
 *    那正是这一栏反复躲开的那类"随机器漂"的错（`types.ts` 的 `checkedAt` 那条写着同一件事）。
 * ⚠️ 昵称是 `| null`（上游可能只给一个玩家块）⇒ 空位拿空串去比：它**永远匹配不上**
 *    一个非空的搜索词（**不是**"空位匹配一切"）。
 * ⚠️ 只搜**昵称**，不搜 `liveUrl`：搜索框的提示语说的是「搜索选手」，而地址里出现
 *    同一个词（`kick.com/whyip`）不代表那个选手在这场对局里 —— 搜出来的卡片刻的是
 *    另一个名字，用户只会觉得搜索坏了。
 */
export function matchesNickname(match: RankedLiveMatch, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return match.players.some((player) => (player.nickname ?? '').toLowerCase().includes(needle));
}

/**
 * ② 的筛选：两个条件是 **AND**（用户要求三件事可组合：搜索 + 双方都直播 + 分批）。
 *
 * ⚠️ 返回新数组（`filter` 本来就是新的），入参一个字节都不动 —— 与文件头那一段同一个理由。
 * ⚠️ 它**不排序**：排序只发生在 `sliceLiveMatches` 里那一次。在这里再排一遍会多出
 *    第二份"谁在前"的真相，而两份口径漂开时两边都"看着对"。
 */
export function filterLiveMatches(
  matches: RankedLiveMatch[],
  filter: Pick<RankedLiveFilters, 'query' | 'bothLiveOnly'>,
): RankedLiveMatch[] {
  return matches.filter(
    (match) =>
      (!filter.bothLiveOnly || bothStreaming(match)) && matchesNickname(match, filter.query),
  );
}

/**
 * ★★ ② 面板要的那一段：**总场次 / 筛后场次 / 这一帧渲染的场次 / 还剩几场**。
 */
export interface RankedLiveSlice {
  /** 上游给的**总场次**（不受筛选影响）—— 界面那句「共 N 场」用它。 */
  total: number;
  /** 通过筛选的场次（已按 `avgElo` 降序）。 */
  matched: RankedLiveMatch[];
  /** 真正要渲染的那一段（`matched` 的前 `shown` 张）。 */
  visible: RankedLiveMatch[];
  /** 还没渲染的场次（0 ⇒ 界面上**不该**有「加载更多」）。 */
  remaining: number;
}

/**
 * ★★ ② 面板的全部分段逻辑：排序 → 筛选 → 取前 `shown` 张。
 *
 * ---------------------------------------------------------------------------
 * ⚠️★ 为什么合成**一个**函数（而不是视图里自己 `filter` + `slice` 两下）
 * ---------------------------------------------------------------------------
 * 面板上那三处数字（「共 N 场」、「符合条件 M 场」、「加载更多（还有 K 场）」）与下面
 * 真的渲染出来的卡片**必须来自同一次计算**：分两处算迟早会渲染出"写着还有 3 场、
 * 其实已经全列出来了"的产物，而那种自相矛盾**没有任何门禁能发现**
 * （每一句都合法、每一格都有值 —— `RankedPanels.tsx` 文件头第 3 节是同一句话）。
 *
 * ⚠️ 排序仍然**只有这一次**（`sortLiveMatches`，口径与改版前逐字相同）：用户要的是
 *    "全都展示"，**不是**"换个顺序"。
 * ⚠️ 参数收的是**整份 `RankedLiveData`**（不是 `matches`）：`total` 也是从这里取的，
 *    分成两个参数会让调用方有机会把"总场次"传成"筛后场次"，而那正好就是上面要防的
 *    那种自相矛盾（界面写着"共 23 场"、列表却是筛过的 5 场，两个数都"有值"）。
 * ⚠️★ `shown` 是**张数**，负数一律夹成 0：`slice(0, -1)` 在 JS 里是"**从末尾往回数**"
 *    （= 除了最后一张），少的那张卡片在界面上看起来只是"这一场没了"，没有任何报错。
 *    容器今天只给 `RANKED_LIVE_BATCH` 与它的整数倍，但静默的错正是这一栏最贵的那一类。
 */
export function sliceLiveMatches(
  data: RankedLiveData,
  filters: RankedLiveFilters,
): RankedLiveSlice {
  const matched = filterLiveMatches(sortLiveMatches(data.matches), filters);
  const limit = filters.shown < 0 ? 0 : filters.shown;
  const visible = matched.slice(0, limit);
  return {
    total: data.matches.length,
    matched,
    visible,
    remaining: matched.length - visible.length,
  };
}

/**
 * ③ 排行榜取前 `n`（默认 `RANKED_ELO_TOP` = **150**；上游那份响应实测**就是** 150 条）。
 *
 * ⚠️★ `n = 150` **不是"我们只取前 150"**：上游 `/leaderboard` 本来就恒给 150 条，
 *    而且 `count` / `page` 两个参数被它**静默忽略**（实测：`?count=200`、`?count=1`、
 *    `?page=1&count=150` 与不带参数的响应**字节完全相同**）⇒ 第 151 行**拿不到**，
 *    所以界面上没有"下一页"，也没有"加载更多"（理由写在 `const.ts` 那个常量上）。
 *    这一层要拦的是**另一种**情况：上游哪天给得更多（文档从没承诺过 150 是永久的），
 *    那时表格的长度由这个数说了算，页面不会被撑爆。
 * ⚠️ **不重排**：上游已经按 `eloRank` 排好了，而"并列时该谁在前"本来就没有正确答案
 *    （上游自己也没给第二判据）。在这里重排只会引入一种新可能：
 *    我们的顺序与上游的顺序**不一致**，而两个都对 —— 那种分歧没有任何人查得清。
 * ⇒ 只截断。⚠️ 也不改入参（`slice` 本来就是新数组）。
 */
export function topEloEntries(users: RankedEloEntry[], n = RANKED_ELO_TOP): RankedEloEntry[] {
  return users.slice(0, n);
}
