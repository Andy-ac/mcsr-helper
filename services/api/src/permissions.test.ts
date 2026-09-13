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
  canHardDelete,
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
    /*
     * ⚠️ 这条断言在 rework-2 ② 期间**一度被放宽过**（当时"硬删"是一个只给 owner 的能力
     *    `content.hardDelete`，admin 因此少了那一条）。后来那个方案被撤回了：
     *    硬删改成谓词 `canHardDelete(role)`（见 permissions.ts 里它的注释），
     *    于是矩阵又回到"admin 是顶点"—— 这条断言也就**恢复原样**。
     *
     * ⚠️ 保留它是有意义的：谓词不进矩阵，所以"admin 拥有全部能力"这条性质
     *    仍然是矩阵自身的不变量，值得继续守着。
     */
    const missing = CAPABILITIES.filter((cap) => !can(verified('admin'), cap));
    assert.deepEqual(missing, [], `admin 缺少这些能力：${missing.join(', ')}`);
  });

  it('★ 硬删是 owner 专属的**谓词**，不是能力矩阵里的一行', () => {
    /*
     * ⚠️ 这条守的是"谁能真删只有一处定义"。判据是 `canHardDelete`，
     *    而它**刻意不在** `CAPABILITIES` 里 —— 写进矩阵的话，
     *    有人把同一个能力也加进 `admin` 那一行（一次意图完全合理的编辑）就会
     *    **静默放宽**规则，而"某角色有没有某能力"那类断言照样全绿。
     */
    assert.equal(canHardDelete('owner'), true, '只有 owner 能真删');
    for (const role of ['user', 'reviewer', 'editor', 'admin'] as const) {
      assert.equal(canHardDelete(role), false, `${role} 不该能真删`);
    }
    // 反面控制：那个能力名**不该**存在于矩阵里（否则就有了第二处真相）
    assert.equal(
      (CAPABILITIES as readonly string[]).includes('content.hardDelete'),
      false,
      '硬删不该以能力的形式回到 CAPABILITIES —— 它现在是谓词',
    );
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
    // ⚠️ 这里**不含** editUnpublished：那是 editor/admin 才有的能力。
    //    它曾经被误加进 USER_CAPS（等于任何登录用户都能改别人的草稿），
    //    就是这条断言把它抓出来的。
    assert.deepEqual(grouped.resource?.sort(), [
      'resource.editAny',
      'resource.editOwn',
      'resource.submit',
    ]);
    assert.equal(grouped.user, undefined, '普通用户不该有账号治理能力');
    assert.ok(grouped.calendar?.includes('calendar.submit'));
  });

  it('editAny 和 editOwn 是**两个**能力，可以单独收回', () => {
    /*
     * 把它们合成一个 "resource.edit" 的话，"关掉 wiki 式编辑"就意味着
     * 连作者都改不了自己的东西了 —— 而这是一个需要能单独关掉的开关
     * （社区乱改的时候，管理员的第一反应就是先关掉 editAny）。
     *
     * 所以这条测试守的是：两个能力同时存在，而且都包含在 user 的矩阵里。
     */
    assert.ok(CAPABILITIES.includes('resource.editOwn'));
    assert.ok(CAPABILITIES.includes('resource.editAny'));
    assert.equal(roleHas('user', 'resource.editOwn'), true);
    assert.equal(roleHas('user', 'resource.editAny'), true);
    // 两者都要求邮箱已验证 —— 它们是"创造公开内容"的能力
    assert.deepEqual(checkPermission({ role: 'user', emailVerified: false }, 'resource.editAny'), {
      ok: false,
      reason: 'email_not_verified',
    });
  });

  it('角色列表按权限从低到高排列，不是字母序', () => {
    // 字母序会是 admin / reviewer / user —— 读起来像随机排列，
    // 让人要多想一步才能确定哪个权限大。
    assert.deepEqual([...assignableRoles()], ['user', 'reviewer', 'editor', 'admin']);
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
    /** 改角色成功后返回新角色的能力清单（界面用它显示"现在能做什么"） */
    capabilities?: Record<string, string[]>;
    /** 改角色必须给理由，缺理由时服务端回这个标记 */
    reason_required?: boolean;
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
async function makeUser(
  role: 'user' | 'reviewer' | 'editor' | 'admin' | 'owner' = 'user',
  verify = true,
) {
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

  it('★ 邮箱未验证 → 独立的拒绝理由 email_not_verified（不是笼统的 forbidden）', () => {
    /*
     * 这条守的是"三种拒绝要能区分"。
     * 如果返回 forbidden，用户会理解成"我没有这个权限"，然后放弃；
     * email_not_verified 则告诉他"还差一步，去验证邮箱"。
     *
     * ⚠️ 2026-09-12 起这条不再走 HTTP：**未验证的账号根本登不进来**
     *    （"邮箱验证 = 注册完成"），所以"登录着但未验证"这个状态不存在了，
     *    也就无法用一条 HTTP 请求测它。
     *    规则本身仍然在矩阵里 —— 它是**第二道**闸门（第一道是登录）。
     *    这里直接问矩阵，因为那才是这条规则的定义处。
     */
    assert.deepEqual(checkPermission({ role: 'user', emailVerified: false }, 'resource.submit'), {
      ok: false,
      reason: 'email_not_verified',
    });
    // 验证之后就能提交 —— 两道闸门的关系一眼可见
    assert.deepEqual(checkPermission({ role: 'user', emailVerified: true }, 'resource.submit'), {
      ok: true,
    });
  });
});

describe('身份组管理', () => {
  it('★ 管理员不能降级自己，也不能把别人升成管理员', async () => {
    /*
     * 这两条合起来的效果是：**管理员的角色在网页上完全动不了**。
     * 想调整只能由 owner 来做，或者上服务器跑 admin.js ——
     * 那正是这类操作应有的门槛（能登录服务器）。
     */
    const admin = await makeUser('admin');
    const other = await makeUser('admin'); // 第二个管理员，排除"最后一个"的干扰
    const member = await makeUser();

    const demoteSelf = await call('PATCH', `/api/admin/users/${await idOf(admin.email)}/role`, {
      json: { role: 'user', reason: '我不干了' },
      cookie: admin.cookie,
    });
    assert.equal(demoteSelf.status, 403);
    assert.equal(demoteSelf.body.error, 'admin_self');

    const promoteOther = await call('PATCH', `/api/admin/users/${await idOf(member.email)}/role`, {
      json: { role: 'admin', reason: '提一个管理员' },
      cookie: admin.cookie,
    });
    assert.equal(promoteOther.status, 403);
    assert.equal(promoteOther.body.error, 'admin_promote');

    // 两次被拒之后什么都没变
    assert.equal(await roleOf(admin.email), 'admin');
    assert.equal(await roleOf(member.email), 'user');
    assert.equal(await roleOf(other.email), 'admin');
  });

  it('★ owner 能设置/取消管理员', async () => {
    const owner = await makeUser('owner');
    const member = await makeUser();

    const promote = await call('PATCH', `/api/admin/users/${await idOf(member.email)}/role`, {
      json: { role: 'admin', reason: '提为管理员' },
      cookie: owner.cookie,
    });
    assert.equal(promote.status, 200, JSON.stringify(promote.body));
    assert.equal(await roleOf(member.email), 'admin');

    const demote = await call('PATCH', `/api/admin/users/${await idOf(member.email)}/role`, {
      json: { role: 'user', reason: '取消管理员' },
      cookie: owner.cookie,
    });
    assert.equal(demote.status, 200);
    assert.equal(await roleOf(member.email), 'user');
  });

  it('★ 涉及 owner 的角色谁也改不了（包括 owner 自己）', async () => {
    const owner = await makeUser('owner');
    const admin = await makeUser('admin');
    const member = await makeUser();

    // 1. 把别人升成 owner —— 不行
    const promoteToOwner = await call(
      'PATCH',
      `/api/admin/users/${await idOf(member.email)}/role`,
      {
        json: { role: 'owner', reason: '再加一个所有者' },
        cookie: owner.cookie,
      },
    );
    assert.equal(promoteToOwner.status, 403);
    assert.equal(promoteToOwner.body.error, 'owner_immutable');

    // 2. 降级 owner —— 不行（连 owner 自己也不行）
    const demoteOwner = await call('PATCH', `/api/admin/users/${await idOf(owner.email)}/role`, {
      json: { role: 'admin', reason: '我自己降一级' },
      cookie: owner.cookie,
    });
    assert.equal(demoteOwner.status, 403);
    assert.equal(demoteOwner.body.error, 'owner_immutable');

    // 3. 管理员连碰都碰不到 owner
    const adminTouchesOwner = await call(
      'PATCH',
      `/api/admin/users/${await idOf(owner.email)}/role`,
      {
        json: { role: 'user', reason: '试试' },
        cookie: admin.cookie,
      },
    );
    assert.equal(adminTouchesOwner.status, 403);
    assert.equal(adminTouchesOwner.body.error, 'owner_immutable');

    assert.equal(await roleOf(owner.email), 'owner');
    assert.equal(await roleOf(member.email), 'user');
  });

  it('owner 拥有管理员的全部能力（能力上不比管理员少）', async () => {
    const grouped = capabilitiesByType('owner');
    const adminGrouped = capabilitiesByType('admin');
    for (const [type, caps] of Object.entries(adminGrouped)) {
      for (const cap of caps) {
        assert.ok(
          grouped[type]?.includes(cap),
          `owner 缺了 admin 拥有的能力 ${cap}（owner 是最高一级，不该更少）`,
        );
      }
    }
  });

  it('角色下拉框里没有 owner（只有服务器能设置它）', () => {
    assert.ok(assignableRoles().includes('admin'));
    assert.ok(
      !assignableRoles().includes('owner'),
      'owner 不该出现在可分配角色里 —— 它只能在服务器上用 admin.js 设置',
    );
    // 但它是合法的角色值
    assert.ok(USER_ROLES.includes('owner'));
  });

  it('★ 不能改**其他管理员**的角色（管理员之间平级）', async () => {
    /*
     * 允许 A 把 B 降级，就意味着任何一个管理员账号被拿到之后都能把
     * 其他人踢出管理层。这条规则把"管理员的增减"限制成两件安全的事：
     * 提升非管理员、降级自己 —— 唯独"动别人"不行（那要上服务器跑 admin.js）。
     */
    const adminA = await makeUser('admin');
    const adminB = await makeUser('admin');

    const res = await call('PATCH', `/api/admin/users/${await idOf(adminB.email)}/role`, {
      json: { role: 'user', reason: '试试能不能把另一个管理员降级' },
      cookie: adminA.cookie,
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'admin_peer');
    assert.equal(await roleOf(adminB.email), 'admin', '被拒绝的操作不能改到任何东西');
  });

  it('管理员也不能降级自己（要交出权限只能找 owner 或上服务器）', async () => {
    /*
     * ⚠️ 这条断言在 2026-09-12 变过一次，值得记下来：
     *    原本允许管理员自己降级（"主动交出权限不是权力扩张"），
     *    由"最后一个管理员"的保护兜底。
     *    用户要求改成**一律不允许** —— 理由是"自己降自己"在界面上
     *    是一次不可逆的操作，而管理员本来就该由更高一级的人来调整。
     *    于是现在管理员的角色在网页上**完全动不了**。
     */
    const adminA = await makeUser('admin');
    await makeUser('admin');

    const res = await call('PATCH', `/api/admin/users/${await idOf(adminA.email)}/role`, {
      json: { role: 'editor', reason: '我自己降成内容编辑' },
      cookie: adminA.cookie,
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'admin_self');
    assert.equal(await roleOf(adminA.email), 'admin', '被拒绝的请求不能改到任何东西');
  });

  it('admin 能把普通用户提升为 editor / reviewer', async () => {
    const admin = await makeUser('admin');
    const target = await makeUser();

    for (const role of ['reviewer', 'editor'] as const) {
      const res = await call('PATCH', `/api/admin/users/${await idOf(target.email)}/role`, {
        json: { role, reason: `提升为 ${role}` },
        cookie: admin.cookie,
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.role, role);
      // 顺便确认返回里带了新角色的能力清单（界面靠它显示"现在能做什么"）
      assert.ok(res.body.capabilities, '应当返回新角色的能力');
    }
  });

  it('editor 和 reviewer 都进不了账号管理', async () => {
    for (const role of ['reviewer', 'editor'] as const) {
      const user = await makeUser(role);
      assert.equal((await call('GET', '/api/admin/users', { cookie: user.cookie })).status, 403);
      assert.equal(
        (
          await call('PATCH', '/api/admin/users/whoever/role', {
            json: { role: 'admin', reason: '提权自己' },
            cookie: user.cookie,
          })
        ).status,
        403,
      );
    }
  });

  it('改角色必须给理由', async () => {
    const admin = await makeUser('admin');
    const target = await makeUser();
    const res = await call('PATCH', `/api/admin/users/${await idOf(target.email)}/role`, {
      json: { role: 'reviewer', reason: '' },
      cookie: admin.cookie,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.reason_required, true);
  });

  it('admin 能看到用户列表', async () => {
    const admin = await makeUser('admin');
    const res = await call('GET', '/api/admin/users', { cookie: admin.cookie });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.items));
    assert.deepEqual(res.body.roles, ['user', 'reviewer', 'editor', 'admin']);
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

  it('★ last_admin 这条保护现在够不到了 —— 有 owner 在，系统不会失去管理能力', async () => {
    /*
     * 这是权限系统里最经典的一类事故：管理员把自己降级，
     * 然后整个系统再没有任何人能授权。防住它只需要一个 COUNT。
     *
     * ⚠️ 但加进 owner 之后这条保护变成了**够不到的代码**，值得记下来：
     *    · 现在只有 owner 能降级管理员（admin 不能动 admin，也不能降自己）；
     *    · 所以降级发生时，系统里必定至少有一个 owner；
     *    · 而 owner 自己就有 user.moderate，能改角色。
     *    于是"降完之后一个能管账号的人都不剩"这个条件**永远不成立**。
     *
     *    这条断言记录的就是现实：owner 可以降掉最后一个管理员，而且降完之后
     *    系统**依然有人能管账号**。保护本身留在代码里当保险 ——
     *    万一以后 checkRoleChange 放宽了"谁能降管理员"，它会重新变成必要的。
     */
    // ⚠️ 这几条测试需要一个"全世界只有一个管理员"的状态，
    //    而同一个文件里的测试**共用同一个内存库** —— 前面几条已经造了几个管理员。
    //    不先清场的话 countAdmins() 会大于 1，保护不触发，测试就会失败，
    //    而失败的原因和被测行为毫无关系（我第一版就是这样，报的是
    //    "actual: 200, expected: 409"，看起来像保护没写）。
    // ⚠️ 顺序要紧：**先清场，再建 owner**。
    //    反过来写的话，那句 UPDATE 会把刚建出来的 owner 也降成普通用户，
    //    于是后面的调用根本没有 user.moderate，得到的是 403 forbidden ——
    //    而那个失败看起来像"保护没生效"。（我自己就踩了一次。）
    getDb().prepare("UPDATE users SET role = 'user' WHERE role IN ('admin','owner')").run();

    const owner = await makeUser('owner');
    const admin = await makeUser('admin');
    const adminId = await idOf(admin.email);

    const res = await call('PATCH', `/api/admin/users/${adminId}/role`, {
      json: { role: 'user', reason: '降掉唯一的管理员' },
      cookie: owner.cookie,
    });
    assert.equal(res.status, 200, 'owner 在场时，降掉最后一个管理员是安全的');

    // ★ 关键：降完之后系统**仍然**有人能管账号（就是那个 owner）
    const managers = getDb()
      .prepare("SELECT COUNT(*) AS n FROM users WHERE role IN ('admin','owner')")
      .get() as { n: number };
    assert.ok(managers.n >= 1, '任何时刻都必须至少有一个能改角色的人');
  });

  it('有两个管理员时，owner 降级其中一个就允许了', async () => {
    // 同样先清场，让"管理员人数"从已知状态开始（顺序同上面：先清场再建 owner）
    getDb().prepare("UPDATE users SET role = 'user' WHERE role IN ('admin','owner')").run();
    const owner = await makeUser('owner');
    const a = await makeUser('admin');
    await makeUser('admin');
    const aId = await idOf(a.email);

    const res = await call('PATCH', `/api/admin/users/${aId}/role`, {
      json: { role: 'reviewer', reason: '交接完毕' },
      cookie: owner.cookie,
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

async function roleOf(email: string): Promise<string> {
  const row = getDb().prepare('SELECT role FROM users WHERE email = ?').get(email) as {
    role: string;
  };
  return row.role;
}

async function idOf(email: string): Promise<string> {
  const row = getDb().prepare('SELECT id FROM users WHERE email = ?').get(email) as
    | { id: string }
    | undefined;
  assert.ok(row, `找不到用户 ${email}`);
  return row.id;
}
