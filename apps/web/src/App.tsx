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
 * 提交页和审核页也懒加载。
 *
 * 理由和详情页一样，而且更强：它们都用到 Markdown 预览（同一套
 * react-markdown 管线），但**大多数访客永远不会打开它们** ——
 * 提交要登录且邮箱已验证，审核还是更高一层的权限。
 * 让所有访客为首屏之后根本不会发生的渲染付这份下载成本没有意义。
 */
const SubmitResourcePage = lazy(() =>
  import('@/routes/SubmitResource').then((m) => ({ default: m.SubmitResource })),
);
const ReviewQueuePage = lazy(() =>
  import('@/routes/ReviewQueue').then((m) => ({ default: m.ReviewQueue })),
);
const ReviewDetailPageLazy = lazy(() =>
  import('@/routes/ReviewDetail').then((m) => ({ default: m.ReviewDetailPage })),
);
const MySubmissionsPage = lazy(() =>
  import('@/routes/MySubmissions').then((m) => ({ default: m.MySubmissions })),
);
const EditResourcePage = lazy(() =>
  import('@/routes/EditResource').then((m) => ({ default: m.EditResource })),
);
const AdminUsersPage = lazy(() =>
  import('@/routes/AdminUsers').then((m) => ({ default: m.AdminUsers })),
);
const FavoritesPage = lazy(() =>
  import('@/routes/Favorites').then((m) => ({ default: m.Favorites })),
);

/**
 * M4 的页面同样懒加载。
 *
 * 理由和其它次级页面一致：日历详情和编辑页都要 Markdown 预览（同一套
 * react-markdown 管线），而提交/编辑还要登录且邮箱已验证。
 * 让只来看首页和资源库的访客为它们付下载成本没有意义。
 *
 * ⚠️ 而**列表页也一起懒加载**（日历、视频墙、种子检索），这一条和资源库不同 ——
 *    资源库的列表页是首屏，拆了反而多一次往返。这三个不是首屏：
 *    侧边栏默认落在首页，大多数人不会一进来就点它们。
 */
const CalendarListPage = lazy(() =>
  import('@/routes/CalendarList').then((m) => ({ default: m.CalendarList })),
);
const CalendarDetailPage = lazy(() =>
  import('@/routes/CalendarDetail').then((m) => ({ default: m.CalendarDetailPage })),
);
const CalendarSubmitPage = lazy(() =>
  import('@/routes/CalendarSubmit').then((m) => ({ default: m.CalendarSubmit })),
);
const CalendarEditPage = lazy(() =>
  import('@/routes/CalendarEdit').then((m) => ({ default: m.CalendarEdit })),
);
const VideosPage = lazy(() => import('@/routes/Videos').then((m) => ({ default: m.Videos })));
/**
 * 视频编辑页（需求②，t14）—— 懒加载，理由同其它次级页面：
 * 它只有 `content.author`（editor 及以上）会打开，
 * 让只来看墙的访客为首屏之后不会发生的事付下载成本没有意义。
 */
const VideoEditPage = lazy(() =>
  import('@/routes/VideoEdit').then((m) => ({ default: m.VideoEdit })),
);
const SeedsPage = lazy(() => import('@/routes/Seeds').then((m) => ({ default: m.Seeds })));
/**
 * 「直播」板块（与「娱乐视频」并列）。
 *
 * ⚠️ 它是**编辑维护的名单**，不是用户内容 —— 所以页面里对有权重的人
 *    会多出一块编辑界面，而那个判断读的是权限矩阵（`live.manage`），
 *    不是在前端另写一份"谁是编辑"。
 */
const LivePage = lazy(() => import('@/routes/Live').then((m) => ({ default: m.Live })));

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
          {/*
            ⚠️ `/resources/submit` 必须排在 `/resources/:id` 前面。
               react-router 是按"具体段优先"排序的，所以顺序在这里其实不影响结果 ——
               但把它放在前面是有意的：下一个读这段代码的人不应该需要知道
               "submit 恰好会被当成一个更具体的静态段"才能确认它没被 :id 吃掉。
          */}
          <Route
            path="/resources/submit"
            element={
              <Suspense fallback={<p className="state">…</p>}>
                <SubmitResourcePage />
              </Suspense>
            }
          />
          <Route
            path="/resources/:id"
            element={
              <Suspense fallback={<p className="state">…</p>}>
                <ResourceDetailPage />
              </Suspense>
            }
          />
          {/*
            ⚠️ 编辑页必须排在 `/resources/:id` **之后**才能被正确匹配吗？
               不需要 —— react-router 按"具体段优先"排序，`/resources/:id/edit`
               比 `/resources/:id` 多一段，永远不会被后者吃掉。
               （这和 Hono 不一样：Hono 是按注册顺序匹配的，
                 `routes/resources.ts` 里的 `/mine` 就必须写在 `/:id` 前面。）
          */}
          <Route
            path="/resources/:id/edit"
            element={
              <Suspense fallback={<p className="state">…</p>}>
                <EditResourcePage />
              </Suspense>
            }
          />
          {/*
            审核是**通用**的：路径里带类型，`/review/:type/:id`。
            这里只有两条路由，M4 加日历/种子/视频时不需要再动这个文件 ——
            类型的差异全部在 lib/reviewTypes.tsx 的注册表里。
          */}
          <Route
            path="/review"
            element={
              <Suspense fallback={<p className="state">…</p>}>
                <ReviewQueuePage />
              </Suspense>
            }
          />
          <Route
            path="/review/:type/:id"
            element={
              <Suspense fallback={<p className="state">…</p>}>
                <ReviewDetailPageLazy />
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
          {/*
            「我的提交」是审核管线的闭环：驳回理由唯一的读者就是作者。
            ⚠️ 它必须排在 `/me` 之后不影响匹配（`/me` 是精确路径），
               但它**不复用** Account 页 —— 那个页面是账号设置，
               混在一起会让"我提交的东西现在怎么样了"变成要找的东西。
          */}
          <Route
            path="/me/submissions"
            element={
              <Suspense fallback={<p className="state">…</p>}>
                <MySubmissionsPage />
              </Suspense>
            }
          />
          {/*
            账号管理。只有 admin 有 user.moderate —— 服务端会拦，
            这里只是懒加载入口（手动敲地址进去会看到一句明确的"没有权限"）。
          */}
          <Route
            path="/admin/users"
            element={
              <Suspense fallback={<p className="state">…</p>}>
                <AdminUsersPage />
              </Suspense>
            }
          />
          <Route
            path="/me/favorites"
            element={
              <Suspense fallback={<p className="state">…</p>}>
                <FavoritesPage />
              </Suspense>
            }
          />

          {/* ================================================================
              M4：日历 / 视频 / Ranked Seeds
              ================================================================
              ⚠️ 路径的形状照抄资源库那一套（`/resources`、`/resources/submit`、
                 `/resources/:id`、`/resources/:id/edit`），逐段对应：
                   · 提交页挂在**各自的版块下**（`/calendar/submit`）而不是 `/submit` ——
                     M4 有三个版块，一个全局的 `/submit` 立刻就需要"提交什么？"的二次选择。
                     `lib/reviewTypes.tsx` 的 submitPath 和这里必须一致。
                   · 日历详情页的公开接口对未发布的条目返回 404，编辑页走
                     `/api/calendar/mine/:id`（含待审那一版）—— 和资源库同构。
          */}
          <Route
            path="/calendar"
            element={
              <Suspense fallback={<p className="state">…</p>}>
                <CalendarListPage />
              </Suspense>
            }
          />
          {/*
            ⚠️ `/calendar/submit` 与 `/calendar/:id` 的先后顺序不影响匹配
               （react-router 按"具体段优先"，静态段永远比参数段更具体）——
               和资源库那边一样，把它写在前面只是为了让读代码的人不必知道这件事。
          */}
          <Route
            path="/calendar/submit"
            element={
              <Suspense fallback={<p className="state">…</p>}>
                <CalendarSubmitPage />
              </Suspense>
            }
          />
          <Route
            path="/calendar/:id/edit"
            element={
              <Suspense fallback={<p className="state">…</p>}>
                <CalendarEditPage />
              </Suspense>
            }
          />
          <Route
            path="/calendar/:id"
            element={
              <Suspense fallback={<p className="state">…</p>}>
                <CalendarDetailPage />
              </Suspense>
            }
          />
          <Route
            path="/videos"
            element={
              <Suspense fallback={<p className="state">…</p>}>
                <VideosPage />
              </Suspense>
            }
          />
          {/*
            ⚠️ `/videos/:id/edit` 必须排在 `/videos` 之后吗？**不需要** ——
                react-router 按"具体段优先"，多一段的路径永远不会被 `/videos` 吃掉。
                和 `/resources/:id/edit`、`/calendar/:id/edit` 同一个形状。
            ⚠️ 它是 `/videos` 的**子路径**而不是一个独立的编辑板块：
                视频不审核，所以这里做的是"改"，不是"提审"（见 `VideoEdit` 的头注释）。
          */}
          <Route
            path="/videos/:id/edit"
            element={
              <Suspense fallback={<p className="state">…</p>}>
                <VideoEditPage />
              </Suspense>
            }
          />
          {/*
            `/live` —— 和 `/videos` 并列的第二个视频类板块（编辑维护的 streamer 名单）。
            它**没有子路由**：编辑界面就在同一页上、按能力显示，
            因为"看名单"和"改名单"是同一份数据的两个视角，拆成两个路径
            会让编辑每次改完都要跳一次页面。
          */}
          <Route
            path="/live"
            element={
              <Suspense fallback={<p className="state">…</p>}>
                <LivePage />
              </Suspense>
            }
          />
          {/*
            ⚠️ `/seeds` 下面 v1 只做 **Ranked Seeds 检索**；社区 UGC 分享
               （RSG/SSG 那套）按 Q16 显示成"即将开放"，不是路由。
          */}
          <Route
            path="/seeds"
            element={
              <Suspense fallback={<p className="state">…</p>}>
                <SeedsPage />
              </Suspense>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
