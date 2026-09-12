import type { ReactNode } from 'react';
import { em } from '@/components/Emphasis';

/**
 * 表单字段。
 *
 * 抽出来是为了让四个认证表单（登录、注册、找回、重置）长得一模一样 ——
 * 手写四遍的结果通常是标签位置、间距、错误提示的位置各差一点点，
 * 那种"看起来没对齐"的感觉很难定位，但一眼就能感觉到。
 *
 * ⚠️ `hint` 走 `em()`：词条里用 `**…**` 表示强调（见 Emphasis.tsx），
 *    而这里**是**渲染词条的地方 —— 不走的话用户看到的是成对的星号。
 */
export function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="mcsr-field">
      <label className="mcsr-field__label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint ? <p className="mcsr-field__hint">{em(hint)}</p> : null}
    </div>
  );
}

/**
 * 提示条。
 *
 * `role` 的选取是有意的：
 *   · bad  → `alert`，读屏会立刻打断当前朗读。错误需要被马上知道。
 *   · ok   → `status`，读屏会在当前朗读结束后再播报，不会打断。
 *           "注册邮件已发送"这种事不值得打断用户。
 *
 * ⚠️ `children` 是字符串时走 `em()`；是 ReactNode（比如里面还套了链接）时
 *    原样渲染 —— **不能**对 ReactNode 调 `em()`（它是 string 的函数），
 *    而"只在字符串时处理"这个分支是必须的，否则那几处带链接的调用点会崩。
 */
export function Notice({ kind, children }: { kind: 'ok' | 'bad' | 'info'; children: ReactNode }) {
  return (
    <div className={`notice notice--${kind}`} role={kind === 'bad' ? 'alert' : 'status'}>
      {typeof children === 'string' ? em(children) : children}
    </div>
  );
}
