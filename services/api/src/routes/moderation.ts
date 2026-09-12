/**
 * 内容治理接口：**精选 / 官方 / 下架**。
 *
 * ---------------------------------------------------------------------------
 * 为什么不放在 routes/review.ts
 * ---------------------------------------------------------------------------
 * 审核回答的是"这一版能不能上线"，治理回答的是"已经在线的这一条要不要
 * 继续以这个姿态出现"。前者作用在**待审版本**上、走 pending 指针；
 * 后者直接作用在**线上那一行**上。两者的对象、时机、权限都不同 ——
 * 混在一个文件里，读的人会以为它们是一回事。
 *
 * ---------------------------------------------------------------------------
 * 为什么需要它（两件事以前根本没有出口）
 * ---------------------------------------------------------------------------
 *   · `featured` / `official`：schema 里写着"这是编辑决定"，但在此之前
 *     只有导入脚本能写 —— 也就是说没有任何一个真人能行使这个决定；
 *   · `hidden`：这个状态在 `CONTENT_STATUSES` 里存在，但没有任何接口
 *     能设置它。内容出问题（链接失效、站点跑路、内容不当）时，
 *     唯一的办法是直接改数据库。
 */
import { ResourceVisibilitySchema } from '@mcsr/shared/resources';
import { Hono } from 'hono';
import { z } from 'zod';
import { type AuthVariables, requireCapability } from '../auth/middleware';
import { resourceExists, setResourceFlags, setResourceVisibility } from '../resources';
import { writeAudit } from '../users';

export const moderationRoute = new Hono<{ Variables: AuthVariables }>();

const FlagsSchema = z.object({
  featured: z.boolean().optional(),
  official: z.boolean().optional(),
});

/**
 * 设置精选 / 官方。
 *
 * ⚠️ 两个字段都是**可选**的，但至少要给一个。全空的话是一次没有意义的调用 ——
 *    返回 400 而不是默默成功，否则调用方会以为自己的意图被接受了。
 */
moderationRoute.patch(
  '/admin/resources/:id/flags',
  requireCapability('resource.feature'),
  async (c) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'unauthorized' }, 401);

    const id = c.req.param('id');
    if (!resourceExists(id)) return c.json({ error: 'not_found' }, 404);

    const body = await c.req.json().catch(() => null);
    const parsed = FlagsSchema.safeParse(body ?? {});
    if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);

    const { featured, official } = parsed.data;
    if (featured === undefined && official === undefined) {
      return c.json({ error: 'invalid_input', reason: 'nothing_to_change' }, 400);
    }

    const now = Date.now();
    setResourceFlags(id, { featured, official }, now);

    writeAudit({
      actorId: user.id,
      action: 'resource.feature',
      entityType: 'resource',
      entityId: id,
      reason: [
        featured === undefined ? null : `featured=${String(featured)}`,
        official === undefined ? null : `official=${String(official)}`,
      ]
        .filter(Boolean)
        .join(' '),
      ip: c.req.header('x-real-ip') ?? null,
      now,
    });

    return c.json({ ok: true, id, featured: featured ?? null, official: official ?? null });
  },
);

/**
 * 下架 / 恢复。
 *
 * ⚠️ 只有**已经上架**的内容才能被下架。
 *    对一条还没通过审核的内容"下架"是没有意义的（它本来就不在站上），
 *    而且会让状态语义变得含糊：它到底是"被撤下来的"还是"从没上去过"？
 *    含糊的状态在几个月后一定会有人搞错。
 */
moderationRoute.patch(
  '/admin/resources/:id/visibility',
  requireCapability('resource.moderate'),
  async (c) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'unauthorized' }, 401);

    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    const parsed = ResourceVisibilitySchema.safeParse(body ?? {});
    if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);

    const published = parsed.data.published;
    const now = Date.now();

    const result = setResourceVisibility(id, published, now);
    if (!result.ok) return c.json({ error: 'invalid_state', reason: result.reason }, 409);

    writeAudit({
      actorId: user.id,
      action: published ? 'resource.restore' : 'resource.hide',
      entityType: 'resource',
      entityId: id,
      reason: published ? '恢复上架' : '下架',
      ip: c.req.header('x-real-ip') ?? null,
      now,
    });

    return c.json({ ok: true, id, status: result.status });
  },
);
