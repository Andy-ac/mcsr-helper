/**
 * mod 目录行 + mod 文件夹 —— **主进程那一侧**（Plan 2 / Task 4：读路径；Task 5：单行写路径）。
 *
 * ===========================================================================
 * 这一份负责什么（边界写下来，免得下一个人以为它管得比实际宽）
 * ===========================================================================
 *   · **抓目录**（`/api/mod-catalog`，与 v1 的 `/api/file-catalog` 同一个基址，
 *     **不新造环境变量**）、**解析上游**（spec §7.2 / D1：`upstream != null` 的 mod
 *     目标换成上游最新版）；
 *   · **扫文件夹 / 推断游戏版本**（`scanFolder` / `resolveGameVersion`）；
 *   · **组装 `ModFoldersState` 并推给页面**（`broadcast`）；
 *   · **二十二条 IPC 的注册**（**今天契约 24 个成员**；来处：C 的 T4 之后是 16 个成员：`onStatus` 与 `onProgress` 只推、不 handle；
 *     ⚠️★ T6 删掉了第一部分那三条 —— `bindCatalogRow` / `unbindCatalogRow` /
 *     `updateCatalogRow`，契约 17 → 14，裁决 B；⚠️ C 的 T3 加 `onProgress`（15）、
 *     T4 加 `cancelDownload`（16）、**B2 的 T4** 加 `downloadPack`（17）—— 后三条**都没有**加 handler 之外的注册面；
 *     ★★ **D1 的 T4** 加那七条（`probeLaunchers` / `listLauncherInstances` / `setInstancePaths` /
 *     `addLauncher` / `removeLauncher` / `setInstanceTracked` / `confirmInstance`）⇒
 *     契约 17 → **24**、handler 15 → **22**：**七条全是 handler**（这一组里只推不 handle 的
 *     仍然只有 `onStatus` / `onProgress` 那两条，所以"通道数 − 2 = handler 数"照旧成立））；
 *   · ★ **写盘**（Task 5 单行 / Task 6 批量）：`updateMod`（文件夹里那一行）、
 *     **整夹更新** `updateFolderAll`、**缺失下载** `downloadMissing`、**B2 的整包下载** `downloadPack`
 *     —— 四个入口共用
 *     `installRelease` 同一段写盘（spec §7.3 的那几步）。**这是整个特性里唯一会写用户磁盘的地方**。
 *     ⚠️ T6 之前是四个入口，第四个（`updateCatalogRow`）随第一部分一起删了。
 *     ⚠️ 两道闸分住两处（不是一处）：`installRelease` 管"这一个目标位置能不能动"（Ruling 47/48），
 *     而"这一**行**该不该装"由**各个入口自己**过 `assertUpdatable`（见那里为什么不许挪进 `installRelease`）。
 *   · **判断一条都不在这里**：`planCatalogRows` / `planFolderView` / `missingMods` /
 *     `migrateState` / `channelUrl` / `originFileNameOf`
 *     ⚠️★ T6 之后 `attributeLegacyBindings`（v1 绑定归属那一条）**不再被本模块调用** ——
 *     它连同 `catalogBindings` 一起退役了（D8 / 裁决 B；那个函数本身仍在 `@mcsr/shared` 里）
 *     全部来自 `@mcsr/shared`（T1 / Plan 1）——那里才有能红的断言钉着
 *     （`services/api/src/mod-folders-shared.test.ts`），而 `apps/desktop` **没有测试运行器**。
 *   · **I/O 也不在这里**：`readJarMeta` / `sha512OfFile` / `downloadTo` /
 *     `installDownloadedFile` / `assertNotBusy` / `readStateFile` / `writeStateFile` /
 *     `fetchVersions` / `pickDirectory` / `notify`
 *     ⚠️★ `pickOneJar`（弹 `.jar` 对话框）T6 之后**只有本模块不再用它**（它在本模块里唯一的
 *     调用方是第一部分那条 `bindCatalogRow`）⇒ 已从本文件的 import 里删掉。
 *     ⚠️★ **v1 仍然在用**（别把它从 `file-updates.ts` 删掉）：`FILE_UPDATES_CHANNELS.bind`
 *     → `file-updates.ts` 的 `bind()`（`:1138`）→ `pickOneJar()`（`:1140`）。
 *     全部**复用** `./file-updates`（Task 3 抽出来的那一批）。
 *     复制一份的下场与本仓踩过的每一次都同型：两份迟早漂，而漂的那一份在动用户的文件。
 *
 * ===========================================================================
 * 入参纪律（与 `preload.ts` 文件头那一段逐条对应）
 * ===========================================================================
 * 渲染进程加载的是**远程网页**。所以这一层每一个 handler 的入参只有
 * **id / 游戏版本字符串 / 标签数组 / 布尔**，**永远没有路径、没有 URL**：
 *   · 选目录由主进程弹**自己的原生对话框**（`pickDirectory`）—— ⚠️ T6 之后本模块
 *     **不再有**"选一个 `.jar`"这条入口（第一部分那一行是它唯一的用处）；
 *   · `channel` 只是 `'origin'` 或 `{ mirrorId }`，而那个 `mirrorId` **必须在目录的
 *     `mirrors[]` 里查得到**（查不到 ⇒ 抛）—— 地址是主进程用 `channelUrl` 拼的。
 * ⇒ "写到哪里、从哪儿取"都不是页面说了算。`requireFolder` / `requirePairKey` /
 *   `requireChannel` / `requireGameVersion` / `requireKnownTags` 是这一条的落地点
 *   （⚠️ T6：`requireRowId` 随第一部分删了；`requireTags` 那一格的名字一直是
 *   `requireKnownTags`，顺手改准）。
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
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { SITE } from '@mcsr/shared';
import { MOD_FOLDERS_CHANNELS } from '@mcsr/shared/desktop';
import type { ByteSample, DownloadProgress, TimedSample } from '@mcsr/shared/downloadProgress';
import { shouldPush } from '@mcsr/shared/downloadProgress';
import {
  type LauncherFs,
  type LauncherInstance,
  type LauncherKind,
  listInstances,
  missingInstancesDir,
} from '@mcsr/shared/launcherInstances';
import {
  buildIndex,
  type ModCatalog,
  type ModIndex,
  type ModRelease,
  modFor,
  originFileNameOf,
  releasesFor,
} from '@mcsr/shared/modCatalog';
import {
  type Channel,
  channelUrl,
  type FolderVerdict,
  type InstancePref,
  type InstanceView,
  instanceViewsOf,
  isKnownGameVersion,
  isKnownMirror,
  type LauncherBinding,
  type LauncherBindingView,
  type ModFolderRowView,
  type ModFoldersState,
  type ModFolderView,
  missingMods,
  planCatalogRows,
  planFolderView,
  scanTargetOf,
  reconcileFolders as sharedReconcileFolders,
  type TagOptionView,
} from '@mcsr/shared/modFolders';
import { type PackSkipReason, packPlanFor } from '@mcsr/shared/modPacks';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import {
  assertNotBusy,
  downloadTo,
  installDownloadedFile,
  messageOf,
  notify,
  pickDirectory,
  readJarMeta,
  sha512OfFile,
  sharedStateFile,
  stateFileBlocked,
  writeStateFile,
  yieldToEventLoop,
} from './file-updates';
import {
  catalogErrorOf,
  catalogIndexOf,
  catalogOf,
  catalogStatusOf,
  fetchPack,
  initCatalog,
  queueLoadCatalog,
  upstreamLatestOf,
} from './mod-folder-catalog';
import {
  ensureScans,
  forgetScan,
  initScan,
  isDirectory,
  queueScan,
  readingOf,
  resolveGameVersion,
} from './mod-folder-scan';

// ---------------------------------------------------------------------------
// 常量与模块状态
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 目录那五格（目录 / 索引 / 状态 / 错误 / 上游 map）与扫描读数**都不在这个文件里**
 *    （Task 6 按复审给的切法拆走了）：`mod-folder-catalog.ts`（抓取 + 上游）与
 *    `mod-folder-scan.ts`（扫描）。这一份只**读**它们，用的是那两个模块的只读访问口
 *    （`catalogOf` / `catalogIndexOf` / `catalogStatusOf` / `catalogErrorOf` /
 *    `upstreamLatestOf` / `readingOf`），而**写**它们的路只有 `queueLoadCatalog()` 与 `queueScan()`。
 */

interface Deps {
  siteOrigin: string;
  userAgent: string;
  isPackaged: boolean;
}

let deps: Deps | null = null;

/**
 * 状态文件的内存副本。类型取自 `sharedStateFile()` 的返回值（v1 把那个类型收窄成
 * "`items` 逐条补过默认值"，而 `StateFile` 那个名字没有导出）——
 * ⚠️ 这样写等于**复用** v1 的收窄，而不是在这里再 cast 一次。
 *
 * ⚠️★ 它**不是**本模块自己的副本（Ruling 38）：`sharedStateFile()` 交出来的就是
 *    v1 那个 `stateFile` **同一个对象**。两个写者共用一份内存 ⇒ 谁都不会把对方的
 *    字段写回旧值（"各持一份 + 写前合并磁盘"救不了这一半，理由见 `writeStateFile`
 *    与 `sharedStateFile` 的注释）。
 */
type SharedState = ReturnType<typeof sharedStateFile>;

/** 说出来但状态里没地方放的说明（`ModFoldersState.notices`）：迁移、归属、上游抓不到…… */
const notices: string[] = [];

function pushNotice(text: string): void {
  // 去重：同一个原因在一次会话里只会说一遍（否则每次 rescan 都会再堆一行）
  if (!notices.includes(text)) notices.push(text);
}

/*
 * 写盘期间的两格（Task 5 起**真的会变**；Task 4 里它们是 `const false` / `const null`，
 * 被 biome 的 `useConst` 钉住 —— 那是"本轮没有任何赋值"的实情，不是设计）。
 *
 * · `busy`：一次写盘流程从起手到收尾都是 `true`（页面据此禁用按钮，v1 的 `busyItemId` 同一个意思）。
 *   ⚠️ 它与 v1 的 `bulkRunning` / `busyItemId` **不是同一个标记**：v1 那两个只覆盖 v1 的写盘，
 *   而这个模块自己的并发由 `writeRun` 再挡一层（见那里的注释）。
 * · `lastRun`：**上一次运行的结果**（spec §7.4 的批量汇总；单行更新也是一次运行 ⇒ 一条记录）。
 *   失败时也写（`failed: [{modid, reason}]`）—— IPC 那一侧会 reject，而这句话关掉之后就再也查不到了。
 */
let busy = false;
let lastRun: ModFoldersState['lastRun'] = null;

/**
 * ★ 子项目 C：**这一趟**的运行上下文。
 *
 * ⚠️★ 为什么可以是一个模块级变量：本模块的写盘**本来就是串行的**
 *    （`writeRun` / `bulkRun` 起手都拿 `busy` 挡住第二次），所以"同时只有一趟"不是假设、
 *    是那两条外壳已经保证的事实。把上下文做成参数会要改 `installRelease` 的签名，
 *    而它是"两个写入口共用"的那一段 —— 少动它一个字节就少一分风险。
 * ⚠️ 它**不落盘**：`lastRun` 那样"上一趟到底怎么了"的读数才需要跨启动留存，
 *    而进度是"此刻"的事（进程重启后没有正在跑的趟）。
 */
interface RunContext {
  run: DownloadProgress['run'];
  folderId: string;
  controller: AbortController;
  runStartedAt: number;
  itemIndex: number;
  itemCount: number;
  /**
   * ★★ D1 · T9（spec A20）：**这一趟**"真的写盘成功"的文件数（累计）。
   *
   * ⚠️★★ 它与上面那两格**不是一类**，所以**归零的时机也不同**：
   *    · `itemIndex` 是"处理到第几项" ⇒ `setRunItem()` **每一项**都动它；
   *    · 这一格是"这一趟真的写下去几个文件" ⇒ 只有 `beginRun()` 把它归零，
   *      而 `setRunItem()` **一个字节都不许碰它**（归错的表现是界面上的"已更新"
   *      每换一项就跳回 0 —— 那正是"看起来在工作"的那一类坏法）。
   * ⚠️ 只有"真的写盘成功"才 +1（四个计数点各自就写在 `lastRun.updated.push(...)` 旁边）：
   *    跳过（`skipped`）与失败（`failed`）、取消（`cancelled`）**都不加**。
   */
  updatedCount: number;
  phase: DownloadProgress['phase'];
  cancelling: boolean;
  modid: string;
  fileName: string;
  received: number;
  total: number;
}

let activeRun: RunContext | null = null;

/** 这一刻该推给页面的进度（没有在跑 ⇒ `null`）。**唯一**构造它的地方。 */
let progress: DownloadProgress | null = null;

function refreshProgress(): void {
  progress =
    activeRun === null
      ? null
      : {
          run: activeRun.run,
          phase: activeRun.phase,
          folderId: activeRun.folderId,
          modid: activeRun.modid,
          fileName: activeRun.fileName,
          received: activeRun.received,
          total: activeRun.total,
          itemIndex: activeRun.itemIndex,
          itemCount: activeRun.itemCount,
          /* ★ T9：本趟累计（**每一帧**都带上它 —— 含写盘相位与终帧）。 */
          updatedCount: activeRun.updatedCount,
          runStartedAt: activeRun.runStartedAt,
          cancelling: activeRun.cancelling,
        };
}

/** 一趟起手。`itemCount` = 这一趟**打算开工的项数**（跳过的行不算）。 */
function beginRun(input: {
  run: DownloadProgress['run'];
  folderId: string;
  itemCount: number;
}): void {
  activeRun = {
    run: input.run,
    folderId: input.folderId,
    controller: new AbortController(),
    runStartedAt: Date.now(),
    itemIndex: 0,
    itemCount: input.itemCount,
    /*
     * ★★ T9（A20）：「这一趟真的写下去几个文件」从这里**重新开始数**（每一趟一趟的累计）。
     *    ⚠️ 归零**只在这里**（`endRun()` 把 `activeRun` 整个丢掉，不是它；`setRunItem()` 不碰它）。
     */
    updatedCount: 0,
    phase: 'download',
    cancelling: false,
    modid: '',
    fileName: '',
    received: 0,
    total: 0,
  };
  /*
   * ★ 起手这一幕**故意不推帧**（`progress = null`，而不是 `refreshProgress()`）：契约写的是
   *   项序**1 起**，而这一刻 `itemIndex` 还是 0、`modid` / `fileName` 还是空串 ⇒ 推出去的那一帧
   *   就是"0/2 + 空文件名"，页面会闪一下（它同时是"项序从 1 起"那条判据的一个假红窗口）。
   *   ⚠️ "这一趟已经起手"由 `busy` 那一格体现 —— 两条外壳紧接着的 `rebuild()` 会把它推出去；
   *   真正的第一帧由 `setRunItem` 产生，那时项序已经是 1。
   */
  progress = null;
  /*
   * ★ C/S3：节流的"上一次样本"也**归零**（理由与 `endRun` 里那一句相同：两趟之间比差没意义）。
   *    ⚠️ 这一句**不是**"起手推一帧"—— 它在 `progress = null` 之后、而且不调 `pushProgress`：
   *    起手仍然一帧都不推（上面那一段）。
   */
  lastPush = null;
}

/**
 * 换一项：项序 +1、字节归零、相位回到 `download`。
 *
 * ⚠️★★ T9（A20）：这个函数归零的是"**这一项**"的字段（字节 / 相位）——
 *    `updatedCount` 是"**这一趟**"的累计，**这里一个字节都不许碰它**。
 *    归错的表现是"每换一项，界面上的『已更新』就跳回 0"：它看起来完全正常
 *    （数字一直在动），而用户永远看不到"这一趟已经装成几个"。
 *    判据：`verify-mod-folders.mjs` 的「`updatedCount` 只数成功的」那一条
 *    （夹具里一项成、一项跳、一项失败 ⇒ 终帧必须是 **1**；每进一项就加一 ⇒ 3）。
 */
function setRunItem(input: { modid: string; fileName: string }): void {
  if (activeRun === null) return;
  activeRun.itemIndex += 1;
  activeRun.modid = input.modid;
  activeRun.fileName = input.fileName;
  activeRun.received = 0;
  activeRun.total = 0;
  activeRun.phase = 'download';
  refreshProgress();
  // ★ C/S3：**换项必须立刻让页面看到**（D3：换项那一帧不受 100 ms 下限约束）
  pushProgress(true);
  rebuild();
}

/**
 * ★★ T9（spec A20）：**这一趟又有一个文件真的写下去了** ⇒ 累计 +1。
 *
 * ⚠️★ 它**只**该出现在"真的写盘成功"的落点上（下一句就是
 *    `lastRun.updated` 记账的那几处）—— **不另造第二个判据**：
 *    "这个文件真的写下去了"这件事在那些地方**已经**被记账了，两处各判一次必然漂。
 * ⚠️★ 它**不是**"处理了一项"：跳过（`skipped`）、失败（`failed`）、取消（`cancelled`）
 *    三条路上的分支**一处都不许调它** —— 那正是这条判据要钉的事（A20 的字面：
 *    跳过与失败**都不算**）。
 * ⚠️★★ **这里必须自己推一帧**（`pushProgress(true)`，不受 D3 的 100 ms 下限约束）：
 *    这一格是"进行中就要看得见"的读数（brief 的 UI 那一条），而**单行**那两趟
 *    （`itemCount === 1`）在它 +1 之后往往**再没有别的帧**：`installRelease` 那个
 *    `notePhase('install')` 帧是在**写盘之前**推的（那一刻还没装成），而紧接着
 *    `endRun()` 就把 `progress` 清成 `null` 了 ⇒ 不推这一帧的话，"已更新 1"
 *    在单行这条路上**一次都到不了页面**（只活在主进程那个变量里）。
 *    ⚠️ 批量那一侧它照样是安全的：`force` 只让 100 ms 那条下限失效，
 *    `itemIndex` / `itemCount` / 字节那几格一个都没动（T3 的节流判据只比 `download`
 *    相位的帧间隔，而这一帧的相位是 `install`）。
 * ⚠️ 顺序：`refreshProgress()` 先算好这一趟的帧，`pushProgress` 再读**同一个**
 *    `progress` 变量（两条载体不是两份真相 —— 见 `pushProgress` 头顶那一段）。
 */
function noteUpdated(): void {
  if (activeRun === null) return;
  activeRun.updatedCount += 1;
  refreshProgress();
  pushProgress(true);
}

/** 相位（写盘那一段没有字节 —— 那不是网络流量）。 */
function notePhase(phase: DownloadProgress['phase']): void {
  if (activeRun === null) return;
  activeRun.phase = phase;
  refreshProgress();
  // ★ C/S3：**换相位必须立刻让页面看到**（同 `setRunItem`：这是 D3 的 `force` 那一支）
  pushProgress(true);
  rebuild();
}

/** 字节（**每一个 chunk 一次**，不在这里 `rebuild()` —— 见 `progress` 那一格的分工）。 */
function noteBytes(sample: ByteSample): void {
  if (activeRun === null) return;
  activeRun.received = sample.received;
  activeRun.total = sample.total;
  refreshProgress();
  // ★ C/S3：**高频**那一条载体（真正的节流在 `pushProgress` 里，这里只交读数）
  pushProgress();
}

/** 一趟收尾：**清干净**（界面靠这一次 `rebuild()` 知道"没有在跑了"）。 */
function endRun(): void {
  activeRun = null;
  refreshProgress();
  /*
   * ⚠️★ 把节流的"上一次样本"也清掉：不清的话，**下一趟**的第一帧会拿上一趟最后一次读数
   *    与"上一趟的时刻"比 —— 那两件事属于两趟，比出来的差没有意义（D3 的窗口是"这一趟"的）。
   */
  lastPush = null;
}

/**
 * ★ 子项目 C：停掉正在跑的那一趟（D4）。
 *
 * ⚠️★ **写盘阶段一律拒**，理由**不是**"中断两次 `rename` 之间那个窗口会留下半成品"，
 *    而是 **D4 那条明文：不许回 `{ok:true}` 却其实停不下来**。写盘这一趟会**照常装完**
 *    并把它记进 `updated`（用户以为停了、其实没停）；而 `cancelling` 这个标志还会让
 *    **批量里剩下的项**停下 ⇒ 用户"点了一个不该点的按钮，却拿到了半趟的副作用"。
 * ⚠️★ 上面那半句（"会留下半成品"）**今天不可复现**，写在这里免得下一个人拿它当理由：
 *    `installDownloadedFile` 通体只有两次 `renameSync`、**没有 `await`、也不消费 `signal`**，
 *    而 `notePhase('install')` 是在调它**之前**同步推出来的 ⇒ 那个窗口里 `abort()` 对文件
 *    **没有任何作用**（写盘那一段今天全同步）。⇒ "盘上没坏"是**必然**，不是运气。
 *    **假如**将来那一段变成异步、或者开始消费 signal，那半句立刻变成实打实的原因
 *    （那时它才是"拒绝"的第一条理由）。
 *    界面那一侧同时把按钮置灰并写明"正在写入，稍候"。
 * ⚠️ 幂等：已经在取消中 ⇒ 再点一次仍然 `{ok:true}`（页面可能连点两下）。
 *    ⚠️★ 这一支与"写盘阶段拒"的**先后顺序是承重的**（见函数体里那一段）。
 * ⚠️★ "谁来 abort"只在这里：`installRelease` 早就在 `downloadTo` 上传了
 *    `signal: activeRun?.controller.signal`（T2），所以这里 `abort()` 就是**中断这一趟
 *    HTTP 请求**的那一下。⛔ `abort()` 之后的事情都有主：`downloadTo` 抛 ⇒
 *    `installRelease` 的 `catch` 删掉 `.part` 再抛 ⇒ 两条外壳的 `catch` 按
 *    `activeRun.cancelling` 决定"记进 `cancelled` 且**不** reject"（取消不是失败）。
 * ⚠️★ **"正在取消"那一帧要上高频通道**（I1，最终修复波）：页面渲染用的一帧来自
 *    `progressOf(state, live)`，而它**推送优先于状态**（`live ?? state.progress`）。
 *    只 `rebuild()` 的话这一格到不了页面：那一刻 `live` 里还是取消**之前**那一帧
 *    （`cancelling: false`），而 `abort()` 之后没有新的字节帧（`noteBytes` 不再被调）⇒
 *    页面读到的 `view.cancelling` 恒为 `false` ⇒ 按钮文案永远不变、也不会进入"不可再点"
 *    的形态（spec §4 明写的行为没落地）。
 *    ⇒ 照 `notePhase` 的写法补一次 `pushProgress(true)`：`cancelling` 是"换相位"那一类
 *    **必须立刻让页面看到**的东西，不受 D3 的 100 ms 下限约束。
 * ⚠️ 而"这一项会照常装完"（写盘相位拒）**只走** `rebuild()`：那一支不改任何一格，
 *    没有高频帧要发。
 * ⚠️ `rebuild()` 与 `pushProgress(true)` 都在 `abort()` **之前**：页面靠它们把按钮变成
 *    「正在取消…」，而 `abort()` 之后这一趟马上就开始收尾了（页面随即读到 `progress: null`）。
 *    ⚠️ 两条通道读的是**同一个** `progress` 变量（`pushProgress` 自己调 `refreshProgress()`）
 *    ⇒ 它们不可能互相矛盾，只是新鲜度不同。
 */
function cancelDownload(): { ok: true } | { ok: false; reason: string } {
  if (activeRun === null) return { ok: false, reason: '没有在跑' };
  /*
   * ⚠️★ **这两支的先后顺序是承重的**：`cancelling` 必须排在"写盘阶段拒"**之前** ——
   *    取消被受理之后那一项会走到写盘相位，用户再点一次时事实是"**这一趟正在被取消**"
   *    ⇒ 幂等地回 `{ok:true}`。反过来排的话他拿到的是"正在写入，这一趟不能取消"，
   *    而那句话对一趟**正在被取消**的运行是假话（听起来像"你的取消被撤回了"）。
   * ⚠️★ 写盘相位拒对**新的**取消请求（`cancelling === false`）**照常生效** —— 别删它：
   *    它守的是 D4 那条明文（不许回 `{ok:true}` 却其实停不下来），理由写在函数头。
   */
  if (activeRun.cancelling) return { ok: true };
  if (activeRun.phase === 'install') {
    return {
      ok: false,
      reason: '正在写入，这一趟不能取消（写盘已经开始，取消也停不下来，这一趟会照常装完）',
    };
  }
  activeRun.cancelling = true;
  refreshProgress();
  /*
   * ★★ I1：`cancelling: true` 这一帧**两条通道都要发**。`pushProgress(true)` 就是
   *    "换相位"那一类（force ⇒ 不吃节流），载荷里带着 `cancelling: true`
   *    （`pushProgress` 读的就是 `refreshProgress()` 刚算出来的同一个 `progress`）。
   */
  pushProgress(true);
  rebuild(); // ★ 页面据此把按钮变成「正在取消…」
  activeRun.controller.abort();
  return { ok: true };
}

/**
 * 这一趟是否已被要求取消（**现读**模块级的 `activeRun`）。
 *
 * ⚠️★ 为什么要一个函数、而不在调用处直接写 `activeRun?.cancelling === true`：
 *    `tsc` 会**跨 `await` 保留窄化** —— 循环顶上那次 `if (... === true) break;` 之后，
 *    它把 `activeRun.cancelling` 窄成 `false | undefined`，于是 `try` 的 `catch` 里
 *    同一个表达式被判成"两个类型没有重叠"（**TS2367**，实测）。而那一刻的事实正好相反：
 *    取消是在 `await installFolderRow(...)` **期间**到的（D4 的现场就是它）⇒
 *    窄化在这里是**假话**。函数调用是窄化过不去的边界，读数因此是现读的、类型检查也认。
 */
function isCancelling(): boolean {
  return activeRun?.cancelling === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireDeps(): Deps {
  if (deps === null) throw new Error('模块还没初始化');
  return deps;
}

/**
 * 进程内那份状态（**与 v1 共用的同一个对象**，Ruling 38）。
 *
 * ⚠️ 不在这里缓存引用：`sharedStateFile()` 每次现取 —— v1 只在 `initFileUpdates` 里
 *    换过这个对象一次（那时本模块还没跑），而"每次现取"让"将来谁再换一次"也不会让
 *    本模块手里握着一个孤儿对象。
 */
function requireState(): SharedState {
  return sharedStateFile();
}

function requireIndex(): ModIndex {
  const index = catalogIndexOf();
  if (index === null) {
    throw new Error('目录还没拉到（这条操作的入参要在目录里查得到）');
  }
  return index;
}

/** 写盘一次。坏文件连备份都失败时**拒绝写**（v1 的三态读，同一条纪律）。 */
function persist(): void {
  const blocked = stateFileBlocked();
  if (blocked !== null) throw new Error(blocked);
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

/**
 * ★ 子项目 C：**高频**那一条载体（D3 节流）。整份状态一步都不推 —— 它只发这一帧。
 *
 * ⚠️ 节流判据住在共享内核（`shouldPush`，T1 的纯函数 + 单测）：这里只负责
 *    "盖时间戳、问一句、发出去"，不重新实现一遍阈值（两个地方各写一个数字迟早会漂）。
 * ⚠️★ 与 `broadcast()` 的分工：这一条**没有对应的 `rebuild()`** —— `noteBytes` 每个 chunk
 *    都调它，而"整份状态"那一份（`onStatus`）只在换项/换相位/收尾时推（`rebuild` 的调用点）。
 *    ⚠️ 载荷是 `refreshProgress()` 刚算出来的**同一个** `progress`（与 `buildState()` 读的是
 *    同一个变量）⇒ 两条载体不是两份真相。
 * ⚠️ `force`：换项与换相位必须**立刻**让页面看到（D3："换项/换相位不受 100 ms 约束"）。
 */
let lastPush: TimedSample | null = null;

function pushProgress(force = false): void {
  if (activeRun === null) return;
  const next: TimedSample = {
    at: Date.now(),
    received: activeRun.received,
    total: activeRun.total,
  };
  if (!shouldPush({ last: lastPush, next, force })) return;
  lastPush = next;
  refreshProgress();
  const frame = progress;
  if (frame === null) return;
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(MOD_FOLDERS_CHANNELS.onProgress, frame);
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

/**
 * 两个路径是不是**同一个文件**（Windows 大小写不敏感 ⇒ 先归一）。
 *
 * ⚠️ 空串在这里一律**不相等**（`resolve('')` 是当前工作目录，那不是一个文件）——
 *    调用方在拿它判"要不要跳过/拒绝"时，空串必须落到"不匹配"那一侧。
 */
function samePath(a: string, b: string): boolean {
  if (a === '' || b === '') return false;
  return normalizedPath(a) === normalizedPath(b);
}

/** `path` 是不是落在 `dir` 里面（§13.1 的判据**只按路径**，spec §13.1）。 */
function isInsideFolder(path: string, dir: string): boolean {
  if (path === '') return false;
  const target = normalizedPath(path);
  const root = normalizedPath(dir);
  return target === root || target.startsWith(root.endsWith(sep) ? root : root + sep);
}

/** 目录行的名字（"已转为文件夹跟踪：<mod 名>"要用它）。查不到就退回 rowId / 文件名。 */
function modNameOf(modid: string | null): string | null {
  const index = catalogIndexOf();
  if (modid === null || index === null) return null;
  return modFor(index, modid)?.name ?? null;
}

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
  /*
   * ★★ **Ruling 65**（2026-10-03 T8 评审）：这一格是"我们真的读到过这个目录吗"，
   *    与"里面有什么"（`rows`）是**两件事** —— 扫描失败时 `readingOf(id).ok` 是 false
   *    而 `entries` 是空的，界面拿 `rows.length === 0` 猜就会把"读不了"说成"里面什么都没有"。
   *    ⇒ 如实报上去（`readingOf` 是那份读数的唯一出处，不另算一遍）。
   */
  const hasReading = readingOf(folderId).ok;
  const base: ModFolderView = {
    folderId,
    path: entry.path,
    pathExists,
    hasReading,
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
   *    没有这一支的话，`catalogOf() === null` 会在 `buildIndex` 里抛 —— 而那是启动路径，
   *    "目录拉不到"绝不该让整个模块炸掉（spec §15）。
   */
  const known = catalogOf();
  if (known === null) return base;
  return planFolderView({
    catalog: known,
    folderId,
    path: entry.path,
    pathExists,
    hasReading,
    gameVersion,
    autoUpdate: entry.autoUpdate,
    scan: readingOf(folderId).entries,
    upstreamLatest: upstreamLatestOf(),
  });
}

/** 模块加载时 / `initModFolders` 之前的占位状态（没有任何东西可读）。 */
function placeholderState(): ModFoldersState {
  return {
    catalogStatus: catalogStatusOf(),
    gameVersion: '1.16.1',
    // 目录还没读到 ⇒ 这三格**空着**（不是猜一个）：界面据此把选项表画成"只有当前值"
    gameVersions: [],
    tags: [],
    mirrors: [],
    tagFilter: [],
    bulkChannel: 'origin',
    catalogRows: [],
    folders: [],
    /*
     * ★★ D1（T4）：模块还没初始化 ⇒ **还没有任何绑定、也还没有读过实例**
     * （`instancesStatus: 'reading'` —— 界面据此说"正在读取…"，而不是"你一个实例都没有"）。
     */
    launchers: [],
    instances: [],
    instancesStatus: 'reading',
    missing: [],
    missingStatus: 'catalog-unavailable',
    notices: [],
    busy: false,
    progress: null,
    lastRun: null,
  };
}

/**
 * 目录里的**标签全集**（Ruling 58）：`tagLabels` 的键 ∪ 各个 mod 真的带着的标签。
 *
 * ⚠️★ 口径必须与主进程的 `requireKnownTags()` **逐字相同**（同一个 `usable` 集合）：
 *    那个集合决定 `setTagFilter` 收不收这个键 ⇒ 两边不一致的表现是"界面上有一个选项、
 *    点下去被拒"（或者反过来：一个合法的键在界面上选不到）。
 * ⚠️ 没有显示名的标签两种语言都退化成 key 本身（目录缺陷要看得见，与 `tagLabelsOf` 同一条）。
 * ⚠️ 顺序：`tagLabels` 的键（目录 JSON 里的顺序）在前、mod 带出来的标签按 `mods` 顺序在后
 *    ⇒ 可复现（界面不排序，直接照这个顺序画）。
 */
function tagOptionsOf(catalog: ModCatalog): TagOptionView[] {
  const keys = new Set<string>(Object.keys(catalog.tagLabels));
  for (const mod of catalog.mods) for (const tag of mod.tags) keys.add(tag);
  return [...keys].map((key) => ({
    key,
    labels: catalog.tagLabels[key] ?? { zh: key, en: key },
  }));
}

/**
 * 组装推给页面的整份状态。
 *
 * ⚠️★ `bulkChannel: st.prefs.bulkChannel` 这一句是**承重的**（Ruling 25）：
 *    它同时钉住"`ModFoldersState` 里有这一格"（对象字面量的多余属性检查）与
 *    "两处是同一个类型"（读 `prefs` 那一格）。T1 里那条编译期断言
 *    （`BULK_CHANNEL_IS_PERSISTED`）就是为这一天准备的，本任务落地之后它成了多余的
 *    公开符号 ⇒ 已删（见 `packages/shared/src/modFolders.ts` 里那段指针注释）。
 *
 * ⚠️★ **缺失清单的判据只有一半靠"扫到了什么"**（2026-10-03 复审的**判修 1**）：
 *    `missing = 该游戏版本清单里的 mod − 已绑定文件夹里命中过的 modid`（spec §7.5），
 *    而"命中过"只能来自**有读数的**文件夹。一个**没扫过**（或没扫成）的文件夹里
 *    到底有什么，我们**不知道** —— 把它当成"空的"就会把整个 48 行目录列成"你缺这些"，
 *    而底部那一栏是用户**行动的依据**（"我缺什么、去下什么"）：**列错 48 条比空着更坏**。
 *    ⇒ 只要还有一个已绑定文件夹没有**成功**的扫描读数，`missing` 就**空着**
 *      并带一条说明（`missingSuppressedNote`）；`getState` 会把该扫的扫掉（Ruling 34），
 *      所以正常情况下页面拿到的那一份是完整的。
 */
function buildState(): ModFoldersState {
  if (deps === null) return placeholderState();
  const st = requireState();
  const gameVersion = st.prefs.catalogGameVersion;

  /*
   * ★★ D1（T4）：这一处是**实例**那一侧的入口，而它必须**同步、零 I/O**：
   *   · `instanceViews()` 只读 `enumeration` 缓存（枚举住在 `refreshInstances()` 那条异步路里）；
   *   · `reconcileFolders()` 把"被追踪的实例"派生成 `folders` 的那几条、把既有的值合并回来、
   *     把不再被追踪的回收掉（改动了才落盘）。
   * ⚠️★ 顺序是承重的：**先对账再取 `entries`** —— 反过来的话，这一份状态里的 `folders` 还是
   *    上一趟的样子（用户勾了一个实例，界面上要等下一次推送才看得到它）。
   * ⚠️ `launcherViews(st)` 顺带会把"坏绑定"那句 notice 推进 `notices`，所以它也在
   *    `notices` 组装**之前**（下面那个数组字面量里现读 `notices`）。
   */
  const instances = instanceViews();
  reconcileFolders(st, instances);
  const launchers = launcherViews(st);

  const known = catalogOf();
  /*
   * ⚠️★ 2026-10-04（A 的 T6）：这里原来先组一份 `catalogBindings` 的表（键 = `rowId`）
   *    再交给 `planCatalogRows`。那三个写它的通道（`bindCatalogRow` / `unbindCatalogRow` /
   *    `updateCatalogRow`）删了 ⇒ **目录行没有本地读数**，`planCatalogRows` 也不再收
   *    `bindings`（D8：读到就忽略）。⚠️ 文件夹那一侧的本地读数是另一条路
   *    （`planFolderView` 的 `scan`），一个字都没动。
   *
   * ⚠️★ 同一处还有第二个改动（**D2：标签不再筛选**）：这里原来传
   *    `tagFilter: st.prefs.tagFilter`，而 `planCatalogRows` 会丢掉不匹配的行
   *    ⇒ 一个陈旧的 `prefs.tagFilter` 会让第三段「该版本**全部** mod」不再是全量，
   *    而唯一能清它的界面（标签筛选器）已经下线。现在这一层**根本没有**这一格可传。
   */
  const catalogRows =
    known === null
      ? []
      : planCatalogRows({
          catalog: known,
          gameVersion,
          upstreamLatest: upstreamLatestOf(),
        });

  const entries = sortedFolders(st);
  const folders = entries.map(([folderId, entry]) => folderView(folderId, entry));

  // 缺失清单的判据是"已绑定文件夹里**命中过**的 modid"（spec §7.5）—— 只算**有读数**的那些
  const trackedModids = new Set<string>();
  let foldersWithoutReading = 0;
  entries.forEach(([folderId], index) => {
    if (!readingOf(folderId).ok) {
      foldersWithoutReading += 1;
      return;
    }
    for (const row of folders[index]?.rows ?? []) trackedModids.add(row.modid);
  });

  /*
   * ★ **判修 2**（2026-10-03 复审）：`missing: []` 有两种完全不同的原因 ——
   *   "真的没有缺的"（`'ok'`）与"我们还不知道你有没有"（另外三种）。
   *   光看数组这两者**在数据上分不开**，界面只能靠文案猜，而猜错的方向正好是
   *   "还没扫描读数"被读成"你不缺任何 mod"。⇒ 结构化地标出来，界面只在 `'ok'` 时显示清单。
   * ⚠️ 优先级是有意的：**目录都没有** ⇒ 什么都列不出来（`'catalog-unavailable'`）；
   *   **路径不存在**比"还没扫"更具体、更能动手（`'folder-missing'`）——
   *   而且两者的修法**不同**：前者要把目录放回去或解绑，后者点一次「重扫」就会补上
   *   （`'folder-missing'` 的说明里**不许**出现"重扫"：`rescan` 对不存在的目录
   *   只会把读数再删一次，叫人去点一个修不好它的按钮是给错动作）。
   */
  const missingFolders = entries.filter(([, entry]) => !isDirectory(entry.path)).length;
  const missingStatus: ModFoldersState['missingStatus'] =
    known === null
      ? 'catalog-unavailable'
      : missingFolders > 0
        ? 'folder-missing'
        : foldersWithoutReading > 0
          ? 'folder-unscanned'
          : 'ok';
  const missing =
    missingStatus === 'ok'
      ? missingMods({
          catalog: known!,
          gameVersion,
          trackedModids,
          /*
           * ★★ 上游表必须传（**Ruling 62②**，2026-10-03 T8 评审）：清单每一行的 `release`
           *    必须是"主进程真会装的那一条"。`downloadMissing` 那一侧用的是
           *    `planCatalogRows(..., upstreamLatest: upstreamLatestOf())` 的 `official`
           *    ⇒ 这里少传一次，有上游的 mod（`mcsrranked`）在页面上的 release 就会是
           *    目录那条，而界面拿它判"镜像适不适用" —— 判出来的通道可能被主进程拒。
           *    ⚠️ 两次调用的 `upstreamLatestOf()` 是同一份解析结果（同一个函数、同一份缓存）。
           */
          upstreamLatest: upstreamLatestOf(),
        })
      : [];
  const missingNote =
    missingStatus === 'folder-unscanned'
      ? `有 ${String(foldersWithoutReading)} 个已绑定文件夹还没有扫描读数 ⇒ 缺失清单暂时空着（"没扫过"不等于"你没有"；点一次「重扫」或让页面重新拉一次状态就会补上）`
      : missingStatus === 'folder-missing'
        ? `有 ${String(missingFolders)} 个已绑定文件夹的路径不存在 ⇒ 缺失清单暂时空着（它们里面的文件现在读不到：把目录放回去、或者解绑它）`
        : missingStatus === 'catalog-unavailable'
          ? '目录还没拉到 ⇒ 缺失清单暂时空着（先解决目录不可用：点一次「重扫」重拉目录）'
          : null;

  return {
    catalogStatus: catalogStatusOf(),
    gameVersion,
    /*
     * ★ 三格"目录的全集与配置"（Ruling 58 / Ruling 55，2026-10-03 判修）：
     *   界面**读它们**，不许自己硬写一份 —— 见 `ModFoldersState` 上那三段注释。
     * ⚠️ 目录不可用时三格都空着（那时界面上该出现的是"目录还没拉到"，不是一份猜的选项表）。
     * ⚠️ `buildIndex` 在这里多跑一次（`planCatalogRows` 内部也建一份索引）：目录是**快照**、
     *   555 条 release ⇒ 这一步是启动期的一次内存计算（spec §15 已接受同一类的代价）；
     *   要省它就得把索引当参数贯穿整条状态组装路径，那会让"状态组装"与"索引"两件事耦合。
     *   ⚠️ `gameVersions` **不排序**：`buildIndex` 给的是代码单元序（`modCatalog.ts:319`
     *   明写"不要直接把它当成可展示的顺序"）⇒ 排序是**界面**的决定（今天界面照拍的顺序画）。
     */
    gameVersions: known === null ? [] : buildIndex(known).gameVersions,
    tags: known === null ? [] : tagOptionsOf(known),
    mirrors: known?.mirrors ?? [],
    tagFilter: [...st.prefs.tagFilter],
    bulkChannel: st.prefs.bulkChannel,
    catalogRows,
    folders,
    launchers,
    instances,
    /*
     * ★ D1（A14）：`instances: []` 的两个原因分得开 —— `enumeration === null` 是"还没有跑完
     *   任何一趟枚举"（界面说"正在读取…"），否则是"读到了，就是这么多"。
     * ⚠️ `launchers: []`（一条绑定都没有）**也**可以是 `'ok'`：那是"读过了、但没有东西可读"，
     *   与"还在读"是两句不同的话（A8 的第一个空态判的是 `launchers.length === 0`）。
     */
    instancesStatus: enumeration === null ? 'reading' : 'ok',
    missing,
    missingStatus,
    // 目录与缺失清单那两条**不是** push 进 notices 的：它们是"这一次读数的结论"，条件不成立时该消失
    notices: [catalogErrorOf(), missingNote, ...notices].filter(
      (note): note is string => note !== null,
    ),
    busy,
    progress,
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
// 抓目录 + 上游解析 / 扫描 —— **搬到各自的小模块里了**（Task 6）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 这两段（`loadCatalog` / `queueLoadCatalog` / `resolveUpstream` 与
 *    `scanFolder` / `resolveGameVersion` / `queueScan` / `ensureScans` / 扫描读数）
 *    **一行都没有删**，只是搬进了两个模块（2026-10-03 复审给的切法）：
 *      · `./mod-folder-catalog` —— 抓 `/api/mod-catalog`、失败分类、上游解析；
 *      · `./mod-folder-scan`    —— 扫 mods 目录、推断游戏版本、扫描读数的缓存。
 *    这么切是为了让这一个文件**不再继续长大**（它已经 1800+ 行，本仓 house style 里
 *    1946 行的 v1 是上限那一侧）。
 * ⚠️ 两个模块与这一份**单向**依赖（它们不 import 这一份）：注入点分别是
 *    `initCatalog({ siteOrigin, userAgent, notice })` 与 `initScan(notice)`，
 *    都在 `initModFolders` 里接上。
 */

// ---------------------------------------------------------------------------
// 已绑定文件夹的增删改
// ---------------------------------------------------------------------------

/** 文件夹 id：**路径的稳定哈希**（同一个目录不会绑出两个实体），与 v1 的 id 无关。 */
function folderIdOf(folderPath: string): string {
  const key =
    process.platform === 'win32' ? resolve(folderPath).toLowerCase() : resolve(folderPath);
  return createHash('sha1').update(key).digest('hex').slice(0, 16);
}

/**
 * 已绑定文件夹的**有效**游戏版本（表头那一格）。
 *
 * ⚠️ "默认取已绑定文件夹的版本"（spec §6.8 / T7 的默认值）：**只在用户还没显式选过**
 *    第一部分的游戏版本时采用（`prefs.catalogGameVersionChosen === false`），
 *    而且**落盘**（`prefs.catalogGameVersion`）—— 不落盘的话界面上写着 1.16.1、
 *    下次启动又变回去，那是"两处记忆"的另一种形态。
 * ⚠️★ **Ruling 37（2026-10-03 判修）**：这一支以前只看一个**内存里**的标志，而
 *    `startUp` **无条件**调它 ⇒ 实测：预置 `prefs.catalogGameVersion='1.8.9'` +
 *    一个推断出 1.16.1 的文件夹 ⇒ 启动后**状态与磁盘上的 prefs 都变成 1.16.1**，
 *    也就是**静默覆盖用户的显式选择**（spec §6.8 的原话是"按机器记住"）。
 *    现在判据是**磁盘上那一格**（`catalogGameVersionChosen`）：只有
 *    `setCatalogGameVersion` 会把它置 `true`，一次显式选择之后就再也不自动采纳了。
 * ⚠️ 自动采纳时**不**置 `catalogGameVersionChosen`：那不是用户的选择
 *    （Ruling 37 的字面：只有 `setCatalogGameVersion` 置位）。
 */
function adoptFolderGameVersion(): void {
  const st = requireState();
  if (st.prefs.catalogGameVersionChosen) return;
  for (const [, entry] of sortedFolders(st)) {
    const inferred = folderGameVersion(entry);
    if (inferred === null || inferred === st.prefs.catalogGameVersion) continue;
    st.prefs.catalogGameVersion = inferred;
    persist();
    return;
  }
}

/**
 * ★★ G2（最终修复波 / spec D3）：`bindFolder` 那个入参（"**当时看着的那一版**"）的形状判据。
 *
 * 返回值是"要预置的版本"，`null` = **交回自动推断**（与 `setFolderGameVersion(folderId, null)`
 * 同一条语义）。三种输入归 `null`：`undefined`（老调用点 / 探针的 `bindAt`）、`null`
 * （页面显式说"不知道看的是哪一版"）、以及没有（IPC 少传一格）；其余必须是**非空字符串**。
 *
 * ⚠️★ 只判形状、**不查目录**（与 `requireGameVersion` 刻意不同）：绑定是"建实体 + 扫一次"，
 *    它**不依赖目录** —— 而 `requireGameVersion` 在目录还没拉到时**抛**
 *    （`requireIndex()` 那一句），那会把"添加文件夹"这个与目录无关的动作一起拒掉
 *    （那一刻 `state.gameVersion` 就是 `prefs` 里那个默认值，不在任何"目录版本全集"里）。
 *    "这一版已经不在目录里"由**界面**处理：`staleGameVersion()` 会把它画成一个
 *    `disabled` 的选项（Ruling 64：旧值看得见、但不许被当成一个新动作发出去），
 *    与用户手改版本那条路完全同一条。
 * ⚠️ 因此**不许**把它换成 `requireGameVersion`（那是一条看起来更"严"、实际会拒掉
 *    合法动作的改动）：它是判据的一处实现，抄一份到别处更糟。
 */
function presetFolderVersion(gameVersion: unknown): string | null {
  if (gameVersion === undefined || gameVersion === null) return null;
  if (typeof gameVersion !== 'string' || gameVersion === '') {
    throw new Error('非法参数：gameVersion 必须是非空字符串（"当时看着的那一版"）或 null');
  }
  return gameVersion;
}

/**
 * 绑定一个文件夹（**弹主进程自己的原生目录对话框**——路径只能这么来）。
 *
 * 顺序是有意的：
 *   ① 判入参形状（**在弹对话框之前**：一个坏入参不该先弹一个框再报错）；
 *   ② 建/复用实体（同一个路径再绑一次不会绑出第二个）；
 *   ③ 先扫一次（"绑完马上看得到东西"是这个动作的全部意义）；
 *   ④ §13.1：把这个文件夹**里面**的旧绑定解掉并说出来（**每次 `bindFolder` 都跑**，
 *      不是"只在新绑时跑一次"—— 它住在这个 `if` 之外，见下面那条注释）；
 *   ⑤ 采纳游戏版本（只在用户没显式选过时）。
 *
 * ★★ G2（最终修复波 / spec D3）：入参 = **当时看着的那一版**，新实体直接**以它为有效版本**
 *    （`gameVersion: preset`），不再一律给 `null` 让主进程去推断。修之前"在 1.16.1 下面
 *    添加一个 1.16.1 的文件夹"会归到**版本未知**那一组（路径里没有 `.minecraft` /
 *    `mmc-pack.json` 就推不出来）。⚠️ 已经绑过的路径**不覆盖**它的版本：那可能是用户手改过的。
 *
 * ⚠️★ 2026-10-04（A 的 T6）：这里原来还有一步"把文件夹**外面**的 v1 绑定多写一份到
 *    `catalogBindings`"（`attributeLegacyItems`）。`catalogBindings` 整个退役了（D8）
 *    ⇒ 那一整段删掉：**归属这件事不再有落点**。代价（认）：v1 的 `items` 里那些
 *    **不在任何已绑定文件夹里**的单文件绑定，从今往后**没有人接手**（它们仍在文件里、
 *    仍归 v1 那九条通道管；本模块既不读也不写）。
 *    ⚠️ 第 ③ 步（**落在新绑定文件夹里**的那一半，`migrateBindingsInsideFolder`）
 *    **保留**：它是"一个文件只能有一个归属"（§13.1）的落地，与 `catalogBindings` 无关。
 */
async function bindFolder(gameVersion: unknown): Promise<ModFoldersState> {
  const preset = presetFolderVersion(gameVersion);
  const st = requireState();
  const picked = await pickDirectory();
  if (picked === null) return modFoldersState(); // 取消 ⇒ 一个字节都不改

  const folderId = folderIdOf(picked);
  if (st.folders[folderId] === undefined) {
    /*
     * 新文件夹默认 `autoUpdate: true`（与 v1 的 `bind()` 同一条裁决）：
     * 启动时只扫开着开关的文件夹 ⇒ 默认 false 的话，新绑的文件夹在下次启动时会被
     * 启动那一次扫描漏掉，而界面上那个勾选框看起来是开着的。
     * ⚠️ `gameVersion: preset`：`null` = 自动推断（**不是**"1.16.1"），G2 之前它恒为 `null`。
     */
    st.folders[folderId] = {
      path: picked,
      gameVersion: preset,
      autoUpdate: true,
      boundAt: Date.now(),
    };
  }
  persist();
  await queueScan(folderId, picked, { onlyIfMissing: false });
  /*
   * ⚠️★ 这一句在 `if (st.folders[folderId] === undefined)` 那个块**之外**
   *    （`:596-608` 那个守卫管的是"建不建实体"）：⇒ **每次** `bindFolder` 都会跑一次，
   *    不是"只在新绑那个文件夹时跑"。准确的读法是"每次 `bindFolder` 都跑，而它只处理
   *    **那一刻**已经落在（任意一个）已绑定文件夹里的 `items`" —— 此后 v1 再绑进来的
   *    文件不会被它清掉（`mod-folders.ts` 里那条 `bulkRun` 的注释据此论证可达性）。
   */
  migrateBindingsInsideFolder(picked);
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
 * ⚠️★ 2026-10-04（A 的 T6）：这里原来还有第二个循环（同一件事对 `catalogBindings` 做一遍）。
 *    那一格整个退役了（D8 / 裁决 B）⇒ 删掉。v1 的 `items` 那一半**一个字都没动**
 *    （老客户端 0.0.4 还在读它，spec §2.2 明写"它的管道留着"）。
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
  if (changed) persist();
}

async function unbindFolder(folderId: unknown): Promise<ModFoldersState> {
  const { folderId: id } = requireFolder(folderId);
  delete requireState().folders[id];
  /*
   * ⚠️ 读数也要**忘掉**（`forgetScan`）：只删实体的话，那个 folderId 的读数会留在
   *    `mod-folder-scan` 的缓存里 —— 同一个路径再绑一次会拿到**旧读数**（同名 folderId），
   *    而"绑完马上看得到东西"靠的正是重新扫一次。
   */
  forgetScan(id);
  persist();
  rebuild();
  return modFoldersState();
}

/**
 * ★ A 的 S2（spec D7 / §9.14）：**在系统文件管理器里打开这个文件夹**。
 *
 * ⚠️★ 为什么它只收 `folderId`：这是本仓**唯一**一条"会让用户的操作系统去打开一个位置"
 *    的通道 ⇒ 它必须与本组其它每一条同一条纪律 —— **路径永远不从渲染进程来**。
 *    页面递进来的是一个 id，主进程拿它去**自己那份状态**里查路径（查不到就拒）；
 *    把它写成"页面给路径、我们去打开"，等于给被注入的页面一个"让用户的机器打开任意位置"
 *    的原语（`file://` 之类只是其中最轻的一种）。
 * ⚠️ 入参收窄、以及"状态里没有这个 id"的拒绝形状**照 `unbindFolder`**：
 *    同一个 `requireFolder`（`typeof folderId !== 'string' || ''` ⇒ 抛；
 *    状态里查不到 ⇒ 抛 `状态里没有这个文件夹：<id>`）。
 * ⚠️ 返回值**不是** `ModFoldersState`（本组唯一一条）：它不改状态、没有新状态可推，
 *    只说那一次动作的结果 —— `shell.openPath` 的约定是"成功给空串、失败给一句错误文案"，
 *    所以那一句文案原样带回去（页面要能说出"为什么没打开"）。
 * 代价（认）：`shell.openPath` 在各平台对"文件夹"的行为差异**本机只能验 Windows**
 *    （spec §12 的未验证项），所以这里不替平台做任何假设、也不吞它的错误文案。
 */
async function openFolder(
  folderId: unknown,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { entry } = requireFolder(folderId);
  const error = await shell.openPath(entry.path);
  return error === '' ? { ok: true } : { ok: false, reason: error };
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
    // 显式的"重扫"是**强制**的：用户点它就是要一份新的读数（不吃缓存）
    if (entry !== undefined) await queueScan(id, entry.path, { onlyIfMissing: false });
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
  // 打开开关的人期待的是"它被看着" ⇒ 顺手扫一次（与启动那一次是同一种动作；已有读数就不重扫）
  const scan =
    on && !readingOf(id).ok
      ? queueScan(id, entry.path, { onlyIfMissing: true })
      : Promise.resolve();
  return scan.then(() => {
    rebuild();
    return modFoldersState();
  });
}

/**
 * 改一个 folder 的游戏版本（界面那一格下拉）。
 *
 * ★★ D1（T4，2026-10-11 控制器现读后裁定）：**两条分支，各有各的落点** ——
 *   ① **实例派生的 folder**（`key` 在这一趟枚举结果里）⇒ 写 `instancePrefs[key].gameVersion`
 *      （**用户手改那一档，对账的最高优先**），**并且同时**写 `folders[key].gameVersion`
 *      （界面与探针不必等下一趟对账就能看到 ✓）。
 *      ⚠️★ 为什么必须有这一档：实例元数据读不出来时（`gameVersion: null`）它在
 *      "版本 → 实例"那个流程里**永远够不到** ⇒ 用户没法往它里面装东西，而**今天**用户
 *      可以在文件夹行上手改 ⇒ 不收下这一格就是**功能倒退**（A10 的"零功能损失"）。
 *      ⚠️ `null` ⇒ **删掉那一格**（= 交回自动），不是"把 null 写下来"：`undefined` 的含义
 *      在 `InstancePref.gameVersion` 上是"没手改过"，与"手改成了 null"必须区分。
 *      ⚠️ 写进 `instancePrefs` 的一律是**用户明确选的那一版** —— `adoptFolderGameVersion`
 *      推断出来的值**只写 `folders`**（混起来就分不清"用户选的"与"我们猜的"）。
 *   ② **手工绑定的 folder**（没有 pref、也不在枚举结果里）⇒ **照旧只写 `folders`**：
 *      桌面探针那一族断言（`setFolderGameVersion` 的读数）全靠它，**一个字都不许改**。
 *   两条分支的落点不同，但**读数都在返回的那份状态里**（各自那一格），所以界面两条路一样。
 */
function setFolderGameVersion(folderId: unknown, gameVersion: unknown): ModFoldersState {
  const { folderId: id, entry } = requireFolder(folderId);
  const isInstance = instanceByKey(id) !== undefined;
  if (gameVersion === null) {
    entry.gameVersion = null; // 交回自动推断（spec §8）
    if (isInstance) {
      const pref = prefRecordOf(requireState(), id);
      if (pref !== undefined) {
        /* ★ 删那一格，不是写 `null`（见上面那一段：`undefined` 与 `null` 在这里是两件事）。 */
        const { gameVersion: _dropped, ...rest } = pref;
        requireState().instancePrefs[id] = rest;
      }
    }
  } else {
    const version = requireGameVersion(gameVersion, 'gameVersion');
    entry.gameVersion = version;
    if (isInstance) {
      const prev = prefRecordOf(requireState(), id) ?? { tracked: false };
      requireState().instancePrefs[id] = { ...prev, gameVersion: version };
    }
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

/**
 * 用户**显式**选第一部分的游戏版本（**Ruling 37**）。
 *
 * ⚠️★ 这里除了写那一格，还要把 `catalogGameVersionChosen` 置 `true` 并**持久化**：
 *    spec §6.8 说这个选择"**按机器记住**"，而 `catalogGameVersion` 那一格自己分不出
 *    "用户选的"与"我们自动采纳文件夹推断出来的"（两者可能恰好同值）。
 *    不记这一位，下一次启动就会把用户的选择当成"还没选过"再自动采纳一次 ——
 *    实测过的表现就是"重启之后我选的 1.8.9 变成了 1.16.1"，而且**不报错**。
 */
function setCatalogGameVersion(gameVersion: unknown): ModFoldersState {
  const version = requireGameVersion(gameVersion, 'gameVersion');
  const prefs = requireState().prefs;
  prefs.catalogGameVersion = version;
  prefs.catalogGameVersionChosen = true;
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

/*
 * ⚠️★ 2026-10-04（A 的 T6）：这里原来还有三个函数 —— `assertOutsideBoundFolders`
 *    （§13.1 那一半"这个文件已经在某个已绑定文件夹里 ⇒ 不许再绑到目录行"）、
 *    `bindCatalogRow`（弹原生 `.jar` 对话框 + 校验 modid）与 `unbindCatalogRow`（Ruling 60）。
 *    它们服务的是**第一部分那一行**，而第一部分整个下线了（spec §2.1 第 7 条 / D1）
 *    ⇒ 连那三条通道（契约 17 → 14，裁决 B）一起删了。
 *
 *    ⚠️ `setTagFilter` **留着**（D2）：标签只显示、不筛选，但它是一条**已发布的契约通道**，
 *    为删一个字段动契约不划算。今天没有任何界面调它 —— 那一格的显示值就是
 *    `ModFoldersState.tagFilter`（"记住的值"，读到就忽略，D8 同一条纪律）。
 *    ⚠️ `requireKnownTags` 也留着（它就是 `setTagFilter` 的入参校验）。
 */

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

/**
 * `rowId` 与 `releaseKey` 是**同一个形状**（Plan 1 的 `releaseKey(modid, gameVersion)`：
 * `modid|游戏版本`，分隔符只此一处），而"这一对必须在目录里查得到"是同一条判据
 * ⇒ 解析**只留一份**，`what` 只影响文案。
 *
 * ⚠️ 为什么"查得到"必须是两条（`modFor` 非空 **且** `releasesFor` 非空）：
 *    mod 在 `mods[]` 里、但这一版一条 release 都没有，是 spec §8 的 `missing-release`
 *    （界面显示"这个游戏版本下清单里没有它"）⇒ 它同样**没有东西可更新**。
 */
function requirePairKey(
  value: unknown,
  what: string,
): { key: string; modid: string; gameVersion: string } {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`非法参数：${what} 必须是非空字符串`);
  }
  const bar = value.indexOf('|');
  if (bar <= 0 || bar === value.length - 1) {
    throw new Error(`${what} 的形状不对（应当是「modid|游戏版本」）：${value}`);
  }
  const modid = value.slice(0, bar);
  const gameVersion = value.slice(bar + 1);
  const index = requireIndex();
  if (modFor(index, modid) === null) throw new Error(`目录里没有这个 mod：${modid}`);
  if (releasesFor(index, modid, gameVersion).length === 0) {
    throw new Error(`目录里没有这一条（${modid} 在 ${gameVersion} 下没有 release）：${value}`);
  }
  return { key: value, modid, gameVersion };
}

/** 游戏版本必须是目录里真的出现过的那一个（"9.9.9"这类输入当场拒）。 */
function requireGameVersion(gameVersion: unknown, what: string): string {
  if (typeof gameVersion !== 'string' || gameVersion === '') {
    throw new Error(`非法参数：${what} 必须是非空字符串`);
  }
  /*
   * ⚠️★ CT-1（最终修复波）：判据是共享内核里那**一个** `isKnownGameVersion`
   *    （`apps/web` 的三处下拉选项表也用它）—— 各写一份 `gameVersions.includes(...)`
   *    的表现是"界面画得出、主进程拒"（或反过来），而两边都编译得过。
   */
  if (!isKnownGameVersion(requireIndex().gameVersions, gameVersion)) {
    throw new Error(`目录里没有这个游戏版本：${gameVersion}`);
  }
  return gameVersion;
}

/** 通道只能是 `'origin'` 或目录镜像表里真有的那条镜像 id（**永远不是一个地址**）。 */
function requireChannel(channel: unknown): Channel {
  if (channel === 'origin') return 'origin';
  if (isRecord(channel) && typeof channel.mirrorId === 'string' && channel.mirrorId !== '') {
    const mirrors = catalogOf()?.mirrors ?? null;
    if (mirrors === null) throw new Error('目录还没拉到（这条操作的入参要在目录里查得到）');
    /*
     * ⚠️★ CT-1（最终修复波）：与 `apps/web` 那两处（`bulkChannelUsable` / `channelOptions`）
     *    共用共享内核里那**一个** `isKnownMirror` —— 漂的表现正是 Ruling 64 记的那件事：
     *    界面画出一颗"更新（镜像）"、而这里当场拒。
     */
    if (!isKnownMirror(mirrors, channel.mirrorId)) {
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
  const known = catalogOf();
  if (known === null) throw new Error('目录还没拉到（这条操作的入参要在目录里查得到）');
  const usable = new Set<string>(Object.keys(known.tagLabels));
  for (const mod of known.mods) for (const tag of mod.tags) usable.add(tag);
  for (const tag of tags) {
    if (!usable.has(tag)) throw new Error(`目录里没有这个标签：${tag}`);
  }
  return tags as string[];
}

// ---------------------------------------------------------------------------
// 写路径（Task 5）：**全仓唯一会写用户 mods 目录的地方**
// ---------------------------------------------------------------------------

/** 一次就位的结果（`alreadyCurrent` = 幂等那一支：**一个请求都没发、一个字节都没动**）。 */
interface InstallOutcome {
  targetPath: string;
  alreadyCurrent: boolean;
  /** 就位之后没能删掉的旧文件（"部分成功"：新文件已在位，这些还在）。 */
  leftovers: readonly string[];
}

/**
 * ★ 本模块自己的 `.part` 命名：`<targetName>.<uuid>.part`（`randomUUID()` 的**小写**形状）。
 *
 * ⚠️★ 它与 v1 那一种是**两种不同的名字**（见 `stalePartsOf`）：v1 的 `.part` 恰好是
 *    `${targetPath}.part` —— 也就是 `<targetName>.part`，**没有**中间那个 uuid 段。
 */
const OWN_PART_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.part$/;

/**
 * 上一次尝试留下的 `.part`（v1 `runUpdate` 的先例：下一轮开始前清一次残留）。
 *
 * ⚠️ 名字里的随机段（`.<uuid>.part`）让"这次要写的那个"与"上次留下的那个"**永不重名**
 *    ⇒ 清残留**只能按形状扫**（`<targetName>.` 开头、`<uuid>.part` 结尾）。
 *    不扫的话，下一次更新会在残留旁边再写一个新 `.part`，而旧的一直留在用户的 mods 目录里
 *    （v1 `runUpdate` 的 ② 做的就是这件事：开始下载前先清一次）。
 * ⚠️★ **只清本模块自己那一种命名**（`OWN_PART_NAME`）：同一个目录里 v1 给**同一个目标名**
 *    留的 `.part` 是 `${targetPath}.part`（`file-updates.ts` 的 `runUpdate`），它同样满足
 *    "`<targetName>.` 开头、`.part` 结尾" ⇒ 只按前缀+后缀扫会把 v1 **正在下载的那个半成品**
 *    删掉，而 v1 随后 rename 的就是那个文件（症状是 v1 那一次更新报"找不到 .part"）。
 *    这条**可达**：v1 的 `items` 与本模块文件夹里的一行可以指着同一个文件
 *    （用户把同一个 jar 既绑给 v1、又放在一个已绑定文件夹里）⇒ 两个模块可能同时对同一个
 *    目标名下载。⚠️★ T6 之前还有第二条来源（`attributeLegacyItems` 把文件夹**外面**的
 *    v1 绑定原样多写一份到 `catalogBindings`），而那一格整个退役了（D8）⇒ 今天只剩上面那一条。
 * ⚠️ 判据是"**这是不是我们写的**"，不是"这个名字像不像半成品"：宁可漏清一个自己造的重名残留
 *    （下一次下载前还会再扫一次），也不许删别人的活文件。
 */
function stalePartsOf(targetDir: string, targetName: string): string[] {
  const prefix = `${targetName}.`;
  let names: string[];
  try {
    names = readdirSync(targetDir);
  } catch {
    return []; // 目录都读不动 ⇒ 后面 downloadTo 会给出真正的错误，不必在这里造一个
  }
  return names
    .filter((name) => name.startsWith(prefix) && OWN_PART_NAME.test(name.slice(prefix.length)))
    .map((name) => join(targetDir, name));
}

/**
 * 把一条 release **就位**到 `targetDir`（spec §7.3 的第 2–8 步）。
 *
 * ⚠️★ **两个写入口共用这一份**（`updateMod` 与 `downloadMissing`）：两处各写一遍必然漂，
 *    而漂的那一份在**动用户的文件**。这也是本任务把"写盘那一段"抽出来的全部理由。
 *    ⚠️ T6 之前是三个（还有第一部分的 `updateCatalogRow`）—— 它随第一部分删了。
 *
 * 每一步与它的刀：
 *   ① `originFileNameOf(release.url)` —— 落盘文件名**唯一**的来源（basename + 拒穿越 /
 *      保留名 / 非 `.jar`）；上游那个名字是**不可信输入**，`join(dir, name)` 直接就是写盘路径。
 *      `null` ⇒ 抛（**不许**退回一个默认名：那会把"这个名字不能用"变成"悄悄落到别处"）。
 *   ② `targetPath = join(targetDir, targetName)`。
 *   ③ **幂等**：目标已在位（sha512 一致）⇒ 直接返回，**一个请求都不发**（spec §7.3 第 4 步）。
 *      ⚠️ 读不动（被另一个进程用 `FileShare.None` 占着时**我们自己也 EBUSY** —— 探针 ⑭ 的现场）
 *         ⇒ **不判"已就位"**：没有证据就不许说"它是这一份"。继续走就位那一步是对的 ——
 *         那一步会给出准确的病因（"文件被占用…什么都没改"）。把它当成 IO 错误直接抛，
 *         用户看到的是 `EBUSY: resource busy or locked`，而不是"可能游戏正在运行"。
 *   ④ 地址由 `channelUrl` 在目录里解析（通道是 **id**，不是地址；`null` ⇒ 抛）——
 *      **不许退回原地址顶上**：镜像 id 对不上就说明这一次请求不成立（spec §6.5 / D5）。
 *   ⑤ 清掉上一次留下的 `.part`（见 `stalePartsOf`）。
 *   ⑥ 下载到 `targetPath + '.<uuid>.part'`：sha512 与字节数两条校验都在 `downloadTo` 里
 *      （v1 `runUpdate` ④ 的原样搬移 ⇒ 两个调用方走的是同一条判据）。
 *   ⑦ `installDownloadedFile` 就位：同名旧文件先挪成 `.<uuid>.old`，再 rename 就位；
 *      被占用时**它自己抛，而且用户的文件一个字节都没动**（挪走的那份会放回去）。
 *   ⑧ 删旧文件：`oldCopies ∪ {movedOld}`，逐个删；**删失败 ⇒ 报告"部分成功"，不回滚**。
 *
 * ⚠️★ **`.part` 是调用方的**（Ruling 30）：`installDownloadedFile` 一个字节都不碰它 ⇒
 *    下面那个 `catch` 负责删。"下载失败 / 校验没过 / 就位失败"三条路都落在同一个 `catch` 里。
 * ⚠️★ **`onProgress` 与 `onBytes` 分工**（2026-10-06 就地改准；上一版这句写的是"不传 `onProgress`…
 *    要进度条得先给契约加一格"）：契约那一格已经加好了（`ModFoldersState.progress`）⇒ 新模块
 *    现在**走 `onBytes` + `noteBytes`**（每一个 chunk 一次，交出去的只有字节读数），
 *    而 v1 那一条路**仍然只用 `onProgress`**（它那份 150 ms 节流与 0–100 的语义一字不动）。
 *    ⚠️ 这里**依然不传 `onProgress`**：`onBytes` 与它并存、各供各的载体 —— 两个都传等于
 *    同一条路径上有两份进度读数（一份 0–100、一份字节数），迟早会漂。
 */
async function installRelease(opts: {
  targetDir: string;
  release: ModRelease;
  channel: Channel;
  /**
   * 调用方**已经知道**的、这条 release 在**该目录**里的旧副本（绝对路径）。
   *
   * ⚠️ brief 钉的签名是 `{ targetDir, release, channel }`，这一格是**加出来的**（报告里写明了）：
   *    "旧副本"只有调用方知道（文件夹那一侧来自扫描读数 `oldCopies` **∪ 主文件名**），
   *    而**删它们的那段代码必须只有一份**（spec §7.3 第 8 步）—— 让两个调用方各删一遍，
   *    正是本函数要消灭的那种漂移。
   *    ⚠️★ T6 之前还有第二个调用方（第一部分那一行，旧副本 = `catalogBindings[rowId].localPath`）
   *    —— 它随第一部分删了，而**共用**这件事仍然是这一格的形状（`downloadMissing` 会用）。
   * ⚠️ 等于 `targetPath` 的会被跳过：名字相同时 `installDownloadedFile` 已经把它挪成 `.old`，
   *    不跳就会把**刚就位的新文件**删掉。
   */
  oldCopies?: readonly string[];
  /**
   * 调用方**打算替换的那一份文件**（路径 + 上一次读到的 sha512；读不出来就是 `null`）。
   *
   * ⚠️ 这是 **Ruling 48**（2026-10-03 复审）要的那一格：行视图来自**缓存的**扫描读数，
   *    用户在两次扫描之间把那个 jar 换掉之后，`verdict` 判的还是**旧读数** ⇒
   *    必须拿"上次读到的 sha512"与"现在盘上的 sha512"对一次，才挡得住"扫描之后被换过的文件"。
   */
  replacing?: { path: string; sha512: string | null };
}): Promise<InstallOutcome> {
  const { targetDir, release, channel } = opts;
  if (!isDirectory(targetDir)) throw new Error(`这个位置不是目录（拒绝写盘）：${targetDir}`);
  const known = catalogOf();
  if (known === null) throw new Error('目录还没拉到（这条操作的入参要在目录里查得到）');

  const targetName = originFileNameOf(release.url);
  if (targetName === null) {
    throw new Error(
      `这个地址推不出安全的文件名（路径穿越 / 保留名 / 不是 .jar）⇒ 拒绝落盘：${release.url}`,
    );
  }
  const targetPath = join(targetDir, targetName);

  if (existsSync(targetPath)) {
    let onDisk: string | null = null;
    try {
      onDisk = await sha512OfFile(targetPath);
    } catch (error) {
      // 读不出来 ⇒ 没有证据说"它已经是这一份"（见上面 ③ 的注释）
      console.warn('[mod-folders] 目标读不出来，不能判「已就位」：', targetPath, error);
    }
    if (onDisk !== null && onDisk === release.sha512) {
      // 说出来（不然"为什么这次没下载"在日志里看不出来）；页面那一侧不需要推送任何东西
      console.log('[mod-folders] 目标已经是这一份（一个请求都不发）：', targetPath);
      return { targetPath, alreadyCurrent: true, leftovers: [] };
    }
    /*
     * ★ **Ruling 48**（2026-10-03 复审）：**扫描之后被换过的文件不许被覆盖**。
     *
     * 上面那次 `sha512OfFile` 是幂等判据顺路算出来的 ⇒ **复用它**再判一次（几乎免费）：
     *   · 目标**就是**我们要替换的那一份（路径逐字相同）：
     *       盘上的读数与"扫描时那份读数"对不上 ⇒ **拒**（"这个文件在扫描之后变过"）。
     *       扫描时那份读数是 `null`（当时就读不出来）⇒ 比不了 ⇒ 放行（报告里注明了这一支）。
     *   · 目标**不是**我们要替换的那一份：
     *       它是目录里记着的**旧副本** ⇒ 放行（那本来就是这次要清掉的东西）；
     *       我们**没见过**它 ⇒ **拒**（扫描之后多出来的文件，我们不知道那是什么，
     *       而"覆盖一个不知道是什么的文件"正是这条闸要防的事）。
     * ⚠️ 为什么"等于 `release.sha512`"已经在上面返回了：那一支是幂等（一个请求都不发）。
     */
    const recorded = opts.replacing !== undefined && samePath(opts.replacing.path, targetPath);
    const knownOld = (opts.oldCopies ?? []).some((path) => samePath(path, targetPath));
    const scanned = opts.replacing?.sha512 ?? null;
    if (recorded) {
      if (onDisk !== null && scanned !== null && onDisk !== scanned) {
        throw new Error(
          `这个文件在扫描之后变过（现在 ${onDisk.slice(0, 16)}…，扫描时是 ${scanned.slice(0, 16)}…）` +
            `⇒ 先重新扫描再更新：${targetPath}`,
        );
      }
    } else if (!knownOld) {
      throw new Error(
        `这个位置上已经有一个文件，而它既不是这次要替换的那一份、也不是目录里记着的旧副本 ⇒ 拒绝覆盖：${targetPath}`,
      );
    }
  }

  const url = channelUrl(known, release, channel);
  if (url === null) {
    const which = channel === 'origin' ? 'origin' : channel.mirrorId;
    throw new Error(`这个通道下拿不到下载地址（通道 ${which}）：${release.url}`);
  }

  for (const stale of stalePartsOf(targetDir, targetName)) {
    try {
      rmSync(stale, { force: true });
      console.warn('[mod-folders] 清掉了上一次留下的半成品：', stale);
    } catch (error) {
      console.warn('[mod-folders] 半成品清不掉（继续下载）：', stale, error);
    }
  }

  const partPath = `${targetPath}.${randomUUID()}.part`;
  let movedOld: string | null = null;
  try {
    await downloadTo({
      url,
      partPath,
      expectedSha512: release.sha512,
      expectedSize: release.size,
      onBytes: (sample) => noteBytes(sample),
      signal: activeRun?.controller.signal,
    });
    notePhase('install'); // ★ C：写盘阶段**没有字节**（界面显示"正在写入…"，且取消按钮置灰）
    movedOld = (await installDownloadedFile({ partPath, targetPath })).movedOld;
  } catch (error) {
    // Ruling 30：`.part` 由**调用方**删（`installDownloadedFile` 不碰它）
    try {
      rmSync(partPath, { force: true });
    } catch (cleanupError) {
      console.warn('[mod-folders] 半成品删不掉，请手动清理：', partPath, cleanupError);
    }
    throw error;
  }

  const leftovers: string[] = [];
  for (const path of [...(opts.oldCopies ?? []), ...(movedOld === null ? [] : [movedOld])]) {
    // 等于 `targetPath` 的就是**刚就位的新文件**（同名旧文件已由 `.old` 负责）⇒ 绝不删它
    if (path === '' || samePath(path, targetPath)) continue;
    try {
      rmSync(path, { force: true });
    } catch (error) {
      leftovers.push(path);
      console.warn('[mod-folders] 旧副本删不掉，请手动清理：', path, error);
    }
  }
  if (leftovers.length > 0) {
    /*
     * ⚠️ "部分成功"**必须说出来**（spec §7.3 第 8 步）：新文件已经在位了，把这次判失败
     *    等于对用户说"没换成"（与事实相反）。⇒ 一条 notice（页面看得见）+ 返回值。
     */
    pushNotice(
      `部分成功：新文件已经就位（${basename(targetPath)}），但 ${String(leftovers.length)} 个旧副本没删掉（${leftovers.map((path) => basename(path)).join('、')}）`,
    );
  }
  return { targetPath, alreadyCurrent: false, leftovers };
}

/**
 * 一次写盘流程的外壳：**忙标记 + 收尾时的 `lastRun` + 推状态**。单行与（T6 的）批量共用。
 *
 * ⚠️★ **并发只靠 `assertNotBusy()` 是不够的**：它看的是 v1 的两个标记
 *    （`bulkRunning` / 正在写的那一条），**看不见这个模块自己的 `busy`** ⇒ 两次单行更新
 *    会同时进来、同时下载，然后**先后就位同一个目标**（第二次会把第一次刚装好的那份
 *    挪成 `.old` 再放一份同样的上去）。结果碰巧是对的，过程在**反复写盘**。
 *    ⇒ 这里再挡一层（`busy` 非空 ⇒ 立刻拒，不排队）。
 * ⚠️ `busy` 在**起手**就推给页面（`rebuild()` 一次），不是等做完才说 —— 按钮要在那几十秒里禁用。
 * ⚠️ 失败**先写 `lastRun.failed` 再抛**：IPC 会 reject（页面弹一句），而 `lastRun` 是
 *    "上一次运行到底怎么了"的读数 —— 只留那句话的话，用户一关就再也查不到了。
 * ⚠️★ **空转不许冒充"已更新"**（(e)，2026-10-03 复审）：幂等那一支一个字节都没写 ⇒
 *    `work()` 返回一句"为什么没动"的原因，那一趟就记进 `lastRun.skipped` 而**不是** `updated`
 *    （写进 `updated` 会让界面说"已更新 1 项"，而盘上什么都没变）。`work()` 返回 `null` = 真的更新了。
 * ⚠️★ M6（最终修复波）：`beginRun(...)` 与起手那句 `rebuild()` 都**在 `try` 里面** ——
 *    `rebuild()` 自己抛（`buildState()` 理论可抛）时，收尾分支才盖得住它。放在 `try`
 *    之外的话，那一次抛出会留下 `busy === true` + `activeRun !== null` ⇒ **此后所有写盘
 *    一律被拒到重启为止**，而界面上还挂着一条永不收尾的进度行。
 *    挪进来之后走的是**失败那一支**：`busy = false` ⇒ `endRun()`（`activeRun` 清空、
 *    `progress` 变 `null`）⇒ `lastRun` 记一条 `failed`（`reason` 就是那次构建错误）⇒
 *    `rebuild()` 再试一次 ⇒ 原样 `throw`（IPC reject，页面看得见）。三格都归位。
 */
async function writeRun(
  input: { run: 'update-mod' | 'download-missing'; folderId: string; modid: string },
  work: () => Promise<string | null>,
): Promise<ModFoldersState> {
  const { modid } = input;
  if (busy) throw new Error('正在更新中（一次只写一个文件）—— 等它跑完再试');
  busy = true;
  let skipped: string | null = null;
  try {
    /* ⚠️★ 这两句在 `try` 里（M6）：它们抛时下面那个 `catch` 必须接管（见函数头）。 */
    beginRun({ run: input.run, folderId: input.folderId, itemCount: 1 });
    rebuild();
    skipped = await work();
    /*
     * ★★ T9（A20）：**"真的写盘成功了"就在这一句上** —— `work()` 的约定是
     *    "返回 `null` = 真的更新了"，一句话 = 为什么没动（幂等那一支**一个字节都没写**）。
     *    ⇒ 累计 +1 与下面那句 `lastRun.updated: [modid]` 落在**同一步**，不另造第二个判据。
     * ⚠️★ **必须在这里、不能在 `endRun()` 之后**：`endRun()` 把 `activeRun` 清成 `null`
     *    ⇒ 那之后 `noteUpdated()` 直接返回，`updatedCount` 永远停在 0
     *    （而 `writeRun` 是 `updateMod` 与 `downloadMissing` **共用**的那条路 ⇒
     *    "两个入口都不计数"会是一处静默的洞）。
     * ⚠️ 失败那一支（`catch`）**不加**：那一条 `throw` 出去，一个字节都没落盘。
     */
    if (skipped === null) noteUpdated();
  } catch (error) {
    busy = false;
    /*
     * ★ D4：取消**不是失败** ⇒ 不抛（IPC 不 reject，页面不弹错），真相在
     *    `lastRun.cancelled` 里，界面据此说"已取消"。
     * ⚠️★ 顺序是承重的：`cancelling` 必须**在 `endRun()` 之前**读 —— `endRun()` 会把
     *    `activeRun` 清成 `null`，反过来写的话这个判断恒为 false（取消会被记成一次失败，
     *    而 IPC 还会 reject ⇒ 页面弹出"更新失败"，与 D4 明写的那句话相反）。
     */
    const cancelled = activeRun?.cancelling === true;
    endRun();
    if (cancelled) {
      lastRun = { updated: [], skipped: [], failed: [], cancelled: [{ modid, reason: '已取消' }] };
      rebuild();
      return modFoldersState();
    }
    lastRun = {
      updated: [],
      skipped: [],
      failed: [{ modid, reason: messageOf(error) }],
      cancelled: [],
    };
    rebuild();
    throw error;
  }
  busy = false;
  endRun();
  /*
   * ⚠️★ **"abort 到晚了"这一个窗口（单行）**：取消在**下载相位**被受理，而 `abort()`
   *    落地时这一趟正好已经下完 ⇒ 走到的是**成功**这一支，`updated` 就是实情
   *    （文件真的装好了）。代价是**取消这个动作在读数里没有痕迹**：`lastRun` 里既没有
   *    `cancelled`、也没有 notice，页面从"正在取消…"直接跳到"已更新"。
   * ⚠️★ **单行这一支不补 notice**（刻意）：批量那条有，是因为它那一刻**真有"剩下的项"**
   *    要说清（`updateFolderAll` 的 `work()` 末尾那两种措辞）；而单行的 `itemCount` 恒为 1
   *    ⇒ 没有"剩下的项"这件事可说，一条"已取消：这一项正好下完了"只是把 `updated` 那两句
   *    话说第二遍 —— 更要紧的是它会与"取消**不是**失败、也不是没做完"这条语义打架
   *    （用户要的"停"已经实现了）。这里**如实写出代价**：取消动作在读数里没有痕迹
   *    （`updated` 是实话，而"点过取消"这件事一处都没记），**不为它造判据**
   *    —— 理由：那个窗口构造不出确定性夹具（要恰好卡在最后一次 `rename` 与
   *    `downloadTo` 返回之间）。
   */
  /*
   * ⚠️★ T9：**这一支不计数** —— 计数的落点在 `writeRun` 里那**唯一**一处
   *    （它按 `work()` 的返回值判，`updateMod` 与 `downloadMissing` 两条入口共用）。
   *    在这里再加一次就是"同一个文件数两遍"，而在 `downloadMissing` 上还会**恒不加**
   *    （那时 `activeRun` 早在 `endRun()` 里清掉了）⇒ 两处判据必然漂。
   */
  lastRun =
    skipped === null
      ? { updated: [modid], skipped: [], failed: [], cancelled: [] }
      : { updated: [], skipped: [{ modid, reason: skipped }], failed: [], cancelled: [] };
  rebuild();
  return modFoldersState();
}

/*
 * ===========================================================================
 * ★★ CT-2（最终修复波）：能装的判定是一张**正向列**，不是一张"拒绝表"
 * ===========================================================================
 * 修之前的形状是"逐条拒 `newer` / `unknown` / `unknown-version`，其余一律放行" ⇒
 * **新加一支 `FolderVerdict` 时会落在"放行"那一侧**（一个没人做过的决定被静默接受），
 * 而网页那一侧同一件事是一张**正向列**（`isUpdatableRow`：只有 `older` / `different-build`
 * 给按钮）⇒ 同一个新判定在两侧的结果相反。
 * ⇒ 这里改成一张**定型**的正向列：`INSTALLABLE` 是 `Record<FolderVerdict['kind'], boolean>`
 *   ⇒ 判定加一支时这里**当场编译失败**（与 `VERDICT_BADGES` 那条同一招），必须显式表态。
 *
 * ⚠️★ 两侧的**集合不同**，而且**不是**疏忽：
 *   · 网页（`isUpdatableRow`）画的是"要不要给一颗**更新**按钮" ⇒ `older` / `different-build`；
 *     `same` 不给按钮（那一行显示"已是最新"）。
 *   · 这里管的是"这个**写请求**能不能执行" ⇒ `same` **必须放行** —— "点第二次"走的正是它，
 *     而那正是幂等那条判据本身（Ruling 47 的原话）。
 *   · `ambiguous` / `missing-release` 在这里是 `false`：它们的 `official` 恒为 `null`
 *     （`resolveTarget` 只在**恰好一条**候选时才给目标），而 `installFolderRow` 在调本函数
 *     **之前**就已经用"这一行现在没有目标"拒了 ⇒ 这两支永远不会走到这里，标 `false`
 *     只是把"没有目标 = 没有东西可装"这件事在正向列上写实。
 */
const INSTALLABLE = {
  same: true,
  older: true,
  'different-build': true,
  newer: false,
  unknown: false,
  'unknown-version': false,
  ambiguous: false,
  'missing-release': false,
} satisfies Record<FolderVerdict['kind'], boolean>;

/**
 * 不许装时那句原话（`INSTALLABLE[kind] === false` 的那几支）。
 *
 * ⚠️ 三支老文案**逐字照旧**（探针 ⑲ 钉着 `newer` 那一句）；新加的那两句只说"没有答案 /
 *    没有东西可装"，与 `installFolderRow` 更早那条"没有目标"的拒**不冲突**（到不了这里）。
 * ⚠️ `Partial`：正向列是**唯一**的表态处（`INSTALLABLE` 逼着人表态），这一张只提供措辞；
 *    缺一句时的兜底在下面（不会静默放行 —— 放行与否只看 `INSTALLABLE`）。
 */
const REFUSE_UPDATE: Partial<Record<FolderVerdict['kind'], (what: string) => string>> = {
  newer: (what) => `本地这一份比清单里的更新（newer）⇒ 不给更新（只升不降）：${what}`,
  unknown: (what) => `本地版本读不出来（unknown）⇒ 不知道会换掉什么，不给更新：${what}`,
  'unknown-version': (what) => `这个文件夹的游戏版本还不知道 ⇒ 不给更新：${what}`,
  ambiguous: (what) => `候选多于一条（ambiguous）⇒ 没有"该装哪一个"的答案，不给更新：${what}`,
  'missing-release': (what) => `清单里这个游戏版本下没有它（missing-release）⇒ 不给更新：${what}`,
};

/**
 * ★ **Ruling 47**（2026-10-03 复审判修 1）：写盘前**必须拒掉那两类"不许装"的行**。
 *
 * 为什么非有不可：`official` 对**每一种判定**都非空（`resolveTarget` 只要有一条候选就给目标），
 * 而写路径读的正是它 ⇒ 在一个 `newer` 行上（本地比清单里更**新**），写路径会下更**旧**的那条
 * `official`、把用户更新的 jar 挪成 `.old` **再删掉** —— D1 的"只升不降"就只由**远程页面**执行了，
 * 而这个仓库的渲染进程加载的**就是远程网页**（`preload.ts` 文件头那一段）⇒ 主进程必须兜住。
 * `manual` 的行同理：spec §8 说那种行**连更新按钮都不给**。
 *
 * ⚠️★ **判据只该是这两类**（评审同时纠正了"拿 `needsUpdate`/`batchable` 当闸"的想法）：
 *   · `different-build`（同版本号、字节不同）**正是**"用户显式点一下"的合法情形（spec §8、`manual` 那段），
 *     拿批量那套判据会把这一支误杀；
 *   · `same` 也必须放行 —— "点第二次"走的正是它，而那就是幂等那条判据本身。
 * ⚠️ 这**不是**"重推判据"（brief 那句"内核决定"）：`verdict` / `manual` 就**在写路径刚读的那个
 *    对象上**（`planFolderView` / `planCatalogRows` 算好的，T1 的 `shared/modFolders.ts`）——
 *    消费它 ≠ 在写路径里重新 `judgeRelease`。
 * ⚠️★ CT-2：形状是 `INSTALLABLE[kind]` 那一次**正向查表**（理由与那张表写在它头顶）。
 */
function assertUpdatable(row: { manual: boolean; verdict: FolderVerdict }, what: string): void {
  assertNotManual(row.manual, what, '更新');
  const kind = row.verdict.kind;
  if (INSTALLABLE[kind]) return;
  const refuse = REFUSE_UPDATE[kind];
  throw new Error(
    refuse === undefined ? `这一行的判定（${kind}）⇒ 不给更新：${what}` : refuse(what),
  );
}

/**
 * 那道闸里 **"`manual` 的行不许装"** 那一半（Task 6 抽出来的）。
 *
 * ⚠️★ 为什么 `downloadMissing` **只**能用这一半、不能拿整道 `assertUpdatable`：
 *    整道闸的 `newer` / `unknown` 两支都要"**本地那一份**"才判得出来，而"缺失"的定义
 *    就是"这个文件夹里没有它的副本" ⇒ `judgeRelease(null, null, [release])` 恒为 `unknown`
 *    （`compareLocalToRelease` 的第二层）⇒ 拿整道闸去判，**每一条缺失下载都会被拒**
 *    （"本地版本读不出来 ⇒ 不知道会换掉什么"）。那是把闸用在了它不成立的前提上。
 *    剩下两支在那边也各自有更早、更具体的拒绝：`unknown-version` 由"文件夹的游戏版本还不知道"
 *    那一条挡在前面，`newer` 在没有本地文件时**不可能**成立（没有"本地那一份"）。
 * ⇒ 两处共用**这一条文案**（`action` 只换动词），而不是各抄一遍"manual 不许装"。
 */
function assertNotManual(manual: boolean, what: string, action: string): void {
  if (manual) {
    throw new Error(
      `这一条是 manual（只给打开原网页，连更新按钮都不该有）⇒ 不给${action}：${what}`,
    );
  }
}

/**
 * 把**文件夹里的这一行**装成它的目标 release（`updateMod` 与 `updateFolderAll` 共用这一段）。
 *
 * ⚠️★ 抽出来的理由与 `installRelease` 同一个：两处各写一遍必然漂，而漂的那一份在动用户的文件。
 *    差别只在**重扫的时机**（`updateMod` 每装一条就重扫；整夹更新只在最后扫一次 —— 见
 *    `updateFolderAll` 里那段"为什么不逐条扫"），所以重扫留在**调用方**。
 *
 * 返回值与 `writeRun` 的 `work()` 同一个约定：`null` = 真的写了；一句话 = 为什么没动
 * （幂等那一支 ⇒ 进 `lastRun.skipped`，不许冒充"已更新"）。
 */
async function installFolderRow(opts: {
  entry: SharedState['folders'][string];
  row: ModFolderRowView;
  channel: Channel;
  /** 出错文案里那个"是谁"（`modid|游戏版本`；批量与单行各自带自己那一份）。 */
  what: string;
}): Promise<string | null> {
  const { entry, row, channel, what } = opts;
  const release = row.official;
  if (release === null) {
    throw new Error(
      `这一行现在没有目标（清单里没有它的 release，或候选多于一条要先明确选一个）：${what}`,
    );
  }
  // ★ Ruling 47：`newer` / `manual` / 说不清本地是什么的，一律**在动盘之前**拒
  assertUpdatable(row, what);
  /*
   * 旧副本 = **主文件 ∪ 扫描读数给出的其余副本**。
   * ⚠️ 主文件也要删（它在"旧副本"这个数组之外）：它正是被替换的那一份，而目标文件名
   *    与它不同名时 `installDownloadedFile` **不会**碰它（它只挪 `targetPath`）⇒
   *    不删的话目录里会同时留着被替换掉的那个旧版本（v1 `runUpdate` 的同一步做的也是这件事：
   *    路径不同就 `rmSync(localPath)`）。同名时 `installRelease` 会跳过它（那已由 `.old` 负责）。
   */
  const mainPath = join(entry.path, row.fileName);
  const oldCopies = [mainPath, ...row.oldCopies.map((name) => join(entry.path, name))];
  /*
   * ★ C/S2：**项的身份只有调用方知道** —— `installRelease` 收的是 `{targetDir, release,
   *   channel}`，"这是第几项、下的是哪一个"不在它的入参里（也不该在：那会让两个写入口
   *   共用那一段再多一个必须传对的东西）。
   */
  setRunItem({ modid: row.modid, fileName: row.fileName });
  const outcome = await installRelease({
    targetDir: entry.path,
    release,
    channel,
    oldCopies,
    // ★ Ruling 48：把"扫描时那个文件的读数"带过去（扫描之后被换过 ⇒ 拒）
    replacing: { path: mainPath, sha512: row.localSha512 },
  });
  return outcome.alreadyCurrent ? '这个文件已经是这一份（没有下载、没有写盘）' : null;
}

/**
 * 一行**没有**被整夹更新碰的原因（`lastRun.skipped[].reason` 那一段）。
 *
 * ⚠️★ 判据**只从行视图上读**（`manual` / `verdict` / `official`），**不重新判决**：
 *    `verdict` 就是 T1 的 `planFolderView` 算好的那一个（brief 的"内核的规则，不是重新推导"）。
 *    这里做的事是**把它翻译成一句人话**，不是再比一次版本。
 * ⚠️ 顺序是有意的：`manual` 先判 —— 那种行**连更新按钮都没有**（spec §8），
 *    说"它不是 auto"虽然也对，但不如"这一条根本没有更新入口"对用户有用。
 */
function skipReasonOf(row: ModFolderRowView): string {
  if (row.manual) return '这一条是 manual（只给打开原网页，连更新按钮都不该有）⇒ 不进批量';
  const verdict = row.verdict;
  switch (verdict.kind) {
    case 'same':
      return '这个文件已经是这一份（没有下载、没有写盘）';
    case 'different-build':
      /*
       * ⚠️★ 措辞只说**读得出来的那一半**（2026-10-04 收口波）：这一支**不等于**"版本号相同"
       *   —— `compareLocalToRelease` 把两种情形都归到这里：① 版本主体相同（真实案例
       *   `standardsettings`）② 两边主体里有非数字段、**排不出先后**（实测 `HD_U_F9` vs
       *   `HD_U_F10`：那时两个版本号是**不同**的）。spec §8 没有为 ② 单开一支（`different`
       *   不在 `ReleaseVerdict` 里 ⇒ 要造它得动契约）⇒ 界面与这里的文案只能说"字节不同"。
       */
      return '本地与官方的字节不同（different-build）⇒ 要人显式点一下这一条';
    case 'newer':
      return '本地这一份比清单里的更新（newer）⇒ 只升不降，不进批量';
    case 'unknown':
      return '本地版本读不出来（unknown）⇒ 不知道会换掉什么，不进批量';
    case 'unknown-version':
      return '这个文件夹的游戏版本还不知道（unknown-version）⇒ 一行都不给更新';
    case 'ambiguous':
      return `候选多于一条（ambiguous：${String(row.candidates.length)} 条）⇒ 该装哪一个没有唯一答案，要人明确选一个`;
    case 'missing-release':
      return '清单里这个游戏版本下没有它（missing-release）⇒ 没有东西可装';
    case 'older':
      /*
       * 到 `older` 却还不可批量，只剩"目标为空"或"目标那条不是 auto"两种（`needsUpdate` 的后半句）
       * ⇒ 那两句话正是这里要说的。⚠️ 不是"再判一次版本"：`needsUpdate` 已经给了结论。
       */
      return row.official === null
        ? '这一行没有目标（清单里没有它的 release，或候选多于一条要先明确选一个）'
        : `这一条的 release 不是 auto（download=${verdict.release.download}）⇒ 不进批量`;
  }
}

/**
 * 一次**批量**写盘流程的外壳（与 `writeRun` 同一条纪律：忙标记 + 收尾写 `lastRun` + 推状态）。
 *
 * ⚠️★ 批量的形状照 spec §7.4 是"`bulkRunning` 标记 + `assertNotBusy()` + 每条之间
 *    `yieldToEventLoop()`"：v1 那个 `bulkRunning` 是**它模块私有**的（拿不到，也不该去动它），
 *    这里对应的就是本模块自己的 `busy` —— 它**跨整批为真**（不是"某一条正在写"），
 *    所以整批期间第二次调用（单行也一样）会被立刻拒（`writeRun` 与本函数共用这一格）。
 *    ⇒ 与 v1 那条的**已知缺口**（认）：v1 的 `update()`/`updateAll` 看不见本模块的 `busy`，
 *      而反向是有效的（两个写入口的第一行就是 v1 导出的 `assertNotBusy()`）。
 *      ⚠️★ **"两个模块写的是不同的绑定"是假的**（2026-10-04 收口波订正；第一版这句注释就是
 *      这么写的，而它把一个可达的缺口说成了不可达）：v1 自己的 `bind` 可以把一个
 *      **已经在某个已绑定文件夹里**的 jar 绑成它的一个 `item`（§13.1 的迁移
 *      **每次 `bindFolder` 都跑** —— 它在"建不建实体"那个守卫**之外**，见 `bindFolder`
 *      里那一句的注释；而它只处理**那一刻**已经落在文件夹里的 `items`，此后 v1 照绑。
 *      ⚠️ 这条注释原来写的是"只在**新绑那个文件夹**时跑一次"，那是**不精确**的，
 *      最终修复波改准；可达性结论不受影响）
 *      ⇒ 同一个文件可以同时是 v1 的一个 `item` 与本模块文件夹里的一行。
 *      ⚠️★ T6 之后**只剩这一条路**：原来还有第二条（`attributeLegacyItems` 把文件夹**外面**
 *      的 v1 绑定原样多写一份到 `catalogBindings`），那个函数随 D8 一起退役了。
 *      ⇒ v1 那一侧仍在 `busy` 期间可以起手写**同一个文件**（本模块进不去 v1 的批量，
 *      但 v1 进得来本模块的写窗口）。今天的兜底只有"两边写的多半不是同一份文件"这个巧合，
 *      以及 `stalePartsOf` 只清自己那一种 `.part` 命名（不再删 v1 的活半成品）。
 *      ⇒ 要真正堵死得让 v1 也看得见这一格（那是改 v1），记在 `docs/pending.md §5.110`。
 * ⚠️ 整批起手就抛（文件夹不是目录 / 没有扫描读数 / 目录没拉到）时**不写 `failed`**：
 *    `failed[].modid` 是**行**的标识，而这时候**一行都没跑到** ⇒ 编一个假 modid 进去
 *    会让页面显示一条不存在的行。⇒ 记一条 notice（页面看得见）+ 原样抛（IPC 会 reject）。
 * ⚠️★ M6（最终修复波）：`beginRun(...)` 与起手那句 `rebuild()` 都**在 `try` 里面**
 *    （与 `writeRun` 同一条理由，见那一段）：放在外面时 `rebuild()` 抛会留下
 *    `busy === true` + `activeRun !== null` ⇒ 写盘全被拒到重启。挪进来之后走失败那一支：
 *    `busy = false` ⇒ `endRun()`（`activeRun` 清空、`progress` 变 `null`）⇒
 *    `lastRun` 记空桶 + 一条 notice（`reason` 是那次构建错误）⇒ `rebuild()` 再试 ⇒
 *    原样 `throw`。三格都归位。
 */
type LastRun = NonNullable<ModFoldersState['lastRun']>;

/** `bulkRun` 只跑这两趟（`DownloadProgress['run']` 另外两个值走 `writeRun` 的单行那条路）。 */
type BulkRunKind = 'update-folder-all' | 'download-pack';

/**
 * ★ 修轮 1（评审的 Minor 2）：这一趟**叫什么名字**。失败那一支的 `notice` 是**页面直接渲染**的
 *    一句话（`ModDownloadPanel` 把 `state.notices` 原样印出来）⇒ 名字必须按这一趟取。
 *    ⚠️ 原先那一行写死"整夹更新没能跑完"：整包下载走到那里（只有 `beginRun` / `rebuild` 抛才可能）
 *    会说错名字。
 * ⚠️ 类型是 `Record<BulkRunKind, string>`：`bulkRun` 将来多一趟时这里**当场编译失败**
 *    （与 `SKIP_TEXT` 同一招），不会静默退回"整夹更新"。
 */
const BULK_RUN_LABEL: Record<BulkRunKind, string> = {
  'update-folder-all': '整夹更新',
  'download-pack': '整包下载',
};

async function bulkRun(input: {
  /**
   * ★ B2 加的（默认保持既有那一条的语义）：这一趟的**类型**。
   * ⚠️ 为什么非加不可：原来那一行写死 `'update-folder-all'` ⇒ 整包下载的进度帧会报成"整夹更新"，
   *    页面那句汇总行会**说错话**（不报错，只是说错）。
   * ⚠️★ 默认值那半句是判据：既有那两个调用方（整夹更新 / 缺失清单的批量）**一个都不许改**
   *    ⇒ 默认值必须是 `'update-folder-all'`（改了会让 C 那两趟的进度帧类型变掉）。
   */
  run?: BulkRunKind;
  folderId: string;
  itemCount: number;
  work: () => Promise<LastRun>;
}): Promise<ModFoldersState> {
  if (busy) throw new Error('正在更新中（一次只写一个文件）—— 等它跑完再试');
  busy = true;
  let run: LastRun;
  /* ★ 这一趟的类型定一次、用在三处：`beginRun` 的帧、失败那一支的 notice 的名字（修轮 1）。 */
  const kind: BulkRunKind = input.run ?? 'update-folder-all';
  try {
    /* ⚠️★ 这两句在 `try` 里（M6）：它们抛时下面那个 `catch` 必须接管（见函数头）。 */
    beginRun({
      run: kind,
      folderId: input.folderId,
      itemCount: input.itemCount,
    });
    rebuild();
    run = await input.work();
  } catch (error) {
    busy = false;
    endRun();
    /*
     * ⚠️ 整批的取消**不**走这一支：它由循环自己收尾（`updateFolderAll` 的 `work()` 里
     *    那个 `break` + `cancelled` 桶），所以到这里的一律是**真失败** ⇒ `cancelled: []`。
     */
    lastRun = { updated: [], skipped: [], failed: [], cancelled: [] };
    pushNotice(`${BULK_RUN_LABEL[kind]}没能跑完：${messageOf(error)}`);
    rebuild();
    throw error;
  }
  busy = false;
  endRun();
  lastRun = run;
  rebuild();
  return modFoldersState();
}

/**
 * ★ 写盘：把**文件夹里**这一行换成 `releaseKey` 那条 release（spec §7.3）。
 *
 * 入参只有 id 与 key（**没有路径、没有地址**）：目标目录来自主进程自己那份状态，
 * 下载地址由 `channelUrl` 在目录里解析。
 *
 * ⚠️★ "这一行装哪一条 release"**不在这里重新推导**（`resolveTarget` / `judgeRelease` 是 T1 的活）：
 *    行视图里的 `official` 就是页面显示为"官方版本"的那一条，也就是"页面点更新时看到的目标"
 *    ⇒ 拿它去装，界面说的与写盘做的才是同一件事。有没有上游、候选几条，全部由那份视图回答
 *    （`official === null` ⇒ 没有目标 ⇒ 拒，spec §8 的 `missing-release` / `ambiguous`）。
 * ⚠️ 游戏版本必须是**这个文件夹的有效版本**（`releaseKey` 里那个）：拿 1.7.10 那条 release
 *    往 1.16.1 的文件夹里装是**静默降级**，而它看起来完全正常。
 */
export async function updateMod(
  folderId: unknown,
  modid: unknown,
  releaseKey: unknown,
  channel: unknown,
): Promise<ModFoldersState> {
  assertNotBusy();
  const { folderId: id, entry } = requireFolder(folderId);
  const chan = requireChannel(channel);
  const key = requirePairKey(releaseKey, 'releaseKey');
  if (typeof modid !== 'string' || modid === '') {
    throw new Error('非法参数：modid 必须是非空字符串');
  }
  if (key.modid !== modid) {
    throw new Error(`releaseKey 说的 mod 与这一行对不上：${key.key} vs ${modid}`);
  }
  if (!isDirectory(entry.path)) {
    throw new Error(`这个文件夹的路径现在不是目录（不给更新）：${entry.path}`);
  }
  const view = folderView(id, entry);
  if (view.gameVersion === null) {
    throw new Error(
      `这个文件夹的游戏版本还不知道（${basename(entry.path)}）⇒ 不给更新（spec §8：先给它选一个游戏版本）`,
    );
  }
  if (key.gameVersion !== view.gameVersion) {
    throw new Error(
      `releaseKey 说的游戏版本（${key.gameVersion}）不是这个文件夹的（${view.gameVersion}）：${key.key}`,
    );
  }
  const row = view.rows.find((candidate) => candidate.modid === key.modid);
  if (row === undefined) {
    throw new Error(`这个文件夹里没有 ${key.modid} 的行（还没扫过？先点一次「重扫」）：${id}`);
  }
  if (row.official === null) {
    throw new Error(
      `这一行现在没有目标（清单里没有它的 release，或候选多于一条要先明确选一个）：${key.key}`,
    );
  }
  /*
   * ⚠️ 这里**不**先过闸（与 Task 5 一样把闸留在 `installFolderRow` 里，两处只此一份）：
   *    那道闸的拒绝在整夹更新里必须落成**一条 `failed`**（一条失败不许中断整批），
   *    所以它只能住在"被 try 包住的那一段"里。单行这一侧的效果不变（外面没有别人接它）。
   */
  return writeRun({ run: 'update-mod', folderId: id, modid: key.modid }, async () => {
    const why = await installFolderRow({ entry, row, channel: chan, what: key.key });
    // spec §7.3 第 9 步：重扫该文件夹（**强制**，不吃缓存：目录刚刚被我们改过）
    await queueScan(id, entry.path, { onlyIfMissing: false });
    return why;
  });
}

/**
 * ★ 写盘：**整夹更新**（spec §7.4）—— 走完这个文件夹的行，把**可批量的**那些装掉。
 *
 * 形状照 v1 `updateAll`（:1512 那一段）：`busy` 标记 + `assertNotBusy()` + 每条之间
 * `yieldToEventLoop()`；入参只有 id 与通道（**没有路径、没有地址**），目标与通道都由主进程查。
 *
 * 三条判据的**来源**是有意分开的（少任何一条都会漂）：
 *   · **哪些行要更新** —— `row.batchable`，T1 的 `planFolderView` 算好的
 *     （= `needsUpdate(verdict)`：`older` **且** `download === 'auto'` **且**两边主体可排序，
 *     再加"必须有目标"）。这里**不重新判决**：brief 那句"内核的规则"说的就是这一句。
 *     ⚠️ 后果（认）：`different-build`（同版本号、字节不同）**不进批量** —— 那是要人显式点一下的
 *     那一类（spec §8），所以"点一次全部更新"不会替用户选打包。
 *   · **跳过的每一行都要有原因** —— `lastRun.skipped`（spec §7.4 的字面："如实报告跳过了几条及原因"）。
 *     ⚠️ 包括"幂等那一支"（目标已经是这一份）：那一趟一个字节都没写 ⇒ 进 `skipped` 而不是
 *     `updated`（写进 `updated` 会让界面说"已更新 1 项"而盘上什么都没变 —— (e) 的同一条纪律）。
 *   · **一条失败不许中断整批** —— 每一行自己的 `try`：失败进 `lastRun.failed`，**继续下一条**
 *     （spec §7.4：27 MB × N 串行，中途停下的话用户得自己想是哪一条断的）。
 *
 * ⚠️★ **先在起手处拒掉整批**（不是"逐行失败"）：路径不是目录、或**根本没有扫描读数**。
 *    理由是本模块一直守着的那一条**"没扫过 ≠ 扫到了 0 个"**（判修 1）：没有读数时行视图是空的
 *    ⇒"更新 0 行、跳过 0 行"看起来像"你已经是最新的"，而事实是**我们不知道那个文件夹里有什么**。
 *    ⚠️ 游戏版本未知**不**在这里拒：那种情况下每一行都是 `unknown-version` 且不可批量，
 *    逐行带着原因进 `skipped` 比一句"整批不给跑"更能说清发生了什么（也是 §7.4 的形状）。
 * ⚠️ **只在最后重扫一次**（而不是每装一条扫一次）：同一批里各行的 `replacing` 来自同一份读数，
 *    而它们**互不影响**（不同 modid ⇒ 不同主文件、不同目标名）；逐条重扫会让一次整夹更新变成
 *    N 遍全目录 sha512（真目录几十 MB × N）。
 */
export async function updateFolderAll(
  folderId: unknown,
  channel: unknown,
): Promise<ModFoldersState> {
  assertNotBusy();
  const { folderId: id, entry } = requireFolder(folderId);
  const chan = requireChannel(channel);
  /*
   * ⚠️ 这一句不是装饰：`requireChannel('origin')` **不碰目录**（只有镜像那一支才查 `mirrors[]`）
   *    ⇒ 少了它，"目录还没拉到 + 通道是 origin"会静默地"更新 0 行"。
   */
  requireIndex();
  if (!isDirectory(entry.path)) {
    throw new Error(`这个文件夹的路径现在不是目录（不给整夹更新）：${entry.path}`);
  }
  if (!readingOf(id).ok) {
    throw new Error(
      `这个文件夹还没有扫描读数（"没扫过"不等于"它是空的"）⇒ 先点一次「重扫」：${basename(entry.path)}`,
    );
  }
  const view = folderView(id, entry);
  const what = (modid: string): string => `${modid}|${view.gameVersion ?? '?'}`;

  return bulkRun({
    folderId: id,
    itemCount: view.rows.filter((row) => row.batchable).length,
    work: async () => {
      const updated: string[] = [];
      const skipped: { modid: string; reason: string }[] = [];
      const failed: { modid: string; reason: string }[] = [];
      const cancelled: { modid: string; reason: string }[] = [];
      // v1 `updateAll` 的起手也放一次（批量与上一条指令之间也让页面喘一口）
      await yieldToEventLoop();
      for (const row of view.rows) {
        // ★ D4：取消之后**剩下的项不再开工**（在每一项之前判，而不是等它自己抛）
        if (isCancelling()) break;
        if (row.batchable) {
          try {
            const why = await installFolderRow({
              entry,
              row,
              channel: chan,
              what: what(row.modid),
            });
            /*
             * ★★ T9（A20）："真的写盘成功了"就是 `why === null` 这一支
             *    （`installFolderRow` 的约定：一句话 = 为什么没动 ⇒ 进 `skipped`）。
             *    ⇒ 累计 +1 与 `updated.push` 落在**同一步**；`skipped` / `catch` 那两支
             *    一个字节都不许加（跳过与失败**都不算**）。
             */
            if (why === null) {
              updated.push(row.modid);
              noteUpdated();
            } else {
              skipped.push({ modid: row.modid, reason: why });
            }
          } catch (error) {
            if (isCancelling()) {
              // ★ 当前这一项是被我们打断的那一项 ⇒ 记进 `cancelled`，然后停
              cancelled.push({ modid: row.modid, reason: '已取消' });
              break;
            }
            // ★ 一条失败**不中断**整批（spec §7.4）：记下来，继续下一条
            failed.push({ modid: row.modid, reason: messageOf(error) });
          }
        } else {
          skipped.push({ modid: row.modid, reason: skipReasonOf(row) });
        }
        /*
         * ★ 每条之间让出一次事件循环（spec §7.4 的字面）。放在**每一条之后**（跳过的那条也算）：
         *    跳过的行不 await 任何东西，而一个真实的文件夹里跳过的往往占多数 ⇒ 让出点更多，
         *    页面在整批期间更不会看起来卡住。
         */
        await yieldToEventLoop();
      }
      /*
       * ⚠️★ 两种"没有开工的项"要如实说，而且**不许**编一个假 modid 进 `cancelled`
       *    （那一格是**行**的标识，编一个会让页面显示一条不存在的行 —— `bulkRun` 那条
       *    "整批起手就抛时不写 failed" 的注释是同一族纪律）：
       *      · 取消发生在换项之间 ⇒ `cancelled` 空着 + 一条 notice；
       *      · 当前那一项正好下完了（abort 到晚了）⇒ 它进了 `updated` ⇒ 也补一条 notice。
       *    ⚠️ 这一条**只在这里**（不写进 `bulkRun` 的 catch）：走到那个 catch 的都是真失败。
       */
      if (isCancelling() && cancelled.length === 0) {
        pushNotice(
          updated.length > 0
            ? '已取消：这一项正好下完了（它已装好），后面的项没有开始'
            : '已取消：还没有开始任何一项',
        );
      }
      if (updated.length > 0) await queueScan(id, entry.path, { onlyIfMissing: false });
      return { updated, skipped, failed, cancelled };
    },
  });
}

/**
 * ★ 写盘：**缺失下载**（spec §7.5 的"下载到 ▾"）—— 把一个缺失的 mod 装进某个已绑定文件夹。
 *
 * 与另外三个入口的差别只有"这一行是从哪来的"：它**不在任何一个文件夹里**（那正是"缺失"的定义）
 * ⇒ 目标由 `(modid, 游戏版本)` 在目录里决定，而**"该装哪一个"的判定仍然是内核的**：
 * 这里拿 `planCatalogRows` 现算那一行（与页面渲染第三段用的是**同一个函数**、同一份目录、
 * 同一个游戏版本）⇒"缺失清单里点了确定"装的就是"目录行上写着的那一条"。
 * ⚠️★ T6 之后这一次调用与页面那一处（`buildState`）**逐格相同**：入参里那两格
 *    （`tagFilter` / `bindings`）已经不存在了（D2 删了标签筛选、D8 删了本地绑定）
 *    ⇒ 上面那句"有两格入参是有意不同的"作废，改成"两处问的是同一件事"。
 *    ⚠️ 后果（已经是事实、不再是"有意不同"）：目录行的 `verdict` 恒为
 *    `unknown` / `ambiguous` / `missing-release`，而**这一支不消费 verdict**
 *    （理由见 `assertNotManual`）。
 *
 * ⚠️★ 两道闸各自开火在它**成立**的前提上（写在这里，免得下一个人以为漏了一道）：
 *   · `installRelease` 那一道（Ruling 47/48）照常 —— 目标位置上要是已经有一个我们没见过的文件，
 *     它**拒**（见下面 `oldCopies` 那段）；
 *   · "这一**行**该不该装"那一道在这里只剩 `manual` 那一半能成立，理由写在 `assertNotManual` 上。
 *     ⚠️ 拿整道 `assertUpdatable` 会**把每一条缺失下载都拒掉**（缺失 ⇒ 判出来恒是 `unknown`）。
 *
 * ⚠️ 三个"整批/整条拒"的条件（都**不动盘、不发请求**）：
 *   ① 路径不是目录（spec §8：路径不存在不给更新按钮）；
 *   ② 这个文件夹的**有效游戏版本**未知 —— 与 `updateMod` 同一条（spec §8：未选之前所有行
 *      都是 `unknown-version`）；
 *   ③ 它**不是**缺失的（那个 modid 在这个文件夹里已经有行了）⇒ 缺失清单是旧读数。
 *      ⚠️ 这一条看着像"永远不会发生"，但它**是**承重的：渲染进程加载的是**远程网页**
 *      ⇒ 主进程不许把"页面只在缺失时才调我"当成前提（§9 的入参纪律）。
 */
export async function downloadMissing(
  modid: unknown,
  gameVersion: unknown,
  folderId: unknown,
  channel: unknown,
): Promise<ModFoldersState> {
  assertNotBusy();
  const { folderId: id, entry } = requireFolder(folderId);
  const chan = requireChannel(channel);
  if (typeof modid !== 'string' || modid === '') {
    throw new Error('非法参数：modid 必须是非空字符串');
  }
  const version = requireGameVersion(gameVersion, 'gameVersion');
  const known = catalogOf();
  if (known === null) throw new Error('目录还没拉到（这条操作的入参要在目录里查得到）');
  const what = `${modid}|${version}`;
  if (!isDirectory(entry.path)) {
    throw new Error(`这个文件夹的路径现在不是目录（不给下载）：${entry.path}`);
  }
  /*
   * ⚠️★ **这个文件夹的游戏版本**要单独判一条（不能只看入参里那个版本）：
   *    "缺失清单"是按**界面上选中的那个游戏版本**算的，而"下载到 ▾"选的是**别的**一个文件夹 ——
   *    两者不一致时，装进去的是一个**别的游戏版本**的 jar，而它在目录里看起来完全正常
   *    （`updateMod` 对同一条有同样的判据，那一条是 Task 5 加的）。
   */
  const folderVersion = folderGameVersion(entry);
  if (folderVersion === null) {
    throw new Error(
      `这个文件夹的游戏版本还不知道（${basename(entry.path)}）⇒ 不给下载（spec §8：先给它选一个游戏版本）`,
    );
  }
  if (folderVersion !== version) {
    throw new Error(
      `要下的这一条是 ${version}，而这个文件夹是 ${folderVersion} ⇒ 不给下载（那会装进一个别的游戏版本的目录）：${what}`,
    );
  }
  if (!readingOf(id).ok) {
    throw new Error(
      `这个文件夹还没有扫描读数（"没扫过"不等于"它里面没有"）⇒ 先点一次「重扫」：${basename(entry.path)}`,
    );
  }
  const present = folderView(id, entry).rows.find((row) => row.modid === modid);
  if (present !== undefined) {
    throw new Error(
      `这个文件夹里已经有 ${modid} 了（${present.fileName}）⇒ 它不是缺失的（那份缺失清单是上一份读数）：${what}`,
    );
  }
  /*
   * ★ 目标那一行**由内核现算**（不是在这儿 `releasesFor(...)` 再推一遍）：`planCatalogRows`
   *   就是页面第一部分用的那个函数 ⇒ "缺失清单里点了确定"与"目录行上写着的那一条"是同一个东西
   *   （含上游解析、`manual`、`official` 的取舍）。
   * ⚠️★ T6：入参里那两格（`tagFilter` / `bindings`）**已经不存在了** ——
   *   D2 删了标签筛选、D8 删了本地绑定 ⇒ 这一次调用与页面那一处（`buildState`）
   *   现在**逐格相同**（`catalog` / `gameVersion` / `upstreamLatest`），"两处不一样"这件事
   *   连同它的理由一起作废。⇒ 今天这一条问的仍然是"这一对在不在目录里"，
   *   而 answered 它的正是同一个函数。
   */
  const row = planCatalogRows({
    catalog: known,
    gameVersion: version,
    upstreamLatest: upstreamLatestOf(),
  }).find((candidate) => candidate.modid === modid);
  if (row === undefined) {
    throw new Error(`清单里没有这一条（${modid} 在 ${version} 下没有 release）：${what}`);
  }
  if (row.candidates.length !== 1) {
    throw new Error(
      `这一对不是唯一候选（${String(row.candidates.length)} 条）⇒ 没有"该装哪一个"的答案，缺失清单里本来不该有它：${what}`,
    );
  }
  const release = row.official;
  if (release === null) {
    throw new Error(
      `这一行现在没有目标（清单里没有它的 release，或候选多于一条要先明确选一个）：${what}`,
    );
  }
  assertNotManual(row.manual, what, '下载');

  return writeRun({ run: 'download-missing', folderId: id, modid }, async () => {
    /*
     * ★ C/S2：**项的身份**在这里落定（`installFolderRow` 那条路是同一个意思）。
     * ⚠️ 文件名取的是 `originFileNameOf(release.url)` —— 也就是**这一趟要落盘的那个名字**
     *    （`installRelease` 用同一个函数推 `targetPath`）。brief 的示例写的是
     *    `row.fileName`，而这一支手上那个 `row` 是 `CatalogRowView`（**没有** `fileName`：
     *    目录行没有本地文件）⇒ 按 brief 自己那句"取能取到的那个；取不到就用 modid"。
     */
    setRunItem({ modid, fileName: originFileNameOf(release.url) ?? modid });
    const outcome = await installRelease({
      targetDir: entry.path,
      release,
      channel: chan,
      /*
       * 旧副本 = **空**：缺失的定义就是"这个文件夹里没有它的任何副本"，而那一条上面刚查过
       * （`present === undefined`）。⚠️ 于是"目标位置上已经有一个文件"这一支就落给
       * `installRelease` 的闸去拒 —— 那份文件我们没见过（扫描读数里没有它），
       * 覆盖一个不知道是什么的文件正是那道闸要防的事（Ruling 48 的同一族）。
       */
      oldCopies: [],
    });
    /*
     * ⚠️★ T9：**这一支不计数** —— 计数的落点在 `writeRun` 里那**唯一**一处
     *    （按 `work()` 的返回值判：`null` = 真的写了），而 `updateMod` 与
     *    `downloadMissing` 两条入口**共用**那一处 ⇒ 在这里再加一次会数两遍，
     *    而且两处判据必然漂（派工文本第 3 条："**不要另造第二个判据**"）。
     *    ⚠️ 返回值那一句仍然要用 `outcome`（它就是"为什么没动"那句话的来源）。
     */
    // 与 `updateMod` 同一步：目录刚被我们改过 ⇒ 强制重扫（缺失清单与文件夹行都靠它更新）
    await queueScan(id, entry.path, { onlyIfMissing: false });
    return outcome.alreadyCurrent ? '这个文件已经是这一份（没有下载、没有写盘）' : null;
  });
}

/**
 * ★ B2：`lastRun.skipped[].reason` 的**逐支文案**。⚠️ 这些字符串是**页面直接渲染**的
 *    （`ModDownloadPanel` 的 `lastRunSummary` 数条数、`lastRunSkipped` 印"跳过 <modid>：<reason>"）
 *    ⇒ 里边**不许**写实现细节（那是给读日志的人看的，不是给用户看的）。
 *
 * ⚠️ 键集 = `packPlanFor` 那五种 `PackSkipReason`（**预扫**就能判的）
 *    **∪** `'already-current'`（**逐项循环里**才知道的那一支：`installRelease` 的幂等 ——
 *    它**不是**一个 `PackSkipReason`，预扫看不见它：见 §修轮 1）。
 * ⚠️ 类型是 `Record<SkipTextKey, string>`（不是 `Partial`）：判定加一支跳过原因时，
 *    这里**当场编译失败**，必须显式表态 —— 与 `INSTALLABLE` 那张正向列同一招。
 * ★ 修轮 1（评审的 Minor 1）：`already-in-folder` 原先**一稿两用**（`alreadyCurrent` 也念它）
 *    ⇒ 一处字符串担了两件事，代价是实的：
 *      · 丢了 brief 给 `alreadyCurrent` 钉的那一句（"这个文件已经是这一份（没有下载、没有写盘）"，
 *        与 `downloadMissing` 那一句**逐字同形**）；
 *      · 而那一稿里的"（一个请求都不发）"是**实现细节**，却印在页面上。
 *    ⇒ 两条各说各的："文件夹里**有它**"（预扫就知道，与"这一趟要不要开工"有关）
 *    vs "目标**已经是这一份**"（逐项才发现，与"这一趟有没有写盘"有关）。
 */
type SkipTextKey = PackSkipReason | 'already-current';
const SKIP_TEXT: Record<SkipTextKey, string> = {
  'already-in-folder': '这个文件夹里已经有它了',
  'not-in-catalog': '目录里没有这个 modid',
  'no-release': '这个版本下没有它的 release',
  ambiguous: '候选多于一条（要去目录里先明确选一个）',
  manual: '它只给原网页、没有可直接下的字节',
  // ★ brief 给 `alreadyCurrent` 钉的就是这一句（与 `downloadMissing` 那个返回值逐字同形）
  'already-current': '这个文件已经是这一份（没有下载、没有写盘）',
};

/**
 * ★ B2：把整合包里的 mod 逐个装进这个文件夹（spec D5 / §7.6）。
 *
 * 三道闸与 `downloadMissing` **逐字同源**（它们回答的是同一件事，两处各写一遍必然漂）：
 * ① 目标必须是目录；② 文件夹的有效游戏版本必须等于入参版本**且**等于包的 `game_version`
 * （三者不一致 ⇒ 会把别的版本的 mod 装进这个目录）；③ 必须有扫描读数。
 * ⚠️★ **包的内容以服务端为准**：主进程拿 `packId` 自己去 `GET /api/modpacks/<id>`
 *    （IPC 只收 id 这条纪律才完整）—— 包不存在（404）⇒ 抛（IPC reject），
 *    而且**一个下载请求都不发**（闸在逐项循环之前）。
 * ⚠️ 预扫用的是**共享的纯函数** `packPlanFor` —— 与页面决定"能下几个"的是同一个函数。
 * ⚠️★ 一条失败**不中断整包**（进 `failed` 继续）；取消在每一项之前判，
 *    而**被取消那一项不记成失败**（D4"取消不是失败"）—— 与 `updateFolderAll` 那一段逐字同形。
 */
export async function downloadPack(
  packId: unknown,
  gameVersion: unknown,
  folderId: unknown,
  channel: unknown,
): Promise<ModFoldersState> {
  assertNotBusy();
  const { folderId: id, entry } = requireFolder(folderId);
  const chan = requireChannel(channel);
  if (typeof packId !== 'string' || packId === '') {
    throw new Error('非法参数：packId 必须是非空字符串');
  }
  const version = requireGameVersion(gameVersion, 'gameVersion');

  /*
   * ⚠️★ 包的定义**只有服务端那一处**（spec D5）：这里取回来的是"这个包里有哪些 modid、
   *    它是哪个游戏版本的"。`fetchPack` 在 404 时给 `null` ⇒ 这一趟**在动盘之前**就结束。
   */
  const pack = await fetchPack(packId);
  if (pack === null) throw new Error(`这个整合包不存在：${packId}`);

  const known = catalogOf();
  const index = catalogIndexOf();
  if (known === null || index === null)
    throw new Error('目录还没拉到（这条操作的入参要在目录里查得到）');
  if (!isDirectory(entry.path)) {
    throw new Error(`这个文件夹的路径现在不是目录（不给下载）：${entry.path}`);
  }
  const folderVersion = folderGameVersion(entry);
  if (folderVersion === null) {
    throw new Error(
      `这个文件夹的游戏版本还不知道（${basename(entry.path)}）⇒ 不给下载（spec §8：先给它选一个游戏版本）`,
    );
  }
  if (folderVersion !== version || pack.gameVersion !== version) {
    throw new Error(
      `要下的是 ${pack.gameVersion}（界面选的是 ${version}），而这个文件夹是 ${folderVersion} ⇒ 不给下载（那会装进一个别的游戏版本的目录）：${packId}`,
    );
  }
  const reading = readingOf(id);
  if (!reading.ok) {
    throw new Error(
      `这个文件夹还没有扫描读数（"没扫过"不等于"它里面没有"）⇒ 先点一次「重扫」：${basename(entry.path)}`,
    );
  }

  const recognized = folderView(id, entry).rows.flatMap((row) =>
    row.modid === null ? [] : [row.modid],
  );
  /*
   * ★ 预扫是**纯函数**（与页面同一个实现）：
   *    `already-in-folder` / `not-in-catalog` / `no-release` / `ambiguous` / `manual` 五种跳过原因
   *    起手就进 `skipped` —— 它们是"这一趟不打算开工的项"，不算失败。
   */
  const plan = packPlanFor({
    modids: pack.modids,
    gameVersion: version,
    folder: { recognizedModids: recognized },
    index,
    /*
     * ★★ 2026-10-07（用户报的 bug 的修复）：**必须**把上游那张表传进来。
     *    不传的后果是实的：`mcsrranked` 会被装成**目录那条 5.8.22**，而同一行的
     *    「下载到 ▾」装的是**上游 5.8.26**（那是 `planCatalogRows` → `resolveTarget` 的结果）——
     *    同一个 mod、同一个游戏版本，两条路两个版本 ✗。
     *    ⚠️ 与行级那条路（`planCatalogRows({… upstreamLatest: upstreamLatestOf()})`）**同一个来源** ✓。
     */
    upstreamLatest: upstreamLatestOf(),
  });

  return bulkRun({
    run: 'download-pack',
    folderId: id,
    itemCount: plan.items.length,
    work: async () => {
      /*
       * ⚠️★ `updated` 是 **modid 的字符串数组**（`ModFoldersState['lastRun']` 那条契约，
       *    与 `updateFolderAll` / `downloadMissing` 逐字一致）—— brief 那一段示例里写的是
       *    `{ modid: string }[]`，那是**类型错的**（`tsc` TS2322 当场红，而页面那一侧也按
       *    `string[]` 读）。这里按既有形状取。
       */
      const updated: string[] = [];
      const skipped: { modid: string; reason: string }[] = plan.skipped.map((s) => ({
        modid: s.modid,
        reason: SKIP_TEXT[s.reason],
      }));
      const failed: { modid: string; reason: string }[] = [];
      const cancelled: { modid: string; reason: string }[] = [];
      let any = false;
      for (const item of plan.items) {
        // ★ D4：取消之后**剩下的项不再开工**（在每一项之前判，而不是等它自己抛）
        if (isCancelling()) {
          cancelled.push({ modid: item.modid, reason: '已取消' });
          break;
        }
        setRunItem({
          modid: item.modid,
          fileName: originFileNameOf(item.release.url) ?? item.modid,
        });
        try {
          const outcome = await installRelease({
            targetDir: entry.path,
            release: item.release,
            channel: chan,
            /*
             * 旧副本 = **空**（与 `downloadMissing` 同一句）：包里的项是"这个文件夹里还没有"的
             * 那一批（`already-in-folder` 起手就跳过了）⇒ 目标位置要是已经有一个文件，
             * 那它就是我们没见过的 ⇒ 落给 `installRelease` 的闸去拒（Ruling 48 的同一族）。
             */
            oldCopies: [],
          });
          any = true;
          /*
           * ★★ 修轮 1（评审的唯一 Important）：**空转不许冒充"已更新"**（(e)，本文件
           *    `writeRun` 那一节 :1409–1411 钉的就是这条纪律）。
           *    `installRelease` 的幂等那一支**一个字节都没写、一个请求都没发** ⇒ 只进
           *    `skipped`。⚠️ 两个桶**互斥**：原先这里在 `if` **外面**先 push 了 `updated`
           *    ⇒ 同一项同时进两个桶，页面那句汇总行（`lastRunSummary`："已更新 {{ok}} 个，
           *    跳过 {{skipped}} 个"）会把一次空转念成"已更新 1 个，跳过 1 个" ✗。
           *    另两个入口（`updateFolderAll` / `downloadMissing`）都是互斥的，这里是唯一一处例外。
           */
          if (outcome.alreadyCurrent) {
            skipped.push({ modid: item.modid, reason: SKIP_TEXT['already-current'] });
          } else {
            updated.push(item.modid);
            /* ★★ T9（A20）：与上面那两桶**同一条互斥线** —— 空转（`alreadyCurrent`）不加。 */
            noteUpdated();
          }
        } catch (error) {
          /*
           * ★★ D4：**取消不是失败** —— 被我们 abort 掉的那一项进 `cancelled` 然后停，
           *    不记成 `failed`（与 `updateFolderAll` 逐字同形）。
           * ⚠️★ 这一支是 brief 那段示例代码里**没有**的（它只写了"一条失败不中断整包"）；
           *    照它逐字实现时，用户点取消会让那一项以"已中止"的名义进 `failed`，
           *    而同一趟的其它项进 `cancelled` —— 同一个事件两句话，页面显示"失败 1 项"。
           *    那与 D4 明写的"取消不是失败"以及 ㉘/㉘b 两条判据都相反
           *    （`apps/desktop/scripts/verify-mod-folders.mjs` 的探针断言 12 钉的就是本支）。
           */
          if (isCancelling()) {
            cancelled.push({ modid: item.modid, reason: '已取消' });
            break;
          }
          /* ⚠️ 一条失败**不中断整包**：进 `failed` 继续（与 `downloadMissing` 的单条语义相反 —— 那是"点了一条"） */
          failed.push({ modid: item.modid, reason: messageOf(error) });
        }
      }
      if (any) await queueScan(id, entry.path, { onlyIfMissing: false });
      return { updated, skipped, failed, cancelled };
    },
  });
}

// ---------------------------------------------------------------------------
// ★★ D1（T4）：启动器绑定、实例枚举与**对账**
// ---------------------------------------------------------------------------
/*
 * ===========================================================================
 * 这一段负责什么（边界写下来，免得下一个人以为它管得比实际宽）
 * ===========================================================================
 *   · **探测**常见位置（`probeLaunchersOnDisk`）—— 只读、只扫 spec §6 列的候选，不全盘扫；
 *   · **枚举**绑定的启动器（`enumerateAll` / `refreshInstances`）—— 逐块 try/catch（A14），
 *     结果进**模块级缓存**（`enumeration`），**只有 `refreshInstances` 一处写它**；
 *   · **对账**（`reconcileFolders`）—— 同步、零 I/O：把"被追踪的实例"派生成 `folders` 那几条、
 *     把既有的值合并回来、把不再被追踪的回收掉。它是 D1"零功能损失"的落点：
 *     `folders` 的**形状一个字没变** ⇒ 扫描 / 判定 / 整夹更新 / 缺失清单**一行都不用改**。
 *
 * ⚠️★ **只读纪律**（spec A13）：这一段里**没有一处**写启动器或实例的文件 ——
 *    枚举读的是 `mmc-pack.json` / 版本 json / 目录名，写盘只写我们**自己那份**状态文件
 *    （`persist()` ⇒ `file-tracking.json`）。`instance.cfg` / `instance.json` 一个字节都不碰。
 *
 * ⚠️★ **为什么枚举必须缓存**（不许塞进 `buildState()` 里现算）：
 *    现读 `rebuild()` ⇒ **每一次状态改动都会重算 `buildState()`**（换相位、换项、每次勾选、
 *    每次 rescan……），而枚举是"每个实例若干次 `readdir` / `readFile`"（spec §13.3 记着这条
 *    耗时风险），更别说 `buildState()` 是**同步**路径 ⇒ 它会变成一现场 syscall。
 *    ⇒ 形状：`enumerated` 只被 `refreshInstances()`（异步）写；`buildState()` **只读**它。
 *
 * ⚠️★ **对账必须落盘**：启动那一趟（`startUp`）读的是**盘上那一份** `folders`
 *    （它只扫 `autoUpdate === true` 的条目）⇒ 对账改动了就 `persist()`。而"改动了"这件事
 *    由共享内核那一份（`@mcsr/shared/modFolders` 的 `reconcileFolders` 逐格比出来）——
 *    稳态下（第二趟起）对账**一格都不改** ⇒ 不写盘。
 *    ⚠️ `persist()` 在**停住态**（状态文件坏且备份也失败）会抛，而这条路是**同步**的
 *    状态组装路径 ⇒ 抛出去会让 `rebuild()` 连带 IPC 全炸。⇒ 这一处**接住**并记一句
 *    （写不下去的那次对账照旧生效在内存里，下一趟重启再对一次）。
 * ⚠️★ 修复轮（评审 I1）：**规则**（派生 / 合并既有值 / 回收）已经搬进 `packages/shared`
 *    的 `reconcileFolders`（**纯函数**，`services/api` 的用例钉得住它）；这一份只剩
 *    "取数 + `forgetScan` + 落盘"三件事。⚠️ 别把规则搬回来 —— 那会让它又变成零判据的那一半。
 */

/**
 * 六个启动器类型 —— **现读** `LauncherKind` 的六个成员照抄。
 *
 * ⚠️★ 为什么这里必须有一份**值**：`LauncherKind` 是**类型**，运行时拿不到它的成员表，
 *    而"渲染进程递进来的 `kind` 是不是一个真类型"这条校验要一个值（`addLauncher` 的入参
 *    是不可信的）。⇒ 下面那个 `satisfies Record<LauncherKind, true>` 就是这份抄件与类型
 *    之间的**编译期**焊接：类型加一个成员而这里漏了 ⇒ 当场编译失败（多写一个也失败）。
 */
const LAUNCHER_KINDS = Object.keys({
  multimc: true,
  prism: true,
  pcl2: true,
  hmcl: true,
  official: true,
  mcsr: true,
} satisfies Record<LauncherKind, true>) as LauncherKind[];

/**
 * 真实文件系统（`LauncherFs` 的**产品**实现；另一个在测试里用假表实现）。
 *
 * ⚠️★ 三个方法的失败语义是**分开**的，而这份分寸正是 A14 能成立的前提：
 *   · `exists` ⇒ 永远不抛（`existsSync` 本身就是问"在不在"）；
 *   · `readFile` ⇒ **读不到就给 `null`、不抛**：元数据读不出来是**正常情形**
 *     （实例没有那一份 json / 内容坏了）⇒ `parseInstanceMeta` 如实给 `gameVersion: null`
 *     （"不猜"），而**不是**让整块枚举炸掉；
 *   · `listDir` ⇒ **"不存在"与"读不动"分得开**：`ENOENT` / `ENOTDIR` 给空数组
 *     （绝大多数候选根根本不存在，那是正常的），其余错误（`EACCES` / `EPERM` / `EIO`…）
 *     **照抛** —— 那才是 A14 说的"这一块读不动"，由 `enumerateAll` 的逐块 catch 接住、
 *     记进那一块的 `error`（界面画出来 + 可重试）。
 *     ⚠️★ 把它也吞成空数组的话，"一个目录都读不出来"会长成"这个启动器一个实例都没有"——
 *     那正是 Ruling 65 / 判修 1 那条纪律要治的"把不知道说成没有"。
 */
const realFs: LauncherFs = {
  listDir(dir: string): readonly string[] {
    try {
      return readdirSync(dir);
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return [];
      throw error;
    }
  },
  exists(path: string): boolean {
    return existsSync(path);
  },
  readFile(path: string): string | null {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null; // ★ 读不出来 = 不知道（`parseInstanceMeta` 会如实留空），不是失败
    }
  },
};

/** 一条绑定这一趟枚举的结果：成功的 id 与失败的 id ⇒ 原话。 */
interface Enumeration {
  instances: readonly LauncherInstance[];
  /** 这一趟**读成功**的绑定 id。 */
  ok: ReadonlySet<string>;
  /** 这一趟**读不动**的绑定 id ⇒ 失败原话（界面画出这一句 + 一颗重试按钮）。 */
  failed: ReadonlyMap<string, string>;
}

/**
 * ★★ 枚举缓存 —— **只能由 `refreshInstances()` 写**（一处）。
 * ⚠️ `null` = **还没有跑过任何一趟**（不是"没有任何实例"）：这两个状态在 `instances` 上
 *    长得一样（都是 `[]`），所以状态里另有一格 `instancesStatus` 把它们分开（A14）。
 */
let enumeration: Enumeration | null = null;

/** 枚举的**串行队列**（与 `queueScan` / `queueLoadCatalog` 同一条理由）。 */
let refreshQueue: Promise<void> = Promise.resolve();

/** 这一趟枚举出来的实例（**同步、零 I/O** —— `buildState()` 只走这一条路）。 */
function enumerated(): readonly LauncherInstance[] {
  return enumeration?.instances ?? [];
}

/** 枚举缓存里按 key 找一条（同步；找不到就是 `undefined`）。⚠️ 这是**原始**那一份（没套覆盖）。 */
function instanceByKey(key: string): LauncherInstance | undefined {
  return enumerated().find((instance) => instance.key === key);
}

/** 界面那一份实例（同一个缓存 + 现读的 pref ⇒ 与 `deriveFolders` 读的是**同一份**枚举）。 */
function instanceViews(): readonly InstanceView[] {
  return instanceViewsOf(enumerated(), requireState().instancePrefs);
}

/**
 * 按 key 找一条**视图**（手改的路径 / loader / 版本**都已经套用**）。
 *
 * ⚠️★ 这个区别是**承重**的：`instanceByKey` 给的是**探测出来**的那一份，而"勾选要扫哪个目录"
 *    必须用**用户手改之后**的那一份 —— 用原始那一份会去扫**另一个目录**，却把读数记在
 *    **这个** folderId 上 ⇒ 界面显示的是别人家的读数（而且不报错）。
 * ⚠️★ 判据住在**版本控制里**：`@mcsr/shared/modFolders` 的 `scanTargetOf`（规则只留一处，
 *    只认视图）+ `services/api/src/mod-folders-shared.test.ts` 里那两条
 *    （纯函数一条 + `setInstanceTracked` 的**源码形状**一条）。
 *    ⚠️ 修复轮之前这里指向的是 `.cache/d1-t4-probe.mjs` —— 那份脚本**不在版本控制里**
 *    （评审 I1/I2 点名的正是这件事：别让文档比证据硬）。
 */
function instanceViewByKey(key: string): InstanceView | undefined {
  return instanceViews().find((view) => view.key === key);
}

/**
 * 一次绑定的**形状校验**（状态文件只保顶层形状 ⇒ `launchers: [42]` 能一路流到这里）。
 *
 * ⚠️ 返回值是"哪里不对"的原话，`null` = 形状对。判据全是**形状**，不碰文件系统。
 */
function bindingShapeError(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return '不是一条绑定（不是一个对象）';
  const { id, kind, rootPath } = raw as Partial<LauncherBinding>;
  if (typeof id !== 'string' || id === '') return '缺 id';
  if (typeof kind !== 'string' || !LAUNCHER_KINDS.includes(kind as LauncherKind)) {
    return `不认识的启动器类型：${JSON.stringify(kind)}`;
  }
  if (typeof rootPath !== 'string' || rootPath === '') return '缺 rootPath';
  return null;
}

/**
 * 逐块枚举：**一个启动器块坏掉不许让整份列表空**（spec A14）。
 *
 * ⚠️★ 每一块各自 `try/catch`，失败只记进 `failed`（key = 绑定 id）—— 其余块照常进结果。
 * ⚠️★ `await yieldToEventLoop()` 在每一块之后：这是"A14 枚举**异步**"的落地 ——
 *    一次枚举要读几十上百个目录，一路同步跑下来会把主进程的事件循环按住（窗口不响应）。
 * ⚠️ 坏形状的绑定（`launchers: [42]`）在这一层就跳过：它连 id 都没有，界面画不出它、
 *    也就无从重试 ⇒ 记一句 notice（由 `pushNotice`，见 `launcherViews` 的调用点）。
 * ★★ 修复轮（评审 C1）：**先问一句"这一块的实例父目录在不在"**，不在就当场记成"读不动"
 *    （`failed`）—— 这是那个绕过口的堵法。为什么不能靠 `listInstances` 自己发现：
 *    `realFs.listDir` 把 `ENOENT`/`ENOTDIR` **故意吞成空数组**（候选根绝大多数不存在，
 *    那是正常的），于是"根整体不在"与"这个启动器一个实例都没有"**长得一模一样**
 *    ⇒ 那一块被算成成功 ⇒ 对账于是把用户派生出来的 folder 与读数删掉**并落盘**，
 *    而界面上一句"我读不到它"都没有（评审 `harness.mjs rootgone` 的实测现场）。
 *    ⚠️ 判据只有一处：`missingInstancesDir`（`@mcsr/shared/launcherInstances`）——
 *    布局规则（`instancesParentOf`）也只在那一份里。
 */
async function enumerateAll(bindings: readonly unknown[]): Promise<Enumeration> {
  const instances: LauncherInstance[] = [];
  const ok = new Set<string>();
  const failed = new Map<string, string>();
  for (const [index, raw] of bindings.entries()) {
    const shapeError = bindingShapeError(raw);
    if (shapeError !== null) {
      // 合成一个**永远不会与真 id 撞**的键：它只用来把这句话带出去
      failed.set(`坏绑定#${String(index)}`, shapeError);
      continue;
    }
    const binding = raw as LauncherBinding;
    try {
      const missing = missingInstancesDir(realFs, binding.kind, binding.rootPath);
      if (missing !== null) {
        failed.set(binding.id, missing); // ★ "读不动"：不算成功、它的实例缺席也不作数
      } else {
        instances.push(...listInstances(realFs, binding.kind, binding.rootPath));
        ok.add(binding.id);
      }
    } catch (error) {
      failed.set(binding.id, messageOf(error));
    }
    await yieldToEventLoop();
  }
  return { instances, ok, failed };
}

/**
 * 重新枚举当前绑定的全部启动器、写回缓存，并返回那一份实例视图。
 *
 * ⚠️★ **它是唯一写 `enumeration` 的地方**（`refreshInstances()` 的调用点：模块初始化那一趟
 *    `startUp`、第一次 `getState`、`addLauncher` / `removeLauncher`、`confirmInstance` 之后，
 *    以及 `listLauncherInstances` 那条通道本身 = "用户点刷新"）。
 *    ⚠️ **勾选 / 取消勾选不走这里**：勾选只动我们自己的状态（那两格），扫启动器目录是白费 I/O。
 * ⚠️ 串行：两条通道同时来（页面连点刷新 / 与 `addLauncher` 撞上）不会并发读同一批目录，
 *    也不会出现"谁后到谁说了算"的两份缓存。
 */
function refreshInstances(): Promise<readonly InstanceView[]> {
  const run = async (): Promise<void> => {
    enumeration = await enumerateAll(requireState().launchers as readonly unknown[]);
    rebuild();
  };
  const next = refreshQueue.then(run, run);
  refreshQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next.then(() => instanceViews());
}

/**
 * 界面上"绑定的启动器"那一栏（`ModFoldersState.launchers`）。
 *
 * ⚠️ `error` 取的是**这一趟**枚举的失败原话（成功 / 还没读过 ⇒ `null`）—— 它**不是**
 *    `pushNotice` 那种一旦说了就永远挂着的东西：重试成功之后那一格必须自己变回 `null`。
 * ⚠️ 坏形状的绑定画不出来（连 id 都没有）⇒ 跳过 + 一句 notice（那句话是**粘的**，因为
 *    它要用户去手改状态文件，不是"再点一次刷新"能修好的）。
 */
function launcherViews(st: SharedState): LauncherBindingView[] {
  const out: LauncherBindingView[] = [];
  for (const raw of st.launchers as readonly unknown[]) {
    const shapeError = bindingShapeError(raw);
    if (shapeError !== null) {
      pushNotice(`状态文件里有一条读不出来的启动器绑定（${shapeError}）⇒ 界面不画它，请手动核对`);
      continue;
    }
    const binding = raw as LauncherBinding;
    out.push({
      id: binding.id,
      kind: binding.kind,
      rootPath: binding.rootPath,
      error: enumeration?.failed.get(binding.id) ?? null,
    });
  }
  return out;
}

/**
 * ★★ **对账**（`buildState()` 里那一次调用）—— 规则住在 `@mcsr/shared/modFolders` 的
 * `reconcileFolders`（**纯函数**，评审 I1：那样才有 `services/api` 的用例钉得住它），
 * 这一份只做**三件主进程才有的事**：
 *   ① 取数：`views`（枚举缓存 + 现读的 pref）、`st.folders`、`st.launchers`、
 *      这一趟读不动的绑定 id（`enumeration.failed`）、"跑过枚举没有"（`enumeration !== null`）；
 *   ② 落盘：`changed` 为真才 `persist()`（启动扫描读的是**盘上那一份** `folders`）；
 *   ③ 清读数：被回收的每一个 key 都要 `forgetScan`（A9：取消勾选 ⇒ folder 消失**且**读数清除；
 *      缓存住在 `mod-folder-scan.ts`，纯函数那一层够不着它）。
 *
 * ⚠️★ `forgetScan` **不能**漏：只删 entry 的话，那个 key 的旧读数会留在缓存里，
 *    同一个路径再勾回来会拿到**旧读数**（"昨晚的目录"）。
 * ⚠️ `persist()` 那一处**必须**接住异常：这是**同步**的状态组装路径，停住态（状态文件坏且
 *    备份也失败）下它会抛 —— 抛出去会让 `rebuild()` 连带 `getState` 一起炸，而"写不下去"
 *    已经由 `initModFolders` 那条 notice + 弹框说过一次了。写不下去时对账照旧生效在**内存**里。
 */
function reconcileFolders(st: SharedState, views: readonly InstanceView[]): void {
  const result = sharedReconcileFolders({
    instances: views,
    prefs: st.instancePrefs,
    folders: st.folders,
    launchers: st.launchers as readonly LauncherBinding[],
    failed: [...(enumeration?.failed.keys() ?? [])],
    enumerated: enumeration !== null,
    now: Date.now(),
  });
  if (!result.changed) return;
  for (const key of result.removed) forgetScan(key);
  st.folders = result.folders;
  try {
    persist();
  } catch (error) {
    pushNotice(`对账改了文件夹表，但状态文件写不下去：${messageOf(error)}`);
  }
}

/** 现读 `state.instancePrefs[key]`（坏形状 —— `null` / 不是对象 —— 一律当"没有这一格"）。 */
function prefRecordOf(st: SharedState, key: string): InstancePref | undefined {
  const pref = st.instancePrefs[key];
  return typeof pref === 'object' && pref !== null ? pref : undefined;
}

/**
 * 一条绑定的**根路径归一化**（去掉尾部的 `\` / `/`）。
 *
 * ⚠️★ 为什么"添加启动器"这条入口必须归一化（而 `listInstances` 内部**也**做一次）：
 *    绑定 id 是 `${kind}:${根}`，而 `D:\PCL2` 与 `D:\PCL2\` 不归一化就是**两条绑定**
 *    ⇒ 同一台机器上会出现两套同名的实例（`instanceKeyOf` 用的是比出来的相对路径）。
 * ⚠️ 它与 `launcherInstances.ts` 的 `normalizeRoot`（私有）**同形**：那一份管"枚举时的入参"，
 *    这一份管"记账时的键"。两处都要，因为它们服务的是两件事；⚠️ 改一处时另一处要一起看。
 */
function normalizedBindingRoot(rootPath: string): string {
  return rootPath.trim().replace(/[\\/]+$/, '');
}

/**
 * 真实 Windows 上"常见盘符根"：`A:\`…`Z:\` 里**真的存在**的那些（只 stat 根，不全盘扫）。
 *
 * ⚠️ 顺序是**字母序**（`A` 到 `Z`）—— 修复轮（评审 I3）现读订正：原来写的是
 *    `'CDEFGHIJKLMNOPQRSTUVWXYZAB'`（C…Z 之后又回到 A、B），那不是任何有意义的顺序，
 *    而它**真的**决定 `probeLaunchers` 返回候选的次序 ⇒ 换成一眼可读的字母序。
 *    ⚠️ 找不到盘符（`existsSync` 为假）的直接跳过；顺序本身不是契约（界面上那是一个列表）。
 */
function driveRoots(): string[] {
  if (process.platform !== 'win32') return ['/'];
  const roots: string[] = [];
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = `${letter}:\\`;
    if (existsSync(root)) roots.push(root);
  }
  return roots;
}

/**
 * ★ D1（T4）：扫**常见位置**报出命中的启动器根（spec §6 的探测策略：不做全盘扫描）。
 *
 * ⚠️★ 判"命中"的判据是**"这个根真的能列出实例"**（`listInstances(...).length > 0`），
 *    **不是**"根目录存在"：后者会把 `%APPDATA%\.minecraft` 这种人人都有、而未必是用户
 *    真正在用的根报出来 —— 用户会以为已经绑好了，之后**所有判定都落在错的目录上**
 *    （"报了一个它其实不用的根"比"什么都没报"更坏）。
 *    ★ 用 `listInstances` 而不是自己拼"实例父目录存不存在"：拼一遍就是**第二份**目录布局
 *    规则（`instancesParentOf` 那一份），两处迟早漂。
 * ⚠️ 候选根由**外面**定（`probeLaunchers` 的的调用方是页面），这里只负责"哪些真的能用"。
 * ⚠️ 读不动的候选根（`EACCES` 之类）⇒ **不报**（`try/catch` 吞掉）：探测的产物是
 *    "可以加的那些"，一个加不上的根不该出现在那里（用户加了它也只会在枚举时看到错误）。
 * ★★ 修复轮（评审 I3）：它**现在是 `async`**，而且每一轮候选之后 `await yieldToEventLoop()`
 *    —— 与 `enumerateAll` **同一条纪律**（A14"枚举异步"）。为什么必须：
 *    命中一个真启动器时 `listInstances` 会枚举**全部实例**（每个实例 1–3 次 `readFileSync`），
 *    而这条 handler 是 `ipcMain.handle(..., () => probeLaunchersOnDisk())` —— 同步跑完会把
 *    主进程的事件循环**按住**（窗口不响应、扫描推送全停）。候选数是
 *    「存在的盘符 × 4 + 固定的那几条」⇒ 有界的，让出一次就够。
 * ⚠️ 代价（认，评审 I3 点名）：候选表按**盘符数**翻倍，所以多盘机器上这一趟的 I/O 也是线性放大
 *    —— 这一条**没有耗时读数**（本机没造多盘夹具），只记形状。
 */
async function probeLaunchersOnDisk(): Promise<{ kind: LauncherKind; rootPath: string }[]> {
  const home = homedir();
  const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
  const localAppData = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
  const drives = driveRoots();

  const candidates: { kind: LauncherKind; rootPath: string }[] = [];
  const seen = new Set<string>();
  const add = (kind: LauncherKind, rootPath: string): void => {
    const root = normalizedBindingRoot(rootPath);
    if (root === '') return;
    const id = `${kind}:${root.toLowerCase()}`;
    if (seen.has(id)) return;
    seen.add(id);
    candidates.push({ kind, rootPath: root });
  };

  for (const drive of drives) {
    add('multimc', `${drive}MultiMC`);
    add('prism', `${drive}PrismLauncher`);
    add('pcl2', `${drive}PCL2`);
    add('hmcl', `${drive}HMCL`);
  }
  for (const kind of ['multimc', 'prism'] as const) {
    const name = kind === 'multimc' ? 'MultiMC' : 'PrismLauncher';
    add(kind, join(appData, name));
    add(kind, join(home, name));
  }
  add('pcl2', join(home, 'PCL2'));
  add('hmcl', join(home, 'HMCL'));
  /* 官方：`%APPDATA%\.minecraft`（默认安装位置；`versions\` 下才有实例，见下面那条判据）。 */
  add('official', join(appData, '.minecraft'));
  /*
   * ★ MCSR Launcher（spec §13.1 的那条**推断**，2026-10-11 源码实证了一半）：
   *   根 = "启动 exe 时的 CWD 下的 `launcher\`"，官方 Windows 安装包的 `DefaultDirName` 是
   *   `{localappdata}\MCSRLauncher` ⇒ 最常见的是第三个候选。**没有**用户可选那一步
   *   ⇒ 命中不了就让用户手填（界面上"手动指定根"必须一直在）。
   */
  add('mcsr', join(localAppData, 'MCSRLauncher', 'launcher'));
  add('mcsr', join(localAppData, 'MCSRLauncher'));
  add('mcsr', join(appData, 'MCSRLauncher', 'launcher'));

  const hits: { kind: LauncherKind; rootPath: string }[] = [];
  for (const candidate of candidates) {
    try {
      if (listInstances(realFs, candidate.kind, candidate.rootPath).length > 0)
        hits.push(candidate);
    } catch {
      /* 读不动 ⇒ 不报（见上面那一条：探测的产物是"可以加的那些"） */
    }
    // ★ 与 `enumerateAll` 同一条纪律：一块一次，别把事件循环按住（见 docblock 那一段）
    await yieldToEventLoop();
  }
  return hits;
}

/** 一个 `instance.key` 的**形状**校验（入参来自渲染进程 ⇒ 一律不可信）。 */
function requireInstanceKeyShape(key: unknown): string {
  if (typeof key !== 'string' || key === '') {
    throw new Error('非法参数：key 必须是非空字符串（`instance.key`）');
  }
  return key;
}

/**
 * 一个 `instance.key` 的**存在性**校验：它要么在**这一趟枚举结果**里，要么**已经有 pref**。
 *
 * ⚠️★ 为什么"已经有 pref"也算过：枚举是**逐块**的，一块读不动时它名下的实例不在结果里 ——
 *    那时用户仍然要能取消勾选 / 把路径改回去（否则"一块坏掉"就把那一块的操作**全锁死**了，
 *    而那正好是 A14 要求"坏掉的那一块可以重试"的反面）。
 * ⚠️ 两条都不成立 ⇒ **抛**：不猜、也不给一个凭空造出来的 key 建一条配置
 *    （那会让状态文件里长出界面永远看不到的垃圾格）。
 */
function requireInstanceKey(key: unknown): string {
  const id = requireInstanceKeyShape(key);
  if (instanceByKey(id) === undefined && prefRecordOf(requireState(), id) === undefined) {
    throw new Error(`枚举结果里没有这个实例（先刷新一次再操作）：${id}`);
  }
  return id;
}

/** `setInstancePaths` 的 patch：只认那三格，且每格必须是**非空字符串**（或省略 = 不改）。 */
function instancePatchOf(patch: unknown): { modsDir?: string; savesDir?: string; loader?: string } {
  if (!isRecord(patch)) throw new Error('非法参数：patch 必须是一个对象');
  const out: { modsDir?: string; savesDir?: string; loader?: string } = {};
  for (const field of ['modsDir', 'savesDir', 'loader'] as const) {
    const value = patch[field];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value === '') {
      throw new Error(`非法参数：${field} 必须是非空字符串（省略 = 不改这一格）`);
    }
    out[field] = value;
  }
  return out;
}

/**
 * ★ A12：手改一个实例的解析结果（**持久化**，且下一趟枚举时它**优先于探测**）。
 *
 * ⚠️ 逐格覆盖（`{...prev, ...clean}`）：只给出来的那几格才算覆盖 —— 整份替换会让"只改
 *    `saves`"顺手把 `mods` 也钉死成当时看到的那一份。
 * ⚠️ 通知**不去重**：`patch` 是空对象时这一趟什么也不改（但也不抛 —— 界面失焦时可能发一次
 *    空的 patch，那不是错误）。
 * ⚠️★ 它**不重扫启动器目录**（改的是解析结果，不是磁盘布局）：`rebuild()` 会让视图与派生
 *    的 folder 立刻跟上（`reconcileFolders` 是同步的）。
 */
function setInstancePaths(key: unknown, patch: unknown): void {
  const id = requireInstanceKey(key);
  const clean = instancePatchOf(patch);
  if (Object.keys(clean).length === 0) return;
  const st = requireState();
  const prev = prefRecordOf(st, id) ?? { tracked: false };
  st.instancePrefs[id] = { ...prev, ...clean };
  persist();
  rebuild();
}

/**
 * ★ 控制器 2026-10-11 裁定的那条**显式确认**：把"用户看过并接受了这个解析结果"记下来。
 *
 * ⚠️★ 为什么不靠"字符串变没变"推：`applyOverride` 只在**值真的变了**时清 `needsConfirm`
 *    （同值覆盖不清 —— 那是对的，空覆盖不产生"用户确认过"这个事实）⇒ 用户"看着对、
 *    什么都没改"这一种接受**没有落点**。这条通道就是那个落点。
 */
async function confirmInstance(key: unknown): Promise<void> {
  const id = requireInstanceKey(key);
  const st = requireState();
  const prev = prefRecordOf(st, id) ?? { tracked: false };
  st.instancePrefs[id] = { ...prev, confirmed: true };
  persist();
  /*
   * ⚠️ 这里走一趟**重新枚举**（而不是只 `rebuild()`）：确认这个动作的对象是"解析结果"，
   *    而解析结果可能刚好在这一刻变了（用户可能刚改过磁盘上的东西）—— 重新读一次，
   *    用户点的那一下才是对着**当前**这一份结果按的。⇒ 界面随之拿到的 `needsConfirm`
   *    是"刚读出来的那一份 + 已确认"（视图里那一格是显示值 `needsConfirm && !confirmed`）。
   */
  await refreshInstances();
}

/**
 * ★ A9：勾选 / 取消勾选一个实例。
 *
 * ⚠️★ 勾上 ⇒ **立刻扫一次**：用户马上就能看到"缺哪些"（`missing` 与文件夹行都靠这份读数），
 *    而这正是 A9 要的"勾选即触发一次扫描"。⚠️★ 要扫的路径必须从**枚举结果**里取
 *    （`view.modsDir`，路径手改**已套用**），**不要**从 `folders` 里查 —— 勾选那一刻
 *    `folders[key]` **还不存在**（它是下一趟对账才长出来的），查不到 ⇒ 扫描落空 ⇒
 *    "勾了却看不到任何读数"。
 * ⚠️ 取消 ⇒ **删读数**（A9 的字面"读数一并清"），那一格 `folders` 由紧接着的 `rebuild()`
 *    里那次对账回收（`reconcileFolders` 的第 ② 条）—— 两条路都在**同一趟**里发生，
 *    所以界面看到的永远是"消失了、且读数也没了"。
 * ⚠️ 它在**取消**那一支不要求实例还在枚举结果里（见 `requireInstanceKey`）：一块读不动时，
 *    用户仍然要能取消勾选。
 */
async function setInstanceTracked(key: unknown, tracked: unknown): Promise<void> {
  const id = requireInstanceKey(key);
  if (typeof tracked !== 'boolean') throw new Error('非法参数：tracked 只接受布尔');
  /*
   * ★★ **勾选**那一支要求这个实例有一份**视图**（= 它的 `modsDir` 能算出来）——
   *    而且"要扫哪个目录"**只经 `scanTargetOf`**（共享内核那一格：只认视图，没有视图就没有目标）。
   *    ⚠️ 少了这道闸，"勾上但它派生不出 folder（视图把这一行滤掉了）"会变成一个
   *    **静默的成功**：状态里记着 `tracked: true`，而界面上什么都没有 —— 正是 A9 要防的
   *    "勾了却看不到任何读数"。⇒ 宁可当场拒（它同时也是"解析结果读不出来"的如实报告）。
   *    ⚠️ 取址**必须**用视图那一份（手改已套用）：拿原始枚举的 `modsDir` 会去扫**探测出来**的
   *    目录、却把读数记在这个 key 上 ⇒ 界面显示的是别人家的读数，而且不报错。
   *    ⇒ 那件事由 `scanTargetOf` + 一条**源码形状**判据钉住（`services/api` 那个测试文件里；
   *    原来的注释指向一份**不在版本控制里**的探针，评审 I2 点了这一条）。
   * ⚠️ **取消**那一支不要求（`prefRecordOf` 兜住）：一块读不动时用户仍然要能取消勾选。
   */
  const view = tracked ? instanceViewByKey(id) : undefined;
  const target = scanTargetOf(view);
  if (tracked && target === null) {
    throw new Error(`这个实例的解析结果读不出来（勾了也扫不成）⇒ 先改好路径再勾：${id}`);
  }
  const st = requireState();
  const prev = prefRecordOf(st, id) ?? {};
  st.instancePrefs[id] = { ...prev, tracked };
  /*
   * ⚠️ 先落盘、再扫描：勾选这件事本身（用户的意图）比扫描读数重要 —— 扫描中途出任何事，
   *    "它被追踪着"这个事实都已经记下来了（下次启动照样扫它）。
   */
  persist();
  if (target !== null) {
    await queueScan(id, target, { onlyIfMissing: true });
  } else {
    forgetScan(id);
  }
  rebuild();
}

/** `addLauncher` / `removeLauncher` 的 kind 校验（渲染进程递进来的东西一律不可信）。 */
function requireLauncherKind(kind: unknown): LauncherKind {
  if (typeof kind !== 'string' || !LAUNCHER_KINDS.includes(kind as LauncherKind)) {
    throw new Error(`非法参数：不认识的启动器类型：${JSON.stringify(kind)}`);
  }
  return kind as LauncherKind;
}

/**
 * 加一条启动器绑定（幂等：同一个 `(kind, 归一化后的根)` 不会变成两条）。
 *
 * ⚠️★ 归一化在**入口**做（见 `normalizedBindingRoot`）：`D:\PCL2` 与 `D:\PCL2\` 是**同一条**。
 * ⚠️ 它只写我们自己的状态（A13：不碰启动器目录一个字节），然后**重新枚举**那一趟
 *    （新绑的启动器要立刻长出实例列表，否则用户点了"添加"什么都看不到）。
 */
async function addLauncher(kind: unknown, rootPath: unknown): Promise<void> {
  const launcherKind = requireLauncherKind(kind);
  if (typeof rootPath !== 'string' || rootPath === '') {
    throw new Error('非法参数：rootPath 必须是非空字符串');
  }
  const root = normalizedBindingRoot(rootPath);
  if (root === '') throw new Error(`非法参数：这个根路径归一化之后是空的：${rootPath}`);
  const st = requireState();
  const id = `${launcherKind}:${root}`;
  if (!st.launchers.some((binding) => bindingShapeError(binding) === null && binding.id === id)) {
    st.launchers = [...st.launchers, { id, kind: launcherKind, rootPath: root }];
    persist();
  }
  await refreshInstances();
}

/**
 * 移除一条绑定：**只删我们自己的记账**（A13）。
 *
 * ⚠️★ 它名下**这一趟枚举到的**实例一律转为"不再追踪"（读数一并清）：绑定没了 ⇒ 下一次枚举
 *    它们就不会出现 ⇒ 它们在 `folders` 里的那一条也留不住（对账的第 ② 条）。
 *    把它明说出来（而不是等对账去猜）有两个好处：① 用户"取消绑定"的意图就是"别再管这些
 *    实例了"；② 即使那一趟枚举因为别的原因读不动，这些实例的勾选也已经落定了。
 * ⚠️ "它名下的实例"按**实例路径落在根里面**判（`isInsideFolder`，与本文件 §13.1 那条用的是
 *    同一个谓词）：key 里只有相对路径、**没有根**，所以两个同类型的根下同一个相对路径
 *    **会撞出同一个 key** —— 用路径判才分得开。
 */
async function removeLauncher(id: unknown): Promise<void> {
  if (typeof id !== 'string' || id === '') throw new Error('非法参数：id 必须是非空字符串');
  const st = requireState();
  const binding = (st.launchers as readonly unknown[])
    .map((raw) => (bindingShapeError(raw) === null ? (raw as LauncherBinding) : null))
    .find((b) => b !== null && b.id === id);
  if (binding == null) throw new Error(`状态里没有这条启动器绑定：${id}`);

  st.launchers = (st.launchers as readonly unknown[]).filter(
    (raw) => !(bindingShapeError(raw) === null && (raw as LauncherBinding).id === id),
  ) as LauncherBinding[];
  /* ⚠️ 上面这个 `as` 是**如实**的：`migrateState` 只保顶层形状 ⇒ 盘上可能还留着坏元素
     （`[42]` 那种），而它们**照旧留在表里**（我们不悄悄替用户改写他的状态文件 ——
     坏元素由 `launcherViews` 那句 notice 说出来，用户自己去改）。 */
  for (const instance of enumerated()) {
    if (instance.kind !== binding.kind) continue;
    if (!isInsideFolder(instance.instancePath, binding.rootPath)) continue;
    const prev = prefRecordOf(st, instance.key) ?? {};
    st.instancePrefs[instance.key] = { ...prev, tracked: false };
    forgetScan(instance.key);
  }
  persist();
  /* ★ 重新枚举 ⇒ 对账把那些派生出来的 folder 一起回收（并且落盘）。 */
  await refreshInstances();
}

// ---------------------------------------------------------------------------
// 装配
// ---------------------------------------------------------------------------

/**
 * 注册二十二条 `ipcMain.handle`（`onStatus` 与 C 的 T3 加的 `onProgress` 是**推**给页面的：
 * 主进程只 `send`，没有 handler 可注册 ⇒ 24 个契约成员 − 2 条推送 = 22 条 handler，
 * ★ D1 的 T4 加了七条（那七条**全是** handler，见文件头那一行）。
 *
 * ⚠️ 通道名一律取自 `MOD_FOLDERS_CHANNELS`（`@mcsr/shared/desktop`），**不写字符串字面量**：
 *    写错一个字母**类型检查看不见**，而失败形态是静默的（`invoke` reject / `on` 永不触发）。
 */
function registerIpc(): void {
  /*
   * ⚠️★ `getState` 是**异步**的，而且它先 `ensureScans()`（Ruling 34 / 判修 1）：
   *    "页面第一次要状态"就是"有人真要这份数据了"的那一刻 —— 这时把还没有读数的
   *    已绑定文件夹扫掉，页面拿到的第一份状态就是完整的（不必再等一次推送才正确）。
   *    代价（认）：第一次 `getState` 会等这几个文件夹的扫描（每份 jar 都要算 sha512）。
   *    第二次起都是现成的读数，不再扫（`onlyIfMissing`）。
   */
  ipcMain.handle(MOD_FOLDERS_CHANNELS.getState, async () => {
    /*
     * ★★ D1（T4）：**第一次**要状态时先把实例枚举出来（枚举是异步的、结果住在缓存里，
     *    而 `folders` 是从它派生的）—— 少了这一句，页面第一次拿到的那份状态里一个派生的
     *    folder 都没有（要等下一次推送才出现，而"下一次推送"可能要等到用户去点别的按钮）。
     * ⚠️ 只在**还没有跑过任何一趟**时做：之后各次不再重枚举（缓存现成；用户点「刷新」
     *    走 `listLauncherInstances` 那条通道）。
     */
    if (enumeration === null) await refreshInstances();
    // 文件夹清单由这一侧给（`sortedFolders` 属于状态组装，见 `ensureScans` 的注释）
    await ensureScans(sortedFolders(requireState()));
    rebuild();
    return modFoldersState();
  });
  ipcMain.handle(MOD_FOLDERS_CHANNELS.bindFolder, (_event, gameVersion: unknown) =>
    bindFolder(gameVersion),
  );
  ipcMain.handle(MOD_FOLDERS_CHANNELS.unbindFolder, (_event, folderId: unknown) =>
    unbindFolder(folderId),
  );
  /* ★ A 的 S2：系统文件管理器里打开这个文件夹（入参只有 id，路径见实现里那一段）。 */
  ipcMain.handle(MOD_FOLDERS_CHANNELS.openFolder, (_event, folderId: unknown) =>
    openFolder(folderId),
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
  /*
   * ★ B2 / T4 立的契约、T5 落的**行为**：整包下载。入参一律 `unknown`（与上面每一条同一条纪律），
   *   顺序与 `downloadMissing` 一致（`packId, gameVersion, folderId, channel`），
   *   与 `preload.ts` 那个包装器、`packages/shared/src/desktop.ts` 的契约三方逐字对齐。
   *   ⚠️★ 这里**只留一条** `ipcMain.handle`（原来那条抛"还没实现"的桩已经删掉）：
   *     同一个通道注册两次会让 Electron 直接抛 "second handler"（整个主进程起不来）。
   */
  ipcMain.handle(
    MOD_FOLDERS_CHANNELS.downloadPack,
    (_event, packId: unknown, gameVersion: unknown, folderId: unknown, channel: unknown) =>
      downloadPack(packId, gameVersion, folderId, channel),
  );
  /*
   * ★ Task 5：两条写盘通道。入参一律 `unknown`（与上面十条同一条纪律 —— 校验在函数体里）。
   *    ⚠️ 这两条**收 `releaseKey`**（只有它们收）：页面把它自己渲染那一行的 key 带回来，
   *    主进程按它在目录里查 —— 这是"页面能指定下载哪一个"的唯一入口。
   */
  ipcMain.handle(
    MOD_FOLDERS_CHANNELS.updateMod,
    (_event, folderId: unknown, modid: unknown, releaseKey: unknown, channel: unknown) =>
      updateMod(folderId, modid, releaseKey, channel),
  );
  /*
   * ★ Task 6：批量那两条。入参一律 `unknown`（与上面同一条纪律）。
   *    ⚠️ 这两条**不收 `releaseKey`**（那是页面唯一能指定"下哪一个"的入口，只有 `updateMod` 有）：
   *       `updateFolderAll` 的目标来自主进程自己那份行视图、`downloadMissing` 按
   *       `(modid, 游戏版本)` 在目录里现算 ⇒ 页面能按 id 触发写盘，但**写哪里、从哪儿取**
   *       仍然不是它说了算（`preload.ts` 文件头那一段）。
   *    ⚠️★ T6：这里原来还有第三条 `updateCatalogRow`（第一部分的绑定）。它随那三个通道
   *       一起删了（契约 17 → 14）⇒ 今天收 `releaseKey` 的**只有 `updateMod` 一条**。
   */
  ipcMain.handle(
    MOD_FOLDERS_CHANNELS.updateFolderAll,
    (_event, folderId: unknown, channel: unknown) => updateFolderAll(folderId, channel),
  );
  ipcMain.handle(
    MOD_FOLDERS_CHANNELS.downloadMissing,
    (_event, modid: unknown, gameVersion: unknown, folderId: unknown, channel: unknown) =>
      downloadMissing(modid, gameVersion, folderId, channel),
  );
  /*
   * ★ C 的 T4：取消。**入参一个都没有**（与上面每一条同一条纪律：渲染进程递不进任何东西）
   *    —— 它的作用范围就是"主进程自己记着的那一趟"。
   */
  ipcMain.handle(MOD_FOLDERS_CHANNELS.cancelDownload, () => cancelDownload());

  /*
   * ===========================================================================
   * ★★ D1（T4）：启动器绑定与实例 —— 七条通道（契约 17 → 24）
   * ===========================================================================
   * 入参一律 `unknown`（与上面每一条同一条纪律 —— 校验在函数体里）。返回值除两条外都是
   * `void`：状态由这些函数里的 `rebuild()` 推给页面（`onStatus`），页面读那一份
   * （状态只有一处真相，不必再从返回值里拿一次）。
   * ⚠️★ 只读纪律（A13）：这七条**一条都不写**启动器或实例的文件 ——
   *    `probeLaunchers` / `listLauncherInstances` 只读盘，其余五条只写我们**自己那份**状态文件。
   */
  ipcMain.handle(MOD_FOLDERS_CHANNELS.probeLaunchers, () => probeLaunchersOnDisk());
  ipcMain.handle(MOD_FOLDERS_CHANNELS.listLauncherInstances, () => refreshInstances());
  ipcMain.handle(MOD_FOLDERS_CHANNELS.setInstancePaths, (_event, key: unknown, patch: unknown) => {
    setInstancePaths(key, patch);
  });
  ipcMain.handle(MOD_FOLDERS_CHANNELS.addLauncher, (_event, kind: unknown, rootPath: unknown) =>
    addLauncher(kind, rootPath),
  );
  ipcMain.handle(MOD_FOLDERS_CHANNELS.removeLauncher, (_event, id: unknown) => removeLauncher(id));
  ipcMain.handle(
    MOD_FOLDERS_CHANNELS.setInstanceTracked,
    (_event, key: unknown, tracked: unknown) => setInstanceTracked(key, tracked),
  );
  ipcMain.handle(MOD_FOLDERS_CHANNELS.confirmInstance, (_event, key: unknown) =>
    confirmInstance(key),
  );
}

/**
 * 初始化：**接手 v1 那份状态对象** → 注册二十二条 IPC → 后台抓目录 + 枚举实例 + 扫已绑定文件夹。
 *
 * ⚠️ 与 v1 的 `initFileUpdates` 同一条时序纪律：**IPC 的注册发生在第一个 `await`
 *    之前**（`main.ts` 里这个 `await` 在创建窗口之前）—— 反过来的话存在一个
 *    "窗口已经能发消息、主进程还没在监听"的窗口期，那几条消息会被静默丢弃。
 * ⚠️★ **本模块不自己读状态文件**（Ruling 38）：`sharedStateFile()` 交出来的就是
 *    `initFileUpdates` 从磁盘读过、并归一化过（Ruling 31）的**同一个对象**。
 *    坏形状的"备份 + 重建 + 告诉用户"因此由 v1 那条路负责（它在 `main.ts` 里先跑）。
 *    ⇒ 这里只剩一件事要说：**停住态**（坏文件连备份都失败）—— 那时谁都不许写盘。
 *    ⚠️ 代价（认）：`recovered`（已备份并重建）这件事这一层看不到 —— 它由
 *    `initFileUpdates` 弹框说过一次了（探针的 case a 量到的就是那一次）。
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
  /*
   * ★ 两个拆出去的模块的注入点（Task 6）：它们与这一份**单向**依赖（见各自文件头），
   *   所以"基址 / user-agent / 说明往哪走"只能这样接上。
   * ⚠️ 顺序：**必须在下面 `startUp()` 之前** —— 那一趟要抓目录、要扫盘，
   *    而没接上的话 `queueLoadCatalog` 会抛"模块还没初始化"（不会静默地抓一个错地址）。
   * ⚠️ `pushNotice` 是**引用**传过去的，不是值：它在被调用时才读 `notices`。
   */
  initCatalog({ siteOrigin, userAgent: deps.userAgent, notice: pushNotice });
  initScan(pushNotice);

  /*
   * 停住态：`stateFileBlocked()` 非空 ⇒ v1 那边"读不出来且备份也失败"，它已经弹过框、
   * 并且会拒绝所有写入。这里再记一条（页面看得见）并弹一次框：
   * 这一栏在用户手动处理那个文件之前是不可用的，不说出来他就只会看到"点了没反应"。
   */
  const blocked = stateFileBlocked();
  if (blocked !== null) {
    console.error('[mod-folders] 状态文件停用：', blocked);
    pushNotice(`状态文件读不出来，而且备份也失败了 ⇒ 这一栏不再写盘：${blocked}`);
    notify('mod 文件夹的状态文件读不出来，而且备份失败', blocked);
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
 *    关着开关的文件夹在启动时**不扫** ⇒ 它的行是空的，必须补一条 notice 说明为什么；
 *    而页面真正要这份数据时（第一次 `getState`）会由 `ensureScans()` 补扫（Ruling 34）。
 *    ⚠️ 那条 notice 的措辞必须与这个分工一致：**不是**"你再也看不到它"，
 *    而是"启动这一趟没扫它，页面拉状态时会补扫"。
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
  /*
   * ★★ D1（T4）：**先枚举实例、再扫**。`folders` 是从"被追踪的实例"派生的，而这一趟
   *    只扫 `autoUpdate === true` 的条目 ⇒ 顺序反了的话，升级之后第一次启动扫的是**盘上
   *    旧的那一份** `folders`，而派生出来的那些要等页面拉状态才补扫（A10 要的正是"照旧"）。
   * ⚠️ `refreshInstances()` 内部会 `rebuild()` ⇒ 对账（派生 + 回收 + 落盘）已经在这一句里
   *    发生过了，所以下面那个循环读到的是**刚对完账**的那一份。
   */
  await refreshInstances();
  const st = requireState();
  for (const [folderId, entry] of sortedFolders(st)) {
    if (entry.autoUpdate) {
      await queueScan(folderId, entry.path, { onlyIfMissing: true });
    } else {
      pushNotice(
        `这个文件夹没开自动更新（${basename(entry.path)}）：启动这一趟不扫它（页面第一次要状态时会补扫一次）`,
      );
    }
  }
  adoptFolderGameVersion();
  rebuild();
}
