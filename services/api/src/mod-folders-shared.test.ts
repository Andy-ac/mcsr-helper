import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { type ModRelease, parseModCatalog, parseModCatalogWire } from '@mcsr/shared/modCatalog';
import {
  attributeLegacyBindings,
  batchTargets,
  type CatalogRowView,
  channelUrl,
  type FolderScanEntry,
  groupFoldersByVersion,
  type ModFoldersState,
  type ModFolderView,
  migrateState,
  missingMods,
  planCatalogRows,
  planFolderView,
  planVersionPage,
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
   *    用裸 modid 当键时那一行**根本没绑上** ⇒ `verdict` 是 `unknown`（无绑定的默认值）：
   *      · `verdict.kind === 'newer'` **会红**（`'unknown' !== 'newer'` —— 当初就是它
   *        把这条夹具缺陷照出来的）；
   *      · 而下面那两条批量断言（`batchable === false` 与 `batchTargets(rows) === 0`）
   *        **照样绿** —— `unknown` 恰好也不进批量 ⇒ 它们测的是"没绑定的默认路径"、
   *        不是"只升不降"（AGENTS §5.32①：读数看着有、其实什么都没测）。
   *    ⇒ 修法是**把键写对**（并顺手把 `rowId` 本身也钉一条断言），不是放宽断言。
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
  /*
   * ⚠️ 原来这里用的是 `optifine|1.16.1` + `if (opti)`，而**实测那一对是 0 条候选** ⇒
   *    那一行根本不在 `rows` 里（`rowsForGameVersion` 只交出非空候选）⇒ 整块是**死测试**，
   *    永远不会执行。换成一个该行真的存在的版本：实测 `optifine|1.12.2` 是**单候选**
   *    （`HD_U_G5[manual]`）—— 这比"多候选 ⇒ ambiguous"更硬：`official` 非空、
   *    `verdict` 走的是单候选分支，而 `batchable === false` **只可能**来自
   *    `download === 'manual'`（不是"没有目标"、也不是"多候选"）。
   */
  const rows = planCatalogRows({
    catalog,
    gameVersion: '1.12.2',
    tagFilter: [],
    bindings: new Map(),
  });
  const opti = rows.find((r) => r.modid === 'optifine')!;
  assert.ok(opti.official !== null, 'optifine|1.12.2 实测单候选，必须有唯一目标');
  assert.equal(opti.official!.download, 'manual');
  assert.equal(opti.manual, true);
  assert.equal(opti.batchable, false);
  // 多候选那一侧（1.7.2 的两个 manual 候选）也必须给出 manual
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
  const tagA = someTag.tags[0]!;
  const only = planCatalogRows({
    catalog,
    gameVersion: '1.16.1',
    tagFilter: [tagA],
    bindings: new Map(),
  });
  assert.ok(only.length <= all.length);
  assert.ok(only.every((r) => r.tags.includes(tagA)));

  /*
   * ★ 第二个标签必须**真的不同**，而且要与 `tagA` **共现**在某个真实行上。
   *
   * 原来这里是 `[...someTag.tags, ...另一个 mod 的 tags].slice(0, 2)`，而在**已提交的
   * 目录**上 1.16.1 的前两个带标签的行是 `antigone[legal]` 与 `antiresourcereload[legal]`
   * ⇒ **`two === ['legal', 'legal']`**（实测）⇒ "与"和"或"在这条断言下**读数相同**
   * （实测：都是 31 行）⇒ 把 `tagFilter.every(...)` 改成 `some(...)` 它**照样绿**，
   * 也就是这条测试抓不到它标题宣称的那个 bug。
   * ⇒ 改成从一个**带 ≥2 个标签的真实行**上取两个不同的共现标签，
   *   并把"两个必须不同"本身写成断言（否则这个夹具缺陷会静默回来）。
   */
  const mate = all.find((r) => r.tags.includes(tagA) && r.tags.some((tg) => tg !== tagA));
  assert.ok(mate, `1.16.1 下必须有"同时带 ${tagA} 与另一个标签"的行，否则"与/或"无法区分`);
  const tagB = mate.tags.find((tg) => tg !== tagA)!;

  const onlyB = planCatalogRows({
    catalog,
    gameVersion: '1.16.1',
    tagFilter: [tagB],
    bindings: new Map(),
  });
  const two = [tagA, tagB];
  assert.notEqual(tagA, tagB, '两个标签必须不同 —— 相同的话"与"和"或"是同一个判据');

  const both = planCatalogRows({
    catalog,
    gameVersion: '1.16.1',
    tagFilter: two,
    bindings: new Map(),
  });
  assert.ok(both.length > 0, '必须至少有一行同时带这两个标签（否则这条断言什么都没测）');
  // ★ 承重的一条：与 ⇒ 交集 < 单标签那一边；改成"或"时并集 ≥ 两边 ⇒ 必红
  assert.ok(
    both.length < only.length,
    `"与"必须真的比单标签窄：both=${both.length} only(${tagA})=${only.length}`,
  );
  assert.ok(
    both.length <= Math.min(only.length, onlyB.length),
    `交集不可能大于任一单标签集合：both=${both.length} only(${tagA})=${only.length} only(${tagB})=${onlyB.length}`,
  );
  // 行级判据（简报原本那一条）：留下来的每一行都必须同时带两个标签。
  // ⚠️ 它排在两条长度断言**之后**是有意的：`assert` 在第一次不满足时就抛，
  //    排前面的话"与/或"那把刀会先撞上它（消息只有一句 "evaluated to a falsy value"），
  //    而长度那两条会报出 `both=31 only(legal)=31` 这种能直接看出"并集"的读数。
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
    hasReading: true,
    scan: [
      { fileName: 'a-1.0.jar', modid: 'antigone', version: '1.0', sha512: null },
      { fileName: 'a-2.0.jar', modid: 'antigone', version: '2.0', sha512: null },
      // ★ 读不出内部版本的那一份：**不许**当主文件（`null` 不是"版本 0"），进旧副本
      { fileName: 'a-no-version.jar', modid: 'antigone', version: null, sha512: null },
      { fileName: 'junk.jar', modid: null, version: null, sha512: null },
      { fileName: 'unknownmod-1.0.jar', modid: 'not-in-catalog-xyz', version: '1.0', sha512: null },
    ],
  });
  const row = view.rows.find((r) => r.modid === 'antigone')!;
  assert.equal(row.fileName, 'a-2.0.jar', '只把最新的那一份当待更新目标');
  assert.deepEqual(
    row.oldCopies,
    ['a-1.0.jar', 'a-no-version.jar'],
    '旧副本按扫描顺序；读不出内部版本的那份也在里面（它没被选成主文件）',
  );
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

test('★★ Critical + Ruling 62②：缺失清单的每一行都带着"主进程会装的那一条 + 是不是 manual"', () => {
  /*
   * ★ 这一条是 2026-10-03 T8 评审判修两条判修的共同落点（`MissingModView` 新增的两格）：
   *   · **Critical**：`manual` 的行**确实会出现在清单里**（1.7.10 的 `optifine` /
   *     `optifine-light` 就是），而 `downloadMissing` 的 `assertNotManual` **必拒**
   *     ⇒ 界面必须有这一格才知道"不给下载按钮"；
   *   · **Ruling 62②**：`release` 是"这条镜像适不适用"的**唯一依据**
   *     ⇒ 它必须与主进程 `downloadMissing` 里那次 `planCatalogRows(...).official`
   *     是**同一条**（所以两处共用 `resolveTarget`、上游表都要传进来）。
   * ⚠️ 实测口径（现读 `content/mod-catalog.json`）：`optifine|1.12.2` 是单候选 manual；
   *    `mcsrranked|1.16.1` 是单候选且**有上游**（这一期的唯一一个）⇒ 上面那半条判据
   *    必须拿它验，否则"release 用目录那条还是上游那条"根本分不出来。
   */
  const manual = missingMods({
    catalog,
    gameVersion: '1.12.2',
    trackedModids: new Set(),
  }).find((m) => m.modid === 'optifine');
  assert.ok(manual !== undefined, 'optifine 在 1.12.2 下要出现在缺失清单里（它确实"缺"）');
  assert.equal(manual.manual, true, 'manual 的行要带 `manual: true`（界面据此不给下载按钮）');
  assert.equal(manual.release.download, 'manual', '而 `release` 就是那条 manual 的 release');

  const auto = missingMods({ catalog, gameVersion: '1.16.1', trackedModids: new Set() }).find(
    (m) => m.modid === 'sodium',
  );
  assert.ok(auto !== undefined, 'sodium 在 1.16.1 下要出现在缺失清单里');
  assert.equal(auto.manual, false, '非 manual 的行 `manual` 必须是 false（否则界面会把它也禁掉）');
  assert.equal(auto.release.download, 'auto');

  /*
   * ★★ 上游那条必须**赢**：`release` 不是"目录里那一条"，而是"主进程会装的那一条"。
   *    ⚠️ 夹具自钉：上游那条的地址与目录那条**必须不同** —— 否则上面那条断言
   *    （`release.version === '99.0.0'`）测不出"用了哪一条"（地址相同的两条是同一个形状）。
   */
  const catalogRanked = catalog.releases.find(
    (r) => r.modid === 'mcsrranked' && r.targetVersions.includes('1.16.1'),
  )!;
  const upstream = {
    ...catalogRanked,
    version: '99.0.0',
    url: 'https://example.invalid/upstream/y.jar',
  };
  assert.notEqual(upstream.url, catalogRanked.url, '夹具自钉：上游那条与目录那条的地址必须不同');
  const ranked = missingMods({
    catalog,
    gameVersion: '1.16.1',
    trackedModids: new Set(),
    upstreamLatest: new Map([['mcsrranked', upstream]]),
  }).find((m) => m.modid === 'mcsrranked');
  assert.ok(ranked !== undefined, 'mcsrranked 在 1.16.1 下要出现在缺失清单里（单候选）');
  assert.equal(
    ranked.release.version,
    '99.0.0',
    '有上游时 `release` 必须是**上游那条**（与 `planCatalogRows` 的 official 同一条）—— ' +
      '拿目录那条去判镜像是否适用，判出来的通道可能被主进程拒',
  );
});

test('★ Ruling 65：`hasReading` 原样进视图（它与 `rows` 是两件事）', () => {
  /*
   * ★ 这条测试**就是 Ruling 65 的那句假话的现场**：扫描失败时 `rows` 也是空的，
   *   而"里面没有可识别的 mod"与"我们没读到"在数据上分不开。
   *   ⇒ 视图必须把"有没有读数"单独说出来（这一格是 `pathExists`、`gameVersion`
   *   之外的第三格边界，不能互相替代）。
   */
  const view = planFolderView({
    catalog,
    folderId: 'f1',
    path: 'D:/x/mods',
    pathExists: true,
    hasReading: false,
    gameVersion: '1.16.1',
    autoUpdate: false,
    scan: [],
  });
  assert.equal(view.hasReading, false);
  assert.deepEqual(view.rows, [], '扫描失败时行也是空的 —— 正是这两件事必须分开的原因');
  assert.deepEqual(view.unrecognized, []);
  assert.equal(view.pathExists, true, '路径在（与"读到过"是两件事：路径不在时也可能有旧读数）');
  const read = planFolderView({
    catalog,
    folderId: 'f1',
    path: 'D:/x/mods',
    pathExists: true,
    hasReading: true,
    gameVersion: '1.16.1',
    autoUpdate: false,
    scan: [],
  });
  assert.equal(read.hasReading, true, '对照：读到过（哪怕里面一个 jar 都没有）');
  assert.deepEqual(read.rows, [], '两边的 rows 都是空的 —— 分得开它们的**只有** hasReading');
});

test('★ 游戏版本未知 ⇒ 该文件夹所有行都是 unknown-version 且不给更新按钮', () => {
  /*
   * ★★ `upstreamLatest` **必须在这里传上**，否则这条测试证明不了它标题说的那件事：
   *    不传 map 时"删掉那道短路"与"留着"都会退化成 `resolveTarget([], null)`，
   *    结果一模一样（实测：删掉短路 ⇒ 全绿）—— 也就是说那两条断言**打不红**。
   *    只有让上游真的**可取**时，"未知版本不拿它当目标"才是一个可观测的差别。
   *    上游那条故意取一个**比本地新**的版本号（`9.9.9`，`auto`）：短路/门控一旦失效，
   *    这一行会立刻变成 `older` + 可更新 —— 下面四条断言会同时红。
   */
  const antigone = catalog.releases.find((r) => r.modid === 'antigone')!;
  const view = planFolderView({
    catalog,
    folderId: 'f1',
    path: 'D:/x/mods',
    gameVersion: null,
    autoUpdate: false,
    pathExists: true,
    hasReading: true,
    scan: [{ fileName: 'a-2.0.jar', modid: 'antigone', version: '2.0', sha512: null }],
    upstreamLatest: new Map([['antigone', { ...antigone, version: '9.9.9' }]]),
  });
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0]!.verdict.kind, 'unknown-version');
  assert.equal(view.rows[0]!.batchable, false);
  /*
   * ⚠️ 未知版本**不查上游** ⇒ 没有目标 ⇒ 来源只能是 `'catalog'`（spec §8：
   *    "未选之前所有行都是 unknown-version、不给更新按钮"）。上游那条是"上游最新版"，
   *    与这个文件夹是哪个游戏版本无关 ⇒ 拿它驱动更新就是替用户猜版本。
   *    实现上这一支走的是 `resolveTarget([], null)`（Ruling 18.3），而 Ruling 17 的
   *    "唯一候选"门控对空候选给出同一个结果 —— 两道表达、同一个结论。
   */
  assert.equal(view.rows[0]!.targetSource, 'catalog');
  assert.equal(view.rows[0]!.official, null);
  assert.deepEqual(view.rows[0]!.candidates, []);
});

test('★ 路径不存在 ⇒ 行不出现（绑定保留、界面显示"路径不存在"）', () => {
  const view = planFolderView({
    catalog,
    folderId: 'f1',
    path: 'D:/gone',
    gameVersion: '1.16.1',
    autoUpdate: false,
    pathExists: false,
    /*
     * ⚠️ 这一格是 `true`：这份 `scan` 非空 ⇒ 说明**读到过**（读数还在缓存里），
     *    只是目录现在不在了。"`hasReading: false` + 非空 `entries`"在真实代码里
     *    **不可能出现**（扫描失败那一支配的是空 `entries`）⇒ 夹具不许造一个不存在的形状。
     */
    hasReading: true,
    scan: [
      { fileName: 'a-2.0.jar', modid: 'antigone', version: '2.0', sha512: null },
      // ★ 这个条目在这里是**判据的一部分**：它证明"清掉 unrecognized"不是因为扫到的都是可识别的
      { fileName: 'junk.jar', modid: null, version: null, sha512: null },
    ],
  });
  assert.equal(view.pathExists, false);
  assert.deepEqual(view.rows, [], '路径不存在 ⇒ 即便扫到了条目也不给行（没有可更新的目标）');
  /*
   * ★ 偏离简报一处（钉住它）：简报只写了 `rows` 为空，我把 `unrecognized` 也一起清掉 ——
   *   目录已经不在了，却还列着"清单外 mod / 无 fabric.mod.json"会让人对着一个不存在的
   *   路径看。上面那个 `junk.jar` 就是为这一条准备的（没有它，这条断言会与"扫到的
   *   本来就都是可识别的"混在一起，分不出来）。
   */
  assert.deepEqual(view.unrecognized, [], '路径不存在 ⇒ "无法识别"那一栏也一起为空');
});

test('★ 遗留的单文件绑定按路径 + modid 归属；在已绑定文件夹里的丢掉并报告；读不出的保留', () => {
  const out = attributeLegacyBindings({
    legacy: [
      { key: 'v1:a', localPath: 'D:/m/a.jar', modid: 'antigone', insideFolderId: null },
      { key: 'v1:b', localPath: 'D:/m/b.jar', modid: 'sodium', insideFolderId: 'f1' }, // 落在已绑定文件夹里
      { key: 'v1:c', localPath: 'D:/gone/c.jar', modid: null, insideFolderId: null }, // 读不出来
      /*
       * ★ 这一条钉的是**判据的顺序**：`modid === null` **且**落在文件夹里。
       *   两个分支都对它"有话说"（`keepUnknown` 与 `drop` 都能收它）⇒ 只断言 v1:b/v1:c
       *   的话，"把两个 if 调个位置"这种坏法测不出来（§13.1 只按路径判 ⇒ 必须 drop）。
       */
      { key: 'v1:d', localPath: 'D:/m/d.jar', modid: null, insideFolderId: 'f1' },
    ],
    selectedGameVersion: '1.16.1',
  });
  assert.deepEqual(out.adopt, [{ key: 'v1:a', rowId: 'antigone|1.16.1' }]);
  assert.deepEqual(out.drop, ['v1:b', 'v1:d'], '落在已绑定文件夹里的一律 drop（先按路径判）');
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
  /*
   * ★ Ruling 37（2026-10-03 判修）：迁移出来的这一份**不许**声称"用户选过游戏版本"。
   *   它如果默认成 `true`，主进程就再也不会去采纳已绑定文件夹推断出的版本
   *   （spec §6.8 的默认值）—— 全新安装的机器会永远停在 `1.16.1`。
   */
  assert.equal(v2.prefs.catalogGameVersionChosen, false);
  assert.deepEqual(v2.prefs.tagFilter, []);
  assert.deepEqual(migrateState(v2), v2);
  /*
   * ★ v2 的早返回是**原样返回**（不重建、不剥未知键）：将来往 v2 里加字段时，
   *   重建会把新字段**静默剥掉**。用一个"未来字段"把这条钉住 ——
   *   少了它，把早返回写成"重新拼一份干净的 v2"这种坏法**全套断言照样绿**。
   */
  assert.deepEqual(
    migrateState({ ...v2, future: 1 }),
    { ...v2, future: 1 },
    'stateVersion === 2 ⇒ 原样返回（不认识的键也要活着）',
  );
});

test('★ 状态迁移：坏输入不抛（返回可写的干净状态，由调用方决定要不要覆盖）', () => {
  for (const bad of [null, 42, 'x', [], { version: 1 }]) {
    const s = migrateState(bad);
    assert.equal(s.stateVersion, 2);
    assert.deepEqual(s.folders, {});
  }
});

test('★ older + auto ⇒ 真的进批量（`batchable` 与 `batchTargets` 的自增分支必须被执行）', () => {
  /*
   * ⚠️ 这是**唯一**会走到 `batchable === true` 的断言，而它必须存在：
   *    在它之前，每一条绑定给的都是 `newer`（或压根没绑）⇒ `batchTargets` 的
   *    `count + 1` 那一支从未执行 ⇒ 下面三种坏法**全套断言照样绿**：
   *      · 把 `batchable` 写死成 `false`；
   *      · 把 `needsUpdate(verdict)` 换成自己写的 `verdict.kind === 'older'`；
   *      · **整个删掉**那次 `needsUpdate` 调用。
   *    而"不许自己重写判据、必须调 `needsUpdate`"正是本任务被单独点名的全局约束。
   * 实测：`antigone|1.16.1` 是单候选 `2.0.0[auto]`；本地 `1.0.0` ⇒ 主体 `1.0.0 < 2.0.0`
   * ⇒ `older`；候选是 `auto` ⇒ 进批量。
   */
  const rows = planCatalogRows({
    catalog,
    gameVersion: '1.16.1',
    tagFilter: [],
    bindings: new Map([
      [
        'antigone|1.16.1',
        { localPath: 'D:/x/mods/a-1.0.0.jar', localVersion: '1.0.0', localSha512: null },
      ],
    ]),
  });
  const row = rows.find((r) => r.modid === 'antigone')!;
  assert.equal(row.verdict.kind, 'older');
  assert.equal(row.manual, false);
  assert.equal(row.batchable, true, 'older + download=auto 是进批量的唯一组合');
  assert.equal(batchTargets(rows), 1, '其余行没有绑定 ⇒ unknown ⇒ 一个都不进批量');
});

test('★ 上游解析：传了 `upstreamLatest` ⇒ 目标换成上游那条（`candidates` 仍来自目录）', () => {
  /*
   * spec §7.2 / D1：`mod.upstream != null` 时**目标 = 上游解析的那条**。
   * 实测：只有 `mcsrranked` 有 `upstream`（`modrinth:I9W1u5Ac`），而目录给它的是
   * `5.8.22`（`mcsrranked|1.16.1` 实测只有这一条候选）。⇒ 本地 `5.8.24` 时，
   * **目录**会说"你比 5.8.22 新"（D1：不许降级），只有**上游**知道它其实是旧的。
   */
  const ranked = catalog.releases.find((r) => r.modid === 'mcsrranked')!;
  const upstream = { ...ranked, version: '5.8.26' };
  const rows = planCatalogRows({
    catalog,
    gameVersion: '1.16.1',
    tagFilter: [],
    bindings: new Map([
      [
        'mcsrranked|1.16.1',
        { localPath: 'C:/x/mcsrranked-5.8.24.jar', localVersion: '5.8.24', localSha512: null },
      ],
    ]),
    upstreamLatest: new Map([['mcsrranked', upstream]]),
  });
  const row = rows.find((r) => r.modid === 'mcsrranked')!;
  assert.equal(row.official?.version, '5.8.26', '目标 = 上游那条');
  assert.equal(row.targetSource, 'upstream', '界面必须能"读"出来源，不许靠推断');
  assert.equal(row.verdict.kind, 'older', '对**上游**判：5.8.24 < 5.8.26');
  assert.equal(row.batchable, true);
  assert.equal(row.manual, false);
  // ★ `candidates` **不受上游影响**（界面要能显示"这条来自目录"）
  assert.deepEqual(
    row.candidates.map((r) => r.version),
    ['5.8.22'],
    '候选仍然只来自目录',
  );
});

test('★ 上游解析：没传 ⇒ 目标仍是目录那条（D1：本地比目录新就不许降级）', () => {
  // 与上一条**同一个本地版本** `5.8.24`（受控对照）：只差"传没传上游"。
  const rows = planCatalogRows({
    catalog,
    gameVersion: '1.16.1',
    tagFilter: [],
    bindings: new Map([
      [
        'mcsrranked|1.16.1',
        { localPath: 'C:/x/mcsrranked-5.8.24.jar', localVersion: '5.8.24', localSha512: null },
      ],
    ]),
  });
  const row = rows.find((r) => r.modid === 'mcsrranked')!;
  assert.equal(row.official?.version, '5.8.22', '没传上游 ⇒ 目标 = 目录里唯一那条候选');
  assert.equal(row.targetSource, 'catalog');
  assert.equal(row.verdict.kind, 'newer', '本地 5.8.24 > 目录 5.8.22');
  assert.equal(row.batchable, false, 'newer 绝不进批量（D1）');
});

test('★ 文件夹行也吃上游解析（Ruling 14）：传了 ⇒ 目标换成上游那条、targetSource=upstream', () => {
  /*
   * ⚠️ 这一条的存在理由就是 Ruling 14 的现场：两个 planner 面对的是**同一个**
   *    `(modid, 游戏版本)`。只有第一部分收上游时，`mcsrranked`（本地 5.8.24、
   *    目录 5.8.22）会出现"第一部分说能更新到上游的 5.8.26、第二部分说你比 5.8.22 新
   *    ⇒ 不给更新按钮" —— 同一个 mod、同一版，两个栏目说法不一致。
   */
  const ranked = catalog.releases.find((r) => r.modid === 'mcsrranked')!;
  const upstream = { ...ranked, version: '5.8.26' };
  const view = planFolderView({
    catalog,
    folderId: 'f1',
    path: 'D:/x/mods',
    pathExists: true,
    hasReading: true,
    gameVersion: '1.16.1',
    autoUpdate: false,
    scan: [
      { fileName: 'mcsrranked-5.8.24.jar', modid: 'mcsrranked', version: '5.8.24', sha512: null },
    ],
    upstreamLatest: new Map([['mcsrranked', upstream]]),
  });
  const row = view.rows.find((r) => r.modid === 'mcsrranked')!;
  assert.equal(row.targetSource, 'upstream');
  assert.equal(row.official?.version, '5.8.26', '目标 = 上游那条');
  assert.equal(row.verdict.kind, 'older', '按**目标**判：5.8.24 < 5.8.26');
  assert.equal(row.batchable, true);
  assert.deepEqual(
    row.candidates.map((r) => r.version),
    ['5.8.22'],
    '候选仍然只来自目录',
  );
});

test('★ 文件夹行：没传上游 ⇒ 目标仍是目录那条、targetSource=catalog', () => {
  // 与上一条**同一个本地版本** `5.8.24`（受控对照）：只差"传没传上游"。
  const view = planFolderView({
    catalog,
    folderId: 'f1',
    path: 'D:/x/mods',
    pathExists: true,
    hasReading: true,
    gameVersion: '1.16.1',
    autoUpdate: false,
    scan: [
      { fileName: 'mcsrranked-5.8.24.jar', modid: 'mcsrranked', version: '5.8.24', sha512: null },
    ],
  });
  const row = view.rows.find((r) => r.modid === 'mcsrranked')!;
  assert.equal(row.targetSource, 'catalog');
  assert.equal(row.official?.version, '5.8.22');
  assert.equal(row.verdict.kind, 'newer');
  assert.equal(row.batchable, false);
});

test('★ 只升不降在第二部分同样成立：上游那条比**本地**旧 ⇒ newer、不进批量', () => {
  /*
   * ⚠️ 方向断言：第二部分的判据是"**本地** sha512/版本 vs 目标"，所以上游解析
   *    **不会**把"本地更新"变成"该替换" —— 本地 5.8.26 / 上游 5.8.25 ⇒ `newer`、
   *    `batchable === false`（D1：本地更新只提示、绝不替换）。
   *    少了这一条，"加了上游之后第二部分会不会顺手降级"就没有任何断言在管。
   */
  const ranked = catalog.releases.find((r) => r.modid === 'mcsrranked')!;
  const upstream = { ...ranked, version: '5.8.25' };
  const view = planFolderView({
    catalog,
    folderId: 'f1',
    path: 'D:/x/mods',
    pathExists: true,
    hasReading: true,
    gameVersion: '1.16.1',
    autoUpdate: false,
    scan: [
      { fileName: 'mcsrranked-5.8.26.jar', modid: 'mcsrranked', version: '5.8.26', sha512: null },
    ],
    upstreamLatest: new Map([['mcsrranked', upstream]]),
  });
  const row = view.rows.find((r) => r.modid === 'mcsrranked')!;
  assert.equal(row.targetSource, 'upstream');
  assert.equal(row.official?.version, '5.8.25');
  assert.equal(row.verdict.kind, 'newer', '本地 5.8.26 > 目标 5.8.25');
  assert.equal(row.batchable, false, '本地更新绝不进批量（只升不降）');
});

test('★ Ruling 16：上游目标是 `manual` ⇒ 两个 planner 都说 manual（都不给更新按钮）', () => {
  /*
   * ⚠️ 这一条钉的是"**同一个 mod 两处不一致**的下一次现身"：第一部分跟目标、第二部分
   *    跟候选的话，上游那条是 `manual` 时一处不给按钮、另一处给。这条规则现在两个
   *    planner **共用 `isManualTarget`**（Ruling 16）。今天的数据到不了（上游夹具是
   *    `auto`）⇒ 夹具里把上游那条改成 `manual`。
   */
  const ranked = catalog.releases.find((r) => r.modid === 'mcsrranked')!;
  const upstreamLatest = new Map([
    ['mcsrranked', { ...ranked, version: '5.8.26', download: 'manual' as const }],
  ]);
  const scan = [
    { fileName: 'mcsrranked-5.8.24.jar', modid: 'mcsrranked', version: '5.8.24', sha512: null },
  ];

  const catalogRow = planCatalogRows({
    catalog,
    gameVersion: '1.16.1',
    tagFilter: [],
    bindings: new Map(),
    upstreamLatest,
  }).find((r) => r.modid === 'mcsrranked')!;
  const folderRow = planFolderView({
    catalog,
    folderId: 'f1',
    path: 'D:/x/mods',
    pathExists: true,
    hasReading: true,
    gameVersion: '1.16.1',
    autoUpdate: false,
    scan,
    upstreamLatest,
  }).rows.find((r) => r.modid === 'mcsrranked')!;

  for (const row of [catalogRow, folderRow]) {
    assert.equal(row.targetSource, 'upstream');
    assert.equal(row.official?.download, 'manual');
    assert.equal(row.manual, true, '目标自己就是 manual ⇒ 只给"打开原网页"');
    assert.equal(row.batchable, false);
  }
});

test('★ Ruling 17①：0 条候选 + 有上游 ⇒ 仍然是"没有目标、不可更新"（spec §8）', () => {
  /*
   * 实测：`optifine|1.16.1` 有 **0** 条候选。不把上游门控在"唯一候选"之下的话，
   * 这一行会拿到上游目标 ⇒ `older` + `batchable true` ⇒ 界面上出现一个
   * "清单里根本没有它、却给更新按钮"的行（与 spec §8 的 `missing-release` 冲突）。
   * 上游那条故意给一个**比本地新**的版本号（`2.0` vs 本地 `1.0`）：不门控时下面几条会红。
   */
  const optifine = catalog.releases.find((r) => r.modid === 'optifine')!;
  const view = planFolderView({
    catalog,
    folderId: 'f1',
    path: 'D:/x/mods',
    pathExists: true,
    hasReading: true,
    gameVersion: '1.16.1',
    autoUpdate: false,
    scan: [{ fileName: 'optifine-1.0.jar', modid: 'optifine', version: '1.0', sha512: null }],
    upstreamLatest: new Map([
      ['optifine', { ...optifine, version: '2.0', download: 'auto' as const }],
    ]),
  });
  const row = view.rows.find((r) => r.modid === 'optifine')!;
  assert.deepEqual(row.candidates, [], '这一版下目录里没有它的候选');
  assert.equal(row.targetSource, 'catalog');
  assert.equal(row.official, null);
  assert.equal(row.verdict.kind, 'missing-release');
  assert.equal(row.batchable, false);
});

test('★ Ruling 17②：多候选 + 有上游 ⇒ 仍然 `ambiguous`（不许自动替用户选一个）', () => {
  /*
   * 实测 `optifine|1.7.2` 有 2 条候选（两个都 `manual`）。不门控上游的话，这一行会被
   * 单候选分支判掉 ⇒ `ambiguous` **不可达** —— 而 spec §8 要求多候选"列出全部候选、
   * 要求用户明确选"：自动替用户选一个正是这一期一直在拒绝的事。两个 planner 都钉。
   */
  const optifine = catalog.releases.find((r) => r.modid === 'optifine')!;
  const upstreamLatest = new Map([
    ['optifine', { ...optifine, version: '2.0', download: 'auto' as const }],
  ]);
  const scan = [{ fileName: 'optifine-1.0.jar', modid: 'optifine', version: '1.0', sha512: null }];

  const catalogRow = planCatalogRows({
    catalog,
    gameVersion: '1.7.2',
    tagFilter: [],
    bindings: new Map(),
    upstreamLatest,
  }).find((r) => r.modid === 'optifine')!;
  const folderRow = planFolderView({
    catalog,
    folderId: 'f1',
    path: 'D:/x/mods',
    pathExists: true,
    hasReading: true,
    gameVersion: '1.7.2',
    autoUpdate: false,
    scan,
    upstreamLatest,
  }).rows.find((r) => r.modid === 'optifine')!;

  for (const row of [catalogRow, folderRow]) {
    assert.equal(row.candidates.length, 2, '两个候选都要列出来');
    assert.equal(row.targetSource, 'catalog');
    assert.equal(row.official, null);
    assert.equal(row.verdict.kind, 'ambiguous');
    assert.equal(row.batchable, false);
  }
  assert.equal(catalogRow.manual, true, '两个候选都 manual ⇒ 只给"打开原网页"');
});

test('★ Ruling 18.1：上游那条与目录那条**版本号相同** ⇒ 来源仍是 `upstream`（来源是数据）', () => {
  /*
   * ⚠️ 这一条把"来源是**数据**、不是推断"钉住：如果实现用"版本号不同 ⇒ 上游"这种推断，
   *    版本号**相同**时它必然报 `'catalog'`。而实际上 `official` 是上游那个对象
   *    （字节不同：这里把上游那条的 sha512 换掉）⇒ 只有真把来源当字段记下来才对。
   */
  const antigone = catalog.releases.find((r) => r.modid === 'antigone')!;
  const upstream = { ...antigone, sha512: 'f'.repeat(128) };
  const row = planCatalogRows({
    catalog,
    gameVersion: '1.16.1',
    tagFilter: [],
    bindings: new Map(),
    upstreamLatest: new Map([['antigone', upstream]]),
  }).find((r) => r.modid === 'antigone')!;

  assert.equal(row.candidates.length, 1);
  assert.equal(row.candidates[0]!.version, upstream.version, '两个来源的版本号一样');
  assert.notEqual(row.candidates[0]!.sha512, upstream.sha512, '但字节不同 ⇒ 能分辨用的是哪一条');
  assert.equal(row.targetSource, 'upstream');
  assert.equal(row.official?.sha512, upstream.sha512, 'official 就是上游那条');
});

test('★ Ruling 18.2：同一份入参下，两个 planner 必须解析出**同一个**目标与来源', () => {
  /*
   * 直接钉住 Ruling 14 那条不变量：同一个 `(modid, 游戏版本)` + 同一份 `upstreamLatest`。
   * ⚠️ 两边给**同一个本地读数**（目录行绑同一份 `1.0` 的 jar、文件夹扫到同一份），否则
   *    `verdict` 会因为"本地读数不同"而合理地不同 —— 那测的就不是这条不变量了
   *    （第一版就是漏了绑定，`'older' !== 'unknown'`）。
   */
  const antigone = catalog.releases.find((r) => r.modid === 'antigone')!;
  const upstreamLatest = new Map([['antigone', { ...antigone, version: '3.0.0' }]]);
  const catalogRow = planCatalogRows({
    catalog,
    gameVersion: '1.16.1',
    tagFilter: [],
    bindings: new Map([
      [
        'antigone|1.16.1',
        { localPath: 'D:/x/mods/a-1.0.jar', localVersion: '1.0', localSha512: null },
      ],
    ]),
    upstreamLatest,
  }).find((r) => r.modid === 'antigone')!;
  const folderRow = planFolderView({
    catalog,
    folderId: 'f1',
    path: 'D:/x/mods',
    pathExists: true,
    hasReading: true,
    gameVersion: '1.16.1',
    autoUpdate: false,
    scan: [{ fileName: 'a-1.0.jar', modid: 'antigone', version: '1.0', sha512: null }],
    upstreamLatest,
  }).rows.find((r) => r.modid === 'antigone')!;

  assert.equal(catalogRow.targetSource, 'upstream');
  assert.equal(folderRow.targetSource, catalogRow.targetSource);
  assert.deepEqual(folderRow.official, catalogRow.official);
  assert.equal(folderRow.official?.version, '3.0.0');
  assert.equal(catalogRow.official?.version, '3.0.0');
  assert.equal(
    folderRow.verdict.kind,
    catalogRow.verdict.kind,
    '同一个目标 + 同一个本地读数 ⇒ 同一个判定',
  );
  assert.equal(folderRow.batchable, catalogRow.batchable);
});

test('★ 标签显示名：目录里没有这个名字时**退化成 key 本身**，且与 `tags` 逐位对应', () => {
  /*
   * 简报的断言里**一条都没读 `tagLabels` 的内容**，而"退化成 key"这一支在**已提交的
   * 目录上到不了**（实测：8 个用到的标签全都有显示名 —— accessibility / extra / legal /
   * mac-only / obsolete / ranked / rsg-only / ssg-only）⇒ 只能用一份**合成的最小目录**
   * 造一个没有显示名的标签。
   * 走 `parseModCatalogWire`（线上那一侧）：它**不跑**跨字段检查，所以"标签缺显示名"
   * 能通过；严格那一侧（`parseModCatalog`）会当场拒绝整份目录（那正是服务端的义务）。
   */
  const synthetic = parseModCatalogWire({
    schema: 2,
    source: {
      urls: {
        mods: 'https://meta.mc.sr/schema-7/mods.json',
        extra: 'https://meta.mc.sr/schema-7/extra.json',
      },
      schemaVersion: 7,
      sha256: { mods: 'a'.repeat(64), extra: 'b'.repeat(64) },
    },
    mirrors: [],
    tagLabels: { legal: { zh: '合法', en: 'Legal' } },
    mods: [
      {
        modid: 'synthetic',
        name: 'Synthetic',
        list: 'legal',
        tags: ['legal', '没有显示名的标签'],
        traits: [],
        obsolete: false,
        incompatibilities: [],
        upstream: null,
      },
    ],
    releases: [
      {
        modid: 'synthetic',
        version: '1.0',
        url: 'https://github.com/example/synthetic/releases/download/v1.0/synthetic-1.0.jar',
        sha1: 'a'.repeat(40),
        sha512: 'b'.repeat(128),
        size: 1,
        targetVersions: ['1.16.1'],
        dependencies: [],
        obsolete: false,
        intermediary: [],
        download: 'auto',
      },
    ],
  });
  assert.ok(
    synthetic.ok,
    `合成目录必须合法：${JSON.stringify(synthetic.ok ? [] : synthetic.problems)}`,
  );

  const rows = planCatalogRows({
    catalog: synthetic.catalog,
    gameVersion: '1.16.1',
    tagFilter: [],
    bindings: new Map(),
  });
  const row = rows.find((r) => r.modid === 'synthetic')!;
  assert.deepEqual(row.tags, ['legal', '没有显示名的标签']);
  assert.deepEqual(
    row.tagLabels,
    ['合法', '没有显示名的标签'],
    '有显示名就用显示名；没有就退化成 key 本身（spec §15：目录坏了要看得见）',
  );
  assert.equal(row.tagLabels.length, row.tags.length, '两者必须逐位对应（消费方按下标取用）');
});

/*
 * ===========================================================================
 * Task 1（mod 下载页重构）：版本页投影 `planVersionPage` / `groupFoldersByVersion`
 * ===========================================================================
 * ⚠️ 简报把 `stateWith` / `catalogRow` / `folderView` / `folderRow` / `release` 记成
 *    "该文件里已有的构造辅助" —— **它们在这个文件里一个都不存在**（现读全文件：只有
 *    `catalog` 这一份真目录，加 `planCatalogRows` / `planFolderView` 两个真 planner）。
 *    ⇒ 下面的夹具沿用这个文件一直以来的口径：**用真目录 + 真 planner 造视图对象**，
 *      而不是手搓 `CatalogRowView` / `ModFolderView` 字面量。好处是"投影消费的是**真的**
 *      行视图 / 文件夹视图"这件事由夹具保证；代价是断言里的值（modid / url / homepage）
 *      都取自已提交的 `content/mod-catalog.json`，每一条都带"夹具自钉"。
 */

/** 一份最小的 `ModFoldersState`：只填投影读得到的格，其余给"空 / 无"。 */
function stateWith(over: Partial<ModFoldersState> = {}): ModFoldersState {
  return {
    catalogStatus: 'ok',
    // ⚠️ 简报里第 3、4 条测试的 `stateWith({...})` **不带** `gameVersion` ⇒ 这一格是它们的
    //    隐式前提（文件夹也必须给 1.16.1，否则该版本下一个文件夹都筛不出来）。
    gameVersion: '1.16.1',
    gameVersions: ['1.16.1'],
    tagFilter: [],
    tags: [],
    bulkChannel: 'origin',
    mirrors: [],
    catalogRows: [],
    folders: [],
    missing: [],
    missingStatus: 'ok',
    notices: [],
    busy: false,
    lastRun: null,
    ...over,
  };
}

/** 该版本的目录行（真目录 + 真 `planCatalogRows`）。 */
function rowsForVersion(
  gameVersion: string,
  upstreamLatest?: ReadonlyMap<string, ModRelease>,
): CatalogRowView[] {
  return planCatalogRows({
    catalog,
    gameVersion,
    tagFilter: [],
    bindings: new Map(),
    upstreamLatest,
  });
}

/** 一份文件夹视图（真 `planFolderView`；`gameVersion` 默认与 `stateWith` 的默认一致）。 */
function folderView(over: {
  folderId: string;
  gameVersion?: string | null;
  pathExists?: boolean;
  hasReading?: boolean;
  scan?: readonly FolderScanEntry[];
}): ModFolderView {
  return planFolderView({
    catalog,
    folderId: over.folderId,
    path: `D:/mods/${over.folderId}`,
    pathExists: over.pathExists ?? true,
    hasReading: over.hasReading ?? true,
    gameVersion: over.gameVersion === undefined ? '1.16.1' : over.gameVersion,
    autoUpdate: false,
    scan: over.scan ?? [],
  });
}

test('planVersionPage：只给该版本的文件夹，且分组按有效版本', () => {
  const state = stateWith({
    gameVersion: '1.16.1',
    folders: [
      folderView({ folderId: 'a', gameVersion: '1.16.1' }),
      folderView({ folderId: 'b', gameVersion: '1.8.9' }),
    ],
  });
  const page = planVersionPage(state, []);
  assert.deepEqual(
    page.folders.map((f) => f.folder.folderId),
    ['a'],
  );
  assert.equal(page.version, '1.16.1');
  // spec §9.1 的另一半：给一个没有文件夹的版本 ⇒ 空数组（不是"退回全部文件夹"）
  assert.deepEqual(
    planVersionPage(stateWith({ gameVersion: '1.7.10', folders: state.folders }), []).folders,
    [],
  );

  /*
   * ★ 标题里那半句"**且**分组按有效版本"在简报的断言里没有落点（只断言了 `page.version`）
   *   ⇒ 补上 `groupFoldersByVersion`。它还顺手钉住了两件简报没写、但契约里有的事：
   *     · 组的顺序 = 状态里的首次出现顺序（页面画出来的组因此是稳定的）；
   *     · `gameVersion === null`（版本未知）的那些文件夹自成一组，`version` 就是 `null`
   *       —— 不是被"归到某一版"、也不是被丢掉。
   */
  const grouped = groupFoldersByVersion(
    stateWith({
      folders: [
        folderView({ folderId: 'a', gameVersion: '1.16.1' }),
        folderView({ folderId: 'b', gameVersion: '1.8.9' }),
        folderView({ folderId: 'c', gameVersion: null }),
      ],
    }),
  );
  assert.deepEqual(
    grouped.map((g) => g.version),
    ['1.16.1', '1.8.9', null],
    '分组按状态里的首次出现顺序；版本未知的那些成一组（version = null）',
  );
  assert.deepEqual(
    grouped.map((g) => g.folders.map((f) => f.folderId)),
    [['a'], ['b'], ['c']],
  );
});

test('planVersionPage：已下载只在被展开的文件夹里成立', () => {
  const state = stateWith({
    gameVersion: '1.16.1',
    folders: [
      folderView({
        folderId: 'a',
        gameVersion: '1.16.1',
        scan: [{ fileName: 'sodium-1.0.jar', modid: 'sodium', version: '1.0', sha512: null }],
      }),
      folderView({ folderId: 'b', gameVersion: '1.16.1', scan: [] }),
    ],
    catalogRows: rowsForVersion('1.16.1'),
  });
  const none = planVersionPage(state, []).mods.find((m) => m.modid === 'sodium');
  assert.ok(none !== undefined, '夹具自钉：sodium 必须在 1.16.1 的 mods 里');
  assert.deepEqual(none.downloadedIn, []);
  const onlyA = planVersionPage(state, ['a']).mods.find((m) => m.modid === 'sodium');
  assert.deepEqual(onlyA?.downloadedIn, ['a']);
  /*
   * ★ 承重的一条：`b` **也被展开了**，只是它里面没有 sodium ⇒ `downloadedIn` 仍为空。
   *   少了它，"展开过滤"可以坏成"expanded 非空就算已下载"而整块照样绿。
   */
  const onlyB = planVersionPage(state, ['b']).mods.find((m) => m.modid === 'sodium');
  assert.deepEqual(onlyB?.downloadedIn, []);
});

test('planVersionPage：未识别的 jar 不进 recognizedModids，但仍在文件夹的行里', () => {
  const state = stateWith({
    folders: [
      folderView({
        folderId: 'a',
        gameVersion: '1.16.1',
        scan: [{ fileName: 'mystery.jar', modid: null, version: null, sha512: null }],
      }),
    ],
  });
  const page = planVersionPage(state, ['a']);
  assert.equal(page.folders.length, 1, '夹具自钉：这一版下就是这一个文件夹');
  const block = page.folders[0]!;
  assert.deepEqual(block.recognizedModids, []);
  assert.equal(block.folder.unrecognized.length, 1);
  // 标题那半句"但仍在文件夹的行里"：认不出的那一条要能按**文件名**找回来（页面据此标红）
  assert.equal(block.folder.unrecognized[0]!.fileName, 'mystery.jar');
  assert.equal(block.folder.unrecognized[0]!.reason, 'no-fabric-meta');
});

test('planVersionPage：链接字段取的是目标 release（没有目标 ⇒ 不许拿候选兜底）', () => {
  const sodiumRelease = catalog.releases.find(
    (r) => r.modid === 'sodium' && r.targetVersions.includes('1.16.1'),
  )!;
  const upstream: ModRelease = {
    ...sodiumRelease,
    version: '99.0.0',
    url: 'https://example.invalid/upstream/sodium-99.0.0.jar',
  };
  assert.notEqual(upstream.url, sodiumRelease.url, '夹具自钉：上游那条与目录那条的地址必须不同');

  const row = planVersionPage(
    stateWith({
      gameVersion: '1.16.1',
      catalogRows: rowsForVersion('1.16.1', new Map([['sodium', upstream]])),
    }),
    [],
  ).mods.find((m) => m.modid === 'sodium')!;
  assert.equal(row.releaseUrl, upstream.url, '有目标（上游那条）⇒ 链接取的是目标');
  assert.equal(row.releaseVersion, '99.0.0');

  /*
   * `homepage` 取的是**目录里这个 mod 的** homepage（spec §5.1）。
   * ⚠️ 简报的夹具写的是 `catalogRow({ modid: 'sodium', homepage: 'h' })`，而**真实的
   *    `CatalogRowView` 没有 `homepage` 这一格**（现读 `modFolders.ts` 里那个接口的字段清单）
   *    ⇒ 这一格是 Task 1 顺手补的（`planCatalogRows` 从 `ModEntry.homepage` 填；实测 70/70
   *    都有）。断言因此只能取真目录里那个值 —— 下面那条自钉保证它不是 `undefined`。
   */
  const sodiumHomepage = catalog.mods.find((m) => m.modid === 'sodium')!.homepage;
  assert.ok(sodiumHomepage, '夹具自钉：sodium 在目录里有 homepage');
  assert.equal(row.homepage, sodiumHomepage);

  /*
   * ★ 承重的一条：**没有目标**的行不许拿候选兜底。
   *   `official?.url ?? candidates[0]?.url` 在"有目标"那一支根本走不到 ⇒ 只断言上面
   *   那两条的话，它就抓不到这个坏法（Step 5 的刀③落在这里）。
   */
  const ambSource = rowsForVersion('1.7.2').find((r) => r.modid === 'optifine')!;
  assert.equal(ambSource.official, null, '夹具自钉：optifine@1.7.2 是多候选 ⇒ 没有目标');
  assert.ok(ambSource.candidates.length >= 2, '夹具自钉：候选非空 ⇒ "候选兜底"有东西可兜');
  const amb = planVersionPage(
    stateWith({ gameVersion: '1.7.2', catalogRows: rowsForVersion('1.7.2') }),
    [],
  ).mods.find((m) => m.modid === 'optifine')!;
  assert.equal(amb.releaseUrl, null, '没有目标 ⇒ 没有下载链接（候选不是目标）');
  assert.equal(amb.releaseVersion, null);
});

test('planVersionPage：下载目标是"路径在 + 有读数 + 版本已知"的那些', () => {
  const state = stateWith({
    gameVersion: '1.16.1',
    folders: [
      folderView({ folderId: 'a', gameVersion: '1.16.1' }),
      folderView({ folderId: 'b', gameVersion: '1.16.1', pathExists: false }),
      folderView({ folderId: 'c', gameVersion: '1.16.1', hasReading: false }),
    ],
    catalogRows: rowsForVersion('1.16.1'),
  });
  const page = planVersionPage(state, []);
  const row = page.mods.find((m) => m.modid === 'sodium')!;
  assert.deepEqual(
    page.folders.map((f) => f.folder.folderId),
    ['a', 'b', 'c'],
    '夹具自钉：三个文件夹都在这一版里（差别只在下面两格）',
  );
  assert.equal(page.folders[1]!.folder.pathExists, false, 'b 的差别是路径不在');
  assert.equal(page.folders[2]!.folder.hasReading, false, 'c 的差别是没有读数');
  assert.deepEqual(row.downloadTargets, ['a']);
});
