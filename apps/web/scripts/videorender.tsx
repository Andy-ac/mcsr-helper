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
 *    ⇒ 第 ⑪ 组把产物里每一个 `tracked*` / `video-embed*` 类名收起来逐个查规则，
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
import {
  type TrackedCreator,
  type TrackedVideo,
  type TrackPlatform,
  toMillis,
} from '@mcsr/shared/tracking';
import i18n from 'i18next';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { ClickToPlayEmbed } from '@/components/ClickToPlayEmbed';
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
import {
  nextParamsForTrackedPlatform,
  readTrackedPlatform,
  TRACKED_PAGE_PARAM,
  TRACKED_PLATFORM_PARAM,
} from '@/lib/trackedQuery';

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

/*
 * ⚠️★ 列表那一栏的两个"分区"prop（T7 起）：
 *   · `platform` **不在** `SECTION_KEYS` 里，而且**不能**加进去：`undefined` 是它的
 *     **合法值**（= 「全部」），而上面那道守卫判的正是 `undefined`
 *     ⇒ 加进去的话每一个"全部"夹具都会红在一句**假话**上（"prop 没有传"）。
 *     ⇒ 它的守卫只能是**行为**上的：⑬ 用两个 props 对照（`undefined` ⇒ 「全部」选中 /
 *       `'twitch'` ⇒ Twitch 选中）。传丢了的表现就是那条断言红 —— 而它在产物里看得见。
 *   · `onPlatformChange` 是函数，照旧进 `SECTION_FNS`：漏了它 = 四个按不动的按钮，
 *     而 SSR 的产物与接好线的**逐字节相同**（`onPage` 是同一条）。
 */
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
const SECTION_FNS = ['onPage', 'onPlatformChange'] as const;
const PANEL_KEYS = [
  'canManage',
  'loading',
  'busy',
  'creators',
  'loadError',
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

/*
 * 三条视频的**平台侧 id**（三个平台各一个形状：BV 号 / YouTube videoId / Twitch 数字 id）。
 * ⚠️ 三条都**不含字符 `0`**：第 ② 组那条"整个产物里一个 `0` 都不许有"的扫描会连
 *    **属性**一起扫（含 `data-embed-src`），而这些 id 正好会进那张卡的嵌入地址里。
 *    含 `0` 的 id 会让那条断言以"地址里有个 0"的方式假红。
 */
const BILI_ID = 'BV1xx411c7mD';
const YT_ID = 'dQw4w9WgXcQ';
const TWITCH_ID = '123456789';
const YT_THUMB = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg';

/** 六个字段都在的一张卡（第 ① 组的主夹具）。 */
const FULL_VIDEO: TrackedVideo = {
  id: 'tv-1',
  creatorId: 'tc-1',
  platform: 'bilibili',
  externalId: BILI_ID,
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

/**
 * 四个可空字段**全为 null**、没有封面、没有标签（第 ②③ 组的主夹具）。
 *
 * ⚠️★ 平台是 **YouTube**（T7 起），不是 B站 —— 理由只有一个，但是硬的：
 *    ② 那条扫描连**属性**一起扫，而门面把嵌入地址挂在了 `data-embed-src` 上；
 *    B站 那个地址里带着 `autoplay=0&danmaku=0`（`buildEmbedUrl` 拼的固定参数），
 *    于是"产物里一个 `0` 都不许有"会**假红**在一个完全正确的实现上。
 *    ⇒ 换成一条地址里没有 `0` 的平台（YouTube 只有 `/embed/<id>` 一段）。
 *    ⚠️ 这不是把判据放松：四格仍然是 `—`、整份产物仍然要一个 `0` 都没有，
 *      变的只是"这一份产物里恰好不会有别人拼进来的 0"。
 */
const NULL_VIDEO: TrackedVideo = {
  ...FULL_VIDEO,
  id: 'tv-null',
  platform: 'youtube',
  externalId: YT_ID,
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

/*
 * 三个平台各一条（⑭ 的三张卡）。
 *
 * ⚠️ 三条都是**同一份夹具**（`FULL_VIDEO`）只换"平台 + id + 封面"三格：别的字段逐字相同，
 *    于是"某一格渲染成了别人的值"这个错法在对照里看得见。
 * ⚠️ 封面那一格**故意两种都有**：B站 / YouTube 给地址，Twitch 给 `null` ——
 *    一条夹具同时盖住"有封面"与"没有封面"（`null` 时门面回到纯色块，spec §5.3），
 *    而三张卡是**同一次渲染**出来的，两条路的差别只可能来自那一格。
 */
const PER_PLATFORM_VIDEOS: TrackedVideo[] = [
  { ...FULL_VIDEO, id: 'tv-bili', platform: 'bilibili', externalId: BILI_ID, thumbnailUrl: THUMB },
  { ...FULL_VIDEO, id: 'tv-yt', platform: 'youtube', externalId: YT_ID, thumbnailUrl: YT_THUMB },
  { ...FULL_VIDEO, id: 'tv-tw', platform: 'twitch', externalId: TWITCH_ID, thumbnailUrl: null },
];

const CREATOR_ON: TrackedCreator = {
  id: 'tc-on',
  /*
   * ⚠️★ 平台是 **bilibili**（T8 起）：面板按 `TRACK_PLATFORMS`（bilibili → youtube →
   *    twitch）**分段**，而 ⑮ 要断言"**第一个**小标题就是**第一个**平台"。
   * ⚠️★ 夹具里**只给两个平台**（bilibili + twitch），第三个（YouTube）**故意不给**：
   *    它就是"**空的分段连标题一起不画**"（spec §5.4）这条规则的证据 ——
   *    三份夹具都在场的话，那条规则**没有任何一份产物**能证明。
   *    YouTube 那一份由 `CREATOR_YT` 单独提供，⑮ 的正面对照才用它（见那一段）。
   * ⚠️ `externalId` / `handle` 只是夹具值（这个脚本不验它们的形状 —— 解析链接的是
   *    服务端）：与平台对齐只是为了让这一行看起来像真的。
   */
  platform: 'bilibili',
  externalId: '703007996',
  handle: '703007996',
  displayName: 'Example Creator',
  avatarUrl: null,
  backfillDone: true,
  lastSyncedAt: PUBLISHED_SEC,
  lastError: null,
  consecutiveFailures: 0,
  enabled: true,
  videoCount: 137,
  /*
   * ★★ T8：`hiddenCount` 是"他名下**被下架核对隐藏**的行数"（spec §5.4），
   *    面板那一格要显示成 `137（隐藏 3）`。
   *    这一格**故意是 3 而不是 0**：0 的话那一格与今天逐字相同 ⇒
   *    "带括号"那一半**没有任何一份产物**证明得了（T3 留下的那个占位 0 到这里还清）。
   * ⚠️ M = 0 的那一半由 `CREATOR_OFF`（下面那行）提供，⑮ 两条一起断言。
   */
  hiddenCount: 3,
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
  /*
   * ⚠️ 与 `CREATOR_ON` 的 3 成对：**M = 0 时那一格一个括号都不许有**
   *    （"不存在的状态不需要解释"，与"空容器不渲染"同一条纪律）。
   *    ⑮ 用它做反面：整份产物里不许出现 `（隐藏 0）`。
   */
  hiddenCount: 0,
};

/**
 * 第三个平台的博主（YouTube）——**只**给 ⑮ 的正面对照用。
 *
 * ⚠️ 默认那两份夹具**故意没有** YouTube（见 `CREATOR_ON` 的说明）：那一段空着，
 *    它才是"空的分段不渲染"的证据。而"只断言没有"是**半边**对照 —— 一个**永远只画两段**
 *    的实现照样绿（本仓的"反面也要有对照"）。所以这里备一份，让同一份代码在**三段都在**
 *    的夹具下也被渲染一次，断言三段**都在**、顺序照 `TRACK_PLATFORMS`。
 */
const CREATOR_YT: TrackedCreator = {
  ...CREATOR_ON,
  id: 'tc-yt',
  platform: 'youtube',
  externalId: 'UC0123456789abcdef',
  handle: '@example',
  displayName: 'YouTube Example',
  videoCount: 5,
  hiddenCount: 0,
};

interface SectionProps extends Record<string, unknown> {
  items: TrackedVideo[];
  total: number;
  page: number;
  pageSize: number;
  empty: string;
  loading: boolean;
  error: string | null;
  /**
   * 当前分区（`undefined` = 「全部」）。
   * ⚠️ 它**不在** `SECTION_KEYS` 里，而且不能加进去 —— 理由写在那个常量上面。
   */
  platform: TrackPlatform | undefined;
  onPlatformChange: (platform: TrackPlatform | undefined) => void;
  onPage: (page: number) => void;
}

interface PanelProps extends Record<string, unknown> {
  canManage: boolean;
  loading: boolean;
  busy: boolean;
  creators: TrackedCreator[];
  loadError: string | null;
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
  // 「全部」是默认那一档（`undefined`），所以绝大多数夹具不用管这两个 prop
  platform: undefined,
  onPlatformChange: noop,
  onPage: noop,
  ...over,
});

const panelProps = (over: Partial<PanelProps> = {}): PanelProps => ({
  canManage: true,
  loading: false,
  busy: false,
  creators: [CREATOR_ON, CREATOR_OFF],
  loadError: null,
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
 * 卡片那一格**媒体框**的规则（`aspect-ratio` 在不在）—— ① 用它，操作数在这里切出来。
 *
 * ⚠️★ T7 起这一格是**门面**（`ClickToPlayEmbed`），16:9 的盒子也随之从 `.tracked__thumb`
 *    换成了 `.video-embed__frame`（门面**自带**那一个框，spec §5.3）。
 *    判据一个字没变 ——"媒体框的比例必须写死" —— 只是它现在住在另一个类名的规则里。
 *    （`.tracked__thumb` 那条规则留在 `styles.css` 里没人用了，见 ⑪ 的说明。）
 * ⚠️ 切片的两端是**两个类名**（不是行号）：行号是会漂的锚点（`docs/pending.md §5.23`）。
 */
const CSS_VIDEO_FRAME = CSS.slice(
  CSS.indexOf('.video-embed__frame {'),
  CSS.indexOf('.video-embed__iframe {'),
);
assert.ok(
  CSS_VIDEO_FRAME.length > 0,
  '★ 探针：切出了 `.video-embed__frame` 那一段规则（切不到就是这段注释过期了）',
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
 * ⚠️ T7 起封面那一格是**门面**（spec §5.3）：判据从"`img` 上有 `src` 与 `alt` 两样"
 *    换成了"**按钮**的可访问名 + 封面那张 `img` 的 `src` / `lazy` / `referrerpolicy`"
 *    —— 六格还是一格没少（§8.4），只是那一格的可访问名换了个地方住。
 */
const FULL_HTML = renderSection({}, '六个字段都在');
const fullCard = theCard(FULL_HTML);
/*
 * ★★ 封面那一格（T7 起是**门面**，spec §5.3 / §8.4）。
 *
 * ⚠️★ §8.4 点名要的就是这一处改动：六格一格没少，变的是**可访问名**从 `<img alt>`
 *    挪到了包住它的那个按钮上（`aria-label` = 播放 + 标题，`img` 的 `alt=""`）。
 *    ⇒ 这一组原来的五条断言（`tracked__img` 的 src / alt / lazy + `--none` + 16:9）
 *      **不是被删掉**，而是按 §8.4 换成了：按钮的 `aria-label` 含标题 + 封面那张
 *      `<img>` 的 `src` / `lazy` / `referrerpolicy` 三样 + 媒体框仍是 16:9。
 * ⚠️ 为什么要逐条钉住：删掉其中任何一样，产物**照样是绿的** ——
 *    图还是会显示，只是 B站 的封面全变成破图（`referrerpolicy`）、
 *    或者读屏软件在这一格上什么都不说（`aria-label`）。
 */
const facade = elementsWithClass(fullCard, 'video-embed__facade')[0];
assert.ok(
  facade,
  '★★ 卡片那一格必须是一个**门面按钮**（`video-embed__facade`）—— spec §5.3：点一下才加载',
);
const FACADE_LABEL = attrOf(facade ?? '', 'aria-label') ?? '';
assert.ok(
  FACADE_LABEL.includes(FULL_VIDEO.title),
  `★★ 门面的可访问名必须含**标题**（§8.4：它从 \`img alt\` 挪到了这里；实读「${FACADE_LABEL}」）`,
);
assert.ok(
  FACADE_LABEL.startsWith(t('videos.play')),
  `★★ 而且它说的是「播放 + 标题」（实读「${FACADE_LABEL}」）—— 光一个标题读屏用户不知道点下去会发生什么`,
);
const cover = elementsWithClass(fullCard, 'video-embed__cover')[0];
assert.ok(
  cover,
  '★★ `thumbnailUrl` 非 null ⇒ 门面上那张封面在（`<img class="video-embed__cover">`，T6 的 prop）',
);
assert.equal(attrOf(cover ?? '', 'src'), THUMB, '★★ 封面的 `src` 就是上游给的那个地址');
assert.equal(
  attrOf(cover ?? '', 'alt'),
  '',
  '★★ 封面是**装饰性**的 ⇒ `alt=""`（可访问名在按钮上，不该让读屏念两遍）',
);
assert.equal(
  attrOf(cover ?? '', 'loading'),
  'lazy',
  '★★ 封面必须 `loading="lazy"`（一屏几十张图一起请求会把首屏拖慢）',
);
assert.match(
  cover ?? '',
  /referrerpolicy="no-referrer"/i,
  '★★ 封面必须 `referrerpolicy="no-referrer"`（bilibili 图床按 Referer 白名单放行，带 Referer 是 403；判据带 `i`：React 19 的 SSR 印的是驼峰 `referrerPolicy`，而 HTML 属性名不区分大小写）',
);
assert.equal(
  elementsWithClass(fullCard, 'tracked__media').length,
  1,
  '★ 媒体那一格是 `.tracked__media`（门面在里面；播放三角压在封面上的层叠见 CSS 那条注释）',
);
assert.ok(
  /aspect-ratio/.test(CSS_VIDEO_FRAME),
  '★★ 卡片那一格的媒体框必须有 `aspect-ratio`（比例不固定时图片到达会让整页重排）',
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
ok(
  '六个字段：标题 / 封面（点一下才播的门面：按钮 `aria-label` 含标题 + 封面那张 `<img>` 的 src / lazy / no-referrer + 16:9）/ 发布时间 / 时长 / 播放量 / 评论数，标签三种都对',
);

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
  elementsWithClass(nullCard, 'video-embed__cover').length,
  0,
  '★★ 没有封面 ⇒ 门面上**一个封面 `<img>` 都不渲染**（`src=""` 会让浏览器去请求当前页面）',
);
assert.equal(
  nullCard.includes('<img'),
  false,
  '★★ 而整张卡上一个 `<img>` 都没有（更强的判据：这一格是这张卡上唯一可能出现图片的地方）',
);
assert.equal(
  elementsWithClass(nullCard, 'video-embed__facade').length,
  1,
  '★★ 探针：没有封面时**门面仍然在**（否则上面那两条会以"整张卡没渲染出来"的方式通过）—— spec §5.3：`null` 回到纯色块，不许画空框也不许画破图边框',
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
 *    ③ `localDate` / `localDateTime` 直接问一遍 —— `null ⇒ —`、**真的 0 秒照常渲染**
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
/*
 * ⚠️★ **真的 0 秒**这一条**不许**写死年份（原来这里是 `localDate(0, LANG).includes('1970')`）。
 *    `localDate` 走 `toLocaleDateString(locale)`，用的是**跑测机器**的时区：纪元那一刻
 *    在 UTC 以东是 1970-01-01、在 UTC 以西是 **1969-12-31** ⇒ 一个**正确**的实现
 *    会在美洲的机器上把这条断言判红，而红的原因与代码毫无关系。
 *    "一份会被正确的实现判红的断言"比没有断言更坏：下一个人的第一反应是去改代码。
 * ⚠️ 判据因此拆成三条，每一条都与时区无关：
 *    ① `toMillis(0)` 就是 `0` —— 写成 `sec || null` 的实现**在这一步**就已经把 0 变成 null；
 *    ② 它渲染出来的**不是** `—`（"没有值"与"一个合法时刻"必须分得开，这是本条的要害）；
 *    ③ 它渲染的就是**纪元那一刻**那一天 —— 是哪一年取决于跑测机器的时区，两种都对。
 */
assert.equal(
  toMillis(0),
  0,
  '★ 探针：`toMillis(0)` 就是 `0`（写 `sec || null` 的话这里已经是 `null` 了）',
);
const EPOCH_RENDERED = localDate(0, LANG);
assert.notEqual(
  EPOCH_RENDERED,
  '—',
  `★★ **真的 0 秒**不许被当成"没有值"渲染成「—」（写成 \`sec || null\` 就会；实读「${EPOCH_RENDERED}」）`,
);
assert.ok(
  EPOCH_RENDERED.includes('1970') || EPOCH_RENDERED.includes('1969'),
  `★★ 而它渲染的就是**纪元那一刻**那一天（实读「${EPOCH_RENDERED}」）—— 一天之内是 1970 还是 1969，取决于**跑测机器**的时区，所以这条断言不许只认其中一个`,
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
ok(
  '时间戳：2025 而不是 1970；`null` ⇒ 「—」；真的 0 秒 ⇒ 纪元那一刻（**与时区无关**，两种错法各有一条断言）',
);

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
/*
 * ★★ 而**分区里**空是另一回事（T8）：说成"还没抓到 / 抓取每 10 分钟跑一轮"是**假话**。
 *
 * ⚠️★ 一个分区里一条都没有，原因往往是**名单上连这个平台的博主都没有**（今天三个平台里
 *    有两个就是这样）。沿用上面那句 `emptyHint` 会把用户送去等抓取，而抓取永远不会
 *    把一个**不在名单上**的博主抓回来 —— 那是把注意力引向一个必然不成功的动作。
 * ⇒ 分区里换一句（`tracked.emptyPlatform`），而且**不画第二句**：`emptyHint` 正是
 *    要修正的那件事（它在分区里说的原因是错的）。
 * ⚠️ 这一条**必须与上面那条成对**：只留分区那一半的话，一个"永远说分区话术"的实现照样绿
 *    —— 而那一档（「全部」时一条都没有）恰恰是今天最常见的那一屏。
 */
const EMPTY_PARTITION_HTML = renderSection(
  { items: [], total: 0, platform: 'twitch' },
  '空分区（Twitch）',
);
const emptyPartitionTitle = textOf(
  elementsWithClass(EMPTY_PARTITION_HTML, 'tracked__emptytitle')[0] ?? '',
);
assert.equal(
  elementsWithClass(EMPTY_PARTITION_HTML, 'tracked__empty').length,
  1,
  '★★ 分区里空也是一句话 + 那一块（不是一片空白 —— 空白看起来像坏了）',
);
assert.equal(
  emptyPartitionTitle,
  t('tracked.emptyPlatform'),
  `★★ 分区里空用的是**那一句**（实读「${emptyPartitionTitle}」）`,
);
assert.notEqual(
  emptyPartitionTitle,
  t('tracked.empty'),
  '★★ 而它与「全部」那一句必须是**不同**的话（同一个字符串会让上面那条退化成空跑）',
);
assert.notEqual(
  t('tracked.emptyPlatform'),
  'tracked.emptyPlatform',
  '★★ 探针：这一句在当前语言里必须有真值（缺词条时它原样返回 key，下面那条就成了空跑）',
);
assert.equal(
  textOf(EMPTY_PARTITION_HTML).includes(t('tracked.emptyHint')),
  false,
  '★★ 分区里**不许**再画那句"名单上的博主还没抓到 / 抓取每 10 分钟跑一轮" —— 在分区里它把原因说错了方向',
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
  2,
  '★ 正面对照：名单表格也在 —— T8 起是**每平台一张**（夹具里两个平台 ⇒ 两张）',
);
ok('管理面板：`canManage:false` ⇒ 空串；`true` ⇒ 整块在（两个 props 只差这一格）');

// ---------------------------------------------------------------------------
console.log(
  '⑥ 面板内容：七列表头 + 两行博主的六个读数 + "上次同步"经 `toMillis` + 「空 / 取数中 / 取数失败」三态',
);
// ---------------------------------------------------------------------------
/*
 * ★ spec §6.2 第二段点名的六列（平台 / 名字 / 状态 / 上次同步 / 上次错误 / 条数）
 *   + 动作列。表头那一行是**手抄的**：它防的是"某一列被删掉了而界面照样正常"。
 * ⚠️ `CREATOR_OFF` 那一行同时带着四件事：停用 / 从没同步过（`—`）/ 上一轮错了 /
 *    连续失败两次 —— 四件都是 spec §6.3 要的"能看见"。
 */
const tableCount = elementsWithClass(WITH_MANAGE_HTML, 'admintable').length;
assert.equal(
  tableCount,
  2,
  '★ 名单用的就是全站那一张表格形状（`.admintable`）—— T8 起**每平台一张**（夹具里两个平台 ⇒ 两张）',
);
/*
 * ⚠️★ 七列表头**每张表各查一遍**（T8 起面板里不止一张表）：原来的写法是从整份产物里
 *    抓**所有** `<th>`，两张表时那个数组会变成 14 格 —— 于是"七列"这条断言会以一种
 *    与"某一列被删掉"完全无关的方式红，或者更糟：有人把期望值改成 14 格，从此
 *    少一列也看不出来（本仓最怕的那种漂移）。
 */
const tables = elementsWithClass(WITH_MANAGE_HTML, 'tracked__table');
assert.equal(tables.length, 2, `★ 探针：这一段要两张分段表（实测 ${String(tables.length)}）`);
const headersOf = (table: string): string[] =>
  [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => textOf(m[1] ?? ''));
for (const [index, table] of tables.entries()) {
  const headers = headersOf(table);
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
    `★★ 第 ${String(index + 1)} 张表的七列表头与顺序（平台 / 名字 / 状态 / 上次同步 / 上次错误 / 条数 / 操作）`,
  );
  for (const h of headers) {
    assert.equal(
      /^tracked\./.test(h),
      false,
      `★★ 表头必须是**词条的值**，不是裸 key（读到「${h}」）`,
    );
  }
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
  `${String(CREATOR_ON.videoCount)}（${t('tracked.hiddenCount', { count: CREATOR_ON.hiddenCount })}）`,
  '★ 「条数」那一格是他名下已存的条数，后面跟着被隐藏的那几条（`N（隐藏 M）`，spec §5.4）',
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
/*
 * ★★ 第三种状态：**名单没取到**（`loadError`）。
 *
 * ⚠️ 这一条在加 `loadError` 那格 prop 之前**写不出来**，而这正是它值得单列一组的理由：
 *    页面当时把取数失败折进了 `creators: []`（`status === 'ok' ? items : []`），
 *    于是"名单没读到"与"名单上一个人都没有"在 props 上**长得一模一样** ——
 *    产物层面再怎么写也只能证明后者。缺陷的现场是：GET 500 / 断网 / 会话过期时，
 *    面板渲染出"名单还是空的 —— 在上面贴一个博主的链接"这句话**是假的**
 *    （名单不是空的，是没读到），而且它把编辑送去重贴一条**已经在名单上**的链接，
 *    再贴一次只会拿到 `duplicate`。
 * ⚠️ 这一组是**双向**的：上面 `EMPTY_LIST_HTML` 那一条仍然要证明
 *    "`creators: []` 且没有失败 ⇒ 那句话在" —— 只留失败那半边的话，
 *    一个**永远**不渲染空态的实现照样绿（本仓的"反面也要有对照"）。
 */
const PANEL_LOAD_FAILED_TEXT = 'LOAD_FAILED_TEXT';
const PANEL_ERROR_HTML = renderPanel(
  { creators: [], loadError: PANEL_LOAD_FAILED_TEXT },
  '名单取数失败',
);
assert.deepEqual(
  elementsWithClass(PANEL_ERROR_HTML, 'tracked__empty'),
  [],
  `★★ 名单**没取到**不许渲染成"名单是空的"（那句「${t('tracked.manageEmpty')}」会让编辑去重贴一条已经在名单上的链接，而再贴一次只会拿到 duplicate）`,
);
assert.deepEqual(
  elementsWithClass(PANEL_ERROR_HTML, 'tracked__table'),
  [],
  '★★ 也没读到名单 ⇒ 不渲染表格（一张空表看起来像"名单被人清空了"）',
);
assert.ok(
  textOf(PANEL_ERROR_HTML).includes(PANEL_LOAD_FAILED_TEXT),
  '★ 失败那一句必须渲染出来（页面翻好的文本：翻译好的前言 + 原始细节）',
);
assert.equal(
  elementsWithClass(PANEL_ERROR_HTML, 'state--error').length,
  1,
  '★ 面板的取数失败有它自己那一块样式（与"名单是空的"、与"加载中"都不同款）',
);
ok(
  '面板内容：七列表头 + 两行（启用 / 停用）的六个读数都与夹具对得上；"名单是空的" / "加载中" / "取数失败"三态分开',
);

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
console.log('⑫ 门面封面（可选 prop）：传了才画 `<img>`，而且那三样属性是契约');
// ---------------------------------------------------------------------------
/*
 * ★★ 这一段的判据逐条对应 spec §5.3 那两行：封面 `<img>` 的**三个属性是契约**
 *    （`alt=""` / `loading="lazy"` / `referrerpolicy="no-referrer"`），以及
 *    「**没传时外观一个像素都不变**」。
 * ⚠️ `referrerpolicy="no-referrer"` 不是洁癖：bilibili 的图床按 Referer 白名单放行，
 *    带着我们域名的 Referer 会 **403**（spec §2.4 实测）—— 那正是"今天三个平台的封面里
 *    只有 B站 是破图"的原因。这三样里删掉任何一样，产物**照样是绿的**（图还是会显示，
 *    只是某一类视频全变成破图），所以只能在这里逐条钉死。
 * ⚠️⚠️ 两件事与"这一段是不是真的在验东西"有关，缺一个它就空跑：
 *    ① 产物必须进 `products` —— 走上面那个 `render()`，**不是**直接调
 *       `renderToStaticMarkup`：⑪ 的类名收集只认 `products`，而这一段存在的另一半理由
 *       就是证明新的那个类名 `video-embed__cover` 在 `styles.css` 里有规则；
 *    ② 夹具的文字一律 **ASCII**：`title` 会进 `aria-label`（属性），而 `--en` 那一遍的
 *       ⑩ 连属性一起扫汉字（见上面那段夹具说明）。
 */
const COVER_URL = 'https://i0.hdslb.com/bfs/archive/x.jpg';

const WITH_COVER_HTML = render(
  createElement(ClickToPlayEmbed, {
    platform: 'bilibili',
    idLabel: 'BV1xx411c7mD',
    title: 'Facade with a cover',
    startOffsetSec: null,
    coverUrl: COVER_URL,
  }),
);
/*
 * ⚠️★ 这一条**必须**大小写不敏感，别把它"顺手改回小写去照抄计划"：
 *    React 19 的 SSR 产物里这个属性印成**驼峰** `referrerPolicy="no-referrer"`
 *    （实测；`renderToStaticMarkup` 这一层我们控制不了），而 HTML 的属性名是
 *    **ASCII 大小写不敏感**的 ⇒ 浏览器看到的仍然是 `referrerpolicy`，
 *    也就是 spec §2.4 要的那一个（"不带 Referer 才是 200"）。
 *    ⇒ 写成 `includes('referrerpolicy="no-referrer"')` 的话，一个**正确**的实现会被判红，
 *      而红的原因与代码无关 —— 与 ③ 那条"0 秒 / 时区"同一族：不许写一条
 *      **正确实现过不了**的断言（那比没有断言更坏：下一个人的第一反应是去改代码）。
 */
assert(
  /<img[^>]*referrerpolicy="no-referrer"/i.test(WITH_COVER_HTML),
  '封面必须带 referrerpolicy=no-referrer（判据带 `i`：React 19 印的是驼峰 `referrerPolicy`）',
);
assert(/<img[^>]*alt=""/.test(WITH_COVER_HTML), '门面里的封面是装饰性的 ⇒ alt 必须是空串');
assert(WITH_COVER_HTML.includes('loading="lazy"'), '封面要懒加载');
assert(
  WITH_COVER_HTML.includes(COVER_URL),
  `★★ 封面的地址就是调用方给的那个（实扫产物里有没有「${COVER_URL}」）`,
);
const WITHOUT_COVER_HTML = render(
  createElement(ClickToPlayEmbed, {
    platform: 'youtube',
    idLabel: 'abc',
    title: 'Facade without a cover',
    startOffsetSec: null,
  }),
);
assert(!WITHOUT_COVER_HTML.includes('<img'), '不传封面时门面上**一个 img 都没有**（外观零变化）');
/*
 * ★★ `null` 与"根本不传"必须**逐字节相同** —— spec §5.3 的「没传时外观一个像素都不变」
 *    在这一格上是可判定的（两份 props 只差这一格，产物长度都一样）。
 * ⚠️ 这一格是**真的会发生**的：YouTube / Twitch 的追踪条目都可能没有封面
 *    （`thumbnail_url` 是 NULL），而界面必须**回到今天的色块** —— 不许为了
 *    "看起来统一"画一个空框或破图边框（那东西每一次都要求人解释一次）。
 */
const NULL_COVER_HTML = render(
  createElement(ClickToPlayEmbed, {
    platform: 'youtube',
    idLabel: 'abc',
    title: 'Facade without a cover',
    startOffsetSec: null,
    coverUrl: null,
  }),
);
assert.equal(
  NULL_COVER_HTML,
  WITHOUT_COVER_HTML,
  '★★ `coverUrl: null` 与**根本不传**必须逐字节相同（`src=""` 那种实现会让浏览器去请求当前页面）',
);
/*
 * ★ 探针（"反面也要有对照"）：这两份产物里**门面本身**必须在 —— 否则上面那两条
 *   "没有 img"会在"组件根本没渲染"时也成立（本仓 `§5.63` 那一族）。
 */
assert.equal(
  elementsWithClass(WITH_COVER_HTML, 'video-embed__facade').length,
  1,
  '★★ 探针：带封面那一份产物里确实有门面按钮',
);
assert.equal(
  elementsWithClass(WITHOUT_COVER_HTML, 'video-embed__facade').length,
  1,
  '★★ 探针：没封面那一份产物里同样有门面按钮（两边的对照才成立）',
);
const coverImg = elementsWithClass(WITH_COVER_HTML, 'video-embed__cover')[0];
assert.ok(
  coverImg,
  '★★ 封面必须就是 `<img class="video-embed__cover">` —— ⑪ 靠这个类名去 `styles.css` 里查规则',
);
assert.equal(
  attrOf(coverImg ?? '', 'src'),
  COVER_URL,
  '★★ 封面的 `src` 就是调用方给的那个地址（`attrOf` 读的是那个元素自己的属性）',
);
assert.equal(
  attrOf(coverImg ?? '', 'class'),
  'video-embed__cover',
  '★★ 门面封面**只允许新增这一个类名**（Global Constraints 第 8 条：分区按钮那一条才是"不许新增"）',
);
assert.match(
  coverImg ?? '',
  /<img[^>]*referrerpolicy="no-referrer"/i,
  '★★ 这一样契约必须挂在**那张 img 自己**身上（`i` 同上：React 19 印的是驼峰）—— 挂在别人身上对图床一样是 403',
);
assert.equal(
  elementsWithClass(WITH_COVER_HTML, 'video-embed__playshape').length,
  1,
  '★★ 有封面时播放三角**还在**（spec §5.3：封面是"上面盖播放三角"，不是用封面把三角换掉）',
);
/*
 * ★★ 而"还在"只是这一半：**谁画在上面**在静态产物里只剩 DOM 顺序这一个判据
 *    （样式里的层叠静态断言看不见 —— 见文件末尾"覆盖边界"那一段）。
 *    `ClickToPlayEmbed` 把封面排在三角**之前**，靠的正是"同一绘制层里靠后的画在上面"；
 *    反过来（把 `<img>` 挪到三角后面）的表现很具体：**门面上唯一那个可点的提示被图埋掉**，
 *    用户看到的是一张"点不动的封面"（spec §5.3 那一句"上面盖播放三角"就没了）。
 *    ⇒ 这一条与上面那条测的是**两件不同的事**：上面是"两个都在"，这里是"谁在前面"。
 *    ⚠️ 作用域是**门面那一块**（`elementsWithClass` 取的是外层元素、含里面的子元素）。
 */
const FACADE_WITH_COVER = elementsWithClass(WITH_COVER_HTML, 'video-embed__facade')[0] ?? '';
assert.ok(
  FACADE_WITH_COVER.indexOf('video-embed__cover') >= 0 &&
    FACADE_WITH_COVER.indexOf('video-embed__cover') <
      FACADE_WITH_COVER.indexOf('video-embed__playshape'),
  '★★ 封面必须画在播放三角**之前**（DOM 顺序决定谁在上面：图在前、三角在后 ⇒ 三角留在可见的那一层；反过来会把唯一那个可点的提示埋在图下面）',
);
assert.deepEqual(
  elementsWithClass(WITHOUT_COVER_HTML, 'video-embed__cover'),
  [],
  '★★ 没封面时连那个类名都不许出现（不是"渲染了但看不见"）',
);
ok(
  '门面封面：传了 ⇒ `<img class="video-embed__cover">` 带 src + `alt=""` + lazy + no-referrer，且三角还在；不传或 `null` ⇒ 与今天逐字节相同',
);

// ---------------------------------------------------------------------------
console.log('⑬ 分区按钮：四个（全部 + 三个平台），选中态跟着 `platform` 走');
// ---------------------------------------------------------------------------
/*
 * ★ spec §5.2（照抄 §2.6 那面墙）：四个按钮、同一套类名（`tagcloud` / `tagchip` /
 *   `tagchip--on`）、平台名走 `videos.platform*` 词条 —— **不新增 CSS**。
 *
 * ⚠️★ 判据是**两个 props 对照**（`undefined` 与 `'twitch'`），不是"按钮渲染出来了没有"：
 *    一个把选中态**写死**在「全部」上的实现，只渲染一次是看不出来的。
 * ⚠️ `platform` 这一个 prop 只能这样守：`undefined` 是它的**合法值**（=「全部」），
 *    所以 `assertPropsGiven` 那道守卫碰不了它（理由写在 `SECTION_KEYS` 上面）。
 * ⚠️ 点下去发生什么**不在这一组**（SSR 不渲染事件处理器）："换分区要删 `tpage`、
 *    不碰 `platform` / `page`"那一半住在 `lib/trackedQuery.ts` 里，由**⑯** 直接断言
 *    （两个纯函数）；剩下真正看不见的是"页面有没有真的调它们"（边界写在文件末尾）。
 */
const chipLabels = (html: string): string[] =>
  elementsWithClass(html, 'tagchip').map((el) => textOf(el));
const activeChips = (html: string): string[] =>
  elementsWithClass(html, 'tagchip')
    .filter((el) => hasClassIn(el, 'tagchip--on'))
    .map((el) => textOf(el));

const ALL_PLATFORMS_HTML = renderSection({}, '分区：全部');
assert.deepEqual(
  chipLabels(ALL_PLATFORMS_HTML),
  [
    t('videos.allPlatforms'),
    t('videos.platformBilibili'),
    t('videos.platformYoutube'),
    t('videos.platformTwitch'),
  ],
  '★★ 四个按钮，顺序是「全部 + 三个平台」（`TRACK_PLATFORMS` 的顺序）—— 与上面那面墙逐字同形',
);
assert.equal(
  textOf(elementsWithClass(ALL_PLATFORMS_HTML, 'tagcloud__label')[0] ?? ''),
  t('videos.allPlatforms'),
  '★★ 那一行前面的标签（照抄 §2.6 的 `tagcloud__label`）',
);
assert.equal(
  elementsWithClass(ALL_PLATFORMS_HTML, 'tagchip').every((el) => attrOf(el, 'type') === 'button'),
  true,
  '★ 四个都必须是 `type="button"`（默认的 submit 在表单里会变成一次整页提交）',
);
assert.deepEqual(
  activeChips(ALL_PLATFORMS_HTML),
  [t('videos.allPlatforms')],
  '★★ 「全部」时**只有**「全部」是选中态（与那面墙同一条）',
);
const TWITCH_CHIPS_HTML = renderSection({ platform: 'twitch' }, '分区：只看 Twitch');
assert.deepEqual(
  activeChips(TWITCH_CHIPS_HTML),
  [t('videos.platformTwitch')],
  '★★ `platform="twitch"` ⇒ 选中态**跟着 props 走**（亮的是 Twitch 那一个，别的都不亮）',
);
assert.deepEqual(
  chipLabels(TWITCH_CHIPS_HTML),
  chipLabels(ALL_PLATFORMS_HTML),
  '★ 四个按钮的**文字**与分区无关（换分区换的是选中态与列表，不是按钮本身）',
);
ok('分区按钮：四个（全部 + 三个平台）+ 同一行标签 + 选中态跟着 `platform` 走');

// ---------------------------------------------------------------------------
console.log('⑭ 卡片是门面：三个平台的 `data-embed-src` 形状 + 封面三样 + 「去原站」那条外链还在');
// ---------------------------------------------------------------------------
/*
 * ★ spec §9 第 14 条：三张卡各自的嵌入地址形状 —— bilibili 含 `bvid=`、
 *   YouTube 含 `/embed/`、Twitch 含 `video=v` 与 `parent=`。
 *
 * ⚠️★ Twitch 那一条**必须**先伪造 `globalThis.location` 再渲染：
 *    `buildEmbedUrl` 对 Twitch 在**没有 origin** 时返回 `null`（宁可不嵌，也不发一个
 *    注定被 parent 校验拒掉的请求），而脚本环境里没有 `location` ⇒ 不伪造的话
 *    Twitch 那张卡的 `data-embed-src` 是**空的**，而"形状对不对"这条断言会以
 *    **"根本没有地址"**的方式通过（本仓最怕的那种空跑）。
 *    ⚠️ 伪造完**必须还原**（`finally`）：不还原的话后面每一份产物都带着一个不存在的
 *    域名，而那种污染不会有任何报错（`liverender.tsx` 是同一处置）。
 * ⚠️ 三条视频是**同一次渲染**出来的（spec §9 第 14 条那两种写法都允许）：
 *    三张卡的差别只可能来自 `platform` / `externalId` / `thumbnailUrl` 那三格。
 */
const EMBED_ORIGIN = 'mcsr.example';
const THREE_PLATFORM_HTML = ((): string => {
  const backup = (globalThis as { location?: unknown }).location;
  try {
    (globalThis as { location?: unknown }).location = { hostname: EMBED_ORIGIN };
    return renderSection(
      { items: PER_PLATFORM_VIDEOS, total: PER_PLATFORM_VIDEOS.length },
      '三个平台各一条',
    );
  } finally {
    if (backup === undefined) delete (globalThis as { location?: unknown }).location;
    else (globalThis as { location?: unknown }).location = backup;
  }
})();
const platformCards = elementsWithClass(THREE_PLATFORM_HTML, 'tracked__card');
assert.equal(
  platformCards.length,
  3,
  `★ 探针：这一份产物里应当恰好三张卡（实测 ${String(platformCards.length)}）`,
);
const facadeSrcOf = (card: string): string => {
  const faces = elementsWithClass(card, 'video-embed__facade');
  assert.equal(faces.length, 1, `★ 探针：一张卡上恰好一个门面（实测 ${String(faces.length)}）`);
  const src = attrOf(faces[0] ?? '', 'data-embed-src');
  assert.notEqual(
    src,
    null,
    '★★ 门面必须挂上"点下去会加载哪个地址"（`data-embed-src`）—— 拼不出地址时它是空的，下面每一条都会变成空跑',
  );
  return src ?? '';
};
const biliCard = platformCards[0] ?? '';
const ytCard = platformCards[1] ?? '';
const twitchCard = platformCards[2] ?? '';
const biliSrc = facadeSrcOf(biliCard);
const ytSrc = facadeSrcOf(ytCard);
const twitchSrc = facadeSrcOf(twitchCard);

assert.ok(
  biliCard.includes('data-embed-src="https://player.bilibili.com/player.html?bvid='),
  '★★ B站 的嵌入门面：地址形状是 `player.bilibili.com/player.html?bvid=<BV号>`',
);
assert.ok(
  biliSrc.includes(`bvid=${BILI_ID}`),
  `★★ 而且 bvid 就是那一条的 \`externalId\`（实读「${biliSrc}」）`,
);
assert.ok(
  ytCard.includes('data-embed-src="https://www.youtube.com/embed/'),
  '★★ YouTube 的嵌入门面：地址形状是 `www.youtube.com/embed/<videoId>`',
);
assert.ok(
  ytSrc.includes(`/embed/${YT_ID}`),
  `★★ 而且 videoId 就是那一条的 \`externalId\`（实读「${ytSrc}」）`,
);
assert.ok(
  twitchCard.includes('video=v') && twitchCard.includes('parent='),
  '★★ Twitch 的嵌入门面：地址里必须有 `video=v<数字ID>` 与 `parent=<域名>`（漏了 `v` 前缀播放器是个白框，而且不报错）',
);
assert.ok(
  twitchSrc.includes(`video=v${TWITCH_ID}`) && twitchSrc.includes(`parent=${EMBED_ORIGIN}`),
  `★★ 而且两个值都是真的（实读「${twitchSrc}」）—— parent 必须是**裸域名**（带协议 / 路径会被静默拒播）`,
);
assert.equal(
  attrOf(elementsWithClass(biliCard, 'video-embed__facade')[0] ?? '', 'disabled'),
  null,
  '★ 地址拼得出来 ⇒ 门面**可点**（`disabled` 那一档是"这里嵌不了"）',
);
/*
 * ★ §8.4 + §5.3 要的三样，在这一份**真实卡片**产物上再查一遍：
 *   ⚠️ ⑫ 查的是组件本身的两态（传了 / 没传），它证明不了"卡片**这里**传了 `coverUrl`"
 *      —— 删掉卡片里那一行传参，⑫ 照样全绿，只有下面这几条会红。
 */
assert.match(
  biliCard,
  /referrerpolicy="no-referrer"/i,
  '★★ 封面还是不许带 Referer（判据带 `i`：React 19 的 SSR 印的是驼峰 `referrerPolicy`，而 HTML 属性名不区分大小写 ⇒ 浏览器看到的仍是 `referrerpolicy`）',
);
assert.equal(
  elementsWithClass(biliCard, 'video-embed__cover').length,
  1,
  '★★ 有 `thumbnailUrl` 的那一条卡上确实画了封面',
);
assert.equal(
  elementsWithClass(twitchCard, 'video-embed__cover').length,
  0,
  '★ 而 `thumbnailUrl: null` 的那一条**没有**封面 `<img>`（同一次渲染里的正面对照）',
);
assert.ok(biliCard.includes('tracked__out'), '★★ 「去原站」那条外链必须还在（它是兜底出口）');
for (const [where, card, href] of [
  ['B站', biliCard, `https://www.bilibili.com/video/${BILI_ID}`],
  ['YouTube', ytCard, `https://www.youtube.com/watch?v=${YT_ID}`],
  ['Twitch', twitchCard, `https://www.twitch.tv/videos/${TWITCH_ID}`],
] as const) {
  assert.equal(
    attrOf(elementsWithClass(card, 'tracked__out')[0] ?? '', 'href'),
    href,
    `★★ ${where} 的「去原站」指向原视频页（形状走 \`watchUrl\`，不在这一栏里抄第二份）`,
  );
}
assert.equal(
  elementsWithClass(biliCard, 'tracked__cardtitle').length,
  1,
  '★★ §8.4：标题那一行还在 —— 封面换了画法，不等于把六格里的某一格删掉',
);
ok(
  '卡片门面：三个平台的嵌入地址形状都对（Twitch 带 `video=v` + 裸域名 `parent`），封面三样属性、「去原站」外链与标题都在',
);

// ---------------------------------------------------------------------------
console.log('⑮ ★★ 面板按平台分成三段（空的分段连标题一起不画）+ 「条数」那一格带隐藏条数');
// ---------------------------------------------------------------------------
/*
 * ★ spec §5.4：管理面板的名单按 `platform` 分成三段，顺序照 `TRACK_PLATFORMS`
 *   （bilibili → youtube → twitch），每段有自己的小标题与条数；**空的分段不渲染**；
 *   每段的"条数"那一格在 M > 0 时显示成 `N（隐藏 M）`。
 *
 * ⚠️★ 这一组的判据全部建在**夹具的差别**上，而不是"某个类名渲染出来了没有"：
 *    · 夹具里只有**两个**平台（bilibili + twitch）⇒ "第三段不画"才有一条**真的**
 *      产物证明它（三份夹具都在场时，那条规则谁也证明不了）；
 *    · 而"只断言没有第三段"是**半边**对照 —— 一个**永远只画两段**的实现照样绿，
 *      所以紧接着用三个平台的夹具再渲染一次（`CREATOR_YT` 就是为它准备的）。
 * ⚠️ 顺序与"没有 YouTube 那一段"合成一条断言（`PLATFORM_TITLES.find`）：数组比较里
 *    既看**顺序**又看**少了谁**，比"第一段 startsWith(...) + 断言不含 YouTube"更难写错。
 * ⚠️ 「条数」那一格的两个方向都要有（N=137/M=3 与 N=0/M=0）：只喂 M > 0 的话，
 *    "M = 0 时**不许**有括号"那一条永远不红（那是本任务最容易做错的一半）。
 * ⚠️ 分段只把 `creators` **过滤**一遍、**不排序**：段内顺序就是名单接口返回的那个数组的
 *    顺序 —— `listCreators` 的 `ORDER BY c.created_at DESC, c.id ASC`（**新加入的在前**），
 *    所以界面里再排一次就是第二份"谁在前"的口径（spec §5.4；照"加入顺序"补一句升序
 *    排序会把整份名单倒过来）。
 */
/** 三个平台名，**手抄**一份（与 ⑬ 同一份顺序）—— spec §5.4 要钉的正是这个顺序。 */
const PLATFORM_TITLES = [
  t('videos.platformBilibili'),
  t('videos.platformYoutube'),
  t('videos.platformTwitch'),
] as const;
/** 小标题 → 它属于哪个平台（认不出来就原样返回，那条断言会当场红）。 */
const titlePlatform = (title: string): string =>
  PLATFORM_TITLES.find((name) => title.startsWith(name)) ?? title;

const groupSections = elementsWithClass(WITH_MANAGE_HTML, 'tracked__group');
assert.equal(
  groupSections.length,
  2,
  `★★ 两个平台 ⇒ **两段**（实测 ${String(groupSections.length)} 段）`,
);
const groupTitles = elementsWithClass(WITH_MANAGE_HTML, 'tracked__grouptitle').map((el) =>
  textOf(el),
);
assert.equal(
  groupTitles[0]?.startsWith(PLATFORM_TITLES[0]),
  true,
  `★★ 第一个小标题是**第一个平台**（\`TRACK_PLATFORMS\` 的顺序，bilibili 在最前）—— 实读「${groupTitles[0] ?? ''}」`,
);
assert.deepEqual(
  groupTitles.map((title) => titlePlatform(title)),
  [PLATFORM_TITLES[0], PLATFORM_TITLES[2]],
  '★★ 两段的顺序是 `TRACK_PLATFORMS` 的顺序（bilibili 在前、twitch 在后），而**没有** YouTube 那一段',
);
assert.deepEqual(
  elementsWithClass(WITH_MANAGE_HTML, 'tracked__groupcount').map((el) => textOf(el)),
  ['1', '1'],
  '★ 每段有**自己的条数**（spec §5.4：小标题 + 该段条数）—— 夹具每段恰好一个博主',
);
assert.equal(
  rawText(WITH_MANAGE_HTML).includes(PLATFORM_TITLES[1]),
  false,
  '★★ 夹具里没有 YouTube 的博主 ⇒ **第三段连小标题一起不画**（spec §5.4：空的分段不渲染）',
);
const THREE_GROUPS_HTML = renderPanel(
  { creators: [CREATOR_ON, CREATOR_YT, CREATOR_OFF] },
  '三个平台都有博主（正面对照）',
);
assert.deepEqual(
  elementsWithClass(THREE_GROUPS_HTML, 'tracked__grouptitle').map((el) =>
    titlePlatform(textOf(el)),
  ),
  [PLATFORM_TITLES[0], PLATFORM_TITLES[1], PLATFORM_TITLES[2]],
  '★★ 正面对照：三个平台都有博主时**三段都在** —— 少了这一条，一个"永远只画两段"的实现照样绿',
);
assert.deepEqual(
  elementsWithClass(EMPTY_LIST_HTML, 'tracked__group'),
  [],
  '★★ 名单一个人都没有时**一段都不画**，只剩那句"名单还是空的"（spec §5.4 最后那半句）',
);
/*
 * 「条数」那一格：`N（隐藏 M）`，M = 0 时**没有括号**。
 * ⚠️ 括号是全角 `（）`，由渲染点给（不是词条的一部分，见 `zh-CN.ts` 那一句的说明）——
 *    两种语言都长这样，所以这里用 `t(...)` 拼期望值，而不是写死一句中文。
 */
const groupRows = elementsWithClass(WITH_MANAGE_HTML, 'tracked__row');
assert.equal(groupRows.length, 2, `★ 探针：两段各一行（实测 ${String(groupRows.length)} 行）`);
const hiddenCell = textOf(elementsWithClass(groupRows[0] ?? '', 'tracked__total')[0] ?? '');
assert.equal(
  hiddenCell,
  `${String(CREATOR_ON.videoCount)}（${t('tracked.hiddenCount', { count: CREATOR_ON.hiddenCount })}）`,
  `★★ 有隐藏行的博主显示成 \`N（隐藏 M）\`（实读「${hiddenCell}」）—— N 仍是**库里所有行**（含隐藏），M 是其中现在不显示的那些`,
);
assert.equal(
  textOf(elementsWithClass(groupRows[1] ?? '', 'tracked__total')[0] ?? ''),
  String(CREATOR_OFF.videoCount),
  '★★ 而 `hiddenCount: 0` 的那一格**只有那个数**、没有括号（不存在的状态不需要解释）',
);
assert.equal(
  rawText(WITH_MANAGE_HTML).includes(`（${t('tracked.hiddenCount', { count: 0 })}）`),
  false,
  '★★ 整份产物里都不许出现 `（隐藏 0）` —— M = 0 时连括号一起不画（与"空容器不渲染"同一条纪律）',
);
assert.notEqual(
  t('tracked.hiddenCount', { count: 0 }),
  'tracked.hiddenCount',
  '★★ 探针：这一句在当前语言里必须有真值（缺词条时它原样返回 key，上面那条就成了空跑）',
);
ok(
  '面板分段：两段（顺序照 `TRACK_PLATFORMS`）、空段不画（含三段都在的正面对照）、每段自带条数；`N（隐藏 M）` 只在 M > 0 时出现',
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
 *
 * ⚠️★ 这一组与 ⑩ **排在所有渲染之后**（⑮ 之后、⑪ 之前），不是紧跟在 ⑧ 后面：
 *    两者扫的都是 `products` 的**整页快照**（`everyProduct` / `allRaw`），而快照
 *    在中间拍下来的话，排在它后面的那几份产物 —— ⑫ 门面封面、⑬ 分区按钮、
 *    ⑭ 三张卡、⑮ 面板三段 —— **这两份扫描一份都不进**：那几份里就算出现裸 key、
 *    星号或写在组件里的汉字也**不会红**，而夹具注释却声称"⑩ 会扫它们"。
 *    ⇒ 只能是"先渲染完、再整页扫"（⑪ 那道类名闸同一条纪律：
 *      收集必须发生在最后一次渲染之后）。
 *    ⚠️ 连带后果：⑫ 的夹具文字必须是 **ASCII**（`title` 会进 `aria-label`，
 *      而 `--en` 那一遍的 ⑩ 连属性一起扫汉字）—— 这句话从"声称"变成了**真的**。
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
   * ⚠️★ 它扫的 `allRaw` 与 ⑨ 是**同一份整页快照**（理由写在那上面）：
   *    ⑫…⑮ 那几份产物也在这份快照里，所以英文那几段夹具的文字必须全是 ASCII。
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
console.log('⑯ 分区参数的读写（`?tplatform=` / 换分区删 `tpage`）—— 页面那一半唯一能被断言的地方');
// ---------------------------------------------------------------------------
/*
 * ★ spec §5.2 + §8.2 那条契约的两个**纯函数**（`apps/web/src/lib/trackedQuery.ts`）：
 *   · 地址栏里的 `tplatform` **先校验再用**（手打 `?tplatform=foo` ⇒ 「全部」，不是 400）；
 *   · 换分区 = 回第 1 页（**删 `tpage`**），而且**不许碰** `platform` / `page` —— 那两个是
 *     同一个页面上**上面那面墙**的状态。
 *
 * ⚠️★ 为什么这些断言住在**这里**（本仓没有 web 测试跑器 —— 渲染脚本就是 web 代码的
 *    断言入口）：页面本身（`routes/Videos.tsx`）静态渲染**够不到** —— 它取数、它是
 *    7 个 `useState`，那四个处理器一个都不跑（文件末尾"覆盖边界"那一段逐条列了这件事）。
 *    抽成纯函数之前，"换分区删 `tpage`、不碰 `platform` / `page`"这条契约
 *    **一条断言都没有**，而它错了的表现是"点一下 B站，上面那面墙的筛选也没了" ——
 *    只有两栏都用过时才看得见。
 * ⚠️ 喂进去的是真的 `URLSearchParams`（不是对象字面量）：换分区那一步在 react-router
 *    里收到的就是它，用一个长得像的东西代替，下面那几条会以"什么都没读到"的方式假绿。
 */

/** 两个参数名是 spec §10 冻结表里的那一行（改了它，页面上那一栏就与文档对不上了）。 */
assert.equal(TRACKED_PLATFORM_PARAM, 'tplatform', '★ 分区参数名是 `tplatform`（spec §10）');
assert.equal(TRACKED_PAGE_PARAM, 'tpage', '★ 页码参数名是 `tpage` —— 换分区要删的就是它');

/** 读：认得出三个平台，认不出的一律退化成「全部」。 */
const READ_CASES = [
  ['', undefined],
  ['tpage=2', undefined],
  ['tplatform=bilibili', 'bilibili'],
  ['tplatform=youtube', 'youtube'],
  ['tplatform=twitch', 'twitch'],
  // ⚠️ 手打的地址：一个都不许原样发给服务端（`?platform=foo` 那边是 400）
  ['tplatform=foo', undefined],
  ['tplatform=', undefined],
  ['tplatform=Twitch', undefined],
  ['tplatform=twitch/../x', undefined],
] as const;
for (const [query, expected] of READ_CASES) {
  assert.equal(
    readTrackedPlatform(new URLSearchParams(query)),
    expected,
    `★★ \`?${query}\` ⇒ ${String(expected)}（认不出的值必须退化成「全部」，不是原样发出去）`,
  );
}
assert.equal(
  READ_CASES.filter(([, expected]) => expected !== undefined).length,
  3,
  '★ 探针：上面那组用例里确实有**三个**能读出值的（否则"全都退化成 undefined"也是绿的）',
);

/** 换分区：带上墙的状态与前两次翻页，看它到底动了什么、没动什么。 */
const WALL_QUERY = 'platform=youtube&page=3&tpage=2&tplatform=youtube';
const SWITCHED = nextParamsForTrackedPlatform(new URLSearchParams(WALL_QUERY), 'twitch');
assert.equal(SWITCHED.get(TRACKED_PLATFORM_PARAM), 'twitch', '★★ 换分区写的是**新的那个平台**');
assert.equal(
  SWITCHED.has(TRACKED_PAGE_PARAM),
  false,
  '★★ 换分区必须**删掉** `tpage`（= 回到第 1 页）—— 停在第三页而新分区只有一页是一屏空白',
);
assert.equal(SWITCHED.get('platform'), 'youtube', '★★ 而**不许碰**上面那面墙的 `platform`');
assert.equal(SWITCHED.get('page'), '3', '★★ 同样不许碰它的 `page`（两个区块各自翻各自的页）');
assert.equal(
  readTrackedPlatform(SWITCHED),
  'twitch',
  '★ 写进去的那一份读回来还是同一个平台（一读一写是同一份口径）',
);
assert.equal(
  new URLSearchParams(WALL_QUERY).toString().includes('tplatform=youtube'),
  true,
  '★ 探针：上面那条用的查询串确实带着一个旧分区（否则"换掉了"证明不了什么）',
);

/** 点「全部」：**删参数**，不是留一个空值（`?tplatform=` 在服务端那一头是 400 的取值）。 */
const CLEARED = nextParamsForTrackedPlatform(new URLSearchParams(WALL_QUERY), undefined);
assert.equal(
  CLEARED.has(TRACKED_PLATFORM_PARAM),
  false,
  '★★ 「全部」= 把 `tplatform` **删掉**（留一个空串会让这一栏读出一个空值，而墙上那面墙的空串是 400）',
);
assert.equal(CLEARED.has(TRACKED_PAGE_PARAM), false, '★★ 点「全部」同样回第 1 页');
assert.equal(
  readTrackedPlatform(CLEARED),
  undefined,
  '★ 删干净之后读出来就是「全部」（与"没传过这个参数"逐字节同形）',
);
assert.equal(CLEARED.get('platform'), 'youtube', '★★ 「全部」也不许顺手清掉墙的 `platform`');
assert.equal(CLEARED.get('page'), '3', '★★ 也不许清掉墙的 `page`');
assert.equal(
  CLEARED.toString().includes('tplatform'),
  false,
  '★★ 连"键在不在"都要钉：`tplatform=` 这种**空值**在服务端是非法取值（spec §5.1 的封闭枚举）',
);

/** 纯函数：**不许就地改**传进来的那一份（改了它 = 改了 react-router 手上的状态）。 */
const PREV = new URLSearchParams(WALL_QUERY);
nextParamsForTrackedPlatform(PREV, undefined);
assert.equal(
  PREV.get(TRACKED_PLATFORM_PARAM),
  'youtube',
  '★★ 传进来的那一份必须原样不动（返回值是新的一份，不是就地改了它）',
);

/** 反面探针：函数确实会把四个键都**带过**去，而不是"回一个只有 tplatform 的串"。 */
assert.equal(SWITCHED.get('tpage'), null, '★ 探针：`tpage` 读出来是 null（真的没了）');
assert.notEqual(
  SWITCHED.toString(),
  nextParamsForTrackedPlatform(new URLSearchParams('tplatform=youtube'), 'twitch').toString(),
  '★ 探针：墙的 `platform` / `page` 确实被带过去了（否则上面两条"不碰它们"是空跑）',
);
ok(
  '分区参数：`tplatform` 认得出三个平台、认不出的一律退化成「全部」；换分区写新值 + 删 `tpage`、而墙的 `platform` / `page` 原样带过去；纯函数不改入参',
);

// ---------------------------------------------------------------------------
console.log(
  '⑪ ★★ 类名 ↔ CSS —— 产物里每一个 `tracked*` / `video-embed*` 类名都要有规则（**先剥注释**）',
);
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
 *
 * ⚠️ 收进来的**前缀有两族**：`tracked*` 与 `video-embed*`。门面是全站唯一一份嵌入实现，
 *    而 T6 起它长出了 `video-embed__cover` 这个新类名（spec §5.3）—— 只查 `tracked*`
 *    的话，"新类名有没有规则"就没有任何东西看得见，而"渲染得出来但什么都不生效的类名"
 *    正是这一节存在的全部理由（§5.70 那个 `.mcsr-input` 笔误就是这么活过三轮评审的）。
 *    这一类名只可能在本页产出，因为自检**在这一页**渲染了门面本身（⑫）；
 *    别的页面上的 `video-embed*` 由那一面的渲染脚本各自负责。
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
  /*
   * ⚠️ T7：`tracked__thumb` / `tracked__thumb--none` / `tracked__img` 这三格
   *    **换成了** `tracked__media`（门面自带 16:9 的框，§5.3）。
   *    这不是"把清单改短了"：媒体那一格仍然必须出现，只是它的类名变了；
   *    封面那一格的判据搬去了 ① / ⑭（§8.4 点名要的就是"改成断言按钮的可访问名 +
   *    封面那张 `<img>` 的三样属性"，不是把这一格删掉）。
   *    ⚠️ `styles.css` 里那三条规则**留着没删**：它们只是今天没人用了，
   *       而删它们是另一件事（不在 T7 的文件清单里）。
   */
  'tracked__media',
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
  /*
   * ⚠️ T8：面板按平台分段的三格（spec §5.4）。它们是**新类名** —— 按这一节上面的
   *    说明，新类名本来只需要"在 `styles.css` 里有规则"（下面那个循环兜着），
   *    列进这张手抄清单是为了另一半：**"分段"这件事本身被整块摘掉**时，
   *    光靠类名循环是看不出来的（少一个类名不等于少了那一段界面）。
   */
  'tracked__group',
  'tracked__grouptitle',
  'tracked__groupcount',
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
 *    ⚠️ 这也是 ⑫ / ⑬ / ⑭ 排在 ⑪ **前面**、编号却比它大的原因：带渲染的段落只能排在收集之前。
 */
const CLASS_PREFIXES = ['tracked', 'video-embed'] as const;
const pageClasses = [
  ...new Set(
    products
      .flatMap(classNamesIn)
      .filter((cls) => CLASS_PREFIXES.some((prefix) => cls.startsWith(prefix))),
  ),
].sort();
assert.ok(pageClasses.length > 0, '★★ 探针：产物里确实收集到了类名（否则下面那个循环一次都不跑）');
assert.ok(
  pageClasses.includes('video-embed__cover'),
  '★★ 探针：`video-embed__cover` 进了清单 —— ⑫ 那一份产物必须走 `render()`（直接 `renderToStaticMarkup` 的话它就漏出这道门禁，而门禁看起来照样绿）',
);
for (const cls of MUST_RENDER) {
  assert.ok(pageClasses.includes(cls), `★★ 产物里应当出现 \`.${cls}\`（这一格的界面被摘掉了？）`);
}
for (const cls of pageClasses) {
  assert.ok(
    hasCssRule(CSS, cls),
    `★★★ \`.${cls}\` 在 \`apps/web/src/styles.css\` 里没有规则 —— 这是一个**渲染得出来、但什么都不生效**的类名（§5.70）`,
  );
}
ok(
  `类名↔CSS：${String(pageClasses.length)} 个 \`tracked*\` / \`video-embed*\` 类名逐个有规则（收集自 ${String(products.length)} 份产物，匹配前已剥注释）`,
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
console.log('   · ⚠️★ 换分区那一条链路的**接线**（谁调用谁）同样一个都没断言：⑯ 证明的是');
console.log('     那两个**纯函数**的行为（认不出的值退化成「全部」、换分区删 `tpage`、');
console.log('     不碰 `platform` / `page`），而**页面有没有真的调它们**在静态渲染里看不出来');
console.log('     —— 把 `setTrackedPlatform` 改回自己写一份 `URLSearchParams`，⑯ 照样全绿。');
console.log('     同样看不见的还有两处：`fetchTrackedVideos` 在「全部」时**不拼** `?platform=`');
console.log('     （空串服务端是 400），以及**`trackedPlatform` 有没有进 `useAsync` 的依赖数组**');
console.log('     —— 漏了它 = 换分区列表不重新取数，而 ⑬ 那种静态断言看不见');
console.log('     （它只证明"给我这个 prop 画成什么样"）。');
console.log('   · **点击的结果**：SSR 的产物里没有事件处理器，一颗接好线的按钮与一颗');
console.log('     `onClick` 是 `undefined` 的按钮**长得一模一样** —— 这一层用的是运行时守卫');
console.log('     （`assertPropsGiven`），而"prop 忘了传"在**页面**那一侧是编译错误。');
console.log('   · **尺寸、配色与字体**：⑪ 只看类名在不在 `styles.css` 里，不看它长什么样。');
console.log('   · ⚠️ **层叠（谁盖住谁）**：⑫ 只证明封面的三样属性与"传了才有 `<img>`"——');
console.log('     封面与门面上那几格文字**谁画在上面**是 CSS 绘制顺序的事，静态产物里看不出来');
console.log(
  '     （要跑一个真浏览器）。今天那一条依赖写在 `styles.css` 的 `.video-embed__cover` 上。',
);
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
 * ⚠️ 2026-09-16 的**修复波**：⑫…⑮ 之后又加了 ⑯（分区参数的读写），两个数各 +1
 *    （14/15 ⇒ 15/16）。
 */
const expectedGroups = LANG === 'en' ? 16 : 15;
assert.equal(
  pass,
  expectedGroups,
  `探针：这一轮应当通过 ${String(expectedGroups)} 组（少了就说明有人把某一段摘掉了）`,
);
