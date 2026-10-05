/**
 * 「文件更新」第二部分 —— **已绑定的 mod 文件夹**（2026-10-03，Task 8）。
 *
 * ===========================================================================
 * ⚠️★ 纯展示：给一份现成的 `state` 就同步渲染完
 * ===========================================================================
 * 与 `FileUpdatesPanel` / `FileUpdateTable` 同一条：不取数、不订阅、不跑 effect。
 * 理由也在那两处（`renderToStaticMarkup` 不跑 effect ⇒ 取数写在这里的话
 * `apps/web/scripts/foldersrender.tsx` 只能看到「正在扫描…」那一屏，这一块里
 * 每一个断言都会变成空跑）。
 *
 * ===========================================================================
 * ⚠️★ 「不给一颗会被主进程拒的按钮」—— 这一层的判据（逐条现读 `mod-folders.ts`）
 * ===========================================================================
 * 与 Ruling 47/48 是同一族（第一部分的 `ModCatalogTable` 那里写着完整的一段）：
 *   · **行内那两颗更新按钮**的判据是"**主进程会不会收**"：判定是 `older` **或**
 *     `different-build`、且不是 `manual`。`assertUpdatable` 放行的正是
 *     `same` / `different-build` / `older`，而界面照 spec §8 只画前两颗（`same` = 幂等，
 *     没有"再点一次"的意义）；`updateMod` 那句"没有目标"（`official === null`）由
 *     `older` / `different-build` 这两支**蕴含**（它们都要求 `official` 非空）。
 *     ⚠️★ 判据**不是** `row.batchable`（2026-10-04 收口波的真缺陷）：`batchable` 只认
 *     `older` + `download === 'auto'` + 两边版本主体可排序 ⇒ 拿它当闸时 `different-build`
 *     那一行**一颗按钮都没有**，而同一屏的 `lastRun.skipped` 却说"要人显式点一下这一条"。
 *     ⇒ 那 4 个主体含非数字段的 mod（`custom-map-resetter` / `krypton` / `noverworld` /
 *     `pogworld`）与 `standardsettings` 在这一期之前**没有任何入口能更新**。
 *     ⚠️ 批量那一侧**一个字都没改**：`updateFolderAll` 仍然只碰 `batchable` 的行。
 *   · **「全部更新」**要 `pathExists` **且** `gameVersion !== null`（spec §8 的两条：
 *     路径不存在 / 版本未知都不给更新动作），另外还要 `batchTargets(rows) > 0` 才画。
 *     ⚠️★ 最后这一条**不是保险**：`updateFolderAll` 在"这个文件夹还没有扫描读数"时
 *     **拒**（它那句 `readingOf(id).ok`），而"没扫过"与"它是空的"在状态里长得一模一样
 *     （`rows` 都是空数组）⇒ 0 条可批量时根本不画那颗按钮，那条拒绝就**不可达**了。
 *   · **「重扫这个文件夹」**只在 `pathExists` 时画：`rescan` 对一个不存在的目录只会把
 *     读数再删一次（`buildState` 里 `missingStatus === 'folder-missing'` 那句注释写着
 *     同一件事：**不许**叫人去点一个修不好它的按钮）。⚠️ 它**不在** brief 的头行清单里
 *     （报告里记了这笔偏离）：没有它的话，「还没有扫描读数」与「游戏版本推断不出来」
 *     这两种状态在页面上没有任何出口。
 *   · **通道**：页面只发它**证得了**的那条。判据与主进程的 `channelUrl` 是同一份实现
 *     （`mirrorsForUrl`，即 `mirrorsFor`）⇒ 行内两颗按钮各自明说自己那条通道，而镜像
 *     那一颗只在"这条 release 的主机真的在某条镜像的 `hosts` 里"时出现（D5）。
 *     ⚠️★ **底部那一栏走的是同一条判据**（见 `MissingModsList.tsx`）：`MissingModView.release`
 *     是**必填**（`packages/shared/src/modFolders.ts`，Ruling 62②/63）⇒ 页面证得了"这条
 *     release 的镜像适不适用"，非 manual 的行因此画**两颗**下载（原地址 + 镜像）。
 *     ⚠️ 旧注释说"`MissingModView` 里**没有** release、底部的「下载」只走原地址" ——
 *     那两半在 Ruling 63 之后都是假的（2026-10-04 文档订正波改准；见 `docs/pending.md` §5.110 ⑤）。
 *
 * ===========================================================================
 * ⚠️★ 没有逐行进度（T6 §9.6 第 3 条）
 * ===========================================================================
 * 契约里**只有**一个布尔 `busy`（`ModFoldersState` 没有进度字段）⇒ 跑批量时能表达的
 * 只有"现在不能点"，**不许**自己编一个进度条出来（`installRelease` 的注释里写着
 * "不传 `onProgress`"的同一个理由：没有承载它的那一格）。
 *
 * ===========================================================================
 * ⚠️ 折叠用**原生** `<details>`
 * ===========================================================================
 * 与 `RankedPanels` / `ShareCard` / `CalendarSeriesSection` 同一条：闭合时内容
 * **仍然在 DOM 里** ⇒ 纯 SSR 的渲染自检看得见它，而且键盘与读屏是浏览器自带的。
 * ⚠️ 头行那一排控件住在 `<summary>` 里（spec §6.8 的字面："头行显示路径、游戏版本
 *   （可改）、整夹自动更新开关、批量通道选择器、全部更新、解绑"）⇒ 折叠起来也点得到。
 *   代价（**没有门禁看得见**，报告里记着）：点 `<summary>` 里的 `<button>` / `<select>`
 *   会不会顺带展开或收起，是**浏览器**的行为 —— 自检只验结构，不验这一条。
 * ⚠️ 刻意**不写** `open`：`<details open>` 在 React 里是**受控**的（每次状态推送都会
 *   把它重新展开，用户刚收起的那一下就被抹掉）—— 默认收起、由用户决定。
 */
import {
  batchTargets,
  type Channel,
  type ModFolderRowView,
  type ModFoldersState,
  type ModFolderView,
  mirrorsForUrl,
} from '@mcsr/shared/modFolders';
import { useTranslation } from 'react-i18next';
import type { ModFoldersHandlers } from '@/components/FileUpdatesPanel';
import { VERDICT_BADGES, VERDICT_HINTS } from '@/components/FileUpdateTable';
import { Notice } from '@/components/Form';

/** 「没有值的那一格」——与两张表里那个 `DASH` 是同一个字符。 */
const DASH = '—';

/**
 * 文件夹的游戏版本下拉**选项表**。
 *
 * ⚠️★ 判据与第一部分的 `gameVersionOptions()` 逐字相同（同一份纪律；两份函数是因为
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
  if (version === null || state.gameVersions.includes(version)) return [...state.gameVersions];
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
  if (current !== 'origin' && !state.mirrors.some((mirror) => mirror.id === current.mirrorId)) {
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
 * ⚠️ 导出是给 A 的 T3 那一行（`VersionFolderList`）复用的：通道的**形状**只有这一处
 * 实现（`'origin' | { mirrorId }` ⇒ 下拉的字符串），两处各写一份就会有一天对不上。
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
 * ⇒ 判据收在这一个函数里，两个渲染点（面板头那句解释 / 头行那颗「全部更新」）共用它。
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
  return state.mirrors.some((mirror) => mirror.id === channel.mirrorId);
}

/**
 * ★ 这个文件夹的游戏版本**已经不在目录里**了（目录换过之后的旧值）；不是那种情况给 `null`。
 *
 * ⚠️★ 抽出来是 A 的 T3 **判修轮**要求的：新那一行（`VersionFolderList`）与旧这一版
 *    （下面的 `FolderBlock`）各写了一份**逐字相同**的表达式 ⇒ 两份迟早会漂，
 *    而漂的表现是"下拉里少一个 `disabled`"（看起来像目录坏了）。
 * ⚠️ 它为什么必须**照画**（而不是把旧值藏掉）：`<select value=X>` 里没有 X 时浏览器会
 *    **静默选中第一个** —— 那一屏就在撒谎（Ruling 23 反对的正是这件事）；而它必须
 *    `disabled`：`requireGameVersion` 只认目录里有的版本（**Ruling 64**：
 *    过期的持久化值可以显示，不许被当成新动作发出去）。
 */
export function staleGameVersion(state: ModFoldersState, folder: ModFolderView): string | null {
  const version = folder.gameVersion;
  if (version === null || state.gameVersions.includes(version)) return null;
  return version;
}

/**
 * ★★ 「全部更新」那一颗**画不画**（一次批量写盘的四条闸）：路径在 / 版本知道 /
 *    真的有可批量的行 / 状态里那条通道还成立（Ruling 64）。
 *
 * ⚠️★ 抽出来是 A 的 T3 **判修轮**要求的：新那一行（`VersionFolderList`）与旧这一版
 *    （下面的 `FolderBlock`）原来各写着**逐字相同**的四条件表达式 ⇒ 一处漂了，另一处
 *    会照旧画一颗主进程必拒的按钮（或者相反：静默少一颗，用户只会觉得"按钮怎么没了"）。
 * ⚠️ 旧那一版另有 `!readOnly`（`handlers === null` ⇒ 一颗按钮都不画）—— 那是**旧组件自己的**
 *    一格（新页面只在 `ready` 支路渲染 ⇒ 没有只读态），所以它留在调用点，**不在**这个函数里。
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

export interface ModFoldersPanelProps {
  /** 第二部分唯一的**数据**来源（`ModFoldersState.folders`）。 */
  state: ModFoldersState;
  /**
   * 动作层。`null` = 只读（自检里那次「没有动作层就不画按钮」的对照）。
   * ⚠️ 产品里第二部分**只在** `modFolders` 在的客户端渲染 ⇒ 那时它总是有 handlers。
   */
  handlers: ModFoldersHandlers | null;
}

/**
 * 第二部分本体：一个文件夹一个 `<details>`（头行 + 行表 + 「无法识别」那一列）。
 *
 * ⚠️ `lastRun` / `notices` / `actionError` **都不在这里印**：
 *   · `lastRun` 由第一部分印（"上一次运行"，busy 时不印）—— 印第二遍就是同一件事
 *     挂两个地方（状态里只有一份读数，界面上就该只有一个渲染点）；
 *   · `notices`（含"已转为文件夹跟踪：…"那条迁移提示）也由第一部分印；
 *   · `actionError` 同上（它是**整页**一次动作的原话，不是这一块的）。
 * ⚠️★ 类名是 `.folderspanel`（**不是** `.filespanel`）：v1 的渲染自检有一条
 *    "产物里没有 `filespanel` 这个子串"的粗判据，而这一块**可能**与那一屏同页 ——
 *    用自己的类名就不会在**正确**的产物上把它打红（完整理由见 `routes/Files.tsx`
 *    里 `ModFoldersUnavailable` 的注释）。
 */
export function ModFoldersPanel({ state, handlers }: ModFoldersPanelProps) {
  const { t } = useTranslation();
  const busy = state.busy;
  /** Ruling 64：过期通道时那颗批量按钮不画，这里说清为什么。 */
  const channelOk = bulkChannelUsable(state);

  return (
    <section
      className="folderspanel"
      data-folder-count={state.folders.length}
      data-bulk-channel-usable={channelOk ? 'yes' : 'no'}
    >
      <h2>{t('files.partTwoTitle')}</h2>
      <p className="filespanel__hint">{t('files.partTwoHint')}</p>
      {/*
        ★★ Ruling 64：状态里那条通道已经不成立了 ⇒ 一句解释（**面板级**，不是每个文件夹
        重复一遍：`prefs.bulkChannel` 是全局的，说一次就够）。
        ⚠️ 走 `<Notice kind="bad">`：它挡掉的是一个动作（不是脚注）。
      */}
      {channelOk ? null : <Notice kind="bad">{t('files.channelStaleHint')}</Notice>}
      {state.folders.length === 0 ? (
        /*
         * ★ 第一处空态：一个文件夹都没绑。⚠️ 它同时是这一期**唯一**的绑定入口
         *   （v1 的「选择 mods 目录」走的是老通道，语义也换了 —— spec §6.7）。
         */
        <div className="state state--empty">
          <p>{t('files.folderNone')}</p>
          {handlers === null ? null : (
            <div className="filespanel__actions">
              <button
                type="button"
                className="cta"
                /*
                 * ⚠️ 正在写盘时按住：`bindFolder` 会建实体 + 立刻扫一次（改状态、读磁盘），
                 * 与一条正在跑的更新挤在一起是没必要的并发（v1 面板那颗「选择 mods 目录」
                 * 用的是同一条理由）。
                 */
                disabled={busy}
                onClick={() => void handlers.bindFolder()}
              >
                {t('files.bindFolder')}
              </button>
            </div>
          )}
        </div>
      ) : (
        state.folders.map((folder) => (
          <FolderBlock key={folder.folderId} state={state} folder={folder} handlers={handlers} />
        ))
      )}
    </section>
  );
}

/** 一个文件夹：头行（`<summary>`）+ 行表 + 「无法识别」清单。 */
function FolderBlock({
  state,
  folder,
  handlers,
}: {
  state: ModFoldersState;
  folder: ModFolderView;
  handlers: ModFoldersHandlers | null;
}) {
  const { t } = useTranslation();
  const busy = state.busy;
  const readOnly = handlers === null;
  /** 这个文件夹里**真的会进批量**的行数（头行那颗按钮上的数字）。 */
  const targets = batchTargets(folder.rows);
  const versions = folderGameVersionOptions(state, folder);
  const channels = channelOptions(state);
  /** 版本未知 ⇒ 每一行都是 `unknown-version`，头行要说清（spec §8）。 */
  const versionUnknown = folder.gameVersion === null;
  /**
   * ★ 这个文件夹的游戏版本**已经不在目录里**了（目录换过之后的旧值）。
   * ⚠️ 判据与理由都在 `staleGameVersion()`（**一处实现**，新那一行也用同一个函数）。
   */
  const staleVersion = staleGameVersion(state, folder);
  /**
   * ★★ 「全部更新」的判据（写在文件头那一段里，逐条对着主进程的拒绝）：四条全中才画那颗按钮。
   * ⚠️ 四条住在 `canUpdateFolderAll()` 里（**一处实现**，新那一行也用同一个函数）；
   *    这里多出来的 `!readOnly` 是**旧组件自己的**一格，见那个函数的注释。
   */
  const showUpdateAll = !readOnly && canUpdateFolderAll(state, folder);

  return (
    <details className="folderbox" data-folder-id={folder.folderId}>
      <summary className="folderbox__head">
        <span className="folderbox__path">{folder.path}</span>
        {folder.pathExists ? null : (
          <span className="badge badge--problem">{t('files.folderPathMissing')}</span>
        )}
        <span className="folderbox__controls">
          {/*
            ★ 游戏版本**可改**（spec §6.8）。⚠️ 空取值 = "交回自动推断"
            （`setFolderGameVersion(folderId, null)`）；选一个具体版本 = 写字面值。
            主进程那一侧 `requireGameVersion` 只认目录里有的版本 ⇒ 选项表来自
            `state.gameVersions`（见 `folderGameVersionOptions`）。
          */}
          <label className="folderbox__field">
            {t('files.catalogGameVersion')}
            <select
              className="filters__select"
              value={folder.gameVersion ?? ''}
              disabled={readOnly || busy}
              onChange={(event) => {
                if (handlers === null) return;
                const next = event.target.value;
                // ⚠️ 空串 = null：契约里 null 是"交回自动推断"，不是"不改"
                void handlers.setFolderGameVersion(folder.folderId, next === '' ? null : next);
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
            ★ 整夹自动更新开关。⚠️ 与 v1 那个勾选框**同一条语义**（只表示启动时检查
            并高亮，写盘永远要一次点击）⇒ 可访问名复用 `files.autoLabel`
            （"启动时检查「{{name}}」"），名字里带**路径**（那一排勾选框里哪一个是谁，
            读屏要分得开 —— `nav.reorder` 那条词条为同一件事写过完整的一段）。
          */}
          <label className="folderbox__field">
            <input
              type="checkbox"
              aria-label={t('files.autoLabel', { name: folder.path })}
              checked={folder.autoUpdate}
              /* ⚠️ 与 v1 那张表同一条：写盘期间按住（那时改状态文件会被并发覆盖）。 */
              disabled={readOnly || busy}
              onChange={(event) => {
                if (handlers === null) return;
                void handlers.setFolderAutoUpdate(folder.folderId, event.target.checked);
              }}
            />
            {t('files.colAuto')}
          </label>
          {/*
            ★★ 批量通道选择器（spec §6.8：批量必须有个默认）。⚠️ 它读的是
            `state.bulkChannel`（主进程 `prefs` 里那一份），组件**不存**第二份
            （Ruling 23：两处记忆的表现是"界面显示 origin、主进程按镜像下载"）。
            ⚠️ 它的作用域是「全部更新」—— 单个行各有自己那两颗按钮（见 `FolderRow`）。
          */}
          <label className="folderbox__field">
            {t('files.folderBulkChannel')}
            <select
              className="filters__select"
              value={channelKeyOf(state.bulkChannel)}
              disabled={readOnly || busy}
              onChange={(event) => {
                if (handlers === null) return;
                const next = event.target.value;
                void handlers.setBulkChannel(next === 'origin' ? 'origin' : { mirrorId: next });
              }}
            >
              {channels.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.key, option.vars)}
                </option>
              ))}
            </select>
          </label>
          {/*
            ★★ 「全部更新」：一次点击驱动 N 个下载 ⇒ 按钮上的数字是 `batchTargets`。
            ⚠️ 通道就是上面那个选择器（`state.bulkChannel`）—— 与 v1 的「一键更新」
            不同，这一颗**不需要**两步确认：它的误点成本只是"再点一次"，而 `lastRun`
            会把跳过的行与原因逐条印出来（第一部分那一块）。
          */}
          {showUpdateAll && handlers !== null ? (
            <button
              type="button"
              className="cta"
              disabled={busy}
              onClick={() => void handlers.updateFolderAll(folder.folderId, state.bulkChannel)}
            >
              {t('files.folderUpdateAll', { count: targets })}
            </button>
          ) : null}
          {/*
            ★ 重扫这个文件夹（只读：不下载、不写盘；主进程那一侧还会顺带重拉目录）。
            ⚠️ 只在路径还在时画（见文件头那一段）。⚠️ 它也是「游戏版本推断不出来」
            那一档的出口：用户把实例补好之后点它，`resolveGameVersion` 就会重新读。
          */}
          {!readOnly && folder.pathExists && handlers !== null ? (
            <button
              type="button"
              className="ghostbtn"
              disabled={busy}
              onClick={() => void handlers.rescan(folder.folderId)}
            >
              {t('files.folderRescan')}
            </button>
          ) : null}
          {/*
            ★ 解绑（`unbindFolder`：删的是状态里那一格，用户磁盘上的文件一个字节都不动）。
            ⚠️ 路径不存在时**照常给**（spec §8：路径不存在时"可解绑"）——它是那一档
            唯一能做的事。
          */}
          {readOnly || handlers === null ? null : (
            <button
              type="button"
              className="ghostbtn"
              disabled={busy}
              onClick={() => void handlers.unbindFolder(folder.folderId)}
            >
              {t('files.unbind')}
            </button>
          )}
        </span>
        {/*
          ★★ 两档"这一块现在什么都不做"的解释**放在头行**（`<summary>`）里，而不是折叠
          块的身体里：头行是**永远看得见**的那一行，而这两句话正是"为什么一整列都没有
          按钮"的答案 —— 放进身体里的话，折叠着的用户（默认就是折着的）只会看到一列
          徽章与一个"自动推断"，看不到出路。
          ⚠️ 两句**互斥**：路径不存在时版本那一句没有意义（我们连里面有什么都不知道）。
        */}
        {folder.pathExists ? null : (
          <span className="folderbox__note">{t('files.folderPathMissingHint')}</span>
        )}
        {versionUnknown && folder.pathExists ? (
          <span className="folderbox__note">{t('files.folderGameVersionHint')}</span>
        ) : null}
      </summary>

      <div className="folderbox__body">
        {/*
          ★ 第三处空态：**读到过**这个文件夹、而里面一个能识别的 mod 都没有。
          ⚠️★ Ruling 65（2026-10-03 T8 评审判修）：这里的判据**必须**带上 `hasReading`
          —— `rows.length === 0` 在**扫描失败**时同样成立（`ok: false` 配空 `entries`），
          而那时说"这个文件夹里没有能识别的 mod"是**编出来的结论**（页面上会同时出现
          第一部分的"读不了这个文件夹（…）"，两句互相打脸）。
          ⚠️ 路径不存在那一档由头行那句话解释，而且**同样不许**说"里面没有"
          （我们根本没读到它）。
        */}
        {folder.pathExists && folder.hasReading && folder.rows.length === 0 ? (
          <div className="state state--empty">
            <p>{t('files.folderNoRows')}</p>
          </div>
        ) : null}
        {/*
          ★★ Ruling 65 的另一半：**没有成功的扫描读数**。⚠️ 它与上面那句是**两句不同的话**
          （"读到过、里面没有" ≠ "我们还不知道里面有什么"），而且这一档**不画行表、
          也不画"无法识别"那一栏**（那些读数根本不存在或不作数）。
        */}
        {folder.pathExists && !folder.hasReading ? (
          <div className="state state--empty">
            <p>{t('files.folderNoReading')}</p>
          </div>
        ) : null}

        {folder.rows.length === 0 ? null : (
          <div className="filetable" data-folder-rows={folder.rows.length}>
            <table className="filetable__table">
              <thead className="filetable__head">
                <tr>
                  <th>{t('files.colFile')}</th>
                  <th>{t('files.colMod')}</th>
                  <th>{t('files.colLocal')}</th>
                  <th>{t('files.colLatest')}</th>
                  <th>{t('files.colStatus')}</th>
                  <th>{t('files.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {folder.rows.map((row) => (
                  <FolderRow
                    key={row.modid}
                    state={state}
                    folder={folder}
                    row={row}
                    handlers={handlers}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/*
          ★ 扫到但**不参与更新**的那些（spec §8：单列出来、只显示）。
          ⚠️ 两类**各说各的**：读不出 `fabric.mod.json`（不是 Fabric 模组？）与
          "清单外 mod" —— 合成一句"无法识别"就把用户唯一能行动的线索删掉了。
          ⚠️★ 路径不存在时**不列**；**没有成功读数时也不列**（Ruling 65：那份 `entries`
          不作数 —— 列出来等于对着一份失败的读数说话）。两个条件都写在判据里。
        */}
        {folder.pathExists && folder.hasReading && folder.unrecognized.length > 0 ? (
          <ul className="folderbox__unrecognized">
            {folder.unrecognized.map((entry) => (
              <li key={`${entry.reason}:${entry.fileName}`}>
                {entry.reason === 'no-fabric-meta'
                  ? t('files.folderUnrecognizedNoMeta', { name: entry.fileName })
                  : t('files.folderUnrecognizedNotInCatalog', { name: entry.fileName })}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}

/** 文件夹里的一行（一个 modid）。 */
function FolderRow({
  state,
  folder,
  row,
  handlers,
}: {
  state: ModFoldersState;
  folder: ModFolderView;
  row: ModFolderRowView;
  handlers: ModFoldersHandlers | null;
}) {
  const { t } = useTranslation();
  const busy = state.busy;
  const badge = VERDICT_BADGES[row.verdict.kind];
  const hint = VERDICT_HINTS[row.verdict.kind];
  /**
   * ★★ `releaseKey` = `${modid}|${游戏版本}`（`releaseKey()` 的形状；主进程
   * `requirePairKey` 会拿它跟这个文件夹的**有效**版本对一遍）。⚠️ 用
   * `folder.gameVersion`（状态里那一版）而**不是**行自己的某个字段：行里没有版本字段，
   * 而"这个文件夹是哪个版本"正是主进程要核对的那一格。
   * ⚠️ 版本未知时它是 `${modid}|`（一个主进程必拒的形状）—— 而那时 `batchable`
   * 恒为 false ⇒ 那两颗按钮根本画不出来，这个值也发不出去。
   */
  const releaseKey = `${row.modid}|${folder.gameVersion ?? ''}`;
  /**
   * ★★ 这条 release 能用哪条镜像 —— **判据与主进程共用 `mirrorsFor` 那一份实现**
   * （`mirrorsForUrl` 只是把状态里那份镜像表喂给它）。取第一条（目录里的顺序 =
   * 配置即代码的顺序，可复现）。
   */
  const mirror =
    row.official === null ? null : (mirrorsForUrl(state.mirrors, row.official.url)[0] ?? null);
  /**
   * ★★ 进不给更新按钮的判据 = **主进程会不会收**（2026-10-04 收口波）：
   *   `older` 与 `different-build` 是 `assertUpdatable` 放行的那两支（`same` = 幂等，
   *   界面不给第二颗）；`manual` 一律不给（spec §8 的"绝不替换"）。
   *   ⚠️ 判据**不是** `row.batchable`：那只认 `older` + auto + 可排序 ⇒ `different-build`
   *   那一行会一颗按钮都没有，而 `lastRun.skipped` 正说着"要人显式点一下这一条"。
   *   ⚠️ 批量那一侧没改（`updateFolderAll` 仍只碰 `batchable`）。
   */
  const updatableKind = row.verdict.kind === 'older' || row.verdict.kind === 'different-build';
  const showUpdate = handlers !== null && !row.manual && updatableKind;

  return (
    <tr className="filetable__row" data-verdict={row.verdict.kind} data-folder-row={row.modid}>
      <td>
        <div className="filetable__filebox">
          {/* ⚠️ 文件名是磁盘上的内容，原样印（不翻译）。 */}
          <span>{row.fileName}</span>
          {/*
            ★ 旧副本提示（D9.1：更新时会清掉它们）。⚠️ 名字逐个印出来：只说
            "另有 2 份"的话，用户不知道要没的是哪几个文件。没有旧副本就一个字不印。
            ★★ 而且**后果必须说出来**（spec §4 D9.1："按钮文案写明后果"）：
            更新这一行会**删掉**这些文件，只在**新文件验签就位之后**才删。
            ⚠️ 2026-10-04 收口波之前这里只有"另有 N 份旧副本：names"——
            说的是"有这些东西"，没说"下一步会把它们删掉" ⇒ 用户点更新前不知道会少文件。
            单独一条词条（而不是并进上面那句）：这样"后果那一句还在不在"有一条能红的
            断言（`foldersrender` ⑲ 直接断言它的整句）。
          */}
          {row.oldCopies.length === 0 ? null : (
            <span className="filetable__latestknown">
              {t('files.folderOldCopies', {
                count: row.oldCopies.length,
                names: row.oldCopies.join(', '),
              })}
              {t('files.folderOldCopiesDeleted')}
            </span>
          )}
        </div>
      </td>
      <td>
        {/* ⚠️ mod 名是产品名，不翻译（与两张表里同一条）。 */}
        <span>{row.name}</span>
      </td>
      {/*
        ⚠️ 两格读数：本地那一格是扫描读数（读不出来就是 `null` ⇒ `—`），
        目标那一格是 `official.version`（没有目标 ⇒ `—`）。**不许**填 0、
        也不许拿候选的版本号顶上"官方版本"。
      */}
      <td className="filetable__version">{row.localVersion ?? DASH}</td>
      <td className="filetable__version">
        {row.official?.version ?? DASH}
        {/*
          ★ Ruling 13：来源必须标出来 —— 有上游目标时 `official` **不在** `candidates`
          里，所以用户不能靠"它是不是候选之一"去猜。⚠️ `official === null` 时一个字
          都不印（对一个不存在的目标声称来源是同一族的假话）。
        */}
        {row.official === null ? null : (
          <span className="filetable__latestknown">
            {t(
              row.targetSource === 'upstream'
                ? 'files.targetSource.upstream'
                : 'files.targetSource.catalog',
            )}
          </span>
        )}
      </td>
      <td>
        {badge === null ? null : <span className={badge.className}>{t(badge.label)}</span>}
        {/*
          ★ 各支欠的解释（spec §8）。⚠️ 文案表与第一部分**共用一份**
          （`VERDICT_HINTS`）：两处各写一份的话，"同一个 mod、同一版、两处说法不一致"
          只是时间问题（Ruling 14 的现场）。
          ⚠️ `unknown-version` 的解释在**文件夹头行**（说一次），不在这里重复。
        */}
        {hint === undefined ? null : <span>{t(hint)}</span>}
        {/*
          ★ `manual` 那一句（OptiFine 那一类）：它连更新按钮都不给（主进程
          `assertNotManual` 会拒），所以这句话就是这一行的出路说明。
        */}
        {row.manual ? <span>{t('files.hintManual')}</span> : null}
        {/*
          ★★ 多候选（`official === null` 且候选不止一条）：把**每一个**候选列出来
          （版本号 + 它自己的原网页）。⚠️ 这里**没有**"选一个"的控件，理由与第一部分
          逐字相同：契约收不了这个选择（`updateMod` 在 `official === null` 时直接拒），
          画一个点了没用的控件正是 Ruling 47/48 反对的东西。
          ⚠️ 判据是 `official === null` **且**候选非空：`missing-release`（0 条候选）
          也满足前一半，而那时没有东西可列（一个空 `<ul>` 是空壳）。
        */}
        {row.official === null && row.candidates.length > 0 ? (
          <ul>
            {row.candidates.map((candidate) => (
              <li key={candidate.url}>
                {t('files.candidate', { version: candidate.version })}
                <a
                  className="ghostbtn"
                  href={candidate.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('files.openPage')}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </td>
      <td>
        {/*
          ★★ 两颗更新按钮各送**自己那条通道**（与第一部分逐字相同）：
            · 「更新（原始）」= `'origin'`（release 自己的地址）；
            · 「更新（镜像）」= `{ mirrorId }` —— **只送 id**，地址由主进程按目录里
              那条镜像的 `prefix` 拼（`Channel` 是 id、不是 URL，spec §6.1）。
          ⚠️ 镜像那一颗只在"状态里那份镜像表里有一条认这个主机的镜像"时出现；
          没有它时用户仍有原始那一颗（D5 的降级）。
        */}
        {showUpdate && handlers !== null ? (
          <div className="filetable__actionbox">
            <button
              type="button"
              className="ghostbtn"
              disabled={busy}
              onClick={() =>
                void handlers.updateMod(folder.folderId, row.modid, releaseKey, 'origin')
              }
            >
              {t('files.updateOrigin')}
            </button>
            {mirror === null ? null : (
              <button
                type="button"
                className="ghostbtn"
                disabled={busy}
                onClick={() =>
                  void handlers.updateMod(folder.folderId, row.modid, releaseKey, {
                    mirrorId: mirror.id,
                  })
                }
              >
                {t('files.updateMirror')}
              </button>
            )}
          </div>
        ) : null}
      </td>
    </tr>
  );
}
