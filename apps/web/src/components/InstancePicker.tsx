/**
 * ★★ D1（T7）：「版本 → 实例」那一层的**上半截** —— 这一版**被追踪的实例**那张卡列表。
 *
 * ===========================================================================
 * ⚠️★ 它是"版本层"的入口，而版本层**只能看**（spec A3）
 * ===========================================================================
 * 点一张卡 ⇒ 进"版本 → 实例"那一层（A4），**下载只发生在那一层**。
 * ⇒ 这一层里**不许**出现四个下载钩子里的任何一个
 *   （`data-action="update-folder-all"` / `"download-mod"` / `"update-mod"` /
 *   `data-pack-download`）—— 渲染自检 ㊿a 逐条数它们（**实际命中数**印在那条断言里）。
 *   ⚠️ 那句提示（`data-readonly-hint`）就是"为什么这里不能下"的唯一答案：
 *   少了它，那一屏看起来像"下载按钮坏了"。
 *
 * ===========================================================================
 * ⚠️★ 数据源是 `state.instances`，不是 `folders[]`
 * ===========================================================================
 * 卡上要印**实例名**（`InstanceView.name`）与"待确认"那一档（`needsConfirm` 是**显示值**：
 * `needsConfirm && !confirmed`，由 `instanceViewsOf` 算好）—— 这两格 `folders[]` 里
 * **都没有**（`folders[]` 只有路径 / 版本 / 读数）。⚠️ `folderId` 与 `instance.key`
 * 是**同一个值**（`deriveFolders` 用 `instance.key` 当 key，spec §7），所以两边对得上。
 * ⚠️★ 判据不是"`tracked` 是不是 true"就完了：`deriveFolders` 只派生**被追踪**的实例
 * ⇒ 未追踪的实例**没有 folder**，把它画成可点的卡就是"点进去看到一屏空白"（那一类坏法）。
 *
 * ===========================================================================
 * ⚠️★ 两种"空"必须分得开（Ruling 65 的同一条纪律）
 * ===========================================================================
 *   · 这一版没有**被追踪**的实例（`state.instances` 非空）⇒ 「去勾一个 {{version}} 的实例」
 *     —— 这是 A8 的第三种空态；
 *   · 一个实例都**没读到**（`state.instances` 为空：还没绑启动器 / 枚举还没回来）⇒
 *     「先去绑一个启动器」。
 * 两句话说成一句会把用户指去错的地方（"去勾选"对一个还没绑启动器的用户是**没有那个东西**）。
 *
 * ===========================================================================
 * ⚠️ 导出它是为了自检能单独渲染（与 `ModTabs` / `ModCatalogScanning` 同一条理由）
 * ===========================================================================
 * `renderToStaticMarkup` 不跑 effect（本仓 §5.73），而这一层是纯 props 组件
 * ⇒ 自检喂一份 `instances` 就能断言它画了什么。
 */
import { instanceKeyParts, type LauncherKind } from '@mcsr/shared/launcherInstances';
import type { InstanceView } from '@mcsr/shared/modFolders';
import { useTranslation } from 'react-i18next';
import { VersionBadge } from '@/components/VersionFolderList';

/**
 * 启动器类型 ⇒ 词条的 key（`files.launcherKind*`）。
 *
 * ⚠️★ **只有这一个函数**知道哪个 kind 对应哪条词条：A5 的只读明细那一栏也要印同一个名字
 *    （`AllFoldersView` 也 import 它）—— 两处各写一份 `switch` 就是"同一个启动器两个叫法"，
 *    而那种漂不会红在任何门禁上。
 * ⚠️ 返回的是 **key** 而不是译文：调用方才知道自己要不要 `t()`（这一层用 `useTranslation`，
 *    而 `AllFoldersView` 也有自己的那一个 —— 一个函数同时给"key 字符串"与"译文"两种东西
 *    会让 `t()` 在这一层被调两次）。
 * ⚠️★ `LauncherKind` 从 **`@mcsr/shared/launcherInstances`** import（不是 `modFolders`）：
 *    后者只是**内部** import 了那个类型、**没有**再导出（`typecheck` 会当场报 TS2459）。
 *    ⚠️ 而它必须从契约/纯规则那一层取：手抄六个字面量的话，`LauncherKind` 加一支
 *    这里**编译期不会红**（`switch` 少一支 ⇒ 运行期返回 `undefined` ⇒ 界面印一个 key）。
 */
export function launcherKindKey(kind: LauncherKind): string {
  switch (kind) {
    case 'multimc':
      return 'files.launcherKindMultimc';
    case 'prism':
      return 'files.launcherKindPrism';
    case 'pcl2':
      return 'files.launcherKindPcl2';
    case 'hmcl':
      return 'files.launcherKindHmcl';
    case 'official':
      return 'files.launcherKindOfficial';
    case 'mcsr':
      return 'files.launcherKindMcsr';
  }
}

export interface InstancePickerProps {
  /** 界面上**唯一**的实例来源（`state.instances`，T4 投影好的那一份）。 */
  instances: readonly InstanceView[];
  /** 现在看着哪一版（`page.version`）—— 只有这一版**被追踪**的实例才是这一层的候选。 */
  gameVersion: string;
  /** 此刻选中的那个实例（`null` = 还在这一层）。 */
  selected: string | null;
  /** 点一张卡 ⇒ 进实例层（**由面板接住**：它要顺手把目录版本也切过去）。 */
  onSelect: (folderId: string) => void;
  /** 那颗"去勾选/去绑定"的入口（A8 那两种空的唯一出路）。 */
  onGoToLaunchers: () => void;
}

export function InstancePicker({
  instances,
  gameVersion,
  selected,
  onSelect,
  onGoToLaunchers,
}: InstancePickerProps) {
  const { t } = useTranslation();
  /**
   * 这一版的候选 = **被追踪** ∧ 版本对得上。
   * ⚠️ 判据是 `tracked === true`（不是 `!== false`）：状态文件里那一格可以缺，
   *    而"从来没勾过"与"勾过又取消"在**能不能点进去**这件事上必须同一个结果
   *    （与 `deriveFolders` 的 `!== true` 是同一条口径的**两面**：它不派生，这里就不给点）。
   */
  const candidates = instances.filter(
    (instance) => instance.tracked === true && instance.gameVersion === gameVersion,
  );

  return (
    <section className="instancepicker" data-instance-candidates={candidates.length}>
      <p className="instancepicker__hint" data-readonly-hint>
        {t('files.pickInstanceHint')}
      </p>
      {/*
        ★★ A8 的第三种空态。
        ⚠️★ `instances.length === 0` 与"这一版没有被追踪的"是**两句话**（见文件头）——
        判据写宽一格（例如 `candidates.length === 0` 一句话兜两档）会把"还没绑启动器"
        的用户指去"去勾一个 1.16.1 的实例"，而他没有那个东西可勾。
      */}
      {candidates.length > 0 ? null : (
        <div className="state state--empty" data-instance-empty="yes">
          <p>
            {instances.length === 0
              ? t('files.pickNoInstances')
              : t('files.pickVersionEmpty', { version: gameVersion })}
          </p>
          <button
            type="button"
            className="cta"
            data-action="go-launchers"
            onClick={onGoToLaunchers}
          >
            {t('files.goLaunchers')}
          </button>
        </div>
      )}
      <ul className="instancepicker__list">
        {candidates.map((instance) => {
          /**
           * ★ 这一格要印的**实例名**。
           *
           * ⚠️★ `InstanceView.name` 与 `key` 的末段在**主进程那一侧**就是同一个字符串
           *    （`listInstances` 按 `<实例目录>\<名>` 枚举出来的）—— 但"同一个事实两处
           *    推导"正是本仓点名的坏味道（§5.15 的同族）。⇒ `instanceKeyParts` 在这里
           *    是**那两半的判据**：名字与 key 的首/末段对不上（坏状态文件、将来有人换了
           *    key 的形状）时**回落**到 key 里那一段（那是 `folderId` 的**同一个来源**，
           *    而 `folderId` 才是下面 `onSelect` 真正发出去的东西）。
           * ⚠️ 回落**不是**"猜一个名字"：两格都是磁盘上的事实，选的是与 key 同源的那一格。
           */
          const parts = instanceKeyParts(instance.key);
          const nameShown = parts.name === '' ? instance.name : parts.name;
          return (
            <li
              className="instancepicker__card"
              key={instance.key}
              /*
               * ⚠️★ 值是 `instance.key` = 派生那条 folder 的 `folderId`：面板拿它去
               * `page.folders.filter(...)` 收窄，两边必须是**同一个字符串**（spec §7）。
               */
              data-instance-card={instance.key}
              data-instance-tracked={instance.tracked ? 'yes' : 'no'}
              /* ⚠️ 待确认（`needsConfirm` 已经是显示值）：卡上也标一次 —— 界面上"这个实例的
                 解析是猜的"这件事在**两层**都看得见（用户在版本层就该知道它要先确认）。 */
              data-instance-needs-confirm={instance.needsConfirm ? 'yes' : 'no'}
            >
              {/* ⚠️ 实例名是磁盘上的内容（启动器给的），原样印、不翻译。 */}
              <span className="instancepicker__name" title={nameShown}>
                {nameShown}
              </span>
              {/* ⚠️ 启动器类型走词条（`files.launcherKind*`），理由见上面那个函数。 */}
              <span className="instancepicker__kind">{t(launcherKindKey(instance.kind))}</span>
              <VersionBadge version={instance.gameVersion} />
              {instance.needsConfirm ? (
                <span className="badge badge--problem">{t('files.instanceNeedsConfirm')}</span>
              ) : null}
              {/* ⚠️ 路径是磁盘上的内容，原样印（不翻译）。`title` 让它单行省略之后还能看全。 */}
              <span className="instancepicker__path" title={instance.modsDir}>
                {instance.modsDir}
              </span>
              <button
                type="button"
                className="cta"
                data-action="open-instance"
                /**
                 * ⚠️★ **不发** `open-instance` 这个动作就不在盘上写任何东西：它只是页面状态
                 * （`selectedInstance`）。⚠️ 之所以不在这里自己 `setSelectedInstance`：切换
                 * **版本**要连带发生（`set-catalog-version`），而那一步只有面板做得到
                 * （它手里才有 `run()`）—— 两处各改一半就是"点了没反应"那一类坏法。
                 */
                onClick={() => {
                  /*
                   * ⚠️★ 这一颗是"进"（版本层里给）；实例层里那颗"返回"走另一个动作
                   *    （`kind: 'close-instance'`，它把 `selectedInstance` 收回 `null`）。
                   */
                  onSelect(instance.key);
                }}
                aria-pressed={selected === instance.key}
              >
                {t('files.openInstance')}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
