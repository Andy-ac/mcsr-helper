/**
 * 扫描与游戏版本推断 —— 从 `mod-folders.ts` **原样搬出来**的（Task 6；切法是 2026-10-03 复审
 * 给的那一份：`mod-folder-scan.ts` = 扫描）。
 *
 * ===========================================================================
 * 这一份负责什么
 * ===========================================================================
 *   · `scanFolder` —— 扫一个 mods 目录：只取 `.jar`、读 `fabric.mod.json`、**算 sha512**
 *     （`judgeRelease` 的第一层判据就是它：`same` 只有字节能回答）；
 *   · `resolveGameVersion` —— 从路径向上最多 4 层找 `mmc-pack.json`（spec §6.6）；
 *   · 扫描**读数**的缓存（键 = folderId）与它的串行队列（`queueScan` / `ensureScans`）；
 *   · `isDirectory` —— 文件系统那个谓词。放在这里的理由只有一条：这一支与
 *     `mod-folders.ts` 写盘前那一句用的是**同一句判断**（"这个路径现在是不是目录"），
 *     而它只该有一份实现。
 *
 * ===========================================================================
 * 与 `mod-folders.ts` 的方向：**单向**（它 import 我，我 import 它 = 错）
 * ===========================================================================
 * ⇒ "读不动一个文件夹"那句 notice 由**外面注入**（`initScan`），不往上 import。
 *   反向 import 会成环，而 ESM 的环会在初始化顺序上咬人（这一层是 CJS 产物，
 *   症状会更难认）。代价（认）：本模块多一个"必须先 `initScan`"的隐式前提 ——
 *   没有 init 时那句 notice 是个空操作（**读数照常记下**，只是那句说明到不了页面）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { FolderScanEntry } from '@mcsr/shared/modFolders';
import { messageOf, readJarMeta, sha512OfFile } from './file-updates';

/** `mmc-pack.json` 向上找的层数上限（spec §6.6/§14.5：最多 4 层）。 */
const MMC_PACK_MAX_DEPTH = 4;

/** 推断游戏版本时路径里必须出现过的那一段（spec §6.6：不然 Prism 那种任意目录会被误判）。 */
const MINECRAFT_DIR = '.minecraft';

/**
 * 一次扫描的**读数**（键 = folderId）。
 *
 * ⚠️★ `ok` 这一位是判修 1 的一半：**"没扫过" ≠ "扫到了 0 个文件"**。
 *    · `ok: true` ⇒ 这个文件夹里到底有什么，我们有读数；
 *    · `ok: false` / **没有这一格** ⇒ 我们**不知道**（还没扫 / 读不动 / 路径不在）。
 *    把后者当成空的，就会把整个目录列成"你缺这些"（见 `mod-folders.ts` 里 `buildState` 那段）。
 * ⚠️ `buildState()` 是**同步**的（它要在每一次状态改动后立刻推给页面），而扫盘要
 *    `await`（每份 jar 都要算 sha512）⇒ 读数缓存在这里，那边只读它。
 */
interface FolderReading {
  ok: boolean;
  entries: readonly FolderScanEntry[];
}

const scans = new Map<string, FolderReading>();

/** "读不动一个文件夹"这类说明往上走的通道（由 `mod-folders.initModFolders` 注入）。 */
let onNotice: (text: string) => void = () => {};

/** 接上"说明往哪走"（见文件头那段：不这么做就成环）。 */
export function initScan(sink: (text: string) => void): void {
  onNotice = sink;
}

/** 没有读数时给"空读数"（`ok: false`）——调用方据此判断"不许把它当成空的"。 */
export function readingOf(folderId: string): FolderReading {
  return scans.get(folderId) ?? { ok: false, entries: [] };
}

/** 解绑 / 路径消失时**忘掉**这个文件夹的读数（"路径不存在"不是"空文件夹"）。 */
export function forgetScan(folderId: string): void {
  scans.delete(folderId);
}

/**
 * `path` 现在是不是一个目录（**唯一**一份实现：扫描与写盘前检查共用）。
 *
 * ⚠️ `statSync` 抛错（不存在 / 没权限 / 名字非法）一律 `false`：调用方问的是
 *    "能不能拿它当一个目录用"，而"问不出答案"与"不是"在这里要落同一侧。
 */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/*
 * ⚠️ 这个三行的类型守卫在 `packages/shared/src/modFolders.ts` 里也有一份（那边是私有的）。
 *    这里**没有**再抽一个"共用小工具"文件：Task 6 被授权的切法只有两个新文件
 *    （`mod-folder-catalog.ts` / `mod-folder-scan.ts`）⇒ 为三行守卫多开一个模块
 *    不在那一次授权里。要收口的话，正确的位置是 `@mcsr/shared`（它已经有同名的私有实现）。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

/**
 * 扫一次并写成读数。
 *
 * 三种结果**分得开**（判修 1）：
 *   · 路径不是目录 ⇒ **清掉**读数（"路径不存在"是 spec §8 的另一种状态，不是"空文件夹"）；
 *   · 扫成了 ⇒ `{ok: true, entries}`；
 *   · 扫炸了 ⇒ `{ok: false, entries: []}` + 一条 notice —— **不是** `ok: true` 的空读数：
 *     读不动一个文件夹，不等于它里面什么都没有。
 */
async function scanInto(folderId: string, folderPath: string): Promise<void> {
  if (!isDirectory(folderPath)) {
    scans.delete(folderId);
    return;
  }
  try {
    scans.set(folderId, { ok: true, entries: await scanFolder(folderPath, null) });
  } catch (error) {
    scans.set(folderId, { ok: false, entries: [] });
    onNotice(`读不了这个文件夹（${basename(folderPath)}）：${messageOf(error)}`);
  }
}

/**
 * 扫描的**串行队列**（与 `queueLoadCatalog` 同一条理由）：`startUp`、页面第一次要状态
 * （`ensureScans`）、绑定/重扫会同时来 ⇒ 并发扫同一个目录除了浪费 I/O 什么也换不到，
 * 而且两次 `scans.set` 谁后到谁说了算（两份读数其实一样，但"谁赢"不该由时序决定）。
 */
let scanQueue: Promise<void> = Promise.resolve();

export function queueScan(
  folderId: string,
  folderPath: string,
  opts: { onlyIfMissing: boolean },
): Promise<void> {
  const run = async (): Promise<void> => {
    if (opts.onlyIfMissing && readingOf(folderId).ok) return;
    await scanInto(folderId, folderPath);
  };
  const next = scanQueue.then(run, run);
  scanQueue = next.catch(() => undefined);
  return next;
}

/**
 * 把**还没有读数**的已绑定文件夹扫掉（2026-10-03 复审的 **Ruling 34**）。
 *
 * 为什么需要它：`autoUpdate` 只让"启动那一次扫描"扫开着开关的文件夹（见 `startUp`），
 * 而**页面要的是完整的一份状态** —— 一个关着自动更新的文件夹如果一直不扫，
 * 它既看不到内容，又会让缺失清单说不清（判修 1）。
 * 入口：`getState`（页面第一次拉状态时），也就是"有人真要这份数据了"的那一刻。
 * ⚠️ 顺序：**先扫完再组装**（`getState` 是 `await ensureScans()` 之后才 `rebuild()`），
 *    所以页面拿到的那一份不需要再等一次推送才正确。
 * ⚠️ 文件夹清单由**调用方**给（而不是这里去读状态）：`sortedFolders` 属于
 *    `mod-folders.ts` 那一侧的状态组装，拿过来就又成了双向依赖。
 */
export async function ensureScans(
  folders: readonly (readonly [folderId: string, entry: { path: string }])[],
): Promise<void> {
  for (const [folderId, entry] of folders) {
    await queueScan(folderId, entry.path, { onlyIfMissing: true });
  }
}
