/**
 * 认证端点。
 *
 * 端点清单（docs/v1-plan.md §4，其中两处偏离见下）：
 *   POST /api/auth/register
 *   POST /api/auth/login
 *   POST /api/auth/logout
 *   GET  /api/auth/me               我是谁（未登录 ⇒ 200 + null，见偏离二）
 *   PATCH /api/auth/me              改自己的昵称（需登录；没有 id 段 —— 改不了别人）
 *   POST /api/auth/verify/send      重发验证邮件（需登录）
 *   POST /api/auth/verify/resend    重发验证邮件（未登录，见下）
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
 *
 * ---------------------------------------------------------------------------
 * 偏离三：邮箱未验证 = 不能登录（这条推翻了早先"验证挡提交不挡登录"的原则）
 * ---------------------------------------------------------------------------
 * 早先的设计是"注册即可登录，只是不能提交内容"。现在反过来：**验证通过才算注册完成**，
 * 未验证的账号连登录都不行（403 `email_not_verified`）。
 *
 * 为什么值得推翻：早先那套里，一个邮箱写错的账号是一个**能登录、能用一半功能、
 * 并且永远收不到我们任何邮件**的账号 —— 用户以为自己注册好了，直到某天想提交内容
 * 才撞上"请先验证邮箱"，而那时那封信早就过期了。把验证提到登录之前，
 * 用户在有上下文的时候（刚注册完、正盯着注册页）就知道自己还没完成，
 * 而不是几周后在另一个页面上被拦下来。
 *
 * 代价有两个，都是刻意接受的，写在这里以免以后被当成 bug：
 *   1. 未验证的用户拿不到会话，"重发验证邮件"因此**不能要求登录** ——
 *      否则用户会被锁死在"没验证 → 不能登录 → 不能重发 → 没验证"的循环里。
 *      所以有了下面的 /verify/resend：不需要登录，但响应必须与
 *      "已注册未验证 / 已注册已验证 / 邮箱不存在 / 发信失败"四种情况完全一致。
 *   2. 重置密码会顺便置为已验证 —— 见 /reset/confirm 处的说明。
 */
import {
  LoginInputSchema,
  PasswordSchema,
  RegisterInputSchema,
  UpdateDisplayNameInputSchema,
  VerifyResendInputSchema,
} from '@mcsr/shared/auth';
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
import { type MailResult, sendMail } from '../email/transport';
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
  updateUserDisplayName,
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

/**
 * 记一条"邮件已交给服务商"的日志。
 *
 * 见调用处的说明：没有这一行，"发出去了"和"被扔进垃圾箱了"在日志里长得一样。
 * 收件地址也记下来 —— 排查"信发给了谁"时这是第一手证据，
 * 而 journald 本身只有 root 能读，不构成额外的暴露面。
 */
function logSent(kind: string, to: string, result: { driver: string; id?: string }): void {
  console.log(`[auth] ${kind}已交给 ${result.driver}  id=${result.id ?? '(无)'}  to=${to}`);
}

/**
 * 给用户发一封新的验证邮件。
 *
 * 抽成一处是因为"注册时发第一封"和"用户点重发"必须是**同一套**语义：
 * 都先作废旧的验证令牌、都只留恰好一个有效凭证。
 * 早先这两段是各写一遍的，改了一处忘了另一处，就是"重发之后旧链接依然能用"
 * 这类漏洞的典型来源 —— 而它不会有任何测试失败来提醒你。
 *
 * ⚠️ 失败怎么处理由调用方决定，这里只如实返回：
 * 注册时发信失败**不影响注册结果**（账号已经建好了，还能重发），
 * 而重发时失败必须让用户知道，否则他会一直等一封不会来的信。
 */
function issueVerifyToken(user: {
  id: string;
  email: string;
  locale: string;
}): Promise<MailResult> {
  const now = Date.now();
  const token = generateToken();

  // 先作废旧令牌，再发新的。
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
  return sendMail(mail);
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
 * 代价是用户注册完要多走一步登录。这个代价在这里是划算的，
 * 而且比早先更划算：既然未验证的账号**根本不能登录**（见偏离三），
 * 注册时下发会话就等于下发一个连不上任何东西的会话。
 * 注册的终点不是"拿到会话"，而是"点开邮件里的链接"。
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
    // 文案刻意覆盖三种真实情况，让响应本身不泄漏信息：
    // 没注册的人知道该去收信，注册过的人知道该去登录，
    // 而"注册过但没验证"的人拿到的是一张能自救的说明书（重设密码即可完成验证）。
    message:
      '如果这个邮箱还没有注册，我们已经发送了一封验证邮件 —— 点开邮件里的链接才算注册完成。如果已经注册过，可以直接登录；如果一直收不到验证邮件，用「忘记密码」重设一次密码也可以完成验证。',
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
  const result = await issueVerifyToken(user);
  if (!result.ok) {
    console.error(`[auth] 验证邮件发送失败 (driver=${result.driver}): ${result.error}`);
  } else {
    /*
     * 记下发信服务商给的邮件 ID。
     *
     * ⚠️ 这行不是多余的：只在失败时记日志的话，"发送成功"和
     * "被收件方丢进垃圾箱"在我们这边看起来**完全一样** —— 都是没有日志。
     * 有了 ID 才能去服务商控制台查这封信最后到底是什么状态
     * （delivered / bounced / complained）。排查"用户说没收到"时，
     * 这是唯一的线索。
     */
    logSent('验证邮件', user.email, result);
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

  /*
   * 邮箱未验证 = 不能登录。见文件头"偏离三"。
   *
   * 位置很讲究，有三处不能再挪：
   *   - 在密码校验**之后**：否则拿一份邮箱列表挨个试就能问出
   *     "谁注册了但没验证"，那是账号存在性的一个子集。
   *   - 在 suspended 检查**之后**：封禁是更强的结论，
   *     一个被封的账号不该从响应里泄露它的验证状态。
   *   - 在 clear(failureKey) **之前**：没登录成功就不该清失败计数，
   *     否则"未验证的账号"可以拿来反复试探密码而不触发限流。
   */
  if (user.email_verified_at === null) {
    return c.json({ error: 'email_not_verified' }, 403);
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
// 改自己的昵称
// ---------------------------------------------------------------------------

/**
 * 改**自己**的昵称（账号页 `/me` 上那个入口 —— 路由见 `apps/web/src/App.tsx`）。
 *
 * ---------------------------------------------------------------------------
 * 为什么是 `PATCH /me`，而不是 `POST /profile/rename` 之类
 * ---------------------------------------------------------------------------
 * 两点，都是"照本仓既有写法"：
 *   1. **改已有那一行用 PATCH**（`routes/live.ts` 的 `/live/mine/:id` 是同一个动作、
 *      同一条 `requireAuth`）；POST 在本仓一律是"新建一个东西"。
 *   2. 路径里**没有 id 段**，所以"改别人"这个功能在形状上就不存在 ——
 *      不是靠 handler 里记得忽略一个 `userId`（那种记得住的东西迟早会忘）。
 *      入参 schema 也 `.strict()`：body 里多一个 `userId` 直接 400，
 *      而不是被静默丢掉（见 `packages/shared/src/auth.ts`）。
 *
 * ⚠️ 与**计划**的一处出入，写在这里免得下一个人把它当成漏做：
 *    `docs/v1-plan.md` 的 M5 端点清单里，改资料写的是 `PATCH /api/users/me`
 *    （括注"改昵称/头像/locale"）。本轮**没有**走那条路，理由是它今天不存在 ——
 *    **公开的** `/api/users/*` 一条也没有：今天有的只有**管理员那一族**
 *    （`/api/admin/users…`：`GET /api/admin/users`、`PATCH /api/admin/users/:id/role`、
 *    `DELETE /api/admin/users/:id` —— 现读 `routes/admin.ts` 数出来的）；
 *    公开主页 `GET /api/users/:id` 本身还是 M5 才有的东西。为一个小功能新开一个
 *    路由文件 + 一个挂载点，
 *    换来的是与 `GET /api/auth/me`（"我是谁"今天住在这里）**两个**自我相关的入口。
 *    代价（如实记下）：M5 真的要做头像 / locale 时，得先决定是把这个端点搬过去、
 *    还是在两边各留一个 —— 而那是一次有意的合并，不是本轮的疏漏。
 *    ⚠️ 真搬过去时注意 `PATCH /users/me` 与 `GET /users/:id` 的**注册顺序**
 *    （Hono 按注册顺序匹配；`/users/me` 必须排在 `/users/:id` 前面，
 *    否则它会落到"按 id 查一个叫 me 的用户"那一支）—— 那条坑在本仓记过好几次。
 *
 * ⚠️ 与上面 `GET /me` 的**刻意不一致**：读自己的信息，未登录返回 `200 + null`
 *    （那是访客的正常状态，见文件头"偏离二"）；**写**不是正常状态 ——
 *    没有会话就 401，前端据此去登录页。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 不做唯一性校验，也**不设冷却** —— 两条都是刻意接受的，不是漏写
 * ---------------------------------------------------------------------------
 * · 重名：**注册本来就不要求昵称唯一**（`users.display_name` 上只有 `NOT NULL`，
 *   没有 UNIQUE，见 `db/migrations/004_auth.ts`）。所以改成一个别人正在用的昵称
 *   **必须成功** —— 否则改名这条路上就凭空多出一条注册没有的规则
 *   （`services/api/src/auth/display-name.test.ts` 有一条断言钉着它）。
 *   代价：站上会出现两个同名的人，靠昵称分不清谁是谁。要有唯一昵称是
 *   **一次产品决定 + 一次迁移**（给那一列加唯一索引前得先把历史重名处理掉）。
 * · 冷却：用户当场裁决「不限次数」⇒ 这里**不写**"每人每天 N 次"那种判据。
 *   代价（写出来，免得以后被当成缺陷）：昵称是**公开且被到处引用**的 ——
 *   资源作者、贡献者面板、审核记录、管理员用户列表、页头都用它。改得越快，
 *   "那个人"与历史记录对不上得越厉害（一条 2026-09 的审核记录上写的名字，
 *   可能既不是他提交时的名字、也不是他现在用的名字）。**这一轮不为此加任何冷却。**
 *
 * ⚠️ 那么它靠什么限流：`index.ts` 那个**全站** per-IP 限流（`app.use('/api/*')`，
 *    240 次/分钟/IP）。那是这条路由本来就吃得到的一层 —— auth 这一族**没有**
 *    共用的 per-IP 桶（`LIMITS` 里每一条都是某个端点自己的），所以这里既不新增桶、
 *    也不写一条"改名专用"的配额；新增一条就等于偷偷把用户裁决掉的冷却加回来。
 */
authRoute.patch('/me', requireAuth, async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = UpdateDisplayNameInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  }

  const now = Date.now();
  updateUserDisplayName(user.id, parsed.data.displayName, now);

  /*
   * ⚠️ 审计带**旧值与新值**，因为要回答的是"把什么改成了什么"。
   *    只记新值等于没记：改名之前的那个名字在别处（贡献者、审核记录）仍然印着，
   *    排查"这条记录上的名字是谁"时，缺了旧值就断了线索。
   *    格式跟随 `routes/calendar.ts` 的 `series.rename`（`旧 → 新`）。
   *
   * ⚠️ **不拼邮箱**。昵称是公开信息（站上到处都在显示它），写进审计没有问题；
   *    邮箱不是 —— 审计表在管理界面里是**列出来给人看**的，多拼一个邮箱
   *    就等于在任何看审计的地方顺手暴露了会员邮箱。要认人，`actor_id` 就够了。
   */
  writeAudit({
    actorId: user.id,
    action: 'user.rename',
    entityType: 'user',
    entityId: user.id,
    reason: `${user.display_name} → ${parsed.data.displayName}`,
    ip: clientIp(c),
    now,
  });

  /*
   * ⚠️ 回包里的用户对象必须**重新从库里读一遍**，不是拿 `user` 拼一个新的。
   *    `c.get('user')` 是这次请求**开始时**那一行：直接回它（或回入参）的话，
   *    响应里会有一个"看起来改好了"的昵称，而它证明不了库里真的变了 ——
   *    前端拿它去更新缓存，界面于是显示新名字，而数据层可能什么都没发生。
   *    重读一次，响应就成了"库里现在是什么"的读数。
   */
  const fresh = findUserById(user.id);
  if (!fresh) return c.json({ error: 'not_found' }, 404);

  return c.json({ user: toUserSelf(fresh) });
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

  const result = await issueVerifyToken(user);
  if (!result.ok) {
    console.error(`[auth] 重发验证邮件失败 (driver=${result.driver}): ${result.error}`);
    return c.json({ error: 'send_failed' }, 502);
  }
  logSent('重发的验证邮件', user.email, result);

  return c.json({ ok: true });
});

/**
 * 重发验证邮件，**不需要登录**。
 *
 * 为什么必须有这个端点：未验证的账号登不进来（见文件头"偏离三"），
 * 于是上面那条"要登录才能重发"的路，对最需要它的人恰恰不可用 ——
 * 用户会卡在"邮箱没验证 → 不能登录 → 不能重发 → 邮箱还是没验证"里，
 * 而唯一的出口是重设密码，那要求他能收到同一封信。
 *
 * 反枚举：下面四种真实情况（邮箱不存在 / 已注册未验证 / 已经验证过 / 发信失败）
 * 返回**逐字节相同**的响应。这里尤其不能图省事说上一句"这封信已经发过了"，
 * 因为"有没有发信"本身就回答了"这个邮箱注册过没有"。
 *
 * 副作用是：用户分不清"信发出去了"和"这个邮箱根本没注册"。
 * 这是刻意的取舍 —— 他真正的下一步两种情况下都是"去看邮箱"，
 * 而分不清的代价远小于一份可撞库的会员名单。
 */
authRoute.post('/verify/resend', async (c) => {
  const ip = clientIp(c);
  const body = await c.req.json().catch(() => null);
  const parsed = VerifyResendInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  }
  const { email } = parsed.data;

  /*
   * 两道限流，都在任何数据库查询**之前** —— 顺序反过来的话，
   * "直接返回"和"查完库再返回"的耗时差异就成了一个可测量的存在性信号。
   *
   *   1. (IP + 邮箱)：同一个人反复点。
   *   2. 只按邮箱：防"换 IP 给同一个人反复发信"的邮件轰炸 ——
   *      对受害者来说，来自十个 IP 的十封信和来自一个 IP 的十封信毫无区别，
   *      而我们的成本是一样的。
   */
  const perCaller = hit(
    keyFor('resend', ip, email),
    LIMITS.resendVerify.limit,
    LIMITS.resendVerify.windowMs,
  );
  if (!perCaller.ok) return rateLimited(c, perCaller.retryAfterSec);

  const perAddress = hit(
    keyFor('resend-addr', email),
    LIMITS.resendVerify.limit,
    LIMITS.resendVerify.windowMs,
  );
  if (!perAddress.ok) return rateLimited(c, perAddress.retryAfterSec);

  // 统一响应体。**下面所有分支都必须返回它**。
  const accepted = {
    ok: true as const,
    message: '如果这个邮箱注册过且还没验证，我们已经重新发送了一封验证邮件。',
  };

  const user = findUserByEmail(email);
  if (!user) return c.json(accepted, 200);

  // 已经验证过了：什么都不做，但**不能说出来**。
  // "这封不用发"是一个只有我们自己知道的事实，不能变成响应里的一个字符。
  if (user.email_verified_at !== null) return c.json(accepted, 200);

  const result = await issueVerifyToken(user);
  if (!result.ok) {
    console.error(`[auth] 重发验证邮件失败 (driver=${result.driver}): ${result.error}`);
  } else {
    logSent('重发的验证邮件', user.email, result);
  }

  return c.json(accepted, 200);
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

    /*
     * ⚠️ 重置密码**顺便算作邮箱验证通过**。
     *
     * 这不是顺手加的一行，而是必需的：既然未验证的账号不能登录（偏离三），
     * 一个"忘了密码、邮箱又还没验证"的用户如果只重置密码而不置验证位，
     * 会拿到一个仍然登不进去的新密码 —— 他会以为重置失败了。
     *
     * 而这样做在安全上没有让步：能点开我们发到那个地址的重置链接，
     * 和能点开验证链接，是**完全相同**的一份证明（都证明他控制这个邮箱），
     * 区别只是邮件模板。
     */
    markEmailVerified(row.user_id, now);
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
