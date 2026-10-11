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

import type { DownloadProgress } from './downloadProgress';
import { compareLocalVersions } from './fileUpdates';
import { applyOverride, type LauncherInstance, type LauncherKind } from './launcherInstances';
import type {
  ModCatalog,
  ModEntry,
  ModMirror,
  ModRelease,
  ModTagLabel,
  ReleaseVerdict,
} from './modCatalog';
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
// 候选 → 目标（spec §7.2 的那一步）：**两个 planner 共用这一份**
// ---------------------------------------------------------------------------

/**
 * 目标是从哪来的（spec §4 D1）：legal mod 走 mc.sr **指定**的版本 ⇒ `'catalog'`；
 * 上游活跃的（`mcsrranked`）走**上游最新** ⇒ `'upstream'`。
 *
 * ⚠️ 这个字段存在的唯一理由是"**让界面不必猜**"：有上游目标时 `official` **不在
 *    `candidates` 里**，消费方若靠"`official` 是不是 `candidates` 的某一个 / 版本号谁大"
 *    去推断来源，那就是一份**靠推断维系的契约** —— 目录与上游恰好给出同一个版本号时
 *    （实测完全可能：上游那条也发在同一个版本号上）就分不出来了。
 */
export type TargetSource = 'catalog' | 'upstream';

/**
 * 候选 → **目标**（判定用的那一条，也是界面"官方版本"那一格）。
 *
 * ① 唯一候选 + 上游命中 ⇒ 用上游那条（`'upstream'`）—— spec §7.2 / D1；
 * ② 唯一候选、没有上游 ⇒ 用它（`'catalog'`）；
 * ③ 0 条（`missing-release`）或 >1 条（`ambiguous`）⇒ **没有目标**（`targetSource` 仍是
 *    `'catalog'`：没有任何东西来自上游）。上游在这两种情形下一律不用，理由写在下面函数体里。
 *
 * ⚠️ 目录行与文件夹行**必须共用这一份**：第二部分的候选与第一部分来自同一个
 *    `(modid, 游戏版本)`，各写一遍的话"同一个 mod、同一个版本、两处说法不一致"
 *    只是时间问题（Ruling 14 的现场就是这么来的）。
 *
 * ★★ 2026-10-07（用户报的 bug 的修复）：**导出**给 `modPacks.ts` 共用。
 *    现场：整包下载把 `mcsrranked` 装成目录那条 **5.8.22**，而同一行的「下载到 ▾」装上游 **5.8.26** ✗ ——
 *    因为整合包那条路（`packPlanFor`）**没有上游这一格**、直接取了 `candidates[0]`。
 *    修法**不是**在 `modPacks.ts` 里再写一遍"唯一候选就用上游"（那就是第二份判定，
 *    正是上面那句说的病根）⇒ 而是把**这同一个**函数导出去共用。
 *    ⚠️ 它仍然只做判定、不做 I/O：上游那张表由调用方抓来传进来（主进程 `upstreamLatestOf()`）。
 */
export function resolveTarget(
  candidates: readonly ModRelease[],
  upstream: ModRelease | null,
): { target: ModRelease | null; targetSource: TargetSource } {
  /*
   * ★ 上游**只在目录在这一版下唯一一条候选时**才参与（Ruling 17；spec §7.2 的伪码把
   *   `mod.upstream != null` **缩进在** `候选.length == 1` 之下）。
   *   不门控的后果是实的：
   *     · 0 条（`missing-release`）+ 上游 ⇒ 会变成 `older` + `batchable true`，与
   *       spec §8"这个游戏版本下清单里没有它"冲突 —— 那就是"清单里没有、却给你更新按钮"；
   *     · 多候选（`ambiguous`）+ 上游 ⇒ `ambiguous` 变得**不可达**，而 §8 要求多候选必须
   *       "列出全部候选、要求用户明确选"：自动替用户选一个正是这一期一直在拒绝的事。
   *   代价（认）：将来若某个 mod 在 mc.sr 这一版 0 条而上游有，这一次**不更新它** ——
   *   方向是保守的那一侧。
   */
  if (candidates.length !== 1) return { target: null, targetSource: 'catalog' };
  if (upstream !== null) return { target: upstream, targetSource: 'upstream' };
  return { target: candidates[0]!, targetSource: 'catalog' };
}

/**
 * 这一行"只给打开原网页、连更新按钮都不给"吗（`manual`）。
 *
 * 判据与**目标**一致：有目标 ⇒ 看目标那一条的 `download`；没有目标（`missing-release` /
 * `ambiguous`）⇒ 候选**全都**是 `manual` 才算（`optifine|1.7.2` 那一对：两个候选都 manual，
 * 界面只能给"打开原网页"）。
 *
 * ⚠️ 两个 planner **共用这一份**（Ruling 16）：第一部分跟目标、第二部分跟候选的话，
 *    上游那条是 `manual` 时两处会给出互相矛盾的话（一处"不给按钮"、一处"给按钮"）——
 *    那正是 Ruling 14 要消灭的"同一个 mod 两处不一致"，只是换了个字段。
 * ⚠️ `length > 0` 不是多余的：空集合的 `every` 恒真，少了它一条 `missing-release` 的行
 *    会被标成 `manual`（等于给出一个"打开原网页"、但那个网页不存在）。
 */
function isManualTarget(candidates: readonly ModRelease[], target: ModRelease | null): boolean {
  if (target !== null) return target.download === 'manual';
  return candidates.length > 0 && candidates.every((release) => release.download === 'manual');
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
  /**
   * 目录里这个 mod 的 `homepage`（`ModEntry.homepage`）；目录没写就是 `null`。
   *
   * ⚠️★ 它为什么必须在这里（2026-10-04 Task 1 的现场）：新投影 `VersionModRow.homepage`
   *    的语义是"**目录里的** `mod.homepage`"（spec §5.1），而 `ModFoldersState` **不带
   *    整份目录**（只有 `catalogRows` / `folders` / `tags` / `mirrors` …）⇒ 这一格不在
   *    行视图里，渲染进程就**没有任何地方**读得到它：页面只能把那一条画成空，或者去猜。
   * ★★ **必填**（2026-10-04 A 的 T4 落实 T1 评审的待办）：源头 `ModEntry.homepage` 是
   *    `z.string().optional()`，而唯一的生产者 `planCatalogRows` 一定会填它
   *    （`mod.homepage ?? null`；实测目录里 70/70 都有）⇒ "这个 mod 没有主页"在这一层
   *    只有**一个**表示：`null`。
   *    ⚠️ 改必填前的代价（T1 评审记的那条）是"夹具忘了写这一格 ⇒ 读出来是 `null`，
   *    与'目录里没有'分不开"，而那个方向的退化只少一条链接、不影响任何判定 ⇒
   *    当时判"保持可选"。
   *    ⚠️★ 改必填之后的**收益边界**（2026-10-04 T4 判修轮，实测）：它是
   *    **类型层**的必填 —— `apps/web/src/**` 与任何被 tsconfig 收进去的消费者漏了这一格
   *    都会当场编译失败（一次性 `tsc` 探针：`TS2741: Property 'homepage' is missing …
   *    but required`）。⚠️ **但手搓 `CatalogRowView` 字面量的那个渲染自检不算在内**：
   *    `apps/web/scripts/**` **不在任何 tsconfig 的 `include` 里**（`tsc` 不看它、
   *    `tsx` 只剥类型不做检查）⇒ 那个文件里"忘了写"**不是编译错**（实测：往它里面插
   *    一句 `const x: number = 'not-a-number';`，`typecheck` 与那个脚本双双照样绿）。
   *    ⇒ 那一侧的守卫是**运行期**的夹具自钉（`foldersrender.tsx` ㊱ 开头那句
   *    `assert.ok(ROW_GITHUB.homepage, …)`），不是编译器。
   */
  homepage: string | null;
  /** 该 `(modid, gameVersion)` 下的全部候选（0 / 1 / 2+ 条，顺序继承目录）。 */
  candidates: readonly ModRelease[];
  /**
   * 这一行的**目标**（界面上"官方版本"那一格、也是判定用的那一条）。
   *
   * ⚠️★ 有上游目标时它**不在 `candidates` 里**（`candidates` 始终只来自目录），
   *    而且 `verdict.release` 这时**也不等于**任何一个 `candidates` 元素 —— 判定跟着
   *    目标走（Ruling 11）。来源由 `targetSource` 说出来，**消费方不要自己推断**。
   * 0 个（`missing-release`）或 >1 个（`ambiguous`）、而该 modid 又没有上游时是 `null`。
   */
  official: ModRelease | null;
  /** `official` 是从哪来的（指定版本 / 上游最新）—— 见 `resolveTarget`。 */
  targetSource: TargetSource;
  /** 拿**目标**（不是候选集合）判出来的状态。 */
  verdict: ReleaseVerdict;
  /** 目标是 `download: 'manual'` ⇒ 只给"打开原网页"，**连更新按钮都不给**。 */
  manual: boolean;
  /**
   * `needsUpdate(verdict)` 的结果（含 `download === 'auto'` 与排序守卫）+ "必须有目标"。
   *
   * ⚠️★ **2026-10-04（A 的 T6）之后它在目录行上恒为 `false`**：`older`（进批量的唯一
   *    入口）要求有一份**本地读数**，而目录行的本地绑定（`catalogBindings`）在 T6
   *    连同那三个通道一起删了 —— 目录行只剩"没有本地文件"这一种情形 ⇒ 判定恒为
   *    `unknown` / `ambiguous` / `missing-release`。
   *    ⇒ 这一格留着是**如实的读数**（"这一行不会进批量"），不是遗留的开关：它由 `verdict`
   *      派生，没有任何调用方能让它为真。进批量那条路今天只由文件夹行走
   *      （`planFolderView` 的 `batchable` + `batchTargets`）。
   */
  batchable: boolean;
}

export interface PlanCatalogRowsInput {
  catalog: ModCatalog;
  gameVersion: string;
  /**
   * 上游（Modrinth）解析出来的"最新"那一条，**键 = `modid`**。
   * 判据来源：spec §7.2 / D1 —— `mod.upstream != null` 时**目标换成上游解析的那条**
   * （这一期只有 `mcsrranked` → Modrinth）。
   *
   * 三条纪律：
   *   · **可选**：没传、或该 modid 不在表里 ⇒ 行为与本参数不存在时**逐字相同**
   *     （目标 = 目录里唯一那条候选）。⇒ 抓取失败只是退化成今天的行为，不是一条错误路径。
   *   · **由调用方去抓**：本文件不做 I/O（见文件头第二节），上游是 I/O ⇒ 读数由外面传进来。
   *   · **只改目标，不动 `candidates`** —— 界面要能显示"这条来自目录 / 这条来自上游"。
   *
   * ⚠️ 现读 `content/mod-catalog.json` 的读数：只有 `mcsrranked` 一条 mod 有 `upstream`
   *    （`modrinth:I9W1u5Ac`）；它在 `(modid, 游戏版本)` 上只有 **1** 对
   *    （`mcsrranked|1.16.1`），**0** 对是多候选的，且它的 release **全是**
   *    `download: 'auto'` ⇒ 今天"传了上游"与"目录单候选"唯一的不同就是**目标那条 release**
   *    （目录 `5.8.22` / 上游 `5.8.26`）。
   */
  upstreamLatest?: ReadonlyMap<string, ModRelease>;
}

/*
 * ⚠️★ 2026-10-04（A 的 T6）：这一份入参**少了三格**，各自有各自的裁决 ——
 *   · `tagFilter`（删）：**D2 —— 标签只显示、不筛选**。它原来在这一层丢掉不匹配的行，
 *     而 T6 之后**没有任何界面**能改它（标签筛选器随第一部分一起下线）⇒ 一个陈旧的
 *     `prefs.tagFilter` 会**静默**把第三段「该版本**全部** mod」变成"全部减去被筛掉的那些"，
 *     而用户无处可清。修法是**结构性的**：这一层不再有筛选这一格 ⇒ 没有任何调用方
 *     能再让标签影响目录行（代价：`prefs.tagFilter` / `ModFoldersState.tagFilter` 仍在
 *     契约里 —— D2 明确不为删一个字段动契约 —— 但读到就只是"记住的值"）。
 *   · `bindings`（删）：它是 `catalogBindings` 在**目录行**上的投影来源（`CatalogRowView.binding`
 *     与"本地读数决定 verdict"）。那三个通道（`bindCatalogRow` / `unbindCatalogRow` /
 *     `updateCatalogRow`）在 T6 删了，状态里那份绑定也没人读写了（D8）⇒ 目录行**没有**
 *     本地读数可言：`verdict` 只剩 `unknown` / `ambiguous` / `missing-release` 三种。
 *     ⚠️ 文件夹行**不受影响**：它们的本地读数是"扫到这个目录里的 jar"（`planFolderView`
 *     的 `scan`），那条路一个字没动。
 *   · `catalogGameVersion` 那一类**从来就不在**这里：游戏版本是必填的 `gameVersion`。
 */

/**
 * 目录行的判定。**一条都不在这里重新推导**（见文件头第二节）。
 *
 * ⚠️ 索引每次调用重建：`buildIndex` 的展开是 O(release × 游戏版本)（真目录实测
 *    555 条 release ⇒ 1761 个键），而这是个纯函数、拿不到主进程那份长活的索引。
 *    代价（页面启动时多一次内存计算）写在 spec §15 里；要省这一步就得把索引当参数传，
 *    那会让契约多一个"调用方必须先建索引"的隐藏前提。
 */
export function planCatalogRows(input: PlanCatalogRowsInput): CatalogRowView[] {
  const { catalog, gameVersion, upstreamLatest } = input;
  const index = buildIndex(catalog);
  const rows: CatalogRowView[] = [];

  for (const { mod, releases } of rowsForGameVersion(index, gameVersion)) {
    const tags = modTagsOf(mod);

    const rowId = releaseKey(mod.modid, gameVersion);
    /*
     * ★ 目标 + 它的来源，**都交给共用的 `resolveTarget`**（规则只留一份）：
     *   ① 传了上游解析结果 ⇒ 上游那条；② 否则目录唯一那条候选；③ 否则 `null`。
     * ⚠️ 判定必须拿**目标**做，不能拿候选集合做：`ReleaseVerdict` 的单候选分支把
     *    被判的那条 release **装在自己身上**（`{ kind: 'older', release }`）⇒ 拿候选判、
     *    拿上游当"官方版本"，`verdict.release` 与 `official` 就会指向两条不同的 release，
     *    而界面两格都会显示 ⇒ 用户看到"官方 5.8.26、状态：比 5.8.22 旧"。
     */
    const { target, targetSource } = resolveTarget(
      releases,
      upstreamLatest?.get(mod.modid) ?? null,
    );
    /*
     * ⚠️★ 本地读数那两格恒为 `null`（T6）：目录行不再有本地绑定（见上面那一段入参注释）
     *    ⇒ 单候选行的判定是 `unknown`、多候选是 `ambiguous`、0 候选是 `missing-release`。
     *    ⚠️ 「同版本号、字节不同」那两支（`same` / `different-build`）在**目录行上不可达** ——
     *    它们都要一份本地字节读数。那是文件夹行才有的事（`planFolderView` 的 `scan`）。
     */
    const verdict = judgeRelease(null, null, target !== null ? [target] : releases);

    rows.push({
      rowId,
      modid: mod.modid,
      name: mod.name,
      homepage: mod.homepage ?? null,
      gameVersion,
      tags,
      tagLabels: tagLabelsOf(catalog, tags),
      candidates: releases,
      official: target,
      targetSource,
      verdict,
      /*
       * `manual`：有目标 ⇒ 看目标；没有目标 ⇒ 候选全都 manual 才算。
       * 与文件夹行**共用 `isManualTarget`**（Ruling 16）。
       */
      manual: isManualTarget(releases, target),
      /*
       * ★ 进批量的唯一组合收在 `needsUpdate` 里（`older` 且 `download === 'auto'`，
       *   且**两边版本主体都能安全排序**）。这里只补一个前提：**必须有目标** ——
       *   `ambiguous` 不知道"该更新成哪一个"，`missing-release` 没有目标。
       * ⚠️★ T6 之后目录行这一格**恒为 false**（没有本地读数 ⇒ 判不出 `older`）：
       *   见 `CatalogRowView.batchable` 上那一段。留着它是**如实的读数**，不是开关。
       */
      batchable: target !== null && needsUpdate(verdict),
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
  /** 目标（同目录行那一格）：`resolveTarget` 算出来的那一条。 */
  official: ModRelease | null;
  /**
   * `official` 是从哪来的。
   * ⚠️ 与目录行**同一套规则、同一个函数**（`resolveTarget`）—— 两处说法不一致的现场
   *    就是 Ruling 14：第一部分说"能更新到 5.8.26"、第二部分说"你比 5.8.22 新"。
   */
  targetSource: TargetSource;
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
  /**
   * ★★ 这个文件夹**有没有成功的扫描读数**（主进程的 `readingOf(id).ok`）。
   *
   * ⚠️★ 为什么它必须在状态里（**Ruling 65**，2026-10-03 T8 评审）：
   *    `rows: []` 有两种**在数据上分不开**的原因 —— "扫过了、里面没有可识别的 mod" 与
   *    "**这一次扫描失败了**（`mod-folder-scan.ts` 的 `ok: false` 配空 `entries`）"。
   *    界面只能靠 `rows.length === 0` 猜，而猜错的方向正好是把"读不了"读成
   *    "这个文件夹里什么都没有" —— 那时页面上会**同时**出现第一部分的"读不了这个文件夹（…）"
   *    与第二部分的"没有能识别的 mod"，两句互相打脸，而后者是**编出来的结论**。
   *    ⇒ 与 `missingStatus`（判修 2）是**同一条纪律**：分不清"不知道"与"没有"的读数
   *      不许当成结论用。
   * ⚠️ 它**不是**"路径在不在"的另一个名字：路径不存在（`pathExists === false`）时这一格
   *    可能是 `true`（上一次的读数还在缓存里）—— 两格各回答各的问题，而
   *    `planFolderView` 对 `pathExists === false` 的处理是"行与无法识别都不给"。
   */
  hasReading: boolean;
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
  /**
   * 有没有**成功**的扫描读数（`ModFolderView.hasReading` 的来源，见那一格的注释）。
   * ⚠️ 它是**必填**的，而且**刻意没有默认值**：给一个默认值就等于替调用方声称
   *    "我们读到过"，而那正是 Ruling 65 要治的那句假话 —— 缺省值必须由调用方显式说清。
   */
  hasReading: boolean;
  gameVersion: string | null;
  autoUpdate: boolean;
  scan: readonly FolderScanEntry[];
  /**
   * 上游（Modrinth）解析出来的"最新"那一条，**键 = `modid`**。语义与
   * `PlanCatalogRowsInput.upstreamLatest` **逐字相同**（同一份 `resolveTarget`）。
   *
   * ⚠️★ 为什么第二部分也必须有它（Ruling 14）：两个 planner 面对的是同一个
   *    `(modid, 游戏版本)`。只有第一部分收上游时，`mcsrranked`（本地 5.8.26、
   *    目录 5.8.22、上游 5.8.26）会出现：第一部分说"要更新到 5.8.26"、
   *    第二部分说"你比 5.8.22 新 ⇒ 不给更新按钮" —— **同一个 mod、同一版，两处不一致**。
   * ⚠️ 方向不变（只升不降）：第二部分拿**本地**的 sha512/版本与目标比，
   *    所以"上游那条比本地旧"时仍然是 `newer`、`batchable === false`。
   */
  upstreamLatest?: ReadonlyMap<string, ModRelease>;
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
  const {
    catalog,
    folderId,
    path,
    pathExists,
    hasReading,
    gameVersion,
    autoUpdate,
    scan,
    upstreamLatest,
  } = input;
  const base = { folderId, path, pathExists, hasReading, gameVersion, autoUpdate };

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
    /*
     * ⚠️ `gameVersion === null` 时**不查上游**：spec §8 那一行说得很死 ——
     *    "未选之前**所有行都是 `unknown-version`**，不给更新按钮"。上游那条是
     *    "上游的最新版"，与这个文件夹是哪一个游戏版本无关 ⇒ 拿一个不知道版本的目标
     *    去驱动更新，等于替用户猜版本。⇒ 这一支直接短路成"没有目标"。
     *    另一条路（知道版本）与目录行**共用 `resolveTarget`**，规则只留一份。
     * ⚠️ 这一支取的正是 `resolveTarget` **"没有目标"那个默认值**（`resolveTarget([], null)`）——
     *    不再内联一份 `{ target: null, targetSource: 'catalog' }` 字面量：将来那个默认值要改时
     *    只改一处（Ruling 18.3）。Ruling 17 的"唯一候选"门控对空候选**也会**给出同一个结果，
     *    两处是**同一个结论的两道表达**，不是两个判据。
     */
    const resolved =
      gameVersion === null
        ? resolveTarget([], null)
        : resolveTarget(candidates, upstreamLatest?.get(modid) ?? null);
    const verdict: FolderVerdict =
      gameVersion === null
        ? { kind: 'unknown-version' }
        : judgeRelease(
            main.sha512,
            main.version,
            resolved.target !== null ? [resolved.target] : candidates,
          );

    rows.push({
      modid,
      name: mod.name,
      fileName: main.fileName,
      localVersion: main.version,
      localSha512: main.sha512,
      oldCopies,
      candidates,
      official: resolved.target,
      targetSource: resolved.targetSource,
      verdict,
      // 与目录行同一条判据、同一个函数（Ruling 16）。
      manual: isManualTarget(candidates, resolved.target),
      /*
       * ★ 未知版本**不给更新按钮**，所以这里显式短路，而不是等着 `needsUpdate`
       *   对一个它不认识的 kind 返回 false —— 那个"恰好也是 false"的依赖
       *   下一个人改动 `needsUpdate` 时就会静默失效。
       */
      batchable:
        verdict.kind !== 'unknown-version' && resolved.target !== null && needsUpdate(verdict),
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
  /**
   * ★★ **主进程会装的那一条 release**（`resolveTarget` 算出来的唯一目标）。
   *
   * ⚠️★ 为什么它必须在状态里（**Ruling 62②**，2026-10-03 T8 评审）：底部那一栏的
   *    「下载」要决定**走哪条通道**，而"这条镜像适用吗"的判据（`mirrorsForUrl` 背后的
   *    `mirrorsFor`）要**这个 release 的地址**。状态里没有它时，渲染进程只能
   *    · 发 `'origin'`（永远成立，但**加速站用不上** —— 这是 T8 第一版接受过的代价），或者
   *    · 猜一个镜像（赌"这条 release 恰好托管在那条镜像的 hosts 上"，赌输的形态是
   *      "点了被主进程拒"）。
   *    ⇒ 有了这一格，页面就能像第一部分一样**证明**镜像是否适用。
   * ⚠️★ 它必须是**主进程会装的那一条**，不是"目录里那一条"：`mcsrranked` 这种有上游的
   *    mod，目标来自上游（Modrinth）⇒ 拿目录那条去判通道会得到与写盘不同的答案。
   *    所以 `missingMods()` 与两个 planner 共用 `resolveTarget`（Ruling 11/14 的同一条纪律），
   *    而调用方要把 `upstreamLatest` 传进来（`MissingModsInput.upstreamLatest`）。
   */
  release: ModRelease;
  /**
   * ★★ 目标是不是 `download: 'manual'`（与两个 planner 共用 `isManualTarget`）。
   *
   * ⚠️★ 为什么它必须在状态里（**Critical**，2026-10-03 T8 评审）：只按"候选数 == 1 + 没被
   *    跟踪到"筛出来的清单里**有 manual 的行**（实测：1.7.10 下 `optifine` / `optifine-light`），
   *    而 `downloadMissing` 的 `assertNotManual` **必拒** manual ⇒ 界面给它画一颗「下载」
   *    就是画了一颗**注定被拒**的按钮（Ruling 47/48）。`MissingModView` 原先没有这一格，
   *    页面**无从判断** ⇒ 这条判据只能住在这里。
   *    ⇒ 界面据此：`manual === true` 不给下载控件，只给"打开原网页"（与第一部分同一条）。
   */
  manual: boolean;
}

export interface MissingModsInput {
  catalog: ModCatalog;
  gameVersion: string;
  /** 已绑定文件夹里**命中过**的 modid（主进程扫完文件夹才知道，因此是入参）。 */
  trackedModids: ReadonlySet<string>;
  /**
   * 上游（Modrinth）解析出来的"最新"那一条，**键 = `modid`**。语义与
   * `PlanCatalogRowsInput.upstreamLatest` **逐字相同**（同一份 `resolveTarget`）。
   *
   * ⚠️★ 它决定 `MissingModView.release`（见那一格）⇒ 界面据此判镜像是否适用。
   *    不传（或某个 modid 不在表里）时行为是"目标 = 目录里唯一那条候选"，
   *    与传入之前**逐字相同**（抓取失败只是退化成旧行为，不是一条错误路径）。
   */
  upstreamLatest?: ReadonlyMap<string, ModRelease>;
}

/**
 * 该游戏版本下"清单里有、但一个已绑定文件夹里都没有"的 mod。
 *
 * ⚠️ 多候选（`ambiguous`）与没有 release 的行**都不出现**：那一栏每行要驱动一次下载，
 *    而"该装哪一个"没有唯一答案时，程序不许替用户猜（spec §7.5）。
 * ⚠️★ `manual` 的行**出现**（它们确实"缺"），但带着 `manual: true` 与那一条 release ——
 *    界面据此**不给下载按钮**、只给"打开原网页"（Critical，见 `MissingModView.manual`）。
 *    把它们从清单里删掉是另一个方向的错：用户会以为"什么都不缺"，而 OptiFine 那一份
 *    确实不在这台机器上。
 */
export function missingMods(input: MissingModsInput): MissingModView[] {
  const { catalog, gameVersion, trackedModids, upstreamLatest } = input;
  const index = buildIndex(catalog);
  const out: MissingModView[] = [];

  for (const { mod, releases } of rowsForGameVersion(index, gameVersion)) {
    if (releases.length !== 1) continue;
    if (trackedModids.has(mod.modid)) continue;
    /*
     * ★★ 目标由**共用的** `resolveTarget` 决定（与 `planCatalogRows` / `planFolderView`
     *    同一个函数、同一份上游表）—— 这一格会原样进 `MissingModView.release`，
     *    而界面拿它判"镜像适不适用"、主进程拿它下载（`downloadMissing` 里那次
     *    `planCatalogRows(...).official`）⇒ 两边必须是**同一条**。
     * ⚠️ `releases.length === 1` 已经保证了候选唯一，而 `resolveTarget` 在唯一候选下
     *    **永远给出非空目标**（上游有就给上游那条，没有就给那唯一一条）⇒ 下面不需要
     *    再判 `target === null`（那会让类型退化成 `ModRelease | null`，而这个清单
     *    按定义只列"有唯一答案"的行）。
     */
    const { target } = resolveTarget(releases, upstreamLatest?.get(mod.modid) ?? null);
    if (target === null) continue;
    const tags = modTagsOf(mod);
    out.push({
      modid: mod.modid,
      name: mod.name,
      gameVersion,
      tags,
      tagLabels: tagLabelsOf(catalog, tags),
      release: target,
      // 与两个 planner 共用 `isManualTarget`（Ruling 16：同一个 mod 两处说法必须一致）。
      manual: isManualTarget(releases, target),
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

/*
 * ===========================================================================
 * CT-1（最终修复波）：两条"目录里有没有这一格"的判断各**只留一处实现**
 * ===========================================================================
 * 这两条判据在两侧（`apps/web` 与 `apps/desktop`）各有自己的状态形状，但**判据本身**
 * 逐字相同 —— 各写一份的下场是"一侧改了、另一侧照旧"：
 *   · 版本那一支漂了 ⇒ 界面画出一个版本、而主进程 `requireGameVersion` 当场拒
 *     （或者反过来：一个目录里真有的版本在下拉里消失）；
 *   · 镜像那一支漂了 ⇒ 界面画出一颗"更新（镜像）"、而 `requireChannel` 拒
 *     （**Ruling 64** 记的就是这件事的现场）。
 * ⇒ 两条都收成**一个具名函数**，两侧各自喂自己手里那一份表。
 * ⚠️ 形参刻意收窄成"`readonly string[]` / `readonly { id: string }[]`"：两侧的表
 *    类型不同（`ModFoldersState['gameVersions']` / `ModIndex['gameVersions']`、
 *    `ModMirror[]`），而不变的只有这两件事 —— 收窄让"喂一个别的东西进来"编译期就红。
 * ⚠️ 主进程那两条**不在这里**（它们要抛一句带上下文的原话）：它们调用这两个函数，
 *    抛不抛是它们自己的事 —— 判据仍然只有这一处。
 */

/** 这个游戏版本在目录里出现过吗（`gameVersions` 是目录的版本全集）。 */
export function isKnownGameVersion(gameVersions: readonly string[], version: string): boolean {
  return gameVersions.includes(version);
}

/** 这条镜像 id 还在目录的镜像表里吗（`mirrors` 是目录那份镜像表）。 */
export function isKnownMirror(mirrors: readonly { id: string }[], mirrorId: string): boolean {
  return mirrors.some((mirror) => mirror.id === mirrorId);
}

// ---------------------------------------------------------------------------
// 状态文件 v2
// ---------------------------------------------------------------------------

/**
 * 一个标签的**选项**：键 + 两种语言的显示名（`ModFoldersState.tags` 的元素）。
 *
 * ⚠️ 与 `CatalogRowView.tagLabels`（那份只有 `zh`，见 `tagLabelsOf`）**不是**同一件事：
 *    那一格是"这一行有哪些标签"，只能按目录的 `zh` 印；这一格是"这个标签叫什么名字"，
 *    两种语言都在 ⇒ 英文界面上的标签 chip 从它取文案。
 * ⚠️ 没有显示名的标签（目录缺陷）两种语言都退化成 key 本身（与 `tagLabelsOf` 同一条纪律）。
 */
export interface TagOptionView {
  key: string;
  labels: ModTagLabel;
}

/**
 * 这条 release 的地址能用**状态里那份镜像表**里的哪几条。
 *
 * ⚠️★ 规则**一个字都不在这里重写**：主机匹配只有 `mirrorsFor` 一份实现，本函数只是把
 *    "状态里只有镜像表、没有整份目录"这件事喂进去 —— `mirrorsFor` 读的就只有
 *    `catalog.mirrors` 这一格（现读它的函数体），所以那份目录的其余字段对它没有意义。
 *    代价：这里有一次 `as ModCatalog` 的类型断言（把一份只装了 `mirrors` 的对象说成目录）。
 *    ⇒ 它必须**留在这里**、和契约同住：散到调用方去写，就等于让"哪条镜像适用"有两个版本，
 *    而两个版本的分歧表现是"镜像按钮点了被主进程拒"（`channelUrl` ⇒ `mirrorsFor` 会给 `null`）。
 * ⚠️ 顺序 = 目录里的顺序（配置即代码的顺序，可复现）；渲染进程要挑一条时应取第一条。
 */
export function mirrorsForUrl(mirrors: readonly ModMirror[], url: string): readonly ModMirror[] {
  return mirrorsFor({ mirrors } as ModCatalog, url);
}

/** 界面状态（渲染进程拿到的全部东西）。 */
export interface ModFoldersState {
  catalogStatus: 'ok' | 'unavailable' | 'invalid';
  /** 界面当前选中的游戏版本（默认 = 某个已绑定文件夹推断出的版本，否则 `1.16.1`）。 */
  gameVersion: string;
  /**
   * 目录里**全部**游戏版本（`ModIndex.gameVersions` 的副本，代码单元序）。
   *
   * ⚠️★ 为什么它必须在状态里（**Ruling 58**，2026-10-03 评审）：第一部分的游戏版本下拉是
   *    D4 的一个筛选维度，而**只有** `gameVersion` 一格时，没绑定文件夹的客户端上那个
   *    下拉**只有一个选项**（目录里实测有 **107** 个版本）—— 那个维度等于不存在。
   *    修法只能在状态这一层：在渲染进程里硬写一份版本清单就是"会漂的第二份真相"
   *    （目录才是版本表的唯一出处，`buildIndex` 已经算好了它）。
   * ⚠️ 目录不可用时是**空数组**（不是"猜一个版本表"）：界面那一档会说明目录没拉到。
   */
  gameVersions: readonly string[];
  /**
   * 第一部分的标签筛选（`prefs.tagFilter` 的副本）。
   *
   * ⚠️★ **2026-10-04（A 的 T6，spec D2）：它只是一个"记住的值"，不再筛选任何东西。**
   *    `planCatalogRows` 不收 `tagFilter` 了（D2：标签只作为徽章显示），而唯一能改它的
   *    界面（标签多选）随第一部分一起下线 ⇒ 一个陈旧的值**读到就忽略**（D8 同一条纪律：
   *    不升版本号、不迁移）。它留在契约里是 D2 明写的取舍："为删一个字段动契约不划算"。
   */
  tagFilter: readonly string[];
  /**
   * 目录里**全部**标签（键 + 两种语言的显示名）—— 标签多选的**选项源**与 chip 的
   * **文案源**（**Ruling 58**）。
   *
   * ⚠️★ 为什么不是从 `catalogRows[].tags` 里凑：**当年**那一批行是**按当前 `tagFilter`
   *    筛过**的（`planCatalogRows` 会丢掉不匹配的行 —— 那是 A 的 T6 / spec D2 之前的行为，
   *    现在不再筛了）⇒ 当年选中一个标签之后，与它互斥的标签会因为"没有一行同时带两者"
   *    而从选项里消失，用户得先取消再换 —— 那是把筛选器弄坏，不是"选项少了一个"。
   *    ⚠️ 今天这一格仍然必须来自**目录的全集**（`tagOptionsOf`）：行上的 `tags` 只覆盖
   *    "这一版有 release 的那些 mod"（目录里还有别的版本、以及这一版没有 release 的 mod）
   *    ⇒ 从行里凑出来的选项表仍然是不完整的。
   * ⚠️ 判定口径与主进程的 `requireKnownTags` **逐字相同**：`tagLabels` 的键 ∪
   *    各个 mod 真的带着的标签（目录里可能有"有标签、没显示名"的缺陷 ⇒ 那时两种语言的
   *    显示名都退化成 key 本身，与 `tagLabelsOf` 的退化同一条纪律：缺陷要看得见）。
   */
  tags: readonly TagOptionView[];
  /**
   * "全部更新"当前用的通道（**Ruling 23** 加的这一格）。
   *
   * ⚠️ 它**必须**是 `StateFileV2.prefs.bulkChannel` 那个值（**同一个值**，不是两份记忆）：
   *    界面读这一格来显示"当前选中的通道"，**不要**在渲染进程里再存一份 ——
   *    两份记忆的表现是"界面显示 `'origin'`、主进程按存下来的镜像 id 下载"，
   *    而且**完全不报错**（下一条注释里反对的正是这件事）。
   * ⚠️ 没有它的时候 `setBulkChannel` 只能返回一份**读不出**这个选择的状态：
   *    页面无处可读 ⇒ 要么自己存（上面那条），要么显示一个猜的值。
   *    为什么它住在主进程的 `prefs` 里（而不是页面本地存储）：与 `tagFilter` 逐字同一条理由
   *    —— 按机器记住；见 `desktop.ts` 里 `setBulkChannel` / `setTagFilter` 那一段。
   */
  bulkChannel: Channel;
  /**
   * 目录里的**镜像表**（`ModCatalog.mirrors` 的副本：`id` / `label` / `prefix` / `hosts`）。
   *
   * ⚠️★ 为什么它必须在状态里（**Ruling 55**，2026-10-03 评审）：第一部分的"更新（镜像）"
   *    那颗按钮要**两个**来自目录的事实 —— ①这条 release 的主机在不在某条镜像的 `hosts`
   *    里（**给不给这颗按钮**）；②那条镜像的 **id**（通道入参 `{ mirrorId }`，地址由主进程
   *    按 `prefix` 拼）。状态里没有它，渲染进程就只能**硬写**这两样（T7 的第一版正是如此：
   *    写死了 `'gh-proxy'` + `'github.com'`）⇒ 目录一改（改 id、加第二条镜像、把
   *    `github.com` 从 `hosts` 拿掉），那一页会**静默**画出"会被主进程拒的按钮"，
   *    而**没有任何门禁看得见**（spec §14.1 明说镜像列表是**配置**、正因如此才可撤换）。
   * ⚠️ 目录不可用时是**空数组** ⇒ 镜像按钮一律不出现（那一刻主进程也查不到镜像，
   *    `requireChannel` 会拒 —— 界面与主进程的判断因此一致）。
   */
  mirrors: readonly ModMirror[];
  catalogRows: readonly CatalogRowView[];
  folders: readonly ModFolderView[];
  /**
   * ★★ D1（T4）：**绑定的启动器**（界面那一页一块一行）+ 这一趟枚举它的结果。
   *
   * ⚠️★ 为什么它必须在状态里：`probeLaunchers` 报的是**候选**（`{kind, rootPath}`，没有 id），
   *    而"移除某一条绑定"要的是**绑定的 id**（`removeLauncher(id)`）⇒ 状态里没有这一格，
   *    界面就**没有任何地方**读得到 id：它画不出"已绑定的启动器"那一栏，也拆不掉任何一条。
   *    （A8 的第一个空态"未绑定启动器"判的也是它：`launchers.length === 0`。）
   * ⚠️ `error` 是**这一趟**枚举这一块的失败原话（成功 / 还没读过 ⇒ `null`）：A14 要求
   *    "单个启动器块失败不影响其它块，**且该块可重试**" ⇒ 界面要能指出**是哪一块**坏了、
   *    并给它一颗重试按钮。它由 `enumeration` 缓存现算（不是 `pushNotice` 那种一旦说了
   *    就永远挂在 `notices` 里的东西 —— 重试成功之后那句话必须消失）。
   */
  launchers: readonly LauncherBindingView[];
  /**
   * ★★ D1（T4）：界面渲染实例的**唯一**来源（`InstanceView`：已套用路径/loader/版本的手改、
   * 已带 `tracked`、`needsConfirm` 是**显示值**）。
   *
   * ⚠️★ 它与 `folders` **读同一份枚举结果**（`buildState()` 里那一处）⇒ 两边不会漂：
   *    各枚举一遍的话，"界面上有 3 个实例、而派生出来 2 个 folder"只是时间问题。
   */
  instances: readonly InstanceView[];
  /**
   * ★★ D1（A14）：上面那两份读数是**哪来的** —— `'reading'` = 还没有跑完任何一趟枚举，
   * `'ok'` = 至少跑完过一趟（`instances` 就是那一趟的读数）。
   *
   * ⚠️★ 为什么必须有一格来分这两件事（A14 / spec §7："枚举走队列，界面显示'正在读取…'"）：
   *    `instances: []` 有**两个在数据上分不开**的原因 —— "还没读到" 与 "读到了、一个实例都没有"，
   *    而界面把前者画成后者就是**编出来的结论**（"你一个实例都没有"，用户于是去重新绑启动器）。
   *    这与 `missingStatus`（判修 2）/ `ModFolderView.hasReading`（Ruling 65）是**同一条纪律**：
   *    分不清"不知道"与"没有"的读数不许当结论用。
   * ⚠️ `launchers: []`（一条绑定都没有）时这一格**照旧**可以是 `'ok'` —— 那是"读过了、
   *    但没有任何启动器可读"，与"还在读"是两句话。
   */
  instancesStatus: 'reading' | 'ok';
  /**
   * 底部缺失清单。
   *
   * ⚠️★ **它空着有两种完全不同的原因**（2026-10-03 复审的**判修 2**）：
   *    "真的没有缺的" 与 "我们**还不知道**你有没有" —— 光看 `missing: []` 这两者
   *    **在数据上分不开**，界面（T7/T8）只能靠文案猜，而猜错的方向正好是
   *    "还没扫描读数"被读成"你不缺任何 mod"。
   *    ⇒ 配一格**结构化**的 `missingStatus`：界面只在 `'ok'` 时显示清单，
   *      其余三种显示那一句说明（并且**不要**对 `'folder-missing'` 说"点重扫"——
   *      重扫修不了一个被移走的目录）。
   */
  missing: readonly MissingModView[];
  /**
   * 缺失清单现在**能不能当作结论**（判修 2；值语义见下面每一支）。
   *
   * 优先级（`buildState` 里按这个顺序判）：`'catalog-unavailable'` ⇒ `'folder-missing'`
   * ⇒ `'folder-unscanned'` ⇒ `'ok'`。前三种一律 `missing: []` + 一条说明。
   */
  missingStatus: 'ok' | 'folder-unscanned' | 'folder-missing' | 'catalog-unavailable';
  /** 例：迁移时"已转为文件夹跟踪：<mod 名>"、"这条绑定读不出来，保留原样"。 */
  notices: readonly string[];
  busy: boolean;
  /**
   * ★ 子项目 C：**正在跑的那一趟**（没有在跑就是 `null`）。
   *
   * ⚠️★ 这一格与 `onProgress` 推送**不是两份真相**：它们读的是主进程里**同一个变量**，
   *    只是**载体不同、频率不同** ——
   *      · 这一格随既有的 `onStatus` 整份状态推（**低频**：起手 / 换项 / 换相位 / 收尾），
   *        所以切 tab、折叠再展开之后，页面**立刻**知道"有一趟在跑、跑到第几项"；
   *      · 字节那一格的高频更新走 `onProgress`（D3 节流到 ≥100 ms / ≥64 KB），
   *        因为整份状态里有 folders / catalogRows，10 Hz 推它是浪费。
   * ⚠️ 一趟结束时它必须变回 `null`（`writeRun` / `bulkRun` 的收尾）—— 这就是 spec §3
   *    要的那条"结束的读数"：界面不会停在最后一帧。
   */
  progress: DownloadProgress | null;
  lastRun: {
    updated: readonly string[];
    skipped: readonly { modid: string; reason: string }[];
    failed: readonly { modid: string; reason: string }[];
    /**
     * ★ 子项目 C：被**取消**掉的项（D4）。
     *
     * ⚠️★ 单独一个桶是刻意的：取消**不是失败**（用户自己按的按钮），
     *    记进 `failed` 会让界面说"更新失败"，而事实是"按你说的停了"。
     */
    cancelled: readonly { modid: string; reason: string }[];
  } | null;
}

/*
 * ⚠️ 这里原先有一条**编译期断言**（`BulkChannelIsPersisted` / `BULK_CHANNEL_IS_PERSISTED`，
 * Ruling 23）：`ModFoldersState['bulkChannel']` 必须与 `StateFileV2['prefs']['bulkChannel']`
 * 是同一个类型。它存在的唯一理由是"当时**没有任何代码**构造或读 `ModFoldersState`" ——
 * 从上面删掉那一格，`tsc` 一个字都不会红。
 * 2026-10-03（Task 4）删掉了它：`apps/desktop/src/mod-folders.ts` 一落地，
 * 那个字段就被**真实代码消费**了 —— `buildState()` 里
 * `bulkChannel: state.prefs.bulkChannel` 这一句（读盘那一份的 `prefs` 直接喂给页面那一份）
 * 同时钉住了"字段在不在"与"两边是不是同一个类型"：
 *   · `ModFoldersState` 里删掉 `bulkChannel` ⇒ 那一句的**多写一个键**会红（对象字面量的多余属性）；
 *   · `StateFileV2.prefs` 里删掉它 ⇒ 那一句的**读**会红（`TS2339`）。
 * ⇒ 那条断言成了多余的公开符号（Ruling 25）。
 */

/**
 * v1 状态文件里的一条绑定，喂给 `attributeLegacyBindings`。
 *
 * ⚠️★ 2026-10-04（A 的 T6）：**主进程不再组装它、也不再调用那个函数**
 *    （`attributeLegacyItems` 随 `catalogBindings` 一起退役，D8 / 裁决 B）⇒
 *    今天唯一的调用者是**单测**（`services/api/src/mod-folders-shared.test.ts` 里那一组）。
 *    它留在共享内核里是"归属规则那一份实现仍在、且仍被测试钉住"的代价，
 *    不是"主进程还在用它"。
 */
export interface LegacyBinding {
  key: string;
  localPath: string;
  modid: string | null;
  /** 这条绑定落在哪个**已绑定文件夹**里（不在任何文件夹里就是 `null`）。 */
  insideFolderId: string | null;
}

/**
 * ★ D1：一个**绑定的启动器**（`rootPath` = 用户指定或探测到的那个根）。
 *
 * ⚠️ `id` 与 `kind` + `rootPath` 是**同一件事的两种说法**（`id` 由"添加启动器"那条通道
 *    按 `${kind}:${rootPath}` 造出来）：留 `id` 是因为"移除某一条绑定"要一个稳定的键，
 *    而 `kind` / `rootPath` 是枚举实例时真正要喂给 `listInstances` 的两格。
 * ⚠️ `rootPath` **原样存**（不做归一化）：去掉尾部 `\` 那一步是 `listInstances` 的入参纪律
 *    （`launcherInstances.ts` 的 `normalizeRoot`），在这里再写一遍就是第二份实现。
 */
export type LauncherBinding = { id: string; kind: LauncherKind; rootPath: string };

/**
 * ★ D1（T4）：一条绑定 + **这一趟枚举它的结果**（`ModFoldersState.launchers` 的元素）。
 *
 * ⚠️ `rootPath` 是**归一化之后**那一份（"添加启动器"那条通道在**入口**做的）：不归一化的话
 *    `D:\PCL2` 与 `D:\PCL2\` 会变成**两条**绑定，而它们的实例键又不相同 ⇒ 同一台机器上
 *    会出现两套同名的实例（`instanceKeyOf` 用的是比出来的相对路径）。
 * ⚠️ `error` 的两种取值都是**如实**的：`null` = 这一趟读到过它（哪怕是 0 个实例），
 *    非空 = 这一块读不动（原话照带，界面据此画那句话 + 一颗重试按钮）。**它不是**"这一块
 *    一个实例都没有" —— 那是 `instances` 里筛 `kind` 的事，两句话分得开。
 */
export interface LauncherBindingView {
  id: string;
  kind: LauncherKind;
  rootPath: string;
  error: string | null;
}

/**
 * ★ D1：一个实例上的**用户选择** —— 勾没勾、以及手改过的解析路径（A12：手改优先于探测）。
 *
 * ⚠️ 键是 `LauncherInstance.key`（`<类型>:<相对根的路径>`）—— 那个形状由
 *    `instanceKeyOf` 一处决定，这里不再造第二套 id。
 * ⚠️ `modsDir` / `savesDir` **可选**：只有用户真的手改过某一格才有它（A12 的"手改优先"
 *    由 T2 的 `applyOverride` 在枚举之后套用 —— 派生这一层不碰这两格，见 `deriveFolders`）。
 * ⚠️ `confirmed` 管的是**另一件事**：`needsConfirm` 是"这个解析靠猜"（探测判不出来），
 *    而它是"用户看过并**显式接受**了当前解析结果" ⇒ 界面的"待确认"标按
 *    `needsConfirm && !confirmed` 画（那条规则的实现在 T4 的 `instanceViewsOf`，不在这里）。
 */
export type InstancePref = {
  tracked: boolean;
  modsDir?: string;
  savesDir?: string;
  /**
   * ★★ D1（T4）：**用户手改的游戏版本**（A12 的手改口）。
   *
   * ⚠️★ 它与"推断值"是**两件事**（这条分开是承重的）：`adoptFolderGameVersion()` 从 jar /
   *    `mmc-pack.json` **推断**出来的版本照旧**只写 `folders[...]`**、一个字节都不进这里
   *    —— 混起来之后就再也分不清"用户选的"与"我们猜的"（下一次对账该保留哪一个？）。
   * ⚠️ 少了这一格的后果是**实打实的功能倒退**（2026-10-11 控制器现读后补的）：元数据读不出来
   *    的实例 `gameVersion === null`，而"版本 → 实例"那一层是按版本筛实例的 ⇒ 它**永远够不到**
   *    ⇒ 用户没法往它里面装任何东西。而今天用户可以在文件夹行的版本下拉里手改 ⇒ 那条路必须活着。
   * ⇒ 对账时的优先级是 `pref.gameVersion ?? instance.gameVersion ?? 既有那条的值 ?? null`
   *   （`apps/desktop/src/mod-folders.ts` 的 `reconcileFolders`）。
   * ⚠️ `undefined` = **没手改过**（交回自动）；非空字符串才作数（坏状态文件里的 `''` / `42`
   *    一律当"没改过"，见 `instanceViewsOf` 的 `viewOfOne`）。
   */
  gameVersion?: string;
  /**
   * ★ D1（A12 的手改口之一）：**用户手改的 loader 串**。
   *
   * ⚠️ 消费它的是 T2 的 `applyOverride`（`@mcsr/shared/launcherInstances`）—— 这里**不**再套用
   *    一遍：同一条规则两份实现的漂法是"界面显示 `fabric 0.17.3`、而别处按探测值走"。
   */
  loader?: string;
  /** ★ D1（T8 的「确认这个路径」动作）：用户显式确认过这个实例的解析结果 ⇒ 界面不再画"待确认"标。 */
  confirmed?: boolean;
};

/**
 * ★★ D1（T4）：**界面看到的**一个实例 —— `LauncherInstance` 加上两格**用户状态**。
 *
 * ⚠️★ 它是界面渲染实例的**唯一**来源（`ModFoldersState.instances`），而它与
 *    `deriveFolders` 读**同一份**枚举结果（`buildState` 里那一处）⇒ 两边不会漂。
 * ⚠️★ `needsConfirm` 在这一层是**显示值**（`instance.needsConfirm && !pref.confirmed`）：
 *    界面据此画"待确认"标与那颗「确认这个路径」按钮，两样都只看它一格
 *    （把原始值透传出去的话，用户点了确认之后标**照样**在 —— 点了没反应）。
 * ⚠️ 路径 / loader / 版本三格都**已套用用户的手改**（A12：手改优先于探测）。
 */
export type InstanceView = LauncherInstance & { tracked: boolean; confirmed: boolean };

/** 一格 pref 只认"普通对象"（坏状态文件里的 `null` / `42` 一律当"没有这一格"）。 */
function prefOf(prefs: Record<string, InstancePref>, key: string): InstancePref | undefined {
  const pref = prefs[key];
  return typeof pref === 'object' && pref !== null ? pref : undefined;
}

/**
 * 一个实例 + 一格用户配置 ⇒ **视图**（纯函数，改不完传进来的那个对象）。
 *
 * ⚠️ 三条规则的落点各只有一处：
 *   · 路径 / loader 覆盖 ⇒ **交给 T2 的 `applyOverride`**（这里不重写它，连"哪几格算覆盖"
 *     都不判 —— 那个函数的入参形状就是那份判据）；
 *   · 版本那一档 ⇒ 手改（非空字符串）压过元数据（见 `InstancePref.gameVersion`）；
 *   · `tracked` / `confirmed` 各自 `=== true` 才算（缺那一格与"显式 false"在这里同义，
 *     与 `deriveFolders` 的 `!== true` 是同一条纪律）。
 */
function viewOfOne(instance: LauncherInstance, pref: InstancePref | undefined): InstanceView {
  const applied = applyOverride(instance, pref);
  const confirmed = pref?.confirmed === true;
  const handEdited = pref?.gameVersion;
  return {
    ...applied,
    gameVersion:
      typeof handEdited === 'string' && handEdited !== '' ? handEdited : applied.gameVersion,
    tracked: pref?.tracked === true,
    confirmed,
    needsConfirm: applied.needsConfirm && !confirmed,
  };
}

/**
 * 枚举结果 + 用户配置 ⇒ **界面那一份实例列表**（纯函数）。
 *
 * 三条边界：
 *   · **不许筛人**：`tracked` 只是每一格上的读数，不是过滤条件 —— 在这里丢掉"没勾选的"
 *     或"待确认的"，界面上就再也看不到它们 ⇒ 用户无从勾选（"只派生被追踪的那些"是
 *     `deriveFolders` 的规则，两条各在各的位置）；
 *   · **顺序照枚举结果**（调用方给什么序就是什么序）：界面按它画行，排序会让"刚扫到的实例"
 *     跳到别处；
 *   · ★ **坏元素不许炸掉整页**（plan T4 Step 3 的边界）：状态文件里的 `instancePrefs` 只保
 *     顶层形状（`migrateState` 不判元素）⇒ 一个 `null` / `{ modsDir: 42 }` 能一路流到这里。
 *     处置是"**那一行不画、其余照常**"：判据是**结果那一格**（`key` / `modsDir` 是不是非空
 *     字符串），而不是在这里重判一遍覆盖规则。
 */
export function instanceViewsOf(
  instances: readonly LauncherInstance[],
  prefs: Record<string, InstancePref>,
): InstanceView[] {
  const out: InstanceView[] = [];
  for (const instance of instances) {
    const view = viewOfOne(instance, prefOf(prefs, instance.key));
    if (typeof view.key !== 'string' || view.key === '') continue;
    if (typeof view.modsDir !== 'string' || view.modsDir === '') continue;
    out.push(view);
  }
  return out;
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
  /**
   * ★★ **2026-10-04（A 的 T6，spec D8）：本模块既不读也不写这一格。**
   *
   * 它原来装的是"第一部分那一行绑定的本地文件"（`bindCatalogRow` 写、`buildState` 读）。
   * 那三个通道在 T6 删了（裁决 B：契约 17 → 14），第一部分整个下线 ⇒
   * `migrateState` 读到它**一律清成 `{}`**（旧数据读到就忽略、第一次持久化之后不再存在）。
   * ⚠️★ **形状仍然留在这里**：这个类型是**状态文件**的形状，而那个文件的读/写路径住在
   * `apps/desktop/src/file-updates.ts`（v1 的 `initFileUpdates` 那一套，本任务不许动；
   * 它的浅合并写盘会把"我们这份里没有的键"从磁盘捡回来）⇒ 在这里删掉字段 = 让那个文件
   * 编译不过，且**达不到**"键消失"（见 `migrateState` 的 ④）。⇒ 收口是那一件事，记在报告里。
   */
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
  /**
   * ★ D1：**绑定的启动器**（旧的 `folders` 保留在类型里，但迁移时清空 —— spec A16）。
   *
   * ⚠️ 它与 `folders` 的关系是**一格输入、一格派生**：这一格记"用户绑了哪些启动器"，
   *    `folders` 记"当前被追踪的实例派生成什么样"（`deriveFolders`）。
   * ⚠️★ 为什么它必须始终出现在**我们这一份**里（写盘那一侧的载荷性约束）：`file-updates.ts`
   *    的 `mergeWithDisk` 是 `{...磁盘, ...我们这份}` 的**浅合并** ⇒ **只有我们这份里没有
   *    这个键时**，磁盘那份才会被捡回来。而"移除一个启动器"是**替换整张表**表达的
   *    （`launchers` 里少一条）⇒ 只要这一格在（`migrateState` 保证：缺就补 `[]`），
   *    移除就落得下去。这与 `catalogBindings` 那条（`migrateState` 的 ④）同源。
   */
  launchers: readonly LauncherBinding[];
  /**
   * ★ D1：按 `instance.key` 记的**勾选与路径覆盖**。
   *
   * ⚠️ 取消勾选**不是删这一格**：`tracked: false` 与"从来没勾过"对 `deriveFolders` 是
   *    同一个结果（都派生不出 folder），但保留它才不会把用户手改过的路径（A12）一起忘掉
   *    —— 重新勾上时那两格还在。清读数（spec A9 的"取消勾选 ⇒ 扫描读数清除"）是
   *    调用方在**派生结果**上做的事，不是在这里删配置。
   */
  instancePrefs: Record<string, InstancePref>;
  prefs: {
    bulkChannel: Channel;
    catalogGameVersion: string;
    /**
     * 这一格是**用户显式选过**第一部分的游戏版本吗（**Ruling 37**，2026-10-03 判修）。
     *
     * 为什么需要它：`catalogGameVersion` 的默认值来自"某个已绑定文件夹推断出的版本"
     * （spec §6.8：默认取已绑定文件夹的版本、取不到 `1.16.1`），而那是一次**自动采纳**；
     * 用户自己在下拉框里选过之后，spec §6.8 要的是"**按机器记住**"。
     * 只靠 `catalogGameVersion` 一格分不出这两种情形（用户可能恰好选了与推断值相同的那一版），
     * 于是每次启动都会再"自动采纳"一次 —— 表现是**用户的显式选择被静默覆盖**。
     * ⇒ 显式与否单独记一格：**只有 `setCatalogGameVersion` 会把它置 `true`**，
     *   而主进程只在它为 `false` 时才自动采纳文件夹推断出的版本。
     * ⚠️ 缺这一格的旧文件（老 v2 / v1 迁移）默认 `false` ⇒ **下次启动仍会采纳一次**
     *   （Ruling 37 明确接受这一点：那时"用户选过"这件事从来没被记下来过）。
     */
    catalogGameVersionChosen: boolean;
    tagFilter: readonly string[];
  };
}

/** 是不是一个"普通对象"（`null` / 数组 / 标量都不是）。坏输入不抛，所以到处要用它。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 把盘上读到的东西迁移成 v2。**纯函数、不抛、不写盘**。
 *
 * 判据（五条，方向都是"不丢数据"）：
 *   ① `stateVersion === 2` ⇒ **原样返回**（幂等：再跑一次逐字段相同），
 *      **除了 `catalogBindings`（见 ④）与 `folders`（见 ⑤）那两格**。不重建的理由：将来往
 *      v2 里加字段时，重建会把新字段**静默剥掉**；代价是一个被**截断**的 v2 不会在这里
 *      被补全 —— 那是调用方那份三态读的活（v1 的 `fatal` ⇒ 绝不覆盖）。
 *      ⚠️ ⑤ 与 ② 是同一条口径：**新格缺就补空值，已有的配置一格都不洗**。
 *   ② 否则（v1、或任何读不出来的输入）⇒ 造一份干净的 v2：`items` **只在它真的是个
 *      对象时**保留，其余字段给默认值。**不做删除式迁移** —— 读不出来不等于可以丢。
 *   ③ 任何输入都不抛：调用方拿到的一定是一份"写下去也安全"的状态，由它决定要不要覆盖。
 *      （读不出来的输入**不在这里报错**：怎么报是主进程的事，它手里才有路径与三态读。）
 *   ④ ★★ **2026-10-04（A 的 T6，spec D8）：`catalogBindings` 一律清成 `{}`** ——
 *      那三个写它的通道（`bindCatalogRow` / `unbindCatalogRow` / `updateCatalogRow`）
 *      删了，本模块也不再读它（`planCatalogRows` 不再收 `bindings`）⇒ 盘上那份旧数据
 *      读进来**只当作不存在**。
 *      ⚠️★ 为什么是"清成 `{}`"而不是"把这个键丢掉"（spec D8 的字面是后者）：这个键的
 *      **形状**住在 `StateFileV2`，而写它的那一半住在 `apps/desktop/src/file-updates.ts`
 *      （v1 的读/写路径，本任务**不许动**），它的写盘是 `{...磁盘, ...我们这份}` 的**浅合并**
 *      —— 我们这份里没有这个键时，磁盘那份会被**捡回来**（`mergeWithDisk` 的注释写着这条
 *      是**载荷性**约束）。⇒ "键消失"要靠改 v1 的写盘路径才成立，那是另一件事。
 *      **可达到、也已断言的那一半**是 D8 真正要的结果：旧数据**读到就忽略**，
 *      而且**第一次持久化之后**它不再存在（我们这份的 `{}` 覆盖掉磁盘那份的旧内容）。
 *      ⚠️ 幂等仍然成立：`migrateState(migrateState(x))` 逐字段相同（第二次也是 `{}`）。
 *   ⑤ ★★ **2026-10-11（D1 的 T3，spec A16）：`folders` 对"**D1 之前写的文件**"清成 `{}`** ——
 *      新模型里"谁在 `folders` 里"由**被追踪的实例**派生（`deriveFolders`），旧的手工绑定
 *      与它的扫描读数因此作废，界面从"未绑定启动器"空态开始。
 *      ⚠️ **盘上的 mod 文件不受影响**：丢的只是本应用的记账（spec §10 把这条代价写下来了）。
 *      ⚠️ 与 ④ 同一条载荷性约束：写成 `folders: {}` 而**不是**删掉这个键（浅合并会捡回来）。
 *      ⚠️ 同时把 D1 新引入的两格补上默认值（`launchers: []` / `instancePrefs: {}`），
 *     而**已经有的**那两格原样保留 —— 它们就是用户的绑定与勾选，洗它们等于替用户取消勾选。
 *      ⚠️ 幂等：第二次跑 `folders` 还是 `{}`、两格还是原样 ⇒ 逐字段相同。
 *      ⚠️★ **2026-10-12 修（本条原来写的是"一律清成 `{}`"，那是错的）**：这个函数**每次读盘
 *      都会跑**（`readStateFile` → 它）⇒ 无条件清就不是迁移，是"`folders` 永不持久化"。
 *      ⇒ 清空的**前提**是"这份文件是 D1 之前写的"（两格都不在，见函数体里那段注释）；
 *      **两格都在**（我们自己写出来的文件）⇒ `folders` **原样**保留 —— ★ **"原样"包括它是
 *      个坏值的时候**（`null` / `'x'` / …）：**不许**在这里把它"修"成 `{}`，否则调用方那道
 *      "类型不对 ⇒ 备份 + 重建 + 告诉用户"的归一化就**看不见损坏**了（静默丢数据 ✗）。
 *      两次回归的现场与读数：`task-3-fix3-report.md`（16 ✗）与 `task-3-fix4-report.md`。
 */
export function migrateState(raw: unknown): StateFileV2 {
  const record = isRecord(raw) ? raw : null;

  if (record?.stateVersion === 2) {
    const previous = raw as StateFileV2;
    /*
     * ★★ D1 的"清旧 `folders`"必须是**一次性迁移** —— 判据是"**这份文件是 D1 之前写的**"：
     * `launchers` 与 `instancePrefs` **两格都不在**（那正是上一版 `persist()` 写出来的形状）。
     *
     * ⚠️★ 2026-10-12 修复（桌面探针基线 **16 ✗ / 346 ✓ / EXIT 1** 抓到的真缺陷）：
     *   原来这里是**无条件** `folders: {}`，而这个函数在**每次读盘**时都跑
     *   （`readStateFile` → `migrateState`）⇒ 那不是"升级时清一次"，是
     *   "**`folders` 永不持久化**"：v2 状态文件每次加载都丢掉全部绑定 ✗。
     *   代价的现场：spec §7 明写旧的手工绑定通道**保留在契约里**（只是不再是 UI 入口），
     *   而"没有 `instancePrefs` 的 entry"（手工绑定 / 预置文件夹）正是被那句话**每次**清掉的
     *   那一类；桌面探针那 347 条判据（靠"预置一个 folder 再启动"造夹具）因此红了 16 条，
     *   签名是 `✗ 三格原样保留 … —— {"folders":{}}` 与多处"（没有这个文件夹）"。
     *   ⇒ 第一次读旧文件清一次；清完那份文件就带上两格了 ⇒ **之后不再清**（幂等）。
     * ⚠️ 方向上的取舍（认）：**两格都在** ⇒ 一律原样保留 —— 哪怕那份 `folders` 是我们自己
     *   派生出来的（T4 的 `persist()` 会把它写下来）。"清一次"只在老文件上发生。
     */
    const predatesD1 = previous.launchers === undefined && previous.instancePrefs === undefined;
    return {
      ...previous,
      catalogBindings: {},
      /* ★ D1（spec A16，**只对 D1 之前写的文件**）：旧的手工绑定与它的扫描读数一律丢弃 ——
         新模型只认"启动器实例"（`launchers` + `instancePrefs`）。⚠️ 盘上的 mod 文件不受影响：
         丢的只是本应用的记账（spec §10 把这条代价写下来了）。
         ⚠️★ 与 ④ 同一条载荷性约束：写成 `folders: {}` 而**不是**把这个键丢掉 ——
         `file-updates.ts` 的写盘是浅合并，我们这份里没有这个键时磁盘那份会被**捡回来**。
         ★★ **其余情形一律原样交出，哪怕它是个坏值**（`null` / `'x'` / `42` / `[]` 都原样 ——
         这**故意不是** `isRecord(...) ? … : {}`）。因果关系写在这里，免得下一个人再"好心"修一次：
           · `readStateFile` 的**形状闸门在迁移之前**，而 **v2 的三格在迁移之后还要过一道
             归一化**（`normalizeFolders` / `normalizeCatalogBindings` / `normalizePrefs`，
             Ruling 31）——**那道归一化才是**"键存在但类型不对 ⇒ 备份 + 重建 + 告诉用户"
             的判据；
           · 在这里把坏值"修"成 `{}`，那道归一化看到的就是一个**合法对象** ⇒
             **损坏信号消失**：应用照样把文件当坏的重建，却**不备份、不弹框**（静默丢数据 ✗）。
             实测现场：桌面探针 `✗ 类型不对的那三格 ⇒ 备份出一个 .corrupt-<ts>`（0 个）+
             `✗ 告诉了用户`（一次都没弹）——0.1.1 时 `migrateState` 的 v2 分支**不碰** `folders`，
             所以那时这条不红；是 A16 之后才出现的（`task-3-fix4-report.md`）。
           · ⇒ "写下去也安全"**由调用方那道归一化兜住**：它对类型不对的文件**根本不写回**，
             而是走备份 + 重建。这一层只负责**把坏值原样送到它面前**。 */
      folders: predatesD1 ? {} : previous.folders,
      /* ⚠️ 这两格**原样保留**（缺 / 类型不对才退化）：它们是 D1 新引入的配置，
         盘上要么还没有（老 v2）⇒ 给空值，要么就是用户真正的绑定与勾选 ⇒ 一格都不许洗。
         ⚠️ 它们的"类型不对 ⇒ 退回空值"**不影响**上面那条链条：这两格**不走** `readStateFile`
         那道归一化（见那里 D1 那一段的注释）⇒ 这里修不修它们，损坏信号都不经过它们。 */
      launchers: Array.isArray(previous.launchers) ? previous.launchers : [],
      instancePrefs: isRecord(previous.instancePrefs) ? previous.instancePrefs : {},
    };
  }

  return {
    version: 1,
    stateVersion: 2,
    items: isRecord(record?.items) ? record.items : {},
    catalogBindings: {},
    folders: {},
    /* 干净那份（v1 / 读不出来）也要带上这两格 —— 少了它们，写盘那一侧就是"这个键不存在"，
       而 `mergeWithDisk` 会把磁盘那份旧值捡回来（同 `catalogBindings`）。 */
    launchers: [],
    instancePrefs: {},
    prefs: {
      bulkChannel: 'origin',
      catalogGameVersion: '1.16.1',
      // 迁移出来的这份**不能**声称"用户选过"（Ruling 37：没记录过就是没记录过）
      catalogGameVersionChosen: false,
      tagFilter: [],
    },
  };
}

/**
 * ★ D1：**被追踪的实例 ⇒ `folders`**（spec A9/A10）。
 *
 * 这一条是整个 D1"零功能损失"的关键：`folders` 的形状一个字没变 ⇒ 扫描、判定、
 * 整夹更新、缺失清单全都照旧工作，只是"谁在里面"改由实例决定
 * （`folderId` 就是 `instance.key`，所以"这个 folder 是哪个实例"一眼可读）。
 * ⚠️★ `autoUpdate` 是 **`true`**（2026-10-11 控制器现读纠正，初稿写的是 `false` ✗）：
 *    `autoUpdate` **只管"启动时扫不扫"** —— `apps/desktop/src/mod-folders.ts` 的 `startUp`
 *    里那句 `if (entry.autoUpdate)`（模块头"有意的取舍"那一节写着它真的在筛选）⇒ 派生出来的
 *    folder 若给 `false`，被追踪的实例在启动那一趟**不会被扫**（读数只能等页面拉状态时补扫）
 *    —— 那是 A10 要保的行为的**倒退** ✗。它也与 `bindFolder` 给**新绑**文件夹的默认值一致
 *    （那边那一格就是 `autoUpdate: true`，理由写着"默认 false 的话，新绑的文件夹在下次启动时
 *    会被启动那一次扫描漏掉"）⇒ 派生 = 一次"自动的绑定"，默认值就该与它相同。
 *    ⚠️ 这一格**不是**"自动下载"开关：写盘/下载永远要一次点击。
 * ⚠️ 路径覆盖（`InstancePref.modsDir` / `savesDir`）**不在这里**套用：那是 T2 的
 *    `applyOverride`，由调用方在**枚举之后、派生之前**做一次（A12 的"手改优先"只留一处
 *    实现）—— 在这里再读一遍 `prefs[key].modsDir` 就等于让同一条规则有两个会漂的版本。
 * ⚠️ `confirmed` 这里也**不读**：它管的是界面上那颗"待确认"标（T4 的 `instanceViewsOf`），
 *    与"派生哪几条 folder"无关。
 * ⚠️ 纯函数：不读盘、不写盘；`boundAt` 由调用方给 —— "这条 folder 是什么时候绑上的"
 *    是一份持久化读数（跨重启要稳定），不是这里能算出来的东西。
 */
export function deriveFolders(
  instances: readonly LauncherInstance[],
  prefs: Record<string, InstancePref>,
  boundAt: (key: string) => number,
): StateFileV2['folders'] {
  const out: StateFileV2['folders'] = {};
  for (const instance of instances) {
    /* ★ 只派生**被追踪**的那些。"从来没勾过"（这一格缺）与"勾过又取消了"（`tracked: false`）
       在派生上必须是**同一个结果** ⇒ 判据写成 `!== true` 而不是 `=== false`：
       后者会让缺那一格的实例漏进派生结果里（`undefined === false` 为假 ⇒ 不被跳过 ✗）。 */
    if (prefs[instance.key]?.tracked !== true) continue;
    out[instance.key] = {
      path: instance.modsDir,
      gameVersion: instance.gameVersion,
      autoUpdate: true,
      boundAt: boundAt(instance.key),
    };
  }
  return out;
}

/**
 * ★★ D1（T4 修复轮 / 评审 I1）：**对账**（派生 + 合并 + 回收）—— **纯函数、零 I/O**。
 *
 * ⚠️★ 为什么它从 `apps/desktop/src/mod-folders.ts` 搬到这里（评审 I1 的实测）：那一份
 *    **没有测试运行器** ⇒ 那 788 行里唯一能红的判据只有 `instanceViewsOf` 四条纯函数用例，
 *    而对账恰恰是 A9/A10"零功能损失"的落点。搬进 `packages/shared` 之后，
 *    `services/api/src/mod-folders-shared.test.ts` 够得着它（本仓既有的形状：判定层住 shared、
 *    断言住 api）。
 * ⚠️★ **行为一个字节都不许变**（评审逐条核过、也有刀钉着）：`boundAt` 沿用既有值、
 *    `autoUpdate` 沿用既有值（`?? true` 只兜"新出现的"）、版本三档
 *    （`视图 ?? 既有 ?? null`，而视图那一格已经是 `pref ?? 元数据`）、手工绑定（没有 pref）原样保留、
 *    被回收的那些还要由调用方 `forgetScan`。
 *
 * 三条规则与它们的**代价**：
 *   ① **补 / 改**：每个被追踪的实例 ⇒ `deriveFolders` 那一条；`boundAt` / `autoUpdate` /
 *      版本那一格按上面的顺序合并既有值（理由见 `deriveFolders` 与 `InstancePref.gameVersion`）。
 *   ② **回收**：有 pref 的 key（= 实例派生的；手工绑定的 id 是路径的 sha1、从不写 pref）
 *      若**不再被追踪**（`tracked !== true`），或**已不在这一趟的派生结果里**，就删掉它。
 *      ⚠️★ "不在结果里"**只有在能把缺席归因给一次成功的读取时**才算数 —— 判据是
 *      `enumerated` + `failed`（见 `ReconcileFoldersInput.enumerated` / `.failed` 那两段）。
 *      少了这道闸，一个块读不动（根不在 / 权限 / 盘点没挂）会让它名下那些派生 folder
 *      连同读数**一起被删掉并落盘** —— 用户看到的是"一夜之间全没了"，而界面上一句
 *      "我读不到它"都没有（评审 C1 的实测现场）。
 *   ③ ⚠️ **不是实例的那些 entry（= 手工绑定的）原样保留**：spec §7 明写旧的手工绑定通道
 *      "保留在契约里（只是不再是 UI 入口）"，而桌面探针那一整套判据就是靠 `bindFolder` 造夹具的。
 *
 * @returns `folders`（**新的一份**，入参那一份不被改）、`changed`（`false` ⇒ 调用方**不要**落盘：
 *          稳态下第二趟起都是 `false`）、`removed`（被回收的 key —— 调用方要对每一个 `forgetScan`，
 *          因为读数缓存住在主进程那一侧）。
 */
export interface ReconcileFoldersInput {
  /** 这一趟枚举出来的实例（手改的路径 / loader / 版本**已套用** —— 与界面那一份**同一个数组**）。 */
  instances: readonly LauncherInstance[];
  prefs: Record<string, InstancePref>;
  /** 既有的 `folders`（**不改它**）。 */
  folders: StateFileV2['folders'];
  /** 当前**绑定的启动器**（判"这个 key 的类型这一趟有没有成功的读取"）。 */
  launchers: readonly LauncherBinding[];
  /**
   * 这一趟**读不动**的绑定 id（`enumerateAll` 收集的）—— 它们的实例"不在结果里"**不是**
   * "它们没了"。⚠️ 按**类型**判（不是按绑定）：`LauncherInstance.key` 是
   * `<类型>:<相对根的路径>`（`instanceKeyOf`），**根不在里面** ⇒ 两个同类型的根下
   * 同名同形的实例会撞出**同一个 key** ⇒ 从 key 反推"它属于哪一条绑定"**在原理上做不到**。
   * 代价（认，评审 I4）：同类型的另一条绑定读得动时，它名下的**真实删除**也会被这道闸兜住
   * （多留一行死行），方向是安全的那一侧。
   */
  failed: readonly string[];
  /** 跑过至少一趟枚举吗（`false` = 还没读到 ⇒ 缺席一律**不许**当"没了"）。 */
  enumerated: boolean;
  /** "现在"（新出现的 entry 的 `boundAt`）—— 由调用方给，纯函数不读时钟。 */
  now: number;
}

export interface ReconcileFoldersResult {
  folders: StateFileV2['folders'];
  changed: boolean;
  removed: readonly string[];
}

/** 两格 folder entry 是不是逐格相同（对账据此判"要不要写盘"）。 */
function sameFolderEntry(
  a: StateFileV2['folders'][string],
  b: StateFileV2['folders'][string],
): boolean {
  return (
    a.path === b.path &&
    a.gameVersion === b.gameVersion &&
    a.autoUpdate === b.autoUpdate &&
    a.boundAt === b.boundAt
  );
}

export function reconcileFolders(input: ReconcileFoldersInput): ReconcileFoldersResult {
  const { instances, prefs, folders, launchers, failed, enumerated, now } = input;
  const out: StateFileV2['folders'] = { ...folders };
  let changed = false;

  /* ---- ① 补 / 改 ---- */
  const derived = deriveFolders(instances, prefs, (key) => folders[key]?.boundAt ?? now);
  for (const [key, base] of Object.entries(derived)) {
    const prev = out[key];
    const next: StateFileV2['folders'][string] = {
      path: base.path,
      /* ★ 版本三档：`base.gameVersion` 已经是"手改 ?? 启动器元数据"（视图套过），
         这里只补第三档 —— 既有那条的值（可能来自 `adoptFolderGameVersion` 从 jar 里推断）。 */
      gameVersion: base.gameVersion ?? prev?.gameVersion ?? null,
      /* ★ 那一格是**用户在文件夹行上开的开关** ⇒ 沿用既有值；只有**新出现**的才给 `true`
         （恒 `true` 会让"关掉它"变成一个自己变回来的控件）。 */
      autoUpdate: prev?.autoUpdate ?? base.autoUpdate,
      boundAt: prev?.boundAt ?? base.boundAt,
    };
    if (prev === undefined || !sameFolderEntry(prev, next)) {
      out[key] = next;
      changed = true;
    }
  }

  /* ---- ② 回收 ---- */
  /*
   * 这一趟**读成功**的类型（有它，缺席才算"真的没了"）。⚠️ 只按类型：见 `failed` 那一段。
   */
  const failedIds = new Set(failed);
  const readKinds = new Set<LauncherKind>();
  const failedKinds = new Set<LauncherKind>();
  for (const binding of launchers) {
    if (failedIds.has(binding.id)) failedKinds.add(binding.kind);
    else readKinds.add(binding.kind);
  }

  const removed: string[] = [];
  for (const key of Object.keys(out)) {
    const pref = prefOf(prefs, key);
    if (pref === undefined) continue; // ★ ③ 手工绑定 ⇒ 原样保留（一个字节都不动）
    if (pref.tracked === true && derived[key] !== undefined) continue; // 已被 ① 覆盖
    if (pref.tracked === true) {
      if (!enumerated) continue; // 还没跑过枚举 ⇒ 缺席不算数
      const kind = launcherKindOfKey(key);
      if (kind === null) continue; // 认不出类型（坏 key）⇒ 不敢回收
      if (failedKinds.has(kind) || !readKinds.has(kind)) continue; // 读不动 / 没有成功的读取
    }
    delete out[key];
    removed.push(key);
    changed = true;
  }

  return { folders: out, changed, removed };
}

/**
 * 这个 key 是哪种启动器的实例（`instanceKeyOf` 造的形状：`<类型>:<相对根的路径>`）。
 * ⚠️ 它是**从 key 反读**那一格类型，用来做"这一趟有没有成功读到过这个类型"的判据 ——
 * 不是"这个 key 属于哪一条绑定"（那一条**在原理上做不到**，见 `ReconcileFoldersInput.failed`）。
 */
function launcherKindOfKey(key: string): LauncherKind | null {
  const at = key.indexOf(':');
  if (at <= 0) return null;
  const kind = key.slice(0, at);
  return LAUNCHER_KINDS.includes(kind as LauncherKind) ? (kind as LauncherKind) : null;
}

/**
 * 六个启动器类型（运行时的那一份值 —— `satisfies` 把它焊在类型上：类型加成员而这里漏了 ⇒ 编译失败）。
 * ⚠️ 与 `apps/desktop/src/mod-folders.ts` 的 `LAUNCHER_KINDS` **是同一件事**：那一份用于
 * "渲染进程递进来的 kind 是不是真类型"的校验，这一份用于对账的"这一格是哪一类" ⇒
 * 两处都只是**取类型的成员表**，规则本身（各类型的枚举与解析）仍然只在 `launcherInstances.ts` 里。
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
 * ★★ D1（T4 修复轮 / 评审 I2）：**勾选那一刻要扫哪个目录** —— 只认**视图**。
 *
 * ⚠️★ 为什么它必须是单独的一格（评审的实测）：把这一格写成"视图 ?? `folders[key].path` 兜底"
 *    在**本仓量不出差别**（勾选那一刻 `folders[key]` 要么不存在、要么与视图同源）⇒ 那把刀
 *    全绿。而写错的症状很实在：拿**探测值**（`instanceByKey(...).modsDir`）去扫，
 *    读数却记在这个 key 上 ⇒ 界面显示的是**别人家**的读数，而且完全不报错。
 *    ⇒ 规则收成这一个函数（"视图那一格，没有视图就没有目标"），并且：
 *    · 调用方（主进程）**只**从这里拿路径；
 *    · `services/api` 的用例钉住它的两张脸（有视图 / 没有视图）；
 *    · 另有一条**源码形状**判据钉住"调用方只经它取址"（见那个测试文件里那一条的注释与边界）。
 */
export function scanTargetOf(view: InstanceView | undefined): string | null {
  return view?.modsDir ?? null;
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

// ---------------------------------------------------------------------------
// 第三部分：版本页投影（mod 下载页重构，spec §5.1）
// ---------------------------------------------------------------------------

/**
 * 该版本下的一个文件夹（新页面第二段的一行：折叠时画它，展开时画 `folder.rows`）。
 *
 * ⚠️ 为什么是"**整个 `ModFolderView`** + 一格投影"，而不是像 spec §5.1 的 `FolderBlock`
 *    那样把文件夹的字段抄平：展开那一栏要画的正是**文件夹视图本身**（`path` /
 *    `gameVersion` / `pathExists` / `hasReading` / `rows` / `unrecognized` …一个都不能少）。
 *    抄平 = 同一批事实有第二份形状，将来 `ModFolderView` 加一格时这里会**静默**漏掉它，
 *    而漏掉的表现是"展开后少了一列"，看不出是契约漂了。
 */
export interface VersionFolderBlock {
  folder: ModFolderView;
  /**
   * 这个文件夹里**认出来的** modid（`folder.rows` 的投影）—— 「已下载」判定用它。
   *
   * ⚠️ `folder.unrecognized` **不算**：那些条目恰恰是"认不出这是目录里的哪个 mod"
   *    （`FolderUnrecognizedRow` 只有文件名与原因，连 modid 都没有）⇒ 把它们算进来
   *    等于凭空承认"这个 mod 已经下过了"。它们仍留在 `folder.unrecognized` 里（页面标红）。
   */
  recognizedModids: readonly string[];
}

/** 该版本「全部 mod」里的一行（`state.catalogRows` 的投影）。 */
export interface VersionModRow {
  modid: string;
  name: string;
  tags: readonly string[];
  /** 目录里这个 mod 的 `homepage`（来源是 `CatalogRowView.homepage`）；目录没写就是 `null`。 */
  homepage: string | null;
  /**
   * 该行**目标** release 的 url / 版本（`CatalogRowView.official` —— 可能是目录那条、
   * 也可能是有上游时的上游那条）。**没有目标就是 `null`**（`ambiguous` / `missing-release`）。
   */
  releaseUrl: string | null;
  releaseVersion: string | null;
  /** 判定沿用行视图里那一个（`judgeRelease` 只算过一次，这里不重判）。 */
  verdict: ReleaseVerdict;
  /** 目标是 `download: 'manual'` ⇒ 只给"打开原网页"，**连更新按钮都不给**。 */
  manual: boolean;
  /** 该 modid 出现在哪些**已展开**的文件夹里（空 ⇒ 显示下载按钮）。 */
  downloadedIn: readonly string[];
  /**
   * ★★ **不论展开与否**，这个 modid 出现在这一版的哪些文件夹里（spec D5 的另一半）。
   *
   * ⚠️★ 为什么 `downloadedIn` 不够（B2，最终修复波）：`downloadedIn` 是"**在你眼前**
   *    下过"，而 `downloadTargets` 答的是"能往哪儿下"。主进程 `downloadMissing` 对
   *    "**目标**文件夹里已经有这个 modid"是**无条件拒**的（`mod-folders.ts` 的
   *    `present !== undefined` 那一段）⇒ 只看 `downloadedIn` 的话，折叠着的那个文件夹
   *    仍会被当成合法目标，界面画出一颗**注定被拒**的按钮 —— 而那正是这一页的规矩
   *    （"会拒的一律不画/不放开"）要消灭的东西。
   * ⚠️ 它与 `downloadedIn` 的分工**不是**两份判断：同一格 `recognizedModids` 的两个投影，
   *    差别只在"要不要按展开态过滤"。
   */
  presentIn: readonly string[];
  /**
   * ★★ 该版本里**可以把这一行下进去**的文件夹 id（D6）：`pathExists && hasReading`，
   *    **而且里面还没有这个 modid**（B2：主进程对"目标里已经有它"是**无条件拒**的）。
   *
   * ⚠️★ 这一格是**合法的目标表**，不是"这一版有几个文件夹"：`presentIn` 里的那些
   *    必须排除在外 —— 否则折叠着的文件夹会变成一颗注定被拒的按钮（B2 的现场）。
   * ⚠️ 空数组的含义因此有**两支**，由 `presentIn` 区分（页面据此说两句不同的话）：
   *    `presentIn` 空 ⇒ "这一版没有一个能装的文件夹"；非空 ⇒ "能装它的文件夹里都已经有它了"。
   */
  downloadTargets: readonly string[];
}

/** 该版本一页要画的全部东西（页面只渲染，不再判断）。 */
export interface VersionPage {
  /** 就是 `state.gameVersion`（一处真相，理由见 `planVersionPage`）。 */
  version: string;
  /** 目录在这一版可不可用（由 `missingStatus` 派生）；`false` ⇒ 第三段显示提示而不是列表。 */
  catalogAvailable: boolean;
  folders: readonly VersionFolderBlock[];
  mods: readonly VersionModRow[];
}

/**
 * 把界面状态投影成"**一个版本的一页**"。纯函数：不读盘、不判断目录、不判镜像。
 *
 * 三条边界：
 *   · **只画 `state.gameVersion` 这一版**，而且版本从状态里取、不另收一个 `version` 入参
 *     （spec §5.1 写计划时的订正）：`catalogRows` 本来就是按它算出来的，多一个"必须等于
 *     另一个字段"的参数，传错时不会报错、只会**静悄悄画空**。
 *   · `downloadedIn` **只在已展开的文件夹里**成立（展开态是界面状态，由 `expanded` 传进来，
 *     不进持久化状态）。⇒ 它为空的含义**只有一个**："在你此刻看得见的地方没下过"，
 *     页面据此显示下载按钮。⚠️ 它**不是**"这台机器上没有"—— 折叠着的文件夹里有没有，
 *     是界面要不要给它看的选择，不是投影能推断的事实（Ruling 65 的同一条纪律：分不清
 *     "不知道"与"没有"的读数不许当结论用）。
 *   · `downloadTargets` 与 `downloadedIn` **都由这里算**（页面不做判断）。后者答的是
 *     "这一行**在哪些已展开的文件夹里**已经有了"（D5），前者答的是"这一版里哪些文件夹
 *     **能装它**"：路径要在（`pathExists`）、要有扫描读数（`hasReading` —— 没有读数的
 *     文件夹我们不知道它里面有什么）、版本要已知（`folder.gameVersion === version`
 *     这一句已经保证了它，因为 `version` 是 `string`；再写一次
 *     `folder.gameVersion !== null` 会是一条**永远为假**的分支），**而且里面还没有这个
 *     modid**（B2：主进程对"目标里已经有它"是无条件拒的，见 `VersionModRow.presentIn`）。
 */
export function planVersionPage(state: ModFoldersState, expanded: readonly string[]): VersionPage {
  const version = state.gameVersion;
  const folders = state.folders.filter((folder) => folder.gameVersion === version);
  const expandedSet = new Set(expanded);
  const recognized = new Map(
    folders.map((folder) => [folder.folderId, folder.rows.map((row) => row.modid)] as const),
  );

  return {
    version,
    // 目录不可用 ⇒ 第三段没有东西可列（"读不到目录"与"这一版没有 mod"必须分开说）。
    catalogAvailable: state.missingStatus !== 'catalog-unavailable',
    folders: folders.map((folder) => ({
      folder,
      recognizedModids: recognized.get(folder.folderId) ?? [],
    })),
    mods: state.catalogRows.map((row) => {
      const known = folders.filter((folder) =>
        (recognized.get(folder.folderId) ?? []).includes(row.modid),
      );
      /** 已经**有**它的那些文件夹（不论展开与否）—— `downloadTargets` 要把它们排掉（B2）。 */
      const presentIds = new Set(known.map((folder) => folder.folderId));
      return {
        modid: row.modid,
        name: row.name,
        tags: row.tags,
        homepage: row.homepage ?? null,
        /*
         * ⚠️ 链接取的是**目标**（`official`），没有目标（`ambiguous` / `missing-release`）
         *    就给 `null` —— **不许**拿 `candidates[0]` 兜底。兜底的坏处是实的：
         *    `ambiguous` 的含义正是"该装哪一个还没定，要用户明确选一个"（spec §8），
         *    给它画一条能点的下载链接，等于替用户选了一个。候选链接要显示时由页面
         *    自己按 `verdict` 决定（那是它那一格的文案），投影不下这个决定。
         */
        releaseUrl: row.official?.url ?? null,
        releaseVersion: row.official?.version ?? null,
        verdict: row.verdict,
        manual: row.manual,
        // 只在**已展开**的文件夹里判定（理由见上面第二条边界）。
        downloadedIn: known
          .filter((folder) => expandedSet.has(folder.folderId))
          .map((folder) => folder.folderId),
        // 不论展开与否（B2：`downloadTargets` 要用它排掉"已经有它"的那些）。
        presentIn: known.map((folder) => folder.folderId),
        /*
         * ★★ 合法的目标 = 路径在 + 有扫描读数 + **里面还没有这个 modid**（B2）。
         *    ⚠️ 最后那一条是**主进程那条闸的镜像**（`downloadMissing` 的
         *    `folderView(id, entry).rows.find((row) => row.modid === modid)` ⇒ 非
         *    `undefined` 就抛"这个文件夹里已经有 X 了"）⇒ 少了它，默认视图（`expanded`
         *    为空）里每一个"已经在唯一那个文件夹里"的 mod 都会画出一颗**注定被拒**的按钮。
         *    ⚠️ 判据是 `presentIds`（`recognizedModids` 的投影），**不是** `folder.rows`
         *    里翻一遍：同一格事实只有一份来源。
         */
        downloadTargets: folders
          .filter((folder) => folder.pathExists && folder.hasReading)
          .filter((folder) => !presentIds.has(folder.folderId))
          .map((folder) => folder.folderId),
      };
    }),
  };
}

/** 「显示全部已绑定的文件夹」那一栏的一组。 */
export interface VersionGroup {
  /** `null` = 版本未知的那些文件夹（`ModFolderView.gameVersion` 为 `null`）。 */
  version: string | null;
  folders: readonly ModFolderView[];
}

/**
 * 按**有效版本**给全部已绑定文件夹分组（`state.folders` 的全集，不只是选中的那一版）。
 *
 * ⚠️ 顺序 = 状态里的**首次出现顺序**，不是字典序：这一栏按用户的绑定顺序画，排序会让
 *    "刚加的那个文件夹"跳到别处。⚠️ 版本未知的那些**自成一组**（`version` 为 `null`）：
 *    它们不属于任何一版，但也不许从这一栏里消失（Ruling 65：读不出来 ≠ 没有）。
 */
export function groupFoldersByVersion(state: ModFoldersState): readonly VersionGroup[] {
  const order: (string | null)[] = [];
  const bucket = new Map<string | null, ModFolderView[]>();
  for (const folder of state.folders) {
    const key = folder.gameVersion;
    const list = bucket.get(key);
    if (list === undefined) {
      bucket.set(key, [folder]);
      order.push(key);
    } else {
      list.push(folder);
    }
  }
  return order.map((version) => ({ version, folders: bucket.get(version) ?? [] }));
}
