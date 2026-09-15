/**
 * 「排位赛种子」选择器的**纯逻辑层**：结构表、三态标记、参数映射、完赛时间解析。
 *
 * ---------------------------------------------------------------------------
 * 为什么这一层在 `packages/shared`，而不是在 `apps/web` 里（这不是风格偏好）
 * ---------------------------------------------------------------------------
 * `apps/web` **没有测试运行器**（它只有一串渲染自检脚本），本仓唯一的单元测试跑在
 * `services/api`（`node --import tsx --test "src/**\/*.test.ts"`，见 `ranked-shared.test.ts`）。
 * 于是判据很简单：**凡是值得写断言的逻辑都必须住在 `packages/shared`**，否则它就只能
 * "看起来对"。界面那一侧是**只吃 props 的纯视图**，页面负责取数与接线
 * （照本仓既有的"容器 + 纯视图"先例）。
 *
 * ---------------------------------------------------------------------------
 * 这一层里三件"写错了不报错"的事（也正是它必须有断言的理由）
 * ---------------------------------------------------------------------------
 * 1. **变种标识**是上游的命名空间 id（`biome:structure:snowy_tundra`）。写错一个字母、
 *    改一次大小写，上游都不报错，只是**永远查不到** —— 用户看到"0 条命中"，
 *    而真相是我们的参数上游不认识。所以测试里有一整节"表本身"逐条对照 spec §4.2。
 * 2. **互斥**只在"绿↔绿"之间生效，被顶掉的那个回**灰**而不是红。做成红的话，
 *    用户点一下"平原绿"就顺手得到一条"排除沙漠"，而界面上只是那颗按钮换了颜色。
 * 3. **标记按上下文分开存**，只有**当前选中**的上下文会进参数。两边都难看：
 *    要么发一条必然 404 的查询（把村庄的标记带进沉船），要么用户切走再切回来时丢了他的工作。
 *
 * ---------------------------------------------------------------------------
 * 三态与参数（spec §4.1 / §4.4）
 * ---------------------------------------------------------------------------
 * 灰 `none` →（点一下）绿 `with` →（点两下）红 `without` →（点三下）回到灰。
 * 绿 = "要求这个变种" ⇒ 进 `variations`；红 = "排除它" ⇒ 进 `without`。
 * 两者**可以同时存在**：实测 `variations` 是 AND、`without` 真的排除，
 * 而且"同一个族一个绿一个红"是合法查询（实测 200 且有命中）。
 *
 * ---------------------------------------------------------------------------
 * 这一层**不发请求**（刻意）
 * ---------------------------------------------------------------------------
 * 带 `variations` / `without` 的查询在上游要 **3.2–4.1 秒**（spec §2.3）。所以这里只负责
 * "把状态算成参数"，一次用户动作最多让调用方发**一个**请求；任何"顺手再查一下"的设计
 * 都会把这个秒数乘上点击次数。
 *
 * ---------------------------------------------------------------------------
 * 表是**手写死的**，不再像旧面板那样"从上游见过的词条里学习"（spec §8.4）
 * ---------------------------------------------------------------------------
 * 代价写在明面上：上游改了词条，我们这张表不会跟着变，表现是那个选项**永远查不到**
 * （一条我们看不见的 0 命中）。换来的是界面上那排按钮**不会在两次查询之间自己变形**
 * —— 旧面板正是那样（先见到什么词条就先出现什么按钮），用户回头找不到刚才那颗了。
 */
import type { SeedFilters } from './seed';

// ---------------------------------------------------------------------------
// 形状
// ---------------------------------------------------------------------------

/** 变种的三态标记（spec §4.1）。 */
export type SeedPickerMark = 'none' | 'with' | 'without';

/**
 * 表里的一个变种。
 *
 * `exclusive` 是**互斥组**的名字（`biome` / `type`），没有互斥组就是 `null`。
 * ⚠️ 它只在"设成绿"时起作用（见 `tapVariation`）：红不参与互斥。
 */
export interface SeedPickerVariation {
  id: string;
  labelKey: string;
  exclusive: string | null;
}

/** 一个顶部单选行的取值：发往上游的字符串 + 词条键。 */
export interface SeedPickerTopOption {
  value: string;
  labelKey: string;
}

/** 主世界的一行：取值 + 词条键 + 它下面的变种。 */
export interface SeedPickerStructure extends SeedPickerTopOption {
  variations: readonly SeedPickerVariation[];
}

/**
 * bastion 类型的一行。
 *
 * ⚠️ 形状与 `SeedPickerStructure` 完全一样，但**名字不一样**是刻意的：两者是两组不同的取值，
 * 一个发 `overworld=`、一个发 `nether=`（spec §4.2 的四行表）。共用一个名字之后，
 * "这一行的 `value` 该发到哪个参数"在读调用点时就看出来了。
 */
export interface SeedPickerBastionType extends SeedPickerTopOption {
  variations: readonly SeedPickerVariation[];
}

/** 表里一行的简写：id + 词条键 + 互斥组。 */
function V(id: string, labelKey: string, exclusive: string | null = null): SeedPickerVariation {
  return { id, labelKey, exclusive };
}

// ---------------------------------------------------------------------------
// 结构表（逐条照 spec §4.2 抄；顺序照 spec §10 的冻结表）
// ---------------------------------------------------------------------------

/**
 * 主世界的五个结构（顺序 = `UPSTREAM_OVERWORLD_FILTERS`，也就是界面上那一排的顺序）。
 *
 * ⚠️ 顺序是**冻结**的：界面靠"序列化后的参数串"判断"卡片上那条种子还是不是当前条件的"
 *    （spec §6.4），所以同一组选择必须永远拼出同一个串 —— 表的顺序变了，串就变了。
 * ⚠️ `buried_treasure` 的 `variations` 是**空数组**，不是缺字段、不是 `undefined`：
 *    界面靠 `variations.length > 0` 决定"这一排要不要渲染"（没有变种的结构不渲染空排，
 *    spec §6.2），而 `undefined.length` 会把整个面板打崩。
 */
export const SEED_PICKER_OVERWORLD: readonly SeedPickerStructure[] = [
  {
    value: 'village',
    labelKey: 'seedsPage.structure.VILLAGE',
    variations: [
      /*
       * 村庄的五个生物群系是一个**互斥组 `biome`**（spec §4.2）：一个村庄只坐落在一种群系里，
       * 两条同时绿是一条必然 0 命中的查询。互斥本身在 `tapVariation` 里实现。
       */
      V('biome:structure:desert', 'seedsPage.variation.village.desert', 'biome'),
      V('biome:structure:plains', 'seedsPage.variation.village.plains', 'biome'),
      V('biome:structure:savanna', 'seedsPage.variation.village.savanna', 'biome'),
      V('biome:structure:snowy_tundra', 'seedsPage.variation.village.snowyTundra', 'biome'),
      V('biome:structure:taiga', 'seedsPage.variation.village.taiga', 'biome'),
      /*
       * 这两条没有互斥组（`exclusive` 为 `null`）：箱子战利品可以同时要。
       * ⚠️ `chest:structure:diamond` 在村庄 / 沙漠神殿 / 沉船下各有一条**自己的键**
       *    （village.diamond / desertTemple.diamond / shipwreck.diamond）。
       *    spec §5.3 有一句说这三个"共用一个键"，它与 §5.1 的键名规则
       *    （`seedsPage.variation.<上下文>.<短名>`）、§5.4 的完整清单、以及"共 47 条键"
       *    这个总数**互相矛盾**（真共用的话总数会掉到 45）。这里按 §5.4 走，理由记在报告里。
       */
      V('chest:structure:diamond', 'seedsPage.variation.village.diamond'),
      V('chest:structure:obsidian', 'seedsPage.variation.village.obsidian'),
    ],
  },
  {
    value: 'desert_temple',
    labelKey: 'seedsPage.structure.DESERT_TEMPLE',
    variations: [
      V('chest:structure:diamond', 'seedsPage.variation.desertTemple.diamond'),
      V('chest:structure:egap', 'seedsPage.variation.desertTemple.egap'),
    ],
  },
  {
    value: 'shipwreck',
    labelKey: 'seedsPage.structure.SHIPWRECK',
    variations: [
      V('chest:structure:carrot', 'seedsPage.variation.shipwreck.carrot'),
      V('chest:structure:diamond', 'seedsPage.variation.shipwreck.diamond'),
      // 沉船的三种形态互斥（`type`）：一条沉船只能是一种朝向。
      V('type:structure:normal', 'seedsPage.variation.shipwreck.normal', 'type'),
      V('type:structure:sideways', 'seedsPage.variation.shipwreck.sideways', 'type'),
      V('type:structure:upsidedown', 'seedsPage.variation.shipwreck.upsidedown', 'type'),
    ],
  },
  {
    value: 'ruined_portal',
    labelKey: 'seedsPage.structure.RUINED_PORTAL',
    variations: [
      V('chest:structure:egap', 'seedsPage.variation.ruinedPortal.egap'),
      V('chest:structure:golden_carrot', 'seedsPage.variation.ruinedPortal.goldenCarrot'),
      V('chest:structure:looting_sword', 'seedsPage.variation.ruinedPortal.lootingSword'),
      // 也是 `type` 组，但组里只有两条 —— 组名与沉船那个**不是同一件事**，
      // 互斥只发生在同一个上下文内部（见 `tapVariation` 的 `siblings`）。
      V('type:structure:completable', 'seedsPage.variation.ruinedPortal.completable', 'type'),
      V('type:structure:lava', 'seedsPage.variation.ruinedPortal.lava', 'type'),
    ],
  },
  {
    // 埋藏的宝藏没有变种 —— 空数组（不是缺字段），界面因此不渲染任何空排。
    value: 'buried_treasure',
    labelKey: 'seedsPage.structure.BURIED_TREASURE',
    variations: [],
  },
];

/**
 * bastion 的生物群系（`value` 就是**完整标识**，不是短名 —— spec §4.2 那一行写的就是它）。
 *
 * ⚠️ 它是"顶行单选"，进的是 `variations` 参数；而同为顶行的 bastion **类型**进的是 `nether`。
 *    两者可以并存（实测 ⑬：堡垒群系 + `nether=bridge` 有 259155 条）。
 */
export const SEED_PICKER_BASTION_BIOMES: readonly SeedPickerTopOption[] = [
  {
    value: 'biome:bastion:basalt_deltas',
    labelKey: 'seedsPage.variation.bastionBiome.basaltDeltas',
  },
  {
    value: 'biome:bastion:crimson_forest',
    labelKey: 'seedsPage.variation.bastionBiome.crimsonForest',
  },
  {
    value: 'biome:bastion:nether_wastes',
    labelKey: 'seedsPage.variation.bastionBiome.netherWastes',
  },
  {
    value: 'biome:bastion:soul_sand_valley',
    labelKey: 'seedsPage.variation.bastionBiome.soulSandValley',
  },
  {
    value: 'biome:bastion:warped_forest',
    labelKey: 'seedsPage.variation.bastionBiome.warpedForest',
  },
];

/**
 * bastion 的四个类型（顺序 = `UPSTREAM_NETHER_FILTERS`），进 `nether=` 参数。
 *
 * ⚠️ **bastion 变种一条互斥都没有**（用户第 2 条裁决：本轮不做）—— 四个类型下的变种
 *    `exclusive` 全是 `null`，所以"桥 + 藏宝室"这类组合是允许的（由上游去答）。
 * ⚠️ `bastion:single:1` 在 bridge 与 stables 下是**同一个标识、两个词条键**（spec §5.2）：
 *    上游文档里 stables 的 `single` 是双箱塔、`small_single` 是单箱塔，将来翻译不一样。
 *    共用键的表现是"界面上两个不同的东西显示同一个词"，而且不会报错。
 */
export const SEED_PICKER_BASTION_TYPES: readonly SeedPickerBastionType[] = [
  {
    value: 'bridge',
    labelKey: 'seedsPage.structure.BRIDGE',
    variations: [
      V('bastion:single:1', 'seedsPage.variation.bridge.single1'),
      V('bastion:single:2', 'seedsPage.variation.bridge.single2'),
      V('bastion:triple:1', 'seedsPage.variation.bridge.triple1'),
      V('bastion:triple:2', 'seedsPage.variation.bridge.triple2'),
    ],
  },
  {
    // 藏宝室没有变种（同 `buried_treasure`）。
    value: 'treasure',
    labelKey: 'seedsPage.structure.TREASURE',
    variations: [],
  },
  {
    value: 'housing',
    labelKey: 'seedsPage.structure.HOUSING',
    variations: [
      V('bastion:single:1', 'seedsPage.variation.housing.single1'),
      V('bastion:triple:1', 'seedsPage.variation.housing.triple1'),
      V('bastion:triple:2', 'seedsPage.variation.housing.triple2'),
    ],
  },
  {
    value: 'stables',
    labelKey: 'seedsPage.structure.STABLES',
    variations: [
      V('bastion:good_gap:1', 'seedsPage.variation.stables.goodGap1'),
      V('bastion:good_gap:2', 'seedsPage.variation.stables.goodGap2'),
      V('bastion:single:1', 'seedsPage.variation.stables.single1'),
      V('bastion:single:2', 'seedsPage.variation.stables.single2'),
      V('bastion:single:3', 'seedsPage.variation.stables.single3'),
      V('bastion:small_single:1', 'seedsPage.variation.stables.smallSingle1'),
      V('bastion:small_single:2', 'seedsPage.variation.stables.smallSingle2'),
      V('bastion:small_single:3', 'seedsPage.variation.stables.smallSingle3'),
      V('bastion:triple:1', 'seedsPage.variation.stables.triple1'),
      V('bastion:triple:2', 'seedsPage.variation.stables.triple2'),
      V('bastion:triple:3', 'seedsPage.variation.stables.triple3'),
    ],
  },
];

/** 要塞的生物群系（与 bastion 那五个同形，标识是 `biome:fortress:*`）。 */
export const SEED_PICKER_FORTRESS_BIOMES: readonly SeedPickerTopOption[] = [
  {
    value: 'biome:fortress:basalt_deltas',
    labelKey: 'seedsPage.variation.fortressBiome.basaltDeltas',
  },
  {
    value: 'biome:fortress:crimson_forest',
    labelKey: 'seedsPage.variation.fortressBiome.crimsonForest',
  },
  {
    value: 'biome:fortress:nether_wastes',
    labelKey: 'seedsPage.variation.fortressBiome.netherWastes',
  },
  {
    value: 'biome:fortress:soul_sand_valley',
    labelKey: 'seedsPage.variation.fortressBiome.soulSandValley',
  },
  {
    value: 'biome:fortress:warped_forest',
    labelKey: 'seedsPage.variation.fortressBiome.warpedForest',
  },
];

// ---------------------------------------------------------------------------
// 状态与标记
// ---------------------------------------------------------------------------

/**
 * 面板的全部状态。
 *
 * ⚠️ `completion` **在 state 里**（旧实现把它当一个并列的 prop）：面板于是只有
 *    `state` + `onChange` 两个 prop，构建参数时也就不会出现"调用方忘了把第二个参数传进来"
 *    那种错法 —— 那种错的表现是"完赛时间填了不生效"，而没有任何报错。
 */
export interface SeedPickerState {
  /** `''` = 不限，否则是五个主世界取值之一。 */
  overworld: string;
  /** `''` = 不限，否则是 `biome:bastion:*` 之一。 */
  bastionBiome: string;
  /** `''` = 不限，否则是四个 bastion 类型取值之一。 */
  bastionType: string;
  /** `''` = 不限，否则是 `biome:fortress:*` 之一。 */
  fortressBiome: string;
  /**
   * 完赛时间上限，**存用户输入的原文**（`''` = 不限）。
   * ⚠️ 存原文不存毫秒：解析失败时那个值必须留在输入框里（被清空的话用户不知道自己哪里
   *    填错了），而"解析失败"正是它最常见的状态。解析在 `parseCompletionInput`。
   */
  completion: string;
  /**
   * 标记：键 = `markKey(上下文, 变种 id)`，上下文形如 `overworld:village` / `bastion:bridge`。
   * **按上下文分开存**，而只有当前选中的上下文会进参数（见 `activeMarks`）。
   */
  marks: Readonly<Record<string, SeedPickerMark>>;
}

/**
 * 什么都不选的状态 —— 面板的起点，也是测试的起点。
 *
 * ⚠️ **冻结**（含 `marks`）：它是全仓共用的单例，而 `{ ...EMPTY_SEED_PICKER }` 派生出来的状态
 *    会**共享同一个 `marks` 对象**。谁要是就地改一下（`state.marks[k] = …`），改的是所有状态的
 *    那一份 —— 表现是"别的筛选条件莫名其妙多了个标记"，不报错、不崩溃。
 *    冻结之后在严格模式（ESM 一律是严格模式）下当场 TypeError，代价是零。
 */
export const EMPTY_SEED_PICKER: SeedPickerState = Object.freeze({
  overworld: '',
  bastionBiome: '',
  bastionType: '',
  fortressBiome: '',
  completion: '',
  marks: Object.freeze<Record<string, SeedPickerMark>>({}),
});

/** 主世界标记的上下文（spec §4.3）：`overworld:village`。 */
export function overworldContext(value: string): string {
  return `overworld:${value}`;
}

/** bastion 类型标记的上下文：`bastion:bridge`。 */
export function bastionContext(value: string): string {
  return `bastion:${value}`;
}

/**
 * 标记键。分隔符用 `#`。
 *
 * ⚠️ 为什么 `#` 是安全的：变种标识的字符集是"小写字母/数字/下划线/冒号/逗号/连字符"
 *    （`routes/seeds.ts` 那 512 字符的校验只放行这一套），里面**没有** `#`；上下文是
 *    `overworld:xxx` / `bastion:xxx`，同样没有。所以 `上下文#id` 这个形状是**可逆、不会撞**的：
 *    拆键时第一个 `#` 一定就是分隔符。换成 `:` 或 `-` 立刻有歧义（两者都在字符集里）。
 * ⚠️ 附带的好处：每个键里都带 `#`，于是它永远不可能是 `constructor` / `toString` 这种
 *    原型链上的名字 —— 查表时不会像 `timelineLabel` 那样被 `in` 骗过去
 *    （见 `ranked/timeline.ts` 记下的那个坑）。
 */
export function markKey(context: string, id: string): string {
  return `${context}#${id}`;
}

/**
 * 三态循环：`none → with → without → none`（点一下 / 点两下 / 点三下）。冻结值（spec §10）。
 */
export function cycleMark(mark: SeedPickerMark): SeedPickerMark {
  if (mark === 'none') return 'with';
  if (mark === 'with') return 'without';
  return 'none';
}

/**
 * 读一个标记。**没点过就是 `none`** —— 缺省值只写在这里，而不是让每个调用方各自 `?? 'none'`
 * （那样迟早有一处忘了写，界面上表现为"有一颗按钮看起来永远是灰的"）。
 */
export function markOf(state: SeedPickerState, context: string, id: string): SeedPickerMark {
  return state.marks[markKey(context, id)] ?? 'none';
}

/**
 * 点一下某个变种：**先按循环算出新标记、写进去，再跑互斥**（spec §4.3 不变式 4 的顺序）。
 *
 * 顺序不能反：`without → none` 那一下如果先跑互斥，会拿"旧标记"去判断，改错的对象。
 *
 * 互斥的规则（不变式 3）：**只在绿↔绿之间**。新标记是绿时，同组里其他**绿**变灰；
 * `with → without` 与 `without → ×` 时**一格都不动** —— 红不参与互斥，用户可以同时要
 * "A 绿 + B 红"（实测这条查询合法，而且正是他要的）。
 *
 * ⚠️ 被顶掉的回 `none`（灰）而不是 `without`（红）：回红等于用户点一下"平原绿"就顺手得到
 *    一条"排除沙漠"，而界面上只是那颗按钮换了个颜色。
 * ⚠️ `siblings` 是**同一个上下文**里的全部变种（界面按当前上下文从表里取）。传错
 *    （比如把另一个结构的变种传进来）的表现是互斥静默失效。
 * ⚠️ 不改入参：`marks` 与状态都是新对象。
 */
export function tapVariation(
  state: SeedPickerState,
  context: string,
  variation: SeedPickerVariation,
  siblings: readonly SeedPickerVariation[],
): SeedPickerState {
  const next = cycleMark(markOf(state, context, variation.id));
  const marks: Record<string, SeedPickerMark> = {
    ...state.marks,
    [markKey(context, variation.id)]: next,
  };
  if (next === 'with' && variation.exclusive !== null) {
    for (const other of siblings) {
      if (other.id === variation.id || other.exclusive !== variation.exclusive) continue;
      const key = markKey(context, other.id);
      if (marks[key] === 'with') marks[key] = 'none';
    }
  }
  return { ...state, marks };
}

/**
 * 点一个顶行的取值：同一个值再点一次 = **取消**（spec §9.1 ⑦），换一个值 = 改选。
 *
 * ⚠️ 只动那一个字段，**不清 marks**：用户切走再切回来时，他在那个上下文里标过的绿/红还在
 *    （不变式 2：切走不丢工作）。而"没选中的上下文的标记不进参数"是 `activeMarks` 的事，
 *    不是这里的 —— 两件事分开，各自才说得清。
 * ⚠️ 不做取值合法性检查：取值只该来自上面那几张表（界面就是渲染它们），在这里再写一份白名单
 *    等于多一份真相。拼错的字符串的表现是"永远查不到"，所以**表本身由测试逐条钉住** ——
 *    那是唯一能发现拼错的地方。
 */
export function pickTop(
  state: SeedPickerState,
  field: 'overworld' | 'bastionBiome' | 'bastionType' | 'fortressBiome',
  value: string,
): SeedPickerState {
  // 复制一份再改那一个字段：本层的纯函数约定是**不改入参**（`EMPTY_SEED_PICKER` 是共享的
  // 单例，就地改它会污染每一个派生状态）。
  const next: SeedPickerState = { ...state };
  next[field] = state[field] === value ? '' : value;
  return next;
}

// ---------------------------------------------------------------------------
// 当前生效的标记（参数映射的唯一入口）
// ---------------------------------------------------------------------------

/**
 * 当前选中的两个上下文，**按界面上从上到下的顺序**：主世界 → bastion。
 * 没选的那一行不产出（`''` = 不限）。
 */
function activeContexts(state: SeedPickerState): string[] {
  const contexts: string[] = [];
  if (state.overworld) contexts.push(overworldContext(state.overworld));
  if (state.bastionType) contexts.push(bastionContext(state.bastionType));
  return contexts;
}

/**
 * 表里每个变种的**位置**与它自己：`上下文#id` → { order, variation }。
 *
 * ⚠️ 它只回答两个问题：**排第几**（参数串的顺序）与**词条键是什么**（界面要显示名字）。
 *    它**不**回答"这个标记算不算数" —— 那只看"上下文是不是当前选中的"（见 `activeMarks`）。
 */
const TABLE_INDEX: ReadonlyMap<string, { order: number; variation: SeedPickerVariation }> =
  buildTableIndex();

function buildTableIndex(): Map<string, { order: number; variation: SeedPickerVariation }> {
  const index = new Map<string, { order: number; variation: SeedPickerVariation }>();
  let order = 0;
  const add = (context: string, variations: readonly SeedPickerVariation[]): void => {
    for (const variation of variations) {
      // 同一个 `上下文#id` 不会出现两次：每个上下文只在一张表的一行上，而行内的 id 互不相同。
      index.set(markKey(context, variation.id), { order, variation });
      order += 1;
    }
  };
  for (const row of SEED_PICKER_OVERWORLD) add(overworldContext(row.value), row.variations);
  for (const row of SEED_PICKER_BASTION_TYPES) add(bastionContext(row.value), row.variations);
  return index;
}

/**
 * 把一个标记键拆回上下文与变种 id。不是我们做的键（没有 `#`、上下文为空、id 为空）返回 `null`。
 *
 * ⚠️ 切**第一个** `#`：`markKey` 保证 `#` 不出现在上下文与标识里（见它的说明），所以第一个
 *    就是分隔符，后面的原样属于 id。
 * ⚠️ 坏键**跳过**而不是抛错：`marks` 是 state 的公开字段，一个映射函数不该因为某一格不是
 *    我们写的形状就把整个面板打崩。
 * ⚠️ id 为空的那种键（`xxx#`）也要跳过：留着它会在参数串里拼出一个**空条目**（`a,,b`），
 *    那是一条静默变窄的查询 —— 上游不报错，只是命中数变了。
 */
function splitMarkKey(key: string): { context: string; id: string } | null {
  const at = key.indexOf('#');
  if (at <= 0 || at === key.length - 1) return null;
  return { context: key.slice(0, at), id: key.slice(at + 1) };
}

/**
 * 当前生效的标记（绿和红都算），**按表里的顺序**产出。参数映射只从这里取。
 *
 * ---------------------------------------------------------------------------
 * 从 `state.marks` 出发，而不是从表出发（这一点是刻意的）
 * ---------------------------------------------------------------------------
 * `marks` 的键就是真相：`上下文#变种 id`。表只用来回答"排第几"和"词条键是什么"：
 *   1. **排第几** —— 同一组标记换个点法（先点沉船、后点沙漠）必须拼出**同一个串**，
 *      因为界面拿这个串判断"卡片上那条种子还是不是当前条件的"（spec §6.4）；
 *   2. **词条键** —— 界面要显示那个变种的名字。
 *
 * ⚠️ 表里没有的 id **照样算数**（排在最后，`labelKey` 是空串）。界面上点不出这种标记
 *    （按钮是从表渲染的），但这个映射函数不许因此**丢掉一个标记**：丢掉的表现是
 *    "用户标了 3 个、我们只查了 2 个"—— 一条静默变宽的查询；而且 512 的那条 clamp
 *    也就永远看不到那个本来会被它拦住的串（测试正是直接构造这种 state 去验 clamp 的）。
 *
 * ⚠️ 只有**当前选中的**上下文会产出（不变式 2 的另一半）：没选中的那些标记一个都不发，
 *    否则会是一条必然 404 的查询（"沉船 + 村庄的生物群系"）。
 * ⚠️ 灰的（`none`）不产出：它什么都不做，产出来只会让每个调用方各自 `filter` 一遍。
 */
export function activeMarks(
  state: SeedPickerState,
): Array<{ context: string; variation: SeedPickerVariation; mark: SeedPickerMark }> {
  const out: Array<{ context: string; variation: SeedPickerVariation; mark: SeedPickerMark }> = [];
  for (const context of activeContexts(state)) {
    const entries: Array<{
      order: number;
      variation: SeedPickerVariation;
      mark: SeedPickerMark;
    }> = [];
    for (const [key, mark] of Object.entries(state.marks)) {
      if (mark === 'none') continue;
      const parts = splitMarkKey(key);
      if (!parts || parts.context !== context) continue;
      const known = TABLE_INDEX.get(key);
      entries.push({
        // 表里没有的排到最后：`Number.MAX_SAFE_INTEGER` 只是"比所有 order 都大"，
        // 而它们彼此之间保持 `marks` 里的键顺序（`sort` 是稳定排序）。
        order: known?.order ?? Number.MAX_SAFE_INTEGER,
        variation: known?.variation ?? { id: parts.id, labelKey: '', exclusive: null },
        mark,
      });
    }
    entries.sort((a, b) => a.order - b.order);
    for (const entry of entries) {
      out.push({ context, variation: entry.variation, mark: entry.mark });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 完赛时间：「分:秒」→ 毫秒
// ---------------------------------------------------------------------------

/** 服务端 `FILTER_MAX_CHARS` 的同值副本 —— 提前拦住，省一次必然失败的请求。 */
const FILTER_MAX_CHARS = 512;

/**
 * 服务端 `MAX_COMPLETION_MS` 的同值副本（24 小时）。
 *
 * ⚠️ 它是一个**理智边界**而不是业务规则（服务端注释里也是这么写的）：
 *    一场 MC 速通不可能超过一天，而放行任意大的数字只是白送一个
 *    "让上游去扫全表"的口子。这里提前校验只是为了让用户立刻看到提示。
 */
const MAX_COMPLETION_MS = 86_400_000;

/**
 * 解析「分:秒」。返回毫秒，失败时返回**词条 key**（调用方去翻译）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 和 `parseTimecode`（packages/shared/videos.ts）是同一个坑，理由逐字相同
 * ---------------------------------------------------------------------------
 * 视频那边的起始偏移接受 `90` / `1:30` / `1:02:33`，并且在注释里写明：
 * **冒号后面的段必须是 0–59，否则 `1:99` 会被静默当成 159 秒**。
 *
 * 那边已经解过一次，这里又写了一个 —— 是**刻意的**，不是漏了复用：
 *   · 视频那边单位是**秒**、允许三段（时:分:秒）、有个 24h 上限常量在 shared 里；
 *   · 这里单位是**毫秒**、只要两段（分:秒，Q17）、上限是服务端那个常数。
 * 把两个不同的东西塞进一个函数，下一个读代码的人要同时记住两套规则；
 * 而把"分:秒 → 毫秒"搬进 shared 又要动那个不归我改的文件。
 * 代价是这份解析逻辑有两份，所以**两条规则必须一起改**：
 *   1. 冒号后面的段 ≤ 59（`1:75` 不是 135 秒，而是输入错误）
 *   2. 超上限一律拒绝，**不做截断**（截断会产生一个用户没要过的筛选条件，
 *      而结果看起来完全正常）
 *
 * 刻意**不接受**没有冒号的写法（`90`）：在「分:秒」这个标签下，
 * 它到底指 90 秒还是 90 分钟是没有答案的，而默默选一个就是
 * 本项目一直在防的那类静默错误。
 *
 * ⚠️（Task 3 追加）上面这段连同函数体是**逐字**从
 *    `apps/web/src/components/SeedFilters.tsx` 搬过来的（那个文件本轮由 Task 6 删除）。
 *    其中"搬进 shared 又要动那个不归我改的文件"说的是**当时**的位置约束 —— 现在它就在
 *    shared 里，事实变了而那三行按"逐字搬运"的要求没有改。
 *    搬的是**位置**，不是把两个函数合并：视频那边的 `parseTimecode` 仍然独立存在。
 */
export function parseCompletionInput(
  raw: string,
): { ok: true; ms: number } | { ok: false; key: string } {
  const value = raw.trim();
  const parts = value.split(':');
  if (parts.length !== 2) return { ok: false, key: 'seedsPage.errCompletionFormat' };

  const [minRaw, secRaw] = parts;
  // 分最多四位（够到 24 小时上限），秒最多两位（`1:5` 也接住，用户就是想打 5 秒）
  if (!/^\d{1,4}$/.test(minRaw ?? '')) return { ok: false, key: 'seedsPage.errCompletionFormat' };
  if (!/^\d{1,2}$/.test(secRaw ?? '')) return { ok: false, key: 'seedsPage.errCompletionFormat' };

  const minutes = Number(minRaw);
  const seconds = Number(secRaw);
  if (seconds > 59) return { ok: false, key: 'seedsPage.errCompletionSeconds' };

  const ms = (minutes * 60 + seconds) * 1000;
  // 0 也会被服务端拒（`ms <= 0`），而"完赛时间上限 0"本来就没有意义
  if (ms <= 0) return { ok: false, key: 'seedsPage.errCompletionFormat' };
  // ⚠️ 24 小时这条**够得着**：分那段最多四位，1441:00 就会撞上它
  if (ms > MAX_COMPLETION_MS) return { ok: false, key: 'seedsPage.errCompletionTooLong' };

  return { ok: true, ms };
}

// ---------------------------------------------------------------------------
// 参数映射
// ---------------------------------------------------------------------------

/** 本地状态 → 发往 API 的形状。 */
export interface BuiltSeedPicker {
  params: SeedFilters;
  /**
   * 有没有任何条件 —— 界面靠它决定打 `/random` 还是 `/search`。
   *
   * ⚠️ 它看的是 `params` 这**五个字段**（`overworld` / `nether` / `variations` / `without` /
   *    `completion`），不是看 state：`/random` 恰恰是在这五个里**任意一个存在**时回 400
   *    （`routes/seeds.ts` 的 `RANDOM_REJECTED_PARAMS`），两边必须是同一个判据。
   *    所以"填了但没通过校验"（比如完赛时间格式错）在参数里不存在 ⇒ 这里也是 false，
   *    页面便退回 `/random`；而那种情况下页面本来就会先看 `errors` 而不发请求。
   */
  hasAny: boolean;
  /**
   * 逐控件的错误**词条 key**（拿不到解析结果时才有）。
   *
   * ⚠️ 只有两个槽位（与旧面板同一个形状，后面的任务照这个消费）：`variations` 那个槽
   *    同时承担 `variations` 与 `without` 两条串超长的报错 —— §4.4 给的是**同一个**错误词条，
   *    而它们在界面上是同一排按钮的一句话红字。
   */
  errors: Partial<Record<'variations' | 'completion', string>>;
}

/**
 * 本地状态 → 发往 API 的形状（`SeedFilters`）。
 *
 * ⚠️ 本地先校验一遍再发出去（超长、完赛时间）：用户立刻看到提示，而不是等一个来回；
 *    而且这两类错误在服务端是 400，那条 `reason` 现在读不到（见 `lib/seedErrors.ts` 的文件头），
 *    于是红字不知道该放哪 —— 在本地拦住，这条路径根本不会发生。
 */
export function buildSeedPickerParams(state: SeedPickerState): BuiltSeedPicker {
  const params: SeedFilters = {};
  const errors: BuiltSeedPicker['errors'] = {};

  /*
   * 主世界 → `overworld=`，bastion 类型 → `nether=`（spec §4.4）。取值**原样透传**：
   * 表里的值已经就是上游要的那串小写标识，这里不再 toLowerCase —— 多一次转换就多一次
   * "某个取值只有大写才查得到"的机会，而那种错的表现是 400（响的），不是静默的。
   */
  if (state.overworld) params.overworld = state.overworld;
  if (state.bastionType) params.nether = state.bastionType;

  const [overworldCtx = '', bastionCtx = ''] = activeContexts(state);
  const overworldGreens: string[] = [];
  const bastionGreens: string[] = [];
  const reds: string[] = [];
  for (const entry of activeMarks(state)) {
    if (entry.mark === 'with') {
      // `with` 的来源只有两个上下文；表里的顺序已经在 activeMarks 里定好了。
      if (entry.context === overworldCtx) overworldGreens.push(entry.variation.id);
      else if (entry.context === bastionCtx) bastionGreens.push(entry.variation.id);
      continue;
    }
    reds.push(entry.variation.id);
  }

  /*
   * `variations` 的顺序**冻结**（spec §4.4）：bastion 群系 → fortress 群系 → 主世界绿 → bastion 绿。
   * 前两组来自顶行单选、后两组来自变种按钮；同一个界面状态必须永远拼出同一个串
   * （界面拿它判断"结果是不是过期的"，§6.4）。
   * ⚠️ 两条群系行**可以并存**（实测 ⑬：堡垒群系 + `nether=bridge` 有 259155 条）。
   * ⚠️ 不去重：几组标识的命名空间不重叠（`biome:structure:*` / `chest:structure:*` /
   *    `type:structure:*` 与 `bastion:*`、`biome:bastion:*`、`biome:fortress:*`），
   *    所以同一个 id 不可能从两个来源进来。将来若加一组与主世界同名的变种，这里要重想。
   */
  const variations: string[] = [];
  if (state.bastionBiome) variations.push(state.bastionBiome);
  if (state.fortressBiome) variations.push(state.fortressBiome);
  variations.push(...overworldGreens, ...bastionGreens);

  /*
   * 超长：`variations` / `without` 各自超过 512 字符时给 `errFilterTooLong`，**不发那个参数**。
   *
   * ⚠️ 这个上限**从界面上够不着**（spec §4.4 逐格算过：最坏 349 / 379 字符），所以它守的是
   *    "将来改表之后不会把一条必然被上游 400 的串发上去"。测试是**直接构造**超长 state 验的
   *    —— 那种点击路径不存在，去找它只会浪费时间。
   * ⚠️ 宁可"少发一个条件 + 一句红字"，也不要发一条必然 400 的查询：后者的表现是
   *    "服务暂时不可用"，用户只会一直重试，而每次重试都是上游那台单核机器上的一次全表扫描。
   */
  if (variations.length > 0) {
    const joined = variations.join(',');
    if (joined.length > FILTER_MAX_CHARS) errors.variations = 'seedsPage.errFilterTooLong';
    else params.variations = joined;
  }
  if (reds.length > 0) {
    const joined = reds.join(',');
    if (joined.length > FILTER_MAX_CHARS) errors.variations = 'seedsPage.errFilterTooLong';
    else params.without = joined;
  }

  if (state.completion.trim()) {
    const parsed = parseCompletionInput(state.completion);
    if (parsed.ok) params.completion = parsed.ms;
    else errors.completion = parsed.key;
  }

  return {
    params,
    hasAny: Boolean(
      params.overworld || params.nether || params.variations || params.without || params.completion,
    ),
    errors,
  };
}
