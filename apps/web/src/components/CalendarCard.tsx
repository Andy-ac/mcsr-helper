import type { CalendarEvent } from '@mcsr/shared/calendar';
import { isEventPast } from '@mcsr/shared/calendar';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { eventTitles, eventWhen, VIEWER_TZ, viewerWallClock } from '@/lib/calendarFormat';

/**
 * 日历列表的一张卡片。
 *
 * 和 ResourceCard 是同一种结构（整张卡就是一个 `<a>`），但时间那一块是
 * 日历独有的，也是它最要紧的地方 —— 见下面 `when` 的用法。
 */
export function CalendarCard({ event, now }: { event: CalendarEvent; now: number }) {
  const { t, i18n } = useTranslation();
  const when = eventWhen(event);
  const { primary, secondary } = eventTitles(event, i18n.language);

  /*
   * 「已结束」是**算出来的**，不是状态字段（见 shared/calendar.ts 的 isEventPast）。
   * 所以它显示成挂在时间旁边的标记，而不是一个可以被审批改变的状态值 ——
   * 文案也不能写得像是谁把它设成这样的。
   *
   * `now` 由父组件传进来而不是在这里 `Date.now()`：一次渲染里每张卡片各自
   * 取一次时间，会让列表页在跨过某个结束时刻的瞬间出现"两张卡片对同一时刻
   * 给出不同答案"的画面。父组件取一次、一起传下来，就不会有这种自相矛盾。
   */
  const past = isEventPast(event, now);

  // 整天事件不做时区换算 —— 理由见 calendarFormat.ts 的 viewerWallClock
  const mine = viewerWallClock(event.startsAtUtc, event.startsAtTz, event.allDay);

  return (
    <li>
      <Link
        className={`calendar-card${past ? ' calendar-card--past' : ''}`}
        to={`/calendar/${encodeURIComponent(event.id)}`}
        viewTransition
      >
        {/*
          时间块。
          ⚠️ 时区名**必须**和时间出现在同一块里（Q2）。单独一个 `20:00`
             是没有意义的信息：那是哪个 20:00？补上时区名之后，
             不在那个时区的用户才能自己换算。
        */}
        <div className="calendar-card__when">
          {when ? (
            <>
              <span className="calendar-card__date">{when.startShort}</span>
              {when.endShort ? (
                <span className="calendar-card__span">
                  {t('calendar.until', { time: when.endShort })}
                </span>
              ) : null}
              <span className="calendar-card__zone">{when.zones}</span>
            </>
          ) : (
            <span className="calendar-card__zone">{event.startsAtLocal}</span>
          )}
        </div>

        <div className="calendar-card__body">
          <div className="calendar-card__head">
            <span className="calendar-card__title">{primary}</span>
            {past ? <span className="badge badge--past">{t('calendar.pastBadge')}</span> : null}
          </div>

          {secondary ? <p className="calendar-card__alt">{secondary}</p> : null}

          <div className="badges">
            {event.allDay ? (
              <span className="badge badge--kind">{t('calendar.allDayBadge')}</span>
            ) : null}
            {/*
              标签 / 轮次 / 专业程度 / 参与范围一律走词条，**不显示枚举原始值**。
              `RANKED_MILESTONE` / `QUARTERFINAL` 这种字符串对用户没有意义，
              而且它和旁边那句翻译过的中文放在一起，会让人以为它们是两回事。

              ⚠️ 后两维**可空**（排位节点没有它们），所以是 `? … : null` ——
              **不是**"忘了渲染"。空值不显示是对的：显示一个空的徽章
              会让卡片上出现一块没有内容的色块。
            */}
            {event.tags.map((tag) => (
              <span key={tag} className="badge badge--kind">
                {t(`calendar.tag.${tag}`)}
              </span>
            ))}
            {event.stage ? (
              <span className="badge badge--kind">{t(`calendar.stage.${event.stage}`)}</span>
            ) : null}
            {/*
              专业程度和参与范围用**另一种底色**（badge--dim），和标签/轮次区分开：
              同一排里四个不同维度的徽章如果长得一模一样，用户读到的是
              "一个有五个标签的活动"，而不是"它在四个维度上各有取值"。
            */}
            {event.level ? (
              <span className="badge badge--dim">{t(`calendar.level.${event.level}`)}</span>
            ) : null}
            {event.scope ? (
              <span className="badge badge--dim">{t(`calendar.scope.${event.scope}`)}</span>
            ) : null}
          </div>

          {event.location ? <p className="calendar-card__place">{event.location}</p> : null}

          {/*
            观众自己时区下的时刻，**只在真的不一样时**才出现。
            它排在主时间的下面一行、用更淡的颜色：主办方公布的那个时间
            才是"这个活动是什么时候"的答案，这一行只是帮他换算。
          */}
          {mine ? (
            <p className="calendar-card__mine">
              {t('calendar.yourTime', { time: mine, tz: VIEWER_TZ })}
            </p>
          ) : null}
        </div>
      </Link>
    </li>
  );
}
