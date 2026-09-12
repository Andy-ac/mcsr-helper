import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation } from 'react-router';
import { setLocale } from '@/i18n';

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
  { to: '/me', labelKey: 'nav.profile', block: 'profile', milestone: 'M5' },
] as const;

const COLLAPSE_KEY = 'mcsr.sidebar.collapsed';

export function Layout() {
  const { t, i18n } = useTranslation();
  const location = useLocation();

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
        <NavLink to="/" className="sidebar__brand">
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
          key={pathname} 让每次路由切换都重新挂载这个 div，
          CSS 动画才会重新播放 —— 最省事也最可靠的路由过渡做法，
          不需要引入 motion 库。动画本身在 styles.css 的 .route-fade。
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
