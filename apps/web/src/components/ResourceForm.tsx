import { LOCALES, RESOURCE_KINDS } from '@mcsr/shared';
import type { ResourceDetail, ResourceSubmission } from '@mcsr/shared/resources';
import {
  IMAGE_MAX_BYTES,
  NOTE_MAX,
  ResourceSubmissionSchema,
  TAGS_MAX,
} from '@mcsr/shared/resources';
import { type ChangeEvent, type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from '@/components/Form';
import { Markdown } from '@/components/Markdown';
import { ApiError, fetchTags, uploadImage } from '@/lib/api';
// ⚠️ 类型名走**唯一一份**映射（见 resourceKind.ts 的文件头）——
//    这里以前自己拼 key，于是加了第三种 kind 之后这个下拉框会把它显示成「工具」。
import { resourceKindLabel } from '@/lib/resourceKind';
import { useAsync } from '@/lib/useAsync';

/**
 * 资源库条目的提交表单。**新建和编辑共用一份**。
 *
 * 为什么共用一个组件而不是两个页面各写一遍：两者的字段完全相同，
 * 差别只有"提交到哪"。抄成两份之后，加一个字段就要记得改两处，
 * 而漏改的后果是"编辑时填的字段被静默丢掉" —— 用户以为保存成功了，
 * 刷新之后那个字段又空了，而且没有任何报错。
 */

/** 表单内部状态。提交时才转成 ResourceSubmission。 */
export interface ResourceDraft {
  kind: string;
  title: string;
  titleEn: string;
  url: string;
  imageUrl: string;
  summary: string;
  body: string;
  lang: string;
  tags: string[];
}

export function emptyDraft(): ResourceDraft {
  return {
    kind: RESOURCE_KINDS[0],
    title: '',
    titleEn: '',
    url: '',
    imageUrl: '',
    summary: '',
    body: '',
    lang: LOCALES[0],
    tags: [],
  };
}

/** 已有条目 → 草稿。编辑页用它预填。 */
export function draftFromResource(r: ResourceDetail): ResourceDraft {
  return {
    kind: r.kind,
    title: r.title,
    titleEn: r.titleEn ?? '',
    url: r.url,
    imageUrl: r.imageUrl ?? '',
    summary: r.summary ?? '',
    body: r.body,
    lang: r.lang,
    tags: r.tags,
  };
}

// ---------------------------------------------------------------------------
// 标签选择
// ---------------------------------------------------------------------------

/**
 * 标签输入。
 *
 * 三件事同时存在：**已选**（点一下去掉）、**现成的**（点一下加上，来自库里
 * 已有的标签）、**自己写**（回车或逗号加上）。
 *
 * 为什么必须给"现成的"这一栏：标签的价值全在**一致性**上。
 * 让每个人自己敲的话，`ranked` / `Ranked` / `排行榜` / `rank` 会同时存在，
 * 而标签筛选是按字符串精确匹配的 —— 标签一乱，筛选就等于废了。
 * 已经沉淀下来的标签是唯一可用的参考。
 */
function TagPicker({
  selected,
  onChange,
  suggestions,
}: {
  selected: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');

  function add(raw: string) {
    // 和后端 normalizeResourceInput 保持一致：小写、去重、不超上限。
    // 这里先做一遍只是为了让用户立刻看到结果；**真正的规范化在服务端**。
    const value = raw.trim().toLowerCase();
    if (!value) return;
    if (selected.includes(value)) return;
    if (selected.length >= TAGS_MAX) return;
    onChange([...selected, value].sort());
  }

  function remove(tag: string) {
    onChange(selected.filter((x) => x !== tag));
  }

  const remaining = suggestions.filter((s) => !selected.includes(s));

  return (
    <div className="mcsr-field">
      <span className="mcsr-field__label">{t('submit.tags')}</span>

      {selected.length > 0 ? (
        <div className="tagpicker__row">
          {selected.map((tag) => (
            <button
              key={tag}
              type="button"
              className="tagchip tagchip--on"
              onClick={() => remove(tag)}
              title={t('submit.tagRemove')}
            >
              {tag} ×
            </button>
          ))}
        </div>
      ) : null}

      <div className="tagpicker__input">
        <input
          id="sub-tag-input"
          className="mcsr-field__input mcsr-field__input--prose"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // 回车和逗号都能加：中文输入法下用户很自然会打逗号
            if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
              e.preventDefault();
              add(draft);
              setDraft('');
            }
          }}
          placeholder={t('submit.tagsPlaceholder')}
          maxLength={32}
        />
        <button
          type="button"
          className="ghostbtn"
          onClick={() => {
            add(draft);
            setDraft('');
          }}
        >
          {t('submit.tagAdd')}
        </button>
      </div>

      {remaining.length > 0 ? (
        <>
          <p className="mcsr-field__hint">{t('submit.tagExistingHint')}</p>
          <div className="tagpicker__row">
            {remaining.slice(0, 24).map((tag) => (
              <button
                key={tag}
                type="button"
                className="tagchip"
                onClick={() => add(tag)}
                disabled={selected.length >= TAGS_MAX}
              >
                {tag}
              </button>
            ))}
          </div>
        </>
      ) : null}

      <p className="mcsr-field__hint">{t('submit.hintTags', { max: TAGS_MAX })}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 配图
// ---------------------------------------------------------------------------

/**
 * 配图：本地上传**或**填链接。
 *
 * 保留"填链接"是有意的 —— 有些站点自己就提供了一张合适的图，
 * 强制上传等于让用户先下载再上传一遍。
 */
function ImagePicker({
  value,
  onChange,
  onError,
}: {
  value: string;
  onChange: (url: string) => void;
  onError: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // 选完就把 input 清空：否则同一个文件选第二次不会再触发 change 事件
    event.target.value = '';
    if (!file) return;

    onError(null);
    if (file.size > IMAGE_MAX_BYTES) {
      onError(t('submit.errImageTooLarge', { mb: Math.round(IMAGE_MAX_BYTES / 1024 / 1024) }));
      return;
    }

    setBusy(true);
    try {
      const result = await uploadImage(file);
      onChange(result.url);
    } catch (error) {
      // 服务端的拒绝理由是具体的（太大 / 不是图片），照原样映射出来
      const code = error instanceof ApiError ? error.code : undefined;
      onError(
        code === 'too_large'
          ? t('submit.errImageTooLarge', { mb: Math.round(IMAGE_MAX_BYTES / 1024 / 1024) })
          : code === 'not_an_image'
            ? t('submit.errImageType')
            : t('submit.errImageFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mcsr-field">
      <span className="mcsr-field__label">{t('submit.imageUrl')}</span>

      <div className="imagepicker">
        {value ? (
          <img className="imagepicker__preview" src={value} alt="" />
        ) : (
          <span className="imagepicker__empty" aria-hidden="true">
            ?
          </span>
        )}

        <div className="imagepicker__side">
          <label className="ghostbtn imagepicker__upload">
            {busy ? t('submit.imageUploading') : t('submit.imageUpload')}
            <input type="file" accept="image/*" onChange={pick} disabled={busy} hidden />
          </label>

          <input
            className="mcsr-field__input mcsr-field__input--prose"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t('submit.imagePlaceholder')}
          />

          {value ? (
            <button type="button" className="authform__link" onClick={() => onChange('')}>
              {t('submit.imageClear')}
            </button>
          ) : null}
        </div>
      </div>

      <p className="mcsr-field__hint">
        {t('submit.hintImage', { mb: Math.round(IMAGE_MAX_BYTES / 1024 / 1024) })}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 表单
// ---------------------------------------------------------------------------

export function ResourceForm({
  initial,
  actionLabel,
  busyLabel,
  busy,
  serverError,
  onSubmit,
  secondaryAction,
}: {
  initial: ResourceDraft;
  actionLabel: string;
  busyLabel: string;
  busy: boolean;
  /** 来自服务端的错误（网络、409、403…）：页面负责渲染成提示条 */
  serverError: string | null;
  onSubmit: (submission: ResourceSubmission) => void;
  /**
   * 「直接保存」/「直接发布」（需求②）—— 只有**有 `content.author` 的人**、
   * 或者**这一条的贡献者**看得到（页面按服务端给的 `canDirectEdit` 决定传不传）。
   *
   * ⚠️ 做成一个可选 action 而不是两个平级 prop：调用方要么整块给、要么整块不给，
   *    不会出现"传了 label 忘了传 onSubmit"这种半截状态。
   * ⚠️ 它的存在与否**由页面按能力决定**，表单自己不判断角色 —— 表单里写一份
   *    "谁是编辑"就是第二份规则（见 `permissions.ts` 的头注释）。
   *
   * ⚠️★ `title` **必填**，理由是这个按钮现在对**两种人**出现，而他们该读到的话不一样：
   *    · `content.author`（editor / admin / owner）—— 那是**全站身份**，
   *      `authoring.directHint`（"你是内容编辑…"）说的是实话；
   *    · **这一条的贡献者** —— 他不是编辑（用户明确「贡献者不单独作为一个身份组」），
   *      `resourceContrib.directEdit`（"你是**这一条**的贡献者…"）才是实话。
   *
   *    这里原来写死 `t('authoring.directHint')`（那时只有编辑看得到这个按钮）。
   *    判据改成 `canDirectEdit` 之后，贡献者也会看到它 —— 而他会读到
   *    「**你是内容编辑**」，也就是这**唯一**解释"为什么我点了就生效"的地方
   *    在对他撒谎，且恰好撒在"别让他以为自己对全站有直编权"这个要害上。
   *    ⇒ 写成必填之后，将来多一个调用方就会**编译报错**，逼他回答"这是哪种人"。
   */
  secondaryAction?: {
    label: string;
    busyLabel: string;
    /**
     * 按钮上的原生 tooltip —— **已经剥好 `**` 标记**的纯字符串。
     *
     * ⚠️ 剥标记这一步在**调用方**（页面里写 `emText(t('…'))`），不在这里：
     *    这里剥的话，调用点源码里看到的就是一个**裸** `t('带星号的键')`，
     *    而 `services/api/src/i18n-keys.test.ts` 那条守卫按**紧贴调用点的形状**判定
     *    ⇒ 它会把这三处报成 `unsafe`，逼人去写三条"其实安全"的豁免。
     *    在调用点剥，它们就是 `emText` 形状，守卫**自动**认，一分白名单都不用加
     *    （`emText` 的签名本来也是"给字符串上下文用"，见 `Emphasis.tsx` 的文件头）。
     *    ⚠️ 忘了剥不会静默：守卫当场报一个新的 `unsafe` 调用点。
     */
    title: string;
    onSubmit: (s: ResourceSubmission) => void;
  };
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ResourceDraft>(initial);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [imageError, setImageError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  // 库里已有的标签。公开接口，未登录也能读，所以不用担心权限。
  const tagsState = useAsync((signal) => fetchTags(signal), []);
  const suggestions = tagsState.status === 'ok' ? tagsState.data.tags.map((x) => x.tag) : [];

  function set<K extends keyof ResourceDraft>(key: K, value: ResourceDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const data = buildSubmission();
    if (data) onSubmit(data);
  }

  /**
   * 「直接保存」（需求②）—— 同一个表单、**同一份校验**，只是提交到另一条路。
   *
   * ⚠️ 它复用 `buildSubmission()` 而不是自己再校验一遍：两条路各自校验的话，
   *    迟早出现"提审能过、直编报错"（或反过来）的分叉，而用户看到的是
   *    "同一个表单，换个按钮就说我填错了"。
   */
  function submitDirect() {
    const data = buildSubmission();
    if (data && secondaryAction) secondaryAction.onSubmit(data);
  }

  /**
   * 校验并整理出提交体。**两条提交路径共用这一处**（见 `submitDirect`）。
   * 返回 `null` = 校验没过（错误已经写进 `errors`，调用方什么都不用做）。
   */
  function buildSubmission(): ResourceSubmission | null {
    /*
     * ⚠️ 用**共享 schema** 校验，而不是在界面里手写一遍规则。
     *
     * 手写一份的后果是两边慢慢分叉：界面放行了服务端会拒的内容（用户填完
     * 才被拒，白填一遍），或者界面拦下了服务端允许的内容（用户根本提交不了，
     * 而且不知道为什么）。这里直接用同一份定义，不可能不一致。
     */
    const candidate = {
      kind: draft.kind,
      title: draft.title.trim(),
      titleEn: draft.titleEn.trim() || null,
      url: draft.url.trim(),
      imageUrl: draft.imageUrl.trim() || null,
      summary: draft.summary.trim() || null,
      body: draft.body,
      lang: draft.lang,
      tags: draft.tags,
      note: note.trim() || null,
    };

    const parsed = ResourceSubmissionSchema.safeParse(candidate);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? '');
        // 每个字段只留第一条：同一条规则可能报多条，叠在一起反而看不清
        if (field && !next[field]) next[field] = issue.message;
      }
      setErrors(next);
      return null;
    }

    setErrors({});
    return parsed.data;
  }

  const fieldError = (key: string) =>
    errors[key] ? <p className="fielderr">{errors[key]}</p> : null;

  return (
    <form className="authform submitform" onSubmit={submit} noValidate>
      <div className="formrow">
        <Field
          id="sub-kind"
          label={t('submit.kind')}
          /*
           * ⚠️ 选「视频资料」时把提示**换掉**（而不是并排显示两条）：
           *    这一栏最常见的错法是"贴了一个普通网页链接"，而那一句才是
           *    当下真正要说的。通用那句可以在别的类型下继续用。
           */
          hint={draft.kind === 'video' ? t('enterVideo.resourceKindHint') : t('submit.hintKind')}
        >
          <select
            id="sub-kind"
            className="mcsr-field__input"
            value={draft.kind}
            onChange={(e) => set('kind', e.target.value)}
          >
            {RESOURCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {/*
                 * ⚠️⚠️ 这里原来写的是
                 *     t(`resources.kind${k === 'website' ? 'Website' : 'Tool'}`)
                 *   —— 一个**二元**三元式。加 `'video'` 这个 kind 之后，
                 *   视频资料在**这个下拉框里**会被显示成「工具」
                 *   （因为 k !== 'website'），而且不报错、不崩溃。
                 *
                 *   这和 `lib/resourceKind.ts` 文件头记的那 5 处是同一个 bug，
                 *   只是它是**第 6 处**、而且它拼的是 key 所以没被那次收拢覆盖到。
                 *   现在走同一个函数：新增 kind 时 `KIND_KEYS` 编译不过。
                 */}
                {resourceKindLabel(k, t)}
              </option>
            ))}
          </select>
        </Field>

        <Field id="sub-lang" label={t('submit.lang')} hint={t('submit.hintLang')}>
          <select
            id="sub-lang"
            className="mcsr-field__input"
            value={draft.lang}
            onChange={(e) => set('lang', e.target.value)}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {t(l === 'zh-CN' ? 'resources.langZh' : 'resources.langEn')}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field id="sub-title" label={t('submit.title')} hint={t('submit.hintTitle')}>
        <input
          id="sub-title"
          className="mcsr-field__input mcsr-field__input--prose"
          value={draft.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder={t('submit.titlePlaceholder')}
          required
        />
        {fieldError('title')}
      </Field>

      <Field id="sub-title-en" label={t('submit.titleEn')} hint={t('submit.hintTitleEn')}>
        <input
          id="sub-title-en"
          className="mcsr-field__input mcsr-field__input--prose"
          value={draft.titleEn}
          onChange={(e) => set('titleEn', e.target.value)}
          placeholder={t('submit.titleEnPlaceholder')}
        />
        {fieldError('titleEn')}
      </Field>

      <Field id="sub-url" label={t('submit.url')} hint={t('submit.hintUrl')}>
        <input
          id="sub-url"
          className="mcsr-field__input mcsr-field__input--prose"
          type="url"
          value={draft.url}
          onChange={(e) => set('url', e.target.value)}
          placeholder={t('submit.urlPlaceholder')}
          required
        />
        {fieldError('url')}
      </Field>

      <ImagePicker
        value={draft.imageUrl}
        onChange={(url) => set('imageUrl', url)}
        onError={setImageError}
      />
      {imageError ? <p className="fielderr">{imageError}</p> : null}

      <Field id="sub-summary" label={t('submit.summary')} hint={t('submit.hintSummary')}>
        <textarea
          id="sub-summary"
          className="mcsr-field__input mcsr-field__input--prose"
          rows={2}
          value={draft.summary}
          onChange={(e) => set('summary', e.target.value)}
          placeholder={t('submit.summaryPlaceholder')}
        />
        {fieldError('summary')}
      </Field>

      <TagPicker
        selected={draft.tags}
        onChange={(tags) => set('tags', tags)}
        suggestions={suggestions}
      />

      <div className="mcsr-field">
        <div className="bodytabs">
          <span className="mcsr-field__label">{t('submit.body')}</span>
          <div className="bodytabs__switch">
            <button
              type="button"
              className={preview ? '' : 'is-active'}
              onClick={() => setPreview(false)}
            >
              {t('submit.writeTab')}
            </button>
            <button
              type="button"
              className={preview ? 'is-active' : ''}
              onClick={() => setPreview(true)}
            >
              {t('submit.previewTab')}
            </button>
          </div>
        </div>

        {preview ? (
          /*
           * 预览走的是和详情页**同一个** Markdown 组件 ——
           * 所以过滤规则一致，预览里能出现的东西在详情页一定也能出现。
           * 各写一套的话，用户会看到"预览正常、发布后一半内容不见了"。
           */
          <div className="bodypreview">
            {draft.body.trim() ? (
              <Markdown>{draft.body}</Markdown>
            ) : (
              <p className="muted">{t('submit.previewEmpty')}</p>
            )}
          </div>
        ) : (
          <textarea
            id="sub-body"
            className="mcsr-field__input mcsr-field__input--prose mcsr-field__input--tall"
            rows={14}
            value={draft.body}
            onChange={(e) => set('body', e.target.value)}
            placeholder={t('submit.bodyPlaceholder')}
          />
        )}
      </div>

      {/*
        给审核员的话。
        ⚠️ 它和正文分开摆、并且写清楚"不会显示在页面上" ——
           紧挨着正文框的话，用户会以为那也是要发布的内容。
      */}
      <div className="mcsr-field notebox">
        <label className="mcsr-field__label" htmlFor="sub-note">
          {t('submit.note')}
        </label>
        <textarea
          id="sub-note"
          className="mcsr-field__input mcsr-field__input--prose"
          rows={3}
          maxLength={NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('submit.notePlaceholder')}
        />
        <p className="mcsr-field__hint">
          {t('submit.hintNote', { max: NOTE_MAX, used: note.trim().length })}
        </p>
      </div>

      {serverError ? (
        <div className="notice notice--bad" role="alert">
          {serverError}
        </div>
      ) : null}

      <div className="authform__actions">
        <button type="submit" className="cta" disabled={busy}>
          {busy ? busyLabel : actionLabel}
        </button>
        {/*
          「直接保存」（需求②，只有 editor 及以上看得到 —— 页面决定传不传它）。
          ⚠️ `type="button"`：它不是表单的默认提交键，点它走的是另一条路
             （写线上行，不进审核队列）。写成 submit 会让回车键也触发它 ——
             而回车是用户"填完了"的肌肉记忆，那时他想要的是提审。
          ⚠️ 文案与次要按钮样式（ghostbtn）都刻意与主按钮**不同**：一个会立刻生效、
             一个不会，看错按钮的代价是"以为提交了其实没提"或反过来。
        */}
        {secondaryAction ? (
          <button
            type="button"
            className="ghostbtn"
            disabled={busy}
            onClick={submitDirect}
            /*
             * ⚠️ 这里是**字符串上下文**（原生 tooltip 里没有粗体），所以整条路上
             *    用的是 `emText()` 而不是 `em()`。
             * ⚠️ 但**剥标记那一步在调用方**（`secondaryAction.title` 的注释里写了
             *    为什么）：这里再剥一遍是空操作，而把它唯一化在这里会让调用点在
             *    源码层面看起来像"裸 `t()`"、被守卫误判 —— 那才是真正的代价。
             */
            title={secondaryAction.title}
          >
            {busy ? secondaryAction.busyLabel : secondaryAction.label}
          </button>
        ) : null}
        <span className="submitform__note">{t('submit.reviewNote')}</span>
      </div>
    </form>
  );
}
