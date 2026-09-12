import { CALENDAR_TAGS, EVENT_LEVELS, EVENT_SCOPES, EVENT_STAGES } from '@mcsr/shared';
import { useTranslation } from 'react-i18next';

/**
 * 顶部筛选栏 —— 四个维度。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 四个维度里有一个和另外三个**不是一回事**
 * ---------------------------------------------------------------------------
 *   · **标签**是多选，语义是「任一命中」（赛事**或**社区活动）
 *   · **专业程度 / 参与范围 / 轮次**是单选，语义是「就是这个」（我只看**职业**赛）
 *
 * 这不是界面风格问题，是**两个不同的查询**：把单选维度也做成数组，
 * 筛选就从"且"变成了"或" —— 用户选了"职业"，返回里混进业余的，
 * 而他很难判断这是筛选坏了还是数据里真有那么多业余赛事。
 * 服务端那边也是两种参数形状（`tags=a,b` 与 `level=PRO`，见 api.ts 的 JSDoc）。
 *
 * 所以这里把它们**在结构上分开**：标签是一排可以同时亮的 chip；
 * 另外三个各自带一个明确的「不限」，任何时候只有一个亮。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 三个单选维度**必须**有「不限」，而且它和"没填"不是一回事
 * ---------------------------------------------------------------------------
 * 后两维在数据里**可空**（排位节点没有专业程度可言）。于是有三种状态：
 *   · 不限          → 不加条件，全都给我（**筛选**的状态）
 *   · 选了"职业"    → 只要职业的
 *   · 某条活动没填  → 数据的状态，和上面两个都无关
 *
 * 少了「不限」这一项，用户没法从"我选过职业"退回到"我不管这个维度" ——
 * 他只能刷新页面，而刷新会把另外三个维度也一起清掉。
 */

interface Props {
  /** 已选中的标签。空数组 = 一个都不选（月视图里那是**诚实的空网格**）。 */
  tags: readonly string[];
  onToggleTag: (tag: string) => void;

  level: string | null;
  scope: string | null;
  stage: string | null;
  onPick: (dim: 'level' | 'scope' | 'stage', value: string | null) => void;

  /** 有没有任何一项不是默认值 —— 决定"清空筛选"显不显示。 */
  dirty: boolean;
  onReset: () => void;

  /** 「显示已结束」。**只在列表视图出现**：月视图按日变暗，见文档 A1。 */
  showPast?: boolean;
  onShowPast?: (value: boolean) => void;
}

export function CalendarFilters({
  tags,
  onToggleTag,
  level,
  scope,
  stage,
  onPick,
  dirty,
  onReset,
  showPast,
  onShowPast,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="grid-filters">
      {/*
        ⚠️ 每一维是一个 `<fieldset>` + `<legend>`，而不是 `<div role="group">`
        + 一个漂亮的 `<span>` 标签。
        理由：HTML 本来就有"分组 + 组名"的元素，而 ARIA 是在 HTML 做不到时才用的 ——
        用 `role="group"` 等于手工重造一个已经有了的东西，而屏幕阅读器对
        `<legend>` 的支持比对手写的 group 更稳。
        （`role="radiogroup"` 更糟：它声称子元素是 radio，而这里是
           `aria-pressed` 的开关按钮 —— 一个自相矛盾的声明。）

        ⚠️ 标签**放在 chip 上面一行**，不是左边一列。
        因为 `<legend>` 不能作为 flex 子项参与排版（它渲染在 fieldset 的边框区），
        硬要"标签在左、chip 在右"就必须放弃 fieldset 回到 ARIA 那套。
        上下排反而更好读：每个维度自成一块，不用靠一个定宽列去对齐。
      */}
      <fieldset className="grid-filters__row">
        <legend className="grid-filters__label">{t('calendar.filterTagsLabel')}</legend>
        <div className="grid-filters__chips">
          {CALENDAR_TAGS.map((tag) => {
            const on = tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                className={`tagchip${on ? ' tagchip--on' : ''}`}
                aria-pressed={on}
                onClick={() => onToggleTag(tag)}
              >
                {t(`calendar.tag.${tag}`)}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/*
        三个单选维度用同一段结构生成 —— 它们的形状完全一样，
        手写三遍只会让"改了一处漏两处"更容易发生。
      */}
      <SingleRow
        label={t('calendarGrid.filterLevel')}
        values={EVENT_LEVELS}
        labelKeyPrefix="calendar.level"
        current={level}
        onPick={(v) => onPick('level', v)}
      />
      <SingleRow
        label={t('calendarGrid.filterScope')}
        values={EVENT_SCOPES}
        labelKeyPrefix="calendar.scope"
        current={scope}
        onPick={(v) => onPick('scope', v)}
      />
      <SingleRow
        label={t('calendarGrid.filterStage')}
        values={EVENT_STAGES}
        labelKeyPrefix="calendar.stage"
        current={stage}
        onPick={(v) => onPick('stage', v)}
      />

      <div className="grid-filters__tail">
        <p className="grid-filters__hint">{t('calendarGrid.filterHint')}</p>

        <div className="grid-filters__actions">
          {showPast !== undefined && onShowPast ? (
            <label className="listfilter">
              <input
                type="checkbox"
                checked={showPast}
                onChange={(e) => onShowPast(e.target.checked)}
              />
              {t('calendar.showPast')}
            </label>
          ) : null}

          {dirty ? (
            <button type="button" className="filters__clear" onClick={onReset}>
              {t('calendarGrid.filterReset')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * 一个单选维度的一行：`不限` + 若干取值，任何时候只有一个亮。
 *
 * `current === null` 表示"不限"。
 */
function SingleRow({
  label,
  values,
  labelKeyPrefix,
  current,
  onPick,
}: {
  label: string;
  values: readonly string[];
  labelKeyPrefix: string;
  current: string | null;
  onPick: (value: string | null) => void;
}) {
  const { t } = useTranslation();

  return (
    <fieldset className="grid-filters__row">
      <legend className="grid-filters__label">{label}</legend>
      <div className="grid-filters__chips">
        {/*
          「不限」是这一组里**唯一**能把维度退回"不管它"的出口，
          所以它永远在第一位、永远可见 —— 不是"没有选中项时才出现"的占位。
        */}
        <button
          type="button"
          className={`tagchip${current === null ? ' tagchip--on' : ''}`}
          aria-pressed={current === null}
          onClick={() => onPick(null)}
        >
          {t('calendar.filterAny')}
        </button>
        {values.map((value) => {
          const on = current === value;
          return (
            <button
              key={value}
              type="button"
              className={`tagchip${on ? ' tagchip--on' : ''}`}
              aria-pressed={on}
              onClick={() => onPick(value)}
            >
              {t(`${labelKeyPrefix}.${value}`)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
