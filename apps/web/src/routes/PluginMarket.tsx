import { useTranslation } from 'react-i18next';

/**
 * ★★ 「插件市场」—— **骨架**（2026-10-12）。
 *
 * 用户原话：「尽快加上一批界面骨架（不需要内容，前端即将重构 ⇒ 最小改动、别过度设计）」。
 * ⇒ 这一页**故意**只有：页首标题 + 一句"施工中" + 两个 `data-*` 锚点。
 *
 * ⚠️ 锚点（重构期定位用，别删）：
 *   · `data-page="plugins"` —— 整页
 *   · `data-empty="plugins"` —— 那句空态
 *
 * ⚠️ 只立入口、不建模型：插件市场将来大概要后端（上传 / 审核 / 版本），
 *    今天一行契约都不加 —— 骨架的任务是"让栏目在那里"，不是"先猜数据结构" ✗。
 */
export function PluginMarket() {
  const { t } = useTranslation();
  return (
    <section data-page="plugins">
      <header className="pagehead">
        <h1 className="pagehead__title">{t('plugins.title')}</h1>
      </header>
      {/* ⚠️ 只用现成的 `.state` 类名 ⇒ 不为骨架新增 CSS 规则 ✓ */}
      <p className="state" data-empty="plugins">
        {t('plugins.empty')}
      </p>
    </section>
  );
}
