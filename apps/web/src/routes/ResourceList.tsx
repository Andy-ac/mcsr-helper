import { DEFAULT_PAGE_SIZE, type ResourceQuery } from '@mcsr/shared/resources';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { ResourceCard } from '@/components/ResourceCard';
import { fetchResources, fetchTags } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCan } from '@/lib/capabilities';
import { useAsync } from '@/lib/useAsync';

/** 子 tab：全部 / 网站 / 工具。新增 kind 时在这里加一条即可。 */
const TABS = [
  { key: 'all', labelKey: 'resources.tabAll', kind: undefined },
  { key: 'website', labelKey: 'resources.tabWebsite', kind: 'website' as const },
  { key: 'tool', labelKey: 'resources.tabTool', kind: 'tool' as const },
] as const;

/**
 * 资源库列表页。
 *
 * **筛选状态放在 URL 里**（`?q=&kind=&lang=&tag=&page=`），不是组件 state。
 * 这样：刷新不丢、能分享链接、浏览器后退键符合直觉。
 * 代价是要在读写 URL 和本地输入框状态之间做一层同步 —— 见下面的 searchInput。
 */
export function ResourceList() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  // 只为了决定"提交"按钮显不显示 —— 浏览本身不需要登录
  const auth = useAuth();

  const query: Partial<ResourceQuery> = {
    q: params.get('q') ?? undefined,
    kind: (params.get('kind') as ResourceQuery['kind']) ?? undefined,
    lang: (params.get('lang') as ResourceQuery['lang']) ?? undefined,
    tag: params.get('tag') ?? undefined,
    page: Number(params.get('page') ?? '1') || 1,
    pageSize: DEFAULT_PAGE_SIZE,
  };

  // 搜索框需要本地状态：直接绑到 URL 的话每敲一个字都会产生一条历史记录，
  // 后退键会变成"一个字一个字地退"。
  const [searchInput, setSearchInput] = useState(query.q ?? '');
  useEffect(() => {
    setSearchInput(query.q ?? '');
  }, [query.q]);

  useEffect(() => {
    const current = query.q ?? '';
    if (searchInput === current) return;
    const timer = globalThis.setTimeout(() => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (searchInput) next.set('q', searchInput);
          else next.delete('q');
          next.delete('page'); // 换关键词要回到第一页
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => globalThis.clearTimeout(timer);
  }, [searchInput, query.q, setParams]);

  /*
   * 「显示已下架」—— 只有有下架权的人看得到这个开关。
   *
   * ⚠️ 它存在的理由是：下架之后条目就从列表里消失了，没有这个开关的话
   *    编辑者就**再也找不到它**，也就无法恢复。那不是"下架"，是一条单向的路。
   *    服务端会再判一次权限（客户端说了不算），这里只是"想不想看"。
   */
  const canModerate = useCan('resource.moderate');
  const [showHidden, setShowHidden] = useState(false);
  const includeHidden = canModerate && showHidden;

  const listQuery = JSON.stringify(query);
  const list = useAsync(
    (signal) => fetchResources(query, signal, includeHidden),
    [listQuery, includeHidden],
  );
  const tags = useAsync((signal) => fetchTags(signal), []);

  const activeTabKey = query.kind ?? 'all';
  const tabIndicator = useTabIndicator(activeTabKey);

  const hasFilters = Boolean(query.q || query.kind || query.lang || query.tag);

  function clearAll() {
    setParams(new URLSearchParams(), { replace: true });
  }

  function setParam(key: string, value: string | undefined) {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'page') next.delete('page');
      return next;
    });
  }

  const totalPages =
    list.status === 'ok' ? Math.max(1, Math.ceil(list.data.total / DEFAULT_PAGE_SIZE)) : 1;
  const currentPage = query.page ?? 1;

  return (
    <>
      <header className="pagehead">
        <div className="pagehead__row">
          <h1 className="pagehead__title">{t('resources.title')}</h1>
          {/*
            「提交」按钮长在资源库里，而不是侧边栏。
            ⚠️ 它是**这个版块的动作**：用户是"在资源库里看到缺了什么"才想提交的，
               所以入口应该在他看内容的地方，而不是在导航里多一个全局条目。
               （导航是"去哪儿"，提交是"在这儿做一件事"。）
            仅登录后可见：没登录的人点进去只会被弹回来，
            而"看得见、点不动"比"看不见"更让人困惑。
          */}
          {auth.user ? (
            <Link className="cta pagehead__action" to="/resources/submit">
              + {t('resources.submitAction')}
            </Link>
          ) : null}
        </div>
        <p className="pagehead__sub">{t('resources.subtitle')}</p>
      </header>

      {/* 子 tab：按类型分流。点击时清掉分页，但保留搜索与语言筛选。 */}
      <div className="tabs" role="tablist" ref={tabIndicator.containerRef}>
        {TABS.map((tab) => {
          const active = query.kind === tab.kind;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              className={`tabs__item${active ? ' is-active' : ''}`}
              onClick={() => setParam('kind', tab.kind)}
            >
              {t(tab.labelKey)}
            </button>
          );
        })}

        {/*
          滑动指示器。位置由 useTabIndicator 量出来 ——
          CSS 做不到"跟着兄弟元素的宽度走"（除非把三个 tab 做成等宽，
          但中英文切换后比例又会很难看）。
        */}
        {tabIndicator.style ? (
          <span
            aria-hidden="true"
            className={`tabs__indicator${tabIndicator.ready ? ' is-ready' : ''}`}
            style={tabIndicator.style}
          />
        ) : null}
      </div>

      <div className="filters">
        <div className="filters__search">
          <label className="sr-only" htmlFor="rq">
            {t('resources.searchLabel')}
          </label>
          <input
            id="rq"
            type="search"
            value={searchInput}
            placeholder={t('resources.searchPlaceholder')}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>

        <select
          className="filters__select"
          value={query.lang ?? ''}
          aria-label={t('resources.allLangs')}
          onChange={(e) => setParam('lang', e.target.value || undefined)}
        >
          <option value="">{t('resources.allLangs')}</option>
          <option value="zh-CN">{t('resources.langZh')}</option>
          <option value="en">{t('resources.langEn')}</option>
        </select>

        {hasFilters ? (
          <button type="button" className="filters__clear" onClick={clearAll}>
            {t('resources.clearFilters')}
          </button>
        ) : null}
      </div>

      {/* 标签云。当前选中的标签高亮，再点一次取消。 */}
      {tags.status === 'ok' && tags.data.tags.length > 0 ? (
        <div className="tagcloud">
          <span className="tagcloud__label">{t('resources.tagFilterHint')}</span>
          {tags.data.tags.map(({ tag, count }) => (
            <button
              key={tag}
              type="button"
              className={`tagchip${query.tag === tag ? ' tagchip--on' : ''}`}
              onClick={() => setParam('tag', query.tag === tag ? undefined : tag)}
            >
              {tag}
              <span className="tagchip__count">{count}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/*
        加载中显示骨架屏而不是一句"加载中…"：
        骨架保持和真实卡片相同的结构，数据到达时不会跳版。
        这是"页面更丝滑"里最容易被忽略但体感最强的一项。
      */}
      {list.status === 'loading' ? <SkeletonList /> : null}

      {list.status === 'error' ? (
        <div className="state state--error">
          <p>
            {t('resources.loadFailed')}：{list.error}
          </p>
        </div>
      ) : null}

      {list.status === 'ok' ? (
        <>
          <p className="resultcount">
            {hasFilters
              ? t('resources.resultCountFiltered', { count: list.data.total })
              : t('resources.resultCount', { count: list.data.total })}
          </p>

          {list.data.items.length === 0 ? (
            <div className="state state--empty">
              <p className="state__title">{t('resources.noResults')}</p>
              <p>{t('resources.noResultsHint')}</p>
              {hasFilters ? (
                <button type="button" className="filters__clear" onClick={clearAll}>
                  {t('resources.clearFilters')}
                </button>
              ) : null}
            </div>
          ) : (
            <>
              {canModerate ? (
                <label className="listfilter">
                  <input
                    type="checkbox"
                    checked={showHidden}
                    onChange={(e) => setShowHidden(e.target.checked)}
                  />
                  {t('moderate.showHidden')}
                </label>
              ) : null}

              <ul className="reslist">
                {list.data.items.map((item) => (
                  <ResourceCard
                    key={item.id}
                    item={item}
                    // 已下架的卡片降饱和 + 挂标记：编辑者一眼能看出
                    // "这条现在不在站上"，而不是以为筛选坏了。
                    hidden={item.status === 'hidden'}
                  />
                ))}
              </ul>
            </>
          )}

          {totalPages > 1 ? (
            <nav className="pager" aria-label="pagination">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setParam('page', String(currentPage - 1))}
              >
                ← {t('resources.prevPage')}
              </button>
              <span className="pager__pos">
                {t('resources.page', { page: currentPage, total: totalPages })}
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setParam('page', String(currentPage + 1))}
              >
                {t('resources.nextPage')} →
              </button>
            </nav>
          ) : null}
        </>
      ) : null}
    </>
  );
}

/**
 * tab 下方的滑动指示器。
 *
 * 为什么要用 JS 量而不是纯 CSS：指示器要停在**当前激活那个按钮**的正下方，
 * 而按钮的宽度由文字内容决定。CSS 做不到"跟着兄弟元素的宽度走" ——
 * 除非把三个 tab 做成等宽，但那样中英文切换后比例会很难看
 * （"全部/网站/工具"和 "All/Websites/Tools" 需要的宽度差很多）。
 *
 * 三个必须重新测量的时机，少任何一个都会看到指示器停在错的位置：
 *   1. **激活项变化** —— 正常点击。注意这一条**不能**靠 ResizeObserver 兜：
 *      切换 tab 时按钮的尺寸并没有变，observer 不会触发。所以它必须是一个
 *      显式的依赖（见下面那条 biome-ignore）。
 *   2. **容器或按钮尺寸变化** —— 窗口缩放、窄屏下 tab 换行、切换语言后文字变长。
 *      观察了每一个按钮，所以"前面那个 tab 变宽把后面的挤走"也能覆盖到。
 *   3. **字体加载完成** —— 字体是 font-display:swap 异步加载的，加载前按钮
 *      用的是系统字体的宽度，加载后会变。不重测的话，首屏打开时指示器会
 *      停在一个**已经不存在的**位置上。这个最容易漏，因为它在开发机上
 *      往往因为字体已被缓存而看不出来。
 */
function useTabIndicator(activeKey: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ left: number; width: number } | null>(null);
  const [ready, setReady] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: activeKey 是**纯触发器**，effect 体内不读取它
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const active = container.querySelector<HTMLElement>('.tabs__item.is-active');
      if (!active) {
        setRect(null);
        return;
      }
      setRect({ left: active.offsetLeft, width: active.offsetWidth });
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(container);
    for (const button of container.querySelectorAll('.tabs__item')) observer.observe(button);

    if (document.fonts) {
      document.fonts.ready.then(measure).catch(() => {
        /* 字体加载失败不影响功能：用当前测量值即可 */
      });
    }

    // 首次测量**之后**才打开过渡。否则指示器会从 left:0 一路滑到当前 tab ——
    // 页面刚打开就自己动一下，看起来像 bug。
    const frame = requestAnimationFrame(() => setReady(true));

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [activeKey]);

  return {
    containerRef,
    ready,
    // 用 transform 而不是 left：transform 走合成层，滑动才是 60fps 的
    style: rect
      ? { transform: `translateX(${String(rect.left)}px)`, width: `${String(rect.width)}px` }
      : undefined,
  };
}

/** 与真实卡片同构的占位。行数刻意和真实内容一致，避免加载完成时高度突变。 */
function SkeletonList({ count = 6 }: { count?: number }) {
  return (
    <ul className="reslist" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        // 结构和真实卡片保持一致：li 是网格项，.rescard 是里面撑满的那个盒子。
        // 少一层的话骨架和真实卡片的宽度会差一点，加载完成时能看到一个轻微的横跳。
        <li key={`skel-${String(i)}`}>
          <div className="rescard">
            <span className="skel skel--icon" />
            <div className="rescard__body">
              <span className="skel skel--line" style={{ width: '55%' }} />
              <span className="skel skel--line" style={{ width: '30%', height: 10 }} />
              <span className="skel skel--line" style={{ width: '90%' }} />
              <span className="skel skel--line" style={{ width: '70%' }} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
