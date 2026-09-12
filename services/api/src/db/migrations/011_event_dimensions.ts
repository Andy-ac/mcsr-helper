/**
 * 011：日历事件加两个筛选维度 —— `level`（专业程度）与 `scope`（参与范围）。
 *
 * ---------------------------------------------------------------------------
 * 为什么这条是安全的（和 007 / 008 那种"重建表"完全不同）
 * ---------------------------------------------------------------------------
 * `ADD COLUMN` 是 SQLite 里少数几个**不重建表**的结构变更之一：
 * 它只改表头、把新列对所有已有行填成默认值（这里是 NULL）。
 * 所以这条迁移不需要 `PRAGMA foreign_keys = OFF`，也就不需要 `noTransaction`，
 * 失败时能整体回滚。
 *
 * ⚠️ 但 `ADD COLUMN` 有几条 SQLite 明文规定的限制，写新迁移的人要知道：
 *   · 默认值不能是**非恒定**表达式（不能是 `CURRENT_TIMESTAMP` 之类）
 *   · 加了 `NOT NULL` 就必须同时给一个非 NULL 的默认值
 *   · 加了 `UNIQUE` 不允许
 *   这里两列都是可空、无默认值，所以三条都不碰。
 *
 * ---------------------------------------------------------------------------
 * 为什么不加 CHECK 约束
 * ---------------------------------------------------------------------------
 * ⚠️ 这正是 001 里 `kind` 那个 CHECK 留下的教训：**SQLite 改不了 CHECK**，
 *    加一个之后每多一个取值就要重建整张表（007 加 editor 角色就是这么被逼出来的）。
 *    `stage` 已经先例在先 —— 它也是一列可空 TEXT、没有 CHECK，
 *    取值由 shared 的 Zod 枚举把关。
 *
 *    这里是**事件表**，将来加一档"专业程度"是很可能的事；
 *    为了一个枚举完整性去换一次表重建，不划算。
 *    真正的防线在 `CalendarEventInputSchema`（服务端一定会跑）和
 *    `packages/shared/src/constants.ts` 的那两个数组 —— 它们有测试守着。
 *
 * ---------------------------------------------------------------------------
 * 关于既有数据
 * ---------------------------------------------------------------------------
 * 线上 `calendar_events` 目前是**空表**（迁移 010 刚上线，还没有人录过事件），
 * 所以"历史事件这两维是空的"这件事在数据上不存在。即使有，
 * NULL 也是正确的值：那表示"没填"，而不是"填了一个空字符串"。
 */
export const m011EventDimensions = `
  ALTER TABLE calendar_events ADD COLUMN level TEXT;
  ALTER TABLE calendar_events ADD COLUMN scope TEXT;

  -- 列表按这两个维度筛选时会用上；只建在"活着"的行上，
  -- 理由是日历的大部分查询都带 status 条件（见 010 里那条部分索引的先例）。
  CREATE INDEX idx_calendar_level ON calendar_events (level) WHERE status = 'published';
  CREATE INDEX idx_calendar_scope ON calendar_events (scope) WHERE status = 'published';
`;
