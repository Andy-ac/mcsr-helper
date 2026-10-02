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
 *   node apps/desktop/scripts/verify-mod-folders.mjs --phase state-file --case a|b|c
 *       ↑ §13.1/`readStateFile` 加固那三条**由主相位自己 spawn 的子进程**跑
 *         （每条要一份全新的模块状态 ⇒ 必须新进程），平时不用手敲。
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
import { spawnSync } from 'node:child_process';
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
import { dirname, join, relative, resolve, sep } from 'node:path';
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
if (PHASE !== 'main' && PHASE !== 'state-file') {
  console.error(`✗ --phase 只接受 main / state-file，收到「${PHASE}」`);
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

if (CASE !== '' && !['a', 'b', 'c'].includes(CASE)) {
  bail(`--case 只接受 a / b / c，收到「${CASE}」`);
}
if (PHASE === 'state-file' && CASE === '') bail('--phase state-file 必须带 --case a|b|c');

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
 * ⚠️ `onStatus` 是**推**的（主进程只 `send`），所以 15 条里进 `main.cjs` 的是 15 次名字、
 *    但 `ipcMain.handle` 只有 14 条 —— 两个数分开打，别混。
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
const mainCounts = countChannels(MAIN_CJS, MOD_CH);
const preloadCounts = countChannels(PRELOAD_CJS, MOD_CH);
console.log(
  `  产物里 mcsr:modfolders-* 的出现：main.cjs 命中 ${String(mainCounts.present)}/15；preload.cjs 命中 ${String(preloadCounts ? preloadCounts.present : '（无 preload.cjs）')}/15`,
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
  shell: { openExternal: () => Promise.resolve() },
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

/** 上游（Modrinth）的**构造**响应：目录里是 5.8.22，上游给 5.8.26（spec §7.2 的真实形状）。 */
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
];

// ---------------------------------------------------------------------------
// 本机 HTTP 桩：只服务 `/api/mod-catalog` 与 `/api/file-catalog`
// ---------------------------------------------------------------------------
const catalogBody = JSON.stringify(modCatalog);
const fileCatalogBody = readFileSync(FILE_CATALOG_FILE, 'utf8');
const server = createServer((req, res) => {
  if (req.url === '/api/mod-catalog') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(catalogBody);
    return;
  }
  if (req.url === '/api/file-catalog') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(fileCatalogBody);
    return;
  }
  res.writeHead(404).end('no');
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const siteOrigin = `http://127.0.0.1:${String(server.address().port)}`;

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

/** 等 14 条 invoke 通道注册好（第 15 条 `onStatus` 是推送、没有 handler）。 */
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

  console.log(`  夹具目录：${workRoot}`);
  console.log(`  A-mods：${listing(modsDir)}`);
  console.log(`  .minecraft/instances/demo：${listing(instanceDir)}`);

  // ---- 预置 v1 状态文件（必须在 require 产物**之前**）---------------------
  /*
   * 两条 v1 绑定要两个**不同的键**，而仓库里那份 `content/file-catalog.json` 只有
   * **一条** item（现读：`items.length === 1`，id = `mcsrranked`）⇒ 第二条用一个合成键。
   * 这是合法的：`readStateFile()` 保留 `items` 里所有键（不按目录剪枝），
   * 而这一条要验的正是"归属只是多写一份 catalogBindings、items 里一个字段都不许动"。
   */
  const insideId = fileCatalog.items[0].id;
  const outsideId = `${insideId}-legacy`;
  if (fileCatalog.items.length === 0) bail(`${FILE_CATALOG_FILE} 里一条 item 都没有，构造不出夹具`);
  const seeded = {
    version: 1,
    items: {
      [insideId]: legacyItem(jarNew, '2.0', sha512Of(jarNew)),
      [outsideId]: legacyItem(legacyJar, '1.5', sha512Of(legacyJar)),
    },
  };
  writeFileSync(stateFile(), JSON.stringify(seeded, null, 2), 'utf8');
  console.log(`  预置 v1 状态文件：items = ${insideId}（落在 A-mods 内）/ ${outsideId}（在 A-mods 外）`);

  loadArtifact();
  const registered = await waitForHandlers();

  // =========================================================================
  await section('① 十四条 invoke 通道都注册了（红的形态：一条都没有）', async () => {
    const expected = Object.values(MOD_CH).filter((name) => name !== MOD_CH.onStatus);
    const missing = expected.filter((name) => !handlers.has(name));
    check(
      `ipcMain.handle 注册了 14 条 mcsr:modfolders-*（onStatus 是推送、不算）`,
      registered && missing.length === 0,
      missing.length === 0
        ? `handlers 共 ${String(handlers.size)} 条`
        : `缺 ${String(missing.length)} 条：${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ' …' : ''}；main.cjs 里命中 ${String(mainCounts.present)}/15（preload.cjs ${String(preloadCounts ? preloadCounts.present : '?')}/15）`,
    );
  });
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
  await section('③ §13.1：落在新绑定文件夹里的 v1 绑定被解除，并如实报告', async () => {
    const onDisk = readStateFileJson();
    check(
      `v1 的 items 里那条（${insideId}，文件在 A-mods 内）已经没了`,
      onDisk?.items?.[insideId] === undefined,
      JSON.stringify(onDisk?.items?.[insideId] ?? null),
    );
    check(
      'catalogBindings 里也没有它（不是搬走、是解绑）',
      !Object.values(onDisk?.catalogBindings ?? {}).some(
        (b) => resolve(b.localPath).toLowerCase() === resolve(jarNew).toLowerCase(),
      ),
      JSON.stringify(Object.keys(onDisk?.catalogBindings ?? {})),
    );
    check(
      'notices 里有「已转为文件夹跟踪：Antigone」（不许静默）',
      (state?.notices ?? []).includes('已转为文件夹跟踪：Antigone'),
      JSON.stringify(state?.notices ?? []),
    );
  });

  // =========================================================================
  await section('④ 归属：文件夹**外面**那条 v1 绑定多写一份到 catalogBindings', async () => {
    const onDisk = readStateFileJson();
    const rowId = `${ANTIGONE}|${state.gameVersion}`;
    const bound = onDisk?.catalogBindings?.[rowId];
    check(
      `catalogBindings['${rowId}'] 指向那个 jar（读 jar 得到 modid ⇒ 归属到这一行）`,
      bound !== undefined &&
        resolve(bound.localPath).toLowerCase() === resolve(legacyJar).toLowerCase(),
      JSON.stringify(bound ?? null),
    );
    check(
      '值形状 = {localPath, localVersion, localSha512, releaseKey: null, autoUpdate: false}',
      bound?.localVersion === '1.5' &&
        bound?.localSha512 === sha512Of(legacyJar) &&
        bound?.releaseKey === null &&
        bound?.autoUpdate === false,
      `${String(bound?.localVersion)} / ${String(bound?.localSha512).slice(0, 12)}… / releaseKey=${String(bound?.releaseKey)} / autoUpdate=${String(bound?.autoUpdate)}`,
    );
    const kept = onDisk?.items?.[outsideId];
    check(
      `v1 的 items 里那条（${outsideId}）**仍在**（多写一份，不是搬走）`,
      kept !== undefined &&
        resolve(kept.localPath).toLowerCase() === resolve(legacyJar).toLowerCase() &&
        kept.autoUpdate === true &&
        kept.lastCheckedAt === 1_700_000_000_000,
      JSON.stringify(kept ?? null),
    );
    check(
      '它 8 个字段一个都没变（v1 的字段不许被剪枝/改写）',
      kept !== undefined &&
        Object.keys(kept).length === 8 &&
        Object.entries(seeded.items[outsideId]).every(([k, v]) => kept[k] === v),
      kept === undefined
        ? '（不见了）'
        : `${String(Object.keys(kept).length)} 个字段：${Object.keys(kept).join(',')}`,
    );
  });

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
  });

  // =========================================================================
  await section('⑦ bindCatalogRow：modid 必须与 rowId 里的一致', async () => {
    openQueue = [{ canceled: false, filePaths: [foreignJar] }];
    let refused = null;
    try {
      await invoke(MOD_CH.bindCatalogRow, `${ANTIGONE}|1.16.1`);
    } catch (error) {
      refused = error;
    }
    check(
      '拿一个 modid=lithium 的 jar 去绑 antigone 那一行 ⇒ 拒绝',
      refused !== null,
      refused?.message ?? '（没有抛）',
    );
    check(
      '拒绝的文案报出它读到的 modid（用户才知道是自己选错了文件）',
      typeof refused?.message === 'string' && refused.message.includes('lithium'),
      refused?.message ?? '（没有抛）',
    );
    openQueue = [{ canceled: false, filePaths: [bindJar] }];
    let ok = true;
    try {
      state = await invoke(MOD_CH.bindCatalogRow, `${ANTIGONE}|1.16.1`);
    } catch (error) {
      ok = false;
      check('（正例）modid 一致的 jar ⇒ 绑定成功', false, error?.message ?? '');
    }
    if (ok) {
      const onDisk = readStateFileJson();
      const bound = onDisk?.catalogBindings?.[`${ANTIGONE}|1.16.1`];
      check(
        '写进 catalogBindings[rowId]，值是 {localPath, localVersion: 2.0.0, localSha512, releaseKey: null, autoUpdate: false}',
        bound !== undefined &&
          resolve(bound.localPath).toLowerCase() === resolve(bindJar).toLowerCase() &&
          bound.localVersion === '2.0.0' &&
          bound.localSha512 === sha512Of(bindJar) &&
          bound.releaseKey === null &&
          bound.autoUpdate === false,
        JSON.stringify(bound ?? null),
      );
      check(
        '第一部分的这一行读得到那个绑定（页面不必自己记一份）',
        state.catalogRows.find((r) => r.rowId === `${ANTIGONE}|1.16.1`)?.binding?.localPath ===
          bindJar,
        String(state.catalogRows.find((r) => r.rowId === `${ANTIGONE}|1.16.1`)?.binding?.localPath),
      );
    }
    let bad = null;
    try {
      await invoke(MOD_CH.bindCatalogRow, `${ANTIGONE}`);
    } catch (error) {
      bad = error;
    }
    check(
      'rowId 里没有「|」⇒ 拒绝（不猜是哪一行）',
      bad !== null,
      bad?.message ?? '（没有抛）',
    );
  });

  // =========================================================================
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

    state = await invoke(MOD_CH.setTagFilter, ['legal']);
    check(
      'setTagFilter(["legal"]) ⇒ 每一行都带这个标签，且状态里记着它',
      state.tagFilter.length === 1 &&
        state.tagFilter[0] === 'legal' &&
        state.catalogRows.every((r) => r.tags.includes('legal')),
      `tagFilter=${JSON.stringify(state.tagFilter)}；rows=${String(state.catalogRows.length)}`,
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
    state = await invoke(MOD_CH.unbindFolder, id);
    check(
      'unbindFolder 之后它没了',
      state.folders.find((f) => f.folderId === id) === undefined,
      String(state.folders.length),
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

  const seed = CASE === 'a' ? bad : CASE === 'b' ? missing : good;
  const seededBytes = JSON.stringify(seed, null, 2);
  writeFileSync(stateFile(), seededBytes, 'utf8');
  console.log(`  预置状态文件（case ${CASE}）：${seededBytes.length} 字节`);

  loadArtifact();
  const registered = await waitForHandlers();
  check('（前置）这一相位也把 14 条通道注册起来了', registered);

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

  server.close();
  if (!KEEP) rmSync(workRoot, { recursive: true, force: true });
  return { workRoot };
}

// ===========================================================================
// 跑
// ===========================================================================
let result;
if (PHASE === 'state-file') {
  result = await stateFilePhase();
} else {
  result = await mainPhase();
  // 三条 readStateFile 加固的判据在子进程里跑（各要一份全新的模块状态）
  console.log('\n## ⑪ readStateFile 加固（三条，各起一个子进程）');
  for (const c of ['a', 'b', 'c']) {
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
}

console.log(`\n  临时目录：${result.workRoot}${KEEP ? '（--keep：保留）' : ''}`);
console.log(`\n结果：${failures === 0 ? '全部成立' : `${String(failures)} 条不成立`}`);
server.close();
if (!KEEP && result.workRoot) rmSync(result.workRoot, { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);
