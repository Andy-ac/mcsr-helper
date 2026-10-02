import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildIndex,
  judgeRelease,
  needsUpdate,
  parseModCatalog,
  releasesFor,
} from '@mcsr/shared/modCatalog';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
const readJson = (rel: string): unknown => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

interface FixtureJar {
  fileName: string;
  size: number;
  modid: string;
  version: string;
  sha512: string;
}
interface Fixture {
  gameVersion: string;
  jars: FixtureJar[];
  disabled: string[];
}

const fixture = readJson('services/api/src/fixtures/real-mods-folder-1.16.1.json') as Fixture;
const parsed = parseModCatalog(readJson('content/mod-catalog.json'));
assert.ok(parsed.ok, '生成的目录必须通过严格校验，否则这一整个测试都不成立');
const index = buildIndex(parsed.catalog);

/** 对夹具里每个 jar 判一次，返回 `文件名 -> 状态`。 */
function judgeAll(): Map<string, string> {
  const out = new Map<string, string>();
  for (const jar of fixture.jars) {
    const verdict = judgeRelease(
      jar.sha512,
      jar.version,
      releasesFor(index, jar.modid, fixture.gameVersion),
    );
    out.set(jar.fileName, verdict.kind);
  }
  return out;
}

describe('★ 真实 mods 目录（18 个 jar）对生成的目录判定', () => {
  it('夹具本身是自洽的：18 个 jar、2 个被禁用的副本', () => {
    assert.equal(fixture.jars.length, 18);
    assert.equal(fixture.disabled.length, 2);
    assert.equal(
      fixture.jars.every((jar) => jar.sha512.length === 128),
      true,
    );
  });

  /*
   * ⚠️★ 这张表是**实测出来的**（2026-10-02），不是推出来的：
   *    7 个 jar 的 sha512 与官方某条 release 完全相等（same），
   *    9 个更旧（older），1 个比 mc.sr 新（mcsrranked 5.8.26 vs 5.8.22 ⇒ newer），
   *    1 个同版本号不同字节（standardsettings ⇒ different-build）。
   *    它同时是"只升不降"的现场证明：newer 与 different-build 都不进批量。
   */
  it('★★ 每一行的判定都与实测一致', () => {
    assert.deepEqual(Object.fromEntries([...judgeAll()].sort()), {
      'SpeedRunIGT-16.0+1.16.1.jar': 'same',
      'antigone-1.16.1-2.0.0.jar': 'same',
      'antiresourcereload-5.1.0+1.16.1.jar': 'older',
      'atum-2.7.1+1.16-1.16.1.jar': 'older',
      'chunkumulator-1.0.3+MC1.16.1.jar': 'older',
      'krypton-1.16.1-backport-0.1.3-SNAPSHOT+2021-02-20.jar': 'same',
      'lazydfu-0.1.2.jar': 'same',
      'lazystronghold-1.1.3+1.16.1.jar': 'older',
      'lithium-1.0+backport-0.6.7+1.16.1.jar': 'same',
      'mcsrranked-5.8.26.jar': 'newer',
      'sleepbackground-4.1+1.16.1.jar': 'same',
      'sodium-2.5.0+1.16.1.jar': 'older',
      'speedrunapi-2.0+1.16.1.jar': 'older',
      'speedrunapi-2.1+1.16-1.16.1.jar': 'older',
      'standardsettings-2.3+1.16.1.jar': 'different-build',
      'state-output-1.2.0+1.16-1.18.1.jar': 'older',
      'voyager-1.0.1.jar': 'same',
      'worldpreview-6.3.0+1.16.1.jar': 'older',
    });
  });

  it('★★ 只有 9 个进批量更新（older）；newer 与 different-build 一个都不许进', () => {
    const kinds = [...judgeAll().values()];
    assert.equal(kinds.filter((k) => k === 'same').length, 7);
    assert.equal(kinds.filter((k) => k === 'older').length, 9);
    assert.equal(kinds.filter((k) => k === 'newer').length, 1);
    assert.equal(kinds.filter((k) => k === 'different-build').length, 1);

    const bulk = fixture.jars.filter((jar) =>
      needsUpdate(
        judgeRelease(jar.sha512, jar.version, releasesFor(index, jar.modid, fixture.gameVersion)),
      ),
    );
    assert.deepEqual(bulk.map((jar) => jar.modid).sort(), [
      'antiresourcereload',
      'atum',
      'chunkumulator',
      'lazystronghold',
      'sodium',
      'speedrunapi',
      'speedrunapi',
      'state-output',
      'worldpreview',
    ]);
    assert.equal(
      bulk.some((jar) => jar.modid === 'mcsrranked'),
      false,
      'mcsrranked 比 mc.sr 新 ⇒ 不许进批量',
    );
    assert.equal(
      bulk.some((jar) => jar.modid === 'standardsettings'),
      false,
      '同版本号不同字节 ⇒ 要人显式点',
    );
  });

  it('★ 大小写不符的文件名照样命中（匹配只认 jar 内部的 modid）', () => {
    const upper = fixture.jars.find((jar) => jar.fileName.startsWith('SpeedRunIGT'));
    assert.ok(upper);
    assert.equal(releasesFor(index, 'speedrunigt', '1.16.1').length, 1);
    assert.equal(
      judgeRelease(upper.sha512, upper.version, releasesFor(index, 'speedrunigt', '1.16.1')).kind,
      'same',
    );
  });

  it('★ 同一 mod 的两份副本各自判定（2.0 与 2.1 都是 older，官方是 2.2）', () => {
    const both = fixture.jars.filter((jar) => jar.modid === 'speedrunapi');
    assert.equal(both.length, 2);
    for (const jar of both) {
      assert.equal(
        judgeRelease(jar.sha512, jar.version, releasesFor(index, 'speedrunapi', '1.16.1')).kind,
        'older',
      );
    }
  });

  it('★ 夹具里被禁用的副本**不在** jars 里（`.jar.disabled` 不参与判定）', () => {
    assert.equal(
      fixture.jars.some((jar) => jar.fileName.endsWith('.disabled')),
      false,
    );
    assert.equal(
      fixture.disabled.every((name) => name.endsWith('.disabled')),
      true,
    );
  });
});
