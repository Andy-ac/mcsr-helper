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
 * 上半段（`FetchedVideo` / `FetchPage` / `CreatorRef` / `PlatformAdapter` /
 * `AdapterCreator`）**逐字**照抄 `docs/video-tracking-spec.md` §5，连它自己的注释都原样留着
 * —— 那是冻结规格，改一个字都要先在 spec 里改。⚠️ 复审时逐字比对就是这一段的判据。
 * ⚠️ `AdapterCreator` 是 **2026-09-16 新加的那一段**（T8 的实现者量到的一处类型谎，
 *    同日由 spec §5 修订采纳）—— 见它自己那段注释。
 *
 * 下半段是 spec §5 **没有**、但这三个模块必须共享的东西：四个错误类型。
 * 它们放在这里而不是某个适配器里，理由是一条很具体的约束：**谁抛、谁抓，不在一个文件里**。
 *   · `NoCredentialsError` —— 注册表（`index.ts`）抛，CLI 抓（`platformStatus()` 那条路）；
 *   · `PlatformHandshakeError` —— bilibili（今天的）与 Twitch（T8 的 app token）抛，
 *     CLI 抓（"本轮放弃这个平台"，spec §5.1）；
 *   · `PlatformUnavailableError` —— 适配器里那些**裸 `fetch`** 抛（连不上/超时），
 *     路由与 CLI 都抓（T5 把两件事分开的那一次评审加的这个类型，理由见它自己那段）；
 *   · `InvalidCreatorInputError` —— 三个适配器的 `resolveCreator` 都抛，
 *     路由（T5）抓（入参解析不出来 ⇒ 400 带机器可读的 reason，spec §6.1 ④）。
 * 四者都要**跨模块按类型判**，所以它们必须住在一个谁都能 import、又不依赖任何平台实现的
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
  /**
   * ★ 平台自己的小东西 —— **2026-09-16 补的**（spec §5 同日修订，落的是 §5.5 那条裁决）。
   *
   * 缺口是具体的：§5.5 裁决了 YouTube 的 **uploads 播放列表 ID** 存进
   * `tracked_creators.platform_meta`，而 `CreatorRef`（上面那一段是 spec §5 逐字）
   * **没有地方装它** ⇒ `resolveCreator`（唯一知道那个 ID 的地方）拿到的值传不进
   * `createCreator` ⇒ 每轮同步都只能重新 `channels.list` 一次 —— 那是**白烧配额**，
   * 而且烧得静悄悄（§5.2 那句"这个 ID 要存下来"说的正是这件事）。
   * ⇒ 加一个**可选**字段，补上这条路：`resolveCreator` 填 → `createCreator` 落库（JSON 文本）
   * → 同步时从 creator 上读回来（`StoredCreator.platformMeta`）。
   * 没有平台小东西的适配器**不填**（bilibili 今天就不填），所以它是可选的：
   * 必填的话，三个适配器里有两个要为了签名好看而传一个 `null`。
   *
   * ⚠️ 它是**适配器之间**的东西，不进对外形状：`TrackedCreator`
   * （管理面板 / 公开列表读的那一份，`packages/shared/src/tracking.ts`）**不带它** ——
   * 平台内部字段不该泄漏到 web 层（`tracked-videos.ts` 的 `StoredCreator` 是它的落点）。
   * ⚠️ 类型是 `Record<string, unknown>` 而不是某个具体形状：那一列是**每个平台各自的**
   * 小东西（§5.5：YouTube 的 uploads id、Twitch 将来可能还有别的），
   * 由各适配器自己定义键名；代价是读出来要用时得自己窄化，而这正是"各平台不一样"的代价。
   */
  platformMeta?: Record<string, unknown> | null;
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
    creator: AdapterCreator,
    cursor: string | null,
    ctx: { storedTotal: number },
  ): Promise<FetchPage>;
}

/**
 * ★ 适配器真正拿到的形状 —— **2026-09-16 补的**（T8 的实现者量到的一个类型谎）：
 * `fetchPage` 原来声明收 `TrackedCreator`，而那是**对外**形状、**没有 `platformMeta`**；
 * 可是 YouTube 的适配器**必须**从 creator 上读 uploads 播放列表 ID（T4 报出来的那个缺口）。
 * ⇒ 运行时那个值是有的（CLI 传的是带它的 `StoredCreator`），**但类型上说不存在**
 * —— 这正是"下次重构时会被删掉"的那种谎。
 * ⇒ 给它一个明确的名字：`AdapterCreator`（内部形状，多一个 `platform_meta`）。
 * ⚠️ 它**不进** `TrackedCreator`（对外形状不带平台内部字段），
 * 而数据层的 `StoredCreator` 结构上天然满足它。
 */
export interface AdapterCreator extends TrackedCreator {
  platformMeta: Record<string, unknown>;
}

// ===========================================================================
// 二、spec §5 之外的补充（T3 裁决；`PlatformUnavailableError` 是 T5 复审补的）—— 四个错误类型
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
 * 我们**根本联系不上上游**：请求没发出去（DNS / TCP / TLS 失败），或者超时了。
 *
 * 谁抛：**适配器自己**。凡是没有被 `handshakeStep` 那样的包装兜住、直接 `await fetch`
 * 的地方，都要把"fetch 被拒"翻译成这个类型 —— 今天 bilibili 有两处（列表/取名字那条
 * `requestJson`、b23 短链那条跳转），两处都写在 `bilibili.ts` 里。
 * 谁抓：路由 T5（映射进 502 家族，与握手失败同一个处置）与 CLI T6。
 *
 * ⚠️★ 为什么这是一条**类型**，而不是让路由写一个 `catch` 兜住一切：
 *    · 一个笼统的兜底会把**我们自己的 bug** 也报成"上游今天不行"（拼错的字段、
 *      坏掉的签名构造器抛的普通 Error 都会落进去）—— 那时没人会去看代码，
 *      而这类错**重试永远不会成功**。归属必须由"唯一知道 HTTP 层发生了什么"的那一层判：
 *      适配器说"我发不出去/等不到回答"，路由才敢把它当上游的问题。
 *    · 反过来，"连不上"与"上游回了个坏形状"（`BilibiliRejectedError`）在**处置**上
 *      确实是两件事：前者过一会儿再来，后者要我们改。今天它们在 HTTP 这一层
 *      都是 502（对调用方的动作恰好相同），差别留在类型与日志里。
 *
 * ⚠️ 与 `PlatformHandshakeError` 分开，尽管两者的 HTTP 回答一样：握手失败意味着
 *    "这一轮整个平台都别碰了"（CLI 要停止处理这个平台的**所有** creator，spec §5.1），
 *    而一次普通请求超时只说明**这一次**没打出去。混成一个类型会把一次网络抖动
 *    升级成整轮放弃一个平台。
 *    ⚠️ 推论（也是这个类型**唯一**不会被看到的地方）：握手那两步的失败仍然被
 *       `handshakeStep` 收成 `PlatformHandshakeError`（连不上上游时这一轮整个平台
 *       确实不该继续碰），所以它露面的时机是**不在这两步里的请求** ——
 *       握手**之前**的 b23 短链跳转，与握手**之后**的取名字 / 翻页。
 */
export class PlatformUnavailableError extends Error {
  readonly platform: TrackPlatform;
  /** 卡在哪一步（`/x/space/wbi/arc/search` / `b23` / …），日志里要能直接看出来。 */
  readonly step: string;

  constructor(platform: TrackPlatform, step: string, detail: string, options?: ErrorOptions) {
    super(`${platform}: 联系不上上游（${step}）：${detail}`, options);
    this.name = 'PlatformUnavailableError';
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
