/**
 * 本地文件自动更新 —— **负向证明的可复跑脚本**（Task 8 把 Task 4 那份住在 `.cache/` 的探针搬进仓库）。
 *
 * ⚠️ 这不是门禁的一部分，也不在任何 `check` / `check:all` 里 —— **它需要网络**：
 *      1. `api.modrinth.com`（取真实版本列表，自己独立算一遍"最新版"当对照）；
 *      2. `cdn.modrinth.com`（真下 27 MB 的 jar —— 这一条负向证明的全部意义就是
 *         "上游给的 sha512 与我们下到的字节对不上" ⇒ **不下真字节就证不了**）。
 *    ⇒ 一次完整运行会下 **两份** 27 MB（负向一次 + 正向对照一次），几分钟。
 *
 * 跑法：
 *   node apps/desktop/scripts/verify-file-updates.mjs                 # 两条都跑
 *   node apps/desktop/scripts/verify-file-updates.mjs --only 2        # 只跑 id 那一条（不下 27 MB）
 *   node apps/desktop/scripts/verify-file-updates.mjs --jar <某个.jar>  # 证明 2 用给定的 jar（默认自己造）
 *   node apps/desktop/scripts/verify-file-updates.mjs --keep          # 保留临时目录
 *
 * ⚠️ 它读的是**构建产物** `apps/desktop/dist/main.cjs`，不是源码：
 *    产物不在（或旧了）就先 `pnpm -F @mcsr/desktop build`（本机 `node` 不是 Electron 时可直接
 *    `node apps/desktop/build.mjs`）。脚本自己会核对产物存在**且不比它的输入旧**
 *    （旧了就退出码 2、拒绝跑），并把它的字节数、打包时间与"输入里最新那份"一起打出来
 *    （§5.41：声称"我验的是产物"之前先证明被测的确实是产物；**只判"在不在"是不够的** ——
 *      一个旧的产物会让两条证明静默地验上一版的代码）。
 *
 * ⚠️★ **没有任何门禁覆盖本文件**（2026-09-24 评审的可选项，实测过）：
 *    `biome.json` 的 `files.includes` 只收了 ts / tsx / json 三类扩展名 ——
 *    `biome check apps/desktop/scripts/verify-file-updates.mjs` 的答复是
 *    "These paths were provided but ignored"（exit 1，`Checked 0 files`）；
 *    而 `apps/desktop/tsconfig.json` 的 `include` 只有 `src` 下的 `.ts` 与 `build.mjs`
 *    （`scripts/dist.mjs` 同此，不是本文件独有）。
 *    ⇒ 本文件**语法烂了、断言写空了，也不会有任何信号**，唯一能发现的是人手动跑一次它自己。
 *      这不是空话：本轮加这一段注释时就踩了一次 —— 在块注释里写 glob（星号后面紧跟斜杠）
 *      会**提前把这个注释关掉**，于是整段变成代码、`node` 报 `Unexpected token '*'`。
 *      没有任何门禁会发现它（`node --check` 也没有人替这个文件跑），是"跑一次"才抓到的。
 *      为什么不把它挂进门禁：它要联网 + 两份 27 MB，挂进去会把 `pnpm check` 从
 *      "几十秒、离线能跑"变成"要网络、要几分钟"。代价写在明处，**别以为它被门禁看着**。
 *
 * ⚠️★ **怎么在没有 Electron 的情况下驱动主进程**：把 `require('electron')` 换成桩
 *    （`Module._load` 钩子），然后把产物 `require` 进来。桩提供的是 `app` / `BrowserWindow` /
 *    `ipcMain` / `dialog` / `screen` / `session` / `shell` 这几样主进程真正用到的东西，
 *    对话框的返回值由脚本**排队预置**（`openQueue` / `messageResponses`）。
 *    全程**不打开窗口**：因此它证不了"真机上的点击、原生对话框长什么样、打包进 asar 之后的路"
 *    —— 那几件在账本 §5.107 的"未验证"里，要人（或 Task 9 的真机跑）才能证。
 *    它也**不碰**用户自己的 mods 目录：所有文件都在 `mkdtemp` 出来的临时目录里。
 *
 * ⚠️ 两条证明都在**临时目录**里、用的是**真字节**：本地那份 jar 由 `fflate.zipSync` 现造
 *    （真的是合法 zip，产品的 `readJarMeta` 读得动），下载的那份是 Modrinth CDN 上的原文件。
 *
 * ⚠️ 三条负向证明里的第三条（目录 JSON 删掉 `modId` ⇒ 接口 500 且点名那个字段）**不在这里**：
 *    它是**服务端**的行为，不是桌面端主进程的。它在本仓有两个可复跑的落点：
 *      · `services/api/src/file-catalog.test.ts`（走真的 `app`，`pnpm -w check` 会跑它）；
 *      · `deploy/verify-file-catalog.sh`（部署后回读：吃一份抓好的响应，能被喂坏响应证明它会红）。
 *    把服务端的判据塞进 `apps/desktop/scripts/` 只会让两边都更难读 —— 这是**有意的分家**。
 *
 * 退出码（与 `deploy/verify-csp.sh` 同一个约定）：
 *   0 = 全部成立；1 = **有条判据不成立**（逐条打印是哪一条）；
 *   2 = 判据**根本没跑起来**（产物不在 / 网络不通 / 前置状态不是"可更新"）
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
// ⚠️⚠️ 先确认跑的是不是真正的 Node（照 `scripts/dist.mjs` 那一段的同一条理由）
// ---------------------------------------------------------------------------
// 经 `pnpm run` 起的脚本里，`node` 可能解析到 **Electron**（这台机器上 pnpm 自己就跑在
// DSH Desktop 里）⇒ argv 被污染、asar 加载器介入。这个脚本会 `require` 一个 CJS 产物、
// 还要往 `globalThis.fetch` 上挂钩子，解释器不是同一个的话错得很难认。
// 修法同先例：发现自己在 Electron 里，就找一个真正的 node 把自己重跑一遍。
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
// fflate 是 `apps/desktop` 的**运行时依赖**（`readJarMeta` 用它），所以能这样拿到；
// 产物里它是被打进去的，这里只是为了让脚本能**自己造**一份真 zip 与**自己读**目标 jar 的 id。
const { strFromU8, strToU8, unzipSync, zipSync } = require('fflate');

const MAIN_CJS = join(desktopRoot, 'dist', 'main.cjs');
const CATALOG_FILE = join(repoRoot, 'content', 'file-catalog.json');
const KEEP = process.argv.includes('--keep');
/**
 * `--only 1|2`：只跑其中一条证明。
 * 为什么要有它：证明 1 一次要下两份 27 MB，而"换一个 jar 再验一次 id 不匹配"（比如拿本机
 * 真实的 lithium jar 跑）与它毫无关系 ⇒ 没有这个开关，第二件事要陪着下 27 MB。
 * ⚠️ 它只影响**跑多长**，不影响任何断言（两条证明各自自足，互不依赖）。
 */
const onlyIndex = process.argv.indexOf('--only');
const only = onlyIndex >= 0 ? (process.argv[onlyIndex + 1] ?? '') : '';
const jarIndex = process.argv.indexOf('--jar');
const jarArg = jarIndex >= 0 ? (process.argv[jarIndex + 1] ?? '') : '';
const UA = 'mcsr-helper-desktop-verify/0.0.3 (+https://mcsrhelper.com)';

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
function sha512OfFile(path) {
  return createHash('sha512').update(readFileSync(path)).digest('hex');
}
function listing(dir) {
  return readdirSync(dir)
    .sort()
    .map((name) => `${name} (${String(statSync(join(dir, name)).size)}B)`)
    .join(' | ');
}
/** 造一份**真的是合法 zip** 的 jar（只有 `fabric.mod.json` 一个条目，够产品读 id/version 用）。 */
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

if (only !== '' && only !== '1' && only !== '2') bail(`--only 只接受 1 或 2，收到「${only}」`);
if (jarArg !== '' && !existsSync(jarArg)) bail(`--jar 给的路径不存在：${jarArg}`);

// ---------------------------------------------------------------------------
// 前置：产物在不在（并把它的读数打出来 —— "我验的是构建产物"要有证据）
// ---------------------------------------------------------------------------
console.log(`# 负向证明：本地文件自动更新（${self}）`);
console.log(`  仓库根：${repoRoot}`);
if (!existsSync(MAIN_CJS)) bail(`构建产物不在：${MAIN_CJS}。先跑 node apps/desktop/build.mjs。`);
const mainStat = statSync(MAIN_CJS);
console.log(
  `  被测产物：${MAIN_CJS}（${String(mainStat.size)}B，打包于 ${mainStat.mtime.toISOString()}）`,
);
/*
 * ⚠️★ **产物必须比它的输入新** —— 只判"在不在"是不够的（2026-09-24 评审的顺手 1）：
 *    下面两条证明读的是 `dist/main.cjs`，一个**旧的**产物会让它们**静默全绿**，
 *    而那时我证明的是"上一版的代码会拒绝"、报告里写的却是"现在的代码会拒绝"。
 *    代价：改完源码不重新构建，本脚本就**拒绝跑**（退出码 2）—— 那正是要的效果。
 *
 * ⚠️★★ 输入集**不许手写一份包清单**（2026-09-24 评审 round 1 的 Important 1）：
 *    第一版只走 `apps/desktop/src/**` + `build.mjs`，而 `build.mjs` 是 `bundle: true`，
 *    `src/file-updates.ts` 又 import 了工作区包 ⇒ **`packages/shared/src/fileUpdates.ts`
 *    会被内联进产物**（构建后的字节里能直接搜到 `compareLocalToLatest` / `needsUpdate` /
 *    `isDisabledPath` / `compareLocalVersions`）。只改 shared 里那个文件、不重建就跑，
 *    守卫照样放行 —— 正是这条守卫要堵的失效形态，只是窄了一格；而被改的恰好是
 *    **证明 1 的 `unknown-local` 前提所依赖的那套规则**。
 *    ⇒ 输入集改成**从产物自己问出来**：读 `dist/main.cjs.map` 的 `sources`
 *      （那是 esbuild 为**这一次构建**写下的真清单，加了新 import 也不会漏），
 *      解析成绝对路径，剔除 `node_modules`（依赖由 lockfile 钉；把它们算进来会让
 *      `pnpm install` 变成一次假警报），再加上 `build.mjs`（打包配置变了产物也该重打）。
 *    代价：产物必须带 sourcemap（`build.mjs` 里 `sourcemap: true` 是现成的）；
 *    它被删掉时退化成一份**兜底清单**（`apps/desktop/src` 下所有 `.ts`、`packages` 下各包的
 *    `src` 目录、加上 `build.mjs` —— 这里**故意不写 glob**：块注释里"星号紧跟斜杠"会提前把
 *    注释关掉，本轮又踩了一次），而"用的哪一种"会打在输出里 ——
 *    兜底是**更窄**的那一种，不是等价物。
 */
function collectInputs() {
  const map = `${MAIN_CJS}.map`;
  if (existsSync(map)) {
    const parsed = JSON.parse(readFileSync(map, 'utf8'));
    const list = (parsed.sources ?? [])
      .map((s) => resolve(dirname(MAIN_CJS), s))
      .filter((p) => !p.includes(`${sep}node_modules${sep}`));
    return { list, how: `dist/main.cjs.map 的 sources（剔掉 node_modules）` };
  }
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
      const dir = join(repoRoot, 'packages', pkg.name, 'src');
      (function walk(inner) {
        if (!existsSync(inner)) return;
        for (const entry of readdirSync(inner, { withFileTypes: true })) {
          const path = join(inner, entry.name);
          if (entry.isDirectory()) walk(path);
          else if (entry.name.endsWith('.ts')) list.push(path);
        }
      })(dir);
    }
  }
  return { list, how: '兜底清单（产物没有 sourcemap）：apps/desktop/src + packages/*/src' };
}
const { list: rawInputs, how: inputSource } = collectInputs();
rawInputs.push(join(desktopRoot, 'build.mjs'));
const artifactInputs = rawInputs.filter((p) => existsSync(p));
const workspaceInputs = artifactInputs.filter((p) => p.includes(`${sep}packages${sep}`)).length;
let newestInput = { path: '(一个输入都没有)', mtimeMs: 0 };
for (const path of artifactInputs) {
  const st = statSync(path);
  if (st.mtimeMs > newestInput.mtimeMs) newestInput = { path, mtimeMs: st.mtimeMs };
}
console.log(`  输入集来源：${inputSource}`);
console.log(
  `  输入里最新的一份：${relative(repoRoot, newestInput.path)}（${new Date(newestInput.mtimeMs).toISOString()}）` +
    `；共 ${String(artifactInputs.length)} 个输入，其中来自工作区包（packages/）的 ${String(workspaceInputs)} 个`,
);
if (mainStat.mtimeMs < newestInput.mtimeMs) {
  bail(
    [
      '产物比它的输入**旧** ⇒ 这两条证明会静默地验证"上一版的代码"：',
      `      产物 ${MAIN_CJS}（${mainStat.mtime.toISOString()}）`,
      `      输入 ${newestInput.path}（${new Date(newestInput.mtimeMs).toISOString()}）`,
      '    先跑 node apps/desktop/build.mjs 再重跑本脚本。',
    ].join('\n'),
  );
}
console.log('  ✓ 产物不比它的输入旧');

const catalogBody = readFileSync(CATALOG_FILE, 'utf8');
const catalog = JSON.parse(catalogBody);
const item = catalog.items[0];
if (!item?.source?.modId) bail(`${CATALOG_FILE} 里第一条没有 source.modId，构造不出判据`);
console.log(`  目录：${String(catalog.items.length)} 条，第一条 id=${item.id} modId=${item.source.modId}`);

// ---------------------------------------------------------------------------
// 桩 electron（主进程真正用到的那几样；对话框的答案由队列预置）
// ---------------------------------------------------------------------------
const workRoot = mkdtempSync(join(tmpdir(), 'verify-file-updates-'));
const userDataDir = join(workRoot, 'userData');
mkdirSync(userDataDir, { recursive: true });

const handlers = new Map();
const pushes = [];
const windows = [];
const dialogCalls = [];
let openQueue = [];
let messageResponses = [];

const app = {
  // ⚠️ 固定 false：打包态会让启动那一路去载 electron-updater（它在 `initUpdater` 里被
  //    `isPackaged` 挡着，这里不想把它拉进来）。代价：这一支**证不了**打包态的启动检查
  //    与 asar 里的相对路径 —— 那要真机（账本 §5.107 的"未验证"）。
  isPackaged: false,
  getAppPath: () => desktopRoot,
  getVersion: () => '0.0.3-verify',
  getName: () => 'mcsr-helper-verify',
  getPath: (name) => (name === 'userData' ? userDataDir : join(userDataDir, `stub-${String(name)}`)),
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

// ---------------------------------------------------------------------------
// 本机 HTTP 桩：只服务 `/api/file-catalog`（形状照 services/api/src/routes/fileCatalog.ts）
// ---------------------------------------------------------------------------
const catalogEtag = `"${createHash('sha256').update(catalogBody).digest('hex').slice(0, 16)}"`;
const server = createServer((req, res) => {
  if (req.url !== '/api/file-catalog') {
    res.writeHead(404).end('no');
    return;
  }
  const validator = { etag: catalogEtag, 'cache-control': 'no-cache' };
  if (req.headers['if-none-match'] === catalogEtag) {
    res.writeHead(304, validator).end();
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', ...validator });
  res.end(catalogBody);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const siteOrigin = `http://127.0.0.1:${String(server.address().port)}`;

// ---------------------------------------------------------------------------
// fetch 钩子：数请求 + 篡改上游给的 sha512（负向证明 1 的全部构造）——
// 只改**期望值**，下载的仍是真实字节，所以"下到的字节与上游给的 sha512 对不上"是实情。
// ---------------------------------------------------------------------------
const realFetch = globalThis.fetch;
let tamperSha512 = false;
let modrinthRequests = 0;
let cdnRequests = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : String(input?.url ?? input);
  if (url.includes('api.modrinth.com')) modrinthRequests += 1;
  if (url.includes('cdn.modrinth.com')) cdnRequests += 1;
  const res = await realFetch(input, init);
  if (!tamperSha512 || !url.includes('api.modrinth.com') || !url.includes('/version')) return res;
  const data = JSON.parse(await res.text());
  for (const version of data) {
    for (const file of version.files ?? []) {
      const real = file.hashes?.sha512;
      if (typeof real === 'string' && real.length > 1) {
        // 改**第一个**十六进制字符：改一个字符就足以让"下到的字节 == 上游写的哈希"不成立
        file.hashes.sha512 = (real[0] === 'a' ? 'b' : 'a') + real.slice(1);
      }
    }
  }
  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  });
};

// ---------------------------------------------------------------------------
// 加载产物（`require('electron')` 换成桩）
// ---------------------------------------------------------------------------
process.env.VITE_DEV_SERVER_URL = siteOrigin;
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return electronStub;
  return originalLoad.call(this, request, ...rest);
};
require(MAIN_CJS);

for (let i = 0; i < 200 && handlers.size < 8; i += 1) {
  await new Promise((r) => setTimeout(r, 25));
}
if (handlers.size < 8) bail(`只注册了 ${String(handlers.size)} 条 invoke 通道（预期 8 条）`);
const invoke = (channel, ...args) => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`没有注册这条通道：${channel}`);
  return fn({}, ...args);
};
/** 本次要验的那一条的视图（按 id 找，不按下标 —— 目录以后多几条时下标就不一定对了）。 */
const itemView = (s) => s.items.find((v) => v.item.id === item.id);

// 通道名从共享常量那份源码里现读（不手抄 —— 抄错一个字母是静默失败）
const desktopSrc = readFileSync(join(repoRoot, 'packages', 'shared', 'src', 'desktop.ts'), 'utf8');
const channelBlock = desktopSrc.slice(
  desktopSrc.indexOf('export const FILE_UPDATES_CHANNELS'),
  desktopSrc.indexOf('} as const satisfies'),
);
const channelNames = [...channelBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]);
const channelKeys = [...channelBlock.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
const byKey = Object.fromEntries(channelKeys.map((k, i) => [k, channelNames[i]]));
if (!byKey.getState || !byKey.bind || !byKey.check || !byKey.update) {
  bail('从 packages/shared/src/desktop.ts 里取不到 FILE_UPDATES_CHANNELS 的键（源码形状变了？）');
}

// ---------------------------------------------------------------------------
// 前置：网络 + 独立算一遍"上游最新版"（下面所有对照值都来自这里，不抄产品代码的结论）
// ---------------------------------------------------------------------------
const versionRes = await realFetch(
  `https://api.modrinth.com/v2/project/${encodeURIComponent(item.source.project)}/version`,
  { headers: { 'user-agent': UA } },
).catch((error) => bail(`打不通 api.modrinth.com：${String(error)}`));
if (!versionRes.ok) bail(`api.modrinth.com 回了 HTTP ${String(versionRes.status)}`);
const allVersions = await versionRes.json();
const releases = allVersions
  .filter(
    (v) =>
      v.version_type === item.source.channel &&
      v.game_versions.includes(item.source.gameVersion) &&
      v.loaders.includes(item.source.loader),
  )
  .sort((a, b) => Date.parse(b.date_published) - Date.parse(a.date_published));
const latest = releases[0];
const latestFile = latest?.files?.find((f) => f.primary === true) ?? latest?.files?.[0];
if (!latest || !latestFile?.hashes?.sha512) {
  bail('上游返回里没有带 sha512 的主文件 —— 负向证明 1 的前提不成立');
}
console.log(
  `  上游：全部 ${String(allVersions.length)} 条；匹配 ${item.source.gameVersion}/${item.source.loader}/${item.source.channel} 的 ${String(releases.length)} 条；最新 = ${latest.version_number}（${latest.date_published}）`,
);
console.log(
  `  上游主文件：${latestFile.filename} ${String(latestFile.size)}B sha512=${latestFile.hashes.sha512}`,
);

// ===========================================================================
// 负向证明 1：上游给的 sha512 对不上 ⇒ 必须拒绝写入，且原文件一个字节不变
// ===========================================================================
async function proofTamperedSha512() {
  console.log('\n## 负向证明 1：上游给的 sha512 改一位 ⇒ 必须拒绝写入，原文件一个字节不变');
  const dir = join(workRoot, 'A-tampered-sha512');
  mkdirSync(dir, { recursive: true });
  /*
   * "本地那一份"故意写成一个**上游没有的版本号**（0.0.1）：`compareLocalToLatest` 会给
   * `unknown-local`，而 `needsUpdate` 认它 ⇒ 这一条是"可更新"的。
   * 不这么做的话，本地版本等于上游最新版时状态是 `current`，`update()` 会在第①步就拒绝 ——
   * 那时"文件没变"是因为**它根本没开始**，这条判据就成了恒真的对照（§5.32①）。
   */
  const localJar = makeJar(join(dir, `${item.id}-local-0.0.1.jar`), {
    id: item.source.modId,
    version: '0.0.1',
  });

  openQueue = [{ canceled: false, filePaths: [localJar] }];
  let state = await invoke(byKey.bind, item.id);
  state = await invoke(byKey.getState);
  const kindAfterBind = itemView(state).state.kind;
  check(
    '（前置）绑上之后状态是"可更新"（本地 0.0.1 不在上游列表里 ⇒ unknown-local）',
    kindAfterBind === 'unknown-local',
    kindAfterBind,
  );
  if (kindAfterBind !== 'unknown-local') {
    bail(`前置不成立：期望 unknown-local，实际 ${kindAfterBind}（那样后面的拒绝会因为别的原因发生，不成证据）`);
  }

  tamperSha512 = true;
  state = await invoke(byKey.check, true); // force ⇒ 不吃 30 分钟缓存，必须拿到**篡改后**的那份
  const tamperedExpected = itemView(state).state.latestSha512;
  const tamperedOk = tamperedExpected !== latestFile.hashes.sha512;
  check(
    '（前置）篡改真的到了契约里（state.latestSha512 与上游真值不同）',
    tamperedOk,
    `篡改后 ${String(tamperedExpected).slice(0, 16)}… vs 真值 ${latestFile.hashes.sha512.slice(0, 16)}…`,
  );
  if (!tamperedOk) bail('篡改没生效（多半是吃了缓存）—— 那这一支验的不是它以为的那个东西');

  const beforeSha = sha512OfFile(localJar);
  const cdnBefore = cdnRequests;
  console.log(`  更新前 ${dir}：${listing(dir)}`);
  console.log(`  原文件 sha512（更新前）：${beforeSha}`);

  let refusal = null;
  try {
    await invoke(byKey.update, item.id);
  } catch (error) {
    refusal = error;
  }

  console.log(`  更新后 ${dir}：${listing(dir)}`);
  /*
   * ⚠️★ 这一格**可能不存在**，所以先看一眼再读（2026-09-24 评审的顺手 2）：
   *    如果 sha512 那道校验被删掉，`update()` 会**成功** —— 新版落到新文件名上，
   *    旧那份被 `rmSync` 删掉 ⇒ 在这里直接 `sha512OfFile(localJar)` 会以 ENOENT **崩掉**，
   *    于是"判据红了"的诊断变成一段栈，而下面那几条准备好的 ✗ 一条都印不出来
   *    （红是红，但红得没法读 —— §5.74 那一族）。
   */
  const afterSha = existsSync(localJar) ? sha512OfFile(localJar) : null;
  console.log(`  原文件 sha512（更新后）：${afterSha ?? '（原文件不见了！）'}`);
  check('更新被拒绝（抛了）', refusal !== null, refusal?.message ?? '（没有抛）');
  check(
    '拒绝的理由是"sha512 与上游不一致"（不是别的失败撞上来的）',
    typeof refusal?.message === 'string' && refusal.message.includes('sha512 与上游不一致'),
    refusal?.message ?? '（没有抛）',
  );
  check(
    '确实去上游下了字节（cdn.modrinth.com 请求数 > 0）⇒ 拒绝发生在"下完之后比对"那一步',
    cdnRequests > cdnBefore,
    `cdn 请求 ${String(cdnBefore)} → ${String(cdnRequests)}`,
  );
  check('原文件还在', existsSync(localJar), listing(dir));
  check(
    '原文件逐字节没变（前后 sha512 相同）',
    afterSha !== null && afterSha === beforeSha,
    afterSha === null
      ? '原文件**不见了** —— 它不是"因为被拒绝才没变"，是被换掉了'
      : `${beforeSha.slice(0, 16)}…`,
  );
  check('没有留下 .part', readdirSync(dir).every((n) => !n.includes('.part')), listing(dir));

  // --- 正向对照：同一个绑定、同一条流程，只把篡改关掉 ⇒ 必须成功 -------------
  console.log('\n## 正向对照：同一套装置，只把"篡改"关掉 ⇒ 更新必须成功');
  tamperSha512 = false;
  state = await invoke(byKey.check, true);
  /*
   * ⚠️ 这一句也要**包一层**（与上面 afterSha 同一个理由，2026-09-24 评审的顺手 2 那一族）：
   *    IPC 那一层的 `update()` 把"失败"翻成 reject ⇒ 上面的 sha512 校验一旦被删掉，
   *    负向那一次就已经把夹具换掉了，这一条会**抛**；不接住的话脚本以未捕获异常收场 ——
   *    前面辛苦印出来的那些 ✗ 会被一段栈盖住（红是红，但读不出是哪几条）。
   */
  let positiveError = null;
  try {
    state = await invoke(byKey.update, item.id);
  } catch (error) {
    positiveError = error;
  }
  const updatedPath = join(dir, latestFile.filename);
  console.log(`  ${dir}：${listing(dir)}`);
  console.log(`  正向那一次之后这一条的读数：${String(itemView(state).localVersion)}`);
  /*
   * ⚠️★ **结果**与"没抛"要一起判（2026-09-24 评审 round 1 的 Important 2）：
   *    第一版 fix round 只留了 `positiveError === null`，把结果断言
   *    （`itemView(state).localVersion === latest.version_number`）降级成了一句打印
   *    ⇒ **"写盘成功了、但内存里的状态/绑定没跟着刷新"这种回归会全绿**
   *    （而这正是 `update()` 最后那三行在做的事：重读 → 回填 `liveLocal` → `rebuildItems`）。
   *    两个条件都留着：前者管"这一步有没有炸"，后者管"炸完之后那一刻的读数对不对"。
   */
  check(
    `正向那一次 update() 没抛，**而且**回给页面的读数就是上游那一版（${latest.version_number}）`,
    positiveError === null && itemView(state).localVersion === latest.version_number,
    positiveError === null ? `localVersion=${String(itemView(state).localVersion)}` : `抛了：${positiveError.message}`,
  );
  check(
    '新文件的 sha512 与上游给的**真值**一致（这一条是负向那一条的对照）',
    existsSync(updatedPath) && sha512OfFile(updatedPath) === latestFile.hashes.sha512,
    existsSync(updatedPath) ? sha512OfFile(updatedPath).slice(0, 16) : '（文件不在）',
  );
}

// ===========================================================================
// 负向证明 2：绑一个 id 不是目录里那个 modId 的 jar ⇒ 必须拒绝，并报出它读到的 id
// ===========================================================================
async function proofWrongModId() {
  console.log('\n## 负向证明 2：绑一个 id 不是 mcsrranked 的 jar ⇒ 必须拒绝，并报出文件里那个 id');
  const dir = join(workRoot, 'B-wrong-mod-id');
  mkdirSync(dir, { recursive: true });
  /*
   * 默认自己造一份（`zipSync`，真的是合法 zip）—— 理由：**不依赖任何本机游戏实例**，
   * 换一台机器也能跑。想拿**真实的第三方 mod jar** 跑就用 `--jar`（例如你 mods 目录里那份
   * lithium；本机实测用的是 `lithium-1.0+backport-0.6.7+1.16.1.jar`，里面 `id=lithium`）。
   * ⚠️ 这份文件会随源码一起公开（`tools/export-public.mjs` 只剔除私有文档与 `tools/`），
   *    所以这里**不写本机的绝对路径** —— 只说文件名与 id（AGENTS.md：公开件里不出现内部路径）。
   *
   * ⚠️★ 文件名**故意不含 mod id**（`foreign-fake.jar`，2026-09-24 评审的必修 1）：
   *    产品的拒绝文案末尾是 `⇒ 不绑定（${basename(picked)}）`，所以只要夹具的文件名里带着
   *    `lithium`，"文案里出现了 lithium"这条断言就**恒真** —— 实现退化成"只印文件名"它照样绿，
   *    而"它报出了**文件里**那个 id"正是这一条要证的事（§5.32① 那一族）。
   *    ⇒ 夹具名去掉 id，**并且**断言钉的是**带标签的形状**（`mod id 是「lithium」`）：
   *      即使拿真实 lithium jar（文件名里就有 lithium）跑，这一条也只认标签那一处。
   */
  const foreignJar = jarArg !== '' ? jarArg : makeJar(join(dir, 'foreign-fake.jar'), {
    id: 'lithium',
    version: '1.0.0',
  });
  const foreignMeta = readJarMeta(foreignJar);
  console.log(`  拿来绑的那份：${foreignJar}`);
  console.log(`  它里面的 fabric.mod.json：id=${foreignMeta.id} version=${foreignMeta.version}`);
  check(
    '（前置）它确实不是目录里要的那个 modId',
    foreignMeta.id !== item.source.modId,
    `${foreignMeta.id} vs ${item.source.modId}`,
  );
  if (foreignMeta.id === item.source.modId) bail('--jar 给的那份就是对的 modId，构造不出这一支');

  /*
   * 先解绑：上一条证明留下了"已绑定"的状态，而这一支要判的正是"绑定失败**不留半条记录**"
   * —— 带着上一条的绑定去判，那两条断言就没有意义了（`--only 2` 时它本来就是空的，无害）。
   */
  const stateBeforeBind = await invoke(byKey.unbind, item.id);
  check(
    '（前置）解绑之后是 unbound（这一支从一个干净的状态开始判）',
    itemView(stateBeforeBind).binding === null && itemView(stateBeforeBind).state.kind === 'unbound',
    `${String(itemView(stateBeforeBind).binding)} / ${itemView(stateBeforeBind).state.kind}`,
  );

  openQueue = [{ canceled: false, filePaths: [foreignJar] }];
  let bindError = null;
  try {
    await invoke(byKey.bind, item.id);
  } catch (error) {
    bindError = error;
  }
  const stateAfterBind = await invoke(byKey.getState);
  check('绑定被拒绝（抛了）', bindError !== null, bindError?.message ?? '（没有抛）');
  /*
   * ⚠️★ 断言钉的是**带标签的形状**，不是"消息里出现过那个 id"（评审的必修 1）：
   *    后者会被夹具自己的文件名满足（文案末尾印了 `basename`）。
   */
  check(
    `拒绝的文案在**标签位置上**报出了文件里的 id：「mod id 是「${foreignMeta.id}」」`,
    typeof bindError?.message === 'string' && bindError.message.includes(`mod id 是「${foreignMeta.id}」`),
    bindError?.message ?? '（没有抛）',
  );
  check(
    `文案也说清了它期待的是「${item.source.modId}」（同样只看标签那一处）`,
    typeof bindError?.message === 'string' && bindError.message.includes(`不是「${item.source.modId}」`),
    bindError?.message ?? '（没有抛）',
  );
  check(
    '状态没有被改成"已绑定"（拒绝就是拒绝）',
    itemView(stateAfterBind).binding === null && itemView(stateAfterBind).state.kind === 'unbound',
    `${String(itemView(stateAfterBind).binding)} / ${itemView(stateAfterBind).state.kind}`,
  );
  const trackingFile = join(userDataDir, 'file-tracking.json');
  const tracked = existsSync(trackingFile)
    ? JSON.parse(readFileSync(trackingFile, 'utf8')).items
    : {};
  check(
    '状态文件里没有这一条（绑定失败不留半条记录）',
    tracked[item.id] === undefined,
    JSON.stringify(tracked[item.id] ?? null),
  );
}

if (only !== '2') await proofTamperedSha512();
else console.log('\n## 负向证明 1（--only 2：跳过）');
if (only !== '1') await proofWrongModId();
else console.log('\n## 负向证明 2（--only 1：跳过）');

// ---------------------------------------------------------------------------
// 收尾
// ---------------------------------------------------------------------------
console.log('\n## 收尾');
const pushesSeen = [...new Set(pushes.map((p) => p.channel))];
check(
  '推送用的是 onStatus 那条通道（页面订阅得上）',
  pushesSeen.includes(byKey.onStatus),
  pushesSeen.join(','),
);
console.log(`  Modrinth 版本列表请求 ${String(modrinthRequests)} 次；CDN 下载 ${String(cdnRequests)} 次`);
console.log(`  临时目录：${workRoot}${KEEP ? '（--keep：保留）' : ''}`);
console.log(`\n结果：${failures === 0 ? '全部成立' : `${String(failures)} 条不成立`}`);
server.close();
if (!KEEP) rmSync(workRoot, { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);
