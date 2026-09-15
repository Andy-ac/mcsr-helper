/**
 * 派生：排序、取前 N。
 *
 * ⚠️ 这里全是**纯函数**，而且**都不改入参**（每一次都 `[...]` 或 `slice`）。
 *    调用方（容器组件）手上那份数据要留着给"上次刷新失败了，下面是 N 秒前的数据"用
 *    （spec §6.6：**绝不清空**）—— 就地排序会把它悄悄改掉，而那种错**没有任何门禁能发现**
 *    （界面看着正常，只是顺序变了）。测试里有一条专门钉它。
 */
import { RANKED_ELO_TOP, RANKED_LIVE_TOP } from './const';
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
 * 按**平均 elo 降序**排，取前 10 前先排。
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
 * ② 面板要展示的那几场：排序后取前 `n`（默认 `RANKED_LIVE_TOP` = 10）。
 *
 * ⚠️ 参数收的是**整份 `RankedLiveData`**（不是 `matches`）：面板上还有一句
 *    「N 场里按平均 elo 取前 10」（`ranked.liveFrom`），那个 N 是 `matches.length`。
 *    分成两个参数会让调用方有机会把"总场次"传错成"取几场"。
 */
export function topLiveMatches(data: RankedLiveData, n = RANKED_LIVE_TOP): RankedLiveMatch[] {
  return sortLiveMatches(data.matches).slice(0, n);
}

/**
 * ③ 排行榜取前 `n`（默认 `RANKED_ELO_TOP` = 100；上游实测给 150 条）。
 *
 * ⚠️ **不重排**：上游已经按 `eloRank` 排好了，而"并列时该谁在前"本来就没有正确答案
 *    （上游自己也没给第二判据）。在这里重排只会引入一种新可能：
 *    我们的顺序与上游的顺序**不一致**，而两个都对 —— 那种分歧没有任何人查得清。
 * ⇒ 只截断。⚠️ 也不改入参（`slice` 本来就是新数组）。
 */
export function topEloEntries(users: RankedEloEntry[], n = RANKED_ELO_TOP): RankedEloEntry[] {
  return users.slice(0, n);
}
