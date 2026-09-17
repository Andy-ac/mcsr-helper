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
 *   · **在请求路径里做**，不新开定时任务（见下面"运行位置"）。
 *
 * ===========================================================================
 * ★★ 运行位置，以及它**诚实的边界**
 * ===========================================================================
 * 收录由 `GET /api/ranked/live` 这一次请求驱动（`routes/ranked.ts`）：
 *   · 上游那一次抓取是有缓存的（30 秒，`live-feed.ts`），所以
 *     **最多每 30 秒只有一个入库窗口**，与访客数无关；
 *   · 只有**真的从上游取回来**的那一次才入库（`fromUpstream`）—— 缓存命中/搭车不入库。
 *
 * ⚠️⚠️ 于是有两件事必须说清楚，否则下一个人会以为它坏了：
 *   1. **没有人请求，就一个频道都不会被收录。** 这不是定时任务，也不是启动任务：
 *      冷启动后第一个请求之前，库里一行都不会多。
 *   2. **今天这个端点还没有调用者**：② 的对局面板仍然由**访客浏览器直连**上游
 *      （spec §3 的 A 方案，2026-09-16 用户裁决），所以"谁去请求"这件事**还没接线**。
 *      接线是独立的一步（要么把面板改成走这个端点，要么让别的请求路径来触发），
 *      而两条路都要**用户重新裁决** —— 它们都会动到 A 方案或某个端点的契约。
 *
 * ===========================================================================
 * ★★ 运维结论：想让它消失，就**隐藏**，别删（这一条是写给下一个人的）
 * ===========================================================================
 * 本模块**只插不改**（`insertLiveChannelIfAbsent`，没有 UPDATE、没有 DELETE），
 * 于是：
 *   · 三列 `(platform='twitch', handle, live_video_id=NULL)` 一旦存在，编辑对那一行的
 *     任何改动（改名 / 改标签 / 改顺序 / **隐藏**）都**永远不会**被收录覆盖 ——
 *     这就是"编辑说它不该在，它就真的不在"的实现方式（隐藏后仍是 hidden）；
 *   · ⛔ **但删掉那一行等于把这一组三列腾空**：删完的下一个 30 秒窗口里，
 *     只要那个选手还在直播，它就会被**原样再加回来**（新 id、新时间、`status='visible'`）。
 *     ⇒ 编辑想让它从公开列表消失，正确的动作是**隐藏**，不是删除。
 *     这一条不是猜测：`ranked.test.ts` 里两条用例分别钉住了"隐藏之后它还是隐藏的"
 *     与"删掉之后它又回来了"。
 *
 * ===========================================================================
 * ⚠️ 不加审计：这里**没有"谁"**
 * ===========================================================================
 * 本仓的 `audit_log` 记的是"谁在什么时候改了**别人能看到的东西**"（见 `routes/` 那些写接口）。
 * 这条路上的行为者是一台定时器都没有的**请求**，硬塞一个 actor id 进去就等于
 * 在审计里写一个假的人。⇒ 来源由行上的 `ranked` 标签回答，审计不插一行。
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
 * 把一份**刚取回来的** `/live` 载荷里的 twitch 频道收录进库。
 *
 * ★★ 这个函数**不会抛**（除了 `Promise` 本身，它连 reject 都不会）。
 *    判据是那句用户级要求：**一次 GET 绝不许因为这次写库而失败**。
 *    所以要吞掉的至少有三类：
 *      · 数据库报错（表被改坏了、磁盘满、触发器拦住…）；
 *      · 载荷里有我们没料到的形状（分类器或上游改了口径）；
 *      · 将来有人在 `insertLiveChannelIfAbsent` 里加一条会抛的约束。
 *    吞法就是本仓的日志风格：`console.error` 一行、带前缀，**不静默**。
 *    ⚠️ 日志前缀是 `[ranked-live]` 而**不是** `[ranked]`：`ranked.test.ts` 里
 *      "一次上游故障有且只有一行日志"那些断言按 `[ranked]` 过滤，
 *      用同一个前缀会让心跳的断言被这里的行数搅红（那是两个子系统的两件事）。
 *
 * @param now 审计意义上的"这一刻"，由调用方取一次（路由里就是 `Date.now()`）。
 * @returns 真的插进去了几行（0 也是正常结果：都收录过了）。
 */
export async function ingestRankedLiveChannels(data: RankedLiveData, now: number): Promise<number> {
  try {
    let inserted = 0;
    for (const channel of rankedTwitchChannels(data)) {
      if (insertLiveChannelIfAbsent(channel, now)) inserted += 1;
    }
    return inserted;
  } catch (error) {
    /*
     * ⚠️ 只记一句"谁"与"为什么"，**不**把整份载荷打出来：那里面是几十个选手的
     *    直播地址，日志会被它淹掉，而排查这条故障需要的只是"写库失败了、失败在哪"。
     * ⚠️ 这里不做 `cause.code` 那一层展开（`heartbeat.ts` 需要它是因为 undici 把
     *    真正的原因藏在那里）：本层的错误来自 `node:sqlite` 与约束，`message` 就是答案。
     */
    console.error(
      `[ranked-live] 自动收录失败（直播列表不受影响）：${
        error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      }`,
    );
    return 0;
  }
}
