import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { Layout } from '@/components/Layout';
import { Home } from '@/routes/Home';
import { NotFound } from '@/routes/NotFound';
import { ResourceList } from '@/routes/ResourceList';

/**
 * 详情页懒加载。
 *
 * 它引入了 react-markdown + remark-gfm + rehype-sanitize 的整条管线，
 * 而那套东西**只有详情页需要**。不拆的话，每个只来看列表的人都要
 * 先下载并解析这一大块 —— 拆完列表页能少下载约三分之一。
 *
 * 列表页和首页不拆：它们是首屏，拆了反而多一次往返。
 */
const ResourceDetailPage = lazy(() =>
  import('@/routes/ResourceDetail').then((m) => ({ default: m.ResourceDetailPage })),
);

/**
 * 应用路由。
 *
 * 用 BrowserRouter（真实路径）而不是 HashRouter：Caddy 已经配了 SPA 回退
 * （`try_files {path} /index.html`），所以 `/resources/xxx` 这种深链接能直接用，
 * 也更好看、更利于分享。
 *
 * `/embed-test` 不在这里 —— 它在 main.tsx 里就被分流了（那是个一次性自检页，
 * 不属于应用本身，删掉时不用动这里）。
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/resources" element={<ResourceList />} />
          <Route
            path="/resources/:id"
            element={
              <Suspense fallback={<p className="state">…</p>}>
                <ResourceDetailPage />
              </Suspense>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
