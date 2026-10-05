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
import type { Channel, ModFoldersState } from './modFolders';

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

  /**
   * mod 目录行 + mod 文件夹（2026-10-02）。
   *
   * ⚠️★ **入参**纪律（与上面 `fileUpdates` 那一段**同一条**，理由也全在那里）：
   *    渲染进程加载的是**远程网页**，所以这一组方法的入参只有 **id、游戏版本字符串、
   *    标签字符串数组与布尔**（`folderId` / `modid` / `rowId` / `releaseKey` /
   *    `gameVersion` / `tags` / `channel`），**入参永远不含路径** —— 要选一个 mods 目录，
   *    只能由主进程弹自己的原生对话框去选（所以 `bindFolder()` **一个参数都没有**；
   *    那一半是 **Task 4** 要写的，今天 `apps/desktop` 里还没有）。
   * ⚠️★ **`channel` 只是一个 id，永远不是一个 URL**：`Channel`（`@mcsr/shared/modFolders`）
   *    是 `'origin'` 或 `{ mirrorId }`，下载地址由主进程拿目录里的 `mirrors[]` 自己拼
   *    （`channelUrl` ⇒ `mirrorUrl`）—— 渲染进程**永远不能让主进程去下载一个它给出的地址**。
   *    这是 v1 立的规矩，这一组**不许破**：被注入的页面能按 id 触发写盘，
   *    但**指定不了写到哪（路径是主进程记下的）、也指定不了从哪儿取**。
   * ⚠️ **"下载哪一个"这四条（T6 之后是**三条**）的入口各不相同，按各自的参数读**（别混成一句
   *    —— 这是 2026-10-03 评审的 Important 1：上一版把四条都写成"多要一个 `releaseKey`"，
   *    而**只有两条**要；T6 删掉 `updateCatalogRow` 之后**只有一条**要）：
   *    · `updateMod(folderId, modid, releaseKey, channel)` —— **只有这条收 `releaseKey`**，
   *      而它是页面**从它自己渲染的那一行**带回来的 key ⇒ 主进程**必须按它在目录里查**
   *      （查不到就抛）。这是"页面能指定下载哪一个"的**唯一**入口，所以它只能是 key：
   *      让页面递一个 release 对象或一个地址，等于把"下载什么"整个交给页面。
   *    · `updateFolderAll(folderId, channel)` **不收 key**：目标来自**主进程自己的那份状态**
   *      （哪些行 `batchable` 是主进程判的）⇒ 页面只说"哪个文件夹、走哪条通道"。
   *    · `downloadMissing(modid, gameVersion, folderId, channel)` 收的是
   *      `(modid, 游戏版本)`，主进程**照这两个值在目录里查** release（spec §7.5：这一栏只列
   *      **唯一候选**的行）⇒ 页面能选的只有目录里已有的那一条，同样给不出地址。
   *    ⇒ 三条唯一的共同点是：**没有任何一条收地址**（`channel` 是 id、`releaseKey` 是 key）。
   *
   * ⚠️⚠️ 出参方向是反的，而且必须反（`fileUpdates` 那段写着同一件事）：`getState()` 的
   *    返回值与 `onStatus` 推给页面的那份 `ModFoldersState` 里**确实带着已绑定文件夹的
   *    绝对路径**（`ModFolderView.path`）—— 这份状态按 `modFolders.ts` 里的定义就是
   *    **页面唯一的数据来源**，路径是它的一部分（页面靠它指出"正在更新的是哪个目录里的哪个文件"）。
   *    ⚠️★ T6 删掉了另一处路径来源（`CatalogRowView.binding.localPath`，目录行的绑定）——
   *    那一格随第一部分一起没了 ⇒ 今天搬运路径的只有 `ModFolderView.path` 一处。
   *    ⇒ **入参不含路径 ≠ 这条通道不搬运路径**；这是本期**有意接受**的代价，不是没想过。
   *
   * ── 状态对象：这一组只搬 T1 那一份，不另造平行类型 ──
   *    除 `onStatus`（它返回取消订阅的函数）外，每个方法都返回**整份** `ModFoldersState`：
   *    `catalogStatus` / `gameVersion` / `tagFilter` / `bulkChannel` / `catalogRows`
   *    （`CatalogRowView[]`）/ `folders`（`ModFolderView[]`）/ `missing`（`MissingModView[]`）/
   *    `notices` / `busy` / `lastRun`。出参只声明**这一个**类型（`@mcsr/shared/modFolders`）：
   *    再写一份"给 IPC 用的"平行类型，两份必然有一天不一致，
   *    而表现是页面显示的与主进程判定的不是同一件事。
   *
   * ── 为什么第一部分的两个筛选器也是通道、而不是页面自己的 localStorage ──
   *    `gameVersion`（`setCatalogGameVersion`）与 `tagFilter`（`setTagFilter`）是
   *    **按机器记住**的（spec §6.8）⇒ 它们住在**主进程的 `prefs`** 里、随状态文件
   *    （`StateFileV2.prefs` 的 `catalogGameVersion` / `tagFilter`）一起持久化，
   *    读回来的那一份就是状态里的 `gameVersion` / `tagFilter`。
   *    渲染进程再用 localStorage 记一份，等于同一个选择有**两处**记忆 —— 两处必然有一天
   *    不一致（一处说旧版本、一处说新版本），所以它**只能是通道**。
   * ⚠️ **`bulkChannel` 是同一个道理的第三样**（Ruling 23）：它也住 `prefs`，也必须**读得回来**
   *    —— `setBulkChannel` 的返回值里带着当前值（`ModFoldersState.bulkChannel`）。
   *    界面读那一格、**不要自己再存一份**：否则界面显示 `'origin'`、主进程按存下来的
   *    镜像 id 下载，而且完全不报错。⇒ 这也是给 `ModFoldersState` 补那一格的理由。
   *
   * ── `bindFolder` 重名：有意为之，不是忘了改名（spec §6.7）──
   *    `FILE_UPDATES_CHANNELS.bindFolder`（v1）**保留原样**：老客户端 0.0.4 仍按它调，
   *    一个字母都不动。新 UI **不调用它**，改调 `MOD_FOLDERS_CHANNELS.bindFolder`
   *    （语义也换了：v1 那条是"按 jar 名匹配条目"，这条是"建一个文件夹实体"）。
   *    代价（认）：新桌面版里 v1 那条 `bindFolder` 成了**没有入口的代码** ——
   *    为了让 0.0.4 用户行为一字不变，这是**有意接受**的；下一期确认没人用 0.0.4 再删。
   *
   * ⚠️ 这一块加上之后，`preload.ts` 里那个 `const bridge: DesktopBridge` **少实现一个方法
   *    就红在那一行上**（它的注释里写着这条纪律）—— 这正是"契约与转发必须同时到位"的兜底。
   */
  readonly modFolders: {
    getState(): Promise<ModFoldersState>;
    /** 状态推送。**同一个串同时用于订阅与取消订阅**（散开写就会漏改一处）。 */
    onStatus(callback: (state: ModFoldersState) => void): () => void;
    /** 弹**原生**目录对话框，建一个"文件夹实体"（无入参 ⇒ 选哪里由主进程决定）。 */
    bindFolder(): Promise<ModFoldersState>;
    /*
     * ⚠️★ 2026-10-04（A 的 T6，裁决 B）：这里原来还有三条 —— `bindCatalogRow`（弹原生
     *    `.jar` 对话框，把选中的文件绑到**第一部分**那一行，Ruling 24）、
     *    `unbindCatalogRow`（Ruling 60 的"有绑定就必须能解绑"）与
     *    `updateCatalogRow`（第一部分那一行的写盘）。**第一部分整个下线了**
     *    （spec §2.1 第 7 条 / D1：v1 的单文件界面与第一部分一起删）
     *    ⇒ 契约 17 → **14**，preload 转发、主进程实现与注册、web 侧的接线
     *    （`ModFoldersHandlers` 的三个成员 + `makeModFoldersHandlers` 的三个实现）同时删干净。
     *    ⚠️ 代价（认）：`CatalogRowView.binding` 与"目录行有本地读数"这条能力一起没了 ——
     *    目录行的 `verdict` 只剩 `unknown` / `ambiguous` / `missing-release`
     *    （见 `modFolders.ts` 的 `planCatalogRows`）。
     */
    unbindFolder(folderId: string): Promise<ModFoldersState>;
    /**
     * 在系统文件管理器里打开这个 mod 文件夹（**A 的 S2 新增**）。
     *
     * ⚠️★ 只收 **folderId**（与其它通道同一条纪律）：路径从主进程**自己的状态**里取，
     *    渲染进程永远递不进任意路径 —— 这个通道的"打开"意味着"会让用户的操作系统
     *    去打开一个位置"，是本仓**唯一**一条有这种副作用的通道。
     * ⚠️ 入参收窄与拒绝的形状**照 `unbindFolder`**（同一个 `requireFolder`、同一句文案）：
     *    状态里没有这个 id 就**抛**（不猜、更不把 id 当路径用）。
     * ⚠️ 返回值只说"那一次打开动作"的结果（`shell.openPath` 失败时给一句错误文案），
     *    **不是** `ModFoldersState` —— 它不改状态，所以没有新状态可推。
     */
    openFolder(folderId: string): Promise<{ ok: true } | { ok: false; reason: string }>;
    /** 不带 `folderId` = 全部重扫；只读（不下载、不写盘）。 */
    rescan(folderId?: string): Promise<ModFoldersState>;
    /**
     * 改这个文件夹的游戏版本。
     * ⚠️ `null` **不是**"不改"：它是"交回自动推断"（`resolveGameVersion` 读不出来时
     * 所有行都是 `unknown-version`、不给更新按钮 —— spec §8）。
     */
    setFolderGameVersion(folderId: string, gameVersion: string | null): Promise<ModFoldersState>;
    /** 只表示"启动时检查并高亮"；**写盘永远要一次点击**（与 v1 同一条语义）。 */
    setFolderAutoUpdate(folderId: string, on: boolean): Promise<ModFoldersState>;
    /**
     * "全部更新"用哪条通道（一次点击驱动 N 个下载 ⇒ 必须有个默认，spec §6.8）。
     * ⚠️ 返回值里带着**当前值**（`ModFoldersState.bulkChannel`）⇒ 界面**读那一格**显示，
     *    不要自己再存一份（两处记忆必然有一天不一致，见上面那一段）。
     */
    setBulkChannel(channel: Channel): Promise<ModFoldersState>;
    /** ★ 写盘：把该文件夹里这一行换成 `releaseKey` 那条 release（**Task 5** 实现）。 */
    updateMod(
      folderId: string,
      modid: string,
      releaseKey: string,
      channel: Channel,
    ): Promise<ModFoldersState>;
    /** ★ 批量写盘：只有该文件夹里 `batchable` 的行会进（**Task 6** 实现）。 */
    updateFolderAll(folderId: string, channel: Channel): Promise<ModFoldersState>;
    /** ★ 装一个缺失清单里的 mod（**Task 6** 实现）；`gameVersion` 决定装哪一版。 */
    downloadMissing(
      modid: string,
      gameVersion: string,
      folderId: string,
      channel: Channel,
    ): Promise<ModFoldersState>;
    /** 第一部分选中的游戏版本 —— 与 `tagFilter` 一样住主进程 `prefs`（见上面那一段）。 */
    setCatalogGameVersion(gameVersion: string): Promise<ModFoldersState>;
    /** 第一部分的标签筛选，**"与"语义**（留下的行必须同时带全部所选标签）。 */
    setTagFilter(tags: readonly string[]): Promise<ModFoldersState>;
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
 *   要多少字节：自己跑一遍就知道（读数是**每次构建都会变**的，所以这里一个数字都不钉）：
 *     `& "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/desktop build`
 *     `(Get-Item apps/desktop/dist/preload.cjs).Length` ／ `(Get-Item apps/desktop/dist/main.cjs).Length`
 *     `Select-String -Path apps/desktop/dist/preload.cjs -Pattern FILE_UPDATES_CHANNELS -AllMatches`
 *       ⇒ 命中即说明常量真的在产物里（不是被 tree-shake 掉的类型）
 *   ⚠️★ 这里**故意不钉任何具体数字**（2026-09-24 评审的顺手 3）：连"某个整数字节"也不行 ——
 *      `main.cjs` 的体积每次改一行源码都会变（一次 fix round 就让原先写在这里的
 *      1,438,025 过期了），钉一个必然过期的数字等于给下一个人埋一个必错的锚，
 *      而它看起来还像"有人量过"。判据只留一条命令能重现的那种。
 *   ⚠️ 这里也**没有再写**下面两句曾经写在这里的话：
 *     ① "preload.cjs 从 4.2kb 变 5.3kb" —— 那个 4.2kb 是**上一个提交**的产物，而 `build`
 *        每次都会 `rmSync(dist)` ⇒ 这条读数**不可复跑**；
 *     ② "未被引用的 `desktopBridge()` 被 tree-shake 掉了（产物里 0 次出现）" —— 这句
 *        **不成立**：现读 `Select-String -Path apps/desktop/dist/preload.cjs -Pattern
 *        desktopBridge -AllMatches` 有命中。
 *     ⇒ 代价：想知道省了多少字节，只能自己按上面的命令比。
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

/**
 * `modFolders` 那**十四条** IPC 通道名 —— 与 `FILE_UPDATES_CHANNELS` 同一条理由，
 * 所以住在契约旁边（不在这里重复那一段论证，改这一组之前先读上面那一段）：
 * 通道名是字符串，写错一个字母**类型检查看不见**，而失败形态是静默的 ——
 * `invoke` 没有 handler 时 reject（页面那一步什么也没发生）、`on` 对着一个不存在的
 * 通道名订阅（永远不触发）。preload 与主进程（Task 4 的 `mod-folders.ts`）
 * **引用同一个常量对象**，两边各自手写一遍从而漂移就不可能发生。
 *
 * ⚠️ **v1 那九条一个字节都不动**（`FILE_UPDATES_CHANNELS` 原样保留）：老客户端 0.0.4
 *    读的是那些串，改一个字母就是"点了没反应"。
 * ⚠️★ 2026-10-04（A 的 T6，裁决 B）：这一组**删了三条** —— `bindCatalogRow` /
 *    `unbindCatalogRow` / `updateCatalogRow`（第一部分那一行的绑定与写盘）。
 *    17 → **14**。为什么与 preload、主进程、web 接线、probe 的删除断言**一起**做：
 *    一次删净才能让**每一个中间提交都绿**（只删契约会让 `apps/web` 的 typecheck 红成
 *    七处 —— 那几个 handler 的类型派生自 `DesktopBridge['modFolders']`）。
 *    ⚠️ 那条 `satisfies Record<keyof DesktopBridge['modFolders'], string>` **就是这次删除的
 *    对齐判据**：少写一条 / 多写一条都当场编译失败。
 * ⚠️ `bindFolder` 这个名字在两组里**各有一条**（新 UI 只调这一条），
 *    为什么允许重名、代价是什么，见 `DesktopBridge.modFolders` 上的那一段。
 * ⚠️ 通道名的形状照 v1：`mcsr:modfolders-<方法名的 kebab>`。**四处不是纯 kebab**
 *    （照 v1 的缩写习惯，四个都列在这里，免得下一个人按规则推出来对不上）：
 *      · `onStatus` ⇒ `-status`（去掉 `on`，与 v1 的 `mcsr:fileupdates-status` 同型）
 *      · `setFolderAutoUpdate` ⇒ `-set-folder-auto`（`Update` 缩成 `auto`，照 v1 的 `-set-auto`）
 *      · `setFolderGameVersion` ⇒ `-set-folder-version`（`GameVersion` 缩成 `version`）
 *      · `setCatalogGameVersion` ⇒ `-set-catalog-version`（同上）
 *    其余**十个**都是方法名的逐字 kebab（新加的 `openFolder` ⇒ `-open-folder` 也在其中；
 *    这一格原先写"十一个"，而 16 个成员里逐字 kebab 的是 12 个 —— A 的 S2 顺手改准；
 *    T6 删掉那三条之后：14 个成员 − 4 个非纯 kebab = **10**）。
 *
 * 键名与 `DesktopBridge['modFolders']` 的方法名**逐一对应**（`satisfies` 那一条兜住
 * "契约加了方法却忘了加通道"）。⚠️ 这一条 `satisfies` **只有在 `modFolders` 是必需成员时
 * 才咬得住**：写成可选成员（`readonly modFolders?:`）时 `keyof` 会塌成 `never`、
 * `Record<never, string>` 接受任何对象 ⇒ 少写一条也不报错 —— 那就成了装饰。
 */
export const MOD_FOLDERS_CHANNELS = {
  getState: 'mcsr:modfolders-get-state',
  /** 状态推送。**同一个串同时用于订阅与取消订阅**（与 v1 同一条纪律）。 */
  onStatus: 'mcsr:modfolders-status',
  bindFolder: 'mcsr:modfolders-bind-folder',
  unbindFolder: 'mcsr:modfolders-unbind-folder',
  /**
   * ⚠️★ 唯一一条**会让用户的操作系统去打开一个位置**的通道：入参只有 id
   * （见契约上那一格：路径由主进程从自己的状态里取）。
   */
  openFolder: 'mcsr:modfolders-open-folder',
  rescan: 'mcsr:modfolders-rescan',
  setFolderGameVersion: 'mcsr:modfolders-set-folder-version',
  setFolderAutoUpdate: 'mcsr:modfolders-set-folder-auto',
  setBulkChannel: 'mcsr:modfolders-set-bulk-channel',
  updateMod: 'mcsr:modfolders-update-mod',
  updateFolderAll: 'mcsr:modfolders-update-folder-all',
  downloadMissing: 'mcsr:modfolders-download-missing',
  setCatalogGameVersion: 'mcsr:modfolders-set-catalog-version',
  setTagFilter: 'mcsr:modfolders-set-tag-filter',
} as const satisfies Record<keyof DesktopBridge['modFolders'], string>;
