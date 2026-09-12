import { capabilitiesByType, ROLE_LABEL_KEYS } from '@mcsr/shared/permissions';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Notice } from '@/components/Form';
import { RoleGuide } from '@/components/RoleGuide';
import { logout, sendVerifyEmail } from '@/lib/api';
import { useApiErrorText, useAuth } from '@/lib/auth';
import { describeCapabilities } from '@/lib/capabilities';

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

  // ⚠️ 走共享的映射表，不要写三元链 —— 见 ROLE_LABEL_KEYS 的注释
  const roleLabel = t(ROLE_LABEL_KEYS[user.role]);

  /**
   * 重发验证邮件。
   *
   * ⚠️ 未验证的账号现在已经**登不进来**了（服务端 routes/auth.ts 的"偏离三"），
   *    所以这个按钮和下面那个"邮箱未验证"的分支在正常流程里**都到不了** ——
   *    需要它的人根本进不到这个页面，他们走的是登录页上那块面板
   *    （Login.tsx，用的是不需要登录的 /verify/resend）。
   *
   *    这里刻意**不删**：它是"验证位可以被撤销"这件事唯一的界面入口。
   *    真要做换邮箱流程（改了邮箱就得重新验证）时，这个按钮就是现成的，
   *    而那时"未验证"状态会重新变得可达。删掉它等于把那条路的后半截藏起来。
   */
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

        {/*
          身份组能做什么。

          这一节存在的理由不只是"给用户看"：它是**前端与服务端读同一份权限矩阵**
          的落点。前端要决定某个按钮显不显示时，用的是同一个 can()／
          capabilitiesByType()，所以不会出现"界面有按钮、点下去 403"，
          更不会出现"界面没按钮、但接口其实敞开着"。
        */}
        <h2 className="related__title">
          {t('auth.capTitle')} · {roleLabel}
        </h2>
        <div className="caplist">
          {describeCapabilities(
            capabilitiesByType(user.role),
            t as unknown as (key: string) => string,
          ).map((group) => (
            <div className="caplist__row" key={group.type}>
              <span className="caplist__type">{group.label}</span>
              <span className="caplist__actions">
                {group.actions.map((action) => (
                  <span className="tagchip tagchip--sm" key={action.capability}>
                    {action.label}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>

        {/*
          「这五种身份分别能做什么」—— 紧跟在"我这一级能做什么"下面。
          ⚠️ 顺序是有意的：先给用户看他**自己**的权限（他最关心的），
             再给全景图。反过来的话，一屏的表格会把他自己的那两行冲掉。
        */}
        <RoleGuide />

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
