import {
  type LiveChannel,
  liveChannelHref,
  liveEmbedUnavailableReason,
  liveEmbedUrl,
} from '@mcsr/shared/live';
import { useTranslation } from 'react-i18next';
import { ClickToPlayEmbed } from '@/components/ClickToPlayEmbed';

/**
 * 直播清单里的一张卡 —— **一个频道**，不是一场直播。
 *
 * ---------------------------------------------------------------------------
 * 这一张卡上最要紧的一件事：**不撒谎**
 * ---------------------------------------------------------------------------
 * 我们**不检测直播状态**（没有 API key，也不轮询）。所以这里：
 *   · 没有「直播中」标记 —— 加了它就得有人维护它的真假，而"某人没开播
 *     界面却显示他在播"是用户一周之内就会发现的谎；
 *   · 有播放器的时候，播的是**频道级嵌入**或一个具体的视频 ID，
 *     两者都不是"我们现在确认他正在播"；
 *   · 没有播放器的时候，**说清楚为什么没有**，而不是留一个空框。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 三种"嵌不出来"必须分开说
 * ---------------------------------------------------------------------------
 * `liveEmbedUnavailableReason` 把三种情况分开了，而**第三种最要紧**：
 * 编辑打开了「用频道嵌入」，但标识写的是 `@handle` 而不是 `UC...` 频道 ID ——
 * 那时那个开关**永远不生效**。界面上如果只有一句笼统的"不支持嵌入"，
 * 它就是一个"设置了却没反应的开关"，而这是最难排查的一类问题：
 * 编辑会以为界面坏了，反复开关、反复保存，什么都改变不了。
 *
 * ---------------------------------------------------------------------------
 * 平台徽章用的是 `videos.platform*`
 * ---------------------------------------------------------------------------
 * 两个板块（娱乐视频、直播）说的是同一批平台，词条没必要各写一份 ——
 * 各写一份之后，某天改了一处就会留下两个写法。
 */
export function LiveCard({ channel }: { channel: LiveChannel }) {
  const { t } = useTranslation();

  /*
   * `origin` 是 Twitch 的 `parent` 需要的东西；YouTube 用不上。
   * 保留它是为了"将来支持 Twitch 时不必改调用点"（见 shared/live.ts）。
   * ⚠️ `location` 在 SSR / 脚本环境里不存在，所以 `?.`。
   */
  const origin = globalThis.location?.hostname ?? '';
  const embedUrl = liveEmbedUrl(channel, origin);
  const reason = liveEmbedUnavailableReason(channel);
  /*
   * ⚠️ 2026-09-13 改成 `liveChannelHref`：它**优先指向那一场直播的视频**，
   *    只有在没有视频 ID 时才退回频道页。原来的 `liveChannelUrl` 无条件拼频道页 ——
   *    于是给 YouTube 那行填了视频 ID 之后，播放器能播、而"去原频道看"是一条死链
   *    （`youtube.com/channel/MCSR_Ranked`，`/channel/` 只认 UC… 的 ID）。
   *    这是用户实测发现的，判据写在 `liveChannelHref` 的注释里。
   */
  const channelUrl = liveChannelHref(channel);

  return (
    <li className={`live-card${channel.status === 'hidden' ? ' live-card--hidden' : ''}`}>
      <div className="live-card__head">
        <h2 className="live-card__name">{channel.displayName}</h2>
        <span className="badge badge--kind">
          {t(`videos.platform${platformKey(channel.platform)}`)}
        </span>
        {channel.status === 'hidden' ? (
          <span className="badge badge--hidden">{t('liveManage.hiddenBadge')}</span>
        ) : null}
      </div>

      {channel.note ? <p className="live-card__note">{channel.note}</p> : null}

      {/*
        标签（2026-09-13）。⚠️ 空数组时**一个节点都不渲染**（不是渲染一个空容器）：
        空容器会吃掉 `--gap` 那点间距，表现是"这一行比别的高一点"，
        而那种一像素级的不齐最难被认出是 bug。
      */}
      {channel.tags.length > 0 ? (
        <ul className="live-card__tags">
          {channel.tags.map((tag) => (
            <li key={tag} className="tagchip tagchip--static">
              {tag}
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        ⚠️ 只在**真的有地址**时才渲染播放器。
        返回 null 的那三种情况走下面那行解释 —— 留一个空框会看起来像我们坏了。

        ⚠️ 频道级嵌入那条地址由 `liveEmbedUrl` 给：`buildEmbedUrl` 拼不出
        `live_stream?channel=` 这个形状，所以走 `src` 覆盖（见 ClickToPlayEmbed）。
      */}
      {embedUrl ? (
        <ClickToPlayEmbed
          platform={channel.platform}
          idLabel={channel.liveVideoId?.trim() ? channel.liveVideoId.trim() : channel.handle}
          title={channel.displayName}
          startOffsetSec={null}
          src={embedUrl}
        />
      ) : (
        <p className="live-card__noembed">{t(noEmbedKey(reason))}</p>
      )}

      {/*
        频道链接**永远**在（有播放器的时候也在）。
        播放器可能失败 —— 第三方、CSP、网络，任何一样都会让那一块变成空白，
        而那时用户需要一个能走的路。这和 `VideoEmbed` 里那条"去原站看"同理。
        标识一起显示出来：它是这张卡上唯一能核对的客观信息。
      */}
      <div className="live-card__foot">
        <a
          className="cta live-card__link"
          href={channelUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
        >
          {t('live.gotoChannel')}
        </a>
        <span className="live-card__handle">{channel.handle}</span>
      </div>
    </li>
  );
}

/** 平台名 → `videos.*` 那个 key 的后半段。 */
function platformKey(platform: LiveChannel['platform']): string {
  if (platform === 'youtube') return 'Youtube';
  if (platform === 'twitch') return 'Twitch';
  return 'Bilibili';
}

/**
 * "为什么没有播放器" → 词条 key。
 *
 * ⚠️ 刻意写成穷尽的映射，而不是一串三元式：每种理由各自对应的文案是
 * **产品决定**，不是兜底。少写一种时 `Record` 会编译不过，
 * 而那正是我们要的 —— 有一次兜底，就会有一种情况被默默说成另一种。
 *
 * ★ 四种（t24 从三种变四种）：`bilibili_blocked` 是**加进来的**那一种，
 *   在它之前 B站 被归并进通用的 `platform`。
 */
function noEmbedKey(reason: ReturnType<typeof liveEmbedUnavailableReason>): string {
  const KEYS: Record<'platform' | 'bilibili_blocked' | 'no_id' | 'not_channel_id', string> = {
    /*
     * ⚠️ `platform` 是**通用**那句（"这个平台在这里不能嵌入播放"），它服务
     * `'no_origin'` 那一档；**B站 有自己的一句**，别说反了。
     */
    platform: 'live.noEmbedPlatform',
    /*
     * ★ B站 确定态（`x-frame-options: SAMEORIGIN`，平台自己禁止被嵌）。
     * 这一格是 t24 加的：`live.noEmbedBilibili` 在此之前**没有任何代码引用**，
     * 而这一档以前被归并进 `platform` ⇒ 界面只说"这个平台不能嵌入"，
     * **没说清是哪种**。加了这一格才有专属那句。
     */
    bilibili_blocked: 'live.noEmbedBilibili',
    no_id: 'live.noEmbedNoId',
    not_channel_id: 'live.noEmbedNotChannelId',
  };
  /*
   * `reason` 为 null 意味着"其实能嵌"，那就不该走到这里（调用方只在
   * `embedUrl` 为 null 时才渲染这一段）。真走到时用 `no_id` ——
   * 三种里最中性的一条，而**不会**去说"平台不支持"那种更具体的错话。
   */
  return KEYS[reason ?? 'no_id'];
}
