import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as esbuild from 'esbuild';

const root = path.dirname(fileURLToPath(import.meta.url));

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
