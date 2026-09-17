#!/usr/bin/env tsx
/**
 * 资源库 · **贡献者**（名单面板 / 贡献者自己的两个动作 / 公开面）的渲染断言。
 *
 * 跑法（从仓库根）：
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:resource
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:resource -- --en
 *
 * ===========================================================================
 * 为什么单独一个脚本
 * ===========================================================================
 * `check:grid` 验资源网格与卡片、`check:live` 验直播、`check:calendar` 验系列栏目、
 * `check:home` 验主页 —— 它们都不渲染这一轮新加的东西（贡献者那三块）。
 *
 * 而这一轮加的东西恰好是**全仓最不能靠肉眼看**的一类：
 *   · 一份**只有管理员看得见**的名单（判据错了不会报错，只会把名单漏给所有人，
 *     或者反过来让管理员看不到）；
 *   · 一个**下架**入口（改了线上是否可见，而"点了没反应"和"点对了"长得一样）；
 *   · 一条**不许出现在公开面上**的数据（用户原话「不直接展示在资源库中」）。
 *
 * ===========================================================================
 * ★★ 守的第一条：公开面没有贡献者（第 ⑥ 节）
 * ===========================================================================
 * 用户原话是「在后台记录贡献者（**不直接展示在资源库中**）」。这句话的失败形状
 * 非常特别：**它不会报错**。名单出现在列表页或详情页上时，页面看起来完全正常 ——
 * 只是把"谁能直接改这一条"告诉给了每一个访客，而那本来只有管理员该知道。
 *
 * 所以这一条用了**两层**（理由见 ⑥ 那一节的开头）：
 *   ① 渲染层：公开卡片 + 详情页真的渲染一遍，产物里不许有 `resourceContrib.*`
 *      的**译文**、裸 key、贡献者的类名，也不许有夹具里那几个贡献者的名字；
 *   ② 源码层：`apps/web/src` 里**除了三个允许的文件**，任何一处出现
 *      `contributor` 都算红。⚠️ 这一层不是"顺手 grep 一下"，它是详情页那一半
 *      **唯一的**守卫 —— `ResourceDetailPage` 自己取数，纯 SSR 下永远停在
 *      "加载中"（见下面 ⑥ 的说明），它的取数分支**渲染不到**。
 *
 * ===========================================================================
 * ★ 守的第二条：非管理员一个字都不该看到（第 ② 节）
 * ===========================================================================
 * 面板的判据是 `canManage`（页面按 `user.moderate` 给 —— admin / owner，
 * ⚠️ **不是** `resource.moderate`：那一个属于 `EDITOR_CAPS`，editor 也有，
 * 用它等于让每个编辑都能给自己发免审直编权）。这里断言的是
 * **反向**那一半：`canManage: false` 时产物是一段**空串**。
 * ⚠️ 反向断言最容易假绿（组件炸了、或者整块被挪进别的分支，"找不到"都自动成立），
 *    所以紧跟着一条**正向对照**：同一次运行里，`canManage: true` 必须渲染出标题。
 *
 * ===========================================================================
 * 覆盖边界（写清楚，免得下一个人高估它）
 * ===========================================================================
 * ⚠️ 这个脚本验的是**把 props 给对了会渲染成什么样**。它**不验**：
 *   · **点击**（「移除」「添加」「保存」「下架」都不在这里跑事件处理器 ——
 *     `renderToStaticMarkup` 不跑 effect、不派发事件）；
 *   · **取数**（面板是打开时现取名单的，而 SSR 不跑 effect ⇒ 渲染自检里
 *     它永远停在"加载中"那一屏，这也是为什么真正的名单渲染要从
 *     `ContributorPanelView` 这个**纯视图**进）；
 *   · **保存之后服务端到底存了什么**（整份替换的幂等、`added`/`removed`、
 *     403/404/409 —— 那些在服务端测试里，`services/api/src/contributors.test.ts`）；
 *   · **下架真的把条目从公开列表里拿掉了**（那是服务端 `status` 的事）。
 *   渲染自检与那几份证据是互补的，不是替代关系。
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTRIBUTORS_MAX } from '@mcsr/shared';
import type { UserSelf } from '@mcsr/shared/auth';
import { en, zhCN } from '@mcsr/shared/i18n';
import type { ResourceListItem } from '@mcsr/shared/resources';
import i18n from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';

import {
  ContributorDirectNote,
  ContributorPanel,
  ContributorPanelView,
  type ContributorPanelViewProps,
  type ContributorRow,
  ContributorVisibilityBar,
  type ContributorVisibilityBarProps,
} from '@/components/ContributorPanel';
import { emText } from '@/components/Emphasis';
import { ResourceCard } from '@/components/ResourceCard';
import { TagCloud, TagCloudView, type TagCloudViewProps, tagCountOf } from '@/components/TagCloud';
import type { AdminUser, TagCount } from '@/lib/api';
import { AuthProvider } from '@/lib/auth';
import { ResourceDetailPage } from '@/routes/ResourceDetail';

/*
 * ⚠️ 刻意**不用 JSX**（用 `createElement`），理由与 `calendarrender.tsx` /
 *    `roleguide.tsx` 相同：`scripts/**` 不在 tsconfig 的 include 里 ⇒ JSX 走
 *    classic runtime ⇒ 必须 `import React from 'react'`，而 biome 的
 *    `noUnusedImports` 会把它判成"未使用"并提供一个**不安全自动修复** ——
 *    谁点了那个修复，脚本就在运行时崩（报 `React is not defined`，指向第一处 JSX）。
 */
const LANG = process.argv.includes('--en') ? 'en' : 'zh-CN';

await i18n.use(initReactI18next).init({
  lng: LANG,
  /*
   * ⚠️ `false` 而不是 `'zh-CN'`：缺 en 词条时**原样返回 key**，于是下面
   *    ⑩ 的裸 key 扫描能精确指出是哪一个 key（回退到中文的话，英文界面上
   *    冒出来的是中文，只能靠 ⑪ 的汉字扫描间接发现"某处漏了英文"）。
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

/** 标签剥掉、实体还原、空白压掉 —— 只比较"人看到的那串字"。 */
const decode = (s: string): string =>
  s
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
const textOf = (html: string): string =>
  decode(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, '');

const noop = (): void => undefined;

console.log(`【${LANG}】资源库 · 贡献者`);

// ---------------------------------------------------------------------------
// 渲染入口
// ---------------------------------------------------------------------------

const renderPanelView = (props: ContributorPanelViewProps): string =>
  renderToStaticMarkup(
    createElement(I18nextProvider, { i18n }, createElement(ContributorPanelView, props)),
  );

/**
 * 面板的**容器** —— 它有 `useAuth()`（"由谁添加"要用我自己），
 * 而 `useAuth` 在 Provider 外**直接 throw**（`lib/auth.tsx`）。
 * 所以这里必须给一个真的 `AuthProvider`，用它的 `initialUser` 注入点
 * （那个口子就是给渲染自检留的，生产调用方一个字都不传）。
 * ⚠️ 这一段渲染出来的必然是"加载中"那一屏（SSR 不跑 effect），
 *    所以它只用来断言**守卫**（② 那一条），不用来断言名单。
 */
const renderPanelContainer = (props: Parameters<typeof ContributorPanel>[0]): string =>
  renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(
        AuthProvider,
        { initialUser: adminUser },
        createElement(ContributorPanel, props),
      ),
    ),
  );

const renderDirectNote = (props: Parameters<typeof ContributorDirectNote>[0]): string =>
  renderToStaticMarkup(
    createElement(I18nextProvider, { i18n }, createElement(ContributorDirectNote, props)),
  );

const renderVisibilityBar = (props: ContributorVisibilityBarProps): string =>
  renderToStaticMarkup(
    createElement(I18nextProvider, { i18n }, createElement(ContributorVisibilityBar, props)),
  );

/** 公开列表页上那张卡片（`ResourceList` / 相关推荐都用它）。卡片里有 `<Link>` ⇒ 需要 Router。 */
const renderPublicCard = (item: ResourceListItem): string =>
  renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(MemoryRouter, null, createElement(ResourceCard, { item })),
    ),
  );

// ---------------------------------------------------------------------------
// 提取器（每个都自带探针，见各节）
// ---------------------------------------------------------------------------

/** 产物里所有 `aria-label` 的值，按出现顺序。 */
function ariaLabels(html: string): string[] {
  return [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => decode(m[1] ?? ''));
}

/** 产物里所有按钮的「属性串 + 可见文字」。 */
function buttons(html: string): { attrs: string; text: string }[] {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    attrs: m[1] ?? '',
    text: decode((m[2] ?? '').replace(/<[^>]+>/g, '')).trim(),
  }));
}

/** 名单上那一行显示的**名字**（可见文字，不是 aria-label）。 */
function rowNames(html: string): string[] {
  return [...html.matchAll(/<span class="contrib__name">([^<]*)<\/span>/g)].map((m) =>
    decode(m[1] ?? ''),
  );
}

/** 一段词条里被 `**` 夹住的那一句（用来断言它真的变成了 `<strong>`）。 */
function emphasized(s: string): string {
  const parts = s.split('**');
  return parts.length % 2 === 1 && parts.length >= 3 ? (parts[1] ?? '') : '';
}

// ---------------------------------------------------------------------------
// 夹具（字段按类型写全 —— 少一个会让渲染悄悄少一块）
// ---------------------------------------------------------------------------

const adminUser: UserSelf = {
  id: 'u-admin',
  displayName: 'Admin Example',
  avatarUrl: null,
  role: 'admin',
  email: 'admin@example.com',
  locale: 'zh-CN',
  emailVerified: true,
  canSubmit: true,
  mcName: null,
  createdAt: 0,
};

function account(over: Partial<AdminUser>): AdminUser {
  return {
    id: 'u-x',
    email: 'x@example.com',
    displayName: 'Somebody',
    role: 'user',
    status: 'active',
    emailVerified: true,
    createdAt: 0,
    isSelf: false,
    ...over,
  };
}

/*
 * ⚠️ 名字一律用 **ASCII**：⑪ 那一节要断言"英文界面里零汉字"，而这里的名字是
 *    **数据**（由夹具喂进去）—— 用中文夹具会让那条断言挂在夹具上，
 *    而不是挂在产品文案上（`calendarrender.tsx` 第 ⑥ 条踩过同一个坑）。
 */
const alice = account({ id: 'u-alice', email: 'alice@example.com', displayName: 'Alice Example' });
const bob = account({ id: 'u-bob', email: 'bob@example.com', displayName: 'Bob Example' });
const carol = account({
  id: 'u-carol',
  email: 'carol@example.com',
  displayName: 'Carol Example',
});
const dave = account({ id: 'u-dave', email: 'dave@example.com', displayName: 'Dave Example' });
/*
 * ⚠️ 管理员**也在**账号列表里，而且这一条很重要：名单里那一行「由 X 添加」写的是
 *    `addedBy`（一个**用户 id**）翻出来的人名，而管理员就是那个"加人的人"。
 *    他不在这个夹具里的话，下面那条断言会退化成"未知账号"——
 *    看起来也能过（回退文案本身是对的），却**没有验到"id 被翻成了名字"**这件事。
 */
const adminAccount = account({
  id: 'u-admin',
  email: 'admin@example.com',
  displayName: 'Admin Example',
  role: 'admin',
  isSelf: true,
});

/** 名单里的一行。`addedBy` 是**用户 id**（不是名字）—— 界面上要拿账号列表翻成人名。 */
function row(over: Partial<ContributorRow>): ContributorRow {
  return { userId: 'u-x', displayName: 'Somebody', addedBy: 'u-admin', ...over };
}

const twoRows: ContributorRow[] = [
  row({ userId: 'u-alice', displayName: 'Alice Example', addedBy: 'u-admin' }),
  row({ userId: 'u-bob', displayName: 'Bob Example', addedBy: null }),
];

/** 面板视图的默认 props：每个用例只改它关心的那几项。 */
function viewProps(over: Partial<ContributorPanelViewProps> = {}): ContributorPanelViewProps {
  return {
    draft: twoRows,
    loadError: null,
    savedIds: twoRows.map((r) => r.userId),
    users: [alice, bob, carol, dave, adminAccount],
    usersError: null,
    query: '',
    onQueryChange: noop,
    busy: false,
    notice: null,
    onAdd: noop,
    onRemove: noop,
    onSave: noop,
    onRetry: noop,
    ...over,
  };
}

/** 一个形状完整的**资源库列表项**（公开面那一节用）。 */
function resourceItem(over: Partial<ResourceListItem> = {}): ResourceListItem {
  return {
    id: 'r1',
    kind: 'website',
    title: 'Resource One',
    titleEn: null,
    url: 'https://example.com/',
    imageUrl: null,
    summary: 'One line about it',
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
console.log('① 管理员的名单面板：名单、名字、每人一个「移除」');
// ---------------------------------------------------------------------------

/*
 * ⚠️ 三个提取器各自的**探针**：它们写坏时返回空数组，而空数组在下面那些
 *    `deepEqual` / `filter` 里不会混过去 —— 但报出来的会是"组件没渲染出行"，
 *    指向错的地方。先钉住它们（`calendarrender.tsx` 里 `dots()` 有同一条）。
 */
assert.deepEqual(
  rowNames('<span class="contrib__name">X</span>'),
  ['X'],
  '名字提取器本身必须能命中（否则下面几条是在比空数组）',
);
assert.deepEqual(
  ariaLabels('<button aria-label="X"></button>'),
  ['X'],
  '`aria-label` 提取器本身必须能命中',
);
assert.deepEqual(
  buttons('<button type="button" class="cta" disabled="">Save</button>'),
  [{ attrs: ' type="button" class="cta" disabled=""', text: 'Save' }],
  '按钮提取器本身必须能命中',
);

const panel = renderPanelView(viewProps());
const panelText = textOf(panel);

assert.deepEqual(
  rowNames(panel),
  ['Alice Example', 'Bob Example'],
  '两个贡献者 ⇒ 两行，且名字就是他们的显示名（顺序与 props 一致）',
);

const removeLabels = ariaLabels(panel).filter((l) => l.startsWith(t('resourceContrib.remove')));
assert.equal(removeLabels.length, 2, '★ 每人一个「移除」按钮（两个贡献者 ⇒ 两个）');
assert.ok(
  removeLabels[0]?.includes('Alice Example') && removeLabels[1]?.includes('Bob Example'),
  '★★ 每个「移除」的 `aria-label` 必须带上是**谁** —— 一排光秃秃的「移除」对读屏软件毫无信息',
);
assert.ok(
  removeLabels.every((l) => l.includes('u-')),
  '★ `aria-label` 里还要带上 id：显示名不是唯一的（两个人可以都叫 Alex），而两个按钮长得一模一样',
);
assert.ok(
  panelText.includes(textOf(t('resourceContrib.removedBy', { name: 'Admin Example' }))),
  '每行要写出「由 X 添加」—— `addedBy` 是**用户 id**，界面要把它翻成人名',
);
assert.ok(
  panelText.includes(
    textOf(t('resourceContrib.removedBy', { name: t('resourceContrib.unknownUser') })),
  ),
  '★ `addedBy` 为 null（那个人注销了）时显示「未知账号」，而不是空白',
);

/*
 * ★ 面板必须**同时**说清两件事：这些人多了什么权限（hint）、以及这份名单谁看得见（noPublic）。
 * ⚠️ 少任何一句，管理员就会在"要不要把这个人加进来"的判断上缺一半依据。
 */
assert.ok(panelText.includes(textOf(t('resourceContrib.title'))), '面板要有标题');
assert.ok(panelText.includes(textOf(t('resourceContrib.hint'))), '要说清这些人多了什么权限');
assert.ok(
  panelText.includes(textOf(t('resourceContrib.noPublic'))),
  '★ 也要说清"这份名单不会出现在公开页面上"（用户明确要求不展示在资源库里）',
);
ok('名单、名字、「由 X 添加」、每人一个带名字的「移除」都在，两句话也在');

// ---------------------------------------------------------------------------
console.log('①b 加人：候选人 = 全量账号 − 已经在名单里的（可按名字/邮箱搜）');
// ---------------------------------------------------------------------------

/*
 * ★「管理者能在每个资源里面随意修改（添加/删除）贡献者」里的那一半。
 *
 * ⚠️ 过滤在**前端**（端点本来就是全量列表，见 `contributorCandidates` 的注释），
 *    所以这里要断言的是**排除**：已经在名单里的人**不许**再出现在候选人里 ——
 *    否则点一下"加进来"会看起来成功（其实是同一个人的第二行），
 *    而整份替换之后服务端只会存一个 —— 界面和库从此对不上。
 */
const addLabelsOf = (html: string): string[] =>
  ariaLabels(html).filter((l) => l.startsWith(t('resourceContrib.add')));

const candidates = addLabelsOf(panel);
assert.equal(
  candidates.length,
  3,
  '五个账号 − 两个已经在名单里 ⇒ 三个候选人（多一个少一个都是错的）',
);
assert.ok(
  candidates[0]?.includes('Carol Example') && candidates[1]?.includes('Dave Example'),
  '候选人按账号列表的顺序渲染',
);
assert.ok(
  candidates.some((l) => l.includes('Admin Example')),
  '不在名单里的管理员照样是候选人（"谁能当贡献者"与角色无关 —— 用户明确说这不是一个身份组）',
);
assert.ok(
  candidates.every((l) => !l.includes('Alice Example') && !l.includes('Bob Example')),
  '★★ 已经在名单里的人**不许**出现在候选人里',
);
assert.ok(
  candidates.every((l) => l.includes('@')),
  '候选人的 `aria-label` 里要带邮箱：一排连名字都可能重复的按钮，读屏软件需要能分辨',
);
assert.ok(
  panelText.includes(textOf(t('resourceContrib.max', { max: CONTRIBUTORS_MAX }))),
  `★ 要说清上限（「最多 ${String(CONTRIBUTORS_MAX)} 人」）—— 上限的真相在 shared`,
);
assert.ok(
  panel.includes(t('resourceContrib.searchPlaceholder')),
  '要有搜索框（`placeholder` 是它的提示文字）',
);

/* 按名字或邮箱都能搜到（⚠️ 大小写无关：输入法/粘贴进来的大小写不该影响结果）。 */
assert.equal(addLabelsOf(renderPanelView(viewProps({ query: 'DAVE' }))).length, 1, '按名字搜');
assert.equal(
  addLabelsOf(renderPanelView(viewProps({ query: 'carol@example.com' }))).length,
  1,
  '按邮箱搜（管理员手上有时只有邮箱）',
);
/*
 * ⚠️ 搜不到人是**正常情况**，所以它必须有一句话，而不是一片空白 ——
 *    空白在界面上和"候选人都没取到/界面坏了"长得一模一样。
 */
const nobody = renderPanelView(viewProps({ query: 'zzz-nobody-here' }));
assert.equal(addLabelsOf(nobody).length, 0, '搜不到人 ⇒ 没有候选人');
assert.ok(
  textOf(nobody).includes(textOf(t('resourceContrib.none'))),
  '★ 搜不到人要说「没有可选的人了」，不是留一片空白',
);
/* ⚠️ 账号列表取失败**不牵连**名单：名单照常显示，只有"加人"这一格报错。 */
const usersFailed = renderPanelView(
  viewProps({ users: null, usersError: `${t('auth.genericError')} HTTP 502` }),
);
assert.ok(usersFailed.includes('notice--bad'), '账号列表取失败时，"加人"这一格要报错');
assert.ok(usersFailed.includes('502'), '并且带上原因');
assert.deepEqual(
  rowNames(usersFailed),
  ['Alice Example', 'Bob Example'],
  '★ 账号列表失败**不许**把名单一起清空（两件事的失败必须分开）',
);
ok('候选人排除了名单里的人，名字/邮箱都能搜，搜不到有话说，账号列表失败不牵连名单');

// ---------------------------------------------------------------------------
console.log('② ★★ 反向：不是管理员 ⇒ 整个面板一个字都不渲染');
// ---------------------------------------------------------------------------

const notAdmin = renderPanelContainer({ resourceId: 'r1', canManage: false });
assert.equal(
  notAdmin,
  '',
  '★ 非管理员（canManage: false）时产物必须是**空串** —— 不是"渲染成灰色"、' +
    '也不是"渲染一个空壳"：用户要求的是**只有管理者看得到**，' +
    '而空壳等于把"这里有名单"这件事告诉他。',
);
for (const needle of [t('resourceContrib.title'), t('resourceContrib.hint'), 'Alice Example']) {
  assert.equal(notAdmin.includes(needle), false, `★ 非管理员的产物里连「${needle}」都不该出现`);
}

/*
 * ⚠️⚠️ **正向对照**：上面那几条"找不到"在"渲染炸了"或"整块被挪进别的分支"时
 *    也照样成立 —— 那是假绿。所以同一次运行里必须有一份**能渲染出来**的。
 *    （去掉这个对照，把守卫改成 `if (true) return null` 也全绿。）
 */
const adminPanel = renderPanelContainer({ resourceId: 'r1', canManage: true });
assert.ok(
  adminPanel.includes(t('resourceContrib.title')),
  '★（正向对照）canManage: true 时必须渲染出面板标题 —— 没有这一条，上面那些"找不到"是恒真的',
);
assert.notEqual(adminPanel, '', '（正向对照）管理员的产物不能是空串');
/*
 * ⚠️ 覆盖边界：管理员这一份**只到"加载中"**（面板打开时现取名单，而 SSR 不跑 effect）。
 *    真的名单长什么样由 ① / ③ / ④ 那几节用 `ContributorPanelView` 验。
 *    这里顺带钉住"取数中要说加载中，而不是渲染一个空名单"（空名单看起来像"没有贡献者"）。
 */
assert.ok(
  textOf(adminPanel).includes(textOf(t('common.loading'))),
  '面板打开时是**现取**名单的：还没取到时说「加载中」，不是渲染一个空名单',
);
ok('canManage: false ⇒ 空串；canManage: true ⇒ 面板在（两条一起才有意义）');

// ---------------------------------------------------------------------------
console.log('③ 空名单是正常状态，不是错误');
// ---------------------------------------------------------------------------

const empty = renderPanelView(viewProps({ draft: [], savedIds: [] }));
const emptyText = textOf(empty);
assert.ok(
  emptyText.includes(textOf(t('resourceContrib.empty'))),
  '★ 空名单要说「还没有贡献者」那一句 —— 用户原话「资源可以没有贡献者」，它是**常态**',
);
assert.equal(
  ariaLabels(empty).filter((l) => l.startsWith(t('resourceContrib.remove'))).length,
  0,
  '★ 空名单不该有任何「移除」按钮（有的话说明它在渲染一个不存在的行）',
);
assert.equal(
  rowNames(empty).length,
  0,
  '空名单不该有名单行（一个空字符串的行看起来很像是渲染坏了）',
);
/*
 * ⚠️ 空名单**不能**长得像出错：不用错误色的提示条、不出现「没保存成功」。
 *    写成红色提示的话，管理员会以为自己弄坏了什么 —— 而他什么都没做。
 */
assert.equal(
  empty.includes('notice--bad'),
  false,
  '★ 空名单不是错误状态：不许出现 `notice--bad` 那种提示条',
);
assert.equal(
  emptyText.includes(textOf(t('resourceContrib.failed'))),
  false,
  '空名单不该出现"没保存成功"',
);
assert.ok(
  emptyText.includes(textOf(t('resourceContrib.save'))),
  '★ 空名单照样要有「保存名单」：把名单清空是一个合法操作（整份替换成空数组）',
);
ok('空名单：说「还没有贡献者」、没有移除按钮、不像出错、保存键还在');

// ---------------------------------------------------------------------------
console.log('④ 没有显示名的人：回退文案，绝不留空');
// ---------------------------------------------------------------------------

const ghost = renderPanelView(
  viewProps({
    draft: [row({ userId: 'u-ghost', displayName: null, addedBy: null })],
    savedIds: ['u-ghost'],
  }),
);
/*
 * ★ 断言的是**那一行的可见名字**恰好等于回退文案（而不是"页面上某处出现了这四个字"）：
 *   `Contributor.displayName` 是**可空**的（账号没设显示名），留空的话那一行
 *   看起来像界面坏了 —— 而它真正想说的是"这个账号没有显示名"。
 */
assert.deepEqual(
  rowNames(ghost),
  [t('resourceContrib.unknownUser')],
  '★ displayName 为 null ⇒ 显示「未知账号」，**不是空白**',
);
assert.ok(
  ghost.includes('u-ghost'),
  '★ 同时把裸 id 摆出来：两行「未知账号」对管理员是没法做判断的（他要决定移除哪一个）',
);
ok('displayName 为 null ⇒ 回退文案 + 裸 id（不是空白）');

// ---------------------------------------------------------------------------
console.log('⑤ 保存键：名单没变时禁用（并且说明为什么）');
// ---------------------------------------------------------------------------

/*
 * ★ 判据：**名单没变 ⇒ 「保存名单」禁用**。
 *
 * 为什么选"禁用"而不是"点了照样发、然后回一句已保存"：
 * 整份替换是**幂等**的（见 shared/contributors.ts 的 `ContributorsInputSchema`），
 * 服务端对"发一份和现在一模一样"的答案必然是 200 —— 也就是说按键会成功，
 * 而**什么都没发生**。那种"成功"是假话：用户会以为自己刚做的操作生效了，
 * 并且习惯了"它总会说已保存"之后不再看提示。
 *
 * ⚠️ 但**禁用的控件必须说明为什么**（本仓 `admin` 那组词条的注释里写着同一条规矩），
 *    所以不变时旁边要有一句「名单已保存」—— 它同时是解释和事实。
 */
const unchanged = renderPanelView(viewProps());
const saveIdle = buttons(unchanged).find((b) => b.text === t('resourceContrib.save'));
assert.ok(saveIdle, '「保存名单」按钮必须在（找不到它说明下面的断言全都在验空气）');
assert.ok(
  saveIdle.attrs.includes('disabled'),
  '★ 名单没变 ⇒ 保存键**禁用**（否则它会报一次什么都没发生的"成功"）',
);
assert.ok(
  textOf(unchanged).includes(textOf(t('resourceContrib.saved'))),
  '★ 禁用的控件要说明为什么：不变时旁边就是那句「名单已保存」',
);

/* ⚠️ 正向对照：名单**变了**就必须按得动（只验"禁用"那一半的话，写成恒禁用也全绿）。 */
const changed = renderPanelView(
  viewProps({
    draft: [...twoRows, row({ userId: 'u-carol', displayName: 'Carol Example' })],
    savedIds: twoRows.map((r) => r.userId),
  }),
);
const saveDirty = buttons(changed).find((b) => b.text === t('resourceContrib.save'));
assert.ok(saveDirty, '（正向对照）名单变了时保存键也得在');
assert.equal(
  saveDirty.attrs.includes('disabled'),
  false,
  '★（正向对照）名单变了 ⇒ 保存键**可点** —— 少了这一条，"永远禁用"也是绿的',
);

/* 保存进行中：按钮说「保存中…」且不可重复点（本仓一贯的做法，和 `liveManage` 一样）。 */
const saving = renderPanelView(viewProps({ busy: true }));
const saveBusy = buttons(saving).find((b) => b.text === t('resourceContrib.saving'));
assert.ok(saveBusy, '保存进行中时按钮要说「保存中…」');
assert.ok(saveBusy.attrs.includes('disabled'), '保存进行中时不能让人再点一次');

/* ★ 成功与失败都要看得出来（本仓的要求：**不许静默**）。 */
const savedOk = renderPanelView(
  viewProps({ notice: { ok: true, text: t('resourceContrib.saved') } }),
);
assert.ok(textOf(savedOk).includes(textOf(t('resourceContrib.saved'))), '保存成功要看得见');
const savedBad = renderPanelView(
  viewProps({ notice: { ok: false, text: `${t('resourceContrib.failed')} boom` } }),
);
assert.ok(savedBad.includes('notice--bad'), '保存失败要用错误色的提示条');
assert.ok(
  textOf(savedBad).includes(textOf(t('resourceContrib.failed'))),
  '失败要有那句「没保存成功」',
);
assert.ok(
  savedBad.includes('boom'),
  '★ 失败还要带上**具体原因**（403？404？连不上？），不能只有一句笼统的',
);
ok('保存键：没变⇒禁用+说明；变了⇒可点；进行中⇒「保存中…」；成功/失败都看得见');

// ---------------------------------------------------------------------------
console.log('⑥ ★★ 公开面没有贡献者（渲染层 + 源码层）');
// ---------------------------------------------------------------------------

/*
 * ⚠️⚠️ 这一节是用户那句「**不直接展示在资源库中**」的守卫，也是**最容易在以后
 *      被人悄悄破坏**的一条：把名单渲染到列表页或详情页上**不会报错**，
 *      页面看起来完全正常，只是把"谁能直接改这一条"告诉给了每一个访客。
 *
 * 为什么是**两层**：
 *   ① 渲染层覆盖的是"真的渲染得出来"的那几块：公开卡片（`ResourceCard`，
 *      列表页和相关推荐都用它）与详情页。
 *      ⚠️ 但 `ResourceDetailPage` **自己取数**，而 `renderToStaticMarkup`
 *      不跑 effect ⇒ 它永远停在"加载中"，**取数那一支渲染不到**
 *      （`calendarrender.tsx` 的文件头为 `CalendarDetail` 写过同一件事）。
 *   ② 所以内容那一半只能靠**源码层**：`apps/web/src` 里除了三个允许的文件，
 *      任何一处出现 `contributor` 都算红。它才是"详情页上冒出一个贡献者名字"
 *      这件事**真的**能被抓住的地方。
 *      （这一层不是"顺手 grep"：去掉它，第 ⑥ 条就只剩一个永远停在加载中的页面，
 *        而那个页面无论谁往里面塞什么都验不出来。）
 */

/* ---- ① 渲染层 ---- */
const publicCard = renderPublicCard(resourceItem());
/*
 * ⚠️ 详情页要包 `AuthProvider`：它在渲染的**第一步**就调 `useAuth()`（为了决定
 *    "建议修改"那个按钮显不显示），而 `useAuth` 在 Provider 外直接 throw。
 * ⚠️ 这里给的是**匿名访客**（`initialUser: null`）—— 详情页的公开面就是访客看到的
 *    那一份，拿管理员来渲染反而验不到"访客看不见什么"。
 */
const publicDetail = renderToStaticMarkup(
  createElement(
    I18nextProvider,
    { i18n },
    createElement(
      AuthProvider,
      { initialUser: null },
      createElement(MemoryRouter, null, createElement(ResourceDetailPage)),
    ),
  ),
);
/*
 * ⚠️ 探针：公开面必须**真的渲染出了东西**。"产物里没有贡献者"在一个空串上
 *    是恒真的 —— 先证明这一份产物里有它该有的东西。
 */
assert.ok(
  textOf(publicCard).includes(textOf('Resource One')),
  '探针：公开卡片真的渲染出来了（否则下面几条是在验一个空串）',
);
assert.notEqual(publicDetail, '', '探针：详情页（加载中那一屏）也要有产物');

const publicAll = publicCard + publicDetail;
const publicText = textOf(publicAll);

/*
 * ★ 判据一：**词条的译文**一个都不许出现。逐条从**词典本身**取（不是手抄一份），
 *   这样以后给 `resourceContrib` 加词条时，这一条自动跟着变严。
 */
const bundle = i18n.getResourceBundle(LANG, 'translation') as Record<string, unknown>;
const contribBlock = (bundle.resourceContrib ?? {}) as Record<string, string>;
const contribValues = Object.values(contribBlock);
assert.ok(
  contribValues.length > 0,
  '★ 探针：词典里必须读得到 `resourceContrib` 这一块（读不到的话下面那条是恒真的空跑）',
);
const leakedWords = contribValues
  .map((v) => textOf(emText(v)))
  .filter((v) => v !== '' && publicText.includes(v));
assert.deepEqual(
  leakedWords,
  [],
  `★ 公开面出现了贡献者的词条：${leakedWords.join(' / ')} —— 用户明确要求"不直接展示在资源库里"`,
);
/* 带插值的那两条要按"渲染之后的样子"再查一遍（原文里是 `{{max}}`）。 */
for (const value of [
  t('resourceContrib.max', { max: CONTRIBUTORS_MAX }),
  t('resourceContrib.removedBy', { name: 'X' }),
]) {
  assert.equal(
    publicText.includes(textOf(value)),
    false,
    `★ 公开面不该出现「${value}」（那是只有管理员该看到的一句话）`,
  );
}

/* ★ 判据二：裸 key（`resourceContrib.title` 这种）与面板的类名一个都不许出现。 */
assert.equal(
  /resourceContrib\.[A-Za-z]+/.test(publicAll),
  false,
  '★ 公开面上出现了裸 key：那说明有人在公开面调用了 `resourceContrib.*`（打错 key 时它会原样印出来）',
);
for (const marker of ['contrib__', 'contribnote', 'resvis']) {
  assert.equal(
    publicAll.includes(marker),
    false,
    `★ 公开面不该出现面板/动作区的类名「${marker}」（出现了说明那一块被搬到了公开面上）`,
  );
}

/* ---- ② 源码层 ---- */
/*
 * ⚠️ 允许名单**只有三个文件**，而且每一个都要能读懂为什么：
 *   · `components/ContributorPanel.tsx` —— 贡献者这条功能的前端本身；
 *   · `lib/api.ts` —— 客户端函数（`fetchResourceContributors` 等）；
 *   · `routes/EditResource.tsx` —— 挂载点（编辑页本来就只有管理者会去）。
 * 其它任何地方出现 `contributor` 都要**先来这里说清楚** —— 因为公开面
 * （列表页、卡片、详情页、主页、订阅…）全都在这个目录里，
 * 而"贡献者出现在公开面上"是**不会报错**的那一类错误。
 */
const SRC_DIR = join(import.meta.dirname, '..', 'src');
const ALLOWED_SOURCES = new Set([
  'components/ContributorPanel.tsx',
  'lib/api.ts',
  'routes/EditResource.tsx',
]);
const sourceOffenders: string[] = [];
for (const rel of readdirSync(SRC_DIR, { recursive: true })) {
  const relPath = String(rel).replaceAll('\\', '/');
  if (!/\.tsx?$/.test(relPath)) continue;
  if (ALLOWED_SOURCES.has(relPath)) continue;
  const source = readFileSync(join(SRC_DIR, relPath), 'utf8');
  if (/contributor/i.test(source)) sourceOffenders.push(relPath);
}
assert.deepEqual(
  sourceOffenders,
  [],
  '★★ 公开面或别的页面里出现了 `contributor`：贡献者只在后台记录、' +
    '只由管理员在编辑页管理（用户原话「不直接展示在资源库中」）。' +
    `如果那是**又一个**合法的管理界面，请把它加进 ALLOWED_SOURCES 并写清理由；` +
    `如果是公开面，那就是这一条要抓的缺陷。命中的是：${sourceOffenders.join(', ')}`,
);
/*
 * ⚠️ 探针：这一层的扫描必须**真的能命中** —— 把它写坏（比如路径拼错、返回空列表）
 *    时上面那条 `deepEqual([], [])` 会一直绿，而它是详情页那一半**唯一**的守卫。
 */
assert.ok(
  readdirSync(SRC_DIR, { recursive: true }).some((f) =>
    String(f).replaceAll('\\', '/').endsWith('components/ContributorPanel.tsx'),
  ),
  '★ 探针：源码扫描必须真的走到了 `apps/web/src`（路径写错的话，上面那条是恒真的）',
);
const probeFile = readFileSync(join(SRC_DIR, 'components', 'ContributorPanel.tsx'), 'utf8');
assert.ok(
  /contributor/i.test(probeFile),
  '★ 探针：扫描器本身能命中一个**已知**含有贡献者的文件（否则它是恒真的空跑）',
);
ok('公开面（卡片 + 详情页）没有贡献者的译文/裸 key/类名，且 src 里只有三个允许的文件提到它');

// ---------------------------------------------------------------------------
console.log('⑦ 贡献者自己的两个按钮（直编提示 / 下架恢复）');
// ---------------------------------------------------------------------------

/*
 * ⚠️ 这两块住在 `components/ContributorPanel.tsx` 里而不是编辑页里，唯一的原因是
 *    `routes/EditResource.tsx` **渲染不到**（它自己取数，SSR 停在加载中）——
 *    而这两件事恰好是这一轮最不该没人守的：贡献者**不能**看到删除入口、
 *    下架按钮的判据必须是**服务端给的**。
 */
const directNote = renderDirectNote({ canDirectEdit: true });
/*
 * ★★ `resourceContrib.directEdit` 里有 `**强调**`：裸 `t()` 会让用户看到
 *    一对字面星号（"改动**直接生效**"）。这一条断言它真的变成了 `<strong>`。
 *    （本仓为此专门有一条静态守卫：`services/api/src/i18n-keys.test.ts`。）
 */
const emphasis = emphasized(t('resourceContrib.directEdit'));
assert.notEqual(emphasis, '', '★ 探针：这个词条里**确实**有一对 `**`（没有的话下面两条是空跑）');
assert.ok(
  directNote.includes(`<strong>${emphasis}</strong>`),
  '★★ 直编提示里的强调必须渲染成 `<strong>` —— 裸 `t()` 会让用户看到一对星号',
);
assert.equal(textOf(directNote).includes('**'), false, '★ 直编提示里不许出现字面的 `**`');
assert.ok(
  textOf(directNote).includes(textOf(emText(t('resourceContrib.directEdit')))),
  '★ 提示的文字要完整（去标记之后逐字相同）',
);
/* ⚠️ 反向 + 正向对照（同 ② 那一条的理由）。 */
assert.equal(
  renderDirectNote({ canDirectEdit: false }),
  '',
  '★ 不是贡献者 ⇒ 那句提示一个字都不渲染',
);
assert.notEqual(renderDirectNote({ canDirectEdit: true }), '', '（正向对照）是贡献者就必须有它');

const barHidden = renderVisibilityBar({
  canHide: true,
  hidden: false,
  busy: false,
  failureText: null,
  onToggle: noop,
});
const barShown = renderVisibilityBar({
  canHide: true,
  hidden: true,
  busy: false,
  failureText: null,
  onToggle: noop,
});
assert.ok(
  textOf(barHidden).includes(textOf(t('resourceContrib.hide'))),
  '★ 上架状态 ⇒ 按钮说「下架这一条」',
);
assert.equal(
  textOf(barHidden).includes(textOf(t('resourceContrib.restore'))),
  false,
  '★ 上架状态不该出现「恢复上架」（两个都在的话用户不知道该点哪个）',
);
assert.ok(
  textOf(barShown).includes(textOf(t('resourceContrib.restore'))),
  '★★ `status === "hidden"` ⇒ 必须显示「恢复上架」（用户明确要求贡献者"能下架也能恢复"）',
);
assert.equal(
  textOf(barShown).includes(textOf(t('resourceContrib.hide'))),
  false,
  '★ 已下架时不该再出现「下架这一条」',
);
for (const html of [barHidden, barShown]) {
  assert.ok(
    textOf(html).includes(textOf(t('resourceContrib.hideHint'))),
    '★ 下架那句要做到"知情同意"：说清公开页面看不到、但内容和版本历史都还在、随时能恢复',
  );
}
const barFail = renderVisibilityBar({
  canHide: true,
  hidden: false,
  busy: false,
  failureText: 'boom',
  onToggle: noop,
});
assert.ok(
  textOf(barFail).includes('boom'),
  '★ 下架/恢复失败必须看得见（不许静默），而且要带上原因',
);
assert.equal(
  renderVisibilityBar({
    canHide: false,
    hidden: false,
    busy: false,
    failureText: null,
    onToggle: noop,
  }),
  '',
  '★ 服务端说不能下架（`canHide: false`）⇒ 整块不渲染（看不见比看得见点不动好）',
);

/*
 * ★★ 用户原话：「贡献者可以…修改/下架…（**不实际删除**）」。
 * ⇒ 这两块里不许有任何删除入口。断言的是**词条**（而不是某个类名）：
 *   只要渲染出「删除」这两个字，就读作一个有删除含义的入口。
 */
for (const [where, html] of [
  ['直编提示', directNote],
  ['下架条', barHidden],
  ['下架条（已下架）', barShown],
  ['下架条（失败）', barFail],
  ['名单面板', panel],
] as const) {
  const words = textOf(html);
  for (const key of ['authoring.deleteAction', 'authoring.deleteTitle']) {
    assert.equal(
      words.includes(textOf(t(key))),
      false,
      `★★ ${where}里出现了「${t(key)}」—— 贡献者**不实际删除**（用户明确要求），` +
        '而删除那条路的显示条件在编辑页的危险区里，一个字都不该放宽到这里',
    );
  }
}
ok('直编提示（含 `<strong>` 强调）、下架/恢复（判据来自服务端）、失败可见、无删除入口');

// ---------------------------------------------------------------------------
console.log('⑧ 词条：冻结的 19 个 key 都在，而且两种语言都有真值');
// ---------------------------------------------------------------------------

/*
 * ⚠️ i18next 对**查不到的 key** 的行为是**原样返回 key**（不报错），
 *    于是打错一个字母的后果是页面上印出一串 `resourceContrib.xxyy` ——
 *    而它既不会被类型检查发现（`t` 的入参是 string），也不会被任何别的门禁发现。
 * 下面这张表是**冻结的 key 清单**（本轮与需求一起定下来的），逐条查。
 *
 * ⚠️ 它原来是 21 条，其中两条在收尾时**删掉了**（不是漏了）：
 *   · `nonePicked` —— 加人的交互是"候选列表点一下即进草稿"，没有"选中区"，
 *     所以不存在"还没选人"这个状态；
 *   · `managerOnly`（"这份名单只有管理员能看和改"）—— 它与第 ② 节那条断言
 *     （非管理员渲染出来必须是**空串**）**互相矛盾**：任何给非管理员看的解释
 *     都会让那一节红。一条永远不可能出现的词条留在字典里，就是给下一个人
 *     挖的坑（他会以为"漏接了"，然后把它接上，然后第 ② 节红）。
 *   ⇒ 判据是：**词条存在 ⇔ 有一个真实状态需要它**。多出来的删掉。
 */
const FROZEN_KEYS = [
  'title',
  'hint',
  'empty',
  'add',
  'remove',
  'none',
  'save',
  'saving',
  'saved',
  'failed',
  'searchPlaceholder',
  'noPublic',
  'removedBy',
  'unknownUser',
  'max',
  'directEdit',
  'hide',
  'restore',
  'hideHint',
] as const;
assert.equal(FROZEN_KEYS.length, 19, '探针：冻结的清单就是 19 条');
for (const key of FROZEN_KEYS) {
  const full = `resourceContrib.${key}`;
  assert.ok(i18n.exists(full), `★ 词条 ${full} 在【${LANG}】里不存在（界面上会原样印出这个 key）`);
  assert.notEqual(t(full), full, `★ 词条 ${full} 在【${LANG}】里没有真值`);
}
ok(`19 个 key 在【${LANG}】里都存在且有真值`);

// ---------------------------------------------------------------------------
console.log('⑨ ★★ 删标签：编辑者看得到那个 ✕，审核员 / 访客 / 未登录一个字都没有');
// ---------------------------------------------------------------------------

/*
 * 用户原话：「允许编辑者删除资源库标签，被删除的标签对应的资源保留，只是去掉其标签」
 * （2026-09-17）。
 *
 * ===========================================================================
 * 这一节守的是那句话里的**两半**，而且两半都不会报错
 * ===========================================================================
 *   ① 「允许**编辑者**」—— 判据写成 `resource.moderate`（EDITOR_CAPS：editor /
 *      admin / owner）。写宽了（比如换成 `can` 的兜底、或者干脆不判）**界面看起来
 *      完全正常**，只是每个访客都能删掉全站的标签；写窄了（换成 `user.moderate`）
 *      表现是"编辑点不动"，同样不报错。所以四种人各渲染一遍：
 *      **编辑者**（有 ✕）、**审核员**（没有 —— 审核 ≠ 治理）、**访客**、**未登录**。
 *   ② 「资源本身保留」—— 确认那一句必须说出影响几条、以及资源不会被删。
 *      这句话写错的代价不是"报错"，而是**用户不敢按**或者**按了才发现删错了**。
 *
 * ===========================================================================
 * ⚠️ 为什么四份登录态都要**真的过一遍 `useCan`**
 * ===========================================================================
 * 判据住在容器里（`TagCloud` 的 `useCan('resource.moderate')`）。如果自检只给组件
 * 喂一个 `canDelete` 布尔量，那它验的是"给我 true 就会渲染 ✕"—— 而"编辑者拿到的是
 * true、审核员拿到的是 false"这两件事**一个字都验不到**（那正是最容易写错的地方：
 * 把 `resource.moderate` 写成 `can` 的兜底、或者写成 `user.moderate`，
 * 两种写法都能让"给我 true 就渲染"那条断言保持绿色）。
 * 所以这里用 `AuthProvider` 的 `initialUser` 注入**真角色**，渲染的是真容器。
 *
 * ⚠️ 覆盖边界：脚本只渲到"确认中/进行中/结果"这几屏的**静态样子**
 *    （`renderToStaticMarkup` 不跑 effect、不派发事件）—— 点 ✕ 会不会真的进确认、
 *    确认之后发出去什么、服务端改了哪几行，全在 `services/api/src/resource-tags.test.ts`。
 */

/** 标签云的固定输入。⚠️ 标签名一律 **ASCII**：⑪ 那一节要断言英文界面零汉字。 */
const tagFixture: TagCount[] = [
  { tag: 'tools', count: 3 },
  { tag: 'video', count: 1 },
];

/** 产物里所有「删除标签」按钮的**开始标签**（判"那个 ✕ 在不在"）。 */
function delButtons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*class="tagitem__del"[^>]*>/g)].map((m) => m[0] ?? '');
}

/** 把「删除标签」按钮整段抠掉（用来对照"编辑者与访客只差这几个 ✕"）。 */
function withoutDelButtons(html: string): string {
  return html.replace(/<button[^>]*class="tagitem__del"[^>]*>×<\/button>/g, '');
}

/* ⚠️ 两个提取器的**探针**：写坏时它们返回空数组/原串，下面那些"找不到"会全部假绿。 */
assert.equal(
  delButtons('<button type="button" class="tagitem__del">×</button>').length,
  1,
  '探针：「删除标签」按钮提取器本身必须能命中',
);
assert.equal(
  withoutDelButtons('<i>a</i><button type="button" class="tagitem__del">×</button><i>b</i>'),
  '<i>a</i><i>b</i>',
  '探针：抠掉「删除标签」按钮的那一步本身必须有效',
);

/** 一个形状完整的用户（只换角色）—— 这里用来注入"编辑者 / 审核员 / 管理员"的登录态。 */
function userAs(role: UserSelf['role']): UserSelf {
  return { ...adminUser, id: `u-${role}`, role, email: `${role}@example.com` };
}

/** 渲染**真容器**（判据是它自己的 `useCan`），登录态由参数注入。 */
const renderCloudAs = (user: UserSelf | null): string =>
  renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(
        AuthProvider,
        { initialUser: user },
        createElement(TagCloud, {
          tags: tagFixture,
          activeTag: undefined,
          onSelect: noop,
          onDeleted: noop,
        }),
      ),
    ),
  );

/** 纯视图的默认 props（渲染确认/进行中/结果那几屏用）。 */
function cloudViewProps(over: Partial<TagCloudViewProps> = {}): TagCloudViewProps {
  return {
    tags: tagFixture,
    activeTag: undefined,
    onSelect: noop,
    canDelete: true,
    confirming: null,
    busy: false,
    notice: null,
    onRequestDelete: noop,
    onCancelDelete: noop,
    onConfirmDelete: noop,
    ...over,
  };
}

const renderCloudView = (over: Partial<TagCloudViewProps> = {}): string =>
  renderToStaticMarkup(
    createElement(I18nextProvider, { i18n }, createElement(TagCloudView, cloudViewProps(over))),
  );

/* ---- ① 编辑者：两枚标签 ⇒ 两个 ✕，而且每个都能指名道姓 ---- */
const cloudAsEditor = renderCloudAs(userAs('editor'));
const editorDels = delButtons(cloudAsEditor);
assert.equal(editorDels.length, 2, '★ 两枚标签 ⇒ 两个「删除标签」按钮（多一个少一个都是错的）');
assert.ok(
  ariaLabels(cloudAsEditor).includes(t('resources.tagDeleteAction', { tag: 'tools' })) &&
    ariaLabels(cloudAsEditor).includes(t('resources.tagDeleteAction', { tag: 'video' })),
  '★★ 每个 ✕ 的 `aria-label` 必须写出是**哪一个**标签 —— 一排一模一样的 ✕ 对读屏软件毫无信息',
);
assert.ok(
  delButtons(cloudAsEditor).every((b) => b.includes('title=')),
  '★ 鼠标悬停也要能看出删的是哪个标签（`title` 与 `aria-label` 同一句话）',
);
/* 探针：这一份产物必须**真的**渲染出了标签（否则上面几条是在验空气）。 */
assert.ok(
  textOf(cloudAsEditor).includes('tools') && cloudAsEditor.includes('tagchip'),
  '探针：编辑者那一份必须真的渲染出了标签行',
);

/* ---- ② 审核员 / 访客 / 未登录：一个 ✕ 都没有，而标签行照常 ---- */
const cloudAsReviewer = renderCloudAs(userAs('reviewer'));
const cloudAsVisitor = renderCloudAs(userAs('user'));
const cloudAsGuest = renderCloudAs(null);

assert.equal(
  delButtons(cloudAsReviewer).length,
  0,
  '★ 审核员**没有** `resource.moderate`（它属于 EDITOR_CAPS）⇒ 一个 ✕ 都不该有 —— ' +
    '审核和治理是两种判断，能批一条内容不等于能清全站的标签',
);
for (const [who, html] of [
  ['访客', cloudAsVisitor],
  ['未登录', cloudAsGuest],
] as const) {
  assert.equal(delButtons(html).length, 0, `★ ${who}不该看到任何 ✕`);
  /* ⚠️ 反向断言最容易假绿（整块没渲染时"找不到"也成立）⇒ 每条都跟一句正向对照。 */
  assert.ok(
    textOf(html).includes('tools') && html.includes('tagchip'),
    `（正向对照）${who}照样要看到标签行本身 —— 浏览不设门槛，只是不能删`,
  );
}

/*
 * ★★ 三份产物之间的**唯一**差别就是那几个 ✕。
 * ⚠️ 这条比"编辑者有、访客没有"更强：它把"编辑者那一份还多了/少了别的东西"
 *    （比如多一句提示、少一个计数、类名不一样）也一起钉住了 ——
 *    那种差别在界面上很难被看见，而它会让"同一份界面、只是多了个按钮"这句话变成假的。
 */
assert.equal(
  withoutDelButtons(cloudAsEditor),
  cloudAsVisitor,
  '★★ 抠掉那几个 ✕ 之后，编辑者与访客的产物必须**逐字相同**',
);

/* ---- ③ 二次确认：说清影响几条 + 资源保留 ---- */
const cloudConfirm = renderCloudView({ confirming: 'tools' });
const confirmText = t('resources.tagDeleteConfirm', { tag: 'tools', count: 3 });
assert.ok(
  textOf(cloudConfirm).includes(textOf(confirmText)),
  `★ 确认那一句要**逐字**出现（含标签名与条数）：${confirmText}`,
);
assert.ok(
  textOf(cloudConfirm).includes(textOf(t('resources.tagDeleteConfirmAction'))),
  '★ 确认键要在（只说一句提示、不给动作的话，用户会不知道下一步是什么）',
);
assert.ok(
  textOf(cloudConfirm).includes(textOf(t('common.cancel'))),
  '★ 取消键要在（只给一个"确认删除"等于逼人做那件事）',
);
/*
 * ⚠️ 条数来自**这一枚 chip 自己的计数**（`tagCountOf`），不是前端另算的一个数：
 *    界面上的数字与它旁边那枚 chip 上的数字不一致时，用户会以为其中一个是错的。
 */
assert.equal(tagCountOf(tagFixture, 'tools'), 3, '确认里的条数 = 那枚 chip 上的条数');
assert.equal(tagCountOf(tagFixture, 'nope'), 0, '（对照）查不到的标签回 0，而不是 NaN/undefined');
/* 反向：没有在确认时，那一句一个字都不该出现。 */
assert.equal(
  textOf(renderCloudView()).includes(textOf(confirmText)),
  false,
  '★ 没点 ✕ 时不该出现确认那一句（否则它就成了页面上的一段常驻文案）',
);
/*
 * ★★ 且**非编辑者连"确认中"都渲染不出来**：`confirming` 有值但 `canDelete` 为假时，
 *    确认那一段必须整块消失 —— 判据只有 `canDelete` 一个（不留第二条会漂移的路）。
 */
assert.equal(
  textOf(renderCloudView({ canDelete: false, confirming: 'tools' })).includes(textOf(confirmText)),
  false,
  '★ 非编辑者（canDelete: false）即使处在"确认中"也不许渲染那一句',
);

/* ---- ④ 进行中：按钮说"删除中…"且不可重复点（与 liveManage 同一套做法） ---- */
const cloudBusy = renderCloudView({ confirming: 'tools', busy: true });
assert.ok(
  textOf(cloudBusy).includes(textOf(t('resources.tagDeleteWorking'))),
  '★ 删除进行中时要说明（"点了没反应"与"点对了"长得一样）',
);
assert.ok(
  buttons(cloudBusy)
    .filter((b) => b.text === t('resources.tagDeleteWorking'))
    .every((b) => b.attrs.includes('disabled')),
  '★ 进行中时确认键要禁用（不然会重复发请求）',
);
assert.equal(
  delButtons(cloudBusy).every((b) => b.includes('disabled')),
  true,
  '★ 进行中时那一排 ✕ 也要禁用 —— 否则可以一边删一边点别的标签',
);

/* ---- ⑤ 结果：成功与失败都看得见（本仓"不许静默"的底线） ---- */
const doneText = t('resources.tagDeleteDone', { tag: 'tools', resources: 2, revisions: 1 });
const cloudDone = renderCloudView({ notice: { ok: true, text: doneText } });
assert.ok(textOf(cloudDone).includes(textOf(doneText)), '★ 成功要说清改了几条资源、几个待审版本');
assert.ok(cloudDone.includes('notice--ok'), '成功用普通提示条（不是错误色）');

const cloudFailed = renderCloudView({
  notice: { ok: false, text: `${t('resources.tagDeleteFailed')} 403` },
});
assert.ok(textOf(cloudFailed).includes(textOf(t('resources.tagDeleteFailed'))), '★ 失败要有那句话');
assert.ok(
  cloudFailed.includes('notice--bad') && cloudFailed.includes('403'),
  '★★ 失败要用错误色，并且带上**具体原因**（403？连不上？）—— 只有一句笼统的"失败了"等于没说',
);

/*
 * ★★ 删掉**最后一个**标签之后：标签行整行消失，而结果那句话必须还在。
 *
 * ⚠️ 这是唯一一个"提示会跟着内容一起消失"的地方（`ResourceList` 里那次条件原本是
 *    `tags.length > 0`）：不留这一条的话，删最后一个标签的人看到的是**一片空白** ——
 *    既没有标签行、也没有"删掉了什么"，最自然的解读是"刚才那一下把页面弄坏了"。
 */
const cloudEmptyAfterDelete = renderCloudView({ tags: [], notice: { ok: true, text: doneText } });
assert.ok(cloudDone.includes('tagcloud'), '（正向对照）有标签时那一行必须在');
assert.equal(
  cloudEmptyAfterDelete.includes('tagcloud'),
  false,
  '★ 一个标签都没有时，标签行（连「按标签筛选：」那句）整行消失 —— 不留一行空的',
);
assert.ok(
  textOf(cloudEmptyAfterDelete).includes(textOf(doneText)),
  '★★ 但结果提示**必须留着**：那是唯一需要它的时刻（否则删完最后一个标签是一片空白）',
);
assert.equal(
  delButtons(cloudEmptyAfterDelete).length,
  0,
  '★ 没有标签时不该有 ✕（渲染一个不存在的行的那种 bug）',
);

/* ---- ⑥ 新加的词条：两种语言都要有真值，且产物里不许出现裸 key ---- */
const TAG_DELETE_KEYS = [
  'tagDeleteAction',
  'tagDeleteConfirm',
  'tagDeleteConfirmAction',
  'tagDeleteWorking',
  'tagDeleteDone',
  'tagDeleteFailed',
] as const;
for (const key of TAG_DELETE_KEYS) {
  const full = `resources.${key}`;
  assert.ok(i18n.exists(full), `★ 词条 ${full} 在【${LANG}】里不存在（界面上会原样印出这个 key）`);
  assert.notEqual(t(full), full, `★ 词条 ${full} 在【${LANG}】里没有真值`);
}

const cloudProducts = [
  cloudAsEditor,
  cloudAsReviewer,
  cloudAsVisitor,
  cloudAsGuest,
  cloudConfirm,
  cloudBusy,
  cloudDone,
  cloudFailed,
  cloudEmptyAfterDelete,
].join('');
/* ⚠️ 扫描器本身必须能命中（否则下面是恒真的空跑）。 */
assert.notEqual(
  /resources\.tag[A-Za-z]+/.test('resources.tagDoesNotExist'),
  false,
  '探针：裸 key 扫描器本身必须能命中',
);
const leakedTagKeys = [...new Set(cloudProducts.match(/resources\.tag[A-Za-z]+/g) ?? [])];
assert.deepEqual(leakedTagKeys, [], `裸 key 泄漏：${leakedTagKeys.join(', ')}`);

ok(
  `编辑者有 ${String(editorDels.length)} 个 ✕（各带标签名）、审核员/访客/未登录一个都没有；` +
    '确认那句话有标签名与条数、成功失败都看得见、删完最后一个标签时提示还在',
);

// ---------------------------------------------------------------------------
console.log('⑩ 裸 key 泄漏 + 字面的 `**`（含探针）');
// ---------------------------------------------------------------------------

const everyProduct = [
  panel,
  unchanged,
  changed,
  saving,
  savedOk,
  savedBad,
  empty,
  ghost,
  nobody,
  usersFailed,
  notAdmin,
  adminPanel,
  publicCard,
  publicDetail,
  directNote,
  barHidden,
  barShown,
  barFail,
  // ★ ⑨ 那一节（删标签）：编辑者/审核员/访客/未登录四份 + 确认与结果那几屏
  cloudAsEditor,
  cloudAsReviewer,
  cloudAsVisitor,
  cloudAsGuest,
  cloudConfirm,
  cloudBusy,
  cloudDone,
  cloudFailed,
  cloudEmptyAfterDelete,
].join('');

/*
 * ⚠️ 裸 key 扫描：i18next 查不到 key 时原样返回它，所以产物里出现
 *    `resourceContrib.xxx` 就等于"界面上会印出这个 key"。
 *    扫描器本身必须能命中（否则它是恒真的空跑）。
 */
assert.notEqual(
  /resourceContrib\.[A-Za-z]+/.test('resourceContrib.doesNotExist'),
  false,
  '探针：裸 key 扫描器本身必须能命中',
);
const leakedKeys = [...new Set(everyProduct.match(/resourceContrib\.[A-Za-z]+/g) ?? [])];
assert.deepEqual(leakedKeys, [], `裸 key 泄漏：${leakedKeys.join(', ')}`);

/*
 * ⚠️ 字面的 `**`：本仓的词条用 `**这样**` 表示强调（见 `components/Emphasis.tsx`），
 *    它只有在经过 `em()` / `emText()` 之后才会消失。落到"只能是字符串"的地方
 *    （`title=` / `aria-label=` / `placeholder=`）而没处理的，用户看到的就是一对星号 ——
 *    而词条存在、两种语言对齐，**没有任何别的检查会发现它**。
 */
assert.notEqual(
  textOf('<p>a**b**c</p>').includes('**'),
  false,
  '探针：`**` 检查本身必须能命中一个带星号的串',
);
assert.equal(
  textOf(everyProduct).includes('**'),
  false,
  '★★ 渲染结果里有字面的 `**`：带标记的词条必须过 `em()`（节点）或 `emText()`（字符串上下文）',
);
ok(
  `无裸 key、无字面 ** （本次 ${String(everyProduct.length)} 字符，` +
    `em() 产出 ${String((everyProduct.match(/<strong>/g) ?? []).length)} 处 <strong>）`,
);

/*
 * ⑪ ★ 英文模式：整个样本集里零汉字。
 *
 * ⚠️ 这一节只在 `--en` 下有内容，所以标题也放在 `if` 里面 ——
 *    否则中文那一遍会印出一个**没有下文的小标题**，看起来像漏跑了一段。
 * ⚠️ 汉字扫描之所以有意义：`fallbackLng: false` 时缺英文词条会**原样返回 key**
 *    （由 ⑩ 抓），而这个扫描抓的是另一类 —— 有人把中文**写死在组件里**。
 */
if (LANG === 'en') {
  console.log('⑪ 英文界面里零汉字');
  const han = textOf(everyProduct).match(/[\u4e00-\u9fff]+/g) ?? [];
  assert.deepEqual(han, [], `英文界面里出现了中文：${han.slice(0, 8).join(' / ')}`);
  ok('英文界面里零汉字');
}

console.log('');
console.log(`通过 ${pass} 项。`);
console.log('');
console.log('⚠️ 这个脚本验的是**渲染**：没有点击、没有请求，也没有"下架之后公开列表里还在不在"。');
console.log('   面板的取数、整份替换保存、点击「移除」之后草稿怎么变 —— ');
console.log('   那些要真的跑起来才知道（服务端那一半在 services/api/src/contributors.test.ts）。');
console.log(
  '   ⚠️ 还有一条边界：贡献者名单**不会**出现在公开面上，这一条由本脚本 ⑥ 守着 —— ' +
    '公开面渲染得到的只是卡片和详情页的"加载中"那一屏，',
);
console.log('   详情页的内容分支渲染不到（它自己取数），所以那一半靠的是 ⑥ 的**源码扫描**。');
