/**
 * ★ D1：启动器实例的**纯规则**。
 *
 * ⚠️ 这个模块**不做 I/O**：要问"这个路径在不在""这个目录里有什么""这个文件写了什么"，
 *    一律从调用方传进来的 `LauncherFs` 问。理由与本仓其它纯模块逐字相同 ——
 *    主进程拿真实的 `node:fs` 实现它，测试拿一张"哪些路径存在"的表实现它 ⇒
 *    规则本身可以被穷举地测（`services/api/src/launcher-instances.test.ts`）。
 */
export type LauncherKind = 'multimc' | 'prism' | 'pcl2' | 'hmcl' | 'official' | 'mcsr';

export type LauncherFs = {
  listDir(dir: string): readonly string[];
  exists(path: string): boolean;
  readFile(path: string): string | null;
};

export type LauncherInstance = {
  key: string;
  kind: LauncherKind;
  name: string;
  instancePath: string;
  gameVersion: string | null;
  loader: string | null;
  modsDir: string;
  savesDir: string;
  /** ★ "解析靠猜"（两处 `mods` 都不存在）⇒ 界面必须标出来让用户看一眼（spec A7/A12）。 */
  needsConfirm: boolean;
};

const SEP = '\\';

/** 实例目录的父目录（枚举它即可拿到全部实例名）。 */
function instancesParentOf(kind: LauncherKind, rootPath: string): string {
  switch (kind) {
    case 'multimc':
    case 'prism':
      return `${rootPath}${SEP}instances`;
    case 'pcl2':
    case 'hmcl':
      return `${rootPath}${SEP}.minecraft${SEP}versions`;
    case 'official':
      return `${rootPath}${SEP}versions`;
    case 'mcsr':
      /* ⚠️ MCSR Launcher 的目录布局**未核实**（spec §13）：v1 先按"MultiMC 系"枚举，
         用户在界面上可以改根路径与解析结果 —— 核实之后这里再改准。 */
      return `${rootPath}${SEP}instances`;
  }
}

/** `key` 用"类型 + 相对根的路径"（正斜杠）—— 稳定、可读、跨平台可比。 */
export function instanceKeyOf(kind: LauncherKind, rootPath: string, instancePath: string): string {
  const rel = instancePath.startsWith(rootPath)
    ? instancePath.slice(rootPath.length).replace(/^[\\/]+/, '')
    : instancePath;
  return `${kind}:${rel.replace(/\\/g, '/')}`;
}

/** 三类"天然每实例一份"的启动器：mods/saves 就在实例目录里。 */
function isPerInstance(kind: LauncherKind): boolean {
  return kind === 'multimc' || kind === 'prism' || kind === 'mcsr';
}

export function listInstances(
  fs: LauncherFs,
  kind: LauncherKind,
  rootPath: string,
): LauncherInstance[] {
  const parent = instancesParentOf(kind, rootPath);
  const names = fs.listDir(parent);
  const out: LauncherInstance[] = [];
  for (const name of names) {
    const instancePath = `${parent}${SEP}${name}`;
    /* ⚠️ 这里**故意没有** `fs.exists(instancePath)` 那道守卫（计划 Task 1 的 Step 3 里有，
       但它与计划自己那 7 条夹具矛盾）：父目录列出来的名字**按定义就是存在的**，
       而所有夹具给的都只是"父目录 + 实例内的 `.minecraft`/`mods`"，
       ⇒ 凭空多一次 `exists` 会让每一条枚举测试都拿到空列表。
       实例"中途被删"由调用方逐块 try/catch 兜（spec §7 / A14），不在这里。 */
    const dirs = resolveDirs(fs, kind, rootPath, instancePath);
    out.push({
      key: instanceKeyOf(kind, rootPath, instancePath),
      kind,
      name,
      instancePath,
      gameVersion: null /* Task 2 填：读实例元数据 */,
      loader: null /* Task 2 填 */,
      modsDir: dirs.modsDir,
      savesDir: dirs.savesDir,
      needsConfirm: dirs.needsConfirm,
    });
  }
  return out;
}

/**
 * 实例 → `mods`/`saves`。
 *
 * ⚠️ 判据（spec §6 的表，逐字）：
 *   · MultiMC / Prism / MCSR：`<实例>\.minecraft\{mods,saves}`（天然隔离）；
 *   · 官方：`<根>\{mods,saves}`（**从来不隔离** ⇒ 共享是确定事实，不标待确认）；
 *   · PCL2 / HMCL：`<实例>\mods` 在 ⇒ 隔离；否则 `<根>\.minecraft\mods` 在 ⇒ 共享；
 *     **两处都不在 ⇒ 按隔离算并标 `needsConfirm`**（不静默按共享 —— spec §6）。
 */
export function resolveDirs(
  fs: LauncherFs,
  kind: LauncherKind,
  rootPath: string,
  instancePath: string,
): { modsDir: string; savesDir: string; needsConfirm: boolean } {
  if (isPerInstance(kind)) {
    const base = `${instancePath}${SEP}.minecraft`;
    return { modsDir: `${base}${SEP}mods`, savesDir: `${base}${SEP}saves`, needsConfirm: false };
  }
  if (kind === 'official') {
    return {
      modsDir: `${rootPath}${SEP}mods`,
      savesDir: `${rootPath}${SEP}saves`,
      needsConfirm: false,
    };
  }
  /* pcl2 / hmcl：先看实例自己那份 */
  const perInstanceMods = `${instancePath}${SEP}mods`;
  const perInstanceSaves = `${instancePath}${SEP}saves`;
  if (fs.exists(perInstanceMods) || fs.exists(perInstanceSaves)) {
    return { modsDir: perInstanceMods, savesDir: perInstanceSaves, needsConfirm: false };
  }
  const sharedMods = `${rootPath}${SEP}.minecraft${SEP}mods`;
  const sharedSaves = `${rootPath}${SEP}.minecraft${SEP}saves`;
  if (fs.exists(sharedMods) || fs.exists(sharedSaves)) {
    return { modsDir: sharedMods, savesDir: sharedSaves, needsConfirm: false };
  }
  return { modsDir: perInstanceMods, savesDir: perInstanceSaves, needsConfirm: true };
}
