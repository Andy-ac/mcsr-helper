/**
 * mod 目录行 + mod 文件夹 —— **主进程那一侧**（Plan 2 / Task 4：读路径）。
 *
 * ===========================================================================
 * 这一份负责什么（边界写下来，免得下一个人以为它管得比实际宽）
 * ===========================================================================
 *   · **抓目录**（`/api/mod-catalog`，与 v1 的 `/api/file-catalog` 同一个基址，
 *     **不新造环境变量**）、**解析上游**（spec §7.2 / D1：`upstream != null` 的 mod
 *     目标换成上游最新版）；
 *   · **扫文件夹 / 推断游戏版本**（`scanFolder` / `resolveGameVersion`）；
 *   · **组装 `ModFoldersState` 并推给页面**（`broadcast`）；
 *   · **十五条 IPC 的注册**（其中 `onStatus` 只推、不 handle）。
 *   · **判断一条都不在这里**：`planCatalogRows` / `planFolderView` / `missingMods` /
 *     `attributeLegacyBindings` / `migrateState` / `channelUrl` 全部来自
 *     `@mcsr/shared/modFolders`（T1）——那里才有能红的断言钉着
 *     （`services/api/src/mod-folders-shared.test.ts`），而 `apps/desktop` **没有测试运行器**。
 *   · **I/O 也不在这里**：`readJarMeta` / `sha512OfFile` / `readStateFile` /
 *     `writeStateFile` / `fetchVersions` / `pickDirectory` / `pickOneJar` / `notify`
 *     全部**复用** `./file-updates`（Task 3 抽出来的那一批 + 本任务只加 `export` 的四个）。
 *     复制一份的下场与本仓踩过的每一次都同型：两份迟早漂，而漂的那一份在动用户的文件。
 *
 * ===========================================================================
 * 入参纪律（与 `preload.ts` 文件头那一段逐条对应）
 * ===========================================================================
 * 渲染进程加载的是**远程网页**。所以这一层每一个 handler 的入参只有
 * **id / 游戏版本字符串 / 标签数组 / 布尔**，**永远没有路径、没有 URL**：
 *   · 选目录 / 选 `.jar` 只能由主进程弹**自己的原生对话框**（`pickDirectory` / `pickOneJar`）；
 *   · `channel` 只是 `'origin'` 或 `{ mirrorId }`，而那个 `mirrorId` **必须在目录的
 *     `mirrors[]` 里查得到**（查不到 ⇒ 抛）—— 地址是主进程用 `channelUrl` 拼的。
 * ⇒ "写到哪里、从哪儿取"都不是页面说了算。`requireFolder` / `requireRowId` /
 *   `requireChannel` / `requireGameVersion` / `requireTags` 是这一条的落地点。
 *
 * ===========================================================================
 * 状态文件：**与 v1 共用同一份**（`userData/file-tracking.json`）
 * ===========================================================================
 * 这一份用的是 `file-updates.ts` 的 `readStateFile` / `writeStateFile`，
 * 形状是 T1 的 `StateFileV2`（`version: 1` + `stateVersion: 2` 同时存在，
 * `items` 是 v1 的原样保留、本模块**只读不剪枝**）。
 * ⚠️ **认下的代价**：v1 模块在内存里另有一份副本（它的 `stateFile` 是私有的），
 *    两个模块各自写盘 ⇒ "后写的那一份赢"。今天这条路不可达：v1 只在
 *    `initFileUpdates`（先跑，早于本模块的第一次读）与 v1 那九条通道被调用时写盘，
 *    而这个 UI 只调 `modFolders` 那一组。⇒ 记在这里，免得下一个人把它当"一定安全"。
 *
 * ===========================================================================
 * 有意的取舍（每一条都有代价，别当成遗漏）
 * ===========================================================================
 *   · **`autoUpdate` 只管"启动时扫不扫"**：启动时只扫开着开关的文件夹（照 v1 的
 *     `startUp` 只查 `autoUpdate === true` 的条目）；**写盘/下载永远要一次点击**。
 *     关着开关的文件夹在启动时**不扫** ⇒ 它的行是空的，因此**必须**配一条 notice
 *     说明"没开自动更新、所以没扫它"，否则用户看到的是一个空的文件夹。
 *     把关着的也扫了就等于"那个开关什么都不控制"（v1 的裁决点名过这件事）。
 *   · **目录拿不到时不给文件夹行**：`planFolderView` 的 `catalog` 是必填参数，
 *     而"目录不可用"时我们没有目录可判 ⇒ 视图只给表头（`rows` / `unrecognized` 都空）。
 *     退而求其次喂一份**空目录**是错的：那会把每一份扫描读数都标成"清单外 mod"。
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { SITE } from '@mcsr/shared';
import { MOD_FOLDERS_CHANNELS } from '@mcsr/shared/desktop';
import { type ModrinthVersion, pickLatestVersion, primaryFileOf } from '@mcsr/shared/fileUpdates';
import {
  buildIndex,
  type ModCatalog,
  type ModEntry,
  type ModIndex,
  type ModRelease,
  modFor,
  parseModCatalogWire,
  releasesFor,
} from '@mcsr/shared/modCatalog';
import {
  attributeLegacyBindings,
  type Channel,
  type FolderScanEntry,
  type LegacyBinding,
  type ModFoldersState,
  type ModFolderView,
  migrateState,
  missingMods,
  planCatalogRows,
  planFolderView,
} from '@mcsr/shared/modFolders';
import { app, BrowserWindow, ipcMain } from 'electron';
import {
  fetchVersions,
  notify,
  pickDirectory,
  pickOneJar,
  readJarMeta,
  readStateFile,
  sha512OfFile,
  writeStateFile,
} from './file-updates';

// ---------------------------------------------------------------------------
// 常量与模块状态
// ---------------------------------------------------------------------------

/**
 * 抓目录的超时（15 秒）。
 *
 * ⚠️ v1 那条 `fetchCatalogFromSite` 没有超时（它用 ETag + 条件请求，而断网时
 * `fetch` 自己会失败）。这一条**故意带超时**：`/api/mod-catalog` 是 425 KB 的目录，
 * 一个半死的连接会把"目录不可用"拖到 TCP 自己超时（几十秒），而页面上那段时间
 * 什么都没有。超时之后走的是同一条"保留上次缓存 + 说明原因"的路。
 */
const CATALOG_TIMEOUT_MS = 15_000;

/** 上游（Modrinth）那一侧的固定两格：这一期的 mod 全是 Fabric 的 release。 */
const UPSTREAM_LOADER = 'fabric';
const UPSTREAM_CHANNEL = 'release';

/** `mmc-pack.json` 向上找的层数上限（spec §6.6/§14.5：最多 4 层）。 */
const MMC_PACK_MAX_DEPTH = 4;

/** 推断游戏版本时路径里必须出现过的那一段（spec §6.6：不然 Prism 那种任意目录会被误判）。 */
const MINECRAFT_DIR = '.minecraft';

interface Deps {
  siteOrigin: string;
  userAgent: string;
  isPackaged: boolean;
}

let deps: Deps | null = null;

/**
 * 状态文件的内存副本。类型取自 `readStateFile()` 的返回值（v1 把那个类型收窄成
 * "`items` 逐条补过默认值"，而 `StateFile` 那个名字没有导出）——
 * ⚠️ 这样写等于**复用** v1 的收窄，而不是在这里再 cast 一次。
 */
type SharedState = NonNullable<ReturnType<typeof readStateFile>['state']>;

let state: SharedState | null = null;
let stateWritable = true;
let stateBlockedReason: string | null = null;

/**
 * 目录（**最后一次成功的读数**）与它的状态。
 *
 * ⚠️ 拉失败时**保留**上一次成功的目录（spec §8 的"保留上次缓存"，与 v1 同一条决定），
 *    只把 `catalogStatus` / `catalogError` 换掉 —— 清空的表现是"整个第一部分凭空消失"。
 */
let catalog: ModCatalog | null = null;
let catalogIndex: ModIndex | null = null;
let catalogStatus: ModFoldersState['catalogStatus'] = 'unavailable';
let catalogError: string | null = null;

/** 上游解析结果（**键 = modid**，T1 的 `upstreamLatest`）。抓不到就不放进来 —— 见 `resolveUpstream`。 */
let upstreamLatest: ReadonlyMap<string, ModRelease> = new Map();

/**
 * 扫描读数（键 = folderId）。
 *
 * ⚠️ `rebuild()` 是**同步**的（它要在每一次状态改动后立刻推给页面），而扫盘要
 * `await`（每份 jar 都要算 sha512）⇒ 扫描结果缓存在这里，`rebuild()` 只读它。
 * 没有任何缓存的文件夹 ⇒ 空扫描读数（表现是"这个文件夹里什么都没有"）——
 * 所以"没扫过的文件夹"必须由调用方补一条 notice 说清楚（见 `startUp`）。
 */
const scans = new Map<string, readonly FolderScanEntry[]>();

/** 说出来但状态里没地方放的说明（`ModFoldersState.notices`）：迁移、归属、上游抓不到…… */
const notices: string[] = [];

function pushNotice(text: string): void {
  // 去重：同一个原因在一次会话里只会说一遍（否则每次 rescan 都会再堆一行）
  if (!notices.includes(text)) notices.push(text);
}

/*
 * 这两格今天**永远是 false / null**：写盘路径（Task 5/6）才会动它们。
 * 用 `let` 而不是把字面量写进 `buildState()`，是为了让"谁在改它"只有一个答案
 * （T5/T6 只需在这两行上分别加赋值，不必在组装状态那一处再改一遍）。
 */
const busy = false;
const lastRun: ModFoldersState['lastRun'] = null;

/** 本进程内用户**显式**选过第一部分的游戏版本（决定还要不要跟着已绑定文件夹走）。 */
let gameVersionChosen = false;

/** 空状态（与 v1 的 `emptyState()` 同一条：默认值只住在 `migrateState()` 里）。 */
function emptyState(): SharedState {
  return migrateState({}) as SharedState;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireDeps(): Deps {
  if (deps === null) throw new Error('模块还没初始化');
  return deps;
}

function requireState(): SharedState {
  if (state === null) throw new Error('模块还没初始化');
  return state;
}

function requireIndex(): ModIndex {
  if (catalogIndex === null) {
    throw new Error('目录还没拉到（这条操作的入参要在目录里查得到）');
  }
  return catalogIndex;
}

/** 写盘一次。坏文件连备份都失败时**拒绝写**（v1 的三态读，同一条纪律）。 */
function persist(): void {
  if (!stateWritable) {
    throw new Error(stateBlockedReason ?? '状态文件当前不可写（读不出来且备份失败）');
  }
  writeStateFile(requireState());
}

// ---------------------------------------------------------------------------
// 第一条通道的组装：模板块视图
// ---------------------------------------------------------------------------

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(MOD_FOLDERS_CHANNELS.onStatus, current);
  }
}

function sortedFolders(st: SharedState): [string, SharedState['folders'][string]][] {
  // 排序：`boundAt` 升序（先绑的在前），并列时按 folderId —— readdir/对象键序都不该决定界面顺序
  return Object.entries(st.folders).sort(
    (a, b) => a[1].boundAt - b[1].boundAt || a[0].localeCompare(b[0]),
  );
}

/** Windows 上路径大小写不敏感 ⇒ 判"是不是同一个/在不在里面"之前先归一。 */
function normalizedPath(path: string): string {
  const full = resolve(path);
  return process.platform === 'win32' ? full.toLowerCase() : full;
}

/** `path` 是不是落在 `dir` 里面（§13.1 的判据**只按路径**，spec §13.1）。 */
function isInsideFolder(path: string, dir: string): boolean {
  if (path === '') return false;
  const target = normalizedPath(path);
  const root = normalizedPath(dir);
  return target === root || target.startsWith(root.endsWith(sep) ? root : root + sep);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** 目录行的名字（"已转为文件夹跟踪：<mod 名>"要用它）。查不到就退回 rowId / 文件名。 */
function modNameOf(modid: string | null): string | null {
  if (modid === null || catalogIndex === null) return null;
  return modFor(catalogIndex, modid)?.name ?? null;
}

function nameOfRowId(rowId: string): string {
  const bar = rowId.indexOf('|');
  return modNameOf(bar === -1 ? rowId : rowId.slice(0, bar)) ?? rowId;
}

/** 一个 jar 路径的 mod 名（读不出 modid ⇒ 退回文件名；目录里没有它 ⇒ 退回 modid/文件名）。 */
function nameOfJarPath(path: string): string {
  try {
    return modNameOf(readJarMeta(path).id) ?? basename(path);
  } catch {
    return basename(path);
  }
}

/**
 * 文件夹这一行的**有效**游戏版本：`folders[].gameVersion` 非空就用它，
 * 否则现读 `mmc-pack.json` 推断（`null` = 推断不出来，spec §8 的 `unknown-version`）。
 */
function folderGameVersion(entry: { path: string; gameVersion: string | null }): string | null {
  return entry.gameVersion ?? resolveGameVersion(entry.path);
}

function folderView(folderId: string, entry: SharedState['folders'][string]): ModFolderView {
  const pathExists = isDirectory(entry.path);
  const gameVersion = folderGameVersion(entry);
  const base: ModFolderView = {
    folderId,
    path: entry.path,
    pathExists,
    gameVersion,
    autoUpdate: entry.autoUpdate,
    rows: [],
    unrecognized: [],
  };
  /*
   * ⚠️ 目录不可用 ⇒ **只给表头**（`rows` / `unrecognized` 都空）。
   *    `planFolderView` 的 `catalog` 是必填的，而这时候我们手上没有目录；
   *    喂一份空目录会把每一份扫描读数都标成"清单外 mod"（那是**假话**：
   *    它们很可能就在清单里）。⇒ 宁可什么都不判，让页面上那句"目录不可用"去解释。
   *    没有这一支的话，`catalog === null` 会在 `buildIndex` 里抛 —— 而那是启动路径，
   *    "目录拉不到"绝不该让整个模块炸掉（spec §15）。
   */
  if (catalog === null) return base;
  return planFolderView({
    catalog,
    folderId,
    path: entry.path,
    pathExists,
    gameVersion,
    autoUpdate: entry.autoUpdate,
    scan: scans.get(folderId) ?? [],
    upstreamLatest,
  });
}

/**
 * 组装推给页面的整份状态。
 *
 * ⚠️★ `bulkChannel: st.prefs.bulkChannel` 这一句是**承重的**（Ruling 25）：
 *    它同时钉住"`ModFoldersState` 里有这一格"（对象字面量的多余属性检查）与
 *    "两处是同一个类型"（读 `prefs` 那一格）。T1 里那条编译期断言
 *    （`BULK_CHANNEL_IS_PERSISTED`）就是为这一天准备的，本任务落地之后它成了多余的
 *    公开符号 ⇒ 已删（见 `packages/shared/src/modFolders.ts` 里那段指针注释）。
 */
function buildState(): ModFoldersState {
  const st = state;
  if (st === null) {
    return {
      catalogStatus,
      gameVersion: '1.16.1',
      tagFilter: [],
      bulkChannel: 'origin',
      catalogRows: [],
      folders: [],
      missing: [],
      notices: [],
      busy: false,
      lastRun: null,
    };
  }
  const gameVersion = st.prefs.catalogGameVersion;

  const bindings = new Map<
    string,
    { localPath: string; localVersion: string | null; localSha512: string | null }
  >();
  for (const [rowId, binding] of Object.entries(st.catalogBindings)) {
    bindings.set(rowId, {
      localPath: binding.localPath,
      localVersion: binding.localVersion,
      localSha512: binding.localSha512,
    });
  }

  const catalogRows =
    catalog === null
      ? []
      : planCatalogRows({
          catalog,
          gameVersion,
          tagFilter: st.prefs.tagFilter,
          bindings,
          upstreamLatest,
        });

  const folders = sortedFolders(st).map(([folderId, entry]) => folderView(folderId, entry));

  // 缺失清单的判据是"已绑定文件夹里**命中过**的 modid"（spec §7.5）
  const trackedModids = new Set<string>();
  for (const view of folders) for (const row of view.rows) trackedModids.add(row.modid);
  const missing = catalog === null ? [] : missingMods({ catalog, gameVersion, trackedModids });

  return {
    catalogStatus,
    gameVersion,
    tagFilter: [...st.prefs.tagFilter],
    bulkChannel: st.prefs.bulkChannel,
    catalogRows,
    folders,
    missing,
    // 目录那一条**不是** push 进 notices 的：它是"这一次读数的结论"，成功之后要能消失
    notices: catalogError === null ? [...notices] : [catalogError, ...notices],
    busy,
    lastRun,
  };
}

let current: ModFoldersState = buildState();

/** 重算 + 推给页面（每一次状态改动之后都要走它）。 */
function rebuild(): void {
  current = buildState();
  broadcast();
}

/** 给 preload 的 `getState` 用（也推给页面的那一份）。 */
export function modFoldersState(): ModFoldersState {
  return current;
}

// ---------------------------------------------------------------------------
// 抓目录（`/api/mod-catalog`）
// ---------------------------------------------------------------------------

function setCatalogFailure(status: 'unavailable' | 'invalid', message: string): void {
  catalogStatus = status;
  catalogError = message;
}

async function loadCatalog(): Promise<void> {
  const d = requireDeps();
  const url = new URL('/api/mod-catalog', d.siteOrigin).toString();
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': d.userAgent },
      // 超时（见 CATALOG_TIMEOUT_MS）。**不要 ETag**：这条端点每次都要重新校验，
      // 而"上次那份还能不能用"是服务端的事（它每次返回 200 的完整体）。
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    });
    if (!res.ok) {
      /*
       * 失败**分类**（brief：要能区分 404 / 500 / 坏 JSON）：
       *   · 404 ⇒ 这条端点在服务器上不存在（部署漏了？）—— 与 500 分开说，因为修法不同；
       *   · 5xx ⇒ 服务端读不出/解析不了那份目录，响应体里带 `catalog_*` 机器码与 `problems`
       *     （复用 v1 那三个码，见 `services/api/src/routes/modCatalog.ts`）⇒ 原样带给用户。
       */
      let detail = '';
      try {
        const body = (await res.json()) as { error?: unknown; problems?: unknown };
        const code = typeof body.error === 'string' ? body.error : '';
        const problems = Array.isArray(body.problems)
          ? body.problems.filter((p): p is string => typeof p === 'string').join('；')
          : '';
        detail = [code, problems].filter((s) => s !== '').join(' —— ');
      } catch {
        /* 响应体不是 JSON：下面只说状态码 */
      }
      const suffix = detail === '' ? '' : `（${detail}）`;
      setCatalogFailure(
        'unavailable',
        res.status === 404
          ? `目录不可用：服务器上没有这条端点（HTTP 404）${suffix}`
          : `目录拉取失败：服务器 HTTP ${String(res.status)}${suffix}`,
      );
      return;
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch (error) {
      setCatalogFailure('invalid', `目录的响应体不是合法 JSON：${messageOf(error)}`);
      return;
    }
    const parsed = parseModCatalogWire(body);
    if (!parsed.ok) {
      // 不合契约 ⇒ `invalid`（与"拉不到"分开：这一条是"服务器给了东西，但东西不对"）
      setCatalogFailure(
        'invalid',
        `目录不合契约：${parsed.problems.slice(0, 3).join('；')}${parsed.problems.length > 3 ? ' …' : ''}`,
      );
      return;
    }
    catalog = parsed.catalog;
    catalogIndex = buildIndex(parsed.catalog);
    catalogStatus = 'ok';
    catalogError = null;
    await resolveUpstream(parsed.catalog);
  } catch (error) {
    // 断网 / 超时 / DNS：保留上一次成功的目录（见 `catalog` 的注释）
    setCatalogFailure('unavailable', `目录拉取失败：${messageOf(error)}`);
  }
}

/**
 * 把抓目录串起来（**同一时刻只有一次在跑**）。
 *
 * ⚠️ 启动那一路（`startUp`）与手动的 `rescan()` 都会来拉目录，而"两次并发 fetch 同一个
 * 425 KB 端点"除了浪费带宽什么也换不到 —— 更重要的是**后一次的结果会覆盖前一次**，
 * 于是"启动时那次读到的目录"取决于谁先回来。⇒ 用一条串行队列把顺序固定下来。
 */
let loadQueue: Promise<void> = Promise.resolve();

function queueLoadCatalog(): Promise<void> {
  const next = loadQueue.then(
    () => loadCatalog(),
    () => loadCatalog(),
  );
  loadQueue = next.catch(() => undefined);
  return next;
}

// ---------------------------------------------------------------------------
// 上游解析（spec §7.2 / D1）—— 抓不到就**不放进 map**
// ---------------------------------------------------------------------------

/** 一条上游 release 与另一条是不是同一条（判据 = 字节 + 版本号 + 地址）。 */
function sameRelease(a: ModRelease, b: ModRelease): boolean {
  return a.version === b.version && a.url === b.url && a.sha512 === b.sha512;
}

/**
 * 把一条 Modrinth 版本**收窄**成目录里那种 `ModRelease`。
 *
 * ⚠️ 任何一格对不上契约（没有主文件 / 哈希形状不对 / size 不是非负整数 / 一个游戏版本都没有）
 *    一律 `null` ⇒ 调用方**把这一条从 map 里去掉**（brief：抓不到 / 契约不符 ⇒ 不放进 map，
 *    不是抛错）。方向是安全的：目标退回目录里那条候选，而"只有 `older` 进批量"
 *    保证这仍然是安全的（界面不会因此报错）。
 * ⚠️ `download: 'auto'` 是**这个地方**的判断：上游那一条是能直接下的字节
 *    （`manual` 在目录里表示"只给打开原网页"，而 Modrinth 的版本没有这个概念）。
 */
function upstreamRelease(mod: ModEntry, version: ModrinthVersion): ModRelease | null {
  const file = primaryFileOf(version);
  if (file === null) return null;
  const sha512 = file.hashes.sha512;
  const sha1 = file.hashes.sha1;
  if (typeof sha512 !== 'string' || !/^[0-9a-f]{128}$/.test(sha512)) return null;
  if (typeof sha1 !== 'string' || !/^[0-9a-f]{40}$/.test(sha1)) return null;
  if (!Number.isInteger(file.size) || file.size < 0) return null;
  if (version.game_versions.length === 0) return null;
  if (typeof version.version_number !== 'string' || version.version_number === '') return null;
  return {
    modid: mod.modid,
    version: version.version_number,
    url: file.url,
    sha1,
    sha512,
    size: file.size,
    targetVersions: [...version.game_versions],
    dependencies: [],
    obsolete: false,
    intermediary: [],
    download: 'auto',
  };
}

/**
 * 这个 mod 的哪些游戏版本**可能**用到上游。
 *
 * ⚠️★ 判据是"判定层会不会去问上游"，而那是 `resolveTarget` 的事（T1）：
 *    上游**只在目录在这一版下恰好一条候选时**才参与（Ruling 17）⇒ 0 条或多候选的游戏版本
 *    根本不会用到 `upstreamLatest`，把它们算进来只会让"多个版本必须一致"这条判据
 *    因为无关的版本而失败。
 */
function upstreamGameVersions(c: ModCatalog, index: ModIndex, modid: string): string[] {
  const versions = new Set<string>();
  for (const release of c.releases) {
    if (release.modid !== modid) continue;
    for (const gameVersion of release.targetVersions) {
      if (releasesFor(index, modid, gameVersion).length === 1) versions.add(gameVersion);
    }
  }
  return [...versions].sort();
}

/**
 * 抓所有 `upstream != null` 的 mod 的上游最新版。
 *
 * ⚠️★ **map 只按 `modid` 键控**（T1 的 `upstreamLatest`），而"最新版"是**按游戏版本**解析的
 *    ⇒ 一个 mod 在多个游戏版本上各有一条唯一候选时，同一个 modid 会有多个候选目标。
 *    这里的态度是：**所有相关版本必须解析出同一条**，否则**整个 modid 都不用**
 *    （退回目录那条候选）。理由：把 A 版本的上游包当成 B 版本那一行的目标，
 *    等于给用户一个"更新到另一个游戏版本"的按钮 —— 那是会写坏目录的坏法。
 *    今天（现读 `content/mod-catalog.json`）只有 `mcsrranked` 有 `upstream`，
 *    而它只有 `1.16.1` 那一条 release ⇒ 这一支永远只有一个版本，判据是给将来准备的。
 */
async function resolveUpstream(c: ModCatalog): Promise<void> {
  const d = requireDeps();
  const index = requireIndex();
  const out = new Map<string, ModRelease>();

  for (const mod of c.mods) {
    const upstream = mod.upstream;
    if (upstream === null) continue;
    const gameVersions = upstreamGameVersions(c, index, mod.modid);
    if (gameVersions.length === 0) continue; // 判定层永远不会问上游 ⇒ 连请求都不发

    let versions: ModrinthVersion[];
    try {
      // 复用 v1 的抓取（TTL 缓存 + 退避重试三次）；**不** force：这是启动时的一次检查
      versions = await fetchVersions(upstream.project, {
        force: false,
        userAgent: d.userAgent,
      });
    } catch (error) {
      pushNotice(`上游版本没拿到（${mod.modid}）：${messageOf(error)} —— 目标退回目录里那条候选`);
      continue;
    }

    const resolved: ModRelease[] = [];
    let unusable = false;
    for (const gameVersion of gameVersions) {
      const latest = pickLatestVersion(versions, {
        gameVersion,
        loader: UPSTREAM_LOADER,
        channel: UPSTREAM_CHANNEL,
      });
      const release = latest === null ? null : upstreamRelease(mod, latest);
      if (release === null) {
        unusable = true;
        break;
      }
      resolved.push(release);
    }
    const first = resolved[0];
    if (unusable || first === undefined) {
      pushNotice(
        `上游版本没拿到（${mod.modid}）：上游没有匹配的 release —— 目标退回目录里那条候选`,
      );
      continue;
    }
    if (!resolved.every((release) => sameRelease(release, first))) {
      pushNotice(
        `上游解析在多个游戏版本上不一致（${mod.modid}）：这一次不用上游 —— 目标退回目录里那条候选`,
      );
      continue;
    }
    out.set(mod.modid, first);
  }

  upstreamLatest = out;
}

// ---------------------------------------------------------------------------
// 扫描与游戏版本推断
// ---------------------------------------------------------------------------

/**
 * 扫一个 mods 目录（spec §6.6/§7.1）。
 *
 * - 只取 `.jar`（**`.jar.disabled` 不扫**：游戏不会加载它 —— spec §8 与 §11 都写死了）；
 * - 每个 jar 读 `fabric.mod.json`（读不出来 ⇒ `modid` / `version` 都是 `null`，
 *   由 T1 归到"无法识别"那一栏）；
 * - 每个 jar 算 **sha512**（`judgeRelease` 的第一层判据就是它：`same` 只有字节能回答）。
 *   ⚠️ 代价（认）：每份 jar 都要读一遍盘，真实 mods 目录是 27 MB × 几十份 ⇒ 一次
 *   `rescan()` 是几百 MB 的 I/O。这是"判定要准"的价钱；不扫 sha512 的话每一行都会
 *   退化成"比不出/不同打包"，那比慢更坏。
 * - ⚠️ 签名里的 `gameVersion` 是 brief 钉住的接口，而**扫描这一步与游戏版本无关**
 *   （按版本判定全部发生在 T1 的 `planFolderView` 里）⇒ 这里不用它，也不许在这里判版本。
 */
export async function scanFolder(
  folderPath: string,
  _gameVersion: string | null,
): Promise<FolderScanEntry[]> {
  const names = [...readdirSync(folderPath)].sort();
  const entries: FolderScanEntry[] = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.jar')) continue;
    const path = join(folderPath, name);
    let modid: string | null = null;
    let version: string | null = null;
    try {
      const meta = readJarMeta(path);
      modid = meta.id;
      version = meta.version;
    } catch {
      /* 读不出来：modid/version 都是 null（"无法识别"，不是"这个文件不存在"） */
    }
    let sha512: string | null = null;
    try {
      sha512 = await sha512OfFile(path);
    } catch {
      sha512 = null;
    }
    entries.push({ fileName: name, modid, version, sha512 });
  }
  return entries;
}

/**
 * 从 `folderPath` 向上**最多 4 层**找 `mmc-pack.json`，读 `net.minecraft` 的版本。
 *
 * ⚠️ 两条判据缺一不可（spec §6.6）：
 *   ① 路径里**出现过 `.minecraft`** 这一段。没有它的话，任何一个恰好把
 *      `mmc-pack.json` 放在上面两层的目录都会被当成 Minecraft 实例；
 *   ② 最多 4 层 —— 再往上就走到用户主目录了，那里出现一个同名文件纯属巧合。
 * 读不到返回 `null`（调用方按 spec §8 显示"游戏版本未知"，不给更新按钮）——
 * **不许猜**（Prism / MCSR Launcher 的布局没有实测过，spec §14.5）。
 */
export function resolveGameVersion(folderPath: string): string | null {
  const segments = resolve(folderPath).split(/[\\/]/);
  if (!segments.some((segment) => segment.toLowerCase() === MINECRAFT_DIR)) return null;

  let dir = resolve(folderPath);
  for (let depth = 0; depth < MMC_PACK_MAX_DEPTH; depth += 1) {
    const version = readMmcPackVersion(join(dir, 'mmc-pack.json'));
    if (version !== null) return version;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readMmcPackVersion(path: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { components?: unknown };
    if (!Array.isArray(parsed.components)) return null;
    for (const component of parsed.components) {
      if (!isRecord(component)) continue;
      if (component.uid !== 'net.minecraft') continue;
      const version = component.version;
      if (typeof version === 'string' && version !== '') return version;
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

/** 扫一次并塞进缓存（路径不存在 ⇒ 清掉缓存：下一次它是"路径不存在"的表头）。 */
async function scanInto(folderId: string, folderPath: string): Promise<void> {
  if (!isDirectory(folderPath)) {
    scans.delete(folderId);
    return;
  }
  try {
    scans.set(folderId, await scanFolder(folderPath, null));
  } catch (error) {
    scans.set(folderId, []);
    pushNotice(`读不了这个文件夹（${basename(folderPath)}）：${messageOf(error)}`);
  }
}

// ---------------------------------------------------------------------------
// 已绑定文件夹的增删改
// ---------------------------------------------------------------------------

/** 文件夹 id：**路径的稳定哈希**（同一个目录不会绑出两个实体），与 v1 的 id 无关。 */
function folderIdOf(folderPath: string): string {
  const key =
    process.platform === 'win32' ? resolve(folderPath).toLowerCase() : resolve(folderPath);
  return createHash('sha1').update(key).digest('hex').slice(0, 16);
}

/** 这个路径落在哪个已绑定文件夹里（不在任何文件夹里 ⇒ `null`）。 */
function folderContaining(path: string): string | null {
  for (const [folderId, entry] of sortedFolders(requireState())) {
    if (isInsideFolder(path, entry.path)) return folderId;
  }
  return null;
}

/**
 * 已绑定文件夹的**有效**游戏版本（表头那一格）。
 *
 * ⚠️ "默认取已绑定文件夹的版本"（spec §6.8 / T7 的默认值）：**只在用户还没显式选过**
 *    第一部分的游戏版本时采用，而且**落盘**（`prefs.catalogGameVersion`）——
 *    不落盘的话界面上写着 1.16.1、下次启动又变回去，那是"两处记忆"的另一种形态。
 */
function adoptFolderGameVersion(): void {
  const st = requireState();
  if (gameVersionChosen) return;
  for (const [, entry] of sortedFolders(st)) {
    const inferred = folderGameVersion(entry);
    if (inferred === null || inferred === st.prefs.catalogGameVersion) continue;
    st.prefs.catalogGameVersion = inferred;
    persist();
    return;
  }
}

/**
 * 绑定一个文件夹（**弹主进程自己的原生目录对话框**——路径只能这么来）。
 *
 * 顺序是有意的：
 *   ① 建/复用实体（同一个路径再绑一次不会绑出第二个）；
 *   ② 先扫一次（"绑完马上看得到东西"是这个动作的全部意义）；
 *   ③ §13.1：把这个文件夹**里面**的旧绑定解掉并说出来；
 *   ④ 归属：把文件夹**外面**的 v1 绑定多写一份到 `catalogBindings`；
 *   ⑤ 采纳游戏版本（只在用户没显式选过时）。
 */
async function bindFolder(): Promise<ModFoldersState> {
  const st = requireState();
  const picked = await pickDirectory();
  if (picked === null) return modFoldersState(); // 取消 ⇒ 一个字节都不改

  const folderId = folderIdOf(picked);
  if (st.folders[folderId] === undefined) {
    /*
     * 新文件夹默认 `autoUpdate: true`（与 v1 的 `bind()` 同一条裁决）：
     * 启动时只扫开着开关的文件夹 ⇒ 默认 false 的话，新绑的文件夹在下次启动时会被
     * 启动那一次扫描漏掉，而界面上那个勾选框看起来是开着的。
     */
    st.folders[folderId] = {
      path: picked,
      gameVersion: null, // null = 自动推断（不是"1.16.1"）
      autoUpdate: true,
      boundAt: Date.now(),
    };
  }
  persist();
  await scanInto(folderId, picked);
  migrateBindingsInsideFolder(picked);
  attributeLegacyItems();
  adoptFolderGameVersion();
  rebuild();
  return modFoldersState();
}

/**
 * §13.1：**落在刚绑定的文件夹里面**的绑定 ⇒ 解绑 + 如实报告。
 *
 * ⚠️ 判据**只按路径**（spec §13.1 的字面），不看 modid：一个文件只能有一个归属，
 *    否则用户会在两处看到同一个文件、两处都有更新按钮，而文件夹那一侧的
 *    "清理旧副本"会让另一侧的绑定悬空。
 * ⚠️ 解绑要**说出来**（`已转为文件夹跟踪：<mod 名>`）：它同时改掉用户原来在单文件那一行
 *    的自动更新开关（那个开关被文件夹那一层取代了）⇒ 静默就是"用户的东西悄悄变了"。
 * ⚠️ v1 的 `items` **只删这一种**（路径落在文件夹里的）：其余一个字段都不动。
 */
function migrateBindingsInsideFolder(folderPath: string): void {
  const st = requireState();
  let changed = false;
  for (const [key, item] of Object.entries(st.items)) {
    if (!isInsideFolder(item.localPath, folderPath)) continue;
    delete st.items[key];
    changed = true;
    pushNotice(`已转为文件夹跟踪：${nameOfJarPath(item.localPath)}`);
  }
  for (const [rowId, binding] of Object.entries(st.catalogBindings)) {
    if (!isInsideFolder(binding.localPath, folderPath)) continue;
    delete st.catalogBindings[rowId];
    changed = true;
    pushNotice(`已转为文件夹跟踪：${nameOfRowId(rowId)}`);
  }
  if (changed) persist();
}

/**
 * v1 遗留绑定的归属（Global Constraints 第 2 条第 2 款）。
 *
 * 每一条：读那个 jar 的 modid（读不出来 ⇒ `null`）⇒ `attributeLegacyBindings`（T1）给出
 * `adopt` / `drop` / `keepUnknown` 三份结果 ⇒ 落状态 + **推 notice**。
 *
 * ⚠️★ 游戏版本是**按每一条**算的（brief 的字面）：该 jar 所在文件夹推断出的版本，
 *    推断不到取界面当前选中的版本。而 T1 的 `attributeLegacyBindings` 一次只收
 *    **一个** `selectedGameVersion` ⇒ 这里按版本**分组**调用它（同一份规则、同一个函数，
 *    只是喂进去的版本按组不同）。写成"全部用界面那个版本"就等于把 brief 那半句丢掉。
 * ⚠️ 归属只是**多写一份** `catalogBindings`：v1 的 `items` **不搬走、不剪枝**
 *    （老客户端 0.4 还在读它）。
 * ⚠️ 已经存在的 v2 绑定**不被覆盖**（用户显式绑的那一份更具体）—— 只推一条说明。
 */
function attributeLegacyItems(): void {
  const st = requireState();
  const groups = new Map<string, LegacyBinding[]>();

  for (const [key, item] of Object.entries(st.items)) {
    if (item.localPath === '') continue;
    let modid: string | null = null;
    try {
      modid = readJarMeta(item.localPath).id;
    } catch {
      modid = null;
    }
    const insideFolderId = folderContaining(item.localPath);
    const entry = insideFolderId === null ? undefined : st.folders[insideFolderId];
    const gameVersion =
      (entry === undefined
        ? resolveGameVersion(dirname(item.localPath))
        : folderGameVersion(entry)) ?? st.prefs.catalogGameVersion;
    const list = groups.get(gameVersion) ?? [];
    list.push({ key, localPath: item.localPath, modid, insideFolderId });
    groups.set(gameVersion, list);
  }

  let changed = false;
  for (const [gameVersion, legacy] of groups) {
    const result = attributeLegacyBindings({ legacy, selectedGameVersion: gameVersion });
    for (const { key, rowId } of result.adopt) {
      const item = st.items[key];
      if (item === undefined) continue;
      const existing = st.catalogBindings[rowId];
      if (
        existing !== undefined &&
        normalizedPath(existing.localPath) !== normalizedPath(item.localPath)
      ) {
        pushNotice(`这条绑定没有归属（${key}）：${rowId} 已经有另一份绑定了`);
        continue;
      }
      st.catalogBindings[rowId] = {
        localPath: item.localPath,
        localVersion: item.localVersion,
        localSha512: item.localSha512,
        releaseKey: null,
        // 这一期没有"目录行的自动更新"这条路径 ⇒ 一律 false（不假装它开着）
        autoUpdate: false,
      };
      changed = true;
      pushNotice(`已按 modid 归属到目录行：${nameOfRowId(rowId)} → ${rowId}`);
    }
    for (const key of result.keepUnknown) {
      pushNotice(`这条绑定读不出来，保留原样：${key}`);
    }
    // `result.drop` = 路径落在某个已绑定文件夹里的那些，`migrateBindingsInsideFolder` 已经处理
  }
  if (changed) persist();
}

async function unbindFolder(folderId: unknown): Promise<ModFoldersState> {
  const { folderId: id } = requireFolder(folderId);
  delete requireState().folders[id];
  scans.delete(id);
  persist();
  rebuild();
  return modFoldersState();
}

/**
 * 重扫（只读：**不下载、不写盘**）。
 *
 * ⚠️ 它同时**重拉一次目录**（含上游解析）：这是页面上唯一的"再试一次"入口 ——
 *    没有它的话，"启动时目录没拉到"之后用户只能重启应用（v1 那边有独立的 `check`，
 *    这一期没有对应的通道）。
 */
async function rescan(folderId?: unknown): Promise<ModFoldersState> {
  await queueLoadCatalog();
  const st = requireState();
  const ids =
    folderId === undefined || folderId === null
      ? Object.keys(st.folders)
      : [requireFolder(folderId).folderId];
  for (const id of ids) {
    const entry = st.folders[id];
    if (entry !== undefined) await scanInto(id, entry.path);
  }
  adoptFolderGameVersion();
  rebuild();
  return modFoldersState();
}

function setFolderAutoUpdate(folderId: unknown, on: unknown): Promise<ModFoldersState> {
  const { folderId: id, entry } = requireFolder(folderId);
  if (typeof on !== 'boolean') throw new Error('非法参数：这一项只接受布尔');
  entry.autoUpdate = on;
  persist();
  // 打开开关的人期待的是"它被看着" ⇒ 顺手扫一次（与启动那一次是同一种动作）
  const scan = on && !scans.has(id) ? scanInto(id, entry.path) : Promise.resolve();
  return scan.then(() => {
    rebuild();
    return modFoldersState();
  });
}

function setFolderGameVersion(folderId: unknown, gameVersion: unknown): ModFoldersState {
  const { entry } = requireFolder(folderId);
  if (gameVersion === null) {
    entry.gameVersion = null; // 交回自动推断（spec §8）
  } else {
    entry.gameVersion = requireGameVersion(gameVersion, 'gameVersion');
  }
  persist();
  rebuild();
  return modFoldersState();
}

function setBulkChannel(channel: unknown): ModFoldersState {
  requireState().prefs.bulkChannel = requireChannel(channel);
  persist();
  rebuild();
  return modFoldersState();
}

function setCatalogGameVersion(gameVersion: unknown): ModFoldersState {
  const version = requireGameVersion(gameVersion, 'gameVersion');
  requireState().prefs.catalogGameVersion = version;
  gameVersionChosen = true;
  persist();
  rebuild();
  return modFoldersState();
}

function setTagFilter(tags: unknown): ModFoldersState {
  requireState().prefs.tagFilter = requireKnownTags(tags);
  persist();
  rebuild();
  return modFoldersState();
}

/**
 * 绑定第一部分的一行（Ruling 24）：弹**原生 `.jar`** 对话框 ⇒ `readJarMeta` ⇒
 * **校验那个 jar 的 modid 与 `rowId` 里的一致** ⇒ 写 `catalogBindings[rowId]`。
 *
 * ⚠️★ modid 那一条**不是防御性的**：一行如果指向别的 mod 的文件，§7.3 的
 *    "就位后清旧副本"会按 modid 把**别人的文件**删掉（jars 全在同一个目录里，
 *    而"旧副本"的判据是"同一个 modid 的其余 jar"）。所以不一致就**拒**。
 */
async function bindCatalogRow(rowId: unknown): Promise<ModFoldersState> {
  const row = requireRowId(rowId);
  const picked = await pickOneJar();
  if (picked === null) return modFoldersState();

  let meta: { id: string; version: string };
  try {
    meta = readJarMeta(picked);
  } catch (error) {
    throw new Error(`读不出「${basename(picked)}」里的 fabric.mod.json：${messageOf(error)}`);
  }
  if (meta.id !== row.modid) {
    // 两边的 id 都要报出来（spec §7.1 的同一条）：只说"不匹配"用户不知道是谁错了
    throw new Error(
      `这个文件里的 mod id 是「${meta.id}」，不是「${row.modid}」⇒ 不绑定（${basename(picked)}）`,
    );
  }

  const localSha512 = await sha512OfFile(picked);
  requireState().catalogBindings[row.rowId] = {
    localPath: picked,
    localVersion: meta.version,
    localSha512,
    releaseKey: null,
    autoUpdate: false,
  };
  persist();
  rebuild();
  return modFoldersState();
}

// ---------------------------------------------------------------------------
// 入参校验（「渲染进程说的每个 id 都要在状态或目录里查得到」）
// ---------------------------------------------------------------------------

function requireFolder(folderId: unknown): {
  folderId: string;
  entry: SharedState['folders'][string];
} {
  if (typeof folderId !== 'string' || folderId === '') {
    throw new Error('非法参数：folderId 必须是非空字符串');
  }
  const entry = requireState().folders[folderId];
  if (entry === undefined) throw new Error(`状态里没有这个文件夹：${folderId}`);
  return { folderId, entry };
}

function requireRowId(rowId: unknown): { rowId: string; modid: string; gameVersion: string } {
  if (typeof rowId !== 'string' || rowId === '') {
    throw new Error('非法参数：rowId 必须是非空字符串');
  }
  const bar = rowId.indexOf('|');
  if (bar <= 0) {
    throw new Error(`rowId 的形状不对（应当是「modid|游戏版本」）：${rowId}`);
  }
  const modid = rowId.slice(0, bar);
  const gameVersion = rowId.slice(bar + 1);
  const index = requireIndex();
  if (modFor(index, modid) === null) throw new Error(`目录里没有这个 mod：${modid}`);
  if (releasesFor(index, modid, gameVersion).length === 0) {
    throw new Error(`目录里没有这一行（${modid} 在 ${gameVersion} 下没有 release）：${rowId}`);
  }
  return { rowId, modid, gameVersion };
}

/** 游戏版本必须是目录里真的出现过的那一个（"9.9.9"这类输入当场拒）。 */
function requireGameVersion(gameVersion: unknown, what: string): string {
  if (typeof gameVersion !== 'string' || gameVersion === '') {
    throw new Error(`非法参数：${what} 必须是非空字符串`);
  }
  if (!requireIndex().gameVersions.includes(gameVersion)) {
    throw new Error(`目录里没有这个游戏版本：${gameVersion}`);
  }
  return gameVersion;
}

/** 通道只能是 `'origin'` 或目录镜像表里真有的那条镜像 id（**永远不是一个地址**）。 */
function requireChannel(channel: unknown): Channel {
  if (channel === 'origin') return 'origin';
  if (isRecord(channel) && typeof channel.mirrorId === 'string' && channel.mirrorId !== '') {
    const mirrors = catalog?.mirrors ?? null;
    if (mirrors === null) throw new Error('目录还没拉到（这条操作的入参要在目录里查得到）');
    if (!mirrors.some((mirror) => mirror.id === channel.mirrorId)) {
      throw new Error(`目录里没有这条镜像：${channel.mirrorId}`);
    }
    return { mirrorId: channel.mirrorId };
  }
  throw new Error('非法参数：channel 只能是 "origin" 或 { mirrorId }');
}

/** 标签必须是目录里**用得到**的那些（`tagLabels` 里有名字，或某个 mod 真的带着它）。 */
function requireKnownTags(tags: unknown): string[] {
  if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string' && tag !== '')) {
    throw new Error('非法参数：tags 必须是非空字符串数组');
  }
  const known = catalog;
  if (known === null) throw new Error('目录还没拉到（这条操作的入参要在目录里查得到）');
  const usable = new Set<string>(Object.keys(known.tagLabels));
  for (const mod of known.mods) for (const tag of mod.tags) usable.add(tag);
  for (const tag of tags) {
    if (!usable.has(tag)) throw new Error(`目录里没有这个标签：${tag}`);
  }
  return tags as string[];
}

/**
 * Task 5/T6 才实现的那四条写盘通道。
 *
 * ⚠️★ **为什么把它们也注册**：这一组的全部十五条都是"契约的一部分"
 *    （`preload.ts` 已经逐条转发），而"没注册"与"注册了但拒绝"在页面上的表现
 *    完全一样（都是 `invoke` reject）⇒ 少注册四条的话，Task 5/6 的复审分不清
 *    "还没实现"与"通道名写错了"。这里抛的是一句**说得清**的话。
 *    代价（认）：今天调用它们一定失败 —— 报告里写明了，T5/T6 落地时替换这四行。
 */
function notYetWritePath(what: string): never {
  throw new Error(
    `写盘路径还没实现（${what} 是 Task 5/6 的）—— 这四条通道已经注册，但今天调用一定失败`,
  );
}

// ---------------------------------------------------------------------------
// 装配
// ---------------------------------------------------------------------------

/**
 * 注册十四条 `ipcMain.handle`（第十五条 `onStatus` 是**推**给页面的：主进程只 `send`）。
 *
 * ⚠️ 通道名一律取自 `MOD_FOLDERS_CHANNELS`（`@mcsr/shared/desktop`），**不写字符串字面量**：
 *    写错一个字母**类型检查看不见**，而失败形态是静默的（`invoke` reject / `on` 永不触发）。
 */
function registerIpc(): void {
  ipcMain.handle(MOD_FOLDERS_CHANNELS.getState, () => modFoldersState());
  ipcMain.handle(MOD_FOLDERS_CHANNELS.bindFolder, () => bindFolder());
  ipcMain.handle(MOD_FOLDERS_CHANNELS.bindCatalogRow, (_event, rowId: unknown) =>
    bindCatalogRow(rowId),
  );
  ipcMain.handle(MOD_FOLDERS_CHANNELS.unbindFolder, (_event, folderId: unknown) =>
    unbindFolder(folderId),
  );
  ipcMain.handle(MOD_FOLDERS_CHANNELS.rescan, (_event, folderId: unknown) => rescan(folderId));
  ipcMain.handle(
    MOD_FOLDERS_CHANNELS.setFolderGameVersion,
    (_event, folderId: unknown, gameVersion: unknown) =>
      setFolderGameVersion(folderId, gameVersion),
  );
  ipcMain.handle(
    MOD_FOLDERS_CHANNELS.setFolderAutoUpdate,
    (_event, folderId: unknown, on: unknown) => setFolderAutoUpdate(folderId, on),
  );
  ipcMain.handle(MOD_FOLDERS_CHANNELS.setBulkChannel, (_event, channel: unknown) =>
    setBulkChannel(channel),
  );
  ipcMain.handle(MOD_FOLDERS_CHANNELS.setCatalogGameVersion, (_event, gameVersion: unknown) =>
    setCatalogGameVersion(gameVersion),
  );
  ipcMain.handle(MOD_FOLDERS_CHANNELS.setTagFilter, (_event, tags: unknown) => setTagFilter(tags));
  // Task 5/6 替换这四行（见 `notYetWritePath`）
  ipcMain.handle(MOD_FOLDERS_CHANNELS.updateMod, () => notYetWritePath('updateMod'));
  ipcMain.handle(MOD_FOLDERS_CHANNELS.updateCatalogRow, () => notYetWritePath('updateCatalogRow'));
  ipcMain.handle(MOD_FOLDERS_CHANNELS.updateFolderAll, () => notYetWritePath('updateFolderAll'));
  ipcMain.handle(MOD_FOLDERS_CHANNELS.downloadMissing, () => notYetWritePath('downloadMissing'));
}

/**
 * 初始化：读状态文件 → 注册十四条 IPC → 后台抓目录 + 扫已绑定文件夹。
 *
 * ⚠️ 与 v1 的 `initFileUpdates` 同一条时序纪律：**IPC 的注册发生在第一个 `await`
 *    之前**（`main.ts` 里这个 `await` 在创建窗口之前）—— 反过来的话存在一个
 *    "窗口已经能发消息、主进程还没在监听"的窗口期，那几条消息会被静默丢弃。
 * ⚠️ 状态文件的坏形状由 `readStateFile()`（本任务加固过，Ruling 31）处理：
 *    它已经**备份 + 重建**过了，这里只负责**说出来**（`notify` + `notices`）。
 *    ⚠️ 正常启动时这件事由 `initFileUpdates` 先说了一遍（它在 `main.ts` 里排在前面，
 *    而且读的是同一个文件）⇒ 这里那句 `read.recovered` 通常是 null；
 *    留着它是**兜底**（顺序变了、或那条路第一次没读到）。代价：极少数情况下
 *    （坏文件连备份都失败）用户会看到两个提示框说同一件事。
 */
export async function initModFolders(ctx: { isPackaged: boolean }): Promise<void> {
  /*
   * 基址与 v1 **同一处**（`main.ts` 的 APP_URL / `SITE`），**不新造环境变量**：
   * 这里按 `isPackaged` 重算一遍而不是多收一个参数 —— brief 钉住的签名是
   * `initModFolders({ isPackaged })`，而 `main.ts` 里只允许加**一行**调用。
   * ⚠️ 代价（认）：这段基址推导在 `main.ts` 里还有一份 ⇒ 两处必须同源（都读
   * `VITE_DEV_SERVER_URL` 与 `SITE`）。`verify-mod-folders.mjs` 那条判据
   * （目录真的从 `VITE_DEV_SERVER_URL` 那个 origin 上抓到了）就是它的读数。
   */
  const isDev = !ctx.isPackaged;
  const appUrl = isDev
    ? (process.env.VITE_DEV_SERVER_URL ?? SITE.devServerOrigin)
    : SITE.productionOrigin;
  const siteOrigin = new URL(appUrl).origin;
  deps = {
    siteOrigin,
    userAgent: `mcsr-helper-desktop/${app.getVersion()} (+${siteOrigin})`,
    isPackaged: ctx.isPackaged,
  };

  const read = readStateFile();
  if (read.fatal) {
    stateWritable = false;
    stateBlockedReason = read.fatal;
    state = emptyState();
    console.error('[mod-folders] 状态文件停用：', read.fatal);
    pushNotice(`状态文件读不出来，而且备份也失败了 ⇒ 这一栏不再写盘：${read.fatal}`);
    notify('mod 文件夹的状态文件读不出来，而且备份失败', read.fatal);
  } else {
    stateWritable = true;
    stateBlockedReason = null;
    state = read.state ?? emptyState();
    if (read.recovered !== null) {
      console.error('[mod-folders] 状态文件读不出来（已备份并重建）：', read.recovered);
      pushNotice(read.recovered);
      notify('mod 文件夹的状态文件读不出来', read.recovered);
    }
  }

  registerIpc();
  rebuild();

  // 目录与扫描都在**后台**跑：把一次网络往返放进 `main.ts` 那个 await 就是"窗口要等网络"
  void startUp().catch((error) => {
    console.error('[mod-folders] 启动流程出错：', error);
  });
}

/**
 * 启动那一路：抓目录（含上游解析）→ 扫**开着自动更新的**文件夹 → 采纳游戏版本 → 推。
 *
 * ⚠️★ `autoUpdate` 只表示"**启动时检查并高亮**"（spec §6.8/§13.1），
 *    而它**真的在筛选**（照 v1 的 `startUp` 只查 `autoUpdate === true` 的条目）：
 *    关着开关的文件夹在启动时**不扫**，因此它的行是空的 ⇒ 必须补一条 notice
 *    说明"没开自动更新、所以没扫它"，否则用户看到的是一个**空的**文件夹
 *    （比 v1 那句"显示上次读数"更坏：v1 至少在内存里有上一次的读数）。
 *    **写盘/下载永远要一次点击** —— 扫描是只读的，不改这一条。
 */
async function startUp(): Promise<void> {
  const d = requireDeps();
  if (!d.isPackaged) {
    console.log(
      '[mod-folders] 开发态：启动时照样抓目录 + 扫已绑定文件夹（都是只读操作，不写盘、不下载）',
    );
  }
  await queueLoadCatalog();
  const st = requireState();
  for (const [folderId, entry] of sortedFolders(st)) {
    if (entry.autoUpdate) {
      await scanInto(folderId, entry.path);
    } else {
      pushNotice(
        `这个文件夹没开自动更新（${basename(entry.path)}）：启动时没有扫描它 —— 点一次「重扫」看它的内容`,
      );
    }
  }
  adoptFolderGameVersion();
  rebuild();
}
