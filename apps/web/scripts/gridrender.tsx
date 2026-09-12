/**
 * 月历表 + 筛选栏的**渲染**自检。
 *
 * 跑法（从仓库根）：
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:grid
 *
 * ⚠️ 它必须住在 `apps/web/scripts/` 下，**不能**挪到 `.cache/`：
 *    `.cache/` 在仓库根部，从那里 `import 'react'` 解析不到
 *    （react 装在 `apps/web/node_modules`，Node 只往上层目录找）。
 *    试过，报的是 `Cannot find package 'react'` —— 看起来像依赖没装，
 *    其实是文件位置的问题。
 *
 * ---------------------------------------------------------------------------
 * 为什么用服务端渲染（SSR）而不是无头浏览器
 * ---------------------------------------------------------------------------
 * 写这个脚本的时候 5173 上有一个别人起的 dev server（而且它随时可能被
 * 文件监听的竞态搞崩，见 docs/pending.md 5.7），不该再起一个去抢端口。
 * 但"能不能渲染出来"这件事**不需要浏览器**：`renderToStaticMarkup` 会把组件
 * 真的跑一遍（含 hooks、JSX、i18n 取值），产出的 HTML 就是最好的证据。
 *
 * 它验不到的是**交互**（点击、键盘、View Transition 动画）——
 * 那些要等 dev server 起来之后用浏览器补。这个界线在这里说清楚，
 * 免得把"渲染通过"当成"功能都验过了"。
 *
 * ---------------------------------------------------------------------------
 * 最有价值的一条：**词条 key 漏了会看得出来**
 * ---------------------------------------------------------------------------
 * i18next 对查不到的 key 的行为是**原样返回 key** —— 界面上就会出现
 * `calendarGrid.viewMonth` 这种字符串，而它不报错、类型也查不出来。
 * 所以下面直接扫产物里有没有残留的 `calendarGrid.` / `calendar.` 前缀。
 */
import assert from 'node:assert/strict';
import { zhCN } from '@mcsr/shared/i18n';
import i18n from 'i18next';
/*
 * ⚠️ tsx 对这个脚本用的是**经典** JSX 运行时（`React.createElement`），
 *    所以即便 tsconfig 里写着 `"jsx": "react-jsx"`，这里也必须显式引入 React。
 *    不引的话报的是 `ReferenceError: React is not defined`，指到第一处 JSX 上 ——
 *    看起来像组件坏了，其实只是这个脚本的编译选项。
 *
 * ⚠️⚠️ 必须写成 `import React`（值导入），**不能**让 biome 把它改成
 *    `import type React`。那个规则（`useImportType`）在普通组件里是对的
 *    （自动运行时不需要值导入），但它看不见"这个文件走经典运行时"这件事 ——
 *    自动修一次，这个脚本就直接崩，而报错指向第一处 JSX，和 lint 毫无关联。
 *    所以这里显式关掉那一条，并把理由写在这里。
 */
// biome-ignore lint/style/useImportType: 这个脚本走经典 JSX 运行时，React 必须是值导入（见上面的说明）
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';

import { CalendarDayPanel } from '@/components/CalendarDayPanel';
import { CalendarFilters } from '@/components/CalendarFilters';
import { buildGridCells, CalendarGrid, todayKeyInViewerTz } from '@/components/CalendarGrid';

const LANG = process.argv.includes('--en') ? 'en' : 'zh-CN';

await i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    en: { translation: (await import('@mcsr/shared/i18n')).en },
  },
  lng: LANG,
  fallbackLng: 'zh-CN',
  interpolation: { escapeValue: false },
  returnNull: false,
  react: { useSuspense: false },
});

let pass = 0;
const ok = (m: string): void => {
  pass += 1;
  console.log(`  ✓ ${m}`);
};

const YM = { year: 2026, month: 11 };

/** 一个形状完整的事件 —— 少一个字段渲染就可能悄悄少一块。 */
function event(over: Record<string, unknown> = {}): never {
  return {
    id: 'e1',
    title: '测试赛事',
    titleEn: null,
    descriptionMd: '',
    startsAtLocal: '2026-11-14T20:00',
    startsAtTz: 'Asia/Shanghai',
    startsAtUtc: Date.UTC(2026, 10, 14, 12, 0),
    endsAtLocal: null,
    endsAtTz: null,
    endsAtUtc: null,
    allDay: false,
    url: null,
    location: null,
    tags: ['TOURNAMENT'],
    stage: null,
    level: null,
    scope: null,
    lang: 'zh-CN',
    authorId: null,
    authorName: null,
    status: 'published',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as never;
}

const html = (node: React.ReactElement): string =>
  renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

const countOf = (s: string, needle: string): number => s.split(needle).length - 1;

// ---------------------------------------------------------------------------
console.log(`【${LANG}】① 网格结构`);
// ---------------------------------------------------------------------------
const cells = buildGridCells(YM);
const today = todayKeyInViewerTz();

const gridHtml = html(
  <CalendarGrid
    ym={YM}
    events={[
      event({ id: 'a', tags: ['TOURNAMENT'] }),
      event({ id: 'b', tags: ['COMMUNITY'], startsAtUtc: Date.UTC(2026, 10, 14, 13, 0) }),
      /*
       * ⚠️ 11-15 这五条**必须同时改 `startsAtLocal`**。
       *
       * 分桶用的是 `startsAtLocal`（事件自己的日期），排序用的才是 `startsAtUtc`。
       * 第一版只改了 `startsAtUtc`，于是它们全都落回模板默认的 11-14，
       * 而 11-14 变成 7 条 → "+4" 而不是 "+2"。
       * 这已经是这个脚本里第二次犯同一类错：**没有变化那个被代码真正读取的字段**。
       * （上一次是排序断言：三条的 `startsAtUtc` 都是 0，断言退化成恒真。）
       */
      ...Array.from({ length: 5 }, (_, i) =>
        event({
          id: `many-${String(i)}`,
          startsAtLocal: `2026-11-15T0${String(i + 1)}:00`,
          startsAtUtc: Date.UTC(2026, 10, 15, i + 1, 0),
        }),
      ),
    ]}
    selected={null}
    today={today}
    now={Date.UTC(2026, 10, 20)}
    onSelect={() => {}}
  />,
);

assert.equal(countOf(gridHtml, 'grid__weekday'), 7, '星期表头应当是 7 个');
ok('7 个星期表头');

assert.equal(countOf(gridHtml, 'data-grid-date='), cells.length, `格子数应当是 ${cells.length}`);
ok(`${cells.length} 个日期格子（${cells.length / 7} 行，与日期算术一致）`);

assert.equal(countOf(gridHtml, 'grid__day--outside'), cells.filter((c) => !c.inMonth).length);
ok('相邻月份的补白格被标出来（变暗）');

assert.equal(countOf(gridHtml, 'grid__day--skeleton'), 0, '真实网格里不该有骨架格');
ok('没有残留的骨架标记');

// "+N" 只应出现在有 5 条的那一天
assert.equal(countOf(gridHtml, 'grid__more'), 1, '只有 11-15 那天超过 3 条');
assert.ok(/\+2/.test(gridHtml), '5 条应当收成 3 条 + "+2"');
ok('★ 超过 3 条收成「+2」（格子里不堆文字）');

// 枚举原始值绝不能出现在可见文本里
for (const raw of ['TOURNAMENT', 'COMMUNITY', 'RANKED_MILESTONE']) {
  assert.equal(
    new RegExp(`>\\s*${raw}\\s*<`).test(gridHtml),
    false,
    `可见文本里出现了枚举原始值 ${raw}`,
  );
}
ok('★ 可见文本里没有 TOURNAMENT / COMMUNITY 这类枚举原始值（都走了词条）');

// ---------------------------------------------------------------------------
console.log(`【${LANG}】② 今天 / 选中 / 过去`);
// ---------------------------------------------------------------------------
/*
 * ⚠️ 这里用**今天所在的月份**单独渲染一次，因为 YM 是写死的 2026-11，
 *    而"今天"是运行时的日期 —— 两者不同月的话 `--today` 永远不会出现，
 *    那条断言就会变成一个恒真的空检查。
 */
const todayParsed = { year: 2026, month: 11 };
const todayCell = today.startsWith('2026-11') ? today : null;
const gridTodayHtml = html(
  <CalendarGrid
    ym={todayParsed}
    events={[event({ id: 'x' })]}
    selected="2026-11-14"
    today={todayCell ?? '2026-11-20'}
    now={Date.UTC(2026, 10, 20)}
    onSelect={() => {}}
  />,
);
assert.equal(countOf(gridTodayHtml, 'grid__day--today'), 1, '今天应当只标一个格子');
ok('「今天」只标一个格子');

assert.equal(countOf(gridTodayHtml, 'grid__day--selected'), 1, '选中应当只标一个格子');
assert.ok(/aria-pressed="true"/.test(gridTodayHtml), '选中的格子要 aria-pressed');
ok('「选中」只标一个格子，且带 aria-pressed');

assert.ok(countOf(gridTodayHtml, 'grid__day--past') > 0, '2026-11-20 之前的日子应当变暗');
ok('过去的日子变暗（不是隐藏 —— 隐藏会在网格上打洞）');

// ---------------------------------------------------------------------------
console.log(`【${LANG}】③ 当天面板`);
// ---------------------------------------------------------------------------
/*
 * ⚠️ 数卡片要数**每张卡唯一的那个东西** —— 指向详情页的链接。
 *    第一版数的是字符串 `'calendar-card'`，而它同时匹配 `calendar-card__when`、
 *    `calendar-card__body`、`calendar-card__title`…… 于是一张卡被数成四五个，
 *    而断言里的数字看起来"差不多对"。那是最糟的一类测试：它测的不是它说的东西。
 */
const cardCount = (s: string): number =>
  // ⚠️ 必须排除 `/calendar/submit` —— 那是「在这天加活动」的链接，
  //    它和卡片的链接一样以 `href="/calendar/` 开头。
  //    不排除的话，有提交入口时会多算一张卡（第一次跑出来 3 而不是 2）。
  (s.match(/href="\/calendar\/(?!submit)/g) ?? []).length;

const panelEmpty = html(
  <CalendarDayPanel day="2026-11-14" events={[]} now={0} canSubmit={false} />,
);
assert.ok(panelEmpty.includes('2026'), '标题里应当有年份');
assert.equal(cardCount(panelEmpty), 0, '空状态不该有卡片');
ok('没有活动时显示空状态，不显示卡片');

const panelWith = html(
  <CalendarDayPanel
    day="2026-11-14"
    events={[event({ id: 'p1' }), event({ id: 'p2' })]}
    now={0}
    canSubmit
  />,
);
assert.equal(cardCount(panelWith), 2, '两条活动应当渲染两张卡片');
assert.ok(
  panelWith.includes('/calendar/submit?date=2026-11-14'),
  '「在这天加活动」必须带上日期（表单靠它预填）',
);
ok('★ 「在这天加活动」指向 /calendar/submit?date=2026-11-14（复用真正的表单）');

const panelAnon = html(
  <CalendarDayPanel day="2026-11-14" events={[event({ id: 'p1' })]} now={0} canSubmit={false} />,
);
assert.equal(panelAnon.includes('/calendar/submit'), false, '未登录时不该出现提交入口');
ok('未登录时不给「加活动」入口（看得见点不动比看不见更糟）');

const panelNoDay = html(<CalendarDayPanel day={null} events={[]} now={0} canSubmit={false} />);
assert.equal(cardCount(panelNoDay), 0);
ok('没选中任何一天时显示提示，不显示卡片');

// ---------------------------------------------------------------------------
console.log(`【${LANG}】④ 筛选栏：四个维度，两个种类`);
// ---------------------------------------------------------------------------
const filtersHtml = html(
  <CalendarFilters
    tags={['TOURNAMENT', 'COMMUNITY', 'RANKED_MILESTONE']}
    onToggleTag={() => {}}
    level={null}
    scope={null}
    stage={null}
    onPick={() => {}}
    dirty={false}
    onReset={() => {}}
  />,
);

assert.equal(countOf(filtersHtml, '<fieldset'), 4, '四个维度各一个 fieldset');
ok('4 个维度各是一个 fieldset（HTML 原生分组，不是手写 ARIA）');

assert.equal(countOf(filtersHtml, '<legend'), 4, '每个 fieldset 都要有 legend');
ok('每个维度都有 legend（组名）');

// 标签 3 个 + 三个单选维度各 1(不限)+取值数
/*
 * ⚠️ 数的是 `aria-pressed=`，不是 `tagchip`。
 *    选中的 chip 渲染成 `class="tagchip tagchip--on"` —— 里面 `tagchip`
 *    出现了**两次**，于是按子串数会把 20 个数成 26。
 *    要数控件就数一个控件身上只出现一次的东西；`aria-pressed` 每个 chip 恰好一个。
 */
assert.equal(
  countOf(filtersHtml, 'aria-pressed='),
  3 + (1 + 4) + (1 + 4) + (1 + 6),
  'chip 总数应为 20',
);
ok('chip 总数 = 标签 3 + 专业程度 5 + 参与范围 5 + 轮次 7 = 20');

// 三个单选维度都是"不限"选中（current === null）
assert.equal(
  countOf(filtersHtml, 'aria-pressed="true"'),
  3 + 3,
  '三个维度各有一个"不限"亮着，加上三个标签全选',
);
ok('三个单选维度的默认都是「不限」，而不是"没选"（两者含义相反）');

assert.equal(filtersHtml.includes('filters__clear'), false, '默认状态不该显示"清空筛选"');
ok('没有筛选时不给「清空筛选」（一个点了没反应的按钮比没有更糟）');

// ---------------------------------------------------------------------------
console.log(`【${LANG}】⑤ ★ 词条：漏 key 会以原始 key 的形式出现在界面上`);
// ---------------------------------------------------------------------------
const all = gridHtml + panelWith + filtersHtml + panelEmpty + gridTodayHtml + panelAnon;
const leaks = [...all.matchAll(/(calendarGrid|calendar|resources)\.[a-zA-Z]+/g)]
  .map((m) => m[0])
  // aria-label / title 之外的属性里的路径不算（比如 /calendar/submit 是路由）
  .filter((s) => !s.startsWith('calendar.submit'))
  // 路由路径 `/calendar/submit` 与 `/calendar/xxx` 会匹配到 calendar.xxx？不会 —— 路径用 / 分隔
  .filter((s) => !/^resources\.(prevPage|page|nextPage)$/.test(s));
if (leaks.length > 0) {
  console.log('    泄漏的 key：', [...new Set(leaks)].join(', '));
}
assert.deepEqual(leaks, [], '界面上出现了没有对应词条的 key');
ok('没有词条 key 泄漏（i18next 对未知 key 是原样返回，不报错）');

// 关键文案确实渲染出来了
assert.ok(filtersHtml.length > 500, '筛选栏有内容');
assert.ok(
  LANG === 'zh-CN' ? filtersHtml.includes('不限') : filtersHtml.includes('Any'),
  '「不限」这一项渲染出来了',
);
ok(`「不限」渲染出来了（${LANG === 'zh-CN' ? '不限' : 'Any'}）`);

console.log('');
console.log(`通过 ${pass} 项。`);
console.log('');
console.log('⚠️ 这个脚本验的是**渲染**，不是交互：点击、方向键、View Transition');
console.log('   动画都没有被验到 —— 那些需要 dev server + 浏览器。');
