/**
 * 前端 API 客户端。
 *
 * **始终请求相对路径 `/api/*`**：
 *   - 开发时由 Vite 的 proxy 转到 http://127.0.0.1:3001
 *   - 生产时由 Caddy 反向代理到本机的 API 进程
 * 这样同一份代码在浏览器、Electron（加载 localhost）和 Electron（加载线上域名）
 * 三种场景下行为完全一致，不需要任何环境判断。
 */
import type { UserSelf } from '@mcsr/shared/auth';
import type { ResourceDetail, ResourceListResponse, ResourceQuery } from '@mcsr/shared/resources';

export interface HealthResponse {
  status: 'ok';
  service: string;
  version: string;
  time: string;
}

/** 字段级校验错误。服务端把 Zod 的 issues 整理过之后就是这个形状。 */
export interface FieldIssue {
  field: string;
  message: string;
}

/**
 * 带上状态码的错误，让界面能区分"没找到"和"服务挂了"。
 *
 * `code` 是服务端返回的错误代码（`invalid_credentials`、`rate_limited`…）。
 * 界面靠它选文案，而**不靠匹配 message 文本** —— 后者一改文案就悄悄失效，
 * 而且是那种"测试全绿、线上文案变成英文"的失效。
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    /** 被限流时还要等多少秒（来自 Retry-After 响应头）。 */
    readonly retryAfterSec?: number,
    /** 字段级校验错误。 */
    readonly issues?: FieldIssue[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { headers: { accept: 'application/json' }, signal });
  } catch (error) {
    // abort 是我方主动取消，不应该显示成错误
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('连不上 API —— 本地开发时后端可能没启动。用 pnpm dev 或 pnpm dev:web', 0);
  }

  if (!res.ok) {
    // 502/500 在本地开发里几乎总是"API 进程没起来"：Vite 的代理转发失败就是这个状态码。
    // 直接把这个猜测写进错误里，省得每次都要重新推一遍。
    const hint =
      res.status >= 500
        ? ' —— 本地开发时后端没启动？用 pnpm dev 或 pnpm dev:web，它们会一起启动 API'
        : '';
    throw new ApiError(`API 返回 HTTP ${res.status}${hint}`, res.status);
  }

  return (await res.json()) as T;
}

export function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return request<HealthResponse>('/api/health', signal);
}

/** 把查询条件拼成 query string。空值一律省略，避免产生 `?kind=&lang=&tag=` 这种噪音。 */
export function buildResourceQuery(query: Partial<ResourceQuery>): string {
  const params = new URLSearchParams();
  if (query.kind) params.set('kind', query.kind);
  if (query.lang) params.set('lang', query.lang);
  if (query.tag) params.set('tag', query.tag);
  if (query.q) params.set('q', query.q);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function fetchResources(
  query: Partial<ResourceQuery>,
  signal?: AbortSignal,
): Promise<ResourceListResponse> {
  return request<ResourceListResponse>(`/api/resources${buildResourceQuery(query)}`, signal);
}

export function fetchResource(id: string, signal?: AbortSignal): Promise<ResourceDetail> {
  return request<ResourceDetail>(`/api/resources/${encodeURIComponent(id)}`, signal);
}

export interface TagCount {
  tag: string;
  count: number;
}

export function fetchTags(signal?: AbortSignal): Promise<{ tags: TagCount[] }> {
  return request<{ tags: TagCount[] }>('/api/resources/tags', signal);
}

// ---------------------------------------------------------------------------
// 账号
// ---------------------------------------------------------------------------

interface ErrorPayload {
  error?: string;
  retryAfterSec?: number;
  issues?: FieldIssue[];
}

/**
 * 发一个带 JSON body 的请求。
 *
 * ⚠️ 这里**必须**把服务端的错误信息读出来，不能像 GET 那样只看状态码。
 * 注册/登录的失败有好几种，界面要给出不同的提示：
 *   · 401 invalid_credentials → "邮箱或密码不对"
 *   · 429 rate_limited        → "请等 N 秒后再试"（N 来自 Retry-After）
 *   · 400 invalid_input       → 逐字段显示校验错误
 *   · 502 send_failed         → "邮件发送失败"
 * 全都笼统地报"出错了"，用户就完全不知道下一步该做什么。
 *
 * 关于 cookie：请求是**同源**的（开发时 Vite 代理，生产时 Caddy 代理），
 * 所以 fetch 默认的 credentials:'same-origin' 就会带上会话 cookie，
 * 不需要显式设置。
 */
async function sendJson<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('连不上 API —— 本地开发时后端可能没启动。用 pnpm dev 或 pnpm dev:web', 0);
  }

  // 错误响应也应该是 JSON，但不是所有失败都保证有 body（502 来自反代时就没有）
  const payload = (await res.json().catch(() => null)) as (T & ErrorPayload) | null;

  if (!res.ok) {
    const headerRetry = Number(res.headers.get('retry-after') ?? '') || undefined;
    throw new ApiError(
      `API 返回 HTTP ${res.status}`,
      res.status,
      payload?.error,
      payload?.retryAfterSec ?? headerRetry,
      payload?.issues,
    );
  }

  return payload as T;
}

/** 当前登录用户。未登录时 `user` 是 null（不是错误）。 */
export function fetchMe(signal?: AbortSignal): Promise<{ user: UserSelf | null }> {
  return request<{ user: UserSelf | null }>('/api/auth/me', signal);
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  locale: 'zh-CN' | 'en';
}

/**
 * 注册。
 *
 * 返回值里**没有 user**，也不会下发会话 cookie —— 注册不自动登录，
 * 而且无论邮箱是否已注册，响应都完全一致（见 services/api/src/routes/auth.ts）。
 * 所以界面拿到这个响应之后只能显示一句中性的话，不能假装"注册成功"。
 */
export function register(input: RegisterInput): Promise<{ ok: true; message: string }> {
  return sendJson('POST', '/api/auth/register', input);
}

export function login(email: string, password: string): Promise<{ user: UserSelf }> {
  return sendJson('POST', '/api/auth/login', { email, password });
}

export function logout(): Promise<{ ok: true }> {
  return sendJson('POST', '/api/auth/logout');
}

export function sendVerifyEmail(): Promise<{ ok: true; alreadyVerified?: boolean }> {
  return sendJson('POST', '/api/auth/verify/send');
}

export function verifyEmail(token: string): Promise<{ ok: true; user: UserSelf | null }> {
  return sendJson('POST', '/api/auth/verify', { token });
}

export function requestPasswordReset(email: string): Promise<{ ok: true; message: string }> {
  return sendJson('POST', '/api/auth/reset/request', { email });
}

export function confirmPasswordReset(token: string, password: string): Promise<{ ok: true }> {
  return sendJson('POST', '/api/auth/reset/confirm', { token, password });
}
