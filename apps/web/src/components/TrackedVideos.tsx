import type {
  TrackedCreator,
  TrackedCreatorSummary,
  TrackedDurationPresetId,
  TrackedSort,
  TrackedTimeRangeId,
  TrackedVideo,
  TrackPlatform,
} from '@mcsr/shared/tracking';
import {
  TRACK_PLATFORMS,
  TRACKED_DURATION_PRESET_IDS,
  TRACKED_TIME_RANGE_IDS,
  TRACKED_VIDEO_TAGS,
  toMillis,
} from '@mcsr/shared/tracking';
import { formatTimecode } from '@mcsr/shared/videos';
import { useTranslation } from 'react-i18next';
import { ClickToPlayEmbed } from '@/components/ClickToPlayEmbed';
import { Field, Notice } from '@/components/Form';
import { watchUrl } from '@/components/VideoEmbed';
import type { TrackedFilterParam, TrackedFilterState } from '@/lib/trackedQuery';
import {
  hasTrackedFilters,
  TRACKED_CREATOR_PARAM,
  TRACKED_DURATION_PARAM,
  TRACKED_SORT_PARAM,
  TRACKED_TAG_PARAM,
  TRACKED_TIME_PARAM,
} from '@/lib/trackedQuery';

/**
 * 「追踪的博主」—— `/videos` 页上的那一块（**两个只吃 props 的纯视图**）。
 *
 * ===========================================================================
 * 为什么是**两个纯视图**，而不是让 `routes/Videos.tsx` 自己写这几块界面
 * ===========================================================================
 * 本仓铁律（spec §6.2，`docs/pending.md` 反复记着）：`renderToStaticMarkup`
 * **不跑 effect**、不点击、不发请求 —— 界面写在**页面**里就**断言不到**
 * （页面永远停在 loading/空态，为它写的断言退化成恒真）。
 * ⇒ 取数、分页、能力判断、两次点击之间的状态**全在页面那一层**；
 *   这一层只回答"给我这些 props，画成什么样"，于是 `apps/web/scripts/videorender.tsx`
 *   能把每一个状态都渲染一遍并逐条断言。
 * ⚠️ 两个组件都**没有 `useState` / `useEffect` / 取数**：连"正在等确认的是哪一行"
 *   和"输入框里现在是什么"都是 props（页面持有）—— 组件里存一份状态就意味着
 *   那个状态**在静态渲染里永远不会变**，于是它对应的界面分支谁也断言不到。
 *
 * ===========================================================================
 * ★★ 时间：两处都**必须**经 `toMillis`（spec §4 那个 ★★ 块的裁决）
 * ===========================================================================
 * `tracked_videos.published_at` 与 `tracked_creators.last_synced_at` 都是 **Unix 秒**
 * （上游 bilibili 的 `created` 就是秒），而 `Date` / `Intl` 要的是**毫秒**。
 * ⇒ 裸的 `new Date(v.publishedAt)`（或 `Date.now() - v.publishedAt`）**是一条真缺陷**：
 *   少乘 1000，显示出来是 **1970 年**，而类型检查拦不住它（两边都是 `number`）。
 *   `toMillis()` 是这两张表唯一被允许跨单位的地方（`packages/shared/src/tracking.ts`），
 *   而**本文件是它的第一个生产调用者** ⇒ 下面那两个小函数是这一页唯一的转换点。
 * ⚠️ `null` 一律显示成 `—`，**不显示成 0**：0 毫秒是 1970-01-01，看起来像一条真实数据。
 *
 * ===========================================================================
 * ★★ 空的计量格显示 `—`，**绝不显示 0**（本仓既有纪律）
 * ===========================================================================
 * `publishedAt` / `durationSec` / `viewCount` / `commentCount` 四个字段**都可能是 null**
 * （上游没给、或者这一轮没回这个字段）。把它们渲染成 `0` 是一个**看起来像数据的谎**：
 * "这支视频没人看"与"这个平台这一轮没回播放量"在界面上一模一样，而后者是
 * **接口悄悄变了**的信号（spec §4.2 那条"拿不到的字段一律 NULL，不许填 0"）。
 * ⇒ 本文件里那几处都是"null ⇒ `—`"，而渲染自检的第一条断言正是这件事
 *   （喂一个四个字段全 null 的夹具 ⇒ 页面上**一个 `0` 都不许出现**）。
 *
 * ===========================================================================
 * 卡片上的六个字段（用户裁决 R4）
 * ===========================================================================
 * 标题 / 封面 / 发布时间 / 时长 / 播放量 / 评论数 —— 就是这六个，一个不多一个不少。
 * ⚠️ 封面必须有 `loading="lazy"` 与固定宽高比（16:9，写在 CSS 里）：一屏几十张图
 *   一起加载会把首屏拖慢，而比例不固定的图片到达时会让每一行重排。
 * ⚠️ `thumbnailUrl` 为 null 时**不渲染 `<img>`**（而不是 `src=""`）：
 *   `src=""` 会让浏览器去请求**当前页面**，一次请求换来一张碎图。
 *
 * ===========================================================================
 * ★ 空的列表与**没取到的列表**是两件事（两栏**同一条纪律**）
 * ===========================================================================
 * 两栏各有自己的三态：正在取数 / 取数失败 / 正常（空或非空），而失败**不许**折进"空"。
 * 折了的话界面会说一句**假话**，并且把人引向一个必然失败的动作：
 *   · 公开列表会说"还没有追踪到视频"（其实列表不是空的，是没取到）；
 *   · 管理面板会说"名单还是空的 —— 在上面贴一个博主的链接"，而编辑照着贴的那条链接
 *     **已经在名单上**，再贴一次只会拿到 `duplicate`（`tracked.errDuplicate`）。
 * ⇒ 两个组件都把三态**分开吃 props**（面板那一格叫 `loadError`，不叫 `error`：
 *   它说的是"这张表没读到"，与"我刚才那一下失败了"是两个不同的问题），
 *   渲染自检对两栏各断言一次"取数失败时**没有**空态那一块"。
 */

/** 没有值的那一格 —— 全仓的约定（`CalendarDetail` / `SeedResultCard` 都是它）。 */
const DASH = '—';

/**
 * 平台名 → 词条 key。**复用视频墙那同一批**（`videos.platform*`）—— 同一个平台不该有两个名字。
 *
 * ⚠️ 键的类型写成 `Record<TrackPlatform, string>` 而不是 `Record<string, string>`：
 *    前者在加第四个平台时**当场编译失败**，后者会静默漏掉一格，而那一格的表现是
 *    卡片上印出**裸 key**（`videos.platformXxx`）—— 只有那个平台真有视频时才看得见。
 */
const PLATFORM_KEYS: Record<TrackPlatform, string> = {
  bilibili: 'videos.platformBilibili',
  youtube: 'videos.platformYoutube',
  twitch: 'videos.platformTwitch',
};

/**
 * 三个标签 → 词条 key（spec §4.3 冻结的那三个）。
 *
 * ⚠️ 表里**没有**的标签按原样显示（见 `tagLabel`）：这一列由抓取那一侧派生，
 *    哪天多派生一个，界面要**看得见它**而不是把它悄悄吞掉 —— 少一个标签没人会发现，
 *    而"界面上少一格"与"数据里没有"在产物里长得一模一样。
 */
const TAG_KEYS: Record<string, string> = {
  liveReplay: 'tracked.tagLiveReplay',
  short: 'tracked.tagShort',
  long: 'tracked.tagLong',
};

/**
 * 第 9 条那三个下拉框的**选项文字**：id → 词条 key。
 *
 * ⚠️★ 三张表都写成**穷尽**的 `Record<联合, string>`（不是 `Record<string, string>`）：
 *    清单里多一档时这里会**当场编译失败**，而写成宽松 Record 的话，那一档会静默
 *    落到"没有文字的选项"上（一个空白的下拉项，只有用户点开才发现）。
 *    这与 `PLATFORM_KEYS` 是同一条理由（见它上面那段）。
 * ⚠️ 键是**拼出来**的（`t(TIME_KEYS[id])`），所以 `services/api/src/i18n-keys.test.ts`
 *    那条"字面量键必须存在"的守卫看不见它们 —— 它们由**渲染自检**兜着
 *    （断言画出来的文字等于 `t('tracked.time7d')` 之类；表里写错一个字母时，
 *    产物里是那串原始 key，而断言的右边是真词条 ⇒ 当场红）。
 */
const TIME_KEYS: Record<TrackedTimeRangeId, string> = {
  '7d': 'tracked.time7d',
  '30d': 'tracked.time30d',
  '1y': 'tracked.time1y',
};
const DURATION_KEYS: Record<TrackedDurationPresetId, string> = {
  lt1: 'tracked.durLt1',
  '1to5': 'tracked.dur1to5',
  '5to15': 'tracked.dur5to15',
  gt15: 'tracked.durGt15',
};
const SORT_KEYS: Record<TrackedSort, string> = {
  new: 'tracked.sortNew',
  views: 'tracked.sortViews',
};

/** 标签 → 显示文字（认不出来的原样显示，理由见 `TAG_KEYS`）。 */
function tagLabel(tag: string, t: (key: string) => string): string {
  const key = TAG_KEYS[tag];
  return key === undefined ? tag : t(key);
}

/**
 * 下拉框里那位博主怎么称呼。
 *
 * ⚠️★ 卡片那一格与这里**故意不一样**，两处各有各的理由：
 *   · 卡片上：`display_name` 为空 ⇒ **整格不渲染**（那一格是"额外信息"，而
 *     一张卡上已经写着平台、标题、四个读数 —— 少一格不损失什么，
 *     印一个空框或拿 handle 顶上反而让人以为数据坏了）；
 *   · 下拉框里：`display_name` 为空 ⇒ **回落成 handle**，因为这一格**就是控件本身**
 *     （一个没有文字的 `<option>` 是点不准的），而且下拉框是"找人"的地方 ——
 *     handle 正是那个能找到人的标识。
 * ⚠️ 两个都为空（手工改库才造得出来）时这一格会退化成"平台 + 条数"那一半，
 *    仍是一行能读的文字 —— 这里**不编**一个名字（本仓同一条纪律）。
 */
function creatorLabel(row: TrackedCreatorSummary): string {
  return row.displayName !== '' ? row.displayName : row.handle;
}

/**
 * Unix **秒** → 本地日期串（**唯一的换算点**，见文件头）。
 *
 * ⚠️ 导出只为了一件本仓反复吃过亏的事：`apps/web` 没有测试运行器，
 *    `apps/web/scripts/videorender.tsx` 是这一页唯一的断言执行者 ——
 *    "0 秒会不会被当成'没有值'（它渲染出来的是**纪元那一刻**，UTC 以东是 1970、
 *    以西是 1969 —— 所以那条断言**不许**写死年份）/ null 是不是 `—`"这两条要能**直接**问它，
 *    而不是只能靠产物里有没有 `1970` 去猜（`RANKED_ERROR_KEYS` 是同一处置）。
 * ⚠️ `locale` 是**必填**参数（由调用点传 `i18n.language`）：不传时 `toLocaleDateString()`
 *    跟的是**宿主机器**的 locale ⇒ 中文系统上的英文界面会印出中文日期，而两种语言
 *    各渲染一遍的渲染自检**都看不出来**（两遍跑在同一台机器上，看到的是同一个错误）。
 *    这一条是 `RankedPanels.tsx` 上那段注释的同一件事，那边为它写过完整的一段。
 */
export function localDate(sec: number | null, locale: string): string {
  const ms = toMillis(sec);
  return ms === null ? DASH : new Date(ms).toLocaleDateString(locale);
}

/** 同上，带时刻 —— 「上次同步」要看得到是哪天的几点（与 `localDate` 同一处换算）。 */
export function localDateTime(sec: number | null, locale: string): string {
  const ms = toMillis(sec);
  return ms === null ? DASH : new Date(ms).toLocaleString(locale);
}

/**
 * 公开分区。
 *
 * ⚠️ props 全部**必填**（`empty` / `error` / `loading` 都是）：
 *    · `empty` 是**页面**给的那一句空态说明 —— 只有页面知道"为什么是空的"
 *      （一条视频都还没抓到 / 名单上一个人都还没有）。写在组件里的话那一句话就没法
 *      按处境换，而"空的时候说一句准话"正是 spec §6.2 的要求。
 *    · `error` **必须**有：没有它，取数失败会渲染成"还没有追踪到视频" —— 一句**假话**
 *      （列表不是空的，是没取到）。这与"空态不许是空白"是同一条纪律的两面。
 *    · `loading` 同理：加载中显示空态也是一句假话。
 * ⚠️ 少传一个 prop 在**这里看不出任何异常**（SSR 不渲染事件处理器，少一个 `onPage`
 *    与接好线的产物逐字节相同）⇒ 渲染自检有一道**运行时**守卫
 *    （`videorender.tsx` 的 `assertPropsGiven`），因为 `scripts/**` 不受类型检查。
 */
export interface TrackedVideosSectionProps {
  items: TrackedVideo[];
  total: number;
  page: number;
  pageSize: number;
  /**
   * 「全部」那一档空列表时显示的那一句话（页面给 —— 只有它知道为什么是空的）。
   *
   * ⚠️★ 它管的是**没有选分区**那一档（T8）：选了某个分区、而那个分区里一条都没有时，
   *    空的是另一件事，说的也是**另一句话**（`tracked.emptyPlatform`，见组件里
   *    `emptyTitle` 那一段）。页面照旧只传「全部」那一句 —— 分区那一句的判据
   *    （`platform !== undefined` 且 `items` 是空的）就在**组件手里的两个 prop** 上，
   *    页面再判一次就是第二份口径，而两份口径迟早会漂。
   */
  empty: string;
  /** 正在取数。⚠️ 与"空列表"是两件事，**不许**合并。 */
  loading: boolean;
  /** 取数失败的那一句话；`null` = 没出错。 */
  error: string | null;
  /**
   * 当前分区（`undefined` = 全部）。
   *
   * ⚠️★ 它只影响**取数**（服务端筛选，spec §5.1），组件自己是纯的：分区**不在这里**
   *    过滤 `items` —— 在界面里再筛一次就是第二份"什么算这个分区"，而两份口径一旦
   *    漂移，表现是"分页器说共 40 条、列表里却只有 3 条"（`total` 是服务端给的）。
   * ⚠️ 它由页面从 URL 读出来（`?tplatform=`），组件**不读地址栏**：这一层只回答
   *    "给我这些 props，画成什么样"（文件头那一段）。
   */
  platform: TrackPlatform | undefined;
  /** 换分区。⚠️ 必填 —— 少传它 = 四个按不动的按钮。 */
  onPlatformChange: (platform: TrackPlatform | undefined) => void;
  /** 翻页。⚠️ 必填 —— 见上面那段（少传它 = 一个按不动的分页器）。 */
  onPage: (page: number) => void;

  // -------------------------------------------------------------------------
  // 第 9 条（2026-09-19）：筛选条 / 排序 / 博主下拉
  // -------------------------------------------------------------------------
  /**
   * 这一栏当前的筛选与排序（**全部来自地址栏**，见 `lib/trackedQuery.ts`）。
   *
   * ⚠️★ 它**只影响取数**（服务端筛选，与 `platform` 同一条纪律）：组件**不**拿它
   *    过滤 `items` —— 在界面里再筛一次就是第二份"什么算符合条件"，而 `total`
   *    是服务端给的（两份口径一旦漂移，表现是"分页器说共 40 条、列表里却只有 3 条"）。
   * ⚠️ 它**必填**：少传它 = 五个下拉框全都停在"全部"（而列表是筛过的），
   *    那种界面上写着"全部"、实际只显示一部分的状态**没有任何解释**。
   */
  filters: TrackedFilterState;
  /**
   * 博主下拉的名册（公开只读那一份，`GET /api/tracking/roster`）。
   *
   * ⚠️ 空数组 = 名册还没取到、读失败、或者名单真的是空的。**这一格单独看**的降级是
   *    "下拉框里只剩「全部博主」"，而那本身不假：用户什么都没筛的时候，
   *    "全部"确实是当下的事实，列表也照常显示。
   *    组件不判断"是不是加载失败"（那是页面的事）—— 两种情况下这一格画出来的东西一样。
   * ⚠️★ 但**名册为空时不能说"这不说假话"**（终审 I2 的原话：那句话本身是假的）：
   *    地址栏里带着 `tcreator=<id>`（列表**真的**按它筛过）而名册里没有这个 id
   *    （读失败、或者那位博主已被删）时，`value` 匹配不上的 `<select>` 会被浏览器
   *    画成第一项「全部博主」⇒ 界面上写着"全部"、列表却只有几行，**没有任何解释**。
   *    ⇒ 处置见下面那个 `creatorUnknown` 选项：**补一项**让选中态与事实一致。
   *    代价（认下）：那一项说不出名字，只说"选了某一位"。
   */
  creators: TrackedCreatorSummary[];
  /**
   * 改一档筛选 / 排序。`value === undefined` = 回到「全部」（排序回到时间倒序）。
   *
   * ⚠️ 传的是**参数的原始值**（字符串），不是解析后的值：地址栏那一层
   *    （`lib/trackedQuery.ts` 的 `nextParamsForTrackedFilter`）才是唯一写 URL 的地方 ——
   *    组件里再校验一次就是第二份取值域，而两份迟早会漂。
   * ⚠️ 必填 —— 少传它 = 五个拉不动（且看起来完全正常）的下拉框。
   */
  onFilterChange: (key: TrackedFilterParam, value: string | undefined) => void;
  /**
   * 「清除筛选」：把这一栏的**七个**参数一起清掉（五个筛选 + 分区 + 页码），
   * 墙上那面墙的状态一个不动（`clearedTrackedFilterParams`）。
   * ⚠️ 必填：空态里那颗按钮是用户回到"什么都没筛"的唯一出口。
   */
  onClearFilters: () => void;
}

/**
 * 「追踪的博主」那一块（公开列表）。
 *
 * ⚠️ 这一块**在 `/videos` 页上**（用户裁决 R1），但它是**独立的一栏**：
 *    它与上面那面"大家自己贴的视频"墙没有关系（spec §8.1：两张表、两条路），
 *    所以它有自己的标题、自己的分页、自己的空态，字面上也不共用那面墙的词条。
 */
export function TrackedVideosSection({
  items,
  total,
  page,
  pageSize,
  empty,
  loading,
  error,
  platform,
  onPlatformChange,
  onPage,
  filters,
  creators,
  onFilterChange,
  onClearFilters,
}: TrackedVideosSectionProps) {
  const { t, i18n } = useTranslation();
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  /*
   * ★★ 筛选条与"清除筛选"的判据**只有一份**（`lib/trackedQuery.ts` 的 `hasTrackedFilters`）。
   *
   * ⚠️★ 它**故意不看 `sort`**：排序不改变结果集，所以"只是换了排序"的空列表
   *    不该说"这个筛选下没有视频"（那是一句让人去找一个不存在的筛选的话）。
   *    两处消费者（下面那颗清除按钮、`emptyTitle`）都问同一个函数。
   * ⚠️ `platform` 单独加进来：它也是这一栏的筛选（四颗 chip），只是它的判据与
   *    那五个不同（它的空态说**另一句话**，见 `emptyTitle`）。
   */
  const filterActive = hasTrackedFilters(filters);
  const showClear = filterActive || platform !== undefined;

  /*
   * ★★ 空态那一句话：**三种空**说三句不同的话（T8 起的两句 + 第 9 条这一句）。
   *
   * ⚠️★ 为什么必须分开说：`tracked.emptyHint`（下面第二句）把空的原因说成
   *    "名单上的博主还没有抓到 / 抓取每 10 分钟跑一轮"。在**某一个筛选**下空，
   *    原因常常是那个筛选条件太窄（今天总共 24 条，按"只看某位博主 + 只看短片"筛
   *    当然可能一条都没有）—— 照原样说的话，用户会去等抓取，
   *    而抓取永远不会让一个**筛得太窄**的列表长出东西来。
   * ⚠️ 判据的顺序是"**越具体越优先**"：筛选项 > 分区 > 什么都没筛。
   *    筛选项在最前是因为它**是用户刚刚做的那个动作**（他改完条件就该看到
   *    "这个筛选下没有"），而分区那条更像"这一栏本来就没有这个平台的内容"。
   * ⚠️ 判据都在这一层（`filters` / `platform` / `items` 都是本组件手里的 prop）：
   *    页面再判一次就是第二份口径（`empty` 那格 prop 的说明写着同一条）。
   */
  const emptyTitle = filterActive
    ? t('tracked.emptyFilter')
    : platform === undefined
      ? empty
      : t('tracked.emptyPlatform');

  return (
    <section className="tracked" aria-labelledby="tracked-title">
      <h2 className="tracked__title" id="tracked-title">
        {t('tracked.title')}
      </h2>
      <p className="tracked__sub">{t('tracked.subtitle')}</p>

      {/*
        ★★ 筛选条（第 9 条，2026-09-19）：五个 `<select>` —— 时间范围 / 标签 / 时长 /
        排序 / 博主。

        ⚠️★ 形状照 `routes/ResourceList.tsx` 那一排（`.filters` + `.filters__select`），
            **不另立一套控件**：全站的下拉框只有这一种外形，第二套会让同一页上两个
            筛选条长得不一样（而"哪一个是筛选"正是靠外形认出来的）。
        ⚠️★ 每个 `<select>` 都带 `aria-label`（读屏软件要靠它说清这五个组合框各是什么），
            而**可见的标签由第一个选项自己承担**（「全部时间」/「全部标签」…）——
            这是 `ResourceList` 那一处既有做法（那个 select 的标签就是它的默认选项）。
        ⚠️★ 筛选**全部在服务端做**（`?tsort=&ttag=&tdur=&ttime=&tcreator=`，第 9 条）：
            组件**不**拿 `filters` 去过滤 `items`。这里是"参数变了 ⇒ 页面重新取数"，
            而重取数由页面那一层负责（依赖数组里少一个值，表现就是"点了没反应"）。
        ⚠️ 认不出的值不会出现在这里：`filters` 由 `readTrackedFilters` 校验过
            （手打 `?ttag=foo` 退化成"全部"），所以下拉框的值永远落在选项里。
      */}
      <div className="filters">
        <select
          className="filters__select"
          aria-label={t('tracked.filterTime')}
          value={filters.time ?? ''}
          onChange={(event) =>
            onFilterChange(
              TRACKED_TIME_PARAM,
              event.target.value === '' ? undefined : event.target.value,
            )
          }
        >
          <option value="">{t('tracked.timeAll')}</option>
          {TRACKED_TIME_RANGE_IDS.map((id) => (
            <option key={id} value={id}>
              {t(TIME_KEYS[id])}
            </option>
          ))}
        </select>

        <select
          className="filters__select"
          aria-label={t('tracked.filterTag')}
          value={filters.tag ?? ''}
          onChange={(event) =>
            onFilterChange(
              TRACKED_TAG_PARAM,
              event.target.value === '' ? undefined : event.target.value,
            )
          }
        >
          <option value="">{t('tracked.tagAll')}</option>
          {TRACKED_VIDEO_TAGS.map((tag) => (
            <option key={tag} value={tag}>
              {t(TAG_KEYS[tag] ?? tag)}
            </option>
          ))}
        </select>

        <select
          className="filters__select"
          aria-label={t('tracked.filterDuration')}
          value={filters.duration ?? ''}
          onChange={(event) =>
            onFilterChange(
              TRACKED_DURATION_PARAM,
              event.target.value === '' ? undefined : event.target.value,
            )
          }
        >
          <option value="">{t('tracked.durAll')}</option>
          {TRACKED_DURATION_PRESET_IDS.map((id) => (
            <option key={id} value={id}>
              {t(DURATION_KEYS[id])}
            </option>
          ))}
        </select>

        {/*
          ⚠️ 排序那一格**没有空值选项**：排序永远有一个当前值（默认时间倒序）。
          ⇒ 它的第一个选项就是默认值本身，而值等于默认值时**不写进地址栏**
             （本仓"不把默认值拼进 URL"的约定）—— 所以这里传 `undefined`。
        */}
        <select
          className="filters__select"
          aria-label={t('tracked.filterSort')}
          value={filters.sort}
          onChange={(event) =>
            onFilterChange(
              TRACKED_SORT_PARAM,
              event.target.value === 'new' ? undefined : event.target.value,
            )
          }
        >
          <option value="new">{t(SORT_KEYS.new)}</option>
          <option value="views">{t(SORT_KEYS.views)}</option>
        </select>

        {/*
          博主下拉（用户第 9 条的原话："用下拉框展示所有追踪的博主"）。
          ⚠️ 名册来自**公开只读**那条路由（`?roster`），不是管理面板那一份 ——
             后者要 `live.manage`，而这一栏是所有人都在看的（线上匿名实测那条是 401）。
          ⚠️ 条数一起画出来（`videoCount`，只数公开可见的）：它是"这个人有没有内容"
             唯一的线索 —— 名单里今天就有条数为 0 的博主，而选中他只会得到一句
             "这个筛选下没有视频"。
          ⚠️★ 空名册**不再**等于"只剩「全部博主」"（终审 I2）：地址栏里带着 `tcreator=<id>`
             而这名字册里没有时，下面会补一项 `creatorUnknown` —— 否则浏览器会把选中态
             画成第一项「全部博主」，而列表是筛过的（界面上写"全部"、内容却只有几行）。
        */}
        <select
          className="filters__select"
          aria-label={t('tracked.filterCreator')}
          value={filters.creatorId ?? ''}
          onChange={(event) =>
            onFilterChange(
              TRACKED_CREATOR_PARAM,
              event.target.value === '' ? undefined : event.target.value,
            )
          }
        >
          <option value="">{t('tracked.creatorAll')}</option>
          {/*
            ⚠️★ I2 那一项：**名册里没有地址栏里那位博主**时才画（读失败 / 博主被删）。
            判据只看 `creators`，不看"名册取没取到" —— 那是页面的事，而这两种情况
            在界面上要给出同一句话（"确实选了一位，只是说不出是谁"）。
            ⚠️ 它的 `value` 就是地址栏里那个 id，所以选中态与事实一致；
            `onChange` 之后走的是同一条 `onFilterChange`（选「全部博主」= undefined）。
          */}
          {filters.creatorId !== undefined &&
          !creators.some((row) => row.id === filters.creatorId) ? (
            <option value={filters.creatorId}>{t('tracked.creatorUnknown')}</option>
          ) : null}
          {creators.map((row) => (
            <option key={row.id} value={row.id}>
              {t('tracked.creatorOption', {
                name: creatorLabel(row),
                platform: t(PLATFORM_KEYS[row.platform]),
                count: row.videoCount,
              })}
            </option>
          ))}
        </select>

        {/*
          ⚠️ 清除按钮**只在真的筛了什么的时候**出现（`showClear`）—— 它同时清掉分区，
             所以判据里含 `platform`。文案复用 `videos.clearFilters`（同一页上另一面墙
             也是这颗按钮，同一件事不该有两个说法）。
        */}
        {showClear ? (
          <button type="button" className="filters__clear" onClick={onClearFilters}>
            {t('videos.clearFilters')}
          </button>
        ) : null}
      </div>

      {/*
        ★★ 分区按钮（T7，spec §5.2）—— **照抄上面那面墙**（`routes/Videos.tsx` 那个
        `tagcloud`）：同一套类名（`tagcloud` / `tagcloud__label` / `tagchip` / `tagchip--on`）、
        同样的四个按钮、平台名走 `videos.platform*` 同一批词条。**不新增 CSS**。

        ⚠️★ 它排在**三态之外**（不跟着列表空 / 失败 / 加载中一起消失）：
           这正是分区最需要出现的时候 —— 在"Twitch 分区里一条都没有"那一屏上，
           四个按钮是用户**唯一**能退回「全部」的出口；把它们跟空态一起藏起来，
           表现就是"点进去之后这一栏什么都没有，而且退不回来"。
        ⚠️ 「全部」那一颗在 `platform === undefined` 时带 `--on`（与那面墙逐字同形）：
           「当前什么都没筛」也要看得出来，否则四个按钮都不亮，看起来像没选中任何一项。
        ⚠️ 平台名走 `PLATFORM_KEYS`（本文件上面那张表），**不在这里写第二份** ——
           同一个平台两个名字正是它当初被抽出来的原因。
        ⚠️ 它与上面那五个下拉框**是两套并列的筛选**（分区 vs 条件），四个按钮保留原样：
           `tplatform` 与第 9 条那五条各自独立、互相叠加（服务端两个条件都收）。
      */}
      <div className="tagcloud">
        <span className="tagcloud__label">{t('videos.allPlatforms')}</span>
        <button
          type="button"
          className={`tagchip${platform === undefined ? ' tagchip--on' : ''}`}
          onClick={() => onPlatformChange(undefined)}
        >
          {t('videos.allPlatforms')}
        </button>
        {TRACK_PLATFORMS.map((p) => (
          <button
            key={p}
            type="button"
            className={`tagchip${platform === p ? ' tagchip--on' : ''}`}
            onClick={() => onPlatformChange(p)}
          >
            {t(PLATFORM_KEYS[p])}
          </button>
        ))}
      </div>

      {loading ? <p className="state">{t('common.loading')}</p> : null}

      {error === null ? null : (
        <div className="state state--error">
          <p>{error}</p>
        </div>
      )}

      {!loading && error === null && items.length === 0 ? (
        /*
         * 空态是**一句陈述**，不是一块空白（本仓纪律：空白看起来像坏了）。
         * ⚠️ 「全部」那一档是**两句话**：第一句由页面给（"还没有追踪到视频"），第二句是
         *    这一栏的说明（这些视频由服务器定时抓、名单由编辑维护）—— 少了第二句，
         *    访客会以为这一栏坏了，或者以为我们漏掉了他的视频。
         * ⚠️★ 而**筛过**的那两档只有一句（`emptyTitle` = `tracked.emptyFilter` 或
         *    `tracked.emptyPlatform`）：第二句在那两档里说的原因是错的，
         *    而它正是要被取代的那句话（见上面 `emptyTitle` 那一整段）。
         * ⚠️★ 第二句的判据是"**什么都没筛**"（`!filterActive && platform === undefined`），
         *    不是原来那个只看 `platform` 的条件 —— 只看分区的话，用标签筛出空列表时
         *    会同时印出"这个筛选下没有视频"与"抓取每 10 分钟跑一轮"，
         *    而后一句把原因指向了抓取：用户会去等，而他要做的是把筛选放开。
         * ⚠️ 筛过的时候多给一颗「清除筛选」：`emptyFilter` 是一句结论，
         *    而用户接下来唯一该做的那件事就是**放开条件** —— 让他自己去五个下拉框里
         *    一个个猜是哪一个筛空的，比什么都别说更糟（那面墙的空态里也有同一颗按钮）。
         */
        <div className="tracked__empty">
          <p className="tracked__emptytitle">{emptyTitle}</p>
          {!filterActive && platform === undefined ? (
            <p className="tracked__emptyhint">{t('tracked.emptyHint')}</p>
          ) : null}
          {filterActive || platform !== undefined ? (
            <button type="button" className="filters__clear" onClick={onClearFilters}>
              {t('videos.clearFilters')}
            </button>
          ) : null}
        </div>
      ) : null}

      {!loading && error === null && items.length > 0 ? (
        <>
          <p className="resultcount">{t('tracked.count', { count: total })}</p>

          <ul className="tracked__grid">
            {items.map((video) => (
              <li className="tracked__card" key={video.id}>
                {/*
                  ★★ 媒体那一格是一个**门面**（T7，spec §5.3）：点一下才真的挂 iframe。
                  ⚠️ 这里是全站唯一那份嵌入实现（`ClickToPlayEmbed`）的第三个调用点 ——
                     绝不在这里再写一份地址拼接 / 权限 / 门面：复制一份之后的典型剧情是
                     "某天修好了其中一份，另一份没改"（那个组件文件头写着这件事）。

                  ⚠️★ 封面走 T6 新加的 `coverUrl`：它的三样属性是**契约**
                     （`alt=""` + `loading="lazy"` + `referrerpolicy="no-referrer"` ——
                     bilibili 图床按 Referer 白名单放行，带 Referer 是 403），
                     而 `thumbnailUrl` 为 `null` 时门面**回到纯色块**（§5.3）：
                     不许画一个空框、也不许画一条破图边框 —— 那种东西每次都要人解释一遍。
                  ⚠️ 六格里另外五格（标题 / 发布时间 / 时长 / 播放量 / 评论数）**一格没动**（§8.4）：
                     变的是封面那一格的**可访问名**从 `img` 的 `alt` 挪到了门面按钮的
                     `aria-label` 上（`img` 自己变成装饰性的 `alt=""`）。
                  ⚠️★ 「去原站」那条外链**留在** `children` 里（§5.3 那张表）：
                     它是**兜底出口** —— 嵌不出来 / 被墙 / 平台抽风时，用户更需要的正是它，
                     所以它既不能删、也不该被挪到别处去。
                     ⚠️ 它的 URL 形状仍然走 `watchUrl`（`VideoEmbed.tsx`）：三个平台的地址
                     形状已经在那边跑过一轮，**不在这里抄第二份** —— 抄错的表现是一条
                     404 的链接，而它不会让任何门禁变红。
                */}
                <div className="tracked__media">
                  <ClickToPlayEmbed
                    platform={video.platform}
                    idLabel={video.externalId}
                    title={video.title}
                    startOffsetSec={null}
                    coverUrl={video.thumbnailUrl}
                  >
                    <a
                      className="tracked__out"
                      href={watchUrl(video.platform, video.externalId)}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                    >
                      {t('videos.openOriginal')}
                    </a>
                  </ClickToPlayEmbed>
                </div>

                <div className="tracked__body">
                  <div className="tracked__head">
                    <span className="badge badge--kind">{t(PLATFORM_KEYS[video.platform])}</span>
                    {/*
                      ★★ 博主名字（用户第 8 条，2026-09-19）：排在平台徽章**右边**。

                      ⚠️★ 判据是**值本身**（空串 / 没有 ⇒ **整格不渲染**）：
                        · `creatorName` 为 `''`（库里那一列是空串）或 `undefined`（管理面板
                          那一侧的形状）时，这一格就不该存在 —— **不许**退化成 handle、
                          也不许印一个空框（两者都会让人以为数据坏了，而"没有名字"
                          本来就不需要解释，与"空容器不渲染"是同一条纪律）；
                        · 服务端已经把 `NULL` 收成空串了（`toTrackedVideo` 那一段），
                          所以这里用真假判断就够，两边的判据是同一个。
                      ⚠️ 名字**不是**链接：用户第 8 条只要"显示博主名称"，而把名字变成
                        入口会多出一个去处（博主主页）与一条我们没抓过的 URL 形状。
                        真要看全部视频，「去原站看」那条兜底外链就在下面。
                      ⚠️ 它是**额外**加上去的一格：`tracked__head` 本来就是 flex-wrap，
                        窄屏上它会自己换行（不需要新的布局规则）。
                    */}
                    {video.creatorName ? (
                      <span className="tracked__creator">{video.creatorName}</span>
                    ) : null}
                    {/*
                      标签容器**只在有标签时渲染**：渲染一个空的
                      `<ul class="tracked__tags">` 会占掉一行高度，读起来像"这里本来
                      该有标签、结果丢了" —— 一个不存在的容器不需要任何解释，
                      而一个空容器每看一次都要解释一次。
                      ⚠️ 这条是**本块自己的判断**，不是从规格抄来的：spec 里没有任何
                      一节裁决过空容器（原先这里引的 "§5.2" 讲的是 **YouTube 适配器**，
                      与容器毫无关系）。引用一个不存在的裁决比不引更糟 ——
                      下一个人会去找它，然后以为是自己读漏了。
                      ⚠️ "`durationSec` 为 null 时一个时长标签都不打"是抓取那一侧的事
                      （`deriveTags`）；界面这一侧只管画它拿到的。
                    */}
                    {video.tags.length === 0 ? null : (
                      <ul className="tracked__tags">
                        {video.tags.map((tag) => (
                          <li className="tracked__tag" key={tag}>
                            {tagLabel(tag, t)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <h3 className="tracked__cardtitle">{video.title}</h3>

                  <dl className="tracked__meta">
                    <dt className="tracked__metalabel">{t('tracked.publishedAt')}</dt>
                    <dd className="tracked__published">
                      {localDate(video.publishedAt, i18n.language)}
                    </dd>

                    <dt className="tracked__metalabel">{t('tracked.duration')}</dt>
                    <dd className="tracked__duration">
                      {video.durationSec === null ? DASH : formatTimecode(video.durationSec)}
                    </dd>

                    <dt className="tracked__metalabel">{t('tracked.views')}</dt>
                    <dd className="tracked__views">
                      {video.viewCount === null ? DASH : String(video.viewCount)}
                    </dd>

                    <dt className="tracked__metalabel">{t('tracked.comments')}</dt>
                    <dd className="tracked__comments">
                      {video.commentCount === null ? DASH : String(video.commentCount)}
                    </dd>
                  </dl>
                </div>
              </li>
            ))}
          </ul>

          {totalPages > 1 ? (
            /*
             * 分页控件沿用本仓既有那一套（`.pager` / `.pager__pos`，与视频墙逐字同形）。
             * ⚠️ 那三句文案也复用 `videos.*`（"第 X / Y 页" / 上一页 / 下一页）：
             *    同一页上两个分页器说的是同一件事，各有各的句子只会漂成两种说法。
             * ⚠️★ 但 `aria-label` **必须**分开（`tracked.pagerLabel`）：读屏软件靠它
             *    分得清这一页上的两个 `<nav>`，两边都叫 "pagination" 时用户听到的是
             *    两个同名导航（而这一页上确实有两个）。
             */
            <nav className="pager" aria-label={t('tracked.pagerLabel')}>
              <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
                ← {t('videos.prevPage')}
              </button>
              <span className="pager__pos">{t('videos.page', { page, total: totalPages })}</span>
              <button type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
                {t('videos.nextPage')} →
              </button>
            </nav>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/** 加博主那一栏的红字槽。⚠️ 对象而不是一个字符串：见下面 props 的说明。 */
export interface TrackedCreatorFieldErrors {
  input?: string;
}

/**
 * 管理面板（**只有 `live.manage` 看得到**）。
 *
 * ⚠️★ `canManage` 是**页面**算出来传进来的（`useCan('live.manage')`），组件里
 *    **不判断能力** —— 与 `VideoCard` 的 `canAuthor` 同一条：`permissions.ts` 是
 *    "谁是编辑"的唯一定义，组件里再写一份就是第二份真相。组件只决定**显不显示**：
 *    为 false 时整块返回 `null`。
 *    ⚠️ 为什么还留这一层（而不是让页面干脆不渲染它）：这样"没有能力时整块不渲染"
 *    是一件**可断言**的事（渲染自检用两个 props 对照：true 有 / false 没有）；
 *    页面那一侧同时**不发请求**（免得非编辑每次打开 `/videos` 都吃一个 403）。
 */
export interface TrackedCreatorsPanelProps {
  canManage: boolean;
  loading: boolean;
  /** 有动作在飞（加 / 停用 / 重新回填 / 删）—— 期间所有控件都禁用。 */
  busy: boolean;
  creators: TrackedCreator[];
  /**
   * ★★ 名单**没取到**（发出去的那个 GET 失败了）时的那一句话；`null` = 没出错。
   *
   * ⚠️★ 这一格**必须**有，而且与 `notice` 是**两件事**（虽然两者都是"一句话"）：
   *   · `notice` 说的是**某个动作的结果**（刚才那一下加 / 停用 / 回填 / 删怎么了）；
   *   · 这一格说的是**这张表本身没读到** —— 于是下面那句"名单还是空的"是**假话**，
   *     而且它会把编辑送去重贴一条**已经在名单上**的链接（再贴必然拿到 `duplicate`）。
   * ⚠️ 计划里那行接口签名写的是 `error`，本组件里叫 `loadError`：与 `notice` 并排时，
   *   "error" 会被读成"动作失败了"（那正是 `notice.kind === 'bad'` 在说的事），
   *   而这一格唯一的意思就是"列表没读到，界面不知道名单现在是什么样"。
   * ⚠️ 两格可以同时有内容（通知在上、这一句在下），不需要"谁说"的规则：
   *   它们回答的是不同的问题（"我刚才那一下怎么了" vs "这张表现在是什么状态"）。
   */
  loadError: string | null;
  /** 加博主输入框里的**原文**（受控 —— 见文件头"纯视图"那一段）。 */
  input: string;
  /**
   * 字段级红字。⚠️ 对象而不是一个 `string`：它是页面↔视图的**契约形状**，
   * 与 `SeedPickerPanel.fieldErrors` 同形；将来多一个字段是加一个槽，
   * 而不是改所有调用点（今天只有一个槽 —— 面板只有一栏输入）。
   */
  fieldErrors: TrackedCreatorFieldErrors;
  /**
   * 面板顶部的那一条（失败的原因 / 刚做完那件事的结果）；`null` = 没有要说的。
   *
   * ⚠️ 计划里这一格写的是 `error: string | null`。**这是一处有意的偏差**，理由两条：
   *   ① 有的动作在界面上**看不出效果** —— 「重新回填」改的是库里的 `backfill_done`，
   *      表格里没有这一列 ⇒ 不报一句"已排队、下一轮生效"的话，那颗按钮是**静默**的
   *      （用户会连点三次，然后以为它坏了）；
   *   ② 分成 `error` + `ok` 两个槽就多出一条"两个都有时谁说"的规则（而那条规则
   *      没有任何门禁看得见）。⇒ 合成一格，用 `Notice` 自己的 `kind` 表达。
   */
  notice: { kind: 'ok' | 'bad' | 'info'; text: string } | null;
  /** 正在等二次确认的那一行；`null` = 没有。⚠️ 由**页面**持有（组件无状态）。 */
  confirmingId: string | null;
  onInput: (next: string) => void;
  /** 提交"加一个博主"。⚠️ 它会真的去上游解析（见 `lib/api.ts` 的说明）。 */
  onAdd: () => void;
  /** 停用 / 启用。 */
  onToggle: (id: string, enabled: boolean) => void;
  /** 重新回填（把 `backfill_done` 置 0 ⇒ 下一轮从第一页重走）。 */
  onRebackfill: (id: string) => void;
  /** 请求二次确认（传 `null` = 取消）。 */
  onAskDelete: (id: string | null) => void;
  /** 确认删除。⚠️ 他的视频**跟着一起没**（外键级联），所以这一步不可逆。 */
  onDelete: (id: string) => void;
}

/**
 * 名单 + 加博主 + 每行的三个动作（spec §6.2 第二段）。
 *
 * ⚠️★ 为什么"上次同步 / 上次错在什么"必须摆在表格里（spec §6.3）：
 *    bilibili 的 `-412` 是**概率性**的 ⇒ "今天没有新视频"与"今天一条都没抓到"
 *    在日志里**长得一模一样**。不把这两个读数摆到人眼前，这个功能会**静默**坏掉：
 *    访客那边只是"这一栏很久没更新"，而没有任何人会去看。
 */
export function TrackedCreatorsPanel({
  canManage,
  loading,
  busy,
  creators,
  loadError,
  input,
  fieldErrors,
  notice,
  confirmingId,
  onInput,
  onAdd,
  onToggle,
  onRebackfill,
  onAskDelete,
  onDelete,
}: TrackedCreatorsPanelProps) {
  const { t, i18n } = useTranslation();

  // 没有能力 ⇒ 整块不存在（判据在页面那一层算，见上面 `canManage` 的说明）
  if (!canManage) return null;

  return (
    <section className="tracked__manage" aria-labelledby="tracked-manage-title">
      <h2 className="tracked__title" id="tracked-manage-title">
        {t('tracked.manageTitle')}
      </h2>
      <p className="tracked__sub">{t('tracked.manageSub')}</p>

      {notice === null ? null : <Notice kind={notice.kind}>{notice.text}</Notice>}

      <form
        className="tracked__add"
        onSubmit={(event) => {
          /*
           * ⚠️ 必须拦住默认提交：不拦的话浏览器会整页跳转
           *    （地址变成 `?input=…`），而我们所有的状态都在这一页上 ——
           *    表现是"点完『添加』页面白了一下，那个博主也没加进去"。
           */
          event.preventDefault();
          onAdd();
        }}
      >
        <Field id="tracked-add" label={t('tracked.addLabel')} hint={t('tracked.addHint')}>
          <div className="tracked__addrow">
            <input
              id="tracked-add"
              className="mcsr-field__input"
              value={input}
              placeholder={t('tracked.addPlaceholder')}
              disabled={busy}
              onChange={(event) => onInput(event.target.value)}
            />
            <button type="submit" className="cta tracked__addbtn" disabled={busy}>
              {busy ? t('tracked.addBusy') : t('tracked.addAction')}
            </button>
          </div>
          {fieldErrors.input === undefined ? null : <p className="fielderr">{fieldErrors.input}</p>}
        </Field>
      </form>

      {loading ? <p className="state">{t('common.loading')}</p> : null}

      {/*
        ★★ 名单**没取到** ⇒ 这一块，而**不是**下面那句"名单还是空的"。
        ⚠️ 这句话在这里是**必须**的：没有它，取数失败会渲染成"名单还是空的 —— 在上面
        贴一个博主的链接"，而那句话既假（名单不是空的，是没读到）又有害（编辑会去重贴
        一条已经在名单上的链接，然后拿到 `duplicate`）。这与公开列表那一栏的 `error`
        是同一条纪律（文件头"空的列表与没取到的列表是两件事"）。
        ⚠️ 与 `notice` 不冲突、也不互相覆盖：notice 在更上面，说的是"刚才那个动作怎么了"。
      */}
      {loadError === null ? null : (
        <div className="state state--error">
          <p>{loadError}</p>
        </div>
      )}

      {!loading && loadError === null && creators.length === 0 ? (
        <p className="tracked__empty">{t('tracked.manageEmpty')}</p>
      ) : null}

      {!loading && loadError === null && creators.length > 0
        ? /*
           * ★★ 名单按平台分成**三段**（T8，spec §5.4）：顺序照 `TRACK_PLATFORMS`
           *    （bilibili → youtube → twitch），每段一个小标题 + 该段条数。
           *
           * ⚠️★ 为什么是**三个 `<section>`** 而不是"一张表里插三行小标题"：
           *    spec §5.4 要的每一段都有自己的**小标题与条数**，而它们在 `<table>` 里
           *    只能变成一个没有语义的额外行（读屏软件念出来是一张表里混着几行标题）；
           *    顺带每段还各自拿到一个 `.tracked__tablescroll` —— 窄屏上横滚的是**那一段**，
           *    而不是把整块面板一起推出去。
           * ⚠️★ 空的分段**连小标题一起不画**（下面那行 `return null`，spec §5.4）：
           *    一个只有标题的空壳看起来像"这一段的数据没加载出来"（与"空容器不渲染"
           *    同一条纪律）。⚠️ 三段**都**空不是这里的事 —— 那种情况走上面那句
           *    "名单还是空的"（`creators.length === 0`），所以这里不必画任何空态。
           * ⚠️ 段内顺序**就是**名单接口返回的那个数组的顺序：这里只 `filter`，**不排序**
           *    —— 段内次序由 `listCreators` 那一条 `ORDER BY c.created_at DESC, c.id ASC`
           *    决定（**新加入的在前**）。在界面里再排一次就是第二份"谁在前"的口径，
           *    而照"加入顺序"补一句升序排序会把整份名单**倒过来**（spec §5.4）。
           * ⚠️ `rows` 是 `creators` 的子集（不是第二份数据）：`key` 仍然用 `creator.id`。
           */
          TRACK_PLATFORMS.map((platform) => {
            const rows = creators.filter((creator) => creator.platform === platform);
            // ⚠️ 空的分段连小标题一起不画（spec §5.4）
            if (rows.length === 0) return null;
            return (
              <section className="tracked__group" key={platform}>
                <h4 className="tracked__grouptitle">
                  {t(PLATFORM_KEYS[platform])}
                  <span className="tracked__groupcount">{rows.length}</span>
                </h4>
                {/*
                 * ⚠️ 外面套一层 `.tracked__tablescroll`（横向滚动兜底）：七列在窄屏上
                 *    装不下，而"顶出一条**页面级**的横向滚动条"是整页在动，比表格自己
                 *    滚一次糟得多（`.ranked__tablescroll` 为同一件事写过完整的一段）。
                 * ⚠️ 表格形状复用 `.admintable`（全站唯一的表格形状，账号管理页在用）：
                 *    在这里再写一遍那几行属性就是第二份会漂移的口径。
                 */}
                <div className="tracked__tablescroll">
                  <table className="admintable tracked__table">
                    <thead>
                      <tr>
                        <th>{t('tracked.colPlatform')}</th>
                        <th>{t('tracked.colName')}</th>
                        <th>{t('tracked.colState')}</th>
                        <th>{t('tracked.colSynced')}</th>
                        <th>{t('tracked.colError')}</th>
                        <th>{t('tracked.colVideos')}</th>
                        <th>{t('tracked.colActions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((creator) => (
                        <tr
                          className={`tracked__row${creator.enabled ? '' : ' tracked__row--off'}`}
                          key={creator.id}
                        >
                          <td>
                            <span className="badge badge--kind">
                              {t(PLATFORM_KEYS[creator.platform])}
                            </span>
                          </td>
                          <td className="tracked__name">
                            {/*
                              ⚠️ `display_name` 是 NOT NULL，但**可能是空串**（迁移 020 那一列的
                              `DEFAULT ''`）—— 空串在这里显示成 `—`：一个空白的名字格看起来像
                              界面坏了，而 `—` 说的正是"这一格没有值"。
                            */}
                            <span className="tracked__displayname">
                              {creator.displayName || DASH}
                            </span>
                            {creator.handle === '' ? null : (
                              <span className="tracked__handle">{creator.handle}</span>
                            )}
                          </td>
                          <td className="tracked__state">
                            {creator.enabled ? t('tracked.stateOn') : t('tracked.stateOff')}
                          </td>
                          <td className="tracked__synced">
                            {/*
                              ⚠️ **秒**的时间戳，必须经 `toMillis`；从没同步过是 `null` ⇒ `—`
                              （**不是** 1970 —— 那是这一整类 bug 最容易漏的一格：
                              `new Date(null)` 恰好也是 1970，所以"忘了判 null"与"忘了乘 1000"
                              在这一格上长得一样，而两者都要靠这一条断言拦住）。
                            */}
                            {localDateTime(creator.lastSyncedAt, i18n.language)}
                          </td>
                          <td className="tracked__err">
                            {creator.lastError === null ? DASH : creator.lastError}
                            {creator.consecutiveFailures > 0 ? (
                              <span className="tracked__streak">
                                {t('tracked.failStreak', { count: creator.consecutiveFailures })}
                              </span>
                            ) : null}
                            {/*
                              ★★ 冷却窗口（迁移 022，`docs/pending.md` §5.98）。

                              ⚠️★ 为什么它**必须**画出来：连续失败满 3 次之后这个博主会被
                              `pickDueCreators` **跳过一小时**，而在名单上他与其他"只是还没到点"
                              的博主长得**一模一样** —— 不写这一句的话，操作者看到的就是
                              "这一栏很久没更新，而且日志里连失败都没有"（那一小时里一条失败
                              记录都不会有，因为**一个请求都没发**）。这一格是那个状态唯一的出口。
                              ⚠️★ 又是**秒**的时间戳 ⇒ 必须经 `toMillis`（本文件头那段）：
                              裸的 `new Date(creator.cooldownUntil)` 少乘 1000，显示出来是 1970 年，
                              而类型检查拦不住（两边都是 number）。用的是与"上次同步"同一支
                              `localDateTime`（同一个换算点，不在这里再写一遍）。
                              ⚠️ `null` ⇒ **一个字都不画**（`=== null ? null : …`）：写 `—` 的话
                              每一行都会多出一句"这一格没有值"，而"没有冷却"这件事不需要解释
                              （与 `hiddenCount > 0` 才画括号、空容器不渲染是同一条纪律）。
                              ⚠️ 已知的残余（写在这里，别当成 bug 查）：这一列**只有一次成功会清它**
                              （`advanceCursor`），所以窗口过期但一直没被同步到的博主仍然带着一个
                              **过去**的死线 —— 这一格会照样把那句"冷却中"画出来。前提是
                              "他既没被挑中、也没成功过"，而这个前提本身分两档：
                              "**已停用**"与"**平台没凭据**"这两档是**永久**的 —— 停用的博主不进待办、
                              没凭据的平台整段被跳过 ⇒ 那一列**既不会被重新武装、也不会被清掉**，
                              这句"冷却中，至 <一个过去的时刻>"就一直挂在名单上（不是"晚一步"）。
                              第三档（被限额挤掉）会自己过去。而无论哪一档，
                              "他为什么没更新"本来就在上面那一列里写着。
                            */}
                            {creator.cooldownUntil === null ? null : (
                              <span className="tracked__cooldown">
                                {t('tracked.cooldown', {
                                  until: localDateTime(creator.cooldownUntil, i18n.language),
                                })}
                              </span>
                            )}
                          </td>
                          <td className="tracked__total">
                            {String(creator.videoCount)}
                            {/*
                              ★★ `N（隐藏 M）`（spec §5.4）：M = 0 时**连括号一起不画** ——
                              不存在的状态不需要解释（与"空容器不渲染"同一条纪律）。
                              ⚠️ `N` 仍然是**库里所有行**（含隐藏）的条数：它是 bilibili
                              "到底判据"的输入（全局约束 5），隐藏功能**不许**碰它的语义
                              ⇒ 隐藏的那几条是**加在括号里**说出来的，不是从 N 里减掉。
                              ⚠️ 括号是全角 `（）`，由这里给（不是词条的一部分）：两种语言
                              都长成 `N（…）`，而词条只回答"M 怎么说"（见 `zh-CN.ts` 那一句）。
                              ⚠️ M 是服务端算的（`listCreators` 的 `SUM(CASE WHEN …)`）：
                              这一层不数、也不猜 —— 猜的话两个数迟早对不上。
                            */}
                            {creator.hiddenCount > 0
                              ? `（${t('tracked.hiddenCount', { count: creator.hiddenCount })}）`
                              : null}
                          </td>
                          <td className="tracked__actions">
                            <button
                              type="button"
                              className="ghostbtn"
                              disabled={busy}
                              onClick={() => onToggle(creator.id, !creator.enabled)}
                            >
                              {creator.enabled ? t('tracked.disable') : t('tracked.enable')}
                            </button>
                            <button
                              type="button"
                              className="ghostbtn"
                              disabled={busy}
                              title={t('tracked.rebackfillHint')}
                              onClick={() => onRebackfill(creator.id)}
                            >
                              {t('tracked.rebackfill')}
                            </button>
                            {/*
                              删除走**行内两步确认**（照 `VideoCard` 的先例，不用 `window.confirm`：
                              原生弹窗与整站样式无关，而且会阻塞渲染）。
                              ⚠️ 为什么删一个博主值得确认、而停用不值得：删掉之后他的视频靠外键
                              **一起没了**（spec §4.2），重建只能靠重新添加 + 重新回填一整轮。
                            */}
                            {confirmingId === creator.id ? (
                              <>
                                <span className="tracked__confirm">
                                  {t('tracked.confirmDelete')}
                                </span>
                                <button
                                  type="button"
                                  className="dangerbtn"
                                  disabled={busy}
                                  onClick={() => onDelete(creator.id)}
                                >
                                  {t('common.confirm')}
                                </button>
                                <button
                                  type="button"
                                  className="ghostbtn"
                                  disabled={busy}
                                  onClick={() => onAskDelete(null)}
                                >
                                  {t('common.cancel')}
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="dangerbtn"
                                disabled={busy}
                                onClick={() => onAskDelete(creator.id)}
                              >
                                {t('tracked.delete')}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })
        : null}
    </section>
  );
}
