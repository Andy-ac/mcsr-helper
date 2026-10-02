/**
 * mod 目录行 + mod 文件夹 —— **纯逻辑那一半**（契约与判定，不碰 fs、不碰 IPC）。
 *
 * ===========================================================================
 * 一、入参纪律：`Channel` 是**镜像 id**，永远不是 URL
 * ===========================================================================
 * 渲染进程能提供的只有一个**通道**：`'origin'` 或 `{ mirrorId }`。
 * 地址由主进程用目录里的 `mirrors[]` 拼（`channelUrl` ⇒ `mirrorUrl`）——
 * 查不到那条镜像、或该 release 的主机不在这条镜像的 `hosts` 里，一律给 `null`，
 * 调用方**拒绝这次更新**。理由：`prefix` 是唯一由目录（配置即代码）决定的信任锚；
 * 让页面提供地址，等于把"下载到哪里"交给一个可能被注入的渲染进程。
 *
 * ===========================================================================
 * 二、这一半为什么住在 `packages/shared` 而不是 `apps/desktop`
 * ===========================================================================
 * 这些函数是"决定要不要动用户磁盘上的文件"的那一半，而 `apps/desktop`
 * **没有测试运行器**（现读 `apps/desktop/package.json` 的 `scripts`：只有
 * `dev` / `build` / `dist` / `typecheck`，没有 `test`）。留在那边就只能靠
 * `.cache/` 里那些 gitignore 的探针验，而探针不是门禁。
 * 住在 shared ⇒ `services/api` 的测试运行器够得着它（`services/api` 引的
 * `@mcsr/shared` 是**源码**），判定层的每一条规则都能有能红的断言钉着。
 * 同一份理由写在 `packages/shared/src/fileUpdates.ts` 的 `compareLocalVersions` 上。
 *
 * ===========================================================================
 * 三、`catalogBindings` 与 v1 的 `items` 为什么是两个命名空间
 * ===========================================================================
 * 两者的**键空间不同**：v1 的 `items` 按"一个 mod × 一个来源（Modrinth）× 一个游戏版本"
 * 的条目 id 键控（它是那个目录的形状），这一期的 `catalogBindings` 按**目录行 id**
 * `${modid}|${gameVersion}`（`releaseKey`）键控。混进同一个 map 里迟早会撞键 ——
 * 而撞键的表现是"某一行的本地文件指向了另一个 mod"，那是一种会写坏用户目录的坏法。
 * ⇒ 分成两个 map，且 **v1 的 `items` 只被原样保留、不被本模块重写或剪枝**
 *   （老客户端仍在读它；`migrateState` 的注释里写着这条纪律）。
 *
 * ---------------------------------------------------------------------------
 * 边界（写下来，免得下一个人以为它管得比实际宽）
 * ---------------------------------------------------------------------------
 * · **本文件不做任何 I/O**：路径是否存在、jar 内部读到了什么、状态文件写不写得下去，
 *   都是调用方（主进程）的读数，以参数传进来；
 * · 判定层的规则**一条都不在这里重写**：`judgeRelease` / `needsUpdate` /
 *   `compareLocalVersions` 全部来自 Plan 1 的 `modCatalog.ts` / `fileUpdates.ts`。
 *   在这里重写一次，就等于让"要不要自动替换用户文件"这件事有两个会漂的版本。
 */

import { compareLocalVersions } from './fileUpdates';
import type { ModCatalog, ModEntry, ModRelease, ReleaseVerdict } from './modCatalog';
import {
  buildIndex,
  judgeRelease,
  mirrorsFor,
  mirrorUrl,
  modFor,
  modTagsOf,
  needsUpdate,
  releaseKey,
  releasesFor,
  rowsForGameVersion,
  tagLabelOf,
} from './modCatalog';

// ---------------------------------------------------------------------------
// 通道
// ---------------------------------------------------------------------------

/**
 * 下载通道。**是 id，不是 URL**（理由见文件头第一节）。
 *
 * `'origin'` = release 自己的地址；`{ mirrorId }` = 目录 `mirrors[]` 里某一条的 `id`。
 */
export type Channel = 'origin' | { mirrorId: string };

/**
 * 这次更新从哪个地址取字节。`null` = **这次请求不成立**（调用方必须拒绝，不许退回原地址顶上）。
 *
 * ⚠️ 判据分两层，缺一不可：
 *   ① 这条镜像 **id 在 `mirrors[]` 里**（渲染进程说了个不存在的 id ⇒ `null`）；
 *   ② 这个 release 的**主机在这条镜像的 `hosts` 里**（`cdn.modrinth.com` 那种非 GitHub
 *      来源不给镜像，D5）。
 *   ②这一层走 `mirrorsFor`（它自己做 URL 解析、失败给空数组），**不在这里重写主机匹配** ——
 *   主机那一层的判据只留一份。
 * ⚠️ `mirrorUrl` 本身只是 `prefix + url` 直拼、**不含任何检查**：它必须被本函数的
 *   两层判据包住才能用（把它当成"会拒绝坏输入"的函数是错的）。
 */
export function channelUrl(
  catalog: ModCatalog,
  release: ModRelease,
  channel: Channel,
): string | null {
  if (channel === 'origin') return release.url;
  const mirror = mirrorsFor(catalog, release.url).find((entry) => entry.id === channel.mirrorId);
  if (!mirror) return null;
  return mirrorUrl(mirror, release.url);
}

// ---------------------------------------------------------------------------
// 标签显示名
// ---------------------------------------------------------------------------

/**
 * 标签 key ⇒ 显示名。查不到显示名时**退化成 key 本身**（spec §15：目录坏了要看得见，
 * 不许悄悄换个说法把缺陷盖掉）。
 *
 * ⚠️ 语言取目录里的 `zh`：这一层没有 locale 参数（契约是纯函数、由主进程按机器状态调用），
 *    而目录的两种语言都由 `tagLabels` 提供 ⇒ 需要英文的消费者自己拿
 *    `tagLabelOf(catalog, tag)?.en`，**不要**在这里加第二份映射表（两份必然漂）。
 * ⚠️ 返回值与 `tags` **逐位对应**（`tagLabels[i]` 是 `tags[i]` 的显示名）：
 *    消费方按序号取用，所以这里不许排序、不许去重、不许过滤。
 */
function tagLabelsOf(catalog: ModCatalog, tags: readonly string[]): readonly string[] {
  return tags.map((tag) => tagLabelOf(catalog, tag)?.zh ?? tag);
}

// ---------------------------------------------------------------------------
// 第一部分：目录行
// ---------------------------------------------------------------------------

/** 主进程扫一遍文件夹得到的一条读数（`modid` / `version` 读不出来就是 `null`）。 */
export interface FolderScanEntry {
  fileName: string;
  modid: string | null;
  version: string | null;
  sha512: string | null;
}

/** 目录里一行（一个 `modid` × 一个游戏版本）。 */
export interface CatalogRowView {
  /** `${modid}|${gameVersion}`（`releaseKey`）。 */
  rowId: string;
  modid: string;
  name: string;
  gameVersion: string;
  tags: readonly string[];
  /** 显示名；目录里没有这个标签的名字时是 key 本身。 */
  tagLabels: readonly string[];
  /** 该 `(modid, gameVersion)` 下的全部候选（0 / 1 / 2+ 条，顺序继承目录）。 */
  candidates: readonly ModRelease[];
  /** 唯一候选才有值；0 个（`missing-release`）或 >1 个（`ambiguous`）都是 `null`。 */
  official: ModRelease | null;
  verdict: ReleaseVerdict;
  /** 全部候选都是 `download: 'manual'` ⇒ 只给"打开原网页"，**连更新按钮都不给**。 */
  manual: boolean;
  /** `needsUpdate` 的结果（含 `download === 'auto'` 与排序守卫）+ "必须有唯一候选"。 */
  batchable: boolean;
  /** 这一行绑定的本地文件（没有绑定时 `null`）。 */
  binding: { localPath: string; localVersion: string | null } | null;
}

export interface PlanCatalogRowsInput {
  catalog: ModCatalog;
  gameVersion: string;
  /** 标签筛选，**"与"语义**：留下的行必须同时带全部所选标签。 */
  tagFilter: readonly string[];
  /** 键 = `rowId`（`${modid}|${gameVersion}`）。 */
  bindings: ReadonlyMap<
    string,
    { localPath: string; localVersion: string | null; localSha512: string | null }
  >;
}

/**
 * 目录行的判定。**一条都不在这里重新推导**（见文件头第二节）。
 *
 * ⚠️ 索引每次调用重建：`buildIndex` 的展开是 O(release × 游戏版本)（真目录实测
 *    555 条 release ⇒ 1761 个键），而这是个纯函数、拿不到主进程那份长活的索引。
 *    代价（页面启动时多一次内存计算）写在 spec §15 里；要省这一步就得把索引当参数传，
 *    那会让契约多一个"调用方必须先建索引"的隐藏前提。
 */
export function planCatalogRows(input: PlanCatalogRowsInput): CatalogRowView[] {
  const { catalog, gameVersion, tagFilter, bindings } = input;
  const index = buildIndex(catalog);
  const rows: CatalogRowView[] = [];

  for (const { mod, releases } of rowsForGameVersion(index, gameVersion)) {
    const tags = modTagsOf(mod);
    if (!tagFilter.every((tag) => tags.includes(tag))) continue;

    const rowId = releaseKey(mod.modid, gameVersion);
    const binding = bindings.get(rowId) ?? null;
    const verdict = judgeRelease(
      binding?.localSha512 ?? null,
      binding?.localVersion ?? null,
      releases,
    );
    const only = releases.length === 1 ? releases[0]! : null;

    rows.push({
      rowId,
      modid: mod.modid,
      name: mod.name,
      gameVersion,
      tags,
      tagLabels: tagLabelsOf(catalog, tags),
      candidates: releases,
      official: only,
      verdict,
      /*
       * 空集合的 `every` 恒真 ⇒ `length > 0` 不是多余的：少了它，一条
       * `missing-release` 的行会被标成 `manual`（界面上等于给出一个"打开原网页"、
       * 但那个网页不存在）。`rowsForGameVersion` 今天只交出非空候选，
       * 所以这一条是**防御性**的 —— 把契约定在这里看得见。
       */
      manual: releases.length > 0 && releases.every((release) => release.download === 'manual'),
      /*
       * ★ 进批量的唯一组合收在 `needsUpdate` 里（`older` 且 `download === 'auto'`，
       *   且**两边版本主体都能安全排序**）。这里只补一个前提：**必须有唯一候选** ——
       *   `ambiguous` 不知道"该更新成哪一个"，`missing-release` 没有目标。
       */
      batchable: only !== null && needsUpdate(verdict),
      binding: binding
        ? { localPath: binding.localPath, localVersion: binding.localVersion }
        : null,
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// 第二部分：文件夹
// ---------------------------------------------------------------------------

/**
 * 文件夹行的状态 = 目录行的状态 **加上**"游戏版本未知"。
 *
 * ⚠️ 为什么另起一个类型、而不往 `ReleaseVerdict` 里加一个分支：`ReleaseVerdict` 是
 *    Plan 1 已发布的共用契约（服务端与桌面端都在用），而 `unknown-version` 只在
 *    "文件夹的 `mmc-pack.json` 读不出来"时出现（spec §8 那张表）—— 它是**文件夹**
 *    这一侧的边界，不是"本地版本 vs 官方 release"的判定结果。往共用的联合里加分支，
 *    会让每一个 `ReleaseVerdict` 的消费者凭空多一个必须处理的分支。
 */
export type FolderVerdict = ReleaseVerdict | { kind: 'unknown-version' };

/** 文件夹里一行（一个 modid 一组 jar）。 */
export interface ModFolderRowView {
  modid: string;
  name: string;
  /** 主文件：同名多份里**最新**的那一份（判定与更新都以它为目标）。 */
  fileName: string;
  localVersion: string | null;
  localSha512: string | null;
  /** 该 modid 的其余副本（D9.1 会清掉）。 */
  oldCopies: readonly string[];
  candidates: readonly ModRelease[];
  official: ModRelease | null;
  verdict: FolderVerdict;
  manual: boolean;
  batchable: boolean;
}

/** 扫到但**不参与更新**的条目（只显示）。 */
export interface FolderUnrecognizedRow {
  fileName: string;
  reason: 'no-fabric-meta' | 'not-in-catalog';
}

/** 一个已绑定文件夹的视图。 */
export interface ModFolderView {
  folderId: string;
  path: string;
  pathExists: boolean;
  /** `null` = 未知（该文件夹所有行都是 `unknown-version`，不给更新按钮）。 */
  gameVersion: string | null;
  autoUpdate: boolean;
  rows: readonly ModFolderRowView[];
  unrecognized: readonly FolderUnrecognizedRow[];
}

export interface PlanFolderViewInput {
  catalog: ModCatalog;
  folderId: string;
  path: string;
  pathExists: boolean;
  gameVersion: string | null;
  autoUpdate: boolean;
  scan: readonly FolderScanEntry[];
}

/**
 * 同一个 modid 有多份副本时，`next` 算不算比 `best` 更新。
 *
 * ⚠️ 读不出内部版本的那一份**永远排在后面**（`null` 不是"版本 0"）。
 *    两份都读得出版本时才用 `compareLocalVersions`（v1 那一个，按数字段逐段比，
 *    返回正数 = 第一个参数更新）。**不另写比较器**：这个函数的结果决定"拿哪一份当
 *    更新目标"，写成第二份实现就等于让这个决定有两个会漂的版本。
 * ⚠️ 并列时保留**先扫到的那一份**（`>` 不是 `>=`）⇒ 结果只由扫描顺序决定，可复现。
 */
function isNewerLocal(next: FolderScanEntry, best: FolderScanEntry): boolean {
  if (next.version === null) return false;
  if (best.version === null) return true;
  return compareLocalVersions(next.version, best.version) > 0;
}

/**
 * 文件夹行的判定。**不做 I/O**：路径在不在、扫到了什么，都是调用方的读数。
 *
 * 三条边界（每条都有断言钉着，见 `services/api/src/mod-folders-shared.test.ts`）：
 *   · `pathExists === false` ⇒ **行与"无法识别"都不给**，但视图照常返回（绑定保留，
 *     界面显示"路径不存在"，仍可解绑）。⚠️ 这一条**不能**靠"扫到的条目为空"来实现：
 *     调用方手上可能是一份过期的扫描结果，而"目录已经不在了却还列着文件"会让用户
 *     对着一个不存在的路径点更新。测试就是拿**非空** `scan` 钉住这一条的。
 *   · `gameVersion === null` ⇒ 每行 `unknown-version` 且 `batchable = false`（spec §8）。
 *   · 只认 jar 内部的 `modid`：读不出来 ⇒ `no-fabric-meta`；目录 `mods[]` 里没有 ⇒
 *     `not-in-catalog`（两者都只显示、不参与更新）。
 */
export function planFolderView(input: PlanFolderViewInput): ModFolderView {
  const { catalog, folderId, path, pathExists, gameVersion, autoUpdate, scan } = input;
  const base = { folderId, path, pathExists, gameVersion, autoUpdate };

  // 路径不存在 ⇒ 一条扫描读数都不作数（理由见上面第一条边界）。
  if (!pathExists) return { ...base, rows: [], unrecognized: [] };

  const index = buildIndex(catalog);
  const groups = new Map<string, { mod: ModEntry; files: FolderScanEntry[] }>();
  const unrecognized: FolderUnrecognizedRow[] = [];

  // 一趟扫完，`unrecognized` 因此**保持扫描顺序**（界面按目录里看到的次序列出来）。
  for (const entry of scan) {
    if (entry.modid === null) {
      unrecognized.push({ fileName: entry.fileName, reason: 'no-fabric-meta' });
      continue;
    }
    /*
     * "清单外"的判据是 `mods[]` 里**有没有这个 modid**，不是"这一版有没有 release"：
     * 后者是 `missing-release`（"这个游戏版本下清单里没有它"，spec §8 的另一种情形）。
     * 今天这两个判据在本仓那份目录上是**同一件事**（实测：`mods[]` 70 条，
     * release 覆盖的 modid 也是 70 个，没有"在 mods 里但一条 release 都没有"的条目），
     * 而用 `mods[]` 这一侧还额外保证下面拿得到 `mod.name`。
     */
    const mod = modFor(index, entry.modid);
    if (mod === null) {
      unrecognized.push({ fileName: entry.fileName, reason: 'not-in-catalog' });
      continue;
    }
    const group = groups.get(entry.modid);
    if (group) group.files.push(entry);
    else groups.set(entry.modid, { mod, files: [entry] });
  }

  const rows: ModFolderRowView[] = [];
  for (const [modid, { mod, files }] of groups) {
    // 主文件 = 最新的那一份；其余**按扫描顺序**进旧副本（D9.1 会照着这份清单删）。
    let main = files[0]!;
    for (const entry of files) {
      if (isNewerLocal(entry, main)) main = entry;
    }
    const oldCopies = files.filter((entry) => entry !== main).map((entry) => entry.fileName);

    const candidates = gameVersion === null ? [] : releasesFor(index, modid, gameVersion);
    const verdict: FolderVerdict =
      gameVersion === null
        ? { kind: 'unknown-version' }
        : judgeRelease(main.sha512, main.version, candidates);
    const only = candidates.length === 1 ? candidates[0]! : null;

    rows.push({
      modid,
      name: mod.name,
      fileName: main.fileName,
      localVersion: main.version,
      localSha512: main.sha512,
      oldCopies,
      candidates,
      official: only,
      verdict,
      // 与目录行同一条判据（空集合的 `every` 恒真 ⇒ `length > 0` 是判据的一部分）。
      manual: candidates.length > 0 && candidates.every((release) => release.download === 'manual'),
      /*
       * ★ 未知版本**不给更新按钮**，所以这里显式短路，而不是等着 `needsUpdate`
       *   对一个它不认识的 kind 返回 false —— 那个"恰好也是 false"的依赖
       *   下一个人改动 `needsUpdate` 时就会静默失效。
       */
      batchable: verdict.kind !== 'unknown-version' && only !== null && needsUpdate(verdict),
    });
  }

  return { ...base, rows, unrecognized };
}

// ---------------------------------------------------------------------------
// 底部：缺失清单
// ---------------------------------------------------------------------------

export interface MissingModView {
  modid: string;
  name: string;
  gameVersion: string;
  tags: readonly string[];
  tagLabels: readonly string[];
}

export interface MissingModsInput {
  catalog: ModCatalog;
  gameVersion: string;
  /** 已绑定文件夹里**命中过**的 modid（主进程扫完文件夹才知道，因此是入参）。 */
  trackedModids: ReadonlySet<string>;
}

/**
 * 该游戏版本下"清单里有、但一个已绑定文件夹里都没有"的 mod。
 *
 * ⚠️ 多候选（`ambiguous`）与没有 release 的行**都不出现**：那一栏每行要驱动一次下载，
 *    而"该装哪一个"没有唯一答案时，程序不许替用户猜（spec §7.5）。
 */
export function missingMods(input: MissingModsInput): MissingModView[] {
  const { catalog, gameVersion, trackedModids } = input;
  const index = buildIndex(catalog);
  const out: MissingModView[] = [];

  for (const { mod, releases } of rowsForGameVersion(index, gameVersion)) {
    if (releases.length !== 1) continue;
    if (trackedModids.has(mod.modid)) continue;
    const tags = modTagsOf(mod);
    out.push({
      modid: mod.modid,
      name: mod.name,
      gameVersion,
      tags,
      tagLabels: tagLabelsOf(catalog, tags),
    });
  }

  return out;
}

/**
 * 这些行里有几条会进批量（"全部更新"按钮上的数字）。
 *
 * ⚠️ 只接受 `{ batchable }` 这一个字段：目录行与文件夹行都能用，而"什么算能批量"
 *    的判据只住在 `needsUpdate` 里（这里**不**再看 verdict / download）。
 */
export function batchTargets(rows: readonly { batchable: boolean }[]): number {
  return rows.reduce((count, row) => (row.batchable ? count + 1 : count), 0);
}

// ---------------------------------------------------------------------------
// 状态文件 v2
// ---------------------------------------------------------------------------

/** 界面状态（渲染进程拿到的全部东西）。 */
export interface ModFoldersState {
  catalogStatus: 'ok' | 'unavailable' | 'invalid';
  /** 界面当前选中的游戏版本（默认 = 某个已绑定文件夹推断出的版本，否则 `1.16.1`）。 */
  gameVersion: string;
  tagFilter: readonly string[];
  catalogRows: readonly CatalogRowView[];
  folders: readonly ModFolderView[];
  missing: readonly MissingModView[];
  /** 例：迁移时"已转为文件夹跟踪：<mod 名>"、"这条绑定读不出来，保留原样"。 */
  notices: readonly string[];
  busy: boolean;
  lastRun: {
    updated: readonly string[];
    skipped: readonly { modid: string; reason: string }[];
    failed: readonly { modid: string; reason: string }[];
  } | null;
}

/** v1 状态文件里的一条绑定，喂给 `attributeLegacyBindings`（由主进程读盘后组装）。 */
export interface LegacyBinding {
  key: string;
  localPath: string;
  modid: string | null;
  /** 这条绑定落在哪个**已绑定文件夹**里（不在任何文件夹里就是 `null`）。 */
  insideFolderId: string | null;
}

/**
 * 状态文件 v2。
 *
 * ⚠️★ `version: 1` 与 `stateVersion: 2` **同时存在**，而且必须一直同时存在：
 *    `version` 是老客户端（0.0.4）读的那个字段，`stateVersion` 是这一期新增的。
 *    把 `version` 改成 2 会让老客户端把整份状态判成"版本不认识"（它的三态读可能
 *    因此**拒绝覆盖**，用户就看到"状态文件坏了"）。⇒ 加字段，不改老字段。
 * ⚠️ `items` 是 v1 的**原样保留**：本模块从不重写、剪枝或迁移它。
 *    它与 `catalogBindings` 为什么是两个命名空间，见文件头第三节。
 */
export interface StateFileV2 {
  version: 1;
  stateVersion: 2;
  items: Record<string, unknown>;
  catalogBindings: Record<
    string,
    {
      localPath: string;
      localVersion: string | null;
      localSha512: string | null;
      releaseKey: string | null;
      autoUpdate: boolean;
    }
  >;
  folders: Record<
    string,
    { path: string; gameVersion: string | null; autoUpdate: boolean; boundAt: number }
  >;
  prefs: { bulkChannel: Channel; catalogGameVersion: string; tagFilter: readonly string[] };
}

/** 是不是一个"普通对象"（`null` / 数组 / 标量都不是）。坏输入不抛，所以到处要用它。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 把盘上读到的东西迁移成 v2。**纯函数、不抛、不写盘**。
 *
 * 判据（三条，方向都是"不丢数据"）：
 *   ① `stateVersion === 2` ⇒ **原样返回**（幂等：再跑一次逐字段相同）。
 *      不重建的理由：将来往 v2 里加字段时，重建会把新字段**静默剥掉**；
 *      代价是一个被**截断**的 v2 不会在这里被补全 —— 那是调用方那份三态读的活
 *      （v1 的 `fatal` ⇒ 绝不覆盖）。
 *   ② 否则（v1、或任何读不出来的输入）⇒ 造一份干净的 v2：`items` **只在它真的是个
 *      对象时**保留，其余字段给默认值。**不做删除式迁移** —— 读不出来不等于可以丢。
 *   ③ 任何输入都不抛：调用方拿到的一定是一份"写下去也安全"的状态，由它决定要不要覆盖。
 *      （读不出来的输入**不在这里报错**：怎么报是主进程的事，它手里才有路径与三态读。）
 */
export function migrateState(raw: unknown): StateFileV2 {
  const record = isRecord(raw) ? raw : null;

  if (record?.stateVersion === 2) return raw as StateFileV2;

  return {
    version: 1,
    stateVersion: 2,
    items: isRecord(record?.items) ? record.items : {},
    catalogBindings: {},
    folders: {},
    prefs: { bulkChannel: 'origin', catalogGameVersion: '1.16.1', tagFilter: [] },
  };
}

/**
 * v1 的单文件绑定往哪去（**纯函数，没有 I/O**）。
 *
 * 三种去向，**判据的顺序是有意的**：
 *   ① `insideFolderId !== null` ⇒ `drop`（§13.1 只按路径判）：这条绑定的文件已经
 *      落在某个已绑定文件夹里了，留着它就等于同一个文件有两条绑定 —— 一条动、一条不动。
 *      ⚠️ 这一条**排在 modid 之前**：读不出 modid 但落在文件夹里的绑定同样要丢。
 *   ② `modid === null` ⇒ `keepUnknown`（读不出来的**保留原样**：丢掉它就等于替用户
 *      做了一个"这条不要了"的决定，而它可能正是唯一记得那个文件在哪儿的记录）。
 *   ③ 其余 ⇒ `adopt`，行 id = `releaseKey(modid, selectedGameVersion)`。
 *
 * ⚠️ "读不出来"由调用方在 `LegacyBinding` 里表达（`modid: null` / `insideFolderId: null`），
 *    本函数**不读盘、不 stat**：同一条输入永远给同一个结果。
 */
export function attributeLegacyBindings(input: {
  legacy: readonly LegacyBinding[];
  selectedGameVersion: string;
}): { adopt: { key: string; rowId: string }[]; drop: string[]; keepUnknown: string[] } {
  const adopt: { key: string; rowId: string }[] = [];
  const drop: string[] = [];
  const keepUnknown: string[] = [];

  for (const binding of input.legacy) {
    if (binding.insideFolderId !== null) {
      drop.push(binding.key);
      continue;
    }
    if (binding.modid === null) {
      keepUnknown.push(binding.key);
      continue;
    }
    adopt.push({
      key: binding.key,
      rowId: releaseKey(binding.modid, input.selectedGameVersion),
    });
  }

  return { adopt, drop, keepUnknown };
}
