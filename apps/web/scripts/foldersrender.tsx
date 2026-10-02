#!/usr/bin/env tsx
/**
 * 「文件更新」`/files` 那一页 · **第一部分（目录行）** 的渲染自检
 * （2026-10-03，Task 7 —— 第 14 个渲染自检；**本任务先不接进 `check:all`**，由 T8 接）。
 *
 * 跑法（从仓库根）：
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:folders
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:folders -- --en
 *
 * ===========================================================================
 * 为什么这一页必须有它
 * ===========================================================================
 * 与 `filesrender.tsx`（v1 那一半）逐字同一条理由：`apps/web` 没有测试运行器
 * （`CONTRIBUTING.md`），而第一部分这一批"每行给不给按钮 / 给几颗 / 标哪个来源 /
 * 三处空态"全是**只能用产物证明**的东西 —— 类型检查看不见"块整个没渲染"、
 * "词条打错一个字母"、"给 manual 的行画了一颗会被主进程拒的按钮"。
 * i18next 对未知 key **不报错**，它把 key 原样印在界面上。
 *
 * ===========================================================================
 * ⚠️★ 边界：这个脚本**证不了**什么（与 filesrender 的边界同型，别混）
 * ===========================================================================
 * `renderToStaticMarkup` **不点击、不跑事件处理器、不跑 effect**（`docs/pending.md §5.73`）：
 *   · 「点一下真的走了哪条通道」/「点了真的会弹原生对话框」——**一件都不碰**。
 *     通道的接线只由 ⑯ 那几条**源码形状守卫**兜着（它证的是"那条路在、而且只有一条"）；
 *   · `useModFolders()` 的三条支路（订阅 / 首拉 / 失败）在自检里**跑不到**：
 *     `window.mcsr` 是 `undefined` ⇒ 它只会停在 `unavailable`（浏览器那一支）。
 *     ⇒ ⑰ 只钉住「正在扫描…」那一屏的**组件**，不钉"钩子真的会进那一屏"；
 *   · 主进程写死的中文（`notices` / `lastRun.skipped[].reason` / 标签显示名）——
 *     夹具里一律换成 ASCII（见下面 `NOTE` / `SKIP_REASON` / `TAG_LABEL` 三段）：
 *     它们的语言不归这一层管（`CatalogRowView.tagLabels` 只带目录里的 `zh`，
 *     这是 T1 那一层定下的代价），而 ⑱ 的零汉字扫描**不许开豁免口子**。
 *
 * ===========================================================================
 * ⚠️★★ 锚点纪律：锚在**按钮与文案**上，不锚函数名（v1 的现场）
 * ===========================================================================
 * v1（`filesrender.tsx`）的现场：锚在 `requestUpdateAll` 的**声明**上时，那一刀
 * "把 `.cta` 的 `onClick` 改成直接开写"**五条守卫全绿**。⇒ 这个脚本里：
 *   · 「给不给按钮」一律断言**产物里那颗按钮的文字**（`labelsIn`）；
 *   · 「按哪条通道」没有产物可锚（静态渲染不跑处理器）⇒ 只由 ⑯ 的**接线守卫**兜着，
 *     而那几条守卫的刀**真的跑过**（改坏 → 跑 → 还原 → `sha256` 核对，读数在报告里）。
 *
 * ===========================================================================
 * 组数（手抄的，见文件末尾那条探针）
 * ===========================================================================
 * zh 16 组、en 17 组（⑰ 只在 `--en` 那一遍跑）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { en, zhCN } from '@mcsr/shared/i18n';
import type { ModRelease } from '@mcsr/shared/modCatalog';
import type { CatalogRowView, ModFoldersState } from '@mcsr/shared/modFolders';
import i18n from 'i18next';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import {
  ModCatalogScanning,
  ModCatalogSection,
  type ModFoldersHandlers,
  NO_MOD_FOLDERS_LOAD,
  reduceModFoldersLoad,
  toggleTag,
} from '@/components/FileUpdatesPanel';
import { ModCatalogTable, RAW_KEY_RE, rawKeysIn } from '@/components/FileUpdateTable';

const LANG = process.argv.includes('--en') ? 'en' : 'zh-CN';

await i18n.init({
  lng: LANG,
  fallbackLng: false,
  resources: { 'zh-CN': { translation: zhCN }, en: { translation: en } },
  interpolation: { escapeValue: false },
});

/*
 * ⚠️ 刻意**不用 JSX**（与 `filesrender.tsx` 同一条）：`scripts/**` 不在 tsconfig 的
 *    `include` 里 ⇒ JSX 走 classic runtime ⇒ 必须 `import React from 'react'`，
 *    而 biome 的 `noUnusedImports` 会把它判成未使用并提供一个**不安全自动修复** ——
 *    谁点了那个修复，脚本就在运行时崩。
 */

/** 一段渲染产物 → 人看到的那串字（与 filesrender 同一个口径：空白一律压掉）。 */
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
 * 针孔探针（本仓老规矩，与 filesrender 同一个）：词条必须**真的解析出译文**。
 *
 * ⚠️ 缺键时 i18next **原样返回 key** ⇒ 正面断言比的是 key 与 key（照样通过）、
 *    反面断言（"这一行不许出现 X"）**直接静默变绿**。
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

/** 词条的**归一化**形式（与 `textOf` 同一个口径；英文那一遍的空白差异在这里被抹平）。 */
const labelOf = (key: string, opts?: Record<string, unknown>): string =>
  textOf(resolved(key, opts));

const html = (node: React.ReactElement): string =>
  renderToStaticMarkup(React.createElement(I18nextProvider, { i18n }, node));

/** 所有渲染过的产物都进这里 —— ⑬ 的裸 key 扫描与 ⑱ 的零汉字扫描扫的就是它。 */
const samples: string[] = [];
const keep = (markup: string): string => {
  samples.push(markup);
  return markup;
};

// ---------------------------------------------------------------------------
// 夹具（全是**手写**的：静态渲染不跑 effect ⇒ 状态只能从外面喂）
// ---------------------------------------------------------------------------

/*
 * ⚠️★ 三个 ASCII 夹具，各自都有理由（照 `filesrender.tsx` 的 `FAILURE` 那一段）：
 *   · `TAG_LABEL`：`CatalogRowView.tagLabels` 只带目录里的 **`zh`** 那一份
 *     （`packages/shared/src/modFolders.ts` 的 `tagLabelsOf` 写着这件事：这一层没有
 *     locale 参数）⇒ 真实目录里它**是中文**。夹具换成中文的话，⑱ 那条"英文产物零汉字"
 *     就得给扫描开一个豁免口子 —— 而开了口子的扫描在**最该抓人的那一处**是瞎的。
 *     代价：这条断言只说"显示名原样印出来"，不说"它是哪种语言"（那是 T1/T8 的事）。
 *   · `NOTE`：`ModFoldersState.notices[]` 由主进程写（中文），T7 只负责原样印。
 *   · `SKIP_REASON`：`lastRun.skipped[].reason` 同理（T6 的 `skipReasonOf`）。
 */
const TAG_LABEL = 'tag-legal';
const NOTE = 'MIGRATION-NOTICE-31337: adopted into folder tracking';
const SKIP_REASON = 'SKIP-REASON-4242: local build is newer';
/** 「没有值的那一格」——与两张表里那个 `DASH` 是同一个字符。 */
const DASH = '—';

const GITHUB_URL =
  'https://github.com/CaffeineMC/sodium-fabric/releases/download/mc1.16.1-0.1.3/sodium-fabric-0.1.3.jar';
const CDN_URL = 'https://cdn.modrinth.com/data/AANobbMI/versions/abc123/sodium-fabric-0.1.3.jar';
const OPTIFINE_URL = 'https://optifine.net/adloadx?f=OptiFine_1.16.1_HD_U_G2.jar';

function release(
  modid: string,
  version: string,
  url: string,
  download: 'auto' | 'manual' = 'auto',
): ModRelease {
  return {
    modid,
    version,
    url,
    sha1: 'a'.repeat(40),
    sha512: 'b'.repeat(128),
    size: 1234,
    targetVersions: ['1.16.1'],
    dependencies: [],
    obsolete: false,
    intermediary: [],
    download,
  };
}

const SODIUM_OLD = release('sodium', '0.1.2', CDN_URL);
const SODIUM_NEW = release('sodium', '0.1.3', GITHUB_URL);
const OPTIFINE = release('optifine', 'HD_U_G2', OPTIFINE_URL, 'manual');
/** 上游（Modrinth）解析出来的那一条：**不在 `candidates` 里**（Ruling 13 的现场）。 */
const UPSTREAM_NEW = release('mcsrranked', '5.8.26', GITHUB_URL);
const CATALOG_OLD = release('mcsrranked', '5.8.22', CDN_URL);

const BINDING = { localPath: 'D:\\mods\\sodium.jar', localVersion: '0.1.2' };

/** 一行：**已绑定 + 可更新（`older` + auto）**，来源是 GitHub（⇒ 该有两颗按钮）。 */
const ROW_GITHUB: CatalogRowView = {
  rowId: 'sodium|1.16.1',
  modid: 'sodium',
  name: 'Sodium',
  gameVersion: '1.16.1',
  tags: ['legal'],
  tagLabels: [TAG_LABEL],
  candidates: [SODIUM_NEW],
  official: SODIUM_NEW,
  targetSource: 'catalog',
  verdict: { kind: 'older', release: SODIUM_NEW },
  manual: false,
  batchable: true,
  binding: BINDING,
};

/** 同一行，但目标来自 `cdn.modrinth.com` ⇒ **只有**原始那一颗（D5）。 */
const ROW_CDN: CatalogRowView = {
  ...ROW_GITHUB,
  official: SODIUM_OLD,
  verdict: { kind: 'older', release: SODIUM_OLD },
};

/** `manual`（OptiFine 那一类）：**一颗按钮都没有**，只有「打开原网页」。 */
const ROW_MANUAL: CatalogRowView = {
  ...ROW_GITHUB,
  rowId: 'optifine|1.16.1',
  modid: 'optifine',
  name: 'OptiFine',
  candidates: [OPTIFINE],
  official: OPTIFINE,
  verdict: { kind: 'older', release: OPTIFINE },
  manual: true,
  batchable: false,
};

/** 本地比目标新（D1 的"只升不降"）：只提示，**不给**更新按钮。 */
const ROW_NEWER: CatalogRowView = {
  ...ROW_GITHUB,
  rowId: 'ranked|1.16.1',
  modid: 'ranked',
  name: 'Ranked',
  binding: { localPath: 'D:\\mods\\ranked.jar', localVersion: '5.8.26' },
  candidates: [UPSTREAM_NEW],
  official: UPSTREAM_NEW,
  verdict: { kind: 'newer', release: UPSTREAM_NEW },
  batchable: false,
};

/** 版本主体相同、字节不同（spec §8 的 `different-build`）：只提示。 */
const ROW_DIFFERENT_BUILD: CatalogRowView = {
  ...ROW_NEWER,
  verdict: { kind: 'different-build', release: UPSTREAM_NEW },
};

/** 比不出来（`compareLocalToRelease` 的 `unknown`，spec §7.2 写作 `different`）：只提示。 */
const ROW_UNKNOWN: CatalogRowView = {
  ...ROW_NEWER,
  verdict: { kind: 'unknown', release: UPSTREAM_NEW },
};

/** 两个候选（`optifine|1.7.2` / `speedrunigt|26.1` 那种）：**没有目标**，要求明确选。 */
const ROW_AMBIGUOUS: CatalogRowView = {
  ...ROW_GITHUB,
  rowId: 'speedrunigt|1.16.1',
  modid: 'speedrunigt',
  name: 'SpeedRunIGT',
  candidates: [SODIUM_OLD, SODIUM_NEW],
  official: null,
  verdict: { kind: 'ambiguous', releases: [SODIUM_OLD, SODIUM_NEW] },
  batchable: false,
};

/** ★ 上游目标：`official` **不在** `candidates` 里（Ruling 13 的现场）。 */
const ROW_UPSTREAM: CatalogRowView = {
  ...ROW_GITHUB,
  rowId: 'mcsrranked|1.16.1',
  modid: 'mcsrranked',
  name: 'MCSR Ranked',
  binding: { localPath: 'D:\\mods\\ranked.jar', localVersion: '5.8.26' },
  candidates: [CATALOG_OLD],
  official: UPSTREAM_NEW,
  targetSource: 'upstream',
  verdict: { kind: 'older', release: UPSTREAM_NEW },
};

/** 未绑定：没有本地读数 ⇒ 只能「绑定本地文件」。 */
const ROW_UNBOUND: CatalogRowView = {
  ...ROW_GITHUB,
  rowId: 'lithium|1.16.1',
  modid: 'lithium',
  name: 'Lithium',
  candidates: [release('lithium', '0.6.0', CDN_URL)],
  official: release('lithium', '0.6.0', CDN_URL),
  verdict: { kind: 'unknown', release: release('lithium', '0.6.0', CDN_URL) },
  batchable: false,
  binding: null,
};

/** 已是最新（`same`）：第三处空态那一档。 */
const ROW_SAME: CatalogRowView = {
  ...ROW_GITHUB,
  verdict: { kind: 'same', release: SODIUM_NEW },
  batchable: false,
};

function stateOf(rows: CatalogRowView[], extra: Partial<ModFoldersState> = {}): ModFoldersState {
  return {
    catalogStatus: 'ok',
    gameVersion: '1.16.1',
    tagFilter: [],
    bulkChannel: 'origin',
    catalogRows: rows,
    folders: [],
    missing: [],
    missingStatus: 'ok',
    notices: [],
    busy: false,
    lastRun: null,
    ...extra,
  };
}

const noop = (): void => undefined;
/** 五个动作的包装 —— **值不会被执行**（静态渲染一行事件处理器都不跑），只为把 props 填满。 */
const HANDLERS: ModFoldersHandlers = {
  setCatalogGameVersion: async () => undefined,
  setTagFilter: async () => undefined,
  bindCatalogRow: async () => undefined,
  updateCatalogRow: async () => undefined,
  rescan: async () => undefined,
};

/** 渲染整个第一部分（默认**桌面态**：有动作层）。 */
const sectionHtml = (
  state: ModFoldersState,
  props: { handlers?: ModFoldersHandlers | null; actionError?: string | null } = {},
): string =>
  keep(
    html(
      React.createElement(ModCatalogSection, {
        state,
        handlers: props.handlers === undefined ? HANDLERS : props.handlers,
        actionError: props.actionError ?? null,
      }),
    ),
  );

/** 只渲染那张表（⑫ 的"没有动作层"那两条要单独喂 props）。 */
const tableHtml = (
  rows: readonly CatalogRowView[],
  props: Partial<React.ComponentProps<typeof ModCatalogTable>> = {},
): string =>
  keep(
    html(
      React.createElement(ModCatalogTable, {
        rows,
        desktop: true,
        busy: false,
        onBindLocal: noop,
        onUpdate: noop,
        ...props,
      }),
    ),
  );

// ---------------------------------------------------------------------------
// 从产物里取元素的小工具（照 filesrender 的形状；**别**在这里另写一份裸 key 正则）
// ---------------------------------------------------------------------------

/** 一行（`data-row-id` 那一格）。找不到就当场红 —— 那本身就是"这一行没渲染"。 */
function rowOf(markup: string, modid: string): string {
  const found = markup.match(
    new RegExp(`<tr class="filetable__row"[^>]*data-row-id="${modid}\\|[^"]*"[\\s\\S]*?</tr>`),
  );
  assert.ok(
    found,
    `产物里找不到 data-row-id 以 "${modid}|" 开头的那一行 —— 那一行没渲染出来，或者 data-row-id 不再写在那里`,
  );
  return found[0];
}

interface ButtonShape {
  label: string;
  disabled: boolean;
  classes: string[];
}

function buttonsIn(markup: string): ButtonShape[] {
  return [...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    label: textOf(m[2]),
    disabled: /\bdisabled\b/.test(m[1]),
    classes: (m[1].match(/\bclass="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean),
  }));
}

const labelsIn = (markup: string): string[] => buttonsIn(markup).map((b) => b.label);

/** 链接（`<a href=…>文字</a>`）—— 「打开原网页」是**链接**，不是按钮。 */
function linksIn(markup: string): { href: string; label: string }[] {
  return [...markup.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: m[1].match(/\bhref="([^"]*)"/)?.[1] ?? '',
    label: textOf(m[2]),
  }));
}

/**
 * `<select>` 里被选中的那一个 `value`。
 *
 * ⚠️★ 属性的**顺序**不能假设：实测（React 19 的 `renderToStaticMarkup`）产出的是
 *    `<option value="1.16.1" selected="">` —— `value` 在 `selected` **前面**。
 *    第一版把它写成"`selected` 在前、`value` 在后"的一个正则，于是它在**正确**的产物上
 *    报"下拉没渲染出来"（红点落在错的地方，`docs/pending.md §5.74` 那一类）。
 *    ⇒ 先按标签切开、再看这个标签里有没有 `selected`，最后从**同一个标签**里取 `value`。
 * ⚠️ 两种写法都要认：React 也可能把选中项写在 `<select value="…">` 上（`renderToStaticMarkup`
 *    不是浏览器，它不做 `ReactDOMSelect` 那一步收尾）。
 */
function selectedOption(markup: string): string {
  const tags = markup.match(/<option\b[^>]*>/g) ?? [];
  const chosen = tags.find((tag) => /\bselected\b/.test(tag));
  if (chosen !== undefined) {
    const value = chosen.match(/\bvalue="([^"]*)"/);
    assert.ok(value, `选中了的那个 <option> 没有 value：${chosen}`);
    return value[1];
  }
  const bySelect = markup.match(/<select[^>]*\bvalue="([^"]*)"/);
  assert.ok(
    bySelect,
    '产物里既没有 `<option selected …>` 也没有 `<select value="…">` —— 游戏版本下拉没渲染出来',
  );
  return bySelect[1];
}

/** 剥掉注释再读源码形状（注释里逐字写着这些标识符，不剥 = 守卫被自己的注释喂饱）。 */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

console.log(`【${LANG}】文件更新页 · 第一部分（目录行）`);

// ---------------------------------------------------------------------------
// ① 两个筛选维度：游戏版本下拉（默认 = 已绑定文件夹的版本，否则 1.16.1）+ 标签多选
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 两个筛选器的**选择**住在主进程的 `prefs` 里（spec §6.8"按机器记住"）⇒ 组件是
 *    **受控**的：它只画 `state.gameVersion` / `state.tagFilter`，自己不存一份
 *    （两处记忆必然有一天不一致 —— `desktop.ts` 的那一段写着）。这一组断言的就是
 *    "产物里选中的是**状态里那一个**"。
 * ⚠️★ 游戏版本的**选项表**只有状态里知道的那几个：`ModFoldersState` 没有目录的
 *    游戏版本表（现读 T1 的契约：只有 `gameVersion` 一格），所以选项 = 当前选中值
 *    ∪ 已绑定文件夹推断出的版本。代价写在报告里（要列全目录的版本表得给状态加一格）。
 */
const defaultState = stateOf([ROW_GITHUB]);
const defaultHtml = sectionHtml(defaultState);
assert.equal(
  selectedOption(defaultHtml),
  '1.16.1',
  '★ 没有已绑定文件夹时，游戏版本下拉的默认值必须是 `1.16.1`（spec §6.8）',
);
const folderState = stateOf([ROW_GITHUB], {
  gameVersion: '1.20.1',
  folders: [
    {
      folderId: 'f1',
      path: 'D:\\instances\\a\\.minecraft\\mods',
      pathExists: true,
      gameVersion: '1.20.1',
      autoUpdate: false,
      rows: [],
      unrecognized: [],
    },
  ],
});
const folderHtml = sectionHtml(folderState);
assert.equal(
  selectedOption(folderHtml),
  '1.20.1',
  '★ 有已绑定文件夹时，下拉选中的必须是**状态里那个**版本（默认值 = 文件夹推断出的版本）——' +
    '写死 1.16.1 的话，用户看到的是"我选的版本没了"',
);
assert.ok(
  textOf(folderHtml).includes('1.20.1'),
  '★ 那个版本要真的印在选项里（选中一个不存在的选项 = 浏览器回退到第一个）',
);
const tagFilterState = stateOf([ROW_GITHUB], { tagFilter: ['legal'] });
const tagFilterHtml = sectionHtml(tagFilterState);
assert.ok(
  tagFilterHtml.includes('aria-pressed="true"') &&
    textOf(tagFilterHtml).includes(textOf(TAG_LABEL)),
  '★ 标签多选必须把已选的标签画成"按下"状态（标签显示名来自目录，原样印出来）',
);
assert.ok(
  textOf(tagFilterHtml).includes(textOf(resolved('files.catalogGameVersion'))) &&
    textOf(tagFilterHtml).includes(textOf(resolved('files.catalogTags'))),
  '★ 两个筛选器各自要有名字（没有名字的那一格，用户不知道自己在筛什么）',
);
ok(
  '① 两个筛选器：版本下拉选中状态里那一版（无文件夹时 1.16.1、有则文件夹的版本）+ 标签多选的按下态',
);

// ---------------------------------------------------------------------------
// ② 一行 GitHub 来源 ⇒ **两颗**按钮（原始 / 镜像）；cdn 来源 ⇒ 只有原始（D5）
// ---------------------------------------------------------------------------
const githubRow = rowOf(tableHtml([ROW_GITHUB]), 'sodium');
assert.deepEqual(
  labelsIn(githubRow),
  [labelOf('files.updateOrigin'), labelOf('files.updateMirror')],
  '★ GitHub 来源的那一行必须**两颗**按钮：原始 + 镜像（D5 / D6）—— 少一颗就是少一条通道',
);
const cdnRow = rowOf(tableHtml([ROW_CDN]), 'sodium');
assert.deepEqual(
  labelsIn(cdnRow),
  [labelOf('files.updateOrigin')],
  '★★ 只有 GitHub 来源才有镜像按钮（D5）：非 GitHub 的行多一颗镜像 ⇒ 主进程会拒（`mirrorsFor` 的主机判据）',
);
ok('② GitHub 来源两颗按钮（原始 / 镜像），cdn 来源只有原始（D5）');

// ---------------------------------------------------------------------------
// ③ `manual` 的行（OptiFine）⇒ 一颗按钮都没有，只有「打开原网页」
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 这是 Ruling 47/48 的落点：**不给一个主进程会拒的按钮**。`manual` 的 release
 *    在 `assertUpdatable` 那一层被拒（"这一条只能到原网页手动下载"）⇒ 界面上画一颗
 *    「更新」就是让用户白点一次、吃一句红字。
 * ⚠️ 断言写成"**一颗按钮都没有**"（不是"没有更新按钮"）：多出来的任何一颗（哪怕是一颗
 *    「绑定本地文件」）都会让这条红 —— brief 的字面是"只有『打开原网页』"。
 */
const manualRow = rowOf(tableHtml([ROW_MANUAL]), 'optifine');
assert.deepEqual(
  buttonsIn(manualRow).length,
  0,
  '★ `manual` 的行**一颗按钮都不许有**（主进程会拒；brief 的字面是"只有『打开原网页』"）',
);
assert.deepEqual(
  linksIn(manualRow).map((l) => l.label),
  [labelOf('files.openPage')],
  '★ `manual` 的行必须给「打开原网页」——那是它唯一的出路（Ruling 47）',
);
assert.equal(
  linksIn(manualRow)[0]?.href,
  OPTIFINE_URL,
  '★ 那个链接要指向 release 自己的地址（`official.url`）——指向别处等于把用户送去别的地方',
);
ok(`③ \`manual\` 的行一颗按钮都没有，只有「打开原网页」（href = release.url）`);

// ---------------------------------------------------------------------------
// ④ `newer` / `different-build` / `unknown` 三支：只解释，**不给**更新按钮
// ---------------------------------------------------------------------------
/*
 * ⚠️★ spec §7.2 的 ④/⑤ 与 §8：这三支**都不进批量**、也不该有一颗按钮
 *    （主进程的 `assertUpdatable` 同样拒它们）。界面欠的是一句**各自的**解释 ——
 *    三支合成一句"不能更新"就把"为什么"删掉了（用户唯一能行动的线索）。
 */
const newerRow = rowOf(tableHtml([ROW_NEWER]), 'ranked');
const differentRow = rowOf(tableHtml([ROW_DIFFERENT_BUILD]), 'ranked');
const unknownRow = rowOf(tableHtml([ROW_UNKNOWN]), 'ranked');
for (const [name, row, key] of [
  ['newer', newerRow, 'files.hintNewer'],
  ['different-build', differentRow, 'files.hintDifferentBuild'],
  ['unknown（spec 写作 different）', unknownRow, 'files.hintUnknown'],
] as const) {
  assert.ok(
    textOf(row).includes(textOf(resolved(key))),
    `★ \`${name}\` 那一行要有**自己的**解释文案（${key}）—— 没有它用户不知道"为什么不给我更新"`,
  );
  assert.deepEqual(
    labelsIn(row).filter(
      (label) => label === labelOf('files.updateOrigin') || label === labelOf('files.updateMirror'),
    ),
    [],
    `★ \`${name}\` 那一行**不许**有更新按钮（主进程会拒；"只升不降"的提示就到这里为止）`,
  );
}
/*
 * ★ 反面：这三支与"可更新"那一支**长得要分得开**（同一张表里）。
 *   `ROW_GITHUB` 是同一份夹具的"该给按钮"那一侧 ⇒ 两边都断言，判据才不会退化成空跑。
 */
assert.equal(
  labelsIn(githubRow).length,
  2,
  '★ 反面：可更新的那一行**确实**有按钮（否则上面三条"没有按钮"是空跑）',
);
ok('④ newer / different-build / unknown 三支各自有解释、都没有更新按钮（可更新的那一行有）');

// ---------------------------------------------------------------------------
// ⑤ `ambiguous`（两个候选）⇒ 列出**全部候选**且要求明确选，**不给**更新按钮
// ---------------------------------------------------------------------------
/*
 * ⚠️★ spec §7.2 的 ③ / §8：多候选时"该装哪一个"没有唯一答案 ⇒ 程序**不猜**
 *    （`resolveTarget` 在有 2 个候选时给 `official: null`）。
 * ⚠️★ 这里**没有**"选一个"的控件，理由必须写清楚：契约**收不了**这个选择 ——
 *    `updateCatalogRow(rowId, releaseKey, channel)` 在 `official === null` 时直接拒
 *    （`apps/desktop/src/mod-folders.ts` 那句"这一行现在没有目标"），而 `releaseKey`
 *    只是 `modid|游戏版本`、**指定不了哪一个候选**。⇒ 画一个点了没用的选择器
 *    正是 Ruling 47/48 反对的那种按钮。出路是"去原网页自己确认"。
 */
const ambiguousRow = rowOf(tableHtml([ROW_AMBIGUOUS]), 'speedrunigt');
for (const candidate of ROW_AMBIGUOUS.candidates) {
  assert.ok(
    textOf(ambiguousRow).includes(textOf(candidate.version)),
    `★ 多候选那一行必须把**每一个**候选的版本号列出来（少了 ${candidate.version} 就是让用户以为只有一条）`,
  );
}
assert.ok(
  textOf(ambiguousRow).includes(textOf(resolved('files.hintAmbiguous'))),
  '★ 多候选那一行要说清"程序不替你猜"（没有这句话，用户看到的是"这一行怎么点不动"）',
);
assert.deepEqual(
  labelsIn(ambiguousRow),
  [],
  '★ 多候选那一行**不许**有更新按钮：`official` 是 `null` ⇒ 主进程必拒（Ruling 47/48）',
);
ok('⑤ ambiguous：全部候选都列出来 + 「程序不替你猜」那句解释，且一颗按钮都没有');

// ---------------------------------------------------------------------------
// ⑥ 目标来源按 `targetSource` 标出来（Ruling 13）—— **不假设 `official ∈ candidates`**
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 这一组是 Ruling 13 的落点：有上游目标时 `official` **不在** `candidates` 里
 *    （`resolveTarget` 的注释写着），所以"来源"只能由 `targetSource` 说出来。
 *    夹具就是那个真实形状：候选里是目录的 `5.8.22`，目标却是上游的 `5.8.26`。
 */
const upstreamRow = rowOf(tableHtml([ROW_UPSTREAM]), 'mcsrranked');
assert.ok(
  textOf(upstreamRow).includes(textOf(resolved('files.targetSource.upstream'))),
  '★ 上游目标必须标「上游最新」（状态里那一格是 upstream）—— 不标的话用户以为那是 mc.sr 指定的版本',
);
assert.equal(
  textOf(upstreamRow).includes(textOf(resolved('files.targetSource.catalog'))),
  false,
  '★ 同一行**不许**同时标两个来源（两个都印 = 那格读数没有意义）',
);
assert.ok(
  textOf(upstreamRow).includes(UPSTREAM_NEW.version),
  '★ 那一格要印**目标**的版本（5.8.26 来自上游）—— 印候选那一版就是在编一个"官方版本"',
);
const catalogRow = rowOf(tableHtml([ROW_GITHUB]), 'sodium');
assert.ok(
  textOf(catalogRow).includes(textOf(resolved('files.targetSource.catalog'))),
  '★ 目录目标要标「合法指定版本」（D1）—— 两种来源的措辞必须分得开',
);
ok('⑥ 目标来源按 `targetSource` 标（上游最新 / 合法指定版本），且上游目标不假设在候选里');

// ---------------------------------------------------------------------------
// ⑦ 未绑定 ⇒ 「绑定本地文件」（不是更新）
// ---------------------------------------------------------------------------
const unboundRow = rowOf(tableHtml([ROW_UNBOUND]), 'lithium');
assert.deepEqual(
  labelsIn(unboundRow),
  [labelOf('files.bindLocal')],
  '★ 未绑定的行只能「绑定本地文件」：`updateCatalogRow` 对没绑定的行会拒（"先绑定一次"）',
);
assert.ok(
  textOf(unboundRow).includes(textOf(resolved('files.unbound'))),
  '★ 未绑定要说出来（两格版本读数都是 `—`，没有徽章的话这一行看起来像"读不出来"）',
);
assert.ok(
  textOf(unboundRow).includes(DASH),
  '★ 本地那一格没有读数 ⇒ 必须是 `—`（不许填 0、不许借一个版本号）',
);
ok('⑦ 未绑定：只有「绑定本地文件」+ 「未绑定」徽章 + 本地那格是 `—`');

// ---------------------------------------------------------------------------
// ⑧ 三处空态：目录不可用 / 该游戏版本下没有行 / 全部已最新
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 三处**必须分得开**（这是这一组存在的全部理由）：
 *   · 目录不可用 ⇒ 空数组（区别只在 `catalogStatus`）—— 说"没有行"就是撒谎
 *     （那 48 行很可能就在目录里，只是我们没拉到）；
 *   · 目录 OK + 0 行 ⇒ 真的没有（今天只有"标签筛选挡掉了"这一种可达路径）；
 *   · 有行、但全是 `same` ⇒ 有东西可看、只是没有可更新的。
 */
const unavailableHtml = sectionHtml(
  stateOf([], { catalogStatus: 'unavailable', missingStatus: 'catalog-unavailable' }),
);
assert.ok(
  textOf(unavailableHtml).includes(textOf(resolved('files.catalogUnavailable'))),
  '★ 目录不可用那一档必须说"目录还没拉到"（与"这个版本下没有 mod"是两句不同的话）',
);
assert.equal(
  textOf(unavailableHtml).includes(textOf(resolved('files.catalogNoRows'))),
  false,
  '★ 目录不可用那一档**不许**印"这个游戏版本下没有行" —— 那 48 行只是在目录里，我们没拉到',
);
assert.equal(
  unavailableHtml.includes('filetable__table'),
  false,
  '★ 目录不可用时不画表（一张空壳表的下方本该有行）',
);
const noRowsHtml = sectionHtml(stateOf([]));
assert.ok(
  textOf(noRowsHtml).includes(textOf(resolved('files.catalogNoRows'))),
  '★ 目录 OK 但一行都没有 ⇒ 说"没有可列出的行"（空 div = 用户分不出"没有"与"没渲染"）',
);
assert.equal(
  noRowsHtml.includes('filetable__table'),
  false,
  '★ 零行时不该还画一张空壳表（与 v1 那张表的空态同一条）',
);
const allCurrentHtml = sectionHtml(stateOf([ROW_SAME]));
assert.ok(
  textOf(allCurrentHtml).includes(textOf(resolved('files.catalogAllCurrent'))),
  '★ 全是 `same` ⇒ 必须说"都已是最新"（第三处空态；没有它用户以为这一页什么都没做）',
);
assert.ok(
  allCurrentHtml.includes('filetable__table'),
  '★ 那一档**留着表**（行还在：绑定 / 打开原网页都只能在这里做）—— 藏掉整张表就是删掉能力',
);
ok('⑧ 三处空态分得开：目录不可用（无表）/ 真的没有行（无表）/ 全部已最新（留着表）');

// ---------------------------------------------------------------------------
// ⑨ 正在写盘（`busy`）⇒ 每一行的按钮都禁用 + 那一句解释
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 判据是 `ModFoldersState.busy`（T6 §9.6 第 3 条：契约**没有**逐行进度字段，
 *    `busy` 是唯一的"在忙"信号）。主进程那边会以"正在更新中（一次只写一个文件）"拒
 *    第二次写 ⇒ 界面必须把"现在不能点"写在脸上，而不是让用户吃一句红字。
 */
const busyHtml = sectionHtml(stateOf([ROW_GITHUB], { busy: true }));
const busyRow = rowOf(busyHtml, 'sodium');
assert.equal(
  buttonsIn(busyRow).every((button) => button.disabled),
  true,
  '★ 正在写盘时每一行的按钮都要 `disabled`（主进程只接受一条更新）',
);
assert.equal(
  buttonsIn(busyRow).length,
  2,
  '★ 反面：`busy` 时按钮是"禁用"，不是"消失"（消失 = 用户不知道它们去哪了）',
);
assert.ok(
  textOf(busyHtml).includes(textOf(resolved('files.catalogBusy'))),
  '★ `busy` 时要说清为什么点不动（一句话，不要常驻）',
);
const idleRow = rowOf(tableHtml([ROW_GITHUB]), 'sodium');
assert.equal(
  buttonsIn(idleRow).every((button) => button.disabled),
  false,
  '★ 反面：不在写盘时按钮必须**可用**（禁用过头 = 这个功能没有出路）',
);
ok('⑨ `busy`：两颗按钮都在但都禁用 + 一句解释；不忙时可用');

// ---------------------------------------------------------------------------
// ⑩ 上一次运行的汇总：**逐条**印出跳过的行与原因；正在跑时一个字都不印
// ---------------------------------------------------------------------------
/*
 * ⚠️★ spec §7.4 / Ruling 52⑤：批量要"如实报告跳过了几条及原因"。契约里
 *    `lastRun.skipped: { modid, reason }[]` 就是那份读数 ⇒ 界面必须把它印出来
 *    （只印一个数字 = 用户不知道自己的哪几个 mod 没被碰）。
 * ⚠️★★ 第二半是 T6 §9.6 第 2 条：**整夹在 `bulkRun` 之前被拒时 `lastRun` 不动**
 *    ⇒ 屏幕上那一份可能说的是**上一次**。所以：① 措辞必须是"上一次运行"
 *    （不是"刚才"）；② `busy` 时**不许**把它当成这一次的结果挂在那里
 *    （正在跑 ⇒ 结果还没出来）。这一条就是那两件事的判据。
 */
const LAST_RUN = {
  updated: ['sodium'],
  skipped: [{ modid: 'ranked', reason: SKIP_REASON }],
  failed: [],
};
const lastRunHtml = sectionHtml(stateOf([ROW_GITHUB], { lastRun: LAST_RUN }));
assert.ok(
  textOf(lastRunHtml).includes(
    textOf(resolved('files.lastRunSummary', { ok: 1, skipped: 1, failed: 0 })),
  ),
  '★ 上一次运行的汇总要印出来（否则"跳过了几条"这件事没人知道）',
);
assert.ok(
  textOf(lastRunHtml).includes(
    textOf(resolved('files.lastRunSkipped', { modid: 'ranked', reason: SKIP_REASON })),
  ),
  '★ **逐条**印出被跳过的行与原因（只印一个数字 = 用户不知道是哪几个 mod）',
);
const runningHtml = sectionHtml(stateOf([ROW_GITHUB], { lastRun: LAST_RUN, busy: true }));
assert.equal(
  textOf(runningHtml).includes(
    textOf(resolved('files.lastRunSummary', { ok: 1, skipped: 1, failed: 0 })),
  ),
  false,
  '★★ 正在写盘时**不许**把 `lastRun` 挂在那里 —— 它说的是上一次，而这一次还没跑完' +
    '（T6 §9.6：整夹被拒时 `lastRun` 根本不动）',
);
/*
 * ⚠️★ `notices` 必须**原样**印出来（spec §13.1：迁移"不许静默"）。它装的是主进程写好的
 *    整句话（"已转为文件夹跟踪：<mod 名>" / 缺失清单被压住的说明 / 目录错误）
 *    ⇒ 界面只负责显示，**不重新措辞**（再套一层就是"目录拉取失败：目录拉取失败：…"）。
 * ⚠️ 夹具是 ASCII（见 `NOTE` 那一段）：真实那句话是中文写死的，那是已接受的代价。
 */
const noticeHtml = sectionHtml(stateOf([ROW_GITHUB], { notices: [NOTE] }));
assert.ok(
  textOf(noticeHtml).includes(textOf(NOTE)),
  '★ `notices` 要原样印在页面上（§13.1：迁移与失败说明不许静默 —— 用户看不到就等于没发生）',
);
ok('⑩ `lastRun` 的 skipped 逐条印出来；`busy` 时一个字都不印；`notices` 原样印出来');

// ---------------------------------------------------------------------------
// ⑪ 动作层那一道闸：`handlers === null` ⇒ 一颗按钮都不画
// ---------------------------------------------------------------------------
/*
 * ⚠️ 判据是 `handlers !== null`（这一页有没有动作层）。它在产品里等价于"有没有
 *    `window.mcsr.modFolders`"；自检里则是显式喂 `null`。
 * ⚠️★ 断言**按行**数按钮（不是数整个 `<section>`）：那一块里还有**标签筛选**的
 *    toggle 按钮（它们也是 `<button>`）⇒ 数整块会把"操作列是空的"这件事测成
 *    "这一块没有按钮"（一条测错对象的判据 —— §5.32 的第四类）。
 * ⚠️★ 最后那两条**反面**不能省：没有它们的话，"这一列永远不画东西"照样能过上面那条 ——
 *    而那会让 ②③④⑤⑦⑨ 里所有"按钮是什么"的断言统统变成空跑（v1 的 ⑫ 同型）。
 */
const readOnlyHtml = sectionHtml(stateOf([ROW_GITHUB, ROW_UNBOUND]), { handlers: null });
assert.equal(
  buttonsIn(rowOf(readOnlyHtml, 'sodium')).length +
    buttonsIn(rowOf(readOnlyHtml, 'lithium')).length,
  0,
  '★ 没有动作层（浏览器态 / 老客户端）⇒ 每一行的操作列一个按钮都不画（点不动的按钮比没有按钮更糟）',
);
const withActionsHtml = sectionHtml(stateOf([ROW_GITHUB, ROW_UNBOUND]));
assert.equal(
  buttonsIn(rowOf(withActionsHtml, 'sodium')).length,
  2,
  '★ 反面：可更新的那一行确实有两颗按钮（上面那条否则是空跑）',
);
assert.equal(
  buttonsIn(rowOf(withActionsHtml, 'lithium')).length,
  1,
  '★ 反面：未绑定的那一行确实有那一颗「绑定本地文件」',
);
ok('⑪ 没有动作层 ⇒ 每一行的操作列都是空的；有动作层 ⇒ 按钮真的在（2 + 1）');

// ---------------------------------------------------------------------------
// ⑫ `toggleTag()`：标签筛选是**"与"**语义，增删都要保序
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 判据是 `ModFoldersState.tagFilter` **整个数组**（`setTagFilter(tags)` 收的是
 *    全量）⇒ 组件得自己算"点这一下之后该是什么"。写错方向的后果是"点一个标签、
 *    另一个掉了"（用户以为自己只改了一个）。
 * ⚠️ 保序是有意的：数组顺序变了会让"同一个选择"变成两个不同的值（无谓的写盘）。
 */
assert.deepEqual(toggleTag([], 'legal'), ['legal'], '★ 点一个没选的标签 ⇒ 加进去');
assert.deepEqual(toggleTag(['legal'], 'legal'), [], '★ 再点一次 ⇒ 去掉（多选要能取消）');
assert.deepEqual(
  toggleTag(['legal', 'ranked'], 'ranked'),
  ['legal'],
  '★ 去掉一个时**保住其余的顺序**（顺序变了 = 同一个选择有两个值）',
);
assert.deepEqual(
  toggleTag(['legal'], 'ranked'),
  ['legal', 'ranked'],
  '★ 加在末尾（不排序：顺序只由点击顺序决定，可复现）',
);
ok('⑫ `toggleTag()`：加 / 去 / 保序（"与"语义靠它算出的全量数组）');

// ---------------------------------------------------------------------------
// ⑬ 裸 key 泄漏（用表格那个**具名**扫描器）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 扫描器**只有这一个**（从表格 `import` 的 `rawKeysIn` / `RAW_KEY_RE`，
 *    v1 的 ⑲ 用的是同一个对象）：两处各写一个正则的话，「把扫描器改坏」不会有任何
 *    断言出声。两条探针在**扫产物之前**跑 —— 放在后面的话，一条坏掉的扫描器会被
 *    "产物里有泄漏"那条拦住，你看到的是"有泄漏"，而真正坏的是扫描器（§5.74）。
 */
assert.deepEqual(
  rawKeysIn('Sodium 与 OptiFine 这两串字不是 key'),
  [],
  '泄漏扫描器不该命中普通文案里的词（否则它会变成噪声，而噪声没人再看）',
);
assert.deepEqual(
  rawKeysIn('files.foo common.bar'),
  ['files.foo', 'common.bar'],
  '泄漏扫描器必须**两个前缀都命中**（这一页自己的词条 + 空态/加载中那两条）',
);
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
// ⑭ `reduceModFoldersLoad()`：数据永远压过一次失败结论（与 v1 的 ⑯ 同一条规则）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 为什么这一层必须有同一条规则：桌面态那两条支路是**独立**的
 *    （`onStatus` 推送 / `getState()` 首拉）⇒ "首拉先失败、推送后带来数据"真的会发生
 *    （Ruling 42：首拉可能等一次补扫 ⇒ 它更慢）。把失败结论当成"粘住的"会让页面一直
 *    停在「拿不到状态」，而手上其实已经有数据 —— 那一句**已经不成立**的话会一直挂着。
 * ⚠️ 它是纯函数，所以这条规则**当场可证**（住在钩子里的话，渲染自检一行 effect 都不跑）。
 */
const snapshot = stateOf([ROW_GITHUB]);
const loadFailed = reduceModFoldersLoad(NO_MOD_FOLDERS_LOAD, {
  kind: 'failure',
  reason: 'BOOM-1',
});
assert.equal(
  loadFailed.status,
  'failed',
  '★ 起点是"什么都不知道"（loading）时，一次失败 ⇒ 失败那一屏',
);
assert.equal(loadFailed.state, null, '★ 失败那一屏上没有数据');
const loadRecovered = reduceModFoldersLoad(loadFailed, { kind: 'snapshot', state: snapshot });
assert.equal(
  loadRecovered.status,
  'ready',
  '★★ 数据到手 ⇒ 上一次的失败结论**作废**（它已经被这份数据推翻了）',
);
assert.equal(loadRecovered.state, snapshot, '★ 而且收下的就是这一份');
assert.equal(
  reduceModFoldersLoad(loadRecovered, { kind: 'failure', reason: 'BOOM-2' }),
  loadRecovered,
  '★★ 已经有数据时又来一次失败 ⇒ **原样返回**（同一个对象）：不许把一句过期的话压在数据上面',
);
ok('⑭ `reduceModFoldersLoad`：失败 → 数据到手撤回失败结论；有数据时失败不改画面');

// ---------------------------------------------------------------------------
// ⑮ 「正在扫描…」那一屏（**Ruling 42**）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ Ruling 42 的现场：第一次 `getState()` 会**先等一次补扫**（读每个 jar 的内部
 *    版本与哈希），真机可能几秒 ⇒ 页面从第一帧就该说"正在扫描"，否则用户看到的是
 *    "这一页挂了"。那一屏由 `ModCatalogScanning` 画（纯组件 ⇒ 这里渲得出来）。
 * ⚠️ 钩子**真的**会进那一屏这件事，这个脚本证不了（没有 preload ⇒ `window.mcsr`
 *    是 undefined ⇒ `useModFolders()` 只会给 `unavailable`）—— 边界写在文件头。
 */
const scanningHtml = keep(html(React.createElement(ModCatalogScanning, null)));
assert.ok(
  textOf(scanningHtml).includes(textOf(resolved('files.catalogScanning'))),
  '★ 第一帧必须是「正在扫描…」（Ruling 42：首拉可能等一次补扫，不显示它就像挂了一样）',
);
assert.ok(
  textOf(scanningHtml).includes(textOf(resolved('files.catalogScanningHint'))),
  '★ 顺带说清"第一次要等一次本地扫描"（不然用户以为卡住了）',
);
ok('⑮ 首拉那一屏：「正在扫描…」+ 一句说明（Ruling 42）');

// ---------------------------------------------------------------------------
// ⑯ ★★ 读源码的接线守卫（静态渲染看不见事件处理器，这一组是它唯一的替代）
// ---------------------------------------------------------------------------
/*
 * ⚠️★★ 先说清楚这一段**证不了什么**：`renderToStaticMarkup` 一行事件处理器都不跑
 *    ⇒ 「点镜像那一颗真的走 `{mirrorId}` 通道」**没有任何产物能证明**。这里退一步钉
 *    **它成立的前提**：那条接线**在**、而且**只有一条**。
 * ★ 每条守卫都点名**能让它红的那一刀**，而且报告里记着哪些刀真的跑过。
 */
const tableCode = withoutComments(
  readFileSync(new URL('../src/components/FileUpdateTable.tsx', import.meta.url), 'utf8'),
);
const panelCode = withoutComments(
  readFileSync(new URL('../src/components/FileUpdatesPanel.tsx', import.meta.url), 'utf8'),
);

// —— 守卫 1：★ 镜像那条分支的判据来自 `isGitHubRelease(...)`（能红的那一刀：改成恒真）——
/*
 * ⚠️ 这一条就是 brief 的 Step 4 点名的那一刀：把判据写成恒真（`const mirror = true`）⇒
 *    ② 里那条"cdn 来源只有原始"**必须**红。锚点写在**按钮出现的那一处**（`{mirror ?`），
 *    不是锚在 `isGitHubRelease` 的声明上（锚在声明上时，"把调用换掉"那一刀全绿 ——
 *    v1 的现场就是这么来的）。
 */
assert.match(
  tableCode,
  /const\s+mirror\s*=\s*row\.official\s*!==\s*null\s*&&\s*isGitHubRelease\(row\.official\.url\)/,
  '★★ 「只有 GitHub 来源才给镜像按钮」的判据必须来自 `isGitHubRelease(row.official.url)`' +
    '（写成恒真 ⇒ 非 GitHub 的行也会画镜像按钮，而主进程会拒）',
);

// —— 守卫 2：★★ 两颗更新按钮各送**自己那条通道**（能红的那一刀：把镜像那一颗改成 `'origin'`）——
/*
 * ⚠️★ 为什么不能只断言"有两颗按钮"：两颗都送 `'origin'` 也能过 ② —— 而那样镜像按钮
 *    是个**假**按钮（用户以为走了加速站，其实没有）。判据是两颗按钮各自
 *    `onUpdate?.(row.rowId, …)` 的**第二个实参**：一颗字面量 `'origin'`、
 *    一颗 `{ mirrorId: ROW_MIRROR_ID }`。
 * ⚠️ 两者之间的窗口是**实测**的（`{0,400}` 曾经差 32 个字符 —— 实测 gap = 432）：
 *    它是"同一个操作列里那两颗按钮"的距离，不是"往后随便找"。窗口放这么宽是因为
 *    中间还夹着 `<button>` 的属性与 JSX 注释（注释被剥掉，但换行与缩进留着）。
 */
assert.match(
  tableCode,
  /onUpdate\?\.\(row\.rowId,\s*'origin'\)[\s\S]{0,800}?onUpdate\?\.\(row\.rowId,\s*\{\s*mirrorId:\s*ROW_MIRROR_ID\s*\}\)/,
  "★★ 两颗更新按钮必须各送自己那条通道（第一颗 `'origin'`、第二颗 `{ mirrorId: ROW_MIRROR_ID }`）" +
    '—— 两颗都送 `\'origin\'` 时"镜像按钮"是个假按钮，而产物里看不出来',
);

// —— 守卫 3：★ 「打开原网页」指向 release 自己的地址（能红的那一刀：把 href 写死）——
assert.match(
  tableCode,
  /href=\{page\}/,
  '★ 「打开原网页」的 href 必须来自那一行的 release（`originPageOf(row)`）—— 写死一个地址等于把用户送去别处',
);

// —— 守卫 4：★ 筛选器的两个动作各自接在自己那条通道上（能红的那一刀：`setTagFilter` 接成 `setCatalogGameVersion`）——
/*
 * ⚠️ 锚在**控件**上（`<select … onChange=` 与那颗标签按钮的 `onClick=`）：锚在函数体上
 *    的话，"把接线换掉"那一刀全绿（v1 的 ⑱ 就是被这一刀证明的）。
 * ⚠️ 两边的判据都咬到**实参**那一层（不是"这两个名字都出现过"）：接错通道（比如
 *    `onChange` 接了 `setTagFilter`）是这一组要抓的坏法，泛泛的 `includes` 抓不住它。
 */
assert.match(
  panelCode,
  /<select\b[^>]*onChange=\{[\s\S]{0,300}?handlers\.setCatalogGameVersion\(event\.target\.value\)/,
  '★ 版本下拉的 `onChange` 必须调 `setCatalogGameVersion(event.target.value)`（接错 ⇒ 选择不会被记住）',
);
assert.match(
  panelCode,
  /onClick=\{[\s\S]{0,300}?handlers\.setTagFilter\(toggleTag\(state\.tagFilter, tag\)\)/,
  '★ 标签多选的 `onClick` 必须调 `setTagFilter(toggleTag(state.tagFilter, tag))`（接错 ⇒ 标签筛不动）',
);
assert.ok(
  panelCode.includes('localStorage') === false,
  '★★ 两个筛选器**不许**在渲染进程里再存一份（`localStorage`）：一处记忆（主进程的 `prefs`）' +
    '——两处必然有一天不一致（spec §6.8 / `desktop.ts` 那一段）',
);
/*
 * ⚠️ 计数用的是**带前缀**的 `handlers.xxx(`（不是裸方法名）：`makeModFoldersHandlers()`
 *    里那两处 `api.setCatalogGameVersion(...)` / `api.setTagFilter(...)` 是**唯一**的合法
 *    消费者，用裸名字数会把它们一起数进来（2 条 ⇒ 一条永远红的判据）。
 */
assert.equal(
  panelCode.match(/handlers\.setCatalogGameVersion\(/g)?.length,
  1,
  '★★ `handlers.setCatalogGameVersion(` 全页只许出现一次，就是那个下拉的 `onChange`（多出来的那一次就是第二处真相）',
);
assert.equal(
  panelCode.match(/handlers\.setTagFilter\(/g)?.length,
  1,
  '★★ 同一个判据给 `handlers.setTagFilter(`：只许出现一次（那个标签按钮的 `onClick`）',
);
ok(
  '⑯ 源码形状守卫 4 条：镜像判据非恒真、两颗更新按钮各送自己的通道、原网页链接来自 release、两个筛选器各接自己那条通道且只有一处',
);

// ---------------------------------------------------------------------------
// ⑰ 英文那一遍：全部渲染产物零汉字
// ---------------------------------------------------------------------------
if (LANG === 'en') {
  /*
   * ⚠️★ 只在 `--en` 那一遍跑（词条泄漏只有英文渲染下才暴露：中文环境里 `t()` 会回退到 zh）。
   * ⚠️ 样本里**没有**中文夹具：`TAG_LABEL` / `NOTE` / `SKIP_REASON` 都是 ASCII（见文件头）；
   *    真实目录的标签显示名与主进程的 `notices` / `reason` 是中文，而那是**已接受的代价**
   *    （`CatalogRowView.tagLabels` 只带 zh）—— 这里**不开豁免口子**：
   *    开口子的扫描在**最该抓人的那一处**是瞎的。
   */
  const han = textOf(samples.join('')).match(/[\u4e00-\u9fff]+/g) ?? [];
  assert.deepEqual(han, [], `英文界面里出现了中文：${han.slice(0, 8).join(' / ')}`);
  ok('⑰ 英文那一遍：全部渲染产物零汉字');
}

// ---------------------------------------------------------------------------
// 组数探针（手抄的，理由见下）
// ---------------------------------------------------------------------------
/*
 * ⚠️ 组数是**手抄的**（本仓惯例，`filesrender.tsx` 末段写着同一条）：它防的是
 *    "把某一段整块摘掉" —— 删掉一整组断言之后脚本照样绿、照样打印"通过 N 项"，
 *    只有这个数字会变。⇒ 改脚本就要一起改这里（改的时候**现数**，别估）。
 * ⚠️ en 比 zh 多 1：⑰ 那个零汉字扫描只在 en 那一遍跑，两个数差 1 是**正常的**，别抹平。
 */
const expectedGroups = LANG === 'en' ? 17 : 16;
assert.equal(
  pass,
  expectedGroups,
  `探针：这一轮应当通过 ${String(expectedGroups)} 组（少了就说明有人把某一段摘掉了）`,
);

console.log('');
console.log(`通过 ${pass} 项。`);
console.log('');
console.log('⚠️ 这个脚本验的是**渲染**（外加 ⑫⑭ 两个纯函数与 ⑯ 的几条源码形状）：');
console.log('   没有点击、没有请求、没有真实浏览器、也没有主进程。');
console.log('   具体没被覆盖的（至少这几样）：');
console.log('     · 点一下真的走了哪条通道 / 真的弹了原生对话框 —— 静态渲染不跑事件处理器，');
console.log('       ⑯ 只钉住"那条接线在、而且只有一条"；');
console.log('     · `useModFolders()` 的三条支路（订阅 / 首拉 / 失败）：没有 preload ⇒');
console.log('       `window.mcsr` 是 undefined ⇒ 自检里它只会停在 `unavailable`（浏览器态）；');
console.log('     · 「正在扫描…」**真的**会出现（⑮ 只钉住那一屏的组件本身）；');
console.log(
  '     · 主进程写死的中文（`notices` / `skipped[].reason` / 标签显示名）—— 夹具是 ASCII；',
);
console.log(
  '     · 真实目录的 48 行 / 两个重复键 / 54 条 manual（那是 T1/T3 的单测与目录本身的事）。',
);
