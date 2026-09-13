import type { CalendarEvent, CalendarEventInput } from '@mcsr/shared/calendar';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { type CalendarDraft, CalendarForm, draftFromEvent } from '@/components/CalendarForm';
import { em } from '@/components/Emphasis';
import { Notice } from '@/components/Form';
import {
  ApiError,
  deleteCalendarEventDirect,
  fetchCalendarEvent,
  fetchCalendarForEdit,
  saveCalendarEventDirect,
  updateCalendarEvent,
} from '@/lib/api';
import { useApiErrorText, useAuth } from '@/lib/auth';
import { eventWhen } from '@/lib/calendarFormat';
import { useCan } from '@/lib/capabilities';
import { directWriteNotice } from '@/lib/directWriteNotice';

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
  /**
   * 需求②（t14）：有 `content.author` 的人才给「直接保存」与删除区。
   * ⚠️ 能力名从矩阵读 —— 页面里**不写"谁是编辑"**（见 permissions.ts 的头注释）。
   * ⚠️ 赛事是**一档**：不需要 `useCanHardDelete()` 来区分"能不能一键"——
   *    它没有下架入口，所以 editor+ 与 owner 走的是**同一条**直删路径。
   */
  const canAuthor = useCan('content.author');

  const [draft, setDraft] = useState<CalendarDraft | null>(null);
  /** 现在这一条有没有别人提的、还在等审核的改动 */
  const [pending, setPending] = useState<{
    revision: number;
    payload: Record<string, unknown>;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** 直编（需求②）的结果提示 —— 与 `failure` **分开存**，两者可能同时存在。 */
  const [directNotice, setDirectNotice] = useState<{ ok: boolean; text: string } | null>(null);
  /** 删除区的行内两步确认（与 `EditResource` 同一条约定：不用 `window.confirm`）。 */
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /**
   * 提交成功后的结果。
   *
   * ⚠️ 这里原来写着"`liveRevisionUnchanged` 决定要不要说'线上还是旧版'" —— 那是**过期的**
   * （该字段从没存在这个 state 里，而页面也不读它）。**别照抄到别处**：
   *    这条路的提审结果该怎么说，判据在 `lib/directWriteNotice.ts`（直编）与
   *    `submit.errAlreadyPending` 那一族（提审）；本页只记版本号。
   */
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

  /**
   * 「直接保存」（需求②，t14）—— 写线上行、不进审核队列。
   *
   * ⚠️ 文案走 `directWriteNotice`（与资料那边**同一处**判据），**不在页面里**再判一次
   *    `liveRevisionUnchanged`：那个字段对"已发布"与"草稿/待审"两种条目结果不同，
   *    前端自己推就会对其中一类撒谎。
   */
  async function onSubmitDirect(input: CalendarEventInput) {
    setFailure(null);
    setDirectNotice(null);
    setBusy(true);
    try {
      const result = await saveCalendarEventDirect(id, input);
      setDirectNotice({ ok: true, text: directWriteNotice(result, t) });
    } catch (error) {
      setFailure(
        error instanceof ApiError && error.code === 'already_pending'
          ? t('calendar.errAlreadyPending')
          : errorText(error),
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * 删除这一场活动（需求②，t14）—— **一档直删**。
   *
   * ⚠️ 赛事与资料/视频**不同**：它没有下架入口、也没有收藏/备注这类连带数据，
   *    所以这里**没有**"先下架再删除"那一步，界面上也**不会**出现那句话
   *    （服务端 `DELETE /api/authoring/calendar/:id` 写死 `force: true`）。
   *    ⚠️ 不要照抄 `EditResource` 的两档写法 —— 那会给出一个走进死路的提示。
   * ⚠️ 仍然**一次确认**：这是不可逆的（用户对"真正删除"的要求就是"加一次确认"）。
   */
  async function remove() {
    setConfirmingDelete(false);
    setDeleting(true);
    setFailure(null);
    setDirectNotice(null);
    try {
      await deleteCalendarEventDirect(id);
      navigate('/calendar', { replace: true });
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setDeleting(false);
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
      {/*
        ⚠️ 这句"改完之后线上还是旧版"**只对提审那条路成立**。editor 点的是「直接保存」时
           它直接生效，再挂这句话就是对用户撒谎 —— 所以有 `content.author` 时**换一句**、
           不再显示这句（`authoring.directHint` 已经把"直接生效"说清了，见按钮的 title）。
      */}
      {!canAuthor ? <p className="submitnote">{em(t('calendar.editLiveUnchanged'))}</p> : null}

      {directNotice ? (
        <Notice kind={directNotice.ok ? 'ok' : 'bad'}>{directNotice.text}</Notice>
      ) : null}

      {failure ? <Notice kind="bad">{failure}</Notice> : null}

      <CalendarForm
        initial={draft as CalendarDraft}
        actionLabel={t('calendar.editAction')}
        busyLabel={t('submit.submitting')}
        busy={busy}
        onSubmit={onSubmit}
        /*
         * 「直接保存」**只对 `content.author` 传下去**（需求②）。
         * ⚠️ 普通用户拿到 `undefined` ⇒ 按钮**根本不存在**，不是灰按钮。
         */
        secondaryAction={
          canAuthor
            ? {
                label: t('authoring.directSave'),
                busyLabel: t('submit.submitting'),
                onSubmit: (input) => void onSubmitDirect(input),
              }
            : undefined
        }
      />

      {/*
        ======================================================================
        删除区 —— **赛事是一档直删**（t14 的裁定）
        ======================================================================

        ⚠️ 与 `EditResource` **刻意不同**，别照抄那边：
          · 赛事**没有下架入口**（全仓没有任何把 `calendar_events.status` 写成 `'hidden'` 的地方，
            见 `ModerationBar` 只服务资源库），所以"先下架，再删除"这一步**不存在** ——
            写出来会是一句把人引向死路的提示；
          · 赛事也**没有**收藏/备注这类连带数据（那才是"资料/视频要两档"的原因）。
        ⇒ 所以这里**只有一次调用 + 一次确认**；editor+ 与 owner 走同一条路径
          （服务端 `DELETE /api/authoring/calendar/:id` 的 `force` 写死为 `true`）。
        ⚠️ 确认文案仍用 `authoring.deleteImpact`：不可逆的动作要说清代价。
      */}
      {canAuthor ? (
        <section className="dangerzone">
          <h2 className="dangerzone__title">{t('authoring.deleteTitle')}</h2>
          <p className="dangerzone__impact">{em(t('authoring.deleteImpact'))}</p>

          {confirmingDelete ? (
            <div className="dangerzone__confirm">
              <button
                type="button"
                className="dangerbtn"
                disabled={deleting}
                onClick={() => void remove()}
              >
                {t('authoring.deleteConfirmYes')}
              </button>
              <button
                type="button"
                className="ghostbtn"
                disabled={deleting}
                onClick={() => setConfirmingDelete(false)}
              >
                {t('authoring.deleteConfirmNo')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="dangerbtn"
              disabled={busy || deleting}
              onClick={() => setConfirmingDelete(true)}
            >
              {t('authoring.deleteAction')}
            </button>
          )}
        </section>
      ) : null}

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
