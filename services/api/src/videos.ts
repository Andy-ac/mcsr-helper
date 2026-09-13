/**
 * 用户自贴视频的数据层。
 *
 * ---------------------------------------------------------------------------
 * 一、为什么视频**不进审核队列**（用户 Q6 确认）
 * ---------------------------------------------------------------------------
 * 贴完就是 `visible`，没有 pending。三条理由：
 *
 *   1. **风险不对称**。视频本体托管在 B站 / YouTube / Twitch，我们库里存的是
 *      一个 ID 加一个标题 —— 标题是这一行里**唯一**的自由文本，而内容风险
 *      恰恰来自正文。拿同一道审核闸门去挡它，代价（每贴一个视频都要等一个人
 *      来看）远大于收益。
 *   2. **我们抓不到任何东西**（见 shared/videos.ts 的铁律）。没有元数据，
 *      也就不存在"先存下来、审完再显示"的中间态 —— 审核员能看到的和
 *      用户能看到的是同一行数据，审核在这里无法增加任何信息。
 *   3. **v1 里没有 `video.review` 能力**（packages/shared/permissions.ts 的矩阵）。
 *      矩阵里没有它，"谁能审视频"这个问题在代码里就没有落点 ——
 *      真要加审核，得先加能力、加角色、加迁移，那是一个独立的决定，
 *      不该由数据层顺手替它做。
 *
 * ⚠️ 但**事后手段必须有**，这一层把它做实了：
 *   · 作者可以删掉自己的（`deleteVideo`）
 *   · 有 `resource.moderate` 的人可以把它改成 `hidden`（`setVideoVisibility`）
 *
 * ---------------------------------------------------------------------------
 * 二、hidden 的含义：它必须从**公开读**里彻底消失
 * ---------------------------------------------------------------------------
 * `listVideos`（视频墙）只查 `status = 'visible'`，被隐藏的行**根本不会进入
 * 响应体**。这件事必须严格到"前端拿不到它"：如果只是前端不渲染嵌入框、
 * 而数据照常下发，页面上就会留下一个**指向已隐藏视频的空壳**
 * （标题、作者、占位框都在，只是没有画面）—— 那等于把"这条被下架了"
 * 展示给所有人看，用户点进去还会看到那个视频。
 * 所以隐藏要隐藏在下发这一层，而不是渲染那一层。
 *
 * ⚠️ 反过来：`listOwnVideos`（「我贴的」）**刻意不过滤状态**。作者必须看得见
 *    自己被隐藏的作品，否则"被隐藏"对他表现为"凭空消失"，他会再贴一遍 ——
 *    而 UNIQUE(platform, video_id) 会把他挡回来，报的还是"这个视频已经在站上了"。
 *    一个看不见的东西 + 一句"已经在了"，是用户最难自己想明白的一种错误。
 *
 * ---------------------------------------------------------------------------
 * 三、只存 platform + video_id，**绝不抓取任何元数据**
 * ---------------------------------------------------------------------------
 * 这是铁律（docs/v1-plan.md §5）：B站个人开发者没有合法的元数据接口，
 * YouTube 的元数据最多存 30 天且禁止聚合，Twitch 虽然支持但 v1 不需要。
 * 所以这个文件里**没有任何一句网络请求**，标题完全来自用户手填。
 * 将来若有人想"写库前顺手拉一下标题"，那不是优化，是违反这条铁律。
 */
import type { VideoPlatform } from '@mcsr/shared';
import type { Video } from '@mcsr/shared/videos';
import { newId } from './auth/tokens';
import { getDb } from './db';

/**
 * 视频的两个状态。
 *
 * ⚠️ 它**只有两个**，而且**不含 pending / rejected** —— 原因见文件头第一节。
 *    这里用 `as const` 数组而不是 TS 联合类型，是为了让它在运行时也能枚举：
 *    路由层的入参校验用它（`z.enum(VIDEO_VISIBILITIES)`），
 *    于是"库里允许的值"和"接口接受的值"是同一份定义，不会漂移。
 */
export const VIDEO_VISIBILITIES = ['visible', 'hidden'] as const;
export type VideoVisibility = (typeof VIDEO_VISIBILITIES)[number];

/** 数据库里的一行（snake_case；author_name 来自 users 的联结，不是本表的列）。 */
interface VideoRow {
  id: string;
  user_id: string;
  platform: string;
  video_id: string;
  title: string;
  start_offset_sec: number | null;
  status: string;
  created_at: number;
  author_name: string | null;
}

/**
 * 联结 users 时**只取 display_name**。
 *
 * ⚠️ 绝不能写成 `u.*` 或 `SELECT *`：users 表里有 email、password_hash、
 *    mc_uuid —— 视频墙是**公开**接口，一个星号就会把这些字段连同响应一起
 *    发出去，而且从响应上看不出来多带了东西。字段名写在这里，多带一个都要
 *    显式加一行，这是唯一能靠读代码发现泄漏的写法。
 */
const SELECT_COLUMNS = `
  v.id, v.user_id, v.platform, v.video_id, v.title, v.start_offset_sec,
  v.status, v.created_at, u.display_name AS author_name
`;

/** 库里的行 → 对外的形状。与 shared/videos.ts 的 `Video` **一一对应**。 */
function toVideo(row: VideoRow): Video {
  /*
   * ⚠️ 逐字段展开成**普通对象字面量**，不返回行对象本身。
   *    node:sqlite 的行对象原型不是 Object.prototype，而 deepStrictEqual
   *    会比较原型 —— 直接返回行的话，测试里"两边打印出来一模一样却断言失败"，
   *    排查方向会被带到数据内容上去。
   */
  return {
    id: row.id,
    userId: row.user_id,
    authorName: row.author_name ?? null,
    platform: row.platform as VideoPlatform,
    videoId: row.video_id,
    title: row.title,
    startOffsetSec: row.start_offset_sec,
    status: row.status,
    createdAt: row.created_at,
  };
}

/** 查重命中时告诉调用方的那几件事：下一步该怎么办由它们决定，不由调用方猜。 */
export interface DuplicateVideo {
  id: string;
  title: string;
  userId: string;
  status: string;
}

export type CreateVideoResult =
  | { ok: true; video: Video }
  | { ok: false; reason: 'duplicate'; existing: DuplicateVideo };

/**
 * 按 (platform, video_id) 找已有的行。
 *
 * ⚠️ **不过滤 status**。这正是一张 hidden 的行也必须被找到的原因：
 *    UNIQUE(platform, video_id) 约束在整张表上，不管那条是不是隐藏的 ——
 *    所以"视频已存在"和"这个视频在站上看得见"是两件不同的事，
 *    调用方必须自己看清 status 再决定说什么（和 resources.ts 的
 *    findResourceByUrl 是同一个教训：挡住要挡得**准确**）。
 */
export function findVideoByPair(platform: VideoPlatform, videoId: string): DuplicateVideo | null {
  const row = getDb()
    .prepare('SELECT id, title, user_id, status FROM videos WHERE platform = ? AND video_id = ?')
    .get(platform, videoId) as
    | { id: string; title: string; user_id: string; status: string }
    | undefined;
  if (!row) return null;
  return { id: row.id, title: row.title, userId: row.user_id, status: row.status };
}

/**
 * 贴一个视频。
 *
 * 重复的处理：返回 `{ ok: false, reason: 'duplicate' }`，**不让 UNIQUE 约束的
 * 异常冒到路由层**。否则用户看到的是一个 500「出错了」，而他做的事
 * （贴一个别人已经贴过的热门录像）是完全正常的、可解释的 ——
 * 那正是 error-codes.test.ts 文件头里记录的那类 bug。
 */
export function createVideo(input: {
  userId: string;
  platform: VideoPlatform;
  videoId: string;
  title: string;
  startOffsetSec: number | null;
  now: number;
}): CreateVideoResult {
  const db = getDb();

  /*
   * ★ 先查一次，而不是"靠插入失败来发现重复"。
   *
   * 重复是这个接口**最常见的结果之一**（一个热门录像会被好几个人贴），
   * 所以它必须走 happy path —— 让"常见结果"去走异常路径，代价是每次都要
   * 构造并抛出/接住一个异常，而且读代码的人得一路追到 catch 才看得懂
   * 重复是怎么被发现的。`routes/resources.ts` 的 url_exists 就是这么处理的，
   * 两处保持一致。
   *
   * ⚠️ 而且 `findVideoByPair` **故意不过滤 status**：一个 hidden 的行照样占着
   *    `UNIQUE(platform, video_id)`，所以隐藏过的视频再被贴一次仍然是重复。
   *    只看 visible 的话，这种情况会掉进下面的 catch、查不到、然后 rethrow → 500。
   */
  const duplicate = findVideoByPair(input.platform, input.videoId);
  if (duplicate) return { ok: false, reason: 'duplicate', existing: duplicate };

  const id = newId();

  try {
    db.prepare(
      `INSERT INTO videos
         (id, user_id, platform, video_id, title, start_offset_sec, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'visible', ?, ?)`,
    ).run(
      id,
      input.userId,
      input.platform,
      input.videoId,
      input.title,
      input.startOffsetSec,
      input.now,
      input.now,
    );
  } catch (error) {
    /*
     * 走到这里说明上面那次预查没拦住 —— 也就是**两个请求同时挤进了同一个窗口**。
     *
     * ⚠️ 在当前部署形态下这个窗口实际上是零：`createVideo` 内部没有任何
     *    `await`，而 node:sqlite 的语句执行是同步的，所以单进程下它一旦开始
     *    就不可能被打断。留着这个 catch 是防御 —— 一旦以后这里多了异步、
     *    或者部署成多进程，漏掉它就等于重复变成 500。
     *
     * ⚠️ 而且**只有真的能查到同一个 (platform, video_id) 时**才把它当成重复。
     *    把任何插入失败都翻译成"这个视频已经在站上了"是错的：那会把
     *    "platform 传了一个 CHECK 不认识的值"这种真 bug 藏成一句用户提示，
     *    而后者才是应该 5xx、应该被日志看见的东西。
     */
    const existing = findVideoByPair(input.platform, input.videoId);
    if (existing) return { ok: false, reason: 'duplicate', existing };
    throw error;
  }

  const video = getVideo(id);
  /*
   * 刚插进去的行不可能读不回来。真读不回来说明上面那句 INSERT 没有生效 ——
   * 那时**抛**（→ 5xx + 日志），而不是返回一个缺字段的"成功"响应：
   * 前端会拿着一个没有 id 的对象去渲染，而错误现场什么痕迹都不剩。
   */
  if (!video) throw new Error(`视频 ${id} 插入成功却读不回来`);
  return { ok: true, video };
}

/**
 * 按 id 读一行，**不看状态**。
 *
 * ⚠️ 名字里的 get* 不带状态条件，这一点必须和 `listVideos` 严格区分开
 *    （resources.ts 在 resourceExists 上踩过同一个坑）：这个函数是给
 *    "作者删自己的"和"管理员隐藏这一条"用的，被隐藏的行在它眼里**是存在的**
 *    —— 否则隐藏之后连管理员都再也找不到它，那不是隐藏，是一条单向的路。
 *
 *    因此**绝不能**把它接到任何公开读接口上：公开列表走 listVideos，
 *    它自己带着 `status = 'visible'`。
 */
export function getVideo(id: string): Video | null {
  const row = getDb()
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM videos v LEFT JOIN users u ON u.id = v.user_id
       WHERE v.id = ?`,
    )
    .get(id) as unknown as VideoRow | undefined;
  return row ? toVideo(row) : null;
}

/** 视频墙的查询条件。字段名与前端拼的查询参数一致（见 routes/videos.ts）。 */
export interface VideoQuery {
  platform?: VideoPlatform;
  authorId?: string;
  page: number;
  pageSize: number;
}

export interface VideoListResponse {
  items: Video[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 视频墙：**公开读**，只列 `visible`，按贴出来的时间倒序。
 *
 * 分页形状（items / total / page / pageSize）与资源库列表**完全一致** ——
 * 两个列表页的分页控件是同一个组件，形状不同就得在中间加一层翻译，
 * 而那种翻译迟早会漏掉一个字段（比如 total 忘了转）。
 *
 * ⚠️ `ORDER BY created_at DESC, id ASC` 里的第二个键不是装饰：
 *    同一毫秒贴出来的两条视频，SQLite **不保证**返回顺序稳定，
 *    于是翻页时会有记录重复出现或被整页跳过 —— 而界面上看起来
 *    只是"好像漏了几条"。id 是随机 UUID，它不表达时间（只是保证确定性），
 *    这一点和"按时间排"并不冲突。
 */
export function listVideos(query: VideoQuery): VideoListResponse {
  const db = getDb();
  const where: string[] = ["v.status = 'visible'"];
  const params: Array<string | number> = [];

  if (query.platform) {
    where.push('v.platform = ?');
    params.push(query.platform);
  }
  /*
   * 按作者筛选（计划里的 GET /api/users/:id/videos）。
   *
   * ⚠️ 这里是**公开**筛选，所以仍然只出 visible 的行 —— 作者自己看全部
   *    走的是 listOwnVideos，那是另一个接口（/api/videos/mine）。
   *    用一个参数同时表达这两种意图的话，早晚会有人在公开页面上
   *    传一个 includeHidden。
   */
  if (query.authorId) {
    where.push('v.user_id = ?');
    params.push(query.authorId);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;

  const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM videos v ${whereSql}`).get(...params) as
    | { n: number }
    | undefined;

  const offset = (query.page - 1) * query.pageSize;
  // 行类型是 Record<string, SQLOutputValue>，与具名接口没有结构重叠，先转 unknown。
  // 这是**唯一**允许这么绕的地方：SQL 与类型的对应关系由上面的 SELECT_COLUMNS 保证。
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM videos v LEFT JOIN users u ON u.id = v.user_id
       ${whereSql}
       ORDER BY v.created_at DESC, v.id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, query.pageSize, offset) as unknown as VideoRow[];

  return {
    items: rows.map(toVideo),
    total: totalRow?.n ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/**
 * 「我贴的」：**含被隐藏的**，按时间倒序。见文件头第二节。
 *
 * 不分页：一个人的帖子数量是人眼能扫完的量级，而分页会让"我刚才贴的那个
 * 去哪了"变成一次翻页动作。
 */
export function listOwnVideos(userId: string): Video[] {
  const rows = getDb()
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM videos v LEFT JOIN users u ON u.id = v.user_id
       WHERE v.user_id = ?
       ORDER BY v.created_at DESC, v.id ASC`,
    )
    .all(userId) as unknown as VideoRow[];
  return rows.map(toVideo);
}

export type SetVisibilityResult =
  | { ok: true; status: VideoVisibility; changed: boolean }
  | { ok: false; reason: 'not_found' };

/**
 * 把一条视频改成 hidden / visible。**只有治理动作会调它**（路由层用
 * `resource.moderate` 把关）。作者不需要它 —— 他要的是删除自己的帖子，
 * 见 `deleteVideo`。
 *
 * ⚠️ 与资源库的 `setResourceVisibility` 有一处**刻意的不同**：
 *    资源库那边把"它本来就是那个状态"当成 409 `invalid_state`，
 *    这里返回 `changed: false` 的**成功**。
 *
 *    理由是接口的语义不同：那个接口是"下架/恢复"这个**动作**（重复点一次
 *    说明有人不知道已经被处理过了，值得报一声），而这个接口是
 *    "把状态设成 X"（设成它已经是的值，本来就是个空操作）。
 *    把空操作报成错误，等于逼前端为"点了一个必然失败的按钮"写一条分支，
 *    而那条分支迟早会漂移。信息没有丢：`changed` 把它明确说了出来。
 */
export function setVideoVisibility(
  id: string,
  status: VideoVisibility,
  now: number,
): SetVisibilityResult {
  const db = getDb();
  const row = db.prepare('SELECT status FROM videos WHERE id = ?').get(id) as
    | { status: string }
    | undefined;
  if (!row) return { ok: false, reason: 'not_found' };

  const changed = row.status !== status;
  // 状态没变就不写库：动 updated_at 会让"这行最后一次被改是什么时候"
  // 变得不可信（资源库的 setUserRole 里是同一条纪律）。
  if (changed) {
    db.prepare('UPDATE videos SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
  }

  return { ok: true, status, changed };
}

/**
 * 真删一行。**只给作者用**（路由层负责判定）。
 *
 * 为什么治理者走的是隐藏而不是删除：删除是不可撤销的，而且会把
 * "这个视频曾经被贴上来过、后来被拿掉了"这件事一起抹掉 ——
 * 治理动作需要留下痕迹（审计里那一条记录指向的 id 会变成一个查不到的行）。
 * 隐藏则完全可逆，而且作者还能在「我贴的」里看到自己被隐藏的作品。
 *
 * 返回是否真的删掉了一行：调用方据此区分"删掉了"和"这一刻它已经不在了"。
 */
export function deleteVideo(id: string): boolean {
  const result = getDb().prepare('DELETE FROM videos WHERE id = ?').run(id);
  return Number(result.changes) > 0;
}

// ---------------------------------------------------------------------------
// ② 直编（`/api/authoring/videos/:id`）
//
// ⚠️ 上面那两条（`createVideo` / `deleteVideo`）是**提交路径**，语义不变；
//    下面这两条是新建的**直编路径**，与它们并存。
// ---------------------------------------------------------------------------

/** `updateVideoDirect` 的三种结局。字形与 `CreateVideoResult` 保持一致。 */
export type UpdateVideoDirectResult =
  | { ok: true; video: Video }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'duplicate'; existing: DuplicateVideo };

/**
 * 直编一条视频的**原文本**（`url` → (platform, video_id)、`title`、`startOffsetSec`）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 它与 `createVideo` 的差别只有一处：改的是**已存在的那一行**
 * ---------------------------------------------------------------------------
 * 视频**没有版本表**（`videos` 表上没有 revision 那一套，见文件头第一节：
 * 贴了上去就是可见的）。所以"直编"在这里就是一次普通的 UPDATE ——
 * 不像资源/赛事那样要同时拍一条 `approved` 快照。
 * 也因此响应里的 `liveRevisionUnchanged` 对这个类型只是"线上那一行"的意思。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 两件**绝不能顺手做**的事
 * ---------------------------------------------------------------------------
 * 1. **不动 `status`**。改一个错别字的标题不该把一条被隐藏的视频放回墙上 ——
 *    那会让 `hidden` 变成一个"随便改点什么就恢复"的状态，而隐藏是治理动作。
 *    （资源/赛事那边是逐字同一条规则：`CASE WHEN status = 'hidden' THEN 'hidden' ...`。）
 * 2. **不动 `user_id`**。"这条是谁贴的"不随内容转移：转移作者会让「我贴的」里
 *    凭空出现别人的帖子，而原作者的帖子里凭空消失一条。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 查重要**排除自己**（这是本函数最容易写成 bug 的一处）
 * ---------------------------------------------------------------------------
 * `(platform, video_id)` 上有全表 UNIQUE，而**改了标题、链接没改**是最常见的一次编辑。
 * 直接用 `findVideoByPair` 会查到**这一行自己**，于是"改个标题"被判成
 * "这个视频已经在站上了" —— 一个用户完全无法理解的 409（他改的正是那一条）。
 * 所以命中之后必须比一次 id。
 */
export function updateVideoDirect(input: {
  id: string;
  platform: VideoPlatform;
  videoId: string;
  title: string;
  startOffsetSec: number | null;
  now: number;
}): UpdateVideoDirectResult {
  const db = getDb();

  const row = db.prepare('SELECT id FROM videos WHERE id = ?').get(input.id) as
    | { id: string }
    | undefined;
  if (!row) return { ok: false, reason: 'not_found' };

  /*
   * 与 `createVideo` 一样**先查一次**，而不是靠插入失败来发现重复：
   * 重复是这条接口最常见的失败之一（把链接改成另一个已经被贴过的视频），
   * 让常见结果走异常路径，读代码的人就得一路追到 catch 才看得懂。
   */
  const duplicate = findVideoByPair(input.platform, input.videoId);
  if (duplicate && duplicate.id !== input.id) {
    return { ok: false, reason: 'duplicate', existing: duplicate };
  }

  try {
    db.prepare(
      `UPDATE videos
          SET platform = ?, video_id = ?, title = ?, start_offset_sec = ?, updated_at = ?
        WHERE id = ?`,
    ).run(input.platform, input.videoId, input.title, input.startOffsetSec, input.now, input.id);
  } catch (error) {
    /*
     * ⚠️ 兜底与 `createVideo` 里那条 catch 同形，但**多一次排除自己**：
     *    上面那次预查在单进程下挡得住，可一旦这里多了 `await`（或部署成多进程），
     *    两个请求同时改两条视频时，其中一个会撞上 UNIQUE。
     *    不排除自己的话，这条错误会被翻译成"这个视频已经在站上了"，
     *    而它指的其实是**调用方正改着的那一条**。
     */
    const existing = findVideoByPair(input.platform, input.videoId);
    if (existing && existing.id !== input.id) {
      return { ok: false, reason: 'duplicate', existing };
    }
    // 查不到同一个 (platform, video_id) 说明这不是重复，而是真 bug —— 让它变成 5xx + 日志
    throw error;
  }

  const video = getVideo(input.id);
  /*
   * 刚更新过的行不可能读不回来。真读不回来就**抛**（→ 5xx），
   * 而不是返回一个缺字段的"成功"响应 —— 理由与 `createVideo` 末尾同一条。
   */
  if (!video) throw new Error(`视频 ${input.id} 更新成功却读不回来`);
  return { ok: true, video };
}

/**
 * 直编真删一条视频。
 *
 * ⚠️ 与 `deleteVideo`（作者删自己的）**并存、语义不变**：那个是"作者收拾自己的帖子"，
 *    这个是 ② 的直编删除（editor 及以上的"删"、owner 的"一键"）。
 *    两条路都真删，差别只在**谁**能走、以及走之前要不要先下架。
 *
 * ⚠️ **两档**，与资源 / 赛事**逐字同一条规则**（同一个概念在两处用不同判据，
 *    下一个人只会照着其中一处改）：
 *      · `force`（owner 的"一键"）→ 不做前置检查，直接删；
 *      · editor / admin → 条目还在墙上（`status = 'visible'`）就先下架
 *        （409 `must_hide_first`），下架之后再删。
 *
 * ⚠️ 判据是 `status`，**不是**"别的什么"：视频本来就没有版本号那一列，
 *    而且"在不在站上"这个问题在整张表里只有 `status` 回答得了。
 *    ⚠️ 反过来，已经是 `hidden` 的**应当删得掉** —— 它本来就不在墙上，
 *    再要求一次"先下架"会变成一个谁也走不通的死路。
 *
 * ⚠️ 与资源不同：视频**没有连带数据**（收藏/备注/评分的外键只指向 `resources`），
 *    所以这里不存在"一次手滑销毁别人的东西"那层代价；两步在这里是为了
 *    **与其它两个类型的规矩保持一致**，而不是因为删视频本身危险。
 */
export function deleteVideoDirect(
  id: string,
  options: { force: boolean },
): { ok: true } | { ok: false; reason: 'not_found' | 'must_hide_first' } {
  const db = getDb();
  const row = db.prepare('SELECT status FROM videos WHERE id = ?').get(id) as
    | { status: string }
    | undefined;
  if (!row) return { ok: false, reason: 'not_found' };

  if (!options.force && row.status === 'visible') {
    return { ok: false, reason: 'must_hide_first' };
  }

  db.prepare('DELETE FROM videos WHERE id = ?').run(id);
  return { ok: true };
}
