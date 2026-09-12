import { VIDEO_PLATFORMS, type VideoPlatform } from '@mcsr/shared';
import { DEFAULT_PAGE_SIZE } from '@mcsr/shared/resources';
import type { Video } from '@mcsr/shared/videos';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { em } from '@/components/Emphasis';
import { Notice } from '@/components/Form';
import { VideoCard } from '@/components/VideoCard';
import { VideoForm } from '@/components/VideoForm';
import { fetchMyVideos, fetchVideos, type VideoQuery } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCan } from '@/lib/capabilities';
import { useAsync } from '@/lib/useAsync';

/**
 * 视频墙 —— `/videos`。
 *
 * ---------------------------------------------------------------------------
 * 一、公开页面：看视频**不需要登录**
 * ---------------------------------------------------------------------------
 * 这是全站的访问模型（docs/v1-plan.md §0.1）：浏览不设门槛，只有"贴"要登录。
 * 所以这个页面不挂任何鉴权，未登录的人看到的是完整的一面墙 ——
 * 不是一个"登录后可见"的空壳。
 *
 * ---------------------------------------------------------------------------
 * 二、筛选状态放在 URL 里（和 ResourceList 同一条）
 * ---------------------------------------------------------------------------
 * `?platform=&authorId=&page=&view=` —— 刷新不丢、能分享、后退键符合直觉。
 *
 * ⚠️ 空的筛选值**不拼进 URL**，而且这道关在 `fetchVideos` 里：
 *    `?platform=` 是一个合法的 400（platform 是封闭枚举，空串不是它的取值），
 *    而用户看到的是"查询参数不合法" —— 那句话指不到"你把筛选清空了"上。
 *    这个页面还多一层：从地址栏读进来的 platform 会**先对着 VIDEO_PLATFORMS 校验**，
 *    所以手打一个 `?platform=foo` 也不会变成一个用户没法自救的错误页。
 *
 * ---------------------------------------------------------------------------
 * 三、`view=mine` 是一个**视图**，不是第二个接口的副产物
 * ---------------------------------------------------------------------------
 * 「我贴的」用的是 `/api/videos/mine`，它**含被隐藏的视频**（服务端刻意不过滤
 * 状态）。这是作者唯一能知道自己那条被隐藏了的地方 ——
 * 没有它，"被隐藏"对作者表现为"凭空消失"，他会再贴一遍，
 * 然后被 UNIQUE(platform, video_id) 挡回来，报的还是"这个视频已经在墙上了"。
 */
export function Videos() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const auth = useAuth();

  /*
   * 地址栏里的 platform 先校验再用。
   * 不校验的话 `?platform=foo` 会让服务端 400，而页面只会显示一句
   * "加载失败" —— 用户（或者收到这条链接的人）没有任何办法知道
   * 只要把 foo 去掉就好了。
   */
  const platformRaw = params.get('platform');
  const platform = (VIDEO_PLATFORMS as readonly string[]).includes(platformRaw ?? '')
    ? (platformRaw as VideoPlatform)
    : undefined;
  const authorId = params.get('authorId') ?? undefined;
  const page = Number(params.get('page') ?? '1') || 1;
  const mineView = params.get('view') === 'mine';

  const [refreshKey, setRefreshKey] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  /*
   * 操作结果（删除 / 隐藏 / 恢复）显示在**页面上**，不是卡片上。
   *
   * ⚠️ 卡片上显示会被卸载掉：隐藏和真删都会让那张卡片从列表里消失，
   *    而列表紧接着就重拉了 —— 于是那句"已隐藏，作者自己还看得到"
   *    连同卡片一起消失，用户只看到一行东西不见了，没有任何解释。
   */
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);

  const query: VideoQuery = { platform, authorId, page, pageSize: DEFAULT_PAGE_SIZE };

  /*
   * 有下架权的人看视频墙时**绕开浏览器缓存**（`fetchVideos` 的第三个参数）。
   *
   * ⚠️ 这不是优化，是修一个真跑出来的 bug：`/api/videos` 带
   *    `public, max-age=60`，所以编辑点完「隐藏」、`refreshKey` +1 重拉列表时，
   *    命中的是 60 秒内的旧响应 —— **那条还挂在墙上**。他会以为隐藏坏了。
   *    服务端一直是对的，错的只是这一层缓存。
   *
   * ⚠️ 为什么可以放进依赖数组（上面那条注释刚警告过多余的依赖）：
   *    只有登录且真有 resource.moderate 的人才会从 false 翻到 true，
   *    也就是**只多一次请求**，而且只在治理者身上。访客 `auth.user` 一直是
   *    null、`canModerate` 一直是 false，依赖不变，不会有第二个请求。
   *    这和上面 `mineView ? auth.user?.id : ''` 防的那件事不是一回事 ——
   *    那条防的是**每个访客**都被 me 接口的返回触发重拉。
   */
  const canModerate = useCan('resource.moderate');

  const state = useAsync<WallData>(
    async (signal) => {
      if (mineView) {
        // 未登录就不发这个请求：它必然 401，而 401 不是"出错了"，
        // 是"你还没登录"—— 那句话由界面自己说（见下面的分支）。
        if (!auth.user) return EMPTY;
        const res = await fetchMyVideos(signal);
        // /mine 不分页：一个人的帖子数量是人眼能扫完的量级（见数据层注释）。
        // 这里把它包成同一个形状，好让下面只有一条渲染路径。
        return {
          items: res.items,
          total: res.items.length,
          page: 1,
          pageSize: res.items.length || DEFAULT_PAGE_SIZE,
        };
      }
      return fetchVideos(query, signal, canModerate);
    },
    /*
     * 依赖里每个值都列出来（本仓用 Biome，没有 eslint-disable 那条路）。
     *
     * ⚠️ 最后一项是 `mineView ? auth.user?.id : ''`，**不是** `auth.user?.id`。
     *    写成后者的话，/api/auth/me 一返回（哪怕用户只是来看视频墙、根本没点
     *    「我贴的」），依赖就变了 → 整个视频墙被重新请求一遍。
     *    那个多出来的请求在开发时看不出来（本地快），线上是白白的 24 条查询。
     */
    [
      mineView,
      platform ?? '',
      authorId ?? '',
      page,
      refreshKey,
      mineView ? (auth.user?.id ?? '') : '',
      canModerate,
    ],
  );

  const hasFilters = Boolean(platform || authorId);
  // 作者名从结果里取：接口收的是 authorId（UUID），而列表里的每一条都带着作者名。
  // 拿不到时（还没加载完 / 分享过来的链接）退回到 id 的前几位 —— 显示一个
  // 短 id 虽然不好看，但比显示一个空 chip 强，而且它确实是那个筛选条件的值。
  const authorName = state.status === 'ok' ? (state.data.items[0]?.authorName ?? null) : null;

  function setParam(key: string, value: string | undefined) {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      // 换筛选条件要回到第一页：停在第三页而结果只剩一页的话，
      // 用户看到的是一片空白，他会以为"这个筛选没有结果"。
      if (key !== 'page') next.delete('page');
      return next;
    });
  }

  function clearAll() {
    // 清筛选，但**保留视图**：清掉 view 会把用户从「我贴的」弹回墙上，
    // 而他要清的只是筛选条件。
    setParams(mineView ? { view: 'mine' } : new URLSearchParams(), { replace: true });
  }

  const totalPages =
    state.status === 'ok' && !mineView
      ? Math.max(1, Math.ceil(state.data.total / DEFAULT_PAGE_SIZE))
      : 1;
  const hiddenCount =
    state.status === 'ok' ? state.data.items.filter((v) => v.status === 'hidden').length : 0;

  return (
    <>
      <header className="pagehead">
        <div className="pagehead__row">
          <h1 className="pagehead__title">{t('videos.title')}</h1>
          {/*
            「贴个视频」长在视频墙里，而不是侧边栏。
            ⚠️ 这是**这个版块的动作**：用户是"在墙上看到缺了什么"才想贴的，
               所以入口应该在他看内容的地方（见 Layout.tsx 里那条注释）。
               仅登录后可见：没登录的人点进去只会被弹回来，
               而"看得见、点不动"比"看不见"更让人困惑。
          */}
          {auth.user ? (
            <button
              type="button"
              className="cta pagehead__action"
              aria-expanded={formOpen}
              onClick={() => setFormOpen((open) => !open)}
            >
              {formOpen ? t('common.cancel') : `+ ${t('videos.pasteAction')}`}
            </button>
          ) : null}
        </div>
        <p className="pagehead__sub">{t('videos.subtitle')}</p>
        {/*
          指向「直播」的一行。

          ⚠️ 两个板块都是"视频"，所以必须有一句话说明**为什么有两个** ——
             否则用户点进任何一个都会觉得另一个是重复的。
               · 这里：rolling，谁都能贴，一直在变
               · /live：编辑维护的一份名单，变动很慢
          放在副标题下面而不是页脚：它是"你要找的东西可能不在这页"的提示，
          而那种提示必须在用户开始翻列表**之前**就出现。
        */}
        <p className="pagehead__sub videos__toLive">
          {t('enterVideo.pointingToLive')}{' '}
          <Link className="authform__link" to="/live">
            {t('enterVideo.gotoLive')}
          </Link>
        </p>
      </header>

      {formOpen && auth.user ? (
        <VideoForm
          // 贴完立刻重拉：视频不审核，它现在就应当在墙上出现。
          onPosted={() => setRefreshKey((k) => k + 1)}
          onClose={() => setFormOpen(false)}
        />
      ) : null}

      {/* 视图切换只在登录后出现 —— 没登录的人点"我贴的"只会被弹回来 */}
      {auth.user ? (
        <div className="video-viewswitch">
          <button
            type="button"
            className={`video-viewswitch__item${mineView ? '' : ' is-active'}`}
            onClick={() => setParam('view', undefined)}
          >
            {t('videos.viewAll')}
          </button>
          <button
            type="button"
            className={`video-viewswitch__item${mineView ? ' is-active' : ''}`}
            onClick={() => setParam('view', 'mine')}
          >
            {t('videos.viewMine')}
          </button>
        </div>
      ) : null}

      {mineView && !auth.user ? (
        auth.loading ? (
          <p className="state">{t('common.loading')}</p>
        ) : (
          <>
            <Notice kind="info">{t('videos.mineNeedLogin')}</Notice>
            <p className="submitgate">
              <Link className="cta" to={`/login?next=${encodeURIComponent('/videos?view=mine')}`}>
                {t('nav.login')}
              </Link>
            </p>
          </>
        )
      ) : (
        <>
          {/*
            ⚠️ 「我贴的」不显示平台筛选：那个接口不分页也不收参数，筛选只能
               在客户端做，而"界面上的筛选"和"服务端的筛选"看起来一样、
               行为不同，是那种只有数据量大了才会暴露的差异。
          */}
          {!mineView ? (
            <div className="tagcloud">
              <span className="tagcloud__label">{t('videos.allPlatforms')}</span>
              <button
                type="button"
                className={`tagchip${platform === undefined ? ' tagchip--on' : ''}`}
                onClick={() => setParam('platform', undefined)}
              >
                {t('videos.allPlatforms')}
              </button>
              {VIDEO_PLATFORMS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`tagchip${platform === p ? ' tagchip--on' : ''}`}
                  onClick={() => setParam('platform', p)}
                >
                  {t(platformKey(p))}
                </button>
              ))}

              {/*
                作者筛选是一个"当前条件"chip，不是一堆可选项 ——
                全站没有"列出所有作者"的接口，而这个筛选的自然入口
                是点卡片上的作者名（见 VideoCard）。没有 chip 的话，
                点完之后页面会变成"少了很多东西"，而用户看不出为什么。
              */}
              {authorId ? (
                <button
                  type="button"
                  className="tagchip tagchip--on"
                  title={t('videos.clearAuthor')}
                  onClick={() => setParam('authorId', undefined)}
                >
                  {t('videos.authorFilter', { name: authorName ?? authorId.slice(0, 8) })} ×
                </button>
              ) : null}

              {hasFilters ? (
                <button type="button" className="filters__clear" onClick={clearAll}>
                  {t('videos.clearFilters')}
                </button>
              ) : null}
            </div>
          ) : null}

          {state.status === 'loading' ? <WallSkeleton /> : null}

          {state.status === 'error' ? (
            <div className="state state--error">
              <p>
                {t('videos.loadFailed')}：{state.error}
              </p>
            </div>
          ) : null}

          {/*
            操作结果（删除 / 隐藏 / 恢复）留在页面上 —— 见上面 flash 的说明。
            它比列表先渲染，所以"卡片消失了"和"为什么消失"是同时被看到的。
          */}
          {flash ? (
            <Notice kind={flash.ok ? 'ok' : 'bad'}>
              {flash.text}
              <button
                type="button"
                className="video-flash__close"
                aria-label={t('common.cancel')}
                onClick={() => setFlash(null)}
              >
                ×
              </button>
            </Notice>
          ) : null}

          {state.status === 'ok' ? (
            state.data.items.length === 0 ? (
              <div className="state state--empty">
                <p className="state__title">
                  {mineView ? t('videos.mineEmpty') : t('videos.noResults')}
                </p>
                <p>{mineView ? t('videos.mineEmptyHint') : t('videos.noResultsHint')}</p>
                {!mineView && hasFilters ? (
                  <button type="button" className="filters__clear" onClick={clearAll}>
                    {t('videos.clearFilters')}
                  </button>
                ) : null}
              </div>
            ) : (
              <>
                <p className="resultcount">
                  {hasFilters && !mineView
                    ? t('videos.resultCountFiltered', { count: state.data.total })
                    : t('videos.resultCount', { count: state.data.total })}
                </p>

                {/*
                  被隐藏的视频只有作者自己在「我贴的」里看得见。明说这件事，
                  否则作者会以为"这些也还在墙上"，而墙上其实一条都没有。
                */}
                {mineView && hiddenCount > 0 ? (
                  <p className="submitnote">{em(t('videos.mineHiddenNote'))}</p>
                ) : null}

                <ul className="video-wall">
                  {state.data.items.map((video: Video) => (
                    <VideoCard
                      key={video.id}
                      video={video}
                      onResult={(ok, text) => {
                        setFlash({ ok, text });
                        // 无论成功还是空操作都重拉：删除/隐藏会让这一条从列表里
                        // 消失，而"它是不是真的没了"只有服务端说了算 ——
                        // 在前端本地把它抹掉，就等于把服务端的判定做成了第二份。
                        setRefreshKey((k) => k + 1);
                      }}
                      // 在「我贴的」里按作者筛选没有意义（全都是我）
                      onFilterAuthor={mineView ? undefined : (id) => setParam('authorId', id)}
                    />
                  ))}
                </ul>

                {!mineView && totalPages > 1 ? (
                  <nav className="pager" aria-label="pagination">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setParam('page', String(page - 1))}
                    >
                      ← {t('videos.prevPage')}
                    </button>
                    <span className="pager__pos">
                      {t('videos.page', { page, total: totalPages })}
                    </span>
                    <button
                      type="button"
                      disabled={page >= totalPages}
                      onClick={() => setParam('page', String(page + 1))}
                    >
                      {t('videos.nextPage')} →
                    </button>
                  </nav>
                ) : null}
              </>
            )
          ) : null}
        </>
      )}
    </>
  );
}

/** 两种视图归一化之后的形状 —— 让下面只有一条渲染路径。 */
interface WallData {
  items: Video[];
  total: number;
  page: number;
  pageSize: number;
}

const EMPTY: WallData = { items: [], total: 0, page: 1, pageSize: DEFAULT_PAGE_SIZE };

/** 平台名 → 词条 key。表里没有的走 Twitch 的兜底是不可能的，所以直接穷尽。 */
function platformKey(platform: VideoPlatform): string {
  if (platform === 'bilibili') return 'videos.platformBilibili';
  if (platform === 'youtube') return 'videos.platformYoutube';
  return 'videos.platformTwitch';
}

/**
 * 加载骨架。
 *
 * ⚠️ 骨架块的高度**必须和真实嵌入框一样**（16:9）。
 *    高度对不上时，数据到达的瞬间整页会跳一下 —— 而那正是加载骨架
 *    想避免的那件事。这里复用 `.skel` 的动画，只补一个比例盒子。
 */
function WallSkeleton({ count = 6 }: { count?: number }) {
  return (
    <ul className="video-wall" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={`skel-${String(i)}`} className="video-card">
          <span className="skel video-skel__title" />
          <span className="skel video-skel__box" />
          <span className="skel skel--line" style={{ width: '40%', height: 10 }} />
        </li>
      ))}
    </ul>
  );
}
