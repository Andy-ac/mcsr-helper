/**
 * 012：资源库加 `'video'` 条目类型 + 新建 `live_channels`（直播频道清单）。
 *
 * 这一条迁移做两件事，**风险完全不同**，所以分开说。
 *
 * ===========================================================================
 * 一、重建 `resources` 表（⚠️ 不可回滚的那一半）
 * ===========================================================================
 * 为什么必须重建：`kind` 在 001 里是 `CHECK (kind IN ('website','tool'))`，
 * 而 **SQLite 改不了 CHECK 约束**（没有 ALTER TABLE ... DROP/ADD CONSTRAINT）。
 * 唯一的办法是"建新表 → 拷数据 → 换名" —— 和 007/008 加角色时一样。
 *
 * ⚠️⚠️ 与 007/008 一样，它必须**跳出事务**（`noTransaction: true`）：
 *    重建过程要关外键，而 `PRAGMA foreign_keys` **在事务里是无效的**
 *    （SQLite 明文规定）。代价是**失败时没有回滚**。
 *
 *     所以部署前必须：
 *       1. 拿**生产库的副本**跑一遍（`.cache/rehearse-migration.mjs`）；
 *       2. 部署前 `VACUUM INTO` 备份并**回读校验行数**（`.cache/prod-backup.sh`）。
 *
 * 关于外键：`resource_revisions.resource_id` 和 `resource_marks.resource_id`
 * 都指向 `resources(id) ON DELETE CASCADE`。开着外键 DROP TABLE 会做一次隐式
 * DELETE，从而**级联删掉全部版本快照和收藏** —— 也就是"加一个枚举值顺手把
 * 审核历史清了"。所以关外键这一步不是形式。
 *
 * ⚠️ 新表的列必须和旧表**逐列一致**（19 列），索引也全部重建。
 *    漏一列不会报错，只会让那一列的数据消失 —— 所以下面这份定义是从
 *    **库里的 `sqlite_master` 读回来抄的**，不是照着迁移文件在脑子里合并的
 *    （见 `.cache/resources-schema.mjs`）。
 *
 * ===========================================================================
 * 二、新建 `live_channels`（安全的一半）
 * ===========================================================================
 * 纯建表，不动任何已有结构。但它和 resources 的重建在**同一条迁移**里，
 * 所以整条迁移仍然是 noTransaction 的 —— 建表本身失败也不会回滚。
 * 代价很小（表是空的），换来的是"加一个 kind"这件事只有一次不可回滚的动作。
 *
 * ===========================================================================
 * ⚠️⚠️ 写这条迁移时**又踩了一次**这个坑：模板字符串里的 SQL 注释**不能有反引号**。
 * ===========================================================================
 * 一个反引号就会提前闭合模板串，报出来的错是 `TS1005: ',' expected`
 * 或 `Module declaration names may only use quoted strings` ——
 * 指到 SQL 的**中间某一行**，和真正的原因（上面几行的某个反引号）毫无关系。
 * 2026-09-13 在这条迁移上踩了 4 处。
 * **写 SQL 注释时用「」或单引号括标识符，不要用反引号。**
 * （上面这段注释本身就在模板串**外面**，所以这里的反引号是安全的 ——
 *   判断标准是"它在不在 export const … = \` 之后"。）
 */
export const m012ResourceVideoAndLive = `
  PRAGMA foreign_keys = OFF;

  -- -------------------------------------------------------------------------
  -- 1) 重建 resources：kind 的 CHECK 加上 'video'
  -- -------------------------------------------------------------------------
  CREATE TABLE resources_new (
    id          TEXT    PRIMARY KEY,
    -- ⚠️ 这次迁移**唯一**改动的地方
    kind        TEXT    NOT NULL CHECK (kind IN ('website', 'tool', 'video')),
    title       TEXT    NOT NULL,
    title_en    TEXT,
    url         TEXT    NOT NULL,
    summary     TEXT,
    body        TEXT    NOT NULL DEFAULT '',
    lang        TEXT    NOT NULL CHECK (lang IN ('zh-CN', 'en')),
    tags        TEXT    NOT NULL DEFAULT '[]',
    featured    INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
    status      TEXT    NOT NULL DEFAULT 'published'
                        CHECK (status IN ('draft', 'pending', 'published', 'rejected', 'hidden')),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    source      TEXT    NOT NULL DEFAULT 'import'
                        CHECK (source IN ('import', 'user')),
    image_url   TEXT,
    official    INTEGER NOT NULL DEFAULT 0 CHECK (official IN (0, 1)),
    author_id   TEXT,
    current_revision INTEGER,
    pending_revision INTEGER
  );

  INSERT INTO resources_new
    (id, kind, title, title_en, url, summary, body, lang, tags, featured, status,
     created_at, updated_at, source, image_url, official, author_id,
     current_revision, pending_revision)
  SELECT
     id, kind, title, title_en, url, summary, body, lang, tags, featured, status,
     created_at, updated_at, source, image_url, official, author_id,
     current_revision, pending_revision
  FROM resources;

  DROP TABLE resources;
  ALTER TABLE resources_new RENAME TO resources;

  -- 索引全部重建（7 条，逐条对照 sqlite_master 抄的）
  CREATE INDEX idx_resources_listing ON resources (status, featured DESC, updated_at DESC);
  CREATE INDEX idx_resources_kind ON resources (kind, status);
  CREATE INDEX idx_resources_lang ON resources (lang, status);
  CREATE INDEX idx_resources_author ON resources (author_id, created_at DESC);
  CREATE INDEX idx_resources_official ON resources (official, status);
  CREATE INDEX idx_resources_source ON resources (source);
  CREATE INDEX idx_resources_pending ON resources (pending_revision) WHERE pending_revision IS NOT NULL;

  PRAGMA foreign_keys = ON;

  -- -------------------------------------------------------------------------
  -- 2) 直播频道清单
  -- -------------------------------------------------------------------------
  /*
   * 记的是**频道**，不是某一场直播（见 shared/live.ts 的文件头）。
   *
   * ⚠️ 「live_video_id」是"现在这一场"的 ID，它会变 —— 所以它和频道本身
   *    分开存，而且界面上要说清它是临时的。把它和 handle 混成一个字段，
   *    过一个月就没人知道该更新哪个了。
   *
   * ⚠️ 「embed_channel」是一个**试验开关**：YouTube 的频道级嵌入
   *    （/embed/live_stream?channel=…）能让"记录频道"零维护，但它的可靠性
   *    证据互相矛盾，而且失败时是**一个纯黑框**。所以默认关，
   *    等确认某个 streamer 正在开播时再逐行打开。
   */
  CREATE TABLE live_channels (
    id            TEXT PRIMARY KEY,

    platform      TEXT    NOT NULL
                          CHECK (platform IN ('youtube', 'twitch', 'bilibili')),

    /*
     * 频道标识。**不是链接** —— 链接由 liveChannelUrl() 按平台拼出来。
     * 混成一个字段的话，"拼链接"这一步就没了依据（YouTube 的 @handle 和
     * UC… 频道 ID 走的是两个不同的 URL 形状）。
     */
    handle        TEXT    NOT NULL,

    display_name  TEXT    NOT NULL,
    note          TEXT,

    /** 可选：当前这场直播的视频 ID。有它才嵌（YouTube）。 */
    live_video_id TEXT,

    /** 频道级嵌入的试验开关。默认关，理由见上。 */
    embed_channel INTEGER NOT NULL DEFAULT 0 CHECK (embed_channel IN (0, 1)),

    sort_order    INTEGER NOT NULL DEFAULT 100,

    /*
     * 只有两态：显示 / 不显示。
     *
     * ⚠️ 这里**刻意没有 pending** —— 这份清单是编辑维护的，不走审核管线
     *    （它没有「live.submit」，只有「live.manage」）。
     *    加一个永远不会被用到的状态值，只会让下一个人去找"谁来批它"。
     */
    status        TEXT    NOT NULL DEFAULT 'visible'
                          CHECK (status IN ('visible', 'hidden')),

    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,

    /** 同一个平台下同一个频道只能记一次 —— 清单里出现两遍是纯噪音。 */
    UNIQUE (platform, handle)
  );

  -- 公开列表的查法：可见的、按 sort_order 再按名字
  CREATE INDEX idx_live_listing ON live_channels (status, sort_order);
`;
