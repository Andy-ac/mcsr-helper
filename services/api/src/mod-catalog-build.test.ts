import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseModCatalog } from '@mcsr/shared/modCatalog';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

describe('生成的目录（提交进仓库的那份字节）', () => {
  it('通过严格校验', () => {
    const result = parseModCatalog(JSON.parse(read('content/mod-catalog.json')));
    assert.equal(result.ok, true, JSON.stringify('problems' in result ? result.problems : []));
  });

  /*
   * ⚠️★ 下面这一段是 spec §3.1 那张表的**可执行版本**。
   *    为什么值得把数字钉成断言：这些数字曾经错成 494/343/97/106（只数了 mods.json 却标成合计），
   *    而一个错数字会一路传到界面上（"48 行"变成了"31 行"也没人发现）。
   *    快照一刷新这些断言就可能红 —— **那是正确行为**：逼一个人去看上游改了什么、并同步改 spec。
   */
  it('★ 规模读数与 spec §3.1 一致（刷新快照后若红了，先核对 spec 再改这里）', () => {
    const catalog = JSON.parse(read('content/mod-catalog.json')) as {
      mods: unknown[];
      releases: { modid: string; targetVersions: string[] }[];
      source: { schemaVersion: number };
    };
    assert.equal(catalog.mods.length, 70);
    assert.equal(catalog.releases.length, 555);
    assert.equal(catalog.source.schemaVersion, 7);

    // ⚠️ 两件事要分开数：**游戏版本**是 107 个，而 `(modid, 游戏版本)` **对**是 1761 个。
    //    第一版我在这里把两者写成了同一个数（那是错的 —— 一个 mod 的一条 release 覆盖多个版本）。
    const pairs = new Set<string>();
    const gameVersions = new Set<string>();
    for (const release of catalog.releases) {
      for (const gv of release.targetVersions) {
        pairs.add(`${release.modid}|${gv}`);
        gameVersions.add(gv);
      }
    }
    assert.equal(gameVersions.size, 107);
    assert.equal(pairs.size, 1761);
  });

  it('★ 宿主分布与 spec §3.1 一致', () => {
    const catalog = JSON.parse(read('content/mod-catalog.json')) as { releases: { url: string }[] };
    const hosts = new Map<string, number>();
    for (const release of catalog.releases) {
      const host = new URL(release.url).host;
      hosts.set(host, (hosts.get(host) ?? 0) + 1);
    }
    assert.deepEqual(Object.fromEntries([...hosts].sort()), {
      'cdn.modrinth.com': 133,
      'github.com': 368,
      'optifine.net': 54,
    });
  });

  it('★ 那 2 个重复键的候选写死在断言里（歧义是运行期状态，不能让它在数据层被抹平）', () => {
    const catalog = JSON.parse(read('content/mod-catalog.json')) as {
      releases: { modid: string; version: string; targetVersions: string[] }[];
    };
    const byPair = new Map<string, string[]>();
    for (const release of catalog.releases) {
      for (const gv of release.targetVersions) {
        const key = `${release.modid}|${gv}`;
        byPair.set(key, [...(byPair.get(key) ?? []), release.version]);
      }
    }
    const dupes = [...byPair].filter(([, versions]) => versions.length > 1).sort();
    assert.deepEqual(dupes, [
      ['optifine|1.7.2', ['HD_U_E1', 'HD_U_F7']],
      ['speedrunigt|26.1', ['14.2+26.1', '14.2+26.1.x']],
    ]);
  });

  it('★ 1.16.1 是 48 条（31 合法 + 17 其他）', () => {
    const catalog = JSON.parse(read('content/mod-catalog.json')) as {
      releases: { modid: string; targetVersions: string[] }[];
      mods: { modid: string; list: string }[];
    };
    const hits = catalog.releases.filter((r) => r.targetVersions.includes('1.16.1'));
    assert.equal(hits.length, 48);
    const listOf = new Map(catalog.mods.map((m) => [m.modid, m.list]));
    assert.equal(hits.filter((r) => listOf.get(r.modid) === 'legal').length, 31);
    assert.equal(hits.filter((r) => listOf.get(r.modid) === 'extra').length, 17);
  });

  it('★ OptiFine 的 54 条全是 manual（实测 optifine.net 从本机不可达：http=000）', () => {
    const catalog = JSON.parse(read('content/mod-catalog.json')) as {
      releases: { url: string; download: string }[];
    };
    const optifine = catalog.releases.filter((r) => new URL(r.url).host === 'optifine.net');
    assert.equal(optifine.length, 54);
    assert.equal(
      optifine.every((r) => r.download === 'manual'),
      true,
    );
  });

  it('★ mcsrranked 有 upstream 且指向 Modrinth（它是唯一一个已知 mc.sr 数据滞后的）', () => {
    const catalog = JSON.parse(read('content/mod-catalog.json')) as {
      mods: { modid: string; upstream: unknown }[];
    };
    const ranked = catalog.mods.find((m) => m.modid === 'mcsrranked');
    assert.deepEqual(ranked?.upstream, { provider: 'modrinth', project: 'I9W1u5Ac' });
  });

  it('★ 生成的字节可复现：同样的输入 ⇒ 逐字节相同（这条是 --check 的地基）', async () => {
    const { buildCatalog, catalogBytes } = (await import('./modCatalogBuild')) as {
      buildCatalog: (input: unknown) => unknown;
      catalogBytes: (catalog: unknown) => string;
    };
    const input = {
      modsRaw: JSON.parse(read('content/upstream/mods.json')),
      extraRaw: JSON.parse(read('content/upstream/extra.json')),
      overrides: JSON.parse(read('content/mod-overrides.json')),
      sha256: { mods: 'a'.repeat(64), extra: 'b'.repeat(64) },
    };
    const once = catalogBytes(buildCatalog(input));
    const twice = catalogBytes(buildCatalog(input));
    assert.equal(once, twice);
  });

  /*
   * ⚠️★ 上面那条只钉住"同一份输入 ⇒ 同一份字节"，而 `catalogBytes` **忽略参数、返回一个常量**
   *    同样能让它通过 —— 那样 `--check` 就变成恒真了。所以这里补上反方向：
   *    **两份不同的目录必须给出不同的字节**。
   *    差别故意取在**人工配置**上（只改一条标签文案）⇒ 这条断言与"上游数据"无关，
   *    它只测序列化函数真的读了它的参数。
   */
  it('★ catalogBytes 真的看输入：两份不同的目录 ⇒ 不同的字节（返回常量也能骗过上面那条）', async () => {
    const { buildCatalog, catalogBytes } = (await import('./modCatalogBuild')) as {
      buildCatalog: (input: unknown) => unknown;
      catalogBytes: (catalog: unknown) => string;
    };
    const overrides = JSON.parse(read('content/mod-overrides.json')) as {
      tagLabels: Record<string, { zh: string; en: string }>;
    };
    const base = {
      modsRaw: JSON.parse(read('content/upstream/mods.json')),
      extraRaw: JSON.parse(read('content/upstream/extra.json')),
      overrides,
      sha256: { mods: 'a'.repeat(64), extra: 'b'.repeat(64) },
    };
    const changed = {
      ...base,
      overrides: {
        ...overrides,
        tagLabels: { ...overrides.tagLabels, ranked: { zh: '排位', en: 'Ranked（改过）' } },
      },
    };
    assert.notStrictEqual(catalogBytes(buildCatalog(base)), catalogBytes(buildCatalog(changed)));
  });
});

/*
 * ★ 模块头部那句"上游字段**不许**顺手兼容"的**自动化证据**（评审 Important 1）。
 *
 * 手法统一：拿**真快照**当基线，只把第一条 release 的某一个字段改坏（删掉 / 换成错类型），
 * 然后断言 `buildCatalog` 抛 `ModCatalogBuildError` **而且消息里有那个路径** ——
 * "抛了"与"抛对了地方"必须分开判（否则一句笼统的 `throw new Error()` 也能让断言变绿）。
 *
 * 为什么钉的是这几个字段：实测它们**555/555 条 release 都有**（见 `modCatalogBuild.ts` 的
 * `requiredStrArray` 上面那张表）⇒ 缺了就是上游改名/删字段，**不是**"可以省略"。
 * ⚠️ 反面对照组在最后一条：`dependencies`（136/555）与 release 的 `obsolete`（1/555）的
 * "没有"是数据的**常态**，删掉它们**必须不抛** —— 否则这个文件里的守卫就变成"什么都拒绝"。
 */
function brokenSnapshot(mutate: (release: Record<string, unknown>) => void): {
  input: {
    modsRaw: unknown;
    extraRaw: unknown;
    overrides: unknown;
    sha256: { mods: string; extra: string };
  };
  path: string;
} {
  const modsRaw = JSON.parse(read('content/upstream/mods.json')) as {
    mods: { modid: string; versions: Record<string, unknown>[] }[];
  };
  const first = modsRaw.mods[0]!;
  mutate(first.versions[0]!);
  return {
    input: {
      modsRaw,
      extraRaw: JSON.parse(read('content/upstream/extra.json')),
      overrides: JSON.parse(read('content/mod-overrides.json')),
      sha256: { mods: 'a'.repeat(64), extra: 'b'.repeat(64) },
    },
    // 与 `modCatalogBuild.ts` 里 `at` 的拼法逐字一致（这条断言同时钉住"路径指名道姓"的格式）。
    path: `mods.json.mods[${first.modid}].versions[0]`,
  };
}

describe('构建器的错误路径（上游改形状时必须看得见，不许静默兼容）', () => {
  for (const field of ['target_version', 'intermediary']) {
    it(`★ release 的 ${field} 被删掉 ⇒ 抛，且消息里有它的路径（实测 555/555 都有它）`, async () => {
      const { buildCatalog, ModCatalogBuildError } = await import('./modCatalogBuild');
      const { input, path } = brokenSnapshot((release) => {
        delete release[field];
      });
      assert.throws(
        () => buildCatalog(input),
        (error: unknown) =>
          error instanceof ModCatalogBuildError && error.message.includes(`${path}.${field}`),
      );
    });
  }

  it('★ size 是字符串 ⇒ 抛（**不许**回落成 Number.NaN：它会经 JSON.stringify 变成 null）', async () => {
    const { buildCatalog, ModCatalogBuildError } = await import('./modCatalogBuild');
    const { input, path } = brokenSnapshot((release) => {
      release.size = '22025';
    });
    assert.throws(
      () => buildCatalog(input),
      (error: unknown) =>
        error instanceof ModCatalogBuildError && error.message.includes(`${path}.size`),
    );
  });

  it('★ url 不是能解析的 URL ⇒ 抛**带路径的** ModCatalogBuildError（不是裸 TypeError）', async () => {
    const { buildCatalog, ModCatalogBuildError } = await import('./modCatalogBuild');
    const { input, path } = brokenSnapshot((release) => {
      release.url = '这不是一个 URL';
    });
    assert.throws(
      () => buildCatalog(input),
      (error: unknown) =>
        error instanceof ModCatalogBuildError && error.message.includes(`${path}.url`),
    );
  });

  it('★ 对照组：合法省略的字段仍然不抛（`dependencies` / `obsolete` 的"没有"是常态）', async () => {
    const { buildCatalog } = await import('./modCatalogBuild');
    const { input } = brokenSnapshot((release) => {
      delete release.dependencies;
      delete release.obsolete;
    });
    assert.doesNotThrow(() => buildCatalog(input));
  });
});
