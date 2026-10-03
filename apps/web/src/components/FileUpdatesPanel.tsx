/**
 * 「文件更新」面板 —— `/files` 那一页的**数据层**与容器。
 *
 * ===========================================================================
 * ⚠️★ 为什么取数住在这里，而不是住在路由页里
 * ===========================================================================
 * 两条路都要同一份 `FileUpdatesState`（表格、按钮、元信息全按它渲染），而
 * `renderToStaticMarkup` —— Task 7 的渲染自检就是它 —— **不跑 effect**：
 * 取数写在页面里的话，自检渲染这一页只会看到「加载中」，写在里面的每一块都断言不到
 * ⇒ 那是一条**不可能红**的守卫。两处出处（评审 2026-09-24 订正过一次，别再把它们混起来）：
 *   · 机制本身（"不点击、不跑 effect"）的现场在 `docs/pending.md §5.73` 那一节（`renderToStaticMarkup`
 *     **不点击、不跑 effect** ⇒ 自检只看得见"初始产物"）；`components/ShareCard.tsx` 的文件头
 *     是同一个处置的先例（界面全部搬进纯组件，页面只取数）。
 *   · §5.63 讲的是另一件事：**守卫把要断言的东西先擦掉了 ⇒ 那条断言恒真**（恒真的守卫
 *     比没有守卫更坏）。它是"为什么不能靠一条自检兜住这种页面"的理由，不是这条事实的出处 ——
 *     出处是上面那一条。
 * ⇒ 这个文件里有两样东西，各自只负责一件事：
 *   · `useFileUpdates()`：**取数**（桌面壳 = 订阅 + 首拉 / 浏览器 = 拉目录），
 *     以及七个动作的包装（`FileUpdatesHandlers`）；
 *   · `FileUpdatesPanel`：**拿一份现成的 `state` 渲染**，不取数、不订阅、不跑 effect
 *     ⇒ Task 7 可以喂一份手写的状态进去（表格那一层更纯：它连本地状态都没有）。
 *     ⚠️★ Task 6 给它加了两格**界面态**（都是"用户刚做了什么"的痕迹，`FileUpdatesState`
 *     里没有这两格）：
 *       · `pending`：「我刚点的那一下还在跑」——「检查」要几秒（一次读盘 + 一次网络请求），
 *         少了它就只能在"点了没反应"和"点了弹一句红字"之间二选一；
 *       · `confirmingUpdateAll`：「一键更新」的两步确认**还等着回答**（fix round 1 加的，
 *         为什么必须两段、以及为什么不用 `window.confirm`，见下面 `UpdateAllConfirm`）。
 *     它们是**界面态**，不是第二份真相：全部作用是把按钮按住 / 把那一步问出来。
 *     ⚠️ 第二态能被 Task 7 断言，靠的是 `UpdateAllConfirm` 那个**纯 props 组件** ——
 *     静态渲染不跑事件处理器，面板自己那一格在自检里恒为 `false`（见那个组件的注释）。
 *
 * ===========================================================================
 * ⚠️★ 桌面态与浏览器态是**两个不同的产品**，共用一份状态形状
 * ===========================================================================
 *   · **桌面壳里**（`desktopBridge()` 非空）：一个字节都**不走 HTTP**。
 *     主进程自己会拉目录、自己读磁盘，`getState()` 与推送回来的是
 *     `FileUpdatesState` —— `shared/desktop.ts` 的 `fileUpdates` 那段写着，
 *     这份状态是页面**唯一**的数据来源。在这里再发一次 `/api/file-catalog`
 *     只会多出第二份会漂的答案。
 *   · **浏览器里**：没有 `window.mcsr`，也就没有任何本地文件。
 *     于是取 `GET /api/file-catalog`，把**每条目录条目**渲染成一行
 *     `state.kind === 'unbound'` 且 `binding === null` 的视图。
 *     ⚠️★ 浏览器里**不许**编造本地读数（不填 `0`、不写"未知"当数据）：
 *     填一个版本号会让这一页看起来像"你确实有一个我读不到的文件"，
 *     而事实是这里**一个文件都读不到**。所以 `localVersion` / `lastCheckedAt` /
 *     `lastKnownLatest` 全是 `null`。
 *     代价（明摆在页面上）：浏览器里的这一页永远是一张"未绑定"的表 ——
 *     那是事实，不是缺陷；`routes/Files.tsx` 会同时说清"本地文件只能在桌面版操作"。
 *
 * ===========================================================================
 * ⚠️★ 订阅与「立刻拉一次」的**先后不能反**
 * ===========================================================================
 * 与 `DesktopBridge.update.getStatus()` 那段注释同一条理由：主进程在应用启动时就
 * 拉过一次目录、写过一份状态，而这一页要等远程网页加载完才挂载 ⇒ 检查早于订阅时
 * 那一次推送**没有任何人收到**，表现是"界面上永远停在加载中"，而完全不报错。
 * ⇒ 顺序是：**先订阅，再立刻 `getState()` 一次**。
 *
 * ===========================================================================
 * ⚠️ 动作失败（`reject`）在这里接住，不让它消失
 * ===========================================================================
 * T4 的 `bind()` / `update()` 失败时**抛**，靠 `reject` 把消息带回渲染进程
 * （`apps/desktop/src/file-updates.ts` 的 `bind()` 注释里写着这件事：`FileUpdatesState`
 * 里没有"这一次操作的结果"这一格）。⇒ 七个动作由这里的 `makeHandlers()` 统一接住：
 * 成功 ⇒ 把主进程返回的**整份状态**落到界面上；失败 ⇒ 把原话交给 `files.actionFailed`
 * 显示（用户在选择对话框里取消**不算失败** —— 主进程返回原状态，一个字节都不变）。
 */

import { type DesktopBridge, desktopBridge } from '@mcsr/shared/desktop';
import {
  type FileCatalog,
  type FileCatalogItem,
  type FileItemView,
  type FileUpdatesState,
  isDisabledPath,
  needsUpdate,
} from '@mcsr/shared/fileUpdates';
import type { Channel, ModFoldersState } from '@mcsr/shared/modFolders';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileUpdateTable, formatClock, ModCatalogTable } from '@/components/FileUpdateTable';
import { Notice } from '@/components/Form';

/**
 * 把契约里**某一个**动作的入参搬过来，返回值换成 `Promise<void>`。
 *
 * ⚠️ 入参用 `Parameters<…[K]>` 取，而不是照抄一遍：契约那边给某个方法加一个参数时，
 *    照抄的那一份会**悄悄**少一个（症状是"点了没反应"—— 主进程收到 `undefined` 之后抛）。
 */
type VoidAction<K extends keyof DesktopBridge['fileUpdates']> = (
  ...args: Parameters<DesktopBridge['fileUpdates'][K]>
) => Promise<void>;

/**
 * 面板要用的七个动作 —— **就是 `DesktopBridge['fileUpdates']` 去掉两条取数方法**。
 *
 * ⚠️ 返回值是 `Promise<void>`，**不是**主进程那个 `Promise<FileUpdatesState>`：
 *    `makeHandlers()` 已经把结果落到状态上了，调用方（Task 6 的按钮）不需要
 *    —— 也**拿不到** —— 自己去 setState。那条"结果要落到界面上"的规矩只有一处实现。
 * ⚠️ 这里**只列七个动作**：`getState` / `onStatus` 是取数，住在 `useFileUpdates()` 里，
 *    不交给按钮那一层（页面不该自己再造一条取数路径 —— 那就是第二份会漂的真相）。
 */
export interface FileUpdatesHandlers {
  bind: VoidAction<'bind'>;
  bindFolder: VoidAction<'bindFolder'>;
  unbind: VoidAction<'unbind'>;
  setAutoUpdate: VoidAction<'setAutoUpdate'>;
  check: VoidAction<'check'>;
  update: VoidAction<'update'>;
  updateAll: VoidAction<'updateAll'>;
}

/** `useFileUpdates()` 的产物。⚠️ 三个状态互斥，所以做成联合类型而不是几个可空的布尔。 */
export type FileUpdatesData = {
  /** 桌面壳里才有动作；浏览器里是 `null`（那一半**一个写盘动作都做不了**）。 */
  handlers: FileUpdatesHandlers | null;
  /** 最近一次动作的失败原话（`null` = 没失败过）。面板用 `files.actionFailed` 显示它。 */
  actionError: string | null;
} & (
  | { status: 'loading' }
  | { status: 'ready'; state: FileUpdatesState }
  /**
   * 连**第一份状态**都没拿到。`failedAt` 记的是哪一半失败的 —— 两边的说法不同
   * （浏览器是"目录拉不到"，桌面壳是"连状态都拿不到"），所以词条也分两条。
   */
  | { status: 'failed'; failedAt: 'catalog' | 'state'; reason: string }
);

export interface FileUpdatesPanelProps {
  state: FileUpdatesState;
  /** 见 `FileUpdatesHandlers`。`null` = 浏览器态（没有动作可做）。 */
  handlers: FileUpdatesHandlers | null;
  /**
   * ★ 一次动作失败的原话。**可选**，因为它是动作层的东西：
   *   Task 7 的渲染自检拿一份手写状态就能渲染这个面板（那里不会发生失败），
   *   而只有 `useFileUpdates()` 会填它。
   */
  actionError?: string | null;
}

// ---------------------------------------------------------------------------
// 取数那两格（快照 / 失败结论）的归约 —— 纯函数，好让它能被一条探针钉住
// ---------------------------------------------------------------------------

/** 一次取数结果的两种形态。⚠️ 它们是**两件事**：一份数据，或者一句"没拿到"。 */
export type FileUpdatesLoadEvent =
  | { kind: 'snapshot'; state: FileUpdatesState }
  | { kind: 'failure'; failedAt: 'catalog' | 'state'; reason: string };

/**
 * 页面手上关于"取数"的全部认识。
 *
 * ⚠️★ 做成**三格互斥的联合**而不是 `{ state, failure }` 两个可空格：这样"数据与失败结论
 * 不可能同时成立"是**类型**保证的，而调用方（`useFileUpdates` 的返回、探针）判的
 * 就是**页面最终显示哪一屏**（`loading` / `ready` / `failed`）—— 正是缺陷发生的地方。
 */
export type FileUpdatesLoad =
  | { status: 'loading'; state: null; failure: null }
  | { status: 'ready'; state: FileUpdatesState; failure: null }
  | { status: 'failed'; state: null; failure: { failedAt: 'catalog' | 'state'; reason: string } };

/** 什么东西都还不知道的起点。 */
export const NO_LOAD: FileUpdatesLoad = { status: 'loading', state: null, failure: null };

/**
 * ★★ 取数结果的归约：**数据永远压过一次失败结论**。
 *
 * ⚠️★ 为什么必须有这条规则（2026-09-24 评审的必修；我自己的自查修过同一族的第二处）：
 *    桌面态那两条支路是**独立**的（`onStatus` 推送 / `getState()` 首拉），所以
 *    "首拉先失败、推送后带来数据"这个顺序**真的会发生**。把失败结论当成"粘住的"状态
 *    （谁先来谁说了算）会让页面一直停在「拿不到本地文件状态：…」，而手上其实已经有数据 ——
 *    那一句**已经不成立**的话会一直挂在屏幕上。
 *    反方向也要防：已经有数据时又把一次失败记上去，同样是把一句过期的话压在数据上面。
 *    ⇒ 两条都收进这一个函数里（散在两个 `setState` 里就一定有一支会被漏掉）。
 *
 * ⚠️ 抽成**纯函数**是因为它只可能这样被验：web 这一层没有测试运行器，而渲染自检
 *    （`renderToStaticMarkup`）**不跑 effect**（见文件头那两处出处）⇒ 住在 hook 里的话，
 *    "先失败、后拿到数据"这个顺序**没有任何门禁碰得到**（探针在报告里，
 *    住在 gitignore 的 `.cache/` 下 ⇒ 那条判据**不可复跑**，脚本内容抄在报告里）。
 *    代价：多一层间接（hook 里三处 `setLoad` 都走它），换来这条规则可以被当场验红。
 */
export function reduceLoad(prev: FileUpdatesLoad, event: FileUpdatesLoadEvent): FileUpdatesLoad {
  if (event.kind === 'snapshot') {
    // 数据到手 ⇒ 上一次的失败结论作废（它已经被这份数据推翻了）
    return { status: 'ready', state: event.state, failure: null };
  }
  // 已经有数据 ⇒ 这一次失败**不改画面**（保留那份状态，不记这一句）
  if (prev.status === 'ready') return prev;
  return {
    status: 'failed',
    state: null,
    failure: { failedAt: event.failedAt, reason: event.reason },
  };
}

/**
 * ★ 一键更新**真的会碰**哪几条 —— 与主进程那份筛选逐条对齐。
 *
 * ⚠️★ 为什么界面要自己再算一遍：确认框里那个数字必须等于"点下去真的会更新几条"，
 *    而 `FileUpdatesState` 里没有"这一次会更新哪些"这一格（它只有**跑完之后**的
 *    `lastRun`）⇒ 只能自己筛。三格判据与 `apps/desktop/src/file-updates.ts` 的
 *    `updateAll()` 逐格相同：绑定了（`binding` 非空、路径非空）、`needsUpdate(state)`、
 *    而且**不是 `.disabled`**（一键更新跳过被禁用的绑定 —— spec §8 明写；
 *    单条的「更新」不跳，它会先问一次要不要把它启用，见 T4 的 `confirmEnable`）。
 * ⚠️ 代价：这是**第二份**判据，会漂，而漂的方向正是"确认框说 3 个、实际更新 2 个"
 *    （用户唯一的读数就是那个弹窗）。漂的余地只剩"绑定是不是空的"那一格 ——
 *    `needsUpdate` / `isDisabledPath` 两边调的都是 T1 那一份实现。
 */
export function updateAllTargets(views: readonly FileItemView[]): FileItemView[] {
  return views.filter(
    (view) =>
      view.binding !== null &&
      view.binding.localPath !== '' &&
      needsUpdate(view.state) &&
      !isDisabledPath(view.binding.localPath),
  );
}

/**
 * ★★ 「一键更新」的**第二态**：行内两步确认的那一行（纯 props，给 `count` 就画完）。
 *
 * ⚠️★ 为什么不用 `window.confirm`（fix round 1 改的；先前那一版照的是 brief 的原文，
 *    而那是控制器的笔误）：`ShareBoard.tsx` 那条理由在这里是**决定性的** ——
 *    「`window.confirm` 在 SSR 里不跑、门禁看不见，还会让"两个 step 在组件里"这件事
 *    变成两处状态」。也就是说，用它换来的一步确认**拿不到任何自动化判据**，
 *    而 Task 7 正要给这一页写渲染自检。本仓另有若干同形的记录
 *    （`VideoCard` / `CalendarSeriesSection` / `LiveManagePanel` / `TagCloud` /
 *    `TrackedVideos` / `EditResource`），形状照前两处：句子 + 「确认」+「取消」。
 * ⚠️★ 拆成一个**独立导出的纯组件**是为了让第二态**能被静态渲染出来**：
 *    `renderToStaticMarkup` 不跑事件处理器 ⇒ 面板里那一格 `confirmingUpdateAll` 在自检里
 *    恒为 `false`，只有"给 props 就画"的这一层能断言"第二态 = 那句话 + 两颗按钮"。
 *    ⇒ Task 7 直接 `React.createElement(UpdateAllConfirm, { count: 3, … })` 即可。
 * ⚠️ `count` **每一帧都按当前的 `targets.length` 现算**（面板那边传的是当次渲染的值）
 *    ⇒ 这句话不会过期。代价反过来是：一次后台检查把可更新的行清成 0 之后，
 *    面板会让这一行**自己退回第一态**（见面板里 `showConfirm` 那一处）。
 * ⚠️ 两颗按钮都用**库里已有的词条**（`common.confirm` / `common.cancel`），
 *    问话那一句复用 `files.confirmUpdateAll`（它本来就带 `{{count}}`）—— 一个词条都没新造。
 */
export function UpdateAllConfirm({
  count,
  disabled = false,
  onConfirm,
  onCancel,
}: {
  /** 这一次**真的会更新几条**（`updateAllTargets().length`，不含被禁用的条目）。 */
  count: number;
  /** 现在不能按（有条目正在写盘之类）。两颗都禁用 —— 与 `VideoCard` 的两步确认同形。 */
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="filespanel__confirm">
      <span className="filespanel__confirmtext">{t('files.confirmUpdateAll', { count })}</span>
      <button type="button" className="cta" disabled={disabled} onClick={onConfirm}>
        {t('common.confirm')}
      </button>
      <button type="button" className="ghostbtn" disabled={disabled} onClick={onCancel}>
        {t('common.cancel')}
      </button>
    </div>
  );
}

/** `Error` 之外的抛出物（IPC 那层理论上会给字符串）也要能变成一句人话。 */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 主动取消（卸载）不是失败 —— 与 `lib/useAsync.ts` 里那条处置同一条。 */
function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * 拉一次目录（**只有浏览器态走这条**）。
 *
 * ⚠️ 校验**不做**：这份数据的同一个 schema（T1 的 `parseFileCatalog`）已经在
 *    服务端跑过一遍 —— `routes/fileCatalog.ts` 校验不过直接 500、不返回任何东西
 *    ⇒ 这里拿到的响应要么是合法的目录，要么压根不是 200。
 *    在浏览器里再跑一次 zod 会把整个校验库打进首屏包（几十 KB），换来的是
 *    "服务端已经验过一遍的东西再验一遍"。代价写明：**真**出现服务端漏验的形状时，
 *    这一页会按 `FileCatalog` 用类型去读它（越界只会在渲染时露出来）。
 */
async function fetchCatalog(signal: AbortSignal): Promise<FileCatalog> {
  const res = await fetch('/api/file-catalog', { signal });
  if (!res.ok) {
    /*
     * 服务端那三个 500 把原因写成**机器可读的码**（`catalog_unavailable` /
     * `catalog_invalid` / `catalog_invalid_json`），而 `problems` 是它唯一的
     * 自解释字段（那条路由的注释里写明：那是调用方唯一能自己动手修的线索）。
     * ⚠️ 这三个码今天**没有**更好的说法（Task 7 的后续项）⇒ 原样带出去，
     *    比换成一句"出错了"强：重跑部署 / 改文件是两件不同的事。
     */
    let reason = `HTTP ${String(res.status)}`;
    try {
      const body = (await res.json()) as { error?: unknown; problems?: unknown };
      if (typeof body.error === 'string') reason = body.error;
      if (Array.isArray(body.problems)) {
        const problems = body.problems.filter((p): p is string => typeof p === 'string');
        if (problems.length > 0) reason = `${reason}（${problems.join('; ')}）`;
      }
    } catch {
      /* 响应体不是 JSON（反向代理回的 HTML 之类）⇒ 状态码就是我们知道的一切 */
    }
    throw new Error(reason);
  }
  return (await res.json()) as FileCatalog;
}

/** 浏览器态的一行：目录里有它，而**本机什么都没绑**。 */
function unboundView(item: FileCatalogItem): FileItemView {
  return {
    item,
    binding: null,
    localVersion: null,
    state: { kind: 'unbound' },
    lastCheckedAt: null,
    lastKnownLatest: null,
  };
}

/** 浏览器态的整份状态。⚠️ 各字段的"为什么是空"写在上面 `unboundView` 那一段。 */
function browserState(catalog: FileCatalog | null, catalogError: string | null): FileUpdatesState {
  return {
    catalog,
    catalogError,
    items: (catalog?.items ?? []).map(unboundView),
    busyItemId: null,
    progress: null,
    lastCheckedAt: null,
    lastRun: null,
  };
}

/**
 * 七个动作的包装 —— 成功落状态、失败落一句话。
 *
 * ⚠️ 两件事**只有这一处实现**：把主进程返回的状态落到界面上；以及接住 `reject`。
 *    分开写的话，"某一条忘接 reject"的表现是浏览器控制台里一条未处理的拒绝，
 *    而用户那边**什么都没发生**（正是本仓反复记录的那种静默失效）。
 */
function makeHandlers(
  api: DesktopBridge['fileUpdates'],
  apply: (state: FileUpdatesState) => void,
  fail: (message: string | null) => void,
): FileUpdatesHandlers {
  const run = async (call: () => Promise<FileUpdatesState>): Promise<void> => {
    /*
     * ⚠️★ 开跑之前先把**上一次**的失败结论撤掉。它说的是上一次那个动作，而这一次
     *    我们还什么都不知道；不撤的话，用户照提示改好、按第二次成功之后，
     *    上一句红字会一直挂在页面上 —— 那是**已经不再成立**的一句话
     *    （与 `routes/ShareIntro.tsx` 里"重试前先撤掉失败结论"是同一个形状）。
     */
    fail(null);
    try {
      apply(await call());
    } catch (error) {
      fail(reasonOf(error));
    }
  };

  return {
    bind: (itemId: string) => run(() => api.bind(itemId)),
    bindFolder: () => run(() => api.bindFolder()),
    unbind: (itemId: string) => run(() => api.unbind(itemId)),
    setAutoUpdate: (itemId: string, on: boolean) => run(() => api.setAutoUpdate(itemId, on)),
    check: (force?: boolean) => run(() => api.check(force)),
    update: (itemId: string) => run(() => api.update(itemId)),
    updateAll: () => run(() => api.updateAll()),
  };
}

/**
 * 取数。⚠️ 浏览器态与桌面态各一条支路，**互斥**（判据是 `desktopBridge()`）。
 */
export function useFileUpdates(): FileUpdatesData {
  /*
   * ★ 快照与失败结论**装在同一个状态里**（`reduceLoad()` 是它们之间唯一的规则）：
   *   分成两个 `useState` 的话，"数据到手要撤掉失败结论"这件事就得在两个地方各写一遍，
   *   而漏掉的后果正是评审抓到的那一条 —— 页面永远停在「拿不到本地文件状态」。
   */
  const [load, setLoad] = useState<FileUpdatesLoad>(NO_LOAD);
  const [actionError, setActionError] = useState<string | null>(null);

  /*
   * ⚠️ `desktopBridge()` 读的是 `globalThis.mcsr`：preload 在页面脚本之前就注入了它，
   *    而且**每次读取拿到的是同一个对象** ⇒ 可以拿它当 effect 的依赖（跑一次）。
   *    ⚠️ 别写成 `useState(() => desktopBridge())`：那样浏览器里与桌面壳里就分成
   *    两条初始化路径，而"是不是桌面壳"这件事本身**只在渲染期判断**更简单。
   */
  const bridge = desktopBridge();

  /** 拿到一份快照（首拉 / 推送 / 动作的返回值都走这里）。 */
  const accept = useCallback((state: FileUpdatesState) => {
    setLoad((prev) => reduceLoad(prev, { kind: 'snapshot', state }));
  }, []);

  const handlers = useMemo(
    () => (bridge ? makeHandlers(bridge.fileUpdates, accept, setActionError) : null),
    [bridge, accept],
  );

  useEffect(() => {
    // ---- 浏览器态：拉一次目录，以后不再动（这一页没有轮询，也不需要） ----
    if (!bridge) {
      const controller = new AbortController();
      void fetchCatalog(controller.signal).then(
        (catalog) => {
          accept(browserState(catalog, null));
        },
        (error: unknown) => {
          if (isAbort(error)) return;
          setLoad((prev) =>
            reduceLoad(prev, { kind: 'failure', failedAt: 'catalog', reason: reasonOf(error) }),
          );
        },
      );
      return () => {
        controller.abort();
      };
    }

    // ---- 桌面态：先订阅，再立刻拉一次（顺序的代价写在文件头） ----
    const unsubscribe = bridge.fileUpdates.onStatus(accept);

    void bridge.fileUpdates.getState().then(
      (initial) => {
        /*
         * ⚠️ 判据是**当时手上有没有数据**（在 updater 里现读，不靠闭包里的旧值）：
         *    有 ⇒ 丢掉这一份；没有 ⇒ 收下。
         *    ⚠️ 不能改成"这一次会话里有没有推送过"那种记法：`getState()` 回包与推送
         *    谁先到是不保证的，而真正要守的规则只有一条 —— 界面已经有数据时，
         *    不要用一个更旧（或不更新）的快照把它盖回去。
         */
        setLoad((prev) =>
          prev.status === 'ready' ? prev : reduceLoad(prev, { kind: 'snapshot', state: initial }),
        );
      },
      (error: unknown) => {
        setLoad((prev) =>
          reduceLoad(prev, { kind: 'failure', failedAt: 'state', reason: reasonOf(error) }),
        );
      },
    );

    return unsubscribe;
  }, [bridge, accept]);

  /*
   * ⚠️★ 判据就是**页面最终显示哪一屏**（`FileUpdatesLoad` 那三格是互斥的联合）：
   *    数据排在失败结论前面 —— 否则"先失败、后拿到数据"会停在失败那一屏。
   */
  switch (load.status) {
    case 'ready':
      return { status: 'ready', state: load.state, handlers, actionError };
    case 'failed':
      return {
        status: 'failed',
        failedAt: load.failure.failedAt,
        reason: load.failure.reason,
        handlers,
        actionError,
      };
    default:
      return { status: 'loading', handlers, actionError };
  }
}

/**
 * 面板本体 —— **拿一份现成的状态渲染**：不取数、不订阅、不跑 effect。
 *
 * ⚠️★ 表格（`components/FileUpdateTable.tsx`）是 **Task 6** 的：它**纯展示**
 *    （给 `views` 就画完，连本地状态都没有），面板只负责把 `state.items` 与四个
 *    动作的回调递下去。T5 当初在这里留了一个**空挂载点**并写明"刻意不预建表格的形状"
 *    —— 就是为了让 Task 6 不用先删掉一版猜出来的表头/行/徽章；这一轮那个挂载点换成了
 *    真表格，`data-views`（"面板真的把 N 条视图交给了表格"）跟着搬进表格那一层。
 *
 * ⚠️★ 「选择 mods 目录」那颗按钮（`files.bindFolder`）是 T5 多做的一件，Task 6 接手
 *    照旧保留（控制器把它判给了 Task 6）：全仓没有任何任务认领 `bindFolder()` 那条通道
 *    （T3 建了它、T4 实现了它、`content/file-catalog.json` 整条路就是为它铺的），
 *    搬走它那个功能在界面上就点不到了。它**不影响**新增的那两颗：三颗并排一行。
 *
 * ⚠️★ 「检查」与「一键更新」为什么住在**面板**而不是表格：它们是**整张表**的动作
 *    （一次全量检查 / 一次串行更新），而表格那一层每行一个动作、拿不到"整体"这件事。
 *    这也是 Task 7 断言"没有可更新的行时一键更新禁用"的那一层。
 */
export function FileUpdatesPanel({ state, handlers, actionError = null }: FileUpdatesPanelProps) {
  const { t } = useTranslation();
  const views = state.items;
  /*
   * ⚠️ 正在写盘时**禁用**选目录：主进程那一边会直接拒绝并发写
   *    （`apps/desktop/src/file-updates.ts` 的 `updateAll()` 那句「正在更新中：…」），
   *    与其让用户点了吃一句报错，不如把按钮按下去没反应的原因写在脸上。
   */
  const busy = state.busyItemId !== null;
  /*
   * ★ 「我刚刚点的那一下还在跑」——**界面态**，不是第二份真相（为什么要有它见文件头）。
   *   它同时管三件事：按住那两颗按钮、把「正在检查…」印出来、以及"跑的过程中不显示
   *   上一次的汇总"。
   */
  const [pending, setPending] = useState<'check' | 'updateAll' | null>(null);
  /**
   * ★ 「一键更新」的两步确认**还等着回答**（第一态 = 那颗按钮，第二态 = 确认行）。
   *
   * ⚠️ 为什么是**独立**的一格、而不是塞进上面 `pending`：两者说的不是一件事 ——
   *    `pending` 是"动作已经在跑"，这一格是"还**没**开始跑、在等一句话"。
   *    合并的话，"确认行还在等"与"更新正在跑"会挤成同一个取值，而两者该禁用的东西也不同
   *    （前者只在别处忙时禁用，后者要按住整行）。
   * ⚠️ 静态渲染里它恒为 `false`（`renderToStaticMarkup` 不跑事件处理器）⇒ 第二态的判据
   *    由 `UpdateAllConfirm` 那个**纯 props 组件**承担（Task 7 直接喂 props，见它的注释）。
   */
  const [confirmingUpdateAll, setConfirmingUpdateAll] = useState(false);

  /** 一键更新**真的会碰**的那几条（判据与主进程那份逐条对齐，见 `updateAllTargets`）。 */
  const targets = updateAllTargets(views);
  /** 标着"可更新"的那些条目（**只看状态**，不看绑定）—— 下面两个判据的同一个基数。 */
  const updatable = views.filter((view) => needsUpdate(view.state));
  /** 有任一条标着"可更新"（**含已禁用的**）—— 一键更新那颗按钮的可用判据。 */
  const someNeedsUpdate = updatable.length > 0;
  /**
   * ★★ "可更新的条目**全是**已禁用的"这一档：**真的数一遍**（在上面那个基数里数有多少条
   *    的路径以 `.disabled` 结尾），**不是**从 `targets.length === 0` 推出来。
   *
   * ⚠️★ 为什么必须数（fix round 2 改的；先前那一版写的是 `someNeedsUpdate && targets.length === 0`）：
   *    那个式子在"可更新、但**没绑定**"这一档上也会成立（`targets` 要求绑定，
   *    `needsUpdate` 不要求）⇒ 界面会印出"可更新的条目都是已禁用的 —— 一键更新会跳过它们"，
   *    而事实是那些条目**一个文件都没绑**：那是**假话**，而且是这一句存在意义的反面
   *    （它的全部作用就是解释"为什么一键更新不会动"）。契约允许这种组合
   *    （`FileItemView.binding: FileBinding | null` 与 `state` 各自独立），Task 7 的手写夹具
   *    也真会这么造。⇒ 这一格现在算的是它真正要断言的那件事。
   *
   * ⚠️ 判据用的是 `isDisabledPath(binding.localPath)` —— 与徽章、与主进程设
   *    `state.disabled` 时**同一个谓词**（不是第二份判据）。
   * ⚠️ `updatable.length > 0` 那一半不能省：一个可更新的条目都没有时，"全是已禁用的"
   *    这句话没有意义（真正的说法是"一条可更新的都没有"），而那时按钮本身已经禁用了。
   */
  const allUpdatableDisabled =
    updatable.length > 0 &&
    updatable.every((view) => view.binding !== null && isDisabledPath(view.binding.localPath));
  /**
   * ★ 画**第二态**的那一个判据（第一态 = 那颗普通按钮）。
   *
   * ⚠️ 那个 `targets.length > 0` 不是保险：这一问挂在屏幕上时，后台一次检查完全可能把
   *    那几行清成 `current`（`targets` 变成空）⇒ 那时"将把 **0** 个文件更新到最新版本，
   *    继续？"是一句废话，而那颗「确认」按下去什么都不会发生。那一档**退回第一态**
   *    （连同 `allUpdatableDisabled` 那句解释），而 `confirmingUpdateAll` 这一格**不动** ——
   *    用户从没回答过那个问题，数据恢复之后它再出现是对的（句子里那个数字每次渲染现算）。
   */
  const showConfirm = confirmingUpdateAll && targets.length > 0;

  /*
   * ⚠️ 四个回调只在**桌面态**才存在（浏览器态一个动作都做不了）：表格那一层拿不到
   *    回调就不画那颗按钮（见它 props 的说明），`desktop={false}` 是同一件事的第二道闸。
   * ⚠️ 回调里**不 catch**：失败由 `makeHandlers()` 那一层接住并交给 `files.actionFailed`。
   */
  const rowActions =
    handlers === null
      ? null
      : {
          onBind: (itemId: string) => void handlers.bind(itemId),
          onUnbind: (itemId: string) => void handlers.unbind(itemId),
          onToggleAuto: (itemId: string, on: boolean) => void handlers.setAutoUpdate(itemId, on),
          onUpdate: (itemId: string) => void handlers.update(itemId),
        };

  /** 「检查」= 强制刷新（重拉一次目录 + 重读每个已绑定文件 + 查上游）。 */
  const runCheck = (): void => {
    if (handlers === null) return;
    setPending('check');
    void handlers.check(true).finally(() => setPending(null));
  };

  /**
   * 「一键更新」的**第一步**：只把那一步问出来，**不执行任何动作**。
   *
   * ⚠️★ `targets.length === 0` 时连问都不问（`showConfirm` 也画不出来）：可更新的条目
   *    **全是已禁用**的那一档，一键更新一条都不会动，问了也是白问 —— 那时该出现的是
   *    下面那句 `files.updateAllDisabledOnly`。
   */
  const requestUpdateAll = (): void => {
    if (handlers === null || targets.length === 0) return;
    setConfirmingUpdateAll(true);
  };

  /** 第二态的「取消」：退回第一态，什么都不会发生。 */
  const cancelUpdateAll = (): void => {
    setConfirmingUpdateAll(false);
  };

  /**
   * 第二态的「确认」：**关掉确认行，再交给主进程串行做**。
   *
   * ⚠️ 先关确认行再开跑：这一行的下一个画面是行内的"正在更新 …"（表格那边按
   *    `busyItemId` 画），留着那颗「确认」只会让人以为还能再点一次。
   * ⚠️★ 这里再判一次 `targets.length === 0`：`showConfirm` 是**上一次渲染**的结果，
   *    而这一问可能与一次检查擦肩而过（那一瞬间 `targets` 已是空）。真为空时**不调**
   *    `updateAll()` —— 那一趟会一条都不动，却写一个 `lastRun = { updated: [], failed: [] }`
   *    回来、界面上冒出"已更新 0 个，失败 0 个"（一句"我刚才做过一件事"的话，而事实是什么都没发生）。
   */
  const confirmUpdateAll = (): void => {
    setConfirmingUpdateAll(false);
    if (handlers === null || targets.length === 0) return;
    setPending('updateAll');
    void handlers.updateAll().finally(() => setPending(null));
  };

  /**
   * 一次运行的汇总（`state.lastRun`）。
   *
   * ⚠️★ 正在跑的时候**不印**：`lastRun` 是**上一次**的结果，一边跑一边挂着"已更新 2 个"
   *    就是一句已经不成立的话（`makeHandlers()` 开跑前先撤掉上一次的失败结论，同一形状）。
   * ⚠️ 失败的行**不在行里另加标注**：它自己那一行还是「可更新」+「更新」按钮
   *    （brief 明写"失败的行本身保持可重试"），再加一个标记就是同一件事的第二个说法。
   * ⚠️ 代价（明摆着）：它不会自己淡出（`lastRun` 只活在主进程内存里，页面不刷新它就一直在）
   *    ⇒ 用户可能几小时后再看到这句而以为"刚才跑过"。按时间淡出要加定时器，而这一层刻意不跑
   *    effect ⇒ 如实记着，不修。
   */
  const runSummary =
    state.lastRun === null || busy || pending === 'updateAll'
      ? null
      : t('files.runSummary', {
          ok: state.lastRun.updated.length,
          failed: state.lastRun.failed.length,
        });

  return (
    <section className="filespanel">
      {/*
        ⚠️★ 这里是**裸 `<p>`**（不经过 `em()`）⇒ 词条值里若带 `**`，用户看到的就是
        字面星号。`files.autoHint` 那条值里的标记去掉正是**因为这一处**；
        而 `routes/Files.tsx` 里的 `files.browserOnly` 走 `<Notice>`（那会 `em()`），
        它去掉标记是照 carry-in。两条理由不同，别混（`zh-CN.ts` 的 `files` 一节写着）。
      */}
      <p className="filespanel__hint">{t('files.autoHint')}</p>

      {/*
        ⚠️★ 这一行印的是**列表级**的 `state.lastCheckedAt`，而它**只活在主进程的内存里**：
        状态文件（`apps/desktop/src/file-updates.ts` 的 `StateFile`）里只有**每一条**的
        `lastCheckedAt`，顶层那一格既不写也不恢复（`initFileUpdates` 那句
        `current = { ...current, items: rebuildItems() }` 只重建 items）
        ⇒ 进程一重启它就是 `null`，这一行于是印「还没检查过」。

        ⚠️★★ 它**不是**"用户唯一能看出读数有多旧的地方"（那段话 2026-09-24 评审判为**说过头**，
        这里改成事实）：逐条的时间有两格 —— `FileItemView.lastCheckedAt`（这一条上次**检查**的时刻）
        与 `lastKnownLatest.fetchedAt`（上次**成功**读到上游版本的时刻）—— 它们由**表格**印在行里
        （`components/FileUpdateTable.tsx` 里的 `files.rowChecked` 与 `files.lastKnownLatest`）。
        **不是**这一行的职责：这一行只回答"这份列表级别的读数有多旧"。
        两者会不一样，而那不是矛盾：`autoUpdate` 关掉的条目在启动检查里不会被刷新
        （T1 的 `FileBinding.autoUpdate` 与 T4 的 `startUp`）⇒ 同一屏上列表级那个时钟可以
        比某一行自己的时钟新，行里那一格就是给它看的。

        ⚠️ 关于"落盘的旧读数"这种组合（评审提的那个场景）：`viewFor()` 里的
        `lastCheckedAt` 取的是**进程内**的 `facts?.checkedAt ?? null`
        （`apps/desktop/src/file-updates.ts:542`），而状态文件里那份逐条的 `lastCheckedAt`
        **从来没有被读进视图** ⇒ 冷启动后每一行都是 `unchecked` + `lastCheckedAt: null`，
        与这一行的「还没检查过」是**一致**的。这一行今天不会和某一行互相打脸；
        真要说它有错，错在**措辞比事实大**（它只有一个列表级含义，却被写成了逐条的含义）。
      */}
      <p className="filespanel__meta">
        {state.lastCheckedAt === null
          ? t('files.notChecked')
          : t('files.lastChecked', { time: formatClock(state.lastCheckedAt) })}
      </p>

      {/*
        ⚠️★ `catalogError` **原样显示**，不再套 `files.catalogError`：主进程写进去的
        已经是一句完整的话（T4 那边带着「目录拉取失败：」这个前缀，见
        `apps/desktop/src/file-updates.ts` 的 `fetchCatalogFromSite`）⇒ 再套一层就是
        「目录拉取失败：目录拉取失败：…」。`files.catalogError` 那一条词条是
        **浏览器态**自己拼句子时用的（`routes/Files.tsx`）。
        ⚠️ 代价：桌面态这句话是主进程写死的**中文**，英文界面上会夹中文 —— 与
        `error` 行那句 `message` 是同一条已接受的代价。
        ⚠️ 目录拉不到时**不清空** `catalog`（spec §8 要求保留上次缓存）⇒ 这一行
        可能**同时**有错误和若干行数据，那种组合是正常的，不是矛盾。
      */}
      {state.catalogError === null ? null : <Notice kind="bad">{state.catalogError}</Notice>}

      {/* ⚠️ 动作失败的原话（`handlers` 那一层接住的）。见 `files.actionFailed` 那一段。 */}
      {actionError === null ? null : (
        <Notice kind="bad">{t('files.actionFailed', { message: actionError })}</Notice>
      )}

      {/*
        ⚠️ 浏览器态**不渲染这一行**（`handlers === null`）：那里一个写盘 / 选文件的动作
        都做不了，放一颗永远点不动的按钮比不放更糟（`lib/nav.ts` 对 `milestone` 那条
        写着同一句话）。
        ★ 三颗按钮的可用条件各有自己的判据（都是"点了会怎样"的直接后果）：
          · 「选择 mods 目录」：`busy` 时禁用（理由见本组件上面那一段）；
          · 「检查」：`busy` 或**这一次检查还在飞**时禁用；
          · 「一键更新」：`busy` / 这一次运行还在飞 / **一条可更新的都没有**时禁用。
            ⚠️ 判据是 `someNeedsUpdate`（**含**已禁用的条目）而不是 `targets`：两者只在
            "可更新的条目全是已禁用"这一档不同，那一档按钮**要留着可用**（有东西可更新），
            而点下去由下面那句解释说明为什么不调 `updateAll()`。
        ★★ 「一键更新」是**两步**：`showConfirm` 为假时是那颗普通按钮（第一步只把问题问出来），
        为真时换成 `UpdateAllConfirm` 那一行（句子 + 「确认」/「取消」）。
        ⚠️ 第二态**不是**"正在跑"：那一刻它只是等一句话，所以「选择 mods 目录」与「检查」
        照旧可用（用户想先看一眼再点头当然可以）；真正跑起来之后 `busy` 会把它们按住。
      */}
      {handlers === null ? null : (
        <div className="filespanel__actions">
          <button
            type="button"
            className="ghostbtn"
            disabled={busy}
            onClick={() => {
              // ⚠️ 失败不在这里 catch：`handlers` 那一层已经接住并交给 `files.actionFailed`
              void handlers.bindFolder();
            }}
          >
            {t('files.bindFolder')}
          </button>
          <button
            type="button"
            className="ghostbtn"
            disabled={busy || pending !== null}
            onClick={runCheck}
          >
            {pending === 'check' ? t('files.checking') : t('files.check')}
          </button>
          {showConfirm ? (
            /*
              ★ 第二态（纯组件：Task 7 直接喂 props 就能断言它，见 `UpdateAllConfirm`）。
              ⚠️ 传的是 `targets.length` **当次渲染**的值 ⇒ 句子里的数字不会过期。
              ⚠️ `disabled` 用 `busy || pending !== null`：别处正在写盘时不能开跑
              （主进程的 `updateAll()` 会以「正在更新中：…」拒绝），所以两颗都按住。
            */
            <UpdateAllConfirm
              count={targets.length}
              disabled={busy || pending !== null}
              onConfirm={confirmUpdateAll}
              onCancel={cancelUpdateAll}
            />
          ) : (
            /*
              ⚠️ 一键更新走 `.cta`（全站的主操作样式）：这一页真正要用户做的那一下就是它，
              而「检查」与「选择 mods 目录」是它的前置动作（主按钮必须比它们显眼，
              见 `styles.css` 的 `.ghostbtn` 那一段）。
              ⚠️ 它的 `onClick` **只**进入待确认态（`requestUpdateAll`）—— 这一颗按钮
              在任何情况下都不直接写盘（那条能红的判据在探针里：源码形状守卫）。
            */
            <button
              type="button"
              className="cta"
              disabled={busy || pending !== null || !someNeedsUpdate}
              onClick={requestUpdateAll}
            >
              {t('files.updateAll')}
            </button>
          )}
          {/* ★ 上一次运行的汇总（`runSummary` 那一段写着它什么时候不印）。 */}
          {runSummary === null ? null : <span className="filespanel__run">{runSummary}</span>}
        </div>
      )}

      {/*
        ★ "可更新的条目全是已禁用"那一档的解释：一键更新**一颗都不会动**（它跳过
        `.disabled`），而那一行自己的「更新」是能用的（单条会先问一次要不要顺带启用）。
        ⚠️ 用的是与 `files.autoHint` **同一行样式**（`.filespanel__hint`）：两者是同一类
        东西（一句解释），给它们两个长相只会让"哪句话更重"这件事变成随机。
        ⚠️ 它**只在**这一档出现 —— 别做成常驻的说明（常驻的提示没人再看，本仓记过这一条）。
      */}
      {allUpdatableDisabled ? (
        <p className="filespanel__hint">{t('files.updateAllDisabledOnly')}</p>
      ) : null}

      {/*
        ★ 表格本体（Task 6）—— **纯展示**，见 `components/FileUpdateTable.tsx` 的文件头。
        ⚠️ `busyItemId` / `progress` 原样递下去：行内的"正在更新…"与进度文本由表格画
        （它才知道是哪一行）。浏览器态那三个 props 仍然传（`busyItemId: null`、
        `progress: null`），但一个动作回调都没有 ⇒ 表格不画任何按钮。
        ⚠️ `desktop={handlers !== null}` 与"有没有回调"是**两件事同时成立**才画按钮
        （表格 props 的说明）：这里两样都给，判据不会分叉。
      */}
      <FileUpdateTable
        views={views}
        busyItemId={state.busyItemId}
        progress={state.progress}
        desktop={handlers !== null}
        {...(rowActions ?? {})}
      />
    </section>
  );
}

// ===========================================================================
// 第一部分：目录行那一块（2026-10-03，Task 7）
// ===========================================================================
/*
 * 这一块与上面那一半（v1）**共用同一份组件文件**，但它们是两个**独立**的数据源：
 *   · v1：`useFileUpdates()`（老通道 `fileUpdates`，老客户端 0.0.4 与浏览器态都用它）；
 *   · 第一部分：`useModFolders()`（新通道 `modFolders`，这一期的主线）。
 * ⚠️★ 为什么新 UI 里**不再渲染 v1 那张带写盘按钮的表**（Ruling 49）：
 *    v1 的 `assertNotBusy()` 看不见本模块的 `busy`（反向那一半不可修 —— 不许改 v1）
 *    ⇒ 两个界面同时开着写盘通道时，用户能在"文件夹那一侧正在写"的时候点 v1 的「更新」。
 *    结构性消除的办法就是：`modFolders` 在的客户端里**只**画第一部分（与第二部分的）
 *    按钮，v1 那七条写盘通道在这一页上没有入口。代价（明摆着，记在 Task 7 报告里）：
 *    老客户端之外的客户端**没有** v1 的「解除绑定」可用（新契约里没有
 *    `unbindCatalogRow` 这一条）—— 那是一条**契约缺口**，不是这里漏画了一颗按钮。
 */

/** 把契约里**某一个**动作的入参搬过来，返回值换成 `Promise<void>`（与 v1 那条同型）。 */
type ModFoldersAction<K extends keyof DesktopBridge['modFolders']> = (
  ...args: Parameters<DesktopBridge['modFolders'][K]>
) => Promise<void>;

/**
 * 这一页要用的动作（第一部分 + 第二部分 + 底部那一条）。
 *
 * ⚠️ 返回值是 `Promise<void>`：`makeModFoldersHandlers()` 已经把主进程返回的**整份状态**
 *    落到界面上了，按钮那一层不需要（也拿不到）自己去 setState —— 那条规矩只有一处实现。
 * ⚠️ `updateCatalogRow` 的签名**不是**契约那一个：契约是
 *    `(rowId, releaseKey, channel)`，而 `releaseKey` 与 `rowId` 是**同一个形状**
 *    （`modid|游戏版本`，主进程的 `requirePairKey` 会拿它跟 `rowId` 对一遍），
 *    **指定不了"哪一个候选"**（主进程自己取 `view.official`）⇒ 这一层把那个参数
 *    收进实现里（页面只说得清"哪一行、走哪条通道"）。
 * ⚠️★ Task 8 加的八条（第二部分与底部）**一律与契约同签名**（`ModFoldersAction<K>`
 *    取的就是 `Parameters<…>`）：它们的入参本来就只是 id / 版本 / 通道，没有一处需要
 *    像 `updateCatalogRow` 那样"页面说不清"的东西。
 */
export interface ModFoldersHandlers {
  setCatalogGameVersion: ModFoldersAction<'setCatalogGameVersion'>;
  setTagFilter: ModFoldersAction<'setTagFilter'>;
  bindCatalogRow: ModFoldersAction<'bindCatalogRow'>;
  /** ★ Ruling 60：解绑第一部分的一行（有绑定就必须能解绑）。 */
  unbindCatalogRow: ModFoldersAction<'unbindCatalogRow'>;
  updateCatalogRow: (rowId: string, channel: Channel) => Promise<void>;
  rescan: ModFoldersAction<'rescan'>;
  /* ---- Task 8：第二部分（文件夹那一层）---- */
  /** 弹原生目录对话框建一个"文件夹实体"（**新语义**，与 v1 那条同名通道不是一回事）。 */
  bindFolder: ModFoldersAction<'bindFolder'>;
  unbindFolder: ModFoldersAction<'unbindFolder'>;
  setFolderGameVersion: ModFoldersAction<'setFolderGameVersion'>;
  setFolderAutoUpdate: ModFoldersAction<'setFolderAutoUpdate'>;
  /** 「全部更新」用哪条通道（按机器记住 ⇒ 住在主进程 `prefs`）。 */
  setBulkChannel: ModFoldersAction<'setBulkChannel'>;
  updateMod: ModFoldersAction<'updateMod'>;
  updateFolderAll: ModFoldersAction<'updateFolderAll'>;
  /** 底部缺失清单的「下载」（`gameVersion` 决定装哪一版）。 */
  downloadMissing: ModFoldersAction<'downloadMissing'>;
}

// ---------------------------------------------------------------------------
// 取数那两格（快照 / 失败结论）的归约 —— 纯函数，好让它能被一条断言钉住
// ---------------------------------------------------------------------------

export type ModFoldersLoadEvent =
  | { kind: 'snapshot'; state: ModFoldersState }
  | { kind: 'failure'; reason: string };

/** 与 v1 的 `FileUpdatesLoad` 同型（三格互斥的联合 ⇒ "数据与失败不可能同时成立"是类型保证的）。 */
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
 * ★★ 取数结果的归约：**数据永远压过一次失败结论**（与 v1 的 `reduceLoad` 同一条规则）。
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
 * `ModFoldersHandlers` 那十四个动作的包装（与 v1 的 `makeHandlers()` 同型）。
 *
 * ⚠️ 两件事**只有这一处实现**：把主进程返回的状态落到界面上；以及接住 `reject`。
 * ⚠️ 开跑之前先撤掉**上一次**的失败结论（它说的是上一次那个动作）。
 * ⚠️★ 条数是**现数的**（`ModFoldersHandlers` 的成员：第一部分 6 条 + Task 8 的 8 条）；
 *    加一条动作时这句话要一起改（与 `package.json` 里那句"十三个渲染门禁"同一条纪律：
 *    手抄的数字一定会过期，所以它旁边写着怎么现数）。
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
    bindCatalogRow: (rowId: string) => run(() => api.bindCatalogRow(rowId)),
    /* ★ Ruling 60：成对的那一条（界面只在已绑定的行上画那颗按钮）。 */
    unbindCatalogRow: (rowId: string) => run(() => api.unbindCatalogRow(rowId)),
    /*
     * ★ `releaseKey` 传的就是 `rowId`：两者形状相同（`modid|游戏版本`），而**哪一个候选**
     *   是主进程按它自己那份状态取的（`view.official`）—— 页面指定不了。
     */
    updateCatalogRow: (rowId: string, channel: Channel) =>
      run(() => api.updateCatalogRow(rowId, rowId, channel)),
    rescan: () => run(() => api.rescan()),
    /* ---- Task 8：第二部分与底部（逐条与契约同签名，见 `ModFoldersHandlers`）---- */
    bindFolder: () => run(() => api.bindFolder()),
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
  };
}

/** `useModFolders()` 的产物。⚠️ 只有 `ready` 那一支有动作层（其余三支没有东西可动）。 */
export type ModFoldersData =
  /**
   * 桌面壳里**没有** `modFolders`（0.0.4 的老客户端、或纯浏览器）⇒ 这一页走 v1 那条路
   * （那是正确降级：spec §6.8 的"老客户端的第一部分只有一行"说的就是这件事）。
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
    };

/**
 * 取数（**只有桌面壳里、而且 `modFolders` 真的在**才会跑）。
 *
 * ⚠️★ 顺序与 v1 那条**逐字相同**：**先订阅，再立刻 `getState()`**。主进程在应用启动时
 *    就会抓目录、扫文件夹，而这一页要等远程网页加载完才挂载 ⇒ 检查早于订阅时那一次推送
 *    **没有任何人收到**，表现是"界面上永远停在加载中"，而完全不报错。
 * ⚠️★ 判据是 `desktopBridge()?.modFolders` 在不在，**不是** `desktopBridge()` 在不在：
 *    0.0.4 的壳有 `mcsr` 但**没有** `modFolders`（`shared/desktop.ts` 的契约是 0.0.5 才有的）
 *    ⇒ 那种客户端必须继续走 v1 那条路（spec §6.8 / D9.3），一个字节都不变。
 */
export function useModFolders(): ModFoldersData {
  const [load, setLoad] = useState<ModFoldersLoad>(NO_MOD_FOLDERS_LOAD);
  const [actionError, setActionError] = useState<string | null>(null);

  /*
   * ⚠️ 与 v1 那一条同型：`desktopBridge()` 每次读拿到的是同一个对象（preload 在页面脚本
   *    之前注入），所以可以拿它当 effect 的依赖。
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
    // 浏览器 / 老客户端：这一栏根本不存在（`Files.tsx` 会走 v1 那一条路）。
    if (api === null) return;
    const unsubscribe = api.onStatus(accept);
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
    return unsubscribe;
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
    return { status: 'ready', state: load.state, handlers, actionError };
  }
  return { status: 'loading' };
}

/**
 * 第一次拉状态那一屏（**Ruling 42**）：它可能先等一次补扫（读每个 jar 的内部版本与哈希）。
 *
 * ⚠️★ 做成一个**独立导出的纯组件**的理由与 `UpdateAllConfirm` 同一个：`renderToStaticMarkup`
 *    不跑 effect，而自检里没有 preload（`window.mcsr` 是 `undefined`）⇒ `useModFolders()`
 *    在自检里恒为 `unavailable`。它单独导出来，那一屏的文字才**能被断言**。
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

/**
 * 点一个标签之后的**全量**标签数组（`setTagFilter` 收的是全量，spec §6.8 的"与"语义）。
 *
 * ⚠️ 保序（加在末尾、去掉时不动其余的顺序）：顺序也变了的话，"同一个选择"会变成两个
 *    不同的值 —— 多一次无谓的写盘，而且 `prefs` 里那份与用户看到的不是同一个东西。
 */
export function toggleTag(tags: readonly string[], tag: string): string[] {
  return tags.includes(tag) ? tags.filter((item) => item !== tag) : [...tags, tag];
}

/**
 * 标签多选的**选项表**（Ruling 58：来自状态里那一格**目录的标签全集**）。
 *
 * ⚠️★ 不再从 `catalogRows[].tags` 里凑（T7 第一版的写法，已删）：那些行是**按当前
 *    `tagFilter` 筛过**的 ⇒ 选中一个标签之后，与它互斥的标签会因为"没有一行同时带两者"
 *    而从选项里消失，用户得先取消再换。
 * ⚠️ 已选但**不在**全集里的键（目录换过之后 `prefs` 里留下的旧值）仍然要出现 ——
 *    否则用户取消不掉一个把行都筛掉的标签（那时页面会只剩"没有行"那一屏）。它排在最后，
 *    顺序因此仍由"目录的顺序 + 已选的顺序"决定（可复现）。
 */
export function tagOptionKeys(state: ModFoldersState): string[] {
  const keys = state.tags.map((option) => option.key);
  for (const tag of state.tagFilter) if (!keys.includes(tag)) keys.push(tag);
  return keys;
}

/**
 * 标签 key ⇒ 显示名（**状态里那一格**两种语言都有 ⇒ 按当前语言取）。
 *
 * ⚠️ 查不到时退回 **key 本身**（不是猜一个名字）：目录里没有它的显示名就是目录的缺陷，
 *    界面上显示 key 正是"看得见的缺陷"（与 `tagLabelsOf` 的退化同一条纪律）。
 */
function tagLabelFor(state: ModFoldersState, tag: string, lang: 'zh' | 'en'): string {
  return state.tags.find((option) => option.key === tag)?.labels[lang] ?? tag;
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
  return state.gameVersions.includes(state.gameVersion)
    ? [...state.gameVersions]
    : [state.gameVersion, ...state.gameVersions];
}

export interface ModCatalogSectionProps {
  state: ModFoldersState;
  /**
   * 动作层。`null` = 只读（浏览器态 / 老客户端那一侧的自检夹具）。
   * ⚠️ 产品里第一部分**只在** `modFolders` 在的客户端渲染 ⇒ 这里总是有 handlers；
   *    `null` 这一支留着是因为"没有动作层就不画按钮"必须是**一个判据**，
   *    而不是"今天恰好不会发生"（自检里那条反面断言盯的就是它）。
   */
  handlers: ModFoldersHandlers | null;
  /** 一次动作失败的原话（`null` = 没失败过）。与 v1 那一格同一个意思。 */
  actionError?: string | null;
}

/**
 * 第一部分本体：两个筛选器 + 目录行那张表。
 *
 * ⚠️★ **纯 props**（不取数、不订阅、不跑 effect）—— 与上面的 v1 面板同一条理由：
 *    自检只能喂一份手写的 `ModFoldersState` 进来（`renderToStaticMarkup` 不跑 effect）。
 * ⚠️★ 两个筛选器的选择**不在这里存**：它们只画 `state.gameVersion` / `state.tagFilter`
 *    （主进程 `prefs` 里那一份），交互只发通道 —— 一处记忆（spec §6.8 / `desktop.ts`）。
 */
export function ModCatalogSection({ state, handlers, actionError = null }: ModCatalogSectionProps) {
  const { t, i18n } = useTranslation();
  const rows = state.catalogRows;
  const versions = gameVersionOptions(state);
  const tagKeys = tagOptionKeys(state);
  /**
   * 标签显示名的语言（与表格那一层同一个判据：`i18n.language` 形如 `zh-CN` / `en`）。
   * ⚠️ 目录两种语言都给了（`TagOptionView.labels`）⇒ 英文界面上不该出现中文标签名。
   */
  const labelLang: 'zh' | 'en' = i18n.language?.startsWith('en') ? 'en' : 'zh';
  /**
   * ★ 第三处空态：**全部已最新**。判据是每一行都判成 `same`（按 sha512 相等），
   *   而不是"没有 `batchable` 的行" —— 后者会把 `newer` / `different-build` 那些
   *   "本地不是最新、但不该自动动"的行也算进来（那时说"都已是最新"是假话）。
   * ⚠️ 那一档**留着表**：行还在（绑定 / 打开原网页都只能在这里做），藏掉整张表就是删能力。
   */
  const allCurrent = rows.length > 0 && rows.every((row) => row.verdict.kind === 'same');
  /** ⚠️ 一次运行的汇总**正在跑的时候不印**（它说的是上一次，见下面那一段）。 */
  const lastRun = state.busy ? null : state.lastRun;

  /*
   * ⚠️ 回调只在**有动作层**时存在（表格那一层拿不到回调就不画那颗按钮）；
   *    回调里**不 catch**：失败由 `makeModFoldersHandlers()` 那一层接住并显示。
   */
  const rowActions =
    handlers === null
      ? {}
      : {
          onBindLocal: (rowId: string) => void handlers.bindCatalogRow(rowId),
          /* ★ Ruling 60：解绑那一颗接的是新通道（`unbindCatalogRow`）。 */
          onUnbindLocal: (rowId: string) => void handlers.unbindCatalogRow(rowId),
          onUpdate: (rowId: string, channel: Channel) =>
            void handlers.updateCatalogRow(rowId, channel),
        };

  return (
    <section className="filespanel">
      <h2>{t('files.partOneTitle')}</h2>
      {/*
        ★ 两个筛选维度（D4）：游戏版本 × 标签（"与"语义）。
        ⚠️ 两者的选择都**受控于状态**（主进程的 `prefs`）⇒ 这里没有 `useState`：
        两处记忆必然有一天不一致（一处说旧版本、一处说新版本），而且完全不报错。
      */}
      <div className="filters">
        <label>
          {t('files.catalogGameVersion')}
          <select
            className="filters__select"
            value={state.gameVersion}
            disabled={handlers === null}
            onChange={(event) => {
              // ⚠️ 失败不在这里 catch：handlers 那一层已经接住并显示（与 v1 同一条）。
              if (handlers !== null) void handlers.setCatalogGameVersion(event.target.value);
            }}
          >
            {versions.map((version) => (
              <option key={version} value={version}>
                {version}
              </option>
            ))}
          </select>
        </label>
        <div className="tagcloud">
          <span className="tagcloud__label">{t('files.catalogTags')}</span>
          {tagKeys.map((tag) => {
            const on = state.tagFilter.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                className={on ? 'tagchip tagchip--on' : 'tagchip'}
                aria-pressed={on}
                disabled={handlers === null}
                onClick={() => {
                  if (handlers !== null)
                    void handlers.setTagFilter(toggleTag(state.tagFilter, tag));
                }}
              >
                {tagLabelFor(state, tag, labelLang)}
              </button>
            );
          })}
        </div>
      </div>

      {/*
        ⚠️ `notices` **原样印出来**（迁移提示 "已转为文件夹跟踪：…"、缺失清单被压住的说明、
        目录错误）：它们由主进程写好，T7 这一层不重新措辞（多套一层就是
        "目录拉取失败：目录拉取失败：…"那一种）。代价：那句话是**中文**写死的
        —— 与 v1 的 `catalogError` / `actionFailed` 是同一条已接受的代价。
      */}
      {state.notices.map((note) => (
        <Notice kind="info" key={note}>
          {note}
        </Notice>
      ))}
      {actionError === null ? null : (
        <Notice kind="bad">{t('files.actionFailed', { message: actionError })}</Notice>
      )}

      {/*
        ★ 正在写盘那一句（`busy`）：主进程一次只写一个文件 ⇒ 那期间每一行的按钮都禁用，
        把"现在不能点"写在脸上比让用户吃一句"正在更新中"强。
      */}
      {state.busy ? <p className="filespanel__hint">{t('files.catalogBusy')}</p> : null}

      {/*
        ★★ 上一次运行的汇总（`lastRun`）—— 含**逐条**跳过的行与原因（spec §7.4 / Ruling 52⑤）。
        ⚠️★ `lastRun` 是**上一次**的结果：整夹在 `bulkRun` 之前被拒时它**根本不动**
        （T6 §9.6 第 2 条）⇒ 措辞写"上一次"，而且**正在跑的时候一个字都不印**
        （`lastRun` 已经在上面的 `const` 里按 `busy` 清成 `null` 了）——
        把上一次的结果挂在这一趟旁边，就是在说一句不成立的话。
      */}
      {lastRun === null ? null : (
        <div className="filespanel__run">
          <span>
            {t('files.lastRunSummary', {
              ok: lastRun.updated.length,
              skipped: lastRun.skipped.length,
              failed: lastRun.failed.length,
            })}
          </span>
          <ul>
            {lastRun.skipped.map((skip) => (
              <li key={skip.modid}>
                {t('files.lastRunSkipped', { modid: skip.modid, reason: skip.reason })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        ★★ 目录不可用那一档（**判修 1**，2026-10-03 评审）。
        ⚠️★ 第一版是"`catalogStatus !== 'ok'` ⇒ 不画表"，而那会把**存在的行藏掉**并印一句
        假话：重新抓目录失败**不会清空**已经加载的那一份（`mod-folder-catalog.ts` 只置状态；
        目录本身留着 —— spec §8 要求保留缓存）⇒ 缓存里那几行明明在，用户却看到
        "这一栏现在列不出任何东西"，而且**丢掉**了绑定与「打开原网页」。
        同一个文件里 v1 那半边自己的规矩正好相反（`FileUpdateTable.tsx`：
        "**不清空** `catalog` 是 spec §8 的要求，缓存里那几条会照常渲染成行"）。
        ⇒ 现在的判据按**行**分两支：
          · 一行都没有 ⇒ 那条**阻塞**说法（`files.catalogUnavailable`）+ 「重扫」；
          · 有行 ⇒ 一条**非阻塞**的说明（`files.catalogUnavailableRows`：这几行是上一次的
            读数）+ 照常画表（绑定 / 打开原网页 / 更新都还能用）。
        ⚠️ 「重扫」两支都给（它是这一页唯一的"再试一次"入口：`rescan` 内含重拉目录）。
      */}
      {state.catalogStatus === 'ok' ? null : (
        <>
          <Notice kind={rows.length === 0 ? 'bad' : 'info'}>
            {rows.length === 0 ? t('files.catalogUnavailable') : t('files.catalogUnavailableRows')}
          </Notice>
          {handlers === null ? null : (
            <div className="filespanel__actions">
              <button
                type="button"
                className="ghostbtn"
                disabled={state.busy}
                onClick={() => void handlers.rescan()}
              >
                {t('files.catalogRescan')}
              </button>
            </div>
          )}
        </>
      )}

      {rows.length === 0 ? (
        /*
         * ★ 第二处空态：一行都没有。⚠️ 目录不可用那一档**已经**说了原因（上面那条 Notice）
         *   ⇒ 这里不能再印"这个游戏版本下没有行"（那是另一件不同的事：目录 OK 而没有行）。
         */
        state.catalogStatus === 'ok' ? (
          <div className="state state--empty">
            <p>{t('files.catalogNoRows')}</p>
          </div>
        ) : null
      ) : (
        <>
          {/* ★ 第三处空态（一句话，不是"藏掉整张表"）：全部已最新。 */}
          {allCurrent ? <p className="filespanel__hint">{t('files.catalogAllCurrent')}</p> : null}
          <ModCatalogTable
            rows={rows}
            desktop={handlers !== null}
            busy={state.busy}
            mirrors={state.mirrors}
            tagLabels={state.tags}
            {...rowActions}
          />
        </>
      )}
    </section>
  );
}
