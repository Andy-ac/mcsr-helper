/**
 * 007：users.role 的 CHECK 约束加上 'editor'。
 *
 * ---------------------------------------------------------------------------
 * 为什么必须重建整张表
 * ---------------------------------------------------------------------------
 * 004 里写的是 `CHECK (role IN ('user','reviewer','admin'))`，而
 * **SQLite 改不了 CHECK 约束**（没有 ALTER TABLE ... DROP/ADD CONSTRAINT）。
 * 唯一的办法是"建新表 → 拷数据 → 换名"，也就是官方文档里的那张
 * 12 步清单的简化版。
 *
 * ⚠️ 这一步千万不能漏：漏了的表现是"给用户改成 editor 时抛
 *    CHECK constraint failed" —— 而那看起来像权限代码写错了，
 *    不像数据库约束的问题。本地跑测试时它就当场炸了（见 moderation.test.ts）。
 *
 * ⚠️ **下次加角色还要再来一遍。** 所以：
 *    · 表定义这里带了完整的四个角色；
 *    · 这个约束的维护成本（每加一个角色 = 一次表重建）记在
 *      `packages/shared/src/constants.ts` 的 USER_ROLES 注释旁边。
 *
 * ---------------------------------------------------------------------------
 * 关于外键
 * ---------------------------------------------------------------------------
 * sessions / email_tokens 都有 `REFERENCES users (id) ON DELETE CASCADE`。
 * SQLite 在 DROP TABLE users 时会检查外键：如果外键约束处于开启状态，
 * 重建期间会出现"引用了一张不存在的表"的中间状态。
 *
 * 迁移是在一个连接里顺序执行的，这里用官方推荐的
 * `PRAGMA legacy_alter_table` + 先关外键的办法处理。注意
 * **PRAGMA foreign_keys 在事务里是无效的** —— 所以它必须放在
 * 这个迁移脚本的最前面，且不能被包在 BEGIN 里（migrate.ts 不包事务，
 * 见那边的注释）。
 */
export const m007EditorRole = `
  PRAGMA foreign_keys = OFF;

  CREATE TABLE users_new (
    id                TEXT    PRIMARY KEY,
    email             TEXT    NOT NULL UNIQUE,
    password_hash     TEXT    NOT NULL,
    display_name      TEXT    NOT NULL,
    avatar_url        TEXT,
    -- ⚠️ 这里是这次迁移唯一改动的地方
    role              TEXT    NOT NULL DEFAULT 'user'
                              CHECK (role IN ('user', 'reviewer', 'editor', 'admin')),
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
