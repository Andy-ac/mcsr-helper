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
      '@mcsr/shared/seed': resolvePath('../../packages/shared/src/seed.ts'),
      '@mcsr/shared/i18n': resolvePath('../../packages/shared/src/i18n/index.ts'),
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
