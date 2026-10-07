/**
 * ★ B2：整合包的**纯判断**（不做 I/O）。
 *
 * ⚠️ 这一条不变量是 spec D12 的核心：**页面与主进程读同一个函数**
 *    （页面用它决定按钮与提示、主进程用它决定真的下哪些）⇒ 两边不可能不一致。
 *    `packDownloadableIn` 只是 `packPlanFor` 的薄封装，**不许**另写一份判定。
 */
import { z } from 'zod';
import { type ModIndex, type ModRelease, modFor, releasesFor } from './modCatalog';

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
export function packPlanFor(input: {
  modids: readonly string[];
  gameVersion: string;
  folder: { recognizedModids: readonly string[] };
  index: ModIndex;
}): PackPlan {
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
    const release = candidates[0];
    if (release === undefined) {
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

export function packDownloadableIn(input: {
  modids: readonly string[];
  gameVersion: string;
  folder: { recognizedModids: readonly string[] };
  index: ModIndex;
}): number {
  /* ⚠️ 只有一处判定：这里就是 `packPlanFor(...).items.length` —— 不许另写一遍谓词 */
  return packPlanFor(input).items.length;
}
