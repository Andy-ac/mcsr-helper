/**
 * mod 目录行 + mod 文件夹（Plan 2）—— **桌面读路径的可复跑探针**（Task 4 建骨架）。
 *
 * ⚠️ 这不是门禁的一部分，也不在任何 `check` / `check:all` 里。它**离线可跑**：
 *    目录来自本机 HTTP 桩（内容就是仓库里的 `content/mod-catalog.json`），
 *    `api.modrinth.com`（上游解析那一支）由 `globalThis.fetch` 的钩子就地喂夹具，
 *    **任何其它网络访问一律被拒**（`探针：拒绝访问网络`）。所以"上游不可达"那一条
 *    是构造出来的、可复现的，不依赖真的断网。
 *
 * 跑法：
 *   node apps/desktop/scripts/verify-mod-folders.mjs                 # 主相位（读路径的全部判据）
 *   node apps/desktop/scripts/verify-mod-folders.mjs --keep           # 保留临时目录
 *   node apps/desktop/scripts/verify-mod-folders.mjs --phase state-file --case a|b|c|d
 *       ↑ §13.1/`readStateFile` 加固那三条**由主相位自己 spawn 的子进程**跑
 *         （每条要一份全新的模块状态 ⇒ 必须新进程），平时不用手敲。
 *   node apps/desktop/scripts/verify-mod-folders.mjs --phase write
 *       ↑ ★ Task 5 的写路径（单行更新 + 四条负向证明）。**也由主相位 spawn**：
 *         它要一份被劫持过的目录（url / sha512 指向本机桩），而目录是**启动时抓的、
 *         之后缓存在模块里** ⇒ 与主相位那份目录同进程是验不了的。
 *         ⚠️ 这一相位要 Windows：负向证明 ⑦ 必须由**另一个进程**用
 *            `[System.IO.File]::Open(p,'Open','Read','None')` 占住文件（Node 的
 *            `fs.open` 四种模式与只读属性**都挡不住 rename** —— T3 实测）。
 *
 * ⚠️ 它读的是**构建产物** `apps/desktop/dist/main.cjs`，不是源码：
 *    产物不在（或比它的输入旧）就**拒绝跑**（退出码 2）—— 一个旧产物会让全部判据
 *    静默地验上一版的代码。产物身份的读数（体积 / mtime / sha256 前缀 / 输入集来源）
 *    与通道名在两个产物里的出现次数都会打出来（"我验的是产物"要有证据）。
 *
 * ⚠️★ **没有任何门禁覆盖本文件**（`apps/desktop/scripts/*.mjs` 不在 `biome.json` 的
 *    `files.includes` 里，`apps/desktop/tsconfig.json` 的 `include` 也只有 `src`）：
 *    它语法烂了、断言写空了，都不会有信号 —— 唯一能发现的是人手动跑一次它自己。
 *    ⇒ 本任务对它的证据要求是：**先在没实现的产品上跑一次（红），实现之后再跑一次（绿）**，
 *      两次读数都进报告。
 *
 * 退出码（与 `verify-file-updates.mjs` 同一个约定）：
 *   0 = 全部成立；1 = **有条判据不成立**（逐条打印是哪一条）；
 *   2 = 判据**根本没跑起来**（产物不在 / 制品不新鲜 / 夹具造不出来）
 *       ⇒ 2 与 0 分开：§5.74 的教训是"这条检查没跑"会长得像"这项没过"，更糟的是长得像"通过"。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// ⚠️⚠️ 先确认跑的是不是真正的 Node（照 `verify-file-updates.mjs` 的同一条理由）
// ---------------------------------------------------------------------------
// 经 `pnpm run` 起的脚本里 `node` 可能解析到 **Electron**（这台机器上 pnpm 自己就跑在
// DSH Desktop 里）⇒ argv 被污染、asar 加载器介入。本脚本要 `require` 一份 CJS 产物、
// 还要往 `globalThis.fetch` 上挂钩子，解释器不是同一个的话错得很难认。
const self = fileURLToPath(import.meta.url);
const here = dirname(self);
const desktopRoot = resolve(here, '..');
const repoRoot = resolve(desktopRoot, '..', '..');

if (process.versions.electron && !process.env.MCSR_VERIFY_REEXEC) {
  const which = process.platform === 'win32' ? 'where' : 'which';
  const found = spawnSync(which, ['node'], { encoding: 'utf8' });
  const real = (found.stdout ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .find((candidate) => {
      if (candidate.toLowerCase() === process.execPath.toLowerCase()) return false;
      if (/dsh desktop|electron/i.test(candidate)) return false;
      const probe = spawnSync(candidate, ['-e', 'console.log(process.versions.electron ?? "")'], {
        encoding: 'utf8',
      });
      return (probe.stdout ?? '').trim() === '';
    });
  if (!real) {
    console.error(
      [
        '✗ 这个脚本跑在了 Electron 里面，而它需要普通 Node。',
        `  当前解释器: ${process.execPath}（Electron ${process.versions.electron}）`,
        '  自动查找 node 失败。请直接在终端里运行：',
        `      node "${self}"`,
      ].join('\n'),
    );
    process.exit(2);
  }
  console.log(`[verify] 检测到 Electron 环境，改用真正的 Node: ${real}`);
  const reexec = spawnSync(real, [self, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, MCSR_VERIFY_REEXEC: '1' },
    cwd: repoRoot,
  });
  process.exit(reexec.status ?? 2);
}

const require = createRequire(join(desktopRoot, 'package.json'));
// fflate 是 `apps/desktop` 的**运行时依赖**（产品的 `readJarMeta` 用它）⇒ 探针能拿它来
// **自己造**真 zip（产品的 `readJarMeta` 读得动）与**自己读**目标 jar 的 id。
const { strFromU8, strToU8, unzipSync, zipSync } = require('fflate');

const MAIN_CJS = join(desktopRoot, 'dist', 'main.cjs');
const PRELOAD_CJS = join(desktopRoot, 'dist', 'preload.cjs');
const MOD_CATALOG_FILE = join(repoRoot, 'content', 'mod-catalog.json');
const FILE_CATALOG_FILE = join(repoRoot, 'content', 'file-catalog.json');
const DESKTOP_SRC = join(repoRoot, 'packages', 'shared', 'src', 'desktop.ts');

const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? '') : '';
};
const KEEP = process.argv.includes('--keep');
const PHASE = argOf('--phase') || 'main';
const CASE = argOf('--case');
/** `--reuse-user-data <目录>`：case g 用它做一次**真重启**（读 case f 留下的那份状态）。 */
const REUSE_USER_DATA = argOf('--reuse-user-data');
if (PHASE !== 'main' && PHASE !== 'state-file' && PHASE !== 'prefs' && PHASE !== 'write') {
  console.error(`✗ --phase 只接受 main / state-file / prefs / write，收到「${PHASE}」`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// 判据与退出码
// ---------------------------------------------------------------------------
let failures = 0;
function check(name, condition, detail = '') {
  const suffix = detail === '' ? '' : ` —— ${detail}`;
  if (condition) console.log(`  ✓ ${name}${suffix}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${suffix}`);
  }
}
/** 判据没跑起来（不是"没过"）：打印原因后按退出码 2 结束。 */
function bail(reason) {
  console.error(`\n✗ 判据没跑起来：${reason}`);
  console.error('  （退出码 2 = 这条检查没跑成，**不等于**判据通过）');
  process.exit(2);
}
/**
 * 一段判据：内部一条抛了 ⇒ 这一段的"整段跑完"记一条 ✗，后面的段落照常跑
 * （散开写的话第一条抛就会以栈收场，后面准备好的 ✗ 一条都印不出来 —— §5.74 那一族）。
 */
async function section(title, fn) {
  console.log(`\n## ${title}`);
  try {
    await fn();
  } catch (error) {
    failures += 1;
    console.log(`  ✗ ${title}（整段跑完） —— 抛了：${error?.message ?? String(error)}`);
  }
}
const sha256Of = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const sha512Of = (path) => createHash('sha512').update(readFileSync(path)).digest('hex');
const listing = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .sort()
        .map((name) => `${name}`)
        .join(' | ')
    : '（目录不在）';

if (PHASE === 'state-file' && !['a', 'b', 'c', 'd'].includes(CASE)) {
  bail(`--phase state-file 的 --case 只接受 a / b / c / d，收到「${CASE}」`);
}
if (PHASE === 'prefs' && !['d', 'e', 'f', 'g'].includes(CASE)) {
  bail(`--phase prefs 的 --case 只接受 d / e / f / g，收到「${CASE}」`);
}
if (PHASE === 'prefs' && CASE === '') bail('--phase prefs 必须带 --case d|e|f|g');

// ---------------------------------------------------------------------------
// 前置：产物在不在、是不是这一版（照 `verify-file-updates.mjs` 的输入集守卫）
// ---------------------------------------------------------------------------
console.log(`# mod 目录行 + mod 文件夹探针（${self}）`);
console.log(`  相位：${PHASE}${CASE === '' ? '' : `（case ${CASE}）`}`);
console.log(`  仓库根：${repoRoot}`);
if (!existsSync(MAIN_CJS)) bail(`构建产物不在：${MAIN_CJS}。先跑 node apps/desktop/build.mjs。`);
const mainStat = statSync(MAIN_CJS);
console.log(
  `  被测产物：${MAIN_CJS}（${String(mainStat.size)}B，打包于 ${mainStat.mtime.toISOString()}，sha256 前 16 位 ${sha256Of(MAIN_CJS).slice(0, 16)}）`,
);

/**
 * 输入集：**从产物自己问出来**（`dist/main.cjs.map` 的 `sources`），
 * 读不到真清单时退化成一份**更宽**的兜底清单（见 `verify-file-updates.mjs` 里那段论证的全文）。
 * ⚠️ 这里**故意不写 glob**（块注释里"星号紧跟斜杠"会提前把注释关掉 —— 那一处踩过两次）。
 */
function fallbackInputs() {
  const list = [];
  (function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts')) list.push(path);
    }
  })(join(desktopRoot, 'src'));
  for (const pkg of readdirSync(join(repoRoot, 'packages'), { withFileTypes: true })) {
    if (pkg.isDirectory()) {
      (function walk(inner) {
        if (!existsSync(inner)) return;
        for (const entry of readdirSync(inner, { withFileTypes: true })) {
          const path = join(inner, entry.name);
          if (entry.isDirectory()) walk(path);
          else if (entry.name.endsWith('.ts')) list.push(path);
        }
      })(join(repoRoot, 'packages', pkg.name, 'src'));
    }
  }
  return list;
}

function collectInputs() {
  const map = `${MAIN_CJS}.map`;
  const fallbackHow = (why) =>
    `兜底清单（${why}）：apps/desktop/src 下所有 .ts + packages 下各包的 src`;
  if (existsSync(map)) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(map, 'utf8'));
    } catch (error) {
      bail(
        `产物带的 sourcemap 读不出来（${error instanceof Error ? error.message : String(error)}）：${map}\n` +
          '    重跑 node apps/desktop/build.mjs 再试。',
      );
    }
    const sources = parsed?.sources;
    if (Array.isArray(sources) && sources.length > 0) {
      const list = sources
        .map((s) => resolve(dirname(MAIN_CJS), s))
        .filter((p) => !p.includes(`${sep}node_modules${sep}`));
      return { list, how: 'dist/main.cjs.map 的 sources（剔掉 node_modules）' };
    }
    return {
      list: fallbackInputs(),
      how: fallbackHow(Array.isArray(sources) ? 'map 里的 sources 是空数组' : 'map 里没有 sources'),
    };
  }
  return { list: fallbackInputs(), how: fallbackHow('产物没有 sourcemap') };
}
const { list: rawInputs, how: inputSource } = collectInputs();
rawInputs.push(join(desktopRoot, 'build.mjs'));
const artifactInputs = rawInputs.filter((p) => existsSync(p));
let newestInput = { path: '(一个输入都没有)', mtimeMs: 0 };
for (const path of artifactInputs) {
  const st = statSync(path);
  if (st.mtimeMs > newestInput.mtimeMs) newestInput = { path, mtimeMs: st.mtimeMs };
}
console.log(`  输入集来源：${inputSource}`);
console.log(
  `  输入里最新的一份：${relative(repoRoot, newestInput.path)}（${new Date(newestInput.mtimeMs).toISOString()}）；共 ${String(artifactInputs.length)} 个输入`,
);
if (mainStat.mtimeMs < newestInput.mtimeMs) {
  bail(
    [
      '产物比它的输入**旧** ⇒ 下面全部判据会静默地验证"上一版的代码"：',
      `      产物 ${MAIN_CJS}（${mainStat.mtime.toISOString()}）`,
      `      输入 ${newestInput.path}（${new Date(newestInput.mtimeMs).toISOString()}）`,
      '    先跑 node apps/desktop/build.mjs 再重跑本脚本。',
    ].join('\n'),
  );
}
console.log('  ✓ 产物不比它的输入旧');

// ---------------------------------------------------------------------------
// 通道名：从共享常量那份**源码**里现读（不手抄 —— 抄错一个字母是静默失败）
// ---------------------------------------------------------------------------
const desktopSrc = readFileSync(DESKTOP_SRC, 'utf8');
function channelsOf(constName) {
  const start = desktopSrc.indexOf(`export const ${constName}`);
  if (start < 0) bail(`${DESKTOP_SRC} 里找不到 ${constName}`);
  const end = desktopSrc.indexOf('} as const satisfies', start);
  if (end < 0) bail(`${constName} 的形状变了（找不到 '} as const satisfies'）`);
  const block = desktopSrc.slice(start, end);
  const names = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const keys = [...block.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
  if (names.length !== keys.length || names.length === 0) {
    bail(`${constName} 的键/值数量对不上（${String(keys.length)} vs ${String(names.length)}）`);
  }
  return Object.fromEntries(keys.map((k, i) => [k, names[i]]));
}
const MOD_CH = channelsOf('MOD_FOLDERS_CHANNELS');
const FILE_CH = channelsOf('FILE_UPDATES_CHANNELS');
console.log(
  `  通道：modFolders ${String(Object.keys(MOD_CH).length)} 条；fileUpdates ${String(Object.keys(FILE_CH).length)} 条`,
);

/**
 * 通道名在两个产物里的出现次数（ASCII 锚点 ⇒ 与编码无关，§5.92 的教训只针对中文）。
 * ⚠️★ 两个数字分开打（2026-10-04 收口波订正：这里原来写"15 条里 / handle 只有 14 条"；
 *    **A 的 S2** 加了 `openFolder` 之后是 17 个成员；**A 的 T6** 删掉那三条（裁决 B）
 *    之后是 **14** 个成员）：**14** 个通道名进 `main.cjs`，
 *    其中 `ipcMain.handle` 只有 **13** 条 —— 第 14 个是 `onStatus`，它只**推**（`send`）。
 * ⚠️ 下面两个读数里的分母**现数**（`MOD_CH_COUNT`）而不是手抄 13/14：
 *    手抄的数字会在"通道表加了/删了一条"时变成一句**看起来还在的假话**（§5.32 ④）。
 */
function countChannels(path, channels) {
  if (!existsSync(path)) return null;
  const body = readFileSync(path, 'utf8');
  const counts = Object.values(channels).map((name) => ({
    name,
    n: body.split(name).length - 1,
  }));
  return {
    present: counts.filter((c) => c.n > 0).length,
    handle: body.split('ipcMain.handle(').length - 1 + (body.split('.handle(').length - 1),
    missing: counts.filter((c) => c.n === 0).map((c) => c.name),
  };
}
const MOD_CH_COUNT = Object.keys(MOD_CH).length;
const mainCounts = countChannels(MAIN_CJS, MOD_CH);
const preloadCounts = countChannels(PRELOAD_CJS, MOD_CH);
console.log(
  `  产物里 mcsr:modfolders-* 的出现：main.cjs 命中 ${String(mainCounts.present)}/${String(MOD_CH_COUNT)}；preload.cjs 命中 ${String(preloadCounts ? preloadCounts.present : '（无 preload.cjs）')}/${String(MOD_CH_COUNT)}`,
);
if (mainCounts.missing.length > 0) {
  console.log(`    main.cjs 里一个都没有的通道：${mainCounts.missing.join(', ')}`);
}

// ---------------------------------------------------------------------------
// 桩 electron（主进程真正用到的那几样；对话框的答案由队列预置）
// ---------------------------------------------------------------------------
const handlers = new Map();
const pushes = [];
const windows = [];
const dialogCalls = [];
/**
 * ★ A 的 S2：`shell.openPath` 收到的**每一个**参数（原样记下来 —— 判据就是"它收到了什么"）。
 * ⚠️ 记的是**参数本身**，不是"调用次数"：`openFolder` 那条纪律是"路径只能来自主进程的状态"，
 *    而"调用了几次"对"参数是不是那个 id"一个字都没说。
 */
const openCalls = [];
let openQueue = [];
let messageResponses = [];

const app = {
  // ⚠️ 固定 false：打包态会让启动那一路去载 electron-updater（它在 `initUpdater` 里被
  //    `isPackaged` 挡着，这里不想把它拉进来）。代价：这一支**证不了**打包态的启动流程
  //    与 asar 里的相对路径 —— 那要真机。
  isPackaged: false,
  getAppPath: () => desktopRoot,
  getVersion: () => '0.0.3-verify',
  getName: () => 'mcsr-helper-verify',
  getPath: (name) => (name === 'userData' ? currentUserDataDir : join(currentUserDataDir, name)),
  requestSingleInstanceLock: () => true,
  setAppUserModelId: () => {},
  on: () => app,
  once: () => app,
  quit: () => {},
  whenReady: () => Promise.resolve(),
};

class BrowserWindow {
  constructor(options) {
    this.options = options;
    this.webContents = {
      send: (channel, payload) => pushes.push({ channel, payload }),
      on: () => {},
      setWindowOpenHandler: () => {},
    };
    windows.push(this);
  }
  static getAllWindows() {
    return windows;
  }
  static getFocusedWindow() {
    return windows[0] ?? null;
  }
  once() {}
  on() {}
  show() {}
  maximize() {}
  focus() {}
  restore() {}
  isMinimized() {
    return false;
  }
  isDestroyed() {
    return false;
  }
  isMaximized() {
    return false;
  }
  getNormalBounds() {
    return { x: 0, y: 0, width: 1280, height: 860 };
  }
  loadURL() {
    return Promise.resolve();
  }
}

const electronStub = {
  app,
  BrowserWindow,
  ipcMain: {
    handle: (channel, fn) => handlers.set(channel, fn),
    on: () => {},
  },
  dialog: {
    showOpenDialog: async (a, b) => {
      dialogCalls.push({ kind: 'open', options: b ?? a });
      return openQueue.shift() ?? { canceled: true, filePaths: [] };
    },
    showMessageBox: async (a, b) => {
      dialogCalls.push({ kind: 'message', options: b ?? a });
      return { response: messageResponses.shift() ?? 1, checkboxChecked: false };
    },
  },
  screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }] },
  session: {
    defaultSession: {
      setPermissionRequestHandler: () => {},
      setPermissionCheckHandler: () => {},
    },
  },
  /*
   * ★ A 的 S2（spec §9.14）：`openFolder` 是**唯一一条会让用户的操作系统去打开一个位置**的
   *   通道 ⇒ 桩要能把"到底打开了哪个路径"记下来。返回空串 = 成功
   *   （Electron 的 `shell.openPath` 就是"失败时给一句错误文案、成功时给空串"）。
   */
  shell: {
    openExternal: () => Promise.resolve(),
    openPath: async (p) => {
      openCalls.push(p);
      return '';
    },
  },
};

/** `app.getPath('userData')` 要读的那个目录（每个相位一份临时目录）。 */
let currentUserDataDir = '';

// ---------------------------------------------------------------------------
// 夹具：真 zip 的 jar + 一份 v1 状态文件
// ---------------------------------------------------------------------------
const modCatalog = JSON.parse(readFileSync(MOD_CATALOG_FILE, 'utf8'));
const fileCatalog = JSON.parse(readFileSync(FILE_CATALOG_FILE, 'utf8'));
const ANTIGONE = 'antigone';
const MCSRRANKED = 'mcsrranked';
const UPSTREAM_PROJECT = modCatalog.mods.find((m) => m.modid === MCSRRANKED)?.upstream?.project;
if (UPSTREAM_PROJECT === undefined) {
  bail(`夹具前提不成立：${MOD_CATALOG_FILE} 里 ${MCSRRANKED} 没有 upstream`);
}

/**
 * "在 1.16.1 下**恰好一条**候选"的 modid 清单。
 *
 * ⚠️ 这是**缺失清单的判据本身**（`missingMods`：`releases.length !== 1` 的行一律不出现，
 *    因为"该装哪一个"没有唯一答案 —— spec §7.5）。⇒ 期望条数与夹具 modid 都从这里推，
 *    **不手抄一个数字**：目录换了、判据改了，这两个读数会跟着变，而不是变成一句假话。
 */
const oneRelease1161 = modCatalog.mods
  .map((mod) => mod.modid)
  .filter(
    (modid) =>
      modCatalog.releases.filter(
        (release) => release.modid === modid && release.targetVersions.includes('1.16.1'),
      ).length === 1,
  );

/**
 * F-pre（判修 1）用的那个 modid：**第一个**"1.16.1 下唯一候选、且不是 antigone"的 mod。
 *
 * ⚠️ 它原先算在 `mainPhase()` 里；Task 5 把它提上来 —— 写路径那四个"被劫持"的 release
 *    必须与它（以及 antigone / mcsrranked）**不同的 modid**，否则夹具会互相污染。
 */
const trackedInPre = oneRelease1161.find((modid) => modid !== ANTIGONE);
if (trackedInPre === undefined) {
  bail(`${MOD_CATALOG_FILE} 里找不到"1.16.1 下唯一候选且 modid ≠ antigone"的 mod`);
}

// ---------------------------------------------------------------------------
// ★ Task 5：写路径的夹具（**只在 `--phase write` 里生效**）
// ---------------------------------------------------------------------------
/*
 * **六个**被**劫持**的 release：`url` 换成本机桩上的地址、`sha512` / `size` 换成我们自己的字节。
 * 为什么必须劫持：真的去 GitHub 下 27 MB 既不是"离线可跑"，也让"sha512 对不上"这一条
 * 无从构造（那一条要的正是"服务端回的字节与目录里写的 sha512 不一致"）。
 *
 * ⚠️★ 只改 `url` / `sha512` / `size`（外加 Ruling 47 那个夹具要的 `download: 'manual'`）：
 *    **不动 `targetVersions`、不增删 release** ⇒ "1.16.1 下唯一候选"的 mod 集合与条数一个都不变
 *    （主相位那些计数判据不受影响）。而 `WRITE` 为假时这整段**一行都不执行**
 *    ⇒ 主相位看到的是仓库里那份目录，逐字不变。
 */
const WRITE = PHASE === 'write';
/** 版本主体"每一段都是数字"（`isSortableBody` 的判据）—— `newer` 那个夹具必须先满足它。 */
const sortableBodyOf = (version) =>
  version.split(/[.\-+_]/).every((segment) => /^[0-9]+$/.test(segment));
const writePool = WRITE
  ? oneRelease1161.filter(
      (modid) => modid !== ANTIGONE && modid !== trackedInPre && modid !== MCSRRANKED,
    )
  : [];
const MOD_NEWER = writePool.find((modid) => {
  const release = modCatalog.releases.find(
    (candidate) => candidate.modid === modid && candidate.targetVersions.includes('1.16.1'),
  );
  return release !== undefined && sortableBodyOf(release.version);
});
const writeMods = writePool.filter((modid) => modid !== MOD_NEWER);
if (WRITE && (MOD_NEWER === undefined || writeMods.length < 5)) {
  bail(
    `构造不出写路径的夹具：要 6 个"1.16.1 下唯一候选"的 mod（其中一个的版本主体要可排序，做 \`newer\` 那一支），只找到 ${String(writePool.length)} 个`,
  );
}
const MOD_BAD = writeMods[0] ?? '';
const MOD_GOOD = writeMods[1] ?? '';
const MOD_BUSY = writeMods[2] ?? '';
const MOD_TRAV = writeMods[3] ?? '';
const MOD_MANUAL = writeMods[4] ?? '';

/** 夹具 jar 里写的**内部版本号**（故意与目录里 release 的版本字符串不同：见写相位 ⑰ 的刀）。 */
const FIXTURE_JAR_VERSION = '1.0.0';
const SERVED_JAR_VERSION = '9.9.9';

/** 一个**真 zip**（产品的 `readJarMeta` 读得动）。`extra=true` ⇒ 字节与"官方那一份"不同。 */
function probeJar(modid, version, extra = false) {
  const entries = { 'fabric.mod.json': strToU8(JSON.stringify({ id: modid, version })) };
  if (extra) entries['extra.txt'] = strToU8('这一条让字节与目录里那一份不同（同 modid、不同 sha512）');
  return Buffer.from(zipSync(entries));
}
const sha512OfBuffer = (bytes) => createHash('sha512').update(bytes).digest('hex');

/** 桩上"哪条路径回什么"。写相位之外是空的 ⇒ 主相位的桩行为逐字不变。 */
const downloads = new Map();
/** 每一次真的落到下载那条路上的请求（catalog 请求不算）。 */
const downloadLog = [];

function makeJar(path, meta) {
  writeFileSync(path, Buffer.from(zipSync({ 'fabric.mod.json': strToU8(JSON.stringify(meta)) })));
  return path;
}
function readJarMeta(path) {
  const raw = unzipSync(new Uint8Array(readFileSync(path)), {
    filter: (f) => f.name === 'fabric.mod.json',
  })['fabric.mod.json'];
  if (!raw) throw new Error(`${path} 里没有 fabric.mod.json`);
  return JSON.parse(strFromU8(raw));
}
/** v1 状态文件里的一条（8 个字段全给 ⇒ 归一化那一步没有东西可"补"）。 */
function legacyItem(localPath, version, sha512) {
  return {
    localPath,
    autoUpdate: true,
    localVersion: version,
    localSha512: sha512,
    lastCheckedAt: 1_700_000_000_000,
    lastUpdateAt: null,
    lastUpdateFrom: null,
    lastUpdateTo: null,
  };
}

/**
 * 上游（Modrinth）的**构造**响应：目录里是 5.8.22，上游给 5.8.26（spec §7.2 的真实形状）。
 *
 * ⚠️★ 第三条（`stub-5.9.0-beta.1`）是 2026-10-04 加的，**故意比两条 release 都新**：
 *    `upstream.channels` 的判据（"接受集里按 `date_published` 取最大"）需要一个
 *    "开关接受集就会改变答案"的形状。`mcsrranked` **没写** `channels` ⇒ 缺省只认 release
 *    ⇒ 这一条 beta 必须被忽略（⑥ 里那两条读数就是钉它的）；而下面把接受集显式打开时，
 *    它必须赢过两条 release。
 */
const UPSTREAM_VERSIONS = [
  {
    id: 'stub-5.8.22',
    version_number: '5.8.22',
    version_type: 'release',
    date_published: '2026-09-01T00:00:00Z',
    game_versions: ['1.16.1'],
    loaders: ['fabric'],
    files: [
      {
        filename: 'mcsrranked-5.8.22.jar',
        url: 'https://cdn.modrinth.com/data/I9W1u5Ac/versions/stub22/mcsrranked-5.8.22.jar',
        size: 111,
        primary: true,
        hashes: { sha1: 'a'.repeat(40), sha512: 'b'.repeat(128) },
      },
    ],
  },
  {
    id: 'stub-5.8.26',
    version_number: '5.8.26',
    version_type: 'release',
    date_published: '2026-10-01T00:00:00Z',
    game_versions: ['1.16.1'],
    loaders: ['fabric'],
    files: [
      {
        filename: 'mcsrranked-5.8.26.jar',
        url: 'https://cdn.modrinth.com/data/I9W1u5Ac/versions/stub26/mcsrranked-5.8.26.jar',
        size: 222,
        primary: true,
        hashes: { sha1: 'c'.repeat(40), sha512: 'd'.repeat(128) },
      },
    ],
  },
  {
    id: 'stub-5.9.0-beta.1',
    version_number: '5.9.0-beta.1',
    version_type: 'beta',
    date_published: '2026-10-02T00:00:00Z',
    game_versions: ['1.16.1'],
    loaders: ['fabric'],
    files: [
      {
        filename: 'mcsrranked-5.9.0-beta.1.jar',
        url: 'https://cdn.modrinth.com/data/I9W1u5Ac/versions/stubbeta/mcsrranked-5.9.0-beta.1.jar',
        size: 333,
        primary: true,
        hashes: { sha1: 'e'.repeat(40), sha512: 'f'.repeat(128) },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// 本机 HTTP 桩：只服务 `/api/mod-catalog`、`/api/file-catalog`，以及（仅写相位）下载路径
// ---------------------------------------------------------------------------
const fileCatalogBody = readFileSync(FILE_CATALOG_FILE, 'utf8');
const server = createServer((req, res) => {
  if (req.url === '/api/mod-catalog') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    // ⚠️ **现序列化**（不是开头算一次）：写路径那一支要在这之前把 release 的 url / sha512 换掉，
    //    而目录是启动时抓的 ⇒ 序列化必须晚于那次改动（`loadArtifact()` 在它之后）。
    res.end(JSON.stringify(modCatalog));
    return;
  }
  if (req.url === '/api/file-catalog') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(fileCatalogBody);
    return;
  }
  /*
   * ★ Task 5：下载路径。`downloads` 在写相位里才被填（key = 路径前缀，value = 字节）；
   *   主相位里它是空的 ⇒ 这一段的判据在主相位**不可能**被触发（桩的行为逐字不变）。
   */
  for (const [prefix, entry] of downloads) {
    if (!req.url.startsWith(prefix)) continue;
    downloadLog.push({ url: req.url, prefix });
    res.writeHead(200, {
      'content-type': 'application/java-archive',
      'content-length': String(entry.bytes.length),
    });
    if (entry.chunkDelayMs === undefined) {
      res.end(entry.bytes);
      return;
    }
    /*
     * ⚠️ 慢的那一条（入口守卫）：先回一半、停一下、再回另一半 ⇒ 第一个 updateMod 会**停在下载里**
     *   几百毫秒，第二个调用才有机会撞上 `busy`。不做成"永不回完"是因为那要额外的收尾逻辑，
     *   而这里要的只是"窗口真的存在"。
     */
    const half = Math.ceil(entry.bytes.length / 2);
    res.write(entry.bytes.subarray(0, half));
    setTimeout(() => res.end(entry.bytes.subarray(half)), entry.chunkDelayMs);
    return;
  }
  res.writeHead(404).end('no');
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const siteOrigin = `http://127.0.0.1:${String(server.address().port)}`;

/**
 * ★ Task 5：把四条 release 与三条镜像改成"指向本机桩"，并备好桩要回的字节。
 *
 * 记录下来的每一格：
 *   · `release` —— 目录里那一条（**已被就地改过**：url / sha512 / size）；
 *   · `targetName` —— `originFileNameOf(release.url)` 会给出的那个名字（落盘目标名）；
 *   · `official` —— 目录里写的 sha512/size 对应的字节（桩回的就是它）；
 *   · `served` —— 桩**实际**回的字节（`bad` 那一支故意与 `official` 不同）。
 *
 * ⚠️ 只加两条镜像（id 前缀 `probe-`）并把它们的 `hosts` 写成桩的 host：
 *    `channelUrl` 的两层判据（id 在不在表里 / host 匹不匹配）因此都真的走过一遍。
 */
function buildWriteFixture() {
  if (!WRITE) return null;
  const host = new URL(siteOrigin).host;
  /** 一条 release 的夹具：劫持 url，并把桩上的路径登记好。 */
  const hijack = (modid, mirrorId, pathName, servedExtra) => {
    const release = modCatalog.releases.find(
      (candidate) => candidate.modid === modid && candidate.targetVersions.includes('1.16.1'),
    );
    if (release === undefined) bail(`夹具前提不成立：${modid} 在 1.16.1 下没有 release`);
    const official = probeJar(modid, SERVED_JAR_VERSION);
    const served = servedExtra ? probeJar(modid, SERVED_JAR_VERSION, true) : official;
    modCatalog.mirrors.push({
      id: mirrorId,
      label: `探针桩（${mirrorId}）`,
      prefix: `${siteOrigin}/mirror-${mirrorId.replace('probe-', '')}/`,
      hosts: [host],
    });
    const name = `${pathName}.jar`;
    release.url = `${siteOrigin}/origin/${name}`;
    release.sha512 = sha512OfBuffer(official);
    release.size = official.length;
    downloads.set(`/mirror-${mirrorId.replace('probe-', '')}/`, { bytes: served });
    return { modid, release, targetName: name, official, served, mirrorId };
  };

  const bad = hijack(MOD_BAD, 'probe-bad', 'probe-bad', true);
  const good = hijack(MOD_GOOD, 'probe-good', 'probe-good-2.0.0', false);
  const busy = hijack(MOD_BUSY, 'probe-busy', 'probe-busy', false);
  /*
   * ★ Ruling 47 的两个夹具（都在**没动盘**这一侧）：
   *   · `newer`：这一行的判定必须是 `newer` ⇒ 本地那个 jar 的内部版本要**比 release 更新**
   *     而且**两边的主体都可排序**（`MOD_NEWER` 是按这条挑的，见上面那段）；
   *   · `manual`：把这条 release 的 `download` 改成 `'manual'` —— 那是"连更新按钮都不该有"的那一类
   *     （spec §8）。只动 `download` 一格，release 的条数与 `targetVersions` 都不变。
   */
  const newer = hijack(MOD_NEWER ?? '', 'probe-newer', 'probe-newer', false);
  const manual = hijack(MOD_MANUAL, 'probe-manual', 'probe-manual', false);
  manual.release.download = 'manual';
  /*
   * `slow`：**不劫持新 release** —— 它复用 `good` 那条的字节（同一个 sha512），
   * 只是路径慢一半。它要证的是"自己正在写的时候，第二次调用进不来"。
   */
  downloads.set('/mirror-slow/', { bytes: good.served, chunkDelayMs: 400 });
  modCatalog.mirrors.push({
    id: 'probe-slow',
    label: '探针桩（probe-slow）',
    prefix: `${siteOrigin}/mirror-slow/`,
    hosts: [host],
  });
  /*
   * 路径穿越那一条：URL 里 `%2F` 解出来是 `/`（`pathname` 上看到的是编码过的形式，
   * 很容易漏）⇒ `originFileNameOf` 必须给 `null`，而**一个请求都不该发出去**。
   */
  const trav = modCatalog.releases.find(
    (candidate) => candidate.modid === MOD_TRAV && candidate.targetVersions.includes('1.16.1'),
  );
  if (trav === undefined) bail(`夹具前提不成立：${MOD_TRAV} 在 1.16.1 下没有 release`);
  trav.url = 'https://github.com/x/..%2F..%2Fevil.jar';
  trav.sha512 = sha512OfBuffer(probeJar(MOD_TRAV, SERVED_JAR_VERSION));
  trav.size = 1;
  return {
    bad,
    good,
    busy,
    newer,
    manual,
    trav: { modid: MOD_TRAV, release: trav, mirrorId: 'probe-trav' },
  };
}
const writeFixture = buildWriteFixture();
if (WRITE) {
  const names = [writeFixture.bad, writeFixture.good, writeFixture.busy].map(
    (entry) => `${entry.modid}→${entry.mirrorId}（目标名 ${entry.targetName}）`,
  );
  console.log(`  写相位的劫持夹具：${names.join('；')}`);
  console.log(
    `  Ruling 47 的夹具：newer=${writeFixture.newer.modid}（release ${writeFixture.newer.release.version}）；manual=${writeFixture.manual.modid}（download 改成 manual）`,
  );
  console.log(`  穿越那一条：${writeFixture.trav.modid} → ${writeFixture.trav.release.url}`);
}

/**
 * fetch 钩子：本地桩放行；`api.modrinth.com` 按 `upstreamMode` 就地喂夹具；
 * **其余一律拒绝**（这就是"离线"这条判据本身，而不是"希望它不联网"）。
 */
const realFetch = globalThis.fetch;
let upstreamMode = 'fail';
let upstreamRequests = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : String(input?.url ?? input);
  if (url.startsWith(siteOrigin)) return realFetch(input, init);
  if (url.startsWith('https://api.modrinth.com/v2/project/')) {
    upstreamRequests += 1;
    if (upstreamMode === 'fail') throw new Error('探针构造：上游不可达');
    return new Response(JSON.stringify(UPSTREAM_VERSIONS), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  throw new Error(`探针：拒绝访问网络（离线构造）：${url}`);
};

/** 加载产物（`require('electron')` 换成桩）。 */
function loadArtifact() {
  process.env.VITE_DEV_SERVER_URL = siteOrigin;
  const Module = require('node:module');
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, ...rest);
  };
  require(MAIN_CJS);
}

/** 等 13 条 invoke 通道注册好（14 个成员里 `onStatus` 是推送、没有 handler）。 */
async function waitForHandlers() {
  const expected = Object.values(MOD_CH).filter((name) => name !== MOD_CH.onStatus);
  for (let i = 0; i < 240; i += 1) {
    if (expected.every((name) => handlers.has(name))) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}
const invoke = (channel, ...args) => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`没有注册这条通道：${channel}`);
  return fn({}, ...args);
};
const stateFile = () => join(currentUserDataDir, 'file-tracking.json');
const readStateFileJson = () =>
  existsSync(stateFile()) ? JSON.parse(readFileSync(stateFile(), 'utf8')) : null;
const folderByPath = (state, path) =>
  state.folders.find((f) => resolve(f.path).toLowerCase() === resolve(path).toLowerCase());

// ===========================================================================
// 相位一：主相位（读路径）
// ===========================================================================
async function mainPhase() {
  const workRoot = mkdtempSync(join(tmpdir(), 'verify-mod-folders-'));
  currentUserDataDir = join(workRoot, 'userData');
  mkdirSync(currentUserDataDir, { recursive: true });

  // ---- 夹具目录 ----------------------------------------------------------
  const modsDir = join(workRoot, 'A-mods');
  mkdirSync(modsDir, { recursive: true });
  const jarOld = makeJar(join(modsDir, 'a-1.0.jar'), { id: ANTIGONE, version: '1.0' });
  const jarNew = makeJar(join(modsDir, 'a-2.0.jar'), { id: ANTIGONE, version: '2.0' });

  const outsideDir = join(workRoot, 'B-outside');
  mkdirSync(outsideDir, { recursive: true });
  const legacyJar = makeJar(join(outsideDir, 'legacy.jar'), { id: ANTIGONE, version: '1.5' });

  const wrongDir = join(workRoot, 'C-wrong');
  mkdirSync(wrongDir, { recursive: true });
  const foreignJar = makeJar(join(wrongDir, 'foreign.jar'), { id: 'lithium', version: '9.9' });

  const bindDir = join(workRoot, 'D-bind');
  mkdirSync(bindDir, { recursive: true });
  const bindJar = makeJar(join(bindDir, 'antigone-1.16.1-2.0.0.jar'), {
    id: ANTIGONE,
    version: '2.0.0',
  });

  // `.minecraft` 那份布局：mods 目录与 mmc-pack.json 之间隔两层（≤ 4 层）
  const instanceDir = join(workRoot, '.minecraft', 'instances', 'demo');
  const instanceMods = join(instanceDir, 'mods');
  mkdirSync(instanceMods, { recursive: true });
  writeFileSync(
    join(instanceDir, 'mmc-pack.json'),
    JSON.stringify({
      components: [
        { uid: 'net.fabricmc.fabric-loader', version: '0.15.11' },
        { uid: 'net.minecraft', version: '1.16.1' },
      ],
    }),
  );

  const goneDir = join(workRoot, 'E-gone');
  mkdirSync(goneDir, { recursive: true });

  /*
   * **F-pre（判修 1 / Ruling 34）**：一个**在启动之前就已经绑好**、而且 `autoUpdate: false`
   * 的文件夹，里面放一份真 jar。它是"漏扫的文件夹"唯一的构造方式：
   * 启动那一路只扫开着开关的文件夹 ⇒ 这一个在启动后**没有读数**，
   * 而它正是"缺失清单会不会被污染"那两条判据的夹具。
   * ⚠️ jar 里那个 modid 要**在目录里**、在 1.16.1 下有**唯一**一条候选
   *    （缺失清单只列唯一候选的行），并且与 A-mods 里的 `antigone` **不同** ——
   *    否则"它被算成已跟踪"这件事分不清是哪个文件夹贡献的。
   */
  const preDir = join(workRoot, 'F-pre');
  mkdirSync(preDir, { recursive: true });
  // `trackedInPre` 在文件头上算（Task 5 提到那里：写路径的夹具要避开它）
  const preJar = makeJar(join(preDir, `${trackedInPre}-1.16.1.jar`), {
    id: trackedInPre,
    version: '1.0.0',
  });

  console.log(`  夹具目录：${workRoot}`);
  console.log(`  A-mods：${listing(modsDir)}`);
  console.log(`  F-pre（预绑定、autoUpdate=false）：${listing(preDir)}`);
  console.log(`  .minecraft/instances/demo：${listing(instanceDir)}`);

  // ---- 预置状态文件（必须在 require 产物**之前**）-------------------------
  /*
   * 两条 v1 绑定要两个**不同的键**，而仓库里那份 `content/file-catalog.json` 只有
   * **一条** item（现读：`items.length === 1`，id = `mcsrranked`）⇒ 第二条用一个合成键。
   * 这是合法的：`readStateFile()` 保留 `items` 里所有键（不按目录剪枝），
   * 而这一条要验的正是"归属只是多写一份 catalogBindings、items 里一个字段都不许动"。
   *
   * ⚠️ 这一份是 **v2**（`stateVersion: 2` + 三格齐全）—— 判修 1 需要在启动**之前**
   *    就有一个 `autoUpdate: false` 的已绑定文件夹，而 `folders` 只有 v2 才有。
   *    v1 那份 `items` 照旧写在里面（§13.1 与归属那两条判据要的就是它）。
   */
  const insideId = fileCatalog.items[0].id;
  const outsideId = `${insideId}-legacy`;
  if (fileCatalog.items.length === 0) bail(`${FILE_CATALOG_FILE} 里一条 item 都没有，构造不出夹具`);
  /*
   * ⚠️ Ruling 38 那一段要**真的调一次 v1 的 `bind`** 才能让它写盘，而 v1 的 `bind()`
   *    自己会校验 jar 里的 modid 与目录条目一致（`meta.id !== item.source.modId` ⇒ 拒）
   *    ⇒ 那份夹具必须是**那个 modid** 的 jar（拿 `a-2.0.jar` 去喂会被 v1 正当拒绝，
   *    而"拒绝了所以没写盘"看起来正好像"写盘没抹掉东西"—— 那是一条恒真的读数）。
   */
  const v1Dir = join(workRoot, 'G-v1');
  mkdirSync(v1Dir, { recursive: true });
  const v1Jar = makeJar(join(v1Dir, 'mcsrranked-5.8.26.jar'), {
    id: fileCatalog.items[0].source.modId,
    version: '5.8.26',
  });
  const seeded = {
    version: 1,
    stateVersion: 2,
    items: {
      [insideId]: legacyItem(jarNew, '2.0', sha512Of(jarNew)),
      [outsideId]: legacyItem(legacyJar, '1.5', sha512Of(legacyJar)),
    },
    catalogBindings: {},
    folders: {
      'pre-folder': {
        path: preDir,
        gameVersion: null,
        autoUpdate: false,
        boundAt: 1,
      },
    },
    prefs: {
      bulkChannel: 'origin',
      catalogGameVersion: '1.16.1',
      catalogGameVersionChosen: false,
      tagFilter: [],
    },
  };
  writeFileSync(stateFile(), JSON.stringify(seeded, null, 2), 'utf8');
  console.log(
    `  预置 v2 状态文件：items = ${insideId}（落在 A-mods 内）/ ${outsideId}（在 A-mods 外）；` +
      `folders = pre-folder（F-pre，autoUpdate=false）`,
  );

  loadArtifact();
  const registered = await waitForHandlers();

  // =========================================================================
  await section('① 十三条 invoke 通道都注册了（红的形态：一条都没有）', async () => {
    const expected = Object.values(MOD_CH).filter((name) => name !== MOD_CH.onStatus);
    const missing = expected.filter((name) => !handlers.has(name));
    check(
      `ipcMain.handle 注册了 13 条 mcsr:modfolders-*（14 个成员里 onStatus 是推送、不算）`,
      registered && missing.length === 0,
      missing.length === 0
        ? `handlers 共 ${String(handlers.size)} 条`
        : `缺 ${String(missing.length)} 条：${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ' …' : ''}；main.cjs 里命中 ${String(mainCounts.present)}/${String(MOD_CH_COUNT)}（preload.cjs ${String(preloadCounts ? preloadCounts.present : '?')}/${String(MOD_CH_COUNT)}）`,
    );
  });

  // =========================================================================
  /*
   * ★★ spec §9.15（A 的 T6）：**删掉的那三条通道不再注册** —— 这是"删干净了"的读数。
   *
   * ⚠️★ 为什么要单独一节、而不是"注册数从 16 变成 13 就够了"：那是一个**差**，
   *    而"差"说不出**哪三条**没了 —— 少注册一条别的通道、或者契约里换了一条，
   *    读数一样。⇒ 这里钉的是**那三个具体的串**：`bindCatalogRow` / `unbindCatalogRow` /
   *    `updateCatalogRow`（第一部分那一行的绑定与写盘，裁决 B：契约 17 → 14）。
   * ⚠️ 判据**两条独立**的读数（§5.38：一个 0 要有第二条读数印证）：
   *    ① **契约表**里没有那三个键（源码现读的 `MOD_CH`）；
   *    ② **两个产物**里连那三个**通道串**都一次都不出现（ASCII 锚点，与编码无关）——
   *       契约删了但 preload/主进程留着转发时，这一条会红（那正是"删了一半"的形状）。
   * ⚠️ 三条旧串是**手抄**的（它们已经从树里消失了，没有现数的地方）—— 抄错一个字母
   *    会让这一条**永远绿**。⇒ 下面那条"三个键都不在 `MOD_CH` 里"是它的对照：
   *    抄错的串仍然会被"产物里 0 次"满足，但"键不在表里"那一条是按**键名**判的（现读）。
   * ⚠️★ 位置（T6 判修）：这一节排在"通道都注册了"那条 `if (!registered) return` **之前** ——
   *    否则"加回一条通道"时它会**整节跳过**，读数只有"缺一条 handler"（实测过：K7 那把刀
   *    第一次跑出来的正是这个形状）。这一节的判据本来就不依赖 handler 注册（第 ④ 条
   *    `handlers.has(...)` 读的是注册表**没有**那三个名字，缺别的 handler 不影响它）。
   */
  const REMOVED_CHANNELS = [
    'bindCatalogRow',
    'unbindCatalogRow',
    'updateCatalogRow',
  ];
  const REMOVED_CHANNEL_STRINGS = [
    'mcsr:modfolders-bind-catalog-row',
    'mcsr:modfolders-unbind-catalog-row',
    'mcsr:modfolders-update-catalog-row',
  ];
  await section('★★ A 的 T6（spec §9.15）：删掉的三条通道**不再注册**、产物里也没有它们', async () => {
    check(
      `契约表里没有那三个键（现读 MOD_FOLDERS_CHANNELS 共 ${String(MOD_CH_COUNT)} 条；删之前是 17）`,
      REMOVED_CHANNELS.every((key) => !(key in MOD_CH)),
      `表里的键：${Object.keys(MOD_CH).join(', ')}`,
    );
    check(
      '那三条**旧通道串**在 main.cjs 里一次都不出现（删了一半的形状在这里红）',
      REMOVED_CHANNEL_STRINGS.every((name) => !readFileSync(MAIN_CJS, 'utf8').includes(name)),
      REMOVED_CHANNEL_STRINGS.map(
        (name) => `${name}: ${String(readFileSync(MAIN_CJS, 'utf8').split(name).length - 1)} 次`,
      ).join('；'),
    );
    check(
      'preload.cjs 里也没有（转发与契约必须一起删）',
      preloadCounts !== null &&
        REMOVED_CHANNEL_STRINGS.every((name) => !readFileSync(PRELOAD_CJS, 'utf8').includes(name)),
      preloadCounts === null
        ? '（没有 preload.cjs —— 这一条没跑起来）'
        : REMOVED_CHANNEL_STRINGS.map(
            (name) => `${name}: ${String(readFileSync(PRELOAD_CJS, 'utf8').split(name).length - 1)} 次`,
          ).join('；'),
    );
    check(
      '主进程注册表里也没有（`ipcMain.handle` 那一侧现读）',
      REMOVED_CHANNEL_STRINGS.every((name) => !handlers.has(name)),
      `handlers 共 ${String(handlers.size)} 条`,
    );
  });

  /*
   * ⚠️ 这一条闸（"通道都注册了"）排在 §9.15 **之后**：§9.15 问的是"删掉的那三条不在"，
   *    它不依赖别的 handler；而这一条之后的所有判据都要走 `invoke` ⇒ 必须挡在这里。
   */
  if (!registered) {
    console.log('  ⇒ 后面那些判据全都要走 invoke，跳过。');
    return { workRoot, ok: false };
  }

  // =========================================================================
  let folderId = '';
  let state = null;
  await section('② bindFolder：A-mods 的两份 antigone 副本 ⇒ 一行、主文件是新那份', async () => {
    openQueue = [{ canceled: false, filePaths: [modsDir] }];
    state = await invoke(MOD_CH.bindFolder);
    const picked = dialogCalls.filter((c) => c.kind === 'open').at(-1);
    check(
      '弹的是**原生目录**对话框（路径只能由主进程产生，渲染进程给不了）',
      picked?.options?.properties?.includes('openDirectory') === true,
      JSON.stringify(picked?.options?.properties ?? null),
    );
    const folder = folderByPath(state, modsDir);
    check('状态里有这个文件夹', folder !== undefined, folder?.folderId ?? '（没有）');
    if (!folder) return;
    folderId = folder.folderId;
    check(
      '该文件夹只有一行（同一个 modid 的两份副本合成一行）',
      folder.rows.length === 1,
      `rows = ${folder.rows.map((r) => r.modid).join(',') || '（空）'}`,
    );
    const row = folder.rows[0];
    check('那一行是 antigone', row?.modid === ANTIGONE, row?.modid ?? '（没有行）');
    check(
      '本机版本读自 jar（主文件 = a-2.0.jar，版本 2.0）',
      row?.fileName === 'a-2.0.jar' && row?.localVersion === '2.0',
      `${String(row?.fileName)} / ${String(row?.localVersion)}`,
    );
    check(
      '旧副本 = [a-1.0.jar]（更新时要清掉的那一份）',
      Array.isArray(row?.oldCopies) && row.oldCopies.length === 1 && row.oldCopies[0] === 'a-1.0.jar',
      JSON.stringify(row?.oldCopies ?? null),
    );
    check(
      '路径里没有 .minecraft ⇒ 推断不出游戏版本，该文件夹的 gameVersion 是 null（不是猜一个）',
      folder.gameVersion === null,
      String(folder.gameVersion),
    );
  });
  if (folderId === '') return { workRoot, ok: false };

  // =========================================================================
  /*
   * ★ A 的 S2（spec D7 / §9.14）：`openFolder` —— **入参只有 id，路径只能来自主进程的状态**。
   *
   * 为什么**两半**都要（spec §9.14 就是两句：合法 id ⇒ 用**该文件夹的路径**调
   *   `shell.openPath`；未知 id ⇒ 拒且**不调用**）：
   *   · 只有"未知 id ⇒ 不调用"那一半时，一个"把入参直接当路径"的坏实现**也可能是绿的**
   *     （`'no-such-folder-id'` 被当成一个路径打开了 —— 那正是刀 ① 要红的形态）；
   *   · 只有"合法 id ⇒ 调用了"那一半时，参数是什么分不清（"打开了一个路径"与
   *     "打开了**这个**路径"是两件事）。
   * ★ 决定性的一句是**参数本身**：这个 folderId 是主进程 `folderIdOf(path)` 生成的 uuid，
   *   与路径毫无字面关系 ⇒ `openPath` 收到 `modsDir` 这件事**只能**来自主进程那份状态。
   * ⚠️ 未知 id 那一条**必须是"拒"**（抛；与 `unbindFolder` 对不存在的 folderId 同一条 ——
   *   `requireFolder` 是这一组入参收窄的唯一入口），而且判据钉的是**那句文案**而不是"抛了"：
   *   "这条通道压根没注册"同样满足"抛了"，而那是一条恒真的假绿（§5.32 ①）。
   */
  await section('★ A（spec §9.14）：openFolder —— id 进、路径从主进程的状态出', async () => {
    /*
     * 两条**静态**读数（通道表 + 产物）住在这一层而不是文件头上那一段：
     * 文件头那一段在每个相位都会跑一遍（主相位 + state-file ×3 + prefs ×3 + write ×1 = 8 遍），
     * 而 `check()` 是全局计数、`failures !== 0` 会让**每个子进程**都以 1 退出
     * ⇒ 一条红的通道判据会连坐出 8 条假的"（子进程）…成立"红。实测过那一次：64 ✗ / 274 ✓。
     */
    check(
      'A：openFolder 在通道表里（分母**现数**：下面那条读数会打印表里共几条；A 的 T6 之后是 14）',
      'openFolder' in MOD_CH,
      `${String(MOD_CH.openFolder ?? '（没有这一条）')}；表里共 ${String(MOD_CH_COUNT)} 条`,
    );
    const openFolderCount = countChannels(MAIN_CJS, { openFolder: MOD_CH.openFolder });
    check(
      'A：main.cjs 注册了 openFolder（产物里命中那个串）',
      openFolderCount !== null && openFolderCount.present >= 1,
      `命中 ${String(openFolderCount?.present ?? '（没有产物）')}；期望通道名 ${String(MOD_CH.openFolder)}`,
    );
    openCalls.length = 0;
    let opened = null;
    try {
      opened = await invoke(MOD_CH.openFolder, folderId);
    } catch (error) {
      opened = error;
    }
    check(
      '★ 合法 id ⇒ 用**该文件夹的路径**调 shell.openPath（而参数是 id，不是路径）',
      opened?.ok === true &&
        openCalls.length === 1 &&
        resolve(String(openCalls[0])).toLowerCase() === resolve(modsDir).toLowerCase(),
      `返回值 ${JSON.stringify(opened ?? null)}；openPath 收到 ${JSON.stringify(openCalls)}；期望 ${modsDir}`,
    );
    openCalls.length = 0;
    let unknownRefused = null;
    try {
      await invoke(MOD_CH.openFolder, 'no-such-folder-id');
    } catch (error) {
      unknownRefused = error;
    }
    check(
      'A：openFolder 未知 id ⇒ 拒且**一个 openPath 都没调**（同一个状态里查不到就不猜）',
      openCalls.length === 0 &&
        typeof unknownRefused?.message === 'string' &&
        unknownRefused.message.includes('状态里没有这个文件夹'),
      `${unknownRefused?.message ?? '（没有抛）'}；openPath 收到 ${JSON.stringify(openCalls)}`,
    );
  });

  // =========================================================================
  /*
   * ★ **判修 1 / Ruling 34**（2026-10-03 复审）：一个**没扫过**的已绑定文件夹
   *   不许污染底部缺失清单。实测过的那把刀：`autoUpdate: false` 的文件夹启动后不扫，
   *   而 `trackedModids` 从"文件夹行"推 ⇒ `missing` 会把整个 1.16.1 目录（48 行）列出来。
   *   两半都要判：**补扫**（页面第一次要状态时）与**没读数就不许下结论**（清单空着 + 说明）。
   */
  await section('★ 判修 1 / Ruling 34：没扫过的文件夹不许污染缺失清单（含 getState 补扫）', async () => {
    const preView = () =>
      state.folders.find((f) => resolve(f.path).toLowerCase() === resolve(preDir).toLowerCase());
    const pre = preView();
    check(
      `（前置）预绑定的 F-pre 在状态里、而且**启动这一趟没扫它**（autoUpdate=false ⇒ 0 行）`,
      pre !== undefined && pre.autoUpdate === false && pre.rows.length === 0,
      pre === undefined ? '（没有这个文件夹）' : `autoUpdate=${String(pre.autoUpdate)} rows=${String(pre.rows.length)}`,
    );
    check(
      `还没有读数的文件夹 ⇒ 缺失清单**空着**（不许把整个目录列成"你缺这些"）`,
      state.missing.length === 0,
      `missing = ${String(state.missing.length)} 条`,
    );
    /*
     * ★★ **Ruling 65**（2026-10-03 T8 评审）：`rows` 空有两种原因（"扫过、里面没有" /
     *    "**这一次没读到**"）⇒ 状态里必须另有一格说出来。这里锚的是"未扫"那一侧，
     *    下一秒 `getState()` 补扫之后那颗读数要跟着翻（这一格不是恒值）。
     */
    check(
      `★ Ruling 65：这一格说出"我们还没读到过它"（hasReading === false）`,
      pre !== undefined && pre.hasReading === false,
      pre === undefined ? '（没有这个文件夹）' : `hasReading=${String(pre.hasReading)}`,
    );
    /*
     * ★ **判修 2**：`missing: []` 有两种原因（"真的不缺" / "还不知道"）⇒ 结构化标出来，
     *   界面只在 `'ok'` 时显示清单。这里锚的是"未扫"那一支。
     */
    check(
      `★ 而且状态里**结构化地**说出了原因：missingStatus === 'folder-unscanned'（不是 'ok'）`,
      state.missingStatus === 'folder-unscanned',
      `missingStatus=${String(state.missingStatus)}`,
    );
    check(
      `而且**说出来**（notices 里有一条讲清缺失清单为什么空着）`,
      state.notices.some((note) => note.includes('没有扫描读数')),
      JSON.stringify(state.notices),
    );

    const before = preView()?.rows.length ?? -1;
    state = await invoke(MOD_CH.getState);
    const after = preView();
    check(
      `第一次 getState 把该扫的扫掉（补扫：${String(before)} 行 → ${String(after?.rows.length ?? -1)} 行）`,
      after !== undefined && after.rows.length === 1 && after.rows[0].modid === trackedInPre,
      after === undefined ? '（没有这个文件夹）' : JSON.stringify(after.rows.map((r) => r.modid)),
    );
    check(
      `扫完之后缺失清单是**真的**那一份：条数 = 1.16.1 下唯一候选的 mod 数（${String(oneRelease1161.length)}）− 已跟踪的 2 个`,
      state.missing.length === oneRelease1161.length - 2,
      `missing = ${String(state.missing.length)} 条（期望 ${String(oneRelease1161.length - 2)}）`,
    );
    check(
      `★ 同一格跟着读数翻过来了：扫过之后 hasReading === true`,
      after?.hasReading === true,
      `hasReading=${String(after?.hasReading)}`,
    );
    /*
     * ★★ **Critical + Ruling 62②**（2026-10-03 T8 评审）：清单每一行都带着
     *    `release`（**主进程会装的那一条**）与 `manual`（界面据此决定给不给下载按钮）。
     *    判据分三层，缺一层就有一条坏法没人喊：
     *      ① 形状：每一行的 `release` 都属于**这一行**（modid 与游戏版本都对得上）；
     *      ② 一致性：`manual ⇔ release.download === 'manual'`（同一个 `isManualTarget`）；
     *      ③ **正面样本**：手动那半条判据在 1.16.1 下是空集（实测那个版本下**没有**
     *         manual 的单候选 mod）⇒ 下面换到 1.12.2 去锚它，否则 ② 是空集上的恒真
     *         （§5.32 的第一类）。
     *    ⚠️ ① 用的是"属于这一行"而不是"等于目录里那条"：`mcsrranked` 的目标可能来自
     *       **上游**（本探针的上游桩就是 5.8.26）⇒ 拿目录那条去比会在正确的实现上红。
     */
    const singleCandidateAt = (version) =>
      modCatalog.mods
        .map((mod) => mod.modid)
        .filter(
          (modid) =>
            modCatalog.releases.filter(
              (release) => release.modid === modid && release.targetVersions.includes(version),
            ).length === 1,
        );
    const releaseAt = (modid, version) =>
      modCatalog.releases.find(
        (release) => release.modid === modid && release.targetVersions.includes(version),
      );
    check(
      `★ 每一行的 release 都属于**这一行**（modid 一样、targetVersions 含这个游戏版本）`,
      state.missing.every(
        (m) => m.release?.modid === m.modid && m.release?.targetVersions.includes(m.gameVersion),
      ),
      JSON.stringify(
        state.missing
          .filter(
            (m) => m.release?.modid !== m.modid || !m.release?.targetVersions.includes(m.gameVersion),
          )
          .map((m) => m.modid)
          .slice(0, 3),
      ),
    );
    check(
      `★★ 每一行的 manual 与 release.download 是一致的（manual ⇔ download === 'manual'）`,
      state.missing.every((m) => (m.release?.download === 'manual') === m.manual),
      JSON.stringify(
        state.missing
          .filter((m) => (m.release?.download === 'manual') !== m.manual)
          .map((m) => m.modid)
          .slice(0, 3),
      ),
    );
    /*
     * ★★ 正面样本：换到一个**真有 manual 单候选**的游戏版本（实测 `optifine|1.12.2`），
     *    否则上面那两条是在空集上成立的。⚠️ 探针**当场把版本改回 1.16.1** ——
     *    后面的小节全都按它算（那两格读数各钉一条）。
     */
    state = await invoke(MOD_CH.setCatalogGameVersion, '1.12.2');
    const manualAt1122 = singleCandidateAt('1.12.2').filter(
      (modid) => releaseAt(modid, '1.12.2')?.download === 'manual',
    );
    const manualRows = state.missing.filter((m) => m.manual);
    check(
      `（前置）1.12.2 下真的有 manual 的单候选 mod（${manualAt1122.join(', ') || '（一个都没有）'}）`,
      manualAt1122.length > 0,
      `目录里那些 = ${String(manualAt1122.length)} 条`,
    );
    check(
      `★★ 换到 1.12.2 之后缺失清单里**真的有 manual 的行**（${manualRows.map((m) => m.modid).join(', ') || '（一条都没有）'}）`,
      manualRows.length === manualAt1122.length && manualRows.length > 0,
      `manual 行数 = ${String(manualRows.length)}（期望 ${String(manualAt1122.length)}）`,
    );
    check(
      `★★ 而那些行的 release 都是那条 **manual** 的（界面据此不给下载按钮）`,
      manualRows.every((m) => m.release.download === 'manual'),
      JSON.stringify(manualRows.map((m) => `${m.modid}:${m.release.version}:${m.release.download}`).slice(0, 4)),
    );
    state = await invoke(MOD_CH.setCatalogGameVersion, '1.16.1');
    check(
      `（收尾）版本改回 1.16.1（下面的小节全都按它算）`,
      state.gameVersion === '1.16.1' && state.missing.length === oneRelease1161.length - 2,
      `gameVersion=${String(state.gameVersion)} missing=${String(state.missing.length)} 条`,
    );
    check(
      `★ 全部扫到之后 missingStatus 才是 'ok'（界面据此才显示清单）`,
      state.missingStatus === 'ok',
      `missingStatus=${String(state.missingStatus)}`,
    );
    check(
      `（前置）它确实 > 0 ⇒ 下面那条"不在里面"不是空集上的恒真`,
      state.missing.length > 0,
      `missing = ${String(state.missing.length)} 条`,
    );
    check(
      `两个**真的在**文件夹里的 modid 都不在缺失清单里（${ANTIGONE} 在 A-mods、${trackedInPre} 在 F-pre）`,
      !state.missing.some((m) => m.modid === ANTIGONE) &&
        !state.missing.some((m) => m.modid === trackedInPre),
      JSON.stringify(state.missing.filter((m) => m.modid === ANTIGONE || m.modid === trackedInPre)),
    );
  });

  // =========================================================================
  await section('③ §13.1：落在新绑定文件夹里的 v1 绑定被解除，并如实报告', async () => {
    const onDisk = readStateFileJson();
    check(
      `v1 的 items 里那条（${insideId}，文件在 A-mods 内）已经没了`,
      onDisk?.items?.[insideId] === undefined,
      JSON.stringify(onDisk?.items?.[insideId] ?? null),
    );
    /*
     * ★ v1 的 `items` **不许被剪枝 / 改写**（T6 从删掉的 §④ 里搬过来的那一半：
     *   那一条原来挂在"多写一份到 `catalogBindings`"上，而"v1 的字段一个都不许动"
     *   与 `catalogBindings` 无关 —— 它是 spec §2.2"v1 的管道留着"的读数，不能跟着删）。
     */
    const kept = onDisk?.items?.[outsideId];
    check(
      `v1 的 items 里那条（${outsideId}，在 A-mods 外）**逐字段仍在**（本模块绝不改写它）`,
      kept !== undefined &&
        Object.keys(kept).length === 8 &&
        Object.entries(seeded.items[outsideId]).every(([k, v]) => kept[k] === v),
      kept === undefined
        ? '（不见了）'
        : `${String(Object.keys(kept).length)} 个字段：${Object.keys(kept).join(',')}`,
    );
    check(
      'notices 里有「已转为文件夹跟踪：Antigone」（不许静默）',
      (state?.notices ?? []).includes('已转为文件夹跟踪：Antigone'),
      JSON.stringify(state?.notices ?? []),
    );
    /*
     * ⚠️★ T6 删掉了这一组原来的第二条（"catalogBindings 里也没有它"）：那一格整个退役了
     *    （D8 / 裁决 B）⇒ 它恒为空表，断言"旧那一条不在里面"是一条**恒真**的守卫
     *    （§5.32①）。**读到就忽略**这件事现在由下面两条独立的读数钉住：
     *      · 契约层：`MOD_FOLDERS_CHANNELS` 里没有那三个键（spec §9.15 那一节）；
     *      · 状态文件层：state-file 相位里"预置了旧数据的 `catalogBindings` 干净地活过启动"
     *        （那个相位的 case c）。
     */
  });

  // =========================================================================
  /*
   * ⚠️★ T6 删掉了这里的一整节（原 §④「归属：文件夹**外面**那条 v1 绑定多写一份到
   *    `catalogBindings`」）：那件事的实现（`attributeLegacyItems`）随 `catalogBindings`
   *    一起删了（D8 / 裁决 B）—— **归属不再有落点**。
   *    ⚠️ 代价（认，写在 `mod-folders.ts` 的 `bindFolder` 上）：v1 的 `items` 里那些
   *    **不在任何已绑定文件夹里**的单文件绑定，从今往后没有人接手（它们仍在文件里、
   *    仍归 v1 那九条通道管）。下面 §③ 那一半（**落在新绑定文件夹里**的 ⇒ 解绑）
   *    一个字都没动，它才是 §13.1 的落地。
   */

  // =========================================================================
  await section('⑤ resolveGameVersion：.minecraft 实例里推断得出，普通目录推断不出', async () => {
    openQueue = [{ canceled: false, filePaths: [instanceMods] }];
    state = await invoke(MOD_CH.bindFolder);
    const folder = folderByPath(state, instanceMods);
    check(
      '往上 3 层有 mmc-pack.json 且路径里有 .minecraft ⇒ gameVersion = 1.16.1',
      folder?.gameVersion === '1.16.1',
      String(folder?.gameVersion ?? '（没有这个文件夹）'),
    );
    check(
      'A-mods（路径里没有 .minecraft）仍然是 null ⇒ 上面那条不是"永远给 1.16.1"',
      folderByPath(state, modsDir)?.gameVersion === null,
      String(folderByPath(state, modsDir)?.gameVersion),
    );
    check(
      '这个空文件夹在状态里（绑定的文件夹哪怕一行都没有也留着）',
      folder !== undefined && folder.rows.length === 0,
      folder === undefined ? '（没有）' : `rows ${String(folder.rows.length)}`,
    );
  });

  // =========================================================================
  await section('⑥ 上游解析：抓不到就不传（退回目录那条），抓得到就传', async () => {
    const rowOf = (s) => s.catalogRows.find((r) => r.rowId === `${MCSRRANKED}|1.16.1`);
    check(
      '（前置）第一部分的游戏版本是 1.16.1、这一行在',
      state.gameVersion === '1.16.1' && rowOf(state) !== undefined,
      `${state.gameVersion} / ${rowOf(state)?.rowId ?? '（没有）'}`,
    );
    check(
      `上游不可达 ⇒ 目标退回目录那条（${MCSRRANKED} 5.8.22、来源 catalog）`,
      rowOf(state)?.official?.version === '5.8.22' && rowOf(state)?.targetSource === 'catalog',
      `${String(rowOf(state)?.official?.version)} / ${String(rowOf(state)?.targetSource)}（上游请求 ${String(upstreamRequests)} 次）`,
    );
    upstreamMode = 'ok';
    state = await invoke(MOD_CH.rescan);
    const row = rowOf(state);
    check(
      '上游可达（就地喂夹具 5.8.26）⇒ 目标换成上游那条、targetSource = upstream',
      row?.official?.version === '5.8.26' && row?.targetSource === 'upstream',
      `${String(row?.official?.version)} / ${String(row?.targetSource)}`,
    );
    check(
      'candidates 仍然只来自目录（上游只改目标，不动候选）',
      row?.candidates.length === 1 && row.candidates[0].version === '5.8.22',
      JSON.stringify((row?.candidates ?? []).map((c) => c.version)),
    );
    check(
      '上游那条的主文件也带过来了（url 指向夹具里那个文件名）',
      row?.official?.url.includes('mcsrranked-5.8.26.jar') === true,
      String(row?.official?.url),
    );
    /*
     * ★★ `upstream.channels`（2026-10-04 加的）：一条 upstream 可以**接受多于一个发布通道**。
     *
     * 为什么这三条要在这里（而不是只在上游那个纯函数的单元测试里）：
     *   单元测试证明的是**规则**，而这里证明的是**产物真的按那条规则走** ——
     *   桌面端读的是线上目录里的 `upstream.channels`，中间还隔着"生成器有没有把它带进目录"
     *   这一跳。夹具里那条 `5.9.0-beta.1` **比两条 release 都新**，所以：
     *     · `mcsrranked` 没写 `channels`（缺省只认 release）⇒ 上面那条 5.8.26 的读数
     *       **同时**证明了 beta 没有参与（一个"不筛通道"的实现会在那里挑到 beta ⇒ 红）；
     *     · 把接受集显式打开 ⇒ 更新的 beta 必须赢；收回 ⇒ 退回 release。
     *   ⚠️ 这一段改的是**桩目录里的那一条**（`modCatalog` 是内存对象，`/api/mod-catalog`
     *      每次请求现序列化）⇒ `rescan` 之后产品读到的就是新接受集。跑完**必须收回**，
     *      后面几段依赖"目标 = 5.8.26"。
     */
    const rankedEntry = modCatalog.mods.find((m) => m.modid === MCSRRANKED);
    if (rankedEntry === undefined || rankedEntry.upstream === undefined) {
      bail(`夹具前提不成立：${MOD_CATALOG_FILE} 里 ${MCSRRANKED} 没有 upstream（⑥ 的接受集那一段要用它）`);
    }
    const betaFixture = UPSTREAM_VERSIONS.find((v) => v.version_type === 'beta');
    check(
      '（前置）夹具里那条 beta 比最新的 release 更新 —— 否则下面两条分不出东西',
      betaFixture !== undefined &&
        Date.parse(betaFixture.date_published) > Date.parse('2026-10-01T00:00:00Z'),
      `${betaFixture?.version_number ?? '（没有 beta）'} ${betaFixture?.date_published ?? ''}`,
    );
    check(
      '缺省（没写 channels）= 只认 release ⇒ 更新的 beta **不**参与（目标仍是 5.8.26）',
      rankedEntry.upstream.channels === undefined && rowOf(state)?.official?.version === '5.8.26',
      `channels=${JSON.stringify(rankedEntry.upstream.channels)} / 目标 ${String(rowOf(state)?.official?.version)}`,
    );
    rankedEntry.upstream.channels = ['release', 'beta'];
    state = await invoke(MOD_CH.rescan);
    check(
      '接受集写成 ["release","beta"] ⇒ 更新的 beta 当目标',
      rowOf(state)?.official?.version === '5.9.0-beta.1' &&
        rowOf(state)?.targetSource === 'upstream' &&
        rowOf(state)?.official?.url.includes('mcsrranked-5.9.0-beta.1.jar') === true,
      `${String(rowOf(state)?.official?.version)} / ${String(rowOf(state)?.targetSource)}`,
    );
    delete rankedEntry.upstream.channels;
    state = await invoke(MOD_CH.rescan);
    check(
      '收回 channels ⇒ 退回 release（5.8.26）—— 上面那条不是"beta 永远赢"',
      rowOf(state)?.official?.version === '5.8.26',
      String(rowOf(state)?.official?.version),
    );
  });

await section('⑧ 三个开关与两个筛选器：改状态 → 重算 → 推', async () => {
    state = await invoke(MOD_CH.setFolderAutoUpdate, folderId, false);
    check(
      'setFolderAutoUpdate ⇒ 该文件夹视图里的开关跟着变',
      folderByPath(state, modsDir)?.autoUpdate === false,
      String(folderByPath(state, modsDir)?.autoUpdate),
    );
    state = await invoke(MOD_CH.setFolderGameVersion, folderId, '1.16.1');
    check(
      'setFolderGameVersion(folderId, "1.16.1") ⇒ 该文件夹头显示 1.16.1',
      folderByPath(state, modsDir)?.gameVersion === '1.16.1',
      String(folderByPath(state, modsDir)?.gameVersion),
    );
    state = await invoke(MOD_CH.setFolderGameVersion, folderId, null);
    check(
      'setFolderGameVersion(folderId, null) ⇒ 交回自动推断（这里推断不出 ⇒ null）',
      folderByPath(state, modsDir)?.gameVersion === null,
      String(folderByPath(state, modsDir)?.gameVersion),
    );

    state = await invoke(MOD_CH.setBulkChannel, { mirrorId: 'gh-proxy' });
    check(
      'setBulkChannel 的返回值里带着当前值（界面读它、不自己存一份）',
      state.bulkChannel?.mirrorId === 'gh-proxy',
      JSON.stringify(state.bulkChannel),
    );
    let badChannel = null;
    try {
      await invoke(MOD_CH.setBulkChannel, { mirrorId: 'no-such-mirror' });
    } catch (error) {
      badChannel = error;
    }
    check(
      '目录里没有那条镜像 ⇒ 拒绝（不许把渲染进程给的 id 直接存下来）',
      badChannel !== null,
      badChannel?.message ?? '（没有抛）',
    );

    let badVersion = null;
    try {
      await invoke(MOD_CH.setCatalogGameVersion, '9.9.9');
    } catch (error) {
      badVersion = error;
    }
    check(
      '目录里没有那个游戏版本 ⇒ 拒绝',
      badVersion !== null,
      badVersion?.message ?? '（没有抛）',
    );

    /*
     * ★★ D2（A 的 T6）：`setTagFilter` 仍然**记得住**那个值，但它**不筛选任何东西** ——
     *    「该版本**全部** mod」在有一个陈旧/当前筛选值时都是全量。
     *
     * ⚠️★ 这一条是 T6 那条**真缺陷**的回归守卫：这一层原来把 `prefs.tagFilter` 传给
     *    `planCatalogRows`，而那一层会丢掉不匹配的行 ⇒ 一个陈旧的值会让第三段不再是全量，
     *    而唯一能清它的界面（标签筛选器）随第一部分下线了。
     * ⚠️ 判据**两条一起**才有牙齿（§5.38：一个读数要有第二条印证）：
     *    ① 那个标签**真的会筛掉行**（不是所有行都带 `legal`）—— 少了它，
     *       一个"什么都不筛"的实现与"筛了但恰好全中"分不开；
     *    ② 而 `catalogRows` 的行数与设筛选**之前**逐字相同（筛过的实现会少几行）。
     *    ★ 刀：把 `apps/desktop/src/mod-folders.ts` 的 `buildState` 改回"按
     *    `st.prefs.tagFilter` 过滤 `catalogRows`" ⇒ 这一条红（行数变小）。
     */
    const rowsBeforeTagFilter = state.catalogRows.length;
    state = await invoke(MOD_CH.setTagFilter, ['legal']);
    check(
      '（前置）`legal` 这个标签**真的会筛掉行**（不是所有行都带它）—— 否则下面那条是空跑',
      state.catalogRows.some((r) => !r.tags.includes('legal')),
      `不带 legal 的行：${String(state.catalogRows.filter((r) => !r.tags.includes('legal')).length)} / ${String(state.catalogRows.length)}`,
    );
    check(
      'setTagFilter(["legal"]) ⇒ 状态里记着它（契约那一格照旧）',
      state.tagFilter.length === 1 && state.tagFilter[0] === 'legal',
      `tagFilter=${JSON.stringify(state.tagFilter)}`,
    );
    check(
      '★★ D2：设了标签筛选之后目录行**一行都没少**（标签只显示、不筛选）',
      state.catalogRows.length === rowsBeforeTagFilter && rowsBeforeTagFilter > 0,
      `setTagFilter 之前 ${String(rowsBeforeTagFilter)} 行 → 之后 ${String(state.catalogRows.length)} 行`,
    );
    const onDisk = readStateFileJson();
    check(
      'prefs 落盘（bulkChannel / tagFilter / catalogGameVersion）',
      onDisk?.prefs?.bulkChannel?.mirrorId === 'gh-proxy' &&
        onDisk?.prefs?.tagFilter?.[0] === 'legal' &&
        onDisk?.prefs?.catalogGameVersion === '1.16.1',
      JSON.stringify(onDisk?.prefs ?? null),
    );
    state = await invoke(MOD_CH.setTagFilter, []);
  });

  // =========================================================================
  /*
   * ★ **Ruling 38**（2026-10-03 复审）：这个状态文件有**两个写者**（v1 的本地文件跟踪 +
   *   新的 mod 文件夹），而两个写者都是"整份写出自己内存里那份"。
   *   判据两条（就是判修文本里那两条）：**互不抹掉** —— 而且看的是**值是不是当前的**，
   *   不只是"键还在不在"（键在、值退回上次读盘时的样子，正是那条 bug 的形态）。
   *   第三把刀量的是**合并写**那一半：磁盘上独有的键不许被一次写入抹掉。
   */
  await section('★ Ruling 38：两个写者共用一份状态文件，谁的字段都不许被对方抹掉', async () => {
    // ---- 先把"v2 这一侧"的当前值记下来（它们必须活过下面那次 v1 写入）----
    const v2Before = readStateFileJson();
    const foldersBefore = Object.values(v2Before?.folders ?? {}).map((f) => f.path);
    /*
     * ⚠️★ T6 换掉了这一格的"可丢的东西"：原来它拿的是 `catalogBindings` 里那条绑定，
     *    而那一格退役了（D8 / 裁决 B）⇒ 换成 `prefs.catalogGameVersion`（同样是 v2 侧
     *    持久化的一格，而且 v1 从不写它）。
     */
    const versionBefore = v2Before?.prefs?.catalogGameVersion;
    const bulkBefore = v2Before?.prefs?.bulkChannel?.mirrorId;
    check(
      '（前置）v2 这一侧此刻有东西可丢：≥2 个文件夹、catalogGameVersion、bulkChannel 是镜像',
      foldersBefore.length >= 2 && versionBefore === '1.16.1' && bulkBefore === 'gh-proxy',
      `folders=${String(foldersBefore.length)} version=${String(versionBefore)} bulk=${String(bulkBefore)}`,
    );

    /*
     * 一次**真的 v1 写入**：`mcsr:fileupdates-bind` 会把 `items[insideId]` 写出来并落盘
     * （`bind()` → `writeStateFile`）。⚠️ 它后面还会 `check(false)` ⇒ 那一趟会去查 Modrinth
     * （本探针的 fetch 钩子会拒 ⇒ 退避重试三次 ≈ 1.2 秒）。这是**成本**，不是缺陷。
     */
    openQueue = [{ canceled: false, filePaths: [v1Jar] }];
    await invoke(FILE_CH.bind, insideId);
    const v1Write = readStateFileJson();
    check(
      '① v1 写了一次之后，v2 那两格**还在、而且是当前值**（文件夹没退回启动时那份、通道没被抹掉）',
      JSON.stringify(Object.values(v1Write?.folders ?? {}).map((f) => f.path)) ===
        JSON.stringify(foldersBefore) &&
        v1Write?.prefs?.catalogGameVersion === versionBefore &&
        v1Write?.prefs?.bulkChannel?.mirrorId === bulkBefore &&
        v1Write?.stateVersion === 2,
      JSON.stringify({
        folders: Object.values(v1Write?.folders ?? {}).map((f) => f.path),
        version: v1Write?.prefs?.catalogGameVersion,
        bulk: v1Write?.prefs?.bulkChannel,
      }),
    );
    check(
      '① 而 v1 自己那次写入确实生效了（items 里那条是刚绑的 jar ⇒ 上面那条不是"什么都没发生"）',
      resolve(v1Write?.items?.[insideId]?.localPath ?? '').toLowerCase() ===
        resolve(v1Jar).toLowerCase(),
      JSON.stringify(v1Write?.items?.[insideId] ?? null),
    );

    // ---- 反过来：一次 v2 写入之后，v1 的 items 逐字段仍在 ----
    const v1ItemBefore = readStateFileJson()?.items?.[insideId];
    state = await invoke(MOD_CH.setTagFilter, ['legal']);
    const v2Write = readStateFileJson();
    check(
      '② v2 写了一次之后，v1 的 `items` 里那条**逐字段**仍在（多写一份，不是搬走/重写）',
      v2Write?.items?.[insideId] !== undefined &&
        Object.entries(v1ItemBefore ?? {}).every(([k, v]) => v2Write.items[insideId][k] === v),
      JSON.stringify(v2Write?.items?.[insideId] ?? null),
    );
    check(
      '② 而 v2 自己那次写入确实生效了（tagFilter 落盘 ⇒ 上面那条不是"什么都没发生"）',
      v2Write?.prefs?.tagFilter?.[0] === 'legal',
      JSON.stringify(v2Write?.prefs?.tagFilter ?? null),
    );

    /*
     * 第三把刀：**磁盘上独有的键**。手工往盘上加一个 v1/v2 都不认识的顶层键，
     * 然后再让两个写者各写一次 —— 合并写（`mergeWithDisk`）会留着它，
     * 而"整份重写"会把它删掉。
     */
    const withExtra = { ...(readStateFileJson() ?? {}), probeOnlyKey: { keep: 'me' } };
    writeFileSync(stateFile(), JSON.stringify(withExtra, null, 2), 'utf8');
    state = await invoke(MOD_CH.setTagFilter, []);
    const afterV2 = readStateFileJson();
    check(
      '③ 磁盘上独有的顶层键活过了一次 v2 写入（合并写，不是整份重写）',
      afterV2?.probeOnlyKey?.keep === 'me',
      JSON.stringify(afterV2?.probeOnlyKey ?? null),
    );
    openQueue = [{ canceled: false, filePaths: [v1Jar] }];
    await invoke(FILE_CH.bind, insideId);
    const afterV1 = readStateFileJson();
    check(
      '③ 也活过了一次 v1 写入',
      afterV1?.probeOnlyKey?.keep === 'me',
      JSON.stringify(afterV1?.probeOnlyKey ?? null),
    );
  });

  // =========================================================================
  await section('⑨ 路径不存在：绑定保留、标记出来（不是删掉它）', async () => {
    openQueue = [{ canceled: false, filePaths: [goneDir] }];
    state = await invoke(MOD_CH.bindFolder);
    const id = folderByPath(state, goneDir)?.folderId ?? '';
    check('先绑上它', id !== '', id);
    rmSync(goneDir, { recursive: true, force: true });
    state = await invoke(MOD_CH.rescan, id);
    const folder = state.folders.find((f) => f.folderId === id);
    check(
      '文件夹被删掉之后仍留在状态里，且 pathExists = false、行与"无法识别"都不给',
      folder !== undefined &&
        folder.pathExists === false &&
        folder.rows.length === 0 &&
        folder.unrecognized.length === 0,
      folder === undefined ? '（被删掉了）' : `pathExists=${String(folder.pathExists)}`,
    );
    /*
     * ★ **判修 2 的第二支**：路径不存在与"还没扫"是**两种不同的原因**，修法也不同 ——
     *   前者换个说法（**不许**叫人去"重扫"：`rescan` 对一个不存在的目录只会把读数再删一次），
     *   而且 `missingStatus` 要能把它与 `'folder-unscanned'` 分开。
     */
    const missingNote = state.notices.find((note) => note.includes('缺失清单暂时空着'));
    check(
      `★ 路径不存在 ⇒ missingStatus === 'folder-missing'（不是 'folder-unscanned'、也不是 'ok'）`,
      state.missingStatus === 'folder-missing',
      `missingStatus=${String(state.missingStatus)}`,
    );
    check(
      `★ 这一支的说明**不许**叫人去「重扫」（重扫修不了一个被移走的目录）`,
      missingNote !== undefined && !missingNote.includes('重扫'),
      String(missingNote),
    );
    check(
      `而这一支的缺失清单同样空着（不是"你不缺任何 mod"）`,
      state.missing.length === 0,
      `missing = ${String(state.missing.length)} 条`,
    );
    state = await invoke(MOD_CH.unbindFolder, id);
    check(
      'unbindFolder 之后它没了',
      state.folders.find((f) => f.folderId === id) === undefined,
      String(state.folders.length),
    );
    check(
      `★ 解绑之后没有"不存在的文件夹"了 ⇒ missingStatus 回到 'ok'（这一格真的跟着条件走）`,
      state.missingStatus === 'ok',
      `missingStatus=${String(state.missingStatus)}`,
    );
    let badUnbind = null;
    try {
      await invoke(MOD_CH.unbindFolder, 'no-such-folder');
    } catch (error) {
      badUnbind = error;
    }
    check('解绑一个不存在的 folderId ⇒ 拒绝', badUnbind !== null, badUnbind?.message ?? '（没有抛）');
  });

  // =========================================================================
  await section('⑩ 推送与最终落盘', async () => {
    const channels = [...new Set(pushes.map((p) => p.channel))];
    check(
      '状态推送走的是 onStatus 那条通道（页面订阅得上）',
      channels.includes(MOD_CH.onStatus),
      channels.join(','),
    );
    const last = pushes.filter((p) => p.channel === MOD_CH.onStatus).at(-1)?.payload;
    check(
      '推给页面的那份就是 ModFoldersState（catalogStatus / catalogRows / folders / missing / notices / bulkChannel）',
      last !== undefined &&
        typeof last.catalogStatus === 'string' &&
        Array.isArray(last.catalogRows) &&
        Array.isArray(last.folders) &&
        Array.isArray(last.missing) &&
        Array.isArray(last.notices) &&
        last.bulkChannel !== undefined,
      last === undefined ? '（一次都没推）' : `catalogStatus=${String(last.catalogStatus)}`,
    );
    /*
     * ★★★ Ruling 58 / Ruling 55（2026-10-03 评审判修）：状态里那三格
     *   "目录的**全集**与**配置**" —— 界面读它们，不许自己硬写一份。
     *
     * ⚠️★ 为什么它们必须在状态里（判修 2 / 4 的现场）：
     *   · 只有 `gameVersion` 一格时，没绑定文件夹的客户端上那个版本下拉**只有一个选项**
     *     （目录里实测有 100+ 个版本）⇒ D4 的那个维度等于不存在；
     *   · 没有 `mirrors` 时，渲染进程只能写死"镜像 id + 主机名"⇒ 目录一改（改 id、
     *     加第二条镜像、把 `github.com` 从 `hosts` 拿掉）那一页就**静默**画出
     *     "会被主进程拒的按钮"，而没有任何门禁看得见。
     * ⚠️ 判据的来源是**仓库里那份目录文件**（本探针的 HTTP 桩就是拿它在喂的，
     *    见文件头）：三格都必须与它一致 —— 而不是"非空就行"（那会让"少了一半版本"
     *    这种坏法照样绿）。
     */
    const catalogFile = JSON.parse(readFileSync(MOD_CATALOG_FILE, 'utf8'));
    /*
     * ⚠️ 这一行**照 `buildIndex()` 的规则**（`ModIndex.gameVersions`：`releases[].targetVersions`
     *    的并集）算一遍 —— 探针是独立仪器，它不 import 被测代码；两处规则若漂了，
     *    这条断言正是会发现它的地方。
     */
    const expectedVersions = [
      ...new Set(catalogFile.releases.flatMap((release) => release.targetVersions ?? [])),
    ].sort();
    check(
      `★ gameVersions = 目录里全部游戏版本（${String(expectedVersions.length)} 个，判修 2）`,
      Array.isArray(last?.gameVersions) &&
        JSON.stringify([...last.gameVersions].sort()) === JSON.stringify(expectedVersions),
      Array.isArray(last?.gameVersions)
        ? `状态 ${String(last.gameVersions.length)} 个 / 目录 ${String(expectedVersions.length)} 个`
        : '（那一格不是数组）',
    );
    check(
      '★ 而且当前选中的那一版必须在里面（界面那个 `<select>` 的 value 靠它）',
      Array.isArray(last?.gameVersions) && last.gameVersions.includes(last.gameVersion),
      `gameVersion=${String(last?.gameVersion)}`,
    );
    /*
     * ⚠️ 标签那一格的判据与主进程的 `requireKnownTags()` **同一个集合**：
     *    `tagLabels` 的键 ∪ 各个 mod 带着的标签（目录里可能有"有标签、没显示名"的缺陷）。
     */
    const expectedTags = [
      ...new Set([
        ...Object.keys(catalogFile.tagLabels ?? {}),
        ...catalogFile.mods.flatMap((mod) => mod.tags ?? []),
      ]),
    ];
    check(
      `★ tags = 目录里的标签全集（${String(expectedTags.length)} 个）+ 两种语言的显示名（判修 2）`,
      Array.isArray(last?.tags) &&
        expectedTags.every((key) => last.tags.some((option) => option.key === key)) &&
        last.tags.every(
          (option) =>
            typeof option?.key === 'string' &&
            typeof option?.labels?.zh === 'string' &&
            option.labels.zh !== '' &&
            typeof option?.labels?.en === 'string' &&
            option.labels.en !== '',
        ),
      Array.isArray(last?.tags) ? `状态 ${String(last.tags.length)} 个` : '（那一格不是数组）',
    );
    check(
      '★ mirrors = 目录里的镜像表（判修 4：镜像按钮的 id 与主机判据都从它来）',
      Array.isArray(last?.mirrors) &&
        JSON.stringify(last.mirrors) === JSON.stringify(catalogFile.mirrors ?? []),
      JSON.stringify(last?.mirrors ?? null),
    );
    const onDisk = readStateFileJson();
    check(
      '状态文件仍是 v1 的 version: 1 + stateVersion: 2（老客户端读的那一格没被改成 2）',
      onDisk?.version === 1 && onDisk?.stateVersion === 2,
      `version=${String(onDisk?.version)} stateVersion=${String(onDisk?.stateVersion)}`,
    );
    check(
      '落盘的 folders 里两个文件夹都在（A-mods 与 .minecraft 那个）',
      Object.values(onDisk?.folders ?? {}).some(
        (f) => resolve(f.path).toLowerCase() === resolve(modsDir).toLowerCase(),
      ) &&
        Object.values(onDisk?.folders ?? {}).some(
          (f) => resolve(f.path).toLowerCase() === resolve(instanceMods).toLowerCase(),
        ),
      JSON.stringify(Object.values(onDisk?.folders ?? {}).map((f) => f.path)),
    );
    console.log(`  上游请求（api.modrinth.com）共 ${String(upstreamRequests)} 次（夹具就地应答）`);
    console.log(`  读过的 jar：a-1.0.jar=${readJarMeta(jarOld).id} a-2.0.jar=${readJarMeta(jarNew).id}`);
  });

  // =========================================================================
  /*
   * ★★ G2（最终修复波 / spec D3）：「在版本 X 下点「添加文件夹」⇒ 选完目录后把该文件夹的
   *    版本**预置**为 X（仍可改）」。
   *
   * ⚠️★ 这条通道修之前**一个入参都没有**（`bindFolder()`），版本只能由主进程推断
   *    （`.minecraft` / `mmc-pack.json`）⇒ 推不出来的路径拿到的是 `null`（每一行都是
   *    `unknown-version`，一颗更新按钮都没有）—— 于是"在 1.16.1 下面添加、却归到版本未知
   *    那一组"。页面那一侧同一件事也有读数：`foldersrender.tsx` ㊴ 有四条源码形状守卫
   *    （动作成员 / `Files.tsx` 的接线 / 动作层的转发 / 那一格的来源）。
   *
   * ⚠️★ 四条判据一起才关得住（每一条都能单独被一个坏实现骗过去）：
   *    · 带版本绑 ⇒ **状态里**那一格就是它；
   *    · 盘上也是它（不是"内存里看着对、写盘时丢了"）；
   *    · 仍可改（`setFolderGameVersion` 能把它改掉 / 交回自动推断）—— spec D3 的"仍可改"；
   *    · ★ **对照**：不带版本绑（老调用点 / 探针的 `bindAt`）⇒ 同一个推断不出来的路径
   *      仍然是 `null`。少了这一条，"永远预置成某个常量"这种坏法过得了前三条。
   * ⚠️ 这一节跑在**相位末尾**（⑩ 之后）：那时 `catalogGameVersionChosen` 已经是 `true`
   *    （⑧ 里探针自己调过 `setCatalogGameVersion`）⇒ `bindFolder` 里那次
   *    `adoptFolderGameVersion()` **不会**因为预置的 1.8.9 而改 `prefs`，
   *    前面每一条判据读到的 `gameVersion` 因此不受影响。
   * ★ 刀（读数在报告里）：把 `bindFolder` 里 `gameVersion: preset` 改回 `gameVersion: null`
   *    ⇒ 第 1、2 条红（第 3、4 条照旧绿 —— 它们测的是别的两件事）。
   * ★ 另一把（读数在报告里）：把 `presetFolderVersion` 的 `undefined`/`null` 那一支也
   *    收成一个默认版本 ⇒ 第 4 条红。
   */
  await section('⑤b（G2 / spec D3）添加文件夹时把版本**预置**成当时看着的那一版（仍可改）', async () => {
    const presetDir = join(workRoot, 'H-preset');
    const autoDir = join(workRoot, 'I-auto');
    mkdirSync(presetDir, { recursive: true });
    mkdirSync(autoDir, { recursive: true });

    openQueue = [{ canceled: false, filePaths: [presetDir] }];
    // ⚠️ 页面发出去的就是 `page.version`（= 状态里选中的那一版）⇒ 这里原样喂 '1.8.9'。
    state = await invoke(MOD_CH.bindFolder, '1.8.9');
    const preset = folderByPath(state, presetDir);
    check(
      '★★ 带版本绑（`bindFolder("1.8.9")`）⇒ 新文件夹的有效版本**就是它**（不是推断出来的那个 null）',
      preset?.gameVersion === '1.8.9',
      `gameVersion=${String(preset?.gameVersion)}`,
    );
    const presetDisk = readStateFileJson();
    const presetOnDisk = Object.values(presetDisk?.folders ?? {}).find(
      (candidate) => resolve(String(candidate.path)).toLowerCase() === resolve(presetDir).toLowerCase(),
    );
    check(
      '★ 而且**盘上**那一格也是它（不是"内存里看着对、写盘时丢了"）',
      presetOnDisk?.gameVersion === '1.8.9',
      JSON.stringify(presetOnDisk ?? null),
    );
    state = await invoke(MOD_CH.setFolderGameVersion, preset?.folderId ?? '', null);
    check(
      '★ 仍是**可改**的：`setFolderGameVersion(id, null)` 交回自动推断（这个路径推不出来 ⇒ null）',
      folderByPath(state, presetDir)?.gameVersion === null,
      `gameVersion=${String(folderByPath(state, presetDir)?.gameVersion)}`,
    );
    state = await invoke(MOD_CH.setFolderGameVersion, preset?.folderId ?? '', '1.16.1');
    check(
      '★ 也能手改成目录里那一版（1.16.1 真的写进去了）',
      folderByPath(state, presetDir)?.gameVersion === '1.16.1',
      `gameVersion=${String(folderByPath(state, presetDir)?.gameVersion)}`,
    );

    /*
     * ★★ 对照（少了它，上面三条可以坏成"永远预置成一个常量"）：同一个推断不出来的
     *    路径，**不带版本**绑 ⇒ 仍然是 `null`（= 自动推断，与 G2 之前逐字相同的行为）。
     */
    openQueue = [{ canceled: false, filePaths: [autoDir] }];
    state = await invoke(MOD_CH.bindFolder);
    check(
      '★★ 对照：**不带版本**绑（老调用点 / 探针的 `bindAt`）⇒ 推断不出来的路径仍然是 null',
      folderByPath(state, autoDir)?.gameVersion === null,
      `gameVersion=${String(folderByPath(state, autoDir)?.gameVersion)}`,
    );
  });

  return { workRoot, ok: failures === 0 };
}

// ===========================================================================
// 相位二：§13.1 / `readStateFile` 加固（每条要一份全新的模块状态 ⇒ 子进程）
// ===========================================================================
async function stateFilePhase() {
  const workRoot = mkdtempSync(join(tmpdir(), `verify-mod-folders-state-${CASE}-`));
  currentUserDataDir = join(workRoot, 'userData');
  mkdirSync(currentUserDataDir, { recursive: true });

  const good = {
    version: 1,
    stateVersion: 2,
    items: {},
    catalogBindings: {},
    folders: {
      keepme: { path: join(workRoot, 'somewhere'), gameVersion: null, autoUpdate: true, boundAt: 5 },
    },
    prefs: { bulkChannel: { mirrorId: 'gh-proxy' }, catalogGameVersion: '1.8.9', tagFilter: ['legal'] },
  };
  /** case a：`stateVersion: 2` 但三格是**类型不对**的 ⇒ 必须走 v1 那条"备份 + 重建 + 告诉用户"。 */
  const bad = {
    version: 1,
    stateVersion: 2,
    items: {},
    catalogBindings: {},
    folders: null,
    prefs: { bulkChannel: 'origin', catalogGameVersion: '1.16.1', tagFilter: [] },
  };
  /** case b：`stateVersion: 2` 但三格**缺失** ⇒ 补默认（不是坏文件、不许备份）。 */
  const missing = { version: 1, stateVersion: 2, items: {} };
  /**
   * ★★ case d（A 的 T6，spec §9.16 / D8）：一份**好文件**，但 `catalogBindings` 里
   *    **真的有旧数据** —— 那一格在 T6 停止读写（那三个通道删了，裁决 B：
   *    契约 17 → 14）。
   *    ⇒ 判据两条：① 启动**不报错**、**不当坏文件**（不产生 `.corrupt-*`、不弹框）；
   *      ② **第一次持久化之后**那份旧数据不再存在（读到就忽略 + 我们这份的 `{}` 覆盖磁盘）。
   *    ⚠️ 夹具里那份旧数据的形状是**真的**（`{localPath, localVersion, localSha512,
   *    releaseKey, autoUpdate}`，与 `normalizeCatalogBindings` 收的形状逐格一致）——
   *    形状错了的话"被清掉"这件事会因为"读进来就丢掉"而变成另一回事（§5.79）。
   */
  const staleBinding = {
    version: 1,
    stateVersion: 2,
    items: {},
    catalogBindings: {
      'antigone|1.16.1': {
        localPath: join(workRoot, 'old-mods', 'a-2.0.jar'),
        localVersion: '2.0.0',
        localSha512: 'd'.repeat(128),
        releaseKey: 'antigone|1.16.1',
        autoUpdate: false,
      },
    },
    folders: {
      keepme: { path: join(workRoot, 'somewhere'), gameVersion: null, autoUpdate: true, boundAt: 5 },
    },
    prefs: { bulkChannel: 'origin', catalogGameVersion: '1.16.1', tagFilter: [] },
  };

  const seed =
    CASE === 'a' ? bad : CASE === 'b' ? missing : CASE === 'd' ? staleBinding : good;
  const seededBytes = JSON.stringify(seed, null, 2);
  writeFileSync(stateFile(), seededBytes, 'utf8');
  console.log(`  预置状态文件（case ${CASE}）：${seededBytes.length} 字节`);

  loadArtifact();
  const registered = await waitForHandlers();
  check('（前置）这一相位也把 13 条 invoke 通道注册起来了', registered);

  // 给启动那一路（目录抓取 + 扫盘）一点时间落盘
  await new Promise((r) => setTimeout(r, 1500));

  const backups = readdirSync(currentUserDataDir).filter((n) => n.includes('.corrupt-'));
  const after = readStateFileJson();
  const messages = dialogCalls.filter((c) => c.kind === 'message');

  if (CASE === 'a') {
    check(
      `类型不对的那三格 ⇒ 备份出一个 .corrupt-<ts>（找到了 ${String(backups.length)} 个）`,
      backups.length === 1,
      listing(currentUserDataDir),
    );
    if (backups.length === 1) {
      check(
        '备份里就是原来那份字节（不是"备份了个空壳"）',
        readFileSync(join(currentUserDataDir, backups[0]), 'utf8') === seededBytes,
        `${String(readFileSync(join(currentUserDataDir, backups[0]), 'utf8').length)} 字节 vs 原 ${String(seededBytes.length)} 字节`,
      );
    }
    check(
      '重建之后三格都是对象（folders 被重建为空、剩下的有默认值）',
      after?.folders !== null &&
        typeof after?.folders === 'object' &&
        !Array.isArray(after?.folders) &&
        typeof after?.catalogBindings === 'object' &&
        typeof after?.prefs === 'object',
      JSON.stringify({ folders: after?.folders, prefs: after?.prefs }),
    );
    check(
      '**告诉了用户**（弹了一次原生提示框，并把备份文件名说出来）',
      messages.some(
        (m) =>
          typeof m.options?.detail === 'string' && m.options.detail.includes('.corrupt-'),
      ),
      messages.map((m) => m.options?.detail ?? m.options?.message).join(' / ') || '（一次都没弹）',
    );
  }
  if (CASE === 'b') {
    check(
      '三格**缺失** ⇒ 只补默认，**不**当成坏文件（没有 .corrupt-*）',
      backups.length === 0,
      listing(currentUserDataDir),
    );
    check(
      '补出来的默认值与 `migrateState` 一致（folders {} / catalogBindings {} / prefs.bulkChannel origin / 1.16.1）',
      after?.folders !== undefined &&
        Object.keys(after.folders).length === 0 &&
        Object.keys(after.catalogBindings ?? {}).length === 0 &&
        after?.prefs?.bulkChannel === 'origin' &&
        after?.prefs?.catalogGameVersion === '1.16.1' &&
        Array.isArray(after?.prefs?.tagFilter),
      JSON.stringify({ folders: after?.folders, prefs: after?.prefs }),
    );
    check(
      'v1 的老闸门仍然先跑（`items` 保留、`version` 仍是 1）',
      after?.version === 1 && typeof after?.items === 'object' && after?.stateVersion === 2,
      `version=${String(after?.version)} stateVersion=${String(after?.stateVersion)}`,
    );
  }
  if (CASE === 'c') {
    check('形态完好 ⇒ 一个字节都不许当作坏文件（没有 .corrupt-*）', backups.length === 0, listing(currentUserDataDir));
    check(
      '三格原样保留（folder 的 path/gameVersion/autoUpdate/boundAt 与 prefs 都没被"归一化"掉）',
      after?.folders?.keepme?.path === good.folders.keepme.path &&
        after?.folders?.keepme?.autoUpdate === true &&
        after?.folders?.keepme?.boundAt === 5 &&
        after?.prefs?.bulkChannel?.mirrorId === 'gh-proxy' &&
        after?.prefs?.catalogGameVersion === '1.8.9' &&
        after?.prefs?.tagFilter?.[0] === 'legal',
      JSON.stringify({ folders: after?.folders, prefs: after?.prefs }),
    );
  }
  if (CASE === 'd') {
    check(
      '★ D8/§9.16：`catalogBindings` 里有旧数据 ⇒ 启动**不报错、不当坏文件**（没有 .corrupt-*）',
      backups.length === 0 && messages.length === 0,
      `${listing(currentUserDataDir)}；弹框 ${String(messages.length)} 次`,
    );
    check(
      '★★ 而**第一次持久化之后**那份旧数据不再存在（读到就忽略 + 我们这份的 `{}` 覆盖磁盘）',
      after?.catalogBindings !== undefined && Object.keys(after.catalogBindings).length === 0,
      `磁盘上的 catalogBindings = ${JSON.stringify(after?.catalogBindings ?? null)}`,
    );
    check(
      '· 对照：清掉那一格**没有**动别的东西（folder 与 prefs 逐格照旧）',
      after?.folders?.keepme?.path === staleBinding.folders.keepme.path &&
        after?.folders?.keepme?.boundAt === 5 &&
        after?.prefs?.bulkChannel === 'origin' &&
        after?.prefs?.catalogGameVersion === '1.16.1',
      JSON.stringify({ folders: after?.folders, prefs: after?.prefs }),
    );
  }

  server.close();
  if (!KEEP) rmSync(workRoot, { recursive: true, force: true });
  return { workRoot };
}

// ===========================================================================
// 相位三：Ruling 37 —— 用户显式选过的游戏版本必须按机器记住（case d/e/f/g）
//   d = 播种 chosen:true（读那一半）；e = 老文件缺那一格（自动采纳那一半）；
//   f = 由探针**自己调** setCatalogGameVersion（写那一半）+ 真重启；g = 那次真重启
// ===========================================================================
async function prefsPhase() {
  const workRoot = mkdtempSync(join(tmpdir(), `verify-mod-folders-prefs-${CASE}-`));
  /*
   * case g 是**另一个进程里的真重启**：它用 case f 留下的那份 `userData`
   * （`--reuse-user-data <目录>`），自己那个新的 workRoot 只用来放没用的夹具。
   */
  currentUserDataDir = REUSE_USER_DATA === '' ? join(workRoot, 'userData') : REUSE_USER_DATA;
  mkdirSync(currentUserDataDir, { recursive: true });

  /*
   * 夹具：一个**能推断出 1.16.1** 的文件夹（`.minecraft` + `mmc-pack.json`，
   * 与主相位那一份同形），而预置的 `catalogGameVersion` 是 **1.8.9** ——
   * 两者不同，"启动时会不会被覆盖"才分得出来。
   */
  const instanceDir = join(workRoot, '.minecraft', 'instances', 'demo');
  const instanceMods = join(instanceDir, 'mods');
  mkdirSync(instanceMods, { recursive: true });
  writeFileSync(
    join(instanceDir, 'mmc-pack.json'),
    JSON.stringify({ components: [{ uid: 'net.minecraft', version: '1.16.1' }] }),
  );
  /*
   * 里面放一份真 jar：等待信号（下面那个"目录 ok 且文件夹已扫"的推送）靠它分辨
   * "启动那一路跑完了" —— 一个**空**目录扫出来也是 0 行，于是一个**还没扫**的空目录
   * 与"扫过了、里面什么都没有"满足同一个条件（那条等待就失去分辨力了）。
   */
  makeJar(join(instanceMods, 'present.jar'), { id: ANTIGONE, version: '2.0.0' });

  const prefsBase = { bulkChannel: 'origin', catalogGameVersion: '1.8.9', tagFilter: [] };
  const seed = {
    version: 1,
    stateVersion: 2,
    items: {},
    catalogBindings: {},
    folders: {
      'f-auto': { path: instanceMods, gameVersion: null, autoUpdate: true, boundAt: 1 },
    },
    /*
     * case d：**用户选过**（`catalogGameVersionChosen: true`）⇒ 1.8.9 必须活下来；
     * case e：老文件**没有这一格** ⇒ 归一化补 `false`，下次启动仍会采纳一次（1.16.1）。
     * case f：`chosen: false` 起步，**由探针自己去调** `setCatalogGameVersion`（判修 1
     *   要锚的正是那一半），随后的 case g 是一次**真重启**。
     */
    prefs:
      CASE === 'd'
        ? { ...prefsBase, catalogGameVersionChosen: true }
        : CASE === 'f'
          ? { ...prefsBase, catalogGameVersionChosen: false }
          : prefsBase,
  };
  if (CASE === 'g') {
    /*
     * case g 是**真重启**：不预置任何东西，用 case f 留下的那份 `userData`（`--reuse-user-data`）。
     * ⚠️ 它是判修 1 的第二半：`setCatalogGameVersion` 写下去的那个值，必须在**下一次启动**
     *    之后还在（那时 `startUp` 会再跑一次 `adoptFolderGameVersion()`，而那个文件夹推断出
     *    1.16.1）。少了它，"置位只写在内存里"这种坏法照样绿。
     */
    if (REUSE_USER_DATA === '') bail('--phase prefs --case g 必须带 --reuse-user-data <目录>');
    console.log(`  复用 case f 留下的 userData（真重启）：${currentUserDataDir}`);
    console.log(`  它盘上的 prefs：${JSON.stringify(readStateFileJson()?.prefs ?? null)}`);
  } else {
    writeFileSync(stateFile(), JSON.stringify(seed, null, 2), 'utf8');
    console.log(
      `  预置状态文件（case ${CASE}）：catalogGameVersion=1.8.9，chosen=${CASE === 'd' ? 'true' : CASE === 'f' ? 'false' : '（缺这一格 ⇒ 补 false）'}；` +
        `已绑定文件夹推断出 1.16.1`,
    );
  }

  /*
   * ⚠️★ 上游夹具先切成"可达"：这一相位要等的是**启动那一路的最后一次 rebuild**
   *    （`startUp` 的 `adoptFolderGameVersion()` 排在它的扫盘循环之后、`rebuild()` 之前），
   *    而在"不可达"模式下那一次要多等三次退避重试（≈1.2 秒）—— 等的久不是问题，
   *    **等错东西**才是：固定 `sleep` 会在"启动还没跑到 adopt"时读到一份旧状态，
   *    于是 case d 那条"没被覆盖"**恒真**（假绿），case e 那条则红得莫名其妙。
   */
  upstreamMode = 'ok';
  loadArtifact();
  const registered = await waitForHandlers();
  check('（前置）这一相位也把 13 条 invoke 通道注册起来了', registered);

  /*
   * 等 `startUp` 真正跑完：判据是**推给页面的那份状态**（`onStatus`）里
   * `catalogStatus === 'ok'`（目录抓到了）**且**那个文件夹已经有一行（扫盘循环跑过了）。
   * 这一相位**不主动调 `getState`**（那会由 `ensureScans` 自己产生一份同样形状的推送，
   * 让上面那个信号失去分辨力）—— 于是唯一能满足它的就是 `startUp` 的最后一次 rebuild。
   */
  let pushed = null;
  for (let i = 0; i < 400; i += 1) {
    const last = pushes.filter((p) => p.channel === MOD_CH.onStatus).at(-1)?.payload ?? null;
    if (last !== null && last.catalogStatus === 'ok' && last.folders.some((f) => f.rows.length > 0)) {
      pushed = last;
      break;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  check(
    '（前置）启动那一路跑完了（拿到一份"目录 ok 且已绑定文件夹已扫"的推送）',
    pushed !== null,
    pushed === null ? '（等不到）' : `catalogStatus=${String(pushed.catalogStatus)}`,
  );
  const state = pushed ?? { folders: [] };
  const after = readStateFileJson();

  if (CASE === 'd') {
    check(
      '用户显式选过（chosen: true）⇒ 状态里**仍是 1.8.9**（没被文件夹推断出的 1.16.1 覆盖）',
      state.gameVersion === '1.8.9',
      `state.gameVersion=${String(state.gameVersion)}`,
    );
    check(
      '磁盘上的 `prefs.catalogGameVersion` **也仍是 1.8.9**（不是"内存里看着对、盘上被改写"）',
      after?.prefs?.catalogGameVersion === '1.8.9',
      JSON.stringify(after?.prefs ?? null),
    );
    check(
      '`catalogGameVersionChosen` 仍是 true（这一位没被归一化掉）',
      after?.prefs?.catalogGameVersionChosen === true,
      String(after?.prefs?.catalogGameVersionChosen),
    );
  } else if (CASE === 'f') {
    /*
     * ★ **判修 1**（2026-10-03 复审）：Ruling 37 的**写那一半**。
     *   case d 是**手工播种** `chosen: true` 的 ⇒ 把 `setCatalogGameVersion` 里那句置位
     *   删掉，静默覆盖用户的 bug 会原样回来而全部断言照样绿。这一相位补上那一刻：
     *   调一次**合法**值（`1.8.9`，与文件夹推断出的 `1.16.1` **不同** —— 否则
     *   "重启不会被覆盖"那一条恒真），然后让 case g 做一次**真重启**。
     */
    check(
      '（前置）这一趟的起点是 chosen: false（启动那一趟已按 spec §6.8 采纳成文件夹推断的 1.16.1）',
      state.gameVersion === '1.16.1' && after?.prefs?.catalogGameVersionChosen === false,
      `state=${String(state.gameVersion)} prefs=${JSON.stringify(after?.prefs ?? null)}`,
    );
    const written = await invoke(MOD_CH.setCatalogGameVersion, '1.8.9');
    const diskAfterWrite = readStateFileJson();
    check(
      '`setCatalogGameVersion("1.8.9")` ⇒ 状态里是 1.8.9',
      written.gameVersion === '1.8.9',
      String(written.gameVersion),
    );
    check(
      '★ 而且**磁盘上** `catalogGameVersion === "1.8.9"` **且 `catalogGameVersionChosen === true`**（写这一半真的落了盘）',
      diskAfterWrite?.prefs?.catalogGameVersion === '1.8.9' &&
        diskAfterWrite?.prefs?.catalogGameVersionChosen === true,
      JSON.stringify(diskAfterWrite?.prefs ?? null),
    );
    // 真重启：另起一个进程，用它留下的这份 userData（下面那一段判据在 case g 里）
    const restart = spawnSync(
      process.execPath,
      [self, '--phase', 'prefs', '--case', 'g', '--reuse-user-data', currentUserDataDir],
      { stdio: 'inherit', cwd: repoRoot, env: { ...process.env, MCSR_VERIFY_REEXEC: '1' } },
    );
    check(
      '★ 上一次写入之后**真重启一次**（另一个进程跑同一个 userData）：它的判据全成立、退出码 0',
      restart.status === 0,
      `子进程退出码 ${String(restart.status)}`,
    );
    const diskAfterRestart = readStateFileJson();
    check(
      '★ 重启之后盘上仍是 1.8.9 + chosen true（`startUp` 的自动采纳没有把它改回去）',
      diskAfterRestart?.prefs?.catalogGameVersion === '1.8.9' &&
        diskAfterRestart?.prefs?.catalogGameVersionChosen === true,
      JSON.stringify(diskAfterRestart?.prefs ?? null),
    );
  } else if (CASE === 'g') {
    check(
      '★ 真重启之后状态里仍是用户上一次选的 1.8.9（文件夹推断出的 1.16.1 不许覆盖它）',
      state.gameVersion === '1.8.9',
      `state.gameVersion=${String(state.gameVersion)}`,
    );
    check(
      '`catalogGameVersionChosen` 仍是 true（重启没有把它归一化回 false）',
      after?.prefs?.catalogGameVersionChosen === true,
      String(after?.prefs?.catalogGameVersionChosen),
    );
  } else {
    check(
      '老文件（缺这一格 ⇒ 补 false）⇒ 采纳已绑定文件夹推断出的 1.16.1（Ruling 37 明确接受这一次）',
      state.gameVersion === '1.16.1',
      `state.gameVersion=${String(state.gameVersion)}`,
    );
    check(
      '磁盘上也被采纳地写成 1.16.1，而 `catalogGameVersionChosen` 补成了 `false`（不是 true）',
      after?.prefs?.catalogGameVersion === '1.16.1' && after?.prefs?.catalogGameVersionChosen === false,
      JSON.stringify(after?.prefs ?? null),
    );
  }
  check(
    '（对照）那个文件夹确实推断得出 1.16.1（否则上面几条比的是"推断不出来"）',
    state.folders.find((f) => f.folderId === 'f-auto')?.gameVersion === '1.16.1',
    String(state.folders.find((f) => f.folderId === 'f-auto')?.gameVersion),
  );

  server.close();
  if (!KEEP) rmSync(workRoot, { recursive: true, force: true });
  return { workRoot };
}

// ===========================================================================
// 相位三：写路径（Task 5）—— 四条负向证明 + 两个写入口
// ===========================================================================
/*
 * ⚠️★ 为什么必须**单独一个进程**（照 `state-file` / `prefs` 的理由）：
 *    被劫持的目录（release 的 url / sha512、镜像表）要在**产物加载之前**就位 ——
 *    而目录是启动时抓的、之后缓存在模块里 ⇒ "另换一套目录夹具"只能靠新进程。
 *    主相位因此一个字节的目录都没变（`WRITE` 那一支在主相位里不执行）。
 */

/**
 * 用**另一个进程**把文件按 `FileShare.None` 占住。
 *
 * ⚠️★ 为什么非得是另一个进程（T3 实测，2026-10-02）：Node 的 `fs.open`（`r` / `r+` / `a` / `w`）
 *    **四种都挡不住 rename**，置只读属性也挡不住 —— 只有
 *    `[System.IO.File]::Open(p,'Open','Read','None')` 这种"不给别人任何共享"的句柄
 *    才会让 `rename` 得到 `EBUSY`。（`rmSync` 那种情况下是 `EPERM`，也一起复现了。）
 * ⚠️ 占着的时候**我们自己的 `readFileSync` 也会 EBUSY** ⇒ 调用方必须在 `release()`
 *    **之后**才去量"原文件字节没变"（否则量到的是一次读失败，而不是字节）。
 */
async function holdFileExclusively(path) {
  const script = `$h = [System.IO.File]::Open('${path}', 'Open', 'Read', 'None'); [Console]::Out.WriteLine('HELD'); Start-Sleep -Seconds 120`;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  let spawnError = null;
  child.stdout.on('data', (chunk) => {
    out += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    err += String(chunk);
  });
  child.on('error', (error) => {
    spawnError = error;
  });
  const exited = new Promise((done) => child.on('exit', done));
  for (let i = 0; i < 240 && !out.includes('HELD') && spawnError === null; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const held = out.includes('HELD');
  return {
    held,
    detail: held
      ? `powershell.exe 占住了（pid ${String(child.pid)}）`
      : `没占住：${spawnError?.message ?? `${out}${err}`}`,
    release: async () => {
      child.kill();
      await exited;
    },
  };
}

async function writePhase() {
  const fx = writeFixture;
  if (fx === null) bail('写路径的夹具没建起来（PHASE 不是 write？）');
  if (process.platform !== 'win32') {
    bail("负向证明 ⑦ 需要 Windows：只有 [System.IO.File]::Open(...,'None') 能得到 EBUSY");
  }

  /*
   * ⚠️ `workRoot` 放进一个**专属的父目录**：负向证明 ⑥ 要证的正是"临时目录**之外**
   *    一个文件都没多"，而"外面"如果直接是 `tmpdir()`，别的进程随时在往里写东西 ⇒
   *    那个读数不可复现（§5.38：报 0 之前先找出第二条读数证明这个 0 是测出来的）。
   */
  const parentRoot = mkdtempSync(join(tmpdir(), 'verify-mod-folders-write-parent-'));
  const workRoot = join(parentRoot, 'run');
  mkdirSync(workRoot);
  currentUserDataDir = join(workRoot, 'userData');
  mkdirSync(currentUserDataDir);

  const dirBad = join(workRoot, 'mods-bad');
  const dirTrav = join(workRoot, 'mods-trav');
  const dirBusy = join(workRoot, 'mods-busy');
  const dirSlow = join(workRoot, 'mods-slow');
  const dirGood = join(workRoot, 'mods-good');
  const dirCat = join(workRoot, 'cat-row');
  for (const dir of [dirBad, dirTrav, dirBusy, dirSlow, dirGood, dirCat]) mkdirSync(dir);

  const badLocal = join(dirBad, 'bad-1.0.jar');
  writeFileSync(badLocal, probeJar(fx.bad.modid, FIXTURE_JAR_VERSION));
  const travLocal = join(dirTrav, 'trav-1.0.jar');
  writeFileSync(travLocal, probeJar(fx.trav.modid, FIXTURE_JAR_VERSION));
  const goodLocal = join(dirGood, 'good-1.0.jar');
  writeFileSync(goodLocal, probeJar(fx.good.modid, FIXTURE_JAR_VERSION));
  const slowLocal = join(dirSlow, 'slow-1.0.jar');
  writeFileSync(slowLocal, probeJar(fx.good.modid, FIXTURE_JAR_VERSION));
  /* 被占住的那个文件**名字就是目标名**（第 7 步要挪的正是它），字节与"官方那一份"不同。 */
  const busyTarget = join(dirBusy, fx.busy.targetName);
  writeFileSync(busyTarget, probeJar(fx.busy.modid, FIXTURE_JAR_VERSION, true));
  /* 目录行那一侧的绑定：一个**不在任何已绑定文件夹里**的 jar（否则 §13.1 会把它解绑）。 */
  const catOld = join(dirCat, 'cat-old.jar');
  writeFileSync(catOld, probeJar(fx.good.modid, FIXTURE_JAR_VERSION));

  /*
   * ⚠️ 状态文件必须在 `loadArtifact()` **之前**写好（启动时读一次）；
   *    `catalogGameVersionChosen: true` 是故意的：不让 `startUp` 的"自动采纳"动游戏版本。
   */
  const seeded = {
    version: 1,
    stateVersion: 2,
    items: {},
    catalogBindings: {},
    folders: {},
    prefs: {
      bulkChannel: 'origin',
      catalogGameVersion: '1.16.1',
      catalogGameVersionChosen: true,
      tagFilter: [],
    },
  };
  writeFileSync(stateFile(), JSON.stringify(seeded, null, 2), 'utf8');

  console.log(`  夹具（写相位）：${workRoot}`);
  for (const [name, dir] of [
    ['mods-bad', dirBad],
    ['mods-trav', dirTrav],
    ['mods-busy', dirBusy],
    ['mods-slow', dirSlow],
    ['mods-good', dirGood],
    ['cat-row', dirCat],
  ]) {
    console.log(`  ${name}：${listing(dir)}`);
  }
  console.log(`  父目录（⑥ 要证的"外面"）：${parentRoot} ⇒ ${listing(parentRoot)}`);

  loadArtifact();
  const registered = await waitForHandlers();
  if (!registered) bail('十三条 invoke 通道没注册上（写路径的判据全都要走 invoke）');

  /** 绑一个夹具目录（走原生的目录对话框桩）。 */
  const bindAt = async (dir) => {
    openQueue = [{ canceled: false, filePaths: [dir] }];
    const bound = await invoke(MOD_CH.bindFolder);
    const folder = folderByPath(bound, dir);
    if (folder === undefined) bail(`绑不上夹具目录：${dir}`);
    return folder.folderId;
  };
  /**
   * 绑一个夹具目录 + 把它的游戏版本定成 1.16.1。
   * ⚠️ 不用 `.minecraft` 那一套（`mmc-pack.json`）：`setFolderGameVersion` 是**用户显式选版本**
   *    那条路，而它正好也是"路径推断不出来时"的正常入口（spec §8）。
   */
  const prepare = async (dir) => {
    const id = await bindAt(dir);
    const after = await invoke(MOD_CH.setFolderGameVersion, id, '1.16.1');
    const folder = after.folders.find((candidate) => candidate.folderId === id);
    if (folder?.gameVersion !== '1.16.1' || folder.rows.length === 0) {
      bail(`夹具目录没有可更新的行：${dir}（rows=${String(folder?.rows.length)}）`);
    }
    return id;
  };
  const rowOf = (state, dir, modid) =>
    folderByPath(state, dir)?.rows.find((row) => row.modid === modid);
  /** 桩上某条路径前缀收到过几个**下载**请求（目录请求不算 —— `downloadLog` 只记下载那一段）。 */
  const reqsOf = (prefix) => downloadLog.filter((entry) => entry.prefix === prefix).length;
  const goodReqs = () => reqsOf('/mirror-good/');
  const slowReqs = () => reqsOf('/mirror-slow/');
  const noPartsOrOlds = (dir) =>
    !readdirSync(dir).some((name) => name.includes('.part') || name.endsWith('.old'));
  /*
   * ★ (b)（2026-10-03 复审）：**不许拿 `instanceof Error` 当成功判据** ——
   *    `handler` 若什么都没返回，`value` 是 `undefined`，而 `undefined !== null` 与
   *    `!(undefined instanceof Error)` **都是真** ⇒ 那一条会"绿着"什么都没验。
   *    ⇒ 成功一律要**形状**：真的是那份 `ModFoldersState`（两个数组都在）。
   *    读数用 `resultDetail`：抛了就说抛了什么，不是状态就把 `typeof` / 字段数印出来。
   */
  const isState = (value) =>
    typeof value === 'object' &&
    value !== null &&
    Array.isArray(value.folders) &&
    Array.isArray(value.catalogRows);
  const resultDetail = (value) => {
    if (value instanceof Error) return value.message;
    if (typeof value !== 'object' || value === null) return `typeof ${typeof value}`;
    return `拿到了 ${String(Object.keys(value).length)} 个字段的对象`;
  };

  // =========================================================================
  // ⑫ = brief ⑤：sha512 对不上 ⇒ 不落盘
  // =========================================================================
  /*
   * ⚠️ `singleRowBadUrl` 是给 **㉒**（brief ⑩）用的：缺失下载要证"走的是同一段"，
   *    判据之一就是"它请求的地址与这里这条逐字相同"（⇒ 同一份 `originFileNameOf` + 同一条地址解析）。
   *    只在**真的多了一个请求**时才记（否则红的那一趟会把上一次的请求误记成这一条的）。
   */
  let singleRowBadUrl = null;
  await section('⑫（brief ⑤）sha512 对不上 ⇒ 目标不落盘、没有 .part 残留', async () => {
    const id = await prepare(dirBad);
    const targetPath = join(dirBad, fx.bad.targetName);
    const beforeListing = listing(dirBad);
    const beforeLocal = sha512Of(badLocal);
    const beforeReqs = downloadLog.length;
    let refused = null;
    try {
      await invoke(MOD_CH.updateMod, id, fx.bad.modid, `${fx.bad.modid}|1.16.1`, {
        mirrorId: fx.bad.mirrorId,
      });
    } catch (error) {
      refused = error;
    }
    const badCall = downloadLog.slice(beforeReqs);
    singleRowBadUrl = badCall.length === 1 ? badCall[0].url : null;
    console.log(`  桩上收到的下载请求：${String(beforeReqs)} → ${String(downloadLog.length)}`);
    console.log(`  ${basename(dirBad)}：${listing(dirBad)}`);
    check('updateMod 抛了', refused !== null, refused?.message ?? '（没有抛）');
    check(
      '理由说的是 sha512 对不上（不是别的失败撞上来的）',
      typeof refused?.message === 'string' && refused.message.includes('sha512 与上游不一致'),
      refused?.message ?? '（没有抛）',
    );
    check(
      '★ 确实去下了字节（请求数 +1）⇒ 拒绝发生在"下完之后比对"那一步，不是这条路没跑起来',
      downloadLog.length === beforeReqs + 1,
      `请求数 ${String(beforeReqs)} → ${String(downloadLog.length)}`,
    );
    check('目标文件**不存在**（对不上就不落盘）', !existsSync(targetPath), listing(dirBad));
    check(
      '★ 没有 `.part` 残留（删 `.part` 是**调用方**的活 —— Ruling 30）',
      !readdirSync(dirBad).some((name) => name.includes('.part')),
      listing(dirBad),
    );
    check('也没有 `.old` 残留', noPartsOrOlds(dirBad), listing(dirBad));
    check('整个目录逐字没变（只有夹具那一份 jar）', listing(dirBad) === beforeListing, listing(dirBad));
    check(
      '夹具那一份的字节也没变',
      sha512Of(badLocal) === beforeLocal,
      `${beforeLocal.slice(0, 16)}…`,
    );
    const state = await invoke(MOD_CH.getState);
    check('失败之后 busy 回到 false（按钮要能再点）', state.busy === false, String(state.busy));
    check(
      '而且 lastRun 里如实记着这一条失败了',
      state.lastRun?.failed?.[0]?.modid === fx.bad.modid && state.lastRun.updated.length === 0,
      JSON.stringify(state.lastRun),
    );
  });

  // =========================================================================
  // ⑬ = brief ⑥：路径穿越被拒
  // =========================================================================
  await section('⑬（brief ⑥）路径穿越被拒：临时目录之外一个文件都没多', async () => {
    const id = await prepare(dirTrav);
    const outsideBefore = listing(parentRoot);
    const insideBefore = listing(dirTrav);
    const beforeReqs = downloadLog.length;
    let refused = null;
    try {
      await invoke(MOD_CH.updateMod, id, fx.trav.modid, `${fx.trav.modid}|1.16.1`, 'origin');
    } catch (error) {
      refused = error;
    }
    /*
     * `join(dir, '..%2F..%2Fevil.jar')` 那种名字被 `originFileNameOf` 拦住了；
     * **如果它没被拦住**，落点会是这几处（`decodeURIComponent` 之后是 `../../evil.jar`）。
     */
    const escapes = [
      join(dirTrav, 'evil.jar'),
      join(workRoot, 'evil.jar'),
      join(parentRoot, 'evil.jar'),
      join(tmpdir(), 'evil.jar'),
    ];
    console.log(`  父目录：${outsideBefore} → ${listing(parentRoot)}`);
    check('updateMod 抛了（`..%2F..%2Fevil.jar` 不许落盘）', refused !== null, refused?.message ?? '（没有抛）');
    check(
      '理由说的是"推不出安全的文件名"（判据在**文件名**那一层，不是下载之后）',
      typeof refused?.message === 'string' && refused.message.includes('推不出安全的文件名'),
      refused?.message ?? '（没有抛）',
    );
    check(
      '★ 一个请求都没发（拒绝发生在解析文件名那一步，不是"下了之后才发现"）',
      downloadLog.length === beforeReqs,
      `请求数 ${String(beforeReqs)} → ${String(downloadLog.length)}`,
    );
    check(
      '★ `mkdtemp` 的**父目录**逐字没变（清单证明：目标目录之外没有被写任何东西）',
      listing(parentRoot) === outsideBefore,
      `${outsideBefore} → ${listing(parentRoot)}`,
    );
    check('目标那个目录也逐字没变', listing(dirTrav) === insideBefore, listing(dirTrav));
    check(
      '几个可能的逃逸位置都没有 `evil.jar`',
      escapes.every((path) => !existsSync(path)),
      escapes.filter((path) => existsSync(path)).join(' | ') || '（都没有）',
    );
  });

  // =========================================================================
  // ⑭ = brief ⑦：被另一个进程占住 ⇒ 不动任何东西
  // =========================================================================
  await section('⑭（brief ⑦）目标被占住 ⇒ 报「文件被占用」、用户文件不变、没有 .old / .part', async () => {
    const id = await prepare(dirBusy);
    const targetPath = join(dirBusy, fx.busy.targetName);
    const beforeListing = listing(dirBusy);
    const beforeBytes = readFileSync(targetPath);
    const beforeReqs = downloadLog.length;
    const holder = await holdFileExclusively(targetPath);
    console.log(`  占住 ${basename(targetPath)}：${holder.detail}`);
    if (!holder.held) bail(`占住文件的仪器没工作（这一条判据没跑起来）：${holder.detail}`);
    let refused = null;
    try {
      await invoke(MOD_CH.updateMod, id, fx.busy.modid, `${fx.busy.modid}|1.16.1`, {
        mirrorId: fx.busy.mirrorId,
      });
    } catch (error) {
      refused = error;
    }
    /*
     * ⚠️★ **先松开锁再量原文件**：被 `FileShare.None` 占着的时候我们自己的 `readFileSync`
     *    也会 EBUSY ⇒ 那时量到的是一次读失败，不是"字节没变"（brief ⑦ 的原话）。
     */
    await holder.release();
    const afterListing = listing(dirBusy);
    const afterBytes = readFileSync(targetPath);
    console.log(`  ${basename(dirBusy)}：${afterListing}`);
    check('（前置）真的占住了（占不住的话下面几条量的是"根本没锁"）', holder.held, holder.detail);
    check('updateMod 抛了', refused !== null, refused?.message ?? '（没有抛）');
    check(
      '★ 报的是"文件被占用，可能游戏正在运行"（不是别的失败撞上来的）',
      typeof refused?.message === 'string' && refused.message.includes('文件被占用'),
      refused?.message ?? '（没有抛）',
    );
    check(
      '而且说清了"什么都没改"',
      typeof refused?.message === 'string' && refused.message.includes('什么都没改'),
      refused?.message ?? '（没有抛）',
    );
    check(
      '★ 确实去下了字节（请求数 +1）⇒ 失败发生在**就位**那一步，而不是"目标读不动就早退了"',
      downloadLog.length === beforeReqs + 1,
      `请求数 ${String(beforeReqs)} → ${String(downloadLog.length)}`,
    );
    check(
      '★ 用户的目标文件**逐字节没变**（松开锁之后量的）',
      afterBytes.equals(beforeBytes),
      `${String(beforeBytes.length)}B → ${String(afterBytes.length)}B`,
    );
    check(
      '没有 `.old` 残留（挪走的那份要么没挪、要么被放回去了）',
      !readdirSync(dirBusy).some((name) => name.endsWith('.old')),
      afterListing,
    );
    check(
      '★ 也没有 `.part` 残留（Ruling 30：`installDownloadedFile` 不碰它，**调用方**删）',
      !readdirSync(dirBusy).some((name) => name.includes('.part')),
      afterListing,
    );
    check('整个目录逐字没变（连夹具那一份都在）', afterListing === beforeListing, afterListing);
  });

  // =========================================================================
  // ⑮ 入口守卫：两种"忙"都不许进来
  // =========================================================================
  await section('⑮ 入口守卫：v1 批量进行中 / 自己正在写 ⇒ 都不许进来', async () => {
    const id = await prepare(dirSlow);
    const key = `${fx.good.modid}|1.16.1`;
    const targetPath = join(dirSlow, fx.good.targetName);

    /*
     * (a) v1 的一键更新进行中。`updateAll` 的**同步前缀**里就 `bulkRunning = true`，
     *     然后才 `await yieldToEventLoop()` ⇒ 不 await 它、紧接着调 updateMod，
     *     那一枪一定打在"批量进行中"这个窗口里（不是靠 sleep 撞运气）。
     */
    const beforeBulk = downloadLog.length;
    const bulk = invoke(FILE_CH.updateAll);
    let refusedBulk = null;
    try {
      await invoke(MOD_CH.updateMod, id, fx.good.modid, key, { mirrorId: 'probe-slow' });
    } catch (error) {
      refusedBulk = error;
    }
    await bulk;
    check(
      'v1 的一键更新进行中 ⇒ updateMod 立刻拒绝（v1 的教训：批量期间单行也要拒）',
      typeof refusedBulk?.message === 'string' && refusedBulk.message.includes('一键更新'),
      refusedBulk?.message ?? '（没有抛）',
    );
    check(
      '而且那一次一个请求都没发、目标文件也没被创建',
      downloadLog.length === beforeBulk && !existsSync(targetPath),
      `请求数 ${String(beforeBulk)} → ${String(downloadLog.length)}；${listing(dirSlow)}`,
    );

    /*
     * (b) 自己正在写。桩上的 `/mirror-slow/` 先回一半、停 400ms、再回另一半
     *     ⇒ 第一个 updateMod 会**停在下载里**，第二枪才有窗口可打。
     */
    const slow = invoke(MOD_CH.updateMod, id, fx.good.modid, key, { mirrorId: 'probe-slow' });
    await new Promise((resolve) => setTimeout(resolve, 60));
    const midState = await invoke(MOD_CH.getState);
    let refusedBusy = null;
    try {
      await invoke(MOD_CH.updateMod, id, fx.good.modid, key, { mirrorId: 'probe-slow' });
    } catch (error) {
      refusedBusy = error;
    }
    let slowError = null;
    try {
      await slow;
    } catch (error) {
      slowError = error;
    }
    check(
      '（前置）第一个 updateMod 自己成功了（否则下面几条量的是"两次都失败"）',
      slowError === null && existsSync(targetPath) && sha512Of(targetPath) === fx.good.release.sha512,
      slowError?.message ?? listing(dirSlow),
    );
    check('★ 写盘期间 `busy` 是 true（页面据此禁用行内按钮）', midState.busy === true, String(midState.busy));
    check(
      '★ 自己正在写的时候第二次调用被拒（不是排队、也不是同时写两次）',
      typeof refusedBusy?.message === 'string' && refusedBusy.message.includes('正在更新中'),
      refusedBusy?.message ?? '（没有抛）',
    );
    check(
      '★ 慢的那条路径只被请求了 1 次（第二次没有插进来又下一次）',
      slowReqs() === 1,
      `请求数 ${String(slowReqs())}`,
    );
    const state = await invoke(MOD_CH.getState);
    check(
      '跑完之后 busy 回到 false、lastRun 记的是这一条成功',
      state.busy === false && state.lastRun?.updated?.[0] === fx.good.modid,
      JSON.stringify({ busy: state.busy, lastRun: state.lastRun }),
    );
  });

  // =========================================================================
  // ⑯ = brief ⑧：幂等 ⇒ 一个下载请求都不发
  // =========================================================================
  await section('⑯（brief ⑧）幂等：已在位 ⇒ 一个下载请求都不发', async () => {
    const id = await prepare(dirGood);
    const key = `${fx.good.modid}|1.16.1`;
    const targetPath = join(dirGood, fx.good.targetName);
    const beforeReqs = goodReqs();
    let first = null;
    try {
      first = await invoke(MOD_CH.updateMod, id, fx.good.modid, key, {
        mirrorId: fx.good.mirrorId,
      });
    } catch (error) {
      first = error;
    }
    console.log(`  正向那次之后 ${basename(dirGood)}：${listing(dirGood)}`);
    check(
      '（前置）第一次更新成功 —— 这也是"写盘真的能成"的正向读数',
      isState(first) && first.busy === false,
      resultDetail(first),
    );
    check(
      '★ 目标就位，而且 sha512 = 目录里写的那一条',
      existsSync(targetPath) && sha512Of(targetPath) === fx.good.release.sha512,
      listing(dirGood),
    );
    check('旧的那份（good-1.0.jar）被删掉（就位后清旧副本那一步）', !existsSync(goodLocal), listing(dirGood));
    check('没有 `.part` / `.old` 残留', noPartsOrOlds(dirGood), listing(dirGood));
    check(
      '桩上 `/mirror-good/` 的请求数正好 +1',
      goodReqs() === beforeReqs + 1,
      `请求数 ${String(beforeReqs)} → ${String(goodReqs())}`,
    );
    const row = isState(first) ? rowOf(first, dirGood, fx.good.modid) : undefined;
    check(
      '★ 重扫之后这一行读作"已是最新"，而且版本读自**那个文件**（jar 里写的是 9.9.9）',
      row?.verdict?.kind === 'same' &&
        row?.localVersion === SERVED_JAR_VERSION &&
        row?.fileName === fx.good.targetName,
      JSON.stringify({
        verdict: row?.verdict?.kind,
        localVersion: row?.localVersion,
        fileName: row?.fileName,
      }),
    );
    check(
      'busy 回到 false、lastRun 记的是成功',
      isState(first) && first.busy === false && first.lastRun?.updated?.[0] === fx.good.modid,
      isState(first) ? JSON.stringify(first.lastRun) : resultDetail(first),
    );

    // ---- 第二次：同一个目标、同一份字节 ⇒ 一个请求都不许发（spec §7.3 第 4 步）----
    const beforeSecond = goodReqs();
    const bytesBefore = readFileSync(targetPath);
    const listingBefore = listing(dirGood);
    let second = null;
    try {
      second = await invoke(MOD_CH.updateMod, id, fx.good.modid, key, {
        mirrorId: fx.good.mirrorId,
      });
    } catch (error) {
      second = error;
    }
    check(
      '★ 第二次 updateMod 成功返回（不是靠抛错"恰好"没下载）',
      isState(second),
      resultDetail(second),
    );
    /*
     * ★ **(e)**（2026-10-03 复审）：**空转不许冒充"已更新"** —— 这一趟一个字节都没写，
     *   所以它必须落在 `lastRun.skipped` 里（带一句为什么），而 `updated` 要是空的；
     *   否则界面会说"已更新 1 项"，而盘上什么都没变。
     */
    check(
      '★ 空转如实报成 `skipped`（`lastRun.updated` 空着，说清"已经是这一份"）',
      isState(second) &&
        second.lastRun?.updated?.length === 0 &&
        second.lastRun?.skipped?.[0]?.modid === fx.good.modid &&
        second.lastRun.skipped[0].reason.includes('已经是这一份'),
      isState(second) ? JSON.stringify(second.lastRun) : resultDetail(second),
    );
    check(
      '★★ 一个下载请求都没发（桩上的请求数没动）',
      goodReqs() === beforeSecond,
      `请求数 ${String(beforeSecond)} → ${String(goodReqs())}`,
    );
    check(
      '★★ 而且目录逐字节没变（不是"下了、又写回同样的字节"）',
      listing(dirGood) === listingBefore && readFileSync(targetPath).equals(bytesBefore),
      listing(dirGood),
    );
  });

  // =========================================================================
  // ⑯b（收口波）清 `.part` 残留**只清自己那一种命名**
  // =========================================================================
  /*
   * ⚠️★ 这一条补的是一个**可达的越界**：v1 的半成品命名恰好是 `${targetPath}.part`
   *    （`file-updates.ts` 的 `runUpdate`），而它同时满足"`<targetName>.` 开头、`.part` 结尾"
   *    ⇒ 只按前缀+后缀扫的实现会把**v1 正在下载的那个文件**删掉（v1 随后 rename 的就是它）。
   *    可达的理由（⚠️★ T6 之后只剩这一条路）：v1 自己的 `bind`
   *    （`FILE_UPDATES_CHANNELS.bind`）可以把一个**已经在某个已绑定文件夹里**的 jar 绑成
   *    它的一个 `item`（§13.1 的迁移**每次 `bindFolder` 都跑** —— `mod-folders.ts` 里那一句
   *    在 `if (st.folders[folderId] === undefined)` 那个守卫**之外**；⚠️ 这条注释原来写的是
   *    "只在新绑那个文件夹时跑一次"，那是**不精确**的，最终修复波改准 —— 而它的可达性结论
   *    不受影响：迁移只处理**那一刻**已经落在文件夹里的 `items`，此后 v1 照绑）
   *    ⇒ 同一个文件可以同时是 v1 的 `item` 与本模块文件夹里的一行 ⇒ 两个模块可以同时
   *    对同一个目标名下载。（T6 之前还有第二条来源：`attributeLegacyItems` 把文件夹外的
   *    v1 绑定多写一份到 `catalogBindings` —— 那个函数随 D8 退役了。）
   * ⚠️ 两条读数都必须在**同一趟真下载**上取（`/mirror-good/` 请求数 +1 是那趟真的跑了）：
   *    · v1 那一种命名的文件**还在**且字节没变；
   *    · 本模块自己那一种命名（`<target>.<uuid>.part`）**被清掉**。
   *    只断言前者的实现（"什么都不清"）会在后者上红；只断言后者（现在的实现）会在前者上红。
   */
  await section('⑯b（收口波）`.part` 残留只清自己那一种命名（v1 的半成品不许删）', async () => {
    const dir = join(workRoot, 'mods-parts');
    mkdirSync(dir);
    writeFileSync(join(dir, 'parts-1.0.jar'), probeJar(fx.good.modid, FIXTURE_JAR_VERSION));
    const id = await prepare(dir);
    const targetPath = join(dir, fx.good.targetName);
    /** v1 的命名（`installDownloadedFile` 之外那一套：`${targetPath}.part`）。 */
    const v1Part = `${targetPath}.part`;
    /** 本模块的命名（`randomUUID()` 的形状 —— 小写、带四个连字符）。 */
    const ownPart = `${targetPath}.11111111-2222-3333-4444-555555555555.part`;
    writeFileSync(v1Part, 'v1-half-downloaded-bytes');
    writeFileSync(ownPart, 'our-stale-part');
    const v1Bytes = readFileSync(v1Part);
    const beforeReqs = goodReqs();
    let state = null;
    try {
      state = await invoke(MOD_CH.updateMod, id, fx.good.modid, `${fx.good.modid}|1.16.1`, {
        mirrorId: fx.good.mirrorId,
      });
    } catch (error) {
      state = error;
    }
    console.log(`  ${basename(dir)}：${listing(dir)}`);
    check(
      '（前置）这一趟真的走完了写盘：目标就位、字节 = 目录里那一条、请求 +1',
      isState(state) &&
        existsSync(targetPath) &&
        sha512Of(targetPath) === fx.good.release.sha512 &&
        goodReqs() === beforeReqs + 1,
      `${resultDetail(state)}；请求 ${String(beforeReqs)} → ${String(goodReqs())}`,
    );
    check(
      '★★ v1 那种命名的半成品（`<target>.part`）**还在**、字节也没变（那是别人正在下载的文件）',
      existsSync(v1Part) && readFileSync(v1Part).equals(v1Bytes),
      listing(dir),
    );
    check(
      '★ 而本模块自己那种命名的残留（`<target>.<uuid>.part`）被清掉了',
      !existsSync(ownPart),
      listing(dir),
    );
  });

  // =========================================================================
  // ⑰ 第一部分（目录行）走的是同一段写盘
await section('⑱ 同名旧文件被换掉 ⇒ `.old` 被删掉；旧副本删不掉 ⇒ 报告"部分成功"', async () => {
    const dir = join(workRoot, 'mods-partial');
    mkdirSync(dir);
    const targetPath = join(dir, fx.good.targetName);
    // 同名、不同字节（同一个 mod 的另一种构建）⇒ 走"先挪成 .old"那一支
    writeFileSync(targetPath, probeJar(fx.good.modid, FIXTURE_JAR_VERSION, true));
    // 旧副本（版本更低 ⇒ 被 planner 归到 `oldCopies`），下面会被另一个进程占住
    const lockedOld = join(dir, 'old-0.5.jar');
    writeFileSync(lockedOld, probeJar(fx.good.modid, '0.5.0'));
    const beforeLocked = readFileSync(lockedOld);

    const id = await prepare(dir);
    const holder = await holdFileExclusively(lockedOld);
    console.log(`  占住旧副本 ${basename(lockedOld)}：${holder.detail}`);
    if (!holder.held) bail(`占住文件的仪器没工作（这一条判据没跑起来）：${holder.detail}`);
    const beforeReqs = goodReqs();
    let state = null;
    try {
      state = await invoke(MOD_CH.updateMod, id, fx.good.modid, `${fx.good.modid}|1.16.1`, {
        mirrorId: fx.good.mirrorId,
      });
    } catch (error) {
      state = error;
    }
    await holder.release();
    const afterListing = listing(dir);
    console.log(`  ${basename(dir)}：${afterListing}`);
    check(
      '★ updateMod **没有抛**（新文件已经就位 ⇒ 判失败是对用户说反话）',
      isState(state),
      resultDetail(state),
    );
    check(
      '★ 目标就位、字节 = 目录里那一条',
      existsSync(targetPath) && sha512Of(targetPath) === fx.good.release.sha512,
      afterListing,
    );
    check(
      '★ 挪走的那个 `.old` 被删掉了（目录里一个 `.old` 都没有）',
      !readdirSync(dir).some((name) => name.endsWith('.old')),
      afterListing,
    );
    check(
      '删不掉的那份旧副本**还在**、而且逐字节没变（"部分成功" = 新文件在位、旧的没删掉）',
      existsSync(lockedOld) && readFileSync(lockedOld).equals(beforeLocked),
      afterListing,
    );
    check(
      '★ 而且**说出来**了（notices 里有一条"部分成功"）',
      isState(state) && state.notices.some((note) => note.includes('部分成功')),
      isState(state) ? JSON.stringify(state.notices) : resultDetail(state),
    );
    check(
      'lastRun 记的是**成功**（不是失败）',
      isState(state) &&
        state.lastRun?.updated?.[0] === fx.good.modid &&
        state.lastRun.failed.length === 0,
      isState(state) ? JSON.stringify(state.lastRun) : resultDetail(state),
    );
    check(
      '只发了 1 个请求',
      goodReqs() === beforeReqs + 1,
      `请求数 ${String(beforeReqs)} → ${String(goodReqs())}`,
    );
  });

  // =========================================================================
  // ⑲ ★ Ruling 47：`newer` / `manual` 的行**在动盘之前**就要拒
  // =========================================================================
  /*
   * 这一条补的是评审判修 1：`official` 对**每一种判定**都非空，而写路径读的正是它 ⇒
   * 在一个 `newer` 行（本地比清单里更**新**）上，写路径会下更旧的那条 official、
   * 把用户更新的 jar 挪成 `.old` **再删掉** —— D1 的"只升不降"就只剩远程页面在执行了。
   *
   * ⚠️ 两个夹具的**前提**必须各自先立住（不然下面两条会因为别的原因"绿"）：
   *   · `newer`：判定的确算出 `newer`（本地 jar 的内部版本比 release 更新、两边主体都可排序）；
   *   · `manual`：这一行的 `manual` 的确是 `true`（那条 release 的 `download` 是 `manual`）。
   * ⚠️ 而"目标文件逐字节不变"这一句**单独是恒真的**（什么都没干当然没变）⇒
   *   它必须与"一个请求都没发"和**拒的原文**配对，才是在证"闸在动盘之前拦住了"。
   *   （"闸真的会红"由报告里那把刀给：去掉拒绝 ⇒ 这一整段红。）
   */
  await section('⑲（★ Ruling 47）`newer` / `manual` 的行：拒绝、一个请求都不发、盘上没动', async () => {
    const dirNewer = join(workRoot, 'mods-newer');
    mkdirSync(dirNewer);
    const newerTarget = join(dirNewer, fx.newer.targetName);
    // 本地这一份**比 release 更新**（99.0.0 vs 目录里那条），字节也与 official 不同
    writeFileSync(newerTarget, probeJar(fx.newer.modid, '99.0.0', true));
    const newerId = await prepare(dirNewer);
    const newerState = await invoke(MOD_CH.getState);
    const newerRow = rowOf(newerState, dirNewer, fx.newer.modid);
    const newerBefore = readFileSync(newerTarget);
    const beforeNewerReqs = downloadLog.length;
    let newerRefused = null;
    try {
      await invoke(MOD_CH.updateMod, newerId, fx.newer.modid, `${fx.newer.modid}|1.16.1`, {
        mirrorId: fx.newer.mirrorId,
      });
    } catch (error) {
      newerRefused = error;
    }
    check(
      '（前置）这一行的判定真的是 `newer`（夹具成立：本地比清单里那条更新）',
      newerRow?.verdict?.kind === 'newer' && newerRow?.official !== null,
      `verdict=${String(newerRow?.verdict?.kind)} official=${String(newerRow?.official?.version)}`,
    );
    check(
      '★ `newer` 的行 ⇒ 拒（D1 的"只升不降"由**主进程**兜住，不再只靠页面）',
      typeof newerRefused?.message === 'string' && newerRefused.message.includes('newer'),
      newerRefused?.message ?? '（没有抛）',
    );
    check(
      '★ 而且**一个请求都没发**（闸在就位/下载之前 ⇒ 更旧的那条 official 从来没被取过）',
      downloadLog.length === beforeNewerReqs,
      `请求数 ${String(beforeNewerReqs)} → ${String(downloadLog.length)}`,
    );
    check(
      '用户手里那份**逐字节没变**（没有被挪成 `.old`、更没有"挪走再删掉"）',
      readFileSync(newerTarget).equals(newerBefore),
      `${listing(dirNewer)}；sha512 ${sha512Of(newerTarget).slice(0, 16)}…`,
    );
    check('没有 `.old` / `.part` 残留', noPartsOrOlds(dirNewer), listing(dirNewer));

    // ---- `manual`（spec §8：这种行连更新按钮都不该有） ----
    const dirManual = join(workRoot, 'mods-manual');
    mkdirSync(dirManual);
    // ⚠️ 本地版本故意写**很低**（0.0.1）⇒ 判定不会是 `newer` ⇒ **只有 `manual` 那道闸能拒它**
    //    （不然这一条会被 `newer` 那道闸"顺手"拦住，读数就分不清是哪一条在起作用）
    writeFileSync(join(dirManual, 'manual-1.0.jar'), probeJar(fx.manual.modid, '0.0.1'));
    const manualId = await prepare(dirManual);
    const manualState = await invoke(MOD_CH.getState);
    const manualRow = rowOf(manualState, dirManual, fx.manual.modid);
    const beforeManualReqs = downloadLog.length;
    let manualRefused = null;
    try {
      await invoke(MOD_CH.updateMod, manualId, fx.manual.modid, `${fx.manual.modid}|1.16.1`, {
        mirrorId: fx.manual.mirrorId,
      });
    } catch (error) {
      manualRefused = error;
    }
    check(
      '（前置）这一行真的是 `manual`，**而且判定不是 `newer`**（⇒ 拒它的只能是 manual 那道闸）',
      manualRow?.manual === true && manualRow?.verdict?.kind !== 'newer',
      `manual=${String(manualRow?.manual)} verdict=${String(manualRow?.verdict?.kind)}`,
    );
    check(
      '★ `manual` 的行 ⇒ 拒（只给"打开原网页"的那一类不许装）',
      typeof manualRefused?.message === 'string' && manualRefused.message.includes('manual'),
      manualRefused?.message ?? '（没有抛）',
    );
    check(
      '而且一个请求都没发、临时目录里也没有目标文件',
      downloadLog.length === beforeManualReqs &&
        !existsSync(join(dirManual, fx.manual.targetName)),
      `请求数 ${String(beforeManualReqs)} → ${String(downloadLog.length)}；${listing(dirManual)}`,
    );
    check('两次拒绝之后 `busy` 回到 false（拒绝不该把模块卡在忙态）', manualState.busy === false, String(manualState.busy));
  });

  // =========================================================================
  // ⑳ ★ Ruling 48：扫描之后被换过的文件不许被覆盖
  // =========================================================================
  /*
   * 这一条补的是判修 2：行视图来自**缓存的**扫描读数 ⇒ 用户在两次扫描之间把那个 jar 换掉之后，
   * 上面那道 `verdict` 闸判的仍然是**旧读数**。修法用的是幂等那一步**本来就要算的那次 sha512**：
   * 盘上的读数与"扫描时那份读数"对不上 ⇒ 拒。
   *
   * ⚠️ 前提同样要先立住：这一行的判定是 `older`（否则 Ruling 47 那道闸会先开火，
   *    而下面那条就会因为**别的原因**绿）；而"状态里记的 sha512"与"盘上现在的 sha512"
   *    必须是**两个不同的读数**（这就是那个洞本身）。
   */
  await section('⑳（★ Ruling 48）扫描之后被换过的文件 ⇒ 拒、一个请求都不发、字节不变', async () => {
    const dirStale = join(workRoot, 'mods-stale');
    mkdirSync(dirStale);
    const targetPath = join(dirStale, fx.good.targetName);
    const bytesAtScan = probeJar(fx.good.modid, FIXTURE_JAR_VERSION);
    writeFileSync(targetPath, bytesAtScan);
    const id = await prepare(dirStale);
    const scannedRow = rowOf(await invoke(MOD_CH.getState), dirStale, fx.good.modid);
    // ★ 扫描之后**用户自己换掉了那个 jar**（同名、同 modid、不同字节）
    const bytesNow = probeJar(fx.good.modid, FIXTURE_JAR_VERSION, true);
    writeFileSync(targetPath, bytesNow);
    /*
     * ⚠️ 前置读数**必须在开枪之前**取（§5.19 的"前后各读一次"）：
     *    放到调用之后取的话，这一支被判红时读到的已经是**被覆盖之后**的字节，
     *    于是"两个读数不一致"这条前置会跟着红 —— 那不是夹具不成立，是量晚了。
     */
    const diskBefore = readFileSync(targetPath);
    const diskShaBefore = sha512Of(targetPath);
    const beforeReqs = downloadLog.length;
    let refused = null;
    try {
      await invoke(MOD_CH.updateMod, id, fx.good.modid, `${fx.good.modid}|1.16.1`, {
        mirrorId: fx.good.mirrorId,
      });
    } catch (error) {
      refused = error;
    }
    check(
      '（前置）这一行的判定是 `older`（不是 `newer`/`manual` ⇒ 下面拒的不是 Ruling 47 那道闸）',
      scannedRow?.verdict?.kind === 'older',
      `verdict=${String(scannedRow?.verdict?.kind)}`,
    );
    check(
      '（前置）**两个读数真的不一致**：状态里记的是扫描那一刻的 sha512，盘上现在（开枪之前）是另一份',
      scannedRow?.localSha512 === sha512OfBuffer(bytesAtScan) &&
        diskShaBefore === sha512OfBuffer(bytesNow) &&
        scannedRow?.localSha512 !== diskShaBefore,
      `扫描时 ${String(scannedRow?.localSha512).slice(0, 16)}… → 盘上 ${diskShaBefore.slice(0, 16)}…`,
    );
    check(
      '★ 拒（"这个文件在扫描之后变过 ⇒ 先重新扫描再更新"）',
      typeof refused?.message === 'string' && refused.message.includes('扫描之后变过'),
      refused?.message ?? '（没有抛）',
    );
    check(
      '★ 而且**一个请求都没发**（下次之前就看出来了）',
      downloadLog.length === beforeReqs,
      `请求数 ${String(beforeReqs)} → ${String(downloadLog.length)}`,
    );
    check(
      '★ 盘上那份**逐字节没变**（我们不知道它是什么，所以一个字节都不许动）',
      readFileSync(targetPath).equals(diskBefore),
      `${listing(dirStale)}；sha512 ${sha512Of(targetPath).slice(0, 16)}…`,
    );
    check('没有 `.old` / `.part` 残留', noPartsOrOlds(dirStale), listing(dirStale));
    const after = await invoke(MOD_CH.getState);
    check(
      '这一支**在 writeRun 里面**⇒ 失败也留了读数（`lastRun.failed` 里有它，且说的是"扫描之后变过"）',
      after.lastRun?.failed?.[0]?.modid === fx.good.modid &&
        after.lastRun.failed[0].reason.includes('扫描之后变过'),
      JSON.stringify(after.lastRun),
    );
  });

  // =========================================================================
  // ㉑（brief ⑨）★ Task 6：整夹更新**只碰 batchable 的那一行**，其余按原因如实报 skipped
  // =========================================================================
  /*
   * 三条读数合起来才是在证 spec §7.4（少任何一条都会退化成恒真）：
   *   ① 那一行 `batchable` 的**真的被更新了**（目标就位 + 字节 = 目录里那条 + 旧副本被清）
   *      —— 只写"另外两行没动"的话，任何一次"整夹什么都没干"都能让它绿；
   *   ② 另外两行**各自带着自己的原因**进 `lastRun.skipped`（`newer` 与 `different-build`）；
   *   ③ 那两行**一个下载请求都没发**、字节逐字没变 ⇒ "跳过"不是"下了之后又没就位"。
   * ⚠️ 三行的判定**必须在开枪之前各自立住**（`older` / `newer` / `different-build`），
   *    否则"没动"可能只是因为那一行根本没有目标（spec §8 的 `missing-release`）。
   */
  await section('㉑（brief ⑨）整夹更新：只更新 batchable 的那一行，其余如实报 skipped', async () => {
    const dir = join(workRoot, 'mods-batch');
    mkdirSync(dir);
    // ① 可批量：本地 1.0.0 比清单里那条**旧**，两边主体都可排序 ⇒ `older` + `download:auto`
    writeFileSync(join(dir, 'good-1.0.jar'), probeJar(fx.good.modid, FIXTURE_JAR_VERSION));
    // ② `newer`：本地 99.0.0 比清单里那条**新**（`fx.newer` 就是按这条挑的夹具，见上面那段）
    writeFileSync(join(dir, 'newer-99.jar'), probeJar(fx.newer.modid, '99.0.0', true));
    // ③ `different-build`：本地那一份的主体含**非数字段** ⇒ 比较器不可靠 ⇒ 要人显式点一下
    writeFileSync(join(dir, 'busy-1.0.jar'), probeJar(fx.busy.modid, FIXTURE_JAR_VERSION));

    const id = await prepare(dir);
    const before = await invoke(MOD_CH.getState);
    const rows = folderByPath(before, dir)?.rows ?? [];
    const rowFor = (modid) => rows.find((row) => row.modid === modid);
    const kinds = rows.map(
      (row) => `${row.modid}:${row.verdict.kind}${row.batchable ? '+batchable' : ''}`,
    );
    console.log(`  三行的判定：${kinds.join(' | ')}`);
    check(
      '（前置）三行齐了，判定各是 older / newer / different-build',
      rowFor(fx.good.modid)?.verdict.kind === 'older' &&
        rowFor(fx.newer.modid)?.verdict.kind === 'newer' &&
        rowFor(fx.busy.modid)?.verdict.kind === 'different-build',
      kinds.join(' | '),
    );
    check(
      '（前置）**只有第一条**是可批量的（否则"只更新一条"会因为别的行也能批量而红）',
      rows.filter((row) => row.batchable).length === 1 &&
        rowFor(fx.good.modid)?.batchable === true,
      kinds.join(' | '),
    );

    const targetPath = join(dir, fx.good.targetName);
    const goodBefore = goodReqs();
    const newerBefore = reqsOf('/mirror-newer/');
    const busyBefore = reqsOf('/mirror-busy/');
    const newerBytes = readFileSync(join(dir, 'newer-99.jar'));
    const diffBytes = readFileSync(join(dir, 'busy-1.0.jar'));
    let state = null;
    try {
      state = await invoke(MOD_CH.updateFolderAll, id, { mirrorId: fx.good.mirrorId });
    } catch (error) {
      state = error;
    }
    console.log(`  批量之后 ${basename(dir)}：${listing(dir)}`);
    console.log(
      `  lastRun：${isState(state) ? JSON.stringify(state.lastRun) : resultDetail(state)}`,
    );
    check('updateFolderAll 成功返回（不是靠抛错"恰好"没写）', isState(state), resultDetail(state));
    check(
      '★ `lastRun.updated` **只含那一条**（多一条少一条都红）',
      isState(state) &&
        state.lastRun?.updated?.length === 1 &&
        state.lastRun.updated[0] === fx.good.modid,
      isState(state) ? JSON.stringify(state.lastRun?.updated) : resultDetail(state),
    );
    const skipped = isState(state) ? (state.lastRun?.skipped ?? []) : [];
    check(
      '★ 另外两条**如实报成 skipped**（各一条，modid 就是那两行）',
      skipped.length === 2 &&
        skipped.some((entry) => entry.modid === fx.newer.modid) &&
        skipped.some((entry) => entry.modid === fx.busy.modid),
      JSON.stringify(skipped),
    );
    check(
      '★ 而且**原因各自说得清**（`newer` 那条说 newer、`different-build` 那条说 different-build）',
      (skipped.find((entry) => entry.modid === fx.newer.modid)?.reason ?? '').includes('newer') &&
        (skipped.find((entry) => entry.modid === fx.busy.modid)?.reason ?? '').includes(
          'different-build',
        ),
      JSON.stringify(skipped),
    );
    check(
      '`lastRun.failed` 是空的（这一趟没有失败）',
      isState(state) && state.lastRun?.failed?.length === 0,
      isState(state) ? JSON.stringify(state.lastRun?.failed) : resultDetail(state),
    );
    check(
      '★ 可批量那一行**真的装上了**：目标就位、sha512 = 目录里那条',
      existsSync(targetPath) && sha512Of(targetPath) === fx.good.release.sha512,
      listing(dir),
    );
    check('它旧的那份（good-1.0.jar）被清掉', !existsSync(join(dir, 'good-1.0.jar')), listing(dir));
    check(
      '★★ 被跳过的两行**一个下载请求都没发**（`/mirror-newer/` 与 `/mirror-busy/` 计数没动）',
      reqsOf('/mirror-newer/') === newerBefore && reqsOf('/mirror-busy/') === busyBefore,
      `newer ${String(newerBefore)} → ${String(reqsOf('/mirror-newer/'))}；busy ${String(busyBefore)} → ${String(reqsOf('/mirror-busy/'))}`,
    );
    check(
      '★ 而可批量那一行只发了 1 个请求（`/mirror-good/` +1）',
      goodReqs() === goodBefore + 1,
      `请求数 ${String(goodBefore)} → ${String(goodReqs())}`,
    );
    check(
      '★★ 被跳过的两份文件**逐字节没变**（"跳过"不是"下了又没就位"、更不是"挪走再删"）',
      readFileSync(join(dir, 'newer-99.jar')).equals(newerBytes) &&
        readFileSync(join(dir, 'busy-1.0.jar')).equals(diffBytes),
      listing(dir),
    );
    check('没有 `.part` / `.old` 残留', noPartsOrOlds(dir), listing(dir));
    check('跑完之后 `busy` 回到 false', isState(state) && state.busy === false, String(state?.busy));
    const after = isState(state) ? rowOf(state, dir, fx.good.modid) : undefined;
    check(
      '重扫之后那一行读作"已是最新"，而且文件名就是 `originFileNameOf` 推出来的那个',
      after?.verdict?.kind === 'same' && after?.fileName === fx.good.targetName,
      `verdict=${String(after?.verdict?.kind)} fileName=${String(after?.fileName)}（批量前 ${String(rowFor(fx.good.modid)?.fileName)}）`,
    );

    /*
     * ★ 第二趟：**一行都不需要下载**（三行全是 skipped）⇒ 整个批量里**唯一可能让出事件循环的
     *    地方就是那几处 `yieldToEventLoop()`**。在起手之前登记一个 immediate：
     *    · 有让出 ⇒ 它会在批量**还没跑完**的时候先轮到自己（那一刻 `batchFinished` 还是 false）；
     *    · 一次都不让出 ⇒ 函数体在一个 microtask 里就跑完了，那个 immediate 只能等到之后
     *      才轮得到（`batchFinished` 那时已经是 true）⇒ **这一条红**。
     * ⚠️ 它证的是"这一趟里**至少**让出过一次"，**不是**"每条之间各让出一次"——
     *    后者在外部不可观测（让出的次数没有读数）；逐条那一半由代码阅读钉住（循环体末尾那一句）。
     */
    let batchFinished = false;
    let yieldedWhileRunning = false;
    setImmediate(() => {
      yieldedWhileRunning = !batchFinished;
    });
    const beforeSecond = downloadLog.length;
    let second = null;
    try {
      second = await invoke(MOD_CH.updateFolderAll, id, { mirrorId: fx.good.mirrorId }).then(
        (value) => {
          batchFinished = true;
          return value;
        },
      );
    } catch (error) {
      second = error;
    }
    check(
      '★ 批量在跑的过程中**让出过事件循环**（spec §7.4 的 `yieldToEventLoop()`）',
      yieldedWhileRunning === true,
      `起手之前登记的 immediate 在批量跑完之前执行了吗：${String(yieldedWhileRunning)}`,
    );
    check(
      '★ 幂等：第二趟一行都不用下（`updated` 空、三条全在 `skipped` 里）',
      isState(second) &&
        second.lastRun?.updated?.length === 0 &&
        second.lastRun?.skipped?.length === 3,
      isState(second) ? JSON.stringify(second.lastRun) : resultDetail(second),
    );
    check(
      '★ 而且"已经是这一份"那一行**说得出原因**（不是空着一条）',
      (isState(second) ? (second.lastRun?.skipped ?? []) : []).some(
        (entry) => entry.modid === fx.good.modid && entry.reason.includes('已经是这一份'),
      ),
      isState(second) ? JSON.stringify(second.lastRun?.skipped) : resultDetail(second),
    );
    check(
      '★★ 第二趟**一个请求都没发**（桩上的请求总数没动）',
      downloadLog.length === beforeSecond,
      `请求数 ${String(beforeSecond)} → ${String(downloadLog.length)}`,
    );
  });

  // =========================================================================
  // ㉒（brief ⑩）★ Task 6：缺失下载走的是**同一段**（`originFileNameOf` + sha512）
  // =========================================================================
  /*
   * brief 特别点名了"不许拿『文件不在』当判据"—— 那一句**单独是恒真的**（这条通道什么都没干也成立）。
   * ⇒ 这里的读数互相印证：
   *   ① 桩上**真的收到了那一个请求**（`/mirror-bad/` +1）⇒ 拒绝发生在"下完之后比对 sha512"那一步；
   *   ② 拒的**原文**是那条 sha512 的（不是别的失败撞上来的）；
   *   ③ 请求的地址与**单行更新**（⑫）那条**逐字相同** ⇒ 同一条地址解析 + 同一份 `originFileNameOf`
   *      （落盘名就是那个地址的最后一段）。
   */
  await section('㉒（brief ⑩）缺失下载：同一段 originFileNameOf + sha512 ⇒ 坏字节被拒、不落盘', async () => {
    const dir = join(workRoot, 'mods-missing');
    mkdirSync(dir);
    // 这个文件夹里**没有**要下的那个 mod（这里放的是另一行，好让 `prepare` 的 rows 非空）
    writeFileSync(join(dir, 'busy-1.0.jar'), probeJar(fx.busy.modid, FIXTURE_JAR_VERSION));
    const id = await prepare(dir);
    const targetPath = join(dir, fx.bad.targetName);
    const beforeListing = listing(dir);
    const beforeBadReqs = reqsOf('/mirror-bad/');
    const beforeLog = downloadLog.length;
    const view = folderByPath(await invoke(MOD_CH.getState), dir);
    console.log(
      `  缺失下载的目标：${fx.bad.modid}|1.16.1 → ${fx.bad.targetName}（${basename(dir)} 里没有它的行）`,
    );
    let refused = null;
    try {
      await invoke(MOD_CH.downloadMissing, fx.bad.modid, '1.16.1', id, {
        mirrorId: fx.bad.mirrorId,
      });
    } catch (error) {
      refused = error;
    }
    const asked = downloadLog.slice(beforeLog);
    console.log(
      `  桩上收到的下载请求：${String(beforeLog)} → ${String(downloadLog.length)}（${asked.map((entry) => entry.url).join(' ')}）`,
    );
    check(
      '（前置）这个文件夹的行里**没有**要下的那个 modid（"缺失"的定义，spec §7.5）',
      view !== undefined && view.rows.every((row) => row.modid !== fx.bad.modid),
      (view?.rows ?? []).map((row) => row.modid).join(' | '),
    );
    check(
      '★ 拒了，而且理由是 **sha512 对不上**（与单行更新走的是同一条校验）',
      typeof refused?.message === 'string' && refused.message.includes('sha512 与上游不一致'),
      refused?.message ?? '（没有抛）',
    );
    check(
      '★★ 桩上**真的收到了那一个请求**（`/mirror-bad/` +1）⇒ 拒发生在"下完之后比对"，不是这条路没跑起来',
      reqsOf('/mirror-bad/') === beforeBadReqs + 1 && asked.length === 1,
      `请求数 ${String(beforeBadReqs)} → ${String(reqsOf('/mirror-bad/'))}；本次记到 ${String(asked.length)} 条`,
    );
    check(
      '★★ 请求的地址与**单行更新**（⑫）那条逐字相同 ⇒ 同一份 `originFileNameOf` + 同一条地址解析',
      singleRowBadUrl !== null && asked[0]?.url === singleRowBadUrl,
      `${String(asked[0]?.url)} vs ${String(singleRowBadUrl)}`,
    );
    check('★ 目标文件**不存在**（对不上就不落盘）', !existsSync(targetPath), listing(dir));
    check(
      '★ 没有 `.part` 残留（删 `.part` 是**调用方**的活 —— Ruling 30）',
      !readdirSync(dir).some((name) => name.includes('.part')),
      listing(dir),
    );
    check('也没有 `.old` 残留', noPartsOrOlds(dir), listing(dir));
    check('整个目录逐字没变', listing(dir) === beforeListing, listing(dir));
    const after = await invoke(MOD_CH.getState);
    check(
      '这一支在 `writeRun` 里面 ⇒ 失败也留了读数（`lastRun.failed` 里有它、且说的是 sha512）',
      after.lastRun?.failed?.[0]?.modid === fx.bad.modid &&
        after.lastRun.failed[0].reason.includes('sha512'),
      JSON.stringify(after.lastRun),
    );
    check('失败之后 `busy` 回到 false（按钮要能再点）', after.busy === false, String(after.busy));
  });

  // =========================================================================
  // ㉓（brief 之外、但 spec §7.5/§9 要求的三条）缺失下载**起手就拒**的那三支
  // =========================================================================
  /*
   * 这三条都在**动盘之前**（一个请求都不发），而它们各自的"如果坏了会怎么红"互不相同：
   *   ① **已经有它了** ⇒ 拒。这一条是**承重**的：渲染进程加载的是**远程网页**，
   *      主进程不许把"页面只在缺失时才调我"当前提 —— 少了它，一次过期读数就会把同一个 mod
   *      以**另一个文件名**再下一份进同一个目录（游戏会同时加载两份）；
   *   ② **manual**（spec §8：只给"打开原网页"） ⇒ 拒。这是 `assertUpdatable` 那道闸里在
   *      缺失下载这一侧**唯一还成立**的一半（`newer`/`unknown` 要"本地那一份"才判得出来，
   *      而缺失就是没有那一份）；
   *   ③ **这个文件夹的游戏版本 ≠ 要下的那一版** ⇒ 拒。缺失清单按界面选中的版本算，
   *      而"下载到 ▾"选的是另一个文件夹 ⇒ 不判这一条就是**静默装进一个别的游戏版本的目录**。
   */
  await section('㉓ 缺失下载的三条拒绝：已经有它了 / manual / 版本不匹配', async () => {
    const dir = join(workRoot, 'mods-missing-guards');
    mkdirSync(dir);
    writeFileSync(join(dir, 'busy-1.0.jar'), probeJar(fx.busy.modid, FIXTURE_JAR_VERSION));
    const id = await prepare(dir);
    const beforeListing = listing(dir);
    const beforeReqs = downloadLog.length;
    const otherVersion = [...new Set(modCatalog.releases.flatMap((r) => r.targetVersions))].find(
      (version) => version !== '1.16.1',
    );
    if (otherVersion === undefined) bail('目录里只有一个游戏版本 ⇒ 造不出"版本不匹配"那一条');
    const attempts = [
      {
        what: '已经有它了（这个文件夹里有它的行）',
        args: [fx.busy.modid, '1.16.1', id, { mirrorId: fx.busy.mirrorId }],
        expect: '已经有',
      },
      {
        /*
         * ⚠️ 三条都走**镜像**而不是 `'origin'`：桩只对 `/mirror-` 开头的那几条前缀记请求
         *    ⇒ 走 origin 的话"一个请求都没发"这一条**永远量不出差别**（§5.32 ①）。
         */
        what: 'manual（只给打开原网页）',
        args: [fx.manual.modid, '1.16.1', id, { mirrorId: fx.manual.mirrorId }],
        expect: 'manual',
      },
      {
        what: `版本不匹配（文件夹是 1.16.1，要下的是 ${otherVersion}）`,
        args: [fx.bad.modid, otherVersion, id, { mirrorId: fx.bad.mirrorId }],
        expect: '别的游戏版本',
      },
    ];
    for (const attempt of attempts) {
      let refused = null;
      const before = downloadLog.length;
      try {
        await invoke(MOD_CH.downloadMissing, ...attempt.args);
      } catch (error) {
        refused = error;
      }
      check(
        `★ ${attempt.what} ⇒ 拒（理由里说得清是哪一条）`,
        typeof refused?.message === 'string' && refused.message.includes(attempt.expect),
        refused?.message ?? '（没有抛）',
      );
      check(
        `★ ${attempt.what} ⇒ 一个请求都没发`,
        downloadLog.length === before,
        `请求数 ${String(before)} → ${String(downloadLog.length)}`,
      );
    }
    check(
      '三条拒绝之后目录逐字没变（一个文件都没多、也没少）',
      listing(dir) === beforeListing,
      listing(dir),
    );
    check(
      '桩上的请求总数没动（三条都没跑到下载那一步）',
      downloadLog.length === beforeReqs,
      `请求数 ${String(beforeReqs)} → ${String(downloadLog.length)}`,
    );
    const after = await invoke(MOD_CH.getState);
    check('三条拒绝之后 `busy` 回到 false', after.busy === false, String(after.busy));
  });

  // =========================================================================
  // ㉔（spec §7.4 的字面：中途不因为一条失败而停）一条失败**不中断**整批
  // =========================================================================
  /*
   * ⚠️ 夹具的顺序是**载荷性**的：失败的那一行必须排在**前面**（`probe-bad.jar` < `z-good.jar`，
   *    扫描顺序就是文件名字典序）—— 失败排在最后的话，"后面那行还是被更新了"就与
   *    "第一行失败之后整批就停了"分不开（那种夹具**恒真**）。
   * 失败用 **Ruling 48** 那一支（扫描之后文件被换过）：它在 `installRelease` 里拒，
   * 也就是**在整批的 try 里面** —— 正是"一条失败"该有的形态（不是起手那几条整批拒绝）。
   */
  await section('㉔ 一条失败不中断整批：前面的行失败，后面的行照常被更新', async () => {
    const dir = join(workRoot, 'mods-batch-partial');
    mkdirSync(dir);
    // ① **排前面**的那一行：目标名就是 `probe-bad.jar`，扫描之后会被换掉（Ruling 48 会拒）
    const stalePath = join(dir, fx.bad.targetName);
    const bytesAtScan = probeJar(fx.bad.modid, FIXTURE_JAR_VERSION);
    writeFileSync(stalePath, bytesAtScan);
    // ② 排后面的那一行：本地 1.0.0 < 清单里那条 ⇒ `older` + auto ⇒ 可批量，而且能装成功
    writeFileSync(join(dir, 'z-good.jar'), probeJar(fx.good.modid, FIXTURE_JAR_VERSION));

    const id = await prepare(dir);
    const view = folderByPath(await invoke(MOD_CH.getState), dir);
    const rows = view?.rows ?? [];
    check(
      '（前置）两行都可批量，而且**失败那一行排在前面**（否则"没中断"这条恒真）',
      rows.length === 2 && rows.every((row) => row.batchable) && rows[0]?.modid === fx.bad.modid,
      rows.map((row) => `${row.modid}:${row.verdict.kind}${row.batchable ? '+batchable' : ''}`).join(' | '),
    );
    // ★ 扫描之后用户自己把那个 jar 换掉 ⇒ 这一行会在 installRelease 里被拒
    const bytesNow = probeJar(fx.bad.modid, FIXTURE_JAR_VERSION, true);
    writeFileSync(stalePath, bytesNow);
    const goodBefore = goodReqs();
    let state = null;
    try {
      state = await invoke(MOD_CH.updateFolderAll, id, { mirrorId: fx.good.mirrorId });
    } catch (error) {
      state = error;
    }
    console.log(
      `  lastRun：${isState(state) ? JSON.stringify(state.lastRun) : resultDetail(state)}`,
    );
    check('整批**没有抛**（一条失败不许把它变成一次 reject）', isState(state), resultDetail(state));
    check(
      '★ 失败那一行如实进 `lastRun.failed`，说的是"扫描之后变过"',
      isState(state) &&
        state.lastRun?.failed?.length === 1 &&
        state.lastRun.failed[0].modid === fx.bad.modid &&
        state.lastRun.failed[0].reason.includes('扫描之后变过'),
      isState(state) ? JSON.stringify(state.lastRun?.failed) : resultDetail(state),
    );
    check(
      '★★ **后面那一行照常被更新了** ⇒ 整批真的越过了那条失败继续往下跑（spec §7.4）',
      isState(state) &&
        state.lastRun?.updated?.length === 1 &&
        state.lastRun.updated[0] === fx.good.modid &&
        existsSync(join(dir, fx.good.targetName)) &&
        sha512Of(join(dir, fx.good.targetName)) === fx.good.release.sha512,
      isState(state)
        ? `updated=${JSON.stringify(state.lastRun?.updated)}；${listing(dir)}`
        : resultDetail(state),
    );
    check(
      '★ 而且它只发了 1 个请求（失败那条**没有**走到下载那一步）',
      goodReqs() === goodBefore + 1,
      `请求数 ${String(goodBefore)} → ${String(goodReqs())}`,
    );
    check(
      '被拒的那一份**逐字节没变**（我们不知道它是什么 ⇒ 一个字节都不许动）',
      readFileSync(stalePath).equals(bytesNow),
      listing(dir),
    );
    check('没有 `.part` / `.old` 残留', noPartsOrOlds(dir), listing(dir));
    check('整批结束之后 `busy` 回到 false', isState(state) && state.busy === false, String(state?.busy));
  });

  // =========================================================================
  // ㉕ ★ 评审判修：**游戏版本未知**那两条路 + `downloadMissing` 的两条起手拒绝
  // =========================================================================
  /*
   * 评审判修 1 / 2（两条都是**证据**缺口，不是产品缺陷）：
   *
   * ★ **整夹更新在"游戏版本未知"时故意不整体拒绝** —— 它依赖 `planFolderView` 在
   *   `gameVersion === null` 时**对每个 modid 给一行 `unknown-version` 且不可批量**
   *   （`packages/shared/src/modFolders.ts` 的两处短路）。那一段一旦回归（比如有人"顺手"
   *   让它早返回空行），`lastRun` 就会是 `{updated:[],skipped:[],failed:[]}` ——
   *   **正是模块自己在"没扫过 ≠ 它是空的"那一处明令禁止的那种读法**（界面会说"你已经是最新的"）。
   *   ⇒ 夹具：**路径里没有 `.minecraft`**（`resolveGameVersion` 因此给 `null`）且**不手选版本**
   *   的文件夹；断言 `updated` 空、**请求数 0**、`skipped.length === rows.length`、每条 reason
   *   都提到 `unknown-version`、而且这一趟**没有抛**（"逐行如实报"不是"整批拒"）。
   *
   * ★ `downloadMissing` 的两条**起手拒绝**（brief 点名的那两条）此前**一条读数都没有**：
   *   · 文件夹路径现在不是目录（spec §8：路径不存在不给更新按钮）；
   *   · 文件夹的**有效游戏版本未知**（spec §8：未选之前所有行都是 `unknown-version`）。
   *   两条都与 ㉓ 的三条（已经有它了 / manual / 版本不匹配）**不是同一支** —— 这里各给一条读数。
   * ⚠️ 两条调用都走**镜像**（理由同 ㉓：桩只对 `/mirror-` 开头的前缀记请求）。
   */
  await section('㉕ 游戏版本未知：整夹逐行报 unknown-version（不是 0/0/0）+ 缺失下载的两条起手拒绝', async () => {
    // ---- (a) 游戏版本未知的文件夹：只绑、不调 setFolderGameVersion -----------------
    const noVerDir = join(workRoot, 'mods-noversion');
    mkdirSync(noVerDir);
    writeFileSync(join(noVerDir, 'good-1.0.jar'), probeJar(fx.good.modid, FIXTURE_JAR_VERSION));
    writeFileSync(join(noVerDir, 'newer-99.jar'), probeJar(fx.newer.modid, '99.0.0', true));
    // ⚠️ 用 `bindAt`（**不是** `prepare`）：`prepare` 会调 `setFolderGameVersion`，那就没有"未知"了
    const noVerId = await bindAt(noVerDir);
    const noVerView = folderByPath(await invoke(MOD_CH.getState), noVerDir);
    const noVerRows = noVerView?.rows ?? [];
    console.log(
      `  版本未知的夹具：gameVersion=${String(noVerView?.gameVersion)}；行=${noVerRows.map((row) => `${row.modid}:${row.verdict.kind}${row.batchable ? '+batchable' : ''}`).join(' | ')}`,
    );
    check(
      '（前置）这个文件夹的有效游戏版本真的是 `null`（路径里没有 `.minecraft`、也没手选过）',
      noVerView !== undefined && noVerView.gameVersion === null,
      `gameVersion=${String(noVerView?.gameVersion)}（路径 ${noVerDir}）`,
    );
    check(
      '（前置）行**在**，而且每行都是 `unknown-version` + 不可批量（整夹不整体拒所依赖的正是这一条）',
      noVerRows.length === 2 &&
        noVerRows.every((row) => row.verdict.kind === 'unknown-version' && !row.batchable),
      noVerRows.map((row) => `${row.modid}:${row.verdict.kind}`).join(' | '),
    );

    const beforeBatchReqs = downloadLog.length;
    let batchState = null;
    try {
      batchState = await invoke(MOD_CH.updateFolderAll, noVerId, { mirrorId: fx.good.mirrorId });
    } catch (error) {
      batchState = error;
    }
    console.log(
      `  整夹在版本未知的文件夹上：${isState(batchState) ? JSON.stringify(batchState.lastRun) : resultDetail(batchState)}`,
    );
    check(
      '★ 整夹**没有抛**（版本未知不是"整批拒"，而是逐行如实报 —— spec §7.4 的形状）',
      isState(batchState),
      resultDetail(batchState),
    );
    const noVerRun = isState(batchState) ? batchState.lastRun : null;
    check(
      '★ `updated` 是空的（一行都没装）',
      noVerRun?.updated?.length === 0,
      JSON.stringify(noVerRun?.updated),
    );
    check(
      '★★ `skipped` **一条不少**（`skipped.length === rows.length`）—— 不是 0/0/0 那种"看起来已经最新"',
      noVerRun?.skipped?.length === noVerRows.length && noVerRows.length > 0,
      `skipped=${String(noVerRun?.skipped?.length)}，rows=${String(noVerRows.length)}`,
    );
    check(
      '★ 而且每一条 reason 都说得清是 `unknown-version`（不是空着一条）',
      (noVerRun?.skipped ?? []).every((entry) => entry.reason.includes('unknown-version')),
      JSON.stringify(noVerRun?.skipped),
    );
    check(
      '`failed` 是空的（这一趟没有失败）',
      noVerRun?.failed?.length === 0,
      JSON.stringify(noVerRun?.failed),
    );
    check(
      '★★ 一个下载请求都没发（不可批量 ⇒ 连目标都不去取）',
      downloadLog.length === beforeBatchReqs,
      `请求数 ${String(beforeBatchReqs)} → ${String(downloadLog.length)}`,
    );
    check(
      '跑完之后 `busy` 回到 false',
      isState(batchState) && batchState.busy === false,
      String(batchState?.busy),
    );

    // ---- (b) `downloadMissing`：这个文件夹的游戏版本未知 ⇒ 起手拒 ------------------
    const beforeNoVerReqs = downloadLog.length;
    let noVerRefused = null;
    try {
      await invoke(MOD_CH.downloadMissing, fx.bad.modid, '1.16.1', noVerId, {
        mirrorId: fx.bad.mirrorId,
      });
    } catch (error) {
      noVerRefused = error;
    }
    check(
      '★ 缺失下载：文件夹的**有效游戏版本未知** ⇒ 拒，理由说的是这一条',
      typeof noVerRefused?.message === 'string' && noVerRefused.message.includes('游戏版本还不知道'),
      noVerRefused?.message ?? '（没有抛）',
    );
    check(
      '★ 而且一个请求都没发',
      downloadLog.length === beforeNoVerReqs,
      `请求数 ${String(beforeNoVerReqs)} → ${String(downloadLog.length)}`,
    );

    // ---- (c) `downloadMissing`：路径现在不是目录 ⇒ 起手拒 -------------------------
    const goneDir = join(workRoot, 'mods-gone');
    mkdirSync(goneDir);
    writeFileSync(join(goneDir, 'x-1.0.jar'), probeJar(fx.good.modid, FIXTURE_JAR_VERSION));
    // 先绑上（**并且**给了版本 1.16.1）：这样"路径不是目录"就是**唯一**还能拒它的那一条
    const goneId = await prepare(goneDir);
    const goneBefore = listing(goneDir);
    rmSync(goneDir, { recursive: true, force: true });
    const beforeGoneReqs = downloadLog.length;
    let goneRefused = null;
    try {
      await invoke(MOD_CH.downloadMissing, fx.bad.modid, '1.16.1', goneId, {
        mirrorId: fx.bad.mirrorId,
      });
    } catch (error) {
      goneRefused = error;
    }
    /*
     * ⚠️★ 判据必须是"**入口那一句**"（`路径现在不是目录` + `不给下载`），不能只写 `不是目录`：
     *    `installRelease` 自己还有一句"这个位置不是目录（拒绝写盘）" ⇒ 只写那三个字的话，
     *    入口那条闸**删掉之后这一条仍然是绿的**（实测：第一版就是这么写的，刀 K13 只红了 1 条）。
     */
    check(
      '★ 缺失下载：文件夹**路径现在不是目录** ⇒ 拒，而且拒的是**入口那一句**（不是 installRelease 那句）',
      typeof goneRefused?.message === 'string' &&
        goneRefused.message.includes('路径现在不是目录') &&
        goneRefused.message.includes('不给下载'),
      goneRefused?.message ?? '（没有抛）',
    );
    check(
      '★ 而且一个请求都没发',
      downloadLog.length === beforeGoneReqs,
      `请求数 ${String(beforeGoneReqs)} → ${String(downloadLog.length)}`,
    );
    check(
      '★ 那个被删掉的目录**没有被重新建出来**（拒绝发生在任何写盘动作之前）',
      !existsSync(goneDir),
      `${goneBefore} → ${listing(goneDir)}`,
    );
    check(
      '★ 整夹那一趟也没往那个版本未知的文件夹里写任何东西',
      listing(noVerDir) === 'good-1.0.jar | newer-99.jar',
      listing(noVerDir),
    );
    check(
      '两次拒绝之后 `busy` 回到 false',
      (await invoke(MOD_CH.getState)).busy === false,
      '',
    );
  });

  server.close();
  return { workRoot: parentRoot, ok: failures === 0 };
}

// ===========================================================================
// 跑
// ===========================================================================
let result;
if (PHASE === 'state-file') {
  result = await stateFilePhase();
} else if (PHASE === 'prefs') {
  result = await prefsPhase();
} else if (PHASE === 'write') {
  result = await writePhase();
} else {
  result = await mainPhase();
  // 三条 readStateFile 加固的判据在子进程里跑（各要一份全新的模块状态）
  console.log('\n## ⑪ readStateFile 加固（四条，各起一个子进程）');
  for (const c of ['a', 'b', 'c', 'd']) {
    const child = spawnSync(process.execPath, [self, '--phase', 'state-file', '--case', c], {
      stdio: 'inherit',
      cwd: repoRoot,
      env: { ...process.env, MCSR_VERIFY_REEXEC: '1' },
    });
    check(
      `（子进程）case ${c} 的三条判据全成立`,
      child.status === 0,
      `子进程退出码 ${String(child.status)}`,
    );
  }
  // Ruling 37 那两条也各要一份全新的模块状态（"启动时会不会覆盖"是启动那一刻的事）
  //   d = 播种 chosen:true 那一半；e = 自动采纳那一半；f = 探针自己调 setCatalogGameVersion
  //   （写那一半）+ 真重启，g 由 f 自己 spawn。
  console.log('\n## ★ Ruling 37：用户选的游戏版本按机器记住（三条，各起一个子进程）');
  for (const c of ['d', 'e', 'f']) {
    const child = spawnSync(process.execPath, [self, '--phase', 'prefs', '--case', c], {
      stdio: 'inherit',
      cwd: repoRoot,
      env: { ...process.env, MCSR_VERIFY_REEXEC: '1' },
    });
    check(
      `（子进程）prefs case ${c} 的三条判据全成立`,
      child.status === 0,
      `子进程退出码 ${String(child.status)}`,
    );
  }
  /*
   * ★ Task 5：写路径（单行更新 + 四条负向证明）。**也起一个子进程**：它要一套被劫持过的
   * 目录（release 的 url / sha512、镜像表），而目录是启动时抓的、缓存在模块里 ——
   * 与主相位那份目录同进程是验不了的。子进程的逐条读数由它自己打到 stdout（stdio 继承）。
   */
  console.log('\n## ⑫–⑳ 写路径（Task 5）：单行更新与它的负向证明（一个子进程）');
  const writeChild = spawnSync(process.execPath, [self, '--phase', 'write'], {
    stdio: 'inherit',
    cwd: repoRoot,
    env: { ...process.env, MCSR_VERIFY_REEXEC: '1' },
  });
  check(
    '（子进程）写相位的全部判据成立',
    writeChild.status === 0,
    `子进程退出码 ${String(writeChild.status)}`,
  );
}

console.log(`\n  临时目录：${result.workRoot}${KEEP ? '（--keep：保留）' : ''}`);
console.log(`\n结果：${failures === 0 ? '全部成立' : `${String(failures)} 条不成立`}`);
server.close();
if (!KEEP && result.workRoot) rmSync(result.workRoot, { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);
