#!/usr/bin/env tsx
/**
 * `/admin/mods`（B1 / Task 6）的**渲染自检** —— spec §5 的断言 13–16。
 *
 * 跑法（从仓库根）：
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web exec tsx --tsconfig tsconfig.json scripts/modtagsrender.tsx
 *   …同一行加 `--en` 就是英文那一遍（`check:all` 里两遍都跑）。
 *
 * ===========================================================================
 * ⚠️★ 渲染的是**纯视图** `AdminModsView`，不是容器 `AdminMods`
 * ===========================================================================
 * 容器自己取数（`useReview` ×2），而 `renderToStaticMarkup` **不跑 effect**
 * ⇒ 渲染容器拿到的**永远**是"加载中…"那一屏，断言 13–16 会**全部变成空跑**
 * （或恒真）—— 那正是本仓 §5.32 的第 ④ 类"读数看着有、其实什么都没测"。
 * ⇒ 这一页因此在 `routes/AdminMods.tsx` 里拆成"容器 + 纯视图"，而这里渲染后者，
 *   夹具是**手写**的（状态只能从外面喂）。
 *
 * ===========================================================================
 * 断言清单：7 组（⓪ 页面壳事在源码层，⑥ 验的是容器那三个纯函数）
 * ===========================================================================
 *   ⓪ 页面壳：`App.tsx` 里有 `/admin/mods` 这条路由 + `Layout.tsx` 的侧栏入口
 *      由 `useCan('catalog.editTags')` 门住（**源码级**，本仓渲染脚本里已有的做法）；
 *   ① 标签表：key + 中文名 + 英文名 + 引用数（引用数落在**专用属性** `data-used-by` 上）；
 *   ② 自动标签在只读区（`data-locked-tag`）、人工标签在可勾选区（`data-manual-tag`），
 *      两处**互不混**（自动标签不许出现在可勾选区）；
 *   ③ 保存键的 `data-dirty`（no / yes）+ 那一行的 `disabled`（同一行元素上取，**不依赖属性顺序**）；
 *   ④ `deleteConfirm` / `errTagInUse` 两个关键文案真的解析得出；
 *   ⑤ "保存会整行替换"那句在界面上（`overwriteHint`）；
 *   ⑥ ★★ 容器那三个纯函数（`manualTagsOf` / `automaticTagsOf` / `isDirty`）——
 *      拆成两半之后，**这是它们唯一的判据**。
 *
 * ===========================================================================
 * ⚠️ 这个脚本**证不了**什么（边界，别高估它）
 * ===========================================================================
 *   · **点击**：静态渲染不跑事件处理器 ⇒ "点一下真的发出了哪一个 PUT"、
 *     "勾一下 draft 里到底变成了什么"**一件都没验**（`toggle` 住在容器里）；
 *   · **取数那两条支路**：容器在自检里渲染不出来（effect 不跑）⇒
 *     "403 走 `forbidden`、别的走 `loadFailed`"、"保存之后真的重取一次"
 *     只由源码与 `i18n-keys.test.ts` 的键存在性兜着；
 *   · **`usedBy` 是容器算的**：① 只验"视图把这一格画进了 `data-used-by`"，
 *     没验"容器数对了几个 mod"（那需要目录夹具 + 容器可渲染，两样都没有）。
 *
 * ⚠️ 组数是**手抄的**（见文件末尾那条探针）：它防的是"把某一段整块摘掉之后
 *    脚本照样绿"。改这个脚本就要一起改那个数，改的时候**现数**。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { en, zhCN } from '@mcsr/shared/i18n';
import i18n from 'i18next';
/*
 * ⚠️ `scripts/**` 不在 tsconfig 的 `include` 里 ⇒ 这个文件走**经典** JSX 运行时
 *    （`React.createElement`），所以 `React` 必须是**值导入**。
 *    这里刻意**不写 JSX**（与 `foldersrender.tsx` 同一个写法）：那样连
 *    "biome 把 `import React` 改成 `import type React` 之后脚本当场崩"
 *    这条路都不存在（那个坑 `gridrender.tsx` 用一条 `biome-ignore` 兜着）。
 */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';

import { automaticTagsOf, isDirty, manualTagsOf } from '@/lib/modTagEdits';
import { AdminModsView, type AdminModsViewProps } from '@/routes/AdminMods';

const LANG = process.argv.includes('--en') ? 'en' : 'zh-CN';

await i18n.init({
  lng: LANG,
  fallbackLng: false,
  resources: { 'zh-CN': { translation: zhCN }, en: { translation: en } },
  interpolation: { escapeValue: false },
});

let pass = 0;
const ok = (m: string): void => {
  pass += 1;
  console.log(`  ✓ ${m}`);
};

/**
 * 针孔探针（本仓老规矩）：词条必须**真的解析出译文**。
 *
 * ⚠️ 缺键时 i18next **原样返回 key** ⇒ 正面断言比的是 key 与 key（照样通过）、
 *    反面断言（"这一行不许出现 X"）**直接静默变绿**。
 */
function resolved(key: string): string {
  const value = i18n.t(key) as string;
  assert.notEqual(
    value,
    key,
    `探针：词条 ${key} 没有解析出译文（缺键时 i18next 原样返回 key，下面的断言都会变成空跑）`,
  );
  return value;
}

/** 一段渲染产物 → 人看到的那串字（口径与 `foldersrender.tsx` 一致：空白一律压掉）。 */
const textOf = (markup: string): string =>
  markup
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, '');

const htmlOf = (props: AdminModsViewProps): string =>
  renderToStaticMarkup(
    React.createElement(I18nextProvider, { i18n }, React.createElement(AdminModsView, props)),
  );

/** 剥掉注释再读源码形状（注释里会逐字写着这些标识符，不剥 = 守卫被自己的注释喂饱）。 */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
// ⓪ 页面壳那一层（**源码级**）：路由挂上了、侧栏入口由能力决定
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 为什么这两件事只能**读源码**：断言 16 说的是"没有 `catalog.editTags` 的账号
 *    看不到侧栏入口"，而入口住在 `Layout` 里 —— 渲染 `Layout` 要一整套 auth /
 *    router / localStorage 的桩，而它**不是**这一页的组件（这个脚本的名字与职责
 *    都是 `/admin/mods`）。本仓对"接线"的既有做法就是源码形状守卫
 *    （`foldersrender.tsx` 的 ㉟/㊲/㊴ 同形）。
 * ⚠️★ 路径用 `import.meta.url` 推，**不要**写仓库相对路径：这个脚本的 cwd 是
 *    `apps/web`（`pnpm -F` 起的），`readFileSync('apps/web/src/App.tsx')` 会指到
 *    `apps/web/apps/web/src/App.tsx` —— 报的是 ENOENT，看起来像"脚本写错了"。
 *    （同一条记录在 `foldersrender.tsx` 的 ㉜ 那一段里。）
 */
console.log(`【${LANG}】⓪ 页面壳（源码级）：路由在场 + 侧栏按能力门住`);
const appSrc = withoutComments(readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'));
const layoutSrc = withoutComments(
  readFileSync(new URL('../src/components/Layout.tsx', import.meta.url), 'utf8'),
);
assert.ok(appSrc.includes('path="/admin/mods"'), 'App.tsx 里要有 /admin/mods 这条路由');
assert.ok(
  appSrc.includes("import('@/routes/AdminMods')"),
  '那条路由必须是**懒加载**到 AdminMods 模块（照 /admin/users 的形状）',
);
assert.ok(
  /useCan\('catalog\.editTags'\)/.test(layoutSrc),
  "Layout.tsx 的侧栏入口必须由 useCan('catalog.editTags') 门住（不是写死 role）",
);
assert.ok(
  layoutSrc.includes('data-action="nav-admin-mods"'),
  '侧栏那一格要带 data-action="nav-admin-mods"（否则"入口在不在"这条判据没有锚点）',
);
assert.ok(
  layoutSrc.includes("t('nav.adminMods')"),
  "侧栏那一格的文案是 t('nav.adminMods')（与账号管理那一条**不是**同一条词条）",
);
ok('★ 页面壳：路由在场 + 侧栏按能力门住（源码级）');

// ---------------------------------------------------------------------------
// 夹具（全是**手写**的：静态渲染不跑 effect ⇒ 状态只能从外面喂）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 夹具的形状是**故意**这样配的，三处各自对应一条断言：
 *   · `ranked` 在**两个** mod 的生效标签里 ⇒ `usedBy` = 2（① 的读数落在专用属性上）；
 *   · `legal` / `extra` **只在生效标签里**、不在任何人工层 ⇒ 它们是自动标签，
 *     必须出现在只读区、**不许**出现在可勾选区（② 的刀就是"把自动标签也画进可勾选区"）；
 *   · 一个人工层来自 **DB**（`mcsrranked`），另一个来自**目录的出厂值**
 *     （`sodium` 只在 `manualTags` 里）⇒ ① 渲染的那一份夹具也真的走过"出厂值回落"
 *     那一格（它单独由 ⑥ 逐条钉住，但让渲染也走一遍是免费的）。
 * ⚠️ `labels` 里**没有** `legal` / `extra` 的显示名：真实目录里它们有（严格 schema
 *    要求"用到的每个标签都有显示名"），而这里留成"没有显示名"是**故意的** ——
 *    那样 ② 才是在验"自动标签不进可勾选区"（按 `locked` 减出来的），
 *    而不是在验"夹具恰好没给它们显示名"。
 */
const LABELS: AdminModsViewProps['labels'] = [
  { tag: 'ranked', zh: '排位', en: 'Ranked', usedBy: 2 },
  { tag: 'ssg-only', zh: '仅固定种子', en: 'Set seed only', usedBy: 0 },
];
const MODS: AdminModsViewProps['mods'] = [
  { modid: 'mcsrranked', name: 'MCSR Ranked', tags: ['extra', 'legal', 'ranked'] },
  { modid: 'sodium', name: 'Sodium', tags: ['legal', 'ranked'] },
];
/** DB 那一层（`GET /api/mod-tags` 的 `assignments`）：只有 `mcsrranked` 有行。 */
const ASSIGNMENTS: Record<string, readonly string[]> = { mcsrranked: ['ranked'] };
/** 目录里的出厂值（`/api/mod-catalog` 顶层 `manualTags`）：只有 `sodium` 有。 */
const FACTORY: Record<string, readonly string[]> = { sodium: ['ranked'] };

const noop = (): void => undefined;

/**
 * 一份视图 props（走**真**的三个纯函数 —— 与容器同一条规则，不自造第二份）。
 *
 * ⚠️ 它同时也是一种覆盖面控制：这三个函数如果在容器里被换掉、而夹具还在用真的那一份，
 *    ⑥ 会红（⑥ 直接断言函数本身），③ 也会红（`dirty` 由 `isDirty` 决定）。
 */
function viewProps(draft: Record<string, string[]>): AdminModsViewProps {
  const manualOf = (modid: string): readonly string[] =>
    manualTagsOf({ modid, draft, assignments: ASSIGNMENTS, manualTags: FACTORY });
  const serverOf = (modid: string): readonly string[] =>
    manualTagsOf({ modid, draft: {}, assignments: ASSIGNMENTS, manualTags: FACTORY });
  return {
    labels: LABELS,
    mods: MODS,
    manualOf,
    automaticOf: (mod) => automaticTagsOf({ tags: mod.tags, manual: manualOf(mod.modid) }),
    dirty: (modid) => isDirty({ draft: draft[modid], server: serverOf(modid) }),
    filter: '',
    onFilter: noop,
    onToggle: noop,
    onSaveMod: noop,
    newTag: { tag: '', zh: '', en: '' },
    onNewTag: noop,
    onSaveLabel: noop,
    onDeleteLabel: noop,
    busy: null,
    error: null,
    okMessage: null,
  };
}

/**
 * 产物里**一个 mod 行**那一段（从 `data-modid="X"` 到下一个 `data-modid="`）。
 *
 * ⚠️★ 为什么要切成一行：`data-dirty` 与 `disabled` 都是**每一行**的读数，
 *    在整份产物上量它们会把两行混成一个集合（"某一行的按钮禁用了"就足以让
 *    "这一行的按钮禁用了"通过）。切法照 `foldersrender.tsx` 的 `folderRowSpanOf`。
 */
function rowSpanOf(markup: string, modid: string): string {
  const start = markup.indexOf(`data-modid="${modid}"`);
  assert.notEqual(start, -1, `产物里找不到 data-modid="${modid}" 那一行 —— 那个 mod 没渲染出来`);
  const next = markup.indexOf('data-modid="', start + 1);
  return next === -1 ? markup.slice(start) : markup.slice(start, next);
}

/**
 * 一行里那颗保存键的**开始标签**（`<button … data-action="save-mod-tags" …>`）。
 *
 * ⚠️★ 判据取的是**元素自己**，不是"某个字符串跟在某个字符串后面"：
 *    React 按 props 的书写顺序输出属性 ⇒ "`data-action="save-mod-tags"` 后面跟着
 *    `disabled`"这种断言会因为一个**完全正当**的写法（`disabled` 写在前面）而红，
 *    而红的原因不是缺陷。本仓为此记过一条（`docs/pending.md §5.30` 那一族）。
 */
function saveButtonOf(markup: string, modid: string): string {
  const found = rowSpanOf(markup, modid).match(/<button\b[^>]*data-action="save-mod-tags"[^>]*>/);
  assert.ok(found, `${modid} 那一行里没有 data-action="save-mod-tags" 的保存键`);
  return found[0];
}

/** 没改过的那一份产物（①②⑤ 量的就是它）。 */
const html = htmlOf(viewProps({}));
const unchangedHtml = html;
/** 改过的那一份：`mcsrranked` 多勾了一个标签（还没保存）。 */
const changedHtml = htmlOf(viewProps({ mcsrranked: ['ranked', 'ssg-only'] }));

// ---------------------------------------------------------------------------
// ① 标签表：key + 两种显示名 + 引用数
// ---------------------------------------------------------------------------
console.log(`【${LANG}】① 标签表：key + 两种显示名 + 引用数`);
/*
 * ⚠️★ 引用数那条断言必须落在**专用属性**上：写成"HTML 里含 `2`"是**弱断言** ——
 *    产物里任何地方的一个 `2`（行号、别的数字、`class="col2"`）都会让它过。
 */
assert.ok(html.includes('data-used-by="2"'), '引用数要落在 data-used-by 上（不是"产物里含 2"）');
assert.ok(
  html.includes('<code>ranked</code>') && html.includes('排位') && html.includes('Ranked'),
  'key / 中文名 / 英文名三处都要画',
);
ok('★ 标签表画出 key / 中文名 / 英文名 / 引用数（四周都在，引用数走专用属性）');

// ---------------------------------------------------------------------------
// ② 自动标签与人工标签画在**两个**地方
// ---------------------------------------------------------------------------
console.log(`【${LANG}】② 自动标签与人工标签画在**两个**地方`);
/*
 * ★ 这一条的刀：把自动标签也画进可勾选区 ⇒ 红。
 * ⚠️ `legal` 在**两个** mod 的生效标签里、不在任何人工层 ⇒ 它是自动标签。
 */
assert.ok(html.includes('data-locked-tag="legal"'), '自动标签必须出现在只读区');
assert.equal(html.includes('data-manual-tag="legal"'), false, '自动标签**不许**出现在可勾选区');
assert.ok(html.includes('data-manual-tag="ranked"'), '人工标签必须在可勾选区');
ok('★ 自动=只读、人工=可勾，两处互不混');

// ---------------------------------------------------------------------------
// ③ 保存键的禁用态由"改过没有"决定
// ---------------------------------------------------------------------------
console.log(`【${LANG}】③ 保存键的禁用态由"改过没有"决定`);
/*
 * ⚠️★ 判据落在**专用属性** `data-dirty` 上（不写"某个属性跟着 `disabled`"那种
 *    依赖属性顺序的写法 —— 见 `saveButtonOf` 上面那段）。
 * ★ 而且这里两条**同时**断言：`data-dirty` 说的那一格，与按钮**真正的**禁用态
 *   必须一致（`!rowDirty || rowBusy` 用的是同一个表达式）。分叉的那天，
 *    "读数说没改过、按钮却能点"不会有任何门禁报警。
 */
const unchangedSave = saveButtonOf(unchangedHtml, 'mcsrranked');
const changedSave = saveButtonOf(changedHtml, 'mcsrranked');
assert.ok(unchangedSave.includes('data-dirty="no"'), '没改过时 data-dirty 必须是 no');
assert.ok(
  /\bdisabled\b/.test(unchangedSave),
  '没改过时保存键必须**真的**禁用（判据落在这一行的按钮元素上，不依赖属性顺序）',
);
assert.ok(changedSave.includes('data-dirty="yes"'), '改过之后 data-dirty 必须是 yes');
assert.equal(
  /\bdisabled\b/.test(changedSave),
  false,
  '改过之后保存键必须可用（正反各一条：只断言一半的话，"永远禁用"照样绿）',
);
ok('★ 保存键：没改过 no / 改过 yes（正反各一条，判据不依赖属性顺序）');

// ---------------------------------------------------------------------------
// ④ 删除标签那一条路：确认框 + 409 的文案
// ---------------------------------------------------------------------------
console.log(`【${LANG}】④ 删除标签那一条路：确认框 + 409 的文案`);
/*
 * ⚠️ 这两句都住在**容器**里（`window.confirm` 与 409 的分支），而这个脚本渲染不了
 *    容器 ⇒ 能验的只有"词条真的解析得出"（缺键时 i18next 原样返回 key，
 *    界面上就是 `adminMods.deleteConfirm` 那串东西）。
 */
for (const key of ['adminMods.deleteConfirm', 'adminMods.errTagInUse']) {
  assert.notEqual(i18n.t(key), key, `词条 ${key} 必须解析得到`);
}
assert.ok(
  html.includes('data-action="delete-tag-label"'),
  '删除标签那颗按钮要在标签表里（`data-action="delete-tag-label"`）',
);
ok('★ 两个关键文案都真的解析了');

// ---------------------------------------------------------------------------
// ⑤ 整行替换那条纪律在界面上说得出来
// ---------------------------------------------------------------------------
console.log(`【${LANG}】⑤ 整行替换那条纪律在界面上说得出来`);
/*
 * ⚠️ 比的是**归一化之后的文字**（`textOf`），不是裸 `html.includes(词条)`：
 *    React 会把值里的引号转义成实体（英文本子里有 `’`），裸比较会红在一个
 *    **正确**的实现上（那种红比不写还坏）。
 */
assert.ok(
  textOf(html).includes(textOf(resolved('adminMods.overwriteHint'))),
  '必须显示"保存会整行替换"那句',
);
ok('★ 覆盖别人的改动这件事在界面上说了出来');

// ---------------------------------------------------------------------------
// ⑥ ★ 容器那三个纯函数（人工层 / 自动层 / 改过没有）
// ---------------------------------------------------------------------------
console.log(`【${LANG}】⑥ ★ 容器那三个纯函数（人工层 / 自动层 / 改过没有）`);
/*
 * ★★ 这一组是"拆成容器 + 纯视图"之后**唯一**能验到派生逻辑的地方（Step 2b 的三个函数）。
 *    ⚠️ 前两条是**同一个问题**的两面，缺一条就有一种坏法没人喊：
 *      · 只验"没有 DB 行时回落到出厂值" ⇒ 把 `??` 写成 `||`（空数组被当成"没有"）
 *        照样绿，而"管理员清空了它"会被出厂值静默覆盖回来；
 *      · 只验"DB 行赢" ⇒ 漏掉出厂值那一格（**会静默删数据**的那一格）照样绿。
 */
assert.deepEqual(
  manualTagsOf({ modid: 'a', draft: {}, assignments: {}, manualTags: { a: ['ranked'] } }),
  ['ranked'],
  '★ 没有 draft、DB 里也没有 ⇒ **必须**回落到目录的 manualTags（漏了它 = 保存时静默删掉文件来的标签）',
);
assert.deepEqual(
  manualTagsOf({ modid: 'a', draft: {}, assignments: { a: [] }, manualTags: { a: ['ranked'] } }),
  [],
  'DB 里有行（哪怕是空数组）⇒ DB 赢 ——"管理员清空了"与"从没设过"必须分得开',
);
assert.deepEqual(
  manualTagsOf({ modid: 'a', draft: { a: ['x'] }, assignments: { a: ['ranked'] }, manualTags: {} }),
  ['x'],
  'draft（还没保存的选择）赢过一切',
);
assert.deepEqual(
  automaticTagsOf({ tags: ['extra', 'ranked'], manual: ['ranked'] }),
  ['extra'],
  '自动层 = 生效 − 人工',
);
assert.equal(isDirty({ draft: undefined, server: ['ranked'] }), false, '没有 draft ⇒ 没改过');
assert.equal(
  isDirty({ draft: ['a', 'b'], server: ['b', 'a'] }),
  false,
  '同一集合、顺序不同 ⇒ 不算改过',
);
assert.equal(isDirty({ draft: ['a'], server: ['a', 'b'] }), true, '少一个 ⇒ 改过');
assert.equal(isDirty({ draft: ['a', 'b'], server: ['a'] }), true, '多一个 ⇒ 改过');
ok('★ 纯函数：出厂值回落 / DB 赢 / draft 赢 / 自动层 / 改过的四档');

// ---------------------------------------------------------------------------
// 项数探针（手抄的，理由见文件头）
// ---------------------------------------------------------------------------
/*
 * ⚠️ 组数是**手抄的**：它防的是"把某一组整块摘掉" —— 删掉一组断言之后脚本照样绿、
 *    照样打印"通过 N 项"，只有这个数字会变。⇒ 改脚本就要一起改这里（**现数**，别估）。
 * ⚠️ zh 与 en 是**同一个数**：这个脚本**没有** `if (LANG === 'en')` 那一支
 *    （`foldersrender` 的㉛ 零汉字扫描才需要那个差 1）。
 */
const expectedItems = 7;
assert.equal(
  pass,
  expectedItems,
  `探针：这一轮应当通过 ${String(expectedItems)} 组（少了就说明有人把某一段摘掉了）`,
);

console.log('');
console.log(`通过 ${pass} 项。`);
console.log('');
console.log('⚠️ 这个脚本验的是**渲染**（外加 ⓪ 两条源码形状守卫与 ⑥ 三个纯函数）：');
console.log('   没有点击、没有请求、没有真实浏览器，也没有渲染那个**容器**。');
console.log('   具体没被覆盖的（至少这几样）：');
console.log(
  '     · 勾一个复选框之后 draft 里变成了什么 / 保存键点了走哪条通道：静态渲染不跑处理器；',
);
console.log('     · 容器那两条取数支路（403 与"别的失败"各说什么、保存之后真的重取一次）：');
console.log('       effect 不跑 ⇒ 容器在自检里永远停在"加载中…"，那两句只由源码与词条存在性兜着；');
console.log('     · `usedBy` 是**容器**算的：① 只钉住"视图把这一格画进了专用属性"。');
