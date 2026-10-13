import { useTranslation } from 'react-i18next';

/**
 * ★★ 「社区信息推送」—— **骨架**（2026-10-12）。
 *
 * 用户原话：「尽快加上一批界面骨架（不需要内容，前端即将重构 ⇒ 最小改动、别过度设计）」。
 * ⇒ 这一页**故意**只有：页首标题 + 一句"施工中" + 两个 `data-*` 锚点。
 *
 * ⚠️ 锚点（重构期定位用，别删）：
 *   · `data-page="community"` —— 整页
 *   · `data-empty="community"` —— 那句空态
 *
 * ⚠️ 用一个**只有这一页**的组件、而不是把三张空页合成一个带 `kind` 参数的通用组件：
 *    后者看起来更"省"，但重构时三页会各自长出完全不同的东西 ⇒ 现在合并等于
 *    先造一层马上要拆的抽象（本任务明确要求"别过度设计" ✗）。
 */
export function Community() {
  const { t } = useTranslation();
  return (
    <section data-page="community">
      <header className="pagehead">
        <h1 className="pagehead__title">{t('community.title')}</h1>
      </header>
      {/* ⚠️ 只用现成的 `.state` 类名 ⇒ 不为骨架新增 CSS 规则 ✓ */}
      <p className="state" data-empty="community">
        {t('community.empty')}
      </p>
    </section>
  );
}
