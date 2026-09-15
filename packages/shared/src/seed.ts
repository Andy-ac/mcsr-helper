/**
 * Minecraft 世界种子的取值规则。
 *
 * ⚠️⚠️ 读这段之前先记住一条铁律：**种子在整条链路上必须始终是字符串。**
 *
 * Minecraft 的世界种子是 64 位有符号整数（范围 ±9.22e18），
 * 而 JavaScript 的 `Number` 是 IEEE-754 双精度浮点，只能精确表示到 2^53-1：
 *
 *     Number.MAX_SAFE_INTEGER = 9007199254740991      (约 9.0e15)
 *     真实种子示例             = 7304888896886165976   (约 7.3e18)   ← 超出约 800 倍
 *
 * 所以 `Number('7304888896886165976')` 会返回 `7304888896886166000` ——
 * **不报错、不抛异常、不崩溃，只是静默地给你一个错误的种子。**
 * 玩家拿去开世界生成不出预期的地形，而且几乎无法排查是哪一层截断的。
 *
 * 因此本项目规定：
 *   1. 数据库列用 TEXT（不是 BIGINT，更不是 INT）
 *   2. JSON 传输时是字符串，**永远不经过 parseInt / Number() / +v**
 *   3. 前端输入框用 inputMode="text"（不要用 type="number"，它在大整数上会出问题）
 *   4. 需要比较 / 排序 / 做算术时用 BigInt，不要用 Number
 *   5. 负数种子是合法的
 */

/** 64 位有符号整数的上下界。 */
export const SEED_MIN = -9223372036854775808n;
export const SEED_MAX = 9223372036854775807n;

/** 种子的规范表示：一个不含符号前缀和多余前导零的十进制字符串。 */
export type SeedString = string;

/** 只匹配十进制整数，最多 20 位（含负号），不做范围判断。 */
const SEED_SHAPE = /^-?\d{1,20}$/;

/**
 * 判断一个未知值是否是合法的种子字符串。
 *
 * 注意：入参必须**已经是字符串**。如果你手里是 number，说明上游已经出错了 ——
 * 本函数会返回 false 而不是"尽力而为"，因为这个错误必须暴露出来而不是被掩盖。
 */
export function isSeedString(value: unknown): value is SeedString {
  if (typeof value !== 'string') return false;
  if (!SEED_SHAPE.test(value)) return false;
  try {
    const n = BigInt(value);
    return n >= SEED_MIN && n <= SEED_MAX;
  } catch {
    return false;
  }
}

/**
 * 把用户输入规范化成种子字符串。
 *
 * 处理：去空格、去 `+` 前缀、去多余前导零、把 `-0` 归成 `0`。
 * 非法输入抛错 —— 调用方应当先跑 `isSeedString` 给出友好的表单错误。
 */
export function normalizeSeedInput(raw: string): SeedString {
  const trimmed = raw.trim().replace(/^\+/, '');
  if (!isSeedString(trimmed)) {
    throw new Error(`不是合法的 Minecraft 种子（需要 64 位整数）：${JSON.stringify(raw)}`);
  }
  return BigInt(trimmed).toString();
}

/**
 * 安全地取出 BigInt 形态，用于比较、排序、算术。
 * **不要**用 `Number(seed)` 替代它。
 */
export function seedToBigInt(seed: SeedString): bigint {
  if (!isSeedString(seed)) {
    throw new Error(`不是合法的种子字符串：${JSON.stringify(seed)}`);
  }
  return BigInt(seed);
}

// ---------------------------------------------------------------------------
// Ranked Seeds 代理的对外形状 —— 服务端归一化之后、前端消费的那一层
// ---------------------------------------------------------------------------
/*
 * ---------------------------------------------------------------------------
 * ⚠️ 这几个类型原来只定义在服务端（services/api/src/seeds/upstream.ts）
 * ---------------------------------------------------------------------------
 * 它们是**服务端归一化之后的形状**，也就是前端真正拿到的东西 ——
 * 上游那三种畸形（种子值被包成数字、end_towers 是被字符串包住的 JSON、
 * `/seed` 与 `/seed/{id}` 一个平铺一个套 `seeds`）在这一层已经不存在了。
 *
 * 前端要写种子的查询界面和补录表单，就必须认识它们。放在服务端的话前端只有
 * 两条路：抄一份（两份会漂移），或者 `any`（那就没有任何检查）。
 * 所以搬到这里 —— 和 `OVERWORLD_STRUCTURES` 那一对词表是同一个理由。
 *
 * ⚠️ 上游那三种畸形本身**不进这里**：那是适配层的私事，任何泄漏到这一层的
 *    写法（比如让 `endTowers` 变成 `string | number[]`）都会把"上游有 bug"
 *    这件事传染给每一个消费方。
 */

/**
 * 一条种子记录（`/seed` 与 `/seed/{matchId}` 统一成这个形状）。
 *
 * ⚠️ 三个种子值必须保持**字符串**，绝不 `Number()`：
 *    真实种子约 7.3e18，超出 JS 安全整数范围约 800 倍，
 *    `Number('7304888896886165976')` 不报错，只是静默地给出一个错的种子。
 *    见本文件开头的铁律。
 *
 * 界面**原样渲染**它（用户 2026-09-16：不要千位分隔符 —— 手动选中复制时
 * 那些逗号会一起被复制走，而带逗号的种子粘不进 Minecraft）。单位仍然是字符串，
 * 不是数字，这一条从数据库一直贯到 DOM。
 */
export interface SeedRecord {
  matchId: number | null;
  matchDate: number | null;
  overworldSeed: SeedString;
  netherSeed: SeedString;
  theEndSeed: SeedString | null;
}

/** 随机查询的结果：一条种子 + "当前条件命中多少条"（上游契约 §1.2）。 */
export interface SeedQueryResult {
  seed: SeedRecord;
  /**
   * 满足当前条件的种子总数，界面用它显示"当前条件命中 N 条"。
   * 它是**查询**的属性而不是这条种子的属性，所以放在 seed 外面。
   *
   * ⚠️ 可以是 `null`（上游没给这个字段）。Q18 要求界面**显示**它 ——
   *    所以"取不到"必须有单独的写法，不能退化成 0（那是在撒谎：
   *    0 的意思是"一条都没有"，而那时我们明明拿到了一条种子）。
   */
  availableCounts: number | null;
}

/** `/seedinfo` 归一化后的形状。 */
export interface SeedInfo {
  matchId: number | null;
  /** 主世界结构，**大写**（`village` → `VILLAGE`）。可能是 null（1.5% 的种子没有主世界结构）。 */
  overworld: string | null;
  /** 下界堡垒遗迹，**大写**。可能是 null。 */
  nether: string | null;
  /** 末地塔的 Y 坐标，已从"被字符串包住的 JSON"解出来。 */
  endTowers: number[];
  /** 变种词条，已解出来。**不做大写转换**（词条是命名空间 id，大写就匹配不上了）。 */
  variations: string[];
}

/**
 * 发往上游的筛选条件。
 *
 * ⚠️ 这些值必须**已经是小写**（由调用方从 `UPSTREAM_*_FILTERS` 归一化），
 *    适配层不再动它们。`variations` / `without` 是**原样转发**的
 *    （上游词条随版本变，白名单会让新词条永远用不了）。
 */
export interface SeedFilters {
  overworld?: string | undefined;
  nether?: string | undefined;
  /** 逗号分隔的结构变种词条。 */
  variations?: string | undefined;
  /** 逗号分隔的排除词条。 */
  without?: string | undefined;
  /** 完赛时间上限，毫秒。 */
  completion?: number | undefined;
}

/** 写入一条记录。字段名与上游 OpenAPI 的 `SeedCreateRequest` 一致。 */
export interface SeedCreateInput {
  matchId: number;
  overworldSeed: SeedString;
  netherSeed: SeedString;
  /** 可选。缺省时**不发这个字段**，而不是发 null。 */
  theEndSeed?: string | null;
  /** 可选。上游 schema 是字符串（不是数字）。 */
  matchDate?: string | null;
}

/**
 * 一条变种词条的两级联动形状（Q17）。
 *
 * ⚠️ 词条长这样：`biome:structure:plains`、`bastion:triple:1`、
 *    `end_tower:caged:front_center`。第一段是**分组**（结构），
 *    界面先让用户选分组、再出该分组下的词条（分组折叠 + 多选 chip）。
 *
 * ⚠️ 分组**不在 shared 里写死**：上游会加新分组，写死的话新分组在我们的
 *    界面上直接消失（用户看不出少了什么，只会觉得"选项不全"）。
 *    这个函数只是把上游回来的词条按第一段分个组。
 */
export function groupVariations(variations: readonly string[]): Array<{
  group: string;
  items: string[];
}> {
  const groups = new Map<string, string[]>();
  for (const raw of variations) {
    const value = raw.trim();
    if (!value) continue;
    const group = value.split(':')[0] ?? value;
    const bucket = groups.get(group);
    if (bucket) bucket.push(value);
    else groups.set(group, [value]);
  }
  return [...groups.entries()].map(([group, items]) => ({ group, items }));
}

/**
 * `end_spawn:*` 词条 —— **上游有 bug，界面上不许出现**（Q17）。
 *
 * ⚠️ 只过滤**筛选**，不过滤结果：这些词条真的存在于上游的种子数据里
 *    （实测 `end_spawn:buried:56`），所以一条种子的 variations 里出现它是**事实**，
 *    把它抹掉等于对用户撒谎。见 `routes/seeds.ts` 的 `end_spawn_unsupported`。
 */
export function isUnsupportedVariationFilter(variation: string): boolean {
  return variation.startsWith('end_spawn');
}
