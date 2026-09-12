/**
 * 日历端点。
 *
 * 端点清单（docs/v1-plan.md §4）：
 *   GET    /api/calendar?from=&to=&tags=&page=   公开列表
 *   GET    /api/calendar/:id                     公开详情（仅已发布）
 *   GET    /api/calendar.ics                     **订阅链接，无需登录**
 *   POST   /api/calendar                         提交（需登录 + 邮箱已验证）
 *   PATCH  /api/calendar/:id                     修改（作者或有编辑权的人；改后 → pending）
 *   GET    /api/calendar/mine/:id                作者自己看（含未发布）
 *
 * ---------------------------------------------------------------------------
 * ⚠️ ICS 的路径是 `/api/calendar.ics` 而不是 `/api/calendar/ics`
 * ---------------------------------------------------------------------------
 * 计划里写的是前者，而这不是笔误：**订阅链接是要被用户复制粘贴到日历客户端里
 * 长期使用的**。带后缀的路径看起来才像一个"文件"，而 `/calendar/ics` 看起来像
 * 一个页面 —— 有的客户端会因此拒绝它（它们会检查扩展名来决定怎么解析）。
 * 既然这条 URL 要进用户的手机设置里，就让它长得像个日历文件。
 */

import { EVENT_LEVELS, EVENT_SCOPES, EVENT_STAGES, SITE, type UserRole } from '@mcsr/shared';
import { CalendarEventInputSchema } from '@mcsr/shared/calendar';
import { checkPermission } from '@mcsr/shared/permissions';
import { Hono } from 'hono';
import { type AuthVariables, requireAuth, requireCapability } from '../auth/middleware';
import { newId } from '../auth/tokens';
import {
  approveEvent,
  getEventRow,
  getPendingRevision,
  listEvents,
  listPublishedForIcs,
  rejectEvent,
  reviseEvent,
  submitEvent,
  toCalendarEvent,
} from '../calendar/events';
import { buildIcs } from '../calendar/ics';
import { writeAudit } from '../users';

export const calendarRoute = new Hono<{ Variables: AuthVariables }>();

/** 服务端校验失败时的统一形状（和 auth 路由一致：字段 + 可读消息）。 */
function formatIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues.map((i) => ({
    field: i.path.map(String).join('.') || '(root)',
    message: i.message,
  }));
}

/** 逗号分隔的查询参数 → 数组（空串与多余空白都丢掉）。 */
function csv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// 订阅（无需登录）
// ---------------------------------------------------------------------------

/**
 * ICS 订阅。
 *
 * ⚠️ **不要求登录**，也不能要求：日历客户端取这个 URL 时不会带 cookie，
 *    也不会走我们的登录页。加一道登录就等于把一个"订阅链接"变成
 *    "只有在浏览器里登录之后才能看的东西"。
 *
 * 只导出**已发布**的事件 —— 待审和已驳回的内容绝不能出现在订阅里，
 * 否则审核就白做了（那正是"先过审、后改成广告"想防的事的另一面）。
 */
calendarRoute.get('/calendar.ics', (c) => {
  /*
   * ⚠️ 一个 `now` 用两处：筛"还没结束的"（Q5 只导出未来的）和 DTSTAMP。
   *    取两次 Date.now() 会在请求跨过某场赛事的结束时刻时给出自相矛盾的输出，
   *    而且那样一来测试也没法复现。
   */
  const now = Date.now();
  const rows = listPublishedForIcs(now);
  const ics = buildIcs(rows.map(toCalendarEvent), {
    now,
    // UID 的域名后缀。用站点常量而不是请求 Host —— UID 必须**跨环境稳定**，
    // 否则同一个事件在 www 和裸域下会是两个不同的 UID，订阅者会看到重复。
    // SITE 里存的是完整 origin，所以这里取出主机名。
    domain: new URL(SITE.productionOrigin).hostname,
    calendarName: `${SITE.name} 日历`,
    refreshMinutes: 60,
  });

  return c.body(ics, 200, {
    'content-type': 'text/calendar; charset=utf-8',
    /*
     * 允许跨域读：有的日历客户端（和在网页里点"订阅"的用户代理）会从
     * 另一个 origin 取这个文件。它不是隐私数据（本来就是公开的已发布事件）。
     */
    'access-control-allow-origin': '*',
    // ⚠️ 必须是 attachment 或 inline 且带文件名 —— 有的客户端看 Content-Type
    //    不够，还要看这个头才肯把它当成日历文件下载。
    'content-disposition': 'inline; filename="mcsr-helper.ics"',
  });
});

// ---------------------------------------------------------------------------
// 公开列表与详情
// ---------------------------------------------------------------------------

calendarRoute.get('/calendar', (c) => {
  const page = Math.max(Number(c.req.query('page') ?? 1) || 1, 1);
  const pageSize = Math.min(Math.max(Number(c.req.query('pageSize') ?? 50) || 50, 1), 200);

  const from = c.req.query('from');
  const to = c.req.query('to');

  /*
   * 三个**单选**维度：level / scope / stage。
   *
   * ⚠️ 和 tags 的处理刻意不同：
   *   · tags 走 csv() → 数组 → "任一命中"（多选）
   *   · 这三个是单值等值条件
   * 把单选维度也写成数组会得到一个"或"的语义，而界面上它们是"就是这个"。
   *
   * ⚠️ 值要**对着 shared 的枚举校验**，不能原样透传。理由和 tags 一样：
   *    查询参数是用户可以手打的，而 `?level=PRO` 传错成 `?level=pro`
   *    会让查询悄悄返回空 —— 看起来像"日历里没有这类赛事"，
   *    而实际上库里有一条 PRO 的。非法值一律当"不限"，宁可多给也不要给错的答案。
   */
  const oneOf = (value: string | undefined, allowed: readonly string[]): string | null => {
    if (!value) return null;
    return allowed.includes(value) ? value : null;
  };

  const { rows, total } = listEvents({
    // 默认只列"还没结束的"（Q5）：过去的赛事堆在顶上会让日历看起来像档案库。
    // 想看历史就显式传 from=0（前端用「显示已结束」开关传它）。
    //
    // ⚠️ 月历表传的是**月初和月末**，于是语义变成"与这个月相交的事件"：
    //    `COALESCE(ends_at_utc, starts_at_utc) >= 月初 AND starts_at_utc <= 月末`。
    //    这不是巧合，是刻意的 —— 跨月的事件必须在两个月里都出现，
    //    否则它会在自己的第二个月里凭空消失。
    fromUtc: from === undefined ? Date.now() : Number(from) || 0,
    toUtc: to ? Number(to) || null : null,
    tags: csv(c.req.query('tags')),
    level: oneOf(c.req.query('level'), EVENT_LEVELS),
    scope: oneOf(c.req.query('scope'), EVENT_SCOPES),
    stage: oneOf(c.req.query('stage'), EVENT_STAGES),
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return c.json({
    items: rows.map(toCalendarEvent),
    total,
    page,
    pageSize,
  });
});

calendarRoute.get('/calendar/:id', (c) => {
  const row = getEventRow(c.req.param('id'));
  // 未发布的条目对公众返回 404 —— 不是 403。
  // 403 等于承认"这个 id 存在但你没权限"，那本身就是一条信息。
  // （`row?.status` 同时覆盖了 row 为 null：null?.status 是 undefined，同样 !== 'published'）
  if (row?.status !== 'published') return c.json({ error: 'not_found' }, 404);
  return c.json({ event: toCalendarEvent(row) });
});

/**
 * 作者/编辑者读取（含未发布，以及待审的那一版）。
 *
 * 权限刻意只要求"登录"：未发布的草稿必须能被作者自己看见，
 * 而"未验证邮箱"的人也不该因为看不到自己刚提交的东西而重复提交。
 */
calendarRoute.get('/calendar/mine/:id', requireAuth, (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const row = getEventRow(c.req.param('id'));
  if (!row) return c.json({ error: 'not_found' }, 404);

  const actor = { role: user.role as UserRole, emailVerified: user.email_verified_at !== null };
  const isAuthor = row.author_id === user.id;
  // 已经是已发布内容的，任何人只要登录都能改（wiki 式，和资源库一致）
  const canRevise = checkPermission(actor, 'calendar.review').ok || row.status === 'published';
  if (!isAuthor && !canRevise) return c.json({ error: 'not_found' }, 404);

  const pending = getPendingRevision(row.id);
  return c.json({
    event: toCalendarEvent(row),
    pendingRevision: pending ? pending.revision : null,
    pendingPayload: pending ? pending.payload : null,
  });
});

// ---------------------------------------------------------------------------
// 提交与修改
// ---------------------------------------------------------------------------

calendarRoute.post('/calendar', requireAuth, requireCapability('calendar.submit'), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = CalendarEventInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  }

  const now = Date.now();
  const id = newId();
  submitEvent({ id, payload: parsed.data, authorId: user.id, now });

  writeAudit({
    actorId: user.id,
    action: 'calendar.submit',
    entityType: 'calendar_event',
    entityId: id,
    ip: null,
    now,
  });

  return c.json({ id, revision: 1, status: 'pending' }, 201);
});

calendarRoute.patch('/calendar/:id', requireAuth, async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const row = getEventRow(c.req.param('id'));
  if (!row) return c.json({ error: 'not_found' }, 404);

  const actor = { role: user.role as UserRole, emailVerified: user.email_verified_at !== null };
  const isAuthor = row.author_id === user.id;

  /*
   * 改**未发布**的条目只有作者自己可以（那是别人看不见的草稿）；
   * 改**已发布**的则是 wiki 式 —— 任何登录且验证过邮箱的人都可以，
   * 改动一样要走审核，所以这不是"绕过审核的后门"。
   * 与资源库的 resource.editOwn / resource.editAny 是同一套语义。
   */
  const allowed = row.status === 'published' ? checkPermission(actor, 'calendar.submit') : null;
  if (row.status === 'published') {
    if (!allowed?.ok) return c.json({ error: allowed?.reason ?? 'forbidden' }, 403);
  } else if (!isAuthor) {
    return c.json({ error: 'not_found' }, 404);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = CalendarEventInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  }

  const now = Date.now();
  const result = reviseEvent({ id: row.id, payload: parsed.data, editorId: user.id, now });
  if ('error' in result) {
    if (result.error === 'already_pending') {
      return c.json({ error: 'already_pending' }, 409);
    }
    return c.json({ error: 'not_found' }, 404);
  }

  writeAudit({
    actorId: user.id,
    action: isAuthor ? 'calendar.revise' : 'calendar.reviseOther',
    entityType: 'calendar_event',
    entityId: row.id,
    ip: null,
    now,
  });

  return c.json({ id: row.id, revision: result.revision, status: 'pending' });
});

// ---------------------------------------------------------------------------
// 审核动作
// ---------------------------------------------------------------------------

/**
 * ⚠️ 审核动作**不在这里**实现，而是走通用的审核路由（`routes/review.ts`），
 *    因为它对每种内容类型都是同一套逻辑（谁批的、批的哪一版、能不能批自己的）。
 *    这里只导出数据层的 approve/reject，由 `review/registry.ts` 注册。
 *
 * 保留这两个导出是为了让注册表能一行接上，也是为了让"日历有审核"这件事
 * 在这里可见 —— 否则读这个文件的人会以为日历是免审的。
 */
export { approveEvent, rejectEvent };
