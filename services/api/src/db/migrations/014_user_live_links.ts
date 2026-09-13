/**
 * 014：④ 私人直播链接（`user_live_links`）。
 *
 * 一张**纯新建**的表：任何已登录用户贴的链接都存在这里，**只给自己看**、
 * 不进公开名单、不参与审核（D4b.1 / D4b.2）。
 *
 * ===========================================================================
 * ⚠️ 为什么是**新表**，而不是给 `live_channels` 加一个 `user_id`
 * ===========================================================================
 * `live_channels` 上的 `UNIQUE (platform, handle)` 是**表级**约束，要把它改成
 * `UNIQUE (user_id, platform, handle)` 就只能**重建整张表** —— 那是本仓唯一一类
 * 不可回滚的动作（`noTransaction`，失败没有回滚；见 007/008/012 的文件头）。
 * 而"新建一张表"是纯建表、可回滚。所以哪怕只差一列，也走新表。
 *
 * ⚠️ 另外：个人化模型下**判重不再是问题** —— "同一个人加两条同一个频道"是允许的
 *    （用户把"不要审核"与"只给自己看"一起定了）。所以这张表上**故意没有**
 *    `UNIQUE(platform, handle)` 那套（D4b.2）。
 *
 * ===========================================================================
 * ⚠️ 这条迁移**不需要** noTransaction，也**不要**给它加
 * ===========================================================================
 * `CREATE TABLE` / `CREATE INDEX` 在 SQLite 里都**不重建表**，所以：
 *   · 不需要 `PRAGMA foreign_keys = OFF`（那个 PRAGMA 在事务里无效）；
 *   · 因此**必须留在事务里**：失败时整体回滚（`migrate.ts:56-63` 专门警告过
 *     "别看到改表结构就条件反射加 noTransaction"）。
 *
 * ===========================================================================
 * ⚠️ 写这条迁移时**不要**在模板字符串里用反引号
 * ===========================================================================
 * 一个反引号就会提前闭合模板串，报错指向 SQL 的中间某行，和真正的原因毫无关系
 * （012 在这上面踩过 4 处）。SQL 注释里用「」或单引号括标识符。
 *
 * ===========================================================================
 * 部署前
 * ===========================================================================
 * 仍然要在**生产库副本**上先跑一遍（`.cache/rehearse-migration.mjs` 的写法），
 * 并确认：`user_live_links` 建出来了、索引 `idx_user_live_user` 在、
 * 外键指向 `users` 且是 `ON DELETE CASCADE`、以及 `_migrations` 里出现 014。
 */

export const m014UserLiveLinks = `
  /*
   * 一行 = 用户自己贴的一条链接。
   *
   * ⚠️ url 是**用户提供的原始数据**，必须原样留下（D4b.2）：解析不出来的链接
   *    也允许保存（那时 platform / handle 都是 NULL，界面只给外链）。
   *    把它丢掉、只存"解析结果"的话，用户贴错一次就永远看不到自己贴的是什么。
   * ⚠️ platform 的取值刻意**只允许三个平台或 NULL**：CHECK 挡的是"我们自己的解析
   *    写进了一个不该有的值"，而不是用户输入（用户输入是 url，平台由我们推导）。
   * ⚠️ handle 存的是**归一化后的标识**，绝不会是链接（不变量写在 shared/live.ts）。
   */
  CREATE TABLE user_live_links (
    id            TEXT    PRIMARY KEY,
    user_id       TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    url           TEXT    NOT NULL,
    platform      TEXT    CHECK (platform IS NULL OR platform IN ('youtube', 'twitch', 'bilibili')),
    handle        TEXT,
    live_video_id TEXT,
    title         TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );

  /*
   * 唯一的查询形状是"我的行，按新到旧"（列表就是这一条），所以索引按 (user_id, created_at DESC) 建。
   * ⚠️ 账下的 ORDER BY 还会带一个 id 作第二键（同一毫秒写入的两行顺序要钉死，
   *    否则刷新一次会换位），那是索引覆盖不到的最后一点点排序，代价可以忽略。
   */
  CREATE INDEX idx_user_live_user ON user_live_links (user_id, created_at DESC);
`;
