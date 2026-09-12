import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Notice } from '@/components/Form';
import { fetchMySubmissions } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAsync } from '@/lib/useAsync';

/**
 * 我的提交 —— `/me/submissions`。
 *
 * ---------------------------------------------------------------------------
 * 为什么这个页面是整套审核管线的**必要**一环，而不是锦上添花
 * ---------------------------------------------------------------------------
 * 服务端强制审核员填写驳回理由（没有理由的驳回等于让作者瞎猜）。
 * 但如果作者没有一个地方能看到那个理由，它写完就进了数据库和审计日志 ——
 * 两处都是给管理人员看的，作者永远不会打开。
 *
 * 作者的体验于是变成：提交 → 过几天回来看 → 条目不见了（未发布的条目
 * 在公开列表里本来就不显示）→ 完全不知道发生了什么 → 原样再提交一次。
 *
 * 所以这个列表存在的意义就一条：**让"已驳回"这三个字后面跟着原因**。
 */
export function MySubmissions() {
  const { t } = useTranslation();
  const auth = useAuth();

  const state = useAsync((signal) => fetchMySubmissions(signal), [auth.user?.id]);

  if (auth.loading) return <p className="state">{t('common.loading')}</p>;

  if (!auth.user) {
    return (
      <>
        <header className="pagehead">
          <h1 className="pagehead__title">{t('mine.title')}</h1>
        </header>
        <Notice kind="info">{t('submit.needLogin')}</Notice>
        <p className="submitgate">
          <Link className="cta" to={`/login?next=${encodeURIComponent('/me/submissions')}`}>
            {t('nav.login')}
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <header className="pagehead">
        <div className="pagehead__row">
          <h1 className="pagehead__title">{t('mine.title')}</h1>
          <Link className="ghostbtn" to="/resources/submit">
            {t('mine.submitNew')}
          </Link>
        </div>
        <p className="pagehead__sub">{t('mine.subtitle')}</p>
      </header>

      {state.status === 'loading' ? <p className="state">{t('common.loading')}</p> : null}
      {state.status === 'error' ? <Notice kind="bad">{t('mine.loadFailed')}</Notice> : null}

      {state.status === 'ok' ? (
        state.data.items.length === 0 ? (
          <div className="state state--empty">
            <p className="state__title">{t('mine.empty')}</p>
            <p className="state__hint">{t('mine.emptyHint')}</p>
          </div>
        ) : (
          <ul className="reviewlist">
            {state.data.items.map((item) => (
              <li key={item.id} className="minecard">
                <div className="minecard__head">
                  {/*
                    状态直接用共用的 status.* 词条（草稿/待审核/已发布/已驳回/已下架）。
                    单独写一套"提交状态"文案的话，同一个状态在两个页面上
                    会有两种叫法，用户要先猜它们是不是一回事。
                  */}
                  <span className={`badge badge--status-${item.status}`}>
                    {t(`status.${item.status}`)}
                  </span>
                  <span className="minecard__title">{item.title}</span>
                  {item.reviewedAt ? (
                    <span className="minecard__date">
                      {t('mine.reviewedAt', {
                        date: new Date(item.reviewedAt).toLocaleDateString(),
                      })}
                    </span>
                  ) : (
                    <span className="minecard__date">
                      {new Date(item.updatedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>

                <div className="minecard__meta">
                  {item.currentRevision ? (
                    <span>{t('mine.liveRevision', { revision: item.currentRevision })}</span>
                  ) : null}
                  {item.pendingRevision ? (
                    <span>{t('mine.pendingRevision', { revision: item.pendingRevision })}</span>
                  ) : null}
                  {item.status === 'published' ? (
                    <Link to={`/resources/${encodeURIComponent(item.id)}`}>
                      {t('mine.openItem')}
                    </Link>
                  ) : null}
                  {/*
                    ⚠️ 「修改并重新提交」只在**没有待审版本**时出现。
                       有待审版本时点进去会拿到 409 already_pending ——
                       与其让用户把一整张表单填完再被拒，不如现在就不给入口，
                       并且说清楚为什么（下面那行 pending 提示）。
                  */}
                  {item.pendingRevision === null ? (
                    <Link to={`/resources/${encodeURIComponent(item.id)}/edit`}>
                      {item.status === 'rejected' ? t('mine.resubmit') : t('mine.edit')}
                    </Link>
                  ) : null}
                </div>

                {item.pendingRevision !== null ? (
                  <p className="minecard__hint">{t('mine.pendingHint')}</p>
                ) : null}

                {/*
                  驳回理由 —— 这个页面上最重要的东西。
                  用醒目的块，而不是折叠起来：作者来这里就是为了看它。
                */}
                {item.lastRejectReason ? (
                  <div className="minecard__reason">
                    <span className="minecard__reasonlabel">{t('mine.rejectReasonTitle')}</span>
                    <p className="minecard__reasontext">{item.lastRejectReason}</p>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </>
  );
}
