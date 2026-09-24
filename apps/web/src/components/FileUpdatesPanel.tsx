/**
 * 「文件更新」面板 —— `/files` 那一页的**数据层**与容器。
 *
 * ===========================================================================
 * ⚠️★ 为什么取数住在这里，而不是住在路由页里
 * ===========================================================================
 * 两条路都要同一份 `FileUpdatesState`（表格、按钮、元信息全按它渲染），而
 * `renderToStaticMarkup` —— Task 7 的渲染自检就是它 —— **不跑 effect**：
 * 取数写在页面里的话，自检渲染这一页只会看到「加载中」，写在里面的每一块都断言不到
 * （`docs/pending.md §5.63`，`ShareIntro` 那边记着同一条）。
 * ⇒ 这个文件里有两样东西，各自只负责一件事：
 *   · `useFileUpdates()`：**取数**（桌面壳 = 订阅 + 首拉 / 浏览器 = 拉目录），
 *     以及七个动作的包装（`FileUpdatesHandlers`）；
 *   · `FileUpdatesPanel`：**纯展示**（拿一份现成的 `state` 就渲染）。
 *     它是同步可渲染的 ⇒ Task 7 可以喂一份手写的状态进去。
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
import type {
  FileCatalog,
  FileCatalogItem,
  FileItemView,
  FileUpdatesState,
} from '@mcsr/shared/fileUpdates';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

/**
 * 把毫秒时间戳写成 `14:03`。
 *
 * ⚠️ 自己拼而不是 `toLocaleTimeString()`：那个在 `en-US` 下会给出 `02:03 PM`，
 *    而词条里只有 `{{time}}` 一个占位符、没有 AM/PM 的位置 ⇒ 24 小时制是唯一
 *    在两种语言下都成立、且不需要第二条词条的写法。
 * ⚠️ 不带日期是**有意的**：面板读的这一格是**列表级**的 `FileUpdatesState.lastCheckedAt`，
 *    而它**只活在主进程的内存里** —— 状态文件（`apps/desktop/src/file-updates.ts` 的
 *    `StateFile`）里只有**每一条**的 `lastCheckedAt`，顶层那一格既不写也不恢复
 *    （`initFileUpdates` 那一句 `current = { ...current, items: rebuildItems() }` 只重建 items）
 *    ⇒ 它必然是**这一次进程里**某次检查 / 绑定写上去的。
 *    代价：跨零点之后那一刻钟显示的还是昨天的时间。
 *
 * ⚠️ 导出是给 **Task 6** 的：表格那一层要用**同一个**格式化（`error` 行要印
 *    "上次读到 5.8.26（14:03）"）—— 各写一份的话，同一个时间会在同一屏上有两种写法。
 */
export function formatClock(at: number): string {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
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
  fail: (message: string) => void,
): FileUpdatesHandlers {
  const run = async (call: () => Promise<FileUpdatesState>): Promise<void> => {
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
  const [snapshot, setSnapshot] = useState<FileUpdatesState | null>(null);
  const [failure, setFailure] = useState<{ failedAt: 'catalog' | 'state'; reason: string } | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);

  /*
   * ⚠️ `desktopBridge()` 读的是 `globalThis.mcsr`：preload 在页面脚本之前就注入了它，
   *    而且**每次读取拿到的是同一个对象** ⇒ 可以拿它当 effect 的依赖（跑一次）。
   *    ⚠️ 别写成 `useState(() => desktopBridge())`：那样浏览器里与桌面壳里就分成
   *    两条初始化路径，而"是不是桌面壳"这件事本身**只在渲染期判断**更简单。
   */
  const bridge = desktopBridge();

  const handlers = useMemo(
    () => (bridge ? makeHandlers(bridge.fileUpdates, setSnapshot, setActionError) : null),
    [bridge],
  );

  useEffect(() => {
    // ---- 浏览器态：拉一次目录，以后不再动（这一页没有轮询，也不需要） ----
    if (!bridge) {
      const controller = new AbortController();
      void fetchCatalog(controller.signal).then(
        (catalog) => {
          setSnapshot(browserState(catalog, null));
        },
        (error: unknown) => {
          if (isAbort(error)) return;
          setFailure({ failedAt: 'catalog', reason: reasonOf(error) });
        },
      );
      return () => {
        controller.abort();
      };
    }

    // ---- 桌面态：先订阅，再立刻拉一次（顺序的代价写在文件头） ----
    let pushed = false;
    const unsubscribe = bridge.fileUpdates.onStatus((next) => {
      pushed = true;
      setSnapshot(next);
    });

    void bridge.fileUpdates.getState().then(
      (initial) => {
        /*
         * ⚠️★ 收到过推送就**丢掉**这一份：推送与首拉搬的都是**整份**状态，
         *    所以推送到达之后的 `getState()` 结果一定不比它新
         *    （`getState()` 是**调用那一刻**的快照，回包的顺序不保证）。
         *    不丢的话，表现是"界面上闪回一次旧状态"—— 而旧状态里可能还有
         *    已经更新过的条目，用户会在那一瞬间看到过期的版本号。
         */
        if (!pushed) setSnapshot(initial);
      },
      (error: unknown) => {
        // 已经有推送过 ⇒ 这一页其实有数据，这一次首拉的失败不必惊动用户
        if (pushed) return;
        setFailure({ failedAt: 'state', reason: reasonOf(error) });
      },
    );

    return unsubscribe;
  }, [bridge]);

  if (failure !== null) {
    return {
      status: 'failed',
      failedAt: failure.failedAt,
      reason: failure.reason,
      handlers,
      actionError,
    };
  }
  if (snapshot === null) return { status: 'loading', handlers, actionError };
  return { status: 'ready', state: snapshot, handlers, actionError };
}

/**
 * 面板本体 —— **纯展示**：给一份状态就渲染，不取数、不订阅。
 *
 * ⚠️★ 表格是 **Task 6** 的（`components/FileUpdateTable.tsx`）。这里只留一个**挂载点**，
 *    刻意**不预建**表头 / 行 / 徽章 / 按钮：预建的话 Task 6 的第一件事会变成
 *    "先删掉上一轮猜出来的那一版"，而猜错的形状没有任何门禁看得见。
 *    ⚠️ 挂载点上那个 `data-views` 是**给 Task 7 的渲染自检**留的读数：它证明
 *    "面板真的把 N 条视图交给了表格那一层"，而不是只渲染了一个空壳；
 *    ⚠️ 它**不是**表格本身 —— Task 6 会把这一行换成 `<FileUpdateTable … />`，
 *    届时这个属性跟着消失（它没有别的消费者）。
 *
 * ⚠️★ 这一轮**多做了一件**计划表没写的事：「选择 mods 目录」那颗按钮（`files.bindFolder`）。
 *    理由不是"顺手"，而是**不做的话那个功能在界面上根本点不到**：
 *      · 计划里 Task 6 Step 3 给面板列的两颗按钮只有「检查」与「一键更新」，
 *        Task 6 Step 1 给表格列的操作只有「选择文件 / 重新选择 / 更新」；
 *      · 全仓没有任何任务认领 `files.bindFolder` 那一条词条与 `bindFolder()` 那条通道
 *        （T3 建了它、T4 实现了它、`content/file-catalog.json` 的整条路就是为它铺的，
 *        而它今天在界面上**没有消费者**）。
 *    ⇒ 一颗按钮的成本，换"文件夹扫描真的能被用户用到"；若控制器把它判给 Task 6，
 *      搬走它就是五行的事（这一段注释跟着搬）。
 *    ⚠️ 它**不影响** Task 6 要加的那两颗：同一行里并排即可。
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

  return (
    <section className="filespanel">
      <p className="filespanel__hint">{t('files.autoHint')}</p>

      {/*
        ⚠️★ 「上次检查」这一行**是必需的，不是装饰**：`autoUpdate` 关掉的条目在
        启动检查里**不刷新**（T1 的 `FileBinding.autoUpdate` 与 T4 的 `startUp` 那一条
        裁决）⇒ 表格里那个版本号可能是几小时前的读数，而这一行是用户唯一能看出
        "它有多旧"的地方。没有它，"关掉开关"与"检查坏了"在界面上一模一样。
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
        ⚠️ Task 6 的「检查」与「一键更新」会并排加在这一行里。
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
        </div>
      )}

      {/* Task 6 的表格挂载点（见本组件上面那一段）。 */}
      <div className="filetable" data-views={views.length} />
    </section>
  );
}
