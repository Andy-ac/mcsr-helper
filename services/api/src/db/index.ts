/**
 * 数据库连接。
 *
 * 用 Node 内置的 `node:sqlite`，不是 better-sqlite3 —— 原因是部署模型：
 * 本项目把后端 esbuild 打包成**单个 server.js，不传 node_modules**，
 * 而 better-sqlite3 是原生模块（.node 文件），会直接破坏这一点。
 *
 * `node:sqlite` 在 Node 22.23.2 上开箱可用（已验证，WAL 也支持），代价是它标注为
 * experimental。为了不让这个选择扩散到全项目，**所有 SQL 只经过 db/index.ts 和
 * resources.ts 两个文件** —— 将来要换驱动，改的是这里，不是每一处查询。
 *
 * 另外它有一个正好合我们意的性质：**读取超出 JS 安全范围的 64 位整数会抛错，
 * 而不是静默截断**。也就是说 packages/shared/src/seed.ts 里那条"种子必须存字符串"
 * 的铁律，在数据库这一层是**机器强制**的，不只靠注释。
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from './migrate';

export type Db = DatabaseSync;

let instance: Db | null = null;

export function dbPath(): string {
  return process.env.DB_PATH ?? './data/mcsr.db';
}

export function getDb(): Db {
  if (instance) return instance;

  const path = dbPath();
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new DatabaseSync(path);

  // WAL：读写不互相阻塞。列表页是纯读、导入是写，两者会并发。
  db.exec('PRAGMA journal_mode = WAL');
  // NORMAL 在 WAL 下是安全的（断电最多丢最后一个事务，不会损坏库），
  // 而 FULL 每次提交都 fsync —— 对 1 核小机器来说太贵。
  db.exec('PRAGMA synchronous = NORMAL');
  // 外键约束默认是关的，必须显式打开，否则写了 REFERENCES 也不生效。
  db.exec('PRAGMA foreign_keys = ON');
  // 被别的连接锁住时等 5 秒再报错，而不是立刻 SQLITE_BUSY。
  db.exec('PRAGMA busy_timeout = 5000');

  runMigrations(db);

  instance = db;
  return db;
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}
