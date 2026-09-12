import {
  DEFAULT_PAGE_SIZE,
  type ResourceListItem,
  type ResourceQuery,
} from '@mcsr/shared/resources';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { ResourceIcon } from '@/components/ResourceIcon';
import { fetchResources, fetchTags } from '@/lib/api';
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

  const listQuery = JSON.stringify(query);
  const list = useAsync((signal) => fetchResources(query, signal), [listQuery]);
  const tags = useAsync((signal) => fetchTags(signal), []);

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
        <h1 className="pagehead__title">{t('resources.title')}</h1>
        <p className="pagehead__sub">{t('resources.subtitle')}</p>
      </header>

      {/* 子 tab：按类型分流。点击时清掉分页，但保留搜索与语言筛选。 */}
      <div className="tabs" role="tablist">
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
              className={`tagchip${query.tag === tag ? ' is-active' : ''}`}
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
            <ul className="reslist">
              {list.data.items.map((item) => (
                <ResourceCard key={item.id} item={item} />
              ))}
            </ul>
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

function ResourceCard({ item }: { item: ResourceListItem }) {
  const { t } = useTranslation();
  return (
    <li className="rescard">
      {/* 物品栏格子：图片 / favicon / 首字母方块 */}
      <div className="rescard__icon">
        <ResourceIcon id={item.id} title={item.title} url={item.url} imageUrl={item.imageUrl} />
      </div>

      <div className="rescard__body">
        <div className="rescard__head">
          <Link className="rescard__title" to={`/resources/${encodeURIComponent(item.id)}`}>
            {item.title}
          </Link>
        </div>

        {item.titleEn && item.titleEn !== item.title ? (
          <p className="rescard__alt">{item.titleEn}</p>
        ) : null}

        {/* 主要标签：精选（金）、官方（钻石青）、类型（中性） */}
        <div className="badges">
          {item.featured ? (
            <span className="badge badge--featured">{t('resources.featured')}</span>
          ) : null}
          {item.official ? (
            <span className="badge badge--official">{t('resources.official')}</span>
          ) : null}
          <span className="badge badge--kind">
            {item.kind === 'tool' ? t('resources.kindTool') : t('resources.kindWebsite')}
          </span>
        </div>

        {item.summary ? <p className="rescard__summary">{item.summary}</p> : null}

        <div className="rescard__foot">
          <span className="rescard__host">{hostOf(item.url)}</span>
          {item.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="tagchip tagchip--sm">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </li>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** 与真实卡片同构的占位。行数刻意和真实内容一致，避免加载完成时高度突变。 */
function SkeletonList({ count = 6 }: { count?: number }) {
  return (
    <ul className="reslist" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li className="rescard" key={`skel-${String(i)}`}>
          <span className="skel skel--icon" />
          <div className="rescard__body">
            <span className="skel skel--line" style={{ width: '55%' }} />
            <span className="skel skel--line" style={{ width: '30%', height: 10 }} />
            <span className="skel skel--line" style={{ width: '90%' }} />
            <span className="skel skel--line" style={{ width: '70%' }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
