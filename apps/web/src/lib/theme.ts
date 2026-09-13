/**
 * 主题（白天 / 黑夜）—— 2026-09-13，用户要求。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 站点的**默认是黑夜**，而这件事以前是"唯一的事实"
 * ---------------------------------------------------------------------------
 * `styles.css` 的 `:root` 里那套变量（`--bg: #131519` 等）本来就是深色的，
 * 所以这一轮做的不是"加一个深色模式"，而是：
 *   1. 把 `:root` 当**黑夜**（既有外观一个字都不动）；
 *   2. 新增 `html[data-theme='light']` 覆盖那套变量；
 *   3. 用一个开关在两者之间切。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 为什么主题必须写在 `<html>` 的 data 属性上，而不是 React 的 class
 * ---------------------------------------------------------------------------
 * 它要在**首屏渲染之前**就生效：用户选了白天，刷新之后如果等 React 挂载再加类，
 * 会先闪一下黑的（FOUC）。所以 `main.tsx` 在 `createRoot` **之前**同步读一次
 * localStorage 并写上去 —— 那一步不经过 React，这里就是它的唯一入口。
 *
 * ⚠️ 读写 localStorage 一定要 try/catch：隐私模式 / 禁用存储的浏览器会**抛异常**，
 *    而"存不了偏好"绝不该让整站白屏。存不了就只是这一次的选择不记住。
 */
export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'mcsr-theme';

/** 两个值都合法；其他任何东西（包括 null）一律回落到黑夜 —— 那是站点的既有外观。 */
export function normalizeTheme(value: unknown): Theme {
  return value === 'light' ? 'light' : 'dark';
}

export function readStoredTheme(): Theme {
  try {
    return normalizeTheme(globalThis.localStorage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'dark';
  }
}

/**
 * 把主题写到 `<html data-theme=...>`。
 *
 * ⚠️ **永远写上去，包括黑夜**（不要用"没有属性 = 黑夜"的写法）：
 *    CSS 里那条"黑夜时输入框底色为黑"的规则就是以 `[data-theme='dark']` 为选择器的，
 *    不写的话它在默认状态下不生效 —— 而默认状态恰恰是绝大多数访客看到的那一屏。
 */
export function applyTheme(theme: Theme): void {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  root.dataset.theme = theme;
}

export function storeTheme(theme: Theme): void {
  try {
    globalThis.localStorage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 存不了就只是不记住，不影响这一次的显示 —— 见文件头
  }
}
