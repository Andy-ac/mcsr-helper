/**
 * 022：`tracked_creators.cooldown_until` —— 连续失败之后的**冷却窗口**。
 *
 * 为什么要这一列（2026-09-17 裁决，`docs/pending.md` §5.98）：生产的出口 IP 被 bilibili
 * 的风控盯上之后，同一份代码在干净出口上 `code=0`、在服务器上 `-352`/`412`，
 * 而 timer 每 **10 分钟**就叫这个博主再打一次 —— 那些请求**不会成功**，只是持续给
 * 这个 IP 的分数添柴。⇒ 连续失败满 `COOLDOWN_AFTER_FAILURES`（3）次就让他歇
 * `COOLDOWN_SEC`（3600 秒），时间到了照常重试（**不是**放弃这个频道）。
 *
 * ⚠️ 它必须是**一列**，不是"读 `last_error` 里有没有 `-352` 那几个字"：
 *   · 那个判据会把"冷却"这件事挂在**上游文案**上，bilibili 改一个错误码/一句话就断，
 *     而断了之后的表现是**静默地不再冷却**（照旧每 10 分钟喂一次）；
 *   · 它也只能表达"曾经失败过"，表达不了"冷却到几点"—— 而重试的时机正是全部内容。
 *   本仓对"不要按 message 判"已经有过一次裁决（`tracking/types.ts` 的文件头）。
 *
 * ⚠️ 单位是 **Unix 秒**（本栏目两张表一律秒，`audit_log` 才是毫秒）——与
 *   `last_synced_at` / `published_at` 同一个单位。传毫秒的表现是"冷却永远不过期"
 *   （那个死线跑到 5 万年以后），而**没有任何地方会报错**：`pickDueCreators`
 *   只是从此再也不挑他，摘要里那一格看起来完全正常。
 * ⚠️ 可空、**没有默认值**：`NULL` 是"不在冷却中"这个状态本身（写成 `0` 就与
 *   "冷却到 1970 年"分不开了，见 `packages/shared/src/tracking.ts` 里那一格）。
 * ⚠️ 不建索引：待办那两条查询本来就按 `(backfill_done, enabled)` 逐行判，
 *   名单规模是几十到几百，多一个索引只是多一处要维护的东西（与 021 同一条理由）。
 *
 * ⚠️ 只用 `ALTER TABLE … ADD COLUMN`：SQLite 支持，且**不需要**重建表
 *   ⇒ 这里没有任何一句需要 `PRAGMA foreign_keys`（与 009/013/014/018/019/020/021 同一个性质），
 *   所以迁移登记表里这条**不加** `noTransaction`：失败要能整体回滚。
 */
export const m022TrackedCreatorCooldown = `
ALTER TABLE tracked_creators ADD COLUMN cooldown_until INTEGER;
`;
