/**
 * 视频版块的接口测试。
 *
 * ---------------------------------------------------------------------------
 * 这组用例在防什么
 * ---------------------------------------------------------------------------
 * 视频这块的所有规则都有一个共同特点：**违反了也不会报错**。
 *
 *   · 被隐藏的视频如果还在公开列表里，页面上会出现一个指向已隐藏视频的空壳
 *     （标题、作者、占位框都在，只是没有画面）—— 没有任何报错，看起来
 *     就像"这个视频加载慢"；
 *   · 重复视频如果靠 UNIQUE 约束抛异常，用户拿到的是 500「出错了」，
 *     而他做的事（贴一个别人已经贴过的热门录像）完全是正常的；
 *   · 删除和隐藏如果搞反了，治理者会把别人的帖子真删掉 —— 而那是**不可撤销**的；
 *   · 公开列表如果多带了一个 users 的字段，从响应上根本看不出来。
 *
 * 所以下面每条用例都断言**具体的行为**，尤其是那几条"看起来都成功了"的差别
 * （真删 vs 隐藏、我贴的 vs 视频墙、visible vs hidden）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 路由挂载：`app.route('/api', videosRoute)`
 * ---------------------------------------------------------------------------
 * index.ts 的改动由接手挂载路由的人做（本模块被限定为三个文件），
 * 所以这个文件自己把它挂到**真实的 app** 上：限流、sameOriginOnly、loadUser、
 * 默认 Cache-Control 都在那个实例上 —— 在测试里另建一个 Hono 就一条都测不到。
 *
 * 这里用的是带 `if` 的挂载，原因是它要对三种状态都成立：
 *   · index.ts 还没挂 → 自己挂上，用例能跑
 *   · index.ts 已经按 `app.route('/api', videosRoute)` 挂好了 → 跳过
 *     （重复挂载其实不会出错：同名路由先注册的先匹配，但没必要注册两遍）
 *   · index.ts **挂错了位置** → 跳过，然后下面那条"挂载契约"用例给出明确的
 *     失败信息，而不是让十几条用例一起报 404（那看起来像接口没实现）
 */
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.MCSR_MAIL_DRIVER = 'console';
process.env.MCSR_SCRYPT_TEST_PARAMS = 'N=1024,r=8,p=1';

const { app } = await import('./index');
const { closeDb, getDb } = await import('./db');
const { videosRoute } = await import('./routes/videos');
const { resetAll } = await import('./auth/ratelimit');
const { SITE } = await import('@mcsr/shared');

if (!app.routes.some((r) => r.path.startsWith('/api/videos'))) {
  app.route('/api', videosRoute);
}

const PASSWORD = 'a good long passphrase';

after(() => closeDb());
beforeEach(() => resetAll());

interface Res {
  status: number;
  body: Record<string, unknown>;
  setCookie: string | null;
}

async function call(
  method: string,
  path: string,
  options: { json?: unknown; cookie?: string } = {},
): Promise<Res> {
  const headers: Record<string, string> = { origin: SITE.productionOrigin };
  if (options.json !== undefined) headers['content-type'] = 'application/json';
  if (options.cookie) headers.cookie = options.cookie;

  const response = await app.request(path, {
    method,
    headers,
    ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : {}),
  });
  const raw = response.headers.getSetCookie?.() ?? [];
  return {
    status: response.status,
    body: (await response.json().catch(() => ({}))) as Record<string, unknown>,
    setCookie: raw[0] ?? null,
  };
}

let seq = 0;

/**
 * 造一个登录用户。
 *
 * ⚠️ 顺序不能改：**未验证邮箱现在登不进来**（"邮箱验证 = 注册完成"，
 *    见 verify-required.test.ts），所以必须先注册、再把 email_verified_at
 *    补上，然后才登录。先登录再补验证的话，登录那一步就已经 403 了。
 */
async function makeUser(role: 'user' | 'reviewer' | 'editor' = 'user') {
  seq += 1;
  const email = `video${String(seq)}.${Date.now()}@example.com`;
  const displayName = `贴视频的人${String(seq)}`;
  await call('POST', '/api/auth/register', {
    json: { email, password: PASSWORD, displayName, locale: 'zh-CN' },
  });
  getDb()
    .prepare('UPDATE users SET email_verified_at = ?, role = ? WHERE email = ?')
    .run(Date.now(), role, email);

  const login = await call('POST', '/api/auth/login', { json: { email, password: PASSWORD } });
  assert.equal(login.status, 200, '登录失败的话后面所有用例都会以 401 的样子失败');

  const row = getDb().prepare('SELECT id FROM users WHERE email = ?').get(email) as {
    id: string;
  };
  return {
    email,
    displayName,
    id: row.id,
    cookie: (login.setCookie ?? '').split(';')[0] as string,
  };
}

/**
 * 每条视频的 ID 都必须**全局唯一**。
 *
 * UNIQUE(platform, video_id) 是表级约束，而同一个文件里的用例共用一个内存库 ——
 * 用固定 ID 的话第二条用例会被"重复视频"挡住，而失败信息看起来像
 * 提交逻辑坏了，其实是测试脚手架自己的问题。
 */
function nextYoutubeId(): string {
  seq += 1;
  return `yt${String(seq).padStart(9, '0')}`; // 11 位，正好是 YouTube ID 的形状
}

function nextBilibiliId(): string {
  seq += 1;
  return `BV1xx${String(seq).padStart(7, '0')}`; // BV + 10 位
}

const ytUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const biliUrl = (id: string) => `https://www.bilibili.com/video/${id}`;

/**
 * 直接写库造一行视频。
 *
 * 走接口也能造，但**不能控制 created_at** —— 而"按时间倒序"和"翻页不重不漏"
 * 这两条只有时间戳是确定的时候才断言得了（同一毫秒里贴出来的两条，
 * 顺序只能靠 id 兜底，见数据层的 ORDER BY）。
 */
function seedVideo(input: {
  userId: string;
  videoId: string;
  title: string;
  createdAt: number;
  status?: 'visible' | 'hidden';
  platform?: 'bilibili' | 'youtube' | 'twitch';
  startOffsetSec?: number | null;
}): string {
  seq += 1;
  const id = `video-seed-${String(seq)}`;
  getDb()
    .prepare(
      `INSERT INTO videos
         (id, user_id, platform, video_id, title, start_offset_sec, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.userId,
      input.platform ?? 'youtube',
      input.videoId,
      input.title,
      input.startOffsetSec ?? null,
      input.status ?? 'visible',
      input.createdAt,
      input.createdAt,
    );
  return id;
}

/**
 * 直接读那一行来断言"库里到底发生了什么"。
 *
 * ⚠️ 展开成普通对象字面量：node:sqlite 的行对象原型不是 Object.prototype，
 *    而 deepStrictEqual 会比较原型 —— 直接返回行的话两边打印出来一模一样，
 *    断言却失败。
 */
function videoRowOf(id: string): {
  status: string;
  title: string;
  user_id: string;
  start_offset_sec: number | null;
} | null {
  const row = getDb()
    .prepare('SELECT status, title, user_id, start_offset_sec FROM videos WHERE id = ?')
    .get(id) as
    | { status: string; title: string; user_id: string; start_offset_sec: number | null }
    | undefined;
  if (!row) return null;
  return {
    status: row.status,
    title: row.title,
    user_id: row.user_id,
    start_offset_sec: row.start_offset_sec,
  };
}

/** 某条视频在审计里留下的动作。删除 / 隐藏必须留痕 —— 见 routes/videos.ts。 */
function auditActionsOf(entityId: string): string[] {
  const rows = getDb()
    .prepare('SELECT action FROM audit_log WHERE entity_id = ? ORDER BY created_at ASC')
    .all(entityId) as unknown as Array<{ action: string }>;
  return rows.map((r) => r.action);
}

interface Item {
  id: string;
  userId: string;
  authorName: string | null;
  platform: string;
  videoId: string;
  title: string;
  startOffsetSec: number | null;
  status: string;
  createdAt: number;
}

const itemsOf = (body: Record<string, unknown>): Item[] => body.items as Item[];

describe('★ 视频（M4）：贴链接 / 视频墙 / 删除与隐藏', () => {
  it('★ 路由挂在约定的位置（挂载方式就是交付契约）', () => {
    /*
     * 这条用例存在的唯一理由：挂载点**不在**这个模块里。
     * 一旦挂错（比如把带 /videos 前缀的路由又挂到 /api/videos 上），
     * 其余用例会集体 404，而 404 看起来像"接口还没实现"——
     * 那时候没有人会想到问题出在 index.ts 的那一行。
     */
    const paths = app.routes.map((r) => `${r.method} ${r.path}`);
    assert.ok(
      paths.includes('POST /api/videos') && paths.includes('GET /api/videos/mine'),
      `视频路由没有挂在 app.route('/api', videosRoute) 上；当前与视频有关的路径是：` +
        `${paths.filter((p) => p.includes('video')).join(' / ') || '(一条都没有)'}`,
    );
  });

  it('未登录不能贴（401），也不能看我贴的', async () => {
    const videoId = nextYoutubeId();

    const post = await call('POST', '/api/videos', {
      json: { url: ytUrl(videoId), title: '没登录就想贴' },
    });
    assert.equal(post.status, 401);
    assert.equal(post.body.error, 'unauthorized');

    const mine = await call('GET', '/api/videos/mine');
    assert.equal(mine.status, 401);

    // 反面断言：被拒的请求绝不能留下数据 —— 401 之后库里多出一行是最糟的结果，
    // 因为用户以为失败了，而内容其实进去了。
    const row = getDb()
      .prepare('SELECT COUNT(*) AS n FROM videos WHERE video_id = ?')
      .get(videoId) as {
      n: number;
    };
    assert.equal(row.n, 0, '401 的请求不该写进任何东西');
  });

  it('★ 邮箱未验证不能贴（403 email_not_verified），验证之后立刻就能', async () => {
    const user = await makeUser();
    const videoId = nextYoutubeId();

    // 把验证状态撤掉，模拟"邮件还没点"的那个人（未验证其实是登不进来的，
    // 所以只能这样造出那个状态 —— 而 requireCapability 读的是**每次请求
    // 重新加载的用户行**，所以这个状态一样会被它挡住）。
    getDb().prepare('UPDATE users SET email_verified_at = NULL WHERE id = ?').run(user.id);

    const denied = await call('POST', '/api/videos', {
      json: { url: ytUrl(videoId), title: '还没验证就来贴' },
      cookie: user.cookie,
    });
    assert.equal(denied.status, 403);
    assert.equal(
      denied.body.error,
      'email_not_verified',
      '必须是 email_not_verified，不能和 forbidden 合并 —— 两者对用户的下一步完全不同',
    );

    // 验证之后同一条链接就能贴了：这条反面断言证明上面那个 403 说的是
    // "你还没验证"，而不是"这条链接有什么问题"。
    getDb().prepare('UPDATE users SET email_verified_at = ? WHERE id = ?').run(Date.now(), user.id);
    const allowed = await call('POST', '/api/videos', {
      json: { url: ytUrl(videoId), title: '验证完就来贴' },
      cookie: user.cookie,
    });
    assert.equal(allowed.status, 201, JSON.stringify(allowed.body));
  });

  it('非法链接给 400，并且错误落在 url 这个字段上', async () => {
    const user = await makeUser();

    /*
     * 三种非法，最后一种是最常见的真实情况：用户从频道页、播放列表页
     * 复制了链接 —— 那看起来是一条**完全正确**的链接，只是里面没有视频 ID。
     */
    const bad = [
      '这不是一个链接',
      'https://example.com/video/123',
      'https://www.bilibili.com/', // 频道首页：有平台、没有视频
      'https://www.youtube.com/playlist?list=PLabcdefghijklmnop', // 播放列表：有 host、没有 v
    ];

    for (const url of bad) {
      const res = await call('POST', '/api/videos', {
        json: { url, title: '标题是好的' },
        cookie: user.cookie,
      });
      assert.equal(res.status, 400, `${url} 应当被拒（拿到的是 ${String(res.status)}）`);
      assert.equal(res.body.error, 'invalid_input', '解析失败复用表单那套 invalid_input + issues');

      const issues = res.body.issues as Array<{ field: string; message: string }>;
      assert.ok(Array.isArray(issues) && issues.length > 0, '必须给出字段级的错误');
      assert.equal(issues[0]?.field, 'url', '错误要落在 url 上，前端才知道把红字放在哪个输入框');
      assert.ok(
        (issues[0]?.message ?? '').includes('视频'),
        `文案要说清楚"读不出视频 ID"这件事，实际是：${issues[0]?.message ?? ''}`,
      );
    }

    // 标题为空是另一条字段错误（不能只说"输入有误"）
    const noTitle = await call('POST', '/api/videos', {
      json: { url: ytUrl(nextYoutubeId()) },
      cookie: user.cookie,
    });
    assert.equal(noTitle.status, 400);
    assert.equal((noTitle.body.issues as Array<{ field: string }>)[0]?.field, 'title');
  });

  it('★ 贴完就是 visible —— 视频不进审核队列（Q6）', async () => {
    const user = await makeUser();
    const videoId = nextYoutubeId();

    const res = await call('POST', '/api/videos', {
      json: { url: ytUrl(videoId), title: '一场很精彩的比赛录像', startOffsetSec: 90 },
      cookie: user.cookie,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const video = res.body.video as Item;
    assert.equal(video.status, 'visible', '贴完立刻可见，没有 pending 这一档');
    assert.equal(video.platform, 'youtube');
    assert.equal(video.videoId, videoId, '服务端从链接里解析出来的 ID 必须原样存下来');
    assert.equal(video.title, '一场很精彩的比赛录像');
    assert.equal(video.startOffsetSec, 90);
    assert.equal(video.userId, user.id);
    assert.equal(video.authorName, user.displayName, '作者名来自 users.display_name');

    // 库里也必须是 visible，而不是接口层"看起来"可见
    assert.equal(videoRowOf(video.id)?.status, 'visible');

    // 提交留痕：视频**没有审核记录**，audit_log 是唯一的痕迹
    assert.deepEqual(auditActionsOf(video.id), ['video.submit']);

    // 立刻就在公开视频墙上（url / title / startOffsetSec 三件都进了库）
    const wall = await call('GET', `/api/videos?authorId=${user.id}`);
    assert.equal(itemsOf(wall.body).find((i) => i.id === video.id)?.title, '一场很精彩的比赛录像');
  });

  it('★ B站的起始偏移：照样存下来，但显式告诉前端"这个平台不跳转"', async () => {
    const user = await makeUser();
    const videoId = nextBilibiliId();

    const res = await call('POST', '/api/videos', {
      json: { url: biliUrl(videoId), title: 'B站的视频', startOffsetSec: 3753 },
      cookie: user.cookie,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(
      res.body.startOffsetSupported,
      false,
      'B站嵌入没有官方跳转参数，界面要据此提示用户',
    );

    const video = res.body.video as Item;
    // 静默丢掉才是最差的做法：用户填了时间、播放器却从 0 开始，他会以为链接坏了
    assert.equal(video.startOffsetSec, 3753, '值要存下来，只是嵌入时用不上');
    assert.equal(videoRowOf(video.id)?.start_offset_sec, 3753);
  });

  it('★ 重复视频给明确的 video_exists（409），不是 500', async () => {
    const first = await makeUser();
    const second = await makeUser();
    const videoId = nextYoutubeId();
    const payload = { url: ytUrl(videoId), title: '同一个录像' };

    const created = await call('POST', '/api/videos', { json: payload, cookie: first.cookie });
    assert.equal(created.status, 201);
    const firstId = (created.body.video as Item).id;

    // 别人再贴同一个视频 —— 这是完全正常的操作（热门录像会被好几个人贴）
    const dup = await call('POST', '/api/videos', { json: payload, cookie: second.cookie });
    assert.equal(
      dup.status,
      409,
      `重复必须是 409，实际 ${String(dup.status)}：${JSON.stringify(dup.body)}`,
    );
    assert.equal(dup.body.error, 'video_exists', '不能是通用的 internal_error');
    assert.equal(dup.body.existingId, firstId, '要给出已有的那一条，前端才给得了"去看它"的链接');
    assert.equal(dup.body.existingTitle, '同一个录像');
    assert.equal(dup.body.existingStatus, 'visible');
    assert.equal(dup.body.existingMine, false, '别人的帖子不能说成是自己的');

    // 同一个人再贴一次：要说成"你自己贴过"
    const mineDup = await call('POST', '/api/videos', { json: payload, cookie: first.cookie });
    assert.equal(mineDup.body.existingMine, true);

    // 且只留下了一行 —— UNIQUE 约束没有被绕过
    const count = getDb()
      .prepare('SELECT COUNT(*) AS n FROM videos WHERE video_id = ?')
      .get(videoId) as { n: number };
    assert.equal(count.n, 1);
  });

  it('★ 已经被隐藏的视频再被贴一次，仍然是「重复」而不是 500', async () => {
    /*
     * ---------------------------------------------------------------------------
     * 这条分支原来一条测试都没有 —— 而代码里为它写了三段注释
     * ---------------------------------------------------------------------------
     * 数据层 `findVideoByPair` **故意不过滤 status**（注释专门讲了这件事），
     * 路由层也为 `existingStatus: 'hidden'` 写了三分支推理。但没有任何用例
     * 在"已有行是 hidden"的前提下重新提交同一个 URL。
     *
     * 为什么它值得单独一条：`UNIQUE(platform, video_id)` 是**表级**约束，
     * 对一个隐藏的行照样生效。所以如果哪天有人"顺手"给查询加上
     * `AND status = 'visible'`（看起来完全合理：隐藏了就不算存在），
     * 那么隐藏过的视频再被贴一次会变成：
     *   预查查不到 → INSERT 撞 UNIQUE → catch 里再查还是查不到 → rethrow → 500
     * 用户看到的是一句"服务器出错了"，而他做的事完全正常。
     *
     * 而且这个字段是**可操作**的：视频墙上是没有它了，但作者自己还看得见
     * （`listOwnVideos` 不过滤状态），所以前端要能说"这条被下架了，去看它"，
     * 而不是笼统的"已经有人贴过了"。
     */
    const author = await makeUser();
    const moderator = await makeUser('editor');
    const other = await makeUser();
    const videoId = nextYoutubeId();
    const payload = { url: ytUrl(videoId), title: '被下架的录像' };

    const created = await call('POST', '/api/videos', { json: payload, cookie: author.cookie });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = (created.body.video as Item).id;

    // 治理者把它隐藏（不是作者删掉 —— 那行还在，只是不可见）
    const hidden = await call('DELETE', `/api/videos/${id}`, { cookie: moderator.cookie });
    assert.equal(hidden.status, 200, JSON.stringify(hidden.body));
    assert.equal(hidden.body.mode, 'hidden');
    assert.equal(videoRowOf(id)?.status, 'hidden');

    // 另一个人再贴同一个视频
    const dup = await call('POST', '/api/videos', { json: payload, cookie: other.cookie });
    assert.equal(
      dup.status,
      409,
      `隐藏过的视频再被贴一次必须是 409，实际 ${String(dup.status)}：${JSON.stringify(dup.body)}`,
    );
    assert.equal(dup.body.error, 'video_exists', '绝不能是 internal_error');
    assert.equal(dup.body.existingId, id);
    assert.equal(
      dup.body.existingStatus,
      'hidden',
      '前端要靠它区分"已被下架，去看它"和"有人贴过了"',
    );

    // 而且没有多出一行 —— 隐藏不能成为绕过 UNIQUE 的后门
    const count = getDb()
      .prepare('SELECT COUNT(*) AS n FROM videos WHERE video_id = ?')
      .get(videoId) as { n: number };
    assert.equal(count.n, 1, '隐藏的行照样占着 UNIQUE(platform, video_id)');
  });

  it('★ 作者重复点删除：第二次是 changed:false，且不再写一条 video.delete', async () => {
    /*
     * `deleteVideo` 明确返回"到底删掉没有"，数据层的注释也写着
     * "调用方据此区分'删掉了'和'这一刻它已经不在了'"—— 但路由原来把这个
     * 返回值丢掉了。于是两个并发 DELETE 都先通过了上面的 getVideo、
     * 只有一个真的删掉，另一个照样回 ok:true 并留下一条 `video.delete` 审计。
     *
     * 审计说的是"谁删了什么"，**记录一次没有发生的删除比少记一条更糟** ——
     * 事后追查时它会指向一个根本没发生过的动作。
     *
     * 回 changed:false 而不是 404：用户要的结果（这个视频不在了）已经达成，
     * 给 404 会让他以为自己操作错了。
     */
    const author = await makeUser();
    const videoId = nextYoutubeId();
    const created = await call('POST', '/api/videos', {
      json: { url: ytUrl(videoId), title: '删两次' },
      cookie: author.cookie,
    });
    const id = (created.body.video as Item).id;

    const first = await call('DELETE', `/api/videos/${id}`, { cookie: author.cookie });
    assert.equal(first.status, 200);
    assert.equal(first.body.changed, true);
    // 贴的时候也留了一条视频审计 —— 所以断言的是"删除只留了一条"，不是"只有一条审计"
    assert.deepEqual(auditActionsOf(id), ['video.submit', 'video.delete']);

    // 第二次：行已经不在了 → 上面 getVideo 会 404，这是既有行为（测试钉住了）。
    // 这条用例真正守的是"没有第二次审计"，也就是不会出现两条 video.delete。
    const second = await call('DELETE', `/api/videos/${id}`, { cookie: author.cookie });
    assert.equal(second.status, 404);
    assert.deepEqual(
      auditActionsOf(id),
      ['video.submit', 'video.delete'],
      '一次删除只能留一条 video.delete —— 记录一次没有发生的删除比少记一条更糟',
    );

    // 换成"行还在但已经是 hidden"的情形：治理者再隐藏一次 = 空操作，
    // 这时既不该改状态，也不该再记一条 video.hide
    const moderator = await makeUser('editor');
    const other = await makeUser();
    const kept = await call('POST', '/api/videos', {
      json: { url: ytUrl(nextYoutubeId()), title: '留着隐藏两次' },
      cookie: other.cookie,
    });
    const keptId = (kept.body.video as Item).id;

    const hideOne = await call('DELETE', `/api/videos/${keptId}`, { cookie: moderator.cookie });
    assert.equal(hideOne.status, 200);
    assert.equal(hideOne.body.changed, true);

    const hideTwo = await call('DELETE', `/api/videos/${keptId}`, { cookie: moderator.cookie });
    assert.equal(hideTwo.status, 200);
    assert.equal(hideTwo.body.changed, false, '已经是 hidden 了，这一下没有改变任何东西');
    assert.deepEqual(
      auditActionsOf(keptId),
      ['video.submit', 'video.hide'],
      '空操作不该留第二条 video.hide',
    );
  });

  it('公开列表容忍空的 authorId（前端清空筛选时发出来的就是空串）', async () => {
    /*
     * `?authorId=` 的意思是"没筛选"。加了 `.min(1)` 会让它变成 400，
     * 而用户看到的是"查询参数不合法"，指不到"你把筛选清空了"上。
     *
     * 同类的 `tag` / `q`（shared/resources.ts）都没有 `.min(1)`，
     * 所以发空串的调用方在别的列表端点上是能过的 —— 只有这个端点会 400，
     * 那正是"同一个前端在两页之间行为不一致"的来源。
     *
     * ⚠️ 只测 authorId。`?platform=`（空串）**仍然**是 400，而且那是对的：
     *    platform 是一个封闭枚举，空串不是它任何一个合法取值，
     *    而"没选平台"在前端是不发这个参数（见 lib/api.ts 的 buildResourceQuery）。
     *    把它也放行等于让"非法枚举值"和"没筛选"变成同一个输入。
     */
    const res = await call('GET', '/api/videos?authorId=');
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });

  it('★ 公开视频墙：只出 visible、按时间倒序、hidden 连数据都不下发', async () => {
    const user = await makeUser();
    const t0 = Date.now();
    const older = seedVideo({
      userId: user.id,
      videoId: nextYoutubeId(),
      title: '先贴的',
      createdAt: t0,
    });
    const middle = seedVideo({
      userId: user.id,
      videoId: nextYoutubeId(),
      title: '后贴的',
      createdAt: t0 + 1000,
    });
    const newer = seedVideo({
      userId: user.id,
      videoId: nextYoutubeId(),
      title: '最新贴的',
      createdAt: t0 + 2000,
    });
    const hidden = seedVideo({
      userId: user.id,
      videoId: nextYoutubeId(),
      title: '被隐藏的',
      createdAt: t0 + 3000,
      status: 'hidden',
    });

    /*
     * ⚠️ 按作者过滤再断言 total。
     *    同一个文件里的用例共用一个内存库，别处贴的视频也在墙上 ——
     *    不过滤的话 total 会随用例执行顺序变化，而失败信息看起来像筛选写错了。
     */
    const res = await call('GET', `/api/videos?authorId=${user.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 3, '被隐藏的那条不计入 total');
    assert.deepEqual(
      itemsOf(res.body).map((i) => i.id),
      [newer, middle, older],
      '按贴出来的时间倒序（最新的在最上面）',
    );

    // ★ 隐藏意味着**响应体里根本没有它**：只是前端不渲染 iframe 的话，
    //   页面上会留下一个指向已隐藏视频的空壳。
    assert.ok(
      !JSON.stringify(res.body).includes(hidden),
      '★ 被隐藏的视频绝不能出现在公开响应里（连 id 都不该有）',
    );
    assert.ok(!itemsOf(res.body).some((i) => i.status !== 'visible'));

    // 但库里那一行还在 —— 隐藏不是删除，作者的处理意见见下一条用例
    assert.equal(videoRowOf(hidden)?.status, 'hidden', '隐藏是改状态，不是删行');
  });

  it('公开列表：platform / authorId 筛选 + 分页形状照抄资源库', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const t0 = Date.now();

    const aBili = seedVideo({
      userId: a.id,
      platform: 'bilibili',
      videoId: nextBilibiliId(),
      title: 'A 的 B站视频',
      createdAt: t0,
    });
    // 这两条**故意用同一个时间戳**：同一毫秒贴出来的行，顺序只能由 id 兜底，
    // 而那正是"翻页时记录重复出现或被整页跳过"的来源。
    const aYt1 = seedVideo({
      userId: a.id,
      videoId: nextYoutubeId(),
      title: 'A 的油管视频 1',
      createdAt: t0 + 500,
    });
    const aYt2 = seedVideo({
      userId: a.id,
      videoId: nextYoutubeId(),
      title: 'A 的油管视频 2',
      createdAt: t0 + 500,
    });
    const bYt = seedVideo({
      userId: b.id,
      videoId: nextYoutubeId(),
      title: 'B 的油管视频',
      createdAt: t0 + 900,
    });

    const byPlatform = await call('GET', '/api/videos?platform=youtube');
    const ytIds = itemsOf(byPlatform.body).map((i) => i.id);
    assert.ok(ytIds.includes(aYt1) && ytIds.includes(aYt2) && ytIds.includes(bYt));
    assert.ok(!ytIds.includes(aBili), 'platform 筛选要真的生效');

    const byAuthor = await call('GET', `/api/videos?authorId=${a.id}`);
    assert.deepEqual(
      itemsOf(byAuthor.body)
        .map((i) => i.id)
        .sort(),
      [aBili, aYt1, aYt2].sort(),
      'authorId 筛选只出这个人的',
    );

    // 分页形状与资源库列表**完全一致**（items / total / page / pageSize）
    assert.deepEqual(Object.keys(byAuthor.body).sort(), ['items', 'page', 'pageSize', 'total']);

    const page1 = await call('GET', `/api/videos?authorId=${a.id}&pageSize=2&page=1`);
    const page2 = await call('GET', `/api/videos?authorId=${a.id}&pageSize=2&page=2`);
    assert.equal(page1.body.page, 1);
    assert.equal(page1.body.pageSize, 2);
    assert.equal(page1.body.total, 3, 'total 是筛选后的总数，不是这一页的条数');
    assert.equal(itemsOf(page1.body).length, 2);
    assert.equal(itemsOf(page2.body).length, 1);
    assert.deepEqual(
      [...itemsOf(page1.body), ...itemsOf(page2.body)].map((i) => i.id).sort(),
      [aBili, aYt1, aYt2].sort(),
      '★ 两页合起来不重不漏 —— 同毫秒创建时顺序不稳定的话，这里会漏掉一条',
    );

    // 参数非法时是 400 invalid_query（和资源库同一套），不是静默当成默认值
    for (const q of ['page=0', 'pageSize=0', 'pageSize=101', 'platform=vimeo', 'page=abc']) {
      const bad = await call('GET', `/api/videos?${q}`);
      assert.equal(bad.status, 400, `?${q} 应当被拒`);
      assert.equal(bad.body.error, 'invalid_query');
    }
  });

  it('★ 公开列表不夹带用户隐私字段（只有 userId 和作者名）', async () => {
    const user = await makeUser();
    const t0 = Date.now();
    const videoId = nextYoutubeId();
    const id = seedVideo({
      userId: user.id,
      videoId,
      title: '形状检查用',
      createdAt: t0,
      startOffsetSec: 15,
    });

    const res = await call('GET', `/api/videos?authorId=${user.id}`);
    const item = itemsOf(res.body).find((i) => i.id === id);
    assert.ok(item, '刚造的那条应当在墙上');

    /*
     * ★ 逐字段比对**完整形状**，而不是"有没有 email"。
     *   多带任何字段（updated_at、email、password_hash……）都会让这条失败 ——
     *   只查 email 的话，多带出来的 mc_uuid 之类的字段没人会发现。
     */
    assert.deepEqual(item, {
      id,
      userId: user.id,
      authorName: user.displayName,
      platform: 'youtube',
      videoId,
      title: '形状检查用',
      startOffsetSec: 15,
      status: 'visible',
      createdAt: t0,
    });

    const raw = JSON.stringify(res.body);
    assert.ok(!raw.includes(user.email), '★ 公开响应里绝不能出现任何人的邮箱');
    assert.ok(!raw.includes('password_hash'));
  });

  it('★ 作者能删自己的（真删），删完墙上和我贴的里都没有了', async () => {
    const user = await makeUser();
    const created = await call('POST', '/api/videos', {
      json: { url: ytUrl(nextYoutubeId()), title: '马上就会被删掉' },
      cookie: user.cookie,
    });
    const id = (created.body.video as Item).id;

    const del = await call('DELETE', `/api/videos/${id}`, { cookie: user.cookie });
    assert.equal(del.status, 200, JSON.stringify(del.body));
    assert.equal(del.body.mode, 'deleted', '作者走的是**真删**，不是隐藏');
    assert.equal(del.body.id, id);

    assert.equal(videoRowOf(id), null, '作者删除之后行必须真的没了');
    assert.deepEqual(
      itemsOf((await call('GET', `/api/videos?authorId=${user.id}`)).body).map((i) => i.id),
      [],
    );
    assert.deepEqual(
      itemsOf((await call('GET', '/api/videos/mine', { cookie: user.cookie })).body).map(
        (i) => i.id,
      ),
      [],
    );

    // 删除也要留痕（视频没有审核记录，审计是唯一的痕迹）
    assert.deepEqual(auditActionsOf(id), ['video.submit', 'video.delete']);

    // 再删一次：404（它已经不在了），而不是 500
    const again = await call('DELETE', `/api/videos/${id}`, { cookie: user.cookie });
    assert.equal(again.status, 404);
  });

  it('★ 非作者且无权限不能删（403），视频必须还在', async () => {
    const author = await makeUser();
    const other = await makeUser();
    // 审核员**没有** resource.moderate（那个能力从 editor 起才有）——
    // "能审内容"和"能把已经在线的东西撤下来"是两条线。
    const reviewer = await makeUser('reviewer');

    const created = await call('POST', '/api/videos', {
      json: { url: ytUrl(nextYoutubeId()), title: '别人的帖子' },
      cookie: author.cookie,
    });
    const id = (created.body.video as Item).id;

    for (const who of [other, reviewer]) {
      const denied = await call('DELETE', `/api/videos/${id}`, { cookie: who.cookie });
      assert.equal(denied.status, 403, `${who.email} 不该能删别人的视频`);
      assert.equal(denied.body.error, 'forbidden');
      assert.equal(denied.body.capability, 'resource.moderate', '要告诉前端差的是哪一项权限');

      // ★ 被拒的删除绝不能留下痕迹：视频还在、还在墙上
      assert.equal(videoRowOf(id)?.status, 'visible');
      assert.ok(
        itemsOf((await call('GET', `/api/videos?authorId=${author.id}`)).body).some(
          (i) => i.id === id,
        ),
        '403 的删除不该让视频从墙上消失',
      );
    }

    // 未登录当然也不行（401，和"没权限"要分开）
    const anon = await call('DELETE', `/api/videos/${id}`);
    assert.equal(anon.status, 401);

    // 不存在的 id 是 404
    const missing = await call('DELETE', '/api/videos/does-not-exist', { cookie: author.cookie });
    assert.equal(missing.status, 404);
  });

  it('★ 有 resource.moderate 的人删别人的 = **隐藏**：墙上没了，作者自己还看得见', async () => {
    const author = await makeUser();
    const editor = await makeUser('editor');

    const created = await call('POST', '/api/videos', {
      json: { url: ytUrl(nextYoutubeId()), title: '需要被撤下来的视频' },
      cookie: author.cookie,
    });
    const id = (created.body.video as Item).id;

    const res = await call('DELETE', `/api/videos/${id}`, { cookie: editor.cookie });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.mode, 'hidden', '治理者走的是隐藏 —— 删除不可撤销，还会把痕迹一起抹掉');
    assert.equal(res.body.id, id);

    assert.equal(videoRowOf(id)?.status, 'hidden', '库里是 hidden，不是删除');
    assert.ok(
      !itemsOf((await call('GET', `/api/videos?authorId=${author.id}`)).body).some(
        (i) => i.id === id,
      ),
      '★ 隐藏之后公开视频墙里必须没有它',
    );

    /*
     * ★ 但作者在「我贴的」里**仍然看得见**它。
     *   看不见的话，"被隐藏"对他表现为"凭空消失"，他会再贴一次 ——
     *   而 UNIQUE(platform, video_id) 会把他挡回来，报的还是"这个视频已经在站上了"。
     */
    const mine = await call('GET', '/api/videos/mine', { cookie: author.cookie });
    const shown = itemsOf(mine.body).find((i) => i.id === id);
    assert.ok(shown, '★ 作者必须看得见自己被隐藏的作品');
    assert.equal(shown.status, 'hidden', '而且要带着状态，界面才能解释"它为什么不在墙上"');

    assert.deepEqual(auditActionsOf(id), ['video.submit', 'video.hide'], '隐藏要留痕');
  });

  it('★ PATCH visibility：治理者能隐藏与恢复，空操作返回 changed:false', async () => {
    const author = await makeUser();
    const editor = await makeUser('editor');
    const created = await call('POST', '/api/videos', {
      json: { url: ytUrl(nextYoutubeId()), title: '一会儿隐藏一会儿恢复' },
      cookie: author.cookie,
    });
    const id = (created.body.video as Item).id;

    const hide = await call('PATCH', `/api/videos/${id}/visibility`, {
      json: { status: 'hidden' },
      cookie: editor.cookie,
    });
    assert.equal(hide.status, 200, JSON.stringify(hide.body));
    assert.equal(hide.body.status, 'hidden');
    assert.equal(hide.body.changed, true);
    assert.equal(videoRowOf(id)?.status, 'hidden');

    // 重复隐藏：**成功** + changed:false，而不是 409 ——
    // 语义是"把状态设成 X"，设成它已经是的值本来就是个空操作
    const again = await call('PATCH', `/api/videos/${id}/visibility`, {
      json: { status: 'hidden' },
      cookie: editor.cookie,
    });
    assert.equal(again.status, 200);
    assert.equal(again.body.changed, false, '没有真的改动要如实说出来');

    const restore = await call('PATCH', `/api/videos/${id}/visibility`, {
      json: { status: 'visible' },
      cookie: editor.cookie,
    });
    assert.equal(restore.body.status, 'visible');
    assert.equal(restore.body.changed, true);
    assert.ok(
      itemsOf((await call('GET', `/api/videos?authorId=${author.id}`)).body).some(
        (i) => i.id === id,
      ),
      '恢复之后要重新出现在墙上',
    );

    assert.deepEqual(auditActionsOf(id), [
      'video.submit',
      'video.hide',
      'video.hide',
      'video.restore',
    ]);
  });

  it('PATCH visibility 的权限与入参：普通用户 403、未登录 401、乱传状态 400', async () => {
    const author = await makeUser();
    const created = await call('POST', '/api/videos', {
      json: { url: ytUrl(nextYoutubeId()), title: '权限用例' },
      cookie: author.cookie,
    });
    const id = (created.body.video as Item).id;

    // 作者**没有**这个接口：他要的是删除自己的帖子，不是隐藏它
    const selfHide = await call('PATCH', `/api/videos/${id}/visibility`, {
      json: { status: 'hidden' },
      cookie: author.cookie,
    });
    assert.equal(selfHide.status, 403);
    assert.equal(selfHide.body.error, 'forbidden');
    assert.equal(videoRowOf(id)?.status, 'visible', '被拒的请求不能改到任何东西');

    const anon = await call('PATCH', `/api/videos/${id}/visibility`, {
      json: { status: 'hidden' },
    });
    assert.equal(anon.status, 401);

    const editor = await makeUser('editor');
    const badBody = await call('PATCH', `/api/videos/${id}/visibility`, {
      json: { status: 'deleted' }, // 库里只有 visible / hidden 两个值
      cookie: editor.cookie,
    });
    assert.equal(badBody.status, 400);
    assert.equal(badBody.body.error, 'invalid_input');

    const missing = await call('PATCH', '/api/videos/does-not-exist/visibility', {
      json: { status: 'hidden' },
      cookie: editor.cookie,
    });
    assert.equal(missing.status, 404);
  });

  it('★ 公开读不设门槛：没登录也能看视频墙；我贴的必须登录', async () => {
    const user = await makeUser();
    const id = seedVideo({
      userId: user.id,
      videoId: nextYoutubeId(),
      title: '公开可见',
      createdAt: Date.now(),
    });

    const anon = await call('GET', `/api/videos?authorId=${user.id}`);
    assert.equal(anon.status, 200, '浏览不设门槛（docs/v1-plan.md §0.1）');
    assert.ok(itemsOf(anon.body).some((i) => i.id === id));

    // 公开列表的缓存策略要显式给出：什么都不设会让浏览器启用启发式缓存，
    // 症状是"隐藏了但页面上还在"（资源库那张列表踩过同一个坑）
    const cached = await app.request(`/api/videos?authorId=${user.id}`, {
      headers: { origin: SITE.productionOrigin },
    });
    assert.match(cached.headers.get('cache-control') ?? '', /max-age=60/);
  });
});
