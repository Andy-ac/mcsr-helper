#!/usr/bin/env node
/**
 * 检查：`apps/web/src/**` 里 import 的每一个 `@mcsr/shared/<子路径>`，
 * 在 `vite.config.ts` 的 alias 表里都有一条**自己的**条目，而且排在裸包名那条**之上**。
 *
 * ===========================================================================
 * 为什么需要它：这个坑在本仓已经发生**四次**，而两端门禁一次都没看见
 * ===========================================================================
 *
 * `resolve.alias` 是**前缀替换**：键 `@mcsr/shared` 会把 `@mcsr/shared/tracking`
 * 一起吃掉，拼成 `.../packages/shared/src/index.ts/tracking`。报错原文是
 *
 *     Could not load ../../packages/shared/src/index.ts/tracking
 *
 * —— 看起来像路径写错，实际是**条目缺失**（或顺序不对）。
 *
 * 四次的记录（前三次写在 `vite.config.ts` 的注释里，第四次是视频追踪 T7）：
 *   ① `@mcsr/shared/resources`（M4 之前）   ② `@mcsr/shared/live`（2026-09-13）
 *   ③ `@mcsr/shared/ranked`（2026-09-16）   ④ `@mcsr/shared/seedPicker`（写界面之前补上）
 *   以及 `@mcsr/shared/tracking`（T7 真的炸了 `vite build`：
 *   `[UNLOADABLE_DEPENDENCY] Could not load .../index.ts/tracking`
 *   来自 `src/components/TrackedVideos.tsx:1`）。
 *
 * ⚠️ 还有一条**同型**的陷阱：**长的子路径必须排在短的子路径前面** ——
 *    `@mcsr/shared/calendar` 会把 `@mcsr/shared/calendar-time` 拼成
 *    `.../calendar.ts-time`（os error 3，2026-09 M4 加日历时踩到）。
 *    这和第 1 条**不是**同一件事，所以本脚本分开查（见下面第 3 条）。
 *
 * ---------------------------------------------------------------------------
 * 为什么现有的门禁一个都不响（这才是加这个脚本的唯一理由）
 * ---------------------------------------------------------------------------
 *   · `pnpm -w check` 的 typecheck 走 `packages/shared/package.json` 的 `exports`
 *     （moduleResolution: bundler）⇒ 子路径**在类型上是存在的**，所以全绿；
 *   · 渲染自检（`scripts/*render.tsx`）由 **tsx** 直接跑 TS，同样走 `exports`，
 *     **根本不经过 Vite**；
 *   · `apps/web/scripts/**` 还不在 web 的 tsconfig 里（`pending.md §5.50`）。
 *   ⇒ 整仓只有 `vite build` / dev server 会过 alias 表，而这一层的代价是
 *     **整个页面在浏览器里一个字节都渲染不出来**（不是一处样式错）。
 *     发现路径此前只有一条：人恰好跑了一次 build（T7 就是这么发现的）。
 *
 * ---------------------------------------------------------------------------
 * 它查四件事（每一条都对应上面的一次事故）
 * ---------------------------------------------------------------------------
 * 1. 用到的每个子路径都有**自己**的别名条目（④ 那两次）；
 * 2. 那些条目都排在裸包名 `'@mcsr/shared'` **上面**（①②③④ 全是这一条）；
 * 3. 没有任何**短的**别名键排在**长的**别名键上面（`calendar` / `calendar-time`；
 *    裸包名是"最短的那一个"，所以它被第 3 条也管着，第 2 条只是给出更指名的话术）；
 * 4. 顺带（只要一次 `existsSync`）：每条 `@mcsr/*` 别名的**目标文件真的存在** ——
 *    路径写错与漏写条目在浏览器里是同一个症状。
 *
 * ---------------------------------------------------------------------------
 * 边界（写下来，免得下一次有人以为它管得比实际宽）
 * ---------------------------------------------------------------------------
 * · 只扫 `apps/web/src/**` 的 `.ts` / `.tsx`（`apps/web/index.html`、
 *   `apps/web/scripts/**` 与桌面端都不在里面）；
 * · **两边都先剥注释再扫**：否则 `src/lib/api.ts` 里那句
 *   「`@mcsr/shared/contributors` 会在类型检查与打包时都找不到模块」的散文
 *   会被当成一次 import —— `pending.md §5.71`（源码扫描过宽、对着散文报警）
 *   与 T7 的类名守卫（剥 CSS 注释）都是同一个教训；
 * · 只认 `from '…'` / `import('…')` / `import '…'` 三种写法（一行内匹配，
 *   跨行 import 的 `from` 那一行照样命中）；
 * · **认不出 alias 表的一行时不是判决，是门禁自己坏了** ⇒ 退出码 2、
 *   并且消息里写明"这条检查根本没跑"（`pending.md §5.74` 的教训：核对脚本
 *   自己出错时，输出长得像"这一项没过"）。
 *
 * 用法：node scripts/check-shared-aliases.mjs
 * 退出码：0 = 通过；1 = 对账不通过（有缺陷）；2 = 门禁读不懂输入（自己坏了）
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..'); // apps/web
const REPO = join(WEB, '..', '..');
const SRC = join(WEB, 'src');
const VITE_CONFIG = join(WEB, 'vite.config.ts');
const SHARED_PKG = join(REPO, 'packages/shared/package.json');

/** 裸包名：它是最**短**的那个键，会吃掉所有子路径。 */
const SHARED = '@mcsr/shared';

const rel = (p) => relative(REPO, p).split('\\').join('/');

/** 门禁自己坏了（读不懂输入），与"发现了缺陷"是两件事。 */
class GateInputError extends Error {}

/**
 * 把注释换成空格（**换行原样保留**，行号因此仍然对得上）。
 *
 * ⚠️ 这是"不解析、只剥注释"的代理手段，边界写在文件头：
 *    它只跟踪 `'` / `"` / `` ` `` 三种字符串状态。正则字面量里若含引号，
 *    可能让某段多行注释**漏剥**（结果是"多要求一条别名"这种响声，
 *    不是"漏报"）—— 本仓源码里没有这种写法。
 */
function stripComments(source) {
  let out = '';
  let i = 0;
  let quote = null;

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }

    if (ch === '/' && next === '*') {
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += '  ';
      i += 2;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

/** 递归列出 `apps/web/src` 下的 `.ts` / `.tsx`（去掉注释的那一份才拿去扫）。 */
function listSourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out.sort();
}

/**
 * 这条 import 是不是"只有类型"（`import type …` / `export type …`）？
 *
 * 从 `from '…'` 那一行往回找这条语句的头一行（跨行 import 的头在几十行以内）。
 */
function isTypeOnlyHead(lines, fromIndex) {
  // 单行写法：`import type … from '…'` 或 `export type … from '…'`
  if (/^\s*(?:import|export)\s+type\b/.test(lines[fromIndex] ?? '')) return true;

  // 跨行写法：头一行在上面，中间是名字列表（不能跨过上一条语句的结尾）。
  for (let i = fromIndex - 1; i >= 0 && i > fromIndex - 20; i -= 1) {
    const line = lines[i];
    if (/[;}]\s*$/.test(line)) return false;
    if (/^\s*(?:import|export)\s+type\b/.test(line)) return true;
    if (/^\s*(?:import|export)\b/.test(line)) return false;
  }
  return false; // 认不出来就按"值导入"算 —— 严格那一侧
}

/**
 * 扫出用到的每个 specifier（`@mcsr/shared` 或 `@mcsr/shared/<子路径>`），
 * 并**分开**记"值导入"与"只有类型导入"两种出现位置。
 *
 * ⚠️ 为什么必须分开：`import type` 在编译期就被 esbuild 擦掉，
 *    **根本不经过 Vite 的 alias 表** ⇒ 只有它的子路径在浏览器里其实不会炸。
 *    门禁**仍然要求它有条目**（规则简单、不会腐坏：下一个人把它改成值导入时
 *    不会有任何提示），但消息里必须说清"这一条只有类型导入"，
 *    否则就是一句说过头的话 —— 本仓对"守卫生成假事实"的容忍度是零。
 */
function scanImports(files) {
  // `from '…'` / `import('…')` / `import '…'` 三种入口写法。
  const re = /\b(?:from|import)\s*\(?\s*(['"])(@mcsr\/shared(?:\/[^'"]*)?)\1/g;
  const used = new Map();

  const record = (spec, kind, at) => {
    if (!used.has(spec)) used.set(spec, { value: null, typeOnly: null });
    if (used.get(spec)[kind] === null) used.get(spec)[kind] = at;
  };

  for (const file of files) {
    const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
    lines.forEach((line, index) => {
      re.lastIndex = 0;
      let m = re.exec(line);
      while (m !== null) {
        record(
          m[2],
          isTypeOnlyHead(lines, index) ? 'typeOnly' : 'value',
          { file: rel(file), line: index + 1 },
        );
        m = re.exec(line);
      }
    });
  }

  return used;
}

/** 读 `vite.config.ts` 的 alias 表：每条键的**行号**与目标路径。 */
function readAliasMap() {
  const lines = stripComments(readFileSync(VITE_CONFIG, 'utf8')).split('\n');
  const start = lines.findIndex((l) => /\balias\s*:\s*\{/.test(l));
  if (start === -1) throw new GateInputError('在 vite.config.ts 里找不到 `alias: {`');

  let depth = 0;
  let end = -1;
  for (let i = start; i < lines.length && end === -1; i += 1) {
    for (const ch of lines[i]) {
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
  }
  if (end === -1) throw new GateInputError('alias 表的 `{` 没有配对的 `}`');

  const entries = [];
  for (let i = start + 1; i < end; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    const m = /^\s*(['"])([^'"]+)\1\s*:\s*(.+?),?\s*$/.exec(line);
    if (!m) {
      throw new GateInputError(
        `vite.config.ts:${i + 1} 这一行认不出来，本检查没有覆盖它：${line.trim()}`,
      );
    }
    const t = /resolvePath\(\s*(['"])(.+?)\1\s*\)/.exec(m[3]);
    entries.push({ key: m[2], line: i + 1, target: t ? t[2] : null });
  }

  if (entries.length === 0) throw new GateInputError('alias 表里一条条目都没读到');
  return entries;
}

/** 从 `packages/shared/package.json` 的 `exports` 推出该写的那一行（类型检查走的就是它）。 */
function suggestEntry(spec) {
  const sub = spec.slice(SHARED.length + 1);
  const pkg = JSON.parse(readFileSync(SHARED_PKG, 'utf8'));
  let value = pkg.exports?.[`./${sub}`];
  if (value && typeof value === 'object') value = value.default ?? Object.values(value)[0];
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== 'string') return null;

  const target = value.replace(/^\.\//, '');
  return {
    exportsKey: `./${sub}`,
    exportsValue: value,
    resolved: `'../../packages/shared/${target}'`,
    line: `'${spec}': resolvePath('../../packages/shared/${target}'),`,
  };
}

// ---------------------------------------------------------------------------

function main() {
  const files = listSourceFiles(SRC);
  if (files.length === 0) throw new GateInputError(`${rel(SRC)} 下一个源文件都没扫到`);

  const used = scanImports(files);
  const entries = readAliasMap();
  const byKey = new Map(entries.map((e) => [e.key, e]));

  const bare = byKey.get(SHARED);
  if (!bare) {
    throw new GateInputError(
      `alias 表里没有裸包名那条 \`'${SHARED}'\`（它是所有子路径的兜底，必须有）`,
    );
  }

  const findings = [];
  const reportedPairs = new Set();
  const pairOf = (a, b) => `${a.line}:${a.key}|${b.line}:${b.key}`;

  // 1 / 2 —— 用到的子路径：有条目吗？排在裸包名上面吗？
  for (const [spec, sites] of used) {
    if (spec === SHARED) continue;
    const entry = byKey.get(spec);
    if (!entry) {
      findings.push({ kind: 'missing', spec, sites });
      continue;
    }
    if (entry.line > bare.line) {
      findings.push({ kind: 'below-bare', spec, sites, entry });
      reportedPairs.add(pairOf(bare, entry));
    }
  }

  // 3 —— 任何**短的前缀键**排在**长的键**上面（前缀替换会吃掉后者）。
  for (const short of entries) {
    for (const long of entries) {
      if (short === long) continue;
      if (!long.key.startsWith(short.key) || long.key.length <= short.key.length) continue;
      if (short.line > long.line) continue; // 长的在前 = 正确
      if (reportedPairs.has(pairOf(short, long))) continue;
      findings.push({ kind: 'prefix-order', short, long });
    }
  }

  // 4 —— `@mcsr/*` 别名的目标文件真的在吗？
  for (const entry of entries) {
    if (!entry.key.startsWith('@mcsr/')) continue;
    if (!entry.target) {
      findings.push({ kind: 'no-target', entry });
      continue;
    }
    if (!existsSync(join(WEB, entry.target))) {
      findings.push({ kind: 'target-missing', entry });
    }
  }

  const subpaths = [...used.keys()].filter((s) => s !== SHARED).sort();

  if (findings.length === 0) {
    console.log(
      `  ✓ 别名对账通过（apps/web/src 的 ${files.length} 个源文件 × ` +
        `${subpaths.length} 个子路径；alias 表 ${entries.length} 条，` +
        `裸包名在第 ${bare.line} 行）`,
    );
    console.log(`    已核对: ${subpaths.join(', ')}`);
    process.exit(0);
  }

  console.error('');
  console.error(
    '✗ 别名对账失败：`apps/web/src` 用到的共享子路径，与 vite.config.ts 的 alias 表对不上。',
  );
  console.error('');
  console.error('  后果不是样式错，是**整个页面在浏览器里一个字节都加载不出来**：');
  console.error('  Vite 先过 alias 表（**前缀替换**），条目缺失/顺序不对时');
  console.error('  `@mcsr/shared/<子路径>` 被裸包名那条吃成 `.../src/index.ts/<子路径>`，');
  console.error('  报 `Could not load ...`（看起来像路径写错）。');
  console.error('  而 `pnpm -w check`（走包的 exports）与渲染自检（tsx 直接跑、不过 Vite）');
  console.error('  **都看不见** —— 这个坑在本仓已经发生四次，见本脚本文件头。');
  console.error('');

  for (const f of findings) {
    console.error('  ' + '─'.repeat(72));

    if (f.kind === 'missing') {
      const valueSite = f.sites.value;
      const at = valueSite ?? f.sites.typeOnly;
      console.error(`  ▸ \`${f.spec}\` —— 别名表里**没有这一条**`);
      console.error(`    用在: ${at.file}:${at.line}${valueSite ? '' : '   ← ⚠️ 这一条**只有类型导入**'}`);
      if (!valueSite) {
        console.error('    （`import type` 编译期就被擦掉、不过 alias ⇒ 今天它其实炸不了；');
        console.error('      但**仍然要有条目**：下一个人把它改成值导入时不会有任何提示。）');
      }
      const s = suggestEntry(f.spec);
      if (s) {
        console.error(
          `    要加的一行（放进 \`vite.config.ts\` 的 alias 表，**裸包名 \`'${SHARED}'\` ` +
            `（第 ${bare.line} 行）之上**）:`,
        );
        console.error(`        ${s.line}`);
        console.error(
          `    （目标路径取自 \`packages/shared/package.json\` 的 ` +
            `\`exports["${s.exportsKey}"]\` = "${s.exportsValue}" ——`,
        );
        console.error('      类型检查走的就是它，所以这一行写错的话类型检查仍然全绿，只有浏览器会红。）');
      } else {
        console.error(
          `    ⚠️ \`packages/shared/package.json\` 的 exports 里**也没有** ` +
            `\`./${f.spec.slice(SHARED.length + 1)}\``,
        );
        console.error('       ⇒ 先加 exports（那一步），再加别名（这一步）。');
      }
      continue;
    }

    if (f.kind === 'below-bare') {
      const at = f.sites.value ?? f.sites.typeOnly;
      console.error(`  ▸ \`${f.spec}\` 的别名条目排在裸包名**下面**`);
      console.error(`    条目在: vite.config.ts:${f.entry.line}`);
      console.error(`    裸包名在: vite.config.ts:${bare.line}   ← 它必须在这条**上面**`);
      console.error(`    用在: ${at.file}:${at.line}`);
      console.error('    alias 取**第一个命中**的键，而裸包名吃掉了所有子路径 ⇒ 这一条永远不会生效。');
      continue;
    }

    if (f.kind === 'prefix-order') {
      console.error(`  ▸ \`${f.short.key}\` 排在 \`${f.long.key}\` **上面**`);
      console.error(`    ${f.short.line}: '${f.short.key}'`);
      console.error(`    ${f.long.line}: '${f.long.key}'`);
      console.error(
        `    前者是后者的前缀 ⇒ \`${f.long.key}\` 会被拼成` +
          ` \`${f.short.target ?? '?'}${f.long.key.slice(f.short.key.length)}\`（os error 3）。`,
      );
      console.error('    长的子路径必须排在短的**上面**（2026-09 M4 的 calendar / calendar-time）。');
      continue;
    }

    if (f.kind === 'no-target') {
      console.error(`  ▸ \`${f.entry.key}\` 的值看不懂（不是 \`resolvePath('…')\`）`);
      console.error(`    vite.config.ts:${f.entry.line}`);
      continue;
    }

    console.error(`  ▸ \`${f.entry.key}\` 的目标文件**不存在**`);
    console.error(`    vite.config.ts:${f.entry.line} → ${f.entry.target}`);
    console.error(`    解析成: ${rel(join(WEB, f.entry.target))}   ← 这个路径上没有文件`);
  }

  console.error('');
  console.error(`  共 ${findings.length} 处。改完 \`packages/shared/src/<文件>\` 或`);
  console.error('  `vite.config.ts` 之后重跑本检查（秒级）。');
  console.error('  ⚠️ 真正的端到端证据只有一条：`pnpm -F @mcsr/web build` 能过。');
  console.error('');
  process.exit(1);
}

try {
  main();
} catch (error) {
  if (error instanceof GateInputError) {
    console.error('');
    console.error('✗ 这个门禁**自己坏了** —— 不是发现缺陷，是这条检查根本没跑完。');
    console.error('');
    console.error(`  ${error.message}`);
    console.error('');
    console.error('  ⇒ 先修门禁或它要读的文件，别把这条读成"对账通过"。');
    console.error('');
    process.exit(2);
  }
  throw error;
}
