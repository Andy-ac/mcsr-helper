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
 * ---------------------------------------------------------------------------
 * ⚠️ 三个平台的嵌入能力不一样，而且**故意不一样**
 * ---------------------------------------------------------------------------
 * | 平台 | 现在怎么处理 | 为什么 |
 * |---|---|---|
 * | YouTube | 有 `liveVideoId` 就嵌；开了 `embedChannel` 就按频道嵌 | 视频 ID 嵌入是现成能力；频道嵌入见下 |
 * | Twitch | **只记录、不嵌** | 用户明说"还没测试"。嵌了会是一个黑框，而黑框看起来像我们的 bug |
 * | B站  | **只记录、不嵌** | 直播嵌入没有官方支持的证据（和 B站 视频嵌入不是一回事） |
 *
 * ⚠️ **没有默认采用频道级嵌入** (`/embed/live_stream?channel=<频道ID>`)。
 *    它能让"记录频道"做到零维护 —— 点一次频道，永远显示当前直播 ——
 *    但三条理由压住了它：
 *
 *      1. 证据互相矛盾：2026 年还有人在推荐它，同时有"频道直播嵌入代码失效了"
 *         和"永久直播 URL 是否还工作"两类报告；
 *      2. 它的失败样子是**一个纯黑框**，正是"看起来像网络问题"的那一类；
 *      3. **没有正在直播的频道时它本来就不显示任何东西** ——
 *         所以在没有真人开播的情况下**无法验证**它到底是好是坏。
 *
 *    所以它做成了一个**每行可开的开关**：等确认某个 streamer 正在开播时
 *    点一下就能试，试成了再推广，试不成也不影响别的行。
 */
import { z } from 'zod';
import { LIVE_PLATFORMS, type LivePlatform } from './constants';

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
 * 频道标识的形状。
 *
 * ⚠️ 刻意**宽松**：频道标识是平台自己的东西，YouTube 有 `UC...` 的老式 ID、
 *    `@handle` 的新式写法，Twitch 是用户名。写死一个正则会让"这个人加不进来"，
 *    而他要做的只是贴对一行字。这里只挡住明显不是标识的东西
 *    （空白、URL、超长），并且**不允许 URL** —— 那是"把两种东西混成一个字段"
 *    的经典错误（链接和标识的拼接方式不同，混在一起之后没法拼对）。
 */
const HandleSchema = z
  .string()
  .trim()
  .min(1, { message: '需要频道标识' })
  .max(LIVE_HANDLE_MAX)
  .refine((v) => !/^https?:\/\//i.test(v), {
    message: '这里填频道标识（例如 @Someone），不是链接 —— 链接由我们按平台拼出来',
  })
  .refine((v) => !/\s/.test(v), { message: '频道标识里不能有空格' });

export const LiveChannelInputSchema = z.object({
  platform: z.enum(LIVE_PLATFORMS),
  handle: HandleSchema,
  displayName: z.string().trim().min(1, { message: '需要名字' }).max(LIVE_NAME_MAX),
  note: z.string().trim().max(LIVE_NOTE_MAX).nullish(),

  /**
   * 可选：当前（或最近一场）直播的**视频 ID**。有它才嵌。
   *
   * ⚠️ 它会变。所以界面上必须说清"这是给现在这场用的"，而不是暗示它是频道的属性 ——
   *    否则下个月它会变成一个指向旧直播的死链，而没人会想到需要更新它。
   */
  liveVideoId: z.string().trim().max(64).nullish(),

  /** 见文件头：YouTube 频道级嵌入的试验开关。默认关。 */
  embedChannel: z.boolean().default(false),

  sortOrder: z.number().int().min(0).max(9999).default(100),
});

export type LiveChannelInput = z.infer<typeof LiveChannelInputSchema>;

export interface LiveChannel {
  id: string;
  platform: LivePlatform;
  handle: string;
  displayName: string;
  note: string | null;
  liveVideoId: string | null;
  embedChannel: boolean;
  sortOrder: number;
  status: string;
  createdAt: number;
  updatedAt: number;
}

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
 * 这一行**能不能嵌**，以及嵌什么。
 *
 * 返回 `null` = 不嵌（界面上就只显示"去频道看"的外链）。
 *
 * ⚠️ 三种返回 null 的情况，理由各不相同，而且都不会报错 —— 所以它们必须
 *    在这里被区分清楚，否则界面上会出现一个**空白的播放器框**：
 *
 *      1. **平台不支持**（Twitch / B站）：用户明确说 Twitch 没测过，
 *         而 B站 直播嵌入没有官方支持的证据。宁可不嵌，也不要一个黑框。
 *      2. **没给视频 ID，也没开频道嵌入**：最常见的情况。
 *      3. **开了频道嵌入但标识不是 `UC...` 形式的频道 ID**：
 *         `live_stream?channel=` 只认频道 ID，给它一个 `@handle`
 *         会得到一个**黑框**（而不是报错）。所以这里提前挡掉。
 *
 * ⚠️ `origin` 现在**用不到**（唯一会嵌的 YouTube 不需要 `parent`），
 *    但它是这个函数的公开契约的一部分：Twitch 的 `parent` 需要它，
 *    而把它去掉、等支持 Twitch 时再加回来，会让每一个调用点都动一次。
 *    所以留着，并在这里说明它为什么现在没人用 —— 而不是让下一个人
 *    看到一个"没人用的参数"然后删掉它。
 */ export function liveEmbedUrl(
  channel: Pick<LiveChannel, 'platform' | 'handle' | 'liveVideoId' | 'embedChannel'>,
  /*
   * ⚠️ 抑制注释必须写在**报错的那一行**上（也就是这个参数），
   *    写在函数声明上面是无效的 —— biome 会照报，而你会以为注释没生效。
   *    这是它和 eslint 的一个用法差别：`// biome-ignore` 作用于**下一行**。
   */
  // biome-ignore lint/correctness/noUnusedFunctionParameters: origin 是给 Twitch 的 parent 留的位置，现在只有 YouTube 会嵌，所以暂时用不到（见上面的说明）
  origin: string,
): string | null {
  // ① 平台：只有 YouTube 现在会真的嵌（见文件头那张表）
  if (channel.platform !== 'youtube') return null;

  // ② 优先用具体的视频 ID —— 那是确定能播的那一种
  const videoId = channel.liveVideoId?.trim();
  if (videoId) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
    return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
  }

  // ③ 频道级嵌入：只认老的频道 ID（UC 开头、24 位），其余一律不嵌
  if (!channel.embedChannel) return null;
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(channel.handle.trim())) return null;
  return `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(channel.handle.trim())}`;
}

/**
 * 界面上要不要提示"这行的频道嵌入开关其实不生效"。
 *
 * ⚠️ 存在的理由：`embedChannel` 打开了但标识不是频道 ID 时，
 *    `liveEmbedUrl` 会返回 null（宁可不嵌），而**用户以为自己开了**。
 *    没有这条提示，那是一个"设置了但没反应"的开关 —— 最难排查的一类。
 */
export function liveEmbedUnavailableReason(
  channel: Pick<LiveChannel, 'platform' | 'handle' | 'liveVideoId' | 'embedChannel'>,
): 'platform' | 'no_id' | 'not_channel_id' | null {
  if (channel.platform !== 'youtube') return 'platform';
  if (channel.liveVideoId?.trim()) return null;
  if (!channel.embedChannel) return 'no_id';
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(channel.handle.trim())) return 'not_channel_id';
  return null;
}
