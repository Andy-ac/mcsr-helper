import { REVIEWABLE_TYPES, type ReviewableType, type ReviewDetail } from '@mcsr/shared/review';
import type { ComponentType } from 'react';
import { CalendarReviewView } from '@/components/CalendarReviewView';
import { ResourceReviewView } from '@/components/ResourceReviewView';

/**
 * 审核界面的类型注册表 —— 加一类内容时要改的**第三个**地方。
 *
 * ---------------------------------------------------------------------------
 * 三处，缺一不可
 * ---------------------------------------------------------------------------
 *   1. packages/shared/src/review.ts   → REVIEWABLE_TYPES（类型的总名单）
 *   2. services/api/src/review/registry.ts → IMPLEMENTATIONS（服务端实现）
 *   3. 这里                             → REVIEW_UI（界面怎么展示）
 *
 * 为什么故意拆成三处、而不是合并成一个"类型定义表"：
 * 这三处分别在三个不同的包里（共享、服务端、前端），它们的依赖方向是
 * shared ← server、shared ← web。合并会让前端代码被打进服务端 bundle，
 * 或者反过来。
 *
 * 而"漏改一处"这件事有编译器兜底：下面这个 `Record<ReviewableType, …>`
 * 是**穷尽**的 —— 在 shared 里加一个类型，这里立刻报缺字段。
 * 所以拆开是安全的。
 */

export interface ReviewableUi {
  /** 该类型的提交页路径。提交页挂在各自功能下（`/resources/submit`），不是 `/submit`。 */
  submitPath: string;
  /** 该类型条目的公开详情页。审核完跳过去确认用的是它。 */
  itemPath(id: string): string;
  /** 审核详情的主体：**类型相关的那一半**。 */
  Detail: ComponentType<{ detail: ReviewDetail }>;
}

export const REVIEW_UI: Record<ReviewableType, ReviewableUi> = {
  resource: {
    submitPath: '/resources/submit',
    itemPath: (id) => `/resources/${encodeURIComponent(id)}`,
    Detail: ResourceReviewView,
  },
  calendar: {
    // 提交页挂在日历版块下（`/calendar/submit`），不是 `/submit` —— 见 ReviewableUi 的注释
    submitPath: '/calendar/submit',
    itemPath: (id) => `/calendar/${encodeURIComponent(id)}`,
    Detail: CalendarReviewView,
  },
};

/**
 * 地址栏里的类型 → 已知类型。
 *
 * ⚠️ 必须做这一步，不能直接 `REVIEW_UI[type]`。
 *    参数来自地址栏，`/review/foo/1` 是完全合法的输入，而
 *    `REVIEW_UI['foo']` 是 `undefined`，随后 `.Detail` 就是运行时崩溃 ——
 *    一个手打的链接能把整页干掉。
 *
 * 返回类型是 `ReviewableType | null`，所以调用方拿到非 null 之后
 * 传给接口函数的是**合法的联合类型**，不需要任何 `as` 断言。
 */
export function reviewType(type: string | undefined): ReviewableType | null {
  if (!type) return null;
  return (REVIEWABLE_TYPES as readonly string[]).includes(type) ? (type as ReviewableType) : null;
}

/** 该类型的界面配置。查不到返回 null（同上）。 */
export function reviewUiFor(type: string | undefined): ReviewableUi | null {
  const known = reviewType(type);
  return known ? REVIEW_UI[known] : null;
}
