#!/usr/bin/env tsx
/**
 * 系列活动栏目（`CalendarSeriesSection`）、**删除确认**、**系列颜色**，
 * 以及**审核详情页**（`CalendarReviewView`）的渲染断言。
 *
 * 跑法（从仓库根）：
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:calendar
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:calendar -- --en
 *
 * ---------------------------------------------------------------------------
 * 为什么单独一个脚本
 * ---------------------------------------------------------------------------
 * `CalendarSeriesSection` 此前**没有被任何渲染自检覆盖**：`check:grid` 验资源网格、
 * `check:live` 验直播卡与私人链接、`check:authoring` 验一句文案的映射、
 * `check:roleguide` 验角色说明页 —— 它们都不渲染日历页底部这一块。
 *
 * 而 2026-09-13 这一轮给它加的东西，恰好是**全仓最不能靠肉眼看的一类**：
 * 一个**不可逆**的删除入口、一句**必须点名代价**的确认文案、以及一块
 * **只有 owner 才看得见**的选色面板（判据错了不会有任何报错，只是 owner 改不了）。
 *
 * ---------------------------------------------------------------------------
 * ★★ 这个脚本守的第一条：确认框里的数字
 * ---------------------------------------------------------------------------
 * 删除一个系列会**连带删掉它下面的所有赛事**（含已过去的、含未发布的草稿）
 * 以及它们的版本历史。所以确认文案必须说清"会删掉几场"。
 *
 * ⚠️ 最容易写错的实现是**拿列表行上的 `series.count` 去填那个数** —— 那是
 *    「未结束且已发布」的场次，而删除带走的是**所有**赛场。两者在一个历届赛事系列上
 *    恰好相反：列表显示 0 场未结束 ⇒ 确认框会说"不会影响任何内容"，
 *    而它正要删掉十几场。**那是在用户按下最后一个按钮之前对他说谎。**
 *    ⇒ 服务端为此单开了一个 `impact` 端点；这里守的是**渲染端有没有用对它**。
 *
 * ---------------------------------------------------------------------------
 * ★★ 守的第二条：审核页上"审核员看不看得见这一项"
 * ---------------------------------------------------------------------------
 * `CalendarReviewView` 的字段清单是**手写**的，而手写清单漏一项**不会报错** ——
 * 那一格永远不存在，看起来和"这一条没填"一模一样。它已经漏过 `scheduleText` 和
 * `seriesId`；2026-09-13 又多了一个新坑：时间搬进了 `slots`，而清单里读的还是
 * `startsAtLocal`（新快照里**没有这个键**）⇒ 四行时间会全部显示成 `—`。
 * 所以这里用**新快照 / 旧快照两份 fixture** 分别验一遍。
 *
 * ---------------------------------------------------------------------------
 * 覆盖边界（写清楚，免得下一个人高估它）
 * ---------------------------------------------------------------------------
 * ⚠️ **`check:grid` 里已经有一节渲染这个组件**（它打印的标题是「④b 系列活动栏目」）。
 *    那一节的目的其实是**证据完整性**：它要证明"这个栏目的词条真的进了泄漏扫描的
 *    样本集"，顺带断言搜索框、三个系列名、以及计数插值。它**完全不碰删除流程**
 *    （没有任何一处传 `onAskDelete`）。
 *    ⇒ 这个脚本与它是**互补**的：那边守"栏目渲染得出来"，这边守"删除这条路不骗人"。
 *    刻意不合并：合并之后，以后动删除流程时 `check:grid` 会跟着红，
 *    而它那 40 项里只有 1 项与本次改动有关 —— 那会让人误以为网格坏了。
 *
 * ⚠️ **`routes/CalendarDetail.tsx`（活动信息页）没有被任何自检覆盖**，而且**覆盖不了**：
 *    它自己用 `useAsync` 取数，而 `renderToStaticMarkup` **不跑 effect** ——
 *    SSR 里它永远停在"加载中"，断言不到任何一行。要覆盖它得先把取数拆出组件
 *    （那个重构不属于这一轮）。⇒ 那一页的「比赛时间 / 参赛门槛 / 参与范围明细 /
 *    系列名」只能靠人看，别以为这里验过。
 *
 * 这个脚本验的是**把 props 给对了会渲染成什么样**。它**不验**：点击、请求、
 * 权限判断、以及"点了之后到底删没删" —— 那些在服务端测试
 * （`services/api/src/calendar-series-delete.test.ts`，10 条）与浏览器层。
 * 渲染自检与那两份证据是互补的，不是替代关系。
 */
import assert from 'node:assert/strict';
import { SERIES_COLOR_KEYS, SERIES_COLOR_NONE, SERIES_COLORS } from '@mcsr/shared';
import type { CalendarEvent, CalendarSeries } from '@mcsr/shared/calendar';
import { en, zhCN } from '@mcsr/shared/i18n';
import type { QueueItem, ReviewDetail } from '@mcsr/shared/review';
import i18n from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';

import { CalendarReviewView } from '@/components/CalendarReviewView';
import { CalendarSeriesSection } from '@/components/CalendarSeriesSection';

const LANG = process.argv.includes('--en') ? 'en' : 'zh-CN';

await i18n.init({
  lng: LANG,
  fallbackLng: false,
  resources: { 'zh-CN': { translation: zhCN }, en: { translation: en } },
  interpolation: { escapeValue: false },
});

/*
 * ⚠️ 刻意**不用 JSX**（用 `createElement`），理由与 `roleguide.tsx` 相同：
 *    `scripts/**` 不在 tsconfig 的 include 里 ⇒ JSX 走 classic runtime ⇒
 *    必须 `import React from 'react'`，而 biome 的 `noUnusedImports` 会把它判成
 *    未使用并提供一个**不安全自动修复** —— 谁点了那个修复，脚本就在运行时崩。
 */
const render = (props: Parameters<typeof CalendarSeriesSection>[0]): string =>
  renderToStaticMarkup(
    createElement(I18nextProvider, { i18n }, createElement(CalendarSeriesSection, props)),
  );

/*
 * 审核详情页那一份（`CalendarReviewView` 只要一个 `detail`，所以它**能**纯 SSR 渲染；
 * 详情页 `CalendarDetail` 不行 —— 它自己取数，SSR 里永远停在"加载中"）。
 *
 * ⚠️ 这个 fixture **不在 tsconfig 的 include 里**，形状写错不会有编译错误，
 *    只有真的跑到那一节才会发现。所以每一项都按 shared 的类型写全。
 */
const reviewItem: QueueItem = {
  type: 'calendar',
  id: 'e1',
  revision: 1,
  title: 'Row one',
  subtitle: null,
  isEdit: false,
  authorName: null,
  mine: false,
  createdAt: 0,
  expired: false,
};

const renderReview = (
  pending: Record<string, unknown>,
  live: Record<string, unknown> | null = null,
): string => {
  const detail: ReviewDetail = {
    item: reviewItem,
    live,
    pending,
    note: null,
    previousRejections: 0,
  };
  return renderToStaticMarkup(
    createElement(I18nextProvider, { i18n }, createElement(CalendarReviewView, { detail })),
  );
};

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

const t = (key: string, opts?: Record<string, unknown>): string => i18n.t(key, opts) as string;

/**
 * 取出渲染结果里**所有**颜色小点的「class + 底色」。
 *
 * ⚠️ class 与底色必须**成对**取（在同一个标签里找），不能分开断言"页面上有 `#d9534f`"
 *    和"页面上有 `--none`" —— 那样两个断言各自都能被另一行满足：
 *    两行里一行有颜色、一行是白的，合起来照样全绿，而"哪一行是哪个颜色"没人验。
 * ⚠️ 在**标签内部**分别用正则找 `class=` / `style=`，不假定两个属性的先后顺序
 *    （React 会按 props 顺序写出来，但那不是它承诺的东西）。
 */
function dots(html: string): { cls: string; background: string | null }[] {
  return [...html.matchAll(/<span class="(series__dot[^"]*)"[^>]*>/g)].map((m) => {
    const tag = m[0];
    const bg = /style="background:([^"]*)"/.exec(tag);
    return { cls: m[1] ?? '', background: bg ? (bg[1] ?? '') : null };
  });
}

/** 色板面板里的 13 个 `aria-label`，按渲染顺序。面板不存在时返回空数组。 */
function swatchLabels(html: string): string[] {
  const panel = /<div class="series__swatches">([\s\S]*?)<\/div>/.exec(html);
  if (!panel?.[1]) return [];
  return [...panel[1].matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1] ?? '');
}

let pass = 0;
const ok = (m: string): void => {
  pass += 1;
  console.log(`  ✓ ${m}`);
};

function series(over: Partial<CalendarSeries> = {}): CalendarSeries {
  return {
    id: 's1',
    name: 'MCSR Ranked Playoffs',
    /*
     * ⚠️ `color` 是 2026-09-13 新加的必填字段（需求⑤）。这个夹具**不在 tsconfig
     *    的 include 里**，所以漏了它不会有编译错误 —— 只会在运行时让
     *    `seriesColorValue(undefined)` 悄悄回退成白色，于是一半的断言在验一个
     *    "其实没有颜色"的界面。默认给 `null`（不上色）：它是最常见的那一档，
     *    也是"白色 + 描边"那条路径的入口。
     */
    color: null,
    count: 0,
    pastCount: 0,
    nextStartsAtUtc: null,
    createdBy: null,
    createdAt: 0,
    ...over,
  };
}

const noop = (): void => undefined;

/**
 * 一个形状完整的**赛事**（2026-09-14 加这一节时才有）。
 *
 * ⚠️ 这个夹具**不在 tsconfig 的 include 里**（`scripts/**`），所以字段少一个
 *    不会有编译错误 —— 缺 `slots` 时 `CalendarCard` 会直接抛异常（它读
 *    `event.slots.length`），而那看起来像"组件坏了"。字段按 `CalendarEvent` 写全。
 * ⚠️ 标题用 **ASCII**：下面第 ⑯ 条要断言"英文界面里零汉字"，而事件标题是**数据**
 *    （由这里喂进去）—— 用中文当夹具会让那条断言挂在夹具上，而不是产品文案上。
 */
function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
  const startsAtLocal = over.startsAtLocal ?? '2026-11-14T20:00';
  const endsAtLocal = over.endsAtLocal ?? null;
  const startsAtUtc = over.startsAtUtc ?? Date.UTC(2026, 10, 14, 12, 0);
  const endsAtUtc = over.endsAtUtc ?? null;
  return {
    id: 'ev-0',
    title: 'Event zero',
    titleEn: null,
    descriptionMd: '',
    startsAtLocal,
    startsAtTz: 'Asia/Shanghai',
    startsAtUtc,
    endsAtLocal,
    endsAtTz: null,
    endsAtUtc,
    slots: over.slots ?? [{ startsAtLocal, endsAtLocal, startsAtUtc, endsAtUtc }],
    allDay: false,
    url: null,
    location: null,
    tags: ['TOURNAMENT'],
    stage: null,
    level: null,
    scope: null,
    access: null,
    scopeDetail: [],
    seriesId: null,
    seriesName: null,
    seriesColor: null,
    lang: 'zh-CN',
    authorId: null,
    authorName: null,
    status: 'published',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

/**
 * **带 Router 上下文**的渲染，只给"展开块里有 `CalendarCard`"那一节用。
 *
 * ⚠️ 卡片是 `<Link to="/calendar/…">`，没有 Router 时它**抛异常**（`useHref() may be
 *    used only in the context of a <Router>`）；而那个报错指向"路由"，不指向
 *    "卡片该不该在这里" —— 用不带 Router 的 `render` 验展开，接线一坏就跑偏方向。
 */
const renderRouted = (props: Parameters<typeof CalendarSeriesSection>[0]): string =>
  renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(MemoryRouter, null, createElement(CalendarSeriesSection, props)),
    ),
  );

/** 这段 HTML 里出现了几次某个子串。 */
const countOf = (s: string, needle: string): number => s.split(needle).length - 1;

/** 这段 HTML 里有几张指向赛事详情页的卡片（每张卡恰好一个 `/calendar/…` 链接）。 */
const cardLinks = (s: string): number => (s.match(/href="\/calendar\//g) ?? []).length;

/**
 * 每一行系列按钮的「名字 + `aria-pressed` + `aria-expanded`」，**按渲染顺序**。
 *
 * ⚠️ 只读那一个 `<button>` 标签本身的属性 + 它后面的那一段文字（到下一个按钮为止），
 *    不去匹配 `</button>` 收尾 —— 行内还有别的元素，非贪婪到第一个闭合标签
 *    只能靠运气对得上。属性读完就够：这一节要问的是"哪一行展开着"。
 */
function rowStates(html: string): [string, string, string][] {
  const re = /<button[^>]*class="series__item[^"]*"[^>]*>/g;
  const rows: [string, string, string][] = [];
  for (const m of html.matchAll(re)) {
    const from = (m.index ?? 0) + m[0].length;
    const nextAt = html.indexOf('<button', from);
    const chunk = html.slice(from, nextAt === -1 ? undefined : nextAt);
    const name = /class="series__name">([^<]*)</.exec(chunk)?.[1] ?? '';
    const pressed = /aria-pressed="([^"]*)"/.exec(m[0])?.[1] ?? '';
    const expanded = /aria-expanded="([^"]*)"/.exec(m[0])?.[1] ?? '';
    rows.push([name, pressed, expanded]);
  }
  return rows;
}

/** 一组"服务已经答完了"的 props —— 每个用例只改它关心的那几项。 */
function baseProps(over: Partial<Parameters<typeof CalendarSeriesSection>[0]> = {}) {
  return {
    items: [series()],
    query: '',
    onQueryChange: noop,
    selectedId: null,
    onSelect: noop,
    status: 'ok' as const,
    errorText: null,
    ...over,
  };
}

console.log(`【${LANG}】系列活动栏目`);

/**
 * ① 先说清"能删"这件事是谁决定的：**传不传 `onAskDelete`**。
 *    这不是风格问题 —— 它是 owner 判据（`canHardDelete`）在前端唯一的落点。
 */
const readOnly = render(baseProps());
const asOwner = render(baseProps({ onAskDelete: noop }));

assert.ok(
  textOf(readOnly).includes(norm('MCSR Ranked Playoffs')),
  '系列名必须渲染出来（否则下面几条都是在验一个空壳）',
);
assert.equal(
  readOnly.includes(t('calendar.seriesDelete')),
  false,
  '★ 没有删除权的人不该看到删除入口 —— 判据是调用方有没有传 `onAskDelete`',
);
assert.ok(
  asOwner.includes(t('calendar.seriesDelete')),
  '★ 传了 `onAskDelete` 就必须出现删除入口（否则 owner 根本无从删起）',
);
ok('删除入口只由 `onAskDelete` 决定（不传就没有，传了就有）');

/**
 * ② ★★ 确认文案：**没有赛事**的那一句。
 */
const none = render(
  baseProps({
    onAskDelete: noop,
    deleteConfirm: { id: 's1', count: 0 },
    onConfirmDelete: noop,
    onCancelDelete: noop,
  }),
);
const noneText = textOf(none);
assert.ok(
  noneText.includes(norm(t('calendar.seriesDeleteNone'))),
  '★ count = 0 时必须说"不会影响任何内容"那一句 —— 那是让人敢按下去的唯一依据',
);
assert.equal(
  noneText.includes(norm(t('calendar.seriesDeleteSome', { count: 3 }))),
  false,
  'count = 0 时不该出现"还会删掉 N 场"那一句（两句混用等于两句都没说）',
);
ok('count = 0 ⇒ 只出现"不会影响任何内容"那一句');

/**
 * ③ ★★ 确认文案：**有赛事**的那一句，而且**数字必须真的出现**。
 *
 * ⚠️ 这条的第二个断言才是重点：如果实现忘了把 `count` 传给 `t()`，
 *    i18next 会把 `{{count}}` **原样留在文案里** —— 页面上会出现
 *    "还有 {{count}} 场赛事" 这种字面双花括号。只断言"包含那句词条原文"
 *    的话，这种失败**会漏网**（因为词条原文里本来就有 `{{count}}`）。
 */
const some = render(
  baseProps({
    onAskDelete: noop,
    deleteConfirm: { id: 's1', count: 7 },
    onConfirmDelete: noop,
    onCancelDelete: noop,
  }),
);
const someText = textOf(some);
assert.ok(
  someText.includes(norm(t('calendar.seriesDeleteSome', { count: 7 }))),
  'count = 7 时要出现"有赛事"那一句',
);
assert.ok(
  someText.includes('7'),
  '★ 那个数字必须真的渲染出来（否则用户看到的是插值占位符，而不是代价）',
);
assert.equal(
  someText.includes('{{'),
  false,
  '★ 不许出现字面的 `{{` —— 那是"忘了把 count 传给 t()"的形状',
);
assert.equal(
  someText.includes(norm(t('calendar.seriesDeleteNone'))),
  false,
  'count > 0 时不该出现"不会影响任何内容"那一句',
);
ok('count = 7 ⇒ 出现"还有 7 场"那一句，且数字真的渲染出来、没有字面 `{{`');

/**
 * ④ ★ 两句话**必须真的不同**（防"两个分支实际只有一支可达"）。
 *    ⚠️ 判据用 `!==` 而不是"都包含某词"：它们本来就该是两个不同的句子。
 */
const noneWord = t('calendar.seriesDeleteNone');
const someWord = t('calendar.seriesDeleteSome', { count: 3 });
assert.notEqual(
  noneWord,
  someWord,
  '★ 两个分支必须是两句不同的话 —— 写成同一句的话，"有没有赛事"这件事就没人告诉用户了',
);
assert.notEqual(norm(noneWord), norm(someWord), '（去空白之后也必须不同，防止差异只在排版上）');
ok('两个分支的字面确实不同（不是同一句话的两条路）');

/**
 * ⑤ 确认框必须**同时**给出"确定"与"取消"，且进行中时按钮不能还写着"确定"。
 */
assert.ok(some.includes(t('common.confirm')), '确认框必须有"确定"');
assert.ok(some.includes(t('common.cancel')), '确认框必须有"取消"（不可逆的动作必须能反悔）');
const busy = render(
  baseProps({
    onAskDelete: noop,
    deleteConfirm: { id: 's1', count: 7 },
    deleteBusy: true,
    onConfirmDelete: noop,
    onCancelDelete: noop,
  }),
);
assert.ok(
  busy.includes(t('calendar.seriesDeleteBusy')),
  '删除进行中时按钮要显示"删除中…"（否则用户会重复点一个不可逆的按钮）',
);
ok('确认框有确定/取消，进行中显示"删除中…"');

/**
 * ⑥ 只有**正在确认的那一行**进入确认态。
 *    ⚠️ 判据：传 `deleteConfirm: {id:'s2'}` 时，第一行（s1）仍然是普通行。
 *
 * ⚠️ 这一条的行名**必须用 ASCII**（`Row one` / `Row two`）：
 *    下面第 ⑯ 条要断言"英文界面里零汉字"，而系列名是**数据**、
 *    由这里喂进去 —— 用中文当夹具会让那条断言挂在夹具上，而不是挂在产品文案上。
 *    （第一版就是中文夹具，`--en` 当场红：报的是"第一行 / 第二行"。）
 */
const other = render(
  baseProps({
    items: [series({ id: 's1', name: 'Row one' }), series({ id: 's2', name: 'Row two' })],
    onAskDelete: noop,
    deleteConfirm: { id: 's2', count: 1 },
    onConfirmDelete: noop,
    onCancelDelete: noop,
  }),
);
assert.equal(
  (
    other.match(
      new RegExp(
        t('calendar.seriesDeleteSome', { count: 1 }).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'g',
      ),
    ) ?? []
  ).length,
  1,
  '★ 确认块必须**只出现一次**（出现在每一行的话，用户根本分不清在删哪一个）',
);
ok('确认块只出现在被点的那一行');

/**
 * ⑦ 删除相关的错误与"列表没拿到"是**两块不同的提示**（不并进同一个 error）。
 */
const withDeleteError = render(baseProps({ onAskDelete: noop, deleteErrorText: 'boom' }));
const errText = textOf(withDeleteError);
assert.ok(
  errText.includes(norm(t('calendar.seriesDeleteFailed'))),
  '删除失败要有自己的一句（"你要删的那条没成"与"列表没拿到"是两件事）',
);
assert.ok(errText.includes(norm('boom')), '错误详情要显示出来，而不是只给一句笼统的失败');
ok('删除失败单独成一句，且带上详情');

/**
 * ⑧ ★ 「每个系列用一个颜色标注」（需求⑤的一半题面）。
 *
 * ⚠️ 颜色**只有两处**落地：日历上那条日期横线（`check:grid` 里验）和这里的小点。
 *    漏掉任意一处，用户看到的都是"这个功能没做完"。
 */
const colored = render(
  baseProps({
    items: [
      series({ id: 's1', name: 'Row one', color: 'red' }),
      series({ id: 's2', name: 'Row two', color: null }),
    ],
  }),
);
/*
 * ⚠️ 探针：提取器本身必须能命中。它写坏时返回空数组，而那时候
 *    `coloredDots[0]?.background` 会是 `undefined` —— 恰好也会让断言红，
 *    但报的是"底色不是 #d9534f"，指向的是组件而不是这个正则。先钉住它。
 */
assert.deepEqual(
  dots('<span class="series__dot" style="background:#000000" aria-hidden="true"></span>'),
  [{ cls: 'series__dot', background: '#000000' }],
  '小点提取器本身必须能命中（否则下面几条是在比 undefined）',
);
const coloredDots = dots(colored);
assert.equal(coloredDots.length, 2, '两行系列 ⇒ 两颗小点（一行一颗，多了少了都是错的）');
assert.equal(
  coloredDots[0]?.background,
  SERIES_COLORS.red,
  `★ 上了色的系列，小点底色必须是那个键对应的**色值**（red ⇒ ${SERIES_COLORS.red}）—— 键→色值只有 shared/constants.ts 一处`,
);
assert.equal(
  coloredDots[0]?.cls.includes('series__dot--none'),
  false,
  '有颜色的小点不该带「没上色」那个 class（描边挂在它上面）',
);
assert.ok(
  colored.includes(SERIES_COLORS.red),
  `渲染结果里必须真的出现 ${SERIES_COLORS.red}（内联样式没写出来的话，上面那条是在比 undefined）`,
);
ok(`上了色的系列 ⇒ 小点底色是 ${SERIES_COLORS.red}`);

/**
 * ⑨ ★★「无系列的为白色（**注意描边**，以免底色为白色时看不见）」—— 用户特意点过。
 *
 * ⚠️ 判据必须是**两个东西一起**：底色确实是白色，**而且**带着「没上色」那个 class
 *    （描边挂在那条 CSS 规则上）。只验"是白色"的话，一颗**没有描边**的白点
 *    在白天主题下等于不存在 —— 那正是用户担心的那件事。
 * ⚠️ 边界写在这里：纯 SSR 检查**看不到 CSS**（`renderToStaticMarkup` 只产出标签），
 *    所以这个脚本验的是"class 有没有挂上"。描边本身在 `styles.css` 的
 *    `.series__dot--none` 里，那一条只能靠浏览器看 —— 别以为这里验过"白底上看得见"。
 */
assert.equal(
  coloredDots[1]?.background,
  SERIES_COLOR_NONE,
  '★ 没上色的系列，小点底色必须是白色（`SERIES_COLOR_NONE`）',
);
assert.ok(
  coloredDots[1]?.cls.includes('series__dot--none'),
  `★ 没上色的小点必须带 \`series__dot--none\`（描边挂在它上面）—— 实际是「${coloredDots[1]?.cls}」`,
);
assert.notEqual(
  coloredDots[0]?.cls,
  coloredDots[1]?.cls,
  '两行的 class 必须不同（相同的话说明"没上色"这一档压根没有分支）',
);
ok('没上色的系列 ⇒ 白色小点 + `series__dot--none`（描边的挂点）');

/**
 * ⑩ ★★ owner 的选色面板：13 个色块必须**全都渲染出来**，名字一个不差。
 *
 * ⚠️ 这一条靠的正是组件用**原生 `<details>`**、不是受控开关：闭合的 `<details>`
 *    内容仍然在 DOM 里，而 `renderToStaticMarkup` 不跑 effect、不点击。
 *    哪天有人把它改成 `useState` 开关，这里会当场红 —— 那比"肉眼看页面"
 *    更早发现"色板没有任何检查覆盖"（见组件里那段注释）。
 */
const setColorOk = (): Promise<void> => Promise.resolve();
const withPicker = render(
  baseProps({
    items: [series({ id: 's1', name: 'Row one', color: 'teal' })],
    canSetColor: true,
    onSetColor: setColorOk,
  }),
);
/*
 * ⚠️ 探针：色板提取器写坏时会返回空数组，而空数组与"13 个名字都对"在 deepEqual
 *    里**不会**混过去 —— 但如果哪天组件只渲染了一个色块，一个写坏的正则也能
 *    让断言"通过"（因为它把那一块也漏掉了）。先钉住提取器。
 */
assert.deepEqual(
  swatchLabels('<div class="series__swatches"><button aria-label="X"></button></div>'),
  ['X'],
  '色板提取器本身必须能命中',
);
assert.ok(
  withPicker.includes('<details class="series__colors"'),
  '★ 传了 `canSetColor` 就必须有选色面板（`<details>`）—— 没有它 owner 无从改起',
);
assert.ok(
  withPicker.includes(t('calendar.seriesColorSet')),
  '面板的入口要写出「改颜色」那一句（它同时是 summary 的可读名）',
);
assert.deepEqual(
  swatchLabels(withPicker),
  [
    ...SERIES_COLOR_KEYS.map((key) => t(`calendar.seriesColor.${key}`)),
    t('calendar.seriesColorNone'),
  ],
  `★ 13 个色块的 aria-label 必须是 12 个颜色名 + 「不上色」，而且按那 ${SERIES_COLOR_KEYS.length} 个键的**顺序**（"有序"是 \`SERIES_COLOR_KEYS\` 的契约）`,
);
ok('传 `canSetColor` ⇒ 面板在，13 个色块的 aria-label 顺序与词条都对');

/**
 * ⑪ ★ 反向：**不传** `canSetColor` ⇒ 整块里没有「改颜色」这句话。
 *
 * ⚠️⚠️ 反向断言最容易**假绿**：渲染炸了、或者那句话被挪到别的分支上，
 *    "找不到它"就自动成立。所以紧跟着一条**正向对照** —— 同一次运行里，
 *    传了 `canSetColor` 的那一份必须找得到同一句话。
 *    两条一起，才说明这句话的去留真的由那个 prop 决定。
 */
const withoutPicker = [readOnly, asOwner, none, some, busy, other, withDeleteError].join('');
assert.equal(
  withoutPicker.includes(t('calendar.seriesColorSet')),
  false,
  '★ 没传 `canSetColor` ⇒ **完全不渲染**选色入口（不是渲染成一个灰色按钮）',
);
assert.ok(
  withPicker.includes(t('calendar.seriesColorSet')),
  '（正向对照）同一次运行里，传了 `canSetColor` 的那一份必须找得到同一句话',
);
ok('不传 `canSetColor` ⇒ 没有选色入口（且有正向对照，不是恒真）');

/**
 * ⑫ ★ `canSetColor` 决定**入口显不显示**，`onSetColor` 决定**能不能点** ——
 *    两个判据不是一回事，所以分开验。
 *
 * ⚠️ 这个组合（传了 `canSetColor` 却没传 `onSetColor`）在容器接线出错时**真的会出现**，
 *    而那时的页面看起来完全正常：13 个色块都在，点了没反应 ——
 *    "点了没反应"比"按不动"难查得多。
 */
const noOnSetColor = render(baseProps({ items: [series({ name: 'Row one' })], canSetColor: true }));
assert.ok(
  noOnSetColor.includes('<details class="series__colors"'),
  '只有 `canSetColor` 时入口仍然要渲染（入口的判据就是它）',
);
assert.equal(
  (noOnSetColor.match(/disabled=""/g) ?? []).length,
  SERIES_COLOR_KEYS.length + 1,
  '★ 没有 `onSetColor` ⇒ 13 个色块全部禁用（`disabled` 的写法变了的话这里会红，那正是我们要知道的）',
);
ok('没有 `onSetColor` ⇒ 色块全部禁用');

/**
 * ⑫b ★★ 系列的**展开 / 收起**（2026-09-14，用户第 ② 条）
 *      —— 这一节**只覆盖渲染**，点击本身覆盖不了（见本节末尾那段边界说明）。
 *
 * 用户原话是「系列卡片点一下展开，**再点一下收起**（后者目前未做到）」。
 * "再点一下收起"这件事的**判据**（URL 里的 `seriesId` 要不要清掉）住在容器
 * （`routes/CalendarList.tsx` 的 `onSelect`）里，而那个组件这个脚本渲染不了：
 * `CalendarList` 自己取数，纯 SSR 下永远停在"加载中"（见文件头的边界说明）。
 *
 * ⇒ 这里能覆盖、也必须覆盖的是**组件这一侧的判据**：
 *   `expanded` 只有"非空 **且** `selectedId === s.id`"时才渲染出卡片。
 *   两道判据里的第二道是**收起那一半的兜底** —— 容器把 `expanded` 传成 `null`
 *   是第一道。只留第一道的话，接线写错就是"点了收起、卡片还在"，而那种错
 *   在界面上看起来和"没点"一模一样。
 */
const expandableItems = [
  series({ id: 's1', name: 'Row one' }),
  series({ id: 's2', name: 'Row two' }),
];
const twoEvents: CalendarEvent[] = [
  event({ id: 'ev-1', title: 'Event one' }),
  event({ id: 'ev-2', title: 'Event two' }),
];

/*
 * ⚠️ 探针：行状态提取器本身必须能命中。它写坏时返回空数组，而空数组在下面那些
 *    `deepEqual` 里不会混过去 —— 但报出来的会是"组件没渲染出行"，指向错的地方。
 *    先钉住它（本文件 `dots()` / `swatchLabels()` 两处都有同一条）。
 */
assert.deepEqual(
  rowStates(
    '<button type="button" class="series__item" aria-pressed="true" aria-expanded="false"><span class="series__name">X</span></button>',
  ),
  [['X', 'true', 'false']],
  '行状态提取器本身必须能命中（否则下面几条是在比空数组）',
);

/*
 * ⚠️ 这一节全部走 `renderRouted`（带 MemoryRouter），**不是**上面那个 `render`：
 *    卡片里是 `<Link to="/calendar/...">`，没有 Router 上下文时它会**抛异常**。
 *    用不带 Router 的那个渲染，接线一旦写错这里报的是 `useHref() may be used only
 *    in the context of a <Router>` —— 那句话指向的是路由，而不是"卡片该不该在"，
 *    排查方向当场就跑偏了。
 */
const collapsed = renderRouted(baseProps({ items: expandableItems }));
assert.equal(countOf(collapsed, 'series__expanded'), 0, '没选中任何系列时不该有展开块（默认态）');
assert.equal(cardLinks(collapsed), 0, '没选中任何系列时一张赛事卡片都不该有');
assert.deepEqual(
  rowStates(collapsed),
  [
    ['Row one', 'false', 'false'],
    ['Row two', 'false', 'false'],
  ],
  '★ 没选中时每一行的 `aria-expanded` 都是 false（否则读屏软件会说反）',
);
ok('★ 没选中系列 ⇒ 无展开块、零卡片、每行 `aria-expanded="false"`');

/*
 * ★★ 这一条是**"收起"在组件这一侧的等价物**：容器收起时会把 `expanded` 传成
 *    `null`，而这里**故意**传一份"已经取回来的上一次数据" + `selectedId: null`
 *    —— 模拟"容器接线写错了/晚了一拍"的那一瞬间。
 *    第二道判据（`selectedId === s.id`）必须把它挡住：用户点了收起，
 *    屏幕上就不能再留着上一次的卡片。
 */
const staleData = renderRouted(
  baseProps({
    items: expandableItems,
    selectedId: null,
    expanded: { events: twoEvents, loading: false, now: 0 },
  }),
);
assert.equal(
  countOf(staleData, 'series__expanded'),
  0,
  '★ 收起之后**不能**继续显示上一次那份展开数据 —— 即使容器一时还握着它',
);
assert.equal(
  cardLinks(staleData),
  0,
  '★ 收起之后卡片必须一张不剩（"点了收起、卡片还在"在界面上和"没点"长得一模一样）',
);
ok('★ 收起：即使 `expanded` 还握着上一份数据、`selectedId` 空了，也一张卡片都不渲染');

const expandedS1 = renderRouted(
  baseProps({
    items: expandableItems,
    selectedId: 's1',
    expanded: { events: twoEvents, loading: false, now: 0 },
  }),
);
assert.equal(
  countOf(expandedS1, 'series__expanded'),
  1,
  '★ 选中 s1 且有数据 ⇒ 有且只有**一个**展开块（两个的话说明它对每一行都展开了）',
);
assert.equal(cardLinks(expandedS1), twoEvents.length, '★ 展开块里要真的渲染出那两张赛事卡片');
assert.deepEqual(
  rowStates(expandedS1),
  [
    ['Row one', 'true', 'true'],
    ['Row two', 'false', 'false'],
  ],
  '★ `aria-expanded`（以及同源的 `aria-pressed`）必须**逐行**跟着 `selectedId`：命中的那一行 true，其它行 false',
);
assert.ok(
  expandedS1.indexOf('series__expanded') > expandedS1.indexOf('Row one') &&
    expandedS1.indexOf('series__expanded') < expandedS1.indexOf('Row two'),
  '★ 展开块必须**夹在选中那一行和下一行之间** —— 长在整块末尾的话，用户会以为点开的是别的系列',
);
ok('★ 选中 s1 ⇒ 一个展开块 + 两张卡片，且 `aria-expanded` 只有命中那一行是 true');

/*
 * ⚠️ 反向：选中**另一个**系列（且它没有数据）⇒ 一个展开块都不该有。
 *    这一条守着"展开块跟着 `selectedId` 走"的另一半：只验命中那一半的话，
 *    `expanded && true` 这种恒真写法照样能过。
 */
const selectedOther = renderRouted(
  baseProps({
    items: expandableItems,
    selectedId: 's2',
    expanded: { events: twoEvents, loading: false, now: 0 },
  }),
);
assert.equal(
  countOf(selectedOther, 'series__expanded'),
  1,
  '★ 选中 s2 ⇒ 展开块仍然只有一个（它得跟着选中项换行，不能变成两个）',
);
assert.deepEqual(
  rowStates(selectedOther),
  [
    ['Row one', 'false', 'false'],
    ['Row two', 'true', 'true'],
  ],
  '★ 换一个系列选中：`aria-expanded` 也跟着换行（成对断言两个方向）',
);
assert.ok(
  selectedOther.indexOf('series__expanded') > selectedOther.indexOf('Row two'),
  '★ 展开块必须移到 s2 那一行下面去',
);
ok('★ 换成选中 s2 ⇒ 展开块移到 s2 下面，`aria-expanded` 与选中项一起换行');

/*
 * 取数中 / 空系列这两支也顺手钉住：它们是"点一下之后的头几百毫秒"和"点开一个
 * 一场赛事都没有的系列"两种真实画面，而两者都必须**不是**一个空白块。
 */
const expanding = renderRouted(
  baseProps({
    items: expandableItems,
    selectedId: 's1',
    expanded: { events: [], loading: true, now: 0 },
  }),
);
assert.equal(
  cardLinks(expanding),
  0,
  '数据还没到时不该有卡片（拿 loading 那一份当数据的话，这里会是 0 张卡 + 一个空块）',
);
assert.ok(
  textOf(expanding).includes(norm(t('common.loading'))),
  '★ 取数中要说"加载中"，而不是渲染一个空块 —— 空块看起来像"这个系列没有赛事"',
);
ok('★ 展开取数中：说「加载中」，且没有卡片');

const emptyExpanded = renderRouted(
  baseProps({
    items: expandableItems,
    selectedId: 's1',
    expanded: { events: [], loading: false, now: 0 },
  }),
);
assert.ok(
  textOf(emptyExpanded).includes(norm(t('calendar.seriesExpandedEmpty'))),
  '★ 系列存在但一场赛事都没有时说「这个系列下暂时没有活动」那一句',
);
assert.equal(cardLinks(emptyExpanded), 0, '空系列不该有卡片');
ok('★ 空系列展开：说"这个系列下没有活动"，不是空白块、也不是"还没有系列活动"');

/*
 * ⚠️⚠️ 边界（必须写清楚，别让下一个人以为这里验过交互）：
 *    这一节**没有点击**。`renderToStaticMarkup` 不跑事件处理器，所以
 *    "点一下会不会真的把 `seriesId` 清掉"（`CalendarList.onSelect` 里那三行）
 *    **没有被任何自检覆盖** —— 它只能靠浏览器里点一次，或者容器层的测试。
 *    这里验的是：**把 props 给对了**，组件会渲染成"展开"还是"收起"。
 *    两者合起来才是那个功能；缺了容器那半，"再点一下收起"仍然可以是坏的。
 */

/**
 * ⑬ ★★ 审核详情页的时间：**多段必须全都看得见**，而且**旧快照也不能是空白**。
 *
 * ⚠️ 这一节存在的理由就是那个文件自己的头注释：手写的字段清单漏一项**不会报错**。
 *    2026-09-13 之前它读的是「开始时间 / 时区 / 结束时间 / 结束时区」四行，而时间已经
 *    搬进了 `slots` —— 于是那四行在新快照上会**全部显示成 `—`**，界面上看起来和
 *    "这一条没填时间"完全一样。审核员核对公告时，那是他能做的最重要的一件事。
 *
 * ⚠️ 多段那条是**用户原话的直接落地**（"分离的用逗号分隔"）：只显示第一段的话，
 *    "分三个周末打"和"连着打三周"在审核页上长得一模一样 —— 而这两种赛程
 *    对审核员要判断的事情（这条该不该收、时间填没填错）是完全不同的。
 */
const snapshot = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  title: 'Row one',
  titleEn: null,
  descriptionMd: '',
  startsAtTz: 'Asia/Shanghai',
  allDay: false,
  url: null,
  location: null,
  tags: ['TOURNAMENT'],
  level: 'PRO',
  scope: 'CONTINENT',
  access: 'QUALIFIER',
  scopeDetail: ['ASIA', 'OCEANIA'],
  seriesId: null,
  lang: 'zh-CN',
  ...over,
});

const multi = renderReview(
  snapshot({
    slots: [
      { startsAtLocal: '2026-09-12T20:00', endsAtLocal: '2026-09-12T23:00' },
      { startsAtLocal: '2026-09-20T20:00', endsAtLocal: null },
      { startsAtLocal: '2026-09-27T20:00', endsAtLocal: '2026-09-28T01:00' },
    ],
  }),
);
const multiText = textOf(multi);
assert.ok(
  multiText.includes(norm(t('calendar.fields.slots'))),
  '★ 审核页要有「比赛时间」这一行（那是审核员唯一能拿来和公告核对的东西）',
);
for (const day of ['2026-09-12', '2026-09-20', '2026-09-27']) {
  assert.ok(
    multiText.includes(day),
    `★ 第 ${day} 那一段必须出现在审核页上 —— 只显示第一段等于让审核员漏核对两段，而那种漏检没有任何提示`,
  );
}
assert.ok(
  multiText.includes(norm(t('calendar.fields.timezone'))),
  '时区仍然单独一行（顺带确认上面的时间不是"没有时区的裸时间"）',
);
ok('审核页把三段比赛时间**全都**显示出来了');

/*
 * ⚠️ 旧快照（017 之前提交、还没审的事件在线上**真的存在**）：时间只在
 *    `startsAtLocal` / `endsAtLocal` 那一对上。这一条守的是那份兜底 ——
 *    没有它，那种快照在审核页上会是"一个没有时间的活动"。
 */
const legacyText = textOf(
  renderReview(snapshot({ startsAtLocal: '2026-09-12T20:00', endsAtLocal: '2026-09-12T23:00' })),
);
for (const piece of ['2026-09-12', '20:00', '23:00']) {
  assert.ok(legacyText.includes(piece), `★ 旧快照（没有 slots）的时间也要看得见，缺了「${piece}」`);
}
ok('017 之前的旧快照（只有 startsAtLocal/endsAtLocal）照样显示时间');

/**
 * ⑭ ★ 审核页的枚举与"查不到名字的系列"。
 *
 * ⚠️ 「参与范围明细」必须**按 `scope` 换前缀**：写死 `country` 的话这里会显示成
 *    `calendar.country.ASIA`（i18next 对未知 key 是**原样返回**的，不报错）。
 * ⚠️ 系列名要等一次网络往返，而纯 SSR **不跑 effect** ⇒ 这里只能验到"查不到时
 *    显示 id 本身"那一支。名字真的查出来的那一支**没有被任何自检覆盖** ——
 *    边界写清楚，免得下一个人以为这条验过"名字显示得对"。
 */
assert.ok(
  multiText.includes(norm(t('calendar.access.QUALIFIER'))),
  '★ 参赛门槛要翻成人话（不是原始枚举值 `QUALIFIER`）',
);
for (const key of ['ASIA', 'OCEANIA']) {
  assert.ok(
    multiText.includes(norm(t(`calendar.continent.${key}`))),
    `★ 范围明细里的大洲代码 ${key} 必须翻成人话 —— 前缀由 scope 决定，写死 country 会原样印出裸 key`,
  );
}
assert.equal(
  multi.includes('calendar.continent.'),
  false,
  '★ 不许出现裸 key（写死了错的前缀时，它就会原样印在页面上 —— 见上面那条）',
);
const unresolved = renderReview(snapshot({ seriesId: 's-xyz' }));
assert.ok(
  unresolved.includes('s-xyz') && unresolved.includes('reviewview__raw'),
  '★ 系列名查不到时显示 **id 本身**（并标成原始值），而不是留空 —— 空白会让人以为这一条没有系列',
);
ok('审核页的枚举翻了人话，系列名查不到时显示 id 本身');

/**
 * ⑮ 裸 key 泄漏（打错一个字母就会以 `calendar.xxx` 的形式露在界面上）。
 */
const all = [
  readOnly,
  asOwner,
  none,
  some,
  busy,
  other,
  withDeleteError,
  colored,
  withPicker,
  noOnSetColor,
  /*
   * ⚠️ 展开 / 收起那一节（⑫b）的产物**也要并进来**：泄漏扫描与第 ⑯ 条
   *    "英文界面零汉字"都只扫这个数组。展开块里渲染的是**真的卡片**
   *    （`CalendarCard`）—— 它是本脚本第一次把卡片渲进样本集，
   *    不并进来的话，卡片那一堆词条在这份自检里等于没被看过。
   */
  collapsed,
  staleData,
  expandedS1,
  selectedOther,
  expanding,
  emptyExpanded,
  multi,
  unresolved,
].join('');
const leaked = [...new Set(all.match(/calendar\.[A-Za-z]+/g) ?? [])];
assert.deepEqual(leaked, [], `裸 key 泄漏：${leaked.join(', ')}`);

/*
 * ⚠️ 探针：泄漏扫描器本身必须能命中一个明显不存在的 key，否则它是恒真的
 *    （本仓在 `liverender.tsx` 里为同一件事写过注释）。
 */
assert.notEqual(
  /calendar\.[A-Za-z]+/.test('calendar.seriesDeleteNope'),
  false,
  '泄漏扫描器本身必须能命中（否则上面那条断言是恒真的空跑）',
);
ok('渲染结果里没有裸 key 泄漏（且扫描器本身能命中）');

/** ⑯ ★ 英文模式：栏目里零汉字。 */
if (LANG === 'en') {
  const han = textOf(all).match(/[\u4e00-\u9fff]+/g) ?? [];
  assert.deepEqual(han, [], `英文界面里出现了中文：${han.slice(0, 8).join(' / ')}`);
  ok('英文界面里零汉字');
}

console.log('');
console.log(`通过 ${pass} 项。`);
console.log('');
console.log('⚠️ 这个脚本验的是**渲染**：没有点击、没有请求、也没有权限判断。');
console.log('   删除本身（级联、隔离、403/401/404、审计、impact 的计数口径）');
console.log('   在 services/api/src/calendar-series-delete.test.ts 里，那 10 条是真打 HTTP 的。');
