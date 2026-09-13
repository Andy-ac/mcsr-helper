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

  /*
   * 段数（多段时间，2026-09-13）。
   *
   * ⚠️ 判据取 `event.slots.length`，**不是** `when.slotsCount`：`when` 在第一段的
   *    墙钟字符串读不出来时是 null（见 calendarFormat 的 eventWhen），而"这场分
   *    三次打"和第一段能不能解析**毫无关系** —— 挂在 when 上的话，恰好是数据有
   *    问题的那一条会少掉这个提示，而它最需要这个提示。
   */
  const slotsCount = event.slots.length;

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

          ⚠️ 这里显示的是**第一段**（`eventWhen` 多段那一轮之后只给第一段），
             段数由下面那枚「共 N 段」徽章补上。为什么卡片只印第一段：
             这一行只有一行宽，把三段拼起来会写成
             `09-12 ~ 09-14, 09-20 ~ 09-21, 09-27`，而**跨三周**和**分三段打**
             在那一行里长得一模一样 —— 前者是连续的，后者中间是空的。
             完整的三段只有详情页那种有整行空间的版面放得下。
             （同一段论证在 calendarFormat.ts 的 `eventWhen` 注释里，改这里时一起看。）
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
              ★ 段数徽章（多段时间，2026-09-13）。紧跟「整天」那一枚 ——
              两枚都是**关于时间本身**的事实，排在一起读得通
              （"整天，共 3 段"），而夹在标签/维度中间会被读成又一个维度。

              ⚠️ 只在 `> 1` 时出现：单段是常态（绝大多数赛事就打一次），
                 给每一张卡都挂一枚「共 1 段」是纯粹的噪音 ——
                 与"评分 0 分不显示"同一条规矩。
            */}
            {slotsCount > 1 ? (
              <span className="badge badge--dim">
                {t('calendar.slotsCount', { count: slotsCount })}
              </span>
            ) : null}
            {/*
              标签一律走词条，**不显示枚举原始值**。
              `RANKED_MILESTONE` 这种字符串对用户没有意义，而且它和旁边那句
              翻译过的中文放在一起，会让人以为它们是两回事。
            */}
            {event.tags.map((tag) => (
              <span key={tag} className="badge badge--kind">
                {t(`calendar.tag.${tag}`)}
              </span>
            ))}
            {/*
              ★ 这里原来还有一枚**轮次**徽章（`calendar.stage.*`），2026-09-13 随
              需求⑥ 删掉了（用户要求「去掉轮次」）。

              ⚠️ 删的是**整条渲染**，不是"改成有值才显示"：`CalendarEvent.stage`
                 那一格还在类型上（为兼容旧快照），库里也仍然躺着老数据的
                 `FINAL` / `SEMIFINAL`。留条件渲染的话，那些老事件会把「决赛」
                 继续印在卡片上 —— 而用户已经说过界面上不要它了。
                 界面不读它，是"删干净"唯一能被验证的形状（见 `check:grid` 的反向断言）。

              ⚠️ 专业程度 / 参与范围 / **参赛门槛**（本轮新增）用另一种底色
                 （`badge--dim`），和标签区分开：同一排里几个不同维度的徽章如果
                 长得一模一样，用户读到的是"一个有五个标签的活动"，
                 而不是"它在三个维度上各有取值"。
            */}
            {event.level ? (
              <span className="badge badge--dim">{t(`calendar.level.${event.level}`)}</span>
            ) : null}
            {event.scope ? (
              <span className="badge badge--dim">{t(`calendar.scope.${event.scope}`)}</span>
            ) : null}
            {/*
              ⚠️ 三维**都可空**（排位节点没有它们），所以是 `? … : null` ——
                 **不是**"忘了渲染"。空值不显示是对的：显示一个空的徽章
                 会让卡片上出现一块没有内容的色块。
            */}
            {event.access ? (
              <span className="badge badge--dim">{t(`calendar.access.${event.access}`)}</span>
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
