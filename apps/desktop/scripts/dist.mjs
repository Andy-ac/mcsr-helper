/**
 * 打包 Windows 安装包。
 *
 * ---------------------------------------------------------------------------
 * 为什么不用 electron-builder 的命令行
 * ---------------------------------------------------------------------------
 * 因为那条路在 Windows + pnpm 下是坏的，而且坏得很隐蔽：
 *
 *     Unknown argument: C:\...\node_modules\electron-builder\cli.js
 *
 * 也就是 electron-builder 收到了它自己的脚本路径当参数。同一个脚本用 cmd
 * 直接跑完全正常 —— 所以它"看起来能用"，只在 pnpm 启动时失败。
 * 这是本项目第二次遇到同一类问题（第一次是 tsx，见 services/api/package.json）。
 *
 * ---------------------------------------------------------------------------
 * 试过四种办法，前三种都不行，记下来免得再走一遍
 * ---------------------------------------------------------------------------
 *   1. `spawnSync(node, [cli, ...], { stdio: 'inherit' })`
 *      → **什么都没产出，退出码却是 0**。隔一层进程去跑，
 *        输出和退出码都可能对不上，而"看起来成功但其实没做"最难查。
 *
 *   2. 重设 `process.argv` 再 import cli
 *      → 直接跑可以，经由 pnpm 启动仍然报同样的错。
 *        （说明 pnpm 环境里有东西让它切分 argv 的方式变了。）
 *
 *   3. 过滤掉混进来的未知参数（黑名单）
 *      → 不行，而且未知的东西不止一种：日志里实测见到过 `DSH Desktop.exe`
 *        和 `build` 两段无关文本被塞进 argv。
 *
 *   4. **改用编程接口**（就是下面这个）
 *      → 完全不经过 CLI 和 yargs，也就没有 argv 可以出错。
 *
 * 结论：参数是固定的、没有"由调用方传入"的用例时，
 * 绕开会出错的中间层比修补它更省事，也更可靠。
 * ---------------------------------------------------------------------------
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..');
const self = fileURLToPath(import.meta.url);

// ---------------------------------------------------------------------------
// ⚠️⚠️ 先确认跑的是不是真正的 Node
// ---------------------------------------------------------------------------
// pnpm 执行脚本时，会用**它自己的 execPath** 去解析命令里的 `node`。
// 如果 pnpm 本身跑在 Electron 里（这台机器上就是这样：DSH Desktop 是 Electron 应用，
// 它内嵌的 pnpm 因此把 `node` 指向 DSH Desktop.exe），那么所有 `pnpm run` 里的
// `node xxx` 实际跑的是 **Electron 的 Node**，而不是机器的 Node。
//
// 后果不是"性能差一点"，而是三个看起来毫无关联的错误：
//   · argv 里混进 `DSH Desktop.exe` 和别的东西 → electron-builder 报
//     "Unknown argument: <cli.js 路径>"
//   · Electron 的 asar 加载器介入 → 报 "Invalid package ... default_app.asar"
//     （错误来自 node:electron/js2c/node_init，普通 Node 根本不会抛出它）
//   · 两个现象都只在经由 pnpm 时出现，直接跑就正常 —— 所以第一眼会以为是
//     参数传递的问题，而真正的差别是**解释器不是同一个**。
//
// 修法：发现自己在 Electron 里，就找一个真正的 node 把自己重跑一遍。
// 这不是"绕过问题"——打包这件事本来就必须由普通 Node 完成，
// Electron 的 Node 不是一个可用的替代品。
if (process.versions.electron) {
  const real = findRealNode();
  if (!real) {
    console.error(
      [
        '✗ 这个脚本跑在了 Electron 里面，而打包必须用普通 Node。',
        `  当前解释器: ${process.execPath}（Electron ${process.versions.electron}）`,
        '  自动查找 node 失败。请直接在终端里运行：',
        `      node "${self}"`,
      ].join('\n'),
    );
    process.exit(1);
  }

  console.log(`[dist] 检测到 Electron 环境，改用真正的 Node: ${real}`);
  const result = spawnSync(real, [self, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, MCSR_DESKTOP_DIST_REEXEC: '1' },
    cwd: pkgRoot,
  });
  process.exit(result.status ?? 1);
}

/** 在 PATH 里找一个不是 Electron 的 node。 */
function findRealNode() {
  const which = process.platform === 'win32' ? 'where' : 'which';
  const found = spawnSync(which, ['node'], { encoding: 'utf8' });
  const candidates = (found.stdout ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.toLowerCase() === process.execPath.toLowerCase()) continue;
    // DSH Desktop 那类 Electron 应用也会在 PATH 上留下自己的 exe
    if (/dsh desktop|electron/i.test(candidate)) continue;
    const probe = spawnSync(candidate, ['-e', 'console.log(process.versions.electron ?? "")'], {
      encoding: 'utf8',
    });
    if (probe.status === 0 && (probe.stdout ?? '').trim() === '') return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 二进制下载源
//
// ⚠️ electron-builder 打包时要**自己再下一份 Electron 发行版**（不是复用
//    node_modules 里那份），默认从 github.com 拉。这台机器上不通，表现是：
//
//        ⨯ connect ETIMEDOUT 20.205.243.166:443
//
//    这个错误只给一个 IP 和端口，**不会**提示"是网络问题" ——
//    第一眼看起来像配置写错或者别的什么被墙了。
//    我一开始以为它和上面的 argv 错误是同一件事，其实完全无关：
//    .npmrc 里的 electron_mirror 只影响 `pnpm install` 那一步，
//    打包这一步读的是**环境变量**。
// ---------------------------------------------------------------------------
process.env.ELECTRON_MIRROR ??= 'https://registry.npmmirror.com/-/binary/electron/';
process.env.ELECTRON_BUILDER_BINARIES_MIRROR ??=
  'https://registry.npmmirror.com/-/binary/electron-builder-binaries/';

let electronBuilder;
try {
  electronBuilder = await import('electron-builder');
} catch {
  console.error('✗ 找不到 electron-builder。先跑一次 `pnpm install`。');
  process.exit(1);
}

const { build, Platform, Arch } = electronBuilder;

console.log('[dist] electron-builder 打包中…（Electron 走 npmmirror 镜像）');

/*
 * 这几行不是调试残留，是**故意留着的**。
 *
 * 这个脚本曾经在"直接跑成功、经由 pnpm 跑失败"之间反复横跳，而两次的报错
 * 完全不同（一次是 argv 被塞了垃圾，一次是 Electron 自己的 asar 加载器报
 * "Invalid package"）。后者说明当时的 `node` 根本不是普通 Node ——
 * 而只要把 execPath 打出来，这件事一眼就能看出来。
 *
 * 排查环境相关的问题时，"到底跑的是哪个解释器"应该是第一眼就能看到的信息。
 */
console.log(
  `[dist] 解释器: ${process.execPath}` +
    `  electron=${process.versions.electron ?? '(无，是普通 node)'}` +
    `  argv=${JSON.stringify(process.argv.slice(1))}`,
);

/*
 * targets 在这里显式给出，而不是依赖 electron-builder.yml 里的 win.target。
 *
 * 编程接口下 `build()` 不会自己去读 yml 的 target 字段来构造 targets 映射 ——
 * 那是 CLI 的 configureBuildCommand 干的活。配置文件的其余部分
 * （appId、files、nsis 选项……）仍然会被自动读取，因为它们属于 packager 的配置。
 */
await build({
  projectDir: pkgRoot,
  targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
  // ⚠️ 显式 never：不带时 electron-builder 检测到 CI 环境变量会**自己上传**
  //    到 publish 配的地址。我们统一由 deploy.sh 上传，让它自己传会出现
  //    "两处都在传"，以及"本地构建时意外把半成品发布出去"。
  publish: 'never',
});

console.log('[dist] 完成。产物在 apps/desktop/release/');
