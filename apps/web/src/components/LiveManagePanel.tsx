import { LIVE_PLATFORMS } from '@mcsr/shared';
import {
  LIVE_NAME_MAX,
  LIVE_NOTE_MAX,
  type LiveChannel,
  type LiveChannelInput,
  LiveChannelInputSchema,
  type LivePlatform,
  liveEmbedUnavailableReason,
} from '@mcsr/shared/live';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, Notice } from '@/components/Form';
import {
  ApiError,
  createLiveChannel,
  deleteLiveChannel,
  fetchLiveChannelsForManage,
  setLiveChannelVisibility,
  updateLiveChannel,
} from '@/lib/api';
import { useApiErrorText } from '@/lib/auth';
import { useAsync } from '@/lib/useAsync';

/**
 * 直播清单的**编辑**界面（只有 `live.manage` 的人看得到 —— 页面负责判断）。
 *
 * ---------------------------------------------------------------------------
 * 为什么它不是一条独立路由
 * ---------------------------------------------------------------------------
 * 编辑要看的东西和访客要看的东西**是同一批数据**，而且编辑的第一件事
 * 往往是"看一眼现在别人看到的是什么"。分成两个页面之后，
 * 他每改一条就要在两边来回切一次。
 * 所以它长在同一页上，用权限决定显不显示（见 App.tsx 里那段注释）。
 *
 * ---------------------------------------------------------------------------
 * 删除要二次确认，隐藏不要
 * ---------------------------------------------------------------------------
 * 和视频那边同一条理由：隐藏完全可逆（恢复按钮就在旁边），
 * 而删除删掉的是"这个主播被记下来过"这件事本身。
 * 确认做成**行内两步**，不用 `window.confirm` —— 原生弹窗在 Electron 壳里的
 * 样式和整站无关，而且会阻塞渲染（VideoCard 里有同样的说明）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 这一页最常见的"失败"其实是成功
 * ---------------------------------------------------------------------------
 *   · `live_exists`（409）= 这个频道已经记过了。这是这份清单**最常见的正常结果**
 *     （同一个主播被两个人加），所以不能只说一句"出错了" —— 服务端回了
 *     `existingId`，界面要**指到那一行**去，所以下面有 `highlightId`。
 *   · `changed: false` = 本来就是那个状态。也是成功，不是错误。
 */

interface Draft {
  platform: LivePlatform;
  handle: string;
  displayName: string;
  note: string;
  /**
   * 标签（2026-09-13）。**输入是逗号分隔的一行文本**，提交时才拆成数组。
   *
   * ⚠️ 不做 chip 编辑器：那要一整套键盘交互（退格删掉上一块、方向键、粘贴拆分），
   *    而这一栏目前只用来**显示**（用户明确说暂时不做筛选）。一行文本够用，
   *    而且和 `note` 一样可以整段粘贴。
   */
  tags: string;
  liveVideoId: string;
  embedChannel: boolean;
  /** 文本，提交时转数字 —— 空的那一格表示"用默认排序"。 */
  sortOrder: string;
}

const DEFAULT_SORT = 100;
const SORT_MAX = 9999;

/**
 * 逗号分隔（也接受中文逗号与顿号）→ 去空白、丢空项。
 *
 * ⚠️ 中英文逗号都要收：中文输入法下打出来的是 `，`，只认 `,` 的话整行会被当成
 *    **一个**标签 —— 用户会看到卡片上挂着一长条"速通，Ranked，集锦"。
 * ⚠️ 去重交给服务端的 schema（那是唯一的归一化点）；这里**不**再写一份。
 */
function parseTags(raw: string): string[] {
  return raw
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function emptyDraft(): Draft {
  return {
    platform: LIVE_PLATFORMS[0],
    handle: '',
    displayName: '',
    note: '',
    tags: '',
    liveVideoId: '',
    embedChannel: false,
    sortOrder: String(DEFAULT_SORT),
  };
}

function draftFrom(channel: LiveChannel): Draft {
  return {
    platform: channel.platform,
    handle: channel.handle,
    displayName: channel.displayName,
    note: channel.note ?? '',
    // 用同一个分隔符回填（`,` + 空格），这样"打开→保存"不会改变内容
    tags: channel.tags.join(', '),
    liveVideoId: channel.liveVideoId ?? '',
    embedChannel: channel.embedChannel,
    sortOrder: String(channel.sortOrder),
  };
}

/** 平台名 → `videos.*` 那个 key 的后半段（和 LiveCard 用同一批词条）。 */
function platformKey(platform: LivePlatform): string {
  if (platform === 'youtube') return 'Youtube';
  if (platform === 'twitch') return 'Twitch';
  return 'Bilibili';
}

export function LiveManagePanel({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation();
  const errorText = useApiErrorText();

  const [refreshKey, setRefreshKey] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LiveChannel | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  /** `live_exists` 时指向已经存在的那一行 —— 见文件头。 */
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const list = useAsync((signal) => fetchLiveChannelsForManage(signal), [refreshKey]);

  function reload() {
    setRefreshKey((k) => k + 1);
    // 公开列表也要跟着刷 —— 编辑刚加的那条应当立刻出现在访客看到的地方
    onChanged();
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
  }

  return (
    <section className="livemanage">
      <div className="livemanage__head">
        <h2 className="livemanage__title">{t('liveManage.title')}</h2>
        <button
          type="button"
          className="cta"
          onClick={() => {
            setNotice(null);
            setHighlightId(null);
            if (formOpen && !editing) closeForm();
            else {
              setEditing(null);
              setFormOpen(true);
            }
          }}
        >
          {formOpen && !editing ? t('liveManage.close') : `+ ${t('liveManage.addAction')}`}
        </button>
      </div>
      <p className="livemanage__sub">{t('liveManage.subtitle')}</p>

      {notice ? <Notice kind={notice.ok ? 'ok' : 'bad'}>{notice.text}</Notice> : null}

      {formOpen ? (
        <ChannelForm
          key={editing ? editing.id : 'add'}
          initial={editing ? draftFrom(editing) : emptyDraft()}
          editingId={editing ? editing.id : null}
          onCancel={closeForm}
          onDone={(ok, text, existingId) => {
            setNotice({ ok, text });
            setHighlightId(existingId ?? null);
            if (ok) closeForm();
            /*
             * 成功要刷；`live_exists` 也要刷 —— 那一行可能刚被别处改过，
             * 而我们要指给用户看的就是它**当前**的样子。
             */
            reload();
          }}
        />
      ) : null}

      {list.status === 'loading' ? <p className="state">{t('common.loading')}</p> : null}
      {list.status === 'error' ? <Notice kind="bad">{t('liveManage.loadFailed')}</Notice> : null}

      {list.status === 'ok' ? (
        list.data.items.length === 0 ? (
          <p className="livemanage__empty">{t('live.empty')}</p>
        ) : (
          <ul className="live-list livemanage__list">
            {list.data.items.map((channel) => (
              <ManageRow
                key={channel.id}
                channel={channel}
                highlighted={channel.id === highlightId}
                onEdit={() => {
                  setNotice(null);
                  setEditing(channel);
                  setFormOpen(true);
                }}
                onResult={(ok, text) => {
                  setNotice({ ok, text });
                  if (ok) reload();
                }}
                fallbackError={errorText}
              />
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 一行（编辑 / 隐藏 / 删除）
// ---------------------------------------------------------------------------

function ManageRow({
  channel,
  highlighted,
  onEdit,
  onResult,
  fallbackError,
}: {
  channel: LiveChannel;
  highlighted: boolean;
  onEdit: () => void;
  onResult: (ok: boolean, text: string) => void;
  fallbackError: (error: unknown) => string;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<'visibility' | 'delete' | null>(null);
  const [confirming, setConfirming] = useState(false);

  const isHidden = channel.status === 'hidden';

  async function toggleVisibility() {
    setBusy('visibility');
    const next = isHidden ? 'visible' : 'hidden';
    try {
      const res = await setLiveChannelVisibility(channel.id, next);
      /*
       * ⚠️ `changed: false` 是**成功**，不是错误。
       *    它表示"本来就是那个状态"（比如另一个人刚隐藏过）。
       *    报成失败会让编辑以为自己的操作没生效，然后再点一次 ——
       *    而再点一次还是 `changed: false`。
       */
      if (!res.changed) onResult(true, t('liveManage.changedNothing'));
      else onResult(true, next === 'hidden' ? t('liveManage.hidden') : t('liveManage.shown'));
    } catch (error) {
      onResult(false, fallbackError(error));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setConfirming(false);
    setBusy('delete');
    try {
      await deleteLiveChannel(channel.id);
      onResult(true, t('liveManage.deleted'));
    } catch (error) {
      onResult(false, fallbackError(error));
    } finally {
      setBusy(null);
    }
  }

  /*
   * ⚠️ 只在**"开了频道嵌入但它永远不会生效"**时才提醒。
   *    另外两种"嵌不出来"（平台不支持、没填视频 ID）是常态，
   *    在这张表上逐行提醒只是噪音；而这一种是"你设了但没反应" —— 必须说。
   *
   * ⚠️ 判据直接用 shared 的 `liveEmbedUnavailableReason`，**不在这里重写一遍正则**。
   *    重写一份就会漂移，而漂移的结果是：访客页面上没有播放器、
   *    管理页面上却不提醒 —— 编辑永远查不出为什么。
   */
  const warnNotChannelId =
    channel.embedChannel && liveEmbedUnavailableReason(channel) === 'not_channel_id';

  return (
    <li
      className={`live-card livemanage__row${isHidden ? ' live-card--hidden' : ''}${
        highlighted ? ' livemanage__row--target' : ''
      }`}
    >
      <div className="live-card__head">
        <h3 className="live-card__name">{channel.displayName}</h3>
        <span className="badge badge--kind">
          {t(`videos.platform${platformKey(channel.platform)}`)}
        </span>
        {isHidden ? (
          <span className="badge badge--hidden">{t('liveManage.hiddenBadge')}</span>
        ) : null}
        <span className="livemanage__handle">{channel.handle}</span>
      </div>

      {channel.note ? <p className="live-card__note">{channel.note}</p> : null}

      {warnNotChannelId ? (
        <p className="livemanage__warn">{t('live.noEmbedNotChannelId')}</p>
      ) : null}

      <div className="livemanage__actions">
        <button type="button" className="ghostbtn" onClick={onEdit} disabled={busy !== null}>
          {t('liveManage.editTitle')}
        </button>
        <button
          type="button"
          className="ghostbtn"
          onClick={() => void toggleVisibility()}
          disabled={busy !== null}
        >
          {isHidden ? t('liveManage.show') : t('liveManage.hide')}
        </button>

        {/* 删除：行内两步确认（见文件头）。 */}
        {confirming ? (
          <>
            <span className="livemanage__confirm">{t('liveManage.confirmDelete')}</span>
            <button
              type="button"
              className="dangerbtn"
              onClick={() => void remove()}
              disabled={busy !== null}
            >
              {t('liveManage.confirmYes')}
            </button>
            <button
              type="button"
              className="ghostbtn"
              onClick={() => setConfirming(false)}
              disabled={busy !== null}
            >
              {t('liveManage.confirmNo')}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="dangerbtn"
            onClick={() => setConfirming(true)}
            disabled={busy !== null}
          >
            {t('liveManage.delete')}
          </button>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// 表单
// ---------------------------------------------------------------------------

function ChannelForm({
  initial,
  editingId,
  onCancel,
  onDone,
}: {
  initial: Draft;
  editingId: string | null;
  onCancel: () => void;
  onDone: (ok: boolean, text: string, existingId?: string) => void;
}) {
  const { t } = useTranslation();
  const errorText = useApiErrorText();

  const [draft, setDraft] = useState<Draft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function submit() {
    /*
     * ⚠️ 顺序：先本地字段检查（为了**本地化的文案**），再跑**共用的** schema 兜底。
     *
     *    判据只有一份（`shared/live.ts` 的 `LiveChannelInputSchema`），
     *    所以"什么算合法"服务端和前端不会不一致。
     *    但那份 schema 里的 message 是**中文写死的**，直接显示会在英文界面冒中文 ——
     *    那正是 `lib/auth.tsx` 的 `fieldIssueText` 存在的原因。
     *    所以本地那几条负责"说得准"，schema 负责"拦得住"。
     */
    const local = localFieldErrors(draft, t);
    if (Object.keys(local).length > 0) {
      setErrors(local);
      return;
    }

    const payload: LiveChannelInput = {
      platform: draft.platform,
      handle: draft.handle.trim(),
      displayName: draft.displayName.trim(),
      note: draft.note.trim() || null,
      tags: parseTags(draft.tags),
      liveVideoId: draft.liveVideoId.trim() || null,
      embedChannel: draft.embedChannel,
      sortOrder: draft.sortOrder.trim() === '' ? DEFAULT_SORT : Number(draft.sortOrder),
    };

    const parsed = LiveChannelInputSchema.safeParse(payload);
    if (!parsed.success) {
      /*
       * 走到这里说明**本地那几条没覆盖到**。按 issue 的字段分派，而不是
       * 一律说成"排序不对" —— 那会把一个别的字段的问题指到一个无辜的输入框上。
       * 认不出来的那种给通用的话（好过把服务端的中文原文摆到英文界面上）。
       */
      const firstField = parsed.error.issues[0]?.path[0];
      setErrors(
        firstField === 'sortOrder'
          ? { sortOrder: t('liveManage.errSortOrder') }
          : { _: t('liveManage.errGeneric') },
      );
      return;
    }

    setErrors({});
    setBusy(true);
    try {
      if (editingId) {
        await updateLiveChannel(editingId, parsed.data);
        onDone(true, t('liveManage.saved'));
      } else {
        await createLiveChannel(parsed.data);
        onDone(true, t('liveManage.added'));
      }
    } catch (error) {
      /*
       * ⚠️ `live_exists` 是这一页**最常见的正常结果**：同一个主播被两个人加。
       *    服务端回了 `existingId`，所以这里把话说成"已经记过了，去改那一条"，
       *    并把那个 id 交回页面去**高亮那一行**。
       *    只说一句"出错了"，加的人下一步只能自己在一长串里找。
       */
      if (error instanceof ApiError && error.code === 'live_exists') {
        onDone(
          false,
          `${t('liveManage.exists')} —— ${t('liveManage.existsHint')}`,
          error.existingId,
        );
      } else {
        onDone(false, errorText(error));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="livemanage__form">
      <h3 className="livemanage__formtitle">
        {editingId ? t('liveManage.editTitle') : t('liveManage.addTitle')}
      </h3>

      {/*
        认不出字段的那种校验失败（见 submit 里那个分派）——
        它不属于任何一个输入框，所以只能摆在表单顶部。
        ⚠️ 字段级的那几条**不**走这里，它们各自长在对应输入框的 hint 上。
      */}
      {errors._ ? <Notice kind="bad">{errors._}</Notice> : null}

      <div className="formrow">
        <Field id="live-platform" label={t('liveManage.fieldPlatform')}>
          <select
            id="live-platform"
            className="mcsr-field__input"
            value={draft.platform}
            onChange={(e) => set('platform', e.target.value as LivePlatform)}
          >
            {LIVE_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {t(`videos.platform${platformKey(p)}`)}
              </option>
            ))}
          </select>
        </Field>

        <Field
          id="live-handle"
          label={t('liveManage.fieldHandle')}
          /*
           * ⚠️ 出错时把**提示换掉**，而不是在提示下面再叠一行红字 ——
           *    同一件事说两遍（一遍灰色、一遍红色）会让人以为有两个问题。
           */
          hint={errors.handle ?? t('liveManage.hintHandle')}
        >
          <input
            id="live-handle"
            className="mcsr-field__input"
            value={draft.handle}
            maxLength={120}
            onChange={(e) => set('handle', e.target.value)}
          />
        </Field>
      </div>

      <Field
        id="live-name"
        label={t('liveManage.fieldName')}
        hint={errors.displayName ?? t('liveManage.hintName')}
      >
        <input
          id="live-name"
          className="mcsr-field__input"
          value={draft.displayName}
          maxLength={LIVE_NAME_MAX}
          onChange={(e) => set('displayName', e.target.value)}
        />
      </Field>

      <Field id="live-note" label={t('liveManage.fieldNote')} hint={t('liveManage.hintNote')}>
        <input
          id="live-note"
          className="mcsr-field__input"
          value={draft.note}
          maxLength={LIVE_NOTE_MAX}
          onChange={(e) => set('note', e.target.value)}
        />
      </Field>

      {/*
        标签（2026-09-13）。放在「一句话说明」下面：两者都是给人看的文字，
        放一起比插在标识与名字之间更顺 —— 上面那三栏（平台/标识/名字）都是
        **必须填的**，从这一栏开始才是可选的。

        ⚠️ 用 `<input>` 而不是 `<textarea>`：标签是短的，多行会让人以为可以写句子。
           逗号分隔的做法见 `parseTags` 的注释（中英文逗号都收）。
      */}
      <Field id="live-tags" label={t('liveManage.fieldTags')} hint={t('liveManage.hintTags')}>
        <input
          id="live-tags"
          className="mcsr-field__input"
          value={draft.tags}
          onChange={(e) => set('tags', e.target.value)}
        />
      </Field>

      <Field
        id="live-videoid"
        label={t('liveManage.fieldLiveVideoId')}
        hint={t('liveManage.hintLiveVideoId')}
      >
        <input
          id="live-videoid"
          className="mcsr-field__input"
          value={draft.liveVideoId}
          maxLength={64}
          onChange={(e) => set('liveVideoId', e.target.value)}
        />
      </Field>

      {/*
        ⚠️ 频道嵌入这个开关是**实验性**的。提示必须同时说清三件事：
        只对 YouTube 有效、只认 `UC...` 标识、失败时是一个黑框。
        少说一件，编辑就会开一个不生效的开关，然后以为界面坏了。
      */}
      <Field
        id="live-embed"
        label={t('liveManage.fieldEmbedChannel')}
        hint={t('liveManage.hintEmbedChannel')}
      >
        {/* Field 的 <label htmlFor> 已经把这个 checkbox 和标签关联起来了，不用再包一层 */}
        <input
          id="live-embed"
          type="checkbox"
          checked={draft.embedChannel}
          onChange={(e) => set('embedChannel', e.target.checked)}
        />
      </Field>

      <Field
        id="live-order"
        label={t('liveManage.fieldSortOrder')}
        hint={errors.sortOrder ?? t('liveManage.hintSortOrder')}
      >
        <input
          id="live-order"
          className="mcsr-field__input"
          inputMode="numeric"
          value={draft.sortOrder}
          onChange={(e) => set('sortOrder', e.target.value)}
        />
      </Field>

      <div className="authform__actions">
        <button type="button" className="cta" onClick={() => void submit()} disabled={busy}>
          {busy
            ? t('liveManage.saving')
            : editingId
              ? t('liveManage.saveAction')
              : t('liveManage.addAction')}
        </button>
        <button type="button" className="ghostbtn" onClick={onCancel} disabled={busy}>
          {t('liveManage.cancel')}
        </button>
      </div>
    </div>
  );
}

/**
 * 本地字段校验 —— 只为"说得准"。
 *
 * ⚠️ 判据和 `shared/live.ts` 的 `HandleSchema` 是**同一条**（URL、空格），
 *    这里必须自己写一遍，因为要给出**本地化的文案**。
 *    这是一处刻意的重复；代价是两处可能漂移，所以提交前**仍然会跑一次 schema** ——
 *    漂移最坏的结果是"提示不精确"，而不会放过一个非法值。
 */
function localFieldErrors(draft: Draft, t: (k: string) => string): Record<string, string> {
  const errors: Record<string, string> = {};

  const handle = draft.handle.trim();
  if (!handle) errors.handle = t('liveManage.errHandleRequired');
  else if (/^https?:\/\//i.test(handle)) errors.handle = t('liveManage.errHandleIsUrl');
  else if (/\s/.test(handle)) errors.handle = t('liveManage.errHandleSpace');

  if (!draft.displayName.trim()) errors.displayName = t('liveManage.errNameRequired');

  const order = draft.sortOrder.trim();
  if (order !== '') {
    const n = Number(order);
    if (!Number.isInteger(n) || n < 0 || n > SORT_MAX) {
      errors.sortOrder = t('liveManage.errSortOrder');
    }
  }
  return errors;
}
