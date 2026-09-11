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

// ---------------------------------------------------------------------------
// TEMP · 仅用于 /embed-test 自检页。删除 apps/web/src/dev/ 时一并删掉这个端点。
//
// 为什么要有它：页面里用 document.referrer 判断"浏览器有没有发 Referer"是个**代理指标**，
// 而且会被同源策略、iframe 拦截等因素污染（我们为此误判过一轮）。
// 这个端点返回的是**服务器实际收到的 Referer 请求头** —— 也就是 YouTube 那边
// 会收到的东西，是真正的 ground truth。
//
// 返回 HTML 而不是 JSON：它要被 iframe 加载，且同源所以父页面能直接读它的 DOM。
// ---------------------------------------------------------------------------
app.get('/api/dev/referer-probe', (c) => {
  const referer = c.req.header('referer') ?? '';
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
  serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
    console.log(`[api] listening on http://${HOST}:${info.port}`);
  });
}
