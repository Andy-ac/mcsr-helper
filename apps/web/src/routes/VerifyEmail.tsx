import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { Notice } from '@/components/Form';
import { verifyEmail } from '@/lib/api';
import { useApiErrorText, useAuth } from '@/lib/auth';

/**
 * ⚠️ 必须用**模块级**记录"这个 token 已经提交过了"。
 *
 * React 的 StrictMode 在开发模式下会故意把组件挂载两次（挂载 → 卸载 → 再挂载），
 * 目的是让副作用里的问题提前暴露。而这里的副作用会消费一个**一次性**令牌：
 * 第一次调用成功了，第二次会收到 invalid_token —— 界面于是显示"验证失败"，
 * 尽管它其实成功了。
 *
 * 这种 bug 只在开发模式出现，打生产包时 StrictMode 不做双重挂载，所以
 * **装到线上就看不见了** —— 正因为如此才特别容易被带进正式版本。
 *
 * 为什么用模块级 Set 而不是 useRef：第二次挂载会重建 ref，
 * 但模块级状态在整个会话里都在。
 */
const alreadySubmitted = new Set<string>();

type State =
  | { kind: 'working' }
  | { kind: 'ok' }
  | { kind: 'failed'; message: string }
  | { kind: 'no-token' };

/**
 * 邮箱验证落地页。
 *
 * 邮件里的链接指向 `/verify-email?token=...`（前端路由），而不是直接指向 API。
 * 原因是**邮件安全扫描器**（Outlook SafeLinks、企业邮件网关、部分杀毒软件）
 * 会自动预取邮件里的每一个链接。如果链接直接打到 API 并且用 GET 消费令牌，
 * 扫描器会在用户点之前就把它用掉，用户点开时看到"链接无效"—— 而他什么都没做错。
 *
 * 让链接落在前端路由上，扫描器取到的只是一个 SPA 外壳（无害的 HTML），
 * 真正的消费发生在用户浏览器里发出的这次 POST。
 */
export function VerifyEmail() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const errorText = useApiErrorText();
  const { refresh } = useAuth();
  const [state, setState] = useState<State>({ kind: 'working' });

  const token = params.get('token') ?? '';

  useEffect(() => {
    if (!token) {
      setState({ kind: 'no-token' });
      return;
    }
    if (alreadySubmitted.has(token)) return;
    alreadySubmitted.add(token);

    let cancelled = false;
    verifyEmail(token)
      .then(async () => {
        if (cancelled) return;
        setState({ kind: 'ok' });
        // 验证成功后本人的邮箱状态变了，刷一下上下文，
        // 免得侧边栏还显示"未验证"
        await refresh();
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ kind: 'failed', message: errorText(error) });
      });

    return () => {
      cancelled = true;
    };
  }, [token, errorText, refresh]);

  return (
    <>
      <header className="pagehead">
        <h1 className="pagehead__title">{t('auth.verifyTitle')}</h1>
      </header>

      <div className="authform">
        {state.kind === 'working' ? <Notice kind="info">{t('auth.verifyWorking')}</Notice> : null}

        {state.kind === 'ok' ? (
          <Notice kind="ok">
            <p>{t('auth.verifyOk')}</p>
            <p className="notice__sub">{t('auth.verifyOkHint')}</p>
          </Notice>
        ) : null}

        {state.kind === 'no-token' ? (
          <Notice kind="bad">
            <p>{t('auth.verifyNoToken')}</p>
          </Notice>
        ) : null}

        {state.kind === 'failed' ? (
          <Notice kind="bad">
            <p>{t('auth.verifyFailed')}</p>
            <p className="notice__sub">{t('auth.verifyFailedHint')}</p>
            {/* 把服务端的具体原因也显示出来。它在排查时有用，
                而上面那句是给不知道该做什么的人看的。 */}
            <p className="notice__detail">{state.message}</p>
          </Notice>
        ) : null}

        <div className="authform__actions">
          <Link className="cta" to="/">
            {t('common.backHome')}
          </Link>
          <Link className="authform__link" to="/login">
            {t('auth.loginAction')}
          </Link>
        </div>
      </div>
    </>
  );
}
