/**
 * 「显示全部实例」那一栏（2026-10-04，A 的 T3 建；**2026-10-12 D1 的 T7 换数据源**）
 * —— **跨版本**的只读明细。
 *
 * ===========================================================================
 * ★ 它回答的是另一个问题
 * ===========================================================================
 * 上面那一版（`InstancePicker` / `VersionFolderList`）只说"**这一版**下有哪些实例"，
 * 而这一栏说的是"这台机器上**一共**有哪些"（spec §9.11）—— 用户想找的那个实例，
 * 往往不在当前选中的版本下（版本筛选器很容易记错自己在哪一版）。
 *
 * ===========================================================================
 * ⚠️★★ D1（T7）：数据源从 `groups: VersionGroup[]` 换成 **`state.instances`**
 * ===========================================================================
 * 一行要显示**六样**（spec §4.5）：启动器类型 / 实例名 / 版本 / `mods` / `saves` / 扫描状态。
 * ⚠️★ 其中**三样**（启动器类型、实例名、`saves`）在 `folders[]` 里**根本不存在**
 *    （`ModFolderView` 只有 `folderId` / `path` / `gameVersion` / `pathExists` / `hasReading` …）
 *    ⇒ 这一栏**只能**读 `state.instances`（`InstanceView` = `LauncherInstance` + `tracked`）。
 *    拿 `groupFoldersByVersion(state)` 当数据源时，那三格不是"画得不好"，是**没有那个数据**。
 *
 * ⚠️★ 分组规则照旧：按**有效版本**（`instance.gameVersion`）分组，**版本未知**（`null`）
 *    那一组**自成一组**（Ruling 65：读不出来 ≠ 没有），顺序 = 状态里的**首次出现顺序**
 *    （排序会让"刚扫到的实例"跳到别处）。
 *    ⚠️ 分组**在这里做、不调 `groupFoldersByVersion`**：那个函数吃的是 `folders`，
 *    而这一栏的数据源已经不是它了（拿 folders 分组再回头去 instances 里查名字 =
 *    两份真相，第一处不匹配就会静默少一行）。
 *
 * ===========================================================================
 * ⚠️★ 只读明细 = "这里不能下载"（A5），但**不等于**没有出口
 * ===========================================================================
 *   · 下载那四个钩子（`update-folder-all` / `download-mod` / `update-mod` /
 *     `data-pack-download`）**一个都不许在**（渲染自检 ㊿d 逐条数实际命中数）；
 *   · **被追踪**的行 ⇒ 可以点进"版本 → 实例"那一层（`data-action="open-instance"`）；
 *   · **未追踪**的行 ⇒ **没有**那个入口 —— 未追踪的实例**没有 folder**（`deriveFolders`
 *     只派生被追踪的）⇒ 点进去只会看到一屏空白（"点了没反应"那一类坏法）。
 *     它给的是那颗**去勾选**的（`data-action="go-launchers"`），那才是它该做的事。
 *   · 「打开文件夹」**留着**（spec §4.5 / 旧注释的同一条）：它是"在资源管理器里打开"，
 *     不是下载 —— 而"找到那个目录"正是用户来这一栏的目的。
 *
 * ===========================================================================
 * ⚠️★ 「扫描状态」那一格**读的是 `folders[]`**（而其余五样都不是）
 * ===========================================================================
 * 那一格说的是"**我们读到过**这个实例的 mods 目录没有"，而那份读数**只住在**
 * `ModFolderView.hasReading` 上（按 `folderId` 存；`InstanceView` 里没有这一格）。
 * ⚠️★ 判据的顺序是**三档**，缺一档就会编出一个结论（Ruling 65）：
 *   · 没有对应 folder（未追踪 / 版本未知）⇒ 「未追踪」——那是**没有这一格**，
 *     不是"还没读数"；
 *   · 有 folder 而没有成功读数 ⇒ 「还没有读数」；
 *   · 有读数 ⇒ 「已扫描」。
 * ⚠️ 对应关系是 `folderId === instance.key`（`deriveFolders` 用 `instance.key` 当 key，
 *    spec §7）—— **一处**对齐，不在这里再推一遍 id。
 */
import type { InstanceView, ModFolderView } from '@mcsr/shared/modFolders';
import { useTranslation } from 'react-i18next';
import { launcherKindKey } from '@/components/InstancePicker';
import type { ModPageActionHandler } from '@/components/ModDownloadPanel';
import { VersionBadge } from '@/components/VersionFolderList';

export interface AllFoldersViewProps {
  /** ★ D1（T7）：`state.instances` —— 界面渲染实例的**唯一**来源（T4 投影好的那一份）。 */
  instances: readonly InstanceView[];
  /** 现在看着哪一版（`state.gameVersion`）：当前那一版的分组排在最前面画。 */
  gameVersion: string;
  /**
   * ★ 「扫描状态」那一格**唯一**的读数来源（`state.folders`，按 `folderId` 对齐）。
   * ⚠️★ 它不是第二份"实例"数据：这一栏的六样里**五样**来自 `instances`
   *    （启动器 / 名字 / 版本 / `mods` / `saves`），只有"读到过没有"这一样住在 folder 上。
   */
  folders: readonly ModFolderView[];
  /** 动作层（只有 `ModDownloadPanel` 那一处接线）—— 这一栏只发 `open-folder`。 */
  onAction: ModPageActionHandler;
  /**
   * ★ D1（T7）：点一个**被追踪**的实例 ⇒ 进"版本 → 实例"那一层。
   *
   * ⚠️★ 两个入参都要（`folderId` = `instance.key`，`version` = 那个实例的版本）：
   *    版本**不同**时面板必须**先** `set-catalog-version` **再**选中它 ——
   *    `planVersionPage` 是按 `state.gameVersion` 筛 folders 的，只切实例的话
   *    切过去是**一屏空白**（那是"点了没反应"那一类坏法里最像"功能没做"的一种）。
   * ⚠️ `version` 为 `null`（版本未知的实例）**不给点**：那一版在目录里选不出来
   *    （`requireGameVersion` 要求目录里有的版本）⇒ 面板接不住它，所以那一行的入口
   *    由上面那条规则（只给被追踪的行）之外**再**收一格：未知版本一律走"去勾选"那一颗。
   *    ⚠️ 今天"被追踪 ∧ 版本未知"是可达的（元数据读不出来的实例，用户在文件夹行手改过
   *    版本之前就是它）—— 它的出路是**实例层那个版本下拉**（手改写 `instancePrefs`），
   *    而那一层要先能进去。⇒ 实际口径写在渲染处：`open-instance` 只给**版本已知**的行。
   */
  onOpenInstance: (folderId: string, version: string) => void;
  /** 那颗"去勾选"的入口（未追踪的行、以及版本未知的行都给它）。 */
  onGoToLaunchers: () => void;
}

/** 分组：版本 ⇒ 那一版的实例（顺序 = 首次出现顺序；`null` 自成一组）。 */
function groupInstancesByVersion(
  instances: readonly InstanceView[],
): readonly { version: string | null; rows: readonly InstanceView[] }[] {
  const order: (string | null)[] = [];
  const bucket = new Map<string | null, InstanceView[]>();
  for (const instance of instances) {
    const key = instance.gameVersion;
    const list = bucket.get(key);
    if (list === undefined) {
      bucket.set(key, [instance]);
      order.push(key);
    } else {
      list.push(instance);
    }
  }
  return order.map((version) => ({ version, rows: bucket.get(version) ?? [] }));
}

export function AllFoldersView({
  instances,
  gameVersion,
  folders,
  onAction,
  onOpenInstance,
  onGoToLaunchers,
}: AllFoldersViewProps) {
  const { t } = useTranslation();
  /**
   * ★★ 分组 + **把当前看着的那一版提到最前**。
   *
   * ⚠️★ 为什么需要 `gameVersion` 这一格（而不是"照状态顺序画就行"）：这一栏的名字是
   *    **"显示全部实例"**（跨版本），被追踪的实例可能有几十个 ⇒ 用户此刻在找的那一个
   *    （他正在看的那一版）**常常排在很后面**，而这一栏的作用正是"它在哪"。
   * ⚠️★ 判据是"**当前这一版那一组排第一**"，不是"按版本号排序"：剩下的组照旧按
   *    **首次出现顺序**（排序会让"刚扫到的实例"跳到别处 —— 与 T3 那条注释同一条纪律）。
   */
  const groups = groupInstancesByVersion(instances);
  /**
   * ★ 当前那一版那一组排**最前**（其余组的相对顺序一个字不动）。
   * ⚠️ `gameVersion === ''`（坏状态）时**不排**：拿空串去比会把"版本未知"那一组
   *    （它的 `version` 也是 `null` 而不是 `''`）也判成"不是当前这一版"⇒ 顺序反而变了。
   */
  const ordered =
    gameVersion === '' ? groups : [...groups].sort((a, b) => rankOf(a.version) - rankOf(b.version));
  function rankOf(version: string | null): number {
    return version === gameVersion ? 0 : 1;
  }
  /**
   * `folderId` ⇒ 那条 folder（**只看"读到过没有"这一格**）。
   * ⚠️ 每次渲染现算：这一栏是几十行（实例数量级），一份 Map 比加一层记忆状态便宜
   *    （与 `VersionFolderList` 里那个 `homepageOf` 同一条）。
   */
  const readingOf = new Map(folders.map((item) => [item.folderId, item] as const));
  return (
    <section className="allfolders" data-group-count={groups.length}>
      {/*
        ⚠️ 标题与那颗按钮**复用同一条词条**（`files.allBoundFolders`）：它们是同一件事的
        两个说法（按钮说"点开看"，标题说"看的就是这个"）—— 换一个措辞就会变成两种叫法
        （`Videos.tsx` 里那颗「追踪的博主」标签与它下面那个 `<h2>` 是同一条纪律）。
        ★ D1（T7）：那条词条的值已改成"显示全部实例"（spec §4.5）—— 两个渲染点一起变。
      */}
      <h2 className="allfolders__title">{t('files.allBoundFolders')}</h2>
      {ordered.map((group) => (
        <div
          className="allfolders__group"
          key={group.version ?? '__unknown-version__'}
          /* ⚠️ 版本未知那一组给空串（`data-version=""`）：它不是一个版本，但它必须在。 */
          data-version={group.version ?? ''}
        >
          <h3 className="allfolders__version">
            {/* ⚠️ 版本未知 ⇒ `files.verdictUnknownVersion`，与徽章那一条同源。 */}
            {group.version ?? t('files.verdictUnknownVersion')}
            <span className="allfolders__count">{group.rows.length}</span>
          </h3>
          <ul className="allfolders__list">
            {group.rows.map((instance) => {
              /*
               * ⚠️★ "能不能点进去"的判据**只有一处**（下面那个按钮），而它要求版本已知：
               *    版本未知的实例在目录里选不出来（`set-catalog-version` 会拒）⇒ 给它一颗
               *    "进"的按钮就是一颗**注定不生效**的按钮（Ruling 47/48 反对的那一类）。
               *    它的出路在实例层那个版本下拉里 —— 那要先能进去，而"进去"这一条路由
               *    在版本层已经给过了（`InstancePicker` 只画**这一版**的实例）。
               */
              const canOpen = instance.tracked && instance.gameVersion !== null;
              /** ★ 那一格的**三档**读数（判据顺序见文件头；`undefined` = 没有这一档）。 */
              const folder = readingOf.get(instance.key);
              const scanState: 'scanned' | 'unscanned' | 'untracked' =
                folder === undefined ? 'untracked' : folder.hasReading ? 'scanned' : 'unscanned';
              const scanKey =
                scanState === 'untracked'
                  ? 'files.scanStatusUntracked'
                  : scanState === 'scanned'
                    ? 'files.scanStatusScanned'
                    : 'files.scanStatusUnscanned';
              return (
                <li
                  className="allfolders__row"
                  key={instance.key}
                  /*
                   * ⚠️★ 机器读数是 `data-instance-row`（**不是** `data-folder-id`）：这一栏
                   * 今天画的是**实例**，而"实例"与"文件夹"是两件事（未追踪的实例根本没有
                   * folder）。名字沿用旧的那一个会让"这一行是哪来的"读错。
                   */
                  data-instance-row={instance.key}
                  data-instance-tracked={instance.tracked ? 'yes' : 'no'}
                >
                  {/* ⚠️ 启动器类型走词条（与实例卡同一个函数 —— 一处实现）。 */}
                  <span className="allfolders__kind">{t(launcherKindKey(instance.kind))}</span>
                  {/* ⚠️ 实例名是磁盘上的内容，原样印（不翻译）；`title` 让单行省略后看得全。 */}
                  <span className="allfolders__name" title={instance.name}>
                    {instance.name}
                  </span>
                  <VersionBadge version={instance.gameVersion} />
                  {/* ⚠️ 两格路径都是磁盘上的内容，原样印（标签在 CSS / 词条里，值不翻译）。 */}
                  <span className="allfolders__path" title={instance.modsDir}>
                    {t('files.instanceFieldMods')}: {instance.modsDir}
                  </span>
                  <span className="allfolders__path" title={instance.savesDir}>
                    {t('files.instanceFieldSaves')}: {instance.savesDir}
                  </span>
                  {/*
                    ⚠️★ 扫描状态那一格**不是**"已装 / 缺失"那一族：这里说的是"我们读到过没有"。
                    ⚠️★ 三档**各有各的说法**（Ruling 65：分不清"不知道"与"没有"的读数不许当结论用）：
                       · 没有对应 folder ⇒ 「未追踪」（未追踪的实例**没有 folder**，
                         所以那一格**不存在**，不是"还没扫"）；
                       · 有 folder、没有成功读数 ⇒ 「还没有读数」；
                       · 有读数 ⇒ 「已扫描」。
                    ⚠️ 机器读数 `data-scan-state` 是这三档的**值**（断言与刀都靠它）。
                    ⚠️★ 它的值是**短字面量**（`scanned` / `unscanned` / `untracked`），
                       **不是**词条 key：`RAW_KEY_RE`（`/(?:files|common)\.[A-Za-z]+/g`）
                       会把属性值里那个 `files.scanStatus*` 当成**裸 key 泄漏**报出来
                       （扫描器是对的 —— 它分不出"印在页面上的 key"与"写在属性里的 key"）。
                  */}
                  <span className="allfolders__scan" data-scan-state={scanState}>
                    {t('files.instanceFieldScan')}: {t(scanKey)}
                  </span>
                  {/* ⚠️ 路径是磁盘上的内容，原样印（不翻译）；这一颗是"在资源管理器里打开它"。 */}
                  <button
                    type="button"
                    className="ghostbtn"
                    data-action="open-folder"
                    /* ⚠️ 直传 `instance.key`（= 派生那条 folder 的 `folderId`）：主进程按 id 取路径。 */
                    onClick={() => void onAction({ kind: 'open-folder', folderId: instance.key })}
                  >
                    {t('files.openFolder')}
                  </button>
                  {canOpen ? (
                    <button
                      type="button"
                      className="ghostbtn"
                      data-action="open-instance"
                      /* ⚠️ 两格都给：面板要用 `version` 判"要不要先换目录版本"。 */
                      onClick={() => onOpenInstance(instance.key, instance.gameVersion ?? '')}
                    >
                      {t('files.openInstance')}
                    </button>
                  ) : (
                    /*
                     * ★★ 未追踪（或版本未知）⇒ 那一颗"去勾选"。
                     * ⚠️★ 未追踪的实例**没有 folder**（`deriveFolders` 只派生被追踪的）
                     *    ⇒ 给它"进"的入口就是"点进去一屏空白"（㊿d 的反面判据钉着这一条）。
                     */
                    <button
                      type="button"
                      className="ghostbtn"
                      data-action="go-launchers"
                      onClick={onGoToLaunchers}
                    >
                      {t('files.goLaunchers')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
