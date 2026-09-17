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
  type RankedPhaseData,
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
  type RankedChromeProps,
  RankedEloView,
  type RankedEloViewProps,
  RankedLiveView,
  type RankedLiveViewProps,
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
 * ⚠️ 四格的时间刻意**互不相同**（实测上游四个监视器的节拍就不在同一个网格上）
 *    ⇒ "每一格印的是**自己**那个时间"是可断言的（一个把第一个时间印四遍的实现会红）。
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
  /* ⚠️★ `phase` 是 2026-09-19 加的（"并排显示赛段"）：少传它的表现是**静默**的
     —— 排行榜照常渲染、只是顶上少一格，而"少了的那一格"与"上游没给"长得一样。 */
  elo: ['elo', 'phase'],
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
  const props: RankedEloViewProps = { ...chrome(), elo: ELO_DATA, phase: ELO_PHASE, ...o };
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
 * ⚠️ 时间那一格比的是**自己那个**时间（四格各不相同，见夹具的注释）。
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
 *    标题 → 四行（名字/状态/最后更新）×4 → 大号数字 → 人数那一句
 * 多任何一件（延迟、可用率、心跳历史、解释性文字）都会让这一条红，
 * 而"少一件"由上面那些逐格断言兜着 ⇒ 两个方向都钉住了。
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
    flat(String(PLAYERS)),
    fresh('ranked.players', { n: PLAYERS }),
    // ⚠️ 最后这一格是**外壳**那一行新鲜度（四个面板都有），不是状态栏自己的内容
    fresh('ranked.updatedAgo', { secs: UPDATED }),
  ].join(''),
  '★★★ 状态栏这一屏**只有**四行 + 在线人数 + 外壳那一行新鲜度（延迟 / 可用率 / 心跳历史 / 解释性文字都被删掉了）',
);
assert.equal(
  textOf(elementsWithClass(stNormal, 'ranked__big')[0] ?? ''),
  flat(String(PLAYERS)),
  '★ 实时人数是那颗大号数字本身',
);
assert.equal(
  hasClassOf(elementsWithClass(stNormal, 'ranked__big')[0] ?? '', 'ranked__big--unknown'),
  false,
  '★ 读到人数时**不**挂占位符那个配色类（正面对照是下面 `players: null` 那一份）',
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
  textOf(elementsWithClass(stZero, 'ranked__big')[0] ?? ''),
  flat('0'),
  '★ `players: 0` ⇒ 大号数字就是 0（那是一个真的读数）',
);
assert.equal(
  metaOf(stZero).at(-1),
  fresh('ranked.playersZero'),
  '★★ `players: 0` ⇒ 「现在没有人在玩 Ranked」（真话）',
);
assert.equal(
  metaOf(stZero).includes(fresh('ranked.playersUnknown')),
  false,
  '★★ 0 那一份**不许**说「读不到」',
);
assert.equal(
  textOf(elementsWithClass(stPlayersNull, 'ranked__big')[0] ?? ''),
  fresh('ranked.unknown'),
  '★★ `players: null` ⇒ 大号数字是占位符 `—`（不是 0 —— 0 是一句谎话）',
);
assert.equal(
  metaOf(stPlayersNull).at(-1),
  fresh('ranked.playersUnknown'),
  '★★ `players: null` ⇒ 「人数暂时读不到」（另一件事）',
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
  hasClassOf(elementsWithClass(stPlayersNull, 'ranked__big')[0] ?? '', 'ranked__big--unknown'),
  '★ 占位符那一格戴上它自己的配色类名（正面对照：读到人数时不戴）',
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
console.log('④ Elo 排行榜：五列 + 并列排名原样 + 赛季起止 + highest 缺失 + 空态');
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
const eloRows = [...eloTable.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
  .slice(1) // 第一行是表头
  .map((m) => [...(m[1] ?? '').matchAll(/<td>([\s\S]*?)<\/td>/g)].map((c) => flat(c[1] ?? '')));
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
assert.ok(
  seasonLine.includes(
    fresh('ranked.seasonRange', {
      from: localDate(ELO_SEASON.startsAt),
      to: localDate(ELO_SEASON.endsAt),
    }),
  ),
  '★★ 顶部有**起止两个日期**（秒 → 毫秒那一步真的做了：忘了乘 1000 会印成 1970 年）',
);
assert.equal(/1970/.test(rawText(elo)), false, '★★ 产物里不许出现 1970（秒当毫秒用就是这个症状）');
assert.equal(
  seasonLine.includes(localDate(ELO_SEASON.startsAt + 86_400)),
  false,
  '★ 起止不是同一个数（把 endsAt 也印成 startsAt 之类的写法会在这里红）',
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
assert.equal(
  elementsWithClass(eloMany, 'ranked__table')[0]?.match(/<td>/g)?.length,
  RANKED_ELO_TOP * 5,
  `★★ 160 条只渲染前 ${String(RANKED_ELO_TOP)} 行（${String(RANKED_ELO_TOP * 5)} 个格子）`,
);
assert.equal(
  elementsWithClass(eloMany, 'ranked__table')[0]?.match(/<td>/g)?.length,
  RANKED_ELO_TOP * 5,
  `★★ 160 条只渲染前 ${String(RANKED_ELO_TOP)} 行（${String(RANKED_ELO_TOP * 5)} 个格子）`,
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
ok('排行榜：五列逐行 + 并列 3,3,5 + 赛季起止 + highest 缺失 + 前 100 + 空态');

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
      metaOf(html).includes(fresh('ranked.playersZero')),
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
   * 三个 fetcher 各打一次。⚠️ 用 `allSettled`：这一节断言的是**请求怎么发出去的**，
   * 而 stub 回的是一个空壳响应 ⇒ 解析层会（正确地）说"形状对不上"。
   * 让那件事把整节打断的话，断言就永远走不到了。
   */
  await Promise.allSettled([fetchRankedLive(), fetchRankedElo(), fetchRankedWeekly(null)]);
  assert.equal(calls.length, 3, `★★ 三个 fetcher 各打一次（实测 ${String(calls.length)} 次）`);
  assert.deepEqual(
    calls.map((c) => new URL(c.url).pathname),
    ['/live', '/leaderboard', '/weekly-race'],
    '★ 三条路径（上游域名只在 `const.ts` 里写一次，所以这里比的是路径）',
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
     *    —— 2026-09-16 终审删掉了：三个 fetcher 都是**不带参数**调用的，
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
  'ranked__big',
  'ranked__big--unknown',
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
  ok(
    `⑧ 类名↔CSS：${String(rankedClasses.length)} 个 \`ranked*\` 类名逐个在 styles.css 里有规则（收集自 ${String(products.length)} 份产物）`,
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
console.log('     `type="submit"` 的那颗按钮**在同一个 `<form>` 里**、表单有 `onSubmit`），');
console.log('     以及"两种不合法的输入各说哪一句话"（⑤b）。真的按一次回车要人在浏览器里做。');
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
 */
const expectedGroups = LANG === 'en' ? 17 : 16;
assert.equal(
  pass,
  expectedGroups,
  `探针：这一轮应当通过 ${String(expectedGroups)} 组（少了就说明有人把某一段摘掉了）`,
);
