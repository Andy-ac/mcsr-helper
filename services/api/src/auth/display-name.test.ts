/**
 * 「改自己的昵称」端点的测试（`PATCH /api/auth/me`）。
 *
 * 走**完整的 HTTP 路径**（`app.request`），与 `auth.test.ts` 同一套理由：
 * 这条路由上容易错的不是 UPDATE 语句，而是**谁能改、错误里点了哪个字段、
 * 审计里有没有旧值**——那些只有真的把请求发进去才看得见。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 这里有一条**看起来多余**的断言：改成别人已经在用的昵称**必须成功**
 * ---------------------------------------------------------------------------
 * 它守的不是"代码今天没写唯一性检查"，而是**那条产品裁决本身**：
 * `users.display_name` 上只有 `NOT NULL`、没有 UNIQUE，注册**本来就不要求昵称唯一**
 * （`db/migrations/004_auth.ts`）。所以改名这条路上出现"重名就不行"= 凭空多出一条
 * 注册没有的规则，而那种错法**不会让别的测试变红**：它看起来像一次严谨的防护。
 * ⇒ 这条断言存在的意义就是让"顺手加个唯一性"当场红。
 *
 * ⚠️ 同理，「连续改 12 次全部 200」守的是用户当场裁决的**不限次数**：
 * 以后谁顺手挂一条"每人每天 3 次"的冷却，它会红。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

// ---- 必须在导入任何业务模块**之前**设置（db 与邮件驱动都是首次使用时定下来的）----
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.MCSR_MAIL_DRIVER = 'file';
process.env.MCSR_SCRYPT_TEST_PARAMS = 'N=1024,r=8,p=1';

const MAIL_DIR = mkdtempSync(join(tmpdir(), 'mcsr-mail-rename-'));
process.env.MCSR_MAIL_DIR = MAIL_DIR;

const { app } = await import('../index');
const { closeDb, getDb } = await import('../db');
const { resetAll } = await import('./ratelimit');
const { findUserByEmail, findUserById } = await import('../users');

// ---------------------------------------------------------------------------
// 工具（与 auth.test.ts 同形，那份的说明仍然适用）
// ---------------------------------------------------------------------------

interface FieldIssue {
  field: string;
  message: string;
}

interface ResBody {
  ok?: boolean;
  error?: string;
  retryAfterSec?: number;
  issues?: FieldIssue[];
  user?: {
    id?: string;
    displayName?: string;
    email?: string;
  } | null;
}

interface Res {
  status: number;
  body: ResBody;
  setCookie: string | null;
}

async function call(
  method: string,
  path: string,
  options: { json?: unknown; cookie?: string } = {},
): Promise<Res> {
  const headers: Record<string, string> = {};
  if (options.json !== undefined) headers['content-type'] = 'application/json';
  if (options.cookie) headers.cookie = options.cookie;

  const response = await app.request(path, {
    method,
    headers,
    ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : {}),
  });

  const parsed = (await response.json().catch(() => null)) as ResBody | null;
  assert.ok(parsed !== null, `${method} ${path} 没有返回 JSON 体`);

  return {
    status: response.status,
    body: parsed,
    setCookie: response.headers.getSetCookie?.()[0] ?? null,
  };
}

function cookiePair(setCookie: string | null): string {
  assert.ok(setCookie, '期望有 Set-Cookie（登录应当下发会话）');
  return setCookie.split(';')[0]!;
}

let seq = 0;
function uniqueEmail(): string {
  seq += 1;
  return `rename${seq}.${Date.now()}@example.com`;
}

const GOOD_PASSWORD = 'correct horse battery staple';

/**
 * 建一个**可登录**的账号（注册 + 直接把验证位置上）。
 *
 * ⚠️ 这里直接改库而不是走一遍验证邮件：本文件测的是改名，不测验证流程
 * （那条由 `verify-required.test.ts` 覆盖），而"未验证就登不进来"决定了
 * 没有这一步就一条用例都跑不到路由里。
 */
function markVerified(email: string): void {
  getDb()
    .prepare('UPDATE users SET email_verified_at = ? WHERE email = lower(?)')
    .run(Date.now(), email);
}

async function newUser(
  displayName: string,
): Promise<{ id: string; email: string; cookie: string }> {
  const email = uniqueEmail();
  const res = await call('POST', '/api/auth/register', {
    json: { email, password: GOOD_PASSWORD, displayName, locale: 'zh-CN' },
  });
  assert.equal(res.status, 200, `注册失败：${JSON.stringify(res.body)}`);
  markVerified(email);

  const login = await call('POST', '/api/auth/login', {
    json: { email, password: GOOD_PASSWORD },
  });
  assert.equal(login.status, 200, `登录失败：${JSON.stringify(login.body)}`);

  const row = findUserByEmail(email);
  assert.ok(row, '注册后应当能查到这一行');
  return { id: row.id, email, cookie: cookiePair(login.setCookie) };
}

/** 库里那一行现在的昵称 —— 断言"真的变了"要读这里，不读响应。 */
function storedName(id: string): string {
  const row = findUserById(id);
  assert.ok(row, `应当能按 id 查到用户 ${id}`);
  return row.display_name;
}

function renameRequests(id: string): { reason: string; actor_id: string | null }[] {
  return getDb()
    .prepare(
      `SELECT reason, actor_id FROM audit_log
       WHERE action = 'user.rename' AND entity_id = ? ORDER BY rowid`,
    )
    .all(id) as unknown as { reason: string; actor_id: string | null }[];
}

// ---------------------------------------------------------------------------

before(() => {
  getDb();
});

after(() => {
  closeDb();
  rmSync(MAIL_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  // 限流是内存态：不清掉的话，前一个用例的请求次数会算到后一个头上
  resetAll();
});

// ---------------------------------------------------------------------------

describe('改昵称：成功这条路', () => {
  it('改成新昵称 ⇒ 200 + 响应里是新昵称 + 库里真的变了', async () => {
    const me = await newUser('原来的名字');
    assert.equal(storedName(me.id), '原来的名字');

    const res = await call('PATCH', '/api/auth/me', {
      json: { displayName: '新的名字' },
      cookie: me.cookie,
    });

    assert.equal(
      res.status,
      200,
      `期望 200，实际 ${String(res.status)}：${JSON.stringify(res.body)}`,
    );
    assert.equal(res.body.user?.displayName, '新的名字', '响应里必须是新昵称');
    assert.equal(storedName(me.id), '新的名字', '★ 库里那一行也必须真的变了');
  });

  it('响应里的用户是**从库里重读**的，不是把入参原样回显', async () => {
    /*
     * 判据：首尾带空白的入参 → 库里存的是 trim 过的形态。
     * 直接把入参回显的实现在这里会给出 `'  张三  '`，而库里是 `'张三'` ——
     * 于是前端缓存的用户对象与库里**从第一步起就不一致**，而且没有任何东西会报错。
     */
    const me = await newUser('张三');
    const res = await call('PATCH', '/api/auth/me', {
      json: { displayName: '  李四  ' },
      cookie: me.cookie,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.user?.displayName, '李四', '首尾空白应当被 trim（DisplayNameSchema）');
    assert.equal(storedName(me.id), '李四');
  });
});

describe('改昵称：谁能改', () => {
  it('未登录 ⇒ 401，且库里一行都没动', async () => {
    const res = await call('PATCH', '/api/auth/me', { json: { displayName: '别人改的' } });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'unauthorized');
  });

  it('★ body 里塞别人的 userId ⇒ 400，而且那个人的昵称没变', async () => {
    /*
     * 「只改自己那一行」这条要求有两个方向，缺一条就不算验证过：
     *   ① 带自己 cookie 的请求改的是自己（上面那条）；
     *   ② **不能**通过 body 指定别人。
     * ② 的判据不是"接口文档说没有这个参数"，而是"塞进去之后那个人的行没变"。
     * ⚠️ schema 是 `.strict()`：多一个键当场 400（不是被静默丢掉）——
     *    静默丢掉的版本里，客户端会以为自己成功改了一个人的昵称。
     */
    const victim = await newUser('受害者');
    const attacker = await newUser('攻击者');

    const res = await call('PATCH', '/api/auth/me', {
      json: { displayName: '被顶掉的名字', userId: victim.id },
      cookie: attacker.cookie,
    });

    assert.equal(res.status, 400, '多一个 userId 键必须 400（.strict()）');
    assert.equal(res.body.error, 'invalid_input');
    assert.equal(storedName(victim.id), '受害者', '★ 别人那一行必须一个字都没变');
    assert.equal(storedName(attacker.id), '攻击者', '400 的请求连自己那一行也不该改');
  });
});

describe('改昵称：400 要点名字段', () => {
  /*
   * ★★ `issues[]` 的**键集**必须恰好是 `{ field, message }` —— 这条钉的是**契约的形状**，
   *    不是某个字段的值。
   *
   * 为什么要单独钉它：`apps/web/src/lib/auth.tsx` 的 `fieldIssueText` 是**按 Zod 的 `code`
   * 分支**的（`case 'too_small'` …），而 `formatIssues` 今天**不发 `code`** ⇒ 服务端那句
   * 在界面上落到兜底文案（`auth.err.invalid`，见 `displayNameError` 那一带的说明）。
   * 哪天有人给 `formatIssues` 加上 `code`，**界面上的句子会变**（变成"昵称至少 2 个字符"），
   * 而 `apps/web/scripts/accountrender.tsx` ⑤ 那条断言**不会红** —— 它读的是脚本自己
   * 手工构造的夹具（没有 code），看不见服务端的真形状。
   * ⇒ 所以"服务端开始发 code"这件事**只有这一条能拦住**：
   *    `Object.keys(issue).sort()` 一旦变成 `['code','field','message']`，它当场红。
   *    它红了要做的两件事，写在下面那条断言的失败信息里。
   */
  it('★ `issues[]` 的键集恰好是 { field, message }（服务端哪天开始发 code ⇒ 红的是这一条）', async () => {
    const me = await newUser('键集测试');

    const res = await call('PATCH', '/api/auth/me', {
      json: { displayName: '甲' },
      cookie: me.cookie,
    });

    assert.equal(res.status, 400, `期望 400，实际 ${String(res.status)}`);
    const issue = res.body.issues?.[0];
    assert.ok(issue, `400 必须带 issues[0]，实际：${JSON.stringify(res.body.issues)}`);

    assert.deepEqual(
      Object.keys(issue).sort(),
      ['field', 'message'],
      '★ `issues[]` 的键集变了。今天 `formatIssues`（routes/auth.ts）只发 `field` + `message`，' +
        '而 web 层按 `code` 分支选文案（apps/web/src/lib/auth.tsx 的 `fieldIssueText`）—— ' +
        '键集一变，界面上那句话也就跟着变了。改这一条的同时要回去改：' +
        '(1) apps/web/scripts/accountrender.tsx ⑤ 那条映射断言与它的说明，' +
        '(2) apps/web/src/components/DisplayNameField.tsx 里同一件事的说明。',
    );
  });

  /*
   * 三条一起看：太短 / 太长 / 只有空白。判据是**同一个形状** ——
   * `issues[].field === 'displayName'`（`formatIssues` 产出的那个形状），
   * 因为前端 `lib/auth.tsx` 的 `fieldIssueText` 就是按 `field` + Zod 的 code
   * 选文案的：字段名丢了，界面上只会显示一句兜底的「出错了」。
   */
  for (const [label, bad] of [
    ['太短（1 个字符）', '甲'],
    ['太长（33 个字符）', 'x'.repeat(33)],
    ['只有空白', '     '],
  ] as const) {
    it(`${label} ⇒ 400 且错误里点名字段`, async () => {
      const me = await newUser('待改的名字');

      const res = await call('PATCH', '/api/auth/me', {
        json: { displayName: bad },
        cookie: me.cookie,
      });

      assert.equal(res.status, 400, `期望 400，实际 ${String(res.status)}`);
      assert.equal(res.body.error, 'invalid_input');
      assert.ok(
        res.body.issues?.some((i) => i.field === 'displayName'),
        `错误里必须点名 displayName 字段，实际：${JSON.stringify(res.body.issues)}`,
      );
      assert.equal(storedName(me.id), '待改的名字', '被拒的请求不许留下任何痕迹');
      assert.deepEqual(renameRequests(me.id), [], '被拒的请求不该写审计');
    });
  }
});

describe('改昵称：不设唯一性（与注册一致）', () => {
  it('★ 改成别人已经在用的昵称 ⇒ 成功', async () => {
    /*
     * 见文件头：这条断言守的是**裁决**，不是实现细节。
     * 判据里"两个人现在同名"那一条不能省 —— 只看 200 的话，
     * 一个"改了但没存进去"的实现也能过。
     */
    const other = await newUser('大家都叫这个名字');
    const me = await newUser('我先用的名字');

    const res = await call('PATCH', '/api/auth/me', {
      json: { displayName: '大家都叫这个名字' },
      cookie: me.cookie,
    });

    assert.equal(res.status, 200, '重名必须成功 —— 注册本来就不要求昵称唯一');
    assert.equal(res.body.user?.displayName, '大家都叫这个名字');
    assert.equal(storedName(me.id), '大家都叫这个名字');
    assert.equal(storedName(other.id), '大家都叫这个名字', '先用的那个人不该被顶掉');

    const sameName = getDb()
      .prepare('SELECT COUNT(*) AS n FROM users WHERE display_name = ?')
      .get('大家都叫这个名字') as { n: number };
    assert.equal(Number(sameName.n), 2, '★ 库里现在应当**有两个**同名的人（这就是那个代价）');
  });

  it('★ 不限次数：连续改 12 次全部成功（用户裁决，防以后有人顺手加冷却）', async () => {
    /*
     * 用户当场裁决「不限次数」。这条断言是那条裁决**唯一的**守卫：
     * 以后谁挂一条"每人每天 3 次"，它会红。
     * ⚠️ 12 这个数字比任何冷却都小（3/天、10/分钟都会红），而全站 per-IP 限流
     *    是 240 次/分钟 —— 所以它不会因为"限流本身该在"而误红。
     */
    const me = await newUser('连改测试');
    for (let i = 1; i <= 12; i++) {
      const res = await call('PATCH', '/api/auth/me', {
        json: { displayName: `第 ${String(i)} 次` },
        cookie: me.cookie,
      });
      assert.equal(
        res.status,
        200,
        `第 ${String(i)} 次改名被拒了（${String(res.status)}）—— 那是加了一条冷却`,
      );
    }
    assert.equal(storedName(me.id), '第 12 次');
  });
});

describe('改昵称：审计', () => {
  it('★ 审计里多了一条，且同时带着旧值与新值', async () => {
    const me = await newUser('改名前');
    assert.deepEqual(renameRequests(me.id), [], '改之前不该有任何改名审计');

    const res = await call('PATCH', '/api/auth/me', {
      json: { displayName: '改名后' },
      cookie: me.cookie,
    });
    assert.equal(res.status, 200);

    const rows = renameRequests(me.id);
    assert.equal(rows.length, 1, '应当**恰好**多一条 user.rename');
    assert.equal(rows[0]?.actor_id, me.id, '审计要记下是谁改的');

    /*
     * 旧值与新值都必须出现 —— 只记新的那个等于没记：
     * 改名之前的名字仍然印在贡献者面板与审核记录上，排查时缺了旧值就断了线索。
     */
    const reason = rows[0]?.reason ?? '';
    assert.ok(reason.includes('改名前'), `审计里必须有**旧值**，实际：${reason}`);
    assert.ok(reason.includes('改名后'), `审计里必须有**新值**，实际：${reason}`);

    /*
     * ⚠️ 反面：**不许**把邮箱拼进去。昵称是公开信息，邮箱不是 ——
     *    审计表在管理界面上是列出来给人看的，多拼一个邮箱等于顺手泄露会员邮箱。
     */
    assert.equal(reason.includes(me.email), false, `审计里不该出现邮箱：${reason}`);
  });
});
