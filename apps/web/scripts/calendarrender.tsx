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
import type { CalendarSeries } from '@mcsr/shared/calendar';
import { en, zhCN } from '@mcsr/shared/i18n';
import type { QueueItem, ReviewDetail } from '@mcsr/shared/review';
import i18n from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';

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
