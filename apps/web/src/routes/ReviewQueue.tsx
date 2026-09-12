import { REVIEW_TYPE_LABELS, type ReviewableType } from '@mcsr/shared/review';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ReviewError } from '@/components/ReviewError';
import { fetchReviewQueue } from '@/lib/api';
import { reviewUiFor } from '@/lib/reviewTypes';
import { useReview } from '@/lib/useReview';

/**
 * 待审队列 —— `/review`。**完全通用**，不含任何类型的细节。
 *
 * ---------------------------------------------------------------------------
 * 为什么队列是跨类型的一张表，而不是每个类型一页
 * ---------------------------------------------------------------------------
 * 审核员早上打开网站想知道的是"今天有多少活"，不是"资源库有多少活"。
 * 每类内容一个页面的话，他要挨个点一遍才知道有没有事情做 ——
 * 而且漏点一个就等于漏审一批，且没有任何提示。
 *
 * 所以列表是一张表，类型只是行上的一个标签；筛选标签提供"只看某一类"，
 * 但默认永远是全部。
 *
 * 这里**不做权限判断**：能拿到 200 就已经是服务端判过的结果。
 * 在界面里再写一遍"我能不能审"，等于把权限规则抄了两份，
 * 而两份规则分叉的时候不会有任何报错 —— 只会静默地允许或拦下错误的人。
 */
export function ReviewQueue() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<ReviewableType | 'all'>('all');

  const { state, reload } = useReview((signal) => fetchReviewQueue(signal), []);

  if (state.status === 'loading') return <p className="state">{t('common.loading')}</p>;
  if (state.status === 'error') {
    return (
      <>
        <header className="pagehead">
          <h1 className="pagehead__title">{t('review.queueTitle')}</h1>
        </header>
        <ReviewError error={state.error} />
      </>
    );
  }

  const { items, total, counts, types } = state.data;
  const shown = filter === 'all' ? items : items.filter((i) => i.type === filter);

  return (
    <>
      <header className="pagehead">
        <div className="pagehead__row">
          <h1 className="pagehead__title">{t('review.queueTitle')}</h1>
          <button type="button" className="ghostbtn" onClick={reload}>
            {t('review.refresh')}
          </button>
        </div>
        <p className="pagehead__sub">
          {total > 0 ? t('review.queueCount', { count: total }) : t('review.queueEmpty')}
        </p>
      </header>

      {/*
        筛选标签。数量直接写在标签上 —— 审核员据此决定"现在要不要点进去"，
        而不用先点开看一眼。只显示服务端注册过的类型（`types`），
        这样 M4 加了日历/种子之后这里会自动多出两个标签，不需要改这个文件。
      */}
      <div className="reviewtabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'all'}
          className={filter === 'all' ? 'is-active' : ''}
          onClick={() => setFilter('all')}
        >
          {t('review.tabAll')}
          <span className="reviewtabs__count">{total}</span>
        </button>
        {types.map((type) => (
          <button
            key={type}
            type="button"
            role="tab"
            aria-selected={filter === type}
            className={filter === type ? 'is-active' : ''}
            onClick={() => setFilter(type)}
          >
            {REVIEW_TYPE_LABELS[type] ?? type}
            <span className="reviewtabs__count">{counts[type] ?? 0}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="state state--empty">
          <p className="state__title">{t('review.nothingPending')}</p>
          <p className="state__hint">{t('review.nothingPendingHint')}</p>
        </div>
      ) : (
        <ul className="reviewlist">
          {shown.map((item) => (
            <li key={`${item.type}:${item.id}`}>
              <Link
                className="reviewcard"
                to={`/review/${item.type}/${encodeURIComponent(item.id)}`}
              >
                <div className="reviewcard__top">
                  <span className={`badge badge--type badge--type-${item.type}`}>
                    {REVIEW_TYPE_LABELS[item.type] ?? item.type}
                  </span>
                  {/*
                    新条目和修改必须一眼分开：前者是"要不要收"，后者是
                    "这处改动能不能接受"，审核时的心理预期完全不同。
                  */}
                  <span className={`badge ${item.isEdit ? 'badge--edit' : 'badge--new'}`}>
                    {item.isEdit ? t('review.isEdit') : t('review.isNew')}
                  </span>
                  {item.mine ? (
                    <span className="badge badge--mine">{t('review.mineBadge')}</span>
                  ) : null}
                  {/*
                    ★ Q4c：**过去的事件也进审核队列**，所以队列里真的会有
                    「已经结束」的条目。必须在列表这一层就标出来 ——
                    否则审核员要先点进去、读完内容才发现，而那时他已经
                    按"这是一场将来的比赛"把整条读完了。

                    它是**通用**的标记（QueueItem.expired），不是日历专用的：
                    任何"内容本身有一个会过去的时刻"的类型都用它。
                  */}
                  {item.expired ? (
                    <span className="badge badge--past">{t('calendar.pastBadge')}</span>
                  ) : null}
                  <span className="reviewcard__rev">r{item.revision}</span>
                </div>

                <h2 className="reviewcard__title">{item.title}</h2>
                {item.subtitle ? <p className="reviewcard__sub">{item.subtitle}</p> : null}

                <div className="reviewcard__meta">
                  <span>{item.authorName ?? t('review.unknownAuthor')}</span>
                  <span>{new Date(item.createdAt).toLocaleString()}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* 队列里出现前端不认识的类型时不静默丢弃 —— 那会让审核员以为它不存在。 */}
      {types.some((type) => !reviewUiFor(type)) ? (
        <p className="muted">{t('review.unknownTypeWarning')}</p>
      ) : null}
    </>
  );
}
