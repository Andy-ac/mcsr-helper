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
 *     ⚠️★ Task 6 给它加了一格**界面态**（`pending`：「我刚点的那一下还在跑」）——
 *     `FileUpdatesState` 里没有这一格，而「检查」那一下要几秒（一次读盘 + 一次网络请求），
 *     少了它就只能在"点了没反应"和"点了弹一句红字"之间二选一。它是**界面态**，
 *     不是第二份真相：全部作用是把那两颗按钮按住、并把「正在检查…」印出来。
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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileUpdateTable, formatClock } from '@/components/FileUpdateTable';
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

  /** 一键更新**真的会碰**的那几条（判据与主进程那份逐条对齐，见 `updateAllTargets`）。 */
  const targets = updateAllTargets(views);
  /** 有任一条标着"可更新"（**含已禁用的**）—— 一键更新那颗按钮的可用判据。 */
  const someNeedsUpdate = views.some((view) => needsUpdate(view.state));
  /**
   * "可更新的条目全是已禁用的"这一档：按钮**可用**（有东西可更新），而一键更新
   * **一颗都不会动**（它跳过 `.disabled`）。⇒ 下面那句解释必须出现，否则就是"点了没反应"。
   */
  const allUpdatableDisabled = someNeedsUpdate && targets.length === 0;

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
   * 「一键更新」= 先问一次（问的是**真的会更新几条**），再交给主进程串行做。
   *
   * ⚠️★ `targets.length === 0` 时**不调** `updateAll()`：那一趟会一条都不动，却写一个
   *    `lastRun = { updated: [], failed: [] }` 回来、界面上冒出"已更新 0 个，失败 0 个"
   *    —— 一句"我刚才做过一件事"的话，而事实是什么都没发生。这时下面那句解释已经在屏幕上了。
   * ⚠️ 确认框走 `window.confirm`：**这是 brief 明写的**（Step 3）。代价记在这里，别当成疏漏：
   *    本仓有五处注释明写"不用 `window.confirm`"（`LiveManagePanel` / `VideoCard` /
   *    `EditResource` / `CalendarEdit` / `ShareBoard`），理由是"原生弹窗在 Electron 壳里
   *    样式和整站无关、而且会阻塞渲染"、"在 SSR 里不跑、门禁看不见"。
   *    这一处照 brief 做的**额外**理由：这个功能的另外两次确认本来就是**原生**弹窗
   *    （T4 的 `confirmOverwrite` / `confirmEnable` 由主进程弹），而这一步问的是同一类事
   *    （"要不要真的动你的文件"）。⇒ 若控制器认为这里该改成本仓那套行内两步确认，
   *    改动是这一段 + 一颗按钮的状态机。
   */
  const runUpdateAll = (): void => {
    if (handlers === null || targets.length === 0) return;
    if (!window.confirm(t('files.confirmUpdateAll', { count: targets.length }))) return;
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
          {/*
            ⚠️ 一键更新走 `.cta`（全站的主操作样式）：这一页真正要用户做的那一下就是它，
            而「检查」与「选择 mods 目录」是它的前置动作（主按钮必须比它们显眼，
            见 `styles.css` 的 `.ghostbtn` 那一段）。
          */}
          <button
            type="button"
            className="cta"
            disabled={busy || pending !== null || !someNeedsUpdate}
            onClick={runUpdateAll}
          >
            {t('files.updateAll')}
          </button>
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
