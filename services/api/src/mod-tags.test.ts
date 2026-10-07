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
