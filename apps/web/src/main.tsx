import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';
import '@/i18n';
import { AuthProvider } from '@/lib/auth';
// 像素字体通过 styles.css 里的 @font-face 以相对路径引入 ——
// 走构建资源管线，产出带 hash 的文件并落到 /assets/ 下，
// 从而享受 Caddy 给 /assets/* 配的 immutable 长缓存。
import '@/styles.css';

/**
 * 标记浏览器是否支持 View Transitions API。
 *
 * 支持时（Chrome / Edge / Electron 内置的 Chromium），路由切换走浏览器原生的
 * 交叉淡入 —— 新旧两棵 DOM 同时存在再互换，比"先变空再淡入"自然得多。
 *
 * ⚠️ 这个类必须在这里加，而且 CSS 里的兜底关键帧必须写成
 *    `html:not(.vt) .route-fade`。两条路**必须互斥**：
 *    否则 Chrome 上会同时播原生交叉淡入和 CSS 关键帧，
 *    叠加之后是"淡入两次"，比只有一条路的时候更难看。
 *
 * 不用 document.startViewTransition 是否存在来判断前景，而是用它来加类 ——
 * 这样"支持但被用户关掉动效"的情况由 prefers-reduced-motion 单独处理，
 * 两件事互不干扰。
 */
if ('startViewTransition' in document) {
  document.documentElement.classList.add('vt');
}

const found = document.getElementById('root');
if (!found) throw new Error('#root not found in index.html');
// 显式标注类型：下面的分支在 .then() 回调里使用它，而 TS 不会把模块级的收窄
// 带进回调（函数声明会被提升，无法保证检查已经执行过）。
const container: HTMLElement = found;

/**
 * 极简路由：只有一条额外路径，不值得为此引入 react-router。
 *
 * `/embed-test` 是一次性自检页（apps/web/src/dev/）。它必须从**生产域名**加载才能真正
 * 验证嵌入 —— 浏览器是否发送 Referer 取决于页面的 origin 与策略。
 * Caddy 的 `try_files {path} /index.html` 会把该路径交给 SPA，所以这里按 pathname 分流。
 *
 * M1 开始做正式路由时，这个分支应当删掉。
 */
const path = globalThis.location.pathname.replace(/\/+$/, '') || '/';

if (path === '/embed-test') {
  void import('@/dev/EmbedTest').then(({ EmbedTest }) => {
    createRoot(container).render(
      <StrictMode>
        <EmbedTest />
      </StrictMode>,
    );
  });
} else {
  createRoot(container).render(
    <StrictMode>
      {/*
        AuthProvider 包在 App **外面**（而不是放进 Layout 里）：
        登录状态是整站级别的，而 Layout 在路由切换时会重新渲染。
        放进 Layout 的话，每次换页都会重新判断一次登录态 ——
        接口慢的时候侧边栏会闪一下"未登录"。
      */}
      <AuthProvider>
        <App />
      </AuthProvider>
    </StrictMode>,
  );
}
