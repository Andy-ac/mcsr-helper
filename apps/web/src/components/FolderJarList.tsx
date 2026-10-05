/**
 * 展开的文件夹里那一张 **jar 列表**（2026-10-04，A 的 T4）。
 *
 * ===========================================================================
 * ⚠️★ 纯展示：判定一格都不在这里重写（与 `VersionFolderList` / `ModDownloadPanel` 同一条）
 * ===========================================================================
 * 喂一份投影（`VersionFolderBlock`）就同步画完：不取数、不订阅、不跑 effect。
 * 这里读的全是**别人算好的**读数：
 *   · `block.folder.rows` / `.unrecognized`（扫文件夹的读数，`planFolderView` 算的）；
 *   · 每行的 `verdict` / `manual` / `official`（`judgeRelease` + `resolveTarget` 算的）；
 *   · 「哪条镜像适用」= `mirrorsForUrl(mirrors, row.official.url)`（`mirrorsFor` 一份实现）。
 * ⚠️★ 徽章与解释**共用** `FileUpdateTable` 的 `VERDICT_BADGES` / `VERDICT_HINTS`
 *   （与旧第二部分 `ModFoldersPanel` 同一条理由：两处各写一张表的话，"同一个判定、
 *   两处说法不一致"只是时间问题 —— Ruling 14 的现场）。
 * ⚠️★ 触发更新的判据（`older` / `different-build` 且非 `manual`）与
 *   `ModFoldersPanel.FolderRow` **逐字相同** —— 它现在是这一条的**第三处**文本
 *   （前两处是 `ModCatalogTable` 与 `ModFoldersPanel`）。抽成一个共用函数要动
 *   `ModFoldersPanel.tsx`（不在 T4 的文件边界里、而且 T6 会删它）⇒ **记在报告里**，
 *   与 T3 判修轮抽出 `staleGameVersion` / `canUpdateFolderAll` 是同一条账。
 *
 * ===========================================================================
 * ⚠️★ homepage 是**页面**喂进来的：`VersionFolderBlock` / `ModFolderRowView` 都不带它
 * ===========================================================================
 * 目录里 `mod.homepage` 只落在 `CatalogRowView` 上（`planCatalogRows` 填的唯一一格），
 * 而展开体手里只有文件夹那一支 ⇒ 这一格只能由页面从 `state.catalogRows` 组装成
 * `homepageOf` 传进来（2026-10-04 T1 评审的裁定）。
 * ⚠️ 它是**纯展示联结**：没有任何判定依赖 homepage（查不到 ⇒ 那一格印 `—`，只是少一条链接）。
 *
 * ===========================================================================
 * ⚠️★ 未识别那一行**必须**是红的（spec §8 / §9 的刀 ⑧）
 * ===========================================================================
 * "认不出这是目录里的哪个 mod"由 `files.jarUnrecognized` 说，而**红**由 `styles.css` 的
 * `.jar--unrecognized` 承载 —— 只靠那句话，这一行与别的行是**同一个颜色**
 * （自检㊱ 里那条"`styles.css` 里真的有这条规则、而且颜色是红石色"就是这件事的判据）。
 * ⚠️ `data-jar-unrecognized="true"` 是给自检的**机器读数**：类名以后再改名，那条读数还在。
 * ⚠️ 两类原因（读不出 `fabric.mod.json` / 清单外）**分开说**，复用旧第二部分那两条词条
 *   （它们是这两句话**唯一**的实现 —— 合成一句就把用户唯一能行动的线索删掉了）。
 *
 * ===========================================================================
 * ⚠️ 展开体的**空态**不在这里
 * ===========================================================================
 * "路径不存在 / 版本未知 / 没有读数 / 读到过而一个都没有"四档由 `VersionFolderList` 画
 * （它才是决定"要不要画这张表"的那一层）—— 这一层是**一份哑列表**：给它行就画行。
 */
import { type ModMirror, releaseKey } from '@mcsr/shared/modCatalog';
import {
  type ModFolderRowView,
  type ModFolderView,
  mirrorsForUrl,
  type VersionFolderBlock,
} from '@mcsr/shared/modFolders';
import { useTranslation } from 'react-i18next';
import { VERDICT_BADGES, VERDICT_HINTS } from '@/components/FileUpdateTable';
import type { ModPageActionHandler } from '@/components/ModDownloadPanel';

/** 「没有值的那一格」——与两张表、旧第二部分里那个 `DASH` 是同一个字符。 */
const DASH = '—';

/** 这张表的列数（未识别那一行要 `colSpan` 跨过去）。 */
const JAR_COLUMNS = 7;

export interface FolderJarListProps {
  /**
   * 投影的一格（`planVersionPage` 的产物）：`block.folder` 里就是这一夹的全部 jar
   * （含未识别）。⚠️ 类型就用投影自己那个（**不**在这里另立一个"看起来一样"的形状 ——
   * 那正是"同一批事实有第二份形状"，将来 `ModFolderView` 加一格这里会静默漏掉它）。
   */
  block: VersionFolderBlock;
  /**
   * 目录里每个 modid 的 homepage（页面从 `state.catalogRows` 组装）。
   * ⚠️ 查不到 = `null` ⇒ 那一格印 `—`（**不许**拿别的行顶上）。
   */
  homepageOf: ReadonlyMap<string, string | null>;
  /** 状态里那份镜像表（`state.mirrors`）——「更新（镜像）」那颗按钮的**唯一**依据。 */
  mirrors: readonly ModMirror[];
  /** 正在写盘（`state.busy`）⇒ 每一颗按钮都禁用（与头行、旧那一版同一条）。 */
  busy: boolean;
  /** 动作层（只有 `ModDownloadPanel.run()` 那一处接线）。 */
  onAction: ModPageActionHandler;
}

export function FolderJarList({ block, homepageOf, mirrors, busy, onAction }: FolderJarListProps) {
  const { t } = useTranslation();
  const folder = block.folder;

  return (
    <div className="jarlist" data-jar-count={folder.rows.length + folder.unrecognized.length}>
      <table className="jarlist__table">
        <thead className="jarlist__head">
          <tr>
            <th>{t('files.colFile')}</th>
            <th>{t('files.colMod')}</th>
            <th>{t('files.colLocal')}</th>
            <th>{t('files.colReleasePage')}</th>
            <th>{t('files.colHomepage')}</th>
            <th>{t('files.colStatus')}</th>
            <th>{t('files.colActions')}</th>
          </tr>
        </thead>
        <tbody>
          {folder.rows.map((row) => (
            <JarRow
              key={row.modid}
              row={row}
              folder={folder}
              homepageOf={homepageOf}
              mirrors={mirrors}
              busy={busy}
              onAction={onAction}
            />
          ))}
          {folder.unrecognized.map((entry) => (
            <tr
              key={`${entry.reason}:${entry.fileName}`}
              /*
               * ★★ 类名与机器读数**两样都要**（spec §9 的刀 ⑧ 认类名**或** data 属性，
               *    这里两样都给：类名承载红、属性给自检）。
               * ⚠️ `jar--unrecognized` 里的 `jar--` 前缀是简报**逐字给定**的（我们的块名是
               *    `jarrow`）—— 照写不改，`styles.css` 里那条规则用的是同一个选择器。
               */
              className="jarrow jar--unrecognized"
              data-jar-unrecognized="true"
              data-unrecognized-reason={entry.reason}
            >
              {/* ⚠️ 文件名是磁盘上的内容，原样印（不翻译）。 */}
              <td className="jarrow__file">{entry.fileName}</td>
              <td className="jarrow__note" colSpan={JAR_COLUMNS - 1}>
                <span className="badge badge--problem">{t('files.jarUnrecognized')}</span>
                {/*
                 * ★★ 两类原因**分开说**（spec §8）：这两条词条是旧第二部分的，
                 *    而旧第二部分在 T6 会被删 ⇒ 渲染点必须在这里接上，否则
                 *    "读不出 fabric.mod.json"与"清单外"这两个出路就一起消失了。
                 */}
                {entry.reason === 'no-fabric-meta'
                  ? t('files.folderUnrecognizedNoMeta', { name: entry.fileName })
                  : t('files.folderUnrecognizedNotInCatalog', { name: entry.fileName })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 已识别的一行（一个 modid 一组 jar）。
 *
 * ⚠️ 列的**顺序**是承重的：`data-jar` 那一格之后 600/900 字符内必须出现那两颗链接
 *    （自检 ㊱ 的两条窗口断言）—— 把链接挪到行尾会让它们红，而那正是"这一行还给不给
 *    下载与主页"的排版判据。
 */
function JarRow({
  row,
  folder,
  homepageOf,
  mirrors,
  busy,
  onAction,
}: {
  row: ModFolderRowView;
  folder: ModFolderView;
  homepageOf: ReadonlyMap<string, string | null>;
  mirrors: readonly ModMirror[];
  busy: boolean;
  onAction: ModPageActionHandler;
}) {
  const { t } = useTranslation();
  const badge = VERDICT_BADGES[row.verdict.kind];
  const hint = VERDICT_HINTS[row.verdict.kind];
  /**
   * ★★ 主进程要的那个键 —— **分隔符只有一处实现**：`releaseKey()`（`@mcsr/shared/modCatalog`，
   *    `modCatalog.ts:302`，那段注释写着"分隔符只此一处"）。版本取 `folder.gameVersion`
   *    （状态里那一版）—— 行里没有版本字段，而"这个文件夹是哪一版"正是主进程
   *    `requirePairKey` 要核对的那一格。
   *    ⚠️★ 判修轮之前这里是**手搓的第二份** `${row.modid}|${folder.gameVersion ?? ''}`
   *    （评审点名）：分隔符漂一个字符时，症状只是"这一行点更新没反应"
   *    （主进程 `requirePairKey` 拒），而自检里没有任何东西盯得住那个字符串。
   *    ⚠️ 版本未知时 `?? ''` 让它变成 `${modid}|`（主进程必拒的形状），而那一档 `rows` 里的
   *    判定全是 `unknown-version` ⇒ 两颗按钮根本画不出来，这个值也发不出去。
   */
  const pairKey = releaseKey(row.modid, folder.gameVersion ?? '');
  /**
   * ★★ 这条 release 能用哪条镜像 —— **判据与主进程共用 `mirrorsFor` 那一份实现**
   * （`mirrorsForUrl` 只是把状态里那份镜像表喂给它）。取第一条（目录里的顺序 =
   * 配置即代码的顺序，可复现）。
   */
  const mirror =
    row.official === null ? null : (mirrorsForUrl(mirrors, row.official.url)[0] ?? null);
  /**
   * ★★ 给不给更新按钮 = **主进程会不会收**（与旧第二部分逐字相同）：`older` 与
   *    `different-build` 是 `assertUpdatable` 放行的那两支，`manual` 一律不给
   *    （spec §8 的"绝不替换"）。
   *    ⚠️ 判据**不是** `row.batchable`：那只认 `older` + auto + 可排序 ⇒ `different-build`
   *    那一行会一颗按钮都没有（自检 ㊱ 的夹具里它是 `batchable: false`，专门咬这一条）。
   */
  const updatableKind = row.verdict.kind === 'older' || row.verdict.kind === 'different-build';
  const showUpdate = !row.manual && updatableKind;
  /** 目录里这个 mod 的主页（查不到就是 `null` ⇒ 印 `—`）。 */
  const homepage = homepageOf.get(row.modid) ?? null;

  return (
    <tr className="jarrow" data-jar={row.modid} data-verdict={row.verdict.kind}>
      {/* ⚠️ 文件名是磁盘上的内容，原样印（不翻译）。 */}
      <td className="jarrow__file">{row.fileName}</td>
      {/* ⚠️ mod 名是产品名，不翻译（与两张表里同一条）。 */}
      <td>{row.name}</td>
      {/* ⚠️ 读不出来就是 `null` ⇒ `—`：**不许**填 0、也不许拿目标版本顶上"本地版本"。 */}
      <td className="jarrow__version">{row.localVersion ?? DASH}</td>
      <td className="jarrow__link">
        {/*
          ★★ 下载链接 = **目标那条 release 的地址**（`row.official.url`），
          没有目标（`ambiguous` / `missing-release`）就印 `—` —— **不许**拿 `candidates[0]`
          兜底（那是替用户在"还没定该装哪个"的那一档里选一个）。
        */}
        {row.official === null ? (
          <span className="jarrow__none">{DASH}</span>
        ) : (
          <a
            className="ghostbtn"
            data-link="download"
            href={row.official.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('files.openPage')}
          </a>
        )}
      </td>
      <td className="jarrow__link">
        {/*
          ★ homepage 那一格：值来自 `homepageOf`（页面从 `state.catalogRows` 组的映射）。
          ⚠️ 查不到就是 `—`，**不是**空着 —— 空着与"这一格没渲染"分不开。
        */}
        {homepage === null ? (
          <span className="jarrow__none">{DASH}</span>
        ) : (
          <a
            className="ghostbtn"
            data-link="homepage"
            href={homepage}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('files.openHomepage')}
          </a>
        )}
      </td>
      <td>
        {badge === null ? null : <span className={badge.className}>{t(badge.label)}</span>}
        {/*
          ★ 各支欠的解释（spec §8）：文案表与第一部分 / 旧第二部分**共用一份**
          （`VERDICT_HINTS`）。⚠️ `unknown-version` 的解释在文件夹头行（说一次），
          不在这里逐行重复。
        */}
        {hint === undefined ? null : <span className="jarrow__hint">{t(hint)}</span>}
        {/* ★ `manual` 那一句：它连更新按钮都不给（主进程 `assertNotManual` 会拒）。 */}
        {row.manual ? <span className="jarrow__hint">{t('files.hintManual')}</span> : null}
      </td>
      <td>
        {/*
          ★★ 两颗更新按钮各送**自己那条通道**（与第一部分 / 旧第二部分逐字相同）：
            · 「更新（原始）」= `'origin'`（release 自己的地址）；
            · 「更新（镜像）」= `{ mirrorId }` —— **只送 id**，地址由主进程按目录里那条
              镜像的 `prefix` 拼（`Channel` 是 id、不是 URL）。
          ⚠️ 镜像那一颗只在"状态里那份镜像表里有一条认这个主机的镜像"时出现；
          没有它时用户仍有原始那一颗（D5 的降级）。
          ⚠️ `busy` **不是**"只禁用镜像那一颗"：写盘期间两颗一起按住（与头行同一条）。
        */}
        {showUpdate ? (
          <div className="jarrow__actions">
            <button
              type="button"
              className="ghostbtn"
              disabled={busy}
              onClick={() =>
                void onAction({
                  kind: 'update-mod',
                  folderId: folder.folderId,
                  modid: row.modid,
                  releaseKey: pairKey,
                  channel: 'origin',
                })
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
                  void onAction({
                    kind: 'update-mod',
                    folderId: folder.folderId,
                    modid: row.modid,
                    releaseKey: pairKey,
                    channel: { mirrorId: mirror.id },
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
