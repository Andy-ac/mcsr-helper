import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Notice } from '@/components/Form';
import { logout, sendVerifyEmail } from '@/lib/api';
import { useApiErrorText, useAuth } from '@/lib/auth';

/**
 * 账号页。
 *
 * M5 会在这里叠上个人主页、MC 绑定、关注列表。现在它只做一件事：
 * **让用户看得清自己的状态** —— 尤其是"邮箱验证了没有"，
 * 因为那是唯一挡住他提交内容的东西。
 */
export function Account() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const errorText = useApiErrorText();
  const { user, loading, setUser } = useAuth();

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);

  if (loading) {
    return <p className="state">{t('common.loading')}</p>;
  }

  if (!user) {
    return (
      <>
        <header className="pagehead">
          <h1 className="pagehead__title">{t('auth.accountTitle')}</h1>
        </header>
        <div className="authform">
          <Notice kind="info">{t('auth.loginSubtitle')}</Notice>
          <div className="authform__actions">
            <Link className="cta" to="/login">
              {t('auth.loginAction')}
            </Link>
            <Link className="authform__link" to="/register">
              {t('auth.registerAction')}
            </Link>
          </div>
        </div>
      </>
    );
  }

  const roleLabel =
    user.role === 'admin'
      ? t('auth.roleAdmin')
      : user.role === 'reviewer'
        ? t('auth.roleReviewer')
        : t('auth.roleUser');

  async function onResend() {
    setNotice(null);
    setBusy(true);
    try {
      const res = await sendVerifyEmail();
      setNotice({
        kind: 'ok',
        text: res.alreadyVerified ? t('auth.accountVerified') : t('auth.verifyResent'),
      });
    } catch (err) {
      setNotice({ kind: 'bad', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  async function onLogout() {
    setNotice(null);
    setBusy(true);
    try {
      await logout();
      // 先清本地状态再跳转：反过来的话，跳转过程中侧边栏会有一瞬间
      // 还显示着已登录的用户名，看起来像没退成功
      setUser(null);
      navigate('/', { replace: true, viewTransition: true });
    } catch (err) {
      setNotice({ kind: 'bad', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="pagehead">
        <h1 className="pagehead__title">{t('auth.accountTitle')}</h1>
      </header>

      <div className="authform authform--wide">
        {notice ? <Notice kind={notice.kind}>{notice.text}</Notice> : null}

        {/*
          邮箱未验证时把提示放在最上面，而且用 ok/bad 之外的 info 色 ——
          它不是错误，是一个"还没做的事"。用红色会让人以为账号出了问题。
        */}
        {!user.emailVerified ? (
          <Notice kind="info">
            <p>{t('auth.canSubmitNo')}</p>
          </Notice>
        ) : null}

        <dl className="infotable">
          <dt>{t('auth.email')}</dt>
          <dd>{user.email}</dd>

          <dt>{t('auth.displayName')}</dt>
          <dd>{user.displayName}</dd>

          <dt>{t('auth.accountVerified')}</dt>
          <dd>
            {user.emailVerified ? (
              <span className="pill pill--ok">{t('auth.accountVerified')}</span>
            ) : (
              <span className="pill pill--wait">{t('auth.accountUnverified')}</span>
            )}
          </dd>

          <dt>{t('auth.canSubmitYes')}</dt>
          <dd>
            {user.canSubmit ? (
              <span className="pill pill--ok">{t('auth.canSubmitYes')}</span>
            ) : (
              <span className="pill pill--bad">{t('auth.canSubmitNo')}</span>
            )}
          </dd>

          <dt>{t('auth.accountRole')}</dt>
          <dd>{roleLabel}</dd>

          <dt>{t('auth.accountJoined')}</dt>
          <dd>{new Date(user.createdAt).toLocaleDateString()}</dd>
        </dl>

        <div className="authform__actions">
          {!user.emailVerified ? (
            <button type="button" className="cta" onClick={onResend} disabled={busy}>
              {busy ? t('auth.verifyResending') : t('auth.verifyResend')}
            </button>
          ) : null}
          <button type="button" className="mcsr-btn" onClick={onLogout} disabled={busy}>
            {busy ? t('auth.loggingOut') : t('auth.logoutAction')}
          </button>
        </div>
      </div>
    </>
  );
}
