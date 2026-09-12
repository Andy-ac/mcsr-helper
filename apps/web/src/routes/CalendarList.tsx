import { CALENDAR_TAGS } from '@mcsr/shared';
import type { CalendarEvent } from '@mcsr/shared/calendar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { CalendarCard } from '@/components/CalendarCard';
import { CalendarDayPanel } from '@/components/CalendarDayPanel';
import { CalendarFilters } from '@/components/CalendarFilters';
import {
  addMonths,
  buildGridCells,
  CalendarGrid,
  eventsByDate,
  monthKey,
  parseDateKey,
  parseMonthKey,
  todayKeyInViewerTz,
  type YearMonth,
} from '@/components/CalendarGrid';
import { CalendarIcsSubscribe } from '@/components/CalendarIcsSubscribe';
import { CalendarMonthNav } from '@/components/CalendarMonthNav';
import { type CalendarListResponse, fetchCalendarEvents } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CALENDAR_PAGE_SIZE } from '@/lib/calendarFormat';
import { useAsync } from '@/lib/useAsync';

/**
 * 日历 —— `/calendar`。**两个视图**：月历表（默认）和列表。
 *
 * ---------------------------------------------------------------------------
 * 为什么两个都留着
 * ---------------------------------------------------------------------------
 * 它们回答的是两个不同的问题：
 *   · 月历表 —— "那件事是什么时候？"（时间轴上的位置，一眼看出这周有没有空）
 *   · 列表   —— "接下来有什么？"（按时间排的清单，可以一直往下滚）
 * 删掉任何一个都是净损失，所以是一个开关而不是替换。
 *
 * ---------------------------------------------------------------------------
 * ⚠️⚠️ 两个视图的筛选**不在同一层做**，这是刻意的
 * ---------------------------------------------------------------------------
 *   · **月历表**：一个月的（其实是网格覆盖的那 40 来天）数据**一次全拉回来**，
 *     四个维度**全在客户端筛**。
 *   · **列表**：服务端筛 + 服务端分页（它是无限的，客户端筛不了）。
 *
 * 为什么月历表要挪到客户端：
 *   1. 换一个筛选项**不需要再打一次请求**，改完立刻生效 —— 这就是"丝滑"里
 *      最容易被感知到的那一半（网络往返是这里唯一会让人觉得卡的东西）。
 *   2. ★ 于是「一个标签都不选」可以**诚实地**表示成空网格。
 *      服务端表达不了这件事：`tags` 空数组和不传是同一个查询（= 全都给我）。
 *      所以旧版有一条"最后一个标签关不掉"的规则 —— 那是一个**为了迁就服务端
 *      而撒在界面上的谎**。现在它被删掉了。
 *
 * ⚠️ 列表视图那边服务端仍然做筛选，所以"一个标签都不选"在那边**不发请求**、
 *    直接渲染空状态（见 listSkipped）。两边因此是**一致的**：
 *    "一个都不选 = 什么都不显示"。这一条比"保持旧行为"更重要，
 *    因为旧行为是"关不掉"或者"关掉了却显示全部" —— 两个都在骗人。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 月历表**不显示骨架屏**，除了第一次加载
 * ---------------------------------------------------------------------------
 * 闪一下空网格是"不丝滑"的主要来源：用户点"下个月"，屏幕上先空一拍再出现内容，
 * 看起来像卡了一下。所以切月时**继续显示上个月**，直到新数据到位再一起换
 * （见 useMonthData 的 committed），换的那一下跑一个 View Transition。
 */

type View = 'month' | 'list';

/** 列表视图不请求时的空结果（形状和接口一致，免得下面要分两条渲染路径）。 */
const EMPTY_LIST: CalendarListResponse = {
  items: [],
  total: 0,
  page: 1,
  pageSize: CALENDAR_PAGE_SIZE,
};

// ---------------------------------------------------------------------------
// 月历表的数据：**保留上一份**直到新的到位
// ---------------------------------------------------------------------------

interface MonthData {
  /** 这份数据属于哪个月（`2026-11`）。它是"要不要重新拉"的判据。 */
  key: string;
  events: CalendarEvent[];
}

/**
 * 拉某个月的数据，并且**在数据到达之前一直保留上一份**。
 *
 * `useAsync` 用不了：它在依赖变化时立刻把状态设成 `loading`，于是必须先渲染
 * 一次"没有数据"的中间态 —— 那就是空网格闪一下。这里多存一个 `committed`，
 * 把"要拉哪个月"和"现在显示的是哪个月"分成两件事。
 *
 * ⚠️ 竞态的处理是**abort + 丢弃**，两条都要：
 *    abort 让请求别再传回来；而 `alive` 标志挡住"已经 abort 但 promise 还是
 *    resolve 了"的那种情况。少了后一条，快速连点"下个月"会让**先发出的那次**
 *    最后落地，于是网格停在中间某个月上。
 */
function useMonthData(ym: YearMonth, active: boolean) {
  const [committed, setCommitted] = useState<MonthData | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const want = monthKey(ym);
  const have = committed?.key ?? null;

  /** 上一次提交的是哪个月 —— 用来判断切换方向（决定动画往哪边滑）。 */
  const prevKey = useRef<string | null>(null);

  useEffect(() => {
    if (!active) return;
    if (have === want) return; // 已经是这个月了，什么都不用做

    const controller = new AbortController();
    let alive = true;
    setPending(true);

    const range = gridRangeUtc(ym);
    fetchCalendarEvents({ from: range.from, to: range.to, pageSize: 200 }, controller.signal)
      .then((res) => {
        if (!alive) return;
        const next: MonthData = { key: want, events: res.items };
        const dir = prevKey.current === null || want > prevKey.current ? 'next' : 'prev';

        /*
         * ★ 提交这一步包在 View Transition 里。
         *
         * 因为数据**已经到手了**，回调里只有一次同步的状态更新，所以
         * "旧的网格"和"新的网格"都是完整的 —— 动画是两帧真实内容之间的形变，
         * 而不是"内容 → 空白 → 内容"。
         *
         * `flushSync` 是必须的：View Transitions 要求回调**同步地**把 DOM
         * 改完，而 React 的状态更新默认是异步批量处理的 —— 不 flush 的话，
         * 浏览器会在 DOM 还没变的时候就去拍"新"快照，于是新旧两张快照一模一样，
         * 表现为"点了没反应"。
         */
        const apply = (): void => {
          setCommitted(next);
          prevKey.current = want;
          setError(null);
        };
        startGridTransition(dir, apply);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setPending(false);
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [active, want, have, ym]);

  return { committed, pending, error };
}

/**
 * 跑一次网格的 View Transition。
 *
 * ⚠️ 拿不到 View Transitions 时**直接 apply** —— 不是退化成另一套动画，
 *    而是不做动画。数据照样换、功能完全一样，只是没有形变。
 *    （这个仓库在 `main.tsx` 里用 `html.vt` 区分两条路，那是给**路由切换**用的；
 *     这里是页面**内部**的一次切换，所以直接对 API 做特性检测更准 ——
 *     那个类名是否加在 <html> 上由另一个文件决定，依赖它会让这里的动画
 *     在某次 main.tsx 的改动之后静默消失。）
 */
function startGridTransition(dir: 'next' | 'prev', apply: () => void): void {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => { finished: Promise<void> };
  };
  if (typeof doc.startViewTransition !== 'function') {
    apply();
    return;
  }

  const root = document.documentElement;
  root.dataset.gridDir = dir;
  const transition = doc.startViewTransition(() => {
    flushSync(apply);
  });
  // 动画结束（或被跳过）之后把方向标记摘掉，否则它会一直留在 <html> 上，
  // 让**下一次**由别的原因触发的过渡也按这个方向滑。
  void transition.finished.finally(() => {
    delete root.dataset.gridDir;
  });
}

/**
 * 网格要覆盖的那段 UTC 时间窗。
 *
 * ⚠️ **两侧各留一天**，这不是保守，是必须的。
 *
 * 事件的日期是**它自己时区里的**日期，而这里要比较的是 UTC 时刻：
 * 东八区的 `2026-11-01T00:00` 换算出来是 `2026-10-31T16:00Z` —— 落在
 * "11 月 1 日 00:00Z"的**前面**。不留余量的话，每个月初和月末都会有几个事件
 * 落在窗口外，**从日历上静默消失**（它们在自己的详情页里还好好的，
 * 所以更像"日历偶尔漏东西"）。
 *
 * 世界上最大的偏移是 ±14 小时，小于一天，所以各留一天完全够，
 * 而且多取的这一天不会显示成多出来的格子（格子是按日期算的，不是按窗口算的）。
 */
function gridRangeUtc(ym: YearMonth): { from: number; to: number } {
  const cells = buildGridCells(ym);
  const fallback = `${monthKey(ym)}-01`;
  const first = cells[0]?.date ?? fallback;
  const last = cells[cells.length - 1]?.date ?? fallback;
  const f = parseDateKey(first);
  const l = parseDateKey(last);
  const from = f ? Date.UTC(f.year, f.month - 1, f.day) - 86_400_000 : 0;
  const to = l ? Date.UTC(l.year, l.month - 1, l.day) + 2 * 86_400_000 - 1 : 0;
  return { from, to };
}

// ---------------------------------------------------------------------------
// 页面
// ---------------------------------------------------------------------------

export function CalendarList() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const auth = useAuth();

  const view: View = params.get('view') === 'list' ? 'list' : 'month';
  const today = useMemo(() => todayKeyInViewerTz(), []);

  const urlMonth: YearMonth = (() => {
    const parsed = parseMonthKey(params.get('month') ?? '');
    if (parsed) return parsed;
    // 没有（或非法）`?month=` 时落在"今天所在的月"。
    // ⚠️ 非法值静默回退，而不是报错：URL 是用户可以手打的，
    //    而一个手抖的 `?month=abc` 不该让整页变成错误页。
    const d = parseDateKey(today);
    return d ? { year: d.year, month: d.month } : { year: 2026, month: 1 };
  })();

  // ---- 筛选状态（两个视图共用，都在 URL 里）----

  /*
   * ⚠️ `?tags=` 存在但为空串 ⇒ **一个标签都不选**（诚实的空结果）。
   *    参数**不存在** ⇒ 三个都选上（Q1 的默认：一进来三条都亮着）。
   *
   *    旧版把"存在但为空"也当成"全上"，于是界面上没有任何状态能表示"一个都不要"，
   *    只能靠一条"最后一个关不掉"的规则兜着。现在这一层不用再撒谎了。
   *
   * ⚠️ 只保留 CALENDAR_TAGS 里真实存在的值：`?tags=FOO` 里的 FOO 在客户端筛
   *    会永远不命中，而用户看到的是一个空网格、完全不知道是自己手打的参数有问题。
   */
  /*
   * ⚠️ 显式写成 `string[]` 而不是让它推出 `CalendarTag[]`。
   *    事件的 `tags` 在 `CalendarEvent` 上是 `string[]`（数据库里的值，
   *    将来可能多出别的标签），推成联合类型的话 `tags.includes(e.tags[0])`
   *    会编译不过 —— 而那时的"修法"往往是加一个 `as`，把真正的类型宽松
   *    悄悄改成断言。
   */
  const tags: string[] = useMemo(() => {
    if (!params.has('tags')) return [...CALENDAR_TAGS];
    const raw = params.get('tags') ?? '';
    return CALENDAR_TAGS.filter((tag) => raw.split(',').includes(tag));
  }, [params]);

  const level = params.get('level');
  const scope = params.get('scope');
  const stage = params.get('stage');
  const showPast = params.get('past') === '1';
  const page = Math.max(Number(params.get('page') ?? '1') || 1, 1);

  const dirty =
    tags.length !== CALENDAR_TAGS.length ||
    level !== null ||
    scope !== null ||
    stage !== null ||
    showPast;

  function write(mutate: (p: URLSearchParams) => void, replace = false): void {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        mutate(next);
        return next;
      },
      { replace },
    );
  }

  /** 换筛选条件要回到第一页 —— 否则会停在一个已经不存在的页码上。 */
  function afterFilterChange(p: URLSearchParams): void {
    p.delete('page');
  }

  function toggleTag(tag: string): void {
    write((p) => {
      const on = tags.includes(tag);
      const next = on ? tags.filter((x) => x !== tag) : [...tags, tag];
      /*
       * 三个都选 = 默认状态，把参数删掉让 URL 干净；
       * 一个都不选要**显式写出来**（`tags=`），因为"参数不存在"的含义是"全上"。
       */
      if (next.length === CALENDAR_TAGS.length) p.delete('tags');
      else p.set('tags', next.join(','));
      afterFilterChange(p);
    });
  }

  function pickSingle(dim: 'level' | 'scope' | 'stage', value: string | null): void {
    write((p) => {
      if (value === null) p.delete(dim);
      else p.set(dim, value);
      afterFilterChange(p);
    });
  }

  function resetFilters(): void {
    write((p) => {
      p.delete('tags');
      p.delete('level');
      p.delete('scope');
      p.delete('stage');
      p.delete('past');
      afterFilterChange(p);
    });
  }

  function setShowPast(value: boolean): void {
    write((p) => {
      if (value) p.set('past', '1');
      else p.delete('past');
      afterFilterChange(p);
    });
  }

  // ---- 视图切换 ----

  function setView(next: View): void {
    write((p) => {
      if (next === 'month') p.delete('view');
      else p.set('view', next);
      // 页码只对列表有意义，切回去时不该沿用
      p.delete('page');
    });
  }

  // ---- 月份切换 ----

  function goMonth(target: YearMonth): void {
    write((p) => {
      const d = parseDateKey(today);
      if (d && d.year === target.year && d.month === target.month) p.delete('month');
      else p.set('month', monthKey(target));
      /*
       * ⚠️ 换月要清掉选中的那天：`?d=2026-11-14` 在 12 月的网格里**不存在**，
       *    留着它的结果是右侧面板显示着 11 月 14 日的活动、而网格是 12 月 ——
       *    两个地方对不上，而且没有任何报错。
       *    （点相邻月份的补白格时**不走这里**，那条路要保留用户点的那一天，
       *      见 selectDay。它的 month 和 d 是一次写完的。）
       */
      p.delete('d');
    });
  }

  function selectDay(date: string): void {
    const d = parseDateKey(date);
    if (!d) return;
    const inMonth = d.year === urlMonth.year && d.month === urlMonth.month;

    /*
     * 点相邻月份的补白格 = "我要去那个月的那一天"。
     * 只改 `d` 不改 `month` 的话，选中的那天在网格之外，面板会显示一天
     * 网格上根本看不到的活动。
     *
     * ⚠️ `month` 和 `d` 在**同一次** write 里改完，不要分两次调用。
     *    两次调用的正确性依赖"函数式更新会按顺序叠加"这个实现细节，
     *    而它一旦不成立，表现是"跨月点一天只生效了一半" ——
     *    一半的状态看起来完全正常（网格换了、面板没换，或者反过来）。
     */
    write((p) => {
      if (!inMonth) {
        const t0 = parseDateKey(today);
        if (t0 && t0.year === d.year && t0.month === d.month) p.delete('month');
        else p.set('month', monthKey({ year: d.year, month: d.month }));
      }
      p.set('d', date);
    });
  }

  function goToday(): void {
    const d = parseDateKey(today);
    if (!d) return;
    write((p) => {
      // 今天就在当前显示的这个月里时把 `month` 删掉，URL 短一点也更好读
      const t0 = parseDateKey(today);
      if (t0 && t0.year === shownMonth.year && t0.month === shownMonth.month) p.delete('month');
      else p.set('month', monthKey({ year: d.year, month: d.month }));
      p.set('d', today);
    });
  }

  // ---- 数据 ----

  /*
   * ⚠️ 两个 hook 都要**无条件**调用（React 的规则：hook 不能放在分支里），
   *    所以"这个视图不用它"表达成 `enabled = false` 或者返回一个空结果。
   */
  const month = useMonthData(urlMonth, view === 'month');

  /*
   * 列表视图：服务端筛选 + 分页。
   * ⚠️ 一个标签都不选时**根本不发请求**（listSkipped）：服务端把"空 tags"
   *    当成"不加条件"，直接问它会拿回全部内容 —— 那正是旧版用"关不掉"来回避的谎。
   */
  const listSkipped = view === 'list' && tags.length === 0;
  const listQuery = useMemo(
    () => ({
      /*
       * ⚠️ `from` 是**三态**（见 fetchCalendarEvents 的 JSDoc）：
       *    · undefined → 服务端按"现在"过滤，也就是默认只看还没结束的（Q5）
       *    · 0         → 等价于"连已结束的也一起给我"
       *    所以这里传的是 `undefined` 或 `0`，不是"现在的时间戳"。
       */
      from: showPast ? 0 : undefined,
      tags: tags.length > 0 ? tags : undefined,
      level,
      scope,
      stage,
      page,
      pageSize: CALENDAR_PAGE_SIZE,
    }),
    [showPast, tags, level, scope, stage, page],
  );

  const list = useAsync(
    (signal) =>
      listSkipped || view !== 'list'
        ? Promise.resolve(EMPTY_LIST)
        : fetchCalendarEvents(listQuery, signal),
    [view, listSkipped, JSON.stringify(listQuery)],
  );

  /*
   * ⚠️ 「已结束」按**这一次渲染的时刻**算，取一次传下去。
   *    每张卡片各自 Date.now() 的话，页面在跨过某个结束时刻的瞬间会出现
   *    "两张卡片对同一时刻给出不同答案"的画面（同 CalendarCard 的注释）。
   */
  const now = Date.now();

  // ---- 月历表的派生数据 ----

  const shownMonth = month.committed ? (parseMonthKey(month.committed.key) ?? urlMonth) : urlMonth;
  const rawEvents = month.committed?.events ?? [];

  /*
   * 客户端筛选（月历表专用）。四个维度的语义和 api.ts 上写的**完全一致**：
   * 标签是"任一命中"，另外三个是"等于"。
   *
   * ⚠️ 这一份判据必须和服务端那份对得上，否则两个视图筛出来的东西不一样，
   *    而"切一下视图结果就变了"是最难被归因的那类不一致。
   *    服务端那份在 routes/calendar.ts + calendar/events.ts 的 listEvents。
   */
  const filtered = useMemo(() => {
    // 一个标签都不选 → 空网格。这是**诚实的**：用户说他什么都不想看。
    if (tags.length === 0) return [];
    return rawEvents.filter((e) => {
      if (!e.tags.some((tag) => tags.includes(tag))) return false;
      if (level !== null && e.level !== level) return false;
      if (scope !== null && e.scope !== scope) return false;
      if (stage !== null && e.stage !== stage) return false;
      return true;
    });
  }, [rawEvents, tags, level, scope, stage]);

  const byDate = useMemo(() => eventsByDate(filtered), [filtered]);

  /**
   * 选中的那天。
   *
   * ⚠️ 三层回退，每一层都有理由：
   *   1. URL 里的 `d`，但它必须在**当前显示的月份**里 —— 否则（比如手打的
   *      或者从别的月份分享过来的链接）面板会显示一天网格上看不到的活动。
   *   2. 今天，如果今天就在这个月里 —— 打开日历最想知道的是"今天有什么"。
   *   3. null（面板显示一句提示）。
   */
  const selectedDay = useMemo(() => {
    const fromUrl = params.get('d');
    const cells = buildGridCells(shownMonth);
    if (fromUrl && cells.some((c) => c.date === fromUrl)) return fromUrl;
    if (today && cells.some((c) => c.date === today)) return today;
    return null;
  }, [params, shownMonth, today]);

  const dayEvents = selectedDay ? (byDate.get(selectedDay) ?? []) : [];

  const totalPages =
    list.status === 'ok' ? Math.max(1, Math.ceil(list.data.total / CALENDAR_PAGE_SIZE)) : 1;

  return (
    <>
      <header className="pagehead">
        <div className="pagehead__row">
          <h1 className="pagehead__title">{t('nav.calendar')}</h1>

          {/*
            视图开关。两个视图回答两个不同的问题（见文件头），所以是**并列**的
            两个选项，不是"主视图 + 次要入口"。

            ⚠️ 它复用 `.tagchip` / `.tagchip--on`，**没有自己的选中样式**。
               "已选中长什么样"全站只有一处定义（styles.css 里那一组），
               再写一份就是下一次"改了一处漏一处"的开始。
               前缀一个标签是为了让它和旁边的筛选 chip 区分开 ——
               否则用户会以为"列表"也是一个筛选维度。

            ⚠️ 用 `<fieldset>` 而不是 `<div role="group">`：
               后者是 ARIA 在补 HTML 的缺，而 HTML 本来就有这个元素
               （分组 + 一个组名）。`<legend>` 用 sr-only ——
               可见的那句"显示方式"已经在同一行里了，不需要念两遍。
          */}
          <fieldset className="viewswitch">
            <legend className="sr-only">{t('calendarGrid.viewSwitchLabel')}</legend>
            <span className="tagcloud__label" aria-hidden="true">
              {t('calendarGrid.viewSwitchLabel')}
            </span>
            <button
              type="button"
              className={`tagchip${view === 'month' ? ' tagchip--on' : ''}`}
              aria-pressed={view === 'month'}
              onClick={() => setView('month')}
            >
              {t('calendarGrid.viewMonth')}
            </button>
            <button
              type="button"
              className={`tagchip${view === 'list' ? ' tagchip--on' : ''}`}
              aria-pressed={view === 'list'}
              onClick={() => setView('list')}
            >
              {t('calendarGrid.viewList')}
            </button>
          </fieldset>

          {/*
            和资源库同一个约定：「提交」是**这个版块的动作**，所以它长在这一页的
            标题右边，而不是侧边栏里多一个全局条目。仅登录后可见：没登录的人
            点进去只会被弹回来，而"看得见、点不动"比"看不见"更让人困惑。
          */}
          {auth.user ? (
            <Link className="cta pagehead__action" to="/calendar/submit">
              + {t('calendar.submitAction')}
            </Link>
          ) : null}
        </div>
        <p className="pagehead__sub">{t('calendar.listSubtitle')}</p>
      </header>

      {/*
        ★ 筛选栏排在内容最前面（用户要的"最上方"）。
        ⚠️ 它排在 ICS 订阅**之前**，这和旧版的顺序相反 —— 旧版把订阅放在最前是
           为了让人找得到它（M4 的验收标准之一）。现在它仍然是紧随其后的第二块，
           而筛选是高频动作、订阅是一次性动作，高频的排在前面更合理。
      */}
      <CalendarFilters
        tags={tags}
        onToggleTag={toggleTag}
        level={level}
        scope={scope}
        stage={stage}
        onPick={pickSingle}
        dirty={dirty}
        onReset={resetFilters}
        showPast={view === 'list' ? showPast : undefined}
        onShowPast={view === 'list' ? setShowPast : undefined}
      />

      <CalendarIcsSubscribe />

      {view === 'month' ? (
        <>
          <div className="grid-toolbar">
            <CalendarMonthNav
              ym={shownMonth}
              isPending={month.pending}
              onPick={(ym) => goMonth(ym)}
              onStep={(delta) => goMonth(addMonths(urlMonth, delta))}
              onToday={goToday}
            />
            <p className="grid-toolbar__count">
              {tags.length === 0
                ? t('calendarGrid.noTagsSelected')
                : t('calendarGrid.rangeCount', { count: filtered.length })}
            </p>
          </div>

          {month.error ? (
            <div className="state state--error">
              <p>
                {t('calendar.loadFailed')}：{month.error}
              </p>
            </div>
          ) : null}

          {!month.committed && !month.error ? (
            <GridSkeleton />
          ) : month.committed || month.error ? (
            /*
             * ⚠️ 这里包一层是因为要给它一个**稳定的 view-transition-name**。
             *    不稳定的名字（比如带上月份）会让浏览器每次都当成"一个全新的
             *    元素"，于是过渡退化成"旧的淡出、新的淡入"，
                而不是网格整体从一个月的布局形变到另一个月。
             */
            <div className="grid-layout">
              <div className="grid-morph">
                <CalendarGrid
                  ym={shownMonth}
                  events={filtered}
                  selected={selectedDay}
                  today={today}
                  now={now}
                  onSelect={selectDay}
                />
              </div>

              <CalendarDayPanel
                day={selectedDay}
                events={dayEvents}
                now={now}
                canSubmit={auth.user !== null}
              />
            </div>
          ) : null}
        </>
      ) : (
        <div className="calendar-listview">
          {listSkipped ? (
            <div className="state state--empty">
              <p className="state__title">{t('calendarGrid.noTagsSelected')}</p>
              <p className="state__hint">{t('calendarGrid.noTagsHint')}</p>
              <button type="button" className="filters__clear" onClick={resetFilters}>
                {t('calendarGrid.filterReset')}
              </button>
            </div>
          ) : (
            <>
              {list.status === 'loading' ? <CalendarSkeleton /> : null}

              {list.status === 'error' ? (
                <div className="state state--error">
                  <p>
                    {t('calendar.loadFailed')}：{list.error}
                  </p>
                </div>
              ) : null}

              {list.status === 'ok' ? (
                <>
                  <p className="resultcount">
                    {t('calendar.resultCount', { count: list.data.total })}
                  </p>

                  {list.data.items.length === 0 ? (
                    <div className="state state--empty">
                      <p className="state__title">{t('calendar.empty')}</p>
                      <p className="state__hint">{t('calendar.emptyHint')}</p>
                    </div>
                  ) : (
                    <ul className="calendar-list">
                      {list.data.items.map((event) => (
                        <CalendarCard key={event.id} event={event} now={now} />
                      ))}
                    </ul>
                  )}

                  {totalPages > 1 ? (
                    <nav className="pager" aria-label="pagination">
                      <button
                        type="button"
                        disabled={page <= 1}
                        onClick={() =>
                          write((p) => {
                            p.set('page', String(page - 1));
                          })
                        }
                      >
                        ← {t('resources.prevPage')}
                      </button>
                      <span className="pager__pos">
                        {t('resources.page', { page, total: totalPages })}
                      </span>
                      <button
                        type="button"
                        disabled={page >= totalPages}
                        onClick={() =>
                          write((p) => {
                            p.set('page', String(page + 1));
                          })
                        }
                      >
                        {t('resources.nextPage')} →
                      </button>
                    </nav>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </div>
      )}
    </>
  );
}

/**
 * 列表视图的骨架屏。
 *
 * 结构和真实卡片一致（左边时间块 + 右边正文），所以数据到达时不会跳版 ——
 * 那是"页面显得丝滑"里体感最强、也最容易被忽略的一项。
 *
 * ⚠️ 它**只**服务于列表视图。月历表不用骨架屏（切月时保留上个月，见文件头）。
 */
function CalendarSkeleton({ count = 4 }: { count?: number }) {
  return (
    <ul className="calendar-list" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={`cal-skel-${String(i)}`}>
          <div className="calendar-card">
            <div className="calendar-card__when">
              <span className="skel skel--line" style={{ width: 56 }} />
              <span className="skel skel--line" style={{ width: 84, height: 10 }} />
            </div>
            <div className="calendar-card__body">
              <span className="skel skel--line" style={{ width: '55%' }} />
              <span className="skel skel--line" style={{ width: '30%', height: 10 }} />
              <span className="skel skel--line" style={{ width: '90%' }} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * 月历表**第一次**加载时的骨架。
 *
 * 只在 `committed === null`（还没成功拿到过任何一个月）时出现。
 * 高度按 6 行留，和真实网格差不太多 —— 差太多的话第一屏会跳一下。
 */
function GridSkeleton() {
  return (
    <div className="grid grid--skeleton" aria-hidden="true">
      <div className="grid__head">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={`wn-${String(i)}`} className="skel skel--line" style={{ height: 12 }} />
        ))}
      </div>
      <div className="grid__body">
        {Array.from({ length: 42 }, (_, i) => (
          <span key={`gc-${String(i)}`} className="grid__day grid__day--skeleton">
            <span className="skel skel--line" style={{ width: 18 }} />
          </span>
        ))}
      </div>
    </div>
  );
}
