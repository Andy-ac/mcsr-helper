/**
 * 前端 API 客户端。
 *
 * **始终请求相对路径 `/api/*`**：
 *   - 开发时由 Vite 的 proxy 转到 http://127.0.0.1:3001
 *   - 生产时由 Caddy 反向代理到本机的 API 进程
 * 这样同一份代码在浏览器、Electron（加载 localhost）和 Electron（加载线上域名）
 * 三种场景下行为完全一致，不需要任何环境判断。
 */
import type { ResourceDetail, ResourceListResponse, ResourceQuery } from '@mcsr/shared/resources';

export interface HealthResponse {
  status: 'ok';
  service: string;
  version: string;
  time: string;
}

/** 带上状态码的错误，让界面能区分"没找到"和"服务挂了"。 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
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
