/**
 * 「mod 下载」那一页的第二段 —— **按版本分组的文件夹行**（2026-10-04，A 的 T3）。
 *
 * ===========================================================================
 * ⚠️★ 纯展示：给一份现成的 `page`（投影）+ `state`（选项表与忙碌位）就同步渲染完
 * ===========================================================================
 * 与 `ModFoldersPanel` / `FileUpdatesPanel` 同一条：不取数、不订阅、不跑 effect。
 * 理由也在那两处（`renderToStaticMarkup` 不跑 effect ⇒ 取数写在这里的话
 * `apps/web/scripts/foldersrender.tsx` 只能看到「正在扫描…」那一屏，这一块里
 * 每一个断言都会变成空跑）。
 *
 * ===========================================================================
 * ⚠️★ 判断不在这里：`page` 是**投影**算好的
 * ===========================================================================
 * "这一版有哪些文件夹"由 `planVersionPage()`（T1）算好；这一层只渲染 `page.folders`。
 * ⚠️ 从 `state` 里另取的东西有两类 —— **都不是"这一版"的投影**：
 *   · **选项表与闸**（`state.gameVersions` / `state.mirrors` / `state.bulkChannel` /
 *     `state.busy`）：它们是整页共用的那份读数（主进程的 `prefs`）。⚠️ 那几个判据
 *     （版本选项表 / 通道选项表）**复用 `ModFoldersPanel` 里那几个已导出的函数**，
 *     不在这里重写第二份：
 *       · `folderGameVersionOptions`（全集 = 目录的 107 版，且当前值必须可选）；
 *       · `channelOptions` / `channelKeyOf`（Ruling 23）。
 *   · **展开体里那一格主页**（T4）：`state.catalogRows` 组出 `homepageOf` 喂给
 *     `FolderJarList` —— 它是**纯展示联结**（没有任何判定依赖 homepage），
 *     理由写在下面那一行的注释里。
 * ⚠️★ 而"给不给「全部更新」"与"哪一版是过期的旧值"这两条也**各只有一处实现**：
 *    `canUpdateFolderAll()` / `staleGameVersion()`（`ModFoldersPanel.tsx`，两处调用点共用）。
 *    ⚠️ 判修轮之前这两条在本文件里各抄了一份**逐字相同**的表达式 —— 那种抄写正是
 *    "同一个判断有两个会漂的版本"，而漂的表现是"少画一颗按钮 / 下拉里少一个 `disabled`"。
 *    ⚠️ `bulkChannelUsable`（Ruling 64 那条）**不在这一层**：它由 `ModDownloadPanel`
 *    渲染一次（面板级那句解释）⇒ 本文件不 import 它（T3 复审 Minor ① 记的正是这一行
 *    原来把它列在"复用项"里，而那时本文件根本没有 import 过它）。
 *
 * ===========================================================================
 * ⚠️★ 折叠是**受控**的（`expanded` 从外面来），不是 `<details>`
 * ===========================================================================
 * 与旧那一版（`ModFoldersPanel` 用原生 `<details>`）**刻意不同**，两个理由：
 *   · spec §8 的最后一行要求"每个可展开处：`▸/▾` + 展开/收起文案 + `aria-expanded`"
 *     —— 原生 `<details>` 的展开态**不在 DOM 里**（只有 `open` 属性，而且它是受控的：
 *     每次状态推送都会被重画），断言不到"值随展开变化"；
 *   · 展开态要**传给投影**（`planVersionPage(state, expanded)`，"已下载"的判定靠它）
 *     ⇒ 它必须是页面手里的一份状态，而 `<details>` 的展开态住在浏览器里。
 * ⚠️ 代价（明摆着，报告里记着）：`expanded` 是**组件外的**那一份状态，这一层不管它；
 *   而"点一下真的会换态"由 `ModDownloadPanel` 的 `useState` 负责（静态渲染证不了点击）。
 *
 * ===========================================================================
 * ⚠️★ 计划里写的 `▸` / `▾` 两个字符**换成了 CSS 画的三角**
 * ===========================================================================
 * `packages/shared/src/i18n/zh-CN.ts` 里那段实测写着：那**两份自托管像素字体都没有**
 * `▾`（`check-font-coverage.mjs` 扫的是 i18n，扫不到组件里的字符 —— 所以它不会红，
 * 用户会看到豆腐块）。⇒ 走 `ClickToPlayEmbed` 的同一招（那里为 `▶` 写过完整的一段）：
 * 三角形用 CSS 画（`.folderrow__caret`），`aria-hidden="true"`，文字照旧是
 * 「展开 / 收起」（`files.expand` / `files.collapse`）。
 *
 * ===========================================================================
 * ⚠️★ 旧组件（`ModFoldersPanel`）**还在**，一个提交周期内两套控件并存
 * ===========================================================================
 * T3 只换**页面**（`routes/Files.tsx`），旧第二部分与它那十几组渲染断言一起留到 **T6**
 * （那一轮删文件 + 删断言，理由写在计划里：一次删净会让中间每一个提交的门禁变红）。
 * ⇒ 这里与 `ModFoldersPanel` 的差异**只有行标记与排版**（`<details>/<summary>` ⇒
 * `div/div` + 受控展开），控件本身与它们的判据逐条对齐：
 *   · 版本下拉（含"过期那一版照画但 `disabled`"，Ruling 64）；
 *   · 整夹自动更新开关（可访问名里带路径）；
 *   · 批量通道选择器（值只从状态读，Ruling 23）；
 *   · 「全部更新」（带 `batchTargets` 的数字）/「重扫这个文件夹」/「解除绑定」。
 * ⚠️ 那些**判据**（判断，不是排版）能复用的都复用了（见上面那一段）；
 *   复用了不的地方是 JSX 形状本身（两套行的 class 名不同，各断言各的）。
 */
import {
  batchTargets,
  type ModFoldersState,
  type ModFolderView,
  type VersionFolderBlock,
  type VersionPage,
} from '@mcsr/shared/modFolders';
import { useTranslation } from 'react-i18next';
import { FolderJarList } from '@/components/FolderJarList';
import type { ModPageActionHandler } from '@/components/ModDownloadPanel';
import {
  canUpdateFolderAll,
  channelKeyOf,
  channelOptions,
  folderGameVersionOptions,
  staleGameVersion,
} from '@/components/ModFoldersData';

/**
 * 版本徽章（一行里"这是哪一版"的那一格）。
 *
 * ⚠️ 版本未知（`null`）时印的是 `files.verdictUnknownVersion`（"游戏版本未知"）——
 * 那一支**不许**留空：空着与"还没渲染"分不开，而它正是"这一行为什么一个更新按钮都没有"
 * 的第一个线索（出路在展开体里那句 `folderGameVersionHint`）。
 */
export function VersionBadge({ version }: { version: string | null }) {
  const { t } = useTranslation();
  return (
    <span className="badge badge--version" data-version={version ?? ''}>
      {version ?? t('files.verdictUnknownVersion')}
    </span>
  );
}

/**
 * 文件夹的**状态徽章**（spec §8：路径不存在 / 读不了 / 版本未知各是一档）。
 *
 * ⚠️★ 三档**互斥**、而且顺序是有意的（路径不存在时，后面两档都没有意义 —— 我们根本
 * 没读到那个目录）：
 *   · 路径不存在 ⇒ `badge--problem`（红），与旧那一版同一个类名；
 *   · 版本未知 ⇒ 一条普通徽章（出路是那一行里的版本下拉）；
 *   · 有路径、版本知道、但**没有成功的扫描读数** ⇒ 一条普通徽章（Ruling 65：它与
 *     "里面没有 mod"是两件事，解释在展开体里）。
 * ⚠️ 正常那一档**什么都不画**（一个"一切正常"的徽章是噪声：每一行都有的东西不传递信息）。
 */
export function FolderStatusBadge({ folder }: { folder: ModFolderView }) {
  const { t } = useTranslation();
  if (!folder.pathExists) {
    return <span className="badge badge--problem">{t('files.folderPathMissing')}</span>;
  }
  if (folder.gameVersion === null) {
    return <span className="badge">{t('files.verdictUnknownVersion')}</span>;
  }
  if (!folder.hasReading) {
    return <span className="badge">{t('files.folderNoReadingBadge')}</span>;
  }
  return null;
}

export interface VersionFolderListProps {
  /** 整页那份读数（选项表 / 闸 / 忙碌位都在它里面）。 */
  state: ModFoldersState;
  /** 这一版的一页（`planVersionPage()` 的产物）—— 页面只渲染它。 */
  page: VersionPage;
  /** 界面上的展开态（文件夹 id）。⚠️ 它同时要喂给投影（"已下载"的判定）。 */
  expanded: readonly string[];
  /** 点那一颗「展开 / 收起」（住在**页面**手里的那份状态上）。 */
  onToggle: (folderId: string) => void;
  /** 动作层（`ModDownloadPanel` 包过 try/catch 的那一个）。 */
  onAction: ModPageActionHandler;
}

/**
 * 这一段的标题（`{{version}} 下的 mod 文件夹`）。
 * ⚠️ 版本未知的那些文件夹**不在这一栏里**（它们不属于任何一版）—— 它们由
 * `AllFoldersView` 那一栏兜着（`groupFoldersByVersion` 把 `null` 自成一组）。
 */
export function VersionFolderList({
  state,
  page,
  expanded,
  onToggle,
  onAction,
}: VersionFolderListProps) {
  const { t } = useTranslation();
  const expandedSet = new Set(expanded);
  /**
   * ★★ 目录里每个 modid 的 homepage（展开体里那一格要它）。
   *
   * ⚠️★ 为什么**必须**在这里组、而不是让 `FolderJarList` 自己去 `state` 里翻：
   *    `VersionFolderBlock` / `ModFolderRowView` 都**不带** homepage（它只在
   *    `CatalogRowView` 上，由 `planCatalogRows` 从 `ModEntry.homepage` 填）
   *    ⇒ "jar 行给主页链接"这一条只能由页面把这份映射喂下去（2026-10-04 T1 评审的裁定）。
   * ⚠️ 它是**纯展示联结**：`?? null` 只是把"目录里没写"与"没有这一格"合成同一个值，
   *    **不含任何判断**（没有任何判定依赖 homepage）。
   * ⚠️ 每次渲染重算：`catalogRows` 是这一版那几十行（真目录实测 48 行）⇒ 一次 O(48) 的
   *    map 构造，比在这一层加一份 `useMemo` 的记忆状态便宜（也与"这一层不存状态"同一条）。
   */
  const homepageOf = new Map(state.catalogRows.map((row) => [row.modid, row.homepage ?? null]));

  return (
    <section
      className="folderlist"
      data-version={page.version}
      data-folder-count={page.folders.length}
    >
      <h3 className="folderlist__title">
        {t('files.versionFoldersTitle', { version: page.version })}
      </h3>
      {/*
        ★ 第一处空态（spec §8 第一行）：这个版本下**一个文件夹都没有**。
        ⚠️★ 它同时是**这一期唯一的绑定入口**（`bindFolder` 弹原生目录对话框建实体）；
        没有它的话，新页面在"一个都没绑"时是一条死路。
      */}
      {page.folders.length === 0 ? (
        <div className="state state--empty">
          <p>{t('files.folderNoneVersion')}</p>
          <div className="filespanel__actions">
            <button
              type="button"
              className="cta"
              data-action="bind-folder"
              /* ⚠️ 正在写盘时按住：`bindFolder` 会建实体 + 立刻扫一次（改状态、读磁盘）。 */
              disabled={state.busy}
              onClick={() => void onAction({ kind: 'bind-folder' })}
            >
              {t('files.bindFolder')}
            </button>
          </div>
        </div>
      ) : null}
      {page.folders.map((block) => (
        <FolderRow
          key={block.folder.folderId}
          state={state}
          block={block}
          homepageOf={homepageOf}
          isExpanded={expandedSet.has(block.folder.folderId)}
          onToggle={onToggle}
          onAction={onAction}
        />
      ))}
    </section>
  );
}

/** 一个文件夹：一行（永远可见）+ 展开体（T4 起里面是那一夹的 jar 列表）。 */
function FolderRow({
  state,
  block,
  homepageOf,
  isExpanded,
  onToggle,
  onAction,
}: {
  state: ModFoldersState;
  block: VersionFolderBlock;
  /** 目录里每个 modid 的 homepage（展开体里那一格要它，见 `VersionFolderList`）。 */
  homepageOf: ReadonlyMap<string, string | null>;
  isExpanded: boolean;
  onToggle: (folderId: string) => void;
  onAction: ModPageActionHandler;
}) {
  const { t } = useTranslation();
  const folder = block.folder;
  const busy = state.busy;
  /** 这个文件夹里**真的会进批量**的行数（那颗按钮上的数字）。 */
  const targets = batchTargets(folder.rows);
  const versions = folderGameVersionOptions(state, folder);
  const channels = channelOptions(state);
  /** 版本未知 ⇒ 每一行都是 `unknown-version`，展开体里要说清（spec §8）。 */
  const versionUnknown = folder.gameVersion === null;
  /**
   * ★ 这个文件夹的游戏版本**已经不在目录里**了（目录换过之后的旧值）。
   * ⚠️ 判据与理由都在 `staleGameVersion()`（**一处实现**，旧那一版也用同一个函数）。
   */
  const staleVersion = staleGameVersion(state, folder);
  /**
   * ★★ 「全部更新」的判据 —— 四条闸住在 `canUpdateFolderAll()` 里（**一处实现**，
   * 旧那一版也用同一个函数），逐条对着主进程的拒绝：路径在、版本知道、
   * **真的有条目可批量**，而且**状态里那条通道还成立**（Ruling 64）。
   * ⚠️ 这一行**没有**"只读"那一档：新页面只在 `ready` 支路渲染（`onAction` 恒定存在）。
   */
  const showUpdateAll = canUpdateFolderAll(state, folder);

  return (
    <div className="folderrow" data-folder-id={folder.folderId}>
      <div className="folderrow__head">
        {/*
          ★★ 展开标识（spec §8 最后一行）：`aria-expanded` **随展开态变化**是这一条的判据
          （写死 `false` 会被 ㉞ 的第二条抓住）。⚠️ 三角是 CSS 画的，见文件头那一段。
        */}
        <button
          type="button"
          className="folderrow__toggle"
          aria-expanded={isExpanded}
          onClick={() => onToggle(folder.folderId)}
        >
          <span
            className="folderrow__caret"
            aria-hidden="true"
            data-open={isExpanded ? 'yes' : 'no'}
          />
          {isExpanded ? t('files.collapse') : t('files.expand')}
        </button>
        {/* ⚠️ 路径是磁盘上的内容，原样印（不翻译）。 */}
        <span className="folderrow__path">{folder.path}</span>
        <VersionBadge version={folder.gameVersion} />
        <FolderStatusBadge folder={folder} />
        {/*
          ★★ 「打开文件夹」（spec §9.13）：**只送 id**，路径由主进程从自己的状态里取
          （`openFolder(folderId)`，T2 的契约）。⚠️ 路径不在时**禁用**（那颗按钮点下去
          只会得到一句"打不开"）。
          ⚠️★ 失败**不在这里 catch**：`makeModFoldersHandlers()` 那一层接住它
          （主进程对未知 id 是**抛**，`mod-folders.ts:941`），落点是 `actionError`
          ⇒ `ModDownloadPanel` 把它印出来（这一步的接线由 ㉟ 的形状守卫钉着）。
        */}
        <button
          type="button"
          className="ghostbtn"
          data-action="open-folder"
          disabled={!folder.pathExists}
          onClick={() => void onAction({ kind: 'open-folder', folderId: block.folder.folderId })}
        >
          {t('files.openFolder')}
        </button>
        {/*
          ★ 游戏版本**可改**（spec §8）。⚠️ 空取值 = "交回自动推断"
          （`setFolderGameVersion(folderId, null)`）；选一个具体版本 = 写字面值。
          主进程那一侧 `requireGameVersion` 只认目录里有的版本 ⇒ 选项表来自
          `state.gameVersions`（见 `folderGameVersionOptions`）。
        */}
        <label className="folderrow__field">
          {t('files.catalogGameVersion')}
          <select
            className="filters__select"
            value={folder.gameVersion ?? ''}
            disabled={busy}
            onChange={(event) => {
              const next = event.target.value;
              // ⚠️ 空串 = null：契约里 null 是"交回自动推断"，不是"不改"
              void onAction({
                kind: 'set-folder-version',
                folderId: folder.folderId,
                version: next === '' ? null : next,
              });
            }}
          >
            <option value="">{t('files.folderGameVersionAuto')}</option>
            {versions.map((version) => (
              /*
               * ⚠️★ 过期那一版（`staleVersion`）**照画但 `disabled`**：Ruling 64 ——
               *    旧值要看得见（否则 `<select value=X>` 会静默选中第一个），
               *    但不许被当成一个新动作发出去（`requireGameVersion` 会拒）。
               */
              <option key={version} value={version} disabled={version === staleVersion}>
                {version}
              </option>
            ))}
          </select>
        </label>
        {/*
          ★ 整夹自动更新开关。⚠️ 与 v1 那个勾选框**同一条语义**（只表示启动时检查并高亮，
          写盘永远要一次点击）⇒ 可访问名复用 `files.autoLabel`（名字里带**路径**：
          这一页可能有好几个文件夹，读屏要分得开）。
        */}
        <label className="folderrow__field">
          <input
            type="checkbox"
            aria-label={t('files.autoLabel', { name: folder.path })}
            checked={folder.autoUpdate}
            disabled={busy}
            onChange={(event) =>
              void onAction({
                kind: 'set-folder-auto-update',
                folderId: folder.folderId,
                on: event.target.checked,
              })
            }
          />
          {t('files.colAuto')}
        </label>
        {/*
          ★★ 批量通道选择器。⚠️ 它读的是 `state.bulkChannel`（主进程 `prefs` 里那一份），
          组件**不存**第二份（Ruling 23：两处记忆的表现是"界面显示 origin、主进程按镜像下载"）。
          它的作用域是「全部更新」—— 单个行各有自己的按钮（T4 那一层）。
        */}
        <label className="folderrow__field">
          {t('files.folderBulkChannel')}
          <select
            className="filters__select"
            value={channelKeyOf(state.bulkChannel)}
            disabled={busy}
            onChange={(event) => {
              const next = event.target.value;
              void onAction({
                kind: 'set-bulk-channel',
                channel: next === 'origin' ? 'origin' : { mirrorId: next },
              });
            }}
          >
            {channels.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.key, option.vars)}
              </option>
            ))}
          </select>
        </label>
        {showUpdateAll ? (
          <button
            type="button"
            className="cta"
            disabled={busy}
            onClick={() =>
              void onAction({
                kind: 'update-folder-all',
                folderId: folder.folderId,
                channel: state.bulkChannel,
              })
            }
          >
            {t('files.folderUpdateAll', { count: targets })}
          </button>
        ) : null}
        {/*
          ★ 重扫这个文件夹（只读：不下载、不写盘；主进程那一侧还会顺带重拉目录）。
          ⚠️ 只在路径还在时画：`rescan` 对一个不存在的目录只会把读数再删一次
          （不许叫人去点一个修不好它的按钮）。⚠️ 它也是"游戏版本推断不出来"那一档的出口。
        */}
        {folder.pathExists ? (
          <button
            type="button"
            className="ghostbtn"
            disabled={busy}
            onClick={() => void onAction({ kind: 'rescan-folder', folderId: folder.folderId })}
          >
            {t('files.folderRescan')}
          </button>
        ) : null}
        {/*
          ★ 解绑（`unbindFolder`：删的是状态里那一格，用户磁盘上的文件一个字节都不动）。
          ⚠️ 路径不存在时**照常给**（spec §8：路径不存在时"可解绑"）—— 它是那一档唯一能做的事。
        */}
        <button
          type="button"
          className="ghostbtn"
          disabled={busy}
          onClick={() => void onAction({ kind: 'unbind-folder', folderId: folder.folderId })}
        >
          {t('files.unbind')}
        </button>
      </div>

      {/*
        ★★ 展开体（T4 起里面是 `FolderJarList`：那一夹的全部 jar，含未识别标红的行）。
        ⚠️★ 折叠时**整块不渲染**（不是"渲染了但藏起来"）：这一页可能有十几个文件夹、
        每个几十行 —— 藏起来等于把它们全留在 DOM 里。⚠️ T4 之前"折叠态没有 jar 行"
        这条判据**只有这一半有牙齿**（`data-jar` 那时不存在 ⇒ 另半条恒真）；
        T4 之后它由 ㉞ 里**一正一反**两条读数一起兜着（见那个脚本的注释）。
        ⚠️ 三句话的分工（spec §8 / Ruling 65）：路径不存在 / 版本未知 / 还没有成功读数
        —— 它们**互斥**，而且每一句都只在它那一档出现。
        ⚠️★ **"读到过、里面没有"也在这里**（判修轮补的）：Ruling 65 是**两支** ——
        "读不了"（`!hasReading`）与"读到过而一个都没有"（`hasReading && rows.length === 0`）。
        少了后半支，扫过但是空的文件夹展开后是一个**空白框**，而那正是 Ruling 65 要消灭的
        那种"分不出没有与不知道"。⚠️ 判据与旧那一版（`ModFoldersPanel` 的 body）**逐字相同**：
        `pathExists && hasReading && rows.length === 0`（两个条件缺一不可 —— 扫描失败时
        `rows` 也是空的）。⚠️ 这一句说的是"没有**能识别**的 mod"，而 T4 的 jar 列表
        照旧会把**未识别**的那些文件名列出来（两者不互斥，见下面那一块的判据）。
      */}
      {isExpanded ? (
        <div className="folderrow__body" data-folder-body={folder.folderId}>
          {folder.pathExists ? null : (
            <p className="folderrow__note">{t('files.folderPathMissingHint')}</p>
          )}
          {folder.pathExists && versionUnknown ? (
            <p className="folderrow__note">{t('files.folderGameVersionHint')}</p>
          ) : null}
          {folder.pathExists && !folder.hasReading ? (
            <div className="state state--empty">
              <p>{t('files.folderNoReading')}</p>
            </div>
          ) : null}
          {folder.pathExists && folder.hasReading && folder.rows.length === 0 ? (
            <div className="state state--empty">
              <p>{t('files.folderNoRows')}</p>
            </div>
          ) : null}
          {/*
            ★★ T4：这一夹的全部 jar（已识别的行 + **未识别标红**的行）。
            ⚠️★ 判据是"**有东西可列**"（认出来的 **或** 认不出来的都算）：
              上面的空态管的是"一个能识别的都没有"（Ruling 65 的后半支），
              而那时**未识别的文件名照旧要列出来**（它们是看得见的读数）——
              拿 `rows.length === 0` 当这一层的闸，会把它们一起藏掉。
            ⚠️ `pathExists` 不在这里重复判：`planFolderView` 对"路径不存在"给的就是
              `rows: []` + `unrecognized: []`（两格都清）⇒ 那一档这一块根本画不出来。
          */}
          {folder.rows.length + folder.unrecognized.length === 0 ? null : (
            <FolderJarList
              block={block}
              homepageOf={homepageOf}
              mirrors={state.mirrors}
              busy={busy}
              onAction={onAction}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
