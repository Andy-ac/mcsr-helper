#!/usr/bin/env tsx
/**
 * 「追踪的博主」（`/videos` 页上那一块）· 渲染自检。
 *
 * 跑法（从仓库根）：
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:video
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:video -- --en
 *
 * ===========================================================================
 * 为什么这一页需要一份渲染自检（而不是"它就长在 /videos 上、有人会看见"）
 * ===========================================================================
 * 这一整条功能（迁移 / 解析器 / bilibili 适配器 / 数据层 / 五个端点 / CLI + timer）
 * 在服务端有 894 条测试兜着，而**界面这一半此前一条断言都没有** ——
 * 用户能看见的、也是唯一会被他判断"这个功能做没做"的，正好是这一半。
 *
 * ⚠️ 本仓的规矩是"界面住在页面里就断言不到"：`renderToStaticMarkup` **不跑 effect、
 *    不点击、不发请求**，而 `routes/Videos.tsx` 自己取数、自己有四个 `useState` ——
 *    纯 SSR 下它永远停在 loading 那一屏，写在那里的任何一块断言都**不可能红**
 *    （`docs/pending.md §5.63`：不可能红的守卫比没有守卫更坏）。
 * ⇒ 界面住在 `components/TrackedVideos.tsx` 的两个**纯视图**里（只吃 props），
 *   本脚本把它们**每一个状态**都渲染一遍：正常列表 / 四个字段全 null / 空列表 /
 *   取数失败 / 加载中 / 有编辑权限 / 没有编辑权限 / 二次确认 …
 *
 * ===========================================================================
 * ★★ 本文件盯得最紧的三件事（各自对应 spec 里一条硬要求）
 * ===========================================================================
 * ① **秒 vs 毫秒**（spec §4 那个 ★★ 块的裁决）：这两张表整张是 Unix **秒**，
 *    而 `Date` / `Intl` 要毫秒 ⇒ 渲染**必须**经 `toMillis()`。
 *    裸的 `new Date(v.publishedAt)` 少乘 1000，显示出来是 **1970 年**，
 *    而类型检查拦不住它（两边都是 `number`）⇒ 下面第 ③ 组的判据是
 *    "产物里出现 2025、且**一个 1970 都没有**"。
 * ② **缺的值不许变成 0**（本仓既有纪律，spec §4.2 又抄了一遍）：
 *    `publishedAt` / `durationSec` / `viewCount` / `commentCount` 都可能是 null，
 *    而 `0` 看起来像一条真实数据（"这支视频没人看"vs"上游这一轮没回播放量"）。
 *    ⇒ 第 ② 组喂一个四个字段全 null 的夹具，断言四格都是「—」、**整个产物里没有 `0`**。
 * ③ **类名 ↔ CSS**（`docs/pending.md §5.70` / `§5.82`）：本仓样式是全局的、没有
 *    CSS Modules 兜着，而"渲染了一个 `styles.css` 里没有的类名"**全仓没有门禁**
 *    看得见（`ShareForm` 里那个 `.mcsr-input` 笔误活过三轮评审）。
 *    ⇒ 第 ⑪ 组把产物里每一个 `tracked*` 类名收起来逐个查规则，
 *      而且**匹配前先剥掉 CSS 注释** —— 见那一节说明（不剥的话这一条根本不可能红）。
 *
 * ===========================================================================
 * ⚠️★ 本文件**不会被类型检查**（`apps/web/tsconfig.json` 的 include 里没有 `scripts/**`）
 * ===========================================================================
 * 于是一个"少传一格 prop"在这里是**静默**的：SSR 不渲染事件处理器，少一个 `onPage`
 * 与接好线的产物**逐字节相同**（`seedsrender.tsx` 为同一件事写过一段）。
 * ⇒ 本脚本有一道**运行时**守卫（`assertPropsGiven`）+ 它自己的探针（第 0 节）。
 *
 * 不用 JSX（`createElement`）：与其余十个渲染脚本同一条理由 —— `scripts/**` 不在
 * include 里 ⇒ JSX 走 **classic runtime** ⇒ 必须 `import React from 'react'`，
 * 而 biome 的 `noUnusedImports` 会把它判成"未使用"并给一个**不安全自动修复**：
 * 谁点了那个修复，脚本就在运行时崩（`React is not defined`）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { en, zhCN } from '@mcsr/shared/i18n';
import { type TrackedCreator, type TrackedVideo, toMillis } from '@mcsr/shared/tracking';
import i18n from 'i18next';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import {
  localDate,
  localDateTime,
  TrackedCreatorsPanel,
  TrackedVideosSection,
} from '@/components/TrackedVideos';
import { ApiError } from '@/lib/api';
import {
  describeTrackedError,
  TRACKED_ERRORS,
  type TrackedErrorSource,
  trackedErrorSource,
} from '@/lib/trackedErrors';

const LANG = process.argv.includes('--en') ? 'en' : 'zh-CN';

await i18n.use(initReactI18next).init({
  lng: LANG,
  /*
   * ⚠️ `false` 而不是 `'zh-CN'`（与其余十个渲染脚本同一行、同一理由）：
   *    缺 en 词条时**原样返回 key**，于是 ⑨ 的裸 key 扫描能精确指出是哪一个 key。
   *    回退到中文的话，英文界面上冒出来的是中文，只能靠 ⑩ 的汉字扫描间接发现。
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

/** 两种语言（⑧ 那组逐格要**两种都查**，与这一遍跑的是哪种无关）。 */
const LANGUAGES = ['zh-CN', 'en'] as const;

// ---------------------------------------------------------------------------
// 产物读取的小工具（与 `seedsrender.tsx` / `sharerender.tsx` 同形、同一条纪律）
// ---------------------------------------------------------------------------

const decode = (s: string): string =>
  s
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** 原样的 HTML（只还原实体）—— 汉字扫描与"没有 0 / 没有 1970"要连**属性**一起看。 */
const rawText = (html: string): string => decode(html);
/** 一段 HTML 的可见文字（属性里的内容**不算** —— 要算就用 `rawText`）。 */
const textOf = (html: string): string =>
  rawText(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'track', 'wbr']);

/**
 * `class` 属性的读取模式 —— 全文件唯一一份。
 * ⚠️ 边界是 `(?<![\w-])`，**不是** `\b`：`-` 是非单词字符，`\bclass="` 会被
 *    `data-class="…"` 满足，于是那个 `data-*` 的值会被当成**类名**（假红，也可能让
 *    下面的断言作用在错误的片段上）。今天没有组件渲染 `data-*`，这是给将来的边界。
 */
const CLASS_ATTR = /(?<![\w-])class="([^"]*)"/;

/** 一段产物里所有 `class` 属性的值，按空白拆成类名（⑪ 的收集用）。 */
const classNamesIn = (html: string): string[] =>
  [...html.matchAll(new RegExp(CLASS_ATTR.source, 'g'))].flatMap((m) => (m[1] ?? '').split(/\s+/));

/**
 * 取出所有带这个 class 的元素的**外层 HTML**（自带简化的配对扫描）。
 * ⚠️ 不用"非贪婪匹配到最近的 `</tag>`"：`<td class="tracked__actions">` 里还嵌着
 *    `<button>`，那样截出来的是**内层**那一小段 —— 断言就作用在错误的字符串上了。
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

/**
 * 某个属性值（还原实体）。
 * ⚠️ 边界与 `CLASS_ATTR` 同一份理由（`\b` 会被 `-` 满足）：写成 `\b${name}=` 的话，
 *    `attrOf(tag, 'class')` 会被 `data-class="…"` 满足，而它是下面每一条 class
 *    断言的地基。
 */
const attrOf = (tag: string, name: string): string | null => {
  const m = new RegExp(`(?<![\\w-])${name}="([^"]*)"`).exec(tag);
  return m === null ? null : decode(m[1] ?? '');
};

/** 一个元素上有没有这一格 class（**整个词**相等 —— `tracked__row` 不是 `tracked__row--off`）。 */
const hasClassIn = (tag: string, cls: string): boolean =>
  (attrOf(tag, 'class') ?? '').split(/\s+/).includes(cls);

/*
 * ★ 下面几条探针守的是"读取器本身是对的" —— 没有它们的话，后面每一组断言都可能
 *   作用在一个错误的片段上，而**绿的样子完全一样**（`§5.63` 那一族）。
 */
const NESTED_FIXTURE =
  '<div class="tracked__card"><h3 class="tracked__cardtitle">a</h3><span>b</span></div>';
assert.equal(
  elementsWithClass(NESTED_FIXTURE, 'tracked__card').length,
  1,
  '★ 探针：class 要**整个词**相等',
);
assert.equal(
  elementsWithClass('<div class="tracked__cardtitle">z</div>', 'tracked__card').length,
  0,
  '★★ 探针：**前缀相同**的更长的类名不算命中（`tracked__cardtitle` 不是 `tracked__card`）',
);
assert.equal(
  textOf(elementsWithClass(NESTED_FIXTURE, 'tracked__card')[0] ?? ''),
  'a b',
  '★ 探针：取到的是**外层**元素（含里面那两层），不是"开头一小段"',
);
assert.equal(
  elementsWithClass(NESTED_FIXTURE, 'tracked__nosuchclass').length,
  0,
  '★ 探针：不存在的 class 一个都不许匹配（否则"产物里没有 X"恒真）',
);
assert.deepEqual(
  classNamesIn('<i data-class="tracked__decoy" class="tracked__real tracked__tag">x</i>'),
  ['tracked__real', 'tracked__tag'],
  '★★ 探针：类名收集器读的是 `class`，不是 `data-class`（否则 ⑪ 会去找一个不存在的类名的规则）',
);
assert.equal(
  attrOf('<button title="a b" class="ghostbtn">x</button>', 'title'),
  'a b',
  '★ 探针：`attrOf` 能读出一个带空格的属性值',
);

// ---------------------------------------------------------------------------
// 第 0 节：必填 prop 的**运行时**守卫（`scripts/**` 不受类型检查 —— 见文件头）
// ---------------------------------------------------------------------------

/**
 * ★★ 「这些必填 prop 都显式传了」—— 一条**运行时**断言，因为这里没有编译期保护。
 * ⚠️ 少传 `onPage` / `onAdd` 的表现是"那颗按钮的 `onClick` 是 `undefined`"，
 *    而产物与接好线的**完全一样**（SSR 不渲染事件处理器）⇒ 产物级断言永远发现不了。
 * ⚠️ 判据是 `undefined`，**不能**写成 falsy：`loading: false` / `notice: null` /
 *    `fieldErrors: {}` 都是**合法值**，写成 falsy 会让每个正常夹具都红。
 */
function assertPropsGiven(
  props: Record<string, unknown>,
  keys: readonly string[],
  fns: readonly string[],
  where: string,
): void {
  for (const key of keys) {
    assert.notEqual(
      props[key],
      undefined,
      `★★ ${where}：必填 prop \`${key}\` 没有传 —— 本脚本不受类型检查保护，产物里也看不出来`,
    );
  }
  for (const key of fns) {
    assert.equal(
      typeof props[key],
      'function',
      `★★ ${where}：\`${key}\` 必须是函数（传了 undefined 就是一颗按不动的按钮）`,
    );
  }
}

const SECTION_KEYS = [
  'items',
  'total',
  'page',
  'pageSize',
  'empty',
  'loading',
  'error',
  'onPage',
] as const;
const SECTION_FNS = ['onPage'] as const;
const PANEL_KEYS = [
  'canManage',
  'loading',
  'busy',
  'creators',
  'input',
  'fieldErrors',
  'notice',
  'confirmingId',
  'onInput',
  'onAdd',
  'onToggle',
  'onRebackfill',
  'onAskDelete',
  'onDelete',
] as const;
const PANEL_FNS = [
  'onInput',
  'onAdd',
  'onToggle',
  'onRebackfill',
  'onAskDelete',
  'onDelete',
] as const;

/*
 * 探针：守卫本身必须能命中 —— 否则"都传了"是一条永远不红的断言。
 * ⚠️ 探针喂进去的对象必须是**除那一格之外全给齐**的：少给别的格子的话，
 *    守卫会先在别的 key 上失败，那条探针就成了"报错信息里有没有这个词"的巧合。
 */
assert.throws(
  () =>
    assertPropsGiven(
      { ...({ items: [], onPage: noop } as Record<string, unknown>), items: undefined },
      ['items', 'onPage'],
      ['onPage'],
      '探针',
    ),
  /items/,
  '★★ 探针：缺一格 prop 的检查本身必须能命中（否则"都传了"这条是空跑）',
);
assert.throws(
  () => assertPropsGiven({ items: [], onPage: undefined }, ['items', 'onPage'], ['onPage'], '探针'),
  /onPage/,
  '★★ 探针：`onPage` 不是函数时也要能命中（产物里看不出来 —— 见上面那段）',
);
assertPropsGiven({ items: [], onPage: noop }, ['items', 'onPage'], ['onPage'], '探针（正面）');

// ---------------------------------------------------------------------------
// 渲染入口（**每个产物都被记下来**，⑪ 的类名收集要用这一份）
// ---------------------------------------------------------------------------

const products: string[] = [];

const render = (node: ReactElement): string => {
  /*
   * ⚠️ 包 `MemoryRouter` 与其余十个渲染脚本同形：这一块今天**一个 `<Link>` 都不渲染**
   *    （唯一的 `<a>` 是外链，不需要 router），所以包着是空操作。留着它是照既有形状
   *    —— 将来它长出内部链接时，缺 router 是**当场崩**，而那正是我们想要的。
   */
  const html = renderToStaticMarkup(
    createElement(I18nextProvider, { i18n }, createElement(MemoryRouter, null, node)),
  );
  products.push(html);
  return html;
};

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 夹具里的数字是**刻意挑的**：
 *   · `PUBLISHED_SEC` = 2025-10-09（UTC）—— 断言日期时只认"2025"，不看具体格式
 *     （`toLocaleDateString(locale)` 的形状随语言变：`2025/10/9` 对 `10/9/2025`）；
 *   · 每个可空字段给**互不相同**的值：这样"某一格渲染成了别人的值"也能被看出来；
 *   · `VIEWS` / `COMMENTS` / `DURATION_BIG` **一个 0 都不含** —— 第 ② 组那条
 *     "整个产物里没有 `0`"的扫描要扫到它们，含 0 的夹具会让那条断言**永远红**
 *     （而"永远红的断言"会被下一个人删掉）。
 *   · ★ **夹具里的"数据"一律写 ASCII**（标题 / 昵称 / handle / 上游错误原文 / 输入框原文）：
 *     `--en` 那一遍有一条"英文界面里零汉字"的扫描（⑩），而它分不出
 *     "组件里写死的中文"与"上游给的标题正好是中文"。上游的标题当然是**什么语言都有**，
 *     所以夹具里放中文只会让那条守卫对**真正的**缺陷失去判断力
 *     （它要么红在一个正确的夹具上，要么被人加白名单）。
 *     判据因此是：这一遍的产物里只该有**我们写下的**文字 —— 任何中文都来自组件。
 */
const PUBLISHED_SEC = 1_760_000_000; // 2025-10-09T08:53:20Z
const DURATION_SMALL = 111; // ⇒ 1:51
const DURATION_BIG = 3723; // ⇒ 1:02:03
const VIEWS = 12345;
const COMMENTS = 678;
const THUMB = 'https://i0.hdslb.com/bfs/archive/example.jpg';

/** 六个字段都在的一张卡（第 ① 组的主夹具）。 */
const FULL_VIDEO: TrackedVideo = {
  id: 'tv-1',
  creatorId: 'tc-1',
  platform: 'bilibili',
  externalId: 'BV1xx411c7mD',
  title: 'RSG 1.16 world record, full run commentary',

  thumbnailUrl: THUMB,
  publishedAt: PUBLISHED_SEC,
  durationSec: DURATION_SMALL,
  viewCount: VIEWS,
  commentCount: COMMENTS,
  isLiveReplay: false,
  tags: ['short'],
  status: 'visible',
  firstSeenAt: PUBLISHED_SEC,
};

/** 四个可空字段**全为 null**、没有封面、没有标签（第 ②③ 组的主夹具）。 */
const NULL_VIDEO: TrackedVideo = {
  ...FULL_VIDEO,
  id: 'tv-null',
  externalId: 'BV1xx411c7mD',
  thumbnailUrl: null,
  publishedAt: null,
  durationSec: null,
  viewCount: null,
  commentCount: null,
  tags: [],
};

/** 只有播放量是 null（"混合"夹具：证明不是整行都画成 `—`）。 */
const MIXED_VIDEO: TrackedVideo = {
  ...FULL_VIDEO,
  id: 'tv-mixed',
  viewCount: null,
  durationSec: DURATION_BIG,
  tags: ['liveReplay', 'long', 'weirdTagFromTheFuture'],
};

const CREATOR_ON: TrackedCreator = {
  id: 'tc-on',
  platform: 'youtube',
  externalId: 'UC0123456789abcdef',
  handle: '@example',
  displayName: 'Example Creator',
  avatarUrl: null,
  backfillDone: true,
  lastSyncedAt: PUBLISHED_SEC,
  lastError: null,
  consecutiveFailures: 0,
  enabled: true,
  videoCount: 137,
};

/** 停用 + 从没同步过 + 上一轮失败过两次（第 ⑥ 组要把这四件事都画对）。 */
const CREATOR_OFF: TrackedCreator = {
  ...CREATOR_ON,
  id: 'tc-off',
  platform: 'twitch',
  externalId: '12345678',
  handle: '',
  displayName: '',
  backfillDone: false,
  lastSyncedAt: null,
  lastError: 'HTTP 412 from upstream',
  consecutiveFailures: 2,
  enabled: false,
  videoCount: 0,
};

interface SectionProps extends Record<string, unknown> {
  items: TrackedVideo[];
  total: number;
  page: number;
  pageSize: number;
  empty: string;
  loading: boolean;
  error: string | null;
  onPage: (page: number) => void;
}

interface PanelProps extends Record<string, unknown> {
  canManage: boolean;
  loading: boolean;
  busy: boolean;
  creators: TrackedCreator[];
  input: string;
  fieldErrors: Record<string, string>;
  notice: { kind: 'ok' | 'bad' | 'info'; text: string } | null;
  confirmingId: string | null;
  onInput: (next: string) => void;
  onAdd: () => void;
  onToggle: (id: string, enabled: boolean) => void;
  onRebackfill: (id: string) => void;
  onAskDelete: (id: string | null) => void;
  onDelete: (id: string) => void;
}

/** 一份"最小正常"的分区 props —— 每一组只覆盖它关心的那几格。 */
const sectionProps = (over: Partial<SectionProps> = {}): SectionProps => ({
  items: [FULL_VIDEO],
  total: 1,
  page: 1,
  pageSize: 24,
  empty: t('tracked.empty'),
  loading: false,
  error: null,
  onPage: noop,
  ...over,
});

const panelProps = (over: Partial<PanelProps> = {}): PanelProps => ({
  canManage: true,
  loading: false,
  busy: false,
  creators: [CREATOR_ON, CREATOR_OFF],
  input: '',
  fieldErrors: {},
  notice: null,
  confirmingId: null,
  onInput: noop,
  onAdd: noop,
  onToggle: noop,
  onRebackfill: noop,
  onAskDelete: noop,
  onDelete: noop,
  ...over,
});

const renderSection = (over: Partial<SectionProps> = {}, where = '分区'): string => {
  const props = sectionProps(over);
  assertPropsGiven(props, SECTION_KEYS, SECTION_FNS, where);
  return render(createElement(TrackedVideosSection, props));
};

const renderPanel = (over: Partial<PanelProps> = {}, where = '面板'): string => {
  const props = panelProps(over);
  assertPropsGiven(props, PANEL_KEYS, PANEL_FNS, where);
  return render(createElement(TrackedCreatorsPanel, props));
};

/** 一张卡片（分区里恰好一张时用它省掉 `[0]` 下标）。 */
const theCard = (html: string): string => {
  const cards = elementsWithClass(html, 'tracked__card');
  assert.equal(
    cards.length,
    1,
    `★ 探针：这一份产物里应当恰好一张卡片（实测 ${String(cards.length)}）`,
  );
  return cards[0] ?? '';
};

/** 某一格读数的**可见文字**（第 ② 组每条断言都用它）。 */
const cellOf = (html: string, cls: string): string => {
  const els = elementsWithClass(html, cls);
  assert.equal(els.length, 1, `★ 探针：\`.${cls}\` 应当恰好一个（实测 ${String(els.length)}）`);
  return textOf(els[0] ?? '');
};

console.log(`【${LANG}】追踪的博主 · 渲染自检（第 0 节：prop 守卫的探针已通过）`);

// ---------------------------------------------------------------------------
// 两处**先读进来**的东西（它们的断言分别住在 ① 与 ⑪，但操作数在这里准备）
// ---------------------------------------------------------------------------

/*
 * `apps/web/src/styles.css` —— 全文，⑪ 拿它逐类名查规则，① 只读封面那一条需要的一小段。
 * ⚠️ 读**一份**（不是两处各读一次）：两处读的是两份内容时，"类名有规则"与
 *    "封面有 aspect-ratio"就可能在不同的文件快照上成立（而那是假的证据）。
 */
const CSS = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

/** 摘掉 CSS 注释（⑪ 的判据必须建在**规则**上，不能建在注释里的散文上 —— 见那一节）。 */
const stripCssComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * `styles.css` 里有没有点名这个类名的规则。
 * ⚠️ 边界 `(?![A-Za-z0-9_-])` 是判据的一部分（`§5.70`）：`css.includes('.tracked__row')`
 *    会被 `.tracked__row--off` 满足 ⇒ 一条不存在的规则看起来"有"。
 */
const hasCssRule = (css: string, cls: string): boolean =>
  new RegExp(`\\.${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_-])`).test(
    stripCssComments(css),
  );

/*
 * 封面那一条规则（`aspect-ratio` 在不在）—— ① 用它，操作数在这里切出来。
 * ⚠️ 切片的两端是**两个类名**（不是行号）：行号是会漂的锚点（`docs/pending.md §5.23`）。
 */
const CSS_TRACKED_THUMB = CSS.slice(
  CSS.indexOf('.tracked__thumb {'),
  CSS.indexOf('.tracked__thumb--none'),
);
assert.ok(
  CSS_TRACKED_THUMB.length > 0,
  '★ 探针：切出了 `.tracked__thumb` 那一段规则（切不到就是这段注释过期了）',
);

/**
 * 一个假的 `ApiError`（⑧ 用真类型走一遍派发）。
 * ⚠️ 用 `new ApiError(...)` 而**不是**一个形状相同的对象字面量：`trackedErrorSource`
 *    的判据是 `instanceof ApiError` —— 造一个长得像的对象只会验到"字段读得到"，
 *    验不到"分类认得出来"（而后者才是要守的那件事）。
 */
function apiFailure(status: number, code?: string, reason?: string): ApiError {
  return new ApiError(
    'probe',
    status,
    code,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    reason,
  );
}

// ---------------------------------------------------------------------------
console.log('① 卡片六个字段都在（R4）+ 时长格式 + 标签按 §4.3 渲染');
// ---------------------------------------------------------------------------
/*
 * ★ 这一组是后面每一组的**基线**：它把"一张卡上到底有什么"钉死。
 * ⚠️ 封面那条判据是 `img` 上有 `src` 与 `alt`**两样**（只有 src 的图在读屏软件里
 *    什么都不说；只有 alt 的图根本不显示）。
 */
const FULL_HTML = renderSection({}, '六个字段都在');
const fullCard = theCard(FULL_HTML);
const img = elementsWithClass(fullCard, 'tracked__img')[0];
assert.ok(img, '★★ 封面必须是一个 `<img class="tracked__img">`（没有它这张卡就没有图）');
assert.equal(attrOf(img ?? '', 'src'), THUMB, `★★ 封面的 \`src\` 就是上游给的那个地址`);
assert.ok(
  (attrOf(img ?? '', 'alt') ?? '').includes(FULL_VIDEO.title),
  `★★ 封面必须有 \`alt\`，而且它说的是**哪支视频**（实读「${attrOf(img ?? '', 'alt') ?? ''}」）`,
);
assert.equal(
  attrOf(img ?? '', 'loading'),
  'lazy',
  '★★ 封面必须 `loading="lazy"`（一屏几十张图一起请求会把首屏拖慢）',
);
assert.equal(
  hasClassIn(elementsWithClass(fullCard, 'tracked__thumb')[0] ?? '', 'tracked__thumb--none'),
  false,
  '★ 有封面时**不带** `tracked__thumb--none`（那一格是"没有封面"的标记）',
);
assert.ok(
  /aspect-ratio/.test(CSS_TRACKED_THUMB),
  '★★ 封面框的 CSS 里必须有 `aspect-ratio`（比例不固定时图片到达会让整页重排）',
);
assert.equal(
  textOf(elementsWithClass(fullCard, 'tracked__cardtitle')[0] ?? ''),
  FULL_VIDEO.title,
  '★★ 标题（第一个字段）',
);
assert.equal(
  cellOf(fullCard, 'tracked__views'),
  String(VIEWS),
  `★★ 播放量（读到的必须是那个数本身，不是"约 N 万"之类）`,
);
assert.equal(cellOf(fullCard, 'tracked__comments'), String(COMMENTS), '★★ 评论数');
assert.equal(
  cellOf(fullCard, 'tracked__duration'),
  '1:51',
  '★★ `durationSec: 111` ⇒ `1:51`（不足一小时不补小时位）',
);
assert.ok(
  cellOf(fullCard, 'tracked__published').includes('2025'),
  `★★ 发布时间那一格读到了 2025（实读「${cellOf(fullCard, 'tracked__published')}」）`,
);
assert.deepEqual(
  elementsWithClass(fullCard, 'tracked__tag').map((el) => textOf(el)),
  [t('tracked.tagShort')],
  '★ 标签按 §4.3 渲染成词条里的那句话（不是标识原文 `short`）',
);
assert.equal(
  elementsWithClass(fullCard, 'tracked__metalabel').length,
  4,
  '★ 四个读数的名字都在（发布时间 / 时长 / 播放量 / 评论数）',
);

/* 标签：三个都认识 / 空数组不渲染容器 / 认不出来的原样显示（不吞掉）。 */
const TAGS_HTML = renderSection({ items: [MIXED_VIDEO] }, '三个标签 + 一个不认识的');
assert.deepEqual(
  elementsWithClass(theCard(TAGS_HTML), 'tracked__tag').map((el) => textOf(el)),
  [t('tracked.tagLiveReplay'), t('tracked.tagLong'), 'weirdTagFromTheFuture'],
  '★★ 三个标签逐条：两个走词条，**认不出来的按原样显示**（吞掉它等于"界面上少一格"与"数据里没有"分不开）',
);
assert.equal(
  elementsWithClass(theCard(renderSection({ items: [NULL_VIDEO] }, '没有标签')), 'tracked__tags')
    .length,
  0,
  '★★ `tags: []` ⇒ **不渲染**标签容器（一个空的 `<ul>` 会占一行高度，看起来像丢了东西）',
);
assert.equal(
  cellOf(theCard(renderSection({ items: [MIXED_VIDEO] }, '长视频')), 'tracked__duration'),
  '1:02:03',
  '★★ `durationSec: 3723` ⇒ `1:02:03`（**分钟位要补零** —— 去掉补零这条会红）',
);
ok('六个字段：标题 / 封面（src+alt+lazy+16:9）/ 发布时间 / 时长 / 播放量 / 评论数，标签三种都对');

// ---------------------------------------------------------------------------
console.log('② ★★ 缺的值显示「—」，**绝不许显示 0**');
// ---------------------------------------------------------------------------
/*
 * ★★ 这一组是本文件最要紧的一条（spec §4.2 的"拿不到的字段一律 NULL，不许填 0"
 *    + 本仓既有纪律）。
 * ⚠️ 判据分两层，缺一层都可能是空跑：
 *    ① 四格逐格等于 `—`（`viewCount: null` 渲染成 `0` ⇒ 当场红）；
 *    ② **整个产物里没有 `0` 这个字符** —— 这条更强：它把"某一个字段被 `?? 0` 兜住"
 *       这一类错法一网打尽，不限于我想到的那四处。
 * ⚠️ ② 只在这一份产物上扫（所有可空字段全 null、没有分页器、夹具数字里不含 0）——
 *    在别的产物上扫会因为**时长里的补零**（`1:02:03`）假红。
 */
const NULL_HTML = renderSection({ items: [NULL_VIDEO] }, '四个可空字段全 null');
const nullCard = theCard(NULL_HTML);
for (const cls of [
  'tracked__published',
  'tracked__duration',
  'tracked__views',
  'tracked__comments',
] as const) {
  assert.equal(
    cellOf(nullCard, cls),
    '—',
    `★★ \`${cls}\`：拿不到的值显示成「—」（实测「${cellOf(nullCard, cls)}」）—— 显示成 0 是一个看起来像数据的谎`,
  );
}
assert.equal(
  rawText(NULL_HTML).includes('0'),
  false,
  `★★ 四个可空字段全 null 的产物里**一个 \`0\` 都不许有**（扫了 ${String(rawText(NULL_HTML).length)} 字符，含属性）—— \`0\` 看起来像"上游说这支视频没人看"`,
);
assert.equal(
  rawText(NULL_HTML).includes('—'),
  true,
  '★ 探针：这一份产物里确实有破折号（否则上面那条会以"整张卡没渲染出来"的方式通过）',
);
assert.equal(
  elementsWithClass(nullCard, 'tracked__tags').length,
  0,
  '★ 同一次渲染里没有标签容器（这一格的空是可见的）',
);
assert.equal(
  elementsWithClass(nullCard, 'tracked__img').length,
  0,
  '★★ 没有封面 ⇒ **一个 `<img>` 都不渲染**（`src=""` 会让浏览器去请求当前页面）',
);
assert.equal(
  hasClassIn(elementsWithClass(nullCard, 'tracked__thumb')[0] ?? '', 'tracked__thumb--none'),
  true,
  '★ 没有封面时那一格带 `--none`（"没有封面"与"还没加载出来"要分得开）',
);
/* 混合夹具：只有一格是 null ⇒ 证明不是"整行都画成 —"。 */
const MIXED_CELLS = theCard(renderSection({ items: [MIXED_VIDEO] }, '只有播放量是 null'));
assert.equal(cellOf(MIXED_CELLS, 'tracked__views'), '—', '★★ 播放量为 null ⇒ 那一格是「—」');
assert.equal(
  cellOf(MIXED_CELLS, 'tracked__comments'),
  String(COMMENTS),
  '★★ 而**别的格子照常显示自己的值**（否则"某一格是 —"这条会在"整行都是 —"时也成立）',
);
ok('缺的值：四格全 null ⇒ 四个「—」且产物里没有 `0`；混合夹具里只有那一格是「—」');

// ---------------------------------------------------------------------------
console.log('③ ★★ 时间戳只经 `toMillis`（秒 ⇒ 毫秒）：2025 而不是 1970');
// ---------------------------------------------------------------------------
/*
 * ★★ spec §4 那个 ★★ 块的裁决：这两张表整张是 **Unix 秒**，而 `Date` / `Intl`
 *    要毫秒 ⇒ 少乘 1000 就显示成 **1970 年**，而类型检查拦不住（两边都是 number）。
 * ⚠️ 判据三层：
 *    ① 产物里出现 2025（那一格真的渲染了）；
 *    ② **整个产物里没有 `1970`**（把每一处时间戳一起兜住，包括"上次同步"那一格）；
 *    ③ `localDate` / `localDateTime` 直接问一遍 —— `null ⇒ —`、`0 ⇒ 1970`
 *      （0 是一个**合法**的 Unix 时刻，`toMillis` 不许把它当成"没有值"吞掉）。
 */
assert.equal(
  toMillis(PUBLISHED_SEC),
  PUBLISHED_SEC * 1000,
  '★ 探针：`toMillis` 就是乘 1000（这条断的是"我们与 shared 的约定一致"）',
);
assert.ok(
  localDate(PUBLISHED_SEC, LANG).includes('2025'),
  `★★ \`localDate(PUBLISHED_SEC)\` 读到了 2025（实读「${localDate(PUBLISHED_SEC, LANG)}」）—— 读到 1970 就是少乘了 1000`,
);
assert.equal(
  localDate(null, LANG),
  '—',
  '★★ `null` ⇒ 「—」（不是 1970：0 毫秒恰好也是 1970，两者在这一格上长得一样）',
);
assert.ok(
  localDate(0, LANG).includes('1970'),
  '★★ 而**真的 0 秒**必须照常渲染成 1970 —— 写成 `sec || null` 会把一个合法时刻吞掉',
);
assert.ok(
  localDateTime(PUBLISHED_SEC, LANG).includes('2025'),
  '★★ `localDateTime`（"上次同步"用的那一支）同样经 `toMillis`',
);
const NULL_PUBLISHED_HTML = renderSection({ items: [NULL_VIDEO] }, 'publishedAt 为 null');
assert.equal(
  cellOf(theCard(NULL_PUBLISHED_HTML), 'tracked__published'),
  '—',
  '★★ `publishedAt: null` ⇒ 「—」',
);
for (const [where, html] of [
  ['四个字段全 null', NULL_HTML],
  ['六个字段都在', FULL_HTML],
  ['面板（含"上次同步"）', renderPanel({}, '时间·面板')],
] as const) {
  assert.equal(
    rawText(html).includes('1970'),
    false,
    `★★ ${where} 的产物里出现了 \`1970\` —— 这一栏的每一个时间戳都必须经 \`toMillis()\`（spec §4）`,
  );
}
ok('时间戳：2025 而不是 1970；`null` ⇒ 「—」；真的 0 秒 ⇒ 1970（两种错法各有一条断言）');

// ---------------------------------------------------------------------------
console.log('④ 空列表 ⇒ 一句明确的「还没有追踪到视频」，不是空白');
// ---------------------------------------------------------------------------
/*
 * ⚠️ 本仓纪律：空态**不能是空白**（空白看起来像坏了）。判据是"那句话在产物里、
 *    在它自己那一块里、而且这一块里还有第二句说明"。
 * ⚠️ 三条状态（空 / 加载中 / 失败）**必须分得开**：把它们挤成一个"没有内容"的
 *    分支，取数失败就会渲染成"还没有追踪到视频" —— 一句**假话**
 *    （列表不是空的，是没取到）。
 */
const EMPTY_HTML = renderSection({ items: [], total: 0 }, '空列表');
const emptyBox = elementsWithClass(EMPTY_HTML, 'tracked__empty')[0];
assert.ok(emptyBox, '★★ 空列表必须渲染 `.tracked__empty` 那一块（不是什么都不画）');
assert.equal(
  textOf(elementsWithClass(EMPTY_HTML, 'tracked__emptytitle')[0] ?? ''),
  t('tracked.empty'),
  `★★ 空态那一句就是页面传进来的那句话（实读「${textOf(elementsWithClass(EMPTY_HTML, 'tracked__emptytitle')[0] ?? '')}」）`,
);
assert.notEqual(t('tracked.empty'), 'tracked.empty', '★★ 探针：这句话在当前语言里必须有真值');
assert.ok(
  textOf(emptyBox ?? '').includes(t('tracked.emptyHint')),
  `★★ 空态里还要有第二句说明（"抓取每 10 分钟跑一轮"）—— 少了它，访客会以为这一栏坏了`,
);
assert.deepEqual(
  elementsWithClass(EMPTY_HTML, 'pager'),
  [],
  '★ 空列表时不渲染分页器（一个 0 页的分页器比没有更让人困惑）',
);
/*
 * ★ 分页器：**沿用本仓既有那一套**（`.pager` / `.pager__pos`，与视频墙同形）。
 * ⚠️ `aria-label` 是这一栏**自己**那一句（`tracked.pagerLabel`）：这一页上现在有
 *    **两个** `<nav class="pager">`，都叫 "pagination" 时读屏用户听到的是两个同名导航。
 */
const PAGER_HTML = renderSection({ total: 42, page: 2 }, '第二页（有分页器）');
const pager = elementsWithClass(PAGER_HTML, 'pager')[0];
assert.ok(pager, '★★ 总页数 > 1 时必须渲染分页器（否则第二页之后的东西谁也翻不到）');
assert.equal(
  attrOf(pager ?? '', 'aria-label'),
  t('tracked.pagerLabel'),
  '★★ 分页器的 `aria-label` 是这一栏自己那一句（这一页上有两个分页器）',
);
assert.notEqual(
  t('tracked.pagerLabel'),
  'pagination',
  '★★ 而且它与上面那面墙那个**写死的** "pagination" 不是同一个名字',
);
assert.equal(
  textOf(elementsWithClass(PAGER_HTML, 'pager__pos')[0] ?? ''),
  t('videos.page', { page: 2, total: 2 }),
  '★★ 页码那一格 = 「第 2 / 2 页」（复用 `videos.page`，与那面墙同一个说法）',
);
assert.equal(
  elementsWithClass(renderSection({ total: 1, page: 1 }, '一页装得下'), 'pager').length,
  0,
  '★ 只有一页时不渲染分页器（两颗永远灰着的箭头是噪音）',
);
const LOADING_HTML = renderSection({ items: [], total: 0, loading: true }, '加载中');
assert.deepEqual(
  elementsWithClass(LOADING_HTML, 'tracked__empty'),
  [],
  '★★ 加载中**不许**显示空态（那也是一句假话：列表不是空的，是还没到）',
);
const ERROR_HTML = renderSection({ items: [], total: 0, error: 'boom' }, '取数失败');
assert.deepEqual(
  elementsWithClass(ERROR_HTML, 'tracked__empty'),
  [],
  '★★ 取数失败同样**不许**显示空态（这条与上面那条是同一条纪律的两面）',
);
assert.ok(
  textOf(ERROR_HTML).includes('boom'),
  '★ 失败那一句必须渲染出来（它在 `.state--error` 里，是页面翻好的文本）',
);
assert.equal(
  elementsWithClass(ERROR_HTML, 'state--error').length,
  1,
  '★ 失败有它自己那一块样式（与空态、与加载中都不同款）',
);
ok('空态是一句话（含第二句说明），与"加载中"、"取数失败"三态分开');

// ---------------------------------------------------------------------------
console.log('⑤ ★ 管理面板：没有 `live.manage` 时**整块不渲染**（两个 props 对照）');
// ---------------------------------------------------------------------------
/*
 * ★ 判据在**页面**那一层算（`useCan('live.manage')`），组件只决定显不显示 ——
 *   与 `VideoCard.canAuthor` 同一条。这一组是那一句话的**唯一**证据：
 *   两个 props 只差 `canManage`，产物一边有整块、一边**一个字都没有**。
 * ⚠️ 反向那一半（`canManage: true` 时有）**不能省**：只断言"false 时没有"的话，
 *    一个"永远不渲染"的实现照样绿。
 */
const NO_MANAGE_HTML = renderPanel({ canManage: false }, '没有 live.manage');
const WITH_MANAGE_HTML = renderPanel({}, '有 live.manage（对照）');
assert.equal(NO_MANAGE_HTML, '', '★★ 没有 `live.manage` ⇒ 整块产物是空串（不是"渲染了但看不见"）');
assert.equal(
  rawText(NO_MANAGE_HTML).includes(t('tracked.manageTitle')),
  false,
  '★★ 连标题都不许出现',
);
for (const cls of ['tracked__manage', 'tracked__add', 'tracked__table'] as const) {
  assert.deepEqual(
    elementsWithClass(NO_MANAGE_HTML, cls),
    [],
    `★★ 没有 \`live.manage\` 时 \`.${cls}\` 一个都不许有`,
  );
}
assert.ok(
  elementsWithClass(WITH_MANAGE_HTML, 'tracked__manage').length === 1,
  '★★ 正面对照：有 `live.manage` 时整块**在**（否则上面那条是在验一个永远不渲染的组件）',
);
assert.equal(
  elementsWithClass(WITH_MANAGE_HTML, 'tracked__table').length,
  1,
  '★ 正面对照：名单表格也在',
);
ok('管理面板：`canManage:false` ⇒ 空串；`true` ⇒ 整块在（两个 props 只差这一格）');

// ---------------------------------------------------------------------------
console.log('⑥ 面板内容：七列表头 + 一行博主的六个读数 + "上次同步"经 `toMillis`');
// ---------------------------------------------------------------------------
/*
 * ★ spec §6.2 第二段点名的六列（平台 / 名字 / 状态 / 上次同步 / 上次错误 / 条数）
 *   + 动作列。表头那一行是**手抄的**：它防的是"某一列被删掉了而界面照样正常"。
 * ⚠️ `CREATOR_OFF` 那一行同时带着四件事：停用 / 从没同步过（`—`）/ 上一轮错了 /
 *    连续失败两次 —— 四件都是 spec §6.3 要的"能看见"。
 */
const tableCount = elementsWithClass(WITH_MANAGE_HTML, 'admintable').length;
assert.equal(tableCount, 1, '★ 名单用的就是全站那一张表格形状（`.admintable`）');
const headers = [...WITH_MANAGE_HTML.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) =>
  textOf(m[1] ?? ''),
);
assert.deepEqual(
  headers,
  [
    t('tracked.colPlatform'),
    t('tracked.colName'),
    t('tracked.colState'),
    t('tracked.colSynced'),
    t('tracked.colError'),
    t('tracked.colVideos'),
    t('tracked.colActions'),
  ],
  '★★ 七列表头与顺序（平台 / 名字 / 状态 / 上次同步 / 上次错误 / 条数 / 操作）',
);
for (const h of headers) {
  assert.equal(
    /^tracked\./.test(h),
    false,
    `★★ 表头必须是**词条的值**，不是裸 key（读到「${h}」）`,
  );
}
const rows = elementsWithClass(WITH_MANAGE_HTML, 'tracked__row');
assert.equal(rows.length, 2, `★ 两个博主两行（实测 ${String(rows.length)} 行）`);
assert.equal(
  hasClassIn(rows[0] ?? '', 'tracked__row--off'),
  false,
  '★ 启用的那一行**不带** `tracked__row--off`',
);
assert.equal(
  hasClassIn(rows[1] ?? '', 'tracked__row--off'),
  true,
  '★★ 停用的那一行带 `tracked__row--off`（不标出来的话"他的视频为什么不更新了"要读到最右边那一列）',
);
assert.ok(
  textOf(rows[0] ?? '').includes(CREATOR_ON.displayName),
  '★ 显示名（`displayName`）那一格',
);
assert.ok(textOf(rows[0] ?? '').includes(CREATOR_ON.handle), '★ 可读标识（`handle`）那一格');
assert.ok(
  textOf(rows[1] ?? '').includes('—'),
  '★★ 显示名为空的博主显示「—」而不是一个空白格（空白看起来像界面坏了）',
);
assert.ok(
  textOf(rows[1] ?? '').includes(CREATOR_OFF.lastError ?? ''),
  '★★ 「上次错误」那一格是上游给的**原文**（spec §6.3 的可观测性）',
);
assert.ok(
  textOf(rows[1] ?? '').includes(t('tracked.failStreak', { count: 2 })),
  '★★ 连续失败次数看得见（"要不要放弃这个频道"的判据）',
);
assert.equal(
  textOf(elementsWithClass(rows[0] ?? '', 'tracked__total')[0] ?? ''),
  String(CREATOR_ON.videoCount),
  '★ 「条数」那一格是他名下已存的条数',
);
assert.ok(
  textOf(elementsWithClass(rows[0] ?? '', 'tracked__synced')[0] ?? '').includes('2025'),
  '★★ 「上次同步」经 `toMillis`（它也是**秒**的一个时间戳）',
);
assert.equal(
  textOf(elementsWithClass(rows[1] ?? '', 'tracked__synced')[0] ?? ''),
  '—',
  '★★ 从没同步过（`lastSyncedAt: null`）⇒ 「—」，**不是** 1970（`new Date(null)` 恰好也是 1970）',
);
/* 名单为空 / 正在取数：两句话**不同**，而且都不许画成"表格里一行都没有"。 */
const EMPTY_LIST_HTML = renderPanel({ creators: [] }, '名单是空的');
assert.deepEqual(
  elementsWithClass(EMPTY_LIST_HTML, 'tracked__empty').map((el) => textOf(el)),
  [t('tracked.manageEmpty')],
  '★★ 空名单是一句话（"在上面贴一个博主的链接"），不是一张空表',
);
assert.deepEqual(
  elementsWithClass(EMPTY_LIST_HTML, 'tracked__table'),
  [],
  '★★ 空名单不渲染表格（一张只有表头的表看起来像加载失败）',
);
const PANEL_LOADING_HTML = renderPanel({ creators: [], loading: true }, '面板正在取数');
assert.deepEqual(
  elementsWithClass(PANEL_LOADING_HTML, 'tracked__empty'),
  [],
  '★★ 加载中**不许**显示"名单是空的"（那是一句假话：还没到，不是没有）',
);
assert.equal(
  elementsWithClass(PANEL_LOADING_HTML, 'state').length,
  1,
  '★ 加载中有它自己那一句话（`common.loading`）',
);
ok('面板内容：七列表头 + 两行（启用 / 停用）的六个读数都与夹具对得上');

// ---------------------------------------------------------------------------
console.log('⑦ 面板的四个动作面：受控输入框 / 字段级红字 / 顶部的 notice / 二次确认');
// ---------------------------------------------------------------------------
/*
 * ⚠️ SSR **不渲染事件处理器**：这一组证明不了"点了会怎么样"，它证明的是
 *    **"页面把状态交进来之后，界面画对了吗"**（点击那一半的边界写在文件末尾）。
 * ⚠️ 输入框是**受控**的（`value` + `onChange`）：这一条断言的是"页面手里的原文
 *    真的印在框里" —— 一个不受控的输入框（只给 name）在产物里**一模一样**，
 *    而它意味着"失败之后用户贴的那条链接没了"。
 */
const INPUT_HTML = renderPanel({ input: 'space.bilibili.com/703007996' }, '输入框里有原文');
const inputEl = elementsWithClass(INPUT_HTML, 'mcsr-field__input')[0];
assert.ok(inputEl, '★ 加博主那一栏有一个输入框');
assert.equal(
  attrOf(inputEl ?? '', 'value'),
  'space.bilibili.com/703007996',
  '★★ 输入框是**受控**的：页面手里的原文必须印在框里（失败之后它不能被清掉）',
);
assert.equal(
  attrOf(inputEl ?? '', 'id'),
  'tracked-add',
  '★ 输入框的 id 与 `<label for>` 对得上（点标签要能聚焦到框里）',
);
assert.ok(
  INPUT_HTML.includes('for="tracked-add"'),
  '★★ 标签是**真 `<label>`**（不是 placeholder：placeholder 一输入就没了，读屏也常不读它）',
);
const ERR_FIELD_HTML = renderPanel({ fieldErrors: { input: 'ERR_TEXT' } }, '字段级红字');
assert.deepEqual(
  elementsWithClass(ERR_FIELD_HTML, 'fielderr').map((el) => textOf(el)),
  ['ERR_TEXT'],
  '★★ 字段级红字渲染在输入框下面那一格（页面已经翻好的文本）',
);
assert.deepEqual(
  elementsWithClass(WITH_MANAGE_HTML, 'fielderr'),
  [],
  '★★ 正面对照：没有红字时一块都不渲染',
);
const NOTICE_BAD = renderPanel({ notice: { kind: 'bad', text: 'BOOM_TEXT' } }, '顶部的失败提示');
assert.deepEqual(
  elementsWithClass(NOTICE_BAD, 'notice--bad').map((el) => textOf(el)),
  ['BOOM_TEXT'],
  '★★ 顶部的失败提示是**红**的那一档（`Notice kind="bad"` ⇒ 读屏立刻打断）',
);
const NOTICE_OK = renderPanel({ notice: { kind: 'ok', text: 'OK_TEXT' } }, '顶部的成功提示');
assert.deepEqual(
  elementsWithClass(NOTICE_OK, 'notice--ok').map((el) => textOf(el)),
  ['OK_TEXT'],
  '★★ 成功那一句是**绿**的那一档 —— 重新回填改的是库里的 `backfill_done`，表格里没有这一列，',
);
assert.deepEqual(
  elementsWithClass(WITH_MANAGE_HTML, 'notice'),
  [],
  '★★ 正面对照：没有提示时一条都不渲染',
);
/* 二次确认：命中那一行有"确定/取消"，别的行仍然只有一颗「删除」。 */
const CONFIRM_HTML = renderPanel({ confirmingId: CREATOR_OFF.id }, '在等二次确认');
const confirmRows = elementsWithClass(CONFIRM_HTML, 'tracked__row');
assert.ok(
  textOf(confirmRows[1] ?? '').includes(t('tracked.confirmDelete')),
  '★★ 被确认的那一行里要有那句"视频也一起没"（外键级联不可逆，spec §4.2）',
);
assert.equal(
  elementsWithClass(confirmRows[1] ?? '', 'tracked__confirm').length,
  1,
  '★ 那一行只有一个确认块',
);
assert.equal(
  elementsWithClass(confirmRows[0] ?? '', 'tracked__confirm').length,
  0,
  '★★ **别的行**不许进入确认态（否则"删除"变成一键真删）',
);
assert.equal(
  textOf(CONFIRM_HTML).includes(t('common.cancel')),
  true,
  '★ 确认态里有"取消"（进了这一步必须能退出来）',
);
ok('四个动作面：受控输入框 + 真 label + 字段红字 + 红/绿两种 notice + 只有那一行进确认态');

// ---------------------------------------------------------------------------
console.log('⑧ ★★ 失败文案：八格逐格 × 两种语言，并用真 `ApiError` 走一遍派发');
// ---------------------------------------------------------------------------
/*
 * ★★ 这一组守的是**手交过来的两件事**（T5 的账）：
 *    · `platform_not_configured`（503）—— "这个平台在我们这边没配凭据"（**我们**的事，
 *      不是编辑贴错了链接）。落进通用兜底他会一遍遍重贴那条**本来就没问题**的链接；
 *    · `reason: 'creator_not_found'`（400）—— "这条链接指向的人不存在"（改链接）。
 *      落进兜底他会一遍遍重试一件永远不会成功的事。
 * ⚠️ 这两句话住在 `TRACKED_ERRORS` **表**里（经 `describeTrackedError` 派发），
 *    而不是字面量 `t('…')` 调用点 ⇒ `services/api/src/i18n-keys.test.ts` 的
 *    字面量扫描**看不见它们**。存在性只能在这里逐格守（两种语言都查）——
 *    两份字典**同时**少掉同一条时，全仓的语言对齐测试也是隐形的（两边都没有 ⇒ 对齐）。
 */
const API_FAILURES: ReadonlyArray<{
  source: TrackedErrorSource;
  error: unknown;
  why: string;
}> = [
  {
    source: 'platform_not_configured',
    error: apiFailure(503, 'platform_not_configured'),
    why: '我们没配这个平台的凭据（503）',
  },
  {
    source: 'creator_not_found',
    error: apiFailure(400, 'invalid_input', 'creator_not_found'),
    why: '上游说没有这个人（400 + reason）',
  },
  {
    source: 'unresolvable_input',
    error: apiFailure(400, 'invalid_input', 'unresolvable_input'),
    why: '连这是哪个平台都判不出来（400 + reason）',
  },
  {
    source: 'duplicate',
    error: apiFailure(400, 'invalid_input', 'duplicate'),
    why: '已经在名单上了（400 + reason）',
  },
  { source: 'rate_limited', error: apiFailure(429, 'rate_limited'), why: '上游在限流（429）' },
  {
    source: 'upstream_bad',
    error: apiFailure(502, 'upstream_bad_response'),
    why: '上游那边没谈成（502）',
  },
  { source: 'forbidden', error: apiFailure(403, 'forbidden'), why: '能力没了（403）' },
  { source: 'not_found', error: apiFailure(404, 'not_found'), why: '那一行不在了（404）' },
];
assert.equal(
  API_FAILURES.length,
  Object.keys(TRACKED_ERRORS).length,
  `★★ 八类失败与表里的格子**一一对应**（表 ${String(Object.keys(TRACKED_ERRORS).length)} 格，夹具 ${String(API_FAILURES.length)} 个）—— 少了哪一格，那一格就永远不会被验到`,
);
const FALLBACK_TEXT = 'FALLBACK_TEXT';
const fallback = (): string => FALLBACK_TEXT;
for (const row of API_FAILURES) {
  assert.equal(
    trackedErrorSource(row.error),
    row.source,
    `★★ 派发：${row.why} 必须认成 \`${row.source}\``,
  );
  for (const lng of LANGUAGES) {
    const key = TRACKED_ERRORS[row.source].key;
    assert.ok(
      i18n.exists(key, { lng }),
      `★★ 词条 ${key} 在【${lng}】里**不存在** —— 界面上会直接印出这个 key`,
    );
    const value = i18n.t(key, { lng }) as string;
    assert.notEqual(value, key, `★★ 词条 ${key} 在【${lng}】里没有真值（i18next 原样返回了 key）`);
    assert.notEqual(value.trim(), '', `★★ 词条 ${key} 在【${lng}】里是空的`);
  }
  const described = describeTrackedError(row.error, t, fallback);
  const expectedText = t(TRACKED_ERRORS[row.source].key);
  if (TRACKED_ERRORS[row.source].place === 'input') {
    assert.equal(
      described.input,
      expectedText,
      `★★ ${row.source} 那一句要挂在**输入框下面**（它说的是"你要改的是这条链接"）`,
    );
    assert.equal(described.message, null, `★ ${row.source} 不许同时占用顶部那一格`);
  } else {
    assert.equal(
      described.message,
      expectedText,
      `★★ ${row.source} 那一句要挂在**面板顶部**（它说的不是某个输入框的事）`,
    );
    assert.equal(described.input, null, `★ ${row.source} 不许同时占用输入框下面那一格`);
  }
}
/*
 * ⚠️★ `rate_limited` 那一句**不许出现数字**：全站那句（`auth.rateLimited`）说的是
 *    "请等 60 秒后再试"，而那个 60 来自 `Retry-After` —— **这个端点刻意不发那个头**
 *    （bilibili 的风控是概率性的，spec §2.3）。编一个数字 = 承诺一件做不到的事。
 */
const RATE_TEXT = t('tracked.errRateLimited');
assert.equal(
  /\d/.test(RATE_TEXT),
  false,
  `★★ \`rate_limited\` 那句话里**一个数字都不许有**（现读「${RATE_TEXT}」）—— 我们不知道风控什么时候松`,
);
assert.notEqual(
  RATE_TEXT,
  t('auth.rateLimited', { seconds: 60 }),
  '★★ 而且它必须与全站那句（"请等 60 秒后再试"）**不是同一句话**',
);
/* 认不出来的失败：**不编一句话**，走调用方的兜底（连不上我们的服务器那一档只有它说得对）。 */
for (const [where, error] of [
  ['我们自己的 500', apiFailure(500, 'internal_error')],
  ['连不上 API（status 0）', new ApiError('连不上 API', 0)],
  ['根本不是 ApiError', new Error('boom')],
] as const) {
  assert.equal(trackedErrorSource(error), null, `★ 认不出来 ⇒ \`null\`（${where}）`);
  const described = describeTrackedError(error, t, fallback);
  assert.equal(described.message, FALLBACK_TEXT, `★★ ${where} 必须走兜底那一句，不许自己编`);
  assert.equal(described.input, null, `★ ${where} 不许挂到输入框下面`);
}
ok(
  `失败文案：${String(API_FAILURES.length)} 格 × ${String(LANGUAGES.length)} 种语言逐条有真值，派发与挂的位置都对；rate_limited 不含数字`,
);

// ---------------------------------------------------------------------------
console.log('⑨ 裸 key 泄漏 + 字面的 `**`（本页产物的原文扫描）');
// ---------------------------------------------------------------------------
/*
 * ⚠️ 扫描**必须作用在原文上**（含属性）：`title=` / `alt=` / `aria-label=` 里的裸 key
 *    只有扫原文才看得见（`textOf` 会把属性整段吃掉）。
 * ⚠️ 命名空间清单是**手抄的**，而且必须覆盖本页产物里真会出现的每一族 key：
 *    这一块渲染 `tracked.*`（自己的）、`videos.*`（平台名、去原站看、分页三句）、
 *    `common.*`（加载中 / 确定 / 取消）。少写一族 = 那一族从扫描里漏出去。
 * ⚠️ 字面的 `**`：本仓词条里用 `**这样**` 表示强调（`components/Emphasis.tsx`），
 *    只有经过 `em()` / `emText()` 才会消失。这一节的词条**刻意不带标记**
 *    （理由写在 `zh-CN.ts` 那一节的文件头：`tracked.err*` 是经表派发的，
 *    带标记就得进 `i18n-keys.test.ts` 的 `DYNAMIC_KEYS` 白名单）⇒
 *    产物里出现星号**一定是**缺陷（有人加了一条带标记的词条却没接 `em()`）。
 */
const everyProduct = products.join('');
const allRaw = rawText(everyProduct);
const BARE_KEY = /(?:tracked|videos|common|nav)\.[A-Za-z][A-Za-z0-9.]*/g;
assert.notEqual(
  [...'tracked.doesNotExist nav.nope'.matchAll(BARE_KEY)].length,
  0,
  '★ 探针：裸 key 扫描器本身必须能命中',
);
const leakedKeys = [...new Set([...allRaw.matchAll(BARE_KEY)].map((m) => m[0]))];
assert.deepEqual(
  leakedKeys,
  [],
  `★★ 产物里有裸 key：${leakedKeys.join(', ')}（词条缺一条就是这个样子）`,
);
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
  console.log('⑩ 英文界面里零汉字');
  /*
   * ⚠️ 扫的是**原文**（含属性）：`alt=` / `title=` / `value=` 里的中文同样是
   *    "英文界面上冒出了中文"。`textOf` 把属性吃掉了，所以不能用它。
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
console.log('⑪ ★★ 类名 ↔ CSS —— 产物里每一个 `tracked*` 类名都要有规则（**先剥注释**）');
// ---------------------------------------------------------------------------
/*
 * ⚠️★ `docs/pending.md §5.70`：本仓样式是全局的、没有 CSS Modules 兜底，而
 *    "渲染了一个 `styles.css` 里根本没有的类名"**全仓没有任何门禁**发现得了
 *    （`ShareForm` 里那个 `.mcsr-input` 笔误活过两轮评审）。这一条把它在**本页之内**关掉。
 *
 * ⚠️⚠️ **匹配之前必须先把注释整段摘掉**（`stripCssComments`）。这不是洁癖，
 *    是一个**实测出来的假绿**（`§5.82`）：`seedsrender.tsx` 那条守卫里，
 *    `styles.css` 在规则的**上方注释**里把类名写成了散文，于是**把那个类名的真规则删掉**
 *    之后裸正则照样在注释里找到它 ⇒ 那条守卫**不可能红**，而它存在的全部理由
 *    就是"渲染了类名却没有规则"（`§5.63` 那一族：守卫看起来在守、
 *    实际守不住它声称守的东西）。
 *    ⚠️ 这一块自己的注释里也写满了 `tracked__*`（每一格都在解释自己），
 *       所以对**这一页**来说，不剥注释的那一版是**必然假绿**的。
 * ⚠️ 判据必须"整个类名相等"：`css.includes('.tracked__row')` 会被
 *    `.tracked__row--off` **满足**（前缀 + `-`），于是一条不存在的规则看起来"有"。
 *    边界写死 `(?![A-Za-z0-9_-])`，并配探针把这个坑钉下来。
 * ⚠️ `CSS` / `stripCssComments` / `hasCssRule` 三个都在**上面**（① 也要读同一份
 *    `styles.css`），这里只放断言 —— 两处各读一次的话，两个结论会建在**不同的
 *    文件快照**上，而那是假的证据。
 */
assert.equal(
  hasCssRule('.tracked__title{}', 'tracked__title'),
  true,
  '★ 探针：这个读取器能认出一条规则',
);
assert.equal(
  hasCssRule('.tracked__titlesomething{}', 'tracked__title'),
  false,
  '★★ 探针：`.tracked__titlesomething` **不能**满足 `.tracked__title`（前缀关系）',
);
assert.equal(
  hasCssRule('.tracked__row--off{}', 'tracked__row'),
  false,
  '★★ 探针：`--off` 是一个**不同的类名**（`-` 不是边界符，所以要写进否定前瞻里）',
);
assert.equal(
  hasCssRule('/* .tracked__probe */', 'tracked__probe'),
  false,
  '★★★ 探针：**只在注释里出现过**的类名不算"有规则" —— 这一块的注释里写满了类名，裸正则对它们恒绿',
);
assert.equal(
  hasCssRule('/* 上面那段注释不算 */ .tracked__realrule{}', 'tracked__realrule'),
  true,
  '★ 探针：摘注释**不能**把真正的规则一起摘掉（否则上一条会以"什么都匹配不上"的方式通过）',
);
assert.equal(
  hasCssRule(CSS, 'tracked__nosuchclass'),
  false,
  '★★ 探针：不存在的类名不许在 `styles.css` 里"找到"（否则下面整节是空跑）',
);
assert.equal(
  hasCssRule(CSS, 'tracked__title'),
  true,
  '★ 探针：真实那份 `styles.css` 里有 `.tracked__title`（证明文件读对了）',
);

/*
 * ⚠️ 这张清单是**手抄的**（本仓惯例）：它防的是"整块界面被摘掉"——
 *    某一天有人把空态、封面或者面板的某一列删掉了，产物照样"每一个类名都有规则"。
 *    它**不**防"新加了一个类名"（那种情况只需要它在 styles.css 里有规则，
 *    由下面的循环兜着，不必回来改这一行）。
 */
const MUST_RENDER = [
  'tracked',
  'tracked__title',
  'tracked__sub',
  'tracked__empty',
  'tracked__emptytitle',
  'tracked__emptyhint',
  'tracked__grid',
  'tracked__card',
  'tracked__thumb',
  'tracked__thumb--none',
  'tracked__img',
  'tracked__body',
  'tracked__head',
  'tracked__tags',
  'tracked__tag',
  'tracked__cardtitle',
  'tracked__meta',
  'tracked__metalabel',
  'tracked__published',
  'tracked__duration',
  'tracked__views',
  'tracked__comments',
  'tracked__out',
  'tracked__manage',
  'tracked__add',
  'tracked__addrow',
  'tracked__addbtn',
  'tracked__tablescroll',
  'tracked__table',
  'tracked__row',
  'tracked__row--off',
  'tracked__name',
  'tracked__displayname',
  'tracked__handle',
  'tracked__state',
  'tracked__synced',
  'tracked__err',
  'tracked__streak',
  'tracked__total',
  'tracked__actions',
  'tracked__confirm',
] as const;

/*
 * ★★ 收集**必须发生在最后一次渲染之后**（`products` 那时候才是完整的）。
 *    就地在中间某一组收集的话，"只有后面那几份产物里才出现的类名"根本不进清单，
 *    于是类名↔规则这道门禁对它们**是空的**（`rankedrender.tsx` 的 ⑧ 记着同一件事）。
 *    ⇒ 这一节排在全文件**最后**（`--en` 那一组在它前面，所以它才是最后一组）。
 */
const trackedClasses = [
  ...new Set(products.flatMap(classNamesIn).filter((cls) => cls.startsWith('tracked'))),
].sort();
assert.ok(
  trackedClasses.length > 0,
  '★★ 探针：产物里确实收集到了 `tracked*` 类名（否则下面那个循环一次都不跑）',
);
for (const cls of MUST_RENDER) {
  assert.ok(
    trackedClasses.includes(cls),
    `★★ 产物里应当出现 \`.${cls}\`（这一格的界面被摘掉了？）`,
  );
}
for (const cls of trackedClasses) {
  assert.ok(
    hasCssRule(CSS, cls),
    `★★★ \`.${cls}\` 在 \`apps/web/src/styles.css\` 里没有规则 —— 这是一个**渲染得出来、但什么都不生效**的类名（§5.70）`,
  );
}
ok(
  `类名↔CSS：${String(trackedClasses.length)} 个 \`tracked*\` 类名逐个有规则（收集自 ${String(products.length)} 份产物，匹配前已剥注释）`,
);

console.log('');
console.log(`通过 ${pass} 项。`);
console.log('');
console.log('═══════════════════════════════════════════════════════════════════════');
console.log('覆盖边界（写清楚，免得下一个人高估它）');
console.log('═══════════════════════════════════════════════════════════════════════');
console.log('⚠️ 这是一个**静态渲染**：`renderToStaticMarkup` 不跑 effect、不点击、不发请求。');
console.log('   所以下面这几件事它**证明不了**：');
console.log('   · 页面（`routes/Videos.tsx`）本身：它取数、它有 7 个 useState —— 纯 SSR 下');
console.log('     永远停在 loading 那一屏。⇒ 分页（`?tpage=`）、四个动作的接线、');
console.log('     `useCan` 的取值、删博主之后**两个刷新键都要动**：**一个字都没断言**。');
console.log('   · **点击的结果**：SSR 的产物里没有事件处理器，一颗接好线的按钮与一颗');
console.log('     `onClick` 是 `undefined` 的按钮**长得一模一样** —— 这一层用的是运行时守卫');
console.log('     （`assertPropsGiven`），而"prop 忘了传"在**页面**那一侧是编译错误。');
console.log('   · **尺寸、配色与字体**：⑪ 只看类名在不在 `styles.css` 里，不看它长什么样。');
console.log('   · **服务端那一半**：五个端点的行为、抓取、标签推导、隐藏过滤全在');
console.log('     `services/api/src/tracking-*.test.ts`；本脚本只碰"props → 产物"这一段。');
console.log('   · ⚠️ 公开列表带 60 秒公共缓存（+5 分钟 stale 窗口）⇒ 直接改库隐藏一条视频之后，');
console.log('     最多 6 分钟内它仍可能从某个缓存里被端出来。这一栏**没有**隐藏按钮，');
console.log('     所以界面上没有任何位置需要说这句话 —— 记在这里，不写进文案。');

/*
 * ⚠️ 组数是**手抄的**（本仓惯例）：它防的是"把某一段摘掉" —— 删掉一整组断言之后
 *    脚本照样绿、照样打印"通过 N 项"，只有这个数字会变。改脚本就要一起改这里。
 * ⚠️ en 比 zh 多一组，是因为 ⑩ 那个"英文产物里不许有汉字"的扫描只在 en 那一遍跑
 *    （`if (LANG === 'en')`）；两个数差 1 是**正常的**，别把它抹平。
 */
const expectedGroups = LANG === 'en' ? 11 : 10;
assert.equal(
  pass,
  expectedGroups,
  `探针：这一轮应当通过 ${String(expectedGroups)} 组（少了就说明有人把某一段摘掉了）`,
);
