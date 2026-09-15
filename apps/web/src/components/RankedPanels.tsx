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
 * ★ ②③④ 三处**列表**由视图自己派生（`topLiveMatches` / `topEloEntries` / 逐行渲染）
 * ===========================================================================
 * 「{{total}} 场里按平均 elo 取前 10」里的 total 是 `live.matches.length`，而下面是
 * 取前 10 之后的列表 —— 两者必须来自**同一次**计算。分两处算（容器算 total、视图算
 * 列表，或者反过来），迟早会渲染出"写着 14 场、其实列了 10 条"的产物，而那种
 * 自相矛盾**没有任何门禁能发现**：它每一句都合法、每一格都有值。
 * ⚠️ 视图里调用**纯函数**是允许的（`select.ts` 那两个都不读时钟、不改入参）；
 *    不允许的是时钟与取数。
 *
 * ===========================================================================
 * ★ 嵌入：判定与播放器都用**现成的**，这里一个播放地址都不拼
 * ===========================================================================
 * `liveEmbedDecision(rankedLiveChannel(url), location.hostname)`。
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
 * ⚠️ 词条：这里出现的每一个 key 都在 spec §7.3 的冻结清单里（由 Task 7 落地）
 * ===========================================================================
 * ⛔ **不要在这个文件里写死任何可见文字**，包括那个占位符：它是 `ranked.unknown`。
 * 写死之后两种语言再也没法分开调，而渲染自检的"裸 key 泄漏"扫描**只看得到 key**
 * —— 一个写死的字面量它一个字都不会说（`roleguide.tsx` 那条恒真守卫就是这个形状）。
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
  type RankedStatusResponse,
  type RankedTab,
  type RankedWeeklyData,
  rankedLiveChannel,
  timelineLabel,
  topEloEntries,
  topLiveMatches,
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

/**
 * 四个种子的**固定顺序**：主世界 / 下界 / 末地 / RNG（用户原话的顺序）。
 *
 * ⚠️ 顺序写成数组，不靠对象键序：键序是"谁先写"的副产品，而"这四格每次都以同一个
 * 顺序出现"是这一栏的固有顺序（`ShareContent` 里那四格种子同一条做法）——
 * 顺序一旦漂了，没人会注意到，只会觉得"这次看起来不太一样"。
 * ⚠️ 类型取 `keyof RankedWeeklyData['seed']`（不是手抄的字面量联合）：
 *    形状里加一格种子时这里跟着编译报错。
 */
const WEEKLY_SEED_ORDER: (keyof RankedWeeklyData['seed'])[] = [
  'overworld',
  'nether',
  'theEnd',
  'rng',
];

/**
 * 四个种子的标签 → **复用现成的那四条词条**（`shares.form*`：「主世界种子」…「RNG 种子」）。
 *
 * ⚠️★ 这一处是 **Task 5 实现时发现的一处计划空白**，选择写在明面上，不要当成漏项：
 *    spec §6.5 要求顶部有 **4 个种子**（主世界 / 下界 / 末地 / RNG），而 §7.3 那张
 *    冻结词条表里给周赛的**只有一条** `ranked.weeklySeed`（「种子」）——四个格子
 *    全印同一个词，那一行就没有信息了。⇒ 只能复用已有的词条，而候选只有两组：
 *      · `seedsPage.overworldSeed / netherSeed / theEndSeed`（「主世界 / 下界 / 末地」）
 *        —— **缺 RNG 那一条**（全仓搜过：`RNG` 只出现在 `shares.*` 里），
 *        凑不齐一组，混两个命名空间的标签比复用更糟；
 *      · `shares.form*`（「主世界种子 / 下界种子 / 末地种子 / RNG 种子」）
 *        —— 一组四条、同一个命名空间，而且讲的**正是同一种东西**
 *        （那个表单的导语就是「分享一组世界种子：主世界、下界、末地、RNG。」）。
 *    ⇒ 取后者。⚠️ **代价写在明面上**：ranked 面板的四格标签从此与「实时分享」
 *    那个表单的文案绑在一起，改那边会同时改这里。真要解开就是给 `ranked.*`
 *    加四条新词条（T7 的清单里没有 ⇒ 那是一次计划变更），本任务不动它。
 */
const WEEKLY_SEED_LABEL_KEYS: Record<keyof RankedWeeklyData['seed'], string> = {
  overworld: 'shares.formOverworld',
  nether: 'shares.formNether',
  theEnd: 'shares.formEnd',
  rng: 'shares.formRng',
};

// ---------------------------------------------------------------------------
// 两个"上游给秒、界面按本地时区印"的小工具
// ---------------------------------------------------------------------------

/*
 * ⚠️ 上游的 `Date` 一律是**秒**（赛季起止、周赛 endsAt —— spec §13 的时间单位表），
 *    而 `new Date()` 要的是毫秒 ⇒ 乘 1000 这一步在**调用点**显式做，
 *    与 `time.ts` 文件头那条"单位搞混不会报错，只会显示成一个荒谬的数字"同一条纪律。
 * ⚠️ 用 `toLocaleDateString()` / `toLocaleString()` 而不是自己拼 `YYYY-MM-DD`：
 *    本仓其它日期都是这么显示的（`ResourceDetail` / `VideoCard` / `AdminUsers` …），
 *    自己拼就是**第二套时区口径**，而它只会和第一套漂开。
 */

/** `2026-09-15`（按**访客本地时区**）—— 赛季起止这种"哪一天"的东西用它。 */
function localDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString();
}

/** 带时刻的那一档（周赛截止）—— 截止是一个**瞬间**，只有日期不够用。 */
function localDateTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString();
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
        ★★ 只要失败了就给一次重试 —— 这是与计划骨架**有意的偏差**，理由写全在这里
        （2026-09-16，Task 5 实现时发现）。

        骨架写的是 `{c.staleSecs !== null && c.errorText !== null ? <RankedRetry … /> : null}`，
        而那个条件让**"失败·没有旧数据"**（第一次就没读到）这一档**没有任何重试入口**：
        屏幕上是一句具体的失败说明，用户能做的只剩刷新整页。
        可是 spec §6.6 那一行写的是「一句**具体**的话 + **可点**的重试」，
        §11.3 又要求"四种整体画面各自的产物"逐档断言 —— 按骨架写，这条断言
        在 Task 8 一定会红。⚠️ 同栏目上一轮的 `ShareBoardView` 在两档失败里
        **都**渲染了重试（`board === null && loadError` 与 `board !== null && loadError`），
        那正是这条纪律的先例。
        ⇒ 判据改成"失败了就重试"（`errorText !== null`），`staleSecs` 只管那句话
          用 `info` 还是 `bad`（有旧数据就不许打断读屏）。
        ⚠️ 这不是"顺手多给一颗按钮"：`ShareRetry` 的注释写着"一颗按下去什么都不会发生的
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
  /**
   * 人数那一格是什么时候读到的（本地时钟）。
   *
   * ⚠️★ 这个面板**不读它**，而这不是漏项 —— 它今天**没有渲染点**，理由有三条，都写在这：
   *   1. 它答的问题是"人数这个数有多旧"，而这一栏唯一那句话是 `ranked.updatedAgo`
   *      （「{{secs}} 秒前更新」），由外壳**只渲染一次**、由容器给的那一个秒数驱动
   *      （T6 的契约里 `updatedAgoSecs` 就是"最后一次成功"）；
   *      再写一行就会在同一屏出现两个意思不同的"N 秒前"，而它们会互相打架。
   *   2. "人数读不到"那一档已经由 `players === null` 说清了（`ranked.playersUnknown`），
   *      "刷新失败但有旧数据"那一档由 `staleSecs` 说清了 —— 剩下的情形里
   *      "旧多少秒"不影响任何决定。
   *   3. 要给它一句自己的话就得**新加词条**，而 §7.3 的清单里没有那一条
   *      （Task 7 加的词条是冻结的，本任务不许自己发明 key）。
   * ⇒ 它是 T6/T8 的**接线凭证**（渲染自检逐格显式传值，少一个就红），保留原样。
   */
  playersAtMs: number | null;
};

/**
 * ① 状况与人数（spec §6.2）。
 *
 * ⚠️ 四个状态各有各的话；`players` 的 `0` 与 `null` 是**两句不同的话**
 * （「现在没有人在玩 Ranked」是真话，「人数暂时读不到」是另一件事）。
 * ⚠️ `checkedAt` **原样显示**（不做时区换算，见 `types.ts` 那条注释）。
 * ⚠️ `uptime24` 为 `null` ⇒ **整行不渲染**（不是渲染 0%：「这一栏今天没有数据」
 *    与"可用率 0%"是两件事，而 0% 会让用户以为服务整个挂了一天）。
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
      <p className={`ranked__badge ranked__badge--${BADGE[status.monitor.state]}`}>
        {t(STATUS_KEYS[status.monitor.state])}
      </p>
      <p className="ranked__meta">
        {status.monitor.ping === null
          ? t('ranked.statusPingUnknown')
          : t('ranked.statusPing', { ms: status.monitor.ping })}
      </p>
      {/*
        ⚠️ 「最后心跳 2026-09-15 13:36:27」—— 上游那串字符**原样**显示。
        没有它的话，「服务正常」这句话到底有多新就没人知道：心跳可能已经停了一小时，
        而徽章照样是绿的（这一栏的"新鲜度"那一行说的是**我们这份数据**的年龄，
        与上游那一条心跳的时刻是两件事）。
      */}
      <p className="ranked__meta">
        {t('ranked.statusCheckedAt', { time: status.monitor.checkedAt })}
      </p>
      {/* ⚠️ `uptime24` 为 null ⇒ **整行不渲染**（不是渲染 0%） */}
      {status.monitor.uptime24 !== null ? (
        <p className="ranked__meta">
          {t('ranked.statusUptime', { pct: Math.round(status.monitor.uptime24 * 100) })}
        </p>
      ) : null}
      {players === null ? (
        <p className="ranked__big ranked__big--unknown">{t('ranked.unknown')}</p>
      ) : (
        <p className="ranked__big">{players}</p>
      )}
      <p className="ranked__meta">
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
 * ⚠️ 页面自己的 host 就是 Twitch 的 `parent`（传错是**静默**拒播），所以它必须是
 *    **运行时的** `location.hostname`：开发时是 localhost、线上是真实域名，
 *    而写死任何一个都会有一半的运行形态被平台拒掉。
 * ⚠️ `location` 在 SSR / 渲染脚本里**不存在** ⇒ 走 `?.`：否则这一层会因为一个
 *    与它要验的东西毫不相干的原因崩掉（`ClickToPlayEmbed` 里写着同一件事；
 *    那时 Twitch 那一档会拿到 `no_origin` 而落到外链，这正是我们想要的结果）。
 * ⚠️ `title` 是**播放器的可访问名字**，说的是"播谁的"：门面自己会画平台徽章
 *    （那一条 key 在 `ClickToPlayEmbed` 里），所以这里只补上人是谁。
 *    昵称在形状里可以是 `null` ⇒ 落到 `ranked.unknown`，绝不渲染一个空的
 *    `title`（读屏软件那时只会念出一串控件类型，用户分不出这是哪一个）。
 */
function RankedStream({ liveUrl, nickname }: { liveUrl: string; nickname: string | null }) {
  const { t } = useTranslation();
  const origin = globalThis.location?.hostname ?? '';
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
function RankedMatch({ match }: { match: RankedLiveMatch }) {
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
              <RankedStream key={entry.side} liveUrl={entry.liveUrl} nickname={entry.nickname} />
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
};

/**
 * ② 实时高分对局（spec §6.3）：排序、取前 10、逐张卡片。
 *
 * ⚠️★ 排序与取前 10 都**在这里**（`topLiveMatches(live)`），与上面那句
 *    「{{total}} 场里按平均 elo 取前 10」用**同一份**数据（本文件头第 3 节）。
 * ⚠️ 空集合是**自己的话**（「现在没有直播中的对局。」）—— 它既不是"加载中"
 *    也不是"出错了"：三者的下一步完全不同（等 / 等 / 重试），
 *    合成一句会让用户对着一屏空白不知道该做什么。
 */
export function RankedLiveView(props: RankedLiveViewProps) {
  const { t } = useTranslation();
  const { live, ...c } = props;

  if (live === null) {
    return (
      <RankedChrome {...c}>
        {c.errorText === null ? <p className="state">{t('common.loading')}</p> : null}
      </RankedChrome>
    );
  }

  const matches = topLiveMatches(live);

  return (
    <RankedChrome {...c}>
      <h2 className="ranked__title">{t('ranked.liveTitle')}</h2>
      {matches.length === 0 ? (
        <p className="ranked__empty">{t('ranked.liveEmpty')}</p>
      ) : (
        <>
          {/*
            ⚠️ 「{{total}} 场里按平均 elo 取前 10」只在**有**场次时渲染：
            空集合那两句话（"N 场里取前 10" + "现在没有对局"）里的前一句
            在 N = 0 时是一句废话，读起来像模板坏了。
          */}
          <p className="ranked__meta">{t('ranked.liveFrom', { total: live.matches.length })}</p>
          <ul className="ranked__live">
            {matches.map((match) => (
              /*
               * ⚠️ key 用 `match.key`（两个 uuid 排序后拼起来，`types.ts` 里写着为什么
               * 必须排序）：上游没有 match id，而左右两侧的 elo 一变就可能互换 ——
               * 不排序的话 React 会把同一场比赛当成新的一场重建（展开的框会跟着塌掉）。
               */
              <RankedMatch key={match.key} match={match} />
            ))}
          </ul>
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
};

/**
 * ③ Elo 排行榜（spec §6.4）：赛季 + 五列表格。
 *
 * ⚠️★ 排名列印的是上游的 **`eloRank`**，**不是下标 + 1**：并列会重复、之后会跳号
 *    （上游实测给的是 `…, 3, 3, 5, …`），下标会把它印成 `3, 4, 5` ——
 *    看起来更"正常"，而它是**错的**（第 4 名不存在，那两个是并列第 3）。
 * ⚠️ 取前 100 用 `topEloEntries`：它**只截断不重排**（`select.ts` 里写着理由 ——
 *    上游已经按 eloRank 排好了，我们重排只会引入一种"两个都对却不一样"的顺序）。
 * ⚠️ 上游每条还带着 `country`：**我们不发也不显示**（spec §9 最后一行），
 *    所以它连我们的形状都没进（那条数据在 `parse.ts` 就被丢掉了）。
 */
export function RankedEloView(props: RankedEloViewProps) {
  const { t } = useTranslation();
  const { elo, ...c } = props;

  if (elo === null) {
    return (
      <RankedChrome {...c}>
        {c.errorText === null ? <p className="state">{t('common.loading')}</p> : null}
      </RankedChrome>
    );
  }

  const users = topEloEntries(elo.users);
  const dash = t('ranked.unknown');

  return (
    <RankedChrome {...c}>
      <h2 className="ranked__title">{t('ranked.eloTitle')}</h2>
      {/*
        ⚠️ 赛季号与起止分成两格（同一个 `.ranked__meta` 里的两个 `<span>`）：
        它们是**两个**词条（spec §7.3），合成一句就要自己拼一个分隔符 ——
        而分隔符是排版，不是文案（`.ranked__meta` 用 flex 的 gap 分开它们）。
      */}
      <p className="ranked__meta">
        <span>{t('ranked.season', { n: elo.season.number })}</span>
        <span>
          {t('ranked.seasonRange', {
            from: localDate(elo.season.startsAt),
            to: localDate(elo.season.endsAt),
          })}
        </span>
      </p>
      {users.length === 0 ? (
        <p className="ranked__empty">{t('ranked.eloEmpty')}</p>
      ) : (
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
};

/**
 * ④ 周赛榜单（spec §6.5）：周数 + 4 个种子 + 截止 + 五列表格 + 翻页。
 *
 * ⚠️★ 周数走 `displayWeekNo()`：上游把"第 0 周"记成 `-1`（唯一的负周），
 *    照原样印会让界面出现「第 -1 周」—— 那是上游的下标，不是任何人心里的周数。
 * ⚠️★ 翻页走 `prevWeekId` / `nextWeekId`（**不是** `id ± 1`）：那两个函数结构上
 *    跨过 0，因为 0 在上游是"本周"的别名 —— 拼出 `id = 0` 的链接会让 URL 写着 0、
 *    屏幕上是第 103 周的数据。它们返回 `null` 时这一格渲染成**不可点的一格**
 *    （不是一条会 400 的链接）。
 */
export function RankedWeeklyView(props: RankedWeeklyViewProps) {
  const { t } = useTranslation();
  const { weekly, latestId, ...c } = props;

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

  return (
    <RankedChrome {...c}>
      <h2 className="ranked__title">{t('ranked.weeklyTitle')}</h2>
      <p className="ranked__meta">
        <span>{t('ranked.weeklyNumber', { n: displayWeekNo(weekly.id) })}</span>
        <span>{t('ranked.weeklyEndsAt', { when: localDateTime(weekly.endsAt) })}</span>
      </p>
      {/*
        ★ 四个种子：一个 `<dl>`（标签 + 值成对）—— 复用 `.infotable` 那一套
        （`dt` / `dd` 由这一块的规则排），所以不必为一个四格的行新造类名。
        ⚠️ 值走**原样**：种子是 64 位整数（19 位数字），`Number()` 会静默改值
        （`components/SeedResultCard.tsx` 的文件头记着这件事），
        而这里它本来就是字符串 —— 从解析层到界面一个字都没被转换过。
      */}
      <dl className="ranked__seeds">
        {WEEKLY_SEED_ORDER.map((field) => (
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
      )}
      {/*
        ⚠️ 翻页是**真链接**（`/ranked/weekly/102`，不是查询串）：可刷新、可分享、
        前进后退都落在同一屏上。⚠️ 到头的那一档渲染 `<span>` 而不是 `<a>` ——
        本仓的规矩是"入口在不在"要能被断言，而一条 `aria-disabled` 的链接
        仍然会被读屏软件念成一个可点的链接，那就是在骗人。
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
      </nav>
    </RankedChrome>
  );
}
