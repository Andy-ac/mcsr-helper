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
  lstatSync,
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
import { homedir, tmpdir } from 'node:os';
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
if (PHASE === 'prefs' && !['d', 'e', 'f', 'g', 'h', 'i', 'j'].includes(CASE)) {
  bail(`--phase prefs 的 --case 只接受 d / e / f / g / h / i / j，收到「${CASE}」`);
}
if (PHASE === 'prefs' && CASE === '') bail('--phase prefs 必须带 --case d|e|f|g|h|i|j');

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
  /*
   * ★★ 2026-10-11（D1 / T5）**收窄了"值"的判据** —— 这一处**咬过两次**（T4 亲自踩到）：
   *    原来数的是**块里所有** `'…'`（`/'([^']+)'/g`）⇒ 那两个常量上面的**注释里**
   *    只要出现一对半角单引号（例如解释某个键名时顺手打了个 `'`），就凭空多出一个"值"
   *    ⇒ `键/值数量对不上（24 vs 26）` ⇒ **`bail`（退出码 2）**，而那句话长得像"探针坏了 /
   *    这条检查没跑起来"，与真因（"我在注释里打了个引号"）隔着好几层（§5.74 那一族：
   *    "没跑起来"必须与"没通过"分得开，而这里连"是注释的问题"都看不出来 ✗）。
   *    ⇒ 判据收窄成"**只数通道串**"（`mcsr:` 开头）。⚠️ 收窄**没有削弱**这条守卫：
   *      它要抓的是"少写 / 多写 / 拼错了一条通道" —— 那三种里任何一种都会让**通道串的数**
   *      与**键的数**不等 ⇒ 照样 `bail`（下面那句一个字节没改）。
   *      ⚠️ 拼错**前缀**（把 `mcsr:` 写成 `mcsr-`）时它数出来是 0 条 ⇒ 也走 `bail` ✓。
   *    ★ 这条守卫**拔红过一次**（`.cache/t5-channels-guard.mjs`：把同一个 `slice` + 正则
   *      搬进一个独立脚本，喂"删掉一条通道的值"的源码 ⇒ `bail`；喂"注释里多一对引号"的源码
   *      ⇒ 旧判据红、新判据绿）—— 证据在 T5 的报告里。
   *    ⚠️★★ **这一处连续写错两次**（现场，两个错法值得都留一句 —— 它们正是这个脚本要防的形状）：
   *      · 第一版 `/'mcsr:[^']*'/g` **漏了捕获组** ⇒ `m[1]` 全是 `undefined` ⇒ 24 个通道的值
   *        **全是空串**，而"数出 24 个"**照样成立** ⇒ 上半段一条判据都不红，红的是**下游**
   *        （`命中 0/24`、`0 条是推送`、`缺 24 条：, , ,`）；
   *      · 第二版补了捕获组 `/'mcsr:([^']*)'/g` ⇒ **把 `mcsr:` 前缀切掉了**
   *        （值变成 `modfolders-get-state`）⇒ 通道名一个都对不上（`invoke` 会"没有注册这条通道"）。
   *      ⇒ **正解是"数用收窄的正则、取值取整个匹配"**（`m[0].slice(1, -1)`）：两个错法的共同点
   *        都是"**数量对**" —— 所以下面那条守卫**不只数个数**，它还把组出来的值逐一与源码里的
   *        字面串对照（见 `.cache/t5-channels-guard.mjs` 的工况 ⑥，它第一版也漏了这一步 ⇒ 没抓到）。
   */
  const names = [...block.matchAll(/'mcsr:[^']*'/g)].map((m) => m[0].slice(1, -1));
  const keys = [...block.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
  if (names.length !== keys.length || names.length === 0) {
    bail(`${constName} 的键/值数量对不上（${String(keys.length)} 个键 vs ${String(names.length)} 条 mcsr: 通道串）`);
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
 *    之后是 **14** 个成员；**C 的 T3** 加了 `onProgress` 之后是 **15** 个；
 *    **C 的 T4** 加了 `cancelDownload` 之后是 **16** 个；**B2 的 T4** 加了 `downloadPack` 之后是 **17** 个；
 *    ★ **D1 的 T4** 加了那七条之后是 **24** 个）：**24** 个通道名
 *    进 `main.cjs`（两条推送的串也在里面 —— 它们是主进程 `send` 出去的），
 *    其中 `ipcMain.handle` 只有 **22** 条 —— 余下 2 条（`onStatus` / `onProgress`）只**推**（`send`）。
 *    ⚠️★ 口径与**数法**：这里说的是**本族**的 handler 数 ——
 *    **数法：契约成员数 − 2 条推送**（`onStatus` / `onProgress`，就是下面那个 `PUSH_CHANNELS`）；
 *    或者数"`main.cjs` 加载之后 `handlers` 里本族通道的条数"（`waitForHandlers()` 用的就是它）。
 *    ⚠️ **不要**拿 `grep "ipcMain.handle(MOD_FOLDERS_CHANNELS\."` 去数：本族有 **5 条注册是跨行写的**
 *    （`ipcMain.handle(` 换行之后才是 `MOD_FOLDERS_CHANNELS.<成员>`）⇒ 朴素 grep 会数出一个
 *    **比真值小**的数，然后下一个人以为注释又漂了。
 *    ⚠️ 也**不是**下面那个 `handle:` 读数 —— 那一个是**整份 `main.cjs`** 里 `ipcMain.handle(`
 *    的出现次数（含别的通道族），两个数**不该相等**（§5.15 那一族：同一个名字两种口径就会有人对不上）。
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

/**
 * ★★ (C/S4) `webContents.send` 的**可替换**那一层 —— 让探针能在"某一帧到达的**同一瞬间**"做事。
 *
 * ⚠️★ 为什么需要它（㉘c 要证"**写盘相位**点取消会被拒"）：写盘那一段只有两次 `rename`
 *    那么长（几毫秒）⇒ 用 sleep 去猜时机是测不准的（"大概在附近"不是判据）。而
 *    `phase:'install'` 那一帧是主进程**同步**在两次 rename **之前**推出来的 ⇒ 在收到
 *    那一帧的同一瞬间点取消，落点就是**确定的**。
 * ⚠️ 它必须是**模块级**的：`BrowserWindow` 是模块级那个桩类造的，它看不见相位里的局部变量。
 *    默认实现 = 原来那一句（`pushes.push`）⇒ 主相位与写相位其它组读 `pushes` 的行为
 *    **逐字不变**；写相位在 ㉘c 之前把它换成"带取消动作"的那一版。
 */
let onPageSend = (channel, payload) => {
  pushes.push({ channel, payload, at: Date.now() });
  captured.push({ channel, payload, at: Date.now() });
};

/**
 * ★★ T9 修复轮（C1/I1）：**按趟**收帧的仪器 —— 与 `pushes` 分开、**每一趟前后清一次**。
 *
 * ⚠️★ 为什么不能继续用 `pushes.slice(before)`（㊱ 的第一版就是这么写的）：
 *    `pushes` 是**模块级**的、从加载起一直在涨，而"一趟跑完了"这件事我是从
 *    `await invoke(...)` 返回**之后**才读的 —— 那一刻**属于下一趟**的帧可能已经在里面了
 *    （`noteUpdated()` 那一帧是**同步**推的，而下一趟的第一帧由 `setRunItem` 推）。
 *    后果是**读数漂**：同一份字节上，我量到 `帧数 4 / [0,0,1,1]`，独立评审量到
 *    `帧数 5 / [0,0,1,1,1]`（`updatedCount` 的走向一致，差的是**尾帧**）。
 *    ⇒ 单靠"帧数"当锚点是不可复跑的（§M2）；这一轮所有**新的**计数判据一律用
 *    `captureFramesOf` 取帧（每一趟自己一个窗口），**不许**再写 `pushes.slice(...)`。
 * ⚠️ 它不替代 `pushes`：既有那些判据（㉗ 的帧数/间隔、㉘c 的取消时机）照旧读 `pushes`，
 *    行为一字不变（两边都记同一份 `{channel, payload, at}`）。
 */
const captured = [];
/**
 * 跑一趟并把它**这一趟**推出来的帧原样交回（按 `channel` 过滤；`'*'` = 不过滤）。
 *
 * ⚠️ 清窗口**在 `work()` 之前**、读数**紧接着**它取 ⇒ 即使下一趟的帧已经推进 `pushes`，
 *    这一趟的 `captured` 里也只有它自己的（取完立刻不再有写入者）。
 */
async function captureFramesOf(channel, work) {
  captured.length = 0;
  const value = await work();
  const frames = captured
    .filter((entry) => channel === '*' || entry.channel === channel)
    .map((entry) => entry.payload);
  captured.length = 0;
  return { value, frames };
}

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
      /*
       * ⚠️★ 子项目 C / S3：`at` 是 **㉗** 那条"相邻两帧 ≥ 100 ms"（D3 的节流下限）要的
       *    —— 推送里没有时间戳时那条判据**量不到东西**（只能量到"有两帧"）。
       *    这里盖的是**桩收到 send 的那一刻**（接收侧时钟），不是主进程发出去的时刻：
       *    判据问的是"两帧之间**真的**隔了那么久"，而接收侧读数正是能回答它的那个。
       */
      send: (channel, payload) => onPageSend(channel, payload),
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

/**
 * ★ C/S2（子项目 C）慢桩夹具用的 modid —— **1.16.1 下唯一候选、版本主体能安全排序、
 *   `download === 'auto'`、且没被上面六个夹具占用**的那些。
 *
 * ⚠️★ 为什么必须**可排序**（不能随便挑两个）：批量那一组（㉖b）要的判据是
 *    "`itemCount` = 这一趟的目标数 = 2"，而"进批量"的判据是 `older`；`older` 要求
 *    **两边主体都能排序**（`isSortableBody`，见 `compareLocalToRelease`）——
 *    主体里有非数字段的 release 判出来是 `different-build`（要人点一下、**不进批量**）。
 *    实测（2026-10-06 现读 `content/mod-catalog.json`）：brief 举例的 `lithium|1.16.1`
 *    版本是 `1.0+backport-0.6.7+1.16.1` ⇒ **不排序** ⇒ 拿它当第二个夹具时 `itemCount`
 *    会是 **1**，那条判据就会红在一处**夹具缺陷**上（§5.79 那一族：红点长得像产品缺陷）。
 *    ⇒ 这里按判据本身筛，不按名字挑（brief 自己给了出口："other 用哪个 modid 以现读为准"）。
 * ⚠️★ 为什么不用 `writeMods[0..4]` 那几个：`hijack` 是**就地改** `modCatalog.releases`
 *    （url / sha512 / size）⇒ 再劫持同一个 modid 一次，会把前面几组夹具的地址与字节一起改掉。
 * ⚠️ 为什么还要 `download === 'auto'`：`manual` 的行连更新按钮都不该有（`assertNotManual`
 *    会当场拒）—— 那种 mod 进这一组夹具只会得到一条与进度无关的红。
 */
const progressPool = writeMods.slice(5).filter((modid) => {
  const release = modCatalog.releases.find(
    (candidate) => candidate.modid === modid && candidate.targetVersions.includes('1.16.1'),
  );
  return (
    release !== undefined && sortableBodyOf(release.version) && release.download === 'auto'
  );
});
if (WRITE && progressPool.length < 2) {
  bail(
    `构造不出 C/S2 的慢桩夹具：要 2 个"可排序、未被占用、download=auto"的 modid，只找到 ${String(progressPool.length)} 个`,
  );
}

/** 夹具 jar 里写的**内部版本号**（故意与目录里 release 的版本字符串不同：见写相位 ⑰ 的刀）。 */
const FIXTURE_JAR_VERSION = '1.0.0';
const SERVED_JAR_VERSION = '9.9.9';
/**
 * ★ Task 5：假 MultiMC 实例的 `mmc-pack.json` 里那个 fabric-loader 版本。
 *
 * ⚠️ 它**不是**"期望产物"那种会被产品改动推翻的常数：它是我**自己写进夹具**的那个串，
 *    而断言问的是"读出来的 loader 是不是**我写进去**的那一份"（`fabric ${MMC_LOADER_VERSION}`）。
 *    ⇒ 它红了只有两种可能：那一格没从 `mmc-pack.json` 读出来，或者读串了别的版本。
 */
const MMC_LOADER_VERSION = '0.15.11';
/**
 * ★ C/S2 那两个夹具 jar 里写的内部版本号：**必须严格低于目录里那一条的版本主体**
 *   （正文里那两行才会判成 `older` ⇒ 可批量）。
 *
 * ⚠️★ 不能用上面那个 `FIXTURE_JAR_VERSION = '1.0.0'`：目录里真有比 1.0.0 旧的 release
 *    （实例：`phosphor|1.16.1` 是 `0.7.2`）⇒ 那样的行判出来是 `newer`（本地更新），
 *    而 `newer` **不进批量**、写盘时还会被 `assertUpdatable` 当场拒。
 *    这是**现读目录**得到的结论，不是猜的。
 */
const PROGRESS_LOCAL_JAR_VERSION = '0.0.1';

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
/**
 * ★ B2 / Task 5：桩上的**整合包定义**（`GET /api/modpacks/<id>`，spec D5）。
 *
 * ⚠️ 只有写相位才填（`buildWriteFixture` 里那一段）：主相位里这张表是空的 ⇒ 那条端点只会
 *    404，而主相位一条都不调它 ⇒ 主相位的读数逐字不变。
 * ⚠️★ 形状照 `services/api/src/routes/modpacks.ts` 的 `toWire`（顶层
 *    `id/title/description/gameVersion/modids/hot/modCount`）—— 主进程 `fetchPack` 读的
 *    就是这几格；少一格都不会让 `fetchPack` 抛（它只校验 id/title/gameVersion/modids），
 *    所以这里**照服务端那份形状写全**，免得探针把一个"服务端根本不这么回"的形状当成真的。
 */
const modpacks = new Map();
/**
 * `/api/modpacks/` 收到过几次请求 —— 断言 13 的**第二条独立读数**：
 * `downloadLog` 证的是"一个下载请求都没发"，这一条证的是"那个 404 是**服务端**答的"
 * （把 `fetchPack` 换成"本地直接当不存在"时，这一格是 0 ⇒ 两条读数互相印证，§5.38）。
 */
let modpackRequests = 0;

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
   * ★ B2 / Task 5：`GET /api/modpacks/<id>`（spec D5 的那一条）。
   *   · 表里有 ⇒ 200 + 定义（主进程这一趟会照它去下）；
   *   · 表里没有 ⇒ **404**（`fetchPack` 把 404 读成"这个包不存在"这一条**正常答案**，
   *     而其它非 2xx 是"取不到"⇒ 抛 —— 断言 13 量的正是 404 这一支）。
   */
  if (req.url.startsWith('/api/modpacks/')) {
    modpackRequests += 1;
    const id = decodeURIComponent(req.url.slice('/api/modpacks/'.length));
    const body = modpacks.get(id);
    if (body === undefined) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
    return;
  }
  /*
   * ★ Task 5：下载路径。`downloads` 在写相位里才被填（key = 路径前缀，value = 字节）；
   *   主相位里它是空的 ⇒ 这一段的判据在主相位**不可能**被触发（桩的行为逐字不变）。
   */
  for (const [prefix, entry] of downloads) {
    /*
     * ★ T9：`exact: true` 那一档比的是**整条路径逐字相等**（`origin` 通道下"每条 release
     *   一份自己的字节"靠它 —— 前缀比法在那里会把同一目录下别的 release 也吃进来）。
     *    ⚠️ 前缀那几条（`hijack` / `hijackSlowGroup` / `packMod`）的行为**一字不变**。
     */
    const hit = entry.exact === true ? req.url === prefix : req.url.startsWith(prefix);
    if (!hit) continue;
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

  /*
   * =========================================================================
   * ★ C/S2（子项目 C）：**慢桩**那两条夹具
   * =========================================================================
   * ⚠️★ 为什么**单开一条镜像**（`probe-c2slow`，前缀 `/mirror-c2slow/`），而不复用
   *    写相位已有的那条 `/mirror-slow/`（brief 举例写的正是 `probe-slow`）：
   *      · ⑮ 里那条判据是**绝对**计数 `slowReqs() === 1`（"慢的那条路径只被请求了 1 次"），
   *        而新夹具每跑一次就往 `/mirror-slow/` 上再记一笔 ⇒ 那一条会红在一件与它无关的事上；
   *      · 桩是按**路径前缀**键控的（`downloads` 一个前缀一份字节），而 `/mirror-slow/`
   *        那份字节的 sha512 是 `good` 那一条 release 的 ⇒ 两条夹具挤进同一个前缀，
   *        谁都得下到别人的字节（第二条一定 sha512 对不上）。
   *    ⇒ 新夹具自带镜像与字节，⑮ 的读数一字不变。
   * ⚠️★ 为什么两条 release **共享同一组字节**：`updateFolderAll` 只收**一个**通道，
   *    而桩按前缀键控 ⇒ 这一趟里两条行取到的一定是同一份字节。各给一份各自的字节
   *    （照 `hijack` 那样）时，第二条必然 sha512 对不上 —— 那是夹具的错，不是产品的错。
   * ⚠️★ 为什么每条 fixture 额外带一份 `local` 字节：`official` 是**桩要回的那一份**，
   *    而 `release.sha512` 就是它的 sha512 ⇒ 把 `official` 按目标名写进目录 = "这个文件
   *    已经是这一份"（`judgeRelease` 判 `same`、`installRelease` 走**幂等**那一支）
   *    ⇒ **一个请求都不会发**，"慢下载中途读到字节"这条判据永远量不到东西。
   *    `local` 是同 modid、内部版本更低、字节不同的那一份 ⇒ 判成 `older` ⇒ 真的走下载
   *    （`placeJar` 落盘时用的是它，理由写在那个助手头顶）。
   */
  const hijackSlowGroup = (modids, mirrorId, pathName, chunkDelayMs) => {
    const suffix = mirrorId.replace('probe-', '');
    /*
     * ⚠️★ 这一份字节只按 `modids[0]` 造一次，**两条 release 共用它** ⇒ 这一趟跑完之后
     *   **不要**拿那两个落盘文件的扫描读数当判据：两份文件的内部 modid 是同一个，会被读成
     *   同一个 mod（"两个不同的 mod 各装各的"那类判据在这一组夹具上是假的）。
     *   ⚠️ 这里**做不到**"两条各给一份自己的字节"：桩按**路径前缀**键控、一个前缀只有一份
     *   字节（见头顶那一段），两条挤进同一趟时第二条必然 sha512 对不上。
     */
    const shared = probeJar(modids[0], SERVED_JAR_VERSION);
    modCatalog.mirrors.push({
      id: mirrorId,
      label: `探针桩（${mirrorId}）`,
      prefix: `${siteOrigin}/mirror-${suffix}/`,
      hosts: [host],
    });
    const made = modids.map((modid, index) => {
      const release = modCatalog.releases.find(
        (candidate) => candidate.modid === modid && candidate.targetVersions.includes('1.16.1'),
      );
      if (release === undefined) bail(`夹具前提不成立：${modid} 在 1.16.1 下没有 release`);
      const name = `${pathName}-${String(index + 1)}.jar`;
      release.url = `${siteOrigin}/origin/${name}`;
      release.sha512 = sha512OfBuffer(shared);
      release.size = shared.length;
      return {
        modid,
        release,
        targetName: name,
        official: shared,
        served: shared,
        local: probeJar(modid, PROGRESS_LOCAL_JAR_VERSION),
        mirrorId,
      };
    });
    downloads.set(`/mirror-${suffix}/`, { bytes: shared, chunkDelayMs });
    return made;
  };
  const [slow, other] = hijackSlowGroup(progressPool.slice(0, 2), 'probe-c2slow', 'c2-slow', 400);

  /*
   * =========================================================================
   * ★★ T9（spec A20）：**「已更新文件数」只数真的写盘成功的**
   * =========================================================================
   * ⚠️★ 为什么必须**单开一组夹具**（三条新 modid + 一条新镜像）：这一条判据要的是
   *    "**同一趟**里三种去向**同时**发生" —— 一项真的装成、一项**跳过**、一项**失败**
   *    ⇒ 终帧的 `updatedCount` 必须是 **1**（不是 3、也不是 0）。而"跳过"与"失败"
   *    在**字节那一层**上互斥（§5.32 ①：夹具少一支，判据就退化成"只数了成功的"）：
   *      · 失败那一条要的是"桩回的字节与 `release.sha512` **不一致**"；
   *      · 跳过那一支要的是"目标位置那份字节与 `release.sha512` **逐字节相同**"。
   *    ⇒ 只有"**每条 release 一份自己的字节**"才构造得出来，而 `updateFolderAll` 一趟
   *      只收**一个**通道（`hijackSlowGroup` 那种"一镜像一份字节、三条共用"做不到这件事）
   *      ⇒ 走 **`origin` 通道**（每条 release 用自己的 url ⇒ 桩按**精确路径**分别应答）。
   * ⚠️★ 为什么三格都要在（逐条都是"换一种坏实现"的刀）：
   *      · 少了成功那一项 ⇒ 计数恒 0，"只数成功的"退化成"什么都不数"；
   *      · 少了失败那一项 ⇒ 把 `catch` 支路也加一的实现照样绿；
   *      · 少了跳过那一项 ⇒ 把 `else if (why !== null)` 支路也加一的实现照样绿
   *        （**跳过不算**与**失败不算**是两把不同的刀，缺一条只钉得住一半）。
   * ⚠️★ 桩的 `downloads` 表原先只支持**前缀**（`startsWith`）⇒ 下面这个
   *    `exact: true` 那一档是 T9 加的（一整条路径逐字相等），只给这一组用：
   *    前缀那几条（`hijack` / `hijackSlowGroup` / `packMod`）的读数**一字不变**。
   */
  let t9Group = null;
  if (WRITE) {
    const t9MirrorId = 'probe-t9count';
    /*
     * ⚠️ 这一条镜像**其实是多余的**（三条项都走 `origin`，`channelUrl` 不看镜像表）——
     *    留着只是为了与 `hijack` / `hijackSlowGroup` / `packMod` 那三处**同一个形状**，
     *    免得下一个人以为"这里为什么不用镜像"是一处刻意的缺口。
     */
    modCatalog.mirrors.push({
      id: t9MirrorId,
      label: `探针桩（${t9MirrorId}）`,
      prefix: `${siteOrigin}/mirror-t9count/`,
      hosts: [host],
    });
    t9Group = { mirrorId: t9MirrorId };
  }

  /*
   * =========================================================================
   * ★ B2 / Task 5：**整合包**的夹具（断言 9–13）
   * =========================================================================
   * ⚠️★ 为什么这些项走**通道 `origin`**、而不是像别处那样各开一条镜像：
   *    `downloadPack` 一趟只收**一个** `channel`，而桩的字节是按**路径前缀**键控的
   *    （`downloads` 一条前缀一份字节）⇒ 一条镜像下两个 mod 必然拿到同一份字节
   *    （`hijackSlowGroup` 头顶那一段写着全文）。`origin` 通道下每条 release 用自己的 url
   *    ⇒ 两个 mod 各有一份自己的字节与自己的延迟，断言 11（第二个 sha512 对不上）
   *    才有办法构造。
   * ⚠️★ 用 `progressPool.slice(2, 9)`（前两个是 ㉖/㉖b 的 `fx.slow` / `fx.other`，
   *    尾巴三条是 T9 的 `t9` 那三条）：
   *    `hijack` 是**就地改** `modCatalog.releases` ⇒ 复用同一个 modid 会把别人的夹具改掉。
   * ⚠️ 每一项的目标名都**不与文件夹里已有的那份 jar 同名**：包里的项是"这个文件夹里还没有"
   *    的那一批，而 `installRelease` 收到 `oldCopies: []` ⇒ 目标位置上要是有个我们没见过的
   *    文件，它会**拒**（Ruling 48）—— 那是夹具缺陷，不是产品缺陷。
   */
  const packPool = progressPool.slice(2, 9);
  if (packPool.length < 7) {
    bail(
      `夹具前提不成立：整合包的夹具要 7 个"未被占用、1.16.1 下唯一候选、可排序、download=auto"的 modid，只找到 ${String(packPool.length)} 个`,
    );
  }
  /*
   * ★★ T9：`slice(-4,-1)` 取的**尾巴**那三条。
   *
   * ⚠️★ 这一条守卫与上面那条**一起**才能说清"三组夹具各占哪几格"：
   *    2（㉖ / ㉖b）+ 7（整合包）+ 3（T9）= **12** ⇒ 池子一小就会有人去抢别人的 modid
   *    （`hijack` / `t9Mod` / `packMod` 都是**就地改** `modCatalog.releases`），
   *    而症状长得像产品缺陷（§5.79）。取**尾巴**而不是接着 `slice(9,12)`：尾巴那三条
   *    与前面那两组的索引**天然不重叠**，即使将来有人往池子中间插一条也不会串位。
   */
  const t9Pool = progressPool.slice(-4, -1);
  if (t9Pool.length < 3 || progressPool.length < 12) {
    bail(
      `夹具前提不成立：三组夹具（㉖ 两条 / 整合包七条 / T9 三条）要 12 个"可排序、未被占用、download=auto"的 modid，只有 ${String(progressPool.length)} 个（T9 这一组拿到 ${String(t9Pool.length)} 个）`,
    );
  }
  const t9Suffix = (t9Group?.mirrorId ?? 'probe-t9count').replace('probe-', '');
  const t9Mod = (modid, pathName, servedExtra) => {
    const release = modCatalog.releases.find(
      (candidate) => candidate.modid === modid && candidate.targetVersions.includes('1.16.1'),
    );
    if (release === undefined) bail(`夹具前提不成立：${modid} 在 1.16.1 下没有 release`);
    const official = probeJar(modid, SERVED_JAR_VERSION);
    const served = servedExtra ? probeJar(modid, SERVED_JAR_VERSION, true) : official;
    const name = `${pathName}.jar`;
    release.url = `${siteOrigin}/origin/${name}`;
    release.sha512 = sha512OfBuffer(official);
    release.size = official.length;
    downloads.set(`/origin/${name}`, { bytes: served, exact: true });
    return {
      modid,
      release,
      targetName: name,
      official,
      served,
      local: probeJar(modid, PROGRESS_LOCAL_JAR_VERSION, true),
      mirrorId: `probe-${t9Suffix}`,
    };
  };
  /** ★★ T9 的三条：**真的装成** / **失败**（下完 sha512 对不上）/ **跳过**（目标已是这一份）。 */
  const t9 = {
    ok: t9Mod(t9Pool[0], 't9-count-ok', false),
    bad: t9Mod(t9Pool[1], 't9-count-bad', true),
    skipped: t9Mod(t9Pool[2], 't9-count-skip', false),
  };
  /** 一个"包里的 mod"：劫持 release 的 url / sha512 / size，并在桩上登记它自己的字节。 */
  const packMod = (modid, pathName, opts = {}) => {
    const release = modCatalog.releases.find(
      (candidate) => candidate.modid === modid && candidate.targetVersions.includes('1.16.1'),
    );
    if (release === undefined) bail(`夹具前提不成立：${modid} 在 1.16.1 下没有 release`);
    const official = probeJar(modid, SERVED_JAR_VERSION);
    // `bad: true` ⇒ 桩**实际**回的字节与目录里写的 sha512 不一致（断言 11 要的正是这一支）
    const served = opts.bad === true ? probeJar(modid, SERVED_JAR_VERSION, true) : official;
    const name = `${pathName}.jar`;
    release.url = `${siteOrigin}/origin/${name}`;
    release.sha512 = sha512OfBuffer(official);
    release.size = official.length;
    downloads.set(
      `/origin/${name}`,
      opts.chunkDelayMs === undefined
        ? { bytes: served }
        : { bytes: served, chunkDelayMs: opts.chunkDelayMs },
    );
    return { modid, release, targetName: name, official, served, local: probeJar(modid, PROGRESS_LOCAL_JAR_VERSION), mirrorId: 'origin' };
  };
  /** 桩上那份"服务端会回的"包定义（形状照 `toWire`）。 */
  const packBody = (id, title, modids) => ({
    id,
    title,
    description: '',
    gameVersion: '1.16.1',
    modids,
    hot: false,
    modCount: modids.length,
  });
  const [m9a, m9b, m10, m11good, m11bad, m12a, m12b] = packPool;
  const packs = {
    progress: {
      id: 'probe-pack-progress',
      items: [packMod(m9a, 'pack9-1', { chunkDelayMs: 400 }), packMod(m9b, 'pack9-2', { chunkDelayMs: 400 })],
    },
    skip: { id: 'probe-pack-skip', already: packMod(m10, 'pack10-already'), absent: 'probe-no-such-mod' },
    fail: {
      id: 'probe-pack-fail',
      good: packMod(m11good, 'pack11-good'),
      bad: packMod(m11bad, 'pack11-bad', { bad: true }),
    },
    cancel: {
      id: 'probe-pack-cancel',
      items: [packMod(m12a, 'pack12-1', { chunkDelayMs: 400 }), packMod(m12b, 'pack12-2', { chunkDelayMs: 400 })],
    },
  };
  modpacks.set(
    packs.progress.id,
    packBody(packs.progress.id, '探针整合包（进度）', packs.progress.items.map((entry) => entry.modid)),
  );
  modpacks.set(
    packs.skip.id,
    packBody(packs.skip.id, '探针整合包（跳过）', [packs.skip.already.modid, packs.skip.absent]),
  );
  modpacks.set(
    packs.fail.id,
    packBody(packs.fail.id, '探针整合包（一条失败）', [packs.fail.good.modid, packs.fail.bad.modid]),
  );
  modpacks.set(
    packs.cancel.id,
    packBody(packs.cancel.id, '探针整合包（取消）', packs.cancel.items.map((entry) => entry.modid)),
  );
  /*
   * ★ 修轮 1（评审的唯一 Important）：`installRelease` 的**幂等**那一支（`alreadyCurrent`）的夹具。
   * ⚠️★ 它复用 `packs.skip.already` 那一份 mod 夹具（**不新造 modid**）：`packPool`
   *    （`progressPool.slice(2, 9)`）现在**刚好 7 个**（上面那条 `bail` 的条件正是 7）⇒
   *    再要一个就得收紧夹具前提（目录里现读得到的候选就那么多）。复用是安全的：那一份
   *    只被 `hijack` 过一次（release 的 url / sha512 只改了一次），而 ㉟ 的判据
   *    **一个下载请求都不该发** ⇒ 两边不会互相搅动。
   */
  packs.current = {
    id: 'probe-pack-current',
    already: packs.skip.already,
  };
  modpacks.set(
    packs.current.id,
    packBody(packs.current.id, '探针整合包（已经是这一份）', [packs.current.already.modid]),
  );
  return {
    bad,
    good,
    busy,
    newer,
    manual,
    trav: { modid: MOD_TRAV, release: trav, mirrorId: 'probe-trav' },
    slow,
    other,
    packs,
    /** ★★ T9：整夹更新里"一项成 / 一项跳 / 一项失败"那三条（㊱ 用）。 */
    t9,
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
  console.log(
    `  C/S2 的慢桩夹具（${writeFixture.slow.mirrorId}，chunkDelayMs=400）：${[writeFixture.slow, writeFixture.other].map((entry) => `${entry.modid}→${entry.targetName}（本地 ${String(entry.local.length)}B / 桩回 ${String(entry.served.length)}B）`).join('；')}`,
  );
  /*
   * ★ B2 / Task 5：整合包那四份夹具也打印出来（§5.79：每个读数都要说清"我看了哪个对象"）。
   *   目标名 + 桩要回的字节长度都在 ⇒ 一个空结果一眼能看出是夹具没建起来还是产品没做工。
   * ⚠️ 四份夹具的**形状不一样**（`progress`/`cancel` 是 `items[]`、`skip` 是 `already`、
   *    `fail` 是 `good`+`bad`）⇒ 打印这一句要按各自那几格取；第一版写成
   *    `pack.items ?? [pack.already]` 时 `fail` 那一份取到 `[undefined]` ⇒ 这一句自己抛
   *   （子进程以 1 收场，而**一条判据都没跑**：§5.74 那一族，红点长得像"写相位哪条判据没过"）。
   */
  const packEntryText = (entry) =>
    `${entry.modid}→${entry.targetName}（桩回 ${String(entry.served.length)}B）`;
  const packSummaryOf = (pack) => {
    const entries = pack.items ?? [pack.already ?? pack.good, pack.bad].filter(Boolean);
    return `${pack.id}[${entries.map(packEntryText).join(', ')}]`;
  };
  console.log(
    `  整合包夹具（五条端点，走 origin 通道）：${[
      writeFixture.packs.progress,
      writeFixture.packs.skip,
      writeFixture.packs.fail,
      writeFixture.packs.cancel,
      writeFixture.packs.current,
    ]
      .map(packSummaryOf)
      .join('；')}`,
  );
  /* ★★ T9：那三条也打印（§5.79：每个读数都要说清"我看了哪个对象"）。 */
  console.log(
    `  T9 的「只数成功的」夹具（㊱，走 origin 通道、桩按**精确路径**应答）：${[
      ['装成', writeFixture.t9.ok],
      ['跳过', writeFixture.t9.skipped],
      ['失败', writeFixture.t9.bad],
    ]
      .map(([what, entry]) => `${what} ${entry.modid}→${entry.targetName}（桩回 ${String(entry.served.length)}B / 官方 ${String(entry.official.length)}B）`)
      .join('；')}`,
  );
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

/*
 * 等 **22** 条 invoke 通道注册好（**24** 个成员里 `onStatus` 与 `onProgress` 是**推送**、没有 handler）。
 *
 * ⚠️★ 这两个数**现数**改过一次（D1 的 T4）：之前写的是"14 条 / 16 个成员"，而**通道表从
 *    B2 的 T4 起就是 17 个成员**（那一次改了上面 `:300` 那一族、漏了这一族）⇒ 那个 14 当时
 *    就已经是错的（真值 15）。⚠️ 所以别把它当基线去"加 N"，照着现数写。
 * ⚠️★ `PUSH_CHANNELS` 是**现读**出来的（`Object.values(MOD_CH)` 里那两条推送），不是手抄的
 *    两个键名：漏一条的表现是这里**永远等不到**（240 × 25ms）⇒ `waitForHandlers()` 给 false
 *    ⇒ 两处 `bail`（退出码 2，看起来像"这条检查没跑起来"）。C 的 T3 加 `onProgress` 时撞到的
 *    正是这一条（只加契约、不改这里 ⇒ 整个写相位以 2 收场）。
 */
const PUSH_CHANNELS = [MOD_CH.onStatus, MOD_CH.onProgress].filter((name) => name !== undefined);

/** 等 **22** 条 invoke 通道注册好（两条推送不算）。 */
async function waitForHandlers() {
  const expected = Object.values(MOD_CH).filter((name) => !PUSH_CHANNELS.includes(name));
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
    /*
     * ★★ D1 的两格**必须在**（2026-10-11 控制器裁定）：`migrateState()` 的"清 `folders`"
     *    只对"**D1 之前**写的文件"生效，判据正是这两格**都不在**。
     *    ⇒ 这一段夹具不加它们的话，它模拟的是"上一版写的文件"，那一格 `pre-folder`
     *      会被**合法地清一次**（spec A16），而下面那一整族断言（判修 1 / Ruling 34）
     *      问的是"一份 **post-D1** 文件里预置的 `pre-folder` 会不会污染缺失清单" ✓。
     *    ⚠️ 它**不是**"把夹具凑绿"：这两格是 D1 之后我们这一版**真的会写**的东西
     *      （`StateFileV2` 的必填成员），夹具照当前契约写才对得上它要测的那件事。
     */
    launchers: [],
    instancePrefs: {},
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
  await section('① invoke 通道都注册了（红的形态：一条都没有）', async () => {
    const expected = Object.values(MOD_CH).filter((name) => !PUSH_CHANNELS.includes(name));
    const missing = expected.filter((name) => !handlers.has(name));
    check(
      `ipcMain.handle 注册了 ${String(expected.length)} 条 mcsr:modfolders-*（${String(MOD_CH_COUNT)} 个成员里 ${String(PUSH_CHANNELS.length)} 条是推送、不算）`,
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
   * ★ 刀（现场读数见本分支的逐任务评审包）：把 `bindFolder` 里 `gameVersion: preset` 改回
   *    `gameVersion: null` ⇒ 第 1、2 条红（第 3、4 条照旧绿 —— 它们测的是别的两件事）。
   * ★ 另一把（现场读数见本分支的逐任务评审包）：把 `presetFolderVersion` 的
   *    `undefined`/`null` 那一支也收成一个默认版本 ⇒ 第 4 条红。
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

  // =========================================================================
  /*
   * ⚠️★★ **这一段必须先读的一句：`probeLaunchers` 看的是"这台机器"**。
   *    本机实测（2026-10-11，现读）：`D:\MultiMC`（31 个实例）与 `D:\PCL2`（6 个）
   *    **真的存在** ⇒ 它俩**会**出现在探测结果里，而且 `addLauncher('multimc', …)`
   *    只要根**落在 `D:\MultiMC` 里面**就会把那 31 个实例一起枚举出来。
   *    ⚠️ 这正是第一版夹具**红在 3 条"夹具缺陷"上**的原因（§5.79："如果它没跑，会长什么样"）：
   *      · 我原来断言"探测结果里只有我造的那几个根" ⇒ 在有真启动器的机器上**必红**，
   *        而在干净机器上恒真 —— 一条**与产品无关、只与这台机器有关**的判据 ✗；
   *      · 同时把绑定的根放在 `<tmp>` 下 ⇒ 它**不在**任何盘符根里 ⇒ 上面那两条真根照旧被
   *        `driveRoots()` 报出来（`probeLaunchers` 的候选表**含盘符根**，那是 **spec §6 要的行为**）。
   *    ⇒ 处置**不是**"把夹具换成 D:\MultiMC"（那是拿真用户的实例当夹具），而是把它做成
   *      **差分读数**：先量一份"这一台机器本来的探测结果"当**对照**，再量加了夹具之后的那一份，
   *      断言**差集恰好是我造的那五个根**。这样它在"有真启动器"与"干净机器"两种情况下**都成立** ✓。
   */
  await section('★★ Task 5（D1）：四种假启动器 × 枚举 / 解析 / 勾选 / 派生 / 缺失清单照旧', async () => {
    /*
     * ★★ **对照读数必须取在"造夹具之前"**（这一条是踩出来的：第一版取在造完之后 ⇒ 差集恒空 ✗）：
     *    `probeLaunchers` 的候选表**只认"常见位置"**，而①的夹具**必须落在其中一个位置**上
     *    （否则它根本不进候选，①就永远不可能绿）。⇒ 那份夹具一造出来，它**就已经**在结果里了
     *    ⇒ 对照若取在它之后，**差集是空的**（看不到"新加的那个根"）。
     *    ⚠️ 顺序因此是：**先量对照 → 再造①那个候选槽的夹具 → 再量一份**。这一句就是那个顺序。
     */
    const beforeHits = await invoke(MOD_CH.probeLaunchers);
    /*
     * ---- 夹具：四种启动器 + 一个"兜底专用"的根（都在 `workRoot` 里）----------------
     * ⚠️ 根**不**放在任何盘符根下（`<tmp>` 不是 `C:\`）⇒ 它们与"这台机器上那些真根"
     *    在**路径上**天然分得开（`samePath` 一比就知道是哪一个）。
     */
    const mmcRoot = join(workRoot, 'MultiMC');
    const mmcName = '1.16.1 - Ranked#1';
    const mmcInstance = join(mmcRoot, 'instances', mmcName);
    const mmcMods = join(mmcInstance, '.minecraft', 'mods');
    mkdirSync(join(mmcInstance, '.minecraft', 'saves'), { recursive: true });
    mkdirSync(mmcMods, { recursive: true });
    writeFileSync(
      join(mmcInstance, 'mmc-pack.json'),
      JSON.stringify({
        components: [
          { uid: 'net.fabricmc.fabric-loader', version: MMC_LOADER_VERSION },
          { uid: 'net.minecraft', version: '1.16.1' },
        ],
      }),
    );

    const pclRoot = join(workRoot, 'PCL2');
    const pclIsoName = '1.16.1-Fabric 0.17.3';
    const pclIsoInstance = join(pclRoot, '.minecraft', 'versions', pclIsoName);
    const pclIsoMods = join(pclIsoInstance, 'mods');
    mkdirSync(pclIsoMods, { recursive: true });
    writeFileSync(
      join(pclIsoInstance, `${pclIsoName}.json`),
      JSON.stringify({ id: pclIsoName, clientVersion: '1.16.1' }),
    );
    const pclSharedName = '1.20.1-Fabric 0.16.13';
    const pclSharedInstance = join(pclRoot, '.minecraft', 'versions', pclSharedName);
    mkdirSync(pclSharedInstance, { recursive: true });
    writeFileSync(
      join(pclSharedInstance, `${pclSharedName}.json`),
      JSON.stringify({ id: pclSharedName, clientVersion: '1.20.1' }),
    );
    const pclSharedMods = join(pclRoot, '.minecraft', 'mods');
    mkdirSync(pclSharedMods, { recursive: true });

    /*
     * ⚠️★ `official` 的根**就是** `.minecraft` 那一层（spec §6 的表）⇒ 这个夹具用
     *    `<tmp>\vanilla` 当那个根，`mods` 直接落在根下（不是 `<根>\.minecraft\mods`）。
     *    `mkdirSync(pclSharedMods)` 与它**同形**（那是 PCL 的共享 mods），别把两者看成一个。
     */
    const officialRoot = join(workRoot, 'vanilla');
    const officialInstance = join(officialRoot, 'versions', '1.16.1');
    mkdirSync(officialInstance, { recursive: true });
    writeFileSync(
      join(officialInstance, '1.16.1.json'),
      JSON.stringify({ id: '1.16.1', clientVersion: '1.16.1' }),
    );
    mkdirSync(join(officialRoot, 'mods'), { recursive: true });

    /*
     * ---- ④ 的夹具：**四处解析点都不存在**的那一个 -----------------------------------
     * ⚠️★ 它必须是一个**别的启动器**的根：拿 PCL2 那家去造的话，`<根>\.minecraft\mods`
     *    已经被共享那一条创建了 ⇒ 这个实例会被解析成"共享"（`needsConfirm: false`），
     *    而那条断言会红在一处**夹具缺陷**上（§5.79 那一族）。
     *    用 `hmcl`（与 PCL2 同规则、但根不同）⇒ 两处 `mods` / `saves` 一个都不在 ✓。
     */
    const bareRoot = join(workRoot, 'HMCL');
    const bareName = '1.7.10-forge';
    const bareInstance = join(bareRoot, '.minecraft', 'versions', bareName);
    mkdirSync(bareInstance, { recursive: true });

    /*
     * ---- ⑧ 的夹具：**一个只给共享 `libraries\` 的根**（兜底那一支）------------------
     * ⚠️★ 它**故意**不挂在上面四个根底下：`loaderFromSharedLibraries` 会试
     *    `<根>\libraries` 与 `<根>\.minecraft\libraries` 两处 ⇒ 造在 `pcl2` 的根下
     *    会让**所有** PCL2 实例都拿到这个 loader。
     */
    const fallbackRoot = join(workRoot, 'PCL2-fallback');
    const FALLBACK_LOADER_VERSION = '0.99.0';
    mkdirSync(
      join(fallbackRoot, 'libraries', 'net', 'fabricmc', 'fabric-loader', FALLBACK_LOADER_VERSION),
      { recursive: true },
    );
    const fbName = '1.16.1-Fabric 0.18.4';
    const fbInstance = join(fallbackRoot, '.minecraft', 'versions', fbName);
    mkdirSync(fbInstance, { recursive: true });
    // ⚠️ 它自己那份 json **没有** `libraries` ⇒ `parseInstanceMeta` 那一半给 null ⇒ 才轮到兜底
    writeFileSync(
      join(fbInstance, `${fbName}.json`),
      JSON.stringify({ id: fbName, clientVersion: '1.16.1' }),
    );

    /*
     * ---- ⑤–⑦ 的 jar：**一个真的会被扫到的** mod（"照旧工作"要有东西可照）------------
     * ⚠️★ 挑法与脚本头上那两处同一条：**1.16.1 下唯一候选**（缺失清单只列这种行）、
     *    且避开 `antigone` / `trackedInPre` / `MCSRRANKED` 与写路径那六个夹具
     *    （`writePool` 只有写相位才非空 ⇒ 这里不必再看它）。
     */
    const derivedModid =
      oneRelease1161.find(
        (modid) => ![ANTIGONE, trackedInPre, MCSRRANKED].includes(modid),
      ) ?? '';
    if (derivedModid === '') {
      bail('构造不出 Task 5 的夹具：1.16.1 下找不到一个没被别的夹具占用的"唯一候选" mod');
    }
    makeJar(join(mmcMods, `${derivedModid}-1.16.1.jar`), { id: derivedModid, version: '1.0.0' });

    const fixtureRoots = [
      ['multimc', mmcRoot],
      ['pcl2', pclRoot],
      ['official', officialRoot],
      ['hmcl', bareRoot],
      ['pcl2', fallbackRoot],
    ];
    /*
     * ★★ **T12 那条守卫的夹具**（控制器 2026-10-11 点名要的那一条）：MultiMC **根下也有**
     *    共享 `libraries\`（本仓实测真机就是那样），而它的元数据（`mmc-pack.json`）**是权威的**
     *    ⇒ 兜底**不许**对它生效。⚠️ 版本**故意**与 `mmc-pack.json` 里那个不同（`9.9.9`）：
     *    少了那道 kind 守卫时，读数会从 `fabric ${MMC_LOADER_VERSION}` 变成 `fabric 9.9.9`
     *    ⇒ 下面那条判据当场红 ✓。
     *    ⚠️★ 它必须造在 **`treesBeforeText` 取指纹之前**：第一版把它放在指纹之后 ⇒
     *       A13 那条判据量到的是"我自己刚造的那 5 个目录"（35 → 40 个条目），红在**夹具自己**身上 ✗。
     */
    mkdirSync(join(mmcRoot, 'libraries', 'net', 'fabricmc', 'fabric-loader', '9.9.9'), {
      recursive: true,
    });

    const mmcKey = `multimc:${relative(mmcRoot, mmcInstance).split(sep).join('/')}`;
    const fbKey = `pcl2:${relative(fallbackRoot, fbInstance).split(sep).join('/')}`;
    const samePath = (a, b) => resolve(String(a)).toLowerCase() === resolve(String(b).toLowerCase());

    /*
     * ★★ **① 的夹具必须落在"常见位置"的候选表里** —— 这是第一版红掉的那两条的真正原因：
     *    `probeLaunchersOnDisk()` 只扫 **spec §6 的常见位置**（各启动器默认目录、用户主目录、
     *    盘符根下的同名目录 + MCSR 那三个）⇒ 我把夹具放在 `<tmp>` 下时，它们**根本不是候选**，
     *    于是"五个根逐条命中"永远不可能成立（**与产品行为无关** ✗）。
     *    ⚠️★ 而**不能**改成"用真机那些根"（`D:\MultiMC` 有 31 个真实例）—— 那是拿用户的实例当夹具 ✗。
     *    ⇒ 做法：把那张候选表**照抄一份**（它是 spec §6 钉住的**行为**，不是实现细节），
     *      运行期挑一个**盘上还不存在**的候选位置当夹具根，跑完删掉。
     *      ⚠️ 抄一份的代价写在下面那条"（前置）"里：**先断言我挑的那个位置本来是空的** ——
     *        抄错了 / 机器上真有它 ⇒ 那一条当场红，而不是让①变成一句假话（§5.79）。
     *      ⚠️ 只挑**第一个**空的（`slice(0, 1)`）：多挑几个会把"差集"搞复杂，而①要的
     *        "只报命中的、不报没造的"由下面那条"**负向**夹具"（造一个**解析不出实例**的根）量。
     */
    const home = homedir();
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
    const candidateSlots = [
      ['multimc', join(home, 'MultiMC')],
      ['prism', join(home, 'PrismLauncher')],
      ['pcl2', join(home, 'PCL2')],
      ['hmcl', join(home, 'HMCL')],
      ['multimc', join(appData, 'MultiMC')],
      ['prism', join(appData, 'PrismLauncher')],
      ['official', join(appData, '.minecraft')],
    ];
    const freeSlots = candidateSlots.filter(([, path]) => !existsSync(path));
    if (freeSlots.length === 0) {
      bail(
        'Task 5 的①那一组要一个"常见位置里还空着的槽"（spec §6 的候选表），而这一台机器上一个空的都没有',
      );
    }
    const [probeKind, probeRoot] = freeSlots[0];
    const probeName = '1.16.1-probe';
    const probeInstance = join(
      probeRoot,
      probeKind === 'official'
        ? join('versions', probeName)
        : probeKind === 'multimc' || probeKind === 'prism'
          ? join('instances', probeName)
          : join('.minecraft', 'versions', probeName),
    );
    mkdirSync(probeInstance, { recursive: true });
    /*
     * ★★ **① 的负向夹具**：一个"**在候选表里、但列不出任何实例**"的常见位置 ——
     *    spec §6 的官方默认目录 `%APPDATA%\.minecraft`（本机实测它**不存在**）。
     *
     * ⚠️★ 它为什么必须有：① 问的是"**只报命中的那几个根**"，而那是**两半**：
     *    · 造了的根**要在** —— 上面那条"这几个根逐条命中"量的是这一半；
     *    · 没造的 / 造了也列不出实例的根**不许在** —— 这一条量的是那一半。
     *    少了这一条，一个"**把全部候选根都报出来**"的坏实现会完全通过①，
     *    而那正是 spec §6 明确否掉的行为（"报了一个它其实不用的根"比"什么都没报"更坏：
     *    用户会以为已经绑好了，之后所有判定都落在错的目录上）。
     * ⚠️ 它必须**先确认那个位置真的不在**（`freeSlots` 里就有它）—— 否则这一条是
     *    "拿一个本来就有实例的根去断言它不在"，判据与夹具自相矛盾。
     * ⚠️ 用 `driveRoots()` 那两个盘符根下**不存在**的同名目录也行，但这里选 `%APPDATA%\.minecraft`：
     *    它是"**人人几乎都有、而未必真在用**"那个反例的**原产地**，最贴近它对治的坏法。
     */
    const negativeRoot = join(appData, '.minecraft');
    const negativeIsClean = !existsSync(negativeRoot);
    console.log(`  ① 夹具用一个**本来空着**的常见位置：${probeKind}:${probeRoot}（跑完删掉）`);
    console.log(
      `  ① 负向夹具（候选表里、但列不出实例）：${negativeRoot} —— 本来${negativeIsClean ? '**不在**' : '**在**（这一条会跳过）'}`,
    );

    const isFixtureRoot = (hit) =>
      fixtureRoots.some(([kind, root]) => hit.kind === kind && samePath(hit.rootPath, root)) ||
      (hit.kind === probeKind && samePath(hit.rootPath, probeRoot));
    const hitFor = (hits, kind, root) =>
      hits.find((hit) => hit.kind === kind && samePath(hit.rootPath, root));
    /** 这个根是不是"这一台机器上本来就有的"（= 不在我造的那几个里）。 */
    const isForeignRoot = (hit) => !isFixtureRoot(hit);

    /*
     * ★★ **A13（只读纪律）**的仪器：把一棵树的 `相对路径 | 类型 | 大小 | mtimeMs` **排序后**
     *    拼成一个指纹。
     *
     * ⚠️★ 它量的是**启动器 / 实例那几棵树** —— **不含**我们自己的状态文件（那一份住
     *    `currentUserDataDir`，在另一个目录里）⇒ "本功能写自己的状态"**不会**被这条判据当成违规 ✓。
     * ⚠️ mtimeMs 取整到毫秒：不同文件系统上它的精度不同，而"读一遍"与"写一遍"的差远大于
     *    精度差 ⇒ 既够敏感、又不会因为精度抖动假红。
     * ⚠️ 用 `lstatSync`（**不跟随**符号链接）：跟随的话，"往链接目标写"会被记成链接自己的读数。
     */
    const treeFingerprint = (root) => {
      const rows = [];
      const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name);
          const st = lstatSync(path);
          rows.push(
            `${relative(root, path).split(sep).join('/')}|${entry.isDirectory() ? 'd' : 'f'}|${String(st.size)}|${String(Math.trunc(st.mtimeMs))}`,
          );
          if (entry.isDirectory()) walk(path);
        }
      };
      if (existsSync(root)) walk(root);
      return rows.sort().join('\n');
    };
    const treeEntryCount = (text) => (text === '' ? 0 : text.split('\n').length);
    /*
     * ⚠️★ `probeRoot` **也在指纹里**：它是①那个"常见位置里的空槽"，而产品在枚举时
     *    会**读**它（`listInstances` 要列它的实例）⇒ 它必须与另外五个根受同一条纪律管。
     *    ⚠️ 这一段（含 `probeRoot` 的创建、以及 MMC 根下那份 `libraries\`）**必须排在
     *    第一次 `invoke` 之前** —— 第一版把那份 `libraries\` 造在指纹之后，A13 当场红在
     *    "我自己刚造的 5 个目录"上（35 → 40 个条目）✗。
     */
    const fixtureRootPaths = [...fixtureRoots.map(([, root]) => root), probeRoot];
    const treesBeforeText = fixtureRootPaths.map((root) => treeFingerprint(root)).join('\n=====\n');
    console.log(`  Task 5 夹具根：${workRoot}`);
    console.log(`    MultiMC 实例：${mmcName}（mods 在实例内）`);
    console.log(`    PCL2：${pclIsoName}（隔离）/ ${pclSharedName}（共享）`);
    console.log(`    官方：${officialRoot}（一律共享根下的 mods）`);
    console.log(`    ⑧ 兜底夹具：${fallbackRoot}（共享 libraries\\ 里有 ${FALLBACK_LOADER_VERSION}）`);
    console.log(
      `  A13 指纹（枚举 / 勾选 / 确认之前）：${String(fixtureRootPaths.reduce((n, root) => n + treeEntryCount(treeFingerprint(root)), 0))} 个条目，sha256 前 16 位 ${createHash('sha256').update(treesBeforeText).digest('hex').slice(0, 16)}`,
    );

    // ---- ① probeLaunchers：**差分**读数（对照取在本节开头 = 造夹具之前）-------------
    /*
     * ⚠️★ 差分而不是"只有我那几个根"：见这一节开头那一段（本机真的有 `D:\MultiMC` / `D:\PCL2`），
     *    以及"对照必须取在造夹具之前"那一段（否则差集恒空）。
     */
    console.log(
      `  对照（这一台机器**本来**就有的探测命中）：${beforeHits.length === 0 ? '（一个都没有）' : beforeHits.map((h) => `${h.kind}:${h.rootPath}`).join(' | ')}`,
    );
    const hits = await invoke(MOD_CH.probeLaunchers);
    const added = hits.filter((hit) => hitFor(beforeHits, hit.kind, hit.rootPath) === undefined);
    /*
     * ⚠️★★ **为什么这里只断言"多了①那一个候选槽"，而不是"多了六个夹具根"**（第一版就是这么错的）：
     *    `probeLaunchers` 的候选表是**固定**的（spec §6 的常见位置）⇒ 我那五个放在 `<tmp>` 下的
     *    夹具根**永远不可能是候选** ⇒ 它们**一个都不会出现**在结果里。那不是缺陷，是**规则**：
     *    探测只回答"**这台机器的常见位置上有什么**"，不回答"我刚才绑了什么"。
     *    ⇒ ① 能且只能量两件事：**候选表里真的能列出实例的位置被报出来了**（这里就是那个槽），
     *      以及**列不出实例的位置一个都没被报**（负向那一条）。
     *    ⚠️ "这台机器本来就有的根照旧在"那一条是**对照**：一个"只报最近一次 `addLauncher`"
     *      的坏实现会让"多了一个"看起来对，而它会把 `D:\MultiMC` 那些真根丢掉 ⇒ 那条红 ✓。
     */
    check(
      '① `probeLaunchers`：**加了①那个候选槽的夹具之后**，结果里正好多出它这一个根（"这个根真的能列出实例"才报）',
      hitFor(hits, probeKind, probeRoot) !== undefined &&
        hitFor(beforeHits, probeKind, probeRoot) === undefined &&
        added.length === 1 &&
        samePath(added[0].rootPath, probeRoot),
      `对照 ${String(beforeHits.length)} 个 → 现在 ${String(hits.length)} 个；新增 ${JSON.stringify(added.map((h) => `${h.kind}:${h.rootPath}`))}；候选槽 ${probeKind}:${probeRoot}`,
    );
    check(
      '① 对照：机器上本来就有的那些根**照旧**在结果里（探测不是"只报我新加的那几个"）',
      beforeHits.every((hit) => hitFor(hits, hit.kind, hit.rootPath) !== undefined),
      `丢掉的是 ${JSON.stringify(beforeHits.filter((h) => hitFor(hits, h.kind, h.rootPath) === undefined).map((h) => `${h.kind}:${h.rootPath}`))}`,
    );
    check(
      `① 而且**没有多出别的**根（候选表固定 ⇒ 只该多出那一个：${String(hits.length)} = ${String(beforeHits.length)} + 1）`,
      hits.length === beforeHits.length + 1,
      `${String(hits.length)} = ${String(beforeHits.length)} 个真根 + 1 个夹具槽`,
    );
    /*
     * ★★ **①的"另一半点"：候选表里那些"列不出实例"的根不许被报出来。**
     *    上面几条量的都是"造了的要在"；这一条量"没造的 / 造了也空的**不许在**"。
     *    ⚠️ `negativeIsClean` 是这条判据的**前提**（那个位置本来真的不在）：它不成立时
     *      报一条**显式**的跳过，而不是让判据变成一句恒真的假话（§5.32 ②/④）。
     */
    check(
      `① ★ 负向：候选表里那个"列不出实例"的根（${negativeRoot}）**不许**出现在结果里 —— spec §6："报了一个它其实不用的根"比"什么都没报"更坏`,
      negativeIsClean ? hitFor(hits, 'official', negativeRoot) === undefined : true,
      negativeIsClean
        ? `结果里 ${hitFor(hits, 'official', negativeRoot) === undefined ? '没有它 ✓' : '**有它** ✗'}`
        : `（前提不成立：${negativeRoot} 本来就在盘上 ⇒ 这一条跳过，不算判据）`,
    );
    check(
      '① 对照：这一台机器上"本来的根"里**没有一个**是这一组的夹具根（否则上面那条差分是同义反复）',
      beforeHits.every(isForeignRoot),
      beforeHits.filter((h) => !isForeignRoot(h)).map((h) => `${h.kind}:${h.rootPath}`).join(' | ') ||
        '（一个都没有 ✓）',
    );

    // ---- ② listInstances：实例的**形状**逐条对（不拿"总数"当判据）-------------------
    openQueue = [];
    for (const [kind, root] of fixtureRoots) {
      await invoke(MOD_CH.addLauncher, kind, root);
    }
    check(
      '（前置）五条启动器绑定都进状态了（id = <类型>:<归一化根>）',
      (await invoke(MOD_CH.getState)).launchers.length === 5,
      JSON.stringify((await invoke(MOD_CH.getState)).launchers.map((l) => l.id)),
    );
    const views = await invoke(MOD_CH.listLauncherInstances);
    /*
     * ⚠️★ **不为"总数"写一个手抄的数字**：这一台机器上本来就有 `D:\MultiMC` / `D:\PCL2`
     *    那些真根（它们不在我的绑定里 ⇒ **不该**出现在这里），而**别的**真根（若有人绑过）
     *    会让总数变。判据改成**逐条**：我造的**每一条**都在，且形状逐格对；
     *    外加一条"总数 = 我造的条数"——它成立的前提是"这一组只绑了自己造的根"，
     *    而那一条由上面那条 `hits.length === before + 5` 与"没有别的绑定"两处兜住。
     */
    const byKey = (key) => (views ?? []).find((view) => view.key === key);
    const expectedInstances = [
      [mmcKey, mmcName, '1.16.1'],
      [`pcl2:${relative(pclRoot, pclIsoInstance).split(sep).join('/')}`, pclIsoName, '1.16.1'],
      [`pcl2:${relative(pclRoot, pclSharedInstance).split(sep).join('/')}`, pclSharedName, '1.20.1'],
      [`official:${relative(officialRoot, officialInstance).split(sep).join('/')}`, '1.16.1', '1.16.1'],
      [`hmcl:${relative(bareRoot, bareInstance).split(sep).join('/')}`, bareName, null],
      [fbKey, fbName, '1.16.1'],
    ];
    check(
      `② \`listInstances\` 枚举出**我造的这六条**（MultiMC / PCL2 两条 / 官方 / 裸 HMCL / 兜底那条；总数 ${String(expectedInstances.length)}）`,
      Array.isArray(views) &&
        views.length === expectedInstances.length &&
        expectedInstances.every(([key]) => byKey(key) !== undefined),
      `共 ${String(Array.isArray(views) ? views.length : '（不是数组）')} 条：${(views ?? []).map((v) => `${v.kind}/${v.name}`).join(' | ')}`,
    );
    check(
      '② 名字逐条对（枚举的是**实例目录下的子目录名**，不是从版本号推出来的）',
      expectedInstances.every(([key, name]) => byKey(key)?.name === name),
      expectedInstances.map(([key, name]) => `${String(byKey(key)?.name)}${byKey(key)?.name === name ? '' : `≠${name}`}`).join(' | '),
    );
    check(
      '② 游戏版本从**各自那份元数据**读出来（MultiMC=mmc-pack.json，其余=versions\\<名>\\<名>.json 的 clientVersion；裸 HMCL 那份 json 不存在 ⇒ null）',
      expectedInstances.every(([key, , version]) => (byKey(key)?.gameVersion ?? null) === version),
      expectedInstances.map(([key, , version]) => `${String(byKey(key)?.gameVersion)}（期望 ${String(version)}）`).join(' | '),
    );

    // ---- ③ modsDir / savesDir 逐家对 ----------------------------------------------
    const mmcView = byKey(mmcKey);
    const pclIsoView = byKey(expectedInstances[1][0]);
    const pclSharedView = byKey(expectedInstances[2][0]);
    const officialView = byKey(expectedInstances[3][0]);
    const bareView = byKey(expectedInstances[4][0]);
    const fbView = byKey(fbKey);
    check(
      '③ MultiMC ⇒ mods/saves 落在**实例内**的 .minecraft 下（天然隔离）',
      mmcView !== undefined &&
        samePath(mmcView.modsDir, mmcMods) &&
        samePath(mmcView.savesDir, join(mmcInstance, '.minecraft', 'saves')),
      `modsDir=${String(mmcView?.modsDir)}；期望 ${mmcMods}`,
    );
    check(
      '③ PCL2 **隔离**那条 ⇒ mods 落在 versions\\<名> 里面（它自己那份 mods 存在）',
      pclIsoView !== undefined && samePath(pclIsoView.modsDir, pclIsoMods),
      `modsDir=${String(pclIsoView?.modsDir)}；期望 ${pclIsoMods}`,
    );
    check(
      '③ PCL2 **共享**那条 ⇒ mods 落在 <根>\\.minecraft\\mods（它自己那份不存在）',
      pclSharedView !== undefined && samePath(pclSharedView.modsDir, pclSharedMods),
      `modsDir=${String(pclSharedView?.modsDir)}；期望 ${pclSharedMods}`,
    );
    check(
      '③ 官方 ⇒ **一律共享**（mods 落在**根**下，不是 <根>\\.minecraft\\mods）',
      officialView !== undefined && samePath(officialView.modsDir, join(officialRoot, 'mods')),
      `modsDir=${String(officialView?.modsDir)}；期望 ${join(officialRoot, 'mods')}`,
    );

    // ---- ④ 四处解析点都不存在 ⇒ needsConfirm ---------------------------------------
    check(
      '④ 两处（实例自己那份 / 共享那份）**都不在** ⇒ needsConfirm === true（不静默按共享）',
      bareView !== undefined &&
        bareView.needsConfirm === true &&
        samePath(bareView.modsDir, join(bareInstance, 'mods')),
      `needsConfirm=${String(bareView?.needsConfirm)} modsDir=${String(bareView?.modsDir)}`,
    );
    check(
      '④ 而它**旁边**那些（隔离的 / 共享的 / 官方那几条）全都是 false —— 这一格真的跟着条件走',
      [mmcView, pclIsoView, pclSharedView, officialView].every((view) => view?.needsConfirm === false),
      [mmcView, pclIsoView, pclSharedView, officialView]
        .map((v) => `${String(v?.name)}=${String(v?.needsConfirm)}`)
        .join(' | '),
    );

    // ---- ⑧ loader：兜底的**两半**都要有读数（真有 ⇒ 读得出；不该有 ⇒ 必须还是 null）---
    check(
      `⑧ 兜底：实例自己那份 json 没有 libraries、而共享 libraries\\ 里**恰好一个** fabric-loader ⇒ 报 fabric ${FALLBACK_LOADER_VERSION}`,
      fbView?.loader === `fabric ${FALLBACK_LOADER_VERSION}`,
      `loader=${String(fbView?.loader)}`,
    );
    check(
      '⑧ 对照：没有共享 libraries\\ 的那几条 ⇒ loader 仍然是 null（兜底不是"总给一个值"）',
      (officialView?.loader ?? null) === null && (pclSharedView?.loader ?? null) === null,
      [officialView, pclSharedView].map((v) => `${String(v?.name)}=${String(v?.loader)}`).join(' | '),
    );
    /*
     * ★★ **T12 那条守卫的读数**（控制器 2026-10-11 点名要的那一条）：上面那个
     *    `9.9.9` 就在 MMC 根下的共享 `libraries\` 里 ⇒ 重新枚举一次，它的 loader
     *    必须**仍然是元数据那一份**（没被兜底误报成 `fabric 9.9.9`）。
     *    ⚠️★ 它**必须重新枚举**（不能复用上面那份 `views`）：`loader` 是枚举那一刻算出来的，
     *       而现在盘上多了一份 `libraries\` ⇒ 复用旧读数的话，这一条量的是"加目录之前"的状态
     *       （一条**恒真**的读数 —— §5.32 ①）。
     */
    const viewsAgain = await invoke(MOD_CH.listLauncherInstances);
    const mmcAgain = (viewsAgain ?? []).find((view) => view.key === mmcKey);
    check(
      `★★ ⑧ 兜底的 kind 守卫：MultiMC 根下**也有**共享 libraries\\ ⇒ 它的 loader **仍然**是元数据那一份（fabric ${MMC_LOADER_VERSION}），没有被误报成 fabric 9.9.9`,
      mmcAgain?.loader === `fabric ${MMC_LOADER_VERSION}`,
      `loader=${String(mmcAgain?.loader)}（根下共享 libraries\\ 里是 9.9.9）`,
    );

    // ---- ⑤ 勾选 ⇒ 派生进 folders[] + 读数与普通文件夹一致 --------------------------
    state = await invoke(MOD_CH.getState);
    const missingBefore = state.missing ?? [];
    check(
      `⑤（前置）勾选**之前**：${derivedModid} 在缺失清单里（否则⑥那条"不见了"是空集上的恒真）`,
      missingBefore.some((m) => m.modid === derivedModid),
      `missing 共 ${String(missingBefore.length)} 条；含 ${derivedModid}=${String(missingBefore.some((m) => m.modid === derivedModid))}`,
    );
    await invoke(MOD_CH.setInstanceTracked, mmcKey, true);
    state = await invoke(MOD_CH.getState);
    const derived = state.folders.find((f) => f.folderId === mmcKey);
    check(
      '⑤ 勾选 ⇒ 它出现在派生的 folders[] 里，且 `folderId === instance.key`、`path === modsDir`',
      derived !== undefined && samePath(derived.path, mmcMods),
      derived === undefined
        ? `（没有这个 folderId；现有：${state.folders.map((f) => f.folderId).join(', ')}）`
        : `path=${derived.path}`,
    );
    check(
      '⑤ 而且**读数的形状与普通文件夹一致**：pathExists === true 且 hasReading === true（不是"勾了但没有读数"）',
      derived?.pathExists === true && derived?.hasReading === true,
      `pathExists=${String(derived?.pathExists)} hasReading=${String(derived?.hasReading)}`,
    );
    check(
      '⑤ 派生的那一格版本来自实例元数据（1.16.1），而 autoUpdate 是 true（否则下次启动不会扫它）',
      derived?.gameVersion === '1.16.1' && derived?.autoUpdate === true,
      `gameVersion=${String(derived?.gameVersion)} autoUpdate=${String(derived?.autoUpdate)}`,
    );
    /*
     * ★ **A9 的"与普通文件夹一致"**那半句要有一条**对照**：拿上面 `bindFolder` 造出来的
     *   手工绑定文件夹（`pre-folder`）与这条派生的比 —— 两边的读数形状必须**同类**。
     *   ⚠️ 少了它，"派生出来的 folder 与手工绑的**长得不一样**"这种坏法没人喊。
     */
    const manualFolder = state.folders.find((f) => f.path && samePath(f.path, preDir));
    check(
      '⑤ 对照：同一份状态里那个**手工绑定**的文件夹读数形状与它同类（pathExists / hasReading 两格都在）',
      manualFolder !== undefined &&
        typeof manualFolder.pathExists === 'boolean' &&
        typeof manualFolder.hasReading === 'boolean',
      manualFolder === undefined
        ? '（没有 pre-folder —— 夹具前提不成立）'
        : `手工：pathExists=${String(manualFolder.pathExists)} hasReading=${String(manualFolder.hasReading)}`,
    );

    // ---- ⑥ ★★ 零功能损失（A10）：扫描 / 判定 / 缺失清单在派生 folder 上照旧 ---------
    check(
      `⑥ ★ A10：派生 folder 上**扫出了那一行**（${derivedModid}-1.16.1.jar 真的在它解析出的目录里）`,
      derived?.rows?.length === 1 && derived.rows[0].modid === derivedModid,
      `rows=${JSON.stringify((derived?.rows ?? []).map((r) => `${r.modid}@${String(r.localVersion)}`))}`,
    );
    check(
      '⑥ ★ A10：判定与今天逐字相同 —— 这个文件夹里没有无法识别的行（`unrecognized` 空着）',
      Array.isArray(derived?.unrecognized) && derived.unrecognized.length === 0,
      JSON.stringify(derived?.unrecognized ?? null),
    );
    check(
      `⑥ ★ A10：缺失清单跟着读数走 —— 已装进派生 folder 的 ${derivedModid} **从清单里消失**了`,
      (state.missing ?? []).every((m) => m.modid !== derivedModid),
      `missing 共 ${String((state.missing ?? []).length)} 条（勾选前 ${String(missingBefore.length)} 条）；含 ${derivedModid}=${String((state.missing ?? []).some((m) => m.modid === derivedModid))}`,
    );
    check(
      '⑥ ★ A10：而清单**仍然是那一份**（条数只差这一条 ⇒ 少了的那条不是"整份清单被清空"）',
      (state.missing ?? []).length === missingBefore.length - 1,
      `${String(missingBefore.length)} → ${String((state.missing ?? []).length)}`,
    );
    check(
      '⑥ ★ A10：清单每一行**仍然**带着 release 与 manual 两格（形状没有被派生这条路改掉）',
      (state.missing ?? []).every(
        (m) => m.release?.modid === m.modid && (m.release?.download === 'manual') === m.manual,
      ),
      JSON.stringify((state.missing ?? []).slice(0, 2).map((m) => m.modid)),
    );

    // ---- ⑦ 第七条通道 confirmInstance：标记消失 ----------------------------------
    await invoke(MOD_CH.confirmInstance, fbKey);
    state = await invoke(MOD_CH.getState);
    const fbConfirmed = (state.instances ?? []).find((instance) => instance.key === fbKey);
    check(
      '⑦ `confirmInstance`：确认之后那一格的 `needsConfirm` 变 false（"用户看过并接受了这份解析结果"落下来了）',
      fbConfirmed !== undefined && fbConfirmed.confirmed === true && fbConfirmed.needsConfirm === false,
      `confirmed=${String(fbConfirmed?.confirmed)} needsConfirm=${String(fbConfirmed?.needsConfirm)}`,
    );
    const bareStill = (state.instances ?? []).find((instance) => instance.key === expectedInstances[4][0]);
    check(
      '⑦ 对照：**没有**被确认的那一条（解析同样是猜的）仍然是 true —— 这一格不是"确认一个全都清"',
      bareStill?.needsConfirm === true,
      `needsConfirm=${String(bareStill?.needsConfirm)}`,
    );

    // ---- ⑦ 取消勾选 ⇒ folder 消失 + 读数一并清 ------------------------------------
    const missingAfterTrack = (await invoke(MOD_CH.getState)).missing ?? [];
    await invoke(MOD_CH.setInstanceTracked, mmcKey, false);
    state = await invoke(MOD_CH.getState);
    check(
      '⑦ 取消勾选 ⇒ `folders[]` 里它消失了（派生的那一格被回收）',
      state.folders.every((f) => f.folderId !== mmcKey),
      `folders = ${state.folders.map((f) => f.folderId).join(', ') || '（空）'}`,
    );
    check(
      `⑦ 而且**读数一并清**：${derivedModid} 重新回到缺失清单里（旧读数没有被留在缓存里）`,
      (state.missing ?? []).some((m) => m.modid === derivedModid),
      `missing 共 ${String((state.missing ?? []).length)} 条（取消前 ${String(missingAfterTrack.length)} 条）`,
    );

    /*
     * =========================================================================
     * ★★ T10（D1）：`selectLauncherRoot` 那条**复合动作**在真实 IPC 上的净效果
     * =========================================================================
     * ⚠️★ 现场（T8 自己认下的"最大未覆盖面"）：契约里**没有**"改根"这条通道 ——
     *    界面上那颗「改根」走的是**移除旧绑定 + 加新根**两步
     *    （`apps/web/src/components/ModFoldersData.tsx` 的 `selectLauncherRoot`），
     *    而**这两步在真实 IPC 上一次都没有被跑过**：
     *      · 渲染自检 51g 只钉"那一支接的是 `handlers.selectLauncherRoot(...)`"（**源码形状**）；
     *      · 本探针原来只跑过 `addLauncher` / `removeLauncher` 各自的**单条**语义，
     *        没有跑过"两步连起来"的结果。
     *    ⇒ 一个把两步写成 `add` 在前 / `remove` 在后（或漏掉其中一步）的实现会**全绿通过**
     *      今天所有的门禁与探针，而用户的绑定要么消失、要么留着旧根。
     *
     * ⚠️★ **顺序是承重的**（`selectLauncherRoot` 的注释逐字写着）：必须**先移除旧的、
     *    再加新根**。反过来（先加后删）在"新根归一化之后与旧根是同一条"时
     *    （`D:\PCL2` 与 `D:\PCL2\` —— 主进程在入口归一化，两者是**同一条**）
     *    会走成"加同一条（幂等、状态不变）+ 删掉它" ⇒ **绑定直接消失**。
     *    ⚠️ 本探针**不做**归一化那一半（它要动主进程的归一化，超出这一轮的 in-scope）——
     *    那一半由下面这条"净效果"判据的**形状**兜着：绑定数必须**不变**。
     *
     * ⚠️★★ 这一节**只跑 IPC**，它证不了"界面那一层真的按这个顺序发"：
     *    那一层由渲染自检 51g 的源码形状守卫钉着（两个方向合起来才是完整的判据）。
     *
     * ⚠️★ **已知代价**（`mod-folders.ts` 的 `removeLauncher` 注释 + `ModFoldersData` 的
     *    `selectLauncherRoot` 注释都逐字写着）：`removeLauncher` 会把它**名下**被追踪的实例
     *    一律转为**不再追踪**（读数一并清）。改根本来就会换掉这些实例的解析结果 ⇒
     *    用户本来就要重新看一眼、重新勾；而"绑定消失"是不可恢复的那一种。
     *    ⇒ 下面**专门有一条判据量这个代价的现场**（不是"顺带发现"：它必须**真的发生**，
     *      否则"改根"这条路的语义变了，而没有任何人会发现）。
     */
  await section(
    '★ T10：改根（移除旧绑定 + 加新根）这条复合动作在真实 IPC 上的净效果与已知代价',
    async () => {
      /*
       * ⚠️★ 位置是**承重**的：这一节必须跑在"收尾把那五条绑定移掉"**之前**
       *    （那一步是按 `fixtureRoots` 逐条删的，跑完之后 `<tmp>` 下一条绑定都不剩
       *    ⇒ 这一节连"改哪条根"都摆不出来）。
       * ⚠️ 它必须跑在"⑦ 取消勾选"**之后**：那一步已经把 `mmcKey` 取消了追踪，
       *    所以下面第 ① 步的"勾上"是真的**从 false 到 true**（有现场），
       *    而不是踩在前一步留下的状态上。
       * ⚠️ 收尾：跑完把这一节自己加的那条绑定**移掉**（收尾那一趟按 `fixtureRoots`
       *    删，看不到这个新根 ⇒ 留着它就等于往后面几组留了一条野绑定）。
       */
      /*
       * ★★ T10 修复轮（评审 C1）：这个新根**必须与 `mmcRoot` 逐字不同**。
       *
       * ⚠️★★ 第一版写的是 `join(workRoot, 'MultiMC')` —— 那与上面 `mmcRoot` **是同一个字符串**
       *    ⇒ "移除旧绑定 + 加新根"退化成**同一条上的无操作**（`addLauncher` 对同一个
       *    `(kind, 归一化后的根)` 是幂等的）⇒ 下面那条"净效果：绑定数不变"**在把
       *    `removeLauncher` 整行删掉时照样绿**（实测：`绑定 5 → 5`）—— 一条**空炮**：
       *    夹具把一个不动的对象当成了被测对象（评审 C1 的现场）。
       *    ⇒ 教训写在这里：**"改根"这一节的夹具必须让两边的根不同**，否则它测的是"没改"。
       * ⚠️ 为什么不写 `join(workRoot, 'MultiMC') + '\\'`（真实用户多打一个尾部分隔符那种）：
       *    主进程在入口把尾部分隔符归一化掉 ⇒ 那又变成**同一条**（同 C1 的空炮形状）。
       *    那条危险路径（"先加后删"会让绑定消失）是**归一化**那一件事的判据，
       *    不在这一节（见本节开头那一段"本探针不做归一化那一半"）。
       */
      const multiFixtureRoot = join(workRoot, 'MultiMC-moved');
      /** ⚠️ 必须与 `mmcKey` **逐字相同**（见下面那一段：key 里没有根）。 */
      const newName = 'multimc:instances/1.16.1 - Ranked#1';
      if (mmcKey !== newName) {
        bail(`这一节的夹具前提不成立：mmcKey=${mmcKey} 与 newName=${newName} 应当逐字相同`);
      }
      /*
       * ★★ 夹具自钉（C1 的回归哨）：两个根**必须不同**（`samePath` 与逐字都比较一次）。
       *    ⚠️ 少了这一条，下一个人把 `multiFixtureRoot` 改回 `MultiMC` 时**没有任何信号** ——
       *    而代价是这一节整节变成空炮（这一轮的 C1 就是这么来的）。
       */
      if (samePath(mmcRoot, multiFixtureRoot)) {
        bail(
          `这一节的夹具前提不成立：新根与旧根是同一个（${multiFixtureRoot}）⇒ ` +
            '"移除旧的 + 加新根"会退化成无操作，净效果那一条就成了空炮（评审 C1）',
        );
      }
      /** 一个实例的 `mods` 目录的归一化形式（用来判"那条读数是不是同一个实例"）。 */
      const modsOf = (path) => resolve(join(String(path), '.minecraft', 'mods')).toLowerCase();

      // ① 勾上它（派生一条 folder ⇒ "改根清掉勾选"这件事才有现场）
      await invoke(MOD_CH.setInstanceTracked, mmcKey, true);
      const beforeChange = await invoke(MOD_CH.getState);
      check(
        'T10（前置）改根之前：那个实例在 `folders[]` 里（派生出来的），而且它的勾是真的',
        beforeChange.folders.some((folder) => folder.folderId === mmcKey) &&
          (beforeChange.instances ?? []).some(
            (instance) => instance.key === mmcKey && instance.tracked === true,
          ),
        `bindings=${JSON.stringify(beforeChange.launchers.map((entry) => entry.id))}；` +
          `folders=${JSON.stringify(beforeChange.folders.map((folder) => folder.folderId))}；` +
          `tracked=${String((beforeChange.instances ?? []).find((i) => i.key === mmcKey)?.tracked)}`,
      );

      /*
       * ② 复合动作本体 = `selectLauncherRoot` 那两行**逐字**（先移除旧的、再加新根）。
       *    ⚠️ 它证的是"这两步在真实 IPC 上连起来是什么结果"；"界面那一层真的按这个顺序发"
       *    由渲染自检 51g 钉（见这一段开头）。
       */
      const oldBindingId = `multimc:${mmcRoot}`;
      await invoke(MOD_CH.removeLauncher, oldBindingId);
      await invoke(MOD_CH.addLauncher, 'multimc', multiFixtureRoot);

      // ③ 净效果：绑定换掉了，而**数量没变**（多一条 / 少一条都是坏法）
      const afterChange = await invoke(MOD_CH.getState);
      const mmcBindings = afterChange.launchers.filter((entry) => entry.kind === 'multimc');
      check(
        'T10 ★★ 净效果：多启动器那一家的绑定**还是一条**（改根 = 移除旧的 + 加新根 ⇒ 总数不变；' +
          '写成"只加不删"会是 6 条、写成"只删不加"会是 4 条）',
        afterChange.launchers.length === beforeChange.launchers.length &&
          mmcBindings.length === 1,
        `绑定 ${String(beforeChange.launchers.length)} → ${String(afterChange.launchers.length)}：` +
          JSON.stringify(afterChange.launchers.map((entry) => entry.id)),
      );
      check(
        'T10 ★★ 而且那一条绑定的根**就是用户新填的那个**（旧根不在表里了）',
        mmcBindings.length === 1 && samePath(mmcBindings[0].rootPath, multiFixtureRoot),
        `multimc 那一条的 rootPath=${String(mmcBindings[0]?.rootPath)}；期望 ${multiFixtureRoot}`,
      );
      check(
        'T10 ★★ 别家的绑定**一个都没被碰**（那四条照旧在 ⇒ 改根的作用域只有它自己那一条）',
        ['pcl2', 'official', 'hmcl'].every((kind) =>
          afterChange.launchers.some((entry) => entry.kind === kind),
        ),
        JSON.stringify(afterChange.launchers.map((entry) => `${entry.kind}:${entry.rootPath}`)),
      );

      check(
        'T10 ★★ 而它派生出来的那条 folder 也一起消失了（`folderId === instance.key`）',
        afterChange.folders.every((folder) => folder.folderId !== mmcKey),
        `folders=${JSON.stringify(afterChange.folders.map((folder) => folder.folderId))}`,
      );

      /*
       * ④ 已知代价的现场（两条**互相独立**的读数，§5.38 那条纪律）。
       *
       * ⚠️★★ T10 修复轮（评审 C1 的连带）：第一版这一格读的是"改根之后 `state.instances` 里
       *    那条实例的 `tracked`" —— 那个读法**只在"新根 == 旧根"时才拿得到东西**：
       *    根一换，那条实例就不在枚举结果里了（它属于旧根）⇒ 读数恒为 `undefined` ⇒ 那一条
       *    必然红。**夹具一改对，这一个读法就失效了**（这正是"夹具的洞"被发现之后的连带）。
       * ⇒ 换成两条**不依赖"它还枚举得到"**的读数：
       *    ① **盘上那份 prefs**（`file-tracking.json` 的 `instancePrefs[<key>].tracked`）——
       *       它是 `removeLauncher` 真正写下去的东西，与投影无关；
       *    ② **端到端**：把旧根**再加回来**，看那条实例是不是带着 `tracked === false` 回来
       *       （用户可见的那一面：改完根再改回去，勾选没了、要重新勾）。
       *    ⚠️★ 判据**不能**拿 `key` 判"是不是同一条实例"（`mmcKey` 与"新根下将来那个实例"的
       *    key 是**同一个字符串**：key 里只有相对路径、没有根）⇒ 拿 **`modsDir` 路径**判
       *    （`removeLauncher` 也是按路径判"哪些实例在这个根里面"的，`isInsideFolder`）。
       */
      const prefOnDisk = readStateFileJson()?.instancePrefs?.[mmcKey];
      check(
        'T10 ★★ 已知代价①（**盘上那份**读数）：`file-tracking.json` 里 `instancePrefs[<key>].tracked` 被翻成 `false` —— ' +
          '`removeLauncher` 会把它名下被追踪的实例一律转为"不再追踪"（改根本来就会换掉它们的解析结果）',
        prefOnDisk?.tracked === false,
        `盘上那一格=${JSON.stringify(prefOnDisk ?? null)}`,
      );
      /*
       * 端到端那一半：把**旧根**再加回来 ⇒ 那条实例回来、但勾选是空的。
       * ⚠️ 它会多出一条 `multimc:${mmcRoot}` 绑定（`fixtureRoots` 里有它 ⇒ 后面那一趟收尾
       *    会顺手删掉它）；本条读完之后马上确认它真的被删（见下面那条收尾判据）。
       */
      await invoke(MOD_CH.addLauncher, 'multimc', mmcRoot);
      const afterReadd = await invoke(MOD_CH.getState);
      const readdedInstance = (afterReadd.instances ?? []).find(
        (instance) => modsOf(instance.modsDir) === modsOf(mmcMods),
      );
      check(
        'T10 ★★ 已知代价②（**端到端**）：把旧根**加回来** ⇒ 那条实例回来了、而勾选**是空的**' +
          '（`tracked === false`）—— 用户可见的那一面：改完根再改回去，得重新勾一次',
        readdedInstance !== undefined && readdedInstance.tracked === false,
        readdedInstance === undefined
          ? `（找不到那条实例 —— 现读：${JSON.stringify((afterReadd.instances ?? []).map((i) => i.modsDir))}）`
          : `tracked=${String(readdedInstance.tracked)}（路径 ${String(readdedInstance.modsDir)}）`,
      );
      check(
        `T10 ★★ 而它**没有**派生回 ` +
          '`folders[]`（勾选没了 ⇒ 不派生），盘上那份已装的 mod（' +
          `${derivedModid}）**照旧在缺失清单里** —— ` +
          'A13：改根只动我们自己的记账，一个字节都没碰盘上那份 jar',
        afterReadd.folders.every((folder) => folder.folderId !== mmcKey) &&
          (afterReadd.missing ?? []).some((entry) => entry.modid === derivedModid),
        `folders=${JSON.stringify(afterReadd.folders.map((folder) => folder.folderId))}；` +
          `missing 共 ${String((afterReadd.missing ?? []).length)} 条；` +
          `含 ${derivedModid}=${String((afterReadd.missing ?? []).some((e) => e.modid === derivedModid))}`,
      );

      /*
       * ⑤ 收尾：把这一节自己加的两条绑定都移掉（新根那条 + 上面刚加回来的旧根那条）。
       *    ⚠️★ 新根那条**必须单独移**：后面那一趟收尾是按 `fixtureRoots` 逐条删的，而
       *    `multiFixtureRoot` **不在**那张表里 ⇒ 不移的话它会活到后面几组，
       *    而那些组的判据会因为多一条野绑定而红在**夹具**上。
       */
      await invoke(MOD_CH.removeLauncher, `multimc:${multiFixtureRoot}`);
      await invoke(MOD_CH.removeLauncher, `multimc:${mmcRoot}`);
      const cleaned = await invoke(MOD_CH.getState);
      check(
        'T10（收尾）这一节自己加的两条绑定都移掉了（新根那条 + 上面加回来的旧根那条）',
        cleaned.launchers.every(
          (entry) =>
            !samePath(entry.rootPath, multiFixtureRoot) && !samePath(entry.rootPath, mmcRoot),
        ),
        JSON.stringify(cleaned.launchers.map((entry) => entry.id)),
      );
    },
  );

    // ---- 收尾：把这五条绑定移掉（后面那一组从干净状态起步）--------------------------
    /*
     * ⚠️★ 现读**当刻**的绑定表（不用上面那个 `state` 快照）：T10 那一节刚刚把 multimc
     *    那一条**换成了另一个根**（改根 = 移除旧的 + 加新根）⇒ 快照里那个 id 已经不存在了，
     *    照快照删会抛"状态里没有这条启动器绑定"（**实测踩到**：T10 那一节 8 条全绿、
     *    而这里抛一条 —— 红在夹具的记账上，不在产品上，§5.79 那一族）。
     */
    const beforeCleanup = await invoke(MOD_CH.getState);
    for (const [, root] of fixtureRoots) {
      const binding = beforeCleanup.launchers.find((entry) => samePath(entry.rootPath, root));
      if (binding !== undefined) await invoke(MOD_CH.removeLauncher, binding.id);
    }
    check(
      '（收尾）五条启动器绑定都移掉了（后面那一组从干净状态起步）',
      (await invoke(MOD_CH.getState)).launchers.length === 0,
      JSON.stringify((await invoke(MOD_CH.getState)).launchers.map((l) => l.id)),
    );

    /*
     * ★★ **A13（只读纪律）**：上面那一整趟（枚举 / 勾选 / 取消勾选 / 确认）跑完之后，
     *    启动器那几棵树必须**逐字节没被碰过** —— 大小、mtime、条目集合三样都在指纹里。
     *
     * ⚠️★ 它为什么必须有（这是一个**判据缺口**，由 T4 的收口报告点出来）：spec A13 是
     *    D1 的一条硬约束（"除三种下载外，不改启动器/实例的任何文件" —— `instance.cfg` /
     *    `mmc-pack.json` / `versions\<名>\<名>.json` 都不动），而在这个探针之前，仓库里
     *    **没有任何判据**量过它（T4 那份量过指纹的探针**不在仓库里**）。
     * ⚠️★ 它**能红**：在参照 worktree 里往"枚举那一趟"塞一次写入（`realFs.listDir()` 里
     *    多写一个文件）⇒ 下面这条当场红（读数见 T5 的报告 / `.cache/t5-ref-*`）。
     * ⚠️ 它**不是**"跑两遍指纹都一样"那种恒真：`treesBeforeText` 取在**夹具造完之后、
     *    任何一次 `invoke` 之前** ⇒ 这一整段里产品若碰了那棵树，它一定落在这两个读数之间。
     * ⚠️★ T10 修复轮（评审 M4）：这一段在 T10 那一轮被**纯缩进位移**（4 空格 → 2 空格）
     *    改过一次 —— 行为没变（`✗` 0 条可证），但那种 diff 会把真正的改动埋掉。
     *    已还原成它本来的层级（它在 `await section(...)` 的花括号里 ⇒ 4 空格）。
     */
    const treesAfterText = fixtureRootPaths
      .map((root) => treeFingerprint(root))
      .join('\n=====\n');
    check(
      '★★ A13：枚举 / 勾选 / 取消勾选 / 确认这一整趟**没有碰过**启动器那几棵树（大小 + mtime + 条目集合逐字节一致）',
      treesAfterText === treesBeforeText,
      treesAfterText === treesBeforeText
        ? `两边都是 ${String(fixtureRootPaths.reduce((n, root) => n + treeEntryCount(treeFingerprint(root)), 0))} 个条目、sha256 前 16 位 ${createHash('sha256').update(treesAfterText).digest('hex').slice(0, 16)}`
        : `指纹变了：${String(treeEntryCount(treesBeforeText))} → ${String(treeEntryCount(treesAfterText))} 个条目`,
    );

    /*
     * ★ 收尾：把①那个"常见位置里的空槽"**删掉** —— 它住在**用户的真实目录**里
     *   （`%USERPROFILE%\MultiMC` 那一族，不是 `<tmp>`）⇒ 留着它就是"往这台机器上
     *   放了一个假启动器"（下一次跑探针时它会变成"本来就有的根"，§5.79 那一族的温床）。
     *   ⚠️ 只删**我自己造的那一层**（`probeRoot`），不动它的任何祖先。
     */
    rmSync(probeRoot, { recursive: true, force: true });
    check(
      '（收尾）① 那个"常见位置里的空槽"删掉了（不留一个假启动器在这台机器上）',
      !existsSync(probeRoot),
      probeRoot,
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
    /*
     * ★★ 2026-10-11（D1）：**D1 的两格补上** ⇒ 这一份是"**我们这一版自己写出来的**文件"。
     *    `migrateState()` 的"清 `folders`"只对"D1 之前写的"生效，判据正是这两格**都不在**
     *    ⇒ 少了它们，case c 那条"三格原样保留"会被**合法地**清一次（spec A16），
     *      而它要测的是"post-D1 文件：坏类型被归一化、其余逐格照旧" ✓。
     *    ⚠️ case b（`missing`，三格全缺）**故意不动** —— 它测的**正是**"D1 之前的文件"
     *      被清空那一支（A16 的一次性迁移）。
     */
    launchers: [],
    instancePrefs: {},
    prefs: { bulkChannel: { mirrorId: 'gh-proxy' }, catalogGameVersion: '1.8.9', tagFilter: ['legal'] },
  };
  /** case a：`stateVersion: 2` 但三格是**类型不对**的 ⇒ 必须走 v1 那条"备份 + 重建 + 告诉用户"。 */
  const bad = {
    version: 1,
    stateVersion: 2,
    items: {},
    catalogBindings: {},
    folders: null,
    // ⚠️ 这两格在 / 不在，都走不到这里：`folders: null` 由 `normalizeFolders` 判成**坏文件**
    //    （Ruling 31），与迁移那条"清 folders"是两条独立的路 ⇒ 补上它是为了让这份夹具
    //    是"一份 post-D1 文件、但其中一格类型不对"这个**真实**形态，而不是缺两格的旧文件。
    launchers: [],
    instancePrefs: {},
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
    // ★ 同上（本文件那个 `const good` 夹具）：case d 测的是"post-D1 文件里 catalogBindings 的旧数据被清掉、
    //   而 **folders 与 prefs 逐格照旧**" ⇒ 这两格必须在，否则 `folders` 会被合法地清一次。
    launchers: [],
    instancePrefs: {},
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
  /*
   * ★★ 2026-10-11（D1）：**这两格必须在**（与主相位那份播种状态同一条理由）。
   *
   * ⚠️★ 这一处是**判别实验**定下来的，不是猜的（现场读数在 T5 的报告里）：
   *    少了它们，这份夹具就是"**D1 之前**写的文件" ⇒ `migrateState()` 会**合法地**
   *    把 `folders` 清一次（spec A16）⇒ 那个 `f-auto` 文件夹没了 ⇒ 下面这一整段
   *    （"文件夹推断出 1.16.1 ⇒ 采纳进 `catalogGameVersion`"）的**前置**就不成立
   *    （等不到"目录 ok 且文件夹已扫"的推送）⇒ 4 条红**全落在夹具上**，
   *    而它们看起来像"Ruling 37 坏了"（§5.79：红/空结果先问一句"如果它没跑，会长什么样"）。
   *    ⚠️ 我一开始把它归因成"迁移没落盘"（候选 B），判别实验否掉了它：
   *    `node .cache/t5-migration-trace.mjs <userData>` 的读数是
   *    **启动之前** `launchers=undefined instancePrefs=undefined` → **启动之后**
   *    `launchers=[] instancePrefs={} folders=[]`，而且盘上那份的 **mtime 真的动了**、
   *    字节 280 ⇒ **第一次启动确实把这两格写下去了** ⇒ 是夹具过期（候选 A），不是真缺陷 ✓。
   */
  const seed = {
    version: 1,
    stateVersion: 2,
    items: {},
    catalogBindings: {},
    folders: {
      'f-auto': { path: instanceMods, gameVersion: null, autoUpdate: true, boundAt: 1 },
    },
    launchers: [],
    instancePrefs: {},
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
  /*
   * ⚠️★ case h / i 的夹具**只有 `folders` 那一族**（一份"D1 之前"的文件）⇒ 它**没有**
   *    `f-auto` 那一格。下面那条"（对照）那个文件夹确实推断得出 1.16.1"因此对它们**不适用**
   *    （少了它，那一条会在正确的实现上红，而那是一条**夹具缺陷**长得像产品缺陷的红）。
   */
  const HAS_FAUTO_FIXTURE = CASE !== 'h' && CASE !== 'i' && CASE !== 'j';

  /*
   * ★★ **Task 5（D1）/ spec A16：一次性迁移**的夹具 —— 一份"**D1 之前**写的 v2 文件"。
   *
   * 形状（三个判据，缺一个这条读数就失去分辨力）：
   *   ① `folders` **非空** —— 一条**手工绑定**的 entry：`manual-migration-folder`
   *      （⚠️★ 手工绑定的 id 在真实运行里是**路径的 sha1**，它**不是** `instance.key` 的形状；
   *       对账（`reconcileFolders`）对"没有 pref"的 entry **原样保留** ⇒ 它是唯一能
   *       **跨第二次启动**活下来的那种 entry。一条 `instance.key` 形状的 entry 活不下来：
   *       没有 `launchers` 就枚举不出实例 ⇒ 对账**合法地**回收它 —— 那是 A9 的行为，不是缺陷）；
   *   ② D1 那两格 `launchers` / `instancePrefs` **都不在**（控制器 2026-10-11 现读裁定的判据：
   *      只有"两格都不在"才是"上一版写的文件" ⇒ 才该被清一次）；
   *   ③ 那条 folder 的目录**真的在盘上**（`pathExists` 才是 true —— 一份路径不存在的
   *      旧绑定说明不了"它被保留了"）。
   */
  const d1Root = join(workRoot, 'D1-migration');
  const manualMods = join(d1Root, 'manual-mods');
  mkdirSync(manualMods, { recursive: true });
  makeJar(join(manualMods, 'migration.jar'), { id: ANTIGONE, version: '2.0.0' });
  const migrationFolders = {
    'manual-migration-folder': {
      path: manualMods,
      gameVersion: '1.16.1',
      autoUpdate: true,
      boundAt: 7,
    },
  };
  const migrationSeed = {
    version: 1,
    stateVersion: 2,
    items: {},
    catalogBindings: {},
    folders: migrationFolders,
    prefs: prefsBase,
  };
  /*
   * ⚠️★ 这份夹具的**字节**要留一份：case h 在两次启动之间要把它**原样写回去**
   *    （理由见那里），而"原样"的判据就是**同一串字节** —— 重新拼一遍就成了另一份夹具（§5.44）。
   */
  const migrationBytes = JSON.stringify(migrationSeed, null, 2);
  if (CASE === 'g' || CASE === 'i' || CASE === 'j') {
    /*
     * case g 是**真重启**：不预置任何东西，用 case f 留下的那份 `userData`（`--reuse-user-data`）。
     * ⚠️ 它是判修 1 的第二半：`setCatalogGameVersion` 写下去的那个值，必须在**下一次启动**
     *    之后还在（那时 `startUp` 会再跑一次 `adoptFolderGameVersion()`，而那个文件夹推断出
     *    1.16.1）。少了它，"置位只写在内存里"这种坏法照样绿。
     * ★ case i 是**同一台机器上的第二次真重启**（Task 5 / spec A16 的"一次性迁移"）：
     *    它跑在 case h 留下的那份文件上 —— 那时 D1 的两格**已经在文件里**了，
     *    ⇒ `folders` 这一次**不许**再被清（那正是"每次读盘都清"这个缺陷的形状）。
     */
    if (REUSE_USER_DATA === '') {
      bail(`--phase prefs --case ${CASE} 必须带 --reuse-user-data <目录>`);
    }
    console.log(`  复用 ${CASE === 'i' ? 'case h' : 'case f'} 留下的 userData（真重启）：${currentUserDataDir}`);
    console.log(`  它盘上的 prefs：${JSON.stringify(readStateFileJson()?.prefs ?? null)}`);
    console.log(
      `  它盘上的 folders 键：${JSON.stringify(Object.keys(readStateFileJson()?.folders ?? {})).slice(0, 200)}`,
    );
    console.log(
      `  它盘上有没有 D1 那两格：launchers=${String(Array.isArray(readStateFileJson()?.launchers))} instancePrefs=${String(typeof readStateFileJson()?.instancePrefs === 'object' && readStateFileJson()?.instancePrefs !== null)}`,
    );
  } else if (CASE === 'h') {
    /*
     * ★★ **Task 5 / spec A16：一次性迁移**的起点 —— 一份"**D1 之前**写的 v2 文件"：
     *    `folders` 非空（旧的手工绑定 + 它的扫描读数）、而 D1 那两格**都不在**。
     *    ⚠️ 判据是"这两格**都不在**"（控制器 2026-10-11 裁定）⇒ 这一份夹具必须**真的**没有它们。
     *    ⚠️ 为什么 `folders` 要非空：空了的话"被清掉"与"本来就空"在数据上分不开（§5.38 那一族）。
     *    ⚠️ 里面那个 jar 让"手工绑定那一格"是**活的**（有读数）—— 一份真的旧文件长这样。
     */
    writeFileSync(stateFile(), JSON.stringify(migrationSeed, null, 2), 'utf8');
    console.log('  预置"**D1 之前**"的状态文件：folders 两个键（一个手工绑定 + 一个实例派生）、D1 两格都缺');
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
    /*
     * ⚠️★ 2026-10-11（Task 5）：这个"扫完了"的判据**换成了与夹具形状无关的读数**。
     *    原来写的是 `last.folders.some((f) => f.rows.length > 0)`（"**至少有一个文件夹扫出了行**"）——
     *    那是**旧夹具的产物**：case d / g / h / i 那几份夹具里，A16 的迁移会把 `folders` 清成空
     *    ⇒ 那个条件**永远不可能成立** ⇒ 等待到点（400 × 25ms）⇒ 下游那一串断言全红，
     *    而它们**看起来像 Ruling 37 / 迁移坏了**（实测那 7 条红全是这个形状 ✗ —— §5.79 那一族：
     *    "这条检查没跑成"与"这条检查没过"必须分得开）。
     *    ⇒ 改成"**这一份推送里的文件夹都扫完了**"：`f.hasReading === true || f.rows.length > 0`。
     *      两种夹具都覆盖：
     *        · 有文件夹（case d/e/f）：要求"扫过、有读数"（Ruling 65 那一格；空目录扫过也是 `true`）✓；
     *        · 文件夹被迁移清空（case h/i）：`[].every(...)` 为真 ⇒ 只要求"目录 ok" ✓。
     *      ⚠️ 它**没有变松**：`catalogStatus === 'ok'` 那一半一个字节没改；"有文件夹时必须已有读数"
     *        这一半其实**更强**（旧写法只要求"有一行"）。
     */
    const scanDone = (last?.folders ?? []).every((f) => f.hasReading === true || f.rows.length > 0);
    /*
     * ⚠️★ **case h / i 还要多等一档"静默"**：它们的文件夹被 A16 迁移清空了 ⇒ 上面那个
     *    `every` 对**空数组**恒真 ⇒ 它在**第一趟** `refreshInstances()` 的 rebuild 上就满足了，
     *    而 `startUp` 后面还有 `adoptFolderGameVersion()` + 最后一趟 `rebuild()` —— 实测那样
     *    读到的是 `catalogGameVersion: '1.8.9'`（**采纳还没发生**），于是那两条又红了 ✗。
     *    ⇒ 判据加上"**最近 400ms 没有新的推送**"：`startUp` 的每一趟都会推一帧
     *      （`refreshInstances()` 一次、最后 `rebuild()` 一次），而这一相位**不主动调
     *      `getState`** ⇒ 帧停下来了就是它跑完了。只对 h / i 生效 ⇒ 其余 case 的时序**逐字不变**。
     */
    const quietLongEnough =
      (CASE === 'h' || CASE === 'i') &&
      last !== null &&
      pushes.filter((p) => p.channel === MOD_CH.onStatus).length > 0 &&
      Date.now() - (pushes.filter((p) => p.channel === MOD_CH.onStatus).at(-1)?.at ?? 0) > 400;
    if (last !== null && last.catalogStatus === 'ok' && (scanDone || quietLongEnough)) {
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
  } else if (CASE === 'd' || CASE === 'e' || CASE === 'f') {
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
  // ⚠️ case h / i / j 没有 `f-auto` 那一格（见上面 `HAS_FAUTO_FIXTURE` 的理由）⇒ 跳过这一条。
  if (HAS_FAUTO_FIXTURE) {
    check(
      '（对照）那个文件夹确实推断得出 1.16.1（否则上面几条比的是"推断不出来"）',
      state.folders.find((f) => f.folderId === 'f-auto')?.gameVersion === '1.16.1',
      String(state.folders.find((f) => f.folderId === 'f-auto')?.gameVersion),
    );
  }

  // =========================================================================
  /*
   * ★★ **Task 5（D1）/ spec A16：一次性迁移**（case h，随后 case i 做第二次真重启）。
   *
   * 这一条钉的是 `migrateState()` 的**那一对分寸**（缺一半就会有一条坏法没人喊）：
   *   · "**D1 之前**写的文件"（`launchers` / `instancePrefs` **两格都不在**）
   *     ⇒ `folders` **清空**（spec A16：升级后旧的绑定与读数作废、从空态开始），
   *       而那两格**补上空值**（我们这一版必须写它们，否则浅合并会把磁盘那份捡回来）；
   *   · "**D1 之后**写的文件"（两格都在）
   *     ⇒ `folders` **原样保留**（否则每次读盘都清一次 ⇒ 用户的实例派生绑定永远活不过一次加载）。
   *
   * ⚠️★ 为什么**两次启动**都要有（不是"清掉"一条就够）：
   *    只测"清掉"的话，一个"**每次都清**"的坏实现会**完全通过**（那正是 2026-10-11 实测到的
   *    那个缺陷的形状）⇒ 第二条（幂等）才是把"一次性"三个字钉住的那一半。
   * ⚠️ case i 是**另起一个进程**（不是同一个进程里再跑一次函数）：它模拟的是"用户第二天又开了一次"，
   *    而那一次读的是**盘上**那份字节 —— 只调函数会漏掉"写盘那一侧把两格写丢了"这种坏法。
   */
  /*
   * ★★★ **Task 5（D1）/ spec A16：一次性迁移** —— **三个进程，零"重种夹具"**。
   *
   * 为什么是**三个**（这一版结构是踩出来的，前两版的错法都留在这里，别走回去）：
   *   · 第一版：h 里"启动一次 ⇒ 清空"、然后**把那份 D1 之前的字节写回去**、再 spawn i 断言
   *     "第二次启动不许再清" —— ✗ **写回去这一句根本不可能成立**：h 这个进程自己的
   *     `startUp` 还在跑（`queueLoadCatalog` 是异步的），它的 `persist()` 会落在我的重写**之后**
   *     （实测：重写后回读明明是 `folders=["manual-migration-folder"]`，进 i 却变成 `folders=[]`）。
   *     那是**两个写者抢同一个文件**，不是产品缺陷（§5.27：别在活跃写入窗口里追归因）。
   *   · 第二版：i 直接读**盘上那份（已经被 h 迁移过、folders 已空）** ⇒ 它测的是"在一份 folders
   *     已经空了的 post-D1 文件上再启动一次"，**恰好把要测的东西绕过去了** ✗。
   *   ⇒ 正解：**谁也不重种**。让文件按它自己的生命周期走：
   *       h：种一份"D1 之前"的文件 → 启动 → 断言**迁移发生了**（清空 + 两格补上 + 别的格照旧）；
   *       i：**同一个 userData** 再启动一次 → 断言**这份文件不再被清**（两格在、`folders` 稳定）；
   *       j：**第三次**启动 → 断言那份文件**逐字节没变** ⇒ 这才是"**一次性**"这三个字的落点
   *          （"每次读盘都清"那种坏实现会在 i 那一趟就把 `folders` 清掉，j 的字节比对当场红）。
   */
  if (CASE === 'h') {
    /*
     * ⚠️★ **前提必须读"我自己刚写下去的那份字节"（`migrationBytes`），不是 `readStateFileJson()`**：
     *    后者拿的是**启动之后**那一份（迁移已经跑过、而且已经落盘）⇒ 用它当前提会读到
     *    `folders=[]`、得到一条**必然红**的"（前置）"（第一版就是这么错的 ✗）。
     */
    const asWritten = JSON.parse(migrationBytes);
    const onDisk = readStateFileJson();
    check(
      '（前置）这一趟的起点**真的是"D1 之前"的形状**：folders 非空、而 D1 那两格都不在',
      Object.keys(asWritten?.folders ?? {}).length === 1 &&
        asWritten?.launchers === undefined &&
        asWritten?.instancePrefs === undefined,
      `写入时的形状：folders=${JSON.stringify(Object.keys(asWritten?.folders ?? {}))} launchers=${JSON.stringify(asWritten?.launchers ?? null)} instancePrefs=${JSON.stringify(asWritten?.instancePrefs ?? null)}`,
    );
    check(
      '★★ A16：启动一次之后 `folders` **被清空**（旧的绑定与读数作废，从空态开始）',
      Object.keys(onDisk?.folders ?? {}).length === 0,
      `folders=${JSON.stringify(Object.keys(onDisk?.folders ?? {}))}`,
    );
    check(
      '★ 而 D1 那两格**补上了空值**（`launchers: []` + `instancePrefs: {}`）—— 少了它们，浅合并会把磁盘那份旧值捡回来',
      Array.isArray(onDisk?.launchers) &&
        onDisk.launchers.length === 0 &&
        typeof onDisk?.instancePrefs === 'object' &&
        onDisk.instancePrefs !== null &&
        Object.keys(onDisk.instancePrefs).length === 0,
      `launchers=${JSON.stringify(onDisk?.launchers ?? null)} instancePrefs=${JSON.stringify(onDisk?.instancePrefs ?? null)}`,
    );
    check(
      '★ 而**别的格**没被顺手洗掉：`prefs` 与 `stateVersion` 逐格照旧（迁移只该动它点名的那几格）',
      onDisk?.prefs?.catalogGameVersion === '1.8.9' &&
        onDisk?.prefs?.bulkChannel === 'origin' &&
        onDisk?.stateVersion === 2 &&
        onDisk?.version === 1,
      JSON.stringify({ prefs: onDisk?.prefs ?? null, stateVersion: onDisk?.stateVersion, version: onDisk?.version }),
    );

    /*
     * ---- 第二次启动（case i）：同一份 userData、**不重种任何东西** --------------------
     * ⚠️★ 这一支**不记判据**（照末尾"写相位没跑起来"那一支的先例）：子进程的 2（没跑起来）
     *    与 1（某条不成立）是两件事，把它折成一条 `✗` 会抹掉这个区别（§5.74 那一族）。
     *    它自己的逐条读数由子进程打到 stdout（stdio 继承）。
     */
    const second = spawnSync(
      process.execPath,
      [self, '--phase', 'prefs', '--case', 'i', '--reuse-user-data', currentUserDataDir],
      { stdio: 'inherit', cwd: repoRoot, env: { ...process.env, MCSR_VERIFY_REEXEC: '1' } },
    );
    if (second.status === 2) {
      console.error('\n✗ case i（第二次启动）**没跑起来**（退出码 2）—— 原因见上面那一行');
      console.error('  （退出码 2 = 这条检查没跑成，**不等于**判据通过）');
    } else {
      check(
        '（子进程）case i 的两条判据全成立（第二次启动：那一格不被清）',
        second.status === 0,
        `子进程退出码 ${String(second.status)}`,
      );
    }
  }
  if (CASE === 'i') {
    /*
     * ⚠️★ 这一趟的**起点是 h 的产物**（那份文件已经**被迁移过**：`folders` 空、两格在）——
     *    所以下面的判据**不许**假设盘上还有 `manual-migration-folder`（第二版就是那么错的 ✗）。
     */
    const before = readStateFileJson();
    check(
      '（前置）这一趟的起点是**h 迁移之后**的那份（`folders` 已清、D1 两格已在）',
      Object.keys(before?.folders ?? {}).length === 0 &&
        Array.isArray(before?.launchers) &&
        typeof before?.instancePrefs === 'object' &&
        before?.instancePrefs !== null,
      `folders=${JSON.stringify(Object.keys(before?.folders ?? {}))} launchers=${JSON.stringify(before?.launchers ?? null)}`,
    );
    /*
     * ★★ **"一次性"的落点**：这一趟启动**不许**再动 `folders`。
     *    ⚠️ 为什么"清成空"这种坏法在这里**看得见**：`migrateState` 那个缺陷的表现是
     *    "**每次读盘都清**"，而这一趟读的是一份"两格已在"的文件 —— 它清不出东西来（本来就空）。
     *    ⇒ 所以这一条量的其实是"**没把它写坏**"，而**真正**那一半（"重种一样东西进去、再启动一次，
     *    它还在不在"）由 **case j 的逐字节比对**来量 —— 两处合起来才是完整的"一次性"。
     */
    check(
      '★ 第二次启动之后 `folders` 仍然是空的、且两格仍然在（这一趟没有把它写坏）',
      Object.keys(before?.folders ?? {}).length === 0 &&
        Array.isArray(before?.launchers) &&
        typeof before?.instancePrefs === 'object',
      JSON.stringify({ folders: Object.keys(before?.folders ?? {}), launchers: before?.launchers ?? null }),
    );

    /*
     * ---- 第三次启动（case j）：同一份 userData ⇒ 断言**那份文件逐字节没变** --------------
     * ⚠️★ 这一条才是"**一次性**"最硬的读数：它是**同一个对象的前后两个字节**（§5.44 那一族）。
     *    复现那把刀：把 `migrateState` 的判据改回"一律清"（缺陷那一版）⇒ 这一趟的
     *    `folders` 被清（本来就空 ⇒ 看起来一样），但**只要**夹具里有一条会在启动时
     *    被重新派生/写回的 entry，字节就会变；⇒ 下面同时断言"**两格的内容也逐字节相同**"。
     */
    const bytesBefore = readFileSync(stateFile(), 'utf8');
    const third = spawnSync(
      process.execPath,
      [self, '--phase', 'prefs', '--case', 'j', '--reuse-user-data', currentUserDataDir],
      { stdio: 'inherit', cwd: repoRoot, env: { ...process.env, MCSR_VERIFY_REEXEC: '1' } },
    );
    if (third.status === 2) {
      console.error('\n✗ case j（第三次启动）**没跑起来**（退出码 2）—— 原因见上面那一行');
    } else {
      check(
        '（子进程）case j 的判据全成立（第三次启动：那份文件逐字节没变）',
        third.status === 0,
        `子进程退出码 ${String(third.status)}`,
      );
    }
    const bytesAfter = readFileSync(stateFile(), 'utf8');
    check(
      '★★ A16 的"一次性"：第三次启动把**同一个文件**读写一遍之后，它的**字节逐字不变**（sha256 前后一致就是"没动过"的硬读数）',
      bytesAfter === bytesBefore,
      bytesAfter === bytesBefore
        ? `sha256 前 16 位 ${sha256Of(stateFile()).slice(0, 16)}（两份一致）`
        : `变了：${String(bytesBefore.length)}B → ${String(bytesAfter.length)}B`,
    );
  }
  if (CASE === 'j') {
    /*
     * ⚠️★ case j **只做一件事**：把这一趟结束时的字节留给 **case i** 去比对（它 spawn 完我之后
     *    立刻读）。所以这里除了"我确实跑起来了"之外**不记判据** —— 判据住在 i 那一侧，
     *    因为只有那里同时握着**前**与**后**两份字节（§5.44：比字节要在**同一个观察者**里比）。
     */
    const onDisk = readStateFileJson();
    console.log(
      `  （case j 读数，供 case i 比对）folders=${JSON.stringify(Object.keys(onDisk?.folders ?? {}))} launchers=${JSON.stringify(onDisk?.launchers ?? null)} instancePrefs=${JSON.stringify(onDisk?.instancePrefs ?? null)} prefs.catalogGameVersion=${String(onDisk?.prefs?.catalogGameVersion)}`,
    );
    check(
      '（case j）这一趟真的把状态文件读出来了（否则 i 那侧的字节比对没有意义）',
      onDisk !== null,
      stateFile(),
    );
  }

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
  /** ★★ T9：整夹更新里"一项成 / 一项跳 / 一项失败"那三条（㊱ 用）。 */
  const t9 = fx.t9;
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
  if (!registered) bail('十四条 invoke 通道没注册上（写路径的判据全都要走 invoke）');

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
  /**
   * ★★ (C/S4) 取消那一组用的**那一条镜像**的前缀 —— **现算**，不是手抄 `/mirror-slow/`。
   *
   * ⚠️★ brief 里那两行写的是 `reqsOf('/mirror-slow/')`，而 `fx.slow` / `fx.other` 走的是
   *    `probe-c2slow`（前缀 `/mirror-c2slow/`，见 `hijackSlowGroup` 头顶那一段）⇒
   *    **逐字照抄**那一版跑出来的读数是 `请求数 1 → 1`（那一趟真的发了请求，只是发在
   *    另一个前缀上）⇒ 判据**永远红**，而红的原因与产品无关（§5.79：红点会长得像产品缺陷）。
   *    ⇒ 分母从 `fx.slow.mirrorId` 现算（`hijack` 的命名规则就是 `probe-<suffix>` ⇒
   *    `<suffix>` 就是路径那一段）：镜像 id 一改，这一条跟着走。
   */
  const c2Reqs = () => reqsOf(`/mirror-${fx.slow.mirrorId.replace('probe-', '')}/`);
  /**
   * 把夹具字节落到某个目录里（`probeJar()` 返回的是**字节**，而 `copyFileSync` 的 src 要
   * **路径** ⇒ 只能是 `writeFileSync(join(dir, name), bytes)`）。
   *
   * ⚠️★ 落的是 `fixture.local`，**不是** `fixture.official`（brief 那一行写的是后者）：
   *    `official` 正是桩要回的那一份，而 `release.sha512 = sha512OfBuffer(official)`
   *    ⇒ 把它按目标名写进目录 = "这个文件已经是这一份" ⇒ `judgeRelease` 判 `same`、
   *    `installRelease` 走**幂等**那一支（`alreadyCurrent`）⇒ **一个请求都不会发**，
   *    "慢下载中途读到字节"这条判据永远量不到东西（§5.32 ①：夹具一空，判据就恒真）。
   *    `local` 是同 modid、内部版本更低、字节不同的那一份 ⇒ 判成 `older` ⇒ 真下载。
   */
  const placeJar = (dir, fixture) => {
    writeFileSync(join(dir, fixture.targetName), fixture.local);
  };
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
  /**
   * ★★ 一个**确定**的等待：轮询 `pred()` 直到成立（或到上限）；返回值就是最后一次的判定。
   *
   * ⚠️★ 为什么需要它（B2/T5 实测，2026-10-07）：C 时代那几节写的是"`sleep 80` 之后取消"，
   *    而机器一忙（同一台机器上并行跑别的门禁时）那个 80 ms 会**猜空** ⇒ 读数长成
   *    `请求数 19 → 19`（看起来像"取消失效"）或 `received: 0`（看起来像"进度不是字节级的"）
   *    —— 两条都**长得像产品缺陷**（§5.79）。而桩的行为让这件事可以做成确定的：
   *    `chunkDelayMs = 400` ⇒ 请求**一到达** `downloadLog` 就涨，而响应体还要 400 ms 才收尾
   *    ⇒ "计数一涨就动作"必然落在"下载中途"。
   * ⚠️ 上限只防"这件事根本没发生"：到点仍不成立时**判据照旧红**（并说清是哪一种），
   *    这个助手**不吞**任何失败、也不改任何判据的语义。
   */
  const waitUntil = async (pred, timeoutMs = 5_000) => {
    const deadline = Date.now() + timeoutMs;
    while (!pred() && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    return pred();
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
    /*
     * ★★★ T9 修复轮（C1 的另一半）：**空转那一趟的计数必须停在 0**。
     *    ⚠️★ 这一条钉的是 `writeRun` 里那个 `skipped === null` 判断的**反面**：
     *    把 `if (skipped === null)` 改成"无条件 `noteUpdated()`"（或者把幂等那一支也放行），
     *    这一条当场红 —— 而**正向那一趟**（⑯b）看不出来（两趟都是 1 的话它照样绿）。
     *    ⚠️ 也就是"**跳过不算**"在单行这条路上第一次有了直接判据
     *    （独立评审的 C1：这一处在此之前**一条判据都没有**）。
     */
    const { value: secondRun, frames: secondFrames } = await captureFramesOf(
      MOD_CH.onProgress,
      () =>
        invoke(MOD_CH.updateMod, id, fx.good.modid, key, { mirrorId: fx.good.mirrorId }).catch(
          (error) => error,
        ),
    );
    const second = secondRun;
    const secondCounts = secondFrames
      .map((frame) => frame.updatedCount)
      .filter((value) => typeof value === 'number');
    check(
      '★★★ T9（A20）**空转那一趟**（幂等：一个字节都没写）⇒ 帧里的 `updatedCount` **一次都不许是 1**' +
        '（把 `writeRun` 里那个 `skipped === null` 判断放宽 ⇒ 这一条红 —— 正向那一趟看不出来）',
      secondFrames.length >= 1 && secondCounts.length >= 1 && secondCounts.every((value) => value === 0),
      `帧数 ${String(secondFrames.length)}；updatedCount 序列 ${JSON.stringify(secondCounts)}`,
    );
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
    /*
     * ★★★ T9 修复轮（C1）：**单行这条路（`writeRun`，`updateMod` 与 `downloadMissing` 共用）
     *    的计数落点，在这一轮之前一条判据都没有** —— 独立评审把 `mod-folders.ts` 那句
     *    `if (skipped === null) noteUpdated();` **整行删掉**，重建之后探针**全绿**
     *    （`EXIT=0`、`✗` 0 条）⇒ A20 的"只数成功的"在这两个入口上**没有任何人守**。
     *
     * ⚠️★ 这一趟必须**真的装成**（本组的"（前置）"那条钉着"目标就位 + 请求 +1"）。
     * ⚠️ 判据的形状是"**首值 0 / 至少一帧 1 / 最大值恰好 1**"，**不是**"恰好一帧"：
     *    字节帧的条数由节流决定（那是时序、不是产品语义）⇒ 写死帧数会在**正确**的实现上报红
     *    （§5.32 ③ / §M3 同族）。`max === 1` 那半边能红在"每项加一"那类坏实现上。
     */
    const { value: run1, frames: lineFrames } = await captureFramesOf(MOD_CH.onProgress, () =>
      invoke(MOD_CH.updateMod, id, fx.good.modid, `${fx.good.modid}|1.16.1`, {
        mirrorId: fx.good.mirrorId,
      }).catch((error) => error),
    );
    state = run1;
    console.log(
      `  ${basename(dir)}：${listing(dir)}；单行那趟的帧 ${JSON.stringify(
        lineFrames.map((frame) => ({ phase: frame.phase, updated: frame.updatedCount })),
      )}`,
    );
    const lineCounts = lineFrames
      .map((frame) => frame.updatedCount)
      .filter((value) => typeof value === 'number');
    check(
      '★★★ T9（A20）单行那趟（`writeRun` 那条路）：`updatedCount` **从 0 起、至少一帧到 1、最大值恰好 1**' +
        '（删掉 `mod-folders.ts` 里 `if (skipped === null) noteUpdated();` 这一行 ⇒ 这一条红）',
      lineCounts.length >= 1 &&
        lineCounts[0] === 0 &&
        lineCounts.includes(1) &&
        Math.max(...lineCounts) === 1,
      `帧的 updatedCount 序列 ${JSON.stringify(lineCounts)}`,
    );
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
   *   （"闸真的会红"那把刀的现场读数见本分支的逐任务评审包：去掉拒绝 ⇒ 这一整段红。）
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

  // =========================================================================
  // ㉖（子项目 C / S2）字节级进度：**慢桩** + 中途读状态
  // =========================================================================
  /*
   * ⚠️★ 编号与位置（与 brief 的示例不一致，本分支的逐任务评审包里写明了）：brief 说"紧接在 ⑫ 那一组之后加
   *    一组"，并按 ⑬ 举了例。本树里 ⑬ 已经被"路径穿越被拒"占用，⑬–㉕ 也都在用 ⇒
   *    按 brief 自己那条procedure（"看下一个空号"）取到的下一个空号是 **㉖**。
   *    而㉖ 接在 ㉕ 之后，编号才继续跟着**执行顺序**走（这是本文件自己的风格）。
   * ⚠️★ 慢桩为什么要单独一条镜像：见 `hijackSlowGroup` 头顶那一段（⑮ 有一条**绝对**计数）。
   * ★ 为什么必须是"慢桩"（`chunkDelayMs`）：`installRelease` 的进度读数只在**下载中途**
   *   非空，一次瞬间完成的下载什么都测不到（夹具一快，这条判据就变成恒真 —— §5.32 ①）。
   *   桩的行为（`downloads` 里那条 `chunkDelayMs`）在写相位之外是空的 ⇒ 主相位一个字都不变。
   */
  await section('㉖（C/S2）慢下载中途：进度在状态里、字节单调', async () => {
    const dirProgress = join(workRoot, 'progress');
    mkdirSync(dirProgress, { recursive: true });
    placeJar(dirProgress, fx.slow);
    const id = await prepare(dirProgress);
    const halfBytes = Math.ceil(fx.slow.official.length / 2);
    /*
     * ★ "字节单调"这一条**必须有仪器**：它只写在标题里的话就是一句没人验的话
     *   （§5.32 ③：读数看着有、其实什么都没测）⇒ 整趟下载期间按 20ms 轮询状态，
     *   把每一次非空的 `received` 记下来，最后判它不回退。**不订阅推送**（那是 T3 的事）。
     */
    const samples = [];
    const poll = setInterval(() => {
      void invoke(MOD_CH.getState).then((state) => {
        if (state.progress) samples.push(state.progress.received);
      });
    }, 20);
    const run = invoke(MOD_CH.updateMod, id, fx.slow.modid, `${fx.slow.modid}|1.16.1`, {
      mirrorId: fx.slow.mirrorId,
    });
    /*
     * ★★ 读"下载中途"那一帧**不靠固定 60 ms 猜**（现场：并行跑别的门禁时第一块约 140 ms
     *    才到，于是这一读拿到 `received: 0` ⇒ 这条红在一处**与产品无关**的时序上，而同一节的
     *    "字节单调"读数里明明写着 `[0,…,0,83,…,166]`）⇒ 改成**等到第一块真的到了**再读。
     *    ⚠️ 判据一个字都没放松：仍然要求 `0 < received < total`，而桩在首块之后还压着
     *    400 ms（`chunkDelayMs`）⇒ 这一读必然落在"下载中途"（一个"只在收尾推一帧"的实现
     *    会给 `received === total` ⇒ 这一条照旧红）。上限只防"这一趟根本没在下"。
     */
    let mid = await invoke(MOD_CH.getState);
    const untilFirstBytes = Date.now() + 5_000;
    while (!(mid.progress && mid.progress.received > 0) && Date.now() < untilFirstBytes) {
      await new Promise((r) => setTimeout(r, 10));
      mid = await invoke(MOD_CH.getState);
    }
    check('★ 下载中途 busy 是 true', mid.busy === true, String(mid.busy));
    check(
      '★★ 进度在**状态**里（不是只在推送里）：folderId / modid / 文件名叫得出来',
      mid.progress?.folderId === id &&
        mid.progress?.modid === fx.slow.modid &&
        mid.progress?.fileName === fx.slow.targetName,
      JSON.stringify(mid.progress),
    );
    check(
      '★★ 字节是**字节级**的、而且这一读**确实发生在下载中途**（收到的量 > 0 且 < 总长）',
      typeof mid.progress?.received === 'number' &&
        mid.progress.received > 0 &&
        mid.progress.received < fx.slow.official.length &&
        mid.progress.total === fx.slow.official.length,
      JSON.stringify({ received: mid.progress?.received, total: mid.progress?.total, half: halfBytes }),
    );
    check('★ 相位是 download、项序 1/1', mid.progress?.phase === 'download' && mid.progress.itemIndex === 1 && mid.progress.itemCount === 1, JSON.stringify(mid.progress));
    const after = await run;
    clearInterval(poll);
    check(
      '★ 字节单调：整趟下载期间收到的量**一次都没有回过退**（至少两个读数）',
      samples.length >= 2 &&
        samples.every((value, index) => index === 0 || value >= samples[index - 1]),
      JSON.stringify(samples),
    );
    check(
      '★★ 收尾之后**清干净**（界面不会永远停在最后一帧 —— spec §3 那句"必须有一条结束的读数"）',
      after.progress === null && after.busy === false,
      JSON.stringify({ progress: after.progress, busy: after.busy }),
    );
    check('★ 这一趟真的装好了（不然上面那些读数可能来自一次失败的下载）', existsSync(join(dirProgress, fx.slow.targetName)), listing(dirProgress));
  });

  /*
   * =========================================================================
   * ㉖b（子项目 C / S3）整夹更新：项序
   * =========================================================================
   * ⚠️★ 第三行（`newer` 那份 jar）是**为了这条判据才放的**：`itemCount` 的判据是
   *    "= 可批量的行数，**而不是**文件夹里的行数" ⇒ 文件夹里**必须有不批量的行**，
   *    否则"夹具里有一行不可批量"这件事在"3 行全可批量"与"只数可批量的"两种实现下
   *    都无所谓（§5.32 ①）。⚠️ 那个数**不写在这里**：它就是下面那条仪器自检现测的
   *    `batchRows`（同一个数只留一处活读数）。
   */
  await section('㉖b（C/S3）整夹更新：itemIndex 从 1 递增、itemCount 等于这一趟的目标数', async () => {
    const dirBatch = join(workRoot, 'progress-batch');
    mkdirSync(dirBatch, { recursive: true });
    // 两个可批量的行（夹具里那两份 jar 比目录里的旧 ⇒ `older` ⇒ batchable）
    placeJar(dirBatch, fx.slow);
    placeJar(dirBatch, fx.other);
    // 第三个**不可批量**的行（本地 99.0.0 > 目录那一条 ⇒ `newer` ⇒ 不进批量、也不发请求）
    writeFileSync(join(dirBatch, 'newer-99.jar'), probeJar(fx.newer.modid, '99.0.0', true));
    const id = await prepare(dirBatch);
    /*
     * ⚠️★ 仪器自检：这一夹**必须恰好有 2 行可批量**。少一行的话下面那两条判据量的就是
     *    夹具缺陷（§5.79：红点会长得像产品缺陷）⇒ 夹具前提不成立时按退出码 2 结束。
     */
    const batchRows = (await invoke(MOD_CH.getState)).folders
      .find((folder) => folder.folderId === id)
      ?.rows.filter((row) => row.batchable).length;
    if (batchRows !== 2) {
      bail(`夹具前提不成立：这一夹可批量的行是 ${String(batchRows)} 个（这一组判据要 2 个）`);
    }
    const seen = [];
    // ⚠️ 不在这一相位订阅推送（那是 T3 的事）：这里靠**轮询状态**取项序
    const poll = setInterval(() => {
      void invoke(MOD_CH.getState).then((state) => {
        if (state.progress) seen.push({ item: state.progress.itemIndex, count: state.progress.itemCount, run: state.progress.run });
      });
    }, 25);
    const after = await invoke(MOD_CH.updateFolderAll, id, { mirrorId: fx.slow.mirrorId });
    clearInterval(poll);
    const indexes = [...new Set(seen.map((s) => s.item))].sort((a, b) => a - b);
    /*
     * ⚠️★ 判据**必须钉住尽头**（`max`），不能只判"第一项是 1"：把 `setRunItem` 的
     *   `itemIndex += 1` 砍成 `= 1` 之后，读数是 `[1]` —— 第一项仍然是 1，只判 `indexes[0]`
     *   的话那一刀照旧绿（"项序真的递增到最后一项"这件事一个字节都没被量到）。
     * ★ 两个半边各管一件事：`indexes[0] === 1` 管**"从 1 起、读数里不出现 0"**；
     *   `Math.max(...indexes) === batchRows` 管**"真的走到了最后一项"**。
     * ★ `batchRows` 是**同一夹现测**出来的（上面那条仪器自检把它钉在这一夹的目标数上），
     *   不是写死的字面量 —— 与下面 `itemCount` 那条判据量的是同一个数。
     * ⚠️★ 说清这条判据**量不到**什么（别把它写强）：在这一夹（`batchRows === 2`）里，两个半边
     *   合起来**恰好等价于**"集合就是 `[1,2]`" ⇒ 某一项整个窗口被 25ms 的轮询漏掉时读数是 `[2]`
     *   （正确实现），这条判据**仍然会红**。这一夹每项 ≥400ms 的慢桩让那种漏读在实践中几乎不会
     *   发生，但**不许**因此写成"`max` 把那个假红窗口消掉了"—— 它没有消掉，只是窗口极小。
     */
    check(
      '★ 项序从 1 起、并且真的递增到最后一项（`max` = 目标数）',
      indexes[0] === 1 && Math.max(...indexes) === batchRows,
      JSON.stringify(indexes),
    );
    check(
      '★★ `itemCount` 等于这一趟的目标数（= 可批量的行数），而不是文件夹里的行数',
      seen.length > 0 && seen.every((s) => s.count === batchRows),
      JSON.stringify(seen.slice(0, 6)),
    );
    /*
     * ★★ B2 / T5 补的一条（brief 的 Step 8 那把刀①假设**已经**有一条这样的判据，
     *    而现读整份探针**没有**：`grep 'update-folder-all'` 在本次改动之前只命中契约表那一行
     *    —— 于是"`bulkRun` 的 `run` 默认值"这半句**一把刀都拔不动**）。
     *    `bulkRun` 现在有 `run?: …` 入参、默认 `'update-folder-all'`，而**既有两个调用方
     *    一个字都不许改** ⇒ 整夹更新这一趟的进度帧必须仍然报 `'update-folder-all'`。
     *    坏了会怎么红：把默认值改成 `'download-pack'`（或把 `beginRun` 那一行写死成别的），
     *    这一条当场红 —— 而页面那句汇总行会把整夹更新念成"整合包下载"。
     */
    const runs = [...new Set(seen.map((s) => s.run))];
    check(
      '★★ 整夹更新的进度帧报的仍是 `update-folder-all`（`bulkRun` 的 `run` 默认值那半句：既有调用方一个都不许变）',
      runs.length === 1 && runs[0] === 'update-folder-all',
      JSON.stringify(runs),
    );
    check('★ 收尾之后 progress 是 null', after.progress === null, JSON.stringify(after.progress));
  });

  /*
   * =========================================================================
   * ㉗（子项目 C / S3）onProgress 推送：帧真的到了、而且被**节流**过
   * =========================================================================
   * ⚠️★ 编号（与 brief 不一致，本分支的逐任务评审包里写明了）：brief 举例写的是 **⑭**，而本树里
   *    ⑭ 已被"目标被占住"那一组占用（现读全部 `await section(` 的编号：① ② ③ ⑤ ⑤b ⑥
   *    ⑧ ⑨ ⑩ ⑫ ⑬ ⑭ ⑮ ⑯ ⑯b ⑱ ⑲ ⑳ ㉑ ㉒ ㉓ ㉔ ㉕ ㉖ ㉖b）⇒ 按本文件自己的风格
   *    （编号跟着**执行顺序**走）取续号 **㉗**，接在 ㉖b 之后。
   * ⚠️★ 夹具这一行**没有**照 brief 逐字（`copyFileSync(fx.slow.official, …)`）：那一版真的
   *    跑过一次，读数是"下载请求 **0**"（现场读数见本分支的逐任务评审包）—— `official` 就是桩要回的那一份、
   *    它的 sha512 正是 `release.sha512` ⇒ 走 `installRelease` 的**幂等**那一支
   *    （`placeJar` 头顶那一段：:2506-2519 写着同一条）。那一版里"帧数 0"与"通道还没加"
   *    长得一模一样（§5.79：红点会长得像产品缺陷）⇒ 换成 `placeJar`（= `fixture.local`，
   *    判成 `older` ⇒ 真的走下载）。
   */
  await section('㉗（C/S3）onProgress 推送：帧真的到了、且被**节流**过', async () => {
    const dirPush = join(workRoot, 'progress-push');
    mkdirSync(dirPush, { recursive: true });
    placeJar(dirPush, fx.slow);
    const id = await prepare(dirPush);
    const before = pushes.length;
    const beforeReqs = downloadLog.length;
    await invoke(MOD_CH.updateMod, id, fx.slow.modid, `${fx.slow.modid}|1.16.1`, {
      mirrorId: fx.slow.mirrorId,
    });
    console.log(
      `  夹具自检：桩上收到的下载请求 ${String(beforeReqs)} → ${String(downloadLog.length)}（0 = 走了幂等那一支，这一组什么都量不到）`,
    );
    const frames = pushes
      .slice(before)
      .filter((entry) => entry.channel === MOD_CH.onProgress)
      .map((entry) => entry.payload);
    check('★★ 收到进度帧（通道名逐字来自共享常量）', frames.length >= 2, `帧数 ${String(frames.length)}`);
    check(
      '★ 帧的字节单调不减，且最后一帧 `received === total`',
      frames.every((f, i) => i === 0 || f.received >= frames[i - 1].received) &&
        frames[frames.length - 1]?.received === fx.slow.official.length,
      JSON.stringify(frames.map((f) => f.received)),
    );
    check(
      '★ 帧里的身份对得上（folderId / modid / fileName）',
      /* ⚠️★ 最终修复波：`frames.length >= 2` 不可省 —— `[].every(...)` **恒真**（§5.32 ①），
         而这一条正是"看着像在测"的那一类（同组上面那条 `收到进度帧` 已经有同一个下限）。
         加上它之后，"一帧都没收到"就落在这一条上，而不是静默地绿。 */
      frames.length >= 2 &&
        frames.every((f) => f.folderId === id && f.modid === fx.slow.modid && f.fileName === fx.slow.targetName),
      JSON.stringify(frames[0]),
    );
    /*
     * ★★ 节流本身：桩把那 400 ms 切成两块（先一半、停一下、再一半），
     *    所以"没节流"的实现会收到**每个 chunk 一帧**（本机 st 上可能只有两帧，
     *    所以这条判据的**分母**要现读：用 `downloadLog` 那一趟的 `chunk` 数拿不到 ⇒
     *    改成"帧数 ≤ 一个按 100 ms 上限算出来的数"）。⚠️ 探针里若拿不到块数，
     *    改用下面这条**恒定成立**的判据：帧数 ≥ 2 **且** 相邻两帧的时间差 ≥ 100 ms。
     *
     * =====================================================================
     * ⚠️★ 上面那一段（brief 原文）里"**恒定成立**"是**错的** —— 实测读数摆在这里
     *    （T3 照 brief 逐字跑了一次，实现已经是对的）：
     *      `✗ ★★ 相邻两帧之间至少 100 ms —— [443,1]`、`帧数 3`、`字节 [0,166,166]`
     *    第三帧是 **`notePhase('install')` 那一帧**，而它按 brief 自己的 Step 5 是
     *    `pushProgress(true)`（D3 的 `force`："换项与换相位**必须**立刻让页面看到"）
     *    ⇒ 它**必然**紧跟在最后一帧下载帧后面（实测 1 ms）⇒ 那一帧进了 `gaps` 之后，
     *    这一条在**正确实现**上永远是红的。
     *    ⇒ 修法（最小改动，判据的**意图一字不改**：量的仍然是"D3 的 100 ms 下限真的是下限"）：
     *    **只把 `download` 相位的那几帧拿来比间隔** —— 受节流管辖的正是它们；
     *    `force` 帧（换项/换相位）按设计**不受**这个下限约束，把它们算进来等于要求
     *    "force 不许 force"。⚠️ 替代措辞见本分支的逐任务评审包。
     *    ⚠️★ 另外补了 `gaps.length >= 1`：`[].every(...)` **恒真**（§5.32 ①）——
     *    一个"只推 force 帧、一个字节帧都不推"的实现会得到 `gaps = []` 而**绿着**，
     *    而那正是这一条要抓的东西。这一处是**收紧**（只能让绿的变红，不会让红的变绿）。
     */
    const downloadStamps = pushes
      .slice(before)
      .filter(
        (entry) => entry.channel === MOD_CH.onProgress && entry.payload.phase === 'download',
      )
      .map((entry) => entry.at);
    const gaps = downloadStamps.slice(1).map((at, i) => at - downloadStamps[i]);
    check(
      '★★ 相邻两帧之间**至少** 100 ms（D3 的下限真的是下限）',
      gaps.length >= 1 && gaps.every((gap) => gap >= 100),
      JSON.stringify({ gaps, phases: frames.map((f) => f.phase) }),
    );
  });

  /*
   * =========================================================================
   * ㉘（子项目 C / S4）取消：契约的第十六条通道
   * =========================================================================
   * ⚠️★ 编号（brief 读法①）：brief 写的是 ⑮ / ⑮b / ⑮c，而 ⑮ 在本文件里**早就被占用**
   *    （"入口守卫"那一组），T2/T3 已经用掉 ㉖ / ㉖b / ㉗ ⇒ 按"下一个空号"取
   *    **㉘ / ㉘b / ㉘c**（(d) 那一小段取 ㉘d）。现读全部 `await section(` 的编号确认过没有重号。
   * ⚠️★ 夹具的字节（brief 读法②）：`probeJar()` 返回**字节**而 `copyFileSync` 的 src 要
   *    **路径** ⇒ brief 那几行 `copyFileSync(fx.X.official, join(dir, fx.X.targetName))`
   *    一律落成 `writeFileSync(join(dir, fx.X.targetName), fx.X.official)`。
   * ⚠️★★ 而"落 `fixture.official`"这件事在这两条夹具上**量不到任何东西**（实测读数见下）：
   *    `official` 正是桩要回的那一份，它的 sha512 就是 `release.sha512` ⇒ `installRelease`
   *    走**幂等**那一支（`[mod-folders] 目标已经是这一份（一个请求都不发）`）⇒ 那一趟
   *    几十毫秒内就收尾了，80 ms 之后点取消读到的是 `{"ok":false,"reason":"没有在跑"}`。
   *    这与 ㉗ 撞到的是**同一条**（:2506 那段写着全文）⇒ 三组的夹具都改回 `placeJar`
   *    （= `fixture.local`：同 modid、内部版本更低 ⇒ 判成 `older` ⇒ 真的走下载）。
   *    ⚠️ 逐字照抄那一版的**完整**读数见本分支的逐任务评审包（`297 ✓ / 10 ✗`）—— 它不在这个文件里
   *    （那是"改成 `placeJar` 之前"的一次现场），这里只留指针。
   */
  await section('㉘（C/S4）下载中途取消：请求被中断、没有 .part、`cancelled` 有它而 `failed` 没有', async () => {
    const dirCancel = join(workRoot, 'cancel');
    mkdirSync(dirCancel, { recursive: true });
    placeJar(dirCancel, fx.slow);
    const id = await prepare(dirCancel);
    const beforeReqs = c2Reqs();
    const beforeListing = listing(dirCancel);
    const run = invoke(MOD_CH.updateMod, id, fx.slow.modid, `${fx.slow.modid}|1.16.1`, {
      mirrorId: fx.slow.mirrorId,
    });
    /*
     * ★★ 等到桩上**真的**记下这个请求再取消（`waitUntil` 头顶那段写着为什么不用
     *    `sleep 80`：负载一高它就猜空，读数长成 `请求数 19 → 19`，看起来像"取消失效"）。
     */
    await waitUntil(() => c2Reqs() === beforeReqs + 1);
    /*
     * ★★ 夹具自钉（㉘b 有 `batchRows === 2` 的 `bail`、㉘c 有"那一帧必须出现过"，
     *    ㉘ 原先只有 `chunkDelayMs 400` vs `sleep 80` 这个**没被断言**的时序前提）：
     *    取消**之前**必须先量到"真的有一个请求在飞"，否则下面那些读数可能来自
     *    "这一趟早就收尾了"（那时点取消读到的是"没有在跑"，而几条判据照样能绿）。
     */
    check('★★ 取消那一刻真的有一个请求在飞（夹具自钉：不然这一节什么都没测）', c2Reqs() === beforeReqs + 1, `请求数 ${String(beforeReqs)} → ${String(c2Reqs())}`);
    /*
     * =====================================================================
     * ★★ I1 的那把锁（**收口时补**，2026-10-06）：取消**受理**那一刻，
     *    `cancelling: true` 那一帧必须上**高频**通道（`onProgress`）。
     * =====================================================================
     * ⚠️★ 为什么需要它：I1 那条修复（`cancelDownload` 里补的 `pushProgress(true)`）原先
     *    **没有任何门禁** —— 删掉那一行，`cancelling: true` 到不了页面
     *    （`progressOf` 是"推送优先于状态"，那一刻 `live` 里还是取消**之前**那一帧），
     *    按钮永远不变「正在取消…」，而**同节已有的判据一条都不会红** ⇒ 静默退回原 bug。
     *
     * ★★ 为什么这条是**确定**的（不是"大概能抓到"）：
     *   ① `cancelling = true` 全模块**只有一处赋值**（`mod-folders.ts` 的 `cancelDownload`：
     *      `activeRun.cancelling = true`）⇒ 带 `cancelling:true` 的帧只可能来自这一次取消；
     *   ② 那一帧**只能**由 `pushProgress(true)` 发出：`refreshProgress()` 造出它之后，
     *      `rebuild()` 走的是 `onStatus`（被下面这个 channel 过滤掉），而 `pushProgress`
     *      才走 `MOD_CH.onProgress`；
     *   ③ 那个 `pushProgress(true)` 在 handler **返回之前同步**发生（`abort()` 之前，全同步）
     *      ⇒ `await invoke(...)` 返回时，这一帧**一定**已经在 `pushes` 里了；
     *   ④ "取消真的被受理了"这个前提已经被同节两条判据钉住（上面那条"有一个请求在飞" +
     *      下面那条 `{ok:true}`）⇒ 不会出现"取消根本没被受理、所以本来就没有这一帧"的假红。
     *    ⚠️ 快照取在 `invoke` **之前**、断言在它**之后**：slice 里因此只含取消那一刻之后的帧。
     */
    const beforeCancel = pushes.length;
    const cancelRes = await invoke(MOD_CH.cancelDownload);
    check(
      '★★ 取消受理那一刻有一帧 `cancelling:true` 上了**高频**通道（I1：删掉 `cancelDownload` 里那句 `pushProgress(true)` 就红）',
      pushes.slice(beforeCancel).some((entry) => entry.channel === MOD_CH.onProgress && entry.payload?.cancelling === true),
      JSON.stringify(pushes.slice(beforeCancel).map((entry) => ({ ch: entry.channel, cancelling: entry.payload?.cancelling, phase: entry.payload?.phase }))),
    );
    check('★ 取消被受理（`{ok:true}`）', cancelRes?.ok === true, JSON.stringify(cancelRes));
    const state = await run; // ★ 取消**不** reject：它不是失败（D4）
    check(
      '★★ `lastRun.cancelled` 记着这一条',
      state.lastRun?.cancelled?.some((entry) => entry.modid === fx.slow.modid) === true,
      JSON.stringify(state.lastRun),
    );
    check(
      '★★ 而且**没有**被记成失败（"取消"与"失败"是两句话）',
      (state.lastRun?.failed ?? []).length === 0,
      JSON.stringify(state.lastRun),
    );
    check('★ 目标目录里没有 `.part` 残留（Ruling 30：删 `.part` 是调用方的活）', noPartsOrOlds(dirCancel), listing(dirCancel));
    check('★ 目标文件没有被写坏（那一趟什么都没落盘）', !existsSync(join(dirCancel, fx.slow.targetName)) || listing(dirCancel) === beforeListing, listing(dirCancel));
    check('★ busy 回到 false（按钮要能再点）', state.busy === false, String(state.busy));
    check('★ 收尾之后 progress 是 null', state.progress === null, JSON.stringify(state.progress));
    check('★ 取消之后**没有**再多发请求（这一趟真的停了）', c2Reqs() === beforeReqs + 1, `请求数 ${String(beforeReqs)} → ${String(c2Reqs())}（前缀 /mirror-${fx.slow.mirrorId.replace('probe-', '')}/）`);
  });

  /*
   * ⚠️★ 最终修复波：这一节的小节标题原先写"后续项**一个都没开工**"，而它下面那条量的是
   *    "第二项没有**发出请求**" —— 两件事**不是**同一件（评审 Important 1 那一段写着现场：
   *    第二项的 `fetch` 建在已 abort 的 signal 上时"瞬间失败、一个请求都不发"，计数照样绿）。
   *    ⇒ 标题改准成"第二项没有发出请求"；"没开工"由 ㉙ 的**四个桶全空**量。
   */
  await section('㉘b（C/S4）整夹更新中途取消：当前项记进 `cancelled`、第二项没有发出请求', async () => {
    /* 同 ㉖b 的夹具（两行可批量），慢桩 */
    const dirBatchCancel = join(workRoot, 'cancel-batch');
    mkdirSync(dirBatchCancel, { recursive: true });
    placeJar(dirBatchCancel, fx.slow);
    placeJar(dirBatchCancel, fx.other);
    const id = await prepare(dirBatchCancel);
    /*
     * ⚠️★ 仪器自检（照 ㉖b 那一句）：这一夹**必须恰好有 2 行可批量** —— 少一行的话
     *    "第二项没有发出请求"量的就是夹具缺陷（§5.79：红点会长得像产品缺陷）。
     */
    const batchRows = (await invoke(MOD_CH.getState)).folders
      .find((folder) => folder.folderId === id)
      ?.rows.filter((row) => row.batchable).length;
    if (batchRows !== 2) {
      bail(`夹具前提不成立：这一夹可批量的行是 ${String(batchRows)} 个（这一组判据要 2 个）`);
    }
    const beforeReqs = c2Reqs();
    const run = invoke(MOD_CH.updateFolderAll, id, { mirrorId: fx.slow.mirrorId });
    /* ★★ 同 ㉘：等到第一项**真的**在飞再取消（`waitUntil` 头顶那段写着为什么不用 `sleep 80`）。 */
    await waitUntil(() => c2Reqs() === beforeReqs + 1);
    await invoke(MOD_CH.cancelDownload);
    const state = await run;
    check('★★ 第二项没有**发出**请求（请求数只涨 1）', c2Reqs() === beforeReqs + 1, `请求数 ${String(beforeReqs)} → ${String(c2Reqs())}`);
    check('★★ `cancelled` 里是**第一项**', state.lastRun?.cancelled?.[0]?.modid === fx.slow.modid, JSON.stringify(state.lastRun));
    check('★ `failed` 是空的（取消不是失败）', (state.lastRun?.failed ?? []).length === 0, JSON.stringify(state.lastRun));
    check('★ busy 回到 false、progress 清空', state.busy === false && state.progress === null, JSON.stringify({ busy: state.busy, progress: state.progress }));
  });

  /*
   * ★★ (c) 的仪器：`phase:'install'` 那一帧是主进程**同步**在两次 rename 之前推出来的
   *    ⇒ 桩在这一刻调 `cancelDownload`，那一刻就**真的**在写盘窗口里（不是"大概在附近"，
   *    不需要 sleep 猜时机）。`pushes.push` 照旧（㉗ 那一组读的就是它）。
   */
  let installCancelResult = null;
  onPageSend = (channel, payload) => {
    pushes.push({ channel, payload, at: Date.now() });
    /* ★ T9 修复轮：这条仪器也照记（与默认实现同一份形状 —— `captureFramesOf` 才看得见
       ㉘c 之后推出来的帧；今天没有调用者，但两处各自记一半是最容易烂的那种形状）。 */
    captured.push({ channel, payload, at: Date.now() });
    if (channel === MOD_CH.onProgress && payload?.phase === 'install' && installCancelResult === null) {
      installCancelResult = invoke(MOD_CH.cancelDownload);
    }
  };

  await section('㉘c（C/S4）写盘相位点取消：**拒绝**，而那一项照常装好', async () => {
    const dirInstall = join(workRoot, 'cancel-install');
    mkdirSync(dirInstall, { recursive: true });
    placeJar(dirInstall, fx.slow);
    const id = await prepare(dirInstall);
    installCancelResult = null;
    const state = await invoke(MOD_CH.updateMod, id, fx.slow.modid, `${fx.slow.modid}|1.16.1`, {
      mirrorId: fx.slow.mirrorId,
    });
    const refused = await installCancelResult;
    check('★★ 桩真的在写盘相位点了取消（否则下面两条什么都没测）', installCancelResult !== null, '夹具自钉：那一帧必须出现过');
    check('★★ 写盘阶段取消被**拒**', refused?.ok === false, JSON.stringify(refused));
    check(
      '★ 拒绝的理由说清了"正在写入"（不是"没有在跑"那句）',
      typeof refused?.reason === 'string' && refused.reason.includes('写入'),
      refused?.reason ?? '（没有理由）',
    );
    check(
      '★★ 那一项**照常装好**（没有半成品）',
      existsSync(join(dirInstall, fx.slow.targetName)) && state.lastRun?.updated?.length === 1 && state.lastRun.cancelled.length === 0,
      JSON.stringify({ listing: listing(dirInstall), lastRun: state.lastRun }),
    );
    check('★ 没有 `.part` / `.old` 残留', noPartsOrOlds(dirInstall), listing(dirInstall));
  });

  await section('㉘d（C/S4）没有在跑时点取消：`{ok:false}` + "没有在跑"（幂等，界面不动）', async () => {
    const idle = await invoke(MOD_CH.cancelDownload);
    check('★ 没有在跑 ⇒ `{ok:false}` + "没有在跑"（幂等，界面不动）', idle?.ok === false && idle.reason.includes('没有在跑'), JSON.stringify(idle));
  });

  /*
   * =========================================================================
   * ㉙（子项目 C / S4）整夹更新**起手就取消**：一项都不许开工
   * =========================================================================
   * ★★ 为什么必须有这一节（评审 Important 1）：㉘b 那条"请求数只涨 1"**证不了
   *    "第二项没有开工"** —— 两项都被放行时，第二项的 `fetch` 建在**已 abort 的
   *    signal** 上、瞬间失败、**一个请求都不发**，计数照样绿（上一轮那把诊断刀④b 的
   *    实测现场：`failed` 里两个 modid 都在，而"请求数只涨 1"仍然 ✓）。
   *    而 `updateFolderAll` 循环顶上那句 `if (isCancelling()) break;` 在**当时的夹具**
   *    里是冗余的（当前项的 `catch` 自己就会 break）⇒ 那道承重墙当时**没有任何门禁**。
   *    ⇒ 这一节把"剩下的项不许开工"钉在**桶**上（四个桶全空），而不是请求数上。
   * ★★ 为什么这样能**确定地**落在"第一项之前"：`bulkRun` 的 `work()` 顶上就有一个
   *    `await yieldToEventLoop()`（v1 `updateAll` 的同款让出点），而它是 `setImmediate`
   *    ⇒ 上面那一行 `invoke` 返回之后、第一项开工之前，我们**在同一个同步块里**点取消
   *    就必然落在窗口里（不用 sleep 猜时机）。
   * ⚠️★ 夹具用 `placeJar`（= `fixture.local`，判成 `older` ⇒ 真的会去下载），**不是**
   *    `fixture.official`：后者与 `release.sha512` 逐字节相同 ⇒ 两行都不 batchable、
   *    这一节量的就变成"幂等跳过"而不是"开工下载"（`placeJar` 头顶那段写着全文）。
   *    ⇒ 见本分支的逐任务评审包"修复轮 1"那一节。
   */
  await section('㉙（C/S4）整夹更新**起手就取消**：一项都不许开工', async () => {
    const dir = join(workRoot, 'cancel-before-first');
    mkdirSync(dir, { recursive: true });
    placeJar(dir, fx.slow);
    placeJar(dir, fx.other);
    const id = await prepare(dir);
    const beforeReqs = c2Reqs();
    const run = invoke(MOD_CH.updateFolderAll, id, { mirrorId: fx.slow.mirrorId });
    const cancelRes = invoke(MOD_CH.cancelDownload);
    const state = await run;
    check('★ 取消被受理', cancelRes?.ok === true, JSON.stringify(cancelRes));
    check(
      '★★ 一项都没开工（四个桶全空）—— 判据是**桶**、不是请求数（第二项"瞬间失败"也满足"没发请求"）',
      state.lastRun.updated.length === 0 &&
        state.lastRun.skipped.length === 0 &&
        state.lastRun.failed.length === 0 &&
        state.lastRun.cancelled.length === 0,
      JSON.stringify(state.lastRun),
    );
    check('★ 一个下载请求都没发', c2Reqs() === beforeReqs, `请求数 ${String(beforeReqs)} → ${String(c2Reqs())}`);
    check('★ `busy` 回到 false、`progress` 清空', state.busy === false && state.progress === null, JSON.stringify({ busy: state.busy, progress: state.progress }));
  });

  /*
   * =========================================================================
   * ㉚–㉞（B2 / Task 5）整包下载：`downloadPack` 的**真行为**
   * =========================================================================
   * ⚠️★ 编号（brief 写的是"断言 8–13"，本文件自己的风格是"编号跟着**执行顺序**走"）：
   *    · **断言 8**（契约 17 条 / `main.cjs` 里 `ipcMain.handle` 条数 = 成员数 − 推送数）
   *      **一条都不用加** —— ① 那两条判据的**分母是现读的**（`MOD_CH_COUNT` 与
   *      `PUSH_CHANNELS`，见 `countChannels` 头顶那段），契约从 16 涨到 17 时它自己会涨
   *      （T4 的读数：`通道 17 条` / `main.cjs 17/17` / `ipcMain.handle 15 条`）。
   *      再写一条"等于 17"就是把**一个现读的数字抄死**（§5.32 ①/④）。
   *    · **断言 9–13** 落成下面五节 **㉚ ㉛ ㉜ ㉝ ㉞**（㉙ 已被"起手就取消"占用）。
   *    · ★ **修轮 1** 补的那一条（`installRelease` 的幂等那一支）在更下面的 **㉟** ——
   *      它与 ㉛ **不是同一条路**（那一段头顶写着两条路的区别与夹具的构造方式）。
   * ⚠️★ 四条包夹具走 `origin` 通道、每个 mod 一份自己的字节：理由写在 `buildWriteFixture`
   *    那一段的注释里（一趟只收一个通道 + 桩按前缀键控）；㉟ 那一条复用其中一份 mod 夹具
   *    （**不新造 modid**，理由写在夹具那一段的注释里）。
   * ⚠️★ "一个请求都不发"一律用**探针既有的请求计数读数**（`downloadLog`，C 时代那种
   *    `请求数 7 → 7`），不写"看起来没发" —— 而 `downloadLog` 只记**下载**那一段
   *    （`/api/modpacks/…` 那条端点走的是另一个计数 `modpackRequests`）。
   */
  const fxPack = fx.packs;
  /** 这一秒为止桩上收到的**下载**请求总数（与 C 时代那些读数同一把尺子）。 */
  const packReqs = () => downloadLog.length;
  /*
   * ★ 每一夹都放一份**诱饵** jar：`prepare()` 要求这个文件夹至少有一行（`rows.length !== 0`），
   *   而包里的项是"这个文件夹里还没有"的那一批 ⇒ 它们的目标名一个都不许预先存在
   *   （`installRelease` 收到 `oldCopies: []`：目标位置上有个我们没见过的文件 ⇒ 它拒）。
   *   诱饵用的是 `fx.good.modid`（目录里的 mod、与包里的 modid 不同名）。
   */
  const packDecoy = (dir) =>
    writeFileSync(join(dir, 'pack-decoy.jar'), probeJar(fx.good.modid, FIXTURE_JAR_VERSION));

  await section('㉚（B2 / brief ⑨）整包下载中途：`run` = download-pack、项序 1→2、收尾清空', async () => {
    const dir = join(workRoot, 'pack-progress');
    mkdirSync(dir, { recursive: true });
    packDecoy(dir);
    const id = await prepare(dir);
    const pack = fxPack.progress;
    const seen = [];
    const poll = setInterval(() => {
      void invoke(MOD_CH.getState).then((state) => {
        if (state.progress) {
          seen.push({
            run: state.progress.run,
            item: state.progress.itemIndex,
            count: state.progress.itemCount,
            modid: state.progress.modid,
          });
        }
      });
    }, 25);
    /*
     * ★★ 帧按 `captureFramesOf` 取：**这一趟自己的窗口**（`pushes.slice(before)` 会把
     *    下一趟的帧吃进来 —— 那是 T9 修复轮发现的"帧数不可复跑"的根因，见那个函数头顶）。
     *    ⚠️ 这一趟**两项都装成**，所以"最后一项装成时有没有帧推出去"正好落在它身上（I1）。
     */
    const { value: state, frames: packFrames } = await captureFramesOf(MOD_CH.onProgress, () =>
      invoke(MOD_CH.downloadPack, pack.id, '1.16.1', id, 'origin'),
    );
    clearInterval(poll);
    const runs = [...new Set(seen.map((s) => s.run))];
    const indexes = [...new Set(seen.map((s) => s.item))].sort((a, b) => a - b);
    console.log(
      `  夹具自检：这一趟下好的项 ${JSON.stringify(state.lastRun?.updated)}；项序读数 ${JSON.stringify(indexes)}；run 读数 ${JSON.stringify(runs)}；帧里的 updatedCount ${JSON.stringify(packFrames.map((frame) => frame.updatedCount))}`,
    );
    check(
      '★★ 中途的进度帧报的是 `download-pack`（把 `bulkRun` 的 `run` 写死回 `update-folder-all` ⇒ 这条红：页面会把整包下载念成"整夹更新"）',
      runs.length === 1 && runs[0] === 'download-pack',
      JSON.stringify(runs),
    );
    check(
      '★★ `itemCount` 等于这一趟的项数（= 预扫的 items 数 = 2），而不是文件夹里的行数',
      seen.length > 0 && seen.every((s) => s.count === 2),
      JSON.stringify(seen.slice(0, 6)),
    );
    /*
     * ⚠️ 与 ㉖b 同形：**必须钉住尽头**（`max`），只判"第一项是 1"的话
     *   `itemIndex += 1` 被砍成 `= 1` 之后照样绿。
     */
    check(
      '★★ 项序从 1 起、并且真的递增到最后一项（`max` = 2）',
      indexes[0] === 1 && Math.max(...indexes) === 2,
      JSON.stringify(indexes),
    );
    check(
      '★ 收尾之后 `progress` 清空、`busy` 回到 false',
      state.progress === null && state.busy === false,
      JSON.stringify({ progress: state.progress, busy: state.busy }),
    );
    check(
      '★ 这一趟真的下完了两个（不然上面的项序读数可能来自一次失败的下载）',
      state.lastRun?.updated?.length === 2 &&
        existsSync(join(dir, pack.items[0].targetName)) &&
        existsSync(join(dir, pack.items[1].targetName)),
      JSON.stringify({ lastRun: state.lastRun, listing: listing(dir) }),
    );
    /*
     * ★★★ T9 修复轮（I1）：**`downloadPack` 那一处的计数落点，在这一轮之前一条判据都没有**
     *    —— 独立评审把 `else` 支路里那句 `noteUpdated();` 删掉（`updated.push` 留着），
     *    重建之后探针**全绿**（`EXIT=0`、`✗` 0 条）。
     * ⚠️★ 后果**比 C1 更具体**：`downloadPack` 的每一次成功装盘都靠这个 `noteUpdated()`
     *    **主动推一帧**（`bulkRun` 收尾**不推帧**、`endRun()` 只把 `progress` 清空，
     *    而 `updateFolderAll` 至少还有"用户取消"那一支补推）⇒ 只留 `updated.push` 的话，
     *    **最后一项装成时那一帧不会被推**，这一趟的**终值计数一次都到不了页面**。
     * ⚠️ 判据的形状（照 §M3 "**别写'恰好一帧'**"）：
     *    · 每一帧都带这一格；· 首帧是 0；· 单调不减；· **末帧 == `lastRun.updated.length`**。
     *    最后那半边就是"终值计数真的推出去了"——它是这一条的全部要点。
     * ⚠️ 帧按 `captureFramesOf` 取（**这一趟自己的窗口**），不读模块级的 `pushes`
     *    （理由见那个函数头顶：`pushes.slice` 会把**下一趟**的帧吃进来 ⇒ 帧数不可复跑）。
     */
    const packUpdated = state.lastRun?.updated ?? [];
    check(
      '★★★ T9（A20）整包那趟：每一帧都带 `updatedCount`、首帧 0、单调不减，而且**末帧 == `lastRun.updated.length`（终值计数真的推出去了）**' +
        '（删掉 `downloadPack` 里那句 `noteUpdated();` ⇒ 这一条红：末帧会停在 1）',
      packFrames.length >= 1 &&
        packFrames.every((frame) => typeof frame.updatedCount === 'number') &&
        packFrames[0].updatedCount === 0 &&
        packFrames.every((frame, i) => i === 0 || frame.updatedCount >= packFrames[i - 1].updatedCount) &&
        packFrames[packFrames.length - 1].updatedCount === packUpdated.length &&
        packUpdated.length === 2,
      `帧的 updatedCount 序列 ${JSON.stringify(packFrames.map((frame) => frame.updatedCount))}；lastRun.updated = ${JSON.stringify(packUpdated)}`,
    );
  });

  await section('㉛（B2 / brief ⑩）包里"已经有了"的项 ⇒ skipped + **一个下载请求都不发**', async () => {
    const dir = join(workRoot, 'pack-skip');
    mkdirSync(dir, { recursive: true });
    const already = fxPack.skip.already;
    /*
     * ⚠️★ 这份 jar 的名字**不是目标名**（目标名 = `already.targetName`）：真要是有人把
     *   "已经在文件夹里"那一项也放进 `items`，目标位置上恰好没有东西 ⇒ 它会**真的发一个
     *   请求**下来 ⇒ 下面那条请求计数当场红。夹具**故意**留出这个口子（留成"目标已存在"
     *   的话，`installRelease` 会拒，红点就变成"拒得对"而不是"根本不该开工"）。
     */
    writeFileSync(join(dir, 'pack10-already-old.jar'), already.local);
    const id = await prepare(dir);
    const beforeReqs = packReqs();
    const state = await invoke(MOD_CH.downloadPack, fxPack.skip.id, '1.16.1', id, 'origin');
    const skipped = state.lastRun?.skipped ?? [];
    console.log(
      `  夹具自检：这一夹文件夹里有 ${listing(dir)}；这一趟的 lastRun ${JSON.stringify(state.lastRun)}`,
    );
    check(
      '★★ 那一项在 `lastRun.skipped` 里、原因说清了"文件夹里已经有它"',
      skipped.some((entry) => entry.modid === already.modid && entry.reason.includes('已经有')),
      JSON.stringify(skipped),
    );
    check(
      '★ 目录里没有的那个 modid 也如实进 `skipped`（预扫的五种原因之一，不是"静默丢掉"）',
      skipped.some((entry) => entry.modid === fxPack.skip.absent),
      JSON.stringify(skipped),
    );
    check(
      '★★ **一个下载请求都不发**（判据是请求计数读数，不是"看起来没发"）',
      packReqs() === beforeReqs,
      `请求数 ${String(beforeReqs)} → ${String(packReqs())}`,
    );
    check(
      '★ 四个桶里都没有"已经下过"这件事：`updated` / `failed` / `cancelled` 全空',
      state.lastRun.updated.length === 0 &&
        state.lastRun.failed.length === 0 &&
        state.lastRun.cancelled.length === 0,
      JSON.stringify(state.lastRun),
    );
    check(
      '★ 目标文件没有被建出来（那一趟一个字节都没写）',
      !existsSync(join(dir, already.targetName)),
      listing(dir),
    );
  });

  await section('㉜（B2 / brief ⑪）第二个 mod 的 sha512 对不上 ⇒ `failed` 有它、第一个仍在 `updated`、整趟不抛', async () => {
    const dir = join(workRoot, 'pack-fail');
    mkdirSync(dir, { recursive: true });
    packDecoy(dir);
    const id = await prepare(dir);
    const pack = fxPack.fail;
    const beforeReqs = packReqs();
    let state = null;
    let threw = null;
    try {
      state = await invoke(MOD_CH.downloadPack, pack.id, '1.16.1', id, 'origin');
    } catch (error) {
      threw = error;
    }
    console.log(
      `  夹具自检：桩上这一趟收到 ${String(packReqs() - beforeReqs)} 个下载请求；lastRun ${JSON.stringify(state?.lastRun)}`,
    );
    check(
      '★★ 整趟**没有抛**（一条失败不许把整包变成一次 reject —— spec §7.4 的同一条纪律）',
      threw === null && isState(state),
      threw?.message ?? resultDetail(state),
    );
    check(
      '★★ `failed` 里是**第二个**（reason 说清了 sha512 对不上：它真的走了下载，不是"目标已存在"那种拒）',
      (state?.lastRun?.failed ?? []).some(
        (entry) => entry.modid === pack.bad.modid && entry.reason.includes('sha512'),
      ),
      JSON.stringify(state?.lastRun ?? null),
    );
    check(
      '★★ 第一个仍然在 `updated` 里（失败**不中断整包**）',
      /* ⚠️ `updated` 是 **modid 的字符串数组**（`ModFoldersState['lastRun']` 那条契约）
         ⇒ 判据是 `includes`，不是 `.some((entry) => entry.modid === …)`（后者恒 false）。 */
      (state?.lastRun?.updated ?? []).includes(pack.good.modid),
      JSON.stringify(state?.lastRun ?? null),
    );
    check(
      '★ 两个都真的开工过（桩上收到 2 个请求：一个成、一个被哈希拒）',
      packReqs() === beforeReqs + 2,
      `请求数 ${String(beforeReqs)} → ${String(packReqs())}`,
    );
    check(
      '★ 好的那一份装上了、坏的那一份没落盘、也没有 `.part` 残留',
      existsSync(join(dir, pack.good.targetName)) &&
        !existsSync(join(dir, pack.bad.targetName)) &&
        noPartsOrOlds(dir),
      listing(dir),
    );
  });

  await section('㉝（B2 / brief ⑫）整包下载中途取消 ⇒ `cancelled` 有它、没有 `.part`、后面的项不开工', async () => {
    const dir = join(workRoot, 'pack-cancel');
    mkdirSync(dir, { recursive: true });
    packDecoy(dir);
    const id = await prepare(dir);
    const pack = fxPack.cancel;
    const beforeReqs = packReqs();
    let state = null;
    let threw = null;
    const run = invoke(MOD_CH.downloadPack, pack.id, '1.16.1', id, 'origin').then(
      (value) => {
        state = value;
      },
      (error) => {
        threw = error;
      },
    );
    /*
     * ★★ 夹具自钉 —— **等到桩上真的记下第一个请求**再取消（`waitUntil` 头顶那段写着
     *   为什么不用 `sleep` 猜：负载一高就猜空，读数长成 `请求数 X → X`，
     *   而那个红点长得像"取消失效"）。判据是**确定**的：桩在响应体写完之前就记请求，
     *   而 `chunkDelayMs = 400` ⇒ 计数一涨就点取消，落点必然在"下载中途"。
     */
    await waitUntil(() => packReqs() === beforeReqs + 1);
    check(
      '★★ 取消那一刻真的有一个请求在飞（夹具自钉：不然这一节什么都测不到）',
      packReqs() === beforeReqs + 1,
      `请求数 ${String(beforeReqs)} → ${String(packReqs())}`,
    );
    const cancelRes = await invoke(MOD_CH.cancelDownload);
    await run;
    check('★ 取消被受理（`{ok:true}`）', cancelRes?.ok === true, JSON.stringify(cancelRes));
    check(
      '★★ 取消**不** reject（D4：取消不是失败，IPC 不该弹错）',
      threw === null && isState(state),
      threw?.message ?? resultDetail(state),
    );
    check(
      '★★ 被中断的那一项进 `cancelled` 而**不是** `failed`（与 `updateFolderAll` / `downloadMissing` 同一条 D4 纪律）',
      (state?.lastRun?.cancelled ?? []).some((entry) => entry.modid === pack.items[0].modid) &&
        (state?.lastRun?.failed ?? []).length === 0,
      JSON.stringify(state?.lastRun ?? null),
    );
    check(
      '★★ 后面的项**没有开工**（请求数只涨了 1 —— 第二项一个请求都没发）',
      packReqs() === beforeReqs + 1,
      `请求数 ${String(beforeReqs)} → ${String(packReqs())}`,
    );
    check(
      '★ 第二项的目标文件没有被建出来、也没有 `.part` / `.old` 残留',
      !existsSync(join(dir, pack.items[1].targetName)) && noPartsOrOlds(dir),
      listing(dir),
    );
    check(
      '★ `busy` 回到 false、`progress` 清空',
      state?.busy === false && state?.progress === null,
      JSON.stringify({ busy: state?.busy, progress: state?.progress }),
    );
  });

  await section('㉞（B2 / brief ⑬）不存在的整合包 ⇒ IPC reject，且一个下载请求都不发', async () => {
    const dir = join(workRoot, 'pack-missing');
    mkdirSync(dir, { recursive: true });
    packDecoy(dir);
    const id = await prepare(dir);
    const beforeReqs = packReqs();
    const beforePackReqs = modpackRequests;
    let refused = null;
    try {
      await invoke(MOD_CH.downloadPack, 'no-such-id', '1.16.1', id, 'origin');
    } catch (error) {
      refused = error;
    }
    check(
      '★★ IPC **reject**（"这个包不存在"是一件要说话的事，不许静默当空包下 0 项）',
      refused !== null,
      refused?.message ?? '（没有抛）',
    );
    check(
      '★ 拒的理由说清了"这个整合包不存在"',
      typeof refused?.message === 'string' && refused.message.includes('这个整合包不存在'),
      refused?.message ?? '（没有理由）',
    );
    check(
      '★★ **一个下载请求都不发**（请求计数读数）',
      packReqs() === beforeReqs,
      `请求数 ${String(beforeReqs)} → ${String(packReqs())}`,
    );
    /*
     * ⚠️★ 这条是那声"不存在"的**第二条独立读数**（§5.38）：它证的是"那声 404 是**服务端**
     *   答的" —— 一个"本地直接判空"的实现会让这一格是 0，而上面那条"一个请求都不发"照样绿。
     */
    check(
      '★ 而**服务端真的被问过一次**（那声"不存在"由 404 答，不是本地猜的）',
      modpackRequests === beforePackReqs + 1,
      `modpacks 端点请求数 ${String(beforePackReqs)} → ${String(modpackRequests)}`,
    );
    check(
      '★ `busy` 没有被留在 true（拒在起手处，这一趟根本没有起手）',
      (await invoke(MOD_CH.getState)).busy === false,
      '',
    );
  });

  /*
   * =========================================================================
   * ㉟（修轮 1 / 评审的唯一 Important）`installRelease` 的**幂等**那一支：目标已经是这一份
   * =========================================================================
   * ⚠️★ 编号：㉚–㉞ 是 brief 的断言 9–13（T5 已落地）⇒ 这个新支取**下一个空号 ㉟**
   *    （现读 `await section(` 的编号确认过没有重号）。
   * ⚠️★★ 这一支与 ㉛ **不是同一条路**（两条各要一条判据，别混）：
   *    · ㉛ = `already-in-folder`：**预扫**的扫描读数里已经认出了这个 modid ⇒ 那一项
   *      **根本不进 `plan.items`**，`installRelease` 一次都没被调用（"文件夹里有它"）；
   *    · ㉟ = `already-current`：预扫**没看见**它、那一项真的进了 `items`、`installRelease`
   *      **被调用了**，而它的幂等闸读到"目标位置的 sha512 与这一条 release 逐字节相同"
   *      ⇒ **不下载、不写盘**、直接返回 `{ alreadyCurrent: true }`。
   *      这是实际会撞上的那一条（用户在两次扫描之间自己把 jar 放了进去 / 上一趟的残影）。
   * ⚠️★ 夹具的**唯一**构造方式（现读 `installRelease` 的 ③ 与 `packPlanFor` 的两条判据）：
   *      "目标已在位（sha512 一致）"要的是盘上那份字节与 `release.sha512` 逐字节相同；而这样
   *      一份 jar 的内部 `fabric.mod.json.id` 就是那个 modid ⇒ 它要是**扫描时就**在目录里，
   *      扫描读数会认出它 ⇒ 那一项会被 `packPlanFor` 判成 `already-in-folder`（= ㉛ 那条路，
   *      **走不到**幂等那一支）。⇒ **先把文件夹扫一遍（`prepare`），随后才把那一份字节放进
   *      目标位置**："盘上有、缓存的读数里没有" ⇒ 只有幂等那一支接得住它
   *      （下面第一条"夹具自钉"量的就是这个前提，它红了就是夹具坏了，不是产品坏了）。
   */
  await section(
    '㉟（修轮 1）目标"已经是这一份" ⇒ 只进 `skipped`（**不进** `updated`）、一个请求都不发',
    async () => {
      const dir = join(workRoot, 'pack-current');
      mkdirSync(dir, { recursive: true });
      /* 诱饵：`prepare()` 要求这个文件夹至少有一行（`rows.length !== 0`）。 */
      packDecoy(dir);
      const id = await prepare(dir);
      const already = fxPack.current.already;
      const targetPath = join(dir, already.targetName);
      /*
       * ★★ 落的是 `official`（= 目录里写的那个 sha512 对应的字节）—— 幂等闸要的正是它。
       *    （`local` 是同 modid、内部版本更低、字节不同的那一份 ⇒ 那会真的去下载。）
       */
      writeFileSync(targetPath, already.official);
      const beforeReqs = packReqs();
      const rowsNow = folderByPath(await invoke(MOD_CH.getState), dir)?.rows ?? [];
      check(
        '★★ 夹具自钉：目标那一份**已经在盘上**、而**缓存的扫描读数里没有这个 modid**（⇒ 只有幂等那一支接得住它）',
        existsSync(targetPath) && !rowsNow.some((row) => row.modid === already.modid),
        `${listing(dir)}；rows=${JSON.stringify(rowsNow.map((row) => row.modid))}`,
      );
      const state = await invoke(MOD_CH.downloadPack, fxPack.current.id, '1.16.1', id, 'origin');
      const skipped = state.lastRun?.skipped ?? [];
      const updated = state.lastRun?.updated ?? [];
      console.log(
        `  夹具自检：这一夹文件夹里有 ${listing(dir)}；这一趟的 lastRun ${JSON.stringify(state.lastRun)}`,
      );
      check(
        '★★ 那一项在 `lastRun.skipped` 里，而且说的正是**幂等**那一支（不是 ㉛ 的"文件夹里已经有它"）',
        skipped.some(
          (entry) => entry.modid === already.modid && entry.reason.includes('已经是这一份'),
        ),
        JSON.stringify(skipped),
      );
      /*
       * ★★ 这一条就是评审那条 Important 的判据：两个桶**互斥**。它坏掉的样子是 `updated`
       *    里也有它 ⇒ 页面那句汇总行（`lastRunSummary`："已更新 {{ok}} 个，跳过 {{skipped}} 个"）
       *    把一次**一个字节都没写**的空转念成"已更新 1 个，跳过 1 个"。
       */
      check(
        '★★ 同一项**不在** `updated` 里（`updated` 与 `skipped` 互斥 —— 两处都记就是"已更新 1 / 跳过 1"的空转）',
        !updated.includes(already.modid),
        JSON.stringify(state.lastRun),
      );
      check(
        '★ `updated` 整个是空的（这一趟真的一个字节都没写）',
        updated.length === 0,
        JSON.stringify(updated),
      );
      check(
        '★★ **一个下载请求都不发**（请求计数读数 —— 它同时证"这一趟走的是幂等那一支，不是真的下了"）',
        packReqs() === beforeReqs,
        `请求数 ${String(beforeReqs)} → ${String(packReqs())}`,
      );
      check(
        '★ 目标那一份的字节一个字节都没变（sha512 仍是夹具那一份）',
        sha512Of(targetPath) === sha512OfBuffer(already.official),
        `${sha512Of(targetPath).slice(0, 16)}…`,
      );
    },
  );

  /*
   * =========================================================================
   * ㊱ ★★ T9（spec A20 / §8）：**「已更新文件数」只数真的写盘成功的**
   * =========================================================================
   * 判据一句话：**同一趟**整夹更新里三种去向**同时**发生 ——
   *   ① 一项真的装成（进 `updated`）、② 一项**跳过**、③ 一项**失败**
   *   （桩回的字节与 `release.sha512` 对不上 ⇒ 下完被拒）。
   *   ⇒ 终帧的 `updatedCount` 必须是 **1**（不是 3、也不是 0：
   *     3 = "每进一项就加一"那种坏实现；0 = "一个都没数"）。
   *
   * ⚠️★★ **"跳过"这一项只能是"不可批量"那一支，构造不出别的**（现读 `updateFolderAll`
   *    的循环体，两条路是**互斥**的，写在这里免得下一个人白试一遍）：
   *      · 可批量那一支（`row.batchable === true`）⇒ 进 `installFolderRow` ⇒ 只有
   *        `why === null`（真的写了）与 `skipped.push(幂等那句)` 两种去向；
   *      · 不可批量那一支（`else`）⇒ `skipped.push(skipReasonOf(row))`，**从不**下载。
   *    ⇒ 想造"可批量的行走到幂等那一支"就得让**缓存的扫描读数**与**盘上那一刻**不一致
   *      （"盘上有、读数里没有"）—— 而那份读数是**这一趟刚扫出来的**（`prepare` 之后立刻跑），
   *      构造不出来。㉟ 那一条走的是 `downloadPack` 的 `plan.items`（**不用**文件夹的扫描读数
   *      筛），所以那边能造。
   *    ⇒ 这一条钉的是 A20 的**字面**："跳过与失败**都不算**" —— 跳过的那一项**不进
   *      `updatedCount`**（它是"没被碰"的那一类）。
   *    ⚠️★★ **`updateFolderAll` 里那个 `alreadyCurrent` 那一支今天没有判据**（T9 修复轮就地改准）：
   *      原文写的是"那半边由 `writeRun` 那一处与 `downloadPack` 那一处钉着"，**那句已经作废**
   *      （当时两处都**没有**判据 —— 独立评审各删一次、探针全绿；这一轮给那两处各补了一条，
   *      见 **⑯ 的幂等那一趟**与 **㉚ 的"末帧 == updated.length"**）。
   *      而**这一支**（`updateFolderAll` 循环体里、可批量且空转那一格）**构造不出来**：
   *      `row.batchable` 要求 `verdict.kind` 是 `older`/`different-build`，而
   *      `installRelease` 的 `alreadyCurrent` 要求目标文件**已是这一份** ⇒ 判 `same`
   *      ⇒ 不可批量 ⇒ 它永远进不了那一支（详证见上）。⇒ 它是**防御性**代码，
   *      成立靠的正是这两条判据的**互斥**（`packages/shared/src/modCatalog.ts` 的
   *      `isUpdatable` 一族与 `apps/desktop/src/mod-folders.ts` 的 `installRelease` ③），
   *      **不是**靠某一条断言。⚠️ 若将来有人把两条路合并，这一格会静默失效 —— 那时**必须**
   *      补一条判据（今天补不了，因为它不可达）。
   *
   * ⚠️★ 三个数的**出处**（一条判据要同时读三个方向，少一个都只钉住一半）：
   *   · `1` —— `updatedCount`（这一格本身）；
   *   · `skipped` / `failed` —— `lastRun` 那两个桶（**上一趟**的总账，与上面那一格
   *     **口径不同、都要在**：派工文本第 2 条提醒）。
   *   ⇒ 断言写成"**三个桶各恰好一条、而且就是那三个 modid**"，而不是"长度等于 1"：
   *     后者对"跳过那条被算成 updated"这种坏实现**照样绿**（总数没变）。
   */
  await section(
    '㊱ ★★ T9（A20）：`updatedCount` **只数真的写盘成功的**（一项成、一项跳、一项失败 ⇒ 终帧是 1）',
    async () => {
      const dir = join(workRoot, 't9-count');
      mkdirSync(dir, { recursive: true });
      /*
       * ★★ 三份文件各有各的落法（每一格的**位置**都是判据的一部分）：
       *   · `t9.ok`   ⇒ 写**诱饵名**（`local` 那份字节）：`release` 的目标名上因此**没有文件**
       *                 ⇒ 真的去下载 ⇒ 桩回的是 `official`（sha512 对得上）⇒ **装成**。
       *                 ⚠️ 诱饵名以那个 modid 开头，`readJarMeta` 才认得出它
       *                 （`prepare()` 要求这一夹至少有一行）。
       *   · `t9.bad`  ⇒ 同样写诱饵名 ⇒ 真的去下载 ⇒ 桩回的字节 sha512 对不上 ⇒ **失败**。
       *   · `t9.skipped` ⇒ 写**目标名**、字节 = `official`（版本号 9.9.9 = 目录里那一条）
       *                 ⇒ 判定 `same` ⇒ **不可批量** ⇒ 走"跳过"那一支
       *                 （一个请求都不发、一个字节都不写）。
       */
      writeFileSync(join(dir, `${t9.ok.modid}-old.jar`), t9.ok.local);
      writeFileSync(join(dir, `${t9.bad.modid}-old.jar`), t9.bad.local);
      writeFileSync(join(dir, t9.skipped.targetName), t9.skipped.official);
      const id = await prepare(dir);
      /*
       * ★★ 夹具自钉（三段，逐段都是"这一节到底测没测到东西"的前提）：
       *    ① 三行都在；
       *    ② **恰好两行可批量**（成 / 失败那两条 —— 跳过那条是 `same` ⇒ 不可批量）；
       *    ③ 跳过那条的目标位置上那份字节**真的**等于 `release.sha512`。
       */
      const rows = folderByPath(await invoke(MOD_CH.getState), dir)?.rows ?? [];
      const batchRows = rows.filter((row) => row.batchable);
      const skipRow = rows.find((row) => row.modid === t9.skipped.modid);
      check(
        '★★ 夹具自钉（三段）：三行都在、**恰好两行可批量**、跳过那条判成 `same`、目标那份字节 = release 的 sha512',
        rows.length === 3 &&
          batchRows.length === 2 &&
          /* ⚠️ 这一格是**对象**（`{ kind: 'same' }`），不是字符串 —— 第一版拿它直接比 'older'，
             读数是 `[object Object]` ⇒ 这一条红在**夹具自钉**上（§5.74 那一族：红点长得像产品缺陷）。 */
          skipRow?.verdict?.kind === 'same' &&
          sha512Of(join(dir, t9.skipped.targetName)) === t9.skipped.release.sha512,
        `${listing(dir)}；rows=${JSON.stringify(rows.map((row) => `${row.modid}:${row.verdict?.kind ?? '?'}${row.batchable ? '+batchable' : ''}`))}`,
      );
      /*
       * ★★ 仪器：**每一帧**都收下来（`onProgress` 那一条载体）。
       *    ⚠️★★ T9 修复轮改准：原来这里读的是模块级的 `pushes.slice(before)` —— 而
       *    `pushes` 从加载起一直在涨、"这一趟跑完了"却是在 `await invoke(...)` 返回**之后**
       *    才判的 ⇒ 属于**下一趟**的帧（`noteUpdated` 那一帧是同步推的）会被算进来。
       *    后果是**帧数读数漂**：同一份字节上我量到 `帧数 4 / [0,0,1,1]`、独立评审量到
       *    `帧数 5 / [0,0,1,1,1]`（走向一致，差的是**尾帧**）⇒ 帧数当不了锚点（§M2）。
       *    ⇒ 改用 `captureFramesOf`（**这一趟自己的窗口**，逐趟清）；这一轮之后
       *    **新的**计数判据一律用它，不再写 `pushes.slice(...)`。
       */
      const beforeReqs = packReqs();
      const { value: state, frames } = await captureFramesOf(MOD_CH.onProgress, () =>
        invoke(MOD_CH.updateFolderAll, id, 'origin'),
      );
      console.log(
        `  夹具自检：这一夹 ${listing(dir)}；这一趟 lastRun ${JSON.stringify(state.lastRun)}；` +
          `帧里的 updatedCount ${JSON.stringify(frames.map((frame) => frame.updatedCount))}`,
      );
      /*
       * ★★★ **主判据**：这一趟帧里的 `updatedCount` **最大值恰好是 1**（首值 0、单调不减）。
       *
       * ⚠️★ 判据写的是 `Math.max(...counts) === 1` 而**不是**"最后一帧是 1"：
       *    `captureFramesOf` 取到的是"`await` 返回那一刻之前"落进窗口的帧 —— 而主进程可能
       *    在收尾那一瞬间还推一帧（`pushProgress(true)` 那几条支路），它**属于这一趟、
       *    也是 1**（`updatedCount` 不会因为多推一帧就变）⇒ 写"最后一帧"是**多一个
       *    与本判据无关的时序依赖**（第一版就是这么写的，而且我量与评审量出的帧数还不一样，
       *    见 §M2）。**首值 0 + 单调不减 + 最大值 1** 这三条一起，量的才是"只数成功的"。
       *
       * ⚠️★ 三个数各自能红的刀（逐条都实测过，读数记在 `task-9-fix-report.md`）：
       *   · 把计数器改成"每进一项就加一"（`setRunItem` 里 `+= 1`）⇒ 最大值变成 **3**；
       *   · 把跳过那一支也算（`else` 里也加）⇒ 变成 **2**；
       *   · 整个删掉（`noteUpdated` 里不 `+= 1`）⇒ 变成 **0**；
       *   · ⛔ **这里曾经写着第四条"把 `noteUpdated()` 从 `writeRun` 挪到 `endRun()` 之后
       *     ⇒ 单行那条判据红" —— 那句是空炮**（T9 修复轮就地删掉）：当时探针里**没有**
       *     任何一条判据读单行那两趟的 `updatedCount`（独立评审把 `writeRun` 那句整行删掉，
       *     探针 **`EXIT=0`、`✗` 0 条**）⇒ 那句注释指向一条**不存在**的判据。
       *     现在那两处**各有**一条：正向在 **⑯b**（首值 0 / 至少一帧 1 / 最大值恰好 1）、
       *     空转在 **⑯ 的第二次**（一次都不许是 1）、整包在 **㉚**（末帧 == `updated.length`）。
       */
      const counts = frames
        .map((frame) => frame.updatedCount)
        .filter((value) => typeof value === 'number');
      check(
        '★★★ 这一趟的帧：`updatedCount` 首值 0、单调不减、**最大值恰好是 1**（一项真的装成；跳过与失败都不算 —— A20 的字面）',
        counts.length >= 1 &&
          counts[0] === 0 &&
          counts.every((value, i) => i === 0 || value >= counts[i - 1]) &&
          Math.max(...counts) === 1,
        `帧数 ${String(frames.length)}（按这一趟自己的窗口数）；updatedCount 序列 ${JSON.stringify(counts)}`,
      );
      /*
       * ★★ 同一格在**进行中**就要有值（不是只在末帧才冒出来），而且**只可能属于装成的那一项**
       *    （它自己那一帧）**或它之后的那一项**（`updatedCount` 是**累计**：后面那一项开工时
       *    带着的是**前一项的成果**）—— **绝不可能属于被跳过的那一项**（它做完就 `skipped`，
       *    从不进 `setRunItem`）。
       *
       * ⚠️★★ 这条断言的第一版写的是"这些帧的 `modid` **就是** `t9.ok`"，实测**假红**：
       *    `[{"state-output",1},{"stronghold-trainer",1}]` —— 第二项（**失败**那一项）开工时
       *    带着累计 1。那不是产品缺陷，是"累计"这个语义本身（§5.79：红点长得像产品缺陷）。
       *    ⇒ 改成"**属于装成那一项或它之后的那一项**、且**不含被跳过那一项**"：
       *    前一半钉"它跟着**这一趟**走"（不是凭空冒出来的数），后一半钉"跳过的那一项没被算"。
       * ⚠️ 取 `cumulative[0]` 只用来钉"**第一个**出现的累计帧一定属于装成的那一项"
       *    （那一项是这一趟的**第一项**）；**不许**把这一条改成"恰好一帧"或"每一帧都属于它"
       *    （跳过那一项不产帧、而后面各项都会带着累计值 ⇒ 那两种写法都会在**正确**的实现上报红，
       *    §M3 那一族）。
       */
      const okIndex = [
        t9.ok.modid,
        t9.bad.modid,
      ];
      const cumulative = frames.filter(
        (frame) => typeof frame.updatedCount === 'number' && frame.updatedCount >= 1,
      );
      check(
        '★★ 进行中的帧里就带着它（`updatedCount >= 1` 的帧至少一帧；第一个属于**装成的那一项**；' +
          '而所有这样的帧都只属于"装成那一项**或它之后**的项"、**绝不属于被跳过的那一项**）',
        cumulative.length >= 1 &&
          cumulative[0].modid === t9.ok.modid &&
          cumulative.every((frame) => okIndex.includes(frame.modid)) &&
          !cumulative.some((frame) => frame.modid === t9.skipped.modid),
        JSON.stringify(cumulative.map((frame) => ({ modid: frame.modid, item: frame.itemIndex, updated: frame.updatedCount }))),
      );
      /*
       * ★★ 三个桶各恰好一条、modid 逐条对（不是"长度等于 1"）—— 它把"三个方向真的都发生过"
       *    钉在**上一趟的总账**上（与 `updatedCount` 口径不同，两条都要在）。
       */
      const updated = (state.lastRun?.updated ?? []).map((modid) => modid);
      const skippedList = state.lastRun?.skipped ?? [];
      const failedList = state.lastRun?.failed ?? [];
      check(
        '★★ 同一趟里三个方向真的都发生了：`updated` / `skipped`(幂等) / `failed`(sha512) 各恰好一条、modid 逐条对',
        updated.length === 1 &&
          updated[0] === t9.ok.modid &&
          skippedList.length === 1 &&
          skippedList[0].modid === t9.skipped.modid &&
          skippedList[0].reason.includes('已经是这一份') &&
          failedList.length === 1 &&
          failedList[0].modid === t9.bad.modid &&
          failedList[0].reason.includes('sha512'),
        JSON.stringify(state.lastRun),
      );
      /*
       * ★★ 而盘上那一半也要对得上（"数了 1 个"必须真的是"写下去了 1 个文件"）：
       *    成功那一项的目标文件在、跳过那一项的目标文件**字节没变**、
       *    失败那一项**没有落盘**、也没有 `.part` 残留。
       */
      check(
        '★★ 盘上那一半：成功那项的目标文件就位、跳过那项的字节一个字节没变、失败那项**没有**落盘',
        existsSync(join(dir, t9.ok.targetName)) &&
          sha512Of(join(dir, t9.ok.targetName)) === t9.ok.release.sha512 &&
          sha512Of(join(dir, t9.skipped.targetName)) === t9.skipped.release.sha512 &&
          !existsSync(join(dir, t9.bad.targetName)),
        `${listing(dir)}`,
      );
      check('★ 没有 `.part` / `.old` 残留', noPartsOrOlds(dir), listing(dir));
      /*
       * ★★ 请求计数（第二条独立读数，§5.38）：**跳过那一项一个请求都不发**。
       *    ⚠️ 这一趟走 `origin`，桩只对 `/mirror-` 开头的前缀记 `downloadLog` ⇒
       *    这里**只能**量"至少 2 个"（成功 + 失败各一个）—— 而"跳过那项没发请求"这半边
       *    由 `skipped[0].reason` 那句"已经是这一份（**没有下载**、没有写盘）"钉着
       *    （它是 `installRelease` 幂等那一支自己的措辞，只有走到那一支才会有）。
       */
      check(
        '★★ 这一趟真的下了字节（至少 2 个请求：成功 + 失败各一个；跳过那一项由 reason 里的"没有下载"钉着）',
        packReqs() >= beforeReqs + 2,
        `请求数 ${String(beforeReqs)} → ${String(packReqs())}`,
      );
      check(
        '★ 收尾之后 `progress` 清空、`busy` 回到 false（界面不停在最后一帧）',
        state.progress === null && state.busy === false,
        JSON.stringify({ progress: state.progress, busy: state.busy }),
      );
    },
  );

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
   * ★ Task 5（D1）：`h` = "**D1 之前**写的状态文件"（`folders` 非空、D1 那两格都缺）
   *   ⇒ 一次性迁移；`i`（第二次启动）与 `j`（第三次启动）由 **h 自己** spawn
   *   —— 三个进程，**谁也不重种夹具**（理由见 `prefsPhase` 里 `if (CASE === 'h')` 那一段）。
   * ⚠️ 与上面那一支**分开走**：h 的子进程失败时它自己已经打印了逐条读数，这里再折一条
   *   `✗` 正好把"哪一半红的"说清楚（`i` / `j` 的退出码 2 与 1 由 h 那一支分辨，见那里的注释）。
   */
  console.log('\n## ★ Task 5（D1）：A16 一次性迁移（"D1 之前"的文件 ⇒ 清一次；再启动 ⇒ 不再清）');
  const migrationChild = spawnSync(process.execPath, [self, '--phase', 'prefs', '--case', 'h'], {
    stdio: 'inherit',
    cwd: repoRoot,
    env: { ...process.env, MCSR_VERIFY_REEXEC: '1' },
  });
  check(
    '（子进程）A16 迁移的四条判据 + 后两次启动（case i / j）全成立',
    migrationChild.status === 0,
    `子进程退出码 ${String(migrationChild.status)}`,
  );

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
  /*
   * ★ 子进程的退出码 **2** 与 **1** 是两件事：2 说的是"这一整套检查**没跑起来**"（夹具前提
   *   不成立、`bail` 中途退出…），1 才是"某条判据不成立"。把它折成一条 `✗` 再让父相位用 1
   *   收场，正好抹掉这个区别（§5.74 那一族：0 与"没跑"分不开）⇒ 这一支单独走，**不记判据**，
   *   父相位自己也以 2 收场（子进程的 `bail` 已经把它那一行「判据没跑起来」印在上面了）。
   *   ⚠️ 只动这一支：0 / 1 的语义一字不改。
   */
  if (writeChild.status === 2) {
    /*
     * ⚠️★ 这一支**不能**走 `bail`：`bail` 立刻 `process.exit(2)`，会跳过末尾那段的收尾
     *   （打印临时目录 + `rmSync` + `server.close()`）⇒ `%TEMP%` 里会静默留下一份本次的
     *   临时目录，**连路径都不打印**。所以照末尾那段**就地**写那三句，退出码仍然是 2。
     */
    console.error('\n✗ 写相位**没跑起来**（退出码 2）—— 原因见上面子进程那一行「判据没跑起来」');
    console.error('  （退出码 2 = 这条检查没跑成，**不等于**判据通过）');
    console.log(`\n  临时目录：${result.workRoot}${KEEP ? '（--keep：保留）' : ''}`);
    server.close();
    if (!KEEP && result.workRoot) rmSync(result.workRoot, { recursive: true, force: true });
    process.exit(2);
  }
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
