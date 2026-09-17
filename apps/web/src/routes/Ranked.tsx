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
  RANKED_LIVE_BATCH,
  RANKED_POLL_MS,
  type RankedEloData,
  type RankedLiveData,
  type RankedStatusResponse,
  type RankedTab,
  type RankedWeeklyData,
  secondsAgo,
} from '@mcsr/shared/ranked';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import {
  type RankedChromeProps,
  RankedEloView,
  RankedLiveView,
  RankedStatusView,
  RankedTabBar,
  RankedWeeklyView,
} from '@/components/RankedPanels';
import { fetchRankedStatus } from '@/lib/api';
import { useApiErrorText } from '@/lib/auth';
import { fetchRankedElo, fetchRankedLive, fetchRankedWeekly } from '@/lib/rankedDirect';
import { describeRankedError } from '@/lib/rankedErrors';
import { NotFound } from '@/routes/NotFound';

/** 本地计时的一拍（与 `routes/ShareBoard.tsx` 的 `TICK_MS` 同一条；「N 秒前更新」靠它往前走）。 */
const TICK_MS = 1_000;

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
interface Loaded<T> {
  key: string;
  data: T;
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
 */
function mine<T>(loaded: Loaded<T> | null, key: string): T | null {
  return loaded !== null && loaded.key === key ? loaded.data : null;
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

  /** ① 我们的端点（心跳）。`null` = 这一页还没成功取到过。 */
  const [heartbeat, setHeartbeat] = useState<Loaded<RankedStatusResponse> | null>(null);
  /** ① 的人数（直连 `/live`）。★ 与 `heartbeat` **各留各的旧数据**（两路可以单独失败）。 */
  const [players, setPlayers] = useState<Loaded<number | null> | null>(null);
  /** ② 的高分对局（直连 `/live`）。 */
  const [live, setLive] = useState<Loaded<RankedLiveData> | null>(null);
  /** ③ 的排行榜（直连 `/leaderboard`）。 */
  const [elo, setElo] = useState<Loaded<RankedEloData> | null>(null);
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
   * 当前这一页手上**属于它**的那几份数据的时刻（`key` 相符）。用它算一个**唯一**的"有多旧"。
   * ⚠️ ① 那一页有两路（心跳 + 人数），所以这里可能不止一份 —— 这是 ① 唯一与别的面板
   *    不同的地方（那一格的注释写着为什么界面仍然只该有**一行**新鲜度）。
   * ⚠️ 用 `flatMap` 而不是 `filter` + 一个类型守卫：这里的五份数据类型各不相同
   *    （`RankedStatusResponse` / `number | null` / `RankedLiveData` / …），
   *    手写守卫要写成一个它们**共同的上界**，那正好是"把五份数据当成同一种东西"——
   *    而这个文件里唯一需要它们的共同点就是"什么时候取到的"。
   */
  const shownAtMs = [heartbeat, players, live, elo, weekly].flatMap((each) =>
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
      {tab === 'elo' ? <RankedEloView {...chrome} elo={mine(elo, page)} /> : null}
      {tab === 'weekly' ? (
        <RankedWeeklyView {...chrome} weekly={mine(weekly, page)} latestId={latestId} />
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
