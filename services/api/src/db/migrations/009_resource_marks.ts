/**
 * 009：用户对条目的个人标记 —— 收藏、备注、评分。
 *
 * ---------------------------------------------------------------------------
 * 为什么三件事共用一张表
 * ---------------------------------------------------------------------------
 * 它们都是"**某个用户 × 某条内容**"上的一份数据，而且几乎总是一起用
 * （在详情页上就在同一块界面里）。拆成三张表的话，读"我对这条的全部标记"
 * 要 JOIN 三次，而它们的生命周期完全一致（用户删了、内容删了就一起没）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 备注是**私有的**
 * ---------------------------------------------------------------------------
 * 它是"我记一下这个工具怎么用/为什么收藏"，**不是**给所有人看的评论。
 * 所以：
 *   · 任何公开接口都不返回它，只有本人读自己的那一条；
 *   · 想公开说点什么，正确的入口是"修改条目"（走审核）——
 *     那条路有审核、有审计，而备注是私事，不该经过审核。
 *
 * 评分则相反：**聚合值（平均分 + 人数）是公开的**，但**谁给了几分不公开**。
 * 这是刻意的：评分要能影响别人的判断才有意义，而逐个列出评分人就变成了
 * 评论系统 —— 那需要另一套东西（回复、举报、审核）。
 */
export const m009ResourceMarks = `
  CREATE TABLE resource_marks (
    user_id     TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    resource_id TEXT    NOT NULL REFERENCES resources (id) ON DELETE CASCADE,

    -- 收藏。"已收藏但没有备注没有评分"是最常见的状态，所以它是独立的一列，
    -- 而不是"有备注就算收藏"这种推断。
    favorite    INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
    -- 个人备注。NULL = 没写。
    note        TEXT,
    -- 评分 1–5。NULL = 没评过（**和 0 分是两回事**：没评过不进平均分）。
    rating      INTEGER CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),

    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,

    -- 一个用户对一条内容只有一行
    PRIMARY KEY (user_id, resource_id)
  );

  -- 收藏列表：按用户查，最近的在前
  CREATE INDEX idx_marks_user ON resource_marks (user_id, updated_at DESC);

  -- 评分聚合：按内容查，只关心有评分的行 —— 部分索引让它比全表小得多
  CREATE INDEX idx_marks_rating ON resource_marks (resource_id)
    WHERE rating IS NOT NULL;
`;
