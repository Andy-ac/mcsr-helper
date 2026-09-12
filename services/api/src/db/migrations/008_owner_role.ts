/**
 * 008：users.role 的 CHECK 约束加上 'owner'。
 *
 * ---------------------------------------------------------------------------
 * 又是重建表，理由和 007 一样
 * ---------------------------------------------------------------------------
 * SQLite 改不了 CHECK 约束，只能"建新表 → 拷数据 → 换名"。
 * 而且必须**关掉外键**（DROP TABLE 在开启外键时会做隐式 DELETE，
 * 触发 sessions / email_tokens 的 ON DELETE CASCADE —— 也就是把所有人的
 * 登录态清空），而 `PRAGMA foreign_keys` 在事务里无效，
 * 所以这条迁移同样走 noTransaction（见 migrate.ts 里 007 的注册处）。
 *
 * ⚠️ 部署前必须拿生产库的副本演练一遍 —— 这条迁移没有事务可回滚。
 *    （.cache/rehearse-migration.mjs 就是干这个的。）
 */
export const m008OwnerRole = `
  PRAGMA foreign_keys = OFF;

  CREATE TABLE users_new (
    id                TEXT    PRIMARY KEY,
    email             TEXT    NOT NULL UNIQUE,
    password_hash     TEXT    NOT NULL,
    display_name      TEXT    NOT NULL,
    avatar_url        TEXT,
    -- ⚠️ 这次迁移唯一改动的地方：多一个 'owner'
    role              TEXT    NOT NULL DEFAULT 'user'
                              CHECK (role IN ('user', 'reviewer', 'editor', 'admin', 'owner')),
    locale            TEXT    NOT NULL DEFAULT 'zh-CN',
    status            TEXT    NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'suspended')),
    email_verified_at INTEGER,
    mc_uuid           TEXT    UNIQUE,
    mc_name           TEXT,
    mc_bound_at       INTEGER,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
  );

  INSERT INTO users_new
    (id, email, password_hash, display_name, avatar_url, role, locale, status,
     email_verified_at, mc_uuid, mc_name, mc_bound_at, created_at, updated_at)
  SELECT
     id, email, password_hash, display_name, avatar_url, role, locale, status,
     email_verified_at, mc_uuid, mc_name, mc_bound_at, created_at, updated_at
  FROM users;

  DROP TABLE users;
  ALTER TABLE users_new RENAME TO users;

  PRAGMA foreign_keys = ON;
`;
