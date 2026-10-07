import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildIndex, type ModCatalog, type ModIndex } from '@mcsr/shared/modCatalog';
import { packDownloadableIn, packInputSchema, packPlanFor } from '@mcsr/shared/modPacks';

/**
 * 造一个最小可用的 index：**走真实的 `buildIndex`**（不手搓 Map —— 手搓会把
 * "键长什么样"这个可能出错的地方从测试里挤出去）。
 * ⚠️ 只填 `buildIndex` 真正读的两个字段（`mods` / `releases`）⇒ 末尾那次 cast 是**有意的**。
 */
function indexOf(input: {
  mods: string[];
  releases: { modid: string; version: string; url: string; targets?: string[]; manual?: boolean }[];
}): ModIndex {
  return buildIndex({
    mods: input.mods.map((modid) => ({ modid, name: modid, tags: [] })),
    releases: input.releases.map((r) => ({
      modid: r.modid,
      version: r.version,
      url: r.url,
      sha1: 'a'.repeat(40),
      sha512: 'b'.repeat(128),
      size: 1,
      targetVersions: r.targets ?? ['1.16.1'],
      dependencies: [],
      obsolete: false,
      intermediary: [],
      download: r.manual === true ? 'manual' : 'auto',
    })),
  } as unknown as ModCatalog);
}

const FOLDER_EMPTY = { recognizedModids: [] as string[] };

describe('★ B2 纯判断：packPlanFor / packDownloadableIn', () => {
  it('① 已经在文件夹里的进 skipped（原因 already-in-folder）', () => {
    const index = indexOf({
      mods: ['sodium', 'lithium'],
      releases: [
        { modid: 'sodium', version: '1.0', url: 'https://x/sodium.jar' },
        { modid: 'lithium', version: '1.0', url: 'https://x/lithium.jar' },
      ],
    });
    const plan = packPlanFor({
      modids: ['sodium', 'lithium'],
      gameVersion: '1.16.1',
      folder: { recognizedModids: ['sodium'] },
      index,
    });
    assert.deepEqual(
      plan.items.map((i) => i.modid),
      ['lithium'],
    );
    assert.deepEqual(plan.skipped, [{ modid: 'sodium', reason: 'already-in-folder' }]);
  });

  it('② 无 release / 多候选 / manual ⇒ 各自进 skipped，且**原因各不同**', () => {
    const index = indexOf({
      mods: ['no-rel', 'two-cand', 'optifine', 'ok'],
      releases: [
        { modid: 'two-cand', version: '1.0', url: 'https://x/a.jar' },
        { modid: 'two-cand', version: '1.1', url: 'https://x/b.jar' },
        { modid: 'optifine', version: '1.0', url: 'https://x/optifine.jar', manual: true },
        { modid: 'ok', version: '1.0', url: 'https://x/ok.jar' },
      ],
    });
    const plan = packPlanFor({
      modids: ['no-rel', 'two-cand', 'optifine', 'ok'],
      gameVersion: '1.16.1',
      folder: FOLDER_EMPTY,
      index,
    });
    assert.deepEqual(
      plan.skipped.map((s) => s.reason),
      ['no-release', 'ambiguous', 'manual'],
    );
    assert.deepEqual(
      plan.items.map((i) => i.modid),
      ['ok'],
    );
  });

  it('③ 一件都没下成时 itemCount 是 0（而不是 modids.length）', () => {
    const index = indexOf({ mods: ['a', 'b'], releases: [] });
    const plan = packPlanFor({
      modids: ['a', 'b'],
      gameVersion: '1.16.1',
      folder: FOLDER_EMPTY,
      index,
    });
    assert.equal(plan.items.length, 0);
    assert.equal(plan.skipped.length, 2);
  });

  it('④ 顺序 = 包的 modids 顺序（不是目录顺序）', () => {
    const index = indexOf({
      mods: ['a', 'm', 'z'],
      releases: [
        { modid: 'a', version: '1.0', url: 'https://x/a.jar' },
        { modid: 'm', version: '1.0', url: 'https://x/m.jar' },
        { modid: 'z', version: '1.0', url: 'https://x/z.jar' },
      ],
    });
    const plan = packPlanFor({
      modids: ['z', 'a', 'm'],
      gameVersion: '1.16.1',
      folder: FOLDER_EMPTY,
      index,
    });
    assert.deepEqual(
      plan.items.map((i) => i.modid),
      ['z', 'a', 'm'],
    );
  });

  it('⑤ 空包 ⇒ items 与 skipped 都空、packDownloadableIn 是 0', () => {
    const index = indexOf({ mods: [], releases: [] });
    const plan = packPlanFor({ modids: [], gameVersion: '1.16.1', folder: FOLDER_EMPTY, index });
    assert.deepEqual(plan.items, []);
    assert.deepEqual(plan.skipped, []);
    assert.equal(
      packDownloadableIn({ modids: [], gameVersion: '1.16.1', folder: FOLDER_EMPTY, index }),
      0,
    );
  });

  it('⑥ ★ 页面看到的可下数与主进程会下的项数**逐位相等**（同一个包 + 同一个文件夹）', () => {
    const index = indexOf({
      mods: ['a', 'b', 'c'],
      releases: [
        { modid: 'a', version: '1.0', url: 'https://x/a.jar' },
        { modid: 'b', version: '1.0', url: 'https://x/b.jar' },
        { modid: 'c', version: '1.0', url: 'https://x/c.jar' },
      ],
    });
    const args = {
      modids: ['a', 'b', 'c'],
      gameVersion: '1.16.1',
      folder: { recognizedModids: ['a'] },
      index,
    };
    assert.equal(packDownloadableIn(args), 2, 'a 已在文件夹里 ⇒ 只剩 2 个可下');
    assert.equal(packDownloadableIn(args), packPlanFor(args).items.length);
  });

  it('⑧ 目录里没有这个 modid ⇒ 原因是 not-in-catalog（与 no-release 是两种不同的原因）', () => {
    const index = indexOf({
      mods: ['ok'],
      releases: [{ modid: 'ok', version: '1.0', url: 'https://x/ok.jar' }],
    });
    const plan = packPlanFor({
      modids: ['ghost', 'ok'],
      gameVersion: '1.16.1',
      folder: FOLDER_EMPTY,
      index,
    });
    assert.deepEqual(plan.skipped, [{ modid: 'ghost', reason: 'not-in-catalog' }]);
    assert.deepEqual(
      plan.items.map((i) => i.modid),
      ['ok'],
    );
  });

  it('⑦ packInputSchema：modids 去重、空数组/65 个/空标题/超长各自不通过', () => {
    const ok = packInputSchema.safeParse({
      title: '平衡包',
      description: '',
      gameVersion: '1.16.1',
      modids: ['a', 'a', 'b'],
    });
    assert.equal(ok.success, true);
    assert.deepEqual(ok.success ? ok.data.modids : null, ['a', 'b'], '存进去的必须是去重后的');
    /* ★ 通过侧：**恰好**落在边界上必须通过 —— 这里用**字面量 64 / 80 / 400**是有意的，
       换成 `MAX_PACK_MODS` 之类的常量，把上限改成 63 这条仍然绿 ⇒ 边界就没被钉住。 */
    const atLimit = (over: { title?: string; description?: string; count?: number }) =>
      packInputSchema.safeParse({
        title: over.title ?? 'x',
        description: over.description ?? '',
        gameVersion: '1.16.1',
        modids: Array.from({ length: over.count ?? 1 }, (_, i) => `m${String(i)}`),
      });
    assert.equal(atLimit({ count: 64 }).success, true, '恰好 64 个互不相同的 modid 必须通过');
    assert.equal(atLimit({ title: 'x'.repeat(80) }).success, true, '恰好 80 个字符的标题必须通过');
    assert.equal(
      atLimit({ description: 'y'.repeat(400) }).success,
      true,
      '恰好 400 个字符的简介必须通过',
    );
    for (const bad of [
      { title: '', description: '', gameVersion: '1.16.1', modids: ['a'] },
      { title: 'x', description: '', gameVersion: '1.16.1', modids: [] },
      {
        title: 'x',
        description: '',
        gameVersion: '1.16.1',
        modids: Array.from({ length: 65 }, (_, i) => `m${String(i)}`),
      },
      { title: 'x'.repeat(81), description: '', gameVersion: '1.16.1', modids: ['a'] },
      { title: 'x', description: 'y'.repeat(401), gameVersion: '1.16.1', modids: ['a'] },
      { title: 'x', description: '', gameVersion: '', modids: ['a'] },
      { title: 'x', description: '', gameVersion: '1.16.1', modids: [''] },
    ]) {
      assert.equal(packInputSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 60));
    }
  });
});
