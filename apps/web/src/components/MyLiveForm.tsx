import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from '@/components/Form';

/**
 * 「贴一条链接 / 改这一条」的小表单（需求④=B）。
 *
 * ---------------------------------------------------------------------------
 * ★ 它**刻意不在前端判断"链接合不合法"**
 * ---------------------------------------------------------------------------
 * 这一条最容易被"顺手"写错：公开名单那个 `handle` 字段**是**拒收链接的
 * （链接由服务端按平台拆成标识再存，见 `liveManage.hintHandle`），
 * 于是从那个文件抄一段校验过来极其自然 —— **但私人列表的规则正好相反**：
 *   · 服务端 `UserLiveLinkInputSchema` 只要求"非空、不过长"；
 *   · **认不出来的链接也收**（201，`platform`/`handle` 为 null、`url` 原样存）。
 * 抄错的后果不是报错，而是**用户存不进自己明明合法的链接**，而我们这边毫无记录。
 * ⇒ 所以这里只把服务端真的会拒的形状先挡一下（空），其余一律放行，
 *    由 `MyLiveList` 那一侧如实显示"这条我们认不出平台，只能给你原站入口"。
 *
 * ---------------------------------------------------------------------------
 * 一份表单、两种用法（新增 / 行内编辑）
 * ---------------------------------------------------------------------------
 * ⚠️ 刻意**不复制第二份表单**：两份的下场是"某天把新增那条的校验改了、
 *    行内编辑那条没改" —— 同一个坑本仓已经踩过（见 `ClickToPlayEmbed` 的文件头）。
 *    差别只有三处，全由 `mode` 决定：初值、按钮文案、以及**提交体怎么拼**。
 *
 * ⚠️ 它**不发请求**（与 `MyLiveList` 一样是纯展示那一派，提交交给调用方）：
 *    这样各状态都能在渲染自检里驱动，不必起 dev server。
 */
export function MyLiveForm({
  mode = 'add',
  initial,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  /** `add` = 贴一条新的；`edit` = 改已有那一行（只影响文案与提交体形状）。 */
  mode?: 'add' | 'edit';
  /** 编辑时的初值（新增时不传）。 */
  initial?: { url: string; title: string | null };
  busy: boolean;
  /** 失败原因（已由页面翻好文案）。`null` = 没有错误。 */
  error: string | null;
  onSubmit: (input: { url: string; title?: string | null }) => void;
  /** 只有编辑态用：取消并收起。不传就不画那个按钮。 */
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState(initial?.url ?? '');
  /*
   * ⚠️ 初值把 `null` 摊成空串（输入框的"没有"就是空）——
   *    但**回写时不能把空串当成值**，见下面提交体那一段。
   */
  const [title, setTitle] = useState(initial?.title ?? '');

  /*
   * 空链接是唯一在本地拦的：它是"什么都没填"，不是"填了个我们认不出的东西"。
   * 超长交给服务端（`LIVE_URL_MAX`）—— 阈值是它那边的契约，这里再写一份就会分叉。
   */
  const canSubmit = url.trim() !== '' && !busy;

  return (
    <form
      className="authform submitform"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        const nextUrl = url.trim();
        const nextTitle = title.trim();
        if (mode === 'edit') {
          /*
           * ★ 编辑这条路的形状是 `UserLiveLinkPatchSchema`：`{ url?, title? }`。
           *
           * ⚠️⚠️ 它和"新增"**不一样**，这是本文件最容易写错的一行：
           *    · 新增：`title` 为空 ⇒ **不传这个键**（服务端落 null，即"没起名字"）；
           *    · 编辑：`title` 为空 ⇒ 必须传 **`null`**（= **清空**之前起的名字）。
           *      传 `undefined`/省略会被服务端的 refine 判成"什么都没改"而 400；
           *      传空串则会在库里存一个**长度 0 的名字**，与"没起名字"不是一回事
           *      （前者会让界面显示一个空白标题，后者才会回退显示链接本身）。
           * ⇒ 两种模式的提交体由同一个函数产出，但**规则不同**，所以这里显式分支。
           */
          onSubmit({ url: nextUrl, title: nextTitle === '' ? null : nextTitle });
          return;
        }
        /*
         * ⚠️ 新增：只送 `url`（+ 可选 `title`）—— 服务端 schema 是 `.strict()`，
         *    多一个字段直接 400；平台与标识**全由服务端从链接推导**。
         */
        onSubmit(nextTitle === '' ? { url: nextUrl } : { url: nextUrl, title: nextTitle });
      }}
    >
      {/*
        ⚠️ `id` 带上 `mode`：新增表单与某一行的编辑表单**可能同时在页面上**
            （用户正在改第 2 行、又想去贴一条新的）。写死同一个 id 会产生**重复 id**，
            而重复 id 的后果是 label 的 `htmlFor` 指向第一个 —— 点标签跳错输入框，
            这种问题在单测和渲染自检里都看不出来。
      */}
      <Field id={`mylive-url-${mode}`} label={t('videos.url')} hint={error ?? t('myLive.addHint')}>
        <input
          id={`mylive-url-${mode}`}
          className="mcsr-field__input"
          value={url}
          placeholder="https://"
          onChange={(e) => setUrl(e.target.value)}
        />
      </Field>

      <Field
        id={`mylive-title-${mode}`}
        label={t('videos.titleLabel')}
        hint={t('videos.hintTitle')}
      >
        <input
          id={`mylive-title-${mode}`}
          className="mcsr-field__input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>

      <div className="authform__actions">
        <button type="submit" className="cta" disabled={!canSubmit}>
          {mode === 'edit' ? t('myLive.saveAction') : t('myLive.addAction')}
        </button>
        {onCancel ? (
          <button type="button" className="ghostbtn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        ) : null}
      </div>
    </form>
  );
}
