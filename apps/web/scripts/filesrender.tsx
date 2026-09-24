#!/usr/bin/env tsx
/**
 * 「文件更新」`/files` 那一页 · 渲染自检（2026-09-24，Task 7 —— 第 13 个渲染自检）。
 *
 * 跑法（从仓库根）：
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:files
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:files -- --en
 *
 * ===========================================================================
 * 为什么这一页必须有它
 * ===========================================================================
 * `apps/web` 没有测试运行器（`CONTRIBUTING.md` 写着），这一页此前**一个产物级断言都没有**：
 * 表格、徽章、两格版本读数、一键更新的可用条件全是「类型检查过得了」那一层兜着，
 * 而那一层看不见「块整个没渲染」「词条打错一个字母」「给未绑定的行编了一个版本号」。
 * i18next 对未知 key **不报错**，它把 key 原样印在界面上。
 *
 * ===========================================================================
 * ⚠️★ 边界：这个脚本**证不了**"用户点一下会怎样"，那一半归 Task 8
 * ===========================================================================
 * `renderToStaticMarkup` **不点击、不跑事件处理器、不跑 effect**（`docs/pending.md §5.73`）。
 * 于是下面这些**只有真浏览器 + 真主进程**（Task 8）能证明，本脚本一条都不碰：
 *   · 「一键更新」那两下**真的**会从第一态跳到第二态（源码形状守卫只钉住"那条路在、
 *     而且只有一条"，**它证不了"点下去真的走了这条路"** —— 这一句写在 ⑱ 那一段里）；
 *   · 原生对话框（选 `.jar` / 选 mods 目录）与**真的下载、真的写盘**；
 *   · 桌面态那一半的任何一屏：这里没有 preload，`window.mcsr` 是 `undefined`
 *     ⇒ `useFileUpdates()` 在自检里只可能停在浏览器态 / 加载态；
 *   · `/api/file-catalog` 的真实响应（effect 一行都不跑，页面停在「加载中…」）；
 *   · 主进程写死的中文错误句子（夹具用的是 ASCII 串，见下面 `FAILURE` 那一段）。
 *
 * ===========================================================================
 * ⚠️★★ 三条从 Task 6 / 评审那里带过来的硬要求（每一条都写了"为什么"）
 * ===========================================================================
 * 1. **裸 key 扫描器用的是 Task 6 那个具名对象**（`RAW_KEY_RE` / `rawKeysIn`，从表格
 *    `import` 进来的），**不另写一个字面量**。那件事的现场：两处各写一个正则、而且两个
 *    长得不一样 ⇒「把扫描器改坏」不会有任何断言出声。⇒ ⑲ 两条探针断言的就是**这个对象
 *    的产出**（能命中两个前缀、且不误伤普通文案）。
 * 2. **「已禁用」徽章按**路径**算**（`isDisabledPath(view.binding.localPath)`），不是读契约里
 *    那一格 `state.disabled`。夹具于是必须把 `.disabled` 写在**绑定路径**上 —— 用
 *    `state.disabled` 造的夹具会喂饱一条**读错了字段**的断言（⑧ 那一组里专门有一条
 *    反过来的判据：路径是 `.disabled` 而 `state.disabled` 是 `false`，徽章照样要在）。
 * 3. **`reduceLoad()` 那一台状态机**（"数据永远压过一次失败结论"）在这里被钉住。
 *    它此前只有一份**不可复跑**的探针（Task 6 报告 §13 的 `.cache/task6-probe.mjs`，
 *    `.cache/` 是 gitignore 的）⇒ 那一轮之后没人能重跑它。它是个纯函数，搬进来是免费的。
 *
 * ===========================================================================
 * ⚠️★ 源码形状守卫的纪律（本仓被评审抓过三次，这里是第四次）
 * ===========================================================================
 * ⑱ 那一段**读源码**。每一条守卫都必须在注释里点名**能让它变红的那一刀**，而且那一刀
 * 真的跑过（改完就还原，`sha256` 逐字节核对）。**做不到的就删掉** —— 一条恒真的守卫
 * 比没有守卫更坏（它会让人以为这件事有人看着）。Task 6 的配方抄过来时必须改两处：
 *   ① 锚点从 `requestUpdateAll` 的**函数体**挪到那颗**按钮**上（`onClick={requestUpdateAll}`
 *      那一句）。原来的锚点对"把 `.cta` 的 `onClick` 改成 `confirmUpdateAll`"（第一次点击
 *      就直接开写）那一刀**五条全绿**；
 *   ② 加一条"`showConfirm` 必须**由** `confirmingUpdateAll` 推出"—— 它是唯一能抓
 *      "写死 `false`"的守卫。
 *
 * ===========================================================================
 * 组数（手抄的，见文件末尾那条探针）
 * ===========================================================================
 * zh 19 组、en 20 组（⑳ 只在 `--en` 那一遍跑）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type {
  FileBinding,
  FileCatalogItem,
  FileItemState,
  FileItemView,
  FileUpdatesState,
} from '@mcsr/shared/fileUpdates';
import { en, zhCN } from '@mcsr/shared/i18n';
import i18n from 'i18next';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import {
  type FileUpdatesHandlers,
  FileUpdatesPanel,
  NO_LOAD,
  reduceLoad,
  UpdateAllConfirm,
  updateAllTargets,
} from '@/components/FileUpdatesPanel';
import {
  FileUpdateTable,
  type FileUpdateTableProps,
  formatClock,
  RAW_KEY_RE,
  rawKeysIn,
} from '@/components/FileUpdateTable';
import { Files } from '@/routes/Files';

const LANG = process.argv.includes('--en') ? 'en' : 'zh-CN';

await i18n.init({
  lng: LANG,
  fallbackLng: false,
  resources: { 'zh-CN': { translation: zhCN }, en: { translation: en } },
  interpolation: { escapeValue: false },
});

/*
 * ⚠️ 刻意**不用 JSX**（用 `React.createElement`），理由与 `accountrender.tsx` /
 *    `homerender.tsx` 相同：`scripts/**` 不在 tsconfig 的 `include` 里 ⇒ JSX 走 classic
 *    runtime ⇒ 必须 `import React from 'react'`，而 biome 的 `noUnusedImports` 会把它判成
 *    未使用并提供一个**不安全自动修复** —— 谁点了那个修复，脚本就在运行时崩。
 */

/**
 * 一段渲染产物 → 人看到的那串字（标签剥掉、实体还原、空白压掉）。
 *
 * ⚠️ 空白一律压掉，所以两种语言用的是**同一个**比较口径：`'Update available'` 与
 *    `'Updateavailable'` 在这条口径下是同一串（这是有意的：中文没有词间空格，
 *    留一个"只在英文下才准"的分支等于给自己埋一条只在 en 那一遍咬人的判据）。
 */
const decode = (s: string): string =>
  s
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
const textOf = (markup: string): string =>
  decode(markup.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, '');

const t = (key: string, opts?: Record<string, unknown>): string => i18n.t(key, opts) as string;

/**
 * 针孔探针（本仓老规矩）：词条必须**真的解析出译文**，而不是原样返回 key。
 *
 * ⚠️ 为什么每条渲染断言都要它：缺键时 i18next **原样返回 key**，于是
 *   · 正面断言 `includes(t(key))` 比的是 key 与 key —— 照样通过；
 *   · 反面断言（"这一行不许出现 X"）**直接静默变绿**。
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
 * 一条词条的**归一化**形式 —— 与 `labelsIn` / `textOf` 同一个口径。
 *
 * ⚠️★ 为什么必须有它：`labelsIn` 把产物里的字剥了标签、压了空白，而 `resolved()` 给的是
 *    词条原样 ⇒ 英文那一遍 `'Choose file'` 与 `'Choosefile'` 比不相等，而**中文那一遍
 *    看不出任何问题**（中文没有词间空格）。那种"只在 en 那一遍咬人"的比较口径，
 *    正是这条自检最不该有的东西。
 */
const labelOf = (key: string, opts?: Record<string, unknown>): string =>
  textOf(resolved(key, opts));

const html = (node: React.ReactElement): string =>
  renderToStaticMarkup(React.createElement(I18nextProvider, { i18n }, node));

/**
 * 所有渲染过的产物都进这里 —— ⑲ 的裸 key 扫描与 ⑳ 的零汉字扫描扫的就是它。
 *
 * ⚠️★ 为什么做成"渲染即入袋"（而不是末尾手写一份清单）：漏掉一个样本**不会报错**，
 *    只会让那两块渲染少一层覆盖 —— 而"少一层覆盖"和"过了"在输出里长得一模一样
 *    （`docs/pending.md §5.32` 的第三类）。让渲染函数自己负责收进去，就没有"忘了列"这一步。
 */
const samples: string[] = [];
const keep = (markup: string): string => {
  samples.push(markup);
  return markup;
};

// ---------------------------------------------------------------------------
// 夹具（全是**手写**的，见文件头：静态渲染不跑 effect ⇒ 状态只能从外面喂）
// ---------------------------------------------------------------------------

/** 「没有值的那一格」那个字符 —— 与表格里那个 `DASH` 是同一个字符，两边一起改才作数。 */
const DASH = '—';

/**
 * 目录给的备注。
 *
 * ⚠️★ 它是**中文**，而表格**刻意不印**它（印了英文界面就会夹中文，见表格里那一格）。
 *    ⇒ ② 里有一条"这一个字都不许出现"的判据：哪天有人开始印它，这条会红，
 *    ⑳ 的零汉字扫描**也会**红（两条独立的口径，同一件事）。
 */
const NOTE = '目录备注：这一页一个字都不许印它';

const ITEM: FileCatalogItem = {
  id: 'mcsrranked',
  name: 'MCSR Ranked',
  kind: 'mod',
  note: NOTE,
  source: {
    provider: 'modrinth',
    project: 'mcsr-ranked',
    modId: 'mcsrranked',
    gameVersion: '1.16.1',
    loader: 'fabric',
    channel: 'release',
  },
};

const BOUND: FileBinding = { localPath: 'D:\\mods\\mcsrranked-5.8.22.jar', autoUpdate: true };
/** ★ 被禁用的绑定是**靠路径**认出来的（`.jar.disabled`），不是靠契约里那一格 `disabled`。 */
const BOUND_DISABLED: FileBinding = {
  localPath: 'D:\\mods\\mcsrranked-5.8.15.jar.disabled',
  autoUpdate: false,
};

/** `outdated` 那一支（契约要的那几格都给上：文件名 / 地址 / 校验和 / 大小）。 */
function outdatedState(disabled = false): FileItemState {
  return {
    kind: 'outdated',
    localPath: BOUND.localPath,
    localVersion: '5.8.22',
    latestVersion: '5.8.26',
    latestFileName: 'mcsrranked-5.8.26.jar',
    latestUrl: 'https://cdn.modrinth.com/data/mcsr-ranked/versions/x/mcsrranked-5.8.26.jar',
    latestSha512: 'a'.repeat(128),
    latestSize: 1_234_567,
    disabled,
  };
}

const CURRENT: FileItemState = {
  kind: 'current',
  localPath: BOUND.localPath,
  localVersion: '5.8.26',
  latestVersion: '5.8.26',
};
const MISSING: FileItemState = { kind: 'missing-file', localPath: BOUND.localPath };
const UNCHECKED: FileItemState = { kind: 'unchecked', localPath: BOUND_DISABLED.localPath };

/**
 * 主进程那一支的 `message`（"本地这个文件读不出来"那一类整句）。
 *
 * ⚠️★ 夹具**刻意用 ASCII**：真实的那句话是主进程写死的**中文**（代价写在
 *    `packages/shared/src/i18n/zh-CN.ts` 的 `files.actionFailed` 那一段：英文界面上会夹中文）。
 *    这里换成中文串的话，⑳ 那条"英文产物零汉字"就得给扫描开一个豁免口子 ——
 *    而开了口子的扫描在**最该抓人的那一处**是瞎的。代价：这条断言只说"原样印出来"，
 *    不说"那句原话长什么样"（那句原话是主进程的事，Task 8 才照得到）。
 */
const FAILURE = 'READ-FAILED-9174: could not read the local file';

/** 一条视图。默认是"未绑定、什么读数都没有"（浏览器态每一行就长这样）。 */
function viewOf(state: FileItemState, extra: Partial<FileItemView> = {}): FileItemView {
  return {
    item: ITEM,
    binding: null,
    localVersion: null,
    state,
    lastCheckedAt: null,
    lastKnownLatest: null,
    ...extra,
  };
}

/** 一份整状态（面板的 `state` 那个 prop）。 */
function stateOf(items: FileItemView[], extra: Partial<FileUpdatesState> = {}): FileUpdatesState {
  return {
    catalog: { version: 1, items: [ITEM] },
    catalogError: null,
    items,
    busyItemId: null,
    progress: null,
    lastCheckedAt: null,
    lastRun: null,
    ...extra,
  };
}

const noop = (): void => undefined;
/** 七个动作的包装 —— **值不会被执行**（静态渲染一行事件处理器都不跑），只为把 props 填满。 */
const HANDLERS: FileUpdatesHandlers = {
  bind: async () => undefined,
  bindFolder: async () => undefined,
  unbind: async () => undefined,
  setAutoUpdate: async () => undefined,
  check: async () => undefined,
  update: async () => undefined,
  updateAll: async () => undefined,
};

/**
 * 渲染表格 / 面板。
 *
 * ⚠️★ 表格那四个回调**默认全给**：每行那颗按钮要**同时**满足"`desktop !== false`"与
 *    "那个动作的回调真的在手"才画（表格 props 的说明）⇒ 只喂 `views` 的话操作列是空的，
 *    "⑤ current 行没有「更新」按钮"这种断言就变成了**空跑**（它本来就一个按钮都不画）。
 *    ⑫ 那一组专门有一条反过来的判据盯着这件事。
 */
const tableHtml = (
  views: readonly FileItemView[],
  props: Partial<FileUpdateTableProps> = {},
): string =>
  keep(
    html(
      React.createElement(FileUpdateTable, {
        views,
        desktop: true,
        onBind: noop,
        onUnbind: noop,
        onToggleAuto: noop,
        onUpdate: noop,
        ...props,
      }),
    ),
  );

const panelHtml = (items: FileItemView[], extra: Partial<FileUpdatesState> = {}): string =>
  keep(
    html(
      React.createElement(FileUpdatesPanel, { state: stateOf(items, extra), handlers: HANDLERS }),
    ),
  );

// ---------------------------------------------------------------------------
// 从产物里取元素的小工具
// ---------------------------------------------------------------------------

/** 一行的标记（`<tr …>…</tr>`）。找不到就当场红 —— 那本身就是"这一行没渲染"。 */
function rowOf(markup: string, kind: FileItemState['kind']): string {
  const found = markup.match(
    new RegExp(`<tr class="filetable__row" data-state="${kind}"[\\s\\S]*?</tr>`),
  );
  assert.ok(
    found,
    `产物里找不到 data-state="${kind}" 的那一行 —— 那一行没渲染出来，或者 data-state 不再写在那里`,
  );
  return found[0];
}

/** 两格版本读数（`<td class="filetable__version">…</td>`，按顺序是"本地 / 最新"）。 */
function versionCellsOf(row: string): string[] {
  return [...row.matchAll(/<td class="filetable__version">([\s\S]*?)<\/td>/g)].map((m) =>
    textOf(m[1]),
  );
}

interface ButtonShape {
  /** 按钮上**看得见**的那串字（标签剥掉、空白压掉）。 */
  label: string;
  /** 这个按钮此刻是不是禁用的。 */
  disabled: boolean;
  /** `class` 那串，按空格切成了数组。 */
  classes: string[];
}

function buttonsIn(markup: string): ButtonShape[] {
  return [...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    label: textOf(m[2]),
    disabled: /\bdisabled\b/.test(m[1]),
    classes: (m[1].match(/\bclass="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean),
  }));
}

/** 按钮文字清单 —— 比"在整行里找『更新』两个字"准：`可更新` 里也有那两个字。 */
const labelsIn = (markup: string): string[] => buttonsIn(markup).map((b) => b.label);

/** 第一态那颗「一键更新」（`.cta`）。找不到 = 那一颗没了。 */
function ctaOf(markup: string): ButtonShape {
  const found = buttonsIn(markup).find((b) => b.classes.includes('cta'));
  assert.ok(
    found,
    '面板里找不到 `.cta` 那颗主按钮（第一态的「一键更新」）—— 它应当是第一态唯一的出路',
  );
  return found;
}

/** 剥掉注释再读源码形状（注释里逐字写着这些标识符，不剥 = 守卫被自己的注释喂饱）。 */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

console.log(`【${LANG}】文件更新页 · 表格与一键更新`);

// ---------------------------------------------------------------------------
// ① 空态 + `data-views` + 五列表头
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 零条**必须有话说**：原来那里是一个**空 div**，用户看到的是"这一页什么都没有"，
 *    分不出"目录是空的"与"这一块没渲染出来"。
 * ⚠️ `data-views` 现在住在**表格外层那个 div** 上（Task 6 把它从面板的空挂载点搬过来了）：
 *    它是"面板真的把 N 条视图交给了表格"唯一的读数，而它**值不变**（仍是 `views.length`）。
 */
const emptyTable = tableHtml([]);
assert.ok(
  emptyTable.includes('data-views="0"'),
  '★ 零条时表格外层那个 div 上必须是 `data-views="0"` —— 它是"视图真的递下来了"唯一的读数',
);
assert.ok(
  textOf(emptyTable).includes(textOf(resolved('common.empty'))),
  '★ 零条必须说一句人话（空 div = 用户分不出"目录是空的"与"这一块没渲染"）',
);
assert.equal(
  emptyTable.includes('<table'),
  false,
  '零条时不该还画一张空壳表（留个表头 = 下面就该有行）',
);

const oneTable = tableHtml([viewOf({ kind: 'unbound' })]);
assert.ok(
  oneTable.includes('data-views="1"'),
  '★ `data-views` 必须真的数了 `views`（写死 0 也能过上面那条）',
);
for (const key of [
  'files.colFile',
  'files.colLocal',
  'files.colLatest',
  'files.colAuto',
  'files.colActions',
]) {
  const column = resolved(key);
  assert.ok(textOf(oneTable).includes(textOf(column)), `★ 表头少了「${column}」那一列`);
}
ok('① 零条有话说、没有空壳表；`data-views` 在表格上且真的数了行；五列表头都在');

// ---------------------------------------------------------------------------
// ② 未绑定的行（浏览器态每一行都是它）
// ---------------------------------------------------------------------------
const unboundRow = rowOf(oneTable, 'unbound');
assert.deepEqual(
  versionCellsOf(unboundRow),
  [DASH, DASH],
  '★ 未绑定的行两格都必须是 `—`（本地 / 最新）：这一页在浏览器里**一个文件都读不到**',
);
assert.equal(
  /\d+\.\d+\.\d+/.test(textOf(unboundRow)),
  false,
  '★ 未绑定的行里不许出现任何版本号形状的字 —— 不许填 0、不许从别处借一个版本号顶上',
);
assert.ok(
  textOf(unboundRow).includes(textOf(resolved('files.unbound'))),
  '★ 每一行都要说清它是什么（「未绑定」）',
);
assert.deepEqual(
  labelsIn(unboundRow),
  [labelOf('files.bind')],
  '★ 未绑定的行只有「选择文件」—— 没绑定就没有「解除绑定」可点',
);
assert.equal(
  textOf(unboundRow).includes(textOf(NOTE)),
  false,
  `★ 目录给的备注（\`item.note\`）一个字都不许印：它是目录里的内容（中文），印了英文界面就夹中文`,
);
ok('② 未绑定的行：两格 `—`、没有版本号、有「未绑定」徽章、只有「选择文件」、不印目录备注');

// ---------------------------------------------------------------------------
// ③ `outdated` 的行：高亮**不只靠颜色**
// ---------------------------------------------------------------------------
const outdatedView = viewOf(outdatedState(), { binding: BOUND, localVersion: '5.8.22' });
const outdatedTable = tableHtml([outdatedView]);
const outdatedRow = rowOf(outdatedTable, 'outdated');
const outdatedBadge = resolved('files.outdated');
/*
 * ★ 硬要求：**文字**承载语义，颜色只是加强。
 *   这两条**必须同时**成立才算"不只靠颜色"：只断言类名（颜色）不算，
 *   只断言文字（它可能是别处的）也不算 —— 所以下面把它们写在同一条上。
 */
assert.ok(
  outdatedTable.includes('data-state="outdated"'),
  '★ 可更新的那一行必须带 `data-state="outdated"`（这张表的每一行都靠它标注自己是什么）',
);
assert.ok(
  outdatedRow.includes(`<span class="badge badge--update">${outdatedBadge}</span>`),
  `★ 「${outdatedBadge}」必须是这一行里一颗有文字的徽章（只看得见灰度的用户拿到的是同一句话）`,
);
assert.deepEqual(
  versionCellsOf(outdatedRow),
  ['5.8.22', '5.8.26'],
  '★ 两格读数分别是本地那版与上游最新那版（顺序反了 = 用户按错的版本号点「更新」）',
);
assert.deepEqual(
  labelsIn(outdatedRow),
  [labelOf('files.update'), labelOf('files.unbind')],
  '★ 可更新的行主操作是「更新」，另外那颗安静的「解除绑定」也在',
);
ok('③ `data-state="outdated"` 与徽章文字**同时**在（高亮不只靠颜色），两格是 5.8.22 / 5.8.26');

// ---------------------------------------------------------------------------
// ④ `error` 的行：把 `message` **原样**印出来
// ---------------------------------------------------------------------------
const errorView = viewOf(
  { kind: 'error', localPath: BOUND.localPath, message: FAILURE },
  { binding: BOUND, localVersion: '5.8.22' },
);
const errorRow = rowOf(tableHtml([errorView]), 'error');
assert.ok(
  errorRow.includes(FAILURE),
  '★ 主进程写好的原因必须**原样**印出来 —— 换成一句"出错了"等于把用户唯一能行动的线索删掉',
);
assert.equal(
  labelsIn(errorRow).includes(labelOf('files.update')),
  false,
  '★ 读失败的那一行没有「更新」：连"要不要更新"都还不知道（给了就是编一个结论）',
);
assert.equal(
  textOf(errorRow).includes(textOf(resolved('files.upToDate'))),
  false,
  '★ 读失败的行不许印「已是最新」—— 那是两个方向相反的说法',
);
ok(`④ \`error\` 那一行把原因原样印出来（「${FAILURE}」），而且没有「更新」也没有「已是最新」`);

// ---------------------------------------------------------------------------
// ⑤ `error` 那一行欠的那句"上次看到的是哪一版"
// ---------------------------------------------------------------------------
/*
 * spec §8：上游连不上 ⇒ 状态是 `error`，**并保留上次成功读到的最新版本、标注它是几时读的**。
 * 那个时间戳由**同一个** `formatClock()` 写（从表格 import 的那个），所以期望值也现算 ——
 * 写死 `14:03` 的话，这台机器在别的时区就会红，而那与产品对错无关。
 */
const fetchedAt = Date.UTC(2026, 8, 24, 6, 3);
const knownText = resolved('files.lastKnownLatest', {
  version: '5.8.26',
  time: formatClock(fetchedAt),
});
const knownRow = rowOf(
  tableHtml([
    viewOf(
      { kind: 'error', localPath: BOUND.localPath, message: FAILURE },
      {
        binding: BOUND,
        localVersion: '5.8.22',
        lastKnownLatest: { version: '5.8.26', fetchedAt },
      },
    ),
  ]),
  'error',
);
assert.ok(
  textOf(knownRow).includes(textOf(knownText)),
  '★ 有上次读数时要说清"上次读到的是哪一版、几时读到的"（只有一句"读取失败"= 用户不知道自己在退回哪一版）',
);
const noneRow = rowOf(tableHtml([errorView]), 'error');
assert.ok(
  textOf(noneRow).includes(textOf(resolved('files.lastKnownNone'))),
  '★ `lastKnownLatest` 为 `null`（冷启动 + 上游不可达）时必须诚实说"本次还没读到过"',
);
assert.equal(
  textOf(noneRow).includes('5.8.26'),
  false,
  '★ 那一格为 `null` 时**不许**从别处借一个版本号顶上（编出来的版本号会让这一页看起来像"我读到了"）',
);
ok('⑤ `error` 那一行："上次读到 5.8.26（…）" 有读数时在、没有读数时照实说"还没读到过"');

// ---------------------------------------------------------------------------
// ⑥ `current` 的行：已是最新，而且**没有**「更新」
// ---------------------------------------------------------------------------
const currentRow = rowOf(
  tableHtml([viewOf(CURRENT, { binding: BOUND, localVersion: '5.8.26' })]),
  'current',
);
assert.ok(
  textOf(currentRow).includes(textOf(resolved('files.upToDate'))),
  '★ 已是最新的行必须这么说（不说 = 用户不知道还要不要动手）',
);
assert.equal(
  labelsIn(currentRow).includes(labelOf('files.update')),
  false,
  '★ 已是最新的行**不许**有「更新」按钮 —— 没有要更新的东西，给了就是让用户白点一次',
);
assert.deepEqual(
  labelsIn(currentRow),
  [labelOf('files.unbind')],
  '★ 那一行只剩那颗安静的「解除绑定」（Task 6 加的；删它 = `unbind()` 在界面上又点不到了）',
);
ok('⑥ `current` 的行：「已是最新」+ 操作列里**没有**「更新」（只有「解除绑定」）');

// ---------------------------------------------------------------------------
// ⑦ `missing-file`：文件不见了 ⇒ 按钮是「重新选择」
// ---------------------------------------------------------------------------
const missingRow = rowOf(tableHtml([viewOf(MISSING, { binding: BOUND })]), 'missing-file');
assert.ok(
  textOf(missingRow).includes(textOf(resolved('files.missing'))),
  '★ 文件被删/改名了必须说出来（不然用户看到的是一行"没绑定"，而绑定明明还在）',
);
assert.deepEqual(
  labelsIn(missingRow),
  [labelOf('files.rebind'), labelOf('files.unbind')],
  '★ 这一支的主操作是**「重新选择」**（不是「更新」：连文件在哪都不知道，没有可更新的对象）',
);
assert.equal(
  labelsIn(missingRow).includes(labelOf('files.update')),
  false,
  '★ 文件都不见了，「更新」那一颗必须不在（点了只会再报一次"找不到文件"）',
);
ok('⑦ `missing-file`：「文件不见了」+ 按钮是「重新选择」');

// ---------------------------------------------------------------------------
// ⑧ ★★「已禁用」徽章按**路径**算（不是读契约里那一格 `state.disabled`）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 这一格是 Task 6 修复轮改过的，改的原因值得抄在这里（免得下一个人改回去）：
 *    先前那一版读 `state.disabled`，而主进程只在 `outdated` / `unknown-local` 两支里设它
 *    （`viewFor` 的 `current` 那一支从不设）⇒ 一个"已是最新"的 `.jar.disabled` 文件会显示
 *    「已是最新」，页面上**没有任何东西**告诉用户"游戏不会加载它" —— 那是日常可达的情形。
 * ⇒ 夹具必须把 `.disabled` 写在**绑定路径**上；用 `state.disabled` 造的夹具会喂饱一条
 *    读错了字段的断言（⑨ 里有一条专门反过来的判据）。
 */
const disabledBadge = resolved('files.disabled');
const currentDisabledRow = rowOf(
  tableHtml([viewOf(CURRENT, { binding: BOUND_DISABLED, localVersion: '5.8.26' })]),
  'current',
);
assert.ok(
  textOf(currentDisabledRow).includes(textOf(disabledBadge)),
  '★ 已是最新、但文件是 `.jar.disabled` ⇒ 必须有「已禁用」徽章（游戏不会加载它，而用户不知道）',
);
assert.ok(
  textOf(currentDisabledRow).includes(textOf(resolved('files.upToDate'))),
  '★ 它同时还是「已是最新」——两件事不矛盾（版本对了，文件没启用），不许拿一个盖掉另一个',
);
const uncheckedDisabledRow = rowOf(
  tableHtml([viewOf(UNCHECKED, { binding: BOUND_DISABLED })]),
  'unchecked',
);
assert.ok(
  textOf(uncheckedDisabledRow).includes(textOf(disabledBadge)),
  '★ `unchecked` + `.disabled` 也要有徽章 —— 契约里这一支**没有** `disabled` 那一格 ⇒ 只能按路径算',
);
const currentNormalRow = rowOf(
  tableHtml([viewOf(CURRENT, { binding: BOUND, localVersion: '5.8.26' })]),
  'current',
);
assert.equal(
  textOf(currentNormalRow).includes(textOf(disabledBadge)),
  false,
  '★ 普通路径的行不许出现「已禁用」（这颗徽章一出现，它的意思就没了）',
);
assert.equal(
  textOf(unboundRow).includes(textOf(disabledBadge)),
  false,
  '★ 未绑定的行没有路径可判 ⇒ 不许有徽章（"没绑定"谈不上"禁用了本机哪个文件"）',
);
ok('⑧ 「已禁用」按**路径**算：`current`/`unchecked` + `.disabled` 都有，普通路径与未绑定都没有');

// ---------------------------------------------------------------------------
// ⑨「可更新」与「已禁用」是**两句不同的话**（而且可以同时出现）
// ---------------------------------------------------------------------------
assert.notEqual(
  textOf(disabledBadge),
  textOf(outdatedBadge),
  '★★ 这两颗徽章必须是两个不同的字串 —— 同一句话 = 只看得见灰度的用户分不出"该更新"与"游戏不会加载它"',
);
/*
 * ★ 反面：这一行的**路径**是 `.disabled`，而契约那一格 `disabled` 是 `false` ——
 *   徽章照样要在。这一条盯的就是"有人把它改回去读 `state.disabled`"。
 */
const bothBadgesRow = rowOf(
  tableHtml([viewOf(outdatedState(false), { binding: BOUND_DISABLED, localVersion: '5.8.22' })]),
  'outdated',
);
assert.ok(
  textOf(bothBadgesRow).includes(textOf(outdatedBadge)),
  '★ 那一行仍然是「可更新」（本地这版确实旧了）',
);
assert.ok(
  textOf(bothBadgesRow).includes(textOf(disabledBadge)),
  '★ 路径是 `.disabled` 而 `state.disabled` 是 `false` ⇒ 徽章仍然要在（判据是**路径**，不是那一格）',
);
ok('⑨ 「可更新」≠「已禁用」是两句不同的话，而且同一行可以同时有、且不看 `state.disabled`');

// ---------------------------------------------------------------------------
// ⑩「一键更新」那颗按钮：三档可用条件
// ---------------------------------------------------------------------------
const updateAllText = resolved('files.updateAll');
const allCurrentPanel = panelHtml([viewOf(CURRENT, { binding: BOUND, localVersion: '5.8.26' })]);
const noTargetCta = ctaOf(allCurrentPanel);
assert.equal(
  noTargetCta.label,
  textOf(updateAllText),
  '★ 第一态那颗主按钮就是「一键更新」（它走 `.cta`：这一页真正要用户做的那一下）',
);
assert.equal(
  noTargetCta.disabled,
  true,
  '★ 一条可更新的都没有 ⇒ 禁用（否则点了会一条都不动，却写一个"已更新 0 个"回来）',
);
const outdatedPanel = panelHtml([outdatedView]);
const hasTargetCta = ctaOf(outdatedPanel);
assert.equal(
  hasTargetCta.disabled,
  false,
  '★ 有可更新的行 ⇒ 那颗按钮必须**可用**（禁用过头 = 这个功能没有出路）',
);
const busyPanel = panelHtml([outdatedView], { busyItemId: ITEM.id });
assert.equal(
  ctaOf(busyPanel).disabled,
  true,
  '★ 有任一条在写盘时全局禁用：主进程只接受一条更新（`runUpdate` 会以「正在更新中：…」拒绝），' +
    '与其让用户点了吃一句报错，不如把"现在不能点"写在脸上',
);
ok('⑩ 一键更新：没有可更新的行禁用 / 有则可用 / 有任一条在写盘时全局禁用');

// ---------------------------------------------------------------------------
// ⑪ ★★「一键更新」真的会碰哪几条 +「全是已禁用」那句解释
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 为什么界面要**自己再算一遍**：确认行那句"将把 N 个文件更新到最新版本"里的 N 必须等于
 *    "点下去真的会更新几条"，而 `FileUpdatesState` 里没有"这一次会更新哪些"这一格。
 *    判据与主进程 `updateAll()` 逐格相同：绑定了、`needsUpdate(state)`、**且不是 `.disabled`**。
 *    代价：这是**第二份**判据，会漂 —— 漂的方向正是"确认行说 3 个、实际更新 2 个"。
 */
const boundUpdatable = viewOf(outdatedState(), { binding: BOUND, localVersion: '5.8.22' });
const disabledUpdatable = viewOf(outdatedState(), {
  binding: BOUND_DISABLED,
  localVersion: '5.8.22',
});
const unboundUpdatable = viewOf(outdatedState());
assert.deepEqual(
  updateAllTargets([boundUpdatable, disabledUpdatable, unboundUpdatable]),
  [boundUpdatable],
  '★ 确认句里那个数字的判据：绑定了、可更新、**且不是 `.disabled`** 的才算（一键更新跳过被禁用的）',
);
const onlyDisabledPanel = panelHtml([disabledUpdatable]);
const onlyDisabledText = resolved('files.updateAllDisabledOnly');
assert.ok(
  textOf(onlyDisabledPanel).includes(textOf(onlyDisabledText)),
  '★ 可更新的条目**全是**已禁用那一档必须解释一句（否则用户看到的是"点了没反应"）',
);
assert.equal(
  ctaOf(onlyDisabledPanel).disabled,
  false,
  '★ 那一档按钮要**留着可用**：确实有可更新的条目，只是都被禁用（出路是逐行那颗「更新」）',
);
/*
 * ★★ 反面（Task 6 修复轮抓到的假话）：可更新、但**没绑定** —— 那不是"全是已禁用"。
 *    拿 `targets.length === 0` 推这件事时，这一档也会成立 ⇒ 界面会印出"可更新的条目都是
 *    已禁用的 —— 一键更新会跳过它们"，而那些条目**一个文件都没绑**。
 */
const unboundOnlyPanel = panelHtml([unboundUpdatable]);
assert.equal(
  textOf(unboundOnlyPanel).includes(textOf(onlyDisabledText)),
  false,
  '★ "可更新但没绑定"不是"全是已禁用"：那种组合一个文件都没绑，那句解释是假话',
);
ok('⑪ 确认句里那个数字的判据（绑定 + 可更新 + 非 `.disabled`）与「全是已禁用」那句解释都对');

// ---------------------------------------------------------------------------
// ⑫ 操作列：**两件事同时成立**才画按钮
// ---------------------------------------------------------------------------
/*
 * 判据是 `desktop !== false`（这一页有没有动作层）**且**那个动作的回调真的在手
 * （表格 props 的说明：不画一颗点不动的按钮）。
 * ⚠️★ 最后那条**反面**不能省：没有它的话，"这一列永远不画东西"照样能过上面两条 ——
 *    而那会让 ②③⑥⑦ 里所有"按钮是什么"的断言统统变成空跑。
 */
assert.equal(
  buttonsIn(tableHtml([outdatedView], { desktop: false })).length,
  0,
  '★ `desktop={false}`（浏览器态）⇒ 操作列是空的，一个按钮都不画',
);
assert.equal(
  buttonsIn(html(React.createElement(FileUpdateTable, { views: [outdatedView] }))).length,
  0,
  '★ 一个回调都没给 ⇒ 也不画按钮（点了没反应比没有按钮更糟）',
);
assert.equal(
  labelsIn(tableHtml([outdatedView])).length,
  2,
  '★ 反面：既给了 `desktop` 又给了回调 ⇒ 按钮必须真的在（上面两条否则就是空跑）',
);
ok('⑫ 操作列的两道闸：`desktop={false}` 或没有回调 ⇒ 空列；两件事都给 ⇒ 按钮真的在');

// ---------------------------------------------------------------------------
// ⑬ 正在写盘的那一行：进度文本，不是按钮
// ---------------------------------------------------------------------------
const busyRow = rowOf(tableHtml([outdatedView], { busyItemId: ITEM.id }), 'outdated');
assert.ok(
  textOf(busyRow).includes(textOf(resolved('files.busy', { name: ITEM.name }))),
  '★ 正在写盘的那一行印「正在更新 …」，不是那两颗按钮',
);
assert.equal(
  buttonsIn(busyRow).length,
  0,
  '★ 那一行不许留按钮（留着 = 让人以为还能再点一次，而主进程只接受一条更新）',
);
const percentRow = rowOf(
  tableHtml([outdatedView], { busyItemId: ITEM.id, progress: { itemId: ITEM.id, percent: 42.5 } }),
  'outdated',
);
assert.ok(
  textOf(percentRow).includes(
    textOf(resolved('files.busyPercent', { name: ITEM.name, percent: 42.5 })),
  ),
  '★ 有百分比时要印出来（那个数字由主进程算好，这里不替它四舍五入 —— 那是第二份口径）',
);
const noPercentRow = rowOf(
  tableHtml([outdatedView], { busyItemId: ITEM.id, progress: { itemId: ITEM.id, percent: null } }),
  'outdated',
);
assert.ok(
  textOf(noPercentRow).includes(textOf(resolved('files.busy', { name: ITEM.name }))),
  '★ 上游没给总长（`percent: null`）⇒ 只印「正在更新 …」',
);
assert.equal(
  textOf(noPercentRow).includes('0%'),
  false,
  '★ 那一档**不许编一个 0%**（它是"不知道"，不是"零"）',
);
/*
 * ⚠️ 进度那一格是**全局唯一一份**（`{ itemId, percent }`）⇒ 它说的不是这一行时不许照搬。
 */
const stolenPercentRow = rowOf(
  tableHtml([outdatedView], { busyItemId: ITEM.id, progress: { itemId: 'atlas', percent: 90 } }),
  'outdated',
);
assert.equal(
  textOf(stolenPercentRow).includes('90'),
  false,
  '★ 别人那一行的百分比不许印到这一行上（照搬一个读数就是在编）',
);
ok('⑬ 写盘那一行：进度文本替掉按钮；有百分比就印、`null` 不编 0%、别人那一行的百分比不算');

// ---------------------------------------------------------------------------
// ⑭ ★★「一键更新」的第二态（纯 props 组件）+ 第一态**不是**它
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 为什么第二态必须做成一个**独立导出的纯组件**：`renderToStaticMarkup` 不跑事件处理器
 *    ⇒ 面板里 `confirmingUpdateAll` 那一格在自检里**恒为 `false`**。只有"给 props 就画"
 *    的这一层能断言"第二态 = 那句问话 + 「确定」/「取消」"。
 * ⚠️ 顺带把**第一态**也钉住：静态渲染出来的面板里**不该**有那行确认
 *    （有 = 一进页面就挂着一问没人回答）。
 */
const confirmCount = 3;
const confirmRow = keep(
  html(
    React.createElement(UpdateAllConfirm, {
      count: confirmCount,
      onConfirm: noop,
      onCancel: noop,
    }),
  ),
);
assert.ok(
  confirmRow.includes('filespanel__confirm'),
  '★ 第二态必须走 `UpdateAllConfirm` 那一行的外壳（自己另画一份 = 这条断言测的是一个没人用的组件）',
);
assert.ok(
  textOf(confirmRow).includes(textOf(resolved('files.confirmUpdateAll', { count: confirmCount }))),
  `★ 那句问话要带上"这一次真的会更新几个"（喂 ${String(confirmCount)} ⇒ 句子里就得有 ${String(confirmCount)}）`,
);
assert.deepEqual(
  labelsIn(confirmRow),
  [labelOf('common.confirm'), labelOf('common.cancel')],
  '★ 两颗按钮是「确定」与「取消」（用库里已有的两条词条，没有新造）',
);
const firstStatePanel = panelHtml([boundUpdatable]);
assert.equal(
  firstStatePanel.includes('filespanel__confirm'),
  false,
  '★ 面板默认在第一态：静态渲染里不该出现确认行（出现 = 用户还没点，就挂着一问等他回答）',
);
assert.ok(
  labelsIn(firstStatePanel).includes(textOf(updateAllText)),
  '★ 第一态那颗「一键更新」在（第一态没有它，用户就永远到不了第二态）',
);
ok('⑭ 第二态 = 那句带数字的问话 + 「确定」/「取消」（纯组件）；第一态里没有那行确认');

// ---------------------------------------------------------------------------
// ⑮ 行里那一格逐条读数时间（"这一条"几时读的，而不是列表级的时钟）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 为什么它必须画在**行里**：面板上那行元信息印的是**列表级**的 `lastCheckedAt`，
 *    而 `autoUpdate` 关掉的条目在启动检查里会被跳过 ⇒ 同一个进程里列表级那个时钟可以比
 *    某一行自己的时钟新。两者不是矛盾，是**两个不同的时钟**。
 * ⚠️ 它是 `null` 时**一个字都不印**（`FileItemState` 的读数只活在这一次进程里；
 *    印一个时间戳去填它就是在编一个"我读过了"）。
 */
const checkedAt = Date.UTC(2026, 8, 24, 6, 3);
const checkedRow = rowOf(
  tableHtml([
    viewOf(outdatedState(), { binding: BOUND, localVersion: '5.8.22', lastCheckedAt: checkedAt }),
  ]),
  'outdated',
);
assert.ok(
  textOf(checkedRow).includes(
    textOf(resolved('files.rowChecked', { time: formatClock(checkedAt) })),
  ),
  '★ 行里要印**这一条**上次检查的时刻（与面板那行列表级的 `files.lastChecked` 是两条词条、两个时钟）',
);
/*
 * ⚠️★ 判据写的是"整行里**没有任何**时间形状的字"，**不是**"没有 `checkedAt` 那个时刻"。
 *    第一版正是后者，而"给没有读数的那一行编一个 `formatClock(0)`（00:00）顶上"那一刀
 *    让它**照旧全绿** —— 那种判据只抓得住"拿同一个时刻去填"这一种编法。
 *    （这一条是跑了那一刀之后改的：能红的守卫和"看起来在守卫"的守卫，差别就在这种地方。）
 */
assert.equal(
  /\d{1,2}:\d{2}/.test(textOf(unboundRow)),
  false,
  '★ `lastCheckedAt === null` ⇒ 一个时间戳都不印（任何"时:分"形状的字都不许出现）',
);
ok('⑮ 行内逐条读数时间：有就读数、`null` 就一个字都不印');

// ---------------------------------------------------------------------------
// ⑯ `reduceLoad()` 那一台状态机（**数据永远压过一次失败结论**）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 为什么它必须在这里被钉住：桌面态那两条支路是**独立**的（`onStatus` 推送 / `getState()`
 *    首拉）⇒ "首拉先失败、推送后带来数据"这个顺序**真的会发生**。把失败结论当成"粘住的"
 *    状态会让页面一直停在「拿不到本地文件状态：…」，而手上其实已经有数据 —— 那句**已经
 *    不成立**的话会一直挂在屏幕上。
 * ⚠️ 它此前只有一份**不可复跑**的探针（`.cache/` 下）⇒ 这一轮把它搬进这条自检里。
 */
const snapshot = stateOf([viewOf({ kind: 'unbound' })]);
const failed = reduceLoad(NO_LOAD, {
  kind: 'failure',
  failedAt: 'catalog',
  reason: 'BOOM-1',
});
assert.equal(failed.status, 'failed', '★ 起点是"什么都不知道"（loading）时，一次失败 ⇒ 失败那一屏');
assert.equal(
  failed.failure.failedAt,
  'catalog',
  '★ 失败要说清是哪一半：浏览器态拉目录 / 桌面态拿状态',
);
assert.equal(failed.state, null, '★ 失败那一屏上没有数据（两格互斥的联合类型就是为了这件事）');
const recovered = reduceLoad(failed, { kind: 'snapshot', state: snapshot });
assert.equal(
  recovered.status,
  'ready',
  '★★ 数据到手 ⇒ 上一次的失败结论**作废**（它已经被这份数据推翻了）',
);
assert.equal(recovered.failure, null, '★★ 失败结论不许"粘"在屏幕上（那一句已经不成立了）');
assert.equal(recovered.state, snapshot, '★ 而且收下的就是这一份（不是复制、不是空壳）');
assert.equal(
  reduceLoad(recovered, { kind: 'failure', failedAt: 'state', reason: 'BOOM-2' }),
  recovered,
  '★★ 已经有数据时又来一次失败 ⇒ **原样返回**（同一个对象）：不许把一句过期的话压在数据上面',
);
const nextSnapshot = stateOf([viewOf({ kind: 'unbound' })]);
const replaced = reduceLoad(recovered, { kind: 'snapshot', state: nextSnapshot });
assert.equal(replaced.status, 'ready', '★ ready 之后再来一份快照 ⇒ 还是 ready');
assert.equal(
  replaced.state,
  nextSnapshot,
  '★ 而且换成新的那一份（照着旧的一份画就是拿过期读数当现值）',
);
ok('⑯ `reduceLoad`：失败 → 数据到手撤回失败结论；有数据时失败不改画面；ready 换成新的一份');

// ---------------------------------------------------------------------------
// ⑰ 浏览器态那一整页（真的 `Files`）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 这里渲染的是**真的路由页**。静态渲染下 `window.mcsr` 不存在 ⇒ 走的就是浏览器态，
 *    而 `useFileUpdates()` 里的 effect 一行都不跑 ⇒ 这一屏是「加载中…」。
 *    ⇒ 能断言的正是那几件"不依赖数据就该在"的事：标题、说明、以及那句"这里不是桌面版"。
 *    ⚠️ 页面里那个 `<DesktopDownload />` 在 `renderToStaticMarkup` 下**渲染成 `null`**
 *    （它自己会 `fetch('/api/desktop/release')`，静态渲染里 `useAsync` 停在 loading）
 *    ⇒ 这条自检断言的是那句 `files.browserOnly` 的 Notice，**不是**那张下载卡。
 *    下载卡住不住在这里：`homerender.tsx` 那边有它自己的覆盖。
 */
const pageHtml = keep(
  html(React.createElement(MemoryRouter, null, React.createElement(Files, null))),
);
const pageText = textOf(pageHtml);
assert.ok(
  pageText.includes(textOf(resolved('files.title'))),
  '★ 整页渲染里必须有标题（`Files` 整个没挂上标签路由时，这是最先露出来的一处）',
);
assert.ok(
  pageText.includes(textOf(resolved('files.browserOnly'))),
  '★ 浏览器态那句"本地文件的读写只发生在桌面版里"必须在页面上 —— 用户看到一张"未绑定"的表，' +
    '第一反应是"为什么点不动"，而不是"我需要装桌面版"',
);
assert.ok(
  pageText.includes(textOf(resolved('common.loading'))),
  '★ 静态渲染里没有 effect ⇒ 这一屏是「加载中…」（这也是为什么表格/面板必须纯 props）',
);
assert.equal(
  pageHtml.includes('filespanel'),
  false,
  '★ 还没拿到状态就不画面板（画一张空表 = 让用户以为"我一个文件都没绑"）',
);
/*
 * ★ 浏览器态那两条**失败**分支的文字（`files.catalogError` / `files.stateError`）。
 *
 * ⚠️★ 先说清它**不是**什么：那一屏在自检里**渲染不出来** —— 走到它要求
 *    `useFileUpdates()` 真的失败一次，而静态渲染一行 effect 都不跑
 *    （要看到那一屏得真浏览器 + 一个真的坏掉的目录，归 Task 8）。
 *    所以这里只钉住**那句话本身**：`{{reason}}` 必须真的把那个码插进去。
 *
 * ⚠️★ 为什么值得单列一条：服务端那一边
 *    （`services/api/src/error-codes.test.ts` 的 `INTENTIONALLY_GENERIC`）为
 *    `catalog_unavailable` / `catalog_invalid` / `catalog_invalid_json` 三个码登记的
 *    理由正是"**用户看到的是一句带码的话**，码是值班的人唯一能自己动手的线索
 *    （重跑部署 / 改文件是两件不同的事）"—— 这一条就是那句话的存在性守卫；
 *    码本身没有中文说法，那是登记时写明的代价。
 */
const codeProbe = 'catalog_unavailable';
assert.ok(
  textOf(resolved('files.catalogError', { reason: codeProbe })).includes(codeProbe),
  `★ 浏览器态"目录拉不回来"那句必须**带上那个码**（「…：${codeProbe}」）—— 三个码没有各自的中文说法，码就是线索`,
);
assert.ok(
  textOf(resolved('files.stateError', { reason: codeProbe })).includes(codeProbe),
  '★ 桌面态"连状态都没拿到"那句同理（`{{reason}}` 不插进去 = 用户只看到一句"失败了"）',
);
ok('⑰ 浏览器态的整页：标题 + 「只能在桌面版」那句 + 「加载中…」；两条失败分支的话都带码');

// ---------------------------------------------------------------------------
// ⑱ ★★ 读源码的七条守卫：两步确认真的接在**按钮**上
// ---------------------------------------------------------------------------
/*
 * ⚠️★★ 先说清楚这一段**证不了什么**：`renderToStaticMarkup` 一行事件处理器都不跑
 *    ⇒ 「点一下真的会先进待确认、而不是直接写盘」这件事**没有任何产物能证明**。
 *    那要一个**真浏览器 + 真主进程**（Task 8）。这里退一步钉**它成立的前提**：
 *    那条路**在**、而且**只有一条**。
 *
 * ⚠️★ 抄 Task 6 的配方时改了两处（那一轮的评审证明原配方抓不到真正会坏的那一刀）：
 *    ① 锚点在**按钮**上（`onClick={requestUpdateAll}` + 那颗按钮自己的文字），
 *       不是锚在 `requestUpdateAll` 的函数体上 —— 原来那五条对"把 `.cta` 的 `onClick`
 *       改成 `confirmUpdateAll`"（第一次点击就直接开写、确认行永远不可达）**全绿**；
 *    ② 多了一条"`showConfirm` 必须**由** `confirmingUpdateAll` 推出"—— 写死 `false`
 *       只有它能抓。
 *
 * ★ 每一条都点名了**能让它红的那一刀**，而且那一刀都真的跑过（改完立刻还原，
 *   还原后 `sha256` 与改前逐字节相同）。做不到这一点的守卫**不写** ——
 *   一条恒真的守卫比没有守卫更坏（`docs/pending.md §5.32` 的第一类）。
 */
const panelCode = withoutComments(
  readFileSync(new URL('../src/components/FileUpdatesPanel.tsx', import.meta.url), 'utf8'),
);

/*
 * ★★ 七条守卫**每一刀都真的跑过**（在 `apps/web` 里改坏 → 跑本脚本 → 还原 → `sha256`
 *    逐字节核对）。实测读数（跑台是一份 `.cache/` 下的一次性脚本，31 刀的完整读数抄在
 *    `task-7-report.md` §4）：
 *      · `onClick={requestUpdateAll}` → `onClick={confirmUpdateAll}` ⇒ 守卫 2 红
 *        （"那颗「一键更新」按钮的 onClick 必须**只**是 requestUpdateAll"）；
 *      · `const showConfirm = confirmingUpdateAll && targets.length > 0;` → `= false;` ⇒ 守卫 3 红；
 *      · 在 `requestUpdateAll` 里补一次 `handlers.updateAll()` ⇒ 守卫 4 红（"今天出现 2 次"）；
 *      · 在 `requestUpdateAll` 里插一句 `window.confirm('x')` ⇒ 守卫 1 红；
 *      · 删掉 `setConfirmingUpdateAll(true);` ⇒ 守卫 5 红；
 *      · `count={targets.length}` → `count={views.length}` ⇒ 守卫 6 红；
 *      · 删掉 `cancelUpdateAll` 里那一格 `setConfirmingUpdateAll(false)` ⇒ 守卫 7 红。
 *    ⚠️★ 反面也记一笔（免得下一个人以为锚在按钮上就够了）：**锚在按钮上的那条守卫
 *    抓不到"`requestUpdateAll()` 不再置那一格"**（那一刀下它照旧绿），而守卫 5 抓不到
 *    "接线被别人换掉"。两条各管一半，缺一条就有一半的坏法没人喊。
 */

// —— 守卫 1：这一页不许再用 `window.confirm`（能红的那一刀：在 `requestUpdateAll` 里插一句
//    真的 `window.confirm(...)` 调用）——
assert.equal(
  panelCode.includes('window.confirm'),
  false,
  '★ `window.confirm` 在 SSR 里不跑、门禁看不见 ⇒ 这一页不许出现它（Task 6 修复轮正是为这件事改成行内两步的）',
);

// —— 守卫 2：★★ 锚在**按钮**上（能红的那一刀：`onClick={requestUpdateAll}` → `onClick={confirmUpdateAll}`）——
assert.match(
  panelCode,
  /<button\b[^>]*className="cta"[^>]*onClick=\{requestUpdateAll\}[^>]*>\s*\{t\('files\.updateAll'\)\}/,
  '★★ 那颗「一键更新」按钮的 onClick 必须**只**是 `requestUpdateAll`（把这一步问出来）。' +
    '锚在按钮上：锚在函数体上的话，"把 onClick 改成 confirmUpdateAll"那一刀能让所有守卫全绿',
);

// —— 守卫 3：★★ `showConfirm` 由 `confirmingUpdateAll` 推出（能红的那一刀：写死 `false`）——
assert.match(
  panelCode,
  /const\s+showConfirm\s*=\s*confirmingUpdateAll\b/,
  '★★ `showConfirm` 必须**由 `confirmingUpdateAll` 推出来** —— 写死 `false` 的唯一一条守卫' +
    '（写死之后那颗按钮永远在第一态，确认行不可达，而点击**看起来**完全正常）',
);

// —— 守卫 4：`handlers.updateAll()` 全页只出现一次（能红的那一刀：在 `requestUpdateAll` 里补一次调用）——
const updateAllCalls = panelCode.match(/handlers\.updateAll\(\)/g) ?? [];
assert.equal(
  updateAllCalls.length,
  1,
  `★★ \`handlers.updateAll()\` 在这一页必须**只出现一次**（就在确认那一步里），今天出现 ${String(updateAllCalls.length)} 次 —— 多出来的那一次就是"从别处直接开写"`,
);

// —— 守卫 5：`requestUpdateAll()` 真的进入待确认态（能红的那一刀：删掉那一格 `setConfirmingUpdateAll(true)`）——
assert.match(
  panelCode,
  /const\s+requestUpdateAll[\s\S]{0,400}?setConfirmingUpdateAll\(true\)/,
  '★★ `requestUpdateAll()` 必须真的把"待确认"这一格置真 —— 它不置 ⇒ 那颗按钮点了什么都不发生，' +
    '而上面那三条守卫（2 / 3 / 4）**全绿**（这一条**不是**守卫 2 的替代：它抓的是函数体不再干活，' +
    '锚在按钮上的那条抓的是接线被别人换掉）',
);

// —— 守卫 6：确认行里那个数字来自 `targets.length`（能红的那一刀：改成 `views.length`）——
assert.match(
  panelCode,
  /<UpdateAllConfirm\b[^>]*count=\{targets\.length\}/,
  '★★ 确认行那个数字必须是 `targets.length`（"点下去真的会更新几条"）—— 写成 `views.length` 就会' +
    '把跳过的那几条也算进去，而用户唯一的读数就是那句话',
);

// —— 守卫 7：取消那一颗**真的**退回第一态（能红的那一刀：删掉 `cancelUpdateAll` 里那一格 `setConfirmingUpdateAll(false)`）——
/*
 * ⚠️★ 判据是"**这个函数自己的函数体**里有没有那一格"，不是"从它的声明往后 200 个字里有没有"
 *    —— 后者是第一版，而那一刀**没有让它红**：删掉那一格之后，那个窗口里出现的是**下一个函数**
 *    （`confirmUpdateAll`）里同一句 `setConfirmingUpdateAll(false)`，守卫于是照旧绿。
 *    "能从声明往后找 200 字"这种锚**跨得过函数边界**，锚不住它想锚的东西
 *    （本仓 §5.32 的第二类：读数看着有、其实什么都没测）。这一条是跑完那一刀之后改的。
 */
const cancelBody = /const\s+cancelUpdateAll\s*=[\s\S]*?\{([\s\S]*?)\n\s*\};/.exec(panelCode);
assert.ok(
  cancelBody !== null,
  '找不到 `cancelUpdateAll` 的函数体（它被改名 / 搬走 / 换了写法 ⇒ 下面那条判据会变成空跑）',
);
/*
 * ⚠️ 判据读的是 `cancelBody[1]`（**函数体**那一格），不是 `cancelBody` 那个 Match：
 *    函数体被删空时它是**空串**，而 `assert.ok('')` 会在"函数没了"那句上报红 ——
 *    读到的红点与真正坏了的东西对不上（本仓 §5.74 那一类）。两件事分开断言。
 */
assert.ok(
  cancelBody[1].includes('setConfirmingUpdateAll(false)'),
  '★★ `cancelUpdateAll()` 必须真的把"待确认"撤回去 —— 它不撤 ⇒ 那颗「取消」点了没反应，' +
    '而这一行会一直挂在那里等一个用户已经回答过（"不"）的问题',
);
ok(
  '⑱ 源码形状守卫 7 条：两步确认接在**按钮**上、`showConfirm` 由待确认态推出、`updateAll()` 只一处',
);

// ---------------------------------------------------------------------------
// ⑲ 裸 key 泄漏（用 Task 6 那个**具名**扫描器）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 扫描器**只有这一个**（从表格 `import` 的 `rawKeysIn` / `RAW_KEY_RE`）：
 *    "算泄漏"与下面两条探针用的是**同一个**对象。原来的坏形状是两处各写一个正则字面量、
 *    而且两个长得不一样（探针那份少了 `name` 那一支）⇒「把扫描器改坏」不会有任何断言出声，
 *    而 `ok(...)` 照旧宣称"扫描器本身能命中" —— 一条在撒谎的守卫。
 * ⚠️ 两条探针在**扫产物之前**跑，所以它们才是先响的那一个：放在后面的话，一条坏掉的扫描器
 *    会先被"产物里有泄漏"那条拦住，你看到的是"产物里有泄漏"，而真正坏的是扫描器
 *    （`docs/pending.md §5.74` 那句"命令写错时输出长得像这一项没过"的同一类麻烦）。
 */
assert.deepEqual(
  rawKeysIn('SpeedRunner 与 Cancel 这两串字不是 key'),
  [],
  '泄漏扫描器不该命中普通文案里的词（否则它会变成噪声，而噪声没人再看）',
);
assert.deepEqual(
  rawKeysIn('files.foo common.bar'),
  ['files.foo', 'common.bar'],
  '泄漏扫描器必须**两个前缀都命中**（`files.` 这一页自己的词条 / `common.` 的空态与加载中）' +
    '—— 少一支，那一支上的裸 key 就是空跑',
);
/*
 * ⚠️★ 这一条直接念**导入的那个具名对象**的 source，是上面那条探针的补丁：
 *    哪天有人把 `RAW_KEY_RE` 的 `common` 那一支删掉，恰好那天没有 `common.*` 裸 key 漏出来时，
 *    上面那条探针才是唯一能说话的人 —— 而它说的是"命中不了"，不是"有泄漏"。
 *    （两个前缀写在**同一个**对象里，所以这一条与上面那条是同一件事的两面。）
 */
assert.ok(
  RAW_KEY_RE.source.includes('files') && RAW_KEY_RE.source.includes('common'),
  '泄漏扫描器（`RAW_KEY_RE`，从表格 import 的那一个）必须同时认得 `files.` 与 `common.` 两个前缀',
);

const leaked = rawKeysIn(samples.join(''));
assert.deepEqual(
  leaked,
  [],
  `裸 key 泄漏：${leaked.join(', ')}（i18next 对未知 key 不报错，它会把这个 key 原样印在界面上）`,
);
ok(`★ 渲染产物（${String(samples.length)} 份）里没有裸 key 泄漏，扫描器本身也已被两条探针夹住`);

// ---------------------------------------------------------------------------
// ⑳ 英文那一遍：整页零汉字
// ---------------------------------------------------------------------------
if (LANG === 'en') {
  /*
   * ⚠️★ 这一条只在 `--en` 那一遍跑（`--en` 不是可选的：词条泄漏只有英文渲染下才暴露 ——
   *    中文环境里 `t()` 会回退到 zh）。
   * ⚠️ 样本里**没有**任何中文夹具：`NOTE` 是中文但表格刻意不印它（② 里那条判据），
   *    主进程那句 `message` 在夹具里换成了 ASCII（见 `FAILURE` 那段）⇒ 这里不需要开豁免口子。
   *    开口子的扫描在**最该抓人的那一处**是瞎的。
   */
  const han = textOf(samples.join('')).match(/[\u4e00-\u9fff]+/g) ?? [];
  assert.deepEqual(han, [], `英文界面里出现了中文：${han.slice(0, 8).join(' / ')}`);
  ok('⑳ 英文那一遍：全部渲染产物零汉字');
}

// ---------------------------------------------------------------------------
// 组数探针（手抄的，理由见下）
// ---------------------------------------------------------------------------
/*
 * ⚠️ 组数是**手抄的**（本仓惯例，`seedsrender.tsx` 末段写着同一条）：它防的是"把某一段
 *    整块摘掉" —— 删掉一整组断言之后脚本照样绿、照样打印"通过 N 项"，只有这个数字会变。
 *    ⇒ 改脚本就要一起改这里（改的时候**现数**，别估）。
 * ⚠️ en 比 zh 多 1：⑳ 那个零汉字扫描只在 en 那一遍跑，两个数差 1 是**正常的**，别抹平。
 */
const expectedGroups = LANG === 'en' ? 20 : 19;
assert.equal(
  pass,
  expectedGroups,
  `探针：这一轮应当通过 ${String(expectedGroups)} 组（少了就说明有人把某一段摘掉了）`,
);

console.log('');
console.log(`通过 ${pass} 项。`);
console.log('');
console.log('⚠️ 这个脚本验的是**渲染**（外加 ⑯ 一台纯状态机与 ⑱ 的几条源码形状）：');
console.log('   没有点击、没有请求、没有真实浏览器、也没有主进程。');
console.log('   具体没被覆盖的（至少这几样）：');
console.log('     · 「一键更新」那两下**真的**会跳态 —— 静态渲染一行事件处理器都不跑，');
console.log('       ⑱ 只钉住"那条路在、而且只有一条"（那一步的判据要真浏览器 + 真主进程）；');
console.log('     · 原生对话框（选 .jar / 选 mods 目录）与**真的下载、真的写盘**（Task 8）；');
console.log('     · 桌面态那一半的任何一屏：这里没有 preload（`window.mcsr` 是 undefined）⇒');
console.log('       ⑰ 那一屏是浏览器态的加载中，桌面态的目录/状态失败两条支路都到不了；');
console.log('     · `/api/file-catalog` 的真实响应（effect 一行都不跑）；');
console.log('     · 主进程写死的那句中文错误原话（夹具是 ASCII 串，见 `FAILURE` 那段）；');
console.log('     · 面板的 `pending` 那一档（「正在检查…」）—— 它在组件内部，喂不进 props。');
