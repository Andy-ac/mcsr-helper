import path from 'node:path';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.dirname(fileURLToPath(import.meta.url));

// 先清空 dist：deploy.sh 会把整个 dist 目录打包上传，
// 任何残留文件（比如调试时重定向出来的 _out.log）都会跟着上生产。
rmSync(path.join(root, 'dist'), { recursive: true, force: true });

/**
 * 两个入口：
 *   server  —— 常驻的 HTTP 服务
 *   import  —— 内容导入脚本，部署后在服务器上跑一次
 *
 * 导入脚本要单独打包，是因为**数据库只存在于服务器上**。
 * 早先的做法是把本地的 .db 文件一起传上去 —— M1 阶段能用（内容全部来自
 * content/resources.json，库是派生数据），但 M2 之后库里会有用户数据，
 * 覆盖就等于删库。所以从 M1 起就走"服务器上执行导入"这条路，
 * 数据库永远不离开服务器。
 */
await esbuild.build({
  entryPoints: {
    server: path.join(root, 'src/index.ts'),
    import: path.join(root, 'src/import.ts'),
  },
  outdir: path.join(root, 'dist'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  banner: { js: '// MCSR Helper API — bundled by esbuild' },
  logLevel: 'info',
});
