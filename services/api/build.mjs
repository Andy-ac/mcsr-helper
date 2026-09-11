import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

const root = path.dirname(fileURLToPath(import.meta.url));

// 先清空 dist：deploy.sh 会把整个 dist 目录打包上传，
// 任何残留文件（比如调试时重定向出来的 _out.log）都会跟着上生产。
rmSync(path.join(root, 'dist'), { recursive: true, force: true });

await esbuild.build({
  entryPoints: [path.join(root, 'src/index.ts')],
  outfile: path.join(root, 'dist/server.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  // 这几个不要打进去：原生模块与运行时依赖
  external: [],
  banner: { js: '// MCSR Helper API — bundled by esbuild' },
  logLevel: 'info',
});
