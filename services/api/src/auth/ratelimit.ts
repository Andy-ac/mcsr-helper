/**
 * 认证端点的限流。
 *
 * index.ts 里已经有一个全局限流（240 次/分钟/IP），但认证端点需要**严格得多**：
 * 全局限流的目的是防止有人拿 API 刷量，而登录/注册面对的是暴力破解和刷账号。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 一个容易做错的地方：按账号限流会变成 DoS
 * ---------------------------------------------------------------------------
 * 最直觉的做法是"同一个邮箱错 5 次就锁 15 分钟"。但它有一个很糟糕的性质：
 * **任何人都能锁死任何人的账号** —— 攻击者只要用别人的邮箱故意输错密码，
 * 就能让那个用户登不进来。这比暴力破解更容易实施，代价也更低。
 *
 * 所以这里按 **(IP + 邮箱)** 组合来计数，而不是只按邮箱：
 *   · 同一个人从同一个 IP 试同一个账号 → 会被限流（挡住暴力破解）
 *   · 另一个人从别的 IP 登录同一个账号 → **完全不受影响**（不会误伤本人）
 *   · 攻击者想真正锁死一个账号，需要大量不同 IP —— 成本高得多
 *
 * 代价：分布式撞库（每个 IP 试几个）不会被这条规则挡住。
 * 那种攻击要靠别的机制（异常登录检测、泄露密码库比对），而 v1 不做那些（§8）。
 * 这里的目标是"让单点暴力破解不划算"，不是"完全消除撞库"。
 *
 * ---------------------------------------------------------------------------
 * 为什么用内存而不是数据库
 * ---------------------------------------------------------------------------
 * v1 是单进程部署（systemd 一个 node 进程），内存计数就是准确的。
 * 而且认证端点的限流状态**不需要跨重启保留** —— 重启后计数清零，
 * 攻击者最多多试几次。为此写一张表、每次请求都写库，
 * 反而会在 1 核机器上引入写串行化。
 * 将来上多进程时，这里换成 SQLite 或 Redis，接口不用变。
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** 条目上限。超过就清理，避免被大量不同的 key 撑爆内存。 */
const MAX_BUCKETS = 20_000;

export interface RateLimitResult {
  ok: boolean;
  /** 被限流时，还要等多少秒。用于 Retry-After 响应头。 */
  retryAfterSec: number;
}

/**
 * 固定窗口计数器。
 *
 * 用固定窗口而不是滑动窗口：实现简单、内存恒定，
 * 而它的已知缺点（窗口边界的双倍突发）在这里无伤大雅 ——
 * 攻击者最多在边界上多试几次，而 scrypt 的 400ms 本身就限制了总吞吐。
 */
export function hit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || entry.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) sweep(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }

  entry.count += 1;
  if (entry.count > limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }
  return { ok: true, retryAfterSec: 0 };
}

/** 只读不改。用于"查一下有没有超"而不消耗配额。 */
export function peek(key: string, limit: number): RateLimitResult {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) return { ok: true, retryAfterSec: 0 };
  if (entry.count > limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }
  return { ok: true, retryAfterSec: 0 };
}

/** 登录成功后清零失败计数 —— 让"偶尔手滑输错"不会累积成限流。 */
export function clear(key: string): void {
  buckets.delete(key);
}

function sweep(now: number): void {
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
  // 全是未过期的极端情况下，清掉最早到期的一批，保证不会无限增长
  if (buckets.size >= MAX_BUCKETS) {
    const sorted = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (const [k] of sorted.slice(0, Math.floor(MAX_BUCKETS / 4))) buckets.delete(k);
  }
}

// ---------------------------------------------------------------------------
// 各端点的配额
// ---------------------------------------------------------------------------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * 这些数字是怎么定的：以"正常人不可能触发，而暴力破解不划算"为准。
 *
 * · 登录 20 次/15 分钟/IP —— 一个人一天登录不了几次，20 次足够容纳
 *   "记不清密码试几次""密码管理器同时同步多个设备"这类正常行为。
 * · 登录失败 10 次/15 分钟/(IP+邮箱) —— 见文件头，组合键是为了不误伤。
 * · 注册 5 次/小时/IP —— 注册比登录罕见得多，而且每一个都会建一个账号。
 * · 重发验证邮件 3 次/小时/用户 —— 邮件送达有延迟，用户容易连点。
 *   再多的重发不会更快到达，只会烧掉发信额度和域名声誉。
 * · 找回密码 3 次/小时/(IP+邮箱) —— 同登录。
 */
export const LIMITS = {
  loginPerIp: { limit: 20, windowMs: 15 * MINUTE },
  loginFailure: { limit: 10, windowMs: 15 * MINUTE },
  registerPerIp: { limit: 5, windowMs: HOUR },
  resendVerify: { limit: 3, windowMs: HOUR },
  resetRequest: { limit: 3, windowMs: HOUR },
} as const;

/** 从请求头取客户端 IP。Caddy 会带上 X-Real-IP（见 deploy/Caddyfile）。 */
export function clientIp(c: { req: { header: (n: string) => string | undefined } }): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? 'unknown'
  );
}

/**
 * 组合键。邮箱部分做小写归一化 —— 否则攻击者只要换个大小写
 * （`Foo@x.com` / `foo@x.com`）就能绕开计数，
 * 而它们在我们这儿是**同一个账号**（见 users.ts 的归一化）。
 */
export function keyFor(...parts: string[]): string {
  return parts.map((p) => p.trim().toLowerCase()).join('|');
}

/** 仅供测试：重置所有计数。 */
export function resetAll(): void {
  buckets.clear();
}
