export interface HealthResponse {
  status: 'ok';
  service: string;
  version: string;
  time: string;
}

/**
 * 前端**始终**请求相对路径 `/api/*`：
 *   - 开发时由 Vite 的 proxy 转到 http://127.0.0.1:3001
 *   - 生产时由 Caddy 反向代理到本机的 API 进程
 *
 * 这样同一份代码在浏览器、Electron（加载 localhost）和 Electron（加载线上域名）
 * 三种场景下行为完全一致，不需要任何环境判断。
 */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const res = await fetch('/api/health', {
    headers: { accept: 'application/json' },
    signal,
  });
  if (!res.ok) throw new Error(`API 返回 HTTP ${res.status}`);
  return (await res.json()) as HealthResponse;
}
