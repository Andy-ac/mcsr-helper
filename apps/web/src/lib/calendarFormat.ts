/**
 * 日历的时间显示 —— **全站只有这一份**。
 *
 * ---------------------------------------------------------------------------
 * 为什么单独一个文件，而不是写在卡片组件里
 * ---------------------------------------------------------------------------
 * 「时间必须和时区名一起出现」（用户 Q2）这条约束要在**四个**地方成立：
 * 列表卡片、详情页、编辑页的预填、以及提交表单里的实时提示。
 * 写四遍的话，漏掉的那一处不会报任何错 —— 它只会安静地显示一个没有时区的
 * `20:00`，而那正是 Q2 要防的东西（"那是哪个 20:00？"）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 这里**只**负责显示，不负责换算
 * ---------------------------------------------------------------------------
 * 把"墙钟时间 + 时区名"变成一个**绝对时刻**的是
 * `shared/calendar-time.ts` 的 `wallClockToUtc`。本文件里的正则只把一个
 * **已知合法**的 `'YYYY-MM-DDTHH:mm'` 切成日期和时间两段给界面排版用，
 * 它不参与任何"这个时间到底指哪一刻"的判断。
 *
 * 两件事一旦混在一起，就会重演 calendar-time.ts 开头警告的那个失败模式：
 * 把本地时间当成 UTC —— 事件整体偏移几个小时，而偏移几个小时的赛事时间
 * 看起来完全正常，没有任何东西会报错。
 */

import type { CalendarEvent } from '@mcsr/shared/calendar';
import { utcToWallClock } from '@mcsr/shared/calendar-time';

/**
 * 观察者自己的时区。
 *
 * 模块加载时取一次：页面开着的时候它不会变，而每次渲染都调一次
 * `Intl.DateTimeFormat` 是没有意义的开销（列表里每条卡片都要用）。
 */
export const VIEWER_TZ: string = (() => {
  try {
    // ⚠️ 兜底是 `'UTC'` 而不是空串。空串会让下面每一处
    //    "和你那边一样吗"的判断都得出错误的答案（都判成"不一样"），
    //    于是每条卡片下面都会多出一行假的本地时间。
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();

export interface WallClockParts {
  /** '2026-08-30' */
  date: string;
  /** '08-30' —— 卡片左侧那一小块用的短日期 */
  short: string;
  /** '20:00' */
  time: string;
}

/**
 * 把一个墙钟字符串切成日期/时间两段。格式不对时返回 null。
 *
 * ⚠️ 它**不校验日期是否真实存在**（`2026-02-31` 也会被切开）。
 *    那种值根本走不到这里：能进到界面的时间都已经过 `CalendarEventInputSchema`
 *    和 `wallClockToUtc` 两道校验。在这里再加一道只会让"界面上的时间和
 *    数据库里的时间"多出一个可能不一致的判断点。
 */
export function wallClockParts(local: string | null | undefined): WallClockParts | null {
  if (!local) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(local);
  // 正则的捕获组在类型上都是 `string | undefined`，所以显式收一遍。
  // （用 `m[1]!` 之类的断言也过得了编译，但那会让"正则被改坏了"变成
  //   渲染出一个 `undefined-undefined`，而不是这里安静地返回 null。）
  const [, year, month, day, time] = m ?? [];
  if (!year || !month || !day || !time) return null;
  return { date: `${year}-${month}-${day}`, short: `${month}-${day}`, time };
}

/** 'YYYY-MM-DDTHH:mm' → 'YYYY-MM-DD HH:mm'。只是排版，不改变含义。 */
export function spaced(local: string): string {
  return local.replace('T', ' ');
}

export interface EventWhen {
  /** 完整开始：'2026-08-30 20:00'（整天事件没有时间部分） */
  start: string;
  /** 卡片用的短开始：'08-30 20:00' */
  startShort: string;
  /** 完整结束；没有结束时间时是 null */
  end: string | null;
  endShort: string | null;
  /** 时区行。首尾时区不同时写成 'Asia/Shanghai → Europe/London' */
  zones: string;
  allDay: boolean;
}

/**
 * 事件 → 界面上的时间显示。
 *
 * 三处判断都是有理由的：
 *
 *   1. **整天事件不带时间部分**。它存的确实是 `T00:00`，但把 `00:00` 显示出来
 *      会让人以为"这场比赛零点开始"。真正要说的信息是"9 月 5 日这一天"。
 *
 *   2. **同一天的结束时间只显示钟点**（'20:00 → 22:00' 而不是
 *      '20:00 → 08-30 22:00'）。重复一遍日期会让这一行变长，而它并没有多出信息。
 *
 *   3. **首尾时区不同时要两个都显示**。结束时间用另一个时区写是完全合法的
 *      （跨时区的线上赛很常见），只显示开始那个时区会让结束时间被读错。
 */
export function eventWhen(
  event: Pick<
    CalendarEvent,
    'startsAtLocal' | 'startsAtTz' | 'endsAtLocal' | 'endsAtTz' | 'allDay'
  >,
): EventWhen | null {
  const s = wallClockParts(event.startsAtLocal);
  if (!s) return null;
  const e = wallClockParts(event.endsAtLocal);

  const start = event.allDay ? s.date : `${s.date} ${s.time}`;
  const startShort = event.allDay ? s.short : `${s.short} ${s.time}`;

  let end: string | null = null;
  let endShort: string | null = null;
  if (e) {
    if (event.allDay) {
      // 整天事件里"结束日期和开始日期是同一天"等于没有额外信息（就是这一天）
      if (e.date !== s.date) {
        end = e.date;
        endShort = e.short;
      }
    } else if (e.date === s.date) {
      end = e.time;
      endShort = e.time;
    } else {
      end = `${e.date} ${e.time}`;
      endShort = `${e.short} ${e.time}`;
    }
  }

  const zones =
    event.endsAtTz && event.endsAtTz !== event.startsAtTz
      ? `${event.startsAtTz} → ${event.endsAtTz}`
      : event.startsAtTz;

  return { start, startShort, end, endShort, zones, allDay: event.allDay };
}

/**
 * 同一个时刻在**观察者自己**时区里的墙钟。没有意义时返回 null。
 *
 * 返回 null 的两种情况，各自的理由完全不同：
 *
 *   · **观察者的时区和事件的时区一样** —— 再显示一遍就是同一句话。
 *     （比字符串更可靠的判据只能是时区名本身：两个时区名不同但当下偏移
 *      恰好相同的组合是存在的，那时显示出来也不算错，只是多余。
 *      反过来按"墙钟字符串相同"来判断则会**漏掉**真正的区别。）
 *
 *   · **整天事件** —— ⚠️ 这条是正确性，不是省事。
 *     整天事件存的是它那个时区里的 00:00。把它换算到西边的时区会得到
 *     **前一天**的下午，于是"9 月 5 日的活动"在纽约用户那里显示成 9 月 4 日 ——
 *     一个凭空造出来的错误，而且看起来非常合理，没人会怀疑。
 *     日期类的时间在时区之间**不应该被换算**。
 */
export function viewerWallClock(
  utcMs: number | null,
  sourceTz: string,
  allDay: boolean,
): string | null {
  if (utcMs === null || allDay) return null;
  if (sourceTz === VIEWER_TZ) return null;
  const local = utcToWallClock(utcMs, VIEWER_TZ);
  return local ? spaced(local) : null;
}

/**
 * 时区名 → 此刻的偏移，例如 `'UTC+08:00'`。取不到时返回 null。
 *
 * 它存在的理由是**当场的确认**：时区名是一个要用户手打的字符串，
 * 而打对了和打错了在界面上长得一模一样（都是 `Asia/Shanghai` 这样一串字母）。
 * 显示出偏移，用户就能立刻看出自己填的那个是不是想要的 ——
 * 而不是等到活动时间在别人眼里偏移了几个小时才发现。
 *
 * 拿不到就返回 null（不显示），**不编一个**：显示一个错的偏移
 * 比不显示更糟，因为它会让用户相信自己填对了。
 */
export function zoneOffsetLabel(timeZone: string): string | null {
  if (!timeZone) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    }).formatToParts(new Date());
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    // 'GMT+08:00' → 'UTC+08:00'。UTC 自己会得到光秃秃的 'GMT'。
    // 老一些的实现没有 longOffset，会退化成 'GMT+8' 或干脆没有那一段 —— 两种都能显示。
    if (!name.startsWith('GMT')) return null;
    return name.replace('GMT', 'UTC');
  } catch {
    return null;
  }
}

/**
 * 标题按 Q19 显示。
 *
 * ⚠️ 英文界面下**没有英文标题就回退显示中文标题**，不是留空、更不是自动翻译。
 *    留空的后果是英文用户看到一条没有名字的活动，那比看到一句中文更糟 ——
 *    中文至少告诉他"这是什么"，而且他还能去问、去搜。
 *
 * 两边的标题相同时不重复显示（导入的数据里 `titleEn` 常等于 `title`）。
 */
export function eventTitles(
  event: Pick<CalendarEvent, 'title' | 'titleEn'>,
  lang: string,
): { primary: string; secondary: string } {
  const en = (event.titleEn ?? '').trim();
  const hasDistinctEn = en !== '' && en !== event.title.trim();
  if (lang === 'en') {
    return hasDistinctEn
      ? { primary: en, secondary: event.title }
      : { primary: event.title, secondary: '' };
  }
  return hasDistinctEn
    ? { primary: event.title, secondary: en }
    : { primary: event.title, secondary: '' };
}

/**
 * 时区输入框的建议值（`<datalist>`）。
 *
 * ⚠️ 是**建议**，不是白名单。用户仍然可以手打任何 IANA 名 ——
 *    世界上有几百个，列全是不可能的，而做成下拉框就等于把不能列的
 *    那些真实时区变成了"填不进去"。选中与否由 `isValidTimeZone` 判断，
 *    那是运行时唯一权威的判据。
 */
export const CALENDAR_TZ_SUGGESTIONS: readonly string[] = [
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Australia/Sydney',
  'UTC',
];

/**
 * 「给审核员的话」的字数上限。
 *
 * ⚠️ 这个数字在 `shared/calendar.ts` 的 schema 里是**写死的 500**，没有导出。
 *    表单用它做 `maxLength`（让用户根本打不超），schema 仍然是最终判据 ——
 *    两处不一致时表现是"界面放行、服务端拒绝"，而那会被 schema 的错误提示
 *    当场抓住，不会静默通过。
 */
export const CALENDAR_NOTE_MAX = 500;

/** 列表每页条数。服务端默认 50，这里小一些 —— 日历条目比资源库高，翻页比滚动快。 */
export const CALENDAR_PAGE_SIZE = 20;
