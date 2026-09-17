/**
 * Ranked 实时信息（`/ranked`）—— 四个面板与标签页的**纯视图**（全部只吃 props）。
 *
 * ===========================================================================
 * ★★ 为什么界面住在这里，而不是住在 `routes/Ranked.tsx` 里
 * ===========================================================================
 * 容器（Task 6）自己取数、自己轮询、自己算"这份数据有多旧"，而 `apps/web`
 * **没有测试运行器**：这一栏唯一的自动化断言是渲染自检（`renderToStaticMarkup`
 * —— 它**不跑 effect、不点击、不发请求**）。写在容器里的任何一块，纯 SSR 下
 * 永远停在"加载中"那一屏，一个字都断言不到，而一条**不可能红**的守卫比没有守卫
 * 更坏（`docs/pending.md §5.63`；`components/ShareCard.tsx` 的文件头记着这一栏
 * 上一轮的同一段来历）。⇒ 容器只取数，界面全部搬到这里，两种语言各渲染一遍。
 *
 * ===========================================================================
 * ⚠️★ 这个文件里**没有 `Date.now()`**（也没有 fetch、没有 effect）
 * ===========================================================================
 * 「N 秒前更新」与「上次刷新失败了，下面是 N 秒前的数据」里那两个数字都是 props
 * （`updatedAgoSecs` / `staleSecs`，由容器用本地时钟算好传进来）。在这里读一次时钟，
 * 就等于把"四种整体画面"变成只有人眼能验的东西：渲染自检喂不进一个固定时刻，
 * 于是断言只能写成"有这一行"，而"这一行说的是几秒"—— 这一栏最要紧的那个数 ——
 * 一个字都钉不住。（`ShareCard.tsx` 的 `nowMs` / `lastUpdatedAtMs` 是同一条纪律；
 * 否决了"在这里算一个更精确的秒数"：那是拿可断言性换一段没人验得动的算术。）
 *
 * ===========================================================================
 * ★ ②③④ 三处**列表**由视图自己派生（`sliceLiveMatches` / `topEloEntries` / 逐行渲染）
 * ===========================================================================
 * 「共 {{total}} 场」里的 total 是 `live.matches.length`，而下面是筛选、分批之后真的
 * 渲染出来的那几张 —— 两者必须来自**同一次**计算。分两处算（容器算 total、视图算
 * 列表，或者反过来），迟早会渲染出"写着 14 场、其实列了 10 条"的产物，而那种
 * 自相矛盾**没有任何门禁能发现**：它每一句都合法、每一格都有值。
 * ⇒ ② 的那一段（排序 / 筛选 / 取前 `shown` 张 / 还剩几场）整个住在
 *   `shared/ranked/select.ts` 的 `sliceLiveMatches` 里，一次调用给出全部四个数。
 * ⚠️ 视图里调用**纯函数**是允许的（`select.ts` 那几个都不读时钟、不改入参）；
 *    不允许的是时钟与取数。
 *
 * ===========================================================================
 * ★ 嵌入：判定与播放器都用**现成的**，这里一个播放地址都不拼
 * ===========================================================================
 * `liveEmbedDecision(rankedLiveChannel(url), origin)` —— ⚠️★ `origin` 是 **props**
 * （由容器传 `window.location.hostname`），**不是**在这里读 `location`：
 * 视图里读全局变量有两个后果 —— 渲染自检（跑在 Node 里，那儿没有 `location`）
 * **永远**只能看到 `no_origin` 那一支，于是"Twitch 必须带对 `parent`"这条
 * **唯一静默失败**的规则就再也断言不到了。理由的全文写在 `RankedLiveViewProps.origin` 上。
 * 它编码的是三条**实测**出来的平台规则，而它们只住在 `live.ts` 里：
 *   · Twitch 的 `parent` 必须等于嵌入页面的 host（传错是**静默**拒播，看起来像网络问题）；
 *   · B站直播间要走 `www.bilibili.com` 的活动播放器（房间页带 `X-Frame-Options`，嵌进去是黑框）；
 *   · YouTube 认的是视频 ID，频道页（`youtube.com/@handle`）拼不出可嵌地址。
 * ⇒ 这里重写一遍就是第二份会漂移的真相（`ranked/embed.ts` 的文件头写着同一件事）。
 * `embed: true` ⇒ 交给**全站唯一**那份「点一下才加载」的播放器组件去渲染
 * （`components/ClickToPlayEmbed.tsx`：一屏最多 20 个框，全预加载会把浏览器与带宽
 * 一起打满；而"再写一个门面"正是那个文件头在防的事 —— 修好一份、另一份没改）；
 * `embed: false` ⇒ **外链** + `ranked.liveExternal`。
 * ⚠️ 那句文案说的是「**这条链接**不能内嵌」，**不是**"这个平台不支持"：
 *    `livePlatform === null` 里混着认不出的平台（kick）与"平台其实支持、只是这条地址里
 *    没有可嵌的视频"（`youtube.com/@handle`）两类，对后者"平台不支持"是**错话**
 *    （`ranked/embed.ts` 第 ④ 条分支的原因就写在这里）。
 *
 * ===========================================================================
 * ⚠️ 类名 = 与 `styles.css` 之间的接口（那一段在文件**末尾**）
 * ===========================================================================
 * 本仓的样式是全局的、没有 CSS Modules 兜着，而"渲染了一个不存在的类名"全仓
 * 没有任何门禁发现得了（`docs/pending.md §5.70`；`ShareForm` 里那个 `.mcsr-input`
 * 笔误就这样活过了两轮评审）。⇒ 这个文件里出现的每一个 `ranked*` 类名都在
 * `apps/web/src/styles.css` 末尾那一块里有规则，Task 8 的渲染自检会逐类名核对。
 *
 * ===========================================================================
 * ⚠️ 词条：这里出现的每一个 key 都在 spec §7 的冻结清单里（跟着视图一起落地）
 * ===========================================================================
 * ⛔ **不要在这个文件里写死任何可见文字**，包括那个占位符：它是 `ranked.unknown`。
 * 写死之后两种语言再也没法分开调，而渲染自检的"裸 key 泄漏"扫描**只看得到 key**
 * —— 一个写死的字面量它一个字都不会说（`roleguide.tsx` 那条恒真守卫就是这个形状）。
 * ⚠️★ 两份字典**看不见**这件事：`services/api/src/i18n-keys.test.ts` 只扫**字面量**
 *    `t('…')` 调用，而这个文件里有一批 key 是从表里取的（标签页那一张、
 *    `STATUS_KEYS`、`WEEKLY_SEED_LABEL_KEYS`、`timeline.ts` 那一张）——
 *    表里少一条，界面上会直接印出裸 key 而门禁全绿（2026-09-16 评审量到的正是这个）。
 *    ⇒ 只有渲染自检（Task 8）看得见它，在那之前得靠人。
 */
import { liveEmbedDecision } from '@mcsr/shared/live';
import {
  displayWeekNo,
  formatClock,
  formatRaceTime,
  nextWeekId,
  prevWeekId,
  RANKED_TABS,
  type RankedEloData,
  type RankedLiveData,
  type RankedLiveMatch,
  type RankedLivePlayer,
  type RankedPhaseData,
  type RankedStatusResponse,
  type RankedTab,
  type RankedWeeklyData,
  rankedLiveChannel,
  sliceLiveMatches,
  timelineLabel,
  topEloEntries,
  weekPath,
} from '@mcsr/shared/ranked';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ClickToPlayEmbed } from '@/components/ClickToPlayEmbed';
import { Notice } from '@/components/Form';

// ---------------------------------------------------------------------------
// 标签页的两张表：路径与词条 key
// ---------------------------------------------------------------------------

/**
 * 四个标签页 → 路径。⚠️ 穷尽 `Record<RankedTab, string>`。
 *
 * ⚠️ 它们是**真链接**（spec §6.1）：四个地址各是一个可以刷新、可以分享、前进后退
 * 都落在同一屏上的 URL。做成"本地 state 切换"的话，标签页看起来一模一样，
 * 但分享出去的那个地址永远只会打开状况面板 —— 而那种错**没有任何门禁看得见**
 * （产物里那四个词都在，只是点了不换页）。
 */
const RANKED_TAB_PATHS: Record<RankedTab, string> = {
  status: '/ranked/status',
  live: '/ranked/live',
  elo: '/ranked/elo',
  weekly: '/ranked/weekly',
};

/**
 * 四个标签页 → 词条 key（spec §7.1）。
 *
 * ⚠️ 表里存的是**词条 key**，不是译文：`t()` 在渲染点调用，切语言才跟得上
 * （与 `ShareCard.tsx` 里那三张 `SHARE_*_KEYS` 表同一条理由）。
 * ⚠️★ 表里的四条**不在** `services/api/src/i18n-keys.test.ts` 那条守卫的覆盖范围里：
 *    它扫的是源码里的**字面量** `t('…')` 调用，而这里唯一的调用点是
 *    `t(RANKED_TAB_LABEL_KEYS[each])` —— 表里少一条，四个标签页会**一起**印出
 *    `ranked.tabStatus` … 而 `pnpm -w check` 全绿（2026-09-16 评审就是这样逐格量到的：
 *    四条 key 两份字典里一条都没有）。⇒ 同一个缺陷在 `STATUS_KEYS` /
 *    `WEEKLY_SEED_LABEL_KEYS` 上都成立，三张表都得逐条对 spec §7 的清单核一遍，
 *    而这件事今天只能靠人（T8 的裸 key 扫描只看得见**渲染出来**的 key）。
 */
const RANKED_TAB_LABEL_KEYS: Record<RankedTab, string> = {
  status: 'ranked.tabStatus',
  live: 'ranked.tabLive',
  elo: 'ranked.tabElo',
  weekly: 'ranked.tabWeekly',
};

// ---------------------------------------------------------------------------
// ① 心跳的四个状态：词条 key 与徽章配色
// ---------------------------------------------------------------------------

/**
 * `monitor.state` → 词条 key。★★ **穷尽 `Record<0 | 1 | 2 | 3, string>`。**
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 为什么是一张导出的表，而不是一串 `if` / 三元链
 * ---------------------------------------------------------------------------
 * `lib/shareErrors.ts` 上有过教训：一张谁都看不见的 `switch` 被对调两行是**全静默**的
 * —— 界面照样渲染、类型检查照样过（每一格都是 `string`）、门禁一个都不看它。
 * ⇒ 它**导出**（`apps/web/scripts/rankedrender.tsx` 逐格 `deepEqual` 它，再渲染四份
 *   产物确认四句话都在），而且写成 `Record`：加第五种状态时**编译报错**，
 *   逼着人来补一行 —— 三元链的兜底分支天然"合法"，它会把新状态静默显示成
 *   "故障"或者"正常"，而那正是这一格最不能出错的地方（说反了不如不说）。
 * ⚠️ 四种状态**各有各的话**（spec §6.2）：只判 up/down 会让"等待"和"维护"
 *    —— 上游真的会回这两档 —— 显示成"故障"，于是用户在一个**计划内**的维护窗口里
 *    到处找自己的问题。
 * ⚠️★ 2026-09-19 起它被**四格**分别使用（不再是"一个服务器一格"）：
 *    表本身一个字没改，四格各自查自己那一格的状态。
 */
export const STATUS_KEYS: Record<0 | 1 | 2 | 3, string> = {
  0: 'ranked.statusDown',
  1: 'ranked.statusUp',
  2: 'ranked.statusPending',
  3: 'ranked.statusMaintenance',
};

/**
 * 四态 → 徽章类名的后缀（`.ranked__badge--up` …）。
 *
 * ⚠️ 与 `STATUS_KEYS` **同键、同穷尽**：拆成两张表是因为它们回答的是两件事
 * （说什么 / 什么颜色），而这两件事会各自被改（配色是设计，文案是产品）。
 * 合成一张表会让"改配色"不得不动到文案那一列。
 * ⚠️★ 还有**第三**档：`state === null`（上游这一份响应里没有这一格）→ `--unknown`。
 *    它**故意不在**这张 `Record<0|1|2|3, …>` 里 —— 它不是"第五种状态"，
 *    是"没有状态"，而给一个读不到的组件配一个红色徽章是在说一件我们不知道的事
 *    （用户会去查一个没坏的服务）。所以它是 `null` 那一支单独的类名。
 */
const BADGE: Record<0 | 1 | 2 | 3, string> = {
  0: 'down',
  1: 'up',
  2: 'pending',
  3: 'maintenance',
};

// ---------------------------------------------------------------------------
// ④ 周赛的四个种子
// ---------------------------------------------------------------------------

/** 形状里的四个种子字段（`keyof RankedWeeklyData['seed']`，不是手抄的字面量联合）。 */
type WeeklySeedField = keyof RankedWeeklyData['seed'];

/**
 * 四个种子的**固定顺序**：主世界 / 下界 / 末地 / RNG（用户原话的顺序）。
 *
 * ⚠️ 顺序写成数组，不靠对象键序：键序是"谁先写"的副产品，而"这四格每次都以同一个
 * 顺序出现"是这一栏的固有顺序（`ShareContent` 里那四格种子同一条做法）——
 * 顺序一旦漂了，没人会注意到，只会觉得"这次看起来不太一样"。
 * ⚠️★ `satisfies` 与下面那个类型**各管一半**（2026-09-16 评审指出：上一版的注释声称
 *    这一行会为"形状里加一格种子"编译报错，而它其实不会）：
 *    · `satisfies readonly WeeklySeedField[]` 管的是"写进来的每个名字都是形状里真的字段"
 *      —— 写错一个字、或形状里改了名，这里立刻编译报错；
 *    · 它**不管**"形状里每一格都写进来了"：形状加第五格种子时它一声不响，
 *      而后果是**静默的** —— 新种子在 `WEEKLY_SEED_LABEL_KEYS`（穷尽 `Record`）里
 *      拿到自己的标签，却在界面上**永远不渲染**（每一格都合法，没有门禁看得见）。
 *    ⇒ 穷尽那半由 `OrderedWeeklySeedFields` 与视图里
 *      `const order: OrderedWeeklySeedFields = WEEKLY_SEED_ORDER;` 一起钉死。
 */
const WEEKLY_SEED_ORDER = [
  'overworld',
  'nether',
  'theEnd',
  'rng',
] as const satisfies readonly WeeklySeedField[];

/**
 * ★ 顺序数组的**穷尽断言**（类型层，不是文档）：`WEEKLY_SEED_ORDER` 没覆盖到的字段
 *   一旦不是空集，这个类型就塌成 `never` ⇒ 视图里那一行赋值编译报错，
 *   而修法只有一个：把新字段写进顺序数组（顺序是这一栏的产品决定，不能靠键序兜）。
 * ⚠️ 被否决的替代方案（评审的另一个建议）：从 `WEEKLY_SEED_LABEL_KEYS` 的键序派生顺序
 *    —— 那等于让"这四个格子以什么顺序出现"变成"谁先在对象字面量里动手写"的副产品，
 *    而顺序漂了是**没人会注意到**的错（上面第一条 ⚠️ 就是为它写的）。
 */
type OrderedWeeklySeedFields =
  Exclude<WeeklySeedField, (typeof WEEKLY_SEED_ORDER)[number]> extends never
    ? readonly WeeklySeedField[]
    : never;

/**
 * 四个种子的标签 → **这一栏自己的四条词条**（`ranked.seedOverworld` 等）。
 *
 * ⚠️★ 这四条是 **2026-09-16 加进 spec §7.3 的**（本文件实现时报出了这处空白之后）：
 *    上一版复用的是「实时分享」那一栏的 `shares.formOverworld / formNether / formEnd /
 *    formRng` —— 当时 §7.3 给周赛的只有一条 `ranked.weeklySeed`（「种子」），四个格子
 *    印同一句话等于没有标签。裁决是**不许跨栏目复用**：那意味着改「实时分享」的文案会
 *    **顺手改掉**这一栏，而这四格本来就不是同一个语境（那边是"我要分享一组种子"，
 *    这边是"这一周的比赛用的是这几个种子"）。
 * ⚠️ `seedsPage.overworldSeed / netherSeed / theEndSeed` 那组仍然不是候选：
 *    它**缺 RNG 那一条**（全仓搜过，`RNG` 只出现在 `shares.*` 里），凑不齐一组。
 */
const WEEKLY_SEED_LABEL_KEYS: Record<keyof RankedWeeklyData['seed'], string> = {
  overworld: 'ranked.seedOverworld',
  nether: 'ranked.seedNether',
  theEnd: 'ranked.seedEnd',
  rng: 'ranked.seedRng',
};

// ---------------------------------------------------------------------------
// 两个"上游给秒、界面按本地时区与界面语言印"的小工具
// ---------------------------------------------------------------------------

/*
 * ⚠️ 上游的 `Date` 一律是**秒**（赛季起止、周赛 endsAt —— spec §13 的时间单位表），
 *    而 `new Date()` 要的是毫秒 ⇒ 乘 1000 这一步在**调用点**显式做，
 *    与 `time.ts` 文件头那条"单位搞混不会报错，只会显示成一个荒谬的数字"同一条纪律。
 * ⚠️ 用 `toLocaleDateString(locale)` / `toLocaleString(locale)` 而不是自己拼 `YYYY-MM-DD`：
 *    本仓凡与语言有关的日期都走 `Intl`（`CalendarMonthNav` / `CalendarGrid` /
 *    `CalendarDayPanel` 传的正是 `i18n.language`），自己拼就是**第二套时区口径**，
 *    而它只会和第一套漂开。
 * ⚠️★ `locale` 是**必填**参数，由调用点传 `i18n.language`：不传时 `toLocaleDateString()`
 *    跟的是**宿主机器**的 locale ⇒ 中文系统上的英文界面会印出中文日期，而两种语言各渲染
 *    一遍的渲染自检**都看不出来**（两遍都在同一台机器上跑，看到的是同一个错误）。
 * ⚠️★ 它们住在这个视图里，**不**搬去 `packages/shared/src/ranked/time.ts`：那边两个函数
 *    （`formatClock` / `formatRaceTime`）把一个数变成**语言无关**的时钟串（`2:21`），
 *    与 `Intl`、与任何全局变量都不沾；而"哪一天"这两个带着**语言**与**时区**两个口径，
 *    只有界面知道该拿哪一个。搬过去就得给那个纯数字模块加一个"当前语言"参数 ——
 *    那是把一个两行的显示格式问题升级成共享层的接口问题（T2 的测试也要跟着改）。
 */

/** 赛季起止这种"哪一天"的东西 —— 形状由**当前语言**决定（`2026/9/15` 对 `9/15/2026`）。 */
function localDate(seconds: number, locale: string): string {
  return new Date(seconds * 1000).toLocaleDateString(locale);
}

/** 带时刻的那一档（周赛截止）—— 截止是一个**瞬间**，只有日期不够用。 */
function localDateTime(seconds: number, locale: string): string {
  return new Date(seconds * 1000).toLocaleString(locale);
}

// ---------------------------------------------------------------------------
// 标签页
// ---------------------------------------------------------------------------

export interface RankedTabBarProps {
  tab: RankedTab;
}

/**
 * 四个标签页 + 这一栏的页面标题。
 *
 * ⚠️★ 当前页用 **`aria-current="page"`**（不是再加一个 `is-active` 类）：
 *    "屏幕上哪个是当前页"与"读屏软件知道哪个是当前页"必须来自**同一份判据**
 *    （`.share__tab` 那一块写着同一条理由），所以选中态的样式也挂在那个属性上。
 * ⚠️ 其余三个**不标**（`undefined` 让 React 整个属性都不渲染）：标成 `aria-current="false"`
 *    之类的写法会让读屏软件把三个都念一遍。
 * ⚠️ `.ranked` 这一层只包着页头：面板是它的**兄弟**，不是子元素 —— 容器按 T6 的契约
 *    渲染 `<RankedTabBar/>` 与视图两个并列节点。所以 `styles.css` 里 `.ranked` 那条规则
 *    不许写任何"面板在里面"的假设（比如 `> .ranked__panel` 那种选择器）。
 */
export function RankedTabBar({ tab }: RankedTabBarProps) {
  const { t } = useTranslation();

  return (
    <section className="ranked">
      <header className="ranked__head">
        {/* 标题用栏目名（侧栏那一行是同一个词条），不新写一句 */}
        <h1 className="ranked__title">{t('nav.ranked')}</h1>
        <nav className="ranked__tabs">
          {RANKED_TABS.map((each) => (
            <Link
              key={each}
              className="ranked__tab"
              to={RANKED_TAB_PATHS[each]}
              aria-current={each === tab ? 'page' : undefined}
            >
              {t(RANKED_TAB_LABEL_KEYS[each])}
            </Link>
          ))}
        </nav>
      </header>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 四个面板共用的外壳（四种整体画面都从这一层出）
// ---------------------------------------------------------------------------

export interface RankedChromeProps {
  /** 失败提示 —— **已经翻好的一句话**（`describeRankedError` 的结果）；`null` = 没失败。 */
  errorText: string | null;
  /**
   * 手上那份**旧数据**有多旧（秒）。`null` = 没有"旧数据"这回事
   * （第一次就没读到，或者一次都没失败过）。有它时那一句换成
   * 「上次刷新失败了，下面是 N 秒前的数据。」
   */
  staleSecs: number | null;
  /** 「N 秒前更新」里的秒数。`null` = 还没成功取到过（那时**整行不渲染**）。 */
  updatedAgoSecs: number | null;
  /** 正在取数/重试 —— 决定重试键是否可点。 */
  busy: boolean;
  /**
   * ★★ 「重试」的落点。**必填**（不是可选、也不给"缺省时禁用"的兜底）。
   *
   * ⚠️★ 理由与 `ShareBoardViewProps` 那三格（`onRetry` / `onResendVerify` /
   *    `lastUpdatedAtMs`）逐字相同：可选 + 缺省时把按钮禁掉的话，调用方忘了接线的
   *    表现是**一颗永远灰着的按钮**，而**所有门禁都绿** —— 渲染自检断言的是
   *    "入口在不在"，禁用也算在。必填之后忘了传是**编译错误**，
   *    而"入口在不在"照样断言得动（渲染脚本传一个空函数即可）。
   * ⚠️ `apps/web/scripts/**` 不在 tsconfig 的 include 里 ⇒ 渲染脚本那一侧不受
   *    类型检查，所以它另外自己写一道运行时守卫（Task 8），两件事缺一不可。
   */
  onRetry: () => void;
}

/**
 * 四种整体画面（spec §6.6）都由这一层出：每次渲染都要能回答"我手上这份数据有多旧"。
 *
 * ⚠️ 顺序是有意的：失败提示 → 重试 → 数据 → 新鲜度。把新鲜度放在最上面会让它
 *    看起来像这一页的副标题，而它说的是**下面这份数据**的状态。
 */
function RankedChrome({ children, ...c }: RankedChromeProps & { children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <div className="ranked__panel">
      {/*
        ⚠️ 失败但**有**旧数据 ⇒ `info` 而不是 `bad`：列表还能用，而 `bad` 那一档是
        `role="alert"`，会打断读屏的朗读（见 `components/Form.tsx` 的 `Notice` 注释）。
        反过来，**没有**旧数据时这一屏只有它一句，那就该用 `bad`。
      */}
      {c.errorText !== null ? (
        <Notice kind={c.staleSecs === null ? 'bad' : 'info'}>
          {c.staleSecs === null ? c.errorText : t('ranked.refreshFailed', { secs: c.staleSecs })}
        </Notice>
      ) : null}
      {/*
        ★★ 判据是"**失败过就给一次重试**"（`errorText !== null`），而 `staleSecs` 只管
        那句话用 `info` 还是 `bad`（有旧数据就不许打断读屏）。

        ⚠️★ 被否决的替代方案（2026-09-16 之前计划骨架上的写法，那一版已经改掉了）：
          `{c.staleSecs !== null && c.errorText !== null ? <RankedRetry … /> : null}`
        —— 那个条件让**"失败·没有旧数据"**（第一次就没读到，spec §6.6 第 3 行）这一档
        **一颗重试都没有**，而那一格恰恰最需要它：用户手上什么都没有，能做的只剩刷新整页。
        §11.3 又要求"四种整体画面各自的产物"逐档断言 ⇒ 按那个条件写，Task 8 那一条必红。
        ⚠️ 同栏目上一轮的 `ShareBoardView` 在两档失败里**都**渲染了重试
        （`board === null && loadError` 与 `board !== null && loadError`），这是先例。
        ⚠️ 也不是"顺手多给一颗按钮"：`ShareRetry` 的注释写着"一颗按下去什么都不会发生的
        按钮比没有按钮更坏"，而它的反面同样成立 —— 一句失败说明配不上任何动作，
        比少一句话更让人卡住（他没有第二次机会）。
      */}
      {c.errorText !== null ? <RankedRetry busy={c.busy} onRetry={c.onRetry} /> : null}
      {children}
      {/*
        ⚠️ 只有成功过一次才渲染这一行：写「0 秒前更新」是在撒谎 ——
        那时候根本没有"上一次"，而这一行唯一的用途就是回答"这份数据有多旧"。
      */}
      {c.updatedAgoSecs !== null ? (
        <p className="ranked__updated">{t('ranked.updatedAgo', { secs: c.updatedAgoSecs })}</p>
      ) : null}
    </div>
  );
}

/**
 * 失败那一屏上的「重试」。
 *
 * ⚠️★ `onRetry` **必填**，理由写在 `RankedChromeProps.onRetry` 上（那里写着
 *    ShareBoard 那一轮踩过的坑：可选 + 缺省禁用 = 一颗永远灰着的按钮 + 全绿的门禁）。
 * ⚠️ 复用全站现成的 `common.retry`（spec §7.3 明确写了"不新写"）：
 *    这一栏没有比别处更多的"重试"含义。
 * ⚠️ 外层那一段用的是 `.ranked__meta`：它是一行的度量（同一档字号与颜色），
 *    而这一行里只有一颗按钮 —— 加一个 `.ranked__actions` 会让类名清单多出一格，
 *    而那份清单是这一栏与 Task 8 的扫描之间的接口，能不加就不加。
 */
function RankedRetry({ busy, onRetry }: { busy: boolean; onRetry: () => void }) {
  const { t } = useTranslation();

  return (
    <p className="ranked__meta">
      <button type="button" className="ghostbtn" disabled={busy} onClick={onRetry}>
        {t('common.retry')}
      </button>
    </p>
  );
}

// ---------------------------------------------------------------------------
// ① 状况与人数
// ---------------------------------------------------------------------------

export type RankedStatusViewProps = RankedChromeProps & {
  /** 我们那一个端点的响应；`null` = 还没取到（第一次在飞，或者第一次就失败了）。 */
  status: RankedStatusResponse | null;
  /** 直连 `/live` 拿到的人数 —— ★ **与 `0` 是两句话**（spec §6.2）：`null` 说"读不到"。 */
  players: number | null;
  /*
   * ⚠️ 这里曾经有一格 `playersAtMs: number | null`（"人数是什么时候读到的"）。
   *    2026-09-16 的裁决把它**从 spec 与计划里一起删掉**了，代码跟着删。
   *    理由：这一栏的"新鲜度"是**一行**（外壳的 `updatedAgoSecs`，失败时那句换
   *    `staleSecs`），不是每个数据源一行 —— 同一屏出现两个意思不同的"N 秒前"，
   *    它们迟早会互相打架（一个是"这份数据多旧"，一个是"人数那一格多旧"）。
   *    ⚠️ 不要因为"容器确实有两次请求（心跳 + 人数）"把它加回来：容器的取数是一回事，
   *    界面回答"这份东西有多旧"是另一回事，而后者只需要一个答案。
   */
};

/**
 * ① 状况与人数（spec §6.2，**2026-09-19 按用户裁决改版**）。
 *
 * ---------------------------------------------------------------------------
 * ★★ 这一屏现在**只有**两样东西：四个组件（状态 + 最后更新）与在线人数
 * ---------------------------------------------------------------------------
 * 用户原话：「"状态栏"显示 Game Server, API, Store 和 Wiki 所有的状态和最后更新时间，
 * 下面显示当前在线人数，**不加其他多余的信息**」；追问后的口径是**只留四行 + 人数**。
 * ⇒ 这一屏**删掉**了四样东西，它们都是**被删的**、不是"忘了写"：
 *   · 延迟（`ranked.statusPing` / `statusPingUnknown`）；
 *   · 24 小时可用率（`ranked.statusUptime`）；
 *   · 那一格单独的 Game Server 心跳（`ranked.statusCheckedAt`）—— 它被**四行**取代；
 *   · 心跳历史（上游那份响应里每格 100 条）—— 我们从第一条起就没显示过它，
 *     现在连解析都不做了（`parse.ts` 只取 `.at(-1)`）。
 *   那四条词条**同时**从两份字典里删掉了：没有消费者的 key 留着，下一个人会以为
 *   它们还挂着某个渲染点（本仓为这种事删过 `shares.moderateHideReason`）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️★ 四行是**四格**，不是"上游给了几格就几格"
 * ---------------------------------------------------------------------------
 * 服务端那份响应里的 `components` 恒为四格（`RANKED_STATUS_COMPONENTS` 定序与命名），
 * 上游少了某一格时那一行**照样在**、只是状态与时间是 `—`：
 *   · 悄悄少一行，用户以为"状态栏本来就长这样"（而少了的那一格可能正是他关心的那个）；
 *   · 把读不到的格子画成「故障」更糟 —— 那是替他断言一个我们并不知道的事实。
 * ⚠️★ `checkedAt` **原样显示**（不做时区换算，见 `types.ts` 那条长注释）：
 *    那串字符没有时区，`new Date()` 会按**本机**时区解释 ⇒ 显示值随机器漂（8 小时那种错）。
 *    这一格说的是"**上游那条心跳**自己是什么时候的"，而"这份数据有多旧"由外壳那一行
 *    `updatedAgoSecs` 回答（本地时钟算的）—— 两件事，各说各的。
 * ⚠️ `players` 的 `0` 与 `null` 是**两句不同的话**（「现在没有人在玩 Ranked」是真话，
 *    「人数暂时读不到」是另一件事）—— 这一条没被这次删减波及。
 */
export function RankedStatusView(props: RankedStatusViewProps) {
  const { t } = useTranslation();
  const { status, players, ...c } = props;

  if (!status) {
    return (
      <RankedChrome {...c}>
        {/* 第一次就没读到 ⇒ 外壳那两句（`bad` + 重试）已经把话说完了，这里不再多一句 */}
        {c.errorText === null ? <p className="state">{t('common.loading')}</p> : null}
      </RankedChrome>
    );
  }

  return (
    <RankedChrome {...c}>
      {/*
        ★★ ① 的区域标题（2026-09-16 评审补的一道）：②③④ 各自都从
        `<h2 className="ranked__title">` 开始，而 ① 原本是一颗徽章顶在最前面 ——
        一页里三个面板有标题、一个没有：读屏软件按标题跳转时会**跳过** ①，
        而那正是这一页第一件要说的事（服务是不是正常）。
        ⚠️★ 用**这一格自己的** `ranked.statusTitle`（「服务状况」），不借标签页那一格
        `ranked.tabStatus`（「状况」）：前者回答"这一块讲的是什么"，后者回答"点它去哪一页"，
        两者的读者与用途都不同 —— 借一次就把两个会各自被改的词绑成了一条。
      */}
      <h2 className="ranked__title">{t('ranked.statusTitle')}</h2>
      {/*
        ★★ 响应里的 `stale: true` —— **服务端**拿了兜底（上游那一刻读不到 ⇒ 回上一次的
        成功心跳），而**我们这一次**的请求是**成功**的（200，不是失败）。
        ⚠️★ 它与外壳那句 `ranked.refreshFailed`（「上次刷新失败了，下面是 N 秒前的数据」）
        **不是**一件事：混成一句会让用户去查一个没发生过的网络问题（他以为是自己的网断了），
        而真相是服务端替我们兜了底。
        ⚠️ 没有它的话，一次兜底的心跳与一次新鲜的心跳在界面上长得**一模一样**：
        徽章是绿的、`checkedAt` 是上游那串旧文本，而「N 秒前更新」说的是**我们这次请求**的年龄
        —— 三处都在说"没问题"，而这份数据最老可以到 10 分钟前。
        ⚠️ 位置紧贴在四行上面（不是放到面板末尾）：那四行说的是「正常」，
        而这一句限定的正是**那句断言的依据**（这份"正常"是旧的）—— 隔着一整个面板它就成脚注了。
        ⚠️ `info` 而不是 `bad`：这一次没有任何东西失败，也没有要用户做的事
        （`bad` 那一档是 `role="alert"`，会打断读屏）。
      */}
      {status.stale ? <Notice kind="info">{t('ranked.statusStale')}</Notice> : null}
      {/*
        ★★ 四行：名字 / 状态徽章 / 最后更新。一行的**三格**都在同一个 `<li>` 里
        （而不是"名字一列、徽章一列"的两张表）：四行是**四件独立的事**，
        每件都有自己的时间，读屏软件按列表项念时也是"这一件事：状态、时间"。
        ⚠️ `key` 用 `component.id`（上游的身份），不是下标：上游换了顺序时
        按身份复用 DOM，而不是把四行的内容整体错位一格。
      */}
      <ul className="ranked__components">
        {status.components.map((component) => (
          <li className="ranked__component" key={component.id}>
            <span className="ranked__compname">{t(component.nameKey)}</span>
            {/*
              ⚠️★ `state === null` ⇒ 占位符 `—` + **中性**的 `--unknown` 配色：
              它既不是"正常"也不是"故障"，而是"这一格这次没读到"。
              把它画成红色（`--down`）会让用户在一个上游少给一格的时候去查自己的服务。
            */}
            <span
              className={
                component.state === null
                  ? 'ranked__badge ranked__badge--unknown'
                  : `ranked__badge ranked__badge--${BADGE[component.state]}`
              }
            >
              {component.state === null ? t('ranked.unknown') : t(STATUS_KEYS[component.state])}
            </span>
            {/*
              ⚠️ 时间同样是"读不到就说读不到"：「最后更新 —」。
              没有这一格的话，一行「Game Server —」看不出是"没有状态"还是"什么都没有"。
            */}
            <span className="ranked__meta">
              {t('ranked.componentCheckedAt', { time: component.checkedAt ?? t('ranked.unknown') })}
            </span>
          </li>
        ))}
      </ul>
      {/*
        ★★ ② 人数那一块（2026-09-19 **第二轮**用户裁决：「去掉大数字1119，
        改为一个大标题『实时在线人数』，下面用加粗的绿色 mc 风格大字写上
        『1119 人正在玩 Ranked』」）。
        ⚠️★ 上一版是"一颗大号数字 + 下面一句说明"，这一版**把数字那一格删掉**、
        换成**区域标题**（与 ① 的「服务状况」同一个 `<h2>` 档）：
        数字与那句话本来就说着同一件事，而用户要的是一个**标题**——
        两行同样的信息里少一行，剩下的那一行才有地方变粗变大变绿。
        ⚠️ 标题与读数**是两条词条**（`playersTitle` / `players`）：标题答"这一块讲的是什么"，
        读数答"现在有多少人"。合成一条，下一个人改数字那句时会把标题一起改掉。
        ⚠️★ `null` 与 `0` 仍然是**两句不同的话**（这一条没被这次改版波及）：
        读不到 ⇒ 那一行是「人数暂时读不到」，而且**不戴**绿色（`--unknown` 用弱色）——
        绿色的"现在没有人在玩"与绿色的"读不到"长得一样时，用户会把我们没读到
        当成"上游真的没人"。
      */}
      <h2 className="ranked__title">{t('ranked.playersTitle')}</h2>
      <p
        className={
          players === null ? 'ranked__players ranked__players--unknown' : 'ranked__players'
        }
      >
        {players === null
          ? t('ranked.playersUnknown')
          : players === 0
            ? t('ranked.playersZero')
            : t('ranked.players', { n: players })}
      </p>
    </RankedChrome>
  );
}

// ---------------------------------------------------------------------------
// ② 实时高分对局
// ---------------------------------------------------------------------------

/**
 * 卡片上**有直播的那几侧**（左在前），并带上各自的链接。
 *
 * ⚠️★ 抽成一个函数，是为了让"展开直播（N 个）"那个 N 与下面真的渲染出来的框
 * 来自**同一次**计算（本文件头第 3 节那条纪律：分两处算就会出现"写着 2 个、
 * 只列了 1 个"的产物）。写成在 JSX 里数两遍（一次 `filter().length`、
 * 一次 `map()`）正是那种自相矛盾的来源。
 * ⚠️ 返回 `liveUrl: string`（不是 `string | null`）：判空在这里做掉，
 *    渲染那一层就不必再判一次 —— 而"再判一次"迟早会有一处忘了判。
 */
function streamedSides(
  match: RankedLiveMatch,
): { side: 'left' | 'right'; liveUrl: string; nickname: string | null }[] {
  const [left, right] = match.players;
  const out: { side: 'left' | 'right'; liveUrl: string; nickname: string | null }[] = [];

  for (const entry of [
    { side: 'left', player: left },
    { side: 'right', player: right },
  ] as const) {
    if (entry.player.liveUrl !== null) {
      out.push({
        side: entry.side,
        liveUrl: entry.player.liveUrl,
        nickname: entry.player.nickname,
      });
    }
  }

  return out;
}

/**
 * 展开区里的**一侧**：能嵌就是"点一下才加载"的播放器，不能嵌就是一条外链。
 *
 * ⚠️★ `origin` 是 **prop**（一路从 `RankedLiveView` 传下来，容器给的是
 *    `window.location.hostname`）—— 这一层**不许**读 `location`：
 *    · 它对 Twitch 是**承重**的 `parent`（传错是**静默**拒播：黑框，看起来像网络问题），
 *      所以它确实必须是**运行时**的值（开发时 localhost、线上是真实域名，
 *      写死任何一个都会有一半的运行形态被平台拒掉）；
 *    · 但读全局变量的代价是**这条规则永远验不到**：渲染自检跑在 Node 里、`location`
 *      不存在 ⇒ 每一个 Twitch 夹具都落到 `no_origin` 那一支，而一条**不可能红**的守卫
 *      比没有守卫更坏（`docs/pending.md §5.63`）。变成 prop 之后脚本能喂
 *      `'mcsrhelper.com'`，"内嵌地址带对 `parent`"与"传错时不内嵌"两件都断言得动。
 *    ⚠️ 否决了"在这里读 `location` 并用 `?.` 兜底"（本文件上一版的写法）：
 *      那行 `?.` 换来的正是上面第二条 —— 一个永远绿色的分叉。
 * ⚠️ `title` 是**播放器的可访问名字**，说的是"播谁的"：门面自己会画平台徽章
 *    （那一条 key 在 `ClickToPlayEmbed` 里），所以这里只补上人是谁。
 *    昵称在形状里可以是 `null` ⇒ 落到 `ranked.unknown`，绝不渲染一个空的
 *    `title`（读屏软件那时只会念出一串控件类型，用户分不出这是哪一个）。
 */
function RankedStream({
  liveUrl,
  nickname,
  origin,
}: {
  liveUrl: string;
  nickname: string | null;
  origin: string;
}) {
  const { t } = useTranslation();
  const channel = rankedLiveChannel(liveUrl);
  const decision = channel === null ? null : liveEmbedDecision(channel, origin);

  /*
   * ⚠️ 判据写成 `decision?.embed === true`（而不是 `decision !== null && decision.embed`）：
   *    后者是 biome 的 `useOptionalChain` 要报的形状，而它给的还是**不安全**自动修复
   *    —— 写成可选链加一个显式的 `=== true`，两边都不欠。
   */
  if (channel !== null && decision?.embed === true) {
    return (
      <div className="ranked__stream">
        <ClickToPlayEmbed
          platform={channel.platform}
          /*
           * ⚠️ 地址由 `liveEmbedDecision` 给（它拼的才是各平台**实测能嵌**的那一个），
           *    这里一个字符都不拼；`src` 传进去之后组件就不再自己拼。
           */
          src={decision.url}
          /*
           * 门面上那串标识：视频 ID → 频道页没有"某一场"这个维度（`ClickToPlayEmbed`
           * 里写着空串 = 整格不画）→ 其余（Twitch 频道名 / B站房间号）就是标识本身。
           */
          idLabel={channel.liveVideoId ?? (channel.embedChannel ? '' : channel.handle)}
          title={nickname ?? t('ranked.unknown')}
          /* 直播没有起点偏移可言（那是点播才有的维度） */
          startOffsetSec={null}
        />
      </div>
    );
  }

  /*
   * 不能嵌（认不出的平台、或这条地址里没有可嵌的视频、或 Twitch 少了 origin）
   * ⇒ **外链 + 一句说明**（spec §6.3）。⚠️ 那句话说的是"**这条链接**不能内嵌"。
   * ⚠️ `rel` 用 `noreferrer`：这是上游给的**第三方链接**，而 `noopener` 独自
   *    挡不住 referrer 泄漏（本栏目的整个前提就是"访客的 IP 会到第三方"，
   *    能少给的就少给 —— 与直连层的 `referrerPolicy: 'no-referrer'` 同一条取舍）。
   */
  return (
    <p className="ranked__stream ranked__external">
      <a href={liveUrl} target="_blank" rel="noopener noreferrer">
        {t('ranked.liveExternal')}
      </a>
    </p>
  );
}

/**
 * 一场对局里的一侧：**名字 / elo / #排名 / 进度 / 时间**（用户原话的字段顺序）。
 *
 * ⚠️★ DOM 顺序**两侧完全一样**（镜像靠 `.ranked__side--right` 摆列，不靠换顺序）：
 *    · 读屏软件与渲染自检读到的都是"名字在前"——换 DOM 顺序的话，
 *      右半边在产物里会变成"从时间读到名字"，而那是另一句话；
 *    · 字段顺序是用户原话（spec §6.3），它说的是"每一侧的阅读顺序"，
 *      而"谁贴最外侧"是**版式**，两者不该互相绑。
 * ⚠️ `eloRank` 为 `null` ⇒ 印 `—`（不是 0、不是整格删掉）：未定级是**常态**
 *    （spec §10 第 6 条），删掉那一格会让左右不对称 —— 而对称正是这张卡片的形式。
 * ⚠️ `timelineType` 走 `timelineLabel()`：表里有的走词条、**不认识的原样印**、
 *    `null` 走占位符。直接 `t(...)` 会在上游加一个新节点时印出 `ranked.timeline.xxx`
 *    （裸 key 泄漏，spec §7.2 写着这一条为什么非有不可）。
 */
function RankedSide({ player, right }: { player: RankedLivePlayer; right: boolean }) {
  const { t } = useTranslation();
  const dash = t('ranked.unknown');

  return (
    <div className={right ? 'ranked__side ranked__side--right' : 'ranked__side'}>
      <p className="ranked__name">{player.nickname ?? dash}</p>
      <p className="ranked__elo">{player.eloRate ?? dash}</p>
      <p className="ranked__rank">
        {player.eloRank === null ? dash : `#${String(player.eloRank)}`}
      </p>
      <p className="ranked__progress">{timelineLabel(player.timelineType, t)}</p>
      <p className="ranked__mtime">
        {player.timelineTime === null ? dash : formatClock(player.timelineTime)}
      </p>
    </div>
  );
}

/**
 * 一张对局卡片：左半边 / 中间已进行的时间 / 右半边（镜像）+ 折叠的直播框。
 *
 * ⚠️ 中间那一格是**这一场比赛已经进行的时间**（`currentTime`），不是谁的节点时间 ——
 *    两侧各自的节点时间在各自那半边（用户原话的第五格）。
 * ⚠️ 整张卡片**一个 `liveUrl` 都没有** ⇒ 连展开键都不渲染（spec §6.3：不是一颗
 *    点不动的按钮）。一颗"展开直播（0 个）"的折叠标题比没有入口更坏：
 *    它看起来像有东西可看，点开是一个空框。
 * ⚠️ 折叠用原生 `<details>`：闭合时内容**仍然在 DOM 里** ⇒ 纯 SSR 的渲染自检
 *    看得见那几侧的门面/外链（`ShareMineBar` 的发布表单同一条做法），
 *    而**展开态**（`open` 属性）不在初始产物里 —— 自检断言的正是"初始不展开"。
 *    ⚠️ iframe 本身由 `ClickToPlayEmbed` 的 `useState` 挡着，SSR 里永远不会挂上去。
 */
function RankedMatch({ match, origin }: { match: RankedLiveMatch; origin: string }) {
  const { t } = useTranslation();
  const [left, right] = match.players;
  const streams = streamedSides(match);

  return (
    <li className="ranked__match">
      <RankedSide player={left} right={false} />
      <p className="ranked__mid">
        {t('ranked.matchTime', { time: formatClock(match.currentTime) })}
      </p>
      <RankedSide player={right} right />
      {streams.length > 0 ? (
        <details className="ranked__expand">
          <summary>{t('ranked.liveExpand', { n: streams.length })}</summary>
          {/*
            ⚠️ 顺序与上面两侧一致（左在前）：展开区里几个框长得一模一样，
            顺序是读者唯一能对上"这个是左边那个人的"的线索。
          */}
          <div className="ranked__streams">
            {streams.map((entry) => (
              <RankedStream
                key={entry.side}
                liveUrl={entry.liveUrl}
                nickname={entry.nickname}
                origin={origin}
              />
            ))}
          </div>
        </details>
      ) : null}
    </li>
  );
}

export type RankedLiveViewProps = RankedChromeProps & {
  /** 直连 `/live` 的解析结果（对局 + 人数）。`null` = 还没取到。 */
  live: RankedLiveData | null;
  /**
   * ★★ 嵌入页面的 host（容器传 `window.location.hostname`）—— Twitch 的 `parent`。
   *
   * ⚠️★ 它**必填**（`string`，不是 `string | null`、也不给缺省值），形状与理由跟
   *    `RankedChromeProps.onRetry` 那一条相同：忘接线时兜底值 `''` 会让 Twitch
   *    **静默**降级成外链（`liveEmbedDecision` 回 `no_origin`），而**所有门禁照样绿**
   *    —— 渲染自检断言的是"那儿有个外链"，它看不出那本该是个播放器。
   *    必填之后忘了传是**编译错误**。
   * ⚠️★ 为什么不在视图里读 `location`：渲染自检（Node）里没有 `location`
   *    ⇒ 每一个 Twitch 夹具都落到 `no_origin`，而"Twitch 必须带对 `parent`"这条
   *    **唯一静默失败**的规则（传错是拒播，不是报错）就永远没有被验证过。
   *    ⚠️ `apps/web/scripts/**` 不在 tsconfig 的 include 里 ⇒ 渲染脚本那一侧不受
   *    类型检查，它还要自己写一道运行时守卫（Task 8），两件事缺一不可。
   */
  origin: string;

  // -------------------------------------------------------------------------
  // ★★ 筛选条与分批：这三格状态**住在容器里**，视图只吃 props（下面是四格 + 两个动作）
  // -------------------------------------------------------------------------
  /*
   * ⚠️★ 为什么这四格是 props，而不是视图里的 `useState`：
   *    这一栏唯一的自动化断言是渲染自检，而它是 `renderToStaticMarkup` ——
   *    **不跑 effect、不点击、不打字**。状态住在视图里的话，自检能看到的**只有初始值**
   *    （空搜索词 + 开关关着 + 首批），于是"筛出 1 场"「双方都直播只剩那 1 场」
   *    「还有 7 场」这三件真正会出错的事**一个字都断言不到**，而一条不可能红的守卫
   *    比没有守卫更坏（`docs/pending.md §5.63`）。⇒ 状态上提一层，
   *    自检就能用**不同的 props**渲染出那三种状态并逐格断言（`③b` 那一节）。
   * ⚠️★ 四格与两个动作都**必填**，理由与上面 `origin` 逐字相同：
   *    可选 + 兜底（`query ?? ''`、`shown ?? <全部>`）会让"容器忘了接线"变成**静默**的
   *    —— 搜索框看着在、打进去没反应，而所有门禁照样绿。必填之后是**编译错误**
   *    （渲染脚本那一侧由 `assertPropsGiven` 兜着，它不受类型检查）。
   */
  /** 搜索框里的字（受控）。空串 = 不筛。 */
  search: string;
  onSearchChange: (value: string) => void;
  /** 「只看双方都在直播」开着没有。 */
  bothLiveOnly: boolean;
  onToggleBothLive: () => void;
  /** 已经显示几张卡片（容器从一批起，点一次「加载更多」加一批）。 */
  shown: number;
  onLoadMore: () => void;
};

/**
 * ② 实时高分对局（spec §6.3；2026-09-19 改版：全部展示 + 搜索 + 双方都直播）。
 *
 * ⚠️★ 排序、筛选与"取前 `shown` 张"全**在这里**一次算完（`sliceLiveMatches(live, …)`），
 *    与面板上那三处数字（共 N 场 / 符合条件 M 场 / 还有 K 场）用**同一份**结果
 *    （本文件头第 3 节那条纪律：分两处算就会出现自相矛盾、而没有门禁看得见）。
 * ⚠️ 空集合是**自己的话**（「现在没有直播中的对局。」）—— 它既不是"加载中"
 *    也不是"出错了"：三者的下一步完全不同（等 / 等 / 重试），
 *    合成一句会让用户对着一屏空白不知道该做什么。
 * ⚠️★ "**筛完一场不剩**"是**第四句**话（`ranked.liveNoMatch`），不是上面那一句：
 *    上游那一刻有 23 场对局、只是当前这个搜索词一场都没命中 —— 说「现在没有直播中的
 *    对局」是一句**假话**（用户会以为上游空了），而正确的那句要说的是"你的条件太窄了"。
 */
export function RankedLiveView(props: RankedLiveViewProps) {
  const { t } = useTranslation();
  const {
    live,
    origin,
    search,
    onSearchChange,
    bothLiveOnly,
    onToggleBothLive,
    shown,
    onLoadMore,
    ...c
  } = props;

  if (live === null) {
    return (
      <RankedChrome {...c}>
        {c.errorText === null ? <p className="state">{t('common.loading')}</p> : null}
      </RankedChrome>
    );
  }

  const slice = sliceLiveMatches(live, { query: search, bothLiveOnly, shown });

  return (
    <RankedChrome {...c}>
      <h2 className="ranked__title">{t('ranked.liveTitle')}</h2>
      {/*
        ★★ 筛选条：搜索框 + 「只看双方都在直播」。
        ⚠️★ 它**永远渲染**，包括"上游此刻一场都没有"与"筛完一场不剩"两档：
        藏起来的话，用户看到"没有符合条件的对局"却**找不到**那个条件在哪里
        （条件还在生效，只是入口没了），只能刷新整页 —— `CalendarSeriesSection`
        那一块的搜索框同一条口径（"包括匿名访客"）。
        ⚠️ 类名复用全站现成的那一套（`.filters` / `.filters__search` / `.tagchip`）：
        本仓的样式是全局的，而这一栏的类名清单是它与渲染自检 ⑧ 之间的接口 ——
        能不加就不加（`RankedRetry` 的注释里写着同一条取舍）。
        ⚠️★ 开关的"开着没有"必须走**同一份判据**的两个通道：`aria-pressed`（读屏软件）
        与 `tagchip--on`（眼睛）都取自 `bothLiveOnly`，不是两处各判一次 ——
        两处判开的话，某一次改动会让按钮**看起来**开着而读屏软件念成关着（或反过来），
        而那种自相矛盾没有任何门禁能发现（`CalendarFilters` 那颗开关写着同一句话）。
      */}
      <div className="filters">
        <div className="filters__search">
          {/*
            ⚠️ 可见文字只有占位符，标签走 `sr-only`：这一块上面已经有一个 `<h2>`，
            再挂一行看得见的「搜索」会让它看起来像第二个标题（与系列活动那一块同一条）。
            ⚠️ `htmlFor` / `id` 成对写：占位符在输入第一个字之后就消失了，
            那是控件**唯一**的名字 —— 只给占位符不给标签，读屏软件会念出一个无名输入框。
          */}
          <label className="sr-only" htmlFor="ranked-live-q">
            {t('ranked.liveSearch')}
          </label>
          <input
            id="ranked-live-q"
            type="search"
            value={search}
            placeholder={t('ranked.liveSearch')}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
        <button
          type="button"
          className={bothLiveOnly ? 'tagchip tagchip--on' : 'tagchip'}
          aria-pressed={bothLiveOnly}
          onClick={onToggleBothLive}
        >
          {t('ranked.liveBothLive')}
        </button>
      </div>
      {slice.total === 0 ? (
        <p className="ranked__empty">{t('ranked.liveEmpty')}</p>
      ) : (
        <>
          {/*
            ⚠️ 「共 {{total}} 场」只在**有**场次时渲染：空集合那两句话（"共 N 场" +
            "现在没有对局"）里的前一句在 N = 0 时是一句废话，读起来像模板坏了。
            ⚠️★ 这里的 total 是**上游给的总场次**，不是筛后场次 —— 筛选生效时下面
            还会多一行说明（`ranked.liveMatched`），两者不许互相冒充。
          */}
          <p className="ranked__meta">{t('ranked.liveFrom', { total: slice.total })}</p>
          {slice.matched.length === 0 ? (
            /* ⚠️ 上游有场次、只是被筛没了 ⇒ 这是**另一句话**（见函数上方那一段） */
            <p className="ranked__empty">{t('ranked.liveNoMatch')}</p>
          ) : (
            <>
              {/*
                ⚠️★ 只有**筛掉过东西**时才渲染这一行：没筛时它会把总数再说一遍
                （"共 23 场 / 符合条件 23 场"），而那读起来像模板坏了。
                ⚠️ 判据是"筛后 < 总数"而不是"搜索词非空或开关开着"：后者在
                "搜索词打了一半、还没命中任何一场"时会渲染出两句互相打架的话。
              */}
              {slice.matched.length < slice.total ? (
                <p className="ranked__meta">
                  {t('ranked.liveMatched', { matched: slice.matched.length })}
                </p>
              ) : null}
              <ul className="ranked__live">
                {slice.visible.map((match) => (
                  /*
                   * ⚠️ key 用 `match.key`（两个 uuid 排序后拼起来，`types.ts` 里写着为什么
                   * 必须排序）：上游没有 match id，而左右两侧的 elo 一变就可能互换 ——
                   * 不排序的话 React 会把同一场比赛当成新的一场重建（展开的框会跟着塌掉）。
                   */
                  <RankedMatch key={match.key} match={match} origin={origin} />
                ))}
              </ul>
              {/*
                ★★ 「加载更多」**只在还有没渲染的场次时**渲染，而且把这个数印在按钮上。
                ⚠️★ 那个数来自 `slice.remaining`（与上面列表**同一次**计算）：写成
                `slice.matched.length - RANKED_LIVE_BATCH` 之类的第二份算式，筛完之后
                就会印出一个比实际还剩的更多的数（点一下什么都不会多出来）。
                ⚠️ 到头时**整颗按钮不渲染**（不是"渲染成禁用"）：一颗按下去什么都不会
                发生的按钮比没有按钮更坏 —— `RankedWeekNav` 的"到头了"那一格、
                以及 `ranked.liveExpand` 为什么不给"0 个"的入口，都是同一条。
                ⚠️ 那一行的类名复用 `.ranked__meta`（与失败屏的「重试」那一行同形）。
              */}
              {slice.remaining > 0 ? (
                <p className="ranked__meta">
                  <button type="button" className="ghostbtn" onClick={onLoadMore}>
                    {t('ranked.liveMore', { n: slice.remaining })}
                  </button>
                </p>
              ) : null}
            </>
          )}
        </>
      )}
    </RankedChrome>
  );
}

// ---------------------------------------------------------------------------
// ③ Elo 排行榜
// ---------------------------------------------------------------------------

export type RankedEloViewProps = RankedChromeProps & {
  /** 直连 `/leaderboard` 的解析结果。`null` = 还没取到。 */
  elo: RankedEloData | null;
  /**
   * ★ 赛季**赛段**（`/phase-leaderboard` 那一次 93 字节的请求）。
   *
   * ⚠️★ 它与 `elo` **各来各的**：那一次请求失败时它是 `null`，而**排行榜照常渲染**
   *    —— 用户要的是"赛季时间旁边并排显示赛段"，不是"用赛段换掉整张榜"。
   *    容器里那一路走的是 `{ fatal: false }`（辅助请求），所以它失败**也不会**
   *    在面板上多出一句"读不到数据"：那一句会让用户以为整页都废了。
   * ⚠️ 判据是"有没有赛段这一份"，不是"三格是不是都有值"：号数读得出、截止读不出
   *    时仍然要印得出那个号数（`parse.ts` 的三格各自可空）。
   */
  phase: RankedPhaseData | null;
};

/**
 * ③ Elo 排行榜（spec §6.4）：赛季 + 赛段（并排）+ 五列表格。
 *
 * ⚠️★ 排名列印的是上游的 **`eloRank`**，**不是下标 + 1**：并列会重复、之后会跳号
 *    （上游实测给的是 `…, 3, 3, 5, …`），下标会把它印成 `3, 4, 5` ——
 *    看起来更"正常"，而它是**错的**（第 4 名不存在，那两个是并列第 3）。
 * ⚠️★ 取前 150 用 `topEloEntries`：它**只截断不重排**（`select.ts` 里写着理由 ——
 *    上游已经按 eloRank 排好了，我们重排只会引入一种"两个都对却不一样"的顺序）。
 *    ⚠️ 150 **不是我们挑的数**：上游那份响应实测就是 150 条，而且 `count` / `page`
 *    被它静默忽略 ⇒ **没有"下一页"可翻**（`const.ts` 那个常量的注释写着这件事）。
 * ⚠️ 上游每条还带着 `country`：**我们不发也不显示**（spec §9 最后一行），
 *    所以它连我们的形状都没进（那条数据在 `parse.ts` 就被丢掉了）。
 */
export function RankedEloView(props: RankedEloViewProps) {
  const { t, i18n } = useTranslation();
  const { elo, phase, ...c } = props;

  if (elo === null) {
    return (
      <RankedChrome {...c}>
        {c.errorText === null ? <p className="state">{t('common.loading')}</p> : null}
      </RankedChrome>
    );
  }

  const users = topEloEntries(elo.users);
  const dash = t('ranked.unknown');
  /*
   * ⚠️ 两格各自判空（不是"整份有没有"）：上游的 schema 里 `number` / `endsAt` 就是可空的
   *    ⇒ 号数在读、截止读不出时，印「赛段 1」比印一句"读不到"更有用，而且是真话。
   * ⚠️★ 两格**都没有**（`phase` 是 `null`，或它三格全空）⇒ 说一句「赛段信息暂时读不到」：
   *    这一格**不静默消失** —— 用户明确要过这一份信息，凭空少一格与"上游没给"长得一样，
   *    而他不知道要重试还是该算了（spec §6.6 那条"失败要说具体"的同一条道理）。
   */
  const phaseNumber = phase?.number ?? null;
  const phaseEndsAt = phase?.endsAt ?? null;

  return (
    <RankedChrome {...c}>
      <h2 className="ranked__title">{t('ranked.eloTitle')}</h2>
      {/*
        ⚠️★ 赛季与赛段是**同一行里的四格**（`.ranked__meta` 是 flex + gap）——
        这就是用户说的「并排」：赛季号、赛季起止、赛段号、赛段截止，一行读完。
        分成两行会让"赛季"与"赛段"看起来是两件不相干的事，而赛段是赛季**内部**的划分。
        ⚠️ 词条是四个（spec §7.3），合成一句就要自己拼一个分隔符 ——
        而分隔符是排版，不是文案（间隙就是分隔符）。
      */}
      {/*
        ⚠️★ 赛季那一行（2026-09-19 **第二轮**用户裁决）：
        「赛季 12 2026/9/17 → 2026/12/30 **去掉起始时间**，改为
        『赛季 12 结束时间 2026/12/30 赛段 1 结束时间 2026/9/30』」。
        ⇒ 三处改动，**只有一处是排版**：
          · `seasonRange`（「{{from}} → {{to}}」）整条词条删掉、换 `seasonEndsAt`；
          · 赛段那一格从「结束 {{when}}」改成「结束时间 {{when}}」（两处同一个说法）；
          · 「并排」这件事一个字没动 —— 四格仍在**同一个** `<p className="ranked__meta">` 里
            （渲染自检 `metaOf(elo)[0]` + `metaOf(elo).length === 1` 钉着它）。
        ⚠️ 上游那份响应里的 `startsAt` **照旧解析**（形状那一条没改），只是不再显示：
        "不显示"与"不读"是两件事，改错一处会让 shared 的形状测试无谓地红。
        ⚠️ 赛段那三格各自可空这件事同样没变（`number` / `endsAt` 上游就是可空的）。
      */}
      <p className="ranked__meta">
        <span>{t('ranked.season', { n: elo.season.number })}</span>
        <span>
          {t('ranked.seasonEndsAt', {
            /*
             * ⚠️★ `i18n.language` 一路传进 `localDate`：日期的**语言**必须跟着界面走，
             *    不能跟宿主机器（见函数上方那段）。
             */
            when: localDate(elo.season.endsAt, i18n.language),
          })}
        </span>
        {phaseNumber === null && phaseEndsAt === null ? (
          <span>{t('ranked.phaseUnknown')}</span>
        ) : null}
        {phaseNumber === null ? null : <span>{t('ranked.phase', { n: phaseNumber })}</span>}
        {phaseEndsAt === null ? null : (
          <span>{t('ranked.phaseEndsAt', { when: localDate(phaseEndsAt, i18n.language) })}</span>
        )}
      </p>
      {users.length === 0 ? (
        <p className="ranked__empty">{t('ranked.eloEmpty')}</p>
      ) : (
        /*
         * ⚠️★ 外面这一层是**窄屏兜底**（2026-09-16 终审）：五列 + 每格 12px 的左右内边距
         *    在 ~320px 上装不下，一个长昵称就够把**整页**顶出一条横向滚动条。
         *    规则写在 `styles.css` 的 `.ranked__tablescroll` 上（本仓样式是全局的，
         *    渲染了一个没有规则的类名不会有任何报错 —— 本栏目的渲染自检 ⑧ 逐个断言）。
         */
        <div className="ranked__tablescroll">
          <table className="ranked__table">
            <thead>
              <tr>
                <th>{t('ranked.colRank')}</th>
                <th>{t('ranked.colNickname')}</th>
                <th>{t('ranked.colElo')}</th>
                <th>{t('ranked.colHighest')}</th>
                <th>{t('ranked.colPhasePoint')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                /*
                 * ⚠️ key 不取下标：`eloRank` 会**并列**（同一名次两行），所以名次自己
                 * 也唯一不了 —— 加上昵称之后才唯一（同一份榜单里一个玩家只出现一次）。
                 * ⚠️ `highest` / `phasePoint` 在赛季刚开时是 0 或 `null`：
                 *    `null` 印占位符，`0` 是**真的值**（spec §10 第 7 条）。
                 */
                <tr key={`${String(user.rank ?? 'x')}:${user.nickname ?? ''}`}>
                  <td>{user.rank ?? dash}</td>
                  <td>{user.nickname ?? dash}</td>
                  <td>{user.eloRate ?? dash}</td>
                  <td>{user.highest ?? dash}</td>
                  <td>{user.phasePoint ?? dash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </RankedChrome>
  );
}

// ---------------------------------------------------------------------------
// ④ 周赛榜单
// ---------------------------------------------------------------------------

export type RankedWeeklyViewProps = RankedChromeProps & {
  /**
   * 那一周的榜单。⚠️ `id` 用的是**响应里**那个（请求"本周"会拿到 103），
   * 显示与翻页都从它出发 —— 不是 URL 里那个（spec §6.5）。
   */
  weekly: RankedWeeklyData | null;
  /** 最新一周的 id（`/weekly-race` 不带 id 那一次响应给的）。`null` = 还不知道。 */
  latestId: number | null;

  // -------------------------------------------------------------------------
  // ★★ 2026-09-19 用户要求的两件东西：**手输周数跳转** + 「本周」
  // -------------------------------------------------------------------------
  /*
   * ⚠️★ 输入框里的字与那一句"输入不合法"的提示都**住在容器里**（与 ② 的三格状态同一条
   *    理由，`RankedLiveViewProps` 上写着全文）：这一栏唯一的自动化断言是渲染自检，
   *    而它是 `renderToStaticMarkup` —— **不跑 effect、不点击、不打字**。
   *    状态住在视图里的话，自检能看到的只有初始值（空框、没有错误），
   *    于是"输了个字母之后屏幕上说什么"**一个字都断言不到**（而那是这次要求的重点）。
   * ⚠️ 两格 + 两个动作都**必填**：可选 + 兜底会让"容器忘了接线"变成静默的
   *    —— 输入框看着在、按了跳转什么都不会发生，而所有门禁照样绿。
   */
  /** 输入框里的字（受控）。⚠️ 是**字符串**：用户打进来的东西原样留着，由纯函数判它。 */
  weekInput: string;
  onWeekInputChange: (value: string) => void;
  /** 按了「跳转」/ 在输入框里回车 —— 判定与导航都由容器做（`parseWeekInput`）。 */
  onWeekJump: () => void;
  /** 上一句判定不合法时的提示（**已经翻好的一句话**）；`null` = 没有要说的话。 */
  weekError: string | null;
};

/**
 * ★★ 「输进来的周数不合法」→ 词条 key（**导出的表**：渲染自检逐格查两种语言）。
 *
 * 两档分开的理由是**用户下一步做的事不同**：
 *   · `not_a_number` —— 他打错了（或者还没打），该说的是"请输入一个周数"；
 *   · `no_such_week` —— 他打的是一个**真的不存在**的周（0 是"本周"的别名、`≤ -2`、
 *     比最新周还大）⇒ 说的是「没有这一周。」，而且**故意复用上游那一档的同一句话**
 *     （`ranked.errNotFound`）：上游对"不存在的周号"回的 400 说的正是这件事，
 *     我们本地判出来的同一件事没有理由换个说法 —— 换个说法会让用户以为
 *     "本地挡住"与"上游没有"是两种不同的处境，而它们是同一件事。
 * ⚠️ 表里存的是**词条 key**（`t()` 在渲染点调用），与 `STATUS_KEYS` 同一条做法。
 * ⚠️★ 这张表**不在** `services/api/src/i18n-keys.test.ts` 的覆盖范围里（它扫的是
 *    源码里的**字面量** `t('…')` 调用，而这里的值是表里的值）⇒ 表里少一条，
 *    界面上会直接印出裸 key 而门禁全绿（本仓在标签页那四条上量到过同一个坑）。
 *    渲染自检 ⑤b 逐条查两种语言。
 */
export const WEEK_INPUT_ERROR_KEYS: Record<'not_a_number' | 'no_such_week', string> = {
  not_a_number: 'ranked.weeklyBadNumber',
  no_such_week: 'ranked.errNotFound',
};

/**
 * ④ 周赛榜单（spec §6.5，**2026-09-19 改版**）：顶部一行导航（翻页 + 跳转 + 本周）→
 * 周数 / 截止 → 四个种子 → 五列表格。
 *
 * ---------------------------------------------------------------------------
 * ★★ 用户原话：「周赛将'上一周/下一周'移至顶部，并允许用户直接输入对应周的数字跳转，
 *    添加'本周'按钮」
 * ---------------------------------------------------------------------------
 * ⇒ 那一行 `<nav>` 从**表格下面**搬到了**面板最上面**（紧跟 `<h2>`）：
 *   它是这一页的**导航**，而"翻到下一周"这件事在原来的位置要先滚过 50 行成绩才够得到。
 *   ⚠️ 搬的是**位置**，判据一个字没改（还是 `prevWeekId` / `nextWeekId` 那两个纯函数）。
 *
 * ⚠️★ 周数走 `displayWeekNo()`：上游把"第 0 周"记成 `-1`（唯一的负周），
 *    照原样印会让界面出现「第 -1 周」—— 那是上游的下标，不是任何人心里的周数。
 * ⚠️★ 翻页走 `prevWeekId` / `nextWeekId`（**不是** `id ± 1`）：那两个函数结构上
 *    跨过 0，因为 0 在上游是"本周"的别名 —— 拼出 `id = 0` 的链接会让 URL 写着 0、
 *    屏幕上是第 103 周的数据。它们返回 `null` 时这一格渲染成**不可点的一格**
 *    （不是一条会 400 的链接）。
 * ⚠️★ 手输那个框**不发请求**：`onWeekJump` 先过 `parseWeekInput`（纯函数，
 *    被 `ranked-shared.test.ts` 逐值钉住），不合法就**一个字都不发出去**、
 *    只把一句话放到框下面。键盘路径是**原生**的：输入框与按钮在同一个 `<form>` 里，
 *    回车提交表单 ⇒ 走同一个 `onWeekJump`（没有第二份"回车时该怎么办"的代码）。
 */
export function RankedWeeklyView(props: RankedWeeklyViewProps) {
  const { t, i18n } = useTranslation();
  const { weekly, latestId, weekInput, onWeekInputChange, onWeekJump, weekError, ...c } = props;

  if (weekly === null) {
    return (
      <RankedChrome {...c}>
        {c.errorText === null ? <p className="state">{t('common.loading')}</p> : null}
      </RankedChrome>
    );
  }

  const dash = t('ranked.unknown');
  const prev = prevWeekId(weekly.id);
  /*
   * ⚠️ `latestId` 还没到（历史周那一页要先取一次最新周才知道最新是几）时，
   *    **把手上这一周当成最新** ⇒ 「下一周」渲染成不可点的一格。
   *    否决了"没有 latestId 就自己拼 `id + 1`"：那个链接可能指向上游没有的一周
   *    （400「没有这一周」），而这一格存在的意义正是**不渲染一条会 400 的链接**。
   *    代价写在明面上：latestId 到货之前，本该可点的「下一周」会短暂灰着。
   */
  const next = nextWeekId(weekly.id, latestId ?? weekly.id);
  /*
   * ★★ 「本周」按钮的落点：**最新周号的路径**（用户："id 从周赛列表端点来"）。
   * ⚠️ `latestId` 还没到时回落到**不带周号的根路径** `/ranked/weekly` —— 那一条
   *    在上游永远是"此刻的周"（spec §6.5：它不带 id，刷新时始终指向当前周）。
   *    不回落到根路径的话，这个按钮在那一瞬间要么不可点（用户什么也做不了）、
   *    要么得**猜**一个周号（猜错就是"URL 写着 103、屏幕上却是 104"，正是 0 那个坑的形状）。
   *    ⚠️ 两者都指向"本周"，所以这不是两个不同的功能：有号码时用号码（可分享、可刷新），
   *    没有号码时用根路径（上游自己回答"此刻是第几周"）。
   */
  const thisWeekTo = latestId === null ? '/ranked/weekly' : weekPath(latestId);
  /*
   * ⚠️★ 这一行不是多余的临时变量：它的**类型**就是"顺序数组覆盖了形状里每一格种子"
   *    那条编译期断言（见 `OrderedWeeklySeedFields`）—— 形状里加第五格种子、
   *    而 `WEEKLY_SEED_ORDER` 没跟上时，这一行是从 `readonly WeeklySeedField[]`
   *    塌成 `never` 的地方，报错也就落在这里。
   */
  const order: OrderedWeeklySeedFields = WEEKLY_SEED_ORDER;

  return (
    <RankedChrome {...c}>
      <h2 className="ranked__title">{t('ranked.weeklyTitle')}</h2>
      {/*
        ★★ 顶部这一行：上一周 / 下一周 / 手输周数 + 跳转 / 本周。
        ⚠️ 顺序是"翻页 → 跳转 → 回本周"：从左到右是**从近到远**的三种动作
        （相邻的一周 / 任意一周 / 回到此刻），而"本周"放在最后是因为它是**兜底**动作
        （用户翻到 60 周以后最想按的就是它）。
        ⚠️ 三格按钮的类名沿用现成的 `.ranked__navbtn`（真链接长得像按钮）：
        新造一个"次级按钮"类名意味着 `styles.css` 里多一条只差一个像素的规则
        （本仓对"同一栏目的按钮长得不一样"有记录）。
      */}
      <nav className="ranked__weeknav">
        {prev === null ? (
          <span className="ranked__navbtn ranked__navbtn--off">{t('ranked.weeklyPrev')}</span>
        ) : (
          <Link className="ranked__navbtn" to={weekPath(prev)}>
            {t('ranked.weeklyPrev')}
          </Link>
        )}
        {next === null ? (
          <span className="ranked__navbtn ranked__navbtn--off">{t('ranked.weeklyNext')}</span>
        ) : (
          <Link className="ranked__navbtn" to={weekPath(next)}>
            {t('ranked.weeklyNext')}
          </Link>
        )}
        {/*
          ★ 手输跳转。⚠️ 是一个 `<form>` 而不是"一个输入框 + 一颗按钮各挂一个 handler"：
          回车提交表单是**浏览器原生**的行为，也就是用户说的"键盘路径"
          （`type="submit"` 那颗按钮就是它的提交按钮）。自己监听键盘要处理
          IME / 回车 / 小键盘，而漏掉任何一种的表现都是"回车没反应"。
          ⚠️ `onSubmit` 里**必须** `preventDefault`：不写的话表单会按默认行为
          导航到当前 URL（整页刷新），而 SPA 里的状态（含这一页的数据）会全部丢掉 ——
          表现是"按了回车之后页面闪一下、回到加载中"。
          ⚠️ `type="text"` + `inputMode="numeric"`，**不是** `type="number"`：
          number 输入框会把字母**吃掉**（用户打的 `abc` 直接消失、值变成空串）⇒
          我们就没法说"请输入一个周数"了，只能对着一句"空"发呆。
          ⚠️ 输入框用 `<label class="sr-only">` 给它一个**可访问名字**（占位符在输入第一个字
          之后就没了）；`htmlFor` / `id` 成对写（与 ② 的搜索框同一条）。
        */}
        <form
          className="ranked__weekjump"
          onSubmit={(event) => {
            event.preventDefault();
            onWeekJump();
          }}
        >
          <label className="sr-only" htmlFor="ranked-week-jump">
            {t('ranked.weeklyJump')}
          </label>
          <input
            id="ranked-week-jump"
            type="text"
            inputMode="numeric"
            value={weekInput}
            placeholder={t('ranked.weeklyJump')}
            onChange={(event) => onWeekInputChange(event.target.value)}
          />
          <button type="submit" className="ghostbtn">
            {t('ranked.weeklyJumpGo')}
          </button>
        </form>
        {/* ★ 用户要的「本周」：真链接（可刷新、可分享），落点见上面那一段 */}
        <Link className="ranked__navbtn" to={thisWeekTo}>
          {t('ranked.weeklyThisWeek')}
        </Link>
      </nav>
      {/*
        ⚠️★ 判定不合法的那一句话紧贴在导航**下面**（不是塞进导航那一行里）：
        它说的是"你刚才打的那个数"，而导航那一行是三个可以继续点的动作 ——
        混在一行里，读屏软件会把一句话念成第四颗按钮。
        ⚠️ 它不是 `Notice`（那一条会带 `role="alert"` 或一块底板）：这是一句**就地**的提示，
        不是需要打断朗读的故障（用户就在输入框旁边，看得见）。
      */}
      {weekError === null ? null : <p className="ranked__jumperror">{weekError}</p>}
      <p className="ranked__meta">
        <span>{t('ranked.weeklyNumber', { n: displayWeekNo(weekly.id) })}</span>
        {/*
         * ⚠️★ 截止时刻的**语言**跟着界面走（`i18n.language`），不跟宿主机器。
         */}
        <span>
          {t('ranked.weeklyEndsAt', { when: localDateTime(weekly.endsAt, i18n.language) })}
        </span>
      </p>
      {/*
        ★ 四个种子：一个 `<dl>`（标签 + 值成对）—— 复用 `.infotable` 那一套
        （`dt` / `dd` 由这一块的规则排），所以不必为一个四格的行新造类名。
        ⚠️ 值走**原样**：种子是 64 位整数（19 位数字），`Number()` 会静默改值
        （`components/SeedResultCard.tsx` 的文件头记着这件事），
        而这里它本来就是字符串 —— 从解析层到界面一个字都没被转换过。
        ⚠️★ 上面那一行是这个四格的**总称**（`ranked.weeklySeed` =「种子」）：
        上一行的 `weeklyNumber` / `weeklyEndsAt` 说的是"哪一周、什么时候截止"，
        下面四格是"这一周用的是哪几个种子"，它们需要一个标题；而 `<dl>` 里**没有**
        放标题的元素（HTML 只允许 `dt` / `dd` / `div`）⇒ 它是 `<dl>` 的兄弟、
        紧贴在它上面（`.ranked__meta` 那一行的度量正好比种子标签弱一档）。
        ⚠️ 这条词条在 2026-09-16 的评审里差点因为"没有渲染点"被删（与 `liveCollapse`
        同一条口径）—— 现在它有消费者了，**不许**再留着它不用。
      */}
      <p className="ranked__meta">{t('ranked.weeklySeed')}</p>
      <dl className="ranked__seeds">
        {order.map((field) => (
          /* ⚠️ 一个 `<div>` 包一对 `dt`/`dd`（`<dl>` 允许这种 wrapper）：
             不包的话四个标签排成一行、四个值排成另一行，而它们是一一对应的四对。 */
          <div key={field}>
            <dt>{t(WEEKLY_SEED_LABEL_KEYS[field])}</dt>
            <dd>{weekly.seed[field]}</dd>
          </div>
        ))}
      </dl>
      {weekly.entries.length === 0 ? (
        <p className="ranked__empty">{t('ranked.weeklyEmpty')}</p>
      ) : (
        /* ⚠️★ 与 ③ 同一层窄屏兜底（`.ranked__tablescroll`），理由见那一处 */
        <div className="ranked__tablescroll">
          <table className="ranked__table">
            <thead>
              <tr>
                <th>{t('ranked.colRank')}</th>
                <th>{t('ranked.colNickname')}</th>
                <th>{t('ranked.colTime')}</th>
                <th>{t('ranked.colElo')}</th>
                <th>{t('ranked.colEloRank')}</th>
              </tr>
            </thead>
            <tbody>
              {weekly.entries.map((entry) => (
                /*
                 * ⚠️ 时间走 `formatRaceTime`（`4:04.241`）：周赛成绩是**毫秒级**的
                 *    名次之争，少了那三位就分不出先后（对局已进行的时间用
                 *    `formatClock`，它到秒就够了 —— 两个函数各自钉在 `time.ts` 里）。
                 * ⚠️ `eloRate` / `eloRank` 为 `null`（未定级）⇒ 占位符，不删列。
                 */
                <tr key={`${String(entry.rank)}:${entry.nickname ?? ''}`}>
                  <td>{entry.rank}</td>
                  <td>{entry.nickname ?? dash}</td>
                  <td>{formatRaceTime(entry.timeMs)}</td>
                  <td>{entry.eloRate ?? dash}</td>
                  <td>{entry.eloRank ?? dash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/*
        ⚠️★ 这里**原来**是那一行翻页导航（上一周 / 下一周）—— 2026-09-19 用户要求把它移到
        **顶部**，它现在就在 `<h2>` 下面那一行（含手输跳转与「本周」）。
        别把它加回来：两处导航会各自漂（一处的边界判据改了、另一处没改），
        而"下面那一行还能点"会让用户以为两台不同的东西。
      */}
    </RankedChrome>
  );
}
