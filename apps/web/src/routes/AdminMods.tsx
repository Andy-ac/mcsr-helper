/**
 * `/admin/mods` —— mod 标签管理（B1）。**只有 `catalog.editTags` 能进来**
 * （侧栏入口已经按能力隐藏；这一页**不重复判权限** —— 能拿到 200 就已经是服务端判过的结果，
 * 照 `routes/ReviewQueue.tsx` 文件头那条纪律）。
 *
 * 三件事让这一页与"改一行就保存"的直觉不同，界面上必须说出来：
 *   · **自动标签**（来自上游 mc.sr 的 list/traits/obsolete）是只读的；
 *   · 保存是**整行替换**这一个 mod 的人工标签（没有乐观锁，后写的赢）；
 *   · 新增一个标签要**先建**它（写入口要求"这个标签已有显示名"）。
 *
 * ===========================================================================
 * ★★ 为什么必须拆成"容器 + 纯视图"（不是一个偏好，是一条硬判据）
 * ===========================================================================
 * 渲染自检（`apps/web/scripts/modtagsrender.tsx`）走的是 `renderToStaticMarkup`,
 * 而它**不跑 effect**（`docs/pending.md §5.73`）⇒ 如果这一页自己取数（`useReview`），
 * 自检拿到的**永远**是"加载中…"那一屏 —— spec §5 的断言 13–16**根本写不出来**
 * （写出来也是恒真的空跑，正是本仓 §5.32 的第 ④ 类）。
 * ⇒ 分工是：容器（`AdminMods`）取数与状态，**这一页要断言的那些 JSX 全部住在纯视图
 *   （`AdminModsView`）里**，它只吃 props、不取数、不持状态。
 * ⚠️ 容器那三个派生值（人工层 / 自动层 / "改过没有"）用的是
 *   `lib/modTagEdits.ts` 的三个纯函数 —— 拆成两半之后，容器内部**没有任何判据**，
 *   而那三个函数是自检**唯一**还能验到它们的地方。别在容器里另写一份。
 * ⚠️ 容器里那段"加载中 / 加载失败"的屏幕**在 props 契约之外**（它是取数态的产物，
 *   自检渲染的纯视图到不了），所以那几行 JSX 留在容器里 —— 这是**唯一**一处例外。
 *
 * ===========================================================================
 * ★★ 下半「整合包」（B2 / Task 7）：同一个容器，第二个纯视图
 * ===========================================================================
 * 这一页因此有**两半**：上半是 B1 的 mod 标签（`AdminModsView`），下半是整合包
 * （`AdminModPacksView`）—— 两半**同一个容器**（同一份目录取数），各自一个纯视图。
 * 下半的三条纪律（都会**静默**出事，所以都写在界面上）：
 *   · `updateModPack` 是**全量替换** ⇒ 每次发**四个字段**：省掉 `description`
 *     会被服务端的 `.default('')` 变成空简介，**不报错**；
 *   · **建 / 改 / 删之后重取列表**（页面立刻反映服务端那一份）；
 *   · 热门开关**只在 `useCan('pack.feature')` 为真时渲染**（那条能力只给了 admin / owner；
 *     reviewer 进得来这一页，看不到那颗开关）。
 */
import {
  buildIndex,
  type ModCatalog,
  type ModIndex,
  rowsForGameVersion,
} from '@mcsr/shared/modCatalog';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Notice } from '@/components/Form';
import {
  ApiError,
  createModPack,
  deleteModPack,
  deleteTagLabel,
  fetchModCatalog,
  fetchModPacks,
  fetchModTags,
  type ModPackWire,
  putModTags,
  putTagLabel,
  setModPackHot,
  updateModPack,
} from '@/lib/api';
import { useCan } from '@/lib/capabilities';
import {
  type PackForm,
  type PackFormSource,
  packFormDirty,
  packFormFrom,
  packVersionOptions,
} from '@/lib/modPackEdits';
import { automaticTagsOf, isDirty, manualTagsOf } from '@/lib/modTagEdits';
import { useReview } from '@/lib/useReview';

/**
 * 纯视图：只吃 props，不取数、不持状态 ⇒ 渲染自检渲染的是它。
 *
 * ⚠️★ **名字与 props 是这个文件与 `scripts/modtagsrender.tsx` 之间的契约**：
 *    自检按它们构造夹具。改这里就要一起改那个脚本（反之亦然）。
 */
export interface AdminModsViewProps {
  /** 标签表：`usedBy` 是"几个 mod 在用"（由容器算好）。 */
  labels: readonly { tag: string; zh: string; en: string; usedBy: number }[];
  /** 目录里的 mod（`tags` 是**生效**标签）。 */
  mods: readonly { modid: string; name: string; tags: readonly string[] }[];
  /** 人工层（含出厂值）—— 可勾的那些。 */
  manualOf: (modid: string) => readonly string[];
  /** 自动层 = 生效 − 人工。 */
  automaticOf: (mod: { modid: string; tags: readonly string[] }) => readonly string[];
  /** "这一行改过没有"（两边都按代码单元序逐元素比）。 */
  dirty: (modid: string) => boolean;
  filter: string;
  onFilter: (value: string) => void;
  onToggle: (modid: string, tag: string) => void;
  onSaveMod: (modid: string) => void;
  newTag: { tag: string; zh: string; en: string };
  onNewTag: (value: { tag: string; zh: string; en: string }) => void;
  onSaveLabel: () => void;
  onDeleteLabel: (tag: string) => void;
  busy: string | null;
  error: string | null;
  okMessage: string | null;
}

export function AdminModsView(props: AdminModsViewProps) {
  const { t, i18n } = useTranslation();

  /** 当前语言那一份显示名；查不到就退回 key（目录里缺失时界面也不该空着）。 */
  const nameOf = (tag: string): string => {
    const label = props.labels.find((item) => item.tag === tag);
    if (!label) return tag;
    return i18n.language === 'zh-CN' ? label.zh : label.en;
  };

  /*
   * 过滤放在**视图**里（而不是容器里预先切片）：props 契约给的是 `mods` + `filter`，
   * 而没有 `filter` 就没法在自检里证"搜索框真的在起作用"。上限 200 行照旧
   * （一个 mod 一行，71 行的真目录用不到它，但夹具与将来的目录可能更大）。
   */
  const needle = props.filter.trim();
  const shown = useMemo(
    () =>
      props.mods
        .filter((mod) => mod.modid.includes(needle) || mod.name.includes(needle))
        .slice(0, 200),
    [props.mods, needle],
  );

  return (
    <>
      <header className="pagehead">
        <h1 className="pagehead__title">{t('adminMods.title')}</h1>
        <p className="pagehead__sub">{t('adminMods.subtitle')}</p>
      </header>

      {props.okMessage ? <Notice kind="ok">{props.okMessage}</Notice> : null}
      {props.error ? <Notice kind="bad">{props.error}</Notice> : null}

      {/* ---------------------------- 标签 ---------------------------- */}
      <section className="modtags">
        <h2 className="pagehead__sub">{t('adminMods.tagsSection')}</h2>
        <p className="muted">{t('adminMods.tagsHint')}</p>

        <table className="admintable">
          <thead>
            <tr>
              <th>{t('adminMods.colTag')}</th>
              <th>{t('adminMods.colZh')}</th>
              <th>{t('adminMods.colEn')}</th>
              <th>{t('adminMods.colUsed')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {props.labels.map((label) => (
              /*
               * ⚠️★ `data-used-by` 是**引用数的专用属性**：引用数原来只能断言
               *    "产物里含 `2`" —— 那是**弱断言**（行号、别的数字、`class="col2"`
               *    里任何一个 `2` 都会让它过）。判据落在专用属性上才咬得住。
               */
              <tr key={label.tag} data-used-by={label.usedBy}>
                <td>
                  <code>{label.tag}</code>
                </td>
                <td>{label.zh}</td>
                <td>{label.en}</td>
                <td>{label.usedBy}</td>
                <td>
                  {/*
                    改名 = 把这一行填进下面的"新增标签"表单（写入口是"新建或改名"，
                    同一个 PUT）—— 这样"改名"与"新增"是**同一条路**，不会漂。
                  */}
                  <button
                    type="button"
                    className="ghostbtn"
                    disabled={props.busy !== null}
                    onClick={() => props.onNewTag({ tag: label.tag, zh: label.zh, en: label.en })}
                  >
                    {t('adminMods.rename')}
                  </button>
                  <button
                    type="button"
                    className="ghostbtn"
                    data-action="delete-tag-label"
                    disabled={props.busy !== null}
                    onClick={() => props.onDeleteLabel(label.tag)}
                  >
                    {t('adminMods.remove')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="adminrow__edit">
          <input
            className="mcsr-field__input"
            value={props.newTag.tag}
            placeholder={t('adminMods.tagKeyPlaceholder')}
            onChange={(e) => props.onNewTag({ ...props.newTag, tag: e.target.value })}
          />
          <input
            className="mcsr-field__input"
            value={props.newTag.zh}
            placeholder={t('adminMods.colZh')}
            onChange={(e) => props.onNewTag({ ...props.newTag, zh: e.target.value })}
          />
          <input
            className="mcsr-field__input"
            value={props.newTag.en}
            placeholder={t('adminMods.colEn')}
            onChange={(e) => props.onNewTag({ ...props.newTag, en: e.target.value })}
          />
          <button
            type="button"
            className="cta"
            data-action="save-tag-label"
            disabled={props.busy !== null}
            onClick={props.onSaveLabel}
          >
            {props.busy === 'label' ? t('adminMods.saving') : t('adminMods.newTag')}
          </button>
        </div>
      </section>

      {/* ------------------------- mod 的标签 ------------------------- */}
      <section className="modtags">
        <h2 className="pagehead__sub">{t('adminMods.modsSection')}</h2>
        <p className="muted">{t('adminMods.modsHint')}</p>
        {/*
          ★ 这句必须画出来：保存是**整行替换**（没有乐观锁）。
          不说的话，两个管理员同时改一个 mod 时，后保存的人会以为自己的改动是"合并"上去的。
        */}
        <p className="muted">{t('adminMods.overwriteHint')}</p>

        <input
          className="mcsr-field__input"
          value={props.filter}
          placeholder={t('adminMods.filterPlaceholder')}
          onChange={(e) => props.onFilter(e.target.value)}
        />

        {shown.length === 0 ? <p className="state">{t('adminMods.empty')}</p> : null}

        <ul className="modtagrows">
          {shown.map((mod) => {
            const manual = props.manualOf(mod.modid);
            const manualSet = new Set(manual);
            const locked = props.automaticOf(mod);
            const lockedSet = new Set(locked);
            /*
             * ★ 可勾的那些 = （标签表 ∪ 这一行的人工层）− 自动层。
             *   · 减去自动层是**结构上**保证两处不重叠：自动标签是只读 chip，
             *     它**不**出现在可勾选区（spec §5 断言 14 的刀正是"把自动标签
             *     也画进可勾选区"）；一个标签在这一行是自动的，把它勾成人工
             *     也不会改变生效值（生效是并集）⇒ 给它一个复选框是纯粹的噪音。
             *   · 并上人工层是为了**不隐藏已经勾上的东西**：万一某个 tag 没有显示名
             *     （宽松 schema 下可能），它也必须照常画成"已勾"，否则管理员会看到
             *     "我的标签不见了"，而保存时它其实还在（只是显示不出来）。
             */
            const candidates = [
              ...new Set([...props.labels.map((label) => label.tag), ...manual]),
            ].filter((tag) => !lockedSet.has(tag));
            const rowDirty = props.dirty(mod.modid);
            const rowBusy = props.busy === mod.modid;

            return (
              <li key={mod.modid} className="modtagrow" data-modid={mod.modid}>
                <div className="modtagrow__head">
                  <code>{mod.modid}</code>
                  <span className="muted">{mod.name}</span>
                </div>

                <div className="modtagrow__auto">
                  <span className="muted">{t('adminMods.autoTags')}</span>
                  {/*
                    ⚠️★ 自动标签是**只读 chip**，不是禁用的复选框：禁用控件在无障碍上
                    与"这一行整块不能动"分不开（spec §3）。`data-locked-tag` 是它
                    出现在只读区的读数。
                  */}
                  {locked.length === 0 ? (
                    <span className="muted">—</span>
                  ) : (
                    locked.map((tag) => (
                      <span key={tag} className="badge" data-locked-tag={tag}>
                        {nameOf(tag)}
                      </span>
                    ))
                  )}
                </div>

                <div className="modtagrow__manual">
                  <span className="muted">{t('adminMods.manualTags')}</span>
                  {candidates.map((tag) => (
                    <label key={tag} className="modtagrow__tag">
                      <input
                        type="checkbox"
                        data-manual-tag={tag}
                        checked={manualSet.has(tag)}
                        onChange={() => props.onToggle(mod.modid, tag)}
                      />
                      <span>{nameOf(tag)}</span>
                    </label>
                  ))}
                </div>

                <div className="modtagrow__save">
                  <span className="muted">
                    {rowDirty ? t('adminMods.changed') : t('adminMods.unchanged')}
                  </span>
                  {/*
                    ⚠️★ `data-dirty` 与 `disabled` 必须由**同一个表达式**（`rowDirty`）决定：
                    渲染自检断言的是 `data-dirty`，它不该与按钮真正的禁用态分叉 ——
                    分叉的那天，"读数说没改过、按钮却能点"不会有任何门禁报警。
                    ⚠️ 判据是"这一行的选择与服务器那一行不同"，**不是**"点过没有"
                    （`isDirty` 两边都按代码单元序逐元素比；勾一下再取消 ⇒ 没改过）。
                  */}
                  <button
                    type="button"
                    className="cta"
                    data-action="save-mod-tags"
                    data-dirty={rowDirty ? 'yes' : 'no'}
                    disabled={!rowDirty || rowBusy}
                    onClick={() => props.onSaveMod(mod.modid)}
                  >
                    {rowBusy ? t('adminMods.saving') : t('adminMods.save')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

/**
 * 新建时的"服务器那一份"**基线**（四格全空）。
 *
 * ★ 它是给 `packFormDirty` 用的另一半：新建那一档没有服务器行可比，喂这份空基线
 *   ⇒ "什么都没填" = 没改过（保存键禁用）、"填了一格" = 改过。
 *   这样两档（新建 / 编辑）走的是**同一个**脏判据，容器里没有第二套规则。
 */
const EMPTY_PACK: PackFormSource = { title: '', description: '', gameVersion: '', modids: [] };

/**
 * 表单里可勾的那些 mod = **当前版本在目录里的那些** ∪ **这一条包已经挂着的那些**。
 *
 * ★ 为什么必须并上"已经挂着的"：`rowsForGameVersion` 只交出"该版本有 release"的 mod，
 *   而服务端判的是"这个 modid 在**目录**里"（`routes/modpacks.ts` 的 `unknownMods`），
 *   与版本无关 ⇒ 一条包完全可能挂着一个"目录里有、但这个版本没 release"的 modid。
 *   只画前者的话，那个 modid 会**看不见却还在包里**（管理员以为清空了它，
 *   下一次保存又把它原样发回去）；反过来，若在切换版本时静默清掉 `modids`，
 *   那就是**删数据**（本仓最忌讳的一类）。并进来之后它至少是看得见、可取消的。
 *   ⚠️ 名字从目录取（取不到就显示 modid 本身）—— 界面不空着，也不猜。
 */
function packCandidateMods(
  index: ModIndex,
  catalog: ModCatalog,
  form: PackForm,
): { modid: string; name: string }[] {
  const rows = rowsForGameVersion(index, form.gameVersion).map((row) => ({
    modid: row.mod.modid,
    name: row.mod.name,
  }));
  const known = new Set(rows.map((row) => row.modid));
  const names = new Map(catalog.mods.map((mod) => [mod.modid, mod.name]));
  const extras = form.modids
    .filter((modid) => !known.has(modid))
    .map((modid) => ({ modid, name: names.get(modid) ?? modid }));
  return [...rows, ...extras];
}

/**
 * 纯视图（**下半**「整合包」）：只吃 props，不取数、不持状态 ⇒ 渲染自检渲染的是它。
 *
 * ⚠️★ 与上半同一条理由（见文件头）：自检走 `renderToStaticMarkup`、**不跑 effect**
 *   ⇒ 取数要是留在渲染路径里，自检拿到的永远是"加载中…"那一屏。
 * ⚠️★ 名字与 props 是这个文件与 `scripts/modtagsrender.tsx` 之间的契约：
 *   自检按它们构造夹具。改这里就要一起改那个脚本（反之亦然）。
 */
export interface AdminModPacksViewProps {
  /** 现有整合包（列表，兼作"服务器上那一份"）。 */
  packs: readonly ModPackWire[];
  /**
   * ★ 热门开关渲染不渲染。容器喂的是 `useCan('pack.feature')` —— 那条能力**只**给了
   * admin / owner ⇒ reviewer 看不到那颗开关（服务端也会 403 兜住）。
   */
  canFeature: boolean;
  /** 表单上正在编辑的是不是"新建"那一档（只影响标题那句文案）。 */
  isNew: boolean;
  /** 表单当前的四格（初值来自 `packFormFrom`）；`null` = 没有打开的表单，不画它。 */
  form: PackForm | null;
  /** 脏判据的另一半：编辑 = 服务器上那一条；新建 = 空基线（见 `EMPTY_PACK`）。 */
  server: PackFormSource;
  /** 版本下拉的候选（容器里走 T7a 的 `packVersionOptions(catalog)`）。 */
  versionOptions: readonly string[];
  /** 可勾的 mod（= 当前版本目录里的 + 这一条包已经挂着的，见 `packCandidateMods`）。 */
  mods: readonly { modid: string; name: string }[];
  modFilter: string;
  onModFilter: (value: string) => void;
  onNew: () => void;
  onEdit: (id: string) => void;
  onCancel: () => void;
  /** 表单的**整份**替换（四格一起）—— 容器里不另写"改哪一格"的逻辑。 */
  onForm: (form: PackForm) => void;
  onSave: () => void;
  onDelete: (id: string) => void;
  onToggleHot: (id: string, hot: boolean) => void;
  busy: string | null;
  error: string | null;
  okMessage: string | null;
}

export function AdminModPacksView(props: AdminModPacksViewProps) {
  const { t } = useTranslation();

  const form = props.form;
  /*
   * ★ 版本候选 = `packVersionOptions(catalog)`，**外加**这条包当前挂着的那一个
   *   （它可能已经不在目录里了）。
   *   ⚠️ 口径与 `ModFoldersData.tsx` 的 `gameVersionOptions` 逐字相同：旧值也要**看得见**，
   *      否则下拉会显示成"另一个版本"（`<select>` 找不到匹配项时浏览器画的是第一项），
   *      而管理员一保存就把版本换成他没有选过的那个。
   *   ⚠️ `packVersionOptions` 只回答"目录里有什么"，补旧值是**调用方**的产品判断
   *      （那句话写在 `modPackEdits.ts` 的文件注释里）。
   */
  const versions =
    form !== null && form.gameVersion !== '' && !props.versionOptions.includes(form.gameVersion)
      ? [form.gameVersion, ...props.versionOptions]
      : props.versionOptions;

  /** ★ 脏判据走 T7a 的纯函数（**不在视图里另写一份**）：`form` 与"服务器那一份"逐格比。 */
  const dirty = form !== null && packFormDirty(form, props.server);

  const needle = props.modFilter.trim();
  /*
   * ⚠️ 这里**不切片**（上半那张 mod 表切在 200 行）：可勾列表里少画一行 =
   *    那个已勾的 mod 变成"看不见却还在包里"。真目录只有 71 个 mod，不切没有代价。
   */
  const shown =
    form === null
      ? []
      : props.mods.filter((mod) => mod.modid.includes(needle) || mod.name.includes(needle));
  const chosen = new Set(form?.modids ?? []);

  return (
    <>
      {props.okMessage ? <Notice kind="ok">{props.okMessage}</Notice> : null}
      {props.error ? <Notice kind="bad">{props.error}</Notice> : null}

      {/* --------------------------- 整合包列表 --------------------------- */}
      <section className="modtags">
        <h2 className="pagehead__sub">{t('adminMods.packsSection')}</h2>
        <p className="muted">{t('adminMods.packsHint')}</p>
        {/*
          ★ 这句必须画出来：保存是**整包替换**（四个字段一起发，没有乐观锁）。
          不说的话，两个管理员同时改一条包时，后保存的人会以为自己的改动是"合并"上去的。
        */}
        <p className="muted">{t('adminMods.packsOverwriteHint')}</p>
        {/* ★ 热门那条能力只给了 admin / owner ⇒ 这一句也只在看得见开关时才有意义。 */}
        {props.canFeature ? <p className="muted">{t('adminMods.packHotHint')}</p> : null}

        <button
          type="button"
          className="cta"
          data-action="new-pack"
          disabled={props.busy !== null}
          onClick={props.onNew}
        >
          {t('adminMods.packNew')}
        </button>

        {props.packs.length === 0 ? <p className="state">{t('adminMods.packEmpty')}</p> : null}

        <table className="admintable">
          <thead>
            <tr>
              <th>{t('adminMods.packColTitle')}</th>
              <th>{t('adminMods.packColVersion')}</th>
              <th>{t('adminMods.packColMods')}</th>
              <th>{t('adminMods.packColHot')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {props.packs.map((pack) => (
              /*
               * ⚠️★ `data-pack-admin-row` 是**这一行的专用属性**（照上半的 `data-used-by`）：
               *    "某一行的标题/版本/mod 数对不对"必须锚在这一行上，
               *    写成"产物里含某个字符串"是弱断言（别的行、别的数字都会让它过）。
               */
              <tr key={pack.id} data-pack-admin-row={pack.id}>
                <td>{pack.title}</td>
                <td>
                  <code>{pack.gameVersion}</code>
                </td>
                {/*
                  ⚠️ `modCount` 是**服务端算的**（`toWire` 的 `pack.modids.length`），
                  页面不自己数 —— 自己数就是同一件事的第二份真相。
                */}
                <td>{pack.modCount}</td>
                <td>
                  {/*
                    ★★ 热门开关**只在 `canFeature` 为真时渲染**（reviewer 看不到它）。
                    ⚠️ 能力判断在**容器**那一层（`useCan` 是权限矩阵的同一份来源），
                    这个纯视图只吃一个布尔量。
                  */}
                  {props.canFeature ? (
                    <input
                      type="checkbox"
                      data-action="toggle-pack-hot"
                      data-pack-hot={pack.id}
                      checked={pack.hot}
                      disabled={props.busy !== null}
                      aria-label={t('adminMods.packHot')}
                      onChange={() => props.onToggleHot(pack.id, !pack.hot)}
                    />
                  ) : (
                    <span className="muted">{pack.hot ? t('adminMods.packHot') : '—'}</span>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className="ghostbtn"
                    data-action="edit-pack"
                    data-pack-id={pack.id}
                    disabled={props.busy !== null}
                    onClick={() => props.onEdit(pack.id)}
                  >
                    {t('adminMods.packEdit')}
                  </button>
                  {/*
                    ⚠️★ 删除**带二次确认**（住在容器里：`window.confirm(t('adminMods.packDeleteConfirm'))`）
                    —— 这一颗按钮不带自己的确认，确认是容器那条路的一部分。
                  */}
                  <button
                    type="button"
                    className="ghostbtn"
                    data-action="delete-pack"
                    data-pack-id={pack.id}
                    disabled={props.busy !== null}
                    onClick={() => props.onDelete(pack.id)}
                  >
                    {t('adminMods.packDelete')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ----------------------------- 表单 ----------------------------- */}
      {/*
        ⚠️ 表单只在**打开了一条**（新建或编辑）时画：它没有"空表单常驻"那一档 ——
        常驻的空表单会让人以为"改这里就等于新建"，而那是一次真的写。
      */}
      {form === null ? null : (
        <section className="modtags" data-pack-form={props.isNew ? 'new' : 'edit'}>
          <h2 className="pagehead__sub">
            {props.isNew ? t('adminMods.packNew') : t('adminMods.packFormEdit')}
          </h2>

          <div className="mcsr-field">
            <label className="mcsr-field__label" htmlFor="pack-title">
              {t('adminMods.packFieldTitle')}
            </label>
            <input
              id="pack-title"
              className="mcsr-field__input"
              data-pack-field="title"
              value={form.title}
              placeholder={t('adminMods.packTitlePlaceholder')}
              onChange={(e) => props.onForm({ ...form, title: e.target.value })}
            />
          </div>

          <div className="mcsr-field">
            <label className="mcsr-field__label" htmlFor="pack-description">
              {t('adminMods.packFieldDescription')}
            </label>
            {/*
              ⚠️★ 这一格是"会被静默清空"的那一格（`updateModPack` 全量替换 + 服务端
              `.default('')`）⇒ 它必须**在表单里看得见**，而且每次保存都要发出去。
              换成"只在填了才发"的写法 = 管理员清不掉它，且另一个人改的会被悄悄覆盖回来。
            */}
            <input
              id="pack-description"
              className="mcsr-field__input"
              data-pack-field="description"
              value={form.description}
              placeholder={t('adminMods.packDescriptionPlaceholder')}
              onChange={(e) => props.onForm({ ...form, description: e.target.value })}
            />
          </div>

          <div className="mcsr-field">
            <label className="mcsr-field__label" htmlFor="pack-game-version">
              {t('adminMods.packFieldVersion')}
            </label>
            {/*
              ⚠️ 换版本时**不动** `modids`：静默清掉它们就是删数据（上面那些
              "已挂但不在这一版候选里"的 mod 仍会画在选择区里，见 `packCandidateMods`）。
            */}
            <select
              id="pack-game-version"
              className="mcsr-field__input"
              data-pack-field="gameVersion"
              value={form.gameVersion}
              onChange={(e) => props.onForm({ ...form, gameVersion: e.target.value })}
            >
              {versions.map((version) => (
                <option key={version} value={version}>
                  {version}
                </option>
              ))}
            </select>
          </div>

          <div className="mcsr-field">
            <span className="mcsr-field__label">{t('adminMods.packFieldMods')}</span>
            <p className="muted" data-pack-chosen={form.modids.length}>
              {t('adminMods.packModsChosen', { n: form.modids.length })}
            </p>
            <input
              className="mcsr-field__input"
              data-pack-field="modFilter"
              value={props.modFilter}
              placeholder={t('adminMods.packModsFilterPlaceholder')}
              onChange={(e) => props.onModFilter(e.target.value)}
            />
            {shown.length === 0 ? <p className="state">{t('adminMods.packModsEmpty')}</p> : null}
            <div className="modtagrow__manual">
              {shown.map((mod) => (
                <label key={mod.modid} className="modtagrow__tag">
                  <input
                    type="checkbox"
                    data-pack-mod={mod.modid}
                    checked={chosen.has(mod.modid)}
                    disabled={props.busy !== null}
                    onChange={() =>
                      props.onForm({
                        ...form,
                        modids: chosen.has(mod.modid)
                          ? form.modids.filter((item) => item !== mod.modid)
                          : [...form.modids, mod.modid],
                      })
                    }
                  />
                  <span>{mod.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="adminrow__edit">
            <span className="muted">
              {dirty ? t('adminMods.changed') : t('adminMods.unchanged')}
            </span>
            {/*
              ⚠️★ `data-dirty` 与 `disabled` 必须由**同一个表达式**（`dirty`）决定：
              自检断言的是 `data-dirty`，它不该与按钮真正的禁用态分叉 ——
              分叉的那天，"读数说没改过、按钮却能点"不会有任何门禁报警。
              ⚠️ 判据是"这份表单与服务器那一份不同"，**不是**"点过没有"
              （`packFormDirty` 逐格比；改一个字再改回来 ⇒ 没改过）。
            */}
            <button
              type="button"
              className="cta"
              data-action="save-pack"
              data-dirty={dirty ? 'yes' : 'no'}
              disabled={!dirty || props.busy !== null}
              onClick={props.onSave}
            >
              {props.busy === 'form' ? t('adminMods.saving') : t('adminMods.packSave')}
            </button>
            <button
              type="button"
              className="ghostbtn"
              data-action="cancel-pack"
              disabled={props.busy !== null}
              onClick={props.onCancel}
            >
              {t('adminMods.packCancel')}
            </button>
          </div>
        </section>
      )}
    </>
  );
}

/**
 * 容器：取数 + 状态 + 事件，最后 `return <AdminModsView {...} />`。
 *
 * ⚠️★ 两次 `useReview`：一次取**标签层**（`GET /api/mod-tags`，只有 DB 那一层），
 *    一次取**目录**（`GET /api/mod-catalog`，含生效标签 + 出厂值 + 显示名）。
 *    浏览器里没有"桌面端推来的目录"（`/files` 那一页有，这一页没有）
 *    ⇒ 这一页必须自己取一次（见 `lib/api.ts` 的 `fetchModCatalog`）。
 */
export function AdminMods() {
  const { t } = useTranslation();
  const { state, reload } = useReview((signal) => fetchModTags(signal), []);
  /** 目录（生效标签 + `manualTags` 出厂值 + `tagLabels`）—— 只在浏览器里自己取一次。 */
  const catalog = useReview((signal) => fetchModCatalog(signal), []);
  /*
   * ★ 下半（整合包）的取数：整包清单。
   *
   * ⚠️★ `fetchModPacks('')` 的**空串是刻意的**：服务端 `routes/modpacks.ts` 是
   *    `gameVersion === undefined || gameVersion === '' ? {} : { gameVersion }`
   *    ⇒ 空串 = **不过滤**（管理页要的是全部版本，不是某一版）。
   *    这里没有第二条路：`fetchModPacks` 的签名要求一个版本，而 `lib/**` 不在本任务的改动范围里；
   *    空串在服务端那一侧有**明确**语义（不是"恰好也能用"）。
   */
  const packs = useReview((signal) => fetchModPacks('', signal), []);
  /**
   * ★★ 热门开关的渲染判据（`pack.feature` **只**给了 admin / owner）。
   * ⚠️ 能力判断住在**容器**这一层（`useCan` 是权限矩阵的同一份来源），纯视图只吃一个布尔量。
   * 服务端那条端点（`PATCH /api/admin/modpacks/:id/hot`）会再判一次 —— 界面骗不过去。
   */
  const canFeature = useCan('pack.feature');
  const [filter, setFilter] = useState('');
  /** 每个 modid 的人工层**草稿**（只有被碰过的行才有键）—— "改过没有"就是拿它比的。 */
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  /** 正在写的那一个：modid / `'label'` / 标签的 tag（`null` = 没有在写）。 */
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);
  const [newTag, setNewTag] = useState({ tag: '', zh: '', en: '' });
  /** ★ 下半：打开的是哪一档（`null` = 没有打开的表单）。 */
  const [open, setOpen] = useState<{ kind: 'new' } | { kind: 'edit'; id: string } | null>(null);
  /** 表单那四格的**草稿**（`null` = 还没碰过，届时时从 `packFormFrom` 现算 —— 见下面）。 */
  const [packForm, setPackForm] = useState<PackForm | null>(null);
  const [packFilter, setPackFilter] = useState('');
  /**
   * ★ 下半的写状态 / 提示**与上半分开**（`'form'` / `'delete'` / `'hot'`）：
   *   共用一份的话，改标签失败的提示会出现在整合包那一节旁边（反过来也一样）。
   */
  const [packBusy, setPackBusy] = useState<string | null>(null);
  const [packError, setPackError] = useState<string | null>(null);
  const [packOk, setPackOk] = useState<string | null>(null);

  if (
    state.status === 'loading' ||
    catalog.state.status === 'loading' ||
    packs.state.status === 'loading'
  ) {
    return <p className="state">{t('common.loading')}</p>;
  }
  if (
    state.status === 'error' ||
    catalog.state.status === 'error' ||
    packs.state.status === 'error'
  ) {
    const failed =
      state.status === 'error'
        ? state.error
        : catalog.state.status === 'error'
          ? catalog.state.error
          : packs.state.status === 'error'
            ? packs.state.error
            : undefined;
    return (
      <>
        <header className="pagehead">
          <h1 className="pagehead__title">{t('adminMods.title')}</h1>
        </header>
        {/*
          ⚠️★ 读那条路的 `ApiError.code` **恒为 undefined**（spec §2 D8 那条现读的坑：
          `request<T>()` 传的是 `readErrorCode=false`）⇒ 读失败只能**按 status 分文案**。
          照 `AdminUsers` 那样只按 `code` 分的话，403 会一路掉进兜底那句"加载失败"——
          而没有权限的人看到的应该是"你没有这个权限"。
        */}
        <Notice kind="bad">
          {failed instanceof ApiError && failed.status === 403
            ? t('adminMods.forbidden')
            : t('adminMods.loadFailed')}
        </Notice>
      </>
    );
  }

  const assignments = state.data.assignments;
  const manualTags = catalog.state.data.manualTags;
  const mods = catalog.state.data.mods.map((mod) => ({
    modid: mod.modid,
    name: mod.name,
    tags: mod.tags,
  }));

  /**
   * 标签表 —— `usedBy` = "几个 mod 的**生效标签**里有它"（spec §3 的"用了几处"）。
   * ⚠️ 按 tag 的代码单元序排：目录里 `tagLabels` 的顺序是插进去的顺序，
   *    不排序的话同一份数据在不同渲染里顺序可能不同。
   */
  const labels = Object.entries(catalog.state.data.tagLabels)
    .map(([tag, label]) => ({
      tag,
      zh: label.zh,
      en: label.en,
      usedBy: mods.filter((mod) => mod.tags.includes(tag)).length,
    }))
    .sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  /**
   * ★★ 人工层的**取值规则只有一条**（B1 spec §2 D2，与 `mergeModTagLayer` 逐字同源）：
   *      `人工 = draft[modid] ?? DB 那一行 ?? 目录.manualTags[modid] ?? []`
   *   它住在 `lib/modTagEdits.ts` 的 `manualTagsOf` 里 —— 自检直接断言那个函数
   *   （容器在 `renderToStaticMarkup` 下渲染不出来，所以**不能**在容器里另写一份）。
   *   ⚠️★ 少了最后那一格就是一个会静默删数据的缺陷：文件来的出厂值（例如
   *      `mcsrranked` 的 `ranked`）会被显示成"没勾"，而管理员一保存就写下一行不含它的
   *      DB 记录 ⇒ 那个标签**真的没了**，且没有任何报错。
   */
  const manualOf = (modid: string): readonly string[] =>
    manualTagsOf({ modid, draft, assignments, manualTags });

  /**
   * "服务器上那一行" = 同一个规则，**喂一份空 draft**。
   * ⚠️ 特意复用 `manualTagsOf` 而不是在这里再写一遍 `assignments[modid] ?? manualTags…`：
   *    那份回落链是**会删数据**的那一格，本文件里不许有它的第二份抄写。
   */
  const serverOf = (modid: string): readonly string[] =>
    manualTagsOf({ modid, draft: {}, assignments, manualTags });

  /** ★ 自动层 = **生效标签 − 人工层**（spec §2 D8）—— 纯函数同上。 */
  const automaticOf = (mod: { modid: string; tags: readonly string[] }): readonly string[] =>
    automaticTagsOf({ tags: mod.tags, manual: manualOf(mod.modid) });

  const dirty = (modid: string): boolean =>
    isDirty({ draft: draft[modid], server: serverOf(modid) });

  /**
   * 勾 / 取消勾一个标签。
   *
   * ⚠️★ 起点必须是 `manualOf(modid)`（含出厂值），**不是** `draft[modid] ?? []`：
   *    后者在"这一行还没被碰过"时是空数组 ⇒ 勾第一个标签就等于把文件来的
   *    出厂标签**从草稿里抹掉**，保存下去就是一次静默删除。
   */
  function toggle(modid: string, tag: string): void {
    setDraft((prev) => {
      const current = manualTagsOf({ modid, draft: prev, assignments, manualTags });
      const next = current.includes(tag)
        ? current.filter((item) => item !== tag)
        : [...current, tag];
      return { ...prev, [modid]: next };
    });
  }

  async function saveMod(modid: string): Promise<void> {
    // ⚠️ 取的是 `manualOf`（含出厂值），不是 draft —— 见上面那条注释。
    const tags = [...manualOf(modid)];
    setBusy(modid);
    setError(null);
    setOkMessage(null);
    try {
      await putModTags(modid, tags);
      setOkMessage(t('adminMods.saved'));
      // ⚠️ 保存之后要**丢掉这一行的 draft**，否则"改过没有"会一直显示"改过"
      setDraft((prev) => {
        const next = { ...prev };
        delete next[modid];
        return next;
      });
      reload();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      setError(
        code === 'invalid_input'
          ? (err as ApiError).reason === 'unknown_tag'
            ? t('adminMods.errUnknownTag')
            : t('adminMods.errTooMany')
          : t('adminMods.errFailed'),
      );
    } finally {
      setBusy(null);
    }
  }

  async function saveLabel(): Promise<void> {
    setBusy('label');
    setError(null);
    setOkMessage(null);
    try {
      await putTagLabel(newTag.tag.trim(), newTag.zh.trim(), newTag.en.trim());
      setNewTag({ tag: '', zh: '', en: '' });
      setOkMessage(t('adminMods.saved'));
      reload();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      setError(code === 'invalid_input' ? t('adminMods.errTagKey') : t('adminMods.errFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function removeLabel(tag: string): Promise<void> {
    if (!window.confirm(t('adminMods.deleteConfirm'))) return;
    setBusy(tag);
    setError(null);
    setOkMessage(null);
    try {
      await deleteTagLabel(tag);
      setOkMessage(t('adminMods.saved'));
      reload();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      /*
       * ⚠️ 这里是**写路径** ⇒ `sendJson` 会读错误体，`err.code` 有值
       *    （读路径没有，见上面那段 403 的注释与 B1 spec §2 D8）。
       */
      setError(code === 'tag_in_use' ? t('adminMods.errTagInUse') : t('adminMods.errFailed'));
    } finally {
      setBusy(null);
    }
  }

  // -------------------------------------------------------------------------
  // 下半：整合包（B2 / Task 7）
  // -------------------------------------------------------------------------

  const packItems = packs.state.data.items;
  /** ★ 版本候选走 T7a 的纯函数（**不在这里另写一份**）—— 自检直接断言那个函数。 */
  const versionOptions = packVersionOptions(catalog.state.data);
  /** 目录索引（`packCandidateMods` 要它去查"这一版有哪些 mod"）。 */
  const packIndex = buildIndex(catalog.state.data);
  const opened = open;
  const serverPack =
    opened?.kind === 'edit' ? (packItems.find((pack) => pack.id === opened.id) ?? null) : null;
  /**
   * 表单 = 草稿（`packForm`）?? 由**打开的那一条**现算。
   *
   * ★ 初值一律走 `packFormFrom`（纯函数）：新建那一档喂一份**空基线** + 版本下拉的第一项，
   *   编辑那一档喂服务器上那一条。
   * ⚠️ 那条包若已经被别人删掉（`serverPack === null`）⇒ 这里给 `null`、界面不画表单 ——
   *   画一个"看起来是那一条"的空表单，点保存就会新建出一条同名空包（或改坏了别的）。
   */
  const packFormNow: PackForm | null =
    packForm ??
    (opened === null
      ? null
      : opened.kind === 'new'
        ? packFormFrom({ ...EMPTY_PACK, gameVersion: versionOptions[0] ?? '' })
        : serverPack === null
          ? null
          : packFormFrom(serverPack));
  /** ★ 脏判据的另一半：编辑 = 服务器上那一条；新建 = 空基线（见 `EMPTY_PACK`）。 */
  const serverOfPack: PackFormSource = serverPack ?? EMPTY_PACK;
  const packMods =
    packFormNow === null ? [] : packCandidateMods(packIndex, catalog.state.data, packFormNow);

  /** ★ 写路径的失败文案：按 `err.code` 分（**写路径**的 `code` 有值，见上面那段注释）。 */
  function packErrorText(err: unknown): string {
    const code = err instanceof ApiError ? err.code : undefined;
    if (code === 'invalid_input') {
      return err instanceof ApiError && err.reason === 'unknown_mod'
        ? t('adminMods.packErrUnknownMod')
        : t('adminMods.packErrInvalid');
    }
    if (code === 'not_found') return t('adminMods.packErrNotFound');
    if (code === 'catalog_unavailable') return t('adminMods.packErrCatalog');
    if (code === 'forbidden') return t('adminMods.packForbidden');
    return t('adminMods.packErrFailed');
  }

  function openNew(): void {
    setPackForm(null);
    setOpen({ kind: 'new' });
    setPackFilter('');
    setPackError(null);
    setPackOk(null);
  }

  function openEdit(id: string): void {
    setPackForm(null);
    setOpen({ kind: 'edit', id });
    setPackFilter('');
    setPackError(null);
    setPackOk(null);
  }

  function cancelForm(): void {
    setPackForm(null);
    setOpen(null);
    setPackError(null);
  }

  /**
   * 保存（建 / 改）。
   *
   * ⚠️★ **四个字段一起发**：`PATCH /api/modpacks/:id` 是**全量替换**（服务端收
   *    `packInputSchema` 的完整入参）⇒ 少发 `description` 会被服务端的 `.default('')`
   *    变成**空简介**，而且**不报错**。这里把四格**逐格写出来**，不用 `{ ...form }`
   *    那种"顺手带上别的"的写法（表单今天正好四格，但那是巧合，不是契约）。
   * ⚠️★ 建 / 改成功之后 `packs.reload()`：列表要立刻反映服务端那一份。
   */
  async function savePack(): Promise<void> {
    if (packFormNow === null || opened === null) return;
    if (!window.confirm(t('adminMods.packSaveConfirm'))) return;
    const payload = {
      title: packFormNow.title,
      description: packFormNow.description,
      gameVersion: packFormNow.gameVersion,
      modids: packFormNow.modids,
    };
    setPackBusy('form');
    setPackError(null);
    setPackOk(null);
    try {
      if (opened.kind === 'new') await createModPack(payload);
      else await updateModPack(opened.id, payload);
      setPackOk(t('adminMods.packSaved'));
      setPackForm(null);
      setOpen(null);
      packs.reload();
    } catch (err) {
      setPackError(packErrorText(err));
    } finally {
      setPackBusy(null);
    }
  }

  /** 删除（`pack.manage`）—— ⚠️★ 二次确认在**这里**（视图那颗按钮不带自己的确认）。 */
  async function removePack(id: string): Promise<void> {
    if (!window.confirm(t('adminMods.packDeleteConfirm'))) return;
    setPackBusy('delete');
    setPackError(null);
    setPackOk(null);
    try {
      await deleteModPack(id);
      setPackOk(t('adminMods.packDeleted'));
      // 删掉的正是表单里那一条 ⇒ 把表单收起来（不能让保存键留在一个已不存在的 id 上）
      if (opened?.kind === 'edit' && opened.id === id) {
        setPackForm(null);
        setOpen(null);
      }
      packs.reload();
    } catch (err) {
      setPackError(packErrorText(err));
    } finally {
      setPackBusy(null);
    }
  }

  /** 热门（`pack.feature`，**只**给 admin / owner）—— 改完也要重取列表。 */
  async function featurePack(id: string, hot: boolean): Promise<void> {
    setPackBusy('hot');
    setPackError(null);
    setPackOk(null);
    try {
      await setModPackHot(id, hot);
      setPackOk(t('adminMods.packSaved'));
      packs.reload();
    } catch (err) {
      setPackError(packErrorText(err));
    } finally {
      setPackBusy(null);
    }
  }

  return (
    <>
      <AdminModsView
        labels={labels}
        mods={mods}
        manualOf={manualOf}
        automaticOf={automaticOf}
        dirty={dirty}
        filter={filter}
        onFilter={setFilter}
        onToggle={toggle}
        onSaveMod={(modid) => void saveMod(modid)}
        newTag={newTag}
        onNewTag={setNewTag}
        onSaveLabel={() => void saveLabel()}
        onDeleteLabel={(tag) => void removeLabel(tag)}
        busy={busy}
        error={error}
        okMessage={okMessage}
      />
      <AdminModPacksView
        packs={packItems}
        canFeature={canFeature}
        isNew={opened?.kind === 'new'}
        form={packFormNow}
        server={serverOfPack}
        versionOptions={versionOptions}
        mods={packMods}
        modFilter={packFilter}
        onModFilter={setPackFilter}
        onNew={openNew}
        onEdit={openEdit}
        onCancel={cancelForm}
        onForm={setPackForm}
        onSave={() => void savePack()}
        onDelete={(id) => void removePack(id)}
        onToggleHot={(id, hot) => void featurePack(id, hot)}
        busy={packBusy}
        error={packError}
        okMessage={packOk}
      />
    </>
  );
}
