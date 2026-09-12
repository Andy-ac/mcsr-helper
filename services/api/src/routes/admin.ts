/**
 * 身份组与治理接口。
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

import type { UserRole } from '@mcsr/shared/permissions';
import {
  assignableRoles,
  capabilitiesByType,
  checkRoleChange,
  RoleChangeInputSchema,
} from '@mcsr/shared/permissions';
import { Hono } from 'hono';

import { type AuthVariables, requireCapability } from '../auth/middleware';
import { getDb } from '../db';
import {
  countAdmins,
  countOwners,
  findUserById,
  listUsers,
  setUserRole,
  writeAudit,
} from '../users';

export const adminRoute = new Hono<{ Variables: AuthVariables }>();

/**
 * 批准。
 *
 * 审批的是 **`pending_revision` 指向的那条快照**，不是 resources 行的内容。
 * 这个区别是有意义的：作者在"提交之后、审核之前"可以再改一次 resources 行吗？
 * 不能（PATCH 只写 revisions），所以审核员看到的内容和他批准的内容是同一份。
 * 这挡住了"先提交无害版本过审、再改成广告"这个经典攻击 —— §3 的设计约束之二。
 */

/**
 * 驳回。**必须给理由。**
 *
 * 没有理由的驳回等于让作者瞎猜该改什么，而这个系统里作者看不到审核员的联系方式。
 * 理由会存进 revision 和 audit_log，展示给作者。
 */

// ---------------------------------------------------------------------------
// 审计
// ---------------------------------------------------------------------------

/**
 * 审计记录。**只读，没有删除接口** —— §3 的三条约束之三："留痕但不可撤销"。
 *
 * 不留删除接口是刻意的：一个可以被清理的审计日志，在被需要的那一刻
 * 往往恰好已经被清理过了（而且清理它的多半就是需要被审计的那个人）。
 */
adminRoute.get('/admin/audit', requireCapability('audit.read'), (c) => {
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

// ---------------------------------------------------------------------------
// 身份组管理
//
// 这是"授权别人权限"的接口，也就是权限系统里权限最高的一个。
// 它自己的入口由 requireCapability('user.moderate') 把守，
// 而 user.moderate 只有 admin 有（见 permissions.ts 的矩阵）。
// ---------------------------------------------------------------------------

adminRoute.get('/admin/users', requireCapability('user.moderate'), (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 100) || 100, 500);
  const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0);
  // 用户列表含邮箱，绝不能进任何缓存
  c.header('Cache-Control', 'no-store');

  const { items, total } = listUsers(limit, offset);
  const me = c.get('user');

  return c.json({
    items: items.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.display_name,
      role: u.role,
      status: u.status,
      emailVerified: u.email_verified_at !== null,
      createdAt: u.created_at,
      /** 前端据此标出"这是我"；改自己也允许，但会被最后管理员保护挡住 */
      isSelf: u.id === me?.id,
    })),
    total,
    /** 界面上的角色选择器按权限从低到高排列，不是字母序 */
    roles: assignableRoles(),
  });
});

/**
 * 改别人的角色。
 *
 * ⚠️⚠️ 这里有一条**锁定保护**：不能把最后一个管理员降级。
 *
 * 没有这条保护的话，一个管理员手滑把自己降成普通用户之后，
 * 这个系统就**再也没有人能改角色了** —— 唯一的恢复手段是去服务器上
 * 直接改数据库（见 services/api/src/admin-cli.ts，那条路是刻意留着的后门）。
 * 这类"把自己锁在门外"的事故在所有权限系统里都会发生一次，
 * 而防住它只需要一个 COUNT。
 */
adminRoute.patch('/admin/users/:id/role', requireCapability('user.moderate'), async (c) => {
  const actor = c.get('user');
  if (!actor) return c.json({ error: 'unauthorized' }, 401);

  const targetId = c.req.param('id');
  const target = findUserById(targetId);
  if (!target) return c.json({ error: 'not_found' }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = RoleChangeInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', reason_required: true }, 400);
  }

  const nextRole = parsed.data.role;
  const now = Date.now();

  if (target.role === nextRole) {
    return c.json({ ok: true, id: targetId, role: nextRole, unchanged: true });
  }

  /*
   * ★ 等级规则（谁能把谁改成什么）**不在这里判**，在
   *    shared/permissions.ts 的 checkRoleChange 里 —— 界面用的是同一个函数。
   *
   * 这条规则很容易两边写岔：界面放行、服务端拒绝（用户白填一遍），
   * 或者更糟 —— 界面禁用了、服务端其实没拦（那就是一条越权通道）。
   * 所以规则只有一份，这里只负责把它翻译成 HTTP。
   */
  const judgement = checkRoleChange({
    actorRole: actor.role as UserRole,
    targetRole: target.role as UserRole,
    targetIsSelf: target.id === actor.id,
    nextRole,
  });

  if (!judgement.ok) {
    const status = judgement.reason === 'forbidden' ? 403 : 403;
    return c.json({ error: judgement.reason }, status);
  }

  /*
   * 锁定保护：**别把最后一个"能改角色的人"降级**。
   *
   * ⚠️ 判据是"管理员 + 所有者"的总数，不只是管理员 —— owner 也有
   *    user.moderate，所以有 owner 在的时候降掉最后一个管理员是安全的。
   *    第一版只数管理员，会让 owner 遇到"想降掉唯一的管理员却被拒"
   *    这种莫名其妙的阻挡。
   *
   * ⚠️ 加进 owner 之后，这个分支**在当前规则下够不到了**：
   *    只有 owner 能降级管理员，所以降级发生时系统里必定至少有一个 owner，
   *    而 owner 有 user.moderate —— "一个能管账号的人都不剩"永远不成立。
   *    留着它是**保险**：哪天放宽"谁能降管理员"，它会重新变成必要的。
   *    （对应的测试断言的是现实：owner 能降掉最后一个管理员，
   *      而且降完之后系统仍有人能管账号。）
   */
  if (target.role === 'admin' && nextRole !== 'admin') {
    const adminsAfter = countAdmins() - 1;
    if (adminsAfter + countOwners() === 0) {
      return c.json(
        { error: 'last_admin', message: '不能降级最后一个能管理账号的人，否则没人能再改角色了' },
        409,
      );
    }
  }

  setUserRole(targetId, nextRole, now);

  writeAudit({
    actorId: actor.id,
    action: 'user.role_change',
    entityType: 'user',
    entityId: targetId,
    reason: `${target.role} -> ${nextRole}｜${parsed.data.reason}`,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  return c.json({
    ok: true,
    id: targetId,
    role: nextRole,
    previousRole: target.role,
    /** 顺便告诉前端这个角色现在能做什么，免得界面再算一遍 */
    capabilities: capabilitiesByType(nextRole),
  });
});
