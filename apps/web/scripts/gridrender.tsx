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
import type { UserSelf } from '@mcsr/shared/auth';
// 系列的形状（需求③）—— 与 `event()` 那个 fixture 同理：字段要齐全
import type { CalendarSeries } from '@mcsr/shared/calendar';
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

import { CalendarDayPanel } from '@/components/CalendarDayPanel';
import { CalendarFilters } from '@/components/CalendarFilters';
import {
  CalendarForm,
  calendarEventInputOf,
  emptyCalendarDraft,
  SeriesErrorNote,
} from '@/components/CalendarForm';
import { buildGridCells, CalendarGrid, todayKeyInViewerTz } from '@/components/CalendarGrid';
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
  cardRich;
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

console.log('');
console.log(`通过 ${pass} 项。`);
console.log('');
console.log('⚠️ 这个脚本验的是**渲染**，不是交互：点击、方向键、View Transition');
console.log('   动画都没有被验到 —— 那些需要 dev server + 浏览器。');
