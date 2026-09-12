import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';
// 像素字体：只取 latin 子集（最小），中文交给系统字体。
// ⚠️ 必须自托管（走 npm 包），不能换成 Google Fonts CDN ——
//    一是 CSP 是 font-src 'self'，二是大陆访问不到。
import '@fontsource/silkscreen/latin-400.css';
import '@fontsource/silkscreen/latin-700.css';
import '@/i18n';
import '@/styles.css';

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
      <App />
    </StrictMode>,
  );
}
