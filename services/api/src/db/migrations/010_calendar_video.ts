/**
 * 010：M4 的三块地基 —— 日历、视频，以及**通用的版本表**。
 *
 * ---------------------------------------------------------------------------
 * 为什么种子（seed_shares）不在这里
 * ---------------------------------------------------------------------------
 * 原本计划里 M4 要建 `seed_shares`（社区提交的固定模板种子）。但用户 2026-09-12
 * 把种子那块改成了先做 **Ranked Seeds**（对接上游 API 查他自己那个库），
 * 社区 UGC 分享**先留空**。
 *
 * 所以**这张表现在不建**。建一张没有代码用的表，等于让后来的人以为那个功能
 * 已经做了一半 —— 而"看起来做完了其实没有"正是这个项目一路在防的事。
 * 等真要做社区分享时再加一条迁移，那比现在建了再改便宜。
 *
 * ---------------------------------------------------------------------------
 * 为什么版本表是通用的（而资源库有自己那张）
 * ---------------------------------------------------------------------------
 * 设计约束 2：**改已发布内容 = 创建新版本并回到 pending，线上仍展示旧版**。
 * 这是阻止"先过审、后改成广告"的关键机制，日历和种子都要遵守。
 *
 * `resource_revisions` 做不到这件事：它的列是**资源库专用的**
 * （kind / url / summary / tags / image_url），日历一条都用不上。
 * 所以这里建一张**按类型多态的** `content_revisions`，内容以 JSON 存放。
 *
 * ⚠️ 为什么不直接改 `resource_revisions` 让它通用：
 *    那要重建一张**线上有 15 行真实数据、且被审核历史引用着**的表。
 *    收益是多一张表不用，代价是动线上数据 —— 不划算。
 *    两张表并存是有意的取舍，不是没来得及合并。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ `payload` 用 JSON 而不是做成列，是有代价的，说清楚
 * ---------------------------------------------------------------------------
 * 代价：数据库层没法对日历的时间做约束（它在 JSON 里），过滤只能在应用层做。
 * 换来的是：日历、种子、以后每一类内容的版本表都只有这一张，
 * 而"加一类内容"不需要再建一张几乎一样的表。
 *
 * 因为 JSON 里的字段没有数据库兜底，**写进 payload 之前必须在 Zod 层校验过**
 * （见 packages/shared），不能靠"反正表里有 CHECK"。
 */

export const m010CalendarVideo = `
  -- -------------------------------------------------------------------------
  -- 日历事件
  -- -------------------------------------------------------------------------
  CREATE TABLE calendar_events (
    id               TEXT PRIMARY KEY,

    title            TEXT    NOT NULL,
    -- 可选的英文标题。**不强制、不自动翻译** —— 见 docs/m4-decisions.md 的 Q19。
    title_en         TEXT,
    description_md   TEXT    NOT NULL DEFAULT '',

    /*
     * ⚠️ 时间存**三段**，而且不是一个冗余的设计。
     *
     * 用户 2026-09-12 的决定（Q2）：**存"当地时间 + 时区名"，显示时转本地**。
     * 所以：
     *   · starts_at_local —— 赛事公告上写的那个墙钟时间，原样保留。
     *     它是**事实**：公告说 20:00 就是 20:00，不该因为我们换算过一次就变形。
     *   · starts_at_tz    —— IANA 时区名（Asia/Shanghai）。存名字而不是 +08:00，
     *     因为偏移量会随夏令时变，而名字不会。
     *   · starts_at_utc   —— 由前两者**在写入时算出来**的绝对时刻。
     *
     * 为什么第三段不是冗余：没有它就无法排序、无法比较"是不是已结束"、
     * 无法生成 ICS —— 而这些都要在 SQL 里做（列表分页、ICS 只导出未来的）。
     * 为什么不读的时候现算：时区数据库会更新，现算意味着**历史数据会跟着变**。
     * 写入时算一次，那一刻的答案就固定下来了。
     *
     * local 用 'YYYY-MM-DDTHH:mm' 文本，不用整数：这个字段的意义就是"照抄公告"，
     * 存成整数反而让它在数据库里不像它本来的样子，排查时要来回换算。
     */
    starts_at_local  TEXT    NOT NULL,
    starts_at_tz     TEXT    NOT NULL,
    starts_at_utc    INTEGER NOT NULL,

    -- 结束时间可空（很多赛事只写开始）。语义分两种，见 all_day。
    ends_at_local    TEXT,
    ends_at_tz       TEXT,
    ends_at_utc      INTEGER,

    all_day          INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),

    url              TEXT,
    -- 线下活动/聚会需要地点；线上赛事留空。
    location         TEXT,

    /*
     * 事件标签（JSON 数组）。用户 Q1 要的是"赛事 / 社区活动 / 排位节点都要，
     * 并用标签区分，可自行选择/禁用部分标签"。
     *
     * 用数组而不是单个 kind：一个事件可以同时是"社区活动"和"赛事"
     * （社区自己办的比赛就是），而单选会逼录入者在两个都对的值里挑一个。
     */
    tags             TEXT    NOT NULL DEFAULT '[]',

    /*
     * 轮次标签（用户 Q20）。可空。
     * ⚠️ 它**只是一个标签，不做父子层级** —— 真实数据里两种形态并存：
     *    playoffs_s1 是横跨 7 天的连续窗口，playoffs_s5 是按轮次拆开的
     *    独立时间片（r1/r2/qf/sf/3rd/final）。硬做统一的 bracket 模型，
     *    会有一半的真实赛事填不进去。
     */
    stage            TEXT,

    lang             TEXT    NOT NULL DEFAULT 'zh-CN',

    author_id        TEXT,
    current_revision INTEGER,
    pending_revision INTEGER,

    /*
     * ⚠️ status **不含"已结束"**，这是刻意的。
     *
     * "已结束"是 starts_at_utc 的函数，随时钟自然成立。如果把它做成一个状态，
     * 就需要一个定时任务去翻它 —— 而那个任务一旦挂了（或被忘记部署），
     * 数据库里就会静默地留着一堆"显示为未开始的历史赛事"，
     * 没有任何报错，也没有人会去看。
     *
     * 派生出来的东西不会有这个失败模式：查询时比较一下当前时间就行。
     */
    status           TEXT    NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'published', 'rejected', 'hidden')),

    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
  );

  -- 主查询是"列出某一时间之后的事件"，按时间排 —— 覆盖索引直接用这个
  CREATE INDEX idx_calendar_starts ON calendar_events (status, starts_at_utc);

  -- ICS 导出只取已发布且未来的；这条部分索引让订阅请求不必扫全表
  CREATE INDEX idx_calendar_published
    ON calendar_events (starts_at_utc) WHERE status = 'published';

  -- -------------------------------------------------------------------------
  -- 用户自贴的视频链接
  -- -------------------------------------------------------------------------
  CREATE TABLE videos (
    id               TEXT PRIMARY KEY,

    user_id          TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    -- bilibili | youtube | twitch —— 与 shared/constants.ts 的 VIDEO_PLATFORMS 一致。
    -- 存平台名 + 视频 ID，**绝不抓取任何元数据**（标题由用户手填）。
    platform         TEXT    NOT NULL CHECK (platform IN ('bilibili', 'youtube', 'twitch')),
    video_id         TEXT    NOT NULL,

    /*
     * ⚠️ 视频只有一个标题，**没有 title_en**，这和其它内容不一样，是有理由的。
     *
     * 其它内容的 title 是**作者自己起的名字**，所以"给英文界面再起一个"是合理的。
     * 而视频的标题是**原视频自己的标题**，发帖人只是照抄。
     * 要求他为别人的视频再写一个英文标题，等于逼他**自己编一个翻译** ——
     * 而 Q19 明确说了"绝不自动翻译"，人工编一个只是把同一个问题换了个执行者。
     *
     * 英文界面下直接显示原标题（Q19 的回退规则）。
     */
    title            TEXT    NOT NULL,

    /*
     * 可选的起始偏移（Q21）：YouTube 有 ?start=，Twitch 有 ?time=，
     * **B站嵌入不支持**。B站要在界面上明说"该平台不支持跳转"，
     * 而不是默默丢掉这个参数 —— 默默丢掉会让人以为链接坏了。
     */
    start_offset_sec INTEGER CHECK (start_offset_sec IS NULL OR start_offset_sec >= 0),

    /*
     * 视频**不进审核队列**（用户 Q6 确认，且 v1 里压根没有 video.review 能力）。
     * 理由：视频本体托管在 B站/YouTube/Twitch，我们只存一个 ID，
     * 标题是唯一的自由文本，风险远低于正文；而审核会让"贴个视频"变成有延迟的事。
     *
     * 但**事后手段必须有**：作者可删，有 resource.moderate 的人可 hidden。
     * 隐藏后嵌入框不渲染 —— 不能留一个指向已隐藏视频的空壳。
     */
    status           TEXT    NOT NULL DEFAULT 'visible'
                             CHECK (status IN ('visible', 'hidden')),

    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL,

    /*
     * 同一个视频只能被贴一次。
     *
     * 为什么要有这条约束：视频墙上出现同一个视频两遍是**纯粹的噪音**，
     * 而它一定会发生 —— 热门比赛录像会被好几个人同时贴。
     * 有约束之后第二个人会收到一句明确的"这个视频已经在站上了"，
     * 那句话比"你的帖子和别人的重复了但没人知道"有用得多。
     */
    UNIQUE (platform, video_id)
  );

  -- 墙按时间倒序
  CREATE INDEX idx_videos_created ON videos (created_at DESC);
  -- 按平台筛选
  CREATE INDEX idx_videos_platform ON videos (platform, created_at DESC);
  -- 「这个人贴过的视频」（M5 的个人主页会用，但现在删自己的帖子就要用）
  CREATE INDEX idx_videos_user ON videos (user_id, created_at DESC);

  -- -------------------------------------------------------------------------
  -- 通用版本表（多态）
  -- -------------------------------------------------------------------------
  CREATE TABLE content_revisions (
    id               TEXT PRIMARY KEY,

    /*
     * 内容类型与实体 id。
     *
     * ⚠️ entity_id **没有外键**，因为它的指向随 type 变化
     *    （calendar 指向 calendar_events，将来 seed 指向 seed_shares），
     *    而 SQLite 的外键只能指向一张确定的表。
     *    代价是删实体时要自己清理版本行 —— 这个代价由应用层的删除逻辑承担，
     *    而不是假装数据库能替我们做。
     */
    type             TEXT    NOT NULL,
    entity_id        TEXT    NOT NULL,
    revision         INTEGER NOT NULL,

    /*
     * 这一版的内容快照，JSON。
     * 形状由 type 决定；**写入前必须过 Zod 校验**（见文件头）。
     */
    payload          TEXT    NOT NULL,

    status           TEXT    NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'approved', 'rejected')),

    /*
     * ⚠️ editor_id / reviewed_by **刻意不加外键** —— 与 resource_revisions 一致。
     *
     * 审核轨迹的意义在于"当时发生了什么"。如果加了 ON DELETE CASCADE，
     * 删掉一个账号就会**把它审过的所有记录一起抹掉**；
     * 如果加了 SET NULL，又会在真正需要追溯的时候变成一个空值。
     * 留着一个可能指向已删除用户的 id，是这三种里唯一不损失信息的做法。
     */
    editor_id        TEXT,
    note_to_reviewer TEXT,
    reviewed_by      TEXT,
    reviewed_at      INTEGER,
    review_reason    TEXT,

    created_at       INTEGER NOT NULL,

    -- 同一实体的版本号不重复
    UNIQUE (type, entity_id, revision)
  );

  -- 队列查询：只关心 pending 的行，部分索引让它比全表小得多
  CREATE INDEX idx_crev_queue
    ON content_revisions (created_at) WHERE status = 'pending';

  -- 取某实体最新一版（审核详情的"旧版 vs 新版"对比要用）
  CREATE INDEX idx_crev_entity
    ON content_revisions (type, entity_id, revision DESC);
`;
