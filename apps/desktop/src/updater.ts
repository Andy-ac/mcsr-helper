/**
 * 自动更新。
 *
 * ---------------------------------------------------------------------------
 * 为什么是"先问再下"，不是默认的自动下载
 * ---------------------------------------------------------------------------
 * electron-updater 默认 `autoDownload = true` —— 发现新版本就直接开始下载。
 * 在这个项目里那是错的：安装包约 100MB，而目前的更新源是自己的香港 VPS，
 * 大陆用户拉这个体积可能要几分钟甚至更久。
 *
 * 在用户完全不知情的情况下占用他几分钟的带宽，是那种"功能是对的、
 * 但体验很糟"的做法。而且他没有拒绝的机会 —— 想拒绝只能关掉应用。
 *
 * 所以这里改成：
 *   检查 → 发现了就问「发现新版本，是否下载？」→ 同意才下（带进度）→ 下好再问「重启并安装？」
 * 多两次点击，换来的是用户始终知道发生了什么。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 更新源地址是打包进应用里的
 * ---------------------------------------------------------------------------
 * electron-updater 从应用内的 app-update.yml 读地址（由 electron-builder 生成，
 * 内容来自 electron-builder.yml 的 publish.url）。
 * 这意味着**换更新源必须发一个新版本**，而旧版本会一直用旧地址
 * ——直到它成功更新到那个新版本为止。换源要趁早，越晚换，卡在旧源上的用户越多。
 */

import type { UpdateStatus } from '@mcsr/shared/desktop';
import { BrowserWindow } from 'electron';

/** electron-updater 的类型没有随包导出得很好，这里只声明用到的那几个成员。 */
interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  logger: unknown;
  on(event: string, listener: (...args: never[]) => void): void;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

let updater: UpdaterLike | null = null;
let currentVersion = '';
let pendingVersion: string | null = null;

/**
 * 最近一次的状态。
 *
 * ⚠️ 必须留住它。主进程在**启动时**就开始检查更新，而渲染进程要等远程网页
 *    加载完才能订阅事件 —— 检查早于订阅时那次推送没有任何人收到。
 *    渲染进程订阅之后会主动 invoke 一次把这个值拿走，功能就不再依赖时序。
 */
let lastStatus: UpdateStatus = { state: 'idle' };

/** 给 IPC 用的只读访问。 */
export function getLastStatus(): UpdateStatus {
  return lastStatus;
}

function report(status: UpdateStatus): void {
  lastStatus = status;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('mcsr:update-status', status);
  }
}

/**
 * 初始化。**在未打包时直接返回 unsupported**，不抛异常。
 *
 * 开发模式下没有 app-update.yml，"检查更新"必然失败 ——
 * 让它失败并显示一个红色错误，只会让每次本地调试都看到一条假警报，
 * 然后所有人就开始无视更新提示了。
 */
export async function initUpdater(options: {
  isPackaged: boolean;
  version: string;
}): Promise<void> {
  currentVersion = options.version;

  if (!options.isPackaged) {
    report({ state: 'unsupported' });
    return;
  }

  let mod: { autoUpdater?: UpdaterLike };
  try {
    mod = (await import('electron-updater')) as { autoUpdater?: UpdaterLike };
  } catch (error) {
    report({ state: 'error', message: `更新模块加载失败：${String(error)}` });
    return;
  }

  const autoUpdater = mod.autoUpdater;
  if (!autoUpdater) {
    report({ state: 'error', message: '更新模块不完整' });
    return;
  }
  updater = autoUpdater;

  // 见文件头：不自动下载，先问。
  autoUpdater.autoDownload = false;
  // ⚠️ 这个保持 true：用户点"稍后"然后正常关掉应用时，已经下好的更新应该装上。
  //    设成 false 的话，用户下了 100MB，关掉应用，下次打开还是旧版本 ——
  //    他会认为更新功能坏了。
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => report({ state: 'checking' }));

  autoUpdater.on('update-available', (...args: never[]) => {
    const info = args[0] as { version?: string } | undefined;
    pendingVersion = info?.version ?? '未知版本';
    report({ state: 'available', version: pendingVersion });
  });

  autoUpdater.on('update-not-available', () => report({ state: 'none' }));

  autoUpdater.on('download-progress', (...args: never[]) => {
    const p = args[0] as { percent?: number; bytesPerSecond?: number } | undefined;
    report({
      state: 'downloading',
      version: pendingVersion ?? currentVersion,
      // 源站没给 Content-Length 时 percent 会是 NaN —— 统一成 null，
      // 让界面显示"正在下载…"而不是"NaN%"
      percent: Number.isFinite(p?.percent) ? (p?.percent ?? null) : null,
      bytesPerSecond: Number.isFinite(p?.bytesPerSecond) ? (p?.bytesPerSecond ?? null) : null,
    });
  });

  autoUpdater.on('update-downloaded', (...args: never[]) => {
    const info = args[0] as { version?: string } | undefined;
    report({ state: 'ready', version: info?.version ?? pendingVersion ?? currentVersion });
  });

  autoUpdater.on('error', (...args: never[]) => {
    const err = args[0] as Error | undefined;
    /*
     * ⚠️ 这里的 message 会直接显示给用户，所以不能把原始堆栈扔出去。
     *    但也不能吞掉 —— network 类错误（断网、源站 502）是用户唯一能
     *    自己处理的一类，把它说清楚比说"更新失败"有用得多。
     */
    const raw = err?.message ?? '未知错误';
    const friendly = /net::|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|404|502|503/i.test(raw)
      ? '网络不通或更新源暂时不可用'
      : raw.slice(0, 200);
    report({ state: 'error', message: friendly });
  });
}

/** 手动检查。用户点"检查更新"时调用。 */
export async function checkForUpdates(): Promise<void> {
  if (!updater) {
    report({ state: 'unsupported' });
    return;
  }
  try {
    await updater.checkForUpdates();
  } catch (error) {
    report({ state: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}

/** 用户同意后开始下载。 */
export async function downloadUpdate(): Promise<void> {
  if (!updater) return;
  try {
    await updater.downloadUpdate();
  } catch (error) {
    report({ state: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}

/** 退出并安装。 */
export function installUpdate(): void {
  if (!updater) return;
  // isSilent=false 让 NSIS 安装界面正常显示；
  // isForceRunAfter=true 装完自动把应用启动回来 —— 用户点的是"重启并安装"，
  // 装完之后应用没起来会让人以为它挂了。
  updater.quitAndInstall(false, true);
}
