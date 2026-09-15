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
  RANKED_LIVE_TOP,
  RANKED_TABS,
  RANKED_UPSTREAM_ALT,
  RANKED_UPSTREAM_PRIMARY,
  type RankedEloData,
  type RankedLiveData,
  type RankedLiveMatch,
  type RankedLivePlayer,
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
const UPSTREAM_TIME = '2026-09-15 13:36:27'; // 上游那串**没有时区**的文本，原样印
const OTHER_UPSTREAM_TIME = '2026-09-16 08:00:01';
const PING = 380;
const PLAYERS = 1234;
const UPTIME = 0.9812; // ⇒ 界面印 98（`Math.round(0.9812 * 100)`）
const UPTIME_PCT = 98;
const ORIGIN = 'mcsrhelper.com'; // 容器给的是 `window.location.hostname`；这里是它的替身

const TWITCH = 'https://twitch.tv/hufterl';
const KICK = 'https://kick.com/whyip';
const UNKNOWN_TYPE = 'future.brand_new_node'; // ★ 不在 `TIMELINE_LABEL_KEYS` 里

/** ① 的心跳响应。`state` / `ping` / `uptime24` / `stale` 都可以逐格换掉。 */
function status(
  o: Partial<RankedStatusResponse['monitor']> & { stale?: boolean } = {},
): RankedStatusResponse {
  const { stale = false, ...monitor } = o;
  return {
    monitor: { state: 1, checkedAt: UPSTREAM_TIME, ping: PING, uptime24: UPTIME, ...monitor },
    serverNow: 1_789_430_400_000,
    fetchedAt: 1_789_430_400_000,
    stale,
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

/** 12 场 ⇒ 视图只渲染前 10（`RANKED_LIVE_TOP`），而那句 total 说的是 12。 */
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
const ELO_DATA: RankedEloData = { season: ELO_SEASON, users: ELO_USERS };
const ELO_EMPTY: RankedEloData = { season: ELO_SEASON, users: [] };
/** 105 条 ⇒ 视图只渲染前 100（`RANKED_ELO_TOP`；上游实测给 150）。 */
const ELO_MANY: RankedEloData = {
  season: ELO_SEASON,
  users: Array.from({ length: 105 }, (_, i) => ({
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
  live: ['live', 'origin'],
  elo: ['elo'],
  weekly: ['weekly', 'latestId'],
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
  }
  assert.equal(
    typeof props.onRetry,
    'function',
    `★★ ${where}：\`onRetry\` 必须是函数（传了 undefined 就是一颗按不动的「重试」）`,
  );
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
  const props: RankedLiveViewProps = { ...chrome(), live: LIVE_DATA, origin: ORIGIN, ...o };
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
  const props: RankedEloViewProps = { ...chrome(), elo: ELO_DATA, ...o };
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
console.log('② 状况与人数：词条表逐格 + 四态 + ping / uptime / players / checkedAt');
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

for (const state of [0, 1, 2, 3] as const) {
  const html = renderStatus({ status: status({ state }) }, `状况·state=${state}`);
  const badge = elementsWithClass(html, 'ranked__badge');
  assert.equal(badge.length, 1, `★ state=${state}：恰好一颗徽章`);
  assert.equal(
    textOf(badge[0] ?? ''),
    fresh(STATUS_KEYS[state]),
    `★★ state=${state} ⇒ 徽章说的是它**自己那一句**（不是别的三种之一）`,
  );
  assert.ok(
    classOf(badge[0] ?? '')
      .split(/\s+/)
      .includes(`ranked__badge--${BADGE_SUFFIX[state]}`),
    `★ state=${state} ⇒ 徽章带上它自己的配色类名 \`.ranked__badge--${BADGE_SUFFIX[state]}\``,
  );
  for (const [other, sentence] of STATE_SENTENCES.entries()) {
    if (other === state) continue;
    assert.notEqual(
      textOf(badge[0] ?? ''),
      sentence,
      `★★ state=${state} 的徽章**不许**说成 state=${String(other)} 那一句`,
    );
  }
}

/** 正常那一份：四行度量（延迟 / 最后心跳 / 可用率 / 人数）**逐行**钉死。 */
const stNormal = renderStatus({}, '状况·正常');
assert.deepEqual(
  metaOf(stNormal),
  [
    fresh('ranked.statusPing', { ms: PING }),
    fresh('ranked.statusCheckedAt', { time: UPSTREAM_TIME }),
    fresh('ranked.statusUptime', { pct: UPTIME_PCT }),
    fresh('ranked.players', { n: PLAYERS }),
  ],
  '★★ 四行度量按固定顺序（延迟 → 最后心跳 → 可用率 → 人数句），而且**每行说它自己的数**',
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
 * ⚠️ 可用率是 0–1 的小数，界面上印的是**百分比**：只断言"那一行在"的话，
 *    把 0.9812 原样印出来也照样绿。98 这个数字是 `Math.round(0.9812 * 100)`，
 *    写在期望里（不是从 `UPTIME` 现算的 —— 现算的话"忘了乘 100"会被两边一起漏掉）。
 */
assert.notEqual(
  fresh('ranked.statusUptime', { pct: UPTIME_PCT }),
  fresh('ranked.statusUptime', { pct: UPTIME }),
  '★ 探针：百分比与那个小数不是同一句话（否则上面那行断言测不出"忘了乘 100"）',
);
/* `checkedAt` **原样**印：上游那串没有时区的文本一个字都不许换算。 */
assert.ok(
  rawText(stNormal).includes(UPSTREAM_TIME),
  '★ 上游那串心跳时间**原样**出现在产物里（不做时区换算、不重新格式化）',
);
assert.ok(
  rawText(renderStatus({ status: status({ checkedAt: OTHER_UPSTREAM_TIME }) })).includes(
    OTHER_UPSTREAM_TIME,
  ),
  '★ 换一个上游文本 ⇒ 产物里就是**那一个**（不是把某个常量印出来）',
);

/** `ping: null` ⇒ 「延迟未知」（**不是** 0：0 ms 是一个真的测量值）。 */
const stPingNull = renderStatus({ status: status({ ping: null }) }, '状况·延迟未知');
assert.equal(
  metaOf(stPingNull)[0],
  fresh('ranked.statusPingUnknown'),
  '★★ `ping: null` ⇒ 那一行说「延迟未知」（不是「延迟 0 ms」）',
);
assert.notEqual(
  fresh('ranked.statusPingUnknown'),
  fresh('ranked.statusPing', { ms: 0 }),
  '★ 探针：「延迟未知」与「延迟 0 ms」是两句不同的话',
);

/** `uptime24: null` ⇒ **整行不渲染**（不是渲染 0%）。 */
const stUptimeNull = renderStatus({ status: status({ uptime24: null }) }, '状况·没有可用率');
assert.equal(
  metaOf(stUptimeNull).length,
  metaOf(stNormal).length - 1,
  '★★ `uptime24: null` ⇒ 那一行**整行不在**（"今天没有数据"与"可用率 0%"是两件事）',
);
assert.equal(
  metaOf(stUptimeNull).includes(fresh('ranked.statusUptime', { pct: UPTIME_PCT })),
  false,
  '★★ 而且没有任何"0%"之类的话顶上（正面对照就是上面那四行）',
);
assert.equal(
  metaOf(stUptimeNull)[1],
  fresh('ranked.statusCheckedAt', { time: UPSTREAM_TIME }),
  '★ 掉的是**那一行**，别的行原样（顺序没有被挤乱）',
);

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
const stStale = renderStatus({ status: status({ state: 1, stale: true }) }, '状况·服务端兜底');
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
ok('状况：四态各有各的话 + 四行度量逐行 + 0/null 两句话 + uptime 掉行 + 兜底那一句');

// ---------------------------------------------------------------------------
console.log('③ 实时高分对局：两侧各五格 + 占位符 + 镜像 + 排序取前 10 + 展开入口的正反');
// ---------------------------------------------------------------------------
/* 冻结值先钉常量，再钉产物：只钉产物的话，常量改了断言跟着走（那是装饰）。 */
assert.equal(RANKED_LIVE_TOP, 10, '★★ 冻结的"取前 10"（spec §13）');
assert.equal(RANKED_ELO_TOP, 100, '★★ 冻结的"排行榜前 100"（spec §13）');

const live = renderLive({}, '对局·正常');
const cards = elementsWithClass(live, 'ranked__match');
assert.equal(cards.length, 4, `★ 夹具四场都要渲染出来（找到 ${String(cards.length)} 张）`);
/*
 * ★★ 排序与"取前 10"是**视图自己**做的（`topLiveMatches`，本文件头第 3 节那条纪律：
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
  '★ 「{{total}} 场里按平均 elo 取前 10」里的 total 是**总场次**（与下面那张表同一次计算）',
);
/*
 * 12 场 ⇒ 只渲染前 10。⚠️ 这条同时钉住"那句 total 说的是 12 而不是 10"：
 *    把 topLiveMatches 换成直接渲染 matches 时，卡片数会变成 12 ⇒ 红。
 */
const liveMany = renderLive({ live: LIVE_MANY }, '对局·12 场');
assert.equal(
  elementsWithClass(liveMany, 'ranked__match').length,
  RANKED_LIVE_TOP,
  `★★ 12 场只渲染前 ${String(RANKED_LIVE_TOP)} 张`,
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
  '★ 取前 10 取的是**分最高的**那 10 场（第 11 张卡片是分数最低的那一场）',
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
ok('对局：两侧五格逐格 + 两格 null 的孤立断言 + 排序/取前 10 + 展开键正反 + Twitch parent');

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
/* `highest: null` ⇒ 占位符；而 `phasePoint: 0` 是**真的值**。 */
assert.equal(eloRows[1]?.[3], fresh('ranked.unknown'), '★★ `highest: null` ⇒ 那一格印 `—`');
assert.equal(eloRows[2]?.[4], flat('0'), '★ `phasePoint: 0` ⇒ 印 0（**不是**占位符）');
assert.equal(eloRows[1]?.[1], flat('Bravo'), '★ 正向对照：同一行别的格子都是真值');
/* 105 条 ⇒ 只渲染前 100（`topEloEntries` **只截断不重排**）。 */
const eloMany = renderElo({ elo: ELO_MANY }, '排行榜·105 条');
assert.equal(
  elementsWithClass(eloMany, 'ranked__table')[0]?.match(/<td>/g)?.length,
  RANKED_ELO_TOP * 5,
  `★★ 105 条只渲染前 ${String(RANKED_ELO_TOP)} 名（${String(RANKED_ELO_TOP * 5)} 个格子）`,
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
 */
const navOf = (html: string): { href: string | null; text: string; off: boolean }[] =>
  elementsWithClass(html, 'ranked__navbtn').map((el) => ({
    href: attrOf(el, 'href'),
    text: textOf(el),
    off: hasClassOf(el, 'ranked__navbtn--off'),
  }));
const navZero = navOf(weeklyZero);
assert.equal(navZero.length, 2, '★ 翻页那一行恰好两格（上一周 / 下一周）');
assert.deepEqual(
  navZero.map((each) => each.text),
  [fresh('ranked.weeklyPrev'), fresh('ranked.weeklyNext')],
  '★ 两格的文字',
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
ok('周赛：第 0 周 + 四个种子逐格 + 翻页链接/非链接正反 + 五列 + 空态');

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
      '★ "N 场里取前 10"那句在 0 场时**不渲染**（N = 0 时它是一句废话，读起来像模板坏了）',
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
  '   · 点开 `<details>` 之后才挂的 iframe（`ClickToPlayEmbed` 的 `useState`）、真的播放；',
);
console.log('   · **尺寸、配色与字体**：这里只看类名在不在 `styles.css` 里（⑧），不看它长什么样。');
console.log(
  '   · 上游那一侧：解析、排序、取前 N 的逐值断言在 `services/api/src/ranked-shared.test.ts`，',
);
console.log('     心跳端点在 `services/api/src/ranked.test.ts`。');
/*
 * ⚠️ 组数是**手抄的**（本仓惯例）：它防的是"把某一段摘掉" —— 删掉一整组断言之后
 *    脚本照样绿、照样打印"通过 N 项"，只有这个数字会变。改脚本就要一起改这里。
 * ⚠️ en 比 zh 多一组，是因为 ⑪ 那个"英文产物里不许有汉字"的扫描只在 en 那一遍跑
 *    （`if (LANG === 'en')`，见上面）；两个数差 1 是**正常的**，别把它抹平。
 */
const expectedGroups = LANG === 'en' ? 15 : 14;
assert.equal(
  pass,
  expectedGroups,
  `探针：这一轮应当通过 ${String(expectedGroups)} 组（少了就说明有人把某一段摘掉了）`,
);
