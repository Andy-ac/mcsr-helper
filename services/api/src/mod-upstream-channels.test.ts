import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FileSourceSchema, type ModrinthVersion } from '@mcsr/shared/fileUpdates';
import {
  MOD_UPSTREAM_CHANNELS,
  ModCatalogStrictSchema,
  ModCatalogWireSchema,
  type ModUpstreamChannel,
  pickLatestUpstreamVersion,
  upstreamChannelsOf,
} from '@mcsr/shared/modCatalog';

/*
 * ★★ 这一条钉的是 2026-10-04 用户要的那件事：**一条 upstream 可以接受多于一个发布通道**。
 *
 * 为什么需要它（现场）：draftout 的最新版（1.17.2）在 Modrinth 上**只发 beta**。
 * 上游解析只认 `release` 时它一个版本都匹配不上 ⇒ 桌面上那句
 * 「上游版本没拿到（draftout）：上游没有匹配的 release」+ 目标退回目录里那条候选。
 *
 * ⚠️★ 为什么断言在这里（`services/api`）而不是 `apps/desktop`：那个包**没有测试运行器**
 *    （只有 typecheck），而 `apps/desktop/src/mod-folder-catalog.ts` 又 `import './file-updates'`
 *    ⇒ 那个文件 `import 'electron'`，从测试进程里根本 import 不动它。
 *    ⇒ 判据落在**纯函数**上（`@mcsr/shared/modCatalog` 的 `upstreamChannelsOf` /
 *      `pickLatestUpstreamVersion`），而桌面端那一侧调用的就是这两个（同一份实现，不是两份）。
 *
 * ⚠️★ 夹具里那三条版本是**故意**造成"接受集一换、答案就变"的形状：
 *      release 5.8.26（2026-10-01）< beta 5.9.0-beta.1（2026-10-02）< alpha 5.9.0-alpha.1（2026-10-03）。
 *    ⇒ "只认 release"与"release + beta"给出的答案不同，而"什么都不筛"的坏实现会挑到 alpha
 *      —— 也就是说这一组读数**同时**钉住了"接受集真的在筛"与"跨通道按日期取最大"。
 *
 * ★ 刀（这一条要能红）：把 `content/mod-overrides.json` 的
 *   `upstream.draftout.channels` 换回 `["release"]`（并按规矩重跑 `catalog:write`）⇒
 *   下面"用**真实配置**那个接受集挑"的那一条红（挑到 5.8.26，而不是 beta）。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/** 一条 Modrinth 版本（只写 `pickLatestVersion` 用得到的字段 + 一个主文件）。 */
function version(
  versionNumber: string,
  versionType: string,
  datePublished: string,
): ModrinthVersion {
  return {
    id: `id-${versionNumber}`,
    version_number: versionNumber,
    version_type: versionType,
    date_published: datePublished,
    game_versions: ['1.16.1'],
    loaders: ['fabric'],
    files: [
      {
        filename: `${versionNumber}.jar`,
        url: `https://cdn.modrinth.com/data/FAKE/versions/${versionNumber}/${versionNumber}.jar`,
        size: 100,
        primary: true,
        hashes: { sha1: 'a'.repeat(40), sha512: 'b'.repeat(128) },
      },
    ],
  };
}

/** 夹具：release 最旧、beta 更新、alpha 最新（见文件头那一段）。 */
const RELEASE = version('5.8.26', 'release', '2026-10-01T00:00:00Z');
const BETA = version('5.9.0-beta.1', 'beta', '2026-10-02T00:00:00Z');
const ALPHA = version('5.9.0-alpha.1', 'alpha', '2026-10-03T00:00:00Z');
const FIXTURE: readonly ModrinthVersion[] = [RELEASE, BETA, ALPHA];

/** 真实配置（`content/mod-overrides.json` 的 `upstream` 那一层）与真实产物（目录里的同名字段）。 */
interface UpstreamEntry {
  provider: string;
  project: string;
  channels?: ModUpstreamChannel[];
}
const overrides = JSON.parse(read('content/mod-overrides.json')) as {
  upstream: Record<string, UpstreamEntry>;
};
const catalogRaw: unknown = JSON.parse(read('content/mod-catalog.json'));
const catalog = catalogRaw as {
  mods: { modid: string; upstream: UpstreamEntry | null }[];
};
const upstreamInCatalog = (modid: string): UpstreamEntry | null =>
  catalog.mods.find((mod) => mod.modid === modid)?.upstream ?? null;

describe('上游接受集（upstream.channels）与"接受集里最新那一版"', () => {
  /*
   * 词汇表那一条：`MOD_UPSTREAM_CHANNELS` 与 `FileSourceSchema.channel` 是**同一份词汇表的
   * 两个副本**（不共用一个 schema 是有理由的：那里单选必填、这里多选可缺省 —— 共用会把
   * v1 那 9 条通道的契约一起放松）。副本就会漂 ⇒ 用这条断言把"它们必须逐字相同"钉住，
   * 而不是靠注释提醒下一个人。
   */
  it('★ 通道词汇表与 `FileSourceSchema.channel` 逐字相同（两个副本不许漂）', () => {
    assert.deepEqual([...MOD_UPSTREAM_CHANNELS], [...FileSourceSchema.shape.channel.options]);
  });

  it('★ 没写 `channels` ⇒ 只认 release（= 加这个字段之前的行为）', () => {
    assert.deepEqual([...upstreamChannelsOf({})], ['release']);
    assert.deepEqual([...upstreamChannelsOf(overrides.upstream.mcsrranked!)], ['release']);
    // 防御性那一支：空数组在严格校验（min(1)）与生成器两处都被拦下，这里也不许变成"什么都不接受"。
    assert.deepEqual([...upstreamChannelsOf({ channels: [] })], ['release']);
  });

  it('★ 只认 release ⇒ 挑中那条 release（更新的 beta **不**参与）', () => {
    const picked = pickLatestUpstreamVersion(FIXTURE, {
      gameVersion: '1.16.1',
      loader: 'fabric',
      channels: ['release'],
    });
    assert.equal(picked?.version_number, '5.8.26');
  });

  it('★★ release + beta ⇒ 更新的 beta 赢（这就是 draftout 要的那一条）', () => {
    const picked = pickLatestUpstreamVersion(FIXTURE, {
      gameVersion: '1.16.1',
      loader: 'fabric',
      channels: ['release', 'beta'],
    });
    assert.equal(picked?.version_number, '5.9.0-beta.1');
    // ⚠️ 第二条印证（§5.38）：上面那个答案**不是**"随便挑了一条"——
    //    夹具里还有一条日期更新的 alpha；没有接受 alpha 却挑到它，就说明"接受集没在筛"。
    assert.equal(picked?.version_type, 'beta');
  });

  it('★ 只认 beta 时 release 不参与（接受集是双向的，不是"release 永远算数"）', () => {
    const picked = pickLatestUpstreamVersion(FIXTURE, {
      gameVersion: '1.16.1',
      loader: 'fabric',
      channels: ['beta'],
    });
    assert.equal(picked?.version_number, '5.9.0-beta.1');
  });

  it('★ 接受集里一条都匹配不上 ⇒ null（**不是**退回别的通道）', () => {
    const picked = pickLatestUpstreamVersion(FIXTURE, {
      gameVersion: '26.3', // 夹具里三条都只声明 1.16.1
      loader: 'fabric',
      channels: ['release', 'beta'],
    });
    assert.equal(picked, null);
  });

  /*
   * ★ 这一条是**配置驱动**的那一半，也是那把刀落下的地方：接受集不是测试里编的，
   *   而是**真实配置**（`mod-overrides.json`）与**真实产物**（`mod-catalog.json`）里的那一份。
   *   ⇒ 谁把 draftout 改回 `["release"]`、或让生成器把 `channels` 丢掉，这里就红。
   */
  it('★★ 真实配置：draftout 接受 release + beta，mcsrranked 不写（= 只认 release）', () => {
    assert.deepEqual([...upstreamChannelsOf(overrides.upstream.draftout!)], ['release', 'beta']);
    // 产物那一侧：生成器必须把这一层**带进目录**（桌面端读的是目录，不是这份人工配置）。
    const draftoutEntry = upstreamInCatalog('draftout');
    assert.ok(draftoutEntry, 'content/mod-catalog.json 里 draftout 必须有 upstream');
    assert.deepEqual([...upstreamChannelsOf(draftoutEntry)], ['release', 'beta']);
    // 反向：没写 `channels` 的条目在产物里**也不该多出这个键**（`--check` 是逐字节比较的）。
    const rankedEntry = upstreamInCatalog('mcsrranked');
    assert.ok(rankedEntry, 'content/mod-catalog.json 里 mcsrranked 必须有 upstream');
    assert.equal('channels' in rankedEntry, false);
    assert.deepEqual([...upstreamChannelsOf(rankedEntry)], ['release']);
  });

  it('★★ 用真实配置那个接受集挑夹具 ⇒ beta 赢（刀：改回 release 这一条红）', () => {
    const picked = pickLatestUpstreamVersion(FIXTURE, {
      gameVersion: '1.16.1',
      loader: 'fabric',
      channels: upstreamChannelsOf(overrides.upstream.draftout!),
    });
    assert.equal(picked?.version_number, '5.9.0-beta.1');
    // 而 mcsrranked 那一份（没写 channels）走的是缺省：只认 release。
    const ranked = pickLatestUpstreamVersion(FIXTURE, {
      gameVersion: '1.16.1',
      loader: 'fabric',
      channels: upstreamChannelsOf(overrides.upstream.mcsrranked!),
    });
    assert.equal(ranked?.version_number, '5.8.26');
  });

  /*
   * 契约那一侧：`channels` **可选**，两套校验（严格 / 宽松）都要吃得下"没写它"的条目 ——
   * 否则"加一个字段"就成了一次破坏性变更（已装出去的桌面版读的是线上那份宽松的）。
   */
  it('★ 严格校验与宽松校验都吃得下仓库里这一份（含 draftout 那一条 channels）', () => {
    for (const schema of [ModCatalogStrictSchema, ModCatalogWireSchema]) {
      assert.equal(schema.safeParse(catalogRaw).success, true);
    }
  });

  it('★ 认不出的通道名 / 空数组会被严格校验拒掉（不是静默接受）', () => {
    const withChannels = (channels: unknown): unknown => ({
      ...catalog,
      mods: catalog.mods.map((mod) =>
        mod.modid === 'draftout'
          ? { ...mod, upstream: { provider: 'modrinth', project: 'x', channels } }
          : mod,
      ),
    });
    assert.equal(ModCatalogStrictSchema.safeParse(withChannels(['release', 'beta'])).success, true);
    assert.equal(ModCatalogStrictSchema.safeParse(withChannels(['releases'])).success, false);
    assert.equal(ModCatalogStrictSchema.safeParse(withChannels([])).success, false);
    // 反向（§5.32①）：把 channels 整个去掉仍然是**合法**的 ⇒ 上面那两条不是"这一份怎么都红"。
    assert.equal(ModCatalogStrictSchema.safeParse(withChannels(undefined)).success, true);
  });
});
