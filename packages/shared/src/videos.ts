/**
 * 视频嵌入的契约 —— **服务端和前端共用**。
 *
 * ---------------------------------------------------------------------------
 * 铁律：只存 `platform + video_id`，**绝不抓取任何元数据**
 * ---------------------------------------------------------------------------
 * 标题由发帖人手填。理由不是技术性的，是合规性的（见 v1-plan §5）：
 *   · B站：个人开发者**没有合法的元数据接口**，社区两个主力库都已被律师函/归档
 *   · YouTube：元数据最多存 30 天、禁止聚合、禁止自造指标 → 不存最省事
 *   · Twitch：唯一明确支持后端拉元数据的平台，但 v1 不需要
 *
 * ⚠️⚠️ **它只管这一条路**（用户自贴，落 `videos` 表）。2026-09-16 起的「追踪的博主」是
 *    **另一条路**（落 `tracked_videos` 表，见 `docs/video-tracking-spec.md` §8.1）：
 *    那条路上的标题/封面/时长/播放量/评论数**全部是抓来的**。两条路并存、互不影响 ——
 *    上面那条铁律描述的是"我们手里没有元数据"的那条路，所以它仍然是真的，一个字没改。
 *
 * ---------------------------------------------------------------------------
 * 嵌入 URL 为什么放在 shared 而不是前端组件里
 * ---------------------------------------------------------------------------
 * 三个平台的参数规则各不相同，而且错了**不报错** —— 页面里就是一个白框，
 * 看起来像"网络问题"。放进 shared 才能被单元测试覆盖到，
 * 而测试正是唯一能在没人盯着看的情况下发现这类问题的地方。
 */
import { z } from 'zod';
import { parseVideoUrl, type VideoPlatform } from './constants';

export const VIDEO_TITLE_MAX = 200;

/** 起始偏移的上限：24 小时。超过这个长度的视频不是我们要处理的场景。 */
export const MAX_START_OFFSET_SEC = 24 * 3600;

/**
 * 发帖入参。
 *
 * ⚠️ 入参是**一个链接**，不是一个 (platform, videoId) 对。
 *    用户手里就是一条链接；逼他把它拆成两个字段是把我们的内部表示
 *    泄漏到界面上，而且一定会有人把 BV 号填进 platform 那一栏。
 *    拆分由 `parseVideoUrl` 在服务端做（它已经不产生任何网络请求）。
 */
export const VideoInputSchema = z.object({
  url: z.string().trim().min(1, { message: '请粘贴视频链接' }).max(500),
  title: z.string().trim().min(1, { message: '标题不能为空' }).max(VIDEO_TITLE_MAX),
  /**
   * 可选的起始偏移（秒）。可空。
   * ⚠️ B站嵌入**不支持**跳转 —— 见 `buildEmbedUrl` 的说明。
   */
  startOffsetSec: z.number().int().min(0).max(MAX_START_OFFSET_SEC).nullish(),
});

export type VideoInput = z.infer<typeof VideoInputSchema>;

export interface Video {
  id: string;
  userId: string;
  authorName: string | null;
  platform: VideoPlatform;
  videoId: string;
  title: string;
  startOffsetSec: number | null;
  status: string;
  createdAt: number;
}

/**
 * 把用户填的起始偏移解析成秒。接受 `90`、`1:30`、`1:02:33` 三种写法。
 *
 * 为什么需要它：让用户在"起始时间"里填 `3783` 是不合理的，
 * 而视频平台上显示的永远是 `1:02:33` —— 用户会照着抄。
 * 返回 null 表示格式不对（调用方给表单错误）。
 */
export function parseTimecode(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(':');
  if (parts.length > 3) return null;
  // 每一段都要是纯数字（不接受 '1h2m' 这种 —— 那是 Twitch URL 的写法，不是给人填的）
  if (parts.some((p) => !/^\d{1,4}$/.test(p))) return null;

  const nums = parts.map(Number);
  // 冒号后面的段必须是 0–59，否则 '1:99' 会被静默当成 159 秒
  for (let i = 1; i < nums.length; i++) {
    if ((nums[i] as number) > 59) return null;
  }

  // 从右往左补位：最后一段是秒、倒数第二段是分、最前面是时。
  // 这样写而不是解构，是因为 tsconfig 开了 noUncheckedIndexedAccess ——
  // 那个选项下 `nums[0]` 的类型是 `number | undefined`，而它是对的：
  // 数组长度是运行时才知道的，解构出来的变量确实可能是 undefined。
  const sec = nums[nums.length - 1] ?? 0;
  const min = nums.length >= 2 ? (nums[nums.length - 2] ?? 0) : 0;
  const hour = nums.length === 3 ? (nums[0] ?? 0) : 0;

  const total = hour * 3600 + min * 60 + sec;
  return total > MAX_START_OFFSET_SEC ? null : total;
}

/** 秒 → `1:02:33`（不足一小时则 `2:33`）。给界面显示和 Twitch 参数用。 */
export function formatTimecode(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const mm = String(m).padStart(2, '0');
  const sss = String(ss).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${sss}` : `${m}:${sss}`;
}

/**
 * Twitch 的 `time` 参数用的是 `1h2m3s` 这种形式，**和展示用的 `1:02:33` 不同**。
 * 单独一个函数，因为混用这两者是一个很容易犯、又很难看出来的错
 * （Twitch 收到不认识的 time 会**忽略它**，视频照常播放，只是从 0 开始）。
 */
export function formatTwitchTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${h > 0 ? `${h}h` : ''}${m > 0 ? `${m}m` : ''}${ss}s`;
}

/**
 * 拼嵌入 URL。
 *
 * ⚠️ 三个平台的参数规则是不同的，而且**错了都不报错**（只是一个白框）：
 *   · YouTube：`?start=<秒>`。不需要 parent。
 *   · Twitch：`parent` **必填**（按域名校验），`video` **必须带 v 前缀**，
 *     `time` 用 `1h2m3s` 形式。
 *   · B站：`bvid` 参数。**没有官方的起始时间参数** ——
 *     所以 B站传了 startOffsetSec 也**不会跳转**。这一点必须在界面上说明，
 *     而不是默默丢掉：默默丢掉会让用户以为链接坏了。
 *   · B站 的弹幕是**开着**的（`danmaku=1`，2026-09-19）：那条参数一旦写成 `0`，
 *     播放器不是"默认关掉弹幕"而是**不取弹幕数据**，连开关都不存在 ——
 *     实测源码、被推翻的旧裁决与它的代价都写在下面那个 case 里。
 *
 * `origin` 是 Twitch 的 `parent` 值（我们的域名，例如 `mcsrhelper.com`）。
 */
export function buildEmbedUrl(
  platform: VideoPlatform,
  videoId: string,
  startOffsetSec: number | null,
  origin: string,
): string | null {
  switch (platform) {
    case 'youtube': {
      const base = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
      return startOffsetSec && startOffsetSec > 0 ? `${base}?start=${startOffsetSec}` : base;
    }
    case 'twitch': {
      // parent 必须有值；没有的话宁可不嵌，也不要发一个注定被拒的请求
      if (!origin) return null;
      /*
       * ⚠️⚠️ `video` 参数**必须带 "v" 前缀**。
       *
       * 官方文档原文："In this context (the video player), the video ID must
       * have a 'v' prefix."
       *
       * 漏了它的表现是**播放器什么都不显示** —— 不报参数错误、不弹提示、
       * 就是一个空白框，看起来像网络问题或者我们的页面坏了。
       * 这类"错了不报错"的东西正是本文件开头说的、必须被单元测试盖住的那一类。
       *
       * ⚠️ 而我们的库里存的 `videoId` **一定是纯数字**（`VIDEO_ID_PATTERNS.twitch`
       *    是 `/^\d{6,12}$/`，解析链接时也只取数字那段），所以前缀只能在这里加，
       *    而且加了之后不会出现 `vv` 的风险 —— 存进去的时候就没有 `v`。
       *
       * 这条是 review 时和当时的那个自检页（`/embed-test`，2026-09-13 已删）对出来的：
       * 那个页面早就写着这句话（它拼的是 `?video=v...`），而这里漏了。
       * 自检页对了、生产代码错了，说明"探针页验证过"不等于"线上那条路验证过"。
       */
      const params = new URLSearchParams({ video: `v${videoId}`, parent: origin });
      if (startOffsetSec && startOffsetSec > 0)
        params.set('time', formatTwitchTime(startOffsetSec));
      return `https://player.twitch.tv/?${params.toString()}`;
    }
    case 'bilibili': {
      /*
       * ★★ `danmaku=1`（2026-09-19 改，原来是 `0`）。
       *
       * ⚠️★ 这一格的**代价**必须写在这里，因为它是**推翻**一条既有裁决换来的：
       *   `danmaku=0` 那句注释说的是"弹幕是第三方内容，而我们的页面有自己的评论阈值"。
       *   改成 `1` 之后，**弹幕里会出现我们不审的内容**，而那句"我们有自己那套阈值"
       *   对弹幕这一格**不再成立** —— 我们既不过滤它、也看不到它。
       *   接受它的理由只有一条，而且是用户裁决的：弹幕开关**根本不存在**时，
       *   "这一栏的播放器和上面那栏一样"这件事就是假的（见下）。
       *
       * ★ 为什么 `0` 不是"默认关掉"，而是"这个控件根本不存在"（**实测**）：
       *   `player.bilibili.com/player.html` 是一个静态壳，参数在**浏览器端**读
       *   （`.cache/videos-live-round/bili-player-curated.body.txt:144-157` 是页面源码原文）：
       *     `if (SP.danmaku != null && !SP.danmaku) featureList.add('noDanmaku');`
       *   而播放器核心对那个 feature 的第一句就是
       *     `if (this.configStore.noDanmaku || …) return void this.log.i('noDanmaku');`
       *   ⇒ 弹幕**连数据都不取**，用户看到的不是"弹幕默认关闭"，而是**没有那个开关**。
       *   官方参数表那句"`false` 表示关闭弹幕，其他表示默认值"（`danmaku` 是 boolean）
       *   说的正是"别写 false"。
       *
       * ⚠️ 与 `autoplay: '0'` **不一样**：那个是真的有效（官方表里的 boolean），
       *   不要因为这一条就顺手把 `autoplay` 也改成 `1` —— 一进页面就出声是另一件事。
       * ⚠️ 也**不要**顺手加 `high_quality` / `as_wide`：它们不在官方表里、
       *   也不在播放器页的 `paramType` 表里（实测同上），今天**完全无效**；
       *   `docs/tracked-embed-spec.md` 里那句把它们记成"实测通过"的话是假记录（已订正）。
       */
      const params = new URLSearchParams({ bvid: videoId, autoplay: '0', danmaku: '1' });
      return `https://player.bilibili.com/player.html?${params.toString()}`;
    }
    default:
      return null;
  }
}

/** 该平台是否支持"从第 N 秒开始"。界面用它决定要不要提示"这个平台不支持跳转"。 */
export function platformSupportsStartOffset(platform: VideoPlatform): boolean {
  return platform === 'youtube' || platform === 'twitch';
}

/** 从链接里解析平台与视频 ID，并给出人能看懂的错误。 */
export function parseVideoLink(url: string): { platform: VideoPlatform; videoId: string } | null {
  return parseVideoUrl(url);
}
