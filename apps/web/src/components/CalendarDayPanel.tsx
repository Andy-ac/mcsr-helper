import type { CalendarEvent } from '@mcsr/shared/calendar';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { CalendarCard } from '@/components/CalendarCard';
import { parseDateKey } from '@/components/CalendarGrid';

/**
 * 选中某一天之后的详情面板。
 *
 * ---------------------------------------------------------------------------
 * 为什么不是弹窗
 * ---------------------------------------------------------------------------
 * 弹窗（modal）有四个代价，而它换来的只有一个"浮在上面"的观感：
 *
 *   1. **打断**。切月、切日是这个页面最高频的动作，每点一天弹一次窗再关一次，
 *      是两次额外操作；而"丝滑"要求恰恰是这一步不能有中断。
 *   2. **手机上难用**。弹窗在小屏上要么全屏（那就等于换页，还多了一层遮罩）、
 *      要么挤在一角（可点的东西变少）。
 *   3. **焦点管理**。真正的模态需要焦点陷阱、Esc、aria-modal、滚动锁定 ——
 *      少做一样就是无障碍缺陷，而做全了是一大块与业务无关的代码。
 *   4. **和 View Transitions 打架**。网格切换时弹窗的层级会成为快照的一部分，
 *      表现是切月时弹窗内容跟着一起变形。
 *
 * 所以面板是**页面上的一块**，桌面在右侧、窄屏在网格下方 —— 同一份 DOM 顺序，
 * 只用 CSS 改布局（见 styles.css 的 `.grid-layout`）。
 */

interface Props {
  /** 选中的日期键；没有选中时为 null。 */
  day: string | null;
  /** 这一天的活动（**已经过筛选**，已按时间排好）。 */
  events: readonly CalendarEvent[];
  /** 传给卡片的"现在"，父组件取一次（理由见 CalendarCard 的注释）。 */
  now: number;
  /** 登录后才给"在这天加活动"的入口。 */
  canSubmit: boolean;
}

export function CalendarDayPanel({ day, events, now, canSubmit }: Props) {
  const { t, i18n } = useTranslation();

  if (!day) {
    return (
      <aside className="daypanel" aria-label={t('calendarGrid.dayPanelLabel')}>
        <p className="daypanel__hint">{t('calendarGrid.pickDayHint')}</p>
      </aside>
    );
  }

  /*
   * 标题里的日期同样**钉住 `timeZone: 'UTC'`**。
   * 理由和 CalendarMonthNav 里那段一模一样：不钉的话，
   * `Date.UTC(2026,10,14)` 在纽约会渲染成 **11 月 13 日**，
   * 于是标题写着 13 号、下面列的是 14 号的活动。
   */
  const parts = parseDateKey(day);
  const heading =
    parts === null
      ? day
      : new Intl.DateTimeFormat(i18n.language, {
          timeZone: 'UTC',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          weekday: 'long',
        }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)));

  return (
    <aside className="daypanel" aria-label={t('calendarGrid.dayPanelLabel')}>
      <div className="daypanel__head">
        <h2 className="daypanel__title">{heading}</h2>
        {canSubmit ? (
          /*
           * 「在这天加活动」直接跳到**真正的提交表单**，只是带上了日期。
           *
           * ⚠️ 刻意不做一个嵌在面板里的迷你表单：那两个表单一定会漂移
           *    （时区、整天、结束时间的成对校验、标签多选……），
           *    而漂移的表现是"从这里提交的活动和从提交页提交的不一样"，
           *    且只有对比过两边的人才会发现。
           */
          <Link className="cta daypanel__add" to={`/calendar/submit?date=${day}`}>
            + {t('calendarGrid.addOnDay')}
          </Link>
        ) : null}
      </div>

      {events.length === 0 ? (
        <p className="daypanel__empty">{t('calendarGrid.noEventsOnDay')}</p>
      ) : (
        <ul className="calendar-list daypanel__list">
          {events.map((event) => (
            <CalendarCard key={event.id} event={event} now={now} />
          ))}
        </ul>
      )}
    </aside>
  );
}
