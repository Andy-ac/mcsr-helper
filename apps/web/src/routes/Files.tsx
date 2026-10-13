/**
 * 「资源下载」`/files` —— 侧栏那一栏的落地页（2026-09-24；2026-10-04 **A 的 T3** 换成 tab 骨架；
 * 2026-10-12 **D1 的 T6** 改成三个 tab 并接上老桌面壳的能力门）。
 *
 * ⚠️★ 侧栏显示名改成「资源下载」（A1）只动词条：路由 `'/files'` 与短名 `block: 'files'`
 *    **一个字不动**（`lib/nav.ts` 的注释写着这个短名连着四处：侧栏 CSS、首页说明、
 *    词条命名空间、路由）。
 *
 * ===========================================================================
 * ★★ 这一页现在的形状（spec §4）：**一格一个模块，按游戏版本组织**
 * ===========================================================================
 *   · **tab**（三个，顺序即 `ModTabs` 里那个数组）：「启动器绑定」/「mod 下载」/「工具下载」；
 *     ⚠️ **默认**落在哪一格由 `initialTabFor()` 说了算（没绑启动器 ⇒ 启动器绑定）；
 *   · **启动器绑定**那一格里：**T8** 填（本任务只留 `data-tab-panel="launchers"` 钩子）；
 *   · **mod 下载**那一格里：顶部并排区（版本下拉 + 「显示全部已绑定的文件夹」）
 *     → 跨版本那一栏（点开才画）→ **按版本分组的文件夹行**（默认折叠）
 *     → 「该版本所有 mod」（**T5** 接进来）。
 * ⚠️★ 那些块**只在够得上 D1 的客户端**画（`useModFolders().status !== 'unavailable'`）：
 *    不够 ⇒ 这一页**只有一句**"需要桌面版 0.2.0"（spec §9.12 / D1）。
 *    ⚠️★ T6 之后"不够"有**三档**，区别只在上面多不多一句 `browserOnly`：
 *      ① 纯浏览器（连 `mcsr` 都没有）；② 0.0.4 的壳（有 `mcsr`、没有 `modFolders`）；
 *      ③ **0.1.1 的老桌面壳**（有 `modFolders`、**没有 D1 那七格**，判据 = `d1Capable()`）。
 *    ⇒ v1 那张带写盘按钮的表**不再挂在这一页上**（它的组件与判据在 **T6** 已经连文件
 *    一起删了：`FileUpdateTable.tsx` 与 `scripts/filesrender.tsx` 都不在树里了）。
 *
 * ===========================================================================
 * ⚠️★ 取数不在这里，在这一页的容器里（`useModFolders()`）
 * ===========================================================================
 * ⚠️ 为什么：`renderToStaticMarkup`（渲染自检）**不跑 effect** ⇒ 取数写在页面里的话，
 *    自检渲染这一页永远只能看到「正在扫描…」，页面上每一块都断言不到
 *    （`docs/pending.md §5.63`；`ModDownloadPanel` / `VersionFolderList` 之所以是
 *    纯 props 组件，也是同一条）。
 *    ⚠️★ 同一条理由的第二个后果（T6）：静态渲染下这一页**拿不到 `state`** ⇒
 *    「tab 条与面板画的是不是同一格」只能靠**推导值**（`selected`）保证，
 *    而 `initialTabFor()` 那两支由自检 ㊾b **直接渲染那个纯函数**来钉。
 *
 * ===========================================================================
 * ⚠️★ 这一页里"我是谁"只问两个问题，各**一处**判据（T3 改准；T6 扩了第一个）
 * ===========================================================================
 *   · "这个壳够不够 D1" ⇒ `useModFolders().status === 'unavailable'`
 *     —— 它就是"这个客户端太老 / 没有这个能力"那一条（上面那三档都落在这里，判据在
 *     `ModFoldersData.tsx` 的 `d1Capable()` 里，**只有那一处**）；
 *   · "这是不是一个桌面壳" ⇒ `desktopBridge()`（**只**用来决定浏览器那句说明与装桌面版的
 *     入口要不要画）。⚠️ 上个版本这一格是从 v1 的 `useFileUpdates().handlers` 推的，
 *     而 v1 的面板已经从这一页下去了 ⇒ 那一格不能再依赖 v1 的取数。
 * ⚠️★ 两处判据问的是**两个不同的问题**，所以不会分叉；而"这个壳够不够 D1"这个问题
 *    仍然只有第一处问（别在这里再读一次 `desktopBridge()?.modFolders`）。
 */
import { desktopBridge } from '@mcsr/shared/desktop';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DesktopDownload } from '@/components/DesktopDownload';
import { Notice } from '@/components/Form';
import { LauncherBindingPanel } from '@/components/LauncherBindingPanel';
import {
  ModDownloadPanel,
  type ModPageAction,
  type ModPageActionHandler,
} from '@/components/ModDownloadPanel';
import {
  ModCatalogScanning,
  type ModFoldersHandlers,
  useModFolders,
} from '@/components/ModFoldersData';
import { ToolsPanel } from '@/components/ToolsPanel';

/**
 * 这一页"不够 D1"时的样子（**能力检测**，spec §6.8 / §8 的最后一行）：
 * 说清"需要桌面版 **0.2.0**"。
 *
 * ⚠️★ 单独导出一个**纯组件**的理由与 `ModCatalogScanning` 同一个：自检里没有 preload
 *    （`window.mcsr` 是 `undefined`）⇒ `useModFolders()` 恒为 `unavailable`，
 *    而那一支渲染的就是它 ⇒ 只有单独拿组件渲染才断言得到（`foldersrender.tsx` 的
 *    ㉕「特性检测」那一组 —— 它今天**还在**，见那个脚本的 `ok(...)` 清单）。
 * ⚠️ 它同时覆盖**三档**：0.0.4（有 `mcsr`、没有 `modFolders`）、纯浏览器（连 `mcsr`
 *    都没有 —— 那时页面上面还有一句 `browserOnly` 说清了原因）、以及 **0.1.1 的老桌面壳**
 *    （有 `modFolders`、没有 D1 那七格 ⇒ `d1Capable()` 判它不够）。
 * ⚠️★ 它的类名**刻意不是** `.filespanel`（第一版是它，2026-10-03 跑 `check:all` 时红了）：
 *    当时 v1 的渲染自检（`apps/web/scripts/filesrender.tsx` ⑰）有一条**粗糙的**判据 ——
 *    `assert.equal(pageHtml.includes('filespanel'), false, '还没拿到状态就不画面板')`
 *    —— 它拿"产物里有没有这个类名"代理"有没有画出**那张表**"。这一块复用了那个类名
 *    ⇒ 它在**正确**的产物上报红（那一屏画的是"需要桌面版 0.0.5"这句话，不是一张空表）。
 *    ⇒ 当时的处置是给这一块一个自己的类名（改那条判据等于放宽它），代价是多一条 CSS 规则。
 *    ⚠️★ T6 之后这条**历史理由已经消失**：`filesrender.tsx` 连文件一起删了
 *      ⇒ 今天 `.filesunavailable` 只是**沿用**（那一格与"v1 那张表"不再可能同屏）。
 *      ⚠️ 原来那句"记一笔给 T10（那条判据本身是粗的）"随之作废 —— 那条判据已经不存在了。
 *      ⚠️★ 而 `data-mod-folders="unavailable"` 这一格**今天有真判据**：㉕（三种壳）与
 *      ㊾d（老桌面壳真的走这一档、而且一个 tab 都不画）。
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

/**
 * 四个 tab（顺序即渲染顺序：启动器绑定 → mod 下载 → 工具下载 → **练习图下载**）。
 *
 * ★★ 第四个是 2026-10-12 的**骨架**（用户要求"尽快加上界面骨架、不需要内容，
 *    前端即将重构 ⇒ 最小改动、别过度设计"）⇒ 它只有一格空态，**别在这里长功能** ✗。
 * ⚠️ 加一格要**同批**动四处，少一处要么是死词条、要么是一格点了没反应的空 tab：
 *    ① 这个联合类型；② `ModTabs` 的 `items`；③ 页面里那条渲染分支
 *    （⚠️ 现有分支是"launchers / tools / **其余都算 mods**"⇒ 不加分支的话，
 *     点「练习图下载」会**画出 mod 下载那一格** —— 一个没有任何门禁看得见的错 ✗）；
 *    ④ 两份字典里的 `files.tabPractice`。
 */
export type ModTab = 'launchers' | 'mods' | 'tools' | 'practice';

/**
 * ★ D1（spec A8）：**默认**落在哪个 tab。
 *
 * ⚠️★ 一个新用户（一个启动器都没绑）落在「mod 下载」是没有意义的 —— 那一页会先告诉他
 *    "先去绑一个实例"；把他直接送到「启动器绑定」少一步。
 * ⚠️ 做成纯函数是因为**页面外壳断言不到这一支**：外壳在静态渲染下停在 `loading`
 *    （拿不到 `state`）⇒ 两支都由渲染自检 ㊾b 直接钉这个函数。
 */
export function initialTabFor(input: { hasLaunchers: boolean }): ModTab {
  return input.hasLaunchers ? 'mods' : 'launchers';
}

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
 * ⚠️★ **导出**是为了渲染自检能**单独**渲染它（㊾a 钉顺序与选中态）—— 与文件头那段
 *    "纯组件才断言得到"是同一条理由；`Files.tsx` 里其余组件都不导出。
 * ⚠️ 版本那一层（页首那个版本下拉）**不在这里**：它是页面主体的第一块，三个 tab 都看得见。
 */
export function ModTabs({ tab, onSelect }: { tab: ModTab; onSelect: (next: ModTab) => void }) {
  const { t } = useTranslation();
  const items: readonly { id: ModTab; label: string }[] = [
    { id: 'launchers', label: t('files.tabLaunchers') },
    { id: 'mods', label: t('files.tabMods') },
    { id: 'tools', label: t('files.tabTools') },
    /* ★ 第四格是骨架（2026-10-12）：名字在字典里，内容是一格空态。 */
    { id: 'practice', label: t('files.tabPractice') },
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
        /*
         * ★★ G2（最终修复波 / spec D3）：把**当时看着的那一版**转过去 —— 主进程用它把
         *   新文件夹的版本**预置**成它（仍可手改），而不是自己推断一个可能是 `null` 的版本。
         *   ⚠️ 这一格是契约 `bindFolder(gameVersion?)` 的第一个入参，转丢的表现是
         *   "在 X 下面添加、却归到别的组"（D3 要消灭的正是这件事）。
         */
        await handlers.bindFolder(action.version);
        break;
      case 'rescan-folder':
        await handlers.rescan(action.folderId);
        break;
      case 'unbind-folder':
        /*
         * ★★ D1（T8）：这一支**改发"取消追踪"**（控制器 2026-10-12 裁定 (b)；计划
         *    `:1280-1283` 点名的那一条）。
         *
         * ⚠️★ 修之前它发的是这条同名通道（`handlers.unbindFolder(folderId)`），而主进程
         *    那一侧写的是**派生结构**（`mod-folders.ts` 的 `unbindFolder` 只有一句
         *    `delete state.folders[id]`）⇒ 下一趟对账按"被追踪的实例"重新派生它、
         *    **又长回来** —— 用户看到的是"点了像成功、状态自己回来"。
         * ⇒ 改发 `setInstanceTracked(key, false)`：那一条写的是
         *    `instancePrefs[key].tracked = false`，也就是"这件事不再管了"真正的落点。
         *    ⚠️★ 两个入参是**同一个字符串**：`folderId` 就是 `instance.key`
         *    （`deriveFolders` 用它当 key，spec §7）⇒ 这里不做任何转换。
         * ⚠️ `unbind-folder` 这个成员**形状照旧保留**（它与 `bind-folder` 一样是老客户端
         *    与新 bundle 共用的契约面，见 `ModPageAction` 那一格的注释）；改变的是
         *    它**接哪条通道**。⚠️ 而"取消追踪"这个语义从此有**两个**入口
         *    （绑定页的勾选框与这一颗），两条发的是**同一条**通道。
         */
        await handlers.setInstanceTracked(action.folderId, false);
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
      case 'open-instance':
      case 'close-instance':
        /*
         * ★★ D1（T7）：这两条**不是通道**（spec §4.4：那两层是同一个路由里的页面状态）。
         * ⚠️★ 它们仍然走这个联合，是为了让"哪个按钮属于哪一层"与其余动作共用**同一处**
         *    接缝（面板里只有一个 `run()`）—— 而"进/出实例层"真正的落点是
         *    `ModDownloadPanel` 的 `selectedInstance`（`useState`，不进持久化）。
         * ⚠️ 所以这里**故意什么都不做**：真发一条 IPC 过去，主进程会回一句"不认识这个动作"。
         *    ⚠️ 另一条真的动作与 `open-instance` 同批发生（版本不同时先 `set-catalog-version`），
         *    那一条由面板在**调用这一处之前**发出去（它自己 `run()` 得动）。
         */
        break;
      case 'download-pack':
        /*
         * ★ B2 / Task 6：整包下载。⚠️ 通道固定 `'origin'`（与 `download-mod` 同一条
         *   纪律与同一个代价：这一节只发 release 自己的地址，不读 `state.bulkChannel`）。
         * ⚠️ 三个入参逐格原样转过去：`gameVersion` 是包自己的那一版（主进程拿它跟目标
         *   文件夹的有效版本对一遍 —— 不一致会往一个别的游戏版本的目录里装 jar）。
         */
        await handlers.downloadPack(action.packId, action.gameVersion, action.folderId, 'origin');
        break;
      case 'cancel-download':
        /*
         * ★ C 的 T5：停掉正在跑的那一趟。⚠️ 没有入参 —— 作用范围是"当前这一趟"
         *   （哪一趟由主进程那一格说了算，页面递不进任何东西）。
         * ⚠️ 它走的是 `cancelDownload`（返回值**不是** `ModFoldersState`）⇒ 在
         *   `makeModFoldersHandlers()` 那一层就接住了两件事：主进程那句 `{ok:false, reason}`
         *   与通道自己的 reject —— 两条都落到 `actionError`，面板上那句 `Notice` 印出来。
         */
        await handlers.cancelDownload();
        break;
      /* ---- ★★ D1（T8）：「启动器绑定」那一格的七个动作 ---- */
      /*
       * ⚠️★ 这七条里有**六条**的契约返回值是 `Promise<void>`（`addLauncher` /
       *    `removeLauncher` / `setInstancePaths` / `setInstanceTracked` /
       *    `confirmInstance`）或"没有对应通道"（`select-launcher-root` 是复合）⇒
       *    它们的状态更新**不经过**这里的返回值，而是主进程 `rebuild()` 推回来的
       *    （`onStatus` ⇒ `useModFolders()` 的 `apply`）。⛔ 别在这里加"把返回的状态
       *    写进界面"的第二种写法：那会变成两处落状态，而它们迟早不一致。
       * ⚠️★ `probe-launchers` 那一支（A14 的重试）**先重新枚举、再重扫候选**：
       *    七条 D1 通道里唯一会重算 `state.launchers[].error` 的是
       *    `listLauncherInstances()`，只重扫候选修不好那一块 —— 理由与"为什么计划里
       *    的六个成员不够用"写在 `ModPageAction` 那一格与报告里。
       */
      case 'probe-launchers':
        await handlers.probeLaunchers();
        break;
      case 'select-launcher-root':
        /*
         * ⚠️ `rootPath` **原样**转过去（不拼分隔符、不 trim —— 归一化在主进程入口那一处，
         *   见 `normalizedBindingRoot`）；`id` 是那条绑定自己的键。
         */
        await handlers.selectLauncherRoot(action.id, action.rootPath);
        break;
      case 'add-launcher':
        await handlers.addLauncher(action.launcherKind, action.rootPath);
        break;
      case 'remove-launcher':
        await handlers.removeLauncher(action.id);
        break;
      case 'set-instance-paths':
        /*
         * ⚠️ 三格**原样**送（`undefined` = 不改这一格 —— 主进程的 `instancePatchOf`
         *   只跳过 `undefined`，而空串会被它**拒**）：面板那一层已经只送变过的那几格。
         */
        await handlers.setInstancePaths(action.key, {
          modsDir: action.modsDir,
          savesDir: action.savesDir,
          loader: action.loader,
        });
        break;
      case 'confirm-instance':
        await handlers.confirmInstance(action.key);
        break;
      case 'set-instance-tracked':
        await handlers.setInstanceTracked(action.key, action.tracked);
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
   * ★ 数据源（T7）：只有 0.2.0+ 的桌面壳才会给出 `ready`；浏览器、0.0.4 的壳与
   *   **0.1.1 的老桌面壳**（有 `modFolders`、没有 D1 那七格）恒为 `unavailable`。
   */
  const mods = useModFolders();
  /**
   * 当前 tab。⚠️★ `null` = **用户还没点过**（那一格是"用户的选择"，不是"默认值"），
   *    于是它下面按 `initialTabFor()` 现推一个 —— D1 的默认规则（A8）。
   *    ⚠️ 计划里这一格写的是 `useEffect` + `setTab(...)`：渲染期推导更准（少一帧
   *    "tab 条说 mod 下载、面板却在画别的"），而且不需要那一条 effect（它在依赖没变时
   *    也不会重跑，但"多一处状态同步"就是多一处会漂的地方）。
   */
  const [tab, setTab] = useState<ModTab | null>(null);
  /**
   * ⚠️ 判据是 `desktopBridge()`（**不是** `useModFolders()`）：后者答的是"有没有那条通道"，
   *    而这个答的是"这是不是一个桌面壳"—— 浏览器要看到装桌面版的入口，0.0.4 不要
   *    （它已经是桌面壳了）。⚠️ 两者问的是两个问题 ⇒ 不会分叉（见文件头那一段）。
   */
  const desktop = desktopBridge() !== null;
  /**
   * ★★ D1（spec A8）：默认 tab —— **没绑启动器 ⇒ 落在「启动器绑定」**。
   * ⚠️ 状态还没到时 `state` 是 `null`（`launchers` 读不出来）⇒ 先按"一个都没绑"算，
   *    拿到状态之后如果发现有绑定，它会自动落到「mod 下载」（用户点过 `tab` 就不再改）。
   */
  /** ★ D1（A8 的第一个空态判的也是这一格）：绑过启动器没有（`launchers.length === 0`）。 */
  const hasLaunchers = mods.status === 'ready' && mods.state.launchers.length > 0;
  /**
   * ★★ D1（spec A8）：默认 tab —— **没绑启动器 ⇒ 落在「启动器绑定」**（绑过 ⇒ 「mod 下载」）。
   * ⚠️ 状态还没到时 `launchers` 读不出来 ⇒ 先按"一个都没绑"算（那一支也就是
   *    `initialTabFor({ hasLaunchers: false })`）；拿到状态之后，用户没点过的话
   *    这一格会**自己**落到该去的那一格。
   * ⚠️★ 这一格是**推导值**、不是第二份状态：`tab` 只记"用户点过哪一格"，
   *    "没点过时该在哪一格"永远由 `initialTabFor()` 现推（两处各存一份的话，
   *    "绑了启动器但界面还停在启动器绑定"这种漂法不会有任何断言出声）。
   */
  const selected: ModTab = tab ?? initialTabFor({ hasLaunchers });

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
        carry-in（值就是纯文本）—— ⚠️★ 当年会印字面星号的是 v1 面板里那处裸 `<p>`
        （`files.autoHint`），而那一处随 T6 连面板一起删了（`files.autoHint` 今天
        没有渲染点）。两条理由不同，完整的那一段写在 `packages/shared/src/i18n/zh-CN.ts`
        的 `files` 那一节。
      */}
      {desktop ? null : (
        <div className="files__browser">
          <Notice kind="info">{t('files.browserOnly')}</Notice>
          <DesktopDownload />
        </div>
      )}

      {/*
        ===================================================================
        ★★ 唯一的岔口（T3；T6 扩了一档）：**不够 D1 的壳** ⇒ 只有一句话
        ===================================================================
        ⚠️★ 那一档**不画 tab**（spec §9.12 / D1：0.0.4 用户"只能看到升级提示"）：
           tab 是"这一页有几个模块"的导航，而没有那条通道时一个模块都没有 ——
           画出来会让"这个客户端太老"看起来像"还有一个模块没做"。
        ⚠️★★ T6 之后这一支是**三档合一**（判据在 `useModFolders()` 里，只有那一处）：
           ① 纯浏览器（连 `mcsr` 都没有）；② 0.0.4（有 `mcsr`、**没有** `modFolders`）；
           ③ **0.1.1 的老桌面壳**（有 `modFolders`、**没有 D1 那七格**）。
           ③ 是这一轮新进来的：线上 bundle 由服务端下发，而老壳给不出 `launchers` /
           `instances` ⇒ 拿它去渲染就是 `undefined.map` 那一类崩溃 ⇒ 判成与浏览器同一档。
      */}
      {mods.status === 'unavailable' ? (
        <ModFoldersUnavailable />
      ) : (
        <>
          <ModTabs tab={selected} onSelect={setTab} />
          <div
            role="tabpanel"
            id={`modtabpanel-${selected}`}
            aria-labelledby={`modtab-${selected}`}
          >
            {selected === 'launchers' ? (
              /*
               * ★★ D1（T8）：这一格的内容（T6 只留了钩子），面板在
               *   `components/LauncherBindingPanel.tsx`。
               *
               * ⚠️★ 钩子 `data-tab-panel="launchers"` 画在**外面**这一层 div 上，
               *   不画在面板里：T6 与 T8 的断言都接在它上面，而面板只在 `ready` 那一支
               *   才渲染 ⇒ 钩子必须挂在"三个支路都能到达"的地方。
               *
               * ⚠️★ 三个支路各有自己的载荷（与 `mods` 那一格同一条纪律）：
               *   · `loading` ⇒ 「正在扫描…」——**不是**"需要桌面版"：这个壳够 D1，
               *     它只是还没读到状态；把"还在等"说成"没这个能力"是一句谎报；
               *   · `failed` ⇒ 失败原话（这一格**没有** `state` 可绑）。⚠️ 用的是
               *     **这一格自己的**词条（`files.launchersStateError`）：失败的原因与
               *     `mods` 那一格同源（同一个 `getState()`），但"拿不到 mod 目录状态"
               *     那句话在这里**说错了主语**（用户会跑去找 mod 目录）；
               *   · `ready` ⇒ 真面板（`state` + `detected` + 动作接缝）。
               * ⚠️ `unavailable`（浏览器 / 老桌面壳）**到不了这一支**：上面那个岔口
               *    整页只画 `ModFoldersUnavailable`（连 tab 都不画，spec §9.12）。
               */
              <div data-tab-panel="launchers">
                {mods.status === 'loading' ? (
                  <ModCatalogScanning />
                ) : mods.status === 'failed' ? (
                  <Notice kind="bad">
                    {t('files.launchersStateError', { reason: mods.reason })}
                  </Notice>
                ) : (
                  <LauncherBindingPanel
                    state={mods.state}
                    detected={mods.detected}
                    onAction={makeModPageAction(mods.handlers)}
                    busy={mods.state.busy}
                    notice={mods.actionError}
                  />
                )}
              </div>
            ) : selected === 'practice' ? (
              /*
               * ★★ 第四格：**骨架**（2026-10-12，用户要求"尽快加上界面骨架、不需要内容，
               *    前端即将重构"）⇒ 只有一格空态 + 一个锚点。
               * ⚠️★ 这一支**必须**在"其余都算 mods"那条兜底之前判 ✗ —— 否则点这一格
               *    会画出 mod 下载那一格的内容，而那种错不会有任何门禁变红（见 `ModTab` 那段）。
               * ⚠️ 锚点画在**外面**这一层（与 `launchers` 那一格同一条理由）：
               *    自检接在它上面，而面板本身可能有 loading / failed 支路。
               */
              <div data-tab-panel="practice">
                <p className="state" data-empty="files-practice">
                  {t('files.practiceEmpty')}
                </p>
              </div>
            ) : selected === 'tools' ? (
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
                progress={mods.progress}
                /*
                 * ★★ D1（T7）：A8 那两种空态里那颗"去勾选 / 去绑定"的入口。
                 * ⚠️★ tab 状态住在**这一层**（`useState`，见 T6 那一段），所以这个回调
                 *    只能在这里造：`setTab('launchers')` —— 面板那一层递不进来第二份。
                 * ⚠️ 它**必需**（不是可选）：忘了传是编译错，不是"那颗按钮静默不生效"。
                 */
                onGoToLaunchers={() => setTab('launchers')}
              />
            )}
          </div>
        </>
      )}
    </>
  );
}
