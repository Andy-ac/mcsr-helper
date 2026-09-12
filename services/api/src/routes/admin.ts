/**
 * 审核接口。
 *
 * ---------------------------------------------------------------------------
 * 为什么单独一个文件
 * ---------------------------------------------------------------------------
 * 这里是整个 API 里**唯一**需要高于普通用户的权限的地方。
 * 把它集中在一个文件里，安全审查就只需要回答一个问题：
 * "这个文件里有没有哪条路由漏了 requireRole？"
 * 如果审核接口散落在 routes/resources.ts 里和公开读接口混在一起，
 * 那个问题就变成了"整个文件里有没有一条忘了加中间件" —— 难得多。
 *
 * 挂载方式（见 index.ts）：`app.route('/api', adminRoute)` ——
 * 所以这里的路径写 `/admin/queue`、`/resources/:id/approve`。
 * 后者与 resourcesRoute 的 `/:id` 不冲突：路径段数不同，
 * 而且方法是 POST vs GET/PATCH。
 */
import { RejectInputSchema } from '@mcsr/shared/resources';
import { Hono } from 'hono';

import { type AuthVariables, requireRole } from '../auth/middleware';
import { getDb } from '../db';
import { resourceExists } from '../resources';
import { approveRevision, listReviewQueue, rejectRevision } from '../revisions';
import { writeAudit } from '../users';

export const adminRoute = new Hono<{ Variables: AuthVariables }>();

/**
 * 能审核的角色。
 *
 * ⚠️ 定义成一个常量而不是在每个路由里各写一遍 —— 一遍写漏就是一条权限漏洞，
 * 而"写漏"这种事在复制粘贴里太容易发生了。
 */
const REVIEWER = ['reviewer', 'admin'] as const;

// ---------------------------------------------------------------------------
// 待审队列
// ---------------------------------------------------------------------------

adminRoute.get('/admin/queue', requireRole(...REVIEWER), (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 200);
  const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0);
  const { items, total } = listReviewQueue(limit, offset);

  // ⚠️ 待审内容**绝不能**被缓存。它不是公开内容，而且审核员刷新之后
  //    看到的必须是当前状态 —— 否则会出现"刚批准完，列表里还有"，
  //    然后他再点一次，得到 409。
  c.header('Cache-Control', 'no-store');

  return c.json({
    items: items.map((r) => ({
      resourceId: r.resource_id,
      revision: r.revision,
      title: r.title,
      kind: r.kind,
      url: r.url,
      isEdit: r.is_edit === 1,
      authorName: r.author_name,
      createdAt: r.created_at,
    })),
    total,
  });
});

// ---------------------------------------------------------------------------
// 审核动作
// ---------------------------------------------------------------------------

/**
 * 批准。
 *
 * 审批的是 **`pending_revision` 指向的那条快照**，不是 resources 行的内容。
 * 这个区别是有意义的：作者在"提交之后、审核之前"可以再改一次 resources 行吗？
 * 不能（PATCH 只写 revisions），所以审核员看到的内容和他批准的内容是同一份。
 * 这挡住了"先提交无害版本过审、再改成广告"这个经典攻击 —— §3 的设计约束之二。
 */
adminRoute.post('/resources/:id/approve', requireRole(...REVIEWER), (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const id = c.req.param('id');
  // ⚠️ 用 resourceExists 而不是 getResource —— 后者会过滤掉非 published 的条目，
  //    而这里要批准的恰恰是一个 pending 条目。
  if (!resourceExists(id)) return c.json({ error: 'not_found' }, 404);

  const now = Date.now();
  const result = approveRevision({ resourceId: id, reviewerId: user.id, now });
  if (!result) {
    // 没有待审版本，或它已经被另一位审核员处理了
    return c.json({ error: 'nothing_pending' }, 409);
  }

  writeAudit({
    actorId: user.id,
    action: 'resource.approve',
    entityType: 'resource',
    entityId: id,
    reason: `revision ${String(result.revision)}`,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  return c.json({ ok: true, id, revision: result.revision, status: 'published' });
});

/**
 * 驳回。**必须给理由。**
 *
 * 没有理由的驳回等于让作者瞎猜该改什么，而这个系统里作者看不到审核员的联系方式。
 * 理由会存进 revision 和 audit_log，展示给作者。
 */
adminRoute.post('/resources/:id/reject', requireRole(...REVIEWER), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const id = c.req.param('id');
  // 同上：要驳回的是 pending 条目，不能用会过滤状态的 getResource
  if (!resourceExists(id)) return c.json({ error: 'not_found' }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = RejectInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', reason_required: true }, 400);
  }

  const now = Date.now();
  const result = rejectRevision({
    resourceId: id,
    reviewerId: user.id,
    reason: parsed.data.reason,
    now,
  });
  if (!result) {
    return c.json({ error: 'nothing_pending' }, 409);
  }

  writeAudit({
    actorId: user.id,
    action: 'resource.reject',
    entityType: 'resource',
    entityId: id,
    reason: parsed.data.reason,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  return c.json({
    ok: true,
    id,
    revision: result.revision,
    status: result.resourceRejected ? 'rejected' : 'published',
    // 告诉前端"这个条目原本已发布，所以线上版本保留下来了" ——
    // 审核员据此知道自己的驳回没有把老条目从站上抹掉。
    liveVersionKept: !result.resourceRejected,
  });
});

// ---------------------------------------------------------------------------
// 审计
// ---------------------------------------------------------------------------

/**
 * 审计记录。**只读，没有删除接口** —— §3 的三条约束之三："留痕但不可撤销"。
 *
 * 不留删除接口是刻意的：一个可以被清理的审计日志，在被需要的那一刻
 * 往往恰好已经被清理过了（而且清理它的多半就是需要被审计的那个人）。
 */
adminRoute.get('/admin/audit', requireRole(...REVIEWER), (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 100) || 100, 500);
  const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0);

  c.header('Cache-Control', 'no-store');

  const rows = getDb()
    .prepare(
      `SELECT a.id, a.actor_id, a.action, a.entity_type, a.entity_id,
              a.reason, a.ip, a.created_at, u.display_name AS actor_name
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_id
       ORDER BY a.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as unknown as Array<{
    id: string;
    actor_id: string | null;
    action: string;
    entity_type: string;
    entity_id: string | null;
    reason: string | null;
    ip: string | null;
    created_at: number;
    actor_name: string | null;
  }>;

  const totalRow = getDb().prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number };

  return c.json({
    items: rows.map((r) => ({
      id: r.id,
      action: r.action,
      actorId: r.actor_id,
      actorName: r.actor_name,
      entityType: r.entity_type,
      entityId: r.entity_id,
      reason: r.reason,
      createdAt: r.created_at,
    })),
    total: Number(totalRow.n),
  });
});
