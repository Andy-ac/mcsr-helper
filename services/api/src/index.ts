/**
 * MCSR Helper API。
 *
 * M0：只有 /api/health，用来验证部署管线。
 * M1：加入资源库的公开读接口（无需登录 —— 见 docs/v1-plan.md §0.1 的访问模型）。
 * M2：加入用户系统、邮箱验证、提交与审核。
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { type AuthVariables, loadUser, sameOriginOnly } from './auth/middleware';
import { getDb } from './db';
import { checkMailConfig, mailDriverName } from './email/transport';
import { adminRoute } from './routes/admin';
import { authRoute } from './routes/auth';
import { desktopRoute } from './routes/desktop';
import { resourcesRoute } from './routes/resources';
import { deleteExpiredSessions } from './users';

const PORT = Number.parseInt(process.env.PORT ?? '3001', 10);
// 生产环境必须只监听回环地址：对外由 Caddy 反代。
// 直接监听 0.0.0.0 会让 API 绕过 HTTPS 暴露在公网上。
const HOST = process.env.HOST ?? '127.0.0.1';

const SERVICE_VERSION = '0.3.0-m2';

export const app = new Hono<{ Variables: AuthVariables }>();

app.use('*', logger());

// 基础安全响应头。这里刻意不覆盖任何策略：
//   - 面向浏览器的 CSP / Referrer-Policy 统一由 Caddy 设置（见 deploy/Caddyfile），
//     **只在一个地方定义**，避免两处不一致导致嵌入播放器被静默拦掉；
//   - 本服务只返回 JSON，文档级策略（COEP 等）在这里没有实际作用。
app.use('*', secureHeaders());

// ---- 极简内存限流 ----
// v1 是单进程部署，内存计数够用；将来多进程再换成 SQLite。
// 目的是防止有人拿你的 API 做刷量，不是为了精细配额。
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 240;
const hits = new Map<string, { count: number; resetAt: number }>();

app.use('/api/*', async (c, next) => {
  const key =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('x-real-ip') ??
    'unknown';
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else if (entry.count >= MAX_REQUESTS) {
    c.header('retry-after', String(Math.ceil((entry.resetAt - now) / 1000)));
    return c.json({ error: 'rate_limited' }, 429);
  } else {
    entry.count += 1;
  }

  // 顺手清理过期条目，避免 Map 无限增长
  if (hits.size > 10_000) {
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }

  await next();
});

/**
 * 默认缓存策略：**不缓存**。
 *
 * ⚠️ 这个中间件必须存在于"每个响应都带明确 Cache-Control"这件事上。
 * 什么都不设的话浏览器会启发式缓存 —— 我们在静态资源上已经因为这个问题
 * 排查过一轮，症状是"东西明明改好了，页面上还是旧的"。
 *
 * 需要公开缓存的端点（比如资源库的读接口）在自己的 handler 里用
 * `c.header('Cache-Control', ...)` 覆盖它。
 */
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});

app.get('/api/health', (c) =>
  c.json({
    status: 'ok' as const,
    service: 'mcsr-helper-api',
    version: SERVICE_VERSION,
    time: new Date().toISOString(),
  }),
);

// ---------------------------------------------------------------------------
// 认证相关的两个全局中间件。
//
// ⚠️ 顺序有讲究：
//   1. sameOriginOnly 先跑 —— 它在做 IO 之前就能把跨站请求拒掉
//   2. loadUser 后跑 —— 它要查数据库，只在真要处理请求时才做
// ---------------------------------------------------------------------------

// CSRF 第二层（第一层是 cookie 的 SameSite=Lax）。见 auth/middleware.ts 文件头。
app.use('/api/*', sameOriginOnly);

// 从会话 cookie 还原当前用户。**不拦截** —— 需要登录的路由自己声明 requireAuth。
app.use('/api/*', loadUser);

app.route('/api/auth', authRoute);
app.route('/api/resources', resourcesRoute);
// 审核类接口（需要 reviewer / admin 角色）集中在 routes/admin.ts。
// 挂在 /api 上是因为它们的路径是 /admin/queue 与 /resources/:id/approve ——
// 后者与上面那条不冲突：路径段数不同，而且方法是 POST vs GET/PATCH。
app.route('/api', adminRoute);
// 桌面客户端的分发信息（公开读）。见 routes/desktop.ts 的文件头。
app.route('/api', desktopRoute);

// ---------------------------------------------------------------------------
// TEMP · 仅用于 /embed-test 自检页。删除 apps/web/src/dev/ 时一并删掉这个端点。
//
// 为什么要有它：页面里用 document.referrer 判断"浏览器有没有发 Referer"是个**代理指标**，
// 而且会被同源策略、iframe 拦截等因素污染（我们为此误判过两轮）。
// 这个端点返回的是**服务器实际收到的 Referer 请求头** —— 也就是 YouTube 那边
// 会收到的东西，是真正的 ground truth。
// ---------------------------------------------------------------------------
app.get('/api/dev/referer-probe', (c) => {
  const referer = c.req.header('referer') ?? '';

  // 内容协商：自检页优先用 iframe（和 YouTube 嵌入是同一条路径），
  // 但 iframe 万一被策略挡住，它需要一条退路 —— 用 fetch 再测一次。
  // 两条路都由同一个 Referrer-Policy 决定，所以退路同样是有效证据。
  if (c.req.header('accept')?.includes('application/json')) {
    return c.json({ referer, probeReady: true });
  }

  const escaped = referer.replace(/[&<>"']/g, (ch) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[ch] ?? ch;
  });

  return c.html(`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>referer probe</title>
<style>body{margin:0;padding:10px 12px;background:#12141a;color:#e8eaef;
font:12px/1.6 ui-monospace,Consolas,monospace}pre{margin:0;white-space:pre-wrap;word-break:break-all}</style>
</head>
<body data-referer="${escaped}" data-probe-ready="yes">
<pre>服务器收到的 Referer = ${referer ? escaped : '(空 —— 浏览器确实没有发送 Referer)'}</pre>
</body>
</html>`);
});

app.notFound((c) => c.json({ error: 'not_found', path: new URL(c.req.url).pathname }, 404));

app.onError((err, c) => {
  console.error('[api] unhandled error:', err);
  return c.json({ error: 'internal_error' }, 500);
});

if (process.env.NODE_ENV !== 'test') {
  // 启动时就打开数据库并跑迁移 —— 让配置/权限问题在进程启动时暴露，
  // 而不是等到第一个请求进来才 500。
  try {
    getDb();
    console.log('[api] 数据库就绪');
  } catch (error) {
    console.error('[api] 数据库初始化失败:', error);
    process.exit(1);
  }

  // 发信配置自检。**在这里做**，不是在第一次有人注册的时候做 ——
  // 那时候你已经不在看日志了，而失败的表现是"用户说他没收到邮件"。
  console.log(`[api] 发信驱动: ${mailDriverName()}`);
  for (const problem of checkMailConfig()) {
    console.warn(`[api] ⚠️ 邮件配置: ${problem}`);
  }

  // -------------------------------------------------------------------------
  // 过期会话清理。
  //
  // 为什么不在请求路径上顺手删：那会让"读"变成"读+写"。
  // 这台机器是 1 核 + WAL，读可以并发而**写会串行化** ——
  // 在会话校验这条每个请求都要走的路径上引入写，代价太大。
  //
  // 只在启动时和每小时做一次：会话有效期是 30 天，晚清理几小时毫无影响。
  // -------------------------------------------------------------------------
  function sweepSessions(): void {
    try {
      const removed = deleteExpiredSessions(Date.now());
      if (removed > 0) console.log(`[api] 清理过期会话 ${removed} 条`);
    } catch (error) {
      // 清理失败不该影响服务 —— 它只是个后台任务
      console.error('[api] 清理过期会话失败:', error);
    }
  }
  sweepSessions();
  // unref()：这个定时器不应该阻止进程退出（systemd stop 时要能干净地停下来）
  setInterval(sweepSessions, 60 * 60 * 1000).unref();

  serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
    console.log(`[api] listening on http://${HOST}:${info.port}`);
  });
}
