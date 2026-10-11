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

/** 根路径归一化：去掉尾部的 `\` / `/`（否则 `D:\PCL2\` 会拼出 `D:\PCL2\\.minecraft\mods` ✗）。 */
function normalizeRoot(rootPath: string): string {
  return rootPath.replace(/[\\/]+$/, '');
}

/** `key` 用"类型 + 相对根的路径"（正斜杠）—— 稳定、可读、跨平台可比。 */
export function instanceKeyOf(kind: LauncherKind, rootPath: string, instancePath: string): string {
  const root = normalizeRoot(rootPath);
  /* ⚠️★ 必须按**分隔符边界**判"在不在根里面"：只写 `startsWith(root)` 的话，
     根 `D:\MultiMC` 会把兄弟目录 `D:\MultiMC2\instances\x` 也裁成 `2\instances\x` ✗
     （2026-10-11 T1 评审的 Minor 二）。今天调用路径还够不到那种根，但规则本身要是对的。 */
  const inside =
    instancePath === root ||
    instancePath.startsWith(`${root}${SEP}`) ||
    instancePath.startsWith(`${root}/`);
  const rel = inside ? instancePath.slice(root.length).replace(/^[\\/]+/, '') : instancePath;
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
  /* ★ 归一化在**入口**做一次：下面所有拼接与 key 都用它（spec A11 的路径形状稳定）。 */
  const root = normalizeRoot(rootPath);
  const parent = instancesParentOf(kind, root);
  const names = fs.listDir(parent);
  const out: LauncherInstance[] = [];
  for (const name of names) {
    const instancePath = `${parent}${SEP}${name}`;
    /* ⚠️ 这里**故意没有** `fs.exists(instancePath)` 那道守卫（计划 Task 1 的 Step 3 里有，
       但它与计划自己那 7 条夹具矛盾）：父目录列出来的名字**按定义就是存在的**，
       而所有夹具给的都只是"父目录 + 实例内的 `.minecraft`/`mods`"，
       ⇒ 凭空多一次 `exists` 会让每一条枚举测试都拿到空列表。
       实例"中途被删"由调用方逐块 try/catch 兜（spec §7 / A14），不在这里。 */
    const dirs = resolveDirs(fs, kind, root, instancePath);
    out.push({
      key: instanceKeyOf(kind, root, instancePath),
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
 * ⚠️ 判据（spec §6 的表 + 它下面那段订正，**以订正为准**）：
 *   · MultiMC / Prism / MCSR：`<实例>\.minecraft\{mods,saves}`（天然隔离）；
 *   · 官方：`<根>\{mods,saves}`（**从来不隔离** ⇒ 共享是确定事实，不标待确认）；
 *   · PCL2 / HMCL：**实例自己那一份 `mods` 或 `saves` 存在 ⇒ 隔离**（⚠️★ 不只是 `mods`：
 *     这两家的"版本隔离"是**整个游戏目录**级别的，mods/saves/config 一起搬 ⇒
 *     `versions\<名>\saves` 在而 `mods` 不在时，隔离**是开着的**，只是用户还没建 mods 目录）；
 *     否则**共享那份 `mods` 或 `saves` 存在 ⇒ 共享**；
 *     **四处都不在 ⇒ 按隔离算并标 `needsConfirm`**（不静默按共享 —— spec §6）。
 *   ⚠️★ 2026-10-11 订正：这一段原来写"spec §6 逐字"而只提 `mods` ✗ —— T1 的评审查出
 *     下面那两个 `|| fs.exists(*Saves)` **两把刀都拔不动**（没有任何用例覆盖），
 *     逼出了"要么按字面去掉、要么把规则说准并补 saves-only 用例"这个选择；
 *     定的是**后者**（现实里隔离确实是整目录级别的 ⇒ 代码是对的、注释与 spec 才是漏的），
 *     并且补了用例 ⑥ 让那半条件**能红**（实测：去掉它 ⑥ 立刻红 ✓）。
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
