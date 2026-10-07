/**
 * ★ B2 / 迁移 025：整合包。
 *
 * | 表 | 语义 |
 * |---|---|
 * | `modpacks` | 一个包 = 标题 + 简介 + **一个游戏版本** + 一组 modid（JSON 数组，**保序**：装的时候按这个顺序） |
 *
 * ⚠️ `id` 用 **uuid** 而不是可读 slug：标题会改，而 id 一旦被页面记着就不该跟着改
 *    （与 `live_channels` / `tracked_creators` 同一条先例）。
 * ⚠️ `hot` 存 0/1 + `CHECK`：SQLite 没有 boolean。
 * ⚠️ 纯 `CREATE TABLE`（没有数据回填）⇒ **留在事务里**（`migrate.ts` 里那条 `noTransaction` 只给
 *    "需要显式控制事务"的迁移）。
 * ⚠️ `created_by` 的 `ON DELETE SET NULL`：删掉一个人不该把包一起删掉（与 024 同一形状）。
 * ⚠️ `modids` 是 **JSON 文本**：坏掉的那一格由数据层**整条丢掉**（见 `modpacks.ts`）。
 */
export const m025ModPacks = `
  CREATE TABLE IF NOT EXISTS modpacks (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    game_version  TEXT NOT NULL,
    modids        TEXT NOT NULL,
    hot           INTEGER NOT NULL DEFAULT 0 CHECK (hot IN (0, 1)),
    created_by    TEXT REFERENCES users (id) ON DELETE SET NULL,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_modpacks_game_version ON modpacks (game_version, created_at);
`;
