/**
 * 「工具下载」那一格（2026-10-04，A 的 T3）—— **占位卡**。
 *
 * ===========================================================================
 * ⚠️★ 为什么宁可放一张写明"待更新"的卡，也不留空白
 * ===========================================================================
 * `docs/pending.md §5.63` 那一族：**空白分不出"还没做"与"坏了"**。这一格今天确实没有
 * 内容（工具下载是另一期的事），而 tab 是用户点得到的 ⇒ 点进去看到一片空白时，
 * 用户唯一的结论是"这个页面坏了"。
 *
 * ⚠️★ 它是**纯组件、不取数、不订阅**（与这一页别的组件同一条）：自检里
 * `html(<ToolsPanel />)` 就要能渲染出来，否则这一格一个字都断言不到。
 * ⚠️ 它的类名是**自己的**（`.toolspanel`，不复用 `.filespanel` / `.folderlist`）：
 * v1 的渲染自检有一条"产物里没有 `filespanel` 这个子串"的粗判据
 * （`routes/Files.tsx` 里 `ModFoldersUnavailable` 的注释写着完整的一段）。
 */
import { useTranslation } from 'react-i18next';

export function ToolsPanel() {
  const { t } = useTranslation();
  return (
    <section className="toolspanel" data-tab-panel="tools">
      <h2 className="toolspanel__title">{t('files.tabTools')}</h2>
      <p className="toolspanel__hint">{t('files.toolsComingSoon')}</p>
    </section>
  );
}
