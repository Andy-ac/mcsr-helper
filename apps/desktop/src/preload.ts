import { contextBridge } from 'electron';

/**
 * preload —— renderer 与主进程之间唯一的通道。
 *
 * 现在只暴露只读信息。以后要加原生能力（例如"游戏旁悬浮窗"）时，
 * 在 **这里** 显式列出一个方法，并在主进程用 ipcMain.handle 实现它；
 * 绝不要打开 nodeIntegration，也绝不要把整个 ipcRenderer 暴露出去。
 */
contextBridge.exposeInMainWorld('mcsr', {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
