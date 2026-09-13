import type { CalendarEventInput } from '@mcsr/shared/calendar';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { CalendarForm, emptyCalendarDraft } from '@/components/CalendarForm';
import { Notice } from '@/components/Form';
import { createCalendarEventDirect, submitCalendarEvent } from '@/lib/api';
import { useApiErrorText, useAuth } from '@/lib/auth';
import { useCan } from '@/lib/capabilities';
import { directWriteNotice } from '@/lib/directWriteNotice';

/**
 * 把 `?date=2026-11-14` 变成一个"预填了日期的草稿"。
 *
 * 月历表的当天面板就是靠这个链接过来的（「在这天加活动」）—— 复用这张表单，
 * 而不是另做一个迷你表单：两个表单一定会漂移，而漂移的表现是
 * "从日历加的活动少填了某个字段"。
 *
 * ⚠️ 只认**形状对**的值，并且**只预填日期、不预填时刻**。
 *    链接是用户可以手打的，`?date=hello` 直接塞进输入框会让表单带着一个
 *    非法值打开，而第一条校验错误指向一个"看起来是空的"字段。
 *
 * ⚠️ 时刻留空而不是给一个 00:00：给 00:00 的话用户很可能直接提交，
 *    于是每场从日历加的活动都变成"午夜开始"—— 那种错在日历上看起来很正常。
 */
function draftFromDateParam(raw: string | null): ReturnType<typeof emptyCalendarDraft> {
  const draft = emptyCalendarDraft();
  if (!raw) return draft;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return draft;

  /*
   * 还要确认它真的是一个存在的日期 —— 形状对但日子不存在是可能的
   * （2026-02-30），而 `input[type=datetime-local]` 拿到一个不存在的日期
   * 会把它清空，于是"我明明点了 2 月 30 日"变成"表单是空的"，
   * 中间没有任何提示。
   */
  const [y, m, d] = raw.split('-').map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return draft;
  }

  /*
   * ⚠️ 预填的是**第一段**的开始时间（2026-09-13 起时间是 `slots` 数组）。
   *    起手只有一段，所以这里就是把那一段的日期填上 —— 用户想再加几段
   *    就点下面的「添加一段时间」。
   */
  draft.slots = [{ startsAtLocal: `${raw}T00:00`, endsAtLocal: '' }];
  draft.allDay = true;
  return draft;
}

/**
 * 提交日历活动 —— `/calendar/submit`。
 *
 * ⚠️ 路径挂在 `/calendar` 下面，而不是做一个统一的 `/submit`。
 *    理由和资源库那边一样：提交表单是**功能自己的**一部分，它知道这个功能
 *    要哪些字段、该怎么校验。做成 `/submit?type=calendar` 就等于把所有类型的
 *    表单塞进一个组件里按类型分支 —— 加一类内容就要动公共页面，
 *    而公共页面上一个手滑影响的是全部类型。
 *    （通用的那一半是**审核**，见 /review；两者通用性不同，所以路由结构也不同。）
 *
 * 三道闸门在服务端（requireAuth + requireCapability('calendar.submit') +
 * 邮箱已验证），但界面必须在**用户开始填之前**就说清楚 ——
 * 填完一整张表才被拒是最糟的体验。判据和服务端是同一份权限矩阵。
 */
export function CalendarSubmit() {
  const { t } = useTranslation();
  const auth = useAuth();
  const errorText = useApiErrorText();
  const [params] = useSearchParams();
  // 今天所有角色都有 calendar.submit，所以下面那条分支目前走不到。
  // 留着的理由是它是**服务端那道闸门的镜像**：能力收紧的那天，
  // 界面会自动跟着收紧，而不是让用户填完一整张表再拿到 403。
  const canSubmit = useCan('calendar.submit');
  /**
   * 需求②（t14）：有 `content.author` 的人才给「直接发布」。
   * ⚠️ 能力名从矩阵读 —— 页面里**不写"谁是编辑"**（见 permissions.ts 的头注释）。
   */
  const canAuthor = useCan('content.author');

  /*
   * ⚠️ 只在**第一次渲染时**算一次，之后 `?date=` 不再影响表单。
   *
   *    用 `useState(初始化函数)` 而不是每次渲染都算：用户从日历点了 11 月 14 日
   *    进来、改成了 11 月 20 日，之后地址栏里的 `?date=` 不该把他的修改顶掉
   *    （地址栏不会因为他的修改而变，所以每次渲染都重算＝把编辑丢掉）。
   */
  const [initialDraft, setInitialDraft] = useState(() => draftFromDateParam(params.get('date')));

  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<{ revision: number } | null>(null);
  /** 直编（需求②）的结果提示 —— 与 `failure` **分开存**，两者可能同时存在。 */
  const [directNotice, setDirectNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const navigate = useNavigate();

  async function onSubmit(input: CalendarEventInput) {
    setFailure(null);
    setBusy(true);
    try {
      const result = await submitCalendarEvent(input);
      setDone({ revision: result.revision });
    } catch (error) {
      /*
       * 只做"把错误翻译成人话"，不做任何判断。
       * `already_pending` / `invalid_input` / `email_not_verified` 的区分在
       * lib/auth.tsx 的 apiErrorText 里按 `code` 分派（那是错误码契约测试守着的），
       * 这里再判一次就等于有了第二份规则，而两份规则分叉时不会有任何报错。
       */
      setFailure(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  /**
   * 「直接发布」（需求②）—— 新活动**直接上架**，不进审核队列。
   *
   * ⚠️ 成功后**不留在这个页面**：与提审不同 —— 提审完要去「我的提交」看进度，
   *    而直编已经生效了，用户下一步是去看那条活动。留在原表单上会让人以为没提交成功。
   * ⚠️ `liveRevisionUnchanged` 的文案判据走 `directWriteNotice`（与资料那边同一处）：
   *    新建的直编一律 `false`，所以这里只会说"已发布"，但**不让页面自己判**
   *    ——否则这一处又会变成第二份判据。
   */
  async function onSubmitDirect(input: CalendarEventInput) {
    setFailure(null);
    setBusy(true);
    try {
      const result = await createCalendarEventDirect(input);
      setDirectNotice({ ok: true, text: directWriteNotice(result, t) });
      globalThis.setTimeout(() => {
        navigate(`/calendar/${encodeURIComponent(result.id)}`);
      }, 800);
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  if (auth.loading) return <p className="state">{t('common.loading')}</p>;

  if (!auth.user) {
    return (
      <>
        <header className="pagehead">
          <h1 className="pagehead__title">{t('calendar.submitTitle')}</h1>
        </header>
        <Notice kind="info">{t('submit.needLogin')}</Notice>
        <p className="submitgate">
          <Link className="cta" to={`/login?next=${encodeURIComponent('/calendar/submit')}`}>
            {t('nav.login')}
          </Link>
        </p>
      </>
    );
  }

  if (!auth.user.emailVerified) {
    return (
      <>
        <header className="pagehead">
          <h1 className="pagehead__title">{t('calendar.submitTitle')}</h1>
        </header>
        <Notice kind="bad">{t('submit.needVerify')}</Notice>
        <p className="submitgate">
          <Link className="cta" to="/me">
            {t('submit.gotoVerify')}
          </Link>
        </p>
      </>
    );
  }

  if (!canSubmit) {
    return (
      <>
        <header className="pagehead">
          <h1 className="pagehead__title">{t('calendar.submitTitle')}</h1>
        </header>
        <Notice kind="bad">{t('submit.errForbidden')}</Notice>
        <p className="submitgate">
          <Link className="authform__link" to="/calendar">
            {t('calendar.backToList')}
          </Link>
        </p>
      </>
    );
  }

  if (done) {
    return (
      <>
        <header className="pagehead">
          <h1 className="pagehead__title">{t('calendar.doneTitle')}</h1>
          <p className="pagehead__sub">{t('calendar.doneSub')}</p>
        </header>
        <Notice kind="ok">{t('submit.doneRevision', { revision: done.revision })}</Notice>
        <div className="submitdone">
          <button
            type="button"
            className="cta"
            onClick={() => {
              setDone(null);
              // 再提交一条时把预填清掉：上一条的日期不该跟着下一条
              setInitialDraft(emptyCalendarDraft());
            }}
          >
            {t('calendar.submitAnother')}
          </button>
          <Link className="authform__link" to="/calendar">
            {t('calendar.backToList')}
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="pagehead">
        <h1 className="pagehead__title">{t('calendar.submitTitle')}</h1>
        <p className="pagehead__sub">{t('calendar.submitSubtitle')}</p>
      </header>

      {/*
        说清楚"提交后不会立刻出现"，否则用户会以为提交失败又提交一遍。
        ⚠️ 日历这一条比资源库更要紧：日历有时间。他填的那个时间一旦到了
           而活动还没出现，看起来就像我们漏了他的条目 —— 而实际上它只是在等审核。
      */}
      <p className="submitnote">{t('calendar.submitFlowNote')}</p>

      {directNotice ? (
        <Notice kind={directNotice.ok ? 'ok' : 'bad'}>{directNotice.text}</Notice>
      ) : null}

      {failure ? <Notice kind="bad">{failure}</Notice> : null}

      <CalendarForm
        initial={initialDraft}
        actionLabel={t('calendar.submitAction')}
        busyLabel={t('submit.submitting')}
        busy={busy}
        onSubmit={onSubmit}
        /*
         * 「直接发布」**只对 `content.author` 传下去**（需求②）。
         * ⚠️ 普通用户拿到的是 `undefined` ⇒ 那个按钮**根本不存在**，不是一个灰掉的按钮
         *    （本仓一贯的立场：看不见比看得见点不动好）。
         */
        secondaryAction={
          canAuthor
            ? {
                label: t('authoring.directPublish'),
                busyLabel: t('submit.submitting'),
                onSubmit: (input) => void onSubmitDirect(input),
              }
            : undefined
        }
      />
    </>
  );
}
