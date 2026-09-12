import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Field, Notice } from '@/components/Form';
import { ApiError, login, resendVerification } from '@/lib/api';
import { useApiErrorText, useAuth } from '@/lib/auth';

/**
 * 登录页。
 *
 * 关于 `?next=`：登录之后回到用户原本想去的地方。
 *
 * ⚠️ 只接受**站内相对路径**。如果是完整 URL 就忽略它 —— 否则
 *    `?next=https://evil.example` 会把用户在成功登录后送到钓鱼站，
 *    而用户刚输完密码，警惕性最低。这是最经典的开放重定向。
 *
 * 关于"邮箱未验证"时那块面板：它不是一条额外的错误提示，而是**唯一的出口**。
 *
 * 未验证的账号登不进来（见服务端 routes/auth.ts 的"偏离三"），
 * 而"重发验证邮件"的常规入口在账号页上 —— 那个页面需要登录。
 * 于是没有这块面板的话，用户会卡在一个闭环里：
 * 没验证 → 登不进来 → 重发要登录 → 还是没验证。
 * 所以这里必须就地给一个**不需要登录**的重发按钮。
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

  // "这个邮箱还没验证"是服务端的一条**独立结论**，要单独存一个标志位，
  // 而不是去匹配错误文案 —— 后者一改文案就悄悄失效，
  // 而且是"测试全绿、面板消失"的那种失效。
  // 判据用 error.code，不用 message（同 lib/auth.tsx 里 apiErrorText 的理由）。
  const [needsVerify, setNeedsVerify] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendNote, setResendNote] = useState<string | null>(null);

  const rawNext = params.get('next') ?? '/';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNeedsVerify(false);
    setResendNote(null);
    setBusy(true);
    try {
      await login(email, password);
      // 登录接口已经把会话 cookie 下发了，这里刷新一下上下文即可
      await refresh();
      navigate(next, { replace: true, viewTransition: true });
    } catch (err) {
      setError(errorText(err));
      setNeedsVerify(err instanceof ApiError && err.code === 'email_not_verified');
    } finally {
      setBusy(false);
    }
  }

  async function onResend() {
    // 邮箱是这块面板唯一需要的入参，而它就在上面的输入框里 ——
    // 不必让用户再填一遍（那才是真正会让人放弃的地方）。
    if (!email.trim()) {
      setResendNote(t('auth.verifyBlockNeedEmail'));
      return;
    }
    setResendBusy(true);
    setResendNote(null);
    try {
      await resendVerification(email);
      // ⚠️ 文案刻意模糊。服务端对"注册过没有"给出的是**完全一致**的响应，
      //    界面要是说成"已经发给你了"，就等于替服务端泄漏了它刻意不说的那件事。
      setResendNote(t('auth.verifyBlockSent'));
    } catch (err) {
      setResendNote(errorText(err));
    } finally {
      setResendBusy(false);
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

        {needsVerify ? (
          <Notice kind="info">
            <p>
              <strong>{t('auth.verifyBlockTitle')}</strong>
            </p>
            <p className="notice__sub">{t('auth.verifyBlockHint')}</p>
            <p className="notice__sub">
              <button
                type="button"
                className="notice__action"
                onClick={() => void onResend()}
                disabled={resendBusy}
              >
                {resendBusy ? t('auth.verifyResending') : t('auth.verifyBlockResend')}
              </button>
            </p>
            {resendNote ? <p className="notice__sub">{resendNote}</p> : null}
          </Notice>
        ) : null}

        <Field id="login-email" label={t('auth.email')}>
          <input
            id="login-email"
            className="mcsr-field__input mcsr-field__input--prose"
            type="email"
            name="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              // 换了邮箱，那条结论就不再成立了 —— 留着面板会让人以为
              // 新填的这个地址也没验证过。
              setNeedsVerify(false);
              setResendNote(null);
            }}
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
