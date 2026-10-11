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

/**
 * ★ D1：把一个 `key` 拆回**它的两半**（`{kind, name}`）—— `instanceKeyOf` 的逆。
 *
 * ⚠️★ 为什么是**末段**当名字、不是"去掉第一段"：`instanceKeyOf` 拼的是
 *    `${kind}:${相对根的路径}`（分隔符归一成 `/`），而实例名**就是**那条相对路径的
 *    最后一段（`instances\<名>` / `versions\<名>` 那个 `<名>`）——
 *    ⚠️ 用 `rel.slice(kind.length + 1)` 那一类写法会把 `instances/` 前缀也当成名字
 *    （在"名称里带斜杠"这种形状上两种写法才分得出，而那时按末段取才是对的）。
 * ⚠️★ **不抛**（与这个模块的其余部分同一条纪律）：坏 key（没有 `:`、空串、
 *    `kind:` 后面什么都没有）照样给一个**形状合法**的结果，只是某一格是空串 ——
 *    调用方是**界面**，为一格显示值崩掉整页是"点了没反应"那一类坏法。
 *    ⚠️ 判据是"有没有那个冒号"，不是"`kind` 认不认识"：`kind` 在状态文件里可以是
 *    任何一个字符串（`migrateState` 只保顶层形状）⇒ 在这里判它的合法性会把
 *    "一格不认识的值"升级成一次异常。
 * ⚠️ 末段为空（`'multimc:'` / `'multimc:instances/'`）⇒ 名字是空串（**不**回退成整个 key：
 *    那样界面上会印出一条路径，而用户要的是"这个实例叫什么"）。
 */
export function instanceKeyParts(key: string): { kind: string; name: string } {
  const at = key.indexOf(':');
  if (at === -1) return { kind: key, name: '' };
  const kind = key.slice(0, at);
  const rel = key.slice(at + 1);
  const cut = rel.lastIndexOf('/');
  return { kind, name: cut === -1 ? rel : rel.slice(cut + 1) };
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
    /* 先造出实例（两格版本/loader 先占位），再由 `parseInstanceMeta` 只读它自己那**一份**
       元数据文件把它们填上 —— 顺序如此是因为那个函数要的是 `LauncherInstance` 本身。 */
    const draft: LauncherInstance = {
      key: instanceKeyOf(kind, root, instancePath),
      kind,
      name,
      instancePath,
      gameVersion: null /* 占位：下面立刻填 */,
      loader: null /* 占位：下面立刻填 */,
      modsDir: dirs.modsDir,
      savesDir: dirs.savesDir,
      needsConfirm: dirs.needsConfirm,
    };
    const meta = parseInstanceMeta(fs, draft);
    /* ★ T12：**先读实例自己那份**（`parseInstanceMeta` 只读它自己那一份）——
       读不出来时**才**退到共享的 `libraries\`（`loaderFromSharedLibraries`，兜底且可能不准）。
       ★★ 2026-10-11 控制器裁定（T12 修复轮）：**兜底只给"元数据带不到 loader"的那三家**
       （`pcl2` / `hmcl` / `official`，即 `!isPerInstance(kind)`）——
       **MultiMC / Prism / MCSR Launcher 的根下本来就有共享的 `libraries\`**
       （MultiMC/Prism 的库目录；MCSR Launcher 也有一份），而它们的元数据
       （`mmc-pack.json` / `instance.json`）**是权威且完整的** ⇒ 对它们跑兜底会把
       **原版实例误报成 fabric**：`mmc-pack.json` 里只有 `net.minecraft`、而根下
       `libraries\net\fabricmc\fabric-loader` 恰好只有一个版本（很常见的机器）时，
       就会算出 `fabric <那个版本>` ✗ —— 那是"填一个错的值"，比留空更坏（Global Constraints 的"不猜"）。
       ㉗ 的第二个夹具（同形状换成 pcl2）钉住"这道守卫不许把兜底整条砍掉"。 */
    const loader =
      meta.loader ?? (!isPerInstance(kind) ? loaderFromSharedLibraries(fs, root) : null);
    out.push({ ...draft, gameVersion: meta.gameVersion, loader });
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

/**
 * ★ 实例元数据（spec §6 的"版本从哪读"那一列 + A11）。
 *
 * ⚠️ **只读纪律**（A13）：下面这一族各读**一份**实例自己的元数据文件 —— 不写、不改，
 *    也不碰 `instance.cfg` 与版本 json。
 * ⚠️ **不猜**：读不出来 / JSON 坏 / 里面没有那一条 ⇒ 对应的格子给 `null`
 *    （界面按 A7 显示"待确认"，用户在界面上手改 —— A12；绝不填一个看起来合理的默认值）。
 */

/** MultiMC / Prism / MCSR 的组件表（`mmc-pack.json`）→ 游戏版本与 loader。 */
function metaFromMmcPack(
  fs: LauncherFs,
  instancePath: string,
): { gameVersion: string | null; loader: string | null } {
  const raw = fs.readFile(`${instancePath}${SEP}mmc-pack.json`);
  if (raw === null) return { gameVersion: null, loader: null };
  try {
    const parsed = JSON.parse(raw) as {
      components?: readonly { uid?: string; version?: string }[];
    };
    const components = parsed.components ?? [];
    const mc = components.find((c) => c.uid === 'net.minecraft')?.version ?? null;
    const fabric = components.find((c) => c.uid === 'net.fabricmc.fabric-loader')?.version;
    const forge = components.find((c) => c.uid === 'net.minecraftforge')?.version;
    /* ⚠️ 只认这两家 uid（本机实测真机安装：fabric 那份 `mmc-pack.json` 写的是
       `net.fabricmc.fabric-loader`、forge 那份写 `net.minecraftforge`）；quilt / liteloader /
       optifine 之类**不猜** ⇒ loader 留 null。 */
    let loader: string | null = null;
    if (fabric !== undefined) loader = `fabric ${fabric}`;
    else if (forge !== undefined) loader = `forge ${forge}`;
    return { gameVersion: mc, loader };
  } catch {
    return { gameVersion: null, loader: null }; /* 坏文件 ⇒ 留空，界面上是"待确认" */
  }
}

/** 版本 json（PCL / HMCL / 官方）→ 游戏版本；`clientVersion` / `inheritsFrom` 是那两条线索。 */
function metaFromVersionJson(
  fs: LauncherFs,
  instancePath: string,
  name: string,
): { gameVersion: string | null; loader: string | null } {
  const raw = fs.readFile(`${instancePath}${SEP}${name}.json`);
  if (raw === null) return { gameVersion: null, loader: null };
  try {
    const parsed = JSON.parse(raw) as {
      id?: string;
      inheritsFrom?: string;
      clientVersion?: string;
      libraries?: readonly { name?: string }[];
    };
    /* 顺序：`clientVersion`（★ PCL2 就写在这里 —— 本机实测 `D:\PCL2\.minecraft\versions\*`
       那 6 份 json **全部**只有 `clientVersion`、**0 份**有 `inheritsFrom`，而 `id` 形如
       `1.16.1-Fabric 0.17.3` ⇒ 少了这一格就会把 loader 串当成版本 ✗）⇒ `inheritsFrom`
       （别家启动器的版本 json 用它指向原版那一版）⇒ `id`（最差的一条）。
       ⚠️★ 两格都在时**必须 `clientVersion` 压过 `inheritsFrom`** —— ㉒ 就是钉这一条的
       （两格值不同 ⇒ 换顺序立刻红；T2 评审的刀 I 曾经全绿，就是缺它）。 */
    const gameVersion = parsed.clientVersion ?? parsed.inheritsFrom ?? parsed.id ?? null;
    /* ★ T12（spec A7）：loader 的**真值**在**这一份 json 自己的 `libraries`** 里 ——
       PCL2 / HMCL / 官方的版本 json 都没有可靠的 loader 字段（`id` 形如
       `1.16.1-Fabric 0.17.3`，从字符串里切一顿也能"切出来"，那正是"不猜"要挡的东西）。
       ⚠️ 那不是数组（或整格不在）时给 `[]` —— 别让它收到 `undefined` 而抛 ✗。 */
    const libraries = parsed.libraries;
    return {
      gameVersion,
      loader: loaderFromLibrariesArray(Array.isArray(libraries) ? libraries : []),
    };
  } catch {
    return { gameVersion: null, loader: null };
  }
}

/** 版本 json 的 `libraries` 里那两个 loader 的坐标（T2 真机核实的写法：`group:artifact:version`）。 */
const FABRIC_LIB = 'net.fabricmc:fabric-loader:';
const FORGE_LIB = 'net.minecraftforge:forge:';

/**
 * ★ T12（spec A7）：loader 的**真值**来自实例自己那份版本 json 的 `libraries`。
 * ⚠️ 按**数组顺序**取第一条认得出来的 —— 启动器自己排的顺序就是它的答案，
 *    本仓**不额外偏袒** fabric 或 forge（T2 评审的刀 K 证明过："谁优先"没有判据时会静默错；
 *    ㉓ 就是钉这一条的：两个夹具只差数组顺序、期望值随之不同）。
 */
export function loaderFromLibrariesArray(libs: readonly { name?: string }[]): string | null {
  for (const lib of libs) {
    const name = lib.name;
    if (typeof name !== 'string') continue;
    if (name.startsWith(FABRIC_LIB)) return `fabric ${name.slice(FABRIC_LIB.length)}`;
    if (name.startsWith(FORGE_LIB)) return `forge ${name.slice(FORGE_LIB.length)}`;
  }
  return null;
}

/**
 * ★ T12：**兜底** —— 实例自己那份 json 里没有 loader 时，看共享的 `libraries\` 目录。
 * ⚠️★ 这条是**兜底、可能不准**（接法选的是 (b)：它住在 `listInstances` 里，
 *    `parseInstanceMeta` 只管"实例自己那份" ⇒ 那个函数的签名与调用点一个都没动）：
 *    这个目录是**跨版本共享**的（PCL/HMCL 装的每个版本都往里放），本机实测同一目录下有
 *    8 个 `fabric-loader` 版本 + 1 个 forge ⇒ **只有在唯一候选时才敢报**；两个候选（或同一个
 *    loader 有两个版本）⇒ `null` —— 宁可空着让用户手改（A12 / T8 的界面），也不猜一个 ✗。
 * ⚠️★ **调用方还要满足一个条件**（`listInstances` 里那道 kind 守卫，㉗ 钉着它）：
 *    只有 `pcl2` / `hmcl` / `official` 才许调它 —— MultiMC 系（含 MCSR Launcher）的根下**也有**
 *    共享 `libraries\`，而它们的元数据是权威的 ⇒ 对它们跑兜底会把原版实例误报成 fabric。
 * ⚠️ 两处根都试（`<根>\libraries` 与 `<根>\.minecraft\libraries`）：PCL2 / HMCL 的 libraries
 *    在 `.minecraft\` 底下，而官方那份根本身就是 `.minecraft`（两种拼法各命中一边）。
 * ★★ 读不动不许带走整块（A14 / T12 评审 I-4）：真实 `fs.listDir` **会抛**（只吞 ENOENT/ENOTDIR，
 *    见 `modFolders` 侧那个实现）⇒ 一次 EACCES 若从这里抛出去，就是**整个启动器块**消失
 *    （逐块 catch 兜得住，但"这一格留空"显然比"整块消失"好）⇒ 下面**逐处** try/catch：
 *    读不动就把那一处当"没有候选"跳过。⚠️ 代价：这一格的兜底可能因此给 `null`（留空、手改 ✓），
 *    而**不是**一个猜出来的值。
 */
export function loaderFromSharedLibraries(fs: LauncherFs, rootPath: string): string | null {
  const roots = [`${rootPath}${SEP}libraries`, `${rootPath}${SEP}.minecraft${SEP}libraries`];
  const candidates: string[] = [];
  for (const root of roots) {
    /* 一处读不动（EACCES / 瞬时占用…）⇒ 只丢掉这一处的候选，另一处与别的实例都不受影响。 */
    try {
      for (const v of fs.listDir(`${root}${SEP}net${SEP}fabricmc${SEP}fabric-loader`)) {
        candidates.push(`fabric ${v}`);
      }
      for (const v of fs.listDir(`${root}${SEP}net${SEP}minecraftforge${SEP}forge`)) {
        candidates.push(`forge ${v}`);
      }
    } catch {
      /* 读不动 ⇒ 这一处当没有候选（宁可这一格留空，也不把整块带走） */
    }
  }
  return candidates.length === 1 ? candidates[0]! : null;
}

/**
 * MCSR Launcher 的实例元数据（★ 2026-10-11 源码实证，spec §6 / §13.1）：
 * `<实例>\instance.json`，字段是 `minecraftVersion` + `fabricVersion.loaderVersion` ——
 * 它**不写** `mmc-pack.json`（那个名字只出现在它"从 Prism/MultiMC 整合包导入"的
 * `MigrationUtils` 里），而且它**只有 fabric**（字段名就是 `fabricVersion`）。
 */
function metaFromMcsrInstance(
  fs: LauncherFs,
  instancePath: string,
): { gameVersion: string | null; loader: string | null } {
  const raw = fs.readFile(`${instancePath}${SEP}instance.json`);
  if (raw === null) return { gameVersion: null, loader: null };
  try {
    const parsed = JSON.parse(raw) as {
      minecraftVersion?: string;
      fabricVersion?: { loaderVersion?: string };
    };
    const loaderVersion = parsed.fabricVersion?.loaderVersion;
    return {
      gameVersion: parsed.minecraftVersion ?? null,
      loader: typeof loaderVersion === 'string' ? `fabric ${loaderVersion}` : null,
    };
  } catch {
    return { gameVersion: null, loader: null }; /* 坏文件 ⇒ 留空（同 ⑰ 的规矩） */
  }
}

/**
 * 实例 → `{ gameVersion, loader }`：MultiMC 系读 `mmc-pack.json`，其余读版本 json。
 * ⚠️ **只管"实例自己那份"**（只读纪律 A13 + "不猜"）：**不做**共享 `libraries\` 那个兜底 ——
 *    那个住在 `listInstances` 里（接法 (b)，见 `loaderFromSharedLibraries` 的注释）。
 */
export function parseInstanceMeta(
  fs: LauncherFs,
  instance: LauncherInstance,
): { gameVersion: string | null; loader: string | null } {
  /* ★ `mcsr`：**真值是 `instance.json`**（上面的核实）⇒ `mmc-pack.json` 只是**兜底** ——
     它确实会认后者，但那只发生在"从 Prism/MultiMC 整合包导入"的路径上
     （㉖ 测真值那条路、⑮ 测兜底那条路，两边各一条判据）。 */
  if (instance.kind === 'mcsr') {
    const own = metaFromMcsrInstance(fs, instance.instancePath);
    if (own.gameVersion !== null || own.loader !== null) return own;
    return metaFromMmcPack(fs, instance.instancePath);
  }
  return isPerInstance(instance.kind)
    ? metaFromMmcPack(fs, instance.instancePath)
    : metaFromVersionJson(fs, instance.instancePath, instance.name);
}

/** ★ A12：用户在这个实例上手改过的解析路径 / loader（只给出来的那几格才算覆盖）。 */
export type InstanceOverride = { modsDir?: string; savesDir?: string; loader?: string };

/**
 * ★ 路径覆盖优先（A12）：手改过的格子**优先于**探测结果，剩下没给的格子照旧。
 * ⚠️ 只有**真的改了**某一格**路径**才把 `needsConfirm` 清掉（空覆盖不产生"用户确认过"这个事实）。
 * ★ T12：`loader` 也认（**给了就用给的** ✓ —— A12 的手改口），但它是**另一件事**：
 *    `needsConfirm` 说的是"**路径**是猜的" ⇒ 只改 loader **不算**确认了路径（㉕ 钉着这一条；
 *    T8 有显式的确认动作）。
 * ⚠️ 函数是**纯的**：不碰传进来的那个对象（`undefined` ⇒ 原样返回）。
 */
export function applyOverride(
  instance: LauncherInstance,
  override: InstanceOverride | undefined,
): LauncherInstance {
  if (override === undefined) return instance;
  const modsDir = override.modsDir ?? instance.modsDir;
  const savesDir = override.savesDir ?? instance.savesDir;
  const loader = override.loader ?? instance.loader;
  const changed = modsDir !== instance.modsDir || savesDir !== instance.savesDir;
  return {
    ...instance,
    modsDir,
    savesDir,
    loader,
    needsConfirm: changed ? false : instance.needsConfirm,
  };
}
