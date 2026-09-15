/**
 * 实时分享（live shares）的接口 —— spec §5 的四个端点。
 *
 *   GET    /api/shares/:kind         看板（含"我的那几条"）—— 登录
 *   GET    /api/shares/summary       介绍页要的计数      —— 登录
 *   POST   /api/shares/:kind         发一条              —— 登录 + **邮箱已验证**
 *   PATCH  /api/shares/:id/visibility 下架 / 恢复
 *   DELETE /api/shares/:id           彻底删除            —— 登录 + **只有作者** + 已下架
 *
 * ===========================================================================
 * ★ 权限的形状：**五种**，不是一种
 * ===========================================================================
 * 这是本仓第一条"游客看不到"的线（spec §1.1），所以读接口也不能放开：
 *
 *   · 看板与摘要：`requireAuth`。游客回 **401，不是空列表** —— 空列表会让游客
 *     以为"这里现在没人分享"，那是**另一件**事，而它对游客与登录用户长得一样。
 *   · 发布：`requireAuth` + **现成的 `requireVerified`**。不要在这里手写那段判断，
 *     也不要为了"复用 `REQUIRES_VERIFIED`"而新加一个人人皆有的能力（`share.submit`）：
 *     本仓的能力矩阵回答的是"**谁能做什么**"，而"发一条分享"不区分角色 ——
 *     §6.1 有整段理由，那是这次刻意否决的一个替代方案。
 *   · 下架：作者本人 **或** `share.moderate`（内容治理，不是账号治理；editor 及以上）。
 *   · 恢复：**只有作者本人**。管理员恢复别人的一律 403 —— 管理动作是单向的，
 *     §4.2 与裁决 11 把这一条定死了（理由见下面那个分支上的注释）。
 *   · 彻底删除：**只有作者本人**（2026-09-16 新增）。与恢复同一条理由，而且更强：
 *     删除**不可逆**，管理员手上的下架已经足够让内容从看板上消失。
 *     ⚠️ 判据同样在**数据层**再比对一遍 `user_id`（`deleteShare`）——
 *       权限结论不该只存在于路由里。
 *
 * ===========================================================================
 * ⚠️★ 注册顺序是**行为**，不是风格：`/summary` 必须在 `/:kind` 之前
 * ===========================================================================
 * Hono 按**注册顺序**匹配。反过来写的话 `/api/shares/summary` 会落进
 * `:kind='summary'` —— 解析不出 kind，回 400 —— 于是介绍页永远拿不到条数。
 * 这种错在路由文件里**读不出来**（两条路由各自都是对的），所以有一条测试专门钉它
 * （`live-shares.test.ts` 的「`/summary` 不会被 `/:kind` 抢走」）。
 * 同一个坑在本仓已经出现过两次：`routes/resources.ts` 的 `/tags`、`routes/live.ts`
 * 的 `/live/mine`。
 *
 * ===========================================================================
 * ★ `at_limit` 是一个**独立的拒绝码**
 * ===========================================================================
 * spec §4.2 那两行与 §13 的拒绝码表把它与 `invalid_state` 分开列，理由不是洁癖：
 * 前端的恢复按钮只认 `error === 'at_limit'`，而且它有一句专门的话
 * （「你已经在展示另一条了，先把它下架，再恢复这条」）。把 `at_limit` 塞进
 * `invalid_state` 的 `reason` 里，那句话就永远到不了用户手里 —— 他看到的会是一句
 * 笼统的"操作失败了"。⇒ PATCH 的两个分支**都要**先判 `at_limit`、再让别的 reasons
 * 走 `invalid_state`（下架那条今天走不到它，但两个分支的形状必须一样：不一样的话，
 * 下一个人读两处会以为差异是有意的）。
 *
 * ⚠️ 数据层不解析请求、不判权限（恢复那条"只有本人"是它唯一的例外，§6.1 明文要求
 * 它在数据层比对一遍）—— 这个文件只做"HTTP 面"：状态码、拒绝码的形状、审计。
 */
import type { ShareKind, ShareListResponse, ShareSummary } from '@mcsr/shared';
import { durationToMs, parseSharePost, SHARE_KINDS, ShareVisibilitySchema } from '@mcsr/shared';
import type { UserRole } from '@mcsr/shared/permissions';
import { checkPermission } from '@mcsr/shared/permissions';
import { Hono } from 'hono';
import { type AuthVariables, requireAuth, requireVerified } from '../auth/middleware';
import {
  buildItem,
  buildListResponse,
  createShare,
  deleteShare,
  getShareForEdit,
  isRenderableShareRow,
  setShareHidden,
  setShareVisible,
  summarize,
} from '../live-shares';
import { writeAudit } from '../users';

export const sharesRoute = new Hono<{ Variables: AuthVariables }>();

/**
 * 校验失败时把 Zod 的问题整理成人能读的形态，而不是把整个 error 对象吐出去。
 *
 * ⚠️ 这一份是从别的路由文件里**抄来的**第 6 份（`auth.ts` / `authoring.ts` /
 *    `calendar.ts` / `live.ts` / `resources.ts` 里各有一份）：它只有 8 行，
 *    抽成一个公共模块会让那 5 个文件都多一条 import —— 那是一次跨模块的重构，
 *    不属于这个功能。形状（`{field, message}`）是全站统一的，别在这里改。
 */
function formatIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues.map((i) => ({
    field: i.path.map(String).join('.') || '(root)',
    message: i.message,
  }));
}

/**
 * 路径里的 kind —— **唯一**一处把字符串变成 `ShareKind` 的地方。
 *
 * ⚠️ `/summary` 与 `/:kind` 若各写一处 `kind === 'room' ? … : …`，加第三个 kind
 *    时只会改到其中一处，而另一处会把新 kind 静默地当成 `seed`（显式回 null
 *    至少会让它 400，而不是"悄悄地给错的那一份数据"）。
 */
function parseKind(raw: string): ShareKind | null {
  return SHARE_KINDS.find((kind) => kind === raw) ?? null;
}

// ---------------------------------------------------------------------------
// 读
// ---------------------------------------------------------------------------

/* ⚠️★ 这一条**必须**在 `/:kind` 之前注册 —— 见文件头。 */
sharesRoute.get('/summary', requireAuth, (c) => {
  const now = Date.now();
  c.header('Cache-Control', 'no-store');
  /*
   * ⚠️ `summarize` 只回计数（**全站**在展示的条数 + 两种额度），`serverNow` 由这里补，
   *    而且用的是**同一个** `now`：时间只有一个来源。`satisfies ShareSummary` 不是装饰
   *    —— 忘了补 `serverNow` 或补错了地方，这里当场编译不过。
   */
  return c.json({ ...summarize(now), serverNow: now } satisfies ShareSummary);
});

sharesRoute.get('/:kind', requireAuth, (c) => {
  const kind = parseKind(c.req.param('kind'));
  // 不认识的段落（包括"路由顺序写反了的 /summary"）都在这里被挡下
  if (!kind) return c.json({ error: 'invalid_input' }, 400);

  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const now = Date.now();
  /*
   * ⚠️ 这是"只给登录用户的管理态数据 + 20 秒一变"（§7.6 的自动刷新），进任何缓存都是错的。
   *    index.ts 那条全局中间件也设了 no-store，这里**再写一遍**是因为这条性质不该
   *    依赖"某个中间件恰好排在前面"—— 哪天有人为别的端点放开一条缓存规则，这一条要能自己站住。
   */
  c.header('Cache-Control', 'no-store');
  /*
   * ⚠️★ 只调**一次** `buildListResponse`：`serverNow` 与 `liveCount` 必须是同一个时刻
   *    算出来的。分两处取时间的话两者之间隔着几毫秒，而前端正是拿 `serverNow` 去算
   *    "还剩几分钟"的（§5.1）—— 那一缝里正好可能跨过某一行的 `expires_at`。
   */
  return c.json(buildListResponse(kind, user.id, now) satisfies ShareListResponse);
});

// ---------------------------------------------------------------------------
// 发布
// ---------------------------------------------------------------------------

sharesRoute.post('/:kind', requireAuth, requireVerified, async (c) => {
  /*
   * ⚠️ `requireVerified` 是**现成的**（auth/middleware.ts）：它返回的正是 §5.3 要的
   *    那一对（未登录 401 / 已登录但没验证 403 `email_not_verified`）。
   *    手写一遍这段判断的话，两个码迟早会漂移，而前端正是靠它们区分
   *    "去登录"与"去验证邮箱"的。
   */
  const kind = parseKind(c.req.param('kind'));
  if (!kind) return c.json({ error: 'invalid_input' }, 400);

  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json().catch(() => null);
  /*
   * ⚠️ body **按 kind 分叉**（两种形状零重叠），而校验只有一处实现（shared 的
   *    `parseSharePost`）—— 路由层不再自己核对任何一格。它跑两遍 schema（外层管
   *    "请求合不合法"、内层管"要存进库的那个对象长什么样"），那两遍是幂等的，
   *    理由写在 `parseSharePost` 的注释里。
   */
  const parsed = parseSharePost(kind, body);
  if (!parsed.ok) {
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  }

  // ⚠️ 服务端取时间，只取一次：`created_at` 与 `expires_at` 都由它算（§5.3
  //    不接受客户端传时间 —— 那等于让人自己决定什么时候过期）
  const now = Date.now();
  const result = createShare({
    kind,
    userId: user.id,
    payload: parsed.payload,
    note: parsed.note,
    // ⚠️ 单位在这里、也只在这里换算成毫秒（shared 的 `durationToMs`）——
    //    数据层不需要知道"房间按分钟、种子按天"（`createShare` 的注释）。
    durationMs: durationToMs(parsed.duration),
    now,
  });

  if (!result.ok) {
    /*
     * seed 的额度用尽（room 走的是索引与替换，不走这里）。
     * ⚠️ 与恢复那条路上的 `at_limit` 是**同一个码**，但这一档多带一个 `limit`：
     *    前端那一句"已经 20 条了"要用它（§5.3）。
     */
    return c.json({ error: 'at_limit', limit: result.limit }, 409);
  }

  /*
   * 审计（§6.3）：reason 里必须能读出 kind 与展示时长，room 还要写明替换掉几条。
   * ⚠️ 「替换掉 N 条」**只有** `createShare` 的返回值能给出：替换发生在事务里，
   *    事后按 `status='replaced'` 去数会把**历史上**被替换的行一起算进去。
   * ⛔ 被替换的那一行**不单独记一条审计**：它是同一次发布的后果，reason 里已经
   *    写明；两条记录会让"他发了几次"这个最简单的计数变成要人去重。
   *
   * ⚠️★ 时长要**连着单位**写（2026-09-16）：房间是「15 分钟」、种子是「30 天」。
   *    只印数字的话，事后读审计的人分不出 `7` 是 7 分钟还是 7 天 —— 差 1440 倍。
   *    单位由 `parsed.duration.unit` 给（**唯一**一处知道哪个 kind 用哪个单位的地方）。
   */
  const shown =
    parsed.duration.unit === 'minutes'
      ? `${String(parsed.duration.value)} 分钟`
      : `${String(parsed.duration.value)} 天`;
  const reason =
    `发布分享（kind=${kind}，展示 ${shown}` +
    (result.replaced > 0 ? `，替换掉 ${String(result.replaced)} 条` : '') +
    '）';
  writeAudit({
    actorId: user.id,
    action: 'share.create',
    entityType: 'live_share',
    entityId: result.share.id,
    reason,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  // 201 回的是**库里现在的那一行**（`buildItem` 是唯一的转换点），不是"我以为写进去的那一行"
  return c.json({ item: buildItem(result.share, user.id, now) }, 201);
});

// ---------------------------------------------------------------------------
// 下架 / 恢复
// ---------------------------------------------------------------------------

sharesRoute.patch('/:id/visibility', requireAuth, async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = ShareVisibilitySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  }

  const id = c.req.param('id');
  const row = getShareForEdit(id);
  if (!row) return c.json({ error: 'not_found' }, 404);

  /*
   * ★★ 单行这条路**没有**列表查询那道"坏行跳过"的过滤（`getShareForEdit` 读的是原始行），
   *    而下面两次回读都要经过 `buildItem` —— 它对坏行是 **throw** ⇒
   *    一行手改过 / 半截 JSON 的数据会把这条 PATCH 变成 **500**（spec §11.1 只说到了读路径）。
   *    ⇒ 在这里就按"没有这一条"处置：它既不是一条能展示的分享，也不该把一个
   *      "这一行存坏了"的运维问题变成**用户按钮上的 500**。
   *    ⚠️ 判在归属 / 权限之前：不存在的 id 也是 404，所以这个回答不多泄露一个字，
   *      而"坏行是谁的"本来也不是这一条要回答的问题。
   *    ⚠️ 日志照打（读路径"跳过并记日志"是纪律 ③）：不打的话，这次 404 与
   *      "真的没有这一条"在日志里长得一模一样，坏行就再没有地方能被发现。
   */
  if (!isRenderableShareRow(row)) {
    console.warn(
      `[shares] 分享行 ${id} 的 payload 与 kind=${row.kind} 对不上，单行路径按 not_found 处理`,
    );
    return c.json({ error: 'not_found' }, 404);
  }

  const now = Date.now();
  const isOwner = row.user_id === user.id;
  const isModerator = checkPermission(
    { role: user.role as UserRole, emailVerified: user.email_verified_at !== null },
    'share.moderate',
  ).ok;

  if (parsed.data.visible) {
    /*
     * ★ 恢复**只有本人**能做，管理员走到这里一律 403（spec §4.2 / 裁决 11）。
     *   理由：管理动作是单向的。管理员能"拿下来"是因为他代表站点，
     *   而"放回去"要么是作者的判断，要么不该由第三方代劳 ——
     *   否则一条被下架的内容可以绕过作者被悄悄复活，而作者不会收到任何通知
     *   （对他来说，下架时那一条消失、复活时又回来，他分不清是谁干的）。
     */
    if (!isOwner) return c.json({ error: 'forbidden' }, 403);

    const result = setShareVisible(id, now, user.id);
    if (!result.ok) {
      /*
       * ★ `at_limit` 是一个**独立的拒绝码**，不是 `invalid_state` 的一种
       *   （spec §4.2 那两行、§13 的拒绝码表）。措辞也不同：这一档说的是
       *   「你已经在展示另一条了，先把它下架，再恢复这条」。
       * ⚠️ 把所有失败都写成 `invalid_state` + reason 是错的：前端只认
       *   `error === 'at_limit'`（它有一句专门的话），而 `reason` 里塞什么都到不了它手里。
       */
      if (result.reason === 'at_limit') return c.json({ error: 'at_limit' }, 409);
      return c.json({ error: 'invalid_state', reason: result.reason }, 409);
    }

    /*
     * ⚠️ 这一条的 reason 里**没有**「替换掉 N 条」，而 create 那条有 —— 这不是漏了。
     *   恢复 room 时数据层确实会在同一个事务里把一条**已过期**的兄弟行置 `replaced`
     *   （§4.3 的补记），但那一行既不在看板上、自己也恢复不了，顶掉它不会让任何人
     *   看到的东西消失；而且那个数量最多只能是 1（部分唯一索引保证"一人一条 active"）。
     *   ⇒ 为它去改数据层的 `SetVisibilityResult`（多回一个 `replaced`）只为在审计里
     *     写一句"替换掉 1 条"，代价大于收益（§6.3 也只要求 create 那条写明）。
     *   ⚠️ 想加之前先读 §4.3：能走到这一步的兄弟行**只可能是过期的**，理由是上面
     *     那句 `countLive` —— 在看板上的兄弟行会被 `at_limit` 先拒掉。
     */
    writeAudit({
      actorId: user.id,
      action: 'share.restore',
      entityType: 'live_share',
      entityId: id,
      reason: '恢复上架（作者自己）',
      ip: c.req.header('x-real-ip') ?? null,
      now,
    });
    return c.json({ item: buildItem(result.share, user.id, now) });
  }

  // 下架：拥有者**或** share.moderate（"谁能调"是路由层的事，状态机在数据层）
  if (!isOwner && !isModerator) return c.json({ error: 'forbidden' }, 403);
  const result = setShareHidden(id, now);
  if (!result.ok) {
    // 同上：`at_limit` 独立成码。⚠️ 下架这条路今天走不到它（下架不会超额度），
    // 但两个分支**形状必须一样** —— 否则下一个人读两处会以为差异是有意的。
    if (result.reason === 'at_limit') return c.json({ error: 'at_limit' }, 409);
    return c.json({ error: 'invalid_state', reason: result.reason }, 409);
  }

  /*
   * ⚠️ reason 里**必须**能分辨是自己下架还是管理员下架 —— 这是事后唯一能分辨的地方
   *    （沿用 `PATCH /api/resources/:id/visibility` 那一条的写法）。审计本身只记
   *    actor_id，而"这个人下架的是自己的东西还是别人的"要从 reason 读。
   */
  writeAudit({
    actorId: user.id,
    action: 'share.hide',
    entityType: 'live_share',
    entityId: id,
    reason: isOwner ? '下架（作者自己）' : '下架（治理者）',
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });
  return c.json({ item: buildItem(result.share, user.id, now) });
});

// ---------------------------------------------------------------------------
// 彻底删除（2026-09-16）
// ---------------------------------------------------------------------------

/**
 * 彻底删除一条 —— **只有作者本人**，而且**只有已下架的行**能删。
 *
 * ===========================================================================
 * ★★ 为什么这里是 DELETE 而 PATCH 那两个动作不是
 * ===========================================================================
 * 下架 / 恢复改的是**同一行的一个字段**（`status` / `hidden_at`），行一直在，
 * 所以它们是同一个资源上的两种"可见性"取值 ⇒ 一个 `PATCH …/visibility` 装得下。
 * 删除**把那一行拿掉**，它不是"另一种可见性" —— 塞进同一个 PATCH 就要多一个
 * `{ deleted: true }` 这种与 `visible` 互斥的开关，而那种开关的每一个非法组合
 * （两个都为 true / 都不传）都得多写一段判断。
 *
 * ===========================================================================
 * ⚠️★ 没有 `isRenderableShareRow` 那一步（与上面 PATCH 刻意不同）
 * ===========================================================================
 * PATCH 要先问一次是因为它最后要 `buildItem` 回读，而 `buildItem` 对坏行**throw**
 * ⇒ 一行半截 JSON 的数据会把按钮变成 500。这里回的是 `{ ok, id }`，
 * **一个字节的 payload 都不读** ⇒ 坏行不存在那条缝，而且坏行的作者反而能把它删掉
 * （数据层那段注释写着，这是有意的）。⛔ 别为了"两个写接口形状一样"把它补上：
 * 补上之后坏行就**再也删不掉了**（读路径看不见它、这里又拒它）。
 *
 * ===========================================================================
 * 拒绝的形状与 PATCH 逐条对齐
 * ===========================================================================
 *   · `not_found`（行不在 / id 打错 / 已经删过）⇒ **404**
 *   · `forbidden`（不是作者本人，**含管理员**）⇒ **403**
 *   · `not_hidden`（还在展示 / 已被替换）⇒ **409 `invalid_state` + reason**
 * ⚠️ `invalid_state` 的三种 reason 在 `lib/shareErrors.ts` 里各有专门的一句话，
 *    `not_hidden` 那一句复用现有的 `shares.errNotHidden`（不为这条路另写一句：
 *    多一句就要多一格 reason，而那张表是渲染自检**逐格**断言的）。
 * ⚠️ 顺手刷新由**调用方**负责（`routes/ShareBoard.tsx` 收到 `invalid_state` 就重拉）：
 *    这三种拒绝说的都是"你手上那份数据旧了"。
 */
sharesRoute.delete('/:id', requireAuth, (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const id = c.req.param('id');
  const now = Date.now();
  const result = deleteShare(id, user.id);

  if (!result.ok) {
    if (result.reason === 'not_found') return c.json({ error: 'not_found' }, 404);
    if (result.reason === 'forbidden') return c.json({ error: 'forbidden' }, 403);
    return c.json({ error: 'invalid_state', reason: result.reason }, 409);
  }

  /*
   * 审计：★ 这一条的 `entity_id` **指向一行已经不在的表记录** —— 这是刻意的，
   *   也是 `audit_log` 不建外键的理由之一（`018` 与 `routes/admin.ts` 都记着同一条）。
   * ⚠️ reason 里必须带上 kind：行没了之后，`entity_id` 谁也查不到，
   *   而"删掉的到底是一条房间号还是一组种子"只能从这里读出来。
   */
  writeAudit({
    actorId: user.id,
    action: 'share.delete',
    entityType: 'live_share',
    entityId: id,
    reason: `彻底删除（作者自己，kind=${result.kind}）`,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  // 形状照 `DELETE /api/live/mine/:id`（同一个仓库里"删自己那一行"的回答）
  return c.json({ ok: true, id });
});
