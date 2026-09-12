import { sql } from '../sql';

/**
 * 005 · 提交 → 待审 → 发布管线与版本快照
 *
 * ---------------------------------------------------------------------------
 * 核心设计：`resources` 行上存的是**线上版本**，revisions 是快照
 * ---------------------------------------------------------------------------
 * 验收标准里那句「用户改已发布条目 → 自动回 pending 且**线上仍是旧版**」
 * 是这一整套设计要解决的问题。
 *
 * 两种做法：
 *
 *   A. 内容只存在 revisions 里，resources 只留一个指针指向"线上版本"。
 *      模型最干净，但**读取路径要全部改成 join** —— 列表、详情、标签聚合、
 *      导入脚本、以及已经写好的测试都得动。改动面很大，而换来的表达力
 *      在这个场景里用不上。
 *
 *   B. **内容留在 resources 行上 = 线上版本**；revisions 是快照表，
 *      既存待审的草稿，也存已发布过的历史。
 *
 * 选了 B。理由是"线上仍然是旧版"这条约束**天然成立**：
 * 作者提交修改时，只往 revisions 里写一条 pending 快照，
 * 根本不碰 resources 行 —— 所以不存在"改错了地方导致线上被改掉"的可能。
 * 而读取路径一行都不用改。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ current_revision 为空表示"不受版本追踪"，不是"数据缺失"
 * ---------------------------------------------------------------------------
 * 导入的内容（`source = 'import'`）由管理员直接录入，不经过审核管线，
 * 所以它们**没有** revision，current_revision 保持 NULL。
 *
 * 这是刻意的，而不是偷懒：导入脚本每次部署都会跑一遍并可能改写内容，
 * 如果给它也建 revision，就会出现"current_revision 指向的那一版
 * 和线上内容对不上"的状态 —— 一个只会在某个部署之后才显现、
 * 而且很难归因的不一致。
 *
 * 这个边界是安全的，因为**用户不可能编辑导入的条目**：
 * PATCH 只允许作者本人，而导入条目的 author_id 是 NULL。
 *
 * ---------------------------------------------------------------------------
 * 为什么用三张表/字段拆分状态
 * ---------------------------------------------------------------------------
 * 一个已发布条目被编辑时，有三种状态同时存在且互不相同：
 *   · 线上版本：旧内容（继续对外展示）
 *   · 待审版本：新内容（等待审核）
 *   · 条目的发布状态：仍然是"已发布"
 * 把它们塞进一个 status 字段是不可能的 —— 无论怎么写都会在某一侧出错。
 * 所以拆成：resources.status（发布状态）+ resources.pending_revision（待审指针）
 * + resource_revisions.status（单个版本的审核结果）。
 */
export const m005Revisions = sql`
  -- 作者。导入的内容为 NULL（管理员直接录入，没有作者）。
  ALTER TABLE resources ADD COLUMN author_id TEXT;

  -- 当前线上内容对应的版本号。NULL = 该条目不受版本追踪（导入的内容）。
  ALTER TABLE resources ADD COLUMN current_revision INTEGER;

  -- 待审版本号。NULL = 没有待审的修改。
  -- 它的存在让"这个条目有未审核的改动"变成一个可以一条 SQL 查出来的事实，
  -- 而不是要去 revisions 表里扫 —— 审核队列和列表页的角标都要用它。
  ALTER TABLE resources ADD COLUMN pending_revision INTEGER;

  CREATE TABLE resource_revisions (
    id           TEXT    PRIMARY KEY,
    resource_id  TEXT    NOT NULL REFERENCES resources (id) ON DELETE CASCADE,
    revision     INTEGER NOT NULL,

    -- ---- 内容快照 ----
    -- 字段与 resources 保持一致；这里是**拍摄的那一刻**的样子，
    -- 之后不再变。审核看的就是它，而不是 resources 行 ——
    -- 否则作者可以在"提交之后、审核之前"再改一次内容，
    -- 审核员批准的是 A、上线的却是 B。
    kind      TEXT NOT NULL,
    title     TEXT NOT NULL,
    title_en  TEXT,
    url       TEXT NOT NULL,
    image_url TEXT,
    summary   TEXT,
    body      TEXT NOT NULL,
    lang      TEXT NOT NULL,
    tags      TEXT NOT NULL,

    -- ---- 审核 ----
    status        TEXT    NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'approved', 'rejected')),
    editor_id     TEXT,
    created_at    INTEGER NOT NULL,
    reviewed_by   TEXT,
    reviewed_at   INTEGER,
    review_reason TEXT,

    UNIQUE (resource_id, revision)
  );

  -- 审核队列：按状态 + 时间取最早的几条
  CREATE INDEX idx_rev_queue ON resource_revisions (status, created_at);

  -- 某个条目的版本历史
  CREATE INDEX idx_rev_resource ON resource_revisions (resource_id, revision DESC);

  -- "我提交的内容"—— 个人主页（M5）和 M2 的"我的提交"列表都要按作者查
  CREATE INDEX idx_resources_author ON resources (author_id, created_at DESC);

  -- 只给有待审内容的行建索引。审核队列通常只关心这一小撮，
  -- 而绝大多数行 pending_revision 是 NULL —— 部分索引让索引小得多。
  CREATE INDEX idx_resources_pending ON resources (pending_revision)
    WHERE pending_revision IS NOT NULL;
`;
