#!/usr/bin/env tsx
/**
 * 系列活动栏目（`CalendarSeriesSection`）与**删除确认**的渲染断言。
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
 * 一个**不可逆**的删除入口，和一句**必须点名代价**的确认文案。
 *
 * ---------------------------------------------------------------------------
 * ★★ 这个脚本真正守的那一条：确认框里的数字
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
 * 这个脚本验的是**把 props 给对了会渲染成什么样**。它**不验**：点击、请求、
 * 权限判断、以及"点了之后到底删没删" —— 那些在服务端测试
 * （`services/api/src/calendar-series-delete.test.ts`，10 条）与浏览器层。
 * 渲染自检与那两份证据是互补的，不是替代关系。
 */
import assert from 'node:assert/strict';
import type { CalendarSeries } from '@mcsr/shared/calendar';
import { en, zhCN } from '@mcsr/shared/i18n';
import i18n from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';

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

let pass = 0;
const ok = (m: string): void => {
  pass += 1;
  console.log(`  ✓ ${m}`);
};

function series(over: Partial<CalendarSeries> = {}): CalendarSeries {
  return {
    id: 's1',
    name: 'MCSR Ranked Playoffs',
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
 *    下面第 ⑨ 条要断言"英文界面里零汉字"，而系列名是**数据**、
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
 * ⑧ 裸 key 泄漏（打错一个字母就会以 `calendar.xxx` 的形式露在界面上）。
 */
const all = [readOnly, asOwner, none, some, busy, other, withDeleteError].join('');
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

/** ⑨ ★ 英文模式：栏目里零汉字。 */
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
