#!/usr/bin/env tsx
/**
 * 「排位赛种子」筛选面板（`/seeds` 的「世界种子」那一栏）· 渲染自检。
 *
 * 跑法（从仓库根）：
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:seeds
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:seeds -- --en
 *
 * ===========================================================================
 * 这一页此前**一个渲染自检都没有** —— 这一条把它补上
 * ===========================================================================
 * 本仓原有九个渲染脚本（grid / live / authoring / roleguide / calendar / resource /
 * share / ranked / home），**没有 seeds**。而这一轮把这一页的界面几乎全换了
 * （Task 5 的新面板、Task 6 的重新接线、旧 chip 面板整个删掉），那两次改动落地时
 * **没有任何产物级断言兜着** —— "改坏了但没有人知道"当时唯一的发现路径是
 * "有人打开页面看一眼"。渲染自检存在的全部理由就是这个。
 *
 * ===========================================================================
 * 为什么渲染的是 `SeedPickerPanel`，不是 `routes/Seeds.tsx`
 * ===========================================================================
 * `renderToStaticMarkup` **不跑 effect**（也不点击、不发请求），而 `routes/Seeds.tsx`
 * 自己取数、自己 `useState` —— 纯 SSR 下它永远停在"还没抽过"那一屏，写在页面里的
 * 任何一块都断言不到；而**不可能红**的守卫比没有守卫更坏（`docs/pending.md §5.63`）。
 * ⇒ 这一栏的界面住在 `components/SeedPicker.tsx` 的 `SeedPickerPanel` 里（**只吃 props**，
 *   不取数、不读 `window`、没有 effect），本脚本渲染它。
 * ⚠️ 另外还渲染了**结果卡片** `components/SeedResultCard.tsx`（同样只吃 props，一个
 *   `record`）—— 那是「种子数字不再三位一断」（用户第 5 条）唯一能被断言到的地方，
 *   见下面那一组（组数因此是 zh 11 / en 12）。
 * ⚠️ 页面那一侧（两个标签页、「抽一条」按钮、`resultKey` / `resultStale`、
 *   `/random` 与 `/search` 的分支、整块「按比赛 ID 查」）**本脚本一个字都证明不了** ——
 *   那是这一页已知的覆盖边界，写在文件末尾，不在这条自检的职责里。
 *
 * ===========================================================================
 * ⚠️★ 本文件**不会被类型检查**（这就是它必须自己盯着自己那几格 prop 的原因）
 * ===========================================================================
 * `apps/web/tsconfig.json` 的 `include` 是 `src/**`、`packages/ui/src/**`、`vite.config.ts`
 * —— **`scripts/**` 不在里面**。于是 `SeedPickerPanel` 那三格必填 prop
 * （`state` / `onChange` / `fieldErrors`）在**页面**上少一个或写错名字是编译错误，
 * 到了这里却是**静默**的：少传 `onChange`，那颗按钮的 `onClick` 就是 `undefined`，
 * 而产物里它与接好线的**长得一模一样**（SSR 不渲染事件处理器）。
 * ⇒ 本脚本一道**运行时**守卫（`assertPanelPropsGiven`）+ 一条"守卫自己必须能命中"的探针。
 * ⚠️ 这一条在这一页尤其现实：面板的 prop 名字改过一次（`fieldErrors` 是从
 *   "并列传 completion" 改过来的，见 `SeedPicker.tsx` 的文件头），而改名字这件事
 *   **在本脚本里不会有任何编译错误** —— 只有运行时守卫会拦住它。
 *
 * ===========================================================================
 * ★★ 六：那 47 条 `labelKey` 的**词条存在性 + 值**（这一条最要紧）
 * ===========================================================================
 * 那 47 个键（37 个变种 + 10 个群系）只在**一处**被引用：`packages/shared/src/seedPicker.ts`
 * 的表的 `labelKey` 字段（界面是 `t(variation.labelKey)`，传进去的是**变量**）。
 *
 * ⚠️★ 先划清**不是**什么 —— 这条理由的第一版写错了（评审抓的），别再照它推理：
 *    本仓**已经**有守卫能抓"表里的键名打错一个字"：
 *    `services/api/src/seeds-picker-shared.test.ts:899` 拿表里的 47 条键与**手抄的**
 *    `SPEC_LABEL_KEYS`（同文件 `:778`，抄自 spec §5.4）逐条比对 —— 键名写错 ⇒ `pnpm -w check` 当场红。
 *    （Task 4 报告 §8.4 当时也是这么记的：那份对照是"表内部自洽"的守卫。）
 * ⇒ ⑥ 真正**独有**的是另外两件，两件都**没有**第二道守卫：
 *    ① **两份字典里各有没有这条键**：键在**字典那一侧**被改坏时（表没动、字典少一条或写错），
 *       上面那条比的是**表**、看不见；`services/api/src/i18n-keys.test.ts` 那几条静态扫描
 *       只走 `apps/web/src` 与 `services/api/src`（`packages/shared/src` **不在**扫描根里，
 *       而界面传进去的是**变量**、不是字面量），它那条"两份字典键集合相等"也只能抓到"只加了一边"。
 *    ② **值等于它自己那个上游标识**：值抄错行时键存在、不是裸 key、两种语言还一致 ⇒ 其余判据全绿。
 *    ⇒ 表现是按钮上直接印出 `seedsPage.variation.village.snowyTundra`
 *      （i18next 对未知 key 原样返回 key），或者印出**别人**的名字。
 *    本脚本 ⑥ 逐条 × **两种语言**把这两件钉住（与当前跑的是哪一遍无关）。
 * ⚠️★ 所以**不要**因为"那条测试也能抓键名"就把 ⑥ 当成重复删掉：它比这条注释
 *    原来写的理由**更强**（原来那句把它的独有性吹大了），不是更弱。
 * ⚠️ 所以 ⑥ 遍历的是**表**，不是"这一张渲染出来的那一排"：只查渲染出来的那几个，
 *    剩下 40 条照样没有任何门禁 —— 而它们迟早会被渲染出来。
 *
 * ===========================================================================
 * ★ 十一：类名 ↔ CSS（本仓没有门禁能抓"渲染了但没样式"的类名）
 * ===========================================================================
 * `docs/pending.md §5.70`：本仓样式是全局的、没有 CSS Modules 兜底，而"渲染了一个
 * `styles.css` 里根本没有的类名"**没有任何门禁**看得见（`ShareForm` 里那个 `.mcsr-input`
 * 笔误活过了两轮评审）。⇒ 把本页产物里**所有** `seed*` 类名收集起来，逐个断言
 * `apps/web/src/styles.css` 里有对应规则。这一条只覆盖这一页，但它**能红**
 * （加一个类名而不加规则就红，Step 4 的 mutation ③ 就是证据）。
 * ⚠️ 判据必须"整个类名相等"：`css.includes('.seed__legend')` 会被
 *    `.seed__legenddot` **满足**（前者是后者的前缀）⇒ 一条不存在的规则看起来"有"。
 *    边界写死 `(?![A-Za-z0-9_-])`，并配探针把这个坑钉下来。
 *
 * 不用 JSX（`createElement`）：与 `sharerender.tsx` / `rankedrender.tsx` 同一条理由 ——
 * `scripts/**` 不在 include 里 ⇒ JSX 走 **classic runtime** ⇒ 必须 `import React from 'react'`，
 * 而 biome 的 `noUnusedImports` 会把它判成"未使用"并给一个**不安全自动修复**：
 * 谁点了那个修复，脚本就在运行时崩（`React is not defined`，指向第一处 JSX）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { en, zhCN } from '@mcsr/shared/i18n';
import type { SeedRecord, SeedString } from '@mcsr/shared/seed';
import {
  bastionContext,
  EMPTY_SEED_PICKER,
  markKey,
  markOf,
  overworldContext,
  pickTop,
  SEED_PICKER_BASTION_BIOMES,
  SEED_PICKER_BASTION_TYPES,
  SEED_PICKER_FORTRESS_BIOMES,
  SEED_PICKER_OVERWORLD,
  type SeedPickerBastionType,
  type SeedPickerState,
  type SeedPickerStructure,
  type SeedPickerVariation,
  tapVariation,
} from '@mcsr/shared/seedPicker';
import i18n from 'i18next';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { emText } from '@/components/Emphasis';
import { SeedPickerPanel } from '@/components/SeedPicker';
import { SeedResultCard } from '@/components/SeedResultCard';

const LANG = process.argv.includes('--en') ? 'en' : 'zh-CN';

await i18n.use(initReactI18next).init({
  lng: LANG,
  /*
   * ⚠️ `false` 而不是 `'zh-CN'`（与 `sharerender.tsx` / `rankedrender.tsx` 同一行、同一理由）：
   *    缺 en 词条时**原样返回 key**，于是 ⑨ 的裸 key 扫描能精确指出是哪一个 key。
   *    回退到中文的话，英文界面上冒出来的是中文，只能靠 ⑩ 的汉字扫描间接发现"某处漏了英文"。
   */
  fallbackLng: false,
  resources: { 'zh-CN': { translation: zhCN }, en: { translation: en } },
  interpolation: { escapeValue: false },
  returnNull: false,
});

let pass = 0;
const ok = (m: string): void => {
  pass += 1;
  console.log(`  ✓ ${m}`);
};

const t = (key: string, opts?: Record<string, unknown>): string => i18n.t(key, opts) as string;
const noop = (): void => undefined;

/**
 * 「这条词条在两种语言里都在吗」的**唯一**一份语言清单。
 *
 * ⚠️ ⑥（47 个 labelKey）与 ⑦（pickSlow）都要**两种**语言，两处共用这一个数组 ——
 *    各写一份的话，语言清单哪天变了只会改到一处，而另一处的表现是
 *    "某个 key 只在一种语言里查过"。⑥ 尤其不能看 `LANG`：它要与"这一遍跑的是哪种语言"无关。
 */
const LANGUAGES = ['zh-CN', 'en'] as const;

// ---------------------------------------------------------------------------
// 文本归一化与提取器（与 `sharerender.tsx` / `rankedrender.tsx` 同形、同一条纪律）
// ---------------------------------------------------------------------------

const decode = (s: string): string =>
  s
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/**
 * 比对用的"人看到的那串字"：**两边都过它**，含空格的词条才不会因为空白差异假红。
 *
 * ⚠️ 它顺带走一遍 `emText()`（与 `em()` **同一条剥标记策略**）：面板里 `Field` 的
 *    `hint` 是走 `em()` 渲染的，词条里的 `**强调**` 在产物里是 `<strong>`；
 *    不剥标记的话**带标记的词条两个方向都会错**（`docs/pending.md §5.63` 那一族）。
 * ⚠️★ 本栏目今天**一条带 `**` 的词条都没有**（`seedsPage.*` 那一块全是普通句子），
 *    所以这一步现在是空操作；留着它是为了让"某天有人给这句文案加强调"时两个方向都还对。
 */
const flat = (s: string): string => decode(emText(s)).replace(/\s+/g, '');
/** 原样的 HTML（只还原实体）：汉字扫描要看**属性**，所以用这一份。 */
const rawText = (html: string): string => decode(html);
/** 一段 HTML 的可见文字（属性里的内容**不算** —— 要算就用 `rawText`）。 */
const textOf = (html: string): string => flat(html.replace(/<[^>]+>/g, ' '));

/** 取词条并压平（比对用）—— 集中一处，免得每处都写一遍 `flat(t(...))`。 */
function fresh(key: string): string {
  return flat(t(key));
}

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

/**
 * `class` 属性的读取模式 —— **全文件唯一一份**（`elementsWithClass` / `classOf` / ⑪ 的收集都用它）。
 *
 * ⚠️★ 边界写 `(?<![\w-])`，**不是** `\b`：`-` 是**非单词字符**（`\b` 在它与 `c` 之间成立），
 *    所以 `\bclass="` 会被 `data-class="…"` **满足** —— 于是那个 `data-*` 属性的值
 *    会被当成**类名**。两种下场都不轻：
 *    · 对 ⑪ 是**假红**（`data-class="seed__x"` ⇒ 报一个根本没挂在元素上的类名）；
 *    · 对 `elementsWithClass` 更糟 —— 它会被当成"这个元素有这一格 class"，
 *      于是"某一排里有 / 没有 X"整组断言作用在**错误的片段**上（`§5.63` 那一族）。
 *    面板今天一个 `data-*` 属性都不渲染，所以这是**给将来**的边界（代价是一个字符）。
 */
const CLASS_ATTR = /(?<![\w-])class="([^"]*)"/;

/** 一段产物里**所有** `class` 属性的值，按空白拆成一个个类名（⑪ 的收集用）。 */
const classNamesIn = (html: string): string[] =>
  [...html.matchAll(new RegExp(CLASS_ATTR.source, 'g'))].flatMap((m) => (m[1] ?? '').split(/\s+/));

/**
 * 取出所有带这个 class 的元素的**外层 HTML**（自带简化的配对扫描）。
 *
 * ⚠️ 不用"非贪婪匹配到最近的 `</tag>`"：`<fieldset class="seed__row">` 里还嵌着
 *    `<legend class="seed__rowlabel">`，那样截出来的是**内层**那一小段 ——
 *    断言就在错误的字符串上做了（"看起来在断言 A、其实断言了 B"，§5.63 那一族）。
 */
function elementsWithClass(html: string, cls: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g)) {
    const open = m[0];
    const classes = (CLASS_ATTR.exec(open)?.[1] ?? '').split(/\s+/);
    if (!classes.includes(cls)) continue;
    const name = m[1] ?? '';
    if (VOID_TAGS.has(name)) {
      out.push(open);
      continue;
    }
    const re = new RegExp(`<(/?)${name}\\b[^>]*?>`, 'g');
    re.lastIndex = m.index + open.length;
    let depth = 1;
    /* ⚠️ 写成 `for` 而不是 `while ((close = re.exec(html)) !== null)`：
       biome 的 `noAssignInExpressions` 不许在条件里赋值（那条规则值得守）。 */
    for (let close = re.exec(html); close !== null; close = re.exec(html)) {
      if (close[1] === '/') {
        depth -= 1;
        if (depth === 0) {
          out.push(html.slice(m.index, close.index + close[0].length));
          break;
        }
      } else if (!close[0].endsWith('/>')) {
        depth += 1;
      }
    }
  }
  return out;
}

/*
 * ⚠️★ 下面**所有**断言都建立在 `elementsWithClass` 上，所以它自己有探针。
 *    没有这几条的话，"某一排里有/没有 X"可能全都作用在错误的片段上 ——
 *    那是 §5.63 那一族（看起来在断言 A，其实断言了 B），而**绿的样子完全一样**。
 */
const NESTED_FIXTURE =
  '<fieldset class="seed__row"><legend class="seed__rowlabel">a</legend><span>b</span></fieldset>';
assert.equal(
  elementsWithClass(NESTED_FIXTURE, 'seed__row').length,
  1,
  '★ 探针：class 要**整个词**相等 —— `seed__rowbtns` 不算 `seed__row`',
);
assert.equal(
  elementsWithClass('<div class="seed__rowbtns">z</div>', 'seed__row').length,
  0,
  '★ 探针：**前缀相同**的更长的类名不算命中（否则"产物里有 X"会在别的东西上成立）',
);
assert.equal(
  textOf(elementsWithClass(NESTED_FIXTURE, 'seed__row')[0] ?? ''),
  'ab',
  '★ 探针：取到的是**外层**元素（含里面那两层），不是"开头一小段"',
);
assert.equal(
  elementsWithClass(NESTED_FIXTURE, 'seed__nosuchclass').length,
  0,
  '★ 探针：不存在的 class 一个都不许匹配（否则"产物里没有 X"恒假）',
);
assert.equal(
  textOf(elementsWithClass(NESTED_FIXTURE, 'seed__rowlabel')[0] ?? ''),
  'a',
  '★ 探针：同一个产物里按另一个 class 取也要取对',
);
/*
 * ⚠️★ `data-class="…"` 那一格（判据是 `\b` 时会被它满足）：收集器会把 `data-*` 的值
 *    当成类名收进 ⑪ 的清单 ⇒ 报一个根本没挂在元素上的类名（假红）。
 */
assert.equal(
  elementsWithClass('<i data-class="seed__row" class="seed__real">x</i>', 'seed__row').length,
  0,
  '★★ 探针：`data-class="…"` **不算** `class`（`-` 是非单词字符，`\\b` 在那里成立）',
);
assert.deepEqual(
  classNamesIn('<i data-class="seed__decoy" class="seed__real seed__pickmark">x</i>'),
  ['seed__real', 'seed__pickmark'],
  '★★ 探针：类名收集器读的是 `class`，不是 `data-class`（否则 ⑪ 会去找一个不存在的类名的规则）',
);
assert.deepEqual(
  classNamesIn('<b class="seed__rowbtns"></b>'),
  ['seed__rowbtns'],
  '★ 探针：收集器本身能命中（否则上面那条会以"什么都没收集到"的方式通过）',
);

/**
 * 某个属性值（还原实体）。
 *
 * ⚠️ 边界与 `CLASS_ATTR` 同一份理由（`\b` 会被 `-` 满足）：写成 `\b${name}=` 的话，
 *    `attrOf(tag, 'class')` —— 也就是 `classOf` —— 会被 `data-class="…"` 满足，
 *    而 `classOf` 是**下面每一条 class 断言的地基**。
 */
const attrOf = (tag: string, name: string): string | null => {
  const m = new RegExp(`(?<![\\w-])${name}="([^"]*)"`).exec(tag);
  return m === null ? null : decode(m[1] ?? '');
};

/** 某个元素的 `class` 属性（没有就回空串）。 */
const classOf = (tag: string): string => attrOf(tag, 'class') ?? '';

assert.equal(
  classOf('<i data-class="seed__decoy" class="seed__real">x</i>'),
  'seed__real',
  '★★ 探针：`classOf` 读的是 `class`，不是 `data-class`（它下面每一条 class 断言都建在它上面）',
);

/**
 * 一个元素上有没有这一格 class。
 *
 * ⚠️ 判据是"**整个词**相等"：`is-with` 不是 `is-without`，
 *    `seed__pickbtn` 不是 `seed__pickbtns`。用 `includes` 的话
 *    `is-with` 会被 `is-without` **满足**（前缀关系）—— `is-with` 与 `is-without`
 *    正是本页最要紧的那两个词，这里写错等于 ④ 那组断言整个空跑。
 */
const hasClassIn = (tag: string, cls: string): boolean => classOf(tag).split(/\s+/).includes(cls);

/** 产物里一个按钮：外层 HTML + 属性串 + 可见文字（文字**含**三态记号）。 */
interface Btn {
  html: string;
  attrs: string;
  text: string;
}

/** 产物里所有按钮（配对扫描到 `</button>`；按钮里没有嵌套的按钮）。 */
function buttons(html: string): Btn[] {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    html: m[0],
    attrs: m[1] ?? '',
    text: flat((m[2] ?? '').replace(/<[^>]+>/g, ' ')),
  }));
}

/**
 * 按钮上的**文字**：把三态记号那一个 `<span>` 摘掉之后的可见文字。
 *
 * ⚠️★ 不摘的话，绿按钮的"文字"是 `+biome:structure:desert` —— 与词条比对时
 *    看起来像"词条对不上"，而其实只是记号被算进了文字里。那正是 §5.63 那一族
 *    （断言作用在了一个比你以为的更大的字符串上），所以判据要显式地把记号剥掉，
 *    而记号本身由 `glyphOf()` **单独**断言（两条都要有，缺哪条都会漏掉一种错法）。
 */
const MARK_SPAN = /<span class="seed__pickmark"[^>]*>[\s\S]*?<\/span>/g;
const labelOf = (b: Btn): string => textOf(b.html.replace(MARK_SPAN, ''));

/** 按钮前面的三态记号（没有记号就是空串）。 */
const glyphOf = (b: Btn): string => textOf(elementsWithClass(b.html, 'seed__pickmark')[0] ?? '');

/** 按钮的 `aria-pressed` 取值（React 对 aria-* 一律渲染成字符串）。 */
const ariaPressedOf = (b: Btn): string | null => attrOf(b.attrs, 'aria-pressed');

/** 一排的按钮容器。`variations=false` 是四排顶层单选，`true` 是变种排。 */
const rowBoxes = (html: string, variations: boolean): string[] =>
  elementsWithClass(html, 'seed__rowbtns').filter(
    (box) => hasClassIn(box, 'seed__rowbtns--variations') === variations,
  );

const topButtons = (html: string): Btn[] => rowBoxes(html, false).flatMap(buttons);
const variationButtons = (html: string): Btn[] => rowBoxes(html, true).flatMap(buttons);

/** 每一排的按钮数（按产物里的顺序）。 */
const rowButtonCounts = (html: string, variations: boolean): number[] =>
  rowBoxes(html, variations).map((box) => buttons(box).length);

/** 四/五个组名（`<legend>`），按产物里的顺序。 */
const rowLabels = (html: string): string[] =>
  elementsWithClass(html, 'seed__rowlabel').map((el) => textOf(el));

// ---------------------------------------------------------------------------
// 渲染入口（**每个产物都被记下来**，⑪ 的类名收集要用这一份）
// ---------------------------------------------------------------------------

const products: string[] = [];

const render = (node: ReactElement): string => {
  /*
   * ⚠️ 包 `MemoryRouter` 与其余九个渲染脚本同形：面板今天**一个链接都不渲染**，
   *    所以包着是空操作。留着它是照既有形状（将来它长出链接时，缺 router 是**当场崩**，
   *    而那正是我们想要的表现，不是静默降级）。
   */
  const html = renderToStaticMarkup(
    createElement(I18nextProvider, { i18n }, createElement(MemoryRouter, null, node)),
  );
  products.push(html);
  return html;
};

// ---------------------------------------------------------------------------
// 必填 prop 的**运行时**守卫（`scripts/**` 不受类型检查 —— 见文件头）
// ---------------------------------------------------------------------------

type FieldErrors = Partial<Record<'variations' | 'completion', string>>;

interface PanelProps {
  state: SeedPickerState;
  onChange: (next: SeedPickerState) => void;
  fieldErrors: FieldErrors;
}

const PANEL_KEYS = ['state', 'onChange', 'fieldErrors'] as const;

/**
 * ★★ 「这三格必填 prop 都显式传了」—— 一条**运行时**断言，因为这里没有编译期保护。
 *
 * ⚠️ 少传 `onChange` 的表现是"每颗按钮的 `onClick` 是 `undefined`"，而产物与
 *    接好线的**完全一样**（SSR 不渲染事件处理器）⇒ 产物级断言永远发现不了。
 *    这一条把"缺一格"从**静默**变成**红**。
 * ⚠️ 判据是 `undefined`，**不能**写成 falsy：`fieldErrors` 的 `{}`（"一个红字都没有"）
 *    与 `state` 的 `EMPTY_SEED_PICKER` 都是**合法值**，写成 falsy 会让每个正常夹具都红。
 */
function assertPanelPropsGiven(props: Record<string, unknown>, where: string): void {
  for (const key of PANEL_KEYS) {
    assert.notEqual(
      props[key],
      undefined,
      `★★ ${where}：必填 prop \`${key}\` 没有传 —— 本脚本不受类型检查保护，产物里也看不出来`,
    );
  }
  assert.equal(
    typeof props.onChange,
    'function',
    `★★ ${where}：\`onChange\` 必须是函数（传了 undefined 就是一颗按不动的按钮）`,
  );
  assert.equal(
    typeof props.fieldErrors,
    'object',
    `★★ ${where}：\`fieldErrors\` 必须是对象（面板会读它的两个槽）`,
  );
  assert.notEqual(props.fieldErrors, null, `★★ ${where}：\`fieldErrors\` 不能是 null`);
}

const panelProps = (state: SeedPickerState, fieldErrors: FieldErrors = {}): PanelProps => ({
  state,
  onChange: noop,
  fieldErrors,
});

/*
 * 探针：上面那个检查本身必须能命中 —— 否则"都传了"是一条永远不红的守卫。
 * ⚠️ 探针喂进去的对象必须是**除那一格之外全给齐**的：少给别的格子的话，
 *    守卫会先在别的 key 上失败，而那条探针就成了"报错信息里有没有 onChange"的巧合。
 */
assert.throws(
  () => {
    assertPanelPropsGiven(
      { ...panelProps(EMPTY_SEED_PICKER), onChange: undefined } as unknown as Record<
        string,
        unknown
      >,
      '探针',
    );
  },
  /onChange/,
  '★★ 探针：缺 prop 的检查本身必须能命中（否则"都传了"这条是空跑）',
);
assert.throws(
  () => {
    assertPanelPropsGiven(
      { ...panelProps(EMPTY_SEED_PICKER), fieldErrors: undefined } as unknown as Record<
        string,
        unknown
      >,
      '探针',
    );
  },
  /fieldErrors/,
  '★★ 探针：`fieldErrors` 缺了也要能命中（面板会读 `fieldErrors.variations`，缺了是当场崩）',
);

const renderPanel = (
  state: SeedPickerState,
  fieldErrors: FieldErrors = {},
  where = '面板',
): string => {
  const props = panelProps(state, fieldErrors);
  assertPanelPropsGiven(props as unknown as Record<string, unknown>, where);
  return render(createElement(SeedPickerPanel, props));
};

// ---------------------------------------------------------------------------
// 夹具：操作数一律**从表里取**（手写标识等于把表抄第二遍，抄错了没人发现）
// ---------------------------------------------------------------------------

/** 取不到就当场炸 —— 静默的 `undefined` 会让后面每条断言读的是 `undefined` 的属性。 */
function overworldRow(value: string): SeedPickerStructure {
  const row = SEED_PICKER_OVERWORLD.find((s) => s.value === value);
  assert.ok(row, `主世界表里必须有 ${value}（夹具从表里取，不手写标识）`);
  return row;
}

function bastionRow(value: string): SeedPickerBastionType {
  const row = SEED_PICKER_BASTION_TYPES.find((s) => s.value === value);
  assert.ok(row, `bastion 类型表里必须有 ${value}`);
  return row;
}

function variationOf(variations: readonly SeedPickerVariation[], id: string): SeedPickerVariation {
  const found = variations.find((v) => v.id === id);
  assert.ok(found, `这一排里必须有变种 ${id}`);
  return found;
}

const VILLAGE = overworldRow('village');
const BURIED = overworldRow('buried_treasure');
const BRIDGE = bastionRow('bridge');
const STABLES = bastionRow('stables');
const TREASURE = bastionRow('treasure');

/** 上下文由 `overworldContext()` / `bastionContext()` 拼 —— 与界面用的是同一个函数。 */
const VILLAGE_CTX = overworldContext(VILLAGE.value);
const VILLAGE_VARS = VILLAGE.variations;

const DESERT = variationOf(VILLAGE_VARS, 'biome:structure:desert');
const PLAINS = variationOf(VILLAGE_VARS, 'biome:structure:plains');
const OBSIDIAN = variationOf(VILLAGE_VARS, 'chest:structure:obsidian');

/** 只选了一行的状态。⚠️ `pickTop` 的第二个参数是**字段名**，与界面传的是同一个。 */
const S_VILLAGE = pickTop(EMPTY_SEED_PICKER, 'overworld', VILLAGE.value);
const S_BURIED = pickTop(EMPTY_SEED_PICKER, 'overworld', BURIED.value);
const S_BRIDGE = pickTop(EMPTY_SEED_PICKER, 'bastionType', BRIDGE.value);
const S_STABLES = pickTop(EMPTY_SEED_PICKER, 'bastionType', STABLES.value);
const S_TREASURE = pickTop(EMPTY_SEED_PICKER, 'bastionType', TREASURE.value);

/*
 * ★ ④ 的夹具走**状态机**，不手工造 marks：
 *   沙漠点一下 ⇒ 绿；`chest:structure:obsidian` 点一下 ⇒ 绿、再点一下 ⇒ 红。
 *   （后者没有互斥组，所以它两下**不会**动到沙漠那一颗 —— 这正是"绿 + 红可以并存"。）
 *   ⚠️ 同一次渲染里必须**三种状态都在**（一颗绿、一颗红、五颗灰），否则
 *      "未选的不带类名"那条可能只是因为整排都没选。
 */
const S_MARKED = tapVariation(
  tapVariation(S_VILLAGE, VILLAGE_CTX, DESERT, VILLAGE_VARS),
  VILLAGE_CTX,
  OBSIDIAN,
  VILLAGE_VARS,
);
const S_WITH_AND_WITHOUT = tapVariation(S_MARKED, VILLAGE_CTX, OBSIDIAN, VILLAGE_VARS);

console.log(`【${LANG}】排位赛种子 · 筛选面板（渲染自检）`);

// ---------------------------------------------------------------------------
console.log('① 四排单选：19 颗顶层按钮 / 四个组名 / 什么都没选时没有变种排');
// ---------------------------------------------------------------------------
/*
 * 这一组是后面每一组的**基线**：它把"界面上到底有几排、每排几颗、组名是什么"钉死，
 * 于是"某一排整个不见了"不会表现成"另一条断言恰好也说得通"。
 * ⚠️ 19 = 5 + 5 + 4 + 5（主世界 / 堡垒群系 / 堡垒类型 / 要塞群系），是**手抄的**：
 *    它防的是"表被改短了而界面跟着变短"——那种改动在界面上看不出任何异常。
 */
const EMPTY_HTML = renderPanel(EMPTY_SEED_PICKER, {}, '什么都没选');
assert.deepEqual(
  rowLabels(EMPTY_HTML),
  [
    'seedsPage.pickOverworld',
    'seedsPage.pickBastionBiome',
    'seedsPage.pickBastionType',
    'seedsPage.pickFortressBiome',
  ].map(fresh),
  '★★ 四个组名与**顺序**（主世界结构 → 堡垒群系 → 堡垒类型 → 要塞群系）',
);
for (const label of rowLabels(EMPTY_HTML)) {
  assert.equal(
    /^seedsPage\./.test(label),
    false,
    `★★ 组名必须是**词条的值**，不是裸 key（读到「${label}」—— 那一格少一条词条就是这个样子）`,
  );
}
assert.deepEqual(
  rowButtonCounts(EMPTY_HTML, false),
  [5, 5, 4, 5],
  '★ 四排顶层单选的按钮数（主世界 5 / 堡垒群系 5 / 堡垒类型 4 / 要塞群系 5）',
);
assert.deepEqual(
  [
    SEED_PICKER_OVERWORLD.length,
    SEED_PICKER_BASTION_BIOMES.length,
    SEED_PICKER_BASTION_TYPES.length,
    SEED_PICKER_FORTRESS_BIOMES.length,
  ],
  [5, 5, 4, 5],
  '★ 四张**表**的长度就是那四个数（表与界面必须一致，改表的长度要一起改这里）',
);
assert.equal(
  topButtons(EMPTY_HTML).length,
  19,
  `★ 顶层按钮共 19 颗（实测 ${String(topButtons(EMPTY_HTML).length)} 颗）`,
);
assert.deepEqual(
  topButtons(EMPTY_HTML).map((b) => b.text),
  [
    ...SEED_PICKER_OVERWORLD.map((row) => fresh(row.labelKey)),
    ...SEED_PICKER_BASTION_BIOMES.map((row) => fresh(row.labelKey)),
    ...SEED_PICKER_BASTION_TYPES.map((row) => fresh(row.labelKey)),
    ...SEED_PICKER_FORTRESS_BIOMES.map((row) => fresh(row.labelKey)),
  ],
  `★★ 19 颗顶层按钮的文字逐条 = 表里那 19 个 labelKey 在【${LANG}】里的值（顺序也在内）`,
);
assert.equal(
  rowBoxes(EMPTY_HTML, true).length,
  0,
  '★★ 什么都没选 ⇒ 一排变种都不渲染（空排比没有那一排更让人困惑，spec §6.2）',
);
assert.equal(
  topButtons(EMPTY_HTML).filter((b) => hasClassIn(b.attrs, 'is-on')).length,
  0,
  '★ 什么都没选 ⇒ 一颗 `is-on` 都没有（否则"选中"这件事在界面上是假的）',
);
ok(`四排单选：${String(topButtons(EMPTY_HTML).length)} 颗按钮 + 四个组名 + 没有变种排`);

// ---------------------------------------------------------------------------
console.log('② 断言 1：没有变种的结构**不渲染变种排**（buried_treasure / treasure）');
// ---------------------------------------------------------------------------
/*
 * ⚠️ 这两行的 `variations` 是**空数组**（不是缺字段、不是 `undefined`）：
 *    界面靠 `variations.length > 0` 决定那一排要不要出现，而 `undefined.length`
 *    会把整个面板打崩（`seeds-picker-shared.test.ts` 也钉着同一条）。
 * ⚠️ 每一条"没有那一排"旁边都有一条**正向对照**：那个结构自己照常能被选中
 *    （`overworld=buried_treasure` 与 `nether=treasure` 都是合法的筛选条件）。
 *    整个面板炸掉时"找不到变种排"也成立 —— 那种断言是假证据（`§5.63`）。
 */
assert.equal(BURIED.variations.length, 0, '★ 探针：埋藏的宝藏的 variations 确实是**空数组**');
assert.equal(TREASURE.variations.length, 0, '★ 探针：藏宝室的 variations 确实是**空数组**');
const NO_VARIATION_CASES = [
  { where: '埋藏的宝藏（buried_treasure）', state: S_BURIED, name: BURIED.labelKey },
  { where: '藏宝室（treasure）', state: S_TREASURE, name: TREASURE.labelKey },
] as const;
for (const c of NO_VARIATION_CASES) {
  const html = renderPanel(c.state, {}, `没有变种·${c.where}`);
  assert.equal(
    rowBoxes(html, true).length,
    0,
    `★★ ${c.where}：一排变种都不渲染（实测 ${String(rowBoxes(html, true).length)} 排）`,
  );
  assert.equal(
    variationButtons(html).length,
    0,
    `★★ ${c.where}：一颗变种按钮都没有（实测 ${String(variationButtons(html).length)} 颗）`,
  );
  assert.equal(rowLabels(html).length, 4, `★ ${c.where}：仍然是四排（只是没有变种那一排）`);
  assert.equal(
    topButtons(html).length,
    19,
    `★★ 正向对照：${c.where} 的 19 颗顶层按钮照常在（"没有变种排"不是"面板没渲染出来"）`,
  );
  const on = topButtons(html).filter((b) => hasClassIn(b.attrs, 'is-on'));
  assert.equal(
    on.length,
    1,
    `★ ${c.where}：恰好一颗顶层按钮是选中的（实测 ${String(on.length)} 颗）`,
  );
  assert.equal(
    labelOf(on[0] as Btn),
    fresh(c.name),
    `★★ ${c.where}：被选中的那一颗**就是它自己**（没有变种也照样能选）`,
  );
}
ok('没有变种的两个结构：不渲染变种排，而它们自己照常被选中（19 颗顶层按钮都在）');

// ---------------------------------------------------------------------------
console.log('③ 断言 2：变种排的按钮数 —— village 7 / stables 11 / bridge 4');
// ---------------------------------------------------------------------------
/*
 * ★★ 三个数是**三个不同的状态**，所以面板**一个状态渲染一次**、在那一次产物里数。
 *    想从一次渲染里同时拿到 7 与 11 是不可能的（两个结构不会同时是当前选中的那一行）。
 * ⚠️ 每一条旁边都有"表里也是这么多"与"每一颗的文字 = 表里那一行的词条"两条：
 *    只数个数的话，"七颗按钮都印同一个词"照样绿。
 * ⚠️ 变种排的**组名**也在这里钉：两排变种用的不是同一个词条
 *    （主世界那排是"结构变种"、堡垒那排是"堡垒变种"），用错在界面上看不出来。
 */
const COUNT_CASES = [
  {
    where: 'village',
    state: S_VILLAGE,
    vars: VILLAGE_VARS,
    count: 7,
    rowLabel: 'seedsPage.pickVariations',
    at: 1,
  },
  {
    where: 'stables',
    state: S_STABLES,
    vars: STABLES.variations,
    count: 11,
    rowLabel: 'seedsPage.pickBastionVariations',
    at: 3,
  },
  {
    where: 'bridge',
    state: S_BRIDGE,
    vars: BRIDGE.variations,
    count: 4,
    rowLabel: 'seedsPage.pickBastionVariations',
    at: 3,
  },
] as const;

/** 五个组名里，变种那一排出现在第几格（主世界那排在第 2 格，堡垒那排在第 4 格）。 */
const rowLabelsWithVariations = (variationLabel: string, at: number): string[] => {
  const keys = [
    'seedsPage.pickOverworld',
    'seedsPage.pickBastionBiome',
    'seedsPage.pickBastionType',
    'seedsPage.pickFortressBiome',
  ];
  keys.splice(at, 0, variationLabel);
  return keys.map(fresh);
};

for (const c of COUNT_CASES) {
  const html = renderPanel(c.state, {}, `变种排·${c.where}`);
  const btns = variationButtons(html);
  assert.equal(
    c.vars.length,
    c.count,
    `★ 探针：表里 ${c.where} 的 variations 就是 ${String(c.count)} 条（现读 ${String(c.vars.length)} 条）—— 否则下面那条测的是别的东西`,
  );
  assert.equal(
    btns.length,
    c.count,
    `★★ ${c.where}：变种按钮 ${String(c.count)} 颗（实测 ${String(btns.length)} 颗）`,
  );
  assert.deepEqual(
    btns.map((b) => labelOf(b)),
    c.vars.map((v) => fresh(v.labelKey)),
    `★★ ${c.where}：${String(c.count)} 颗按钮的文字逐条 = 表里那一行的 labelKey 在【${LANG}】里的值`,
  );
  assert.deepEqual(
    rowLabels(html),
    rowLabelsWithVariations(c.rowLabel, c.at),
    `★★ ${c.where}：变种排的组名与位置（第 ${String(c.at + 1)} 格，用**它自己那一句**词条）`,
  );
  assert.equal(
    rowBoxes(html, true).length,
    1,
    `★ ${c.where}：只有一排变种（两个结构同时选中时才会出现两排）`,
  );
  assert.equal(topButtons(html).length, 19, `★ ${c.where}：四排顶层单选照常 19 颗`);
}
ok('变种排：village 7 / stables 11 / bridge 4，逐条文字与组名都对（一次一个状态）');

// ---------------------------------------------------------------------------
console.log('④ 断言 3：同一次渲染里三种状态都在（is-with / is-without / 都没有）');
// ---------------------------------------------------------------------------
/*
 * ★★ 三种状态**必须出现在同一份 markup 里**：
 *    · 只断言"绿那颗带 `is-with`"的话，一个把**所有**按钮都画成绿的实现照样绿；
 *    · 只断言"没点过的不带"的话，什么都不画也照样绿。
 * ⇒ 三条一起：恰好一颗绿、恰好一颗红、剩下五颗两个类名都不带。
 * ⚠️ 记号（`+` / `-`）与 `aria-pressed` 是**同一个事实的三条通道**，分开断言：
 *    颜色是这一排按钮唯一的其它状态通道，而它对色盲用户等于没有状态
 *    （`SeedPicker.tsx` 的文件头写着这条设计）。
 */
assert.equal(
  markOf(S_WITH_AND_WITHOUT, VILLAGE_CTX, DESERT.id),
  'with',
  '★ 探针：夹具状态里沙漠是**绿**的（不是"没点过"，否则下面那条测的是别的按钮）',
);
assert.equal(
  markOf(S_WITH_AND_WITHOUT, VILLAGE_CTX, OBSIDIAN.id),
  'without',
  '★ 探针：夹具状态里藏宝是**红**的（点两下那个状态）',
);
assert.notEqual(DESERT.exclusive, null, '★ 探针：沙漠在互斥组里（`biome`）');
assert.equal(OBSIDIAN.exclusive, null, '★ 探针：藏宝**不在**互斥组里 ⇒ 绿与红才能同时存在');
assert.notEqual(DESERT.id, OBSIDIAN.id, '★ 探针：那两颗是不同的按钮（否则"一颗绿一颗红"无从谈起）');

const MARKED_HTML = renderPanel(S_WITH_AND_WITHOUT, {}, 'village · 一颗绿 + 一颗红');
const marked = variationButtons(MARKED_HTML);
assert.equal(
  marked.length,
  7,
  `★ 变种排照旧 7 颗（点过两下不会让按钮多出来或消失，实测 ${String(marked.length)} 颗）`,
);
const greens = marked.filter((b) => hasClassIn(b.attrs, 'is-with'));
const reds = marked.filter((b) => hasClassIn(b.attrs, 'is-without'));
const plainer = marked.filter(
  (b) => !hasClassIn(b.attrs, 'is-with') && !hasClassIn(b.attrs, 'is-without'),
);
assert.equal(greens.length, 1, `★★ 恰好一颗绿（实测 ${String(greens.length)} 颗）`);
assert.equal(reds.length, 1, `★★ 恰好一颗红（实测 ${String(reds.length)} 颗）`);
assert.equal(
  plainer.length,
  5,
  `★★ 剩下五颗**两个类名都不带**（实测 ${String(plainer.length)} 颗）—— 三种状态必须同框，否则这组守卫可能空跑`,
);
assert.equal(
  labelOf(greens[0] as Btn),
  fresh(DESERT.labelKey),
  `★★ 绿的是**点过的那一颗**（${VILLAGE.value} · 沙漠），不是排里别的按钮`,
);
assert.equal(
  labelOf(reds[0] as Btn),
  fresh(OBSIDIAN.labelKey),
  `★★ 红的是**点过两下的那一颗**（${VILLAGE.value} · 藏宝）`,
);
assert.equal(glyphOf(greens[0] as Btn), '+', '★ 绿那颗前面是 `+`（颜色之外的第二条通道）');
assert.equal(glyphOf(reds[0] as Btn), '-', '★ 红那颗前面是 `-`（黑白色下也分得开）');
for (const b of plainer) {
  assert.equal(
    elementsWithClass(b.html, 'seed__pickmark').length,
    0,
    `★ 没点过的那颗**没有记号**（读到「${b.text}」）`,
  );
}
assert.equal(ariaPressedOf(greens[0] as Btn), 'true', '★ 绿 ⇒ `aria-pressed="true"`');
assert.equal(
  ariaPressedOf(reds[0] as Btn),
  'mixed',
  '★★ 红 ⇒ `aria-pressed="mixed"`（**不是** true：绿与红产出的是两个不同的查询参数，念成同一句话就是在骗读屏用户）',
);
for (const b of plainer) {
  assert.equal(
    ariaPressedOf(b),
    'false',
    `★ 没点过的那颗 ⇒ \`aria-pressed="false"\`（读到「${b.text}」）`,
  );
}
assert.equal(
  topButtons(MARKED_HTML).filter(
    (b) => hasClassIn(b.attrs, 'is-with') || hasClassIn(b.attrs, 'is-without'),
  ).length,
  0,
  '★ 顶层那四排走的是 `is-on`（单选），不许带上变种那两格类名（它们说的是两种不同的"选中"）',
);
ok('三态同框：一颗 is-with（+ 记号）· 一颗 is-without（- 记号）· 五颗都没有；aria-pressed 三值齐');

// ---------------------------------------------------------------------------
console.log(
  '⑤ 断言 4：互斥在**视图**上的样子（走一遍状态机，不手工造状态）+ 标记读的是自己那一行的上下文',
);
// ---------------------------------------------------------------------------
/*
 * ★★ 这一条验的是**状态机算出来的东西、视图照着画对了吗**这半截。
 * ⚠️★ 它**不是**在验"容器会把状态机的输出交给视图"：本脚本**就是**那个容器 ——
 *    `S_EXCLUSIVE` 是在**这里**算出来、直接交给 `SeedPickerPanel` 的，
 *    面板自己的 `onClick` 里传了什么（尤其 `siblings`）在 SSR 里**看不见**。
 *    文件末尾那段覆盖边界说的就是这件事，两处必须是同一个口径。
 *
 * ⚠️⚠️ **不能**手工造一个"两颗都绿"的 state 传进去再期望视图只画一颗：
 *    视图是 state 的**纯函数**，它**就该**照 state 画两颗 —— 那样写出来的断言
 *    **永远红**（写这条的人会在"到底是实现错了还是断言错了"上耗掉半天）。
 *    正确做法是走**状态机**：先点沙漠（绿），再点平原（绿 + 互斥把沙漠顶回灰）。
 * ⚠️ 下面那条探针（手工造两颗绿 ⇒ 视图**确实**画两颗）不是多余的：
 *    它证明"数出恰好一颗"这个读法**看得见两颗** —— 没有它的话，
 *    `filter(is-with).length === 1` 在"这个读取器永远只能看见一颗"时也是绿的
 *    （那正是 §5.63 那一族的恒真守卫）。
 */
assert.equal(DESERT.exclusive, 'biome', '★ 探针：沙漠的互斥组是 `biome`');
assert.equal(
  PLAINS.exclusive,
  DESERT.exclusive,
  '★★ 探针：平原与沙漠在**同一个**互斥组里（不同组的话下面"被顶回灰"根本不该发生）',
);
const S_EXCLUSIVE = tapVariation(
  tapVariation(S_VILLAGE, VILLAGE_CTX, DESERT, VILLAGE_VARS),
  VILLAGE_CTX,
  PLAINS,
  VILLAGE_VARS,
);
assert.equal(
  markOf(S_EXCLUSIVE, VILLAGE_CTX, PLAINS.id),
  'with',
  '★ 状态机那一半：先点沙漠再点平原 ⇒ 平原是绿的',
);
assert.equal(
  markOf(S_EXCLUSIVE, VILLAGE_CTX, DESERT.id),
  'none',
  '★★ 状态机那一半：沙漠被顶回**灰**（`none`）—— 不是红（回红等于用户顺手得到一条"排除沙漠"）',
);

const EXCLUSIVE_HTML = renderPanel(S_EXCLUSIVE, {}, 'village · 沙漠 → 平原（互斥）');
const exclusiveBtns = variationButtons(EXCLUSIVE_HTML);
assert.equal(
  exclusiveBtns.length,
  7,
  `★★ 被顶掉的那一颗**还在排里**（回灰，不是消失；实测 ${String(exclusiveBtns.length)} 颗）`,
);
const exclusiveGreens = exclusiveBtns.filter((b) => hasClassIn(b.attrs, 'is-with'));
assert.equal(
  exclusiveGreens.length,
  1,
  `★★ 视图上恰好一颗绿（实测 ${String(exclusiveGreens.length)} 颗）—— 互斥真的跑在容器→视图这条链路上`,
);
assert.equal(
  labelOf(exclusiveGreens[0] as Btn),
  fresh(PLAINS.labelKey),
  '★★ 剩下的那一颗绿是**后点的**平原',
);
const desertBtn = exclusiveBtns.find((b) => labelOf(b) === fresh(DESERT.labelKey));
assert.ok(desertBtn, '★ 沙漠那颗按钮必须还在排里（找不到就等于它被删了）');
assert.equal(
  hasClassIn((desertBtn as Btn).attrs, 'is-with'),
  false,
  '★★ 沙漠那颗**不带** `is-with`（这是这一条的核心）',
);
assert.equal(
  hasClassIn((desertBtn as Btn).attrs, 'is-without'),
  false,
  '★★ 而且它**不带** `is-without`：被顶掉的回灰，不是"顺手帮你排除掉"',
);
assert.equal(ariaPressedOf(desertBtn as Btn), 'false', '★ 它的 `aria-pressed` 也回到 false');
assert.equal(
  elementsWithClass((desertBtn as Btn).html, 'seed__pickmark').length,
  0,
  '★ 它前面的记号也不见了（颜色、记号、aria 三条通道一起回到"没点过"）',
);
assert.equal(
  exclusiveBtns.filter((b) => hasClassIn(b.attrs, 'is-without')).length,
  0,
  '★★ 这次渲染里一颗红都没有（互斥只作用于"绿↔绿"：把别人顶成红是另一条契约）',
);

/*
 * ★★ 探针（反面控制）：手工把**两颗都设成绿**，视图**必须**照 state 画两颗。
 *    它证明的就是上面那句"视图是 state 的纯函数"——也正因为如此，
 *    ⑤ 的断言只能建立在"跑过状态机"的 state 上。
 */
const S_TWO_GREENS: SeedPickerState = {
  ...S_VILLAGE,
  marks: {
    [markKey(VILLAGE_CTX, DESERT.id)]: 'with',
    [markKey(VILLAGE_CTX, PLAINS.id)]: 'with',
  },
};
const TWO_GREENS_HTML = renderPanel(S_TWO_GREENS, {}, '（探针）手工造两颗绿');
assert.equal(
  variationButtons(TWO_GREENS_HTML).filter((b) => hasClassIn(b.attrs, 'is-with')).length,
  2,
  '★★ 探针：手工造两颗绿 ⇒ 视图**照画两颗**（所以"视图会自己纠正互斥"那种断言永远红，而"数出恰好一颗"这个读法确实看得见两颗）',
);

/*
 * ★★ 另一半（同一组，因为它是**同一件事**：state 里的标记 → 画成哪颗按钮）：
 *    变种排读的是**它自己那一行的上下文**（`bastion:stables`），不是别的行的。
 *
 * ⚠️ 这一条守的是一种**完全静默**的错法：上下文拼错一格（或者写死成另一行的），
 *    界面上什么都不会异常 —— 那一排按钮**永远全灰**，点一下也照样灰着，
 *    而用户唯一的感受是"这个筛选不好使"。标记本来就是**按上下文分开存**的
 *    （`SeedPickerState.marks` 的键是 `上下文#id`），所以"读错了上下文"与
 *    "还没标过"在产物里长得**一模一样**，没有任何别的门禁分得开它们。
 *    （`bastion:single:1` 在 bridge 与 stables 下都存在，这个夹具是真实处境。）
 * ⚠️ 正反两半都要有：正向证明"**这一行**上下文里的绿画得出来"，
 *    反向证明"**别的**上下文里的绿画不出来" —— 只有反向的话，
 *    一个"永远不读标记、只画灰按钮"的实现照样绿。
 */
const STABLES_CTX = bastionContext(STABLES.value);
const STABLES_VAR = variationOf(STABLES.variations, 'bastion:single:1');
const S_STABLES_GREEN = tapVariation(S_STABLES, STABLES_CTX, STABLES_VAR, STABLES.variations);
const stablesGreens = variationButtons(renderPanel(S_STABLES_GREEN, {}, 'stables · 一颗绿')).filter(
  (b) => hasClassIn(b.attrs, 'is-with'),
);
assert.equal(
  stablesGreens.length,
  1,
  `★★ 正向对照：stables 那一排读的是 \`${STABLES_CTX}\` ⇒ 那一格绿**画得出来**（实测 ${String(stablesGreens.length)} 颗）`,
);
assert.equal(
  labelOf(stablesGreens[0] as Btn),
  fresh(STABLES_VAR.labelKey),
  '★★ 而且画出来的就是那一颗（不是排里别的按钮）',
);
const S_OTHER_CONTEXT: SeedPickerState = {
  ...S_STABLES,
  marks: { [markKey(bastionContext(BRIDGE.value), STABLES_VAR.id)]: 'with' },
};
assert.equal(
  variationButtons(renderPanel(S_OTHER_CONTEXT, {}, 'stables · 绿记在别的上下文里')).filter((b) =>
    hasClassIn(b.attrs, 'is-with'),
  ).length,
  0,
  '★★ 反向对照：那颗绿是记在 `bastion:bridge` 底下的 ⇒ **这一排**一颗绿都不许有（标记按上下文分开存）',
);
ok(
  '互斥（走状态机）：后点的那颗绿、先点的那颗回灰且不是红；读法看得见两颗；变种排读的是自己那一行的上下文',
);

// ---------------------------------------------------------------------------
console.log('⑥ 断言 5：表里全部 47 个 labelKey 逐条 × 两种语言');
// ---------------------------------------------------------------------------
/*
 * ★★ 这是本文件最要紧的一组；完整理由在文件头，这里只留最容易记错的那一句：
 *    **"打错键名不会有任何门禁发现"是假的** —— `services/api/src/seeds-picker-shared.test.ts:899`
 *    拿表里的键与手抄的 `SPEC_LABEL_KEYS` 比对，键名写错当场红。
 *    ⑥ 独有的是**另外两件**：两份字典里各有没有这条键（两种语言都要查）、
 *    以及**值等于它自己那个上游标识**。界面上印出那一串 key 本身，
 *    就是"字典那一侧少了或改了"的表现 —— 那种改法别的门禁看不见。
 * ⚠️ 遍历的是**表**，不是"这一张渲染出来的那一排"：只查渲染出来的那几个，
 *    剩下 40 条照样没有任何门禁 —— 而它们迟早会被渲染出来。
 * ⚠️ **两种语言都要查**，与这一遍跑的是 `--en` 还是默认无关（`LANGUAGES`）：
 *    中文那一遍跑的时候英文那半边同样没人看。
 * ⚠️ 47 这个数字是**手抄的**（本仓惯例）：它防的是"为了让红的变绿，把某一行从表里删掉"。
 *    改表就要一起改这里。
 * ⚠️★ 遍历的是**成对的**（词条键, 上游标识），不是一串键："键存在"与"值是对的 id"
 *    是两件事 —— 值抄错行时键照样存在、照样不是裸 key、照样两种语言一样。
 */
const VARIATION_LABEL_PAIRS: readonly { key: string; id: string }[] = [
  ...[...SEED_PICKER_OVERWORLD, ...SEED_PICKER_BASTION_TYPES].flatMap((row) =>
    row.variations.map((v) => ({ key: v.labelKey, id: v.id })),
  ),
  ...SEED_PICKER_BASTION_BIOMES.map((row) => ({ key: row.labelKey, id: row.value })),
  ...SEED_PICKER_FORTRESS_BIOMES.map((row) => ({ key: row.labelKey, id: row.value })),
];
const VARIATION_LABEL_KEYS: readonly string[] = VARIATION_LABEL_PAIRS.map((pair) => pair.key);
assert.equal(
  VARIATION_LABEL_KEYS.length,
  47,
  `探针：冻结的词汇表就是 47 条（37 个变种 + 10 个群系；现读 ${String(VARIATION_LABEL_KEYS.length)} 条）`,
);
assert.equal(
  new Set(VARIATION_LABEL_KEYS).size,
  VARIATION_LABEL_KEYS.length,
  '★ 47 条键互不相同（两个变种共用一个键 = 界面上两个不同的东西显示同一个词，spec §5.2/§5.3）',
);
for (const { key, id } of VARIATION_LABEL_PAIRS) {
  for (const lng of LANGUAGES) {
    assert.ok(
      i18n.exists(key, { lng }),
      `★★ 词条 ${key} 在【${lng}】里**不存在** —— 界面上会直接印出这个 key 本身（i18next 对未知 key 原样返回 key）`,
    );
    const value = i18n.t(key, { lng }) as string;
    assert.notEqual(
      value,
      key,
      `★★ 词条 ${key} 在【${lng}】里没有真值（i18next 把 key 原样返回了）`,
    );
    assert.notEqual(
      flat(value),
      '',
      `★★ 词条 ${key} 在【${lng}】里是空的（空格子看起来像渲染坏了）`,
    );
    /*
     * ★★ 值必须就是**它对应的那个上游标识**（spec §5.1 / R6：这一轮的值 = 标识原文，
     *    两种语言写同一串）。这一条同时守住两件事：
     *      · 值抄错行（`plains` 那一格放着 `desert` 的串）—— 那颗按钮上挂着**别人**的名字，
     *        而键存在、不是裸 key、两种语言也对得上，**其它门禁一条都发现不了**；
     *      · 只翻译了一半（一边是 id、一边是中文）—— 同一条键在两种语言的界面上说两件事。
     *    ⚠️ 因此它**蕴含**了"两种语言的值必须相同"，那条就不必单独写
     *      （本仓的规矩：不可能红的守卫比没有守卫更坏）。同理也没有"值不能是另一条 key"
     *      那一条：id 永远不以 `seedsPage.` 开头。
     *    ⚠️★ 用户之后真的要改中文的那一天，要改的**就是这一条**：那时的正确判据回到
     *      "值不是裸 key"（上面那两条），而不再是"值等于 id"。别把它当成永久的业务断言。
     */
    assert.equal(
      flat(value),
      flat(id),
      `★★ 词条 ${key} 在【${lng}】里的值不是它对应的上游标识（期望「${id}」，实读「${value}」）—— 按钮上会挂着别的变种的名字`,
    );
  }
}
ok(
  `词汇表：${String(VARIATION_LABEL_KEYS.length)} 条 labelKey × 两种语言，逐条存在、有真值、不是裸 key、值等于它自己的上游标识`,
);

// ---------------------------------------------------------------------------
console.log('⑦ 断言 7：「要等 3–4 秒」那句在产物里（含那个秒数）');
// ---------------------------------------------------------------------------
/*
 * ★ 这句话**不是装饰**：带 `variations` / `without` 的查询实测 3.2–4.1 秒
 *   （spec §2.3）。不说清的话用户会在第二秒开始反复点，而每一下都是上游
 *   那台单核机器上的一次查询（配额还只有每 IP 每分钟 20 次）。
 * ⚠️ 判据分两层，缺一层都可能是空跑：
 *    ① 那句词条**两种语言里都有真值**（不然产物里印的是 key，而 key 当然"在产物里"）；
 *    ② 它**在面板里**、是**它自己那一段**，而且**带着 3–4 这个秒数** ——
 *       只剩一句"可能会慢"的话，用户仍然不知道要等多久（那是这句话存在的全部意义）。
 */
for (const lng of LANGUAGES) {
  assert.ok(
    i18n.exists('seedsPage.pickSlow', { lng }),
    `★★ seedsPage.pickSlow 在【${lng}】里不存在（缺了它用户会以为页面卡死）`,
  );
  assert.notEqual(
    i18n.t('seedsPage.pickSlow', { lng }),
    'seedsPage.pickSlow',
    `★★ seedsPage.pickSlow 在【${lng}】里没有真值`,
  );
}
const SLOW = fresh('seedsPage.pickSlow');
assert.ok(
  /3\D{1,3}4/.test(SLOW),
  `★★ 那句话里必须有「3–4」这个秒数（现读「${SLOW}」）—— 只写"可能会慢"等于没写`,
);
const hintsOf = (html: string): string[] =>
  elementsWithClass(html, 'mcsr-field__hint').map((el) => textOf(el));
for (const [where, html] of [
  ['什么都没选', EMPTY_HTML],
  ['一颗绿 + 一颗红', MARKED_HTML],
] as const) {
  assert.ok(
    hintsOf(html).includes(SLOW),
    `★★ 「${SLOW}」必须作为**它自己那一段**出现在面板里（${where}；面板里现读的提示语：${hintsOf(html).join(' | ')}）`,
  );
}
assert.equal(
  hintsOf(EMPTY_HTML).includes(fresh('seedsPage.pickHint')),
  false,
  '★ 探针：这个读取器能返回"没有"（`pickHint` 属于**页面**，面板里本来就不该有它）',
);
assert.notEqual(
  SLOW,
  fresh('seedsPage.pickLegend'),
  '★ 探针：「要等 3–4 秒」与三态图例不是同一句话（否则上面那条可能认错了段落）',
);
/*
 * ★ 同一组里的第二句**功能性**文案：三态图例（`pickLegend`）。
 *
 * ⚠️ 它也是"不是装饰"那一类：三态**只靠颜色**表达（绿 / 红 / 灰），
 *    对色盲用户等于没有状态，所以这句可见图例是那条设计的一部分
 *    （`SeedPicker.tsx` 的文件头与 `zh-CN.ts` 那一块都写着这句话）。
 * ⚠️ 为什么这一格要单独断言：那三颗点（`.seed__legenddot--*`）的存在由 ⑪ 的
 *    MUST_RENDER 兜着，**但这句解释有没有**没有任何门禁看得见 —— 删掉它之后
 *    剩下三颗没有说明的圆点，界面上看起来仍然"正常"。
 * ⚠️★ 判据是"图例那一格的文字里**包含**这句话"，不是"那一格**等于**这句话"：
 *    第一格 `.seed__legenditem` 里还嵌着两个记号 span（`+` / `-`），
 *    所以它的可见文字是 `+-点一下＝要求（绿）…`。写成相等的话这条断言会**永远红**，
 *    而"断言作用在了一个比你以为的更长的串上"正是 `§5.63` 那一族
 *    （写这条时的第一版就是这么错的，实测红出来的）。
 */
const LEGEND = fresh('seedsPage.pickLegend');
const legendItems = elementsWithClass(EMPTY_HTML, 'seed__legenditem').map((el) => textOf(el));
const legendText = legendItems.join(' | ');
assert.ok(
  legendText.includes(LEGEND),
  `★★ 三态图例那一句必须渲染出来（期望在里面找到「${LEGEND}」，现读图例文字：${legendText}）`,
);
assert.notEqual(LEGEND, 'seedsPage.pickLegend', '★★ 探针：三态图例那句话在当前语言里必须有真值');
assert.equal(
  legendItems.length,
  2,
  `★ 图例恰好两格（三态那句 + 「互斥只作用于要求」那句；实测 ${String(legendItems.length)} 格）`,
);
ok(`两句功能性文案都在产物里：pickSlow「${SLOW}」+ pickLegend「${LEGEND}」`);

// ---------------------------------------------------------------------------
console.log('⑧ 两个红字槽都渲染（面板只吃**已经翻好**的文本）');
// ---------------------------------------------------------------------------
/*
 * ⚠️ 这一条守的是一个**没有编译期保护**的接缝：`buildSeedPickerParams()` 吐回来的是
 *    **词条 key**，而面板的 props 要的是**已翻译的文本**，两边都是 `string`
 *    ⇒ 页面忘了 `t()` 照样编译通过，然后在按钮排下面印出一串
 *    `seedsPage.errFilterTooLong`（`routes/Seeds.tsx` 上那条注释记着这件事）。
 *    这里断言的是"面板把两个槽都渲染出来了、渲染的是它拿到的那两句话"。
 * ⚠️ `variations` 那个槽同时承担"排除条件太长"（两个参数共用一句红字，
 *    见 `SeedPicker.tsx` 的文件头 ②），所以它渲染在**所有**变种排下面。
 */
const ERR_VARS = fresh('seedsPage.errFilterTooLong');
const ERR_COMPLETION = fresh('seedsPage.errCompletionFormat');
assert.notEqual(
  ERR_VARS,
  ERR_COMPLETION,
  '★ 探针：两句红字本身不同（否则"各渲染自己那一句"分不开）',
);
assert.notEqual(ERR_VARS, 'seedsPage.errFilterTooLong', '★★ 探针：那句话在当前语言里必须有真值');
const ERR_HTML = renderPanel(
  S_VILLAGE,
  { variations: ERR_VARS, completion: ERR_COMPLETION },
  '两个红字槽都有',
);
assert.deepEqual(
  elementsWithClass(ERR_HTML, 'fielderr').map((el) => textOf(el)),
  [ERR_VARS, ERR_COMPLETION],
  '★★ 两个槽各渲染自己那一句，顺序 = `variations` 在前（挂在变种排下面）、`completion` 在后（挂在输入框下面）',
);
assert.equal(
  elementsWithClass(EMPTY_HTML, 'fielderr').length,
  0,
  '★★ 正面对照：没有任何错误时一块红字都不渲染（否则"渲染了红字"这条是恒真的）',
);
for (const text of [ERR_VARS, ERR_COMPLETION]) {
  assert.equal(
    /^seedsPage\./.test(text),
    false,
    `★★ 红字必须是**翻好的句子**，不是裸 key（读到「${text}」）`,
  );
}
ok('红字：两个槽各渲染自己那一句（顺序对），没有错误时一块都没有');

// ---------------------------------------------------------------------------
console.log('★ 新增组（用户第 5 条）：种子数字不再三位一断 —— 渲染**结果卡片**本体');
// ---------------------------------------------------------------------------
/*
 * ★★ 这一组是**整支分支的终审之后补的**，理由不是"再加固一点"，而是当时**零覆盖**：
 *    用户第 5 条（"所有展示的种子不要三位一断，包括'按条件随机抽一条'"）的实现是
 *    Task 1 删掉 `formatSeedForDisplay` + 两个消费点改成渲染原值 —— 而**没有任何门禁**
 *    看得见"分组哪天又回来了"。本脚本此前只渲染 `SeedPickerPanel`，那里面
 *    **一个种子数字都没有**（它的第 1 条断言是 `buried_treasure` 的空排）。
 *    ⚠️ 更糟的是记录里写着相反的：`docs/seeds-picker-plan.md` 当时说"markup 里不再有逗号
 *    这一条由 seeds 渲染自检的第 1 条断言钉住" —— 五条用户要求里有一条零覆盖、
 *    而账本说它被覆盖了，所以这一组是**新增**的（组数因此从 zh 10 / en 11 变成
 *    zh 11 / en 12，见文件末尾那个探针）。
 *    ⚠️ 因此下面几条断言的措辞都必须**指名道姓**（把原值与分组形态都印出来）：
 *       这一组的全部价值就是"分组回来的那一天，红的那条说得清红在哪"。
 *
 * ⚠️ 为什么渲染 `SeedResultCard` 而不是 `routes/Seeds.tsx`：与文件头那条理由**同一条**
 *    （页面自己取数、有 `useState` / effect，纯 SSR 下停在"还没抽过"那一屏 ——
 *    写在那里的断言不可能红）。卡片**只吃一个 prop**（`record`），静态渲染得出来，
 *    而它正是那三行种子数字的家（主世界 / 下界 / 末地）。
 *    ⚠️ 页面那一侧的接线（哪个标签页、结果卡片和按钮行）仍然一个字都没证明，
 *       边界照旧写在文件末尾。
 * ⚠️ 19 位这个值不是随便挑的：它就是本仓注释里一直在用的那个
 *    （`packages/shared/src/seed.ts` 与 `SeedResultCard.tsx` 的文件头，
 *    "`Number('7304888896886165976')` 会静默变成 7304888896886166000"）。
 *    用一个**已知会被分组**的值当夹具，读的人不必再核对一遍位数。
 */
const LONG_SEED: SeedString = '7304888896886165976';

/**
 * 被删掉的那个 `formatSeedForDisplay`（`8b35b09` 的 diff，逐字）所做的事：**按字符串**
 * 每三位插一个逗号。⚠️ 它当年刻意**不走 `Number`** —— 走了就会把种子静默改掉。
 *
 * ⚠️★ 这一段**只用来算反面读数**，不参与渲染。把它写成函数、而不是在断言里手写那个
 *    带逗号的字面量，是为了让"分组长什么样"这件事**有出处**：手写的风险是
 *    "某天有人用另一种写法把分组加回来" ⇒ 手抄的那串对不上 ⇒ 断言照样绿。
 */
const groupLikeTheDeletedFormatter = (seed: string): string =>
  seed.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** 分组形态：`7,304,888,896,886,165,976`。 */
const GROUPED_SEED = groupLikeTheDeletedFormatter(LONG_SEED);
assert.equal(
  GROUPED_SEED,
  '7,304,888,896,886,165,976',
  '★ 探针：反面读数就是"每三位一个逗号"（19 位 ⇒ 6 个逗号）—— 它必须与被删掉的那个格式化器的算法一致，否则下面扫的是一串没人会产出的东西',
);
assert.notEqual(
  LONG_SEED,
  GROUPED_SEED,
  '★★ 探针：原值与分组形态不是同一个串（否则"产物里没有分组"恒真）',
);
assert.equal(
  rawText(`<code title="${GROUPED_SEED}">${GROUPED_SEED}</code>`).includes(GROUPED_SEED),
  true,
  '★★ 探针：这个读取器能在一个带逗号的串上命中（否则下面那条是空跑）',
);

/** 一条真实的记录形状：三行种子都给**同**一个 19 位的值，`matchDate` 给 null（上游真的会给 null）。 */
const CARD_RECORD: SeedRecord = {
  matchId: 3650001,
  matchDate: null,
  overworldSeed: LONG_SEED,
  netherSeed: LONG_SEED,
  theEndSeed: LONG_SEED,
};
const CARD_HTML = render(createElement(SeedResultCard, { record: CARD_RECORD }));
const digitEls = elementsWithClass(CARD_HTML, 'seed__digits');
assert.equal(
  digitEls.length,
  3,
  `★ 正面读数：三行种子数字都渲染出来了（实测 ${String(digitEls.length)} 个 \`.seed__digits\`）—— 一个都没渲染的话，下面"没有逗号"会因为整张卡片是空的而成立`,
);
for (const el of digitEls) {
  assert.equal(
    textOf(el),
    LONG_SEED,
    `★★ 显示的就是那 19 位**原文**（实读「${textOf(el)}」）—— 实读值一旦带上逗号就是用户第 5 条被破坏的样子（分组形态＝「${GROUPED_SEED}」）`,
  );
  /*
   * ⚠️ `title` 单独断言，不并进上面那条：显示原值、而 `title` 是被分组的，
   *    表现是"鼠标一停就冒出一串带逗号的数字，照着它复制就粘不进 Minecraft"
   *    —— 而那正是用户要改掉的那个坑（**必须**是同一个原值）。
   */
  assert.equal(
    attrOf(el, 'title'),
    LONG_SEED,
    `★★ 悬停的 \`title\` 也是**同一个原值**（实读「${attrOf(el, 'title') ?? ''}」）—— 显示原值而 title 被分组，等于把逗号藏在鼠标底下`,
  );
}
assert.equal(
  rawText(CARD_HTML).includes(LONG_SEED),
  true,
  '★ 探针：原值确实在产物里（否则"没有分组"那一条可以因为整张卡片没渲染出来而成立）',
);
assert.equal(
  rawText(CARD_HTML).includes(GROUPED_SEED),
  false,
  `★★ 产物里**任何位置**都不许出现分组形态的种子（扫的是原文 ${String(rawText(CARD_HTML).length)} 字符，含 \`title\` 与 \`aria-*\`；分组形态＝「${GROUPED_SEED}」）`,
);
assert.deepEqual(
  [...rawText(CARD_HTML).matchAll(/\d{1,3}(?:,\d{3})+/g)].map((m) => m[0]),
  [],
  '★★ 产物里一个"三位一断"形态的数字都不许有（不限于那一个值 —— 别的字段将来被分组时同样红）',
);
ok(
  `种子数字：19 位原样渲染 × ${String(digitEls.length)} 处、\`title\` 也是原值、产物里没有「${GROUPED_SEED}」`,
);

// ---------------------------------------------------------------------------
console.log('⑨ 裸 key 泄漏 + 字面的 `**`（本页产物的原文扫描）');
// ---------------------------------------------------------------------------
/*
 * ⚠️ 裸 key 扫描（含**属性**里的值）：本页唯一的属性文本是 `title`（那颗按钮的全名）
 *    与 `aria-*` —— 属性里的裸 key 只有扫原文才看得见（`textOf` 会把属性整段吃掉）。
 * ⚠️ 扫描器本身必须能命中（否则它是恒真的空跑）。
 * ⚠️ 命名空间清单是**手抄的**，而且必须覆盖本页产物里真会出现的每一族 key：
 *    本页只有 `seedsPage.*` 一族（面板不渲染 `nav.*` / `common.*`），
 *    多写一族只是让它更早发现未来的泄漏，写少了则会让那一族从扫描里漏出去。
 */
const everyProduct = products.join('');
const allRaw = rawText(everyProduct);
const BARE_KEY = /(?:seedsPage|nav|common)\.[A-Za-z][A-Za-z0-9.]*/g;
assert.notEqual(
  [...'seedsPage.doesNotExist nav.nope'.matchAll(BARE_KEY)].length,
  0,
  '★ 探针：裸 key 扫描器本身必须能命中',
);
const leakedKeys = [...new Set([...allRaw.matchAll(BARE_KEY)].map((m) => m[0]))];
assert.deepEqual(
  leakedKeys,
  [],
  `★★ 产物里有裸 key：${leakedKeys.join(', ')}（词条缺一条就是这个样子）`,
);
/*
 * ⚠️ 字面的 `**`：本仓词条里用 `**这样**` 表示强调（`components/Emphasis.tsx`），
 *    只有经过 `em()` / `emText()` 才会消失。落到没处理的地方，用户直接看到一对星号 ——
 *    而词条存在、两种语言对齐、字体覆盖都过，**没有任何别的检查会发现**。
 * ⚠️ 扫描必须作用在**原文**上（`allRaw`），不能用被 `flat()` 处理过的那一份：
 *    本脚本的 `flat()` 就顺手走了一遍 `emText()`（把 `**` 擦掉了）——
 *    拿它去扫等于"用一个把证据擦掉的函数去取证"（`§5.63` 那个事故的形状）。
 * ⚠️ 本页的词条今天一个 `**` 都没有 ⇒ 产物里出现星号**一定是**缺陷。
 */
assert.equal(
  rawText('<p>a**b**c</p>').includes('**'),
  true,
  '★ 探针：`**` 扫描本身必须能命中一个带星号的串',
);
assert.deepEqual(
  [...allRaw.matchAll(/\*\*/g)].map((m) => m[0]),
  [],
  '★★ 产物里有字面的 `**`：带标记的词条必须过 `em()`（节点）或 `emText()`（字符串上下文）',
);
ok(`无裸 key、无字面 **（${String(everyProduct.length)} 字符，${String(products.length)} 份产物）`);

// ---------------------------------------------------------------------------
if (LANG === 'en') {
  console.log('⑩ 断言 8：英文界面里零汉字');
  /*
   * ⚠️ 扫的是**原文**（含属性）：`title` / `aria-*` 里的中文同样是"英文界面上冒出了中文"。
   *    `textOf` 把属性吃掉了，所以不能用它。
   * ⚠️ `fallbackLng: false` 时缺英文词条会**原样返回 key**（由 ⑨ 抓），
   *    这一条抓的是另一类：有人把中文**写死在组件里**。
   */
  const han = [...new Set(allRaw.match(/[\u4e00-\u9fff]+/g) ?? [])];
  assert.deepEqual(han, [], `★★ 英文界面里出现了中文：${han.slice(0, 8).join(' / ')}`);
  assert.notEqual(
    [...'中文'.matchAll(/[\u4e00-\u9fff]+/g)].length,
    0,
    '★ 探针：汉字扫描器本身必须能命中',
  );
  ok('英文界面里零汉字（含属性）');
}

// ---------------------------------------------------------------------------
console.log('⑪ 断言 6：类名 ↔ CSS —— 产物里每一个 `seed*` 类名都要有规则');
// ---------------------------------------------------------------------------
/*
 * ⚠️★ `docs/pending.md §5.70`：本仓样式是全局的、没有 CSS Modules 兜底，而
 *    "渲染了一个 `styles.css` 里没有的类名"**全仓没有任何门禁**发现得了。
 *    这一条把它在**本页之内**关掉。
 * ⚠️ 判据是"整条选择器里有这个类名"，所以边界处必须写死 `(?![A-Za-z0-9_-])`：
 *    `css.includes('.seed__legend')` 会被 `.seed__legenddot` **满足**，
 *    于是一条不存在的规则看起来"有" —— 下面几条探针把这件事钉下来。
 * ⚠️ 另一端也要有边界：**收集**用的是 `classNamesIn`（模式 `CLASS_ATTR`，边界 `(?<![\w-])`）。
 *    写成 `\bclass="` 的话会被 `data-class="…"` 满足 ⇒ 把一个 `data-*` 的值
 *    当成类名去查规则，报一个根本没挂在元素上的类名（**假红**；`data-*` 是合法的属性，
 *    将来很可能有人往组件上加一个）。
 * ⚠️⚠️ **匹配之前必须先把注释整段摘掉**（`stripCssComments`）。这不是洁癖，
 *    是一个**实测出来的假绿**：`styles.css` 里这一页那段规则的**上方注释**把好几个
 *    类名写成了散文（`:4607` 的 `.seed__pickmark`、`:4646` 的 `.seed__pickbtn.is-on`、
 *    `:4696` 与 `:4829` 的 `.seed__rowlabel` …）。于是**把那个类名的规则删掉**之后，
 *    裸正则照样在**注释里**找到它 ⇒ 这一条依然全绿 ——
 *    对这三格（含 `STATE_SELECTORS` 里的一颗钉子）这道门禁**不可能红**，
 *    而它存在的全部理由就是"渲染了类名却没有规则"（`§5.63` 那一族：守卫看起来在守、
 *    实际守不住它声称守的东西）。摘掉注释，它才真的是在查**规则**。
 */
const CSS = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const stripCssComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const hasCssRule = (css: string, cls: string): boolean =>
  new RegExp(`\\.${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_-])`).test(
    stripCssComments(css),
  );

assert.equal(
  hasCssRule('.seed__legend{}', 'seed__legend'),
  true,
  '★ 探针：这个读取器能认出一条规则',
);
assert.equal(
  hasCssRule('.seed__legenddot{}', 'seed__legend'),
  false,
  '★★ 探针：`.seed__legenddot` **不能**满足 `.seed__legend`（前缀关系 —— §5.70 那一类的坑）',
);
assert.equal(
  hasCssRule('/* .seed__probe */', 'seed__probe'),
  false,
  '★★★ 探针：**只在注释里出现过**的类名不算"有规则" —— `styles.css` 的注释里就写着好几个类名（`.seed__pickmark` / `.seed__pickbtn.is-on` / `.seed__rowlabel`），裸正则对它们恒绿，于是把那些规则删掉这道门禁也照样绿',
);
assert.equal(
  hasCssRule('/* 上面那段注释不算 */ .seed__realrule{}', 'seed__realrule'),
  true,
  '★ 探针：摘注释**不能**把真正的规则一起摘掉（否则上一条会以"什么都匹配不上"的方式通过）',
);
assert.equal(
  hasCssRule(CSS, 'seed__nosuchclass'),
  false,
  '★★ 探针：产物里不存在的类名不许在 `styles.css` 里"找到"（否则下面整节是空跑）',
);
assert.equal(
  hasCssRule(CSS, 'seed__pickbtn'),
  true,
  '★ 探针：真实那份 `styles.css` 里确实有 `.seed__pickbtn`（证明文件读对了）',
);

/** ② 里那三个状态类名是**挂在按钮上**的复合选择器，单独钉（见下面为什么）。 */
const STATE_SELECTORS = [
  'seed__pickbtn.is-on',
  'seed__pickbtn.is-with',
  'seed__pickbtn.is-without',
];
for (const sel of STATE_SELECTORS) {
  assert.ok(
    hasCssRule(CSS, sel),
    `★★ \`.${sel}\` 在 styles.css 里没有规则 —— 三态里有一态**没有样式**（而类名照样渲染在按钮上）`,
  );
}

/*
 * ⚠️ 这张清单是**手抄的**（本仓惯例）：它防的是"整块界面被摘掉"——
 *    某一天有人把图例、记号或者变种排删掉了，产物照样"每一个类名都有规则"。
 *    它**不**防"新加了一个类名"（那种情况只需要它在 styles.css 里有规则，
 *    由下面的循环兜着，不必回来改这一行）。
 */
const MUST_RENDER = [
  'seed__picker',
  'seed__row',
  'seed__rowlabel',
  'seed__rowbtns',
  'seed__rowbtns--variations',
  'seed__pickbtn',
  'seed__pickmark',
  'seed__legend',
  'seed__legenditem',
  'seed__legenddot',
  'seed__legenddot--with',
  'seed__legenddot--without',
  'seed__legenddot--none',
] as const;

/*
 * ★★ 收集**必须发生在最后一次渲染之后**（`products` 那时候才是完整的）。
 *    就地在 ⑤ 那一刻收集的话，"只有后面那几份产物里才出现的类名"根本不进清单，
 *    于是类名↔规则这道门禁对它们**是空的** —— 而这道门禁存在的理由正是
 *    "渲染了一个没有规则的类名不会有任何报错"（`rankedrender.tsx` 的 ⑧ 记着同一件事）。
 *    ⇒ 这一节排在全文件**最后**，`ok()` 的落点也跟着挪到最后（组的**数量**没变）。
 */
const allClasses = products.flatMap(classNamesIn);
const seedsClasses = [...new Set(allClasses.filter((cls) => cls.startsWith('seed')))].sort();
assert.ok(
  seedsClasses.length > 0,
  '★★ 探针：产物里确实收集到了 `seed*` 类名（否则下面那个循环一次都不跑）',
);
for (const cls of MUST_RENDER) {
  assert.ok(seedsClasses.includes(cls), `★★ 产物里应当出现 \`.${cls}\`（这一格的界面被摘掉了？）`);
}
for (const cls of seedsClasses) {
  assert.ok(
    hasCssRule(CSS, cls),
    `★★★ \`.${cls}\` 在 \`apps/web/src/styles.css\` 里没有规则 —— 这是一个**渲染得出来、但什么都不生效**的类名（§5.70）`,
  );
}
ok(
  `类名↔CSS：${String(seedsClasses.length)} 个 \`seed*\` 类名 + ${String(STATE_SELECTORS.length)} 条三态选择器逐个有规则（收集自 ${String(products.length)} 份产物）`,
);

console.log('');
console.log(`通过 ${pass} 项。`);
console.log('');
console.log('═══════════════════════════════════════════════════════════════════════');
console.log('覆盖边界（写清楚，免得下一个人高估它）');
console.log('═══════════════════════════════════════════════════════════════════════');
console.log('⚠️ 这是一个**静态渲染**：`renderToStaticMarkup` 不跑 effect、不点击、不发请求。');
console.log('   所以下面这几件事它**证明不了**：');
console.log('   · 页面（`routes/Seeds.tsx`）本身：它取数、它有 useState，纯 SSR 下永远停在');
console.log('     "还没抽过"那一屏 —— 两个标签页、「抽一条」按钮、`resultKey` / `resultStale`');
console.log('     （"这条种子还是不是当前条件的"）、`/random` 与 `/search` 的分支、');
console.log('     整块「按比赛 ID 查」与「社区种子分享」：**一个字都没断言**。（本脚本渲染的是');
console.log('     只吃 props 的纯视图 `SeedPickerPanel`。）');
console.log('   · **点击的结果**：SSR 的产物里没有事件处理器，一颗接好线的按钮与一颗 `onClick`');
console.log('     是 `undefined` 的按钮**长得一模一样** —— 本脚本用的是运行时守卫');
console.log('     （`assertPanelPropsGiven`），而"prop 忘了传"在**页面**那一侧是编译错误。');
console.log('   · ⚠️ 由此而来的一个更细的边界（⑤ 那一组要连这句一起读）：本脚本走的是**状态机**，');
console.log('     验的是"状态机算出来的东西，视图画对了吗"；而**面板自己的 `onClick` 里传了什么**');
console.log(
  '     （尤其 `tapVariation` 的 `siblings` —— 传错的话互斥会静默失效）在 SSR 里**看不见**。',
);
console.log(
  '     那一条只能靠人在真浏览器里点两下：点"村庄 · 沙漠绿"再点"平原绿"，沙漠那颗必须回灰。',
);
console.log('   · **纯逻辑那一半**（三态循环、参数映射、标记按上下文分开存、512 的 clamp、');
console.log('     完赛时间解析）在 `services/api/src/seeds-picker-shared.test.ts`；');
console.log('     本脚本只碰它与界面**中间那一段**（"状态机算出来的东西，视图画对了吗"）。');
console.log('   · **尺寸、配色与字体**：⑪ 只看类名在不在 `styles.css` 里，不看它长什么样。');
/*
 * ⚠️ 组数是**手抄的**（本仓惯例）：它防的是"把某一段摘掉" —— 删掉一整组断言之后
 *    脚本照样绿、照样打印"通过 N 项"，只有这个数字会变。改脚本就要一起改这里。
 *    （终审的修复轮加了一组「种子数字不再三位一断」，所以这两个数各 +1：
 *      zh 10 → 11、en 11 → 12。）
 * ⚠️ en 比 zh 多一组，是因为 ⑩ 那个"英文产物里不许有汉字"的扫描只在 en 那一遍跑
 *    （`if (LANG === 'en')`，见上面）；两个数差 1 是**正常的**，别把它抹平。
 */
const expectedGroups = LANG === 'en' ? 12 : 11;
assert.equal(
  pass,
  expectedGroups,
  `探针：这一轮应当通过 ${String(expectedGroups)} 组（少了就说明有人把某一段摘掉了）`,
);
