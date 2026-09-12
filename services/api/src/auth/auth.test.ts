/**
 * 认证系统测试。
 *
 * 这里刻意走**完整的 HTTP 路径**（app.request），而不是只测函数：
 * 注册/登录最容易出问题的地方不是哈希算错了，而是
 * **cookie 没设对、状态码不对、两个分支的响应不一样**——
 * 那些只有走完整链路才看得见。
 *
 * 邮件用 file 驱动（写到临时目录），于是测试可以从"用户真正收到的邮件"里
 * 把链接抓出来，再拿那条链接去请求 —— 这验证的是**整条管道**：
 * 模板渲染、URL 拼接、token 落库、兑换。任何一环断了，这个测试都会红。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

// ---- 必须在导入任何业务模块**之前**设置 ----
// db 是单例，第一次 getDb() 时路径就固定了；邮件驱动同理，每次发送时读环境变量。
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.MCSR_MAIL_DRIVER = 'file';

/**
 * 把 scrypt 强度降下来，只为了测试跑得快。
 *
 * 这一点是必须的，不是可选优化：整套测试要跑几十次注册和登录，
 * 每次真花 400ms 的话整个套件要 70 秒 —— 长到会让人不想跑测试，
 * 而"不想跑测试"最终等于"没有测试"。
 *
 * 安全性由三件事保证，缺一不可：
 *   1. 开关只在 NODE_ENV === 'test' 时生效（password.ts 里显式判断）
 *   2. 只能调低不能调高
 *   3. **有一条测试直接验证它在生产环境下被忽略**（见下面的"测试后门本身"）
 * 而且哈希的算法路径（格式解析、salt、比较、损坏输入的处理）与强度无关，
 * 那些才是这里真正要覆盖的东西。
 */
process.env.MCSR_SCRYPT_TEST_PARAMS = 'N=1024,r=8,p=1';

const MAIL_DIR = mkdtempSync(join(tmpdir(), 'mcsr-mail-'));
process.env.MCSR_MAIL_DIR = MAIL_DIR;

const { app } = await import('../index');
const { SITE } = await import('@mcsr/shared');
const { closeDb, getDb } = await import('../db');
const { hashPassword, needsRehash, verifyPassword, PASSWORD_PARAMS, activeParams } = await import(
  './password'
);
const { generateToken, hashToken } = await import('./tokens');
const { resetAll } = await import('./ratelimit');
const { findUserByEmail } = await import('../users');

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/**
 * 响应的形状。
 *
 * 刻意**不用 `any`**：这套测试的核心断言就是"两个分支的响应必须一模一样"
 * 和"响应里不许出现某个字段"，而 `any` 会让 `res.body.usre.email` 这种
 * 拼写错误静默通过（拿到 undefined，断言跟着一起失效）。
 * 把所有可能出现的字段列出来，写错名字就编译不过。
 */
interface FieldIssue {
  field: string;
  message: string;
}

interface ResBody {
  ok?: boolean;
  error?: string;
  message?: string;
  retryAfterSec?: number;
  alreadyVerified?: boolean;
  issues?: FieldIssue[];
  user?: {
    email?: string;
    emailVerified?: boolean;
    canSubmit?: boolean;
  } | null;
}

interface Res {
  status: number;
  body: ResBody;
  cookies: string[];
  setCookie: string | null;
}

async function call(
  method: string,
  path: string,
  options: { json?: unknown; cookie?: string; headers?: Record<string, string> } = {},
): Promise<Res> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.json !== undefined) headers['content-type'] = 'application/json';
  if (options.cookie) headers.cookie = options.cookie;

  const response = await app.request(path, {
    method,
    headers,
    ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : {}),
  });

  const raw = response.headers.getSetCookie?.() ?? [];
  const parsed = (await response.json().catch(() => null)) as ResBody | null;

  // 这个 API 的**每一个**端点都返回 JSON，包括错误。
  // 所以"没有 JSON 体"本身就是断言失败，在这里直接爆掉，
  // 而不是让调用方到处写 `res.body?.x` 把问题掩盖成 undefined。
  assert.ok(parsed !== null, `${method} ${path} 没有返回 JSON 体`);

  return {
    status: response.status,
    body: parsed,
    cookies: raw,
    setCookie: raw[0] ?? null,
  };
}

/**
 * 取出响应里的 user，并断言它存在。
 *
 * `assert.ok` 是断言函数（`asserts value`），所以返回类型会被收窄成非空 ——
 * 于是调用方写 `userOf(res).email` 而不用写一长串 `?.`，
 * 同时"没有 user"仍然会明确地失败。
 */
function userOf(res: Res): NonNullable<ResBody['user']> {
  const user = res.body.user;
  assert.ok(user, '期望响应里有 user');
  return user;
}

/** 从 Set-Cookie 里取出会话 cookie 的 `名字=值` 部分，用于后续请求带上它。 */
function cookiePair(setCookie: string | null): string {
  assert.ok(setCookie, '期望有 Set-Cookie');
  return setCookie.split(';')[0]!;
}

/** 读最新一封"已发出"的邮件正文。 */
function latestMail(): string {
  const files = readdirSync(MAIL_DIR).sort();
  assert.ok(files.length > 0, '期望至少有一封邮件');
  return readFileSync(join(MAIL_DIR, files[files.length - 1]!), 'utf8');
}

function tokenFrom(mail: string, kind: 'verify-email' | 'reset-password'): string {
  const m = new RegExp(`/${kind}\\?token=([A-Za-z0-9_-]+)`).exec(mail);
  assert.ok(m, `邮件里没有找到 /${kind}?token= 链接：\n${mail.slice(0, 600)}`);
  return m[1]!;
}

let seq = 0;
function uniqueEmail(): string {
  seq += 1;
  return `user${seq}.${Date.now()}@example.com`;
}

const GOOD_PASSWORD = 'correct horse battery staple';

async function registerUser(email = uniqueEmail()) {
  const res = await call('POST', '/api/auth/register', {
    json: { email, password: GOOD_PASSWORD, displayName: '测试用户', locale: 'zh-CN' },
  });
  return { res, email };
}

/**
 * 把邮箱直接标记为已验证。
 *
 * ⚠️ 2026-09-12 起，"邮箱没验证就不能登录"是产品行为
 *    （见 routes/auth.ts 里那段注释）。而**这个文件测的不是那条策略** ——
 *    它测的是密码哈希、会话 cookie、限流这些与验证无关的东西。
 *    所以用例在这里直接把前置条件摆好，而不是每个用例都先走一遍验证流程。
 *
 *    那条策略本身由 services/api/src/verify-required.test.ts 专门覆盖。
 */
function markVerified(email: string): void {
  /*
   * ⚠️ 用 lower(?)，不要直接用传进来的邮箱：库里存的是小写形态，
   *    而有的用例刻意传大写来测"大小写不影响登录" ——
   *    直接比较会让那条用例里 UPDATE 匹配不到任何行，
   *    表现为"登录被拒"，看起来像大小写处理坏了。
   */
  getDb()
    .prepare('UPDATE users SET email_verified_at = ? WHERE email = lower(?)')
    .run(Date.now(), email);
}

async function loginUser(email: string) {
  /*
   * ⚠️ 先标记为已验证再登录。
   *
   * 2026-09-12 起"邮箱没验证就不能登录"是产品行为（见 routes/auth.ts 的注释），
   * 而这个文件测的是密码哈希、会话 cookie、限流这些**与验证无关**的东西 ——
   * 前置条件在这里摆好比每个用例都先走一遍验证流程清楚得多。
   * 那条策略本身由 verify-required.test.ts 专门覆盖。
   */
  markVerified(email);
  return call('POST', '/api/auth/login', { json: { email, password: GOOD_PASSWORD } });
}

// ---------------------------------------------------------------------------

before(() => {
  // 触发建库与迁移
  getDb();
});

after(() => {
  closeDb();
  rmSync(MAIL_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  // 限流是内存态，测试之间必须清掉，否则前一个测试的登录次数会算到后一个头上
  resetAll();
});

// ---------------------------------------------------------------------------

describe('密码哈希', () => {
  it('正确密码能通过校验', async () => {
    const stored = await hashPassword(GOOD_PASSWORD);
    assert.equal(await verifyPassword(GOOD_PASSWORD, stored), true);
  });

  it('错误密码不能通过', async () => {
    const stored = await hashPassword(GOOD_PASSWORD);
    assert.equal(await verifyPassword('wrong password', stored), false);
  });

  it('同一个密码两次哈希结果不同（salt 每次都重新随机）', async () => {
    const a = await hashPassword(GOOD_PASSWORD);
    const b = await hashPassword(GOOD_PASSWORD);
    assert.notEqual(a, b, '两次哈希相同意味着 salt 没有随机 —— 彩虹表就有效了');
    // 但两个都要能验证通过
    assert.equal(await verifyPassword(GOOD_PASSWORD, a), true);
    assert.equal(await verifyPassword(GOOD_PASSWORD, b), true);
  });

  it('存储格式损坏时返回 false，而不是抛异常', async () => {
    // 数据库里可能存在历史遗留的、格式不对的行。这不该让登录接口 500。
    for (const broken of [
      '',
      'garbage',
      'scrypt$1$2$3',
      'bcrypt$1$2$3$c2FsdA$aGFzaA',
      '$'.repeat(5),
    ]) {
      assert.equal(await verifyPassword(GOOD_PASSWORD, broken), false, `输入: ${broken}`);
    }
  });

  it('参数被篡改成天文数字时直接拒绝，不会真的去分配内存', async () => {
    // 防拒绝服务：数据库里的参数可信，但一旦被改成 N=2^30，
    // 一次登录就能吃掉上百 GB。应该在解析阶段就挡掉。
    const evil = `scrypt$1073741824$8$1$c2FsdA$aGFzaA`;
    assert.equal(await verifyPassword(GOOD_PASSWORD, evil), false);
  });

  it('needsRehash 能识别出参数已经过时的哈希', async () => {
    const current = await hashPassword(GOOD_PASSWORD);
    assert.equal(needsRehash(current), false);

    const old = `scrypt$16384$8$1$c2FsdA$aGFzaA`;
    assert.equal(needsRehash(old), true);

    assert.equal(needsRehash('完全不是哈希'), true);
  });

  it('参数与 OWASP 推荐强度一致（防止有人悄悄调低）', () => {
    // 这是一条"防回退"测试：把 N 从 2^16 调成 2^14 能让测试快 4 倍，
    // 看起来像是"优化"，实际是削弱。
    assert.deepEqual(PASSWORD_PARAMS, { N: 2 ** 16, r: 8, p: 2 });
  });
});

describe('测试后门本身', () => {
  // 一个"只在测试里打开的开关"必须有测试证明它在生产里打不开。
  // 否则它就是一条弱密码的隐藏通道，而且没有任何东西会提醒我们。
  const original = process.env.NODE_ENV;

  after(() => {
    process.env.NODE_ENV = original;
  });

  it('测试环境下生效，且确实降低了强度', () => {
    process.env.NODE_ENV = 'test';
    const params = activeParams();
    assert.ok(params.N < PASSWORD_PARAMS.N, '测试环境应当用更低的强度');
  });

  it('生产环境下**完全忽略**这个开关', () => {
    process.env.NODE_ENV = 'production';
    assert.deepEqual(activeParams(), PASSWORD_PARAMS);
  });

  it('开关只能调低，写高了会被忽略', () => {
    process.env.NODE_ENV = 'test';
    process.env.MCSR_SCRYPT_TEST_PARAMS = `N=${2 ** 20},r=8,p=1`;
    assert.deepEqual(activeParams(), PASSWORD_PARAMS, '不能通过环境变量把强度抬高');

    // 格式不对也静默退回生产参数
    process.env.MCSR_SCRYPT_TEST_PARAMS = '随便写点什么';
    assert.deepEqual(activeParams(), PASSWORD_PARAMS);

    // 恢复，免得影响后面的测试
    process.env.MCSR_SCRYPT_TEST_PARAMS = 'N=1024,r=8,p=1';
  });
});

describe('令牌', () => {
  it('每次生成的 token 都不同，且只含 URL 安全字符', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = generateToken();
      assert.match(t, /^[A-Za-z0-9_-]+$/, `token 含非 URL 安全字符: ${t}`);
      assert.equal(seen.has(t), false, '生成了重复的 token');
      seen.add(t);
    }
    // 32 字节 base64url = 43 字符
    assert.equal(generateToken().length, 43);
  });

  it('hashToken 是确定的', () => {
    const t = generateToken();
    assert.equal(hashToken(t), hashToken(t));
    assert.notEqual(hashToken(t), hashToken(generateToken()));
  });
});

describe('注册', () => {
  it('注册成功，且**不下发**会话 cookie', async () => {
    const { res } = await registerUser();
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.setCookie, null, '注册不应自动登录 —— 见 routes/auth.ts 的说明');
  });

  it('重复注册的响应与首次注册**完全一致**，且不新建账号', async () => {
    const email = uniqueEmail();
    const first = await registerUser(email);
    const second = await registerUser(email);

    assert.equal(second.res.status, first.res.status);
    assert.deepEqual(
      second.res.body,
      first.res.body,
      '两次响应体不同 = 泄漏了"这个邮箱是否已注册"',
    );
    assert.equal(second.res.setCookie, null);
  });

  it('大小写不同的同一邮箱算重复', async () => {
    const email = uniqueEmail();
    await registerUser(email);
    const before = findUserByEmail(email);
    assert.ok(before);

    // 用大写再注册一次
    await registerUser(email.toUpperCase());
    const after = findUserByEmail(email);

    assert.equal(after?.id, before?.id, '大小写不同不该创建出第二个账号');
  });

  it('密码太短被拒绝，并给出可读的字段级错误', async () => {
    const res = await call('POST', '/api/auth/register', {
      json: { email: uniqueEmail(), password: 'short', displayName: '甲' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_input');
    assert.ok(Array.isArray(res.body.issues) && res.body.issues.length > 0);
    assert.ok(res.body?.issues?.some((i) => i.field === 'password'));
  });

  it('邮箱格式不对被拒绝', async () => {
    const res = await call('POST', '/api/auth/register', {
      json: { email: '不是邮箱', password: GOOD_PASSWORD, displayName: '甲' },
    });
    assert.equal(res.status, 400);
    assert.ok(res.body?.issues?.some((i) => i.field === 'email'));
  });

  it('注册后账号未验证邮箱', async () => {
    const { email } = await registerUser();
    const user = findUserByEmail(email);
    assert.ok(user);
    assert.equal(user.email_verified_at, null);
  });
});

describe('登录', () => {
  it('正确密码登录成功，并下发 HttpOnly 会话 cookie', async () => {
    const { email } = await registerUser();
    const res = await loginUser(email);

    assert.equal(res.status, 200);
    assert.ok(res.setCookie);
    assert.match(res.setCookie!, /HttpOnly/i, '会话 cookie 必须是 HttpOnly，否则 XSS 能偷走它');
    assert.match(res.setCookie!, /SameSite=Lax/i, 'Lax 是 CSRF 的第一层防护');
    assert.match(res.setCookie!, /Path=\//i);
    // 开发环境不该带 Secure，否则 http://localhost 下浏览器不会保存它
    assert.doesNotMatch(res.setCookie!, /Secure/i);
  });

  it('登录响应里的用户对象不含密码哈希', async () => {
    const { email } = await registerUser();
    const res = await loginUser(email);
    const serialized = JSON.stringify(res.body);
    assert.doesNotMatch(serialized, /password_hash/i);
    assert.doesNotMatch(serialized, /scrypt\$/i, '响应里不该出现哈希本身');
    assert.equal(userOf(res).email, email);
  });

  it('密码错误返回 401', async () => {
    const { email } = await registerUser();
    const res = await call('POST', '/api/auth/login', { json: { email, password: '错误密码123' } });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'invalid_credentials');
  });

  it('邮箱不存在与密码错误的响应**逐字节相同**（防账号枚举）', async () => {
    const { email } = await registerUser();
    const wrongPassword = await call('POST', '/api/auth/login', {
      json: { email, password: '错误密码123' },
    });
    const noSuchUser = await call('POST', '/api/auth/login', {
      json: { email: uniqueEmail(), password: '错误密码123' },
    });

    assert.equal(noSuchUser.status, wrongPassword.status);
    assert.deepEqual(noSuchUser.body, wrongPassword.body);
  });

  it('邮箱大小写不同也能登录', async () => {
    const { email } = await registerUser();
    const res = await loginUser(email.toUpperCase());
    assert.equal(res.status, 200);
  });

  it('连续失败到上限后返回 429', async () => {
    const { email } = await registerUser();
    const attempt = () =>
      call('POST', '/api/auth/login', { json: { email, password: '错误密码123' } });

    // 配额是 10 次/15 分钟
    let last = await attempt();
    for (let i = 0; i < 12; i++) last = await attempt();

    assert.equal(last.status, 429);
    assert.equal(last.body.error, 'rate_limited');
    assert.ok(Number(last.body.retryAfterSec) > 0);
  });

  it('限流只针对该 IP + 该邮箱，换一个账号不受影响', async () => {
    // 这条守着 ratelimit.ts 文件头讲的那个坑：
    // 如果按邮箱（不带 IP）计数，任何人都能用别人的邮箱故意输错密码把人锁死。
    const victim = await registerUser();
    const other = await registerUser();

    for (let i = 0; i < 12; i++) {
      await call('POST', '/api/auth/login', {
        json: { email: victim.email, password: '错误密码123' },
      });
    }

    // 另一个账号在同一个 IP 上仍然能正常登录
    const res = await loginUser(other.email);
    assert.equal(res.status, 200);
  });
});

describe('会话', () => {
  it('未登录时 /me 返回 200 + null（不是 401）', async () => {
    const res = await call('GET', '/api/auth/me');
    assert.equal(res.status, 200);
    assert.equal(res.body.user, null);
  });

  it('带着 cookie 能取回自己的信息', async () => {
    const { email } = await registerUser();
    const login = await loginUser(email);
    const res = await call('GET', '/api/auth/me', { cookie: cookiePair(login.setCookie) });

    assert.equal(res.status, 200);
    assert.equal(userOf(res).email, email);
    /*
     * ⚠️ 这两条断言的期望值在 2026-09-12 变过。
     *    以前能测出"登录了但邮箱未验证"这个中间状态（验证挡的是提交、不是登录）；
     *    现在**未验证根本登不进来**（见 routes/auth.ts 的注释），
     *    所以任何登录成功的人都必然是已验证的 —— 中间状态不复存在。
     *    "未验证不能登录"本身由 verify-required.test.ts 覆盖。
     */
    assert.equal(userOf(res).emailVerified, true);
    assert.equal(userOf(res).canSubmit, true);
  });

  it('数据库里存的是 token 的哈希，不是明文', async () => {
    const { email } = await registerUser();
    const login = await loginUser(email);
    const plaintext = cookiePair(login.setCookie).split('=')[1]!;

    // 用哈希去查得到，用明文去查查不到 —— 这两条一起才说明"库里存的是哈希"。
    // （我第一版写的是 `SELECT token_hash FROM sessions` 不带 WHERE，
    //   拿到的是前面测试留下的第一行，于是断言在比两个不相干的会话。）
    const byHash = getDb()
      .prepare('SELECT token_hash FROM sessions WHERE token_hash = ?')
      .get(hashToken(plaintext));
    assert.ok(byHash, '应当能按 token 的哈希查到这条会话');

    const byPlaintext = getDb()
      .prepare('SELECT token_hash FROM sessions WHERE token_hash = ?')
      .get(plaintext);
    assert.equal(byPlaintext, undefined, '明文 token 落库 = 库一泄漏就等于所有人被冒充');
  });

  it('伪造的 token 不被接受', async () => {
    const res = await call('GET', '/api/auth/me', {
      cookie: `mcsr_session=${generateToken()}`,
    });
    assert.equal(res.body.user, null);
  });

  it('登出后当前 cookie 失效', async () => {
    const { email } = await registerUser();
    const login = await loginUser(email);
    const cookie = cookiePair(login.setCookie);

    const out = await call('POST', '/api/auth/logout', { cookie });
    assert.equal(out.status, 200);

    const me = await call('GET', '/api/auth/me', { cookie });
    assert.equal(me.body.user, null);
  });

  it('登出是幂等的：未登录时调用也返回成功', async () => {
    const res = await call('POST', '/api/auth/logout');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });
});

describe('邮箱验证', () => {
  it('注册邮件里有一条可用的验证链接，走完就能提交', async () => {
    const { email } = await registerUser();
    const token = tokenFrom(latestMail(), 'verify-email');

    const res = await call('POST', '/api/auth/verify', { json: { token } });
    assert.equal(res.status, 200);
    assert.equal(userOf(res).emailVerified, true);
    assert.equal(userOf(res).canSubmit, true);

    const user = findUserByEmail(email);
    assert.ok(user?.email_verified_at, '数据库里应记下验证时间');
  });

  it('邮件里是**纯文本链接**，不是图片按钮', async () => {
    // docs/v1-plan.md §9.2 的硬要求：QQ 邮箱默认不显示图片和图片上的链接。
    // 做成图片按钮的后果是邮件投递成功、用户点不动，而我们这边毫无察觉。
    await registerUser();
    const mail = latestMail();

    assert.doesNotMatch(mail, /<img/i, '邮件里不该有 <img>');
    assert.doesNotMatch(mail, /<button/i, '邮件里不该有按钮');
    assert.doesNotMatch(mail, /background-image/i);

    // 链接文字必须是 URL 本身，这样即使锚点被剥掉用户也能手动复制
    const url = tokenFrom(mail, 'verify-email');
    assert.ok(mail.includes(`>${url}`) || mail.includes(url), '正文里应出现完整 URL');
    // 纯文本部分（text/plain 段）也必须带完整 URL
    const plainStart = mail.indexOf('Content-Type: text/plain');
    const plainEnd = mail.indexOf('Content-Type: text/html');
    assert.ok(plainStart >= 0 && plainEnd > plainStart);
    const plain = mail.slice(plainStart, plainEnd);
    assert.ok(plain.includes(url), 'text/plain 段必须含完整 URL');
  });

  it('同一个 token 不能用第二次', async () => {
    await registerUser();
    const token = tokenFrom(latestMail(), 'verify-email');

    const first = await call('POST', '/api/auth/verify', { json: { token } });
    assert.equal(first.status, 200);

    const second = await call('POST', '/api/auth/verify', { json: { token } });
    assert.equal(second.status, 400);
    assert.equal(second.body.error, 'invalid_token');
  });

  it('不存在的 token 被拒绝', async () => {
    const res = await call('POST', '/api/auth/verify', { json: { token: generateToken() } });
    assert.equal(res.status, 400);
  });

  it('重发会作废上一次的链接', async () => {
    const { email } = await registerUser();
    const oldToken = tokenFrom(latestMail(), 'verify-email');

    /*
     * ⚠️ 这里**不能**先登录：新策略下未验证的账号登不进来，
     *    而这条用例要的恰恰是一个"未验证 + 要重发"的账号。
     *    所以改用那个不需要登录的重发接口（/verify/resend）——
     *    它存在的理由正是这一条（见 routes/auth.ts 里那段注释）。
     */
    const send = await call('POST', '/api/auth/verify/resend', { json: { email } });
    assert.equal(send.status, 200);

    const newToken = tokenFrom(latestMail(), 'verify-email');
    assert.notEqual(newToken, oldToken);

    // 旧链接必须失效。否则用户连点几次重发，手里就有多条都有效的凭证，
    // 而它们各自的有效期是没有上界的。
    const old = await call('POST', '/api/auth/verify', { json: { token: oldToken } });
    assert.equal(old.status, 400, '旧 token 应当已失效');

    const fresh = await call('POST', '/api/auth/verify', { json: { token: newToken } });
    assert.equal(fresh.status, 200);
  });

  it('已验证的账号重发时不会真的再发一封信', async () => {
    const { email } = await registerUser();
    await call('POST', '/api/auth/verify', {
      json: { token: tokenFrom(latestMail(), 'verify-email') },
    });

    const login = await loginUser(email);
    const before = readdirSync(MAIL_DIR).length;

    const res = await call('POST', '/api/auth/verify/send', {
      cookie: cookiePair(login.setCookie),
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.alreadyVerified, true);
    assert.equal(readdirSync(MAIL_DIR).length, before, '不该多发一封信');
  });

  it('重发需要登录', async () => {
    const res = await call('POST', '/api/auth/verify/send');
    assert.equal(res.status, 401);
  });
});

describe('密码重置', () => {
  it('完整流程：请求 → 收到邮件 → 设置新密码 → 新密码可登录', async () => {
    const { email } = await registerUser();

    const req = await call('POST', '/api/auth/reset/request', { json: { email } });
    assert.equal(req.status, 200);
    assert.equal(req.body.ok, true);

    const token = tokenFrom(latestMail(), 'reset-password');
    const NEW = 'a brand new passphrase';

    const confirm = await call('POST', '/api/auth/reset/confirm', {
      json: { token, password: NEW },
    });
    assert.equal(confirm.status, 200);

    const oldLogin = await loginUser(email);
    assert.equal(oldLogin.status, 401, '旧密码应当失效');

    const newLogin = await call('POST', '/api/auth/login', { json: { email, password: NEW } });
    assert.equal(newLogin.status, 200);
  });

  it('请求重置时，邮箱是否存在返回**完全一致**的响应', async () => {
    const { email } = await registerUser();
    const exists = await call('POST', '/api/auth/reset/request', { json: { email } });
    const missing = await call('POST', '/api/auth/reset/request', {
      json: { email: uniqueEmail() },
    });

    assert.equal(missing.status, exists.status);
    assert.deepEqual(missing.body, exists.body);
  });

  it('重置密码会把其它所有会话踢下线', async () => {
    // 重置密码最常见的场景之一就是"我怀疑账号被别人用了"。
    // 如果攻击者的会话还活着，用户会以为问题解决了，实际上对方还能用几周。
    const { email } = await registerUser();
    const sessionA = cookiePair((await loginUser(email)).setCookie);
    const sessionB = cookiePair((await loginUser(email)).setCookie);

    const stillLoggedIn = await call('GET', '/api/auth/me', { cookie: sessionA });
    assert.equal(userOf(stillLoggedIn).email, email);

    await call('POST', '/api/auth/reset/request', { json: { email } });
    const token = tokenFrom(latestMail(), 'reset-password');
    await call('POST', '/api/auth/reset/confirm', {
      json: { token, password: 'another new passphrase' },
    });

    for (const [name, cookie] of [
      ['会话 A', sessionA],
      ['会话 B', sessionB],
    ] as const) {
      const me = await call('GET', '/api/auth/me', { cookie });
      assert.equal(me.body.user, null, `${name} 应当已被踢下线`);
    }
  });

  it('重置 token 不能用第二次', async () => {
    const { email } = await registerUser();
    await call('POST', '/api/auth/reset/request', { json: { email } });
    const token = tokenFrom(latestMail(), 'reset-password');

    await call('POST', '/api/auth/reset/confirm', {
      json: { token, password: 'first new passphrase' },
    });
    const second = await call('POST', '/api/auth/reset/confirm', {
      json: { token, password: 'second new passphrase' },
    });
    assert.equal(second.status, 400);
  });

  it('验证 token 不能拿来重置密码（类型必须匹配）', async () => {
    // 两类令牌存在同一张表里，若不校验 kind，一个验证链接就能改密码。
    const { email } = await registerUser();
    const verifyToken = tokenFrom(latestMail(), 'verify-email');

    await call('POST', '/api/auth/reset/request', { json: { email } });
    const resetToken = tokenFrom(latestMail(), 'reset-password');
    assert.notEqual(verifyToken, resetToken);

    const res = await call('POST', '/api/auth/reset/confirm', {
      json: { token: verifyToken, password: 'hijacked passphrase' },
    });
    assert.equal(res.status, 400, 'verify 令牌不能用于 reset');
  });

  it('新密码太短时被拒绝，且 token 不被消耗', async () => {
    const { email } = await registerUser();
    await call('POST', '/api/auth/reset/request', { json: { email } });
    const token = tokenFrom(latestMail(), 'reset-password');

    const bad = await call('POST', '/api/auth/reset/confirm', {
      json: { token, password: 'short' },
    });
    assert.equal(bad.status, 400);

    // 关键：校验失败**不能**把 token 用掉，否则用户得重新申请一次
    const good = await call('POST', '/api/auth/reset/confirm', {
      json: { token, password: 'a proper long passphrase' },
    });
    assert.equal(good.status, 200, 'token 不该因为一次校验失败就被消耗');
  });
});

describe('CSRF：跨站请求被拒绝', () => {
  it('带外站 Origin 的 POST 被拒', async () => {
    const res = await call('POST', '/api/auth/login', {
      json: { email: uniqueEmail(), password: GOOD_PASSWORD },
      headers: { origin: 'https://evil.example' },
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'cross_origin_rejected');
  });

  it('带本站 Origin 的 POST 正常放行', async () => {
    const { email } = await registerUser();
    /*
     * ⚠️ 这条测的是 **CSRF / Origin**，所以需要一次能成功的登录。
     *    2026-09-12 起未验证的账号登不进来，于是这里先摆好前置条件 ——
     *    否则它会因为"邮箱没验证"而失败，而那个失败和 CSRF 毫无关系。
     */
    markVerified(email);
    const res = await call('POST', '/api/auth/login', {
      json: { email, password: GOOD_PASSWORD },
      /*
       * ⚠️ 引用 SITE.productionOrigin，**不要**把域名写死在这里。
       *
       * 这条测试原来写的是 'https://legacy.example.invalid'。站点搬到
       * 自有域名（mcsrhelper.com）之后它开始失败 —— 而它失败的原因是
       * "域名换了"，跟 CSRF 有没有坏毫无关系。
       * 写死域名的测试会在每次换域名时制造一次假警报，
       * 而假警报最坏的后果是让人开始习惯性忽略红色的测试。
       */
      headers: { origin: SITE.productionOrigin },
    });
    assert.equal(res.status, 200);
  });

  it('旧域名的 POST 不再放行 —— 搬迁之后它只是个跳转', async () => {
    // 这条是**显式**记录搬迁后的预期行为，而不是让它隐含在别处。
    // 旧域名现在 301 到新域名，浏览器发起的 POST 不会从它那里过来。
    const { email } = await registerUser();
    const res = await call('POST', '/api/auth/login', {
      json: { email, password: GOOD_PASSWORD },
      headers: { origin: SITE.legacyOrigin },
    });
    assert.equal(res.status, 403);
  });

  it('没有 Origin 的请求放行（Electron 主进程、curl 等）', async () => {
    const { email } = await registerUser();
    const res = await loginUser(email);
    assert.equal(res.status, 200);
  });
});
