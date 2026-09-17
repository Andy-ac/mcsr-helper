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
 * ★★ ③ 的行内展开：那一格 elo **只能**来自 `changes[]`（本轮唯一的红线）
 * ===========================================================================
 * `players[].eloRate` 是**请求那一刻的现值**，不是那一场比赛当时的值 —— findings §2.1
 * 底部用三场真实比赛量过（一场 season 11 的比赛里，双方那一格印的还是本赛季**现在**的 elo，
 * 而同一场的 `changes[].eloRate` 才是赛后值）。⇒ 展开区里**任何位置**都不许把它当成
 * "当时的 elo"印出来；那一格的涨跌只由 `eloChangeOf()`（`changes[].change`）给，
 * 读不到（私人房实测 `changes: []`）就印「—」，**不许填 0**：0 的意思是"打了这一场、
 * 分数没变"，与"我们读不到变化"是两句不同的话（本仓那条"绝不为缺失值填 0"）。
 * ⚠️ 它防的是"把现值印成当时的值"，**防不了**"印错成赛后值"—— 后者由渲染自检里
 *    `eloChangeOf` 的逐值断言兜着（哨兵法：夹具把对手的现值设成一个不可能出现的数）。
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
import type { SeedRecord } from '@mcsr/shared';
import { liveEmbedDecision } from '@mcsr/shared/live';
import {
  displayWeekNo,
  eloChangeOf,
  filterEloUsers,
  formatClock,
  formatRaceTime,
  matchOutcome,
  nextWeekId,
  opponentOf,
  prevWeekId,
  RANKED_TABS,
  type RankedEloData,
  type RankedLiveData,
  type RankedLiveMatch,
  type RankedLivePlayer,
  type RankedPhaseData,
  type RankedPlayerDetail,
  /*
   * ⚠️★ 这个别名是**必须**的：本文件里已经有一个叫 `RankedMatch` 的**组件**
   *    （② 的那张对局卡片，`function RankedMatch`）—— 与上游那份比赛形状同名会让两件
   *    完全不同的事在同一个作用域里撞车（lint 的 noRedeclare 当场就红）。
   *    ⚠️ 改的是**导入名**：shared 的导出名与那个组件名都没有错，
   *    错的是把它们放进同一个作用域。
   */
  type RankedMatch as RankedPlayerMatch,
  type RankedStatusResponse,
  type RankedTab,
  type RankedWeeklyData,
  rankedLiveChannel,
  sliceLiveMatches,
  timelineLabel,
  topEloEntries,
  weekPath,
} from '@mcsr/shared/ranked';
import { Fragment, type ReactNode } from 'react';
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

// ---------------------------------------------------------------------------
// ③ 搜索框与行内展开（2026-09-19 用户要求的两件事）—— 词条表、状态形状、那一块标记
// ---------------------------------------------------------------------------

/**
 * 一场比赛的**结果** → 词条 key（`matchOutcome` 的四档）。
 *
 * ⚠️★ 导出（与 `STATUS_KEYS` 同一条理由）：**对调两行在全仓是静默的** —— 界面照样渲染、
 *    类型照样过（每一格都是 `string`）、门禁一个都不看它，而用户读到的是另一档的话
 *    （「胜」印成「负」在一张战绩列表里看起来完全正常，而它会改掉用户对这位玩家水平的判断）。
 *    ⇒ 送出去让渲染自检**逐格**断言它、并渲染四份产物确认四句话都在。
 */
export const OUTCOME_KEYS: Record<'win' | 'loss' | 'draw' | 'unknown', string> = {
  win: 'ranked.outcomeWin',
  loss: 'ranked.outcomeLoss',
  draw: 'ranked.outcomeDraw',
  unknown: 'ranked.outcomeUnknown',
};

/**
 * `match.type` → 词条 key（上游文档：1 casual / 2 ranked / 3 private / 4 event）。
 *
 * ⚠️★ 键的类型是 **`number`**，不是穷尽的 `Record<1 | 2 | 3 | 4, string>`：
 *    `RankedMatch.type` 是上游给的**自由数字**（`types.ts`：实测只见过 2 与 3）。
 *    写成四个字面量的 Record 会把"上游加了第五种类型"变成一句**编译错误** —— 而那时
 *    真正该发生的事是**界面照样有话说**（视图里那一条回落：印上游那个数字原样，
 *    与 `timelineLabel()` 对未登记标识的处置同一条），不是让这个文件编译不过。
 * ⚠️ 导出理由同上（对调两行是静默的）。
 */
export const MATCH_TYPE_KEYS: Record<number, string> = {
  1: 'ranked.matchTypeCasual',
  2: 'ranked.matchTypeRanked',
  3: 'ranked.matchTypePrivate',
  4: 'ranked.matchTypeEvent',
};

/**
 * 「回车 / 点查询」那一次的**三档**结果。
 *
 * ⚠️★ 后两档**不是**"请求失败"：它们是上游对**这个昵称**的确定回答（查无此人 / 昵称不合法），
 *    **重试永远是白试一次** —— 上游的查询是精确匹配（`lowk3y` 查不到 `lowk3y_`，
 *    findings §6）。所以它们在界面上是**两句话**、而且**没有重试按钮**，
 *    与 `errorText` 那一档（"这一次没成功，稍后再试"）是两件事。
 * ⚠️ 这个形状是**冻结的**（容器与渲染自检都按它写）：多一档意味着两边都要改。
 */
export type RankedLookup =
  | { kind: 'found'; user: RankedPlayerDetail }
  | { kind: 'not_found' }
  | { kind: 'invalid_identifier' };

/** 展开那一位的两份数据（`Promise.all` 一次拉回来的两份）。 */
export interface RankedDetailData {
  user: RankedPlayerDetail;
  matches: RankedPlayerMatch[];
}

/**
 * 展开那一位的**三档**状态。
 *
 * ⚠️★ `loading` / `failed` 是**两个不同的画面**，而且都不是"没有数据"：
 *    · `loading` ⇒ 复用既有的「加载中」那一句；
 *    · `failed` ⇒ 它自己的一句（与「最近没有比赛。」**不同**：一个该重试、一个是事实）。
 * ⚠️ 展开**没有**"查无此人"自己的一档（形状是冻结的三档）⇒ 上游回"没有这个玩家"时
 *    也落在 `failed` 上；代价写在 `ranked.detailFailed` 的词条注释里。
 */
export type RankedDetailState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; data: RankedDetailData };

/**
 * 每一场比赛那一行**右侧那颗按钮**的**四档**状态（2026-09-19 第四轮）。
 *
 * ---------------------------------------------------------------------------
 * ★★ 为什么"不在库里"是**自己的一档**，而不是 `failed` 的另一种说法
 * ---------------------------------------------------------------------------
 * 种子库只覆盖约 **80%** 的比赛（账本 `ranked-round4/progress.md` 与
 * `services/api/src/routes/seeds.ts` 的 404 都写着这一条）⇒ "这场没有种子"是**常态**，
 * 而"这一次没读到"是**故障**：两者的下一步相反（一个别再点了，一个值得再点一次）。
 * 合成一档之后，界面上只有一句话，而**没有任何门禁看得出来**它说错了哪一半
 * （`RankedSeedState` 的四档正是为此存在，两条词条 `seedNotFound` / `seedUnavailable`
 * 也是）。
 *
 * ⚠️★ 它**不是**容器里那三格 `Held`/`Loaded` 的同类：那三格是"这一页取到了什么数据"，
 *    这一格是"用户点开了哪一场、那一场读到了什么"。它与它们共用页章（`Held` + `mine()`）
 *    **不是**因为它是数据，而是因为"换页之后它不该再渲染"这件事的判据只有一处实现。
 * ⚠️ 这个形状是**冻结的**（容器与渲染自检都按它写）：多一档意味着两边都要改。
 */
export type RankedSeedState =
  | { kind: 'loading' }
  | { kind: 'ready'; seed: SeedRecord }
  | { kind: 'not_found' }
  | { kind: 'failed' };

/**
 * **按 `String(matchId)` 存**的一份种子状态（容器给视图的那一格）：
 * `null` = 这一页还没有任何一场被点开过。
 *
 * ⚠️★ 键必须是**字符串**（JS 对象的键只能是字符串）—— 所以视图这一侧查表时
 *    也必须 `String(match.id)`：一边 `String()` 一边不写，表现是"点了按钮什么都不出现"
 *    （查表永远落空），而每一格都合法、没有任何报错。
 * ⚠️ 值是**四档**而不是 `SeedRecord | null`：见 `RankedSeedState` 那一段
 *    （"不在库里"与"读不到"必须分得开）。
 */
export type RankedSeedStates = Record<string, RankedSeedState>;

/**
 * 那一行 / 那一位玩家的「点开 / 收起」入口。
 *
 * ⚠️★ 它是**按钮**，不是"整行可点"：`<tr>` 上没有可点语义，读屏软件也念不出来
 *    （用户点开的是"这一位玩家"，不是"这一行"）。
 * ⚠️★ `aria-expanded` 说的是"**这位玩家**的卡片开着没有"，不是"卡片开在**我这个位置**没有"
 *    （2026-09-19 终审的 Minor 订正的）：同一个人的卡片只渲染在**一处**（⑥ 钉着"恰好一块
 *    `.ranked__detail`"），但它可能不在**用户刚点的那颗按钮**旁边 —— 查到的玩家**同时**
 *    在榜上时，卡片落在**表格那一行**里，而 `.ranked__lookup` 里那颗按钮如果照旧念
 *    "已收起"，读屏软件会说一件假事（用户会以为那一下没生效，再点一次）。
 *    ⇒ 判据是"开着的**那个人**是不是我"，所以同一个人的两颗按钮会**都是 `true`** ——
 *    它们指向的是同一块内容，不是两块（三颗都写 `true` 才是要防的那件事：那意味着
 *    读屏软件以为有三块详情，而屏幕上只有一块）。
 * ⚠️ `type="button"`：万一哪天它被挪进某个 `<form>` 里，默认的 `submit` 会顺手提交那个表单。
 */
function RankedPlayerButton({
  nickname,
  expanded,
  onToggleDetail,
}: {
  nickname: string;
  expanded: boolean;
  onToggleDetail: (nickname: string) => void;
}) {
  return (
    <button
      type="button"
      className="ranked__playerbtn"
      aria-expanded={expanded}
      onClick={() => onToggleDetail(nickname)}
    >
      {nickname}
    </button>
  );
}

/**
 * 展开区里的**一场**比赛。
 *
 * ⚠️★ 这一行里**没有** `players[].eloRate` —— 见文件头那条红线：它是请求那一刻的**现值**，
 *    不是那一场当时的值。⇒ 这一格的 elo 只由 `eloChangeOf()` 给（`changes[].change`），
 *    私人房实测 `changes: []` ⇒「—」，**不是 0**（0 的意思是"打了这一场、分数没变"）。
 *    ⚠️ 代价写清：赛前 elo 上游**根本没给**（只有赛后值），我们不推算 —— 推算的算法会在
 *    私人房那 32 行上凭空造一个数出来。
 *
 * ---------------------------------------------------------------------------
 * ★★ 2026-09-19 第四轮：这一行变成**列对齐的 grid**，最右边多一颗「查种子」
 * ---------------------------------------------------------------------------
 * 用户原话「展开后的卡片对应信息版面**尽量对齐**」+「每个对局**右侧设置按钮**，
 * 点击根据 api 查询种子，展示在**对应比赛信息的下方**」。
 * ⚠️★ 八格**逐个占一条固定的轨道**（列宽写在 `styles.css` 的
 *    `.ranked__detailmatch` 上，`minmax()` 夹住上下界）：之前是 `flex-wrap` 自由流，
 *    每一场的"用时 / elo / 类型 / 种子"落在不同的横坐标上 —— 十来行战绩**读不出列**，
 *    而那正是这一轮要的东西。⚠️ 所以这里**不许**给某一格加"长度随内容"的写法
 *    （`auto` / `max-content`）：那等于把对齐逐行还原成"按内容算"。
 * ⚠️ `seedState` 与 `onToggleSeed` 是**两格 props**（不是在这里读容器）：
 *    视图是纯视图（`renderToStaticMarkup` 不跑 effect、不点击），状态住在容器里
 *    （`RankedEloViewProps.seeds` 上写着完整理由）。
 */
function RankedDetailMatch({
  match,
  selfUuid,
  seedState,
  onToggleSeed,
}: {
  match: RankedPlayerMatch;
  selfUuid: string;
  /** 这一场的种子面板开着没有 / 开到哪一档。`null` = 没点开（那一格整个不渲染）。 */
  seedState: RankedSeedState | null;
  onToggleSeed: (matchId: number) => void;
}) {
  const { t } = useTranslation();
  const dash = t('ranked.unknown');
  const opponent = opponentOf(match, selfUuid);
  const outcome = matchOutcome(match, selfUuid);
  const change = eloChangeOf(match, selfUuid);
  const typeKey = MATCH_TYPE_KEYS[match.type];
  /*
   * ⚠️ 两格种子都可能是 `null`（私人房实测两格都是 null）⇒ 读出哪几个印哪几个，
   *    一个都读不出时印「—」（印空串会让那一格看起来像"这一场本来就没有种子这一栏"）。
   * ⚠️ 值**原样**（上游的英文标识 `DESERT_TEMPLE` / `STABLES`），与直播那栏的
   *    `timelineType` 同一条处置：它们是种子/要塞的名字，不是可翻译的产品文案。
   */
  const seed = [match.seedType, match.bastionType]
    .filter((part): part is string => part !== null)
    .join(' · ');

  return (
    <div className="ranked__detailmatch">
      {/* ⚠️ 只有他一个人的那些行（实测 26/100，forfeit / bot 局）⇒ 没有对手 ⇒「—」 */}
      <span className="ranked__detailopp">{opponent === null ? dash : opponent.nickname}</span>
      <span className={`ranked__detailoutcome ranked__detailoutcome--${outcome}`}>
        {t(OUTCOME_KEYS[outcome])}
      </span>
      {/*
        ⚠️ `result.time` 是**毫秒**（`formatRaceTime` 就是干这个的；错当秒会印出 `0:05`）。
        ⚠️★ 它是上游 `result` 那一格的时间 —— 实测两场都满足 `result.time == completions[0].time`
        （findings §2.2，"Match detail" 那一节），也就是**这一场跑完的那个成绩**（胜者的）。
        ⇒ 负场那一行它印的是**对手**的成绩，而它仍然是"这一场的结果时间"：我们不改它的
        含义，也不把它藏起来（藏起来会让一行战绩只剩一个「负」字）。
        ⚠️ 它**不是**"这位玩家的用时"，所以这一格没有名字（要印他自己的用时，上游没给 ——
        这与"私人房没有 elo 变化"是同一类"上游根本没有"）。
        ⚠️ 形状上是 `| null`（实测 100 行里从没 null）⇒「—」，不编一个 0。
      */}
      <span className="ranked__detailtime">
        {match.result.time === null ? dash : formatRaceTime(match.result.time)}
      </span>
      {/*
        ★★ 这一格就是那条红线：`changes[]` 里**这位玩家**的变化量。
        ⚠️ 正数带 `+`：不带号时 `12` 读不出是涨还是跌，而同一列里负场印的是 `-8`。
        ⚠️ 读不到 ⇒「—」（私人房 `changes: []`；placement 的 `change` 是 null）。
        **绝不印 0**，也绝不拿同一行的 `players[].eloRate` 去凑一个数出来。
      */}
      <span className="ranked__detailelo">
        {change === null ? dash : change > 0 ? `+${String(change)}` : String(change)}
      </span>
      {/*
        ⚠️ 这一格印出来是为了解释**同一行里那两个「—」**：私人房（type 3）没有 elo 变化、
        也没有种子（两件事都是实测），而那与"这一栏没读到"在屏幕上长得一模一样
        （`ranked.matchTypePrivate` 的词条注释里写着同一段）。
        ⚠️ 认不出的类型印**上游那个数字**原样：印一句"未知"会把"上游加了新的比赛类型"
        这件事藏起来（与 `timelineLabel()` 的未知回落同一条处置）。
      */}
      <span className="ranked__detailtype">
        {typeKey === undefined ? String(match.type) : t(typeKey)}
      </span>
      <span className="ranked__detailseed">{seed === '' ? dash : seed}</span>
      {/*
        ⚠️★ 只在这个数组非空时渲染：实测 100 行里 64 行是空的、有录像的 36 行恰好 1 条 ⇒
        空数组就是"这场比赛没有录像"，而**一条指向空地址的「录像」比没有入口更坏**。
        ⚠️ `rel` 用 `noreferrer`（与 `RankedStream` 那条外链逐字相同）：这是上游给的
        第三方地址，而 `noopener` 独自挡不住 referrer 泄漏。
        ⚠️ 地址在 `parse.ts` 就被筛过（只认 http(s)）⇒ 上游的一个字段进不了 `<a href>`
        的伪协议位（`javascript:` 那一类；测试钉着这一条）。
        ⚠️★ 外层的 `<span>`（**无类名**）是 grid 需要的那一格：录像可以是 0 条、1 条或几条，
        而它们必须占**同一条轨道** —— 不包起来的话，有两个录像的那一场会把后面两格
        （以及那颗按钮）整体挤到下一行，于是"列"就只对齐到那一行为止。没有录像时
        这个 `<span>` 仍然在产物里（一个空的格子），所以列不会塌。
      */}
      <span>
        {match.vod.map((vod) => (
          <a
            key={vod.uuid}
            className="ranked__detailvod"
            href={vod.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('ranked.detailVod')}
          </a>
        ))}
      </span>
      {/*
        ★★ 最右那一列：**这一场**的种子按钮（用户原话「每个对局右侧设置按钮」）。
        ⚠️★ `aria-expanded` 的判据是**这一场自己的状态**（`seedState !== null`），
        不是"有没有别的场开着"：面板就渲染在这颗按钮下面那一行，读屏软件念错时
        用户点下去会觉得没生效（再点一次又把刚开的那一块收起来）。
        ⚠️ 这里**不**判 `loading` 之外的档：四档都算"开着"（`loading` 时面板里是
        「加载中」那一句，那也是开着的）—— 漏掉任何一档，那一档点开之后读屏软件
        会说"已收起"，而屏幕上明明长出了一块。
      */}
      <button
        type="button"
        className="ghostbtn ranked__seedbtn"
        aria-expanded={seedState !== null}
        onClick={() => onToggleSeed(match.id)}
      >
        {t('ranked.seedButton')}
      </button>
      {/*
        ★★ 面板落在**这一场比赛信息的下方**（用户原话）：它是 grid 里的下一行，
        并**横跨全部轨道**（`grid-column: 1 / -1`，写在 `styles.css` 上）——
        不横跨的话它会被塞进按钮右边那一列里，而那一列只剩几十像素。
        ⚠️★ 四档各有各的话（`RankedSeedState` 那一段写着为什么"不在库里"与"读不到"
        必须分开）：`loading` 复用既有的「加载中」，`not_found` 与 `failed` 两句
        **不同**，`ready` 才是三个种子值。
        ⚠️ 三个标签复用周赛那一组（`WEEKLY_SEED_LABEL_KEYS` 的前三条）：同一个东西
        （世界种子）在同一栏目里没有第二个说法，而**再写一张同值的表**等于两份会漂的真相。
        ⚠️★ `theEndSeed` 是 `string | null` ⇒ 那一格印「—」，**绝不**填 0 或空串
        （本仓那条"绝不为缺失值填 0"；空串会让三格里有一格看起来是"上游给了个空种子"）。
      */}
      {seedState === null ? null : (
        <div className="ranked__seedline">
          {seedState.kind === 'loading' ? <p className="state">{t('common.loading')}</p> : null}
          {seedState.kind === 'not_found' ? (
            <p className="ranked__seednote">{t('ranked.seedNotFound')}</p>
          ) : null}
          {seedState.kind === 'failed' ? (
            <p className="ranked__seednote ranked__seednote--failed">
              {t('ranked.seedUnavailable')}
            </p>
          ) : null}
          {seedState.kind === 'ready' ? (
            <dl className="ranked__seeds">
              <div>
                <dt>{t(WEEKLY_SEED_LABEL_KEYS.overworld)}</dt>
                <dd>{seedState.seed.overworldSeed}</dd>
              </div>
              <div>
                <dt>{t(WEEKLY_SEED_LABEL_KEYS.nether)}</dt>
                <dd>{seedState.seed.netherSeed}</dd>
              </div>
              <div>
                <dt>{t(WEEKLY_SEED_LABEL_KEYS.theEnd)}</dt>
                <dd>{seedState.seed.theEndSeed ?? dash}</dd>
              </div>
            </dl>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * 展开区**里面的内容**：三个画面各有各的话（`RankedDetailState` 的三档）。
 *
 * ⚠️ 它**只吃 state**（`selfUuid` 从 `state.data.user.uuid` 拿）：展开的两份数据是
 *    一次 `Promise.all` 拉回来的，分开传会让"用户是谁"有第二个来源 —— 而错的那一个
 *    会把对手的成绩算到他头上（`matchOutcome` / `opponentOf` / `eloChangeOf` 全靠它）。
 * ⚠️ `seeds` / `onToggleSeed`（2026-09-19 第四轮）在这里**逐场**取那一格：
 *    `seeds[String(match.id)]` —— 取不到就是 `undefined` ⇒ 当作"没点开"。
 *    ⚠️★ `seeds` 是 `Record | null`（`null` = 这一页还没点开过任何一场），
 *    **不是**可选 prop：它缺了（`undefined`）时 `seeds[key]` 会当场抛
 *    `TypeError: Cannot read properties of undefined` —— 那是**故意的**
 *    （渲染自检那一侧要看到它，见 `RankedEloViewProps.seeds`）。
 */
function RankedDetailBody({
  state,
  seeds,
  onToggleSeed,
}: {
  state: RankedDetailState;
  seeds: RankedSeedStates | null;
  onToggleSeed: (matchId: number) => void;
}) {
  const { t } = useTranslation();

  if (state.kind === 'loading') {
    /* ⚠️ 复用既有的那一句（用户要的"点开能看数据"在飞的时候，屏幕上要有话说） */
    return <p className="state">{t('common.loading')}</p>;
  }
  if (state.kind === 'failed') {
    return <p className="ranked__detailfailed">{t('ranked.detailFailed')}</p>;
  }

  const { user, matches } = state.data;
  const dash = t('ranked.unknown');

  return (
    <>
      {/*
        ★ 第一行：五格读数（用户说的"数据"）。⚠️ 每一个数**各自**判空、各自印「—」——
        上游 `statistics` 的每一格都是 `{ranked, casual}` 两个数，我们只取 `ranked`
        （`parse.ts` 的事），读不到就是 `null`，**绝不填 0**。
        ⚠️★ 类名是 `.ranked__detailstats`，**不是** `.ranked__meta`：渲染自检有一条
        `metaOf(elo).length === 1`（"赛季与赛段并排"那一格），它同时是"别人不许往这一栏里
        再塞一行读数"的守卫 ⇒ 度量取**同一档**（13px + `--fg-muted` + 同一条间隙），
        但类名必须不同。
        ⚠️★ 2026-09-19 第四轮把它从 `flex` 改成 **grid**（列宽写在 `styles.css` 上）：
        用户要"卡片对应信息版面尽量对齐"，而自由流下这五格在窄一点的地方换行之后，
        第二行的起点落在第一行中间 —— 同一个标签在两张卡片里不在同一列。
        ⚠️ 五格的**文字**仍然是那五条词条（`detailElo` 等，label 与 value 在同一条词条里，
        是 spec §7.3 冻结的）：这一轮改的是**排版**，不是文案 —— 把标签与值拆成两条词条
        会动到冻结的那张表（那是 T2 的文档 + 一次产品决定），收益只是"标签是 6rem 的
        独立一栏"，而那与"五格各自成列"是两件事。
      */}
      <p className="ranked__detailstats">
        <span>{t('ranked.detailElo', { elo: user.eloRate ?? dash })}</span>
        <span>{t('ranked.detailRank', { rank: user.eloRank ?? dash })}</span>
        <span>
          {t('ranked.detailSeasonRecord', {
            wins: user.season.wins ?? dash,
            loses: user.season.loses ?? dash,
          })}
        </span>
        <span>
          {t('ranked.detailTotalRecord', {
            wins: user.total.wins ?? dash,
            loses: user.total.loses ?? dash,
          })}
        </span>
        <span>
          {t('ranked.detailBestTime', {
            /* ⚠️ `bestTimeMs` 是**毫秒**（上游给的就是毫秒：实测 387772 = 6:27.772） */
            time: user.season.bestTimeMs === null ? dash : formatRaceTime(user.season.bestTimeMs),
          })}
        </span>
      </p>
      {/*
        ⚠️★ 这个 N 读的是**我们手上这份数组的长度**（`parseMatches` 会丢掉形状坏掉的行），
        不是请求里的 `count` —— 用 `count` 会印出「最近 10 场」而下面只有 8 条，
        而那种自相矛盾**没有任何门禁看得见**（`fetchRankedMatches` 的注释里写着同一件事）。
      */}
      <p className="ranked__detailtitle">{t('ranked.detailRecent', { n: matches.length })}</p>
      {matches.length === 0 ? (
        /* ⚠️ 复用既有的空态类名：这是"上游说他没有比赛"，不是"我们没读到" */
        <p className="ranked__empty">{t('ranked.detailNoMatches')}</p>
      ) : (
        matches.map((match) => (
          /* ⚠️ key 用 `match.id`（上游的比赛身份）：下标会让"上游删掉一场"整体错位一格 */
          <RankedDetailMatch
            key={match.id}
            match={match}
            selfUuid={user.uuid}
            seedState={seeds === null ? null : (seeds[String(match.id)] ?? null)}
            onToggleSeed={onToggleSeed}
          />
        ))
      )}
    </>
  );
}

/**
 * 一块展开出来的卡片（`.ranked__detail`）—— 三个渲染位置**共用**它。
 *
 * ⚠️ `collapse` 只有**表格下面那一块**（判据③）才为真：另外两处（表格那一行里、
 *    固定在最上面那一行里）都已经有一颗 `aria-expanded` 的昵称按钮（就是用户点的那一颗），
 *    再放一颗会让读屏软件念出两个长得一样的控件，而它们各自管的东西不同。
 * ⚠️ `seeds` / `onToggleSeed` 原样往下传（`RankedDetailBody` 那一段写着它们是什么）。
 */
function RankedDetailBlock({
  nickname,
  state,
  collapse,
  onToggleDetail,
  seeds,
  onToggleSeed,
}: {
  nickname: string;
  state: RankedDetailState;
  collapse: boolean;
  onToggleDetail: (nickname: string) => void;
  seeds: RankedSeedStates | null;
  onToggleSeed: (matchId: number) => void;
}) {
  return (
    <div className="ranked__detail">
      {collapse ? (
        <RankedPlayerButton nickname={nickname} expanded onToggleDetail={onToggleDetail} />
      ) : null}
      <RankedDetailBody state={state} seeds={seeds} onToggleSeed={onToggleSeed} />
    </div>
  );
}

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

  // -------------------------------------------------------------------------
  // ★★ 搜索框的两半 + 行内展开（2026-09-19）—— 五格状态 + 一个动作，全**必填**
  // -------------------------------------------------------------------------
  /*
   * ⚠️★ 为什么这几格是 props、而不是视图里的 `useState`（与 ② 的四格同一条理由）：
   *    这一栏唯一的自动化断言是渲染自检 `renderToStaticMarkup` —— **不跑 effect、
   *    不点击、不打字**。状态住在视图里的话，自检能看到的**只有初始值**（空搜索词、
   *    没查过、没展开），于是"筛出来几行"「查不到那个人」「展开出来三场比赛」
   *    这三件真正会出错的事**一个字都断言不到**（`docs/pending.md §5.63`：
   *    一条不可能红的守卫比没有守卫更坏）⇒ 状态上提一层，自检用**不同的 props**
   *    渲染出每一档并逐格断言。
   * ⚠️★ 六格都**必填**（不是可选、也不给"缺省时当作空"的兜底）：可选 + 兜底会让
   *    "容器忘了接线"变成**静默的** —— 搜索框看着在、打进去没反应、点了昵称也不展开，
   *    而所有门禁照样绿。必填之后忘了传是**编译错误**（渲染脚本那一侧由
   *    `assertPropsGiven` 那道运行时守卫兜着，它不受类型检查）。
   */
  /** 搜索框里的字（**只**管本地筛选；与下面那一次精确查询是两件事）。 */
  searchText: string;
  onSearchTextChange: (value: string) => void;
  /** 回车或点「查询」—— 精确查一位玩家（空串 ⇒ 清掉上一次查询，**不发请求**）。 */
  onSearchSubmit: () => void;
  /** 那一次精确查询的结果；`null` = 这一页还没查过（那时那一块**整个不渲染**）。 */
  lookup: RankedLookup | null;
  /** 正在展开的那一位玩家；`null` = 没有展开。 */
  detail: { nickname: string; state: RankedDetailState } | null;
  onToggleDetail: (nickname: string) => void;

  // -------------------------------------------------------------------------
  // ★★ 每一场比赛的种子（2026-09-19 第四轮）—— 一格状态 + 一个动作，**都必填**
  // -------------------------------------------------------------------------
  /*
   * ⚠️★ 名字是**冻结的**（渲染自检按它们写）：`seeds` / `onToggleSeed`。
   * ⚠️★ 为什么也是 props 而不是视图里的 `useState`：与上面那六格逐字相同
   *    （状态住在视图里的话，自检看到的**只有初始值** ⇒ 四档画面一个都断言不到）。
   * ⚠️★ `seeds` 的类型是 `RankedSeedStates | null`（**不是可选**）：
   *    `null` = 这一页还没点开过任何一场；**缺传**（`undefined`）时视图里
   *    `seeds[String(match.id)]` 会当场抛 `TypeError`（面板里那一行写着这件事）——
   *    这是**故意的**：`apps/web/scripts/**` 不受类型检查，少了这道运行时声响，
   *    "容器忘了接线"在产物里与接好线的**一模一样**（按钮点下去什么都没有）。
   */
  /** 按 `String(matchId)` 存的种子状态（容器已按页章过滤）；`null` = 这一页还没点开过。 */
  seeds: RankedSeedStates | null;
  /** 点某一场右侧那颗按钮：面板开着 ⇒ 收起；否则去取（同源，一次请求）。 */
  onToggleSeed: (matchId: number) => void;
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
  const {
    elo,
    phase,
    searchText,
    onSearchTextChange,
    onSearchSubmit,
    lookup,
    detail,
    onToggleDetail,
    seeds,
    onToggleSeed,
    ...c
  } = props;

  if (elo === null) {
    return (
      <RankedChrome {...c}>
        {c.errorText === null ? <p className="state">{t('common.loading')}</p> : null}
      </RankedChrome>
    );
  }

  const users = topEloEntries(elo.users);
  /*
   * ★★ 打字 ⇒ **本地**筛选（一个请求都不发）。
   * ⚠️★ 筛的是 `topEloEntries()` **之后**那 150 行（与下面真正渲染的是同一份）：
   *    反过来（先筛 160 条再截断）会让排名 151 的那一行在搜索词命中时冒出来 ——
   *    而它的排名列印的是上游给的 151，表格就再也不是"前 150"了。
   * ⚠️ 上游**没有**搜索/前缀端点（findings §7）⇒ 打字永远筛不出榜外的人；
   *    那件事由回车那一次直连负责。
   */
  const shown = filterEloUsers(users, searchText);
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

  /*
   * ★★ 2026-09-19 第四轮：**查到的玩家**（`lookup.kind === 'found'`）现在是**表里的一行**
   *    （固定在最上面，见下面 `<tbody>` 里那一行），所以展开的位置从"查询结果那一块里"
   *    变成了"**那一行之后**"。
   *
   * ---------------------------------------------------------------------------
   * ⚠️★ 判据仍然是三条、**按顺序**，而且是**互斥**的（同一屏恰好一块 `.ranked__detail`）
   * ---------------------------------------------------------------------------
   *   ① 表里有这一行（而且没被筛掉）⇒ 紧跟那一行之后（`<tr class="ranked__detailrow">`）；
   *   ② 否则，查到的正好是他 ⇒ 紧跟**固定那一行**之后（同一个 `<tr>`，同一张卡片）；
   *   ③ 否则 ⇒ 表格**下面**单独一块 `.ranked__detail`（第一行是可点收起的昵称按钮）。
   *
   * ⚠️★ 他**既被查到又在榜上**时会出现**两行**（固定那一行 + 他自己那一行）：
   *    这是用户当场拍的口径（"固定在最上面"）。两条判据谁赢是**有意的**：
   *    ①（榜上那一行）优先 —— 与 2026-09-19 终审那条 Minor 的裁决逐字一致
   *    （"卡片按**判据①**落在表格那一行里"），代价写在下面：
   *    **固定那一行上的按钮也会念"展开"**（`aria-expanded` 的判据是"他的卡片开着没有"，
   *    不是"卡片开在我这一块里没有"），而卡片长在下面那一行里。
   *    ⚠️ 反过来的排法（②优先）会让"点榜上那一行、卡片却长到表格最上面"，
   *    两处都躲不掉"卡片不在你点的那一行下面"，而这一版**不动**已经裁过的判据。
   *
   * ⚠️★ 为什么非要有②③（而不是"表里没有就不渲染"）：轮询每 60 秒**整份换掉** `elo`，
   *    那位玩家可能**掉出前 150**；搜索框又会把整张榜筛小。两种情况下他都可能不在表里 ——
   *    静默消失会让用户以为自己那一下没生效（他会再点一次，而那次点击落在别的东西上）。
   * ⚠️ 反过来，"被筛选筛掉了却还留在页面上"确实会让过滤看起来坏了 —— 两个方向都有代价；
   *    这里选**不消失**：这一块讲的是**那一位玩家**（不是这张榜的一部分），而一块
   *    点一下就凭空消失、又没有任何入口找回来的界面，比一次"过滤看起来没生效"更糟。
   */
  const open = detail;
  const openNickname = open === null ? null : open.nickname;
  /** 那一次查询查到的那位（`null` = 没查过 / 没命中）—— 固定那一行的数据来源。 */
  const lookedUp = lookup !== null && lookup.kind === 'found' ? lookup.user : null;
  const inTable = openNickname !== null && shown.some((user) => user.nickname === openNickname);
  const inLookup =
    !inTable && openNickname !== null && lookedUp !== null && lookedUp.nickname === openNickname;
  const belowTable = openNickname !== null && !inTable && !inLookup;

  /*
   * ★★ 表体本身（榜上的行 + **固定在最上面**的那一行）。
   *
   * ⚠️★ 抽成一个变量是**必须**的：它有两个渲染点（榜上有行时、以及"榜被搜索词筛空
   *    但查到的那位还要有自己那一行"时），而五列表格这一大块抄两遍必然会漂
   *    （本仓为"同一件事两份实现"吃过不止一次）。
   * ⚠️★ 外面这一层是**窄屏兜底**（2026-09-16 终审）：五列 + 每格 12px 的左右内边距
   *    在 ~320px 上装不下，一个长昵称就够把**整页**顶出一条横向滚动条。
   *    规则写在 `styles.css` 的 `.ranked__tablescroll` 上（本仓样式是全局的，
   *    渲染了一个没有规则的类名不会有任何报错 —— 本栏目的渲染自检 ⑧ 逐个断言）。
   */
  const table = (
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
          {/*
            ★★ 2026-09-19 第四轮：查到的玩家 = **表格里的一行**，而且是**最前面**那一行。
            ⚠️★ 五列与榜上的行**逐个同名同序**（排名 / 昵称 / elo / 最高 / 阶段分）——
            用户原话「页面布局和排行榜玩家相同（无论是展开前还是展开后）」：
            这就是"相同"可被检查的地方（多一列少一列、或者换一套标记，都还是"看得见"的
            差别，而这一行与那些行在 `styles.css` 里**共用同一条规则**）。
            ⚠️★ 值是 `null` 时印「—」（`dash`），**不是**空串、**不是** 0：
            那两列今天**各自**可空（`seasonHighest` / `seasonPhasePoint` 都能读不到）。
            ⚠️★ 判据②在展开那一块：他**不在**榜上时卡片就紧跟这一行（与榜上那三行同一套
            `<tr class="ranked__detailrow">` + `colSpan={5}`）；他在榜上时卡片归榜上那一行
            （见上面那三条判据的注释）。
            ⚠️★ 这一行**不是** `key` 化的列表项：它永远只有一行（那一次查询的结果），
            所以没有 React 的"错位一格"问题 —— 而它与榜上同一个人出现的两行是**两件事**
            （用户当场拍的口径："固定在最上面"）。
          */}
          {lookedUp === null ? null : (
            <Fragment>
              <tr className="ranked__row ranked__row--lookup">
                <td>{lookedUp.eloRank ?? dash}</td>
                <td>
                  <RankedPlayerButton
                    nickname={lookedUp.nickname}
                    /*
                     * ★★ 判据是"**他**的卡片开着没有"，不是"卡片开在**我这一行**下面没有"：
                     * 他在榜上时卡片按判据① 落在榜上那一行里 ⇒ 只按 `inLookup` 判的话
                     * 这一颗会念"已收起"，而用户刚点的那一下**就在这一行上**
                     * （读屏软件说一件假事，他会再点一次 —— 而那次点击把卡片收起来）。
                     * ⚠️ 同一个人的两颗按钮**都念"展开"**是对的：它们指向**同一块**内容
                     * （`.ranked__detail` 仍然恰好一块）。
                     */
                    expanded={openNickname === lookedUp.nickname}
                    onToggleDetail={onToggleDetail}
                  />
                </td>
                <td>{lookedUp.eloRate ?? dash}</td>
                <td>{lookedUp.seasonHighest ?? dash}</td>
                <td>{lookedUp.seasonPhasePoint ?? dash}</td>
              </tr>
              {/* 判据②：展开的那一位**正好就是查到的这一位**（而且不在榜上）⇒ 紧跟这一行 */}
              {inLookup && open !== null ? (
                <tr className="ranked__detailrow">
                  {/* ⚠️ 五列 ⇒ `colSpan={5}`，与榜上那一行里的展开行**逐字相同** */}
                  <td colSpan={5}>
                    <RankedDetailBlock
                      nickname={open.nickname}
                      state={open.state}
                      collapse={false}
                      onToggleDetail={onToggleDetail}
                      seeds={seeds}
                      onToggleSeed={onToggleSeed}
                    />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          )}
          {shown.map((user) => (
            /*
             * ⚠️ key 不取下标：`eloRank` 会**并列**（同一名次两行），所以名次自己
             * 也唯一不了 —— 加上昵称之后才唯一（同一份榜单里一个玩家只出现一次）。
             * ⚠️ `highest` / `phasePoint` 在赛季刚开时是 0 或 `null`：
             *    `null` 印占位符，`0` 是**真的值**（spec §10 第 7 条）。
             * ⚠️★ 外层是 `Fragment key=…`（不是 `<tr key=…>`）：展开时**紧跟那一行之后**
             *    要多出一个 `<tr class="ranked__detailrow">`，而一个 map 只能返回一个元素
             *    —— 两条 `<tr>` 必须共用同一把 key 才不会让 React 把展开那一行当成
             *    另一行的兄弟（表现是"点开之后行整体错位一格"）。
             * ⚠️★ `className="ranked__row"`（2026-09-19 第四轮加）贴在**榜上的每一行**上：
             *    与固定那一行的类名同一套（`ranked__row` / `ranked__row--lookup`），
             *    于是"两种行长得一样"这件事在 `styles.css` 里**只有一处**定义，
             *    而 `--lookup` 是**唯一**的差别（一条细细的左侧强调线）。
             */
            <Fragment key={`${String(user.rank ?? 'x')}:${user.nickname ?? ''}`}>
              <tr className="ranked__row">
                <td>{user.rank ?? dash}</td>
                <td>
                  {/*
                    ⚠️★ 可点的是**昵称那一格里的按钮**，不是整行（`<tr>` 上没有可点语义，
                    读屏软件也念不出来）—— 用户点开的是"这一位玩家"。
                    ⚠️ `nickname` 是 `| null`（形状如此）⇒ 那一格印「—」且**没有入口**：
                    上游那条查人的路径要的就是昵称，一个没有名字的玩家查不出任何东西
                    （做成按钮的话，点下去只会得到一次"没有这个玩家"）。
                  */}
                  {user.nickname === null ? (
                    dash
                  ) : (
                    <RankedPlayerButton
                      nickname={user.nickname}
                      expanded={openNickname === user.nickname}
                      onToggleDetail={onToggleDetail}
                    />
                  )}
                </td>
                <td>{user.eloRate ?? dash}</td>
                <td>{user.highest ?? dash}</td>
                <td>{user.phasePoint ?? dash}</td>
              </tr>
              {/* 判据①：展开的那一位**就在表里**（而且没被筛掉）⇒ 紧跟这一行 */}
              {open !== null && openNickname === user.nickname ? (
                <tr className="ranked__detailrow">
                  {/* ⚠️ 五列 ⇒ `colSpan={5}`：少一列会让整行挤在第一列里，而表格本身不会报错。
                      ⚠️ 实测（本机 React 19.3 的 `renderToStaticMarkup`）：产物里就是
                      `colSpan="5"`（**大小写照 JSX 原样**，不是 `colspan`）—— HTML 的属性名
                      不区分大小写，浏览器照样当 `colspan` 解；断言要按产物里那一串写。 */}
                  <td colSpan={5}>
                    <RankedDetailBlock
                      nickname={open.nickname}
                      state={open.state}
                      collapse={false}
                      onToggleDetail={onToggleDetail}
                      seeds={seeds}
                      onToggleSeed={onToggleSeed}
                    />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <RankedChrome {...c}>
      <h2 className="ranked__title">{t('ranked.eloTitle')}</h2>
      {/*
        ★★ 搜索框（用户原话：「在**顶部**设置搜索框允许用户自行搜索玩家」）。
        它的**两半**是两件不同的事，都写在下面那行提示里：
          · 打字 = 在**已经取到的那份榜**上本地筛选（上游没有搜索端点，findings §7）；
          · 回车 / 点「查询」= 精确查**一位**玩家（直连上游，花访客自己的额度）。
        ⚠️★ 它是一个 `<form>` 而不是"输入框 + 按钮各挂一个 handler"：回车提交表单是
        **浏览器原生**的行为（`type="submit"` 那颗按钮就是它的提交按钮）。自己监听键盘
        要处理 IME / 回车 / 小键盘，而漏掉任何一种的表现都是"回车没反应"
        （与 ④ 那个手输周号的框同一条，写法也照抄它）。
        ⚠️ `onSubmit` 里**必须** `preventDefault`：不写的话表单会按默认行为导航到当前 URL
        （整页刷新），SPA 里的状态（含这一页的数据）会全部丢掉 —— 表现是"回车之后页面
        闪一下、回到加载中"。
        ⚠️ `type="text"` + 可见的 `<label>` 走 `sr-only`：占位符在输入第一个字之后就没了，
        那是控件**唯一**的名字；只给占位符不给标签，读屏软件会念出一个无名输入框
        （`htmlFor` / `id` 成对写，与 ② 的搜索框同一条）。
      */}
      {/* biome-ignore lint/a11y/useSemanticElements: 见上面那段 —— form 上的 role="search" 合法，换成 <search> 会拆掉"回车提交" */}
      <form
        className="ranked__search"
        /*
         * ⚠️★ 这一行是**有意的 lint 豁免**（本仓已有四处同形的，比如 `Layout.tsx` 的
         *    `useExhaustiveDependencies`），理由两条：
         *   · `role="search"` 在 `<form>` 上是**合法**的 ARIA（它就是 search 地标），
         *     biome 报的是"现在有 `<search>` 元素可用"那一条**风格**建议；
         *   · 换成 `<search>` 只有两种写法，两种都更差：要么多一层 wrapper
         *     （`<search><form …>`，把"地标"与"提交点"拆成两个元素），要么失去
         *     **回车提交**（`<search>` 没有表单语义，那是用户说的键盘路径）。
         *   ⇒ 保持"一个 form 同时是地标与提交点"，代价是这一行豁免。
         */
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          onSearchSubmit();
        }}
      >
        <label className="sr-only" htmlFor="ranked-search">
          {t('ranked.searchLabel')}
        </label>
        <input
          id="ranked-search"
          className="ranked__searchinput"
          type="text"
          autoComplete="off"
          value={searchText}
          placeholder={t('ranked.searchPlaceholder')}
          onChange={(event) => onSearchTextChange(event.target.value)}
        />
        <button type="submit" className="ghostbtn">
          {t('ranked.searchSubmit')}
        </button>
      </form>
      {/* ⚠️ 说明书（两个入口各自的代价不同），紧贴在框下面 —— 见上面那一段 */}
      <p className="ranked__searchhint">{t('ranked.searchHint')}</p>
      {/*
        ★★ 那一次精确查询的结果。
        ⚠️★ 2026-09-19 第四轮：**命中**（`found`）时这一块**整个没有**了 ——
        查到的玩家变成了**表格里的一行**（固定在最上面，见下面 `<tbody>` 的第一行），
        而"点开是同一张卡片"由那一行后面的 `ranked__detailrow` 负责。
        用户原话：「自行搜索的玩家**页面布局和排行榜玩家相同**（无论是展开前还是展开后）」，
        而一块**表格之外**的读数行（elo / 排名 / 本赛季战绩）正是"布局不同"的来源：
        它有自己的一套标记与度量，而卡片还有第三套。
        ⚠️★ 后果写清（用户当场拍的口径）：查到的这位**本来就在榜上**时会出现**两行**
        （固定那一行 + 他自己那一行），两行的昵称都印得出来、都能点开同一张卡片 ——
        区分只有 `.ranked__row--lookup` 那条细细的左侧强调线。
        ⚠️ `null`（这一页还没查过）⇒ **整个不渲染**，不是渲染一个空框：多一行空白
        会让人以为上面那一步失败了。
        ⚠️★ **没命中 / 昵称不合法**那两档**照旧**渲染在这里（表格**上面**）：
        它们没有玩家可以变成一行（上游对这个人没有答案），所以与"行"无关；
        而且它们是**两句不同的话**、**没有重试按钮**（上游的查询是精确匹配，
        重试一万次还是这个结果 —— `RankedLookup` 的形状注释上写着这条）。
      */}
      {lookup === null || lookup.kind === 'found' ? null : (
        <div className="ranked__lookup">
          <p className="ranked__lookupmsg">
            {lookup.kind === 'not_found' ? t('ranked.lookupNotFound') : t('ranked.lookupInvalid')}
          </p>
        </div>
      )}
      {/*
        ⚠️★ 赛季与赛段是**同一行里的四格**（`.ranked__meta` 是 flex + gap）——
        这就是用户说的「并排」：赛季号、赛季**结束时间**、赛段号、赛段**结束时间**，
        一行读完。（⚠️ 赛季那一格只有**结束**时间：起始日被用户点名去掉，见
        `docs/progress.md §三十二`；这一行印的就是 `seasonEndsAt` 与 `phaseEndsAt` 两条词条。）
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
      ) : shown.length === 0 ? (
        /*
         * ★★ 「筛完一个人都不剩」是**另一句话**（`eloFilterEmpty`），不是上面的
         *    `eloEmpty`（「这个赛季还没有人上榜。」）：上游此刻有人、只是当前这个搜索词
         *    一个都没命中。说反了用户会以为上游空了，于是去别处找问题 ——
         *    而该做的只是把搜索框里那个词删掉（与 ② 的 `liveNoMatch` / `liveEmpty` 同一口径）。
         * ⚠️ `users.length === 0` 那一支**照旧**用 `eloEmpty`：上游本身就空的时候，
         *    说"没有匹配的玩家"会把一件上游的事说成用户自己筛出来的。
         *
         * ⚠️★ 2026-09-19 第四轮：这一支现在**也**可能要把表画出来（只要查到的那位有那一行）。
         *    原因是"打字筛榜 + 回车查人"这条路上，两个动作用的是**同一个**搜索词 ——
         *    要查的人本来就不在前 150 里（这正是查他的理由）⇒ 那个词把整张榜筛空，
         *    于是"固定在最上面那一行"没有表可待，卡片只能掉到表格下面去。
         *    而用户要的恰恰是「自行搜索的玩家**页面布局和排行榜玩家相同**」。
         *    ⚠️ 那两句空态话（`eloEmpty` / `eloFilterEmpty`）**照旧**渲染：它们说的是
         *    榜上没有行，而固定那一行**不是榜上的行**（它是"你查的这个人"）。
         *    ⚠️ 反过来（榜上有行时）表照常渲染，固定那一行排在它前面。
         */
        <>
          <p className="ranked__empty">{t('ranked.eloFilterEmpty', { q: searchText.trim() })}</p>
          {lookedUp === null ? null : table}
        </>
      ) : (
        table
      )}
      {/*
        ★★ 判据③：他**不在**这张表里（掉出前 150、而且不是查到的那位）——
        卡片落在表格**下面**，而且第一行仍是那颗可点收起的昵称按钮（不然用户没有任何
        办法把它关掉，只能刷新整页）。为什么"不消失"这件事见上面那三条判据的注释。
        ⚠️ 它渲染在 `</table>` **外面**（不是某一行下面）："他在表里"这件事不成立，
        所以在表里给他找一行是自相矛盾的 —— 而"筛选把他筛掉了却还留在表里"正好会让
        过滤看起来坏了。
      */}
      {belowTable && open !== null ? (
        <RankedDetailBlock
          nickname={open.nickname}
          state={open.state}
          collapse
          onToggleDetail={onToggleDetail}
          seeds={seeds}
          onToggleSeed={onToggleSeed}
        />
      ) : null}
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
