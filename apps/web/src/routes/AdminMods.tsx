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
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Notice } from '@/components/Form';
import {
  ApiError,
  deleteTagLabel,
  fetchModCatalog,
  fetchModTags,
  putModTags,
  putTagLabel,
} from '@/lib/api';
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
  const [filter, setFilter] = useState('');
  /** 每个 modid 的人工层**草稿**（只有被碰过的行才有键）—— "改过没有"就是拿它比的。 */
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  /** 正在写的那一个：modid / `'label'` / 标签的 tag（`null` = 没有在写）。 */
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);
  const [newTag, setNewTag] = useState({ tag: '', zh: '', en: '' });

  if (state.status === 'loading' || catalog.state.status === 'loading') {
    return <p className="state">{t('common.loading')}</p>;
  }
  if (state.status === 'error' || catalog.state.status === 'error') {
    const failed =
      state.status === 'error'
        ? state.error
        : catalog.state.status === 'error'
          ? catalog.state.error
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

  return (
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
  );
}
