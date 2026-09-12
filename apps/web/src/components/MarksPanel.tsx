import {
  type MarksInput,
  PERSONAL_NOTE_MAX,
  RATING_MAX,
  RATING_MIN,
  type ResourceMarks,
} from '@mcsr/shared/resources';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { em } from '@/components/Emphasis';
import { fetchMarks, saveMarks } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/**
 * 条目页上的「我的标记」：收藏 / 评分 / 备注。
 *
 * ---------------------------------------------------------------------------
 * 三条设计决定，都写在界面上让用户看得见
 * ---------------------------------------------------------------------------
 *  1. **备注是私有的** —— 界面上明说"只有你自己看得到"。
 *     不写清楚的话，用户会以为那是对外可见的评论，于是要么不敢写，
 *     要么把它当公共内容写 —— 两种都不对。
 *  2. **评分可以改，也可以取消** —— "取消"是评分旁边的一个独立动作，
 *     而不是"再点一次同一颗星"。点同一颗星再来一次到底该是"取消"
 *     还是"没变化"，两种理解都成立，所以不给它这个歧义。
 *  3. **未登录也能看到自己的状态**（空），但按钮点下去是登录入口 ——
 *     不做一个点了没反应的禁用按钮。
 */
export function MarksPanel({
  resourceId,
  /** 公开的平均分，由详情接口带下来 */
  rating,
}: {
  resourceId: string;
  rating: { average: number | null; count: number };
}) {
  const { t } = useTranslation();
  const auth = useAuth();
  const [marks, setMarks] = useState<ResourceMarks | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 评分聚合的本地覆盖：自己刚打完分就立刻反映在显示的平均分上 */
  const [liveRating, setLiveRating] = useState(rating);

  useEffect(() => {
    setLiveRating(rating);
  }, [rating]);

  useEffect(() => {
    if (!auth.user) {
      setMarks(null);
      setNoteDraft('');
      return;
    }
    const controller = new AbortController();
    fetchMarks(resourceId, controller.signal)
      .then((r) => {
        setMarks(r.marks);
        setNoteDraft(r.marks?.note ?? '');
      })
      .catch(() => {
        /* 读不到就当没标记过 —— 这是展示性信息，不值得为它显示错误 */
      });
    return () => controller.abort();
  }, [resourceId, auth.user]);

  async function save(input: MarksInput) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const result = await saveMarks(resourceId, input);
      setMarks(result.marks);
      setNoteDraft(result.marks.note ?? '');
      setSaved(true);
      // 一秒后把"已保存"收起来，否则它会一直挂在那里
      globalThis.setTimeout(() => setSaved(false), 1500);
      /*
       * 评分变了就用本地推算更新显示的平均分 —— 自己那一票要立刻看得见。
       * ⚠️ 这只是**让按钮有反馈**，不是权威值：下次加载会被服务端覆盖。
       *    不做这一步的话，点完星星平均分一动不动，看起来像没生效。
       */
      if (input.rating !== undefined) {
        setLiveRating((prev) => recompute(prev, input.rating ?? null, marks?.rating ?? null));
      }
    } catch {
      setError(t('marks.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (!auth.user) {
    return (
      <section className="marks">
        <div className="marks__head">
          <RatingStars rating={liveRating} />
        </div>
        <p className="muted">{t('marks.needLogin')}</p>
        <Link className="cta" to={`/login?next=${encodeURIComponent(`/resources/${resourceId}`)}`}>
          {t('nav.login')}
        </Link>
      </section>
    );
  }

  const favorite = marks?.favorite ?? false;
  const myRating = marks?.rating ?? null;
  const noteChanged = noteDraft.trim() !== (marks?.note ?? '');

  return (
    <section className="marks">
      <div className="marks__head">
        <RatingStars rating={liveRating} />
      </div>

      <div className="marks__row">
        <button
          type="button"
          className={favorite ? 'tagchip tagchip--on' : 'tagchip'}
          disabled={busy}
          onClick={() => void save({ favorite: !favorite })}
        >
          {favorite ? `★ ${t('marks.favorited')}` : `☆ ${t('marks.favorite')}`}
        </button>

        {/*
          ⚠️ 这里用 <fieldset> 而不是 <div role="group">：
              "一组相关控件 + 一个说明它们的标题"正是 fieldset/legend 的定义，
              而 role="group" 是它的近似替代（lint 也会提示）。
              语义正确的东西，读屏和自动化测试都不用额外适配。
        */}
        <fieldset className="marks__stars">
          <legend className="marks__label">{t('marks.myRating')}</legend>
          {Array.from({ length: RATING_MAX }, (_, i) => i + RATING_MIN).map((n) => (
            <button
              key={n}
              type="button"
              className={`starbtn${myRating !== null && n <= myRating ? ' is-on' : ''}`}
              disabled={busy}
              aria-label={t('marks.rateN', { n })}
              onClick={() => void save({ rating: n })}
            >
              {myRating !== null && n <= myRating ? '★' : '☆'}
            </button>
          ))}
          {/* 「取消评分」是独立按钮 —— 见文件头的第 2 条 */}
          {myRating !== null ? (
            <button
              type="button"
              className="authform__link"
              disabled={busy}
              onClick={() => void save({ rating: null })}
            >
              {t('marks.clearRating')}
            </button>
          ) : null}
        </fieldset>
      </div>

      <div className="marks__note">
        <label className="mcsr-field__label" htmlFor="marks-note">
          {t('marks.note')}
        </label>
        <textarea
          id="marks-note"
          className="mcsr-field__input mcsr-field__input--prose"
          rows={3}
          maxLength={PERSONAL_NOTE_MAX}
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          placeholder={t('marks.notePlaceholder')}
        />
        <p className="mcsr-field__hint">
          {em(t('marks.noteHint', { used: noteDraft.trim().length }))}
        </p>
        <div className="marks__actions">
          <button
            type="button"
            className="ghostbtn"
            disabled={busy || !noteChanged}
            onClick={() => void save({ note: noteDraft.trim() || null })}
          >
            {noteSaveLabel(busy, noteChanged, t)}
          </button>
          {saved ? <span className="marks__saved">{t('marks.saved')}</span> : null}
          {error ? <span className="fielderr">{error}</span> : null}
        </div>
      </div>
    </section>
  );
}

/** 按钮文字：忙碌 > 有改动 > 没改动。三种状态一眼能分。 */
function noteSaveLabel(busy: boolean, changed: boolean, t: (key: string) => string): string {
  if (busy) return t('marks.saving');
  return changed ? t('marks.saveNote') : t('marks.noteSaved');
}

/** 1–5 颗星 + 平均分。没有评分时显示"暂无评分"，**不是 0.0**。 */
export function RatingStars({ rating }: { rating: { average: number | null; count: number } }) {
  const { t } = useTranslation();

  if (rating.count === 0 || rating.average === null) {
    return <span className="rating rating--empty">{t('marks.noRating')}</span>;
  }

  const filled = Math.round(rating.average);
  return (
    <span
      className="rating"
      title={t('marks.ratingTitle', { avg: rating.average, count: rating.count })}
    >
      <span className="rating__stars" aria-hidden="true">
        {'★'.repeat(filled)}
        {'☆'.repeat(RATING_MAX - filled)}
      </span>
      <span className="rating__value">{rating.average.toFixed(1)}</span>
      <span className="rating__count">{t('marks.ratingCount', { count: rating.count })}</span>
    </span>
  );
}

/**
 * 本地推算新的平均值。
 *
 * ⚠️ 这是**估算**，不是权威值 —— 权威值在服务端。它只用来让按钮点下去
 *    立刻有反馈（"我这一票算进去了"）。真正的数字在下一次加载时会被服务端覆盖。
 *    宁可这样，也不要"点完星星平均分一动不动"，那看起来像没生效。
 */
function recompute(
  prev: { average: number | null; count: number },
  next: number | null,
  mine: number | null,
): { average: number | null; count: number } {
  // 我原来那一票要从总分里扣掉，再加上新的一票
  const sum = (prev.average ?? 0) * prev.count - (mine ?? 0) + (next ?? 0);

  let count = prev.count;
  if (mine === null && next !== null)
    count += 1; // 从"没评过"变成"评了"
  else if (mine !== null && next === null) count -= 1; // 取消了评分

  if (count <= 0) return { average: null, count: 0 };
  return { average: Math.round((sum / count) * 10) / 10, count };
}
