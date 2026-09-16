/**
 * 020：追踪的视频博主（`tracked_creators` / `tracked_videos`）。
 *
 * 用户要求：让**管理员（editor+）**维护一份博主名单，服务器按定时任务把他们的
 * **全部**历史视频抓进本地库（标题/封面/发布时间/时长/播放量/评论数/标签），
 * 界面在现有的 `/videos` 页里按发布时间倒序展示。
 *
 * DDL 逐字照 `docs/video-tracking-spec.md` §4.1 / §4.2（这样它还能与文档逐行对得上）。
 * **先去读 spec §4 与 §5.5**；下面只写**这两张表自己**的决定。
 *
 * ===========================================================================
 * 一、★★ `UNIQUE (platform, external_id)` 是**功能**，不是装饰（两张表各一条）
 * ===========================================================================
 * 两条的理由**不一样**，别把它们当成"顺手加的索引"：
 *
 * · `tracked_videos` 那条是**幂等的全部依据**。抓取一律用
 *   `INSERT ... ON CONFLICT (platform, external_id) DO UPDATE`：增量同步时
 *   **翻页重复看到同一批视频是常态**（同一页会被看两遍、上一轮的尾巴会再出现一次）。
 *   没有这条约束，`ON CONFLICT` 那个子句**连写都写不出来**，而"退化成普通 INSERT"
 *   的表现是每次增量都插一批重复行 —— 界面上同一支视频出现 N 次，
 *   而**没有任何一处会报错**。spec §9.1 断言 5 钉的就是它。
 *
 * · `tracked_creators` 那条让"同一个博主被加两次"在**数据库**这一层失败，
 *   而不是靠界面判断（spec §4.1）。界面判断在并发下必然漏（两个人同时点"添加"），
 *   而漏了的表现是同一份名单里出现两行、他的视频被**分裂**进两个 creator_id 下，
 *   于是一边回填一半、两边都不完整。
 *   （先例：`live_channels` 的去重键也是这么放在库里的。）
 *
 * ⇒ 谁在自审时看到"这两条 UNIQUE 碍事"想把它们去掉，请先读 spec §9.1 的断言 5 与 7 ——
 *   它们各有一条测试钉着（`tracking-schema.test.ts` 的 ③ 与 ⑥），删掉当场红。
 *
 * ===========================================================================
 * 二、★★ 拿不到的字段一律 `NULL`，**绝不许填 0**
 * ===========================================================================
 * `thumbnail_url` / `published_at` / `duration_sec` / `view_count` / `comment_count`
 * 全是**可空、且没有默认值**的。这不是手滑漏了 `DEFAULT 0`：
 *
 * · 本仓既有纪律（`packages/shared/src/seed.ts` 里 `SeedRecord.matchDate` 那条注释）：
 *   "null 是真实存在的…**不能**显示成 0，1970 年 1 月 1 日看起来像一条真实数据"。
 * · 在这里具体是：**播放量 0 与"上游没给播放量"是两件事**。填 0 之后
 *   "这支视频没人看"与"这个平台这一轮没回这个字段"在库和界面上**长得一模一样**，
 *   而后者是**接口悄悄变了**的信号 —— 那正是最需要被看见的那一类故障。
 * · 同理 `duration_sec` 填 0 会让 §4.3 的 `short` 标签（`<= 60`）**当场打错**：
 *   一支拿不到时长的长视频会被打上"短视频"。
 * ⇒ 后果：**读的那一侧必须自己处理 NULL**（界面显示破折号，不是 0）。这是刻意的代价。
 *
 * ===========================================================================
 * 三、两个 `ON DELETE` 是**相反**的两种处置，别写成一样
 * ===========================================================================
 * · `tracked_videos.creator_id` ⇒ **`ON DELETE CASCADE`**：视频是博主的内容，
 *   名单里删掉一个人，他的视频**必须跟着走**。
 *   ⚠️ 这里**能**用外键就一定要用 —— 本仓有相反方向的教训：`content_contributors`
 *   （迁移 018）的 `(entity_type, entity_id)` **没有外键**（SQLite 表达不了"指向好几张表
 *   里的那一张"），于是每一条删内容的路径都得自己清贡献者行，漏一处就留下孤儿行，
 *   而且**孤儿行不报错、只会在别处表现成奇怪的结果**。这里的外键是能表达的，
 *   就不要退化成"数据层记得手工删"。
 * · `tracked_creators.added_by` ⇒ **`ON DELETE SET NULL`**：`added_by` 只是
 *   "谁加进来的"这条**出处**，人没了不该把整条名单行带走。
 *   ⚠️ 两处都写成 `CASCADE` 的话，"删一个账号"会**顺手删掉他加进来的博主**
 *   （连带那个博主的全部视频）—— 一次账号清理就静默丢一整份名单。
 *   `tracking-schema.test.ts` 的 ④ 与 ⑧ 各钉一条。
 *
 * ===========================================================================
 * 四、这个迁移**不重建任何表**（因此**没有** noTransaction）
 * ===========================================================================
 * 全部是 `CREATE TABLE` + `CREATE INDEX` ⇒ **不需要** `PRAGMA foreign_keys`
 * （那个 PRAGMA 在事务里无效，见 `migrate.ts` 里 007/008/012/016 的注释），
 * 因此它**留在事务里**：失败即整条回滚，不会留下半成品。
 * 别看到"加两张表"就条件反射地给它加 `noTransaction` —— 那会白白丢掉回滚。
 *
 * ===========================================================================
 * 五、`platform_meta` 为什么在 `tracked_creators` 上（spec §5.5 的裁决）
 * ===========================================================================
 * YouTube 的 `resolveCreator` 会顺带拿到该频道的 `uploads` 播放列表 ID，
 * 而**每一轮增量都要用它**（不发它就得每轮多打一次 `channels.list`）。
 * 存进 `handle` 会污染语义 —— 那一列是**给人看的可读标识**（`@handle` / 昵称），
 * 界面上要拿它显示、链接也可能按它拼。⇒ 加一列 JSON 文本放"各平台自己的小东西"。
 * 代价（刻意认下）：**数据库不知道它的形状**，所以读出时必须过一遍防御性解析，
 * 坏了就当作空 —— 与 `live_shares.payload` / `live_channels.tags` 是同一手法，
 * 好处是**以后再加字段不用迁移**。
 *
 * ===========================================================================
 * 六、这两张表里**没有**队列表（待办从状态推导）
 * ===========================================================================
 * `backfill_done` / `last_cursor` / `last_synced_at` / `consecutive_failures` / `enabled`
 * 五列合起来表达"谁该抓了"，而不是另开一张队列表（spec §3.2）：
 *   · 该回填的：`backfill_done = 0 AND enabled = 1`
 *   · 该增量的：`backfill_done = 1 AND enabled = 1 AND last_synced_at < now - 3600`
 * ⇒ 沿用本仓"**到点是查询条件，不是状态变更**"那条既有裁决（`docs/progress.md` §十六②）：
 *   没有队列表要维护，也就没有"任务卡住"这个状态要人去清。
 * ⚠️ 因此**不要**给这几列加索引：这一版的名单规模是几十行，扫描它比维护索引便宜。
 *
 * ===========================================================================
 * 七、两个索引各自的用途（名字打错的索引照样建得出来、只是不管用）
 * ===========================================================================
 *   · `idx_tracked_videos_recent` —— 公开列表：`ORDER BY published_at DESC` 取一页。
 *   · `idx_tracked_videos_creator` —— 某个博主的视频，以及**"我们库里已经存了多少条"**：
 *     §5.4 的 bilibili 结束判据要拿它与 `page.count` 比（"翻空了"与"被限流了"
 *     在那里是同一个响应，见 spec §2.4）。两处都要 `published_at DESC`，
 *     所以索引的第二列就是它，好让排序也走索引。
 */
export const m020TrackedVideos = `
  CREATE TABLE tracked_creators (
    id                   TEXT PRIMARY KEY,
    platform             TEXT NOT NULL CHECK (platform IN ('bilibili','youtube','twitch')),
    external_id          TEXT NOT NULL,           -- mid / YouTube channelId / Twitch user id
    handle               TEXT NOT NULL DEFAULT '',-- 可读标识（@handle / 昵称），只为显示与排错
    display_name         TEXT NOT NULL,
    avatar_url           TEXT,
    /* 平台自己的小东西（JSON 文本）。见文件头第五节：
       YouTube 的 uploads 播放列表 ID 放这里 —— 不放 handle（那是给人看的可读标识）。
       ⚠️ 数据库不知道它的形状 ⇒ 读出时要过一遍防御性解析，坏了就当作空。 */
    platform_meta        TEXT,
    backfill_done        INTEGER NOT NULL DEFAULT 0 CHECK (backfill_done IN (0,1)),
    last_cursor          TEXT,                    -- 翻页游标（bilibili 是 pn，YouTube 是 pageToken）
    last_synced_at       INTEGER,
    last_error           TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    enabled              INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
    added_by             TEXT REFERENCES users (id) ON DELETE SET NULL,
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL,
    -- ★ 见文件头第一节：让"同一个博主被加两次"在数据库这一层失败
    UNIQUE (platform, external_id)
  );

  CREATE TABLE tracked_videos (
    id             TEXT PRIMARY KEY,
    -- ★ 见文件头第三节：删掉博主，他的视频跟着走（这里能用外键就一定要用）
    creator_id     TEXT NOT NULL REFERENCES tracked_creators (id) ON DELETE CASCADE,
    platform       TEXT NOT NULL CHECK (platform IN ('bilibili','youtube','twitch')),
    external_id    TEXT NOT NULL,                 -- bvid / YouTube videoId / Twitch video id
    title          TEXT NOT NULL,
    -- ⚠️ 下面五列可空且**没有默认值**：拿不到就是 NULL，**绝不许填 0**（文件头第二节）
    thumbnail_url  TEXT,
    published_at   INTEGER,                       -- Unix 秒；拿不到时 NULL（**不要填 0**）
    duration_sec   INTEGER,                       -- 拿不到时 NULL（填 0 会把 long 打成 short）
    view_count     INTEGER,
    comment_count  INTEGER,
    is_live_replay INTEGER NOT NULL DEFAULT 0 CHECK (is_live_replay IN (0,1)),
    tags           TEXT,                          -- JSON 数组文本（沿用 live_channels.tags 的先例）
    status         TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden')),
    first_seen_at  INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    -- ★★ 见文件头第一节：幂等（INSERT ... ON CONFLICT DO UPDATE）的全部依据
    UNIQUE (platform, external_id)
  );

  -- 公开列表：按发布时间倒序取一页
  CREATE INDEX idx_tracked_videos_recent  ON tracked_videos (published_at DESC);
  -- 某个博主的视频 + "我们库里已经存了多少条"（§5.4 的结束判据要用）
  CREATE INDEX idx_tracked_videos_creator ON tracked_videos (creator_id, published_at DESC);
`;
