import type { Video } from '@mcsr/shared/videos';
import { useTranslation } from 'react-i18next';
import { ClickToPlayEmbed } from '@/components/ClickToPlayEmbed';

/**
 * 娱乐视频墙上的一张卡的播放器。
 *
 * ⚠️ 这里**只**负责"这一条的视频该去哪儿看"这件事：
 *    门面、iframe、平台权限、起始偏移的实话，全在 `ClickToPlayEmbed` 里。
 *    真正驱动这次抽取的原因是资源库那边也要嵌视频 —— 两个调用点共用一份实现，
 *    才不会出现"修好了其中一个"那种问题（见 ClickToPlayEmbed 的文件头）。
 */
export function VideoEmbed({ video }: { video: Video }) {
  const { t } = useTranslation();

  return (
    <ClickToPlayEmbed
      platform={video.platform}
      idLabel={video.videoId}
      title={video.title}
      startOffsetSec={video.startOffsetSec}
    >
      {/*
        原站链接是**兜底出口**，不是装饰：B站 的官方播放器在桌面 WebView 里
        是三个平台里最不确定的一个（**实测记录**在案，原验证页已删），而 CSP / Electron
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
    </ClickToPlayEmbed>
  );
}

/**
 * 「去原站看」的链接。
 *
 * ⚠️ 为什么这里可以自己拼，而**嵌入** URL 必须放在 shared：
 *    嵌入 URL 的参数规则（Twitch 的 parent、B站 没有跳转参数、YouTube 的 start）
 *    错了**不报错** —— 页面里就是一个白框，看起来像网络问题。那种东西必须被
 *    单元测试盖住，所以它住在 shared/videos.ts。
 *    而这条只是一个普通的跳转链接：错了会 404，用户立刻看得见，不会静默失效。
 *
 * ★ 2026-09-16（T7）：它**导出**了，因为「追踪的博主」那一栏的卡片也要"去原站看"
 *   （`components/TrackedVideos.tsx`）。原来这里写的是"它只出现在这一个文件里
 *   （不存在第二份要同步的副本）"—— 那份保证现在由**共用**来维持，而不是由"只有
 *   一个调用点"维持：抄第二份的话，三条地址形状就有了两个会各自漂开的定义，
 *   而漂开的表现是某一种来源的链接 404，且没有任何门禁看得见。
 */
export function watchUrl(platform: Video['platform'], videoId: string): string {
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
