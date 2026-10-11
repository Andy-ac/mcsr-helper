/**
 * ★★ D1（T8）：「启动器绑定」那一格（spec §4.6 / A7 / A8 / A12 / A14 / A15）。
 *
 * ===========================================================================
 * 这一页是"用户第一次进来要做的事"，也是**唯一**能改解析结果的地方
 * ===========================================================================
 * 用户在这里做的事，决定了后面每一层看到什么：
 *   · **绑一个启动器**（类型 + 根路径）⇒ 主进程枚举出它下面的实例；
 *   · **勾选**一些实例 ⇒ 它们才被扫描 / 判定 / 更新（A9：勾选即触发一次扫描）；
 *   · **看一眼**解析出来的 `mods` / `saves`（探测判不出来时标「待确认」并要用户显式确认）。
 * ⇒ 这一页画不出来，整个 D1 就没法用（后面每一层都是它的下游）。
 *
 * ===========================================================================
 * ⚠️★★ 两条纪律：**只读**（A13）与**不猜**（Global Constraints）
 * ===========================================================================
 *   · 这一页里的每一个动作只写**我们自己那份状态文件**（绑定表 + 每实例的勾选 / 覆盖），
 *     一个字节都不碰启动器或实例的文件（`instance.cfg` / `mmc-pack.json` /
 *     `versions\<名>\<名>.json` 都不动）；
 *   · 路径 / 版本 / loader 读不出来时**留空**，绝不填一个"看起来合理"的默认值
 *     （`CONTRIBUTING.md` 的"别为缺失值填 0"）：`loader` 读不出来就是一个空输入框，
 *     而"待确认"那一格说的是"这个解析是**猜**的"。
 *
 * ===========================================================================
 * ⚠️★ 纯 props 组件（取数在容器 / `useModFolders()` 那一侧）
 * ===========================================================================
 * 与 `ModDownloadPanel` 同一条纪律：`renderToStaticMarkup`（渲染自检）**不跑 effect**
 * ⇒ 取数写在这一层的话，自检永远只能看到空态（那是一类**不可能红**的守卫）。
 * `state` / `detected` / `busy` / `notice` 全部从外面喂。
 *
 * ===========================================================================
 * ⚠️★ 四个支路（顺序即判据的优先级）
 * ===========================================================================
 *   ① `state === null` ⇒ **A15**：这个客户端给不出那份状态（浏览器 / 老桌面壳）
 *      ⇒ 只说"需要在桌面版里绑定"+ 装桌面版的引导，其余一个字节都不画；
 *   ② `state.launchers.length === 0` ⇒ **A8 的第一支空态**（一条绑定都没有）；
 *   ③ `instancesStatus === 'reading'` ⇒ 「正在读取…」（A14：枚举异步）——
 *      ⚠️★ 它**必须排在空态之前**：还在读的时候宣称"一个实例都没勾"是在编结论
 *      （Ruling 65 的同一条纪律：分不清"不知道"与"没有"的读数不许当结论用）；
 *   ④ 有绑定而**一个实例都没被勾** ⇒ **A8 的第二支空态**；
 *   ⑤ 其余 ⇒ 每个绑定的启动器一块 + 底部"添加启动器"。
 *
 * ⚠️★★ ① 那一支在产品里**够不到**（如实记，别读成"浏览器看到的是这一块"）：
 *    `Files.tsx` 在 `useModFolders().status === 'unavailable'` 时整页只画
 *    `ModFoldersUnavailable`（老壳连 tab 都不画，spec §9.12），而这一格只在
 *    `loading` / `failed` / `ready` 三态里画（前两态各有自己的载荷）。
 *    ⇒ 它是**组件契约**上的一支（"给不出状态"这件事长什么样），由渲染自检**直接渲染**
 *    钉住（51e）；A15 的**页面级**那一半由 ㉕ 与 ㊾d/㊾h 钉。
 *    ⚠️ 而它画的**不是第二句"需要桌面版"**：用的是页面那条词条
 *    （`files.partTwoUnavailable`）—— T6 的注释点名过"两处说法会漂"，共用一条词条
 *    就没有两个说法可漂。
 *
 * ===========================================================================
 * ⚠️★ 版本那一格是**显示**（A7 的字面）
 * ===========================================================================
 * 改版本的入口是**实例层文件夹行上那个下拉**（`set-folder-version` ⇒
 * `instancePrefs[key].gameVersion`，T4 的对账已经接上）⇒ 这一页**不许**再放第二个版本
 * 编辑器：两处写同一格必然漂，而漂的表现是"刚改完又变回去"。
 * ⚠️ 同理 `loader` 是**可改的**（它是解析结果的一部分，走 `setInstancePaths` 的
 * `loader` 那一格），别把它也当成显示。
 *
 * ===========================================================================
 * ⚠️★ 路径输入框：受控 + **草稿随生效值重铺**
 * ===========================================================================
 * 初值是 `state.instances[]` 里那一份（**已套用用户覆盖**的生效值）——**不是**探测值，
 * 也不在这一层自己拼（`instancePath + '\.minecraft\mods'` 那种）：两处各存一份必然漂，
 * 而漂的表现是"用户一按保存就把路径改坏"。
 * 提交时**原样送字符串**（不拼分隔符、不 trim —— 归一化在主进程那一侧，T4）；
 * 只送**变过而且非空**的那几格（契约的 `instancePatchOf`：每格必须是非空字符串，
 * 省略 = 不改这一格）⇒ 清空一格今天**表达不了**"交回探测值"（那就留空、不发它）。
 */
import { instanceKeyOf, type LauncherKind } from '@mcsr/shared/launcherInstances';
import type { InstanceView, LauncherBindingView, ModFoldersState } from '@mcsr/shared/modFolders';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DesktopDownload } from '@/components/DesktopDownload';
import { Notice } from '@/components/Form';
import { launcherKindKey } from '@/components/InstancePicker';
import type { ModPageAction, ModPageActionHandler } from '@/components/ModDownloadPanel';
import { type LauncherCandidate, reasonOf } from '@/components/ModFoldersData';
import { VersionBadge } from '@/components/VersionFolderList';

/**
 * 六个启动器类型的**运行时清单**（"手动添加"那个下拉的选项与顺序）。
 *
 * ⚠️★ 为什么这里要再来一份：契约里的 `LauncherKind` 是**类型**，共享内核那份成员表
 *    （`packages/shared/src/modFolders.ts` 的 `LAUNCHER_KINDS`）是**私有**的
 *    ⇒ 界面上"给用户选哪六项"没有现成的数组可读。
 * ⚠️★ 而 `satisfies Record<LauncherKind, true>` 让"类型加了成员、这里漏了"**编译期**就红
 *    （与共享内核那一处是同一个写法、同一条纪律）—— 这一点是这个写法唯一的理由，
 *    ⛔ 别把它改成 `string[]` 或 `readonly LauncherKind[]`（后者**不会**红：
 *    少一个成员照样满足"每个元素都是 LauncherKind"）。
 */
const LAUNCHER_KIND_OPTIONS = Object.keys({
  multimc: true,
  prism: true,
  pcl2: true,
  hmcl: true,
  official: true,
  mcsr: true,
} satisfies Record<LauncherKind, true>) as LauncherKind[];

/**
 * 一条绑定**名下**的实例。
 *
 * ⚠️★ 判据只有一处：`instanceKeyOf(kind, rootPath, instancePath) === instance.key`
 *    —— 它就是 `instance.key` 的**生成函数**（T1 那一份），所以"这个实例属于哪个根"
 *    不在这里重写一遍。自己写 `startsWith(root)` 的现场写在那个函数里：根 `D:\MultiMC`
 *    会把兄弟目录 `D:\MultiMC2\instances\x` 也吞掉。
 * ⚠️★ 前提是"实例的 key 是主进程用同一个函数拼的"（`listInstances` ⇒ `instanceKeyOf`）
 *    —— 两处同源是 spec §7 那条选型的一部分（`folderId` 也用它）。
 */
function instancesOfBinding(
  instances: readonly InstanceView[],
  binding: LauncherBindingView,
): InstanceView[] {
  return instances.filter(
    (instance) =>
      instance.kind === binding.kind &&
      instanceKeyOf(binding.kind, binding.rootPath, instance.instancePath) === instance.key,
  );
}

/** 三个输入框的草稿（受控）—— `base` 是"上一次看到的生效值"，一变就重铺（见文件头）。 */
interface PathDraft {
  modsDir: string;
  savesDir: string;
  loader: string;
}

/**
 * 一个实例那一行：名称 / 版本 / loader / `mods` / `saves` / 勾选框 /（待确认 + 确认）。
 *
 * ⚠️★ 六样来自**同一格** `state.instances[]`（`InstanceView`）：路径与 loader 已经是
 *    "探测 + 用户覆盖"的生效值，`needsConfirm` / `confirmed` 也是 T4 算好的**显示值**
 *    ⇒ 这一层**不重算**任何一条解析规则（重算就是第二份实现，漂起来先是"界面显示 A、
 *    实际按 B 走"，然后才是"点了没反应"）。
 */
function LauncherInstanceRow({
  instance,
  busy,
  run,
}: {
  instance: InstanceView;
  busy: boolean;
  run: ModPageActionHandler;
}) {
  const { t } = useTranslation();
  const effective: PathDraft = {
    modsDir: instance.modsDir,
    savesDir: instance.savesDir,
    loader: instance.loader ?? '',
  };
  const [draft, setDraft] = useState<PathDraft>(effective);
  const [base, setBase] = useState<PathDraft>(effective);
  /*
   * ⚠️★ React 的"props 变了就调状态"那条官方写法（**渲染期** setState）：生效值一变
   *    （用户刚保存完 / 另一个窗口改了 / 重新枚举读到新值）就重铺草稿。
   *    没有它的话，草稿会一直停在挂载那一刻的值 ⇒ 用户看到的是**过期**的路径，
   *    而那正是"两处各存一份必然漂"那条纪律要防的东西。
   */
  if (
    base.modsDir !== effective.modsDir ||
    base.savesDir !== effective.savesDir ||
    base.loader !== effective.loader
  ) {
    setBase(effective);
    setDraft(effective);
  }
  const dirty =
    draft.modsDir !== effective.modsDir ||
    draft.savesDir !== effective.savesDir ||
    draft.loader !== effective.loader;

  /** 只送**变过而且非空**的那几格（契约：省略 = 不改这一格，空串会当场被拒）。 */
  const save = (): void => {
    const patch: { modsDir?: string; savesDir?: string; loader?: string } = {};
    if (draft.modsDir !== effective.modsDir && draft.modsDir !== '') patch.modsDir = draft.modsDir;
    if (draft.savesDir !== effective.savesDir && draft.savesDir !== '') {
      patch.savesDir = draft.savesDir;
    }
    if (draft.loader !== effective.loader && draft.loader !== '') patch.loader = draft.loader;
    if (Object.keys(patch).length === 0) return;
    void run({ kind: 'set-instance-paths', key: instance.key, ...patch });
  };

  return (
    <li className="launcherinst" data-instance-row={instance.key}>
      {/* ⚠️ 实例名是磁盘上的内容（启动器给的），原样印、不翻译；`title` 让省略之后看得全。 */}
      <span className="launcherinst__name" title={instance.name}>
        {instance.name}
      </span>
      {/*
        ⚠️★ 版本那一格是**显示**（A7）—— 改它的入口在实例层文件夹行那个下拉上。
        ⚠️ `VersionBadge` 读不出来时自己画 `files.verdictUnknownVersion`（不编一个版本号）。
      */}
      <span className="launcherinst__version">
        {t('files.instanceFieldVersion')}
        <VersionBadge version={instance.gameVersion} />
      </span>
      <label className="launcherinst__field">
        {t('files.instanceLoaderLabel')}
        <input
          className="launcherinst__input"
          type="text"
          /* ⚠️ 读不出来 ⇒ 空框（**不填一个看起来合理的 loader 串**）；留空 = 不覆盖。 */
          value={draft.loader}
          disabled={busy}
          onChange={(event) => setDraft({ ...draft, loader: event.target.value })}
          data-instance-loader={instance.key}
        />
      </label>
      <label className="launcherinst__field">
        {t('files.instanceFieldMods')}
        <input
          className="launcherinst__input"
          type="text"
          value={draft.modsDir}
          disabled={busy}
          onChange={(event) => setDraft({ ...draft, modsDir: event.target.value })}
          data-instance-mods={instance.key}
          title={instance.modsDir}
        />
      </label>
      <label className="launcherinst__field">
        {t('files.instanceFieldSaves')}
        <input
          className="launcherinst__input"
          type="text"
          value={draft.savesDir}
          disabled={busy}
          onChange={(event) => setDraft({ ...draft, savesDir: event.target.value })}
          data-instance-saves={instance.key}
          title={instance.savesDir}
        />
      </label>
      <button
        type="button"
        className="cta"
        data-action="set-instance-paths"
        /*
         * ⚠️★ 没变过就置灰（"点了什么都不发生"是哑按钮那一类坏法）；
         *    `busy` 时也置灰（与这一页其余按钮同一条）。
         */
        disabled={busy || !dirty}
        onClick={save}
      >
        {t('files.instanceSavePaths')}
      </button>
      {/*
        ★★ 勾选框（A7 的第六样 + A9 的入口）：勾上 ⇒ 主进程**立刻扫一次**这个实例的
        `mods`，它才会出现在"版本 → 实例"那一层里。
        ⚠️★ 它是**受控**的：真值只有一处（`state.instances[].tracked`，主进程那份状态），
        这一层不存第二份 —— 存了就会在"另一个窗口改了 / 动作失败"时把界面留在错的那一档。
        ⚠️ 机器读数是 `<key>`（自检按 `data-instance-tracked="<key>"` 找它、`checked` 是读数）。
      */}
      <label className="launcherinst__track">
        <input
          type="checkbox"
          checked={instance.tracked}
          disabled={busy}
          onChange={(event) =>
            void run({
              kind: 'set-instance-tracked',
              key: instance.key,
              tracked: event.target.checked,
            })
          }
          data-instance-tracked={instance.key}
        />
        {t('files.instanceTrackLabel')}
      </label>
      {/*
        ★★ 待确认标 + **显式确认**（2026-10-11 控制器裁定）。
        ⚠️★ 判据是**一格**：`instance.needsConfirm` —— 它已经是显示值
        （`needsConfirm && !confirmed`，由 `instanceViewsOf` 算好）⇒ 用户点过确认之后
        这一格自己变 `false`，标与按钮**一起**消失。
        ⚠️★ 这一条**必须成对读**（自检 51b 的正反两半）：只画前半条的话，
        "标在任何实例上都画"照样绿 —— 那正是"点了确认、标还在"那一类坏法。
        ⚠️ 而"确认"这个动作有它自己的通道（`confirmInstance(key)`），不是"路径字符串变了
        就算确认过"：用户"看着对、什么都没改"这一种接受**没有落点**，所以要有那颗按钮。
      */}
      {instance.needsConfirm ? (
        <>
          <span className="badge badge--problem" data-instance-needs-confirm={instance.key}>
            {t('files.instanceNeedsConfirm')}
          </span>
          <button
            type="button"
            className="ghostbtn"
            data-action="confirm-instance"
            disabled={busy}
            onClick={() => void run({ kind: 'confirm-instance', key: instance.key })}
          >
            {t('files.instanceConfirmPath')}
          </button>
        </>
      ) : null}
    </li>
  );
}

/**
 * 一个绑定的启动器那一块：类型名 + 根路径（可改）+ 移除 +（读不动时的原话 + 重试）+ 实例。
 *
 * ⚠️★ A14 的判据落在这一块的边界里（自检 51d 按 `data-launcher-block` 切那一段）：
 *    **一个块读不动不影响别的块** —— 那一块画原话 + 一颗重试，别的块照常画自己的实例。
 * ⚠️ 根路径那一格是**受控 + 草稿随生效值重铺**（与实例路径同一条理由）：改根 = 先加新根、
 *    再移除旧绑定（契约里**没有**"改根"这条通道，见 `selectLauncherRoot` 那一段）。
 */
function LauncherBlock({
  binding,
  instances,
  busy,
  run,
}: {
  binding: LauncherBindingView;
  instances: readonly InstanceView[];
  busy: boolean;
  run: ModPageActionHandler;
}) {
  const { t } = useTranslation();
  const [root, setRoot] = useState(binding.rootPath);
  const [base, setBase] = useState(binding.rootPath);
  if (base !== binding.rootPath) {
    setBase(binding.rootPath);
    setRoot(binding.rootPath);
  }

  return (
    <section className="launcherblock" data-launcher-block={binding.id}>
      <h3 className="launcherblock__title">{t(launcherKindKey(binding.kind))}</h3>
      <label className="launcherblock__root">
        {t('files.launcherRootLabel')}
        <input
          className="launcherblock__input"
          type="text"
          value={root}
          disabled={busy}
          onChange={(event) => setRoot(event.target.value)}
          data-launcher-root={binding.id}
          title={binding.rootPath}
        />
      </label>
      <button
        type="button"
        className="ghostbtn"
        data-action="select-launcher-root"
        /* ⚠️ 没改过就置灰；改根是一次真实的写（加新根 + 移除旧绑定），不是空点。 */
        disabled={busy || root === binding.rootPath}
        onClick={() => void run({ kind: 'select-launcher-root', id: binding.id, rootPath: root })}
      >
        {t('files.launcherRootChange')}
      </button>
      <button
        type="button"
        className="ghostbtn"
        data-action="remove-launcher"
        disabled={busy}
        onClick={() => void run({ kind: 'remove-launcher', id: binding.id })}
      >
        {t('files.launcherRemove')}
      </button>
      {/*
        ★★ A14：这一块**读不动**时画那句原话 + 一颗重试。
        ⚠️★ 原话来自主进程（`state.launchers[].error`，带路径），这里**原样印**、不翻译
        也不改写成"出错了"：用户要照着那句话去修盘上的东西。
        ⚠️★ 重试那一颗发的是 `probe-launchers`：它先**重新枚举**一遍（那是唯一会重算
        `error` 的动作 —— `listLauncherInstances()`），再顺手重扫一遍候选。
        ⛔ 只重扫候选是修不好这一块的（症状会是"点了重试、原话还在"）。
      */}
      {binding.error === null ? null : (
        <div className="launcherblock__error" data-launcher-error={binding.id}>
          <Notice kind="bad">{t('files.launcherBlockError', { reason: binding.error })}</Notice>
          <button
            type="button"
            className="ghostbtn"
            data-action="probe-launchers"
            disabled={busy}
            onClick={() => void run({ kind: 'probe-launchers' })}
          >
            {t('files.launcherRetry')}
          </button>
        </div>
      )}
      {/*
        ⚠️★ "这一块一个实例都没有"与"这一块读不动"是**两句话**（Ruling 65 的同一条纪律）：
        读不动时上面已经说了原因，这里再喊一句"还没有读到实例"就是编结论
        ⇒ 那一档一个字都不画（`binding.error !== null` 时这一整段不出现）。
      */}
      {instances.length === 0 ? (
        binding.error === null ? (
          <p className="launcherblock__none" data-launcher-no-instances={binding.id}>
            {t('files.launcherNoInstances')}
          </p>
        ) : null
      ) : (
        <ul className="launcherblock__list">
          {instances.map((instance) => (
            <LauncherInstanceRow key={instance.key} instance={instance} busy={busy} run={run} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * 底部的「添加启动器」：候选（`probeLaunchers()` 的产物，**只列命中的**）+ 手动添加。
 *
 * ⚠️★ "手动添加"**永远在**（spec §6 那条"界面上手动指定根必须一直在"）：探测只扫常见位置，
 *    而 MCSR Launcher 的根是"启动 exe 时的 CWD"（spec §13.1 仍未证的那一条）
 *    ⇒ 一个都没命中时它是**唯一**的出路，命中时它也是"我的装在一个奇怪的地方"的出路。
 * ⚠️ 候选给的是"类型 + 根"（`addLauncher(kind, rootPath)` 的两个入参）——
 *    根路径**原样**送（归一化在主进程入口那一处做）。
 */
function LauncherAdd({
  detected,
  busy,
  run,
}: {
  detected: readonly LauncherCandidate[] | null;
  busy: boolean;
  run: ModPageActionHandler;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<LauncherKind>('multimc');
  const [rootPath, setRootPath] = useState('');

  return (
    <section
      className="launcheradd"
      /*
       * ⚠️★ `detected === null` = "还没探测到 / 那一次探测失败了"（与"真的一个都没有"分开）：
       *    两者在界面上都是"没有候选"，但机器读数必须分得开 —— 断言与刀都靠它。
       */
      data-launcher-probe={detected === null ? 'pending' : String(detected.length)}
    >
      <h3 className="launcheradd__title">{t('files.launcherAddTitle')}</h3>
      {detected === null ? null : detected.length === 0 ? (
        <p className="launcheradd__none" data-launcher-detected="none">
          {t('files.launcherNoCandidates')}
        </p>
      ) : (
        <ul className="launcheradd__list">
          {detected.map((candidate) => (
            <li
              className="launcheradd__row"
              key={`${candidate.kind}:${candidate.rootPath}`}
              data-launcher-candidate={`${candidate.kind}:${candidate.rootPath}`}
            >
              <span className="launcheradd__kind">{t(launcherKindKey(candidate.kind))}</span>
              {/* ⚠️ 路径是磁盘上的内容，原样印（不翻译）；`title` 让省略之后看得全。 */}
              <span className="launcheradd__path" title={candidate.rootPath}>
                {candidate.rootPath}
              </span>
              <button
                type="button"
                className="cta"
                data-action="add-launcher"
                disabled={busy}
                onClick={() =>
                  void run({
                    kind: 'add-launcher',
                    launcherKind: candidate.kind,
                    rootPath: candidate.rootPath,
                  })
                }
              >
                {t('files.launcherAdd')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="launcheradd__manual" data-launcher-manual="yes">
        <label className="launcheradd__field">
          {t('files.launcherKindLabel')}
          <select
            className="filters__select"
            value={kind}
            disabled={busy}
            onChange={(event) => setKind(event.target.value as LauncherKind)}
            data-launcher-kind="manual"
          >
            {LAUNCHER_KIND_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {t(launcherKindKey(option))}
              </option>
            ))}
          </select>
        </label>
        <label className="launcheradd__field">
          {t('files.launcherRootLabel')}
          <input
            className="launcheradd__input"
            type="text"
            value={rootPath}
            disabled={busy}
            onChange={(event) => setRootPath(event.target.value)}
            data-launcher-manual-root="yes"
          />
        </label>
        <button
          type="button"
          className="cta"
          data-action="add-launcher"
          /* ⚠️ 空路径置灰：主进程对空串是**抛**（`rootPath 必须是非空字符串`）。 */
          disabled={busy || rootPath === ''}
          onClick={() => void run({ kind: 'add-launcher', launcherKind: kind, rootPath })}
        >
          {t('files.launcherAdd')}
        </button>
      </div>
    </section>
  );
}

export interface LauncherBindingPanelProps {
  /**
   * 整页那份读数（这一层只读、不取数）。⚠️★ `null` = **这个客户端给不出它**
   * （浏览器 / 老桌面壳那一档 ⇒ A15 的支路），**不是**"还没加载"：
   * `Files.tsx` 在前两种状态下画的是别的载荷（扫描屏 / 失败那句话）。
   */
  state: ModFoldersState | null;
  /**
   * `probeLaunchers()` 的产物（候选）。
   * ⚠️★ `null` = 还没探测到 / 那一次探测失败（与"真的一个都没命中"分开，见 `LauncherAdd`）。
   */
  detected: readonly LauncherCandidate[] | null;
  /** 动作层（只允许经过 `routes/Files.tsx` 的 `makeModPageAction` 那一处接线）。 */
  onAction: ModPageActionHandler;
  /** 「有写盘 / 扫描在跑」那一格（`state.busy`）—— 与这一页其余按钮同一条：忙时置灰。 */
  busy: boolean;
  /**
   * 动作层那一边的失败原话（`useModFolders().actionError`；`null` = 没失败过）。
   * ⚠️ 名字在这一层叫 `notice`（计划钉的 props 名），而它读的就是 `actionError` ——
   * 一处实现，别在页面里再起第二个名字。
   */
  notice?: string | null;
}

export function LauncherBindingPanel({
  state,
  detected,
  onAction,
  busy,
  notice = null,
}: LauncherBindingPanelProps) {
  const { t } = useTranslation();
  /** 这一层自己接住的失败（`onAction` 是页面的接缝，实现换成一个会 reject 的版本时）。 */
  const [localError, setLocalError] = useState<string | null>(null);

  /**
   * 动作层的包装：开跑之前先撤掉上一次那句（它说的是上一次那个动作）。
   * ⚠️ 与 `ModDownloadPanel.run()` 逐字同一条形状 —— 两个来源**只有一个渲染点**
   * （下面那句 `Notice`：`localError ?? notice`）。
   */
  const run = async (action: ModPageAction): Promise<void> => {
    setLocalError(null);
    try {
      await onAction(action);
    } catch (error) {
      setLocalError(reasonOf(error));
    }
  };

  /*
   * ★★ A15（见文件头：这一支在产品里够不到，是**组件契约**上的一支）。
   */
  if (state === null) {
    return (
      <section className="launcherbinding" data-launcher-needs-desktop="yes">
        <Notice kind="info">{t('files.partTwoUnavailable')}</Notice>
        {/* ⚠️ 装桌面版的引导复用页面上那一个组件（它自己在桌面壳里画 `null`）。 */}
        <DesktopDownload />
      </section>
    );
  }

  const failure = localError ?? notice;
  /** 有没有实例被勾着（A8 第二支空态的判据；**不是**过滤条件 —— 没勾的行照旧要画出来）。 */
  const anyTracked = state.instances.some((instance) => instance.tracked === true);

  return (
    <section className="launcherbinding" data-launcher-binding={state.launchers.length}>
      {failure === null ? null : <Notice kind="bad">{failure}</Notice>}
      {/*
        ⚠️★ 两条空态 + "正在读取"，判据的顺序是**承重**的（见文件头第 ③ 条）：
        还在读的时候不能说"一个实例都没勾"（那是编结论）。
      */}
      {state.launchers.length === 0 ? (
        <div className="state state--empty" data-launcher-empty="none">
          <p>{t('files.launcherEmptyNone')}</p>
        </div>
      ) : state.instancesStatus === 'reading' ? (
        <p className="launcherbinding__reading" data-launcher-reading="yes">
          {t('files.launcherReading')}
        </p>
      ) : anyTracked ? null : (
        <div className="state state--empty" data-launcher-empty="untracked">
          <p>{t('files.launcherEmptyUntracked')}</p>
        </div>
      )}
      {state.launchers.map((binding) => (
        <LauncherBlock
          key={binding.id}
          binding={binding}
          instances={instancesOfBinding(state.instances, binding)}
          busy={busy}
          run={run}
        />
      ))}
      <LauncherAdd detected={detected} busy={busy} run={run} />
    </section>
  );
}
