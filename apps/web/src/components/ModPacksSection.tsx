/**
 * ★ B2 / Task 6：「整合包」那一节 + 顶部并排区里的**热门 ★ 小卡**。
 *
 * ===========================================================================
 * ⚠️★ 产出物是 T8 的判据，**一字不改**（spec §5 的断言 14–16 逐字断这五个钩子）
 * ===========================================================================
 *   · 小卡：`data-pack-chip="{id}"` + `aria-pressed="true|false"`；
 *   · 行：`data-pack-row="{id}"` + `data-pack-selected="yes|no"` +
 *     `data-pack-download="{id}"`（按钮）+ `data-pack-folder="{id}"`（下拉）；
 *   · 空态：`data-pack-empty="yes"`。
 * ⚠️★ 于是"这一节怎么排版"可以改，"这五个钩子叫什么"不行 —— 改它们等于把 T8 的判据
 *    变成一条恒真的断言（它找不到那五个属性时会**当场红**，而不是静默通过）。
 *
 * ===========================================================================
 * ⚠️★ 纯展示：取数由 `ModDownloadPanel` 做（`useReview`），这一层只渲染
 * ===========================================================================
 * 与 `VersionFolderList` / `VersionModList` 同一条理由：`renderToStaticMarkup`
 * **不跑 effect** ⇒ 取数写在这里的话，`scripts/modtagsrender.tsx`（T8）渲染到的
 * 永远是"加载中"那一屏，它那三组断言会**全部变成空跑**（本仓 §5.32 的第 ④ 类）。
 * ⇒ 于是 `packs` / `catalogIndex` 是 **props**：产品里由面板喂真数据，自检里喂夹具。
 *
 * ===========================================================================
 * ⚠️★ "可下 N 项"用的是 T1 的 `packDownloadableIn`（**与主进程同一个函数**）
 * ===========================================================================
 * spec D12：页面与主进程读**同一个**纯判断 ⇒ "页面看到的数"与"主进程会下的项数"
 * 不可能分叉。⚠️ 别在这里另写一份谓词（哪怕只是 `modids.length`）：
 * 那正是 T1 的断言 ⑥ 在验的事，而分叉的表现是"按钮说不缺、点下去主进程说没有可下的项"。
 * ⚠️ 代价（认，spec §15）：`ModIndex` 在网页这一侧要**自己建**（`buildIndex(catalog)`）——
 *    桌面端的 `catalogIndexOf()` 是**主进程**的函数，网页里没有它。
 *
 * ===========================================================================
 * ⚠️★ 「下载到哪」的候选与第三段**同一套判据**，但来源不同（各一处）
 * ===========================================================================
 * 第三段那一格（`VersionModRow.downloadTargets`）是**逐行**的：它把"已经有这个 modid"
 * 的文件夹排掉了。而整包这一格的候选是**包级**的（"这一版里哪些文件夹能装东西"）：
 * 包里的项是一个集合，判"这个文件夹已经有它了"是 `packDownloadableIn` 的事
 * （`already-in-folder` 那条跳过原因）⇒ 这里不能拿某一行的 `downloadTargets` 顶替。
 * 判据取自**投影**（`VersionPage.folders`，`planVersionPage()` 只画 `state.gameVersion`
 * 那一版）：`pathExists && hasReading` —— 与 `planVersionPage` 里那条
 * `folder.pathExists && folder.hasReading` 逐字同一条（也是主进程 `downloadPack` 的两道前置闸）。
 *
 * ===========================================================================
 * ⚠️★ 小卡的动作是"**选中 + 滚到那一行**"（用户 2026-10-07 选的口径）
 * ===========================================================================
 * 只滚不选中是**恒真**的那一类（"点了有反应"看起来总是成立）⇒ 自检 ⑮ 断的是
 * `aria-pressed` 与那一行的 `data-pack-selected` **一起**变。
 * ⚠️ 小卡渲染在**顶部并排区里**（`moddownload__toprow`，那个 div 的既有结构与类名
 *    一个字节都不动：只加孩子）⇒ 它由面板调这个组件时带 `chipsOnly` 渲染一次。
 */
import type { ModIndex } from '@mcsr/shared/modCatalog';
import type { VersionFolderBlock } from '@mcsr/shared/modFolders';
import { packDownloadableIn } from '@mcsr/shared/modPacks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadProgressLine } from '@/components/DownloadProgressLine';
import type { ModPageActionHandler } from '@/components/ModDownloadPanel';
import type { PageProgress } from '@/components/ModFoldersData';
import type { ModPackWire } from '@/lib/api';

export interface ModPacksSectionProps {
  /** 这个版本的整合包（空数组 = **真的没有**，不是"还没加载" —— 后者由面板不渲染这一节表达）。 */
  packs: readonly ModPackWire[];
  /** ★ 网页侧自己建的目录索引（`buildIndex(catalog)`，面板只建一次）—— `packDownloadableIn` 的第二格。 */
  catalogIndex: ModIndex;
  /** 这一版的文件夹块（`VersionPage.folders`）：目标下拉的候选从它里面筛。 */
  folders: readonly VersionFolderBlock[];
  /**
   * ★ 面板**当前选中**的那一条包（`selectedPackId`）与它的 setter。
   * ⚠️ 它是**受控**的（不是这一层自己的 state）：小卡住在另一个渲染点
   * （顶部并排区），两处必须看同一个值 —— 各自存一份就是"点了小卡、行没变"。
   */
  selectedPackId: string | null;
  onSelectPack: (packId: string) => void;
  onAction: ModPageActionHandler;
  /** ★ C 的 T5：整页那份进度载荷（`progressOf(state, live)` 的产物）。 */
  progress: PageProgress | null;
  /** 正在写盘（`state.busy`）⇒ 下载按钮按住（主进程 `assertNotBusy()` 必拒）。 */
  busy: boolean;
  /**
   * ★ 只画那排小卡（顶部并排区用）。
   *
   * ⚠️★ 为什么是**一个组件两个渲染点**、不是两个组件：小卡的点击必须写
   * `selectedPackId`，而"选中"的读数是**那一行**的 `data-pack-selected` ——
   * 两者是同一份状态的两面（自检 ⑮ 断的正是"一起变"）。拆成两个组件的话，
   * 那个"选中"要么变成两份 state，要么要往上再提一层 —— 两条都比这行 if 贵。
   * ⚠️ 它也保证了小卡与行读的是**同一份** `packs`（一次取数、一处顺序）。
   */
  chipsOnly?: boolean;
}

export function ModPacksSection({
  packs,
  catalogIndex,
  folders,
  selectedPackId,
  onSelectPack,
  onAction,
  progress,
  busy,
  chipsOnly = false,
}: ModPacksSectionProps) {
  const { t } = useTranslation();

  /*
   * ★ 热门小卡：**按状态里的顺序原样画**。
   * ⚠️★ 服务端已经按 `created_at` 升序排过（`listModPacks` 的 `ORDER BY created_at, rowid`）
   *    ⇒ 页面**不许**再排一遍：第二遍排序就是第二份真相，而它与服务端的差别会在
   *    "同一毫秒建的两个包"上露出来（那时只有服务端知道该谁在前）。
   */
  if (chipsOnly) {
    return (
      <>
        {packs
          .filter((pack) => pack.hot)
          .map((pack) => (
            <button
              key={pack.id}
              type="button"
              className="ghostbtn"
              data-pack-chip={pack.id}
              /*
               * ⚠️★ `aria-pressed` 是**这一格的读数**（不是装饰）：自检 ⑮ 拿它与那一行的
               * `data-pack-selected` 对读 —— "点了小卡，那一行真的被选中了"。
               */
              aria-pressed={selectedPackId === pack.id ? 'true' : 'false'}
              onClick={() => {
                onSelectPack(pack.id);
                /*
                 * ⚠️★ "滚到那一行"：`document.querySelector` 现查（不是 ref 表）——
                 * 行的渲染是**条件**的（这一节在有包时才有），给每一行挂 ref 就多一份
                 * "哪一行在不在"的记忆。`?.` 是必须的：纯浏览器那一档/还没渲染完的那一刻
                 * 查不到，而"点了没反应"不该升级成一次崩溃。
                 */
                document
                  .querySelector(`[data-pack-row="${pack.id}"]`)
                  ?.scrollIntoView({ block: 'center' });
              }}
            >
              {/*
                ⚠️ 星号由**词条**决定（`files.packsChip` = `★ {{title}}`），不写死在这里：
                那一颗记号是"这一条包是热门"的说法，两种语言各自决定怎么标它。
              */}
              {t('files.packsChip', { title: pack.title })}
            </button>
          ))}
      </>
    );
  }

  /*
   * ⚠️★ 空态**必须说得出**"这个版本还没有整合包"（spec D8）：空数组与"还没加载"
   *    在这一层是同一种形状 ⇒ 后者由面板**不渲染这一节**表达，到这里就只剩"真的没有"。
   */
  if (packs.length === 0) {
    return (
      <p className="state" data-pack-empty="yes">
        {t('files.packsEmpty')}
      </p>
    );
  }

  /*
   * ★ 目标下拉的候选：**这一版里路径在、而且扫过一次**的文件夹。
   * ⚠️ 判据与 `planVersionPage` 里那条逐字相同（也是主进程 `downloadPack` 的两道前置闸）；
   *    顺序继承 `page.folders`（用户的绑定顺序）——再排一遍是第二份真相。
   */
  const candidates = folders.filter((block) => block.folder.pathExists && block.folder.hasReading);

  return (
    <section className="moddownload__packs">
      <h3>{t('files.packsTitle', { count: packs.length })}</h3>
      {packs.map((pack) => (
        <PackRow
          key={pack.id}
          pack={pack}
          candidates={candidates}
          catalogIndex={catalogIndex}
          selected={selectedPackId === pack.id}
          onAction={onAction}
          progress={progress}
          busy={busy}
        />
      ))}
    </section>
  );
}

/** 一条整合包那一行。 */
function PackRow({
  pack,
  candidates,
  catalogIndex,
  selected,
  onAction,
  progress,
  busy,
}: {
  pack: ModPackWire;
  candidates: readonly VersionFolderBlock[];
  catalogIndex: ModIndex;
  selected: boolean;
  onAction: ModPageActionHandler;
  progress: PageProgress | null;
  busy: boolean;
}) {
  const { t } = useTranslation();
  /**
   * ★★ 用户为**这一条包**选中的目标文件夹（界面态，不是第二份真相）。
   *
   * ⚠️★ 与 `VersionModItem` 那一格逐字同一条纪律：`candidates` 会随后台的推送变化
   *    （用户解绑了一个文件夹）⇒ 存在 `chosen` 里的 id 可能已经不在选项里，而
   *    `<select value=X>` 里没有 X 时浏览器会**静默选中第一个** —— 那一屏就在撒谎
   *    （界面显示 A、实际发给主进程的是 B）。⇒ 每一次渲染都按当前的 `candidates` 现算。
   * ⚠️ 初值 = 第一个候选（用户不选也能点）——与第三段那条一致。
   */
  const [chosen, setChosen] = useState(candidates[0]?.folder.folderId ?? '');
  const available = candidates.map((block) => block.folder.folderId);
  const target = available.includes(chosen) ? chosen : (available[0] ?? '');
  /** 目标那一个文件夹**已经认出来的** modid（`already-in-folder` 那条跳过原因的输入）。 */
  const recognized =
    candidates.find((block) => block.folder.folderId === target)?.recognizedModids ?? [];

  /*
   * ★★ 这一包**真的会下几项** —— `packDownloadableIn`（T1），**与主进程同一个函数**。
   * ⚠️ 判据（跳过原因）在 `packPlanFor` 里各有各的说法：`already-in-folder` /
   *    `not-in-catalog` / `no-release` / `ambiguous` / `manual`。这一格只读**条数**。
   */
  const downloadable = packDownloadableIn({
    modids: pack.modids,
    gameVersion: pack.gameVersion,
    folder: { recognizedModids: recognized },
    index: catalogIndex,
  });
  /**
   * ★★ 按钮的可用态：有可下的项 + 有目标 + 不在写盘。
   *
   * ⚠️★ 三格缺一不可，而它们**各自**都对应主进程的一道拒（会拒的一律不放开）：
   *      · `downloadable === 0` ⇒ 这一趟一项都不会开工（"点了什么都没发生"）；
   *      · `target === ''`（没有候选文件夹）⇒ 主进程 `requireFolder` 先拒；
   *      · `busy` ⇒ `assertNotBusy()` 拒。
   *    ⚠️ 自检 ⑯ 的刀就是把 `downloadable === 0` 这一格去掉（"没候选仍可点"必须红）。
   */
  const disabled = downloadable === 0 || target === '' || busy;
  /**
   * ★ C 的 T5：**这一条包就是正在下的那一趟吗**（是 ⇒ 那份载荷，否则 `null`）。
   * ⚠️ 判据是**两格**（与 `FolderJarList` / `VersionModList` 逐条同一个写法）：
   *    `run` 说"这是整包那一趟"、`folderId` 说"下到哪个文件夹"——
   *    只比 `folderId` 的话，"往同一个文件夹下某一个 mod"那一趟也会命中这一行。
   * ⚠️ `frame.modid` 在一趟整包下载里是**当前那一项**（主进程 `setRunItem` 盖的），
   *    所以这里**不能**拿它比 `pack.id`。
   */
  const line =
    progress !== null &&
    progress.frame.run === 'download-pack' &&
    progress.frame.folderId === target
      ? progress
      : null;

  return (
    <div
      data-pack-row={pack.id}
      /* ⚠️ 机器读数：自检 ⑮ 拿它与小卡的 `aria-pressed` 对读（"一起变"）。 */
      data-pack-selected={selected ? 'yes' : 'no'}
      /*
       * ⚠️★ 这一行**没有** `onClick`（而 `role="group"` 也不行：`biome` 的
       *    `a11y/useSemanticElements` 会要求把它换成 `<fieldset>`）。
       *    理由：这一行是一块**容器**（里面那个 `<select>` 与那颗按钮才是控件），
       *    给它挂 `onClick` 会让"静态元素不许可交互"+"鼠标事件必须有键盘对应"两条一起红，
       *    而补 `role="button"` + 键盘处理是**假**的可访问性 —— 它不是一个按钮。
       *    ⇒ 选中那件事由顶部那颗**真的** `<button>`（小卡）负责；这一行只**读**
       *    `data-pack-selected`（自检 ⑮ 断的就是那颗按钮与这一格一起变）。
       */
    >
      <span>
        {/* ⚠️ 星号是**这一条包是热门**的读数（与顶部那颗小卡同一条事实，不是装饰）。 */}
        {pack.hot ? '★ ' : ''}
        {pack.title}
      </span>
      <span>{pack.description}</span>
      {/* ⚠️ 条数取服务端算好的那一格（页面不自己数 `modids.length`，见 `ModPackWire`）。 */}
      <span>{t('files.packsModCount', { count: pack.modCount })}</span>
      {line === null ? null : (
        /*
         * ★★ C 的进度行**原样复用**（`variant` 走默认的 `'inline'`）——一行都不新写：
         *    "能不能取消 / 写盘相位 / 样本不足怎么显示"三件事全在 `progressLineOf` 里。
         * ⚠️ 取消走**既有的** `cancel-download` 动作（C 的通道），不为整包加第二条。
         */
        <DownloadProgressLine
          progress={line}
          onCancel={() => void onAction({ kind: 'cancel-download' })}
        />
      )}
      <select
        className="filters__select"
        data-pack-folder={pack.id}
        aria-label={t('files.packsFolderLabel', { title: pack.title })}
        value={target}
        disabled={busy || available.length === 0}
        /*
         * ⚠️ `stopPropagation`：这个下拉在那一行**里面**，而那一行自己也 `onSelect`
         *    （见上面那段）—— 不拦住的话"给这一条选个文件夹"会顺带把它选中一遍
         *    （用户点了 B 那条的下拉，A 那条被选中）。
         */
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => setChosen(event.target.value)}
      >
        {candidates.map((block) => (
          <option key={block.folder.folderId} value={block.folder.folderId}>
            {/* ⚠️ 选项文字是**路径**（id 对用户没有意义），值仍是 id（主进程收的就是 id）。 */}
            {block.folder.path}
          </option>
        ))}
      </select>
      <button
        type="button"
        data-pack-download={pack.id}
        disabled={disabled}
        onClick={() => {
          /*
           * ⚠️ 没有目标时**什么都不发**：`target === ''` 那一档按钮已经禁用了，
           *    这一句是给"禁用属性被别的东西绕过"留的兜底（发一条空 folderId 过去
           *    只会换回主进程一句 `requireFolder` 的拒）。
           */
          if (target === '') return;
          void onAction({
            kind: 'download-pack',
            packId: pack.id,
            gameVersion: pack.gameVersion,
            folderId: target,
          });
        }}
      >
        {t('files.packsDownload')}
      </button>
      {downloadable === 0 ? (
        /* ⚠️ 一颗禁用的按钮**必须说得出为什么**（会拒的一律不放开，同时给一句解释）。 */
        <span className="filetable__err">{t('files.packsNothingToDo')}</span>
      ) : null}
      {available.length === 0 ? (
        /*
         * ⚠️ 这一支与上面那句是**两件事**：这里说的是"一个能装的文件夹都没有"
         *    （出路 = 先绑一个），上面说的是"有文件夹，但这一包的项都已经在它里面了"。
         *    Ruling 65 的同一条纪律：分不清"不知道"与"没有"的读数不许当结论用。
         */
        <span className="filetable__err">{t('files.packsNoFolder')}</span>
      ) : null}
    </div>
  );
}
