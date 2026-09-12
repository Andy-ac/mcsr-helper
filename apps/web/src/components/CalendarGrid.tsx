import type { CalendarEvent } from '@mcsr/shared/calendar';
import { isEventPast } from '@mcsr/shared/calendar';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { eventTitles } from '@/lib/calendarFormat';

/**
 * 月历表。
 *
 * ---------------------------------------------------------------------------
 * 日期算术全部走 `Date.UTC`，**不碰本地时区**
 * ---------------------------------------------------------------------------
 * 这个文件里每一个日期计算都只处理「年 / 月 / 日」三个整数，需要进位时
 * 交给 `Date.UTC` 处理（月长、闰年、跨年都归它管）。
 *
 * ⚠️ 刻意**不用** `new Date('2026-11-14')` 这种写法。它按 **UTC** 解析，
 *    而 `.getDate()` 之类的取值器按**本地时区**取 —— 在东八区，
 *    `new Date('2026-11-14').getDate()` 得到的是 **14**，
 *    但在西半球会得到 **13**。同一份数据在两个时区下渲染出不同的格子，
 *    而"某一天的活动跑到前一天去了"在日历上看起来完全正常。
 *    这里全程只用 `Date.UTC(...)` 和 `getUTC*`，所以运行机器的时区不参与。
 *
 * ⚠️ 另一个被刻意避开的东西：事件的日期**不换算时区**。
 *    一个写着 `2026-11-14T20:00 Asia/Shanghai` 的活动，属于**它的那个 11 月 14 日**，
 *    而不是观察者当地的某一天。这和 `calendarFormat.ts` 里
 *    「整天事件不做时区换算」是同一条理由：日期类的时间跨时区换算会
 *    凭空造出一天，而那看起来非常合理、没人会怀疑。
 */

// ---------------------------------------------------------------------------
// 月份与日期键
// ---------------------------------------------------------------------------

/** `{ year: 2026, month: 11 }`，**month 是 1–12**（不是 JS 的 0–11）。 */
export interface YearMonth {
  year: number;
  month: number;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `2026-11-14`。全文件用它当日期的主键。 */
export function dateKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** 把一个日期键拆回三个数字。格式不对返回 null（URL 是用户可以手打的）。 */
export function parseDateKey(key: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  /*
   * ⚠️ 光看格式不够。`2026-02-31` 形状完全合法，而它会被 Date.UTC 静默地
   *    进位成 3 月 3 日 —— 用户手打一个不存在的日期，界面就会显示**另一天**，
   *    而且不会有任何报错。所以回读一遍确认是同一个日期。
   */
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/** `2026-11`。月份在 URL 里的形状。 */
export function monthKey(ym: YearMonth): string {
  return `${ym.year}-${pad2(ym.month)}`;
}

export function parseMonthKey(key: string): YearMonth | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/** 加/减若干个月。进位交给 `Date.UTC`，闰年和跨年都不用自己算。 */
export function addMonths(ym: YearMonth, delta: number): YearMonth {
  const d = new Date(Date.UTC(ym.year, ym.month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** 这个月有多少天。 */
function daysInMonth(ym: YearMonth): number {
  return new Date(Date.UTC(ym.year, ym.month, 0)).getUTCDate();
}

/**
 * 某一天是星期几，**0 = 周一**（本表的周起点）。
 *
 * `getUTCDay()` 的 0 是**周日**，所以要做一次映射。
 * 写成 `(day + 6) % 7` 而不是 `day === 0 ? 6 : day - 1`：少一个分支，
 * 而且它对任何输入都成立（不会因为有人传了 0..6 之外的数而崩）。
 */
function mondayIndex(year: number, month: number, day: number): number {
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

export interface GridCell {
  /** `2026-11-14` */
  date: string;
  year: number;
  month: number;
  day: number;
  /** false = 属于相邻月份的补白格 */
  inMonth: boolean;
  /** 0 = 周一 … 6 = 周日 */
  col: number;
}

/**
 * 这个月要显示的全部格子（含前后补白），从周一开始。
 *
 * 行数是**算出来**的（4–6 行）而不是固定 6 行：固定 6 行时，
 * 一个 2 月（28 天且从周一开始）下面会挂着两整行空白，
 * 看起来像页面没加载完。
 */
export function buildGridCells(ym: YearMonth): GridCell[] {
  const lead = mondayIndex(ym.year, ym.month, 1);
  const total = daysInMonth(ym);
  const rows = Math.ceil((lead + total) / 7);
  const cells: GridCell[] = [];

  for (let i = 0; i < rows * 7; i += 1) {
    const d = new Date(Date.UTC(ym.year, ym.month - 1, 1 - lead + i));
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    cells.push({
      date: dateKey(year, month, day),
      year,
      month,
      day,
      inMonth: year === ym.year && month === ym.month,
      col: i % 7,
    });
  }
  return cells;
}

/**
 * 一个事件**覆盖哪几天**（闭区间，按事件自己的时区）。
 *
 * ⚠️ 一个事件可以出现在多个格子上，这是刻意的。
 *    真实数据里存在横跨 7 天的季后赛窗口（见 `docs/own-db-facts.md` §7），
 *    只标在第一天的话，"这场季后赛期间我在看日历"会看到一周的空白。
 *
 * 取值规则：
 *   · 有结束时间 → `[开始日, 结束日]` 闭区间。整天事件的"结束"本来就是
 *     **含**的那一天（见 CalendarForm 的提示），所以闭区间对整天和定时刻都成立。
 *   · 没有结束时间 → 只有开始那一天。
 *
 * 返回 `null` 表示这个事件的开始时间读不出来（格式坏了）—— 调用方应当**跳过它**
 * 而不是把它塞到某一天：塞进去的位置一定是错的，而"哪一天多了一个东西"
 * 在日历上很难被发现。
 */
export function eventDateRange(event: CalendarEvent): { from: string; to: string } | null {
  const s = parseDateKey(event.startsAtLocal.slice(0, 10));
  if (!s) return null;
  const from = dateKey(s.year, s.month, s.day);

  const e = event.endsAtLocal ? parseDateKey(event.endsAtLocal.slice(0, 10)) : null;
  if (!e) return { from, to: from };

  const start = Date.UTC(s.year, s.month - 1, s.day);
  const end = Date.UTC(e.year, e.month - 1, e.day);
  // 结束早于开始的数据不该出现（schema 挡着），真出现时按"一天"处理而不是
  // 让区间反着走 —— 反着走的区间在展开时会产生一个空集合，于是这个事件
  // 从日历上**整个消失**，而且没有任何报错。
  if (end < start) return { from, to: from };
  return { from, to: dateKey(e.year, e.month, e.day) };
}

/** 把事件按日期摊平成一个 Map：一天 → 那天覆盖到的事件（已排序）。 */
export function eventsByDate(events: readonly CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const range = eventDateRange(event);
    if (!range) continue;

    const [fy, fm, fd] = range.from.split('-').map(Number) as [number, number, number];
    const [ty, tm, td] = range.to.split('-').map(Number) as [number, number, number];

    for (let t = Date.UTC(fy, fm - 1, fd); t <= Date.UTC(ty, tm - 1, td); t += 86_400_000) {
      const d = new Date(t);
      const key = dateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
      const bucket = map.get(key);
      if (bucket) bucket.push(event);
      else map.set(key, [event]);
    }
  }

  // 一天之内按绝对时刻排序；同一时刻的按 id 兜底，保证顺序稳定
  // （否则两次渲染的顺序可能不同，React 会因为 key 的位置变化而重建 DOM）。
  for (const bucket of map.values()) {
    bucket.sort((a, b) => a.startsAtUtc - b.startsAtUtc || a.id.localeCompare(b.id));
  }
  return map;
}

/**
 * 观察者所在时区里的"今天"，形如 `2026-11-14`。
 *
 * ⚠️ 用 `formatToParts` 逐段取，而不是拼一个 `en-CA` 之类的区域设置再解析：
 *    区域设置的输出格式不保证（`en-CA` 现在给 `2026-11-14`，但那是实现细节）。
 *    逐段取是唯一不依赖格式约定的写法。
 *
 * 兜底返回 `''`：拿不到"今天"时**不标**任何一天是今天，
 * 而不是随便标一天 —— 标错的那一天会被用户当成事实。
 */
export function todayKeyInViewerTz(): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
    const y = get('year');
    const m = get('month');
    const d = get('day');
    return y && m && d ? `${y}-${m}-${d}` : '';
  } catch {
    return '';
  }
}

/** 每个格子最多画几条标记条，超出的收成 `+N`。 */
const MAX_BARS = 3;

/** 一个事件用哪个标签的颜色。取**标签表里的第一个**命中的，保证同一事件每次同色。 */
const TAG_ORDER = ['TOURNAMENT', 'COMMUNITY', 'RANKED_MILESTONE'] as const;
function primaryTag(event: CalendarEvent): string {
  for (const tag of TAG_ORDER) if (event.tags.includes(tag)) return tag;
  return 'OTHER';
}

export interface CalendarGridProps {
  ym: YearMonth;
  /** 这个月（含补白区）里的事件，**已经过筛选**。 */
  events: readonly CalendarEvent[];
  /** 当前选中的日期键，没有选中时为 null。 */
  selected: string | null;
  /** 观察者的"今天"，形如 `2026-11-14`。空串表示算不出来（见 todayKeyInViewerTz）。 */
  today: string;
  /** 传给卡片/格子的"现在"，由父组件取一次（理由见 CalendarCard 的注释）。 */
  now: number;
  onSelect: (date: string) => void;
}

export function CalendarGrid({ ym, events, selected, today, now, onSelect }: CalendarGridProps) {
  const { t, i18n } = useTranslation();

  const cells = useMemo(() => buildGridCells(ym), [ym]);
  const byDate = useMemo(() => eventsByDate(events), [events]);

  /*
   * 星期表头由 `Intl` 生成，**不写死十二个月/七个星期的词条**。
   * 语言切换时它自动跟着变，而手写两份（中/英）必然会有一份先过期。
   * ⚠️ 用 `short` 而不是 `narrow`：英文的 narrow 里 T 同时是周二和周四、
   *    S 同时是周六和周日 —— 一个分不清的表头比没有表头更糟。
   */
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(i18n.language, { weekday: 'short' });
    // 2026-11-02 是星期一（已核对）。
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2026, 10, 2 + i))));
  }, [i18n.language]);

  /*
   * 每个格子的无障碍名字里要有**完整的日期（含星期几）**。
   *
   * ⚠️ 为什么必须带星期：格子里那个数字对视力正常的用户有"星期表头 + 列位置"
   *    两层上下文，而屏幕阅读器用户没有列位置 —— 他听到"14"完全不知道是周几。
   *    所以表头是装饰性的（aria-hidden），星期信息从这里补进去。
   *
   * ⚠️ `timeZone: 'UTC'` 必须钉住：不钉的话西半球的机器会把 11 月 1 日
   *    念成 10 月 31 日，而这个格子标的是 11 月 1 日。
   */
  const dayLabelFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        timeZone: 'UTC',
        month: 'long',
        day: 'numeric',
        weekday: 'short',
      }),
    [i18n.language],
  );

  /*
   * 键盘焦点落在哪一格 —— **roving tabindex**。
   *
   * 42 个格子如果都可 Tab，键盘用户要按 42 次才能走出日历。
   * 所以只有一格 `tabIndex=0`（选中的那天，没有就今天，再没有就 1 号），
   * 其余 `-1`；进入网格后按方向键移动焦点。
   */
  const focusAnchor =
    (selected && cells.some((c) => c.date === selected) ? selected : null) ??
    (today && cells.some((c) => c.date === today) ? today : null) ??
    cells[0]?.date ??
    '';

  function moveFocus(from: string, deltaCols: number, deltaRows: number): void {
    const idx = cells.findIndex((c) => c.date === from);
    if (idx < 0) return;
    const col = idx % 7;
    const row = Math.floor(idx / 7);
    const nextCol = col + deltaCols;
    const nextRow = row + deltaRows;
    // 左右**不跨行**（跨行会让"往右按到底就跳到了下一周的第一天"这种意外动作出现）；
    // 上下保留列号。
    if (nextCol < 0 || nextCol > 6) return;
    if (nextRow < 0 || nextRow >= cells.length / 7) return;
    const target = cells[nextRow * 7 + nextCol];
    if (!target) return;
    /*
     * 焦点用 `querySelector` 找而不是把 42 个 ref 存进数组：
     * data 属性是 DOM 里现成的，而 ref 数组要在每次月切换后重建，
     * 那正是"某个月之后方向键突然不动了"的来源。
     */
    const el = document.querySelector<HTMLButtonElement>(`[data-grid-date="${target.date}"]`);
    el?.focus();
  }

  if (cells.length === 0) return null;

  return (
    <div className="grid">
      {/*
        ⚠️ 星期表头标成装饰性的（aria-hidden），而且刻意**不用**
        `role="grid"` / `role="row"` / `role="columnheader"`。
        那套 ARIA 是要实现完整表格模式的（行结构 + gridcell + 焦点管理），
        只写一半比不写更糟 —— 屏幕阅读器会按表格去理解它、然后找不到单元格。
        这里的格子是**按钮**，每个都带着完整的日期和"这天有什么"，本身就自解释；
        表头只是给视力正常用户的列提示（屏幕阅读器用户从每个格子的
        无障碍名字里就能听到星期几，见下面的 dayLabelFmt）。
      */}
      <div className="grid__head" aria-hidden="true">
        {weekdays.map((label) => (
          <span key={label} className="grid__weekday">
            {label}
          </span>
        ))}
      </div>

      <div className="grid__body">
        {cells.map((cell) => {
          const dayEvents = byDate.get(cell.date) ?? [];
          const shown = dayEvents.slice(0, MAX_BARS);
          const more = dayEvents.length - shown.length;
          const isToday = today !== '' && cell.date === today;
          const isSelected = selected === cell.date;
          const isPastDay = today !== '' && cell.date < today;

          /*
           * 无障碍名字要说清"这**是哪天**、这天**有什么**"。
           * 只念一个数字的话，走一遍网格等于听了 42 个没有上下文的数字。
           */
          const parsed = parseDateKey(cell.date);
          const humanDate = parsed
            ? dayLabelFmt.format(new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)))
            : cell.date;
          const { primary } = shown[0] ? eventTitles(shown[0], i18n.language) : { primary: '' };
          const label =
            dayEvents.length === 0
              ? t('calendarGrid.dayLabelEmpty', { date: humanDate })
              : t('calendarGrid.dayLabel', {
                  date: humanDate,
                  count: dayEvents.length,
                  first: primary,
                });

          return (
            <button
              key={cell.date}
              type="button"
              data-grid-date={cell.date}
              className={[
                'grid__day',
                cell.inMonth ? '' : 'grid__day--outside',
                isToday ? 'grid__day--today' : '',
                isSelected ? 'grid__day--selected' : '',
                isPastDay ? 'grid__day--past' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              tabIndex={cell.date === focusAnchor ? 0 : -1}
              aria-pressed={isSelected}
              aria-label={label}
              onClick={() => onSelect(cell.date)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  moveFocus(cell.date, -1, 0);
                } else if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  moveFocus(cell.date, 1, 0);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  moveFocus(cell.date, 0, -1);
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  moveFocus(cell.date, 0, 1);
                }
              }}
            >
              <span className="grid__num">{cell.day}</span>

              {/*
                标记条。**不往格子里堆文字** —— 那会让格子高度随内容变化，
                于是整个网格在切月时跳动，而"跳动的网格"正是要避免的不丝滑。
              */}
              <span className="grid__bars" aria-hidden="true">
                {shown.map((event) => (
                  <span
                    key={event.id}
                    className={[
                      'grid__bar',
                      `grid__bar--${primaryTag(event)}`,
                      isEventPast(event, now) ? 'grid__bar--past' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  />
                ))}
              </span>

              {more > 0 ? (
                <span className="grid__more" aria-hidden="true">
                  {t('calendarGrid.moreCount', { count: more })}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
