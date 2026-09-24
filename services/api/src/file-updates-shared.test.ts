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
  compareLocalVersions,
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
    if (r.ok) {
      // 逐个字段断言"原样带出来"：只查一个嵌套字段的话，一个**重建 item** 的实现也能过。
      assert.equal(r.catalog.items[0]!.kind, 'mod');
      assert.equal(r.catalog.items[0]!.name, 'MCSR Ranked');
      assert.equal(r.catalog.items[0]!.source.project, 'mcsr-ranked');
    }
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
    // ★ 两个文件、`primary` 在**第二个**上：只有一个文件时"取 files[0]"的实现也答对，
    //   这条断言就成了恒真 —— 判据是"选中了 primary 那一个"，不是"恰好只有一个文件"。
    const twoFiles = version({ version_number: '5.8.26' });
    twoFiles.files = [
      {
        filename: 'mcsrranked-5.8.26-sources.jar',
        url: 'https://cdn.modrinth.com/x/5.8.26-sources.jar',
        size: 12_345,
        hashes: { sha1: 'cc', sha512: 'dd' },
      },
      twoFiles.files[0]!,
    ];
    assert.equal(jarFileNameFor(twoFiles), 'mcsrranked-5.8.26.jar');
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

  it('★ compareLocalVersions：本地多份副本取"版本最高"的那一份（按数字段，不按字符串）', () => {
    /*
     * ⚠️★ 这一条**不是**上游的"最新版"规则（那是 date_published，见上面"回滚发版"那条）：
     *    这里比的是用户目录里两份副本谁更新。字符串序会说 3.0.2 比 3.0.10 新（错），
     *    所以这一组数据是**唯一能咬住"按字符串比"的判据** —— 上游真实序列里就有这一对
     *    （T4 的探针实测过：把 mcsrranked-3.0.10.jar 与 mcsrranked-3.0.2.jar 放进同一个目录，
     *     `bindFolder` 必须绑 3.0.10）。
     */
    assert.ok(compareLocalVersions('3.0.10', '3.0.2') > 0, '3.0.10 比 3.0.2 新（字符串序相反）');
    assert.ok(compareLocalVersions('3.0.2', '3.0.10') < 0);
    assert.ok(compareLocalVersions('5.8.26', '5.8.15') > 0);
    assert.ok(compareLocalVersions('5.8.15', '5.8.22') < 0);
    assert.equal(compareLocalVersions('5.8.22', '5.8.22'), 0);
    // 段数不同：短的按"缺段是空串"处理 ⇒ 5.8 < 5.8.1
    assert.ok(compareLocalVersions('5.8', '5.8.1') < 0);
    // 非数字段退化成字符串序（例如 1.0.0-beta 与 1.0.0-alpha）
    assert.ok(compareLocalVersions('1.0.0-beta', '1.0.0-alpha') > 0);
    assert.equal(compareLocalVersions('1.0.0-beta', '1.0.0-beta'), 0);
  });

  it('needsUpdate：outdated 与 unknown-local 都要更新，current/unbound/missing/unchecked/error 不要', () => {
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
    /*
     * ⚠️ ★ `unchecked`：已绑定、还没拿到过读数 —— 它**不是**"可更新"。
     *    这一条钉的是"没有上游期望值时不许编出一个结论"：把它算进一键更新，
     *    用户点一下就会去更新一个我们**从没读过上游**的条目。
     *    配套的另一半（`unchecked` 与 `error` 是两件不同的事）在 viewFor 那一侧，
     *    `apps/desktop` 没有测试运行器 ⇒ 由 .cache 里的桩 electron 探针覆盖。
     */
    assert.equal(needsUpdate({ kind: 'unchecked', localPath: 'x' }), false);
    assert.equal(needsUpdate({ kind: 'error', message: 'boom' }), false);
  });
});
