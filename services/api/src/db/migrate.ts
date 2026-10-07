/**
 * 极简迁移器。
 *
 * 为什么手写而不是上 drizzle-kit：
 *   - 迁移文件就是普通 .sql，看得见、能直接跑、能被 esbuild 内联进单文件包
 *   - 没有配置文件、没有生成步骤、没有"忘记生成"导致的漂移
 *   - 总共约 30 行，出问题时能一眼读完
 *
 * 代价：没有自动生成迁移、没有 schema diff。手写建表语句对"几百行 schema"
 * 这个量级是划算的；如果哪天表多到十几个，再考虑上工具。
 *
 * 约定：
 *   · 迁移文件按文件名升序执行，名字即版本号
 *   · 每个迁移在**一个事务**里执行，失败整体回滚（SQLite 的 DDL 是事务性的）
 *   · 已执行过的记录在 _migrations 表里，重复运行安全
 */
import type { DatabaseSync } from 'node:sqlite';

import { m001Resources } from './migrations/001_resources';
import { m002ResourceSource } from './migrations/002_resource_source';
import { m003ResourceCardFields } from './migrations/003_resource_card_fields';
import { m004Auth } from './migrations/004_auth';
import { m005Revisions } from './migrations/005_revisions';
import { m006UploadsAndNotes } from './migrations/006_uploads_and_notes';
import { m007EditorRole } from './migrations/007_editor_role';
import { m008OwnerRole } from './migrations/008_owner_role';
import { m009ResourceMarks } from './migrations/009_resource_marks';
import { m010CalendarVideo } from './migrations/010_calendar_video';
import { m011EventDimensions } from './migrations/011_event_dimensions';
import { m012ResourceVideoAndLive } from './migrations/012_resource_video_and_live';
import { m013SeriesAndMarksIndex } from './migrations/013_series_and_marks_index';
import { m014UserLiveLinks } from './migrations/014_user_live_links';
import { m015LiveTagsAndSchedule } from './migrations/015_live_tags_and_schedule';
import { m016LiveDedupeKey } from './migrations/016_live_dedupe_key';
import { m017SlotsAndDimensions } from './migrations/017_slots_and_dimensions';
import { m018ContentContributors } from './migrations/018_content_contributors';
import { m019LiveShares } from './migrations/019_live_shares';
import { m020TrackedVideos } from './migrations/020_tracked_videos';
import { m021TrackedVideoVisibility } from './migrations/021_tracked_video_visibility';
import { m022TrackedCreatorCooldown } from './migrations/022_tracked_creator_cooldown';
import { m023LiveStatus } from './migrations/023_live_status';
import { m024ModTags } from './migrations/024_mod_tags';
import { m025ModPacks } from './migrations/025_modpacks';

/** 新增迁移时在这里按顺序追加。**已经发布的迁移不要改动**，加新的。 */
const MIGRATIONS: ReadonlyArray<{ name: string; sql: string; noTransaction?: boolean }> = [
  { name: '001_resources', sql: m001Resources },
  { name: '002_resource_source', sql: m002ResourceSource },
  { name: '003_resource_card_fields', sql: m003ResourceCardFields },
  { name: '004_auth', sql: m004Auth },
  { name: '005_revisions', sql: m005Revisions },
  { name: '006_uploads_and_notes', sql: m006UploadsAndNotes },
  /*
   * ⚠️ 重建 users 表才能改 CHECK 约束（SQLite 不支持 ALTER 约束），
   *    而**重建必须关掉外键**：开启外键时 DROP TABLE 会做一次隐式 DELETE，
   *    从而触发 sessions / email_tokens 的 ON DELETE CASCADE ——
   *    也就是"加一个角色"顺手把所有人的登录态清空、验证令牌丢掉。
   *
   *    而 `PRAGMA foreign_keys` **在事务里是无效的**（SQLite 明文规定），
   *    所以这条迁移必须跳出事务。这就是 noTransaction 存在的唯一理由。
   */
  { name: '007_editor_role', sql: m007EditorRole, noTransaction: true },
  // 同 007：加角色要重建 users 表，因而必须关外键、因而必须跳出事务。
  { name: '008_owner_role', sql: m008OwnerRole, noTransaction: true },
  // 纯加表，不动已有结构 —— 这条可以老老实实待在事务里
  { name: '009_resource_marks', sql: m009ResourceMarks },
  // 同 009：只建新表（calendar_events / videos / content_revisions），不动任何已有结构
  { name: '010_calendar_video', sql: m010CalendarVideo },
  /*
   * 011：给 calendar_events 加 level / scope 两列。
   *
   * ⚠️ `ADD COLUMN` 是 SQLite 里少数几个**不重建表**的结构变更，
   *    所以这条既不需要关外键、也不需要 noTransaction —— 失败能整体回滚。
   *    和 007 / 008 那两条重建 users 表的迁移**不是**一回事，
   *    别看到"改表结构"就条件反射地加 noTransaction（那会白白丢掉回滚）。
   */
  { name: '011_event_dimensions', sql: m011EventDimensions },
  /*
   * 012：resource kind 加 'video'（**重建 resources 表**）+ 建 live_channels。
   *
   * ⚠️ 又是 noTransaction —— 重建表要关外键，而那个 PRAGMA 在事务里无效。
   *    也就是**失败没有回滚**：这一条比 007/008 更要紧，因为它动的是
   *    存着用户内容的表。部署前必须先在**生产库副本**上演练，
   *    并且 `VACUUM INTO` 备份 + 回读校验（见 .cache/rehearse-migration.mjs）。
   */
  { name: '012_resource_video_and_live', sql: m012ResourceVideoAndLive, noTransaction: true },
  /*
   * 013：系列活动（③）+ 收藏数索引（⑤）。
   *
   * ⚠️ 这条**故意不加 noTransaction**：`CREATE INDEX` / `CREATE TABLE` /
   *    `ADD COLUMN ... REFERENCES` 三件事在 SQLite 里都**不重建表**，
   *    也就不需要 `PRAGMA foreign_keys = OFF`（那个 PRAGMA 在事务里无效）。
   *    留在事务里才能失败即回滚 —— 上面的 011 注释专门警告过"别条件反射加 noTransaction"。
   */
  { name: '013_series_and_marks_index', sql: m013SeriesAndMarksIndex },
  /*
   * 014：④ 私人直播链接（`user_live_links`）—— 只给自己看的那一份。
   *
   * ⚠️ 和 013 同一个性质：纯 `CREATE TABLE` / `CREATE INDEX`，**不重建任何表**，
   *    所以同样**不加** noTransaction（留在事务里才能失败即回滚）。
   * ⚠️ 表名/编号：spec 的 §5.3b/D4b.2 里还写着"迁移 013 里加一条 CREATE TABLE" ——
   *    那句**已经过期**（013 已随 ③⑤ 发布，已发布的迁移不许改）。本轮是 014。
   */
  { name: '014_user_live_links', sql: m014UserLiveLinks },
  /*
   * 015：两处「允许填多个值」—— 直播频道的标签、活动可以填离散的多个时间段。
   *
   * ⚠️ 两条都是 `ALTER TABLE ... ADD COLUMN`（可空、无默认值），**不重建表**：
   *    SQLite 的 ADD COLUMN 是 O(1) 的元数据操作，既有行拿到 NULL。
   *    这与 011（加 level/scope 两列）同一个形状，所以同样**加进事务**即可。
   */
  { name: '015_live_tags_and_schedule', sql: m015LiveTagsAndSchedule },
  /*
   * 016：重建 `live_channels`，把去重键放宽成 `(platform, handle, live_video_id)`。
   *
   * ⚠️ **必须 `noTransaction`**：SQL 第一句是 `PRAGMA foreign_keys = OFF`，
   *    而 PRAGMA **在事务里是静默无效的**（不报错，只是不生效）—— 那样重建到一半
   *    失败会留下一个半成品表，而部署脚本报的是成功。理由与 012 完全相同。
   * ⚠️ 它与 012 一样属于"不可回滚的一次动作"，代价可接受：这张表只有三行。
   */
  { name: '016_live_dedupe_key', sql: m016LiveDedupeKey, noTransaction: true },
  /*
   * 017：多段时间 + 参赛门槛 + 参与范围明细 + 系列颜色，并删掉 015 的 schedule_text。
   *
   * ⚠️ **留在事务里**（不加 noTransaction）：全是 `ADD COLUMN` 与一次 `DROP COLUMN`，
   *    不需要关外键 ⇒ 失败即整条回滚，不会留下半成品。
   * ⚠️ `DROP COLUMN` 要 SQLite ≥ 3.35。部署前在本机实测过版本（3.53.4）；
   *    线上同一个 Node 运行时，所以同一个 SQLite。
   */
  { name: '017_slots_and_dimensions', sql: m017SlotsAndDimensions },
  /*
   * 018：内容贡献者（`content_contributors`）。
   *
   * ⚠️ 与 009/013/014 同一个性质：**纯建表 + 建索引**，不重建任何表 ⇒
   *    **留在事务里**（不加 noTransaction），失败即整体回滚。
   *    别看到"加一张通用表"就想给它关外键 —— 那个 PRAGMA 在事务里无效，
   *    而这条迁移一个字都不需要它（理由见 018 的文件头）。
   *
   * ⚠️ 这张表的 `(entity_type, entity_id)` **没有外键**（SQLite 表达不了
   *    "指向好几张表里的那一张"）⇒ 删内容时必须自己清贡献者行。
   *    落点在 `resources.ts` 的两条硬删除路径上，有测试守着。
   */
  { name: '018_content_contributors', sql: m018ContentContributors },
  /*
   * 019：实时分享（`live_shares`）—— 一块"到点自己消失"的看板。
   *
   * ⚠️ 与 009/013/014/018 同一个性质：**纯建表 + 建索引**，不重建任何表 ⇒
   *    **留在事务里**（不加 noTransaction），失败即整体回滚。
   *    这里没有任何一句需要 `PRAGMA foreign_keys`（理由见 019 的文件头二）。
   *
   * ⚠️ 这张表里有一个**部分唯一索引**（`idx_live_shares_room_one`，谓词
   *    `kind='room' AND status='active'`），它的谓词**不看过期** ⇒ 发布 room 时
   *    "先把我自己 active 的行置 replaced"是必需步骤，不是清理。落点在
   *    `live-shares.ts` 的 `createShare`，有两条测试钉着（spec §3.4）。
   */
  { name: '019_live_shares', sql: m019LiveShares },
  /*
   * 020：视频博主追踪（`tracked_creators` / `tracked_videos`）。
   *
   * ⚠️ 与 009/013/014/018/019 同一个性质：**纯建表 + 建索引**，不重建任何表 ⇒
   *    **留在事务里**（不加 noTransaction），失败即整体回滚。
   *    这里没有任何一句需要 `PRAGMA foreign_keys`（理由见 020 的文件头第四节）。
   *
   * ⚠️ 两张表的 `UNIQUE (platform, external_id)` 与两个 `ON DELETE` 是**功能**而不是装饰：
   *    删掉唯一约束不会有任何报错，只是每次增量都插重复行（`ON CONFLICT` 那个子句
   *    也会跟着写不出来）；把 `tracked_videos` 的 `CASCADE` 写成 `NO ACTION` 则是
   *    "删了博主，他的视频留成孤儿"。`tracking-schema.test.ts` 的 ③④⑥⑧ 各钉一条。
   */
  { name: '020_tracked_videos', sql: m020TrackedVideos },
  /*
   * 021：`tracked_videos` 的可见性三列（`docs/tracked-embed-spec.md` §3）。
   * ⚠️ 纯 `ALTER TABLE ADD COLUMN`，不重建表 ⇒ 不需要 `PRAGMA foreign_keys`。
   * ⚠️ 不登记 = 不跑，而症状是"代码看着对、库里没有那三列"（020 那一轮踩过）。
   */
  { name: '021_tracked_video_visibility', sql: m021TrackedVideoVisibility },
  /*
   * 022：`tracked_creators.cooldown_until` —— 连续失败 3 次之后的 1 小时冷却窗口
   * （`docs/pending.md` §5.98 的处置；冻结值写在 §10 那张表里）。
   *
   * ⚠️ 与 011 / 015 / 021 同一个形状：纯 `ALTER TABLE ADD COLUMN`（可空、无默认值），
   *    **不重建表** ⇒ 不需要 `PRAGMA foreign_keys`，**留在事务里**（不加 noTransaction），
   *    失败即整条回滚。别看到"改表结构"就条件反射加 noTransaction。
   * ⚠️ 不登记 = 不跑，而症状是"代码看着对、库里没有那一列"（020 与 021 两轮都踩过，
   *    `tracking-schema.test.ts` 末尾那一组专门钉"它在 `_migrations` 里"）。
   */
  { name: '022_tracked_creator_cooldown', sql: m022TrackedCreatorCooldown },
  /*
   * 023：`live_channels` 的直播状态三列（`is_live` / `viewer_count` / `live_checked_at`）——
   * 「直播」那一页第一次会显示"在不在播"和人数（用户第 10 条）。
   *
   * ⚠️ 与 011 / 015 / 021 / 022 同一个形状：纯 `ALTER TABLE ADD COLUMN`（可空、无默认值，
   *    外加一条 `CHECK (is_live IN (0,1))` —— 本机在生产副本上实测过 SQLite 收得下它），
   *    **不重建表** ⇒ 不需要 `PRAGMA foreign_keys`，**留在事务里**（不加 noTransaction），
   *    失败即整条回滚。
   * ⚠️ 为什么不建索引：这一页一共 184 行，新排序走 `idx_live_listing` + 临时 B 树，
   *    实测 20 次合计 **8.9 ms**（探针；同一份快照上演练脚本另量到 12.1 ms，两个数
   *    都留档）。读数、出处与理由写在 `023_live_status.ts` 的文件头第三节。
   */
  { name: '023_live_status', sql: m023LiveStatus },
  { name: '024_mod_tags', sql: m024ModTags },
  { name: '025_modpacks', sql: m025ModPacks },
];

export function runMigrations(db: DatabaseSync): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT    PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const rows = db.prepare('SELECT name FROM _migrations').all() as Array<{ name: string }>;
  const applied = new Set(rows.map((r) => r.name));
  const justApplied: string[] = [];

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;

    /*
     * ⚠️ 绝大多数迁移包在事务里：失败就整个回滚，不留半截状态。
     *
     * 例外只有一种：迁移里要用 `PRAGMA foreign_keys`（重建表时必须关它），
     * 而那个 PRAGMA **在事务里是无效的**。这类迁移要自己保证幂等与顺序，
     * 代价是失败时没有回滚 —— 所以 MIGRATIONS 里标了 noTransaction 的，
     * 部署前必须拿真实数据库的副本演练过。
     */
    if (migration.noTransaction) {
      db.exec(migration.sql);
      db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(
        migration.name,
        Date.now(),
      );
      justApplied.push(migration.name);
      continue;
    }

    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(
        migration.name,
        Date.now(),
      );
      db.exec('COMMIT');
      justApplied.push(migration.name);
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(
        `迁移 ${migration.name} 失败，已回滚：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return justApplied;
}

export const MIGRATION_NAMES = MIGRATIONS.map((m) => m.name);
