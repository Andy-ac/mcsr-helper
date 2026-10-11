import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { LauncherInstance } from '@mcsr/shared/launcherInstances';
import { type ModRelease, parseModCatalog, parseModCatalogWire } from '@mcsr/shared/modCatalog';
import {
  attributeLegacyBindings,
  batchTargets,
  type CatalogRowView,
  channelUrl,
  deriveFolders,
  type FolderScanEntry,
  groupFoldersByVersion,
  type InstancePref,
  instanceViewsOf,
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

test('★★ 目录行没有本地读数（A 的 T6）：单候选 ⇒ unknown、永不进批量、`rowId` 形状不变', () => {
  /*
   * ⚠️★ 这条测试**替换**了原来那条"只升不降：本地 5.8.26 / 官方 5.8.22 ⇒ newer"
   *    （2026-10-04，A 的 T6）。它原来的夹具是 `bindings: new Map([['mcsrranked|1.16.1', …]])`
   *    —— 而 `planCatalogRows` 在 T6 **不再收 `bindings`**（`catalogBindings` 那三个通道
   *    删了，D8/裁决 B）⇒ 目录行没有"本地那一份"可言，`older` / `newer` / `same` /
   *    `different-build` 四支在目录行上**不可达**（它们都要一份本地字节/版本读数）。
   *
   * ⚠️★ 所以这里钉的是**收缩之后**的判据（不是"放宽"）：单候选 ⇒ `unknown`，
   *    而且 `batchable` 恒 `false`（进批量的唯一入口 `older` 到不了）。
   *    ⚠️ 文件夹行那一侧的"只升不降"**一个字都没动**：它的本地读数是扫到的 jar
   *    （`planFolderView` 的 `scan`），断言在那里与本文件里都有。
   *    ⚠️ 上游解析那一支（`upstreamLatest`）另有两组测试（传了 / 没传），也在这个文件里。
   */
  const rows = planCatalogRows({
    catalog,
    gameVersion: '1.16.1',
  });
  const row = rows.find((r) => r.modid === 'mcsrranked')!;
  assert.equal(row.rowId, 'mcsrranked|1.16.1', 'rowId 的形状仍是 <modid>|<gameVersion>');
  assert.equal(
    row.verdict.kind,
    'unknown',
    '没有本地读数 ⇒ 单候选行是 unknown（一个仍然"能判出 older/newer"的实现会在这里红）',
  );
  assert.equal(row.batchable, false, 'unknown 绝不进批量');
  assert.equal(batchTargets(rows), 0, '整份目录行都不进批量（目录行没有本地读数）');
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
  });
  const amb = rows.find((r) => r.modid === 'optifine')!;
  assert.equal(amb.verdict.kind, 'ambiguous');
  assert.ok(amb.candidates.length >= 2);
  assert.equal(amb.batchable, false);
});

test('★★ D2（A 的 T6）：标签只显示、不筛选 —— 目录行是**全量**，而且入参里没有这一格', () => {
  /*
   * ⚠️★ 这条测试**替换**了原来那条"标签筛选是**与**语义"（2026-10-04，A 的 T6，spec D2）。
   *    原判据（`tagFilter.every(...)` 丢掉不匹配的行）在 T6 **删掉了**，理由是实的：
   *    唯一能改这个筛选的界面（第一部分那两个筛选器之一）随第一部分下线，
   *    而 `prefs.tagFilter` 是会**持久化**的 ⇒ 一个陈旧的值会让第三段
   *    「该版本**全部** mod」不再是全量，而**用户无处可清**（T5 评审点名的那个真缺陷）。
   *    ⇒ 修法是结构性的：`PlanCatalogRowsInput` 里**根本没有**这一格。
   *
   * ⚠️★ 判据分两半，缺一半就有一种坏法没人喊：
   *    ① **编译期**：往入参里塞 `tagFilter` 必须**编译不过**（`@ts-expect-error` ——
   *       哪天有人把那一格加回去，这一条会变成"未使用的 expect-error"而当场红）；
   *    ② **运行期**：带标签的行与不带标签的行**都在**（一个"只留下带某标签的行"的实现
   *       在这里红），而标签本身仍然画得出来（D2：**只显示**）。
   */
  const rows = planCatalogRows({
    catalog,
    gameVersion: '1.16.1',
  });
  /*
   * ★ 判据（**不按"带标签/不带标签"分**，实测那一刀切不出来）：1.16.1 下**每一行都至少
   *   带一个标签**（48/48）⇒ "不带标签的行还在不在"是个空集上的恒真（§5.32①）。
   *   能咬住筛选的判据是这一条：**任取一个真实标签，不带它的行必须还在**。
   *   一个"按标签筛过"的实现（不论筛哪个标签）会当场红。
   */
  const someTag = rows.find((row) => row.tags.length > 0)!.tags[0]!;
  const withoutTag = rows.filter((row) => !row.tags.includes(someTag));
  assert.ok(
    withoutTag.length > 0,
    `夹具自钉 + 判据：不带 ${someTag} 的行必须还在（实测 ${String(rows.length)} 行里 ` +
      `${String(withoutTag.length)} 行不带它）—— 一个"按标签筛过"的实现在这里红`,
  );
  assert.equal(
    rows.length,
    48,
    '1.16.1 下的目录行是**全量** 48 行（spec §3.2 的读数；`foldersrender.tsx` ㉜ 钉的是同一个数）',
  );
  // ★ D2 的另一半：标签仍然**显示**得出来（行上带着 key + 显示名，逐位对应）
  for (const row of rows) {
    assert.equal(row.tagLabels.length, row.tags.length, `${row.modid} 的标签显示名与 key 逐位对应`);
  }
  /*
   * ★★ 编译期那一条（刀）：`tagFilter` 已经不是入参 —— 把这一格加回
   *    `PlanCatalogRowsInput`（或者恢复 `planCatalogRows` 里的筛选），
   *    这一行的 `@ts-expect-error` 会变成"多余的 expect-error" ⇒ `typecheck` 红。
   */
  // @ts-expect-error tagFilter 在 T6 已经从入参里删掉了（D2：标签只显示、不筛选）
  planCatalogRows({ catalog, gameVersion: '1.16.1', tagFilter: ['legal'] });
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

test('★★ D8（A 的 T6）：`catalogBindings` 里有旧数据时**读到就忽略**（清成 `{}`）', () => {
  /*
   * ⚠️★ spec D8 的"具体形状"：`catalogBindings` 停止写入、读到时**忽略**、**不升状态版本号**。
   *    那三个写它的通道（`bindCatalogRow` / `unbindCatalogRow` / `updateCatalogRow`）在 T6
   *    删了（裁决 B：契约 17 → 14），而盘上那份旧数据可能还在 ⇒ 这一条钉住
   *    "读进来不认它"。
   *
   * ⚠️★ 为什么判据是"清成 `{}`"而不是"这个键消失"（spec 的字面是后者）：`StateFileV2` 的
   *    写盘路径住在 `apps/desktop/src/file-updates.ts`（v1 那一套，本任务不许动），
   *    而它的写盘是 `{...磁盘, ...我们这份}` 的**浅合并** —— 我们这份里没有这个键时，
   *    磁盘那份会被**捡回来**。⇒ "键消失"要靠改那条写盘路径才成立。
   *    **可达到、也在这里钉住的那一半**正是 D8 要的结果：旧数据读到就忽略，
   *    而且**第一次持久化之后**它不再存在（我们这份的 `{}` 覆盖掉磁盘那份的旧内容）。
   *    ⚠️ 刀：把 `migrateState` 的早返回改回 `return raw as StateFileV2` ⇒ 这一条红。
   */
  const stale = {
    version: 1,
    stateVersion: 2,
    items: {},
    catalogBindings: {
      'sodium|1.16.1': {
        localPath: 'D:/mods/sodium.jar',
        localVersion: '0.1.2',
        localSha512: null,
        releaseKey: null,
        autoUpdate: false,
      },
    },
    folders: {},
    prefs: { bulkChannel: 'origin', catalogGameVersion: '1.16.1', tagFilter: [] },
  };
  const migrated = migrateState(stale);
  assert.deepEqual(migrated.catalogBindings, {}, '旧绑定读到就忽略（清成空表，不是留着不看）');
  assert.deepEqual(
    migrateState(migrated),
    migrated,
    '幂等仍然成立：再跑一次逐字段相同（`catalogBindings` 还是 `{}`）',
  );
  /*
   * ★ 对照：`prefs` / `items` 一格都不许动（别把"清旧数据"做成"整份重建"）。
   * ⚠️★ D1（spec A16）之后 `folders` **也**被 `migrateState` 清空 ⇒ 这一条不再拿它当
   *    "其余不动"的对照：夹具里它是 `{}`，`deepEqual` 与"没被清"分不开（§5.32① 恒真断言）。
   *    A16 真正的判据是**下面**那条用例（它的旧 `folders` 是**非空**的）。
   */
  assert.deepEqual(migrated.prefs, stale.prefs);
  assert.deepEqual(migrated.items, stale.items);
});

test('★ 状态迁移：坏输入不抛（返回可写的干净状态，由调用方决定要不要覆盖）', () => {
  for (const bad of [null, 42, 'x', [], { version: 1 }]) {
    const s = migrateState(bad);
    assert.equal(s.stateVersion, 2);
    assert.deepEqual(s.folders, {});
  }
});

test('★ D1：迁移把旧 `folders` 清空（spec A16：丢弃旧绑定与扫描读数）', () => {
  /*
   * ★ D1（spec A16）：升级后旧的手工绑定**与它的扫描读数**一律清掉，界面从"未绑定启动器"
   *   空态开始 —— 新模型只认"启动器实例"（`launchers` + `instancePrefs`）。
   * ⚠️ 盘上的 mod 文件不受影响：丢的只是本应用的记账（spec §10 把这条代价写下来了）。
   * ⚠️ 别的格子**一格都不许**跟着丢 —— 尤其别把"清旧绑定"做成"整份重建"。
   * ⚠️★ 刀：把 `migrateState` 早返回里的 `folders: {}` 去掉 ⇒ 这一条红。
   * ⚠️★ 评审 #1（Critical）：`launchers` / `instancePrefs` 这两格**必须给真值**。
   *   旧夹具里**没有** `instancePrefs` 这个键，而期望值也是 `{}` ⇒ 那句断言只证明"缺就给空值"，
   *   与"把用户已有的洗成 `{}`"**分不开**（§5.32① 恒真断言）。实测：把 `migrateState` 里
   *   "保留既有 `instancePrefs`"那三行换成 `instancePrefs: {}`，旧夹具下**35 条一条都不红** ✗。
   *   代价是实的：手改路径（A12）与 `confirmed`（T8 的确认动作）会**静默消失**，
   *   而没有任何用例拦得住。⇒ 现在夹具里是一条真绑定 + 一格带 `modsDir`/`savesDir`/`confirmed`
   *   的真偏好，下面断言**它原样还在**。
   */
  const old = {
    version: 1,
    stateVersion: 2,
    items: {},
    catalogBindings: {},
    folders: {
      'old-id': { path: 'D:\\old\\mods', gameVersion: '1.16.1', autoUpdate: true, boundAt: 1 },
    },
    /* ★ 两格真值（D1 的配置）—— 非空、非默认，刀才拔得动。 */
    launchers: [{ id: 'multimc:D:\\MultiMC', kind: 'multimc', rootPath: 'D:\\MultiMC' }],
    instancePrefs: {
      'multimc:instances/a': {
        tracked: true,
        modsDir: 'HAND\\mods',
        savesDir: 'HAND\\saves',
        confirmed: true,
      },
    },
    prefs: {
      bulkChannel: 'origin',
      catalogGameVersion: '1.16.1',
      catalogGameVersionChosen: true,
      tagFilter: [],
    },
  };
  const migrated = migrateState(old);
  assert.deepEqual(migrated.folders, {}, '旧绑定一律清掉');
  /*
   * ★ 这两条是"**已有的原样保留**"那一半（评审 #1 的判据）。
   * ⚠️ 别再退回 `deepEqual(migrated.instancePrefs, {})` —— 那是恒真的那一半。
   */
  assert.deepEqual(migrated.launchers, old.launchers, '已有的启动器绑定一格都不许洗');
  assert.deepEqual(
    migrated.instancePrefs,
    old.instancePrefs,
    '已有的勾选与手改路径（含 `confirmed`）一格都不许洗',
  );
  assert.equal(migrated.prefs.catalogGameVersionChosen, true, '其它 prefs 一格都不许动');
});

test('★ D1：老 v2 文件里**没有**这两格 ⇒ 迁移补出空值（不是 `undefined`）', () => {
  /*
   * ★ 评审 #2（Important）：`StateFileV2` 上这两格是**必填**，而 D1 之前写的 v2 文件里
   *   根本没有它们 ⇒ `migrateState` 必须补出 `[]` / `{}`，而**不是**让 `undefined` 流到
   *   读它的那一侧（T4/T8 会直接 `state.instancePrefs[key]`、遍历 `state.launchers`）。
   * ⚠️★ 期望值**不许**只写 `deepEqual(…, {})`：`isRecord(undefined)` 为假 ⇒ 兜底恰好也给
   *   `{}` ⇒ 那句 `deepEqual` 在"兜底生效"与"原样透传出 `undefined`"两种实现下**都绿**
   *   （§5.32① 的恒真形态；评审实测过：拔掉兜底仍然 35 条全绿 ✗）。
   *   ⇒ 判据用**类型谓词**（`Array.isArray` / `typeof … === 'object'`），最后再补两条"它就是
   *   空的那一份"的读数 —— 形状与内容分开压，缺任何一条都会让某个坏实现溜过去。
   * ⚠️★ 刀：把 `migrateState` v2 分支里这两格的兜底换成**原样透传**
   *   （`launchers: (raw as StateFileV2).launchers` / 同理 `instancePrefs`）⇒ 这一条红
   *   （`typeof undefined === 'object'` 为假、`Array.isArray(undefined)` 为假）。
   */
  const migrated = migrateState({
    version: 1,
    stateVersion: 2,
    items: {},
    catalogBindings: {},
    folders: {},
    prefs: { bulkChannel: 'origin', catalogGameVersion: '1.16.1', tagFilter: [] },
  });
  assert.ok(
    Array.isArray(migrated.launchers),
    '`launchers` 必须是数组（`undefined` 会让 T4 的 `for (const b of …)` 在跟损坏无关的地方抛）',
  );
  assert.ok(
    typeof migrated.instancePrefs === 'object' && migrated.instancePrefs !== null,
    '`instancePrefs` 必须是对象（`undefined` 会让 T4 的 `state.instancePrefs[key]` 在跟损坏无关的地方抛）',
  );
  assert.deepEqual(migrated.launchers, [], '而且它就是空的那一份');
  assert.deepEqual(migrated.instancePrefs, {}, '而且它就是空的那一份');
});

test('★ D1：`folders` 由"被追踪的实例"派生（folderId = instance.key，path = modsDir）', () => {
  /*
   * ★ D1（spec A9/A10）：**被追踪的实例 ⇒ 一条 folder**，而 `folders` 的形状一个字没变
   *   ⇒ 扫描 / 判定 / 整夹更新 / 缺失清单全都照旧工作，只是"谁在里面"改由实例决定。
   *   `folderId` 直接用 `instance.key`（`<类型>:<相对根的路径>`）：稳定、可读、跨启动器不撞。
   * ⚠️★ `autoUpdate` 是 **`true`**（2026-10-11 控制器现读纠正，初稿写的是 `false` ✗）：
   *    `autoUpdate` **只管"启动时扫不扫"** —— `apps/desktop/src/mod-folders.ts` 的 `startUp`
   *    里那句 `if (entry.autoUpdate)` ⇒ 给 `false` 的话，升级到 D1 的机器在启动那一趟**不扫**
   *    任何派生的 folder（读数只能等页面拉状态时补扫），而 `bindFolder` 给**新绑**文件夹的
   *    默认值正是 `autoUpdate: true`。⇒ 下面那条 `deepEqual` 压住的就是这件事：把
   *    `deriveFolders` 里那一格改成 `false`，它当场红（**不是**一条恒真断言）。
   * ⚠️★ 刀：去掉 `deriveFolders` 里那道 `tracked !== true ⇒ continue` 的过滤 ⇒ 这一条红。
   */
  const inst = (key: string, modsDir: string, gameVersion: string | null) => ({
    key,
    kind: 'multimc' as const,
    name: key,
    instancePath: 'x',
    gameVersion,
    loader: null,
    modsDir,
    savesDir: `${modsDir}\\..\\saves`,
    needsConfirm: false,
  });
  const derived = deriveFolders(
    [
      inst('multimc:instances/a', 'A\\mods', '1.16.1'),
      inst('multimc:instances/b', 'B\\mods', '1.12.2'),
    ],
    { 'multimc:instances/a': { tracked: true }, 'multimc:instances/b': { tracked: false } },
    () => 1234,
  );
  assert.deepEqual(Object.keys(derived), ['multimc:instances/a'], '只派生被追踪的那些');
  assert.deepEqual(derived['multimc:instances/a'], {
    path: 'A\\mods',
    gameVersion: '1.16.1',
    autoUpdate: true,
    boundAt: 1234,
  });
});

test('★ older + auto ⇒ 真的进批量（在**文件夹行**上：`batchable` 与 `batchTargets` 的自增分支）', () => {
  /*
   * ⚠️★ 这条测试在 2026-10-04（A 的 T6）**换了个 planner**：`batchable === true` 那一支
   *    在**目录行**上已经不可达（`planCatalogRows` 不收 `bindings` 了 ⇒ 判不出 `older`）
   *    ⇒ 它原来那份夹具会永远拿到 `unknown`。而这一支**必须**有断言：
   *      · 把 `batchable` 写死成 `false`；
   *      · 把 `needsUpdate(verdict)` 换成自己写的 `verdict.kind === 'older'`；
   *      · **整个删掉**那次 `needsUpdate` 调用；
   *    这三种坏法会让 `batchTargets` 的 `count + 1` 那一支从未执行 ⇒ 少了这一条，
   *    整套断言照样绿（AGENTS §5.32①）。
   *    ⇒ 判据搬到"还有本地读数"的那一侧：**文件夹行**（`planFolderView` 的 `scan`）。
   *    实测：`antigone|1.16.1` 是单候选 `2.0.0[auto]`；本地 `1.0.0` ⇒ 主体 `1.0.0 < 2.0.0`
   *    ⇒ `older`；候选是 `auto` ⇒ 进批量。
   *    ⚠️ 与 `mod-catalog-real-folder.test.ts`（真目录那份）不重复：那一条数的是
   *    "older 的行有几行"，这一条钉的是 `batchTargets()` 的自增分支与 `needsUpdate` 的调用。
   */
  const view = planFolderView({
    catalog,
    folderId: 'f1',
    path: 'D:/x/mods',
    gameVersion: '1.16.1',
    autoUpdate: false,
    pathExists: true,
    hasReading: true,
    scan: [{ fileName: 'a-1.0.0.jar', modid: 'antigone', version: '1.0.0', sha512: null }],
  });
  const row = view.rows.find((r) => r.modid === 'antigone')!;
  assert.equal(row.verdict.kind, 'older');
  assert.equal(row.manual, false);
  assert.equal(row.batchable, true, 'older + download=auto 是进批量的唯一组合');
  assert.equal(batchTargets(view.rows), 1, '这个文件夹里只有一行可批量');
});

test('★ 上游解析：传了 `upstreamLatest` ⇒ 目标换成上游那条（`candidates` 仍来自目录）', () => {
  /*
   * spec §7.2 / D1：`mod.upstream != null` 时**目标 = 上游解析的那条**。
   * 实测：只有 `mcsrranked` 有 `upstream`（`modrinth:I9W1u5Ac`），而目录给它的是
   * `5.8.22`（`mcsrranked|1.16.1` 实测只有这一条候选）。
   * ⚠️★ T6 之后这一条**不再有本地读数**（`bindings` 从入参里删了）⇒ 判定的那两条断言
   *    跟着换成了收缩之后的真相（`unknown` / 不进批量）；"目标换成上游那条"那几条
   *    一个字都没动 —— 那才是这一条测试的主题。
   */
  const ranked = catalog.releases.find((r) => r.modid === 'mcsrranked')!;
  const upstream = { ...ranked, version: '5.8.26' };
  const rows = planCatalogRows({
    catalog,
    gameVersion: '1.16.1',
    upstreamLatest: new Map([['mcsrranked', upstream]]),
  });
  const row = rows.find((r) => r.modid === 'mcsrranked')!;
  assert.equal(row.official?.version, '5.8.26', '目标 = 上游那条');
  assert.equal(row.targetSource, 'upstream', '界面必须能"读"出来源，不许靠推断');
  assert.equal(
    row.verdict.kind,
    'unknown',
    '没有本地读数 ⇒ 单候选行是 unknown（与上一条同一判据）',
  );
  assert.equal(row.batchable, false);
  assert.equal(row.manual, false);
  // ★ `candidates` **不受上游影响**（界面要能显示"这条来自目录"）
  assert.deepEqual(
    row.candidates.map((r) => r.version),
    ['5.8.22'],
    '候选仍然只来自目录',
  );
});

test('★ 上游解析：没传 ⇒ 目标仍是目录那条（D1 的"只升不降"在**文件夹行**上另有断言）', () => {
  // 与上一条**同一个游戏版本**（受控对照）：只差"传没传上游"。
  const rows = planCatalogRows({
    catalog,
    gameVersion: '1.16.1',
  });
  const row = rows.find((r) => r.modid === 'mcsrranked')!;
  assert.equal(row.official?.version, '5.8.22', '没传上游 ⇒ 目标 = 目录里唯一那条候选');
  assert.equal(row.targetSource, 'catalog');
  assert.equal(row.batchable, false, '目录行不进批量（没有本地读数）');
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
   * ⚠️★ 2026-10-04（A 的 T6）**缩了范围**：原来两边还给**同一份本地读数**（目录行绑一份
   *    `1.0` 的 jar、文件夹扫到同一份）⇒ 连 `verdict` 与 `batchable` 都逐格相等。
   *    而目录行在 T6 **没有本地读数可言**了（`bindings` 从入参里删了，D8/裁决 B）
   *    ⇒ "两边同一个 verdict"这件事**在目录行这一侧不可测**（它恒是 `unknown`）。
   *    ⚠️★ 剩下的那半条不变量仍然承重，而且它才是 Ruling 14 的现场：
   *    **目标与来源必须同源**（`official` / `targetSource`）—— 两个 planner 收同一份
   *    `upstreamLatest` 时必须都选那条上游的。判定那一格由**文件夹行自己**的测试钉
   *    （本文件里 `older` / `newer` / 上游那几组）。
   */
  const antigone = catalog.releases.find((r) => r.modid === 'antigone')!;
  const upstreamLatest = new Map([['antigone', { ...antigone, version: '3.0.0' }]]);
  const catalogRow = planCatalogRows({
    catalog,
    gameVersion: '1.16.1',
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
  assert.equal(catalogRow.verdict.kind, 'unknown', '目录行侧没有本地读数（T6 之后它恒是 unknown）');
  assert.equal(folderRow.verdict.kind, 'older', '而文件夹行有本地读数 ⇒ 它照常判得出来');
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
    tags: [],
    /* ⚠️★ 这一格在 T6 之后**不筛选任何东西**（D2）—— 它只是"记住的值"，投影也不读它。 */
    tagFilter: [],
    bulkChannel: 'origin',
    mirrors: [],
    catalogRows: [],
    folders: [],
    /*
     * ★★ D1（T4）：`launchers` / `instances` / `instancesStatus` 是**新增的必需格**
     * （与契约同批加的）。⚠️ 它们是**必填**的 ⇒ 漏了这里整个套件在 `tsc` 那一步就红
     * （这正是"必填"该有的形状）。这一份夹具不演实例 ⇒ 给空 + `'ok'`
     * （`'reading'` 是 A14 的另一档，由 `instanceViewsOf` 那几条以外的用例造，这里不必）。
     */
    launchers: [],
    instances: [],
    instancesStatus: 'ok',
    missing: [],
    missingStatus: 'ok',
    notices: [],
    busy: false,
    /*
     * ★ 子项目 C（T2）：契约多了这一格（"正在跑的那一趟"）。这一份夹具不构造跑起来的趟
     *   ⇒ `null`（与 `busy: false` 同一个意思）。**它是必填的**，所以这一行不是可选的补充：
     *   漏了它整个套件在 `tsc` 那一步就红（这正是"必填"该有的形状）。
     */
    progress: null,
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
    '分组的形状：每个版本一组、版本未知的那些成一组（version = null）；' +
      '⚠️ **顺序**这件事这一份证不了（它的插入序恰好等于代码单元序）—— 见下面那份 unsorted',
  );
  assert.deepEqual(
    grouped.map((g) => g.folders.map((f) => f.folderId)),
    [['a'], ['b'], ['c']],
  );

  /*
   * ★★ T1 ①②（最终修复波）：**插入序 ≠ 字典序**的那一份夹具。
   *
   * ⚠️★ 上面那一份分不出"首次出现序"与"字典序"：`['1.16.1','1.8.9',null]` 恰好**同时**
   *    是插入序与"代码单元序"（`'1.16.1' < '1.8.9'`，而 `null` 排在末位）⇒ 把实现换成
   *    排序之后那一份断言**照样绿**。这条断言就是为此存在的：
   *    先绑 `1.8.9`、再绑 `1.16.1` ⇒ 排序会给出 `['1.16.1','1.8.9',null]`，
   *    而"按用户的绑定顺序画"要的是 `['1.8.9','1.16.1',null]`。
   * ⚠️ 组员也一起排成不对称的（`b` 在 `a` 前面、各自一组）：只比版本序列的话，
   *    "把组按版本排序但保留组内顺序"这种坏法过得了 —— 这一份里"顺序错了"在第一格就看得见。
   * ★ 刀（读数在最终修复波报告里）：把 `groupFoldersByVersion` 的 `order.push(key)` 那一段
   *    换成最后 `[...bucket.keys()].sort(...)`（或先对 `state.folders` 按 `gameVersion`
   *    排一遍）⇒ 下面这条红。
   */
  const unsorted = groupFoldersByVersion(
    stateWith({
      folders: [
        folderView({ folderId: 'early', gameVersion: '1.8.9' }),
        folderView({ folderId: 'late', gameVersion: '1.16.1' }),
        folderView({ folderId: 'unknown', gameVersion: null }),
      ],
    }),
  );
  assert.deepEqual(
    unsorted.map((g) => g.version),
    ['1.8.9', '1.16.1', null],
    '★ T1 ①②：组的顺序 = 状态里的**首次出现顺序**（这一份的插入序恰好与代码单元序相反 ⇒ ' +
      "一个\"排一遍再分组\"的实现会给出 ['1.16.1','1.8.9',null]）",
  );
  assert.deepEqual(
    unsorted.map((g) => g.folders.map((f) => f.folderId)),
    [['early'], ['late'], ['unknown']],
    '★ T1 ①②：组员跟着组走（不是"按 gameVersion 排完再画"）',
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
  /*
   * ★★ B2（最终修复波）：`presentIn` **不看展开态** —— 同一个 modid，`expanded` 从 `[]`
   *   到 `['a']` 都不改变它。它与 `downloadedIn` 是同一次识别的两个投影。
   */
  assert.deepEqual(none.presentIn, ['a'], '★★ presentIn 与展开态无关（没展开也答得出"哪里有它"）');
  assert.deepEqual(onlyA?.presentIn, ['a'], '★★ presentIn 在展开之后仍然是同一格');
  assert.deepEqual(onlyB?.presentIn, ['a'], '★★ 展开别的文件夹不改变 presentIn');
  assert.deepEqual(
    planVersionPage(state, []).mods.find((m) => m.modid !== 'sodium')?.presentIn,
    [],
    '★ 对照：另一个 modid 的 presentIn 是空的（否则上面那几条可能只是"presentIn 恒为全部分文件夹"）',
  );
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

test('planVersionPage：下载目标是"路径在 + 有读数 + 里面还没有它"的那些', () => {
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
  /*
   * ★★ B2（最终修复波）：`downloadTargets` **还要把"已经有它"的文件夹排掉**。
   *
   * 现场：主进程 `downloadMissing` 对"**目标**文件夹里已经有这个 modid"是**无条件拒**的
   * （`apps/desktop/src/mod-folders.ts` 里 `present !== undefined` 那一段），而 `expanded`
   * 默认是空的 ⇒ 只看 `downloadedIn` 的话，默认视图里每一个"已经在唯一那个文件夹里"的 mod
   * 都会画出一颗**注定被拒**的按钮（点下去是一条红字）。
   * ⚠️ 上面那一份夹具三个文件夹都是**空的**（`scan` 默认 `[]`）⇒ 它证不了这一条：
   *    这里另起一份，一个文件夹里有 sodium、另一个没有。
   * ⚠️ 判据的**对称性**是刻意的：sodium 的目标表是 `['b']`、lithium 的是 `['a','b']` ——
   *    少了后一半，"把所有文件夹都排掉"这种坏法过得了前一条。
   * ★ 刀（读数在报告里）：把投影里
   *    `.filter((folder) => !presentIds.has(folder.folderId))` 删掉 ⇒ 第一条红。
   */
  const presentState = stateWith({
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
  const presentPage = planVersionPage(presentState, []);
  const sodium = presentPage.mods.find((m) => m.modid === 'sodium');
  const lithium = presentPage.mods.find((m) => m.modid === 'lithium');
  assert.ok(
    sodium !== undefined && lithium !== undefined,
    '夹具自钉：两个 modid 都在这一版的 mods 里',
  );
  assert.deepEqual(sodium.downloadTargets, ['b'], '★★ a 里已经有 sodium ⇒ 它不再是下载目标');
  assert.deepEqual(
    lithium.downloadTargets,
    ['a', 'b'],
    '★ 对照：没有它的那个 modid 两个文件夹都能装（否则上面那条可能只是"目标表被清空了"）',
  );
});

/*
 * ===========================================================================
 * D1 / Task 4：实例视图 `instanceViewsOf`（A12 手改优先 + "待确认"的**显示值**）
 * ===========================================================================
 * 这一格是界面**唯一**的实例来源（`ModFoldersState.instances`），而它同时喂
 * `deriveFolders`（同一个枚举结果 ⇒ 两边不漂）⇒ 它要一次干完三件事：
 *   ① 套用 `instancePrefs[key]` 里的**路径 / loader 覆盖**（A12：手改优先于探测）；
 *   ② 把"待确认"算成**显示值** `needsConfirm && !confirmed`（界面的标与确认按钮看它）；
 *   ③ 带上 `tracked`（勾选框的选中态）。
 *
 * ⚠️ 夹具是**手搓的 `LauncherInstance` 字面量**（与上面 `deriveFolders` 那条同一条口径）：
 *    这里要钉的是**投影**那三条规则，不是 T1 的枚举规则（那个的判据住在
 *    `src/launcher-instances.test.ts` 的假文件系统里）。
 */

/** 一个实例（只写出投影读得到的格子，其余给固定值 —— 免得每条用例堆十几行）。 */
function instanceOf(over: Partial<LauncherInstance> & { key: string }): LauncherInstance {
  return {
    kind: 'multimc',
    name: over.key,
    instancePath: 'D:\\MultiMC\\instances\\x',
    gameVersion: '1.16.1',
    loader: null,
    modsDir: 'D:\\MultiMC\\instances\\x\\.minecraft\\mods',
    savesDir: 'D:\\MultiMC\\instances\\x\\.minecraft\\saves',
    needsConfirm: false,
    ...over,
  };
}

test('★ D1/A12：`modsDir`/`savesDir` 手改优先于探测结果（而且只有**真的改了**才清"待确认"）', () => {
  /*
   * ⚠️★ A12 的字面是"解析结果可手改并持久化；**手改优先于探测**" —— 这条判据的落地点就在
   *    这一格：视图里的 `modsDir` 必须是**手改那一份**，否则界面显示的是探测值、而扫描
   *    （`setInstanceTracked` 拿视图里的 `modsDir` 去扫）扫的是另一份。
   * ⚠️ "改了才清 `needsConfirm`"是 T2 `applyOverride` 的规则：**空覆盖**（`{}`）不产生
   *    "用户确认过"这个事实 —— 少了这一半，"打开过手改框"就会被当成"用户确认了路径"。
   * ⚠️★ 刀（两条，读数在报告里）：
   *    ① 把 `instanceViewsOf` 里的 `applyOverride(...)` 换成原样透传 ⇒ 第一条红；
   *    ② 把 `applyOverride` 的 `changed` 判据去掉（恒清 `needsConfirm`）⇒ 第二条红。
   */
  const detected = instanceOf({ key: 'multimc:instances/x', needsConfirm: true });
  const views = instanceViewsOf([detected], {
    'multimc:instances/x': { tracked: true, modsDir: 'E:\\手改\\mods' },
  });
  assert.equal(views.length, 1);
  assert.equal(views[0]!.modsDir, 'E:\\手改\\mods', '手改过的 mods 优先于探测结果');
  assert.equal(
    views[0]!.savesDir,
    detected.savesDir,
    '没手改的那一格照旧是探测结果（覆盖是**逐格**的，不是整份替换）',
  );
  assert.equal(views[0]!.needsConfirm, false, '路径被真的改过 ⇒ 那一格不再是"待确认"');
  assert.equal(views[0]!.tracked, true);

  // 对照：空覆盖（只勾选、没改路径）**不**等于"用户确认过"
  const empty = instanceViewsOf([detected], { 'multimc:instances/x': { tracked: true } });
  assert.equal(empty[0]!.modsDir, detected.modsDir);
  assert.equal(
    empty[0]!.needsConfirm,
    true,
    '"改过路径"才是确认；只勾选**不**清待确认（同值覆盖不清，控制器 2026-10-11 裁定）',
  );

  /*
   * ★ A12 的**第三格**：`loader` 也是逐格覆盖之一（`InstancePref.loader` ⇒ T2/T12 的
   *   `applyOverride` 认它）。⚠️ 这一条是**跨任务**的接口判据：少传一个字段、或
   *   `applyOverride` 那一支被摘掉，它当场红（而"界面上的 loader 改了没反应"完全不报错）。
   * ⚠️ 与 `needsConfirm` 的关系是**有意**的：只改 loader **不算**确认了路径
   *   （"待确认"说的是路径是猜的）⇒ 两格一起钉。
   */
  const loaderEdited = instanceViewsOf([detected], {
    'multimc:instances/x': { tracked: true, loader: 'fabric 9.9.9' },
  })[0]!;
  assert.equal(loaderEdited.loader, 'fabric 9.9.9', 'loader 的手改要进视图（A12 的手改口之一）');
  assert.equal(
    loaderEdited.needsConfirm,
    true,
    '只改 loader 不算"确认了路径"（用户要按 T8 那颗显式确认的按钮）',
  );
});

test('★ D1：`confirmed` 是显式确认 ⇒ 视图里的 `needsConfirm` 是**显示值**（`&& !confirmed`）', () => {
  /*
   * ⚠️★ 这一格是 T8 那两颗控件的**唯一**判据面（"待确认"标 + 一颗「确认这个路径」按钮）：
   *    · `needsConfirm === true` ⇒ 两样都画；`false` ⇒ 两样都不画。
   *    所以视图里那一格必须是**算过 `confirmed` 的显示值** —— 把原始值透传出去的话，
   *    用户点了「确认」之后标**照样**在（点了没反应），而这一条会红。
   * ⚠️ 两半都要有读数：只钉"确认后 false"，把实现写成恒 `false` 也能过 ⇒ 所以先钉
   *    "没确认时是 true"。
   * ⚠️★ 刀：把 `instanceViewsOf` 里那句 `&& !confirmed` 删掉 ⇒ 第三条断言红。
   */
  const raw = instanceOf({ key: 'pcl2:.minecraft/versions/v1', kind: 'pcl2', needsConfirm: true });
  const before = instanceViewsOf([raw], { 'pcl2:.minecraft/versions/v1': { tracked: true } })[0]!;
  assert.equal(before.needsConfirm, true, '没确认过 ⇒ 待确认标要在（否则"确认"这个动作没有对象）');
  assert.equal(before.confirmed, false, '`confirmed` 记的是**原始**那一格（没确认过）');

  const after = instanceViewsOf([raw], {
    'pcl2:.minecraft/versions/v1': { tracked: true, confirmed: true },
  })[0]!;
  assert.equal(after.needsConfirm, false, '显式确认之后"待确认"必须消失（T8 的验收就是这一条）');
  assert.equal(after.confirmed, true);
  assert.equal(after.modsDir, raw.modsDir, '确认不改路径，只是"我看过并接受了"');

  // 对照：探测本身就判得出来的实例从来不画标（不需要用户确认任何东西）
  const certain = instanceOf({ key: 'official:1.16.1', kind: 'official', needsConfirm: false });
  assert.equal(
    instanceViewsOf([certain], {})[0]!.needsConfirm,
    false,
    '`needsConfirm: false` 的实例不许被画成待确认（确认那一档是叠加，不是改写）',
  );
});

test('★ D1：版本那一档 —— `instancePrefs[key].gameVersion`（用户手改）压过启动器元数据', () => {
  /*
   * ★★ 控制器 2026-10-11 现读后补的那一档（plan T4 Step 3 第 2 条）：没有它，
   *    "元数据读不出来 ⇒ 版本未知（`null`）"的实例在**版本 → 实例**流程里永远够不到
   *    ⇒ 用户没法往它里面装东西。今天用户能在文件夹行的版本下拉里手改 ⇒ 那是功能倒退。
   * ⚠️ 它与"推断值"是**两件事**：`adoptFolderGameVersion` 从 jar 里推断出来的东西只写
   *    `folders[...]`、**不进** `instancePrefs` ⇒ 这一格里有值就一定是用户手改的。
   * ⚠️★ 刀：把 `instanceViewsOf` 里那一格改回 `instance.gameVersion`（丢掉覆盖）⇒ 红。
   */
  const unknown = instanceOf({ key: 'multimc:instances/nometa', gameVersion: null });
  assert.equal(
    instanceViewsOf([unknown], {})[0]!.gameVersion,
    null,
    '没手改、元数据也读不出来 ⇒ 如实是 null（**不猜**）',
  );
  assert.equal(
    instanceViewsOf([unknown], {
      'multimc:instances/nometa': { tracked: true, gameVersion: '1.8.9' },
    })[0]!.gameVersion,
    '1.8.9',
    '用户手改的版本要出现在视图里（它是"版本未知"的实例唯一的出路）',
  );

  // 手改**压过**元数据（两边都有值、且不同 —— 少了这一半，"优先"这件事没有判据）
  const known = instanceOf({ key: 'multimc:instances/x', gameVersion: '1.16.1' });
  assert.equal(
    instanceViewsOf([known], {
      'multimc:instances/x': { tracked: false, gameVersion: '1.12.2' },
    })[0]!.gameVersion,
    '1.12.2',
    '两边都有值时以**用户手改**为准（否则"改了就被覆盖"这颗控件最坏）',
  );
});

test('★ D1：勾选态与实例集合本身 —— 一个都不许多、一个都不许少、顺序照枚举', () => {
  /*
   * ⚠️ 这一条钉的是"投影**不许筛人**"：`instanceViewsOf` 是界面唯一的实例来源，
   *    在这里过滤掉"没勾选的"或"待确认的"，界面上就再也看不到它们 ⇒ 用户无从勾选。
   *    `tracked` 只是**一格的读数**，不是过滤条件（与 `deriveFolders` 那条相反：
   *    那一条**只**派生被追踪的，两条规则各自有各自的位置）。
   * ⚠️★ 刀：在 `instanceViewsOf` 里加一句 `if (prefs[i.key]?.tracked !== true) continue;`
   *    ⇒ 第一条断言红（长度 3 → 1）。
   */
  const list = [
    instanceOf({ key: 'multimc:instances/a' }),
    instanceOf({ key: 'multimc:instances/b' }),
    instanceOf({ key: 'multimc:instances/c' }),
  ];
  const prefs: Record<string, InstancePref> = {
    'multimc:instances/a': { tracked: true },
    'multimc:instances/c': { tracked: false },
    // b 一个格子都没有（从来没勾过）
  };
  const views = instanceViewsOf(list, prefs);
  assert.deepEqual(
    views.map((v) => v.key),
    ['multimc:instances/a', 'multimc:instances/b', 'multimc:instances/c'],
    '三个都必须在（顺序照枚举结果）—— 投影不是勾选过滤器',
  );
  assert.deepEqual(
    views.map((v) => v.tracked),
    [true, false, false],
    '`tracked`：勾过的是 true，"从来没勾过"（缺那一格）与"勾过又取消"都是 false',
  );
  // 纯函数：不许改传进来的那个对象（改了的话"同一份枚举结果喂两处"就不成立了）
  assert.equal(list[0]!.modsDir, 'D:\\MultiMC\\instances\\x\\.minecraft\\mods');
});
