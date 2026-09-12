import { parseVideoUrl } from '@mcsr/shared';
import { useTranslation } from 'react-i18next';
import { ClickToPlayEmbed } from '@/components/ClickToPlayEmbed';
/**
 * 资源库里「视频资料」条目的播放器。
 *
 * ---------------------------------------------------------------------------
 * 它为什么不是 `VideoEmbed` 的又一个副本
 * ---------------------------------------------------------------------------
 * 两者的**数据形状不一样**：
 *   · 娱乐视频：库里存的是 `platform` + `videoId`（贴链接时就解析好并校验过）
 *   · 资源库条目：库里只有一个 `url`（那是一条普通资源，可能是任何链接）
 *
 * 所以这里多一步"**这个 url 到底能不能当视频播**"的判断。而那一步的结果
 * 有三种，且**第三种必须能优雅退化**：
 *   1. 能解析 → 嵌播放器
 *   2. 不能解析 → **什么都不渲染**（外层继续显示那条普通外链）
 *
 * ⚠️ 第 2 种是最容易做错的：如果不能解析时仍然渲染播放器的**外壳**，
 *    用户看到的是一个**空白的播放器框** —— 而它看起来像"我们的播放器坏了"，
 *    实际情况是"这条资源本来就不是视频"。所以解析失败一律返回 null，
 *    让调用方老老实实按普通资源渲染。
 *
 * ⚠️ 也**不做**"猜"：不去看标题里有没有"视频"、不去看域名像不像视频站。
 *    猜错的代价就是上面那个空框，而它比"没有播放器"糟得多。
 */
export function ResourceVideoEmbed({
  url,
  title,
}: {
  /** 资源条目的 URL。调用方负责只在 `kind === 'video'` 时才渲染这个组件。 */
  url: string;
  title: string;
}) {
  const { t } = useTranslation();

  const parsed = parseVideoUrl(url);
  if (!parsed) return null;

  /*
   * ⚠️ 外面**没有**标题行（比如"嵌入式播放"）。
   *    门面自己已经写着平台 + 视频 ID + "点一下播放"，再加一行是在重复；
   *    而且这一行要加词条，就得往 `resources.*` 那一节里插 ——
   *    这一轮的词条只能落在 `live` / `liveManage` / `enterVideo` 三节里。
   *    与其塞错命名空间，不如不加：播放器自己说得够清楚。
   */
  return (
    <div className="resource-video">
      <ClickToPlayEmbed
        platform={parsed.platform}
        idLabel={parsed.videoId}
        title={title}
        /*
         * ⚠️ 起始偏移**不传**（null）。
         *
         *    资源库的 URL 里可能带 `&t=90`，但我们**不解析它** ——
         *    解析 URL 上的时间参数要为每个平台写一套规则（YouTube 有 `t`/`start`、
         *    B站 有 `t`、Twitch 有 `t`），而写错的后果正是这个组件要避免的
         *    "界面说跳转了、播放器没跳"。所以宁可从这个视频的开头播，
         *    并且把"去原站看"那条链接留在下面 —— 那里会带上用户原来的参数。
         */
        startOffsetSec={null}
      >
        {/*
          兜底出口指向**用户自己贴的那个 URL**，不是我们拼的规范链接 ——
          它可能带时间参数、可能指向合辑。丢掉用户给的东西是另一种撒谎。
        */}
        <a
          className="video-embed__out"
          href={url}
          target="_blank"
          rel="noopener noreferrer nofollow"
        >
          {t('videos.openOriginal')}
        </a>
      </ClickToPlayEmbed>
    </div>
  );
}
