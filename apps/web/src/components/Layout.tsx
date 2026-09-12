import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation } from 'react-router';
import { UpdateBanner } from '@/components/UpdateBanner';
import { setLocale } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { canReviewAny, useCan } from '@/lib/capabilities';

/*
 * 「提交」和「审核」**不放在 SECTIONS 里**。
 *
 * SECTIONS 是所有人都能看到的分区表；这两个是**有权限才存在**的入口 ——
 * 没登录的人看到"提交"点进去只会被弹回来。所以它们按当前账号的能力
 * 决定显不显示（能力矩阵来自 shared/permissions.ts，和服务端是同一份）。
 *
 * 判断放在界面里是安全的：它只影响"入口显不显示"，不是安全边界。
 * 真正的拦截在服务端（requireCapability），界面骗不过去也不再需要骗 ——
 * 手动敲 /review 会得到一句明确的"你没有审核权限"，而不是空白页。
 */

/**
 * 分区导航的数据。
 *
 * `block` 决定左边那个小方块的颜色 —— 收起侧边栏时只剩它，所以每一区必须有
 * 一个稳定且互不相同的颜色。`milestone` 非空的表示尚未实现，渲染成不可点击状态：
 * **放一个点了没反应的链接比不放更糟。**
 *
 * ⚠️ M4 的日历 / 视频 / 种子三个分区**刚刚把 `milestone: 'M4'` 摘掉**。
 *    它们从 M0 起就一直挂在这里当占位（灰的、点不动），现在后面的页面真的存在了。
 *    如果哪天某个 M4 页面被回退掉，要把 `milestone` 加回去 ——
 *    留一个点进去是空白的分区，比留一个明确灰掉的入口更让人困惑。
 */
const SECTIONS = [
  { to: '/resources', labelKey: 'nav.resources', block: 'resources', milestone: '' },
  { to: '/calendar', labelKey: 'nav.calendar', block: 'calendar', milestone: '' },
  { to: '/videos', labelKey: 'nav.videos', block: 'videos', milestone: '' },
  { to: '/seeds', labelKey: 'nav.seeds', block: 'seeds', milestone: '' },
  // 「我的」在 M2 就启用了：账号页本身已经能用（看得清验证状态、能重发验证邮件、
  // 能退出登录）。M5 会往它上面叠个人主页、MC 绑定和关注列表。
  { to: '/me', labelKey: 'nav.profile', block: 'profile', milestone: '' },
] as const;

const COLLAPSE_KEY = 'mcsr.sidebar.collapsed';

export function Layout() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const auth = useAuth();
  // 账号管理入口：只有 admin 有 user.moderate
  const isAdmin = useCan('user.moderate');

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

          {/*
            「我的提交」—— `/me` 的**子项**，缩进一级。
            ⚠️ 为什么是子项而不是平级：它是"我的"这个分区里的一个页面，
               平级会让侧边栏看起来有两个"我的"。缩进表达的是归属，
               位置表达的是"先去账号页，再点进去看提交记录"。
            只在登录后显示：没登录的人点进去只会被弹回来。
          */}
          {/*
            「我的收藏」和「我的提交」是同一层级的子项：都是"我的"这个分区
            里的页面。放在「我的提交」下面而不是上面 —— 提交是参与，
            收藏是回看，参与在前。
          */}
          {auth.user ? (
            <NavLink
              to="/me/favorites"
              className={({ isActive }) =>
                `sidebar__item sidebar__item--sub${isActive ? ' is-active' : ''}`
              }
              viewTransition
              title={t('marks.favoritesTitle')}
            >
              <span className="sidebar__dot" aria-hidden="true" />
              <span className="sidebar__label">{t('marks.favoritesTitle')}</span>
            </NavLink>
          ) : null}

          {auth.user ? (
            <NavLink
              to="/me/submissions"
              className={({ isActive }) =>
                `sidebar__item sidebar__item--sub${isActive ? ' is-active' : ''}`
              }
              viewTransition
              title={t('mine.title')}
            >
              <span className="sidebar__dot" aria-hidden="true" />
              <span className="sidebar__label">{t('mine.title')}</span>
            </NavLink>
          ) : null}

          {/*
            ⚠️ 「提交」**不在侧边栏里**（2026-09-12 的改动）。
               导航回答的是"去哪儿"，而"提交一条资源"是**在资源库这个版块里
               做的一件事** —— 所以它长在资源库页面的标题右边（见 ResourceList），
               位置跟着版块走。

               放在侧边栏还会有第二个问题：M4 加上日历、种子、视频之后，
               那里会出现四条"提交"，而用户看不出它们各自属于哪个版块。

            审核不同 —— 它就是一张跨类型的工作台，没有"属于哪个版块"这回事，
            所以它留在导航里。
          */}
          {/* 账号管理：只有 admin 看得到（user.moderate） */}
          {isAdmin ? (
            <NavLink
              to="/admin/users"
              className={({ isActive }) => `sidebar__item${isActive ? ' is-active' : ''}`}
              viewTransition
              title={t('nav.admin')}
            >
              <span className="sidebar__block sidebar__block--admin" aria-hidden="true" />
              <span className="sidebar__label">{t('nav.admin')}</span>
            </NavLink>
          ) : null}

          {canReviewAny(
            auth.user ? { role: auth.user.role, emailVerified: auth.user.emailVerified } : null,
          ) ? (
            <NavLink
              to="/review"
              className={({ isActive }) => `sidebar__item${isActive ? ' is-active' : ''}`}
              viewTransition
              title={t('nav.review')}
            >
              <span className="sidebar__block sidebar__block--review" aria-hidden="true" />
              <span className="sidebar__label">{t('nav.review')}</span>
            </NavLink>
          ) : null}
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
