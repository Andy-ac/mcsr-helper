import type { VideoPlatform } from '@mcsr/shared';
import {
  formatTimecode,
  parseTimecode,
  parseVideoLink,
  platformSupportsStartOffset,
  VideoInputSchema,
} from '@mcsr/shared/videos';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Field, Notice } from '@/components/Form';
import { ApiError, submitVideo, type VideoSubmitResult } from '@/lib/api';
import { useApiErrorText } from '@/lib/auth';
import { describeSubmissionError, type SubmissionErrorInfo } from '@/lib/submissionErrors';

/**
 * 贴视频的表单。
 *
 * ---------------------------------------------------------------------------
 * 一、只有一个链接字段，没有 platform + videoId 两个框
 * ---------------------------------------------------------------------------
 * `VideoInputSchema` 的注释已经把这条说清楚了：用户手里就是**一条链接**。
 * 逼他先判断"这是哪个平台、视频 ID 是哪一段"是把我们的内部表示泄漏到界面上，
 * 而且一定会有人把 BV 号填进 platform 那一栏 —— 那时错误信息会指向
 * 一个完全无关的地方。拆分的活儿由 `parseVideoUrl` 干（它不发任何请求）。
 *
 * ---------------------------------------------------------------------------
 * 二、边打字边解析，是为了**在他提交之前**给出确认
 * ---------------------------------------------------------------------------
 * 链接解析失败是完全静默的：用户贴了一条看起来非常正常的链接
 * （频道首页、播放列表、合集），按下提交才被打回来。而这条链接在他的浏览器里
 * 明明能打开、能播 —— 他没有任何理由怀疑它。
 * 所以这里一边打字一边解析，并在**链接字段正下方**说出读到了什么。
 * 读到东西本身就是"你这次粘贴是对的"的证据。
 *
 * ---------------------------------------------------------------------------
 * 三、起始时间给 B站 的实话，是这里最重要的一句话
 * ---------------------------------------------------------------------------
 * B站的官方嵌入播放器**没有跳转参数**。服务端照样会把 startOffsetSec 存下来
 * （那是用户提供的数据，而且 YouTube / Twitch 需要它），但播放时会从 0 开始。
 * 静默丢掉是最差的选项：用户填了 1:02:33，播放器从 0 开始，
 * 他的结论是"这个网站有 bug"或者"这个链接坏了"，而不是"这个平台不支持"。
 * 所以这个平台一旦被识别出来，字段旁边就写清楚它不会生效。
 *
 * ⚠️ 这里仍然**提供**这个字段（而不是在 B站 时藏起来）：那个值会被真的存下来，
 *    而且贴的人往往是从别的平台复制过来的同一个时间点 —— 藏掉字段等于让他
 *    以为这个功能不存在。给字段 + 说实话，比给一个假选择或者一个静默的丢弃都好。
 */
export function VideoForm({
  onPosted,
  onClose,
}: {
  /** 贴成功之后通知列表页刷新 —— 视频是立刻可见的，列表必须马上反映出来。 */
  onPosted: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const errorText = useApiErrorText();

  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [offset, setOffset] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<SubmissionErrorInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<VideoSubmitResult | null>(null);

  /*
   * 每次渲染都重新解析（不 memo）。
   * 它只是一个 `new URL` 加几个正则，比维护一份 memo 依赖便宜，也不会出现
   * "memo 的依赖写漏了一个，于是界面上的识别结果停在旧值"这种问题。
   */
  const link = url.trim() ? parseVideoLink(url) : null;
  const seekable = link ? platformSupportsStartOffset(link.platform) : false;
  const parsedOffset = offset.trim() ? parseTimecode(offset) : null;

  async function post(input: Parameters<typeof submitVideo>[0]) {
    setFailure(null);
    setBusy(true);
    try {
      const result = await submitVideo(input);
      setDone(result);
      // 立刻通知列表页重拉：不重拉的话，用户关掉表单会发现墙上没有它 ——
      // 而那正好和"贴完立刻可见"的承诺相反。
      onPosted();
    } catch (error) {
      /*
       * ⚠️ 两种错误走两条不同的路，**顺序要紧**：
       *   · `invalid_input` 是**字段级**的（Zod issues 带 field），
       *     必须落到对应输入框下面。走通用文案的话，用户看到表单底下一句
       *     "输入不合法"，却不知道是哪一栏 —— 而这个表单只有三个输入框，
       *     那一句话对他的帮助接近零。
       *   · 其余的（409 video_exists / 403 / 429…）由 describeSubmissionError
       *     翻译成"下一步该做什么"，它返回的是一个可以点的链接。
       */
      if (error instanceof ApiError && error.code === 'invalid_input' && error.issues?.length) {
        const next: Record<string, string> = {};
        for (const issue of error.issues) {
          // 服务端给的 field 就是 shared schema 的字段名（url / title / startOffsetSec），
          // 原样用作 key；取不到时落到 url 上 —— 那是这个表单最可能出错的一栏。
          const field = issue.field === 'title' ? 'title' : 'url';
          if (!next[field]) next[field] = issue.message;
        }
        setErrors(next);
      } else {
        setFailure(describeSubmissionError(error, t, errorText));
      }
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();

    const next: Record<string, string> = {};

    /*
     * 起始时间是**自由文本**，不是 number —— 见 shared/videos.ts 里 parseTimecode
     * 的说明：平台上显示的是 1:02:33，用户会照着抄，而绑成 number 的话
     * 输入框会直接把那个冒号吃掉。
     *
     * ⚠️ 只在**平台已经识别出来**时才解析它，因为那一栏也只有那时才渲染。
     *    不这么写的话，"链接读不出 ID + 起始时间格式错"会走进一个死胡同：
     *    错误记在 startOffset 上，而那个输入框根本不在页面上 ——
     *    用户按下"贴到墙上"什么都不会发生，没有红字、也没有请求。
     *    （这条路径是**可达**的：先填一个带冒号的错时间，再把链接粘错。）
     */
    let startOffsetSec: number | null = null;
    if (link && offset.trim()) {
      const parsed = parseTimecode(offset);
      if (parsed === null) next.startOffset = t('videos.errStartOffset');
      else startOffsetSec = parsed;
    }

    /*
     * ⚠️ 用**共享 schema** 校验，不在界面里手写一遍规则（和 ResourceForm 同一条）：
     *    手写一份的下场是两边慢慢分叉 —— 界面放行了服务端会拒的内容，
     *    用户填完才被拒、白填一遍。
     *
     * ⚠️ 但错误文案用它自己的词条，不用 schema 里的 message：
     *    shared/videos.ts 里的 message 是写死的中文（`请粘贴视频链接`），
     *    英文界面下会冒出一句中文。这里只借它的**规则**，不借它的**文字**。
     */
    const checked = VideoInputSchema.safeParse({
      url: url.trim(),
      title: title.trim(),
      startOffsetSec,
    });
    if (!checked.success) {
      for (const issue of checked.error.issues) {
        const field = String(issue.path[0] ?? '');
        if (field === 'url' && !next.url) next.url = t('videos.errUrlRequired');
        if (field === 'title' && !next.title) next.title = t('videos.errTitleRequired');
      }
      /*
       * ⚠️ 到这里要**停住**，不能继续拿 checked.data 往下走 ——
       *    schema 说这份数据不合法，那就一个字节都不该发出去。
       *    （下面那条兜底只防"issue 的 path 不在 url/title 上"这种情况，
       *      它目前不可达：startOffsetSec 的越界已经先被 parseTimecode 挡过一次。
       *      真出现时宁可显示一句笼统的红字，也不要静默地什么都不显示。）
       */
      if (Object.keys(next).length === 0) next.url = t('videos.errUrlRequired');
      setErrors(next);
      return;
    }

    // 本地能查出来的错（起始时间格式）要在发请求之前就报，不为它白跑一趟网络。
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }
    setErrors({});
    void post(checked.data);
  }

  function reset() {
    setUrl('');
    setTitle('');
    setOffset('');
    setErrors({});
    setFailure(null);
    setDone(null);
  }

  if (done) {
    return (
      <section className="video-form video-form--done">
        <div className="video-form__head">
          <h2 className="video-form__title">{t('videos.doneTitle')}</h2>
        </div>

        {/*
          Q6：视频**不审核**。不说清楚的话，用户会去「我的提交」里找一个
          根本不存在的"待审核"状态 —— 那是一个纯粹的困惑，而且他会以为
          自己贴失败了，然后再贴一遍（然后撞上 409 video_exists）。
        */}
        <Notice kind="ok">{t('videos.doneNote')}</Notice>

        {/*
          服务端的 startOffsetSupported 是权威。它说 false 而用户确实填了值，
          就再说一遍 —— 这一次是在**结果页**上，比表单里的提示更难错过。
        */}
        {!done.startOffsetSupported && done.video.startOffsetSec ? (
          <p className="submitnote">{t('videos.doneStartIgnored')}</p>
        ) : null}

        <div className="submitdone">
          <button type="button" className="cta" onClick={reset}>
            {t('videos.submitAnother')}
          </button>
          <Link className="authform__link" to="/videos">
            {t('videos.viewWall')}
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="video-form">
      <div className="video-form__head">
        <h2 className="video-form__title">{t('videos.formTitle')}</h2>
        <button type="button" className="authform__link" onClick={onClose}>
          {t('common.cancel')}
        </button>
      </div>

      <form className="authform" onSubmit={submit} noValidate>
        <Field id="video-url" label={t('videos.url')} hint={t('videos.hintUrl')}>
          <input
            id="video-url"
            className="mcsr-field__input mcsr-field__input--prose"
            // 不是 type="url"：浏览器的校验会先于我们弹一句英文的系统提示，
            // 而这句话不在词条里、也不能翻译。
            type="text"
            inputMode="url"
            spellCheck={false}
            autoComplete="off"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t('videos.urlPlaceholder')}
            required
          />
          {/* 解析结果紧贴输入框 —— 它是"你这次粘贴对不对"的直接证据 */}
          {link ? (
            <p className="video-form__recognized">
              {t('videos.recognized', {
                platform: platformLabel(link.platform, t),
                id: link.videoId,
              })}
            </p>
          ) : url.trim() ? (
            <p className="video-form__recognized video-form__recognized--no">
              {t('videos.notRecognized')}
            </p>
          ) : null}
          {errors.url ? <p className="fielderr">{errors.url}</p> : null}
        </Field>

        <Field id="video-title" label={t('videos.titleLabel')} hint={t('videos.hintTitle')}>
          <input
            id="video-title"
            className="mcsr-field__input mcsr-field__input--prose"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('videos.titlePlaceholder')}
            required
          />
          {errors.title ? <p className="fielderr">{errors.title}</p> : null}
        </Field>

        {/*
          ⚠️ 平台没识别出来之前**不显示**这一栏。
              那段链接可能根本不是一个视频，此时问"从第几秒开始"是在问一个
              还不存在的问题 —— 而且会让人以为"这一栏是必填的"。
        */}
        {link ? (
          <div className={seekable ? undefined : 'video-form__unsupported'}>
            <Field
              id="video-offset"
              label={t('videos.startOffset')}
              hint={seekable ? t('videos.hintStartOffset') : t('videos.hintStartOffsetUnsupported')}
            >
              <input
                id="video-offset"
                className="mcsr-field__input"
                // type="text"：冒号不能丢（见 parseTimecode）
                type="text"
                inputMode="text"
                spellCheck={false}
                autoComplete="off"
                value={offset}
                onChange={(e) => setOffset(e.target.value)}
                placeholder={t('videos.startOffsetPlaceholder')}
              />
              {/* 能解析出来时把它规范化成 1:02:33 显示 —— 用户一眼能看出我们读成了多少秒 */}
              {parsedOffset !== null ? (
                <p className="video-form__recognized">
                  {t('videos.startFrom', {
                    time: formatTimecode(parsedOffset),
                  })}
                </p>
              ) : null}
              {errors.startOffset ? <p className="fielderr">{errors.startOffset}</p> : null}
            </Field>
          </div>
        ) : null}

        {failure ? (
          <Notice kind="bad">
            {failure.message}
            {failure.action ? (
              <>
                {' '}
                <Link to={failure.action.to}>{t(failure.action.labelKey)}</Link>
              </>
            ) : null}
          </Notice>
        ) : null}

        <div className="authform__actions">
          <button type="submit" className="cta" disabled={busy}>
            {busy ? t('videos.submitting') : t('videos.action')}
          </button>
          {/* 提交前就说清楚不审核 —— 事后说等于让他白担心了一场 */}
          <span className="submitform__note">{t('videos.noReview')}</span>
        </div>
      </form>
    </section>
  );
}

/** 平台名走词条，不在组件里硬编码可见文字。 */
function platformLabel(platform: VideoPlatform, t: (key: string) => string): string {
  if (platform === 'bilibili') return t('videos.platformBilibili');
  if (platform === 'youtube') return t('videos.platformYoutube');
  return t('videos.platformTwitch');
}
