/**
 * 读 jar 里那份 `fabric.mod.json` 的**纯逻辑**：一段文本 → `{ id, version }`。
 *
 * ===========================================================================
 * 为什么它住在 shared（而不是 `apps/desktop/src/file-updates.ts` 里就地写）
 * ===========================================================================
 * `apps/desktop` **没有测试运行器**（它只有 typecheck）—— 那一侧立过的规矩是：
 * 凡是要写断言的纯逻辑都搬到 `@mcsr/shared`，断言落在 `services/api/src/*.test.ts`。
 * 这一支正是那种逻辑：它一个字节的盘都不读、一次网络都不打，输入输出全是字符串，
 * 而它要判的是一件**会咬人**的事（下面那一段）。住在桌面侧就只能靠 gitignore 的探针验。
 *
 * ===========================================================================
 * ★ 为什么需要"转义之后重试一遍"（这是真实现场，不是防御性编程）
 * ===========================================================================
 * 2026-10-04 实测（`D:\MultiMC\instances\1.16.1 - Ranked#1\.minecraft\mods`）：
 * `sodium-2.5.0+1.16.1.jar` 与 `krypton-1.16.1-backport-0.1.3-SNAPSHOT+2021-02-20.jar`
 * 的 `fabric.mod.json` 里**有一个裸换行落在字符串字面量内部**（作者手写/脚本生成时
 * 没转义）。那是**宽松 JSON 解析器（JSON5）吃得下、严格 JSON 吃不下**的形状：
 * `JSON.parse` 抛 `Bad control character in string literal in JSON at position 234`，
 * 于是扫描把这两个 jar 记成 `modid: null` ⇒ 界面上它们是"认不出"的那一栏，
 * 而它们的 id / version 其实**写得清清楚楚**（`sodium` / `2.5.0+1.16.1`）。
 *
 * 修法（**严格解析仍然是快路径**，只有它抛了才走第二条路）：
 *   ① `JSON.parse(text)` 成功 ⇒ 直接返回（99% 的 jar 走这里，行为与从前逐字相同）；
 *   ② 抛了 ⇒ 扫描一遍文本，把**落在字符串字面量内部**的裸控制字符（`0x00`–`0x1F`）
 *      换成它们本来的转义写法，再 `JSON.parse` 一次；
 *   ③ 还抛 ⇒ **把①那个原始错误原样抛出去** —— 保持今天的行为（这一枚 jar 仍然是
 *      "读不出"，仍然进"认不出"那一栏），**绝不**猜一个 id 出来。
 *
 * ⚠️★ 三条边界（写下来，因为每一条都能被"顺手改成更宽松"）：
 *   · **不引入任何依赖**：不做"换成 JSON5 解析器"那件事 —— 那会把
 *     `{a:1}` / 单引号 / 尾随逗号**一起**吃进来，于是"这个文件其实坏了"不再看得见。
 *     这一支只认那**一种**合法 JSON 允许但没写出来的形状（裸控制字符），别的照旧抛。
 *   · **只在字符串内部转义**：注释里的控制字符、结构位置上的控制字符一律不动 ——
 *     它们仍然让第二次解析失败（那是实情：那不是 JSON）。
 *   · **不给缺失值编一个**：`id` / `version` 必须都是字符串（照旧），
 *     否则抛 `fabric.mod.json 里没有 id / version`。
 */

/**
 * 落在字符串内部时的替换表（`0x00`–`0x1F` 里 JSON 有短转义的五个）。
 *
 * ⚠️ 其余的控制字符（`0x00`–`0x07` / `0x0b` / `0x0e`–`0x1f`）用 `\uXXXX` —— 它们
 * **没有**短转义可用（`\b` / `\f` 是 0x08 / 0x0c，不是 0x00 / 0x0b）。
 */
const SHORT_ESCAPES: Readonly<Record<number, string>> = {
  8: '\\b',
  9: '\\t',
  10: '\\n',
  12: '\\f',
  13: '\\r',
};

/**
 * 把**字符串字面量内部**的裸控制字符换成转义写法（其余一个字符都不动）。
 *
 * 扫描规则（就是 JSON 自己的那两条）：
 *   · `"` 在不转义时切换"在不在字符串里"；
 *   · `\` 让它后面那一个字符**无条件**被跳过（所以 `"\""` 不会把字符串提前关掉，
 *     `"a\\nb"` 里的 `\\` 也不会被我们二次转义 —— 它本来就是一个反斜杠）。
 *
 * ⚠️ 这个函数**不做校验**：它不保证输出是合法 JSON（比如一个没闭合的字符串）。
 *    输出仍然交给 `JSON.parse` 裁决 —— 校验只有那一个来源。
 */
function escapeControlCharsInStrings(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (escaped) {
      escaped = false;
      out += ch;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      out += ch;
      continue;
    }
    if (ch === '"') {
      inString = false;
      out += ch;
      continue;
    }
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x1f) {
      out += SHORT_ESCAPES[code] ?? `\\u${code.toString(16).padStart(4, '0')}`;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * `fabric.mod.json` 的文本 → `{ id, version }`；解不出 / 缺字段一律**抛**。
 *
 * ⚠️ 抛出的错误有**两种来源**，调用方（`apps/desktop` 的 `readJarMeta`）原样把
 *    `message` 交给界面，所以两边都要能读：
 *      · 解析失败 ⇒ **① 那次严格解析的原始错误**（形如
 *        `Bad control character in string literal in JSON at position 234`）——
 *        保持"今天读不出就是这样一句话"这条既有行为；
 *      · 解析成功但 `id` / `version` 不是字符串 ⇒ `fabric.mod.json 里没有 id / version`。
 */
export function parseFabricModJson(text: string): { id: string; version: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (strictError) {
    try {
      parsed = JSON.parse(escapeControlCharsInStrings(text));
    } catch {
      // ⚠️ 第二条路也走不通 ⇒ 抛**①那个**错误：这一枚 jar 的行为与修之前逐字相同。
      throw strictError;
    }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('fabric.mod.json 里没有 id / version');
  }
  const meta = parsed as { id?: unknown; version?: unknown };
  if (typeof meta.id !== 'string' || typeof meta.version !== 'string') {
    throw new Error('fabric.mod.json 里没有 id / version');
  }
  return { id: meta.id, version: meta.version };
}
