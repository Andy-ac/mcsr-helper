/**
 * 021：`tracked_videos` 的可见性三列（spec `tracked-embed-spec.md` §3）。
 *
 * · `verify_checked_at` —— CLI 的核对阶段每一次问过上游就写一次（在的与不在的都写），
 *   它同时是**轮转游标**：候选查询按 `COALESCE(verify_checked_at, 0) ASC` 挑，
 *   不写这一列的话被问过的那批会永远占着队首。
 * · `hidden_at` / `hidden_reason` —— 被隐藏的时刻与原因。`hidden_reason` 今天的词表
 *   只有一个值 `upstream_gone`（spec §3.2）。
 *
 * ⚠️ 三列都是 **Unix 秒**（本栏目两张表一律秒，`audit_log` 才是毫秒）。
 * ⚠️ 只用 `ALTER TABLE … ADD COLUMN`：SQLite 支持，且**不需要**重建表
 *    ⇒ 这里没有任何一句需要 `PRAGMA foreign_keys`（与 009/013/014/018/019/020 同一个性质）。
 * ⚠️ 不建新索引：候选查询的规模是每个博主几百到几千行，现有的
 *    `idx_tracked_videos_recent` 够用（spec §3 明写）。
 */
export const m021TrackedVideoVisibility = `
ALTER TABLE tracked_videos ADD COLUMN verify_checked_at INTEGER;
ALTER TABLE tracked_videos ADD COLUMN hidden_at INTEGER;
ALTER TABLE tracked_videos ADD COLUMN hidden_reason TEXT;
`;
