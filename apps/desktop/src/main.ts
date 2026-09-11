/**
 * Electron 主进程。
 *
 * 加载策略（见 docs/v1-plan.md §1）：
 *   开发环境 → http://localhost:5173        （Vite dev server）
 *   生产环境 → https://<你的域名>            （线上 Web 应用）
 *
 * **生产环境刻意不打包前端产物**，原因有三条硬约束：
 *   1. YouTube 的 ToS 要求嵌入客户端通过 HTTP Referer 头标识自己，
 *      从 file:// 或自定义 scheme 加载必然缺失 Referer，会触发 "Error 153"。
 *      从真实 https 域名加载则天然满足。
 *   2. Twitch 的 parent 参数按域名校验，且要求 SSL。
 *   3. UI 改动不需要重新发版。
 *
 * 代价：必须联网。v1 明确接受。
 */
import path from 'node:path';
import { SITE } from '@mcsr/shared';
import { app, BrowserWindow, shell } from 'electron';

const isDev = !app.isPackaged;
const APP_URL = isDev
  ? (process.env.VITE_DEV_SERVER_URL ?? SITE.devServerOrigin)
  : SITE.productionOrigin;

const ALLOWED_ORIGIN = new URL(APP_URL).origin;

let mainWindow: BrowserWindow | null = null;

/** 开发时 Vite 可能还没起来，重试几次而不是直接白屏。 */
async function loadWithRetry(win: BrowserWindow, url: string, attempts = 30) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      await win.loadURL(url);
      return;
    } catch (error) {
      if (i === attempts - 1) {
        console.error('[main] 无法加载', url, error);
        win.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(
            `<body style="font:14px system-ui;background:#1b1d24;color:#e8eaef;padding:40px">
               <h2>无法加载 ${url}</h2>
               <p>开发模式下请先确认 Vite dev server 已启动：<code>pnpm dev:web</code></p>
             </body>`,
          )}`,
        );
        return;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#1b1d24',
    title: SITE.name,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // ---- 安全基线：这四条不要为了图方便改掉 ----
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // ------------------------------------------
      spellcheck: false,
    },
  });

  // 首帧渲染完成后再显示，避免启动白闪
  win.once('ready-to-show', () => win.show());

  // 站外链接一律交给系统浏览器打开。
  // 这不只是体验问题：以后接第三方 OAuth 登录时，
  // 授权页必须在系统浏览器里完成，不能在应用内嵌窗口里做。
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // 阻止窗口被导航到非本站来源（防钓鱼 / 防被嵌入内容劫持）
  win.webContents.on('will-navigate', (event, url) => {
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      event.preventDefault();
      return;
    }
    if (origin !== ALLOWED_ORIGIN) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  void loadWithRetry(win, APP_URL);
  return win;
}

// 单实例：第二次启动时聚焦已有窗口，而不是开两个
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // Windows 通知与任务栏归组需要它
    app.setAppUserModelId('com.mcsr.helper');

    if (!isDev) {
      // M3 才启用自动更新；此时没有发布通道，静默跳过而不是报错
      try {
        const { autoUpdater } = await import('electron-updater');
        autoUpdater.autoDownload = true;
        autoUpdater.checkForUpdatesAndNotify().catch(() => {});
      } catch {
        /* 未配置发布源时忽略 */
      }
    }

    mainWindow = createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    // v1 是普通窗口应用：关掉即退出（含 macOS），不做托盘常驻
    app.quit();
  });
}
