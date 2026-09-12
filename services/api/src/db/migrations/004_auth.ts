import { sql } from '../sql';

/**
 * 004 · 用户、会话、邮箱令牌
 *
 * ---------------------------------------------------------------------------
 * 与 docs/v1-plan.md §3 的三处偏离（都是刻意的）
 * ---------------------------------------------------------------------------
 *
 * ① **邮箱只存一份，且是转小写之后的形态。**
 *    计划里写的是 `email TEXT UNIQUE`。实际拆成"原样 + 归一化"两列是一种常见做法，
 *    但在这里没有收益：我们没有把原始大小写展示给用户的需求，
 *    而多一列就多一个"这两列不一致"的失效模式。所以只存归一化后的那一份，
 *    唯一索引直接建在它上面。见 shared/src/auth.ts 里 EmailSchema 的注释。
 *
 * ② **email_tokens 用 token_hash 直接做主键**，不再额外加一个 id 列。
 *    计划里是 `id TEXT PK, token_hash TEXT`。但 token_hash 本身就是唯一的，
 *    再加一个代理主键只会让"按 token 查"多走一次二级索引。
 *
 * ③ **sessions 的 token_hash 同理**，直接做主键。
 *    会话校验是每个受保护请求都要走的路径，让它是主键查找而不是索引查找。
 *
 * ---------------------------------------------------------------------------
 * 为什么存哈希而不是明文 token
 * ---------------------------------------------------------------------------
 * 会话 token 和邮箱 token 都存 SHA-256，不存明文。原因是**数据库一旦泄漏**：
 * 明文 token 等于把所有人的登录态直接送出去（可以立刻冒充任何在线用户），
 * 而哈希值什么也换不来 —— 攻击者得先做一次原像攻击，而 token 是 256 位随机数，
 * 这个方向不存在。
 *
 * ⚠️ 注意这里**刻意不用 scrypt**：用户的密码需要慢哈希，因为密码是低熵的、猜得出来的；
 *    而 token 是 32 字节密码学随机数，没有"猜"这个路径。
 *    对高熵输入做慢哈希，只会让每个请求都白白多花几百毫秒。
 *    **慢哈希是给低熵秘密用的** —— 这条区分很重要。
 */
export const m004Auth = sql`
  CREATE TABLE users (
    id                TEXT    PRIMARY KEY,
    email             TEXT    NOT NULL UNIQUE,
    password_hash     TEXT    NOT NULL,
    display_name      TEXT    NOT NULL,
    avatar_url        TEXT,
    role              TEXT    NOT NULL DEFAULT 'user'
                              CHECK (role IN ('user', 'reviewer', 'admin')),
    locale            TEXT    NOT NULL DEFAULT 'zh-CN',
    status            TEXT    NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'suspended')),

    -- 邮箱验证时间。NULL = 未验证。
    -- ⚠️ 用时间戳而不是布尔：审核时"什么时候验证的"是有用的信息，
    --    而布尔一旦换成时间戳就要做数据迁移。
    email_verified_at INTEGER,

    -- MC 弱验证绑定（M5 才启用）。现在建列是为了避免之后再加一次 ALTER。
    -- UNIQUE 且允许 NULL：SQLite 里多个 NULL 不算重复，所以"没绑"可以有很多人。
    mc_uuid           TEXT    UNIQUE,
    mc_name           TEXT,
    mc_bound_at       INTEGER,

    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
  );

  -- 会话。token_hash 是主键：每个受保护请求都要查它，走主键最省。
  CREATE TABLE sessions (
    token_hash   TEXT    PRIMARY KEY,
    user_id      TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    -- 滑动续期用：每次用到这个会话就更新它，"最近活跃"也靠它判断。
    last_seen_at INTEGER NOT NULL,
    user_agent   TEXT
  );

  -- ON DELETE CASCADE 需要外键的列上有索引才能在删用户时高效清理；
  -- 另外"列出我的所有登录设备"这个功能（v1.1）也要按 user_id 查。
  CREATE INDEX idx_sessions_user ON sessions (user_id);

  -- 过期会话的清理任务按 expires_at 扫，没有索引就是全表扫描。
  CREATE INDEX idx_sessions_expires ON sessions (expires_at);

  -- 邮箱令牌：验证邮箱（verify）与重置密码（reset）共用一张表。
  CREATE TABLE email_tokens (
    token_hash TEXT    PRIMARY KEY,
    user_id    TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL CHECK (kind IN ('verify', 'reset')),
    expires_at INTEGER NOT NULL,
    -- 用时间戳而不是布尔，理由同 users.email_verified_at
    used_at    INTEGER,
    created_at INTEGER NOT NULL,
    -- 发出时的邮箱快照。用户可能在令牌有效期内改邮箱，
    -- 那时这个令牌不应该还能验证**新**邮箱（否则等于绕过了验证）。
    email      TEXT    NOT NULL
  );

  -- "这个用户还有没有未用的 verify 令牌" —— 重发限流要查这个
  CREATE INDEX idx_email_tokens_user ON email_tokens (user_id, kind, used_at);

  -- 审计留痕（§3 的设计约束之三：留痕但不可撤销）。
  -- 登录、注册、改密码、审核动作都往这里写。
  --
  -- ⚠️ 刻意**没有**外键指向 users：账号注销后审计记录必须还在
  --    （那正是最需要留痕的时候），所以 actor_id 只存一个不保证存在的字符串。
  CREATE TABLE audit_log (
    id          TEXT    PRIMARY KEY,
    actor_id    TEXT,
    action      TEXT    NOT NULL,
    entity_type TEXT    NOT NULL,
    entity_id   TEXT,
    reason      TEXT,
    -- 请求来源 IP。用于"这个操作到底是不是本人做的"这类事后追查。
    ip          TEXT,
    created_at  INTEGER NOT NULL
  );

  CREATE INDEX idx_audit_actor ON audit_log (actor_id, created_at);
  CREATE INDEX idx_audit_entity ON audit_log (entity_type, entity_id, created_at);
`;
