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
import { CONTINENTS, COUNTRIES, EVENT_ACCESS } from '@mcsr/shared';
import type { UserSelf } from '@mcsr/shared/auth';
// 系列的形状（需求③）—— 与 `event()` 那个 fixture 同理：字段要齐全
import type { CalendarEvent, CalendarSeries } from '@mcsr/shared/calendar';
import { zhCN } from '@mcsr/shared/i18n';
import type { ResourceListItem } from '@mcsr/shared/resources';
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

import { CalendarCard } from '@/components/CalendarCard';
import { CalendarDayPanel } from '@/components/CalendarDayPanel';
import { CalendarFilters } from '@/components/CalendarFilters';
import {
  CalendarForm,
  calendarEventInputOf,
  emptyCalendarDraft,
  SeriesErrorNote,
} from '@/components/CalendarForm';
import {
  buildGridCells,
  CalendarGrid,
  eventDateRanges,
  eventsByDate,
  todayKeyInViewerTz,
} from '@/components/CalendarGrid';
import { CalendarSeriesSection } from '@/components/CalendarSeriesSection';
import { ResourceCard } from '@/components/ResourceCard';
import { AuthProvider } from '@/lib/auth';

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
function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
  /*
   * ⚠️ `slots` **默认从包络派生**（`startsAtLocal` / `endsAtLocal` / 那两个 UTC），
   *    而不是写死一段。真实数据里就是"slots 是源、包络是派生"，反过来
   *    （只改包络、不改 slots）会让下面 11-15 那五条 fixture 在摊平时**全部落回
   *    11-14** —— 于是 "+2" 那条断言会因为一个和它无关的原因失败，
   *    而"某一天多出几条"看起来完全正常，没人会怀疑是 fixture 的问题。
   *    要造多段就**显式传 `slots`**（见下面那些三段 / 重叠的 fixture）。
   */
  const startsAtLocal = over.startsAtLocal ?? '2026-11-14T20:00';
  const endsAtLocal = over.endsAtLocal ?? null;
  const startsAtUtc = over.startsAtUtc ?? Date.UTC(2026, 10, 14, 12, 0);
  const endsAtUtc = over.endsAtUtc ?? null;
  return {
    id: 'e1',
    title: '测试赛事',
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

const html = (node: React.ReactElement): string =>
  renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

/**
 * ★ 带**注入登录态**的渲染（t17 验收第 9 条）—— 这是本脚本唯一能渲出
 * "已登录的 editor" 那条路的办法。
 *
 * ⚠️ 为什么必须注入：`useAuth` 在 Provider 外**直接 throw**（`lib/auth.tsx:83`），
 *    而 `renderToStaticMarkup` 下 `useEffect` 不跑 ⇒ 真 Provider 的 `fetchMe()` 永远不会
 *    完成，`loading` 会停在 `true`。而 `AuthProvider` 的 `initialUser` 注入会把 `loading`
 *    直接置为 `false` —— 否则拍到的快照永远是"加载中"那一屏，断言就成了**假绿**。
 *
 * ⚠️ 注入的只是一个**用户对象**（`UserSelf`），不是伪造 context：`loading`/`refresh`/
 *    `setUser` 仍由真实 Provider 提供。少一个能绕开真实形状的口子。
 */
const htmlAs = (user: UserSelf, node: React.ReactElement): string =>
  renderToStaticMarkup(
    <AuthProvider initialUser={user}>
      <MemoryRouter>{node}</MemoryRouter>
    </AuthProvider>,
  );

/**
 * 一个形状完整的**系列**（需求③）—— 字段一个都不能少：少一个会让渲染悄悄少一块，
 * 而"少了一块"很难在一个绿色断言里看出来。
 *
 * ⚠️ `nextStartsAtUtc` 给的是**固定时刻**，不是 `Date.now() + …`：后者会让
 *    断言里的期望值（如果有）每次运行都不同。这里只断言"有没有渲染出来"，
 *    但固定值仍然是对的习惯 —— 下一个人要加一条"时间显示成 XX"时不用先改数据。
 */
function series(over: Partial<CalendarSeries> = {}): CalendarSeries {
  return {
    id: 's0',
    name: '测试系列',
    /*
     * ⚠️ `color` 必须在这里给一个值：它决定「系列活动」左边那个小点的颜色，
     *    而 `null` 是"没上色"（白色 + 描边）那一档。缺了它，渲染出来的是
     *    `undefined` —— 看起来只是"没颜色"，不会报错。
     */
    color: null,
    count: 1,
    pastCount: 0,
    nextStartsAtUtc: Date.UTC(2026, 10, 20, 12),
    createdBy: null,
    createdAt: 0,
    ...over,
  };
}

const countOf = (s: string, needle: string): number => s.split(needle).length - 1;

/**
 * 一个形状完整的**资源库列表项**（需求⑤ 的渲染断言用）。
 *
 * ⚠️ 字段必须齐全：`ResourceListItem` 是**列表项**（不含 `body`），
 *    和 `ResourceDetail` 不是一回事 —— 少一个字段这里会直接编译报错，
 *    这正是要的效果（而不是渲染时悄悄少一块）。
 */
function resourceItem(over: Partial<ResourceListItem> = {}): ResourceListItem {
  return {
    id: 'r1',
    kind: 'website',
    title: '一个资料',
    titleEn: null,
    url: 'https://example.com/',
    imageUrl: null,
    summary: '一句话简介',
    lang: 'zh-CN',
    tags: ['tools'],
    featured: false,
    official: false,
    status: 'published',
    createdAt: 0,
    updatedAt: 0,
    rating: { average: null, count: 0 },
    favoriteCount: 0,
    ...over,
  };
}

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
console.log(`【${LANG}】③b 日期横线的颜色 = 系列色（需求⑤）`);
// ---------------------------------------------------------------------------
/*
 * ⚠️ 断言必须落在**具体哪一格**上。整份 HTML `includes('#d9534f')` 那种写法
 *    在这里抓不到两种真实失效：横线画到了别的日子上、或者颜色来自别的元素。
 *    所以先把网格切成一格一格，再在格子内部断言。
 */
function cellOf(grid: string, date: string): string {
  const at = grid.indexOf(`data-grid-date="${date}"`);
  /*
   * ⚠️ 找不到就**当场失败**，而不是返回空串：空串里当然"没有横线"，
   *    于是下面那些断言会因为**错误的原因**通过 —— 那是最难发现的一类假绿。
   */
  assert.notEqual(at, -1, `${date} 这一格应当存在（否则下面的断言是在空字符串上做的）`);
  const rest = grid.slice(at);
  const next = rest.indexOf('data-grid-date="', 1);
  return next === -1 ? rest : rest.slice(0, next);
}

/** 这段 HTML 里有几条日期横线。 */
const barsIn = (fragment: string): number =>
  // ⚠️ 必须带边界：容器 `grid__bars` 也以 `grid__bar` 开头，按子串数会把容器也算一条。
  (fragment.match(/class="grid__bar(?=[" ])/g) ?? []).length;

const nowLate = Date.UTC(2026, 10, 20);

const redGrid = html(
  <CalendarGrid
    ym={YM}
    events={[event({ id: 'red-1', seriesId: 's-red', seriesColor: 'red' })]}
    selected={null}
    today={today}
    now={nowLate}
    onSelect={() => {}}
  />,
);
const redCell = cellOf(redGrid, '2026-11-14');
assert.equal(barsIn(redCell), 1, '11-14 应当有且只有一条横线');
assert.ok(
  /<span class="grid__bar[^"]*"[^>]*style="background:#d9534f"><\/span>/.test(redCell),
  '★ 属于 red 系列的事件，格子里那条横线的 style 必须带 #d9534f（断言的是色值本身，不是"有 style"）',
);
ok('★ ① 属于 red 系列的事件：日期横线的 style 是 #d9534f');

const plainGrid = html(
  <CalendarGrid
    ym={YM}
    events={[event({ id: 'plain-1' })]}
    selected={null}
    today={today}
    now={nowLate}
    onSelect={() => {}}
  />,
);
const plainCell = cellOf(plainGrid, '2026-11-14');
assert.equal(barsIn(plainCell), 1, '11-14 应当有且只有一条横线');
assert.ok(
  /*
   * ⚠️ 类名里 `grid__bar--none` 后面**还可能有别的修饰**（已结束的 `--past`、
   *    将来加的更多），所以收尾用 `[^"]*"` 而不是 `"` —— 第一版写死了引号，
   *    于是"没系列的已结束事件"这条断言直接红在了正则上，
   *    而它看起来像"组件没加那个类"。
   */
  /<span class="grid__bar[^"]*grid__bar--none[^"]*"[^>]*style="background:#ffffff"><\/span>/.test(
    plainCell,
  ),
  '★ 没有系列的事件 = 白色 + `grid__bar--none`，**两样都要**：只有白色时，白天主题下这条线等于没画（描边挂在那两个类上）',
);
ok('★ ② 没有系列的事件：横线是 #ffffff **且**带 grid__bar--none（描边靠它才看得见）');

// ---------------------------------------------------------------------------
console.log(`【${LANG}】③c 多段事件：**逐段**摊平，不按包络涂满（需求④）`);
// ---------------------------------------------------------------------------
/*
 * ★ 用户第 ④ 条要的是「不要看起来连着打十几天」。而 `startsAtLocal` /
 *   `endsAtLocal` 在多段之后是**包络**（最早那段的开始 / 最晚那段的结束）——
 *   按包络摊平，一条"分三个周末打"的赛事会把中间的空档**也涂满**，
 *   正好变成用户不要的那个样子，而界面上看起来完全正常。
 *
 * ⚠️ fixture 用的是**真实的那条数据**（`hist-playoffs-s08`：`08-23` /
 *    `08-30~08-31` / `09-06~09-10`，见 docs/own-db-facts.md 那一类记录），
 *    所以这条断言和"我在线上看到的那场季后赛到底长什么样"是同一件事。
 */
const threeSlot = event({
  id: 'hist-playoffs-s08',
  startsAtLocal: '2025-08-23T20:00',
  startsAtUtc: Date.UTC(2025, 7, 23, 12),
  endsAtLocal: '2025-09-10T22:00',
  endsAtUtc: Date.UTC(2025, 8, 10, 14),
  slots: [
    {
      startsAtLocal: '2025-08-23T20:00',
      endsAtLocal: null,
      startsAtUtc: Date.UTC(2025, 7, 23, 12),
      endsAtUtc: null,
    },
    {
      startsAtLocal: '2025-08-30T20:00',
      endsAtLocal: '2025-08-31T22:00',
      startsAtUtc: Date.UTC(2025, 7, 30, 12),
      endsAtUtc: Date.UTC(2025, 7, 31, 14),
    },
    {
      startsAtLocal: '2025-09-06T20:00',
      endsAtLocal: '2025-09-10T22:00',
      startsAtUtc: Date.UTC(2025, 8, 6, 12),
      endsAtUtc: Date.UTC(2025, 8, 10, 14),
    },
  ],
});

/*
 * ★ 先把**逐段摊平**这件事本身断言掉（`eventDateRanges` 是它的唯一入口）：
 *   三段就是**三个区间**，而且第二段是 `08-30~08-31` 这个闭区间 ——
 *   不是被包络撑成 `08-23~09-10` 的一条。
 *   ⚠️ 上面那些"某一天没有横线"的断言守的是结果，这一条守的是**判据**，
 *      两条一起才能在"渲染恰好对了但数据其实错了"时说得清是哪里错。
 */
assert.deepEqual(
  eventDateRanges(threeSlot),
  [
    { from: '2025-08-23', to: '2025-08-23' },
    { from: '2025-08-30', to: '2025-08-31' },
    { from: '2025-09-06', to: '2025-09-10' },
  ],
  '★ 三段事件必须给出三个区间（按包络摊平只会给出一个 08-23~09-10）',
);
ok('★ eventDateRanges：三段 → 三个区间，段之间的空档不在里面');

const gridOf = (ym: { year: number; month: number }, events: CalendarEvent[]): string =>
  html(
    <CalendarGrid
      ym={ym}
      events={events}
      selected={null}
      today=""
      now={Date.UTC(2025, 6, 1)}
      onSelect={() => {}}
    />,
  );

const augGrid = gridOf({ year: 2025, month: 8 }, [threeSlot]);
assert.equal(barsIn(cellOf(augGrid, '2025-08-23')), 1, '第一段的第一天必须有横线');
for (let d = 24; d <= 29; d += 1) {
  assert.equal(
    barsIn(cellOf(augGrid, `2025-08-${String(d)}`)),
    0,
    `2025-08-${String(d)} 落在两段之间，**不该**有横线（按包络摊平时它会有）`,
  );
}
assert.equal(barsIn(cellOf(augGrid, '2025-08-30')), 1, '第二段的第一天要有横线');
assert.equal(barsIn(cellOf(augGrid, '2025-08-31')), 1, '第二段的最后一天要有横线（闭区间）');
ok('★ 2025-08：08-23 有、08-24~08-29 空档一条都没有、08-30 / 08-31 有');

const sepGrid = gridOf({ year: 2025, month: 9 }, [threeSlot]);
for (let d = 1; d <= 5; d += 1) {
  assert.equal(
    barsIn(cellOf(sepGrid, `2025-09-0${String(d)}`)),
    0,
    `2025-09-0${String(d)} 落在空档里，不该有横线`,
  );
}
for (const day of ['06', '07', '08', '09', '10']) {
  assert.equal(barsIn(cellOf(sepGrid, `2025-09-${day}`)), 1, `2025-09-${day} 属于第三段`);
}
assert.equal(
  barsIn(cellOf(sepGrid, '2025-09-11')),
  0,
  '第三段到 09-10 为止（闭区间），09-11 不该有',
);
ok('★ 2025-09：09-01~09-05 空档没有横线、09-06~09-10 有、09-11 没有');

// ---------------------------------------------------------------------------
console.log(`【${LANG}】③d 两段压在同一天：只画一条横线、只印一张卡片`);
// ---------------------------------------------------------------------------
/*
 * ⚠️ 这是"数据正常时永远看不出来"的那一类分支：两段重叠（夏令时那天切换出来的
 *    相邻段、或者手填的两段落在同一天）时，逐段往桶里 push 会让那一天的格子里
 *    凭空多出一条横线（像有两个活动），面板里同一张卡片印两遍。
 */
const overlap = event({
  id: 'overlap-1',
  startsAtLocal: '2026-11-14T10:00',
  startsAtUtc: Date.UTC(2026, 10, 14, 2),
  slots: [
    {
      startsAtLocal: '2026-11-14T10:00',
      endsAtLocal: '2026-11-14T12:00',
      startsAtUtc: Date.UTC(2026, 10, 14, 2),
      endsAtUtc: Date.UTC(2026, 10, 14, 4),
    },
    {
      startsAtLocal: '2026-11-14T20:00',
      endsAtLocal: null,
      startsAtUtc: Date.UTC(2026, 10, 14, 12),
      endsAtUtc: null,
    },
  ],
});
const overlapGrid = html(
  <CalendarGrid
    ym={YM}
    events={[overlap]}
    selected={null}
    today={today}
    now={nowLate}
    onSelect={() => {}}
  />,
);
assert.equal(barsIn(cellOf(overlapGrid, '2026-11-14')), 1, '两段同一天 → 只画**一条**横线');
ok('★ 两段压在同一天：格子里只有一条横线（不是两条）');

const overlapDayEvents = eventsByDate([overlap]).get('2026-11-14') ?? [];
assert.equal(overlapDayEvents.length, 1, '两段同一天 → 这一天的事件列表里只有一条');
const overlapPanel = html(
  <CalendarDayPanel day="2026-11-14" events={overlapDayEvents} now={nowLate} canSubmit={false} />,
);
assert.equal(cardCount(overlapPanel), 1, '两段同一天 → 面板里只印**一张**卡片');
ok('★ 两段压在同一天：面板里只有一张卡片（同一场活动印两遍非常像数据重复）');

// ---------------------------------------------------------------------------
console.log(`【${LANG}】③e 卡片：第一段时间 + 段数徽章 + 三个维度（需求⑥）`);
// ---------------------------------------------------------------------------
const threeSlotCard = html(
  <ul>
    <CalendarCard event={threeSlot} now={Date.UTC(2025, 6, 1)} />
  </ul>,
);
const slotsBadge = i18n.t('calendar.slotsCount', { count: 3 });
assert.notEqual(slotsBadge, 'calendar.slotsCount', '键必须在当前语言下真的解析出文字');
assert.ok(
  threeSlotCard.includes(slotsBadge),
  `★ 三段的事件卡片上必须出现段数徽章（${LANG === 'zh-CN' ? '共 3 段' : '3 times'}）`,
);
assert.equal(
  threeSlotCard.includes('{count}'),
  false,
  '不该出现字面的 {count} —— 出现了说明词条用了单花括号',
);
ok(`★ ③ 三段的事件卡片显示段数徽章：「${slotsBadge}」`);

assert.ok(threeSlotCard.includes('08-23'), '卡片的时间块必须是**第一段**（08-23）');
assert.equal(
  threeSlotCard.includes('09-06'),
  false,
  '★ 卡片上只该有第一段：把三段拼在一行里，"跨三周"和"分三段打"会长得一模一样',
);
ok('★ 卡片只显示第一段（08-23），第三段（09-06）不出现在卡片上');

const oneSlotCard = html(
  <ul>
    <CalendarCard event={event({ id: 'one-slot' })} now={nowLate} />
  </ul>,
);
assert.equal(
  oneSlotCard.includes(i18n.t('calendar.slotsCount', { count: 1 })),
  false,
  '单段是常态，**不该**给每张卡都挂一枚「共 1 段」（与"评分 0 分不显示"同一条规矩）',
);
ok('★ 单段事件不显示段数徽章（两个方向都断言了）');

const accessCard = html(
  <ul>
    <CalendarCard
      event={event({
        id: 'acc-1',
        level: 'PRO',
        scope: 'CONTINENT',
        scopeDetail: ['ASIA'],
        access: 'QUALIFIER',
      })}
      now={nowLate}
    />
  </ul>,
);
for (const key of ['calendar.level.PRO', 'calendar.scope.CONTINENT', 'calendar.access.QUALIFIER']) {
  assert.ok(
    accessCard.includes(i18n.t(key)),
    `★ 卡片上必须有「${i18n.t(key)}」（走词条，不显示枚举值）`,
  );
}
assert.equal(
  />(PRO|CONTINENT|QUALIFIER)</.test(accessCard),
  false,
  '★ 三个维度的**枚举原始值**不该出现在可见文本里',
);
ok('★ 三个维度徽章：专业程度 / 参与范围 / 参赛门槛（都是词条，不是枚举原始值）');

/*
 * ⚠️ 下面这条是给 ⑤ 那组反向断言用的**对照 fixture**：它**带着** `stage: 'FINAL'`
 *    进入渲染。没有它的话，"界面上没有轮次"会因为"没有任何 fixture 带过 stage"
 *    而通过 —— 那是纯粹的假绿（见 ⑤ 那一段的注释）。
 */
const stageCardHtml = html(
  <ul>
    <CalendarCard
      event={event({ id: 'stage-final', stage: 'FINAL', seriesColor: 'red' })}
      now={nowLate}
    />
  </ul>,
);

// ---------------------------------------------------------------------------
console.log(`【${LANG}】④ 筛选栏：四个维度 + 一条从属行`);
// ---------------------------------------------------------------------------
const filtersHtml = html(
  <CalendarFilters
    tags={['TOURNAMENT', 'COMMUNITY', 'RANKED_MILESTONE']}
    onToggleTag={() => {}}
    level={null}
    scope={null}
    scopeDetail={null}
    access={null}
    onPick={() => {}}
    dirty={false}
    onReset={() => {}}
  />,
);

/*
 * ⚠️ 4 而不是 3（2026-09-14 加了「参赛门槛」那一维）。这个数字**必须跟着维度走**：
 *    它守的正是"新维度有没有真的长出一个 fieldset"—— 漏了渲染的话，下面那一行
 *    「参赛门槛」的断言会红，而这里也会红，两处一起指出来比一处更容易定位。
 */
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
  3 + (1 + 2) + (1 + 3) + (1 + EVENT_ACCESS.length),
  'chip 总数应为 14（scope=null 时明细那一行不渲染）',
);
ok('chip 总数 = 标签 3 + 专业程度 3 + 参与范围 4 + 参赛门槛 4 = 14（轮次那一维已删）');

// 三个单选维度都是"不限"选中（current === null）
assert.equal(
  countOf(filtersHtml, 'aria-pressed="true"'),
  3 + 3,
  '三个单选维度各有一个"不限"亮着，加上三个标签全选',
);
ok('三个单选维度的默认都是「不限」，而不是"没选"（两者含义相反）');

// ---------------------------------------------------------------------------
console.log(`【${LANG}】④a 参与范围明细：从属行，跟着「参与范围」出现 / 消失（需求⑥）`);
// ---------------------------------------------------------------------------
/*
 * ⚠️ 这一组四条断言缺一不可，因为它们各自守着一个不同的失效形状：
 *   ① `scope=null` 时**没有**这一行（"全球还要选哪个洲？"）
 *   ② `scope=CONTINENT` 时**有**，而且**六个大洲的名字都在**（不是只有一行标题）
 *   ③ 它的**位置**：紧贴「参与范围」之下、在尾部提示之前（从属关系靠位置表达）
 *   ④ 切到 `COUNTRY` 时换成国家表，**大洲不再出现**（`ASIA` 不是国家，
 *      留着它筛出来永远是空的）
 * 只断言"出现了一行标题"的话，取值集合接错了（比如大洲那一行挂了国家表）
 * 照样是绿的。
 */
const filtersContinent = html(
  <CalendarFilters
    tags={['TOURNAMENT', 'COMMUNITY', 'RANKED_MILESTONE']}
    onToggleTag={() => {}}
    level={null}
    scope="CONTINENT"
    scopeDetail={null}
    access={null}
    onPick={() => {}}
    dirty={false}
    onReset={() => {}}
  />,
);
const filtersCountry = html(
  <CalendarFilters
    tags={['TOURNAMENT', 'COMMUNITY', 'RANKED_MILESTONE']}
    onToggleTag={() => {}}
    level={null}
    scope="COUNTRY"
    scopeDetail={null}
    access={null}
    onPick={() => {}}
    dirty={false}
    onReset={() => {}}
  />,
);
const detailLabel = i18n.t('calendarGrid.filterScopeDetail');
const scopeLabel = i18n.t('calendarGrid.filterScope');

assert.equal(
  filtersHtml.includes(detailLabel),
  false,
  '★ `scope` 没选时**不该**出现「参与范围明细」这一行',
);
ok('★ ④① scope=null：没有「参与范围明细」这一行');

assert.ok(filtersContinent.includes(detailLabel), '★ 选「大洲」时必须出现明细行');
for (const c of CONTINENTS) {
  assert.ok(
    filtersContinent.includes(i18n.t(`calendar.continent.${c}`)),
    `大洲 ${c} 应当在明细行里（词条：${i18n.t(`calendar.continent.${c}`)}）`,
  );
}
assert.equal(
  countOf(filtersContinent, 'aria-pressed='),
  3 + (1 + 2) + (1 + 3) + (1 + CONTINENTS.length) + (1 + EVENT_ACCESS.length),
  '选「大洲」时明细行是「不限 + 六个大洲」（参赛门槛那一行不受影响，仍然 4 个）',
);
ok('★ ④② scope=CONTINENT：明细行出现，六个大洲的名字都在');

assert.ok(
  filtersContinent.indexOf(detailLabel) > filtersContinent.indexOf(scopeLabel),
  '明细行必须排在「参与范围」的**后面**（它是下级，不是并列维度）',
);
assert.ok(
  filtersContinent.indexOf(detailLabel) <
    filtersContinent.indexOf(i18n.t('calendarGrid.filterHint')),
  '明细行必须排在尾部提示**之前** —— 排到后面它就看起来像又一个独立维度',
);
ok('★ ④③ 位置：明细行紧贴「参与范围」之下（顺序断言，不是"存在即可"）');

assert.ok(filtersCountry.includes(i18n.t('calendar.country.CN')), '选「国家」时明细行给的是国家表');
assert.equal(
  filtersCountry.includes(i18n.t('calendar.continent.ASIA')),
  false,
  '★ 选「国家」时**不该**还有大洲 —— ASIA 不是一个国家，留着它筛出来永远是空的',
);
assert.equal(
  countOf(filtersCountry, 'aria-pressed='),
  3 + (1 + 2) + (1 + 3) + (1 + COUNTRIES.length) + (1 + EVENT_ACCESS.length),
  '选「国家」时明细行是「不限 + 全部国家」',
);
ok('★ ④④ scope=COUNTRY：明细行换成国家表，大洲不再出现');

assert.equal(filtersHtml.includes('filters__clear'), false, '默认状态不该显示"清空筛选"');
ok('没有筛选时不给「清空筛选」（一个点了没反应的按钮比没有更糟）');

// ---------------------------------------------------------------------------
console.log(`【${LANG}】④a2 参赛门槛：新维度真的进了筛选栏（用户第 ③ 条）`);
// ---------------------------------------------------------------------------
/*
 * ★ 这一节守的是「**新维度有没有被接到界面上**」，而它的失效形状恰恰是**看不见**的：
 *   用户要的是"参赛门槛也贴到日历栏目上方的选择框里"，实现漏了的话页面**不会报错** ——
 *   只是少了一行，而"少了一行"在一整栏筛选里很容易被当成"本来就这样"。
 *
 * ⚠️ 它的射程**只有渲染**：`?access=` 会不会真的传出去（服务端筛选）、月视图会不会
 *    真的逐条筛，都发生在 `routes/CalendarList.tsx` 的运行时，而这个脚本渲染的是
 *    **组件本身**。别把这一节读成"筛选生效了"。
 */

/** 从整份筛选栏产物里切出**某一行**（它那个 `<legend>` 到下一个 `<fieldset` 为止）。 */
function filterRow(html: string, label: string): string {
  const at = html.indexOf(label);
  /*
   * ⚠️ 找不到就**当场失败**，不是返回空串：空串里当然"没有多出来的 chip"，
   *    下面那些成对断言会因为**错误的原因**通过（与 ③b 的 `cellOf` 同一条教训）。
   */
  assert.notEqual(
    at,
    -1,
    `筛选栏里必须有「${label}」这一行（找不到的话下面的断言都是在空串上做的）`,
  );
  const rest = html.slice(at);
  const next = rest.indexOf('<fieldset', 1);
  return next === -1 ? rest : rest.slice(0, next);
}

/**
 * 一行里的 chip：「可见文案 + 有没有亮」，按渲染顺序。
 * ⚠️ 只认带 `aria-pressed` 的按钮 —— 同在一个容器里的"清空筛选"那类按钮没有它，
 *    于是不会被算成这一行的一个取值（数错 chip 的断言看起来只是"数量对不上"）。
 */
function rowChips(row: string): { label: string; on: boolean }[] {
  return [...row.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>([^<]*)/g)].map((m) => ({
    label: (m[2] ?? '').trim(),
    on: m[1] === 'true',
  }));
}

/*
 * ⚠️ 探针：提取器本身必须能命中。它写坏时返回空数组，而空数组在下面的 deepEqual
 *    里确实不会混过去 —— 但"只亮一个"那种断言会变成"0 个亮"，报的是组件的问题。
 *    先把它钉住，红的时候才说得清是提取器还是组件。
 */
assert.deepEqual(
  rowChips('<button type="button" class="tagchip tagchip--on" aria-pressed="true">X</button>'),
  [{ label: 'X', on: true }],
  'chip 提取器本身必须能命中（否则下面几条断言的失败会指向错误的地方）',
);

const accessRowLabel = i18n.t('calendarGrid.filterAccess');
/*
 * ⚠️ 这条**必须**先查：i18next 对**缺键**是原样返回键名，于是 `includes(键名)` 在
 *    键压根不存在时也会因为错误的原因通过（本仓记过这个坑，见 ④e 那条同样的先例）。
 */
assert.notEqual(
  accessRowLabel,
  'calendarGrid.filterAccess',
  '键必须在当前语言下真的解析出文字（缺键时 i18next 原样返回 key，下面全是假绿）',
);
assert.ok(
  filtersHtml.includes(accessRowLabel),
  '★ 筛选栏里必须有「参赛门槛」这一行（用户第 ③ 条要求它贴在日历栏目上方的选择框里）',
);

const accessOptions = EVENT_ACCESS.map((value) => ({
  value,
  label: i18n.t(`calendar.access.${value}`),
}));
for (const option of accessOptions) {
  assert.notEqual(
    option.label,
    `calendar.access.${option.value}`,
    `门槛取值 ${option.value} 的词条必须在当前语言下解析出文字`,
  );
}

/*
 * ★★ 默认态：这一行是「不限 + 三个取值」，而且**只有「不限」亮着**。
 *    ⚠️ 整行一起比（文案 + 顺序 + 亮不亮），而不是"能找到『不限』"：
 *    只查"出现"的话，把三个取值也全挂上选中样式照样能过 —— 而界面上会是
 *    "四个都亮着"，用户根本看不出自己筛的是什么。
 */
assert.deepEqual(
  rowChips(filterRow(filtersHtml, accessRowLabel)),
  [
    { label: i18n.t('calendar.filterAny'), on: true },
    ...accessOptions.map((option) => ({ label: option.label, on: false })),
  ],
  `★ 没选门槛时：这一行是「不限 + ${EVENT_ACCESS.length} 个取值」，且**只有「不限」亮着**（成对断言）`,
);
ok(
  `★ 参赛门槛那一行在筛选栏里，三个选项的词条都解析出来了：${accessOptions
    .map((o) => o.label)
    .join(' / ')}`,
);
ok('★ 没选门槛时「不限」是选中的，三个取值都不选中（`aria-pressed` 成对断言）');

/*
 * ★★ 选中态：**成对**断言"亮着的就是选的那一个，其余都不亮"。
 *    ⚠️ 这是"接线错了但看起来正常"最容易漏的一条：把 `current === value` 写成
 *    `current !== null`、或者干脆三个按钮都挂选中样式，界面都还能看，而筛选是坏的。
 */
const filtersQualifier = html(
  <CalendarFilters
    tags={['TOURNAMENT', 'COMMUNITY', 'RANKED_MILESTONE']}
    onToggleTag={() => {}}
    level={null}
    scope={null}
    scopeDetail={null}
    access="QUALIFIER"
    onPick={() => {}}
    dirty={false}
    onReset={() => {}}
  />,
);
const qualifierRow = filterRow(filtersQualifier, accessRowLabel);
assert.deepEqual(
  rowChips(qualifierRow),
  [
    { label: i18n.t('calendar.filterAny'), on: false },
    { label: i18n.t('calendar.access.QUALIFIER'), on: true },
    { label: i18n.t('calendar.access.INVITE'), on: false },
    { label: i18n.t('calendar.access.OPEN'), on: false },
  ],
  '★ 选了「选拔制」时：**只有它**亮着，「不限」和另外两个都不亮 —— 成对断言，不是"能找到即可"',
);
assert.equal(
  />(QUALIFIER|INVITE|OPEN)</.test(qualifierRow),
  false,
  '★ 三个门槛的**枚举原始值**不该出现在可见文本里（都走词条）',
);
ok('★ 选了 QUALIFIER：它选中、其余三个不选中（`aria-pressed` 成对断言），且不显示枚举原始值');

/*
 * ★★ 位置：**新维度插错地方**是那种肉眼看不出、只会觉得别扭的错 ——
 *    它不报错、不丢功能，只是把"哪些维度是并列的"这个结构说错了。
 *    所以这里钉死它排在**范围那一组之后**、**尾部提示之前**。
 *
 * ⚠️ 判据用 `indexOf`（**第一次**出现的位置）。门槛这个词在尾部提示里也会出现
 *    （`filterHint` 那句列举了单选维度），而 legend 是先出现的那个 ——
 *    万一哪天它被挪到提示之后，`indexOf` 会返回提示里那一次，这一条当场红。
 * ⚠️⚠️ 这一条**只在本脚本里成立**：它是"组件按我们选的位置渲染"，不是
 *    "CSS 真的把它画在那里"（`grid-filters__row` 是 flex 列，顺序由 DOM 决定 ——
 *     但那是 styles.css 的约定，不在这个脚本的射程里）。见仓库里那条通用边界。
 */
const filterHintLabel = i18n.t('calendarGrid.filterHint');
assert.ok(filterHintLabel.length > 0, '尾部提示词条必须存在（否则下面的相对位置是在和 -1 比）');
assert.ok(
  filtersHtml.indexOf(accessRowLabel) > filtersHtml.indexOf(i18n.t('calendarGrid.filterLevel')),
  '参赛门槛要排在「专业程度」**之后**（它是并列维度，但不是第一个）',
);
assert.ok(
  filtersHtml.indexOf(accessRowLabel) > filtersHtml.indexOf(i18n.t('calendarGrid.filterScope')),
  '参赛门槛要排在「参与范围」**之后**（它不插到范围那一组的前面去）',
);
assert.ok(
  filtersHtml.indexOf(accessRowLabel) < filtersHtml.indexOf(filterHintLabel),
  '参赛门槛要排在尾部提示**之前** —— 排到提示后面它就成了提示的附属，用户会漏看',
);
assert.ok(
  filtersContinent.indexOf(accessRowLabel) > filtersContinent.indexOf(detailLabel),
  '★ 有「参与范围明细」那一行时，参赛门槛排在**明细行之后**：明细行是 scope 的下级，"紧贴"是它表达从属关系的唯一方式，插在两者之间会把那对父子行拆散',
);
ok('★ 位置：参赛门槛排在「参与范围（+明细）」之后、尾部提示之前（顺序断言，不是"存在即可"）');

// ---------------------------------------------------------------------------
console.log(`【${LANG}】④b 系列活动栏目（需求③）—— 真的渲染它，否则上面那条扫描是空的`);
// ---------------------------------------------------------------------------
/*
 * ⚠️⚠️ 这一节存在的理由是**证据完整性**，不是"多测一点"。
 *
 *   第 ⑤ 节的泄漏扫描只扫 `all` 里那几个渲染产物。而 `CalendarList` 这个**页面**
 *   从来没有被本脚本渲染过（它 import 的是 `CalendarGrid` 之类的组件），
 *   所以：**如果系列栏目只在 CalendarList 里，它的词条一个都不会进 `all`** ——
 *   上面那条断言会变成"扫了一片空白"的**假通过**（它照样是绿的）。
 *
 *   所以这里**直接渲染那个栏目组件本身**（纯展示、数据走 props），
 *   再把它并入 `all`。两步缺一不可：只加进 `all` 而不渲染它 = 换了个姿势的假通过。
 *
 * ⚠️ 它用 `calendar.` 前缀，所以**不需要**动泄漏扫描的 alternation ——
 *    那一行在本文件里是 `const leaks = [...all.matchAll(/(calendarGrid|calendar|
 *    resources|marks)\.[a-zA-Z]+/g)]`，本来就覆盖它。
 * ⚠️⚠️ **这里刻意不写行号**：本文件当天漂过约 +180 行，而这句话原本写的是
 *    "不需要动第 305 行的 alternation" —— `:305` 那个数字**曾经是对的**（迁移到
 *    本行号前它确实是 alternation），但漂移之后它指向了一句毫无关系的 JSX，
 *    于是**看起来仍然"已核实"**。写死的行号会伪装成已核实，比不写更危险。
 * ⚠️ 另外注意 alternation 里**有 `marks`**：旧 `:305` 那版的写法和注释里抄的都
 *    没有它，照着旧注释读会误以为 `marks.*` 不在扫描范围内（其实在）。
 *    这一点和"新开一个 `calendarSeries` 顶层命名空间"的旧计划不同（那条已随
 *    spec 定稿作废）。
 */
const seriesFixture = [
  series({ id: 's1', name: 'MCSR Ranked', count: 3, nextStartsAtUtc: Date.UTC(2026, 10, 20, 12) }),
  series({ id: 's2', name: '社区杯', count: 0, pastCount: 5, nextStartsAtUtc: null }),
  series({ id: 's3', name: 'Autumn Open', count: 1, nextStartsAtUtc: Date.UTC(2026, 11, 1, 9) }),
];

const seriesHtml = html(
  <CalendarSeriesSection
    items={seriesFixture}
    query=""
    onQueryChange={() => {}}
    selectedId={null}
    onSelect={() => {}}
    status="ok"
  />,
);

// 搜索框永远在（③ 对匿名开放，没有登录门槛那一档）
assert.ok(
  seriesHtml.includes(i18n.t('calendar.seriesSearch')),
  '系列栏目必须渲染出搜索框（③ 对未登录开放，所以没有"登录后才能搜"那一档）',
);
ok('★ 栏目渲染出搜索框，且**没有**登录门槛文案');

// 三个系列都在
for (const s of seriesFixture) {
  assert.ok(seriesHtml.includes(s.name), `系列「${s.name}」应当渲染出来`);
}
ok('三个系列都渲染出来了');

/*
 * ★ 计数走**插值**：3 场未结束应显示成 "3 场未结束"。
 *   ⚠️ 这一条能抓住"词条写成了单花括号"那类错（那会显示成字面的 `{count}`）——
 *   两边的花括号都是 ASCII，字体检查拦不住，只有渲染出来比对才看得见。
 */
assert.ok(
  seriesHtml.includes(i18n.t('calendar.seriesCount', { count: 3 })),
  '场次数必须走插值（显示成 "3 场未结束"，而不是字面的 {count}）',
);
assert.equal(
  seriesHtml.includes('{count}'),
  false,
  '渲染结果里不该出现字面的 {count} —— 出现了说明词条用了单花括号',
);
ok('★ 场次数是插值后的真实数字，且没有字面的 {count} 泄漏');

// 没有未结束场次的系列要说"暂无"，而不是显示 0
assert.ok(
  seriesHtml.includes(i18n.t('calendar.seriesNoneUpcoming')),
  'count 为 0 的系列应当显示「暂无未结束的场次」，而不是显示 0',
);
ok('count=0 的系列说「暂无」，不显示 0');

/*
 * ★ 客户端搜索过滤：这是 ③ 的搜索**唯一**实现处（服务端不收 q）。
 *   断言"命中留、不中丢"，两条都要 —— 只断言"命中的在"会漏掉"过滤根本没生效"。
 */
const searchedHtml = html(
  <CalendarSeriesSection
    items={seriesFixture}
    query="Ranked"
    onQueryChange={() => {}}
    selectedId={null}
    onSelect={() => {}}
    status="ok"
  />,
);
assert.ok(searchedHtml.includes('MCSR Ranked'), '搜索"Ranked"应当留下命中的系列');
assert.equal(
  searchedHtml.includes('Autumn Open'),
  false,
  '搜索"Ranked"必须**滤掉**没命中的系列 —— 只断言"命中的在"会漏掉过滤没生效',
);
ok('★ 客户端过滤：命中的留下、不命中的滤掉（两条都断言）');

// 搜不到时是"没有匹配的系列"，**不是**"还没有系列活动"（两句不同的话）
const noMatchHtml = html(
  <CalendarSeriesSection
    items={seriesFixture}
    query="zzz-no-such"
    onQueryChange={() => {}}
    selectedId={null}
    onSelect={() => {}}
    status="ok"
  />,
);
assert.ok(noMatchHtml.includes(i18n.t('calendar.seriesNoMatch')), '搜不到时应说「没有匹配的系列」');
assert.equal(
  noMatchHtml.includes(i18n.t('calendar.seriesEmpty')),
  false,
  '搜不到时**不该**说「还没有系列活动」—— 那会让用户以为系列数据没了',
);
ok('★ 搜不到 ≠ 没有系列（两句不同的话都验证了）');

// 真的没有任何系列时，才是"还没有系列活动"
const emptyHtml = html(
  <CalendarSeriesSection
    items={[]}
    query=""
    onQueryChange={() => {}}
    selectedId={null}
    onSelect={() => {}}
    status="ok"
  />,
);
assert.ok(
  emptyHtml.includes(i18n.t('calendar.seriesEmpty')),
  '一个系列都没有时说「还没有系列活动」',
);
ok('空列表说「还没有系列活动」');

// ---------------------------------------------------------------------------
console.log(`【${LANG}】④c 资源卡片的收藏数（需求⑤）`);
// ---------------------------------------------------------------------------
/*
 * ⚠️ 这一节是**纯展示组件**的渲染断言：`ResourceCard` 的数据走 props，
 *    所以不需要服务端、也不需要 mock —— 这正是把它写成纯展示的好处。
 *
 * ⚠️ 两个方向都要断言（>0 显示 / =0 不显示）。只测一边等于没测：
 *    这条规则的两个失败方向分别是"每张卡都挂个 0"（噪音）与
 *    "收藏了却看不见"（丢信息），而每条断言各自只能抓住其中一边。
 */
const cardRich = html(
  <ul>
    <ResourceCard item={resourceItem({ favoriteCount: 3 })} />
  </ul>,
);
assert.ok(
  cardRich.includes(i18n.t('marks.favoriteCount', { count: 3 })),
  '卡片的收藏数文案必须走插值（「收藏 3」/「3 saved」）',
);
assert.equal(
  cardRich.includes('{count}'),
  false,
  '渲染结果里不该出现字面的 {count} —— 出现了说明词条用了单花括号',
);
ok('★ 卡片：favoriteCount=3 时显示插值后的真实数字，且无字面 {count}');

const cardZero = html(
  <ul>
    <ResourceCard item={resourceItem({ favoriteCount: 0 })} />
  </ul>,
);
assert.equal(
  cardZero.includes(i18n.t('marks.favoriteCount', { count: 0 })),
  false,
  '卡片上 favoriteCount=0 时**不该**渲染收藏数（每张卡挂一个 0 是噪音，与评分在卡片上的处理一致）',
);
assert.equal(
  cardZero.includes(i18n.t('marks.noFavoriteYet')),
  false,
  '「还没有人收藏」属于详情页；卡片上那一格是"不显示"，不是换一句话',
);
ok('★ 卡片：favoriteCount=0 时整块不渲染（两个方向都断言了）');

// ---------------------------------------------------------------------------
console.log(`【${LANG}】④d 日历表单的系列字段（t17 验收第 9 条）—— 注入"已登录的 editor"`);
// ---------------------------------------------------------------------------
/*
 * ★ 这一节的**存在理由**是 t17 第 [9] 条，而那一条是 captain 点名的：
 *    "有界面、有词条、门禁全绿但没有任何断言真的看过它"的高风险区。
 *
 * ⚠️ 它以前做不到，原因很具体：`CalendarForm` 内部调 `useAuth()`（要判 `content.author`
 *    才决定显不显示「新建系列」），而 `useAuth` 在 Provider 外直接 throw ⇒ 纯 node SSR
 *    渲染不出来。为此给 `AuthProvider` 加了一个**注入点**（`initialUser`），生产调用方
 *    一个参数都不传、行为不变。
 *
 * ⚠️ 断言的是**"界面上能看到"**（不是"代码里引用了"）：
 *    这三个词条此前是**零引用**（`seriesCreate` / `seriesNameTaken` / `seriesField`），
 *    而它们的失败形状恰恰是"看不见"——所以必须从渲染产物里找。
 */
const editorUser: UserSelf = {
  id: 'u-editor',
  displayName: '编辑',
  avatarUrl: null,
  role: 'editor',
  email: 'editor@example.com',
  locale: 'zh-CN',
  emailVerified: true,
  canSubmit: true,
};

{
  const formAsEditor = htmlAs(
    editorUser,
    <CalendarForm
      initial={emptyCalendarDraft()}
      actionLabel="提交活动"
      busyLabel="提交中"
      busy={false}
      onSubmit={() => undefined}
    />,
  );

  // ① 系列字段存在（`calendar.seriesField`）—— 它是"归类"的入口
  assert.ok(
    formAsEditor.includes(i18n.t('calendar.seriesField')),
    '日历表单必须渲染出系列字段（否则界面上根本无法把事件归到系列）',
  );
  ok(`★ 系列字段渲染出来了：「${i18n.t('calendar.seriesField')}」`);

  // ② editor 看得到「新建系列」入口（`calendar.seriesCreate`）
  assert.ok(
    formAsEditor.includes(i18n.t('calendar.seriesCreate')),
    '★ 有 content.author 的人必须看到「新建系列」入口 —— 看不到就说明 canAuthor 那条路没通',
  );
  ok(`★ editor 看得到「新建系列」：「${i18n.t('calendar.seriesCreate')}」`);

  /*
   * ★ 反面对照：**普通用户看不到那个入口**（入口不存在，不是灰按钮）。
   *    ⚠️ 这一条真正守的是 `useCan('content.author')` 那条分派 ——
   *    只断言 editor 看得见的话，把判断写成"恒真"也照样通过。
   */
  const formAsUser = htmlAs(
    { ...editorUser, id: 'u-user', role: 'user' },
    <CalendarForm
      initial={emptyCalendarDraft()}
      actionLabel="提交活动"
      busyLabel="提交中"
      busy={false}
      onSubmit={() => undefined}
    />,
  );
  assert.equal(
    formAsUser.includes(i18n.t('calendar.seriesCreate')),
    false,
    '★ 普通用户**不该**看到「新建系列」入口（入口不存在，不是灰按钮）',
  );
  ok('★ 普通用户看不到「新建系列」（两条一起才排除了"判断恒真"）');
}

/*
 * ★★ ④e「重名提示出现」（t17 验收 [9] 的第三个词条 `calendar.seriesNameTaken`）
 *
 * ⚠️ 它原先**断言不到**，原因很具体：那句话只有一条生产路径 —— `createSeries()` 收到
 *    服务端的 409 `invalid_state` + `reason: 'series_name_taken'` 之后 `setSeriesError`。
 *    纯 node SSR **不跑 effect、也发不出请求** ⇒ 留在表单抽屉里就永远看不到它。
 *    ⇒ 把它抽成纯展示组件（`SeriesErrorNote`，见该组件注释），其余**一行生产逻辑没改**。
 *
 * ⚠️ 还断言了「这个 key 在本语言下真的解析成文字」：`i18n.t` 对**缺键**是静默返回 key 本身，
 *    于是 `includes(key)` 会**因为错误的原因**通过（上一个真发生过的坑）。
 */
{
  const seriesTakenText = i18n.t('calendar.seriesNameTaken');
  assert.notEqual(seriesTakenText, 'calendar.seriesNameTaken', '键必须在当前语言下真的解析出文字');

  const takenHtml = html(<SeriesErrorNote text={seriesTakenText} />);
  assert.ok(takenHtml.includes(seriesTakenText), '重名时必须把「这个系列名已经有了」说出来');
  ok(`★ 重名提示渲染出来了：「${seriesTakenText}」`);

  assert.equal(
    html(<SeriesErrorNote text={null} />),
    '',
    '没有错误时不该渲染出任何东西（空红框比不说话更糟）',
  );
  ok('★ 没有错误时一个字节都不渲染');

  /*
   * ★ 这组断言的**能红证明**：把同一个组件喂一个"解析不出来的 key"（模拟缺键的失效形状），
   *    断言当场失败 —— 说明上面那条不是恒真。
   */
  assert.throws(() =>
    assert.ok(
      html(<SeriesErrorNote text="calendar.seriesNameTaken" />).includes(seriesTakenText),
      '（这条必须抛：渲染出来的是 key 本身，不是文案）',
    ),
  );
  ok('★ 能红证明：喂进解析不出的 key 时，这条断言当场失败（不是恒真）');
}

/*
 * ★★ ④f「选已有系列 → 提交体里带上它」（t17 验收 [9] 的第三件事）
 *
 * ⚠️ 这条**必须断言生产代码那一条路**：`calendarEventInputOf` 是 `buildEvent` 真正调用的
 *    那个纯函数（见它的注释）。若在这里另写一份 `draft.seriesId || null` 来断言，
 *    证明的只是"我新写的那一行"，而不是用户实际执行的那条路 —— 那正是本仓反复在治的
 *    「守卫因为错误的原因通过」。
 * ⚠️ 这也正是先前这条做不到的原因：映射原先埋在 `buildEvent` 里（读整个草稿 + 会
 *    `setErrors`），静态自检无法驱动它。抽出来之后它才有验证点。
 */
{
  const withSeries = calendarEventInputOf({
    ...emptyCalendarDraft(),
    title: '  Autumn Open  ',
    seriesId: 's3',
  });
  assert.equal(withSeries.seriesId, 's3', '★ 选中已有系列后，提交体里必须带上这个 id');
  ok('★ 选已有系列 → 提交体带上它（seriesId: s3）');

  assert.equal(
    calendarEventInputOf({ ...emptyCalendarDraft(), seriesId: '' }).seriesId,
    null,
    '★ 不选系列时必须是 null（不是空串）—— 空串会被服务端当成一个"不存在的系列 id"',
  );
  ok('★ 不选系列 → null（不是空串）');

  /*
   * ★ 能红证明 A：把映射改成 `draft.seriesId`（不再把空串转 null），这条断言当场失败。
   */
  const mutatedEmptySeries = { ...withSeries, seriesId: '' };
  assert.throws(() =>
    assert.equal(mutatedEmptySeries.seriesId, null, '（这条必须抛：空串不等于 null）'),
  );
  ok('★ 能红证明：空串没被转成 null 时，上面的断言会失败');

  /*
   * ★ 基线断言（防"这个函数其实什么都没映射"）：标题两侧的空格必须被 trim 掉。
   *    ⚠️ 用 `assert.equal` 而不是断言"非空"：后者在映射整个坏掉（比如返回 `{}`）时
   *    依然为假，但把 `'  Autumn Open  '` 原样返回时**照样通过** —— 那就不够紧。
   */
  assert.equal(withSeries.title, 'Autumn Open', '★ 标题两侧空格必须被 trim（证明映射真的在干活）');
  ok('★ 基线：title 两侧空格被 trim 掉（排除"函数其实什么都没映射"）');
}
// ---------------------------------------------------------------------------
const all =
  gridHtml +
  panelWith +
  filtersHtml +
  panelEmpty +
  gridTodayHtml +
  panelAnon +
  seriesHtml +
  searchedHtml +
  cardRich +
  /*
   * ⚠️ 本轮新渲染的那些**必须也进 `all`**：下面的词条泄漏扫描和 ⑤ 的反向断言
   *    都只扫 `all`。不并进来的话，它们渲染出来的东西等于**没被扫过**，
   *    而那两条断言照样是绿的 —— 这正是本文件 ④b 那一大段警告过的假通过，
   *    每新增一个渲染产物都要在这里补一笔。
   */
  redGrid +
  plainGrid +
  augGrid +
  sepGrid +
  overlapGrid +
  overlapPanel +
  threeSlotCard +
  oneSlotCard +
  accessCard +
  stageCardHtml +
  filtersContinent +
  filtersCountry +
  /*
   * ⚠️ 参赛门槛那一份（④a2 的选中态）**也必须进 `all`**：它的词条是
   *    `calendar.access.*`，而泄漏扫描只扫 `all` 里的样本 —— 不并进来的话，
   *    "门槛那一行的词条真的解析出来了"这件事就只由上面那条 `includes` 断言守着，
   *    扫描器看不到它（多一份样本不花什么钱）。
   */
  filtersQualifier;
const leaks = [...all.matchAll(/(calendarGrid|calendar|resources|marks)\.[a-zA-Z]+/g)]
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

// ---------------------------------------------------------------------------
console.log(`【${LANG}】⑤ 反向断言：轮次（stage）在界面上**一点都没有**（需求⑥）`);
// ---------------------------------------------------------------------------
/*
 * ★ 这条守的是"**删掉了没有**"，而它正是最容易**假绿**的一类检查：
 *   如果没有任何 fixture 带着 `stage` 值，"界面上没有轮次"就会因为它压根
 *   没被渲染过而通过 —— 那和"我删干净了"完全是两件事，而两者的结果都是绿的。
 *
 * ⇒ 所以先用一条**真的带 `stage: 'FINAL'`** 的事件（`stageCardHtml`）把
 *   "库里有这个值"这个前提造出来，再去证明它没有冒出来。
 *
 * ⚠️ 下面那条**对照断言**（卡片里必须有「赛事」这个标签）是必须的：
 *    它证明那张卡片的徽章区**真的渲染了**。少了它，"没有轮次"可能只是因为
 *    整张卡片没渲染出来（fixture 打错字、组件抛异常被吞掉……）—— 另一种假绿。
 */
assert.ok(
  stageCardHtml.includes(i18n.t('calendar.tag.TOURNAMENT')),
  '对照：这张带 stage 的卡片本身渲染出来了（否则下面那条"没有轮次"是假绿）',
);
/*
 * ⚠️⚠️ 这两条针**必须**是字面量，不能写成 `i18n.t('calendar.stage.FINAL')` ——
 *    那是 2026-09-14 之前的写法，而 `calendar.stage.*` 这批词条已经随「轮次」
 *    一起从字典里删掉了。i18next 对**缺键**是"原样返回键名"，于是针变成了字符串
 *    `'calendar.stage.FINAL'`，而渲染结果里当然不会有这串键 ⇒
 *    `includes(...) === false` **恒成立**，这条断言从此什么都没验。
 *
 *    这就是本仓记过的「反面断言换名/换词条之后是**静默变绿**，不是变红」
 *    （`liverender.tsx` 的 `noEmbedBilibili` 那一段有同族的完整记录）。
 *    ⇒ 词条没了的检查，针只能写字面量：现在唯一还成立的说法就是
 *      "「轮次」这两个字，以及枚举原始值 `FINAL`，都不该出现"。
 */
assert.equal(stageCardHtml.includes('轮次'), false, '★ 卡片上不该再印「轮次」徽章');
assert.equal(stageCardHtml.includes('FINAL'), false, '★ 枚举原始值 FINAL 更不该出现');
ok('★ 对照 fixture（stage: FINAL）渲染了，但「轮次」一个字都没冒出来');

/*
 * ⚠️ 同理：`calendarGrid.filterStage` 也已经删了，针换成字面量。
 *    中文那一侧被 `'轮次'` 覆盖（上面那条 + 这一条各查一遍不同的产物），
 *    英文那一侧靠 `'Stage'` —— 英文词条的值逐字就是它。
 */
for (const needle of ['轮次', 'Stage']) {
  assert.equal(
    all.includes(needle),
    false,
    `★ 整份渲染结果里不该出现「${needle}」（轮次这一维已经从界面上删掉）`,
  );
}
ok('★ ⑤ 反向断言：筛选栏词条 + 卡片徽章 + 枚举原始值，轮次一个都不剩');

console.log('');
console.log(`通过 ${pass} 项。`);
console.log('');
console.log('⚠️ 这个脚本验的是**渲染**，不是交互：点击、方向键、View Transition');
console.log('   动画都没有被验到 —— 那些需要 dev server + 浏览器。');
