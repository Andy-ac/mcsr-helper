/**
 * 认证端点。
 *
 * 端点清单（docs/v1-plan.md §4，其中两处偏离见下）：
 *   POST /api/auth/register
 *   POST /api/auth/login
 *   POST /api/auth/logout
 *   GET  /api/auth/me
 *   POST /api/auth/verify/send      重发验证邮件
 *   POST /api/auth/verify           用 token 完成验证
 *   POST /api/auth/reset/request    请求重置密码
 *   POST /api/auth/reset/confirm    用 token 设置新密码
 *
 * ---------------------------------------------------------------------------
 * 偏离一：verify 是 POST，不是计划里的 GET
 * ---------------------------------------------------------------------------
 * 计划写的是 `GET /api/auth/verify`（token → 置为已验证）。不能这么做，
 * 原因是**邮件安全扫描器**：Outlook SafeLinks、企业邮件网关、部分杀毒软件
 * 会**自动预取邮件里的每一个链接**。如果用 GET 直接消费 token，
 * 这些扫描器会在用户点之前就把令牌用掉 —— 用户点开时看到"链接无效"，
 * 而他什么都没做错。
 *
 * 所以邮件里的链接指向**前端路由** `/verify-email?token=...`：
 * 扫描器取到的是一个 SPA 外壳（无害的 HTML），
 * 真正的消费发生在用户浏览器里的这次 POST。
 *
 * ---------------------------------------------------------------------------
 * 偏离二：GET /me 未登录时返回 200 + null，而不是 401
 * ---------------------------------------------------------------------------
 * SPA 启动时必然要问一次"我是谁"。如果未登录返回 401，
 * 每个访客的控制台里都会有一条红色错误，而那是**正常状态**，不是错误。
 * 用 200 + `{ user: null }` 把"未登录"和"请求失败"在协议层面区分开。
 */
import { LoginInputSchema, PasswordSchema, RegisterInputSchema } from '@mcsr/shared/auth';
import { type Context, Hono } from 'hono';
import {
  type AuthVariables,
  clearSessionCookie,
  requireAuth,
  SESSION_MAX_AGE_SEC,
  setSessionCookie,
} from '../auth/middleware';
import { hashPassword, verifyPassword } from '../auth/password';
import { clear, clientIp, hit, keyFor, LIMITS } from '../auth/ratelimit';
import { generateToken, hashToken, SESSION_TTL_MS, tokenTtlMs } from '../auth/tokens';
import { buildResetMail, buildVerifyMail } from '../email/messages';
import { sendMail } from '../email/transport';
import {
  createEmailToken,
  createSession,
  createUser,
  deleteOtherSessions,
  deleteSession,
  findUserByEmail,
  findUserById,
  invalidateEmailTokens,
  markEmailVerified,
  redeemEmailToken,
  toUserSelf,
  updateUserPassword,
  writeAudit,
} from '../users';

export const authRoute = new Hono<{ Variables: AuthVariables }>();

type AuthContext = Context<{ Variables: AuthVariables }>;

function formatIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues.map((i) => ({
    field: i.path.map(String).join('.') || '(root)',
    message: i.message,
  }));
}

/**
 * 统一的 429 响应。
 *
 * `Retry-After` 不只是礼貌 —— 它是 HTTP 标准字段，客户端和反代都会读它。
 * 前端可以据此显示"请 N 秒后再试"，而不是干巴巴一句"请求过于频繁"。
 */
function rateLimited(c: AuthContext, retryAfterSec: number) {
  c.header('Retry-After', String(retryAfterSec));
  return c.json({ error: 'rate_limited', retryAfterSec }, 429);
}

// ---------------------------------------------------------------------------
// 注册
// ---------------------------------------------------------------------------

/**
 * ⚠️ 注册**不自动登录**，而且无论邮箱是否已注册，响应**完全一致**。
 *
 * 这两件事是同一个决定的两面：
 *
 * 如果注册成功时下发会话 cookie、邮箱已存在时不下发，那么
 * **响应里有没有 Set-Cookie 就暴露了"这个邮箱有没有注册过"** ——
 * 攻击者拿一份邮箱列表挨个试一遍，就能知道谁是我们社区的人，
 * 然后用这些信息去做定向钓鱼。
 *
 * 代价是用户注册完要多走一步登录。这个代价是划算的：
 * 无论自动登录与否，用户都必须去邮箱点验证链接（提交内容需要验证），
 * 所以"多一次登录"其实没有多出一次上下文切换。
 */
authRoute.post('/register', async (c) => {
  const ip = clientIp(c);
  const limit = hit(`register|${ip}`, LIMITS.registerPerIp.limit, LIMITS.registerPerIp.windowMs);
  if (!limit.ok) return rateLimited(c, limit.retryAfterSec);

  const body = await c.req.json().catch(() => null);
  const parsed = RegisterInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  }

  const { email, password, displayName, locale } = parsed.data;
  const now = Date.now();

  // 统一的响应体。**下面所有分支都必须返回它**。
  const accepted = {
    ok: true as const,
    // 文案刻意覆盖两种真实情况，让响应本身不泄漏信息：
    // 已注册的人知道该去登录，未注册的人知道该去收信。
    message:
      '如果这个邮箱还没有注册，我们已经发送了一封验证邮件；如果已经注册过，请直接登录，或用「忘记密码」重置。',
  };

  const existing = findUserByEmail(email);
  if (existing) {
    // 刻意什么都不做：不建账号、不发信、不建会话。
    // 记一条审计，方便日后排查"用户说注册了但没收到信"这类问题。
    writeAudit({
      actorId: null,
      action: 'register.duplicate',
      entityType: 'user',
      entityId: existing.id,
      ip,
      now,
    });
    return c.json(accepted, 200);
  }

  const passwordHash = await hashPassword(password);
  const user = createUser({ email, passwordHash, displayName, locale, now });

  writeAudit({
    actorId: user.id,
    action: 'register',
    entityType: 'user',
    entityId: user.id,
    ip,
    now,
  });

  // 邮箱验证令牌。失败**不影响注册结果** —— 账号已经建好了，
  // 用户可以稍后从"重发验证邮件"再要一封。见 email/transport.ts 文件头。
  const token = generateToken();
  createEmailToken({
    tokenHash: hashToken(token),
    userId: user.id,
    kind: 'verify',
    email: user.email,
    expiresAt: now + tokenTtlMs('verify'),
    now,
  });

  const mail = buildVerifyMail({ to: user.email, token, locale });
  const result = await sendMail(mail);
  if (!result.ok) {
    console.error(`[auth] 验证邮件发送失败 (driver=${result.driver}): ${result.error}`);
  }

  return c.json(accepted, 200);
});

// ---------------------------------------------------------------------------
// 登录
// ---------------------------------------------------------------------------

/**
 * 计时侧信道：为什么"邮箱不存在"也要真的算一次哈希。
 *
 * scrypt 这里要花 400ms 左右。如果我们发现邮箱不存在就立刻返回 401，
 * 那个响应会在 1ms 内回来，而"邮箱存在但密码错"要 400ms ——
 * **这个差异大到用眼睛都能看出来**（浏览器网络面板里一目了然）。
 * 于是攻击者可以拿一份邮箱列表逐个试，准确判断谁注册过。
 *
 * 所以邮箱不存在时，我们仍然对一个固定的假哈希跑一次完整的 verifyPassword，
 * 让两条路径的耗时一样。
 *
 * 只在第一次用到时计算（懒加载），避免拖慢进程启动 ——
 * 而且它必须是一个**真实格式**的哈希，否则 verifyPassword 会在解析阶段提前返回。
 */
let dummyHashPromise: Promise<string> | null = null;

function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(generateToken());
  return dummyHashPromise;
}

authRoute.post('/login', async (c) => {
  const ip = clientIp(c);
  const ipLimit = hit(`login|${ip}`, LIMITS.loginPerIp.limit, LIMITS.loginPerIp.windowMs);
  if (!ipLimit.ok) return rateLimited(c, ipLimit.retryAfterSec);

  const body = await c.req.json().catch(() => null);
  const parsed = LoginInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  }

  const { email, password } = parsed.data;
  const failureKey = keyFor('loginfail', ip, email);

  // 先查失败计数再算哈希：超限时省掉一次 400ms 的计算。
  // 键是 (IP + 邮箱)，所以别人从别的 IP 输错密码不会把本人锁住（见 ratelimit.ts）。
  const failureLimit = hit(failureKey, LIMITS.loginFailure.limit, LIMITS.loginFailure.windowMs);
  if (!failureLimit.ok) return rateLimited(c, failureLimit.retryAfterSec);

  const user = findUserByEmail(email);
  const now = Date.now();

  // 不存在时也走一遍哈希 —— 见上面 dummyHash 的说明
  const storedHash = user?.password_hash ?? (await dummyHash());
  const passwordOk = await verifyPassword(password, storedHash);

  if (!user || !passwordOk) {
    writeAudit({
      actorId: user?.id ?? null,
      action: 'login.failed',
      entityType: 'user',
      entityId: user?.id ?? null,
      ip,
      now,
    });
    // 消息对"邮箱不存在"和"密码错误"完全一致 —— 否则前端文案就泄漏了信息
    return c.json({ error: 'invalid_credentials' }, 401);
  }

  if (user.status === 'suspended') {
    return c.json({ error: 'account_suspended' }, 403);
  }

  // 登录成功：清掉失败计数，避免"试错几次 + 成功"之后还留着计数
  clear(failureKey);

  const token = generateToken();
  createSession({
    tokenHash: hashToken(token),
    userId: user.id,
    expiresAt: now + SESSION_TTL_MS,
    userAgent: c.req.header('user-agent') ?? null,
    now,
  });
  setSessionCookie(c, token, SESSION_MAX_AGE_SEC);

  writeAudit({
    actorId: user.id,
    action: 'login',
    entityType: 'user',
    entityId: user.id,
    ip,
    now,
  });

  return c.json({ user: toUserSelf(user) });
});

// ---------------------------------------------------------------------------
// 登出 / 我是谁
// ---------------------------------------------------------------------------

/**
 * 登出。**不要求已登录**。
 *
 * 幂等是刻意的："退出登录"这个动作在未登录状态下也应该成功 ——
 * 否则用户会遇到"点了退出但报错"，而他的真实意图（别让我再登录着）已经达成了。
 * 会话可能因为过期而不存在，那也算登出成功。
 */
authRoute.post('/logout', (c) => {
  const session = c.get('session');
  if (session) {
    deleteSession(session.token_hash);
    const user = c.get('user');
    if (user) {
      writeAudit({
        actorId: user.id,
        action: 'logout',
        entityType: 'user',
        entityId: user.id,
        ip: clientIp(c),
        now: Date.now(),
      });
    }
  }
  clearSessionCookie(c);
  return c.json({ ok: true });
});

/** 见文件头"偏离二"。 */
authRoute.get('/me', (c) => {
  const user = c.get('user');
  if (!user) return c.json({ user: null });
  return c.json({ user: toUserSelf(user) });
});

// ---------------------------------------------------------------------------
// 邮箱验证
// ---------------------------------------------------------------------------

/** 重发验证邮件。需要登录（因为要确定发给谁）。 */
authRoute.post('/verify/send', requireAuth, async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  if (user.email_verified_at !== null) {
    // 已经验证过了：直接告诉前端，不要白白发一封信
    return c.json({ ok: true, alreadyVerified: true });
  }

  const limited = hit(`resend|${user.id}`, LIMITS.resendVerify.limit, LIMITS.resendVerify.windowMs);
  if (!limited.ok) return rateLimited(c, limited.retryAfterSec);

  const now = Date.now();
  const token = generateToken();

  // 先把旧的验证令牌全部作废，再发新的。
  //
  // 反过来的话，用户连点五次重发就会手里有五条都有效的链接，
  // 而"这些链接还能用多久"是没有上界的 —— 其中一封邮件要是后来泄漏了，
  // 它仍然是有效凭证。作废旧令牌把有效凭证收敛到恰好一个。
  invalidateEmailTokens(user.id, 'verify', now);
  createEmailToken({
    tokenHash: hashToken(token),
    userId: user.id,
    kind: 'verify',
    email: user.email,
    expiresAt: now + tokenTtlMs('verify'),
    now,
  });

  const mail = buildVerifyMail({ to: user.email, token, locale: user.locale as 'zh-CN' | 'en' });
  const result = await sendMail(mail);
  if (!result.ok) {
    console.error(`[auth] 重发验证邮件失败 (driver=${result.driver}): ${result.error}`);
    return c.json({ error: 'send_failed' }, 502);
  }

  return c.json({ ok: true });
});

/**
 * 用 token 完成邮箱验证。
 *
 * 幂等性：同一个 token 第二次提交会失败（因为 used_at 已置）。
 * 但"邮箱已验证"这个状态本身是幂等的，所以重复点击的**用户**看到的是
 * "已经验证过了"而不是错误 —— 前端会在失败时先查一次 /me 来区分这两种情况。
 */
authRoute.post('/verify', async (c) => {
  const body = await c.req.json().catch(() => null);
  const token =
    typeof (body as { token?: unknown } | null)?.token === 'string'
      ? (body as { token: string }).token
      : '';
  if (!token) return c.json({ error: 'invalid_input' }, 400);

  const now = Date.now();
  const result = redeemEmailToken(hashToken(token), 'verify', now, (row) => {
    markEmailVerified(row.user_id, now);
    return row.user_id;
  });

  if (!result.ok) {
    return c.json({ error: 'invalid_token' }, 400);
  }

  writeAudit({
    actorId: result.value,
    action: 'email.verified',
    entityType: 'user',
    entityId: result.value,
    ip: clientIp(c),
    now,
  });

  const user = findUserById(result.value);
  return c.json({ ok: true, user: user ? toUserSelf(user) : null });
});

// ---------------------------------------------------------------------------
// 密码重置
// ---------------------------------------------------------------------------

/**
 * 请求重置。**响应与邮箱是否存在无关** —— 同注册，不泄漏账号存在性。
 */
authRoute.post('/reset/request', async (c) => {
  const ip = clientIp(c);
  const body = await c.req.json().catch(() => null);
  const email =
    typeof (body as { email?: unknown } | null)?.email === 'string'
      ? (body as { email: string }).email.trim().toLowerCase().slice(0, 254)
      : '';
  if (!email) return c.json({ error: 'invalid_input' }, 400);

  const limited = hit(
    keyFor('reset', ip, email),
    LIMITS.resetRequest.limit,
    LIMITS.resetRequest.windowMs,
  );
  if (!limited.ok) return rateLimited(c, limited.retryAfterSec);

  const accepted = {
    ok: true as const,
    message: '如果这个邮箱对应一个账号，我们已经发送了一封重置密码的邮件。',
  };

  const user = findUserByEmail(email);
  if (!user) return c.json(accepted, 200);

  const now = Date.now();
  const token = generateToken();
  invalidateEmailTokens(user.id, 'reset', now);
  createEmailToken({
    tokenHash: hashToken(token),
    userId: user.id,
    kind: 'reset',
    email: user.email,
    expiresAt: now + tokenTtlMs('reset'),
    now,
  });

  const mail = buildResetMail({ to: user.email, token, locale: user.locale as 'zh-CN' | 'en' });
  const result = await sendMail(mail);
  if (!result.ok) {
    console.error(`[auth] 重置密码邮件发送失败 (driver=${result.driver}): ${result.error}`);
    // ⚠️ 这里**不能**返回错误：返回错误就等于承认"这个邮箱存在"。
    // 发信失败只记日志，用户看到的是和不存在时一样的话术。
  }

  writeAudit({
    actorId: user.id,
    action: 'password.reset_requested',
    entityType: 'user',
    entityId: user.id,
    ip,
    now,
  });

  return c.json(accepted, 200);
});

/**
 * 用 token 设置新密码。
 *
 * 改完密码会**把该用户其它所有会话全部作废**（只留当前这个 —— 而这里是未登录的
 * 重置流程，所以是全部作废）。
 *
 * 为什么必须这么做：重置密码最常见的场景之一就是"我怀疑账号被别人用了"。
 * 如果改完密码而攻击者的会话还活着，用户会以为问题解决了，
 * 实际上对方可以继续用几周 —— 直到会话自然过期。
 */
authRoute.post('/reset/confirm', async (c) => {
  const body = await c.req.json().catch(() => null);
  const raw = body as { token?: unknown; password?: unknown } | null;
  const token = typeof raw?.token === 'string' ? raw.token : '';

  const parsedPassword = PasswordSchema.safeParse(raw?.password);
  if (!token || !parsedPassword.success) {
    return c.json(
      {
        error: 'invalid_input',
        issues: parsedPassword.success ? [] : formatIssues(parsedPassword.error),
      },
      400,
    );
  }

  const now = Date.now();
  const passwordHash = await hashPassword(parsedPassword.data);

  const result = redeemEmailToken(hashToken(token), 'reset', now, (row) => {
    updateUserPassword(row.user_id, passwordHash, now);
    return row.user_id;
  });

  if (!result.ok) {
    return c.json({ error: 'invalid_token' }, 400);
  }

  // 全部登出。传一个不可能存在的 token_hash，于是"保留当前会话"这条也一并作废。
  deleteOtherSessions(result.value, '');
  clearSessionCookie(c);

  writeAudit({
    actorId: result.value,
    action: 'password.reset',
    entityType: 'user',
    entityId: result.value,
    ip: clientIp(c),
    now,
  });

  return c.json({ ok: true });
});
