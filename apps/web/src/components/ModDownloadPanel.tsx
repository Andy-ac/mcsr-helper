/**
 * 「mod 下载」那一格的面板（2026-10-04，A 的 T3）—— **顶部并排区 + 按版本分组的文件夹区**。
 *
 * ===========================================================================
 * ⚠️★ 这一层是"页面的动作接缝"：它拿到的是 `onAction`，不是 `handlers`
 * ===========================================================================
 * 与 v1 / T7 那两层（直接把 `ModFoldersHandlers` 传下去）**刻意不同**：
 *   · 传到这一层下面的组件（`VersionFolderList` / `AllFoldersView`，以及 T4/T5 的
 *     `FolderJarList` / `VersionModList`）是一个**动作联合**（`ModPageAction`）
 *     ⇒ 那些组件是**纯展示**的：自检里传一个 `noop` 就能渲染，不需要造一份 handler 夹具；
 *   · 而"哪一个动作接哪条通道"只有**一处**实现：`routes/Files.tsx` 里那个
 *     `makeModPageAction(handlers)`（页面手里才有 handler）。
 * ⚠️★ 于是**失败怎么显示**也收在这一层：下面 `run()` 把 `onAction` 包在 `try` 里
 *   （`onAction` 是**页面的接缝** —— 实现换成一个会 reject 的版本时，未处理的 rejection
 *   必须在这里被接住），而**动作层**那一侧的失败走 `actionError`（`state` 里没有它，
 *   它是 `useModFolders()` 的产物 ⇒ 由页面当 prop 传进来）。
 *   两个来源**只有一个渲染点**（下面那一格 `Notice`）：`localError ?? actionError`。
 *   ⚠️ 今天 `openFolder` 的 reject 在 `makeModFoldersHandlers()` 那一层就被接住了
 *   （见 `ModFoldersData.tsx` 的 `openFolder`），所以**实际会显示的是 `actionError`**
 *   —— 那条路有断言（㉟ 把原话喂进 props，它必须出现在产物里）。
 *
 * ===========================================================================
 * ⚠️★ 第三段（「该版本所有 mod」）由 T5 接在这里
 * ===========================================================================
 * spec §4 那个图里的第三段是 `VersionModList`（T5 建）。T3 那会儿这一格**只有前两段**
 * （不是假组件：留桩会让"占位"有机会被发布），T5 把它接在文件夹区**下面**（与 spec §4
 * 那张图的顺序一致）。
 * ⚠️★ 它拿到的 `page` 与 `VersionFolderList` 是**同一份**（`planVersionPage(state, expanded)`）
 *   —— "已下载"的判定靠的就是这一份里的 `expanded`（D5），两处各算一遍就会漂。
 * ⚠️ 另外喂下去的两格（`tagLabels` / `busy`）都是**整页共用的读数**（`state.tags` /
 *   `state.busy`），不是"这一版"的投影；理由写在 `VersionModList` 的文件头。
 *
 * ===========================================================================
 * ⚠️★ 展开态与"显示全部"都住在这里（界面状态，不进持久化）
 * ===========================================================================
 * `expanded` 要喂给投影（`planVersionPage(state, expanded)`）—— "已下载"的判定靠它，
 * 而"哪几个文件夹是展开的"是用户此刻的选择（spec §5.2：**不进持久化状态**）。
 * 「显示全部已绑定的文件夹」同理：它只是一次点击的产物。
 */
import {
  type Channel,
  groupFoldersByVersion,
  type ModFoldersState,
  planVersionPage,
} from '@mcsr/shared/modFolders';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AllFoldersView } from '@/components/AllFoldersView';
import { Notice } from '@/components/Form';
import { bulkChannelUsable, gameVersionOptions, reasonOf } from '@/components/ModFoldersData';
import { VersionFolderList } from '@/components/VersionFolderList';
import { VersionModList } from '@/components/VersionModList';

/**
 * 这一页能发的**全部**动作（页面把它翻成 `ModFoldersHandlers` 上的某一条通道）。
 *
 * ⚠️★ 为什么是一个联合而不是"把 handlers 传下去"：见文件头第一段。⚠️ 加新动作时
 * **两处要一起改**（这份联合 + `routes/Files.tsx` 的 `makeModPageAction`）——
 * 而"漏了一支"由 `makeModPageAction` 那个 `default` 里的 `const never: never = action`
 * 在**编译期**抓住（⚠️ 实测：**不是** `switch` 自己 —— 这个 tsconfig 没开
 * `noImplicitReturns`，非穷尽的 `switch` 编译通过、退出 0；T3 判修轮把那一句补上了）。
 * ⚠️ `channel` 与契约里的 `Channel` 是**同一个类型**（不是字符串字面量的复制）：
 * 通道是 id 或 `'origin'`，地址由主进程拼（spec §6.1）。
 */
export type ModPageAction =
  | { kind: 'open-folder'; folderId: string }
  /*
   * ★★ G2（最终修复波 / spec D3）：添加文件夹时**带上当时看着的那一版**。
   *
   * ⚠️★ 修之前这个成员**不带任何东西**，而 `bindFolder()` 也没有入参 ⇒ 主进程只能
   *    "自己推断"（`.minecraft` / `mmc-pack.json`），推不出来的那些路径得到的是
   *    `gameVersion: null`（每一行都是 `unknown-version`）⇒ 用户"在 1.16.1 下面加了一个
   *    1.16.1 的文件夹"，它却出现在**版本未知**那一组里。spec D3 明写的是"在版本 X 下点
   *    「添加文件夹」⇒ 选完目录后把该文件夹的版本**预置**为 X（仍可改）"。
   * ⚠️ `version` 就是 `page.version`（= `state.gameVersion`），不是组件自己算的第二个版本。
   *    ⚠️ `null` 仍然允许，含义是"交回自动推断"（契约里那两格与 `setFolderGameVersion`
   *    同一条语义）—— 今天没有任何调用点发它（页面总是知道自己在看哪一版）。
   */
  | { kind: 'bind-folder'; version: string | null }
  | { kind: 'rescan-folder'; folderId: string }
  | { kind: 'unbind-folder'; folderId: string }
  | { kind: 'set-folder-version'; folderId: string; version: string | null }
  | { kind: 'set-folder-auto-update'; folderId: string; on: boolean }
  | { kind: 'set-bulk-channel'; channel: Channel }
  | { kind: 'update-folder-all'; folderId: string; channel: Channel }
  /*
   * ★ Task 4（A 的第四片）：展开体里**一行**的更新（那两颗按钮）。
   * ⚠️★ `releaseKey` **不是**显示用的东西：它是 `${modid}|${游戏版本}`（`releaseKey()` 的
   *    形状），主进程拿它跟这个文件夹的**有效**版本对一遍（`requirePairKey`）。
   *    ⇒ 它由渲染行按 `folder.gameVersion` 拼好、原样送过去，页面**不重新拼**第二遍。
   * ⚠️ 通道是 `Channel`（id 或 `'origin'`），与上面那条批量的是同一个类型 —— 地址由主进程拼。
   */
  | {
      kind: 'update-mod';
      folderId: string;
      modid: string;
      releaseKey: string;
      channel: Channel;
    }
  /*
   * ★ Task 5（A 的第五片）：第三段那一行的**下载**（`downloadMissing` —— T8 就有的那条通道）。
   *
   * ⚠️★ 为什么 `kind` 是**新的**、不复用 `'update-mod'`：两者是**两条不同的写盘路径**
   *    （`updateMod` 要求"这个文件夹里已经有它"，`downloadMissing` 要求"它**不在**这个
   *    文件夹里"），闸也不同（`assertUpdatable` vs `assertNotManual` + 目录里唯一候选）。
   *    ⚠️ 而且自检㊲ 有一条"`kind: 'update-mod'` 在 `FolderJarList.tsx` 里只许出现两次"的
   *    计数守卫 —— 复用那个 kind 会让那一条**当场变红**（而它正是"只有一处写盘路径"的读数）。
   * ⚠️ 入参与契约逐格对应：`gameVersion` 就是这一版的版本号（主进程拿它跟**目标文件夹的
   *    有效版本**对一遍 —— 那一条是 `downloadMissing` 里最贵的一格：不一致会往一个别的
   *    游戏版本的目录里装 jar，而它在目录里看起来完全正常）。
   * ⚠️ 通道是 `Channel`（id 或 `'origin'`）；这一段只发 `'origin'`（理由与代价写在
   *    `VersionModList` 的文件头）。
   */
  | {
      kind: 'download-mod';
      modid: string;
      gameVersion: string;
      folderId: string;
      channel: Channel;
    }
  | { kind: 'set-catalog-version'; version: string };

/**
 * 动作层往下传的形状。
 * ⚠️ 返回值是 `void | Promise<void>`：产品里 `Files` 给的是一个 `async` 函数
 * （`await` 每一条通道），而自检里给的是 `noop`（同步、什么都不做）。
 */
export type ModPageActionHandler = (action: ModPageAction) => void | Promise<void>;

export interface ModDownloadPanelProps {
  /** 整页那份读数（这一层只读、不取数）。 */
  state: ModFoldersState;
  /** 动作层（只允许经过 `makeModPageAction` 那一处接线）。 */
  onAction: ModPageActionHandler;
  /**
   * 动作层那一边的失败原话（`useModFolders().actionError`；`null` = 没失败过）。
   * ⚠️ 它是**可选**的，只是为了自检里那条"不传就没有提示"的对照能编译。
   */
  actionError?: string | null;
}

export function ModDownloadPanel({ state, onAction, actionError = null }: ModDownloadPanelProps) {
  const { t } = useTranslation();
  /** 展开态（文件夹 id）—— 界面状态，喂给投影、不进持久化（spec §5.2）。 */
  const [expanded, setExpanded] = useState<readonly string[]>([]);
  /** 「显示全部已绑定的文件夹」是否摊开。 */
  const [showAll, setShowAll] = useState(false);
  /** 上面 `run()` 接住的那句原话（与 `actionError` 共用一个渲染点）。 */
  const [localError, setLocalError] = useState<string | null>(null);

  /*
   * ★★ 投影**只有一处**：这一版要画什么全由 `planVersionPage()` 算好（T1），
   *    这一层与下面的组件都不再判断"哪个文件夹属于这一版 / 哪个 mod 已下载"。
   */
  const page = planVersionPage(state, expanded);
  const notice = localError ?? actionError;

  /**
   * 动作层的包装。⚠️ `setLocalError(null)` 在开跑之前：上一次那句说的是上一次那个动作
   * （与 `makeModFoldersHandlers()` 里那句 `fail(null)` 同一条理由）。
   */
  const run = async (action: ModPageAction): Promise<void> => {
    setLocalError(null);
    try {
      await onAction(action);
    } catch (error) {
      setLocalError(reasonOf(error));
    }
  };

  const toggle = (folderId: string): void => {
    setExpanded((prev) =>
      prev.includes(folderId) ? prev.filter((id) => id !== folderId) : [...prev, folderId],
    );
  };

  return (
    <section className="moddownload" data-version={page.version}>
      {/*
        ★★ 一次动作失败的原话（**整页**一格，不是每个文件夹重复一遍）。
        ⚠️ 走 `<Notice kind="bad">`（`role="alert"`）：它说的是"刚才那一下没成"，
        而且它用的就是那一条词条（`files.actionFailed` —— 旧第一部分那一格也用它，
        那个面板在 T6 删了）；同一个东西不该有两个说法。
      */}
      {notice === null ? null : (
        <Notice kind="bad">{t('files.actionFailed', { message: notice })}</Notice>
      )}
      {/*
        ⚠️ `notices` **原样印出来**（迁移提示"已转为文件夹跟踪：…"、缺失清单被压住的说明、
        目录错误）：它们由主进程写好，这一层不重新措辞（§13.1 要求迁移提示看得见，
        而它原来的渲染点在第一部分 —— 那一块在 T3 从页面上消失、T6 连组件一起删了
        ⇒ 渲染点搬到这里）。代价同一条（旧第一部分那一格也是）：那句话是**中文**写死的（已接受）。
      */}
      {state.notices.map((note) => (
        <Notice kind="info" key={note}>
          {note}
        </Notice>
      ))}

      {/*
        ★★ 过期批量通道那句解释（**判修 1 补**，`files.channelStaleHint`）。
        ⚠️★ 为什么它必须在这一层（而且只说一次）：状态里那条通道已经不成立时，
        `canUpdateFolderAll()` 会让**每一行**的「全部更新」都不画（那是对的 ——
        `requireChannel` 对"目录里没有这条镜像"会抛）⇒ 用户看到的是"按钮怎么没了"。
        那句话就是唯一的答案，而它是**全局**的（`prefs.bulkChannel` 一份）：
        每个文件夹重复一遍是噪声（Ruling 64 的原话）。
        ⚠️ 它原来的渲染点在旧第二部分（`ModFoldersPanel`）里；那个组件在 T6 连文件一起删了
        ⇒ 这里是它**唯一**的渲染点（判修轮先把它补到这里，T6 之后它成了唯一一处；
        不重写判断，只补渲染点）。
      */}
      {bulkChannelUsable(state) ? null : <Notice kind="bad">{t('files.channelStaleHint')}</Notice>}

      {/*
        ★★ 顶部并排区（spec §4）：版本下拉 + 「显示全部已绑定的文件夹」。
        ⚠️ 版本下拉**受控于状态**（主进程 `prefs`，Ruling 23）：这里没有第二份记忆。
        ⚠️ 选项表用 `gameVersionOptions(state)`（与文件夹那一行的版本下拉**同一个函数**）：
        目录换过之后当前那一版可能已经不在目录里，而 `<select value=X>` 里没有 X 时
        浏览器会**静默选中第一个** —— 那一屏就在撒谎。
        ⚠️ B（热门整合包）会往这一区再加一格，那时候**只加孩子**，不动这两个。
      */}
      <div className="moddownload__toprow">
        <label className="folderrow__field">
          {t('files.catalogGameVersion')}
          <select
            className="filters__select"
            value={state.gameVersion}
            disabled={state.busy}
            onChange={(event) =>
              void run({ kind: 'set-catalog-version', version: event.target.value })
            }
          >
            {gameVersionOptions(state).map((version) => (
              <option key={version} value={version}>
                {version}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="ghostbtn"
          data-action="toggle-all-folders"
          /* ⚠️ 它是"这一栏摊开了没有"的读数（与展开标识同一条纪律：值要说得出当前态）。 */
          aria-expanded={showAll}
          onClick={() => setShowAll((prev) => !prev)}
        >
          {t('files.allBoundFolders')}
        </button>
      </div>

      {/*
        ★★ 跨版本那一栏（spec §9.11）在**版本区上方**（计划里的字面）：点开时它先出现，
        下面才是"这一版"的文件夹与（T5 的）mod 列表。
      */}
      {showAll ? <AllFoldersView groups={groupFoldersByVersion(state)} onAction={run} /> : null}

      <VersionFolderList
        state={state}
        page={page}
        expanded={expanded}
        onToggle={toggle}
        onAction={run}
      />

      {/*
        ★★ 第三段（spec §4）：该版本目录里的**全部** mod（不是旧页面那栏"缺失的"）。
        ⚠️ 顺序是 spec §4 那张图：文件夹区在下、第三段在最下。
        ⚠️ 三格都从**这一层**喂（`page` 与上面那份**同一份**；`tagLabels` / `busy` 是整页
        共用的读数）—— 自检㊴ 的三条打在**这一处的产物**上（T4 判修轮的教训：
        自检自己喂的 prop 证明不了页面真的喂了它）。
      */}
      <VersionModList page={page} tagLabels={state.tags} busy={state.busy} onAction={run} />
    </section>
  );
}
