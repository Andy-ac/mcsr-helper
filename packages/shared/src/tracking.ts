/**
 * 追踪的视频博主 —— **前后端共用的一份契约**。
 *
 * 服务器抓回来的东西（`tracked_creators` / `tracked_videos`，迁移 020）与
 * `/videos` 页上那块「追踪的博主」分区读的是**同一个形状**，
 * 所以它和 `liveShares.ts` / `videos.ts` 一样住在这里，而不是各写一份。
 *
 * ⚠️ 为什么规则要放在 shared 而不是组件里：`apps/web` **没有测试运行器**
 *    （见 `lib/shareTime.ts` 的文件头），写在组件里那条规则就只有人眼能验；
 *    而本包的行为由 `services/api` 那套测试钉住（`live-shares-schema.test.ts`
 *    的文件头写了这条惯例："共享模块的行为一律在这里被钉住"）。
 */
import { z } from 'zod';
/*
 * ⚠️ `DEFAULT_PAGE_SIZE` 从 `resources.ts` 拿，**不在这里再写一个 24**：下面那个
 *    `TrackedVideoQuerySchema` 的默认值必须与界面算总页数用的是**同一个数**
 *    （`routes/tracking.ts` 当初也是从这一处 import 的，搬进 shared 时这一点没变）。
 */
import { DEFAULT_PAGE_SIZE } from './resources';

/**
 * 能追踪的平台。取值与顺序都与迁移 020 那两条 `CHECK (platform IN (...))` 一致。
 *
 * ⚠️ 它与 `constants.ts` 的 `VIDEO_PLATFORMS` / `LIVE_PLATFORMS` **是三回事**，别合并
 *    （那两处的注释已经写过这条理由，这里是第三个例子）：
 *   · `VIDEO_PLATFORMS` = 我们能**嵌入**哪个平台的视频；
 *   · `LIVE_PLATFORMS`  = 我们记录哪些平台的**频道**；
 *   · `TRACK_PLATFORMS` = 我们的抓取适配器认识哪三个平台（三个平台各一个适配器，
 *     各自独立失败，见 spec §3.5）。
 *    它们现在取值恰好相同，但回答的是三个问题；合并的那一刻，加一个平台就会被逼着
 *    同时改"能不能嵌"和"抓不抓得到"。
 *
 * ⚠️ 代价（明知而认下，且本仓无解）：同一组字符串现在出现在**四处** ——
 *    这三个常量 + 迁移 020 里的两条 `CHECK`。加第四个平台的完整动作是
 *    "改两处常量 + 开一次迁移重建两张表"（SQLite 改 `CHECK` 只能重建表）。
 *    把这一层做成 `satisfies` / 类型守卫去自动对齐是做不到的：数据库不认 TypeScript。
 */
export const TRACK_PLATFORMS = ['bilibili', 'youtube', 'twitch'] as const;
export type TrackPlatform = (typeof TRACK_PLATFORMS)[number];

/**
 * 本栏目的时间戳是 Unix **秒**；界面渲染一律经这里转成毫秒。
 *
 * ⚠️ 它存在的理由（spec §4 那个 ★★ 块的裁决，2026-09-16 补的）：
 *   `tracked_creators` / `tracked_videos` 两张表**整张**都用**秒** —— 因为上游
 *   bilibili 的 `created` 就是秒（`docs/video-tracking-spec.md` §2.2），而我们自己的
 *   记账列要是用毫秒，**同一行里就会同时存在两个单位**，那是这一整类 bug 里
 *   最难查的一种（排序是对的、渲染是错的）。
 *   代价就是本函数：本仓其它表与浏览器那一套（`new Date(ms)` / `Intl`）全是**毫秒**，
 *   ⇒ 换算是必须的，而它必须只有**一个**地方可做、可忘。
 *   ⚠️ 所以 §6.2 的界面里出现裸的 `new Date(row.publishedAt)`（或 `Date.now() - row.x`）
 *   就是一条真缺陷：那个数少乘了 1000，显示出来是 1970 年，而类型检查拦不住它。
 *
 * ⚠️ `null` / `undefined` 一律**返回 `null`**，不返回 0、也不返回 `NaN`：本仓纪律是
 *   "拿不到的字段就是 `null`，绝不许退化成 0"（见下面 `TrackedVideo` 那段 ★★ 注释
 *   —— 0 毫秒是 1970-01-01，在界面上看起来像一条真实数据）。
 * ⚠️ 反面同样不许：写成 `sec || null` 会把**真的 0 秒**当成"没有值"—— 0 是一个合法
 *   的 Unix 时刻。所以判据只能是 `== null`（`=== null || === undefined`），
 *   有测试同时钉住这两侧。
 */
export function toMillis(sec: number | null | undefined): number | null {
  if (sec === null || sec === undefined) return null;
  return sec * 1000;
}

/**
 * 一条追踪到的视频（公开列表 / 管理面板共用的形状）。
 *
 * ⚠️★ 五个计量字段（`publishedAt` / `durationSec` / `viewCount` / `commentCount` /
 *    `thumbnailUrl`）都**可以是 `null`**，而且**不许在别处退化成 `0` 或 `''`**：
 *    这是本仓既有纪律（`apps/web/src/components/SeedResultCard.tsx:154-155` 贴在该卡
 *    `record.matchDate` 渲染上的那条注释："null 是真实存在的…**不能**显示成 0 ——
 *    1970 年 1 月 1 日看起来像一条真实数据"）。
 *    ⚠️ 它**不在** `seed.ts` 里（那边的 `SeedRecord.matchDate` 是没注释的字段）——
 *       这行注释的第一版就是这么指错的，别再跟着抄。
 *    落在这里具体是：**播放量 0 与"上游没给播放量"是两件事** —— 填 0 之后
 *    "这支视频没人看"与"这个平台这一轮没回这个字段"在界面上一模一样，
 *    而后者是**接口悄悄变了**的信号。⇒ 界面上那几格要自己处理"没有值"（显示破折号）。
 */
export interface TrackedVideo {
  id: string;
  creatorId: string;
  platform: TrackPlatform;
  /** 平台侧的 id（bvid / YouTube videoId / Twitch video id）。 */
  externalId: string;
  title: string;
  thumbnailUrl: string | null;
  /** 发布时间的 **Unix 秒**（不是毫秒）。拿不到时 `null`。 */
  publishedAt: number | null;
  /** 时长，**秒**。拿不到时 `null` —— ⚠️ 填 0 会让 `short`(≤60s) 标签打错（spec §4.3）。 */
  durationSec: number | null;
  viewCount: number | null;
  commentCount: number | null;
  /** 库里是 `INTEGER`（0/1），在这一层是 `boolean` —— 边界上只换算一次（spec §4.3）。 */
  isLiveReplay: boolean;
  /** 由数据判定的标签（`liveReplay` / `short` / `long`）。库里存 JSON 数组文本，这里已经解析好。 */
  tags: string[];
  /*
   * ⚠️ 这一格按计划写的形状是 `string` 而不是 `'visible' | 'hidden'` 的联合。
   *    值域真正被强制的地方是数据库那条 `CHECK (status IN ('visible','hidden'))`
   *    （迁移 020，有测试钉着）—— 所以它不是"没有约束"，只是约束不在这一层。
   */
  status: string;
  /** 第一次抓到的 Unix 秒。⚠️ 它不是发布时间：补录旧视频时两者能差好几年。 */
  firstSeenAt: number;
  /**
   * 这位视频的博主**显示名**（`tracked_creators.display_name`）。
   *
   * ⚠️★ 这一格的来历改过一次（2026-09-19，用户第 8 条）：
   *   原来这里写的是"只有管理面板要，公开列表不填"，于是公开列表里每一行都**不知道
   *   自己是谁的视频** —— 而用户要的正是"每张卡上显示视频博主名称"。
   *   ⇒ 现在公开列表**也填**（多一次 JOIN，读的是同一批行的 `display_name`）。
   *
   * ⚠️ 它仍然标成可选（`?`）：**管理面板的写入响应**（POST/PATCH 回的 `creator`）
   *    不是视频，别的地方也不一定经过那个 JOIN。判断"能不能显示"只能看值本身
   *   （空串 = 没名字），**不许**在这里补一个默认值。
   */
  creatorName?: string;
}

// ---------------------------------------------------------------------------
// 第 9 条的取值域与预设（2026-09-19）
// ---------------------------------------------------------------------------

/**
 * 标签 —— `deriveTags` 派生出来的那三个（spec §4.3 冻结：`liveReplay` / `short` / `long`）。
 *
 * ⚠️ 顺序与 `services/api/src/tracking/parse.ts` 的产出顺序**无关**：这里要的是
 *   "界面下拉框里按什么顺序列"，而**写入值是** `deriveTags` 决定的（它先 `liveReplay`，
 *   再按 60 秒 / 20 分钟二选一）。
 * ⚠️ 它与 `TrackedVideo.tags`（`string[]`）**不是一回事**：那个是"这一行有什么标签"，
 *   这个是"筛选能填哪些值"。界面渲染标签时仍然按原样显示表里没有的（见
 *   `TrackedVideos.tsx` 的 `TAG_KEYS`），但**筛选**只认这三个 —— 否则筛一个
 *   派生器永远不会产出的值，界面上表现为"这个标签下没有视频"。
 */
export const TRACKED_VIDEO_TAGS = ['liveReplay', 'short', 'long'] as const;
export type TrackedVideoTag = (typeof TRACKED_VIDEO_TAGS)[number];

/**
 * 排序。`new` = 今天的行为（`published_at DESC`）；`views` = 播放量倒序。
 *
 * ⚠️★ 两个键都在**数据库里**排，不是取回来在内存里排：分页是在 SQL 那一层切的
 *   （`LIMIT/OFFSET`），在内存里排只会把**这一页**重排一遍 —— 症状是
 *   "第 1 页看起来是对的，翻到第 2 页开始乱"，而那**不报错**。
 */
export const TRACKED_SORTS = ['new', 'views'] as const;
export type TrackedSort = (typeof TRACKED_SORTS)[number];

/** 时长的上界（秒）：24 小时。与 `MAX_START_OFFSET_SEC` 同量级，理由也一样 —— 比这更长的"视频"不是我们的场景。 */
export const TRACKED_MAX_DURATION_SEC = 86400;

/**
 * 时间戳的上界（Unix 秒）：**2100-01-01T00:00:00Z**。
 *
 * ⚠️★ 这个数唯一的作用是**把单位错误变成 400**：`since` / `until` 是**秒**，而
 *    毫秒是它们的 1000 倍（1.7e12 量级）。没有上界时，把毫秒填进来得到的是一份
 *    **空列表** —— 语法合法、界面正常、看起来就是"这段时间没有视频"，
 *    而那正是本仓最怕的那种"什么都没有发生"。
 *    ⚠️ 2100 这个具体值没有神圣性，只需要**远在任何真实发布时间之后**：
 *    本仓所有时间列都是 Unix 秒，而 4102444800 秒之后不会有任何一条内容。
 */
export const TRACKED_MAX_TIMESTAMP_SEC = 4_102_444_800;

/**
 * 时长预设（界面那个下拉框的五档里除了"全部"的四档）。
 *
 * ★★ 为什么这张表住在 shared 而不是写在组件里：
 *    · 它同时喂**两个**地方 —— 下拉框的选项列表，和"选中之后发给服务端的
 *      `durMin` / `durMax`"；写在组件里就是两份会漂的规则（选项改了、映射没改 ⇒
 *      用户选了「1–5 分钟」而服务端收到的是别的区间）；
 *    · `apps/web` **没有测试运行器**（`packages/shared/src/tracking.ts` 的文件头
 *      写着这条惯例）⇒ 写在组件里那条映射**只有人眼能验**；住在这里就能被
 *      `services/api/src/tracking-shared.test.ts` 钉住（包括下面那条"四档恰好
 *      切开 0…∞、两两不重叠"的断言）。
 *
 * ⚠️★ 四档是**闭区间**，所以边界必须写成"上一个的上界 + 1"（秒是整数）：
 *    59 / 299 / 899。写成 60 / 300 / 900 的话，一支**恰好 5 分钟**的视频会同时
 *    落进「1–5 分钟」和「5–15 分钟」两个筛选里 —— 而这种重复没有任何地方会报错，
 *    用户看到的是"这两档都能筛出它"。
 * ⚠️ `maxSec: null` = **没有上界**（不是 0，也不是 `TRACKED_MAX_DURATION_SEC`）：
 *    后者会让"24 小时以上的视频"从这一档里消失，而那一档承诺的是"15 分钟以上"。
 */
export const TRACKED_DURATION_PRESETS = [
  { id: 'lt1', minSec: 0, maxSec: 59 },
  { id: '1to5', minSec: 60, maxSec: 299 },
  { id: '5to15', minSec: 300, maxSec: 899 },
  { id: 'gt15', minSec: 900, maxSec: null },
] as const;
export type TrackedDurationPresetId = (typeof TRACKED_DURATION_PRESETS)[number]['id'];

/** 四档预设的 id 列表（界面按它渲染选项，断言按它遍历）。 */
export const TRACKED_DURATION_PRESET_IDS = TRACKED_DURATION_PRESETS.map(
  (preset) => preset.id,
) as readonly TrackedDurationPresetId[];

/**
 * 预设 id → `durMin` / `durMax`。
 *
 * ⚠️ 返回的是**两个可选数字**（不是 `null` 占位）：服务端那两个参数"不传"与
 *    "传一个 0"是两件事 —— 后者会把"不知道多长"的行排除掉，而前者不会。
 * ⚠️ 认不出的 id（地址栏被改坏）⇒ **两个都不传**（= 不限），与 `readTrackedPlatform`
 *    把认不出的分区退化成「全部」是同一条纪律：非法值**不许**变成一次 400，
 *    也不许变成"筛出空的"。
 */
export function trackedDurationRange(id: TrackedDurationPresetId | undefined): {
  durMin?: number;
  durMax?: number;
} {
  const preset = TRACKED_DURATION_PRESETS.find((row) => row.id === id);
  if (!preset) return {};
  return {
    durMin: preset.minSec,
    ...(preset.maxSec === null ? {} : { durMax: preset.maxSec }),
  };
}

/**
 * 时间范围预设（界面那个下拉框除"全部"之外的三档）。
 *
 * ⚠️ 天数是**日历天**（86400 秒），不是"本地日界"：用本地日的 00:00 会让同一条
 *    地址在不同时区、同一天的不同时刻筛出不同的集合，而"最近 7 天"这句话
 *    本来就没有时区语义。
 */
export const TRACKED_TIME_RANGES = [
  { id: '7d', days: 7 },
  { id: '30d', days: 30 },
  { id: '1y', days: 365 },
] as const;
export type TrackedTimeRangeId = (typeof TRACKED_TIME_RANGES)[number]['id'];

/** 三档时间范围的 id 列表（界面按它渲染选项，断言按它遍历）。 */
export const TRACKED_TIME_RANGE_IDS = TRACKED_TIME_RANGES.map(
  (row) => row.id,
) as readonly TrackedTimeRangeId[];

/**
 * 预设 id + "现在" → `since`（Unix 秒）。
 *
 * ⚠️ `nowSec` 由调用方给（这一层不看时钟）：本仓同一条纪律的另一个例子是
 *    `tracked-videos.ts` 的文件头第六节（数据层不接受自己读的 `Date.now()`）——
 *    自己读时钟的函数**在测试里不可控**，而"最近 7 天"这种断言只能写成"大概差不多"，
 *    那种断言不会红。
 * ⚠️ 认不出的 id ⇒ `undefined`（不传 `since` = 不限时间），理由同上。
 */
export function trackedSinceSec(
  id: TrackedTimeRangeId | undefined,
  nowSec: number,
): number | undefined {
  const row = TRACKED_TIME_RANGES.find((range) => range.id === id);
  if (!row) return undefined;
  return nowSec - row.days * 86400;
}

/**
 * 公开列表（`GET /api/tracking/videos`）的查询参数 —— **前后端共用同一份**。
 *
 * ---------------------------------------------------------------------------
 * ⚠️★ 为什么它在 shared 而不是留在 `routes/tracking.ts` 里（T7 落地时搬过来的）
 * ---------------------------------------------------------------------------
 * T5 把它写在路由文件里，并在那里留了一句话：「schema 留在路由层（不放进
 * `shared/tracking.ts`）：`z.coerce` 处理的是"查询串里一切都是字符串"这件事，
 * 那是 HTTP 的性质，不是数据的性质」，还补了一句「T7 落地时如果两处真的一样，
 * 这里该跟着搬」。
 *
 * ⇒ T7 落地时**确实一样了**：界面这一侧（`apps/web/src/lib/api.ts` 的
 *   `fetchTrackedVideos`）要按**同一套规则**拼 `?page=&pageSize=`，而它同时需要
 *   那两个数字（下界 1、上界 100、默认 24）来算总页数。留两处的话，改一处就等于
 *   让界面与服务端**各说各的**，而症状是最难查的那种：翻到第 5 页拿到 400
 *   （或更糟 —— 静默回落到第 1 页，看起来像"翻页按钮坏了"）。
 *   本仓对这件事的先例就是 `resources.ts` 的 `ResourceQuerySchema`：它住在 shared、
 *   路由 import 它、前端 import 它的类型与两个常量（`DEFAULT_PAGE_SIZE`）。
 *   ⚠️ 代价（照实写）：`z.coerce` 的"HTTP 性质"现在跟着 schema 一起住进了 shared ——
 *   于是这个文件里混进了一条**只对 HTTP 有意义**的规则。接受它的理由是上面那条：
 *   一份会漂移的规则比一次分层上的不纯更贵。
 *
 * ⚠️ 参数名是 `page` / `pageSize`，**不是** `limit` / `offset`：数据层那两个参数是
 *    SQL 的形状，而这里是 HTTP 的形状。本仓的公开列表（资源库、视频墙）一律是
 *    page/pageSize，界面共用一套分页控件 —— 换一套名字等于让前端写第二条分支。
 */
export const TrackedVideoQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
    /**
     * 分区（spec §5.1）。⚠️ **封闭枚举**（取值就是 `TRACK_PLATFORMS`）：`?platform=` 空串
     * **不是**它的取值 —— 公开列表那条路由把校验失败一律翻成 400 `invalid_query`
     * （`routes/tracking.ts`），与上面那面墙同一条纪律（spec §5.1 那一格逐字写着
     * "封闭枚举，空串不是它的取值"；那边也是同一句 `z.enum(VIDEO_PLATFORMS).optional()`）。
     * ⚠️ 前端的 URL 参数叫 `tplatform`，这里叫 `platform`：HTTP 这一层只有这一栏，
     * 而 URL 那一层一个页面上有两面墙（spec §8.2）。
     */
    platform: z.enum(TRACK_PLATFORMS).optional(),

    // -------------------------------------------------------------------------
    // 第 9 条（2026-09-19）：筛选 / 排序 —— 六个新参数
    // -------------------------------------------------------------------------
    /*
     * ⚠️★ 为什么这六个**必须**逐个进这张 schema（而不是"传了没人认识就算了"）：
     *    实测（2026-09-19，生产）：**未知查询参数被静默忽略** ——
     *    `?sort=views` 与不带 `sort` 的顺序**逐条相同**、`?tag=ranked` 与不带参数
     *    **逐字节相同**，而同一个端点上 `?platform=foo` 会 400。
     *    ⇒ 少写一个参数**不会报错、只会什么都不做**：界面看起来"点了没反应"，
     *      而日志里一行异常都没有。每一个新参数都必须在这里，并且有一条
     *      "非法值 ⇒ 400"的用例（`tracking-routes.test.ts` 的筛选那一组）。
     * ⚠️ 值是**字符串**（HTTP 查询串里一切都是字符串）⇒ 数字一律 `z.coerce`。
     *    `z.coerce.number()` 对空串给 `0`（`Number('') === 0`）：对 `durMin` 那是
     *    **合法值**（下界就是 0），对 `page` 由 `min(1)` 拦下 —— 与既有行为一致。
     */
    /** 排序。`new` = 今天的行为（`published_at DESC`）；`views` = 播放量倒序。 */
    sort: z.enum(TRACKED_SORTS).default('new'),
    /**
     * 只看这一位博主。
     * ⚠️ `min(1)`：`?creatorId=`（空串）**不是**"全部" —— 那是 400。
     *    "全部"在这一层只有一个表达方式：**不传这个参数**（与 `platform` 同一条纪律）。
     *    代价与收益写在 `routes/tracking.ts` 那一处：前端拼错一个变量名时，
     *    用户看到的是"筛选没生效"，而不是一个悄悄收窄了的列表。
     */
    creatorId: z.string().trim().min(1).max(64).optional(),
    /** 标签（`TRACKED_VIDEO_TAGS`，`deriveTags` 派生出来的那三个）。⚠️ 同样是封闭枚举。 */
    tag: z.enum(TRACKED_VIDEO_TAGS).optional(),
    /**
     * 时长范围（**秒**，闭区间，各自可选）。
     *
     * ★★ `duration_sec` 为 `NULL` 的行**只在两个都不给时**才出现：给了范围就没法
     *    说一条"不知道多长"的视频符合它。⚠️ 这里**不许**把 `NULL` 当成 0 ——
     *    那正是本仓那条"绝不为缺失值填 0"的纪律在 SQL 里的样子（0 秒会落进"<1 分钟"，
     *    而那些行的时长只是**不知道**）。
     */
    durMin: z.coerce.number().int().min(0).max(TRACKED_MAX_DURATION_SEC).optional(),
    durMax: z.coerce.number().int().min(0).max(TRACKED_MAX_DURATION_SEC).optional(),
    /**
     * 发布时间范围（**Unix 秒**，闭区间，各自可选）。
     *
     * ⚠️★ 上界不是装饰：这两个数是**秒**，而写错单位的典型症状就是把毫秒填进来
     *    （1.7e12）。没有上界时它会变成"一条都查不到"—— 一个**看起来像没有内容**的
     *    空列表；有了它，那是一次 400（`TRACKED_MAX_TIMESTAMP_SEC` 的注释写着这条）。
     */
    since: z.coerce.number().int().min(0).max(TRACKED_MAX_TIMESTAMP_SEC).optional(),
    until: z.coerce.number().int().min(0).max(TRACKED_MAX_TIMESTAMP_SEC).optional(),
  })
  /*
   * ★ 两个"区间反了"的判据（`durMin > durMax` / `since > until`）。
   *
   * ⚠️ 不拦的话结果是**空列表**：一个**语法上完全合法**的请求，返回"没有视频"，
   *    而用户手里那条地址看起来没有任何毛病 —— 他会以为这一栏真的没有内容
   *    （与"隐藏了行"看起来一样）。空列表永远不会有人来查。
   * ⚠️ 代价写清楚：这一层因此多了一条**跨字段**规则，将来界面要做自定义区间
   *    （不是那几个预设）时，两个输入框的顺序会变成一次 400。那时该改的是
   *    界面（把两个值排好序再发），不是把这条判据删掉 —— 删掉之后那个空列表
   *    又回来了。
   */
  .refine((v) => v.durMin === undefined || v.durMax === undefined || v.durMin <= v.durMax, {
    message: 'durMin 不能大于 durMax（反过来的区间是空的，不是"没有符合条件的视频"）',
    path: ['durMax'],
  })
  .refine((v) => v.since === undefined || v.until === undefined || v.since <= v.until, {
    message: 'since 不能大于 until（反过来的区间是空的）',
    path: ['until'],
  });
export type TrackedVideoQuery = z.infer<typeof TrackedVideoQuerySchema>;

/**
 * 拼查询串的那**唯一**一处（界面那一侧的入口）。
 *
 * ===========================================================================
 * ★★ 为什么它必须是**一个函数**，而不是在 `lib/api.ts` 里手写一串 `params.set`
 * ===========================================================================
 * 第 9 条给这个端点加了**六个**筛选/排序参数。手写的话，漏掉一个的表现是具体的、
 * 而且**不报错**：两个不同的筛选拼出**同一个 URL** ⇒ 浏览器/中间层按 URL 缓存时
 * 它们互相串数据（`Cache-Control: public, max-age=60`），用户看到的是"我明明选了
 * 播放量倒序，出来还是刚才那批"，而他会以为"只是刷新慢"。
 * ⇒ 住在这里之后，"每个筛选字段都真的进了查询串"可以由
 *   `services/api/src/tracking-shared.test.ts` 直接断言（`apps/web` 没有测试运行器）。
 *
 * ⚠️ 与 `TrackedVideoQuerySchema` 是**一对**：那边是"服务端认识哪些参数"，
 *    这里是"界面会发出哪些参数"。两边漂移的两个方向都很难看 ——
 *    · 这里多写一个（比如手滑写成 `sortby`）⇒ 服务端**静默忽略**，筛选看着生效、其实没有；
 *    · 这里少写一个 ⇒ 上一条缓存串数据的症状。
 *    有一条断言把两个方向都钉住（同一份键集合），见那个测试文件。
 *
 * ⚠️ 与默认值相同的参数**不拼**（`page=1`、`sort=new`）：分享出去的地址里不留
 *    "和默认一样"的参数 —— 这是本仓既有约定（`fetchVideos` / `buildResourceQuery`）。
 *    ⚠️ 代价：`page` 与 `sort` 的默认值因此**同时**出现在这里和 schema 里（两处）。
 *    接受它，因为"不拼默认值"这条约定本身值这个价；两边不一致的后果是
 *    "服务端认为的默认顺序"与"界面以为的默认顺序"不同，而那条有断言兜着
 *    （测试里同时断言 `page=1` 不出现、`page=2` 出现）。
 *
 * 返回 `''` 或 `?a=1&b=2`（**带问号**）：调用方直接把它接在路径后面
 * （`/api/tracking/videos${buildTrackedVideoQuery(…)}`），与 `buildResourceQuery` 同形。
 */
export interface TrackedVideoQueryInput {
  page: number;
  pageSize: number;
  /** `undefined` = 全部分区。⚠️ **绝不许**传空串（服务端那一头是 400）。 */
  platform?: TrackPlatform;
  /** `undefined` = 全部博主。空串同样是 400。 */
  creatorId?: string;
  /** `undefined` = 全部标签。 */
  tag?: TrackedVideoTag;
  /** 时长范围（秒）。`undefined` = 不限（此时"不知道多长"的行照常出现）。 */
  durMin?: number;
  durMax?: number;
  /** 发布时间范围（Unix 秒）。`undefined` = 不限。 */
  since?: number;
  until?: number;
  /** `undefined` 与 `'new'` 同义（都不拼）—— `'new'` 是服务端的默认值。 */
  sort?: TrackedSort;
}

export function buildTrackedVideoQuery(input: TrackedVideoQueryInput): string {
  const params = new URLSearchParams();
  // 第 1 页不拼 `page`（同上："和默认值一样"的参数不进地址栏）
  if (input.page > 1) params.set('page', String(input.page));
  params.set('pageSize', String(input.pageSize));
  if (input.platform !== undefined) params.set('platform', input.platform);
  if (input.creatorId !== undefined) params.set('creatorId', input.creatorId);
  if (input.tag !== undefined) params.set('tag', input.tag);
  if (input.durMin !== undefined) params.set('durMin', String(input.durMin));
  if (input.durMax !== undefined) params.set('durMax', String(input.durMax));
  if (input.since !== undefined) params.set('since', String(input.since));
  if (input.until !== undefined) params.set('until', String(input.until));
  if (input.sort !== undefined && input.sort !== 'new') params.set('sort', input.sort);
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

/**
 * 公开名册上的一位博主（**下拉框**那一份）。
 *
 * ★★ 为什么它**不是** `TrackedCreator`（那个形状里带着一整排采集状态）：
 *    `GET /api/tracking/creators` 需要 `live.manage`（线上实测**匿名 401**），
 *    而"筛某一位博主"是**所有人都要用的**功能 —— 于是多了一条**公开只读**的路由，
 *    它只回这五个键。`cooldownUntil` / `lastError` / `enabled` / `addedBy` /
 *    `backfillDone` 那些**一个都不出去**：它们是采集的可观测性，只有编辑需要看，
 *    而一个公开端点上多带一个字段**不会有任何地方报错**（有一条测试逐键钉住它）。
 *
 * ⚠️ 博主名字本来就已经是公开的（追踪栏今天就有按平台分组的小标题、每张卡上也有
 *    平台徽章），所以这条路由**没有泄露新东西** —— 这句话下一个人一定会问，
 *    所以它写在这里，也写在路由那一处。
 *
 * ⚠️★ `videoCount` 的口径：**只数 `status = 'visible'` 的行**。
 *    与 `TrackedCreator.videoCount`（"库里有多少行，含隐藏"）**是两个数**，
 *    别把它们统一掉：那一个是 bilibili "到底判据"的输入（spec §5.1，少算会让回填
 *    永远翻不完），而这一个是"这位博主在公开列表里能看到几条"。
 *    公开端点数**隐藏**的条数等于对外宣布"我们下架过东西"，而那一列在今天
 *    只有核对阶段（`upstream_gone`）与手工改库两个写入者。
 */
export interface TrackedCreatorSummary {
  id: string;
  platform: TrackPlatform;
  /** `tracked_creators.display_name`。⚠️ NOT NULL，但**可以是空串**（界面上要自己处理"没名字"）。 */
  displayName: string;
  /** 可读标识（`@handle` / 昵称）。⚠️ 没填就是空串，不是 `null`。 */
  handle: string;
  /** 公开列表里**可见**的条数（口径见上面那段 ★★）。 */
  videoCount: number;
}

/**
 * 名单上的一位博主（**管理面板**的形状，含采集状态）。
 *
 * ⚠️ 采集状态这几格（`backfillDone` / `lastSyncedAt` / `lastError` / `consecutiveFailures`）
 *    是 spec §6.3 那套可观测性**在界面上的那一半**：bilibili 的 `-412` 是概率性的，
 *    "今天只贴了 10 条"与"今天没有新视频"在**日志里**长得一模一样 ——
 *    所以"上次同步是什么时候 / 上次错在什么"必须能被人看见，这是它存在的全部理由。
 */
export interface TrackedCreator {
  id: string;
  platform: TrackPlatform;
  /** 平台侧的 id（mid / YouTube channelId / Twitch user id）。⚠️ 不是给人看的（那是 `handle`）。 */
  externalId: string;
  /** 可读标识（`@handle` / 昵称），只为显示与排错。⚠️ 没填就是空串（库里 `DEFAULT ''`），不是 `null`。 */
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  /** 全量回填跑完没有。⚠️ 待办就是**从它推导**的，本功能没有队列表（spec §3.2）。 */
  backfillDone: boolean;
  /** 上次同步完成的 Unix 秒。从没同步过 ⇒ `null`（**不是 0**：1970 年看起来像一次真实同步）。 */
  lastSyncedAt: number | null;
  /** 上一轮的失败原文，成功了要清空。`null` = 没出错（不是空串）。 */
  lastError: string | null;
  /** 连续失败次数。⚠️ 平台各自独立失败，这一个数是"要不要放弃这个频道"的判据。 */
  consecutiveFailures: number;
  /**
   * 冷却到什么时候为止（**Unix 秒**）。`null` = **不在冷却中** —— 这也是"没有这个状态"
   * 该有的那个值：写 `0` 的话它与"冷却到 1970 年"分不开，而面板上那一句会变成
   * "冷却中，1970-01-01 之前不再抓"（本仓同一条纪律，见 `lastSyncedAt` 与 `TrackedVideo` 那段 ★★）。
   *
   * ★ 它由 `recordFailure` 在**连续失败满 `COOLDOWN_AFTER_FAILURES`（3）次**时设成
   *   `now + COOLDOWN_SEC`（3600 秒），由 `pickDueCreators` 在它还没过期时**跳过这个博主**，
   *   并由一次成功（`advanceCursor`）清成 `NULL`。
   *   ⚠️ 为什么这件事必须**看得见**（而不是只在库里）：一个正在冷却的博主在名单上
   *   与"只是还没到点"长得一模一样，而界面上那一格（`tracked.cooldown`）是操作者
   *   唯一能看出"它这一小时**故意**没被挑"的地方 —— 不说的话，看起来就是抓取漏了他。
   */
  cooldownUntil: number | null;
  /** 停用的博主不再参与回填与增量（`enabled = 0`），但行与视频都留着。 */
  enabled: boolean;
  /** 他名下已经存了多少条（管理面板那一列）。⚠️ 它是**数出来的**，不是存在 `tracked_creators` 上的。 */
  videoCount: number;
  /**
   * 他名下**被隐藏**的条数（`status = 'hidden'`）。管理面板用它显示 `N（隐藏 M）`。
   * ⚠️ `videoCount` 的语义**不变**（库里有多少条，含隐藏）—— 它是 bilibili 到底判据的输入，
   *    spec §3.2 的 ★★ 写着"少算了会让回填提前收尾"。
   */
  hiddenCount: number;
  createdAt: number;
}

/**
 * 管理面板提交的东西：**一个链接或 @handle**，不是一个 `(platform, id)` 对。
 *
 * ⚠️ 入参只有 `input` 一个必填字段，理由照抄 `VideoInputSchema` 的既有裁决
 *    （`videos.ts` 第 31 行那段）：用户手里就是**一条链接**；逼他把它拆成两个字段
 *    是把我们的内部表示泄漏到界面上，而且**一定会有人把 mid 填进 platform 那一栏**。
 *    平台与 id 由服务端那三个适配器的 `resolveCreator(input)` 解析出来（spec §5.1）。
 * ⚠️ `input` 的上限 300 是给"带一堆查询串的频道链接"留的余量 —— 它不是给人看的字段，
 *    所以不设更小的界（`b23.tv` 短链与 `space.bilibili.com/<mid>?spm_id_from=...` 都在这条路上）。
 * ⚠️ `displayName` 选填：填了就用他填的，没填就用平台给的名字（`nullish` 同时收
 *    `undefined` 与 `null`，"没填"和"清空"在这一层是同一件事）。
 *    上限 80 与 `videos.ts` 的标题上限（200）不是一套口径：那一栏是内容，这一栏是标识。
 *
 * ⚠️ 这里**没有** `.strict()`（`liveShares.ts` 的两个 body schema 有）—— 形状按计划逐字。
 *    代价写清楚：多传的键会被 zod **静默丢掉**，而不是当场 400。
 *    要收紧的话是任务 5 那条路由自己的决定，改的是这里一处（所有调用方都过它）。
 */
export const TrackedCreatorInputSchema = z.object({
  input: z.string().trim().min(1).max(300),
  /*
   * ⚠️ 纯空白（`'   '`）**通过**校验：`.trim()` 先把它变成 `''`，而 `max(80)` 对空串是通的。
   *    ⇒ 任务 5 那条路由必须把 `''` 当成"没填"（回落到平台给的名字），否则管理面板上
   *      会出现一行空白的显示名。这里只记代价、不收紧，因为形状是计划逐字钉的。
   */
  displayName: z.string().trim().max(80).nullish(),
});
export type TrackedCreatorInput = z.infer<typeof TrackedCreatorInputSchema>;
