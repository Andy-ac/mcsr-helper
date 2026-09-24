import type { DesktopBridge, UpdateStatus } from '@mcsr/shared/desktop';
import type { FileUpdatesState } from '@mcsr/shared/fileUpdates';
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
 * 这也是为什么这里的更新通道只能触发"检查 / 下载 / 安装"，
 * 而不能传任意 URL 或路径 —— 它们没有参数。
 *
 * 2026-09-24 加了 `fileUpdates`（本地文件自动更新）。它是**第一组带参数**的能力，
 * 所以上面那条"它们没有参数"不再覆盖全部通道，必须把纪律写清楚：
 * 参数**只有 `itemId` 字符串与布尔**（见下面那一组的 ⚠️★），
 * **永远不接受路径**。代价是"选目录"这类动作只能由主进程弹原生对话框完成、
 * 页面无法指定目标；换来的是这条通道即使被 XSS 全部拿到，
 * 攻击者能做的也只是"在用户自己的 mods 目录里更新目录里已存在的条目"。
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

  /*
   * ---------------------------------------------------------------------------
   * 本地文件自动更新（2026-09-24）
   * ---------------------------------------------------------------------------
   * 这一组**逐个方法显式转发**，不做 `Object.fromEntries([...])` 那样的循环 ——
   * 循环会让"页面能调到的方法"变成运行时的字符串数组，
   * 于是 `DesktopBridge` 里多一个、这里漏一个时**类型检查看不见**
   * （桥对象的键是运行时才有的），症状又是"点了没反应"且不报错。
   * 显式写出来，漏一个就红在 `bridge: DesktopBridge` 这一行上。
   *
   * ⚠️★ 参数纪律（上面那段安全约定的具体化，改之前先读它）：
   *    这一组每个方法的参数**只有 `itemId` 字符串与布尔**，**永远不接受路径** ——
   *    `bind` / `bindFolder` 要选路径，但选路径的动作发生在**主进程弹的原生对话框**里，
   *    返回值是"主进程自己记下的绑定"，而不是让页面递进来一个路径。
   *    理由就是上面那一条：渲染进程加载的是**远程网页**，网页那边一旦有 XSS，
   *    能传路径就等于允许"更新流程去写任意文件"（该流程后半段要删旧 jar 再改名）。
   *    主进程那一侧仍然要自己校验 `itemId` 在目录里存在（不接受参数不等于参数可信）。
   */
  fileUpdates: {
    getState(): Promise<FileUpdatesState> {
      return ipcRenderer.invoke('mcsr:fileupdates-get-state') as Promise<FileUpdatesState>;
    },
    onStatus(callback: (state: FileUpdatesState) => void): () => void {
      const listener = (_event: unknown, state: FileUpdatesState): void => callback(state);
      ipcRenderer.on('mcsr:fileupdates-status', listener);
      return () => {
        ipcRenderer.off('mcsr:fileupdates-status', listener);
      };
    },
    bind(itemId: string): Promise<FileUpdatesState> {
      return ipcRenderer.invoke('mcsr:fileupdates-bind', itemId) as Promise<FileUpdatesState>;
    },
    bindFolder(): Promise<FileUpdatesState> {
      return ipcRenderer.invoke('mcsr:fileupdates-bind-folder') as Promise<FileUpdatesState>;
    },
    unbind(itemId: string): Promise<FileUpdatesState> {
      return ipcRenderer.invoke('mcsr:fileupdates-unbind', itemId) as Promise<FileUpdatesState>;
    },
    setAutoUpdate(itemId: string, on: boolean): Promise<FileUpdatesState> {
      return ipcRenderer.invoke(
        'mcsr:fileupdates-set-auto',
        itemId,
        on,
      ) as Promise<FileUpdatesState>;
    },
    check(force?: boolean): Promise<FileUpdatesState> {
      return ipcRenderer.invoke(
        'mcsr:fileupdates-check',
        force === true,
      ) as Promise<FileUpdatesState>;
    },
    update(itemId: string): Promise<FileUpdatesState> {
      return ipcRenderer.invoke('mcsr:fileupdates-update', itemId) as Promise<FileUpdatesState>;
    },
    updateAll(): Promise<FileUpdatesState> {
      return ipcRenderer.invoke('mcsr:fileupdates-update-all') as Promise<FileUpdatesState>;
    },
  },
};

contextBridge.exposeInMainWorld('mcsr', bridge);
