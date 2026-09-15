/**
 * 从一条 `liveUrl` 里认出「平台 + 标识」。
 *
 * ---------------------------------------------------------------------------
 * ★ 这个文件只回答一个问题，别的都不管
 * ---------------------------------------------------------------------------
 * 它回答的是：「**这条链接指向哪个平台的谁**」。
 * 它**不**回答「能不能嵌 / 嵌哪个地址」—— 那是 `../live` 的 `liveEmbedDecision()` 的事，
 * 而这里**一个嵌入规则都不许重写**：
 *   · Twitch 的播放器**必须**带 `parent`（传错是**静默**拒播，看起来像网络问题）；
 *   · B站直播间要走 `www.bilibili.com` 的**活动播放器**，而不是房间页
 *     （房间页 `x-frame-options: SAMEORIGIN`，嵌进去是一个黑框）。
 * 这两条都是实测出来的结论（见 `live.ts` 文件头），在这里重写一遍就等于制造第二份真相：
 * 下一个人改 `live.ts` 时会以为两个平台都改好了。
 * ⇒ 调用方把它交给 `liveEmbedDecision(channel, location.hostname)` 去拼地址。
 *
 * ---------------------------------------------------------------------------
 * ★★ 判据是**主机名整体相等**，不是"字符串里出现过那个域名"
 * ---------------------------------------------------------------------------
 * 上游的 `liveUrl` 是**第三方数据**（谁都能填一条链接），所以：
 *   · `host === 'twitch.tv'` ✅
 *   · `host.endsWith('twitch.tv')` ❌ —— 它会把 `nottwitch.tv` 判成 Twitch；
 *   · `liveUrl.includes('twitch.tv')` ❌ —— 它会把
 *     `https://evil.example/?x=twitch.tv` 判成 Twitch（测试里有一条探针钉着这两件事）。
 * 认不出的平台（kick 等）返回 `null`：spec §6.3 的处置是"给外链 + 一句说明"，
 * 因为我们**没有**为它们放开 CSP 的 `frame-src`（那是独立的安全决策）。
 */
import type { LiveEmbedChannel } from '../live';

/**
 * 这条链接是哪个平台的谁；认不出就是 `null`。
 *
 * ---------------------------------------------------------------------------
 * ★★ 视频那一格**每个平台都带**（`liveVideoId: null` 就是"这个平台没有视频这一维"）
 * ---------------------------------------------------------------------------
 * 返回类型就是 `live.ts` 的 `LiveEmbedChannel`，那里 `liveVideoId` 是**必填**的
 * （`string | null`）⇒ 没有视频可言的几档（Twitch 频道页、YouTube 频道页、B站直播间）
 * 都要**显式写出这个键**，而不是让它缺省 —— 有视频的那几档带的是抽出来的那个 ID。
 *
 * ⚠️ 为什么写 `null`：这是**这个仓库既有的约定**，不是这里新定的。`live.ts` 的
 *    `parseLiveLink` 面对同一种输入形状时给的就是它 —— Twitch 频道页（`live.ts:256`）、
 *    YouTube 频道页（`:273` / `:277`）、B站直播间（`:294`）四条分支**全都**是
 *    `liveVideoId: null`。也就是说它在这份代码里的含义是
 *    「**这个平台没有视频维度，所以这一格是空的**」，而不是
 *    「我们知道有一个视频 ID，但它是空的」—— 这里要表达的正是前一句。
 *
 * ★ 收益：这个返回值**能原样喂给** `liveEmbedDecision(channel, location.hostname)`
 *   —— 那正是本文件存在的唯一目的（见文件头），而它的参数类型就要这个键。
 *   ⇒ 否决的替代方案：把返回类型收成
 *     `Omit<LiveEmbedChannel, 'liveVideoId'> & { liveVideoId?: string | null }`、
 *     让那几档**不产出这个键**。代价是把"补一格"推给**每一个**调用方 ——
 *     每个调用点都得写 `{ ...chan, liveVideoId: chan.liveVideoId ?? null }`，
 *     而计划里 Task 5 的用法就是**朴素的那一句**
 *     `liveEmbedDecision(rankedLiveChannel(url), location.hostname)`：照那个签名，
 *     这一句**编译不过**（缺必填键），等于把一个类型上已经确定的事
 *     变成"每个调用方都得记得补"。
 *
 * @param liveUrl 上游 `data.<uuid>.liveUrl`（**可以是 `null`**，实测约一半的玩家块没有它）。
 */
export function rankedLiveChannel(liveUrl: string | null): LiveEmbedChannel | null {
  // ① 没有链接（或空串）—— 这是**最常见**的一档，实测 20 个玩家块里 8 个是它。
  if (!liveUrl) return null;

  /*
   * ② 形状不对就不是一条我们能用的链接。
   *    ⚠️ 这里**先解析再判**，不做任何字符串匹配：`not a url` 这种输入必须落到 null，
   *       而不是被某个 `includes` 顺手认成某个平台。
   *    ⚠️ 只认 http(s)：`javascript:` / `data:` 之类既不是我们的链接，
   *       而它们将来会被放进 `src`/`href`（白名单比黑名单可靠，与 `live.ts` 同一条纪律）。
   */
  let url: URL;
  try {
    url = new URL(liveUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  /*
   * ⚠️ `www.` 去掉，但**只去前缀**：`www.youtube.com` 与 `youtube.com` 是同一个站，
   *    而 `m.youtube.com` / `music.youtube.com` 是另外两个主机名（下面单独列）。
   *    用后缀匹配会顺手把 `nottwitch.tv` 放进来（见文件头），所以这里是**相等**比较。
   */
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const seg = (i: number): string | null => url.pathname.split('/').filter(Boolean)[i] ?? null;

  if (host === 'twitch.tv') {
    // 频道页只有一段：`twitch.tv/<用户名>`。`/videos/…` 之类的路径**不是账号名**，
    // 但那是"这条链接指向别的东西"，不是"我们认错了平台"—— 取到的那一段仍然是个标识，
    // 而 `liveEmbedDecision` 自己会挡住无法成形的标识（它只对空/带空格的名字说不）。
    const name = seg(0);
    return name ? { platform: 'twitch', handle: name, liveVideoId: null } : null;
  }

  if (host === 'youtu.be') {
    // 短链：`youtu.be/<视频 ID>` —— 就是"某一场"，所以 handle 是空串（live.ts 的同一约定）
    const id = seg(0);
    return id ? { platform: 'youtube', handle: '', liveVideoId: id } : null;
  }

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    // ① `watch?v=<id>` —— 实测出现的那一种（正在直播的那一场）
    const v = url.searchParams.get('v');
    if (v) return { platform: 'youtube', handle: '', liveVideoId: v };
    // ② `youtube.com/live/<id>`、`youtube.com/embed/<id>`
    const pathId = /^\/(?:live|embed)\/([^/?#]+)/.exec(url.pathname)?.[1] ?? null;
    if (pathId) return { platform: 'youtube', handle: '', liveVideoId: pathId };
    /*
     * ③ 频道页 `youtube.com/channel/UC…` —— 打开频道级嵌入（`embedChannel: true`）。
     *    ⚠️ 我们只**标出**"这是一个频道页 + 这个开关开着"，能不能嵌仍然由
     *       `liveEmbedDecision` 判定（它会自己检查那个标识是不是 `UC…` 开头）。
     *       在这里替它下结论就等于把那一条规则抄了第二份。
     *    ⚠️ 视频那一格是 `null`：这一条链接指向的是**频道**（`handle` 才是承重的那个），
     *       没有"某一场视频"这个维度 —— 与 `live.ts:277` 对同一个 `UC…` 地址的写法一致。
     */
    const channel = /^\/channel\/(UC[\w-]{10,})/.exec(url.pathname)?.[1] ?? null;
    if (channel) {
      return { platform: 'youtube', handle: channel, liveVideoId: null, embedChannel: true };
    }
    /*
     * ④ 剩下的 YouTube 地址（典型是 `youtube.com/@handle` 的频道页）⇒ `null`。
     *    这一栏要的只有两件事：**嵌一个播放器**，或者**给一条外链**。
     *    `@handle` 嵌不了（频道级嵌入只认 UC 频道 ID），而外链那一档**根本不需要我们判平台**
     *    —— 界面直接用上游给的那条 `liveUrl` 就是频道页本身。
     *    ⇒ 认成 "youtube" 只会让界面印一句"这个平台不能内嵌"，
     *      而那句话**说错了对象**：平台允许内嵌，是这一类地址没有可嵌的视频。
     *      （否决的替代方案：返回 `{platform:'youtube', handle:'@handle'}`，
     *      代价就是上面这句错话，以及"平台判定"这件事从此有了两种含义。）
     */
    return null;
  }

  if (host === 'live.bilibili.com') {
    // 直播间号：`live.bilibili.com/<房间号>`。**纯数字**这一条由 `liveEmbedDecision` 把关。
    const room = seg(0);
    return room ? { platform: 'bilibili', handle: room, liveVideoId: null } : null;
  }

  return null;
}
