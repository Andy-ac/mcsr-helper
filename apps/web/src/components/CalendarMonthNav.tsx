import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addMonths, type YearMonth } from '@/components/CalendarGrid';

/**
 * 年月切换条：`‹ 2026年11月 ›`。
 *
 * ---------------------------------------------------------------------------
 * 为什么是「年步进器 + 12 个月按钮」而不是"先选年、再选月"两步
 * ---------------------------------------------------------------------------
 * 两步（先弹年份网格、选完再弹月份网格）看起来更"完整"，代价是**两次点击 + 一次
 * 中间态**：用户点的过程中会看到一个自己并不想停留的年份。而且从 2026 跳到 2028
 * 要先进年份网格、找到 2028、再进月份网格 —— 三次操作。
 *
 * 一个面板里放「年步进器 + 12 个月」是最少的操作数：换一个月是一次点击，
 * 换一年再换一个月是三次点击，而且中间没有"悬空"的状态。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 格式化年月时**必须钉住 timeZone: 'UTC'**
 * ---------------------------------------------------------------------------
 * 我们手里的是一个"某年某月 1 日"的 UTC 时刻。不给 `timeZone` 时，`Intl`
 * 按**运行机器的本地时区**去渲染它：东八区没问题，但在纽约
 * `Date.UTC(2026, 10, 1)`（11 月 1 日 00:00 UTC）会渲染成 **October 2026** ——
 * 头写着 10 月、网格里是 11 月。这类"两个地方对不上"的问题只在某些时区出现，
 * 而有人的机器上永远复现不了。
 *
 * 同理，星期表头那边也不是"反正只是个标签"。
 */

interface Props {
  ym: YearMonth;
  /** 用户刚点了"上/下个月"、但那个月的数据还在路上 —— 见下面 isPending。 */
  isPending: boolean;
  onPick: (ym: YearMonth) => void;
  onStep: (delta: number) => void;
  onToday: () => void;
}

export function CalendarMonthNav({ ym, isPending, onPick, onStep, onToday }: Props) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  /*
   * 关闭面板的两条路：点外面、按 Esc。
   *
   * ⚠️ 用 `mousedown` 而不是 `click`：`click` 要等鼠标抬起，用户在面板外
   *    按下、拖到面板内再松开时，`click` 的目标是面板内的元素，
   *    于是面板不会关 —— 一个"点外面关不掉"的弹层很容易被当成没做关闭。
   */
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent): void {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setOpen(false);
        // 焦点还给触发按钮：否则 Esc 之后焦点留在已经不存在的面板里，
        // 下一个 Tab 会从文档开头重新开始。
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions): string =>
    new Intl.DateTimeFormat(i18n.language, { timeZone: 'UTC', ...opts }).format(d);

  const monthLabel = fmt(new Date(Date.UTC(ym.year, ym.month - 1, 1)), {
    year: 'numeric',
    month: 'long',
  });

  const monthNames = Array.from({ length: 12 }, (_, i) =>
    fmt(new Date(Date.UTC(2026, i, 1)), { month: 'long' }),
  );

  function pick(year: number, month: number): void {
    setOpen(false);
    onPick({ year, month });
  }

  return (
    <div className="grid-nav" ref={wrapRef}>
      <button
        type="button"
        className="grid-nav__step"
        onClick={() => onStep(-1)}
        title={t('calendarGrid.prevMonth')}
        aria-label={t('calendarGrid.prevMonth')}
      >
        {/* ← / → 而不是 « / » —— 后两个不在自托管像素字体的子集里 */}←
      </button>

      <button
        type="button"
        ref={triggerRef}
        className={`grid-nav__label${open ? ' is-open' : ''}${isPending ? ' is-pending' : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        title={t('calendarGrid.pickMonth')}
      >
        {monthLabel}
      </button>

      <button
        type="button"
        className="grid-nav__step"
        onClick={() => onStep(1)}
        title={t('calendarGrid.nextMonth')}
        aria-label={t('calendarGrid.nextMonth')}
      >
        →
      </button>

      <button type="button" className="grid-nav__today" onClick={onToday}>
        {t('calendarGrid.today')}
      </button>

      {open ? (
        <div className="grid-nav__panel">
          <div className="grid-nav__yearrow">
            <button
              type="button"
              className="grid-nav__step grid-nav__step--sm"
              onClick={() => onPick(addMonths(ym, -12))}
              aria-label={t('calendarGrid.prevYear')}
            >
              ←
            </button>
            <span className="grid-nav__year">
              {fmt(new Date(Date.UTC(ym.year, 0, 1)), { year: 'numeric' })}
            </span>
            <button
              type="button"
              className="grid-nav__step grid-nav__step--sm"
              onClick={() => onPick(addMonths(ym, 12))}
              aria-label={t('calendarGrid.nextYear')}
            >
              →
            </button>
          </div>

          <div className="grid-nav__months">
            {monthNames.map((name, i) => (
              <button
                key={name}
                type="button"
                className={`grid-nav__month${ym.month === i + 1 ? ' tagchip--on' : ''}`}
                aria-current={ym.month === i + 1 ? 'true' : undefined}
                onClick={() => pick(ym.year, i + 1)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
