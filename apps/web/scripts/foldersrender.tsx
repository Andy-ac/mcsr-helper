#!/usr/bin/env tsx
/**
 * 「文件更新」`/files` 那一页 · **第一部分（目录行）+ 第二部分（文件夹）+ 底部（缺失清单）**
 * 的渲染自检（2026-10-03，Task 7 写了 ①–⑰；同一天 **Task 8** 加了 ⑱–㉗ 并把脚本接进
 * `check:all` —— 第 14 个渲染自检）。
 *
 * 跑法（从仓库根）：
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:folders
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:folders -- --en
 *
 * ===========================================================================
 * 为什么这一页必须有它
 * ===========================================================================
 * 与 `filesrender.tsx`（v1 那一半）逐字同一条理由：`apps/web` 没有测试运行器
 * （`CONTRIBUTING.md`），而这一页"每行给不给按钮 / 给几颗 / 标哪个来源 /
 * 三处空态 / 底部那一栏什么时候不画"全是**只能用产物证明**的东西 —— 类型检查看不见
 * "块整个没渲染"、"词条打错一个字母"、"给 manual 的行画了一颗会被主进程拒的按钮"。
 * i18next 对未知 key **不报错**，它把 key 原样印在界面上。
 *
 * ===========================================================================
 * ⚠️★ 边界：这个脚本**证不了**什么（与 filesrender 的边界同型，别混）
 * ===========================================================================
 * `renderToStaticMarkup` **不点击、不跑事件处理器、不跑 effect**（`docs/pending.md §5.73`）：
 *   · 「点一下真的走了哪条通道」/「点了真的会弹原生对话框」——**一件都不碰**。
 *     通道的接线只由 ⑯ / ㉖ / ㉗ 那几条**源码形状守卫**兜着（它们证的是"那条路在、
 *     而且只有一条"）；
 *   · `useModFolders()` 的三条支路（订阅 / 首拉 / 失败）在自检里**跑不到**：
 *     `window.mcsr` 是 `undefined` ⇒ 它只会停在 `unavailable`（浏览器那一支）。
 *     ⇒ ⑰ 只钉住「正在扫描…」那一屏的**组件**，不钉"钩子真的会进那一屏"；
 *     ⇒ ㉕ 钉的是"0.0.4 的壳渲染成什么样"（那是真的渲染 `Files`，喂的是桩）；
 *   · `<details>` **点一下会不会展开、点里面那颗按钮会不会顺带折叠** —— 那是浏览器的
 *     默认动作，静态产物里只有结构（㉑ 钉的是"控件住在 `<summary>` 里"）；
 *   · 主进程写死的中文（`notices` / `lastRun.skipped[].reason` / 标签显示名）——
 *     夹具里一律换成 ASCII（见下面 `NOTE` / `SKIP_REASON` / `TAG_LABEL` 三段）：
 *     它们的语言不归这一层管（`CatalogRowView.tagLabels` 只带目录里的 `zh`，
 *     这是 T1 那一层定下的代价），而 ㉘ 的零汉字扫描**不许开豁免口子**。
 *
 * ===========================================================================
 * ⚠️★★ 锚点纪律：锚在**按钮与文案**上，不锚函数名（v1 的现场）
 * ===========================================================================
 * v1（`filesrender.tsx`）的现场：锚在 `requestUpdateAll` 的**声明**上时，那一刀
 * "把 `.cta` 的 `onClick` 改成直接开写"**五条守卫全绿**。⇒ 这个脚本里：
 *   · 「给不给按钮」一律断言**产物里那颗按钮的文字**（`labelsIn`）；
 *   · 「按哪条通道」没有产物可锚（静态渲染不跑处理器）⇒ 只由 ⑯ / ㉖ / ㉗ 的**接线守卫**
 *     兜着，而那几条守卫的刀**真的跑过**（改坏 → 跑 → 还原 → `sha256` 核对，
 *     读数在报告里）。
 *
 * ===========================================================================
 * 组数（手抄的，见文件末尾那条探针）
 * ===========================================================================
 * zh 32 组、en 33 组（㉛ 零汉字扫描只在 `--en` 那一遍跑）。
 * ⚠️ 组号是**顺序**，不是历史编号：
 *   · ①–⑰ 是 Task 7 的第一部分；
 *   · ⑱–㉗ 是 Task 8 的第二部分 / 缺失清单 / 特性检测；
 *   · ㉘–㉚ 是 Task 8 **判修轮**（Critical 的 manual 行 / Ruling 64 的过期持久化值 /
 *     Ruling 65 的"没有读数"）；
 *   · ㉜（写在 ㉛ 前面）是收口波加的：**真实目录那 48 行真的渲染一遍**（spec §10）。
 *     ⇒ 计数：zh **32**、en **33**（见文件末尾那条探针）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { en, zhCN } from '@mcsr/shared/i18n';
import { type ModRelease, parseModCatalog } from '@mcsr/shared/modCatalog';
import {
  type CatalogRowView,
  type MissingModView,
  type ModFolderRowView,
  type ModFoldersState,
  type ModFolderView,
  mirrorsForUrl,
  planCatalogRows,
  type TagOptionView,
} from '@mcsr/shared/modFolders';
import i18n from 'i18next';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import {
  ModCatalogScanning,
  ModCatalogSection,
  type ModFoldersHandlers,
  NO_MOD_FOLDERS_LOAD,
  reduceModFoldersLoad,
  toggleTag,
} from '@/components/FileUpdatesPanel';
import { ModCatalogTable, RAW_KEY_RE, rawKeysIn } from '@/components/FileUpdateTable';
import { MissingModsList } from '@/components/MissingModsList';
import { ModFoldersPanel } from '@/components/ModFoldersPanel';
import { Files, ModFoldersParts } from '@/routes/Files';

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
 *     ⚠️ 2026-10-03 之后行里那些 chip 的文案改成从 `state.tags`（两种语言都有）取
 *     ⇒ `TAG_LABEL` 只是**查不到时的退路**，夹具仍然让它保持 ASCII。
 *   · `NOTE`：`ModFoldersState.notices[]` 由主进程写（中文），T7 只负责原样印。
 *   · `SKIP_REASON`：`lastRun.skipped[].reason` 同理（T6 的 `skipReasonOf`）。
 */
const TAG_LABEL = 'tag-legal';
const TAG_KEY = 'legal';
/** 主进程写好的那两句（`notices` 与 `lastRun.skipped[].reason`）：这一层只负责原样印。 */
const NOTE = 'MIGRATION-NOTICE-31337: adopted into folder tracking';
const SKIP_REASON = 'SKIP-REASON-4242: local build is newer';
/**
 * 状态里那一格**标签全集**（Ruling 58）：两种语言的显示名都在。
 * ⚠️ 夹具这里用 ASCII（`legal-label` / `legal-label-en`）而不是真目录里的「合法 / Legal」：
 *    ⑱ 的零汉字扫描要在**英文那一遍**跑，而中文显示名只在 `zh` 那一支里用得到。
 *    这一条只说"按当前语言取显示名"，不说"目录里那两个名字长什么样"。
 */
const TAG_OPTION = {
  key: TAG_KEY,
  labels: { zh: 'legal-label-zh', en: 'legal-label-en' },
};
/**
 * 状态里那一格**镜像表**（Ruling 55）：`content/mod-catalog.json` 的真实形状
 * （现读：一条 `gh-proxy`、`hosts: ['github.com']`、`prefix` 以 `/` 结尾）。
 * ⚠️ 夹具里**故意**把它留成"目录给的那一份"：④ 那组会拿它做**有/无/主机不匹配**三种输入，
 *    而"Web 侧写死一份"的那种坏法正是被判据挡住的东西。
 */
const MIRROR = {
  id: 'gh-proxy',
  label: 'gh-proxy.com',
  prefix: 'https://gh-proxy.com/',
  hosts: ['github.com'],
};
/** 一条**主机不匹配**的镜像（`hosts` 里没有 github.com）：它不该让镜像按钮出现。 */
const MIRROR_OTHER_HOST = { ...MIRROR, id: 'other-mirror', hosts: ['example.com'] };
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

/**
 * 已是最新（`same`）：第三处空态那一档。
 * ⚠️ 2026-10-03 的 Minor ② 之后，"多候选但本地命中其中一个"也是 `same` 而 `official`
 *    仍为 `null` ⇒ 那一支由 `ROW_SAME_AMBIGUOUS` 单独造（两组判据不能共用一个夹具）。
 */
const ROW_SAME: CatalogRowView = {
  ...ROW_GITHUB,
  verdict: { kind: 'same', release: SODIUM_NEW },
  batchable: false,
};

/**
 * ★ 多候选 + **本地字节命中了其中一个**（真实形状：`official === null` 而判定是 `same`）。
 * 这是 2026-10-03 评审 Minor ② 的现场：那一行的「打开原网页」必须指向**命中的那一个**，
 * 而候选清单也必须照常列出来。
 */
const ROW_SAME_AMBIGUOUS: CatalogRowView = {
  ...ROW_AMBIGUOUS,
  binding: { localPath: 'D:\\mods\\speedrunigt.jar', localVersion: '0.1.3' },
  verdict: { kind: 'same', release: SODIUM_NEW },
};

function stateOf(rows: CatalogRowView[], extra: Partial<ModFoldersState> = {}): ModFoldersState {
  return {
    catalogStatus: 'ok',
    gameVersion: '1.16.1',
    /* ★ Ruling 58：版本全集与标签全集（选项表的唯一来源）。 */
    gameVersions: ['1.16.1'],
    tags: [TAG_OPTION],
    /* ★ Ruling 55：镜像表（镜像按钮的唯一来源）。 */
    mirrors: [MIRROR],
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
/** 六个动作的包装 —— **值不会被执行**（静态渲染一行事件处理器都不跑），只为把 props 填满。 */
const HANDLERS: ModFoldersHandlers = {
  setCatalogGameVersion: async () => undefined,
  setTagFilter: async () => undefined,
  bindCatalogRow: async () => undefined,
  unbindCatalogRow: async () => undefined,
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

/** 只渲染那张表（⑪ 的"没有动作层"那两条要单独喂 props）。 */
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
        mirrors: [MIRROR],
        tagLabels: [TAG_OPTION],
        onBindLocal: noop,
        onUnbindLocal: noop,
        onUpdate: noop,
        ...props,
      }),
    ),
  );

// ---------------------------------------------------------------------------
// 第二部分 / 底部清单的夹具与渲染器（Task 8）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 这些夹具与第一部分那几张**有意分开**，两处都不是随手写的：
 *   · 文件夹行的 `verdict` 是 `FolderVerdict`（比 `ReleaseVerdict` 多一支
 *     `unknown-version`）⇒ 拿第一批那几张行去当文件夹行过不了类型检查；
 *   · **文件名里不带版本号**（`sodium-build-A.jar`）：真实 jar 名里通常有版本号，
 *     而"本地版本那一格印了 0.1.2"这条断言会因为**文件名里也有 `0.1.2`** 而恒真
 *     —— 一条测不出东西的断言（§5.32 的第一类）。夹具把两个数字分开，断言才咬得住。
 */
const FOLDER_ID = 'folder-1161';
const FOLDER_PATH = 'D:\\instances\\mcsr\\.minecraft\\mods';
const FOLDER_OLD_ID = 'folder-1710';
const FOLDER_OLD_PATH = 'D:\\instances\\classic\\.minecraft\\mods';
/** 一个"路径被移走"的文件夹（spec §8：绑定保留、不给更新动作、可解绑）。 */
const GONE_FOLDER_ID = 'folder-gone';
const GONE_FOLDER_PATH = 'D:\\moved\\away\\mods';

function folderRow(over: Partial<ModFolderRowView> & { modid: string }): ModFolderRowView {
  return {
    name: over.modid,
    fileName: `${over.modid}-build-A.jar`,
    localVersion: '0.1.2',
    localSha512: 'c'.repeat(128),
    oldCopies: [],
    candidates: [SODIUM_NEW],
    official: SODIUM_NEW,
    targetSource: 'catalog',
    verdict: { kind: 'older', release: SODIUM_NEW },
    manual: false,
    batchable: true,
    ...over,
  };
}

/** 可更新 + GitHub 来源（⇒ 两颗更新按钮）+ 一份旧副本。 */
const FROW_UPDATE = folderRow({
  modid: 'sodium',
  name: 'Sodium Plus',
  oldCopies: ['sodium-build-old.jar'],
});
/** 同一支判定、但目标在 `cdn.modrinth.com` ⇒ 只有原始那一颗（D5）。 */
const FROW_CDN = folderRow({
  modid: 'lithium',
  name: 'Lithium',
  candidates: [SODIUM_OLD],
  official: SODIUM_OLD,
  verdict: { kind: 'older', release: SODIUM_OLD },
});
/** `manual`（OptiFine 那一类）：**连更新按钮都不给**。 */
const FROW_MANUAL = folderRow({
  modid: 'optifine',
  name: 'OptiFine Plus',
  candidates: [OPTIFINE],
  official: OPTIFINE,
  verdict: { kind: 'older', release: OPTIFINE },
  manual: true,
  batchable: false,
});
/** 本地比目标新（只升不降）：只解释。 */
const FROW_NEWER = folderRow({
  modid: 'ranked',
  name: 'Ranked Plus',
  candidates: [UPSTREAM_NEW],
  official: UPSTREAM_NEW,
  verdict: { kind: 'newer', release: UPSTREAM_NEW },
  batchable: false,
});
/**
 * ★★ 收口波：`different-build` 是"要人显式点一下"的那一支 ⇒ **有**更新按钮
 *    （与第一部分同一份判据，见文件头的 `FolderRow`）。⚠️ `batchable: false` 是
 *    **故意的**：这一支永远不进批量，而按钮与批量**不是**同一条判据 ——
 *    夹具这样配，"按钮还在"这条断言才咬得住（拿 `batchable` 当闸的实现会当场红）。
 */
const FROW_DIFFERENT_BUILD = folderRow({
  modid: 'custom-map-resetter',
  name: 'Custom Map Resetter Plus',
  candidates: [UPSTREAM_NEW],
  official: UPSTREAM_NEW,
  verdict: { kind: 'different-build', release: UPSTREAM_NEW },
  batchable: false,
});
/** ★ **第二部分才可达**的那一支：这个游戏版本下清单里没有它。 */
const FROW_NO_RELEASE = folderRow({
  modid: 'absent',
  name: 'Absent Plus',
  candidates: [],
  official: null,
  verdict: { kind: 'missing-release' },
  batchable: false,
});
/** 两个候选（`official === null`）：列出来、不给按钮。 */
const FROW_AMBIGUOUS = folderRow({
  modid: 'speedrunigt',
  name: 'SpeedRunIGT Plus',
  candidates: [SODIUM_OLD, SODIUM_NEW],
  official: null,
  verdict: { kind: 'ambiguous', releases: [SODIUM_OLD, SODIUM_NEW] },
  batchable: false,
});
/** ★ 整夹那一档：游戏版本未知（`mmc-pack.json` 读不出来）⇒ 每一行 `unknown-version`。 */
const FROW_UNKNOWN_VERSION = folderRow({
  modid: 'krypton',
  name: 'Krypton Plus',
  localVersion: null,
  candidates: [],
  official: null,
  verdict: { kind: 'unknown-version' },
  batchable: false,
});

function folder(over: Partial<ModFolderView> & { folderId: string }): ModFolderView {
  return {
    path: `D:\\instances\\${over.folderId}\\mods`,
    pathExists: true,
    /* ⚠️ 默认"读到过"（Ruling 65 之后这一格是必填的；"没读到"那一档由 ㉚ 单独造）。 */
    hasReading: true,
    gameVersion: '1.16.1',
    autoUpdate: true,
    /* 两行是有意的：一行 GitHub 来源（两颗按钮）、一行 CDN 来源（一颗）—— ㉓ 的两刀。 */
    rows: [FROW_UPDATE, FROW_CDN],
    unrecognized: [],
    ...over,
  };
}

/** 主夹具：1.16.1、路径在、整夹自动更新开着、两行（GitHub 两颗按钮 / CDN 一颗）。 */
const FOLDER = folder({ folderId: FOLDER_ID, path: FOLDER_PATH });
/** 另一个版本的文件夹（缺失清单那两刀要用的对照）。 */
const FOLDER_OLD = folder({
  folderId: FOLDER_OLD_ID,
  path: FOLDER_OLD_PATH,
  gameVersion: '1.7.10',
});
/** 路径不存在的那一个（同一个 1.16.1 ⇒ 它必须被"下载到"的选项滤掉）。 */
const FOLDER_GONE = folder({
  folderId: GONE_FOLDER_ID,
  path: GONE_FOLDER_PATH,
  pathExists: false,
  rows: [],
});
/** 版本未知的那一个（同一个 1.16.1 的版本号说不出来 ⇒ 也必须被滤掉）。 */
const FOLDER_NO_VERSION = folder({ folderId: 'folder-no-version', gameVersion: null });

/** 底部清单的两行（两个不同的游戏版本 ⇒ 选项表必须各按各的过滤）。 */
/*
 * ⚠️★ Task 8 判修轮：`MissingModView` 多了两格（**Critical** 的 `manual` 与
 *    **Ruling 62②** 的 `release`）⇒ 夹具必须把它们说清楚，否则下面那些"给不给按钮"
 *    的断言测的是另一件事：
 *      · `MISSING_1161` 的 release 挂 GitHub（`GITHUB_URL`）⇒ **镜像适用** ⇒ 两颗按钮；
 *      · `MISSING_1710` 的 release 挂 CDN ⇒ **镜像不适用** ⇒ 只有原始那一颗（D5）。
 *    两行一起断言，镜像那一颗的判据才不是空跑。
 */
const MISSING_1161: MissingModView = {
  modid: 'missing-mod',
  name: 'Missing Mod',
  gameVersion: '1.16.1',
  tags: ['legal'],
  tagLabels: [TAG_LABEL],
  release: SODIUM_NEW,
  manual: false,
};
const MISSING_1710: MissingModView = {
  modid: 'missing-legacy',
  name: 'Missing Legacy',
  gameVersion: '1.7.10',
  tags: [],
  tagLabels: [],
  release: SODIUM_OLD,
  manual: false,
};
/**
 * ★★ **Critical 的夹具**（2026-10-03 T8 评审判修）：一条 `manual` 的缺失行。
 * ⚠️ 它就是真实数据的形状（实测：1.7.10 下的 `optifine` / `optifine-light` 是单候选
 *    manual ⇒ 绑一个 1.7.10 实例之后底部会立刻列出它们）⇒ `downloadMissing` 的
 *    `assertNotManual` **必拒** ⇒ 这一行**一颗下载都不给**，只给「打开原网页」。
 */
const MISSING_MANUAL: MissingModView = {
  modid: 'optifine',
  name: 'OptiFine Missing',
  gameVersion: '1.16.1',
  tags: [],
  tagLabels: [],
  release: OPTIFINE,
  manual: true,
};

/** 渲染第二部分（默认**桌面态**：有动作层）。 */
const foldersHtmlOf = (
  state: ModFoldersState,
  props: { handlers?: ModFoldersHandlers | null } = {},
): string =>
  keep(
    html(
      React.createElement(ModFoldersPanel, {
        state,
        handlers: props.handlers === undefined ? HANDLERS : props.handlers,
      }),
    ),
  );

/** 渲染底部缺失清单。 */
const missingHtmlOf = (
  state: ModFoldersState,
  props: { handlers?: ModFoldersHandlers | null } = {},
): string =>
  keep(
    html(
      React.createElement(MissingModsList, {
        state,
        handlers: props.handlers === undefined ? HANDLERS : props.handlers,
      }),
    ),
  );

/**
 * 渲染页面 ready 那一支的**三块**（`ModFoldersParts` 那个纯组件）。
 *
 * ⚠️★ 为什么必须是它而不是 `Files`：`Files` 的 ready 支路要等 `useModFolders()` 的
 *    IPC 回包，而静态渲染一行 effect 都不跑 ⇒ 直接渲染 `Files` 永远停在「正在扫描…」。
 *    这一层只吃 props，所以"三块真的拼在一起、而且第一块那句迁移提示就在同一份产物里"
 *    才断言得到（㉕）。
 */
const partsHtmlOf = (state: ModFoldersState): string =>
  keep(
    html(
      React.createElement(ModFoldersParts, {
        state,
        handlers: HANDLERS,
        actionError: null,
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

/** 一个文件夹那一块（`<details data-folder-id=…>`）。找不到就当场红。 */
function folderBlockOf(markup: string, folderId: string): string {
  const found = markup.match(
    new RegExp(`<details class="folderbox"[^>]*data-folder-id="${folderId}"[\\s\\S]*?</details>`),
  );
  assert.ok(
    found,
    `产物里找不到 data-folder-id="${folderId}" 的那个 <details> —— 那个文件夹没渲染出来（或者它不再是 <details>）`,
  );
  return found[0];
}

/** 那一块的头行（`<summary>`）—— 控件住在这里。 */
function summaryOf(block: string): string {
  const found = block.match(/<summary[\s\S]*?<\/summary>/);
  assert.ok(found, '这个折叠块里没有 <summary> —— 头行没渲染出来（spec §6.8 要求头行是它）');
  return found[0];
}

/** 文件夹里的一行（`data-folder-row` 那一格）。 */
function folderRowEl(block: string, modid: string): string {
  const found = block.match(
    new RegExp(`<tr class="filetable__row"[^>]*data-folder-row="${modid}"[\\s\\S]*?</tr>`),
  );
  assert.ok(found, `产物里找不到 data-folder-row="${modid}" 的那一行 —— 那一行没渲染出来`);
  return found[0];
}

/** 底部清单里的一行（`data-missing-mod` 那一格）。 */
function missingRowEl(markup: string, modid: string): string {
  const found = markup.match(
    new RegExp(`<tr class="filetable__row"[^>]*data-missing-mod="${modid}"[\\s\\S]*?</tr>`),
  );
  assert.ok(found, `产物里找不到 data-missing-mod="${modid}" 的那一行 —— 那一行没渲染出来`);
  return found[0];
}

/**
 * 一段产物里**每一个** `<select>` 的选项值与被选中的那个（按渲染顺序）。
 *
 * ⚠️★ 为什么必须按 `<select>` 切开：文件夹头行里**有两个**下拉（游戏版本 + 批量通道），
 *    而 `optionValues()` / `selectedOption()` 那两个老工具看的是"整段里所有的 option"
 *    —— 拿它们量头行会把两个下拉的选项混成一个集合（一条测错对象的判据）。
 * ⚠️ 选中的那一项两种写法都认（与 `selectedOption()` 同一条，属性顺序不能假设）。
 */
function selectsIn(markup: string): { values: string[]; selected: string }[] {
  return [...markup.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)].map((m) => {
    const body = m[2];
    const values = [...body.matchAll(/<option\b[^>]*\bvalue="([^"]*)"/g)].map((o) => o[1]);
    const chosen = (body.match(/<option\b[^>]*\bselected\b[^>]*>/) ?? [])[0];
    if (chosen !== undefined) {
      return { values, selected: chosen.match(/\bvalue="([^"]*)"/)?.[1] ?? '' };
    }
    return { values, selected: m[1].match(/\bvalue="([^"]*)"/)?.[1] ?? '' };
  });
}

/**
 * 一段产物里**被 `disabled` 掉的** `<option>` 的取值（Ruling 64 的读数）。
 *
 * ⚠️★ 为什么需要它：过期值**照画**（否则 `<select value=X>` 会静默选中第一个）但
 *    **不许可选**（选了就会被主进程拒）—— 这两件事的差别在产物里**只有** `disabled`
 *    这一个字符，而 `.values` 那一条读数看不出来。
 */
function disabledOptionValues(markup: string): string[] {
  return [...markup.matchAll(/<option\b([^>]*)>/g)]
    .filter((m) => /\bdisabled\b/.test(m[1]))
    .map((m) => m[1].match(/\bvalue="([^"]*)"/)?.[1] ?? '');
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

/** `<select>` 里**全部**选项的 `value`（按渲染顺序；Ruling 58 之后它是"全集"的读数）。 */
function optionValues(markup: string): string[] {
  return [...markup.matchAll(/<option\b[^>]*\bvalue="([^"]*)"/g)].map((m) => m[1]);
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

console.log(`【${LANG}】文件更新页 · 第一部分（目录行）+ 第二部分（文件夹）+ 底部（缺失清单）`);

// ---------------------------------------------------------------------------
// ① 两个筛选维度：游戏版本下拉（选项 = 状态里的**全集**）+ 标签多选
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 两个筛选器的**选择**住在主进程的 `prefs` 里（spec §6.8"按机器记住"）⇒ 组件是
 *    **受控**的：它只画 `state.gameVersion` / `state.tagFilter`，自己不存一份
 *    （两处记忆必然有一天不一致 —— `desktop.ts` 的那一段写着）。这一组断言的就是
 *    "产物里选中的是**状态里那一个**"。
 * ⚠️★ **选项表来自状态**（Ruling 58，2026-10-03 判修 2）：`state.gameVersions` 是目录的
 *    版本全集（实测 **107** 个）。T7 第一版在 Web 侧拿"当前值 ∪ 已绑定文件夹的版本"凑，
 *    没绑文件夹的客户端上那个下拉**只有一个选项** ⇒ D4 的那个维度等于不存在。
 *    ⇒ 这一组的判据是"目录给几个就给几个"，而不是"凑出来的那几个"。
 */
const defaultState = stateOf([ROW_GITHUB]);
const defaultHtml = sectionHtml(defaultState);
assert.equal(
  selectedOption(defaultHtml),
  '1.16.1',
  '★ 没有已绑定文件夹时，游戏版本下拉的默认值必须是 `1.16.1`（spec §6.8 / T4 采纳的那一版）',
);
/*
 * ★★ 判修 2 的核心判据：**一个文件夹都没绑**，而目录给了两个版本 ⇒ 下拉里就该有两个。
 *    （T7 第一版在这里只画得出一个 —— 那正是这一条要红的地方。）
 *    ⚠️ 夹具故意不给 `folders`：'1.7.10' 只可能来自 `state.gameVersions`。
 */
const versionsState = stateOf([ROW_GITHUB], {
  gameVersion: '1.16.1',
  gameVersions: ['1.7.10', '1.16.1'],
});
const versionsHtml = sectionHtml(versionsState);
assert.deepEqual(
  optionValues(versionsHtml),
  ['1.7.10', '1.16.1'],
  '★★ 下拉的选项表必须来自状态里的 `gameVersions`（目录的全集，Ruling 58）——' +
    '一个文件夹都没绑时也要列得全目录的版本（T7 第一版这里只有一个选项）',
);
assert.equal(
  selectedOption(versionsHtml),
  '1.16.1',
  '★ 而选中的仍然是状态里那一版（选项多了，选择不许跟着变）',
);
/*
 * ⚠️★ 反面：`prefs` 里那一版**不在**目录的全集里（目录换过之后的旧值）时，
 *    它必须**仍然是一个选项** —— `<select value=X>` 里没有 X 时浏览器会静默选中第一个，
 *    那一屏就在撒谎（用户看到的是"我的选择被改掉了"，而状态里那一格没变）。
 */
const staleState = stateOf([ROW_GITHUB], {
  gameVersion: '1.99.9',
  gameVersions: ['1.16.1'],
});
const staleHtml = sectionHtml(staleState);
assert.equal(
  selectedOption(staleHtml),
  '1.99.9',
  '★ 状态里那一版不在目录全集里时，它仍要出现在选项里并被选中（否则浏览器会静默选中第一个 = 撒谎）',
);
assert.ok(
  optionValues(staleHtml).includes('1.16.1'),
  '★ 反面：全集里那一版也照常在（补一个旧值不等于把全集顶掉）',
);
/*
 * ★ 标签多选：选项来自 `state.tags`（全集 + 两种语言），按下态来自 `state.tagFilter`。
 *   ⚠️ chip 的文案按**当前语言**取（`labels[lang]`）—— 这是 2026-10-03 顺带修掉的一条：
 *   行里的 `CatalogRowView.tagLabels` 只有 `zh`，英文界面上它会是中文。
 */
const tagFilterState = stateOf([ROW_GITHUB], { tagFilter: [TAG_KEY] });
const tagFilterHtml = sectionHtml(tagFilterState);
assert.ok(
  tagFilterHtml.includes('aria-pressed="true"'),
  '★ 标签多选必须把已选的标签画成"按下"状态（`aria-pressed`）',
);
assert.ok(
  textOf(tagFilterHtml).includes(textOf(TAG_OPTION.labels[LANG === 'en' ? 'en' : 'zh'])),
  `★ 标签 chip 的文案按当前语言取（${LANG}）—— 目录两种语言都给了（Ruling 58）`,
);
assert.equal(
  textOf(tagFilterHtml).includes(textOf(TAG_OPTION.labels.zh)) &&
    textOf(tagFilterHtml).includes(textOf(TAG_OPTION.labels.en)),
  false,
  '★ 反面：同一遍渲染里**只该出现一种语言**的标签名（两种都印 = 取错了那一格）',
);
assert.ok(
  textOf(tagFilterHtml).includes(textOf(resolved('files.catalogGameVersion'))) &&
    textOf(tagFilterHtml).includes(textOf(resolved('files.catalogTags'))),
  '★ 两个筛选器各自要有名字（没有名字的那一格，用户不知道自己在筛什么）',
);
ok(
  '① 两个筛选器：版本下拉 = 状态里的**版本全集**（含补进去的旧值）、标签多选按下态 + 按语言取显示名',
);

// ---------------------------------------------------------------------------
// ② 一行 GitHub 来源 ⇒ **两颗**按钮（原始 / 镜像）；镜像那一颗**由状态决定**（Ruling 55）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 这一组是 2026-10-03 判修 4（**Ruling 55**）的落点，判据分四刀：
 *   ① 状态里有那条镜像、且它的 `hosts` 认这个主机 ⇒ **两颗**（原始 / 镜像）；
 *   ② 状态里**没有**镜像（`mirrors: []`）⇒ 只剩原始那一颗 —— 这是"Web 侧写死一份目录配置"
 *      那一刀会**立刻**红的地方（写死时这一档照样会画出镜像按钮）；
 *   ③ 有一条镜像、但 `hosts` 不认这个主机 ⇒ 也只剩原始（主机匹配住在 `mirrorsFor` 里）；
 *   ④ 非 GitHub 来源（`cdn.modrinth.com`）⇒ 只剩原始（D5）。
 * ⚠️ 镜像按钮的**文案**与"送哪个 id"是两件事：静态渲染看不见事件处理器 ⇒ 通道由 ⑯ 的
 *    接线守卫兜着（它的判据是 `mirror.id`，也就是**状态里那一条**的 id）。
 */
const githubRow = rowOf(tableHtml([ROW_GITHUB]), 'sodium');
assert.deepEqual(
  labelsIn(githubRow).filter((label) => label !== labelOf('files.unbind')),
  [labelOf('files.updateOrigin'), labelOf('files.updateMirror')],
  '★ GitHub 来源、且状态里有认这个主机的镜像 ⇒ **两颗**按钮：原始 + 镜像（D5 / D6）',
);
const noMirrorRow = rowOf(tableHtml([ROW_GITHUB], { mirrors: [] }), 'sodium');
assert.deepEqual(
  labelsIn(noMirrorRow).filter((label) => label !== labelOf('files.unbind')),
  [labelOf('files.updateOrigin')],
  '★★ 状态里的镜像表是**空**的 ⇒ 只画原始那一颗（写死一份目录配置的坏法在这里立刻红）',
);
const otherHostRow = rowOf(tableHtml([ROW_GITHUB], { mirrors: [MIRROR_OTHER_HOST] }), 'sodium');
assert.deepEqual(
  labelsIn(otherHostRow).filter((label) => label !== labelOf('files.unbind')),
  [labelOf('files.updateOrigin')],
  '★★ 有镜像、但它的 `hosts` 不认这条 release 的主机 ⇒ 也不画镜像按钮（主机判据住在 `mirrorsFor`）',
);
const cdnRow = rowOf(tableHtml([ROW_CDN]), 'sodium');
assert.deepEqual(
  labelsIn(cdnRow).filter((label) => label !== labelOf('files.unbind')),
  [labelOf('files.updateOrigin')],
  '★★ 非 GitHub 来源没有镜像按钮（D5）：多一颗 ⇒ 主进程会拒（`mirrorsFor` 的主机判据）',
);
/*
 * ★★ 那四刀背后是**同一个函数**：`mirrorsForUrl()`（`packages/shared/src/modFolders.ts`，
 *    它只是把状态里那份镜像表喂给 `mirrorsFor` —— 主机匹配**只有一处实现**）。
 *    这里直接量它，是因为"Web 侧自己写一份主机判断"正是判修 4 要消灭的那件事：
 *    一条坏掉的实现可以让上面四刀全绿（只要它在这几个夹具上恰好同结果）。
 */
assert.deepEqual(
  mirrorsForUrl([MIRROR], GITHUB_URL).map((m) => m.id),
  [MIRROR.id],
  '★ `mirrorsForUrl`：`hosts` 认这个主机 ⇒ 返回那一条（**id 从状态来**，不是写死的）',
);
assert.deepEqual(
  mirrorsForUrl([MIRROR], CDN_URL),
  [],
  '★ `mirrorsForUrl`：主机不在 `hosts` 里 ⇒ 空数组（与主进程 `channelUrl` 的判据同一份实现）',
);
assert.deepEqual(
  mirrorsForUrl([MIRROR], 'not-a-url'),
  [],
  '★ `mirrorsForUrl`：地址解不出来 ⇒ 空数组（不抛：这一层是纯判断）',
);
ok(
  '② 镜像按钮完全由状态里的 `mirrors` 决定（有/无/主机不匹配/非 GitHub 四刀）+ 判据共用 `mirrorsForUrl`',
);

// ---------------------------------------------------------------------------
// ③ `manual` 的行（OptiFine）⇒ **没有更新按钮**，只有「打开原网页」（+ 绑定 / 解绑）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 这是 Ruling 47/48 的落点：**不给一个主进程会拒的按钮**。`manual` 的 release
 *    在 `assertNotManual` 那一层被拒（spec §8 的"绝不替换"）⇒ 界面上画一颗
 *    「更新」就是让用户白点一次、吃一句红字。
 * ⚠️★ 但 **2026-10-03 的 Ruling 60 之后**，"已绑定"的行会多一颗安静的「解除绑定」——
 *    它不是"主进程会拒的按钮"（`unbindCatalogRow` 就是为它加的），所以这一组不再写成
 *    "一颗按钮都没有"，而是**逐颗点名**：既不能多出更新按钮、也不许把解绑那颗藏掉。
 *    （原来的断言是 `buttonsIn(manualRow).length === 0`，那一条**必须改** —— 改的
 *    理由与新旧文本都记在报告里。）
 * ⚠️★★ **收口波（2026-10-03）再改一次**：「绑定本地文件」那颗对 `manual` 的行**是给**的
 *    —— `bindCatalogRow` 里**没有**任何 `manual` 检查、§6.8 的动作清单也不豁免它；
 *    第一版按 `manual` 把它一起藏掉，理由（"主进程对两者都会拒"）是**假的**。
 *    ⇒ 已绑定那一行的按钮集合**没变**（`[unbind]`：绑着就没有"绑定"可点），
 *    变的是**未绑定**那一行：从"一颗按钮都没有"变成"恰好一颗「绑定本地文件」"。
 */
const manualRow = rowOf(tableHtml([ROW_MANUAL]), 'optifine');
assert.deepEqual(
  labelsIn(manualRow),
  [labelOf('files.unbind')],
  '★ `manual` 且已绑定的行：**没有**更新按钮，只有那一颗「解除绑定」（Ruling 47/60）',
);
assert.deepEqual(
  labelsIn(manualRow).filter(
    (label) => label === labelOf('files.updateOrigin') || label === labelOf('files.updateMirror'),
  ),
  [],
  '★ `manual` 的行不许有更新按钮（主进程的 `assertNotManual` 必拒）',
);
const manualUnboundRow = rowOf(tableHtml([{ ...ROW_MANUAL, binding: null }]), 'optifine');
assert.deepEqual(
  buttonsIn(manualUnboundRow).map((button) => button.label),
  [labelOf('files.bindLocal')],
  '★★ `manual` 且**未绑定**的行：恰好一颗「绑定本地文件」' +
    '（`bindCatalogRow` 不检查 manual —— 藏掉它是一条假理由；更新那颗仍然不许有）',
);
assert.deepEqual(
  labelsIn(manualRow).filter(
    (label) => label === labelOf('files.updateOrigin') || label === labelOf('files.updateMirror'),
  ),
  [],
  '★ 反面：上面那一条不是靠"manual 行什么都不画"过的 —— 更新那两颗仍然缺席',
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
ok(`③ \`manual\` 的行没有更新按钮（已绑定时能解绑、未绑定时能绑定），只有「打开原网页」`);

// ---------------------------------------------------------------------------
// ④ `newer` / `unknown` 两支只解释；`different-build` 有**自己的**更新入口（收口波）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ spec §7.2 的 ④/⑤ 与 §8：
 *   · `newer` 与 `unknown` **都不进批量**、也不该有一颗按钮（`assertUpdatable` 拒它们）
 *     ⇒ 界面欠的是一句**各自的**解释（合成一句"不能更新"就把"为什么"删掉了）。
 *   · ★★ `different-build` **是**"要人显式点一下"那一支（Ruling 47 的纠正、spec §8 的
 *     按钮文案要求）⇒ 它**必须**有更新按钮，而且那颗按钮要能送它自己那条通道。
 *     ⚠️ 收口波之前这一组把三支写在一起断言"都没有更新按钮" —— 那条断言**把缺陷钉住了**
 *     （`different-build` 的行在页面上确实一颗按钮都没有，而 `lastRun.skipped` 那句
 *     "要人显式点一下这一条"因此是一句**做不到的指令**）。真实受害者：`standardsettings`
 *     与 1.16.1 下那 4 个主体含非数字段的 mod。
 */
const newerRow = rowOf(tableHtml([ROW_NEWER]), 'ranked');
const differentRow = rowOf(tableHtml([ROW_DIFFERENT_BUILD]), 'ranked');
const unknownRow = rowOf(tableHtml([ROW_UNKNOWN]), 'ranked');
for (const [name, row, key] of [
  ['newer', newerRow, 'files.hintNewer'],
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
 * ★ 反面：这几支与"可更新"那一支**长得要分得开**（同一张表里）。
 *   `ROW_GITHUB` 是同一份夹具的"该给按钮"那一侧 ⇒ 两边都断言，判据才不会退化成空跑。
 *   ⚠️ 数的是**更新**那两颗（`ROW_GITHUB` 是已绑定的 ⇒ 还有一颗「解除绑定」，见 ③）。
 */
assert.equal(
  labelsIn(githubRow).filter(
    (label) => label === labelOf('files.updateOrigin') || label === labelOf('files.updateMirror'),
  ).length,
  2,
  '★ 反面：可更新的那一行**确实**有那两颗更新按钮（否则上面那些"没有按钮"是空跑）',
);
/*
 * ★★ 收口波的正面读数：`different-build` 那一行**有自己的更新入口**。
 *   ⚠️ 这一段是这一组里唯一"该有按钮"的反例之一 —— 它与 `newer`/`unknown` 的差别必须
 *   在两份产物上都钉住（只断言"没有按钮"的话，这一行回到"一颗都没有"照样绿，
 *   而 `lastRun.skipped` 那句"要人显式点一下这一条"就又变成做不到的指令）。
 *   `ROW_DIFFERENT_BUILD` 的目标挂在 `GITHUB_URL` 上 ⇒ 镜像那一颗也该在（D5/D6）。
 */
assert.deepEqual(
  labelsIn(differentRow).filter(
    (label) => label === labelOf('files.updateOrigin') || label === labelOf('files.updateMirror'),
  ),
  [labelOf('files.updateOrigin'), labelOf('files.updateMirror')],
  '★★ `different-build` 的行**必须**有那两颗更新按钮（Ruling 47 的纠正 / spec §8：' +
    '"要人显式点一下"的那一支，而它是 GitHub 来源 ⇒ 镜像那颗也在）',
);
assert.ok(
  textOf(differentRow).includes(textOf(resolved('files.hintDifferentBuild'))),
  '★ 而且它那句解释要**说清那颗按钮会做什么**（用官方那条替换掉本地这份不同的字节）',
);
/*
 * ★★ 文案的诚实性（§8 的 `different` 状态不存在 ⇒ 只说知道的那一半）：
 *   `different-build` 同时装着"版本主体相同"与"两边主体排不出先后"两种输入
 *   ⇒ 两处文案**都不许**声称版本号相同（实测反例 `HD_U_F9` vs `HD_U_F10`）。
 *   ⚠️ 这两条直接断言**两份字典**（不是渲染产物）：改回"同版本号"那一版就当场红，
 *   而"字节不同"这一半必须还在（否则为了诚实把信息删光了也是一种坏法）。
 */
assert.equal(
  zhCN.files.verdictDifferentBuild.includes('同版本号') ||
    zhCN.files.hintDifferentBuild.includes('版本号相同'),
  false,
  '★★ 中文文案不许声称"版本号相同"（`different-build` 也装"排不出先后"那一类输入）',
);
assert.equal(
  en.files.verdictDifferentBuild.includes('Same version') ||
    en.files.hintDifferentBuild.includes('Same version number'),
  false,
  '★★ 英文文案不许声称"same version"（同一条理由）',
);
assert.equal(
  zhCN.files.hintDifferentBuild.includes('字节') && en.files.hintDifferentBuild.includes('bytes'),
  true,
  '★★ 而"字节不同"这一半必须还在（诚实 ≠ 把已知信息删光）',
);
ok('④ `newer` / `unknown` 只解释、没有更新按钮；`different-build` 有自己的更新入口与诚实的文案');

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
  [labelOf('files.unbind')],
  '★ 多候选那一行**不许**有更新按钮（`official` 是 `null` ⇒ 主进程必拒，Ruling 47/48）；' +
    '它是已绑定的 ⇒ 只留那一颗「解除绑定」（Ruling 60）',
);
/*
 * ★★ Minor ①（2026-10-03 评审）：那一格印的是 `—`（没有目标），旁边**不许**再写来源。
 *    "对一个不存在的目标声称来源"是同一类假话（与"给会被拒的按钮"同族）。
 */
assert.equal(
  textOf(ambiguousRow).includes(textOf(resolved('files.targetSource.catalog'))) ||
    textOf(ambiguousRow).includes(textOf(resolved('files.targetSource.upstream'))),
  false,
  '★ `official === null` 的行**一个字都不许**印"来源"（那一格是 `—`，印来源就是对一个不存在的目标声称来源）',
);
/*
 * ★★ Minor ②（2026-10-03 评审）：多候选 + **本地字节命中了其中一个** ⇒ 判定是 `same`
 *    而 `official` 仍是 `null`。那一行的「打开原网页」必须指向**命中的那一个**
 *    （不再退回 `candidates[0]`），而且候选清单**照常列出来**。
 */
const sameAmbiguousRow = rowOf(tableHtml([ROW_SAME_AMBIGUOUS]), 'speedrunigt');
/** 命中的那一条 = 夹具 `verdict.release`（`SODIUM_NEW`）—— 不是 `candidates[0]`（`SODIUM_OLD`）。 */
const matchedUrl = SODIUM_NEW.url;
assert.deepEqual(
  linksIn(sameAmbiguousRow).map((l) => l.href),
  [...ROW_SAME_AMBIGUOUS.candidates.map((c) => c.url), matchedUrl],
  '★★ 命中候选的那一行：候选清单照常列出来（DOM 顺序在状态那一格），而「打开原网页」指向' +
    '**命中的那一个**（`SODIUM_NEW`，不是 `candidates[0]` 的 `SODIUM_OLD`）（Minor ②）',
);
assert.notEqual(
  matchedUrl,
  ROW_SAME_AMBIGUOUS.candidates[0]?.url,
  '★ 夹具自钉：命中那一条必须**不是**第一条候选（否则上面那条断言测不出"退回 candidates[0]"那一刀）',
);
ok(
  '⑤ ambiguous：全部候选都列出来 + 「程序不替你猜」那句、没有更新按钮（只留解绑）、不印来源、命中候选时链接指向那一个',
);

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
 *   · 目录不可用 **且一行都没有** ⇒ 那条**阻塞**说法（"列不出任何东西"）+ 不画表；
 *   · 目录不可用 **但缓存里还有行** ⇒ 一条**非阻塞**的说明 + **照常画表**（**判修 1**）；
 *   · 目录 OK + 0 行 ⇒ 真的没有（今天只有"标签筛选挡掉了"这一种可达路径）；
 *   · 有行、但全是 `same` ⇒ 有东西可看、只是没有可更新的。
 */
const unavailableHtml = sectionHtml(
  stateOf([], { catalogStatus: 'unavailable', missingStatus: 'catalog-unavailable' }),
);
assert.ok(
  textOf(unavailableHtml).includes(textOf(resolved('files.catalogUnavailable'))),
  '★ 目录不可用**且一行都没有**时必须说"目录还没拉到"（与"这个版本下没有 mod"是两句不同的话）',
);
assert.equal(
  textOf(unavailableHtml).includes(textOf(resolved('files.catalogNoRows'))),
  false,
  '★ 目录不可用那一档**不许**印"这个游戏版本下没有行" —— 那 48 行只是在目录里，我们没拉到',
);
assert.equal(
  unavailableHtml.includes('filetable__table'),
  false,
  '★ 目录不可用**且没有行**时不画表（一张空壳表的下方本该有行）',
);
/*
 * ★★★ 判修 1（2026-10-03 评审，本轮最该修的一条）：**目录这次没拉到、而缓存里还有行**。
 *
 * 现场：重新抓目录失败**不会清空**已经加载的那一份（`mod-folder-catalog.ts` 只置状态，
 * 目录本身留着 —— spec §8 要求保留缓存）⇒ T7 第一版按 `catalogStatus !== 'ok'` 一刀切，
 * 把**存在的行藏掉**、并印一句"这一栏现在列不出任何东西"（假话）。对照组就在同一个文件里：
 * v1 那半边写着"**不清空** `catalog` 是 spec §8 的要求，缓存里那几条会照常渲染成行"。
 * ⚠️ 这一组的四刀：行在、表在、按钮在、而且那句话换成**非阻塞**的那条（"上一次拉到的"）。
 *    （第一版的判据只建模了"行为空"那一种 ⇒ **抓不到**这一刀。）
 */
const staleRowsHtml = sectionHtml(
  stateOf([ROW_GITHUB, ROW_UNBOUND], {
    catalogStatus: 'unavailable',
    missingStatus: 'catalog-unavailable',
  }),
);
const staleGithubRow = rowOf(staleRowsHtml, 'sodium');
assert.ok(
  staleRowsHtml.includes('filetable__table'),
  '★★★ 目录不可用但**缓存里还有行** ⇒ 表必须照常画（判修 1：藏掉它 = 丢掉绑定与打开原网页）',
);
assert.deepEqual(
  labelsIn(staleGithubRow).filter(
    (label) => label === labelOf('files.updateOrigin') || label === labelOf('files.updateMirror'),
  ),
  [labelOf('files.updateOrigin'), labelOf('files.updateMirror')],
  '★★★ 而那些行的按钮**照常可用**（缓存下来的目录行仍然能更新 —— 主进程那一侧也照常按目录判）',
);
assert.ok(
  textOf(staleRowsHtml).includes(textOf(resolved('files.catalogUnavailableRows'))),
  '★★★ 那一档的话必须换成"下面这几行是**上一次**拉到的"（不是"这一栏列不出任何东西"）',
);
assert.equal(
  textOf(staleRowsHtml).includes(textOf(resolved('files.catalogUnavailable'))),
  false,
  '★★★ 有行时**不许**再印"列不出任何东西"那句 —— 那就是这一条判修要消灭的假话',
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
ok(
  '⑧ 四处空态分得开：目录不可用（无行则无表）/ 目录不可用但**有行**（表照常）/ 真的没有行 / 全部已最新',
);

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
  3,
  '★ 反面：`busy` 时按钮是"禁用"，不是"消失"（`ROW_GITHUB` 是已绑定的 ⇒ 两颗更新 + 一颗解绑，共 3 颗）',
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
ok('⑨ `busy`：三颗按钮都在但都禁用 + 一句解释；不忙时可用');

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
  3,
  '★ 反面：已绑定 + 可更新的那一行确实有三颗（两颗更新 + 一颗解绑）（上面那条否则是空跑）',
);
assert.equal(
  buttonsIn(rowOf(withActionsHtml, 'lithium')).length,
  1,
  '★ 反面：未绑定的那一行确实有那一颗「绑定本地文件」（它没有解绑可点：没有绑定）',
);
ok('⑪ 没有动作层 ⇒ 每一行的操作列都是空的；有动作层 ⇒ 按钮真的在（3 + 1）');

// ---------------------------------------------------------------------------
// ⑪b `unbindCatalogRow` 那颗按钮（**Ruling 60**）：绑定了就必须能解绑
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 为什么这一组必须存在：新 UI 在 `modFolders` 存在的客户端里**只**渲染第一部分
 *    （Ruling 49）⇒ v1 的 `unbind(itemId)` 在那一页上**不可达**，而这一组契约原先只有
 *    `bindCatalogRow` ⇒ **绑定了就永远解不掉**（绑错的行、T4 迁移采纳的行都留在那里）。
 *    `unbindCatalogRow` 就是补上的那条通道，界面这一侧的落点就是这一颗按钮。
 * ⚠️ 判据分三层，缺一层就有一条坏法没人喊：
 *   ① **已绑定**的行有它（未绑定的行**没有**它 —— 没有绑定可解）；
 *   ② 它在**只读**（没有动作层）时不画（与其余按钮同一条闸）；
 *   ③ 它接的是**新通道**（⑯ 的接线守卫钉住 `handlers.unbindCatalogRow`）。
 */
const boundRowHtml = rowOf(tableHtml([ROW_GITHUB]), 'sodium');
assert.deepEqual(
  labelsIn(boundRowHtml),
  [labelOf('files.updateOrigin'), labelOf('files.updateMirror'), labelOf('files.unbind')],
  '★ 已绑定的行要有那一颗「解除绑定」（Ruling 60：绑定了就必须能解绑）',
);
assert.equal(
  labelsIn(rowOf(tableHtml([ROW_UNBOUND]), 'lithium')).includes(labelOf('files.unbind')),
  false,
  '★ 未绑定的行**不许**有「解除绑定」（没有绑定可解；主进程也会拒）',
);
assert.equal(
  labelsIn(rowOf(tableHtml([{ ...ROW_GITHUB, binding: null }]), 'sodium')).includes(
    labelOf('files.unbind'),
  ),
  false,
  '★ 反面同上：同一份夹具把 `binding` 拿掉之后，那一颗必须消失（判据是绑定，不是行本身）',
);
ok('⑪b Ruling 60：已绑定的行有「解除绑定」，未绑定的行没有（判据只看 `binding`）');

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
 * ⚠️ "钩子**真的**会进那一屏"由 **⑰** 证（给 `globalThis.mcsr` 放一份桩，然后真的渲染
 *    `Files` —— 第一帧就是它）。这一组只管那一屏的**文案**。
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

// —— 守卫 1：★★ 镜像那一颗的判据与 id **都来自状态**（能红的那一刀：改回硬编码）——
/*
 * ⚠️★ 这一条是 2026-10-03 判修 4（**Ruling 55**）的守卫：T7 第一版在 Web 侧写死了
 *    `ROW_MIRROR_ID = 'gh-proxy'` 与一个按 `github.com` 判主机名的函数。那一版**能过**
 *    ② 里"有/无镜像"的两刀（只要夹具恰好同结果）—— 而目录一改就静默画出"会被主进程拒
 *    的按钮"。⇒ 判据是**源码形状**：镜像的可用性与 id 必须来自参数 `mirrors`，
 *    而"目录配置"那两个字符串**一个字都不许**留在这一页里。
 * ⚠️ 能红它的刀（跑过的读数在报告里）：把 `mirrorsForUrl(mirrors, …)` 换成
 *    `row.official.url.includes('github.com')` 再配一个写死的 `'gh-proxy'`。
 */
assert.match(
  tableCode,
  /const\s+applicable\s*=\s*hasTarget\s*\?\s*mirrorsForUrl\(mirrors,\s*row\.official!\.url\)/,
  '★★ 镜像按钮的可用性必须来自**状态里的镜像表**（`mirrorsForUrl(mirrors, …)`，Ruling 55）',
);
assert.match(
  tableCode,
  /mirrorId:\s*mirror\.id/,
  '★★ 镜像通道送的 id 必须来自**那一条镜像对象**（`mirror.id`），不是 Web 侧写死的字符串',
);
assert.equal(
  tableCode.includes('gh-proxy') || tableCode.includes('isGitHubRelease'),
  false,
  '★★ 这一页里**不许**再出现写死的目录配置（`gh-proxy` / `isGitHubRelease`）：' +
    '那是一份会漂的第二真相，而失败形态是"点了被主进程拒"（判修 4 / Ruling 55）',
);

// —— 守卫 2：★★ 两颗更新按钮各送**自己那条通道**（能红的那一刀：把镜像那一颗改成 `'origin'`）——
/*
 * ⚠️★ 为什么不能只断言"有两颗按钮"：两颗都送 `'origin'` 也能过 ② —— 而那样镜像按钮
 *    是个**假**按钮（用户以为走了加速站，其实没有）。判据是两颗按钮各自
 *    `onUpdate?.(row.rowId, …)` 的**第二个实参**：一颗字面量 `'origin'`、
 *    一颗 `{ mirrorId: mirror.id }`。
 * ⚠️ 两者之间的窗口是**实测**的（`{0,400}` 曾经差 32 个字符 —— 实测 gap = 432）：
 *    它是"同一个操作列里那两颗按钮"的距离，不是"往后随便找"。窗口放这么宽是因为
 *    中间还夹着 `<button>` 的属性与 JSX 注释（注释被剥掉，但换行与缩进留着）。
 */
assert.match(
  tableCode,
  /onUpdate\?\.\(row\.rowId,\s*'origin'\)[\s\S]{0,800}?onUpdate\?\.\(row\.rowId,\s*\{\s*mirrorId:\s*mirror\.id\s*\}\)/,
  "★★ 两颗更新按钮必须各送自己那条通道（第一颗 `'origin'`、第二颗 `{ mirrorId: mirror.id }`）" +
    '—— 两颗都送 `\'origin\'` 时"镜像按钮"是个假按钮，而产物里看不出来',
);

// —— 守卫 3：★ 「打开原网页」指向 release 自己的地址（能红的那一刀：把 href 写死）——
assert.match(
  tableCode,
  /href=\{page\}/,
  '★ 「打开原网页」的 href 必须来自那一行的 release（`originPageOf(row)`）—— 写死一个地址等于把用户送去别处',
);

// —— 守卫 4：★★ 解绑那一颗接的是**新通道**（能红的那一刀：`onUnbindLocal` 接成 `bindCatalogRow`）——
/*
 * ⚠️★ Ruling 60 的产品判据在 ⑪b（有按钮）；这一条钉的是**那颗按钮走哪条通道** ——
 *    静态渲染看不见事件处理器 ⇒ 接错了（比如接到 `bindCatalogRow`）产物一模一样，
 *    只有这条守卫会出声。两根线都断言：表格那一层收 `onUnbindLocal`、
 *    面板那一层把它接到 `handlers.unbindCatalogRow`。
 */
assert.match(
  tableCode,
  /onClick=\{\(\)\s*=>\s*onUnbindLocal\?\.\(row\.rowId\)\}/,
  '★★ 「解除绑定」那一颗必须调 `onUnbindLocal(row.rowId)`（接错 = 那颗按钮干别的事）',
);
assert.match(
  panelCode,
  /onUnbindLocal:\s*\(rowId: string\)\s*=>\s*void handlers\.unbindCatalogRow\(rowId\)/,
  '★★ 面板那一层必须把 `onUnbindLocal` 接到 `handlers.unbindCatalogRow`（Ruling 60 的新通道）',
);
assert.equal(
  panelCode.match(/handlers\.unbindCatalogRow\(/g)?.length,
  1,
  '★★ `handlers.unbindCatalogRow(` 只许出现一次（就是那颗解绑按钮的接线）',
);

// —— 守卫 5：★ 筛选器的两个动作各自接在自己那条通道上（能红的那一刀：`setTagFilter` 接成 `setCatalogGameVersion`）——
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
/*
 * ★★ 判修 1 的**形状**守卫（产品判据在 ⑧）：那一档必须按**行数**分两支 ——
 *    "一行都没有"才是阻塞说法，有行时是另一句 + 照常画表。写成 `catalogStatus !== 'ok'`
 *    一刀切就是那条判修要消灭的假话。
 */
assert.match(
  panelCode,
  /rows\.length === 0 \? t\('files\.catalogUnavailable'\) : t\('files\.catalogUnavailableRows'\)/,
  '★★ 目录不可用那一档的**说法**必须按行数分（缓存里还有行 ⇒ 说"上一次拉到的"，判修 1）',
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
  '⑯ 源码形状守卫 5 组：镜像判据与 id 都来自状态（无硬编码）、两颗更新按钮各送自己的通道、原网页链接来自 release、解绑接新通道、两个筛选器各接自己那条通道且只有一处、判修 1 的说法按行数分',
);

// ---------------------------------------------------------------------------
// ⑰ ★★ 页面**第一帧**就是「正在扫描…」（Ruling 42，真的渲染 `Files` 那一页）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 为什么这一组能证到"钩子真的会进那一屏"（T7 报告的 §9 原先把它写成"证不了"，
 *    2026-10-03 评审指出**读得出来**，于是把它变成了断言）：
 *      · `useModFolders()` 的**初始** state 就是 `NO_MOD_FOLDERS_LOAD`（`loading`）
 *        —— 这一格不依赖任何 IPC 回包；
 *      · `Files.tsx` 把 `mods.status === 'loading'` 映到 `<ModCatalogScanning />`；
 *      · 静态渲染就跑**第一次渲染** ⇒ 只要"桌面壳那一支"在场，第一帧必然是那一屏。
 *    ⇒ 这一组在渲染 `Files` 之前给 `globalThis.mcsr` 放一份**桩**（`isDesktop: true` +
 *    两个子对象），渲染完**立刻删掉**（别的组不能受影响 —— 它们量的是浏览器态/纯 props）。
 *    ⚠️ 桩里的方法体**永远不会被执行**（静态渲染不跑 effect）：它们只是让
 *    `desktopBridge()?.modFolders` 判成"在"。
 * ⚠️ 能红它的刀：把 `Files.tsx` 的 `loading` 那一支换成 `null`（或换成 v1 的
 *    `common.loading`）⇒ 这一条红。
 * ⚠️★ Task 8 把这个桩抽成了 `shellStub(withModFolders)`：㉕ 要用**同一个桩的 0.0.4
 *    形态**（有 `mcsr`、没有 `modFolders`）去证特性检测那一支 —— 两处各写一份桩的话，
 *    "0.0.4 与 0.0.5 的差别只有 `modFolders` 在不在"这件事就没有一处说得清。
 */
assert.equal(
  NO_MOD_FOLDERS_LOAD.status,
  'loading',
  '★ `useModFolders()` 的起点必须是 `loading`（Ruling 42 的那一屏靠它，不靠任何回包）',
);

/**
 * 一个桌面壳桩。
 *
 * ⚠️ 桩里的方法体**永远不会被执行**（静态渲染不跑 effect）：它们只是让
 *    `desktopBridge()` / `desktopBridge()?.modFolders` 判成"在不在"。
 * ⚠️ `withModFolders: false` 就是 **0.0.4**：`mcsr` 在、`modFolders` 不在 —— 这一支
 *    正是 `Files.tsx` 走 v1 那条路的判据（`useModFolders()` 见不到 `modFolders`
 *    ⇒ `unavailable`）。
 * ⚠️ `modFolders` 用**展开**而不是 `modFolders: undefined`：`{ modFolders: undefined }`
 *    与"没有这一格"在 `?.` 下结果一样，但前者会让"这个对象里有这个键"看起来成立
 *    （读桩的人会以为 0.0.4 也有那条通道）。
 */
function shellStub(withModFolders: boolean) {
  return {
    isDesktop: true,
    platform: 'test',
    versions: { electron: '0', chrome: '0', node: '0' },
    update: {
      onStatus: () => () => undefined,
      getStatus: async () => ({ state: 'idle' }),
      check: () => undefined,
      download: () => undefined,
      install: () => undefined,
    },
    fileUpdates: {
      getState: async () => ({}),
      onStatus: () => () => undefined,
      bind: async () => ({}),
      bindFolder: async () => ({}),
      unbind: async () => ({}),
      setAutoUpdate: async () => ({}),
      check: async () => ({}),
      update: async () => ({}),
      updateAll: async () => ({}),
    },
    ...(withModFolders
      ? {
          modFolders: {
            getState: async () => ({}),
            onStatus: () => () => undefined,
            bindFolder: async () => ({}),
            bindCatalogRow: async () => ({}),
            unbindCatalogRow: async () => ({}),
            unbindFolder: async () => ({}),
            rescan: async () => ({}),
            setFolderGameVersion: async () => ({}),
            setFolderAutoUpdate: async () => ({}),
            setBulkChannel: async () => ({}),
            updateMod: async () => ({}),
            updateCatalogRow: async () => ({}),
            updateFolderAll: async () => ({}),
            downloadMissing: async () => ({}),
            setCatalogGameVersion: async () => ({}),
            setTagFilter: async () => ({}),
          },
        }
      : {}),
  };
}

const stubBridge = shellStub(true);
Object.assign(globalThis, { mcsr: stubBridge });
const firstFrameHtml = keep(
  html(React.createElement(MemoryRouter, null, React.createElement(Files, null))),
);
delete (globalThis as { mcsr?: unknown }).mcsr;
assert.ok(
  textOf(firstFrameHtml).includes(textOf(resolved('files.catalogScanning'))),
  '★★ 桌面壳里的**第一帧**必须是「正在扫描…」（Ruling 42：首拉可能等一次补扫，' +
    '否则用户看到的是"这一页挂了"）',
);
assert.equal(
  textOf(firstFrameHtml).includes(textOf(resolved('common.loading'))),
  false,
  '★ 那一帧**不许**是 v1 的「加载中…」（两个世代的取数不是同一件事：`modFolders` 那一支在的壳里，' +
    '这一页的第一句话必须是"正在扫描"）',
);
assert.equal(
  (globalThis as { mcsr?: unknown }).mcsr,
  undefined,
  '★ 桩必须已经删掉（否则后面任何一组都会在"桌面壳"那一支上渲染 —— 那是另一条路）',
);
ok('⑰ 第一帧（真桌面壳桩）：`Files` 直接画「正在扫描…」，不是 v1 的「加载中…」（Ruling 42）');

// ===========================================================================
// Task 8：第二部分（文件夹）+ 底部（缺失清单）+ 特性检测（⑱–㉗）
// ===========================================================================

// ---------------------------------------------------------------------------
// ⑱ 文件夹是一个 `<details>`，头行（`<summary>`）里六样控件
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 判据来自 spec §6.8 的**字面**："文件夹子栏目（`<details>`）：头行显示路径、
 *    游戏版本（可改）、整夹自动更新开关、**批量通道选择器**、全部更新、解绑。"
 *    ⇒ 这一组逐样点名，而且**头行是 `<summary>`**（折叠起来也点得到）。
 * ⚠️★ 两个下拉的**选项表都来自状态**（版本全集 = Ruling 58；镜像表 = Ruling 55）——
 *    这一组量的是"状态给什么就画什么"，而且**当前选中值**也来自状态
 *    （`prefs.catalogGameVersion` / `prefs.bulkChannel`，Ruling 23 的"一处记忆"）。
 * ⚠️ 能红它的刀（跑过的读数在报告里）：把 `<details>` 换成 `<div>`；把通道下拉的
 *    `value` 写死成 `'origin'`。
 */
const foldersHtml = foldersHtmlOf(stateOf([ROW_GITHUB], { folders: [FOLDER] }));
const folderBlock = folderBlockOf(foldersHtml, FOLDER_ID);
const folderHead = summaryOf(folderBlock);
assert.ok(
  foldersHtml.includes('<details'),
  '★ 文件夹子栏目必须是原生 <details> 折叠块（spec §6.8；闭着也在 DOM 里 ⇒ 自检看得见）',
);
assert.ok(
  textOf(folderHead).includes(textOf(FOLDER_PATH)),
  '★ 头行要显示路径（用户靠它认这是哪个目录 —— 一个页面上可能绑了好几个）',
);
assert.equal(
  selectsIn(folderHead).length,
  2,
  '★ 头行恰好两个下拉：游戏版本（可改）+ 批量通道选择器（spec §6.8）',
);
assert.deepEqual(
  selectsIn(folderHead)[0]?.values,
  ['', '1.16.1'],
  '★ 版本下拉 = 空取值（交回自动推断，`setFolderGameVersion(…, null)`）+ 状态里的版本全集（Ruling 58）',
);
assert.equal(
  selectsIn(folderHead)[0]?.selected,
  '1.16.1',
  '★ 选中的是**这个文件夹**的有效版本（`folder.gameVersion`，不是第一部分那个全局筛选）',
);
assert.deepEqual(
  selectsIn(folderHead)[1]?.values,
  ['origin', MIRROR.id],
  '★ 通道下拉 = `origin` + 状态里的镜像表（Ruling 55：目录配置只有一份）',
);
assert.equal(
  selectsIn(folderHead)[1]?.selected,
  'origin',
  '★ 选中的是状态里的 `bulkChannel`（一处记忆，Ruling 23）',
);
const autoBoxes = [...folderHead.matchAll(/<input type="checkbox"[^>]*>/g)];
assert.equal(autoBoxes.length, 1, '★ 头行恰好一个勾选框：整夹自动更新开关');
assert.ok(
  /\bchecked\b/.test(autoBoxes[0]?.[0] ?? ''),
  '★ 它跟着 `folder.autoUpdate` 走（夹具是 true ⇒ 勾上）',
);
assert.ok(
  /*
   * ⚠️ 比的是 `decode(…)` 之后的产物：英文那条词条里带**引号**（`Check "…" on launch`），
   *    而 React 在属性值里会把它转义成 `&quot;` —— 直接比原文会在**英文那一遍**红，
   *    而红点看起来像"可访问名里没有路径"（错的方向，§5.74 那一类）。
   */
  decode(folderHead).includes(t('files.autoLabel', { name: FOLDER_PATH })),
  '★ 勾选框的可访问名里带**路径**（那一排勾选框里哪一个是谁，读屏要分得开 —— 与 v1 的 autoLabel 同一条）',
);
assert.deepEqual(
  labelsIn(folderHead),
  [
    labelOf('files.folderUpdateAll', { count: 2 }),
    labelOf('files.folderRescan'),
    labelOf('files.unbind'),
  ],
  '★ 头行三颗按钮：全部更新（带条数 = `batchTargets(rows)`，夹具两行都可批量）/ 重扫这个文件夹 / 解除绑定 ' +
    '—— 一条不许少、也不许多',
);
/*
 * ★★ 通道下拉读的必须是**状态里那一格**：把 `bulkChannel` 换成镜像 id ⇒ 选中的跟着变。
 *    （写死 `'origin'` 的实现能过上面那条，过不了这一条。）
 * ⚠️ 顺带断言镜像那一格的文案**带着它认的主机**：一个通道在批量里打底 N 条，
 *    用户点之前就该看得出覆盖谁（`channelUrl` 只在主机匹配时给地址）。
 */
const mirrorChannelHtml = foldersHtmlOf(
  stateOf([ROW_GITHUB], { folders: [FOLDER], bulkChannel: { mirrorId: MIRROR.id } }),
);
const mirrorHead = summaryOf(folderBlockOf(mirrorChannelHtml, FOLDER_ID));
assert.equal(
  selectsIn(mirrorHead)[1]?.selected,
  MIRROR.id,
  '★★ 通道下拉读的是状态里的 `bulkChannel`（换成镜像 id ⇒ 它被选中）—— 写死 `origin` 会红在这里',
);
assert.ok(
  textOf(mirrorHead).includes(textOf(MIRROR.hosts[0] ?? '')),
  '★ 镜像那一格的文案要带上它认的主机（`hosts` 是目录内容，原样印）',
);
ok(
  '⑱ 文件夹 = `<details>`，头行（`<summary>`）含路径 / 版本可改 / 自动更新开关 / 批量通道 / 全部更新 / 重扫 / 解绑，且两个下拉的选项与选中值都来自状态',
);

// ---------------------------------------------------------------------------
// ⑲ 行内六样：文件名、mod 名、本地版本、官方版本、状态徽章、旧副本提示
// ---------------------------------------------------------------------------
/*
 * ⚠️★ spec §6.8 的"行内显示"那一条就是这六样。判据全部锚在**产物里的字**上
 *    （不锚字段名）：少哪一样用户就少一份读数。
 * ⚠️ 夹具的文件名里**没有版本号**（见上面 `folderRow` 的注释）：否则"本地版本那一格
 *    印了 0.1.2"会因为文件名里也有它而恒真 —— 那样这一条测不出"两格印对了没有"。
 */
const folderRow1161 = folderRowEl(folderBlock, 'sodium');
for (const [what, value] of [
  ['文件名', FROW_UPDATE.fileName],
  ['mod 名', FROW_UPDATE.name],
  ['本地版本', FROW_UPDATE.localVersion ?? ''],
  ['官方版本', SODIUM_NEW.version],
] as const) {
  assert.ok(
    textOf(folderRow1161).includes(textOf(value)),
    `★ 行内要印${what}（${value}）—— spec §6.8 那六样之一`,
  );
}
assert.ok(
  textOf(folderRow1161).includes(textOf(resolved('files.outdated'))),
  '★ 状态徽章：`older` 那一支要印「可更新」（文字承载语义，颜色只是加强）',
);
assert.ok(
  textOf(folderRow1161).includes(textOf(resolved('files.targetSource.catalog'))),
  '★ 官方版本那一格要标来源（Ruling 13：有上游目标时它不在 candidates 里，不许靠推断）',
);
assert.ok(
  textOf(folderRow1161).includes(textOf(FROW_UPDATE.oldCopies[0] ?? '')),
  '★ 旧副本提示要**点名**是哪几个文件（只说"另有 1 份"的话，用户不知道要没的是谁）',
);
assert.ok(
  textOf(folderRow1161).includes(
    textOf(
      resolved('files.folderOldCopies', {
        count: FROW_UPDATE.oldCopies.length,
        names: FROW_UPDATE.oldCopies.join(', '),
      }),
    ),
  ),
  '★ 旧副本那一句的**整句**（含条数）—— 这一句是 D9.1"更新时会清掉它们"在界面上的唯一提示',
);
/*
 * ★★ spec §4 D9.1 明写"**按钮文案写明后果**"（收口波补）：只说"另有 N 份旧副本"
 *   是在描述现状，没说**更新会把它们删掉** ⇒ 用户点更新之前不知道盘上会少文件。
 *   ⚠️ 这条断言的是**后果那一句的整句**（独立词条 `folderOldCopiesDeleted`）：
 *   把那一行渲染删掉、或把词条删了，它当场红（拿"有旧副本那几个字"当判据会恒真）。
 */
assert.ok(
  textOf(folderRow1161).includes(textOf(resolved('files.folderOldCopiesDeleted'))),
  '★★ 旧副本提示必须写出**后果**（D9.1：更新会把这些文件一起删掉，新文件验签就位之后才删）',
);
ok('⑲ 行内六样都在（文件名 / mod 名 / 本地版本 / 官方版本 / 状态徽章 / 旧副本提示）+ 来源标注');

// ---------------------------------------------------------------------------
// ⑳ 行内那两颗更新按钮：各送自己那条通道；批量进行中**禁用**（不是消失）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 通道的判据与第一部分**逐字相同**（同一份 `mirrorsForUrl`）：目标在 GitHub ⇒
 *    两颗（原始 / 镜像）；目标在 `cdn.modrinth.com` ⇒ 只有原始那一颗（D5）。
 * ⚠️★★ 第二半是 brief 点的那条**v1 的 busy 语义**：批量跑起来时主进程只接受一条写
 *    （`assertNotBusy`）⇒ 行内按钮必须**禁用**。这一组**两个方向都断言**：
 *      · `busy: true` ⇒ 每一颗都 `disabled`（而且按钮**没消失**，数量不变）；
 *      · `busy: false` ⇒ 一颗都不 `disabled`。
 *    ⚠️ 反面那一半是**承重的**：只断言"busy 时禁用"的话，`disabled` 恒真的实现照样绿
 *    —— 而那样这个功能在界面上就没有出路了（Step 4 那把刀砍的正是这一半）。
 */
assert.deepEqual(
  labelsIn(folderRow1161),
  [labelOf('files.updateOrigin'), labelOf('files.updateMirror')],
  '★ GitHub 来源的可更新行有两颗更新按钮（原始 + 镜像，D5/D6）',
);
assert.deepEqual(
  labelsIn(folderRowEl(folderBlock, 'lithium')),
  [labelOf('files.updateOrigin')],
  '★ 目标在 `cdn.modrinth.com` ⇒ 只有原始那一颗（镜像的主机判据住在 `mirrorsFor`）',
);
const busyFoldersHtml = foldersHtmlOf(stateOf([ROW_GITHUB], { folders: [FOLDER], busy: true }));
const busyFolderRow = folderRowEl(folderBlockOf(busyFoldersHtml, FOLDER_ID), 'sodium');
assert.equal(
  buttonsIn(busyFolderRow).length,
  2,
  '★ 正在写盘时按钮是**禁用**、不是消失（两颗都还在）',
);
assert.equal(
  buttonsIn(busyFolderRow).every((button) => button.disabled),
  true,
  '★★ 批量进行中：行内更新按钮全禁用（主进程一次只写一个文件，点了必吃一句红字）',
);
assert.equal(
  buttonsIn(folderRow1161).every((button) => button.disabled),
  false,
  '★★ 反面：不在写盘时一颗都不许禁用（禁用过头 = 这个功能没有出路）—— 上面那条的对照组',
);
ok(
  '⑳ 行内两颗更新按钮（通道由状态里的镜像表决定：GitHub 两颗 / CDN 一颗）+ `busy` 时全禁用、不忙时全可用',
);

// ---------------------------------------------------------------------------
// ㉑ 五档"不给更新按钮" + 「全部更新」自己那三档（一条必被拒的按钮都不许画）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ Ruling 47/48 的同一族：主进程会拒的一律不画。逐档点名（每档都对着
 *    `assertUpdatable` / `assertNotManual` / `updateMod` 里那句"没有目标"）：
 *      · `manual`（OptiFine）：连更新按钮都不给；
 *      · `newer`（只升不降）：只解释；
 *      · `missing-release`（**第二部分才可达**）：只解释；
 *      · `ambiguous`（两个候选）：列出全部候选 + 解释，不给按钮；
 *      · `unknown-version`（整个文件夹）：头行说一次 + 一行按钮都没有。
 *    ⚠️ 每一档都断言**两件事**：没有更新按钮、而且**有自己的解释**（只断言"没有按钮"
 *    的话，"这一列永远不画东西"照样能过 —— 那是 §5.32 的第一类空跑）。
 * ⚠️★ 而 `different-build` **不在**这份名单里（收口波）：它是"要人显式点一下"的那一支，
 *    `assertUpdatable` 放行它 ⇒ 它有更新按钮（见下面那一段正面断言）。
 */
for (const [what, row, hintKey] of [
  ['manual（OptiFine）', FROW_MANUAL, 'files.hintManual'],
  ['newer（只升不降）', FROW_NEWER, 'files.hintNewer'],
  ['missing-release（这一版清单里没有它）', FROW_NO_RELEASE, 'files.hintMissingRelease'],
  ['ambiguous（两个候选）', FROW_AMBIGUOUS, 'files.hintAmbiguous'],
] as const) {
  const html = foldersHtmlOf(
    stateOf([ROW_GITHUB], { folders: [folder({ folderId: 'f-one', rows: [row] })] }),
  );
  const rowHtml = folderRowEl(folderBlockOf(html, 'f-one'), row.modid);
  assert.deepEqual(
    buttonsIn(rowHtml).filter(
      (button) =>
        button.label === labelOf('files.updateOrigin') ||
        button.label === labelOf('files.updateMirror'),
    ),
    [],
    `★ ${what} 那一行**不许**有更新按钮（主进程会拒 —— Ruling 47/48）`,
  );
  assert.ok(
    textOf(rowHtml).includes(textOf(resolved(hintKey))),
    `★ ${what} 那一行要有**自己的**解释（${hintKey}）—— 只解释不画按钮，用户才知道为什么`,
  );
}
/*
 * ★★ 收口波：`different-build` 在**第二部分**也必须有更新入口（与第一部分同一条判据）。
 *   ⚠️ 夹具的 `batchable: false` 是承重的：一个"按 `batchable` 给按钮"的实现在这里会红
 *   （而那一版正是这个缺陷本身 —— `lastRun.skipped` 说"要人显式点一下这一条"，
 *   页面上却没有那颗按钮）。目标挂 `GITHUB_URL` ⇒ 镜像那颗也该在。
 */
const diffBuildFolderHtml = foldersHtmlOf(
  stateOf([ROW_GITHUB], {
    folders: [folder({ folderId: 'f-diff', rows: [FROW_DIFFERENT_BUILD] })],
  }),
);
const diffBuildFolderRow = folderRowEl(
  folderBlockOf(diffBuildFolderHtml, 'f-diff'),
  FROW_DIFFERENT_BUILD.modid,
);
assert.deepEqual(
  buttonsIn(diffBuildFolderRow).map((button) => button.label),
  [labelOf('files.updateOrigin'), labelOf('files.updateMirror')],
  '★★ `different-build` 的行**必须**有那两颗更新按钮（`assertUpdatable` 放行它、' +
    'spec §8 要人显式点一下；而 `batchable` 是 false ⇒ 判据不能是 batchable）',
);
assert.ok(
  textOf(diffBuildFolderRow).includes(textOf(resolved('files.hintDifferentBuild'))),
  '★ 而且它那句解释要说清那颗按钮做什么（第二部分与第一部分共用 `VERDICT_HINTS`）',
);
/*
 * ★★ 多候选那一行：把**每一个**候选都列出来（与第一部分逐字相同）。
 *    ⚠️ 判据是"两个候选的版本号都在"，而不是"有一个列表"——空列表也能过后者。
 */
const ambiguousFolderRow = folderRowEl(
  folderBlockOf(
    foldersHtmlOf(
      stateOf([ROW_GITHUB], {
        folders: [folder({ folderId: 'f-amb', rows: [FROW_AMBIGUOUS] })],
      }),
    ),
    'f-amb',
  ),
  FROW_AMBIGUOUS.modid,
);
for (const candidate of FROW_AMBIGUOUS.candidates) {
  assert.ok(
    textOf(ambiguousFolderRow).includes(textOf(candidate.version)),
    `★ 多候选那一行要列出**每一个**候选的版本号（少了 ${candidate.version} 就是让用户以为只有一条）`,
  );
}
/*
 * ★★ 版本未知那一个文件夹：头行说一次「先给它选一个版本」，而行内**一个按钮都没有**。
 *    ⚠️ 头行那两颗（重扫 + 解绑）**照常在**：那一档的出路正是"选版本 / 重扫 / 解绑"。
 */
const unknownFolderHtml = foldersHtmlOf(
  stateOf([ROW_GITHUB], {
    folders: [folder({ folderId: 'f-unknown', gameVersion: null, rows: [FROW_UNKNOWN_VERSION] })],
  }),
);
const unknownFolderBlock = folderBlockOf(unknownFolderHtml, 'f-unknown');
assert.ok(
  textOf(summaryOf(unknownFolderBlock)).includes(textOf(resolved('files.folderGameVersionHint'))),
  '★ 版本未知要在**头行**说清"先给它选一个游戏版本"（否则用户看到一整列都不给按钮，不知道为什么）',
);
assert.equal(
  buttonsIn(folderRowEl(unknownFolderBlock, FROW_UNKNOWN_VERSION.modid)).length,
  0,
  '★★ 版本未知 ⇒ 行内一个按钮都没有（`unknown-version` 不给更新，spec §8）',
);
assert.deepEqual(
  labelsIn(summaryOf(unknownFolderBlock)),
  [labelOf('files.folderRescan'), labelOf('files.unbind')],
  '★★ 版本未知 ⇒ 头行**不画**「全部更新」（`updateFolderAll` 在那句"游戏版本还不知道 ⇒ 不给更新"上会拒），' +
    '而重扫与解绑照常在（那一档的出路）',
);
/*
 * ★★ 路径不存在那一个：头行一个徽章 + 一句解释 + 只有「解除绑定」。
 *    ⚠️★ 重扫**不画**：`rescan` 对一个被移走的目录只会把读数再删一次 ——
 *    `missingStatus === 'folder-missing'` 那句注释写着同一件事（不许给人错的动作）。
 */
const goneFolderHtml = foldersHtmlOf(stateOf([ROW_GITHUB], { folders: [FOLDER_GONE] }));
const goneFolderBlock = folderBlockOf(goneFolderHtml, GONE_FOLDER_ID);
assert.ok(
  textOf(summaryOf(goneFolderBlock)).includes(textOf(resolved('files.folderPathMissing'))),
  '★ 路径不存在要在头行看得见（一个徽章，spec §8）',
);
assert.deepEqual(
  labelsIn(summaryOf(goneFolderBlock)),
  [labelOf('files.unbind')],
  '★★ 路径不存在 ⇒ 头行只有「解除绑定」：不给任何更新动作，**也不给重扫**（它修不好一个被移走的目录）',
);
assert.ok(
  textOf(summaryOf(goneFolderBlock)).includes(textOf(resolved('files.folderPathMissingHint'))),
  '★ 而且那两句解释（路径不存在 / 版本未知）挂在**头行**里：头行是永远看得见的那一行，' +
    '折叠着的用户也得看得到"为什么这一列都没有按钮"与出路',
);
ok(
  '㉑ 五档不给更新按钮（manual / newer / missing-release / ambiguous / 版本未知）+ 路径不存在只留解绑；多候选列出全部候选；每档都有解释',
);

// ---------------------------------------------------------------------------
// ㉒ 三处空态：一个文件夹都没绑 / 路径不存在 / 这个文件夹里一个能识别的 mod 都没有
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 三处必须**分得开**（brief 点名的那三条）：
 *   · 没绑 ⇒ 一句"还没有绑定" + **这一期唯一的绑定入口**；
 *   · 路径不存在 ⇒ 那一档的话（且**不许**说"里面没有 mod"—— 我们根本没读到它）；
 *   · 目录读到了、但 rows 为空 ⇒ "没有能识别的 mod" + 单列"无法识别 / 清单外"那些文件。
 */
const noFolderHtml = foldersHtmlOf(stateOf([ROW_GITHUB], { folders: [] }));
assert.ok(
  textOf(noFolderHtml).includes(textOf(resolved('files.folderNone'))),
  '★ 空态①：一个文件夹都没绑要有一句话（空 div = 用户分不出"没有"与"没渲染"）',
);
assert.deepEqual(
  labelsIn(noFolderHtml),
  [labelOf('files.bindFolder')],
  '★ 而且它同时是这一期**唯一**的绑定入口（v1 那条同名通道是老语义，spec §6.7）',
);
const noModsFolder = folder({
  folderId: 'f-empty',
  rows: [],
  unrecognized: [
    { fileName: 'not-a-mod.txt', reason: 'no-fabric-meta' },
    { fileName: 'stranger.jar', reason: 'not-in-catalog' },
  ],
});
const noModsHtml = foldersHtmlOf(stateOf([ROW_GITHUB], { folders: [noModsFolder] }));
assert.ok(
  textOf(noModsHtml).includes(textOf(resolved('files.folderNoRows'))),
  '★ 空态③：一个能识别的 mod 都没有（要说出来，不能是空白块）',
);
assert.ok(
  textOf(noModsHtml).includes(
    textOf(resolved('files.folderUnrecognizedNoMeta', { name: 'not-a-mod.txt' })),
  ),
  '★ 读不出 `fabric.mod.json` 的要单列（spec §8：不参与更新，但要看得出扫到了它）',
);
assert.ok(
  textOf(noModsHtml).includes(
    textOf(resolved('files.folderUnrecognizedNotInCatalog', { name: 'stranger.jar' })),
  ),
  '★ "清单外"要单列，而且与上一条是**两句不同的话**（合成一句就把线索删掉了）',
);
assert.equal(
  textOf(goneFolderBlock).includes(textOf(resolved('files.folderNoRows'))),
  false,
  '★ 反面：路径不存在时**不许**印"这个文件夹里没有能识别的 mod" —— ' +
    '我们根本没读到它，那句话是编出来的结论（头行那句 folderPathMissingHint 才是真的）',
);
ok(
  '㉒ 三处空态分得开：没绑（+ 绑定入口）/ 路径不存在（且不冒充"里面没有"）/ 目录里没有可识别的 mod（含"无法识别"两类）',
);

// ---------------------------------------------------------------------------
// ㉓ 底部缺失清单：每行一个「下载到」，选项**只**列版本对得上、路径还在的文件夹
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 这一组是 hand-off 第 2 条的落点：`downloadMissing` 在"目标文件夹的有效版本 ≠
 *    入参版本"时**拒**（还有"路径不是目录"也拒）⇒ 选项表少一层过滤，用户点下去
 *    就是一串必吃的红字。夹具里刻意放了**四种**文件夹：版本对得上且路径在（该出现）、
 *    另一个版本（不该出现）、版本对得上但路径不在（不该出现）、路径在但版本未知
 *    （不该出现）—— 一条判据砍四个方向。
 * ⚠️★ 第三条闸（"这个文件夹还没有扫描读数"）**不在这一层**：桌面版 0.0.5 起
 *    `ModFolderView.hasReading` 就是那一格（Ruling 65），而这一层只拿 `folder` 的
 *    `pathExists` / `gameVersion` 两个字段做过滤；`missingStatus === 'ok'`
 *    （"每个已绑定文件夹都有成功读数"）仍然决定**清单画不画**（见
 *    `MissingModsList.tsx` 的文件头）—— ㉔ 断言"另外三档不画清单"就是它的守门人。
 *    ⚠️ 旧注释写的是"状态里没有那一格"（Ruling 66② 记的那处注释腐坏），已改准。
 * ⚠️ 一个能装它的文件夹都没有时：**一个控件都不画**（那颗下载必被拒），只留一句解释。
 */
const missingState = stateOf([ROW_GITHUB], {
  folders: [FOLDER, FOLDER_OLD, FOLDER_GONE, FOLDER_NO_VERSION],
  missing: [MISSING_1161, MISSING_1710],
  missingStatus: 'ok',
});
const missingListHtml = missingHtmlOf(missingState);
assert.ok(
  missingListHtml.includes('data-missing-rows="2"'),
  '★ `missingStatus === "ok"` ⇒ 两行缺失都画出来（读数在 data-missing-rows 上）',
);
const missingRow1161 = missingRowEl(missingListHtml, MISSING_1161.modid);
assert.equal(selectsIn(missingRow1161).length, 1, '★ 每一行恰好一个「下载到」下拉（spec §7.5）');
assert.deepEqual(
  selectsIn(missingRow1161)[0]?.values,
  [FOLDER_ID],
  '★★ 选项 = **游戏版本对得上、而且路径还在**的文件夹 —— ' +
    '那个 1.7.10 的、路径不在的、版本未知的都不许出现（主进程那两条闸）',
);
assert.equal(
  selectsIn(missingRow1161)[0]?.selected,
  FOLDER_ID,
  '★ 默认选第一个可用的（用户不选也能直接点「下载」）',
);
assert.ok(
  /* ⚠️ 同上：英文那条带引号、属性里被转义 ⇒ 比 `decode(…)` 之后的产物。 */
  decode(missingRow1161).includes(t('files.missingDownloadToLabel', { name: MISSING_1161.name })),
  '★ 下拉的可访问名带 mod 名（那一列每一行都长得一样，读屏要分得开）',
);
/*
 * ★★ 两颗下载按钮（**Ruling 62②**，2026-10-03 T8 评审判修）：`MissingModView.release`
 *    让页面能**证明**镜像适不适用 ⇒ 这一行的 release 挂 GitHub ⇒ 两颗都在。
 *    ⚠️ 判据是**逐颗点名**（不是"至少一颗"）：第二颗只在证得了的时候出现，
 *    而那件事由下面那行 CDN 的对照（只有一颗）夹住。
 */
assert.deepEqual(
  labelsIn(missingRow1161),
  [labelOf('files.missingDownloadOrigin'), labelOf('files.missingDownloadMirror')],
  '★★ 非 manual 的行有**两颗**下载按钮（原始 + 镜像）—— `release` 挂 GitHub ⇒ 镜像适用；' +
    '两颗都是"写盘要一次点击"（一个只靠 onChange 触发的下拉既不能重选同一个、也没有确认）',
);
assert.deepEqual(
  selectsIn(missingRowEl(missingListHtml, MISSING_1710.modid))[0]?.values,
  [FOLDER_OLD_ID],
  '★★ 另一个版本的行只列出**那个版本**的文件夹（同一份判据、两个方向都断言）',
);
assert.deepEqual(
  labelsIn(missingRowEl(missingListHtml, MISSING_1710.modid)),
  [labelOf('files.missingDownloadOrigin')],
  '★★ 而那一条的 release 挂 `cdn.modrinth.com` ⇒ **只有原始那一颗**（D5：镜像的主机判据）',
);
/*
 * ★★ 一个可用的文件夹都没有：不画下拉、不画按钮、只留一句解释。
 *    ⚠️ 这是"不给一颗必被拒的按钮"的直接落点：`downloadMissing` 对着一个不是目录的
 *    路径会拒，对着版本对不上的文件夹也会拒。
 */
const noEligibleHtml = missingHtmlOf(
  stateOf([ROW_GITHUB], {
    folders: [FOLDER_GONE],
    missing: [MISSING_1161],
    missingStatus: 'ok',
  }),
);
const noEligibleRow = missingRowEl(noEligibleHtml, MISSING_1161.modid);
assert.equal(
  selectsIn(noEligibleRow).length,
  0,
  '★★ 没有能装它的文件夹 ⇒ **不画**那个下拉（一个空下拉 = 点了没反应）',
);
assert.equal(
  buttonsIn(noEligibleRow).length,
  0,
  '★★ 也不画那颗「下载」（主进程会以"路径不是目录 / 版本对不上"拒 —— Ruling 47/48）',
);
assert.ok(
  textOf(noEligibleRow).includes(
    textOf(resolved('files.missingNoFolder', { version: MISSING_1161.gameVersion })),
  ),
  '★ 而要说明为什么（需要一个这一版、路径还在的已绑定文件夹）',
);
/*
 * ★ 只读（没有动作层）⇒ 那一格一个控件都不画（与两张表里那两颗按钮同一条闸）。
 * ★ 正在写盘 ⇒ 那颗「下载」必须禁用：`downloadMissing` 第一句就是 `assertNotBusy()`。
 */
const readOnlyMissingRow = missingRowEl(
  missingHtmlOf(missingState, { handlers: null }),
  MISSING_1161.modid,
);
assert.equal(
  selectsIn(readOnlyMissingRow).length + buttonsIn(readOnlyMissingRow).length,
  0,
  '★ 没有动作层（只读）⇒ 那一格一个控件都不画（点不动的控件比没有控件更糟）',
);
const busyMissingHtml = missingHtmlOf(
  stateOf([ROW_GITHUB], {
    folders: [FOLDER],
    missing: [MISSING_1161],
    missingStatus: 'ok',
    busy: true,
  }),
);
const busyMissingRow = missingRowEl(busyMissingHtml, MISSING_1161.modid);
/*
 * ⚠️★ **长度锚不能省**（2026-10-03 T8 评审的 Minor 1）：`.every()` 在**空数组**上是
 *    `true` ⇒ 只写"每一颗都禁用"的话，"busy 时把按钮藏起来"那一刀照样绿。
 *    ⇒ 先钉"两颗都还在"，再钉"两颗都禁用"。
 */
assert.deepEqual(
  labelsIn(busyMissingRow),
  [labelOf('files.missingDownloadOrigin'), labelOf('files.missingDownloadMirror')],
  '★★ `busy` 时按钮是**禁用**、不是消失（长度锚：`every()` 对空数组恒真）',
);
assert.equal(
  buttonsIn(busyMissingRow).every((button) => button.disabled),
  true,
  '★★ 正在写盘时两颗「下载」都必须禁用（`downloadMissing` 第一句是 `assertNotBusy()`）',
);
ok(
  '㉓ 缺失清单每行一个「下载到」：选项只含版本匹配且路径还在的文件夹、两颗下载按钮各送自己那条通道、没有可用文件夹时一个控件都不画（+ 只读 / busy 两道闸）',
);

// ---------------------------------------------------------------------------
// ㉔ `missingStatus` 四档：只有 `'ok'` 画清单，另外三档各说各的
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 判修 2：`missing: []` 的**两种**原因（真的没有 / 我们还不知道）在数据上分不开
 *    ⇒ 界面靠 `missingStatus` 分。这一组逐档断言：
 *      · 那一档**自己那句**在（三句互不串：每一条都断言另外两句不在）；
 *      · 清单**不画**（`data-missing-rows` 不出现、一个下拉都没有）；
 *      · `'ok'` + 一条都不缺 ⇒ "没有缺的"（那是结论，不是"被压住"）。
 * ⚠️★★ `folder-missing` 那一句**不许出现"重扫"**：`rescan` 修不好一个被移走的目录，
 *    叫人去点它就是给错动作（文件头那段注释与主进程那句同源）。判据用的是
 *    **那两个字本身**（两种语言各一份）—— 比"与另一句不同"更强：把 "点一次重扫"
 *    塞进那一句里，只有这一条会出声。
 */
for (const [status, key] of [
  ['folder-unscanned', 'files.missingStatusFolderUnscanned'],
  ['folder-missing', 'files.missingStatusFolderMissing'],
  ['catalog-unavailable', 'files.missingStatusCatalogUnavailable'],
] as const) {
  const html = missingHtmlOf(
    stateOf([ROW_GITHUB], { folders: [FOLDER], missing: [], missingStatus: status }),
  );
  assert.ok(
    textOf(html).includes(textOf(resolved(key))),
    `★ \`${status}\` 要有**自己**那一句（${key}）—— 清单空着的原因不许共用一句话`,
  );
  assert.ok(
    html.includes(`data-missing-status="${status}"`),
    `★ 那一档要说得出自己是哪一档（data-missing-status）`,
  );
  assert.equal(
    html.includes('data-missing-rows'),
    false,
    `★★ \`${status}\` ⇒ **不画**清单（缺什么我们还不知道 —— 列错一串比空着更坏）`,
  );
  assert.equal(selectsIn(html).length, 0, `★ 也不画任何「下载到」下拉（没有清单就没有下载入口）`);
}
const unscannedNote = textOf(
  missingHtmlOf(stateOf([ROW_GITHUB], { folders: [FOLDER], missingStatus: 'folder-unscanned' })),
);
const missingPathNote = textOf(
  missingHtmlOf(stateOf([ROW_GITHUB], { folders: [FOLDER], missingStatus: 'folder-missing' })),
);
const catalogGoneNote = textOf(
  missingHtmlOf(stateOf([ROW_GITHUB], { folders: [FOLDER], missingStatus: 'catalog-unavailable' })),
);
assert.equal(
  missingPathNote.includes(textOf(resolved('files.missingStatusFolderUnscanned'))),
  false,
  '★ 三档的说法互不串（`folder-missing` 里不许出现 `folder-unscanned` 那一句）',
);
assert.equal(
  unscannedNote.includes(textOf(resolved('files.missingStatusFolderMissing'))),
  false,
  '★ 反方向也不许串（两句话说的是两件不同的事、两条不同的出路）',
);
assert.equal(
  catalogGoneNote.includes(textOf(resolved('files.missingStatusFolderUnscanned'))),
  false,
  '★ 目录不可用与"文件夹还没扫过"也是两句不同的话（修法不同）',
);
/*
 * ⚠️★ 判据是**那两个字本身**（两种语言各一个正则），不是"与另一句不同"：
 *    把 "点一次重扫" 塞进那一句里，只有这一条会出声。
 * ⚠️ 英文那一遍用**词**而不是裸串：第一版写的是 `'escan'`，而它恰好是
 *    `…its files cannot be read…` 里 `fil`**escan**`not` 的子串 —— 于是这一条在
 *    **正确**的文案上报红（`docs/pending.md §5.79` 那一族：探针自己错，长得像产品缺陷）。
 */
const rescanNeedle = LANG === 'en' ? /rescan/i : /重扫/;
assert.equal(
  rescanNeedle.test(missingPathNote),
  false,
  '★★ `folder-missing` 那一句里**连"重扫"两个字都不许有**：rescan 修不好一个被移走的目录，' +
    '叫用户去点它就是给错动作（这是这一档唯一的不同之处）',
);
const okEmptyHtml = missingHtmlOf(
  stateOf([ROW_GITHUB], { folders: [FOLDER], missing: [], missingStatus: 'ok' }),
);
assert.ok(
  textOf(okEmptyHtml).includes(textOf(resolved('files.missingNone'))),
  '★ `ok` + 一条都不缺 ⇒ 说"没有缺的"（那是**结论**，不是"被压住"）',
);
assert.equal(
  okEmptyHtml.includes('data-missing-rows'),
  false,
  '★ 而那时也没有清单可画（0 行的表是空壳）',
);
ok(
  '㉔ `missingStatus` 四档分得开：只有 `ok` 画清单，另外三档各有各的说明（`folder-missing` 那句里没有"重扫"）',
);

// ---------------------------------------------------------------------------
// ㉕ 特性检测 + 三块拼装 + 迁移提示（§6.8 / §13.1）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 这一组是**唯一**能一次看到"三块同时在页面上"的地方（`Files` 的 ready 支路要等
 *    IPC 回包，静态渲染跑不到）⇒ 两件事都落在这一份产物上：
 *      ① 三块真的拼在一起（三个标题 + 第二块的文件夹 + 第三块那一行）；
 *      ② §13.1 那句迁移提示（`notices`，渲染点在第一块）与它们**同屏可见**
 *         —— 迁移"不许静默"，而"看得见"的判据只能是"它在这一页的产物里"。
 * ⚠️★ 特性检测那两刀（0.0.4 的壳与纯浏览器）真的渲染 `Files`：两种壳都该看到
 *    "需要桌面版 0.0.5"，而 **v1 那条路照常**（第一帧还是它自己的加载态）。
 */
const partsState = stateOf([ROW_GITHUB], {
  folders: [FOLDER],
  missing: [MISSING_1161],
  missingStatus: 'ok',
  notices: [NOTE],
});
const partsHtml = partsHtmlOf(partsState);
for (const key of ['files.partOneTitle', 'files.partTwoTitle', 'files.partThreeTitle'] as const) {
  assert.ok(
    textOf(partsHtml).includes(textOf(resolved(key))),
    `★ 三块要同时在页面上（这一块缺了：${key}）—— 顺序即 spec §6.8 的三块`,
  );
}
assert.ok(
  textOf(partsHtml).includes(textOf(NOTE)),
  '★★ `notices`（迁移提示"已转为文件夹跟踪：…"）必须与第二、三块**在同一份产物里**：' +
    '§13.1 要求它看得见，而它的渲染点在第一块 —— 三块分开渲染就证不出"同屏"',
);
assert.ok(
  textOf(partsHtml).includes(textOf(FOLDER_PATH)) &&
    textOf(partsHtml).includes(textOf(MISSING_1161.name)),
  '★ 而且第二块那个文件夹与第三块那一行都真的在里面（不是只渲染了三个标题）',
);
/* —— 0.0.4 的壳：有 `mcsr`、没有 `modFolders` —— */
Object.assign(globalThis, { mcsr: shellStub(false) });
const oldShellHtml = keep(
  html(React.createElement(MemoryRouter, null, React.createElement(Files, null))),
);
delete (globalThis as { mcsr?: unknown }).mcsr;
assert.ok(
  textOf(oldShellHtml).includes(textOf(resolved('files.partTwoUnavailable'))),
  '★★ 特性检测：`window.mcsr?.modFolders` 不存在 ⇒ 第二部分显示"需要桌面版 0.0.5"（spec §6.8/§8）',
);
assert.ok(
  textOf(oldShellHtml).includes(textOf(resolved('common.loading'))),
  '★★ 而**第一部分与 v1 照常**：0.0.4 的壳走的是 v1 那条路（第一帧是它自己的加载态，不是新通道那一屏）',
);
assert.equal(
  textOf(oldShellHtml).includes(textOf(resolved('files.catalogScanning'))),
  false,
  '★ 反面：0.0.4 的壳**不许**走上新通道那一屏（那会让"没有 modFolders"看起来像"正在扫描"）',
);
assert.equal(
  textOf(oldShellHtml).includes(textOf(resolved('files.browserOnly'))),
  false,
  '★ 0.0.4 是**桌面壳**：那句"本地文件只在桌面版里"不该出现（它是浏览器态的话）',
);
/* —— 纯浏览器：连 `mcsr` 都没有 —— */
const browserHtml = keep(
  html(React.createElement(MemoryRouter, null, React.createElement(Files, null))),
);
assert.ok(
  textOf(browserHtml).includes(textOf(resolved('files.partTwoUnavailable'))) &&
    textOf(browserHtml).includes(textOf(resolved('files.browserOnly'))),
  '★ 纯浏览器同理：那一栏说清"需要桌面版 0.0.5"，而"本地文件只在桌面版里"那句照常（两句说的是两件事）',
);
assert.equal(
  (globalThis as { mcsr?: unknown }).mcsr,
  undefined,
  '★ 两个桩都必须已经删掉（否则后面任何一组都会在"桌面壳"那一支上渲染）',
);
/*
 * ⚠️★ 这里原先有一条 `ModFoldersUnavailable !== undefined && ModFoldersPanel !== undefined`
 *    （T8 第一版）—— 2026-10-03 评审判为 **Minor 2**：它**恒真**（ESM 的具名导入不可能
 *    是 `undefined`：要么是一个组件、要么在 import 那一刻就报错）⇒ 一条什么都不测的守卫。
 *    ⚠️ 我试过把它换成"单独渲染那一块、断言它那句话"，然后又**删掉了**：同组上面那条
 *    （通过 `Files` 的降级支路渲染）说的是同一件事，而 `assert` 在第一条失败处中断
 *    ⇒ 新加的那条**永远不可能是第一个红的**，等于换了个样子的恒真（§5.32 的第一类）。
 *    ⇒ 正确处置是**删掉**（评审判词的第一个选项）："那一块被挂上去了"由上面那条页面
 *    渲染 + ㉗ 的 `<ModFoldersUnavailable />` 源码守卫钉着，两处都不是恒真。
 *    ⇒ 顺手把那个未使用的 import 也删了（留着 biome 会红）。
 */
ok(
  '㉕ 三块同屏（含第一块里那句迁移提示）+ 特性检测：0.0.4 与纯浏览器都看到"需要桌面版 0.0.5"而 v1 那条路照常',
);

// ---------------------------------------------------------------------------
// ㉘ ★★ Critical：`manual` 的缺失行**一颗下载都不给**（只给"打开原网页"）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 这是 2026-10-03 T8 评审的 **Critical** 的落点：`missingMods` 只按"候选唯一 +
 *    没被跟踪"筛，**不跳 manual**（实测 1.7.10 下的 `optifine` / `optifine-light`
 *    就是这种行），而 `downloadMissing` 的 `assertNotManual` **必拒** ⇒
 *    给它们画一颗「下载」就是画一颗**注定被拒**的按钮（Ruling 47/48）。
 * ⚠️★ 判据全部锚在产物上：那一行**没有按钮、没有下拉**、有的是 `hintManual` 那一句
 *    与一条指向 `release.url` 的链接。⚠️ 同一份产物里还放了一条**非** manual 的行
 *    当对照 —— 没有它的话，"这一列永远不画东西"照样能过（§5.32 的第一类）。
 */
const manualMissingHtml = missingHtmlOf(
  stateOf([ROW_GITHUB], {
    folders: [FOLDER],
    missing: [MISSING_MANUAL, MISSING_1161],
    missingStatus: 'ok',
  }),
);
const manualMissingRow = missingRowEl(manualMissingHtml, MISSING_MANUAL.modid);
assert.equal(
  buttonsIn(manualMissingRow).length,
  0,
  '★★ `manual` 的缺失行**一个按钮都没有**（`downloadMissing` 的 `assertNotManual` 必拒 —— ' +
    '包括那两颗「下载」）',
);
assert.equal(
  selectsIn(manualMissingRow).length,
  0,
  '★ 也没有「下载到」那个下拉（没有可点的下载，选一个文件夹没有意义）',
);
assert.deepEqual(
  linksIn(manualMissingRow).map((link) => link.href),
  [OPTIFINE.url],
  '★ 而要给「打开原网页」：那是这一行**唯一**的出路（与第一部分那张表的 manual 行同形）',
);
assert.ok(
  textOf(manualMissingRow).includes(textOf(resolved('files.hintManual'))),
  '★ 还要说清为什么（`files.hintManual`：「这一条只能到原网页手动下载」）',
);
/* 对照组：同一份产物里，非 manual 的那一行**照常有**两颗按钮。 */
assert.deepEqual(
  labelsIn(missingRowEl(manualMissingHtml, MISSING_1161.modid)),
  [labelOf('files.missingDownloadOrigin'), labelOf('files.missingDownloadMirror')],
  '★ 反面：同一份产物里非 manual 的那一行**照常**有那两颗（上面"一个按钮都没有"因此不是空跑）',
);
ok(
  '㉘ Critical：`manual` 的缺失行不给下载控件、只给「打开原网页」+ 解释（同屏的非 manual 行照常有两颗）',
);

// ---------------------------------------------------------------------------
// ㉙ ★★ Ruling 64：**过期的持久化值不许被当成新动作发出去**
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 两格各有各的现场（都是"目录换过之后，本机存下来的那个选择过期了"）：
 *   · `prefs.bulkChannel` 指向一个**已经不在镜像表里**的 id：它照画（用户看得见状态漂了），
 *     但「全部更新」**不许照发** —— `requireChannel` 会抛，用户得到一次什么都没做的点击；
 *   · `folders[].gameVersion` 指向一个**已经不在目录里**的版本：它照画，但必须是
 *     `disabled` 的（`requireGameVersion` 会拒）。
 * ⚠️★ 两件事的差别在产物里**只有** `disabled` 这一个字符与"那颗按钮在不在"，
 *    所以两条判据都必须落到这两处（不能只断言"渲染出来了"）。
 */
const staleChannelId = 'gh-proxy-GONE';
const staleChannelHtml = foldersHtmlOf(
  stateOf([ROW_GITHUB], { folders: [FOLDER], bulkChannel: { mirrorId: staleChannelId } }),
);
const staleChannelHead = summaryOf(folderBlockOf(staleChannelHtml, FOLDER_ID));
assert.ok(
  selectsIn(staleChannelHead)[1]?.values.includes(staleChannelId) &&
    selectsIn(staleChannelHead)[1]?.selected === staleChannelId,
  '★★ 过期通道**照画而且被选中**（否则 `<select value=X>` 里没有 X 时浏览器会静默选中第一个 —— 那一屏在撒谎）',
);
assert.deepEqual(
  labelsIn(staleChannelHead),
  [labelOf('files.folderRescan'), labelOf('files.unbind')],
  '★★★ 但「全部更新」**不画**：`requireChannel` 对"目录里没有这条镜像"会抛 ⇒ ' +
    '照发就是一次什么都没做的点击（这一条就是 Ruling 64 的判据）',
);
assert.ok(
  textOf(staleChannelHtml).includes(textOf(resolved('files.channelStaleHint'))),
  '★ 而要在**面板级**说清为什么（一句解释，不是每个文件夹重复一遍）',
);
assert.equal(
  staleChannelHtml.includes('data-bulk-channel-usable="no"'),
  true,
  '★ 面板那一格读数也要说得出这一档（`data-bulk-channel-usable`）',
);
/* 对照：通道成立时那颗按钮**照常**在（否则上面那条"不画"可能是恒真的）。 */
const okChannelHtml = foldersHtmlOf(stateOf([ROW_GITHUB], { folders: [FOLDER] }));
assert.equal(
  okChannelHtml.includes('data-bulk-channel-usable="yes"') &&
    labelsIn(summaryOf(folderBlockOf(okChannelHtml, FOLDER_ID))).includes(
      labelOf('files.folderUpdateAll', { count: 2 }),
    ),
  true,
  '★ 反面：通道成立时面板说 `yes`，而且「全部更新」那颗按钮真的在',
);
/*
 * ★★ 过期**版本**：照画（看得见）但 `disabled`（发不出去）。
 *    ⚠️ 夹具：`gameVersion: '1.99.9'` 不在 `state.gameVersions`（`['1.16.1']`）里。
 */
const staleVersionHtml = foldersHtmlOf(
  stateOf([ROW_GITHUB], { folders: [folder({ folderId: 'f-stale', gameVersion: '1.99.9' })] }),
);
const staleVersionHead = summaryOf(folderBlockOf(staleVersionHtml, 'f-stale'));
assert.deepEqual(
  selectsIn(staleVersionHead)[0]?.values,
  ['', '1.99.9', '1.16.1'],
  '★★ 过期版本**照画在最前面**（空取值 = 自动推断；然后才是那个旧值；再是全集的正常项）',
);
assert.deepEqual(
  disabledOptionValues(staleVersionHead),
  ['1.99.9'],
  '★★★ 而它**必须 disabled**：`requireGameVersion` 只认目录里有的版本 ⇒ ' +
    '让它可选就是一次注定被拒的调用（Ruling 64 的后半条）',
);
assert.equal(
  selectsIn(staleVersionHead)[0]?.selected,
  '1.99.9',
  '★ 选中的仍然是状态里那一版（旧值要看得见 —— 这一条与上面那条 disabled 是**两件事**)',
);
ok('㉙ Ruling 64：过期通道照画但不发（「全部更新」不画 + 一句解释）、过期版本照画但 `disabled`');

// ---------------------------------------------------------------------------
// ㉚ ★★ Ruling 65：**扫描失败**不许被渲染成"这个文件夹里没有能识别的 mod"
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 现场：`rows` 在**扫描失败**时也是空的（`mod-folder-scan.ts` 的 `ok: false`
 *    配空 `entries`）⇒ 只看 `rows.length === 0` 的话，用户会**同时**看到第一部分的
 *    "读不了这个文件夹（…）"与第二部分的"没有能识别的 mod"，而后者是**编出来的结论**
 *    （这一组的两条判据互为对照组：同一份 `rows: []`，只有 `hasReading` 不同）。
 */
const noReadingHtml = foldersHtmlOf(
  stateOf([ROW_GITHUB], {
    folders: [folder({ folderId: 'f-noreading', hasReading: false, rows: [], unrecognized: [] })],
  }),
);
const noReadingBlock = folderBlockOf(noReadingHtml, 'f-noreading');
assert.ok(
  textOf(noReadingBlock).includes(textOf(resolved('files.folderNoReading'))),
  '★★ 没有成功读数 ⇒ 说"还不知道里面有什么"（而不是"里面没有"）',
);
assert.equal(
  textOf(noReadingBlock).includes(textOf(resolved('files.folderNoRows'))),
  false,
  '★★★ 而且**不许**印"这个文件夹里没有能识别的 mod" —— 那句话在这一档是编出来的结论 ' +
    '（这一条就是 Ruling 65 的判据）',
);
const readEmptyHtml = foldersHtmlOf(
  stateOf([ROW_GITHUB], {
    folders: [folder({ folderId: 'f-read-empty', hasReading: true, rows: [], unrecognized: [] })],
  }),
);
const readEmptyBlock = folderBlockOf(readEmptyHtml, 'f-read-empty');
assert.ok(
  textOf(readEmptyBlock).includes(textOf(resolved('files.folderNoRows'))),
  '★ 反面：**读到过**而里面没有能识别的 mod ⇒ 照旧说"没有能识别的 mod"（两句必须分得开）',
);
assert.equal(
  textOf(readEmptyBlock).includes(textOf(resolved('files.folderNoReading'))),
  false,
  '★ 而且那一档不许说"还没有读数"（两句话是两句不同的话）',
);
ok(
  '㉚ Ruling 65：没有成功读数 ⇒ 说"还不知道"（不印"没有能识别的 mod"）；读到过而那里面没有 ⇒ 照旧那一句',
);

// ---------------------------------------------------------------------------
// ㉖ ★★ 源码形状守卫：写动作的接线（静态渲染看不见事件处理器）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 与 ⑯ 同一族：`renderToStaticMarkup` 一行事件处理器都不跑 ⇒「点那颗按钮真的走了
 *    哪条通道」**没有产物能证明**。这里退一步钉它成立的**前提**：那条接线**在**、
 *    而且**只有一条**（每一条守卫都点名能让它红的那一刀，读数在报告里）。
 */
const foldersPanelCode = withoutComments(
  readFileSync(new URL('../src/components/ModFoldersPanel.tsx', import.meta.url), 'utf8'),
);
const missingCode = withoutComments(
  readFileSync(new URL('../src/components/MissingModsList.tsx', import.meta.url), 'utf8'),
);
const filesCode = withoutComments(
  readFileSync(new URL('../src/routes/Files.tsx', import.meta.url), 'utf8'),
);

// —— 守卫 1：两颗更新按钮各送**自己**那条通道（能红的刀：镜像那颗改成 `'origin'`）——
assert.match(
  foldersPanelCode,
  /handlers\.updateMod\(folder\.folderId,\s*row\.modid,\s*releaseKey,\s*'origin'\)/,
  "★★ 行内第一颗更新按钮送的是 `'origin'`（release 自己的地址）",
);
assert.match(
  foldersPanelCode,
  /handlers\.updateMod\(folder\.folderId,\s*row\.modid,\s*releaseKey,\s*\{\s*mirrorId:\s*mirror\.id,?\s*\}\)/,
  '★★ 第二颗送的是 `{ mirrorId: mirror.id }`（**只送 id**，地址由主进程按目录那条镜像拼）' +
    "—— 两颗都送 `'origin'` 时镜像那颗是个假按钮，而产物里看不出来",
);
assert.equal(
  foldersPanelCode.match(/handlers\.updateMod\(/g)?.length,
  2,
  '★★ `handlers.updateMod(` 只许出现两次（就是那两颗按钮；多一处就是第二条写盘路径）',
);

// —— 守卫 2：「全部更新」接的是 `updateFolderAll` + 状态里那条通道（能红的刀：写死 `'origin'`）——
assert.match(
  foldersPanelCode,
  /handlers\.updateFolderAll\(folder\.folderId,\s*state\.bulkChannel\)/,
  '★★ 「全部更新」必须把**状态里那条通道**发出去（`state.bulkChannel`）—— ' +
    "写死 `'origin'` 会让上面那个选择器变成一个不起作用的控件",
);
assert.equal(
  foldersPanelCode.match(/handlers\.updateFolderAll\(/g)?.length,
  1,
  '★ 只许一处（那一颗按钮）',
);

// —— 守卫 3：解绑与重扫各接自己那条通道，而且带 `folderId`（能红的刀：把重扫接成 `rescan()`）——
assert.match(
  foldersPanelCode,
  /handlers\.unbindFolder\(folder\.folderId\)/,
  '★ 「解除绑定」接的是 `unbindFolder(folderId)`（解绑 ≠ 删文件，删的是状态里那一格）',
);
assert.match(
  foldersPanelCode,
  /handlers\.rescan\(folder\.folderId\)/,
  '★★ 「重扫这个文件夹」必须带 `folderId`：`rescan()` 不带参数是**全部重扫**（一次请求 N 个目录，与按钮上那句话不符）',
);
assert.equal(foldersPanelCode.match(/handlers\.rescan\(/g)?.length, 1, '★ 只许一处');

// —— 守卫 4：镜像的可用性来自状态（能红的刀：写死一个镜像 id / 按 github.com 判主机）——
assert.match(
  foldersPanelCode,
  /mirrorsForUrl\(state\.mirrors,\s*row\.official\.url\)/,
  '★★ 镜像按钮的可用性来自**状态里的镜像表**（`mirrorsForUrl`，Ruling 55）—— ' +
    '主机匹配只有 `mirrorsFor` 一份实现',
);
assert.equal(
  foldersPanelCode.includes('gh-proxy') || foldersPanelCode.includes('isGitHubRelease'),
  false,
  '★★ 第二部分里**不许**出现写死的目录配置（`gh-proxy` / `isGitHubRelease`）：' +
    '那是一份会漂的第二真相，而失败形态是"点了被主进程拒"（判修 4 / Ruling 55）',
);
ok(
  '㉖ 接线守卫（写动作）：两颗更新按钮各送自己的通道（各一处）、全部更新送状态里那条通道、解绑/重扫各一处且带 folderId、镜像判据来自状态且无硬编码',
);

// ---------------------------------------------------------------------------
// ㉗ ★★ 源码形状守卫：设置类动作 + 底部两颗下载各送自己的通道 + 三块拼装
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 这一组盯的是"**页面只发它证得了的东西**"：
 *   · 三个设置类动作（版本 / 自动更新 / 批量通道）各接自己那条 onChange，各一处；
 *   · 底部那颗「下载」送的是 `'origin'` **或**那一行 release 自己适用的镜像
 *     （**Ruling 62②** 之后 `MissingModView` **有** `release` 了 ⇒ 页面证得了镜像适用，
 *     所以现在是两颗、各送自己那条通道；两颗的接法由下面那几条守卫逐条钉住）；
 *   · 三块的拼装顺序（第一部分 → 第二部分 → 底部）与特性检测那一支。
 *   ⚠️ 旧注释写的是"`MissingModView` 里没有 release ⇒ 只走 origin"（Ruling 66② 记的
 *   那处注释腐坏），已改准 —— 那是判修轮**之前**的契约。
 */
assert.match(
  foldersPanelCode,
  /<select\b[\s\S]{0,600}?handlers\.setFolderGameVersion\(folder\.folderId,\s*next === '' \? null : next\)/,
  '★★ 版本下拉的 `onChange` 必须把**空串变成 `null`**（契约里 `null` 是"交回自动推断"，' +
    '不是"不改"）—— 直接把空串发出去会被 `requireGameVersion` 拒',
);
assert.match(
  foldersPanelCode,
  /onChange=\{[\s\S]{0,400}?handlers\.setFolderAutoUpdate\(folder\.folderId,\s*event\.target\.checked\)/,
  '★ 勾选框接的是 `setFolderAutoUpdate(folderId, checked)`（接错 ⇒ 那个开关不动）',
);
assert.match(
  foldersPanelCode,
  /onChange=\{[\s\S]{0,400}?handlers\.setBulkChannel\(next === 'origin' \? 'origin' : \{ mirrorId: next \}\)/,
  '★ 通道下拉接的是 `setBulkChannel(…)`（值从状态来、写回主进程的 `prefs`）',
);
assert.equal(
  foldersPanelCode.match(/handlers\.setBulkChannel\(/g)?.length,
  1,
  '★★ 只许一处：界面**不许**自己存一份通道（Ruling 23 —— 两处记忆的表现是' +
    '"界面显示 origin、主进程按镜像下载"，而且完全不报错）',
);
for (const action of [
  'setFolderGameVersion',
  'setFolderAutoUpdate',
  'updateFolderAll',
  'unbindFolder',
  'bindFolder',
] as const) {
  assert.equal(
    foldersPanelCode.match(new RegExp(`handlers\\.${action}\\(`, 'g'))?.length,
    1,
    `★★ \`handlers.${action}(\` 只许出现一次（一处接线 = 一处真相）`,
  );
}
assert.equal(
  foldersPanelCode.includes('localStorage'),
  false,
  '★★ 第二部分**不许**在渲染进程里再存一份（`localStorage`）：一处记忆（主进程的 `prefs`）',
);
// —— 守卫 5：底部那两颗下载各送**自己**那条通道（能红的刀：镜像那颗改成 `'origin'`）——
/*
 * ⚠️★ 2026-10-03 T8 判修轮：这一条原来是"底部那颗只走 `'origin'`"（第一版的事实：
 *    `MissingModView` 里没有 release ⇒ 页面证不了任何镜像适用）。**Ruling 62②** 把
 *    `release` 加进状态之后，判据变成与第一部分同一条：两颗按钮各送自己那条通道，
 *    而镜像那一颗只在 `mirrorsForUrl(state.mirrors, row.release.url)` 有结果时出现。
 */
assert.match(
  missingCode,
  /handlers\.downloadMissing\(row\.modid,\s*row\.gameVersion,\s*folderId,\s*'origin'\)/,
  "★★ 底部第一颗下载送的是 `'origin'`（release 自己的地址，永远成立）",
);
assert.match(
  missingCode,
  /handlers\.downloadMissing\(row\.modid,\s*row\.gameVersion,\s*folderId,\s*\{\s*mirrorId:\s*mirror\.id,?\s*\}\)/,
  "★★ 第二颗送的是 `{ mirrorId: mirror.id }`（**只送 id**）—— 两颗都送 `'origin'` 时" +
    '镜像那颗是个假按钮，而产物里看不出来',
);
assert.equal(
  missingCode.match(/handlers\.downloadMissing\(/g)?.length,
  2,
  '★★ `handlers.downloadMissing(` 只许出现两次（就是那两颗按钮；多一处就是第二条写盘路径）',
);
assert.match(
  missingCode,
  /mirrorsForUrl\(mirrors,\s*row\.release\.url\)/,
  '★★ 镜像那一颗的可用性来自**状态里的镜像表 + 那一行的 release**（Ruling 62②）—— ' +
    '判据只有 `mirrorsFor` 一份实现（与第一部分、与文件夹行同一条）',
);
assert.match(
  missingCode,
  /row\.manual\s*\?/,
  '★★★ **Critical**：`manual` 的行必须在**渲染期**就分岔（不画下载控件）—— ' +
    '`downloadMissing` 的 `assertNotManual` 必拒，而页面推不出这一格，只能靠状态里的 `manual`',
);
assert.equal(
  missingCode.includes('bulkChannel'),
  false,
  '★★ 底部**不许**碰 `bulkChannel`：那个选择器的作用域是「全部更新」' +
    '（两处各有一条判据，混起来就会出现"界面显示 origin、实际按镜像下载"那一族）',
);
assert.match(
  missingCode,
  /folder\.pathExists && folder\.gameVersion === row\.gameVersion/,
  '★★ 「下载到」的选项必须**同时**过滤"路径还在"与"版本对得上"（主进程那两条闸）' +
    '—— 去掉任一半，用户点下去就是一句必吃的红字',
);
// —— 守卫 6：页面那一支的三块顺序 + 特性检测那一支 ——
assert.match(
  filesCode,
  /<ModCatalogSection[\s\S]{0,300}?<ModFoldersPanel[\s\S]{0,300}?<MissingModsList/,
  '★★ 页面那一支必须是三块：第一部分 → 第二部分 → 底部（顺序即 spec §6.8 的三块）',
);
assert.match(
  filesCode,
  /<ModFoldersUnavailable \/>/,
  '★★ 特性检测那一支要渲染"需要桌面版 0.0.5"那一块（`modFolders` 不存在时的第二部分）',
);
assert.equal(
  filesCode.match(/<ModFoldersUnavailable \/>/g)?.length,
  1,
  '★ 只许一处（那句提示挂在不存在的壳那一支上，不是常驻说明）',
);
ok(
  '㉗ 接线守卫（设置与底部）：版本/自动更新/通道各一处、空串变 null、底部两颗下载各送自己的通道且 `manual` 行在渲染期分岔、选项两条过滤、三块顺序与特性检测那一支',
);

// ---------------------------------------------------------------------------
// ㉜ ★★ 真实目录：1.16.1 那 **48 行**真的渲染得出来（spec §10 那条断言）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 为什么要有这一组（2026-10-04 收口波）：spec §10 的渲染自检那一行写着
 *    "两个筛选维度 × **48 行** × 双按钮 × 缺失清单折叠 × 三处空态 × 老客户端降级"，
 *    而这一组之前**全部**用的是手写的 3–5 行夹具 ⇒ "48 行"这个数只在数据层
 *    （`services/api/src/mod-catalog.test.ts` 那类单测）被证过，**页面上没有被渲染过**：
 *    `planCatalogRows` 的过滤/去重/展开若漂了（例如把 `targetVersions[]` 展开丢掉一层），
 *    这个脚本一行都不会红。
 * ⚠️★ 判据分两层，缺一层就有一种坏法没人喊：
 *    ① **数据层**：`planCatalogRows` 对真目录的 1.16.1 恰好给 48 行（与 spec §3.2 的读数一致）；
 *    ② **渲染层**：那张表真的把这 48 行画出来了（`data-catalog-rows` 与 `<tr>` 计数
 *       两条**独立**读数 —— 只数一个的话，"表根本没渲染"或"行数标签写死"都能过）。
 * ⚠️ 夹具是**真目录**（`content/mod-catalog.json`），走的是与主进程同一段纯逻辑
 *    （`parseModCatalog` + `planCatalogRows`）；`bindings` 给空表 ⇒ 每一行的判定是
 *    `unknown`（没有本地读数），所以这一组**不**断言按钮，只断言行数与渲染。
 * ⚠️ 这个脚本**不进安装包**（`apps/web/scripts/**` 不在任何构建输入里）⇒ 读仓库文件是免费的。
 * ⚠️ 路径用 `import.meta.url` 推（脚本的 cwd 是 `apps/web`，相对路径会指错地方）。
 */
const realParsed = parseModCatalog(
  JSON.parse(
    readFileSync(new URL('../../../content/mod-catalog.json', import.meta.url), 'utf8'),
  ) as unknown,
);
/*
 * ⚠️★ 先证"仓库里那份目录是合法的"：`parseModCatalog` 把错误**返回**而不是抛
 *    ⇒ 不写这一条的话，一份坏目录会让下面那句 `realCatalog.tagLabels` 抛 `TypeError`
 *    （症状长得像"脚本写错了"，不像"目录坏了" —— §5.74 那一族）。
 */
if (!realParsed.ok) {
  assert.fail(
    `content/mod-catalog.json 不合法（这一组要验的是真目录）：${realParsed.problems.join('；')}`,
  );
}
const realCatalog = realParsed.catalog;
/**
 * 标签全集 —— **与主进程 `tagOptionsOf` / `requireKnownTags` 同一口径**
 * （`tagLabels` 的键 ∪ 各个 mod 真的带着的标签）。这一格只影响 chip 的文案：
 * 不给的话会退回目录里的 `zh` 那一份，而 ㉛ 的零汉字扫描**不许**开豁免口子
 * （英文那一遍里那一列会是中文）。
 */
const realTagLabels: TagOptionView[] = (() => {
  const keys = new Set<string>(Object.keys(realCatalog.tagLabels));
  for (const mod of realCatalog.mods) for (const tag of mod.tags) keys.add(tag);
  return [...keys].map((key) => ({
    key,
    labels: realCatalog.tagLabels[key] ?? { zh: key, en: key },
  }));
})();
const realRows = planCatalogRows({
  catalog: realCatalog,
  gameVersion: '1.16.1',
  tagFilter: [],
  bindings: new Map(),
});
assert.equal(
  realRows.length,
  48,
  '★★ 真实目录在 1.16.1 下是 48 行（spec §3.2 / §10 的那个数）—— 少一行说明展开或过滤漂了',
);
const realRowsHtml = keep(
  tableHtml(realRows, { mirrors: realCatalog.mirrors, tagLabels: realTagLabels }),
);
assert.ok(
  realRowsHtml.includes('data-catalog-rows="48"'),
  '★★ 那一屏真的把 48 行交给了表（`data-catalog-rows` 是"面板给了几行"的读数）',
);
assert.equal(
  (realRowsHtml.match(/class="filetable__row"/g) ?? []).length,
  48,
  '★★ 而且 48 个 `<tr>` 真的在产物里（与上面那条**独立**：标签可以写死、行可以没画）',
);
assert.deepEqual(
  rawKeysIn(realRowsHtml),
  [],
  '★ 真实目录那一屏的产物里也没有裸 key 泄漏（手写夹具那一遍扫不到这些真实标签名）',
);
ok('㉜ 真实目录（content/mod-catalog.json）：1.16.1 的 48 行真的渲染出来了');

// ---------------------------------------------------------------------------
// ㉛ 英文那一遍：全部渲染产物零汉字
// ---------------------------------------------------------------------------
if (LANG === 'en') {
  /*
   * ⚠️★ 只在 `--en` 那一遍跑（词条泄漏只有英文渲染下才暴露：中文环境里 `t()` 会回退到 zh）。
   * ⚠️ 样本里**没有**中文夹具：`TAG_LABEL` / `TAG_OPTION` / `NOTE` / `SKIP_REASON` 都是 ASCII；
   *    真实的标签显示名两种语言都在状态里（`TagOptionView.labels`）⇒ 这一遍用的就是 `en`
   *    那一份（2026-10-03 的判修顺带修掉了"英文界面上标签名是中文"）。
   *    主进程写死的 `notices` / `skipped[].reason` 仍然是中文，而那是**已接受的代价**
   *    —— 这里**不开豁免口子**：开口子的扫描在**最该抓人的那一处**是瞎的。
   * ⚠️ Task 8 的三块产物也在 `samples` 里（`foldersHtmlOf` / `missingHtmlOf` / `partsHtmlOf`
   *    都走 `keep()`）⇒ 新加的那些词条（含判修轮的四条）一旦哪一条漏了 `en`，
   *    这一条会当场红（而不是让英文界面上冒出一串中文）。
   */
  const han = textOf(samples.join('')).match(/[\u4e00-\u9fff]+/g) ?? [];
  assert.deepEqual(han, [], `英文界面里出现了中文：${han.slice(0, 8).join(' / ')}`);
  ok('㉛ 英文那一遍：全部渲染产物零汉字');
}

// ---------------------------------------------------------------------------
// 组数探针（手抄的，理由见下）
// ---------------------------------------------------------------------------
/*
 * ⚠️ 组数是**手抄的**（本仓惯例，`filesrender.tsx` 末段写着同一条）：它防的是
 *    "把某一段整块摘掉" —— 删掉一整组断言之后脚本照样绿、照样打印"通过 N 项"，
 *    只有这个数字会变。⇒ 改脚本就要一起改这里（改的时候**现数**，别估）。
 * ⚠️ en 比 zh 多 1：㉛ 那个零汉字扫描只在 en 那一遍跑，两个数差 1 是**正常的**，别抹平。
 * ⚠️ Task 8：18 → 28（en 19 → 29），加的正是 ⑱–㉗ 那十组；
 *    判修轮又加了 ㉘–㉚ 三组（Critical / Ruling 64 / Ruling 65）⇒ 28 → **31**、29 → **32**；
 *    收口波再加 ㉜ 一组（真实目录的 48 行真的渲染一遍）⇒ 31 → **32**、32 → **33**。
 */
const expectedGroups = LANG === 'en' ? 33 : 32;
assert.equal(
  pass,
  expectedGroups,
  `探针：这一轮应当通过 ${String(expectedGroups)} 组（少了就说明有人把某一段摘掉了）`,
);

console.log('');
console.log(`通过 ${pass} 项。`);
console.log('');
console.log('⚠️ 这个脚本验的是**渲染**（外加 ⑫⑭ 两个纯函数与 ⑯㉖㉗ 的源码形状）：');
console.log('   没有点击、没有请求、没有真实浏览器、也没有主进程。');
console.log('   具体没被覆盖的（至少这几样）：');
console.log('     · 点一下真的走了哪条通道 / 真的弹了原生对话框 —— 静态渲染不跑事件处理器，');
console.log('       ⑯㉖㉗ 只钉住"那条接线在、而且只有一条"；');
console.log('     · `<details>` 展开收起本身，以及点 `<summary>` 里那颗按钮会不会顺带折叠');
console.log('       —— 那是浏览器的默认动作，产物里只有结构（控件真的住在 <summary> 里）；');
console.log('     · `useModFolders()` 的另外两条支路（订阅回包 / 失败）：⑰ 只证了**第一帧**；');
console.log('     · 缺失清单的"那个文件夹还没有扫描读数"那条拒绝：它由 `missingStatus ===');
console.log('       "ok"` 的**定义**挡在不可达那一侧（㉔ 断言另外三档不画清单）；');
console.log('     · `hasReading` 是**主进程**算的（`readingOf(id).ok`）：㉚ 钉的是"拿到这一格');
console.log('       之后渲染成什么样"，那一格的值本身在桌面探针里；');
console.log('     · 主进程写死的中文（`notices` / `skipped[].reason`）—— 夹具是 ASCII；');
console.log(
  '     · 两个重复键（`optifine|1.7.2` / `speedrunigt|26.1`）的**真实**形状与 54 条 manual 的',
);
console.log('       目录级读数（那是 T1/T3 的单测与目录本身的事）。');
console.log('     ⚠️ 2026-10-04 收口波订正：**真实目录的 48 行**现在由 ㉜ 真的渲染一遍');
console.log('       （此前这一行把它列在"没被覆盖"里，而 spec §10 要求它被渲染过）。');
