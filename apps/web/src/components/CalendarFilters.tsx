import { CALENDAR_TAGS, CONTINENTS, COUNTRIES, EVENT_LEVELS, EVENT_SCOPES } from '@mcsr/shared';
import { useTranslation } from 'react-i18next';

/**
 * 顶部筛选栏 —— 三个维度，外加一条**从属于「参与范围」**的明细行。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 三个维度里有一个和另外两个**不是一回事**
 * ---------------------------------------------------------------------------
 *   · **标签**是多选，语义是「任一命中」（赛事**或**社区活动）
 *   · **专业程度 / 参与范围**是单选，语义是「就是这个」（我只看**职业**赛）
 *
 * 这不是界面风格问题，是**两个不同的查询**：把单选维度也做成数组，
 * 筛选就从"且"变成了"或" —— 用户选了"职业"，返回里混进业余的，
 * 而他很难判断这是筛选坏了还是数据里真有那么多业余赛事。
 * 服务端那边也是两种参数形状（`tags=a,b` 与 `level=PRO`，见 api.ts 的 JSDoc）。
 *
 * 所以这里把它们**在结构上分开**：标签是一排可以同时亮的 chip；
 * 另外两个各自带一个明确的「不限」，任何时候只有一个亮。
 *
 * ⚠️ **2026-09-13 去掉了「轮次」那一维**（用户要求「去掉轮次」）：它只是一个标签、
 *    不做父子层级，而实际录数据时"横跨一周的连续赛事"根本填不了它。
 *    维度因此从四个变成三个（第三个是紧贴在「参与范围」下面的**从属**行，
 *    不单独算一维），`calendarGrid.filterStage` / `calendar.stage.*`
 *    那两组词条也**已经删掉**了。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 两个单选维度**必须**有「不限」，而且它和"没填"不是一回事
 * ---------------------------------------------------------------------------
 * 这两维在数据里**可空**（排位节点没有专业程度可言）。于是有三种状态：
 *   · 不限          → 不加条件，全都给我（**筛选**的状态）
 *   · 选了"职业"    → 只要职业的
 *   · 某条活动没填  → 数据的状态，和上面两个都无关
 *
 * 少了「不限」这一项，用户没法从"我选过职业"退回到"我不管这个维度" ——
 * 他只能刷新页面，而刷新会把另外几个维度也一起清掉。
 */

interface Props {
  /** 已选中的标签。空数组 = 一个都不选（月视图里那是**诚实的空网格**）。 */
  tags: readonly string[];
  onToggleTag: (tag: string) => void;

  level: string | null;
  scope: string | null;
  /**
   * 「参与范围」的**明细**（大洲或国家代码）。
   *
   * ⚠️ 它**不是一个并列的维度**，而是 `scope` 的下级：`scope` 说"这场是洲际的"，
   *    这一项才说"是哪个洲"。所以它在界面上紧贴 `scope` 那一行，
   *    而不是跟着其它维度排到后面（见下面那一段的注释）。
   * ⚠️ 这里是**单选**（`null` = 不限）。库里事件那一侧是**多选**，但筛选栏的
   *    语义和 `level` / `scope` 一样："我只看这个洲"，选一个就够。
   */
  scopeDetail: string | null;
  onPick: (dim: 'level' | 'scope' | 'scopeDetail', value: string | null) => void;

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
  scopeDetail,
  onPick,
  dirty,
  onReset,
  showPast,
  onShowPast,
}: Props) {
  const { t } = useTranslation();

  /*
   * ★ 明细行的取值集合**跟着 `scope` 变**（需求⑥：「参赛范围」非全球时可选具体大洲/国家）。
   *
   * ⚠️ `null` 表示**整行不渲染**。两种"没有明细可填"的情况都收敛到它：
   *    `scope === null`（不限）和 `scope === 'GLOBAL'`（全球本来就没有明细）。
   *    一行「不限 + 六个大洲」长在"全球"下面是自相矛盾的（全球还要选哪个洲？）。
   *    ⇒ 是**不渲染**，不是渲染成禁用态：一个按不动的控件比没有更让人困惑。
   */
  const detailValues: readonly string[] | null =
    scope === 'CONTINENT' ? CONTINENTS : scope === 'COUNTRY' ? COUNTRIES : null;

  /*
   * ⚠️ 键是**拼出来**的（`SingleRow` 里那句 `t(`${labelKeyPrefix}.${value}`)`），
   *    所以前缀必须是**变量**。别把它内联成模板字面量交给 lint ——
   *    那会被"字面量更简单"那类规则要求改写，而改完就只剩一种前缀，
   *    另一半（国家 / 大洲）会静默地显示成词条 key 本身。
   */
  const detailPrefix = scope === 'CONTINENT' ? 'calendar.continent' : 'calendar.country';

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
        两个单选维度用同一段结构生成 —— 它们的形状完全一样，
        手写两遍只会让"改了一处漏两处"更容易发生。
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
      {/*
        ★ 参与范围明细 —— **从属行**，紧贴在「参与范围」正下方（2026-09-13，需求⑥）。
        ⚠️ 它是 `filterScope` 的**下级**，不是第四个并列维度：范围选了「大洲」，
           这一行列的就是六个大洲；选了「国家」就是国家表。
           所以它出现在这一行**之下**，而不是跟着其它维度排到后面 ——
           排到后面的话，视觉和读屏里它都成了"又一个独立维度"，
           而"哪几个维度是并列的"正是这一栏要传达的结构。
        ⚠️ 匹配语义是「命中任一即显示」（库里 `scope_detail` 是**多选**，见
           shared/constants.ts 的 `SCOPE_DETAILS` 注释）：一场"亚洲 & 大洋洲"的
           赛事，选其中任何一个都应该出现。这里筛的是一个标量，但**匹配规则**
           照旧是"命中任一"（见 CalendarList 里那一处客户端过滤）。
      */}
      {detailValues ? (
        <SingleRow
          label={t('calendarGrid.filterScopeDetail')}
          values={detailValues}
          labelKeyPrefix={detailPrefix}
          current={scopeDetail}
          onPick={(v) => onPick('scopeDetail', v)}
        />
      ) : null}

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
 *
 * ⚠️ 参与范围明细那一行**也走它**：形状完全一样（一组互斥的 chip + 一个「不限」），
 *    单独写一份只会让"改了一处漏一处"更容易发生。它与 `filterScope` 的
 *    从属关系由**调用处的位置**表达（紧跟其后），而不是由这个组件表达 ——
 *    组件不需要知道自己在谁下面。
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
