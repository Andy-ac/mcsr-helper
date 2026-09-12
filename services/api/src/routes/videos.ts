/**
 * 视频版块的端点。
 *
 * 端点清单（docs/v1-plan.md §4）：
 *   GET    /api/videos?platform=&authorId=&page=&pageSize=   视频墙（**公开**）
 *   GET    /api/videos/mine                                  我贴过的（含被隐藏的）
 *   POST   /api/videos                                       贴链接（登录 + 邮箱已验证）
 *   DELETE /api/videos/:id                                   作者删除 / 治理者隐藏
 *   PATCH  /api/videos/:id/visibility                        治理者隐藏或恢复
 *
 * ⚠️ 挂载方式：`app.route('/api', videosRoute)` —— 路由自己带着 `/videos` 前缀
 *    （和 routes/marks.ts、routes/calendar.ts 一样）。index.ts 的改动由接手
 *    挂载的人做，本模块被限定为三个文件（数据层 / 路由 / 测试）。
 *
 * ---------------------------------------------------------------------------
 * 为什么贴视频不需要"先审后发"（用户 Q6）
 * ---------------------------------------------------------------------------
 * 提交后直接 `visible`。完整理由写在 videos.ts 的文件头，这里只说**这个文件
 * 里能看见的那一半**：POST 的响应里根本没有 pending 这一档，
 * 而 DELETE / PATCH 两条事后手段都在 ——
 *   · 作者删自己的：真删
 *   · 有 `resource.moderate` 的人：隐藏（可逆，而且作者仍能在「我贴的」里看见）
 * 也就是说"不审核"不等于"没人管得了"，只是把管的时间点从**之前**挪到了**之后**。
 *
 * ---------------------------------------------------------------------------
 * 隐藏之后前端不渲染嵌入框 —— 这一条由**服务端**保证
 * ---------------------------------------------------------------------------
 * 公开列表只下发 `status = 'visible'` 的行，被隐藏的视频**连数据都不会到前端**。
 * 这是刻意的：如果只是前端不渲染 iframe 而标题、作者、占位框还在，
 * 页面上就留下一个**指向已隐藏视频的空壳**。空壳比什么都不留更糟 ——
 * 它既暴露了"这条被下架了"，又给了一个点进去就能看到那个视频的入口。
 *
 * ---------------------------------------------------------------------------
 * 缓存策略
 * ---------------------------------------------------------------------------
 * 视频墙是公开内容，给它和资源库一样的短公开缓存（60 秒，后台再验证）。
 * 而 `/mine` **必须 no-store**：它因人而异，缓存住的话下一个用户会看到
 * 别人贴了什么（和 routes/resources.ts 的 /mine 是同一条）。
 */
import { type UserRole, VIDEO_PLATFORMS } from '@mcsr/shared';
import type { Actor } from '@mcsr/shared/permissions';
import { checkPermission } from '@mcsr/shared/permissions';
import { DEFAULT_PAGE_SIZE } from '@mcsr/shared/resources';
import { parseVideoLink, platformSupportsStartOffset, VideoInputSchema } from '@mcsr/shared/videos';
import { Hono } from 'hono';
import { z } from 'zod';
import { type AuthVariables, requireAuth, requireCapability } from '../auth/middleware';
import { writeAudit } from '../users';
import {
  createVideo,
  deleteVideo,
  getVideo,
  listOwnVideos,
  listVideos,
  setVideoVisibility,
  VIDEO_VISIBILITIES,
} from '../videos';

export const videosRoute = new Hono<{ Variables: AuthVariables }>();

/** 公开内容的缓存策略，与资源库列表保持一致（见 routes/resources.ts 的说明）。 */
const PUBLIC_CACHE = 'public, max-age=60, stale-while-revalidate=300';

/** 校验失败时把 Zod 的问题整理成人能读的形态，而不是把整个 error 对象吐出去。 */
function formatIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues.map((i) => ({
    field: i.path.map(String).join('.') || '(root)',
    message: i.message,
  }));
}

/**
 * 视频墙的查询参数。
 *
 * ⚠️ 这个 schema 留在路由层，**没有**放进 shared/videos.ts：
 *    `z.coerce` 处理的是"查询串里一切都是字符串"这件事 —— 那是 HTTP 的
 *    性质，不是数据的性质。写入口的 `VideoInputSchema` 在 shared 里，
 *    因为**前端也要用它**做表单校验；而查询参数目前只有服务端读。
 *    等视频墙前端落地、前端也要按同一份规则拼参数时，再把它搬过去
 *    （shared/videos.ts 里已经有 VideoInputSchema 的位置）。
 *
 * `pageSize` 复用资源库的 DEFAULT_PAGE_SIZE（24），而不是在本文件里再写一个
 * 数字：两个列表页共用一套分页控件，默认值一旦不同，用户会觉得
 * "翻页的动作变了"——而那种不一致没人会主动去查。
 */
const VideoQuerySchema = z.object({
  platform: z.enum(VIDEO_PLATFORMS).optional(),
  /*
   * ⚠️ 没有 `.min(1)`，这是刻意的。
   *
   * `?authorId=`（空串）的意思就是"没筛选" —— 一个总是把当前筛选条件原样拼进
   * URL 的前端，在它认为"用户清空了筛选"时发出来的就是这个。加了 `.min(1)`
   * 会让那种请求变成 400，而用户看到的是"查询参数不合法"，完全指不到
   * "你把筛选清空了"这件事上。
   *
   * 数据层那边 `if (query.authorId)` 本来就把空串当成"不筛"，两边是一致的。
   * 同类的 `tag` / `q`（shared/resources.ts）也都没有 `.min(1)`。
   */
  authorId: z.string().trim().max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
});

/**
 * 可见性的入参。
 *
 * ⚠️ 这里用 `status: 'visible' | 'hidden'`，而**不是**资源库那种
 *    `published: true/false`。理由是这一层的名字应当和库里存的值一致：
 *    接口上说 `published: false`、库里存 `'hidden'`，就等于在两个地方
 *    各写一遍同一个映射，而"false 到底对应 hidden 还是 rejected"
 *    这种问题只会在有人加第三个状态的时候才暴露出来。
 *    枚举值直接来自数据层的 VIDEO_VISIBILITIES，不在这里再抄一遍。
 */
const VideoVisibilitySchema = z.object({ status: z.enum(VIDEO_VISIBILITIES) });

// ---------------------------------------------------------------------------
// 读
// ---------------------------------------------------------------------------

/**
 * 视频墙。**公开**（不挂任何鉴权中间件）—— 浏览不设门槛是访问模型
 * （docs/v1-plan.md §0.1）的核心，只有"贴"才需要登录。
 */
videosRoute.get('/videos', (c) => {
  const parsed = VideoQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid_query', issues: formatIssues(parsed.error) }, 400);
  }

  c.header('Cache-Control', PUBLIC_CACHE);
  return c.json(listVideos(parsed.data));
});

/**
 * 我贴过的（含被隐藏的）。
 *
 * ⚠️ 两条硬性约束，和资源库的 /mine 完全一样：
 *
 *   1. **必须注册在 `/:id` 之前**。Hono 按注册顺序匹配，`/videos/:id` 会把
 *      "mine" 当成一个视频 id 吃掉。目前没有 `GET /videos/:id`，所以还咬不到它 ——
 *      但顺序现在就摆好：等哪天有人加上详情接口，这条不会成为那个
 *      "看起来像没贴过视频"的诡异 bug。
 *
 *   2. **不能被缓存**（no-store）。它因人而异。
 *
 * 权限只要求"登录"，不要求 `video.submit`：贴视频的权限被收回的人
 * **仍然应该看得到自己贴过的东西**（并且能删掉它们）。
 */
videosRoute.get('/videos/mine', requireAuth, (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  c.header('Cache-Control', 'no-store');
  return c.json({ items: listOwnVideos(user.id) });
});

// ---------------------------------------------------------------------------
// 贴链接
// ---------------------------------------------------------------------------

/**
 * 贴一个视频链接。
 *
 * 权限：登录 + 邮箱已验证（`video.submit` 在 REQUIRES_VERIFIED 里）。
 * 拒绝的形状由 requireCapability 给出：401 未登录 / 403 缺能力 /
 * 403 email_not_verified —— 三者对用户意味着三个不同的下一步，
 * 合成一个 403 会让"我还差一步验证邮箱"显示成"你没这个权限"。
 */
videosRoute.post('/videos', requireCapability('video.submit'), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = VideoInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  }

  /*
   * 链接 → (platform, videoId)。**这一步不产生任何网络请求**
   * （parseVideoLink 只做字符串解析），铁律见 videos.ts 的文件头。
   */
  const link = parseVideoLink(parsed.data.url);
  if (!link) {
    /*
     * ⚠️ 解析失败走**同一个** `invalid_input` + `issues` 形状，而不是新开一个
     *    错误码。表单的字段级错误渲染已经吃这个形状（field + message，
     *    见 routes/resources.ts），复用意味着前端**不需要**为视频链接
     *    写第二条分支 —— 而多出来的每条分支都是将来会漂移的一份规则。
     *
     * 文案要点名最常见的那种失败：用户粘的往往是**频道/播放列表/合集首页**，
     * 那是"看起来完全正确的一条链接"。只说"链接不合法"会让他反复检查
     * 自己复制得对不对，而问题在别处。
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
  const result = createVideo({
    userId: user.id,
    platform: link.platform,
    videoId: link.videoId,
    title: parsed.data.title,
    startOffsetSec: parsed.data.startOffsetSec ?? null,
    now,
  });

  if (!result.ok) {
    /*
     * 一个**明确的** 409，不是 500。
     *
     * 数据库上的 UNIQUE(platform, video_id) 保证同一个视频只被贴一次
     * （热门比赛录像一定会被好几个人同时贴，视频墙上出现两遍是纯噪音）。
     * 第二个人的请求是完全正常的，他需要一句能看懂的话、而不是"服务器出错了"
     * —— 所以这里把"属于哪一种"直接算好一起返回，前端**不需要**自己有判断逻辑
     * （和 routes/resources.ts 的 url_exists 是同一条教训）：
     *
     *   · status = 'visible' → 已经在站上了，给 id 让他去看那一条
     *   · status = 'hidden'  → 在站上出现过、现在被隐藏了，这不是"重复提交"
     *   · existingMine       → 是自己之前贴的
     */
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

  /*
   * 提交也记审计 —— 视频**没有审核记录**，audit_log 是"这个视频是谁什么时候
   * 贴上来的"唯一留痕（资源库那边至少有 revisions 表兜着）。
   */
  writeAudit({
    actorId: user.id,
    action: 'video.submit',
    entityType: 'video',
    entityId: result.video.id,
    reason: `${link.platform} ${link.videoId}`,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  return c.json(
    {
      ok: true,
      video: result.video,
      /*
       * ⚠️ 显式告诉前端"这个平台的起始偏移**不会生效**"。
       *
       * B站嵌入没有官方的跳转参数（shared/videos.ts 的 buildEmbedUrl 会
       * 直接忽略它）。静默丢掉才是最差的做法：用户填了 1:02:33、播放器却
       * 从 0 开始，他会以为链接坏了 —— 迁移 010 里就是为此留了话。
       *
       * 服务端**照样把这个值存下来**：那是用户提供的数据，而且它本身没错
       * （YouTube / Twitch 都需要它）。要不要在界面上提示，由这一行决定。
       *
       * 判定读 shared 的 `platformSupportsStartOffset`，不在这里写
       * `platform === 'youtube' || ...`：那张"哪个平台支持跳转"的表
       * 和 `buildEmbedUrl` 在同一个文件里，两处各写一遍必然漂移 ——
       * 而漂移的表现是"界面说支持、播放器不跳"，没有人会把它当成 bug 报上来。
       */
      startOffsetSupported: platformSupportsStartOffset(link.platform),
    },
    201,
  );
});

// ---------------------------------------------------------------------------
// 事后手段：删除（作者）与隐藏（治理者）
// ---------------------------------------------------------------------------

/**
 * 删除一个视频。
 *
 * 两种身份，**两条不同的路径**，而且要如实告诉调用方走的是哪一条：
 *   · **作者本人** → 真删（DELETE）。他要的就是"把我的帖子拿掉"。
 *   · **有 `resource.moderate` 的人**（不是作者）→ 隐藏，可逆，而且作者
 *     在「我贴的」里仍然看得见它。
 *
 * 为什么不给治理者真删的权力：删除不可撤销，还会把"这个视频被贴上来过、
 * 后来被拿掉了"这件事一起抹掉 —— 审计里那条记录会指向一个查不到的行。
 * 内容治理要的是"让它从公开视野里消失"，那是隐藏能做的事。
 *
 * ⚠️ 判定顺序是**先作者后治理者**：管理员删自己贴的视频走真删。
 *    一个能治理全站的人，对自己那一条没有理由反而更弱。
 *
 * 响应里的 `mode` 就是这个区别：前端据此说"已删除"还是"已隐藏"——
 * 这两句话对用户的意义不同（一个是"我的帖子没了"，一个是"这条被下架了，
 * 但作者那边还在"），而不说的话前端只能自己猜身份。
 */
videosRoute.delete('/videos/:id', requireAuth, (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const id = c.req.param('id');
  // ⚠️ getVideo 而不是"只在 visible 里找"：作者要删的、治理者要隐藏的，
  //    完全可能就是一条**已经被隐藏**的视频。按状态过滤的表现是
  //    "删不掉一条自己看得见的东西"，而错误码看起来像 id 传错了。
  const video = getVideo(id);
  if (!video) return c.json({ error: 'not_found' }, 404);

  const isAuthor = video.userId === user.id;
  const actor: Actor = {
    role: user.role as UserRole,
    emailVerified: user.email_verified_at !== null,
  };
  const canModerate = checkPermission(actor, 'resource.moderate').ok;

  if (!isAuthor && !canModerate) {
    /*
     * 403 而不是 404：视频是**公开**内容，它的存在本身不是秘密
     * （视频墙里人人看得见），所以藏起"它存在"没有任何意义。
     * 这里带上 capability，和 requireCapability 的 403 形状一致 ——
     * 前端读同一份形状，不必为手动判定写第二条解析。
     */
    return c.json({ error: 'forbidden', capability: 'resource.moderate' }, 403);
  }

  const now = Date.now();
  const ip = c.req.header('x-real-ip') ?? null;
  const reason = `${video.platform} ${video.videoId}`;

  if (isAuthor) {
    /*
     * ⚠️ 检查返回值，而且**删不到就不写审计**。
     *
     * `deleteVideo` 明确返回"到底删掉没有"（数据层注释说"调用方据此区分
     * '删掉了'和'这一刻它已经不在了'"），但这里原来把它丢掉了 ——
     * 于是两个并发 DELETE 都先通过了上面的 `getVideo`、只有一个真的删掉，
     * 另一个却照样回 `ok: true` 并留下一条 `video.delete` 审计。
     * 审计说的是"谁删了什么"，记录一次没有发生的删除，比少记一条更糟。
     *
     * ⚠️ 下面治理者那一支**是**检查返回值的（`hidden.ok`）。同一个函数里
     *    两条并行的分支一个有检查一个没有，读代码的人会以为两条都查过。
     *
     * 回 `changed: false` 而不是 404：用户要的结果（这个视频不在了）已经达成，
     * 而 404 会让他以为自己做错了什么。
     */
    const removed = deleteVideo(id);
    if (!removed) return c.json({ ok: true, id, mode: 'deleted', changed: false });

    writeAudit({
      actorId: user.id,
      action: 'video.delete',
      entityType: 'video',
      entityId: id,
      reason,
      ip,
      now,
    });
    return c.json({ ok: true, id, mode: 'deleted', changed: true });
  }

  const hidden = setVideoVisibility(id, 'hidden', now);
  // 上面刚读过这一行，理论上这里不会失败；真到不了这里也按 404 处理而不是 500。
  if (!hidden.ok) return c.json({ error: 'not_found' }, 404);

  /*
   * ⚠️ 空操作（它已经是 hidden 了）**不写审计**。
   *
   * 理由和上面作者那一支完全一样：审计说的是"谁把什么改成了什么"，
   * 而这里什么都没改。记一条没有发生的隐藏，事后追查时会指向一个
   * 不存在的动作 —— 那比少记一条更糟。
   *
   * 回 `changed: false` 而不是 409：这个动作的语义是**setter**
   * （"把它设成 hidden"），不是"翻转一下"。要的结果已经达成了，
   * 报错只会让界面显示一句用户无法处理的红字。
   * 这个取舍和资源库那边刻意不同，见数据层 setVideoVisibility 的注释。
   */
  if (hidden.changed) {
    writeAudit({
      actorId: user.id,
      action: 'video.hide',
      entityType: 'video',
      entityId: id,
      reason: `${reason}（作者 ${video.userId}）`,
      ip,
      now,
    });
  }

  return c.json({ ok: true, id, mode: 'hidden', changed: hidden.changed });
});

/**
 * 隐藏 / 恢复。只有 `resource.moderate`（editor 及以上）能调。
 *
 * ⚠️ 作者**没有**这个接口。他不需要一个"隐藏自己的帖子"的动作 ——
 *    他要的是删掉。留着两个都能让"自己的帖子消失"的动作，会让人选错，
 *    而它们的效果并不一样（隐藏是治理动作，能被治理者恢复）。
 *
 * 空操作（把状态设成它已经是的值）返回**成功** + `changed: false`，
 * 理由写在数据层 setVideoVisibility 的注释里（和资源库那边刻意不同）。
 */
videosRoute.patch('/videos/:id/visibility', requireCapability('resource.moderate'), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = VideoVisibilitySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  }

  const id = c.req.param('id');
  const now = Date.now();
  const result = setVideoVisibility(id, parsed.data.status, now);
  if (!result.ok) return c.json({ error: 'not_found' }, 404);

  writeAudit({
    actorId: user.id,
    action: parsed.data.status === 'hidden' ? 'video.hide' : 'video.restore',
    entityType: 'video',
    entityId: id,
    reason: result.changed
      ? `status=${parsed.data.status}`
      : `status=${parsed.data.status}（本来就是）`,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });

  return c.json({ ok: true, id, status: result.status, changed: result.changed });
});
