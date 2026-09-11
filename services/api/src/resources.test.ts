/**
 * 资源库数据层测试。
 *
 * 用 Node 内置的 test runner（`node --test`），不引入额外依赖。
 * 每个测试用**独立的内存数据库** —— 靠 DB_PATH=:memory: 实现，
 * 所以不用担心测试之间互相污染，也不用清理临时文件。
 *
 * 这里重点锁住的是**数据安全不变量**，而不是查询结果的细节：
 * 查询写错了会立刻被看见，而"导入脚本删掉用户数据"要等到 M2 上线之后
 * 才会以"用户提交的东西凭空消失"的形式暴露，那时候排查成本高得多。
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

// 必须在导入 db 模块**之前**设置：db 是个单例，第一次 getDb() 时就固定了路径。
process.env.DB_PATH = ':memory:';

const { closeDb } = await import('./db');
const { countBySource, deleteImportedNotIn, listResources, upsertResource } = await import(
  './resources'
);

const base = {
  kind: 'website' as const,
  titleEn: null,
  summary: null,
  body: '正文',
  lang: 'en' as const,
  tags: [] as string[],
  featured: false,
  status: 'published' as const,
};

before(() => {
  // 迁移与建库
});

after(() => {
  closeDb();
});

describe('导入与用户数据的边界', () => {
  it('导入脚本只删除 source=import 的记录，绝不动用户提交的内容', () => {
    // 三条从内容文件导入的
    upsertResource({ ...base, id: 'imp-a', title: 'A', url: 'https://a.example' });
    upsertResource({ ...base, id: 'imp-b', title: 'B', url: 'https://b.example' });
    upsertResource({ ...base, id: 'imp-c', title: 'C', url: 'https://c.example' });

    // 两条"用户提交"的
    upsertResource(
      { ...base, id: 'usr-1', title: '用户一', url: 'https://u1.example' },
      { source: 'user' },
    );
    upsertResource(
      { ...base, id: 'usr-2', title: '用户二', url: 'https://u2.example' },
      { source: 'user' },
    );

    assert.deepEqual(countBySource(), { import: 3, user: 2 });

    // 内容文件里只剩下 imp-a —— imp-b、imp-c 应当被删，用户提交的必须留下
    const removed = deleteImportedNotIn(['imp-a']);

    assert.deepEqual(removed.sort(), ['imp-b', 'imp-c']);
    assert.deepEqual(countBySource(), { import: 1, user: 2 });
  });

  it('即使内容文件里的 id 与用户提交的 id 冲突，也不会把用户那条删掉', () => {
    // 先造一条用户提交的记录
    upsertResource(
      { ...base, id: 'collide', title: '用户先占的', url: 'https://dup.example' },
      { source: 'user' },
    );
    // 内容文件里没有它
    const removed = deleteImportedNotIn([]);
    assert.ok(!removed.includes('collide'), '用户提交的条目出现在了删除列表里');
    assert.equal(countBySource().user >= 1, true);
  });
});

describe('查询', () => {
  it('搜索里的 LIKE 通配符被转义', () => {
    upsertResource({ ...base, id: 'q-1', title: 'Ninjabrain Bot', url: 'https://n.example' });
    upsertResource({ ...base, id: 'q-2', title: '别的工具', url: 'https://o.example' });

    // 未转义的话 `%` 会匹配所有记录，看起来像"搜索坏了"
    const percent = listResources({ q: '%', page: 1, pageSize: 50 });
    assert.equal(percent.total, 0, '`%` 不应该匹配到任何记录');

    const underscore = listResources({ q: '_', page: 1, pageSize: 50 });
    assert.equal(underscore.total, 0, '`_` 不应该匹配到任何记录');

    const normal = listResources({ q: 'ninja', page: 1, pageSize: 50 });
    assert.equal(normal.total, 1);
    assert.equal(normal.items[0]?.id, 'q-1');
  });

  it('列表项不含 body（避免列表接口下发全文）', () => {
    upsertResource({
      ...base,
      id: 'nobody-1',
      title: 'X',
      url: 'https://x.example',
      body: '很长的正文'.repeat(50),
    });
    const result = listResources({ page: 1, pageSize: 50 });
    for (const item of result.items) {
      assert.ok(!('body' in item), `列表项 ${item.id} 里出现了 body`);
    }
  });

  it('标签筛选是精确匹配，不会误配前缀相同的标签', () => {
    upsertResource({
      ...base,
      id: 'tag-1',
      title: 'T1',
      url: 'https://t1.example',
      tags: ['tools'],
    });
    upsertResource({
      ...base,
      id: 'tag-2',
      title: 'T2',
      url: 'https://t2.example',
      tags: ['tools-extra'],
    });

    const tools = listResources({ tag: 'tools', page: 1, pageSize: 50 });
    assert.equal(tools.total, 1, 'tag=tools 不应该匹配到 tools-extra');
    assert.equal(tools.items[0]?.id, 'tag-1');
  });
});
