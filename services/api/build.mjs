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
    // 身份组管理命令行。单独打包的理由和 import 一样：它要在服务器上跑，
    // 而服务器上既没有 src/ 也没有 tsx。
    // 为什么需要一条不走 HTTP 的路，见 src/admin-cli.ts 的文件头。
    admin: path.join(root, 'src/admin-cli.ts'),
    // 视频追踪的一次同步。同样是"在服务器上跑、不经 HTTP"，但**不是给人敲的**：
    // 它由 systemd timer 每 10 分钟拉起一次（deploy/mcsr-helper-track.{service,timer}），
    // 所以它必须是一个能独立启动的入口。为什么是 CLI 而不是长驻 worker / HTTP 里的
    // 后台任务，见 src/track.ts 的文件头第一节（spec §3.1）。
    // ⚠️ 它不需要在 deploy.sh 里登记：deploy 把**整个 dist/** 打成 api.tgz 上传
    //    （`tar -czf api.tgz -C services/api/dist .`），所以这一行加完，
    //    dist/track.js 就自动跟着上线了。
    track: path.join(root, 'src/track.ts'),
    // Ranked 实时信息里那些 twitch 直播链接的收录。与 track 同一个形状的第三条路：
    // 也是"在服务器上跑、不经 HTTP"，但它**比 track 更窄** —— 一轮只有一次 GET、
    // 一次写库，然后打**一行**摘要就退。它由 systemd 每 5 分钟拉起一次
    // （deploy/mcsr-helper-ranked-streams.{service,timer}），所以同样必须能独立启动。
    // 为什么不是 HTTP 请求路径（上一版的做法）、也不是长驻 worker，见
    // src/ranked-streams.ts 的文件头第一节。
    // ⚠️ 与 track 一样**不用改 deploy.sh 的产物清单**（整个 dist/ 都会上传），
    //    要改的是那一份 scp/install 的**单元文件**列表（见 deploy/deploy.sh）。
    'ranked-streams': path.join(root, 'src/ranked-streams.ts'),
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
