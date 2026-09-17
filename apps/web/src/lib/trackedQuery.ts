/**
 * 「追踪的博主」那一栏的分区参数（`?tplatform=`）：**两个纯函数**，读写都只有这一份。
 *
 * ===========================================================================
 * 为什么这一层存在：那条接线是这一轮**唯一一个没有任何门禁看得见**的契约
 * ===========================================================================
 * `/videos` 一个页面上有**两**面墙（用户贴的用 `?platform=&page=`，追踪的用
 * `?tpage=&tplatform=`），而"换分区要删 `tpage`、**不许碰** `platform` / `page`"
 * 这条契约（spec §8.2）原本写在 `routes/Videos.tsx` 的 `setTrackedPlatform` 里 ——
 * 那个位置**静态渲染永远够不到**：`renderToStaticMarkup` 不跑 effect、不点击、
 * 处理器一个都不执行（`apps/web/scripts/videorender.tsx` 末尾那段"覆盖边界"
 * 逐条列了这件事）。
 *
 * ⇒ 把它拆成"吃一个值、吐一个值"的纯函数之后，它就是**可以直接断言**的东西了：
 *   本仓**没有 web 测试跑器**（渲染脚本就是 web 代码的断言入口），所以这几条断言
 *   住在 `videorender.tsx` 的 ⑯ 里。抽出来的同时，`Videos.tsx` 一个字的口径都没变
 *   （读的仍是同一个参数名、删的仍是同一个 `tpage`）。
 *
 * ⚠️★ 这里**绝对不许**碰 `platform` / `page`：那两个是上面那面墙的状态，
 *    顺手删掉的表现是"在追踪那一栏点一下 B站，上面那面墙的筛选和页码一起没了" ——
 *    而这件事**只有在两栏都用过时才看得见**（spec §8.2 就是为它写的）。
 *
 * ===========================================================================
 * 第 8、9 条（2026-09-19）加的三样，**全部沿用上面那一条纪律**
 * ===========================================================================
 *   · `vtab`：顶部两个栏目（「自己贴的视频」/「追踪的博主」）的切换器；
 *   · 五个筛选参数（`tsort` / `ttag` / `tdur` / `ttime` / `tcreator`）；
 *   · 一个"清空这一栏的筛选"（连分区一起清）。
 * 三者都只碰**这一栏**的键：墙上那面墙（`platform` / `authorId` / `page` / `view`）
 * 一个字节都不许动 —— 理由与 `tplatform` 那次完全相同，只是这次的键更多了。
 */
import {
  TRACK_PLATFORMS,
  TRACKED_DURATION_PRESET_IDS,
  TRACKED_TIME_RANGE_IDS,
  TRACKED_VIDEO_TAGS,
  type TrackedDurationPresetId,
  type TrackedSort,
  type TrackedTimeRangeId,
  type TrackedVideoTag,
  type TrackPlatform,
} from '@mcsr/shared/tracking';

/** 这一栏的分区参数名。⚠️ 带 `t` 前缀：`platform` 已经被上面那面墙占了（spec §8.2）。 */
export const TRACKED_PLATFORM_PARAM = 'tplatform';

/** 这一栏的页码参数名。换分区时要把它删掉（= 回到第 1 页）。 */
export const TRACKED_PAGE_PARAM = 'tpage';

/**
 * 顶部栏目（第 8 条）参数名。
 *
 * ⚠️★ 名字里的 `v` 不是装饰：`?tab=` 这种通用名很容易被别的页面或将来某个组件
 *    顺手拿去用，而两个页面共用一个参数名时，跳转过去会**带着上一个页面的值**
 *    （表现是"点进视频页直接落在追踪那一栏，而我从来没点过它"）。
 *    ⚠️ 与既有的六个参数（`platform` / `authorId` / `page` / `view` / `tpage` /
 *    `tplatform`）逐一对过：没有重名。
 * ⚠️ 它**不进** `TRACKED_*` 那一族的理由：它管的不是这一栏的筛选，而是
 *    "这一页显示哪一栏" —— 换栏目时两栏各自的状态都**原样留着**
 *    （从追踪切回墙上，之前翻到第 3 页仍然是第 3 页）。
 */
export const VIDEOS_TAB_PARAM = 'vtab';

/** 两个栏目的取值。⚠️ 缺参数 / 认不出的值 ⇒ `wall`（今天的行为：页面打开就是那面墙）。 */
export const VIDEOS_TAB_WALL = 'wall';
export const VIDEOS_TAB_TRACKED = 'tracked';
export type VideosTab = typeof VIDEOS_TAB_WALL | typeof VIDEOS_TAB_TRACKED;

/** 这一栏五个筛选参数的名字（读、写、清空三处都从这一份表取）。 */
export const TRACKED_SORT_PARAM = 'tsort';
export const TRACKED_TAG_PARAM = 'ttag';
export const TRACKED_DURATION_PARAM = 'tdur';
export const TRACKED_TIME_PARAM = 'ttime';
export const TRACKED_CREATOR_PARAM = 'tcreator';

/**
 * 这一栏的筛选状态，**全部来自地址栏**（页面渲染时读一次，写回时也只写这几个键）。
 *
 * ⚠️ `sort` **必须**有值（默认 `'new'`）：它是排序，不是筛选 —— 排序永远有一个当前值，
 *    而"没选"不是一个合法的排序。另外四个是 `undefined` = 不限。
 * ⚠️★ `sort` **不算筛选**：它不改变结果集，所以它**不许**参与"这个筛选下没有视频"
 *    那句话的判据，也不许让"清除筛选"那颗按钮出现（见 `hasTrackedFilters`）。
 *    把它算进去的表现是：用户只是把列表按播放量重排了一下，空列表就说
 *    "这个筛选下没有视频" —— 一句让人去找一个不存在的筛选的话。
 */
export interface TrackedFilterState {
  sort: TrackedSort;
  tag?: TrackedVideoTag;
  duration?: TrackedDurationPresetId;
  time?: TrackedTimeRangeId;
  creatorId?: string;
}

/** 五个筛选参数的键（`clearTrackedFilters` 与写回那一处共用这一份）。 */
export type TrackedFilterParam =
  | typeof TRACKED_SORT_PARAM
  | typeof TRACKED_TAG_PARAM
  | typeof TRACKED_DURATION_PARAM
  | typeof TRACKED_TIME_PARAM
  | typeof TRACKED_CREATOR_PARAM;

/**
 * 读参数需要的**最小**形状（`URLSearchParams.get` 那一格）。
 * ⚠️ 收窄成这一格而不是直接要 `URLSearchParams`：断言与调用都只需要它，
 *    而 `Map` / 一个对象字面量也能满足（自检里就是这么喂的）。
 */
export interface ReadableParams {
  get: (name: string) => string | null;
}

/**
 * 地址栏里的 `tplatform` → 分区（**先校验再用**）。
 *
 * - 缺参数 / 空串 / 认不出的值（手打 `?tplatform=foo`）⇒ 一律回 `undefined`（= 「全部」）。
 *   ⚠️★ **不许**把认不出的值原样发给服务端：那一头是**封闭枚举**
 *   （spec §5.1：`?platform=foo` ⇒ 400 `invalid_query`），于是"地址被改坏了"会变成
 *   一整块错误界面，而正确的行为是**退化成"全部"**（那面墙的注释里写着同一条）。
 * - 判据是 `TRACK_PLATFORMS`（与 `packages/shared` 那份唯一的平台清单对齐）：
 *   在这里手抄三个平台名就是第二份口径。
 */
export function readTrackedPlatform(params: ReadableParams): TrackPlatform | undefined {
  const raw = params.get(TRACKED_PLATFORM_PARAM);
  return (TRACK_PLATFORMS as readonly string[]).includes(raw ?? '')
    ? (raw as TrackPlatform)
    : undefined;
}

/**
 * 地址栏里的 `vtab` → 栏目。
 *
 * ⚠️ 与 `readTrackedPlatform` 同一条纪律：认不出的值（`?vtab=foo`、空串、手打错）
 *    一律**退化成 `wall`** —— 不 400、也不变成"两块都不显示"。
 *    ⚠️ "两块都不显示"这种坏法很值得点名：`vtab` 只认两个值，实现时写成
 *    `raw === 'tracked' ? 'tracked' : raw` 之类的话，一个错值就会渲染出**空页面**
 *    （而顶部那两个按钮也都不亮）—— 用户没有任何办法看出发生了什么。
 */
export function readVideosTab(params: ReadableParams): VideosTab {
  return params.get(VIDEOS_TAB_PARAM) === VIDEOS_TAB_TRACKED ? VIDEOS_TAB_TRACKED : VIDEOS_TAB_WALL;
}

/** 换栏目之后的**下一份**查询串。⚠️ 两个栏目各自的状态**原样留着**（见 `VIDEOS_TAB_PARAM`）。 */
export function nextParamsForVideosTab(prev: URLSearchParams, next: VideosTab): URLSearchParams {
  const params = new URLSearchParams(prev);
  // ⚠️ `wall` 是默认值 ⇒ **删掉**这个参数，不留 `?vtab=wall`（本仓"不把默认值拼进地址"的约定）
  if (next === VIDEOS_TAB_WALL) params.delete(VIDEOS_TAB_PARAM);
  else params.set(VIDEOS_TAB_PARAM, next);
  return params;
}

/**
 * 地址栏里的五个筛选参数 → 状态（**先校验再用**，与 `readTrackedPlatform` 逐条同形）。
 *
 * ⚠️★ 每一个都**只在取值域里**才认：认不出的一律退化成"不限"（`sort` 退化成 `'new'`）。
 *    理由不是洁癖 —— 服务端对非法值一律 **400**（那六个参数都进了 schema 的校验），
 *    把 `?ttag=foo` 原样发给它，用户看到的是"查询参数不合法"，而那句话指不到
 *    "你把地址改坏了"上。这一步因此是**防错误界面**的，不是防脏数据的。
 * ⚠️ `tcreator` 只校验"非空"：博主的取值域在服务端（一张表），客户端拿不到它 ——
 *    一个**不存在但格式合法**的 id 是合法的请求（服务端回空列表，而界面会显示
 *    "这个筛选下没有视频"）。⚠️ 这与"地址里的 id 是别人手打的乱码"是同一件事：
 *    两种都要能打开、都不该 400。
 */
export function readTrackedFilters(params: ReadableParams): TrackedFilterState {
  const rawSort = params.get(TRACKED_SORT_PARAM);
  const rawTag = params.get(TRACKED_TAG_PARAM);
  const rawDuration = params.get(TRACKED_DURATION_PARAM);
  const rawTime = params.get(TRACKED_TIME_PARAM);
  const creatorId = (params.get(TRACKED_CREATOR_PARAM) ?? '').trim();
  return {
    sort: rawSort === 'views' ? 'views' : 'new',
    ...((TRACKED_VIDEO_TAGS as readonly string[]).includes(rawTag ?? '')
      ? { tag: rawTag as TrackedVideoTag }
      : {}),
    ...((TRACKED_DURATION_PRESET_IDS as readonly string[]).includes(rawDuration ?? '')
      ? { duration: rawDuration as TrackedDurationPresetId }
      : {}),
    ...((TRACKED_TIME_RANGE_IDS as readonly string[]).includes(rawTime ?? '')
      ? { time: rawTime as TrackedTimeRangeId }
      : {}),
    ...(creatorId === '' ? {} : { creatorId }),
  };
}

/**
 * 某一档筛选**是不是筛掉了东西**（空态那一句话与"清除筛选"那颗按钮的判据）。
 *
 * ⚠️★ 这是**唯一**一份判据，两处消费者（空态文案、清除按钮）都问它 ——
 *    各写一遍的话，它们的表现是"按钮在，而空态说没有筛选"（或者反过来），
 *    而那种不一致**不会有任何报错**。
 * ⚠️★ `sort` **不算**（它不是筛选：排序不改变结果集）。理由写在
 *    `TrackedFilterState` 上 —— 把它算进去会让"只是换了排序的空列表"
 *    显示一句"这个筛选下没有视频"。
 * ⚠️ 它**不看 `platform`**：分区是另一条线（`tplatform`），它有自己的空态文案
 *    （`tracked.emptyPlatform`）。两个判据分开，因为两句话说的是不同的原因。
 */
export function hasTrackedFilters(filters: TrackedFilterState): boolean {
  return (
    filters.tag !== undefined ||
    filters.duration !== undefined ||
    filters.time !== undefined ||
    filters.creatorId !== undefined
  );
}

/**
 * 改一个筛选之后的**下一份**查询串。
 *
 * - `value === undefined`（选了「全部」/ 排序回到默认）⇒ **删掉**这个键，不是留一个空值：
 *   `?ttag=` / `?tcreator=` 在服务端那一头都是 **400** 的取值（封闭枚举 / `min(1)`）。
 * - 无论改哪一个都**删掉 `tpage`**（= 回到第 1 页）：停在第三页而新条件下只剩一页的话，
 *   用户看到的是一片空白，他会以为"这个筛选没有视频"（与 `nextParamsForTrackedPlatform` 同一条）。
 * - ★ 其余的键**原样带过去**：墙上那面墙的四个键、这一栏的 `tplatform`、以及
 *   顶部的 `vtab` —— 一个都不归这个函数管。
 * ⚠️ 不校验 `key` / `value`：调用方是这一页自己的两个 `<select>`（`lib/trackedQuery.ts`
 *    是纯函数层，不认识"谁是合法值"；取值域在 `readTrackedFilters` 与服务端两处）。
 *    代价写清楚：**写进地址栏的是控件给的值**，控件那一侧的值域就是词条表里的那几个
 *    （`TrackedVideos.tsx` 按同一份 `TRACKED_*` 清单渲染选项）。
 */
export function nextParamsForTrackedFilter(
  prev: URLSearchParams,
  key: TrackedFilterParam,
  value: string | undefined,
): URLSearchParams {
  const params = new URLSearchParams(prev);
  if (value === undefined) params.delete(key);
  else params.set(key, value);
  params.delete(TRACKED_PAGE_PARAM);
  return params;
}

/**
 * 「清除筛选」之后的下一份查询串：这一栏的**六个**键全删（五个筛选 + 分区），
 * **连带 `tpage`**，其余的键一个不动。
 *
 * ⚠️★ 连分区一起清是刻意的：那颗按钮说的是"清除筛选"，而分区就在同一块界面上
 *    （四颗 chip），只清掉五分之四会让用户以为按钮坏了 —— 点了之后列表**还是**不完整。
 * ⚠️ 排序**在清掉的范围里**（回到 `new` = 今天的行为）：它是这一栏的状态，
 *    而"清除筛选"是"回到什么都没选"的那个入口 —— 留着一个 `tsort=views`
 *    会让"清除"之后的列表顺序仍然是反的，而用户看不出来为什么。
 */
export function clearedTrackedFilterParams(prev: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(prev);
  for (const key of [
    TRACKED_PLATFORM_PARAM,
    TRACKED_PAGE_PARAM,
    TRACKED_SORT_PARAM,
    TRACKED_TAG_PARAM,
    TRACKED_DURATION_PARAM,
    TRACKED_TIME_PARAM,
    TRACKED_CREATOR_PARAM,
  ]) {
    params.delete(key);
  }
  return params;
}

/**
 * 换分区之后的**下一份**查询串。
 *
 * - `next === undefined`（点「全部」）⇒ **删掉** `tplatform`，不是留一个空值
 *   （`?tplatform=` 读出来是空串，而空串在服务端那一头是 400 的取值 —— 见上）。
 * - 无论换成哪一个分区都**删掉 `tpage`**：停在第三页而新分区只剩一页的话，
 *   用户看到的是一片空白，他会以为"这个分区没有视频"（与那面墙"换筛选回第一页"同一条）。
 * - ★ 其余的键**原样带过去**：上面那面墙的 `platform` / `page`、以及将来的任何参数，
 *   都不归这一栏管（spec §8.2）。
 */
export function nextParamsForTrackedPlatform(
  prev: URLSearchParams,
  next: TrackPlatform | undefined,
): URLSearchParams {
  const params = new URLSearchParams(prev);
  if (next === undefined) params.delete(TRACKED_PLATFORM_PARAM);
  else params.set(TRACKED_PLATFORM_PARAM, next);
  params.delete(TRACKED_PAGE_PARAM);
  return params;
}
