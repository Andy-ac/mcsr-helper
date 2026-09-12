import type { VideoPlatform } from '@mcsr/shared';
import {
  buildEmbedUrl,
  formatTimecode,
  platformSupportsStartOffset,
  type Video,
} from '@mcsr/shared/videos';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * 视频嵌入框 —— 一个"点一下才加载"的门面。
 *
 * ---------------------------------------------------------------------------
 * 一、为什么默认不挂 iframe，而是先画一个占位
 * ---------------------------------------------------------------------------
 * 视频墙默认一页 24 条（DEFAULT_PAGE_SIZE）。直接把 24 个 iframe 挂上去的
 * 后果，**不是"慢一点"**，而是：
 *   · 每个嵌入都是一个完整的第三方文档（播放器 JS + 封面 + 播放统计），
 *     24 个同时开始加载，主线程和网络被它们占满 —— 页面会有十几秒钟
 *     既不能滚动也点不动；
 *   · 更糟的是**失败的样子**：加载不出来的卡片是一片白，和"我们这条数据坏了"
 *     长得一模一样。用户会认为是我们站的问题，而不是第三方慢。
 *   · 还有一件用户看不见但确实发生的事：**每打开一次视频墙，就向三个平台
 *     各发一次请求**。哪怕他只是路过看一眼列表。
 * 所以默认状态是一个本地绘制的门面，只有被点过的那一个才真正挂 iframe。
 * 这不是性能优化，是"页面在最坏情况下也得能用"。
 *
 * ---------------------------------------------------------------------------
 * 二、门面上为什么没有封面图
 * ---------------------------------------------------------------------------
 * 因为铁律：**绝不抓取任何元数据**（见 shared/videos.ts 文件头）。
 * 封面图 URL 必须从平台的接口或页面上取，那正是我们承诺不做的事。
 * 用第三方图床直接拼 `i.ytimg.com/vi/<id>/...` 也算数 —— 那是把
 * "每次渲染都向 YouTube 发一次请求"写进了组件，而且它同样会失败（私享/删除的视频）。
 * 所以这里用版块自己的配色画一个方块，信息只有**平台 + 视频 ID + 起始时间**，
 * 这三样都是我们自己库里就有的、不需要请求任何人的数据。
 *
 * ---------------------------------------------------------------------------
 * 三、起始偏移：B站要说实话
 * ---------------------------------------------------------------------------
 * `buildEmbedUrl` 对 B站会**忽略** startOffsetSec（官方嵌入播放器没有跳转参数），
 * 而忽略是不报错的 —— 播放器只是从 0 开始。用户填了 1:02:33、看到从头发，
 * 他的结论是"这个链接坏了"，而不是"这个平台不支持"。
 * 所以这里在门面上直接写出来。**这句话必须出现在播放发生的地方** ——
 * 提交表单里的提示他早就滚过去了。
 */
export function VideoEmbed({ video }: { video: Video }) {
  const { t } = useTranslation();
  const [active, setActive] = useState(false);

  /*
   * Twitch 的 `parent` 是**按域名校验**的，所以必须是真实的那个域名。
   *
   * ⚠️ 用 `location.hostname` 而不是 shared 里的 productionOrigin：
   *    开发时它得是 localhost，线上它自然就是 mcsrhelper.com。
   *    两种运行形态都对 —— Electron 壳走的是 `win.loadURL(远程站点)`，
   *    不是 file://，所以那里的 origin 也是 https://mcsrhelper.com
   *    （见 docs/m4-decisions.md §6.1）。
   */
  const origin = globalThis.location?.hostname ?? '';
  const src = buildEmbedUrl(video.platform, video.videoId, video.startOffsetSec, origin);
  const seekable = platformSupportsStartOffset(video.platform);
  const startAt = video.startOffsetSec && video.startOffsetSec > 0 ? video.startOffsetSec : null;

  return (
    <div className="video-embed">
      <div className="video-embed__frame">
        {active && src ? (
          <iframe
            className="video-embed__iframe"
            src={src}
            title={video.title}
            /*
             * allow 是按平台给的，不是把三个平台的并集一股脑写上 ——
             * 权限给多了没人会发现，直到某天有人来查"为什么这个页面能拿麦克风"。
             * 三条分别对应 EmbedTest.tsx 里已经验证过的写法。
             */
            allow={
              video.platform === 'youtube'
                ? 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
                : video.platform === 'twitch'
                  ? 'autoplay; fullscreen; encrypted-media; picture-in-picture'
                  : undefined
            }
            // Electron 的权限白名单里开了 fullscreen，正是为这一条
            allowFullScreen
            // B站的旧播放器会按这个属性决定要不要画滚动条
            scrolling={video.platform === 'bilibili' ? 'no' : undefined}
          />
        ) : (
          <button
            type="button"
            className={`video-embed__facade video-embed__facade--${video.platform}`}
            /*
             * 门面上的可见文字是"平台 + ID + 提示"，读屏软件念出来是长长一串。
             * 给一个短名字（"播放：<标题>"）—— 播放按钮的可访问名字应当是
             * **播什么**，而不是它的装饰性文字。
             */
            aria-label={`${t('videos.play')}: ${video.title}`}
            /*
             * ⚠️ src 为 null 时**不能**渲染播放按钮。
             *    buildEmbedUrl 对 Twitch 在没有 origin 时返回 null（宁可不嵌，
             *    也不发一个注定被 parent 校验拒掉的请求）。画一个点了没反应的
             *    按钮，比承认"这里嵌不了"更糟。
             */
            disabled={!src}
            onClick={() => setActive(true)}
          >
            <span className="video-embed__badge">{platformLabel(video.platform, t)}</span>
            {/* 三角形用 CSS 画，不用 ▶ —— 那个字符不在自托管像素字体的子集里 */}
            {src ? <span className="video-embed__playshape" aria-hidden="true" /> : null}
            <span className="video-embed__id">{video.videoId}</span>
            {startAt !== null ? (
              <span className="video-embed__start">
                {seekable
                  ? t('videos.startFrom', { time: formatTimecode(startAt) })
                  : t('videos.startIgnoredShort')}
              </span>
            ) : null}
            {src ? (
              <span className="video-embed__hint">{t('videos.playHint')}</span>
            ) : (
              <span className="video-embed__hint">{t('videos.embedUnavailable')}</span>
            )}
          </button>
        )}
      </div>

      {/*
        原站链接是**兜底出口**，不是装饰：B站的官方播放器在桌面 WebView 里
        是三个平台里最不确定的一个（EmbedTest.tsx 已记录），而 CSP / Electron
        对 Twitch 还有一条已知陷阱。嵌入失败时用户需要一个能走的路。
      */}
      <a
        className="video-embed__out"
        href={watchUrl(video.platform, video.videoId)}
        target="_blank"
        rel="noopener noreferrer nofollow"
      >
        {t('videos.openOriginal')}
      </a>
    </div>
  );
}

/** 平台名走词条，不写死在组件里 —— 界面上不该出现硬编码的可见文字。 */
function platformLabel(platform: VideoPlatform, t: (key: string) => string): string {
  if (platform === 'bilibili') return t('videos.platformBilibili');
  if (platform === 'youtube') return t('videos.platformYoutube');
  return t('videos.platformTwitch');
}

/**
 * 「去原站看」的链接。
 *
 * ⚠️ 为什么这里可以自己拼，而**嵌入** URL 必须放在 shared：
 *    嵌入 URL 的参数规则（Twitch 的 parent、B站没有跳转参数、YouTube 的 start）
 *    错了**不报错** —— 页面里就是一个白框，看起来像网络问题。那种东西必须被
 *    单元测试盖住，所以它住在 shared/videos.ts。
 *    而这条只是一个普通的跳转链接：错了会 404，用户立刻看得见，不会静默失效。
 *    它也只出现在这一个文件里（不存在第二份要同步的副本）。
 */
function watchUrl(platform: VideoPlatform, videoId: string): string {
  const id = encodeURIComponent(videoId);
  switch (platform) {
    case 'bilibili':
      return `https://www.bilibili.com/video/${id}`;
    case 'youtube':
      return `https://www.youtube.com/watch?v=${id}`;
    default:
      return `https://www.twitch.tv/videos/${id}`;
  }
}
