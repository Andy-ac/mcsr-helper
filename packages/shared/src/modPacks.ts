/**
 * ★ B2：整合包的**纯判断**（不做 I/O）。
 *
 * ⚠️ 这一条不变量是 spec D12 的核心：**页面与主进程读同一个函数**
 *    （页面用它决定按钮与提示、主进程用它决定真的下哪些）⇒ 两边不可能不一致。
 *    `packDownloadableIn` 只是 `packPlanFor` 的薄封装，**不许**另写一份判定。
 */
import { z } from 'zod';
import { type ModIndex, type ModRelease, modFor, releasesFor } from './modCatalog';
import { resolveTarget } from './modFolders';

export const MAX_PACK_MODS = 64;

export const packInputSchema = z.object({
  title: z.string().min(1).max(80),
  description: z.string().max(400).default(''),
  gameVersion: z.string().min(1),
  /* ⚠️ `.max(MAX_PACK_MODS)` 卡的是**原始条目数**，不是去重之后的 —— 64 条里带重复项的输入
     仍然会通过 schema（落库/向下传的是下面 `transform` 去重保序之后的那一份）。语义有意如此。 */
  modids: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_PACK_MODS)
    /* 去重且保序：`new Set` 保留首次出现的顺序 —— 包里的顺序是**装的时候的顺序**（spec D1） */
    .transform((list) => [...new Set(list)]),
});

export type PackInput = z.infer<typeof packInputSchema>;
export type PackPlanItem = { modid: string; release: ModRelease };
export type PackSkipReason =
  | 'already-in-folder'
  | 'not-in-catalog'
  | 'no-release'
  | 'ambiguous'
  | 'manual';
export type PackPlan = {
  items: PackPlanItem[];
  skipped: { modid: string; reason: PackSkipReason }[];
};

/** 该 modid 在该版本下的候选；`null` = **目录里根本没有这个 modid**（与"有 modid 但该版本没 release"不同）。 */
function candidatesOf(index: ModIndex, modid: string, gameVersion: string): ModRelease[] | null {
  if (modFor(index, modid) === null) return null;
  return [...releasesFor(index, modid, gameVersion)];
}

/**
 * ⚠️ **前置条件**：`input.modids` 应当是已经过 `packInputSchema` 的（**去重保序已经在 schema 那一层做过**）。
 *    本函数自己**不**给入参去重 —— 传进重复的 modid 就会得到重复的 `items`（`packDownloadableIn` 也会多算）。
 */
export type PackPlanInput = {
  modids: readonly string[];
  gameVersion: string;
  folder: { recognizedModids: readonly string[] };
  index: ModIndex;
  /**
   * ★★ 2026-10-07（用户报的 bug 的修复）：**上游（Modrinth）解析出来的"最新"那一条**，键 = `modid`。
   *
   * 现场：整包下载把 `mcsrranked` 装成目录那条 **5.8.22**，而同一行的「下载到 ▾」装上游 **5.8.26** ✗ ——
   * 因为这一格原来**不存在**，整包那条路直接取了 `candidates[0]`（目录那条）。
   *
   * 三条纪律（与 `PlanCatalogRowsInput.upstreamLatest` 逐字相同 —— 它们本来就是同一份判定）：
   *   · **可选**：没传、或该 modid 不在表里 ⇒ 行为与加这一格之前**逐字相同** ✓
   *     （抓取失败只退化成"装目录那条"，不是一条错误路径 —— 与行级那条路的退化方向一致）；
   *   · **由调用方去抓**：本文件不做 I/O ⇒ 主进程传 `upstreamLatestOf()`；
   *   · **只改目标那条 release，不改"在不在这一趟里"** ⇒ 可下数（`items.length`）不变。
   *
   * ⚠️★ **网页那一侧传不了这一格**（`upstreamLatestOf()` 是主进程的，网页拿不到）——
   *    所以网页仍然只按目录算"可下 N 项"。今天两者**读数相同**（现读 `content/mod-catalog.json`：
   *    只有 `mcsrranked` 有 `upstream`，它在 `(modid, 游戏版本)` 上只有 1 对，且两侧的 release
   *    都是 `download: auto` ⇒ 上游只换"装哪一条"）。将来若出现"上游那条是 `manual`、目录那条是 `auto`"
   *    的 mod，网页会把可下数**少算**（按钮可能因此禁用）⇒ 那时要么给网页也送上这张表，要么按服务端算。
   */
  upstreamLatest?: ReadonlyMap<string, ModRelease>;
};

export function packPlanFor(input: PackPlanInput): PackPlan {
  const items: PackPlanItem[] = [];
  const skipped: { modid: string; reason: PackSkipReason }[] = [];
  const already = new Set(input.folder.recognizedModids);
  for (const modid of input.modids) {
    if (already.has(modid)) {
      skipped.push({ modid, reason: 'already-in-folder' });
      continue;
    }
    const candidates = candidatesOf(input.index, modid, input.gameVersion);
    if (candidates === null) {
      skipped.push({ modid, reason: 'not-in-catalog' });
      continue;
    }
    if (candidates.length === 0) {
      skipped.push({ modid, reason: 'no-release' });
      continue;
    }
    if (candidates.length > 1) {
      skipped.push({ modid, reason: 'ambiguous' });
      continue;
    }
    /* ★★ 目标那条**必须**由行级同一份 `resolveTarget` 决定（不是这里再写一遍"唯一候选就用上游"）：
       唯一候选 + 上游命中 ⇒ 返回上游那条（spec §7.2 / D1）。⚠️ 0 条 / 多候选时它返回 null
       —— 上游在那两种情形一律不参与，门控与理由都写在那个函数里（Ruling 17）。 */
    const { target: release } = resolveTarget(candidates, input.upstreamLatest?.get(modid) ?? null);
    if (release === null) {
      /* 不可达（上面两条 continue 已经把它挡掉了）—— 留着当类型收窄，别删（`noUncheckedIndexedAccess`）。 */
      skipped.push({ modid, reason: 'no-release' });
      continue;
    }
    /* `manual` = 上游只给"打开原网页"、没有可以直接下的字节（OptiFine 那 54 条）⇒ 不进批量 */
    if (release.download === 'manual') {
      skipped.push({ modid, reason: 'manual' });
      continue;
    }
    items.push({ modid, release });
  }
  return { items, skipped };
}

export function packDownloadableIn(input: PackPlanInput): number {
  /* ⚠️ 只有一处判定：这里就是 `packPlanFor(...).items.length` —— 不许另写一遍谓词 */
  return packPlanFor(input).items.length;
}
