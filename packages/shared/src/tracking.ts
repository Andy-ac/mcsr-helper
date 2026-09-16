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
  /** 只有管理面板要，公开列表不填。 */
  creatorName?: string;
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
  /** 停用的博主不再参与回填与增量（`enabled = 0`），但行与视频都留着。 */
  enabled: boolean;
  /** 他名下已经存了多少条（管理面板那一列）。⚠️ 它是**数出来的**，不是存在 `tracked_creators` 上的。 */
  videoCount: number;
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
