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

/** 新增迁移时在这里按顺序追加。**已经发布的迁移不要改动**，加新的。 */
const MIGRATIONS: ReadonlyArray<{ name: string; sql: string }> = [
  { name: '001_resources', sql: m001Resources },
  { name: '002_resource_source', sql: m002ResourceSource },
  { name: '003_resource_card_fields', sql: m003ResourceCardFields },
  { name: '004_auth', sql: m004Auth },
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
