/**
 * ★ B1：人工标签层的**数据层**（两张表的读写）。
 *
 * ⚠️ 环境变量必须在任何 import 之前设好（照 `moderation.test.ts` 的样板）。
 */
/*
 * ⚠️ 本文件有期望值**硬钉在 `content/mod-catalog.json` 的当前内容**上：
 *    `mcsrranked` 的生效标签 `['extra','ranked']`（`ranked` 来自文件的 `manualTags`、
 *    `extra` 来自文件的自动标签），以及"清空 DB 之后 `ranked` 消失、`extra` 还在"那一条。
 *    这是 spec §5 断言 4/4b 故意要的耦合（"文件那份手写输入仍是出厂值"必须有判据）。
 * ⚠️ 另一条**不**属于这个耦合：`★ DB 的显示名覆盖文件里的同名键` 的期望值来自它自己
 *    写进 DB 的值，不读文件那个键（少并/多并文件的 `tagLabels.ranked` 都不改它的真假）。
 *    ⚠️ 但文件里的 `tagLabels.ranked` 仍然承重：合并**之前**跑的那道严格校验要求
 *    "每个用到的标签都有显示名" ⇒ 真把它从文件里删掉，本文件多数断言会因为 500 而红。
 *    ⇒ 红的时候先现读那两份东西，再判断是**数据变了**还是**代码坏了**：
 *      node -e "const c=require('./content/mod-catalog.json');console.log(c.manualTags, c.mods.find(m=>m.modid==='mcsrranked').tags, c.tagLabels.ranked)"
 *      node -e "const o=require('./content/mod-overrides.json');console.log(o.tags)"
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, beforeEach, describe, it } from 'node:test';
import { resetAll } from './auth/ratelimit';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.MCSR_MAIL_DRIVER = 'console';
process.env.MCSR_SCRYPT_TEST_PARAMS = 'N=1024,r=8,p=1';

const { closeDb, getDb } = await import('./db');
const { readTagLayer, setModTags, setTagLabel, deleteTagLabel } = await import('./mod-tags');

after(() => closeDb());
beforeEach(() => {
  getDb().exec('DELETE FROM mod_tag_assignments; DELETE FROM mod_tag_labels;');
  /*
   * ⚠️★ 限流也要重置，否则下面写端那几条**红的原因不是被测代码**：
   *   `POST /api/auth/register` 有"每 IP 每小时 5 次"的限流
   *   （现读 `auth/ratelimit.ts` 的 `LIMITS.registerPerIp: { limit: 5, windowMs: HOUR }`，
   *   由 `routes/auth.ts` 的 `hit('register|' + ip, …)` 施加）。
   *   这个文件一共要造 **14 个用户**（`★ B1 写端：权限` 那条一次循环 4 个角色）
   *   ⇒ 第 6 次起 register 返回 429、**用户根本没被建出来**，于是 `makeUser` 里的
   *   `login` 拿到 401 `invalid_credentials` —— 症状长成"权限/密码不对"，
   *   与真实原因（限流）在输出里分不开。样板与理由见 `moderation.test.ts` 的同一个 hook。
   */
  resetAll();
});

/*
 * ⚠️★ 数据层把 `actorId` 原样写进 `updated_by`，而那一列是**外键**指向 `users`
 *    （且本仓的连接开着 `PRAGMA foreign_keys = ON`）⇒ 这里传 `null`（列可空，
 *    语义是"这一格没有认领的人"），**不要**传一个不存在的 id：那会当场
 *    `FOREIGN KEY constraint failed`，而症状看起来像"表建错了"。
 */
/*
 * ⚠️ 外键的判据**已提交**（见本文件末尾那条"传一个不存在的 actor id ⇒ 被外键拒"）。
 *    本机的一次性探针 `.cache/probe-mod-tags-fk.mjs` 只是当初的现场，
 *    **不可复跑**（`.cache/` 是 gitignore 的）。
 */
const ACTOR: string | null = null;
const NOW = 1_700_000_000_000;

describe('★ B1 数据层：人工标签', () => {
  it('没写过时是空的（不是抛、不是 undefined）', () => {
    const layer = readTagLayer();
    assert.equal(layer.assignments.size, 0);
    assert.equal(layer.labels.size, 0);
  });

  it('写入后读得出来，且**整行替换**（第二次写覆盖第一次）', () => {
    setModTags({ modid: 'sodium', tags: ['ranked', 'rsg-only'], actorId: ACTOR, now: NOW });
    assert.deepEqual(readTagLayer().assignments.get('sodium'), ['ranked', 'rsg-only']);
    setModTags({ modid: 'sodium', tags: [], actorId: ACTOR, now: NOW + 1 });
    assert.deepEqual(readTagLayer().assignments.get('sodium'), []);
  });

  it('★ 空数组会留下**一行**（"管理员清空了它"与"从没设过"必须分得开）', () => {
    setModTags({ modid: 'sodium', tags: [], actorId: ACTOR, now: NOW });
    assert.equal(readTagLayer().assignments.has('sodium'), true);
  });

  it('显示名写入后读得出来，再写就是改名（同一行）', () => {
    setTagLabel({ tag: 'ranked', zh: '排位', en: 'Ranked', actorId: ACTOR, now: NOW });
    assert.deepEqual(readTagLayer().labels.get('ranked'), { zh: '排位', en: 'Ranked' });
    setTagLabel({ tag: 'ranked', zh: '排位赛', en: 'Ranked play', actorId: ACTOR, now: NOW + 1 });
    assert.deepEqual(readTagLayer().labels.get('ranked'), { zh: '排位赛', en: 'Ranked play' });
    assert.equal(readTagLayer().labels.size, 1);
  });

  it('删一个不存在的显示名 ⇒ false（不是抛）', () => {
    assert.equal(deleteTagLabel({ tag: 'nope' }), false);
  });

  it('删掉存在的 ⇒ true，且真的没了', () => {
    setTagLabel({ tag: 'ranked', zh: '排位', en: 'Ranked', actorId: ACTOR, now: NOW });
    assert.equal(deleteTagLabel({ tag: 'ranked' }), true);
    assert.equal(readTagLayer().labels.has('ranked'), false);
  });

  it('★ 坏掉的 JSON 当作没有（防御性解析，不抛）—— 一个坏格子不该让整条目录 500', () => {
    const insert = getDb().prepare(
      'INSERT INTO mod_tag_assignments (modid, tags, updated_by, updated_at) VALUES (?, ?, ?, ?)',
    );
    insert.run('broken', '{not json', ACTOR, NOW);
    insert.run('not-array', '{"a":1}', ACTOR, NOW); // 合法 JSON 但不是数组 ⇒ 走 `!Array.isArray`
    insert.run('null-json', 'null', ACTOR, NOW); // JSON null ⇒ 同一支
    const layer = readTagLayer();
    assert.equal(layer.assignments.has('broken'), false);
    assert.equal(layer.assignments.has('not-array'), false);
    assert.equal(layer.assignments.has('null-json'), false);
    assert.equal(layer.assignments.size, 0);
    insert.run('partly-bad', '["ok",1,null,""]', ACTOR, NOW);
    assert.deepEqual(readTagLayer().assignments.get('partly-bad'), ['ok']);
  });
});

/* -------------------------------------------------------------------------
 * 端点那几条：真 app + 仓库里那份真目录（只读它，不写）
 * ---------------------------------------------------------------------- */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
process.env.MCSR_CONTENT_DIR = join(ROOT, 'content');

const { app } = await import('./index');
const { SITE } = await import('@mcsr/shared');

async function call(
  method: string,
  path: string,
  options: { json?: unknown; cookie?: string } = {},
): Promise<{ status: number; body: Record<string, unknown>; setCookie: string | null }> {
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

/** 造一个指定角色的登录用户（照 `moderation.test.ts` 的样板）。 */
let seq = 0;
async function makeUser(role: 'user' | 'reviewer' | 'editor' | 'admin' = 'user') {
  seq += 1;
  const email = `modtag${String(seq)}.${String(Date.now())}@example.com`;
  const password = 'a good long passphrase';
  await call('POST', '/api/auth/register', {
    json: { email, password, displayName: `用户${String(seq)}`, locale: 'zh-CN' },
  });
  getDb()
    .prepare('UPDATE users SET email_verified_at = ?, role = ? WHERE email = ?')
    .run(Date.now(), role, email);
  const login = await call('POST', '/api/auth/login', { json: { email, password } });
  assert.equal(login.status, 200);
  return (login.setCookie ?? '').split(';')[0] as string;
}

/** 从合并后的目录里取一条 mod 的 tags（`/api/mod-catalog` 是公开读）。 */
async function tagsOf(modid: string): Promise<string[]> {
  const res = await call('GET', '/api/mod-catalog');
  assert.equal(res.status, 200);
  const mods = (res.body as { mods?: { modid: string; tags: string[] }[] }).mods ?? [];
  return mods.find((mod) => mod.modid === modid)?.tags ?? [];
}

async function labelOf(tag: string): Promise<{ zh: string; en: string } | null> {
  const res = await call('GET', '/api/mod-catalog');
  const labels = (res.body as { tagLabels?: Record<string, { zh: string; en: string }> }).tagLabels;
  return labels?.[tag] ?? null;
}

describe('★ B1 读端：GET /api/mod-tags 只有 DB 那一层', () => {
  it('什么都没设时是空的（**不含**目录里那份出厂值）', async () => {
    const res = await call('GET', '/api/mod-tags');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.assignments, {});
    assert.deepEqual(res.body.labels, []);
  });

  it('★ 出厂值不在这一层：DB 里有别的行时，键集合**恰好**是那一行', async () => {
    setModTags({ modid: 'sodium', tags: ['rsg-only'], actorId: null, now: Date.now() });
    const res = await call('GET', '/api/mod-tags');
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body.assignments as Record<string, string[]>), ['sodium']);
    // ⚠️ 这一条**不能**靠前一条的 `deepEqual(assignments, {})` 兜着：那是"空"，
    //    而这条问的是"有别的行时，出厂值有没有混进来"。
    assert.deepEqual((await tagsOf('mcsrranked')).includes('ranked'), true);
  });

  it('设过之后读得出来', async () => {
    setModTags({ modid: 'sodium', tags: ['rsg-only'], actorId: null, now: Date.now() });
    const res = await call('GET', '/api/mod-tags');
    assert.deepEqual((res.body.assignments as Record<string, string[]>).sodium, ['rsg-only']);
  });
});

describe('★ B1 合并：下发时把人工层并进目录', () => {
  it('没有 DB 行 ⇒ 目录里那一条与文件产物逐字相同（回落）', async () => {
    assert.deepEqual(await tagsOf('mcsrranked'), ['extra', 'ranked']);
  });

  it('★ DB 存空数组 ⇒ `ranked` 真的消失，而 `extra` 还在（整行替换的刀）', async () => {
    setModTags({ modid: 'mcsrranked', tags: [], actorId: null, now: Date.now() });
    const tags = await tagsOf('mcsrranked');
    assert.equal(tags.includes('ranked'), false, 'ranked 来自手工那一层 ⇒ 清空之后必须消失');
    assert.equal(tags.includes('extra'), true, 'extra 是自动标签 ⇒ 不能被误删');
  });

  it('★ DB 加一个新标签 + 它的显示名 ⇒ tags 与 tagLabels **两样**都变', async () => {
    setTagLabel({ tag: 'b1-probe', zh: '探针', en: 'Probe', actorId: null, now: Date.now() });
    setModTags({ modid: 'sodium', tags: ['b1-probe'], actorId: null, now: Date.now() });
    assert.equal((await tagsOf('sodium')).includes('b1-probe'), true);
    assert.deepEqual(await labelOf('b1-probe'), { zh: '探针', en: 'Probe' });
  });

  it('★ DB 的显示名覆盖文件里的同名键', async () => {
    setTagLabel({ tag: 'ranked', zh: '排位赛', en: 'Ranked play', actorId: null, now: Date.now() });
    assert.deepEqual(await labelOf('ranked'), { zh: '排位赛', en: 'Ranked play' });
  });

  it('合并后的正文仍然是 schema 2（注意：严格校验判的是**文件**，不是这份合并结果）', async () => {
    const res = await call('GET', '/api/mod-catalog');
    assert.equal(res.status, 200);
    assert.equal(typeof (res.body as { schema?: number }).schema, 'number');
  });

  it('`/api/mod-tags` 带 no-store（管理数据不许被缓存住）', async () => {
    const response = await app.request('/api/mod-tags', {
      headers: { origin: SITE.productionOrigin },
    });
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
});

/* -------------------------------------------------------------------------
 * ★ 写端：三条写端点（`PUT /:modid` / `PUT /labels/:tag` / `DELETE /labels/:tag`）
 * ---------------------------------------------------------------------- */

describe('★ B1 写端：权限', () => {
  it('user 三条都是 403；reviewer / editor / admin 都能改', async () => {
    for (const [role, expected] of [
      ['user', 403],
      ['reviewer', 200],
      ['editor', 200],
      ['admin', 200],
    ] as const) {
      const cookie = await makeUser(role);
      const res = await call('PUT', '/api/mod-tags/sodium', {
        json: { tags: ['rsg-only'] },
        cookie,
      });
      assert.equal(res.status, expected, `${role} 改标签应当是 ${String(expected)}`);
    }
  });

  it('未登录 401，且**不带** capability 键（与 requireCapability 今天的形状一致）', async () => {
    const res = await call('PUT', '/api/mod-tags/sodium', { json: { tags: [] } });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'unauthorized');
    assert.equal('capability' in res.body, false);
  });
});

describe('★ B1 写端：校验', () => {
  it('改一个目录里没有的 modid ⇒ 404', async () => {
    const cookie = await makeUser('reviewer');
    const res = await call('PUT', '/api/mod-tags/no-such-mod', { json: { tags: [] }, cookie });
    assert.equal(res.status, 404);
  });

  it('★ 存一个没有显示名的标签 ⇒ 400 且带 reason=unknown_tag（存不进去）', async () => {
    const cookie = await makeUser('reviewer');
    const res = await call('PUT', '/api/mod-tags/sodium', {
      json: { tags: ['nobody-defined-this'] },
      cookie,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.reason, 'unknown_tag');
    assert.deepEqual(res.body.tags, ['nobody-defined-this']);
    assert.equal(readTagLayer().assignments.has('sodium'), false, '被拒的写不能留下痕迹');
  });

  it('33 个标签 ⇒ 400；32 个 ⇒ 200', async () => {
    const cookie = await makeUser('reviewer');
    setTagLabel({ tag: 'bulk', zh: '批量', en: 'Bulk', actorId: null, now: Date.now() });
    const many = Array.from({ length: 32 }, () => 'bulk');
    const ok32 = await call('PUT', '/api/mod-tags/sodium', { json: { tags: many }, cookie });
    assert.equal(ok32.status, 200);
    assert.equal((ok32.body.tags as string[]).length, 1, '重复的标签要去重');
    const many33 = Array.from({ length: 33 }, (_, i) => `bulk-${String(i)}`);
    const bad = await call('PUT', '/api/mod-tags/sodium', { json: { tags: many33 }, cookie });
    assert.equal(bad.status, 400);
  });

  it('标签 key 形状不对 / 显示名为空 ⇒ 400 + issues', async () => {
    const cookie = await makeUser('reviewer');
    const badKey = await call('PUT', '/api/mod-tags/labels/Not_A_Key', {
      json: { zh: '排位', en: 'Ranked' },
      cookie,
    });
    assert.equal(badKey.status, 400);
    const empty = await call('PUT', '/api/mod-tags/labels/ok-key', {
      json: { zh: '', en: 'x' },
      cookie,
    });
    assert.equal(empty.status, 400);
    assert.ok(Array.isArray(empty.body.issues));
  });

  it('去重 + 代码单元序（存进去什么顺序，读出来是排好的）', async () => {
    const cookie = await makeUser('reviewer');
    setTagLabel({ tag: 'bbb', zh: '乙', en: 'B', actorId: null, now: Date.now() });
    setTagLabel({ tag: 'aaa', zh: '甲', en: 'A', actorId: null, now: Date.now() });
    const res = await call('PUT', '/api/mod-tags/sodium', {
      json: { tags: ['bbb', 'aaa', 'bbb'] },
      cookie,
    });
    assert.deepEqual(res.body.tags, ['aaa', 'bbb']);
  });
});

describe('★ B1 写端：删标签那道闸', () => {
  it('删一个没人用的 DB 标签 ⇒ 200，且真的没了', async () => {
    const cookie = await makeUser('reviewer');
    setTagLabel({ tag: 'lonely', zh: '孤立', en: 'Lonely', actorId: null, now: Date.now() });
    const res = await call('DELETE', '/api/mod-tags/labels/lonely', { cookie });
    assert.equal(res.status, 200);
    assert.equal(readTagLayer().labels.has('lonely'), false);
  });

  it('★ 删一个还有人用的 ⇒ 409 tag_in_use，而且它**一个字都没被改**', async () => {
    const cookie = await makeUser('reviewer');
    setTagLabel({ tag: 'inuse', zh: '在用', en: 'In use', actorId: null, now: Date.now() });
    setModTags({ modid: 'sodium', tags: ['inuse'], actorId: null, now: Date.now() });
    const res = await call('DELETE', '/api/mod-tags/labels/inuse', { cookie });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'tag_in_use');
    /*
     * ⚠️ `by` 也要断言：不然那个输出字段就是**没人验的死字段**（写了、界面也没用它 ⇒
     * 它坏了谁都不会知道）。它是"还有谁在用"的前几个 modid，值来自 `tagInUse()`。
     */
    assert.deepEqual(res.body.by, ['sodium']);
    assert.deepEqual(readTagLayer().labels.get('inuse'), { zh: '在用', en: 'In use' });
  });

  it('删一个 DB 里没有的 ⇒ 404（文件里那些标签不归这条路管）', async () => {
    const cookie = await makeUser('reviewer');
    const res = await call('DELETE', '/api/mod-tags/labels/ranked', { cookie });
    assert.equal(res.status, 404);
  });
});

describe('★ B1 写端：审计', () => {
  it('三次写入各留一条，且改名那条记了前后值', async () => {
    const cookie = await makeUser('editor');
    /*
     * ⚠️★ `audit_log` 在这里**不是空的** —— `makeUser()` 自己会写两条
     *    （现读 `routes/auth.ts`：`action: 'register'` 与 `action: 'login'`），
     *    而这个文件的 `beforeEach` 只清那两张 mod_tag 表。
     *    不清的话下面那条 `deepEqual(actions, …)` 必红，而红的原因与"审计写得对不对"
     *    **完全无关**（假失败：人会因此学会无视这份输出）。
     *    这一句是本仓的现成做法（`tracking-routes.test.ts` / `resource-tags.test.ts` /
     *    `calendar-series-color.test.ts` 各一处 `DELETE FROM audit_log`）。
     */
    getDb().exec('DELETE FROM audit_log');
    await call('PUT', '/api/mod-tags/labels/audit-tag', { json: { zh: '甲', en: 'A' }, cookie });
    await call('PUT', '/api/mod-tags/labels/audit-tag', { json: { zh: '乙', en: 'B' }, cookie });
    await call('PUT', '/api/mod-tags/sodium', { json: { tags: ['audit-tag'] }, cookie });
    /*
     * ⚠️★ 这一条**必须**有，否则最后那条 DELETE 是 409 `tag_in_use`（sodium 还在用它，
     *    见上一节那道闸）⇒ `mod_tag_label.delete` 那一条**永远不会被写出来**，
     *    而症状只是"少了一行"（看起来像审计漏写，其实是删除被拒了）。
     *    "先把它从用它的 mod 上摘掉，再删"也正是界面要教用户做的那一步（D5）。
     */
    await call('PUT', '/api/mod-tags/sodium', { json: { tags: [] }, cookie });
    await call('DELETE', '/api/mod-tags/labels/audit-tag', { cookie });

    const rows = getDb()
      /*
       * ⚠️★ 排序要带 **`rowid`**：四条写入可能落在**同一毫秒**（`Date.now()` 相同），
       *    而 SQL 只保证"按 created_at 有序" —— **平局时的先后是未定义的**。
       *    只按 created_at 排的话，这条断言是靠"SQLite 恰好按插入顺序返回"过的
       *    （小表全表扫确实如此，但那是实现细节，不是判据）。
       *    `rowid` 在普通表里单调递增 ⇒ `created_at, rowid` 才是确定的顺序。
       */
      .prepare(
        'SELECT action, entity_type, entity_id, reason FROM audit_log ORDER BY created_at, rowid',
      )
      .all() as unknown as {
      action: string;
      entity_type: string;
      entity_id: string | null;
      reason: string | null;
    }[];
    const actions = rows.map((row) => row.action);
    assert.deepEqual(actions, [
      'mod_tag_label.set',
      'mod_tag_label.set',
      'mod_tag.set',
      // ↑ 挂上，↓ 摘掉 —— 两次都是真实的整行替换（空数组也会留下那一行）
      'mod_tag.set',
      'mod_tag_label.delete',
    ]);
    assert.match(String(rows[1]?.reason), /甲/, '改名那条要记下改之前是什么');
    assert.match(String(rows[1]?.reason), /乙/, '也要记下改成了什么');
    assert.equal(rows[2]?.entity_id, 'sodium');
  });
});

describe('★ B1 写端：`content/**` 一个字节都没动（spec §5 断言 3）', () => {
  /*
   * ★★ 这是"可编辑数据住 DB"那条决策**唯一的硬判据**（B1 spec §2 D1 / §5 断言 3）：
   *    三条写操作跑完之后，仓库里那两份文件必须逐字节相同。
   *    ⚠️ 为什么非断言不可：`deploy/deploy.sh` 每次部署都会同步那几份 `content/*.json`
   *       ⇒ 服务端若写了它们，线上改的东西会被下一次部署**静默抹掉**；
   *       而"没写"这件事在别处**看不见**（没有报错、没有日志、行为也全对）。
   */
  it('三条写操作跑完之后，两份文件的 sha256 与开始时相同', async () => {
    const files = ['content/mod-catalog.json', 'content/mod-overrides.json'].map((rel) =>
      join(ROOT, rel),
    );
    const fingerprint = (): string[] =>
      files.map((file) => createHash('sha256').update(readFileSync(file)).digest('hex'));

    const before = fingerprint();

    const cookie = await makeUser('admin');
    await call('PUT', '/api/mod-tags/labels/probe-tag', {
      json: { zh: '探针', en: 'Probe' },
      cookie,
    });
    await call('PUT', '/api/mod-tags/sodium', { json: { tags: ['probe-tag'] }, cookie });
    // ⚠️ 这一条会因为"还有人用"被 409 拒（见上一节）—— 与本断言无关：它只问文件动没动
    await call('DELETE', '/api/mod-tags/labels/probe-tag', { cookie });

    assert.deepEqual(
      fingerprint(),
      before,
      '写操作不许碰 `content/**` 下的任何文件（那是"住 DB"的硬判据）',
    );
  });
});

describe('★ B1 数据层：外键真的在（T3 评审 M-1）', () => {
  it('★ 传一个不存在的 actor id ⇒ 被外键拒（把 024 里那条 REFERENCES 删掉，这条就红）', () => {
    /*
     * ⚠️★ 为什么非有这一条：那 7 条数据层断言**全程传 `actorId: null`**
     *   ⇒ 把 `024_mod_tags.ts` 里 `REFERENCES users (id) ON DELETE SET NULL` 整行删掉，
     *   它们**照样全绿**。外键是 D1 的要求，而"要求没有刀"等于没有要求。
     * ⚠️ 用**裸 SQL**（不经过数据层那四个函数）—— 量的是 **schema 本身**。
     * ⚠️ 极性：`assert.throws` 在这里是**正向**判据（"必须被拒"），不是"容忍失败"。
     */
    assert.throws(
      () =>
        getDb()
          .prepare(
            'INSERT INTO mod_tag_assignments (modid, tags, updated_by, updated_at) VALUES (?, ?, ?, ?)',
          )
          .run('fk-probe', '[]', 'no-such-user', NOW),
      /FOREIGN KEY constraint failed/,
    );
  });
});
