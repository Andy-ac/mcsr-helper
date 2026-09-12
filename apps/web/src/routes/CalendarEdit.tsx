import type { CalendarEvent, CalendarEventInput } from '@mcsr/shared/calendar';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { type CalendarDraft, CalendarForm, draftFromEvent } from '@/components/CalendarForm';
import { Notice } from '@/components/Form';
import { ApiError, fetchCalendarEvent, fetchCalendarForEdit, updateCalendarEvent } from '@/lib/api';
import { useApiErrorText, useAuth } from '@/lib/auth';
import { eventWhen } from '@/lib/calendarFormat';
import { useCan } from '@/lib/capabilities';

/**
 * 修改一个已有的日历活动 —— `/calendar/:id/edit`。
 *
 * ---------------------------------------------------------------------------
 * 两条取内容路径，顺序不能反（和资源库一致）
 * ---------------------------------------------------------------------------
 *   · `GET /api/calendar/mine/:id` —— 作者本人（任何状态），或已发布条目的
 *     任何登录用户（wiki 式编辑）。被驳回、还没过审的条目**只有**这条路拿得到，
 *     而"改一下重新提交"恰恰是从这里开始的。
 *   · 公开的 `GET /api/calendar/:id` —— 已上架的条目。
 *
 * ⚠️ 先试私有那条。反过来的话，作者会被公开接口的 404 挡住，看不到自己
 *    被驳回的原稿 —— 而那是他唯一的起点。
 */
export function CalendarEdit() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const errorText = useApiErrorText();
  // 有审核权的人能从"有人在改"的提示里直接跳到那一份待审内容
  const canReview = useCan('calendar.review');

  const [draft, setDraft] = useState<CalendarDraft | null>(null);
  /** 现在这一条有没有别人提的、还在等审核的改动 */
  const [pending, setPending] = useState<{
    revision: number;
    payload: Record<string, unknown>;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** 提交成功后的结果。`liveRevisionUnchanged` 决定要不要说"线上还是旧版" */
  const [done, setDone] = useState<{ revision: number } | null>(null);

  useEffect(() => {
    if (auth.loading) return;
    const controller = new AbortController();
    let active = true;

    (async () => {
      try {
        /*
         * ⚠️ 顺序：先试"可编辑的内容"，再退回公开接口。
         *    两边的返回**不是同一个类型**：编辑接口多 pendingRevision / pendingPayload。
         */
        const editable = await fetchCalendarForEdit(id, controller.signal).catch(() => null);
        let event: CalendarEvent;
        if (editable) {
          event = editable.event;
          if (active) {
            setPending(
              editable.pendingRevision === null
                ? null
                : {
                    revision: editable.pendingRevision,
                    payload: editable.pendingPayload ?? {},
                  },
            );
          }
        } else {
          const pub = await fetchCalendarEvent(id, controller.signal);
          event = pub.event;
        }
        if (!active) return;
        setDraft(draftFromEvent(event));
      } catch (error) {
        if (!active) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        // 404 和"加载失败"要分开说：前者是"这条不是你的 / 不存在"，
        // 后者才是"服务出问题了，重试一下"。
        setLoadError(
          error instanceof ApiError && error.status === 404
            ? t('calendar.editNotFound')
            : t('calendar.loadFailed'),
        );
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [id, auth.loading, t]);

  async function onSubmit(input: CalendarEventInput) {
    setFailure(null);
    setBusy(true);
    try {
      const result = await updateCalendarEvent(id, input);
      setDone({ revision: result.revision });
    } catch (error) {
      /*
       * 409 `already_pending` 会走到这里 —— 正常结果，不是错误。
       * 下面那段"有人已经提了一份改动"的提示能在**打开页面时**就拦掉绝大多数，
       * 但拦不住"我打开页面之后另一个人先提交了"这一种。那时要说清楚
       * 这是并发，不是我填错了。
       */
      setFailure(
        error instanceof ApiError && error.code === 'already_pending'
          ? t('calendar.errAlreadyPending')
          : errorText(error),
      );
    } finally {
      setBusy(false);
    }
  }

  /*
   * ★ 有人已经提了一份改动在等审核 —— **不要让他填表**。
   *
   * 服务端的规则是"一条内容同时只允许一份待审修改"（先到先得）。
   * 界面的责任是让第二个人**在动手之前**知道，而不是让他填完一整张表
   * 再拿到 409。不做合并的理由和资源库一样：两份对同一段描述的文字改动
   * 没有安全的自动合并方式，而"先到先得 + 让后来者看见前面那份"是唯一
   * 不会产生错误内容的做法。
   *
   * 代价是后来者的输入会丢 —— 所以他更该在开始之前就知道。
   */
  if (pending) {
    return (
      <>
        <header className="pagehead">
          <Link className="detail__back" to={`/calendar/${encodeURIComponent(id)}`}>
            ← {t('calendar.backToList')}
          </Link>
          <h1 className="pagehead__title">{t('calendar.editTitle')}</h1>
        </header>

        <Notice kind="info">{t('calendar.editBusyNotice', { revision: pending.revision })}</Notice>

        {/*
          把待审那一版的**时间和标题**摆出来。
          只说一句"有人在改"是个死胡同：作者既不知道改了什么，也不知道要不要等。
          这一版就在服务端等着，显示它一句话的成本，换来的是他能自己判断。
        */}
        <div className="calendar-pending">
          <span className="calendar-pending__label">{t('calendar.editBusyWhat')}</span>
          <p className="calendar-pending__title">{String(pending.payload.title ?? '—')}</p>
          <p className="calendar-pending__when">{pendingWhen(pending.payload) ?? '—'}</p>
        </div>

        {canReview ? (
          <p className="submitgate">
            <Link className="cta" to={`/review/calendar/${encodeURIComponent(id)}`}>
              {t('edit.busyGoReview')}
            </Link>
          </p>
        ) : null}

        <p className="submitgate">
          <Link className="authform__link" to={`/calendar/${encodeURIComponent(id)}`}>
            {t('calendar.openItem')}
          </Link>
        </p>
      </>
    );
  }

  if (auth.loading || (!draft && !loadError)) {
    return <p className="state">{t('common.loading')}</p>;
  }

  if (loadError) {
    return (
      <>
        <header className="pagehead">
          <h1 className="pagehead__title">{t('calendar.editTitle')}</h1>
        </header>
        <Notice kind="bad">{loadError}</Notice>
        <p className="submitgate">
          <Link className="cta" to="/calendar">
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
          <h1 className="pagehead__title">{t('calendar.editDoneTitle')}</h1>
          <p className="pagehead__sub">{t('calendar.editDoneSub')}</p>
        </header>
        <Notice kind="ok">{t('submit.doneRevision', { revision: done.revision })}</Notice>
        <div className="submitdone">
          <Link className="cta" to={`/calendar/${encodeURIComponent(id)}`}>
            {t('calendar.openItem')}
          </Link>
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
        <Link className="detail__back" to={`/calendar/${encodeURIComponent(id)}`}>
          ← {t('calendar.backToList')}
        </Link>
        <h1 className="pagehead__title">{t('calendar.editTitle')}</h1>
        <p className="pagehead__sub">{t('calendar.editSubtitle')}</p>
      </header>

      {/*
        最该说清楚的一句话：改完之后**线上还是旧版**（设计约束 2）。
        不说的话，用户会以为自己的修改已经生效了 —— 然后发现页面上没变，
        于是再改一遍，然后拿到 409。
      */}
      <p className="submitnote">{t('calendar.editLiveUnchanged')}</p>

      {failure ? <Notice kind="bad">{failure}</Notice> : null}

      <CalendarForm
        initial={draft as CalendarDraft}
        actionLabel={t('calendar.editAction')}
        busyLabel={t('submit.submitting')}
        busy={busy}
        onSubmit={onSubmit}
      />

      <p className="submitgate">
        <button type="button" className="authform__link" onClick={() => void navigate(-1)}>
          {t('common.cancel')}
        </button>
      </p>
    </>
  );
}

/**
 * 待审快照里的时间，用同一套显示规则排出来。
 *
 * ⚠️ 快照是一个 `Record<string, unknown>`（服务端原样存的 payload），
 *    所以每个字段都要现判类型。判不出来就返回 null，界面上显示 `—` ——
 *    宁可少显示一行，也不要把 `undefined` 渲染出来。
 */
function pendingWhen(payload: Record<string, unknown>): string | null {
  const startsAtLocal = payload.startsAtLocal;
  const startsAtTz = payload.startsAtTz;
  if (typeof startsAtLocal !== 'string' || typeof startsAtTz !== 'string') return null;

  const when = eventWhen({
    startsAtLocal,
    startsAtTz,
    endsAtLocal: typeof payload.endsAtLocal === 'string' ? payload.endsAtLocal : null,
    endsAtTz: typeof payload.endsAtTz === 'string' ? payload.endsAtTz : null,
    allDay: payload.allDay === true,
  });
  if (!when) return null;
  return when.end ? `${when.start} - ${when.end} · ${when.zones}` : `${when.start} · ${when.zones}`;
}
