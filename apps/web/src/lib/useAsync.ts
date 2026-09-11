import { useEffect, useState } from 'react';

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'ok'; data: T }
  | { status: 'error'; error: string };

/**
 * 极简的异步数据 hook。
 *
 * 为什么不上 TanStack Query：
 *   M1 只有三个只读接口（列表、详情、标签云），没有 mutation、没有缓存失效、
 *   没有乐观更新 —— 那正是 TanStack Query 真正开始回本的地方。
 *   现在引入它只是多一层抽象。
 *
 * 什么时候该换：M2 会出现"提交后列表要刷新""审核后详情要更新"这类**跨组件失效**，
 * 那时候手写 invalidate 会开始变难看，TanStack Query 就是对的工具。届时这个
 * hook 的调用点几乎可以原样替换。
 *
 * 已经处理的细节：
 *   - 组件卸载或依赖变化时 abort 掉请求（否则会出现"慢请求覆盖新结果"）
 *   - abort 不当作错误显示（它是我方主动取消）
 */
export function useAsync<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });

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
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      active = false;
      controller.abort();
    };
    // loader 每次渲染都是新函数，所以依赖由调用方显式给出 —— 这是刻意的，
    // 避免"看起来在依赖 loader，实际每次都重新请求"的隐性全量刷新。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
