/**
 * Ranked 实时信息（`/ranked/*`）—— **容器**：取数、轮询、可见性、旧数据保留。
 *
 * ===========================================================================
 * ⚠️★ 这个文件里**没有界面**
 * ===========================================================================
 * 四个面板与标签页全在 `components/RankedPanels.tsx` 里（那条拆分的来由写在那个文件头上）。
 * 一句话：`apps/web` 没有测试运行器，而这一栏唯一的自动化断言是渲染自检
 * （`renderToStaticMarkup` —— **不跑 effect、不点击、不发请求**）⇒ 写在容器里的任何一块
 * 在自检里**永远停在"加载中"**，一个字都断言不到，而一条**不可能红**的守卫比没有守卫更坏
 * （`docs/pending.md §5.63`；`routes/ShareBoard.tsx` 的文件头是同一句话）。
 * ⇒ 这里只有：取数、轮询、可见性、`<RankedTabBar/>` 一次 + 四个面板里的**一个**。
 *
 * ===========================================================================
 * ★★ 七条冻结规则（spec §5.1 / §6.1 / §6.5），逐条都在这个文件里有落点
 * ===========================================================================
 *   1. **只有当前 `tab` 取数**：另外三个视图**根本不挂载** ⇒ 一次只有一路定时器；
 *   2. 间隔取 `RANKED_POLL_MS[tab]`（15s / 10s / 60s / 60s），**不写第二份字面量**；
 *   3. `status` 一轮打两次：我们的 `/api/ranked/status`（心跳）+ 直连 `/live`（人数）；
 *   4. `weekly` 在**历史周**完全不轮询（那些数据不会再变；省的是访客自己的额度）；
 *   5. 页面不可见时停；回到前台**推时钟 → 立刻刷一次 → 再起定时器**（三个动作）；
 *   6. 失败**绝不清空**：只有成功才替换 `loaded`，失败只记一句 `error`；
 *   7. 每次成功都记 `atMs = Date.now()`，「N 秒前更新」与「N 秒前的数据」都由它现算。
 *
 * ===========================================================================
 * ⚠️★ 取数 / 本地时钟 / 定时器是三件互不相干的事，必须住在**不同**的 effect 里
 * ===========================================================================
 * 定时器那个 effect 的依赖里**不许有每秒变的 `nowMs`**：依赖一变 effect 就重来一次
 * （清掉定时器、再起一个新的），而它的表现是**每秒发一次请求** ——
 * 画面上完全正常（数据照样是新的），**没有任何门禁看得见**。
 * ⇒ 形状照 `routes/ShareBoard.tsx`：`load` 是 `useCallback`，依赖里只有
 *   "换页才会变"的东西（`tab` / `weekId`）与两个身份稳定的东西
 *   （`errorText` 是 `useCallback([t])`，`rememberLatest` 是 `useCallback([])`）。
 *   否决了"把 `load` 写成组件里的普通函数再放进依赖"：那样它每次渲染都换身份，
 *   等于每秒重建一次定时器，而且**表现与上面那种错一模一样**。
 *
 * ===========================================================================
 * ★★ 旧数据**一个字都不清**（规则 6 的两半现在都在这里）
 * ===========================================================================
 * 失败时不清（旧数据 + 一句话 + 重试，spec §6.6 第 4 行）；
 * 换 tab / 翻页时也**不清** —— 2026-09-16 的终审改过一次（原先有一个"换页就清"的 effect）：
 *   · 判据是 `Loaded.key`（数据自己带着"我是哪一页的"，`mine()` 只认**相符**的那一份）
 *     ⇒ 换页那一瞬间旧数据**画不出来**（新页面拿到的是 `null` ⇒ 「加载中」），
 *     "几分钟前那一份被当成刚取到的"这种串台在结构上就不可能发生；
 *   · 于是那个 effect 只剩**副作用**：回到一个刚刚看过的标签页时，把手上那份好数据扔掉
 *     ⇒ 闪一下「加载中」；而如果这一次刷新又失败，用户看到的是"失败 + 没有旧数据"，
 *     **与 §6.6 的「绝不清空」正好相反**（那份好数据本来还在手上）。
 *   ⇒ 它被删掉了（不是"忘了写"）：不清空这件事现在**只有** `key` 一条判据。
 */

import {
  parseWeekInput,
  RANKED_LIVE_BATCH,
  RANKED_POLL_MS,
  type RankedEloData,
  type RankedLiveData,
  type RankedPhaseData,
  type RankedStatusResponse,
  type RankedTab,
  type RankedWeeklyData,
  secondsAgo,
  weekPath,
} from '@mcsr/shared/ranked';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import {
  type RankedChromeProps,
  type RankedDetailData,
  type RankedDetailState,
  RankedEloView,
  RankedLiveView,
  type RankedLookup,
  type RankedSeedState,
  type RankedSeedStates,
  RankedStatusView,
  RankedTabBar,
  RankedWeeklyView,
  WEEK_INPUT_ERROR_KEYS,
} from '@/components/RankedPanels';
import { fetchRankedStatus, fetchSeedByMatchId } from '@/lib/api';
import { useApiErrorText } from '@/lib/auth';
import {
  fetchRankedElo,
  fetchRankedLive,
  fetchRankedMatches,
  fetchRankedPhase,
  fetchRankedUser,
  fetchRankedWeekly,
  RankedLookupError,
} from '@/lib/rankedDirect';
import { describeRankedError } from '@/lib/rankedErrors';
import { describeSeedQueryError } from '@/lib/seedErrors';
import { NotFound } from '@/routes/NotFound';

/** 本地计时的一拍（与 `routes/ShareBoard.tsx` 的 `TICK_MS` 同一条；「N 秒前更新」靠它往前走）。 */
const TICK_MS = 1_000;

/**
 * ★ 展开一位玩家时，要**最近几场**比赛（`?count=N`）。
 *
 * ⚠️★ 上游对这个参数是**硬校验**的（findings §1.2）：合法区间 1..100、默认 20，
 *    而 `0` / `-1` / `101` / `abc` 一律 **400**（body 里带着 "Too small" / "Too big" /
 *    "Must be an integer"）⇒ 这个数**不能**靠猜，也不能由用户输入。
 * ⚠️ 选 10 的两条理由：① 卡片是**行内展开**，十来场一屏放得下；② `count` 只改这一份
 *    响应的大小、**不改请求次数** —— 所以它省的是"这一份响应多大"，不是额度
 *    （额度是按**请求次数**算的：文档 "500 requests per 10 minutes"，findings §5.1）。
 *    ⇒ 真正的取舍是"最近"这个词：10 场足够说明他最近的状态。
 * ⚠️ 写在这里而不是 `const.ts`：它是**这一屏**的产品口径（那一栏的常量都是上游给的
 *    契约值），跟着视图一起改才不会漂。
 */
const RANKED_DETAIL_MATCHES = 10;

/**
 * 一份**盖了页章**的东西：`data` 是**哪一页**的（`key`）。
 *
 * ⚠️★ 这一层存在的理由见下面 `mine()`：判断"这东西属于不属于当前这一页"在**全文件**里
 *    只能有一处实现（两处会漂，而漂掉的表现是"数据/界面出现在不属于它的那一页上"）。
 * ⚠️ 分出一个更薄的 `Held`（而不是一律用 `Loaded`）是因为 ③ 那三格**交互状态**
 *    （搜索词 / 那一次查询 / 展开的那一位）也属于某一页、也要盖同一个章，但它们
 *    **没有**"什么时候取到的"这回事 —— 塞一个没人读的 `atMs` 进去只会让下一个人以为
 *    它们也要进 `shownAtMs`（那个算式回答的是"手上这份数据有多旧"）。
 */
interface Held<T> {
  key: string;
  data: T;
}

/**
 * 成功取到的那一份数据 + 它是**哪个面板/哪一周**的（换 tab / 翻页时不能串台）。
 *
 * ⚠️★ `key` 不是装饰：`/ranked/status` 与 `/ranked/live` 是**同一个组件**的两条路由，
 *    而 react-router 在两条**兄弟路由之间**切换时**不会重新挂载** —— 元素树每一层的类型
 *    都一样，React 按"同类型就地更新"处理，state 是**留着的**（`routes/ShareBoard.tsx`
 *    的 `LoadedBoard` 逐字写着这件事）。只存响应体的话，切过去那一瞬间
 *    `live` 里还是上一个面板/上一周的数据，而它会**原样渲染在新面板上**。
 *    存上 key、只渲染相符的那一份之后，"串台"在结构上就不可能发生 ——
 *    不依赖上面那条路由行为将来变不变。
 */
interface Loaded<T> extends Held<T> {
  atMs: number;
}

/**
 * 这一份数据属于**哪一页**。
 *
 * ⚠️ 周赛要带上周号：`/ranked/weekly`（本周）与 `/ranked/weekly/102`（历史周）是**同一支**
 *    面板、同一个路由组件，翻页时只有参数变 —— 不带周号的话，翻页那一瞬间旧的一周
 *    会顶着新 URL 画出来（周数、种子、榜单全是上一周的）。
 * ⚠️ "本周"用 `latest` 这个**字面量**而不是它当前的周号：请求"本周"时我们还不知道
 *    响应会回第几周（`parseWeekly` 取的是响应里的 `data.id`），拿一个还没到的数字做 key
 *    等于每次都换一把钥匙（每次成功都把自己判成"不属于这一页"）。
 */
function pageKey(tab: RankedTab, weekId: number | undefined): string {
  return weekId === undefined ? tab : `${tab}:${String(weekId)}`;
}

/**
 * 是不是**我们自己**取消的（换 tab / 翻页 / 卸载）。
 *
 * ⚠️ 取消不是失败，必须与失败分开：混在一起的话，用户切一下标签页就会看到
 *    「读不到数据」+ 重试，而他什么都没做错。
 * ⚠️ 判据用**名字**（`rankedDirect.ts` 的 `isCallerAbort` 是同一条）：abort 抛的是
 *    `DOMException`，而它是不是同时 `instanceof Error` 在各运行环境里并不一致 ⇒ 两种都认。
 */
function isAbort(error: unknown): boolean {
  return (error instanceof DOMException || error instanceof Error) && error.name === 'AbortError';
}

/**
 * 只认**属于当前这一页**的那一份（`key` 相符），否则当作"还没取到"。
 *
 * ⚠️ 传 `null` 与"取到了但那一格是 `null`"在这里是**同一个结果**（都返回 `null`），
 *    而这是对的：视图对这两种情况说的话本来就一样（① 的人数那一格是
 *    「—」+「人数暂时读不到」，spec §6.2）。
 * ⚠️★ 入参是更薄的 `Held`（不是 `Loaded`）：③ 那三格**交互状态**也走这一个判据
 *    （"换页就重置"在那一栏里就是这么做的，见 `eloSearch` 那一段）—— 判据只有一处，
 *    两种持有者（取到的数据 / 用户的交互状态）共用它。
 */
function mine<T>(held: Held<T> | null, key: string): T | null {
  return held !== null && held.key === key ? held.data : null;
}

/**
 * 容器（`tab` 由路由给，`weekId` 只有 `/ranked/weekly/:id` 那一条会给）。
 *
 * ⚠️ 它**不需要** `useAuth()`：这一栏是**公开**的（spec §7.1 的那条线在这里不存在），
 *    所以它比 `routes/ShareBoard.tsx` 少一整块"谁登录着"的判断。
 */
export function Ranked({ tab, weekId }: { tab: RankedTab; weekId?: number }) {
  const { t } = useTranslation();
  const errorText = useApiErrorText();
  const navigate = useNavigate();

  /** ① 我们的端点（心跳）。`null` = 这一页还没成功取到过。 */
  const [heartbeat, setHeartbeat] = useState<Loaded<RankedStatusResponse> | null>(null);
  /** ① 的人数（直连 `/live`）。★ 与 `heartbeat` **各留各的旧数据**（两路可以单独失败）。 */
  const [players, setPlayers] = useState<Loaded<number | null> | null>(null);
  /** ② 的高分对局（直连 `/live`）。 */
  const [live, setLive] = useState<Loaded<RankedLiveData> | null>(null);
  /** ③ 的排行榜（直连 `/leaderboard`）。 */
  const [elo, setElo] = useState<Loaded<RankedEloData> | null>(null);
  /**
   * ★ ③ 的**赛段**（直连 `/phase-leaderboard`，2026-09-19 加）。
   * ⚠️ 它与 `elo` 各来各的、各留各的旧数据：那一路失败时这里是 `null`，
   *    而整张榜照常渲染（`RankedEloView.phase` 上写着这件事）。
   */
  const [phase, setPhase] = useState<Loaded<RankedPhaseData> | null>(null);
  /** ④ 那一周的榜单（直连 `/weekly-race{,/{id}}`）。 */
  const [weekly, setWeekly] = useState<Loaded<RankedWeeklyData> | null>(null);
  /** 最新一周的周号（只从"本周"那一次响应里学到）。`null` = 还不知道。 */
  const [latestId, setLatestId] = useState<number | null>(null);
  /** 取数失败时那句话（**已经翻好**）。⚠️ 它与上面五个 `loaded` 是两件事：失败不动它们。 */
  const [error, setError] = useState<string | null>(null);
  /** ★ 本地时钟的读数，**每秒**推进一次（「N 秒前更新」靠它，**不发请求**）。 */
  const [nowMs, setNowMs] = useState(() => Date.now());
  /** 有一轮取数在飞 —— 决定重试键是否可点。 */
  const [busy, setBusy] = useState(false);

  /*
   * ★★ ② 那一栏的三格**交互状态**：搜索词 / 「只看双方都在直播」/ 已经显示几张卡片。
   *
   * ---------------------------------------------------------------------------
   * ⚠️★ 为什么它们住在**容器**里，而不是 `RankedLiveView` 自己的 `useState`
   * ---------------------------------------------------------------------------
   * 文件头那条"这个文件里没有界面"说的是**标记**（元素、类名、文案），不是状态：
   * 这三格没有别的地方可放 —— 视图必须保持"只吃 props 的纯视图"，因为这一栏唯一的
   * 自动化断言是渲染自检，而 `renderToStaticMarkup` **不跑 effect、不点击、不打字**。
   * 状态住在视图里的话，自检能看到的**只有初始值**（空搜索词 + 开关关着 + 首批），
   * 于是"筛出一场"「双方都直播只剩那一场」「还有 7 场」这三件真正会出错的事
   * **一个字都断言不到**（`RankedLiveViewProps` 上写着完整理由）。
   * ⚠️ 它们与上面那七个 `useState` **不是一类**：上面那一批是"这一页取到了什么数据"
   *    （失败不清、按 `page` 盖章），这三格是"用户现在想看什么"（与请求无关，一个
   *    字节都不发出去 —— 筛的是手上**已经取到**的那份数据）。
   *
   * ⚠️★ 换 tab / 翻页时**不清空**这三格（这里没有那样的 effect，是**有意**的）：
   *    · 它们不影响取数（规则 1 仍然是"只有当前这一页取数"），所以留着不会串台；
   *    · "加载更多"是用户**明确要求**过的决定（"再多给我几场"），切一下标签页回来
   *      就把它收回，等于让用户重复点一遍；
   *    · 而"回来时搜索框还留着上次那个词"是**看得见**的：他随时可以清掉，
   *      清掉之后列表自己就回来了（切片会跟着新的条件重算）。
   *    ⚠️ 反过来（换页就清）需要一条 effect，而 effect 的依赖一旦写错就会安静地
   *    多跑几次 —— 为一件"用户看得见、自己改得回来"的事付那个代价不值得。
   */
  const [liveQuery, setLiveQuery] = useState('');
  const [liveBothOnly, setLiveBothOnly] = useState(false);
  const [liveShown, setLiveShown] = useState(RANKED_LIVE_BATCH);

  /*
   * ★★ ④ 那两格（2026-09-19 用户要求的手输跳转）：框里的字 + 上一句判定的结果。
   *
   * ⚠️★ 它们与上面那七个 `loaded` **不是一类**（与 ② 那三格同一条）：上面那一批是
   *    "这一页取到了什么数据"，这两格是"用户正在打什么、我们上一句说了什么"。
   *    ⚠️ `weekError` 存的是**已经翻好的那句话**（`WEEK_INPUT_ERROR_KEYS` → `t()`），
   *    而不是一个 reason 码：视图是纯视图（不吃 `t` 之外的东西），
   *    而"哪一档说什么"这件事由容器一次做完（渲染自检用 `weekError` 直接喂两句话）。
   * ⚠️ 换 tab / 翻页时**不清空**（这里没有那样的 effect，与 ② 三格同一条理由）：
   *    翻到第 95 周时框里还留着"95"是**看得见**的，而清空需要一条 effect，
   *    effect 的依赖写错会安静地多跑几次 —— 为一件用户看得见、自己改得回来的事不值得。
   */
  const [weekInput, setWeekInput] = useState('');
  const [weekError, setWeekError] = useState<string | null>(null);

  /**
   * 正在飞的那一轮取数。
   *
   * ⚠️ 它存在的理由与 `routes/ShareBoard.tsx` 那个同名 ref 相同：卸载 / 换 tab / 翻页时
   *    要把它停掉，否则一个已经不属于任何人的响应回来照样 `setState`
   *    （界面上就是"刷新之后数据反而变旧了"—— 两个响应乱序落地）。
   */
  const inflight = useRef<AbortController | null>(null);

  /**
   * ★ 最新周号的**第二份记录**，只给 `load` 做判断用（界面那一份是 `latestId`）。
   *
   * 为什么不让 `load` 直接用 `latestId`：那就要把它写进 `load` 的依赖，
   * 于是每次学到最新周号（`null` → `103`）`load` 都会换一次身份 ⇒ 定时器那个 effect
   * 重跑一次 ⇒ **紧接着多发一轮请求**（`/ranked/weekly` 每打开一次就白打一发
   * `/weekly-race`，而那是一条最常走的路）。ref 不进依赖，所以它不会引起任何重跑。
   * ⚠️★ 两处**必须一起写**（只走 `rememberLatest` 这一个入口）：分开写就会漂，
   *    而漂掉的表现是"刷新过的历史周又开始轮询了"—— 画面上完全看不出来。
   */
  const latestIdRef = useRef<number | null>(null);

  /** 记住最新周号：state 给界面（「下一周」能不能点），ref 给 `load`（要不要轮询）。 */
  const rememberLatest = useCallback((id: number): void => {
    latestIdRef.current = id;
    setLatestId(id);
  }, []);

  /**
   * 这一页的标识（`tab`，周赛再带上周号）。
   *
   * ⚠️★ 全文件**只算这一个**：`load` 用它给每一份数据盖章、渲染用它挑出"属于这一页"的那几份。
   *    两处各写一遍 `pageKey(...)` 的话，
   *    改 key 的形状（比如某天给 ③ 也带上赛季号）时只会改到一处，
   *    而漏掉的那处的表现是"数据永远被判成不属于这一页"—— 面板**永远停在加载中**。
   */
  const page = pageKey(tab, weekId);

  /**
   * ★★ ③ 的三格**交互状态**（2026-09-19：用户要的「回车查人」与「点开看最近比赛」）。
   *
   * ---------------------------------------------------------------------------
   * ⚠️★ 为什么它们住在**容器**里，而不是 `RankedEloView` 自己的 `useState`
   * ---------------------------------------------------------------------------
   * 与 ② 那三格、④ 那两格同一条：这一栏唯一的自动化断言是渲染自检，而
   * `renderToStaticMarkup` **不跑 effect、不点击、不打字** ⇒ 状态住在视图里的话，
   * 自检能看到的**只有初始值**（空搜索词、没查过、没展开），于是"筛出来几行"
   * 「查不到那个人」「展开出来三场比赛」这三件真正会出错的事**一个字都断言不到**
   * （`RankedEloViewProps` 上写着完整理由）。
   *
   * ---------------------------------------------------------------------------
   * ★★ 「换页（换 tab / 换周）时跟着重置」是**盖章**做的，不是一条清空的 effect
   * ---------------------------------------------------------------------------
   * 它们与 `Loaded` 是**同一档次**（属于某一页）⇒ 盖同一个页章、读的时候过同一个
   * `mine()`（本文件里"属于这一页吗"**只有那一处判据**）：
   *   · 别的页面上它们**一个字都不渲染**（`mine()` 回 `null`）；
   *   · 换页那一刻已经在飞的那两次请求由下面那条 `[page]` 的 effect 取消掉。
   * ⚠️★ 否决了"用一条 effect 在换页时 `setX(null)` 清空"：effect 在渲染**之后**跑
   *    ⇒ 换页后的**第一帧**会把上一页的查询结果/展开卡片画出来（一帧的串台），
   *    而"为这件事再发明一条 effect"正是文件头在防的事（本文件里那条被删掉的
   *    "换页就清空"也正是这个形状）。
   * ⚠️ 代价（写清，免得下一个人以为漏了）：换回刚看过的那一页时，这三格**还在**
   *    （与 `loaded` 的旧数据同一条口径 —— 文件头那段写着"回到一个刚看过的标签页时，
   *    上面已经画着的东西不会被自己抹掉"）。它们是用户**看得见、自己也改得回来**的
   *    （清掉搜索框、再点一下收起），所以不值得为它付一条 effect 的代价。
   */
  const [eloSearch, setEloSearch] = useState<Held<string>>({ key: page, data: '' });
  /** 那一次精确查询（`null` = 这一页还没查过）。 */
  const [eloLookup, setEloLookup] = useState<Held<RankedLookup> | null>(null);
  /** 正在展开的那一位（`null` = 没有展开）。 */
  const [eloDetail, setEloDetail] = useState<Held<{
    nickname: string;
    state: RankedDetailState;
  }> | null>(null);

  /**
   * ★★ ③ 的**第四格**状态（2026-09-19 第四轮）：每一场比赛的种子，按 `String(matchId)` 存。
   *
   * ---------------------------------------------------------------------------
   * ⚠️★ 它为什么与前两格是**同一种持有者**（`Held` + 同一个 `mine()`）
   * ---------------------------------------------------------------------------
   * 前两格是"用户查了谁 / 点开了谁"，这一格是"用户点开了哪几场、那几场读到了什么"。
   * 三者都不是"这一页取到了什么数据"（那一批是 `Loaded`，还带 `atMs`），但**都属于某一页**：
   * 换到别的标签页之后，`mine()` 让它们一个字都不渲染，而"属于不属于这一页"在全文件里
   * **只有那一处判据**（两份判据会漂，漂掉的表现是"上一页点开的那一场在别的页上还开着"）。
   *
   * ⚠️★ 它是**一格记录**（不是"当前点开的那一场"）：用户可以点开 A 再点开 B，
   *    而 A 的面板**留着**（那是他自己的决定，收回去等于让他重复点一遍）。
   *    代价写清：一发同时只有一发在飞（下面 `seedInflight` 只留一个句柄），
   *    所以点开 B 会把 A 那一发取消掉 —— 而**取消的那一格会被收掉**（见 `abortSeed`），
   *    它不会永远停在「加载中」（那正是 2026-09-19 终审 Critical 1 的形状）。
   */
  const [eloSeeds, setEloSeeds] = useState<Held<RankedSeedStates> | null>(null);

  /** 搜索框里的字（**只**认属于这一页的那一份；别的页面上回空串 ⇒ 不筛）。 */
  const searchText = mine(eloSearch, page) ?? '';
  /** 那一次精确查询的结果（属于这一页的那一份）。 */
  const lookup = mine(eloLookup, page);
  /** 正在展开的那一位（属于这一页的那一份）。 */
  const detail = mine(eloDetail, page);
  /** 那几场比赛的种子（属于这一页的那一份）；`null` = 这一页还没点开过任何一场。 */
  const seeds = mine(eloSeeds, page);

  /**
   * ★ 点击触发的**两次**请求各自的在飞句柄（查人 / 展开）。
   *
   * ⚠️★ 与上面那个轮询用的 `inflight` **不能共用**：那一趟每次 `load()` 都会 abort
   *    上一个 controller（60 秒一次的轮询也是），共用的话一次轮询就会把用户刚点开的
   *    抽屉掐掉（画面上是"卡片一直转圈"）。两件事各管各的。
   */
  const lookupInflight = useRef<AbortController | null>(null);
  const detailInflight = useRef<AbortController | null>(null);

  /**
   * ★★ 展开**成功过**的那几位（按昵称缓存）。
   *
   * ⚠️★ 上游限流 500 次/10 分钟（文档原话 "500 requests per 10 minutes"；每个响应都带
   *    `RateLimit-Policy: "500-in-10min"; q=500; w=600; pk=:…:`，findings §5.1/§5.2），
   *    而"点开一个人"是**两发**请求（`/users/{id}` + `/users/{id}/matches`）
   *    ⇒ 同一个人点开三次 = 六发请求，全是**白打的**（spec §3 代价 2）。
   *    ⚠️★ **限的是"谁"是推断、不是实测**：那个 `pk=…` 只证明"配额**分了区**"，
   *    证不出那把钥匙是 IP、账号还是全局；文档一个字都没说（findings §7 把这条
   *    **明确列为 NOT VERIFIED**，理由是从一台机器上测不出来）。
   *    这里按**每个访客自己**算，取的是**最宽松**的那一支（对"额度还剩多少"来说这是最
   *    **乐观**的读法）：真要按账号或全局算，这一栏花的还是同一个上限、而且那份上限还要
   *    和服务器自己以及其他访客**分** ⇒ 这条缓存省下的额度**只多不少**
   *    （方向照旧是对的：少发请求在任何一种分区下都是安全的那一边）。
   *    ⚠️ 代价写清：万一上游其实是按**账号**分区的，"这份缓存省下的是访客自己的额度"
   *    这句话就是错的（省的是**我们全体访客共享**的那一份）。这条推断**没验过**，
   *    记在 `docs/pending.md §5.100`。
   * ⚠️ 那份响应的 `cache-control: max-age=14400`（4 小时）被我们**刻意绕过**
   *    （`rankedDirect.ts` 文件头 ①：不绕开的话面板会冻在 4 小时前那一份上），所以
   *    浏览器**不会**替我们省这一发；至于 Cloudflare 边缘命中缓存时算不算一次额度，
   *    findings §5.4 **没有量出来**（`r` 在 HIT 上不动）⇒ 不拿它当免费额度。
   * ⚠️★ **失败不进缓存**：否则"读不到"就永远读不到了（再点一次本该是一次重试）。
   *    缓存里只放 `{ user, matches }` 这种**成功**的结果，键是**昵称**。
   * ⚠️ 换页**不清**它（与 `loaded` 的旧数据同一条）：它是"这位玩家的数据我们已经拿到过"
   *    这个事实，不属于任何一页。
   */
  const detailCache = useRef(new Map<string, RankedDetailData>());

  /**
   * ★★ 种子的两件家什（2026-09-19 第四轮）：一发在飞 + 一张**会话内**的答案缓存。
   *
   * ---------------------------------------------------------------------------
   * ⚠️★ 为什么还要自己缓存：服务端已经缓存 1 小时了
   * ---------------------------------------------------------------------------
   * 服务端那 1 小时缓存省的是**上游**那一跳（种子值本身永远不变），而**访客自己那一发**
   * 请求照样发出去。`GET /api/ranked-seeds/*` 上挂着 `upstreamGate`：全局 5 次/秒 +
   * **每 IP 20 次/分钟**（账本 `ranked-round4/progress.md` 的限流那一行）。
   * 一张十场的卡片挨个点开就是十发 —— 收起再点开又是十发，而**两次的答案一模一样**。
   * ⇒ 缓存的是"这一场我们已经问过了"，键与状态记录**同一把**（`String(matchId)`）：
   *   两处各写一种键（一处 `String`、一处数字）迟早会漂，而漂掉的表现是"缓存永远不命中"
   *   —— 画面上完全看不出来（只是额度在掉），与 `latestIdRef` 那条同一种形状。
   *
   * ⚠️★ 只有 `ready` 与 `not_found` 进缓存：前者的种子值永远不会变，后者是**上游的确定回答**
   *    （"这场不在库里"重试一万次还是这个答案）。
   * ⚠️★ `failed` **绝不进缓存**：它是"这一次没读到"（网络抖动 / 429 / 上游 502），
   *    不进缓存 ⇒"再点一次"就是一次**重试**。把它也缓存起来的话，一次抖动会变成
   *    "这一场永远读不到"，而且界面上与真的不在库里长得一模一样。
   * ⚠️ 换页**不清**它（与 `detailCache` 同一条）：这是"这一场我们已经问过了"这个事实，
   *    不属于任何一页；而它省下的正是访客自己的配额。
   */
  const seedCache = useRef(new Map<string, RankedSeedState>());

  /**
   * ★★ 种子那一发**正在飞**的请求（连同它属于哪一场）。
   *
   * ⚠️★ 与另外三个 `*Inflight` 一样不能共用：共用的话一次轮询会把用户刚点开的种子面板掐掉。
   * ⚠️★ 它多带了 `key`（另外三个只存 controller）：取消之后**必须知道要把哪一格收掉**
   *    （`abortSeed` 里那条，与 2026-09-19 终审 Critical 1 的修法同一件事）——
   *    只知道 controller、不知道它属于谁的话，收回来的状态就没有落点。
   */
  const seedInflight = useRef<{ key: string; controller: AbortController } | null>(null);

  /**
   * 把**某一格**从这一页的种子记录里收掉。
   *
   * ⚠️★ `onlyLoading` 那一半**就是** Critical 1 的判据：只有"一个请求还在飞"的那一格
   *    该被收掉，而 `ready` / `not_found` / `failed` 是**已经落地**的结果
   *    （与"换页不清旧数据"同一条口径：回到刚看过的一页时，上面已经画着的东西不该被
   *    自己抹掉）。整格无差别删掉的话，用户切一次标签页回来，刚才读到的三个种子就没了
   *    —— 而那看起来与"我点开了吗"分不开。
   * ⚠️ 判据用 `mine(held, page)`：**别的页面的那一份不碰**（它就是"属于哪一页"的判据本身）。
   * ⚠️ 写成"重建一个对象"而不是 `delete data[key]`：state 里的对象不许就地改
   *    （就地改的话 React 拿到的还是同一个引用，界面不会重画 —— 表现是"点了收起没反应"）。
   */
  const dropSeedState = useCallback(
    (key: string, onlyLoading: boolean): void => {
      setEloSeeds((held) => {
        const data = mine(held, page);
        if (data === null) return held;
        if (onlyLoading && data[key]?.kind !== 'loading') return held;
        if (data[key] === undefined) return held;
        const rest: RankedSeedStates = {};
        for (const [each, state] of Object.entries(data)) {
          if (each !== key) rest[each] = state;
        }
        return { key: page, data: rest };
      });
    },
    [page],
  );

  /**
   * ★★ 取消种子那一发，**并且把它留在状态里那一格 `loading` 收掉**。
   *
   * ⚠️★ 两件事必须成对（这是 2026-09-19 终审 Critical 1 的形状）：
   *    只 `abort()` 不收状态的话，那一格会永远停在 `loading` —— 视图照旧渲染
   *    「加载中」，而没有请求、没有重试、也没有第二个人会把它推到下一档
   *    （用户唯一的出路是"再点一次"，而他根本不知道要这么干）。
   * ⚠️ 它有三个调用点，三处都**必须**走这一个函数：
   *    · `[page]` 的 cleanup（换 tab / 换周 / 卸载）；
   *    · `toggleSeed` 起新的一发之前（一发同时只有一发）；
   *    · `toggleSeed` 的"收起"那一支 —— ⚠️★ 那一处**带条件**（`seedInflight.current?.key === key`）：
   *      收起的只是这一场，而"当下在飞的那一个"可能是**另一场**（见 `toggleSeed` 里 ③ 那一段）。
   *    各写一遍的话迟早有一处漏掉收状态的那半句，而那一处**没有任何自动判据**
   *    （`[page]` 那个 effect 在静态渲染里根本不跑）。
   */
  const abortSeed = useCallback((): void => {
    const flying = seedInflight.current;
    seedInflight.current = null;
    if (flying === null) return;
    flying.controller.abort();
    dropSeedState(flying.key, true);
  }, [dropSeedState]);

  /**
   * 把某一场比赛的种子状态写进这一页的记录（**盖同一个页章**）。
   *
   * ⚠️ 合并的是 `mine(held, page)` 那一份（不是整个 `held.data`）：少了这一步，
   *    "换页之后第一次点击"会把**上一页**那几格原样带过来。
   */
  const putSeedState = useCallback(
    (key: string, state: RankedSeedState): void => {
      setEloSeeds((held) => ({ key: page, data: { ...(mine(held, page) ?? {}), [key]: state } }));
    },
    [page],
  );

  /**
   * 取一轮数据。**成功才替换 `loaded`，失败一个字都不清**（规则 6）。
   *
   * ⚠️ 抽成 `useCallback` 是为了让三个调用点共用同一件事：定时间隔、「重试」、以及
   *    "回到前台立刻刷一次"。写成三处各发一次请求的话，"失败保留旧数据"这条规矩
   *    要写三遍，漏掉任何一遍都不会有任何报错。
   */
  const load = useCallback(async (): Promise<void> => {
    /*
     * ⚠️ 上一趟还在飞就先取消它：「重试」连点两下、或者"切回前台立刻刷"与轮询撞上时会 ——
     *    而两个响应乱序回来时，先发的那个会把后发的那个盖掉。
     */
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setBusy(true);

    /** 这一轮里**第一次**失败的那一个（`unknown`，由 `describeRankedError` 翻成人话）。 */
    let failure: unknown = null;
    let failed = false;
    /** 中途被取消 ⇒ 这一轮的结论（成功与失败）一个字都不许落地。 */
    let cancelled = false;

    /**
     * 取**一路**数据。成功 ⇒ 用 `page + atMs` 盖住那一格（规则 7）；失败 ⇒ 只记进 `failure`。
     *
     * ⚠️★ 写成一个小函数而不是把 `try/catch` 抄五遍：抄五遍的那一份迟早会有一处漏掉
     *    `cancelled` 或者写成 `setX(null)` —— 而"失败清空"这条恰恰是规则 6 要防的事，
     *    它不会有任何报错，只会让用户在刷新失败时看到一屏空白。
     * ⚠️ `put` 拿到的是**完整的 `Loaded`**（带着 page 与 atMs），所以调用点只需要关心
     *    "把哪一格放进去"；① 的人数要在里面换一格（`data.players`），也在调用点做掉。
     * ⚠️★ 第三个参数 `fatal`（默认 `true`）区分**这一路失败算不算这一轮的失败**：
     *    容器里有一路请求是**辅助**的（带 id 进来时补问一次"最新是第几周"，见下面那个调用点）
     *    —— 它的结果只影响"要不要轮询"，一个字节都不进界面。
     *    它失败时若照旧记进 `failure`，屏幕上会出现**三句互相矛盾的话**：
     *    「读不到数据。连不上上游…」+「上次刷新失败了，下面是 0 秒前的数据」，
     *    而那整整一周的表格**就在下面画着** —— 三句话里两句是假的
     *    （表格能画出来，说明这一页的数据取到了）。⇒ 辅助那一路走 `{ fatal: false }`。
     */
    const pull = async <T,>(
      run: (signal: AbortSignal) => Promise<T>,
      put: (loaded: Loaded<T>) => void,
      { fatal = true }: { fatal?: boolean } = {},
    ): Promise<void> => {
      try {
        const data = await run(controller.signal);
        if (controller.signal.aborted) {
          cancelled = true;
          return;
        }
        put({ key: page, data, atMs: Date.now() });
      } catch (err) {
        if (isAbort(err) || controller.signal.aborted) {
          cancelled = true;
          return;
        }
        /*
         * ⚠️★ 取消与"辅助那一路失败"都**先于** `failure` 判掉，而且顺序不许换：
         *    取消不是失败（换了页），辅助那一路的失败是**故意静默**的（它不是这一页的话）。
         */
        if (!fatal) return;
        if (!failed) {
          failed = true;
          failure = err;
        }
      }
    };

    try {
      /*
       * ★★ 一个面板一轮要取的那几件事。**只有 `tab` 这一支会被执行** ——
       *    另外三个面板的视图根本不挂载（规则 1），所以这里也一个请求都不发。
       */
      if (tab === 'status') {
        // ① 两路：我们的端点（心跳，CORS 所迫只能走我们）与直连的人数
        await pull(fetchRankedStatus, setHeartbeat);
        await pull(fetchRankedLive, (loaded) =>
          setPlayers({ ...loaded, data: loaded.data.players }),
        );
      } else if (tab === 'live') {
        // ② 与 ① 的人数同一份响应，这里渲染的是对局
        await pull(fetchRankedLive, setLive);
      } else if (tab === 'elo') {
        await pull(fetchRankedElo, setElo);
        /*
         * ★★ ③ 的第二路：赛段（`/phase-leaderboard`，2026-09-19 用户要"并排显示赛段信息"）。
         *
         * ⚠️★ `{ fatal: false }`（辅助那一路）：它失败时**一声不响**，
         *    排行榜照常渲染、只有赛段那一格说"读不到"（`RankedEloView` 里那一句）。
         *    走 `fatal: true` 的话，一次 93 字节的失败会把这**一整张榜**变成
         *    「读不到数据」+ 重试 —— 而那张榜其实**画得出来**（同一条理由写在
         *    下面"历史周补问最新周号"那一支上）。
         * ⚠️ 顺序是先榜后赛段：榜是主数据，赛段只是顶上多一格。
         */
        await pull(fetchRankedPhase, setPhase, { fatal: false });
      } else {
        /*
         * ④ 周赛。`weekId === undefined` = 「本周」（不带 id 的那条路径）；
         *    `?? null` 把两种请求合成一次调用（`fetchRankedWeekly(null)` 就是"本周"）。
         */
        await pull(
          (signal) => fetchRankedWeekly(weekId ?? null, signal),
          (loaded) => {
            setWeekly(loaded);
            // ★ 周号用**响应里**那个（请求"本周"会拿到 103）—— 显示与翻页都从它出发
            if (weekId === undefined) rememberLatest(loaded.data.id);
          },
        );
        /*
         * ★★ 带 id 进来（别人分享的 URL / 刷新 / 前进后退）时，我们还**不知道最新是第几周**，
         *    而"历史周不轮询"这条判据要用它 ⇒ 多打一发不带 id 的请求把它学回来，
         *    而且**只学一次**（`latestIdRef`）。
         *
         * ⚠️★ 不学它的代价是**静默**的：一个刷新过的 `/ranked/weekly/102` 会每 60 秒
         *    打一次上游，而画面上与"没在轮询"**一模一样**（历史周的数据本来就不会变）
         *    —— 只有访客自己的额度在掉（规则 4 想省的正是这个）。
         *    ⚠️ 而"先取一次最新的拿到 `latestId`"正是计划里那句话的落点。
         * ⚠️ 代价写在明面上（2026-09-16 手工跑 dev 数过）：这一页**第一次**打开一共三发
         *    上游请求 —— 那一周、最新的、以及学到最新周号之后重跑的那一轮；
         *    之后**一发都不再打**。换掉的是"开着两小时就白烧 120 发"。
         *
         * ⚠️★ `{ fatal: false }`：这一发是**辅助**的，它的失败**故意一声不响**
         *    （理由写在 `pull` 的 `fatal` 那一段）—— 那一周的数据已经取到了、表格就在下面
         *    画着，而一句「读不到数据。连不上上游…」+「上次刷新失败了，下面是 0 秒前的数据」
         *    会把一次**成功**的刷新说成失败（终审的 Critical：这条 URL 还是**我们自己发出去**的）。
         *    ⚠️ 它的**第二阶效应**已经写在上面了、这里再说一遍免得被"顺手修好"：
         *    既然失败不落地，`latestIdRef` 就还是 `null` ⇒ 这一页**继续按"本周"轮询**，
         *    直到某一轮辅助请求真的成功为止 —— 那是**有意**的（少轮询一次远远不如
         *    "说一句假话"糟），而它同时意味着这段时间里多烧几次访客的额度。
         */
        if (weekId !== undefined && latestIdRef.current === null) {
          await pull(
            (signal) => fetchRankedWeekly(null, signal),
            (loaded) => rememberLatest(loaded.data.id),
            { fatal: false },
          );
        }
      }

      if (cancelled) return;
      /*
       * ★ 失败只说**一句**话：`ranked.loadFailed` + 映射器给的那半句
       *   （与 `routes/ShareBoard.tsx` 里 `shares.loadFailed` + `describeShareError` 同形）。
       *   ① 那一页两路都失败时取**先失败**的那一路 —— 它们说的通常不是一件事
       *   （我们端点的事 vs 上游的事），而这里只有一行位置。
       *
       * ⚠️ 清错误**只在成功这一支**，不在开头：在开头清的话，每一轮轮询都会让
       *   「上次刷新失败了」那一句闪一下（消失 → 请求飞着 → 失败后又出现），
       *   而它在这段时间里**仍然是真的**（你看到的确实还是旧数据）。
       */
      setError(
        failed ? `${t('ranked.loadFailed')} ${describeRankedError(failure, t, errorText)}` : null,
      );
    } finally {
      /*
       * ⚠️ 只有"还是当前那一趟"才收 `busy`：被新的一趟顶掉时，重试键要等新的那一趟结束
       *    才重新可点（否则它会在一发请求还在飞的时候亮起来）。
       */
      if (inflight.current === controller) setBusy(false);
    }
  }, [errorText, page, rememberLatest, t, tab, weekId]);

  /*
   * ★★ 这里**没有**"换页就清空"那个 effect（终审删掉的，理由见文件头那一节）。
   *
   * ⚠️★ 为什么删掉是**安全**的（不是"忘了一件事"，这一句就是判据）：
   *   · 串台由 `key` 挡着：每一份数据都盖着 `page`（`load` 里那一次 `put`），
   *     渲染时 `mine(x, page)` 只认**相符**的那一份 ⇒ 刚换到的那一页拿到的是 `null`，
   *     界面说「加载中」—— 与"清空"长得**一模一样**，而**旧数据还在手上**；
   *   · 删掉它的收益是那一份旧数据：回到一个刚看过的标签页时，上面已经画着的东西
   *     **不会被自己抹掉**；而如果这次刷新失败，用户看到的是"旧数据 + 一句话 + 重试"
   *     （spec §6.6 第 4 行），而不是"失败 + 空屏"。
   * ⚠️ 它**不碰 `latestId` / `latestIdRef`**：那是"上游最新是第几周"这个**事实**，
   *    不属于任何一页，留着它，翻到历史周时才不会白轮询（正是规则 4 要的）。
   */

  /**
   * ★★ "这一页的数据不会再变" —— 历史周。
   *
   * 它是**派生**出来的一个布尔（不是 state、不是"每周算一次"），所以它只在学到最新周号
   * 那一刻从 `false` 翻成 `true` 一次 ⇒ 放进下面那个 effect 的依赖里不会引起反复重跑。
   * ⚠️ 判据里的 `latestId !== null` 不能省：还不知道最新是第几周时**不能猜**
   *    （猜"手上这周就是最新的"会让一个真的历史周永远轮询；猜"它是历史周"会让
   *    本周那页不刷新 —— 两种都是静默的）。
   */
  const frozenWeek =
    tab === 'weekly' && weekId !== undefined && latestId !== null && weekId < latestId;

  /*
   * ★★ 首取 + 轮询 + 可见性 —— 三件事共用一个定时器句柄（`routes/ShareBoard.tsx` 同一形状）。
   *
   * ⚠️ 依赖只有 `load`（它带着 `tab` / `weekId`，换页才换身份）、`frozenWeek`
   *    （一个只在学到最新周号时翻一次的布尔）与 `tab`（间隔表按它取）。
   *    **不许**把 `nowMs` 放进来：见文件头那条 —— 它每秒都变，等于每秒重建定时器。
   */
  useEffect(() => {
    /** 定时器句柄。`null` = 现在没在轮询（不可见、历史周，或者还没开始）。 */
    let timer: number | null = null;
    const start = (): void => {
      if (timer !== null) return;
      /*
       * ★ 历史周**一个定时器都不起**（规则 4）：那些数据不会再变。
       *   省下的是**访客自己**打给上游的额度（上游按访客 IP 限流 500 次/10 分钟）。
       */
      if (frozenWeek) return;
      timer = window.setInterval(() => void load(), RANKED_POLL_MS[tab]);
    };
    const stop = (): void => {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    };

    // 挂载 / 换 tab / 翻页：先来一次（第一次取数不该等一个间隔）
    void load();
    if (document.visibilityState === 'visible') start();

    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        /*
         * ★ 后台标签页**停止轮询**（规则 5）：不停的话，一个挂着不管的页面会一直打
         *   上游，而那是**访客自己**的额度（他可能开着十几个标签页）。
         */
        stop();
        return;
      }
      /*
       * ★★ 回到前台要**依次做三件事**，缺一不可（逐字照 `routes/ShareBoard.tsx`）：
       *
       * ① `setNowMs(Date.now())` —— 推本地时钟。缺了它，切回来那一刻 `nowMs` 可能停在
       *    几分钟前（浏览器把后台页的 `setInterval` 压到远低于 1 秒），于是「N 秒前更新」
       *    印出一个**假的**新鲜度：数据明明停在后台那一刻，界面却说"3 秒前更新"。
       * ② `void load()` —— 立刻刷一次。缺了它最多要等一个间隔（对局那一页是 10 秒，
       *    但用户看到的是一屏"切回来还是老样子"的画面）。
       * ③ `start()` —— 重新起定时器，否则这一页从此**再也不刷新**（而画面上只是慢慢变旧）。
       *
       * ⚠️ 历史周那一页 `start()` 是个空操作（规则 4），但 ①② 照做：
       *    "回到前台"这条规则说的是**这一次**刷新，与"这一页会不会轮询"是两件事
       *    （而且它一次只有一发请求，不是轮询）。
       */
      setNowMs(Date.now());
      void load();
      start();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      // 取消正在飞的那一次（换 tab / 翻页 / 卸载都会走到这里，理由见 `inflight`）
      inflight.current?.abort();
    };
  }, [frozenWeek, load, tab]);

  /*
   * 本地计时：每秒推进一次 `nowMs`（规则 7）。
   *
   * ⚠️ 这一支里**只有本地读数**，一个请求都没有 —— 「N 秒前更新」自己往前走靠的是它，
   *    而"数据有没有变新"靠的是上面那个轮询。
   * ⚠️ 它不跟着可见性停：后台页的定时器本来就被浏览器压到一分钟一次，停掉它反而要在
   *    切回来时补一拍 —— 而那一拍上面已经补了（`setNowMs`）。
   */
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  /*
   * ★★ 换页（换 tab / 换周）与卸载：把**点击触发的那两次**请求取消掉（③ 的两条路）。
   *
   * ⚠️★ 它**只**依赖 `page` —— **不许**并进上面那个定时器 effect：那个 effect 还会因为
   *    `t` / `errorText` 换身份而重跑（**切一次语言就会**），在那里取消会让一次正在飞的
   *    展开永久停在「加载中」（状态不会重置，也没有任何人会重试）。
   * ⚠️ 取消**不是**失败：两边各自的 catch 都靠 `isAbort` 把它认出来并直接 return
   *    （与轮询那一路同形），所以用户切一下标签页不会看到一句"读不到数据"。
   *    ⚠️★ 而"直接 return"的另一面就是下面那条 Critical 的来源：**状态一个字都不动** ——
   *    所以取消之后必须由**这里**把"还在飞"的那一格收掉（见 cleanup 里那一段）。
   * ⚠️ 卸载也走这里（`[page]` 的 cleanup 在卸载时同样会跑）—— 不需要第二条 effect。
   */
  useEffect(() => {
    /*
     * ⚠️★ 这个 effect 的**依赖就是页章本身**：body 里一个字都不做，要的只是下面那个 cleanup
     *    —— 而"依赖了却不引用"正是 lint 那条 `useExhaustiveDependencies`（"多余的依赖"）
     *    要报的形状（**实测过**：去掉这一行 `void page`，`biome check` 立刻红在那条规则上）。
     *    把它显式读一次让两件事同时成立：注释里说的"为什么依赖它"在代码里看得见，
     *    而 lint 也认得出这个依赖是被用到的。
     * ⚠️ 它**不能**改成 `[]`：那样"换页时取消"这条规则会**静默消失** ——
     *    画面上完全看不出来（请求照样发出去、结果照样落在属于它的那一页上），
     *    只有访客的额度在掉（findings §5）。
     */
    void page;
    return () => {
      lookupInflight.current?.abort();
      detailInflight.current?.abort();
      /*
       * ★★ 取消之后必须把**还在飞**的那一格收掉（2026-09-19 终审 Critical 1）。
       *
       * ---------------------------------------------------------------------
       * ⚠️★ 只 abort、不收状态会留下什么（逐句，因为这条在画面上看不出来）
       * ---------------------------------------------------------------------
       * `toggleDetail` 的 catch 对"我们自己取消的"直接 `return`（不动状态，与轮询那一路
       * 同形）⇒ `eloDetail` 会停在 `{key, data:{nickname, state:{kind:'loading'}}}` 上，
       * 而那个请求**已经不存在了**。③ 那一页的页章是**固定字符串** `'elo'`
       * （`pageKey` 只在周赛那一支带上周号）⇒ 切回来 `mine()` 又匹配上、卡片照旧渲染
       * `common.loading`：没有请求、没有任何重试、也没有第二个人会把它推到下一档 ——
       * 唯一的出路是"收起再展开"（**两次点击**，而且用户根本不知道要这么干）。
       * 轮询救不了它：那一趟只换 `elo` / `phase` 两格，一个字节都不碰这三格交互状态。
       *
       * ⚠️★ 只丢 `loading` 那一档，**不动** ready / failed：后者是**有意**的语义
       *    （文件头那段：回到一个刚看过的标签页时，已经画着的东西不会被自己抹掉），
       *    而且它们与这一条**不是**同一件事 —— ready 是一份**已经拿到**的数据，
       *    它没有"一个请求在飞"这个前提会变假。
       * ⚠️ 代价写清：切走再切回来时，那一张**还在飞**的卡片会**消失**（不是接着转圈）。
       *    这是刻意的：宁可让用户重新点一下（**一下**，而且这次是真的会发请求），
       *    也不要一个永远转圈、看起来像卡住了的界面。
       * ⚠️★ 这条修复**没有任何自动判据**：`[page]` 这个 effect 在静态渲染里不跑
       *    （`renderToStaticMarkup` 不跑 effect、不点击）⇒ 手工怎么验写在
       *    `docs/pending.md §5.100`。**不要**为它补一条源码级正则守卫：那种守卫挡不住
       *    任何真实写法（它只会让下一个人以为这里被覆盖了）。
       * ⚠️ `lookup` 那一路**没有**同一个形状的洞，所以它这里不需要收尾（核过）：
       *    `RankedLookup` 只有 `found` / `not_found` / `invalid_identifier` **三档、
       *    没有 `loading`**（`submitLookup` 发请求前一个状态都不设）⇒ 被取消时留在手上的
       *    是"上一次的回答"（或者 `null`），那是一个**已经落地**的结果，不会转圈。
       *
       * ---------------------------------------------------------------------
       * ⚠️★ 2026-09-19 第四轮：**种子那一发**是同一个形状的第二份实例
       * ---------------------------------------------------------------------
       * 「按页章取消 + 带 `loading` 档 + 点击触发」这三件事它都有（`eloSeeds` 那一格），
       * 所以"切走再切回时永远转圈"在原样搬过来的写法上**同样会发生**。
       * ⇒ 这里调的是 `abortSeed()`：它**成对**做两件事（abort + 把那一格 `loading` 收掉），
       * 调用点在**同一个** cleanup 里（不是散在两处 —— 那样迟早只改一半）。
       * ⚠️ 代价与上面那条逐字相同：切走再切回来时，那一格**还在飞**的种子面板会
       * **消失**（不是接着转圈），用户再点一下才是真的会发请求。
       * ⚠️ 它**不碰**已经落地的 `ready` / `not_found` / `failed`（`dropSeedState` 的
       * `onlyLoading` 那一半）：回到刚看过的一页时，刚才读到的三个种子还在。
       */
      setEloDetail((held) => (held?.data.state.kind === 'loading' ? null : held));
      abortSeed();
    };
  }, [abortSeed, page]);

  /*
   * 当前这一页手上**属于它**的那几份数据的时刻（`key` 相符）。用它算一个**唯一**的"有多旧"。
   * ⚠️ 有两页各挂着**两路**（① 心跳 + 人数、③ 排行榜 + 赛段），所以这里可能不止一份
   *    —— 那两格的注释写着为什么界面仍然只该有**一行**新鲜度。
   * ⚠️ 用 `flatMap` 而不是 `filter` + 一个类型守卫：这里的六份数据类型各不相同
   *    （`RankedStatusResponse` / `number | null` / `RankedLiveData` / …），
   *    手写守卫要写成一个它们**共同的上界**，那正好是"把六份数据当成同一种东西"——
   *    而这个文件里唯一需要它们的共同点就是"什么时候取到的"。
   */
  const shownAtMs = [heartbeat, players, live, elo, phase, weekly].flatMap((each) =>
    each !== null && each.key === page ? [each.atMs] : [],
  );
  const lastAtMs = shownAtMs.length === 0 ? null : Math.min(...shownAtMs);
  /*
   * ★★ 「N 秒前更新」与「上次刷新失败了，下面是 N 秒前的数据」里的那个 N ——
   * **同一个数**（`components/ShareCard.tsx` 里那两处也是同一个数）。
   * 两句话会同屏出现，数字不同就是自相矛盾；而这个数**取最旧的那一份**：
   * ① 那一页只有一路失败时，屏幕上**确实**有一格是 60 秒前的，说"0 秒前更新"
   * 会把那句"下面是 60 秒前的数据"当场推翻。
   * ⚠️★ 算式本身住在 `@mcsr/shared/ranked` 的 `secondsAgo()` 里（终审从这一行提上去的）：
   *    它原来内联在这里，而 `routes/ShareBoard.tsx` 有一份逐字相同的副本 ⇒ **两份都没有门禁**
   *    （`apps/web` 没有测试运行器），spec §6.6 那两句冻结文案里的数字因此没人守着。
   *    纯函数住在 shared 才断得了：`services/api/src/ranked-shared.test.ts` 是这一层的测试文件。
   * ⚠️ `Math.max(0, …)` 在函数里（防系统校时把差值变成负数），这一行一个算式都不留。
   */
  const updatedAgoSecs = secondsAgo(nowMs, lastAtMs);
  /* `staleSecs` 与它是**同一个数**：外壳只在**失败**时读它（有旧数据 ⇒ 换一句话）。 */
  const staleSecs = updatedAgoSecs;

  /*
   * ★★ `origin` 由**容器**给（`RankedLiveViewProps.origin` 上写着完整理由）：
   *    它是 Twitch 的 `parent`，传错是**静默拒播**（黑框，看起来像网络问题）。
   *    ⚠️ 于是它必须在**运行时**取（开发时 `localhost`、线上是真实域名），
   *    而**视图里不许读 `location`** —— 渲染自检跑在 Node 里，那儿没有 `location`，
   *    读它会让"Twitch 必须带对 parent"这条规则永远只能走到 `no_origin` 那一支。
   */
  const origin = window.location.hostname;

  /**
   * ★★ ④ 「跳转」/ 回车：把框里的字判成一个周号，合法才导航（2026-09-19）。
   *
   * ---------------------------------------------------------------------------
   * ⚠️★ 判据住在 `parseWeekInput`（纯函数，被 `ranked-shared.test.ts` 逐值钉住）
   * ---------------------------------------------------------------------------
   * 不合法时**只放一句话、一个请求都不发**：上游对 `0` / `-2` / `104` 回 400，
   * 对 `abc` 连路径都拼不出来（`/weekly-race/abc` 是另一个东西，而对空串会拼出
   * `/weekly-race/` —— 那是"本周"那一条路径）。发出去只是拿访客自己的额度换一屏错误
   * （spec §10 的额度账就是按"每个访客自己的 IP"算的）。
   *
   * ⚠️★ 「没有这一周」那句是**复用**上游那一档的同一个词条（`WEEK_INPUT_ERROR_KEYS`）：
   *    本地判出来的"这一周不存在"与上游 400 说的"这一周不存在"是**同一件事**，
   *    换个说法会让用户以为这是两种处境。
   * ⚠️ 跳转用的是**路径**（`weekPath`）而不是查询串：与翻页那两条链接同一条规矩
   *    （可刷新、可分享、前进后退落在同一屏上）。
   * ⚠️ `weekPath(id)` 里的 `id` 是判过的**数**（`Number` 之后的安全整数），
   *    不会拼出 `1e+21` 那种路径（`parseWeekInput` 挡掉了）。
   * ⚠️★ 它**不写进任何 effect 的依赖**（它只挂在 `<form onSubmit>` 与按钮上），
   *    所以这里用普通函数就够了；写成 `useCallback` 反而会让人以为有人在依赖它。
   */
  const jumpToWeek = (): void => {
    const verdict = parseWeekInput(weekInput, latestId);
    if (!verdict.ok) {
      setWeekError(t(WEEK_INPUT_ERROR_KEYS[verdict.reason]));
      return;
    }
    setWeekError(null);
    void navigate(weekPath(verdict.id));
  };

  /**
   * ★★ 「回车 / 点查询」—— 精确查**一位**玩家（搜索框的另一半，2026-09-19）。
   *
   * ---------------------------------------------------------------------------
   * 三种失败**分成两档**（这是这一条的全部判据）
   * ---------------------------------------------------------------------------
   *   · 上游说"查无此人"或"这个昵称不合法"（`RankedLookupError`）⇒ 那两格之一。
   *     它们**不是**"这一次请求失败了"：它们是上游对**这个昵称**的**确定回答**，
   *     重试永远是白试一次（上游的查询是精确匹配，findings §6 末段）；
   *   · 其余（网络 / 500 / 429 / 响应读不懂）⇒ 走**既有**的通用那一档（`errorText`），
   *     也就是面板顶上那句 + 重试 —— 它说的是"这一次没成功，稍后再试"，方向是对的。
   * ⚠️★ 失败**绝不动 `elo`**：那张榜是另一路取回来的，一次查人失败不该把它弄没
   *    （与"赛段那一路失败不弄没整张榜"同一条，spec §6.6 第 4 行）。
   * ⚠️ 空串（含全空白）⇒ 清掉上一次查询、**一个请求都不发**：上游对空路径回 404
   *    （findings §6 第 16 行），发出去只是拿访客的额度换一屏错误。清掉而不是留着，
   *    是因为那一块没有别的关闭入口（用户清空再回车，要的就是"把它收起来"）。
   * ⚠️ 它是个普通函数（不是 `useCallback`）：只挂在 `<form onSubmit>` 上，不写进任何
   *    effect 的依赖 —— 写成 `useCallback` 反而会让人以为有人在依赖它（与 `jumpToWeek` 同一条）。
   */
  const submitLookup = (): void => {
    const nickname = searchText.trim();
    // ⚠️ 先取消上一发（连点两下 / 上一次还在飞）：两个响应乱序落地时，先发的会盖掉后发的
    lookupInflight.current?.abort();
    if (nickname === '') {
      setEloLookup(null);
      return;
    }
    const controller = new AbortController();
    lookupInflight.current = controller;
    void (async () => {
      try {
        const user = await fetchRankedUser(nickname, controller.signal);
        if (controller.signal.aborted) return;
        setEloLookup({ key: page, data: { kind: 'found', user } });
        /*
         * ⚠️ 成功**清掉**顶上那句失败提示：它说的是「读不到数据。」+ 具体原因，而这次
         *    查询刚刚成功了 —— 留着它就是"上面说读不到、下面把数据画出来了"那种自相矛盾。
         * ⚠️ 代价写清：它同时会清掉**轮询**那一路留下的同一句（下一次轮询失败时会重新
         *    出现，最多 60 秒），也就是那一格里的提示可能提前消失。
         */
        setError(null);
      } catch (error) {
        if (isAbort(error) || controller.signal.aborted) return;
        if (error instanceof RankedLookupError) {
          setEloLookup({ key: page, data: { kind: error.kind } });
          setError(null);
          return;
        }
        setError(`${t('ranked.loadFailed')} ${describeRankedError(error, t, errorText)}`);
      }
    })();
  };

  /**
   * ★★ 「点昵称 ⇒ 展开 / 收起」—— 用户原话「点开后能查看最近比赛的情况/数据等」。
   *
   * ⚠️★ 展开一次要**两份**数据，所以是 `Promise.all`：这位玩家的汇总（`/users/{昵称}`）
   *    与他的最近比赛（`/users/{昵称}/matches?count=10`）。两份**都到齐**才算 ready ——
   *    分开落地的话卡片会先画出一半（例如「最近 0 场」，而它其实还在飞）。
   * ⚠️ 点的是**同一个人** ⇒ 收起（并取消那一发可能还在飞的请求）。
   *    ⚠️ 失败**不进缓存**（见 `detailCache`）⇒「收起再点开」就是一次**重试**：两下，
   *    一个动作一个语义 —— 写成"失败时点一下就地重试"会让这个按钮再也收不起来。
   * ⚠️ 缓存的键是**昵称**（用户点的就是它）：命中 ⇒ 一次请求都不发，直接就是 ready。
   * ⚠️ 失败**不写 `errorText`**：那一路说的是"这一页的数据读不到"（顶上那句 + 重试），
   *    而这里失败的是**一位玩家**的抽屉 —— 让它把整张榜变成错误页正是 §6.6 第 4 行
   *    要避免的事（与赛段那一路的 `{ fatal: false }` 同一条取舍）。
   * ⚠️ 上游回"没有这个玩家"（`RankedLookupError`）也落在 `failed` 上：展开那一档没有
   *    自己的第四种画面（`RankedDetailState` 是冻结的三档），代价写在 `ranked.detailFailed`
   *    的词条注释里（那句话在"这个人改名了"的场合说得偏轻）。
   */
  const toggleDetail = (nickname: string): void => {
    if (detail !== null && detail.nickname === nickname) {
      detailInflight.current?.abort();
      setEloDetail(null);
      return;
    }
    const cached = detailCache.current.get(nickname);
    if (cached !== undefined) {
      setEloDetail({ key: page, data: { nickname, state: { kind: 'ready', data: cached } } });
      return;
    }
    detailInflight.current?.abort();
    const controller = new AbortController();
    detailInflight.current = controller;
    setEloDetail({ key: page, data: { nickname, state: { kind: 'loading' } } });
    void (async () => {
      try {
        const [user, matches] = await Promise.all([
          fetchRankedUser(nickname, controller.signal),
          fetchRankedMatches(nickname, RANKED_DETAIL_MATCHES, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        const data: RankedDetailData = { user, matches };
        detailCache.current.set(nickname, data);
        setEloDetail({ key: page, data: { nickname, state: { kind: 'ready', data } } });
      } catch (error) {
        if (isAbort(error) || controller.signal.aborted) return;
        setEloDetail({ key: page, data: { nickname, state: { kind: 'failed' } } });
      }
    })();
  };

  /**
   * ★★ 「点这一场右侧那颗按钮 ⇒ 查 / 收起它的三个种子」（2026-09-19 第四轮）。
   *
   * ---------------------------------------------------------------------------
   * ★ 数据来自**既有的同源路由**（这一轮零服务端改动）
   * ---------------------------------------------------------------------------
   * `fetchSeedByMatchId(matchId)` → `GET /api/ranked-seeds/match/:matchId`
   * ⇒ 我们自己的服务端去问运维那台种子服务（`/api/v2/seed/{matchId}`）。
   * ⚠️★ **不是** `api.mcsrranked.com` 的 `/matches/{id}`：那一条给的是**结构代码**
   *    （`seedType` / `bastionType`），而它**已经**印在同一行的 `.ranked__detailseed` 里了；
   *    用户要的是三个**世界种子值**（账本 `ranked-round4/progress.md` 写着这件事）。
   * ⚠️ **同源**也意味着没有 CORS / 混合内容的问题（那台上游是明文 HTTP、无 CORS 头）。
   *
   * ---------------------------------------------------------------------------
   * ⚠️★ 四件事的判据各只有一处
   * ---------------------------------------------------------------------------
   * ① **开着没有**：`seeds[key] !== undefined`（`seeds` 是过了页章的那一份）。
   *    开着 ⇒ 收起：取消那一发（如果还在飞）+ 把这一格删掉。
   * ② **缓存**（`seedCache`）：`ready` / `not_found` 命中就**一次请求都不发**。
   * ③ **取消**：起新的一发之前先 `abortSeed()` —— 一发同时只有一发，而且被取消的
   *    那一格会被收掉（不会停在「加载中」）。
   *    ⚠️★ 而"**收起**"那一支只取消**属于这一场**的那一发（2026-09-19 复评 M8 修）：
   *    `abortSeed()` 收的是"当下在飞的那一个"，它可能是**另一场**（点开 A 还在飞时点开 B，
   *    再收起 A ⇒ 取消的是 B 那一发，而且 B 的 `loading` 格会被 `dropSeedState(onlyLoading)`
   *    悄悄收掉 —— 用户看到 B 的面板**凭空消失**、没有报错、也没有任何重试入口）。
   *    ⚠️ 不能只写 `dropSeedState(key, false)` 而不取消：那一发回来时 `putSeedState(key, …)`
   *    会把刚收起的格子**又画回来**（"收起之后面板自己冒出来"）。
   *    ⇒ 判据是 `seedInflight.current?.key === key`（这一发是不是这一场的）。
   *    ⚠️ 代价写清：`seedInflight` 在成功/失败之后**不清空**（那一格已经落地，见下面那三段），
   *    所以这里有时会 abort 一个**已经完成**的 controller —— 那是无害的（abort 已完成的
   *    请求什么都不做，而 `dropSeedState(key, true)` 对 `ready` / `not_found` / `failed`
   *    一格都不碰：`onlyLoading` 那一半就是为它写的）。
   * ④ **错误分类**：交给 `describeSeedQueryError`（`lib/seedErrors.ts`），
   *    这里**不许**再写一遍 `status === 404` 或 `code === 'seed_not_found'` 的分支 ——
   *    两份判据会漂，而漂掉的表现是"不在库里的 20% 显示成故障"（或者反过来）。
   *    ⚠️★ 那一档只认 `kind === 'not_found'`：其余一律 `failed`（可重试）。
   * ⑤ **失败不写 `errorText` / 不写 `setError`**：那是"这一页的数据读不到"那一格
   *    （顶上那句 + 重试），而这里失败的是**这一场**的种子 —— 一次 429 不该把整张榜
   *    变成错误页（与 `toggleDetail` / 赛段那一路的 `{ fatal: false }` 同一条取舍）。
   */
  const toggleSeed = (matchId: number): void => {
    /*
     * ⚠️★ 键**只在这里**算一次（`String(matchId)`）：状态记录、缓存、在飞句柄三处都用它 ——
     *    三处各写一遍（一处 `String`、一处数字）迟早会漂，而漂掉的表现是"点了按钮
     *    什么都不出现"（查表永远落空），每一格都合法、没有任何报错。
     */
    const key = String(matchId);
    const open = seeds !== null && seeds[key] !== undefined;
    if (open) {
      /*
       * ⚠️★ 只取消**属于这一场**的那一发（见上面 ③ 那一段的代价）：无条件 `abortSeed()` 会把
       *    另一场正在飞的请求掐掉、并把它那块面板悄悄收走（用户看到的是一块面板凭空消失）。
       *    ⚠️ 而这一场那一发**必须**取消：不取消的话它回来时 `putSeedState` 会把这一格
       *    又写回去 —— 表现是"点了收起，面板过一会儿自己冒出来"。
       */
      if (seedInflight.current?.key === key) abortSeed();
      dropSeedState(key, false);
      return;
    }
    const cached = seedCache.current.get(key);
    if (cached !== undefined) {
      putSeedState(key, cached);
      return;
    }
    abortSeed();
    const controller = new AbortController();
    seedInflight.current = { key, controller };
    putSeedState(key, { kind: 'loading' });
    void (async () => {
      try {
        const { seed } = await fetchSeedByMatchId(matchId, controller.signal);
        if (controller.signal.aborted) return;
        const state: RankedSeedState = { kind: 'ready', seed };
        seedCache.current.set(key, state);
        putSeedState(key, state);
      } catch (error) {
        // ⚠️ 取消不是失败（与另外三路同形）：切页/收起时被 abort，状态由 `abortSeed` 收掉
        if (isAbort(error) || controller.signal.aborted) return;
        /*
         * ⚠️★ 分类走 `describeSeedQueryError`（`context: 'lookup'` —— 这一条路就是
         *    "按 ID 查一场"）：它把 404 / `seed_not_found` 判成 `not_found`，
         *    其余（429 / 5xx / 网络）判成别的档 ⇒ 这里只分"是不是不在库里"。
         * ⚠️ 它返回的 `message` 我们**不用**：界面上那两句话是 `ranked.seedNotFound` /
         *    `ranked.seedUnavailable`（视图渲染的，词条注释写着为什么必须是两句）。
         *    代价写清：这一次调用会白算一条词条（两三个字符串查找）——
         *    换来的是"什么算 not_found"只在一处定义。
         */
        const failure = describeSeedQueryError(error, t, errorText, 'lookup');
        if (failure.kind === 'not_found') {
          /*
           * ⚠️★ "不在库里"是**上游的确定回答**（种子库只覆盖约 80%）⇒ 它也进缓存：
           *    再点一次是同一个答案，而访客那 20 次/分钟的配额是真金白银。
           */
          const state: RankedSeedState = { kind: 'not_found' };
          seedCache.current.set(key, state);
          putSeedState(key, state);
          return;
        }
        // ⚠️ `failed` **不进缓存**（见 `seedCache`）：再点一次就是一次真的重试。
        putSeedState(key, { kind: 'failed' });
      }
    })();
  };

  /** 四个面板共用的那几格（`RankedChromeProps`）。⚠️ 四处必须**逐字相同**，见上面那个 N。 */
  const chrome: RankedChromeProps = {
    errorText: error,
    staleSecs,
    updatedAgoSecs,
    busy,
    onRetry: () => void load(),
  };

  return (
    <>
      {/* 标签页四个面板**共用**，所以它由容器渲染（视图只管自己那一块） */}
      <RankedTabBar tab={tab} />
      {/*
        ★★ **只挂载当前这一支**（规则 1）：一次只有一路定时器、只有这一支在取数。
        另外三个面板不是"藏起来"，而是**根本不在树上** —— 所以任何时候
        `/ranked/live` 那一页都不会有一个后台的排行榜请求在飞。
      */}
      {tab === 'status' ? (
        <RankedStatusView
          {...chrome}
          status={mine(heartbeat, page)}
          players={mine(players, page)}
        />
      ) : null}
      {tab === 'live' ? (
        /*
         * ★ ② 的三格交互状态 + 两个动作都由容器接好线（形状与理由见上面那三个 `useState`）。
         * ⚠️★ `onLoadMore` 加的是 `RANKED_LIVE_BATCH`（**不是**一个写死的数字）：
         *    写死的话，改常量时"首批"变了、"每次加载更多"没变，而界面上两处都对不上
         *    —— 没有任何门禁看得见（那句 total 与按钮上的数字都还是"有值"的）。
         * ⚠️ 写成"在旧值上加一批"（`n => n + …`）而不是"读 `liveShown` 再加"：
         *    连着点两下时，后者两下读到的都是**同一份旧值**，于是只前进了一批 ——
         *    而界面上看起来只是"第二下没反应"。
         */
        <RankedLiveView
          {...chrome}
          live={mine(live, page)}
          origin={origin}
          search={liveQuery}
          onSearchChange={setLiveQuery}
          bothLiveOnly={liveBothOnly}
          onToggleBothLive={() => setLiveBothOnly((on) => !on)}
          shown={liveShown}
          onLoadMore={() => setLiveShown((n) => n + RANKED_LIVE_BATCH)}
        />
      ) : null}
      {tab === 'elo' ? (
        /*
         * ★ ③ 的三格交互状态 + 一个动作都由容器接好线（形状与理由见上面那三个 `useState`）。
         * ⚠️★ 三格都过 `mine(…, page)`：那一份属于**哪一页**只有那一处判据，
         *    所以"换页之后他还渲染着"这件事在结构上就不可能发生。
         * ⚠️ `onSearchTextChange` 也**盖同一个页章**（不是 `setEloSearch(value)`）：
         *    少了这一步，别的页面上打进去的字会被当成"这一页的字"（虽然不可能，
         *    因为那个输入框只在这一页上渲染 —— 但两份写法会漂，而这里只有一种）。
         */
        <RankedEloView
          {...chrome}
          elo={mine(elo, page)}
          phase={mine(phase, page)}
          searchText={searchText}
          onSearchTextChange={(value) => setEloSearch({ key: page, data: value })}
          onSearchSubmit={submitLookup}
          lookup={lookup}
          detail={detail}
          onToggleDetail={toggleDetail}
          /*
           * ★ ④ 那一格（2026-09-19 第四轮）—— 每一场比赛的种子。
           * ⚠️★ 名字**冻结**（`seeds` / `onToggleSeed`，渲染自检按它们写）。
           * ⚠️ `seeds` 走 `mine(…, page)`（不是直接把 state 交出去）：别的页面上它是
           *    `null` ⇒ 视图连"点开过哪几场"都不知道，那一格一个字节都不渲染 ——
           *    与另外两格交互状态逐字相同的一条（"属于哪一页"只有那一处判据）。
           * ⚠️**不许**写成 `seeds={seeds ?? {}}` 之类：`null` 与"空记录"在这里是**两句不同
           *    的话**（前者是"这一页还没点开过"，后者是"点开过、但没有一格留下"），
           *    而视图那一侧对 `null` 与"查不到这一场"的处理本来就一样 —— 多一层兜底
           *    只会把"容器忘了接线"这件事重新藏起来。
           */
          seeds={seeds}
          onToggleSeed={toggleSeed}
        />
      ) : null}
      {tab === 'weekly' ? (
        <RankedWeeklyView
          {...chrome}
          weekly={mine(weekly, page)}
          latestId={latestId}
          /*
           * ★ ④ 手输跳转那两格 + 两个动作（形状与理由见上面那两个 `useState`）。
           * ⚠️ `onWeekInputChange` 顺手**清掉上一条提示**：用户已经开始改那个数了，
           *    留着"请输入一个周数"会让它看起来像是针对新值的判断
           *    （而那个新值可能还没判过）。
           */
          weekInput={weekInput}
          onWeekInputChange={(value) => {
            setWeekInput(value);
            setWeekError(null);
          }}
          onWeekJump={jumpToWeek}
          weekError={weekError}
        />
      ) : null}
    </>
  );
}

/** `/ranked/weekly/:id` 只允许**整数**（带一个可选的负号）—— 见下面 `RankedWeekPage`。 */
const WEEK_ID_PATTERN = /^-?\d+$/;

/**
 * `/ranked/weekly/:id` —— 把 URL 里那一段**校验成**一个周号，不合法就渲染 `NotFound`。
 *
 * ---------------------------------------------------------------------------
 * ★★ `0` 必须判成**不合法**
 * ---------------------------------------------------------------------------
 * 上游把 `0` 当作"本周"的**别名**：请求 `/weekly-race/0` 回的是**当前那一周**
 * （实测是第 103 周）⇒ 放它进来就会出现"URL 写着 0、界面显示第 103 周"的画面，
 * 而那个画面**没有任何门禁**看得见（面板每一格都合法、每个数都是真的）。
 * ⚠️ 判据落在**数**上（`Number(id) === 0`）而不是字符串上：`00` 与 `-0` 都能过正则，
 *    而它们都是 0（`fetchRankedWeekly(-0)` 拼出来的路径就是 `/weekly-race/0`，
 *    于是绕开这条守卫直取"本周那一周"的数据）。
 * ⚠️ `-1` **是合法的**：它是真实存在的最早一周（界面显示成「第 0 周」，spec §6.5）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 为什么不合法时是 `NotFound`，而不是"一句错误 + 重试"
 * ---------------------------------------------------------------------------
 * 地址本身是错的，重试一万次还是错的。「没有这一周。」那句话是**上游**对一个
 * 不存在的周号的回答（400 `race is not found`），与"你这个地址根本不是周号"
 * 是两件不同的事；而后者连一次请求都不该发出去（上游对 `-2`/`104` 回 400，
 * 发出去只是拿访客的额度换一屏错误）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 这一段为什么住在这里，而不是 `App.tsx` 里
 * ---------------------------------------------------------------------------
 * `App.tsx` 是**路由表**（只回答"哪个地址渲染什么"），而这里回答的是"URL 里那段
 * 对上游意味着什么" —— 那是这一栏的知识（`weekId` 马上要交给 `Ranked` 去请求）。
 * 住在同一个文件里，改"哪种 id 算合法"时改的是它旁边那几行。
 * ⚠️ 这一条同时**结构上**保证 `0` 走不到 `prevWeekId` / `nextWeekId`
 *    （T2 评审的 Minor 4：那两个函数对 `0` 的行为没有断言）——
 *    与其钉一个没人走的分支，不如让它不可达。
 */
export function RankedWeekPage() {
  const { id } = useParams();

  /*
   * ⚠️ `id === undefined` 也要挡住：`useParams` 的类型是 `string | undefined`，
   *    而 `Number(undefined)` 是 `NaN`（它会拼出 `/weekly-race/NaN` 这个路径）。
   */
  if (id === undefined) return <NotFound />;
  const weekId = Number(id);
  if (!WEEK_ID_PATTERN.test(id) || weekId === 0) return <NotFound />;

  return <Ranked tab="weekly" weekId={weekId} />;
}
