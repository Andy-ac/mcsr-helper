/**
 * 「本地文件自动更新」共享层的测试。
 *
 * ⚠️ 为什么这些断言写在 `services/api` 里（而不是 apps/desktop）：
 *    `apps/desktop` **没有测试运行器**（只有 typecheck），本仓唯一的单元测试跑在这里。
 *    所以凡是要写断言的纯逻辑都必须住 `packages/shared`，断言落在本文件。
 * ⚠️ 本文件**不打网络**：Modrinth 的响应全部是内联对象。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compareLocalToLatest,
  isDisabledPath,
  jarFileNameFor,
  type ModrinthVersion,
  needsUpdate,
  parseFileCatalog,
  pickLatestVersion,
} from '@mcsr/shared/fileUpdates';

/** 造一条 Modrinth 版本；默认是 mcsrranked 的真实形状（1.16.1 + fabric + release）。 */
function version(over: Partial<ModrinthVersion> & { version_number: string }): ModrinthVersion {
  return {
    id: `id-${over.version_number}`,
    version_type: 'release',
    date_published: '2026-09-09T09:41:26.430799Z',
    game_versions: ['1.16.1'],
    loaders: ['fabric'],
    files: [
      {
        filename: `mcsrranked-${over.version_number}.jar`,
        url: `https://cdn.modrinth.com/x/${over.version_number}.jar`,
        size: 27_000_000,
        primary: true,
        hashes: { sha1: 'aa', sha512: 'bb' },
      },
    ],
    ...over,
  };
}

describe('目录 JSON 的校验', () => {
  const good = {
    version: 1,
    items: [
      {
        id: 'mcsrranked',
        name: 'MCSR Ranked',
        kind: 'mod',
        source: {
          provider: 'modrinth',
          project: 'mcsr-ranked',
          modId: 'mcsrranked',
          gameVersion: '1.16.1',
          loader: 'fabric',
          channel: 'release',
        },
      },
    ],
  };

  it('合法的目录通过，并把 note 之外的字段原样带出来', () => {
    const r = parseFileCatalog(good);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.catalog.items[0]!.source.project, 'mcsr-ranked');
  });

  it('缺 modId ⇒ 失败，且问题里点名是哪个字段', () => {
    const bad = structuredClone(good);
    // @ts-expect-error 故意删掉必填字段
    delete bad.items[0].source.modId;
    const r = parseFileCatalog(bad);
    assert.equal(r.ok, false);
    if (!r.ok)
      assert.ok(
        r.problems.some((p) => p.includes('modId')),
        `实际问题：${r.problems.join(' / ')}`,
      );
  });

  it('id 重复 ⇒ 失败（重复的表现是状态文件里两条互相当对方的记录，静默错）', () => {
    const dup = { version: 1, items: [good.items[0], good.items[0]] };
    const r = parseFileCatalog(dup);
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.problems.some((p) => p.includes('mcsrranked')));
  });

  it('未知 provider ⇒ 失败（否则以后加了 github，旧桌面版会静默把它当 modrinth 用）', () => {
    const bad = structuredClone(good);
    bad.items[0]!.source.provider = 'github' as 'modrinth';
    assert.equal(parseFileCatalog(bad).ok, false);
  });

  it('items 不是数组 ⇒ 失败而不是抛异常', () => {
    assert.equal(parseFileCatalog({ version: 1, items: {} }).ok, false);
    assert.equal(parseFileCatalog(null).ok, false);
  });
});

describe('挑最新版本', () => {
  const src = { gameVersion: '1.16.1', loader: 'fabric', channel: 'release' } as const;

  // ⚠️ 下面这一条**区分不了**两种实现："5.8.26" > "5.8.25" > "5.8.23" 的字符串序
  //    恰好等于日期序（号大的日期也大），所以"取字符串最大的号"在这里也答 5.8.26。
  //    「按 date_published 取最新」这条规则的**判据不落在它身上**，落在再下面那条
  //    **回滚发版**用例（号更小、日期更新）—— 只有它能把"比版本号"那种实现咬红。
  it('上游真的跳过了号：5.8.26 / 5.8.25 / 5.8.23 乱序给出，结果必须是 5.8.26', () => {
    const vs = [
      version({ version_number: '5.8.23', date_published: '2026-09-17T13:37:30Z' }),
      version({ version_number: '5.8.26', date_published: '2026-09-24T00:33:59Z' }),
      version({ version_number: '5.8.25', date_published: '2026-09-23T10:20:17Z' }),
    ];
    assert.equal(pickLatestVersion(vs, src)?.version_number, '5.8.26');
  });

  it('★ 回滚发版：号更小、日期更新的那一条才是最新（必须按 date_published 取，不许比号）', () => {
    const vs = [
      version({ version_number: '5.8.26', date_published: '2026-09-24T00:33:59Z' }),
      version({ version_number: '5.8.20', date_published: '2026-09-25T08:12:00Z' }),
    ];
    assert.equal(pickLatestVersion(vs, src)?.version_number, '5.8.20');
  });

  it('beta 不算 release（这一期只认 channel 指定的那一档）', () => {
    const vs = [
      version({
        version_number: '5.9.0',
        version_type: 'beta',
        date_published: '2026-09-25T00:00:00Z',
      }),
      version({ version_number: '5.8.26', date_published: '2026-09-24T00:33:59Z' }),
    ];
    assert.equal(pickLatestVersion(vs, src)?.version_number, '5.8.26');
  });

  it('游戏版本或 loader 不匹配的被排除；一个都没有 ⇒ null', () => {
    const vs = [
      version({ version_number: '1.0.0', game_versions: ['1.20.1'] }),
      version({ version_number: '2.0.0', loaders: ['forge'] }),
    ];
    assert.equal(pickLatestVersion(vs, src), null);
  });
});

describe('本地 vs 最新', () => {
  const vs = [
    version({ version_number: '5.8.22' }),
    version({ version_number: '5.8.26', date_published: '2026-09-24T00:33:59Z' }),
  ];
  const latest = vs[1]!;

  it('相等 ⇒ up-to-date', () => {
    assert.equal(compareLocalToLatest('5.8.26', latest, vs), 'up-to-date');
  });

  it('不等且本地在上游列表里 ⇒ outdated', () => {
    assert.equal(compareLocalToLatest('5.8.22', latest, vs), 'outdated');
  });

  it('★ 本地不在上游列表里 ⇒ unknown-local（不是 outdated：把它当 outdated 会把人**降级**）', () => {
    assert.equal(compareLocalToLatest('5.8.22-custom', latest, vs), 'unknown-local');
  });
});

describe('文件名与状态推导', () => {
  it('用上游的文件名（primary 优先；没有 primary 就取第一个）', () => {
    assert.equal(jarFileNameFor(version({ version_number: '5.8.26' })), 'mcsrranked-5.8.26.jar');
    const noPrimary = version({ version_number: '5.8.26' });
    delete noPrimary.files[0]!.primary;
    assert.equal(jarFileNameFor(noPrimary), 'mcsrranked-5.8.26.jar');
    assert.equal(jarFileNameFor(version({ version_number: 'x', files: [] })), null);
  });

  it('.disabled 认得出来（大小写无关）', () => {
    assert.equal(isDisabledPath('C:/m/mcsrranked-5.8.15.jar.disabled'), true);
    assert.equal(isDisabledPath('C:/m/mcsrranked-5.8.22.jar'), false);
    assert.equal(isDisabledPath('C:/m/x.DISABLED'), true);
  });

  it('needsUpdate：outdated 与 unknown-local 都要更新，current/unbound/missing/error 不要', () => {
    const base = { localPath: 'x', localVersion: '5.8.22', latestVersion: '5.8.26' };
    assert.equal(
      needsUpdate({
        kind: 'outdated',
        ...base,
        latestFileName: 'a.jar',
        latestUrl: 'u',
        latestSha512: 's',
        latestSize: 1,
        disabled: false,
      }),
      true,
    );
    assert.equal(
      needsUpdate({
        kind: 'unknown-local',
        ...base,
        latestFileName: 'a.jar',
        latestUrl: 'u',
        latestSha512: 's',
        latestSize: 1,
        disabled: false,
      }),
      true,
    );
    assert.equal(needsUpdate({ kind: 'unbound' }), false);
    assert.equal(
      needsUpdate({
        kind: 'current',
        localPath: 'x',
        localVersion: '5.8.26',
        latestVersion: '5.8.26',
      }),
      false,
    );
    assert.equal(needsUpdate({ kind: 'missing-file', localPath: 'x' }), false);
    assert.equal(needsUpdate({ kind: 'error', message: 'boom' }), false);
  });
});
