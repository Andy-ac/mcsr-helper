/**
 * 「文件更新」底部 —— **缺失清单**（2026-10-03，Task 8）。
 *
 * ===========================================================================
 * ⚠️★ 这一栏是"用户要做什么"的依据，所以「空着」的两种原因必须分开说
 * ===========================================================================
 * `missing: []` 有**两种完全不同的原因**（2026-10-03 复审的**判修 2**，判据在
 * `ModFoldersState.missingStatus` 上）：
 *   · `'ok'` —— 真的没有缺的（这时才画清单，空着也有话说）；
 *   · 另外三种 —— 我们**还不知道**你有没有：目录没拉到 / 有文件夹的路径不存在 /
 *     有文件夹还没扫过。三种各说各的，一句都不许共用（尤其 `folder-missing` 那一句
 *     **不许叫人去重扫**：`rescan` 对一个不存在的目录只会把读数再删一次
 *     —— 叫人去点一个修不好它的按钮，是**给错动作**）。
 *
 * ===========================================================================
 * ⚠️★ 「下载到」那一格：**版本对不上的文件夹不许出现在选项里**
 * ===========================================================================
 * 主进程 `downloadMissing` 会拒三种文件夹（现读它那三条闸）：
 *   · 路径现在不是目录（spec §8：路径不存在不给更新）；
 *   · 这个文件夹的**有效游戏版本** ≠ 入参那个版本（那会往一个别的版本的目录里装 jar，
 *     而它在目录里看起来完全正常 —— 这是最坏的一种错）；
 *   · 这个文件夹还没有扫描读数。
 * ⇒ 前两条在**这一层**能判，也必须判：选项表 = `pathExists && gameVersion === 行版本`。
 *   ⚠️★ 第三条**不在这一层**：状态里没有"有没有读数"这一格（`rows` 空既可能是"没扫过"
 *   也可能是"它是空的"），**而它不需要** —— 这一栏只在 `missingStatus === 'ok'` 时显示，
 *   而 `'ok'` 的定义就是"每个已绑定文件夹都有成功读数、路径都在"（`buildState` 里那三档
 *   优先级）。⇒ 能显示出来的那些行，第三条闸一定已经过了。
 *   ⚠️ 这条推理是**承重的**：如果哪天有人把清单改成"任何 status 都显示"，
 *   第三条闸就会重新可达（那时的表现是"点了吃一句红字"）—— 组 ㉔ 那几条断言盯的正是它。
 *
 * ===========================================================================
 * ⚠️★ 通道固定走 `'origin'`（这是**唯一**一个页面证得了的选择）
 * ===========================================================================
 * `downloadMissing(modid, gameVersion, folderId, channel)` 的 `channel` 只在
 * `channelUrl` 能给出地址时才成立，而那条判据要**那个 release 的地址**
 * （主机必须在那条镜像的 `hosts` 里）。⚠️★ `MissingModView` 里**没有** release
 * （只有 modid / 名字 / 版本 / 标签）⇒ 页面**证不了**任何镜像适用，发一个
 * `{ mirrorId }` 就是在赌"这条 release 恰好托管在镜像的 hosts 上"，赌输的形态是
 * "点了被主进程拒"（Ruling 47/48 反对的那件事）。
 * ⇒ 走 `'origin'`（`requireChannel('origin')` 永远成立）。代价（认）：底部这一个下载
 *   用不到加速通道 —— 要让它用得上，得先把 release 放进 `MissingModView`
 *   （那是契约级的改动，记在报告里）。
 */
import type { MissingModView, ModFoldersState, ModFolderView } from '@mcsr/shared/modFolders';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ModFoldersHandlers } from '@/components/FileUpdatesPanel';
import { Notice } from '@/components/Form';

/**
 * 三档"清单被压住"的说法 —— 键当数据传递（`'ok'` 不在这里，它走清单本体）。
 *
 * ⚠️ 写成**显式映射**而不是 `` t(`files.missingStatus.${status}`) ``：拼出来的 key
 *    在字典少一条时**类型检查看不见**，而 `satisfies` 这一句让"`missingStatus` 加了
 *    第四档却忘了加说法"当场编译失败（与两张徽章表同一条纪律）。
 */
const MISSING_STATUS_NOTES = {
  'folder-unscanned': 'files.missingStatusFolderUnscanned',
  'folder-missing': 'files.missingStatusFolderMissing',
  'catalog-unavailable': 'files.missingStatusCatalogUnavailable',
} as const satisfies Record<Exclude<ModFoldersState['missingStatus'], 'ok'>, string>;

export interface MissingModsListProps {
  /** 底部唯一的数据来源（`ModFoldersState.missing` / `folders` / `missingStatus`）。 */
  state: ModFoldersState;
  /**
   * 动作层。`null` = 只读（自检里那次"没有动作层就一个控件都不画"的对照）。
   * ⚠️ 产品里它总是非空（这一块只在 `modFolders` 在的客户端渲染）。
   */
  handlers: ModFoldersHandlers | null;
}

/**
 * 底部那一块本体。
 *
 * ⚠️ 与第二部分同一条：**不印** `lastRun` / `notices` / `actionError`
 * （它们各有一个渲染点，都在第一部分）。
 */
export function MissingModsList({ state, handlers }: MissingModsListProps) {
  const { t } = useTranslation();
  const status = state.missingStatus;
  const showList = status === 'ok' && state.missing.length > 0;

  return (
    <section className="filespanel" data-missing-status={status}>
      <h2>{t('files.partThreeTitle')}</h2>
      {/*
        ⚠️ 这一句里带着**这一栏是按哪个游戏版本算的**（`{{version}}`）：不说的话，
        用户会以为"缺"是相对于某个别的东西说的（而它跟着第一部分那个筛选维度走）。
      */}
      <p className="filespanel__hint">{t('files.missingHint', { version: state.gameVersion })}</p>

      {/*
        ★★ 三档"被压住"的说法（判修 2）：一句一条，不共用、也不画清单。
        ⚠️ 它们同时**解释了为什么下面没有清单** —— 只有 `'ok'` 才画。
      */}
      {status === 'ok' ? null : <Notice kind="info">{t(MISSING_STATUS_NOTES[status])}</Notice>}

      {/* ★ 真的没有缺的（`'ok'` 且一条都没有）：这是**结论**，不是"被压住"。 */}
      {status === 'ok' && state.missing.length === 0 ? (
        <div className="state state--empty">
          <p>{t('files.missingNone')}</p>
        </div>
      ) : null}

      {showList ? (
        <>
          <p className="filespanel__meta">
            {t('files.missingCount', { count: state.missing.length })}
          </p>
          <div className="filetable" data-missing-rows={state.missing.length}>
            <table className="filetable__table">
              <thead className="filetable__head">
                <tr>
                  <th>{t('files.colMod')}</th>
                  <th>{t('files.catalogGameVersion')}</th>
                  <th>{t('files.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {state.missing.map((row) => (
                  <MissingRow
                    key={row.modid}
                    row={row}
                    folders={state.folders}
                    tagLabels={state.tags}
                    busy={state.busy}
                    handlers={handlers}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}

/** 一行缺失的 mod：名字 + 标签 + 版本 + 「下载到」那一格。 */
function MissingRow({
  row,
  folders,
  tagLabels,
  busy,
  handlers,
}: {
  row: MissingModView;
  folders: readonly ModFolderView[];
  tagLabels: ModFoldersState['tags'];
  /** 有更新正在跑（`state.busy`）⇒ 这一格的两个控件都按住。 */
  busy: boolean;
  handlers: ModFoldersHandlers | null;
}) {
  const { t, i18n } = useTranslation();
  /**
   * ★★ 能装它的文件夹：路径在 **且** 有效游戏版本等于这一行的版本
   *   （主进程 `downloadMissing` 的两条闸，见文件头那一段）。
   * ⚠️ `folders` 的顺序 = `sortedFolders`（主进程给的顺序）⇒ 选项顺序可复现。
   */
  const eligible = folders.filter(
    (folder) => folder.pathExists && folder.gameVersion === row.gameVersion,
  );
  /**
   * 用户选中的那个文件夹。
   *
   * ⚠️ 它是**界面态**（不是第二份真相）：主进程收的是 `(modid, gameVersion, folderId,
   * channel)`，而"选哪个文件夹"只有这一屏知道。初值 = 第一个可用的（用户不选也能点）。
   * ⚠️★ 下面那个 `value` 是**必要的第二道判据**，不是保险：`eligible` 会随后台的推送
   * 变化（用户解绑了一个文件夹）⇒ 存在 `chosen` 里的那个 id 可能已经不在选项里，
   * 而 `<select value=X>` 里没有 X 时浏览器会**静默选中第一个** —— 那时界面上显示的
   * 是另一个文件夹，而 `chosen` 里还是旧的（点下去装到哪个目录就说不清了）。
   * ⇒ 每一次渲染都按当前 `eligible` 现算，**不**依赖"存下来的那个还成立"。
   */
  const [chosen, setChosen] = useState(eligible[0]?.folderId ?? '');
  const folderId = eligible.some((folder) => folder.folderId === chosen)
    ? chosen
    : (eligible[0]?.folderId ?? '');
  /**
   * 标签显示名的语言（与第一部分同一条判据：`i18n.language` 形如 `zh-CN` / `en`）。
   * ⚠️ 三层退化（与 `ModCatalogTable` 那一格逐字相同）：状态里的标签全集（两种语言）
   * → 目录给的 `zh`（`row.tagLabels`，与 `tags` 逐位对应）→ key 本身。
   * 三层都是**看得见的缺陷**，不是编一个名字出来。
   */
  const labelLang: 'zh' | 'en' = i18n.language?.startsWith('en') ? 'en' : 'zh';
  const tagLabelOf = (tag: string, index: number): string =>
    tagLabels.find((option) => option.key === tag)?.labels[labelLang] ??
    row.tagLabels[index] ??
    tag;

  return (
    <tr className="filetable__row" data-missing-mod={row.modid}>
      <td>
        <div className="filetable__filebox">
          {/* ⚠️ mod 名是产品名，不翻译（与两张表里同一条）。 */}
          <span>{row.name}</span>
          <span className="badges">
            {/* ⚠️ 纯展示的标签片（`.tagchip--static`：不吃 hover / pointer）。 */}
            {row.tags.map((tag, index) => (
              <span className="tagchip tagchip--static" key={tag}>
                {tagLabelOf(tag, index)}
              </span>
            ))}
          </span>
        </div>
      </td>
      <td className="filetable__version">{row.gameVersion}</td>
      <td>
        {eligible.length === 0 ? (
          /*
           * ★★ 一个能装它的文件夹都没有：**画一句解释，不画那颗按钮**
           *   （主进程会以"版本对不上 / 不是目录"拒，见文件头那一段）。
           */
          <span className="filetable__err">
            {t('files.missingNoFolder', { version: row.gameVersion })}
          </span>
        ) : handlers === null ? null : (
          <div className="filetable__actionbox">
            {/*
              ★ 「下载到」那一格：选项 = **版本对得上的**已绑定文件夹。
              ⚠️ 可访问名带 mod 名（那一列每一行都是一个一模一样的下拉，
              与 v1 的 `autoLabel` 同一条理由）。
            */}
            <select
              className="filters__select"
              aria-label={t('files.missingDownloadToLabel', { name: row.name })}
              value={folderId}
              /* ⚠️ 写盘期间按住下拉：不然用户会以为"我改的选中的那个"已经生效。 */
              disabled={busy}
              onChange={(event) => setChosen(event.target.value)}
            >
              {eligible.map((folder) => (
                <option key={folder.folderId} value={folder.folderId}>
                  {folder.path}
                </option>
              ))}
            </select>
            {/*
              ★ 触发下载（写盘 ⇒ 一次点击，与两张表里那几颗「更新」同一条）。
              ⚠️ 通道**只有** `'origin'` 这一个字面量（理由写在文件头那一段：
              页面手上没有 release，证明不了任何镜像适用）。
              ⚠️★ `disabled` 里两格：没有可选文件夹（`folderId === ''`）与
              **正在写盘**（`busy`）—— 后者是承重的：`downloadMissing` 第一句就是
              `assertNotBusy()`，那时点下去必吃一句"正在更新中"。
            */}
            <button
              type="button"
              className="cta"
              disabled={busy || folderId === ''}
              onClick={() =>
                void handlers.downloadMissing(row.modid, row.gameVersion, folderId, 'origin')
              }
            >
              {t('files.missingDownload')}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
