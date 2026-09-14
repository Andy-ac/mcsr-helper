#!/usr/bin/env node
/**
 * 检查：我们在界面上写下的每个字符，自托管的像素字体都渲染得了吗？
 *
 * ---------------------------------------------------------------------------
 * 为什么要查这个
 * ---------------------------------------------------------------------------
 * 自托管的像素字体是一个 **7368 码位的子集**（GB2312 常用字 + 少量符号）。
 * 不在子集里的字符**不会报错**，浏览器会安静地回退到系统字体 ——
 * 页面上表现为某几个字字形不一样、大小对不齐。
 *
 * 这正是它难被发现的原因：整个字体是一起生效的，只有那几个字不对劲，
 * 而且只有那几个字。真实案例（已修）：侧栏收起按钮用了 « / »，
 * 两个都不在子集里，而 .sidebar__toggle 明确指定了 --font-pixel。
 *
 * ---------------------------------------------------------------------------
 * 为什么要查**两份**字体（不是一个）
 * ---------------------------------------------------------------------------
 * 上游 TakWolf/fusion-pixel-font 只有一档字重，`font-weight: 700` 会走浏览器的
 * **合成粗体**（把像素网格糊掉，见 styles.css 顶部的整数倍字号约定）。
 * 所以标题用的是另一支**真粗体**像素字体：
 *
 *     .cache/fusion-bold-zh_hans.woff2
 *       ← pixel-font-studio/fusion-bold-pixel-font 的 12px proportional zh_hans
 *       ← 子集化字符集与常规体**逐字相同**
 *
 * 它在 CSS 里和常规体**共用同一个 family**，只靠 weight 区分
 * （见 apps/web/src/styles.css 的第二条 @font-face，font-weight: 700）。
 *
 * ⚠️ 于是就有了两份**各自独立**的子集，就有两份**各自独立**的覆盖表：
 *
 *     fusion-pixel-12px-zh_hans-subset.coverage.txt       （常规体，weight 400）
 *     fusion-pixel-12px-zh_hans-bold-subset.coverage.txt  （粗体，  weight 700）
 *
 * ⚠️⚠️ **不能把两张表合并成一张。** 它们回答的是"**这一份**字体能不能画出这些字"。
 *     合并之后就分不出是哪一份缺了 —— 而"粗体缺一个字"会在排查时被当成
 *     "常规体缺字"，方向直接错。所以这个脚本的失败信息里**必须指名是哪一份字体**。
 *
 * ---------------------------------------------------------------------------
 * 为什么扫源码而不是扫构建产物
 * ---------------------------------------------------------------------------
 * 先说试过的两条路，都失败过：
 *
 * 1. **正则抠字符串字面量** —— 有盲区。反引号模板字符串没被提取，于是
 *    `` `« ${t('nav.collapse')}` `` 里的 « 根本没进统计，检查器报"全部覆盖"，
 *    而它在线上是实打实的缺字。一个只检查"它自己找得到的东西"的检查器，
 *    给的是假的安心。
 *
 * 2. **扫 dist/assets/**.js** —— 没有解析盲区，但**全是误报**。
 *    react-markdown 的实体表里有 © ®，mdast-util-to-hast 的脚注功能里有 ↩，
 *    String.fromCodePoint 的兜底里有 U+FFFD —— 这些字符串都在产物里，
 *    但我们的界面永远不会把它们显示出来。给库的内部数据配字体，没有意义。
 *
 * 所以回到源码，但换一个**不依赖解析**的办法：
 *
 *     去掉注释之后，源码里所有的非 ASCII 字符，都是我们会显示的文字。
 *
 * 这条推理成立的前提是「标识符一律用 ASCII」，在这个代码库里是成立的，
 * 而且是个值得守住的约定。好处是它不解析字符串、模板、JSX 文本的区别 ——
 * 也就没有"漏掉某种写法"这种失败模式。
 *
 * 附带的好处：连 `throw new Error('...')` 里的中文也会被检查，而这是**对的** ——
 * useAsync 会把 error.message 直接渲染到页面上。
 *
 * 边界：content/resources.json（内容库）**不查**。M2 起那里会有用户提交的内容，
 * 用户写什么字符都有可能，缺字时优雅回退是设计好的行为，不是 bug。
 *
 * 用法：node scripts/check-font-coverage.mjs
 * 由 apps/web 的 build 脚本在 vite build 之后自动调用，check:all 里也跑一次。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..');
const REPO = join(WEB, '..', '..');

const FONT_DIR = join(WEB, 'src/fonts');

/**
 * 要检查的**每一份**字体：字体文件 + 它的覆盖表。
 *
 * ⚠️ 两份表是**分别**读的，各自回答"这一份能不能画出这些字"。
 *    不要把它们并成一份 —— 见文件头的说明。
 */
const FONTS = [
  {
    label: '常规体 Regular',
    weight: 400,
    font: 'fusion-pixel-12px-zh_hans-subset.woff2',
    coverage: 'fusion-pixel-12px-zh_hans-subset.coverage.txt',
  },
  {
    label: '粗体 Bold',
    weight: 700,
    font: 'fusion-pixel-12px-zh_hans-bold-subset.woff2',
    coverage: 'fusion-pixel-12px-zh_hans-bold-subset.coverage.txt',
  },
];

/** 要检查的源码根目录（相对于仓库根）。 */
const ROOTS = [
  'apps/web/src',
  'apps/web/index.html',
  'packages/ui/src',
  'packages/shared/src/i18n',
];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

/**
 * 故意留在系统 emoji 字体里的字符。
 *
 * 这些出现在 /embed-test 自检页的状态标记上。让它们走系统 emoji 字体是**有意**的：
 * 像素字体本来就没有 emoji 字形，硬造一个 12px 的单色版本反而不如彩色的好认。
 *
 * ⚠️ 这是**白名单，不是范围**。新出现一个未覆盖的字符时，检查会失败并把它打印出来 ——
 *    那时你必须做个选择：换掉它、加进字体子集、或者在这里显式登记并写明理由。
 *    不允许"自动放过"。
 *
 * ⚠️ 这份白名单对**两份字体都适用**（同一个理由：像素字体本来就没 emoji）。
 */
const EMOJI_OK = new Set([
  '\u2705', // ✅ 自检通过
  '\u274c', // ❌ 自检失败
  '\u26a0', // ⚠  警告（常与下面的 U+FE0F 连用作 emoji 呈现）
  '\ufe0f', // ️  变体选择符-16：把上一个字符变成 emoji 呈现
  '\ufe0e', // ︎  变体选择符-15：文本呈现
]);

// ---------------------------------------------------------------------------
// 覆盖表
// ---------------------------------------------------------------------------

/**
 * 读一份覆盖表，得到有序区间数组。
 *
 * ⚠️ **必须先把所有数据行拼成一行，再按 ',' 切。**
 *
 * 生成器（.cache/genfontcoverage.py）为了避免单行几万字符，每 4000 字符硬插
 * 一个 '\n'，而 4000 不是区间边界的对齐点 —— 于是**区间会被从中间劈开**：
 *
 *     第 4 行结尾：`...,543b-543c,543e`
 *     第 5 行开头：`-543e,5440-5440,...`
 *
 * 原文其实是 `543e-543e` 一个 token。逐行 split(',') 会切出 '-543e' 这个
 * 没有起点的碎片，`Number.parseInt('', 16)` 得到 **NaN**，
 * 于是区间变成 `[NaN, 0x543e]`。而下面的 isCovered 是**二分查找** ——
 * 二分要求数组有序，而含 NaN 的比较器（`x[0] - y[0]` = NaN → 当 0 处理）
 * 会让数组不再是单调的。
 *
 * 实测过这个 bug 的后果（8 个断行 → 8 个 NaN 区间）：有 **308 个码位**
 * 会被判成"覆盖"，而它们其实不在字体里。也就是说检查器会出现
 * **假的通过**（U+5BF1..U+8479）。拼接之后再切就没有这个问题，
 * 也才配得上"删掉一个字它必须变红"这个要求。
 */
function loadRanges(coveragePath, label) {
  if (!existsSync(coveragePath)) {
    console.error(`✗ 找不到字体覆盖表（${label}）: ${relative(REPO, coveragePath)}`);
    console.error('  生成方式：');
    console.error(`    python .cache/gencoverage.py apps/web/src/fonts/${FONTS.find((f) => f.label === label)?.font ?? '<font>.woff2'} \\`);
    console.error(`        apps/web/src/fonts/${FONTS.find((f) => f.label === label)?.coverage ?? '<font>.coverage.txt'}`);
    console.error('  （需要 Python + fonttools + brotli）');
    process.exit(1);
  }

  const body = readFileSync(coveragePath, 'utf8')
    .split('\n')
    .filter((line) => !line.startsWith('#') && line.trim())
    .map((line) => line.trim())
    .join('');

  const ranges = [];
  for (const part of body.split(',')) {
    const [a, b] = part.split('-');
    const lo = Number.parseInt(a, 16);
    const hi = b === undefined ? lo : Number.parseInt(b, 16);
    if (Number.isNaN(lo) || Number.isNaN(hi)) {
      // 真出现了就是覆盖表本身坏了 —— 静默放过等于把假通过写进构建。
      console.error(`✗ 覆盖表里有解析不了的区间（${label}）: ${JSON.stringify(part)}`);
      console.error(`  文件: ${relative(REPO, coveragePath)}`);
      process.exit(1);
    }
    ranges.push([lo, hi]);
  }
  ranges.sort((x, y) => x[0] - y[0]);
  return ranges;
}

function makeIsCovered(ranges) {
  return (cp) => {
    let lo = 0;
    let hi = ranges.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const [a, b] = ranges[mid];
      if (cp < a) hi = mid - 1;
      else if (cp > b) lo = mid + 1;
      else return true;
    }
    return false;
  };
}

/** 每份字体各自读表、各自建判定函数 —— 互不干扰。 */
const fonts = FONTS.map((f) => {
  const ranges = loadRanges(join(FONT_DIR, f.coverage), f.label);
  const codepoints = ranges.reduce((n, [a, b]) => n + (b - a + 1), 0);
  return { ...f, ranges, codepoints, isCovered: makeIsCovered(ranges) };
});

// ---------------------------------------------------------------------------
// 去注释
// ---------------------------------------------------------------------------

/**
 * 去掉注释 —— 而且必须**逐字符地**去，不能直接正则。
 *
 * 用正则去注释有两个经典陷阱，这里都躲开：
 *   · `'http://x'` 里的 `//` 会被当成行注释，把后面半行代码吃掉 ——
 *     于是那半行里的字符就漏检了（漏检 = 假通过）
 *   · 反过来，如果只是简单地把 `/*...*​/` 删掉，字符串里的 `/*` 也会误伤
 * 所以走一个最小状态机：只在"代码"状态里识别注释起点，
 * 进了字符串就只有转义符和对应的引号能结束它。
 *
 * 保留换行，好让行号仍然对得上。
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];
    const next = src[i + 1];

    // 行注释
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    // 块注释
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
      continue;
    }
    // 字符串 / 模板串：整段原样保留（里面的字正是我们要检查的）
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** HTML 用 <!-- --> 注释。 */
function stripHtmlComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}

// ---------------------------------------------------------------------------
// 遍历
// ---------------------------------------------------------------------------

function walk(path, out = []) {
  if (!existsSync(path)) return out;
  const st = statSync(path);
  if (st.isFile()) {
    if (/\.(ts|tsx|css|html)$/.test(path)) out.push(path);
    return out;
  }
  for (const entry of readdirSync(path)) {
    if (SKIP_DIRS.has(entry)) continue;
    walk(join(path, entry), out);
  }
  return out;
}

// 不值得为它们配字体的字符：空白、零宽、控制符
const isIgnorable = (cp) =>
  cp === 0x00a0 || // 不换行空格
  cp === 0x200b || // 零宽空格
  (cp >= 0x2000 && cp <= 0x200f) || // 各类空格与方向标记
  cp === 0xfeff; // BOM

// ---------------------------------------------------------------------------

const files = ROOTS.flatMap((r) => walk(join(REPO, r)));

/**
 * 扫一遍源码，收集**所有**候选字符及其位置。
 *
 * ⚠️ 这里**不按覆盖表过滤** —— 因为现在有两份覆盖表，而两份的答案可能不同。
 *    先收集，再对每份字体各筛一次，才能分别报出"哪一份缺了哪个字"。
 */
const candidates = [];

for (const path of files) {
  const rel = relative(REPO, path).replace(/\\/g, '/');
  const raw = readFileSync(path, 'utf8');
  const src = path.endsWith('.html') ? stripHtmlComments(raw) : stripComments(raw);

  let line = 1;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\n') {
      line++;
      continue;
    }
    const cp = src.codePointAt(i);
    if (cp < 0x80) continue;
    if (cp > 0xffff) i++;
    if (isIgnorable(cp)) continue;
    const full = String.fromCodePoint(cp);
    if (EMOJI_OK.has(full)) continue;

    candidates.push({
      rel,
      line,
      ch: full,
      cp,
      ctx: src.slice(Math.max(0, i - 40), i + 40).split('\n').join(' '),
    });
  }
}

/** 每份字体缺哪些字符 —— 分开算，因为两份的答案可以不一样。 */
const byFont = fonts.map((font) => ({
  font,
  missing: candidates.filter((c) => !font.isCovered(c.cp)),
}));

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

const totalMissing = byFont.reduce((n, f) => n + f.missing.length, 0);

if (totalMissing === 0) {
  const detail = byFont
    .map((f) => `${f.font.label} ${f.font.codepoints} 码位`)
    .join('、');
  console.log(
    `  ✓ 字体覆盖检查通过（${files.length} 个源文件 × ${fonts.length} 份字体；${detail}）`,
  );
  process.exit(0);
}

console.error('');
console.error('✗ 字体覆盖检查失败：界面文字里有字符不在像素字体子集里。');
console.error('');
console.error('  这些字符不会报错，只会**安静地掉回系统字体** ——');
console.error('  在页面上表现为某几个字字形/大小和旁边不一致。');
console.error('');

// 先给一行总览，让人一眼看出"是哪一份"缺字（否则会去查错字体）。
console.error('  按字体汇总（缺字个数）：');
for (const { font, missing } of byFont) {
  const mark = missing.length ? '✗' : '✓';
  console.error(
    `    ${mark} ${font.label.padEnd(16)} weight ${font.weight}  ` +
      `${missing.length} 个字符  (${font.font})`,
  );
}
console.error('');

for (const { font, missing } of byFont) {
  if (missing.length === 0) continue;

  console.error('  ' + '─'.repeat(72));
  console.error(`  ▸ ${font.label}（weight ${font.weight}）缺 ${missing.length} 个字符`);
  console.error(`    字体: ${relative(REPO, join(FONT_DIR, font.font))}`);
  console.error(`    覆盖表: ${relative(REPO, join(FONT_DIR, font.coverage))}`);
  console.error('');

  const byChar = new Map();
  for (const p of missing) {
    if (!byChar.has(p.cp)) byChar.set(p.cp, { ch: p.ch, cp: p.cp, hits: [] });
    byChar.get(p.cp).hits.push(p);
  }

  for (const { ch, cp, hits } of byChar.values()) {
    const hex = cp.toString(16).toUpperCase().padStart(4, '0');
    console.error(`    ${JSON.stringify(ch)}  U+${hex}  ${hits.length} 处`);
    for (const h of hits.slice(0, 3)) {
      console.error(`        ${h.rel}:${h.line}   …${h.ctx.trim()}…`);
    }
    if (hits.length > 3) console.error(`        …还有 ${hits.length - 3} 处`);
  }

  // 粗体和常规体是两份**独立**的子集/覆盖表：改错一份等于没改。
  console.error('');
  console.error(`    ⚠️ 要改的是**这一份**：${font.font}`);
  console.error('       加字进这份子集后，用下面这条重新生成**这份**的覆盖表：');
  console.error(
    `         python .cache/gencoverage.py apps/web/src/fonts/${font.font} \\`,
  );
  console.error(`             apps/web/src/fonts/${font.coverage}`);
  console.error('');
}

console.error('  三选一：');
console.error('    1. 换成子集里已有的等价字符（« » 不在，← → 在；※ ！ 也在）');
console.error('    2. 把它加进字体子集后重新生成覆盖表（注意改的是上面指名的那一份）');
console.error('    3. 如果是刻意用系统 emoji 字体，登记到本脚本的 EMOJI_OK 并写明理由');
console.error('');

process.exit(1);
