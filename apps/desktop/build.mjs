/**
 * 用 esbuild 打包 Electron 主进程与 preload。
 *
 * 刻意不使用 vite-plugin-electron 之类的插件：那会引入一个额外的构建层，
 * 出问题时很难判断是插件还是自己的配置。这里就是一条 esbuild 命令。
 *
 * 输出 CJS 而不是 ESM：Electron 的 preload 在 sandbox: true 下必须是 CJS。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  outdir,
  outExtension: { '.js': '.cjs' },
  // electron 由运行时提供，绝不能打进 bundle
  external: ['electron'],
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  logLevel: 'info',
};

const entries = {
  entryPoints: [path.join(root, 'src/main.ts'), path.join(root, 'src/preload.ts')],
};

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

let electronProc = null;

function startElectron() {
  if (electronProc) {
    electronProc.kill();
    electronProc = null;
  }
  const electronBin = path.join(
    root,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'electron.cmd' : 'electron',
  );
  electronProc = spawn(electronBin, ['.'], {
    cwd: root,
    stdio: 'inherit',
    // 让 Electron 在主进程里也走开发分支
    env: { ...process.env, MCSR_DEV: '1' },
    shell: process.platform === 'win32',
  });
  electronProc.on('exit', (code) => {
    if (watch) process.exit(code ?? 0);
  });
}

if (watch) {
  const ctx = await esbuild.context({
    ...common,
    ...entries,
    plugins: [
      {
        name: 'restart-electron',
        setup(build) {
          let first = true;
          build.onEnd((result) => {
            if (result.errors.length > 0) {
              console.error('[build] failed, not restarting electron');
              return;
            }
            console.log('[build] ok -> restarting electron');
            if (first) {
              first = false;
              startElectron();
            } else {
              startElectron();
            }
          });
        },
      },
    ],
  });
  await ctx.watch();
  console.log('[build] watching src/ ...');
} else {
  await esbuild.build({ ...common, ...entries });
  console.log('[build] done');
}
