/**
 * ② 直编端点：**这个文件里的每一个端点都绕过审核快照、直接写"线上那一行"**。
 *
 * 全部要求 `content.author`（editor / admin / owner）。⚠️ `reviewer` **没有**这个能力，
 * 那不是搭配问题而是职责分离的守门：`canSelfReview` 规定 reviewer 不能批准自己提交的内容
 * （"审核的全部意义是有第二个人看过"）。一旦他能直编，就变成"自己改、自己生效" ——
 * 那条规则被掏空，而审计里只是两条互不相干的记录。
 *
 * ---------------------------------------------------------------------------
 * 为什么单独一个文件，而不是分散在各类型路由里（A2.4/A2.5）
 * ---------------------------------------------------------------------------
 * 「哪些端点会绕过审核直接写线上内容」是**最需要一眼看完**的问题。
 * 散在 resources / calendar / videos 三个文件里，安全审查要翻四处；
 * 放在 `/api/admin/*` 又与那里的既有含义（内容治理：精选/下架/账号）混淆 ——
 * 那里管的是"内容以什么姿态出现"，这里管的是"内容本身是什么"。
 *
 * 本仓已有先例：`routes/resources.ts` 的头注释自己写着"把需要更高权限的东西
 * 集中在一个文件里，安全审查时只需要看那一处"。
 *
 * ---------------------------------------------------------------------------
 * 端点清单（spec §3.5）
 * ---------------------------------------------------------------------------
 *   POST   /api/authoring/resources        新建即上架
 *   PATCH  /api/authoring/resources/:id    直编（内容来自请求本身，不来自待审快照）
 *   DELETE /api/authoring/resources/:id    真删；**两档**（见下面那张表 —— ⚠️ 不是"只有 owner"）
 *
 *   POST   /api/authoring/calendar         新建即上架（`status = 'published'`）
 *   PATCH  /api/authoring/calendar/:id     直编；有待审改动时 409 `already_pending`
 *   DELETE /api/authoring/calendar/:id     真删；**同一事务里连 `content_revisions` 一起删**
 *
 *   PATCH  /api/authoring/videos/:id       直编（链接 → 平台/视频 id 重算，撞唯一键 → 409）
 *   DELETE /api/authoring/videos/:id       真删；**两档**
 *
 * ⚠️ 视频**没有** `POST`：贴视频本来就不进审核（`POST /api/videos` 已经是"立刻可见"），
 *    再来一条直编新建只会是同一个动作的第二个入口。所以 ② 的视频部分只有"改"和"删"，
 *    审计动作也就只有 `video.directEdit` / `video.directDelete`（spec §7.3）。
 *
 * ⚠️ `liveRevisionUnchanged`：这几条写路径都不经过审核 → 线上那一行被**真的**改动了
 *    （或本来就没有待审那一版），所以一律 `false`。它与 `status` 回答两个不同的问题，
 *    两个都要给（见 spec §3.2b 与 shared 里 `SubmissionResult` 的说明）——
 *    于是界面可以说"已保存，线上已更新"，同时在条目仍是 `hidden` 时补一句
 *    "这一条目前是下架状态"。**只看 `false` 就说"已生效"是撒谎**。
 *
 * ⚠️ 删除的规则**按"有没有连带数据"分档，不按端点名**（captain 2026-09-13 的裁定）：
 *    · **资源**（② 的资源三件）：`DELETE FROM resources` 会 CASCADE 掉版本历史与**所有人**的
 *      收藏/备注/评分，而私人备注是**别人**写的、没有备份 ⇒ **两档**：owner 一键
 *      （`canHardDelete` 谓词），editor/admin 两步（先在线上 → 409 `must_hide_first`）。
 *    · **视频**：同样是两档 —— 它有下架入口（`PATCH /api/videos/:id/visibility`），
 *      而且墙上的东西不该被一次误点直接抹掉。
 *    · **赛事**：**直删**。它没有收藏/备注/评分，也没有任何下架入口
 *      （spec §7.7 明确本轮不新开隐藏功能）⇒ 那道"先下架"在赛事上会退化成
 *      **"editor 永远删不掉"**，直接违反需求 ② 的"editor 及以上可直接**删**赛事"。
 *      所以这里 `force: true`，判据只剩能力（见下面 `deleteEventDirect` 的注释）。
 *    ⚠️ 三者**判据一律是 `status`**，不是"有没有版本号"。
 *    ⚠️⚠️ **两档 ≠ 只有 owner**：本文件这三处一度被写成"非 owner 一律 403"，
 *       那是错的（会让 editor/admin 永远删不掉资源）。改之前先读上面这几行。
 */

import type { UserRole } from '@mcsr/shared';
import { CalendarEventInputSchema } from '@mcsr/shared/calendar';
import { can, canHardDelete } from '@mcsr/shared/permissions';
import { ResourceSubmissionSchema } from '@mcsr/shared/resources';
import { parseVideoLink, VideoInputSchema } from '@mcsr/shared/videos';
import { Hono } from 'hono';
import { type AuthVariables, requireCapability } from '../auth/middleware';
import { newId } from '../auth/tokens';
import {
  applyEventDirectRevision,
  deleteEventDirect,
  getEventRow,
  submitEventDirect,
} from '../calendar/events';
import {
  deleteResourceDirect,
  findResourceByUrl,
  resourceExists,
  resourceOwner,
  uniqueResourceId,
} from '../resources';
import { applyDirectRevision, createResourceDirect } from '../revisions';
import { writeAudit } from '../users';
import { deleteVideoDirect, getVideo, updateVideoDirect } from '../videos';

export const authoringRoute = new Hono<{ Variables: AuthVariables }>();

/** 校验失败时的统一形状（与其它路由一致：字段 + 可读消息）。 */
function formatIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues.map((i) => ({
    field: i.path.map(String).join('.') || '(root)',
    message: i.message,
  }));
}

// ---------------------------------------------------------------------------
// 资源库
// ---------------------------------------------------------------------------

/** 新建即上架。审计：`resource.directCreate`。 */
authoringRoute.post('/resources', requireCapability('content.author'), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = ResourceSubmissionSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  }

  /*
   * ⚠️ 查重规则与用户提交**完全一致**（D2.12）：直编不是绕开目录规则的通道。
   *    形状也保持一致（`url_exists` + existingId/status/mine），
   *    这样前端的同一套分支能直接复用 —— 少一份会漂移的规则。
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
  const { revision } = createResourceDirect({
    id,
    submission: parsed.data,
    actorId: user.id,
    now,
  });

  writeAudit({
    actorId: user.id,
    action: 'resource.directCreate',
    entityType: 'resource',
    entityId: id,
    // ⚠️ "直编（未走审核）"必须写进 reason：快照表**分不出**直编与"编辑自批"
    //    （两者都是 reviewed_by = 自己），"怎么来的"只在审计里（D2.5）
    reason: `直编（未走审核） revision ${String(revision)}`,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  return c.json(
    { ok: true, id, revision, status: 'published', isEdit: false, liveRevisionUnchanged: false },
    201,
  );
});

/** 直编已存在的条目。审计：`resource.directEdit`。 */
authoringRoute.patch('/resources/:id', requireCapability('content.author'), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const id = c.req.param('id');
  if (!resourceExists(id)) return c.json({ error: 'not_found' }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = ResourceSubmissionSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  }

  const now = Date.now();
  const result = applyDirectRevision({
    resourceId: id,
    submission: parsed.data,
    actorId: user.id,
    now,
  });

  if ('error' in result) {
    /*
     * ⚠️ `already_pending` 是 409 而不是 400/500：请求本身没问题，
     *    是**状态**不允许（有一条待审改动正在等着被批准/驳回）。
     *    照这个形状给，前端可以直接复用提交路径上已有的那句文案。
     */
    if (result.error === 'already_pending') return c.json({ error: 'already_pending' }, 409);
    return c.json({ error: 'not_found' }, 404);
  }

  writeAudit({
    actorId: user.id,
    action: 'resource.directEdit',
    entityType: 'resource',
    entityId: id,
    reason: `直编（未走审核） revision ${String(result.revision)}`,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  /*
   * ⚠️ `status` 返回**真实**状态，不是写死 'published'：
   *    下架过的条目直编之后仍然是 `hidden`（见 applyDirectRevision 的注释）。
   *    写死的话前端会说"已生效、线上可见"，而它其实还在下架状态里 —— 那是对用户撒谎。
   */
  return c.json({
    ok: true,
    id,
    revision: result.revision,
    status: result.status,
    liveRevisionUnchanged: false,
  });
});

/**
 * 删除一条资源 —— **两档**（用户的原始需求：② 的"修改/添加/删除"给 editor 及以上，
 * 而"**另外**允许 owner 一键真正删除"是在此之上多出来的那一档）。
 *
 * | 角色 | 行为 |
 * |---|---|
 * | **owner**（`canHardDelete`） | **一键真删**：不做前置检查，直接删（UI 上一次确认） |
 * | **editor / admin**（有 `content.author`，但没有那个谓词） | **两步**：`published` → 409 `invalid_state` + `reason: 'must_hide_first'`；先下架成 `hidden` 之后再删 → 200 |
 * | 普通用户 / 未登录 | 403 / 401 |
 *
 * ⚠️ 判据**两处来源不同**，这是刻意的：owner 那一档是**等级型**（`canHardDelete` 谓词，
 *    因为"owner 是所有者"不是"owner 有个技能"，能力矩阵里的东西是**可授予**的）；
 *    editor/admin 那一档是**动作型**（`content.author`，本来就是矩阵里的能力）。
 *
 * ⚠️ **两步不是形式**：`DELETE FROM resources` 会通过 `ON DELETE CASCADE` 连带删掉
 *    版本历史与**所有人**的收藏/私人备注/评分，而私人备注是**别人**写的、没有备份。
 *    下架可恢复 —— 那道缓冲就是给"手滑"留的。
 *
 * ⚠️ 连带删除是**预期行为**，写进审计的 reason 里。
 */
authoringRoute.delete('/resources/:id', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const role = user.role as UserRole;
  const isOwner = canHardDelete(role);
  /*
   * ⚠️⚠️ 判据 = **两档**（spec §3.2c / §7.4，依据是用户两条原话）：
   *    · **owner**（`canHardDelete` 谓词）→ `force: true`：跳过"先下架"，任何 status 都真删；
   *    · **editor / admin**（有 `content.author`）→ **也能删**，但内容还在线上时由数据层回
   *      **409 `invalid_state` + `reason: 'must_hide_first'`**（他们的"删" = 先下架 → 再删，可恢复）；
   *    · **reviewer / 普通用户** → **403**（能力判定，不是状态判定）。
   *
   * ⚠️⚠️ 这条**曾经被写成 (a)**（"非 owner 一律 403、`must_hide_first` 不可达"）—— **那是错的**：
   *    用户原话把"删除"放进了 editor+ 的能力里（需求②「修改/添加/**删除**」），
   *    而「**另外**允许 owner **一键**真正删除」只多出"**一键**"。
   *    照 (a) 实现会让 editor/admin **永远删不掉任何资源**（表现：`authoring.test.ts`
   *    直接红在 `403 !== 409`）。**不要再改回 (a)。**
   *
   * ⚠️ 非 owner 必须**同时**有 `content.author`：reviewer 恰好是这个能力的边界
   *    （给他就等于让审核员自己改、自己生效）。所以这里不能写成"只要登录就行"。
   */
  if (
    !isOwner &&
    !can({ role, emailVerified: user.email_verified_at !== null }, 'content.author')
  ) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const id = c.req.param('id');
  const now = Date.now();
  const removed = deleteResourceDirect(id, { force: isOwner });

  if (!removed.ok) {
    if (removed.reason === 'not_found') return c.json({ error: 'not_found' }, 404);
    // editor/admin 且内容还在线上 → 409：请求本身没问题，是**状态**不允许
    return c.json({ error: 'invalid_state', reason: 'must_hide_first' }, 409);
  }

  writeAudit({
    actorId: user.id,
    action: 'resource.directDelete',
    entityType: 'resource',
    entityId: id,
    // 记下"这是真删"及其连带影响 —— 事后追查时这一条是唯一的线索
    // ⚠️ 两档要能分辨：owner 是"一键"，editor/admin 是"两步（先下架后删）"
    reason: isOwner
      ? '一键硬删（owner，不可恢复）：版本历史 + 所有人的收藏/备注/评分一并删除'
      : '硬删（editor/admin 两步：先下架后删除，不可恢复）：版本历史 + 所有人的收藏/备注/评分一并删除',
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  return c.json({ ok: true, id, status: 'deleted' });
});

// ---------------------------------------------------------------------------
// 赛事
// ---------------------------------------------------------------------------

/**
 * 直编新建一场赛事：**建出来就已经发布**（`status = 'published'` + 第 1 版 approved 快照）。
 * 审计：`calendar.directCreate`。
 *
 * ⚠️ 与用户提交走的是**同一份 schema**（D2.11）：表单就是那一版内容。
 *    直编少填一个字段这种问题，只会以"用户投诉某场赛事没有地点"的形式出现，
 *    而那时没人会想到是两条入口的字段集不一样。
 */
authoringRoute.post('/calendar', requireCapability('content.author'), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = CalendarEventInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  }

  const now = Date.now();
  const id = newId();
  submitEventDirect({ id, payload: parsed.data, actorId: user.id, now });

  writeAudit({
    actorId: user.id,
    action: 'calendar.directCreate',
    entityType: 'calendar_event',
    entityId: id,
    // "直编（未走审核）"必须写进 reason：快照表分不出直编与"编辑自批"（D2.5）
    reason: '直编（未走审核） revision 1',
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  /*
   * ⚠️ `status: 'published'` 是**事实**（`submitEventDirect` 里写死的），不是乐观表态：
   *    直编新建不留待审，所以它这一刻就在日历上。想让它不上架就先建再下架。
   */
  return c.json(
    { ok: true, id, revision: 1, status: 'published', liveRevisionUnchanged: false },
    201,
  );
});

/**
 * 直编一场已存在的赛事。审计：`calendar.directEdit`。
 *
 * ⚠️ **有待审改动时拒绝**（409 `already_pending`，数据层判定）：那条待审快照是基于
 *    更早的线上版本拍的，一旦稍后被批准，就会把这次直编的内容**原样覆盖回去** ——
 *    没有报错，作者只会看到"我改的东西自己变回去了"。
 */
authoringRoute.patch('/calendar/:id', requireCapability('content.author'), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const id = c.req.param('id');
  /*
   * ⚠️ 与资源那条**同形**：先判"这条在不在"，再判"请求本身合不合法"。
   *    两处形状必须一样 —— 否则前端同一段代码在两个类型上要按不同顺序处理错误。
   */
  if (!getEventRow(id)) return c.json({ error: 'not_found' }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = CalendarEventInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  }

  const now = Date.now();
  const result = applyEventDirectRevision({ id, payload: parsed.data, actorId: user.id, now });

  if ('error' in result) {
    // 409 而不是 400：请求本身没问题，是**状态**不允许（有一份待审改动在等着被处理）
    if (result.error === 'already_pending') return c.json({ error: 'already_pending' }, 409);
    return c.json({ error: 'not_found' }, 404);
  }

  writeAudit({
    actorId: user.id,
    action: 'calendar.directEdit',
    entityType: 'calendar_event',
    entityId: id,
    reason: `直编（未走审核） revision ${String(result.revision)}`,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  /*
   * ⚠️ `status` 返回**真实**状态：`hidden` 的赛事改完仍然是 `hidden`
   *    （`applyEventDirectRevision` 的 CASE WHEN）。写死 'published' 的话，
   *    界面会说"已生效、日历上可见"，而它其实不在日历上。
   *    日历目前没有隐藏入口，但这条规则必须和其它两个类型一致 ——
   *    否则将来一开隐藏就会出现"改个错别字就把它恢复上架"。
   */
  return c.json({
    ok: true,
    id,
    revision: result.revision,
    status: result.status,
    liveRevisionUnchanged: false,
  });
});

/**
 * 删除一场赛事 —— **直删**（不是资源/视频那种两档，理由见文件头）。
 *
 * | 角色 | 行为 |
 * |---|---|
 * | **owner** / 有 `content.author` 的人（editor / admin） | 一次调用真删（已发布也直接删） |
 * | **reviewer / 普通用户** | 403 `forbidden`（能力判定，不是状态判定） |
 * | 未登录 | 401 |
 *
 * ⚠️⚠️ **为什么这里没有"先下架"那一步**（这是 captain 明确裁定过的，别照资源那条改回来）：
 *    那道缓冲的**唯一理由**是"不可逆地毁掉**别人**的数据" —— 资源的删除会 CASCADE 掉
 *    版本历史与**所有人**的收藏/私人备注/评分，而私人备注没有备份。
 *    **赛事没有这个条件**：无收藏、无私人备注、无任何连带数据；而且赛事**没有下架入口**
 *    （日历连 `hidden` 都写不进去，spec §7.7 明确本轮不新开）——
 *    在这里要"先下架"等于把删除变成一条**谁也走不通的死路**：
 *    editor 对任何一条已发布的赛事永远拿 409，而用户需求 ② 的原话是
 *    "editor 及以上可直接增删改**资料、视频、赛事、种子**的原文本"。
 *    ⇒ 判据只剩能力。`deleteEventDirect` 里那个 `must_hide_first` 分支**保留但不可达**，
 *      它在那个函数的注释里也标明了。
 *
 * ⚠️ 数据层会在**同一个事务里**把这场赛事的 `content_revisions` 一起删掉
 *    （那张表按类型多态、**没有外键**，不删就留下永远查不到的孤儿行，
 *    里面还可能有 `status = 'pending'` 的快照 —— 表现是"审核队列里有一条
 *    已经不存在的事件"，点进去 404）。理由与实现见 `deleteEventDirect` 的注释。
 */
authoringRoute.delete('/calendar/:id', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const role = user.role as UserRole;
  const isOwner = canHardDelete(role);
  /*
   * ⚠️ 非 owner 必须**同时**有 `content.author`：reviewer 恰好是这个能力的边界
   *    （给他就等于让审核员"自己改、自己生效"）。所以这里不能写成"只要登录就行"。
   */
  if (
    !isOwner &&
    !can({ role, emailVerified: user.email_verified_at !== null }, 'content.author')
  ) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const id = c.req.param('id');
  const now = Date.now();
  /*
   * ⚠️ `force: true` **永远**为 true（上面已经把不该来的人挡掉了）。
   *    保留这个参数是为了与 `deleteResourceDirect` / `deleteVideoDirect` 同形，
   *    而且它是 `must_hide_first` 那个分支唯一的开关 —— 将来真给赛事加了隐藏入口，
   *    改动就是这一行，不是重写一条规则。
   */
  const removed = deleteEventDirect(id, { force: true });

  if (!removed.ok) {
    if (removed.reason === 'not_found') return c.json({ error: 'not_found' }, 404);
    /*
     * ⚠️ 这一支**当前不可达**（`force` 恒为 true）。留着是为了类型穷尽 +
     *    让"两档"那条规则在三个类型里仍然是同一个形状；
     *    真有人删掉 `force: true`，它会立刻变成一条谁也走不通的死路。
     */
    return c.json({ error: 'invalid_state', reason: 'must_hide_first' }, 409);
  }

  writeAudit({
    actorId: user.id,
    action: 'calendar.directDelete',
    entityType: 'calendar_event',
    entityId: id,
    // 连带删除要写进 reason：事后追查时"这次真删把版本历史也带走了"只在审计里
    reason: isOwner
      ? '直删（owner，不可恢复）：版本历史一并删除'
      : '直删（editor/admin，不可恢复）：版本历史一并删除',
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  return c.json({ ok: true, id, status: 'deleted' });
});

// ---------------------------------------------------------------------------
// 视频
// ---------------------------------------------------------------------------

/**
 * 直编一条视频（链接 / 标题 / 起始偏移）。审计：`video.directEdit`。
 *
 * ⚠️ 视频**没有审核那一步**，所以这里的直编不是"绕过审核"，而是"改一条已经在线上的行"：
 *    它没有版本表，也就没有快照可写（见 `updateVideoDirect` 的注释）。
 *
 * ⚠️ 链接**必须在服务端重新拆成 (platform, videoId)**，不能由前端传那一对：
 *    `(platform, video_id)` 上有全表 UNIQUE，而"拆链接"的规则集中在
 *    `shared/videos.ts`（`parseVideoUrl`）。让前端传那一对等于把那条规则复制一份，
 *    两份迟早不一致，表现是"同一个视频被存成两行"。
 *
 * ⚠️ 撞上 UNIQUE 时返回 **409 `video_exists` + existingId**，形状与 `POST /api/videos`
 *    完全一致（前端复用同一段处理，不必为"编辑时撞重复"再写一条分支）。
 */
authoringRoute.patch('/videos/:id', requireCapability('content.author'), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const id = c.req.param('id');
  // ⚠️ `getVideo` 而不是"只在 visible 里找"：一条被隐藏的视频同样要能被编辑
  if (!getVideo(id)) return c.json({ error: 'not_found' }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = VideoInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  }

  const link = parseVideoLink(parsed.data.url);
  if (!link) {
    /*
     * ⚠️ 与 `POST /api/videos` **同一句文案、同一个形状**（`invalid_input` + 字段级 issue）。
     *    这也是编辑页最容易踩到的一种失败：用户在标题上改字，却把链接框里的内容
     *    一起动过；只说"链接不合法"会让他反复检查复制得对不对，而问题在别处。
     */
    return c.json(
      {
        error: 'invalid_input',
        issues: [
          {
            field: 'url',
            message:
              '这个链接里读不出视频 ID。请粘贴**某一个视频**的播放页链接' +
              '（B站 / YouTube / Twitch），不要贴频道、播放列表或整个合集。',
          },
        ],
      },
      400,
    );
  }

  const now = Date.now();
  const result = updateVideoDirect({
    id,
    platform: link.platform,
    videoId: link.videoId,
    title: parsed.data.title,
    startOffsetSec: parsed.data.startOffsetSec ?? null,
    now,
  });

  if (!result.ok) {
    if (result.reason === 'not_found') return c.json({ error: 'not_found' }, 404);
    return c.json(
      {
        error: 'video_exists',
        existingId: result.existing.id,
        existingTitle: result.existing.title,
        existingStatus: result.existing.status,
        existingMine: result.existing.userId === user.id,
      },
      409,
    );
  }

  writeAudit({
    actorId: user.id,
    action: 'video.directEdit',
    entityType: 'video',
    entityId: id,
    reason: `直编（未走审核） ${link.platform} ${link.videoId}`,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  /*
   * ⚠️ `liveRevisionUnchanged: false`（spec §3.2b 的硬性契约）：改动**已经生效**。
   *    字段名里的 "Revision" 对没有版本表的视频只是"线上那一行"的意思 ——
   *    这里的 `false` 不是"失败了"，而是"线上那一行刚被改过"。
   *
   * ⚠️⚠️ **`status` 必须放在顶层**（与资源/日历那两条直编改写**同形**）。
   *    §3.2b 的语义边界之一：`false` 只说"改动作用在线上那一行"，**不说"它在不在站上"** ——
   *    一条被隐藏的视频改完仍然是 `hidden`，只说"已保存"会让用户以为它回到了墙上。
   *    前端据此判定的那处（`apps/web/src/lib/directWriteNotice.ts` 的 `DirectOutcome`）
   *    要的正是"顶层 `status` + `liveRevisionUnchanged`"这两个字段：
   *    少了顶层 `status`，视频这条路径就只能**单独破例**去读 `video.status`，
   *    而"某一类型要特殊处理"正是三个直编端点最容易漂移的地方。
   *    （`video.status` 仍然照常返回 —— 顶层这一个是对它的**镜像**，不是第二份真相：
   *     两者在同一次响应里由同一个值生成。）
   */
  return c.json({
    ok: true,
    video: result.video,
    status: result.video.status,
    liveRevisionUnchanged: false,
  });
});

/**
 * 删除一条视频 —— **两档**，与资源 / 赛事**逐字同形**。
 *
 * ⚠️ 与既有的 `DELETE /api/videos/:id` **并存、语义不变**：那条是"作者删自己的（真删）/
 *    治理者隐藏（可逆）"，这条是 ② 的直编删除。两条路的判定互不影响 ——
 *    作者仍然可以删自己的帖子，治理者仍然只能隐藏别人的。
 *
 * ⚠️ owner 的"一键"**不需要先隐藏**：直接真删。
 *    editor / admin 对**还在墙上**（`status = 'visible'`）的那条会拿到
 *    409 `invalid_state` + `reason: 'must_hide_first'`（先用
 *    `PATCH /api/videos/:id/visibility` 隐藏，隐藏可恢复）；已经是 `hidden` 的直接删得掉。
 */
authoringRoute.delete('/videos/:id', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const role = user.role as UserRole;
  const isOwner = canHardDelete(role);
  /*
   * ⚠️ 与资源那条**逐字同一条规则**（**两档**，spec §3.2c / §7.4）：两处写成一样的形状是
   *    刻意的 —— 同一个概念在两个类型上用不同判据，下一个人只会照着其中一处改，
   *    而"谁能删"就变成两份真相。
   *    · **owner** → `force: true`，跳过"先下架"，任何 status 都真删；
   *    · **editor / admin**（`content.author`）→ **也能删**，还在墙上时回
   *      **409 `invalid_state` + `reason: 'must_hide_first'`**
   *      （先用 `PATCH /api/videos/:id/visibility` 隐藏，隐藏可恢复）；
   *    · 其它角色 → **403**。
   *
   * ⚠️ 这条**曾经被写成 (a)**（非 owner 一律 403），已按用户原话改回两档：需求②把"删除"
   *    给了 editor+，「**另外**允许 owner **一键**真正删除」只多出"**一键**"。
   *    **不要再改回 (a)** —— 那会让 editor/admin 永远删不掉视频。
   */
  if (
    !isOwner &&
    !can({ role, emailVerified: user.email_verified_at !== null }, 'content.author')
  ) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const id = c.req.param('id');
  const now = Date.now();
  const removed = deleteVideoDirect(id, { force: isOwner });

  if (!removed.ok) {
    if (removed.reason === 'not_found') return c.json({ error: 'not_found' }, 404);
    // editor/admin 且视频还在墙上 → 409：请求本身没问题，是**状态**不允许
    return c.json({ error: 'invalid_state', reason: 'must_hide_first' }, 409);
  }

  writeAudit({
    actorId: user.id,
    action: 'video.directDelete',
    entityType: 'video',
    entityId: id,
    // 两档要能分辨：owner 是"一键"，editor/admin 是"两步（先隐藏后删）"
    reason: isOwner
      ? '一键硬删（owner，不可恢复）'
      : '硬删（editor/admin 两步：先隐藏后删除，不可恢复）',
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  /*
   * ⚠️ `mode: 'deleted'`（而不是 `status`）：与既有那条 DELETE 的字段名保持一致 ——
   *    那条用 `mode` 区分 'deleted' / 'hidden'，前端已经按它写过分支。
   *    改字段名等于让前端为同一种结果写两套解析。
   */
  return c.json({ ok: true, id, mode: 'deleted' });
});
