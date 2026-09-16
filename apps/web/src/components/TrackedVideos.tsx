import type { TrackedCreator, TrackedVideo, TrackPlatform } from '@mcsr/shared/tracking';
import { TRACK_PLATFORMS, toMillis } from '@mcsr/shared/tracking';
import { formatTimecode } from '@mcsr/shared/videos';
import { useTranslation } from 'react-i18next';
import { ClickToPlayEmbed } from '@/components/ClickToPlayEmbed';
import { Field, Notice } from '@/components/Form';
import { watchUrl } from '@/components/VideoEmbed';

/**
 * 「追踪的博主」—— `/videos` 页上的那一块（**两个只吃 props 的纯视图**）。
 *
 * ===========================================================================
 * 为什么是**两个纯视图**，而不是让 `routes/Videos.tsx` 自己写这几块界面
 * ===========================================================================
 * 本仓铁律（spec §6.2，`docs/pending.md` 反复记着）：`renderToStaticMarkup`
 * **不跑 effect**、不点击、不发请求 —— 界面写在**页面**里就**断言不到**
 * （页面永远停在 loading/空态，为它写的断言退化成恒真）。
 * ⇒ 取数、分页、能力判断、两次点击之间的状态**全在页面那一层**；
 *   这一层只回答"给我这些 props，画成什么样"，于是 `apps/web/scripts/videorender.tsx`
 *   能把每一个状态都渲染一遍并逐条断言。
 * ⚠️ 两个组件都**没有 `useState` / `useEffect` / 取数**：连"正在等确认的是哪一行"
 *   和"输入框里现在是什么"都是 props（页面持有）—— 组件里存一份状态就意味着
 *   那个状态**在静态渲染里永远不会变**，于是它对应的界面分支谁也断言不到。
 *
 * ===========================================================================
 * ★★ 时间：两处都**必须**经 `toMillis`（spec §4 那个 ★★ 块的裁决）
 * ===========================================================================
 * `tracked_videos.published_at` 与 `tracked_creators.last_synced_at` 都是 **Unix 秒**
 * （上游 bilibili 的 `created` 就是秒），而 `Date` / `Intl` 要的是**毫秒**。
 * ⇒ 裸的 `new Date(v.publishedAt)`（或 `Date.now() - v.publishedAt`）**是一条真缺陷**：
 *   少乘 1000，显示出来是 **1970 年**，而类型检查拦不住它（两边都是 `number`）。
 *   `toMillis()` 是这两张表唯一被允许跨单位的地方（`packages/shared/src/tracking.ts`），
 *   而**本文件是它的第一个生产调用者** ⇒ 下面那两个小函数是这一页唯一的转换点。
 * ⚠️ `null` 一律显示成 `—`，**不显示成 0**：0 毫秒是 1970-01-01，看起来像一条真实数据。
 *
 * ===========================================================================
 * ★★ 空的计量格显示 `—`，**绝不显示 0**（本仓既有纪律）
 * ===========================================================================
 * `publishedAt` / `durationSec` / `viewCount` / `commentCount` 四个字段**都可能是 null**
 * （上游没给、或者这一轮没回这个字段）。把它们渲染成 `0` 是一个**看起来像数据的谎**：
 * "这支视频没人看"与"这个平台这一轮没回播放量"在界面上一模一样，而后者是
 * **接口悄悄变了**的信号（spec §4.2 那条"拿不到的字段一律 NULL，不许填 0"）。
 * ⇒ 本文件里那几处都是"null ⇒ `—`"，而渲染自检的第一条断言正是这件事
 *   （喂一个四个字段全 null 的夹具 ⇒ 页面上**一个 `0` 都不许出现**）。
 *
 * ===========================================================================
 * 卡片上的六个字段（用户裁决 R4）
 * ===========================================================================
 * 标题 / 封面 / 发布时间 / 时长 / 播放量 / 评论数 —— 就是这六个，一个不多一个不少。
 * ⚠️ 封面必须有 `loading="lazy"` 与固定宽高比（16:9，写在 CSS 里）：一屏几十张图
 *   一起加载会把首屏拖慢，而比例不固定的图片到达时会让每一行重排。
 * ⚠️ `thumbnailUrl` 为 null 时**不渲染 `<img>`**（而不是 `src=""`）：
 *   `src=""` 会让浏览器去请求**当前页面**，一次请求换来一张碎图。
 *
 * ===========================================================================
 * ★ 空的列表与**没取到的列表**是两件事（两栏**同一条纪律**）
 * ===========================================================================
 * 两栏各有自己的三态：正在取数 / 取数失败 / 正常（空或非空），而失败**不许**折进"空"。
 * 折了的话界面会说一句**假话**，并且把人引向一个必然失败的动作：
 *   · 公开列表会说"还没有追踪到视频"（其实列表不是空的，是没取到）；
 *   · 管理面板会说"名单还是空的 —— 在上面贴一个博主的链接"，而编辑照着贴的那条链接
 *     **已经在名单上**，再贴一次只会拿到 `duplicate`（`tracked.errDuplicate`）。
 * ⇒ 两个组件都把三态**分开吃 props**（面板那一格叫 `loadError`，不叫 `error`：
 *   它说的是"这张表没读到"，与"我刚才那一下失败了"是两个不同的问题），
 *   渲染自检对两栏各断言一次"取数失败时**没有**空态那一块"。
 */

/** 没有值的那一格 —— 全仓的约定（`CalendarDetail` / `SeedResultCard` 都是它）。 */
const DASH = '—';

/**
 * 平台名 → 词条 key。**复用视频墙那同一批**（`videos.platform*`）—— 同一个平台不该有两个名字。
 *
 * ⚠️ 键的类型写成 `Record<TrackPlatform, string>` 而不是 `Record<string, string>`：
 *    前者在加第四个平台时**当场编译失败**，后者会静默漏掉一格，而那一格的表现是
 *    卡片上印出**裸 key**（`videos.platformXxx`）—— 只有那个平台真有视频时才看得见。
 */
const PLATFORM_KEYS: Record<TrackPlatform, string> = {
  bilibili: 'videos.platformBilibili',
  youtube: 'videos.platformYoutube',
  twitch: 'videos.platformTwitch',
};

/**
 * 三个标签 → 词条 key（spec §4.3 冻结的那三个）。
 *
 * ⚠️ 表里**没有**的标签按原样显示（见 `tagLabel`）：这一列由抓取那一侧派生，
 *    哪天多派生一个，界面要**看得见它**而不是把它悄悄吞掉 —— 少一个标签没人会发现，
 *    而"界面上少一格"与"数据里没有"在产物里长得一模一样。
 */
const TAG_KEYS: Record<string, string> = {
  liveReplay: 'tracked.tagLiveReplay',
  short: 'tracked.tagShort',
  long: 'tracked.tagLong',
};

/** 标签 → 显示文字（认不出来的原样显示，理由见 `TAG_KEYS`）。 */
function tagLabel(tag: string, t: (key: string) => string): string {
  const key = TAG_KEYS[tag];
  return key === undefined ? tag : t(key);
}

/**
 * Unix **秒** → 本地日期串（**唯一的换算点**，见文件头）。
 *
 * ⚠️ 导出只为了一件本仓反复吃过亏的事：`apps/web` 没有测试运行器，
 *    `apps/web/scripts/videorender.tsx` 是这一页唯一的断言执行者 ——
 *    "0 秒会不会被当成'没有值'（它渲染出来的是**纪元那一刻**，UTC 以东是 1970、
 *    以西是 1969 —— 所以那条断言**不许**写死年份）/ null 是不是 `—`"这两条要能**直接**问它，
 *    而不是只能靠产物里有没有 `1970` 去猜（`RANKED_ERROR_KEYS` 是同一处置）。
 * ⚠️ `locale` 是**必填**参数（由调用点传 `i18n.language`）：不传时 `toLocaleDateString()`
 *    跟的是**宿主机器**的 locale ⇒ 中文系统上的英文界面会印出中文日期，而两种语言
 *    各渲染一遍的渲染自检**都看不出来**（两遍跑在同一台机器上，看到的是同一个错误）。
 *    这一条是 `RankedPanels.tsx` 上那段注释的同一件事，那边为它写过完整的一段。
 */
export function localDate(sec: number | null, locale: string): string {
  const ms = toMillis(sec);
  return ms === null ? DASH : new Date(ms).toLocaleDateString(locale);
}

/** 同上，带时刻 —— 「上次同步」要看得到是哪天的几点（与 `localDate` 同一处换算）。 */
export function localDateTime(sec: number | null, locale: string): string {
  const ms = toMillis(sec);
  return ms === null ? DASH : new Date(ms).toLocaleString(locale);
}

/**
 * 公开分区。
 *
 * ⚠️ props 全部**必填**（`empty` / `error` / `loading` 都是）：
 *    · `empty` 是**页面**给的那一句空态说明 —— 只有页面知道"为什么是空的"
 *      （一条视频都还没抓到 / 名单上一个人都还没有）。写在组件里的话那一句话就没法
 *      按处境换，而"空的时候说一句准话"正是 spec §6.2 的要求。
 *    · `error` **必须**有：没有它，取数失败会渲染成"还没有追踪到视频" —— 一句**假话**
 *      （列表不是空的，是没取到）。这与"空态不许是空白"是同一条纪律的两面。
 *    · `loading` 同理：加载中显示空态也是一句假话。
 * ⚠️ 少传一个 prop 在**这里看不出任何异常**（SSR 不渲染事件处理器，少一个 `onPage`
 *    与接好线的产物逐字节相同）⇒ 渲染自检有一道**运行时**守卫
 *    （`videorender.tsx` 的 `assertPropsGiven`），因为 `scripts/**` 不受类型检查。
 */
export interface TrackedVideosSectionProps {
  items: TrackedVideo[];
  total: number;
  page: number;
  pageSize: number;
  /**
   * 「全部」那一档空列表时显示的那一句话（页面给 —— 只有它知道为什么是空的）。
   *
   * ⚠️★ 它管的是**没有选分区**那一档（T8）：选了某个分区、而那个分区里一条都没有时，
   *    空的是另一件事，说的也是**另一句话**（`tracked.emptyPlatform`，见组件里
   *    `emptyTitle` 那一段）。页面照旧只传「全部」那一句 —— 分区那一句的判据
   *    （`platform !== undefined` 且 `items` 是空的）就在**组件手里的两个 prop** 上，
   *    页面再判一次就是第二份口径，而两份口径迟早会漂。
   */
  empty: string;
  /** 正在取数。⚠️ 与"空列表"是两件事，**不许**合并。 */
  loading: boolean;
  /** 取数失败的那一句话；`null` = 没出错。 */
  error: string | null;
  /**
   * 当前分区（`undefined` = 全部）。
   *
   * ⚠️★ 它只影响**取数**（服务端筛选，spec §5.1），组件自己是纯的：分区**不在这里**
   *    过滤 `items` —— 在界面里再筛一次就是第二份"什么算这个分区"，而两份口径一旦
   *    漂移，表现是"分页器说共 40 条、列表里却只有 3 条"（`total` 是服务端给的）。
   * ⚠️ 它由页面从 URL 读出来（`?tplatform=`），组件**不读地址栏**：这一层只回答
   *    "给我这些 props，画成什么样"（文件头那一段）。
   */
  platform: TrackPlatform | undefined;
  /** 换分区。⚠️ 必填 —— 少传它 = 四个按不动的按钮。 */
  onPlatformChange: (platform: TrackPlatform | undefined) => void;
  /** 翻页。⚠️ 必填 —— 见上面那段（少传它 = 一个按不动的分页器）。 */
  onPage: (page: number) => void;
}

/**
 * 「追踪的博主」那一块（公开列表）。
 *
 * ⚠️ 这一块**在 `/videos` 页上**（用户裁决 R1），但它是**独立的一栏**：
 *    它与上面那面"大家自己贴的视频"墙没有关系（spec §8.1：两张表、两条路），
 *    所以它有自己的标题、自己的分页、自己的空态，字面上也不共用那面墙的词条。
 */
export function TrackedVideosSection({
  items,
  total,
  page,
  pageSize,
  empty,
  loading,
  error,
  platform,
  onPlatformChange,
  onPage,
}: TrackedVideosSectionProps) {
  const { t, i18n } = useTranslation();
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  /*
   * ★★ 空态那一句话：**选了分区**的时候不是页面给的那一句（T8，spec §5.4 那四个按钮）。
   *
   * ⚠️★ 为什么必须分开说：`tracked.emptyHint`（下面第二句）把空的原因说成"名单上的博主
   *    还没有抓到 / 抓取每 10 分钟跑一轮"。在**某一个分区**里空，原因常常是
   *    **名单上连这个平台的博主都没有**（今天三个平台里有两个就是这样）——
   *    照原样说的话，用户会去等抓取，而抓取永远不会把一个**不在名单上**的博主抓回来。
   * ⚠️ 所以分区里换一句（`tracked.emptyPlatform`，它自己把两种原因都写清楚），
   *    并且**不画第二句**：那一句正是要修正的那件事。
   * ⚠️ 判据在这一层而不是页面：`platform` 与 `items` 都是本组件手里的 prop，
   *    "这个分区里一条都没有"由它们一起决定（理由见 `empty` 那格 prop 的说明）。
   * ⚠️ 它**不影响**取数：分区仍然只由服务端筛（上面那段说明），这里换的是一句话。
   */
  const emptyTitle = platform === undefined ? empty : t('tracked.emptyPlatform');

  return (
    <section className="tracked" aria-labelledby="tracked-title">
      <h2 className="tracked__title" id="tracked-title">
        {t('tracked.title')}
      </h2>
      <p className="tracked__sub">{t('tracked.subtitle')}</p>

      {/*
        ★★ 分区按钮（T7，spec §5.2）—— **照抄上面那面墙**（`routes/Videos.tsx` 那个
        `tagcloud`）：同一套类名（`tagcloud` / `tagcloud__label` / `tagchip` / `tagchip--on`）、
        同样的四个按钮、平台名走 `videos.platform*` 同一批词条。**不新增 CSS**。

        ⚠️★ 它排在**三态之外**（不跟着列表空 / 失败 / 加载中一起消失）：
           这正是分区最需要出现的时候 —— 在"Twitch 分区里一条都没有"那一屏上，
           四个按钮是用户**唯一**能退回「全部」的出口；把它们跟空态一起藏起来，
           表现就是"点进去之后这一栏什么都没有，而且退不回来"。
        ⚠️ 「全部」那一颗在 `platform === undefined` 时带 `--on`（与那面墙逐字同形）：
           「当前什么都没筛」也要看得出来，否则四个按钮都不亮，看起来像没选中任何一项。
        ⚠️ 平台名走 `PLATFORM_KEYS`（本文件上面那张表），**不在这里写第二份** ——
           同一个平台两个名字正是它当初被抽出来的原因。
      */}
      <div className="tagcloud">
        <span className="tagcloud__label">{t('videos.allPlatforms')}</span>
        <button
          type="button"
          className={`tagchip${platform === undefined ? ' tagchip--on' : ''}`}
          onClick={() => onPlatformChange(undefined)}
        >
          {t('videos.allPlatforms')}
        </button>
        {TRACK_PLATFORMS.map((p) => (
          <button
            key={p}
            type="button"
            className={`tagchip${platform === p ? ' tagchip--on' : ''}`}
            onClick={() => onPlatformChange(p)}
          >
            {t(PLATFORM_KEYS[p])}
          </button>
        ))}
      </div>

      {loading ? <p className="state">{t('common.loading')}</p> : null}

      {error === null ? null : (
        <div className="state state--error">
          <p>{error}</p>
        </div>
      )}

      {!loading && error === null && items.length === 0 ? (
        /*
         * 空态是**一句陈述**，不是一块空白（本仓纪律：空白看起来像坏了）。
         * ⚠️ 「全部」那一档是**两句话**：第一句由页面给（"还没有追踪到视频"），第二句是
         *    这一栏的说明（这些视频由服务器定时抓、名单由编辑维护）—— 少了第二句，
         *    访客会以为这一栏坏了，或者以为我们漏掉了他的视频。
         * ⚠️★ 而**分区**那一档只有一句（`emptyTitle` = `tracked.emptyPlatform`）：
         *    第二句在分区里说的原因是错的（那一句已经被这句取代了，见上面 `emptyTitle`）。
         *    它仍然是一句**说清为什么空**的话，所以这一块不是空白。
         */
        <div className="tracked__empty">
          <p className="tracked__emptytitle">{emptyTitle}</p>
          {platform === undefined ? (
            <p className="tracked__emptyhint">{t('tracked.emptyHint')}</p>
          ) : null}
        </div>
      ) : null}

      {!loading && error === null && items.length > 0 ? (
        <>
          <p className="resultcount">{t('tracked.count', { count: total })}</p>

          <ul className="tracked__grid">
            {items.map((video) => (
              <li className="tracked__card" key={video.id}>
                {/*
                  ★★ 媒体那一格是一个**门面**（T7，spec §5.3）：点一下才真的挂 iframe。
                  ⚠️ 这里是全站唯一那份嵌入实现（`ClickToPlayEmbed`）的第三个调用点 ——
                     绝不在这里再写一份地址拼接 / 权限 / 门面：复制一份之后的典型剧情是
                     "某天修好了其中一份，另一份没改"（那个组件文件头写着这件事）。

                  ⚠️★ 封面走 T6 新加的 `coverUrl`：它的三样属性是**契约**
                     （`alt=""` + `loading="lazy"` + `referrerpolicy="no-referrer"` ——
                     bilibili 图床按 Referer 白名单放行，带 Referer 是 403），
                     而 `thumbnailUrl` 为 `null` 时门面**回到纯色块**（§5.3）：
                     不许画一个空框、也不许画一条破图边框 —— 那种东西每次都要人解释一遍。
                  ⚠️ 六格里另外五格（标题 / 发布时间 / 时长 / 播放量 / 评论数）**一格没动**（§8.4）：
                     变的是封面那一格的**可访问名**从 `img` 的 `alt` 挪到了门面按钮的
                     `aria-label` 上（`img` 自己变成装饰性的 `alt=""`）。
                  ⚠️★ 「去原站」那条外链**留在** `children` 里（§5.3 那张表）：
                     它是**兜底出口** —— 嵌不出来 / 被墙 / 平台抽风时，用户更需要的正是它，
                     所以它既不能删、也不该被挪到别处去。
                     ⚠️ 它的 URL 形状仍然走 `watchUrl`（`VideoEmbed.tsx`）：三个平台的地址
                     形状已经在那边跑过一轮，**不在这里抄第二份** —— 抄错的表现是一条
                     404 的链接，而它不会让任何门禁变红。
                */}
                <div className="tracked__media">
                  <ClickToPlayEmbed
                    platform={video.platform}
                    idLabel={video.externalId}
                    title={video.title}
                    startOffsetSec={null}
                    coverUrl={video.thumbnailUrl}
                  >
                    <a
                      className="tracked__out"
                      href={watchUrl(video.platform, video.externalId)}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                    >
                      {t('videos.openOriginal')}
                    </a>
                  </ClickToPlayEmbed>
                </div>

                <div className="tracked__body">
                  <div className="tracked__head">
                    <span className="badge badge--kind">{t(PLATFORM_KEYS[video.platform])}</span>
                    {/*
                      标签容器**只在有标签时渲染**：渲染一个空的
                      `<ul class="tracked__tags">` 会占掉一行高度，读起来像"这里本来
                      该有标签、结果丢了" —— 一个不存在的容器不需要任何解释，
                      而一个空容器每看一次都要解释一次。
                      ⚠️ 这条是**本块自己的判断**，不是从规格抄来的：spec 里没有任何
                      一节裁决过空容器（原先这里引的 "§5.2" 讲的是 **YouTube 适配器**，
                      与容器毫无关系）。引用一个不存在的裁决比不引更糟 ——
                      下一个人会去找它，然后以为是自己读漏了。
                      ⚠️ "`durationSec` 为 null 时一个时长标签都不打"是抓取那一侧的事
                      （`deriveTags`）；界面这一侧只管画它拿到的。
                    */}
                    {video.tags.length === 0 ? null : (
                      <ul className="tracked__tags">
                        {video.tags.map((tag) => (
                          <li className="tracked__tag" key={tag}>
                            {tagLabel(tag, t)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <h3 className="tracked__cardtitle">{video.title}</h3>

                  <dl className="tracked__meta">
                    <dt className="tracked__metalabel">{t('tracked.publishedAt')}</dt>
                    <dd className="tracked__published">
                      {localDate(video.publishedAt, i18n.language)}
                    </dd>

                    <dt className="tracked__metalabel">{t('tracked.duration')}</dt>
                    <dd className="tracked__duration">
                      {video.durationSec === null ? DASH : formatTimecode(video.durationSec)}
                    </dd>

                    <dt className="tracked__metalabel">{t('tracked.views')}</dt>
                    <dd className="tracked__views">
                      {video.viewCount === null ? DASH : String(video.viewCount)}
                    </dd>

                    <dt className="tracked__metalabel">{t('tracked.comments')}</dt>
                    <dd className="tracked__comments">
                      {video.commentCount === null ? DASH : String(video.commentCount)}
                    </dd>
                  </dl>
                </div>
              </li>
            ))}
          </ul>

          {totalPages > 1 ? (
            /*
             * 分页控件沿用本仓既有那一套（`.pager` / `.pager__pos`，与视频墙逐字同形）。
             * ⚠️ 那三句文案也复用 `videos.*`（"第 X / Y 页" / 上一页 / 下一页）：
             *    同一页上两个分页器说的是同一件事，各有各的句子只会漂成两种说法。
             * ⚠️★ 但 `aria-label` **必须**分开（`tracked.pagerLabel`）：读屏软件靠它
             *    分得清这一页上的两个 `<nav>`，两边都叫 "pagination" 时用户听到的是
             *    两个同名导航（而这一页上确实有两个）。
             */
            <nav className="pager" aria-label={t('tracked.pagerLabel')}>
              <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
                ← {t('videos.prevPage')}
              </button>
              <span className="pager__pos">{t('videos.page', { page, total: totalPages })}</span>
              <button type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
                {t('videos.nextPage')} →
              </button>
            </nav>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/** 加博主那一栏的红字槽。⚠️ 对象而不是一个字符串：见下面 props 的说明。 */
export interface TrackedCreatorFieldErrors {
  input?: string;
}

/**
 * 管理面板（**只有 `live.manage` 看得到**）。
 *
 * ⚠️★ `canManage` 是**页面**算出来传进来的（`useCan('live.manage')`），组件里
 *    **不判断能力** —— 与 `VideoCard` 的 `canAuthor` 同一条：`permissions.ts` 是
 *    "谁是编辑"的唯一定义，组件里再写一份就是第二份真相。组件只决定**显不显示**：
 *    为 false 时整块返回 `null`。
 *    ⚠️ 为什么还留这一层（而不是让页面干脆不渲染它）：这样"没有能力时整块不渲染"
 *    是一件**可断言**的事（渲染自检用两个 props 对照：true 有 / false 没有）；
 *    页面那一侧同时**不发请求**（免得非编辑每次打开 `/videos` 都吃一个 403）。
 */
export interface TrackedCreatorsPanelProps {
  canManage: boolean;
  loading: boolean;
  /** 有动作在飞（加 / 停用 / 重新回填 / 删）—— 期间所有控件都禁用。 */
  busy: boolean;
  creators: TrackedCreator[];
  /**
   * ★★ 名单**没取到**（发出去的那个 GET 失败了）时的那一句话；`null` = 没出错。
   *
   * ⚠️★ 这一格**必须**有，而且与 `notice` 是**两件事**（虽然两者都是"一句话"）：
   *   · `notice` 说的是**某个动作的结果**（刚才那一下加 / 停用 / 回填 / 删怎么了）；
   *   · 这一格说的是**这张表本身没读到** —— 于是下面那句"名单还是空的"是**假话**，
   *     而且它会把编辑送去重贴一条**已经在名单上**的链接（再贴必然拿到 `duplicate`）。
   * ⚠️ 计划里那行接口签名写的是 `error`，本组件里叫 `loadError`：与 `notice` 并排时，
   *   "error" 会被读成"动作失败了"（那正是 `notice.kind === 'bad'` 在说的事），
   *   而这一格唯一的意思就是"列表没读到，界面不知道名单现在是什么样"。
   * ⚠️ 两格可以同时有内容（通知在上、这一句在下），不需要"谁说"的规则：
   *   它们回答的是不同的问题（"我刚才那一下怎么了" vs "这张表现在是什么状态"）。
   */
  loadError: string | null;
  /** 加博主输入框里的**原文**（受控 —— 见文件头"纯视图"那一段）。 */
  input: string;
  /**
   * 字段级红字。⚠️ 对象而不是一个 `string`：它是页面↔视图的**契约形状**，
   * 与 `SeedPickerPanel.fieldErrors` 同形；将来多一个字段是加一个槽，
   * 而不是改所有调用点（今天只有一个槽 —— 面板只有一栏输入）。
   */
  fieldErrors: TrackedCreatorFieldErrors;
  /**
   * 面板顶部的那一条（失败的原因 / 刚做完那件事的结果）；`null` = 没有要说的。
   *
   * ⚠️ 计划里这一格写的是 `error: string | null`。**这是一处有意的偏差**，理由两条：
   *   ① 有的动作在界面上**看不出效果** —— 「重新回填」改的是库里的 `backfill_done`，
   *      表格里没有这一列 ⇒ 不报一句"已排队、下一轮生效"的话，那颗按钮是**静默**的
   *      （用户会连点三次，然后以为它坏了）；
   *   ② 分成 `error` + `ok` 两个槽就多出一条"两个都有时谁说"的规则（而那条规则
   *      没有任何门禁看得见）。⇒ 合成一格，用 `Notice` 自己的 `kind` 表达。
   */
  notice: { kind: 'ok' | 'bad' | 'info'; text: string } | null;
  /** 正在等二次确认的那一行；`null` = 没有。⚠️ 由**页面**持有（组件无状态）。 */
  confirmingId: string | null;
  onInput: (next: string) => void;
  /** 提交"加一个博主"。⚠️ 它会真的去上游解析（见 `lib/api.ts` 的说明）。 */
  onAdd: () => void;
  /** 停用 / 启用。 */
  onToggle: (id: string, enabled: boolean) => void;
  /** 重新回填（把 `backfill_done` 置 0 ⇒ 下一轮从第一页重走）。 */
  onRebackfill: (id: string) => void;
  /** 请求二次确认（传 `null` = 取消）。 */
  onAskDelete: (id: string | null) => void;
  /** 确认删除。⚠️ 他的视频**跟着一起没**（外键级联），所以这一步不可逆。 */
  onDelete: (id: string) => void;
}

/**
 * 名单 + 加博主 + 每行的三个动作（spec §6.2 第二段）。
 *
 * ⚠️★ 为什么"上次同步 / 上次错在什么"必须摆在表格里（spec §6.3）：
 *    bilibili 的 `-412` 是**概率性**的 ⇒ "今天没有新视频"与"今天一条都没抓到"
 *    在日志里**长得一模一样**。不把这两个读数摆到人眼前，这个功能会**静默**坏掉：
 *    访客那边只是"这一栏很久没更新"，而没有任何人会去看。
 */
export function TrackedCreatorsPanel({
  canManage,
  loading,
  busy,
  creators,
  loadError,
  input,
  fieldErrors,
  notice,
  confirmingId,
  onInput,
  onAdd,
  onToggle,
  onRebackfill,
  onAskDelete,
  onDelete,
}: TrackedCreatorsPanelProps) {
  const { t, i18n } = useTranslation();

  // 没有能力 ⇒ 整块不存在（判据在页面那一层算，见上面 `canManage` 的说明）
  if (!canManage) return null;

  return (
    <section className="tracked__manage" aria-labelledby="tracked-manage-title">
      <h2 className="tracked__title" id="tracked-manage-title">
        {t('tracked.manageTitle')}
      </h2>
      <p className="tracked__sub">{t('tracked.manageSub')}</p>

      {notice === null ? null : <Notice kind={notice.kind}>{notice.text}</Notice>}

      <form
        className="tracked__add"
        onSubmit={(event) => {
          /*
           * ⚠️ 必须拦住默认提交：不拦的话浏览器会整页跳转
           *    （地址变成 `?input=…`），而我们所有的状态都在这一页上 ——
           *    表现是"点完『添加』页面白了一下，那个博主也没加进去"。
           */
          event.preventDefault();
          onAdd();
        }}
      >
        <Field id="tracked-add" label={t('tracked.addLabel')} hint={t('tracked.addHint')}>
          <div className="tracked__addrow">
            <input
              id="tracked-add"
              className="mcsr-field__input"
              value={input}
              placeholder={t('tracked.addPlaceholder')}
              disabled={busy}
              onChange={(event) => onInput(event.target.value)}
            />
            <button type="submit" className="cta tracked__addbtn" disabled={busy}>
              {busy ? t('tracked.addBusy') : t('tracked.addAction')}
            </button>
          </div>
          {fieldErrors.input === undefined ? null : <p className="fielderr">{fieldErrors.input}</p>}
        </Field>
      </form>

      {loading ? <p className="state">{t('common.loading')}</p> : null}

      {/*
        ★★ 名单**没取到** ⇒ 这一块，而**不是**下面那句"名单还是空的"。
        ⚠️ 这句话在这里是**必须**的：没有它，取数失败会渲染成"名单还是空的 —— 在上面
        贴一个博主的链接"，而那句话既假（名单不是空的，是没读到）又有害（编辑会去重贴
        一条已经在名单上的链接，然后拿到 `duplicate`）。这与公开列表那一栏的 `error`
        是同一条纪律（文件头"空的列表与没取到的列表是两件事"）。
        ⚠️ 与 `notice` 不冲突、也不互相覆盖：notice 在更上面，说的是"刚才那个动作怎么了"。
      */}
      {loadError === null ? null : (
        <div className="state state--error">
          <p>{loadError}</p>
        </div>
      )}

      {!loading && loadError === null && creators.length === 0 ? (
        <p className="tracked__empty">{t('tracked.manageEmpty')}</p>
      ) : null}

      {!loading && loadError === null && creators.length > 0
        ? /*
           * ★★ 名单按平台分成**三段**（T8，spec §5.4）：顺序照 `TRACK_PLATFORMS`
           *    （bilibili → youtube → twitch），每段一个小标题 + 该段条数。
           *
           * ⚠️★ 为什么是**三个 `<section>`** 而不是"一张表里插三行小标题"：
           *    spec §5.4 要的每一段都有自己的**小标题与条数**，而它们在 `<table>` 里
           *    只能变成一个没有语义的额外行（读屏软件念出来是一张表里混着几行标题）；
           *    顺带每段还各自拿到一个 `.tracked__tablescroll` —— 窄屏上横滚的是**那一段**，
           *    而不是把整块面板一起推出去。
           * ⚠️★ 空的分段**连小标题一起不画**（下面那行 `return null`，spec §5.4）：
           *    一个只有标题的空壳看起来像"这一段的数据没加载出来"（与"空容器不渲染"
           *    同一条纪律）。⚠️ 三段**都**空不是这里的事 —— 那种情况走上面那句
           *    "名单还是空的"（`creators.length === 0`），所以这里不必画任何空态。
           * ⚠️ 段内顺序**就是** `listCreators` 给的顺序（`created_at ASC`）：这里只
           *    `filter`，**不排序** —— 在界面里再排一次就是第二份"谁在前"的口径。
           * ⚠️ `rows` 是 `creators` 的子集（不是第二份数据）：`key` 仍然用 `creator.id`。
           */
          TRACK_PLATFORMS.map((platform) => {
            const rows = creators.filter((creator) => creator.platform === platform);
            // ⚠️ 空的分段连小标题一起不画（spec §5.4）
            if (rows.length === 0) return null;
            return (
              <section className="tracked__group" key={platform}>
                <h4 className="tracked__grouptitle">
                  {t(PLATFORM_KEYS[platform])}
                  <span className="tracked__groupcount">{rows.length}</span>
                </h4>
                {/*
                 * ⚠️ 外面套一层 `.tracked__tablescroll`（横向滚动兜底）：七列在窄屏上
                 *    装不下，而"顶出一条**页面级**的横向滚动条"是整页在动，比表格自己
                 *    滚一次糟得多（`.ranked__tablescroll` 为同一件事写过完整的一段）。
                 * ⚠️ 表格形状复用 `.admintable`（全站唯一的表格形状，账号管理页在用）：
                 *    在这里再写一遍那几行属性就是第二份会漂移的口径。
                 */}
                <div className="tracked__tablescroll">
                  <table className="admintable tracked__table">
                    <thead>
                      <tr>
                        <th>{t('tracked.colPlatform')}</th>
                        <th>{t('tracked.colName')}</th>
                        <th>{t('tracked.colState')}</th>
                        <th>{t('tracked.colSynced')}</th>
                        <th>{t('tracked.colError')}</th>
                        <th>{t('tracked.colVideos')}</th>
                        <th>{t('tracked.colActions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((creator) => (
                        <tr
                          className={`tracked__row${creator.enabled ? '' : ' tracked__row--off'}`}
                          key={creator.id}
                        >
                          <td>
                            <span className="badge badge--kind">
                              {t(PLATFORM_KEYS[creator.platform])}
                            </span>
                          </td>
                          <td className="tracked__name">
                            {/*
                              ⚠️ `display_name` 是 NOT NULL，但**可能是空串**（迁移 020 那一列的
                              `DEFAULT ''`）—— 空串在这里显示成 `—`：一个空白的名字格看起来像
                              界面坏了，而 `—` 说的正是"这一格没有值"。
                            */}
                            <span className="tracked__displayname">
                              {creator.displayName || DASH}
                            </span>
                            {creator.handle === '' ? null : (
                              <span className="tracked__handle">{creator.handle}</span>
                            )}
                          </td>
                          <td className="tracked__state">
                            {creator.enabled ? t('tracked.stateOn') : t('tracked.stateOff')}
                          </td>
                          <td className="tracked__synced">
                            {/*
                              ⚠️ **秒**的时间戳，必须经 `toMillis`；从没同步过是 `null` ⇒ `—`
                              （**不是** 1970 —— 那是这一整类 bug 最容易漏的一格：
                              `new Date(null)` 恰好也是 1970，所以"忘了判 null"与"忘了乘 1000"
                              在这一格上长得一样，而两者都要靠这一条断言拦住）。
                            */}
                            {localDateTime(creator.lastSyncedAt, i18n.language)}
                          </td>
                          <td className="tracked__err">
                            {creator.lastError === null ? DASH : creator.lastError}
                            {creator.consecutiveFailures > 0 ? (
                              <span className="tracked__streak">
                                {t('tracked.failStreak', { count: creator.consecutiveFailures })}
                              </span>
                            ) : null}
                          </td>
                          <td className="tracked__total">
                            {String(creator.videoCount)}
                            {/*
                              ★★ `N（隐藏 M）`（spec §5.4）：M = 0 时**连括号一起不画** ——
                              不存在的状态不需要解释（与"空容器不渲染"同一条纪律）。
                              ⚠️ `N` 仍然是**库里所有行**（含隐藏）的条数：它是 bilibili
                              "到底判据"的输入（全局约束 5），隐藏功能**不许**碰它的语义
                              ⇒ 隐藏的那几条是**加在括号里**说出来的，不是从 N 里减掉。
                              ⚠️ 括号是全角 `（）`，由这里给（不是词条的一部分）：两种语言
                              都长成 `N（…）`，而词条只回答"M 怎么说"（见 `zh-CN.ts` 那一句）。
                              ⚠️ M 是服务端算的（`listCreators` 的 `SUM(CASE WHEN …)`）：
                              这一层不数、也不猜 —— 猜的话两个数迟早对不上。
                            */}
                            {creator.hiddenCount > 0
                              ? `（${t('tracked.hiddenCount', { count: creator.hiddenCount })}）`
                              : null}
                          </td>
                          <td className="tracked__actions">
                            <button
                              type="button"
                              className="ghostbtn"
                              disabled={busy}
                              onClick={() => onToggle(creator.id, !creator.enabled)}
                            >
                              {creator.enabled ? t('tracked.disable') : t('tracked.enable')}
                            </button>
                            <button
                              type="button"
                              className="ghostbtn"
                              disabled={busy}
                              title={t('tracked.rebackfillHint')}
                              onClick={() => onRebackfill(creator.id)}
                            >
                              {t('tracked.rebackfill')}
                            </button>
                            {/*
                              删除走**行内两步确认**（照 `VideoCard` 的先例，不用 `window.confirm`：
                              原生弹窗与整站样式无关，而且会阻塞渲染）。
                              ⚠️ 为什么删一个博主值得确认、而停用不值得：删掉之后他的视频靠外键
                              **一起没了**（spec §4.2），重建只能靠重新添加 + 重新回填一整轮。
                            */}
                            {confirmingId === creator.id ? (
                              <>
                                <span className="tracked__confirm">
                                  {t('tracked.confirmDelete')}
                                </span>
                                <button
                                  type="button"
                                  className="dangerbtn"
                                  disabled={busy}
                                  onClick={() => onDelete(creator.id)}
                                >
                                  {t('common.confirm')}
                                </button>
                                <button
                                  type="button"
                                  className="ghostbtn"
                                  disabled={busy}
                                  onClick={() => onAskDelete(null)}
                                >
                                  {t('common.cancel')}
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="dangerbtn"
                                disabled={busy}
                                onClick={() => onAskDelete(creator.id)}
                              >
                                {t('tracked.delete')}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })
        : null}
    </section>
  );
}
