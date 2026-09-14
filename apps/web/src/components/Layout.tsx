import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation } from 'react-router';
import { UpdateBanner } from '@/components/UpdateBanner';
import { setLocale } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { canReviewAny, useCan } from '@/lib/capabilities';
import { NAV_SECTIONS } from '@/lib/nav';
import { applyTheme, normalizeTheme, storeTheme, type Theme } from '@/lib/theme';

/*
 * 「提交」和「审核」**不放在 NAV_SECTIONS 里**。
 *
 * 那张表是所有人都能看到的分区表；这两个是**有权限才存在**的入口 ——
 * 没登录的人看到"提交"点进去只会被弹回来。所以它们按当前账号的能力
 * 决定显不显示（能力矩阵来自 shared/permissions.ts，和服务端是同一份）。
 *
 * 判断放在界面里是安全的：它只影响"入口显不显示"，不是安全边界。
 * 真正的拦截在服务端（requireCapability），界面骗不过去也不再需要骗 ——
 * 手动敲 /review 会得到一句明确的"你没有审核权限"，而不是空白页。
 */

/**
 * 分区表**不住在这里了** —— 它在 `@/lib/nav.ts`。
 *
 * ⚠️ 2026-09-14 搬走的，理由是"同一张表被抄了三份"：首页要"和左侧一样的几个栏目"
 *    于是手抄一份、渲染自检里又抄一份。三份手抄的东西不会报错，只会在某天变成
 *    "首页 5 栏、侧栏 6 栏"或者顺序不同 —— 而那种不一致看不出谁对。
 *    ⇒ 现在 `Layout` 与首页都从 `lib/nav.ts` import（那张表里也写清了各字段的职责）。
 *
 * ⚠️ M4 的日历 / 视频 / 种子三个分区**刚刚把 `milestone: 'M4'` 摘掉**。
 *    它们从 M0 起就一直挂在这里当占位（灰的、点不动），现在后面的页面真的存在了。
 *    如果哪天某个 M4 页面被回退掉，要把 `milestone` 加回去 ——
 *    留一个点进去是空白的分区，比留一个明确灰掉的入口更让人困惑。
 */

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

  /*
   * 收起 = **整条侧栏消失**，不是压成一条图标（2026-09-14 用户要求）。
   *
   * 于是有两条必须一起成立的规则，缺一条这个交互就是坏的：
   *   ① 收起后屏幕上那半边仍然是可 Tab 的 —— 侧栏只是不可见，没被卸载。
   *      所以 <aside> 上挂 `inert`，把整棵子树从焦点顺序里摘掉。
   *   ② 左下角必须留一颗能用的「展开」。它**不能**长在侧栏里：
   *      侧栏收起时自己就是 inert 的，里面的按钮连点都点不动 ——
   *      那就再也展不开了。所以收起时渲染的是另一颗、在 `.sidebar` **外面**
   *      固定定位的按钮，两颗按钮二选一，屏幕上永远只有一颗。
   *
   * ⚠️ 两颗按钮是**同一个元素的两个状态、但不是同一个 DOM 节点**（会互相
   *    卸载重挂），所以键盘操作时焦点会掉回 <body> —— 下面这条 effect
   *    负责把焦点交到接替它的那颗按钮上。这不是锦上添花：不交的话，
   *    用户按一下回车，焦点就从屏幕上消失了，他得从整页开头重新 Tab。
   */
  const pendingFocus = useRef(false);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);

  /*
   * ⚠️ 用 pendingFocus 这个 ref 当开关，而不是"collapsed 一变就抢焦点"：
   *    刷新后如果上次停在收起状态，`collapsed` 的初值就是 true，
   *    那种情况下焦点应该照常留在文档开头 —— 用户还没做过任何操作，
   *    凭什么把焦点挪到左下角去。顺带它也躲开了 StrictMode 在 dev 下
   *    把 effect 连续跑两遍的问题（第二遍时开关已经关上了）。
   */
  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    (collapsed ? expandRef : collapseRef).current?.focus();
  }, [collapsed]);

  /*
   * 主题（2026-09-13）。
   *
   * ⚠️ 初值从**已经写上去的 `data-theme`** 读，而不是再读一次 localStorage：
   *    `main.tsx` 在首屏之前就设好了这个属性，两边各读一次 localStorage 的话，
   *    将来只要有一边的默认值改了，就会出现"按钮显示黑夜、页面是白天"。
   *    **属性是唯一的事实**，这里只是把它的当前值搬进 React。
   */
  const [theme, setTheme] = useState<Theme>(() =>
    normalizeTheme(globalThis.document?.documentElement.dataset.theme),
  );

  function changeTheme(next: Theme) {
    applyTheme(next);
    storeTheme(next);
    setTheme(next);
  }

  function toggle() {
    // 告诉上面那条 effect：这一次是**用户按的**，焦点要跟着按钮走。
    pendingFocus.current = true;
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
      {/*
        收起时侧栏只是**移出视野**（宽度归零），DOM 还在 —— 里面的链接
        仍然能被 Tab 到：焦点跑到一个看不见的地方去，键盘用户直接迷路。
        `inert` 把整棵子树一次性地从焦点顺序**和无障碍树**里摘掉，
        这正是"整条收起了"该有的语义。

        ⚠️ 一定写成 `collapsed || undefined`，不要写成 `inert={collapsed}`：
           这个属性**在不在**才是语义（`inert="false"` 照样是 inert），
           展开时必须整个不写。`|| undefined` 送进 DOM 的只有 true 或
           什么都没有，不会出现"展开着但整条侧栏点不动"这种最坏情况。
           （React 19 已经按布尔属性处理 inert，这么写是为了不依赖版本行为。）

        ⚠️ `aria-hidden` 是同一件事的第二道，理由不同：inert 在现代浏览器上
           已经把它盖住了，但在**不认识 inert 的旧浏览器**上
           （Chrome < 102 / Firefox < 112 / Safari < 15.5），它是唯一还起作用的
           那一道。那些浏览器会安静地忽略不认识的属性 —— **页面不会崩、
           也不会报错**，代价是里面的链接退回"能被 Tab 到"：
           侧栏看不见，焦点却还是会被它抢走。
           这一条没有自动化自检守着（仓里没有一个渲染脚本会渲染 Layout），
           所以宁可两道都写。
      */}
      <aside
        id="app-sidebar"
        className={`sidebar${collapsed ? ' is-collapsed' : ''}`}
        inert={collapsed || undefined}
        aria-hidden={collapsed || undefined}
      >
        <NavLink to="/" className="sidebar__brand" viewTransition>
          <span className="sidebar__mark" aria-hidden="true" />
          <span className="sidebar__brandtext">{t('common.appName')}</span>
          <span className="sidebar__stage">M1</span>
        </NavLink>

        <div className="sidebar__group">{t('nav.sections')}</div>

        <nav aria-label="main">
          {NAV_SECTIONS.map((s) =>
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

          {/*
            主题开关（2026-09-13）。放在语言开关**下面**、侧边栏最底部 ——
            用户原话是"左下角"。

            ⚠️ 用和语言开关**同一套** `.sidebar__lang` 样式：它们在同一块、同一层级，
               是同一类东西（个人偏好）。新写一套样式只会让这两行看起来不像一对。
            ⚠️ 切换是**立即生效 + 落 localStorage**（见 `lib/theme.ts`）：
               没有"保存"按钮 —— 主题是所见即所得的东西，多一步确认只会让人以为没生效。
          */}
          <div className="sidebar__lang">
            <button
              type="button"
              className={theme === 'light' ? 'is-active' : ''}
              onClick={() => changeTheme('light')}
              title={t('nav.themeLight')}
            >
              {t('nav.themeLight')}
            </button>
            <button
              type="button"
              className={theme === 'dark' ? 'is-active' : ''}
              onClick={() => changeTheme('dark')}
              title={t('nav.themeDark')}
            >
              {t('nav.themeDark')}
            </button>
          </div>

          {/*
            「收起」—— 只在展开时存在。

            ⚠️ 收起后它**必须离开这棵子树**：整条侧栏那时是 inert 的
               （为了不偷走 Tab 焦点），留在里面的话它自己也点不动，
               那就再也展不开了。所以收起态换成下面那颗固定按钮，
               两颗二选一渲染，屏幕上不会同时出现两个。
          */}
          {collapsed ? null : (
            <button
              type="button"
              ref={collapseRef}
              className="sidebar__toggle"
              onClick={toggle}
              aria-expanded={!collapsed}
              aria-controls="app-sidebar"
              title={t('nav.collapse')}
            >
              {/*
                用 ← / → 而不是 « / »。
                ⚠️ « (U+00AB) 和 » (U+00BB) **不在**字体子集的 7368 个码位里，
                   而 .sidebar__toggle 明确指定了 --font-pixel —— 结果是这两个字符
                   掉回系统字体，和旁边的中文不一样大、不一样粗。只有两个字符，
                   非常容易漏看。← (U+2190) / → (U+2192) 都在子集里。
                   这条约束有脚本守着：apps/web/scripts/check-font-coverage.mjs
              */}
              ← {t('nav.collapse')}
            </button>
          )}
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

      {/*
        左下角的「展开」—— 只在收起时存在，和上面那颗「收起」二选一。

        ⚠️ 它必须在 `.sidebar` **外面**：收起态的侧栏整棵是 inert 的，
           把按钮放在里面等于把自己也一起锁上，然后再也没有办法展开。
           ⇒ 所以收起态渲染的是**另一颗**按钮（`.sidebar__toggle--float`），
             由 `collapsed` 和里面那颗二选一 —— 屏幕上永远只有一颗。
             （不能两颗都留着：里面那颗收起时点不动，会变成一颗假按钮。）
        ⚠️ 位置放在 `.shell` 的直接子级、`content` 之后：它是固定定位、
           不参与 flex 布局，所以放这里不用给 `.content` 加任何包装；
           放在 content 之后是为了让它排在内容之后绘制（真正的层级由
           `.sidebar__toggle--float` 的 z-index 保证，见 styles.css 的锚点）。
        ⚠️ 收起态用 → 展开（箭头朝右 = 侧栏从左边回来），展开态用 ← 收起。
           字符沿用 ← / →，理由见上面「收起」那颗按钮里的字体说明。
      */}
      {collapsed ? (
        <button
          type="button"
          ref={expandRef}
          className="sidebar__toggle sidebar__toggle--float"
          onClick={toggle}
          // 这颗只在收起时存在，所以它的展开状态恒为"否"。
          // 不写 !collapsed 是因为这个分支里 collapsed 一定是 true，
          // 写成表达式会让读的人以为它还能是别的值。
          aria-expanded={false}
          aria-controls="app-sidebar"
          title={t('nav.expand')}
        >
          {`→ ${t('nav.expand')}`}
        </button>
      ) : null}
    </div>
  );
}
