/**
 * ★ 把 ranked 实时信息里的 **twitch 直播链接**自动收录进「直播」频道（2026-09-17 用户要求）。
 *
 * ===========================================================================
 * 用户的原话与四条裁决（这一层就是照它们写的，别自己发挥）
 * ===========================================================================
 * 原话：「从现在开始抓取 ranked 实时信息的 twitch 直播链接，将其自动添加至本应用的
 *        『直播』频道」。随后逐条裁决：
 *   · **只要 twitch** —— 同一份载荷里还有 youtube / bilibili 的链接，那些**不收**；
 *   · **`displayName` 就是频道名（twitch login）**，不是选手的 MCSR 昵称
 *     （所以行里看不到 `edcr` 这种昵称，这**不是** bug）；
 *   · **标签是 `ranked`**，就靠它标记这批行的来源 —— **不新增字段、不打别的标记**
 *     （"这一行是谁加进来的"这个问题的答案就是那个标签）；
 *   · **由 systemd 的 oneshot + 5 分钟 timer 驱动**（`ranked-streams.ts`，见下面"运行位置"）。
 *     ⚠️ 这一条是**改过一次**的：第一版把收录挂在 `GET /api/ranked/live` 这**一个请求**上，
 *     而那个端点**一个调用者都没有**（② 的对局面板是访客浏览器直连上游的，spec §3 的 A 方案）
 *     ⇒ 线上一个频道都不会被收录，而门禁全绿。2026-09-17 用户裁决改成定时作业。
 *
 * ===========================================================================
 * ★★ 运行位置，以及它**诚实的边界**
 * ===========================================================================
 * 收录由 `dist/ranked-streams.js` 这一轮驱动（`deploy/mcsr-helper-ranked-streams.timer`，
 * 每 5 分钟一次）：
 *   · 每一轮**恰好一次** `loadRankedLive()`（一个进程跑完就退）⇒ 每一轮**最多一个入库窗口**；
 *   · 只有**真的从上游取回来**的那一份载荷才入库（`fromUpstream`）—— 缓存命中的那些不入库。
 *
 * ⚠️⚠️ 于是有两件事必须说清楚，否则下一个人会以为它坏了：
 *   1. **作业没跑起来（或它失败着），就一个频道都不会被收录。** 上线之后不必等人请求，
 *      但也**不是**"一启动就收全"：第一个 5 分钟窗口之前，库里一行都不会多。
 *   2. **它只看得见上游愿意告诉我们的那些**：对局里大约一半的选手 `liveUrl` 是 `null`
 *      （spec §2.2 的实测形状）⇒ 名单天然不全，这不是收错了。
 *      面向编辑的完整版（含"下播之后不会自动消失"）在 `docs/pending.md`。
 *
 * ===========================================================================
 * ★★ 运维结论：想让它消失，就**隐藏**，别删（这一条是写给下一个人的）
 * ===========================================================================
 * 本模块**只插不改**（`insertLiveChannelIfAbsent`，没有 UPDATE、没有 DELETE），
 * 于是：
 *   · 三列 `(platform='twitch', handle, live_video_id=NULL)` 一旦存在，编辑对那一行的
 *     任何改动（改名 / 改标签 / 改顺序 / **隐藏**）都**永远不会**被收录覆盖 ——
 *     这就是"编辑说它不该在，它就真的不在"的实现方式（隐藏后仍是 hidden）；
 *   · ⛔ **但删掉那一行等于把这一组三列腾空**：删完的下一轮（≤5 分钟）里，
 *     只要那个选手还在直播，它就会被**原样再加回来**（新 id、新时间、`status='visible'`）。
 *     ⇒ 编辑想让它从公开列表消失，正确的动作是**隐藏**，不是删除。
 *     这一条不是猜测：`ranked.test.ts` 里两条用例分别钉住了"隐藏之后它还是隐藏的"
 *     与"删掉之后它又回来了"。
 *
 * ===========================================================================
 * ⚠️ 不加审计：这里**没有"谁"**
 * ===========================================================================
 * 本仓的 `audit_log` 记的是"谁在什么时候改了**别人能看到的东西**"（见 `routes/` 那些写接口）。
 * 这条路上的行为者是一台由 timer 拉起的**作业**（没有登录用户、没有请求头），
 * 硬塞一个 actor id 进去就等于在审计里写一个假的人。⇒ 来源由行上的 `ranked` 标签回答，
 * 审计不插一行。
 *
 * ===========================================================================
 * ★ 失败**返回**，不在这里打印（调用方是唯一打印的地方）
 * ===========================================================================
 * 第一版这一层会 `console.error` 一行再 `resolve(0)`：那是在**请求路径**下对
 * （一次 GET 绝不许因为写库失败而失败，而日志是我们唯一的痕迹）。
 * 驱动换成 oneshot 之后，"一次尝试"与"一轮"是同一件事，而**一轮恰好一行**才是
 * 运维要的形状（`ranked-streams.ts` 文件头第三节写了那笔账）⇒ 这里把失败**返回**上去：
 * 调用方拿 `error` 打那一行、把退出码设成 1，systemd 于是看得见。
 * ⚠️ **它仍然不会抛**（这条契约没变，`ranked.test.ts` 那条用例也还在钉它）：
 *    写库失败是一个**结果**，不是一个异常 —— 调用方永远拿得到"写了几条、错在哪"。
 */
import { type RankedLiveData, rankedLiveChannel } from '@mcsr/shared/ranked';
import { insertLiveChannelIfAbsent, type LiveChannelInsert } from '../live';

/**
 * 收录进来的行带的那**唯一**一个标签（用户裁决：就靠它标记来源，不新增字段）。
 *
 * ⚠️ 大小写：`live_channels.tags` 是**给人看**的 JSON 数组，编辑手写的是 `Ranked`
 *    这种写法（表单默认值见 `LiveManagePanel`），而用户的裁决写的是小写的 `ranked`。
 *    这里**原样用小写**：它是机器写的标记，不该跟人手的习惯漂 ——
 *    要改这一条就是改这一份数据口径，得连测试一起改。
 */
export const RANKED_INGEST_TAG = 'ranked';

/**
 * ★ 收录行的 `sort_order`：**1000**，排在编辑维护的那些**后面**。
 *
 * 冻结这个数的三条理由：
 *   1. 表单里 `sortOrder` 的**默认值是 100**（`LiveChannelInputSchema`），
 *      而编辑加一行时基本不会去动它 ⇒ 1000 远在其后，公开列表上"人录的在前、
 *      机器收的在后"这个顺序天然成立，不需要任何额外的排序规则；
 *   2. 它仍然在表单允许的区间内（0–9999），所以这是个**约定俗成的带**（1000+ 是机器收的），
 *      而不是一个"人够不到"的魔法数 —— 编辑若想让某个自动收录的频道排到前面，
 *      直接改那一行的 `sortOrder` 即可，而**改完就再也不会被收录覆盖**（只插不改）；
 *   3. 写成常量而不是散在代码里的字面量：下一个人改它时，测试里那条断言会一起红。
 */
export const RANKED_INGEST_SORT_ORDER = 1000;

/**
 * 一份 `/live` 载荷 → **要收录的那些频道**（纯函数：不读时钟、不碰数据库）。
 *
 * ⚠️ 平台判据**只用** `rankedLiveChannel()`（`packages/shared/src/ranked/embed.ts`）——
 *    它是这一栏里唯一一处"从一条 liveUrl 里认出平台 + 标识"的代码，
 *    `parse.ts` 也用它（`livePlatform` 就是它的产物）。在这里再写一遍字符串匹配
 *    就会多出第二份真相：`embed.ts` 改成"主机名整体相等"之后（它刻意**不是**
 *    `includes('twitch.tv')`，那样 `nottwitch.tv` 会被认成 twitch），另一份不会跟着改。
 *
 * ⚠️ 认不出平台的一律丢（`kick` 等）：这一栏的裁决是"**只要 twitch**"。
 * ⚠️ 一份载荷里同一个人可能在两场比赛里各出现一次 ⇒ 按 handle 去重
 *    （`live_video_id` 是 NULL，同一组三列重复插也只是白跑一次 SQL，但没必要）。
 *
 * ⚠️ 收录的判据是**分类器的结论**，所以我们不额外过滤 `twitch.tv/videos` 这种路径
 *    （`embed.ts` 会把它认成 handle = `videos`）：再加一层"什么算 twitch 频道"的判据
 *    就是第二份真相（编辑表单那条路用的是 `parseLiveLink`，它与分类器**本来就不完全一样**，
 *    这是已经记档的现状，不在这一轮的范围里）。真出现了这种行，编辑隐藏它即可。
 */
export function rankedTwitchChannels(data: RankedLiveData): LiveChannelInsert[] {
  const channels: LiveChannelInsert[] = [];
  const seen = new Set<string>();

  for (const match of data.matches) {
    for (const player of match.players) {
      const channel = rankedLiveChannel(player.liveUrl);
      if (channel === null || channel.platform !== 'twitch') continue;
      // twitch 那一支不会给出空串（拿不到第一段路径时它给的是 `null`），
      // 但类型上 `handle` 可以是空串 ⇒ 空标识的行既跳不了也嵌不了，不收。
      if (channel.handle === '') continue;
      if (seen.has(channel.handle)) continue;
      seen.add(channel.handle);

      channels.push({
        platform: 'twitch',
        handle: channel.handle,
        // ★ 用户裁决：显示名**就是**频道名（twitch login），不是选手的 MCSR 昵称
        displayName: channel.handle,
        tags: [RANKED_INGEST_TAG],
        // ★ 裁决：这一列留空 —— 我们收录的是**频道**，不是"这一场"（表的语义见 012 迁移）
        liveVideoId: null,
        // 频道级嵌入是 YouTube 的试验开关（twitch 用不到）；收录的行一律关着
        embedChannel: false,
        sortOrder: RANKED_INGEST_SORT_ORDER,
      });
    }
  }

  return channels;
}

/**
 * 一次收录的读数。
 *
 * ★ 三个字段就是调用方那一行摘要要的东西（`ranked-streams.ts` 的 `formatSummary`），
 *   而且它们**互相印证**：`candidates = inserted + 已在库的条数`
 *   （本仓对"看起来对的计数"有记录，§5.47）。
 */
export interface RankedIngestResult {
  /** 载荷里认出来的 twitch 频道数（**去重后**）。它是"上游这一轮说了多少"的唯一读数。 */
  candidates: number;
  /** 真的插进去了几行（0 是正常结果：都收录过了）。 */
  inserted: number;
  /**
   * 写库失败时的错误原文（成功是 `null`）。
   *
   * ⚠️★ 这一栏是这一版**新加的**，而且是这个函数唯一的行为变化：上一版失败时
   *    `console.error` 一行、`resolve(0)` —— 那在请求路径下是对的（GET 不许失败，
   *    日志是我们唯一的痕迹），但换成 oneshot 之后"日志打过了、退出码还是 0"
   *    等于**这一轮在 systemd 眼里是成功的**，而名单一条都没进去。
   *    ⇒ 失败必须能走到调用方的**退出码**上去，而调用方拿不到它就没法做这件事。
   * ⚠️ **它仍然不会抛**：写库失败是一个**结果**，不是一个异常。
   */
  error: string | null;
}

/**
 * 把一份**刚取回来的** `/live` 载荷里的 twitch 频道收录进库。
 *
 * ★★ 这个函数**不会抛**（除了 `Promise` 本身，它连 reject 都不会），而且**不打印**。
 *    要吞掉的至少有三类：
 *      · 数据库报错（表被改坏了、磁盘满、触发器拦住…）；
 *      · 载荷里有我们没料到的形状（分类器或上游改了口径）；
 *      · 将来有人在 `insertLiveChannelIfAbsent` 里加一条会抛的约束。
 *    ⚠️ 吞掉**不等于静默**：吞进去的东西从 `error` 那一栏原样交还给调用方，
 *      由它打进 journald 并定退出码（不在这里打，理由见文件头最后那一节：
 *      一轮恰好一行，打印的地方只有一处）。
 *    ⚠️ 所以这一层也**没有** `[ranked-live]` 前缀了：那两处日志是请求路径的形状，
 *      今天这一层一个字都不打（真要看它做没做事，看那一行摘要里的三个数）。
 *
 * ⚠️ 循环里第 3 条才炸时，前 2 条**是真的写进去了**（没有事务）：
 *    所以 `inserted` 必须**照实**报，而不是失败就报 0 —— 调用方那一行要说清楚
 *    "已经写进去几条"，否则下一次排查从一个错的事实开始。
 *
 * @param now 审计意义上的"这一刻"，**毫秒**（`live_channels` 那一族的单位，
 *            见 `ranked-streams.ts` 文件头第五节），由调用方取一次。
 * @returns 候选数 / 真的插进去了几行 / 失败原文。
 */
export async function ingestRankedLiveChannels(
  data: RankedLiveData,
  now: number,
): Promise<RankedIngestResult> {
  let candidates = 0;
  let inserted = 0;
  try {
    const channels = rankedTwitchChannels(data);
    candidates = channels.length;
    for (const channel of channels) {
      if (insertLiveChannelIfAbsent(channel, now)) inserted += 1;
    }
    return { candidates, inserted, error: null };
  } catch (error) {
    /*
     * ⚠️ 这里不做 `cause.code` 那一层展开（`heartbeat.ts` 需要它是因为 undici 把
     *    真正的原因藏在那里）：本层的错误来自 `node:sqlite` 与约束，`message` 就是答案。
     * ⚠️ 也**不**把载荷打出来：那里面是几十个选手的直播地址，日志会被它淹掉，
     *    而排查这条故障需要的只是"写库失败了、失败在哪"。
     */
    return {
      candidates,
      inserted,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}
