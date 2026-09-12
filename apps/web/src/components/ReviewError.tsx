import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { Notice } from '@/components/Form';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/**
 * 审核页取数失败时的提示。
 *
 * ⚠️ 401 和 403 **必须分开**：
 *
 *   · 401 是"你还没登录"。用户的下一步是明确的 —— 登录。所以这里直接给
 *     登录入口，并带上 `?next=`，登录完回到他刚才想看的那页。
 *   · 403 是"你登录了，但没有这个权限"。这时给登录入口是**错的** ——
 *     用户会以为自己掉线了，重新登录一遍，然后再看到同一个 403，
 *     最后得出结论"这网站坏了"。
 *
 * 这两种情况在服务端是两个不同的状态码（见 auth/middleware.ts 的三个拒绝理由），
 * 到了界面上如果都变成"出错了"，那服务端的区分就白做了。
 */
export function ReviewError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const location = useLocation();

  if (error instanceof ApiError) {
    if (error.status === 401) {
      return (
        <>
          <Notice kind="info">{t('review.needLogin')}</Notice>
          <p className="submitgate">
            <Link className="cta" to={`/login?next=${encodeURIComponent(location.pathname)}`}>
              {t('nav.login')}
            </Link>
          </p>
        </>
      );
    }

    if (error.status === 403) {
      return (
        <>
          <Notice kind="bad">{t('review.forbidden')}</Notice>
          <p className="muted">
            {auth.user
              ? t('review.forbiddenHint', { name: auth.user.displayName })
              : t('review.forbiddenHintAnon')}
          </p>
        </>
      );
    }

    if (error.status === 404) {
      return (
        <>
          <Notice kind="info">{t('review.gone')}</Notice>
          <p className="submitgate">
            <Link className="cta" to="/review">
              {t('review.backToQueue')}
            </Link>
          </p>
        </>
      );
    }
  }

  return <Notice kind="bad">{t('review.loadFailed')}</Notice>;
}
