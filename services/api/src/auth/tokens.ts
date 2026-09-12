/**
 * 令牌的生成与哈希。
 *
 * 会话 token 和邮箱 token 用的是同一套机制，所以放在一个文件里 ——
 * 不是为了省代码，而是为了让"两者用同样的强度"变成一个**结构上的事实**，
 * 而不是两处各自记得写对。
 *
 * 核心区分（在 004_auth.ts 里也写了一遍，因为它太容易搞错）：
 *
 *   | | 秘密的性质 | 该怎么存 |
 *   |---|---|---|
 *   | 用户密码 | **低熵**，猜得出来（`123456`、`password1`） | 慢哈希（scrypt） |
 *   | 会话/邮箱 token | **高熵**，32 字节密码学随机数，猜不出来 | 快哈希（SHA-256） |
 *
 * 对 token 用 scrypt 是纯粹的性能浪费 —— 每次请求都要多花几百毫秒，
 * 换来的安全性是零（反正是随机数，没有字典可查）
 * 而且会让每个受保护请求都吃掉 64MB 内存，直接把并发打到地板上。
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';

/**
 * token 的字节数。
 *
 * 32 字节 = 256 位。用 base64url 编码后是 43 个字符。
 *
 * 为什么是 32 而不是 16：16 字节（128 位）在密码学上仍然不可暴力破解，
 * 但这类值经常会被写进日志、URL、Referer、浏览器历史。
 * 多一倍字节不花任何代价，却让"意外泄漏后还能被碰撞"这件事更不可能。
 */
const TOKEN_BYTES = 32;

/** 生成一个新的 token 明文（**只在这一次出现，之后不落库**）。 */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * token → 存储用的哈希。
 *
 * 用 SHA-256 而不是 HMAC：HMAC 需要一把密钥，而密钥又得存在某个地方
 * （环境变量或数据库），于是"数据库泄漏"就退化成了"数据库+环境变量同时泄漏"。
 * 这里的输入已经是 256 位随机数，不存在"猜出来"的路径，
 * 所以加盐/加密钥都不会带来实际收益。
 *
 * 不用纯 hex：base64url 更短（43 vs 64 字符），而这一列是主键，
 * 每个会话查询都要读它。
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url');
}

/** 实体 id（用户、会话记录、审计记录……）。 */
export function newId(): string {
  return randomUUID();
}

// ---------------------------------------------------------------------------
// 有效期
// ---------------------------------------------------------------------------

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

/**
 * 邮箱 token 的有效期。
 *
 * 验证邮箱 24 小时：用户可能隔一天才点开邮件，太短会逼人反复重发。
 * 重置密码 1 小时：这个链接等价于一次登录，越短越好；
 * 而用户点重置时通常就在电脑前面，不需要 24 小时。
 */
export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export const EMAIL_TOKEN_KINDS = ['verify', 'reset'] as const;
export type EmailTokenKind = (typeof EMAIL_TOKEN_KINDS)[number];

export function tokenTtlMs(kind: EmailTokenKind): number {
  return kind === 'verify' ? VERIFY_TOKEN_TTL_MS : RESET_TOKEN_TTL_MS;
}
