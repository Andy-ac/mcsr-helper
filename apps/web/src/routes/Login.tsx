import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Field, Notice } from '@/components/Form';
import { login } from '@/lib/api';
import { useApiErrorText, useAuth } from '@/lib/auth';

/**
 * 登录页。
 *
 * 关于 `?next=`：登录之后回到用户原本想去的地方。
 *
 * ⚠️ 只接受**站内相对路径**。如果是完整 URL 就忽略它 —— 否则
 *    `?next=https://evil.example` 会把用户在成功登录后送到钓鱼站，
 *    而用户刚输完密码，警惕性最低。这是最经典的开放重定向。
 */
export function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const errorText = useApiErrorText();
  const { refresh } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rawNext = params.get('next') ?? '/';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      // 登录接口已经把会话 cookie 下发了，这里刷新一下上下文即可
      await refresh();
      navigate(next, { replace: true, viewTransition: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="pagehead">
        <h1 className="pagehead__title">{t('auth.loginTitle')}</h1>
        <p className="pagehead__sub">{t('auth.loginSubtitle')}</p>
      </header>

      <form className="authform" onSubmit={onSubmit} noValidate>
        {error ? <Notice kind="bad">{error}</Notice> : null}

        <Field id="login-email" label={t('auth.email')}>
          <input
            id="login-email"
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

        <Field id="login-password" label={t('auth.password')}>
          <input
            id="login-password"
            className="mcsr-field__input mcsr-field__input--prose"
            type="password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('auth.passwordPlaceholder')}
            // current-password：让密码管理器知道这是"已有密码"，
            // 而不是"设新密码"。填错会导致它去生成一个新密码。
            autoComplete="current-password"
            required
          />
        </Field>

        <div className="authform__actions">
          <button type="submit" className="cta" disabled={busy}>
            {busy ? t('auth.loggingIn') : t('auth.loginAction')}
          </button>
          <Link className="authform__link" to="/reset-password">
            {t('auth.forgotPassword')}
          </Link>
        </div>

        <p className="authform__alt">
          {t('auth.noAccount')} <Link to="/register">{t('auth.registerAction')}</Link>
        </p>
      </form>
    </>
  );
}
