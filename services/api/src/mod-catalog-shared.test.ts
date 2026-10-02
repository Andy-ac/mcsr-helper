import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import type { ModRelease } from '@mcsr/shared/modCatalog';
import {
  buildIndex,
  compareLocalToRelease,
  judgeRelease,
  mirrorsFor,
  mirrorUrl,
  modFor,
  modTagsOf,
  needsUpdate,
  originFileNameOf,
  parseModCatalog,
  parseModCatalogWire,
  releaseKey,
  releasesFor,
  rowsForGameVersion,
  tagLabelOf,
  versionBodyOf,
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

  it('★ 查询给的数组是副本：`.sort()` 返回的数组不会静默改掉索引', () => {
    // ⚠️ 这一条**故意**不碰 describe 级的 `built`：那里只有一个索引实例，
    //    就地变异会污染同一文件后面所有用到它的用例（评审点名的那个陷阱）。
    assert.ok(catalog.ok);
    const index = buildIndex(catalog.catalog);

    const candidates = releasesFor(index, 'atum', '1.16.1');
    const raw = candidates as ModRelease[];
    raw.push({ ...raw[0]!, version: 'pushed' });
    raw.sort((a, b) => (a.version < b.version ? 1 : -1));
    assert.equal(raw[0]!.version, 'pushed');
    // 索引没被这次就地改动碰到：长度还是 1、顺序还是目录里那条。
    assert.equal(releasesFor(index, 'atum', '1.16.1').length, 1);
    assert.equal(releasesFor(index, 'atum', '1.16.1')[0]!.version, '2.7.2+1.16-1.16.1');

    // `modTagsOf` 同理：它交出去的如果是 `mod.tags` 原数组，一次就地 `.push()` 就改掉了目录。
    (modTagsOf(catalog.catalog.mods[0]!) as string[]).push('MUTATED');
    assert.deepEqual(modTagsOf(catalog.catalog.mods[0]!), ['legal']);
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

/**
 * `buildIndex` 的**真目录**读数。
 *
 * ⚠️ 为什么这里要看 `content/mod-catalog.json` 而不是又造一份夹具：
 *    上面那一段用的是**最小**夹具（一个 mod、一条 release ⇒ 两个游戏版本），
 *    而 `gameVersions` 的读数在夹具上是 2 —— 于是"把 `versions.add(...)` 删掉"
 *    这种坏法在该夹具下**照样绿**。这条断言必须钉在真目录的**规模**上才有意义。
 *
 * ⚠️ 输入在不在（AGENTS §5.74）：路径写错了要**当场**说出来，
 *    而不是让断言在 `undefined` 上静默变成另一条检查。
 */
const REAL_CATALOG_PATH = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'content',
  'mod-catalog.json',
);

function catalogFromRepo(path: string): unknown {
  assert.ok(existsSync(path), `真目录不在这里（路径写错？）：${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('展开与查找：真目录的读数', () => {
  const parsed = parseModCatalog(catalogFromRepo(REAL_CATALOG_PATH));

  it('★ gameVersions 是全部目标版本的去重集合（索引真的收集了它们，不是空数组）', () => {
    assert.ok(parsed.ok, `真目录必须合法：${JSON.stringify(parsed.ok ? [] : parsed.problems)}`);
    const index = buildIndex(parsed.catalog);
    // 107 = 555 条 release 的 targetVersions 去重后的项数。
    assert.equal(index.gameVersions.length, 107);
    assert.ok(index.gameVersions.includes('1.16.1'));
    // 钉住**代码单元序**（不是数值序）：读这个字段的消费者（版本下拉框）必须自己带比较器。
    // 真目录里第一处分歧就在这两个之间（'1.2' 本身不是一个版本，别拿它做判据）。
    assert.ok(
      index.gameVersions.indexOf('1.10') < index.gameVersions.indexOf('1.2.1'),
      '预期是代码单元序：1.10 排在 1.2.1 前面（数值序会反过来）',
    );
  });

  it('★ modFor：已知 modid 拿得到那条 mod，未知的拿 null（不许拿一个假对象顶上）', () => {
    assert.ok(parsed.ok, `真目录必须合法：${JSON.stringify(parsed.ok ? [] : parsed.problems)}`);
    const index = buildIndex(parsed.catalog);
    const first = parsed.catalog.mods[0]!;
    assert.equal(modFor(index, first.modid)?.modid, first.modid);
    assert.equal(modFor(index, 'ghost'), null);
  });
});

/** 造一条 release —— 只填判定用得到的字段。 */
function release(
  version: string,
  sha512 = 'e'.repeat(128),
): {
  modid: string;
  version: string;
  url: string;
  sha1: string;
  sha512: string;
  size: number;
  targetVersions: string[];
  dependencies: string[];
  obsolete: boolean;
  intermediary: string[];
  download: 'auto';
} {
  return {
    modid: 'atum',
    version,
    url: `https://github.com/x/y/atum-${version}.jar`,
    sha1: 'f'.repeat(40),
    sha512,
    size: 1,
    targetVersions: ['1.16.1'],
    dependencies: [],
    obsolete: false,
    intermediary: ['net.fabricmc:intermediary'],
    download: 'auto',
  };
}

describe('版本主体与文件名', () => {
  it('★ 剥掉 `+` 之后的构建元数据（这是 standardsettings 那一例的承重判据）', () => {
    assert.equal(versionBodyOf('2.3+1.16.1'), '2.3');
    assert.equal(versionBodyOf('2.3+1.16-1.16.1'), '2.3');
    assert.equal(versionBodyOf('5.8.26'), '5.8.26');
    assert.equal(versionBodyOf('0.1.3-SNAPSHOT+2021-02-20'), '0.1.3-SNAPSHOT');
  });

  it('★ 文件名从 URL 末段取，`%2B` 解成 `+`', () => {
    assert.equal(
      originFileNameOf('https://github.com/a/b/GhostRunner-4.0%2B1.16.1.jar'),
      'GhostRunner-4.0+1.16.1.jar',
    );
    assert.equal(
      originFileNameOf('https://cdn.modrinth.com/data/x/y/FSG-Mod-5.3.0%2BMC1.16.1.jar'),
      'FSG-Mod-5.3.0+MC1.16.1.jar',
    );
  });

  it('★ 路径穿越与非法名字一律拒绝（URL 里来的名字是不可信输入）', () => {
    assert.equal(originFileNameOf('https://x/y/..%2F..%2Fz.jar'), null);
    assert.equal(originFileNameOf('https://x/y/a%5Cb.jar'), null);
    assert.equal(originFileNameOf('https://x/y/'), null);
    assert.equal(originFileNameOf('https://x/y/notajar.txt'), null);
    assert.equal(originFileNameOf('https://x/y/a%3Fb.jar'), null);
    assert.equal(originFileNameOf('这不是 URL'), null);
  });

  it('★ Windows 保留设备名一律拒绝（`NUL.jar` 就是 `NUL`：打开它不写字节，而调用方可能报"已安装"）', () => {
    for (const name of [
      'NUL.jar',
      'CON.jar',
      'AUX.jar',
      'PRN.jar',
      'COM1.jar',
      'LPT1.jar',
      'nul.jar',
    ]) {
      assert.equal(originFileNameOf(`https://x/y/${name}`), null, `${name} 必须被拒绝`);
    }
    // ★ 正向对照：`CONSOLE.jar` **不是**保留名（`(\.|$)` 那个边界）。没有这一条的话，
    //    "把带字母的名字全拒了"也能让上面全绿。
    assert.equal(originFileNameOf('https://x/y/CONSOLE.jar'), 'CONSOLE.jar');
  });

  it('★ 名字长度上限 255（超了要在这里给 `null`，而不是让 NTFS 去报错）', () => {
    const atLimit = `${'a'.repeat(255 - 4)}.jar`;
    const overLimit = `${'a'.repeat(256 - 4)}.jar`;
    assert.equal(atLimit.length, 255);
    assert.equal(overLimit.length, 256);
    assert.equal(originFileNameOf(`https://x/y/${atLimit}`), atLimit);
    assert.equal(originFileNameOf(`https://x/y/${overLimit}`), null);
  });

  it('★ 退化基名（空干名 / 只有点与空白）一律拒绝：`.jar` 是隐藏文件，两条 release 还会撞同一个落盘路径', () => {
    for (const name of ['.jar', '..jar', ' .jar', '  .jar']) {
      assert.equal(originFileNameOf(`https://x/y/${name}`), null, `${name} 必须被拒绝`);
    }
    // ★ 正向对照：干名只要有内容就照常通过（拒绝的是"空干名"，不是"以点开头"）。
    assert.equal(originFileNameOf('https://x/y/.hidden.jar'), '.hidden.jar');
  });

  it('★ 格式控制符（bidi 之类）拒绝：这个名字要显示给用户 ⇒ a + U+202E + b.jar 是视觉欺骗', () => {
    assert.equal(originFileNameOf('https://x/y/a\u202eb.jar'), null);
    // ★ 正向对照：同一个位置换成一个普通字符 ⇒ 照常通过（证明拒的是那个字符，不是整个名字）。
    assert.equal(originFileNameOf('https://x/y/aXb.jar'), 'aXb.jar');
  });
});

describe('判定（只升不降）', () => {
  it('★ sha512 相等 ⇒ same，**与版本号字符串无关**', () => {
    const r = release('2.3+1.16-1.16.1', 'a'.repeat(128));
    assert.equal(compareLocalToRelease('a'.repeat(128), '2.3+1.16.1', r), 'same');
  });

  it('★ 主体相同、字节不同 ⇒ different-build（standardsettings 的真实形状）', () => {
    const r = release('2.3+1.16-1.16.1');
    assert.equal(compareLocalToRelease('b'.repeat(128), '2.3+1.16.1', r), 'different-build');
  });

  it('★ 本地更旧 ⇒ older（唯一进批量的状态）', () => {
    const r = release('2.7.2+1.16-1.16.1');
    assert.equal(compareLocalToRelease('b'.repeat(128), '2.7.1+1.16-1.16.1', r), 'older');
    assert.equal(needsUpdate(judgeRelease('b'.repeat(128), '2.7.1+1.16-1.16.1', [r])), true);
  });

  it('★★ 本地更新 ⇒ newer，且**绝不**进批量（mcsrranked 5.8.26 vs mc.sr 5.8.22）', () => {
    const r = release('5.8.22');
    const verdict = judgeRelease('b'.repeat(128), '5.8.26', [r]);
    assert.equal(verdict.kind, 'newer');
    assert.equal(needsUpdate(verdict), false, '本地比上游新时把它替换掉 = 降级');
  });

  it('★ 没有候选 ⇒ missing-release', () => {
    assert.equal(judgeRelease(null, null, []).kind, 'missing-release');
  });

  it('★ 两个候选时，本地的 sha512 能定案就定案（实测有 2 个这样的键）', () => {
    const a = release('HD_U_E1', 'a'.repeat(128));
    const b = release('HD_U_F7', 'b'.repeat(128));
    const verdict = judgeRelease('b'.repeat(128), null, [a, b]);
    assert.equal(verdict.kind, 'same');
    assert.equal(verdict.kind === 'same' ? verdict.release.version : null, 'HD_U_F7');
  });

  it('★ 两个候选、本地都不是 ⇒ ambiguous，且不进批量（不猜）', () => {
    const a = release('HD_U_E1', 'a'.repeat(128));
    const b = release('HD_U_F7', 'b'.repeat(128));
    const verdict = judgeRelease('c'.repeat(128), '1.0', [a, b]);
    assert.equal(verdict.kind, 'ambiguous');
    assert.equal(needsUpdate(verdict), false);
  });

  it('★ 读不出本地版本 ⇒ unknown，不进批量', () => {
    const verdict = judgeRelease(null, null, [release('1.0')]);
    assert.equal(verdict.kind, 'unknown');
    assert.equal(needsUpdate(verdict), false);
  });

  it('★★ 非数字版本段**不排先后**（`HD_U_F10` vs `HD_U_F9` 上 localeCompare 说"本地更旧" ⇒ 会把新 jar 换成旧的）', () => {
    const r = release('HD_U_F9');
    assert.equal(compareLocalToRelease('b'.repeat(128), 'HD_U_F10', r), 'different-build');
    assert.equal(needsUpdate(judgeRelease('b'.repeat(128), 'HD_U_F10', [r])), false);
    assert.equal(compareLocalToRelease('b'.repeat(128), 'HD_U_F9', r), 'different-build');
    // ★ 正向对照：纯数字主体照样排得动 ⇒ 上面的 different-build 不是"什么都判 different-build"。
    assert.equal(compareLocalToRelease('b'.repeat(128), '2.7.1', release('2.7.2')), 'older');
  });

  it('★ `manual` 的 release 即使判成 `older` 也不进批量（spec §8：它只给"打开原网页"）', () => {
    const auto = release('2.7.2');
    const manual = { ...auto, download: 'manual' as const };
    const verdict = judgeRelease('b'.repeat(128), '2.7.1', [manual]);
    assert.equal(verdict.kind, 'older');
    assert.equal(needsUpdate(verdict), false);
    // ★ 正向对照：同一形状、`download` 是 `auto` ⇒ 进批量（证明这道闸认的是 download，不是别的）。
    assert.equal(needsUpdate(judgeRelease('b'.repeat(128), '2.7.1', [auto])), true);
  });

  it('★ `needsUpdate` 只认 older（把"不等就更新"写进来会让 newer 也进批量）', () => {
    const verdicts = [
      judgeRelease('a'.repeat(128), '2.3+1.16.1', [release('2.3+1.16-1.16.1', 'a'.repeat(128))]),
      judgeRelease('b'.repeat(128), '2.3+1.16.1', [release('2.3+1.16-1.16.1')]),
      judgeRelease('b'.repeat(128), '1.0', [release('2.0')]),
    ];
    assert.deepEqual(
      verdicts.map((v) => v.kind),
      ['same', 'different-build', 'older'],
    );
    assert.deepEqual(verdicts.map(needsUpdate), [false, false, true]);
  });
});
