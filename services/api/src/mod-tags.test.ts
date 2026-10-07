/**
 * ★ B1：人工标签层的**数据层**（两张表的读写）。
 *
 * ⚠️ 环境变量必须在任何 import 之前设好（照 `moderation.test.ts` 的样板）。
 */
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.MCSR_MAIL_DRIVER = 'console';
process.env.MCSR_SCRYPT_TEST_PARAMS = 'N=1024,r=8,p=1';

const { closeDb, getDb } = await import('./db');
const { readTagLayer, setModTags, setTagLabel, deleteTagLabel } = await import('./mod-tags');

after(() => closeDb());
beforeEach(() => {
  getDb().exec('DELETE FROM mod_tag_assignments; DELETE FROM mod_tag_labels;');
});

/*
 * ⚠️★ 数据层把 `actorId` 原样写进 `updated_by`，而那一列是**外键**指向 `users`
 *    （且本仓的连接开着 `PRAGMA foreign_keys = ON`）⇒ 这里传 `null`（列可空，
 *    语义是"这一格没有认领的人"），**不要**传一个不存在的 id：那会当场
 *    `FOREIGN KEY constraint failed`，而症状看起来像"表建错了"
 *    （实测见 `.cache/probe-mod-tags-fk.mjs`）。
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
    getDb()
      .prepare(
        'INSERT INTO mod_tag_assignments (modid, tags, updated_by, updated_at) VALUES (?, ?, ?, ?)',
      )
      .run('broken', '{not json', ACTOR, NOW);
    const layer = readTagLayer();
    assert.equal(layer.assignments.has('broken'), false);
    assert.equal(layer.assignments.size, 0);
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

  it('★ 文件里那条出厂值（mcsrranked → ranked）**不出现在** assignments 里', async () => {
    const res = await call('GET', '/api/mod-tags');
    assert.equal((res.body.assignments as Record<string, string[]>).mcsrranked, undefined);
    // 而它在生效标签里（下一步那条断言证明）
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

  it('合并后的正文仍然是合法目录（严格校验通过）', async () => {
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
