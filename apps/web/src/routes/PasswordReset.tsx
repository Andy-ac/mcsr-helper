import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Field, Notice } from '@/components/Form';
import { confirmPasswordReset, requestPasswordReset } from '@/lib/api';
import { useApiErrorText, useAuth } from '@/lib/auth';

/**
 * 找回密码 —— 请求与重置在**同一个路由**上。
 *
 * 为什么不是两个路由：邮件里的链接是 `/reset-password?token=...`
 * （见 services/api/src/email/messages.ts 的 resetUrl）。
 * 用"有没有 token 参数"来分派，邮件链接和手动访问就都落在同一个地方，
 * 不需要把链接地址和路由结构绑死 —— 以后改路由也不用改已经发出去的邮件。
 */
export function PasswordReset() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  return token ? <ResetConfirm token={token} /> : <ResetRequest />;
}

/** 第一步：输入邮箱，请求一封重置邮件。 */
function ResetRequest() {
  const { t } = useTranslation();
  const errorText = useApiErrorText();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await requestPasswordReset(email);
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
          <h1 className="pagehead__title">{t('auth.resetRequestTitle')}</h1>
        </header>
        <div className="authform">
          <Notice kind="ok">
            <p>{t('auth.resetRequestDone')}</p>
            <p className="notice__sub">{t('auth.resetRequestDoneHint')}</p>
          </Notice>
          <div className="authform__actions">
            <Link className="cta" to="/login">
              {t('auth.loginAction')}
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="pagehead">
        <h1 className="pagehead__title">{t('auth.resetRequestTitle')}</h1>
        <p className="pagehead__sub">{t('auth.resetRequestSubtitle')}</p>
      </header>

      <form className="authform" onSubmit={onSubmit} noValidate>
        {error ? <Notice kind="bad">{error}</Notice> : null}

        <Field id="reset-email" label={t('auth.email')}>
          <input
            id="reset-email"
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

        <div className="authform__actions">
          <button type="submit" className="cta" disabled={busy}>
            {busy ? t('auth.resetRequesting') : t('auth.resetRequestAction')}
          </button>
          <Link className="authform__link" to="/login">
            {t('auth.loginAction')}
          </Link>
        </div>
      </form>
    </>
  );
}

/** 第二步：带着邮件里的 token 设置新密码。 */
function ResetConfirm({ token }: { token: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const errorText = useApiErrorText();
  const { setUser } = useAuth();

  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await confirmPasswordReset(token, password);
      /*
       * 服务端在改密码时会把该用户**所有**会话作废（只留当前这个，
       * 而这里是未登录流程，所以是一个不剩）。所以本地也必须清掉登录态 ——
       * 不清的话侧边栏还会显示"已登录"，点进账号页却拿到未登录，
       * 看起来像账号出了问题。
       */
      setUser(null);
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
          <h1 className="pagehead__title">{t('auth.resetOk')}</h1>
        </header>
        <div className="authform">
          <Notice kind="ok">
            <p>{t('auth.resetOkHint')}</p>
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
        <h1 className="pagehead__title">{t('auth.resetTitle')}</h1>
        <p className="pagehead__sub">{t('auth.resetSubtitle')}</p>
      </header>

      <form className="authform" onSubmit={onSubmit} noValidate>
        {error ? <Notice kind="bad">{error}</Notice> : null}

        <Field id="new-password" label={t('auth.newPassword')} hint={t('auth.passwordPlaceholder')}>
          <input
            id="new-password"
            className="mcsr-field__input mcsr-field__input--prose"
            type="password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>

        <div className="authform__actions">
          <button type="submit" className="cta" disabled={busy}>
            {busy ? t('auth.resetWorking') : t('auth.resetAction')}
          </button>
        </div>
      </form>
    </>
  );
}
