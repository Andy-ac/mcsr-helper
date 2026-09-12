import type { FavoriteItem } from '@mcsr/shared/resources';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Notice } from '@/components/Form';
import { RatingStars } from '@/components/MarksPanel';
import { fetchFavorites } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAsync } from '@/lib/useAsync';

/**
 * 我的收藏 —— `/me/favorites`。
 *
 * 收藏如果没有一个地方能看，它就只是个"点一下变红"的装饰。
 * 这个页面还顺带把**备注**和**评分**一起列出来 —— 它们本来就是同一次
 * 决策的三面：为什么收藏（备注）、值几分（评分）、收了什么（列表）。
 */
export function Favorites() {
  const { t } = useTranslation();
  const auth = useAuth();
  const state = useAsync((signal) => fetchFavorites(signal), [auth.user?.id]);

  if (auth.loading) return <p className="state">{t('common.loading')}</p>;

  if (!auth.user) {
    return (
      <>
        <header className="pagehead">
          <h1 className="pagehead__title">{t('marks.favoritesTitle')}</h1>
        </header>
        <Notice kind="info">{t('marks.needLogin')}</Notice>
        <p className="submitgate">
          <Link className="cta" to={`/login?next=${encodeURIComponent('/me/favorites')}`}>
            {t('nav.login')}
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <header className="pagehead">
        <h1 className="pagehead__title">{t('marks.favoritesTitle')}</h1>
        <p className="pagehead__sub">{t('marks.favoritesSubtitle')}</p>
      </header>

      {state.status === 'loading' ? <p className="state">{t('common.loading')}</p> : null}
      {state.status === 'error' ? <Notice kind="bad">{t('marks.loadFailed')}</Notice> : null}

      {state.status === 'ok' ? (
        state.data.items.length === 0 ? (
          <div className="state state--empty">
            <p className="state__title">{t('marks.noFavorites')}</p>
            <p className="state__hint">{t('marks.noFavoritesHint')}</p>
          </div>
        ) : (
          <ul className="reviewlist">
            {state.data.items.map((item) => (
              <FavoriteCard key={item.id} item={item} />
            ))}
          </ul>
        )
      ) : null}
    </>
  );
}

function FavoriteCard({ item }: { item: FavoriteItem }) {
  const { t } = useTranslation();

  return (
    <li className={`minecard${item.published ? '' : ' rescard--hidden'}`}>
      <div className="minecard__head">
        <span className={`badge badge--kind`}>
          {item.kind === 'tool' ? t('resources.kindTool') : t('resources.kindWebsite')}
        </span>
        <span className="minecard__title">{item.title}</span>
        {item.marks.rating !== null ? (
          <RatingStars rating={{ average: item.marks.rating, count: 1 }} />
        ) : null}
        <span className="minecard__date">
          {new Date(item.marks.updatedAt).toLocaleDateString()}
        </span>
      </div>

      {item.summary ? <p className="minecard__hint">{item.summary}</p> : null}

      {/*
        备注单独一块 —— 它是这个页面上最有价值的东西（用户在别处看不到它）。
        用等宽字体之外的正文样式，因为它是**自己写给自己的话**，不是标签。
      */}
      {item.marks.note ? (
        <div className="minecard__reason minecard__reason--mine">
          <span className="minecard__reasonlabel">{t('marks.noteLabel')}</span>
          <p className="minecard__reasontext">{item.marks.note}</p>
        </div>
      ) : null}

      <div className="minecard__meta">
        {item.published ? (
          <Link to={`/resources/${encodeURIComponent(item.id)}`}>{t('mine.openItem')}</Link>
        ) : (
          /*
           * 被下架/驳回的条目仍留在收藏里（用户收藏的是"这个东西"，
           * 不是为了"这条记录"），但**不能点进去** —— 公开接口会 404。
           * 所以要说明它为什么点不动，而不是给一个坏链接。
           */
          <span className="muted">{t('marks.gone')}</span>
        )}
        <a href={item.url} target="_blank" rel="noopener noreferrer nofollow">
          {t('resources.visit')} ↗
        </a>
      </div>
    </li>
  );
}
