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
  let res: Response;
  try {
    res = await fetch('/api/health', {
      headers: { accept: 'application/json' },
      signal,
    });
  } catch {
    throw new Error(
      '连不上 API —— 本地开发时后端可能没启动。用 pnpm dev（全起）或 pnpm dev:web（Web+API）',
    );
  }

  if (!res.ok) {
    // 502/500 在本地开发里几乎总是"API 进程没起来"：Vite 的代理转发失败就是这个状态码。
    // 直接把这个猜测写进错误里，省得每次都要重新推一遍。
    const hint =
      res.status >= 500
        ? ' —— 本地开发时后端没启动？用 pnpm dev 或 pnpm dev:web，它们会一起启动 API'
        : '';
    throw new Error(`API 返回 HTTP ${res.status}${hint}`);
  }

  return (await res.json()) as HealthResponse;
}
