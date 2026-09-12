import type { ReviewDetail } from '@mcsr/shared/review';
import { REJECT_REASON_MAX, REVIEW_TYPE_LABELS } from '@mcsr/shared/review';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { Notice } from '@/components/Form';
import { ReviewError } from '@/components/ReviewError';
import { ApiError, approveReview, fetchReviewDetail, rejectReview } from '@/lib/api';
import { useCanSelfReview } from '@/lib/capabilities';
import { reviewType, reviewUiFor } from '@/lib/reviewTypes';
import { useReview } from '@/lib/useReview';

interface ActionResult {
  kind: 'approved' | 'rejected';
  revision: number;
  /** 驳回且原本已发布时，服务端说线上版本保留了 */
  liveVersionKept: boolean;
}

/**
 * 审核详情 —— `/review/:type/:id`。**完全通用**。
 *
 * 页面上只有三件事跟类型无关：要审的是什么（队列项）、批准还是驳回、
 * 以及审核结果。类型相关的那部分内容交给注册表里的 `Detail` 组件渲染
 * （见 lib/reviewTypes.tsx）—— 所以 M4 加日历、种子、视频时，
 * **这个文件一行都不用改**。
 *
 * 权限判断同样交给服务端：能拿到 200 就是有权限，401/403 由 ReviewError 分辨。
 */
export function ReviewDetailPage() {
  const { t } = useTranslation();
  const { type, id = '' } = useParams();
  // 类型先过一遍白名单，拿到的是 ReviewableType | null —— 后面就不需要任何断言
  const known = reviewType(type);
  const ui = reviewUiFor(type);
  const canSelfReview = useCanSelfReview();

  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  /*
   * ⚠️ 类型不认识就**不发请求**。
   *    否则 `/review/foo/1` 会打出一个 404，然后被当成"这个条目已经被处理掉了"，
   *    显示一句完全不沾边的提示。地址栏里是任意字符串，必须先挡住。
   */
  const { state, reload } = useReview(
    (signal) =>
      known ? fetchReviewDetail(known, id, signal) : Promise.resolve<ReviewDetail | null>(null),
    [known, id],
  );

  if (!ui) {
    return (
      <>
        <header className="pagehead">
          <h1 className="pagehead__title">{t('review.detailTitle')}</h1>
        </header>
        <Notice kind="bad">{t('review.unknownType')}</Notice>
        <p className="submitgate">
          <Link className="cta" to="/review">
            {t('review.backToQueue')}
          </Link>
        </p>
      </>
    );
  }

  if (state.status === 'loading') return <p className="state">{t('common.loading')}</p>;
  if (state.status === 'error') {
    return (
      <>
        <header className="pagehead">
          <h1 className="pagehead__title">{t('review.detailTitle')}</h1>
        </header>
        <ReviewError error={state.error} />
      </>
    );
  }
  if (!state.data) return null;

  const detail = state.data;
  const { item } = detail;
  const Body = ui.Detail;

  async function act(kind: 'approve' | 'reject') {
    setActionError(null);
    setBusy(kind);
    try {
      if (kind === 'approve') {
        const res = await approveReview(item.type, item.id);
        setResult({ kind: 'approved', revision: res.revision, liveVersionKept: true });
      } else {
        const res = await rejectReview(item.type, item.id, reason.trim());
        setResult({
          kind: 'rejected',
          revision: res.revision,
          liveVersionKept: res.liveVersionKept,
        });
      }
    } catch (err) {
      /*
       * 409 = 另一位审核员抢先处理了。这不是"出错了"，而是并发审核的**正常结果**，
       * 所以文案要说清楚发生了什么，并给回队列的入口，而不是让审核员以为操作失败、
       * 再点一次（再点还是 409）。
       */
      if (err instanceof ApiError && err.status === 409) {
        setGone(true);
        setActionError(t('review.alreadyHandled'));
      } else if (err instanceof ApiError && err.status === 403) {
        setActionError(t('review.forbidden'));
      } else {
        setActionError(t('review.actionFailed'));
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <header className="pagehead">
        <Link className="detail__back" to="/review">
          ← {t('review.backToQueue')}
        </Link>
        <h1 className="pagehead__title">{item.title}</h1>
        <div className="reviewhead__meta">
          <span className={`badge badge--type badge--type-${item.type}`}>
            {REVIEW_TYPE_LABELS[item.type] ?? item.type}
          </span>
          <span className={`badge ${item.isEdit ? 'badge--edit' : 'badge--new'}`}>
            {item.isEdit ? t('review.isEdit') : t('review.isNew')}
          </span>
          <span className="reviewcard__rev">r{item.revision}</span>
          <span className="muted">{item.authorName ?? t('review.unknownAuthor')}</span>
          <span className="muted">{new Date(item.createdAt).toLocaleString()}</span>
        </div>
      </header>

      {/*
        作者之前被驳回过几次 —— 审核员需要这个上下文。
        一个被驳回过五次的人提交的东西，和一个新人第一次提交的东西，
        值得花的注意力不一样。但这也**只是参考**，不是判据，
        所以只显示次数，不显示"请注意此人"之类的暗示。
      */}
      {detail.previousRejections > 0 ? (
        <p className="muted">{t('review.prevRejections', { count: detail.previousRejections })}</p>
      ) : null}

      {item.isEdit ? <p className="submitnote">{t('review.editExplain')}</p> : null}

      <Body detail={detail} />

      {result ? (
        <>
          <Notice kind={result.kind === 'approved' ? 'ok' : 'info'}>
            {result.kind === 'approved'
              ? t('review.approvedNotice', { revision: result.revision })
              : t('review.rejectedNotice', { revision: result.revision })}
            {/* 驳回一个已发布条目的修改时，必须说清楚老条目还在 ——
                否则审核员会以为自己的操作把线上内容撤掉了。 */}
            {result.kind === 'rejected' && result.liveVersionKept
              ? ` ${t('review.liveKept')}`
              : null}
          </Notice>
          <div className="submitdone">
            <Link className="cta" to="/review">
              {t('review.backToQueue')}
            </Link>
            <Link className="authform__link" to={ui.itemPath(item.id)}>
              {t('review.openItem')}
            </Link>
          </div>
        </>
      ) : (
        <section className="reviewactions">
          <h2 className="reviewview__subtitle">{t('review.decide')}</h2>

          {actionError ? <Notice kind="bad">{actionError}</Notice> : null}

          {/*
            ★ 自己提交的东西：reviewer 不能批（editor / admin 可以）。
            ⚠️ 提前说清楚，而不是让他点了再吃 403 —— 那不是"防错"，
               那是让人白点一次。文字里要说明**该找谁**。
          */}
          {item.mine && !canSelfReview ? (
            <Notice kind="info">{t('review.selfReviewBlocked')}</Notice>
          ) : null}

          <div className="authform__actions">
            <button
              type="button"
              className="cta"
              disabled={busy !== null || gone || (item.mine && !canSelfReview)}
              onClick={() => act('approve')}
            >
              {busy === 'approve' ? t('review.approving') : t('review.approve')}
            </button>
            <button type="button" className="ghostbtn" onClick={reload} disabled={busy !== null}>
              {t('review.refresh')}
            </button>
          </div>

          <div className="mcsr-field">
            <label className="mcsr-field__label" htmlFor="reject-reason">
              {t('review.rejectReason')}
            </label>
            <textarea
              id="reject-reason"
              className="mcsr-field__input mcsr-field__input--prose"
              rows={3}
              maxLength={REJECT_REASON_MAX}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('review.rejectPlaceholder')}
            />
            {/*
              理由**必填**，和服务端的 RejectInputSchema 一致。
              没有理由的驳回等于让作者瞎猜 —— 他会原样再提交一次，
              然后被同一个人用同一个理由再驳回一次。
              按钮直接禁用，而不是点完再报错：能提前说的事不要留到提交之后。
            */}
            <p className="mcsr-field__hint">
              {t('review.rejectHint', { max: REJECT_REASON_MAX, used: reason.trim().length })}
            </p>
          </div>

          <div className="authform__actions">
            <button
              type="button"
              className="dangerbtn"
              disabled={busy !== null || gone || reason.trim().length === 0}
              onClick={() => act('reject')}
            >
              {busy === 'reject' ? t('review.rejecting') : t('review.reject')}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
