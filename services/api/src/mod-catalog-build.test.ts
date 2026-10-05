import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseModCatalog } from '@mcsr/shared/modCatalog';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/**
 * Modrinth 那几份快照（`content/upstream/modrinth-versions-<project>.json`），键 = project。
 *
 * ⚠️ 它是 `buildCatalog` 的**第四样输入**（2026-10-04 加的），与那两份 mc.sr 快照平级：
 *    少给它，凡是引用了 `overrides.modrinthLatest` 的 modid 都会让 `buildCatalog` **抛**
 *    （那是故意的：缺快照 = 仓库坏了，不是"这个 mod 没有 release"）。
 */
function modrinthSnapshots(): Record<string, unknown> {
  const overrides = JSON.parse(read('content/mod-overrides.json')) as {
    modrinthLatest?: Record<string, { project: string }>;
  };
  const projects = [
    ...new Set(Object.values(overrides.modrinthLatest ?? {}).map((entry) => entry.project)),
  ].sort();
  return Object.fromEntries(
    projects.map((project) => [
      project,
      JSON.parse(read(`content/upstream/modrinth-versions-${project}.json`)),
    ]),
  );
}

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
    assert.equal(catalog.mods.length, 71);
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

  it('★ 两条 upstream 都指向 Modrinth（mc.sr 数据滞后的那两个）；别的 mod 一律 null', () => {
    /*
     * ⚠️ 这一条原来写的是"mcsrranked 是**唯一一个**已知 mc.sr 数据滞后的"。
     *    2026-10-04 加了第二条（`draftout`：mc.sr 停在 1.16.0 / 26.1.1，Modrinth 已经到 1.17.2 / 26.3），
     *    ⇒ 断言跟着改成"**恰好这两条**"（而不是只钉一条、把"唯一"留在标题里当一句假话）。
     */
    const catalog = JSON.parse(read('content/mod-catalog.json')) as {
      mods: { modid: string; upstream: unknown }[];
    };
    const withUpstream = catalog.mods
      .filter((mod) => mod.upstream !== null)
      .map((mod) => mod.modid)
      .sort();
    assert.deepEqual(withUpstream, ['draftout', 'mcsrranked']);
    const ranked = catalog.mods.find((m) => m.modid === 'mcsrranked');
    assert.deepEqual(ranked?.upstream, { provider: 'modrinth', project: 'I9W1u5Ac' });
    const draftout = catalog.mods.find((m) => m.modid === 'draftout');
    assert.deepEqual(draftout?.upstream, { provider: 'modrinth', project: 'wNlielYC' });
  });

  it('★ 手工登记的那一条：boardraid 在 mods[] 里、homepage 指官网、而且**一条 release 都没有**', () => {
    /*
     * ★ 这条钉的是"上游不收的 mod 也能被认得"这件事，以及它**有意**的另一半：
     *    没有 release（站点没有稳定产物地址 ⇒ 不能编一个 sha1/sha512 出来）。
     *    为什么"零 release"值得一条断言：`planFolderView` 判"清单外"只看 `mods[]`
     *    （不看有没有 release），而这条记录的**全部价值**就是让 boardraid 的 jar
     *    不再掉进"认不出"那一栏 —— 那一半要是没了，这条记录就白加了。
     */
    const catalog = JSON.parse(read('content/mod-catalog.json')) as {
      mods: { modid: string; homepage?: string; description?: string; tags: string[] }[];
      releases: { modid: string }[];
    };
    const mod = catalog.mods.find((m) => m.modid === 'boardraid');
    assert.ok(mod, 'boardraid 必须在 mods[] 里（否则它的 jar 仍然是"清单外"）');
    assert.equal(mod.homepage, 'https://boardraid.cn/');
    assert.equal(
      mod.description,
      'Same-seed advancement bingo for Minecraft 1.16.1. Race your opponent to the same board.',
    );
    assert.deepEqual(mod.tags, ['extra']);
    assert.equal(
      catalog.releases.some((r) => r.modid === 'boardraid'),
      false,
      'boardraid 不许有 release（没有稳定产物地址 ⇒ 不许编）',
    );
  });

  it('★★ draftout：目录里**只有一条** release，且 targetVersions = 那一条自己的 game_versions', () => {
    /*
     * ★★ 这是 2026-10-04 用户钉的判据（`overrides.modrinthLatest`），三条都在这一条里：
     *    ① 只有一条（最新那条）—— mc.sr 快照给的那条 `1.16.0` 必须**没了**；
     *    ② `targetVersions` = **最新那条 version 自己**的 `game_versions`（这里是 `["26.3"]`），
     *       **不是**项目级那个跨版本并集（实测并集是 `["26.1.1","26.3"]`）；
     *    ③ 数据来源是 Modrinth 的版本列表快照本身（下面现算并集来对照）。
     *
     * ⚠️★ 这一条**能红在哪**（改这几判据之前先看清楚）：
     *    · 把 `latest.gameVersions` 换成"跨所有 version 的并集" ⇒ 第 4、5 个断言红；
     *    · 把"丢掉上游那一条"去掉（两条并存）⇒ 第 1 个断言红；
     *    · 把"按 date_published 取最大"换成"取第一条" ⇒ 换了上游排序就会红
     *      （下面那条"不许依赖返回顺序"就是给它准备的刀）。
     */
    const catalog = JSON.parse(read('content/mod-catalog.json')) as {
      releases: {
        modid: string;
        version: string;
        url: string;
        sha512: string;
        targetVersions: string[];
      }[];
    };
    const mine = catalog.releases.filter((release) => release.modid === 'draftout');
    assert.equal(mine.length, 1, '判据①：只应有一条（最新那条）');
    const only = mine[0]!;
    assert.equal(only.version, '1.17.2');
    assert.deepEqual(only.targetVersions, ['26.3'], '判据②：最新那条 version 自己的 game_versions');

    // 现算"项目级并集"当对照组（它必须**不等于**上面那个读数，否则这条判据什么都没测）。
    const snapshot = JSON.parse(read('content/upstream/modrinth-versions-wNlielYC.json')) as {
      version_number: string;
      game_versions: string[];
      date_published: string;
    }[];
    const union = [...new Set(snapshot.flatMap((v) => v.game_versions))].sort();
    assert.deepEqual(union, ['26.1.1', '26.3'], '并集就是项目级那个字段（跨版本）');
    assert.notDeepEqual(only.targetVersions, union, '并集是用户明确不接受的答案');

    // 而"最新那条"是快照里按 date_published 最大的那一条（不是第一条、也不是最后一条）。
    const latest = [...snapshot]
      .sort((a, b) =>
        a.date_published < b.date_published ? -1 : a.date_published > b.date_published ? 1 : 0,
      )
      .at(-1)!;
    assert.equal(latest.version_number, '1.17.2');
    assert.deepEqual(only.targetVersions, [...latest.game_versions].sort());

    // 产物必须指向 Modrinth 上那一条自己的主文件（字节与 sha512 逐字钉住）。
    assert.equal(
      only.url,
      'https://cdn.modrinth.com/data/wNlielYC/versions/keCFw7dS/draftout-1.17.2.jar',
    );
    assert.equal(
      only.sha512,
      'dbbfeaca3bf2e0acea94305e4534266632b08e354fe707853b84cbe2f393993891d89a0e54363c3944746cccefdcbfaef7b7f2ffe1ceffa8e334546216e369f8',
    );
    assert.equal(
      catalog.releases.some((r) => r.modid === 'draftout' && r.version === '1.16.0'),
      false,
      'mc.sr 快照那条 1.16.0 必须被丢掉（判据①：不是两条并存）',
    );
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
      modrinthVersionsRaw: modrinthSnapshots(),
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
      modrinthVersionsRaw: modrinthSnapshots(),
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

  /*
   * ★★ Ruling 65：把"**目录漂了要红**"做成一条真在门禁里跑的测试。
   *
   * 现场（Task 7 的评审者现读发现的）：`docs/architecture.md` 的内容文件那一行**声称**
   * "手改 `content/mod-catalog.json` 会被下一次 `--check` 判红"，而**没有任何自动化在跑 `--check`**：
   * `catalog:check`（`services/api/package.json`）**不在** `pnpm -w check` 里、仓库**没有 CI**，
   * 而上面那条"可复现"只证明"**两次生成相同**"（`catalogBytes` 返回常量也能通过它）
   * —— 它**从不与提交进仓库的那份字节比**。⇒ "快照与目录不一致"今天不会被任何门禁抓住。
   *
   * 所以这一条把 `--check` 的裁决搬进门禁：**已提交的两份快照 + `content/mod-overrides.json`
   * ⇒ 重新生成的字节必须逐字节等于 `content/mod-catalog.json`**。
   * `source.sha256` 由**快照文件自己的字节**算，且与 CLI 的 `build()` 逐字同形
   * （`readFileSync(…, 'utf8')` 之后哈希那个**字符串**）—— 这样这条测试与 `--check` 是同一件事，
   * 而不是"另一套算法碰巧也绿"。
   *
   * ⚠️ 刻意**不** spawn 子进程、不联网、不嵌套 pnpm（本仓对嵌套 pnpm 有明确禁令：
   *    症状是零输出 + 退出码 −1）。
   *
   * ⚠️ 它红了该怎么办：**不是**把这条断言改成新的读数 —— 那正好会让"目录漂了"重新变成
   *    没人看得见的事（§5.32 的第 ④ 类：读数看着有、其实什么都没测）。
   *    正确动作：① 撤掉对 `content/mod-catalog.json` 的手改；或 ② 跑
   *    `pnpm -F @mcsr/api catalog:write` 重新生成，并先 `git diff content/upstream/`
   *    说清**上游真的改了什么**（快照一刷新，规模读数那条断言也会一起红，那是正确行为）。
   */
  it('★ 重新生成的字节 == 提交进仓库的那份字节（Ruling 65：--check 不在任何门禁里）', async () => {
    const { buildCatalog, catalogBytes } = (await import('./modCatalogBuild')) as {
      buildCatalog: (input: unknown) => unknown;
      catalogBytes: (catalog: unknown) => string;
    };
    const mods = read('content/upstream/mods.json');
    const extra = read('content/upstream/extra.json');
    const sha256 = (data: string | Buffer): string =>
      createHash('sha256').update(data).digest('hex');

    const regenerated = catalogBytes(
      buildCatalog({
        modsRaw: JSON.parse(mods),
        extraRaw: JSON.parse(extra),
        overrides: JSON.parse(read('content/mod-overrides.json')),
        sha256: { mods: sha256(mods), extra: sha256(extra) },
        modrinthVersionsRaw: modrinthSnapshots(),
      }),
    );

    // ⚠️ 比的是**字节**（不是两个大字符串的 deepEqual）：失败时要在消息里给读数与偏移，
    //    而不是把 400 KB 的 diff 倒进测试输出（那会让真正的错因淹没在输出里）。
    const committed = readFileSync(join(ROOT, 'content/mod-catalog.json'));
    const regeneratedBytes = Buffer.from(regenerated, 'utf8');
    const sameLength = committed.length === regeneratedBytes.length;
    const firstDiff = sameLength ? committed.findIndex((b, i) => b !== regeneratedBytes[i]) : -1;
    assert.ok(
      committed.equals(regeneratedBytes),
      `目录**漂了**：由已提交快照 + 人工配置重新生成的是 ${regeneratedBytes.length} 字节` +
        `（sha256=${sha256(regeneratedBytes)}），而 content/mod-catalog.json 是 ${committed.length} 字节` +
        `（sha256=${sha256(committed)}）` +
        `${sameLength ? `，第一个不同的字节在偏移 ${firstDiff}` : '（长度就已经不同）'}。\n` +
        '正确动作：撤掉对 content/mod-catalog.json 的手改，或跑 `pnpm -F @mcsr/api catalog:write` ' +
        '重新生成并先 `git diff content/upstream/` 说清上游改了什么。\n' +
        '⚠️ **不要**把这条断言改成新的读数。',
    );
  });
});

/*
 * Modrinth 那一支的**合成输入**（不依赖那份已提交产物的读数）：
 * 手法与上面的 `brokenSnapshot` 同一套 —— 拿真快照当基线，只动一个变量。
 */
function modrinthInput(mutate: (versions: Record<string, unknown>[]) => void): {
  input: {
    modsRaw: unknown;
    extraRaw: unknown;
    overrides: unknown;
    sha256: { mods: string; extra: string };
    modrinthVersionsRaw: Record<string, unknown>;
  };
} {
  const versions = JSON.parse(read('content/upstream/modrinth-versions-wNlielYC.json')) as Record<
    string,
    unknown
  >[];
  mutate(versions);
  return {
    input: {
      modsRaw: JSON.parse(read('content/upstream/mods.json')),
      extraRaw: JSON.parse(read('content/upstream/extra.json')),
      overrides: JSON.parse(read('content/mod-overrides.json')),
      sha256: { mods: 'a'.repeat(64), extra: 'b'.repeat(64) },
      modrinthVersionsRaw: { wNlielYC: versions },
    },
  };
}

describe('Modrinth 那一支（只取最新一条 / targetVersions 取那一条自己的）', () => {
  const draftoutOf = (catalog: unknown): { version: string; targetVersions: string[] }[] =>
    (
      catalog as { releases: { modid: string; version: string; targetVersions: string[] }[] }
    ).releases.filter((release) => release.modid === 'draftout');

  it('★ 不许依赖返回顺序：把版本列表**倒序** ⇒ 产物逐字节不变', async () => {
    /*
     * 上游换一下排序不该改变产物（`--check` 的地基）。这条同时也是一条**刀**：
     * 把"按 date_published 取最大"改成"取第一条" ⇒ 倒序之后选中的就是**最旧**那条 ⇒ 红。
     */
    const { buildCatalog, catalogBytes } = (await import('./modCatalogBuild')) as {
      buildCatalog: (input: unknown) => unknown;
      catalogBytes: (catalog: unknown) => string;
    };
    const forward = modrinthInput(() => undefined);
    const backward = modrinthInput((versions) => versions.reverse());
    const a = catalogBytes(buildCatalog(forward.input));
    const b = catalogBytes(buildCatalog(backward.input));
    assert.equal(a, b);
    // 阳性对照：倒序那一趟真的把列表动过了（否则上面那句"相等"什么都没测）。
    const reversed = (
      backward.input.modrinthVersionsRaw as { wNlielYC: { version_number: string }[] }
    ).wNlielYC;
    assert.notEqual(reversed[0]!.version_number, '1.17.2');
  });

  it('★★ 判据②按**构建结果**判（不是按已提交产物判）：并集在这里就红', async () => {
    /*
     * ⚠️★ 为什么这条必须存在（§5.32 的第 ④ 类）：上面那条 draftout 断言读的是**已提交的产物**，
     *    把生成器改成"用并集"它**照样绿**（产物没动）—— 只有"重新生成 == 提交的那份"那条会红。
     *    于是"用并集"这个错误做法要在**两步之后**才被抓住（改代码 → 重新生成）。
     *    这一条把判据钉在**构建结果**上：拿真快照喂进去、当场看 `targetVersions` 是什么。
     *    ⇒ 把生成器改成并集 ⇒ **本条直接红**（这就是用户要的那把刀）。
     */
    const { buildCatalog } = (await import('./modCatalogBuild')) as {
      buildCatalog: (input: unknown) => unknown;
    };
    const { input } = modrinthInput(() => undefined);
    const only = draftoutOf(buildCatalog(input))[0]!;
    assert.equal(only.version, '1.17.2');
    assert.deepEqual(only.targetVersions, ['26.3']);

    const versions = (input.modrinthVersionsRaw as { wNlielYC: { game_versions: string[] }[] })
      .wNlielYC;
    const union = [...new Set(versions.flatMap((v) => v.game_versions))].sort();
    assert.deepEqual(union, ['26.1.1', '26.3'], '并集 = 项目级那个跨版本字段');
    assert.notDeepEqual(only.targetVersions, union, '并集是用户明确不接受的答案');
  });

  it('★ 判据③：快照里**一条版本都没有** ⇒ 这个 mod 一条 release 都不产出（也绝不退回并集）', async () => {
    const { buildCatalog } = (await import('./modCatalogBuild')) as {
      buildCatalog: (input: unknown) => unknown;
    };
    const { input } = modrinthInput((versions) => versions.splice(0, versions.length));
    const catalog = buildCatalog(input);
    assert.deepEqual(draftoutOf(catalog), []);
  });

  it('★ 缺快照（project 不在输入里）⇒ 抛，且消息里有 project 与 manualMods 之外的出路', async () => {
    const { buildCatalog, ModCatalogBuildError } = await import('./modCatalogBuild');
    const { input } = modrinthInput(() => undefined);
    const broken = { ...input, modrinthVersionsRaw: {} };
    assert.throws(
      () => buildCatalog(broken),
      (error: unknown) =>
        error instanceof ModCatalogBuildError && error.message.includes('modrinth[wNlielYC]'),
    );
  });

  it('★ `modrinthLatest` 指了一个不在 `mods[]` 里的 modid ⇒ 抛（不许产出一条没有归属的 release）', async () => {
    const { buildCatalog, ModCatalogBuildError } = await import('./modCatalogBuild');
    const { input } = modrinthInput(() => undefined);
    const overrides = JSON.parse(read('content/mod-overrides.json')) as Record<string, unknown>;
    assert.throws(
      () =>
        buildCatalog({
          ...input,
          overrides: {
            ...overrides,
            modrinthLatest: {
              ...(overrides.modrinthLatest as Record<string, unknown>),
              'no-such-mod': {
                project: 'wNlielYC',
                reason: '故意指向一个不存在的 modid（测试用）',
              },
            },
          },
        }),
      (error: unknown) =>
        error instanceof ModCatalogBuildError &&
        error.message.includes('overrides.modrinthLatest.no-such-mod'),
    );
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
    modrinthVersionsRaw: Record<string, unknown>;
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
      modrinthVersionsRaw: modrinthSnapshots(),
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

  it('★ 手工登记的 modid 与上游撞车 ⇒ 抛，并点名是人工配置那一层', async () => {
    /*
     * 为什么值得一条：撞车**本来**也会在产物那一层被抓住（`parseModCatalog` 的
     * "mods[].modid 重复"），但那句话说不清"谁和谁撞了、该去改哪一边"，
     * 而且它要到 `catalog:check` / 测试跑起来才出现。这里当场抛、带上
     * `overrides.manualMods.<modid>` 这个路径（与上面几条同一种话术）。
     */
    const { buildCatalog, ModCatalogBuildError } = await import('./modCatalogBuild');
    const overrides = JSON.parse(read('content/mod-overrides.json')) as Record<string, unknown>;
    const input = {
      modsRaw: JSON.parse(read('content/upstream/mods.json')),
      extraRaw: JSON.parse(read('content/upstream/extra.json')),
      overrides: {
        ...overrides,
        manualMods: {
          mcsrranked: {
            name: '撞车的那一条',
            homepage: 'https://example.invalid/',
            list: 'extra',
            tags: [],
            reason: '故意与上游撞车（测试用）',
          },
        },
      },
      sha256: { mods: 'a'.repeat(64), extra: 'b'.repeat(64) },
      modrinthVersionsRaw: modrinthSnapshots(),
    };
    assert.throws(
      () => buildCatalog(input),
      (error: unknown) =>
        error instanceof ModCatalogBuildError &&
        error.message.includes('overrides.manualMods.mcsrranked'),
    );
  });
});
