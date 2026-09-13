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
