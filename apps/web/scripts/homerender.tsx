#!/usr/bin/env tsx
/**
 * 主页改版（2026-09-14）的**渲染**自检。
 *
 * 跑法（从仓库根）：
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:home
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:home -- --en
 *
 * ---------------------------------------------------------------------------
 * 守的是什么
 * ---------------------------------------------------------------------------
 * 用户原话：「将主页上的『资源库』以及底下的两个框去掉，改成和左侧一样的几个
 * 栏目的说明文本、网页和 api 的连通性测试」。三件事各有自己最容易坏的地方：
 *
 *   ① **栏目清单** —— 整页必须**就是** `lib/nav.ts` 的 `NAV_SECTIONS` 渲染出来的
 *      样子：行数、顺序、链接、名字（`nav.*`）、说明（按短名 `home.desc.<block>`）。
 *      ⚠️ 这张表**只有一份**（`lib/nav.ts`，Layout 与首页共用），本脚本也**不再抄**
 *      第二份 —— 抄一份的写法反倒会让"抄得像不像"变成判据。
 *      于是这里补**两条独立的守卫**（否则 nav.ts 自己写错就没人守）：
 *        · 字典里的 `home.desc.*` 与导航里的 block **一一对应**（期望值从字典读）；
 *        · 每个可点的栏目在 `App.tsx` 里**真的有路由**（期望值从路由表读）。
 *
 *   ② **删干净了没有** —— 删东西最容易留下半截：一个 `card--muted` 的壳、
 *      一行写死的 `GET /api/health`、或者那句 `home.comingSoon`。
 *      ⚠️ 这一条**只能在整页上验**：只渲染被我拆出来的那两个组件的话，
 *      "被删的块不在页面上"就是恒真的空话（本仓在 `liverender.tsx` 里
 *      为同一类"反面断言静默变绿"的问题写过注释）。
 *
 *   ③ **连通性绝不能撒谎** —— 尤其是"接口连不上时，界面不能显示成正常"。
 *      这一条是整块里唯一会造成实质伤害的失败：用户会以为服务是好的。
 *
 * ---------------------------------------------------------------------------
 * 为什么能渲染整页、又为什么还要单独渲染 StatusRow
 * ---------------------------------------------------------------------------
 * `useAsync` 在 SSR 下**不跑 effect**（见 `lib/useAsync.ts`），所以整页在
 * `renderToStaticMarkup` 里永远停在"检查中"：
 *   · 整页那一份 ⇒ 验栏目清单、验残骸、验"检查中"。
 *   · `StatusRow` 是**纯展示**（只收 props、自己不发请求），所以"成功"与"失败"
 *     这两支必须**直接喂 props** 才能渲染出来 —— 那正是 2026-09-14 把展示拆出来的
 *     唯一理由（本仓先例：`CalendarSeriesSection`、`LiveCard`）。
 *
 * ---------------------------------------------------------------------------
 * 覆盖边界（写清楚，免得下一个人高估它）
 * ---------------------------------------------------------------------------
 * ⚠️ **没有点击、没有请求、没有真实浏览器**：
 *   · "点栏目行会不会真的跳到那一页" —— 这里只验到 `href`（`<Link>` 渲染出来的那个）；
 *   · "点重试会不会真的再发一次请求" —— `renderToStaticMarkup` **不跑事件处理器**，
 *     这里只验到"传了 `onRetry` 就会出现按钮、没传就不会"；
 *   · **首屏耗时的真实数值** —— `useEffect` 在 SSR 里不跑，所以这里永远看不到那个数。
 *     真实浏览器里才有数，而那需要一个人打开页面（本轮没做）。
 *   ⇒ 三样都在下面的报告里列为"未被覆盖"。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { en, zhCN } from '@mcsr/shared/i18n';
import i18n from 'i18next';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';

import { em } from '@/components/Emphasis';
import { NAV_SECTIONS } from '@/lib/nav';
import { Home, SectionList, StatusRow, type StatusState } from '@/routes/Home';

/*
 * ⚠️★ 2026-09-14：这里原来有一行全局兜底 `Object.assign(globalThis, { React })`，
 *    它修的是一处**门禁缺口**（不是产品缺陷）：
 *
 *      `tsx --tsconfig tsconfig.json …` 用 `apps/web` 这份 tsconfig，而它的
 *      `jsx: react-jsx` **只对 `include` 覆盖到的文件生效**。
 *      `packages/ui/src/Button.tsx` 当时不在 include 里 ⇒ 被当成 **classic runtime**
 *      编译（产出 `React.createElement`），可它按 automatic runtime 写、没有 `React`
 *      这个值 ⇒ `ReferenceError: React is not defined`，报错行指向 Button 自己的
 *      `return (` —— 看起来像"组件坏了"。
 *
 *    ⇒ **根因已经修在 `apps/web/tsconfig.json` 的 `include` 里**（把
 *      `packages/ui/src` 加了进去，那里有完整记录与三条对照实测），所以这一行
 *      兜底连同它的动态 import 一起删掉了。
 *      ⚠️ 别把兜底加回来：它只是把缺口藏在一个脚本里，下一个渲染 `@mcsr/ui`
 *        的脚本照样会崩，而崩的地方看起来像组件坏了。
 */

const LANG = process.argv.includes('--en') ? 'en' : 'zh-CN';

await i18n.init({
  lng: LANG,
  fallbackLng: false,
  resources: { 'zh-CN': { translation: zhCN }, en: { translation: en } },
  interpolation: { escapeValue: false },
});

/*
 * ⚠️ 刻意**不用 JSX**（用 `React.createElement`），理由与 `calendarrender.tsx` /
 *    `roleguide.tsx` 相同：`scripts/**` 不在 tsconfig 的 include 里 ⇒ JSX 走
 *    classic runtime ⇒ 必须 `import React from 'react'`，而 biome 的
 *    `noUnusedImports` 会把它判成未使用并提供一个**不安全自动修复** ——
 *    谁点了那个修复，脚本就在运行时崩。
 *    （这个脚本里 `React` 那个值导入另有**实质用途**：见上面那段全局兜底的说明。）
 */
const render = (node: React.ReactElement): string =>
  renderToStaticMarkup(
    React.createElement(I18nextProvider, { i18n }, React.createElement(MemoryRouter, null, node)),
  );

/** 标签剥掉、实体还原、空白压掉 —— 只比较"人看到的那串字"。 */
const decode = (s: string) =>
  s
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
const norm = (s: string) =>
  decode(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, '');
const textOf = (html: string) => norm(html);

/**
 * 一条词条在**页面上**应该长成什么样。
 *
 * ⚠️ 不能直接拿 `t(key)` 去比：词条里用 `**这样**` 表示强调（中英都是这个约定），
 *    而页面把它交给 `em()` 渲染成 `<strong>`（见 `components/Emphasis.tsx`）。
 *    所以期望值是**把 em() 真的跑一遍再取文本**，而不是词条原文 ——
 *    `String(em(...))` 不行：它返回的是 ReactNode（元素数组），字符串化会带逗号。
 */
const asRendered = (text: string): string =>
  textOf(renderToStaticMarkup(React.createElement(React.Fragment, null, em(text))));

/* 探针：`asRendered` 必须真的把 `**` 吃掉，否则下面几条是在比"有没有星号"。 */
assert.equal(
  asRendered('**粗**体'),
  '粗体',
  'asRendered 本身必须能把 `**` 变成强调（否则"页面上没有字面 **"这条是空跑）',
);

const t = (key: string, opts?: Record<string, unknown>): string => i18n.t(key, opts) as string;

/**
 * 针孔探针（本仓老规矩，来历见 `liverender.tsx` 里 `noEmbedBilibili` 那一段）：
 * 词条必须**真的解析出文字**，而不是原样返回 key。
 *
 * ⚠️ 为什么每条都要它：缺键时 i18next **原样返回 key**，于是
 *   · 正面断言 `includes(t(key))` 比的是 key 与 key —— 可能照样通过；
 *   · 反面断言（"页面上没有 X"）**直接静默变绿**。
 *   所以每一条断言用到的词条都先过这里。
 */
function resolved(key: string, opts?: Record<string, unknown>): string {
  const value = t(key, opts);
  assert.notEqual(
    value,
    key,
    `探针：词条 ${key} 没有解析出译文（缺键时 i18next 原样返回 key，下面的断言都会变成空跑）`,
  );
  return value;
}

let pass = 0;
const ok = (m: string): void => {
  pass += 1;
  console.log(`  ✓ ${m}`);
};

/**
 * 整页渲染（唯一能验"被删的东西真的不在了"的那一份）。
 * ⚠️ 它同时是"检查中"那一支的证据：`useAsync` 不跑 effect ⇒ 接口那一行停在
 *    `home.statusChecking`，一行都还没测出来。
 */
const page = render(React.createElement(Home));
const pageText = textOf(page);

/**
 * 一行栏目：`href`（**未实现的分区没有它**）+ 名字 + 说明 + 是不是不可点。
 */
function sectionRows(html: string): {
  href: string | null;
  name: string;
  desc: string;
  disabled: boolean;
}[] {
  const rows: { href: string | null; name: string; desc: string; disabled: boolean }[] = [];
  for (const m of html.matchAll(/<li class="homesec__item">([\s\S]*?)<\/li>/g)) {
    const chunk = m[1] ?? '';
    rows.push({
      href: /<a[^>]*href="([^"]*)"/.exec(chunk)?.[1] ?? null,
      name: textOf(/class="homesec__name">([\s\S]*?)<\/span>/.exec(chunk)?.[1] ?? ''),
      desc: textOf(/class="homesec__desc">([\s\S]*?)<\/span>/.exec(chunk)?.[1] ?? ''),
      disabled: chunk.includes('aria-disabled="true"'),
    });
  }
  return rows;
}

console.log(`【${LANG}】主页：栏目说明 + 连通性`);

/*
 * 探针：行提取器本身必须能命中。它写坏时返回空数组，而空数组在下面的
 * `deepEqual` 里不会混过去 —— 但报出来的会是"页面没渲染出栏目"，指向错的地方。
 */
assert.deepEqual(
  sectionRows(
    '<li class="homesec__item"><a class="homesec__row" href="/x"><span class="homesec__name">N</span><span class="homesec__desc">D</span></a></li>',
  ),
  [{ href: '/x', name: 'N', desc: 'D', disabled: false }],
  '行提取器本身必须能命中（否则下面几条是在比空数组）',
);

/**
 * ① ★ 栏目清单：整页必须**就是** `NAV_SECTIONS` 渲染出来的样子。
 *
 * ⚠️★ 判据的表来自 `lib/nav.ts`（与左侧导航**同一份常量**），**不在这里再抄一份**：
 *    三份手抄的"同一件事"正是 2026-09-14 评审指出的问题 —— 它们不会报错，
 *    只会在某天变成"首页 5 栏、侧栏 6 栏"，或者两者的顺序不一样。
 *    ⇒ 所以这里断言的是**渲染忠实于那张表**：行数、顺序、每一行的链接/名字/说明。
 * ⚠️ 于是这一条**不会**发现 `nav.ts` 自己写错了路由（比如 `/calender`）——
 *    那一类由下面"路由存在性"那一条兜住（它读的是 `App.tsx`，是另一份事实）。
 * ⚠️ 名字用 `labelKey`、说明按**短名** `block` 推 `home.desc.<block>` —— 两条都
 *    先过针孔探针（缺词条时 `t()` 原样回显 key，页面上就会出现 `home.desc.xxx`）。
 */
const rows = sectionRows(page);
assert.equal(
  rows.length,
  NAV_SECTIONS.length,
  `★ 首页必须一栏一行地列出 NAV_SECTIONS 里的 ${NAV_SECTIONS.length} 个栏目（实际 ${rows.length} 行：${rows.map((r) => r.href ?? '(未实现)').join(' / ')}）`,
);
for (const [i, want] of NAV_SECTIONS.entries()) {
  const got = rows[i];
  const nameKey = want.labelKey;
  const descKey = `home.desc.${want.block}`;
  assert.equal(
    got?.name,
    asRendered(resolved(nameKey)),
    `★ 第 ${i + 1} 行的栏目名必须等于 t('${nameKey}') —— 名字与左侧导航是同一批词条，不是这里抄的第二份`,
  );
  assert.equal(
    got?.desc,
    asRendered(resolved(descKey)),
    `★ 第 ${i + 1} 行的说明必须等于 t('${descKey}')（说明是按 block 推出来的）`,
  );
  if (want.milestone) {
    assert.equal(
      got?.href,
      null,
      `★ 第 ${i + 1} 行（milestone=${want.milestone}）还没实现 ⇒ 不该渲染成链接`,
    );
    assert.equal(got?.disabled, true, `★ 第 ${i + 1} 行要标成 aria-disabled（与左侧同一套语义）`);
  } else {
    assert.equal(
      got?.href,
      want.to,
      `★ 第 ${i + 1} 行的链接必须是 ${want.to}（顺序与左侧导航一致）—— 实际是 ${String(got?.href)}`,
    );
    assert.equal(got?.disabled, false, `★ 第 ${i + 1} 行是可点的栏目，不该带 aria-disabled`);
  }
}
ok(`★ ${NAV_SECTIONS.length} 个栏目逐条对上（顺序、链接、名字 nav.*、说明 home.desc.<block>）`);

/*
 * ★ 字典与导航必须**一一对应**：`home.desc.*` 里每一条都要有栏目用它，
 *   而每一栏的 `block` 也都要有说明。
 *
 * ⚠️ 期望值**从两份字典本身读**（不是手抄第六份表）：少一条 ⇒ 页面上印出裸 key；
 *    多一条没人用的 ⇒ 某次改名留下的孤儿。两个方向都会在这里红。
 *    两份字典都读，所以"只加在 zh 里"那种漏也会被发现。
 */
const dictBlocks = [
  ...new Set([...Object.keys(zhCN.home.desc), ...Object.keys(en.home.desc)]),
].sort();
const navBlocks = [...new Set(NAV_SECTIONS.map((s) => s.block))].sort();
assert.deepEqual(
  navBlocks,
  dictBlocks,
  '★ `home.desc.*` 的键与导航里的 block 必须一一对应（两个方向都要对）',
);
ok(`★ 字典里的 ${dictBlocks.length} 条栏目说明与导航里的 block 一一对应`);

/*
 * ★★ 路由存在性 —— **这一条不是渲染断言**，放在这里是因为它守的正是首页那六行。
 *
 * ⚠️ 为什么需要它：上面那条把"页面 == NAV_SECTIONS"钉死了，但**没有任何东西在验
 *    NAV_SECTIONS 自己**（侧边栏同样不验）。把 `/calendar` 写成 `/calender`
 *    不会有任何报错 —— 首页与侧栏会一起指向一个 404，而两处看起来都"一致"。
 *    ⇒ 所以这里读 `App.tsx` 的源码（**另一份事实**），要求每一个**可点**的栏目
 *      都有一条真的路由。做法与 `liverender.tsx` 读 `Live.tsx` 源码一致。
 */
const APP_SOURCE = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
assert.ok(
  APP_SOURCE.includes('path="/"'),
  '路由扫描器本身必须能命中（连 `path="/"` 都找不到的话，下面那条是空跑）',
);
for (const s of NAV_SECTIONS) {
  if (s.milestone) continue; // 未实现的分区本来就不该有路由
  assert.ok(
    APP_SOURCE.includes(`path="${s.to}"`),
    `★ 可点的栏目 ${s.to} 必须在 App.tsx 里真的有一条路由 —— 否则点进去是 404，而"首页和侧栏一起指错"不会有任何报错`,
  );
}
ok('★ 每个可点的栏目在 App.tsx 里都有真路由（侧栏与首页共用这张表，这是它唯一的独立守卫）');

/*
 * ★ 这一条守的是"清单来自 props"，不是"组件里写死了那八行"：
 *   写死的话 `nav.ts` 那张表就成了一条没人读的常量，而"首页少了一栏"不会有报错。
 *   ⚠️ 只有**单独渲染组件**才验得到这一点 —— 整页那一份无论写死还是读 props，
 *      渲染出来的都是八行。
 */
const single = render(
  React.createElement(SectionList, {
    items: [{ to: '/resources', labelKey: 'nav.resources', block: 'resources', milestone: '' }],
  }),
);
assert.equal(
  sectionRows(single).length,
  1,
  '★ 只传一行 ⇒ 只该渲染一行（渲染出八行说明这八个栏目是被写死在组件里的，页面上改不动）',
);
ok('★ 栏目行来自 props（只传一行就只渲染一行）');

/*
 * ★ 未实现的分区那一支：**不渲染成链接**，而是像左侧一样标成不可点。
 *
 * ⚠️ 今天 `NAV_SECTIONS` 八个都是已实现的 ⇒ 这一支在整页那一份里**永远走不到**。
 *    不单独喂一份 props 的话，"给占位分区一个点了没反应的链接"这件事没人守 ——
 *    而 `milestone` 不是假想字段：日历 / 视频 / 种子从 M0 起一直挂着 `M4` 当占位
 *    （见 `lib/nav.ts` 与 `Layout.tsx` 的注释），以后再加分区也会走这里。
 */
const placeholder = render(
  React.createElement(SectionList, {
    items: [
      { to: '/future', labelKey: 'nav.seeds', block: 'seeds', milestone: 'M9' },
      { to: '/resources', labelKey: 'nav.resources', block: 'resources', milestone: '' },
    ],
  }),
);
const placeholderRows = sectionRows(placeholder);
assert.equal(
  placeholderRows.length,
  2,
  '★ 未实现的那一栏也要渲染出来（它同样需要一句说明），只是不能点',
);
assert.equal(placeholderRows[0]?.href, null, '★ 未实现的分区不能渲染成链接（点进去是空白 / 404）');
assert.equal(
  placeholderRows[0]?.disabled,
  true,
  '★ 未实现的分区要标成 `aria-disabled="true"`（与左侧同一套语义）',
);
assert.equal(
  placeholderRows[1]?.href,
  '/resources',
  '（正向对照）同一份 props 里已实现的那一行仍然是链接 —— 否则上面那条"没有链接"是恒真的',
);
ok('★ 未实现的分区（milestone 非空）渲染成不可点的一行，而不是链接');

/**
 * ② ★★ 反向：被删掉的那两块**不能留下残骸**。
 *
 * ⚠️ 判据全部用**结构性**标记（class / 那段写死的端点壳），不用中文串 ——
 *    被删的那两块里写死的字是中文，拿它当判据的话**英文那一遍是恒真的空跑**。
 *    （写死的中文串在下面单独一条里验，并且只在中文那一遍跑，理由写在那里。）
 */
const RESIDUE: readonly (readonly [string, string])[] = [
  ['class="cta"', 'hero 里那个「资源库 →」按钮（它原来是一个 class="cta" 的站内链接）'],
  ['class="cards"', '装那两张卡的网格'],
  ['class="card"', 'API 那张卡本身'],
  ['card--muted', 'M1 那张卡本身'],
  ['card__meta', 'API 卡里那行硬编码端点的外壳（<p class="card__meta"><code>…</code></p>）'],
  ['planlist', 'M1 卡里那份计划清单'],
];
for (const [needle, what] of RESIDUE) {
  assert.equal(
    page.includes(needle),
    false,
    `★ 该删掉的东西还在页面上：${what} —— 找的是 ${needle}`,
  );
}

/*
 * ⚠️★ 为什么不在这里断言"页面上没有 `GET /api/health`"：
 *    那个串**现在是新块的一部分**（`home.apiEndpoint` 就是它），
 *    所以"找得到它"是**正确**的，"找不到"才是坏的。
 *    真正被删掉的是它**写死在卡片里**的那一份 —— 判据是上面那条 `card__meta`。
 *    下面这条是它的正向对照：端点必须还在，而且必须来自词条。
 */
assert.ok(
  page.includes(resolved('home.apiEndpoint')),
  '★ 新块里必须有端点说明（它现在是 home.apiEndpoint 一词条）—— 没有的话上面那条反面断言就成了"整块都没渲染"',
);

/*
 * `home.comingSoon` 那句话属于被删掉的那两块内容，不该再出现在主页上。
 * ⚠️ 词汇表里那条**刻意留着**（见字典里的注释），所以这里必须验"用没用"，
 *    不能靠"它还不在字典里"。
 */
const comingSoon = textOf(resolved('home.comingSoon'));
assert.equal(
  pageText.includes(comingSoon),
  false,
  '★ `home.comingSoon` 那句"M0 骨架阶段"的话不该再出现在主页上（它属于被删掉的那两块）',
);
ok('★ 被删的两块没有残骸（CTA、cards/card/card--muted/card__meta、planlist、comingSoon 全都不在）');

if (LANG === 'zh-CN') {
  /*
   * 被删的那张 M1 卡里的计划清单是**写死的中文**（不是词条）。判据是那几句原话。
   * ⚠️ 只在中文这一遍跑：英文页面里它们本来就不可能出现，那样断言是恒真的。
   *    英文那一遍由下面"英文界面零汉字"那条覆盖同一类问题（写死的中文）。
   */
  const OLD_LITERALS = [
    '资源库（浏览 / 搜索 / 筛选）',
    '用户系统 + 邮箱验证 + 提交与审核',
    'Electron 桌面壳 + 自动更新',
    '日历 + 视频 + 种子分享',
  ];
  for (const literal of OLD_LITERALS) {
    assert.equal(
      pageText.includes(norm(literal)),
      false,
      `★ 被删的那张计划卡里写死的中文还在页面上：「${literal}」`,
    );
  }
  ok('★ 被删的计划卡里那几句写死的中文没有再出现');
}

/**
 * ③ ★★ 连通性三态。
 */

/** 接口那一行的 props —— 三种状态共用同一套 label / note / endpoint。 */
const apiRow = (state: StatusState, onRetry: (() => void) | null = null): string =>
  render(
    React.createElement(StatusRow, {
      label: t('home.statusApi'),
      state,
      note: t('home.apiNote'),
      endpoint: t('home.apiEndpoint'),
      onRetry,
    }),
  );

/*
 * ⓪ 检查中：**整页 SSR 就是这个状态**（`useAsync` 不跑 effect），所以这一支用整页验，
 *    而不是自己造一个 props —— 造的话就验不到"页面在没测完时到底显示了什么"。
 */
const checkingText = resolved('home.statusChecking');
const okText = resolved('home.statusOk');
assert.ok(
  pageText.includes(textOf(checkingText)),
  '★ 还没测完时必须说「检查中」（而不是留一个空的行，或者直接写"正常"）',
);
assert.equal(
  page.includes('pill--ok'),
  false,
  '★ 检查中不许带"正常"那个绿胶囊（整页 SSR 里一行都还没测出来）',
);
ok('★ 检查中：说「检查中」，且没有绿色的"正常"');

/*
 * ① 成功：版本号 + 这次请求的往返毫秒。
 *
 * ⚠️ 下面第 2 条断言（"不许有字面的 `{{`"）才是重点：实现忘了把 version / ms 传给
 *    `t()` 时，i18next 会把 `{{version}}` / `{{ms}}` **原样留在文案里**，
 *    而"包含那句词条原文"这种断言**照样通过**（词条原文里本来就有 `{{`）。
 */
const VERSION = '9.9.9-probe';
const ROUND_TRIP = 42;
const okHtml = apiRow(
  {
    status: 'ok',
    details: [
      t('home.apiVersion', { version: VERSION }),
      t('home.apiRoundTrip', { ms: ROUND_TRIP }),
    ],
  },
  () => undefined,
);
const okHtmlText = textOf(okHtml);
assert.ok(okHtml.includes('pill--ok'), '★ 测通时必须带"正常"那个绿胶囊');
assert.ok(okHtmlText.includes(textOf(okText)), '★ 测通时必须说「正常」');
assert.ok(okHtmlText.includes(VERSION), `★ 版本串必须真的渲染出来（${VERSION}）`);
assert.ok(
  okHtmlText.includes(textOf(t('home.apiRoundTrip', { ms: ROUND_TRIP }))),
  '★ 必须显示**这次**请求的往返毫秒',
);
assert.ok(okHtmlText.includes(String(ROUND_TRIP)), `★ 那个毫秒数（${ROUND_TRIP}）必须真的出现`);
assert.equal(
  okHtmlText.includes('{{'),
  false,
  '★ 不许出现字面的 `{{` —— 那是"忘了把 version / ms 传给 t()"的形状（用户会看到占位符）',
);
assert.ok(okHtml.includes(t('common.retry')), '测通时重试按钮也要在（它就是"再测一次"）');
ok('★ 成功：绿胶囊 + 「正常」+ 版本串 + 往返毫秒（无字面 `{{`）');

/*
 * ② ★★ 失败 —— **这一块里唯一会造成的实质伤害**：
 *    接口连不上却显示成"正常"，用户会以为服务是好的。
 *    所以这里用**成对断言**：失败那一份必须同时满足
 *      (a) 出现「连不上」与错误原文；(b) **不出现**「正常」、也不带那个绿胶囊。
 *    而"不出现"单独成立是**假绿**（渲染炸了、整块没渲染，它都成立）——
 *    所以紧跟着一条**正向对照**：同一次运行里，成功那一份必须找得到同一句话。
 */
const BOOM = 'API 返回 HTTP 503 —— 本地开发时后端没启动？用 pnpm dev 或 pnpm dev:web';
const failHtml = apiRow({ status: 'error', message: BOOM }, () => undefined);
const failHtmlText = textOf(failHtml);
assert.ok(failHtmlText.includes(textOf(resolved('home.statusFail'))), '★ 失败时必须说「连不上」');
assert.ok(
  failHtmlText.includes(textOf(BOOM)),
  '★ 失败必须把错误**原样**说出来，而不是只留一个灰着的状态',
);
assert.equal(
  failHtml.includes('pill--ok'),
  false,
  '★★ 失败时绝不能带"正常"那个绿胶囊 —— 那是这一块唯一会骗人的地方',
);
assert.ok(
  failHtml.includes('pill--bad'),
  '★★ 失败时必须带"坏"那个红胶囊（成对：既不能绿、也得真的红）',
);
assert.equal(failHtmlText.includes(textOf(okText)), false, '★★ 失败时绝不能出现「正常」这句话');
assert.ok(
  okHtmlText.includes(textOf(okText)),
  '（正向对照）同一次运行里，成功那一份必须找得到同一句话 —— 否则上面那条"找不到"是恒真的',
);
assert.ok(failHtml.includes(t('common.retry')), '失败时重试按钮必须在（人要有下一步可做）');
ok('★★ 失败：红胶囊 + 「连不上」+ 错误原文，且不出现「正常」（附正向对照）');

/*
 * ③ 手动重试是**由 props 决定**的，而"网页"那一行**没有**它 ——
 *    "重新测网页"这件事在技术上就是刷新页面本身，给它一个按钮等于编一个不存在的动作。
 *    （真实点击没有被覆盖：`renderToStaticMarkup` 不跑事件处理器，见文件头边界。）
 */
const webHtml = render(
  React.createElement(StatusRow, {
    label: t('home.statusWeb'),
    state: { status: 'ok', details: [t('home.webLoaded', { ms: 123 })] },
    // ⚠️ 与真实调用点一致地套 `em()`（`StatusRowProps.note` 收的就是 ReactNode）。
    note: em(t('home.webNote')),
  }),
);
const webHtmlText = textOf(webHtml);
assert.ok(
  webHtmlText.includes(textOf(t('home.webLoaded', { ms: 123 }))),
  '★「网页」那一行必须带一个**量出来的数**（首屏耗时）—— 没有数的"正常"只是装饰',
);
assert.ok(webHtmlText.includes('123'), '★ 那个毫秒数（123）必须真的出现');
assert.equal(webHtmlText.includes('{{'), false, '★ 首屏耗时那条词条的 `{{ms}}` 必须被填上');
assert.ok(
  webHtmlText.includes(asRendered(resolved('home.webNote'))),
  '★ 要写清"能读到这行就说明页面已经加载出来了"',
);
assert.equal(
  webHtml.includes(t('common.retry')),
  false,
  '★「网页」那一行**不该有重试按钮** —— 没有"从服务器 ping 网页"这种动作，编一个出来就是假数据',
);
assert.equal(
  webHtml.includes('pill--bad'),
  false,
  '★「网页」那一行永远是绿的：能读到它，就已经说明这一页渲染出来了（它没有失败态）',
);
ok('★ 「网页」那一行：带首屏耗时 + 解释，没有重试按钮、也没有失败态');

/**
 * ④ ★ 整块的标题/提示都在（顺带证明上面那些"不在页面上"的断言不是因为整块没渲染）。
 *
 * ⚠️ 期望值一律走 `asRendered()`（= 真的跑一遍 `em()` 再取文本），不是词条原文：
 *    `home.statusHint` 里有一对 `**`，页面把它渲染成 `<strong>`，原文里的星号
 *    不该出现在页面上 —— 拿原文去比，反而是**渲染对了**才会红。
 */
for (const key of [
  'home.sectionsTitle',
  'home.sectionsHint',
  'home.statusTitle',
  'home.statusHint',
]) {
  assert.ok(pageText.includes(asRendered(resolved(key))), `★ 主页该有 ${key} 这一句`);
}
assert.ok(
  pageText.includes(textOf(resolved('home.statusWeb'))),
  '★ 连通性那一块要有「网页」这一行',
);
assert.ok(
  pageText.includes(textOf(resolved('home.statusApi'))),
  '★ 连通性那一块要有「接口」这一行',
);
/*
 * ★★ 字面的 `**` 一个都不许留在页面上。
 *
 * ⚠️ 这一条守的是一个**真的发生过**的界面缺陷：词条里的 `**这样**` 是强调约定，
 *    而页面若不经过 `em()`，用户就会直接看到一对星号（`components/Emphasis.tsx`
 *    的注释里记着：全站曾有 15 条这样的词条，是 2026-09-13 在真浏览器里读
 *    `innerText` 才发现的）。而**任何自动检查都不会发现它** —— 词条存在、两种语言
 *    对齐、字体覆盖全过。所以这里专门钉一条。
 *    （前置条件由 `asRendered` 那个探针保证：它要是没把 `**` 吃掉，这条就是空跑。）
 */
assert.equal(
  pageText.includes('**'),
  false,
  '★★ 页面上不该出现字面的 `**`：词条里的强调必须经 `em()` 渲染（home.statusHint 里就有一对）',
);
ok('★ 两块新内容（栏目说明 / 连通性）的标题与提示都在页面上，且没有字面的 `**`');

/** ⑤ ★ 裸 key 泄漏（打错一个字母就会以 `home.desc.xxx` 的形式露在界面上）。 */
const samples = [page, single, okHtml, failHtml, webHtml].join('');
const leaked = [...new Set(samples.match(/(?:home|nav)\.[A-Za-z]+/g) ?? [])];
assert.deepEqual(leaked, [], `裸 key 泄漏：${leaked.join(', ')}`);
/*
 * ⚠️ 探针：泄漏扫描器本身必须能命中一个明显不存在的 key，否则它是恒真的。
 */
assert.notEqual(
  /(?:home|nav)\.[A-Za-z]+/.test('home.descNope'),
  false,
  '泄漏扫描器本身必须能命中（否则上面那条断言是恒真的空跑）',
);
ok('渲染结果里没有裸 key 泄漏（且扫描器本身能命中）');

if (LANG === 'en') {
  /*
   * ⑥ ★ 英文模式：页面上零汉字。
   *
   * ⚠️ 样本里**排除失败那一份**：它的错误原文是这个脚本喂进去的**数据**，
   *    而 `lib/api.ts` 的错误信息至今是写死的中文（那是另一件事，见报告）。
   *    把它算进来的话，这条断言报的是夹具，不是产品文案。
   */
  const han = textOf([page, single, okHtml, webHtml].join('')).match(/[\u4e00-\u9fff]+/g) ?? [];
  assert.deepEqual(han, [], `英文界面里出现了中文：${han.slice(0, 8).join(' / ')}`);
  ok('英文界面里零汉字（排除夹具里的错误原文）');
}

console.log('');
console.log(`通过 ${pass} 项。`);
console.log('');
console.log('⚠️ 这个脚本验的是**渲染**：没有点击、没有请求、也没有真实浏览器。');
console.log('   具体没被覆盖的三样：首屏耗时的真实数值（useEffect 在 SSR 里不跑）、');
console.log('   点栏目行的跳转（只验到 href）、点重试是不是真的重发（只验到按钮在不在）。');
