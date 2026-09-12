import type { ResourceDetail as Resource } from '@mcsr/shared/resources';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { Markdown } from '@/components/Markdown';
import { MarksPanel, RatingStars } from '@/components/MarksPanel';
import { ModerationBar } from '@/components/ModerationBar';
import { ResourceCard } from '@/components/ResourceCard';
import { ResourceIcon } from '@/components/ResourceIcon';
import { ResourceVideoEmbed } from '@/components/ResourceVideoEmbed';
import { ApiError, fetchResource, fetchResources } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCan } from '@/lib/capabilities';
import { kindMightEmbedVideo, resourceKindLabel } from '@/lib/resourceKind';
import { useAsync } from '@/lib/useAsync';

export function ResourceDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const state = useAsync<Resource>((signal) => fetchResource(id, signal), [id]);
  // 只为了决定"建议修改"按不按钮显示
  const auth = useAuth();
  // "这是不是内容编辑" —— editUnpublished 恰好只有 editor / admin 有
  const isContentEditor = useCan('resource.editUnpublished');

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
            {/* 平均分是公开信息，放在徽章那一排里 —— 它是"这条内容值不值得点"的一部分 */}
            <RatingStars rating={r.rating} />
            <span className="badge badge--kind">{resourceKindLabel(r.kind, t)}</span>
            <span className="badge badge--kind">
              {r.lang === 'zh-CN' ? t('resources.langZh') : t('resources.langEn')}
            </span>
          </div>

          <a className="cta" href={r.url} target="_blank" rel="noopener noreferrer">
            {t('resources.visit')} ↗
          </a>

          {/*
            修改入口。**文案按能力区分**：

              · 内容编辑 / 管理员 → 「修改」（这是他们的日常工作）
              · 普通用户         → 「建议修改」

            ⚠️ 两者点到的是**同一个页面、同一套流程**（都要过审核）——
               区别只在用词。为什么不给 editor 一条"直接生效"的捷径：
               审核的意义是"改动有第二个人看过"，而 editor 自己**本来就有审核权**
               （他可以改完直接去队列里批掉自己的那一版，见下面的提示）。
               与其造一条绕过审核的暗道，不如让两步都看得见。

            已登录且邮箱已验证才显示：这是提交类动作的共同门槛，
            和服务端 checkPermission 用的是同一份矩阵。
          */}
          {auth.user?.emailVerified ? (
            <div className="detail__actions">
              <Link className="ghostbtn" to={`/resources/${encodeURIComponent(r.id)}/edit`}>
                {isContentEditor ? t('edit.modifyAction') : t('edit.suggestAction')}
              </Link>
              {isContentEditor ? (
                <span className="detail__actions-hint">{t('edit.editorHint')}</span>
              ) : null}
            </div>
          ) : null}

          <p className="detail__updated">
            {t('resources.lastUpdated', { date: new Date(r.updatedAt).toLocaleDateString() })}
          </p>
        </div>
      </header>

      <MarksPanel resourceId={r.id} rating={r.rating} />

      <ModerationBar resource={r} />

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

      {/*
        ★ 「视频资料」条目在这里嵌播放器。
        
        ⚠️ 判据是 `kindMightEmbedVideo(r.kind)` **加上** "URL 真的能解析成视频"
            —— 两个条件缺一不可：
              · 只看 kind：把 kind 设成 video 但贴了普通网页链接的条目会渲染出
                一个**空白播放器框**，看起来像我们的播放器坏了；
              · 只看 URL：会把资源库里任何一条恰好像视频链接的普通资料也嵌出来。
            真正的解析在 `ResourceVideoEmbed` 里做，解析不出来时它返回 `null`，
            页面就什么都不多画 —— 上面那张信息表里的外链照旧，那是兜底出口。
      */}
      {kindMightEmbedVideo(r.kind) ? <ResourceVideoEmbed url={r.url} title={r.title} /> : null}

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
        <dd>{resourceKindLabel(r.kind, t)}</dd>

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

        body 是**用户提交的内容**，而 react-markdown 默认允许原始 HTML。
        不过滤的话，一个 <img onerror=...> 就能在每个访问者浏览器里执行脚本。

        这段过滤现在收在 components/Markdown.tsx 里，是**唯一**的渲染入口 ——
        详情页、提交预览、审核对比都走它。以前这里也有一份自己的配置，
        于是"新页面忘了写 rehypePlugins"就成了一种不会报错的漏洞。
      */}
      <Markdown>{r.body}</Markdown>

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
