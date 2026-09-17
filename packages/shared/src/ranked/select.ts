/**
 * 派生：排序、筛选、分批，以及**行内展开**（最近比赛那一栏）的四个判据。
 *
 * ⚠️ 这里全是**纯函数**，而且**都不改入参**（每一次都 `[...]` 或 `slice`）。
 *    调用方（容器组件）手上那份数据要留着给"上次刷新失败了，下面是 N 秒前的数据"用
 *    （spec §6.6：**绝不清空**）—— 就地排序会把它悄悄改掉，而那种错**没有任何门禁能发现**
 *    （界面看着正常，只是顺序变了）。测试里有一条专门钉它。
 */
import { RANKED_ELO_TOP } from './const';
import type {
  RankedEloEntry,
  RankedLiveData,
  RankedLiveMatch,
  RankedMatch,
  RankedMatchPlayer,
} from './types';

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

/*
 * ===========================================================================
 * ★★ 行内展开（用户 2026-09-19：「点开后能查看最近比赛的情况/数据等」）
 * ===========================================================================
 * 四个纯函数，一行一场比赛。全部以 `selfUuid` 为判据 —— 同一份比赛数据被两个玩家看时
 * 只有"我是谁"不同，形状不该有两份（`types.ts` 上写着同一句）。
 *
 * ⚠️★ **"他不在这一场里"必须与"他输了"分得开**：下面三个函数的第一条判据都是
 *    "`selfUuid` 在不在 `players[]` 里"。收起这一条的话，任何一个"上游把玩家块写坏了"
 *    的行都会显示成**他的败场**（`matchOutcome` 的兜底支就是 `'loss'`）——
 *    一个假的败场在一张战绩列表里看起来完全正常，而它会直接改掉用户对这位玩家水平的判断。
 */

/**
 * ★ 本地筛选：昵称**子串**、忽略大小写；空白/空串 ⇒ 原样返回（不筛）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️★ 它只筛**手上这 150 行**，因为上游**没有**任何搜索/前缀/自动补全端点
 * ---------------------------------------------------------------------------
 * findings §7：把 `openapi.yaml` 与文档页的端点表翻完，能查人的只有
 * `/users/{identifier}` 这一个，而且它是**精确匹配**（`lowk3y` 查不到 `lowk3y_`，
 * `Ranked%20Bot` 查不到 `[Ranked Bot]`）⇒ "打字就筛"这个交互**只能**在本地做。
 * ⚠️ 代价写清：打字筛出来的人**只可能是榜上那 150 位**（第 151 名打不出来）。
 *    要查榜外的人，唯一的入口是**回车精确查一位玩家**（那条路会直连上游）。
 *
 * ⚠️ 判据用 `toLowerCase()` 而**不是** `toLocaleLowerCase()`：后者跟着宿主 locale 走
 *    （土耳其语环境里 `I` → `ı`），于是同一份数据在不同机器上筛出不同的结果
 *    （`matchesNickname` 上写着同一条理由）。
 * ⚠️ `nickname` 是 `| null` ⇒ 拿空串去比：它**永远匹配不上**一个非空的搜索词
 *    （不是"空昵称匹配一切"）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️★ **不重排**（这一条是本函数的重点）
 * ---------------------------------------------------------------------------
 * 榜单的顺序是上游按 `eloRank` 排的，而那一列（第几名）就是上游给的那个数
 * （并列会重复、之后会跳号，`parse.ts` 里写着）。筛完之后**照原顺序**交出去，
 * 于是"第 3 行显示第 3 名"这件事永远成立；重排（比如把命中的排到前面）会让
 * 排名列与行序对不上 —— 而那种错**看起来像是上游的排名有问题**，没人会怀疑搜索框。
 *
 * ⚠️ 空白查询（含全空格）与空串都是"不筛"：连 `trim()` 都不做的实现会让
 *    "只打了个空格"变成"一个人都没有"（而输入框里那一眼看上去就是空的）。
 * ⚠️ 两个分支都返回**新数组**（文件头那条规矩：不改入参、一律 `[...]` / `slice`）：
 *    调用方那份 `users` 要留着给"上次刷新失败了，下面是 N 秒前的数据"用，
 *    而且返回值会被调用方接着 `slice` / 映射 —— 交出同一个引用等于把两份数据绑在一起。
 */
export function filterEloUsers(users: RankedEloEntry[], query: string): RankedEloEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...users];
  return users.filter((user) => (user.nickname ?? '').toLowerCase().includes(needle));
}

/**
 * ★ 那一场的**对手**：`players[]` 里 `uuid` 不等于 `selfUuid` 的那一位。
 *
 * ⚠️★ 判据**先看他在不在场**（与 `matchOutcome` 同一条顺序，理由写在那里）：
 *    他不在 `players[]` 里时回 `null` —— 而不是"顺手把第一个别人当成他的对手"。
 *    后者会在一行"上游把玩家块写坏了"的数据上，把一个**陌生人**印成他的对手，
 *    而那个名字看起来完全正常（用户只会以为这一场真有个对手）。
 * ⚠️ 只有他自己（1 人的行，实测 26/100 —— forfeit / bot 局）⇒ `null`（没有对手）。
 * ⚠️ 返回值里那个 `eloRate` 是**现值**、不是那一场的值（`types.ts` 的红线）⇒
 *    调用方拿它当"对手现在多少分"渲染，而不是"当时多少分"。
 */
export function opponentOf(match: RankedMatch, selfUuid: string): RankedMatchPlayer | null {
  if (!match.players.some((player) => player.uuid === selfUuid)) return null;
  return match.players.find((player) => player.uuid !== selfUuid) ?? null;
}

/**
 * ★ 这一场的结果三态 + 一档"读不到"：`'win' | 'loss' | 'draw' | 'unknown'`。
 *
 * ---------------------------------------------------------------------------
 * ★★ 判据顺序：**先问"他在不在这场里"，再看结果**（这一条是自己裁决的）
 * ---------------------------------------------------------------------------
 * 另一半写法（先看 `result.uuid` 是不是 `null` ⇒ 平局）有一个具体的坏下场：
 * 当 `selfUuid` **不在** `players[]` 里时，那一行会被说成"他打平了"——
 * 而"他打平了"与"我们读不懂这一行的玩家块"是两件事，前者是一件我们**并不知道**的事。
 * ⇒ 顺序是：**人不在场 ⇒ `'unknown'`（先）**；在场才谈结果（平局 / 赢 / 输）。
 *   · 这一条同时也是"三态之外为什么要有第四档"的理由：`'unknown'` 说的既不是赢也不是输，
 *     而是"这一行与这个人对不上，别拿它当证据"。
 * ⚠️ 第四档**不是**死代码：`parseMatches` 会丢掉"玩家块读不出来"的行，所以正常情况下
 *    他一定在场；但 `RankedMatch` 是导出的类型，别的调用点（比如将来的对阵页）
 *    可以直接拿一份手写的比赛来问 —— 那时这一档就是唯一的诚实答案。
 * ⚠️ `result.uuid === null` 是**平局**（上游的写法，实测 3/100 行）。
 *    它之所以能这么读，是因为 `parseMatches` 把"整份没有 `result`"的行丢掉了
 *    （否则 `null` 会同时表示"平局"与"读不到"，见那里那条注释）。
 */
export function matchOutcome(
  match: RankedMatch,
  selfUuid: string,
): 'win' | 'loss' | 'draw' | 'unknown' {
  if (!match.players.some((player) => player.uuid === selfUuid)) return 'unknown';
  if (match.result.uuid === null) return 'draw';
  return match.result.uuid === selfUuid ? 'win' : 'loss';
}

/**
 * ★ 这一场这位玩家**涨/跌了多少分**；读不到 ⇒ `null`（**不是 0**）。
 *
 * 两个"读不到"的来源，都是**实测**的：
 *   · 私人房（type 3）的 `changes[]` 恒为空数组（32/32 行）⇒ 找不到他那一条记录；
 *   · `change` 本身可能是 `null`（上游文档：placement 定级赛如此 —— `DOCUMENTED, NOT MEASURED`，
 *     100 行实测里没有一行是 placement）。
 * ⇒ 两种都回 `null`，界面印「—」。**绝不回 0**：`0` 的意思是"打了这一场，分数没变"，
 *   而那与"这一场我们读不到分数变化"是两句完全不同的话 —— 后者才是真的。
 * ⚠️ 赛**前**的值只能靠 `changes[].eloRate - changes[].change` 推，`select.ts` **不算**它：
 *    私人房那 32 行推不出来，算法会在那些行上凭空造一个数（`types.ts` 上写着同一件事）。
 */
export function eloChangeOf(match: RankedMatch, selfUuid: string): number | null {
  const entry = match.changes.find((change) => change.uuid === selfUuid);
  return entry?.change ?? null;
}
