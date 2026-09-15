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
import type { Contributor, ContributorList } from '@mcsr/shared';
import { ContributorsInputSchema } from '@mcsr/shared';
import type { Actor, UserRole } from '@mcsr/shared/permissions';
import { checkPermission } from '@mcsr/shared/permissions';
import {
  ResourceQuerySchema,
  ResourceSubmissionSchema,
  ResourceVisibilitySchema,
} from '@mcsr/shared/resources';
import { Hono } from 'hono';

import { type AuthVariables, requireAuth, requireCapability } from '../auth/middleware';
import { isContributor, listContributors, setContributors } from '../contributors';
import {
  findResourceByUrl,
  getResource,
  getResourceAnyStatus,
  listResources,
  listTopTags,
  resourceExists,
  resourceOwner,
  resourcePendingRevision,
  setResourceVisibility,
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
 *   · ★ **这条内容的贡献者**（2026-09-14）—— 见下面那段「为什么贡献者也要能读」
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

  /*
   * ★ 这条内容是不是"我能直接改的那一条"（用户要求：贡献者不经过审核直编）。
   *
   * 一次查询，下面三处都用它：读权限、canDirectEdit、canHide。
   * ⚠️ 只查一次是刻意的 —— 同一个请求里查三遍既浪费，又给了"三处判据分头演化"
   *    的机会（这个文件里每个 `checkPermission` 都只调一次，是同一条规矩）。
   */
  const isContributorHere = isContributor('resource', id, user.id);

  /*
   * ★ 贡献者必须能打开编辑页 —— 否则下面那两个布尔量**永远送不到他手里**。
   *
   * ⚠️ 这一条是加这个功能时最容易漏的地方：编辑页走的正是这个接口
   *    （`apps/web/src/lib/api.ts` 的 `fetchResourceForEdit` → `GET …/edit`），
   *    而贡献者**通常既不是作者、也没有 `resource.editUnpublished`** ——
   *    照原样他会在这里拿到 404，界面于是退回公开读接口，`canDirectEdit`
   *    那一栏根本不存在。表现是"明明给了他权限，界面上却看不到直编按钮"。
   *
   * ⚠️ 放开的范围要精确：只有**这一条的**贡献者能读**这一条**。
   *    不存在的 id 仍然 404（`isContributor` 查的是 (实体, 人) 两段，
   *    而孤儿行按设计会被硬删除路径清掉，所以这里不会误放行）。
   */
  if (!isAuthor && !canEditAny && !isContributorHere) {
    return c.json({ error: 'not_found' }, 404);
  }

  const resource = getResourceAnyStatus(id);
  if (!resource) return c.json({ error: 'not_found' }, 404);

  /*
   * ⚠️ 把"现在有没有人在改"一起返回。
   *
   * 编辑页要靠它**在填表之前**告诉用户这件事 —— 否则他填完一整张表单，
   * 点提交时才拿到 409 already_pending，而那时他的工作已经白做了。
   */
  c.header('Cache-Control', 'no-store');
  return c.json({
    ...resource,
    pendingRevision: resourcePendingRevision(id),

    /*
     * ★ 下面两个布尔量是**服务端算好的**，前端只读不重算。
     *
     * -----------------------------------------------------------------------
     * 为什么必须由服务端给，而不是前端自己拼
     * -----------------------------------------------------------------------
     * 前端手上只有 `useCan('content.author')` 这一种判据（能力矩阵）。
     * 而**贡献者不是能力、是逐条内容的数据** —— `content.author` 对他永远为假
     * （见 shared/contributors.ts 的"不单独作为一个身份组"那一段）。
     * 让前端自己拼的话，它要么去读名单接口（多一次请求 + 它得知道"怎么算"),
     * 要么就只能靠 `useCan` —— 于是贡献者被引导去提"待审修改"，
     * 而他明明可以直接改（这正是用户要的那个功能，会表现为"没做"）。
     *
     * ⚠️⚠️ **两份判据必然漂移**：判据里有一半是数据（是不是这一条的贡献者），
     *     而数据只有服务端有。前端重算出来的那一份，最好的情况是每次多一次
     *     请求、最坏的情况是"界面不给按钮，接口其实是开着的"（或者反过来：
     *     界面给了按钮、点下去 403）。所以这里**算一次、随取数一起下发**，
     *     前端一个字都不重复判断 —— 这与能力矩阵"前后端读同一份定义"
     *     是同一条理由，只是这一半的真相住在库里。
     *
     * 名字与语义（**前端按这两个名字写契约，不要改名**）：
     *   · `canDirectEdit` —— 能走 `/api/authoring/resources/:id` 直编
     *     （**有 `content.author` 的** or **这一条的贡献者**）。
     *     ⚠️ 它**不回答**"能不能改"（作者提审也是改），只回答"能不能**直接**改"——
     *        界面上它决定的是「直接保存」那个按钮，不是整个表单。
     *   · `canHide` —— 能走 `PATCH /api/resources/:id/visibility`
     *     （**这一条的贡献者** or **有 `resource.moderate` 的**）。
     */
    canDirectEdit: checkPermission(actor, 'content.author').ok || isContributorHere,
    canHide: isContributorHere || checkPermission(actor, 'resource.moderate').ok,
  });
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
// 贡献者（**资源库这一版**；通用能力在数据层 contributors.ts）
// ---------------------------------------------------------------------------

/*
 * 用户原话：「对于资源库，在后台记录贡献者（不直接展示在资源库中），贡献者可以
 * 不经过审核直接修改/下架其拥有的资源（不实际删除），管理者可以在资源库中看到
 * 贡献者，并且能在每个资源里面随意修改（添加/删除）贡献者。资源可以没有贡献者。
 * 贡献者不单独作为一个身份组。这套逻辑之后在其他板块还要用到。」
 *
 * 这一节只放**资源库那一版**的三条路由。数据层（`contributors.ts`）是
 * `(entityType, entityId)` 通用的，加板块时复用的是它，不是这里的路径。
 *
 * ⚠️★ 「管理者」= **`user.moderate`**（admin / owner），**不是** `resource.moderate`。
 *
 *    这一处第一版写成了 `resource.moderate`，**是错的**，而且错得很像对的：
 *    `resource.moderate` 在矩阵里属于 `EDITOR_CAPS`（editor 及以上都能下架内容、
 *    也能看隐藏条目），而用户要的是"**只有管理员**能看和改这份名单 ——
 *    编辑看不到也改不了"。
 *    ⇒ 判据取 `user.moderate`：它在矩阵里正好是 `[...EDITOR_CAPS, 'user.moderate']`
 *      那两行（admin / owner）多出来的那一项，也就是本仓「管理」那个入口用的同一把钥匙
 *      （`Layout.tsx` 的账号管理入口就是它）。
 *
 *    ⚠️ 与下面那条 visibility 路由**刻意不同**：下架是**内容动作**（editor 本来就
 *       能干），改名单是**授权动作**（决定"谁能绕过审核"）。把两者用同一个能力，
 *       等于让所有编辑都能自己给自己发免审权限。
 *
 * ⚠️ 名单**不进公开读路径**（用户要求"不直接展示在资源库中"）：
 *    `GET /api/resources` 与 `GET /api/resources/:id` 的响应里一个字都没有它，
 *    只有 `requireCapability('user.moderate')` 的这一个接口能给。
 *    有一条测试专门断言那两条公开响应里**没有**贡献者字段。
 */

/**
 * 读一条内容的贡献者名单。**管理界面用的**，所以要求 `user.moderate`（admin / owner）。
 *
 * ⚠️ 用 `resourceExists`（不过滤发布状态）而不是 `getResource`：
 *    下架的内容同样有名单，而管理者要能看见并改它 —— 用 `getResource`
 *    会让已下架条目的名单一律 404，看起来像"这条没有贡献者"。
 */
resourcesRoute.get('/:id/contributors', requireCapability('user.moderate'), (c) => {
  const id = c.req.param('id');
  if (!resourceExists(id)) return c.json({ error: 'not_found' }, 404);

  const items = listContributors('resource', id);
  /*
   * ⚠️ `no-store`：名单是**管理数据**，而且刚刚可能被另一个人改过
   *    （整份替换是"后写的赢"）。缓存住的话，管理者看到的是上一份名单，
   *    而他一旦保存，就会把别人的改动**静默覆盖**回去 ——
   *    与 shared 里 ContributorsInputSchema 那段注释说的是同一件事。
   */
  c.header('Cache-Control', 'no-store');
  return c.json({ items, total: items.length } satisfies ContributorList);
});

/**
 * 整份替换一条内容的贡献者名单（**不是**加一个/删一个，理由见 shared）。
 *
 * 响应形状（前端按这个写）：`{ ok, id, items, total, added, removed }`。
 * ⚠️ `added` / `removed` 是**数字**（实际增删了几个人），不是名单 ——
 *    名单在 `items` 里，那两个数字回答的是"我刚才那一下动了什么"，
 *    界面上对应"已保存（新增 2 人、移除 1 人）"。
 *
 * 失败分支与 HTTP 码的对应（数据层 `SetContributorsFailure` 的注释里有完整的理由）：
 *   · 资源不存在              → **404** `not_found`
 *   · 名单里有不存在的用户    → **400** `invalid_input`（`issues[0].field = 'userIds'`）
 *   · 去重后仍超过人数上限    → **400** `invalid_input`（同上；schema 先挡一道）
 */
resourcesRoute.put('/:id/contributors', requireCapability('user.moderate'), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const id = c.req.param('id');
  /*
   * ⚠️ **先判"这条在不在"，再判"请求本身合不合法"** —— 与
   *    `/api/authoring/*` 那两条改已有条目的路由**同形**（那边有一段注释专门
   *    说明这个顺序：两处形状必须一样，否则前端同一段代码要在两种情况下
   *    按不同顺序处理错误）。所以"资源不存在 + body 也不合法"时，这里是 404。
   */
  if (!resourceExists(id)) return c.json({ error: 'not_found' }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = ContributorsInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  }

  const now = Date.now();
  const result = setContributors({
    entityType: 'resource',
    entityId: id,
    userIds: parsed.data.userIds,
    actorId: user.id,
    now,
    /*
     * ⚠️ 存在性**再判一次**，而且是在数据层的事务里判的。
     *    上面那次判完之后，读 body 那一步是 `await` —— 中间别的请求完全可能
     *    把这条资源删掉，于是这次写入会留下一批**指向已删内容的孤儿行**
     *    （它们不报错、只会在名单上安静地误导人）。
     *    那次检查因此不是重复劳动：它关的是 TOCTOU 那个窗口。
     */
    exists: () => resourceExists(id),
  });

  if (!result.ok) {
    if (result.reason === 'not_found') return c.json({ error: 'not_found' }, 404);
    if (result.reason === 'unknown_user') {
      /*
       * ⚠️ 400 而不是静默跳过：名单里有一个不存在的 id 时，静默跳过会写下一份
       *    **与请求不符**的名单，而管理者以为自己加的那个人已经加上了。
       *    存下来更糟 —— 那一行**永远匹配不上任何人**（那个 id 根本不存在），
       *    表现是"我明明加了他，他却没有权限"，没有任何报错。
       */
      return c.json(
        {
          error: 'invalid_input',
          issues: [
            {
              field: 'userIds',
              message: `这些用户不存在：${result.userIds.join('、')}`,
            },
          ],
        },
        400,
      );
    }
    // 与 schema 同一个错误码：两者说的都是"这个请求的入参有问题"，
    // 只是这一道拦的是**绕过 schema 的调用方**（别的板块/脚本直接调数据层）
    return c.json(
      {
        error: 'invalid_input',
        issues: [
          {
            field: 'userIds',
            message: `一条内容最多 ${String(result.max)} 个贡献者`,
          },
        ],
      },
      400,
    );
  }

  writeAudit({
    actorId: user.id,
    action: 'resource.contributors',
    entityType: 'resource',
    entityId: id,
    /*
     * ⚠️ reason 里必须能看出**加了谁、删了谁**。
     *    名单本身是可查的（`GET …/contributors`），但那查到的只有"现在是谁"——
     *    而事后最想知道的是"这一次**改动了什么**"，尤其"谁被移除了"，
     *    因为那个人从此改不动这条内容了，而名单上根本看不出他曾经在过。
     *    显示名后面带上 id：显示名会重名、也可以改，id 不会。
     */
    reason: describeContributorChange(result.added, result.removed, result.items.length),
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  c.header('Cache-Control', 'no-store');
  return c.json({
    ok: true,
    id,
    items: result.items,
    total: result.items.length,
    added: result.added.length,
    removed: result.removed.length,
  });
});

/**
 * 下架 / 恢复 —— **贡献者也能做**（用户原话：「贡献者可以不经过审核直接修改/下架
 * 其拥有的资源（不实际删除）」；恢复同样可逆，所以两个方向一起给）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 这条与 `PATCH /api/admin/resources/:id/visibility` 是**两条路由、一个数据层函数**
 * ---------------------------------------------------------------------------
 * 它们都调 `setResourceVisibility(id, published, now)`（同一条状态机：只有已上架的
 * 才能下架、下架可恢复、有待审版本时恢复到 pending）。**判据不同是它们唯一的区别**：
 *
 *   · `PATCH /api/admin/resources/:id/visibility` —— 只有 `resource.moderate`
 *     （治理界面在用，**保留不动**）；
 *   · `PATCH /api/resources/:id/visibility`（本条）—— **这一条的贡献者**
 *     **或** `resource.moderate`。
 *
 * ⚠️ 概念上的重复是**刻意的**，不是忘了合并：两条路的调用者是两个受众
 *    （治理界面的管理员 vs 在资源详情页上操作那条内容的贡献者），
 *    而"贡献者能下架"不该被实现成"给贡献者 `resource.moderate`"——
 *    那是**逐条**的授权，不是全站的下架权（用户明确要求"贡献者不单独作为一个身份组"）。
 *    所以判据必须在路由层分开，而**状态机只有一份** —— 重写一份的话，
 *    "只有已上架的能下架""下架可恢复"这些规则就会出现两种版本。
 *
 * ⚠️ 错误形状与 admin 那条**逐字一致**（409 `invalid_state` + 数据层的 reason）：
 *    两条路只在"谁能调"上有差别，那么在"调了之后会发生什么"上不该有任何差别，
 *    否则前端要为同一种结果写两套解析。
 *
 * ⚠️ 审计动作沿用既有的 `resource.hide` / `resource.restore`（**同名同义**）：
 *    换一个名字会让"这条内容被下架过几次、都是谁干的"在审计里分裂成两串。
 *    reason 里额外写明这次是"贡献者自己"还是"治理者"，因为那是事后唯一能分辨的地方。
 */
resourcesRoute.patch('/:id/visibility', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const id = c.req.param('id');
  const actor: Actor = {
    role: user.role as UserRole,
    emailVerified: user.email_verified_at !== null,
  };
  const isContributorHere = isContributor('resource', id, user.id);
  const isModerator = checkPermission(actor, 'resource.moderate').ok;

  if (!isContributorHere && !isModerator) return c.json({ error: 'forbidden' }, 403);

  /*
   * ⚠️★ 这里原来还有一段"贡献者那条路**要求邮箱已验证**"，**已删**（2026-09-14 同日）。
   *
   *   它当时的理由是"贡献者的权力来自**用户**把这条内容交给他，不是来自管理员
   *   的任命" —— 而改名单的判据最终定成 `user.moderate`（admin / owner），
   *   也就是**只有管理员能任命贡献者**，那个前提不成立了。
   *   ⇒ 现在贡献者与 `content.author` 同形（都是管理员任命的），
   *     适用同一条理由："再加一道验证不增加任何保证，却会在换邮箱、
   *     邮件投递出问题时把一个能干活的人挡在门外。"
   *
   *   ⚠️ 与直编那条路**必须同时删**：它们是同一个人的两个动作，
   *      留下一个查、一个不查，会出现"能改但不能下架"这种没人解释得清的组合。
   *   ⚠️ `isModerator` 那一支本来就不需要这段（治理类不要求验证），
   *      所以整段删掉之后两条路的门槛才真正一致。
   */

  const body = await c.req.json().catch(() => null);
  const parsed = ResourceVisibilitySchema.safeParse(body ?? {});
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);

  const published = parsed.data.published;
  const now = Date.now();
  const result = setResourceVisibility(id, published, now);
  // ⚠️ 与 admin 那条同形：`not_found` 也走 409 + reason（数据层给的 reason 就是它）
  if (!result.ok) return c.json({ error: 'invalid_state', reason: result.reason }, 409);

  writeAudit({
    actorId: user.id,
    action: published ? 'resource.restore' : 'resource.hide',
    entityType: 'resource',
    entityId: id,
    reason: `${published ? '恢复上架' : '下架'}（${isModerator ? '治理者' : '贡献者自己'}）`,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  return c.json({ ok: true, id, status: result.status });
});

/**
 * 审计 reason 的拼法：`贡献者名单更新（共 3 人）：加 A(id)、B(id)；删 C(id)`。
 *
 * ⚠️ 抽成函数不是为了复用（只有一处调用），是为了**能被测试按形状断言**：
 *    "加了谁、删了谁"这句话的格式一旦变了，审计里那条历史就再也对不上。
 * ⚠️ 显示名后面**必须带 id**：显示名会重名、也会被本人改掉，
 *    而"当时到底加的是哪一个人"只有 id 能回答。
 */
function describeContributorChange(
  added: Contributor[],
  removed: Contributor[],
  total: number,
): string {
  const label = (person: Contributor): string =>
    person.displayName ? `${person.displayName}(${person.userId})` : person.userId;

  const parts: string[] = [];
  if (added.length > 0) parts.push(`加 ${added.map(label).join('、')}`);
  if (removed.length > 0) parts.push(`删 ${removed.map(label).join('、')}`);
  /*
   * ⚠️ 名单没变时也要写一条审计（而不是"没变就不写"）：整份替换是幂等的，
   *    "他点了一次保存、结果什么都没变"与"他根本没点"是两件不同的事，
   *    而后者在按 id 保存时（前端说的完整的名单）**必然**会重复出现 ——
   *    如果只在有变化时写，审计里就分不出"没人在动它"和"有人在反复保存"。
   */
  if (parts.length === 0) return `贡献者名单未变（共 ${String(total)} 人）`;
  return `贡献者名单更新（共 ${String(total)} 人）：${parts.join('；')}`;
}

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

  /*
   * ⚠️ `liveRevisionUnchanged: true` —— 提审**新建**也必须显式给（spec §3.2b）。
   *    "线上没有这一条" ⇒ "线上那一版一个字都没变"成立，所以是 `true` 而不是 `false`。
   *    漏写它不会有编译错误（响应是内联字面量，而前端的类型是自己手写的），
   *    所以有一条测试专门守这个字段的**存在性**。
   */
  return c.json(
    { ok: true, id, revision, status: 'pending', isEdit: false, liveRevisionUnchanged: true },
    201,
  );
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
