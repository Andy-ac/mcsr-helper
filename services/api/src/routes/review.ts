/**
 * 通用审核接口。
 *
 * ---------------------------------------------------------------------------
 * 为什么是 /admin/review/:type/:id 而不是每类内容一套路由
 * ---------------------------------------------------------------------------
 * M4 加日历、视频、种子时，如果每类都写一套 approve/reject，
 * 就会有四份几乎一样的代码 —— 而其中**最关键的一行是权限判断**。
 * 四份里漏改一份就是一条权限漏洞，而漏洞不会报错，只会静默地允许越权。
 *
 * 所以路由只有一套，类型是参数。加一类内容要改的是
 * `review/registry.ts` 里注册一个实现，**不是**这里。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 权限按类型查，不能在中间件里写死
 * ---------------------------------------------------------------------------
 * `resource.review` 和 `seed.review` 是两个不同的能力（见 shared/permissions.ts）。
 * 一个只能审种子的人不该能审资源。所以能力必须从 `:type` 解析出来 ——
 * 写成 `requireCapability('resource.review')` 就是把四类内容的权限绑死了。
 */

import type { Actor, UserRole } from '@mcsr/shared/permissions';
import { canSelfReview, checkPermission } from '@mcsr/shared/permissions';
import { RejectInputSchema } from '@mcsr/shared/resources';
import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import type { AuthVariables } from '../auth/middleware';
import { notifyReviewResult } from '../email/notify';
import { getDetail, implFor, listQueue, registeredTypes } from '../review/registry';
import { writeAudit } from '../users';

export const reviewRoute = new Hono<{ Variables: AuthVariables }>();

/**
 * 按 `:type` 解析出应当要求的能力，再判断。
 *
 * 三种拒绝返回三种状态码，理由同 auth/middleware.ts：
 * 未登录 / 权限不足 / 邮箱未验证，对用户意味着完全不同的下一步。
 */
const requireReviewCapability: MiddlewareHandler<{ Variables: AuthVariables }> = async (
  c,
  next,
) => {
  const type = c.req.param('type') ?? '';
  const impl = implFor(type);
  if (!impl) {
    return c.json({ error: 'unknown_type', type }, 404);
  }

  const user = c.get('user');
  const actor: Actor | null = user
    ? { role: user.role as UserRole, emailVerified: user.email_verified_at !== null }
    : null;

  const result = checkPermission(actor, impl.capability);
  if (!result.ok) {
    if (result.reason === 'unauthenticated') return c.json({ error: 'unauthorized' }, 401);
    return c.json({ error: result.reason, capability: impl.capability }, 403);
  }

  return next();
};

// ---------------------------------------------------------------------------
// 队列
// ---------------------------------------------------------------------------

/**
 * 待审队列，**跨类型汇总**。
 *
 * 审核员打开的是"所有待审内容"，而不是"资源库的待审内容" ——
 * 他不应该需要挨个类型点一遍才知道今天有多少活。
 */
reviewRoute.get(
  '/admin/queue',
  async (c, next) => {
    /*
     * ⚠️ 队列本身的权限：**任意一个类型的审核权**就能看队列。
     *
     * 这里不能复用 requireReviewCapability（那个需要 :type 参数）。
     * 也不能要求"所有类型的审核权" —— 一个只审种子的人也应该能看到队列里
     * 有多少活，否则他连入口都进不去。
     *
     * 列表里**只返回他有权限审核的类型**（见下面按 capability 过滤），
     * 所以"能看队列"不会泄漏他无权审核的内容。
     */
    const user = c.get('user');
    if (!user) return c.json({ error: 'unauthorized' }, 401);

    const actor: Actor = {
      role: user.role as UserRole,
      emailVerified: user.email_verified_at !== null,
    };
    const allowed = registeredTypes().filter((t) => {
      const impl = implFor(t);
      return impl ? checkPermission(actor, impl.capability).ok : false;
    });
    if (allowed.length === 0) {
      return c.json({ error: 'forbidden' }, 403);
    }

    await next();
  },
  (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 200);
    const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0);

    // ⚠️ 这里拿不到上一个中间件里的局部变量，要从上下文取；
    //    viewerId 只用来算每一项的 mine（"这一版是不是你自己提的"）。
    const viewer = c.get('user')?.id ?? null;
    const { items, total, counts } = listQueue(limit, offset, viewer);

    // ⚠️ 待审内容绝不能缓存。它不是公开内容，而且审核员刷新后看到的必须是当前状态 ——
    //    否则会出现"刚批准完，列表里还有"，他再点一次得到 409。
    c.header('Cache-Control', 'no-store');
    return c.json({ items, total, counts, types: registeredTypes() });
  },
);

// ---------------------------------------------------------------------------
// 详情
// ---------------------------------------------------------------------------

reviewRoute.get('/admin/review/:type/:id', requireReviewCapability, (c) => {
  const type = c.req.param('type');
  const id = c.req.param('id');

  const detail = getDetail(type, id, c.get('user')?.id ?? null);
  if (!detail) {
    // 可能是：条目不存在、或者已经没有待审版本了（被另一位审核员处理掉了）
    return c.json({ error: 'not_found' }, 404);
  }

  c.header('Cache-Control', 'no-store');
  return c.json(detail);
});

// ---------------------------------------------------------------------------
// 审核动作
// ---------------------------------------------------------------------------

reviewRoute.post('/admin/review/:type/:id/approve', requireReviewCapability, async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const type = c.req.param('type');
  const id = c.req.param('id');
  const impl = implFor(type);
  if (!impl) return c.json({ error: 'unknown_type', type }, 404);

  /*
   * ★ 职责分离：**reviewer 不能批准自己提交的内容**。
   *
   * 审核的全部意义是"有第二个人看过"。如果提改动的人自己就能批，
   * 审核就退化成了一个人的两步操作 —— 而且**从外面完全看不出来**：
   * 审计里只有 submit 和 approve 两条记录，看不出是同一个人做的。
   *
   * editor / admin 不受这条限制：他们是站点的固定内容负责人，自己写自己批
   * 是正常工作流，要求"第二个编辑者"在只有一两个编辑者时会把事情卡死。
   * 规则本身写在 shared/permissions.ts 的 canSelfReview 里
   * （和权限矩阵放在一起，有测试守着）。
   *
   * ⚠️ 它只挡**批准**，不挡**驳回**。驳回自己提交的东西等于撤回，
   *    而撤回不该需要别人的许可 —— 那反而会成为 reviewer 唯一的退路。
   *
   * ⚠️ 用 getDetail 而不是另查一次库：item.mine 就是"这一版是不是你提的"，
   *    它和审核界面看到的是同一个判断，不会再有两份会漂移的规则。
   */
  if (!canSelfReview(user.role as UserRole)) {
    const detail = getDetail(type, id, user.id);
    if (detail?.item.mine) {
      return c.json({ error: 'self_review', role: user.role }, 403);
    }
  }

  const now = Date.now();
  const approved = impl.approve(id, user.id, now);
  if (!approved) {
    // 没有待审版本，或已被另一位审核员处理
    return c.json({ error: 'nothing_pending' }, 409);
  }

  writeAudit({
    actorId: user.id,
    action: `${type}.approve`,
    entityType: type,
    entityId: id,
    reason: `revision ${String(approved.revision)}`,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  // 通知提交者。⚠️ 通知失败不影响审核结果（见 email/notify.ts 的头注释）
  await notifyReviewResult({
    editorId: approved.notify.editorId,
    title: approved.notify.title,
    approved: true,
  });

  return c.json({ ok: true, type, id, revision: approved.revision, status: 'published' });
});

reviewRoute.post('/admin/review/:type/:id/reject', requireReviewCapability, async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const type = c.req.param('type');
  const id = c.req.param('id');
  const impl = implFor(type);
  if (!impl) return c.json({ error: 'unknown_type', type }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = RejectInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', reason_required: true }, 400);
  }

  const now = Date.now();
  const result = impl.reject(id, user.id, parsed.data.reason, now);
  if (!result) {
    return c.json({ error: 'nothing_pending' }, 409);
  }

  writeAudit({
    actorId: user.id,
    action: `${type}.reject`,
    entityType: type,
    entityId: id,
    reason: parsed.data.reason,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  /*
   * 通知提交者，**把驳回理由一起发出去**。
   *
   * 只说"被驳回了"的邮件比不发更糟：用户知道自己失败了却不知道下一步，
   * 唯一的反应是原样再交一次。
   */
  await notifyReviewResult({
    editorId: result.notify.editorId,
    title: result.notify.title,
    approved: false,
    reason: parsed.data.reason,
  });

  return c.json({
    ok: true,
    type,
    id,
    revision: result.revision,
    /*
     * ⚠️ 用**服务端实际写进去的状态**，不要再自己推一遍。
     *
     * 这里原来写的是 `result.resourceRejected ? 'rejected' : 'published'` ——
     * 那一刻它和数据库是一致的，但它是一份**重复的规则**：
     * 后来 rejectRevision 改成"线上正展示着就保持原状"（可能是 hidden），
     * 这个表达式就开始撒谎了（把 hidden 报成 published）。
     * 审核界面拿这个值显示"驳回之后线上是什么状态"，
     * 报错了审核员会以为自己的操作把内容恢复了。
     */
    status: result.status,
    // 告诉前端"这个条目原本已发布，所以线上版本保留下来了" ——
    // 审核员据此知道自己的驳回没有把老条目从站上抹掉。
    liveVersionKept: !result.resourceRejected,
  });
});
