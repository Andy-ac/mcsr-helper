import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Ranked } from '@/routes/Ranked';
import { Seeds } from '@/routes/Seeds';

/**
 * ★★ 「竞技项目」—— **骨架**（2026-10-12）。
 *
 * 用户原话：「尽快加上一批界面骨架（不需要内容，前端即将重构 ⇒ 最小改动、别过度设计）」。
 * ⇒ 这一版**故意**只做：一个页首 + 一条子标签 + 三格面板（两格是空态、一格复用两个旧页面）。
 *    ⛔ 别在这里长功能：内容与结构都由即将到来的重构决定。
 *
 * ---------------------------------------------------------------------------
 * 为什么子标签是**真路由**（而不是本组件里的 `useState`）
 * ---------------------------------------------------------------------------
 * 照本仓既有的那条判据（`App.tsx` 里 `/ranked/*` 那一段的注释写着同一件事）：
 * 分享出去的 URL、刷新、前进 / 后退都要落在**同一屏**上。做成 state 切换的话，
 * 三个地址长得一模一样但永远只会打开第一格 —— 而那种错**没有任何门禁看得见** ✗。
 * ⇒ 所以：`/competitive` 重定向到 `/competitive/leaderboard`，
 *    另外两条各是真路由（见 `App.tsx`）。
 *
 * ---------------------------------------------------------------------------
 * ★ 与旧入口的关系（这是本任务唯一需要"处置"的地方）
 * ---------------------------------------------------------------------------
 * 「排位赛种子」（`/seeds`）与「Ranked 实时信息」（`/ranked`）**内容**现在住在
 * 「MCSR Ranked」这一格（下面那两段，各自带一个 `data-competitive-section` 锚点）。
 * ⚠️★ 但那两条**旧路由一个字节都没删** —— 它们仍然可达 ✓（侧栏入口撤了，
 *    老链接 / 老书签 / 分享出去的 URL 照旧能用）。理由写在 `lib/nav.ts` 那一段。
 *
 * ⚠️ 复用的是 `routes/Seeds.tsx` 与 `routes/Ranked.tsx` 这两个**组件本身**
 *    （不是复制一份标记 ✗）⇒ 旧页面改一次、这里跟着改，不会漂成两份。
 *    ⚠️ 代价（认）：`Ranked` 自带一个 `<h1>`（它的页首标题）⇒ 这一格会有两个一级标题，
 *       对读屏不理想；重构时应当把 `Ranked` 的页首抽出来（**本任务不动它** ✗ ——
 *       那属于"过度设计"，而且会牵动 `RankedPanels` 的既有断言）。
 */
export type CompetitiveTab = 'leaderboard' | 'ranked' | 'draftout';

/** 三格的顺序 = 用户给的顺序（正式排行榜 / MCSR Ranked / Draftout）。 */
export const COMPETITIVE_TABS: readonly CompetitiveTab[] = ['leaderboard', 'ranked', 'draftout'];

/**
 * ★ 导出成纯组件是**为了让渲染自检能直接渲染它**（与 `Files.tsx` 的 `ModTabs` 同一条理由：
 *   整页要 `useApi` 之类才画得出来，而静态渲染跑不到那些 effect）。
 */
export function CompetitiveTabs({ tab }: { tab: CompetitiveTab }) {
  const { t } = useTranslation();
  /* ⚠️ 词条一律写**字面量键**（`t('competitive.tabLeaderboard')`）：
     `i18n-keys.test.ts` 只查字面量调用的键存在性，拼出来的动态键它看不见 ✗。 */
  const items: readonly { id: CompetitiveTab; label: string }[] = [
    { id: 'leaderboard', label: t('competitive.tabLeaderboard') },
    { id: 'ranked', label: t('competitive.tabRanked') },
    { id: 'draftout', label: t('competitive.tabDraftout') },
  ];
  return (
    /*
     * ⚠️ 用 `<div role="tablist">` 而**不是** `<nav role="tablist">`：后者会被
     *    biome 的 `lint/a11y/noNoninteractiveElementToInteractiveRole` 判红 ✗
     *    （`nav` 是"地标"角色，不该再挂交互角色）—— 与 `Files.tsx` 的 `ModTabs` 同一条写法 ✓。
     */
    <div className="modtabs" role="tablist" data-competitive-tabs="">
      {items.map((item) => (
        <Link
          key={item.id}
          role="tab"
          to={`/competitive/${item.id}`}
          className={item.id === tab ? 'modtabs__tab is-active' : 'modtabs__tab'}
          /* ⚠️ `data-competitive-tab` 必须在 `aria-selected` **前面**：自检那两条正则吃这个顺序。 */
          data-competitive-tab={item.id}
          aria-selected={item.id === tab}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

/**
 * 页面本体。
 *
 * ⚠️ 三格各有一个 `data-tab-panel="competitive-<id>"` 锚点（重构期定位用 ✓）；
 *    「MCSR Ranked」那一格里的两段各有 `data-competitive-section="seeds|ranked"` ✓。
 */
export function Competitive({ tab }: { tab: CompetitiveTab }) {
  const { t } = useTranslation();
  return (
    <section data-page="competitive">
      <header className="pagehead">
        <h1 className="pagehead__title">{t('competitive.title')}</h1>
      </header>

      <CompetitiveTabs tab={tab} />

      <div role="tabpanel" data-tab-panel={`competitive-${tab}`}>
        {tab === 'leaderboard' ? (
          /* 空态。⚠️ 只用现成的 `.state` 类名（不新增 CSS 规则 ⇒ 不为骨架养样式债 ✓）。 */
          <p className="state" data-empty="competitive-leaderboard">
            {t('competitive.leaderboardEmpty')}
          </p>
        ) : tab === 'ranked' ? (
          /*
           * ★★ 原来那两页的内容（复用组件本身，不抄标记）。
           * ⚠️ 两条 `<h2>` 是给骨架期看的（重构时按新信息架构重排）。
           */
          <>
            <section data-competitive-section="seeds">
              <h2 className="pagehead__title">{t('competitive.rankedSeedsTitle')}</h2>
              <Seeds />
            </section>
            <section data-competitive-section="ranked">
              <h2 className="pagehead__title">{t('competitive.rankedLiveTitle')}</h2>
              <Ranked tab="status" />
            </section>
          </>
        ) : (
          <p className="state" data-empty="competitive-draftout">
            {t('competitive.draftoutEmpty')}
          </p>
        )}
      </div>
    </section>
  );
}
