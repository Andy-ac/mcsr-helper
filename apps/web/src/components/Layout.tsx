import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation } from 'react-router';
import { UpdateBanner } from '@/components/UpdateBanner';
import { setLocale } from '@/i18n';
import { useAuth } from '@/lib/auth';

/**
 * 分区导航的数据。
 *
 * `block` 决定左边那个小方块的颜色 —— 收起侧边栏时只剩它，所以每一区必须有
 * 一个稳定且互不相同的颜色。`milestone` 非空的表示尚未实现，渲染成不可点击状态：
 * **放一个点了没反应的链接比不放更糟。**
 */
const SECTIONS = [
  { to: '/resources', labelKey: 'nav.resources', block: 'resources', milestone: '' },
  { to: '/calendar', labelKey: 'nav.calendar', block: 'calendar', milestone: 'M4' },
  { to: '/videos', labelKey: 'nav.videos', block: 'videos', milestone: 'M4' },
  { to: '/seeds', labelKey: 'nav.seeds', block: 'seeds', milestone: 'M4' },
  // 「我的」在 M2 就启用了：账号页本身已经能用（看得清验证状态、能重发验证邮件、
  // 能退出登录）。M5 会往它上面叠个人主页、MC 绑定和关注列表。
  { to: '/me', labelKey: 'nav.profile', block: 'profile', milestone: '' },
] as const;

const COLLAPSE_KEY = 'mcsr.sidebar.collapsed';

export function Layout() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const auth = useAuth();

  // 折叠状态存在 localStorage 里：这是"我的偏好"，刷新后应该保持。
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return globalThis.localStorage?.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false; // 隐私模式下 localStorage 可能直接抛错
    }
  });

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        globalThis.localStorage?.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* 忽略 */
      }
      return next;
    });
  }

  // 路由变化时回到顶部。
  // 不这么做的话：从长列表点进详情页会停在原来的滚动位置，看起来像"页面没变"。
  const mainRef = useRef<HTMLElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname 是**纯触发器**，effect 体内不读取它
  useEffect(() => {
    mainRef.current?.scrollTo?.({ top: 0 });
    globalThis.scrollTo({ top: 0, behavior: 'auto' });
  }, [location.pathname]);

  return (
    <div className="shell">
      <aside className={`sidebar${collapsed ? ' is-collapsed' : ''}`}>
        <NavLink to="/" className="sidebar__brand" viewTransition>
          <span className="sidebar__mark" aria-hidden="true" />
          <span className="sidebar__brandtext">{t('common.appName')}</span>
          <span className="sidebar__stage">M1</span>
        </NavLink>

        <div className="sidebar__group">{t('nav.sections')}</div>

        <nav aria-label="main">
          {SECTIONS.map((s) =>
            s.milestone ? (
              <span key={s.to} className="sidebar__item" aria-disabled="true" title={s.milestone}>
                <span className={`sidebar__block sidebar__block--${s.block}`} aria-hidden="true" />
                <span className="sidebar__label">{t(s.labelKey)}</span>
              </span>
            ) : (
              <NavLink
                key={s.to}
                to={s.to}
                // viewTransition：让浏览器对整页做交叉淡入。
                // 侧边栏用 CSS 的 view-transition-name 钉住不动（见 styles.css），
                // 所以看起来只有内容区在换。
                viewTransition
                className={({ isActive }) => `sidebar__item${isActive ? ' is-active' : ''}`}
                title={t(s.labelKey)}
              >
                <span className={`sidebar__block sidebar__block--${s.block}`} aria-hidden="true" />
                <span className="sidebar__label">{t(s.labelKey)}</span>
              </NavLink>
            ),
          )}
        </nav>

        <div className="sidebar__foot">
          {/*
            登录状态。

            ⚠️ 加载中（auth.loading）时刻意**什么都不显示**，不要显示"未登录"。
               显示"未登录"然后半秒后跳成用户名，是一次没必要的视觉抖动，
               而且会让已经登录的用户以为掉线了。
          */}
          {auth.loading ? null : auth.user ? (
            <NavLink
              to="/me"
              className={({ isActive }) => `sidebar__item${isActive ? ' is-active' : ''}`}
              viewTransition
              title={auth.user.displayName}
            >
              <span className="sidebar__block sidebar__block--profile" aria-hidden="true" />
              <span className="sidebar__label">{auth.user.displayName}</span>
              {/* 未验证邮箱时挂一个标记。这是唯一挡住提交内容的东西，
                  放在侧边栏能让用户自己发现，而不用等提交时才知道。 */}
              {auth.user.emailVerified ? null : (
                <span className="sidebar__flag" title={t('auth.accountUnverified')}>
                  !
                </span>
              )}
            </NavLink>
          ) : (
            <>
              <NavLink to="/login" className="sidebar__item" viewTransition title={t('nav.login')}>
                <span className="sidebar__block sidebar__block--login" aria-hidden="true" />
                <span className="sidebar__label">{t('nav.login')}</span>
              </NavLink>
              <NavLink
                to="/register"
                className="sidebar__item"
                viewTransition
                title={t('nav.register')}
              >
                <span className="sidebar__block sidebar__block--register" aria-hidden="true" />
                <span className="sidebar__label">{t('nav.register')}</span>
              </NavLink>
            </>
          )}

          <div className="sidebar__lang">
            <button
              type="button"
              className={i18n.language === 'zh-CN' ? 'is-active' : ''}
              onClick={() => setLocale('zh-CN')}
              title="中文"
            >
              中文
            </button>
            <button
              type="button"
              className={i18n.language === 'en' ? 'is-active' : ''}
              onClick={() => setLocale('en')}
              title="English"
            >
              EN
            </button>
          </div>

          <button
            type="button"
            className="sidebar__toggle"
            onClick={toggle}
            aria-expanded={!collapsed}
            title={collapsed ? t('nav.expand') : t('nav.collapse')}
          >
            {/*
              用 ← / → 而不是 « / »。
              ⚠️ « (U+00AB) 和 » (U+00BB) **不在**字体子集的 7368 个码位里，
                 而 .sidebar__toggle 明确指定了 --font-pixel —— 结果是这两个字符
                 掉回系统字体，和旁边的中文不一样大、不一样粗。只有两个字符，
                 非常容易漏看。← (U+2190) / → (U+2192) 都在子集里。
                 这条约束有脚本守着：apps/web/scripts/check-font-coverage.mjs
            */}
            {collapsed ? '→' : `← ${t('nav.collapse')}`}
          </button>
        </div>
      </aside>

      <div className="content">
        {/*
          更新提示条挂在 content 顶部而不是 main 里面：
          main 有路由过渡动画（key={pathname} 会让整个子树重挂），
          提示条放在里面会在每次换页时重新挂载、重新拉一次状态 ——
          既浪费一次 IPC，也可能让进度条闪一下。
        */}
        <UpdateBanner />
        {/*
          key={pathname} 让每次路由切换都重新挂载这个 div。

          ⚠️ 它现在**只服务于 CSS 兜底动画**（不支持 View Transitions 的浏览器）。
             在支持 View Transitions 的浏览器上，动画由浏览器原生的交叉淡入负责，
             这个 key 只是让它照常重挂 —— 无害，因为路由切换本来就会换组件。
             两条路的互斥由 styles.css 里的 `html:not(.vt)` 保证。
        */}
        <main className="main" ref={mainRef}>
          <div className="route-fade" key={location.pathname}>
            <Outlet />
          </div>
        </main>

        <footer className="footer">
          {t('common.appName')} · M1 · {new Date().getFullYear()}
        </footer>
      </div>
    </div>
  );
}
