/**
 * 「显示全部已绑定的文件夹」那一栏（2026-10-04，A 的 T3）—— **跨版本**的总览。
 *
 * ===========================================================================
 * ★ 它回答的是另一个问题
 * ===========================================================================
 * 上面那一版（`VersionFolderList`）只说"**这一版**下有哪些文件夹"，而这一栏说的是
 * "这台机器上**一共**绑了哪些"（spec §9.11）—— 用户想找的那个实例，往往不在当前选中的
 * 版本下（版本筛选器是 D4 加的，很容易记错自己在哪一版）。
 *
 * ⚠️★ 分组**只有一处实现**：`groupFoldersByVersion(state)`（T1）。这一层不排序、不过滤
 *   ——它的顺序就是状态里的**首次出现顺序**（按用户的绑定顺序画；排序会让"刚加的那个
 *   文件夹"跳到别处）。⚠️ 版本未知的那些（`version === null`）**自成一组**，
 *   不许从这一栏里消失（Ruling 65：读不出来 ≠ 没有）。
 *
 * ⚠️★ 这一栏里**没有**展开、没有整夹的控件（版本手改 / 自动更新 / 全部更新 / 重扫 / 解绑）：
 *   那些是"我确定要在这一版干这件事"的动作，而这里只是"我的文件夹都在哪"。
 *   唯一留的动作是「打开文件夹」（找文件夹正是用户来这一栏的目的）。
 *   ⚠️ A 只挪位置、不删能力：那些控件一个都没少，它们在 `VersionFolderList` 那一行里。
 */
import type { VersionGroup } from '@mcsr/shared/modFolders';
import { useTranslation } from 'react-i18next';
import type { ModPageActionHandler } from '@/components/ModDownloadPanel';
import { FolderStatusBadge, VersionBadge } from '@/components/VersionFolderList';

export interface AllFoldersViewProps {
  /** `groupFoldersByVersion(state)` 的产物（分组只有那一处实现）。 */
  groups: readonly VersionGroup[];
  onAction: ModPageActionHandler;
}

export function AllFoldersView({ groups, onAction }: AllFoldersViewProps) {
  const { t } = useTranslation();
  return (
    <section className="allfolders" data-group-count={groups.length}>
      {/*
        ⚠️ 标题与那颗按钮**复用同一条词条**（`files.allBoundFolders`）：它们是同一件事的
        两个说法（按钮说"点开看"，标题说"看的就是这个"）—— 换一个措辞就会变成两种叫法
        （`Videos.tsx` 里那颗「追踪的博主」标签与它下面那个 `<h2>` 是同一条纪律）。
      */}
      <h2 className="allfolders__title">{t('files.allBoundFolders')}</h2>
      {groups.map((group) => (
        <div
          className="allfolders__group"
          key={group.version ?? '__unknown-version__'}
          /* ⚠️ 版本未知那一组给空串（`data-version=""`）：它不是一个版本，但它必须在。 */
          data-version={group.version ?? ''}
        >
          <h3 className="allfolders__version">
            {/* ⚠️ 版本未知 ⇒ `files.verdictUnknownVersion`，与徽章那一条同源。 */}
            {group.version ?? t('files.verdictUnknownVersion')}
            <span className="allfolders__count">{group.folders.length}</span>
          </h3>
          <ul className="allfolders__list">
            {group.folders.map((folder) => (
              <li
                className="allfolders__row"
                key={folder.folderId}
                data-folder-id={folder.folderId}
              >
                {/* ⚠️ 路径是磁盘上的内容，原样印（不翻译）。 */}
                <span className="allfolders__path">{folder.path}</span>
                <VersionBadge version={folder.gameVersion} />
                <FolderStatusBadge folder={folder} />
                <button
                  type="button"
                  className="ghostbtn"
                  data-action="open-folder"
                  disabled={!folder.pathExists}
                  onClick={() => void onAction({ kind: 'open-folder', folderId: folder.folderId })}
                >
                  {t('files.openFolder')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
