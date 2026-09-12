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
import type { Actor, UserRole } from '@mcsr/shared/permissions';
import { checkPermission } from '@mcsr/shared/permissions';
import { ResourceQuerySchema, ResourceSubmissionSchema } from '@mcsr/shared/resources';
import { Hono } from 'hono';

import { type AuthVariables, requireAuth, requireCapability } from '../auth/middleware';
import {
  findResourceByUrl,
  getResource,
  getResourceAnyStatus,
  listResources,
  listTopTags,
  resourceExists,
  resourceOwner,
  resourcePendingRevision,
  uniqueResourceId,
} from '../resources';
import { listByAuthor, reviseResource, submitNewResource } from '../revisions';
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

  /*
   * 有下架权的人在列表里**也要看到已下架的内容**（否则下架之后就找不回来，
   * 那不是下架，是一条单向的路）。
   *
   * ⚠️ 能力判断在**这里**，不在数据层 —— loadUser 已经把用户放好了，
   *    而 listResources 是纯查询。同时把 includeHidden 当成"客户端说了算"
   *    是错的：那个参数只是"我想看"，能不能给由能力决定。
   */
  const user = c.get('user');
  const actor: Actor | null = user
    ? { role: user.role as UserRole, emailVerified: user.email_verified_at !== null }
    : null;
  const includeHidden =
    c.req.query('includeHidden') === '1' && checkPermission(actor, 'resource.moderate').ok;

  c.header('Cache-Control', PUBLIC_CACHE);
  return c.json(listResources(parsed.data, { includeHidden }));
});

/**
 * 我的提交（含待审和被驳回的）。
 *
 * ⚠️ 两条硬性约束：
 *
 *   1. **必须注册在 `/:id` 之前**。Hono 按注册顺序匹配，`/:id` 会把 "mine"
 *      当成一个条目 id 吃掉，于是这个接口永远返回 404 —— 而且看起来像是
 *      "没有提交过"，很难往路由顺序上想。
 *
 *   2. **不能被缓存**。它因人而异，缓存住的话下一个用户会看到别人的提交。
 *      公开接口那套 `PUBLIC_CACHE` 在这里是错的。
 *
 * 权限只要求"登录"（requireAuth），不要求 resource.submit：
 * 提交权被收回的人**仍然应该看得到自己交过的东西**（以及被驳回的理由）。
 * 而且这个接口只会返回 author_id = 自己的行。
 */
resourcesRoute.get('/mine', requireAuth, (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const items = listByAuthor(user.id).map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    pendingRevision: row.pending_revision,
    currentRevision: row.current_revision,
    updatedAt: row.updated_at,
    lastRejectReason: row.last_reject_reason,
    reviewedAt: row.reviewed_at,
  }));

  c.header('Cache-Control', 'no-store');
  return c.json({ items });
});

/**
 * 读一条条目**用来编辑**的完整内容，含还没上架 / 被驳回的。
 *
 * 为什么需要它：编辑页要预填表单，而公开的 `GET /:id` 只返回已发布的内容。
 * 一个被驳回、从未上架过的条目，作者在公开接口上永远拿不到它的正文 ——
 * 于是他"想改一下重新提交"却连原来的内容都看不见。
 *
 * 谁能读：
 *   · **作者本人**（任何状态）
 *   · 拥有 `resource.editUnpublished` 的人（editor / admin）——
 *     他们能改任何条目，那就必须能看见要改的东西
 *   · 其它人一律 404
 *
 * ⚠️ 路径原来叫 `/mine/:id`，改成 `/:id/edit` 是因为"mine"在 editor
 *    也能读之后就是句假话了。接口名骗人的代价是下一个人会照着它写错代码。
 *
 * ⚠️ 拒绝时**不存在和没权限返回同一个 404** —— 分开会变成一个探测接口：
 *    遍历 id 就能问出"哪些条目存在、都是谁的"。
 */
resourcesRoute.get('/:id/edit', requireAuth, (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const id = c.req.param('id');
  const actor: Actor = {
    role: user.role as UserRole,
    emailVerified: user.email_verified_at !== null,
  };
  const canEditAny = checkPermission(actor, 'resource.editUnpublished').ok;

  // 作者校验用**严格相等**：导入的条目 author_id 是 NULL，
  // `null === user.id` 恒为假，所以只有 editUnpublished 能碰到它们。
  const isAuthor = resourceOwner(id) === user.id;
  if (!isAuthor && !canEditAny) return c.json({ error: 'not_found' }, 404);

  const resource = getResourceAnyStatus(id);
  if (!resource) return c.json({ error: 'not_found' }, 404);

  /*
   * ⚠️ 把"现在有没有人在改"一起返回。
   *
   * 编辑页要靠它**在填表之前**告诉用户这件事 —— 否则他填完一整张表单，
   * 点提交时才拿到 409 already_pending，而那时他的工作已经白做了。
   */
  c.header('Cache-Control', 'no-store');
  return c.json({ ...resource, pendingRevision: resourcePendingRevision(id) });
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
resourcesRoute.post('/', requireCapability('resource.submit'), async (c) => {
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
   * 与其让审核员去发现和清理，不如在入口挡住。
   *
   * ---------------------------------------------------------------------
   * ⚠️ 但"挡住"要挡得**准确**：三种情况的下一步完全不同
   * ---------------------------------------------------------------------
   *   1. 已上架的条目      → "已经收录过了"，给链接去看那一条
   *   2. 自己那条没上架的  → "你之前提交过这个链接，去改那一条重新提交"
   *                          （**不是**"已收录" —— 它根本没上线）
   *   3. 别人那条没上架的  → 不能让提交者看到别人未上架的内容，给一句中性说明
   *
   * 第一版只回了一句 `url_exists`，而前端连这个名字都没认（认的是
   * `duplicate_url`）—— 于是三种情况在界面上统统显示成
   * 「出错了，请稍后再试。」，而用户唯一能做的只有再点一次提交。
   *
   * 所以这里把"属于哪一种"直接算好一起返回：前端**不需要**自己有判断逻辑，
   * 也就不会出现第二份会漂移的规则。
   */
  const existing = findResourceByUrl(parsed.data.url);
  if (existing) {
    return c.json(
      {
        error: 'url_exists',
        existingId: existing.id,
        existingTitle: existing.title,
        existingStatus: existing.status,
        existingMine: resourceOwner(existing.id) === user.id,
      },
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
 * 修改条目 —— **验收标准里"线上仍是旧版"这条约束的入口**。
 *
 * 这个接口在服务端只做三件事：拍快照、指指针、记审计。
 * 它**没有任何一句会写到 resources 的内容字段** ——
 * 所以"改完之后线上还是旧版"不是靠某个 if 判断保护出来的，
 * 而是结构上不可能改坏。详见 revisions.ts 的 reviseResource。
 *
 * ---------------------------------------------------------------------------
 * 两种"可以改"（2026-09-12 的改动）
 * ---------------------------------------------------------------------------
 *   1. 作者改自己的条目 → `resource.editOwn`
 *   2. 任何已登录用户改**已上架**的条目 → `resource.editAny`（社区 wiki 式）
 *
 * 保留两个能力而不是合成一个，是为了留一个能单独收回的开关：
 * 想关掉 wiki 行为时，把 editAny 从 user 的能力里去掉即可，
 * 作者的 editOwn 不受影响。
 *
 * ⚠️ 第 2 条**只对已上架的条目开放**。
 *    未上架（待审、被驳回、导入未发布）的条目内容只有作者能看到，
 *    让别人改等于把别人没打算公开的草稿泄漏给任何登录用户 ——
 *    而且他改的还是一份自己看不到内容的东西。
 */
resourcesRoute.patch(
  '/:id',
  async (c, next) => {
    /*
     * 权限判定分两段，所以不能直接用 requireCapability。
     *
     * 先判"有没有编辑能力"，再判"这条归不归你" —— 后者要看具体的条目，
     * 而 requireCapability 是路由级的中间件，拿不到那个上下文。
     *
     * 未登录/未验证邮箱的拒绝理由仍然由 checkPermission 给出，
     * 和服务端其它地方是同一份规则（unauthenticated / forbidden /
     * email_not_verified 三种，界面据此给不同的下一步）。
     */
    const user = c.get('user');
    const actor: Actor | null = user
      ? { role: user.role as UserRole, emailVerified: user.email_verified_at !== null }
      : null;

    const own = checkPermission(actor, 'resource.editOwn');
    const any = checkPermission(actor, 'resource.editAny');

    if (!own.ok && !any.ok) {
      // 两者都没过时，优先报告 reason 更"靠前"的那个：
      // 未登录 → 去登录；邮箱未验证 → 去验证；否则才是真的没权限。
      const reason = !own.reason || own.reason === 'unauthenticated' ? own.reason : any.reason;
      if (reason === 'unauthenticated') return c.json({ error: 'unauthorized' }, 401);
      return c.json({ error: reason }, 403);
    }

    return next();
  },
  async (c) => {
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
     * 是作者，还是"社区编辑者"？
     *
     * ⚠️ 身份判定用的是**严格相等**。resourceOwner 对"导入的条目"返回 null，
     *    而 `null !== user.id` 恒为真 —— 所以导入的条目天然不属于任何人。
     *    这正是 wiki 式编辑存在的理由：那 9 条从 JSON 导进来的条目，
     *    如果只有作者能改，就等于谁都不能改。
     */
    const ownerId = resourceOwner(id);
    const isAuthor = ownerId !== null && ownerId === user.id;

    if (!isAuthor) {
      /*
       * 非作者：默认只能改**已上架**的内容。
       *
       * ⚠️ 但内容编辑（editor）能改别人的**草稿** —— 那是
       *    `resource.editUnpublished`。它为什么要单独一个能力：
       *    未上架的内容是"作者还没打算公开的东西"，对编辑者开放是合理的
       *    （他能帮作者改好），但绝不该是所有登录用户的默认能力。
       */
      const actor: Actor = {
        role: user.role as UserRole,
        emailVerified: user.email_verified_at !== null,
      };
      const canEditUnpublished = checkPermission(actor, 'resource.editUnpublished').ok;

      const published = getResource(id) !== null;
      if (!published && !canEditUnpublished) {
        return c.json({ error: 'forbidden', reason: 'not_published' }, 403);
      }
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

    /*
     * 审计：作者改自己的和别人改别人的**记成两个不同的动作**。
     * 合起来的话，"这条标题什么时候变的、是谁变的"在审计里就查不出来了 ——
     * 而这恰恰是 wiki 式编辑最需要能回答的问题。
     */
    writeAudit({
      actorId: user.id,
      action: isAuthor ? 'resource.revise' : 'resource.reviseOther',
      entityType: 'resource',
      entityId: id,
      reason: `revision ${String(result.revision)}${isAuthor ? '' : ` (owner ${ownerId ?? 'imported'})`}`,
      ip: c.req.header('x-real-ip') ?? null,
      now,
    });

    return c.json({
      ok: true,
      id,
      revision: result.revision,
      status: 'pending',
      isEdit: true,
      isAuthor,
      // 显式告诉调用方"线上版本没变"。前端据此显示"修改已提交，线上仍是旧版"，
      // 而不是让用户以为改动已经生效了。
      liveRevisionUnchanged: true,
    });
  },
);
