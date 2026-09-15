import {
  bastionContext,
  markOf,
  overworldContext,
  pickTop,
  SEED_PICKER_BASTION_BIOMES,
  SEED_PICKER_BASTION_TYPES,
  SEED_PICKER_FORTRESS_BIOMES,
  SEED_PICKER_OVERWORLD,
  type SeedPickerMark,
  type SeedPickerState,
  type SeedPickerTopOption,
  type SeedPickerVariation,
  tapVariation,
} from '@mcsr/shared/seedPicker';
import { useTranslation } from 'react-i18next';
import { Field } from '@/components/Form';

/**
 * 「排位赛种子」的新筛选面板（spec §6.2）—— **四排单选 + 按结构出现的三态按钮排**。
 *
 * ===========================================================================
 * 它只吃 props，一件事都不做
 * ===========================================================================
 * 不取数、不发请求、不读 `window` / `location`、没有 `useState`、没有 effect。
 * 这不是洁癖，是本仓那条"容器 + 纯视图"的硬理由：这一页的渲染自检用
 * `renderToStaticMarkup`，而它**不跑 effect**（也不点击、不发请求）——
 * 任何"要靠 effect 才出现在画面上"的东西在自检里**永远**看不见，
 * 于是围绕它写的断言**不可能红**。不可能红的守卫比没有守卫更坏。
 * ⇒ 取数、`resultKey` / `resultStale`、「抽一条」按钮、两个标签页全在页面（Task 6）里。
 *
 * ===========================================================================
 * 三件"写错了不报错"的事（都是 Task 3 评审点出来的，逐条挡在这里）
 * ===========================================================================
 * 1. **按钮上的字从表里的行取，不从 `activeMarks()` 取**。
 *    `activeMarks()` 给"表里没有的标记"合成一个 `labelKey: ''` 的变种
 *    （它必须那样做，否则 512 的那条 clamp 永远测不到），照着它渲染的结果是
 *    一排**没有字的按钮**。而这一排按钮**本来就该只由表决定**
 *    （用户回头找得到刚才那颗 —— 那正是旧面板"从见过的词条里学习"的病）。
 * 2. **`fieldErrors.variations` 那句红字不属于任何一排按钮**。
 *    `buildSeedPickerParams` 把"`variations` 太长"和"`without` 太长"写进**同一个槽**
 *    （类型就两个槽：`variations` / `completion`），所以它渲染成一句
 *    **笼统的"条件太长了"**，挂在所有变种排的下面，而不是塞进某一排里 ——
 *    塞进去的话，用户排了一堆"排除"却看到红字长在"要求"那一排上。
 * 3. **`tapVariation` 的 `siblings` 必须是这一排自己的 `variations` 数组**。
 *    互斥是从传进去的那个数组里算的：传别的结构的、或传整张表的，
 *    互斥要么静默失效、要么跨结构误伤（点"村庄·平原绿"把"沉船·侧翻绿"顶掉）。
 *    ⇒ 下面每个调用点传的都是**正在渲染的那一行**的数组，一眼可查。
 *
 * ===========================================================================
 * 为什么按钮上除了颜色还有一个 `+` / `-`
 * ===========================================================================
 * 三态**只靠颜色**表达，而颜色对色盲用户等于没有状态。除了那颗可见的图例
 * （`seedsPage.pickLegend`）与 `aria-pressed`，每颗按钮前面还多一个形状：
 * `with` 是 `+`、`without` 是 `-`，两者在**黑白色**下也分得开。
 * 刻意做成真正的 DOM 节点而不是 CSS 的 `::before`：`::before` 的内容
 * **不在产物里**，于是渲染自检（Task 7）断言不到"with 和 without 长得不一样"
 * 这件事 —— 而那是这一排按钮仅有的非颜色通道。
 *
 * ⚠️ 颜色本身一律走主题变量（`--grass` / `--redstone` / `--grass-ink`），
 *    组件里**不写死任何色值**：写死的话浅色主题下那颗绿底按钮上的字会看不清。
 */

/** 四个顶层的单选行各改 `SeedPickerState` 里的哪一个字段。 */
type SeedPickerTopField = 'overworld' | 'bastionBiome' | 'bastionType' | 'fortressBiome';

/**
 * 一排顶层单选按钮（可空：同一个值再点一次就是取消，见 `pickTop`）。
 *
 * ⚠️ 用 `<fieldset>` + `<legend>`，**不是** `<div role="group">` + 一个漂亮的 `<span>`：
 *    HTML 本来就有"分组 + 组名"的元素，`role="group"` 等于手工重造一个已经有的东西，
 *    而读屏对 `<legend>` 的支持比对手写的 group 更稳（本仓三处已有同一段裁决：
 *    `CalendarFilters` / `CalendarList` / `MarksPanel`）。
 *    读屏用户听到的是"桥梁，分组…… 村庄，切换按钮，已按下"—— 没有这一层他
 *    **不知道这是哪一排**，而四排里有两排都叫"生物群系"（堡垒的 / 要塞的）。
 *
 * ⚠️ 代价：`<legend>` **不能**作为 flex 子项参与排版（它渲染在 fieldset 的边框区），
 *    所以组名只能**在按钮上面一行**，"左边一列标签 + 右边一排按钮"那种排法
 *    在 fieldset 里做不到。选 fieldset 而不是回到 ARIA，理由与 `CalendarFilters`
 *    逐字相同：语义优先于对齐方式（而且上下排本来也更好读 —— 每排自成一块）。
 */
function TopRow({
  label,
  field,
  options,
  state,
  onChange,
}: {
  label: string;
  field: SeedPickerTopField;
  options: readonly SeedPickerTopOption[];
  state: SeedPickerState;
  onChange: (next: SeedPickerState) => void;
}) {
  const { t } = useTranslation();

  return (
    <fieldset className="seed__row">
      <legend className="seed__rowlabel">{label}</legend>
      <div className="seed__rowbtns">
        {options.map((option) => {
          const selected = state[field] === option.value;
          return (
            <button
              key={option.value}
              type="button"
              className={`seed__pickbtn${selected ? ' is-on' : ''}`}
              aria-pressed={selected}
              /*
               * ⚠️ 值**原样**透传（`option.value`），这里不 toLowerCase 也不 toUpperCase：
               *    表里的取值已经就是上游要的那串（`overworld=village`、
               *    `biome:bastion:soul_sand_valley`），多一次转换就多一次
               *    "某个取值只有某个大小写才查得到"的机会，而那种错的表现是 400。
               */
              onClick={() => onChange(pickTop(state, field, option.value))}
            >
              {t(option.labelKey)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** 三态按钮上的形状记号 —— 颜色之外的第二条通道（见文件头）。 */
const MARK_GLYPH: Record<SeedPickerMark, string> = {
  none: '',
  with: '+',
  without: '-',
};

/**
 * 一个上下文的变种排（三态）。
 *
 * ⚠️ **只在调用方确认过"这个上下文被选中、且它确实有变种"之后才渲染**：
 *    `buried_treasure` 与 bastion 的 `treasure` 的 `variations` 是空数组，
 *    一排零个按钮比没有那一排更让人困惑（spec §6.2）；没选结构时同理。
 *    判据写在调用点（`variations.length > 0`），不在这里再判一次 ——
 *    两处判据迟早只改一处，于是又会冒出一排空按钮。
 */
function VariationRow({
  label,
  context,
  variations,
  state,
  onChange,
}: {
  label: string;
  context: string;
  variations: readonly SeedPickerVariation[];
  state: SeedPickerState;
  onChange: (next: SeedPickerState) => void;
}) {
  const { t } = useTranslation();

  return (
    <fieldset className="seed__row">
      <legend className="seed__rowlabel">{label}</legend>
      <div className="seed__rowbtns">
        {variations.map((variation) => {
          const mark = markOf(state, context, variation.id);
          /*
           * ⚠️ 字从**行**上取（`variation.labelKey`），不从 `activeMarks()` 取（见文件头 ①）。
           * ⚠️ `title` 用同一个文本：按钮多的时候，鼠标停一下能看到全名
           *    （变种标识很长，窄屏上会被挤成省略号）。
           */
          const text = t(variation.labelKey);
          return (
            <button
              key={variation.id}
              type="button"
              className={`seed__pickbtn${mark === 'with' ? ' is-with' : ''}${
                mark === 'without' ? ' is-without' : ''
              }`}
              /*
               * ⚠️ `aria-pressed` 只有两态，而这里有三个（灰/绿/红）：`without` 也算"按下"
               *    （它确实生效了 —— 红 = 排除），否则读屏用户会以为那颗按钮没反应。
               *    三态本身靠图例那句话与 `+` / `-` 两个记号表达。
               */
              aria-pressed={mark !== 'none'}
              title={text}
              onClick={() => onChange(tapVariation(state, context, variation, variations))}
            >
              {mark === 'none' ? null : (
                <span className="seed__pickmark" aria-hidden="true">
                  {MARK_GLYPH[mark]}
                </span>
              )}
              {text}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * 筛选面板本体。
 *
 * ⚠️ 四个顶层标签**复用** `seedsPage.structure.*` 那几条中文（村庄 / 桥 / …）——
 *    它们就在表里的 `labelKey` 字段上，所以这里 `t(row.labelKey)` 一次取到，
 *    **不**再走 `structureLabel(value.toUpperCase(), t)`：那条路要多一次大写转换，
 *    而"表里的键"与"大写后的值"是两份真相 —— 两边对不上的表现是某一排按钮
 *    印出一个裸词条键（`seedsPage.structure.VILLAGE`），不报错。
 *
 * ⚠️ `completion` **不是**一个 prop（它在 `SeedPickerState` 里，Task 3 定的）：
 *    并列传进来的话，页面漏传一格的表现是"完赛时间填了不生效"，
 *    而没有任何地方会报错。
 */
export function SeedPickerPanel({
  state,
  onChange,
  fieldErrors,
}: {
  state: SeedPickerState;
  onChange: (next: SeedPickerState) => void;
  /**
   * 逐控件的红字，**已经翻译好**。
   *
   * ⚠️ 只有两个槽：`variations` 那个槽同时承担 `variations` 与 `without` 两条串
   *    超长的报错（`buildSeedPickerParams` 就是这么写的，类型也是这么冻的），
   *    所以它渲染成一句笼统的提示，不挂在任何一排按钮上（见文件头 ②）。
   */
  fieldErrors: Partial<Record<'variations' | 'completion', string>>;
}) {
  const { t } = useTranslation();

  /*
   * 当前选中的那一行（没选就是 `undefined`）。
   * 变种排的**上下文**与它的变种**数组**只能从这一行来 —— 它们是同一个东西的两半，
   * 分别去两张表里查的话（比如上下文用 `state.overworld` 拼、数组从别处找），
   * 迟早有一处拼错，而拼错的表现是"点一下绿了但查不到任何东西"。
   */
  const overworldRow = SEED_PICKER_OVERWORLD.find((row) => row.value === state.overworld);
  const bastionRow = SEED_PICKER_BASTION_TYPES.find((row) => row.value === state.bastionType);

  return (
    <div className="seed__picker">
      <TopRow
        label={t('seedsPage.pickOverworld')}
        field="overworld"
        options={SEED_PICKER_OVERWORLD}
        state={state}
        onChange={onChange}
      />

      {/*
        ⚠️ 这一排只在"选中了某个主世界结构"**且**"那个结构有变种"时出现：
        没有变种的结构（`buried_treasure`）**不渲染空排** —— 它照常能被选中
        （`overworld=buried_treasure` 本身就是一个合法的筛选条件）。
      */}
      {overworldRow && overworldRow.variations.length > 0 ? (
        <VariationRow
          label={t('seedsPage.pickVariations')}
          context={overworldContext(overworldRow.value)}
          variations={overworldRow.variations}
          state={state}
          onChange={onChange}
        />
      ) : null}

      <TopRow
        label={t('seedsPage.pickBastionBiome')}
        field="bastionBiome"
        options={SEED_PICKER_BASTION_BIOMES}
        state={state}
        onChange={onChange}
      />

      {/*
        两排 bastion 是**并排**的，不是从属关系：类型进 `nether=`、群系进 `variations=`，
        两者可以同时存在（实测 ⑬）。所以类型那一排的变种排挂在**类型**下面，
        而不是挂在整个 bastion 块的下面。
      */}
      <TopRow
        label={t('seedsPage.pickBastionType')}
        field="bastionType"
        options={SEED_PICKER_BASTION_TYPES}
        state={state}
        onChange={onChange}
      />

      {bastionRow && bastionRow.variations.length > 0 ? (
        <VariationRow
          label={t('seedsPage.pickBastionVariations')}
          context={bastionContext(bastionRow.value)}
          variations={bastionRow.variations}
          state={state}
          onChange={onChange}
        />
      ) : null}

      <TopRow
        label={t('seedsPage.pickFortressBiome')}
        field="fortressBiome"
        options={SEED_PICKER_FORTRESS_BIOMES}
        state={state}
        onChange={onChange}
      />

      {/*
        ⚠️ 这一句挂在**所有变种排的下面**，不塞进任何一排（见文件头 ②）：
        `fieldErrors.variations` 同时可能是"排除条件太长"，而它不属于任何一排按钮。
      */}
      {fieldErrors.variations ? <p className="fielderr">{fieldErrors.variations}</p> : null}

      <Field
        id="seed-completion"
        label={t('seedsPage.completion')}
        hint={t('seedsPage.completionHint')}
      >
        <input
          id="seed-completion"
          className="mcsr-field__input"
          /*
           * 文本 + `inputMode`，与旧面板一致（**不是** `type="number"`）：
           * 它是一个「分:秒」的字符串，而 number 输入框会把 `2:35` 里的冒号
           * 当成非法字符直接吞掉 —— 用户看到自己打的东西没了。
           * ⚠️ 种子输入框那边是**另一条**理由（64 位整数不能用 Number），见 shared/seed.ts。
           */
          inputMode="numeric"
          value={state.completion}
          placeholder={t('seedsPage.completionPlaceholder')}
          /* 存**原文**：解析失败时那个值必须留在框里，否则用户不知道自己哪里填错了 */
          onChange={(event) => onChange({ ...state, completion: event.target.value })}
        />
        {fieldErrors.completion ? <p className="fielderr">{fieldErrors.completion}</p> : null}
      </Field>

      {/*
        图例。三颗点按**绿 → 红 → 灰**排，下面那句话里的顺序（点一下 / 点两下 / 点三下）
        与它一一对应 —— 位置本身就是那条对应关系，所以这里**不**去切分
        `pickLegend` 那句话：切分等于把那句话拆成三个片段写在组件里，
        而它的权威文本在词条表里（Task 4），改一次文案要改两处。
      */}
      <div className="seed__legend">
        <span className="seed__legenditem">
          <span className="seed__legenddot seed__legenddot--with" aria-hidden="true" />
          <span className="seed__legenddot seed__legenddot--without" aria-hidden="true" />
          <span className="seed__legenddot seed__legenddot--none" aria-hidden="true" />
          {t('seedsPage.pickLegend')}
        </span>
        <span className="seed__legenditem">{t('seedsPage.pickLegendNote')}</span>
      </div>

      {/*
        ⚠️「要等 3–4 秒」这句不是装饰：带 `variations` / `without` 的查询实测 3.2–4.1 秒
        （spec §2.3）。不说清的话用户会在第二秒开始反复点，而每一下都是上游
        那台单核机器上的一次查询（配额还只有每 IP 每分钟 20 次）。
      */}
      <p className="mcsr-field__hint">{t('seedsPage.pickSlow')}</p>
    </div>
  );
}
