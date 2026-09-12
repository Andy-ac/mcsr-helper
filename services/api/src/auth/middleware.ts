/**
 * 认证中间件：读会话、挂用户、按需拦截。
 *
 * ---------------------------------------------------------------------------
 * 关于 CSRF：为什么不额外发一个 CSRF token
 * ---------------------------------------------------------------------------
 * 本项目的 CSRF 防护由**两层**构成，两层都在，而且都不依赖前端配合：
 *
 * 1. **SameSite=Lax**（cookie 属性）。
 *    跨站发起的 POST 不会带上 cookie，这一条就挡住了绝大多数 CSRF。
 *    浏览器兼容性现在没有问题了（Lax 是 Chrome 的默认值）。
 *
 * 2. **Origin 校验**（下面的 sameOriginOnly）。
 *    对 POST/PATCH/PUT/DELETE，要求 Origin 头与本站一致。
 *
 * 为什么第 2 层是必须的而不是重复：SameSite 是**浏览器**承诺的行为，
 * 而 API 是公开的、可以被非浏览器客户端直接调用。Origin 校验在服务端执行，
 * 不依赖调用方守规矩。而且它顺手挡住了"用户被诱导提交跨站表单"这类场景。
 *
 * 为什么不用 token 方案（双提交 cookie / synchronizer token）：
 * token 方案要前端在每个请求里带上它，于是要么把它塞进 JS 可读的 cookie
 * （那就放弃了 HttpOnly），要么在每个页面里渲染进 DOM（SPA 里更麻烦）。
 * 在"API 与前端同源、且只接受 JSON"这个前提下，上面两层已经覆盖了同样的攻击面，
 * 而且没有把复杂度转移到前端。**如果将来 API 要开放给第三方跨域调用，
 * 这个结论就变了** —— 那时需要真正的 CORS 白名单 + token。
 */

import { SITE } from '@mcsr/shared';
import type { MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { SessionRow, UserRow } from '../users';
import { findValidSession, touchSession } from '../users';
import { hashToken, SESSION_TTL_MS } from './tokens';

export const SESSION_COOKIE = 'mcsr_session';

/** Hono 的上下文变量类型。挂在所有需要认证的路由上。 */
export type AuthVariables = {
  user: UserRow | null;
  session: SessionRow | null;
};

/**
 * 是否给 cookie 加 `Secure`。
 *
 * 生产环境（systemd 里设了 NODE_ENV=production）必须是 true ——
 * 否则 cookie 会在明文 HTTP 上传输，中间人可以直接拿走登录态。
 *
 * 开发时是 false，因为 dev 前端跑在 http://localhost:5173 上。
 * （其实现代浏览器允许在 localhost 上用 Secure cookie，但没必要依赖这一点。）
 */
function cookieSecure(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function setSessionCookie(
  c: Parameters<MiddlewareHandler>[0],
  token: string,
  maxAgeSec: number,
): void {
  setCookie(c, SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true, // JS 读不到 → XSS 也偷不走登录态
    secure: cookieSecure(),
    sameSite: 'Lax', // 见文件头：第一层 CSRF 防护
    maxAge: maxAgeSec,
  });
}

export function clearSessionCookie(c: Parameters<MiddlewareHandler>[0]): void {
  deleteCookie(c, SESSION_COOKIE, {
    path: '/',
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'Lax',
  });
}

/**
 * 从 cookie 还原当前用户。**不拦截**，只是把结果挂到 context 上。
 *
 * 挂载顺序上它要跑在所有业务路由之前，但**不能**替代 requireAuth ——
 * 需要登录的路由自己声明 requireAuth，这样"哪些端点需要登录"
 * 在读路由定义时就是可见的，不用去翻中间件。
 */
export const loadUser: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  c.set('user', null);
  c.set('session', null);

  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const now = Date.now();
    const found = findValidSession(hashToken(token), now);
    if (found) {
      c.set('user', found.user);
      c.set('session', found.session);
      // 被停用的账号：**保留会话但不认作登录用户**。
      // 这样用户会看到"已登录但被停用"，而不是莫名其妙地被登出。
      if (found.user.status === 'suspended') {
        c.set('user', null);
      } else {
        touchSession(found.session.token_hash, now);
      }
    }
  }

  await next();
};

/** 需要登录。未登录返回 401。 */
export const requireAuth: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  if (!c.get('user')) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
};

/**
 * 需要**已验证邮箱**才能做（提交内容）。
 *
 * 返回 403 而不是 401：用户是登录着的，只是没做那一步。
 * 前端据此显示"去验证邮箱"，而不是跳登录页 —— 这两者要能区分开。
 */
export const requireVerified: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  if (user.email_verified_at === null) {
    return c.json({ error: 'email_not_verified' }, 403);
  }
  await next();
};

/**
 * 对会改变状态的请求做同源校验（CSRF 第二层，见文件头）。
 *
 * ⚠️ Origin 缺失时**放过**。这一条看起来像漏洞，其实是必要的：
 * 部分老客户端和非浏览器调用方不发 Origin，而"没有 Origin"本身
 * 不构成 CSRF —— 浏览器发起的跨站表单**一定**带 Origin。
 * 真正被这条挡住的是"浏览器被诱导提交了跨站请求"。
 * 如果我们把缺失 Origin 也拒掉，代价是 curl / Electron 主进程全都要改。
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const sameOriginOnly: MiddlewareHandler = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();

  const origin = c.req.header('origin');
  if (!origin) return next();

  // ⚠️ 显式写 `Set<string>`。不写的话 TS 会从 SITE 的 `as const` 推出一个
  //    字面量联合类型（"http://localhost:5173" | "https://..."），
  //    于是下面 add(动态字符串) 会被拒绝 —— 报错信息和真正的问题毫无关系。
  const allowed = new Set<string>([SITE.productionOrigin, SITE.devServerOrigin]);
  // 反代场景：Caddy 转发时 c.req.url 的 host 就是外部域名。
  try {
    allowed.add(new URL(c.req.url).origin);
  } catch {
    /* url 解析失败就不加，按下面的判断走 */
  }

  if (!allowed.has(origin)) {
    return c.json({ error: 'cross_origin_rejected' }, 403);
  }
  await next();
};

/** 会话时长，秒。登录响应用它设 cookie 的 maxAge。 */
export const SESSION_MAX_AGE_SEC = Math.floor(SESSION_TTL_MS / 1000);
