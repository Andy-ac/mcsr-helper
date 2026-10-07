/**
 * ★ B1：人工标签层的**纯判断**（合并算法 / 被引用判定 / schema 边界）。
 *
 * 为什么住在 `services/api/src/`：`apps/desktop` 与 `apps/web` 都没有测试运行器
 * （见 `modFolders.ts` 文件头那条先例），而这一份逻辑是**服务端下发时**用的。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_TAGS_PER_MOD,
  type ModCatalog,
  ModTagLabelInputSchema,
  ModTagsInputSchema,
  mergeModTagLayer,
  parseModCatalog,
  tagInUse,
} from '@mcsr/shared/modCatalog';

/** 一份最小的合法目录：两个 mod，其中 `rankedmod` 有人工标签（出厂值）。 */
function catalog(): ModCatalog {
  return {
    schema: 2,
    source: {
      urls: { mods: 'https://example.test/mods.json', extra: 'https://example.test/extra.json' },
      schemaVersion: 7,
      sha256: { mods: 'a'.repeat(64), extra: 'b'.repeat(64) },
    },
    mirrors: [],
    tagLabels: {
      legal: { zh: '合法', en: 'Legal' },
      extra: { zh: '其他', en: 'Other' },
      ranked: { zh: '排位', en: 'Ranked' },
      'rsg-only': { zh: '仅随机种子', en: 'Random seed only' },
    },
    manualTags: { rankedmod: ['ranked'] },
    mods: [
      {
        modid: 'plain',
        name: 'Plain',
        list: 'legal',
        tags: ['legal'],
        traits: [],
        obsolete: false,
        incompatibilities: [],
        upstream: null,
      },
      {
        modid: 'rankedmod',
        name: 'Ranked',
        list: 'extra',
        tags: ['extra', 'ranked'],
        traits: [],
        obsolete: false,
        incompatibilities: [],
        upstream: null,
      },
    ],
    releases: [],
  } as unknown as ModCatalog;
}

const noLayer = { assignments: new Map(), labels: new Map() };

describe('★ B1 合并：人工层整行替换（DB 有行就用 DB 的、没有就用目录里的 manualTags）', () => {
  it('没有 DB 行 ⇒ 生效标签与目录里那份逐字相同（回落）', () => {
    const out = mergeModTagLayer({ catalog: catalog(), layer: noLayer });
    const row = out.mods.find((m) => m.modid === 'rankedmod');
    assert.deepEqual(row?.tags, ['extra', 'ranked']);
  });

  it('★ DB 存空数组 ⇒ 人工标签真的消失，而自动标签还在（这是"整行替换"的刀）', () => {
    const out = mergeModTagLayer({
      catalog: catalog(),
      layer: { assignments: new Map([['rankedmod', []]]), labels: new Map() },
    });
    const row = out.mods.find((m) => m.modid === 'rankedmod');
    assert.deepEqual(
      row?.tags,
      ['extra'],
      'rated 来自 manualTags ⇒ 空了就该消失；extra 是自动的 ⇒ 必须留着',
    );
  });

  it('DB 换一个标签 ⇒ 新标签进来、旧的人工标签出去', () => {
    const out = mergeModTagLayer({
      catalog: catalog(),
      layer: { assignments: new Map([['rankedmod', ['rsg-only']]]), labels: new Map() },
    });
    const row = out.mods.find((m) => m.modid === 'rankedmod');
    assert.deepEqual(row?.tags, ['extra', 'rsg-only']);
  });

  it('结果按代码单元序去重（与生成器同一条排序）', () => {
    const out = mergeModTagLayer({
      catalog: catalog(),
      layer: {
        assignments: new Map([['plain', ['rsg-only', 'extra', 'extra']]]),
        labels: new Map(),
      },
    });
    const row = out.mods.find((m) => m.modid === 'plain');
    assert.deepEqual(row?.tags, ['extra', 'legal', 'rsg-only']);
  });

  it('DB 的显示名覆盖文件里的同名键，新标签的显示名也进 tagLabels', () => {
    const out = mergeModTagLayer({
      catalog: catalog(),
      layer: {
        assignments: new Map(),
        labels: new Map([
          ['ranked', { zh: '排位赛', en: 'Ranked play' }],
          ['newtag', { zh: '新标签', en: 'New tag' }],
        ]),
      },
    });
    assert.deepEqual(out.tagLabels.ranked, { zh: '排位赛', en: 'Ranked play' });
    assert.deepEqual(out.tagLabels.newtag, { zh: '新标签', en: 'New tag' });
  });

  it('★ 合并后的目录仍然合法（严格校验通过）—— 少并 tagLabels 会在这里红', () => {
    const merged = mergeModTagLayer({
      catalog: catalog(),
      layer: {
        assignments: new Map([['plain', ['newtag']]]),
        labels: new Map([['newtag', { zh: '新标签', en: 'New tag' }]]),
      },
    });
    const parsed = parseModCatalog(merged);
    assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.problems.join('；'));
  });

  it('没有 manualTags 的旧目录 ⇒ 当作"一个都没有"（不抛、不误删自动标签）', () => {
    const old = catalog();
    delete (old as { manualTags?: unknown }).manualTags;
    const out = mergeModTagLayer({ catalog: old, layer: noLayer });
    const row = out.mods.find((m) => m.modid === 'rankedmod');
    assert.deepEqual(row?.tags, ['extra', 'ranked'], '旧目录没有那一格 ⇒ 什么都不减');
  });
});

describe('★ B1 被引用判定（删标签的那道闸）', () => {
  it('还被 DB 人工层引用 ⇒ used，并列出前几个 modid', () => {
    const result = tagInUse({
      tag: 'ranked',
      catalog: catalog(),
      layer: { assignments: new Map([['plain', ['ranked']]]), labels: new Map() },
    });
    assert.equal(result.used, true);
    assert.deepEqual(result.by, ['plain', 'rankedmod']);
  });

  it('只被目录里的 manualTags 引用 ⇒ 也算 used（文件来的那一层也算数）', () => {
    const result = tagInUse({ tag: 'ranked', catalog: catalog(), layer: noLayer });
    assert.equal(result.used, true);
    assert.deepEqual(result.by, ['rankedmod']);
  });

  it('★ 没人用 ⇒ used=false（那些"只在 tagLabels 里、没有 mod 用"的标签才删得掉）', () => {
    const result = tagInUse({
      tag: 'legal',
      catalog: { ...catalog(), mods: [] } as ModCatalog,
      layer: noLayer,
    });
    assert.equal(result.used, false);
    assert.deepEqual(result.by, []);
  });
});

describe('★ B1 schema 边界', () => {
  it(`${String(MAX_TAGS_PER_MOD)} 个标签可以，${String(MAX_TAGS_PER_MOD + 1)} 个不行`, () => {
    const tags = (n: number): string[] => Array.from({ length: n }, (_, i) => `t${String(i)}`);
    assert.equal(ModTagsInputSchema.safeParse({ tags: tags(MAX_TAGS_PER_MOD) }).success, true);
    assert.equal(ModTagsInputSchema.safeParse({ tags: tags(MAX_TAGS_PER_MOD + 1) }).success, false);
  });

  it('空数组是合法的（"这个 mod 没有人工标签"是一个正常状态）', () => {
    assert.equal(ModTagsInputSchema.safeParse({ tags: [] }).success, true);
  });

  it('显示名两种语言都非空、都不超过上限', () => {
    assert.equal(ModTagLabelInputSchema.safeParse({ zh: '排位', en: 'Ranked' }).success, true);
    assert.equal(ModTagLabelInputSchema.safeParse({ zh: '', en: 'Ranked' }).success, false);
    assert.equal(
      ModTagLabelInputSchema.safeParse({ zh: '排位', en: 'x'.repeat(41) }).success,
      false,
    );
  });
});
