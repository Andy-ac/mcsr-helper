import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseModCatalog } from '@mcsr/shared/modCatalog';
import {
  attributeLegacyBindings,
  batchTargets,
  channelUrl,
  migrateState,
  missingMods,
  planCatalogRows,
  planFolderView,
} from '@mcsr/shared/modFolders';

const HERE = dirname(fileURLToPath(import.meta.url));
/*
 * ⚠️ 深度是**三级**：本文件在 `services/api/src/` ⇒ `'../../..'` 才是仓库根。
 *    写成两级会解析到 `services/content/mod-catalog.json`（不存在），而那种坏法的
 *    现场是 `readFileSync` 报 ENOENT —— 看起来像"夹具坏了"，不像"路径少了一级"。
 *    ⇒ 所以下面那行 `existsSync` 是判据的一部分（AGENTS §5.74：输入在不在要当场说）。
 */
const CATALOG = join(HERE, '../../..', 'content', 'mod-catalog.json');

assert.ok(existsSync(CATALOG), `真目录不在这里（路径写错？）：${CATALOG}`);
const parsed = parseModCatalog(JSON.parse(readFileSync(CATALOG, 'utf8')));
if (!parsed.ok) throw new Error('目录夹具读不出来');
const catalog = parsed.catalog;

test('channelUrl：origin 用原 URL；镜像用 prefix + 原 URL；未登记的主机不给镜像', () => {
  /*
   * ⚠️ release 挂在目录**根**上的 `releases[]`（`mods[]` 里每一条是 mod 元数据，
   *    没有 `releases` 字段 —— 现读 `packages/shared/src/modCatalog.ts` 的 `modEntryShape`）。
   */
  const release = catalog.releases.find((r) => r.url.includes('github.com'))!;
  assert.equal(channelUrl(catalog, release, 'origin'), release.url);
  const mirror = catalog.mirrors[0]!;
  assert.equal(
    channelUrl(catalog, release, { mirrorId: mirror.id }),
    `${mirror.prefix}${release.url}`,
  );
  // 未登记的镜像 id ⇒ null（渲染进程说了一个不存在的镜像，主进程必须拒绝而不是自己拼）
  assert.equal(channelUrl(catalog, release, { mirrorId: '不存在' }), null);
  // 非 GitHub 来源不给镜像（D5）
  const cdn = catalog.releases.find((r) => r.url.includes('cdn.modrinth.com'))!;
  assert.equal(channelUrl(catalog, cdn, { mirrorId: mirror.id }), null);
});

test('★ 目录行：只升不降 —— 本地 5.8.26 / 官方 5.8.22 ⇒ newer 且不进批量', () => {
  /*
   * ⚠️ `bindings` 的键是 **`rowId`（`${modid}|${gameVersion}`）**，不是裸 `modid`
   *    （契约见本文件用的那个接口：`bindings: ReadonlyMap<string, …>; // 键 = rowId`，
   *    状态文件那一侧同理 —— `catalogBindings` 按 `rowId` 键控）。
   *    用裸 modid 当键**这条断言就测不到东西**：那一行根本没绑上 ⇒ `verdict` 是
   *    `unknown`（无绑定的默认值），而 `unknown` 恰好也不是 batchable ——
   *    于是"只升不降"坏掉时它照样绿（§5.32① 那类恒真断言）。
   */
  const rows = planCatalogRows({
    catalog,
    gameVersion: '1.16.1',
    tagFilter: [],
    bindings: new Map([
      [
        'mcsrranked|1.16.1',
        { localPath: 'C:/x/mcsrranked-5.8.26.jar', localVersion: '5.8.26', localSha512: null },
      ],
    ]),
  });
  const row = rows.find((r) => r.modid === 'mcsrranked')!;
  assert.equal(row.rowId, 'mcsrranked|1.16.1', 'rowId 的形状是 <modid>|<gameVersion>');
  assert.equal(row.verdict.kind, 'newer');
  assert.equal(row.batchable, false);
  assert.equal(batchTargets(rows), 0, 'newer 绝不进批量');
});

test('★ manual（OptiFine）连更新按钮都不给：manual = true 且 batchable = false', () => {
  const rows = planCatalogRows({
    catalog,
    gameVersion: '1.16.1',
    tagFilter: [],
    bindings: new Map(),
  });
  const opti = rows.find((r) => r.modid === 'optifine');
  if (opti) {
    assert.equal(opti.manual, true);
    assert.equal(opti.batchable, false);
  }
  // 目录里 1.16.1 没有 optifine 也必须至少有一条 manual 的入口 —— 用 1.7.2 那一对
  const rows172 = planCatalogRows({
    catalog,
    gameVersion: '1.7.2',
    tagFilter: [],
    bindings: new Map(),
  });
  assert.ok(
    rows172.some((r) => r.manual),
    '1.7.2 下必须有 manual 的 optifine',
  );
});

test('★ 多候选 ⇒ ambiguous、列出全部候选、不进批量', () => {
  const rows = planCatalogRows({
    catalog,
    gameVersion: '1.7.2',
    tagFilter: [],
    bindings: new Map(),
  });
  const amb = rows.find((r) => r.modid === 'optifine')!;
  assert.equal(amb.verdict.kind, 'ambiguous');
  assert.ok(amb.candidates.length >= 2);
  assert.equal(amb.batchable, false);
});

test('★ 标签筛选是"与"：只留下同时带全部所选标签的行；标签一个 mod 可以有多个', () => {
  const all = planCatalogRows({
    catalog,
    gameVersion: '1.16.1',
    tagFilter: [],
    bindings: new Map(),
  });
  const someTag = all.find((r) => r.tags.length > 0)!;
  const only = planCatalogRows({
    catalog,
    gameVersion: '1.16.1',
    tagFilter: [someTag.tags[0]!],
    bindings: new Map(),
  });
  assert.ok(only.length <= all.length);
  assert.ok(only.every((r) => r.tags.includes(someTag.tags[0]!)));
  const two = [
    ...someTag.tags,
    ...all.find((r) => r.tags.length > 0 && r.modid !== someTag.modid)!.tags,
  ].slice(0, 2);
  const both = planCatalogRows({
    catalog,
    gameVersion: '1.16.1',
    tagFilter: two,
    bindings: new Map(),
  });
  assert.ok(both.every((r) => two.every((tg) => r.tags.includes(tg))));
});

test('★ 文件夹行：只认 jar 内部 modid；旧副本单列；清单外 mod 单列；无 fabric.mod.json 单列', () => {
  const view = planFolderView({
    catalog,
    folderId: 'f1',
    path: 'D:/x/mods',
    gameVersion: '1.16.1',
    autoUpdate: false,
    pathExists: true,
    scan: [
      { fileName: 'a-1.0.jar', modid: 'antigone', version: '1.0', sha512: null },
      { fileName: 'a-2.0.jar', modid: 'antigone', version: '2.0', sha512: null },
      { fileName: 'junk.jar', modid: null, version: null, sha512: null },
      { fileName: 'unknownmod-1.0.jar', modid: 'not-in-catalog-xyz', version: '1.0', sha512: null },
    ],
  });
  const row = view.rows.find((r) => r.modid === 'antigone')!;
  assert.equal(row.fileName, 'a-2.0.jar', '只把最新的那一份当待更新目标');
  assert.deepEqual(row.oldCopies, ['a-1.0.jar']);
  assert.ok(
    view.unrecognized.some((u) => u.reason === 'no-fabric-meta' && u.fileName === 'junk.jar'),
  );
  assert.ok(
    view.unrecognized.some(
      (u) => u.reason === 'not-in-catalog' && u.fileName === 'unknownmod-1.0.jar',
    ),
  );
});

test('★ 缺失清单 = 该游戏版本清单里的 mod − 已绑定文件夹里命中过的 modid', () => {
  const miss = missingMods({ catalog, gameVersion: '1.16.1', trackedModids: new Set(['sodium']) });
  assert.ok(!miss.some((m) => m.modid === 'sodium'));
  const miss2 = missingMods({ catalog, gameVersion: '1.16.1', trackedModids: new Set() });
  assert.ok(miss2.some((m) => m.modid === 'sodium'));
  assert.ok(miss2.every((m) => m.gameVersion === '1.16.1'));
});

test('★ ambiguous 的行不出现在缺失清单里（没有"该装哪个"的唯一答案）', () => {
  const miss = missingMods({ catalog, gameVersion: '1.7.2', trackedModids: new Set() });
  assert.ok(!miss.some((m) => m.modid === 'optifine'));
});

test('★ 游戏版本未知 ⇒ 该文件夹所有行都是 unknown-version 且不给更新按钮', () => {
  const view = planFolderView({
    catalog,
    folderId: 'f1',
    path: 'D:/x/mods',
    gameVersion: null,
    autoUpdate: false,
    pathExists: true,
    scan: [{ fileName: 'a-2.0.jar', modid: 'antigone', version: '2.0', sha512: null }],
  });
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0]!.verdict.kind, 'unknown-version');
  assert.equal(view.rows[0]!.batchable, false);
});

test('★ 路径不存在 ⇒ 行不出现（绑定保留、界面显示"路径不存在"）', () => {
  const view = planFolderView({
    catalog,
    folderId: 'f1',
    path: 'D:/gone',
    gameVersion: '1.16.1',
    autoUpdate: false,
    pathExists: false,
    scan: [{ fileName: 'a-2.0.jar', modid: 'antigone', version: '2.0', sha512: null }],
  });
  assert.equal(view.pathExists, false);
  assert.deepEqual(view.rows, [], '路径不存在 ⇒ 即便扫到了条目也不给行（没有可更新的目标）');
});

test('★ 遗留的单文件绑定按路径 + modid 归属；在已绑定文件夹里的丢掉并报告；读不出的保留', () => {
  const out = attributeLegacyBindings({
    legacy: [
      { key: 'v1:a', localPath: 'D:/m/a.jar', modid: 'antigone', insideFolderId: null },
      { key: 'v1:b', localPath: 'D:/m/b.jar', modid: 'sodium', insideFolderId: 'f1' }, // 落在已绑定文件夹里
      { key: 'v1:c', localPath: 'D:/gone/c.jar', modid: null, insideFolderId: null }, // 读不出来
    ],
    selectedGameVersion: '1.16.1',
  });
  assert.deepEqual(out.adopt, [{ key: 'v1:a', rowId: 'antigone|1.16.1' }]);
  assert.deepEqual(out.drop, ['v1:b']);
  assert.deepEqual(out.keepUnknown, ['v1:c']);
});

test('★ 状态迁移：v1 → v2 只加字段、不删内容；再跑一次不变（幂等）', () => {
  const v1 = {
    version: 1,
    items: {
      x: {
        localPath: 'C:/a.jar',
        autoUpdate: true,
        localVersion: '1.0',
        localSha512: null,
        lastCheckedAt: null,
        lastUpdateAt: null,
        lastUpdateFrom: null,
        lastUpdateTo: null,
      },
    },
  };
  const v2 = migrateState(v1);
  assert.equal(v2.stateVersion, 2);
  assert.equal(v2.version, 1, 'v1 的 version 字段保留（老客户端读它）');
  assert.deepEqual(v2.items, v1.items);
  assert.deepEqual(v2.catalogBindings, {});
  assert.deepEqual(v2.folders, {});
  assert.equal(v2.prefs.bulkChannel, 'origin');
  assert.equal(v2.prefs.catalogGameVersion, '1.16.1');
  assert.deepEqual(v2.prefs.tagFilter, []);
  assert.deepEqual(migrateState(v2), v2);
});

test('★ 状态迁移：坏输入不抛（返回可写的干净状态，由调用方决定要不要覆盖）', () => {
  for (const bad of [null, 42, 'x', [], { version: 1 }]) {
    const s = migrateState(bad);
    assert.equal(s.stateVersion, 2);
    assert.deepEqual(s.folders, {});
  }
});
