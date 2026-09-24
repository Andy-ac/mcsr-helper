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
   * ⚠️★ 参数纪律（读 `preload.ts` 文件头那一段再改这里）：
   *    渲染进程加载的是**远程网页**，所以这里**只有 id 与布尔**，
   *    **永远不接受路径** —— 路径只存在于主进程自己的状态文件里。
   */
  readonly fileUpdates: {
    getState(): Promise<FileUpdatesState>;
    onStatus(callback: (state: FileUpdatesState) => void): () => void;
    /** 弹**原生**对话框让用户选一个 .jar；主进程会核对里面的 modId */
    bind(itemId: string): Promise<FileUpdatesState>;
    /** 选一个 mods 目录，按 fabric.mod.json 的 id 自动匹配能对上的条目 */
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
