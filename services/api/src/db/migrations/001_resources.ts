import { sql } from '../sql';

/**
 * 001 · 资源库
 *
 * 设计说明见 docs/v1-plan.md §3。几个刻意的选择：
 *
 *   · tags 存成 JSON 文本数组，而不是建关联表。
 *     理由：M1 的规模是"几百条"，用 `tags LIKE '%"tools"%'` 精确匹配（带引号所以不会
 *     误配 `tools-extra`）足够快，而且省掉一张表和一堆 join。
 *     什么时候该改：当条目到几千条、或者需要"按标签出现频次排序"时。
 *
 *   · SQLite 没有 boolean，featured 用 INTEGER 0/1。
 *
 *   · status 现在只有 published 会被写进去（M1 没有提交界面），
 *     但 CHECK 里把全套枚举都列上，这样 M2 加审核流时不用改表结构。
 *
 *   · 种子的教训在这里同样适用：**任何 64 位整数都不要用 INTEGER 列**。
 *     node:sqlite 读超出 JS 安全范围的整数会直接抛错（这点是好事），
 *     所以种子、VOD ID 这类值一律 TEXT。
 */
export const m001Resources = sql`
  CREATE TABLE resources (
    id          TEXT    PRIMARY KEY,
    kind        TEXT    NOT NULL CHECK (kind IN ('website', 'tool')),
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
    updated_at  INTEGER NOT NULL
  );

  CREATE INDEX idx_resources_listing ON resources (status, featured DESC, updated_at DESC);
  CREATE INDEX idx_resources_kind ON resources (kind, status);
  CREATE INDEX idx_resources_lang ON resources (lang, status);
`;
