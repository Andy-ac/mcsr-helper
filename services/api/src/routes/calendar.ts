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

import { EVENT_ACCESS, EVENT_LEVELS, EVENT_SCOPES, SITE, type UserRole } from '@mcsr/shared';
import {
  CalendarEventInputSchema,
  CalendarSeriesColorInputSchema,
  CalendarSeriesInputSchema,
  normalizeSeriesName,
} from '@mcsr/shared/calendar';
import { canHardDelete, checkPermission } from '@mcsr/shared/permissions';
import { Hono } from 'hono';
import { type AuthVariables, requireAuth, requireCapability } from '../auth/middleware';
import { newId } from '../auth/tokens';
import {
  approveEvent,
  countSeriesEvents,
  createSeries,
  deleteSeriesCascade,
  getEventRow,
  getPendingRevision,
  getSeries,
  listEvents,
  listPublishedForIcs,
  listSeries,
  rejectEvent,
  renameSeries,
  reviseEvent,
  setSeriesColor,
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

/**
 * 多选查询参数 → 数组，**两种拼法都要认**：`?x=A,B` 与 `?x=A&x=B`。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 为什么重复参数这一支是必需的（2026-09-13，参与范围明细那一维）
 * ---------------------------------------------------------------------------
 * `c.req.query('x')` 对重复参数只返回**第一个**值。于是前端的筛选栏若用
 * `URLSearchParams.append`（多选控件的自然写法）拼出 `?scopeDetail=ASIA&scopeDetail=OCEANIA`，
 * 服务端只会筛亚洲 —— 用户选了"亚洲&大洋洲"，列表里**一个澳洲赛事都不出现**，
 * 而**不会报错**：那一屏看起来完全正常，只是少了几条。
 * （"命中任一即显示"是用户对这一维的原话，所以少掉的那一半正是他要的那一半。）
 *
 * ⚠️ 逗号那一支保留：它是本仓既有的拼法（`?tags=A,B`，见 `fetchCalendarEvents`），
 *    而且已经分享出去的链接就是那个形状 —— 换掉会让老链接静默地筛不到东西。
 */
function csvAll(values: readonly string[] | undefined): string[] {
  if (!values) return [];
  return values.flatMap((v) => csv(v));
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
   * 三个**单选**维度：level / scope / access
   * （`stage` / 轮次在 2026-09-13 按用户要求删除了；`access` / 参赛门槛同一天加进来）。
   *
   * ⚠️ 和 tags 的处理刻意不同：
   *   · tags 走 csvAll() → 数组 → "任一命中"（多选）
   *   · 这三个是单值等值条件
   * 把单选维度也写成数组会得到一个"或"的语义，而界面上它们是"就是这个"。
   * ⚠️ `scopeDetail`（大洲/国家明细）走"任一命中"：它是多选，
   *    语义与 tags 一致（用户原话："选亚洲或大洋洲都会展示"）。
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
    tags: csvAll(c.req.queries('tags')),
    level: oneOf(c.req.query('level'), EVENT_LEVELS),
    scope: oneOf(c.req.query('scope'), EVENT_SCOPES),
    /*
     * ★ 参赛门槛（2026-09-13 新增的第三维）：与 level / scope **完全同档** ——
     *   单选等值、非法值当"不限"。
     *
     * ⚠️ 少这一行的话，界面上那个筛选项就是**假筛选**：点了之后列表一条不少，
     *    而看起来完全正常（"可能这个门槛的赛事就只有这些吧"）。这一维是新加的，
     *    所以它没有任何历史包袱来提醒我们别漏 —— 只能靠与另外两维形状一致。
     */
    access: oneOf(c.req.query('access'), EVENT_ACCESS),
    /*
     * ★ 参与范围明细（2026-09-13）：`?scopeDetail=ASIA,OCEANIA`，**命中任一即匹配**。
     *
     * ⚠️ 这里**不做枚举校验**（连 `scope` 那一档的 `oneOf` 都没有）：
     *    传一个拼错的代码只会匹配不到任何事件 —— 那是**诚实**的结果；
     *    把它当"不限"反而会让用户看到"筛了却像没筛"的一屏。
     * ⚠️ 也**不**依据 `scope` 去校验"选全球时不该有明细"：那只是一条无意义的冗余，
     *    不是一条会让人看错的数据；为此写一套跨字段规则只会多一处会漂移的真相。
     * ⚠️ 走 `csvAll`（而不是 `csv(c.req.query(...))`）：多选控件常拼成重复参数
     *    `?scopeDetail=ASIA&scopeDetail=OCEANIA`，而 `req.query()` 只认第一个 ——
     *    见 `csvAll` 的注释。
     */
    scopeDetail: csvAll(c.req.queries('scopeDetail')),
    /*
     * ③ 按系列筛（`?seriesId=`）。
     *
     * ⚠️ 这里**不做枚举校验**（不像上面三个维度）：它们校验的是"值在封闭集合里"，
     *    而 seriesId 是一个 id —— 传一个不存在的 id 只会匹配不到任何事件，
     *    那是**诚实**的结果；把它当成"不限"反而会给出"看起来筛了其实没筛"的一屏。
     */
    seriesId: c.req.query('seriesId') || null,
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

// ---------------------------------------------------------------------------
// 系列活动（③）
//
// ⚠️⚠️ **这一块必须留在 `/calendar/:id` 之前**：`/calendar/series` 是一个**字面量段**，
//    而 `/calendar/:id` 会把 `series` 当成事件 id 吃掉 —— 那时
//    `GET /api/calendar/series` 回的是 404 `not_found`，**看起来像"这个功能没做"**。
//    Hono 按注册顺序匹配，不是按"更具体的优先"。
//    （同一个坑在本仓写过注释：`routes/resources.ts:60`、`routes/videos.ts:134-148`。）
// ---------------------------------------------------------------------------

/**
 * 系列列表 —— 日历页底部那个「系列活动」栏目的数据源。
 *
 * ⚠️ **不挂 `requireAuth`**：系列对匿名访客开放（§9-5 的裁决，用户原话
 *    「系列赛事对于未登录的用户也可放开查看」）。**列表与搜索都放开**，不要只放开一个。
 *
 * ⚠️ 搜索**不在服务端**：系列是人眼能扫完的量级，`q` 由前端在这一份响应里过滤
 *    （spec §4.5 / D3.9-(b)）。服务端再写一份匹配规则就是第二份会漂移的真相。
 *
 * ⚠️ `total` 是**系列数**，不是事件数 —— 同一屏里还会出现"场次数"，
 *    两个数字混起来只会表现成"数字看起来很大"，不会报错。
 */
calendarRoute.get('/calendar/series', (c) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 200) || 200, 1), 200);
  const items = listSeries(Date.now(), limit);
  return c.json({ items, total: items.length });
});

/**
 * 新建系列。**只有 editor 及以上**（`content.author`，§9-4 的裁决）。
 *
 * ⚠️ 为什么不新开一个能力（比如 `series.manage`）：`content.author` 就是
 *    "直接写内容"那条策略（② 的直编），"建系列"正是它的一种。单独开一个名字
 *    只会让矩阵多一条**永远同进同退**的行（见 spec §3.1 对这类拆分的批评）。
 */
calendarRoute.post('/calendar/series', requireCapability('content.author'), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = CalendarSeriesInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  }

  const now = Date.now();
  const result = createSeries(parsed.data, user.id, now);
  if (!result.ok) {
    /*
     * 重名沿用既有错误码 + 机器可读的 reason（`invalid_state` + `series_name_taken`）：
     * **不新增错误码**，所以 `error-codes.test.ts` 的 KNOWN_CODES 不用改（spec §7.4）。
     */
    return c.json({ error: 'invalid_state', reason: 'series_name_taken' }, 409);
  }

  writeAudit({
    actorId: user.id,
    action: 'series.create',
    entityType: 'calendar_series',
    entityId: result.series.id,
    reason: result.series.name,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  return c.json({ ok: true, series: result.series }, 201);
});

/** 改系列名。权限与新建相同（§9-4：改名只推荐给 editor 及以上）。 */
calendarRoute.patch('/calendar/series/:id', requireCapability('content.author'), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = CalendarSeriesInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  }

  const id = c.req.param('id');
  const now = Date.now();
  const result = renameSeries(id, parsed.data);
  if (!result.ok) {
    if (result.reason === 'name_taken') {
      return c.json({ error: 'invalid_state', reason: 'series_name_taken' }, 409);
    }
    return c.json({ error: 'not_found' }, 404);
  }

  writeAudit({
    actorId: user.id,
    action: 'series.rename',
    entityType: 'calendar_series',
    entityId: id,
    // 审计要回答"把什么改成了什么"，所以两个名字都记 —— 只记新的那个等于没记
    reason: `${result.previousName} → ${normalizeSeriesName(parsed.data.name) ?? parsed.data.name}`,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  /*
   * ⚠️ 回包必须是 `{ series }`（**整行**），不是 `{ id, name }`。
   *
   * 前端 `apps/web/src/lib/api.ts` 的 `renameCalendarSeries` 声明返回
   * `{ series: CalendarSeries }`。以前服务端回的是 `{ ok, id, name }` ——
   * 那份类型声明**是假的**：调用方拿 `res.series.name` 会得到
   * `undefined` 而不是报错（JSON 响应的类型是手写的，没有编译期关系）。
   * 表现是"改完名，列表里那一行的名字没变"，而**没有任何报错**。
   *
   * ⚠️ 用 `getSeries` 回读而不是把入参拼成对象：`CalendarSeries` 上还有
   *    `count` / `pastCount` / `nextStartsAtUtc` 三个**算出来的**数字，
   *    入参里没有它们。手拼一份等于给这三个字段编值，而它们会被直接渲染。
   *
   * ⚠️ 回读不到就**抛**（500），不编一个假对象：改名刚刚成功、行一定在，
   *    回读不到只可能是并发删除或查询写错了 —— 那时回一个"看起来正常"的
   *    series 会让调用方把一次失败当成成功。
   */
  const series = getSeries(id, now);
  if (!series) {
    throw new Error(`改名成功之后回读不到系列 ${id} —— 这不该发生`);
  }

  return c.json({ ok: true, series });
});

/**
 * 给一个系列上色 / 去掉颜色（需求⑤，2026-09-13）。**owner 或编辑（`content.author`）**。
 *
 * ---------------------------------------------------------------------------
 * 权限：与「建系列 / 改系列名」同档，**不是**与删除同档（2026-09-14 用户裁决）
 * ---------------------------------------------------------------------------
 * 用户原话是「允许 owner 修改每个系列的颜色」。第一版照字面做成了 **owner 专属**
 * （谓词 `canHardDelete`），并把这个取舍报了上去 —— 用户随后裁决**放宽**：
 * 编辑器也可以改。
 *
 * 理由与本仓那条通用规矩一致：**可逆的走 `content.author`，不可逆的才留给 owner**。
 * 「换个颜色」正是一个可逆的、纯装饰的动作（再点一下就回去了），
 * 而用户为删除系列定下 owner 专属的理由恰恰是"它在一次动作里硬删掉该系列下每一场
 * 赛事**连同版本历史**"——这一条完全没有那个性质。
 * ⚠️ 另一个现实理由：系列是**编辑建的**。要求 owner 才能上色，等于"谁建的谁不能调"，
 *    而那不是一条能长期维持的规则。
 *
 * ⚠️ 判据用的是**同一个能力** `content.author`（与建系列 / 改系列名那两条端点完全一样），
 *    而不是再拼一个 `canHardDelete(role) || can(…)`。理由：**判据只能有一处**。
 *    owner 本来就包含 `content.author`（`permissions.ts` 里 `owner: [...EDITOR_CAPS, …]`
 *    —— owner 的能力与 admin 完全相同，多出来的那一份是**等级**不是能力），
 *    所以"owner 或编辑"这件事由**矩阵一行**表达就够了。
 *    ⚠️ 代价要说清楚：**owner 能不能改颜色，从此取决于矩阵里 owner 那一行**。
 *      将来若有人把它拆开（比如规定"只有编辑能上色"），owner 会**静默**失去这个入口
 *      —— 而 `calendar-series-color.test.ts` 里那条用例把 editor 与 owner **两个都**
 *      断言成 200，所以那种改动会红，不会静默。
 *    ⚠️ 也**不要**新开一个能力（比如 `series.color`）：那样矩阵里会多一条
 *      "永远和 content.author 同进同退"的行（见 permissions.ts 开头对这类拆分的批评）。
 *
 * ⚠️ 与**删除**那条的关键区别（这一条最容易写错，而错了不会报错）：
 *    删除系列**不是**这个能力 —— 它走 owner 专属谓词 `canHardDelete`
 *    （见下面 `DELETE /calendar/series/:id`）。两者判据不同是**故意的**：
 *    删除不可逆（连带删掉该系列下每一场赛事与版本历史），换颜色可逆。
 *    写成同一个的话，要么编辑改不了颜色，要么编辑能删系列。
 *
 * ⚠️ 路径里的 `color` 是**第三段**，所以它不会被 `/calendar/:id` 吃掉；
 *    但它仍然必须留在这一块里（`/calendar/:id` 之前）—— 理由见上面那条
 *    "系列这一块必须留在前面"的说明：`series` 是字面量段，`/calendar/:id`
 *    会把它当成事件 id。
 */
calendarRoute.put('/calendar/series/:id/color', requireCapability('content.author'), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = CalendarSeriesColorInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    /*
     * ⚠️ 400 走既有的 `invalid_input` + issues，**不新增错误码** ——
     *    `error-codes.test.ts` 里有一张 KNOWN_CODES 白名单，新码会让那条测试红，
     *    而"颜色值不合法"本来就属于"入参不合法"这一档。
     */
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  }

  const id = c.req.param('id');
  const result = setSeriesColor(id, parsed.data.color);
  if (!result.ok) return c.json({ error: 'not_found' }, 404);

  const now = Date.now();
  writeAudit({
    actorId: user.id,
    action: 'series.color',
    entityType: 'calendar_series',
    entityId: id,
    /*
     * 审计要回答"颜色怎么变成这个了"，所以两个值都记 —— 只记新值等于没记
     * （与 series.rename 同一条规则）。
     * ⚠️ `null` 写成「不上色」：库里存的是键，而审计是**给人看的**，
     *    一行 `null → red` 里那个 null 会被读成"数据坏了"而不是"他之前没上色"。
     */
    reason: `${result.previousColor ?? '不上色'} → ${parsed.data.color ?? '不上色'}`,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  /*
   * 回包形状与 `apps/web/src/lib/api.ts` 的 `setCalendarSeriesColor` 对齐
   * （`{ ok, id, color, previousColor }`）—— 那个函数已经写好，服务端跟着它来。
   * ⚠️ `color` 回的是**请求里的那个键**（不是色值）：调用方拿它直接更新本地状态，
   *    若服务端回色值，界面上的"当前选中色块"就会和服务端的键对不上。
   */
  return c.json({ ok: true, id, color: parsed.data.color, previousColor: result.previousColor });
});

/**
 * 删除系列，**连带它下面的所有赛事**（2026-09-13，用户裁决）。
 *
 * ---------------------------------------------------------------------------
 * 为什么权限是「只给 owner」，而不是与新建/改名同档的 `content.author`
 * ---------------------------------------------------------------------------
 * 新建和改名都是**可逆**的（名字还能改回来）。这一个不是：它在一个动作里
 * 硬删掉该系列下的**每一场赛事，连同它们的版本历史**，而这些赛事没有"先下架"
 * 那一步 —— 本仓给删除定的两档规则（owner 一键真删 / editor 先隐藏再删）
 * 在这里**只剩得下一档**。⇒ 判据直接用谓词 `canHardDelete(role)`，与
 * `routes/authoring.ts` 的三处删除同一个来源。
 *
 * ⚠️ **不要**在这里写 `role === 'owner'`：`permissions.ts` 写明 `canHardDelete`
 *    是"谁能真删"的**唯一**定义点，前端隐藏按钮、服务端拦截面都必须调它。
 *
 * ⚠️ 响应里必须带 `deletedEvents`：界面靠它把"删了多少场"说清楚，审计也靠它留痕。
 *    只回 `{ ok: true }` 的话，用户点完之后无从知道代价。
 */
calendarRoute.delete('/calendar/series/:id', requireAuth, (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  /*
   * ⚠️ 只判 owner —— **不**像 `authoring.ts` 那样再给 `content.author` 留一条后路：
   *    那边放行 editor 是因为"先隐藏"那一步由他们完成，而系列**没有隐藏态**。
   */
  if (!canHardDelete(user.role as UserRole)) return c.json({ error: 'forbidden' }, 403);

  const id = c.req.param('id');
  const result = deleteSeriesCascade(id);
  if (!result.ok) return c.json({ error: 'not_found' }, 404);

  const now = Date.now();
  writeAudit({
    actorId: user.id,
    action: 'series.delete',
    entityType: 'calendar_series',
    entityId: id,
    /*
     * ⚠️ 连带数量必须写进 reason：事后追查时，"这次真删带走了几场赛事和它们的
     *    版本历史"**只有审计里看得到** —— 系列行本身已经不存在了。
     */
    reason: `删除系列（不可恢复）：连带 ${result.deletedEvents} 场赛事及其版本历史`,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  return c.json({ ok: true, id, deletedEvents: result.deletedEvents });
});

/**
 * 删除这个系列**会连带删掉多少场赛事** —— 只给二次确认用。
 *
 * ⚠️ 为什么需要它（而不是拿列表里那个 `count`）：列表的 `count` 是
 *    「未结束且已发布」的场次，而删除带走的是**所有**赛场（含已过去的、含未发布的）。
 *    历史系列在列表里正好显示 `count = 0` ⇒ 确认框会说"不会影响任何内容"，
 *    而它正要删掉十几场。数字必须来自**与删除同一个 WHERE**（见 `countSeriesEvents`）。
 *
 * ⚠️ 权限与删除**完全相同**（owner 专属），而且必须如此：这个端点的唯一用途是给
 *    删除做确认，放开给所有人等于向匿名访客汇报"这个系列里有几条还没发布的投稿"。
 *    （`GET /calendar/series` 是公开的，所以**不能**把未发布计数顺手塞进那个响应里。）
 */
calendarRoute.get('/calendar/series/:id/impact', requireAuth, (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  if (!canHardDelete(user.role as UserRole)) return c.json({ error: 'forbidden' }, 403);

  const id = c.req.param('id');
  const events = countSeriesEvents(id);
  // `null` = 系列不存在；**不是**"存在但一场都没有"（那是 0）—— 两者混起来会
  // 让"删一个不存在的 id"看起来像一次成功的空操作。
  if (events === null) return c.json({ error: 'not_found' }, 404);

  return c.json({ ok: true, id, events });
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

  /*
   * ⚠️ `liveRevisionUnchanged: true`（spec §3.2b 的硬性契约）：提审**新建**时
   *    "线上没有这一条"，所以"线上那一版一个字都没变"成立。
   *    ⚠️ 这条以前**没有返回**，而漏写不会有任何编译错误（响应是内联字面量、
   *    前端的类型是自己手写的），表现是日历编辑页永远说不了"线上仍是旧版"。
   *    有一条测试守着这个字段的**存在性**（不是只比真值 —— `undefined` 会冒充 false）。
   */
  return c.json({ id, revision: 1, status: 'pending', liveRevisionUnchanged: true }, 201);
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

  // ⚠️ 提审修改：线上仍是旧版 ⇒ true（§3.2b；日历的 PATCH 以前也不返回它）
  return c.json({
    id: row.id,
    revision: result.revision,
    status: 'pending',
    liveRevisionUnchanged: true,
  });
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
