/**
 * mod 文件夹那一页的**共用层**（2026-10-04，A 的 T6 建）。
 *
 * ===========================================================================
 * ⚠️★ 这一份是什么：T6 删掉的那些文件里**还活着的那一半**
 * ===========================================================================
 * T6 删了五个文件（`FileUpdatesPanel` / `FileUpdateTable` / `ModFoldersPanel` /
 * `MissingModsList` / `scripts/filesrender.tsx`，spec §2.1 第 7 条 / D1），而它们里有
 * 一批东西**产品还在用** —— 删文件之前必须先搬出来，否则"删干净"会变成"删掉功能"。
 * 三个来源、三批东西，各自都有消费者：
 *
 *   · **数据层**（原来住 `FileUpdatesPanel.tsx` 的后半段）：取数与动作包装
 *     （`useModFolders` / `ModFoldersHandlers` / `makeModFoldersHandlers` /
 *     `reduceModFoldersLoad` / `NO_MOD_FOLDERS_LOAD`）与首拉那一屏（`ModCatalogScanning`）。
 *     消费者：`routes/Files.tsx`（页面外壳）、`scripts/foldersrender.tsx`（自检）。
 *     ⚠️ 它与 v1 的 `useFileUpdates` / `FileUpdatesPanel` 是**两套东西**：v1 那一半
 *     随 D1 一起死了（0.0.4 的壳只剩一句"需要桌面版 0.0.5"）。
 *   · **共用的判断与选项表**（原来住 `ModFoldersPanel.tsx` 的文件头，那一份是第二部分
 *     与新的 `VersionFolderList` **共用**的六格）：`folderGameVersionOptions` /
 *     `channelOptions` / `channelKeyOf` / `bulkChannelUsable` / `staleGameVersion` /
 *     `canUpdateFolderAll`。消费者：`VersionFolderList.tsx`（五格）与
 *     `ModDownloadPanel.tsx`（`bulkChannelUsable`）。
 *     ⚠️ 留在旧文件里就是"两处会漂的同一个判断"，而漂的表现是**少画一颗按钮**或
 *     **下拉里少一个 `disabled`**（不是崩溃）—— 所以它们必须有一个**删除之后仍然存在**的家。
 *   · **文案表与扫描器**（原来住 `FileUpdateTable.tsx`）：`VERDICT_BADGES` /
 *     `VERDICT_HINTS`（消费者：`FolderJarList.tsx` 与 `VersionModList.tsx`）、
 *     `RAW_KEY_RE` / `rawKeysIn`（消费者：`scripts/foldersrender.tsx` 的裸 key 扫描）。
 *     ⚠️ `VERDICT_HINTS` 尤其不能随文件消失：它装着 `ambiguous` / `missing-release`
 *     那两句**用户唯一能行动的线索**（spec §8），删了就是静默丢两句话。
 *
 * ⚠️★ **名字里的 "Data" 不是"只有数据"**：这一份就是"mod 文件夹那一页的共用层"
 *   （数据 + 判断 + 文案表），取这个名字是因为它替换掉的那两格职责（`FileUpdatesPanel`
 *   的数据层、`ModFoldersPanel` 的共用判断）在文件系统里必须有**同一个落点**。
 *
 * ⚠️★ 这里**没有** `FileUpdateTable` 那三格里只服务 v1 的：`formatClock`（只有 v1 那张表
 *   与 v1 面板印时间）、`originPageOf`（只有第一部分那张表用它取"打开原网页"的地址）、
 *   `ModCatalogTable` / `FileUpdateTable` 两个组件本身。它们随 D1 一起删（没有人再渲染）。
 *
 * ===========================================================================
 * ⚠️★ 取数住在这里，不住在页面里（沿用 `FileUpdatesPanel` 的那条理由）
 * ===========================================================================
 * `renderToStaticMarkup`（`scripts/foldersrender.tsx`）**不跑 effect** ⇒ 取数写在路由页里
 * 的话，自检渲染这一页只会看到「正在扫描…」，页面上每一块都断言不到（那是一条**不可能红**
 * 的守卫）。⇒ 页面拿结果、组件拿 props：唯一一处 `useModFolders()` 在 `Files.tsx`。
 */

import { type DesktopBridge, desktopBridge } from '@mcsr/shared/desktop';
import {
  type DownloadProgress,
  progressKeyOf,
  type TimedSample,
  withSample,
} from '@mcsr/shared/downloadProgress';
import {
  batchTargets,
  type Channel,
  type FolderVerdict,
  isKnownGameVersion,
  isKnownMirror,
  type ModFoldersState,
  type ModFolderView,
} from '@mcsr/shared/modFolders';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * `Error` 之外的抛出物（IPC 那层理论上会给字符串）也要能变成一句人话。
 *
 * ⚠️ 它是**一处实现**：页面接缝上被接住的 reject（`ModDownloadPanel` 的 `onAction` 包装）
 *    与动作层的失败走的是**同一句话**。两处各写一份 `error instanceof Error ? …`
 *    就是同一件事有两个说法，而失败时它们会不一样。
 * ⚠️★ T6 之前它住在 `FileUpdatesPanel.tsx` 的 v1 那一段里（v1 的取数也在用）——
 *    搬过来的时候 v1 的消费者已经随 D1 一起删掉了。
 */
export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// 动作层（契约 ⇒ 组件能用的形状）
// ---------------------------------------------------------------------------

/** 把契约里**某一个**动作的入参搬过来，返回值换成 `Promise<void>`（与 v1 那条同型）。 */
type ModFoldersAction<K extends keyof DesktopBridge['modFolders']> = (
  ...args: Parameters<DesktopBridge['modFolders'][K]>
) => Promise<void>;

/**
 * 这一页要用的动作（文件夹那一层 + 第三段那一条）。
 *
 * ⚠️ 返回值是 `Promise<void>`：`makeModFoldersHandlers()` 已经把主进程返回的**整份状态**
 *    落到界面上了，按钮那一层不需要（也拿不到）自己去 setState —— 那条规矩只有一处实现。
 * ⚠️★ T6 之后**是十二条**（现数：`setCatalogGameVersion` / `setTagFilter` / `rescan` /
 *    `bindFolder` / `unbindFolder` / `setFolderGameVersion` / `setFolderAutoUpdate` /
 *    `setBulkChannel` / `updateMod` / `updateFolderAll` / `downloadMissing` / `openFolder`）。
 *    删掉的三条是第一部分的绑定（`bindCatalogRow` / `unbindCatalogRow` / `updateCatalogRow`，
 *    裁决 B：契约 17 → 14）—— 第一部分整个下线了，它们没有入口了。
 *    ⚠️★ **C 的 T5 起是十三条**（加 `cancelDownload`，现数：上面十二条 + 它）。
 *    ⚠️ 加一条动作时这句话要一起改（与 `package.json` 里那句"十三个渲染门禁"同一条纪律：
 *    手抄的数字一定会过期，所以它旁边写着怎么现数）。
 * ⚠️ `setTagFilter` **留着**（D2：标签只显示、不筛选，但为删一个字段动契约不划算）——
 *    今天没有任何界面调它，那是有意的代价，不是漏画。
 */
export interface ModFoldersHandlers {
  setCatalogGameVersion: ModFoldersAction<'setCatalogGameVersion'>;
  /** ⚠️ D2：这一条还在契约里，但**没有任何界面**调它（标签不再筛选）。 */
  setTagFilter: ModFoldersAction<'setTagFilter'>;
  rescan: ModFoldersAction<'rescan'>;
  /* ---- 文件夹那一层 ---- */
  /**
   * 弹原生目录对话框建一个"文件夹实体"（**新语义**，与 v1 那条同名通道不是一回事）。
   *
   * ★★ G2（最终修复波 / spec D3）：入参是**当时看着的那一版**（`page.version`）——
   * 主进程把它**预置**成新文件夹的有效版本（仍可手改），而不是自己推断一个可能是 `null`
   * 的版本。⚠️ `null` = "交回自动推断"（与 `setFolderGameVersion` 同一条语义）。
   */
  bindFolder: ModFoldersAction<'bindFolder'>;
  unbindFolder: ModFoldersAction<'unbindFolder'>;
  setFolderGameVersion: ModFoldersAction<'setFolderGameVersion'>;
  setFolderAutoUpdate: ModFoldersAction<'setFolderAutoUpdate'>;
  /** 「全部更新」用哪条通道（按机器记住 ⇒ 住在主进程 `prefs`）。 */
  setBulkChannel: ModFoldersAction<'setBulkChannel'>;
  updateMod: ModFoldersAction<'updateMod'>;
  updateFolderAll: ModFoldersAction<'updateFolderAll'>;
  /** 第三段那一行的「下载」（`gameVersion` 决定装哪一版）。 */
  downloadMissing: ModFoldersAction<'downloadMissing'>;
  /* ---- A 的 T3：新页面那一行「打开文件夹」---- */
  /**
   * ★★ 打开那个文件夹（spec §9.13）。
   *
   * ⚠️★ 它是**唯一一条返回值不是 `ModFoldersState`** 的通道（主进程不改状态，
   *    只回一次动作的结果）⇒ 它**不走 `run()`**，接 reject 的地方写在下面的实现里。
   * ⚠️ 入参只有 id：路径由主进程从自己的状态里取（渲染进程影响不了"打开哪个目录"）。
   */
  openFolder: ModFoldersAction<'openFolder'>;
  /* ---- C 的 T5：停掉正在跑的那一趟 ---- */
  /**
   * ★★ 停掉正在跑的那一趟下载（子项目 C，spec §4 / D4）。
   *
   * ⚠️★ 与 `openFolder` 是**同一条形状**、不是同一条通道：`cancelDownload()` 的返回值是
   *    `{ok:true} | {ok:false; reason}`（**不是**整份 `ModFoldersState`）⇒ 它同样**不走
   *    `run()`**，接 reject 与接那句 `reason` 的地方都写在下面的实现里。
   * ⚠️ 入参一个都没有：作用范围是"当前这一趟"（哪一趟由主进程那一格说了算，
   *    渲染进程**递不进任何东西** —— 与本节其余通道同一条纪律）。
   * ⚠️ 主进程的语义（契约里写着）：没有在跑 ⇒ `{ok:false, reason:'没有在跑'}`；
   *    写盘相位 ⇒ `{ok:false, reason:'正在写入…'}`（**不许**回 `{ok:true}` 而其实停不下来）；
   *    已经在取消中 ⇒ no-op `{ok:true}`。
   */
  cancelDownload: ModFoldersAction<'cancelDownload'>;
  /* ---- B2 的 T5：整包下载 ---- */
  /**
   * ★★ B2（Task 6 接线）：把**整合包**里的 mod 逐个装进这个文件夹。
   *
   * ⚠️★ 四个入参**全是 id / 字符串**：包的内容以**服务端**为准（主进程拿 `packId`
   *    自己去取，spec D5），渲染进程递不进 mod 列表、路径或 URL。
   * ⚠️ 通道固定 `'origin'`（`VersionModList` 那一段同一条纪律与同一个代价）：
   *    这一节只发 release 自己的地址，不走 `state.bulkChannel`（那个选择器的作用域是
   *    「全部更新」，混起来会得到"界面显示 origin、实际按镜像下载"）。
   */
  downloadPack: ModFoldersAction<'downloadPack'>;
}

// ---------------------------------------------------------------------------
// 取数那两格（快照 / 失败结论）的归约 —— 纯函数，好让它能被一条断言钉住
// ---------------------------------------------------------------------------

export type ModFoldersLoadEvent =
  | { kind: 'snapshot'; state: ModFoldersState }
  | { kind: 'failure'; reason: string };

/** 三格互斥的联合 ⇒ "数据与失败不可能同时成立"是类型保证的。 */
export type ModFoldersLoad =
  | { status: 'loading'; state: null; failure: null }
  | { status: 'ready'; state: ModFoldersState; failure: null }
  | { status: 'failed'; state: null; failure: string };

export const NO_MOD_FOLDERS_LOAD: ModFoldersLoad = {
  status: 'loading',
  state: null,
  failure: null,
};

/**
 * ★★ 取数结果的归约：**数据永远压过一次失败结论**。
 *
 * ⚠️★ 为什么这一层也要有它：桌面态那两条支路是**独立**的
 *    （`onStatus` 推送 / `getState()` 首拉），而 Ruling 42 说首拉**可能等一次补扫**
 *    ⇒ "首拉先失败、推送后带来数据"这个顺序真的会发生。把失败结论当成"粘住的"
 *    （谁先来谁说了算）会让页面一直停在「拿不到状态」，而手上其实已经有数据。
 *    反方向也要防：已经有数据时又把一次失败记上去，同样是把一句过期的话压在数据上面。
 */
export function reduceModFoldersLoad(
  prev: ModFoldersLoad,
  event: ModFoldersLoadEvent,
): ModFoldersLoad {
  if (event.kind === 'snapshot') {
    return { status: 'ready', state: event.state, failure: null };
  }
  if (prev.status === 'ready') return prev;
  return { status: 'failed', state: null, failure: event.reason };
}

/**
 * `ModFoldersHandlers` 那十二条动作的包装。
 *
 * ⚠️ 两件事**只有这一处实现**：把主进程返回的状态落到界面上；以及接住 `reject`。
 * ⚠️ 开跑之前先撤掉**上一次**的失败结论（它说的是上一次那个动作）。
 */
function makeModFoldersHandlers(
  api: DesktopBridge['modFolders'],
  apply: (state: ModFoldersState) => void,
  fail: (message: string | null) => void,
): ModFoldersHandlers {
  const run = async (call: () => Promise<ModFoldersState>): Promise<void> => {
    fail(null);
    try {
      apply(await call());
    } catch (error) {
      fail(reasonOf(error));
    }
  };

  return {
    setCatalogGameVersion: (gameVersion: string) =>
      run(() => api.setCatalogGameVersion(gameVersion)),
    setTagFilter: (tags: readonly string[]) => run(() => api.setTagFilter(tags)),
    rescan: () => run(() => api.rescan()),
    /*
     * ⚠️ 形参写成 `?`（可选）而不是 `: string | null`：`ModFoldersAction` 派生的是
     * 契约的 `Parameters`，而契约那一格是可选的（`gameVersion?: string | null`
     * ⇒ 实际类型含 `undefined`）—— 写窄了 tsc 会在这一行报 TS2322。
     */
    bindFolder: (gameVersion?: string | null) => run(() => api.bindFolder(gameVersion)),
    unbindFolder: (folderId: string) => run(() => api.unbindFolder(folderId)),
    setFolderGameVersion: (folderId: string, gameVersion: string | null) =>
      run(() => api.setFolderGameVersion(folderId, gameVersion)),
    setFolderAutoUpdate: (folderId: string, on: boolean) =>
      run(() => api.setFolderAutoUpdate(folderId, on)),
    setBulkChannel: (channel: Channel) => run(() => api.setBulkChannel(channel)),
    updateMod: (folderId: string, modid: string, releaseKey: string, channel: Channel) =>
      run(() => api.updateMod(folderId, modid, releaseKey, channel)),
    updateFolderAll: (folderId: string, channel: Channel) =>
      run(() => api.updateFolderAll(folderId, channel)),
    downloadMissing: (modid: string, gameVersion: string, folderId: string, channel: Channel) =>
      run(() => api.downloadMissing(modid, gameVersion, folderId, channel)),
    /*
     * ★★ B2（Task 6 接线）：整包下载。⚠️ 与 `downloadMissing` **逐字同一条形状**
     *    （返回值是整份 `ModFoldersState` ⇒ 走上面那个 `run`，状态由它落到界面上）。
     * ⚠️ 入参**原样**转过去：`gameVersion` 就是页面当时看着的那一版（主进程拿它跟
     *    目标文件夹的有效版本、以及**包自己的** `gameVersion` 各对一遍 —— 那是这条
     *    通道里最贵的一格：不一致会往一个别的游戏版本的目录里装 jar）。
     */
    downloadPack: (packId: string, gameVersion: string, folderId: string, channel: Channel) =>
      run(() => api.downloadPack(packId, gameVersion, folderId, channel)),
    /*
     * ★★ `openFolder` 是唯一一条**不改状态**的通道（返回值是"这一次的结果"）
     *    ⇒ 它不能用上面那个 `run`（那个签名收的是 `() => Promise<ModFoldersState>`）。
     * ⚠️★ 而它必须**在这里**接住 reject，两个来源都要接：
     *   · **主进程对未知 id 是"抛"**（`apps/desktop/src/mod-folders.ts` 的 `requireFolder`：
     *     `状态里没有这个文件夹：<id>`），而契约类型写的是返回 `{ ok: false, reason }`
     *     —— 类型与实现对不上，**行为以实现在准**（T2 复审点名，要求保留"抛"）；
     *   · `shell.openPath` 自己失败时走的是那条返回（"成功给空串、失败给一句文案"）。
     * ⇒ 两条都落到 `fail(...)`（就是 `actionError`），由页面把它印出来。
     *   ⚠️ "渲染之后那个文件夹又被解绑了"真的会发生（另一个窗口 / 上一次动作的推送）——
     *   不接住它就是一次**未处理的 rejection**，而用户什么都看不到。
     */
    openFolder: async (folderId: string): Promise<void> => {
      fail(null);
      try {
        const result = await api.openFolder(folderId);
        if (!result.ok) fail(result.reason);
      } catch (error) {
        fail(reasonOf(error));
      }
    },
    /*
     * ★★ C 的 T5：与上面 `openFolder` **逐字同一条形状**（理由也同一条）——
     *    它的返回值不是 `ModFoldersState` ⇒ 不走 `run()`；而两条路都要接住：
     *      · 主进程**拒**（`{ok:false, reason}`：没有在跑 / 写盘相位 / 已经在取消）⇒
     *        `fail(reason)`（"点了没反应"与"点了被拒"对用户是两件事，
     *        而那句 `reason` 正是主进程写好的说法）；
     *      · 通道自己抛（IPC 那层理论上会）⇒ 与本节其余动作同一个 `reasonOf`。
     * ⚠️★ C1：**先做能力检测**（与 `subscribeProgress` 同一道判据、同一条理由）——
     *    旧桌面壳（0.0.5–0.0.7）里这一格是 `undefined`，直接调就是
     *    `undefined is not a function`。⚠️ 这一支今天**够不到**（旧壳里 `state.progress`
     *    也不在 ⇒ `progressOf` 给 `null` ⇒ 取消按钮**根本不画**，见 `DownloadProgressLine`
     *    的三个调用点：命中非空的那一份载荷才画那一行），留着是因为它只有三行，
     *    而"一颗能点的按钮调到一个不存在的函数"是白屏级别的坏法。
     */
    cancelDownload: async (): Promise<void> => {
      fail(null);
      if (typeof capabilitiesOf(api).cancelDownload !== 'function') {
        fail('这个桌面版没有「取消下载」这一条通道（升级桌面版之后可用）');
        return;
      }
      try {
        const result = await api.cancelDownload();
        if (!result.ok) fail(result.reason);
      } catch (error) {
        fail(reasonOf(error));
      }
    },
  };
}

/** `useModFolders()` 的产物。⚠️ 只有 `ready` 那一支有动作层（其余三支没有东西可动）。 */
export type ModFoldersData =
  /**
   * 桌面壳里**没有** `modFolders`（0.0.4 的老客户端、或纯浏览器）。
   *
   * ⚠️★ 这一支**不走 v1 那条路**：这一页从 T3 起是 tab 骨架，`modFolders` 不在时它只画
   *    一句"需要桌面版 0.0.5"（spec §9.12 / D1："0.0.4 用户只能看到升级提示"）；
   *    v1 的面板在 T6 已经连组件一起删掉了。⇒ 这一支读作"这个客户端没有 mod 文件夹功能"，
   *    而 `Files.tsx` 那一边的渲染点就是 `ModFoldersUnavailable`。
   */
  | { status: 'unavailable' }
  /**
   * 第一次拉状态**还没回来**（Ruling 42：它可能先等一次补扫）⇒ 页面必须说"正在扫描…"，
   * 否则用户看到的是"这一页挂了"。
   */
  | { status: 'loading' }
  | { status: 'failed'; reason: string }
  | {
      status: 'ready';
      state: ModFoldersState;
      handlers: ModFoldersHandlers;
      actionError: string | null;
      /**
       * ★ C 的 T5：**此刻**该显示的那条进度（`progressOf(state, live)` 的产物）。
       * ⚠️ 它是**推导出来的**、不是第二份真相：状态里那一格说"没有在跑"时它恒为 `null`。
       */
      progress: PageProgress | null;
    };

// ---------------------------------------------------------------------------
// C 的 T5：页面侧的进度（帧 + 样本窗口）—— 两条通道在这里合成一条
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 为什么这件事必须有**一个**落点（两条通道各来一半）：
 *   · `ModFoldersState.progress`（低频，随 `onStatus` 整份状态推）是**这一趟的收尾读数**：
 *     起手 / 换项 / 换相位 / 收尾各推一次，切 tab 回来也读得到；
 *   · `onProgress`（高频，D3 节流）只带字节 —— 但整份状态里没有"最近几秒的样本"，
 *     而那正是速度与 ETA 唯一的输入。
 *   ⇒ 合成的规则写在 `progressOf` 里（**一处**），两处各写一份的话，"收尾之后还挂着一条
 *     进度"这种坏法只会在一处被拦住。
 */

/** ★ C 的 T5：页面侧的进度载荷（**一帧** + 这一项攒下来的样本窗口）。 */
export interface PageProgress {
  frame: DownloadProgress;
  samples: readonly TimedSample[];
}

/**
 * ★★ C 的 T5：**此刻**该显示的那条进度（spec §4 / D6）。
 *
 * ⚠️★ 规则只有两条，而第一条是硬的：**状态说"没有在跑" ⇒ 一律 `null`**。
 *    `ModFoldersState.progress` 是那一趟的**收尾读数**（一趟结束时变回 `null`）——
 *    没有这一条的话，晚到的一帧会让界面上永远挂着一条"正在下载"，
 *    而那正是 D6 要消灭的"停在最后一帧"（自检㊶ 有一条专门咬它）。
 * ⚠️★★ C1（最终修复波）：第一条判据读的是**缺失与 `null` 同义**（`!state.progress`），
 *    不是 `=== null` —— **旧桌面壳推来的状态里根本没有这一格**（这一格是子项目 C 才加的，
 *    0.0.5–0.0.7 的壳有 `modFolders` 但只有 14 格）⇒ 那时 `state.progress` 是 `undefined`，
 *    而 `=== null` 判据不成立 ⇒ 函数返回 `{ frame: undefined }` ⇒ 调用方
 *    （`FolderJarList` / `VersionModList` / `VersionFolderList` 里那句
 *    `progress.frame.folderId`）当场 TypeError = **`/files` 整页白屏**。
 *    接缝上还有第二道洞（旧壳没有 `onProgress`，见 `subscribeProgress`），两道一起堵。
 *    ⚠️ 这一条**无论旧壳在不在都更对**：契约那一格是 `DownloadProgress | null`，
 *    而"缺字段"与"这一格是 `null`"在语义上是同一句话（"这一趟没有在跑 / 没有读数"）。
 * ⚠️ 第二条：推送有就用推送（它的字节是最新的、样本窗口也在这里）；没有就用状态里那一帧
 *    （切 tab 回来、或高频那一帧还没来）。两者读的是主进程里**同一个变量**
 *    ⇒ 不可能互相矛盾，只是新鲜度不同。
 * ⚠️★ 状态里那一帧**不带样本**（`samples: []`）：样本窗口只许从 `onProgress` 收。
 *    换项那一拍会经**两条通道各到一次**同一帧（`rebuild()` 带着 `state.progress` 推一遍，
 *    `pushProgress(true)` 又推一遍），从两条都收就会往窗口里注入**重复样本**
 *    —— 速度会在那一拍跳一下（"新增字节为 0"被算成一次 0 速度）。
 */
export function progressOf(state: ModFoldersState, live: PageProgress | null): PageProgress | null {
  /*
   * ⚠️★ 写成 `!state.progress`（而不是 `=== null`）：**缺失字段与 `null` 同义** ——
   *    旧桌面壳（0.0.5–0.0.7）推来的状态里连这一格都没有，`=== null` 会漏过 `undefined`
   *    （理由与现场写在函数头那一段）。⛔ 别改回 `=== null`：自检 ㊶ 有一条专门咬
   *    "把这一格从夹具里**删掉**"（不是设成 `null`）的立面。
   */
  if (!state.progress) return null;
  return live ?? { frame: state.progress, samples: [] };
}

/**
 * ★★ C1（最终修复波）：子项目 C 那两条通道的**能力检测**（旧桌面壳 + 新网页那一档）。
 *
 * ⚠️★★ 为什么判据是"这一格在不在、是不是函数"，**不是**版本号比较：
 *    · 版本号会漂（`0.0.5`–`0.0.7` 的壳**有** `modFolders`，所以 `useModFolders` 走
 *      `ready` 那一支），而**能力不会**；
 *    · 现场：旧壳里 `api.onProgress` 是 `undefined`，而订阅那一句在 `useEffect` 里是
 *      **同步**调用 ⇒ 当场 TypeError。`apps/web` 全仓**没有 error boundary**（现读）
 *      ⇒ React 卸载整棵树 = `/files` **整页白屏**（C1 的第一道洞）。
 *    · 同族：`cancelDownload` 在旧壳里也不在 ⇒ 点下去是 `undefined is not a function`。
 * ⚠️★ 两格的类型在契约里是**必需**的（`DesktopBridge['modFolders']` 是这一版才有的形状）
 *    —— 所以这里不能用 `?:` 去改契约（那会让 `MOD_FOLDERS_CHANNELS` 那条 `satisfies`
 *    咬不住"契约加了方法却忘了加通道"）⇒ 放宽只发生在**这一层**的读数上。
 */
type ProgressCapabilities = {
  onProgress?: (callback: (progress: DownloadProgress) => void) => () => void;
  cancelDownload?: () => Promise<{ ok: true } | { ok: false; reason: string }>;
};

/** 把契约形状读成"这两格**可能不在**"的形状（结构上是同一种对象，不需要断言）。 */
function capabilitiesOf(api: DesktopBridge['modFolders']): ProgressCapabilities {
  return api;
}

/**
 * 订阅高频那一条通道（**旧壳里没有它 ⇒ 退化成 no-op 退订函数**）。
 *
 * ⚠️★ 没有这一道判据的现场写在 `capabilitiesOf` 那一段：同步 `TypeError` + 没有 error
 *    boundary = 整页白屏。而"退化成 no-op"是**正确**的降级：旧壳里
 *    `state.progress` 也不在（`progressOf` 的第一条判据兜住）⇒ 这一页一条进度都不画，
 *    其余部分照常可用。
 */
function subscribeProgress(
  api: DesktopBridge['modFolders'],
  onFrame: (frame: DownloadProgress) => void,
): () => void {
  const { onProgress } = capabilitiesOf(api);
  if (typeof onProgress !== 'function') return () => undefined;
  return onProgress(onFrame);
}

/**
 * 取数（**只有桌面壳里、而且 `modFolders` 真的在**才会跑）。
 *
 * ⚠️★ 顺序：**先订阅，再立刻 `getState()`**。主进程在应用启动时就会抓目录、扫文件夹，
 *    而这一页要等远程网页加载完才挂载 ⇒ 检查早于订阅时那一次推送**没有任何人收到**，
 *    表现是"界面上永远停在加载中"，而完全不报错。
 * ⚠️★ 判据是 `desktopBridge()?.modFolders` 在不在，**不是** `desktopBridge()` 在不在：
 *    0.0.4 的壳有 `mcsr` 但**没有** `modFolders`（`shared/desktop.ts` 的契约是 0.0.5 才有的）
 *    ⇒ 那种客户端在这一页上**只有一句"需要桌面版 0.0.5"**。
 * ⚠️★ 而 `modFolders` 在**不等于**这一版的两条新通道在（C1）：0.0.5–0.0.7 的壳有
 *    `modFolders`（只有 14 格）⇒ 订阅走 `subscribeProgress` 的能力检测、
 *    取消走 `makeModFoldersHandlers` 里那一道同样的判据，两条都不许直接调。
 */
export function useModFolders(): ModFoldersData {
  const [load, setLoad] = useState<ModFoldersLoad>(NO_MOD_FOLDERS_LOAD);
  const [actionError, setActionError] = useState<string | null>(null);
  /**
   * ★ C 的 T5：高频那一条通道攒下来的东西（**帧 + 样本窗口**）。
   * ⚠️★ 它只从 `onProgress` 收（理由写在 `progressOf` 那一段）。
   * ⚠️★ 它**只被 `onProgress` 覆盖、从不主动清空**：一趟结束时这里仍躺着最后一帧，
   *    而"界面上一条都不许剩"由 `progressOf` 的第一条兜住（状态说没在跑 ⇒ 一律 `null`）
   *    —— 那一格是那一趟的收尾读数，它先变空 ⇒ 这份陈货画不出来。**不留独立判据**：
   *    可达的坏路径只有一条（下一趟与上一趟同键 ⇒ 窗口不重开），而那一条已经由
   *    `progressKeyOf` 里的 `runStartedAt` 收掉（T5 评审 Important 2）。
   */
  const [live, setLive] = useState<PageProgress | null>(null);

  /*
   * ⚠️ `desktopBridge()` 每次读拿到的是同一个对象（preload 在页面脚本之前注入），
   *    所以可以拿它当 effect 的依赖。
   */
  const api = desktopBridge()?.modFolders ?? null;

  const accept = useCallback((state: ModFoldersState) => {
    setLoad((prev) => reduceModFoldersLoad(prev, { kind: 'snapshot', state }));
  }, []);

  const handlers = useMemo(
    () => (api === null ? null : makeModFoldersHandlers(api, accept, setActionError)),
    [api, accept],
  );

  useEffect(() => {
    // 浏览器 / 老客户端：这一栏根本不存在（那一支只画"需要桌面版 0.0.5"）。
    if (api === null) return;
    const unsubscribe = api.onStatus(accept);
    /*
     * ★★ C 的 T5：高频那条通道（D3 已经节流到 ≥100 ms / ≥64 KB）。
     *
     * ⚠️★ 样本窗口的重开判据是 `progressKeyOf`（`folderId|modid|itemIndex|runStartedAt`）：
     *    换项、**或换一趟**之后键变了 ⇒ 窗口清空重来。**必须**这样：速度是"这一项"的速度，
     *    把上一项的字节留在窗口里，换项后的第一个速度会是**负数**或一个荒唐的大数，
     *    而界面照旧把它印出来（T1 那段注释写着这件事）。
     *    ⚠️★ **换一趟同理（T5 评审 Important 2）**：同一个 mod 在 3 秒内被重下一次
     *    （取消后立刻重试）时，前三个格子全一样 —— 没有 `runStartedAt` 那一格的话窗口
     *    不会重开，上一趟最后那个样本与新一趟第一帧一起进 `rateOf` ⇒ 速度印成 `0 B/s`。
     * ⚠️★ 订阅**在 `getState()` 之前**（与 `onStatus` 同一个 effect、同一条理由）：
     *    反过来的话，起手那一帧会落在订阅之前 ⇒ 那一段时间的字节没有任何人收到。
     * ⚠️★★ C1：走 `subscribeProgress`（**有 `onProgress` 才订阅，没有就给 no-op 退订**）——
     *    旧壳里直接调 `api.onProgress(...)` 会在这一行同步抛，而全仓没有 error boundary
     *    ⇒ 整页白屏（现场写在 `capabilitiesOf` 那一段）。⛔ 别改回 `api.onProgress(...)`。
     */
    const unsubscribeProgress = subscribeProgress(api, (frame) => {
      setLive((prev) => {
        const at = Date.now();
        const sameItem = prev !== null && progressKeyOf(prev.frame) === progressKeyOf(frame);
        return {
          frame,
          samples: withSample(sameItem ? prev.samples : [], {
            at,
            received: frame.received,
            total: frame.total,
          }),
        };
      });
    });
    void api.getState().then(
      (initial) => {
        // ⚠️ 已经有数据 ⇒ 丢掉这一份（推送与首拉谁先到是不保证的；不要用更旧的盖回去）。
        setLoad((prev) =>
          prev.status === 'ready'
            ? prev
            : reduceModFoldersLoad(prev, { kind: 'snapshot', state: initial }),
        );
      },
      (error: unknown) => {
        setLoad((prev) => reduceModFoldersLoad(prev, { kind: 'failure', reason: reasonOf(error) }));
      },
    );
    return () => {
      unsubscribeProgress();
      unsubscribe();
    };
  }, [api, accept]);

  if (api === null) return { status: 'unavailable' };
  if (load.status === 'failed') return { status: 'failed', reason: load.failure };
  if (load.status === 'ready') {
    /*
     * ⚠️ `handlers` 在这里一定非空（`api !== null` 时 `useMemo` 就给了它），
     *    但类型推断看不出来 ⇒ 用一个显式的判据而不是 `!`：`!` 会把"哪天有人把
     *    `handlers` 的构造挪走"这种改动变成一次运行期崩溃（点了没反应那一种）。
     */
    if (handlers === null) return { status: 'loading' };
    return {
      status: 'ready',
      state: load.state,
      handlers,
      actionError,
      progress: progressOf(load.state, live),
    };
  }
  return { status: 'loading' };
}

/**
 * 第一次拉状态那一屏（**Ruling 42**）：它可能先等一次补扫（读每个 jar 的内部版本与哈希）。
 *
 * ⚠️★ 做成一个**独立导出的纯组件**的理由：`renderToStaticMarkup` 不跑 effect，而自检里
 *    没有 preload（`window.mcsr` 是 `undefined`）⇒ `useModFolders()` 在自检里恒为
 *    `unavailable`。它单独导出来，那一屏的文字才**能被断言**。
 */
export function ModCatalogScanning() {
  const { t } = useTranslation();
  return (
    <section className="filespanel">
      <p className="filespanel__hint">{t('files.catalogScanning')}</p>
      <p className="filespanel__meta">{t('files.catalogScanningHint')}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 选项表与闸（文件夹那一行与面板头共用；T6 之前住 `ModFoldersPanel.tsx`）
// ---------------------------------------------------------------------------

/**
 * ★★ 这一行**给不给更新按钮**的判据（**只有这一处实现**）。
 *
 * 判据：`older` 与 `different-build` 是主进程 `assertUpdatable` **放行**的那两支，
 * 而 `manual`（OptiFine 那一类）一律不给（spec §8 的"绝不替换"）。
 * ⚠️ 判据**不是** `batchable`：那只认 `older` + `download === 'auto'` + 两边版本主体
 *    可排序 ⇒ `different-build`（"同版本号、字节不同"或"排不出先后"）那一行会
 *    **一颗按钮都没有**，而它正是"要人显式点一下"的那一支（收口波的纠正）。
 * ⚠️★ T6 之前这条 allow-list 在本仓有**三处逐字相同的文本**（第一部分那张表、
 *    旧第二部分的行、`FolderJarList`）⇒ 前两处随文件删掉，剩下的一处收进这里并具名。
 *    代价（认）：主进程那一侧的判据是 `assertUpdatable` 里那个 `switch`，两边仍然是
 *    两份文本 —— 它们**必须**一致（界面画了按钮而主进程拒 = 一次注定被拒的点击），
 *    但它们在两个包里（`apps/web` 与 `apps/desktop`），共享只能靠 spec §8 那张表。
 * ⚠️ 形参收窄成"只有两格"：`CatalogRowView` 与 `ModFolderRowView` 都满足它，
 *    而收窄让"传一个别的行进来"在编译期就红。
 */
export function isUpdatableRow(row: { verdict: FolderVerdict; manual: boolean }): boolean {
  return !row.manual && (row.verdict.kind === 'older' || row.verdict.kind === 'different-build');
}

/**
 * 文件夹的游戏版本下拉**选项表**。
 *
 * ⚠️★ 判据与页面头那一格的 `gameVersionOptions()` 逐字相同（同一份纪律；两份函数是因为
 * 那一份带的是 `state` 里那个全局选中版本、这一份带的是**这个文件夹**的版本）：
 *   · 全集来自 `state.gameVersions`（目录的 107 个版本，Ruling 58）——**不是**"当前值
 *     ∪ 推断值"那种凑法：凑法让没绑文件夹的客户端只有一个选项；
 *   · 当前那一版**必须在选项里**：目录换过之后 `folders[].gameVersion` 可能指向一个
 *     已经不在目录里的版本，而 `<select value=X>` 里没有 X 时浏览器会**静默选中第一个**
 *     —— 那一屏就在撒谎（用户看到"我的选择被改掉了"，而状态里那一格没变）。
 * ⚠️ `null`（自动推断）**不在这里**：它由组件里那个空取值的 `<option>` 表达
 * （`value=""` 对应 `setFolderGameVersion(folderId, null)`），因为它是"交回自动推断"，
 * 不是"目录里的某一版"。
 */
export function folderGameVersionOptions(state: ModFoldersState, folder: ModFolderView): string[] {
  const version = folder.gameVersion;
  if (version === null || isKnownGameVersion(state.gameVersions, version)) {
    return [...state.gameVersions];
  }
  return [version, ...state.gameVersions];
}

/** 一个下拉选项：值 + 词条 key + 那条词条的插值。 */
interface ChannelOption {
  value: string;
  key: string;
  vars: { label?: string; hosts?: string; id?: string };
}

/**
 * 批量通道下拉的选项表：`origin` + 状态里那份镜像表。
 *
 * ⚠️★ 镜像那一格的文案**带上 `hosts`**（`files.channelMirror`）：`channelUrl` 只在
 * "这个 release 的主机在这条镜像的 `hosts` 里"时才给地址，而这一格的选择在
 * 「全部更新」里是**一个通道打底 N 条** ⇒ 用户点之前就该看得出这条通道覆盖谁。
 * ⚠️ `label` / `hosts` 是**目录里的内容**，一律原样印（不翻译）——与
 * `CatalogRowView.name` 同一条。
 * ⚠️★ `prefs.bulkChannel` 里那个 id **可能已经不在镜像表里**（目录换过之后）：那时补
 * 一个选项出来（`files.channelStale`），否则 `<select value=X>` 会**静默选中第一个**
 * —— 界面显示 `origin`、而主进程按存下来的镜像 id 下载（Ruling 23 反对的正是这件事），
 * 而且完全不报错。
 */
export function channelOptions(state: ModFoldersState): ChannelOption[] {
  const options: ChannelOption[] = [{ value: 'origin', key: 'files.channelOrigin', vars: {} }];
  for (const mirror of state.mirrors) {
    options.push({
      value: mirror.id,
      key: 'files.channelMirror',
      vars: { label: mirror.label, hosts: mirror.hosts.join(', ') },
    });
  }
  const current = state.bulkChannel;
  if (current !== 'origin' && !isKnownMirror(state.mirrors, current.mirrorId)) {
    options.push({
      value: current.mirrorId,
      key: 'files.channelStale',
      vars: { id: current.mirrorId },
    });
  }
  return options;
}

/**
 * 头行那个通道下拉的**当前值**（`state.bulkChannel` 的字符串形式）。
 * ⚠️ 一处记忆：这个值只从状态读，组件里**不存**第二份（Ruling 23）。
 * ⚠️ 导出是给 `VersionFolderList` 那一行复用的：通道的**形状**只有这一处实现
 * （`'origin' | { mirrorId }` ⇒ 下拉的字符串），两处各写一份就会有一天对不上。
 */
export function channelKeyOf(channel: Channel): string {
  return channel === 'origin' ? 'origin' : channel.mirrorId;
}

/**
 * ★★ 状态里那条批量通道**还成立吗**（**Ruling 64**，2026-10-03 T8 评审判修）。
 *
 * ⚠️★ 过期的持久化值**可以显示**（`channelOptions` 补出来的那个 `files.channelStale`
 *    选项，用户看得见"状态漂了"），但**不许被当成一个新动作发出去**：
 *    `requireChannel`（`apps/desktop/src/mod-folders.ts`）在"这个镜像 id 不在目录的
 *    `mirrors[]` 里"时**抛** ⇒ 照发的后果是一次**什么都没做**的点击 + 一句红字。
 * ⇒ 判据收在这一个函数里，两个渲染点（面板头那句解释 / 文件夹行的「全部更新」）共用它。
 * ⚠️ `'origin'` 永远成立（`requireChannel('origin')` 根本不碰目录）⇒ 它不在这条判据里；
 *    同理**行内那两颗更新按钮**不看它：它们的镜像来自 `state.mirrors`（永远新鲜）。
 */
export function bulkChannelUsable(state: ModFoldersState): boolean {
  /*
   * ⚠️ 先取到局部 const 再收窄：`Channel` 是联合类型（`'origin' | { mirrorId }`），
   *    而收窄**穿不过闭包**（`.some(cb)` 里的 `state.bulkChannel.mirrorId` 会让 tsc
   *    报 TS2339）—— 一个 const 的收窄才在闭包里成立。
   */
  const channel = state.bulkChannel;
  if (channel === 'origin') return true;
  return isKnownMirror(state.mirrors, channel.mirrorId);
}

/**
 * ★ 这个文件夹的游戏版本**已经不在目录里**了（目录换过之后的旧值）；不是那种情况给 `null`。
 *
 * ⚠️★ 抽出来是 A 的 T3 **判修轮**要求的：新那一行（`VersionFolderList`）与旧那一版
 *    各写了一份**逐字相同**的表达式 ⇒ 两份迟早会漂，而漂的表现是"下拉里少一个
 *    `disabled`"（看起来像目录坏了）。
 * ⚠️ 它为什么必须**照画**（而不是把旧值藏掉）：`<select value=X>` 里没有 X 时浏览器会
 *    **静默选中第一个** —— 那一屏就在撒谎（Ruling 23 反对的正是这件事）；而它必须
 *    `disabled`：`requireGameVersion` 只认目录里有的版本（**Ruling 64**：
 *    过期的持久化值可以显示，不许被当成新动作发出去）。
 */
export function staleGameVersion(state: ModFoldersState, folder: ModFolderView): string | null {
  const version = folder.gameVersion;
  if (version === null || isKnownGameVersion(state.gameVersions, version)) return null;
  return version;
}

/**
 * ★★ 「全部更新」那一颗**画不画**（一次批量写盘的四条闸）：路径在 / 版本知道 /
 *    真的有可批量的行 / 状态里那条通道还成立（Ruling 64）。
 *
 * ⚠️★ 抽出来是 A 的 T3 **判修轮**要求的：新那一行（`VersionFolderList`）与旧那一版
 *    原来各写着**逐字相同**的四条件表达式 ⇒ 一处漂了，另一处会照旧画一颗主进程必拒的
 *    按钮（或者相反：静默少一颗，用户只会觉得"按钮怎么没了"）。
 * ⚠️ "真有可批量的行"那一条不是保险：`updateFolderAll` 在"这个文件夹还没有扫描读数"时**拒**
 *    （它那句 `readingOf(id).ok`），而"没扫过"与"它是空的"在状态里长得一模一样（`rows` 都是
 *    空数组）⇒ 0 条可批量时干脆不画，那条拒绝就**不可达**了。
 */
export function canUpdateFolderAll(state: ModFoldersState, folder: ModFolderView): boolean {
  return (
    folder.pathExists &&
    folder.gameVersion !== null &&
    batchTargets(folder.rows) > 0 &&
    bulkChannelUsable(state)
  );
}

// ---------------------------------------------------------------------------
// 文案表与裸 key 扫描器（T6 之前住 `FileUpdateTable.tsx`；v1 那张表随 D1 删掉）
// ---------------------------------------------------------------------------

/*
 * ⚠️★ 扫描器与"算不算泄漏"必须共用**这一个**对象（`rawKeysIn` 只认它）：
 *    两处各写一份的话，坏掉的那一份不会有任何断言出声 —— 一条在撒谎的守卫
 *    （`accountrender.tsx` 里那两条探针就是为这件事写的，照它的形状来）。
 * ⚠️ 两个前缀是这一页真正会渲染的两本字典：`files.*`（这一页自己的词条）与
 *    `common.*`（`common.empty` 的空态、`common.loading`）。少一支，那一支上的
 *    裸 key 就等于空跑。
 * ⚠️ 它**不会**误伤正常文案：值里出现 `files.` / `common.` 开头的点子串才命中，
 *    而今天两本字典里没有任何一条值长这样（只有 key 长这样）。
 */
export const RAW_KEY_RE = /(?:files|common)\.[A-Za-z]+/g;

/**
 * 一段渲染产物里所有的裸 key（去重）。
 *
 * ⚠️ 这个 `/g` 对象被反复使用：`String.prototype.match` 每次都会先把 `lastIndex`
 *    归零，所以调用之间不互相影响（`accountrender.tsx` 那一处写着同一条）。
 */
export function rawKeysIn(markup: string): string[] {
  return [...new Set(markup.match(RAW_KEY_RE) ?? [])];
}

/**
 * 状态徽章（判定的四支 + 两处"没有目标 / 没有绑定"）。
 *
 * ⚠️ 做成 `Record<…, …>` 而不是 `switch` + `default`：`ReleaseVerdict` 加一支时这里
 *    会当场编译失败（`FolderVerdict` 是那两支的并集）。
 * ⚠️★ 按 `FolderVerdict` 定型是**承重的**：文件夹行的 `verdict.kind` 是那个更宽的联合，
 *    用 `ReleaseVerdict` 收窄的话 `VERDICT_BADGES[row.verdict.kind]` 那一行会**当场
 *    编译失败**。
 *    ⚠️ 代价（认）：第三段（`VersionModList`）用的是目录行，**永远渲染不到**
 *      `missing-release` / `unknown-version` 这两支（`rowsForGameVersion` 只返回
 *      "这个游戏版本下有 release"的 mod）—— 它们的存在只是为了让这张表对两个联合都穷尽。
 */
export const VERDICT_BADGES: Record<
  FolderVerdict['kind'],
  { label: string; className: string } | null
> = {
  same: { label: 'files.upToDate', className: 'badge' },
  older: { label: 'files.outdated', className: 'badge badge--update' },
  newer: { label: 'files.verdictNewer', className: 'badge' },
  'different-build': { label: 'files.verdictDifferentBuild', className: 'badge' },
  unknown: { label: 'files.verdictUnknown', className: 'badge' },
  ambiguous: { label: 'files.verdictAmbiguous', className: 'badge' },
  'missing-release': { label: 'files.verdictMissingRelease', className: 'badge' },
  /*
   * ★★ 只有文件夹那一侧才有的状态（spec §8：`mmc-pack.json` 读不出来）。
   *    ⚠️ 它的**解释**不在这里逐行印：那一句话挂在文件夹头行（说一次）—— 每一行重复
   *    一遍是噪声。
   */
  'unknown-version': { label: 'files.verdictUnknownVersion', className: 'badge' },
};

/**
 * 各支欠的那句**解释**（用户唯一能行动的线索）。
 *
 * ⚠️★ 三支必须各有各的说法（spec §8）：`newer` / `different-build` / `unknown` 的
 *    **后果**不同 —— `newer` 与 `unknown` 是"不给更新"，而 `different-build`
 *    **有一颗显式的更新按钮**（它正是"要人点一下"那一支，见 `isUpdatableRow`）
 *    ⇒ 它那句话要**说清那颗按钮会做什么**（用官方那条替换掉本地这份不同的字节）。
 *    ⚠️ 文案**不许**承诺"版本号相同"：这一支也装了"两边版本号排不出先后"那一类输入
 *    （2026-10-04 收口波：实测 `HD_U_F9` vs `HD_U_F10` 就是一次两个版本号**不同**的
 *    `different-build`）。
 * ⚠️ `ambiguous` 与 `manual` 的解释按各自的判据取（它们与本地读数无关）。
 * ⚠️★ `missing-release` 那一句**只在文件夹那一侧出现**（目录行到不了那一支）；
 *    `unknown-version` **不在**这里：它的解释是文件夹级的一句话（见徽章表那段），
 *    逐行印没有新信息。
 * ⚠️★ 第三段（`VersionModList`）也读这张表：`ambiguous` / `missing-release` 那两行
 *    没有"该装哪一个"的答案 ⇒ 页面画的是解释而不是一颗注定被拒的下载按钮。
 */
export const VERDICT_HINTS: Partial<Record<FolderVerdict['kind'], string>> = {
  newer: 'files.hintNewer',
  'different-build': 'files.hintDifferentBuild',
  unknown: 'files.hintUnknown',
  ambiguous: 'files.hintAmbiguous',
  'missing-release': 'files.hintMissingRelease',
};

/**
 * 标签 key ⇒ 显示名（**状态里那一格**两种语言都有 ⇒ 按当前语言取）。
 *
 * ⚠️ 查不到时退回 **key 本身**（不是猜一个名字）：目录里没有它的显示名就是目录的缺陷，
 *    界面上显示 key 正是"看得见的缺陷"（与 `tagLabelsOf` 的退化同一条纪律）。
 * ⚠️★ 第一格从 `state` 收窄成 `state.tags`：第三段（`VersionModList`）也要取显示名，
 *    而它手里只有那一格标签全集（`VersionModRow` 不带 `tagLabels`，页面把 `state.tags`
 *    当 prop 喂下去）。⇒ 这是"同一件事只有一处实现"：几个渲染点**复用**它，
 *    不再抄一份查表。
 */
export function tagLabelFor(tags: ModFoldersState['tags'], tag: string, lang: 'zh' | 'en'): string {
  return tags.find((option) => option.key === tag)?.labels[lang] ?? tag;
}

/**
 * 游戏版本下拉的选项表（Ruling 58：来自状态里那一格**目录的版本全集**）。
 *
 * ⚠️★ 不再从"当前值 ∪ 已绑定文件夹推断出的版本"里凑（T7 第一版的写法，已删）：那样
 *    没绑定文件夹的客户端上这个下拉**只有一个选项**，而目录里实测有 **107** 个版本
 *    ⇒ D4 的那个维度等于不存在。
 * ⚠️ 当前选中的那一版**必须在选项里**：目录换过之后 `prefs.catalogGameVersion` 可能指向
 *    一个已经不在目录里的版本（`setCatalogGameVersion` 只在**写**的时候校验），
 *    而 `<select value=X>` 里没有 X 时浏览器会**静默选中第一个选项** —— 那一屏就在撒谎。
 *    ⇒ 不在全集里就把它补在最前面（用户看得见自己选的是哪个，也看得见它已经不在目录里）。
 */
export function gameVersionOptions(state: ModFoldersState): string[] {
  return isKnownGameVersion(state.gameVersions, state.gameVersion)
    ? [...state.gameVersions]
    : [state.gameVersion, ...state.gameVersions];
}
