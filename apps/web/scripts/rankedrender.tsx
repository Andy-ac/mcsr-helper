#!/usr/bin/env tsx
/**
 * Ranked 实时信息（`/ranked`）· 渲染自检 —— spec §11.3 的每一条，外加三件
 * **产物里根本看不出来**的事（直连请求选项、类名↔CSS、进度词条表）。
 *
 * 跑法（从仓库根）：
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:ranked
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:ranked -- --en
 *
 * ===========================================================================
 * 为什么渲染的是**四个视图**，不是 `/ranked` 那一页
 * ===========================================================================
 * 两条理由，第二条是硬的：
 *   1. `renderToStaticMarkup` **不跑 effect**（也不点击、不发请求），而容器
 *      `routes/Ranked.tsx` 自己取数、自己轮询 ⇒ 纯 SSR 下它永远停在"加载中"那一屏，
 *      写在容器里的任何一块都断言不到，而**不可能红**的守卫比没有守卫更坏
 *      （`docs/pending.md §5.63`；`components/RankedPanels.tsx` 文件头是同一句话）；
 *   2. ★★ **容器读 `window.location`**（`const origin = window.location.hostname`
 *      —— Twitch 的 `parent` 要它）⇒ 在 Node 里渲染容器**当场就崩**。
 * ⇒ 这里渲染 `components/RankedPanels.tsx` 里那四支纯视图 + 标签页，`origin`
 *   由本脚本**显式**喂（`ORIGIN`）。这正是"Twitch 必须带对 `parent`"那条
 *   **唯一静默失败**的规则（传错是拒播，不是报错）第一次真的被断言到的原因：
 *   视图里读 `location` 的话，每一个 Twitch 夹具都只会落到 `no_origin` 那一支。
 *
 * ===========================================================================
 * ⚠️★ 本文件**不会被类型检查**（这就是它必须自己盯着自己那几格 prop 的原因）
 * ===========================================================================
 * `apps/web/tsconfig.json` 的 `include` 是 `src/**`、`packages/ui/src/**`、`vite.config.ts`
 * —— **`scripts/**` 不在里面**。于是四支视图那些必填 prop（`onRetry` / `origin` /
 * `latestId` …）在**调用页面**上少一个是编译错误，到了这里却是**静默**的：
 * 少传一格，`onClick` 就是 `undefined`，而产物里那颗按钮与接好线的**长得一模一样**
 * （SSR 不渲染事件处理器）⇒ "入口在不在"那两条断言照样绿
 * （`scripts/sharerender.tsx` 的文件头记着这一栏上一轮的同一段来历）。
 * ⇒ 本脚本一道**运行时**守卫（`assertPropsGiven`，判据写在它自己的注释里）+ 一条
 *   "守卫自己必须能命中"的探针；另有 `assertClickable` 读 `disabled` 属性。
 *
 * ===========================================================================
 * ★★ ⑦ 那一节：直连请求的选项**只存在于函数被调用时**
 * ===========================================================================
 * `cache: 'no-store'` 不是优化，它是这一栏**能不能实时**的前提（上游那个主机回
 * `cache-control: max-age=14400`，见 `ranked/const.ts` 的实测记录）：不显式绕开的话，
 * 第二次请求可能**根本不发出去**，面板冻在 4 小时前那一份上，而 DevTools 里
 * **一条请求都没有**、控制台里一个字都没有 —— 本栏目最容易犯、也最难从画面上看出来的错。
 * ⇒ 本脚本用 `setUpstreamFetchForTests(记录器)` 把 fetch 换掉，逐格断言**实际传下去**
 *   的那几个选项与头，再断言"主入口网络失败 ⇒ 打兜底入口一次"与"主入口 500 ⇒ **不**重试"。
 * ⚠️⚠️ 整节**绝不碰真实网络**：断言之后 `setUpstreamFetchForTests(null)` 复位，
 *    而且整节期间 `globalThis.fetch` 是一个**会炸的哨兵**（任何一次漏出去的请求都会
 *    被记下来并当场抛出），最后逐条断言"哨兵一次都没被走到"。
 *
 * ===========================================================================
 * ★ ⑧ 类名 ↔ CSS：全仓没有第二处能发现这件事
 * ===========================================================================
 * `docs/pending.md §5.70`：本仓样式是全局的、没有 CSS Modules 兜底，而"渲染了一个
 * 不存在的类名"**没有任何门禁**看得见（`ShareForm` 里那个 `.mcsr-input` 笔误活过了两轮评审）。
 * ⇒ 把几个产物里出现的**所有** `class="…"` 收集起来、筛出 `ranked*` 的，
 *   逐个断言 `apps/web/src/styles.css` 里有 `.类名` 规则。这一条把 §5.70 在**本栏目内**关掉。
 * ⚠️ 判据要**整个类名相等**：`css.includes('.ranked__side')` 会被 `.ranked__side--right`
 *    **满足**（前者是后者的前缀）⇒ 一条本不存在的规则看起来"有"。边界处写死
 *    `(?![A-Za-z0-9_-])`，并配一条探针把这个坑钉下来。
 *
 * ===========================================================================
 * ★ ⑨ 进度词条表：`TIMELINE_LABEL_KEYS` 的价值全在"逐条都有"
 * ===========================================================================
 * `services/api/src/i18n-keys.test.ts` 扫的是源码里的**字面量** `t('…')` 调用，
 * 而这一栏有一批 key 是从**表**里取的（标签页那一张、`STATUS_KEYS`、
 * `WEEKLY_SEED_LABEL_KEYS`、`timeline.ts` 那一张）—— 表里少一条，界面上直接印出裸 key
 * 而**所有门禁全绿**（2026-09-16 的评审就是这样逐格量到四条标签页 key 两份字典里一条都没有的）。
 * ⇒ 本脚本对这几张表逐条查**两种语言**，并且给一个**不在表里**的标识，断言产物里出现的是
 *   **那个标识本身**（回落），而不是 `ranked.timeline.xxx`。
 *
 * 不用 JSX（`createElement`）：与 `sharerender.tsx` / `resourcerender.tsx` 同一条理由 ——
 * `scripts/**` 不在 include 里 ⇒ JSX 走 **classic runtime** ⇒ 必须 `import React from 'react'`，
 * 而 biome 的 `noUnusedImports` 会把它判成"未使用"并给一个**不安全自动修复**：
 * 谁点了那个修复，脚本就在运行时崩（`React is not defined`，指向第一处 JSX）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { SeedRecord } from '@mcsr/shared';
import { en, zhCN } from '@mcsr/shared/i18n';
import {
  displayWeekNo,
  RANKED_ELO_TOP,
  RANKED_FETCH_HEADERS,
  RANKED_FETCH_OPTIONS,
  RANKED_LIVE_BATCH,
  RANKED_STATUS_COMPONENTS,
  RANKED_TABS,
  RANKED_UPSTREAM_ALT,
  RANKED_UPSTREAM_PRIMARY,
  type RankedEloData,
  type RankedLiveData,
  type RankedLiveMatch,
  type RankedLivePlayer,
  type RankedMatch,
  type RankedPhaseData,
  type RankedPlayerDetail,
  type RankedStatusComponent,
  type RankedStatusResponse,
  type RankedTab,
  type RankedWeeklyData,
  TIMELINE_LABEL_KEYS,
  timelineLabel,
  weekPath,
} from '@mcsr/shared/ranked';
import i18n from 'i18next';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { emText } from '@/components/Emphasis';
import {
  MATCH_TYPE_KEYS,
  OUTCOME_KEYS,
  type RankedChromeProps,
  type RankedDetailState,
  RankedEloView,
  type RankedEloViewProps,
  RankedLiveView,
  type RankedLiveViewProps,
  type RankedLookup,
  type RankedSeedStates,
  RankedStatusView,
  type RankedStatusViewProps,
  RankedTabBar,
  type RankedTabBarProps,
  RankedWeeklyView,
  type RankedWeeklyViewProps,
  STATUS_KEYS,
  WEEK_INPUT_ERROR_KEYS,
} from '@/components/RankedPanels';
import { ApiError } from '@/lib/api';
import {
  fetchRankedElo,
  fetchRankedLive,
  fetchRankedPhase,
  fetchRankedWeekly,
  RankedDirectError,
  setUpstreamFetchForTests,
} from '@/lib/rankedDirect';
import { describeRankedError, RANKED_ERROR_KEYS } from '@/lib/rankedErrors';

const LANG = process.argv.includes('--en') ? 'en' : 'zh-CN';

await i18n.use(initReactI18next).init({
  lng: LANG,
  /*
   * ⚠️ `false` 而不是 `'zh-CN'`（与 `sharerender.tsx` 同一行、同一理由）：
   *    缺 en 词条时**原样返回 key**，于是 ⑩ 的裸 key 扫描能精确指出是哪一个 key。
   *    回退到中文的话，英文界面上冒出来的是中文，只能靠 ⑪ 的汉字扫描间接发现"某处漏了英文"。
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
 * ⚠️ ⑥b（失败那七格）与 ⑨（进度词条表）各要逐格查两种语言，两处共用这一个数组 ——
 *    各写一份的话，加第三种语言那天只会改到一处，而另一处的表现是"某个 key 只在一种语言里查过"。
 */
const LANGUAGES = ['zh-CN', 'en'] as const;

// ---------------------------------------------------------------------------
// 文本归一化与提取器（与 `sharerender.tsx` 同形、同一条纪律）
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
 * ⚠️ 它顺带走一遍 `emText()`（与 `em()` **同一条剥标记策略**，那两处的一致性由
 *    `scripts/authoringNotice.ts` 的探针守着）。理由：词条里的 `**强调**` 在产物里是
 *    `<strong>`，不剥标记的话**带标记的词条两个方向都会错**（"必须有这一句"假红；
 *    "不许出现这一句"恒真，因为针里带着星号）—— 那是 `docs/pending.md §5.63` 那一族。
 * ⚠️★ 本栏目的词条**今天一个 `**` 都没有**（spec §7 的冻结清单里没有强调标记），
 *    所以这一步现在是空操作；留着它是为了让"某天有人给这条文案加强调"时两个方向都还对。
 * ⚠️⚠️ 但"产物里没有字面 `**`"那条断言**不许**用它 —— 它必须作用在**原文**上（`rawText`），
 *    否则就是 §5.63 那个事故的逐字重演：规范化函数把要断言的东西擦掉了。
 */
const flat = (s: string): string => decode(emText(s)).replace(/\s+/g, '');
/** 原样的 HTML（只还原实体）：汉字扫描与 `**` 扫描要看**属性**，所以用这一份。 */
const rawText = (html: string): string => decode(html);
/** 一段 HTML 的可见文字（属性里的内容**不算** —— 要算就用 `rawText`）。 */
const textOf = (html: string): string => flat(html.replace(/<[^>]+>/g, ' '));
const hasText = (html: string, needle: string): boolean => textOf(html).includes(flat(needle));

/** 取词条并压平（比对用）—— 集中一处，免得每处都写一遍 `flat(t(...))`。 */
function fresh(key: string, opts?: Record<string, unknown>): string {
  return flat(t(key, opts));
}

/*
 * 探针：`flat` 必须**真的**把 `**` 剥掉，而且必须**只**剥掉标记本身
 * （被夹住的正文要留下）—— 否则上面那段注释说的两个方向都会错，而"剥没剥"
 * 在产物里看不出来（§5.63 要求给这类布尔断言配前置探针）。
 */
assert.notEqual(
  flat('a**b**c'),
  'a**b**c',
  '★ 探针：`flat` 必须剥掉 `**`（不然带标记的词条永远匹配不上）',
);
assert.equal(flat('a**b**c'), 'abc', '★ 探针：剥掉的是标记本身，被夹住的**正文**要留下');

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
 * 取出所有带这个 class 的元素的**外层 HTML**（自带简化的配对扫描）。
 *
 * ⚠️ 不用"非贪婪匹配到最近的 `</tag>`"：`<li class="ranked__match">` 里还嵌着
 *    `<p class="ranked__mid">`，那样截出来的是**内层**那一小段 —— 断言就在错误的
 *    字符串上做了。这类"看起来在断言 A、其实断言了 B"的写法正是 §5.63 那一族。
 */
function elementsWithClass(html: string, cls: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g)) {
    const open = m[0];
    const classes = (/\bclass="([^"]*)"/.exec(open)?.[1] ?? '').split(/\s+/);
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
 * ⚠️★ 本节**所有**断言都建立在 `elementsWithClass` 上，所以它自己有探针。
 *    没有这几条的话，下面那些"某一行里有/没有 X"可能全都作用在错误的片段上 ——
 *    那是 §5.63 那一族（看起来在断言 A，其实断言了 B），而**绿的样子完全一样**。
 */
const NESTED_FIXTURE =
  '<li class="ranked__match"><div class="ranked__mid">a</div><span>b</span></li>';
assert.equal(
  elementsWithClass(NESTED_FIXTURE, 'ranked__match').length,
  1,
  '★ 探针：class 要**整个词**相等 —— `ranked__matches` 不算 `ranked__match`',
);
assert.equal(
  elementsWithClass('<div class="ranked__matchx">z</div>', 'ranked__match').length,
  0,
  '★ 探针：**前缀相同**的更长的类名不算命中（否则"产物里有 X"会在别的东西上成立）',
);
assert.equal(
  textOf(elementsWithClass(NESTED_FIXTURE, 'ranked__match')[0] ?? ''),
  'ab',
  '★ 探针：取到的是**外层**元素（含里面那一层），不是"开头一小段"',
);
assert.equal(
  elementsWithClass(NESTED_FIXTURE, 'ranked__nosuchclass').length,
  0,
  '★ 探针：不存在的 class 一个都不许匹配（否则"产物里没有 X"恒假）',
);
assert.equal(
  textOf(elementsWithClass(NESTED_FIXTURE, 'ranked__mid')[0] ?? ''),
  'a',
  '★ 探针：同一个产物里按另一个 class 取也要取对',
);

/** 某个属性值（还原实体）。 */
const attrOf = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m === null ? null : decode(m[1] ?? '');
};

/** 某个元素的 `class` 属性（没有就回空串）。 */
const classOf = (tag: string): string => attrOf(tag, 'class') ?? '';

/**
 * 一个元素（一整段开标签，或 `buttons()` 给的那种属性串）上有没有这一格 class。
 *
 * ⚠️ 判据是"**整个词**相等"：`ranked__side` 不是 `ranked__side--right`。
 *    用 `includes` 的话，`--right` 那一半会被左边那一半"满足"，
 *    于是"右边带 `--right`"与"两边都带"分不开（这类都在 §5.63 那一族里）。
 */
const hasClassOf = (tag: string, cls: string): boolean => classOf(tag).split(/\s+/).includes(cls);

/** 产物里所有按钮的「属性串 + 可见文字」。 */
function buttons(html: string): { attrs: string; text: string }[] {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    attrs: m[1] ?? '',
    text: flat((m[2] ?? '').replace(/<[^>]+>/g, ' ')),
  }));
}

/*
 * ⚠️ `\bdisabled\b` 会**误判 `aria-disabled`**（`-` 与 `d` 之间是词边界），
 *    所以判据写成"这个词独立出现"，而不是"这个子串出现过"。
 */
const isDisabled = (attrs: string): boolean => /(?:^|\s)disabled(?:\s|=|$)/.test(attrs);

/** 产物里那几张 `.ranked__meta` 的可见文字（状况那一栏的四行度量就是这么排的）。 */
const metaOf = (html: string): string[] =>
  elementsWithClass(html, 'ranked__meta').map((el) => textOf(el));

/*
 * 产物里那一格 `.ranked__players` 的可见文字。
 *
 * ⚠️★ 2026-09-19 **第二轮**起，人数那一格从「大号数字 + 一句话」合并成**一句话**
 *    ⇒ 它不再是 `.ranked__meta` 那一档（那样 `metaOf` 会把它与四行读数混在一起，
 *    而"人数那句住在哪一格"正是这一轮改动**唯一**的结构性判据）。
 * ⚠️ 不把两者合并成一个"找出所有读数"的函数：它们回答的是两件事
 *    （一行度量 vs 那一块自己的读数），合并之后上面那句话就无从断言了。
 */
const playersOf = (html: string): string[] =>
  elementsWithClass(html, 'ranked__players').map((el) => textOf(el));

/** 产物里的「重试」按钮（`common.retry`，spec §7.3 明确不复用新写的一句）。 */
const retryButtons = (html: string): { attrs: string; text: string }[] =>
  buttons(html).filter((b) => b.text === flat(t('common.retry')));

/**
 * ★★ 「这个入口是**可点的**」—— 读 `disabled` 属性，而不是仅仅"入口在"。
 *
 * ⚠️ 为什么这条不是形式主义：这两个入口曾经是**可选 prop** + "缺省就把按钮禁掉"，
 *    于是"忘了接线"的表现是一颗**永远灰着的按钮**，而**所有门禁都绿**
 *    （渲染自检当时只看入口在不在，禁用也算在）。改成必填之后忘了传是**编译错误** ——
 *    但那道保护**罩不到本脚本**（`scripts/**` 不受类型检查，见文件头），
 *    所以"可点"这件事必须在这里由产物自己证明。
 * ⚠️ 探针：`busy: true` 的那几次渲染里同一颗按钮**必须**带 `disabled`
 *    （否则这个读取器是恒真的：永远读不到 disabled，就永远"可点"）。
 */
function assertClickable(html: string, label: string, where: string): string {
  const found = buttons(html).filter((b) => b.text === flat(label));
  assert.equal(
    found.length,
    1,
    `★★ ${where}：找不到唯一的「${label}」入口（找到 ${String(found.length)} 个）`,
  );
  assert.equal(
    isDisabled(found[0]?.attrs ?? ''),
    false,
    `★★ ${where}：「${label}」入口是 disabled 的 —— 它"在"，但按不动（那是本计划防过的一种静默失效）`,
  );
  return found[0]?.attrs ?? '';
}

/** `<details>` 的**开标签**（判断 `open` 时要只看它，不能扫整张卡片的正文）。 */
const detailsTagOf = (html: string): string => /<details\b[^>]*>/.exec(html)?.[0] ?? '';

/** `<summary>` 里的可见文字（展开键那句话）。 */
const summaryOf = (html: string): string => {
  const m = /<summary>([\s\S]*?)<\/summary>/.exec(html);
  return m === null ? '' : flat((m[1] ?? '').replace(/<[^>]+>/g, ' '));
};

// ---------------------------------------------------------------------------
// 渲染入口（**每个产物都被记下来**，⑧ 的类名收集与 ⑩ 的扫描都用这一份）
// ---------------------------------------------------------------------------

const products: string[] = [];

const render = (node: ReactElement): string => {
  const html = renderToStaticMarkup(
    createElement(I18nextProvider, { i18n }, createElement(MemoryRouter, null, node)),
  );
  products.push(html);
  return html;
};

// ---------------------------------------------------------------------------
// 夹具（秒数与所有可见文字都来自夹具；⚠️ 夹具里的字符串**一律 ASCII**）
// ---------------------------------------------------------------------------
/*
 * ⚠️ 夹具里的**每一个字符串都是 ASCII**：⑪ 英文那一遍会扫描产物里的汉字，
 *    中文夹具会让扫描把夹具本身当成泄漏（"英文界面里冒出了中文"）。
 * ⚠️ 视图**不读时钟**（`RankedPanels.tsx` 文件头写着这一条）：`updatedAgoSecs` /
 *    `staleSecs` 都是容器算好传进来的**数字**，所以这里没有 `Date.now()`、也没有
 *    `nowMs` —— 有的话"这份数据有多旧"就只能靠人眼看，而那正是这一栏最要紧的数字。
 */
const UPDATED = 7; // 「7 秒前更新」
const STALE = 42; // 「上次刷新失败了，下面是 42 秒前的数据。」
const PLAYERS = 1234;
const ORIGIN = 'mcsrhelper.com'; // 容器给的是 `window.location.hostname`；这里是它的替身

const TWITCH = 'https://twitch.tv/hufterl';
const KICK = 'https://kick.com/whyip';
const UNKNOWN_TYPE = 'future.brand_new_node'; // ★ 不在 `TIMELINE_LABEL_KEYS` 里

/*
 * ---------------------------------------------------------------------------
 * ① 状态栏那**四格**（2026-09-19 用户裁决：只留四行 + 在线人数）
 * ---------------------------------------------------------------------------
 * ⚠️★ 四个 id 与四个名字 key 是**手抄的**（与 `RANKED_STATUS_COMPONENTS` 那张表逐字对应）：
 *    表里的值对 `services/api/src/i18n-keys.test.ts` 是看不见的（它扫源码里的字面量
 *    `t('…')` 调用），所以"四行都在、而且各印各的名字"这件事只有这里能断言。
 *    表改了而这里没跟上 ⇒ 下面那条 deepEqual 当场红（那正是它该有的代价）。
 * ⚠️ 四格的时间**不是四个互不相同的值**（这是照实测抄的，不是笔误）：第 1 格与第 3 格
 *    都是 `11:16:27` —— 上游 monitor 2 与 monitor 4 那一刻的节拍就落在同一秒上；
 *    另两格是 `11:18:07`（第 2 格）与 `11:16:28`（第 4 格）。
 *    ⇒ 夹具证明的是"格与格之间有**可分辨的差别**"，而不是"两两不等"：
 *    一个"把同一串时间印在四行上"的实现，无论抄的是哪一串都会红
 *    （抄 `11:16:27` 在第 2 / 第 4 行红，抄另两串则在第 1 / 第 3 行红）；
 *    把第 1 格与第 3 格**对调**同样会红（这两格的值必须相等才蒙得过去）。
 *    ⚠️ 反过来说，把夹具改成"四个都不一样"会让它替上游断言一件不存在的事。
 * ⚠️ 四个状态也刻意不同（1/1/2/3）：一枚"永远印正常"的徽章实现会红。
 */
const COMPONENT_IDS = ['2', '3', '4', '5'] as const;
const COMPONENT_NAME_KEYS = [
  'ranked.componentGameServer',
  'ranked.componentApi',
  'ranked.componentStore',
  'ranked.componentWiki',
] as const;
const COMPONENT_TIMES = [
  '2026-09-17 11:16:27',
  '2026-09-17 11:18:07',
  '2026-09-17 11:16:27',
  '2026-09-17 11:16:28',
];
const COMPONENT_STATES = [1, 1, 2, 3] as const;

/** ① 四格里的一格；`state` / `checkedAt` 都可以逐格换掉（缺格那一档就是 `null`）。 */
function component(
  index: 0 | 1 | 2 | 3,
  o: Partial<RankedStatusComponent> = {},
): RankedStatusComponent {
  return {
    id: COMPONENT_IDS[index],
    nameKey: COMPONENT_NAME_KEYS[index],
    state: COMPONENT_STATES[index],
    checkedAt: COMPONENT_TIMES[index],
    ...o,
  };
}

/** ① 的心跳响应（我们那个端点的形状）。`stale` 与四格都可以整份换掉。 */
function status(
  o: { components?: RankedStatusComponent[]; stale?: boolean } = {},
): RankedStatusResponse {
  return {
    components: [component(0), component(1), component(2), component(3)],
    serverNow: 1_789_430_400_000,
    fetchedAt: 1_789_430_400_000,
    stale: false,
    ...o,
  };
}

/** 对局里的一侧。没写到的格子一律 `null`（形状里"表达得出不知道"就是 `null`）。 */
function player(o: Partial<RankedLivePlayer> = {}): RankedLivePlayer {
  return {
    nickname: null,
    eloRate: null,
    eloRank: null,
    timelineType: null,
    timelineTime: null,
    liveUrl: null,
    livePlatform: null,
    ...o,
  };
}

/**
 * 一场对局。`avgElo` 按形状的契约算（非 null 平均；都 null 就是 null）——
 * ⚠️ 算在这里而不是让视图去算：视图**只排序、不算平均**（`select.ts` 的文件头）。
 */
function matchOf(
  key: string,
  currentTime: number,
  left: RankedLivePlayer,
  right: RankedLivePlayer,
): RankedLiveMatch {
  const rates = [left.eloRate, right.eloRate].filter((n): n is number => n !== null);
  return {
    key,
    currentTime,
    avgElo: rates.length === 0 ? null : rates.reduce((a, b) => a + b, 0) / rates.length,
    players: [left, right],
  };
}

/** 卡片甲：两侧五个字段**都**有值；左 1658 > 右 1656（"elo 高的在左"的夹具前提）。 */
const CARD_BOTH = matchOf(
  'a|b',
  918_454, // ⇒ 「已进行 15:18」
  player({
    nickname: 'HufterL',
    eloRate: 1658,
    eloRank: 161,
    timelineType: 'nether.find_bastion',
    timelineTime: 141_000, // ⇒ 2:21
    liveUrl: TWITCH,
    livePlatform: 'twitch',
  }),
  player({
    nickname: 'WhyIP',
    eloRate: 1656,
    eloRank: 163,
    timelineType: 'story.enter_the_end',
    timelineTime: 750_000, // ⇒ 12:30
  }),
);

/**
 * 卡片乙：左侧**只有两格是 `null`**（`eloRank` 与 `timelineType`），另外三格有真值。
 * ⚠️ 这样写是为了让"null ⇒ `—`"那两条**孤立**：整半边都空的话，"印了 `—`"与
 *    "整个半边没渲染"在产物上分不出来（而后者才是真缺陷）。
 * 右侧是**五个字段全 `null`** 的空位（形状里"上游只给了一个玩家"那一档）。
 */
const CARD_NULLS = matchOf(
  'c|d',
  200_000, // ⇒ 「已进行 3:20」
  player({ nickname: 'Ghost', eloRate: 1400, timelineTime: 45_000 }), // 1400 / — / — / 0:45
  player(),
);

/** 卡片丙：左边是 **kick**（认不出的平台）⇒ 那一侧走外链 + 一句「不能内嵌」。 */
const CARD_KICK = matchOf(
  'e|f',
  245_000,
  player({
    nickname: 'Kicky',
    eloRate: 1200,
    eloRank: 900,
    timelineType: 'story.root',
    timelineTime: 0, // ★ 真的 0 毫秒 ⇒ 印 0:00（**不是**占位符：0 是一个真值）
    liveUrl: KICK,
  }),
  player({
    nickname: 'Quiet',
    eloRate: 1180,
    eloRank: 950,
    timelineType: 'nether.find_fortress',
    timelineTime: 95_000,
  }),
);

/** 卡片丁：整张卡片**一个 `liveUrl` 都没有** ⇒ 连展开键都不渲染（评分最高那一场）。 */
const CARD_NO_STREAM = matchOf(
  'g|h',
  30_000, // ⇒ 「已进行 0:30」
  player({
    nickname: 'Nostream',
    eloRate: 2400,
    eloRank: 1,
    timelineType: 'end.kill_dragon',
    timelineTime: 250_000,
  }),
  player({
    nickname: 'Alsonone',
    eloRate: 2400,
    eloRank: 2,
    timelineType: 'end.enter_end_portal',
    timelineTime: 240_000,
  }),
);

const LIVE_DATA: RankedLiveData = {
  players: PLAYERS,
  /*
   * ⚠️★ 入参顺序是**打乱**的：平均分最高的那一场（丁，2400）在**最后**。
   *    照顺序渲染的话下面"按 avgElo 降序"那条断言就是空跑。
   *    期望的产物顺序：丁(2400) → 甲(1657) → 乙(1400) → 丙(1190)。
   */
  matches: [CARD_BOTH, CARD_KICK, CARD_NULLS, CARD_NO_STREAM],
};

/** 「上游给了空集合」那一档。 */
const LIVE_EMPTY: RankedLiveData = { players: 0, matches: [] };

/**
 * 12 场 ⇒ 视图**全给**（约一批的一半），而那句 total 说的是 12。
 * ⚠️★ 这一份夹具在 2026-09-19 之前是用来钉"**只渲染前 10**"的：现在截断没了
 *    （用户要求全部展示），它反过来钉"**12 场一张都不许少**" —— 12 > 旧的 10，
 *    所以把截断改回来的那一刻，下面那条断言会当场红。
 */
const LIVE_MANY: RankedLiveData = {
  players: PLAYERS,
  matches: Array.from({ length: 12 }, (_, i) =>
    matchOf(
      `m${String(i)}|n${String(i)}`,
      60_000 + i,
      player({
        nickname: `P${String(i)}A`,
        eloRate: 1000 + i * 10,
        eloRank: 100 + i,
        timelineType: 'story.root',
        timelineTime: 1000 * i,
      }),
      player({ nickname: `P${String(i)}B`, eloRate: 1000 + i * 10, eloRank: 200 + i }),
    ),
  ).reverse(),
};

/**
 * ★★ ③b 的筛选夹具（2026-09-19）：三场覆盖"双方都在直播 / 只有一方在直播 / 两人都没直播"。
 *
 * ⚠️★ `LIVE_DATA` 那四场里**没有一场是双方都在直播的**（上游实测里这种对局本来就少），
 *    所以"只看双方都在直播"这条判据的**正例**必须在这里造一场 —— 只有反例的话，
 *    一个"永远返回 false"的实现也能把"开关打开后一场都不剩"那几条断言喂绿。
 * ⚠️ 正例右侧用的是 **kick**（认不出的平台 ⇒ `livePlatform: null`）：判据是 `liveUrl`
 *    非 null，**不是**平台白名单（用户 2026-09-19 的裁决：任何平台都算）。
 *    拿 `livePlatform` 当判据的实现会把这一场藏掉 ⇒ 下面那条断言当场红。
 * ⚠️ 昵称刻意取成大小写混合、且**互不为子串**（`StreamerA` / `StreamerB` / `SoloC` /
 *    `PlainD` / `OfflineE` / `OfflineF`）：搜索那几条断言靠的是"只命中一场"，
 *    一个名字套另一个名字的话，命中的场次数就对不上了。
 */
const LIVE_FILTER: RankedLiveData = {
  players: PLAYERS,
  matches: [
    /* 双方都在直播：左 Twitch、右 kick（后者 `livePlatform` 是 null，见上面那条）。 */
    matchOf(
      's1|s2',
      90_000,
      player({
        nickname: 'StreamerA',
        eloRate: 2100,
        eloRank: 300,
        liveUrl: TWITCH,
        livePlatform: 'twitch',
      }),
      player({ nickname: 'StreamerB', eloRate: 2050, eloRank: 310, liveUrl: KICK }),
    ),
    /* 只有**左边**在直播 ⇒ 「双方都直播」必须把它藏掉。 */
    matchOf(
      's3|s4',
      80_000,
      player({
        nickname: 'SoloC',
        eloRate: 2000,
        eloRank: 400,
        liveUrl: TWITCH,
        livePlatform: 'twitch',
      }),
      player({ nickname: 'PlainD', eloRate: 1950, eloRank: 410 }),
    ),
    /* 两人都没直播。 */
    matchOf(
      's5|s6',
      70_000,
      player({ nickname: 'OfflineE', eloRate: 1900, eloRank: 500 }),
      player({ nickname: 'OfflineF', eloRate: 1850, eloRank: 510 }),
    ),
  ],
};

/** ⑨ 的产品那一半：一个**不在表里**的标识 + 一个在表里的（正向对照）。 */
const LIVE_UNKNOWN: RankedLiveData = {
  players: PLAYERS,
  matches: [
    matchOf(
      'k|l',
      12_000,
      player({
        nickname: 'Future',
        eloRate: 1500,
        eloRank: 400,
        timelineType: UNKNOWN_TYPE,
        timelineTime: 5000,
      }),
      player({
        nickname: 'Known',
        eloRate: 1400,
        eloRank: 500,
        timelineType: 'end.kill_dragon',
        timelineTime: 6000,
      }),
    ),
  ],
};

/* ③ 的赛季与榜单。⚠️ `startsAt` / `endsAt` 是**秒**（spec §13 的时间单位表）。 */
const ELO_SEASON = { number: 12, startsAt: 1_789_430_400, endsAt: 1_798_588_800 };
const ELO_USERS: RankedEloData['users'] = [
  { rank: 1, nickname: 'Alpha', eloRate: 2450, highest: 2500, phasePoint: 12 },
  { rank: 2, nickname: 'Bravo', eloRate: 2400, highest: null, phasePoint: 9 }, // highest 缺失 ⇒ —
  { rank: 3, nickname: 'Charlie', eloRate: 2350, highest: 2400, phasePoint: 0 }, // 0 是真值
  { rank: 3, nickname: 'Delta', eloRate: 2350, highest: 2399, phasePoint: 4 }, // ★ 并列第 3
  { rank: 5, nickname: 'Echo', eloRate: 2300, highest: 2350, phasePoint: 1 }, // 跳号：没有第 4 名
];
/*
 * ★ 赛段（`/phase-leaderboard` 那一次 93 字节的请求给的）—— 用户要的那一格"并排"。
 * ⚠️ `endsAt` 是**秒**（与赛季起止同一条单位规矩），实测的值是 2026-09-30T00:00:00Z。
 */
const ELO_PHASE: RankedPhaseData = { number: 1, endsAt: 1_790_726_400, season: 12 };
const ELO_DATA: RankedEloData = { season: ELO_SEASON, users: ELO_USERS };
const ELO_EMPTY: RankedEloData = { season: ELO_SEASON, users: [] };
/**
 * 160 条 ⇒ 视图只渲染前 150（`RANKED_ELO_TOP`，2026-09-19 用户口径）。
 * ⚠️ 上游实测**就是** 150 条（`count` / `page` 被它静默忽略）⇒ 这份"160 条"的夹具
 * 钉的是**上界**那一半：上游哪天给得更多时，表格的长度由那个常量说了算。
 * ⚠️ 那个数从 105 改到 160 是**有意的**：105 条配 100 的上限在旧版能红，
 *    而它配新的 150 就变成一条**空跑**的断言（105 < 150，什么都截不到）。
 */
const ELO_MANY: RankedEloData = {
  season: ELO_SEASON,
  users: Array.from({ length: 160 }, (_, i) => ({
    rank: i + 1,
    nickname: `U${String(i)}`,
    eloRate: 2000 - i,
    highest: 2100,
    phasePoint: i,
  })),
};

/*
 * ===========================================================================
 * ★★ ④b 的夹具（2026-09-19 第三轮，`c70bb3f` 的视图）：③ 的搜索框 + 行内展开
 * ===========================================================================
 * ⚠️ 这里的字符串**全是 ASCII**：`--en` 那一遍会扫描产物里的汉字（⑪），
 *    中文夹具会被它当成"英文界面上冒出了中文"。
 * ⚠️★ 本脚本喂的是**已经解析好的形状**（`RankedEloData` / `RankedMatch` 字面量），
 *    不是上游的原始响应 —— 所以"解析层永远产不出来"的东西在这里**到得了**：
 *    下面第 4 场那个"`selfUuid` 不在 `players[]` 里"的行，`parseMatches` 会把它丢掉
 *    （`types.ts` 的 `matchOutcome` 上写着），而它是
 *    `ranked__detailoutcome--unknown` 与 `ranked.outcomeUnknown` 这两条
 *    **今天唯一的消费者**（少了它，那份 CSS 规则与那条词条一条门禁都盖不到，
 *    而 §5.70 那一族"渲染得出来却没有规则 / 有规则却没有渲染点"正是这么长出来的）。
 */

/**
 * ★ ② 筛选的夹具：**四行**，其中两位昵称共享前缀 `Alpha`。
 *
 * ⚠️★ 为什么非要"四行 + 两位共享前缀"：下面的判据是**行数**与**每行的昵称**。
 *    只有一个命中项时，"筛对了"与"筛过头了只剩一个"分不开；四行里命中两行 ⇒ `2` 这个数
 *    与"没筛"（4）和"筛没了"（0）都不同，一个"永远印整张榜"或"永远印一行"的实现会当场红。
 * ⚠️ 这四位**不在** `ELO_USERS` 里：那一份的四条既有断言（并列 `3,3,5`、`highest` 缺失…）
 *    一个字都不许动 ⇒ 这里另起一份夹具，而不是往既有那份里塞人。
 */
const ELO_SEARCH: RankedEloData = {
  season: ELO_SEASON,
  users: [
    { rank: 1, nickname: 'Alpha', eloRate: 2450, highest: 2500, phasePoint: 12 },
    { rank: 2, nickname: 'AlphaTwo', eloRate: 2400, highest: null, phasePoint: 9 },
    { rank: 3, nickname: 'Bravo', eloRate: 2350, highest: 2400, phasePoint: 0 },
    { rank: 4, nickname: 'Charlie', eloRate: 2300, highest: 2350, phasePoint: 1 },
  ],
};

/*
 * 展开那一位的**两个 uuid**：判据（谁赢了 / 对手是谁 / 涨跌多少）全部以 `selfUuid` 为轴
 * （`select.ts` 那三个纯函数的第一条判据），所以它们必须是**稳定的一组**，
 * 而不是每场各写一遍。
 */
const ELO_SELF_UUID = '635f35ee69ed4f0c94ff26ece4818956';
const ELO_RIVAL_UUID = '817a3f2e92da42ab89c64a787ce16d28';
const ELO_THIRD_UUID = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';

/**
 * ★★ 那条红线的**哨兵**：`players[].eloRate` 是**请求那一刻的现值**，
 * 不是那一场当时的值（findings §2.1 底部三场实测）。
 *
 * ⚠️ 取一个"不可能出现在别处"的数：下面那条断言是"整个产物里**一个字符都没有**它"——
 *    借用一个夹具里到处都是的数（比如 2349）会让那条断言**恒假**（它自己就把哨兵印出来了），
 *    而恒假的守卫比没有守卫更坏（`docs/pending.md §5.63`）。
 */
const ELO_PRESENT_SENTINEL = 987654;

/**
 * ★ 一场比赛（展开那一栏的夹具工厂）。
 * ⚠️★ 两位玩家的 `eloRate` **都是**哨兵：红线管的不只是"对手那一格" ——
 *    把**自己**的现值印进某一行同样是错的（"他现在多少分"只该出现在卡片第一行那个 elo 里）。
 * ⚠️ `changes[].eloRate`（赛后值）**刻意不是**哨兵：详情里印的是 `change`（涨跌量），
 *    两者是不同的字段，让它们同值会让一条断言同时管两件不同的事。
 * ⚠️ 两格种子、`vod`、`result`、`changes` 都可以整格换掉：下面四场各缺一样东西。
 */
function eloMatch(id: number, o: Partial<RankedMatch> = {}): RankedMatch {
  return {
    id,
    type: 2,
    season: 12,
    date: 1_789_242_779,
    players: [
      { uuid: ELO_SELF_UUID, nickname: 'edcr', eloRate: ELO_PRESENT_SENTINEL, eloRank: 1 },
      { uuid: ELO_RIVAL_UUID, nickname: 'Voxio', eloRate: ELO_PRESENT_SENTINEL, eloRank: 86 },
    ],
    result: { uuid: ELO_SELF_UUID, time: 387_772 }, // ⇒ 6:27.772（毫秒）
    forfeited: false,
    changes: [
      { uuid: ELO_SELF_UUID, change: 12, eloRate: 2361 },
      { uuid: ELO_RIVAL_UUID, change: -12, eloRate: 1745 },
    ],
    vod: [],
    seedType: 'DESERT_TEMPLE',
    bastionType: 'STABLES',
    ...o,
  };
}

/*
 * ★★ 四场比赛 —— 四种**结果**与四种**比赛类型**各一次（附录 B.5 的要求）。
 * ⚠️ 顺序就是产物里的顺序（下面那些逐格断言按**下标**比，所以顺序本身也是判据的一部分）。
 * ⚠️ 结果与类型**不是**一一对应的（胜↔排位、平↔休闲、负↔私人房、读不到↔活动）：
 *    一一对应的话，"结果那一格"与"类型那一格"互换了都能蒙过去。
 */
/** ① 胜（`result.uuid` 是他自己）+ 排位赛（type 2）+ 有涨跌 + 无录像 + 两个种子都在。 */
const ELO_MATCH_WIN = eloMatch(13_279_218);
/** ② 平（`result.uuid: null` —— 上游的写法，实测 3/100 行）+ 休闲（type 1）+ 跌 8 分 + **有**录像。 */
const ELO_MATCH_DRAW = eloMatch(13_304_036, {
  type: 1,
  result: { uuid: null, time: 515_686 }, // ⇒ 8:35.686
  changes: [{ uuid: ELO_SELF_UUID, change: -8, eloRate: 2341 }],
  vod: [{ uuid: ELO_RIVAL_UUID, url: 'https://www.twitch.tv/videos/1', startsAt: 1_789_242_700 }],
});
/**
 * ③ 负（`result.uuid` 是**对手**）+ 私人房（type 3）+ `changes: []` + 两个种子都 `null`。
 * ⚠️ 这一场就是"那一格印 `—`、绝不印 `0`"的正例：私人房的 `changes[]` 实测恒为空数组
 *    （32/32 行），而 `0` 的意思是"打了这一场、分数没变"—— 那是一句我们并不知道的话。
 */
const ELO_MATCH_PRIVATE = eloMatch(13_304_815, {
  type: 3,
  result: { uuid: ELO_RIVAL_UUID, time: 400_000 }, // ⇒ 6:40.000
  changes: [],
  seedType: null,
  bastionType: null,
  vod: [{ uuid: ELO_RIVAL_UUID, url: 'https://www.twitch.tv/videos/2', startsAt: 1_789_242_800 }],
});
/**
 * ★★ ④ 读不到（`selfUuid` **不在** `players[]` 里）+ 活动（type 4）—— 这一档**解析层产不出来**
 *    （`parseMatches` 会把这一行丢掉），只有手写的 `RankedMatch` 到得了它。
 *
 * ⚠️★ 为什么非要造它（本简报附录 B.4）：`ranked__detailoutcome--unknown` 有 CSS 规则、
 *    `ranked.outcomeUnknown` 有词条，而今天**没有任何夹具**能走到那一档 ⇒
 *    这一条规则与这一条词条是"两条没人验过的死代码"。判据必须是"他不在场 ⇒ 不编一句话"：
 *    一个把兜底写成「负」的实现会在这里印出**一个假的败场**（而假的败场看起来完全正常）。
 * ⚠️ `changes` 也跟着空：他不在 `players[]` 里却在 `changes[]` 里有记录，是一份自相矛盾的夹具。
 */
const ELO_MATCH_UNKNOWN = eloMatch(13_312_001, {
  type: 4,
  players: [
    { uuid: ELO_RIVAL_UUID, nickname: 'Voxio', eloRate: ELO_PRESENT_SENTINEL, eloRank: 86 },
    { uuid: ELO_THIRD_UUID, nickname: 'Thirdo', eloRate: ELO_PRESENT_SENTINEL, eloRank: 87 },
  ],
  result: { uuid: ELO_RIVAL_UUID, time: 61_000 }, // ⇒ 1:01.000
  changes: [],
});

/**
 * ★★ **第五种**比赛类型（`type: 5`，上游哪天加的那一种）——
 * `MATCH_TYPE_KEYS[5]` 是 `undefined`，视图必须印**上游那个数字**原样。
 *
 * ⚠️★ 这一档**任何合法夹具都到不了**（那张表里今天只有 1..4，`rankedrender` 与解析层都
 *    产不出第五种）⇒ 只能手写一场，办法与上面第 4 场那个"他不在 `players[]` 里"同一个：
 *    本脚本喂的是**已经解析好的形状**，"解析层产不出来"不等于"视图层到不了"。
 * ⚠️ 它**不进 `ELO_MATCHES`**：那一份的七条逐值断言（对手/结果/用时/elo/类型/种子/录像）
 *    全部按**下标**比，往里塞第五场会让那七条一起红在自己的夹具上。
 * ⚠️ 两个 `eloRate` 照旧是哨兵（红线那一条扫的是**整个产物**，这一屏也算数）。
 */
const ELO_MATCH_TYPE_UNKNOWN = eloMatch(13_312_002, { type: 5 });

/** 展开出来的四场（顺序 = 产物里的顺序，逐格断言按下标比）。 */
const ELO_MATCHES: RankedMatch[] = [
  ELO_MATCH_WIN,
  ELO_MATCH_DRAW,
  ELO_MATCH_PRIVATE,
  ELO_MATCH_UNKNOWN,
];

/**
 * 展开那一位的汇总（`/users/{id}` 那份）。
 * ⚠️ 这几格全给真值：下面要逐格断言"这一格印的是**它自己**那个数"，缺一格的话
 *    那一条只能断言「—」（那与"没渲染"分不开）。
 * ⚠️ `season.bestTimeMs` 是**毫秒**（上游给的就是毫秒：387772 = 6:27.772）。
 * ⚠️★ 这里**有** `seasonHighest` 与 `seasonPhasePoint`（2026-09-19 第四轮加回来/新增）：
 *    上面那段"没有 `seasonHighest`"的说明是**修复轮（T4）当期**的事实，而这一轮它**有了**
 *    渲染点 —— 查到的玩家成了表格里的第一行，第四列「最高」印的就是它，
 *    第五列「阶段分」印的是 `seasonPhasePoint`。
 *    ⚠️ 这两格**只**服务表格那两列：卡片那五格读数**不**印它们（两处混用会让"卡片有几格"漂）。
 *    ⚠️ 四个数（1 / 2349 / 2385 / 0）**互不相同**、昵称也另是一串：五格逐格断言要能发现
 *    "格与格串位"，同值的话那种实现照样绿（与 `ELO_SEARCH` 那两位共享前缀同一条纪律）。
 *    ⚠️ `seasonPhasePoint: 0` 是**照实测**的（账本 `ranked-round4/progress.md`：
 *    `edcr` 的 `seasonResult.last.phasePoint` 实测就是 **0**）⇒ 这一行同时钉着
 *    "0 印 0、**不是**占位符"（榜上那一档由 `Charlie` 那行钉着）。
 */
const ELO_DETAIL_USER: RankedPlayerDetail = {
  uuid: ELO_SELF_UUID,
  nickname: 'edcr',
  eloRate: 2349,
  eloRank: 1,
  seasonHighest: 2385,
  seasonPhasePoint: 0,
  season: { wins: 96, loses: 12, playedMatches: 108, bestTimeMs: 387_772 },
  total: { wins: 800, loses: 700, playedMatches: 1500, bestTimeMs: 361_000 },
};

/** 「展开成功、四场比赛」那一屏（判据③ 与 ④、⑤ 都用它）。 */
const ELO_DETAIL_READY: RankedDetailState = {
  kind: 'ready',
  data: { user: ELO_DETAIL_USER, matches: ELO_MATCHES },
};

/**
 * 判据① 的夹具：展开的那一位**就在表里**（`ELO_DATA` 的第 2 名是 `Bravo`）。
 * ⚠️ `data.user` 的昵称也跟着换成 `Bravo`（uuid 不动）：真实数据里 `detail.nickname`
 *    与 `data.user.nickname` 是**同一个人**，让它们不一致等于让这份夹具替视图断言
 *    一件不会发生的事。
 */
const ELO_READY_BRAVO: RankedDetailState = {
  kind: 'ready',
  data: { user: { ...ELO_DETAIL_USER, nickname: 'Bravo' }, matches: [ELO_MATCH_WIN] },
};

/** 判据② 的夹具：查询**命中**的就是他（`lookup.user.nickname === detail.nickname`）。 */
const ELO_LOOKUP_FOUND: RankedLookup = { kind: 'found', user: ELO_DETAIL_USER };
/** 三档里另外两档（它们**不是**"请求失败"，所以没有重试、也不清空榜）。 */
const ELO_LOOKUP_NOT_FOUND: RankedLookup = { kind: 'not_found' };
const ELO_LOOKUP_INVALID: RankedLookup = { kind: 'invalid_identifier' };

/**
 * ⚠️ 响应的昵称是 **`Edcr`**（首字母大写）：上游回的是**规范写法**（findings §6 最后一段，
 *    `/users/voxio` 回 `Voxio`）⇒ 这一条能把"印**响应里**那个昵称"与"印用户敲进去那串"
 *    分开 —— 后者是一个看起来完全正常的实现（两种写法都是真的，只是有一个不属于这一刻）。
 */
const ELO_LOOKUP_CASED: RankedLookup = {
  kind: 'found',
  user: { ...ELO_DETAIL_USER, nickname: 'Edcr' },
};

/*
 * ===========================================================================
 * ★★ 第四轮：每一场比赛那三格种子（`seeds` / `onToggleSeed`）的夹具
 * ===========================================================================
 * ⚠️ 键是**字符串**（`RankedSeedStates` 的类型注释写着为什么）：JS 对象的键只能是字符串，
 *    而视图那一侧查表时写的是 `String(match.id)` —— 一边写一边不写，表现是"点了按钮
 *    什么都不出现"（查表永远落空），每一格都合法、没有任何报错。这里就用 `String()`。
 * ⚠️ 那一场的 id 用**实测的那一场**（`13304815`：账本 `ranked-round4/progress.md` 里
 *    `GET /api/ranked-seeds/match/13304815` 那一条 200 就是它）—— 它正好是
 *    `ELO_MATCH_PRIVATE`（三场夹具里的第 3 场）。
 */
const ELO_SEED_MATCH_ID = 13_304_815;
const ELO_SEED_KEY = String(ELO_SEED_MATCH_ID);
/**
 * 一份 `SeedRecord`（形状照账本里那次实测的 200）。
 * ⚠️ `matchDate` 是**毫秒**（实测 1789242779323）—— 这一轮**不印**它，但形状照实。
 * ⚠️★ 三个值**必须互不相同**，否则"第 3 格印的是第 1 格"这件事测不出来
 *    （与 `ELO_SEARCH` 那两位共享前缀、`ELO_DETAIL_USER` 那五格互不相同是同一条纪律）。
 *    ⚠️ 而实测里 `theEndSeed` 与 `overworldSeed` **恰好同值** ⇒ 这里把末地那一格
 *    换成另一个 19 位串。三个值都必须是**长数字串**：短值上"被当成数字格式化"那类错
 *    根本不会现形（`Number()` 只对超过 2^53 的整数丢精度）。
 */
const ELO_SEED: SeedRecord = {
  matchId: ELO_SEED_MATCH_ID,
  matchDate: 1_789_242_779_323,
  overworldSeed: '8813544817493859226', // 实测值（19 位，超过 2^53）
  netherSeed: '234370381031116', // 实测值
  theEndSeed: '7777777777777777777', // ⚠️ 实测与主世界同值 ⇒ 换成另一个 19 位值
};
/** `ready`（三格都有值）。 */
const ELO_SEEDS_READY: RankedSeedStates = {
  [ELO_SEED_KEY]: { kind: 'ready', seed: ELO_SEED },
};
/** `ready` 而末地那一格是 `null`（上游的形状就是可空的）⇒ 那一格印「—」。 */
const ELO_SEEDS_THE_END_NULL: RankedSeedStates = {
  [ELO_SEED_KEY]: { kind: 'ready', seed: { ...ELO_SEED, theEndSeed: null } },
};
const ELO_SEEDS_LOADING: RankedSeedStates = { [ELO_SEED_KEY]: { kind: 'loading' } };
const ELO_SEEDS_NOT_FOUND: RankedSeedStates = { [ELO_SEED_KEY]: { kind: 'not_found' } };
const ELO_SEEDS_FAILED: RankedSeedStates = { [ELO_SEED_KEY]: { kind: 'failed' } };

const WEEK_SEED = {
  overworld: '1234567890123456789',
  nether: '-4815162342',
  theEnd: '7777777777777777777',
  rng: '424242424242424242',
};
const WEEK_ENTRIES: RankedWeeklyData['entries'] = [
  { rank: 1, nickname: 'Speedo', timeMs: 244_241, eloRate: 2100, eloRank: 50 }, // ⇒ 4:04.241
  { rank: 2, nickname: 'Runner', timeMs: 3_600_000, eloRate: null, eloRank: null }, // ⇒ 1:00:00
];
const LATEST_ID = 103;
/** 本周（id 用**响应里**那个；这里就是 103）。 */
const week = (id: number): RankedWeeklyData => ({
  id,
  endsAt: 1_798_588_800,
  seed: WEEK_SEED,
  entries: WEEK_ENTRIES,
});
const WEEK_LAST = week(LATEST_ID);
/** ★ 上游把「第 0 周」记成 `-1`（唯一的负周）—— 它也是最早的一页。 */
const WEEK_ZERO = week(-1);
/** 第 1 周：`prevWeekId(1) === -1`（跨过 0）⇒「上一周」是链接。 */
const WEEK_ONE = week(1);

// ---------------------------------------------------------------------------
// 必填 prop 的**运行时**守卫（`scripts/**` 不受类型检查 —— 见文件头）
// ---------------------------------------------------------------------------

const CHROME_KEYS = ['errorText', 'staleSecs', 'updatedAgoSecs', 'busy', 'onRetry'] as const;
const VIEW_KEYS = {
  status: ['status', 'players'],
  /*
   * ⚠️★ 2026-09-19 加的六格是 ② 的筛选条与分批（`RankedLiveViewProps` 上写着它们为什么
   *    是 props 而不是视图里的 state：状态住在视图里的话，本脚本**只能**看到初始值，
   *    "筛出一场"「双方都直播只剩那一场」「还有 N 场」三件事一个字都断言不到）。
   *    它们必须是**必填**、而且必须**逐个进这张表** —— 少一格的表现是静默的：
   *    搜索框/开关看着都在，打进去没反应，而本脚本的产物级断言照样绿。
   */
  live: [
    'live',
    'origin',
    'search',
    'onSearchChange',
    'bothLiveOnly',
    'onToggleBothLive',
    'shown',
    'onLoadMore',
  ],
  /*
   * ⚠️★ `phase` 是 2026-09-19 加的（"并排显示赛段"）：少传它的表现是**静默**的
   *    —— 排行榜照常渲染、只是顶上少一格，而"少了的那一格"与"上游没给"长得一样。
   * ⚠️★ 后面六格是 2026-09-19 **第三轮**（`c70bb3f` 的 ③ 搜索框 + 行内展开）加的，
   *    它们与 `phase` **不是**同一种缺法：少传 `searchText` / `detail` 时这一节
   *    不是"少画一块"，而是**当场崩**（`filterEloUsers(users, undefined)` 里的
   *    `query.trim()`；T2 落地后、本轮收尾前的真实读数就是一个 `TypeError`）。
   *    崩比静默好，但它红在一条栈上、而不是一条带人话的断言上；六格进了这张表之后，
   *    "容器忘了接线"才是这条守卫该说的那句话（下面还有一条"六格缺任何一个都要能命中"的探针）。
   *
   * ⚠️★ 2026-09-19 **第四轮**又加了两格（`seeds` / `onToggleSeed`，名字**冻结**）：
   *    它们是"每一场比赛右侧那颗按钮 + 它下面那三格种子"的全部接线。
   *    · `seeds` 缺了是**当场崩**（`RankedDetailBody` 里 `seeds[String(match.id)]`
   *      读 `undefined` —— T1 实测的原文在它的报告 §2.2，`RankedPanels.tsx:1415`）；
   *    · `onToggleSeed` 缺了**不崩**：按钮照旧画出来、产物一个字节都不差，
   *      而点下去什么都不发生 —— 只有这道守卫抓得到（`on` 前缀 ⇒ 自动按"必须是函数"查）。
   *    ⇒ 两格都进下面这张表，并且各有一条"缺了也要能命中"的探针（与那两条同形）。
   *    ⚠️ 类型是 `RankedSeedStates | null`（`null` = 这一页还没点开过任何一场，是**合法值**）：
   *      `null` 的产物与"没传"的产物**一模一样**，所以"传了 `null`"这件事只能由
   *      下面那些产物级断言证明（它们就是干这个的）。
   */
  elo: [
    'elo',
    'phase',
    'searchText',
    'onSearchTextChange',
    'onSearchSubmit',
    'lookup',
    'detail',
    'onToggleDetail',
    'seeds',
    'onToggleSeed',
  ],
  /*
   * ⚠️★ 2026-09-19 加的四格是 ④ 的手输跳转与「本周」（同一类理由：视图是纯视图，
   *    框里的字与"上一句判定说了什么"必须由**本脚本用不同的 props** 喂进来 ——
   *    状态住在视图里的话，`renderToStaticMarkup` 不点击、不打字，那两句提示
   *    一个字都断言不到）。
   */
  weekly: ['weekly', 'latestId', 'weekInput', 'onWeekInputChange', 'onWeekJump', 'weekError'],
} as const;

/**
 * ★★ 「这几格必填 prop 都显式传了」—— 一条**运行时**断言，因为这里没有编译期保护。
 *
 * ⚠️ `apps/web/tsconfig.json` 的 `include` 里没有 `scripts/**`（文件头那一节），
 *    所以本文件里那些 `RankedXxxViewProps` 类型注解**不会被检查**：它们只是给读代码的人看的。
 *    ⇒ 少传一格的表现是"那颗按钮的 `onClick` 是 `undefined`"，而产物与接好线的**完全一样**
 *    （SSR 不渲染事件处理器）⇒ 产物级断言永远发现不了。这一条把"缺一格"从**静默**变成**红**。
 * ⚠️ 判据是 `undefined`，**不能**写成 falsy：`staleSecs` 的 `null`（"没有旧数据这回事"）、
 *    `busy` 的 `false`、`players` 的 `null` 与 `0` 全是**合法值**，写成 falsy 会让
 *    每一个正常夹具都红。
 * ⚠️★ `on*` 那一组**另外**要求是函数（2026-09-19 从"只查 `onRetry` 一个"改成按前缀查）：
 *    `undefined` 之外的另一种缺法是"传了一个不是函数的东西"（比如 `onSearchChange: noop()`
 *    多写了一对括号 —— 它在产物里与接好线的**长得一模一样**，点下去却什么都没有）。
 *    跑一遍 `onSearchChange` / `onToggleBothLive` / `onLoadMore` 之后，本栏目**每一个**
 *    交互入口都进了这道守卫。
 */
function assertPropsGiven(
  props: Record<string, unknown>,
  keys: readonly string[],
  where: string,
): void {
  for (const key of keys) {
    assert.notEqual(
      props[key],
      undefined,
      `★★ ${where}：必填 prop \`${key}\` 没有传 —— 本脚本不受类型检查保护，产物里也看不出来`,
    );
    if (key.startsWith('on')) {
      assert.equal(
        typeof props[key],
        'function',
        `★★ ${where}：\`${key}\` 必须是函数（传了 undefined 或一个调用的结果，那个入口就按不动）`,
      );
    }
  }
}

/*
 * 探针：上面那个检查本身必须能命中 —— 否则"都传了"是一条永远不红的守卫。
 * ⚠️ 探针喂进去的对象必须是**除那一格之外全给齐**的：少给别的格子的话，
 *    守卫会先在别的 key 上失败，而那条探针就成了"报错信息里有没有 onRetry"的巧合。
 */
assert.throws(
  () => {
    assertPropsGiven(
      {
        ...chrome(),
        onRetry: undefined,
        status: status(),
        players: PLAYERS,
      } as unknown as Record<string, unknown>,
      [...CHROME_KEYS, ...VIEW_KEYS.status],
      '探针',
    );
  },
  /onRetry/,
  '★★ 探针：缺 prop 的检查本身必须能命中（否则"都传了"这条是空跑）',
);
assert.throws(
  () => {
    assertPropsGiven(
      {
        ...chrome(),
        live: LIVE_DATA,
        origin: undefined,
      } as unknown as Record<string, unknown>,
      [...CHROME_KEYS, ...VIEW_KEYS.live],
      '探针',
    );
  },
  /origin/,
  '★★ 探针：`origin` 缺了也要能命中（它是 Twitch 的 `parent`，缺了会**静默**降级成外链）',
);
/*
 * ★ 探针：`on*` 那一组"必须是函数"也要能命中 —— 否则它是恒真的空跑。
 * ⚠️★ 夹具必须**把除了那一格之外的都补齐**：守卫是按顺序查的，少给一格的话它会先在
 *    那一格上失败，这条探针就成了"报错信息里有没有 `onSearchChange`"的巧合
 *    （上面那条 `origin` 探针也是同一个理由）。
 * ⚠️ 喂的是 `onSearchChange: 'nope'`（一个**不是函数**的值）：这是 `undefined` 之外的
 *    另一种缺法（`onSearchChange: noop()` 多写了一对括号就是它）。
 */
assert.throws(
  () => {
    assertPropsGiven(
      {
        ...chrome(),
        live: LIVE_DATA,
        origin: ORIGIN,
        search: '',
        bothLiveOnly: false,
        shown: RANKED_LIVE_BATCH,
        onToggleBothLive: noop,
        onLoadMore: noop,
        onSearchChange: 'nope',
      } as unknown as Record<string, unknown>,
      [...CHROME_KEYS, ...VIEW_KEYS.live],
      '探针',
    );
  },
  /onSearchChange/,
  '★★ 探针：`onSearchChange` 传了个不是函数的东西也要能命中（产物里看不出来，点下去什么都没有）',
);
/*
 * ★★ 探针：③ 那六格（2026-09-19 第三轮）也要能被这道守卫抓到 —— 否则"六格都传了"
 *    是一条永远不红的守卫，而这一节的红会重新变成一条**没有名字的 TypeError**
 *    （本轮收尾前实测的就是它：`filterEloUsers` ← `RankedEloView`，见文件头与 ④ 那一节）。
 * ⚠️★ 两刀，各砍一处，其余全给齐：
 *   · `detail: undefined` ⇒ 抓"少传一格"（本栏目补这六格之前的真实形状就是它，只是那时
 *     守卫的表里根本没有这几个键 ⇒ 它一个字都不查）；
 *   · `onToggleDetail: 'nope'` ⇒ 抓"传了不是函数的东西"（`onToggleDetail: noop()` 那种写法）。
 * ⚠️ 反过来，**没必要**给六格各写一条：守卫是逐个 key 查同一段代码，六条探针是同一条断言
 *    抄六遍（本仓为这种"不可能红的重复"删过断言）。
 */
assert.throws(
  () => {
    assertPropsGiven(
      {
        ...chrome(),
        elo: ELO_DATA,
        phase: ELO_PHASE,
        searchText: '',
        onSearchTextChange: noop,
        onSearchSubmit: noop,
        lookup: null,
        detail: undefined,
        onToggleDetail: noop,
      } as unknown as Record<string, unknown>,
      [...CHROME_KEYS, ...VIEW_KEYS.elo],
      '探针',
    );
  },
  /detail/,
  '★★ 探针：`detail` 没传要能命中（它是本轮六格里唯一一个"不传会静默少一整块界面"的）',
);
assert.throws(
  () => {
    assertPropsGiven(
      {
        ...chrome(),
        elo: ELO_DATA,
        phase: ELO_PHASE,
        searchText: '',
        onSearchTextChange: noop,
        onSearchSubmit: noop,
        lookup: null,
        detail: null,
        onToggleDetail: 'nope',
        seeds: null,
        onToggleSeed: noop,
      } as unknown as Record<string, unknown>,
      [...CHROME_KEYS, ...VIEW_KEYS.elo],
      '探针',
    );
  },
  /onToggleDetail/,
  '★★ 探针：`onToggleDetail` 不是函数也要能命中（产物里与接好线的**一模一样**，点下去什么都不发生）',
);
/*
 * ★★ 探针：第四轮那两格（`seeds` / `onToggleSeed`）也要能被这道守卫抓到 —— 形状与上面两条
 *    逐字相同，只是砍的格子换了：一条砍"少传一格"、一条砍"传了不是函数的东西"。
 * ⚠️★ 两条都不是形式主义，它们各对应 T1 报告 §3.1 里实测到的**两种不同缺法**：
 *    · 少传 `seeds` ⇒ 视图**当场抛**（`TypeError: Cannot read properties of undefined
 *      (reading '13304815')`，`RankedPanels.tsx:1415`）—— 崩比静默好，但它是一条**栈**，
 *      不是一句带人话的断言；这一条把"这个栏目少接了一格线"说清楚；
 *    · 少传 `onToggleSeed` ⇒ **什么都不崩**（T1 实测：产物 2227 字节，一个字节不差），
 *      而那颗按钮点下去什么都不发生 ⇒ 只有这道守卫看得见。
 * ⚠️ 夹具把**除那一格之外**的九格全给齐：守卫是按顺序查的，少给别的格子的话它会先在
 *    那一格上失败，这条探针就成了"报错信息里有没有 seeds"的巧合
 *    （上面 `origin` / `onSearchChange` 两条同理）。
 */
assert.throws(
  () => {
    assertPropsGiven(
      {
        ...chrome(),
        elo: ELO_DATA,
        phase: ELO_PHASE,
        searchText: '',
        onSearchTextChange: noop,
        onSearchSubmit: noop,
        lookup: null,
        detail: null,
        onToggleDetail: noop,
        onToggleSeed: noop,
      } as unknown as Record<string, unknown>,
      [...CHROME_KEYS, ...VIEW_KEYS.elo],
      '探针',
    );
  },
  /seeds/,
  '★★ 探针：`seeds` 没传要能命中（缺了它视图当场抛 —— 本栏目"容器忘了接线"的第二种缺法）',
);
assert.throws(
  () => {
    assertPropsGiven(
      {
        ...chrome(),
        elo: ELO_DATA,
        phase: ELO_PHASE,
        searchText: '',
        onSearchTextChange: noop,
        onSearchSubmit: noop,
        lookup: null,
        detail: null,
        onToggleDetail: noop,
        seeds: null,
        onToggleSeed: 'nope',
      } as unknown as Record<string, unknown>,
      [...CHROME_KEYS, ...VIEW_KEYS.elo],
      '探针',
    );
  },
  /onToggleSeed/,
  '★★ 探针：`onToggleSeed` 不是函数也要能命中（产物里与接好线的**一模一样**，那颗按钮点下去什么都不发生）',
);

/** 四支共用的那几格（容器给的是**同一个对象**的四个字面量，见 `routes/Ranked.tsx`）。 */
function chrome(o: Partial<RankedChromeProps> = {}): RankedChromeProps {
  return {
    errorText: null,
    staleSecs: null,
    updatedAgoSecs: UPDATED,
    busy: false,
    onRetry: noop,
    ...o,
  };
}

/** 标签页那一支（`tab` 是它的**唯一** prop）。 */
function tabProps(tab: RankedTab): RankedTabBarProps {
  return { tab };
}

/** 调用方给的兜底（`useApiErrorText()` 的结果）—— 用一个哨兵，好断言"确实走了兜底"这条路。 */
const FALLBACK = 'FALLBACK';

/**
 * 容器在失败时说的那一句话 —— 这里**用真的那一句**（`ranked.loadFailed` +
 * `describeRankedError` 给的那半句），而不是随手编一个字符串：⑥ 断言的是
 * "失败那一屏说了什么"，把文案换成哨兵就等于不再断言它了。
 */
const ERROR_TEXT = `${t('ranked.loadFailed')} ${describeRankedError(
  new RankedDirectError('network', '两个入口都连不上'),
  t,
  () => FALLBACK,
)}`;

const renderTabs = (tab: RankedTab): string => {
  const props = tabProps(tab);
  assert.notEqual(
    (props as unknown as Record<string, unknown>).tab,
    undefined,
    `★★ 标签页：必填 prop \`tab\` 没有传（${tab}）`,
  );
  return render(createElement(RankedTabBar, props));
};

const renderStatus = (o: Partial<RankedStatusViewProps> = {}, where = '状况'): string => {
  const props: RankedStatusViewProps = {
    ...chrome(),
    status: status(),
    players: PLAYERS,
    ...o,
  };
  assertPropsGiven(
    props as unknown as Record<string, unknown>,
    [...CHROME_KEYS, ...VIEW_KEYS.status],
    where,
  );
  return render(createElement(RankedStatusView, props));
};

const renderLive = (o: Partial<RankedLiveViewProps> = {}, where = '对局'): string => {
  const props: RankedLiveViewProps = {
    ...chrome(),
    live: LIVE_DATA,
    origin: ORIGIN,
    /*
     * ★ ② 的三格状态 + 两个动作的**默认值**：不筛、开关关着、首批那么多。
     * ⚠️ `shown` 用 `RANKED_LIVE_BATCH`（不是写死的数）：这一句就是"首批是一批"这件事
     *    在本脚本里的落点 —— 常量改了而这里没跟上时，`liveMany` 那几条会红。
     */
    search: '',
    onSearchChange: noop,
    bothLiveOnly: false,
    onToggleBothLive: noop,
    shown: RANKED_LIVE_BATCH,
    onLoadMore: noop,
    ...o,
  };
  assertPropsGiven(
    props as unknown as Record<string, unknown>,
    [...CHROME_KEYS, ...VIEW_KEYS.live],
    where,
  );
  /*
   * ⚠️ `origin` 是 `string`（不是 `string | null`）：空串会让 Twitch **静默**降级成外链，
   *    所以"传了个字符串"这件事要单独看 —— 但空串本身是**合法**夹具（下面有一条专门用它）。
   */
  assert.equal(typeof props.origin, 'string', `★★ ${where}：\`origin\` 必须是字符串`);
  return render(createElement(RankedLiveView, props));
};

const renderElo = (o: Partial<RankedEloViewProps> = {}, where = '排行榜'): string => {
  const props: RankedEloViewProps = {
    ...chrome(),
    elo: ELO_DATA,
    phase: ELO_PHASE,
    /*
     * ★★ ③ 那六格交互状态的**默认值**（2026-09-19 第三轮，`c70bb3f`）：空搜索词、
     *    没查过、没展开 —— 也就是容器初始态给的那一份。
     * ⚠️★ 不写这几格的话**这一节根本跑不到**：视图对 `searchText` 调 `filterEloUsers`，
     *    而那个函数对 `undefined` 会 `query.trim()` 当场抛 `TypeError`
     *    ⇒ `check:all` 从第一个 `renderElo()` 起就断，**后面十一个自检一个都不跑**
     *    （`check:all` 是 `&&` 串起来的）。这正是本轮要收的那条尾。
     * ⚠️ 下面每一个 `...o` 都要能把它们整格换掉：⑨ 的每一条断言都是"换一格 props、
     *    看产物变成什么样"，所以默认值必须是**可以被覆盖**的，而不是合并进别的含义里。
     */
    searchText: '',
    onSearchTextChange: noop,
    onSearchSubmit: noop,
    lookup: null,
    detail: null,
    onToggleDetail: noop,
    /*
     * ★★ 第四轮那两格的默认值（2026-09-19）：`seeds: null` 就是容器初始态给的那一份
     *    （"这一页还没点开过任何一场"），而它**不是**可选 prop 的兜底 ——
     *    视图那一侧写死"缺传就抛"（`RankedEloViewProps.seeds` 上写着为什么）。
     *    ⚠️ 这两行不是"让崩溃消失"：补它们之前，`check:all` 从第一个 `renderElo()`
     *    起就断（`check:all` 是 `&&` 串起来的 ⇒ 后面十一个自检一个都不跑）。
     */
    seeds: null,
    onToggleSeed: noop,
    ...o,
  };
  assertPropsGiven(
    props as unknown as Record<string, unknown>,
    [...CHROME_KEYS, ...VIEW_KEYS.elo],
    where,
  );
  return render(createElement(RankedEloView, props));
};

const renderWeekly = (o: Partial<RankedWeeklyViewProps> = {}, where = '周赛'): string => {
  const props: RankedWeeklyViewProps = {
    ...chrome(),
    weekly: WEEK_LAST,
    latestId: LATEST_ID,
    // ★ ④ 那两格 + 两个动作的默认值：空框、没有提示（2026-09-19 加）
    weekInput: '',
    onWeekInputChange: noop,
    onWeekJump: noop,
    weekError: null,
    ...o,
  };
  assertPropsGiven(
    props as unknown as Record<string, unknown>,
    [...CHROME_KEYS, ...VIEW_KEYS.weekly],
    where,
  );
  return render(createElement(RankedWeeklyView, props));
};

console.log(`【${LANG}】Ranked 实时信息 · 四个纯视图 + 直连请求选项 + 类名↔CSS（渲染自检）`);

// ---------------------------------------------------------------------------
console.log('① 标签页：四个真链接 + `aria-current` 只在当前那一页');
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 四个标签的文字住在**一张表**里（`RANKED_TAB_LABEL_KEYS`，`t(表[each])`），
 *    而"表里的值"对 `services/api/src/i18n-keys.test.ts` 是**看不见**的 —— 它扫的是
 *    源码里的**字面量** `t('…')` 调用。2026-09-16 的评审就是这样逐格量到的：
 *    四条 key 在两份字典里一条都没有，四个标签在两种语言里**一起**印出裸 key，
 *    而 `pnpm -w check` 全绿。
 * ⇒ 这里断言的是**渲染出来的那四串字**（不是"表里有四条"）；表的值 = spec §7.1 的冻结清单，
 *   所以本脚本把这个对应关系**手抄**一份在这里，两边一起改才算改对。
 * ⚠️ 四个地址同样是手抄的（`RANKED_TAB_PATHS` 没导出）：它们是 spec §6.1 的冻结路由，
 *    而"标签页是真链接"这件事的判据就是那四个 href（做成 state 切换的写法，产物里
 *    那四个词照样都在 —— 只有 href 能揭穿它）。
 */
const TAB_PATHS: Record<RankedTab, string> = {
  status: '/ranked/status',
  live: '/ranked/live',
  elo: '/ranked/elo',
  weekly: '/ranked/weekly',
};
const TAB_LABEL_KEYS = [
  'ranked.tabStatus',
  'ranked.tabLive',
  'ranked.tabElo',
  'ranked.tabWeekly',
] as const;

assert.deepEqual(
  [...RANKED_TABS],
  ['status', 'live', 'elo', 'weekly'],
  '★ 四个标签页的**顺序**（spec §6.1：状况 → 高分对局 → 排行榜 → 周赛）',
);
for (const [i, tab] of RANKED_TABS.entries()) {
  const html = renderTabs(tab);
  const tabs = elementsWithClass(html, 'ranked__tab');
  assert.equal(tabs.length, 4, `★ 四个标签页都要在（tab=${tab}，找到 ${String(tabs.length)} 个）`);
  assert.deepEqual(
    tabs.map((el) => attrOf(el, 'href')),
    RANKED_TABS.map((each) => TAB_PATHS[each]),
    `★★ tab=${tab}：四个标签是**真链接**（可刷新、可分享、前进后退落在同一屏）`,
  );
  assert.deepEqual(
    tabs.map((el) => textOf(el)),
    TAB_LABEL_KEYS.map((key) => fresh(key)),
    `★★ tab=${tab}：四串**渲染文字**逐条（表里的值 —— 少一条就会印出裸 key，而门禁全绿）`,
  );
  assert.deepEqual(
    tabs.map((el) => attrOf(el, 'aria-current')),
    RANKED_TABS.map((_, j) => (j === i ? 'page' : null)),
    `★★ tab=${tab}：「aria-current="page"」**只有**当前那一页有（其余三个连属性都不渲染）`,
  );
  assert.equal(
    textOf(elementsWithClass(html, 'ranked__title')[0] ?? ''),
    fresh('nav.ranked'),
    '★ 页头那个标题用的是**栏目名**（与侧栏同一个词条，不新写一句）',
  );
}
ok('标签页：四个真链接 + 四串文字逐条 + `aria-current` 跟着 `tab` 走');

// ---------------------------------------------------------------------------
console.log('② 状况：四格（名字 / 状态 / 最后更新）+ 在线人数，**别的什么都没有**');
// ---------------------------------------------------------------------------
/*
 * ★★ 先逐格钉**表**，再渲染产物：对调两格在全仓是**全静默**的
 *    （`lib/shareErrors.ts` 上那一轮的教训）—— 界面照样渲染、类型照样过
 *    （每一格都是 `string`）、门禁一个都不看它，而用户读到的是另一段处境的话。
 */
assert.deepEqual(
  STATUS_KEYS,
  {
    0: 'ranked.statusDown',
    1: 'ranked.statusUp',
    2: 'ranked.statusPending',
    3: 'ranked.statusMaintenance',
  },
  '★★ `monitor.state` → 词条 key 的表被改了（对调两行在界面上**看不出来**）',
);
const STATE_SENTENCES = ([0, 1, 2, 3] as const).map((s) => fresh(STATUS_KEYS[s]));
assert.equal(
  new Set(STATE_SENTENCES).size,
  4,
  '★★ 四态必须是**四句不同**的话（相同的话下面"每份产物只有自己那一句"就是空跑）',
);
const BADGE_SUFFIX = ['down', 'up', 'pending', 'maintenance'] as const;

/*
 * ★★ 四态逐态渲染：这一次**四格都是同一个状态**，四颗徽章必须都说那一句。
 *
 * ⚠️★ 它比改版前那条更强：那时一页只有**一颗**徽章（一个 Game Server），
 *    "四格各说各的"这件事根本测不到（一个把状态印四遍、或者只认第一格状态的实现
 *    在旧夹具下也全绿）。现在四颗都在，而且四颗都要对。
 */
for (const state of [0, 1, 2, 3] as const) {
  const html = renderStatus(
    {
      status: status({
        components: [
          component(0, { state }),
          component(1, { state }),
          component(2, { state }),
          component(3, { state }),
        ],
      }),
    },
    `状况·四格都 state=${state}`,
  );
  const badges = elementsWithClass(html, 'ranked__badge');
  assert.equal(badges.length, 4, `★ state=${state}：四格 ⇒ 恰好四颗徽章`);
  for (const [i, badge] of badges.entries()) {
    assert.equal(
      textOf(badge),
      fresh(STATUS_KEYS[state]),
      `★★ 第 ${String(i + 1)} 格（state=${state}）说它**自己那一句**（不是别的三种之一）`,
    );
    assert.ok(
      classOf(badge).split(/\s+/).includes(`ranked__badge--${BADGE_SUFFIX[state]}`),
      `★ 第 ${String(i + 1)} 格带上它自己的配色类名 \`.ranked__badge--${BADGE_SUFFIX[state]}\``,
    );
    for (const [other, sentence] of STATE_SENTENCES.entries()) {
      if (other === state) continue;
      assert.notEqual(
        textOf(badge),
        sentence,
        `★★ state=${state} 的徽章**不许**说成 state=${String(other)} 那一句`,
      );
    }
  }
}

/*
 * ★★ 上面那两张手抄的表必须与 `const.ts` 里那一张**逐字一致**。
 *
 * ⚠️★ 这不是形式主义：`RANKED_STATUS_COMPONENTS` 是这一栏**唯一**一处从网页上抄下来的知识
 *    （心跳响应里只有 id、没有名字，`const.ts` 上写着完整来历），而"名字与 id 对不上"
 *    这件事**没有任何 API 能验**。所以至少要让**我们自己的三份抄写**互相对得上：
 *    表（`const.ts`）、夹具（本文件）、服务端那份响应（`ranked.test.ts` 的夹具）。
 *    ⚠️ 反过来，上游把监视器**重新编号**是这三处都验不出来的 —— 那一条只能靠人去对状态页
 *    （`docs/pending.md` 里记着）。
 */
assert.deepEqual(
  RANKED_STATUS_COMPONENTS.map((each) => each.id),
  [...COMPONENT_IDS],
  '★★ 夹具里那四个 id 与 `RANKED_STATUS_COMPONENTS` 逐字一致（表的顺序 = 界面上的行序）',
);
assert.deepEqual(
  RANKED_STATUS_COMPONENTS.map((each) => each.nameKey),
  [...COMPONENT_NAME_KEYS],
  '★★ 四个名字 key 也一样（表改了而这里没跟上 ⇒ 界面上会印出裸 key）',
);

/** 正常那一份：四行 + 大号数字 + 人数那一句。 */
const stNormal = renderStatus({}, '状况·正常');
const componentRows = elementsWithClass(stNormal, 'ranked__component');
assert.equal(
  componentRows.length,
  4,
  `★★ 状态栏恰好**四行**（Game Server / API / Store / Wiki）—— 找到 ${String(componentRows.length)} 行`,
);
/*
 * ★★ 逐行三格：名字 / 状态徽章 / 最后更新。
 *
 * ⚠️★ 三格都是**逐行**断言的，而不是"整个产物里有这些字"：
 *    后者对一个"四行都印同一个名字/同一个时间"的实现照样绿 —— 而那正是这一版
 *    最容易犯的错（`RANKED_STATUS_COMPONENTS` 是一张表，抄错一格就会重复同一行）。
 * ⚠️ 时间那一格比的是**自己那个**时间（那四个值不是两两不同，但足以分辨谁是谁 ——
 *    见夹具的注释：抄任何一串印四行、或把前两格对调，都会在下面红）。
 */
for (const [i, row] of componentRows.entries()) {
  const nameKey = COMPONENT_NAME_KEYS[i] ?? '';
  const state = COMPONENT_STATES[i] ?? 1;
  assert.equal(
    textOf(elementsWithClass(row, 'ranked__compname')[0] ?? ''),
    fresh(nameKey),
    `★★ 第 ${String(i + 1)} 行的**名字**（${nameKey}）—— 名字来自我们那张表（心跳响应里没有名字）`,
  );
  assert.equal(
    textOf(elementsWithClass(row, 'ranked__badge')[0] ?? ''),
    fresh(STATUS_KEYS[state]),
    `★★ 第 ${String(i + 1)} 行说它**自己**那个状态（不是把某一格的状态印四遍）`,
  );
  assert.equal(
    textOf(elementsWithClass(row, 'ranked__meta')[0] ?? ''),
    fresh('ranked.componentCheckedAt', { time: COMPONENT_TIMES[i] ?? '' }),
    `★★ 第 ${String(i + 1)} 行的**最后更新**是它自己那个时间（上游那串文本原样）`,
  );
}
/*
 * ★★ 「别的什么都没有」—— 这一条是这次改版的**中心断言**，也是它最难写成"恒真"的地方：
 *
 * 判据是**整个面板的可见文字逐字等于**那几件的拼接（顺序 = DOM 顺序）：
 *    ①标题 → 四行（名字/状态/最后更新）×4 → ②标题 → 人数那一句
 * 多任何一件（延迟、可用率、心跳历史、解释性文字）都会让这一条红，
 * 而"少一件"由上面那些逐格断言兜着 ⇒ 两个方向都钉住了。
 * ⚠️★ 2026-09-19 **第二轮**：中间的「大号数字」那一件被删掉、换成**第二个大标题**
 *    （`playersTitle`，用户原话：「去掉大数字1119，改为一个大标题『实时在线人数』」）
 *    ⇒ 下面这一串里那两件（②标题 + 那一句）。多出来的话——比如谁把数字那格加回来
 *    ——这一条会红，而那正是用户点名要去掉的东西。
 * ⚠️★ 为什么不用"不许出现某句话"那种写法：删除类的断言在**别人加了一句新话**时
 *    永远为真（新句子里没有那串字），而这次改版要防的恰恰是"再加一句"。
 */
assert.equal(
  textOf(elementsWithClass(stNormal, 'ranked__panel')[0] ?? ''),
  [
    fresh('ranked.statusTitle'),
    ...COMPONENT_NAME_KEYS.flatMap((nameKey, i) => [
      fresh(nameKey),
      fresh(STATUS_KEYS[COMPONENT_STATES[i] ?? 1]),
      fresh('ranked.componentCheckedAt', { time: COMPONENT_TIMES[i] ?? '' }),
    ]),
    fresh('ranked.playersTitle'),
    fresh('ranked.players', { n: PLAYERS }),
    // ⚠️ 最后这一格是**外壳**那一行新鲜度（四个面板都有），不是状态栏自己的内容
    fresh('ranked.updatedAgo', { secs: UPDATED }),
  ].join(''),
  '★★★ 状态栏这一屏**只有**两个标题 + 四行 + 人数那一句 + 外壳那一行新鲜度（延迟 / 可用率 / 心跳历史 / 解释性文字 / 那颗大号数字都被删掉了）',
);
/*
 * ★★★ 那个数字在那一屏里**只许出现一次**。
 *
 * ⚠️★ 这是用户这一轮那句「**去掉大数字1119**」的**可断言形式**：上一版是
 *    「大号 1119」+「1119 人正在玩 Ranked」两件，同一个数印两遍；
 *    合并之后只剩一句话 ⇒ 计数必须恰好是 1。
 * ⚠️ 上面那条**整屏文字相等**其实已经覆盖了它（多一件就红），但两条红的**话**不一样：
 *    这一条说的是"用户点名的那个数字重复"，下一个人删掉的是哪一件一目了然。
 * ⚠️ 用 `split` 而不是正则：`PLAYERS` 是一个数字字面量，拼进正则要转义，
 *    而这里没有任何理由引入一个正则。
 */
assert.equal(
  textOf(elementsWithClass(stNormal, 'ranked__panel')[0] ?? '').split(String(PLAYERS)).length - 1,
  1,
  `★★★ 人数那个数字（${String(PLAYERS)}）在这一屏里**只出现一次**（「去掉大数字」= 不再印两遍）`,
);
assert.equal(
  playersOf(stNormal)[0],
  fresh('ranked.players', { n: PLAYERS }),
  '★★ 人数那一格写的就是那句话本身（不是"一颗数字 + 下面一句说明"两行）',
);
assert.equal(
  hasClassOf(elementsWithClass(stNormal, 'ranked__players')[0] ?? '', 'ranked__players--unknown'),
  false,
  '★ 读到人数时**不**挂弱色那个类（正面对照是下面 `players: null` 那一份）',
);
/*
 * ★★ 被删掉的那四条词条**不许**再留在字典里（2026-09-19 用户口径：
 *    「不加其他多余的信息」）。⚠️ 没有消费者的 key 留着的代价是具体的：
 *    下一个人会以为它还挂着某个渲染点，于是"为什么看不到延迟"变成一个要读三个文件
 *    才能回答的问题（本仓为这种事删过 `shares.moderateHideReason`）。
 *    ⚠️ 复活的路径是有的（有人想加回延迟）——那时这一条会红，而它红得**正是时候**。
 */
for (const gone of [
  'statusPing',
  'statusPingUnknown',
  'statusUptime',
  'statusCheckedAt',
] as const) {
  for (const [lng, dict] of [
    ['zh-CN', zhCN],
    ['en', en],
  ] as const) {
    assert.equal(
      gone in (dict.ranked as Record<string, unknown>),
      false,
      `★★ \`ranked.${gone}\` 应当已经从 ${lng} 字典里删掉（状态栏只留四格 + 人数）`,
    );
  }
}

/** ★★ 上游少了某一格 ⇒ 那一行**照样在**，印的是 `—`（**不是**「故障」）。 */
const stMissing = renderStatus(
  {
    status: status({
      components: [
        component(0),
        component(1),
        // ★ Store 那一格上游没给（或它的数组是空的）：`state` 与 `checkedAt` 都是 null
        component(2, { state: null, checkedAt: null }),
        component(3),
      ],
    }),
  },
  '状况·上游少了一格',
);
const missingRows = elementsWithClass(stMissing, 'ranked__component');
assert.equal(
  missingRows.length,
  4,
  '★★ 少了一格 ⇒ 界面上的行数**还是四**（悄悄少一行会让用户以为状态栏本来就长这样）',
);
const missingRow = missingRows[2] ?? '';
assert.equal(
  textOf(elementsWithClass(missingRow, 'ranked__compname')[0] ?? ''),
  fresh('ranked.componentStore'),
  '★ 缺的那一行仍然是**它自己那个名字**（Store）',
);
assert.equal(
  textOf(elementsWithClass(missingRow, 'ranked__badge')[0] ?? ''),
  fresh('ranked.unknown'),
  '★★ 读不到 ⇒ 占位符 `—`（**不是**「故障」：那是替上游断言一件我们并不知道的事）',
);
assert.equal(
  hasClassOf(elementsWithClass(missingRow, 'ranked__badge')[0] ?? '', 'ranked__badge--unknown'),
  true,
  '★ 而且戴的是**中性**的 `--unknown` 配色，不是红色的 `--down`',
);
assert.equal(
  hasClassOf(elementsWithClass(missingRow, 'ranked__badge')[0] ?? '', 'ranked__badge--down'),
  false,
  '★★ 缺一格**不许**被画成故障（正面对照：上面 state=0 那一份才戴 `--down`）',
);
assert.equal(
  textOf(elementsWithClass(missingRow, 'ranked__meta')[0] ?? ''),
  fresh('ranked.componentCheckedAt', { time: fresh('ranked.unknown') }),
  '★ 时间那一格同样说"没有"（「最后更新 —」），不是编一个时刻出来',
);
/* 正面对照：另外三格**一个字都没受影响**（少一格不该波及别人）。 */
for (const [i, row] of missingRows.entries()) {
  if (i === 2) continue;
  assert.equal(
    textOf(elementsWithClass(row, 'ranked__badge')[0] ?? ''),
    fresh(STATUS_KEYS[COMPONENT_STATES[i] ?? 1]),
    `★ 第 ${String(i + 1)} 格照旧（上游少了 Store 不该把 API 一起弄没）`,
  );
}

/** ★★ `players: 0` 与 `players: null` 是**两句不同的话**、两个不同的画面。 */
const stZero = renderStatus({ players: 0 }, '状况·没人玩');
const stPlayersNull = renderStatus({ players: null }, '状况·人数读不到');
assert.equal(
  playersOf(stZero)[0],
  fresh('ranked.playersZero'),
  '★★ `players: 0` ⇒ 「现在没有人在玩 Ranked」（真话）',
);
assert.equal(
  metaOf(stZero).includes(fresh('ranked.playersUnknown')),
  false,
  '★★ 0 那一份**不许**说「读不到」',
);
assert.equal(
  playersOf(stPlayersNull)[0],
  fresh('ranked.playersUnknown'),
  '★★ `players: null` ⇒ 「人数暂时读不到」（另一件事，**不是** 0 —— 0 是一句谎话）',
);
assert.equal(
  metaOf(stPlayersNull).includes(fresh('ranked.playersZero')),
  false,
  '★★ 读不到那一份**不许**说「没有人在玩」',
);
assert.notEqual(
  fresh('ranked.playersZero'),
  fresh('ranked.playersUnknown'),
  '★★ 探针：那两句本身必须不同（否则上面那一对比较是空跑）',
);
assert.ok(
  hasClassOf(
    elementsWithClass(stPlayersNull, 'ranked__players')[0] ?? '',
    'ranked__players--unknown',
  ),
  '★ 读不到那一格戴上弱色类名（正面对照：读到人数时不戴）—— 绿色是"有人在玩"的颜色，读不到不该用那个颜色',
);
/*
 * ⚠️ 上面这条的**反面**同样要钉：读不到时那一格**不许**是绿色那一档。
 *    样式表里"哪个类给绿色"是 CSS 的事，这里能断的是**类名**：
 *    `--unknown` 挂着而绿色那条规则没有 `--unknown` 的例外 ⇒ 颜色由 CSS 决定；
 *    这条断的是"两个画面拿到的类名不同"，也就是那件事的唯一可判定部分。
 */
assert.equal(
  hasClassOf(elementsWithClass(stZero, 'ranked__players')[0] ?? '', 'ranked__players--unknown'),
  false,
  '★ 0 那一份**不戴**弱色类：它是一句真话（与"读不到"必须长得不一样）',
);

/** `stale: true`（服务端拿了兜底）与外壳那句「上次刷新失败了」**不是**一件事。 */
const stStale = renderStatus({ status: status({ stale: true }) }, '状况·服务端兜底');
assert.equal(
  textOf(elementsWithClass(stStale, 'notice--info')[0] ?? ''),
  fresh('ranked.statusStale'),
  '★★ `stale: true` ⇒ 明说"这份数据是服务端兜底的旧数据"（否则它与新鲜心跳长得一模一样）',
);
assert.deepEqual(
  elementsWithClass(stNormal, 'notice'),
  [],
  '★ 正面对照：`stale: false` 时那一句不渲染',
);
assert.notEqual(
  fresh('ranked.statusStale'),
  fresh('ranked.refreshFailed', { secs: STALE }),
  '★★ 探针：它与「上次刷新失败了…」**不是**同一句（混成一句会让人去查一个没发生过的网络问题）',
);
ok('状况：四格逐格（名字/状态/时间）+ 少一格印「—」+ 全屏只有四行与人数 + 0/null 两句话');

// ---------------------------------------------------------------------------
console.log('③ 实时高分对局：两侧各五格 + 占位符 + 镜像 + 排序全部渲染 + 展开入口的正反');
// ---------------------------------------------------------------------------
/* 冻结值先钉常量，再钉产物：只钉产物的话，常量改了断言跟着走（那是装饰）。 */
assert.equal(RANKED_LIVE_BATCH, 20, '★★ 冻结的"一批渲染几场"（spec §13，2026-09-19 起）');
assert.equal(
  RANKED_ELO_TOP,
  150,
  '★★ 冻结的"排行榜 150 行"（spec §13，2026-09-19 用户口径：显示前 150）',
);

const live = renderLive({}, '对局·正常');
const cards = elementsWithClass(live, 'ranked__match');
assert.equal(cards.length, 4, `★ 夹具四场都要渲染出来（找到 ${String(cards.length)} 张）`);
/*
 * ★★ 排序与分段都是**视图自己**做的（`sliceLiveMatches`，本文件头第 3 节那条纪律：
 *    total 与列表必须来自同一次计算）。夹具的打乱顺序就是为了这一条能红。
 */
assert.deepEqual(
  cards.map((card) => textOf(elementsWithClass(card, 'ranked__name')[0] ?? '')),
  ['Nostream', 'HufterL', 'Ghost', 'Kicky'].map(flat),
  '★★ 卡片按 `avgElo` 降序（夹具入参顺序是打乱的：2400 那一场在**最后**）',
);
assert.equal(
  textOf(elementsWithClass(live, 'ranked__meta')[0] ?? ''),
  fresh('ranked.liveFrom', { total: LIVE_DATA.matches.length }),
  '★ 「共 {{total}} 场」里的 total 是**上游的总场次**（与下面那张表同一次计算）',
);
/*
 * ★★ 12 场 ⇒ **一张都不许少**（用户 2026-09-19 的要求：全部展示）。
 * ⚠️★ 这一条的前身是"只渲染前 10"（`RANKED_LIVE_TOP`）：12 > 10 ⇒ 把截断改回来的
 *    那一刻，这里当场红。它是"全部展示"这句话在本栏目里**唯一**的产物级判据。
 */
const liveMany = renderLive({ live: LIVE_MANY }, '对局·12 场');
assert.equal(
  elementsWithClass(liveMany, 'ranked__match').length,
  LIVE_MANY.matches.length,
  `★★ 12 场**全渲染**（一张都不许截断；旧行为是只给 10 张）`,
);
assert.equal(
  textOf(elementsWithClass(liveMany, 'ranked__meta')[0] ?? ''),
  fresh('ranked.liveFrom', { total: LIVE_MANY.matches.length }),
  '★★ 那句 total 说的是 **12**（列表与它是两件事，谁也不许把对方印出来）',
);
assert.equal(
  textOf(
    elementsWithClass(elementsWithClass(liveMany, 'ranked__match')[0] ?? '', 'ranked__name')[0] ??
      '',
  ),
  flat('P11A'),
  '★ 第一张仍是**分最高的**那一场（12 张里那一场是 P11A —— 顺序没变，只是不再截断）',
);

/* 两侧各五个字段，**逐格**断言文本（不是"有五个元素"）。 */
const FIELD_CLASSES = [
  'ranked__name',
  'ranked__elo',
  'ranked__rank',
  'ranked__progress',
  'ranked__mtime',
] as const;
const fieldsOf = (side: string): string[] =>
  FIELD_CLASSES.map((cls) => textOf(elementsWithClass(side, cls)[0] ?? ''));
/* 卡片甲（产物顺序第 2 张）：左 1658 > 右 1656 —— 夹具前提先钉住。 */
const cardBoth = cards[1] ?? '';
const bothSides = elementsWithClass(cardBoth, 'ranked__side');
assert.equal(bothSides.length, 2, '★ 卡片是左右两半');
assert.ok(
  (CARD_BOTH.players[0].eloRate ?? 0) > (CARD_BOTH.players[1].eloRate ?? 0),
  '★ 探针：夹具里**左边那个人的 elo 更高**（否则下面"镜像"那条断言是空跑）',
);
assert.deepEqual(
  fieldsOf(bothSides[0] ?? ''),
  ['HufterL', '1658', '#161', 'nether.find_bastion', '2:21'].map(flat),
  '★★ 左半边五个字段（用户原话的顺序：名字 → elo → #排名 → 进度 → 节点时间）',
);
assert.deepEqual(
  fieldsOf(bothSides[1] ?? ''),
  ['WhyIP', '1656', '#163', 'story.enter_the_end', '12:30'].map(flat),
  '★★ 右半边**同一组字段**、各自的值（不是空的，也不是照抄左边）',
);
assert.equal(
  hasClassOf(bothSides[0] ?? '', 'ranked__side--right'),
  false,
  '★★ 左边那一半**不带** `--right`（elo 高的在左）',
);
assert.equal(
  hasClassOf(bothSides[1] ?? '', 'ranked__side--right'),
  true,
  '★★ 右边那一半带 `--right`（镜像靠这个类名摆列，DOM 顺序两侧相同）',
);
assert.equal(
  textOf(elementsWithClass(cardBoth, 'ranked__mid')[0] ?? ''),
  fresh('ranked.matchTime', { time: '15:18' }),
  '★ 中间那一格是**这一场已经打了多久**（不是谁的节点时间）',
);

/*
 * ★★ 两格 `null` 的**孤立**断言（卡片乙：左侧只有 `eloRank` 与 `timelineType` 是 null）。
 *    判据是"那一格印占位符"，而**正向对照就在同一行**：另外三格印的是真值。
 */
const cardNulls = cards[2] ?? '';
const nullSide = elementsWithClass(cardNulls, 'ranked__side')[0] ?? '';
assert.deepEqual(
  fieldsOf(nullSide),
  ['Ghost', '1400', fresh('ranked.unknown'), fresh('ranked.unknown'), '0:45'].map(flat),
  '★★ `eloRank: null` 与 `timelineType: null` ⇒ 那两格印占位符，**另外三格照样是真值**（不是整格消失）',
);
assert.equal(
  elementsWithClass(nullSide, 'ranked__name').length +
    elementsWithClass(nullSide, 'ranked__elo').length +
    elementsWithClass(nullSide, 'ranked__rank').length +
    elementsWithClass(nullSide, 'ranked__progress').length +
    elementsWithClass(nullSide, 'ranked__mtime').length,
  5,
  '★★ 五个格子一个都不少（删掉那一格会让左右不对称，而那正是这张卡片的形式）',
);
/* 卡片乙的右半边：五个字段全 null ⇒ 五个占位符（上游只给了一个玩家那一档）。 */
assert.deepEqual(
  fieldsOf(elementsWithClass(cardNulls, 'ranked__side')[1] ?? ''),
  Array.from({ length: 5 }, () => fresh('ranked.unknown')).map(flat),
  '★★ 整半边都是空位时：五格都在、五格都是 `—`（不是一片空白）',
);
/*
 * ★ `0` 不是 `null`：卡片丙左边的节点时间是**真的 0 毫秒** ⇒ 那格印 `0:00`。
 *   与上面那个 `—` 并排，正是这一栏最容易写错的一处（`?? dash` 与 `? :` 差一个字符）。
 */
assert.equal(
  fieldsOf(elementsWithClass(cards[3] ?? '', 'ranked__side')[0] ?? '')[4],
  flat('0:00'),
  '★★ `timelineTime: 0` ⇒ 印 `0:00`（**不是**占位符：0 毫秒是一个真值）',
);
assert.notEqual(
  flat('0:00'),
  fresh('ranked.unknown'),
  '★ 探针：`0:00` 与占位符不是同一串字（否则上面那条与"印了 `—`"分不开）',
);

/*
 * ★★ 展开入口的**正反两半**，而且两半在**同一次渲染**里：
 *    · 整张卡片一个 `liveUrl` 都没有（卡片丁）⇒ 连展开键都不渲染
 *      —— 一颗"展开直播（0 个）"的折叠标题看起来像有东西可看，点开是一个空框；
 *    · 有 `liveUrl` 的卡片（甲 / 丙）⇒ 必须在。
 */
const expandCards = cards.map((card) => elementsWithClass(card, 'ranked__expand').length);
assert.deepEqual(
  expandCards,
  [0, 1, 0, 1],
  '★★ 展开键逐卡：没有 `liveUrl` 的卡片**没有**入口，有的卡片有一个（正反都在这一次渲染里）',
);
assert.equal(
  summaryOf(elementsWithClass(cardBoth, 'ranked__expand')[0] ?? ''),
  fresh('ranked.liveExpand', { n: 1 }),
  '★ 展开键的文案是「展开直播（1 个）」，那个 1 来自**实际渲染出来的框数**',
);
/*
 * ⚠️★ "展开态不在初始产物里"的判据是 **`<details>` 没有 `open` 属性**，不是"里面的东西不在"：
 *    原生 `<details>` 闭合时子树**仍然在 DOM 里**（`RankedMatch` 的注释写着这一条，
 *    正是为了让纯 SSR 的自检看得见那几侧的门面）。断言"内容不在"是**错的**：
 *    它会把一个**正确**的实现报成红的。
 * ⚠️ 这一点与任务书那句话（"展开的内容不在初始产物里"）的措辞不同 —— 对的是
 *    `ranked-live-plan.md` 的 Task 8 原文「**展开态**在初始产物里不存在」与 spec §11.3 的
 *    「展开态在初始产物里不存在」，因为"点一下才加载"是 `ClickToPlayEmbed` 的
 *    `useState` 管的事，SSR 里 iframe **永远**不会挂上去。
 */
assert.equal(
  /\bopen\b/.test(detailsTagOf(elementsWithClass(cardBoth, 'ranked__expand')[0] ?? '')),
  false,
  '★★ 初始产物里的 `<details>` **没有** `open` 属性（展开态要用户点出来）',
);
assert.equal(
  /\bopen\b/.test('<details class="ranked__expand" open>'),
  true,
  '★ 探针：这个读取器看得见 `open`（否则上面那条是恒真的）',
);
assert.equal(
  elementsWithClass(cardBoth, 'ranked__streams').length,
  1,
  '★ 而展开区里的内容**照常渲染**（门面在里面 —— 上面那条"没有 open"因此不是空跑）',
);
assert.equal(/<iframe/.test(live), false, '★★ 初始产物里**一个 iframe 都没有**（点击才加载）');
assert.equal(/<iframe/.test('<iframe src="x"></iframe>'), true, '★ 探针：iframe 扫描器能命中');

/*
 * ★★ Twitch 的 `parent` —— 本栏目唯一**静默失败**的规则（传错是拒播，不是报错）。
 *    判据分两条：那个地址里带着**容器传进来的 host**，而且换成一个空的 `origin` 时
 *    这一侧**不再内嵌**（后者证明 `origin` 真的被用上了，不是组件里写死的常量）。
 */
const embedSide = elementsWithClass(cardBoth, 'ranked__stream')[0] ?? '';
const facadeTag = /<button\b[^>]*>/.exec(embedSide)?.[0] ?? '';
const embedSrc = attrOf(facadeTag, 'data-embed-src') ?? '';
assert.ok(
  embedSrc.startsWith('https://player.twitch.tv/?channel=hufterl&parent='),
  '★ Twitch 那一侧走的是嵌入播放器，地址指向那个频道',
);
assert.ok(
  embedSrc.endsWith(`parent=${ORIGIN}`),
  `★★ \`parent\` 必须等于**容器传进来的那个 host**（这里 ${ORIGIN}）—— 传错是静默拒播`,
);
assert.equal(
  attrOf(facadeTag, 'aria-label'),
  `${t('videos.play')}: HufterL`,
  '★ 播放器的可访问名字说的是"播谁的"（不是一串控件类型）',
);
const noOrigin = renderLive({ origin: '' }, '对局·没有 origin');
assert.equal(
  elementsWithClass(noOrigin, 'video-embed').length,
  0,
  '★★ `origin` 为空 ⇒ Twitch 那一侧**不嵌**（宁可不嵌，也不发一个注定被 parent 校验拒掉的请求）',
);
assert.equal(
  elementsWithClass(noOrigin, 'ranked__external').length,
  2,
  '★ 而它换成了外链那一档（Twitch 那一侧 + kick 那一侧，同一次渲染里两处都在说那句话）',
);

/** kick（认不出的平台）⇒ 外链 + 「**这条链接**不能内嵌」那一句。 */
const kickCard = cards[3] ?? '';
const kickExternal = elementsWithClass(kickCard, 'ranked__external')[0] ?? '';
/*
 * ⚠️ 取 `<a>` 用正则、**不用** `elementsWithClass(…, 'a')`：那个函数按 `class` 属性找元素，
 *    而这条外链**没有** class ⇒ 它会返回空数组，而"断言作用在空串上"看起来与"通过"一模一样
 *    （§5.63 那一族）。下面那两条断言就是它的正向对照。
 */
const kickAnchor = /<a\b[^>]*>/.exec(kickExternal)?.[0] ?? '';
assert.notEqual(kickAnchor, '', '★ 探针：那一句里确实有一个 `<a>`（否则下面两条作用在空串上）');
assert.equal(
  textOf(kickExternal),
  fresh('ranked.liveExternal'),
  '★★ kick 那一档说的是「这条链接不能内嵌，在新窗口打开」（**不是**"这个平台不支持"）',
);
assert.equal(attrOf(kickAnchor, 'href'), KICK, '★ 外链指向上游给的那条地址本身');
assert.equal(
  attrOf(kickAnchor, 'rel'),
  'noopener noreferrer',
  '★ 第三方链接带 `noreferrer`（与直连层的 `referrerPolicy: no-referrer` 同一条取舍）',
);
assert.equal(
  elementsWithClass(kickCard, 'video-embed').length,
  0,
  '★★ 认不出的平台**不画**播放器门面（画一个点了不动的框比给外链糟得多）',
);
ok('对局：两侧五格逐格 + 两格 null 的孤立断言 + 排序/全部渲染 + 展开键正反 + Twitch parent');

// ---------------------------------------------------------------------------
console.log('③b ★ 对局的筛选条与分批：搜索 / 只看双方都在直播 / 加载更多（三种状态）');
// ---------------------------------------------------------------------------
/*
 * ★★ 这一节补的是 2026-09-19 用户要求的三件事：搜索框、那颗开关、「加载更多」。
 *
 * ---------------------------------------------------------------------------
 * ⚠️★ 它证明的是**视图拿着这三格状态会渲染成什么样**，不是"点下去会发生什么"
 * ---------------------------------------------------------------------------
 * 状态住在容器里（`routes/Ranked.tsx` 那三个 `useState`），视图只吃 props ⇒ 本脚本
 * 可以用**不同的 props**把三种状态各渲染一遍、逐格断言产物。而"打字 / 点击之后
 * 容器真的换了状态"是**另一件事**：`renderToStaticMarkup` 不跑 effect、不点击、
 * 不打字（文件末尾那段覆盖边界写着这一条的完整版）。⇒ 这里钉住的是
 * **判据与产物**（命中哪几场、还剩几场、开关显示成开着还是关着），
 * 而"接好线了没有"由 `assertPropsGiven`（`on*` 必须是函数）+ 编译期的必填 prop 兜着。
 */
const liveFilter = renderLive({ live: LIVE_FILTER }, '对局·筛选夹具');
const filterCards = (html: string): string[] =>
  elementsWithClass(html, 'ranked__match').map((card) =>
    textOf(elementsWithClass(card, 'ranked__name')[0] ?? ''),
  );

/**
 * 「加载更多（还有 N 场）」那颗按钮的**形状**：词条里那个数换成 `(\d+)`。
 *
 * ⚠️★ 形状从**词条**现算（把 `n: 0` 渲染一遍、再把它那个 `0` 换成通配），不手抄中文标点：
 *    手抄的话，文案改一次这条守卫就假红，而下一个人只会把守卫删掉。
 * ⚠️★ 为什么不能拿"产物里只有一颗按钮"当判据（这一版第一稿就是这么写的，当场红）：
 *    ② 的筛选条里那颗 chip **也是** `<button>`，而卡片里的播放器门面同样是 ——
 *    夹具一改，"几颗按钮"就会跟着变，那种断言钉的是夹具而不是界面。
 */
const LOAD_MORE_SHAPE = new RegExp(
  `^${fresh('ranked.liveMore', { n: 0 })
    .split('0')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('(\\d+)')}$`,
);
/** 产物里那颗「加载更多」按钮（没有就是 `null`）—— `n` 是**它自己印出来的**那个数。 */
const loadMoreOf = (html: string): { n: number; attrs: string } | null => {
  for (const button of buttons(html)) {
    const m = LOAD_MORE_SHAPE.exec(button.text);
    if (m !== null) return { n: Number(m[1] ?? ''), attrs: button.attrs };
  }
  return null;
};
assert.equal(
  LOAD_MORE_SHAPE.test(fresh('ranked.liveMore', { n: 7 })),
  true,
  '★ 探针：这个形状认得出它自己的词条',
);
assert.equal(
  LOAD_MORE_SHAPE.test(fresh('ranked.liveBothLive')),
  false,
  '★★ 探针：筛选条那颗 chip 的文案**不**匹配这个形状（否则下面每一条都会指到那颗开关上）',
);

/* ---- ① 搜索框与开关的**存在**与初值（不筛那一份） ---- */
assert.equal(
  elementsWithClass(live, 'filters__search').length,
  1,
  '★ 面板顶部有一个搜索框（用户原话：「在顶部加入搜索栏搜索选手」）',
);
const searchInput =
  /<input\b[^>]*>/.exec(elementsWithClass(live, 'filters__search')[0] ?? '')?.[0] ?? '';
assert.notEqual(
  searchInput,
  '',
  '★ 探针：那一块里确实有一个 `<input>`（否则下面几条作用在空串上）',
);
assert.equal(attrOf(searchInput, 'type'), 'search', '★ 它是一个 `type="search"` 的输入框');
assert.equal(
  attrOf(searchInput, 'placeholder'),
  t('ranked.liveSearch'),
  '★ 占位符是「搜索选手」（词条，不是写死的字）',
);
assert.equal(
  attrOf(searchInput, 'value'),
  '',
  '★ 默认（没打字）时输入框是**空**的 —— 也就是"不筛"',
);
assert.equal(
  elementsWithClass(live, 'filters__search')[0]?.includes('ranked-live-q'),
  true,
  '★ 那个 `<label class="sr-only">` 的 `htmlFor` 对得上输入框的 `id`（占位符一打字就没了，它得有名字）',
);
/* 开关：**关着**那一份的衣服与读屏话说的是同一件事（`aria-pressed` / `tagchip--on`）。 */
const chipOf = (html: string): { attrs: string; text: string } | undefined =>
  buttons(html).find((b) => b.text === fresh('ranked.liveBothLive'));
assert.notEqual(chipOf(live), undefined, '★ 开关在（文案「只看双方都在直播」）');
assert.equal(
  attrOf(chipOf(live)?.attrs ?? '', 'aria-pressed'),
  'false',
  '★ 默认关着 ⇒ `aria-pressed="false"`',
);
assert.equal(
  hasClassOf(`<button ${chipOf(live)?.attrs ?? ''}>`, 'tagchip--on'),
  false,
  '★ 默认关着 ⇒ **不**带 `tagchip--on`（那颗 chip 的选中态就是它）',
);

/* ---- ② 搜「选手」：命中哪几场、忽略大小写、搜不到时说什么 ---- */
assert.deepEqual(
  filterCards(liveFilter),
  ['StreamerA', 'SoloC', 'OfflineE'].map(flat),
  '★★ 正面对照：没打字、开关关着 ⇒ 三场都在（顺序仍是 `avgElo` 降序）',
);
const liveSearchHit = renderLive({ live: LIVE_FILTER, search: 'plaind' }, '对局·搜 plaind');
assert.deepEqual(
  filterCards(liveSearchHit),
  ['SoloC'].map(flat),
  '★★ 搜「plaind」只剩一场：命中的是**右侧**那个人的昵称（夹具里那场左侧叫 SoloC）',
);
const liveSearchUpper = renderLive({ live: LIVE_FILTER, search: 'PLAIND' }, '对局·大写搜索');
assert.deepEqual(
  filterCards(liveSearchUpper),
  filterCards(liveSearchHit),
  '★★ 大小写不敏感：大写输入与上面那一份**逐卡相同**',
);
assert.equal(
  textOf(elementsWithClass(liveSearchHit, 'ranked__meta')[0] ?? ''),
  fresh('ranked.liveFrom', { total: LIVE_FILTER.matches.length }),
  '★★ 筛完之后那句 total 说的还是**上游的 3 场**（不是筛后的 1 场 —— 两个数不许互相冒充）',
);
assert.equal(
  textOf(elementsWithClass(liveSearchHit, 'ranked__meta')[1] ?? ''),
  fresh('ranked.liveMatched', { matched: 1 }),
  '★★ 而紧跟着的第二行说「符合条件 1 场」（筛掉过东西时才有这一行）',
);
assert.deepEqual(
  metaOf(liveFilter),
  [fresh('ranked.liveFrom', { total: LIVE_FILTER.matches.length })],
  '★ 正面对照：**没筛**时不许出现「符合条件 N 场」那一行（它会把总数再说一遍）',
);
const liveSearchMiss = renderLive({ live: LIVE_FILTER, search: 'nobodyhere' }, '对局·搜不到');
assert.deepEqual(filterCards(liveSearchMiss), [], '★ 搜不到 ⇒ 一张卡片都不渲染');
assert.equal(
  textOf(elementsWithClass(liveSearchMiss, 'ranked__empty')[0] ?? ''),
  fresh('ranked.liveNoMatch'),
  '★★ 而且说的是「没有符合条件的对局。」—— **不是**「现在没有直播中的对局。」（后者是假话：上游那 3 场还在）',
);
assert.notEqual(
  fresh('ranked.liveNoMatch'),
  fresh('ranked.liveEmpty'),
  '★★ 探针：那两句本身必须不同（否则上面那条与"空集合"分不开）',
);

/* ---- ③ 「只看双方都在直播」：正例（含认不出的平台）与反例 ---- */
const liveBoth = renderLive({ live: LIVE_FILTER, bothLiveOnly: true }, '对局·只看双方都在直播');
assert.deepEqual(
  filterCards(liveBoth),
  ['StreamerA'].map(flat),
  '★★ 开关打开 ⇒ 只剩"双方都在直播"的那一场（右侧在 **kick** 上也算 —— 判据是 `liveUrl`，不是平台白名单）',
);
assert.equal(
  attrOf(chipOf(liveBoth)?.attrs ?? '', 'aria-pressed'),
  'true',
  '★★ 开关开着 ⇒ `aria-pressed="true"`（读屏软件听到的"开着"）',
);
assert.equal(
  hasClassOf(`<button ${chipOf(liveBoth)?.attrs ?? ''}>`, 'tagchip--on'),
  true,
  '★★ 而且戴上 `tagchip--on`（眼睛看到的"开着" —— 两个通道取自同一份判据）',
);
/*
 * ⚠️★ 两个条件**可组合**：搜索命中的那一场只有一方在直播 ⇒ 开关把它筛掉。
 *    写成 OR 的实现会在这里画出 `SoloC` 那张卡片（当场红）。
 */
const liveCombo = renderLive(
  { live: LIVE_FILTER, search: 'soloc', bothLiveOnly: true },
  '对局·搜索 + 双方都直播',
);
assert.deepEqual(
  filterCards(liveCombo),
  [],
  '★★ 搜索命中但只有一方在直播 ⇒ 一场不剩（搜索与开关是 **AND**）',
);
assert.equal(
  textOf(elementsWithClass(liveCombo, 'ranked__empty')[0] ?? ''),
  fresh('ranked.liveNoMatch'),
  '★ 而它说的是"没有符合条件的对局"（与上面那个搜不到的情形同一句话）',
);
assert.deepEqual(
  filterCards(
    renderLive(
      { live: LIVE_FILTER, search: 'streamerb', bothLiveOnly: true },
      '对局·搜索+开关都在',
    ),
  ),
  ['StreamerA'].map(flat),
  '★★ 两个条件同时命中 ⇒ 那一场在（上一个断言是"AND"，这一条是"AND 之后仍然找得到"）',
);

/* ---- ④ 「加载更多」：还剩几场、点到最后那一下 ---- */
/*
 * ⚠️★ 这里的 `shown` 是**手写的小数字**（5 / 12），不是 `RANKED_LIVE_BATCH`：
 *    12 场那一份用一批就全渲染完了（下面第一条），而"切在哪一张"要有断言就得
 *    自己指定一个小于 12 的数 —— `shown` 本来就是这个意思（"已经显示几张"）。
 */
const livePage1 = renderLive({ live: LIVE_MANY, shown: 5 }, '对局·只显示 5 张');
assert.equal(
  elementsWithClass(livePage1, 'ranked__match').length,
  5,
  '★ `shown: 5` ⇒ 只渲染 5 张卡片',
);
assert.equal(
  loadMoreOf(livePage1)?.n,
  LIVE_MANY.matches.length - 5,
  '★★ 「加载更多（还有 7 场）」里的 7 = 12 - 5：那个数**就是**还没渲染的场次（不是另算一遍）',
);
assert.equal(
  isDisabled(loadMoreOf(livePage1)?.attrs ?? ''),
  false,
  '★ 那颗按钮是**可点**的（不是一颗灰着的装饰）',
);
const liveAll = renderLive({ live: LIVE_MANY, shown: LIVE_MANY.matches.length }, '对局·全部显示完');
assert.equal(
  elementsWithClass(liveAll, 'ranked__match').length,
  LIVE_MANY.matches.length,
  '★ 全部显示完之后：12 张卡片一张不少',
);
assert.equal(
  loadMoreOf(liveAll),
  null,
  '★★ 而「加载更多」**整颗不渲染**（到头了不留一颗点下去什么都不发生的按钮）',
);
/* ⚠️ 探针：上面那条"没有按钮"必须不是"这颗按钮在别的夹具里也画不出来"（那是恒真的）。 */
assert.equal(
  loadMoreOf(livePage1) !== null,
  true,
  '★ 探针：同一份夹具、只把 `shown` 从 12 换成 5 ⇒ 按钮就出现了（判据真的跟着 `remaining` 走）',
);
/*
 * ★★ 分批 + 搜索叠在一起：剩下那几场的数字必须跟着筛后的集合走。
 *    ⚠️ 写成"筛后总数 - 一批"之类的第二份算式会印出比实际还剩的更大的数，
 *    而点一下**什么都不会多出来**（用户只会觉得按钮坏了）。
 */
const livePageFiltered = renderLive(
  { live: LIVE_MANY, shown: 5, search: 'p1' },
  '对局·搜索 + 分批',
);
assert.equal(
  elementsWithClass(livePageFiltered, 'ranked__match').length,
  3,
  '★ 搜「p1」命中 P1A/P10A/P11A 三场 ⇒ 三张卡片（`shown: 5` 比它大，所以全渲染）',
);
assert.equal(
  loadMoreOf(livePageFiltered),
  null,
  '★★ 而"还有 0 场" ⇒ 按钮不渲染（那个数不是"12 - 5 = 7"）',
);
assert.deepEqual(
  filterCards(livePage1).slice(0, 5),
  ['P11A', 'P10A', 'P9A', 'P8A', 'P7A'].map(flat),
  '★ 分批切的是**分最高的那几张**（`shown` 只决定切几刀，不决定谁排在前面）',
);
ok(
  '③b 筛选与分批：搜索框/开关在 + 大小写不敏感 + 双方都直播（含 kick）+ AND 组合 + 加载更多的正反',
);

// ---------------------------------------------------------------------------
console.log('④ Elo 排行榜：五列 + 并列排名原样 + 赛季结束时间 + highest 缺失 + 空态');
// ---------------------------------------------------------------------------
const elo = renderElo({}, '排行榜·正常');
const eloTable = elementsWithClass(elo, 'ranked__table')[0] ?? '';
assert.equal(elementsWithClass(elo, 'ranked__table').length, 1, '★ 一张表');
assert.deepEqual(
  [...eloTable.matchAll(/<th>([\s\S]*?)<\/th>/g)].map((m) => flat(m[1] ?? '')),
  [
    'ranked.colRank',
    'ranked.colNickname',
    'ranked.colElo',
    'ranked.colHighest',
    'ranked.colPhasePoint',
  ].map((key) => fresh(key)),
  '★★ 五个列头（排名 / 昵称 / elo / 最高 / 阶段分），顺序固定',
);
/*
 * ⚠️★ 每一格取的是**可见文字**（`textOf` 剥掉标签），不是那一段原始 HTML。
 *    2026-09-19 第三轮（`c70bb3f`）起昵称那一格从纯文本变成了
 *    `<button class="ranked__playerbtn">`（用户点它展开这位玩家）⇒ 用 `flat()`
 *    （它只还原实体、不剥标签）读那一格会拿到一串标记，下面那条"正向对照"就红在自己身上。
 *    ⚠️ 这不是放宽判据：其余四格本来就没有标签，`textOf` 与 `flat` 对它们逐字同值，
 *    而那几格原先的判据（`'1'` / `—` / `0`）一个字都没改、照旧绿 —— 等价性由它们自己证明。
 */
const cellsOfRow = (row: string): string[] =>
  [...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((c) => textOf(c[1] ?? ''));
/**
 * ★★ 表格里的**玩家行**（2026-09-19 第四轮改：榜上的行加了 `class="ranked__row"`）。
 *
 * ⚠️★ 改之前是 `/<tr>([\s\S]*?)<\/tr>/g` + `.slice(1)`（"裸 `<tr>` 减去表头"），
 *    而那个正则只认**不带属性**的 `<tr>` ⇒ 榜上的行一带上类名，它**一个都匹配不到**：
 *    实测原文 `★ 每一行一个玩家（5 行）` / `0 !== 5`。
 * ⚠️★ 判据的**强度**一点没减：数的仍然是**行本身**，不是"产物里包含某串字" ——
 *    把夹具里的一行删掉，下面每一条"几行"的断言照旧当场掉一个数（能红的证明见报告）。
 * ⚠️★ 为什么判据锚在 `ranked__row` 上：这一轮三种 `<tr>` 各占一个位置 ——
 *    表头那一行**没有类名**、玩家行（榜上的每一行与"固定在最上面"那一行）都是
 *    `ranked__row`、展开那一行是 `ranked__detailrow`（视图里那两段注释写着这件事）。
 *    ⇒ 这个选择器恰好等于"数据行"，而"展开出来的行"不会被当成一个玩家
 *    （旧写法靠"裸 `<tr>`"达到同一件事，这一版靠类名，两者的等价性由下面
 *    `★ 每一行一个玩家` 与 `★★ 渲染出来的是 N 行数据行` 这两条各自钉着）。
 * ⚠️★ 用 `elementsWithClass`（本文件那个有探针的提取器）而不是再写一个正则 —— 但**别指望它
 *    会把 `ranked__row--lookup` "当成" `ranked__row`**：那个提取器的判据是**整词相等**
 *    （`classes.includes(cls)`，探针在它上面那一段、`hasClassOf` 的说明同一条），
 *    所以 `ranked__row--lookup` **不**会因为"同一个词加了个修饰"而命中。
 *    ⚠️★ 它之所以成立，是因为**视图同时写了两个类名**：
 *    `className="ranked__row ranked__row--lookup"`（`RankedPanels.tsx` 那一行）——
 *    少写 `ranked__row` 那一半时，固定那一行会**从"数据行"里掉出去**
 *    （`★ 每一行一个玩家` 会少一行，而屏幕上那一行长得完全正常）。
 *    ⇒ 这条取法与视图那两个类名是**成对**的（④b③ 里"两行类名集合互比"那两条钉着这一对）。
 */
const eloRowsOf = (table: string): string[] => elementsWithClass(table, 'ranked__row');
const eloRows = eloRowsOf(eloTable).map((row) => cellsOfRow(row));
assert.equal(
  eloRows.length,
  ELO_USERS.length,
  `★ 每一行一个玩家（${String(ELO_USERS.length)} 行）`,
);
for (const [i, row] of eloRows.entries()) {
  assert.equal(
    row.length,
    5,
    `★★ 第 ${String(i + 1)} 行的五个格子都在（找到 ${String(row.length)} 个）`,
  );
}
/*
 * ★★ 排名列印的是上游的 `eloRank`，**不是下标 + 1**：夹具是 `3,3,5`，而"下标 + 1"
 *    会印成 `3,4,5` —— 看起来更"正常"，却是**错的**（第 4 名不存在）。
 * ⚠️★ 这里**没有**"再断言一次它不等于 `['3','4','5']`"那种探针（2026-09-16 终审删掉）：
 *    它被上面那条 `deepEqual` **蕴含**（整串都相等 ⇒ 后三格当然不等于另一串），
 *    所以它**不可能红** —— 一条不可能红的守卫比没有守卫更坏（`docs/pending.md §5.63`）。
 *    "错法是 `index + 1`"这件事现在由**这条注释**承载（也就是上面那句消息里已经写着的），
 *    探针那一份是白占一行。
 */
assert.deepEqual(
  eloRows.map((row) => row[0]),
  ['1', '2', '3', '3', '5'],
  '★★ 排名列**照上游原样**（并列的两个 3、之后跳到 5）',
);
assert.deepEqual(
  eloRows.slice(2).map((row) => row[0]),
  ['3', '3', '5'],
  '★★ 并列那三行就是 `3,3,5`（`index + 1` 会印成 `3,4,5`）',
);
/*
 * ⚠️ 日期按**本地时区 + 界面语言**印（`toLocaleDateString(i18n.language)`），
 *    而这里用**同一个算式**算期望值 —— 它证明的是"秒 → 毫秒那一步真的做了、
 *    语言也真的传进去了"，不是"某个具体日期"：
 *    · 视图忘了 `* 1000` ⇒ 它印 1970 年，与期望对不上；
 *    · 视图用了宿主机的 locale ⇒ 中文那一遍会印出 `9/15/2026`，也对不上。
 */
const localDate = (seconds: number): string => new Date(seconds * 1000).toLocaleDateString(LANG);
const seasonLine = metaOf(elo).join('|');
assert.ok(
  seasonLine.includes(fresh('ranked.season', { n: ELO_SEASON.number })),
  '★★ 顶部有**赛季号**（而且那个数字来自响应）',
);
/*
 * ★★ 赛季那一行现在只说**结束时间**（2026-09-19 第二轮用户原话：
 *    「赛季 12 2026/9/17 → 2026/12/30 **去掉起始时间**，改为『赛季 12 结束时间
 *    2026/12/30 赛段 1 结束时间 2026/9/30』」）。
 * ⚠️ 断的是**结束那一个**日期印出来了（秒 → 毫秒真的做了：忘了乘 1000 会印成 1970 年）。
 */
assert.ok(
  seasonLine.includes(fresh('ranked.seasonEndsAt', { when: localDate(ELO_SEASON.endsAt) })),
  '★★ 顶部有**赛季结束时间**（秒 → 毫秒那一步真的做了：忘了乘 1000 会印成 1970 年）',
);
assert.equal(/1970/.test(rawText(elo)), false, '★★ 产物里不许出现 1970（秒当毫秒用就是这个症状）');
/*
 * ★★★ 而**起始时间一个字都不许出现**。
 *
 * ⚠️★ 这一条是用户那句「去掉起始时间」的**可断言形式**：`seasonRange`
 *    （「{{from}} → {{to}}」）当时是**一条词条**，删掉它只是"今天没印"——
 *    谁把两格日期加回来（或把 `seasonEndsAt` 写成"起止"），这一条会红。
 * ⚠️ 判据用的是**起始日期那两个数字**（`localDate(startsAt)`），
 *    而不是"那一行里有没有 `→`"：符号可以换（`-`、`至`、`, `），
 *    而"用户不想看到的那个日期"只有一个身份。
 * ⚠️ 探针：两个日期本身必须不同，否则这一条在起始 == 结束的夹具上恒假（空跑）。
 */
assert.notEqual(
  localDate(ELO_SEASON.startsAt),
  localDate(ELO_SEASON.endsAt),
  '★★ 探针：夹具里赛季的开始与结束**不是同一天**（否则下面那条恒真）',
);
assert.equal(
  seasonLine.includes(localDate(ELO_SEASON.startsAt)),
  false,
  '★★★ 那一行里**没有**赛季起始日（用户点名去掉的那一半）',
);

/*
 * ★★ 赛段（2026-09-19 用户原话：「排行榜除了显示赛季时间，另外**并排**显示赛段信息」）。
 *
 * ⚠️★ "并排"的判据是**同一行**：赛季那四格住在**同一个** `.ranked__meta` 里
 *    （`metaOf(elo)[0]` 就是那一行）⇒ 把它挪到第二行、或者另起一个 `<p>`，
 *    这一条会当场红。分成两行会让赛段看起来与赛季不相干，而它是赛季**内部**的划分。
 * ⚠️ 赛段来自**另一个端点**（`/phase-leaderboard`，93 字节）：`/leaderboard` 里没有
 *    phase 对象（实测），所以这一格的代价就是那一次额外请求 —— 界面上看不出来。
 */
assert.ok(
  metaOf(elo)[0]?.includes(fresh('ranked.phase', { n: ELO_PHASE.number })),
  '★★ 赛季那一行里并排着**赛段号**（来自 `/phase-leaderboard`）',
);
assert.ok(
  metaOf(elo)[0]?.includes(fresh('ranked.phaseEndsAt', { when: localDate(ELO_PHASE.endsAt ?? 0) })),
  '★★ 以及**赛段的截止日**（秒 → 毫秒真的做了，语言也真的传进去了）',
);
assert.equal(
  metaOf(elo).length,
  1,
  '★★ 赛季与赛段必须在**同一行**里（`.ranked__meta` 的那一格就是"并排"这件事的判据）',
);
/*
 * ⚠️★ 上面那一条从 2026-09-19 第三轮（`c70bb3f` 的 ③）起**同时是另一件事的守卫**：
 *    那一轮加的两块读数（展开的卡片 `ranked__detailstats`、查询结果的 `ranked__lookupstats`）
 *    **不许**复用 `.ranked__meta` —— 谁把一行读数塞进来，"赛季与赛段在同一行"这句话就变成
 *    两句都成立、而其中一句是别人的话（视图里那两处注释写着同一条）。
 *    ⚠️ 它只管**这一屏**（正常态）；展开/查询那两屏上的同一件事由 ④b⑥ 末尾那两条钉着
 *    （那两屏的产物只有 ④b 里渲染得出来）。
 */
/*
 * ★★ 赛段那一格读不到时**不许**让排行榜变空，也不许静默消失：
 *    说的是「赛段信息暂时读不到」，而赛季那一行与整张榜照旧。
 *    ⚠️ 这是容器走辅助路径（`fatal: false`）的那一半 —— 界面上要有话说，
 *    但**不能**多出"读不到数据 + 重试"（那会让用户以为整页都废了）。
 */
const eloNoPhase = renderElo({ phase: null }, '排行榜·赛段读不到');
assert.ok(
  metaOf(eloNoPhase)[0]?.includes(fresh('ranked.phaseUnknown')),
  '★★ 赛段读不到 ⇒ 那一格说「赛段信息暂时读不到」（不是静默消失）',
);
assert.ok(
  metaOf(eloNoPhase)[0]?.includes(fresh('ranked.season', { n: ELO_SEASON.number })),
  '★★ 而**赛季那一行照旧**（一次 93 字节的失败不许把排行榜弄没）',
);
assert.equal(
  elementsWithClass(eloNoPhase, 'ranked__table')[0]?.match(/<td>/g)?.length,
  5 * ELO_USERS.length,
  '★★ 整张榜一个格子都没少（赛段那一格失败与榜本身是两件事）',
);
assert.deepEqual(
  elementsWithClass(eloNoPhase, 'notice'),
  [],
  '★★ 而且**不**多一句"读不到数据"（那会让用户以为整页都废了）',
);
/* 半份赛段：号数读得出、截止读不出 ⇒ 印号数，不印"读不到"（三格各自可空）。 */
const eloHalfPhase = renderElo(
  { phase: { number: 2, endsAt: null, season: 12 } },
  '排行榜·半个赛段',
);
assert.ok(
  metaOf(eloHalfPhase)[0]?.includes(fresh('ranked.phase', { n: 2 })),
  '★ 号数读得出就印出来',
);
assert.equal(
  metaOf(eloHalfPhase)[0]?.includes(fresh('ranked.phaseUnknown')),
  false,
  '★ 别因为截止读不出就说整格"读不到"（那是另一件事）',
);

/* `highest: null` ⇒ 占位符；而 `phasePoint: 0` 是**真的值**。 */
assert.equal(eloRows[1]?.[3], fresh('ranked.unknown'), '★★ `highest: null` ⇒ 那一格印 `—`');
assert.equal(eloRows[2]?.[4], flat('0'), '★ `phasePoint: 0` ⇒ 印 0（**不是**占位符）');
assert.equal(eloRows[1]?.[1], flat('Bravo'), '★ 正向对照：同一行别的格子都是真值');
/*
 * 160 条 ⇒ 只渲染前 150（`topEloEntries` **只截断不重排**）。
 * ⚠️★ 150 是**上游的硬上限**（实测 `count` / `page` 被静默忽略、响应恒为 150 条）
 *    ⇒ 界面上**没有"下一页"**，也不该有；这条断言钉的是"我们一条都不吞"那一半
 *    （150 条全在），而"再多也不撑爆页面"由夹具的 160 条钉住。
 */
const eloMany = renderElo({ elo: ELO_MANY }, '排行榜·160 条');
const eloManyTable = elementsWithClass(eloMany, 'ranked__table')[0] ?? '';
assert.equal(
  eloManyTable.match(/<td>/g)?.length,
  RANKED_ELO_TOP * 5,
  `★★ 160 条只渲染前 ${String(RANKED_ELO_TOP)} 行（${String(RANKED_ELO_TOP * 5)} 个格子）`,
);
/*
 * ★★ 第二半钉的是**行数本身**，不是格子总数（2026-09-19 复评 M1：这里原本是
 *    同一条断言原样抄了两遍 —— 第二遍一个字都不会多发现）。
 * ⚠️ 两件事真的不等价：一个"149 行、其中一行多印了 5 个格子"的实现
 *    格子总数照样是 750，只有行数这条会红。⇒ 上一条管总量、这一条管行数。
 * ⚠️ 行数走 `eloRowsOf()`（`ranked__row` 那些行），所以它**不含**表头那一行、
 *    也**不含**展开那一行（`ranked__detailrow`）—— 判据是"玩家行的条数"。
 */
assert.equal(
  eloRowsOf(eloManyTable).length,
  RANKED_ELO_TOP,
  `★★ 渲染出来的是 ${String(RANKED_ELO_TOP)} 行**数据行**（夹具 160 条，多的一条都不渲染）`,
);
/* 空集合是**自己的话**（不是"加载中"，也不是"出错了"）。 */
const eloEmpty = renderElo({ elo: ELO_EMPTY }, '排行榜·空集合');
assert.equal(
  textOf(elementsWithClass(eloEmpty, 'ranked__empty')[0] ?? ''),
  fresh('ranked.eloEmpty'),
  '★ 空集合 ⇒ 「这个赛季还没有人上榜。」',
);
assert.deepEqual(
  elementsWithClass(eloEmpty, 'ranked__table'),
  [],
  '★★ 空集合时**不渲染表**（一张只有表头的空表看起来像坏了）',
);
assert.ok(
  metaOf(eloEmpty)
    .join('|')
    .includes(fresh('ranked.season', { n: ELO_SEASON.number })),
  '★ 空集合时赛季那一行照常在（"空"是赛季的事，不是这一页坏了）',
);
ok(
  `排行榜：五列逐行 + 并列 3,3,5 + 赛季结束时间（无起始日）+ highest 缺失 + 前 ${String(RANKED_ELO_TOP)} + 空态`,
);

// ---------------------------------------------------------------------------
console.log('④b ★ Elo 排行榜（续）：搜索框 / 三档查询 / 展开的四个画面 / 三条兜底位置 / 那条红线');
// ---------------------------------------------------------------------------
/*
 * ★★ 这一节是 2026-09-19 第三轮（`c70bb3f` 的视图）**唯一**的自动化判据。
 *
 * 用户原话（与 ② 的筛选条同一句需求的两半）：
 *   「修改"ranked实时信息"的"排行榜"栏目，**点开后能查看最近比赛的情况/数据等**，
 *     另外在**顶部设置搜索框允许用户自行搜索玩家**。」
 *
 * ⚠️★ 先写清它**证得了什么、证不了什么**（免得下一个人高估它）：
 *   · 那三格状态（搜索词 / 那一次查询 / 展开那一位）**住在容器里**（`routes/Ranked.tsx`），
 *     而容器读 `window.location` ⇒ 在 Node 里渲染不了（文件头第一节）⇒ 这里钉的是
 *     "**视图拿着这三格状态渲染成什么样**"；
 *   · 「打字真的筛了」「点昵称真的展开了」「回车真的查了」与「展开真的只发两次请求、
 *     第二次点同一个人不再发」是**另一件事** —— `renderToStaticMarkup` 不跑 effect、
 *     不点击、不打字，它们逐条写在 `docs/pending.md §5.100`（每条都写着要人做什么）；
 *   · 这里能证的是：控件在不在、受控不受控（换一格 props 产物跟着换）、三档与四个画面
 *     各说各的话且互斥、详情落在三条判据各自那一处、以及那条**红线**
 *     （`players[].eloRate` 那个现值一个字符都没被印出来）。
 */

/* ---- ① 搜索框的结构（"打字真的筛了"证不了，见本节开头那一段） ---- */
const eloBase = renderElo({}, '排行榜·搜索框（起点）');
const searchForm = elementsWithClass(eloBase, 'ranked__search')[0] ?? '';
assert.notEqual(
  searchForm,
  '',
  '★★ 顶部有一个 `<form class="ranked__search">`（用户的"在顶部设置搜索框"）',
);
assert.equal(/^<form\b/.test(searchForm), true, '★ 它是一个 `<form>`（"回车能查"的结构前提）');
assert.equal(
  elementsWithClass(eloBase, 'ranked__search').length,
  1,
  '★★ 搜索框**只有一处**（两处会各自漂，而用户不知道该用哪一个）',
);
const searchFormTag = /<form\b[^>]*>/.exec(searchForm)?.[0] ?? '';
assert.equal(
  attrOf(searchFormTag, 'role'),
  'search',
  '★ `role="search"`：这一句是搜索地标（`biome-ignore` 那处豁免的理由写在视图里）',
);
const eloSearchInput = /<input\b[^>]*>/.exec(searchForm)?.[0] ?? '';
assert.notEqual(eloSearchInput, '', '★★ 那个表单里有一个输入框');
assert.equal(
  attrOf(eloSearchInput, 'type'),
  'text',
  '★★ `type="text"`（number 那一类会把字母吃掉，而用户敲的就是昵称）',
);
const searchButtons = buttons(searchForm);
assert.equal(
  searchButtons.length,
  1,
  `★★ 那个表单里恰好一颗按钮（找到 ${String(searchButtons.length)} 颗）`,
);
assert.equal(searchButtons[0]?.text, fresh('ranked.searchSubmit'), '★★ 它的文字是「查询」');
assert.equal(
  /(?:^|\s)type="submit"(?:\s|$)/.test(searchButtons[0]?.attrs ?? ''),
  true,
  '★★ 它是 `type="submit"`：**回车提交表单**靠的就是它（`type="button"` 提交不了，而产物里看不出差别）',
);
/*
 * ⚠️★ `sr-only` 的 label 必须用 `htmlFor`/`id` 与那个输入框**配对**：占位符在输入第一个字
 *    之后就没了，label 是控件**唯一**的名字 —— 配错（`for` 指向别的 id）会让读屏软件念出
 *    一个无名输入框，而产物里它与配对正确的**长得一模一样**。
 */
const searchId = attrOf(eloSearchInput, 'id') ?? '';
assert.notEqual(searchId, '', '★★ 输入框有 `id`（label 靠它配对）');
const searchLabel = /<label\b[^>]*>/.exec(searchForm)?.[0] ?? '';
assert.equal(
  attrOf(searchLabel, 'for'),
  searchId,
  '★★ `<label class="sr-only" for>` 与输入框的 `id` **成对**（配对错了读屏软件念不出名字）',
);
assert.equal(
  hasClassOf(searchLabel, 'sr-only'),
  true,
  '★ 那颗 label 走 `sr-only`：可见文字交给占位符，标签不该再占一行',
);
assert.equal(
  textOf(elementsWithClass(searchForm, 'sr-only')[0] ?? ''),
  fresh('ranked.searchLabel'),
  '★ 它的文字是 `ranked.searchLabel`（占位符不是它的替代品）',
);
/*
 * ★★ 受控：`value` 就是传进来的 `searchText`（**正向对照**：换一个值，产物里那个 `value`
 *    跟着换）。⚠️ 这是"打字真的进了容器、又真的回到输入框"在本脚本里能证的**一半**：
 *    另一半（`onChange` 真的接到了容器）在 `pending.md §5.100`。
 */
assert.equal(attrOf(eloSearchInput, 'value'), '', '★ 初始态：`value` 是空串（容器给的就是它）');
const eloTyped = renderElo({ searchText: 'Alph' }, '排行榜·框里打着 Alph');
const typedInput =
  /<input\b[^>]*>/.exec(elementsWithClass(eloTyped, 'ranked__search')[0] ?? '')?.[0] ?? '';
assert.equal(
  attrOf(typedInput, 'value'),
  'Alph',
  '★★ 输入框是**受控**的：`value` 就是传进来的 `searchText`（打了字界面上却不动是最坏的一种静默）',
);
assert.equal(
  textOf(elementsWithClass(eloBase, 'ranked__searchhint')[0] ?? ''),
  fresh('ranked.searchHint'),
  '★★ 紧贴在框下面那一条说明书（它说的是两个入口**各自**的代价：打字=本地筛、回车=精确查）',
);
/*
 * ★★ `onSubmit` + `preventDefault`：**产物里一个字都看不到**（SSR 不渲染事件处理器，
 *    文件头那一节写着），所以这一条只能读**源码**的形状 —— 与 `liverender.tsx` 的 F2 守卫
 *    （读 `routes/Live.tsx` 判"列表不再由 loading 状态决定画不画"）同一手法，不是第二套机制。
 * ⚠️★ 为什么必须先**剥注释**：`RankedPanels.tsx` 里那段"为什么必须 preventDefault"的说明
 *    逐字写着 `onSubmit` 与 `preventDefault` ⇒ 不剥注释的话，这一条会在"表单根本没接
 *    `onSubmit`"的情况下照样绿（`liverender.tsx` 那一节踩过同一个坑，那里写着）。
 * ⚠️ 判据两半 + 一条能红证明（喂一个没有 `onSubmit` 的样例，它**必须**判 false）。
 */
const PANELS_SOURCE = readFileSync(
  new URL('../src/components/RankedPanels.tsx', import.meta.url),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');
/**
 * ★ 某个 `<form>` 上挂着 `onSubmit`，而且那一格的 handler 里真的调了 `preventDefault()`。
 *
 * ⚠️ 判据锚在**类名**上（`anchor`），所以"另一个表单接好了、这一个没接"分得开。
 * ⚠️ `[^}]*` 不肯跨过 `}`：它把 `preventDefault()` 钉在**那一格的块体里**，
 *    而不是"这个表单里的某处恰好出现过这个词"。
 */
const formPreventsDefault = (source: string, anchor: string): boolean => {
  const at = source.indexOf(anchor);
  const end = source.indexOf('</form>', at);
  if (at < 0 || end < at) return false;
  return (
    /onSubmit=\{/.test(source.slice(at, end)) &&
    /onSubmit=\{[^}]*preventDefault\(\)/.test(source.slice(at, end))
  );
};
assert.equal(
  formPreventsDefault(PANELS_SOURCE, 'className="ranked__search"'),
  true,
  '★★ 搜索框那个 `<form>` 上有 `onSubmit`，且 handler 里 `preventDefault()` —— 不写的话表单会按默认行为导航到当前 URL（整页刷新，SPA 里的状态全丢）',
);
assert.equal(
  formPreventsDefault(PANELS_SOURCE, 'className="ranked__weekjump"'),
  true,
  '★★ ④ 那个手输周数的框同理（源码级判据，产物里看不到 —— 本脚本末尾那段覆盖边界原来只说"结构前提"，这一条把它兑现）',
);
assert.equal(
  formPreventsDefault(
    '<form onSubmit={(event) => {\n event.preventDefault();\n foo();\n}}>',
    'className="x"',
  ),
  false,
  '★ 能红证明：锚点对不上时判 false（否则上面两条只是"源码里出现过这两个词"的巧合）',
);
assert.equal(
  formPreventsDefault('<form className="x" onSubmit={() => foo()}>', 'className="x"'),
  false,
  '★★ 能红证明：有 `onSubmit` 但**没有** `preventDefault()` 的形态**不**被认出来（上面那半条判据真的有区分力）',
);
/*
 * ★ "在顶部"这件事的判据只能是**位置**（产物里那几段文字与改版前一模一样）：
 *   标题 → 搜索框 → 说明书 → 赛季那一行。
 * ⚠️ 锚点必须**唯一**：这一屏（正常态、没有 errorText）里 `.ranked__meta` 只有一个
 *    （失败那一屏上 `RankedRetry` 自己还会渲染一只）⇒ 先用 `metaOf` 数一遍再拿它当锚点。
 */
assert.equal(
  metaOf(eloBase).length,
  1,
  '★ 探针：正常那一屏里 `.ranked__meta` 只有一处（否则下面那条位置比较会命中更靠前的另一处）',
);
for (const [what, anchor] of [
  ['面板标题', '<h2 class="ranked__title">'],
  ['搜索框', '<form class="ranked__search"'],
  ['说明书', 'ranked__searchhint'],
  ['赛季那一行', 'ranked__meta'],
] as const) {
  assert.ok(eloBase.indexOf(anchor) > 0, `★ ${what}在产物里（否则下面那几条位置比较是空跑）`);
}
assert.ok(
  eloBase.indexOf('<form class="ranked__search"') > eloBase.indexOf('<h2 class="ranked__title">'),
  '★ 搜索框在面板标题**之后**（标题是这一块的名字，搜索框是它的内容）',
);
assert.ok(
  eloBase.indexOf('<form class="ranked__search"') < eloBase.indexOf('ranked__searchhint'),
  '★★ 而且在它自己那句说明书**之前**（说明书紧贴在框下面）',
);
assert.ok(
  eloBase.indexOf('ranked__searchhint') < eloBase.indexOf('ranked__meta'),
  '★★ 整块搜索框都在赛季那一行与成绩表**之前** —— 用户要的是"**顶部**设置搜索框"',
);
ok(
  '④b① 搜索框：form[role=search] + 输入框 + submit + sr-only label 配对 + 受控 + 源码里的 onSubmit/preventDefault + 在顶部',
);

/* ---- ② 本地筛选：打字 ⇒ 在**已经取到的那份榜**上筛（上游没有搜索端点，findings §7）---- */
/**
 * 产物里**数据行**的条数（`ranked__row` 那些行 —— 见 `eloRowsOf()` 上那一段）。
 *
 * ⚠️★ 判据必须数**行**，不能写成"产物里包含某串字"：后者对"印了 4 行"与"印了 2 行"
 *    完全一样 —— 那正是本仓最贵的一类缺陷（简报开头那句）。
 * ⚠️ 展开那一行是 `<tr class="ranked__detailrow">`，本函数不数它；
 *    "固定在最上面"那一行（`ranked__row--lookup`）**算**数据行 —— 它就是用户要的
 *    "搜索到的玩家是表里的一行"（这一轮 ① 那一条断言按这个口径数）。
 * ⚠️ 没有表时是 0：筛没了那一档**整张表都不渲染**（见视图里那两段注释），不是"渲染一张空表"。
 */
const eloDataRows = (html: string): number => {
  const table = elementsWithClass(html, 'ranked__table')[0];
  return table === undefined ? 0 : eloRowsOf(table).length;
};
/** 表格里每一行的昵称（昵称那一格是一颗按钮）。 */
const eloRowNicknames = (html: string): string[] =>
  elementsWithClass(elementsWithClass(html, 'ranked__table')[0] ?? '', 'ranked__playerbtn').map(
    (button) => textOf(button),
  );
const eloFilterBase = renderElo({ elo: ELO_SEARCH }, '排行榜·筛选夹具（不筛）');
assert.equal(
  eloDataRows(eloFilterBase),
  ELO_SEARCH.users.length,
  `★ 不筛时四行都在（下面每一条"筛出几行"的对照组；夹具里 ${String(ELO_SEARCH.users.length)} 行）`,
);
assert.deepEqual(
  eloRowNicknames(eloFilterBase),
  ['Alpha', 'AlphaTwo', 'Bravo', 'Charlie'],
  '★★ 四行的昵称逐条、**照上游顺序**（筛选不重排：重排会让排名列与行序对不上）',
);
/*
 * ★ 传**前缀** ⇒ 命中**两行**（`Alpha` / `AlphaTwo`，夹具里刻意让两位共享前缀）。
 * ⚠️★ 判据是**行数**与**每行的昵称**，不是"产物里有 Alpha 这串字"：四行的表里本来就有一行
 *    叫 Alpha ⇒ 那种写法对"筛完全没生效"与"筛对了"一视同仁。
 * ⚠️ `2` 这个数与"没筛"（4）和"筛没了"（0）都不同 ⇒ 一个"永远印整张榜"或"永远印一行"
 *    的实现会当场红。
 */
const eloFilterHit = renderElo({ elo: ELO_SEARCH, searchText: 'Alpha' }, '排行榜·筛 Alpha');
assert.equal(
  eloDataRows(eloFilterHit),
  2,
  '★★ 前缀命中 ⇒ 恰好 **2** 个数据行（四行里两位共享前缀）',
);
assert.deepEqual(
  eloRowNicknames(eloFilterHit),
  ['Alpha', 'AlphaTwo'],
  '★★ 而且就是那两位（逐条比昵称，不是"某处有 Alpha"）',
);
const eloFilterCase = renderElo({ elo: ELO_SEARCH, searchText: 'alphatwo' }, '排行榜·筛 alphatwo');
assert.equal(
  eloDataRows(eloFilterCase),
  1,
  '★ 忽略大小写：`alphatwo` ⇒ 1 行（纯函数那一半逐值钉在 `services/api/src/ranked-shared.test.ts`，这里钉"视图真的把搜索词交给了它"）',
);
assert.deepEqual(eloRowNicknames(eloFilterCase), ['AlphaTwo'], '★ 那一行就是 `AlphaTwo`');
const eloFilterNone = renderElo({ elo: ELO_SEARCH, searchText: 'zzz' }, '排行榜·筛没了');
assert.equal(eloDataRows(eloFilterNone), 0, '★★ 谁都匹配不上 ⇒ **一个数据行都没有**');
assert.deepEqual(
  elementsWithClass(eloFilterNone, 'ranked__table'),
  [],
  '★★ 而且**整张表不渲染**（只剩表头的一张空表看起来像坏了，与空集合那一档同一条）',
);
assert.equal(
  elementsWithClass(eloFilterNone, 'ranked__empty').length,
  1,
  '★ 恰好一句空态（"上游没人"与"你筛没了"不许同时出现）',
);
assert.equal(
  textOf(elementsWithClass(eloFilterNone, 'ranked__empty')[0] ?? ''),
  fresh('ranked.eloFilterEmpty', { q: 'zzz' }),
  '★★ 那一句是 `eloFilterEmpty`（"你筛没了"，而且带着那个搜索词）',
);
/*
 * ★★ 探针：`eloFilterEmpty` 与 `eloEmpty`（「这个赛季还没有人上榜。」）**必须不是同一句话**。
 * ⚠️ 少了它，上面那条在一个"上游本来就空"的夹具上也会绿 —— 而两句混用会让用户把
 *    "自己筛没了"读成"上游没人"，于是去别处找问题（该做的只是把搜索框里那个词删掉）。
 */
assert.notEqual(
  fresh('ranked.eloFilterEmpty', { q: 'zzz' }),
  fresh('ranked.eloEmpty'),
  '★★★ 探针：两句词条本身不同（否则上面那条判据分不开"筛没了"与"上游空了"）',
);
/*
 * ★★ 「空榜 + 搜索词」这一档：两句空态的**优先级**（视图里是先判 `users.length === 0`）。
 * ⚠️ 上面那两条各证一半，**都**证明不了"先判哪一个" —— 一个把两个分支调换的实现会在
 *    "上游本来就空、而搜索框里恰好有字"时印出「没有匹配「…」的玩家。」，
 *    也就是**把上游的事说成用户自己筛出来的**（用户于是去改搜索词，而榜本来就是空的）。
 */
const eloEmptyFiltered = renderElo(
  { elo: ELO_EMPTY, searchText: 'Alpha' },
  '排行榜·上游空了 + 搜索框里有字',
);
assert.equal(
  textOf(elementsWithClass(eloEmptyFiltered, 'ranked__empty')[0] ?? ''),
  fresh('ranked.eloEmpty'),
  '★★ 上游本身就空（这一屏还带着一个搜索词）⇒ 仍然说「这个赛季还没有人上榜。」',
);
assert.equal(
  textOf(eloEmptyFiltered).includes(fresh('ranked.eloFilterEmpty', { q: 'Alpha' })),
  false,
  '★★ 而且**不许**说「没有匹配「Alpha」的玩家。」（那会把"上游没人"说成"你筛没了"）',
);
ok('④b② 本地筛选：行数与每行的昵称逐条（两位共享前缀）+ 忽略大小写 + 筛没了那一句 + 空榜的优先级');

/* ---- ③ 三档查询：命中那一档成了**表里的一行**；没命中那两档照旧只说自己那一句 ---- */
/*
 * ★★ 2026-09-19 第四轮：**命中**（`lookup.kind === 'found'`）那一档的界面整体换了位置 ——
 *    查到的玩家从"表格**外面**的一块读数行"变成了**表格里的第一行**（`.ranked__row--lookup`）。
 *    用户原话：「自行搜索的玩家**页面布局和排行榜玩家相同**（无论是展开前还是展开后）」
 *    ⇒ 这一节的判据跟着换：不再是"那一块在不在"，而是"**那一行**在不在、长什么样、排在哪儿"。
 * ⚠️ 三档仍然是三档：`found` 走"行"，另外两档照旧渲染在表格**上面**（它们没有玩家可以变成一行）。
 */
assert.deepEqual(
  elementsWithClass(eloBase, 'ranked__lookup'),
  [],
  '★★ `lookup: null`（这一页还没查过）⇒ 那一块**整个不渲染**（不是渲染一个空框：多一行空白会让人以为上面那一步失败了）',
);
/**
 * `<tbody>` 里**每一行**的开标签（表头在 `<thead>` 里，所以它不在里面）。
 *
 * ⚠️★ 它与 `eloRowsOf()` 是**两条独立的取法**：一条**按类名**取元素，一条**按位置**扫标签。
 *    下面两条判据故意各用一条 —— "每一行都带 `ranked__row`"这件事**只能**从原始标签上
 *    看出来：拿类名当筛选条件、再断言"被筛出来的都有那个类名"是**同义反复**
 *    （一条不可能红的守卫比没有守卫更坏，`pending.md §5.63`）。
 */
const tbodyRowTags = (table: string): string[] => {
  const at = table.indexOf('<tbody>');
  const end = table.indexOf('</tbody>');
  assert.ok(
    at > 0 && end > at,
    '★ 探针：表体那一格在产物里（否则下面按 tbody 取的几条会静默空跑）',
  );
  return [...table.slice(at, end).matchAll(/<tr\b[^>]*>/g)].map((m) => m[0]);
};
/** 一个元素的开标签（`elementsWithClass` 取回来的片段**以它自己的开标签开头**）。 */
const openTagOf = (el: string): string => /^<[a-zA-Z][^>]*>/.exec(el)?.[0] ?? '';
const eloLookupFound = renderElo({ lookup: ELO_LOOKUP_FOUND }, '排行榜·查询命中');
const foundTable = elementsWithClass(eloLookupFound, 'ranked__table')[0] ?? '';
assert.notEqual(
  foundTable,
  '',
  '★ 探针：命中那一档表还在（下面五条都在那张表上做 —— 表没了它们会静默空跑）',
);
const foundRowTags = tbodyRowTags(foundTable);
/*
 * ★★★ ① 查到的玩家 = **表里的一行**，而且是**最前面**那一行。
 *
 * ⚠️★ 位置判据不能写成"表里有这么一行"：那样的写法对一个把这一行渲染到表尾、或者
 *    渲染了一张表**外面**的"单行表"的实现完全一样绿 —— 用户要的恰恰是"**固定在最上面**"。
 */
const foundLookupTags = foundRowTags.filter((tag) => hasClassOf(tag, 'ranked__row--lookup'));
assert.equal(
  foundLookupTags.length,
  1,
  `★★ ① 固定那一行**恰好一行**（找到 ${String(foundLookupTags.length)} 个）—— 两行就是"查到的玩家"被画了两遍`,
);
assert.equal(
  foundRowTags[0],
  foundLookupTags[0],
  '★★★ ① 它就是 `<tbody>` 的**第一行**（"固定在最上面"的可断言形式：位置，不是"存在"）',
);
assert.equal(
  foundTable.indexOf('<tbody>') < foundTable.indexOf('ranked__row--lookup'),
  true,
  '★★ ① 那一行在**表体里面**（`<tbody>` 之后）—— 它是一行表格行，不是表格上面多出来的一段',
);
/*
 * ★★★ ① 数据行数 = **1 + 榜上那些行**。
 * ⚠️ 数的是**行**（`<tbody>` 里每一个 `<tr>` 的开标签），不是"产物里包含某串字"。
 * ⚠️★ 这一条同时是"固定那一行没有把榜挤掉一行 / 没有被渲染成两行"的判据：
 *    少一行（榜被吃了一口）或多一行（他自己在榜上、而这是另一档夹具）都会红。
 */
assert.equal(
  foundRowTags.length,
  1 + ELO_USERS.length,
  `★★★ ① 数据行数 = 固定那一行 + 榜上那 ${String(ELO_USERS.length)} 行（数行，不是数"某串字出现过"）`,
);
/*
 * ★★★ ① 榜上的那些普通行**也有** `ranked__row`（"两种行同一套标记"）。
 * ⚠️★ 判据必须是**逐行**的（每一个 `<tr>` 各自查一次），不能是"产物里有 `ranked__row` 这个词"：
 *    后者对"只有固定那一行有类名、榜上五行都没有"完全一样绿 —— 而那正好是这一轮要防的
 *    那种半成品（用户看到的是"两行长得不一样"，而没有任何门禁说得出来）。
 */
for (const [i, tag] of foundRowTags.entries()) {
  assert.equal(
    hasClassOf(tag, 'ranked__row'),
    true,
    `★★★ ① 第 ${String(i + 1)} 行的标签是 \`${tag}\` —— 它**没有** \`ranked__row\`（两种行共用同一套标记：用户要的"布局相同"就落在这一条上）`,
  );
}
/*
 * ★★★ ① 两行的类名集合**除 `--lookup` 之外逐字相同**。
 *
 * ⚠️★ 这是一条**正面对照**：不是把每一行各自与一个字面量比，而是把"固定那一行"与
 *    "榜上第一行"**互相比** —— 两处各写一套类名（`row` / `row--pinned` 那种）时，
 *    与字面量的比较会一起改成新的字面量（两条断言同时被改写、照样绿），而这一条会红。
 * ⚠️ `--lookup` 必须在**同一行里**真的存在（下面那条探针）：不然"过滤掉它之后两边相等"
 *    会退化成"两个都没有修饰的那个词"—— 一个把修饰类名整个丢掉的实现照样绿。
 */
const foundLookupTag = foundLookupTags[0] ?? '';
assert.equal(
  hasClassOf(foundLookupTag, 'ranked__row--lookup'),
  true,
  '★ 探针：固定那一行真的带 `--lookup`（否则下面那条"除它之外逐字相同"是空跑）',
);
const foundLookupBaseClasses = classOf(foundLookupTag)
  .split(/\s+/)
  .filter((cls) => cls !== '' && cls !== 'ranked__row--lookup');
const foundBoardClasses = classOf(foundRowTags[1] ?? '')
  .split(/\s+/)
  .filter((cls) => cls !== '');
assert.notEqual(
  foundBoardClasses.length,
  0,
  '★ 探针：榜上第一行**有**类名（它是"另一种行"的代表；空集合会让下面那条恒真）',
);
assert.deepEqual(
  foundLookupBaseClasses,
  foundBoardClasses,
  '★★★ ① 两行的类名集合**除 `--lookup` 之外逐字相同**（同一个夹具里互相比，不是各自与一个字面量比）',
);
/*
 * ★★★ ① 五格逐格：排名 / 昵称 / elo / 最高 / 阶段分。
 * ⚠️ 期望值写**字面量**：从夹具现算（`String(ELO_DETAIL_USER.eloRank)` 那种）会让
 *    "印的是同一个数"变成**同义反复** —— 夹具改了而实现没跟上时两边一起变。
 * ⚠️★ 四个数与昵称**互不相同**（1 / `edcr` / 2349 / 2385 / 0）：同值的话
 *    "第 5 格印的是第 3 格那个数"照样绿，而那是这一条存在的理由。
 */
const foundLookupRowEl = elementsWithClass(foundTable, 'ranked__row--lookup')[0] ?? '';
assert.notEqual(foundLookupRowEl, '', '★ 探针：那一行取得到（否则下面两条是空跑）');
const foundLookupCells = cellsOfRow(foundLookupRowEl);
assert.equal(
  foundLookupCells.length,
  5,
  `★★★ ① 固定那一行**恰好五个格子**（五个列头 ⇒ 五格；找到 ${String(foundLookupCells.length)} 个）`,
);
assert.deepEqual(
  foundLookupCells,
  ['1', 'edcr', '2349', '2385', '0'],
  '★★★ ① 五格逐格 = 排名 1 / 昵称 edcr / elo 2349 / 最高 2385 / 阶段分 0（**顺序**也是判据：串位就是用户看到的"布局不同"）',
);
assert.equal(
  cellsOfRow(eloRowsOf(foundTable)[1] ?? '').length,
  5,
  '★ ① 对照：榜上的第一行同样是五个格子（同一套标记 ⇒ 同样的格数）',
);
const foundLookupButtons = elementsWithClass(foundLookupRowEl, 'ranked__playerbtn');
assert.equal(
  foundLookupButtons.length,
  1,
  '★★ ① 那一行的昵称格里**恰好一颗**昵称按钮（点它展开这位玩家 —— 与榜上那些行同一个入口）',
);
assert.equal(
  textOf(foundLookupButtons[0] ?? ''),
  'edcr',
  '★★ ① 那一格印的是**响应里**那个昵称（上游回的是规范写法，findings §6）',
);
assert.equal(
  attrOf(openTagOf(foundLookupButtons[0] ?? ''), 'aria-expanded'),
  'false',
  '★ ① 没有展开时它是 `aria-expanded="false"`（这一档没有 `detail`）',
);
/*
 * ★ 印的是**响应里**那个昵称，不是用户敲进去那串：搜索词是 `edcr`，响应里是 `Edcr`
 *   （上游对 `/users/voxio` 回的正是 `Voxio`，findings §6 最后一段）⇒ 一个"印查询词"的
 *   实现会在这里红，而它印出来的那串**看起来完全正常**。
 */
const eloLookupCased = renderElo(
  { searchText: 'edcr', lookup: ELO_LOOKUP_CASED },
  '排行榜·查询命中（响应里是 Edcr）',
);
const casedLookupRow =
  elementsWithClass(
    elementsWithClass(eloLookupCased, 'ranked__table')[0] ?? '',
    'ranked__row--lookup',
  )[0] ?? '';
assert.notEqual(casedLookupRow, '', '★ 探针：`Edcr` 那一档的固定行在（否则下面两条是空跑）');
assert.equal(
  textOf(elementsWithClass(casedLookupRow, 'ranked__playerbtn')[0] ?? ''),
  'Edcr',
  '★★ 印的是响应里那个昵称（`Edcr`），不是用户敲进去的那串（`edcr`）',
);
assert.equal(
  textOf(casedLookupRow).includes('edcr'),
  false,
  '★★ 而用户敲进去那串（`edcr`）**一个字符都不在**这一行里（印查询词的实现会在这里红，另一条在昵称那一格上）',
);
/*
 * ★★ 没命中的那两档：各自只说自己的那一句，而且**不为"查到的玩家"多渲染一行**。
 * ⚠️★ 三档的**互斥**在下面（每一档都断言另外那两句**不在**产物里）。
 * ⚠️★ 少了这一条，一个"永远印同一句"的实现会把上面三条全喂绿（第一句对、第二条也在，
 *    而"两句都在"比"少一句"更难被肉眼看见）。
 */
const eloLookupNotFound = renderElo({ lookup: ELO_LOOKUP_NOT_FOUND }, '排行榜·查无此人');
assert.equal(
  textOf(elementsWithClass(eloLookupNotFound, 'ranked__lookupmsg')[0] ?? ''),
  fresh('ranked.lookupNotFound'),
  '★★ 查无此人 ⇒ 「没有这个玩家。」',
);
const eloLookupInvalid = renderElo({ lookup: ELO_LOOKUP_INVALID }, '排行榜·昵称不合法');
assert.equal(
  textOf(elementsWithClass(eloLookupInvalid, 'ranked__lookupmsg')[0] ?? ''),
  fresh('ranked.lookupInvalid'),
  '★★ 昵称不合法 ⇒ 「这个昵称不合法（太长或格式不对）。」',
);
assert.equal(
  textOf(eloLookupFound).includes(fresh('ranked.lookupNotFound')),
  false,
  '★★ 命中那一档**不许**同时说「没有这个玩家。」',
);
assert.equal(
  textOf(eloLookupFound).includes(fresh('ranked.lookupInvalid')),
  false,
  '★★ 命中那一档**不许**同时说「这个昵称不合法…」',
);
assert.equal(
  elementsWithClass(eloLookupFound, 'ranked__lookupmsg').length,
  0,
  '★★ 命中那一档整条 `lookupmsg` 都不渲染（它只服务另外两档）',
);
assert.equal(
  textOf(eloLookupNotFound).includes(fresh('ranked.lookupInvalid')),
  false,
  '★★ 查无此人那一档**不许**同时说「这个昵称不合法…」',
);
assert.equal(
  textOf(eloLookupInvalid).includes(fresh('ranked.lookupNotFound')),
  false,
  '★★ 昵称不合法那一档**不许**同时说「没有这个玩家。」',
);
for (const [where, html] of [
  ['查无此人', eloLookupNotFound],
  ['昵称不合法', eloLookupInvalid],
] as const) {
  /*
   * ⚠️ 下面两条都**只看 `.ranked__lookup` 那一块**：榜上每一行的昵称也是一颗
   *    `.ranked__playerbtn`（五颗），不划范围的话这两条数的是"整张榜有没有按钮"。
   */
  const missBox = elementsWithClass(html, 'ranked__lookup')[0] ?? '';
  assert.notEqual(missBox, '', `★ ${where}：那一块在产物里（否则下面两条是空跑）`);
  assert.equal(
    elementsWithClass(missBox, 'ranked__playerbtn').length,
    0,
    `★★ ${where}：**不给**昵称按钮（一颗点下去只会得到同一句话的按钮比没有按钮更坏）`,
  );
  /*
   * ★★★ ④ 失败那两档**不为"查到的玩家"多渲染一行**：`<tbody>` 里一行都不多、也没有固定行。
   * ⚠️★ 判据是**行数**（不是"没有 `--lookup` 这个词"）：榜上那五行照旧在
   *    （"上游没有这个人"与"榜没了"是两件事），⇒ 行数必须**恰好等于榜上的行数**。
   */
  assert.equal(
    eloDataRows(html),
    ELO_USERS.length,
    `★★★ ④ ${where}：数据行数 = 榜上那 ${String(ELO_USERS.length)} 行（这一档**一行都不多**）`,
  );
  assert.equal(
    elementsWithClass(html, 'ranked__row--lookup').length,
    0,
    `★★★ ④ ${where}：也没有"固定在最上面"那一行（没有命中的人，就没有那一行可画）`,
  );
  assert.equal(
    elementsWithClass(html, 'ranked__detail').length,
    0,
    `★★ ④ ${where}：也没有任何展开的卡片（这一档连"展开谁"都谈不上）`,
  );
}
/*
 * ★★ ④ 的另一种形态：榜被搜索词**筛空** + 没命中 ⇒ 连表都没有，所以"一行都没有"是**字面**的。
 * ⚠️ 这一档是"主路径"的反面（`lookup: found` 时表要为那一行照样渲染，见 ⑥）：
 *    上游对这个人没有答案 ⇒ 表**整个不渲染**，而这与"榜被人筛没了"是同一屏上的两句话。
 */
const eloLookupNoneFiltered = renderElo(
  { elo: ELO_SEARCH, searchText: 'zzz', lookup: ELO_LOOKUP_NOT_FOUND },
  '排行榜·筛没了 + 查无此人',
);
assert.equal(
  eloDataRows(eloLookupNoneFiltered),
  0,
  '★★★ ④ 筛空 + 没命中：**一个数据行都没有**（这一档连表都不渲染）',
);
assert.equal(
  elementsWithClass(eloLookupNoneFiltered, 'ranked__table').length,
  0,
  '★ ④ 而那一句空态照旧（「没有匹配「zzz」的玩家。」）—— 见 ④b② 那一条',
);
assert.deepEqual(elementsWithClass(eloLookupNoneFiltered, 'ranked__detail'), [], '★ ④ 也没有卡片');
ok(
  '④b③ 三档查询：命中那一档是**表里第一行**（五格逐格 + 两行类名互比）+ 没命中那两档不为它多一行 + 三句互斥',
);

/* ---- ④ 展开的四个画面：loading / failed / ready 空 / ready 非空 ---- */
const eloDetailLoading = renderElo(
  { detail: { nickname: 'edcr', state: { kind: 'loading' } } },
  '排行榜·展开·加载中',
);
assert.equal(
  elementsWithClass(eloDetailLoading, 'ranked__detail').length,
  1,
  '★ 加载中那一档卡片也在（用户点过一下，屏幕上必须有回应）',
);
assert.equal(
  hasText(eloDetailLoading, t('common.loading')),
  true,
  '★★ 加载中 ⇒ **复用**既有的「加载中…」那一句（不新写一句）',
);
assert.deepEqual(
  elementsWithClass(eloDetailLoading, 'ranked__detailfailed'),
  [],
  '★ 而且**不**说"读不到"（"慢"与"挂了"必须分得开）',
);
const eloDetailFailed = renderElo(
  { detail: { nickname: 'edcr', state: { kind: 'failed' } } },
  '排行榜·展开·读不到',
);
assert.equal(
  textOf(elementsWithClass(eloDetailFailed, 'ranked__detailfailed')[0] ?? ''),
  fresh('ranked.detailFailed'),
  '★★ 读不到 ⇒ `ranked__detailfailed` 那一句',
);
assert.equal(
  elementsWithClass(eloDetailFailed, 'ranked__empty').length,
  0,
  '★★★ 而**不**说「最近没有比赛。」—— 一个该重试、一个是事实，两句必须互斥',
);
assert.notEqual(
  fresh('ranked.detailFailed'),
  fresh('ranked.detailNoMatches'),
  '★★ 探针：那两句词条本身不同（否则上面那条互斥是空跑）',
);
assert.equal(
  hasText(eloDetailFailed, t('common.loading')),
  false,
  '★ 也不说"加载中"（两个画面各自有话说）',
);
const eloDetailNoMatches = renderElo(
  {
    detail: {
      nickname: 'edcr',
      state: { kind: 'ready', data: { user: ELO_DETAIL_USER, matches: [] } },
    },
  },
  '排行榜·展开·最近没有比赛',
);
assert.equal(
  textOf(elementsWithClass(eloDetailNoMatches, 'ranked__empty')[0] ?? ''),
  fresh('ranked.detailNoMatches'),
  '★★ 0 场 ⇒ 「最近没有比赛。」（复用既有空态类：这是"上游说他没有比赛"，不是"我们没读到"）',
);
assert.equal(
  textOf(elementsWithClass(eloDetailNoMatches, 'ranked__detailtitle')[0] ?? ''),
  fresh('ranked.detailRecent', { n: 0 }),
  '★★ 那个 N 读的是**手上这份数组的长度**（不是请求里那个 `count`：用它会印出「最近 10 场」而下面只有 0 条）',
);
assert.deepEqual(
  elementsWithClass(eloDetailNoMatches, 'ranked__detailmatch'),
  [],
  '★★ 而且一场都不渲染（数节点）',
);
assert.equal(
  elementsWithClass(eloDetailNoMatches, 'ranked__detailfailed').length,
  0,
  '★★ 反方向也互斥：有话说的时候不说"读不到"',
);
const eloDetailReady = renderElo(
  { detail: { nickname: 'edcr', state: ELO_DETAIL_READY } },
  '排行榜·展开·四场',
);
const detailMatches = elementsWithClass(eloDetailReady, 'ranked__detailmatch');
assert.equal(
  detailMatches.length,
  ELO_MATCHES.length,
  `★★★ 场次数 === 夹具的场次数（**数节点**，不是"包含某串字"）：夹具 ${String(ELO_MATCHES.length)} 场，产物里 ${String(detailMatches.length)} 个 \`.ranked__detailmatch\``,
);
assert.equal(
  textOf(elementsWithClass(eloDetailReady, 'ranked__detailtitle')[0] ?? ''),
  fresh('ranked.detailRecent', { n: ELO_MATCHES.length }),
  '★★ 标题那个 N 也是 4（它读的是同一个数组的长度）',
);
/**
 * 一场里某一格的可见文字；那一格不存在时回一个**不可能印出来**的记号
 * （回空串的话，"这一格没渲染"与"这一格渲染成空"就分不开了 —— 而后者才是真缺陷）。
 */
const cellOf = (matchHtml: string, cls: string): string => {
  const el = elementsWithClass(matchHtml, cls)[0];
  return el === undefined ? '(absent)' : textOf(el);
};
assert.deepEqual(
  detailMatches.map((m) => cellOf(m, 'ranked__detailopp')),
  ['Voxio', 'Voxio', 'Voxio', fresh('ranked.unknown')],
  '★★ 对手昵称逐条：三场是对手，第 4 场（他不在 `players[]` 里）⇒「—」，**不**顺手把第一个别人当成他的对手',
);
assert.deepEqual(
  detailMatches.map((m) => cellOf(m, 'ranked__detailoutcome')),
  ['ranked.outcomeWin', 'ranked.outcomeDraw', 'ranked.outcomeLoss', 'ranked.outcomeUnknown'].map(
    (key) => fresh(key),
  ),
  '★★★ 结果逐条：胜 / **平**（`result.uuid: null` ⇒「平」，**不是**「负」）/ 负 / 「—」（读不到 —— 一个"兜底成负"的实现会在这里红，而假的败场看起来完全正常）',
);
assert.deepEqual(
  detailMatches.map((m) => cellOf(m, 'ranked__detailtime')),
  ['6:27.772', '8:35.686', '6:40.000', '1:01.000'],
  '★★ 用时逐条（**毫秒** ⇒ `formatRaceTime`，错当秒会印出 `0:05`。⚠️ `result.time` 是**胜者**的成绩：负场那一行印的是**对手**的 —— 这条照实测写，不许断言成"都是他的用时"）',
);
assert.deepEqual(
  detailMatches.map((m) => cellOf(m, 'ranked__detailelo')),
  ['+12', '-8', fresh('ranked.unknown'), fresh('ranked.unknown')],
  '★★★ elo 变化逐条：`+12` / `-8` / **「—」**（私人房 `changes: []`）/「—」（他不在场）—— **绝不是 `+0` 或 `0`**（0 的意思是"打了这一场、分数没变"，那是一句我们并不知道的话）',
);
assert.deepEqual(
  detailMatches.map((m) => cellOf(m, 'ranked__detailtype')),
  [
    'ranked.matchTypeRanked',
    'ranked.matchTypeCasual',
    'ranked.matchTypePrivate',
    'ranked.matchTypeEvent',
  ].map((key) => fresh(key)),
  '★★ 比赛类型逐条：四种各一次（私人房那一格解释了同一行里那两个「—」：它本来就没有 elo 变化与种子）',
);
/*
 * ★★ 上游哪天加**第五种**类型（`MATCH_TYPE_KEYS[type] === undefined` 那一支）：
 *    印**上游那个数字**原样，不印裸 key、也不编一句"未知"。
 *
 * ⚠️★ 这一支 2026-09-19 之前**没有夹具**（表里只有 1..4）⇒ 那三行代码是"谁都没验过的死代码"。
 *    它与上面那条"他不在 `players[]` 里 ⇒ —"同源（同一个理由：本脚本喂的是**已经解析好的形状**，
 *    所以解析层产不出来的档位在这里手写一场就到了），而**判据不同**：
 *    这里上游**给了**一个真的类型值，只是我们的表不认识它 —— 印一句"未知"会把
 *    "上游加了新的比赛类型"这件事藏起来（与 `timelineLabel()` 的未登记回落同一条处置）。
 * ⚠️ 期望值写**字面量** `'5'`：从 `String(ELO_MATCH_TYPE_UNKNOWN.type)` 现算的话，
 *    "印的是同一个数"就成了同义反复（夹具与实现一起改也照样绿）。
 */
const eloDetailTypeUnknown = renderElo(
  {
    detail: {
      nickname: 'edcr',
      state: {
        kind: 'ready',
        data: { user: ELO_DETAIL_USER, matches: [ELO_MATCH_TYPE_UNKNOWN] },
      },
    },
  },
  '排行榜·展开·上游加了第五种比赛类型',
);
const typeUnknownMatch = elementsWithClass(eloDetailTypeUnknown, 'ranked__detailmatch')[0] ?? '';
assert.notEqual(typeUnknownMatch, '', '★ 那一场在产物里（否则下面三条是空跑）');
assert.equal(
  cellOf(typeUnknownMatch, 'ranked__detailtype'),
  '5',
  '★★ 表里查不到 ⇒ 印**上游那个数字**原样（构造一个"未知"的说法会把上游加了新类型这件事藏起来）',
);
assert.equal(
  textOf(typeUnknownMatch).includes('undefined'),
  false,
  '★★ 也不许印出 `undefined`（把一个 `string | undefined` 直接塞进模板串的产物就是它）',
);
assert.equal(
  textOf(typeUnknownMatch).includes('ranked.matchType'),
  false,
  '★★ 也不许印出裸 key（表里没有这一档时 `t()` 拿到的是 `undefined`）',
);
assert.deepEqual(
  detailMatches.map((m) => cellOf(m, 'ranked__detailseed')),
  [
    'DESERT_TEMPLE·STABLES',
    'DESERT_TEMPLE·STABLES',
    fresh('ranked.unknown'),
    'DESERT_TEMPLE·STABLES',
  ],
  '★★ 种子逐条（上游的英文标识**原样**；私人房两格都是 `null` ⇒「—」，印空串会让那一格看起来像"这一场本来就没有种子这一栏"）',
);
/* ★★ 录像的**两个方向**都要断：`vod: []` 那两场**没有**链接，有 VOD 的那两场各一条。 */
assert.deepEqual(
  detailMatches.map((m) => elementsWithClass(m, 'ranked__detailvod').length),
  [0, 1, 1, 0],
  '★★ 录像逐条（`vod: []` ⇒ 没有入口 —— 一条指向空地址的「录像」比没有入口更坏；有的一条 ⇒ 恰好一条）',
);
const vodLink =
  /<a\b[^>]*>/.exec(elementsWithClass(detailMatches[1] ?? '', 'ranked__detailvod')[0] ?? '')?.[0] ??
  '';
assert.equal(
  attrOf(vodLink, 'href'),
  'https://www.twitch.tv/videos/1',
  '★★ 链接用的是 `vod[].url`（不是拼出来的、也不是另一条的）',
);
assert.equal(attrOf(vodLink, 'target'), '_blank', '★ 新窗口打开');
assert.equal(
  attrOf(vodLink, 'rel'),
  'noopener noreferrer',
  '★★ 第三方地址带 `noreferrer`（`noopener` 独自挡不住 referrer 泄漏）',
);
assert.equal(
  textOf(elementsWithClass(detailMatches[1] ?? '', 'ranked__detailvod')[0] ?? ''),
  fresh('ranked.detailVod'),
  '★★ 它的文字是「录像」',
);
/*
 * ★★ 卡片第一行那**五格读数**逐格。期望值写字面量（2349 / 1 / 96·12 / 800·700 / 6:27.772）：
 *    从夹具现算会让"印的是同一个数"变成同义反复。
 * ⚠️ 最佳成绩那一格是**毫秒**（`season.bestTimeMs` 实测 387772 = 6:27.772）。
 */
assert.deepEqual(
  [
    ...(elementsWithClass(eloDetailReady, 'ranked__detailstats')[0] ?? '').matchAll(
      /<span>([\s\S]*?)<\/span>/g,
    ),
  ].map((m) => textOf(m[0])),
  [
    fresh('ranked.detailElo', { elo: 2349 }),
    fresh('ranked.detailRank', { rank: 1 }),
    fresh('ranked.detailSeasonRecord', { wins: 96, loses: 12 }),
    fresh('ranked.detailTotalRecord', { wins: 800, loses: 700 }),
    fresh('ranked.detailBestTime', { time: '6:27.772' }),
  ],
  '★★ 卡片第一行五格读数逐格：elo / 排名 / 本赛季 / 全时段 / 本赛季最佳（最后那一格是**毫秒** ⇒ formatRaceTime）',
);
ok(
  '④b④ 展开四个画面：两个句话互斥 + 0 场 + 四场逐格（对手/结果/用时/elo/类型/种子/录像）+ 五格读数',
);

/* ---- ⑤ ★★★ 那条红线：`players[].eloRate` 是**现值**，不许当成那一刻的 elo 印出来 ---- */
/*
 * ⚠️★ 这一条是**本轮唯一"会静默错"的字段**的**唯一**可自动化判据（findings §2.1 底部三场
 *    实测：一场 season 11 的比赛里 `players[].eloRate` 印的仍是本赛季**现在**的 elo）。
 *    判据是"整个产物里**一个字符都没有**那个哨兵"，扫的是**原文（含属性）**：
 *    ⚠️ 用可见文字扫会漏掉一整类实现 —— 那一刀是 spec §11.4 的 **mutation ㉒**
 *    （把对手的现值塞进 `title={opponent.eloRate}`）：每一格的**可见文字**一毫不差，
 *    而这一条当场红。这正是它必须扫 `rawText` 的理由。
 *    ⚠️★ 而"必须扫 `rawText`"这件事**必须由下面那条金丝雀来守**，且金丝雀本身要长得像
 *    那个会漏掉它的形状：哨兵放在**属性**里（`title="…"`），正文里一个字都没有。
 *    换成 `<p>987654</p>`（哨兵作为**文本**）的话，哪天有人把 `rawText` 简化成 `textOf`
 *    （剥掉标签只看文字），金丝雀**照样绿**，而这一条就正好丢掉上面那种实现。
 *    ⇒ 金丝雀钉的是"这个扫描器认得**属性里**的哨兵"，不是"它认得哨兵"。
 * ⚠️★ **它的代价写清楚**：它防的是"印了**现值**"，防不了"印错成**赛后值**"
 *    （`changes[].eloRate` 那一类）—— 后者由上面那条逐值断言
 *    （`['+12','-8','—','—']`）兜着，两条合起来才盖住这一格。
 */
const SENTINEL_CANARY_HTML = `<p title="${String(ELO_PRESENT_SENTINEL)}">x</p>`;
assert.equal(
  rawText(SENTINEL_CANARY_HTML).includes(String(ELO_PRESENT_SENTINEL)),
  true,
  '★★ 能红证明：这个扫描器认得出**属性里**的哨兵（否则下面那几条恒真）',
);
/*
 * ⚠️★★ 反向的一半（2026-09-19 修复轮加的）：同一个金丝雀**必须**骗得过 `textOf` ——
 *    也就是"属性里的哨兵在可见文字里找不到"。这一条把上面那条金丝雀**钉在
 *    `rawText` 这个实现上**：谁把 `rawText` 换成 `textOf`，上面那条当场红
 *    （而只写上面那一条的话，`<p>987654</p>` 那种文本金丝雀对换实现完全免疫 ——
 *    它绿的，而下面那个 `for` 循环里那五条全部变成空跑）。
 */
assert.equal(
  textOf(SENTINEL_CANARY_HTML).includes(String(ELO_PRESENT_SENTINEL)),
  false,
  '★★★ 而它在**可见文字**里找不到（`textOf` 剥掉标签 ⇒ 换实现的守卫就是靠这一条咬动的）',
);
for (const [where, html] of [
  ['展开（四场）', eloDetailReady],
  ['展开（0 场）', eloDetailNoMatches],
  ['展开（加载中）', eloDetailLoading],
  ['展开（读不到）', eloDetailFailed],
  ['查询结果', eloLookupFound],
] as const) {
  assert.equal(
    rawText(html).includes(String(ELO_PRESENT_SENTINEL)),
    false,
    `★★★ 红线（${where}）：产物里出现了 \`players[].eloRate\` 那个**现值**（${String(ELO_PRESENT_SENTINEL)}）—— 它不是那一场当时的值（findings §2.1）`,
  );
}
/*
 * ★ 正面对照：那一格印的数**就是**夹具 `changes[]` 里那一条。
 * ⚠️ 从夹具现算（而不是再抄一遍 `'+12'`）：判据是"印出来那串 === `changes[].change` 的渲染"
 *    ⇒ 一个"印对手涨跌"或"印赛后 elo（2361）"的实现会在这里红。
 * ⚠️ 前面那条探针先钉住"夹具里那一条真的是 12"，否则下面那条是在比 `null`。
 */
const selfChange = ELO_MATCH_WIN.changes.find((change) => change.uuid === ELO_SELF_UUID)?.change;
assert.equal(selfChange, 12, '★ 探针：夹具里他自己的那一条是 `+12`（否则下面那条在比 `null`）');
assert.equal(
  cellOf(detailMatches[0] ?? '', 'ranked__detailelo'),
  `+${String(selfChange)}`,
  '★★ 正面对照：那一格印的就是 `changes[].change`（正数带 `+`：不带号时读不出是涨还是跌，而负场印的是 `-8`）',
);
ok('④b⑤ ★★★ 红线：现值（哨兵 987654）在五个产物里一个字符都没有 + 变化量来自 changes[]');

/* ---- ⑥ 展开的那一位渲染在**哪里**（三条兜底判据，按顺序；同一屏里恰好一块详情）---- */
/*
 * ⚠️★ 为什么非要有②③（"表里没有就不渲染"是不够的）：60 秒的轮询会**整份换掉** `elo`，
 *    那位玩家可能**掉出前 150**；搜索框又会把整张榜筛小。两种情况下他都可能不在表里 ——
 *    静默消失会让用户以为自己那一下没生效（他会再点一次，而那一下落在别的东西上）。
 */
assert.equal(
  elementsWithClass(eloBase, 'ranked__detail').length,
  0,
  '★ 没有展开时一块详情都没有（下面三条的对照组）',
);
assert.equal(elementsWithClass(eloBase, 'ranked__detailrow').length, 0, '★ 也没有展开行');
const eloInTable = renderElo(
  { detail: { nickname: 'Bravo', state: ELO_READY_BRAVO } },
  '排行榜·展开·表里有他',
);
/*
 * 判据① `Bravo` 就在表里 ⇒ 详情紧跟**那一行**之后，是表格里的 `<tr class="ranked__detailrow">`。
 * ⚠️★★ 判据是**顺序**（"紧跟"），不是"存在"：一个把详情行渲染到表尾、或者渲染到表格外面
 *     的实现，用"表里有 `.ranked__detailrow`"这种写法照样绿（照既有"周赛导航在顶部"那条的写法）。
 */
const bravoRowAt = eloInTable.indexOf('>Bravo</button>');
const eloDetailRowAt = eloInTable.indexOf('<tr class="ranked__detailrow">');
assert.ok(bravoRowAt > 0, '★ `Bravo` 那一行的昵称按钮在产物里（否则下面那两条位置比较是空跑）');
assert.ok(eloDetailRowAt > bravoRowAt, '★★ 判据①：详情那一行在 `Bravo` 那一行**之后**');
assert.ok(
  eloInTable.indexOf('</tr>', bravoRowAt) < eloDetailRowAt,
  '★★★ 判据①：而且是**紧跟**（两者之间没有别的行）',
);
assert.equal(
  elementsWithClass(eloInTable, 'ranked__detailrow').length,
  1,
  '★★ 判据①：表格里**恰好一行**展开行',
);
const eloDetailRowEl = elementsWithClass(eloInTable, 'ranked__detailrow')[0] ?? '';
assert.equal(
  elementsWithClass(elementsWithClass(eloInTable, 'ranked__table')[0] ?? '', 'ranked__detail')
    .length,
  1,
  '★★ 判据①：那一块卡片在**表格里面**',
);
assert.equal(
  elementsWithClass(eloDetailRowEl, 'ranked__detail').length,
  1,
  '★ 判据①：而且就在那一行里',
);
/*
 * ⚠️★★ 那一格跨五列：产物里是 `colSpan="5"`（**照 JSX 原样**，不是 `colspan`）——
 *    本机 React 19.3 的 `renderToStaticMarkup` 实测如此（视图那一格上写着同一条）。
 *    HTML 的属性名不区分大小写，浏览器照样当 `colspan` 解；**按 `colspan` 写断言会恒假**
 *    —— 那不是"另一个写法"，是一条永远不会红的守卫（`pending.md §5.63`）。
 */
assert.equal(
  /\bcolSpan="5"/.test(eloDetailRowEl),
  true,
  '★★ 判据①：那一格是 `colSpan="5"`（五列 ⇒ 跨满；少一列会让整行挤在第一列里，而表格本身不会报错）',
);
/*
 * 判据③（`Bravo` 被搜索词筛掉了 ⇒ 卡片落到**表格下面**）。
 * ⚠️ 这一条同时是"筛选把他筛掉了却还留在表里"的反面：过滤看起来坏掉，比卡片消失更容易查到，
 *    但"点一下凭空消失、又没有任何入口找回来"才是更糟的那一半（视图里写着这段权衡）。
 */
const eloFilteredAway = renderElo(
  { searchText: 'Alpha', detail: { nickname: 'Bravo', state: ELO_READY_BRAVO } },
  '排行榜·展开·被筛掉',
);
const eloBelowEl = elementsWithClass(eloFilteredAway, 'ranked__detail')[0] ?? '';
assert.notEqual(eloBelowEl, '', '★★ 判据③：那一块在产物里（**不静默消失** —— 用户点过一下）');
assert.ok(
  eloFilteredAway.indexOf(eloBelowEl) > eloFilteredAway.indexOf('</table>'),
  '★★★ 判据③：它落在整张表**之后**（`</table>` 之后、表格外面）—— "他在表里"这件事不成立，在表里给他找一行是自相矛盾的',
);
assert.equal(
  elementsWithClass(eloFilteredAway, 'ranked__detailrow').length,
  0,
  '★★ 判据③：表里**没有**他那一行（他被筛掉了）',
);
const eloBelowButtons = elementsWithClass(eloBelowEl, 'ranked__playerbtn');
assert.equal(
  eloBelowButtons.length,
  1,
  '★★ 判据③：那一块第一行是一颗昵称按钮（不然用户**没有任何办法**把它收起来，只能刷新整页）',
);
assert.equal(textOf(eloBelowButtons[0] ?? ''), 'Bravo', '★ 那颗按钮上是他的名字');
assert.equal(
  attrOf(eloBelowButtons[0] ?? '', 'aria-expanded'),
  'true',
  '★★ 它是 `aria-expanded="true"`：这一块真的开着（另外两处各自已有一颗控件管着它，这里再放一颗会让读屏软件念出两个长得一样、管的东西却不同的控件）',
);
/*
 * ★★★ ② 展开之后是**同一张卡片**（`RankedDetailBlock`），而且位置判据与榜上那些行一致：
 *    **紧跟固定那一行之后**、同一个 `<tr class="ranked__detailrow">`、`colSpan="5"`。
 *
 * 用户原话是「页面布局和排行榜玩家相同（无论是**展开前还是展开后**）」⇒ 展开这一半的
 * 判据不是"卡片在不在"（那对"卡片长在表格外面"照样绿），而是**它是哪一行下面的那一行**。
 * ⚠️ 表里没有 `edcr`（他不是榜上前 150 里的人）⇒ 判据① 不成立，而"查到的就是他"成立
 *    ⇒ 卡片按**判据②**落在**固定那一行**后面。
 */
const eloInLookup = renderElo(
  { lookup: ELO_LOOKUP_FOUND, detail: { nickname: 'edcr', state: ELO_DETAIL_READY } },
  '排行榜·展开·落在固定那一行里',
);
const inLookupTable = elementsWithClass(eloInLookup, 'ranked__table')[0] ?? '';
assert.notEqual(inLookupTable, '', '★ 探针：表在产物里（下面几条的位置比较都以它里面的行为锚点）');
const inLookupPinned = elementsWithClass(inLookupTable, 'ranked__row--lookup')[0] ?? '';
assert.notEqual(inLookupPinned, '', '★ 探针：固定那一行在（它是判据②的锚点）');
assert.equal(
  eloRowsOf(inLookupTable)[0],
  inLookupPinned,
  '★★ ② 展开**不会**把固定那一行挪走：它仍然是 `<tbody>` 的第一行',
);
const inLookupPinnedEnd = inLookupTable.indexOf(inLookupPinned) + inLookupPinned.length;
const inLookupDetailAt = inLookupTable.indexOf('<tr class="ranked__detailrow">');
assert.notEqual(inLookupDetailAt, -1, '★ 探针：展开那一行在产物里（否则下面两条是空跑）');
assert.ok(
  inLookupDetailAt >= inLookupPinnedEnd,
  '★★★ ② 展开那一行在固定那一行**之后**（不是渲染到表尾、也不是表格外面）',
);
assert.equal(
  /<tr\b/.test(inLookupTable.slice(inLookupPinnedEnd, inLookupDetailAt)),
  false,
  '★★★ ② 而且是**紧跟**（两者之间一个 `<tr` 都没有 —— 这一条把"渲染到表尾"与"紧跟"分开）',
);
assert.equal(
  elementsWithClass(eloInLookup, 'ranked__detailrow').length,
  1,
  '★★ ② 表格里**恰好一行**展开行（两行就是同一张卡片被画了两遍）',
);
const inLookupDetailRowEl = elementsWithClass(inLookupTable, 'ranked__detailrow')[0] ?? '';
assert.notEqual(inLookupDetailRowEl, '', '★ 探针：那一行取得到（下面两条在它上面做）');
/*
 * ⚠️★★ 那一格跨五列：产物里是 `colSpan="5"`（**照 JSX 原样**，不是 `colspan`）——
 *    本机 React 19.3 的 `renderToStaticMarkup` 实测如此（视图那一格上写着同一条）。
 *    HTML 的属性名不区分大小写，浏览器照样当 `colspan` 解；**按 `colspan` 写断言会恒假**
 *    —— 那不是"另一个写法"，是一条永远不会红的守卫（`pending.md §5.63`）。
 */
assert.equal(
  /\bcolSpan="5"/.test(inLookupDetailRowEl),
  true,
  '★★ ② 那一格是 `colSpan="5"`（五列 ⇒ 跨满；少一列会让整行挤在第一列里，而表格本身不会报错）',
);
assert.equal(
  elementsWithClass(inLookupTable, 'ranked__detail').length,
  1,
  '★★ ② 那一块卡片在**表格里面**（与榜上那些行的卡片同一个位置口径）',
);
assert.equal(
  elementsWithClass(inLookupDetailRowEl, 'ranked__detail').length,
  1,
  '★ ② 而且就在那一行里',
);
/*
 * ★★★ ② 的**第二档**（T1 报告 §3.5 第 4 条点名要的夹具）：查到的这位**同时**也在榜上。
 *
 * ⚠️★ 这一档上一轮**没有**夹具（"表里有他但没查过"与"查到他但不在表里"各占一半），
 *    而它正是用户当场拍的那个口径的代价所在：**同一屏两行同名**。
 * ⚠️★ 判据仍然是"恰好一块" + "卡片落在**榜上那一行**下面"（判据①优先）：
 *    一个把卡片挪到固定那一行下面的实现，屏幕上看着也挺合理（两行都是他），
 *    但它会**违反**已经裁过的那条判据 —— 所以下面两条位置断言是**成对**的
 *    （"紧跟榜上那一行"与"**不是**紧跟固定那一行"）。
 */
const eloFoundInTable = renderElo(
  {
    lookup: { kind: 'found', user: { ...ELO_DETAIL_USER, nickname: 'Bravo' } },
    detail: { nickname: 'Bravo', state: ELO_READY_BRAVO },
  },
  '排行榜·展开·查到的就是他、而且在表里',
);
const foundInTableTable = elementsWithClass(eloFoundInTable, 'ranked__table')[0] ?? '';
assert.notEqual(foundInTableTable, '', '★ 探针：表在产物里（否则下面几条是空跑）');
const foundInTableRows = eloRowsOf(foundInTableTable);
assert.equal(
  foundInTableRows.length,
  1 + ELO_USERS.length,
  `★★ ② 固定那一行**没有**把榜上那一行顶掉：仍然是 1 + ${String(ELO_USERS.length)} 行`,
);
const foundInTableBravo = foundInTableRows.filter(
  (row) => textOf(elementsWithClass(row, 'ranked__playerbtn')[0] ?? '') === 'Bravo',
);
assert.equal(
  foundInTableBravo.length,
  2,
  `★★★ ② 用户拍的口径的代价在这里：**两行同名**（找到 ${String(foundInTableBravo.length)} 行叫 Bravo）—— 榜上那一行 + 固定那一行`,
);
const foundInTablePinned = foundInTableBravo[0] ?? '';
const foundInTableBoard = foundInTableBravo[1] ?? '';
assert.equal(
  hasClassOf(openTagOf(foundInTablePinned), 'ranked__row--lookup'),
  true,
  '★ 探针：两行里**第一行**是固定那一行（`--lookup`）—— 顺序反了的话下面两条位置断言的锚点就错了',
);
assert.equal(
  hasClassOf(openTagOf(foundInTableBoard), 'ranked__row--lookup'),
  false,
  '★ 探针：第二行是**榜上**那一行（没有 `--lookup`）',
);
const foundInTableBoardEnd =
  foundInTableTable.indexOf(foundInTableBoard) + foundInTableBoard.length;
const foundInTablePinnedEnd =
  foundInTableTable.indexOf(foundInTablePinned) + foundInTablePinned.length;
const foundInTableDetailAt = foundInTableTable.indexOf('<tr class="ranked__detailrow">');
assert.notEqual(foundInTableDetailAt, -1, '★ 探针：展开那一行在产物里（否则下面三条是空跑）');
assert.ok(
  foundInTableDetailAt >= foundInTableBoardEnd,
  '★★★ ② 卡片落在**榜上那一行**之后（判据①优先：与终审那条 Minor 的裁决逐字一致）',
);
assert.equal(
  /<tr\b/.test(foundInTableTable.slice(foundInTableBoardEnd, foundInTableDetailAt)),
  false,
  '★★★ ② 而且是**紧跟**榜上那一行',
);
assert.equal(
  /<tr\b/.test(foundInTableTable.slice(foundInTablePinnedEnd, foundInTableDetailAt)),
  true,
  '★★★ ② 而**不是**紧跟固定那一行（两行都能"展开"、卡片却只放在一处的实现会在这里红）',
);
assert.equal(
  elementsWithClass(eloFoundInTable, 'ranked__detail').length,
  1,
  '★★★ ② 两行同名的那一档里仍然**恰好一块**卡片（同一个人的两颗按钮指向的是**同一块**内容）',
);
assert.deepEqual(
  elementsWithClass(eloFoundInTable, 'ranked__playerbtn')
    .filter((button) => textOf(button) === 'Bravo')
    .map((button) => attrOf(openTagOf(button), 'aria-expanded')),
  ['true', 'true'],
  '★★ ② 而**两颗**都念"展开"：判据是"**他**的卡片开着没有"，不是"卡片开在**我这一行**下面没有"（只说一颗会让读屏软件念"已收起"，用户于是再点一次 —— 而那次点击把卡片收起来）',
);
/*
 * ★★★ ② 的**第三档**（2026-09-19 复评 I1）：**上游给了空集合** + 展开的正是**查到的**那一位。
 *
 * ⚠️★ 这一档在修复之前**没有任何夹具**盖过，而它正是"卡片会不会一个位置都没有"的那一格：
 *    空榜 ⇒ `shown` 是空的 ⇒ 判据①（他在表里）不成立；查到的就是他 ⇒ 判据② 成立、
 *    判据③（表格下面）**不成立**。而空榜那一支当时**整块不渲染表**
 *    ⇒ 判据② 没有落点 ⇒ **卡片一个位置都不渲染**（旧的取法会在这里数到 **0** 块 `.ranked__detail`）。
 *    ⚠️ 这个洞是第四轮**新有的**：上一轮那张卡片住在 `.ranked__lookup` 里（与表格无关），
 *      卡片搬进"固定那一行"后面之后，"没有表"第一次等于"没有卡片"。
 * ⚠️★ 判据是**四件**，缺一条都挡不住那一类错：
 *    空态那一句照旧（上游确实没人）+ **表照样渲染** + `<tbody>` 里**恰好一行**（就是固定那一行）
 *    + 卡片**恰好一块**、在表格**里面**、紧跟那一行之后。
 * ⚠️ 它与上面 ④ 那一节的"空集合 ⇒ **不**渲染表"**不矛盾**：那条的夹具是 `lookup: null`
 *    （没有查到的玩家 ⇒ 没有行可画），这一档有一位查到的玩家（⇒ 有那一行）。
 */
const eloEmptyFound = renderElo(
  {
    elo: ELO_EMPTY,
    lookup: ELO_LOOKUP_FOUND,
    detail: { nickname: 'edcr', state: ELO_DETAIL_READY },
  },
  '排行榜·上游空了 + 查到的他展开着',
);
assert.equal(
  textOf(elementsWithClass(eloEmptyFound, 'ranked__empty')[0] ?? ''),
  fresh('ranked.eloEmpty'),
  '★★ ② 空榜那一句照旧（「这个赛季还没有人上榜。」）—— 表是为**查到的这一位**画的，不是榜上有人了',
);
const emptyFoundTable = elementsWithClass(eloEmptyFound, 'ranked__table')[0] ?? '';
assert.notEqual(
  emptyFoundTable,
  '',
  '★★★ ② 空榜 + 查到的他 ⇒ **表照样渲染**（不渲染的话下面那条卡片判据没有落点，而屏幕上就是"卡片哪儿都没有"）',
);
const emptyFoundRows = eloRowsOf(emptyFoundTable);
assert.equal(
  emptyFoundRows.length,
  1,
  `★★ ② 而且那个表体里恰好**一行** —— 就是固定那一行（榜上本来就没人；找到 ${String(emptyFoundRows.length)} 行）`,
);
assert.equal(
  hasClassOf(openTagOf(emptyFoundRows[0] ?? ''), 'ranked__row--lookup'),
  true,
  '★ 探针：那一行带 `--lookup`（它是"查到的他"，不是榜上的行）—— 否则下面两条位置断言的锚点就错了',
);
const emptyFoundPinnedEnd =
  emptyFoundTable.indexOf(emptyFoundRows[0] ?? '') + (emptyFoundRows[0] ?? '').length;
const emptyFoundDetailAt = emptyFoundTable.indexOf('<tr class="ranked__detailrow">');
assert.notEqual(emptyFoundDetailAt, -1, '★ 探针：展开那一行在产物里（否则下面两条是空跑）');
assert.equal(
  elementsWithClass(emptyFoundTable, 'ranked__detail').length,
  1,
  '★★★ ② 卡片**恰好一块**、而且在**表格里面**（判据②的位置口径与上面两档逐字相同）',
);
assert.ok(emptyFoundDetailAt >= emptyFoundPinnedEnd, '★★ ② 那一块落在固定那一行**之后**');
assert.equal(
  /<tr\b/.test(emptyFoundTable.slice(emptyFoundPinnedEnd, emptyFoundDetailAt)),
  false,
  '★★★ ② 而且是**紧跟**（两者之间一个 `<tr` 都没有 —— 这一条把"渲染到表尾"与"紧跟"分开）',
);
/*
 * ★★ 三条判据**互斥**：同一个产物里 `.ranked__detail` 恰好**一块**。
 * ⚠️ 少了这一条，一个"三条都渲染"的实现会同时通过上面三条（每一条看到的都是**另一处**），
 *    而用户会看到两张一模一样的卡片、各自跟着不同的东西开合。
 */
for (const [where, html] of [
  ['① 表里', eloInTable],
  ['② 固定那一行后面', eloInLookup],
  ['② 两行同名那一档', eloFoundInTable],
  ['② 空榜 + 查到的他', eloEmptyFound],
  ['③ 表格下面', eloFilteredAway],
] as const) {
  assert.equal(
    elementsWithClass(html, 'ranked__detail').length,
    1,
    `★★ 判据互斥（${where}）：同一屏里恰好一块 \`.ranked__detail\``,
  );
}
/*
 * ★★ ⑦ 那条既有断言（`.ranked__meta` 只有赛季那一行，上面 ④ 那一节）在这一屏上的延伸：
 *    它现在**同时**是"新加的块不许复用 `.ranked__meta`"的守卫 —— 详情有自己的一套类名
 *    （`ranked__detailstats` 那五格读数），谁把一行读数塞进 `.ranked__meta`，
 *    "赛季与赛段在同一行"那句话就变成两句都成立、而其中一句是别人的话。
 *    ⚠️ 2026-09-19 第四轮之后这里只剩**一条**读数类名：查询结果那三格
 *    （`ranked__lookupstats`）跟着"查到的玩家变成表里一行"一起退役了（见 ④b⑧）。
 */
assert.equal(
  metaOf(eloDetailReady).length,
  1,
  '★★ 展开那一屏里 `.ranked__meta` 仍然只有赛季那一行（新块用自己的类名）',
);
assert.equal(metaOf(eloLookupFound).length, 1, '★★ 查询命中那一屏同理');
ok(
  '④b⑥ 位置判据：①紧跟榜上那一行（colSpan=5）②紧跟固定那一行 + 两行同名与"空榜 + 查到的他"那两档仍恰好一块 ③表格下面',
);

/* ---- ⑦ 两族**从表里取**的词条（结果的四档 + 比赛类型的四种）---- */
/*
 * ⚠️★ 这两张表的值对 `services/api/src/i18n-keys.test.ts` 是**看不见**的（它扫的是源码里的
 *    字面量 `t('…')`），而这里用的是 `t(OUTCOME_KEYS[outcome])` ⇒ 表里少一条的表现是
 *    界面上**直接印出裸 key**，而全仓所有门禁照样绿（与 ⑥b 那七格、⑨ 那张进度表同一条理由）。
 * ⚠️ 下面那两条 `deepEqual` 是**手抄**的对照表（本仓惯例）：**对调两行在全仓是静默的**
 *    （每格都是 `string`、类型照样过）——「胜」印成「负」在一张战绩列表里看起来完全正常，
 *    而它会改掉用户对这位玩家水平的判断。
 */
assert.deepEqual(
  OUTCOME_KEYS,
  {
    win: 'ranked.outcomeWin',
    loss: 'ranked.outcomeLoss',
    draw: 'ranked.outcomeDraw',
    unknown: 'ranked.outcomeUnknown',
  },
  '★★ 「结果 → 词条」那张表被改了（对调两行在界面上看不出来）',
);
assert.deepEqual(
  MATCH_TYPE_KEYS,
  {
    1: 'ranked.matchTypeCasual',
    2: 'ranked.matchTypeRanked',
    3: 'ranked.matchTypePrivate',
    4: 'ranked.matchTypeEvent',
  },
  '★★ 「比赛类型 → 词条」那张表被改了（上游文档的四档：1 casual / 2 ranked / 3 private / 4 event）',
);
for (const key of [...Object.values(OUTCOME_KEYS), ...Object.values(MATCH_TYPE_KEYS)]) {
  for (const lng of LANGUAGES) {
    assert.ok(
      i18n.exists(key, { lng }),
      `★★ 词条 ${key} 在【${lng}】里不存在（那一格会印出裸 key，而字面量扫描够不着这张表）`,
    );
    const value = i18n.t(key, { lng }) as string;
    assert.notEqual(value, key, `★★ 词条 ${key} 在【${lng}】里没有真值（i18next 会原样返回 key）`);
    assert.notEqual(
      flat(value),
      '',
      `★★ 词条 ${key} 在【${lng}】里是空的（空格子看起来像渲染坏了）`,
    );
  }
}
ok('④b⑦ 结果四档与比赛类型四种：两张表逐格 + 八条词条两种语言都在');

/* ---- ⑧ ★★ ③ 那条读数行真的没了，而且没有词条因此变成孤儿（两个方向都要断） ---- */
/*
 * ★★ 2026-09-19 第四轮：命中那一档的**三格读数行**（`.ranked__lookupstats`）跟着
 *    "查到的玩家变成表里的一行"一起消失了 —— 那一行现在是**五格表格行**，
 *    而 elo / 排名 / 本赛季那三格仍然印得出来：它们住在**卡片**里
 *    （`.ranked__detailstats` 那五格读数的一部分）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️★ 两个方向都必须断，而且**都不能省**
 * ---------------------------------------------------------------------------
 *   · 只断"没了" ⇒ 一个**顺手把 `ranked.detailSeasonRecord` 也删掉**的实现照样绿
 *     （词条变成孤儿，而"孤儿"正是本仓 §5.70 那一族：`weeklySeed` 差点因此被删）；
 *   · 只断"还在" ⇒ 一个把那一行读数**留在固定那一行上面**的实现照样绿
 *     （屏幕上多一行，而用户要的是"布局相同"）。
 * ⚠️★ "词条有没有孤儿"的判据只能落在**产物**上：`services/api/src/i18n-keys.test.ts`
 *    扫的是源码里的字面量 `t('…')`，它证明的是**另一个方向**（用到的 key 在不在字典里），
 *    "字典里有、但没人在渲染"它一个字都看不见。
 * ⚠️ 下面三条读的都是**卡片里**那一块（`.ranked__detail`）：这是"查到的玩家展开之后"
 *    那一屏（`eloInLookup`）—— 卡片与那一行在**同一个产物**里，所以"在卡片里而不在行里"
 *    这件事才分得开。
 */
const inLookupCard = elementsWithClass(eloInLookup, 'ranked__detail')[0] ?? '';
assert.notEqual(inLookupCard, '', '★ 探针：卡片在产物里（否则下面几条是空跑）');
const inLookupCardText = textOf(inLookupCard);
assert.ok(
  inLookupCardText.includes(fresh('ranked.detailSeasonRecord', { wins: 96, loses: 12 })),
  '★★★ ③ 卡片里**仍然印着**本赛季战绩（`ranked.detailSeasonRecord`）—— 读数行没了，但词条没有变成孤儿（96 胜 12 负来自响应）',
);
assert.ok(
  inLookupCardText.includes(fresh('ranked.detailElo', { elo: 2349 })),
  '★★ ③ 同一批里 elo 那一格也在（`ranked.detailElo`：它原来与战绩住在同一行读数里）',
);
assert.ok(
  inLookupCardText.includes(fresh('ranked.detailRank', { rank: 1 })),
  '★★ ③ 排名那一格同理（`ranked.detailRank`）—— 三条词条一条都没变成孤儿',
);
assert.equal(
  textOf(inLookupPinned).includes(fresh('ranked.detailSeasonRecord', { wins: 96, loses: 12 })),
  false,
  '★★★ ③ 而**固定那一行**里没有它（那一行是五格表格行；读数留在上面就是用户说的"布局不同"）',
);
assert.equal(
  elementsWithClass(inLookupPinned, 'ranked__lookupstats').length,
  0,
  '★★★ ③ `.ranked__lookupstats` 一个都不许出现在那一行里（这一轮**退役**的类名）',
);
assert.equal(
  eloDataRows(eloInLookup),
  1 + ELO_USERS.length,
  '★ ③ 而固定那一行**还在**（退役的是读数行，不是那一行本身）',
);
/*
 * ⚠️★ "全产物都不许出现"那一半不在这里：`products` 是**边渲染边长**的，就地扫只会覆盖
 *    到这一节之前渲染过的那些产物（⑧ 那一段写着同一个坑的实测记录）⇒ 它落在
 *    `assertRankedClassesHaveRules()` 里（最后一次渲染之后）。
 */
ok('④b⑧ ③ 读数行退役：卡片里三格读数照旧（没有词条变成孤儿）+ 固定那一行里没有它 + 那一行本身还在');

/* ---- ⑨ ★★★ 每一场比赛右侧那颗按钮 + 它下面那三格种子（四档各一套夹具） ---- */
/*
 * 用户原话：「每个对局**右侧设置按钮**，点击**根据 api 查询种子**展示在**对应比赛信息的下方**」。
 *
 * ---------------------------------------------------------------------------
 * ⚠️★ 这一节证得了什么、证不了什么
 * ---------------------------------------------------------------------------
 * 这里钉的是"**视图拿着那一格 `seeds` 渲染成什么样**"：按钮在不在、是不是最后一个、
 * `aria-expanded` 对不对、面板落在哪一场下面、四档各说哪一句话、三个值是不是原样。
 * ⚠️★ 「点一下真的发一次请求」「第二次点同一场不发」「`failed` 不进缓存」是**容器**的事
 *    （`routes/Ranked.tsx` 的 `toggleSeed`）—— `renderToStaticMarkup` 不点击、不跑 effect，
 *    这几条逐条写在 `docs/pending.md §5.101`（每条都写着要人做什么）。
 */
/**
 * 那个元素之后、这一行结束之前剩下的那一段。
 *
 * ⚠️★ 判据是"**它是不是最后一个**"，而这件事只能从"它后面还有没有别的元素"上读出来 ——
 *    "行里有没有 X"那种写法对"按钮在中间"与"按钮在最右边"完全一样绿。
 * ⚠️ 先把这一行自己的 `</div>` 收尾摘掉：剩下的东西里只要出现**任何一个元素的开标签**，
 *    就说明按钮后面还有东西（`<` + 字母）。
 */
const tailAfter = (row: string, child: string): string => {
  const at = row.indexOf(child);
  assert.notEqual(
    at,
    -1,
    '★ 探针：那个元素在那一行里（否则"它后面还有没有别的东西"这条判据是空跑）',
  );
  return row.slice(at + child.length).replace(/<\/div>\s*$/, '');
};
/** 种子面板里那三对 `<dt>`/`<dd>`（标签与值各自成串，顺序 = 产物里的顺序）。 */
const seedCellsOf = (match: string): { labels: string[]; values: string[] } => {
  const dl = elementsWithClass(match, 'ranked__seeds')[0];
  assert.notEqual(dl, undefined, '★ 探针：种子那一块（`<dl class="ranked__seeds">`）在这一场里');
  return {
    labels: [...(dl ?? '').matchAll(/<dt>([\s\S]*?)<\/dt>/g)].map((m) => textOf(m[0])),
    values: [...(dl ?? '').matchAll(/<dd>([\s\S]*?)<\/dd>/g)].map((m) => textOf(m[0])),
  };
};
/*
 * ★★ 一把**没点开任何一场**的默认态（`seeds: null`，`renderElo()` 的默认值）。
 * ⚠️ `detailMatches` 就是 ④b④ 那一份（同一个夹具：`ELO_DETAIL_READY`，四场）。
 *    ⚠️★ 四场**都要**各有一颗按钮：只断"产物里有一颗"会漏掉"只在第一场渲染"的实现。
 */
assert.equal(
  detailMatches.length,
  ELO_MATCHES.length,
  '★ 探针：四场都在产物里（否则下面按场数的断言是空跑）',
);
const closedSeedButtons = detailMatches.map((match, i) =>
  /*
   * ⚠️ 用 `assertClickable`（本文件现成的那个）：它同时钉着"**恰好一颗**"与"它**不是** disabled"
   *    —— 一颗灰着的按钮"在"，但按不动，而产物级断言光看"在不在"是分别不出来的。
   */
  assertClickable(match, t('ranked.seedButton'), `排行榜·展开·第 ${String(i + 1)} 场的种子入口`),
);
assert.equal(
  elementsWithClass(eloDetailReady, 'ranked__seedbtn').length,
  ELO_MATCHES.length,
  `★★★ ⑤ 每一场**恰好一颗** \`.ranked__seedbtn\`：夹具 ${String(ELO_MATCHES.length)} 场 ⇒ 产物里 ${String(elementsWithClass(eloDetailReady, 'ranked__seedbtn').length)} 颗（多一颗少一颗都是"某些场查不了种子"）`,
);
assert.equal(
  elementsWithClass(eloDetailReady, 'ranked__seedline').length,
  0,
  '★★★ ⑤ 一场都没点开 ⇒ **没有任何面板**（`.ranked__seedline` 一个都不渲染）',
);
/*
 * ★ ⑤ `type="button"`：这一颗**不带** `submit` 语义。
 * ⚠️ 它不是形式主义：`<button>` 落在一个 `<form>` 里时默认类型是 **submit** ⇒ 哪天这一行
 *    被挪进一个表单（比如将来给战绩加个筛选框），点一下会**顺手提交那个表单**
 *    （整页刷新，SPA 里的状态全丢），而画面上完全看不出来。
 */
for (const [i, attrs] of closedSeedButtons.entries()) {
  assert.ok(
    /(?:^|\s)type="button"/.test(attrs),
    `★ ⑤ 第 ${String(i + 1)} 场的按钮是 \`type="button"\`（缺了它落进某个 <form> 时会顺手提交那个表单）`,
  );
}
assert.deepEqual(
  detailMatches.map((match) => {
    const button = elementsWithClass(match, 'ranked__seedbtn')[0] ?? '';
    return attrOf(openTagOf(button), 'aria-expanded');
  }),
  ['false', 'false', 'false', 'false'],
  '★★ ⑤ 四颗都念"已收起"（`aria-expanded="false"`）—— 面板一个都没开',
);
/*
 * ★★★ ⑤ "右侧"= **DOM 顺序**：按钮是那一行里的**最后一个**元素。
 * ⚠️★ 判据不能写成"行里有那颗按钮"（那对"按钮排在对手后面"照样绿）——
 *    用户说的"右侧"在这一层唯一可断的形式就是"它后面没有别的东西了"。
 * ⚠️ "后面没有别的东西"由**格数**再兜一层：8 个格子都在（对手/结果/用时/elo/类型/种子/录像/按钮）
 *    ⇒ 按钮最后 ≠ 别的格子被挤掉了。
 */
for (const [i, match] of detailMatches.entries()) {
  const button = elementsWithClass(match, 'ranked__seedbtn')[0] ?? '';
  assert.equal(
    /<[a-zA-Z]/.test(tailAfter(match, button)),
    false,
    `★★★ ⑤ 第 ${String(i + 1)} 场：那颗按钮之后**没有别的元素**（"右侧"这件事在这一层的唯一判据）`,
  );
}
/*
 * ★ ⑤ 对照：按钮最后 ≠ "别的格子被挤掉了" —— 那八格里最容易少的一格是**种子**
 *   （`seedType · bastionType`，私人房两格都是 null ⇒ 它印的是「—」，但那一格**在**）。
 */
assert.equal(
  elementsWithClass(detailMatches[2] ?? '', 'ranked__detailseed').length,
  1,
  '★ ⑤ 对照：私人房那一场的"种子结构"格照旧在（它印「—」，但格子没被按钮挤掉）',
);
assert.equal(
  elementsWithClass(detailMatches[2] ?? '', 'ranked__detailopp').length,
  1,
  '★ ⑤ 对照：对手那一格也在（按钮是最右那一格，不是"唯一的格子"）',
);
/*
 * ★★★ ⑤ `ready`：三条 label 词条 + **三个值原样**。
 *
 * ⚠️★ 值必须是**逐字相等**：种子是 64 位整数（19 位数字），`Number()` 会静默改值
 *    （`Number('8813544817493859226')` 实测是 **8813544817493859000**）——
 *    而"改过的值"在屏幕上看不出来（还是十九个数字）。
 * ⚠️★ 三个值**互不相同**（夹具那一段写着为什么）：同值时"第 3 格印的是第 1 格"测不出来。
 * ⚠️ 标签那三条是**复用**周赛那一组（`ranked.seedOverworld` / `seedNether` / `seedEnd`）：
 *    视图里走的是 `WEEKLY_SEED_LABEL_KEYS`（**表驱动的 key**）⇒
 *    `i18n-keys.test.ts` 的字面量扫描**够不着**这三条，只有这里查得到。
 */
const eloSeedReady = renderElo(
  { detail: { nickname: 'edcr', state: ELO_DETAIL_READY }, seeds: ELO_SEEDS_READY },
  '排行榜·展开·第 3 场查到了种子',
);
const seedReadyMatches = elementsWithClass(eloSeedReady, 'ranked__detailmatch');
assert.equal(
  seedReadyMatches.length,
  ELO_MATCHES.length,
  '★ 探针：四场都在（按第 3 场那一格做断言）',
);
assert.equal(
  elementsWithClass(eloSeedReady, 'ranked__seedline').length,
  1,
  '★★★ ⑤ 点开**一场** ⇒ 恰好**一块**面板（多一块就是"面板渲染到了别的对局下面"）',
);
assert.deepEqual(
  seedReadyMatches.map((match) => elementsWithClass(match, 'ranked__seedline').length),
  [0, 0, 1, 0],
  `★★★ ⑤ 面板落在**点开的那一场**下面（第 ${String(ELO_MATCHES.indexOf(ELO_MATCH_PRIVATE) + 1)} 场 = id ${String(ELO_SEED_MATCH_ID)}），其余三场一个都没有`,
);
assert.deepEqual(
  seedReadyMatches.map((match) => {
    const button = elementsWithClass(match, 'ranked__seedbtn')[0] ?? '';
    return attrOf(openTagOf(button), 'aria-expanded');
  }),
  ['false', 'false', 'true', 'false'],
  '★★★ ⑤ `aria-expanded="true"` **只在打开的那一场**上（其余三场 `"false"`）—— 判据是"这一场自己的状态"',
);
const seedOpenMatch = seedReadyMatches[2] ?? '';
const seedOpenLine = elementsWithClass(seedOpenMatch, 'ranked__seedline')[0] ?? '';
assert.notEqual(seedOpenLine, '', '★ 探针：那一块面板取得到（下面几条在它上面做）');
assert.equal(
  /<[a-zA-Z]/.test(tailAfter(seedOpenMatch, seedOpenLine)),
  false,
  '★★★ ⑤ 面板是这一场的**最后一个**孩子：它落在"对应比赛信息的下方"（后面没有别的格子了）',
);
assert.ok(
  seedOpenMatch.indexOf(elementsWithClass(seedOpenMatch, 'ranked__seedbtn')[0] ?? '') <
    seedOpenMatch.indexOf(seedOpenLine),
  '★★ ⑤ 而且它在**那颗按钮之后**（面板是从那一行的最右一列换行下来的一块，不是插在中间）',
);
const seedOpenCells = seedCellsOf(seedOpenMatch);
assert.deepEqual(
  seedOpenCells.labels,
  ['ranked.seedOverworld', 'ranked.seedNether', 'ranked.seedEnd'].map((key) => fresh(key)),
  '★★★ ⑤ 三格标签 = 主世界 / 下界 / 末地（**复用**周赛那三条 key：同一个东西没有第二个说法）',
);
assert.deepEqual(
  seedOpenCells.values,
  ['8813544817493859226', '234370381031116', '7777777777777777777'],
  '★★★ ⑤ 三个种子值**逐字**（字面量；三格互不相同 ⇒ "第 3 格印的是第 1 格"也会在这里红）',
);
/*
 * ★★★ ⑤ "值**没有被当成数字**"这件事（本仓 `SeedResultCard.tsx` 的文件头记着
 *    `Number()` 会静默改 64 位整数）：**判据就是上面那一条逐字 `deepEqual`**。
 *
 * ⚠️★ 2026-09-19 复评 I2：这里原来还有**四条**断言（不许带千分位 / 不许有三位分组 /
 *    不许出现科学计数法 / 不许出现 `Number()` 那个舍入后的值），它们**全部**被上面那条
 *    `deepEqual` 严格蕴含（三格必须逐字等于那三个字面量 ⇒ 任何一个被格式化的值都当场红）
 *    ⇒ **一条都不可能单独红**；而那段注释当时还写着"三条判据各管一种写法，缺一条就漏一类"，
 *    那句是**假的**（那不是覆盖率，是同一件事的四个分身）。
 *    ⇒ 四条一起删掉：一条不可能红的守卫比没有守卫更坏（本仓 §5.63；本文件上面「排名列印的是
 *    上游的 `eloRank`」那一节记着上一轮同样把一条被蕴含的探针删掉的裁决）。
 * ⚠️ 三类错今天仍然有人管，管它们的就是那条逐字比对（**三种写法印出来的都不是那三个字面量**）：
 *   · 千分位（`toLocaleString()` 会印 `8,813,544,817,493,859,226`）；
 *   · 科学计数法（`Number.prototype.toString()` 对超大数是 `8.81e+18`）；
 *   · `Number()` 的**舍入**（19 位超过 2^53 ⇒ `8813544817493859000`）。
 * ⚠️ 代价写清：这三类错的判据从此**只有一处**（那条 `deepEqual`）—— 谁把它改成"包含某串字"
 *    或"比长度"，这三类错会**一起**失去判据，而屏幕上的表现只是"种子值看起来还是十九位数字"。
 */
/*
 * ★★★ ⑤ `theEndSeed: null` ⇒ 那一格印「—」，**不是** 0、**不是**空串。
 *
 * ⚠️★ 这是本仓那条"**绝不为缺失值填 0**"在这一格上的落点（T1 报告的 mutation M3 就是这一刀，
 *    而它当时的判据只是一个临时探针 —— 它的永久归宿是这里）。
 * ⚠️ 空串也要单独断：`<dd></dd>` 在屏幕上与"上游给了个空种子"长得一样，而它是"我们没印"。
 */
const eloSeedNoEnd = renderElo(
  { detail: { nickname: 'edcr', state: ELO_DETAIL_READY }, seeds: ELO_SEEDS_THE_END_NULL },
  '排行榜·展开·末地种子缺失',
);
const seedNoEndCells = seedCellsOf(elementsWithClass(eloSeedNoEnd, 'ranked__detailmatch')[2] ?? '');
assert.equal(
  seedNoEndCells.values[2],
  fresh('ranked.unknown'),
  '★★★ ⑤ `theEndSeed: null` ⇒ 那一格印「—」（**绝不**填 0）',
);
/*
 * ⚠️★ 2026-09-19 复评 I2：这里原来还有两条（`!== '0'` / `!== ''`），两条都被上面那条
 *    `deepEqual` 蕴含 —— 它断的是"印出来的**就是** `ranked.unknown` 那一条词条"，
 *    而那条词条的值由 spec §7.3 **冻结**成「—」（`packages/shared/src/i18n/zh-CN.ts:3356`）
 *    ⇒ 只有"词条被别人改成 `0` 或空串"这一种情形能让那两条单独红，而那是一次**词条值**的
 *    改动（不是视图的改动）。⇒ 一起删掉（§5.63：不可能单独红的守卫比没有守卫更坏）。
 * ⚠️ 代价写清（这一条**必须**留着）：今天**没有任何断言**拦得住"那条占位符词条被改成 `0`
 *    或空串"—— 它一变，全站十几处占位符会一起印 `0`，而这一层照样绿。判据在别处：
 *    spec §7.3 那张冻结表 + 两份字典（`i18n-keys.test.ts` 只管 key 在不在、值非不非空，
 *    它**不**比具体值）。谁要改那句「—」，去改的是那两处，不是这里补两条分身。
 */
assert.deepEqual(
  [seedNoEndCells.values[0], seedNoEndCells.values[1]],
  ['8813544817493859226', '234370381031116'],
  '★ ⑤ 而另外两格**照旧有值**（一格缺失不许把整块面板弄空）',
);
/*
 * ★★★ ⑤ `not_found` 与 `failed` 是**两句不同的话**，而且两者**互斥**。
 *
 * ⚠️★ 这是这一轮最要紧的一句话，因为它说的是**一件常态的事**：种子库只覆盖约 **80%**
 *    的比赛（账本 `ranked-round4/progress.md` 与 `routes/seeds.ts` 的 404 都写着）
 *    ⇒ "这场没有种子"不是故障，而"这一次没读到"值得再点一次。两句合成一句时，
 *    用户会对着一场永远查不到的 id 反复点，而**没有任何门禁看得出来**。
 */
assert.notEqual(
  fresh('ranked.seedNotFound'),
  fresh('ranked.seedUnavailable'),
  '★★★ 探针：那两句词条本身不同（否则下面那两条互斥是空跑）',
);
const eloSeedNotFound = renderElo(
  { detail: { nickname: 'edcr', state: ELO_DETAIL_READY }, seeds: ELO_SEEDS_NOT_FOUND },
  '排行榜·展开·种子不在库里',
);
const seedNotFoundNote = elementsWithClass(eloSeedNotFound, 'ranked__seednote');
assert.equal(
  seedNotFoundNote.length,
  1,
  `★★ ⑤ \`not_found\` ⇒ 恰好一句提示（找到 ${String(seedNotFoundNote.length)} 句）`,
);
assert.equal(
  textOf(seedNotFoundNote[0] ?? ''),
  fresh('ranked.seedNotFound'),
  '★★★ ⑤ `not_found` ⇒ 「这场比赛的种子不在库里。」（**常态**，不是故障）',
);
assert.equal(
  hasClassOf(openTagOf(seedNotFoundNote[0] ?? ''), 'ranked__seednote--failed'),
  false,
  '★ ⑤ 而它不是"故障"那一档（类名也不带 `--failed`：颜色说的是同一件事）',
);
assert.equal(
  textOf(eloSeedNotFound).includes(fresh('ranked.seedUnavailable')),
  false,
  '★★★ ⑤ `not_found` 那一档**不许**同时说「种子暂时读不到。」',
);
assert.equal(
  elementsWithClass(eloSeedNotFound, 'ranked__seeds').length,
  0,
  '★ ⑤ 也不许印那三格（没有种子可印 —— 印「—」三格会让用户以为上游给了三个空值）',
);
const eloSeedFailed = renderElo(
  { detail: { nickname: 'edcr', state: ELO_DETAIL_READY }, seeds: ELO_SEEDS_FAILED },
  '排行榜·展开·种子读不到',
);
const seedFailedNote = elementsWithClass(eloSeedFailed, 'ranked__seednote');
assert.equal(seedFailedNote.length, 1, '★★ ⑤ `failed` 那一档也只有**一句**提示');
assert.equal(
  textOf(seedFailedNote[0] ?? ''),
  fresh('ranked.seedUnavailable'),
  '★★★ ⑤ `failed` ⇒ 「种子暂时读不到。」（**值得再点一次**，与上一档的下一步相反）',
);
assert.equal(
  hasClassOf(openTagOf(seedFailedNote[0] ?? ''), 'ranked__seednote--failed'),
  true,
  '★★ ⑤ 而这一句带 `--failed`（颜色把"值得重试"这件事再说一遍）',
);
assert.equal(
  textOf(eloSeedFailed).includes(fresh('ranked.seedNotFound')),
  false,
  '★★★ ⑤ `failed` 那一档**不许**同时说「这场比赛的种子不在库里。」',
);
assert.equal(
  elementsWithClass(eloSeedFailed, 'ranked__seeds').length,
  0,
  '★ ⑤ 也不许印那三格（没读到就是没读到）',
);
/*
 * ★★ ⑤ `loading`：**复用**既有的「加载中…」（不新写一句）。
 * ⚠️ 判据是"那一句在**那一场**的面板里"（不是"产物里有'加载中'"：展开那一档自己的
 *    loading 也印同一句话 ⇒ 不划范围的话这一条对"面板根本没渲染"照样绿）。
 */
const eloSeedLoading = renderElo(
  { detail: { nickname: 'edcr', state: ELO_DETAIL_READY }, seeds: ELO_SEEDS_LOADING },
  '排行榜·展开·种子加载中',
);
const seedLoadingLine = elementsWithClass(
  elementsWithClass(eloSeedLoading, 'ranked__detailmatch')[2] ?? '',
  'ranked__seedline',
)[0];
assert.notEqual(seedLoadingLine, undefined, '★ 探针：那一场的面板在（否则下面那条是空跑）');
assert.equal(
  hasText(seedLoadingLine ?? '', t('common.loading')),
  true,
  '★★ ⑤ 还在读 ⇒ 既有的「加载中…」那一句（复用，不新写词条）',
);
assert.equal(
  elementsWithClass(eloSeedLoading, 'ranked__seeds').length,
  0,
  '★ ⑤ 而三格一个都不印（还没读到值）',
);
assert.equal(
  elementsWithClass(eloSeedLoading, 'ranked__seednote').length,
  0,
  '★★ ⑤ 也**不说**"不在库里"/"读不到"（"慢"与那两档是三个不同的处境）',
);
ok(
  '④b⑨ ⑤ 每场一颗按钮（最后一格 + aria-expanded 逐场）+ 四档：ready 三值**逐字**（千分位/科学计数法/舍入那三类错都在这一条上红）+ null ⇒ — + not_found/failed 互斥 + loading 复用',
);

// ---------------------------------------------------------------------------
console.log('⑤ 周赛榜单：第 0 周 + 四个种子 + 翻页的"链接 / 不是链接"正反配对');
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 上游把「第 0 周」记成 `-1`（唯一的负周，spec §6.5）。照原样印会让界面出现
 *    「第 -1 周」—— 那是上游的下标，不是任何人心里的周数。
 * ⚠️ 两个方向都要断言：那一份必须说「第 0 周」，而且**不许**说「第 -1 周」。
 */
const weeklyZero = renderWeekly({ weekly: WEEK_ZERO }, '周赛·第 0 周');
const weeklyOne = renderWeekly({ weekly: WEEK_ONE }, '周赛·第 1 周');
const weeklyLatest = renderWeekly({}, '周赛·本周');
assert.equal(displayWeekNo(-1), 0, '★ `displayWeekNo(-1) === 0`（纯函数那一半）');
assert.ok(
  metaOf(weeklyZero)
    .join('|')
    .includes(fresh('ranked.weeklyNumber', { n: 0 })),
  '★★ `id: -1` 那一份渲染成「第 0 周」',
);
assert.equal(
  metaOf(weeklyZero)
    .join('|')
    .includes(fresh('ranked.weeklyNumber', { n: -1 })),
  false,
  '★★ 而且**不许**印出「第 -1 周」（照原样显示就是这个形状）',
);
assert.ok(
  metaOf(weeklyOne)
    .join('|')
    .includes(fresh('ranked.weeklyNumber', { n: 1 })),
  '★ 正向对照：`id: 1` 那一份就是「第 1 周」（1 起一一对应）',
);
/* 四个种子：标签与值**逐格**对应，顺序固定（主世界 / 下界 / 末地 / RNG）。 */
assert.deepEqual(
  elementsWithClass(weeklyZero, 'ranked__seeds').flatMap((dl) =>
    [...dl.matchAll(/<dt>([\s\S]*?)<\/dt>/g)].map((m) => flat(m[1] ?? '')),
  ),
  ['ranked.seedOverworld', 'ranked.seedNether', 'ranked.seedEnd', 'ranked.seedRng'].map((key) =>
    fresh(key),
  ),
  '★★ 四个种子的标签（这一栏**自己的**四条词条，不复用「实时分享」那一组）',
);
assert.deepEqual(
  elementsWithClass(weeklyZero, 'ranked__seeds').flatMap((dl) =>
    [...dl.matchAll(/<dd>([\s\S]*?)<\/dd>/g)].map((m) => flat(m[1] ?? '')),
  ),
  [WEEK_SEED.overworld, WEEK_SEED.nether, WEEK_SEED.theEnd, WEEK_SEED.rng].map(flat),
  '★★ 四个种子的值**原样**（64 位整数不许过 `Number()`：那会静默改值）',
);
assert.ok(
  metaOf(weeklyZero).join('|').includes(fresh('ranked.weeklySeed')),
  '★ 四格上面那个总称（「种子」）有渲染点（没有消费者的 key 不留）',
);
/* 截止时刻按本地时区印（秒 → 毫秒那一步在视图里做）。 */
assert.ok(
  metaOf(weeklyZero)
    .join('|')
    .includes(
      fresh('ranked.weeklyEndsAt', {
        when: new Date(WEEK_ZERO.endsAt * 1000).toLocaleString(LANG),
      }),
    ),
  '★ 截止时刻在（秒 → 毫秒真的做了，语言也真的传进去了）',
);
/* 五列与成绩格式（毫秒级的 `4:04.241` / 有小时的 `1:00:00.000`）。 */
const weekTable = elementsWithClass(weeklyZero, 'ranked__table')[0] ?? '';
assert.deepEqual(
  [...weekTable.matchAll(/<th>([\s\S]*?)<\/th>/g)].map((m) => flat(m[1] ?? '')),
  [
    'ranked.colRank',
    'ranked.colNickname',
    'ranked.colTime',
    'ranked.colElo',
    'ranked.colEloRank',
  ].map((key) => fresh(key)),
  '★★ 五列（排名 / 昵称 / 时间 / elo / elo 排名）',
);
const weekRows = [...weekTable.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
  .slice(1)
  .map((m) => [...(m[1] ?? '').matchAll(/<td>([\s\S]*?)<\/td>/g)].map((c) => flat(c[1] ?? '')));
assert.deepEqual(
  weekRows[0],
  ['1', 'Speedo', '4:04.241', '2100', '50'],
  /*
   * ★★ 成绩是 `m:ss.mmm`（244241 → 4:04.241）。
   * ⚠️ 最后一格是 `50` **没有** `#`：对局卡片上那一格（`.ranked__rank`）带 `#`，
   *    而表格这一列是**纯名次**（spec §6.5 的列名就是「elo 排名」，与卡片那句
   *    「#排名」不是同一种排版）。照抄卡片那边的 `#` 会让这一列宽度全乱。
   */
);
assert.deepEqual(
  weekRows[1],
  ['2', 'Runner', '1:00:00.000', fresh('ranked.unknown'), fresh('ranked.unknown')],
  '★ 超过一小时是 `h:mm:ss.mmm`；未定级两格印占位符（不删列）',
);

/*
 * ★★ 翻页：**上一周**那一格在两种情况下分别是"一条真链接"与"不可点的一格"。
 *    判据是 `href` 在不在（不是"有没有那个文字"）—— 一条 `aria-disabled` 的链接
 *    仍然会被读屏软件念成一个可点的链接，那就是在骗人。
 * ⚠️★ 2026-09-19 起这一行里是**三**格：上一周 / 下一周 / **本周**（用户要求加的那一颗）。
 *    手输跳转那一块（`<form class="ranked__weekjump">`）不在这个读取器里 ——
 *    它不是 `ranked__navbtn`，下面另有一节逐格钉它。
 */
const navOf = (html: string): { href: string | null; text: string; off: boolean }[] =>
  elementsWithClass(html, 'ranked__navbtn').map((el) => ({
    href: attrOf(el, 'href'),
    text: textOf(el),
    off: hasClassOf(el, 'ranked__navbtn--off'),
  }));
const navZero = navOf(weeklyZero);
assert.equal(navZero.length, 3, '★ 导航那一行恰好三格（上一周 / 下一周 / 本周）');
assert.deepEqual(
  navZero.map((each) => each.text),
  [fresh('ranked.weeklyPrev'), fresh('ranked.weeklyNext'), fresh('ranked.weeklyThisWeek')],
  '★ 三格的文字（顺序固定：先翻页，再回本周）',
);
assert.equal(
  navZero[0]?.href,
  null,
  '★★ `prevWeekId(-1) === null` ⇒ 「上一周」那一格**不是链接**（第 0 周是最早的一页）',
);
assert.equal(navZero[0]?.off, true, '★ 而且带上"不可点"那个类名');
assert.equal(
  navZero[1]?.href,
  weekPath(1),
  '★★ 「下一周」是链接，而且路径跨过 0（`-1 → 1`，**不是** `id + 1`）',
);
assert.equal(navZero[1]?.off, false, '★ 正面对照：可点的那一格不带"不可点"类名');
/*
 * ★★ 「本周」= 用户 2026-09-19 要的那一颗。落点是**最新周号的路径**（`latestId`，
 *    来自周赛列表端点那一次响应）。
 *    ⚠️ 即使当前就在第 0 周（`prevWeekId` 到头了），这一颗也**照常是链接** ——
 *    它与翻页那一对是两件事（"回本周"永远可达，而"上一周"到最早那一页就没有了）。
 */
assert.equal(navZero[2]?.href, weekPath(LATEST_ID), '★★ 「本周」指向**最新那一周**（103）');
assert.equal(navZero[2]?.off, false, '★ 它永远可点（与"上一周到头了"无关）');

const navOne = navOf(weeklyOne);
assert.equal(
  navOne[0]?.href,
  weekPath(-1),
  '★★ 正向对照：第 1 周的「上一周」**是链接**，指向第 -1 周（显示为第 0 周）',
);
assert.equal(navOne[0]?.off, false, '★ 它不是"不可点"那一档');
assert.equal(navOne[1]?.href, weekPath(2), '★ 第 1 周的「下一周」指向第 2 周');
assert.notEqual(
  navOne[0]?.href,
  weekPath(0),
  '★★ 翻页**永不产出 0**（0 在上游是"本周"的别名：URL 写着 0、屏幕上却是本周的数据）',
);
const navLatest = navOf(weeklyLatest);
assert.equal(
  navLatest[1]?.href,
  null,
  '★★ `id >= latestId` ⇒ 「下一周」**不是链接**（到最新一周就没有下一页了）',
);
assert.equal(navLatest[1]?.off, true, '★ 它带上"不可点"那个类名');
assert.equal(
  navLatest[0]?.href,
  weekPath(LATEST_ID - 1),
  '★ 正面对照：最新那一周的「上一周」照样是链接',
);
/* 空集合是**自己的话**：这一周还没有人完赛 ≠ 加载中 ≠ 出错了。 */
const weeklyEmpty = renderWeekly({ weekly: { ...WEEK_LAST, entries: [] } }, '周赛·这一周没人完赛');
assert.equal(
  textOf(elementsWithClass(weeklyEmpty, 'ranked__empty')[0] ?? ''),
  fresh('ranked.weeklyEmpty'),
  '★ 空集合 ⇒ 「这一周还没有人完赛。」',
);
assert.equal(
  /<td>/.test(weeklyEmpty),
  false,
  '★★ 空集合时一行成绩都没有（只有表头那张空表看起来像坏了）',
);
assert.equal(
  elementsWithClass(weeklyEmpty, 'ranked__seeds').length,
  1,
  '★ 但"这一周用的是哪几个种子"照常在 —— 空的是**成绩**，不是这一周',
);
ok('周赛：第 0 周 + 四个种子逐格 + 顶部三格导航（含本周）+ 五列 + 空态');

// ---------------------------------------------------------------------------
console.log('⑤b ★ 周赛顶部：导航在**最上面** + 手输周数 + 「本周」（2026-09-19 加的两件）');
// ---------------------------------------------------------------------------
/*
 * ★★ 用户原话：「周赛将'上一周/下一周'移至**顶部**，并允许用户直接输入对应周的数字跳转，
 *    添加'本周'按钮」。
 *
 * ⚠️★ "在顶部"这件事的判据只能是**位置**（产物里那三格的文字与改版前一模一样）：
 *    下面的 `indexOf` 比的是"导航那一行出现在种子/表格**之前**"。
 *    ⚠️ 一个"两处都渲染"的实现会让 `indexOf` 找到**第一处**（顶部的那个）而全绿 ——
 *    所以另外要断言这一行**只有一处**（`.ranked__weeknav` 的个数 == 1）。
 */
const navAt = weeklyLatest.indexOf('ranked__weeknav');
assert.ok(navAt >= 0, '★ 导航那一行在产物里（否则下面的位置比较是空跑）');
assert.equal(
  elementsWithClass(weeklyLatest, 'ranked__weeknav').length,
  1,
  '★★ 导航那一行**只有一处**（底部那个旧的必须已经删掉：两处导航会各自漂）',
);
/*
 * ⚠️ 位置比较用**三个锚点**（周数那一行、四格种子、成绩表）：它们都是改版前排在
 *    导航**前面**的东西（导航原来挂在表格下面）⇒ 这一行只要还在下面，第一条就红。
 *    ⚠️ 锚点必须是**唯一**的字符串：`ranked__meta` 这种到处都是的不能当锚点
 *    （`indexOf` 会命中更靠前的另一处，于是"它在下面"也能绿）。
 */
const weekNumberRow = elementsWithClass(weeklyLatest, 'ranked__meta')[0] ?? '';
assert.notEqual(weekNumberRow, '', '★ 周数与截止那一行在产物里');
for (const [what, at] of [
  ['周数与截止那一行', weeklyLatest.indexOf(weekNumberRow)],
  ['四格种子（含上面那句「种子」）', weeklyLatest.indexOf('ranked__seeds')],
  ['成绩表', weeklyLatest.indexOf('ranked__table')],
] as const) {
  assert.ok(at > 0, `★ ${what}在产物里（否则下面那条比较是空跑）`);
  assert.ok(navAt < at, `★★ 导航在**${what}之前** —— 用户要求把它移到顶部（原来它挂在表格下面）`);
}
assert.ok(
  navAt > weeklyLatest.indexOf('ranked__title'),
  '★ 但它**在面板标题之后**（标题是这一块的名字，导航是它的内容）',
);

/*
 * ★★ 手输周数那个框（用户："允许用户直接输入对应周的数字跳转"）。
 *
 * ⚠️★ 判据挑得刻意具体：
 *   · 输入框与那颗「跳转」**在同一个 `<form>` 里** —— 那是"回车能跳"的**结构**前提
 *     （回车提交表单是浏览器原生行为；自己监听键盘要处理 IME / 小键盘，
 *     而漏掉任何一种的表现都是"回车没反应"）。⚠️ 真的按一下回车这件事
 *     `renderToStaticMarkup` 证不了（本脚本末尾那段覆盖边界写着这一条）。
 *   · `type="submit"`（不是 `type="button"`）：不写的话那颗按钮提交不了表单，
 *     而产物里它与接好线的长得一模一样。
 *   · `type="text"` + `inputMode="numeric"`，**不是** `type="number"`：
 *     number 输入框会把字母吃掉（值直接变空串）⇒ 界面就没法说"请输入一个周数"了。
 *   · `<label class="sr-only" for>` 成对：占位符在输入第一个字之后就没了。
 */
const jumpForm = elementsWithClass(weeklyLatest, 'ranked__weekjump')[0] ?? '';
assert.notEqual(jumpForm, '', '★★ 手输周数那一块在（`<form class="ranked__weekjump">`）');
const jumpInput = /<input\b[^>]*>/.exec(jumpForm)?.[0] ?? '';
assert.notEqual(jumpInput, '', '★★ 那个 `<form>` 里有一个输入框');
assert.equal(
  attrOf(jumpInput, 'type'),
  'text',
  '★★ `type="text"`（number 会把字母吃掉，那我们就没法提示"请输入一个周数"了）',
);
/*
 * ⚠️ 判据写成**不分大小写**：React 19 的 `renderToStaticMarkup` 把 `inputMode` 原样印成
 *    `inputMode="numeric"`（不是小写），而 HTML 解析属性名时不分大小写 ⇒ 两种写法在浏览器里
 *    等价。写死小写会让这条断言红在一个与它对错无关的细节上（`attrOf` 是大小写敏感的）。
 */
assert.equal(
  /\binputmode="numeric"/i.test(jumpInput),
  true,
  '★ 手机上弹数字键盘（`inputMode="numeric"`）',
);
assert.equal(attrOf(jumpInput, 'id'), 'ranked-week-jump', '★ 输入框有 id（label 的 for 指向它）');
/*
 * ⚠️ 属性值**不能**用 `fresh()` 比：那一个会把空白删掉（"Jump to week" → "Jumptoweek"），
 *    而属性里的字是原样的 —— 中文碰巧没有空格，英文会当场红（这一条就是那么量出来的）。
 */
assert.equal(
  attrOf(jumpInput, 'placeholder'),
  decode(t('ranked.weeklyJump')),
  '★ 占位符用的是这一栏自己的词条',
);
assert.equal(
  attrOf(elementsWithClass(jumpForm, 'sr-only')[0] ?? '', 'for'),
  'ranked-week-jump',
  '★★ `<label class="sr-only" for="ranked-week-jump">` —— 输入框有一个**可访问名字**（占位符会消失）',
);
const jumpButtons = buttons(jumpForm);
assert.equal(jumpButtons.length, 1, '★★ 那个表单里恰好一颗按钮（「跳转」）');
assert.equal(jumpButtons[0]?.text, fresh('ranked.weeklyJumpGo'), '★★ 它的文字是「跳转」');
assert.equal(
  /(?:^|\s)type="submit"(?:\s|$)/.test(jumpButtons[0]?.attrs ?? ''),
  true,
  '★★ 它是 `type="submit"`：回车提交表单靠的就是它（`type="button"` 提交不了，而产物里看不出差别）',
);
/* 框里的字是**受控**的：喂什么就印什么（容器把用户打的字原样传进来）。 */
const weeklyTyped = renderWeekly({ weekInput: '95' }, '周赛·框里打着 95');
assert.equal(
  attrOf(
    /<input\b[^>]*>/.exec(elementsWithClass(weeklyTyped, 'ranked__weekjump')[0] ?? '')?.[0] ?? '',
    'value',
  ),
  '95',
  '★ 输入框是**受控**的（容器给什么就印什么 —— 打了字界面上却不动是最坏的一种静默）',
);
assert.equal(
  elementsWithClass(weeklyTyped, 'ranked__jumperror').length,
  0,
  '★ 没填错时不渲染那一句提示（正面对照在下面）',
);

/*
 * ★★ 两种"不合法"各自说一句人话（**本地的**、一个请求都不发）。
 *
 * ⚠️★ 对照表钉在 `WEEK_INPUT_ERROR_KEYS` 上（它是从 `RankedPanels` 导出的那一张）：
 *    `not_a_number` ⇒ 「请输入一个周数。」，而"这个周数不存在"（0 / ≤ -2 / 比最新周还大）
 *    ⇒ **复用** `ranked.errNotFound`（「没有这一周。」）—— 那是**上游**对一个不存在的
 *    周号回的原话，本地判出来的同一件事没有理由换个说法。
 *    ⚠️ 这张表的值对 `i18n-keys.test.ts` 是看不见的（表里的值不是字面量调用）
 *    ⇒ 只有这里能断言"两条 key 在两种语言里都在"。
 */
assert.deepEqual(
  WEEK_INPUT_ERROR_KEYS,
  { not_a_number: 'ranked.weeklyBadNumber', no_such_week: 'ranked.errNotFound' },
  '★★ 「输入不合法 → 词条」那张表被改了（两档的话不同，因为用户下一步做的事不同）',
);
for (const [lng, dict] of [
  ['zh-CN', zhCN],
  ['en', en],
] as const) {
  for (const key of Object.values(WEEK_INPUT_ERROR_KEYS)) {
    const leaf = key.replace(/^ranked\./, '');
    assert.notEqual(
      (dict.ranked as Record<string, unknown>)[leaf],
      undefined,
      `★★ \`${key}\` 在 ${lng} 字典里必须有值（表里的 key 门禁看不见 —— 少一条界面会印出裸 key）`,
    );
  }
}
for (const [reason, key] of Object.entries(WEEK_INPUT_ERROR_KEYS)) {
  const html = renderWeekly({ weekError: t(key) }, `周赛·提示（${reason}）`);
  assert.equal(
    textOf(elementsWithClass(html, 'ranked__jumperror')[0] ?? ''),
    fresh(key),
    `★★ 判定为 \`${reason}\` 时，那一句提示就是 \`${key}\` 的内容`,
  );
  /*
   * ⚠️★ 提示**不许**顺手把导航那一行弄没、也不许把这一周的数据清掉：
   *    用户只是打错了一个数，屏幕上的东西一样都不该少（"失败绝不清空"的同一条道理）。
   */
  assert.equal(
    elementsWithClass(html, 'ranked__navbtn').length,
    3,
    `★ 有提示时导航三格照旧（${reason}）`,
  );
  assert.equal(navOf(html)[2]?.href, weekPath(LATEST_ID), `★ 「本周」照样是链接（${reason}）`);
}
assert.notEqual(
  fresh(WEEK_INPUT_ERROR_KEYS.not_a_number),
  fresh(WEEK_INPUT_ERROR_KEYS.no_such_week),
  '★★ 探针：两档的话本身必须不同（否则上面两条是同一条断言）',
);
ok('周赛顶部：导航在最上面（只有一处）+ 受控输入框 + 提交键 + 本周 + 两种提示各说一句');

// ---------------------------------------------------------------------------
console.log('⑥ 五种整体画面（spec §6.6）：正常 / 加载中 / 失败无旧数据 / 失败有旧数据 / 空集合');
// ---------------------------------------------------------------------------
/*
 * ★★ 每一条都要求能把**别人**的判据排除掉，否则四种画面会互相冒充：
 *    · 失败**不许**长得像加载中（那会让人一直等下去 —— 上一轮 `ShareIntroView` 的缺陷就是这个）；
 *    · 有旧数据时**绝不清空**：判据是"旧数据**还在**"，不是"那句话说了旧数据"；
 *    · 重试键是**可点的**（`assertClickable` 读 `disabled`）。
 * ⚠️ 两个"失败"档位里错误句用的是**真的那一句**（`ranked.loadFailed` + 映射器给的那半句），
 *    不是哨兵字符串 —— 换掉文案时这里要一起改，那正是它该有的代价。
 * ⚠️ ① 的"空集合"就是 `players: 0`（它没有列表，那两句话的对照在 ② 里逐格钉过）。
 */
interface OverallStates {
  where: string;
  normal: string;
  loading: string;
  failedNoOld: string;
  failedOld: string;
  empty: string;
  /** 产物里"数据确实渲染了"的记号个数（0 = 什么都没渲染）。 */
  dataCount: (html: string) => number;
  /** 空集合那一档自己的判据（各面板的"空"长得很不一样）。 */
  emptyCheck: (html: string) => void;
}

function assertFiveStates(c: OverallStates): void {
  /* —— 正常 —— */
  assert.equal(
    textOf(elementsWithClass(c.normal, 'ranked__updated')[0] ?? ''),
    fresh('ranked.updatedAgo', { secs: UPDATED }),
    `★ ${c.where}·正常：说得出「${String(UPDATED)} 秒前更新」`,
  );
  assert.ok(
    c.dataCount(c.normal) > 0,
    `★ ${c.where}·正常：数据真的渲染了（否则下面"旧数据还在"是空对空）`,
  );
  assert.deepEqual(elementsWithClass(c.normal, 'notice'), [], `★ ${c.where}·正常：一条提示都没有`);
  assert.deepEqual(retryButtons(c.normal), [], `★ ${c.where}·正常：不渲染「重试」（没失败过）`);

  /* —— 加载中（第一次） —— */
  assert.ok(hasText(c.loading, t('common.loading')), `★★ ${c.where}·加载中：说的是「加载中…」`);
  assert.deepEqual(
    elementsWithClass(c.loading, 'notice'),
    [],
    `★★ ${c.where}·加载中：**不**说失败（"慢"与"挂了"必须分得开）`,
  );
  assert.equal(
    c.dataCount(c.loading),
    0,
    `★ ${c.where}·加载中：确实什么都还没有（于是"失败时旧数据还在"那条有对照）`,
  );
  assert.deepEqual(
    elementsWithClass(c.loading, 'ranked__updated'),
    [],
    `★★ ${c.where}·加载中：「N 秒前更新」整行不渲染（写「0 秒前更新」是撒谎）`,
  );
  assert.deepEqual(
    retryButtons(c.loading),
    [],
    `★ ${c.where}·加载中：一次都还没失败 ⇒ 不给「重试」`,
  );

  /* —— 失败·没有旧数据 —— */
  assert.equal(
    textOf(elementsWithClass(c.failedNoOld, 'notice--bad')[0] ?? ''),
    flat(ERROR_TEXT),
    `★★ ${c.where}·失败无旧数据：说的是那句话本身`,
  );
  assertClickable(c.failedNoOld, t('common.retry'), `${c.where}·失败无旧数据`);
  assert.equal(
    c.dataCount(c.failedNoOld),
    0,
    `★ ${c.where}·失败无旧数据：没有旧数据可留（正面对照在下一档）`,
  );
  assert.equal(
    hasText(c.failedNoOld, t('common.loading')),
    false,
    `★★ ${c.where}·失败无旧数据：**不许**渲染成「加载中…」（那会让人一直等下去）`,
  );
  assert.deepEqual(
    elementsWithClass(c.failedNoOld, 'ranked__updated'),
    [],
    `★ ${c.where}·失败无旧数据：也没成功过一次 ⇒ 不渲染新鲜度那一行`,
  );

  /* —— 失败·有旧数据（**绝不清空**） —— */
  assert.equal(
    textOf(elementsWithClass(c.failedOld, 'notice--info')[0] ?? ''),
    fresh('ranked.refreshFailed', { secs: STALE }),
    `★★ ${c.where}·失败有旧数据：说清"下面是 ${String(STALE)} 秒前的数据"（那个数得是真的）`,
  );
  assert.ok(
    c.dataCount(c.failedOld) > 0,
    `★★ ${c.where}·失败有旧数据：旧数据**还在**（spec §6.6 那一行：绝不清空）`,
  );
  assertClickable(c.failedOld, t('common.retry'), `${c.where}·失败有旧数据`);
  assert.equal(
    hasText(c.failedOld, t('common.loading')),
    false,
    `★★ ${c.where}·失败有旧数据：手里有旧数据时说「加载中…」是错的`,
  );
  assert.equal(
    textOf(elementsWithClass(c.failedOld, 'ranked__updated')[0] ?? ''),
    fresh('ranked.updatedAgo', { secs: STALE }),
    `★ ${c.where}·失败有旧数据：新鲜度那一行说的是**同一个数**（容器里 \`staleSecs = updatedAgoSecs\`）`,
  );
  assert.equal(
    hasText(c.failedOld, t('ranked.refreshFailed', { secs: STALE + 1 })),
    false,
    `★★ ${c.where}·失败有旧数据：那个秒数得是**真的那个**（不是随便印一个数字）`,
  );
  assert.notEqual(
    flat(ERROR_TEXT),
    fresh('ranked.refreshFailed', { secs: STALE }),
    `★ 探针（${c.where}）：两档失败的句子本身不同（否则"哪一档"分不出来）`,
  );

  /* —— 上游给了空集合 —— */
  assert.ok(
    hasText(c.empty, t('common.loading')) === false,
    `★★ ${c.where}·空集合：**不是**「加载中…」（空集合 ≠ 加载中 ≠ 出错了）`,
  );
  assert.deepEqual(
    elementsWithClass(c.empty, 'notice'),
    [],
    `★★ ${c.where}·空集合：也不是"出错了"`,
  );
  c.emptyCheck(c.empty);
  assert.deepEqual(retryButtons(c.empty), [], `★ ${c.where}·空集合：没有失败 ⇒ 不给「重试」`);

  ok(`${c.where}：五种整体画面各自的产物（含"失败绝不清空"与可点的重试）`);
}

const rowCount = (html: string): number => (html.match(/<td>/g) ?? []).length;

/*
 * ⚠️ 探针：「重试」那一堆断言**必须有反面**，否则它可能只是"读取器看不见 disabled"
 *    （那样"可点"就恒真了）。同一颗按钮、同一支读取器，`busy: true` 时必须带上 `disabled`。
 */
assert.equal(
  isDisabled(
    retryButtons(
      renderStatus(
        { errorText: ERROR_TEXT, staleSecs: STALE, updatedAgoSecs: STALE, busy: true },
        '状况·失败且正在重试（探针）',
      ),
    )[0]?.attrs ?? '',
  ),
  true,
  '★★ 探针：`busy` 时那颗「重试」**必须**带 disabled（否则下面那几条"可点"是恒真的）',
);

assertFiveStates({
  where: '① 状况',
  normal: renderStatus({}, '状况·正常（五种画面）'),
  loading: renderStatus({ status: null, players: null, updatedAgoSecs: null }, '状况·加载中'),
  failedNoOld: renderStatus(
    { status: null, players: null, errorText: ERROR_TEXT, updatedAgoSecs: null },
    '状况·失败无旧数据',
  ),
  failedOld: renderStatus(
    { errorText: ERROR_TEXT, staleSecs: STALE, updatedAgoSecs: STALE },
    '状况·失败有旧数据',
  ),
  empty: stZero,
  dataCount: (html) => elementsWithClass(html, 'ranked__badge').length,
  emptyCheck: (html) => {
    assert.ok(
      playersOf(html).includes(fresh('ranked.playersZero')),
      '★★ ① 的"空集合"就是 `players: 0` ⇒ 「现在没有人在玩 Ranked」',
    );
  },
});

assertFiveStates({
  where: '② 对局',
  normal: renderLive({}, '对局·正常（五种画面）'),
  loading: renderLive({ live: null, updatedAgoSecs: null }, '对局·加载中'),
  failedNoOld: renderLive(
    { live: null, errorText: ERROR_TEXT, updatedAgoSecs: null },
    '对局·失败无旧数据',
  ),
  failedOld: renderLive(
    { errorText: ERROR_TEXT, staleSecs: STALE, updatedAgoSecs: STALE },
    '对局·失败有旧数据',
  ),
  empty: renderLive({ live: LIVE_EMPTY }, '对局·空集合'),
  dataCount: (html) => elementsWithClass(html, 'ranked__match').length,
  emptyCheck: (html) => {
    assert.equal(
      textOf(elementsWithClass(html, 'ranked__empty')[0] ?? ''),
      fresh('ranked.liveEmpty'),
      '★★ ② 的空集合说「现在没有直播中的对局。」',
    );
    assert.equal(elementsWithClass(html, 'ranked__match').length, 0, '★ 而且一张卡片都没有');
    assert.equal(
      textOf(elementsWithClass(html, 'ranked__meta')[0] ?? ''),
      '',
      '★ 「共 N 场」那句在 0 场时**不渲染**（N = 0 时它是一句废话，读起来像模板坏了）',
    );
  },
});

assertFiveStates({
  where: '③ 排行榜',
  normal: renderElo({}, '排行榜·正常（五种画面）'),
  loading: renderElo({ elo: null, updatedAgoSecs: null }, '排行榜·加载中'),
  failedNoOld: renderElo(
    { elo: null, errorText: ERROR_TEXT, updatedAgoSecs: null },
    '排行榜·失败无旧数据',
  ),
  failedOld: renderElo(
    { errorText: ERROR_TEXT, staleSecs: STALE, updatedAgoSecs: STALE },
    '排行榜·失败有旧数据',
  ),
  empty: eloEmpty,
  dataCount: rowCount,
  emptyCheck: (html) => {
    assert.equal(
      textOf(elementsWithClass(html, 'ranked__empty')[0] ?? ''),
      fresh('ranked.eloEmpty'),
      '★★ ③ 的空集合说「这个赛季还没有人上榜。」',
    );
    assert.equal(rowCount(html), 0, '★ 而且一行成绩都没有');
  },
});

assertFiveStates({
  where: '④ 周赛',
  normal: renderWeekly({}, '周赛·正常（五种画面）'),
  loading: renderWeekly({ weekly: null, latestId: null, updatedAgoSecs: null }, '周赛·加载中'),
  failedNoOld: renderWeekly(
    { weekly: null, latestId: null, errorText: ERROR_TEXT, updatedAgoSecs: null },
    '周赛·失败无旧数据',
  ),
  failedOld: renderWeekly(
    { errorText: ERROR_TEXT, staleSecs: STALE, updatedAgoSecs: STALE },
    '周赛·失败有旧数据',
  ),
  empty: weeklyEmpty,
  dataCount: rowCount,
  emptyCheck: (html) => {
    assert.equal(
      textOf(elementsWithClass(html, 'ranked__empty')[0] ?? ''),
      fresh('ranked.weeklyEmpty'),
      '★★ ④ 的空集合说「这一周还没有人完赛。」',
    );
    assert.equal(rowCount(html), 0, '★ 而且一行成绩都没有');
  },
});

// ---------------------------------------------------------------------------
console.log('⑥b 失败 → 一句人话（lib/rankedErrors.ts 的七格表）');
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 这一节补的是一个**全仓没有第二处**的空白（这次不在任务书的十条里，故编号写 `⑥b`，
 *    与「实时分享」的 `①b` 是同一条理由）：`describeRankedError` 是纯函数，而它的
 *    **唯一调用点**在容器里（`routes/Ranked.tsx` 的 `load`）—— 容器在纯 SSR 下永远
 *    停在"加载中"，所以那张表在本次改动之前**没有任何断言**。
 *    对调两格的表现是全静默：界面照样渲染、类型照样过（七格都是 `string`）、
 *    门禁一个都不看它，而用户读到的是另一段处境的话。
 *    `lib/rankedErrors.ts` 的文件头**就是这么写的**（"`RANKED_ERROR_KEYS` 导出，
 *    `apps/web/scripts/rankedrender.tsx` 逐格断言它"），这里把那句话兑现。
 * ⚠️ 判据是**精确的 key**，不是"非空"：非空对"两句对调"完全免疫。
 */
const errorSay = (key: string, opts?: Record<string, unknown>): string =>
  opts?.status === undefined ? key : `${key}|status=${String(opts.status)}`;
/** 走一遍**真实**的 `describeRankedError`（表对了但派发不查表，也是缺陷）。 */
const sayOf = (error: unknown): string => describeRankedError(error, errorSay, () => FALLBACK);
/**
 * 我们那个端点的一次拒绝。⚠️ `ApiError` 的构造器有**十个位置参数**（它自己的注释里
 * 写了为什么会这样），这里只用得到 `status` 与 `code`，所以包一层 ——
 * 免得每一行都要数八个 `undefined`。
 */
const refusalOf = (status: number, code?: string): ApiError =>
  new ApiError(
    `server refused: ${String(status)}`,
    status,
    code,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  );

assert.deepEqual(
  RANKED_ERROR_KEYS,
  {
    network: 'ranked.errNetwork',
    http: 'ranked.errHttp',
    not_found: 'ranked.errNotFound',
    bad_response: 'ranked.errBadResponse',
    busy: 'ranked.errBusy',
    unavailable: 'ranked.errUnavailable',
    rated: 'ranked.errRateLimited',
  },
  '★★ 七格表被改了（对调两行在界面上**看不出来**）',
);
/* 直连那四个原因**就是**四个 source，一一对应（`RankedDirectError.reason`）。 */
assert.equal(
  sayOf(new RankedDirectError('network', '两个入口都连不上')),
  'ranked.errNetwork',
  '★★ 连不上上游 ⇒ 说"可能是网络或扩展拦了"（用户下一步是查自己的网络）',
);
assert.equal(
  sayOf(new RankedDirectError('not_found', '上游说这一周不存在', 400)),
  'ranked.errNotFound',
  '★★ 上游回 400「没有这一周」⇒ 说"没有这一周"（**不是**"上游回了个意外的状态码"）',
);
assert.equal(
  sayOf(new RankedDirectError('bad_response', '响应体不是 JSON')),
  'ranked.errBadResponse',
  '★★ 读到看不懂的东西 ⇒ 说"看不懂"（与"连不上"是两件事）',
);
assert.equal(
  sayOf(new RankedDirectError('rated', '上游在限流', 429)),
  'ranked.errRateLimited',
  '★★ 上游按访客的 IP 限流 ⇒ 说"请求有点频繁"（**不**复用全站的 `rate_limited` 文案）',
);
/* `errHttp` 是七句里**唯一**带 `{{status}}` 的：那个数字必须真的填进去。 */
assert.equal(
  sayOf(new RankedDirectError('http', 'HTTP 521', 521)),
  'ranked.errHttp|status=521',
  '★★ 上游回别的状态码 ⇒ 那句话里带着**真的那个数字**',
);
assert.equal(
  sayOf(new RankedDirectError('http', 'HTTP ?')),
  FALLBACK,
  '★★ 手搓的 `http` 错误没带状态码 ⇒ 走兜底（印一句「（HTTP ）。」比笼统的话糟得多）',
);
/* 我们那个端点：**码是权威判据**，状态码只在码读不到时兜底（503 那两档只有码分得开）。 */
assert.equal(
  sayOf(refusalOf(503, 'ranked_busy')),
  'ranked.errBusy',
  '★★ 码 `ranked_busy` ⇒ 「上游有点忙」',
);
assert.equal(
  sayOf(refusalOf(503, 'upstream_unavailable')),
  'ranked.errUnavailable',
  '★★ 码 `upstream_unavailable` ⇒ 「上游暂时读不到」',
);
assert.equal(
  sayOf(refusalOf(502, 'upstream_bad_response')),
  'ranked.errBadResponse',
  '★★ 我们的 502 ⇒ 与直连的"看不懂"同一句（两边说的是同一件事）',
);
assert.equal(sayOf(refusalOf(429)), 'ranked.errRateLimited', '★ 没带码的 429 由状态码兜底');
assert.equal(
  sayOf(refusalOf(503)),
  'ranked.errUnavailable',
  '★ 没带码的 503 只能取"不会说错"的那一档（有码时根本不看状态码）',
);
/*
 * ★★ 认不出来的失败**不编一句话**：我们自己的服务器没起来（`status === 0`）不能
 *    说成"上游暂时读不到"—— 那是**把责任推给第三方**，用户会去等一个不是问题的地方。
 *    同样地：没有码的 502 恰恰是**反代**发的（上游根本没被问到）。
 */
assert.equal(sayOf(refusalOf(0)), FALLBACK, '★★ 连不上我们自己的服务器 ⇒ 走兜底（不是"上游"的事）');
assert.equal(sayOf(refusalOf(502)), FALLBACK, '★★ 没有码的 502 是反代发的 ⇒ 走兜底（不许怪上游）');
assert.equal(
  sayOf(refusalOf(500, 'some_new_code')),
  FALLBACK,
  '★★ 没登记的码 ⇒ 走兜底（不假装认识它）',
);
assert.equal(sayOf(new Error('not an ApiError')), FALLBACK, '★ 别的异常一律走兜底');
assert.notEqual(
  errorSay('ranked.errNetwork'),
  errorSay('ranked.errNotFound'),
  '★ 探针：记录器本身能区分两个 key（否则上面那些"两句不同"是空跑）',
);
/*
 * ★★ 七条 key 的**存在性**：逐格 × 两种语言。
 *
 * ⚠️★ 这一圈是 2026-09-16 终审补上的，因为 `lib/rankedErrors.ts` 那条注释**声称**它已经有了，
 *    而实测没有（当时脚本只断言了这张表的**值**、并用记录器走了一遍派发）。
 * ⚠️ 为什么那种"空"极难发现，非要说清楚（下一个人才知道它为什么不能删）：
 *    · 上面那些断言证明的是"派发查表、查的就是这张表"，与"表里的 key **有没有词条**"是两件事；
 *    · 记录器 `errorSay` 把 key **原样返回** ⇒ 就算某一条词条两份字典里都没有，本节照样全绿；
 *    · 七条里**绝大多数在任何产物上都不会出现**（失败那句话在界面上是一件已经翻好的字符串），
 *      ⇒ ⑩ 的裸 key 扫描看不见它们；
 *    · 而"两份字典**都**少掉同一条"对全仓的语言对齐测试同样是隐形的（两边都没有 ⇒ 对齐）。
 *    ⇒ 少了这一圈，唯一的发现路径是"用户看到裸 key 那天"。
 * ⚠️ 形状与 ⑨ 的 `TIMELINE_LABEL_KEYS` 那一圈**逐字相同**（存在性 + 真值 + 非空），
 *    连理由都同一条：这两张表里的数据都**不再是 `t('…')` 调用点**，任何字面量扫描都够不着。
 */
for (const [source, key] of Object.entries(RANKED_ERROR_KEYS)) {
  for (const lng of LANGUAGES) {
    assert.ok(
      i18n.exists(key, { lng }),
      `★★ 失败词条 ${key} 在【${lng}】里不存在（\`${source}\` 会印出裸 key）`,
    );
    const value = i18n.t(key, { lng }) as string;
    assert.notEqual(
      value,
      key,
      `★★ 失败词条 ${key} 在【${lng}】里没有真值（i18next 会原样返回 key）`,
    );
    assert.notEqual(
      flat(value),
      '',
      `★★ 失败词条 ${key} 在【${lng}】里是空的（空格子看起来像渲染坏了）`,
    );
  }
}
ok('失败码：七格表逐格 + 派发真的查表 + 七条词条两种语言都在 + 503 两档分得开 + 认不出来不编话');

// ---------------------------------------------------------------------------
console.log('⑦ ★ 直连请求的选项 + 兜底那一次（整节不碰真实网络）');
// ---------------------------------------------------------------------------
/*
 * ★★ 这一节是本栏目最容易犯、也最难从画面上看出来的那个错（spec §10 第 2 条）：
 *    `cache: 'no-store'` 不是优化，它是"面板会不会冻在 4 小时前那一份上"的前提。
 *    而这件事**只存在于函数被调用时** —— 产物里一个字都看不出来。
 * ⚠️⚠️ 两道保险，缺一不可：
 *    ① `setUpstreamFetchForTests(记录器)` 之后**必须**用 `(null)` 复位
 *      （`rankedDirect.ts` 的注释写着为什么不能把原生 `fetch` 传进去复位）；
 *    ② 整节期间 `globalThis.fetch` 是一个**会记账的哨兵**：任何一次漏出去的请求
 *      都会被记下来并当场抛出 ⇒ 最后断言"哨兵一次都没被走到"。
 */
const calls: { url: string; init: RequestInit | undefined }[] = [];

/** 上游的响应（这一节不关心解析结果，只关心请求本身怎么发出去的）。 */
const upstreamResponse = (body: string, status: number): Response =>
  new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** 记录器：把每一次 `fetch` 的地址与 init 原样收下，然后回一个正常的 200。 */
const recorder = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  calls.push({ url: String(input), init });
  return Promise.resolve(upstreamResponse('{"status":"success","data":{}}', 200));
};

const realFetch = globalThis.fetch;
let leaked = 0;
const sentinel = (): never => {
  leaked += 1;
  throw new Error('★★ 渲染自检里不许发真实网络请求');
};

setUpstreamFetchForTests(null);
globalThis.fetch = sentinel as unknown as typeof globalThis.fetch;
try {
  setUpstreamFetchForTests(recorder as unknown as typeof globalThis.fetch);
  /*
   * ★★ **四个** fetcher 各打一次 —— 四个都必须在里面，尤其 `fetchRankedPhase`：
   *    spec §11.3 那条"直连请求的冻结选项"**只有这里能验**（它只存在于函数被调用时），
   *    少列一个就等于那一次请求的 `cache` / `credentials` / `referrerPolicy` / 头
   *    **一条断言都没有**（2026-09-19 复评 I1：它当时正是漏在外面的那一个）。
   * ⚠️ 顺序 = 容器里的调用顺序（③ 先榜后赛段，见 `routes/Ranked.tsx`）—— 下面比的是逐条的路径。
   * ⚠️ 用 `allSettled`：这一节断言的是**请求怎么发出去的**，
   * 而 stub 回的是一个空壳响应 ⇒ 解析层会（正确地）说"形状对不上"。
   * 让那件事把整节打断的话，断言就永远走不到了。
   */
  await Promise.allSettled([
    fetchRankedLive(),
    fetchRankedElo(),
    fetchRankedPhase(),
    fetchRankedWeekly(null),
  ]);
  assert.equal(calls.length, 4, `★★ 四个 fetcher 各打一次（实测 ${String(calls.length)} 次）`);
  assert.deepEqual(
    calls.map((c) => new URL(c.url).pathname),
    ['/live', '/leaderboard', '/phase-leaderboard', '/weekly-race'],
    '★ 四条路径（上游域名只在 `const.ts` 里写一次，所以这里比的是路径）',
  );
  for (const [i, call] of calls.entries()) {
    const init = call.init ?? {};
    assert.ok(
      call.url.startsWith(RANKED_UPSTREAM_PRIMARY),
      `★★ 第 ${String(i + 1)} 次走的是**主入口**（兜底入口只在网络失败时用）`,
    );
    /* ★ 三个选项：字面量写在这里，不从常量现算 —— 常量改了这里照样红。 */
    assert.equal(
      init.cache,
      'no-store',
      `★★ 第 ${String(i + 1)} 次：cache 必须是 'no-store'（上游回 max-age=14400）`,
    );
    assert.equal(
      init.credentials,
      'omit',
      `★★ 第 ${String(i + 1)} 次：credentials 必须是 'omit'（不带访客的 cookie）`,
    );
    assert.equal(
      init.referrerPolicy,
      'no-referrer',
      `★★ 第 ${String(i + 1)} 次：referrerPolicy 必须是 'no-referrer'（不带来源页地址）`,
    );
    /* ★★ 头**只有** `accept`：多一个自定义头就多一次预检，而预检我们没验过。 */
    assert.deepEqual(
      Object.keys(init.headers ?? {}),
      ['accept'],
      `★★ 第 ${String(i + 1)} 次：请求头**只有** accept（自定义头会触发 OPTIONS 预检）`,
    );
    assert.equal(
      (init.headers as Record<string, string>).accept,
      'application/json',
      `★ 第 ${String(i + 1)} 次：accept 的值`,
    );
    assert.deepEqual(
      Object.keys(init).sort(),
      ['cache', 'credentials', 'headers', 'referrerPolicy', 'signal'],
      `★★ 第 ${String(i + 1)} 次：init 上没有多余的东西（多一项就是多一份没人验过的行为）`,
    );
    /*
     * ⚠️★ 这里原本还有一条 `assert.equal(init.signal, undefined, '没传 signal 的那几个调用点')`
     *    —— 2026-09-16 终审删掉了：四个 fetcher 都是**不带参数**调用的，
     *    那个值由构造方式决定（`signal` 这个键必须有、值只能是 `undefined`），
     *    而"这个键在不在"已经由上面那条 `Object.keys(init).sort()` 钉着 ⇒ 它不可能红。
     *    ⚠️ 没有它**不是**少了一件事：`signal` 真的传错了是**运行时**判据 ——
     *    容器那一条（换页/卸载时取消）走的是 `rankedDirect` 的 abort 判据，
     *    而"取消不是失败"那一格由 ⑥b 的 `isAbort` 与容器的过滤共同保证。
     */
  }
  /* 冻结常量与"实际发出去的"必须一致（常量那一份单独钉，免得它漂走没人知道）。 */
  assert.deepEqual(
    { ...RANKED_FETCH_OPTIONS },
    { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' },
    '★★ spec §13 冻结的三个直连选项',
  );
  assert.deepEqual(
    { ...RANKED_FETCH_HEADERS },
    { accept: 'application/json' },
    '★★ spec §13 冻结的请求头（只有 CORS 安全列表内的一个）',
  );

  /* —— 兜底那一对：网络失败 ⇒ 打兜底入口一次；500 ⇒ **不**重试 —— */
  calls.length = 0;
  const networkDown = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init });
    return Promise.reject(new TypeError('fetch failed'));
  };
  setUpstreamFetchForTests(networkDown as unknown as typeof globalThis.fetch);
  await assert.rejects(
    () => fetchRankedLive(),
    (error: unknown) => error instanceof RankedDirectError && error.reason === 'network',
    '★★ 两个入口都连不上 ⇒ `network`（不是 `http`，也不是"没有对局"）',
  );
  assert.equal(
    calls.length,
    2,
    `★★ 主入口网络失败 ⇒ 打兜底入口一次（共 ${String(calls.length)} 次）`,
  );
  assert.ok(calls[0]?.url.startsWith(RANKED_UPSTREAM_PRIMARY), '★ 第一次是主入口');
  assert.ok(calls[1]?.url.startsWith(RANKED_UPSTREAM_ALT), '★★ 第二次是兜底入口');
  /*
   * ★★ 两次请求的是**同一个路径** —— 比的是"入口基址之后那一段"，因为两个入口的基址
   *    本身不一样（兜底那个自带 `/api`，那正是它存在的形式）。拿 `pathname` 直接比
   *    会得到 `/api/live` vs `/live`，看起来像"两条不同的路"。
   */
  assert.equal(
    (calls[1]?.url ?? '').slice(RANKED_UPSTREAM_ALT.length),
    (calls[0]?.url ?? '').slice(RANKED_UPSTREAM_PRIMARY.length),
    '★★ 两次是**同一个路径**（换入口不换路径）',
  );
  calls.length = 0;
  const serverError = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init });
    return Promise.resolve(upstreamResponse('upstream said no', 500));
  };
  setUpstreamFetchForTests(serverError as unknown as typeof globalThis.fetch);
  await assert.rejects(
    () => fetchRankedLive(),
    (error: unknown) =>
      error instanceof RankedDirectError && error.reason === 'http' && error.status === 500,
    '★★ 上游回 500 ⇒ `http` 500（那是上游在回答我们）',
  );
  assert.equal(
    calls.length,
    1,
    `★★ 上游回 500 ⇒ **不**重试（重试只会把访客的额度再烧一次，还把确定的答案变成慢等待）`,
  );
  assert.ok(calls[0]?.url.startsWith(RANKED_UPSTREAM_PRIMARY), '★ 而且那一次就是主入口');
  /* 429 单独成档（上游按**访客自己的 IP** 限流时回的就是它）。 */
  calls.length = 0;
  setUpstreamFetchForTests(((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(upstreamResponse('slow down', 429));
  }) as unknown as typeof globalThis.fetch);
  await assert.rejects(
    () => fetchRankedLive(),
    (error: unknown) => error instanceof RankedDirectError && error.reason === 'rated',
    '★★ 429 ⇒ `rated`（不是 `http`：那一档的文案说的是"请求有点频繁"）',
  );
  assert.equal(calls.length, 1, '★ 429 也不重试（与 500 同一条：那是上游在回答我们）');

  /* —— 复位，并且**证明**复位真的生效（否则后面任何一次调用都会打到上游）—— */
  setUpstreamFetchForTests(null);
  calls.length = 0;
  const afterRestore = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init });
    return Promise.resolve(upstreamResponse('nope', 500));
  };
  globalThis.fetch = afterRestore as unknown as typeof globalThis.fetch;
  await assert.rejects(
    () => fetchRankedLive(),
    (error: unknown) => error instanceof RankedDirectError && error.reason === 'http',
    '★★ 复位之后那一次必须真的走 `globalThis.fetch`（替身还挂着的话，这条断言根本不成立）',
  );
  assert.equal(
    calls.length,
    1,
    '★★ 复位**真的**生效：`globalThis.fetch` 被走到了（一次，500 不重试）',
  );
  assert.equal(leaked, 0, '★★ 整节没有一次请求漏到真实网络（哨兵一次都没被走到）');
} finally {
  setUpstreamFetchForTests(null);
  globalThis.fetch = realFetch;
}
/*
 * ⚠️★ 这里原本还有一条"收尾：`globalThis.fetch` 必须换回原来那一个"的**同一性读回**
 *    —— 2026-09-16 终审删掉了，判断写在明面上（免得下一个人又"补"回来）：
 *    它断言的是**本脚本自己的脚手架**（那几个 `globalThis.fetch = …` 有没有换回来），
 *    不是这一栏的行为；而这一栏真正要守的"一次真实网络请求都不许发出去"由下面那条
 *    `leaked === 0` 与节内那条哨兵断言管着（哨兵一被走到就会抛出并计数）。
 *    ⚠️ 也不是全无线索：复位**真的生效**这件事由节内那条断言证着
 *    （`setUpstreamFetchForTests(null)` 之后那一次必须打到 `globalThis.fetch` 上，
 *    见上面"复位**真的**生效"那一条）—— 那一条能红，这一条不能。
 */
assert.equal(leaked, 0, '★★ 收尾：一次真实网络请求都不许发出去');
ok('直连：三个选项 + 只有一个头 + 兜底那一次 + 500 不重试 + 无真实网络');

// ---------------------------------------------------------------------------
console.log('⑧ ★ 类名 ↔ CSS：产物里每一个 `ranked*` 类名都要有规则（本体在 ⑨ 之后跑，见那段）');
// ---------------------------------------------------------------------------
/*
 * ⚠️★ `docs/pending.md §5.70`：本仓样式是全局的、没有 CSS Modules 兜底，而"渲染了一个
 *    不存在的类名"**全仓没有任何门禁**发现得了（`ShareForm` 里那个 `.mcsr-input` 笔误
 *    就这样活过了两轮评审）。这一条把它在**本栏目内**关掉。
 * ⚠️ 判据是"整条选择器里有这个类名"，所以边界处必须写死 `(?![A-Za-z0-9_-])`：
 *    `css.includes('.ranked__side')` 会被 `.ranked__side--right` **满足**，
 *    于是一条不存在的规则看起来"有" —— 下面三条探针把这件事钉下来。
 */
const CSS = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const hasCssRule = (css: string, cls: string): boolean =>
  new RegExp(`\\.${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_-])`).test(css);

assert.equal(
  hasCssRule('.ranked__side{}', 'ranked__side'),
  true,
  '★ 探针：这个读取器能认出一条规则',
);
assert.equal(
  hasCssRule('.ranked__side--right{}', 'ranked__side'),
  false,
  '★★ 探针：`.ranked__side--right` **不能**满足 `.ranked__side`（前缀关系 —— §5.70 那一类的坑）',
);
assert.equal(
  hasCssRule(CSS, 'ranked__nosuchclass'),
  false,
  '★★ 探针：产物里不存在的类名不许在 `styles.css` 里"找到"（否则下面整节是空跑）',
);
assert.equal(
  hasCssRule(CSS, 'ranked__side'),
  true,
  '★ 探针：真实那份 `styles.css` 里确实有 `.ranked__side`（证明文件读对了）',
);

/*
 * ===========================================================================
 * ★★★ ⑧b 列的**轨道**：`.ranked__detailmatch` 不许出现"按内容算宽"的轨道
 * ===========================================================================
 * 用户原话「展开后的卡片对应信息版面**尽量对齐**」，而**"列真的对齐了没有"这件事
 * 静态渲染证明不了** —— 看的是 CSS 轨道的宽度，不是产物里的标记（那一条进
 * `docs/pending.md §5.101` 的人工清单）。
 *
 * ⚠️★ 但**有一半是断得了的**：`grid-template-columns` 里一旦出现 `auto` /
 *    `max-content` / `min-content`，轨道就是**逐行按内容算**的（十来行战绩**各自**
 *    是一个 grid）⇒ 对齐当场消失，而画面上只是"看起来有点乱"，没有任何门禁看得见。
 *    ⇒ 这一条是"对齐"这件事在**静态**这一层唯一能守的东西：**源码级守卫**，
 *    形状照本仓既有的 `formPreventsDefault`（只读那一条规则、配一条"改坏就红"的证明）。
 * ⚠️★ 判据只读**那一个选择器的规则体**（不是整份 CSS）：整份扫的话，
 *    别处（比如 `.ranked__live` 那种自由流）合法的 `auto` 会让这一条恒假 ——
 *    "看起来在断言 A、其实断言了 B"正是本仓最贵的那一类（§5.63）。
 */
/** 一份**剥掉注释**的样式表（注释里逐字写着选择器 ⇒ 不剥的话下面可能命中注释那一段）。 */
const CSS_NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
assert.notEqual(
  CSS_NO_COMMENTS,
  CSS,
  '★ 探针：注释真的被剥掉了（`styles.css` 里那段说明逐字写着 `.ranked__detailmatch`）',
);
/** 把一份 CSS 里某个选择器的**每一个**规则体取出来（含 `@media` 里那一支）。 */
const ruleBodiesOf = (css: string, selector: string): string[] => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bodies: string[] = [];
  for (const m of css.matchAll(new RegExp(`${escaped}(?![A-Za-z0-9_-])\\s*\\{`, 'g'))) {
    const open = m.index + m[0].length - 1;
    const close = css.indexOf('}', open);
    if (close > open) bodies.push(css.slice(open + 1, close));
  }
  return bodies;
};
/**
 * 这一段声明里有没有"按内容算宽"的轨道关键字。
 *
 * ⚠️★ `auto-fit` / `auto-fill` **不算**：它们是**重复次数**的关键字（
 *    `repeat(auto-fit, minmax(13rem, 1fr))` 正是本栏目要的那种写法），
 *    前后加"不是词字符也不是 `-`"的边界才分得开 —— `\bauto\b` 会把 `auto-fit` 一起咬住。
 */
const CONTENT_SIZED_TRACK = /(?<![\w-])(?:auto|max-content|min-content)(?![\w-])/;
const trackBodies = ruleBodiesOf(CSS_NO_COMMENTS, '.ranked__detailmatch');
assert.notEqual(
  trackBodies.length,
  0,
  '★ 探针：那个选择器**至少有一条规则**（否则下面那个循环一次都不跑：恒真的是空跑）',
);
assert.equal(
  trackBodies.some((body) => body.includes('grid-template-columns')),
  true,
  '★ 探针：其中至少有一条声明了 `grid-template-columns`（对齐靠的就是它）',
);
/*
 * ⚠️★ "改坏就红"的证明：同一个判据喂两份**造的**规则体 —— 一份带 `auto`（必须判假）、
 *    一份只有 `minmax()`（必须判真）。少了它，上面那个 `some()` 可能只是"字符串里
 *    恰好没有那个词"的巧合（本仓那条 `formPreventsDefault` 的探针同形）。
 */
assert.equal(
  CONTENT_SIZED_TRACK.test('grid-template-columns: minmax(5rem, 1.2fr) auto;'),
  true,
  '★ 能红证明：`auto` 那一支会被判成"按内容算宽"',
);
assert.equal(
  CONTENT_SIZED_TRACK.test('grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));'),
  false,
  '★★ 能红证明：`repeat(auto-fit, …)` **不**算（它是重复次数，不是轨道尺寸）—— 判据分得开这一对',
);
assert.equal(
  CONTENT_SIZED_TRACK.test('grid-template-columns: minmax(5rem, 1.2fr) max-content;'),
  true,
  '★ 能红证明：`max-content` 也被咬住（`min-content` 同理，同一个词表里的第三格）',
);
for (const [i, body] of trackBodies.entries()) {
  assert.equal(
    CONTENT_SIZED_TRACK.test(body),
    false,
    `★★★ ⑧b 第 ${String(i + 1)} 条 \`.ranked__detailmatch\` 的规则体里有"按内容算宽"的轨道（\`auto\` / \`max-content\` / \`min-content\`）—— 那是**逐行**算宽，而"对齐"正是这一轮要的东西：列会对不上，而屏幕上只是"有点乱"`,
  );
  assert.equal(
    body.includes('minmax('),
    true,
    `★★★ ⑧b 第 ${String(i + 1)} 条 \`.ranked__detailmatch\` 的轨道没用 \`minmax()\` 夹住上下界（下界保证列不塌、上界按比例分剩余宽度：这是"同一个容器宽度 ⇒ 同一组轨道"的全部机制）`,
  );
}
/*
 * ★★ 同一件事在卡片第一行那五格上（`.ranked__detailstats`）也要成立 ——
 *    它是这一轮**另一处**从自由流改成 grid 的地方，而它的写法里有一个**合法**的 `auto-fit`
 *    （上面那条探针钉的就是"判据分得开这一对"）。两处共用同一个判据，不抄第二份。
 */
const statBodies = ruleBodiesOf(CSS_NO_COMMENTS, '.ranked__detailstats');
assert.notEqual(statBodies.length, 0, '★ 探针：`.ranked__detailstats` 至少有一条规则');
for (const [i, body] of statBodies.entries()) {
  assert.equal(
    CONTENT_SIZED_TRACK.test(body),
    false,
    `★★★ ⑧b 第 ${String(i + 1)} 条 \`.ranked__detailstats\` 的规则体里也有"按内容算宽"的轨道（五格读数同样要对齐）`,
  );
}
ok(
  `⑧b 轨道守卫：\`.ranked__detailmatch\` ${String(trackBodies.length)} 条规则 + \`.ranked__detailstats\` ${String(statBodies.length)} 条规则里没有 \`auto\` / \`max-content\` / \`min-content\`（"列是否真的对齐"证不了 ⇒ \`pending.md §5.101\`）`,
);

/*
 * ★★ 收集 + 门禁本体写成**一个函数**，调用点在 ⑨ 之后（这一节末尾写着为什么）。
 *
 * ⚠️★ 为什么不能就地收集（2026-09-16 终审量到）：`products` 是**边渲染边长**的数组，
 *    而 ⑨ 里还会再渲染两份产物（未知标识那一份、原型链那一份）。
 *    就地收集 ⇒ "只有这两份里才出现"的类名**根本不进清单**，于是类名↔规则这道门禁
 *    对它们**是空的** —— 而这道门禁存在的理由正是"渲染了一个没有规则的类名不会有任何报错"。
 *    ⇒ 收集必须发生在**最后一次渲染之后**（`products` 那时才是完整的）。
 *    ⚠️ 实测（2026-09-16）：把 `products` 截到 ⑧ 那一刻是 **36** 个类名，完整收集**也是** 36 个
 *      —— 也就是说**今天**没有一个类名**只**出现在 ⑨ 那两份产物里，那个洞是**潜在**的
 *      （判据仍然是"收集必须发生在最后一次渲染之后"：它防的是"下一个只在 ⑨ 的夹具里
 *      出现的新类名"，而那正是这道门禁存在的理由）。
 * ⚠️ `ok()` 因此也落在 ⑨ 之后：组的**数量**一格没变（⑧ 还是那一组），只是打印顺序挪了。
 * ⚠️ 这张清单是**手抄的**（本仓惯例）：它防的是"整块界面被摘掉"——
 *    比如某个面板的 `<table>` 没了、或 "不可点"那一档的类名不再渲染。
 *    它**不**防"新加了一个类名"（那种情况只需要它在 `styles.css` 里有规则，
 *    由下面的循环兜着，不必回来改这一行）。
 */
const MUST_RENDER = [
  'ranked',
  'ranked__head',
  'ranked__title',
  'ranked__tabs',
  'ranked__tab',
  'ranked__panel',
  'ranked__badge',
  'ranked__badge--up',
  'ranked__badge--down',
  'ranked__badge--pending',
  'ranked__badge--maintenance',
  /* ★ 2026-09-19 加的：上游少了某一格时那一格戴的中性配色（不是第五种"状态"） */
  'ranked__badge--unknown',
  /* ★ 2026-09-19 加的：状态栏那四行（名字 / 状态 / 最后更新） */
  'ranked__components',
  'ranked__component',
  'ranked__compname',
  'ranked__meta',
  'ranked__updated',
  /* ★ 2026-09-19 第二轮加的：人数那一格（大标题底下的绿色大字）。⚠️ 它取代了
     `ranked__big` / `ranked__big--unknown` 那一对 —— 那两个类名连同 CSS 一起删掉了。 */
  'ranked__players',
  'ranked__players--unknown',
  'ranked__empty',
  'ranked__live',
  'ranked__match',
  'ranked__side',
  'ranked__side--right',
  'ranked__name',
  'ranked__elo',
  'ranked__rank',
  'ranked__progress',
  'ranked__mtime',
  'ranked__mid',
  'ranked__expand',
  'ranked__streams',
  'ranked__stream',
  'ranked__external',
  'ranked__table',
  'ranked__tablescroll',
  'ranked__seeds',
  'ranked__weeknav',
  'ranked__navbtn',
  'ranked__navbtn--off',
  /* ★ 2026-09-19 加的：周赛顶部那个手输框与它下面那一句提示 */
  'ranked__weekjump',
  'ranked__jumperror',
  /*
   * ★★ 2026-09-19 第三轮（`c70bb3f`）加的：③ 顶部的搜索框 + 行内展开的玩家卡片。
   *
   * ⚠️★ 这一份清单是"**产物里真的出现过**的类名"（本仓惯例，防的是"整块界面被摘掉"），
   *    所以它只收**今天真的有夹具渲染出来**的那些 —— 下面每一条都由 ④b 那一节产出。
   * ⚠️ `ranked__detailoutcome--unknown` **故意收在这里**：它有 CSS 规则、有词条
   *    （`ranked.outcomeUnknown`），而**解析层永远产不出**那一档（`parseMatches` 会把
   *    "玩家块读不出来"的行丢掉）⇒ 今天只有 ④b 那份手写的 `RankedMatch`（第 4 场：
   *    `selfUuid` 不在 `players[]` 里）到得了它。不收它的话，那条 CSS 规则与那条词条
   *    就是"两条没人验过的死代码"（`pending.md §5.70` 那一族正是这么长出来的）。
   * ⚠️ `.ranked__detailrow` 是**展开那一行**（`<tr>`），`.ranked__detail` 是**卡片本体**
   *    （`<div>`）：两个都在，因为"位置"那三条判据依赖它们同时存在。
   */
  'ranked__search',
  'ranked__searchinput',
  'ranked__searchhint',
  'ranked__lookup',
  'ranked__playerbtn',
  /*
   * ⚠️★ `ranked__lookupstats` **不在这里**（2026-09-19 第四轮**退役**）：命中那一档的
   *    三格读数行跟着"查到的玩家变成表里的一行"一起没了（读数搬进了卡片里的
   *    `ranked__detailstats`）。它进 `RETIRED_CLASSES`（见下面那一张表）——
   *    在"产物里应当出现"这张表里留一行，会让本脚本**永远红**；而删掉之后没人再管它，
   *    所以它换了一张表继续被管着。
   */
  'ranked__lookupmsg',
  'ranked__detailrow',
  'ranked__detail',
  'ranked__detailstats',
  'ranked__detailtitle',
  'ranked__detailmatch',
  'ranked__detailopp',
  'ranked__detailoutcome',
  'ranked__detailoutcome--win',
  'ranked__detailoutcome--loss',
  'ranked__detailoutcome--draw',
  /* ★ 见上面那段：第四档只有手写的夹具到得了，而它**必须**留着被渲染过一次 */
  'ranked__detailoutcome--unknown',
  'ranked__detailtype',
  'ranked__detailtime',
  'ranked__detailelo',
  'ranked__detailseed',
  'ranked__detailvod',
  'ranked__detailfailed',
  /*
   * ★★ 2026-09-19 **第四轮**（`b7d6487` 的视图 / `5f088f7` 之后的收尾）加的**六**个类名。
   *
   * ⚠️★ 四个是"搜索到的玩家 = 表里的一行"：`ranked__row` 是**两种行共用**的那一格
   *    （榜上的每一行与固定那一行），`ranked__row--lookup` 是固定那一行**唯一**的差别
   *    （一条 2px 的左侧强调线）；另两个是本轮新增的排版对象。
   * ⚠️★ 另外两个是"每一场比赛右侧那颗按钮 + 它下面那一格面板"。
   * ⚠️ 每一个都由 ④b 那一节产出：`ranked__row` / `ranked__row--lookup` 由 ④b③（那一行）
   *    与 ④b⑥（展开的位置）产出，`ranked__seedbtn` / `ranked__seedline` 由 ④b⑨ 产出，
   *    而 `ranked__seednote` / `ranked__seednote--failed` **只有** ④b⑨ 那两档
   *    （`not_found` / `failed`）到得了 —— 少了夹具它们就是"有规则、有词条、没人验过"
   *    的那一族（与 `ranked__detailoutcome--unknown` 同一条理由）。
   * ⚠️ 同一份清单里**不许**再出现 `ranked__lookupstats`（退役的那个，见下面那张表）。
   */
  'ranked__row',
  'ranked__row--lookup',
  'ranked__seedbtn',
  'ranked__seedline',
  'ranked__seednote',
  'ranked__seednote--failed',
] as const;
/*
 * ★★ **退役**的类名：它们**不许**再出现在任何产物里（2026-09-19 第四轮）。
 *
 * ⚠️★ 为什么不只是"从 `MUST_RENDER` 里删掉"：那张表管的是"应当出现"，
 *    删掉之后**没有任何东西**管这个类名了 —— 谁把那一行读数加回来（标记 + CSS 规则一起），
 *    两边都会静默通过（`hasCssRule` 看见规则、标记也渲染得出来）。
 * ⚠️★ 与 `hasCssRule` 那一条**不是**重复的：那条断言的是"渲染出来的类名有规则"，
 *    所以"类名回来了、规则没回来"会被它抓到 —— 而"类名与规则**一起**回来"只有这里抓得到。
 * ⚠️ 判据是**逐份产物**扫（`products` 在最后一次渲染之后才是完整的，见上面那段）。
 */
const RETIRED_CLASSES = [
  /* 命中那一档的三格读数行 —— 读数搬进了卡片里的 `ranked__detailstats`（④b⑧ 钉着那个方向） */
  'ranked__lookupstats',
] as const;
/*
 * ★★ ⑧ 的本体：调用点在 ⑨ 结束处（`assertRankedClassesHaveRules()`）——
 *    收集必须发生在**最后一次渲染之后**，理由写在上面那段。
 */
const assertRankedClassesHaveRules = (): void => {
  const allClasses = products.flatMap((html) =>
    [...html.matchAll(/\bclass="([^"]*)"/g)].flatMap((m) => (m[1] ?? '').split(/\s+/)),
  );
  const rankedClasses = [...new Set(allClasses.filter((cls) => cls.startsWith('ranked')))].sort();
  assert.ok(
    rankedClasses.length > 0,
    '★★ 探针：产物里确实收集到了 `ranked*` 类名（否则下面那个循环一次都不跑）',
  );
  for (const cls of MUST_RENDER) {
    assert.ok(
      rankedClasses.includes(cls),
      `★★ 产物里应当出现 \`.${cls}\`（这一格的界面被摘掉了？）`,
    );
  }
  for (const cls of rankedClasses) {
    assert.ok(
      hasCssRule(CSS, cls),
      `★★★ \`.${cls}\` 在 \`apps/web/src/styles.css\` 里没有规则 —— 这是一个**渲染得出来、但什么都不生效**的类名（§5.70）`,
    );
  }
  for (const cls of RETIRED_CLASSES) {
    assert.equal(
      rankedClasses.includes(cls),
      false,
      `★★★ \`.${cls}\` 已经**退役**，而它又出现在了产物里（标记与 CSS 规则要同生同死：留一条没人渲染的规则会让下一个读代码的人以为那一块界面还在，反之亦然）`,
    );
  }
  ok(
    `⑧ 类名↔CSS：${String(rankedClasses.length)} 个 \`ranked*\` 类名逐个在 styles.css 里有规则（收集自 ${String(products.length)} 份产物）+ ${String(RETIRED_CLASSES.length)} 个退役类名一个都没回来`,
  );
};

// ---------------------------------------------------------------------------
console.log('⑨ ★ 进度词条表：逐条两种语言 + 未知标识回落');
// ---------------------------------------------------------------------------
/*
 * ★★ 用户 2026-09-16 的裁决：界面**原样显示**上游的英文标识，同时在两份字典里
 *    为每个已知标识配好词条（中文值 = 标识本身，用户稍后自行校准）。
 *    这条设计的核心是**回落**：上游随时可能加一个新节点，界面必须照样有话说。
 * ⚠️★ 表里少一条的表现是"界面上印出裸 key"，而 `i18n-keys.test.ts` **看不见**这张表
 *    （它扫的是字面量 `t('…')`）⇒ 只有这里能发现。
 * ⚠️ 那个 9 是**手抄的**（本仓惯例）：它防的是"为了让红的变绿，把某一行从表里删掉"。
 */
assert.equal(
  Object.keys(TIMELINE_LABEL_KEYS).length,
  9,
  `探针：冻结的进度词条清单就是 9 条（现读 ${String(Object.keys(TIMELINE_LABEL_KEYS).length)} 条）`,
);
assert.equal(
  new Set(Object.values(TIMELINE_LABEL_KEYS)).size,
  Object.keys(TIMELINE_LABEL_KEYS).length,
  '★ 探针：没有一个 key 被两条标识共用（共用的话改一条会顺手改掉另一条）',
);
for (const [type, key] of Object.entries(TIMELINE_LABEL_KEYS)) {
  for (const lng of LANGUAGES) {
    assert.ok(
      i18n.exists(key, { lng }),
      `★★ 词条 ${key} 在【${lng}】里不存在（\`${type}\` 会印出裸 key）`,
    );
    const value = i18n.t(key, { lng }) as string;
    assert.notEqual(value, key, `★★ 词条 ${key} 在【${lng}】里没有真值（i18next 会原样返回 key）`);
    assert.notEqual(
      flat(value),
      '',
      `★★ 词条 ${key} 在【${lng}】里是空的（空格子看起来像渲染坏了）`,
    );
  }
}
/* 未知标识 ⇒ **原样**（绝不 `t(type)`：那正是裸 key 泄漏的形状）。 */
const unknownHtml = renderLive({ live: LIVE_UNKNOWN }, '对局·未知进度标识');
const unknownSides = elementsWithClass(unknownHtml, 'ranked__side');
assert.equal(
  textOf(elementsWithClass(unknownSides[0] ?? '', 'ranked__progress')[0] ?? ''),
  flat(UNKNOWN_TYPE),
  '★★ 不在表里的标识 ⇒ 产物里出现的是**那个标识本身**（回落那一支）',
);
assert.equal(
  Object.hasOwn(TIMELINE_LABEL_KEYS, UNKNOWN_TYPE),
  false,
  '★ 探针：那个标识确实不在表里（否则上面那条测的是"查表"而不是"回落"）',
);
assert.equal(
  timelineLabel(UNKNOWN_TYPE, t),
  UNKNOWN_TYPE,
  '★ 纯函数那一半：`timelineLabel` 对未知标识原样返回',
);
assert.equal(
  timelineLabel(null, t),
  fresh('ranked.unknown'),
  '★ `null` ⇒ 占位符（空串在卡片上会留下一个看不见的格子）',
);
assert.equal(timelineLabel('', t), fresh('ranked.unknown'), '★ 空串也走占位符');
assert.equal(
  textOf(elementsWithClass(unknownSides[1] ?? '', 'ranked__progress')[0] ?? ''),
  fresh(TIMELINE_LABEL_KEYS['end.kill_dragon'] ?? ''),
  '★★ 正向对照：在表里的标识走**词条**（两边都是"显示一串英文"，只有这条路能分开它们）',
);
assert.equal(
  /ranked\.[A-Za-z]/.test(rawText(unknownHtml)),
  false,
  '★★ 未知标识**不许**印成裸 key（回落写成 `t(type)` 就是这个形状）',
);
/*
 * ★★ 原型链那一条（`timeline.ts` 里写着为什么用 `Object.hasOwn`）：
 *    `'constructor' in TIMELINE_LABEL_KEYS` 是 **true** —— 用 `in` 查表会拿到
 *    `Object.prototype.constructor`（一个函数），最后把
 *    `function Object() { [native code] }` 印到界面上。上游只要发一个叫 `constructor`
 *    的节点就会命中，而这一层存在的理由正是"上游随时会加新值"。
 * ⚠️★ 但**别高估它**（2026-09-16 终审实测修正了这里原来的一句话）：
 *    它**不能**把"查表回落"与"无条件 `t(type)`"分开 —— 对未知标识来说两者印出来的字
 *    **一模一样**（i18next 查不到 key 时原样返回 key，而那个 key 恰好就是标识本身），
 *    `constructor` / `toString` / `future.brand_new_node` 三个名字在这一点上完全一样。
 *    它**能**分开的是**另一对**：`Object.hasOwn` 与 `in` / `!== undefined` 那种沿原型链的查法
 *    （后者会拿到 `Object.prototype.constructor` 那个函数 ⇒ 产物里出现 `[native code]`）——
 *    也就是 `timeline.ts` 里"为什么不用 `in`"那句话的判据。
 * ⚠️ 那"`t(type)` 与查表分不开"这件事本身**有**一条门禁，只是不在这个脚本里：
 *    `services/api/src/ranked-shared.test.ts` 的桩 `t = (key) => \`[${key}]\``
 *    会把未知标识印成 `[future.brand_new_node]` ⇒ 那条路当场红
 *    （`docs/progress.md` 的 mutation 那一节记着这次实测）。
 * ⚠️ 上面那条"产物里出现的是那个标识"仍然要有（它守的是"别去拼 `ranked.timeline.xxx` 这种 key"），
 *    但它**不是**"回落真的走了查表"的证据。
 */
const PROTOTYPE_TYPE = 'constructor';
const prototypeHtml = renderLive(
  {
    live: {
      players: 0,
      matches: [
        matchOf(
          'p|q',
          1000,
          player({
            nickname: 'Proto',
            eloRate: 1000,
            eloRank: 1,
            timelineType: PROTOTYPE_TYPE,
            timelineTime: 1,
          }),
          player({
            nickname: 'Plain',
            eloRate: 990,
            eloRank: 2,
            timelineType: 'story.root',
            timelineTime: 2,
          }),
        ),
      ],
    },
  },
  '对局·原型链上的名字',
);
assert.equal(
  timelineLabel(PROTOTYPE_TYPE, t),
  PROTOTYPE_TYPE,
  '★★ `constructor` 这类名字必须**原样**返回（用 `in` 查表会拿到 `Object.prototype.constructor`）',
);
assert.equal(
  textOf(
    elementsWithClass(
      elementsWithClass(prototypeHtml, 'ranked__side')[0] ?? '',
      'ranked__progress',
    )[0] ?? '',
  ),
  flat(PROTOTYPE_TYPE),
  '★★ 产物里也是那个标识本身（不是一份函数源码、也不是空串）',
);
assert.equal(
  /native code/.test(rawText(prototypeHtml)),
  false,
  '★★ 产物里不许出现「[native code]」（那是把 `Object.prototype.constructor` 印出来了）',
);
ok(
  `进度词条表：${String(Object.keys(TIMELINE_LABEL_KEYS).length)} 条 × 两种语言 + 未知回落 + 原型链（\`constructor\`）+ 表内那条走词条`,
);
/*
 * ★★ ⑧ 的本体在这里跑（不是它那一段之后）：类名清单必须收集**最后一次渲染之后**的产物，
 *    而上面的 `unknownHtml` / `prototypeHtml` 是最后两份 —— 就地在 ⑧ 那一段收集的话，
 *    "只有这两份里才出现"的类名会**漏出**那道门禁（终审量到的那个洞）。
 *    ⚠️ 组的数量没变：⑧ 还是那**一组**，只是它的 `ok()` 落在这里。
 */
assertRankedClassesHaveRules();

// ---------------------------------------------------------------------------
console.log('⑩ 裸 key 泄漏 + 字面的 `**`（含反面控制探针）');
// ---------------------------------------------------------------------------
const everyProduct = products.join('');
const allRaw = rawText(everyProduct);

/*
 * ⚠️ 裸 key 扫描（含**属性**里的值）：`aria-label` / `data-*` 里漏了词条、别处印出 key ——
 *    这些都只有扫原文才看得见（`textOf` 会把属性整段吃掉）。
 * ⚠️ 扫描器本身必须能命中（否则它是恒真的空跑）。
 * ⚠️★ 命名空间清单是**手抄的**，而且它必须覆盖**本栏目产物里真会出现的每一族 key**：
 *    漏一族 ⇒ 那一族的裸 key 从这道扫描里**漏出去**（2026-09-16 终审量到：`videos` 不在里面，
 *    而本脚本的嵌入门面渲染的正是 `videos.play`）。加一族就在这里加一个。
 * ⚠️ 这里**不放行任何东西**：本栏目产物里合法出现的只有类名（`ranked__row` 不含 `.`）、
 *    路径（`/ranked/weekly/102` 不含 `.`）与上游给的直播地址。
 */
const BARE_KEY = /(?:ranked|nav|common|home|auth|shares|videos)\.[A-Za-z][A-Za-z0-9.]*/g;
assert.notEqual(
  [...'ranked.doesNotExist nav.nope'.matchAll(BARE_KEY)].length,
  0,
  '★ 探针：裸 key 扫描器本身必须能命中',
);
const leakedKeys = [...new Set([...allRaw.matchAll(BARE_KEY)].map((m) => m[0]))];
assert.deepEqual(leakedKeys, [], `★★ 产物里有裸 key：${leakedKeys.join(', ')}`);

/*
 * ⚠️⚠️ 字面的 `**`：本仓词条里用 `**这样**` 表示强调（`components/Emphasis.tsx`），
 *    只有经过 `em()` / `emText()` 才会消失。落到没处理的地方，用户直接看到一对星号 ——
 *    而词条存在、两种语言对齐、字体覆盖都过，**没有任何别的检查会发现**。
 * ⚠️ 扫描必须作用在**原文**上（`allRaw`），不能用被 `flat()` 处理过的那一份：
 *    `roleguide.tsx` 那条恒真的守卫就是因为它的 `norm()` 顺手把 `*` 擦掉了（§5.63）。
 * ⚠️ 本栏目的词条今天一个 `**` 都没有 ⇒ 产物里出现星号**一定是**缺陷（没有"合法的强调"这一档）。
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
  console.log('⑪ 英文界面里零汉字（spec §9 的那条扫描）');
  /*
   * ⚠️ 扫的是**原文**（含属性）：`aria-label` / `title` / `data-*` 里的中文
   *    同样是"英文界面上冒出了中文"。`textOf` 把属性吃掉了，所以不能用它。
   * ⚠️ `fallbackLng: false` 时缺英文词条会**原样返回 key**（由 ⑩ 抓），
   *    这一条抓的是另一类：有人把中文**写死在组件/夹具里**。
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

console.log('');
console.log(`通过 ${pass} 项。`);
console.log('');
console.log('═══════════════════════════════════════════════════════════════════════');
console.log('覆盖边界（写清楚，免得下一个人高估它）');
console.log('═══════════════════════════════════════════════════════════════════════');
console.log('⚠️ 这是一个**静态渲染**：`renderToStaticMarkup` 不跑 effect、不点击、不发请求。');
console.log('   所以下面这几件事它**证明不了**：');
console.log('   · 容器（`routes/Ranked.tsx`）本身：它读 `window.location`（Twitch 的 `parent`）');
console.log(
  '     ⇒ 在 Node 里**渲染不了**。本脚本渲染的是那四支纯视图 + 标签页，`origin` 是喂进去的。',
);
console.log('   · **轮询**（15s / 10s / 60s / 60s）、**页面不可见时停**、**历史周不轮询**：');
console.log(
  '     它们全是 effect，纯 SSR 下一次都不跑（`RANKED_POLL_MS` 的值由类型与 spec 钉着）。',
);
console.log(
  '   · **失败绝不清空**的另一半：容器**换 tab / 翻页**时**也不清**（2026-09-16 终审删掉了',
);
console.log(
  '     那个"换页就清空"的 effect）—— 那件事由 `key` / `mine()` 挡着，本脚本一次都不跑；',
);
console.log('     本脚本钉的是"视图拿到旧数据 + 一句错误时**照样把旧数据画出来**"。');
console.log('   · **点击的结果**：SSR 的产物里没有事件处理器，一颗接好线的按钮与一颗 `onClick` 是');
console.log(
  '     `undefined` 的按钮**长得一模一样** —— 本脚本用的是运行时守卫（`assertPropsGiven`、',
);
console.log('     `assertClickable`），而"prop 忘了传"在**页面**那一侧是编译错误。');
console.log(
  '   ·★ **② 那三件事的交互本身**（2026-09-19 加的）：在搜索框里**打字**、点那颗「只看双方都在直播」、',
);
console.log(
  '     点「加载更多」—— 三格状态住在容器里（`routes/Ranked.tsx` 的三个 `useState`），而容器在 Node 里',
);
console.log('     渲染不了。⇒ ③b 钉的是"**视图拿着这三格状态会渲染成什么样**"（判据 + 产物），');
console.log(
  '     "打字/点击真的换了状态"那一半要人在浏览器里点一次：三种状态各点一遍，看卡片数、那句"还有 N 场"',
);
console.log('     与开关的高亮是不是跟着走。');
console.log(
  '   · 点开 `<details>` 之后才挂的 iframe（`ClickToPlayEmbed` 的 `useState`）、真的播放；',
);
console.log('   · **尺寸、配色与字体**：这里只看类名在不在 `styles.css` 里（⑧），不看它长什么样。');
console.log(
  '   ·★ **④ 那个手输框的键盘路径本身**（2026-09-19 加的）：在框里按 **回车**会提交表单，',
);
console.log('     那是浏览器原生行为，SSR 里一次都不发生。本脚本钉的是那个结构前提（输入框与');
console.log(
  '     `type="submit"` 的那颗按钮**在同一个 `<form>` 里**）+ **源码级**的那一半（表单上挂着',
);
console.log(
  '     `onSubmit`，且 handler 里 `preventDefault()` —— 见 ④b① 那条 `formPreventsDefault`），',
);
console.log('     以及"两种不合法的输入各说哪一句话"（⑤b）。真的按一次回车要人在浏览器里做。');
console.log(
  '   ·★★ **③ 那一轮（2026-09-19 第三轮）的全部交互本身**：打字真的筛了、点昵称真的展开了、',
);
console.log(
  '     回车真的查了、展开真的**只发两次请求**（`/users/{id}` + `/users/{id}/matches`）、',
);
console.log(
  '     第二次点同一个人**一发都不发**（缓存命中）、失败不进缓存 ⇒ 收起再点一次是重试 ——',
);
console.log('     这几件事全是**事件接线与请求计数**，`renderToStaticMarkup` 一件都跑不到；');
console.log(
  '     本脚本钉的是"**视图拿着那三格状态渲染成什么样**"（④b①–⑦），以及那六格 `on*` 是不是',
);
console.log(
  '     函数（`assertPropsGiven`）。逐条代价与"要人做什么"写在 `docs/pending.md §5.100`。',
);
console.log(
  '   ·★★ **第四轮那三件事的交互本身**（2026-09-19）：点那一行真的展开了、点「查种子」真的发起了',
);
console.log(
  '     那次**同源**请求（`GET /api/ranked-seeds/match/:matchId`）、同一场第二次点**一发都不发**',
);
console.log(
  '     （缓存命中）、`failed` 不进缓存 ⇒ 再点一次是重试、切页时那一格被 `abortSeed()` 收掉 ——',
);
console.log(
  '     这几件事全在容器里（`routes/Ranked.tsx` 的第四格状态），`renderToStaticMarkup` 一件都跑不到。',
);
console.log(
  '     本脚本钉的是"视图拿着那一格 `seeds` 渲染成什么样"（④b⑨ 四档 + 按钮的位置与 `aria-expanded`）',
);
console.log(
  '     与那两格 `on*` 是不是函数。逐条代价与"要人做什么"写在 `docs/pending.md §5.101`。',
);
console.log(
  '   ·★★ **"列真的对齐了没有"**（第四轮，用户原话「版面尽量对齐」）：这是**CSS 轨道宽度**的事，',
);
console.log('     本脚本证不了。它证得了的只有两半：每个类名在 `styles.css` 里有规则（⑧），');
console.log(
  '     以及 `.ranked__detailmatch` / `.ranked__detailstats` 的轨道里**没有** `auto` / `max-content`',
);
console.log(
  '     这类"逐行按内容算宽"的写法（⑧b 那条源码级守卫）。窄屏会不会溢出、同一个标签在两张',
);
console.log('     卡片里是不是落在同一条竖线上，只能肉眼看（`pending.md §5.101`）。');
console.log(
  '   ·★ **`--lookup` 那条强调线在两种主题 / 两种语言下的可辨识度**（第四轮）：颜色对比度与',
);
console.log('     那 2px 的宽度是**眼睛**的事，产物里只有那个类名（`pending.md §5.101`）。');
console.log('   ·★ **那两个新端点的生产环境 CORS / 缓存行为**：本机实测过（findings §4 / §6），');
console.log('     线上出口没测过 —— 与 T1 报告里同一条遗留（`pending.md §5.100` 也记着）。');
console.log(
  '   ·★ **③ 那第二次请求**（赛段 `/phase-leaderboard`）**本身**：它是容器的一个 `pull`，',
);
console.log(
  '     本脚本钉的是"视图拿到 `phase: null` 时说什么、以及排行榜一行都不少"（④ 那一节）。',
);
console.log(
  '   · 上游那一侧：解析、排序、筛选与分段的逐值断言在 `services/api/src/ranked-shared.test.ts`，',
);
console.log('     心跳端点在 `services/api/src/ranked.test.ts`。');
/*
 * ⚠️ 组数是**手抄的**（本仓惯例）：它防的是"把某一段摘掉" —— 删掉一整组断言之后
 *    脚本照样绿、照样打印"通过 N 项"，只有这个数字会变。改脚本就要一起改这里。
 * ⚠️ en 比 zh 多一组，是因为 ⑪ 那个"英文产物里不许有汉字"的扫描只在 en 那一遍跑
 *    （`if (LANG === 'en')`，见上面）；两个数差 1 是**正常的**，别把它抹平。
 * ⚠️ 2026-09-19：两边各 +1（③b 那一组：搜索 / 双方都在直播 / 加载更多）。
 * ⚠️ 2026-09-19（本轮）：两边再各 +1（⑤b 那一组：④ 的顶部导航 / 手输框 / 本周 / 两种提示）。
 * ⚠️ 2026-09-19（第三轮，`c70bb3f` 的视图）：两边再各 **+7** —— ④b 那七组
 *    （① 搜索框 / ② 本地筛选 / ③ 三档查询 / ④ 四个画面 / ⑤ 那条红线 / ⑥ 三条位置 /
 *    ⑦ 两族表驱动的词条）。⇒ 16+7=**zh 23**、17+7=**en 24**
 *    （⚠️ 下一行那个三元的两个数就是这两个，改脚本时一起改）。
 * ⚠️ 2026-09-19（**第四轮**，`b7d6487` 的视图）：两边再各 **+3**（zh 26 / en 27）：
 *    · ④b⑧ —— 退役的读数行（`.ranked__lookupstats`）与"词条没变成孤儿"那两半；
 *    · ④b⑨ —— 每场一颗种子按钮 + 四档面板（含 `theEndSeed: null ⇒ —`）；
 *    · ⑧b —— 轨道守卫（`.ranked__detailmatch` 不许用 `auto` / `max-content`）。
 *    ⚠️ ④b③ 与 ④b⑥ 是**改写**不是新增（它们的 `ok()` 各自只有一处，数量没动），
 *      ⑦ 那一组一个字没动。
 */
const expectedGroups = LANG === 'en' ? 27 : 26;
assert.equal(
  pass,
  expectedGroups,
  `探针：这一轮应当通过 ${String(expectedGroups)} 组（少了就说明有人把某一段摘掉了）`,
);
