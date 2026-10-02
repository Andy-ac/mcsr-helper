import {
  type DesktopBridge,
  FILE_UPDATES_CHANNELS,
  MOD_FOLDERS_CHANNELS,
  type UpdateStatus,
} from '@mcsr/shared/desktop';
import type { FileUpdatesState } from '@mcsr/shared/fileUpdates';
import type { Channel, ModFoldersState } from '@mcsr/shared/modFolders';
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
 * 这也是为什么这里的更新这一族只能**读一次状态**（`getStatus`）、
 * 触发"检查 / 下载 / 安装"，而**不能传任意 URL 或路径** —— 它们没有参数。
 *
 * 2026-09-24 加了 `fileUpdates`（本地文件自动更新）。它是**第一组带参数**的能力，
 * 所以上面那条"它们没有参数"不再覆盖全部通道，必须把纪律写清楚：
 * **入参**只有 `itemId` 字符串与布尔（见下面那一组的 ⚠️★），**入参永远不含路径**。
 *
 * ⚠️⚠️ 但**别把"入参不含路径"读成"这条通道不搬运路径"** —— 方向正好是反的：
 *   · **读**（`getState` / `onStatus`）：交给页面的那份 `FileUpdatesState` 里，
 *     每一条都带着**已绑定条目的绝对路径**（`FileItemView.binding.localPath`、
 *     `FileItemState.localPath`，都定义在 `@mcsr/shared/fileUpdates`）
 *     ⇒ 一个被 XSS 的远程源**能读到这台机器上的 mods 绝对路径**（含用户名字段）。
 *   · **写**：只能按 id 触发**已绑定条目**的更新，**指定不了写到哪**
 *     （路径是主进程自己记下的），所以"写任意文件"做不到。
 *     代价是"选一个 .jar / 选一个 mods 目录"这类动作只能由主进程弹**原生**对话框完成、
 *     页面无法指定目标（那一半是 **Task 4** 落地，今天 `main.ts` 里还没有）。
 *
 * ⇒ **接受的风险（写在这里，免得被当成"没想过"）**：这份状态按 `fileUpdates.ts`
 *   里的定义就是**页面唯一的数据来源**，路径是它的一部分（页面要靠它指出"正在更新的
 *   是哪个文件"）⇒ 本期**有意接受**"被注入的源能看见这些路径与用户名"。
 *   这是**决定**，不是疏忽。下面那一组里那句"不接受路径 ≠ 参数可信"仍然成立：
 *   主进程那一侧要自己校验 `itemId` 在目录里存在。
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
   *    这一组每个方法的**入参**只有 `itemId` 字符串与布尔，**入参永远不含路径** ——
   *    `bind` / `bindFolder` 要选路径，但选路径的动作是**主进程弹的原生对话框**
   *    （⚠️ 那一半是 **Task 4** 实现，今天还不存在），
   *    返回值是"主进程自己记下的绑定"，而不是让页面递进来一个路径。
   *    ⇒ 结果：这一组**写不了任意文件**（该流程后半段要删旧 jar 再改名，
   *      所以能传路径才是真的危险）。主进程那一侧仍然要自己校验 `itemId`
   *      在目录里存在（不接受路径 ≠ 参数可信）。
   * ⚠️⚠️ 但**读**方向是另一回事：`getState` / `onStatus` 交出去的
   *    `FileUpdatesState` 里带着已绑定条目的绝对路径（含用户名） ⇒
   *    文件头那一段写清了这是**本期有意接受**的风险，不是遗漏。
   * 通道名一律取自 `FILE_UPDATES_CHANNELS`（`@mcsr/shared/desktop`）——
   *    字符串写错一个字母类型检查看不见，而失败形态是静默的（`invoke` reject /
   *    `on` 永不触发）；与主进程共用同一个常量对象，两边就不可能各写一份再漂移。
   */
  fileUpdates: {
    getState(): Promise<FileUpdatesState> {
      return ipcRenderer.invoke(FILE_UPDATES_CHANNELS.getState) as Promise<FileUpdatesState>;
    },
    onStatus(callback: (state: FileUpdatesState) => void): () => void {
      const listener = (_event: unknown, state: FileUpdatesState): void => callback(state);
      ipcRenderer.on(FILE_UPDATES_CHANNELS.onStatus, listener);
      return () => {
        ipcRenderer.off(FILE_UPDATES_CHANNELS.onStatus, listener);
      };
    },
    bind(itemId: string): Promise<FileUpdatesState> {
      return ipcRenderer.invoke(FILE_UPDATES_CHANNELS.bind, itemId) as Promise<FileUpdatesState>;
    },
    bindFolder(): Promise<FileUpdatesState> {
      return ipcRenderer.invoke(FILE_UPDATES_CHANNELS.bindFolder) as Promise<FileUpdatesState>;
    },
    unbind(itemId: string): Promise<FileUpdatesState> {
      return ipcRenderer.invoke(FILE_UPDATES_CHANNELS.unbind, itemId) as Promise<FileUpdatesState>;
    },
    setAutoUpdate(itemId: string, on: boolean): Promise<FileUpdatesState> {
      return ipcRenderer.invoke(
        FILE_UPDATES_CHANNELS.setAutoUpdate,
        itemId,
        on,
      ) as Promise<FileUpdatesState>;
    },
    check(force?: boolean): Promise<FileUpdatesState> {
      return ipcRenderer.invoke(
        FILE_UPDATES_CHANNELS.check,
        force === true,
      ) as Promise<FileUpdatesState>;
    },
    update(itemId: string): Promise<FileUpdatesState> {
      return ipcRenderer.invoke(FILE_UPDATES_CHANNELS.update, itemId) as Promise<FileUpdatesState>;
    },
    updateAll(): Promise<FileUpdatesState> {
      return ipcRenderer.invoke(FILE_UPDATES_CHANNELS.updateAll) as Promise<FileUpdatesState>;
    },
  },

  /*
   * ---------------------------------------------------------------------------
   * mod 目录行 + mod 文件夹（2026-10-02）
   * ---------------------------------------------------------------------------
   * 与上面那一组**同一条纪律**（显式逐个方法转发、通道名一律取自常量、
   * **入参不含路径**），这里只重复这一组特有的两条：
   *
   *   · `channel` 是 `'origin'` 或 `{ mirrorId }` 这样的 **id**，**不是 URL** ——
   *     页面指定不了主进程去哪儿取字节（地址由主进程拿目录里的 `mirrors[]` 拼）。
   *   · `releaseKey` 是页面**从它自己渲染的那一行**带回来的 key，主进程按它在目录里
   *     查 release。⇒ 这条通道能按 id 触发写盘，但**写哪里、下什么都不是页面说了算**。
   *
   * ⚠️ **读**方向与上面一组同样反过来：`getState` / `onStatus` 交出去的
   *    `ModFoldersState` 里带着已绑定文件夹的**绝对路径**（含用户名）—— 那是
   *    "页面唯一的数据来源"的一部分，本期**有意接受**（文件头那一段写着这条决定）。
   *
   * ⚠️ 主进程那一半（`ipcMain.handle` 的注册）是 **Task 4** 的，今天还不存在 ⇒
   *    此刻这几条 `invoke` 一律 reject（Electron 的 "No handler registered for
   *    'mcsr:modfolders-…'"）。这是"契约与转发先落地、行为随后"，**不是静默失败**：
   *    通道名与契约同源（上面那个常量），Task 4 接上之后这里一个字符都不用改。
   */
  modFolders: {
    getState(): Promise<ModFoldersState> {
      return ipcRenderer.invoke(MOD_FOLDERS_CHANNELS.getState) as Promise<ModFoldersState>;
    },
    onStatus(callback: (state: ModFoldersState) => void): () => void {
      const listener = (_event: unknown, state: ModFoldersState): void => callback(state);
      ipcRenderer.on(MOD_FOLDERS_CHANNELS.onStatus, listener);
      return () => {
        ipcRenderer.off(MOD_FOLDERS_CHANNELS.onStatus, listener);
      };
    },
    bindFolder(): Promise<ModFoldersState> {
      return ipcRenderer.invoke(MOD_FOLDERS_CHANNELS.bindFolder) as Promise<ModFoldersState>;
    },
    unbindFolder(folderId: string): Promise<ModFoldersState> {
      return ipcRenderer.invoke(
        MOD_FOLDERS_CHANNELS.unbindFolder,
        folderId,
      ) as Promise<ModFoldersState>;
    },
    rescan(folderId?: string): Promise<ModFoldersState> {
      return ipcRenderer.invoke(MOD_FOLDERS_CHANNELS.rescan, folderId) as Promise<ModFoldersState>;
    },
    setFolderGameVersion(folderId: string, gameVersion: string | null): Promise<ModFoldersState> {
      return ipcRenderer.invoke(
        MOD_FOLDERS_CHANNELS.setFolderGameVersion,
        folderId,
        gameVersion,
      ) as Promise<ModFoldersState>;
    },
    setFolderAutoUpdate(folderId: string, on: boolean): Promise<ModFoldersState> {
      return ipcRenderer.invoke(
        MOD_FOLDERS_CHANNELS.setFolderAutoUpdate,
        folderId,
        on,
      ) as Promise<ModFoldersState>;
    },
    setBulkChannel(channel: Channel): Promise<ModFoldersState> {
      return ipcRenderer.invoke(
        MOD_FOLDERS_CHANNELS.setBulkChannel,
        channel,
      ) as Promise<ModFoldersState>;
    },
    updateMod(
      folderId: string,
      modid: string,
      releaseKey: string,
      channel: Channel,
    ): Promise<ModFoldersState> {
      return ipcRenderer.invoke(
        MOD_FOLDERS_CHANNELS.updateMod,
        folderId,
        modid,
        releaseKey,
        channel,
      ) as Promise<ModFoldersState>;
    },
    updateCatalogRow(
      rowId: string,
      releaseKey: string,
      channel: Channel,
    ): Promise<ModFoldersState> {
      return ipcRenderer.invoke(
        MOD_FOLDERS_CHANNELS.updateCatalogRow,
        rowId,
        releaseKey,
        channel,
      ) as Promise<ModFoldersState>;
    },
    updateFolderAll(folderId: string, channel: Channel): Promise<ModFoldersState> {
      return ipcRenderer.invoke(
        MOD_FOLDERS_CHANNELS.updateFolderAll,
        folderId,
        channel,
      ) as Promise<ModFoldersState>;
    },
    downloadMissing(
      modid: string,
      gameVersion: string,
      folderId: string,
      channel: Channel,
    ): Promise<ModFoldersState> {
      return ipcRenderer.invoke(
        MOD_FOLDERS_CHANNELS.downloadMissing,
        modid,
        gameVersion,
        folderId,
        channel,
      ) as Promise<ModFoldersState>;
    },
    setCatalogGameVersion(gameVersion: string): Promise<ModFoldersState> {
      return ipcRenderer.invoke(
        MOD_FOLDERS_CHANNELS.setCatalogGameVersion,
        gameVersion,
      ) as Promise<ModFoldersState>;
    },
    setTagFilter(tags: readonly string[]): Promise<ModFoldersState> {
      return ipcRenderer.invoke(
        MOD_FOLDERS_CHANNELS.setTagFilter,
        tags,
      ) as Promise<ModFoldersState>;
    },
  },
};

contextBridge.exposeInMainWorld('mcsr', bridge);
