import { Button } from '@mcsr/ui';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';
import { setLocale } from '@/i18n';

/**
 * 全站外壳：顶栏 + 内容区 + 页脚。
 *
 * 导航只列出**真的能用**的入口。M1 只做了资源库，所以其余模块不放出来 ——
 * 放一个点了没反应的链接比不放更糟。它们会在各自的里程碑里逐个加进来。
 */
export function Layout() {
  const { t, i18n } = useTranslation();

  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="topbar__brand">
          <span className="topbar__mark" aria-hidden="true" />
          <span className="topbar__name">{t('common.appName')}</span>
          <span className="topbar__stage">M1</span>
        </NavLink>

        <nav className="topbar__nav" aria-label="main">
          <NavLink
            to="/resources"
            className={({ isActive }) => `navlink navlink--live${isActive ? ' is-active' : ''}`}
          >
            {t('nav.resources')}
          </NavLink>
        </nav>

        <div className="topbar__right">
          <fieldset className="langswitch">
            <legend className="sr-only">{t('nav.language')}</legend>
            <button
              type="button"
              className={i18n.language === 'zh-CN' ? 'is-active' : ''}
              onClick={() => setLocale('zh-CN')}
            >
              中文
            </button>
            <button
              type="button"
              className={i18n.language === 'en' ? 'is-active' : ''}
              onClick={() => setLocale('en')}
            >
              EN
            </button>
          </fieldset>
          <Button size="sm" variant="secondary" disabled title={t('nav.login')}>
            {t('nav.login')}
          </Button>
        </div>
      </header>

      <main className="main">
        <Outlet />
      </main>

      <footer className="footer">
        <span>
          {t('common.appName')} · M1 · {new Date().getFullYear()}
        </span>
      </footer>
    </div>
  );
}
