import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildIndex,
  mirrorsFor,
  mirrorUrl,
  modTagsOf,
  parseModCatalog,
  parseModCatalogWire,
  releaseKey,
  releasesFor,
  rowsForGameVersion,
  tagLabelOf,
} from '@mcsr/shared/modCatalog';

/** 一份最小的合法目录。**故意只有一个 mod、一条 release** —— 它测的是形状，不是数据。 */
function minimal(): Record<string, unknown> {
  return {
    schema: 2,
    source: {
      urls: {
        mods: 'https://meta.mc.sr/schema-7/mods.json',
        extra: 'https://meta.mc.sr/schema-7/extra.json',
      },
      schemaVersion: 7,
      sha256: { mods: 'a'.repeat(64), extra: 'b'.repeat(64) },
    },
    mirrors: [
      {
        id: 'gh-proxy',
        label: 'gh-proxy.com',
        prefix: 'https://gh-proxy.com/',
        hosts: ['github.com'],
      },
    ],
    tagLabels: { legal: { zh: '合法', en: 'Legal' } },
    mods: [
      {
        modid: 'atum',
        name: 'Atum',
        list: 'legal',
        tags: ['legal'],
        traits: [],
        obsolete: false,
        incompatibilities: [],
        upstream: null,
      },
    ],
    releases: [
      {
        modid: 'atum',
        version: '2.7.2+1.16-1.16.1',
        url: 'https://github.com/x/y/atum-2.7.2+1.16-1.16.1.jar',
        sha1: 'c'.repeat(40),
        sha512: 'd'.repeat(128),
        size: 71164,
        targetVersions: ['1.16', '1.16.1'],
        dependencies: [],
        obsolete: false,
        intermediary: ['net.fabricmc:intermediary'],
        download: 'auto',
      },
    ],
  };
}

describe('mod 目录 v2 的校验', () => {
  it('最小合法目录通过', () => {
    const result = parseModCatalog(minimal());
    assert.equal(result.ok, true);
  });

  it('★ 仓库那一份**拒绝**未知字段（配置打错字必须当场被抓到）', () => {
    const raw = minimal();
    (raw.mods as Record<string, unknown>[])[0]!.tagz = ['legal'];
    const result = parseModCatalog(raw);
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result), /tagz|unrecognized/i);
  });

  it('★ 线上那一份**忽略**未知字段（否则以后加一个字段就是一次破坏性变更，0.0.5 会整块判"目录不合法"）', () => {
    const raw = minimal();
    (raw.mods as Record<string, unknown>[])[0]!.tagz = ['legal'];
    assert.equal(parseModCatalogWire(raw).ok, true);
  });

  it('失败时点名是哪个字段', () => {
    const raw = minimal();
    (raw.releases as Record<string, unknown>[])[0]!.sha512 = '太短';
    const result = parseModCatalog(raw);
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result), /releases\.0\.sha512/);
  });

  it('★ 引用完整性：release 的 modid 必须在 mods 里（否则界面上一行永远点不动）', () => {
    const raw = minimal();
    (raw.releases as Record<string, unknown>[])[0]!.modid = 'ghost';
    const result = parseModCatalog(raw);
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result), /ghost/);
  });

  it('★ 每个用到的标签都必须有显示名（没有名字就是目录的缺陷，不允许静默显示 key）', () => {
    const raw = minimal();
    (raw.tagLabels as Record<string, unknown>) = {};
    const result = parseModCatalog(raw);
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result), /legal/);
  });

  it('modid 重复 ⇒ 失败', () => {
    const raw = minimal();
    (raw.mods as unknown[]).push((raw.mods as unknown[])[0]);
    assert.equal(parseModCatalog(raw).ok, false);
  });

  it('★ (modid, 游戏版本) 有多个候选**不是**错误（实测真有 2 例，歧义归判定层处理）', () => {
    const raw = minimal();
    const second = {
      ...(raw.releases as Record<string, unknown>[])[0],
      version: '2.7.3+1.16.1',
      url: 'https://github.com/x/y/atum-2.7.3.jar',
    };
    (raw.releases as unknown[]).push(second);
    assert.equal(parseModCatalog(raw).ok, true);
  });
});

/**
 * 逐层的"未知键"注入器 —— **每一层各一条**。
 *
 * ⚠️ 为什么不能只测根那一层：`.strict()` / `z.strictObject()` **不向下传播**
 *    （见 `modCatalog.ts` 文件头那段机制说明）。只做根层严格时，`mods[0]` 上的未知键
 *    会被**静默剥掉** ⇒ 界面上的表现是"某一栏空了"，而**两道门禁一个都不会响**。
 *    逐层各钉一条断言，才把"深"钉成**性质**，而不是某一次写法的副产物。
 */
const unknownKeyInjectors: { layer: string; inject: (raw: Record<string, unknown>) => void }[] = [
  {
    layer: '根',
    inject: (raw) => {
      raw.bogusAtRoot = 1;
    },
  },
  {
    layer: 'source',
    inject: (raw) => {
      (raw.source as Record<string, unknown>).bogusInSource = 1;
    },
  },
  {
    layer: 'source.urls',
    inject: (raw) => {
      ((raw.source as Record<string, unknown>).urls as Record<string, unknown>).bogusInUrls = 1;
    },
  },
  {
    layer: 'source.sha256',
    inject: (raw) => {
      ((raw.source as Record<string, unknown>).sha256 as Record<string, unknown>).bogusInSha256 = 1;
    },
  },
  {
    layer: 'mirrors[0]',
    inject: (raw) => {
      (raw.mirrors as Record<string, unknown>[])[0]!.bogusInMirror = 1;
    },
  },
  {
    layer: 'tagLabels 的值',
    inject: (raw) => {
      (raw.tagLabels as Record<string, Record<string, unknown>>).legal!.bogusInTagLabel = 1;
    },
  },
  {
    layer: 'mods[0]',
    inject: (raw) => {
      (raw.mods as Record<string, unknown>[])[0]!.bogusInMod = 1;
    },
  },
  {
    layer: 'mods[0].upstream',
    inject: (raw) => {
      (raw.mods as Record<string, unknown>[])[0]!.upstream = {
        provider: 'modrinth',
        project: 'mcsrranked',
        bogusInUpstream: 1,
      };
    },
  },
  {
    layer: 'releases[0]',
    inject: (raw) => {
      (raw.releases as Record<string, unknown>[])[0]!.bogusInRelease = 1;
    },
  },
];

describe('未知键在每一层都必须被严格侧拒绝、被宽松侧接受', () => {
  for (const { layer, inject } of unknownKeyInjectors) {
    it(`${layer} 上的未知键：严格侧拒绝、宽松侧接受`, () => {
      const raw = minimal();
      inject(raw);
      assert.equal(parseModCatalog(raw).ok, false);
      assert.equal(parseModCatalogWire(raw).ok, true);
    });
  }
});

describe('展开与查找', () => {
  const catalog = parseModCatalog(minimal());
  const built = catalog.ok ? buildIndex(catalog.catalog) : null;

  it('★ 一个 mod 一条 release 覆盖两个游戏版本 ⇒ 两个键都查得到', () => {
    assert.ok(built);
    assert.equal(releasesFor(built, 'atum', '1.16').length, 1);
    assert.equal(releasesFor(built, 'atum', '1.16.1').length, 1);
    assert.equal(releasesFor(built, 'atum', '1.20').length, 0);
  });

  it('★ 重复键保留**全部**候选（覆盖式 Map 会把歧义悄悄抹平）', () => {
    assert.ok(built);
    const raw = minimal();
    const clone = {
      ...(raw.releases as Record<string, unknown>[])[0],
      version: '2.7.3',
      url: 'https://github.com/x/y/atum-2.7.3.jar',
    };
    (raw.releases as unknown[]).push(clone);
    const parsed = parseModCatalog(raw);
    assert.ok(parsed.ok);
    assert.equal(releasesFor(buildIndex(parsed.catalog), 'atum', '1.16.1').length, 2);
  });

  it('键是 modid|游戏版本，且分隔符只此一处', () => {
    assert.equal(releaseKey('atum', '1.16.1'), 'atum|1.16.1');
  });

  it('rowsForGameVersion 只出该版本有 release 的 mod', () => {
    assert.ok(built);
    const rows = rowsForGameVersion(built, '1.16.1');
    assert.deepEqual(
      rows.map((r) => r.mod.modid),
      ['atum'],
    );
    assert.deepEqual(rowsForGameVersion(built, '1.7.10'), []);
  });

  it('★ 标签查得到显示名；查不到时返回 null（**不许**回退成 key：那会让缺陷看不见）', () => {
    assert.ok(catalog.ok);
    assert.deepEqual(tagLabelOf(catalog.catalog, 'legal'), { zh: '合法', en: 'Legal' });
    assert.equal(tagLabelOf(catalog.catalog, '不存在'), null);
    assert.deepEqual(modTagsOf(catalog.catalog.mods[0]!), ['legal']);
  });

  it('★ 镜像只看 host：GitHub 有、Modrinth 没有（非 GitHub 来源不该出现镜像按钮）', () => {
    assert.ok(catalog.ok);
    assert.equal(mirrorsFor(catalog.catalog, 'https://github.com/a/b/c.jar').length, 1);
    assert.equal(mirrorsFor(catalog.catalog, 'https://cdn.modrinth.com/data/x/y/z.jar').length, 0);
    assert.equal(mirrorsFor(catalog.catalog, '这不是 URL').length, 0);
  });

  it('镜像地址是前缀直拼（所以 prefix 必须以 / 结尾，那条在 schema 里拦）', () => {
    const mirror = { id: 'm', label: 'm', prefix: 'https://gh-proxy.com/', hosts: ['github.com'] };
    assert.equal(
      mirrorUrl(mirror, 'https://github.com/a/b.jar'),
      'https://gh-proxy.com/https://github.com/a/b.jar',
    );
  });
});
