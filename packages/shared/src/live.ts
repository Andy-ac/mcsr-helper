/**
 * 「直播」板块的契约 —— **服务端和前端共用**。
 *
 * ---------------------------------------------------------------------------
 * 这个板块记的是**频道**，不是某一场直播
 * ---------------------------------------------------------------------------
 * 用户的原话是「基本不用大改，现嵌入的 YouTube 播放器已经可以看直播了，
 * 只需要记录一些重要的 MCSR streamer」。所以：
 *
 *   · 一条记录 = 一个**主播/频道**（名字 + 平台 + 频道标识 + 一句话说明）
 *   · **不是**一场具体的直播。直播每开一次就换一个视频 ID，
 *     记"某一场"意味着每周都要有人来更新，而那是这类页面烂掉的典型方式。
 *
 * ⚠️ 只有 `liveVideoId` 那一个字段是"给现在这场用的"，它**会变** ——
 *    界面上必须说清这一点（见 `LiveChannelInputSchema.liveVideoId` 的注释）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 三个平台的嵌入能力**实测过**，而且结论不一样（D4b.9 / F32d）
 * ---------------------------------------------------------------------------
 * | 平台 | 现在怎么处理 | 依据（2026-09-13，大陆 + 香港两条网络各自测） |
 * |---|---|---|
 * | YouTube | 有 `liveVideoId` 就嵌；开了 `embedChannel` 就按频道嵌 | 两条路都不带 `frame-ancestors` |
 * | Twitch  | **嵌**（`player.twitch.tv/?channel=…&parent=…`） | 实测回 `frame-ancestors https://mcsrhelper.com` ⇒ 可嵌，**但必须带对 `parent`** |
 * | B站直播间 | **只记录、不嵌** | 实测 `x-frame-options: SAMEORIGIN`（平台自己禁止被嵌） |
 *
 * ⚠️ 这个文件头**曾经写着**"Twitch 还没测试，所以只记录不嵌" —— 那句话**已经过期**，
 *    而且它的两个方向都有害：既让 Twitch 永远没有播放器（用户明确要求要嵌），
 *    又把"**本机连不上**"说成"**还没验证**"（换一条网络就测到了）。
 *    ⇒ 所以**没有"未验证"这一档**（词条 `live.noEmbedUntested` 不存在）。
 *
 * ⚠️ **两个词条都在，各说一件事 —— 不要写成"后者取代前者"**（2026-09-13 captain 裁定）：
 *    · `live.noEmbedBilibili` = **B站 那一档**（确定态：平台自己禁止被嵌）；
 *    · `live.noEmbedPlatform` = **通用那一档**（`'no_origin'`：拿不到 `origin` 时
 *      Twitch 拼不出 `parent`）—— 它的**值**已经从"还没验证过"（假话）改成
 *      "这个平台在这里不能嵌入播放"（真话），但**键本身不是多余的**。
 *    ⇒ 删掉后者会让 `'no_origin'` **没有句子可指**，只能指向 B站 那句
 *      = **制造一句新的假话**。详见 `liveEmbedUnavailableReason` 的映射说明。
 *
 * ---------------------------------------------------------------------------
 * ★ 两态：**能嵌** / **确定不可嵌**（没有第三态）
 * ---------------------------------------------------------------------------
 * `liveEmbedDecision()` 是**唯一**的判定入口（`liveEmbedUrl` 是它的薄封装）。
 * 它只回答两件事之一：`{ embed: true, url }` 或 `{ embed: false, reason }`。
 * `reason` 说明**为什么确定嵌不出来** —— 每一档在界面上都有各自的说法，
 * 因为它们对用户意味着不同的下一步（D4b.9 决定 2）：
 *
 *   · `'bilibili_blocked'` —— B站直播间：平台自己禁止被 iframe。
 *     界面上必须**明说**「B 站不允许把直播间嵌进别的网站」+ 外链，
 *     绝不静默黑框、也不写"加载中"（那是在撒谎）。
 *   · `'no_id'`            —— 没有可嵌的东西（没记视频 ID、没开频道嵌入）。
 *   · `'not_channel_id'`   —— 开了频道嵌入，但标识不是 `UC…` 频道 ID：
 *     那个开关**永远不生效**，而用户以为自己开了（最难排查的一类）。
 *   · `'no_origin'`        —— 拿不到嵌入页面的域名（见下：Twitch 依赖它）。
 *
 * ---------------------------------------------------------------------------
 * ★ `origin` 是**必填且承重**的参数（D4b.9 决定 1）
 * ---------------------------------------------------------------------------
 * Twitch 的 `frame-ancestors` 是**按传入的 `parent` 动态生成**的：
 *   · 生产**必须**传 `mcsrhelper.com`、本地 dev **必须**传 `localhost`；
 *   · **传错就拒播，而且是静默的**（播放器区域什么都不显示）——
 *     正是本仓最怕的那类失败（看起来像网络问题）；
 *   · ⇒ 调用方**必须**把页面自己的 host 传进来（浏览器里就是
 *     `globalThis.location.hostname`），且它必须与页面 host 同源；
 *   · ⇒ 缺 `origin` 时**宁可不嵌**（返回 null，界面走外链文案），
 *     也不要发一个注定被拒的请求。这一条在 `'no_origin'` 那一档里变成了**类型**，
 *     而不是一句口头约定。
 *
 * ⚠️ **没有默认采用 YouTube 频道级嵌入**（`/embed/live_stream?channel=<频道ID>`）作为
 *    "零维护"的默认方案：它的失败样子是一个纯黑框，而且频道没在播时它本来就不显示
 *    任何东西。所以它仍然是一个**每行可开的开关**（`embedChannel`，默认关）。
 */
import { z } from 'zod';
import type { LivePlatform } from './constants';

/*
 * 重新导出 `LivePlatform` —— 服务端和前端都要用它，而从 `live.ts` 一处取到
 * 比同时 import `@mcsr/shared` 和 `@mcsr/shared/live` 更不容易写错。
 * （`@mcsr/shared` 的 exports 里没有 "./constants"，所以子路径导入者只能从这里拿。）
 */
export type { LivePlatform };

export const LIVE_NAME_MAX = 80;
export const LIVE_HANDLE_MAX = 120;
export const LIVE_NOTE_MAX = 200;
/**
 * 一个标签最长 24 字，一行最多 12 个（2026-09-13）。
 *
 * ⚠️ 上限是**为了挡住"标签当备注写"**：标签的用处是扫一眼就分类，写成一句话
 *    在卡片上会换行、把别的行挤下去。要写句子请用 `note`（那一栏有 200 字）。
 */
export const LIVE_TAG_MAX = 24;
export const LIVE_TAGS_MAX = 12;

/**
 * 用户**原样粘贴**的那条链接的长度上限（私人列表的 `url`）。
 *
 * ⚠️ 给的是一个"粘贴错误"的兜底，不是平台的限制：真实链接都在 200 字符以内，
 *    而几百字符的输入基本是"复制的时候多选了一大段"。上限放在这里是为了让
 *    400 出现得**早**（而不是存进库里，等界面渲染时才发现那条链接没法用）。
 */
export const LIVE_URL_MAX = 500;

/** 11 位 YouTube 视频 ID 的形状（和 `VIDEO_ID_PATTERNS.youtube` 同一条规则）。 */
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** `UC…` 形式的 YouTube 频道 ID。频道级嵌入只认这一种。 */
const YOUTUBE_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

/**
 * B站直播间号（2026-09-13）。
 *
 * ⚠️ **必须是纯数字**：官方活动播放器的 `cid` 参数就是房间号。B站还有"短号"
 *    （如 `live.bilibili.com/1234` 之外的 `blanc/xxxx`），但那是另一个入口，
 *    这里只认数字 —— 认不出就退回 `no_id`，由界面给外链，而不是拼一个黑框。
 */
const BILIBILI_ROOM_ID = /^\d{1,12}$/;

/** B站 的直播间号 / 空间号：老式的纯数字。 */
const BILIBILI_NUMERIC_ID = /^\d+$/;

/**
 * 合法的**裸标识**（没有平台前缀那一段的那一类输入）。
 *
 * ⚠️ 它是**白名单**，不是"只要不含空白就算"：标识是平台自己的东西，但三个平台
 *    的标识都是 **ASCII 的字母、数字加 `_` / `.` / `-`**（`@handle` 那个 `@`
 *    只允许出现在开头）。所以"一句没有空格的中文"**不是**标识 ——
 *    那是乱码（F29 定稿里 `refine` 要挡的正是它），而放它进来会让
 *    `handle` 里出现一串谁也用不了的东西，界面上却显示得像加成功了。
 */
const BARE_HANDLE = /^@?[A-Za-z0-9._-]+$/;

/**
 * `twitch.tv/<这一段>` 里**不是频道名**的那几个保留段。
 *
 * ⚠️ 没有它的话 `twitch.tv/videos` 会被当成一个叫 "videos" 的频道 ——
 *    名字看起来合理、链接拼出来也能打开，所以这个错误不会被任何人发现。
 */
const TWITCH_RESERVED_SEGMENTS = new Set([
  'videos',
  'directory',
  'downloads',
  'settings',
  'subscriptions',
  'inventory',
  'wallet',
  'drops',
  'p',
]);

/*
 * ⚠️⚠️ 这里原来有一个 `HandleSchema`（「频道标识的形状」），**2026-09-13 删掉了** ——
 *    入参改成只有一栏 `url` 之后它就没人用了（biome 的 noUnusedVariables 直接报出来）。
 *
 * 它留下的两条历史结论**仍然成立、仍然值得知道**，所以留在这里而不是跟着代码消失：
 *
 * ① **`handle` 列里永远是标识**（链接由我们按平台拼出来）——
 *    这条不变量**一个字都没变**，只是 `handle` 现在由 `parseLiveLink` 从
 *    「直播链接」解析出来，而不是由用户填。删字段的时候别把它一起删掉：
 *    Twitch 与 B站 的链接和嵌入全靠它（实测过：清空 handle 会让两个平台同时瞎掉）。
 * ② 它当年刻意**宽松**（不写死正则）：频道标识是平台自己的东西 ——
 *    YouTube 有 `UC…` 老式 ID 与 `@handle` 新式写法，Twitch 是用户名。
 *    写死一个正则会让"这个人加不进来"，而他要做的只是贴对一行字。
 *    ⇒ 同一句话现在适用于 `url` 那一栏：**认不认得出来交给 `parseLiveLink`**，
 *      不要在这里另写一套形状判断。
 *
 * 另外：F29 当年定的是 "(ii) 输入宽松、存储严格"，并**明确否决**过"独立的 url 字段"，
 * 理由是"两个字段表达一件事"。现在入参**只有** `url` 一个字段，
 * 所以那次否决并不矛盾 —— 只是理由换了。详见 `LiveChannelInputSchema` 的注释。
 */

/**
 * 从用户粘贴的东西里解析出「平台 / 频道标识 / 视频 ID」。
 *
 * ★ 这是**唯一**允许的"解析"，而且**纯字符串处理、绝不产生任何网络请求**
 *   （和 `parseVideoUrl` 同一条铁律）。
 *
 * ⛔ **不要改成复用 `parseVideoUrl`**（`constants.ts:284-289`）：它的 twitch 分支
 *    只认 `/videos/<数字>`（那是**录像页**），而这里要的是**频道**页
 *    `twitch.tv/<用户名>` —— 复用它会把合法的 Twitch 直播链接判成"认不出来"。
 *
 * ---------------------------------------------------------------------------
 * 返回值（三种，别混）
 * ---------------------------------------------------------------------------
 *   · `null`                        —— **完全认不出**（既不是能识别的链接、也不是合法的裸标识）。
 *     · 私人列表**允许保存**这样的输入（存原样 `url`、platform/handle 留 NULL，界面只给外链，
 *       不报错）—— 用户贴一条我们不认识的链接**不是错误**；
 *     · 公开名单（编辑维护的名单）则给 **400 `invalid_input`**（沿用既有错误码，不新增）。
 *   · `{ platform: null, handle: '…' }` —— **是裸标识，但判不出平台**（如 `@Someone`）。
 *     它**只**会出现在私人列表那一侧（存裸串、不给播放器）；公开名单那侧不会落到这一档 ——
 *     编辑必须显式选 `platform`，而链接里的平台要与它校验一致。
 *     ⚠️ 所以 `platform: null` 与整个返回值 `null` **不是一回事**。
 *   · `{ platform, handle, liveVideoId }` —— 认出来了。`handle` **一律是归一化后的标识**
 *     （绝不落链接）；`liveVideoId` 只在"这条链接指向某一场视频"时才有值
 *     （例如 YouTube 正在直播的 `watch?v=…` ⇒ 有 ID ⇒ 可嵌），
 *     而那时**没有**频道标识（链接里根本没有它）⇒ `handle` 是空串。
 *
 * ★ 为什么要放在 shared：前端要**逐字反馈**（贴错了当场说）、服务端要**权威重解析**
 *   （前端不是安全边界）—— 两处各写一份必然漂移（同 `VideoForm.tsx` 用
 *   `parseVideoLink` 的模式）。
 */
export function parseLiveLink(
  raw: string,
): { platform: LivePlatform | null; handle: string; liveVideoId: string | null } | null {
  const input = raw.trim();
  if (!input) return null;

  /*
   * ① 带协议的输入。**只认 http(s)** —— `javascript:` / `data:` / `ftp:` 之类
   *    既不是标识也不是我们认识的链接，一律按"认不出"处理（返回 null）。
   *    这里挡的是**存进库里的字符串**：它将来会被放进 `href`，而白名单比黑名单可靠。
   */
  if (/^[a-z][a-z0-9+.-]*:/i.test(input)) {
    if (!/^https?:\/\//i.test(input)) return null;
    try {
      return fromLiveUrl(new URL(input));
    } catch {
      return null;
    }
  }

  /*
   * ② 没写协议但明显是链接（`twitch.tv/Someone`、`youtube.com/@x`、`www.…`）。
   *    很多人从地址栏复制时会把 `https://` 去掉，而那也是"一条频道页链接"。
   */
  if (/^www\./i.test(input) || input.includes('/')) {
    try {
      return fromLiveUrl(new URL(`https://${input}`));
    } catch {
      return null;
    }
  }

  /*
   * ③ 剩下的是裸标识：判不出平台，但仍然是一个合法的标识（`platform: null`）。
   *    ⚠️ 带点号也算标识（`@mk.hd` 是真实的 YouTube handle），所以这里
   *       **不能**看到 `.` 就当域名 —— 那会把合法的标识判成"坏链接"。
   *    ⚠️ 反过来，`BARE_HANDLE` 是白名单：一句中文（例如"不是链接也不是标识"）
   *       没有空格，但它**不是标识** ⇒ 返回 null（认不出）。这一条很重要 ——
   *       否则"乱码"会被当成一个合法的裸标识存进库里。
   */
  return BARE_HANDLE.test(input) ? { platform: null, handle: input, liveVideoId: null } : null;
}

/** 一个 URL → 归一化结果。认不出的主机 / 形状不认识的路径都返回 null。 */
function fromLiveUrl(
  url: URL,
): { platform: LivePlatform; handle: string; liveVideoId: string | null } | null {
  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean).map(decodeSegment);
  const first = segments[0] ?? '';

  if (host === 'twitch.tv' || host === 'm.twitch.tv') {
    // 频道页只有一段（`/Someone`）；`/videos/123` 是录像、`/directory` 是目录
    if (segments.length !== 1) return null;
    if (!first || TWITCH_RESERVED_SEGMENTS.has(first.toLowerCase())) return null;
    return { platform: 'twitch', handle: first, liveVideoId: null };
  }

  if (host === 'youtube.com' || host === 'm.youtube.com') {
    // `youtube.com/@handle`
    if (segments.length === 1 && first.startsWith('@') && first.length > 1) {
      return { platform: 'youtube', handle: first, liveVideoId: null };
    }
    // `youtube.com/channel/UC…`（老的频道 ID）
    if (first === 'channel' && YOUTUBE_CHANNEL_ID.test(segments[1] ?? '')) {
      return { platform: 'youtube', handle: segments[1] ?? '', liveVideoId: null };
    }
    /*
     * `youtube.com/watch?v=…` —— **正在直播的那一场**。
     * ⚠️ 这条链接里**没有频道标识**（视频 ID 换一场就变），所以 `handle` 是空串：
     *    存进去的是一个"可嵌的视频"，而不是一个频道。
     */
    if (first === 'watch') {
      const v = url.searchParams.get('v') ?? '';
      return YOUTUBE_VIDEO_ID.test(v) ? { platform: 'youtube', handle: '', liveVideoId: v } : null;
    }
    return null;
  }

  // B站：直播间号（`live.bilibili.com/12345`）与空间号（`space.bilibili.com/12345`）
  if ((host === 'live.bilibili.com' || host === 'space.bilibili.com') && segments.length === 1) {
    return BILIBILI_NUMERIC_ID.test(first)
      ? { platform: 'bilibili', handle: first, liveVideoId: null }
      : null;
  }

  return null;
}

/** 路径段里可能有 `%40` 这种转义（`@` 很常见），解不开就按原样用。 */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * 编辑维护的公开名单的入参 —— **2026-09-13 起只有一栏链接**。
 *
 * ---------------------------------------------------------------------------
 * ★ 表单从「平台 + 频道标识 + 直播视频 ID」三栏砍成**一栏**，为什么
 * ---------------------------------------------------------------------------
 * 用户原话（对话里来回三轮才定下来）：
 *   「频道标识可以直接舍弃掉」「平台也不用选了，反正能从链接推出来」
 *   「我只需要当前直播的视频 ID 就够了，链接跳转也用这个」
 *
 * 于是这一栏收**两种**链接，服务端解析出全部所需：
 *   · **频道页**（`twitch.tv/mcsrranked`、`youtube.com/@Someone`、`live.bilibili.com/12345`）
 *     ⇒ platform + handle。Twitch 与 B站 靠 handle 嵌入；YouTube 频道页**没有播放器**
 *       （频道级嵌入只认 UC… 频道 ID，见 `liveEmbedDecision`）。
 *   · **某一场直播的视频页**（`youtube.com/watch?v=…`）⇒ platform + liveVideoId，
 *     handle 为**空串**。YouTube 靠它播放 —— 这也是用户唯一在用的那一种。
 *
 * ⚠️ `handle` **仍然存在、仍然承重**（Twitch/B站 的嵌入与链接都靠它），
 *    只是**不再由用户填**：它是解析结果，不是输入概念。
 *    ⇒ 别看到"表单里没有 handle"就以为可以把它从库里删掉：
 *      删掉它，Twitch 与 B站 会同时失去链接和播放器（实测过，见 `pending.md`）。
 *
 * ⚠️ 归一化在 `.transform()` 里做**唯一一次**，所以 `POST /api/live` 与
 *   `PATCH /api/live/:id` 不可能各写一份、也不可能漂移；前端的表单校验
 *   （`LiveManagePanel` 跑同一个 schema）与它拿到的结果也逐字一致。
 */
export const LiveChannelInputSchema = z
  .object({
    /** 直播链接：频道页，或某一场直播的视频页。**这是唯一的一栏地址。** */
    url: z
      .string()
      .trim()
      .min(1, { message: '需要一条链接' })
      .max(LIVE_URL_MAX, { message: `链接太长了（最多 ${String(LIVE_URL_MAX)} 个字符）` }),

    displayName: z.string().trim().min(1, { message: '需要名字' }).max(LIVE_NAME_MAX),
    note: z.string().trim().max(LIVE_NOTE_MAX).nullish(),

    /**
     * 标签（2026-09-13，用户要求：「可输入多个标签，暂时不需要做标签筛选功能」）。
     *
     * ⚠️ 它与解析出来的 `handle` 是**两件不同的事**：handle 决定链接与嵌入，
     *    tags 只是给人看的分类，一次都不参与取数。
     *
     * ⚠️ 去重与折叠：同一行里重复的标签没有意义（界面上会并排出现两个一样的），
     *    所以按"去空白 + 去重（大小写不敏感）"归一化一次。保留大小写原样
     *    —— 标签是人写的（"Ranked" vs "ranked" 只保留先出现的那个）。
     */
    tags: z
      .array(z.string().trim().min(1).max(LIVE_TAG_MAX))
      .max(LIVE_TAGS_MAX)
      .default([])
      .transform((list) => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const raw of list) {
          const key = raw.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(raw);
        }
        return out;
      }),

    /** 见文件头：YouTube 频道级嵌入的试验开关。默认关。 */
    embedChannel: z.boolean().default(false),

    sortOrder: z.number().int().min(0).max(9999).default(100),
  })
  /*
   * 链接必须认识，而且必须能推出平台。
   *
   * ⚠️ 只认得出平台还不够：**裸标识**（`@Someone`、`MCSR_Ranked`）能被
   *    `parseLiveLink` 认出来，但那时 `platform` 是 `null` —— 而链接与嵌入
   *    都按平台拼，`platform` 为空的行**既跳不了也嵌不了**。
   *    以前平台是用户自己选的，所以裸标识还能用；现在平台从链接推，
   *    裸标识就没法定位了 ⇒ 这里必须拒掉，并说清该填什么。
   *
   * ⚠️ 错误码沿用既有的 `invalid_input`（不新增），形状是字段级 issue
   *    （`field: 'url'` + 中文 message），前端那套字段级渲染直接吃。
   */
  .superRefine((value, ctx) => {
    const link = parseLiveLink(value.url);
    if (!link) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message:
          '认不出这条链接 —— 请粘**频道页**或**某一场直播的视频页**的完整链接（YouTube / Twitch / B站）',
      });
      return;
    }
    if (link.platform === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message:
          '这条链接里带不到平台信息（像是只填了一个标识）。' +
          '平台由链接推出来，所以请粘**完整链接** —— 例如 https://www.twitch.tv/someone',
      });
    }
  })
  /*
   * 归一化：把链接解析成 `platform` / `handle` / `liveVideoId` 三个列。
   *
   * ⚠️ 走到这里说明上面的 superRefine 已经通过，`parseLiveLink` 不可能为 null，
   *    且 `platform` 一定非空（两个分支都拦过了）。
   * ⚠️ `handle` 允许是**空串**：粘的是"某一场直播的视频页"时链接里没有频道。
   *    016 迁移把去重键放宽成三列，正是为了让这种行能共存多行。
   */
  .transform((value) => {
    const link = parseLiveLink(value.url);
    return {
      ...value,
      platform: (link?.platform ?? 'youtube') as LivePlatform,
      handle: link?.handle ?? '',
      liveVideoId: link?.liveVideoId ?? null,
    };
  });

export type LiveChannelInput = z.infer<typeof LiveChannelInputSchema>;

/**
 * **归一化之前**的入参形状 —— 也就是表单和 HTTP 请求体实际长的样子。
 *
 * ⚠️ 为什么需要它单列一个类型：`LiveChannelInputSchema` 带 `.transform()`，
 *    于是 `z.infer`（输出）里**多了** `platform` / `handle` / `liveVideoId` 三个
 *    由链接解析出来的字段。表单**不能**提供那三个 —— 它们正是要算出来的东西。
 *    用输出类型去标注表单的 payload，TypeScript 会要求表单填三个它根本没有的字段。
 *    （资源库那边踩过同一个坑，注释里写着"`CalendarEventInput` 是**输出**"。）
 */
export type LiveChannelDraft = z.input<typeof LiveChannelInputSchema>;

export interface LiveChannel {
  id: string;
  platform: LivePlatform;
  handle: string;
  displayName: string;
  note: string | null;
  /** 标签（给人看的分类）。**永远不是 null** —— 没填就是空数组，界面少写一个分支。 */
  tags: string[];
  liveVideoId: string | null;
  embedChannel: boolean;
  sortOrder: number;
  status: string;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// ④ 私人列表（「我的链接」）—— 只给自己看，不进公开名单
// ---------------------------------------------------------------------------

/**
 * 用户自己贴的一条链接（`user_live_links` 的一行）。
 *
 * ⚠️ 与公开名单（`LiveChannel`）是**两张独立的表**：不共享行、不共享
 *    "平台 + 标识只能一条"的约束、也不互相写入。同一个人加两条同一个频道
 *    是**允许**的（个人化模型下"判重"不再是问题），所以没有 `UNIQUE(platform, handle)`。
 */
export interface UserLiveLink {
  id: string;
  /** **用户原样粘贴的那条链接** —— 它是用户提供的数据，必须留下。 */
  url: string;
  /** 由 `parseLiveLink` 解析出来；**认不出就是 null**（那一行只给外链）。 */
  platform: LivePlatform | null;
  /** 归一化后的频道标识 —— **绝不会是链接**；认不出或只有视频 ID 时为 null。 */
  handle: string | null;
  /** 「现在这一场」的视频 ID（链接指向某一场视频时才有）。 */
  liveVideoId: string | null;
  /** 用户自己给这一行起的名字（可空）。 */
  title: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * 私人列表的入参：**只收 `url` + 可选 `title`**。
 *
 * ⚠️ 平台与标识**全部由服务端推导**（`parseLiveLink`），客户端不许指定 ——
 *    否则表里的 `platform` 会与链接实际指向的平台不一致，而两边都不报错。
 * ⚠️ `.strict()`：多余的字段直接 400（不是被悄悄忽略）。
 */
export const UserLiveLinkInputSchema = z
  .object({
    url: z
      .string()
      .trim()
      .min(1, { message: '需要一条链接' })
      .max(LIVE_URL_MAX, { message: `链接太长了（最多 ${String(LIVE_URL_MAX)} 个字符）` }),
    title: z.string().trim().max(LIVE_NAME_MAX).nullish(),
  })
  .strict();

export type UserLiveLinkInput = z.infer<typeof UserLiveLinkInputSchema>;

/**
 * 改自己那一行：**改 `url` 或 `title`**，两个都可选，但至少要给一个。
 *
 * ⚠️ `title: null` 是**清空**（与"没传这个字段"不同）—— 两个状态都要能表达，
 *    否则用户没法把之前起的名字去掉。
 */
export const UserLiveLinkPatchSchema = z
  .object({
    url: z
      .string()
      .trim()
      .min(1, { message: '需要一条链接' })
      .max(LIVE_URL_MAX, { message: `链接太长了（最多 ${String(LIVE_URL_MAX)} 个字符）` })
      .optional(),
    title: z.string().trim().max(LIVE_NAME_MAX).nullish(),
  })
  .strict()
  .refine((value) => value.url !== undefined || value.title !== undefined, {
    message: '至少要改一个字段（url 或 title）',
  });

export type UserLiveLinkPatch = z.infer<typeof UserLiveLinkPatchSchema>;

/** 频道主页链接 —— 总是能拼出来，所以永远不会是一个死链。 */
export function liveChannelUrl(platform: LivePlatform, handle: string): string {
  const h = handle.trim();
  switch (platform) {
    case 'youtube':
      // `@handle` 直接拼；老的 `UC...` 频道 ID 要走 /channel/ 那条路
      return h.startsWith('@')
        ? `https://www.youtube.com/${encodeURIComponent(h).replace('%40', '@')}`
        : `https://www.youtube.com/channel/${encodeURIComponent(h)}`;
    case 'twitch':
      return `https://www.twitch.tv/${encodeURIComponent(h)}`;
    default:
      // B站 的直播间号是老式的纯数字；其它写法当作空间号处理不了，退回搜索页
      return /^\d+$/.test(h)
        ? `https://live.bilibili.com/${encodeURIComponent(h)}`
        : `https://live.bilibili.com/blanc/${encodeURIComponent(h)}`;
  }
}

/**
 * 「去看这一场」的地址（2026-09-13）。
 *
 * ---------------------------------------------------------------------------
 * ★ 为什么需要它：卡片上那个按钮原来无条件指向**频道页**
 * ---------------------------------------------------------------------------
 * 用户实测发现的缺陷：他给 YouTube 那行填了正在直播的视频 ID（`zsb-ZDznGIA`），
 * 播放器**能播**，但「去原频道看」指向 `youtube.com/channel/MCSR_Ranked` —— 一条**死链**
 * （YouTube 的 `/channel/` 只认 `UC…` 开头的频道 ID）。
 * ⇒ 判据改成：**有视频 ID 就指向那一场视频，否则才指向频道页。**
 *   用户的原话就是这个意思：「链接跳转也用这个」。
 *
 * ⚠️ Twitch 与 B站 解析出的 `liveVideoId` 永远是 null（`parseLiveLink` 对它们
 *    只产出 handle）⇒ 这两个平台走的始终是频道页那条路。
 *    **但库里可能存着历史值**（线上那行 Twitch 就存着 `mcsrranked` —— 那是频道名，
 *    被误填进了旧表单的"视频 ID"栏）⇒ 下面加了一道形状守卫：
 *    Twitch 的录像地址要求**纯数字** ID，形状不对就退回频道页，
 *    免得拼出一条 `twitch.tv/videos/mcsrranked` 这种死链。
 */
export function liveVideoUrl(platform: LivePlatform, videoId: string): string {
  const v = encodeURIComponent(videoId.trim());
  switch (platform) {
    case 'youtube':
      return `https://www.youtube.com/watch?v=${v}`;
    case 'twitch':
      // Twitch 的录像（VOD）地址要求纯数字 id；别的形状不是我们能指的地址
      return `https://www.twitch.tv/videos/${v}`;
    default:
      return `https://www.bilibili.com/video/${v}`;
  }
}

/**
 * 卡片上「去原频道看」/「去看这一场」该指向哪。
 *
 * ⚠️ 与 `liveEmbedDecision` 的取值**方向一致**（都优先视频），但用途不同：
 *    那个回答"嵌哪个播放器地址"，这个回答"点出去看哪里"。
 *    两者用同一个优先级，界面上才不会出现"播的是这一场、点出去是频道页"的割裂。
 */
export function liveChannelHref(
  channel: Pick<LiveChannel, 'platform' | 'handle' | 'liveVideoId'>,
): string {
  const videoId = channel.liveVideoId?.trim() ?? '';
  /*
   * ⚠️ **只有 YouTube 走视频那条路** —— 判据是"**嵌入**也会用这个视频"。
   *
   * 这是被渲染自检逼出来的：夹具里有一条 Twitch 行带着数字 `liveVideoId`
   * （`twitch.tv/videos/1234567` 确实是个合法形状），如果这里照用，
   * 卡片就变成"**播放器放的是频道，点出去是另一个录像**"—— 两者指向不同的东西。
   * 而 `liveEmbedDecision` 对 Twitch/B站 **根本不读** `liveVideoId`
   * （它们的嵌入对象是频道/房间，Twitch 的录像也没有"正在直播"那种地址）。
   * ⇒ 链接与播放器的取值**必须同源**：嵌入用视频，链接才用视频；否则一律频道页。
   *   （用户报的那个缺陷正是这条规则的反面：YouTube 有视频却去指死链频道页。）
   */
  const prefersVideo = channel.platform === 'youtube' && videoId !== '';
  if (prefersVideo) return liveVideoUrl(channel.platform, videoId);
  return liveChannelUrl(channel.platform, channel.handle);
}

/**
 * 私人列表那一行的「去原站看」链接。
 *
 * ⚠️ 判据只有一条，而且**必须**是这样：认得出平台**且**有标识 ⇒ 按平台拼
 *    （那样永远是活的频道页）；否则 ⇒ 用**用户原样粘贴的那条**。
 *    反过来写（一律拼平台链接）会在"解析不出来"那行上拼出一个死链，
 *    而那正是私人列表允许保存的东西（D4b.4）。
 */
export function userLiveLinkUrl(link: Pick<UserLiveLink, 'url' | 'platform' | 'handle'>): string {
  return link.platform && link.handle ? liveChannelUrl(link.platform, link.handle) : link.url;
}

// ---------------------------------------------------------------------------
// 嵌入判定（两态，见文件头）
// ---------------------------------------------------------------------------

/**
 * `liveEmbedDecision` 的输入形状。
 *
 * ⚠️ 比 `LiveChannel` 窄，是因为**私人列表那一行也要能判定**，而它没有
 *    `displayName` / `status` 这些公开名单才有的字段。
 * ⚠️ `embedChannel` 可选：它只对 YouTube 的频道级嵌入有意义，
 *    私人列表那侧没有这个开关（默认就是关）。
 */
export type LiveEmbedChannel = Pick<LiveChannel, 'platform' | 'handle' | 'liveVideoId'> & {
  embedChannel?: boolean;
};

/** 确定嵌不出来的原因（**没有"未验证"这一档**，见文件头）。 */
export type LiveEmbedReason = 'bilibili_blocked' | 'no_id' | 'not_channel_id' | 'no_origin';

/** 两态判定：能嵌（给地址）/ 确定不可嵌（给原因）。 */
export type LiveEmbedDecision =
  | { embed: true; url: string }
  | { embed: false; reason: LiveEmbedReason };

/**
 * 这一行**能不能嵌**。
 *
 * ⚠️ 它**只返回两态**，而且"不能嵌"必须带一个原因 —— 因为界面上必须说清为什么。
 *    一个空白的播放器框是**最坏**的结果：它看起来像网络问题，用户唯一能做的就是刷新。
 *
 * @param origin 嵌入页面自己的 host（浏览器里就是 `location.hostname`）。
 *   **必填、且承重**：Twitch 的 `parent` 就是它，传错会**静默拒播**（见文件头）。
 *   缺它就宁可不嵌。
 */
export function liveEmbedDecision(channel: LiveEmbedChannel, origin: string): LiveEmbedDecision {
  // Twitch：**要嵌**，但 `parent` 必须等于嵌入页面的 host
  if (channel.platform === 'twitch') {
    const host = originHost(origin);
    if (!host) return { embed: false, reason: 'no_origin' };
    const name = channel.handle.trim();
    /*
     * 标识是空的时候不能嵌：`channel=` 空着会得到一个什么都不显示的播放器。
     * ⚠️ 这一档走不到（我们自己的写入路径不会产出"twitch + 空标识"），
     *    但**读路径不能假设写入路径是对的**（库里可能有历史行）。
     */
    if (!name || /\s/.test(name)) return { embed: false, reason: 'no_id' };
    return {
      embed: true,
      url: `https://player.twitch.tv/?channel=${encodeURIComponent(name)}&parent=${encodeURIComponent(host)}`,
    };
  }

  /*
   * B站直播间：**用官方的「活动播放器」嵌**（2026-09-13 修复）。
   *
   * ---------------------------------------------------------------------------
   * ⚠️ 这里原来写的是「确定不可嵌」并直接返回 `bilibili_blocked`，理由是
   *    `x-frame-options: SAMEORIGIN`。**那个理由对"房间页"是对的，但用错了地方。**
   * ---------------------------------------------------------------------------
   * 实测（2026-09-13，带浏览器 UA 打响应头）：
   *   `https://live.bilibili.com/31288037`                          → `X-Frame-Options: SAMEORIGIN`  ⇒ 不能嵌
   *   `https://www.bilibili.com/blackboard/live/live-activity-player.html?cid=31288037`
   *                                                                → **200，没有任何 frame 限制** ⇒ 能嵌
   *
   * 后者是 B站**官方文档里给"嵌到别人页面里"用的那个播放器**
   * （`live.bilibili.com/p/html/bilibili-live-player/docs/player-activity.html`），
   * `cid` 就是房间号，文档还专门给了 iframe 的 16:9 用法。
   * ⇒ 所以 B站**不是不能嵌**，是我们之前拿房间页当嵌入地址了。
   *
   * ⚠️ 判据是**房间号**，不是标识：`cid` 要的是纯数字。所以只有 `handle` 是一串
   *    数字时才拼地址；其他形状（例如用户贴的是 `live.bilibili.com/123` 之外的链接、
   *    或标识被归一化成了别的东西）一律退回 `no_id` —— **绝不拼一个看起来对的地址**，
   *    那会得到一个黑框，比给外链糟得多。
   */
  if (channel.platform === 'bilibili') {
    const room = channel.handle.trim();
    /*
     * ⚠️ 认不出房间号时退回 `bilibili_blocked` —— **不是**说"B站禁止嵌入"（那是旧的、
     *    已经被证伪的说法），而是"这一条我们拼不出播放地址"。界面文案
     *    （`live.noEmbedBilibili`）在 2026-09-13 同步改成了这个意思。
     *    枚举值名字保持不变：改名字会牵动 `LiveEmbedReason` 的使用方与兼容层，
     *    而这里要的是**文案不再说谎**，不是一次重命名。
     */
    if (!BILIBILI_ROOM_ID.test(room)) return { embed: false, reason: 'bilibili_blocked' };
    return {
      embed: true,
      url: `https://www.bilibili.com/blackboard/live/live-activity-player.html?cid=${encodeURIComponent(room)}`,
    };
  }

  if (channel.platform === 'youtube') {
    // ① 优先用具体的视频 ID —— 那是确定能播的那一种
    const videoId = channel.liveVideoId?.trim();
    if (videoId) {
      if (!YOUTUBE_VIDEO_ID.test(videoId)) return { embed: false, reason: 'no_id' };
      return { embed: true, url: `https://www.youtube.com/embed/${encodeURIComponent(videoId)}` };
    }

    // ② 频道级嵌入：只认老的频道 ID（UC 开头、24 位），其余一律不嵌
    if (!channel.embedChannel) return { embed: false, reason: 'no_id' };
    const handle = channel.handle.trim();
    if (!YOUTUBE_CHANNEL_ID.test(handle)) return { embed: false, reason: 'not_channel_id' };
    return {
      embed: true,
      url: `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(handle)}`,
    };
  }

  /*
   * 兜底：**实际上是防御性代码，正常路径到不了这里。**
   *   · **类型上不可能** —— `platform` 是 `LivePlatform`（非空、闭集），上面三个分支
   *     已穷尽它；
   *   · **写入路径也被枚举挡住**：`LiveChannelInputSchema.platform = z.enum(LIVE_PLATFORMS)`；
   *   · ⚠️ **而库层同样挡着** —— `live_channels.platform` 带
   *     `CHECK (platform IN ('youtube','twitch','bilibili'))`
   *     （`db/migrations/012_resource_video_and_live.ts`），**并有测试钉着它**：
   *     往这张表插 `'kick'` 会抛 `/CHECK/i`。
   *   ⇒ 「陌生平台串」**既进不去也读不出来**，这一档**可达性约等于 0**。
   *
   * ⚠️ 更正一处**曾经写错的理由**：本注释早先写的是「**库里的值不受类型约束**
   *    （所以运行时可能）」。**那句对这张表是错的** —— 约束不在类型上，但**在 DB 层**。
   *    「类型管不到」≠「没人管」。⚠️ **写错的理由比不写理由更危险**：下一个人会照着它
   *    去防一个不存在的隐患，或者据此以为"库里的值随便什么都能进来"。
   *
   * ⚠️⚠️ **`null` 不在这一档的适用范围里，别把认不出平台的行送进来**：
   *   `null` 是**设计内状态**（`parseLiveLink` 对裸标识明确产出 `{ platform: null, … }`），
   *   不是"异常数据"。它到了这里只会被说成 `'bilibili_blocked'`，界面就打印
   *   「这个平台不支持站内播放」—— 而那一行的读者该看到的是「我们认不出这个链接」。
   *   ⇒ **调用方必须先自己拦掉 `platform === null`**（`MyLiveList.tsx` 就是这么做的，
   *     走 `myLive.linkOnly` 那句）。**这是这一档唯一真正的守卫点。**
   *
   * ⚠️ 归到 `'bilibili_blocked'` 是**当前的务实妥协**，不是精确语义：**如果将来**真的
   *   放宽了 DB 校验或引入新平台，正确改法是**给 `LiveEmbedReason` 加一档**（配一条
   *   通用文案），而**不是**让陌生平台继续冒充 B站。**现在不必做 —— 该串不可达。**
   */
  return { embed: false, reason: 'bilibili_blocked' };
}

/**
 * 这一行**能不能嵌**，以及嵌什么。`liveEmbedDecision` 的薄封装。
 *
 * 返回 `null` = 不嵌（界面上就只显示"去频道看"的外链 + 一句为什么）。
 * ⚠️ 新代码请直接用 `liveEmbedDecision()` —— 它把"为什么"也一起给你，
 *    而这里丢掉的那个 `reason` 正是界面上最容易漏掉的一半。
 */
export function liveEmbedUrl(channel: LiveEmbedChannel, origin: string): string | null {
  const decision = liveEmbedDecision(channel, origin);
  return decision.embed ? decision.url : null;
}

/**
 * 兼容层的返回类型 —— **legacy 取值集合**（含 `'platform'`）。
 *
 * @deprecated `'platform'` 是 **legacy 值**：它正在被 `'bilibili_blocked'` 取代
 *   （新代码请用 `liveEmbedDecision()` 的 `reason`）。它**必须活到 t24 落地为止** ——
 *   `apps/web` 有三处引用还指着它：`LiveCard.tsx:121` 的穷尽 `Record` 映射
 *   （联合类型一加取值就 `TS7053` 编译不过）与 `liverender.tsx:218/235` 的断言。
 *   ⇒ **t24 改完词条、t22 把 `LiveCard` 迁到 `liveEmbedDecision()` 之后**，
 *     本类型与 `liveEmbedUnavailableReason()` 一起删除。
 */
export type LegacyLiveEmbedReason =
  | 'platform'
  | 'bilibili_blocked'
  | 'no_id'
  | 'not_channel_id'
  | null;

/**
 * 界面上要不要提示"这行的频道嵌入开关其实不生效"，以及**为什么没有播放器**。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 兼容层：新代码用 `liveEmbedDecision()`，别再用这个
 * ---------------------------------------------------------------------------
 * 它只拿得到 channel、**拿不到 `origin`**，所以它回答不了 Twitch 那一行
 * （Twitch 能不能嵌取决于 `origin`）。保留它只有一个理由：`apps/web` 的
 * `LiveCard.tsx` 还在用它，而那里是一个**穷尽的** `Record<旧值, 词条>` 映射 ——
 * 直接给这个函数加一个新取值会让 apps/web **编译不过**（`strict: true`），
 * 而"少一个取值"会让 `check:live` 的那两条断言读到另一句话（`check:live`
 * **不在 `pnpm check` 里**，所以那种错只在单独跑它时才看得见）。
 *
 * 映射（**只剩一处有损**，写在这里）：
 *   · `'bilibili_blocked'` → `'bilibili_blocked'` —— ★ **1:1 直传，不再有损**（t24）：
 *        这一档现在会一路指到 `live.noEmbedBilibili`，界面说的是
 *        "B 站不允许把直播间嵌进别的网站（它自己禁止了）"，**说清了是哪种**。
 *   · `'no_origin'` → `'platform'`
 *     —— **唯一剩下的有损映射**（且是**正确**的）：旧联合类型里没有 `'no_origin'`，
 *        而归到"平台那一档"是**最小惊讶**：这一层拿不到 `origin`，能走到它只有
 *        SSR / 渲染脚本（浏览器里 `location.hostname` 一定有值，Twitch 那时是
 *        **能嵌**的、根本不进这一档）。
 *        ⚠️ 归成 `null` 会让 Twitch 那一行在渲染脚本里被说成"没有记录视频 ID"
 *        （`live.noEmbedNoId`）—— 那是**更错**的一句话，而且会让
 *        liverender 里那条断言红掉。
 *        ★ **这一格归到 `'platform'` 正是 `live.noEmbedPlatform` 不能删的理由**
 *        （删了它，这一格无处可去）。
 *
 * ⇒ 迁移到 `liveEmbedDecision()` 之后，这个函数连同上面**那一处**有损映射一起删掉
 *   （**归后续单独任务**：它需要 `apps/web` 的范围）。
 */
export function liveEmbedUnavailableReason(channel: LiveEmbedChannel): LegacyLiveEmbedReason {
  const decision = liveEmbedDecision(channel, '');
  if (decision.embed) return null;
  switch (decision.reason) {
    case 'not_channel_id':
      return 'not_channel_id';
    case 'no_id':
      return 'no_id';
    case 'bilibili_blocked':
      /*
       * ★ 1:1 直传（t24）。以前这里归并成 `'platform'` —— 那正是本轮的缺陷：
       *   B站 是**确定态**（`x-frame-options: SAMEORIGIN` 明令禁止），却被说成
       *   笼统的"这个平台在这里不能嵌入播放"，界面**没说清是哪种**。
       *   直传之后 `LiveCard` 的穷尽映射才会指到 `live.noEmbedBilibili`
       *   （那句说的是"B 站不允许把直播间嵌进别的网站"）。
       */
      return 'bilibili_blocked';
    case 'no_origin':
      /*
       * ⚠️ 这一格**保持归到 `'platform'`**，它是通用句存在的理由：
       *   拿不到 `origin` 时 Twitch 拼不出 `parent`，所以"这里嵌不出来"成立，
       *   但"平台不允许"**不**成立。⇒ 别把它也直传，也别让 `'platform'` 消失。
       */
      return 'platform';
  }
}

/**
 * `origin` → Twitch 的 `parent` 要的那个 host。
 *
 * ⚠️ 只取 **hostname**（不含端口、路径、协议）：`parent` 要的是域名本身
 *    （`mcsrhelper.com` / `localhost`），把 `https://` 或端口塞进去会被拒。
 * ⚠️ 拿不到一个像域名的东西时返回空串 ⇒ 调用方**宁可不嵌**。
 */
function originHost(origin: string): string {
  const raw = origin.trim();
  if (!raw) return '';
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase();
    return /^[a-z0-9.-]+$/.test(host) ? host : '';
  } catch {
    return '';
  }
}
