/**
 * 身份组与权限矩阵的测试。
 *
 * ---------------------------------------------------------------------------
 * 这个文件有两大类测试，目的完全不同
 * ---------------------------------------------------------------------------
 *
 * **一类是"矩阵本身的完整性"**（不需要数据库）：
 *   权限矩阵最危险的状态不是"某条规则写错了"，而是**漏了一条**。
 *   漏掉一条的表现是"某个能力谁都没有"（功能用不了）或者
 *   "某个能力被意外地给了所有人"（权限漏洞）—— 两者都不会报错。
 *   所以这里直接遍历矩阵做结构检查，而不是逐条手写断言。
 *
 * **一类是"接口真的按矩阵执行"**：
 *   矩阵对了但路由忘了挂中间件，等于没写。这类只能走 HTTP 验。
 */
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  type Actor,
  assignableRoles,
  CAPABILITIES,
  can,
  capabilitiesByType,
  checkPermission,
  roleHas,
  USER_ROLES,
} from '@mcsr/shared/permissions';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.MCSR_MAIL_DRIVER = 'console';
process.env.MCSR_SCRYPT_TEST_PARAMS = 'N=1024,r=8,p=1';

const { app } = await import('./index');
const { closeDb, getDb } = await import('./db');
const { resetAll } = await import('./auth/ratelimit');
const { SITE } = await import('@mcsr/shared');

// ---------------------------------------------------------------------------
// 一、矩阵本身的完整性（纯函数，不碰数据库）
// ---------------------------------------------------------------------------

const verified = (role: (typeof USER_ROLES)[number]): Actor => ({ role, emailVerified: true });
const unverified = (role: (typeof USER_ROLES)[number]): Actor => ({ role, emailVerified: false });

describe('权限矩阵的完整性', () => {
  it('每个能力都至少被一个角色拥有（没有"谁都用不了"的能力）', () => {
    const orphans = CAPABILITIES.filter((cap) => !USER_ROLES.some((role) => roleHas(role, cap)));
    assert.deepEqual(
      orphans,
      [],
      `这些能力没有任何角色拥有 —— 要么是漏配了，要么是能力定义多余了：${orphans.join(', ')}`,
    );
  });

  it('admin 拥有全部能力（它是矩阵里权限的顶点）', () => {
    const missing = CAPABILITIES.filter((cap) => !can(verified('admin'), cap));
    assert.deepEqual(missing, [], `admin 缺少这些能力：${missing.join(', ')}`);
  });

  it('reviewer 是 user 的超集 —— 审核员当然也能提交', () => {
    for (const cap of CAPABILITIES) {
      if (can(verified('user'), cap)) {
        assert.ok(
          can(verified('reviewer'), cap),
          `user 有 ${cap} 而 reviewer 没有 —— 权限不该越往上越少`,
        );
      }
    }
  });

  it('★ 普通用户**不能**审核、不能管账号', () => {
    // 这两条是整个权限系统存在的主要理由，单独钉死，
    // 免得以后调矩阵时手滑把它们给了 user。
    assert.equal(can(verified('user'), 'resource.review'), false);
    assert.equal(can(verified('user'), 'user.moderate'), false);
    assert.equal(can(verified('user'), 'audit.read'), false);
  });

  it('★ 审核员**不能**改别人的角色', () => {
    assert.equal(can(verified('reviewer'), 'user.moderate'), false);
  });

  it('guest（未登录）什么都不能做', () => {
    for (const cap of CAPABILITIES) {
      assert.equal(can(null, cap), false, `未登录不该能做 ${cap}`);
    }
  });

  it('★ 邮箱未验证挡的是提交，不是审核', () => {
    // 提交类：未验证不能做（§0.1 的访问模型 —— 验证挡在提交上，不挡在登录上）
    assert.equal(can(unverified('user'), 'resource.submit'), false);
    assert.equal(can(unverified('user'), 'calendar.submit'), false);
    assert.equal(can(unverified('user'), 'seed.submit'), false);

    // 审核类：**不要求**邮箱验证。审核员的身份是管理员核实过才授予的，
    // 再要求一次邮箱验证不增加任何保证，反而会在邮件出问题时把能干活的审核员挡住。
    assert.equal(can(unverified('reviewer'), 'resource.review'), true);
    assert.equal(can(unverified('admin'), 'user.moderate'), true);
  });

  it('三种拒绝原因能被区分开（接口要据此返回不同状态码）', () => {
    assert.deepEqual(checkPermission(null, 'resource.submit'), {
      ok: false,
      reason: 'unauthenticated',
    });
    assert.deepEqual(checkPermission(verified('user'), 'resource.review'), {
      ok: false,
      reason: 'forbidden',
    });
    assert.deepEqual(checkPermission(unverified('user'), 'resource.submit'), {
      ok: false,
      reason: 'email_not_verified',
    });
    assert.deepEqual(checkPermission(verified('user'), 'resource.submit'), { ok: true });
  });

  it('能力名都带内容类型前缀（二维矩阵里的"类型"这一维）', () => {
    // M4 会加日历和种子。如果能力名不带类型前缀（比如就叫 "review"），
    // 那时就只能再写一个 "reviewCalendar"，命名立刻失控。
    for (const cap of CAPABILITIES) {
      assert.match(cap, /^[a-z]+\.[a-zA-Z]+$/, `能力名不符合 <类型>.<动作> 约定：${cap}`);
    }
  });

  it('capabilitiesByType 分组正确', () => {
    const grouped = capabilitiesByType('user');
    assert.deepEqual(grouped.resource?.sort(), ['resource.editOwn', 'resource.submit']);
    assert.equal(grouped.user, undefined, '普通用户不该有账号治理能力');
    assert.ok(grouped.calendar?.includes('calendar.submit'));
  });

  it('角色列表按权限从低到高排列，不是字母序', () => {
    // 字母序会是 admin / reviewer / user —— 读起来像随机排列，
    // 让人要多想一步才能确定哪个权限大。
    assert.deepEqual([...assignableRoles()], ['user', 'reviewer', 'admin']);
  });
});

// ---------------------------------------------------------------------------
// 二、接口真的按矩阵执行
// ---------------------------------------------------------------------------

interface Res {
  status: number;
  body: {
    error?: string;
    ok?: boolean;
    role?: string;
    previousRole?: string;
    items?: unknown[];
    roles?: string[];
  };
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
    body: (await response.json().catch(() => ({}))) as Res['body'],
    setCookie: raw[0] ?? null,
  };
}

let seq = 0;
async function makeUser(role: 'user' | 'reviewer' | 'admin' = 'user', verify = true) {
  seq += 1;
  const email = `perm${String(seq)}.${String(Date.now())}@example.com`;
  await call('POST', '/api/auth/register', {
    json: {
      email,
      password: 'a good long passphrase',
      displayName: `测试${String(seq)}`,
      locale: 'zh-CN',
    },
  });
  getDb()
    .prepare('UPDATE users SET role = ?, email_verified_at = ? WHERE email = ?')
    .run(role, verify ? Date.now() : null, email);

  const login = await call('POST', '/api/auth/login', {
    json: { email, password: 'a good long passphrase' },
  });
  assert.equal(login.status, 200);
  return { email, cookie: login.setCookie!.split(';')[0]! };
}

beforeEach(() => {
  resetAll();
});

after(() => {
  closeDb();
});

describe('接口按矩阵执行', () => {
  it('普通用户读待审队列 → 403 forbidden（而不是 401，他确实登录了）', async () => {
    const user = await makeUser('user');
    const res = await call('GET', '/api/admin/queue', { cookie: user.cookie });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'forbidden');
  });

  it('未登录读待审队列 → 401 unauthenticated', async () => {
    const res = await call('GET', '/api/admin/queue');
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'unauthorized');
  });

  it('★ 邮箱未验证的用户提交 → 403 email_not_verified（而不是笼统的 forbidden）', async () => {
    /*
     * 这条守的是"三种拒绝要能区分"。
     * 如果这里返回 forbidden，用户会理解成"我没有这个权限"，然后放弃；
     * 返回 email_not_verified 则告诉他"还差一步，去验证邮箱"。
     */
    const user = await makeUser('user', false);
    const res = await call('POST', '/api/resources', {
      json: {
        kind: 'website',
        title: 'x',
        titleEn: null,
        url: 'https://perm-test.example/',
        imageUrl: null,
        summary: null,
        body: 'y',
        lang: 'en',
        tags: [],
      },
      cookie: user.cookie,
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'email_not_verified');
  });
});

describe('身份组管理', () => {
  it('admin 能看到用户列表', async () => {
    const admin = await makeUser('admin');
    const res = await call('GET', '/api/admin/users', { cookie: admin.cookie });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.items));
    assert.deepEqual(res.body.roles, ['user', 'reviewer', 'admin']);
  });

  it('审核员看不到用户列表（user.moderate 只有 admin 有）', async () => {
    const reviewer = await makeUser('reviewer');
    const res = await call('GET', '/api/admin/users', { cookie: reviewer.cookie });
    assert.equal(res.status, 403);
  });

  it('★ 改角色必须给理由', async () => {
    const admin = await makeUser('admin');
    const target = await makeUser('user');

    const noReason = await call('PATCH', `/api/admin/users/${await idOf(target.email)}/role`, {
      json: { role: 'reviewer' },
      cookie: admin.cookie,
    });
    assert.equal(noReason.status, 400);

    const withReason = await call('PATCH', `/api/admin/users/${await idOf(target.email)}/role`, {
      json: { role: 'reviewer', reason: '他愿意帮忙审资源，已确认身份' },
      cookie: admin.cookie,
    });
    assert.equal(withReason.status, 200);
    assert.equal(withReason.body.role, 'reviewer');
    assert.equal(withReason.body.previousRole, 'user');
  });

  it('改角色会写进审计（含理由）', async () => {
    const admin = await makeUser('admin');
    const target = await makeUser('user');
    const targetId = await idOf(target.email);

    await call('PATCH', `/api/admin/users/${targetId}/role`, {
      json: { role: 'reviewer', reason: '审核通过' },
      cookie: admin.cookie,
    });

    const row = getDb()
      .prepare(
        "SELECT action, reason FROM audit_log WHERE entity_id = ? AND action = 'user.role_change'",
      )
      .get(targetId) as { action: string; reason: string } | undefined;
    assert.ok(row, '应当有审计记录');
    assert.match(row.reason, /user -> reviewer/, '审计里要记下改前改后');
    assert.match(row.reason, /审核通过/, '审计里要带上理由');
  });

  it('★ 不能降级最后一个管理员（否则谁也改不了角色了）', async () => {
    /*
     * 这是权限系统里最经典的一类事故：管理员把自己降级，
     * 然后整个系统再没有任何人能授权。防住它只需要一个 COUNT。
     */
    // ⚠️ 这几条测试需要一个"全世界只有一个管理员"的状态，
    //    而同一个文件里的测试**共用同一个内存库** —— 前面几条已经造了几个管理员。
    //    不先清场的话 countAdmins() 会大于 1，保护不触发，测试就会失败，
    //    而失败的原因和被测行为毫无关系（我第一版就是这样，报的是
    //    "actual: 200, expected: 409"，看起来像保护没写）。
    getDb().prepare("UPDATE users SET role = 'user' WHERE role = 'admin'").run();

    const admin = await makeUser('admin');
    const adminId = await idOf(admin.email);

    const res = await call('PATCH', `/api/admin/users/${adminId}/role`, {
      json: { role: 'user', reason: '手滑' },
      cookie: admin.cookie,
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'last_admin');

    // 确认角色真的没变
    const row = getDb().prepare('SELECT role FROM users WHERE id = ?').get(adminId) as {
      role: string;
    };
    assert.equal(row.role, 'admin');
  });

  it('有第二个管理员时，降级其中一个就允许了', async () => {
    // 同样先清场，让"管理员人数"从已知状态开始
    getDb().prepare("UPDATE users SET role = 'user' WHERE role = 'admin'").run();
    const a = await makeUser('admin');
    await makeUser('admin');
    const aId = await idOf(a.email);

    const res = await call('PATCH', `/api/admin/users/${aId}/role`, {
      json: { role: 'reviewer', reason: '交接完毕' },
      cookie: a.cookie,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.role, 'reviewer');
  });

  it('不能把角色改成不存在的值', async () => {
    const admin = await makeUser('admin');
    const target = await makeUser('user');
    const res = await call('PATCH', `/api/admin/users/${await idOf(target.email)}/role`, {
      json: { role: 'superadmin', reason: '想给自己加权限' },
      cookie: admin.cookie,
    });
    assert.equal(res.status, 400);
  });

  it('改角色后，新权限**立刻**生效（不需要重新登录）', async () => {
    /*
     * 这条测的是"权限从数据库读，不从会话里缓存"。
     * 如果把角色写进会话，改完角色之后必须等对方重新登录才生效 ——
     * 而"降级一个滥用权限的人"这件事恰恰需要立刻生效。
     */
    const admin = await makeUser('admin');
    const target = await makeUser('user');

    const before = await call('GET', '/api/admin/queue', { cookie: target.cookie });
    assert.equal(before.status, 403);

    await call('PATCH', `/api/admin/users/${await idOf(target.email)}/role`, {
      json: { role: 'reviewer', reason: '提拔' },
      cookie: admin.cookie,
    });

    // 用**同一个 cookie** 再请求一次
    const after = await call('GET', '/api/admin/queue', { cookie: target.cookie });
    assert.equal(after.status, 200, '提权之后应当立刻生效，不该等重新登录');
  });
});

async function idOf(email: string): Promise<string> {
  const row = getDb().prepare('SELECT id FROM users WHERE email = ?').get(email) as
    | { id: string }
    | undefined;
  assert.ok(row, `找不到用户 ${email}`);
  return row.id;
}
