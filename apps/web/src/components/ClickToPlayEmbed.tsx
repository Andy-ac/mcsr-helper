import type { VideoPlatform } from '@mcsr/shared';
import { buildEmbedUrl, formatTimecode, platformSupportsStartOffset } from '@mcsr/shared/videos';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * 「点一下才加载」的嵌入播放器 —— **全站唯一一份实现**。
 *
 * ---------------------------------------------------------------------------
 * 为什么抽出来（这是一个真实的教训）
 * ---------------------------------------------------------------------------
 * 这个门面原先只长在 `VideoEmbed` 里（娱乐视频墙用）。加「资源库的视频资料」
 * 时它需要**第二个**调用点，而那正是"把实现复制一份"最容易发生的一刻。
 * 复制一份之后的典型剧情是：某天修好了其中一份的 `allow` 权限、
 * 或者补上了 B站 不支持跳转的提示，而**另一份没改** ——
 * 于是同一个播放器在两个页面上行为不一样，而且没有任何东西会告诉你。
 *
 * 所以这里只留一份：**要嵌视频就必须走这个组件**。
 *
 * ---------------------------------------------------------------------------
 * 一、为什么默认不挂 iframe，而是先画一个占位
 * ---------------------------------------------------------------------------
 * 一个列表页有几十条。直接把 iframe 全挂上去的后果，**不是"慢一点"**，而是：
 *   · 每个嵌入都是一个完整的第三方文档（播放器 JS + 封面 + 播放统计），
 *     几十个同时开始加载，主线程和网络被它们占满 —— 页面会有十几秒钟
 *     既不能滚动也点不动；
 *   · 更糟的是**失败的样子**：加载不出来的卡片是一片白，和"我们这条数据坏了"
 *     长得一模一样。用户会认为是我们站的问题，而不是第三方慢。
 *   · 还有一件用户看不见但确实发生的事：**每打开一次页面，就向三个平台
 *     各发一次请求**。哪怕他只是路过看一眼。
 * 所以默认状态是一个本地绘制的门面，只有被点过的那一个才真正挂 iframe。
 * 这不是性能优化，是"页面在最坏情况下也得能用"。
 *
 * ---------------------------------------------------------------------------
 * 二、门面上的封面是**可选的**，而且只有"自己有封面"的那条路会传
 * ---------------------------------------------------------------------------
 * 铁律「绝不抓取任何元数据」（shared/videos.ts 文件头）约束的是**用户自贴视频**那条路：
 * 用户只给一个链接，我们承诺不去扒它的标题与封面。⇒ 那条路**永远不传** `coverUrl`，
 * 门面就是今天这个色块（信息只有平台 + 视频 ID + 起始时间）。
 *
 * 而「追踪的博主」那条路**存在的意义就是抓元数据**（`video-tracking-spec.md` §8.1
 * 已经把两条路分开写死），它的封面是适配器抓回来的 URL —— 存的是 URL，不是图片本体，
 * 所以传进来既不违反任何承诺，也不经过我们的服务器。
 * ⚠️ 封面 URL 为 `null` 时**回到色块**，不许画空框或破图边框（spec §5.3）。
 * ⚠️ 门面上的 `<img>` 必须是 `alt=""`（装饰性）：按钮自己带 `aria-label`，
 *    标题就在下面，不该让读屏念两遍。
 * ⚠️★ `referrerpolicy="no-referrer"` 不是可选项：bilibili 的图床按 Referer 白名单放行，
 *    带着我们域名的 Referer 会 **403**（实测，spec §2.4）。
 *
 * ---------------------------------------------------------------------------
 * 三、起始偏移：B站要说实话
 * ---------------------------------------------------------------------------
 * `buildEmbedUrl` 对 B站 会**忽略** startOffsetSec（官方嵌入播放器没有跳转参数），
 * 而忽略是不报错的 —— 播放器只是从 0 开始。用户填了 1:02:33、看到从头发，
 * 他的结论是"这个链接坏了"，而不是"这个平台不支持"。
 * 所以这里在门面上直接写出来。**这句话必须出现在播放发生的地方** ——
 * 表单里的提示他早就滚过去了。
 *
 * ---------------------------------------------------------------------------
 * 四、`children` 是给"兜底出口"用的
 * ---------------------------------------------------------------------------
 * 两个调用点的兜底链接**不一样**，而且不该一样：
 *   · 娱乐视频 → 去原视频页
 *   · 资源库的视频资料 → 就是那条资源的 URL（它可能是个合辑页、也可能带参数）
 * 所以出口由调用方给，这里只负责把它摆在播放器下面。
 */
interface Props {
  platform: VideoPlatform;
  /**
   * 门面上显示的那串标识（视频 ID；直播那行的具体视频 ID）。
   *
   * ⚠️★ **空串 = 门面上不画这一格**（2026-09-14）。
   *    直播卡片的**频道级**嵌入就是这么传的：那里没有一个"属于这条内容"的 ID
   *    （频道本身不是内容），而以前拿来顶替的 `channel.handle` 已经不是给人看的
   *    东西了 —— 它现在是用户贴的链接**解析出来的副产品**（见 LiveCard 的注释）。
   *    注意这个口子和 `src` 是**各管各的**：`src` 给了地址之后，`idLabel`
   *    纯属显示，所以空串不会让谁拿到一个拼坏的 URL。
   */
  idLabel: string;
  /** 播放器的可访问名字应当是"播什么"，而不是装饰性文字。 */
  title: string;
  /** 起始偏移（秒）。B站 不支持，门面上会如实说明。 */
  startOffsetSec: number | null;
  /**
   * 门面上的封面图地址（**可选**）。传了就把封面画在播放三角下面。
   * ⚠️ 只有「追踪的博主」那条路会传（spec §8.1）；`null` 与不传都回到色块。
   */
  coverUrl?: string | null;
  /**
   * 明确的嵌入地址。**给了就用它，不再自己拼**。
   *
   * ⚠️ 这一条是为「直播」的频道级嵌入加的：
   *    YouTube 那条频道嵌入是 `youtube.com/embed/live_stream?channel=<频道ID>`，
   *    而 `buildEmbedUrl` 认的是"平台 + 视频 ID"，拼不出这个形状。
   *
   *    如果为此在 `LiveCard` 里再写一个门面，这次抽取（把两份嵌入实现合成一份）
   *    就白做了 —— 而那正是它要防的事：修好一份、另一份没改。
   *    所以这里开一个口子：**地址可以由调用方给，门面/权限/起始偏移仍然只有一份**。
   *
   *    不传 = 由 `buildEmbedUrl` 按 platform + idLabel 拼（娱乐视频那条路）。
   */
  src?: string | null;
  /** 兜底出口（一个外链）。省略时不渲染。 */
  children?: ReactNode;
}

export function ClickToPlayEmbed({
  platform,
  idLabel,
  title,
  startOffsetSec,
  coverUrl,
  src,
  children,
}: Props) {
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
   *
   * ⚠️ `location` 在 SSR / 脚本环境里可能不存在，所以走 `?.`。
   *    渲染自检就是那种环境，而它在那种环境下必须能跑完 ——
   *    否则"渲染自检"会因为一个和它要验的东西无关的原因失败。
   */
  const origin = globalThis.location?.hostname ?? '';
  const resolved =
    src !== undefined ? src : buildEmbedUrl(platform, idLabel, startOffsetSec, origin);
  const seekable = platformSupportsStartOffset(platform);
  const startAt = startOffsetSec && startOffsetSec > 0 ? startOffsetSec : null;

  return (
    <div className="video-embed">
      <div className="video-embed__frame">
        {active && resolved ? (
          <iframe
            className="video-embed__iframe"
            src={resolved}
            title={title}
            /*
             * allow 是**按平台**给的，不是把三个平台的并集一股脑写上 ——
             * 权限给多了没人会发现，直到某天有人来查"为什么这个页面能拿麦克风"。
             * 三条分别对应**实测验证过**的写法（原验证页 `/embed-test` 已删，
             * 结论留在这里，复现请看 git 历史）。
             */
            allow={
              platform === 'youtube'
                ? 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
                : platform === 'twitch'
                  ? 'autoplay; fullscreen; encrypted-media; picture-in-picture'
                  : undefined
            }
            // Electron 的权限白名单里开了 fullscreen，正是为这一条
            allowFullScreen
            // B站 的旧播放器会按这个属性决定要不要画滚动条
            scrolling={platform === 'bilibili' ? 'no' : undefined}
          />
        ) : (
          <button
            type="button"
            className={`video-embed__facade video-embed__facade--${platform}`}
            /*
             * ⚠️ 把"点下去会加载哪个地址"挂成一个 data 属性。
             *
             *    两个理由，第二个才是主要的：
             *    1. 排查时能直接在开发者工具里看到那个地址，不用点开 Network；
             *    2. **渲染自检才有东西可断言**。静态渲染（`renderToStaticMarkup`）
             *       不会执行点击，所以 iframe 永远不出现 —— 而 iframe 的 `src`
             *       是这里唯一真正的地址。没有这个属性，自检只能断言
             *       "门面在不在"，而那**区分不出**"传对了地址"和
             *       "根本没传、组件自己拼了一个"（两者都会画出可用的门面）。
             */
            data-embed-src={resolved ?? undefined}
            aria-label={`${t('videos.play')}: ${title}`}
            /*
             * ⚠️ 地址为 null 时**不能**渲染播放按钮。
             *    `buildEmbedUrl` 对 Twitch 在没有 origin 时返回 null（宁可不嵌，
             *    也不发一个注定被 parent 校验拒掉的请求）。画一个点了没反应的
             *    按钮，比承认"这里嵌不了"更糟。
             */
            disabled={!resolved}
            onClick={() => setActive(true)}
          >
            <span className="video-embed__badge">{platformLabel(platform, t)}</span>
            {/*
              ★ 封面必须排在**播放三角之前**（DOM 顺序）。理由不是排版，是**绘制层**：
              三角带 `filter`（drop-shadow）⇒ 它自成一层，按 CSS 的绘制顺序落在"定位元素"
              那一层里 —— 与这张绝对定位的图**同层**，而同一层里**靠后的画在上面**。
              ⇒ 把这段 img 挪到三角后面，封面就会把三角盖掉，而门面上"这里可以点"的
              唯一提示正好是那个三角。
              ⚠️ `alt=""` / `loading="lazy"` / `referrerPolicy="no-referrer"` 三样是**契约**
                 （spec §5.3）：装饰性（可访问名在按钮的 `aria-label` 上）、懒加载、
                 以及 bilibili 图床那个 403（`§2.4`：不带 Referer 才是 200）。
            */}
            {coverUrl ? (
              <img
                className="video-embed__cover"
                src={coverUrl}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : null}
            {/* 三角形用 CSS 画，不用 ▶ —— 那个字符不在自托管像素字体的子集里 */}
            {resolved ? <span className="video-embed__playshape" aria-hidden="true" /> : null}
            {/*
              ⚠️★ 标识为**空串时整格不渲染**（2026-09-14）。
              直播卡片的**频道级**嵌入就是这么传的：那里的 `idLabel` 原来放
              `channel.handle`，而 `handle` 已经不是给人看的东西了（见 LiveCard 的注释）。
              留一个空的 `<span>` 会照样占掉一行里的间距 —— 表现是
              "这一块比别的高一点"，而那种不齐没人会认出是 bug。
              ⚠️ 这个判断**只影响显示**：`idLabel` 参与拼 URL 的那条路在
              `resolved` 之前就走完了（`src` 给了就用 `src`），所以给空串不会
              让谁拿到一个拼坏的地址。
            */}
            {idLabel !== '' ? <span className="video-embed__id">{idLabel}</span> : null}
            {startAt !== null ? (
              <span className="video-embed__start">
                {seekable
                  ? t('videos.startFrom', { time: formatTimecode(startAt) })
                  : t('videos.startIgnoredShort')}
              </span>
            ) : null}
            {resolved ? (
              <span className="video-embed__hint">{t('videos.playHint')}</span>
            ) : (
              <span className="video-embed__hint">{t('videos.embedUnavailable')}</span>
            )}
          </button>
        )}
      </div>

      {children}
    </div>
  );
}

/** 平台名走词条，不写死在组件里 —— 界面上不该出现硬编码的可见文字。 */
function platformLabel(platform: VideoPlatform, t: (key: string) => string): string {
  if (platform === 'bilibili') return t('videos.platformBilibili');
  if (platform === 'youtube') return t('videos.platformYoutube');
  return t('videos.platformTwitch');
}
