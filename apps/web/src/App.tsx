import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { Layout } from '@/components/Layout';
import { Account } from '@/routes/Account';
import { Home } from '@/routes/Home';
import { Login } from '@/routes/Login';
import { NotFound } from '@/routes/NotFound';
import { PasswordReset } from '@/routes/PasswordReset';
import { Register } from '@/routes/Register';
import { ResourceList } from '@/routes/ResourceList';
import { VerifyEmail } from '@/routes/VerifyEmail';

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
 * 认证相关的页面也懒得拆 —— 它们比详情页小得多，而且
 * 登录/注册是**直达链接**（邮件、书签、别人发的地址）。
 * 懒加载会让这些路径多一次"先加载再渲染"的往返，得不偿失。
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
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          {/*
            这两个路径**必须和邮件模板里的链接完全一致**：
              · verifyUrl()  → /verify-email?token=…
              · resetUrl()   → /reset-password?token=…
            见 services/api/src/email/messages.ts。
            改这里就要同时改那里，否则用户点开邮件会落到 404。
          */}
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/reset-password" element={<PasswordReset />} />
          <Route path="/me" element={<Account />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
