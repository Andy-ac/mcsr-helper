/**
 * 用户、会话、邮箱令牌的仓储层。
 *
 * 和 resources.ts 保持同一套约定：所有 SQL 只出现在这一层，
 * 上层拿到的是已经映射好的对象，不是数据库行。
 */
import type { Locale, UserPublic, UserRole, UserSelf } from '@mcsr/shared/auth';
import { newId } from './auth/tokens';
import { getDb } from './db';

// ---------------------------------------------------------------------------
// 行类型
// ---------------------------------------------------------------------------

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  avatar_url: string | null;
  role: string;
  locale: string;
  status: string;
  email_verified_at: number | null;
  mc_uuid: string | null;
  mc_name: string | null;
  mc_bound_at: number | null;
  created_at: number;
  updated_at: number;
}

const USER_COLUMNS = `
  id, email, password_hash, display_name, avatar_url, role, locale, status,
  email_verified_at, mc_uuid, mc_name, mc_bound_at, created_at, updated_at
`;

// ---------------------------------------------------------------------------
// 映射
// ---------------------------------------------------------------------------

/** 对外可见形态。**不含 email** —— 见 shared/src/auth.ts 里的说明。 */
export function toUserPublic(row: UserRow): UserPublic {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: row.role as UserRole,
    mcName: row.mc_name,
    createdAt: row.created_at,
  };
}

/**
 * 只有本人能看到的形态。
 *
 * `canSubmit` 由服务端算好下发，而不是让前端自己拼
 * `emailVerified && status === 'active'` —— 后者会把权限规则复制到客户端，
 * 一旦规则变了（比如以后加上"信誉分达标才能提交"），
 * 就会出现"前端说能提交、后端拒绝"的不一致。
 */
export function toUserSelf(row: UserRow): UserSelf {
  return {
    ...toUserPublic(row),
    email: row.email,
    locale: row.locale as Locale,
    emailVerified: row.email_verified_at !== null,
    canSubmit: row.email_verified_at !== null && row.status === 'active',
  };
}

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

/**
 * 按邮箱找用户。
 *
 * ⚠️ 这里**必须**做小写归一化。存储层只存小写形态（见 004_auth.ts），
 * 而登录接口刻意不对入参做归一化 —— 目的是让"任意大小写都能登录"
 * 成为这条查询保证的性质，而不是依赖调用方记得转换。
 */
export function findUserByEmail(email: string): UserRow | null {
  const row = getDb()
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?`)
    .get(email.trim().toLowerCase()) as UserRow | undefined;
  return row ?? null;
}

export function findUserById(id: string): UserRow | null {
  const row = getDb().prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id) as
    | UserRow
    | undefined;
  return row ?? null;
}

// ---------------------------------------------------------------------------
// 写入
// ---------------------------------------------------------------------------

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  displayName: string;
  locale: Locale;
  now: number;
}

export function createUser(input: CreateUserInput): UserRow {
  const id = newId();
  getDb()
    .prepare(
      `INSERT INTO users
         (id, email, password_hash, display_name, locale, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.email.trim().toLowerCase(),
      input.passwordHash,
      input.displayName,
      input.locale,
      input.now,
      input.now,
    );

  const row = findUserById(id);
  if (!row) throw new Error('插入用户后立刻查不到 —— 数据库状态异常');
  return row;
}

export function updateUserPassword(userId: string, passwordHash: string, now: number): void {
  getDb()
    .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .run(passwordHash, now, userId);
}

/**
 * 改一个用户自己的昵称。
 *
 * ⚠️ **没有任何唯一性判据**，这是刻意的（与注册一致）：`display_name` 上只有
 *    `NOT NULL`、**没有 UNIQUE**（见 `db/migrations/004_auth.ts`），所以注册时
 *    两个人本来就可以叫同一个名字。这里再加一道"重名就不许改"的检查，
 *    等于在**改名**这条路上造出一条注册没有的规则 —— 改不到自己原本的名字、
 *    也改不到任何热门昵称，而这两件事都不是我们想禁的东西。
 *    代价（写清楚，免得以后被当成缺陷）：站上会出现两个同名的人，
 *    靠昵称分不清谁是谁；要有唯一昵称是一次产品决定 + 一次迁移（另见
 *    `routes/auth.ts` 那条路由的注释）。
 *
 * ⚠️ 推 `updated_at`（与 `setUserRole` 刻意做的**相反**）：那一列的含义是
 *    "用户资料最后一次被改"（见 `setUserRole` 上面那段），而改名正是**用户自己**
 *    改自己的资料；角色是管理员的操作，所以那边不推。两个方向都有先例，
 *    这里是按字段的语义选的，不是随手抄一个。
 */
export function updateUserDisplayName(userId: string, displayName: string, now: number): void {
  getDb()
    .prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?')
    .run(displayName, now, userId);
}

export function markEmailVerified(userId: string, now: number): void {
  getDb()
    .prepare(
      `UPDATE users
         SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ?
       WHERE id = ?`,
    )
    .run(now, now, userId);
}

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------

export interface SessionRow {
  token_hash: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  last_seen_at: number;
  user_agent: string | null;
}

export function createSession(input: {
  tokenHash: string;
  userId: string;
  expiresAt: number;
  userAgent: string | null;
  now: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(input.tokenHash, input.userId, input.now, input.expiresAt, input.now, input.userAgent);
}

/**
 * 用 token 哈希查一个**仍然有效**的会话，并连带把用户取出来。
 *
 * 过期的会话在这里就查不到 —— 把有效期判断放进 WHERE 而不是查出来再比，
 * 是为了杜绝"某条分支忘了检查 expires_at"这种错误。
 * 这也是为什么 expires_at 上有索引（004_auth.ts）。
 */
export function findValidSession(
  tokenHash: string,
  now: number,
): { session: SessionRow; user: UserRow } | null {
  const session = getDb()
    .prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .get(tokenHash, now) as SessionRow | undefined;
  if (!session) return null;

  const user = findUserById(session.user_id);
  if (!user) return null;

  return { session, user };
}

/**
 * 刷新"最近活跃时间"。
 *
 * ⚠️ 不是每个请求都写。这台机器是 1 核 + WAL，读是并发的，
 * 但**写会串行化**；每个受保护请求都写一次，等于让所有并发请求排队。
 * 一小时一次足够满足"看看我最近在哪登录过"这个需求，
 * 而写入量降到原来的几千分之一。
 */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export function touchSession(tokenHash: string, now: number): void {
  getDb()
    .prepare(
      `UPDATE sessions SET last_seen_at = ?
       WHERE token_hash = ? AND last_seen_at < ?`,
    )
    .run(now, tokenHash, now - TOUCH_INTERVAL_MS);
}

export function deleteSession(tokenHash: string): void {
  getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

/** 改密码后调用：把该用户**其它**会话全部作废，只留当前这一个。 */
export function deleteOtherSessions(userId: string, keepTokenHash: string): number {
  const result = getDb()
    .prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?')
    .run(userId, keepTokenHash);
  return Number(result.changes);
}

/**
 * 清理过期会话。
 *
 * 由 index.ts 定时调用，而不是在查询路径上顺手删 ——
 * 后者会让"读"变成"读+写"，在最需要并发的路径上引入串行化。
 */
export function deleteExpiredSessions(now: number): number {
  const result = getDb().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  return Number(result.changes);
}

// ---------------------------------------------------------------------------
// 邮箱令牌
// ---------------------------------------------------------------------------

export function createEmailToken(input: {
  tokenHash: string;
  userId: string;
  kind: string;
  email: string;
  expiresAt: number;
  now: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO email_tokens (token_hash, user_id, kind, email, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(input.tokenHash, input.userId, input.kind, input.email, input.expiresAt, input.now);
}

export interface EmailTokenRow {
  token_hash: string;
  user_id: string;
  kind: string;
  expires_at: number;
  used_at: number | null;
  created_at: number;
  email: string;
}

/**
 * 取出一个**可用**的邮箱令牌（未用过、未过期、类型匹配）。
 *
 * ⚠️ 只查不用。真正的"标记已用"必须和后续动作在**同一个事务**里，
 * 见 redeemEmailToken —— 否则两个人同时点同一个链接，两边都会通过检查。
 */
export function findUsableEmailToken(
  tokenHash: string,
  kind: string,
  now: number,
): EmailTokenRow | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM email_tokens
       WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ?`,
    )
    .get(tokenHash, kind, now) as EmailTokenRow | undefined;
  return row ?? null;
}

/**
 * 原子地消费一个邮箱令牌。
 *
 * 事务里做两件事：标记已用 + 执行回调里的动作（置为已验证 / 改密码）。
 * **必须一起成功或一起失败** —— 否则会出现"令牌已消费但密码没改"，
 * 用户拿到的是一封已经作废的邮件和没变的密码。
 *
 * 回调里只允许同步操作（node:sqlite 是同步 API，所以这自然成立）。
 */
export function redeemEmailToken<T>(
  tokenHash: string,
  kind: string,
  now: number,
  action: (token: EmailTokenRow) => T,
): { ok: true; value: T } | { ok: false; reason: 'invalid' } {
  const db = getDb();
  const token = findUsableEmailToken(tokenHash, kind, now);
  if (!token) return { ok: false, reason: 'invalid' };

  db.exec('BEGIN IMMEDIATE');
  try {
    const marked = db
      .prepare('UPDATE email_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL')
      .run(now, tokenHash);

    // 如果另一个请求抢先消费了，changes 会是 0 —— 这里必须检查，
    // 否则就退化成了"检查了但没用上"，等于没有原子性。
    if (Number(marked.changes) === 0) {
      db.exec('ROLLBACK');
      return { ok: false, reason: 'invalid' };
    }

    const value = action(token);
    db.exec('COMMIT');
    return { ok: true, value };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * 作废某个用户某类令牌里所有还没用过的。
 *
 * 用途：重新发一封验证邮件时，把之前那封作废。
 * 否则用户手里的旧链接一直有效，而"旧链接还能用多久"是无界的。
 */
export function invalidateEmailTokens(userId: string, kind: string, now: number): number {
  const result = getDb()
    .prepare(
      'UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND kind = ? AND used_at IS NULL',
    )
    .run(now, userId, kind);
  return Number(result.changes);
}

// ---------------------------------------------------------------------------
// 审计
// ---------------------------------------------------------------------------

/**
 * 写一条审计记录。
 *
 * ⚠️ 这个函数**不应该**让调用方因为它的失败而失败：
 * 比如登录已经成功了，此时审计表写不进去（磁盘满、库锁住），
 * 正确的反应是记个日志继续，而不是把用户挡在门外。
 * 所以内部吞掉异常并打日志。
 */
export function writeAudit(entry: {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  reason?: string | null;
  ip?: string | null;
  now: number;
}): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO audit_log (id, actor_id, action, entity_type, entity_id, reason, ip, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId(),
        entry.actorId,
        entry.action,
        entry.entityType,
        entry.entityId,
        entry.reason ?? null,
        entry.ip ?? null,
        entry.now,
      );
  } catch (error) {
    console.error('[audit] 写入失败（不影响主流程）:', error);
  }
}

// ---------------------------------------------------------------------------
// 角色（身份组）
// ---------------------------------------------------------------------------

/**
 * 改一个用户的角色。
 *
 * 只改这一列，**不动 updated_at** —— 那个字段表示"用户资料最后修改时间"，
 * 角色是管理员的操作，不是用户自己改的资料。混在一起会让"这个人的资料
 * 最近被改过"这个判断变得不可信。
 */
export function setUserRole(userId: string, role: string, _now: number): void {
  getDb().prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
}

/** 管理员人数。"不能降级最后一个管理员"那条锁定保护要查它。 */
/** 有多少个所有者。和 countAdmins 一起决定"还有没有人能改角色"。 */
export function countOwners(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'").get() as
    | { n: number }
    | undefined;
  return Number(row?.n ?? 0);
}

export function countAdmins(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'")
    .get() as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

/**
 * 用户列表（后台用）。
 *
 * ⚠️ 返回的**含 email** —— 只有 admin 能调到（路由上有 user.moderate 把关），
 *    而且响应带了 no-store。用户邮箱是这里最敏感的东西，
 *    任何一处疏漏都会让它出现在不该出现的地方。
 */
export function listUsers(limit: number, offset: number): { items: UserRow[]; total: number } {
  const db = getDb();
  const items = db
    .prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(limit, offset) as unknown as UserRow[];
  const totalRow = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  return { items, total: Number(totalRow.n) };
}
