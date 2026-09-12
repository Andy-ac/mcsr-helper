import type { DesktopBridge, UpdateStatus } from '@mcsr/shared/desktop';
import { contextBridge, ipcRenderer } from 'electron';

/**
 * preload —— renderer 与主进程之间**唯一**的通道。
 *
 * ---------------------------------------------------------------------------
 * 安全约定（改这个文件之前先读这一段）
 * ---------------------------------------------------------------------------
 * 这个项目的 webPreferences 是 `contextIsolation: true` + `sandbox: true` +
 * `nodeIntegration: false`。也就是说渲染进程里没有 Node、没有 require、
 * 也拿不到主进程的对象 —— 它只能看到这个文件**显式暴露**的东西。
 *
 * 所以：
 *   · **绝不要** `exposeInMainWorld('ipcRenderer', ipcRenderer)`。
 *     那等于把整个 IPC 通道交给页面里的任何脚本，包括被注入的脚本。
 *   · 每加一个能力，就在这里写一个**具体的方法**，并在主进程用 ipcMain 实现它。
 *     参数要自己校验 —— 渲染进程传来的东西一律当作不可信。
 *
 * 现在的渲染进程加载的是**远程网页**（https://mcsrhelper.com），
 * 不是打包在应用里的本地页面。这放大了上面每一条的重要性：
 * 网页那边一旦有 XSS，攻击者拿到的是这个通道能做的全部事情。
 * 这也是为什么这里暴露的三个更新方法都只能触发"检查 / 下载 / 安装"，
 * 而不能传任意 URL 或路径 —— 它们没有参数。
 */
const bridge: DesktopBridge = {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  update: {
    onStatus(callback: (status: UpdateStatus) => void): () => void {
      const listener = (_event: unknown, status: UpdateStatus): void => {
        callback(status);
      };
      ipcRenderer.on('mcsr:update-status', listener);
      return () => {
        ipcRenderer.off('mcsr:update-status', listener);
      };
    },

    /*
     * ⚠️ 主动拉一次当前状态。
     *
     * 这不是冗余：主进程在**启动时**就开始检查更新，而渲染进程要等
     * 远程网页加载完才能订阅事件。如果检查在网页加载完之前就发现了新版本，
     * 那次推送没有任何人收到 —— 更新提示于是永远不会出现，
     * 而用户看到的是一个"明明有新版本却从不提示"的应用。
     *
     * 所以订阅之后必须立刻拉一次，两边的时序才不会决定功能是否可用。
     */
    getStatus(): Promise<UpdateStatus> {
      return ipcRenderer.invoke('mcsr:update-get-status') as Promise<UpdateStatus>;
    },

    check(): void {
      ipcRenderer.send('mcsr:update-check');
    },
    download(): void {
      ipcRenderer.send('mcsr:update-download');
    },
    install(): void {
      ipcRenderer.send('mcsr:update-install');
    },
  },
};

contextBridge.exposeInMainWorld('mcsr', bridge);
