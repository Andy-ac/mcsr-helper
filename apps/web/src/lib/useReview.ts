import { useCallback, useEffect, useState } from 'react';

/**
 * 审核页用的异步取数 hook。
 *
 * ---------------------------------------------------------------------------
 * 为什么不在 `useAsync` 上加两个参数了事
 * ---------------------------------------------------------------------------
 * `useAsync` 的 error 是**字符串**（`error.message`），状态码在那一步就丢了。
 * 而审核页必须区分三种失败：
 *   · 401 未登录   → 给登录入口，登录后回到这里
 *   · 403 权限不足 → 明确告诉他"你没有审核权限"，不要装作页面坏了
 *   · 404 已处理   → 另一位审核员刚处理掉了，回队列即可
 * 全都显示成一句错误信息的话，用户唯一能做的只有刷新。
 *
 * 它还需要 `reload()`：审核完之后列表和详情都得重新取。
 * `useAsync` 没有刷新入口 —— 改它就要动已有的三个调用点，
 * 而它们用得好好的。所以这里单独写一个，只服务于审核页。
 */
export type ReviewState<T> =
  | { status: 'loading' }
  | { status: 'ok'; data: T }
  | { status: 'error'; error: unknown };

export function useReview<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): { state: ReviewState<T>; reload: () => void } {
  const [state, setState] = useState<ReviewState<T>>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 依赖由调用方显式给出（loader 每次渲染都是新函数），nonce 是刷新触发器
  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setState({ status: 'loading' });

    loader(controller.signal)
      .then((data) => {
        if (active) setState({ status: 'ok', data });
      })
      .catch((error: unknown) => {
        if (!active) return;
        // abort 是我方主动取消，不是错误
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({ status: 'error', error });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [...deps, nonce]);

  return { state, reload };
}
