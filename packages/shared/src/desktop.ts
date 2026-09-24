/**
 * 桌面壳与网页之间的契约 —— **三边共用同一份定义**。
 *
 * 三边指：Electron 主进程（apps/desktop/src/main.ts）、
 * preload（apps/desktop/src/preload.ts）、以及网页端（apps/web）。
 *
 * 为什么放在 shared 而不是各写一份：网页端要在浏览器里正常运行，
 * 也要在 Electron 里显示更新提示，所以它必须能**静态判断**当前是不是桌面端。
 * 那个判断的键名（`window.mcsr`）以及更新状态的全部取值，
 * 如果三处各写一份，改一处漏一处的结果是"更新提示永远不出现"——
 * 而这种失效完全静默，没有任何报错。
 *
 * 2026-09-24：「本地文件自动更新」（下面的 `fileUpdates`）也走**这条**通道，
 * 不是另开一个注入点。理由与上面完全同型，而且失效面更大：
 * 它是**一组方法**，每个方法各自对应一条通道名（`mcsr:fileupdates-*`），
 * 三处各写一份的话，写错一个通道名或漏掉一个方法的表现同样是"点了没反应"，
 * 同样不报错 —— 而它比更新提示多一层风险：**它会写盘**。
 * ⇒ 契约留在这里、`preload.ts` 只做逐方法的转发，是为了让"主进程实现了什么"
 *   与"页面能调到什么"在类型层面**必须**一致，而不是靠两处人眼对齐。
 */
import type { FileUpdatesState } from './fileUpdates';

// ---------------------------------------------------------------------------
// 更新状态
// ---------------------------------------------------------------------------

/**
 * 自动更新的状态机。
 *
 * 刻意做成**显式的联合类型**而不是几个布尔（isChecking / isDownloading / ...）。
 * 布尔组合会产生无意义的状态（"正在检查 且 已就绪"），
 * 而界面必须为每一种组合决定怎么显示 —— 那正是更新提示容易出错的地方。
 */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  /** 发现了新版本，但**还没开始下载** —— 等用户确认 */
  | { state: 'available'; version: string }
  | {
      state: 'downloading';
      version: string;
      /** 0–100。服务端不给 Content-Length 时会是 null。 */
      percent: number | null;
      bytesPerSecond: number | null;
    }
  /** 下载完成，等用户点"重启并安装" */
  | { state: 'ready'; version: string }
  /** 已经是最新版本。check 之后短暂显示，然后回到 idle */
  | { state: 'none' }
  | { state: 'error'; message: string }
  /** 当前环境不支持自动更新（开发模式、或未打包） */
  | { state: 'unsupported' };

// ---------------------------------------------------------------------------
// preload 暴露给网页的 API
// ---------------------------------------------------------------------------

export interface DesktopBridge {
  /** 网页用它判断"我在 Electron 里" —— 唯一的判断依据 */
  readonly isDesktop: true;
  readonly platform: string;
  readonly versions: {
    electron: string;
    chrome: string;
    node: string;
  };
  readonly update: {
    /** 订阅状态变化，返回取消订阅的函数 */
    onStatus(callback: (status: UpdateStatus) => void): () => void;
    /**
     * 主动拉一次当前状态。
     *
     * 必须有这个：主进程在**启动时**就检查更新，而渲染进程要等远程网页加载完
     * 才能订阅。检查早于订阅时那次推送没人收到，更新提示于是永远不出现 ——
     * 表现为"明明有新版本却从不提示"，而且完全不报错。
     * 订阅之后立刻拉一次，功能就不再依赖两边的时序。
     */
    getStatus(): Promise<UpdateStatus>;
    /** 手动检查更新 */
    check(): void;
    /** 开始下载已发现的版本 */
    download(): void;
    /** 退出应用并安装已经下载好的版本 */
    install(): void;
  };

  /**
   * 本地文件自动更新。
   *
   * ⚠️★ **入参**纪律（读 `preload.ts` 文件头那一段再改这里）：
   *    渲染进程加载的是**远程网页**，所以这一组方法的**入参只有 id 与布尔**，
   *    **入参永远不含路径** —— 要选一个 .jar 或一个 mods 目录，只能由主进程
   *    弹自己的原生对话框去选（那个对话框是 **Task 4** 要写的，今天还没有）。
   *
   * ⚠️⚠️ 但**出参方向是反的，而且必须反**：`getState()` 的返回值与
   *    `onStatus` 推给页面的那份 `FileUpdatesState` 里**确实带着已绑定条目的绝对路径**
   *    （`FileItemView.binding.localPath` / `FileItemState.localPath`）——
   *    这份状态按 `fileUpdates.ts` 里的定义就是**页面唯一的数据来源**，
   *    路径是它的一部分（页面要靠它指出"正在更新的是哪个文件"）。
   *    ⇒ **入参不含路径 ≠ 这条通道不搬运路径**。被 XSS 的远程源既能读到这台机器上的
   *    mods 绝对路径（含用户名），也能按 id 触发写盘（但**指定不了写到哪**）。
   *    这是本期**有意接受**的代价（把路径从状态里拿掉就等于砍掉页面的一项能力），
   *    不是"没想过"：写在这里是为了下一次有人把它当缺陷时能看到这是一次决定。
   */
  readonly fileUpdates: {
    getState(): Promise<FileUpdatesState>;
    onStatus(callback: (state: FileUpdatesState) => void): () => void;
    /**
     * 弹**原生**对话框让用户选一个 .jar，并核对里面的 modId。
     * ⚠️ 这一句说的是**将要**实现的主进程那一半（Task 4 落地）—— 本文件只声明契约，
     *    今天 `apps/desktop/src/main.ts` 里还没有它。
     */
    bind(itemId: string): Promise<FileUpdatesState>;
    /**
     * 选一个 mods 目录，按 `fabric.mod.json` 的 id 自动匹配能对上的条目。
     * ⚠️ 同上：主进程那一半是 Task 4 的，今天还不存在。
     */
    bindFolder(): Promise<FileUpdatesState>;
    unbind(itemId: string): Promise<FileUpdatesState>;
    /** 只表示"启动时检查并高亮"；**写盘永远要一次点击** */
    setAutoUpdate(itemId: string, on: boolean): Promise<FileUpdatesState>;
    /** 只读检查（读本地版本 + 查 Modrinth + 比对），零写盘零下载 */
    check(force?: boolean): Promise<FileUpdatesState>;
    /** ★ 唯一会写盘的动作（下载 → 校验 → 替换），只在用户点击时调用 */
    update(itemId: string): Promise<FileUpdatesState>;
    updateAll(): Promise<FileUpdatesState>;
  };
}

/**
 * `fileUpdates` 那九条 IPC 通道名 —— **契约的一部分，所以住在契约旁边**。
 *
 * 为什么不做成各自的字符串字面量（preload 与主进程各写一遍）：
 *   通道名是**字符串**，写错一个字母类型检查看不见，而失败形态是静默的 ——
 *   `invoke` 没有 handler 时 reject（页面那一步什么也没发生）、
 *   `on` 对着一个不存在的通道名订阅（永远不触发）。这正是本文件开头警告的那一类失效。
 *   提到这里之后，preload 与主进程（Task 4）**引用同一个常量对象**，
 *   两边各自手写一遍从而漂移这件事就不可能发生（剩下的只有"两边都忘了注册"，
 *   那是另一个问题，且那种情况下两处指的是同一串、排障时一眼能对上）。
 *   代价：`packages/shared` 对桌面端来说**不再"只有类型"** —— preload 与主进程
 *   （Task 4 的 `file-updates.ts` 直接引用这个常量）都真的把这一份 `desktop.ts` 打进产物。
 *   可复跑的读数（先 `& "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/desktop build`，再现读文件）：
 *     `(Get-Item apps/desktop/dist/preload.cjs).Length` ⇒ 5412
 *     `(Get-Item apps/desktop/dist/main.cjs).Length` ⇒ 1438025
 *     `Select-String -Path apps/desktop/dist/preload.cjs -Pattern FILE_UPDATES_CHANNELS -AllMatches`
 *       ⇒ 命中（常量确实在产物里）
 *   ⚠️ 这里**故意没有再写**下面两句曾经写在这里的话：
 *     ① "preload.cjs 从 4.2kb 变 5.3kb" —— 那个 4.2kb 是**上一个提交**的产物，而 `build`
 *        每次都会 `rmSync(dist)` ⇒ 这条读数**不可复跑**；
 *     ② "未被引用的 `desktopBridge()` 被 tree-shake 掉了（产物里 0 次出现）" —— 这句
 *        **今天不成立**：现读 `Select-String -Path apps/desktop/dist/preload.cjs -Pattern
 *        desktopBridge -AllMatches` 命中 2 次。
 *     ⇒ 判据只留"一条命令能重现"的那种（代价：想知道省了多少字节，只能自己按上面的命令比）。
 *
 * 键名与 `DesktopBridge['fileUpdates']` 的方法名**逐一对应**（`satisfies` 那一条兜住
 * "契约加了方法却忘了加通道"）。
 */
export const FILE_UPDATES_CHANNELS = {
  getState: 'mcsr:fileupdates-get-state',
  /** 状态推送。**同一个串同时用于订阅与取消订阅**（散开写就会漏改一处）。 */
  onStatus: 'mcsr:fileupdates-status',
  bind: 'mcsr:fileupdates-bind',
  bindFolder: 'mcsr:fileupdates-bind-folder',
  unbind: 'mcsr:fileupdates-unbind',
  setAutoUpdate: 'mcsr:fileupdates-set-auto',
  check: 'mcsr:fileupdates-check',
  update: 'mcsr:fileupdates-update',
  updateAll: 'mcsr:fileupdates-update-all',
} as const satisfies Record<keyof DesktopBridge['fileUpdates'], string>;

declare global {
  interface Window {
    /**
     * ⚠️ 在浏览器里**不存在**，所以网页端必须先判断：
     *      `if (window.mcsr?.isDesktop) { ... }`
     *    直接读 `window.mcsr.update.xxx` 在浏览器里会抛 TypeError，
     *    而那个错误发生在渲染期，整页白屏。
     */
    mcsr?: DesktopBridge;
  }
}

/**
 * 网页端判断是否运行在桌面壳里的唯一入口。
 *
 * ⚠️ 用 globalThis 而不是 window。
 *    这个文件被**三边**共用：主进程、preload、网页。
 *    而主进程的 tsconfig 里没有 DOM lib（主进程也不该有 —— 它没有窗口），
 *    所以直接写 `window` 会让 apps/desktop 的 typecheck 报
 *    "Cannot find name 'window'"。
 *    用 globalThis 两边都成立，语义完全一样。
 */
export function desktopBridge(): DesktopBridge | null {
  const bridge = (globalThis as { mcsr?: DesktopBridge }).mcsr;
  return bridge?.isDesktop ? bridge : null;
}
