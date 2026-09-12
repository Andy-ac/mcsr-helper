import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Field, Notice } from '@/components/Form';
import { register } from '@/lib/api';
import { useApiErrorText } from '@/lib/auth';

/**
 * 注册页。
 *
 * ⚠️ 注册**不会自动登录**，而且无论邮箱是否已注册，服务端的响应都完全一致。
 *
 * 所以这个页面在提交成功后**不能**说"注册成功"，也不能跳转到登录页 ——
 * 因为那个邮箱可能已经有账号了，跳登录页等于变相告诉了用户"这邮箱没注册过"，
 * 把服务端刻意堵上的账号枚举又从前端漏了出来。
 * 正确的做法是停在这一页，显示一句同时覆盖两种情况的话。
 */
export function Register() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const errorText = useApiErrorText();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await register({
        email,
        password,
        displayName,
        // 用当前界面语言决定验证邮件的语言 —— 用户看什么语言的界面，
        // 就该收到什么语言的邮件
        locale: i18n.language === 'en' ? 'en' : 'zh-CN',
      });
      setDone(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <>
        <header className="pagehead">
          <h1 className="pagehead__title">{t('auth.registerTitle')}</h1>
        </header>
        <div className="authform">
          <Notice kind="ok">
            <p>{t('auth.registerDone')}</p>
            <p className="notice__sub">{t('auth.registerDoneHint')}</p>
          </Notice>
          <div className="authform__actions">
            <button
              type="button"
              className="cta"
              onClick={() => navigate('/login', { viewTransition: true })}
            >
              {t('auth.loginAction')}
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="pagehead">
        <h1 className="pagehead__title">{t('auth.registerTitle')}</h1>
        <p className="pagehead__sub">{t('auth.registerSubtitle')}</p>
      </header>

      <form className="authform" onSubmit={onSubmit} noValidate>
        {error ? <Notice kind="bad">{error}</Notice> : null}

        <Field id="reg-name" label={t('auth.displayName')}>
          <input
            id="reg-name"
            className="mcsr-field__input mcsr-field__input--prose"
            type="text"
            name="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t('auth.displayNamePlaceholder')}
            // nickname：让密码管理器把它当作用户名候选存起来
            autoComplete="nickname"
            required
          />
        </Field>

        <Field id="reg-email" label={t('auth.email')}>
          <input
            id="reg-email"
            className="mcsr-field__input mcsr-field__input--prose"
            type="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('auth.emailPlaceholder')}
            autoComplete="email"
            required
          />
        </Field>

        <Field id="reg-password" label={t('auth.password')} hint={t('auth.passwordPlaceholder')}>
          <input
            id="reg-password"
            className="mcsr-field__input mcsr-field__input--prose"
            type="password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            // new-password：告诉密码管理器这是设置新密码，该生成一个强密码。
            // 写成 current-password 的话它只会去查已有记录，什么都填不出来。
            autoComplete="new-password"
            required
          />
        </Field>

        <div className="authform__actions">
          <button type="submit" className="cta" disabled={busy}>
            {busy ? t('auth.registering') : t('auth.registerAction')}
          </button>
        </div>

        <p className="authform__alt">
          {t('auth.hasAccount')} <Link to="/login">{t('auth.loginAction')}</Link>
        </p>
      </form>
    </>
  );
}
