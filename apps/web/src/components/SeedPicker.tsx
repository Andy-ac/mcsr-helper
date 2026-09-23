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
      {/*
        ⚠️ `--variations` 这个修饰类只干一件事：给**这一排**的按钮换成等宽字体
           （见 styles.css）。理由与旧面板对同一批标识用等宽逐字相同 ——
           `biome:structure:snowy_tundra` 是要**逐字符**比对的串，比例字体下
           下划线和冒号会糊在一起。顶行那四排**不加**：它们是中文词。
      */}
      <div className="seed__rowbtns seed__rowbtns--variations">
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
               * ★ `aria-pressed` 在这里是**三态**的，不是布尔的（Task 5 评审改的那一条）。
               *
               * ⚠️ 原来的写法是 `mark !== 'none'`，于是**红按钮对读屏用户也说成"已按下"**，
               *    与绿按钮**一模一样** —— 而绿红产出的是**两个不同的查询参数**
               *    （`variations` 是"要求"、`without` 是"排除"），用户听到的却是同一句话。
               *    `'mixed'` 正是 WAI-ARIA 给三态按钮留的取值（React 的 `AriaAttributes`
               *    接受它），读屏会念成"部分按下" —— 它表达的就是这里的第三态。
               */
              aria-pressed={mark === 'with' ? true : mark === 'without' ? 'mixed' : false}
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
 * ⚠️ 哪几样东西复用了**别处**的词条 —— 口径与 `zh-CN.ts` 的 `seedsPage` 那一块逐条一致
 *    （那一段是权威口径，改这里之前先读它；这里原来那句是**假的**，见下）：
 *      · `SEED_PICKER_OVERWORLD`（主世界那一排，5 条）与 `SEED_PICKER_BASTION_TYPES`
 *        （bastion 类型那一排，4 条）：按钮标签取表里那一行的 `labelKey` 字段，
 *        值全是 `seedsPage.structure.*`（村庄 / 桥 / …）⇒ 本文件**没有**它们的词条，
 *        所以 `TopRow` 里就一句 `t(option.labelKey)`，一次取到；
 *      · `SEED_PICKER_BASTION_BIOMES` / `SEED_PICKER_FORTRESS_BIOMES`（两排群系）：
 *        同样取 `labelKey`，值走 `seedsPage.variation.*`；
 *      · **四排的行标题**都不来自上面两处，是 `pickOverworld` / `pickBastionBiome` /
 *        `pickBastionType` / `pickFortressBiome` 四个新键（下面四个 `label={t('…')}`）。
 *    ⚠️ 这一段原来把复用关系写反了：**行标题**被说成复用 `structure.*`，紧跟的例子却又是
 *       那一排**按钮**的取值 —— **两个说法都不对**（终审抓的）。原话逐字留在
 *       `packages/shared/src/i18n/zh-CN.ts:2470-2471`（那里也写着"两个说法都不对"），
 *       所以这里不再复述那一句：复述等于让一句已知为假的话多一个副本。
 *
 * ⚠️ `structureLabel()`（`apps/web/src/lib/seedLabels.ts`）今天**既不在这条路径上，
 *    也不是一条被本面板排除掉的备选路径**：它吃的是**大写结构名**（`VILLAGE`），
 *    唯一的消费方是 `SeedResultCard.tsx`（`:245` / `:249`）—— 本文件既没有 import
 *    也没有调用它（`git grep -n structureLabel -- apps/web/src/components/SeedPicker.tsx`
 *    只命中这段注释本身）。旧注释那句"所以这里**不**再走
 *    `structureLabel(value.toUpperCase(), t)`"描述的是**已删除**的 `SeedFilters.tsx`
 *    里那条旧写法（`git log --diff-filter=D -- apps/web/src/components/SeedFilters.tsx`
 *    ⇒ `07f7feb`），那个文件已经不在树里，所以这条对照关系今天没有对象。
 *
 * ⚠️ 真的会咬人的是**当前**这条路：`t(option.labelKey)` 拿到的键一旦在词条表里不存在，
 *    i18next **不报错**，而是把整个 key 印成按钮文字（`seedsPage.structure.VILLAGE`）。
 *    守着它的是 `apps/web/scripts/seedsrender.tsx` 里这几条（抓的不是同一件事，
 *    按**内容锚**列，不写行号）：
 *      · 「⑨ 裸 key 泄漏」那一段：扫**产物原文**里有没有 `seedsPage.*` 形状的裸 key
 *        （按钮文字与 `title` / `aria-*` 属性都在扫描范围内）—— 缺词条就是它抓；
 *      · 「组名必须是**词条的值**，不是裸 key」那条：只管四个**行标题**；
 *      · 「`[5, 5, 4, 5]`」那两条：四张表的长度与四排按钮数；
 *      · 「词汇表：… 条 labelKey × 两种语言」那一段：把表里那 47 个 `labelKey`
 *        逐条在两种语言里 `i18n.exists`。
 *    ⚠️ 那条「19 颗顶层按钮的文字 = `fresh(row.labelKey)`」**抓不到缺词条**：
 *       键不存在时两边都退化成同一个裸 key，于是相等 —— 别把它当成这里的覆盖。
 *       另外 `services/api/src/i18n-keys.test.ts` 那条扫 `labelKey:` 字面量的断言
 *       **不管这张表**：它只走 `apps/web/src` 与 `services/api/src` 两个根。
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

        ⚠️ 每颗点后面还跟着**它对应的形状记号**（绿 `+` / 红 `-`，灰没有），
           用的是按钮上那一个 `MARK_GLYPH` 表 —— 于是"哪颗点对应哪颗按钮"这件事
           不再只靠颜色对号入座（三颗点**本来就只靠颜色区分**，而那正是问题本身）。
           Task 5 评审点名的就是这一条。
        ⚠️ 记号复用 `.seed__pickmark`（同一个形状、同一条规则）：为它单开一个类
           等于把同一条 `inline-block; width:12px` 抄第二份，两份迟早只改一份。
        ⚠️ 三个记号都 `aria-hidden`：读屏念的是 `pickLegend` 那句话，中间插几个
           "加号 / 减号"只会把句子割碎。
      */}
      <div className="seed__legend">
        <span className="seed__legenditem">
          <span className="seed__legenddot seed__legenddot--with" aria-hidden="true" />
          <span className="seed__pickmark" aria-hidden="true">
            {MARK_GLYPH.with}
          </span>
          <span className="seed__legenddot seed__legenddot--without" aria-hidden="true" />
          <span className="seed__pickmark" aria-hidden="true">
            {MARK_GLYPH.without}
          </span>
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
