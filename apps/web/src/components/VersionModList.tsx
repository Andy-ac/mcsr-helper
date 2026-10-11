/**
 * 第三段「该版本所有 mod」（2026-10-04，A 的 T5）。
 *
 * ===========================================================================
 * ⚠️★ 纯展示：判断一格都不在这里（spec §5.1）
 * ===========================================================================
 * 喂一份投影（`VersionPage`）就同步渲染完：不取数、不订阅、不跑 effect
 * （与 `VersionFolderList` / `FolderJarList` / `ModDownloadPanel` 同一条，理由在
 * `renderToStaticMarkup` 不跑 effect 那一段）。
 * 这一层读的全是**别人算好的**读数：
 *   · `downloadedIn`（哪些**已展开**的文件夹里有它 ⇒ 空就显示下载按钮，D5）；
 *   · `presentIn`（**不论展开与否**，哪里有它 —— B2：没有合法目标时那句出路靠它分两支）；
 *   · `downloadTargets`（该版本里**能把这一行装进去**的文件夹 id，D6 + B2：
 *     投影已经把"已经有它"的那些排掉了，因为主进程 `downloadMissing` 对那种目标是
 *     **无条件拒**的）；
 *   · `releaseVersion` / `releaseUrl` / `homepage` / `manual` / `verdict`。
 * ⚠️★ 这一层**不许**调 `planVersionPage`、也不许自己 `filter` 一遍文件夹
 *    （自检㊴ 有一条源码形状守卫钉着这件事：`downloadedIn` 的判据**只许**读投影那一格）。
 *
 * ===========================================================================
 * ⚠️★ 这一段**没有「操作」列**（用户明确要求）
 * ===========================================================================
 * spec §4 的草图里这一段**没有表头**，而且写着"行内不放'操作'列（用户明确要求取消），
 * 操作用按钮直接落在行内"。⇒ 最后一格是**这一行能不能下 / 下没下**那一格（表头用既有的
 * `files.missingDownloadTo`：它就是"下载到"那一格，与底部旧清单同一个意思），
 * **不是** `files.colActions`。自检㊳ 有一条"`files.colActions` 不许出现在这一段里"的
 * 机器读数（刀：把那一列表头加回来 ⇒ 红）。
 *
 * ===========================================================================
 * ⚠️★ 三格 prop，以及为什么它们**必须**从页面喂下来
 * ===========================================================================
 * 计划里写的形状是 `<VersionModList page={…} onAction={…} />`；实现时多了两格，
 * 各有各的理由（都不是"页面能自己算"的东西）：
 *   · `tagLabels`（`state.tags`）：`VersionModRow` 只带标签的 **key**（`tags: string[]`），
 *     而显示名两种语言都在状态里（`TagOptionView.labels`）⇒ 不喂下来，中文界面上会印
 *     `legal` / `ranked` 这种 key（旧底部清单与第一部分当年也是这么拿的 —— 那两处随 T6
 *     删了；判据只有一处：`tagLabelFor`，今天住在 `components/ModFoldersData.tsx`。
 *     T5 把它导出并收窄成"收标签全集"，免得这里成为第三份抄写）。
 *   · `busy`（`state.busy`）：`downloadMissing` 第一句就是 `assertNotBusy()`
 *     ⇒ 写盘期间那颗按钮点下去**必吃一句红字**（Ruling 47/48：会拒的一律不画/不放开）。
 *     这一页其余每一颗控件都是 `disabled={busy}`，这一段不是例外。
 * ⚠️★ 三格都**不是可选的**（没有默认值）：T4 判修轮的教训是"页面把 prop 喂空了而门禁全绿"
 *    —— 可选 prop 会让"忘了喂"变成静默降级。⇒ 自检㊴ 的三条打在**面板产物**上。
 *
 * ===========================================================================
 * ⚠️★ `manual` 与"没有目标"那两行**一颗下载都不给**（Ruling 47/48）
 * ===========================================================================
 * 主进程 `downloadMissing` 现读下来有两道"整条拒"的闸（`apps/desktop/src/mod-folders.ts`）：
 *   · `assertNotManual(row.manual, what, '下载')` —— `manual`（OptiFine 那一类，实测 54 条）
 *     **只许手动下载**；
 *   · `row.candidates.length !== 1` / `official === null` —— `ambiguous` 与
 *     `missing-release` 那两档**没有"该装哪一个"的答案**（spec §8：ambiguous 要人明确选一个）。
 * ⇒ 给它们画下载按钮，就是画一颗**注定被拒**的按钮（T8 那次 Critical 正是这件事：
 * 旧底部清单的 `manual` 行只给"打开原网页"）。那两行画的是**解释**：
 * `manual` 走 `files.hintManual`，其余走共享的 `VERDICT_HINTS`（不在这里另写一张表）。
 * ⚠️★ 判据**不是** `isUpdatableRow()`（那是展开体里"给不给更新按钮"那条 allow-list）：这里读的是投影里
 *    **为下载准备**的两格（`releaseUrl` / `manual`）⇒ 它不是第四份 allow-list。
 *
 * ===========================================================================
 * ⚠️★ 通道固定 `'origin'`（代价记在这里）
 * ===========================================================================
 * `downloadMissing(modid, gameVersion, folderId, channel)` 要一条通道，而
 * `VersionModRow` **不带**镜像信息（投影里没有 `mirrors`）⇒ 这一段发出去的是
 * **永远成立**的那一条（release 自己的地址）。代价（认）：旧底部清单那一栏有
 * "下载（镜像）"第二颗按钮（Ruling 62②），这一段**没有** —— 要补上就得再喂 `mirrors`
 * 并为第二颗按钮写它自己的断言（"两颗各送自己那条通道"），那是另一片的事。
 * ⚠️ 也因此**不许**把 `state.bulkChannel` 读进来当默认（那个选择器的作用域是
 * "全部更新"，两处各有一条判据；混起来的症状是"界面显示 origin、实际按镜像下载"）。
 */
import type { ModFoldersState, VersionModRow, VersionPage } from '@mcsr/shared/modFolders';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadProgressLine } from '@/components/DownloadProgressLine';
import { Notice } from '@/components/Form';
import type { ModPageActionHandler } from '@/components/ModDownloadPanel';
import { type PageProgress, tagLabelFor, VERDICT_HINTS } from '@/components/ModFoldersData';

/** 「没有值的那一格」——与 jar 列表（`FolderJarList`）里那个 `DASH` 是同一个字符。 */
const DASH = '—';

export interface VersionModListProps {
  /** 这一版的一页（`planVersionPage()` 的产物）—— 第三段只渲染它。 */
  page: VersionPage;
  /**
   * 状态里那一格**标签全集**（`state.tags`；两种语言的显示名都在）。
   * ⚠️ 见文件头：`VersionModRow.tags` 只有 key，显示名只能从这一格取。
   */
  tagLabels: ModFoldersState['tags'];
  /** 正在写盘（`state.busy`）⇒ 下载按钮与目标下拉一起按住（`assertNotBusy()`）。 */
  busy: boolean;
  /** 动作层（只有 `ModDownloadPanel.run()` 那一处接线）。 */
  onAction: ModPageActionHandler;
  /**
   * ★ C 的 T5：整页那份进度载荷（`progressOf(state, live)` 的产物）。
   *
   * ⚠️★ 这一层按 `modid` + `folderId` 认领（见 `VersionModItem`）：第三段的每一行是
   *    **目录行**，它可能与某个文件夹里正在下载的那一项**同名**，所以不能只比 `modid`。
   *    ⚠️ 而"下到哪个文件夹"这一刻由用户在下拉里选（`VersionModItem` 的界面态）——
   *    这是**有意的**：进度行说的是"这一行此刻正在下它"，而用户看到的正是这一行。
   */
  progress: PageProgress | null;
  /**
   * ★★ D1（T7）：**只读**（A3 / spec §4.3）—— `true` ⇒ 这一栏**一个下载入口都不画**。
   *
   * ⚠️★ 默认 `false` = 今天的行为（**一个含义**：不传就是可下载那一档）—— 与
   *    `ModPacksSectionProps.readOnly` 同一条口径。
   * ⚠️ 为什么"只读"不是"不画这一段"：spec §4.3 要的是"选了版本 ⇒ 该版本的 mod 清单
   *    **立刻可见**，但**只能看**" ⇒ 清单 / 目标版本 / 主页链接三样照旧，去掉的是
   *    **那一格动作**（下载按钮 / 目标选择器 / 那两句"为什么不能下"）。
   *    ⚠️ 那两句说明也一起去掉：它们在只读那一层说的是"点了会怎样"，而那一层**没有**可点
   *    的东西（留着它们等于给一个不存在的动作写解释）。
   */
  readOnly?: boolean;
}

/**
 * 第三段本体：标题 + （目录可用时）一张表。
 *
 * 三种"不列表"的情形**各说各的**（spec §8）：
 *   · 目录不可用 ⇒ 既有那条文案（`files.catalogUnavailable`）—— 与"这一版没有 mod"分开说；
 *   · 目录可用但这一版一条都没有 ⇒ 一句"没有可列的 mod"（空表与"没渲染"分不开）；
 *   · 否则 ⇒ 表。
 */
export function VersionModList({
  page,
  tagLabels,
  busy,
  onAction,
  progress,
  readOnly = false,
}: VersionModListProps) {
  const { t, i18n } = useTranslation();
  /**
   * 标签显示名按**当前语言**取（与 `FolderJarList` 那一处同一条判据：`i18n.language`
   * 形如 `zh-CN` / `en`）。
   */
  const labelLang: 'zh' | 'en' = i18n.language?.startsWith('en') ? 'en' : 'zh';
  /**
   * ★ `downloadTargets` 里装的是文件夹 **id**，而那对用户没有意义 ⇒ 选项上要印**路径**。
   * ⚠️ 它是**纯展示联结**（没有任何判定依赖它）：路径就在同一个投影的 `page.folders` 里
   *    （`downloadTargets` 正是从那一批里筛出来的）⇒ 这里组的映射与它是同一份事实，
   *    不是第二份真相。
   */
  const pathOf = new Map(page.folders.map((block) => [block.folder.folderId, block.folder.path]));

  return (
    <section className="modlist" data-version={page.version} data-mod-count={page.mods.length}>
      <h3 className="modlist__title">
        {/*
          ⚠️ 标题带**该版本**（不说版本的话，用户会以为这一栏是全局的 —— 与底部旧清单
          那条 `missingHint` 同一条理由）与条数（"48 个"是这一栏的规模读数）。
        */}
        {t('files.versionModsTitle', { version: page.version, count: page.mods.length })}
      </h3>
      {page.catalogAvailable ? null : (
        /*
         * ★★ 目录不可用（spec §8 第二行）：用**既有**那条文案，**不画表**。
         * ⚠️ 它与下面那条"这一版没有 mod"是两件不同的事（Ruling 65 的同一条纪律：
         *    "读不到"与"没有"必须分得开）。
         */
        <Notice kind="info">{t('files.catalogUnavailable')}</Notice>
      )}
      {page.catalogAvailable && page.mods.length === 0 ? (
        <div className="state state--empty">
          <p>{t('files.versionModsNone')}</p>
        </div>
      ) : null}
      {page.catalogAvailable && page.mods.length > 0 ? (
        <div className="filetable" data-mod-rows={page.mods.length}>
          <table className="filetable__table">
            <thead className="filetable__head">
              {/*
                ⚠️★ 四个表头：mod / 最新版本 / 主页 / 下载到。
                ⚠️ 最后那一格**不是** `files.colActions`（用户明确要求取消"操作"列，spec §4）：
                  它装的是"这一行下没下 / 能不能下"，所以表头用既有的 `files.missingDownloadTo`
                  （"下载到" —— 与底部旧清单那一格同一个意思）。
                ⚠️ 目标版本那一格的表头复用 `files.colLatest`（与旧第一部分同一个概念、同一句话
                —— 那个表在 T6 删了，词条与这一格的用法都留着）。
              */}
              <tr>
                <th>{t('files.colMod')}</th>
                <th>{t('files.colLatest')}</th>
                <th>{t('files.colHomepage')}</th>
                <th>{t('files.missingDownloadTo')}</th>
              </tr>
            </thead>
            <tbody>
              {page.mods.map((row) => (
                <VersionModItem
                  key={row.modid}
                  row={row}
                  version={page.version}
                  pathOf={pathOf}
                  tagLabels={tagLabels}
                  labelLang={labelLang}
                  busy={busy}
                  onAction={onAction}
                  progress={progress}
                  readOnly={readOnly}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

/** 第三段里的一行。 */
function VersionModItem({
  row,
  version,
  pathOf,
  tagLabels,
  labelLang,
  busy,
  onAction,
  progress,
  readOnly = false,
}: {
  row: VersionModRow;
  /** `page.version` —— 主进程要的那一格（拿它跟目标文件夹的有效版本对一遍）。 */
  version: string;
  /** 文件夹 id ⇒ 路径（选项上印路径，见 `VersionModList`）。 */
  pathOf: ReadonlyMap<string, string>;
  tagLabels: ModFoldersState['tags'];
  labelLang: 'zh' | 'en';
  busy: boolean;
  onAction: ModPageActionHandler;
  /** ★ C 的 T5：整页那份进度载荷（见 `VersionModListProps.progress`）。 */
  progress: PageProgress | null;
  /** ★ D1（T7）：只读那一层（见 `VersionModListProps.readOnly`）。 */
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  /**
   * ★★ 用户选中的目标文件夹。
   *
   * ⚠️ 它是**界面态**（不是第二份真相）：主进程收的是 `(modid, gameVersion, folderId, channel)`，
   *    而"选哪个文件夹"只有这一屏知道。初值 = 第一个可用的（用户不选也能点）。
   * ⚠️★ 下面那个 `folderId` 是**必要的第二道判据**，不是保险（与旧底部清单那一格逐字同一条）：
   *    `downloadTargets` 会随后台的推送变化（用户解绑了一个文件夹）⇒ 存在 `chosen` 里的 id
   *    可能已经不在选项里，而 `<select value=X>` 里没有 X 时浏览器会**静默选中第一个**
   *    —— 那时界面上显示的是另一个文件夹，点下去装到哪个目录就说不清了。
   *    ⇒ 每一次渲染都按当前的 `downloadTargets` 现算。
   */
  const [chosen, setChosen] = useState(row.downloadTargets[0] ?? '');
  const folderId = row.downloadTargets.includes(chosen) ? chosen : (row.downloadTargets[0] ?? '');
  /** ★ 「已下载」的判据 = **投影**那一格（D5：只在**已展开**的文件夹里判定）。 */
  const downloaded = row.downloadedIn.length > 0;
  /**
   * ★★ 能不能下：`manual` 与"没有目标"（`releaseUrl === null`）那两档主进程**必拒**
   *    ⇒ 一颗都不画（理由与坐标见文件头那一段）。
   */
  const downloadable = row.releaseUrl !== null && !row.manual;
  /**
   * ★★ 不能下时那句解释：`manual` 有它自己的话；其余两档（`ambiguous` / `missing-release`）
   * 复用共享的 `VERDICT_HINTS`。
   * ⚠️ `??` 那一支**不可达**（`releaseUrl === null` 只可能是那两档，而两档都有 hint）；
   *    写它是为了类型收窄（`VERDICT_HINTS` 是 `Partial`），取的是"读不出来"那句最泛的话。
   */
  const whyKey = row.manual
    ? 'files.hintManual'
    : (VERDICT_HINTS[row.verdict.kind] ?? 'files.hintUnknown');
  /**
   * ★★ B2（最终修复波）：**没有合法目标**时那句话分两支，判据是 `presentIn`。
   *
   * ⚠️★ 为什么必须有这一支：`downloadTargets` 是**合法**目标表（投影把"已经有它"的
   *    文件夹排掉了，因为主进程 `downloadMissing` 对那种目标是**无条件拒**的）⇒
   *    "空"有两种毫不相干的成因，说同一句话会把用户指错方向：
   *      · `presentIn` 空 ⇒ 这一版**没有一个能装的文件夹**（"先绑定一个文件夹"）；
   *      · `presentIn` 非空 ⇒ 能装它的文件夹里**都已经有它了** —— 此时正确的动作是
   *        **展开那个文件夹**（或干脆什么都不做：它已经在了），而不是去绑一个新文件夹。
   *    ⚠️ 这一支**在默认视图里是常态**（`expanded` 为空、而这一版只有一个文件夹）
   *    —— 修之前那一屏画的是一颗**注定被拒**的按钮（B2 的现场）。
   * ⚠️ 路径取 `pathOf`（= `page.folders` 里那一格）⇒ 与目标选择器里的选项文字同源；
   *    查不到时退回 id（与选择器里 `pathOf.get(id) ?? id` 同一条退化）。
   */
  const firstPresent = row.presentIn[0] ?? '';
  const noTargetKey =
    row.presentIn.length === 0
      ? t('files.noFolderForDownload', { version })
      : t('files.alreadyInFolder', { folder: pathOf.get(firstPresent) ?? firstPresent });
  /**
   * ★★ C 的 T5：**这一行就是正在下的那一项吗**（是 ⇒ 那份载荷，否则 `null`）。
   *
   * ⚠️★ 与 `FolderJarList` 那一处**逐条同一个判据**（两个条件缺一不可）：
   *    `modid` 说"是哪一项"，`folderId` 说"下到哪个文件夹"——
   *    只比 `modid` 的话，`f1` 里正在下 `sodium` 时，**另一个**文件夹里那一行
   *    （如果它也在这一版的目标表里）会一起显示同一条进度。
   * ⚠️★ **代价（认，行为不改）**：这里的 `folderId` 是**用户当下选中**的那一个（上面
   *    `chosen` 那一支每次渲染现算的），不是"这一趟发起时用的那个" —— 于是下载正在跑的
   *    时候用户改了这个下拉，这一行就**不再命中** ⇒ 它的进度与取消入口当场消失。
   *    语义上"这一行此刻在下它"确实由下拉定义（下拉决定下到哪个文件夹），所以判据
   *    跟着它走是对的；而"改下拉会丢掉这一行的进度入口"这一步**没有**断言
   *    （静态渲染不跑事件、也改不了 `useState`）—— 记在这里，不让它变成一条隐式行为。
   */
  const line =
    progress !== null && progress.frame.folderId === folderId && progress.frame.modid === row.modid
      ? progress
      : null;

  return (
    <tr
      className="filetable__row"
      data-modid={row.modid}
      /* ⚠️ 机器读数：断言与刀都靠它（文案与类名以后再改，这一格还在）。 */
      data-downloaded={downloaded ? 'yes' : 'no'}
    >
      <td>
        <div className="filetable__filebox">
          {/* ⚠️ mod 名是产品名，不翻译（与 jar 列表同一条）。 */}
          <span>{row.name}</span>
          <span className="badges">
            {/* ⚠️ 纯展示的标签片（`.tagchip--static`：不吃 hover / pointer）。 */}
            {row.tags.map((tag) => (
              <span className="tagchip tagchip--static" key={tag}>
                {tagLabelFor(tagLabels, tag, labelLang)}
              </span>
            ))}
          </span>
        </div>
      </td>
      {/* ⚠️ 目标版本；没有目标就是 `null` ⇒ `—`（**不许**填 0、也不许拿本地版本顶上）。 */}
      <td className="filetable__version">{row.releaseVersion ?? DASH}</td>
      <td>
        {/*
          ★ homepage：查不到就是 `—`（空着与"这一格没渲染"分不开 —— 与 jar 列表那一格同一条）。
          ⚠️ 它是**投影**那一格（`row.homepage`）：这一层不回头去 `state.catalogRows` 里翻
             （那正是 T5 交接里点名不许做的事：同一条事实不许有第二份）。
        */}
        {row.homepage === null ? (
          <span className="filetable__err">{DASH}</span>
        ) : (
          <a
            className="ghostbtn"
            data-link="homepage"
            href={row.homepage}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('files.openHomepage')}
          </a>
        )}
      </td>
      <td>
        {/*
          ★★ C 的 T5：**行内**那一条进度（spec §4 的第一档），紧跟在那颗「下载」旁边。
          ⚠️★ 它在"已下载 / 不能下 / 能下"**三支之外**（不是某一支的孩子）：
          进度说的是"这一行此刻正在下它"，而那一刻这一行**还没有**变成「已下载」
          （写盘与判定之间有窗口），也不该因为它当时不可下就看不见 —— 一趟在跑的下载
          必须**永远**看得见它的取消按钮（D4）。
          ⚠️ 命中时**才**画（`line !== null`）：同一份载荷在页面上只该有一条那样的行。
        */}
        {line === null ? null : (
          <DownloadProgressLine
            progress={line}
            onCancel={() => void onAction({ kind: 'cancel-download' })}
          />
        )}
        {downloaded ? (
          /*
           * ★★★ 「已下载」（spec §9.9 / D5）：它**替换**下载按钮，不是与它并列
           *   （两颗一起画正是 spec §9 的刀 ⑨ 要咬的那种退化）。
           * ⚠️★ D1（T7）：这一档**只读那一层照画** —— 它是"这一行现在什么状态"的读数
           *   （不是动作），而只读那一层照样要看得出"这个 mod 已经装在那个实例里了"。
           */
          <span className="badge" data-state="downloaded">
            {t('files.alreadyDownloaded')}
          </span>
        ) : readOnly ? /*
         * ★★ D1（T7）：**只读**那一层 —— 这一格**什么都不画**。
         *
         * ⚠️★ 为什么连那两句解释也去掉：它们说的是"点了会怎样"（"先绑一个文件夹" /
         *    "能装它的文件夹里已经有它了"），而这一层**没有**可点的东西 ——
         *    给一个不存在的动作写解释，用户只会去找那颗不存在的按钮。
         * ⚠️ 判据是"这一层一个下载钩子都没有"（自检 ㊿a 逐条数 `data-action="download-mod"`
         *    与 `data-pack-download` 的**实际命中数**）⇒ 这一支必须是**空**的。
         */
        null : !downloadable ? (
          /* ★ 主进程必拒那两档：只给一句解释（不给按钮，见文件头）。 */
          <span className="filetable__err">{t(whyKey)}</span>
        ) : (
          <div className="filetable__actionbox">
            {/*
              ★★ 目标选择（D6）：**只有多个**文件夹时才画 —— 一个的时候直接下到它
              （多一个选择器就是多一步没有信息量的点击）。⚠️ 选项的文字是**路径**
              （id 对用户没有意义），值仍是 id（主进程收的就是 id）。
              ⚠️ 可访问名带 mod 名（那一列每一行都是一个一模一样的下拉，与旧清单同一条理由）。
            */}
            {row.downloadTargets.length > 1 ? (
              <select
                className="filters__select"
                data-target-picker
                aria-label={t('files.missingDownloadToLabel', { name: row.name })}
                value={folderId}
                disabled={busy}
                onChange={(event) => setChosen(event.target.value)}
              >
                {row.downloadTargets.map((id) => (
                  <option key={id} value={id}>
                    {pathOf.get(id) ?? id}
                  </option>
                ))}
              </select>
            ) : null}
            {/*
              ★★ 0 个**合法**目标（spec §8 那一行）：按钮**禁用**并说清出路 —— 一颗静默的
              死按钮正是这一条要消灭的东西。
              ⚠️★ B2：那句出路分两支（见上面 `noTargetKey`）—— "先绑定一个文件夹"与
              "能装它的文件夹里都已经有它了"是两件事，说成一件会把人指错方向。
              ⚠️ 按钮**留着**（不是消失）：它旁边那句话就是为什么点不动的答案。
            */}
            {row.downloadTargets.length === 0 ? (
              <span
                className="filetable__err"
                data-no-target={row.presentIn.length === 0 ? 'no-folder' : 'already-present'}
              >
                {noTargetKey}
              </span>
            ) : null}
            <button
              type="button"
              className="cta"
              data-action="download-mod"
              /* ⚠️ 两格：没有目标（`folderId === ''`）与**正在写盘**（`assertNotBusy()`）。 */
              disabled={busy || folderId === ''}
              onClick={() =>
                void onAction({
                  kind: 'download-mod',
                  modid: row.modid,
                  gameVersion: version,
                  folderId,
                  channel: 'origin',
                })
              }
            >
              {t('files.downloadMod')}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
