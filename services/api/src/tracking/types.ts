/**
 * 三个平台适配器共用的**契约**（spec §5）—— 纯类型，一行 I/O 都没有。
 *
 * ===========================================================================
 * 为什么契约为一个文件、而实现各自一个文件
 * ===========================================================================
 * 三个平台的接口**形状相同、行为不同**（spec §5.4：三个平台的"到底了"语义
 * 各不相同，"不许写成一个 if"）。所以这一层只写"每个适配器必须回答什么问题"，
 * 一个平台一份实现，各自独立失败（spec §3.5：一个平台被限流不能影响另外两个）。
 * ⇒ 上层（CLI / 路由）只认这个接口，不认具体平台 —— T6 的 `RunDeps.adapters`
 *    就是个 `(platform) => PlatformAdapter`，T5 的路由也这么注入（两边都为了同一件事：
 *    **测试里不许打真网络**）。
 *
 * ===========================================================================
 * 文件排法：上半段是 spec §5 **逐字**，下半段是本任务补的三样
 * ===========================================================================
 * 上半段（`FetchedVideo` / `FetchPage` / `CreatorRef` / `PlatformAdapter`）**逐字**
 * 照抄 `docs/video-tracking-spec.md` §5，连它自己的注释都原样留着 —— 那是冻结规格，
 * 改一个字都要先在 spec 里改。⚠️ 复审时逐字比对就是这一段的判据。
 *
 * 下半段是 spec §5 **没有**、但这三个模块必须共享的东西：三个错误类型。
 * 它们放在这里而不是某个适配器里，理由是一条很具体的约束：**谁抛、谁抓，不在一个文件里**。
 *   · `NoCredentialsError` —— 注册表（`index.ts`）抛，CLI 抓（`platformStatus()` 那条路）；
 *   · `PlatformHandshakeError` —— bilibili（今天的）与 Twitch（T8 的 app token）抛，
 *     CLI 抓（"本轮放弃这个平台"，spec §5.1）；
 *   · `InvalidCreatorInputError` —— 三个适配器的 `resolveCreator` 都抛，
 *     路由（T5）抓（入参解析不出来 ⇒ 400 带机器可读的 reason，spec §6.1 ④）。
 * 三者都要**跨模块按类型判**，所以它们必须住在一个谁都能 import、又不依赖任何平台实现的
 * 文件里。放 `bilibili.ts` 会让 T5/T8 为了一个错误类型去 import 一个平台适配器
 * （并在 T8 改成"从 index 里拿"时绕回来），放 `index.ts` 会成环
 * （`index` 已经 import 了 `bilibili`）。
 *
 * ⚠️ 被否掉的另一种做法：让调用方**按 message 文本**判断（`error.message.includes('没有凭据')`）。
 *    代价很具体：那是一根挂在中文文案上的线，改一个标点就断，而且**断的时候不会报错** ——
 *    CLI 会把"没凭据"记成一次普通的抓取失败，于是 youtube/twitch 每轮刷 40 条失败记录，
 *    而 spec §9.1 ⑧ 要的"被跳过而不是崩"就悄悄没了。
 */
import type { TrackedCreator, TrackPlatform } from '@mcsr/shared';

// ===========================================================================
// 一、spec §5 **逐字**（到此为止，下面才是补充）
// ===========================================================================

export interface FetchedVideo {
  externalId: string;
  title: string;
  thumbnailUrl: string | null;
  publishedAt: number | null; // Unix 秒
  durationSec: number | null;
  viewCount: number | null;
  commentCount: number | null;
  isLiveReplay: boolean;
}

export interface FetchPage {
  videos: FetchedVideo[];
  nextCursor: string | null; // null = 没有下一页
  /** ⚠️ 见 §5.4：**不许**把"空列表"直接当成到底了 */
  reachedEnd: boolean;
}

export interface CreatorRef {
  platform: TrackPlatform;
  externalId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface PlatformAdapter {
  /** 管理员粘贴的链接/标识 → 规范化成 CreatorRef。解析不出来就抛。 */
  resolveCreator(input: string): Promise<CreatorRef>;
  /**
   * 抓一页。
   *
   * ⚠️ **第三个参数是预检扫描抓出来的一处订正**（2026-09-16）：
   * 本规格原来写的是两参 `fetchPage(creator, cursor)`，但 §5.4 要求 bilibili 的
   * "到底了"判据里含"**我们库里已存条数** >= `page.count`" —— 而适配器**不该知道数据库**。
   * ⇒ 裁决：把 `storedTotal` **由调用方传进来**（调用方本来就要查一次，顺手就有了）。
   * YouTube / Twitch 忽略它（它们的结束语义只看游标）。
   */
  fetchPage(
    creator: TrackedCreator,
    cursor: string | null,
    ctx: { storedTotal: number },
  ): Promise<FetchPage>;
}

// ===========================================================================
// 二、spec §5 之外的补充（T3 裁决）—— 三个错误类型
// ===========================================================================

/**
 * 这个平台**这一轮根本没有凭据可用**，不是"抓取失败"。
 *
 * 谁抛：注册表 `adapterFor(platform)`（`index.ts`）。今天它对 `youtube` / `twitch` 必抛
 * （生产上**一个 key 都没有**，spec §2.7 实测），T8 之后只在真的没配时才抛。
 * 谁抓：CLI 把整个平台报成 `'skipped:no-credentials'` 并打印一行原因（spec §9.1 ⑧），
 * **不是**给每个 creator 记一条失败。
 *
 * ⚠️ 与"抓取失败"分开是 spec §6.3 那份摘要能成立的前提：摘要里平台那一行有
 *    `ok | skipped:no-credentials | failed` 三个值，前两个的区别只有这个类型能回答。
 *    ⇒ bilibili 永远不会抛它（那个平台什么都不需要，spec §2.7），这正是它先跑通整条
 *      流水线的原因。
 */
export class NoCredentialsError extends Error {
  readonly platform: TrackPlatform;
  /** 缺哪些环境变量（照 spec §10 冻结表），好让那行日志直接告诉运维去配什么。 */
  readonly requiredEnv: readonly string[];

  constructor(platform: TrackPlatform, requiredEnv: readonly string[]) {
    super(`${platform}: 没有配置凭据（需要 ${requiredEnv.join(' / ')}），本轮跳过这个平台`);
    this.name = 'NoCredentialsError';
    this.platform = platform;
    this.requiredEnv = requiredEnv;
  }
}

/**
 * 这个平台的**握手**失败了 —— 本轮放弃这个**平台**，不是放弃这一个 creator。
 *
 * 谁抛：`fetchPage` / `resolveCreator` 在第一次需要凭据/指纹时（bilibili 是
 * `finger/spi` 取 buvid、`web-interface/nav` 取 WBI 密钥；Twitch 是 app access token）。
 * 谁抓：CLI。拿到它就**停止处理这个平台的所有 creator**，把平台报成 `'failed'`。
 *
 * ⚠️★ 为什么必须是一个**专用类型**而不是普通 Error（spec §5.1 原话："握手失败要当作
 *    '本轮放弃 bilibili'，**不能带着空 cookie 继续打**（那会白吃一堆 412）"）：
 *    没有它，CLI 只能看见"这个 creator 失败了"，于是接着用同样的空 cookie 去碰下一个 ——
 *    20 个 creator × 4 次请求全打在风控上，结果是**把 IP 的风险分推高**，
 *    而日志里只有 20 行看起来各自独立的失败。代价（认下）：一个平台的握手上游抽风，
 *    这一轮整个平台都不动，等下一个 10 分钟。
 */
export class PlatformHandshakeError extends Error {
  readonly platform: TrackPlatform;
  /** 卡在哪一步（`'finger/spi'` / `'nav'` / …），日志里要能直接看出来。 */
  readonly step: string;

  constructor(platform: TrackPlatform, step: string, detail: string, options?: ErrorOptions) {
    super(`${platform}: 握手失败（${step}）：${detail}`, options);
    this.name = 'PlatformHandshakeError';
    this.platform = platform;
    this.step = step;
  }
}

/**
 * 管理员贴进来的那串东西**解析不出一个博主**。
 *
 * 谁抛：`resolveCreator`（三个平台都是）。
 * 谁抓：路由 T5 —— 它要把这条变成 **400 + 机器可读的 reason**（spec §6.1 ④），
 * 而不是 500。
 *
 * ⚠️ 与"上游抓取失败"分开的理由：这两种失败的**归属**不同。解析不出来是**入参**的问题
 *    （让管理员重新贴一个链接就行），而抓取失败是上游/网络的问题（重试有用）。
 *    混在一起之后，管理面板上"这个链接贴错了"会显示成"bilibili 抓取失败"，
 *    于是没人去改那个链接。
 * ⚠️ 认下的代价：`input` 原文会被拼进 message 里（好让管理员看见自己贴的是什么），
 *    所以这个 message **会进日志**。上限照 `TrackedCreatorInputSchema` 的 300 字符截断，
 *    避免一条 10 KB 的输入把日志刷花。
 */
export class InvalidCreatorInputError extends Error {
  readonly platform: TrackPlatform;
  /** 管理员贴进来的原文（已截断），好让日志和 400 的 reason 都能带上它。 */
  readonly input: string;

  constructor(platform: TrackPlatform, input: string, detail: string) {
    super(`${platform}: 认不出这是哪个博主（${detail}）：${input.slice(0, 300)}`);
    this.name = 'InvalidCreatorInputError';
    this.platform = platform;
    this.input = input;
  }
}
