/**
 * 资源库的接口。
 *
 * M1 的部分（GET）**完全不需要登录** —— 这是访问模型（docs/v1-plan.md §0.1）的核心：
 * 浏览不设门槛，登录只在提交时才需要。所以读接口上没有任何鉴权中间件。
 *
 * M2 加进来的写接口（POST / PATCH）需要登录**且邮箱已验证**。
 * 注意"验证挡的是提交，不是登录"这个区别：邮件发不出去时，
 * 用户最坏是"能看不能发"，而不是被完全挡在门外。
 *
 * 审核类接口（approve / reject / queue）在 routes/admin.ts ——
 * 把需要更高权限的东西集中在一个文件里，安全审查时只需要看那一处。
 */
import { ResourceQuerySchema, ResourceSubmissionSchema } from '@mcsr/shared/resources';
import { Hono } from 'hono';

import { type AuthVariables, requireAuth, requireVerified } from '../auth/middleware';
import {
  findResourceByUrl,
  getResource,
  listResources,
  listTopTags,
  resourceExists,
  resourceOwner,
  uniqueResourceId,
} from '../resources';
import { reviseResource, submitNewResource } from '../revisions';
import { writeAudit } from '../users';

export const resourcesRoute = new Hono<{ Variables: AuthVariables }>();

/**
 * 公开内容的缓存策略。
 *
 * ⚠️ 每个响应都必须显式带上 Cache-Control。
 * 什么都不设的话浏览器会启用启发式缓存 —— 我们已经在静态资源上踩过一次，
 * 症状是"改了没反应"。这里给一个短的公开缓存：条目内容一天也不会变几次，
 * 而 60 秒的窗口足以吸收掉列表页的重复请求。
 *
 * `stale-while-revalidate` 让浏览器在后台刷新时先拿旧数据，用户感觉不到等待。
 */
const PUBLIC_CACHE = 'public, max-age=60, stale-while-revalidate=300';

/** 校验失败时把 Zod 的问题整理成人能读的形态，而不是把整个 error 对象吐出去。 */
function formatIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues.map((i) => ({
    field: i.path.map(String).join('.') || '(root)',
    message: i.message,
  }));
}

// ---------------------------------------------------------------------------
// 读（公开）
// ---------------------------------------------------------------------------

// ⚠️ `/tags` 必须注册在 `/:id` **之前**，否则 GET /tags 会被当成 id 为 "tags" 的条目。
resourcesRoute.get('/tags', (c) => {
  c.header('Cache-Control', PUBLIC_CACHE);
  return c.json({ tags: listTopTags() });
});

resourcesRoute.get('/', (c) => {
  const parsed = ResourceQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_query', issues: formatIssues(parsed.error) }, 400);
  }
  c.header('Cache-Control', PUBLIC_CACHE);
  return c.json(listResources(parsed.data));
});

resourcesRoute.get('/:id', (c) => {
  const resource = getResource(c.req.param('id'));
  if (!resource) {
    return c.json({ error: 'not_found' }, 404);
  }
  c.header('Cache-Control', PUBLIC_CACHE);
  return c.json(resource);
});

// ---------------------------------------------------------------------------
// 提交（需要登录 + 邮箱已验证）
// ---------------------------------------------------------------------------

/**
 * 提交新条目。
 *
 * ⚠️ 服务端**不接受** featured / official / status ——
 *    ResourceSubmissionSchema 里根本没有这三个字段。
 *    "收到了但忽略"是更差的做法：提交者会以为字段生效了，
 *    而读代码的人也会以为这里可以传。
 */
resourcesRoute.post('/', requireAuth, requireVerified, async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = ResourceSubmissionSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  }

  /*
   * URL 查重。
   *
   * 不做这一步的后果很具体：资源库是"每个站点一条"的目录。允许同一个 URL
   * 提交两次，列表里就会出现两条一模一样的条目，各有各的 id、各有各的详情页。
   * 与其让审核员去发现和清理，不如在入口挡住 —— 并且**告诉他为什么**，
   * 顺便把已有条目的 id 返回去，前端可以直接给一个"去看那一条"的链接。
   */
  const existing = findResourceByUrl(parsed.data.url);
  if (existing) {
    return c.json(
      { error: 'url_exists', existingId: existing.id, existingTitle: existing.title },
      409,
    );
  }

  const now = Date.now();
  const id = uniqueResourceId(parsed.data.url);
  const { revision } = submitNewResource({
    id,
    submission: parsed.data,
    authorId: user.id,
    now,
  });

  writeAudit({
    actorId: user.id,
    action: 'resource.submit',
    entityType: 'resource',
    entityId: id,
    reason: `revision ${String(revision)}`,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  return c.json({ ok: true, id, revision, status: 'pending', isEdit: false }, 201);
});

/**
 * 修改自己的条目 —— **验收标准里"线上仍是旧版"这条约束的入口**。
 *
 * 这个接口在服务端只做三件事：拍快照、指指针、记审计。
 * 它**没有任何一句会写到 resources 的内容字段** ——
 * 所以"改完之后线上还是旧版"不是靠某个 if 判断保护出来的，
 * 而是结构上不可能改坏。详见 revisions.ts 的 reviseResource。
 */
resourcesRoute.patch('/:id', requireAuth, requireVerified, async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const id = c.req.param('id');
  // ⚠️ resourceExists 而不是 getResource：作者要改的可能是自己那条
  //    **还没通过审核**（pending）或**被驳回**（rejected）的条目，
  //    而 getResource 只认 status='published'。用错的表现是所有编辑
  //    一律 404，看起来像 id 不对。
  if (!resourceExists(id)) return c.json({ error: 'not_found' }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = ResourceSubmissionSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  }

  /*
   * 作者身份校验。
   *
   * ⚠️ 关键在于用的是**严格相等**。resourceOwner 对"导入的条目"返回 null，
   *    而 `null !== user.id` 恒为真 —— 于是"谁都不能编辑导入的条目"
   *    这条规则不需要单独写一行代码来判断，它是比较运算符的自然结果。
   *    如果把 null 换成一个哨兵值（比如空字符串），就会出现
   *    "未登录/任何人可改导入条目"这种漏洞。
   */
  const ownerId = resourceOwner(id);
  if (ownerId === null || ownerId !== user.id) {
    return c.json({ error: 'forbidden', reason: 'not_author' }, 403);
  }

  const now = Date.now();
  const result = reviseResource({
    resourceId: id,
    submission: parsed.data,
    editorId: user.id,
    now,
  });

  // null = 已经有待审版本了（条目不存在的情况上面已经挡掉）
  if (!result) {
    return c.json({ error: 'already_pending' }, 409);
  }

  writeAudit({
    actorId: user.id,
    action: 'resource.revise',
    entityType: 'resource',
    entityId: id,
    reason: `revision ${String(result.revision)}`,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  return c.json({
    ok: true,
    id,
    revision: result.revision,
    status: 'pending',
    isEdit: true,
    // 显式告诉调用方"线上版本没变"。前端据此显示"修改已提交，线上仍是旧版"，
    // 而不是让用户以为改动已经生效了。
    liveRevisionUnchanged: true,
  });
});
