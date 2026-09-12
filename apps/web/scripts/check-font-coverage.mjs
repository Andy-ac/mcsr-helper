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
 * 由 apps/web 的 build 脚本在 vite build 之后自动调用。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..');
const REPO = join(WEB, '..', '..');

const COVERAGE = join(WEB, 'src/fonts/fusion-pixel-12px-zh_hans-subset.coverage.txt');

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

function loadRanges() {
  if (!existsSync(COVERAGE)) {
    console.error(`✗ 找不到字体覆盖表: ${relative(REPO, COVERAGE)}`);
    console.error('  由 .cache/genfontcoverage.py 生成（需要 Python + fonttools + brotli）。');
    process.exit(1);
  }
  const ranges = [];
  for (const line of readFileSync(COVERAGE, 'utf8').split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue;
    for (const part of line.trim().split(',')) {
      const [a, b] = part.split('-');
      ranges.push([Number.parseInt(a, 16), Number.parseInt(b ?? a, 16)]);
    }
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

const isCovered = makeIsCovered(loadRanges());

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
const problems = [];

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
    if (isCovered(cp)) continue;
    const full = String.fromCodePoint(cp);
    if (EMOJI_OK.has(full)) continue;

    problems.push({
      rel,
      line,
      ch: full,
      cp,
      ctx: src.slice(Math.max(0, i - 40), i + 40).split('\n').join(' '),
    });
  }
}

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

if (problems.length === 0) {
  console.log(`  ✓ 字体覆盖检查通过（${files.length} 个源文件，所有字符都在子集内）`);
  process.exit(0);
}

const byChar = new Map();
for (const p of problems) {
  if (!byChar.has(p.cp)) byChar.set(p.cp, { ch: p.ch, cp: p.cp, hits: [] });
  byChar.get(p.cp).hits.push(p);
}

console.error('');
console.error('✗ 字体覆盖检查失败：界面文字里有字符不在像素字体子集里。');
console.error('');
console.error('  这些字符不会报错，只会**安静地掉回系统字体** ——');
console.error('  在页面上表现为某几个字字形/大小和旁边不一致。');
console.error('');
for (const { ch, cp, hits } of byChar.values()) {
  const hex = cp.toString(16).toUpperCase().padStart(4, '0');
  console.error(`  ${JSON.stringify(ch)}  U+${hex}  ${hits.length} 处`);
  for (const h of hits.slice(0, 3)) {
    console.error(`      ${h.rel}:${h.line}   …${h.ctx.trim()}…`);
  }
  if (hits.length > 3) console.error(`      …还有 ${hits.length - 3} 处`);
}
console.error('');
console.error('  三选一：');
console.error('    1. 换成子集里已有的等价字符（« » 不在，← → 在；※ ！ 也在）');
console.error('    2. 把它加进字体子集后重新生成覆盖表');
console.error('    3. 如果是刻意用系统 emoji 字体，登记到本脚本的 EMOJI_OK 并写明理由');
console.error('');

process.exit(1);
