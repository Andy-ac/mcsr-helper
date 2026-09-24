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

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import path2 from 'node:path';
import { SITE } from '@mcsr/shared';
import { app, BrowserWindow, ipcMain, screen, session, shell } from 'electron';
import { initFileUpdates } from './file-updates';
import {
  checkForUpdates,
  downloadUpdate,
  getLastStatus,
  initUpdater,
  installUpdate,
} from './updater';

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

/**
 * 未打包时把窗口状态存在系统临时目录里也无所谓，但用 userData 更干净 ——
 * 打包后会落到 %APPDATA%\MCSR Helper\ 下。
 */
function windowStateFile(): string {
  return path2.join(app.getPath('userData'), 'window-state.json');
}

interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized?: boolean;
}

const DEFAULT_STATE: WindowState = { width: 1280, height: 860 };

/**
 * 读回上次的窗口尺寸与位置。
 *
 * ⚠️ 必须校验坐标还在**当前**的屏幕范围内。
 *    用户上次把窗口放在副屏上，这次副屏拔了 —— 直接用存下来的 x/y
 *    会让窗口出现在一个不存在的位置上：进程在跑、任务栏有图标、
 *    但**窗口永远看不见**。而用户只会说"打不开"。
 *    这类 bug 在自己单屏的机器上永远复现不了。
 */
function loadWindowState(): WindowState {
  let saved: WindowState;
  try {
    saved = JSON.parse(readFileSync(windowStateFile(), 'utf8')) as WindowState;
  } catch {
    return DEFAULT_STATE;
  }
  if (!Number.isFinite(saved.width) || !Number.isFinite(saved.height)) return DEFAULT_STATE;

  const state: WindowState = {
    width: Math.max(900, Math.round(saved.width)),
    height: Math.max(600, Math.round(saved.height)),
    maximized: saved.maximized === true,
  };

  if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    const visible = screen.getAllDisplays().some((d) => {
      const b = d.workArea;
      // 要求窗口标题栏区域至少有一部分落在某个屏幕里
      return (
        saved.x! + state.width > b.x + 40 &&
        saved.x! < b.x + b.width - 40 &&
        saved.y! + 40 > b.y &&
        saved.y! < b.y + b.height - 40
      );
    });
    if (visible) {
      state.x = Math.round(saved.x!);
      state.y = Math.round(saved.y!);
    }
  }

  return state;
}

function saveWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  try {
    // 最大化时 getBounds 返回的是最大化后的尺寸 —— 存它的话，
    // 用户取消最大化之后就恢复不回原来的大小了。所以用 getNormalBounds。
    const b = win.getNormalBounds();
    writeFileSync(
      windowStateFile(),
      JSON.stringify(
        { width: b.width, height: b.height, x: b.x, y: b.y, maximized: win.isMaximized() },
        null,
        2,
      ),
      'utf8',
    );
  } catch {
    /* 存不下就算了，不值得为此报错 */
  }
}

/**
 * 权限请求：**默认全拒**。
 *
 * ---------------------------------------------------------------------------
 * 为什么必须有这个
 * ---------------------------------------------------------------------------
 * 渲染进程加载的是**远程网页**。在没有这个处理器时，页面里的任何脚本
 * （包括被 XSS 注入的）都可以申请摄像头、麦克风、屏幕共享、定位、通知 ——
 * 而 Electron 的默认行为在某些情况下是**允许**的。
 *
 * 服务端的 CSP 里有 Permissions-Policy 会拦掉一部分，但那是**网页层**的策略；
 * 这里是应用层，两道都要有。而且 CSP 是随页面下发的 ——
 * 万一它哪天被改错或漏掉，这一层还在。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 白名单只开两个，理由都是「不做就没法用」
 * ---------------------------------------------------------------------------
 *   · fullscreen  —— 视频嵌入要能全屏。M4 会大量用到。
 *   · clipboard-sanitized-write —— "复制种子值"这类按钮。
 *     sanitized 版本由浏览器负责把内容清理成纯文本，比原始 clipboard-write 安全。
 *
 * 其余一律拒绝。以后要加，就在下面显式加一条**并写清为什么** ——
 * 这个函数的价值就在于每一条允许都是有人做过决定的。
 */
function lockDownPermissions(): void {
  const ALLOWED = new Set(['fullscreen', 'clipboard-sanitized-write']);

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED.has(permission));
  });

  // 有些 API 走的是"检查"而不是"请求"（例如某些媒体设备枚举），
  // 只设请求处理器会漏掉它们。
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED.has(permission));
}

function createMainWindow() {
  const state = loadWindowState();
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x !== undefined ? { x: state.x, y: state.y } : {}),
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
  win.once('ready-to-show', () => {
    if (state.maximized) win.maximize();
    win.show();
  });

  /*
   * ⚠️ 在 'close' 里存，不是在 'closed' 里。
   *    'closed' 触发时窗口已经销毁，getNormalBounds() 拿不到东西了。
   */
  win.on('close', () => saveWindowState(win));

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

    // 权限白名单必须**在创建任何窗口之前**设好，
    // 否则第一个页面的权限请求会走到没有处理器的默认路径上。
    lockDownPermissions();

    // ------------------------------------------------------------------
    // 自动更新
    //
    // ⚠️ IPC 的注册必须在**创建窗口之前**完成。
    //    反过来的话存在一个窗口期：窗口已经能发消息了，而主进程还没在监听，
    //    那几条消息会被静默丢弃 —— 表现为"点检查更新没反应"，
    //    而且只在启动瞬间点才会复现。
    // ------------------------------------------------------------------
    await initUpdater({ isPackaged: app.isPackaged, version: app.getVersion() });

    // invoke：渲染进程主动拉当前状态（见 preload 里那段说明）
    ipcMain.handle('mcsr:update-get-status', () => getLastStatus());
    // send：单向触发，不需要返回值。三个都**不接受参数** ——
    // 渲染进程加载的是远程网页，任何参数都等于把攻击面递出去。
    ipcMain.on('mcsr:update-check', () => void checkForUpdates());
    ipcMain.on('mcsr:update-download', () => void downloadUpdate());
    ipcMain.on('mcsr:update-install', () => installUpdate());

    /*
     * 本地文件自动更新（八条 invoke + 一条推给页面的事件）。
     *
     * ⚠️ 与上面那三条更新 IPC 同一个理由：注册必须在**创建窗口之前**完成，
     *    否则存在一个"窗口已经能发消息、主进程还没在监听"的窗口期，
     *    而那几条消息会被静默丢弃 —— 表现为"点了没反应"，且只在启动瞬间点才会复现。
     *
     * ⚠️★ **启动检查也在这一个调用里**（`initFileUpdates` 内部按 `isPackaged` 自己决定跑不跑，
     *    并在跑的时候打一行日志）。这里**不要**再加第二处负责启动检查的调用：
     *    两处都负责会出现"启动检查两次"或"谁都没调"，而这两种都不报错 ——
     *    所以"什么时候检查"的判据走参数进去，不在这个文件里分两处写。
     */
    await initFileUpdates({
      isPackaged: app.isPackaged,
      appVersion: app.getVersion(),
      siteOrigin: new URL(APP_URL).origin,
    });

    mainWindow = createMainWindow();

    // 窗口出来之后再检查：此时渲染进程才可能订阅得上事件，
    // 而且不让网络请求和窗口渲染抢启动时间。
    if (app.isPackaged) {
      void checkForUpdates();

      /*
       * ⚠️ 还要**定期**再查。
       *
       * 只在启动时查一次的话，一个开着不关的应用永远不会知道有新版本 ——
       * 而这个应用恰恰是那种会一直开着的（速通玩家一边跑图一边看）。
       * 用户唯一的办法是重启，而他没有理由重启。
       *
       * 4 小时是个折中：一天最多多打 6 次请求（每次只拉几百字节的 latest.yml，
       * 不是安装包），而新版本最多晚 4 小时被发现 —— 对社区项目足够。
       */
      const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
      const timer = setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS);
      // unref：这个定时器不该阻止进程退出（关窗口要能干净地退出）
      timer.unref();

      app.on('before-quit', () => clearInterval(timer));
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    // v1 是普通窗口应用：关掉即退出（含 macOS），不做托盘常驻
    app.quit();
  });
}
