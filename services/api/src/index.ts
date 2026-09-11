/**
 * MCSR Helper API —— M0 骨架。
 *
 * M0 阶段只有一个端点（/api/health），它的作用是**让部署管线端到端可验证**：
 * 如果 /api/health 在线上返回 200，说明 Caddy → 反向代理 → Node 进程
 * 这条链路是通的。只部署静态文件的话，这条链路根本没被测试到。
 *
 * 后续：M1 加用户与邮箱验证，M2 加 UGC 管线（见 docs/v1-plan.md §7）。
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';

const PORT = Number.parseInt(process.env.PORT ?? '3001', 10);
// 生产环境必须只监听回环地址：对外由 Caddy 反代。
// 直接监听 0.0.0.0 会让 API 绕过 HTTPS 暴露在公网上。
const HOST = process.env.HOST ?? '127.0.0.1';

const SERVICE_VERSION = '0.0.1-m0';

export const app = new Hono();

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

app.get('/api/health', (c) =>
  c.json({
    status: 'ok' as const,
    service: 'mcsr-helper-api',
    version: SERVICE_VERSION,
    time: new Date().toISOString(),
  }),
);

app.notFound((c) => c.json({ error: 'not_found', path: new URL(c.req.url).pathname }, 404));

app.onError((err, c) => {
  console.error('[api] unhandled error:', err);
  return c.json({ error: 'internal_error' }, 500);
});

if (process.env.NODE_ENV !== 'test') {
  serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
    console.log(`[api] listening on http://${HOST}:${info.port}`);
  });
}
