import type { ResourceDetail as Resource } from '@mcsr/shared/resources';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import { Link, useParams } from 'react-router';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { ResourceCard } from '@/components/ResourceCard';
import { ResourceIcon } from '@/components/ResourceIcon';
import { ApiError, fetchResource, fetchResources } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';

export function ResourceDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const state = useAsync<Resource>((signal) => fetchResource(id, signal), [id]);

  if (state.status === 'loading') {
    return <p className="state">{t('resources.loading')}</p>;
  }

  if (state.status === 'error') {
    const notFound = state.error.includes('404');
    return (
      <div className="state state--empty">
        <p className="state__title">
          {notFound ? t('resources.notFound') : t('resources.loadFailed')}
        </p>
        <p>{notFound ? t('resources.notFoundHint') : state.error}</p>
        <Link className="cta" to="/resources">
          ← {t('resources.backToList')}
        </Link>
      </div>
    );
  }

  const r = state.data;

  return (
    <article className="detail">
      <Link className="detail__back" to="/resources">
        ← {t('resources.backToList')}
      </Link>

      <header className="detail__head">
        {/* 和列表卡片同一种图标槽，只是更大 —— 视觉上"点进来还是那一格" */}
        <div className="detail__icon">
          <ResourceIcon id={r.id} title={r.title} url={r.url} imageUrl={r.imageUrl} />
        </div>

        <div className="detail__heading">
          <h1 className="detail__title">{r.title}</h1>
          {r.titleEn && r.titleEn !== r.title ? <p className="detail__alt">{r.titleEn}</p> : null}

          <div className="detail__meta">
            {r.featured ? (
              <span className="badge badge--featured">{t('resources.featured')}</span>
            ) : null}
            {r.official ? (
              <span className="badge badge--official">{t('resources.official')}</span>
            ) : null}
            <span className="badge badge--kind">
              {r.kind === 'tool' ? t('resources.kindTool') : t('resources.kindWebsite')}
            </span>
            <span className="badge badge--kind">
              {r.lang === 'zh-CN' ? t('resources.langZh') : t('resources.langEn')}
            </span>
          </div>

          <a className="cta" href={r.url} target="_blank" rel="noopener noreferrer">
            {t('resources.visit')} ↗
          </a>

          <p className="detail__updated">
            {t('resources.lastUpdated', { date: new Date(r.updatedAt).toLocaleDateString() })}
          </p>
        </div>
      </header>

      {r.tags.length > 0 ? (
        <div className="detail__tags">
          <span className="tagcloud__label">{t('resources.subTagsLabel')}</span>
          {r.tags.map((tag) => (
            <Link key={tag} className="tagchip" to={`/resources?tag=${encodeURIComponent(tag)}`}>
              {tag}
            </Link>
          ))}
        </div>
      ) : null}

      {r.summary ? <p className="detail__summary">{r.summary}</p> : null}

      {/* 比列表卡片完整得多的信息表 —— 这是"点开后看到更多"的主要载体 */}
      <h2 className="related__title">{t('resources.infoTitle')}</h2>
      <dl className="infotable">
        <dt>{t('resources.infoSite')}</dt>
        <dd>
          <a href={r.url} target="_blank" rel="noopener noreferrer">
            {r.url}
          </a>
        </dd>

        <dt>{t('resources.infoKind')}</dt>
        <dd>{r.kind === 'tool' ? t('resources.kindTool') : t('resources.kindWebsite')}</dd>

        <dt>{t('resources.infoLang')}</dt>
        <dd>{r.lang === 'zh-CN' ? t('resources.langZh') : t('resources.langEn')}</dd>

        <dt>{t('resources.infoTags')}</dt>
        <dd>{r.tags.length > 0 ? r.tags.join(' / ') : '—'}</dd>

        <dt>{t('resources.infoImage')}</dt>
        <dd>
          {r.imageUrl
            ? `${t('resources.imageCustom')} — ${r.imageUrl}`
            : `${faviconOf(r.url) ?? t('resources.imageGenerated')}`}
        </dd>

        <dt>{t('resources.infoAdded')}</dt>
        <dd>{new Date(r.createdAt).toLocaleString()}</dd>

        <dt>{t('resources.infoUpdated')}</dt>
        <dd>{new Date(r.updatedAt).toLocaleString()}</dd>

        <dt>{t('resources.infoId')}</dt>
        <dd>{r.id}</dd>
      </dl>

      {/*
        ⚠️ Markdown 必须经过 rehype-sanitize 再渲染。

        body 是**用户/管理员提交的内容**，而 react-markdown 默认允许原始 HTML。
        不过滤的话，一个 <img onerror=...> 就能在每个访问者浏览器里执行脚本。
        M2 开放用户提交之后，这条防线会变成必需项 —— 现在就先装上，免得那时候忘记。
      */}
      <div className="markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={{
            // 正文里的链接一律新窗口打开，并带上 noopener/noreferrer：
            // 否则被链接的页面能通过 window.opener 操作我们的页面。
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                {children}
              </a>
            ),
          }}
        >
          {r.body}
        </ReactMarkdown>
      </div>

      <RelatedResources currentId={r.id} tag={r.tags[0]} />
    </article>
  );
}

/**
 * 同标签的其它条目。
 *
 * 复用现有的列表接口（`?tag=`）而不是新增一个"相关推荐"端点 —— 在 M1 的规模下
 * 这只是把同一个查询再跑一次，不值得为它加一套后端逻辑。
 */
function RelatedResources({ currentId, tag }: { currentId: string; tag?: string }) {
  const { t } = useTranslation();
  const state = useAsync(
    (signal) => (tag ? fetchResources({ tag, pageSize: 6 }, signal) : Promise.resolve(null)),
    [tag],
  );

  if (!tag || state.status !== 'ok' || !state.data) return null;

  const others = state.data.items.filter((i) => i.id !== currentId).slice(0, 5);
  if (others.length === 0) return null;

  return (
    <section className="related">
      <h2 className="related__title">
        {t('resources.related')} · <span className="tagchip tagchip--sm">{tag}</span>
      </h2>
      <ul className="reslist">
        {others.map((item) => (
          // 复用列表页的卡片组件 —— 之前这里自己写了一份精简版，
          // 结果是那一份只有标题可点。共用之后"点卡片任何位置"对两处同时成立。
          <ResourceCard key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}

/** 详情页信息表要显示图标来源，所以这里也保留一份（和 ResourceIcon 保持一致）。 */
function faviconOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    return `${u.origin}/favicon.ico`;
  } catch {
    return null;
  }
}

/** 供 fetchResource 的错误分支判断用。导出是为了让调用方能直接 instanceof。 */
export { ApiError };
