/**
 * 「邮箱验证 = 注册完成」这条策略的测试。
 *
 * ---------------------------------------------------------------------------
 * 这是一次**访问模型的改变**，所以测试要把它钉死
 * ---------------------------------------------------------------------------
 * 原来的规则是"验证挡的是提交，不是登录"：没验证的人能正常登录、能浏览，
 * 只是不能提交内容。现在改成"没验证就等于没注册完"。
 *
 * 这条改变有一个**真实的代价**：发信出问题时，用户完全进不来。
 * 所以配套的那条"不需要登录的重发验证邮件"接口必须也是可用的 ——
 * 否则一封没送达的邮件就把这个人永久挡在门外了。下面两条一起测。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.MCSR_MAIL_DRIVER = 'file';
process.env.MCSR_SCRYPT_TEST_PARAMS = 'N=1024,r=8,p=1';

const { app } = await import('./index');
const { closeDb, getDb } = await import('./db');
const { resetAll } = await import('./auth/ratelimit');
const { SITE } = await import('@mcsr/shared');

const PASSWORD = 'a good long passphrase';
/** 每封邮件落盘的地方。测试直接读文件断言"到底发没发"。 */
const MAIL_DIR = mkdtempSync(join(tmpdir(), 'mcsr-verify-'));
process.env.MCSR_MAIL_DIR = MAIL_DIR;

after(() => closeDb());
beforeEach(() => resetAll());

interface Res {
  status: number;
  body: Record<string, unknown>;
  setCookie: string | null;
}

async function call(
  method: string,
  path: string,
  options: { json?: unknown; cookie?: string } = {},
): Promise<Res> {
  const headers: Record<string, string> = { origin: SITE.productionOrigin };
  if (options.json !== undefined) headers['content-type'] = 'application/json';
  if (options.cookie) headers.cookie = options.cookie;

  const response = await app.request(path, {
    method,
    headers,
    ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : {}),
  });
  const raw = response.headers.getSetCookie?.() ?? [];
  return {
    status: response.status,
    body: (await response.json().catch(() => ({}))) as Record<string, unknown>,
    setCookie: raw[0] ?? null,
  };
}

let seq = 0;
const uniqueEmail = () => `vr${String(++seq)}.${Date.now()}@example.com`;

/** 从最新那封落盘的邮件里把 token 抠出来 —— 模拟"用户点开邮件里的链接"。 */
function latestToken(): string {
  const files = readdirSync(MAIL_DIR).sort();
  const last = files[files.length - 1];
  assert.ok(last, '应当有邮件落盘');
  const content = readFileSync(join(MAIL_DIR, last), 'utf8');
  const match = /verify-email\?token=([A-Za-z0-9_-]+)/.exec(content);
  assert.ok(match, '邮件里应当有验证链接');
  return match[1] as string;
}

describe('★ 邮箱验证 = 注册完成', () => {
  it('注册之后**不能登录**，验证之后才能', async () => {
    const email = uniqueEmail();

    const reg = await call('POST', '/api/auth/register', {
      json: { email, password: PASSWORD, displayName: '待验证用户', locale: 'zh-CN' },
    });
    assert.equal(reg.status, 200);

    // ★ 这一步是这次策略变更的核心：没验证 = 不是可用账号
    const beforeVerify = await call('POST', '/api/auth/login', {
      json: { email, password: PASSWORD },
    });
    assert.equal(beforeVerify.status, 403);
    assert.equal(beforeVerify.body.error, 'email_not_verified');
    assert.equal(beforeVerify.setCookie, null, '被拒时绝不能下发会话 cookie');

    // 验证
    const verified = await call('POST', '/api/auth/verify', { json: { token: latestToken() } });
    assert.equal(verified.status, 200);

    // 现在才算注册完成
    const afterVerify = await call('POST', '/api/auth/login', {
      json: { email, password: PASSWORD },
    });
    assert.equal(afterVerify.status, 200, '验证之后应当能登录');
    assert.ok(afterVerify.setCookie, '登录成功要下发会话');
  });

  it('密码错误仍然是 401（不会被"未验证"这个结论盖住）', async () => {
    /*
     * ⚠️ 顺序问题：如果先判"未验证"，那么知道别人邮箱的人
     *    随便输个错密码就能确认"这个人注册过、还没验证"。
     *    先验证密码，意味着只有**真的知道密码**的人才会走到那一步。
     */
    const email = uniqueEmail();
    await call('POST', '/api/auth/register', {
      json: { email, password: PASSWORD, displayName: '待验证用户', locale: 'zh-CN' },
    });

    const wrong = await call('POST', '/api/auth/login', {
      json: { email, password: 'definitely-not-the-password' },
    });
    assert.equal(wrong.status, 401, '密码错就是 401，不能泄漏"这个邮箱没验证"');
    assert.equal(wrong.body.error, 'invalid_credentials');
  });

  it('停用优先于未验证（停用是更强的结论）', async () => {
    const email = uniqueEmail();
    await call('POST', '/api/auth/register', {
      json: { email, password: PASSWORD, displayName: '待验证用户', locale: 'zh-CN' },
    });
    getDb().prepare("UPDATE users SET status = 'suspended' WHERE email = ?").run(email);

    const res = await call('POST', '/api/auth/login', { json: { email, password: PASSWORD } });
    assert.equal(res.body.error, 'account_suspended');
  });

  it('★ 未登录也能重发验证邮件（否则一封没送达的信就把人永久挡在门外）', async () => {
    const email = uniqueEmail();
    await call('POST', '/api/auth/register', {
      json: { email, password: PASSWORD, displayName: '待验证用户', locale: 'zh-CN' },
    });

    const before = readdirSync(MAIL_DIR).length;
    const resend = await call('POST', '/api/auth/verify/resend', { json: { email } });
    assert.equal(resend.status, 200);
    assert.ok(resend.body.ok);

    const after = readdirSync(MAIL_DIR).length;
    assert.equal(after, before + 1, '应当真的又发了一封');

    // 新发的那一封里的 token 才是有效的
    const verified = await call('POST', '/api/auth/verify', { json: { token: latestToken() } });
    assert.equal(verified.status, 200);
    const login = await call('POST', '/api/auth/login', { json: { email, password: PASSWORD } });
    assert.equal(login.status, 200);
  });

  it('重发接口对"没注册过的邮箱"和"已验证的邮箱"给出**完全一样**的响应', async () => {
    /*
     * 这个接口不需要登录，是整个认证面上唯一一个"给任意邮箱发信"的入口。
     * 它的响应如果随账号是否存在而变化，就变成了一个"查这个邮箱注册过没有"
     * 的探测工具 —— 而注册接口刻意做了同样的防护，这里必须一致。
     */
    const unknown = await call('POST', '/api/auth/verify/resend', {
      json: { email: uniqueEmail() },
    });

    const email = uniqueEmail();
    await call('POST', '/api/auth/register', {
      json: { email, password: PASSWORD, displayName: '待验证用户', locale: 'zh-CN' },
    });
    await call('POST', '/api/auth/verify', { json: { token: latestToken() } });
    const alreadyVerified = await call('POST', '/api/auth/verify/resend', { json: { email } });

    assert.equal(unknown.status, alreadyVerified.status);
    assert.deepEqual(unknown.body, alreadyVerified.body, '两种情况的响应必须逐字相同');

    // 而"已验证"的那一次**不该真的发信**
    const before = readdirSync(MAIL_DIR).length;
    await call('POST', '/api/auth/verify/resend', { json: { email } });
    assert.equal(readdirSync(MAIL_DIR).length, before, '已验证的邮箱不该再收到验证信');
  });

  it('邮箱格式不对给 400（那是请求的问题，不是"存不存在"的问题）', async () => {
    const res = await call('POST', '/api/auth/verify/resend', { json: { email: 'not-an-email' } });
    assert.equal(res.status, 400);
  });

  it('注册的返回文案说的是"去完成注册"，不是"去登录"', async () => {
    /*
     * ⚠️ 文案也是契约的一部分：旧文案是"如果已经注册过，请直接登录"——
     *    而在新规则下**登录根本不会成功**。留着一句做不到的指引，
     *    用户会以为是自己的问题。
     */
    const res = await call('POST', '/api/auth/register', {
      json: {
        email: uniqueEmail(),
        password: PASSWORD,
        displayName: '待验证用户',
        locale: 'zh-CN',
      },
    });
    const message = String(res.body.message ?? '');
    assert.ok(
      message.includes('验证') || message.includes('邮件'),
      `注册回复里应当说明要去邮箱验证，实际是：${message}`,
    );
  });
});
