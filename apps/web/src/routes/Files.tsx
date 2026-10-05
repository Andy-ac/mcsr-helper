/**
 * 「文件更新」`/files` —— 侧栏那一栏的落地页（2026-09-24；2026-10-04 **A 的 T3** 换成 tab 骨架）。
 *
 * ===========================================================================
 * ★★ 这一页现在的形状（spec §4）：**一格一个模块，按游戏版本组织**
 * ===========================================================================
 *   · **tab**：「mod 下载」（默认）与「工具下载」（占位卡，写明"待更新"）；
 *   · **mod 下载**那一格里：顶部并排区（版本下拉 + 「显示全部已绑定的文件夹」）
 *     → 跨版本那一栏（点开才画）→ **按版本分组的文件夹行**（默认折叠）
 *     → 「该版本所有 mod」（**T5** 接进来）。
 * ⚠️★ 那些块**只在** `modFolders` 通道在的客户端（桌面版 0.0.5+）画：
 *    没有那条通道 ⇒ 这一页**只有一句**"需要桌面版 0.0.5"（spec §9.12 / D1：
 *    0.0.4 与浏览器**都**是这一档，区别只在上面多不多一句 `browserOnly`）。
 *    ⇒ v1 那张带写盘按钮的表**不再挂在这一页上**（它的组件与判据留到 **T6** 一起删）。
 *
 * ===========================================================================
 * ⚠️★ 取数不在这里，在这一页的容器里（`useModFolders()`）
 * ===========================================================================
 * ⚠️ 为什么：`renderToStaticMarkup`（渲染自检）**不跑 effect** ⇒ 取数写在页面里的话，
 *    自检渲染这一页永远只能看到「正在扫描…」，页面上每一块都断言不到
 *    （`docs/pending.md §5.63`；`ModDownloadPanel` / `VersionFolderList` 之所以是
 *    纯 props 组件，也是同一条）。
 *
 * ===========================================================================
 * ⚠️★ 这一页里"我是谁"只问两个问题，各**一处**判据（T3 改准）
 * ===========================================================================
 *   · "这个壳有没有 `modFolders` 通道" ⇒ `useModFolders().status === 'unavailable'`
 *     —— 它就是"这个客户端太老"那一条（0.0.4 与浏览器都落在这里）；
 *   · "这是不是一个桌面壳" ⇒ `desktopBridge()`（**只**用来决定浏览器那句说明与装桌面版的
 *     入口要不要画）。⚠️ 上个版本这一格是从 v1 的 `useFileUpdates().handlers` 推的，
 *     而 v1 的面板已经从这一页下去了 ⇒ 那一格不能再依赖 v1 的取数。
 * ⚠️★ 两处判据问的是**两个不同的问题**，所以不会分叉；而"我是不是 0.0.5"这个问题
 *    仍然只有第一处问（别在这里再读一次 `desktopBridge()?.modFolders`）。
 */
import { desktopBridge } from '@mcsr/shared/desktop';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DesktopDownload } from '@/components/DesktopDownload';
import {
  ModCatalogScanning,
  type ModFoldersHandlers,
  useModFolders,
} from '@/components/FileUpdatesPanel';
import { Notice } from '@/components/Form';
import {
  ModDownloadPanel,
  type ModPageAction,
  type ModPageActionHandler,
} from '@/components/ModDownloadPanel';
import { ToolsPanel } from '@/components/ToolsPanel';

/**
 * 这一页在 `modFolders` 不存在时的样子（**特性检测**，spec §6.8 / §8 的最后一行）：
 * 说清"需要桌面版 0.0.5"。
 *
 * ⚠️★ 单独导出一个**纯组件**的理由与 `ModCatalogScanning` 同一个：自检里没有 preload
 *    （`window.mcsr` 是 `undefined`）⇒ `useModFolders()` 恒为 `unavailable`，
 *    而那一支渲染的就是它 ⇒ 只有单独拿组件渲染才断言得到（`foldersrender.tsx` 的 ㉕）。
 * ⚠️ 它同时覆盖两种壳：0.0.4（有 `mcsr`、没有 `modFolders`）与纯浏览器
 *    （连 `mcsr` 都没有 —— 那时页面上面还有一句 `browserOnly` 说清了原因）。
 * ⚠️★ 它的类名**刻意不是** `.filespanel`（第一版是它，2026-10-03 跑 `check:all` 时红了）：
 *    v1 的渲染自检（`apps/web/scripts/filesrender.tsx` ⑰）有一条**粗糙的**判据 ——
 *    `assert.equal(pageHtml.includes('filespanel'), false, '还没拿到状态就不画面板')`
 *    —— 它拿"产物里有没有这个类名"代理"有没有画出**那张表**"。这一块复用了那个类名
 *    ⇒ 它在**正确**的产物上报红（那一屏画的是"需要桌面版 0.0.5"这句话，不是一张空表）。
 *    ⇒ 两条路：改 v1 那条判据（放宽它），或者给这一块一个自己的类名。选**后者**：
 *      **这一条** v1 判据一个字节都不动，代价是多一条 CSS 规则。
 *      ⚠️ T3 确实改过 `filesrender.tsx` ⑰ 里**另一条**断言（v1 的「加载中…」不再挂在这一页上）——
 *      那是这一页形状变了，不是放宽这条粗判据，见那个脚本 ⑰ 里的注释。
 *    ⚠️ 记一笔给 T10：`filesrender.tsx` 那条判据**本身是粗的**（把 v1 面板换成用另一个
 *      类名渲染，它照样绿）—— 那是 v1 的既有缺口，本任务不碰。
 */
export function ModFoldersUnavailable() {
  const { t } = useTranslation();
  return (
    <section className="filesunavailable" data-mod-folders="unavailable">
      <h2>{t('files.partTwoTitle')}</h2>
      <Notice kind="info">{t('files.partTwoUnavailable')}</Notice>
    </section>
  );
}

/** 两个 tab（顺序即 spec §4 那个图）。 */
type ModTab = 'mods' | 'tools';

/**
 * tab 那一条。
 *
 * ⚠️★ 为什么整条住在这里（页面外壳）而**不在** `ModDownloadPanel` 里：
 *    面板要一份 `ModFoldersState` 才画得出来，而那份读数要等 `useModFolders()` 的 IPC
 *    回包（静态渲染跑不到 effect）⇒ 面板里放 tab 条的话，"默认选中哪一格"**永远断言不到**。
 *    而外壳的 `loading` 支路也画着这一条 ⇒ 自检第一次渲染就看得到它。
 * ⚠️ ARIA：`role="tablist"` + `role="tab"` + `aria-selected` 是**完整**那一套的一半，
 *    另一半是 `aria-controls` 指向的 `role="tabpanel"`（下面那个 wrapper）——
 *    `Videos.tsx` 那一处写着"只挂半个 `role="tab"` 会被读屏念成一个没有对应面板的选项卡"，
 *    所以这里两边都挂了。代价（认）：未选中的那一格**不渲染**（面板里的东西不便宜）
 *    ⇒ 它那颗按钮的 `aria-controls` 在选中之前指向一个不存在的 id（读屏会忽略它）。
 */
function ModTabs({ tab, onSelect }: { tab: ModTab; onSelect: (next: ModTab) => void }) {
  const { t } = useTranslation();
  const items: readonly { id: ModTab; label: string }[] = [
    { id: 'mods', label: t('files.tabMods') },
    { id: 'tools', label: t('files.tabTools') },
  ];
  return (
    <div className="modtabs" role="tablist">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          id={`modtab-${item.id}`}
          className={item.id === tab ? 'modtabs__tab is-active' : 'modtabs__tab'}
          /* ⚠️ `data-tab` 必须在 `aria-selected` **前面**：自检那两条正则吃的是这个顺序。 */
          data-tab={item.id}
          aria-selected={item.id === tab}
          aria-controls={`modtabpanel-${item.id}`}
          onClick={() => onSelect(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/**
 * 动作联合 ⇒ 契约里那条通道（**这一处是全页唯一的动作接线**）。
 *
 * ⚠️★★ 穷尽性是**下面那个 `default` 分支**盯住的（`const never: never = action`），
 *    **不是** `switch` 自己 —— T3 判修轮实测：这个 tsconfig **没有** `noImplicitReturns`，
 *    一个非穷尽的 `switch`（少一支、函数声明成 `Promise<void>`）**编译通过、`tsc` 退出 0**
 *    ⇒ 加一个 `ModPageAction` 成员而忘了在这里处理，会得到一颗**哑按钮、零门禁输出**。
 *    ⚠️★ **T4 已经吃过它一次**：展开体里那一行的更新加了 `update-mod` 这个成员，
 *    接在这一层（`case 'update-mod'`）—— 刀就是把那一支删掉 ⇒ `tsc` 报
 *    `TS2322: Type '{ kind: "update-mod"; … }' is not assignable to type 'never'`。
 *    ⚠️ T5 还要往那个联合里加成员（`download-mod` 之类）⇒ 这一句继续是给它的保险。
 * ⚠️★ 这里**不 catch**：`makeModFoldersHandlers()` 那一层已经接住并落到 `actionError`
 *    （页面把它传给 `ModDownloadPanel` 印出来）。`openFolder` 走的是那一层**新加的那一条**
 *    （主进程对未知 id 是**抛**，`mod-folders.ts:941`）—— 接住它的地方与别的动作同源。
 */
export function makeModPageAction(handlers: ModFoldersHandlers): ModPageActionHandler {
  return async (action: ModPageAction): Promise<void> => {
    switch (action.kind) {
      case 'open-folder':
        await handlers.openFolder(action.folderId);
        break;
      case 'bind-folder':
        await handlers.bindFolder();
        break;
      case 'rescan-folder':
        await handlers.rescan(action.folderId);
        break;
      case 'unbind-folder':
        await handlers.unbindFolder(action.folderId);
        break;
      case 'set-folder-version':
        await handlers.setFolderGameVersion(action.folderId, action.version);
        break;
      case 'set-folder-auto-update':
        await handlers.setFolderAutoUpdate(action.folderId, action.on);
        break;
      case 'set-bulk-channel':
        await handlers.setBulkChannel(action.channel);
        break;
      case 'update-folder-all':
        await handlers.updateFolderAll(action.folderId, action.channel);
        break;
      case 'update-mod':
        /*
         * ★ Task 4（A 的第四片）：展开体里那一行的更新。⚠️ `releaseKey` **原样**转过去
         *   （转成大写 / 重新拼一遍都会让主进程的 `requirePairKey` 拒，而症状只是
         *    "这一行点更新没反应"）。
         */
        await handlers.updateMod(action.folderId, action.modid, action.releaseKey, action.channel);
        break;
      case 'download-mod':
        /*
         * ★ Task 5（A 的第五片）：第三段那一行的下载。⚠️ 它走的是 T8 就有的那条通道
         *   （`downloadMissing` —— 底部旧清单原本用它）⇒ 这里**不新增**一条同义通道；
         *   四个入参逐格原样转过去（`gameVersion` 是主进程核对自己状态的那一格）。
         */
        await handlers.downloadMissing(
          action.modid,
          action.gameVersion,
          action.folderId,
          action.channel,
        );
        break;
      case 'set-catalog-version':
        await handlers.setCatalogGameVersion(action.version);
        break;
      default: {
        /*
         * ★★ 穷尽性守卫：走到这里说明 `ModPageAction` 多了一个没人处理的成员 ——
         * 而那一支在**编译期**就该红（`action` 在这里的类型是 `never`，赋给 `never`
         * 才合法）。运行期这一句到不了（除非有人绕过了类型检查）；真到了就**抛**，
         * 让 `ModDownloadPanel` 的 `try/catch` 把它变成用户看得见的一句原话
         * （哑按钮的另一种形态是"点了什么都不发生"，那一类最难查）。
         */
        const never: never = action;
        throw new Error(`未处理的动作：${JSON.stringify(never)}`);
      }
    }
  };
}

export function Files() {
  const { t } = useTranslation();
  /*
   * ★ 数据源（T7）：只有 0.0.5+ 的桌面壳才会给出 `ready`；浏览器与 0.0.4 恒为 `unavailable`。
   */
  const mods = useModFolders();
  /** 当前 tab（默认「mod 下载」；spec §4）。 */
  const [tab, setTab] = useState<ModTab>('mods');
  /**
   * ⚠️ 判据是 `desktopBridge()`（**不是** `useModFolders()`）：后者答的是"有没有那条通道"，
   *    而这个答的是"这是不是一个桌面壳"—— 浏览器要看到装桌面版的入口，0.0.4 不要
   *    （它已经是桌面壳了）。⚠️ 两者问的是两个问题 ⇒ 不会分叉（见文件头那一段）。
   */
  const desktop = desktopBridge() !== null;

  return (
    <>
      <header className="pagehead">
        <h1 className="pagehead__title">{t('files.title')}</h1>
        <p className="pagehead__sub">{t('files.intro')}</p>
      </header>

      {/*
        ★ 浏览器态的两件事，紧贴在标题下面（读者第一眼就该看到"这里不是桌面版"）：
        一句说明 + 一个真实的下载入口。桌面壳里这两样都不渲染。
        ⚠️★ 这一句走的是 `<Notice>`，而 `Notice` 对**字符串子节点**会 `em()`
        （`components/Form.tsx` 里那句 `typeof children === 'string' ? em(children)`）
        ⇒ 它里面的 `**` 会变成粗体，**不是**字面星号。这一条值里的标记去掉是照控制器的
        carry-in（值就是纯文本），**不是**因为这里会印星号 —— 会印星号的是
        `files.autoHint` 那一处渲染点（裸 `<p>`）。两条理由不同，
        完整的那一段写在 `packages/shared/src/i18n/zh-CN.ts` 的 `files` 那一节。
      */}
      {desktop ? null : (
        <div className="files__browser">
          <Notice kind="info">{t('files.browserOnly')}</Notice>
          <DesktopDownload />
        </div>
      )}

      {/*
        ===================================================================
        ★★ 唯一的岔口（T3）：**没有 `modFolders` 通道**的壳 ⇒ 只有一句话
        ===================================================================
        ⚠️★ 那一档**不画 tab**（spec §9.12 / D1：0.0.4 用户"只能看到升级提示"）：
           tab 是"这一页有几个模块"的导航，而没有那条通道时一个模块都没有 ——
           画出来会让"这个客户端太老"看起来像"还有一个模块没做"。
      */}
      {mods.status === 'unavailable' ? (
        <ModFoldersUnavailable />
      ) : (
        <>
          <ModTabs tab={tab} onSelect={setTab} />
          <div role="tabpanel" id={`modtabpanel-${tab}`} aria-labelledby={`modtab-${tab}`}>
            {tab === 'tools' ? (
              <ToolsPanel />
            ) : mods.status === 'loading' ? (
              /*
               * ★★ Ruling 42：第一次 `getState()` 会先等一次**补扫**（读每个 jar 的内部
               * 版本与哈希），可能要几秒 ⇒ 从第一帧就说"正在扫描…"，否则这一页看起来是挂了。
               */
              <ModCatalogScanning />
            ) : mods.status === 'failed' ? (
              /*
               * ⚠️ 与 v1 的 `stateError` **不是同一条词条**：这一条说的是新通道
               * （`modFolders.getState()`）拿不到。两条通道的失败原因不同，所以不合并。
               */
              <Notice kind="bad">{t('files.partOneStateError', { reason: mods.reason })}</Notice>
            ) : (
              /*
               * ★★ 只有**一处**拿得到 `state` 与 `handlers`（`ready` 那一支）⇒ 动作接线
               * 也只在这里造一次（`makeModPageAction`）。⚠️ `actionError` 是本页
               * 唯一的动作失败面，它必须交给面板印出来（否则"接住了却不显示"）。
               */
              <ModDownloadPanel
                state={mods.state}
                onAction={makeModPageAction(mods.handlers)}
                actionError={mods.actionError}
              />
            )}
          </div>
        </>
      )}
    </>
  );
}
