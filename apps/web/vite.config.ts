import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const resolvePath = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** 开发时后端 API 的地址（services/api）。生产环境由 Caddy 直接路由 /api。 */
const API_TARGET = process.env.API_TARGET ?? 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react()],

  // 工作区内的包直接以源码形式引用，省掉构建步骤与 watch 失效问题
  resolve: {
    alias: {
      // ⚠️ Vite 的 alias 是**前缀替换**，不是精确匹配。
      //    所以 `@mcsr/shared` 这条会把 `@mcsr/shared/resources` 也吃掉，
      //    拼成 `.../src/index.ts/resources` —— 报错信息是
      //    "Could not load ../../packages/shared/src/index.ts/resources"，
      //    看起来像路径写错，实际是别名顺序问题。
      //    **子路径必须排在裸包名前面**，新增子路径导出时要记得在这里补一条。
      //
      // ⚠️ 同理，**长的子路径要排在短的子路径前面**：
      //    `@mcsr/shared/calendar` 会把 `@mcsr/shared/calendar-time`
      //    拼成 `.../calendar.ts-time`（os error 3）。
      //    2026-09 M4 加日历时踩到了这一条 —— 注意它和上面那条**不是**同一件事，
      //    一条是"裸包名吃掉子路径"，一条是"子路径吃掉更长的子路径"。
      '@mcsr/shared/calendar-time': resolvePath('../../packages/shared/src/calendar-time.ts'),
      '@mcsr/shared/calendar': resolvePath('../../packages/shared/src/calendar.ts'),
      '@mcsr/shared/videos': resolvePath('../../packages/shared/src/videos.ts'),
      /*
       * ⚠️ 这一条是「直播」板块加的（2026-09-13）。**别删** ——
       *    没有它，`import { liveEmbedUrl } from '@mcsr/shared/live'` 会被
       *    上面那条裸包名 `'@mcsr/shared'` 吃掉，拼成
       *    `.../src/index.ts/live`，报 `Could not load .../index.ts/live`。
       *
       * ⚠️ 而它**只有在真的 import 了值时才会暴露**：
       *    `api.ts` 里那几条是 `import type`，编译期就被擦掉了，
       *    所以"加了这个子路径但没加别名"在类型检查里是看不出来的 ——
       *    要跑到 `vite build` / dev server 才炸。
       */
      '@mcsr/shared/live': resolvePath('../../packages/shared/src/live.ts'),
      '@mcsr/shared/seed': resolvePath('../../packages/shared/src/seed.ts'),
      '@mcsr/shared/i18n': resolvePath('../../packages/shared/src/i18n/index.ts'),
      '@mcsr/shared/resources': resolvePath('../../packages/shared/src/resources.ts'),
      '@mcsr/shared/auth': resolvePath('../../packages/shared/src/auth.ts'),
      '@mcsr/shared/permissions': resolvePath('../../packages/shared/src/permissions.ts'),
      '@mcsr/shared/desktop': resolvePath('../../packages/shared/src/desktop.ts'),
      '@mcsr/shared/review': resolvePath('../../packages/shared/src/review.ts'),
      '@mcsr/shared': resolvePath('../../packages/shared/src/index.ts'),
      '@mcsr/ui': resolvePath('../../packages/ui/src/index.ts'),
      '@': resolvePath('./src'),
    },
  },

  server: {
    port: 5173,
    strictPort: true, // Electron dev 里写死了 5173，端口漂移会导致白屏
    // 允许访问仓库根目录下的 packages/*
    fs: { allow: [resolvePath('../..')] },
    watch: {
      /*
       * ⚠️⚠️ 别删这行 —— 它是被一个反复出现的崩溃逼出来的。
       *
       * 症状：dev server 时不时整个进程退出，报
       *   EBUSY: resource busy or locked, watch '...\.Foo.tsx.<pid>.<uuid>.tmpdir\Foo.tsx.tmp'
       * 而报错的那个路径**不是**我们的文件，是一个临时目录。
       *
       * 真因（2026-09-13 查明）：**写文件的那一方用"临时文件 + 改名"落盘**
       * （原子写），而 Vite 的 watcher 恰好打开了那个临时路径，
       * 改名时被锁住 → 未捕获的 watcher 错误直接终止进程。
       *
       * 之前一直归因于 `pnpm format`（biome 也是原子写，见 docs/pending.md 5.7），
       * 但真正每次都出现的是 **DSH 自己的文件写入**：那些临时目录的名字里
       * 带着 **DSH Desktop 进程的 PID**（比如 pid 16492 就是 GUI 自己）。
       * 也就是说：**只要 AI 在改 `apps/web/src` 下的文件，dev server 就可能被搞崩** ——
       * 而"边改边看"恰恰是最正常的工作方式。
       *
       * 修法：让 watcher 根本不看这些临时目录。它们是瞬时产物、永远不是源码，
       * 忽略掉没有任何代价；不忽略就等于把开发流程交给一个竞态。
       */
      ignored: ['**/*.tmpdir', '**/*.tmpdir/**'],
    },
    proxy: {
      // 前端始终请求相对路径 /api/*，开发时由 Vite 转发，生产时由 Caddy 转发。
      // 这样 Electron 无论加载 localhost:5173 还是线上域名，代码都不用改。
      '/api': {
        target: API_TARGET,
        changeOrigin: false,
      },
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'chrome130', // Electron 44 内置的 Chromium 远新于此
  },

  optimizeDeps: {
    exclude: ['@mcsr/shared', '@mcsr/ui'],
  },
});
