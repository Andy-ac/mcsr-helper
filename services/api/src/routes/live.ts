/**
 * 直播板块的端点 —— **两组**，权限形状完全相反，别混。
 *
 * ① 编辑维护的**公开名单**（`live_channels`）：
 *   GET    /api/live                 公开列表（**无需登录**）
 *   GET    /api/live/manage          编辑视图：含被隐藏的（需 live.manage）
 *   POST   /api/live                 新增一条（需 live.manage）
 *   PATCH  /api/live/:id             整行更新（需 live.manage）
 *   PATCH  /api/live/:id/visibility  隐藏 / 显示（需 live.manage）
 *   DELETE /api/live/:id             真删（需 live.manage）
 *
 * ② 每个登录用户**自己的**链接（`user_live_links`，④）：
 *   GET    /api/live/mine        我的链接（**登录即可**，`no-store`）
 *   POST   /api/live/mine        贴一条链接（**登录即可**）
 *   PATCH  /api/live/mine/:id    改我的一条（`url` / `title`）
 *   DELETE /api/live/mine/:id    删我的一条
 *
 * ⚠️ 两组**互不写入**：私人链接永远不会出现在公开名单里，公开名单也永远不会
 *    因为某个用户贴了什么而变化（两次列表查询、两条渲染路径、两套缓存规则）。
 *
 * ---------------------------------------------------------------------------
 * 公开名单：为什么只有 `live.manage` 一个能力，没有 `live.submit`
 * ---------------------------------------------------------------------------
 * 这份清单不是 UGC。用户的原话是"记录一些重要的 MCSR streamer"——
 * 一份由少数人维护、变动很慢的名单（"比较固定"）。
 * 而 Q6 的视频恰好相反（贴了就可见、rolling）。两者形态不同，
 * 权限形状也就不同：给它加一个 `live.submit` 会立刻引出
 * "那要不要审核"这个问题，而答案是"没有人会去审一份编辑自己写的名单"。
 *
 * ---------------------------------------------------------------------------
 * ④ 私人链接：为什么是 `requireAuth` 就够了，而且**没有**新能力
 * ---------------------------------------------------------------------------
 * 它是"用户自己的、私人的、低风险的"数据，与收藏 / 备注 / 评分**同一档**
 * （理由和 `routes/marks.ts` 的文件头逐字相同）：
 *   · **不要求邮箱验证** —— 邮箱验证那道闸门是为"发布**公开**内容"设的，
 *     它要保证每条公开内容背后有一个可达的人；而这里的内容**只有自己看得到**，
 *     拿同一道闸门去挡它，只会让新用户的第一件事变成"去邮箱点个链接"，收益为零；
 *   · **不新增能力**（尤其没有 `live.submit`）—— 上面那段关于公开名单的决定
 *     **一个字不改**（D4b.1）；
 *   · **不进公开缓存**：`GET /api/live/mine` 必须 `no-store`，它因人而异 ——
 *     缓存住的话下一个人会看到别人的私人链接（同 `/api/videos/mine`、
 *     `/api/resources/mine` 的纪律）。
 *
 * ⚠️ **界面隐藏不是安全边界**：前端的「我的链接」块对未登录用户不渲染，
 *    但服务端这四个端点一律返回 401。两边都要有。
 *
 * ---------------------------------------------------------------------------
 * 排序与缓存（公开那一侧）
 * ---------------------------------------------------------------------------
 * · 排序在**数据层**（`ORDER BY sort_order, display_name`），因为它有两个键，
 *   而"第二键钉死顺序"这件事的理由写在 live.ts 里（不钉的话刷新一次会换位）。
 * · 公开列表给 60 秒公开缓存（和视频墙、资源库一致）：它变得很慢，
 *   而"某人刚被加进去但没立刻出现"是可以接受的。
 * · `/manage` 与 `/mine` 必须 no-store —— 它们因人而异（含隐藏行 / 含私人的行）。
 */
import {
  LIVE_NAME_MAX,
  LIVE_NOTE_MAX,
  LiveChannelInputSchema,
  UserLiveLinkInputSchema,
  UserLiveLinkPatchSchema,
} from '@mcsr/shared/live';
import { Hono } from 'hono';
import { type AuthVariables, requireAuth, requireCapability } from '../auth/middleware';
import {
  createLiveChannel,
  createUserLiveLink,
  deleteLiveChannel,
  deleteUserLiveLink,
  getLiveChannel,
  listLiveChannels,
  listUserLiveLinks,
  setLiveChannelStatus,
  updateLiveChannel,
  updateUserLiveLink,
} from '../live';
import { writeAudit } from '../users';

export const liveRoute = new Hono<{ Variables: AuthVariables }>();

const PUBLIC_CACHE = 'public, max-age=60, stale-while-revalidate=300';

/** 校验失败时的统一形状（和 resources / calendar 路由一致）。 */
function formatIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues.map((i) => ({
    field: i.path.map(String).join('.') || '(root)',
    message: i.message,
  }));
}

/**
 * 一行副标题的长度上限兜底。
 *
 * ⚠️ 上面 schema 已经限了，这里再截一次是因为**长度限制改过**时老数据不会被回收：
 *    把 `LIVE_NOTE_MAX` 调小之后，库里已有的长行仍然会原样下发。
 *    展示层截断是最后一道，而且它不会因为一次 schema 改动就把接口变成 500。
 */
const NOTE_PREVIEW_MAX = 200;

function withPreview<T extends { note: string | null }>(channel: T): T {
  if (!channel.note || channel.note.length <= NOTE_PREVIEW_MAX) return channel;
  return { ...channel, note: `${channel.note.slice(0, NOTE_PREVIEW_MAX)}…` };
}

// ---------------------------------------------------------------------------
// 读
// ---------------------------------------------------------------------------

/**
 * 公开列表。**不挂任何鉴权** —— 看谁在播不需要登录
 * （和视频墙、资源库同一条访问模型：浏览不设门槛）。
 */
liveRoute.get('/live', (c) => {
  c.header('Cache-Control', PUBLIC_CACHE);
  return c.json({ items: listLiveChannels().map(withPreview) });
});

/**
 * 编辑视图：含被隐藏的。
 *
 * ⚠️ 路径是 `/live/manage` 而不是复用 `/live?includeHidden=1`。
 *    两个理由：
 *      · 它返回的是**不同的东西**（含隐藏行），把它做成同一个端点的一个参数，
 *        等于让"公开列表"和"管理列表"共用一条缓存规则 —— 而它们一条能缓存、
 *        一条绝对不能（`/manage` 含只有编辑能看的内容，缓存住会漏给别人）。
 *      · 视频那边用 `includeHidden` 是因为**筛选**（"我想看下架的那些"），
 *        而这里是**编辑表单的数据源**，语义不同。
 */
liveRoute.get('/live/manage', requireCapability('live.manage'), (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({ items: listLiveChannels(true) });
});

// ---------------------------------------------------------------------------
// ④ 我的链接（登录即可；只看得见 / 改得动自己的行）
// ---------------------------------------------------------------------------
/*
 * ⚠️ 这一组**必须注册在下面 `live.manage` 那几条之前**，而且不是"为了好看"：
 *    `PATCH /live/mine/:id` 与 `PATCH /live/:id/visibility` 在
 *    `PATCH /api/live/mine/visibility` 这一个路径上**同时匹配**
 *    （前者 id = 'visibility'，后者 id = 'mine'）。Hono 按注册顺序取第一个，
 *    所以顺序在这里是**行为**，不是风格。
 */

/** 我的链接。**因人而异 ⇒ no-store**（见文件头）。 */
liveRoute.get('/live/mine', requireAuth, (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  c.header('Cache-Control', 'no-store');
  return c.json({ items: listUserLiveLinks(user.id) });
});

/**
 * 贴一条链接。
 *
 * ⚠️ 入参**只有 `{ url, title? }`**（`.strict()`）：平台与标识**全部由服务端推导**
 *    （`parseLiveLink`），客户端不许指定 —— 否则表里的 `platform` 会与链接实际
 *    指向的平台不一致，而两边都不报错。
 * ⚠️ **认不出的链接也收**（201）：那是用户自己贴的链接，我们没有理由拒收，
 *    界面只给外链（D4b.4）。所以这个端点**没有** 400 "链接不合法"这一档 ——
 *    只有"没给链接 / 太长 / 多了字段"这类形状问题才是 400。
 * ⚠️ **没有 409**：个人化模型下"同一个人加两条同一个频道"是允许的
 *    （D4b.2），`live_exists` 那套只属于公开名单。
 */
liveRoute.post('/live/mine', requireAuth, async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = UserLiveLinkInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  }

  const link = createUserLiveLink(user.id, parsed.data, Date.now());
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, link }, 201);
});

/**
 * 改我的一条（`url` / `title`）。
 *
 * ⚠️ 别人的行 / 不存在的行 → **404**，不是 403：私人数据连"存在性"都不该泄漏
 *    （数据层里那条 SQL 带着 `user_id = ?`，所以在它看来别人的行**确实不存在**）。
 */
liveRoute.patch('/live/mine/:id', requireAuth, async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const parsed = UserLiveLinkPatchSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  }

  const result = updateUserLiveLink(id, user.id, parsed.data, Date.now());
  if (!result.ok) return c.json({ error: 'not_found' }, 404);

  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, link: result.link });
});

/** 删我的一条。删不到（不存在 / 不是自己的）⇒ 404。 */
liveRoute.delete('/live/mine/:id', requireAuth, (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const id = c.req.param('id');
  if (!deleteUserLiveLink(id, user.id)) return c.json({ error: 'not_found' }, 404);

  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, id });
});

// ---------------------------------------------------------------------------
// 写（全部需要 live.manage）
// ---------------------------------------------------------------------------

liveRoute.post('/live', requireCapability('live.manage'), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = LiveChannelInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  }

  const now = Date.now();
  const result = createLiveChannel(parsed.data, now);
  if (!result.ok) {
    /*
     * 409 而不是 500，而且**带上已经存在的那一条** ——
     * 重复是这份清单最常见的正常结果（同一个主播被两个人加），
     * 加的人需要的是"去看那一条"，不是一句"出错了"。
     * （和 routes/resources.ts 的 url_exists / routes/videos.ts 的 video_exists 同一条。）
     */
    return c.json({ error: 'live_exists', existingId: result.existing.id }, 409);
  }

  writeAudit({
    actorId: user.id,
    action: 'live.create',
    entityType: 'live_channel',
    entityId: result.channel.id,
    reason: `${parsed.data.platform} ${parsed.data.handle}`,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  return c.json({ ok: true, channel: result.channel }, 201);
});

liveRoute.patch('/live/:id', requireCapability('live.manage'), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const parsed = LiveChannelInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  }

  const now = Date.now();
  const result = updateLiveChannel(id, parsed.data, now);
  if (!result.ok) {
    if (result.reason === 'taken') return c.json({ error: 'live_exists' }, 409);
    return c.json({ error: 'not_found' }, 404);
  }

  writeAudit({
    actorId: user.id,
    action: 'live.update',
    entityType: 'live_channel',
    entityId: id,
    reason: `${parsed.data.platform} ${parsed.data.handle}`,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  return c.json({ ok: true, channel: result.channel });
});

liveRoute.patch('/live/:id/visibility', requireCapability('live.manage'), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const status =
    body && typeof body === 'object' && 'status' in body
      ? (body as { status: unknown }).status
      : undefined;
  if (status !== 'visible' && status !== 'hidden') {
    return c.json(
      {
        error: 'invalid_input',
        issues: [{ field: 'status', message: '取值只能是 visible / hidden' }],
      },
      400,
    );
  }

  const now = Date.now();
  const result = setLiveChannelStatus(id, status, now);
  if (!result.ok) return c.json({ error: 'not_found' }, 404);

  /*
   * ⚠️ 空操作（本来就是那个状态）**不写审计**。
   *    理由和视频那边一样：审计说的是"谁把什么改成了什么"，
   *    记一条没有发生的改动比少记一条更糟 —— 事后追查时会指向一个不存在的动作。
   */
  if (result.changed) {
    writeAudit({
      actorId: user.id,
      action: status === 'hidden' ? 'live.hide' : 'live.restore',
      entityType: 'live_channel',
      entityId: id,
      reason: null,
      ip: c.req.header('x-real-ip') ?? null,
      now,
    });
  }

  return c.json({ ok: true, id, status: result.status, changed: result.changed });
});

liveRoute.delete('/live/:id', requireCapability('live.manage'), (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const id = c.req.param('id');
  // 预读一次：删不到就 404，而不是回一个"删掉了"然后什么都没发生
  const existing = getLiveChannel(id);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const now = Date.now();
  const removed = deleteLiveChannel(id);
  if (!removed) return c.json({ error: 'not_found' }, 404);

  writeAudit({
    actorId: user.id,
    action: 'live.delete',
    entityType: 'live_channel',
    entityId: id,
    reason: `${existing.platform} ${existing.handle}`,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  return c.json({ ok: true, id });
});

/*
 * 导出上面几个长度上限，好让测试和界面用同一份数字。
 * （不导出的话，测试会各写一个 200，而界面会各写一个 80 —— 三份会漂移。）
 */
export const LIVE_LIMITS = { name: LIVE_NAME_MAX, note: LIVE_NOTE_MAX } as const;
