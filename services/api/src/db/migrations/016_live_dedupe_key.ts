/**
 * 016：重建 `live_channels`，把去重键从 `(platform, handle)` 放宽成
 *      `(platform, handle, live_video_id)`（2026-09-13，用户要求 ② 的后果）。
 *
 * ===========================================================================
 * 为什么必须重建 —— SQLite 改不了表级 UNIQUE
 * ===========================================================================
 * 与 012 重建 `resources`（改 `kind` 的 CHECK）同一个理由：**约束写在表定义里，
 * 没有 ALTER 能改它**。所以只能"建新表 → 拷数据 → 删旧表 → 改名 → 重建索引"。
 *
 * ===========================================================================
 * 为什么非改不可（不改会静默挡住一整类行）
 * ===========================================================================
 * 用户把「直播」的表单改成**只填一条链接**（显示名 / 直播链接 / 说明 / 标签），
 * 平台、频道标识、视频 ID 全部由服务端从那条链接解析。于是会出现这一类行：
 *
 *     你粘的是**某一场直播的视频页**（例如 youtube.com/watch?v=zsb-ZDznGIA）
 *     ⇒ 解析结果：platform='youtube'、handle=**空串**、live_video_id='zsb-ZDznGIA'
 *
 * 而链接里没有频道信息，所以 `handle` 只能是空串 —— **这是诚实的表示**，
 * 不是缺失。但旧的 `UNIQUE (platform, handle)` 之下，它意味着
 * **"每个平台最多只能有一条这种行"**：再粘第二个 YouTube 主播的直播链接，
 * 会被判成重复，报出来还是"这条已经记过了" —— 一句完全指错方向的话。
 *
 * ⇒ 把 `live_video_id` 并入去重键之后：
 *   · 同一条直播视频不会被记两遍（仍然防重复，这是 UNIQUE 的本意）；
 *   · 不同的直播视频可以并存（不管 handle 空不空）。
 *
 * ⚠️ 仍然**不是** `UNIQUE (platform, live_video_id)`：那样会让"同一个频道、
 *    不同场次"变成两行 —— 而那份清单记的是**频道**，重复记录的语义没变。
 *
 * ===========================================================================
 * ⚠️⚠️ SQL 注释里不能有反引号（012 在这上面踩过 4 次）
 * ===========================================================================
 * 模板串会被提前闭合，报错指向 SQL 中间某一行，和真正原因毫无关系。
 * 本文件里所有 SQL 注释都用「」或单引号。
 */
export const m016LiveDedupeKey = `
  PRAGMA foreign_keys = OFF;

  -- -------------------------------------------------------------------------
  -- 1) 建新表：**唯一**的改动是最后那行 UNIQUE
  -- -------------------------------------------------------------------------
  CREATE TABLE live_channels_new (
    id            TEXT PRIMARY KEY,

    platform      TEXT    NOT NULL
                          CHECK (platform IN ('youtube', 'twitch', 'bilibili')),

    /*
     * 频道标识。**可以为空串** —— 当用户粘的是"某一场直播的视频页"时，
     * 链接里没有频道信息（016 起允许这种行）。
     * 仍然是标识而不是链接：链接由 liveChannelUrl() 按平台拼。
     */
    handle        TEXT    NOT NULL,

    display_name  TEXT    NOT NULL,
    note          TEXT,

    /** 可选：当前这场直播的视频 ID。有它才嵌（YouTube）。 */
    live_video_id TEXT,

    /** 频道级嵌入的试验开关。默认关。 */
    embed_channel INTEGER NOT NULL DEFAULT 0 CHECK (embed_channel IN (0, 1)),

    sort_order    INTEGER NOT NULL DEFAULT 100,

    status        TEXT    NOT NULL DEFAULT 'visible'
                          CHECK (status IN ('visible', 'hidden')),

    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,

    -- 015 加的标签列（JSON 数组文本）。重建时必须带上，否则会丢掉这一列。
    tags          TEXT,

    /** 本次迁移**唯一**改动的地方：把 live_video_id 并进去重键。 */
    UNIQUE (platform, handle, live_video_id)
  );

  INSERT INTO live_channels_new
    (id, platform, handle, display_name, note, live_video_id, embed_channel,
     sort_order, status, created_at, updated_at, tags)
  SELECT
     id, platform, handle, display_name, note, live_video_id, embed_channel,
     sort_order, status, created_at, updated_at, tags
    FROM live_channels;

  DROP TABLE live_channels;
  ALTER TABLE live_channels_new RENAME TO live_channels;

  -- 2) 索引要重建：DROP TABLE 会把旧索引一起带走
  CREATE INDEX idx_live_listing ON live_channels (status, sort_order);

  /*
   * ⚠️⚠️ **必须把外键打开 —— 这一条漏过一次，是测试抓出来的。**
   *
   * 007 / 008 / 012 三条重建型迁移的最后都有这一句，而第一版 016 **漏了**。
   * 后果不是"这条迁移出错"，而是**从它之后的整个进程里外键一直是关的**：
   * 级联删除不再生效、插入孤儿行不再报错 —— 而测试里那些"删账号他的私人行
   * 跟着走（CASCADE 真的生效）"会红在**别的文件**里，和这条迁移看不出关系。
   * 表现正是本仓反复记档的形状：**错误在别处显形**。
   */
  PRAGMA foreign_keys = ON;
`;
