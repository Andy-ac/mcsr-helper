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

/**
 * 展示用格式化：给长数字加千位分隔符，方便肉眼核对。
 * 返回的仍然是字符串，不是数字。
 */
export function formatSeedForDisplay(seed: SeedString): string {
  const negative = seed.startsWith('-');
  const digits = negative ? seed.slice(1) : seed;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return negative ? `-${grouped}` : grouped;
}
