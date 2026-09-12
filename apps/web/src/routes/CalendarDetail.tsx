import type { CalendarEvent } from '@mcsr/shared/calendar';
import { isEventPast } from '@mcsr/shared/calendar';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { Notice } from '@/components/Form';
import { Markdown } from '@/components/Markdown';
import { ApiError, fetchCalendarEvent, fetchCalendarForEdit } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { eventTitles, eventWhen, VIEWER_TZ, viewerWallClock } from '@/lib/calendarFormat';
import { useCan } from '@/lib/capabilities';
import { useAsync } from '@/lib/useAsync';

/**
 * 日历事件详情 —— `/calendar/:id`。
 *
 * ---------------------------------------------------------------------------
 * 两个接口，先试"可编辑的"那一个
 * ---------------------------------------------------------------------------
 *   · `GET /api/calendar/mine/:id` —— 登录后可用。含**未发布**的条目和
 *     **正在等审核的那一版**（`pendingRevision` / `pendingPayload`）。
 *   · `GET /api/calendar/:id` —— 公开。未发布的一律 404。
 *
 * 顺序不能反：自己的草稿只有前者拿得到。而**登录了的话就一定要走前者**，
 * 否则"这条有一版改动在等审核"这件事在详情页上永远显示不出来 ——
 * 公开接口根本不知道有这回事。
 *
 * ⚠️ 和 EditResource 不同的是，这里的 404 要**分两种**处理：
 *    · 公开接口 404 → "这条还没上架"，不是错误，要给编辑入口
 *    · 其它失败（500 / 断网）→ 真的报错
 *    把 500 也显示成"还没上架"是在替服务端撒谎，用户会去反复刷新一个
 *    其实已经坏掉的页面。
 *    而 `useAsync` 只保留 `error.message`（拿不到状态码），所以这里在
 *    loader 里就把两种结果分开返回 —— 用 `ApiError.status` 判，不靠匹配 message 文本。
 */

type DetailResult =
  | { kind: 'ok'; event: CalendarEvent; pendingRevision: number | null }
  /** 公开接口明确回了 404：没上架，或者根本不存在 */
  | { kind: 'missing' };

/** abort 是我方主动取消，必须原样抛出去（useAsync 会忽略它，不当错误显示）。 */
function abortable(error: unknown): void {
  if (error instanceof DOMException && error.name === 'AbortError') throw error;
}

export function CalendarDetailPage() {
  const { t, i18n } = useTranslation();
  const { id = '' } = useParams();
  const auth = useAuth();
  // 审过内容的人看到的是「修改」，其它人看到的是「建议修改」—— 和资源库同一套用词
  const isContentEditor = useCan('calendar.review');

  const state = useAsync<DetailResult>(
    async (signal) => {
      if (auth.user) {
        const editable = await fetchCalendarForEdit(id, signal).catch((error: unknown) => {
          abortable(error);
          // 拿不到就不用它 —— 但**不报错**，公开接口还有一次机会
          return null;
        });
        if (editable) {
          return { kind: 'ok', event: editable.event, pendingRevision: editable.pendingRevision };
        }
      }
      try {
        const pub = await fetchCalendarEvent(id, signal);
        return { kind: 'ok', event: pub.event, pendingRevision: null };
      } catch (error) {
        abortable(error);
        if (error instanceof ApiError && error.status === 404) return { kind: 'missing' };
        throw error;
      }
    },
    [id, auth.loading, auth.user?.id],
  );

  if (auth.loading || state.status === 'loading') {
    return <p className="state">{t('common.loading')}</p>;
  }

  if (state.status === 'error') {
    return (
      <div className="state state--empty">
        <p className="state__title">{t('calendar.loadFailed')}</p>
        <p>{state.error}</p>
        <Link className="cta" to="/calendar">
          ← {t('calendar.backToList')}
        </Link>
      </div>
    );
  }

  if (state.data.kind === 'missing') {
    return <NotPublished id={id} />;
  }

  const { event, pendingRevision } = state.data;
  const when = eventWhen(event);
  const { primary, secondary } = eventTitles(event, i18n.language);
  const past = isEventPast(event, Date.now());
  const mine = viewerWallClock(event.startsAtUtc, event.startsAtTz, event.allDay);

  /*
   * 「建议修改」按**服务端 PATCH 的同一条规则**决定显不显示：
   *   · 已发布的 → 任何登录且验证过邮箱的人都能改（wiki 式，改动一样要过审核）
   *   · 未发布的 → 只有作者本人
   * 界面先把不该出现的入口收起来，是为了让"点进去被拦住"不发生；
   * 真正的拦截仍然在服务端。
   */
  const isAuthor = auth.user !== null && event.authorId !== null && auth.user.id === event.authorId;
  const canEdit = auth.user?.emailVerified === true && (event.status === 'published' || isAuthor);

  return (
    <article className="detail">
      <Link className="detail__back" to="/calendar">
        ← {t('calendar.backToList')}
      </Link>

      <header className="detail__head">
        <div className="detail__heading">
          <h1 className="detail__title">{primary}</h1>
          {/* Q19：没有英文标题时这里显示的是中文原文，而不是一个空白 */}
          {secondary ? <p className="detail__alt">{secondary}</p> : null}

          <div className="detail__meta">
            {/*
              状态用一个 badge（词条来自共用的 status.*，和「我的提交」一致）——
              同一个状态在两个页面上有同一种叫法，用户不用先猜它们是不是一回事。
            */}
            <span className={`badge badge--status-${event.status}`}>
              {t(`status.${event.status}`)}
            </span>
            {/* 「已结束」是算出来的，不是状态 —— 所以它是一个并列的标记，不是状态值 */}
            {past ? <span className="badge badge--past">{t('calendar.pastBadge')}</span> : null}
            {event.allDay ? (
              <span className="badge badge--kind">{t('calendar.allDayBadge')}</span>
            ) : null}
            {event.tags.map((tag) => (
              <span key={tag} className="badge badge--kind">
                {t(`calendar.tag.${tag}`)}
              </span>
            ))}
            {event.stage ? (
              <span className="badge badge--kind">{t(`calendar.stage.${event.stage}`)}</span>
            ) : null}
            <span className="badge badge--kind">
              {event.lang === 'en' ? t('resources.langEn') : t('resources.langZh')}
            </span>
          </div>

          {event.url ? (
            <a className="cta" href={event.url} target="_blank" rel="noopener noreferrer nofollow">
              {t('calendar.openLink')} ↗
            </a>
          ) : null}

          {canEdit ? (
            <div className="detail__actions">
              <Link className="ghostbtn" to={`/calendar/${encodeURIComponent(event.id)}/edit`}>
                {isContentEditor ? t('edit.modifyAction') : t('edit.suggestAction')}
              </Link>
              {isContentEditor ? (
                <span className="detail__actions-hint">{t('edit.editorHint')}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      {/*
        待审提示放在内容**之前**：这条正在等审核（或者你正在看的那一版和线上不同），
        是读这篇内容之前就该知道的前提，不是读完之后的一个补充说明。
      */}
      {pendingRevision !== null ? (
        <Notice kind="info">
          {t('calendar.pendingNotice', { revision: pendingRevision })}
          {isContentEditor ? (
            <>
              {' '}
              <Link to={`/review/calendar/${encodeURIComponent(event.id)}`}>
                {t('edit.busyGoReview')}
              </Link>
            </>
          ) : null}
        </Notice>
      ) : null}

      {past ? <Notice kind="info">{t('calendar.pastNotice')}</Notice> : null}

      {/*
        时间块。**时间永远和时区名一起出现**（Q2）——
        单独一个 `20:00` 是没有意义的信息。
        这里显示的是**用户填进去的那一行**（当地墙钟 + IANA 名），
        因为那才是可以和赛事公告逐字核对的东西；换算结果附在下面。
      */}
      <h2 className="related__title">{t('calendar.infoTitle')}</h2>
      <dl className="infotable">
        <dt>{t('calendar.fields.startsAt')}</dt>
        <dd>
          {when ? (
            <>
              <span className="calendar-time__value">{when.start}</span>
              <span className="calendar-time__zone">{when.zones}</span>
              {mine ? (
                <>
                  <br />
                  <span className="calendar-time__mine">
                    {t('calendar.yourTime', { time: mine, tz: VIEWER_TZ })}
                  </span>
                </>
              ) : null}
            </>
          ) : (
            event.startsAtLocal
          )}
        </dd>

        {when?.end ? (
          <>
            <dt>{t('calendar.fields.endsAt')}</dt>
            <dd>
              <span className="calendar-time__value">{when.end}</span>
              <span className="calendar-time__zone">{when.zones}</span>
            </dd>
          </>
        ) : null}

        <dt>{t('calendar.fields.location')}</dt>
        <dd>{event.location ?? '—'}</dd>

        <dt>{t('calendar.fields.url')}</dt>
        <dd>
          {event.url ? (
            <a href={event.url} target="_blank" rel="noopener noreferrer nofollow">
              {event.url}
            </a>
          ) : (
            '—'
          )}
        </dd>

        <dt>{t('calendar.fields.tags')}</dt>
        <dd>{event.tags.map((tag) => t(`calendar.tag.${tag}`)).join('、')}</dd>

        <dt>{t('calendar.fields.stage')}</dt>
        {/* 轮次是**可选**的，没填时要显示成"没填"而不是一个空白单元格 */}
        <dd>{event.stage ? t(`calendar.stage.${event.stage}`) : '—'}</dd>

        <dt>{t('calendar.fields.titleEn')}</dt>
        <dd>{event.titleEn ?? '—'}</dd>

        <dt>{t('calendar.author')}</dt>
        <dd>{event.authorName ?? t('review.unknownAuthor')}</dd>

        <dt>{t('calendar.updatedAt')}</dt>
        <dd>{new Date(event.updatedAt).toLocaleString()}</dd>

        <dt>{t('calendar.infoId')}</dt>
        <dd className="calendar-info__id">{event.id}</dd>
      </dl>

      {/*
        ⚠️ Markdown 走 components/Markdown.tsx，那是全站唯一的渲染入口 ——
        rehype-sanitize 必须生效，否则用户提交的 <img onerror=...>
        会在每个访客的浏览器里执行脚本。
      */}
      <Markdown>{event.descriptionMd}</Markdown>
    </article>
  );
}

/**
 * 「这条还没上架」。
 *
 * ⚠️ 公开接口对**待审**和**不存在**都返回 404（服务端刻意的：403 等于承认
 *    "这个 id 存在但你没权限"，那本身就是一条信息）。所以这里的话必须同时
 *    覆盖两种可能，不能写成"这条还在等审核" —— 那对打错地址的人来说
 *    是一个凭空造出来的事实。
 *
 * 但仍然要给编辑入口：这条 404 最可能的读者是**作者本人**（他刚提交完，
 * 想看看长什么样），而他没有别的地方能打开它。
 */
function NotPublished({ id }: { id: string }) {
  const { t } = useTranslation();
  const auth = useAuth();

  return (
    <div className="state state--empty">
      <p className="state__title">{t('calendar.notPublished')}</p>
      <p className="state__hint">{t('calendar.notPublishedHint')}</p>
      {auth.user ? (
        <Link className="cta" to={`/calendar/${encodeURIComponent(id)}/edit`}>
          {t('calendar.openEditor')}
        </Link>
      ) : null}
      <p className="submitgate">
        <Link className="authform__link" to="/calendar">
          ← {t('calendar.backToList')}
        </Link>
      </p>
    </div>
  );
}
