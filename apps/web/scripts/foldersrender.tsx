#!/usr/bin/env tsx
/**
 * 「文件更新」`/files` 那一页 · **新页面**（tab 骨架 / 按版本分组的文件夹 / 展开的 jar 列表 /
 * 第三段「该版本所有 mod」）的渲染自检（2026-10-03，Task 7 写了 ①–⑰；同一天 **Task 8**
 * 加了 ⑱–㉗ 并把脚本接进 `check:all` —— 第 14 个渲染自检）。
 *
 * ⚠️★ 2026-10-04（A 的 **T6**）：这个脚本**瘦了一大半**（4435 → 2500 行上下）。
 *    被删掉的是 ①–⑫、⑯、⑱–㉔、㉖–㉚ 那几十组 —— 它们验的是**旧那三块**
 *    （第一部分那张目录表 / 旧第二部分 `ModFoldersPanel` / 底部 `MissingModsList`）
 *    与 `filesrender.tsx`（v1 那一半，连脚本一起删）。理由：T6 把那五个文件删了
 *    （spec §2.1 第 7 条 / D1），没有组件的断言不可能绿。
 *    ⇒ 留下来的组号**不重排**（组号是顺序、不是历史编号，重排会让"哪一组在哪"这句话
 *      在提交历史与报告里对不上）；被删掉的号就是**空号**，列在这里：
 *        ①–⑫（第一部分：筛选器 / 双按钮 / 四支判定 / 空态 / busy / lastRun / toggleTag）
 *        ⑯（第一部分的接线守卫 —— 它读的两个源码文件都删了）
 *        ⑱–㉔（旧第二部分与底部清单：`<details>` 六样控件 / 行内六样 / 五档不给更新 /
 *              三处空态 / 「下载到」的过滤 / `missingStatus` 四档）
 *        ㉖–㉚（那两块的源码形状守卫 + Ruling 64 的过期通道 + Ruling 65 的"没有读数"）
 *      ⚠️★ 那些判据**没有全丢**：能挪到新页面上的都挪了 ——
 *        · ㉞ 收了旧 ⑱–㉒ 里属于"折叠行 + 头行控件 + 空态"的那一批（新页面自己那一套）；
 *        · ㊱ 收了旧 ⑲–㉑ 里属于"jar 列表 + 五档不给更新"的那一批；
 *        · ㊳/㊴ 收了底部清单那一条能力的继承者（第三段「该版本所有 mod」）；
 *        · ㉜ 从"第一部分那张表真的画 48 行"改成"**第三段**真的画 48 行"（spec §10 那条读数
 *          落在**还活着**的那一块上）。
 *      ⚠️ 代价（认）：`missingStatus` 四档、`manual` 缺失行的 Critical、`toggleTag`、
 *        第一部分那两个筛选器的受控性 —— 这些**没有**新页面上的对应物，随旧 UI 一起消失。
 *
 * 跑法（从仓库根）：
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:folders
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:folders -- --en
 *
 * ===========================================================================
 * 为什么这一页必须有它
 * ===========================================================================
 * `apps/web` 没有测试运行器（`CONTRIBUTING.md`），而这一页"每行给不给按钮 / 给几颗 /
 * 标哪个来源 / 三处空态 / 第三段什么时候不画"全是**只能用产物证明**的东西 ——
 * 类型检查看不见"块整个没渲染"、"词条打错一个字母"、"给 manual 的行画了一颗会被主进程
 * 拒的按钮"。i18next 对未知 key **不报错**，它把 key 原样印在界面上。
 *
 * ===========================================================================
 * ⚠️★ 边界：这个脚本**证不了**什么（与已删的 filesrender 同型的边界）
 * ===========================================================================
 * `renderToStaticMarkup` **不点击、不跑事件处理器、不跑 effect**（`docs/pending.md §5.73`）：
 *   · 「点一下真的走了哪条通道」/「点了真的会弹原生对话框」——**一件都不碰**。
 *     通道的接线只由 ㉟ / ㊲ / ㊴ 那几条**源码形状守卫**兜着（它们证的是"那条路在、
 *     而且只有一条"）；
 *   · `useModFolders()` 的三条支路（订阅 / 首拉 / 失败）在自检里**跑不到**：
 *     `window.mcsr` 是 `undefined` ⇒ 它只会停在 `unavailable`（浏览器那一支）。
 *     ⇒ ⑮ 只钉住「正在扫描…」那一屏的**组件**，不钉"钩子真的会进那一屏"；
 *     ⇒ ⑰ 钉的是"第一帧渲染 `Files` 就是那一屏"（给 `globalThis.mcsr` 放一份桩）；
 *     ⇒ ㉕ 钉的是"0.0.4 的壳渲染成什么样"（同一个桩，另一档）；
 *   · 主进程写死的中文（`notices` / 标签显示名）—— 夹具里一律换成 ASCII
 *     （见下面 `NOTE` / `TAG_LABEL` 两段）：它们的语言不归这一层管，而 ㉛ 的零汉字扫描
 *     **不许开豁免口子**。
 *
 * ===========================================================================
 * ⚠️★★ 锚点纪律：锚在**按钮与文案**上，不锚函数名
 * ===========================================================================
 *   · 「给不给按钮」一律断言**产物里那颗按钮的文字**（`labelsIn`）；
 *   · 「按哪条通道」没有产物可锚（静态渲染不跑处理器）⇒ 只由 ㉟ / ㊲ / ㊴ 的**接线守卫**
 *     兜着，而那几条守卫的刀**真的跑过**（改坏 → 跑 → 还原 → `sha256` 核对，
 *     读数在报告里）。
 *
 * ===========================================================================
 * 组数（手抄的，见文件末尾那条探针）
 * ===========================================================================
 * zh **15** 组、en **16** 组（㉛ 零汉字扫描只在 `--en` 那一遍跑；现读的清单见文件末尾那条探针）。
 * ⚠️ 组号是**顺序**，不是历史编号 —— 现读的清单见文件末尾那条探针上面那一段。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { MOD_FOLDERS_CHANNELS } from '@mcsr/shared/desktop';
import type { DownloadProgress, TimedSample } from '@mcsr/shared/downloadProgress';
import { en, zhCN } from '@mcsr/shared/i18n';
import { buildIndex, type ModRelease, parseModCatalog } from '@mcsr/shared/modCatalog';
import {
  type CatalogRowView,
  groupFoldersByVersion,
  type ModFolderRowView,
  type ModFoldersState,
  type ModFolderView,
  planCatalogRows,
  planVersionPage,
  type TagOptionView,
} from '@mcsr/shared/modFolders';
import i18n from 'i18next';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { AllFoldersView } from '@/components/AllFoldersView';
import { DownloadProgressLine } from '@/components/DownloadProgressLine';
import { FolderJarList } from '@/components/FolderJarList';
import { ModDownloadPanel } from '@/components/ModDownloadPanel';
import {
  ModCatalogScanning,
  NO_MOD_FOLDERS_LOAD,
  type PageProgress,
  progressOf,
  RAW_KEY_RE,
  rawKeysIn,
  reduceModFoldersLoad,
} from '@/components/ModFoldersData';
import { ModPacksSection } from '@/components/ModPacksSection';
import { ToolsPanel } from '@/components/ToolsPanel';
import { VersionFolderList } from '@/components/VersionFolderList';
import { VersionModList } from '@/components/VersionModList';
import { packVersionOptions } from '@/lib/modPackEdits';
import { Files } from '@/routes/Files';

const LANG = process.argv.includes('--en') ? 'en' : 'zh-CN';

await i18n.init({
  lng: LANG,
  fallbackLng: false,
  resources: { 'zh-CN': { translation: zhCN }, en: { translation: en } },
  interpolation: { escapeValue: false },
});

/*
 * ⚠️ 刻意**不用 JSX**（这条纪律沿用自已删的 `filesrender.tsx`）：`scripts/**` 不在 tsconfig 的
 *    `include` 里 ⇒ JSX 走 classic runtime ⇒ 必须 `import React from 'react'`，
 *    而 biome 的 `noUnusedImports` 会把它判成未使用并提供一个**不安全自动修复** ——
 *    谁点了那个修复，脚本就在运行时崩。
 */

/** 一段渲染产物 → 人看到的那串字（口径：空白一律压掉）。 */
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
 * 针孔探针（本仓老规矩）：词条必须**真的解析出译文**。
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
 * ⚠️★ 三个 ASCII 夹具，各自都有理由（照已删的 `filesrender.tsx` 的 `FAILURE` 那一段）：
 *   · `TAG_LABEL`：`CatalogRowView.tagLabels` 只带目录里的 **`zh`** 那一份
 *     （`packages/shared/src/modFolders.ts` 的 `tagLabelsOf` 写着这件事：这一层没有
 *     locale 参数）⇒ 真实目录里它**是中文**。夹具换成中文的话，⑱ 那条"英文产物零汉字"
 *     就得给扫描开一个豁免口子 —— 而开了口子的扫描在**最该抓人的那一处**是瞎的。
 *     ⚠️ 2026-10-03 之后行里那些 chip 的文案改成从 `state.tags`（两种语言都有）取
 *     ⇒ `TAG_LABEL` 只是**查不到时的退路**，夹具仍然让它保持 ASCII。
 *   · `NOTE`：`ModFoldersState.notices[]` 由主进程写（中文），页面只负责原样印。
 *     ⚠️★ T6 删掉了 `SKIP_REASON`（`lastRun.skipped[].reason`）：那一格只由**旧第二部分**
 *     逐条印出来，而它在 T6 随旧组件一起删了 —— 新的三段没有它的渲染点。
 */
const TAG_LABEL = 'tag-legal';
const TAG_KEY = 'legal';
/** 主进程写好的那一句（`notices`）：这一层只负责原样印。 */
const NOTE = 'MIGRATION-NOTICE-31337: adopted into folder tracking';
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

const GITHUB_URL =
  'https://github.com/CaffeineMC/sodium-fabric/releases/download/mc1.16.1-0.1.3/sodium-fabric-0.1.3.jar';
const CDN_URL = 'https://cdn.modrinth.com/data/AANobbMI/versions/abc123/sodium-fabric-0.1.3.jar';
const OPTIFINE_URL = 'https://optifine.net/adloadx?f=OptiFine_1.16.1_HD_U_G2.jar';
/**
 * `ROW_GITHUB` 那一行**在目录里**的 homepage。
 *
 * ⚠️★ 2026-10-04 A 的 T4：`CatalogRowView.homepage` 从"可选"改成了**必填**
 *    （T1 评审留给 T4 的待办）⇒ 这一格必须显式写出来。
 *    ⚠️★ 但"忘了写"在这个文件里**不是编译错**：`apps/web/scripts/**` 不在任何 tsconfig
 *    的 `include` 里（`tsc` 不看它、`tsx` 只剥类型不做检查 —— 刀 K14 实测：往本文件里
 *    插一句 `const x: number = 'not-a-number';`，`typecheck` 与本脚本双双照样绿）。
 *    ⇒ 这一格的守卫是 ㊱ 开头那句**夹具自钉**（`assert.ok(ROW_GITHUB.homepage, …)`），
 *    类型层面的守卫是一次性的 `tsc` 探针（报告 §刀 K14 里有全文与命令）。
 * ⚠️ 展开体那一组（㊱）会**覆盖**这个值来造夹具：两处不同 ⇒ "href 就是目录里那个值"
 *    那条断言同时排除了"照抄这个常量"。
 */
const SODIUM_HOMEPAGE = 'https://example.invalid/sodium-homepage';

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

const BINDING = { localPath: 'D:\\mods\\sodium.jar', localVersion: '0.1.2' };

/** 一行：**已绑定 + 可更新（`older` + auto）**，来源是 GitHub（⇒ 该有两颗按钮）。 */
const ROW_GITHUB: CatalogRowView = {
  rowId: 'sodium|1.16.1',
  modid: 'sodium',
  name: 'Sodium',
  /* ⚠️ 必填（T4 改的）：值见 `SODIUM_HOMEPAGE`；守卫是 ㊱ 那句夹具自钉（**不是**编译错）。 */
  homepage: SODIUM_HOMEPAGE,
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
    /*
     * ★★ D1（T4）：`launchers` / `instances` / `instancesStatus` 是**新增的必需格**
     *   （与契约同批）。⚠️ 这里是这个脚本里**唯一**一处构造 `ModFoldersState` 的入口
     *   （全文另有一处 `as unknown as` 的 cast，它不构造）⇒ 默认值补在**这一处**就够，
     *   **不要**去逐个改用例。⚠️ `instancesStatus: 'ok'`：这些夹具渲染的是"已经读到过"
     *   的那一档（`'reading'` 是 A14 的另一档，由 T8 的用例单独造）。
     */
    launchers: [],
    instances: [],
    instancesStatus: 'ok',
    missing: [],
    missingStatus: 'ok',
    notices: [],
    busy: false,
    /* ★ 子项目 C（S2）：契约多了这一格（正在跑的那一趟）。这一份自检不画进度 ⇒ `null`。 */
    progress: null,
    lastRun: null,
    ...extra,
  };
}

const noop = (): void => undefined;

/*
 * ⚠️★ T6 删掉了这一份 `HANDLERS` 桩（`ModFoldersHandlers` 的十五个 no-op）：
 *    它唯一的消费者是"直接渲染旧第二部分 / 底部清单"的那两个包装
 *    （`foldersHtmlOf` / `missingHtmlOf`），而那两个随旧组件一起删了。新页面那几组
 *    走的是**动作联合**（`ModPageAction`）+ `noop`，不需要一份 handler 夹具；
 *    而且那一份桩里**当年逐字写着** `bindCatalogRow` / `unbindCatalogRow` / `updateCatalogRow`
 *    —— 三条已经删掉的通道（裁决 B）⇒ 留着它就是一份会漂的假契约。
 */

// ---------------------------------------------------------------------------
// 文件夹行 / 整夹的夹具（Task 8；新页面的那几组也复用它们）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 这些文件夹行的夹具与目录行那几张**有意分开**：
 *   · 文件夹行的 `verdict` 是 `FolderVerdict`（比 `ReleaseVerdict` 多一支
 *     `unknown-version`）⇒ 拿上面那几张目录行去当文件夹行过不了类型检查；
 *   · **文件名里不带版本号**（`sodium-build-A.jar`）：真实 jar 名里通常有版本号，
 *     而"本地版本那一格印了 0.1.2"这条断言会因为**文件名里也有 `0.1.2`** 而恒真
 *     —— 一条测不出东西的断言（§5.32 的第一类）。夹具把两个数字分开，断言才咬得住。
 * ⚠️ T6 删掉的：路径被移走 / 版本未知 / 缺 release / 多候选那几份整夹夹具
 *   （`FOLDER_GONE` / `FOLDER_NO_VERSION` / `FOLDER_OLD` 与 `MISSING_*` 那三张缺失行）——
 *   它们只服务旧第二部分与底部清单那几十组断言。行级的对照夹具（`FROW_*`）全部留下：
 *   新页面那几组（㉞/㊱）用的就是它们。
 */

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

/**
 * 一个整夹的夹具。
 *
 * ⚠️ 默认那两行是有意的：一行 GitHub 来源（两颗更新按钮）、一行 CDN 来源（一颗）
 *    —— 新页面那几组（㉞/㊱）拿它做"行内按钮由状态决定"的对照。
 * ⚠️★ T6 删掉了三份只服务旧断言的整夹夹具：`FOLDER`（主夹具）、`FOLDER_OLD`（另一个版本）、
 *    `FOLDER_GONE` / `FOLDER_NO_VERSION`（路径不在 / 版本未知）。新的那几组各自写自己那一份
 *    （`folder({ folderId: 'f1', … })`）—— 一份夹具服务两组判据正是"改一处、另一组静默变松"
 *    的来源，所以这里**不留**它们。
 */
function folder(over: Partial<ModFolderView> & { folderId: string }): ModFolderView {
  return {
    path: `D:\\instances\\${over.folderId}\\mods`,
    pathExists: true,
    /* ⚠️ 默认"读到过"（Ruling 65 之后这一格是必填的）。 */
    hasReading: true,
    gameVersion: '1.16.1',
    autoUpdate: true,
    rows: [FROW_UPDATE, FROW_CDN],
    unrecognized: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 从产物里取元素的小工具（形状照已删的 `filesrender.tsx`；**别**在这里另写一份裸 key 正则）
// ---------------------------------------------------------------------------

/**
 * 新页面里**一行文件夹**（`div.folderrow`）那一段产物 —— 从 `data-folder-id="X"` 起、
 * 到**下一个** `data-folder-id=`（没有下一个就到产物末尾）为止。
 *
 * ⚠️★ 它不是"配平地切出那个 `<div>`"：这一行里面还套着 `.folderrow__head` / `.folderrow__body`
 *    两层 div，非贪婪正则会在第一个 `</div>` 上截断（切出来的东西长得像"这一行"，
 *    其实是"这一行的头一段" —— `summaryOf` 那种写法在这里不成立）。
 *    ⚠️ 而断言真正需要的只是"**这一行那一段**里有什么"：相邻两行之间的边界正好就是
 *    下一个 `data-folder-id` ⇒ 这个窗口够用，而且它**变宽**只会让断言更宽松、不会更严。
 *    能红的刀：把某一颗控件从这一行里删掉（读数在报告里）。
 */
function folderRowSpanOf(markup: string, folderId: string): string {
  const start = markup.indexOf(`data-folder-id="${folderId}"`);
  assert.notEqual(
    start,
    -1,
    `产物里找不到 data-folder-id="${folderId}" 那一行 —— 那个文件夹没渲染出来`,
  );
  const next = markup.indexOf('data-folder-id="', start + 1);
  return next === -1 ? markup.slice(start) : markup.slice(start, next);
}

/**
 * 一个文件夹的**展开体**那一段产物 —— 从 `data-folder-body="X"` 起，到**下一个**
 * `data-folder-id=`（没有下一个就到产物末尾）为止。找不到就当场红。
 *
 * ⚠️★ 为什么另起一个（判修轮，2026-10-04 T4）：T4 的三格 prop（`homepageOf` / `mirrors` /
 *    `busy`）是**页面**喂下来的，而上面那些断言喂的是**自检自己组的那份**
 *    ⇒ "页面把空 Map 传下去"曾经**全绿**（评审点名的那条）。这一段的判据必须打在
 *    **`VersionFolderList` 渲染出来的产物**上（`expandedListHtml` / 忙碌那一份），
 *    而不是打在 `<FolderJarList>` 单独的产物上。
 * ⚠️ 切法与 `folderRowSpanOf` 同一条理由（非贪婪正则会在第一个 `</div>` 上截断）；
 *    而展开体正好在"这一行的头行之后、下一个文件夹那一行之前" ⇒ 这个窗口够用。
 */
function folderBodyOf(markup: string, folderId: string): string {
  const start = markup.indexOf(`data-folder-body="${folderId}"`);
  assert.notEqual(
    start,
    -1,
    `产物里找不到 data-folder-body="${folderId}" —— 那个文件夹的展开体没渲染出来`,
  );
  const next = markup.indexOf('data-folder-id="', start + 1);
  return next === -1 ? markup.slice(start) : markup.slice(start, next);
}

/**
 * 展开体里的一行 jar（`data-jar="<modid>"` 那一格）。找不到就当场红。
 *
 * ⚠️ 它**只**匹配已识别那一行：未识别的行没有 `data-jar`（它带的是
 *    `data-jar-unrecognized="true"` ⇒ `data-jar="` 那个引号对不上）。
 */
function jarRowOf(markup: string, modid: string): string {
  const found = markup.match(new RegExp(`<tr[^>]*data-jar="${modid}"[\\s\\S]*?</tr>`));
  assert.ok(
    found,
    `产物里找不到 data-jar="${modid}" 的那一行 —— 那一行没渲染出来，或者 data-jar 不再写在那里`,
  );
  return found[0];
}

/**
 * 一段产物里**每一个** `<select>` 的选项值与被选中的那个（按渲染顺序）。
 *
 * ⚠️★ 为什么必须按 `<select>` 切开：文件夹头行里**有两个**下拉（游戏版本 + 批量通道），
 *    而"整段里所有的 option"那种口径会把两个下拉的选项混成一个集合（一条测错对象的判据）。
 * ⚠️★ T6 删掉了两个老工具（`optionValues()` / `selectedOption()`）：它们只看"整段里的
 *    option"，唯一的消费者是第一部分那张表（两个筛选器）—— 那一段随 D1 一起删了。
 *    这一段里**所有**看下拉的断言都走 `selectsIn()` / `disabledOptionValues()`。
 * ⚠️ 选中的那一项两种写法都认（属性顺序不能假设）。
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

/** 剥掉注释再读源码形状（注释里逐字写着这些标识符，不剥 = 守卫被自己的注释喂饱）。 */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

console.log(
  `【${LANG}】文件更新页 · 新页面（tab 骨架 / 按版本分组的文件夹 / 展开的 jar 列表 / 第三段「该版本所有 mod」）`,
);

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
 *    是 `Files.tsx` 画"需要桌面版 0.0.5"那一句的判据（`useModFolders()` 见不到
 *    `modFolders` ⇒ `unavailable`）。⚠️★ T6 改准：它**不再是**"走 v1 那条路"的判据 ——
 *    v1 的面板与它的取数在 T6 已经连组件一起删了（D1：那一档只有升级提示）。
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
            /*
             * ★ C 的 T3：第二条推送（进度帧）。照 `onStatus` 那一格写（形状与它一致）。
             *   ⚠️★ 这一格**必须与契约同批**加：㉝ 那条 `deepEqual`（下面）把**这个对象**
             *   与 `MOD_FOLDERS_CHANNELS` 逐条对账 —— 契约加了而桩没加，`check:folders`
             *   立刻红（这正是它存在的理由）。
             */
            onProgress: () => () => undefined,
            /*
             * ★ C 的 T4：取消（**请求**通道，不是推送 —— 所以它照 `openFolder` 那种
             *   "返回一个 Promise 形状与契约一致的对象"的格子写）。
             *   ⚠️★ 这一格**必须与契约同批**加：㉝ 那条 `deepEqual`（下面）把**这个对象**
             *   与 `MOD_FOLDERS_CHANNELS` 逐条对账 —— 契约加了而桩没加，`check:folders`
             *   立刻红（这正是它存在的理由）。
             */
            cancelDownload: async () => ({ ok: true }) as const,
            bindFolder: async () => ({}),
            unbindFolder: async () => ({}),
            /*
             * ★ Task 3（A 的第三片）补的：T2 加了这条通道，而**这个桩没有类型**
             *   （`shellStub` 是对象字面量，不经 `satisfies`）⇒ 少了它不会有任何门禁出声，
             *   而那一格正是新页面「打开文件夹」走的路（T2 复审点名的那条交接）。
             *   ⚠️ ㉝ 里有一条断言把**这个对象**与 `MOD_FOLDERS_CHANNELS` 逐条对账 ——
             *   它才是"以后再加通道时不会又漏一格"的判据。
             *   ⚠️★ T6 删掉了三条（`bindCatalogRow` / `unbindCatalogRow` / `updateCatalogRow`）：
             *   契约 17 → 14，第一部分整个下线（裁决 B）。上面那条对账断言会**当场**咬住
             *   这个桩与契约的差（少一条、多一条都红）。
             */
            openFolder: async () => ({ ok: true }),
            rescan: async () => ({}),
            setFolderGameVersion: async () => ({}),
            setFolderAutoUpdate: async () => ({}),
            setBulkChannel: async () => ({}),
            updateMod: async () => ({}),
            updateFolderAll: async () => ({}),
            downloadMissing: async () => ({}),
            setCatalogGameVersion: async () => ({}),
            setTagFilter: async () => ({}),
            downloadPack: async () => {
              throw new Error('桩：这一格的存在只是为了让"桩与契约逐条对账"那条断言看得见它');
            },
            /*
             * ★★ D1（T4）：启动器绑定与实例那七格（契约 17 → 24）。照现有的形状写：
             *   两条各有自己的返回值（候选表 / 实例数组），五条是 `void`。
             *   ⚠️★ 这一组**必须与契约同批**加：上面那条 `deepEqual` 把**这个对象**与
             *   `MOD_FOLDERS_CHANNELS` 逐条对账 —— 契约加了而桩没加，`check:folders`
             *   立刻红（这正是它存在的理由）。
             *   ⚠️ 方法体**永远不会被执行**（静态渲染不跑 effect）：它们只是让
             *   `desktopBridge()?.modFolders?.probeLaunchers` 这类特性检测判成"在"。
             */
            probeLaunchers: async () => [],
            listLauncherInstances: async () => [],
            setInstancePaths: async () => undefined,
            addLauncher: async () => undefined,
            removeLauncher: async () => undefined,
            setInstanceTracked: async () => undefined,
            confirmInstance: async () => undefined,
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

// ---------------------------------------------------------------------------
// ㉕ 特性检测（§6.8 / §8 的最后一行）—— T3 之后**只剩**这一件事
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 2026-10-04（A 的 T3）改准：这一组原来还管"三块拼装 + 迁移提示同屏"
 *    （`ModFoldersParts` 那个纯组件渲染三块）。T3 把 `/files` 换成 **tab 骨架**：
 *    第一部分（目录行）与第三块（缺失清单）**不再挂在这一页上**（spec §9.12 / D1
 *    "0.0.4 用户只能看到升级提示"）⇒ `ModFoldersParts` 随之下线，那两条判据
 *    **搬去了 ㉞**（迁移提示的渲染点现在在 `ModDownloadPanel` 上；"面板里看得见
 *    文件夹与提示"由那一组钉）。这一组只留**特性检测**：两种没有 `modFolders` 的壳。
 * ⚠️★ 两种壳都真的渲染 `Files`：0.0.4（有 `mcsr`、没有 `modFolders`）与纯浏览器
 *    （连 `mcsr` 都没有）都该看到"需要桌面版 0.0.5"；而**只有**纯浏览器该看到
 *    `browserOnly` 那一句（0.0.4 是桌面壳）。
 */
/* —— 0.0.4 的壳：有 `mcsr`、没有 `modFolders` —— */
Object.assign(globalThis, { mcsr: shellStub(false) });
const oldShellHtml = keep(
  html(React.createElement(MemoryRouter, null, React.createElement(Files, null))),
);
delete (globalThis as { mcsr?: unknown }).mcsr;
assert.ok(
  textOf(oldShellHtml).includes(textOf(resolved('files.partTwoUnavailable'))),
  '★★ 特性检测：`window.mcsr?.modFolders` 不存在 ⇒ 显示"需要桌面版 0.0.5"（spec §6.8/§8）',
);
assert.equal(
  textOf(oldShellHtml).includes(textOf(resolved('common.loading'))),
  false,
  '★★ 反面（T3 之后改准）：0.0.4 的壳上**不再**有 v1 的「加载中…」—— 这一页现在只画 ' +
    '"需要桌面版 0.0.5"这一句（原来那句断言的是"v1 那条路照常"，而 v1 的面板在 T3 从页面上消失了）',
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
  '㉕ 特性检测：0.0.4 与纯浏览器都看到"需要桌面版 0.0.5"（而 v1 的「加载中…」与第一部分都不再挂在这一页上）',
);

// ---------------------------------------------------------------------------
// ㉜ ★★ 真实目录：1.16.1 那 **48 行**真的渲染得出来（spec §10 那条断言）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 为什么要有这一组（2026-10-04 收口波；**T6 换了个渲染点**）：spec §10 的渲染自检
 *    那一行写着"两个筛选维度 × **48 行** × …"，而这一组之前**全部**用的是手写的 3–5 行
 *    夹具 ⇒ "48 行"这个数只在数据层（`services/api/src/mod-catalog.test.ts` 那类单测）
 *    被证过，**页面上没有被渲染过**：`planCatalogRows` 的过滤/去重/展开若漂了
 *    （例如把 `targetVersions[]` 展开丢掉一层），这个脚本一行都不会红。
 * ⚠️★ T6 的改动：原来渲染的是**第一部分那张表**（`ModCatalogTable`，随 D1 删了）
 *    ⇒ 现在渲染**第三段**（`VersionModList`，spec §4 里"该版本所有 mod"那一栏）。
 *    两件事是同一个读数："真目录的 48 行真的画在页面上"。⚠️ 换的是渲染点，**不是**放宽判据：
 *    下面仍然是"数据层 48 + 渲染层两条独立读数"那一套。
 * ⚠️★ 判据分两层，缺一层就有一种坏法没人喊：
 *    ① **数据层**：`planCatalogRows` 对真目录的 1.16.1 恰好给 48 行（与 spec §3.2 的读数一致）；
 *    ② **渲染层**：第三段真的把这 48 行画出来了（`data-mod-rows` 与 `<tr>` 计数
 *       两条**独立**读数 —— 只数一个的话，"表根本没渲染"或"行数标签写死"都能过）。
 * ⚠️ 夹具是**真目录**（`content/mod-catalog.json`），走的是与主进程同一段纯逻辑
 *    （`parseModCatalog` + `planCatalogRows`）。⚠️★ T6 之后目录行**没有本地读数**
 *    （`bindings` 从入参里删了，D8）⇒ 每一行的判定恒是 `unknown`，所以这一组**不**断言按钮，
 *    只断言行数与渲染。
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
});
assert.equal(
  realRows.length,
  48,
  '★★ 真实目录在 1.16.1 下是 48 行（spec §3.2 / §10 的那个数）—— 少一行说明展开或过滤漂了',
);
/** 真目录那一页（第三段的投影；`folders` 为空 ⇒ 每一行都走"没下过"那一支）。 */
const realPageState = stateOf(realRows, { tags: realTagLabels });
const realModsHtml = keep(
  html(
    React.createElement(VersionModList, {
      page: planVersionPage(realPageState, []),
      tagLabels: realPageState.tags,
      busy: realPageState.busy,
      onAction: noop,
      progress: null,
    }),
  ),
);
assert.ok(
  realModsHtml.includes('data-mod-rows="48"'),
  '★★ 第三段真的把 48 行交给了那张表（`data-mod-rows` 是"这一段给了几行"的读数）',
);
assert.equal(
  (realModsHtml.match(/class="filetable__row"/g) ?? []).length,
  48,
  '★★ 而且 48 个 `<tr>` 真的在产物里（与上面那条**独立**：标签可以写死、行可以没画）',
);
assert.deepEqual(
  rawKeysIn(realModsHtml),
  [],
  '★ 真实目录那一屏的产物里也没有裸 key 泄漏（手写夹具那一遍扫不到这些真实标签名）',
);
ok('㉜ 真实目录（content/mod-catalog.json）：1.16.1 的 48 行在**第三段**里真的渲染出来了');

// ===========================================================================
// Task 3（A 的第三片）：页面骨架 —— tab / 顶部并排区 / 按版本分组的文件夹区
// ===========================================================================
/*
 * ⚠️★ 与上面 ⑱–㉚ 的关系（**T6 之后只剩历史意义**）：这一批渲染的是**新页面**的四个组件
 *    （`ModDownloadPanel` / `VersionFolderList` / `ToolsPanel` / `AllFoldersView`）。
 *    当年 ⑱–㉚ 渲染的 `ModFoldersPanel`（旧第二部分）**同时还在**：T3 只把**页面**
 *    从"三块"换成"tab 骨架"，旧组件与它那十几组断言一起留到 T6 ——
 *    ⚠️★ **T6 已经把它们删了**（删文件 + 删断言，空号清单见本文件文件头）
 *    ⇒ 今天这一页只有本文件这一批判据，两条路并存的那个提交周期结束了。
 * ⚠️★ 「默认在 mod 下载」**不能**靠"某个字符串不在场"来证（那是恒真一类，§5.32①）：
 *    这里真的渲染一次**页面外壳**（`Files` + `shellStub(true)`，照 ⑰ 的写法），
 *    断言的是**选中态**（`data-tab="mods"` 那颗按钮带 `aria-selected="true"`）。
 *    ⚠️★ tab 条住在**页面外壳**里，不在 `ModDownloadPanel` 里：计划里那条断言渲染的是面板
 *    本身，而面板在静态渲染下**永远到不了**（它的 `state` 要等 `useModFolders()` 的回包）
 *    ⇒ 只有外壳的 loading 支路画着 tab 条，"默认选中"才断言得到（报告里记着这处偏离）。
 */

/** 一次页面外壳渲染（装桩 → 渲染 `Files` → 立刻拆桩；与 ⑰ 逐字同一个写法）。 */
function pageShellOf(withModFolders: boolean): string {
  Object.assign(globalThis, { mcsr: shellStub(withModFolders) });
  const markup = keep(
    html(React.createElement(MemoryRouter, null, React.createElement(Files, null))),
  );
  delete (globalThis as { mcsr?: unknown }).mcsr;
  return markup;
}

// ---------------------------------------------------------------------------
// ㉝ tab 骨架：两个 tab、默认在「mod 下载」、工具下载是占位（spec §4 / §9.6）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 判据全部**渲染**出来（没有一条是"扫源码"）：tab 的选中态是 `aria-selected`，
 *    而它只在产物里看得见。⚠️ 三条反面各管一种假通过：
 *      · 只断言"mods 被选中" ⇒ "两个都选中"照样绿（下面第二条）；
 *      · 只断言"没有 modFolders 时画了那句话" ⇒ "tab 也画出来了"照样绿（第四条）。
 * ★ 能红的刀（跑过的读数在报告里）：① 把 `useState('mods')` 改成 `useState('tools')`
 *   ⇒ 第一条红；② 把 tab 条画到"没有 `modFolders`"那一支上 ⇒ 第四条红。
 */
const modTabShellHtml = pageShellOf(true);
const oldShellTabHtml = pageShellOf(false);
assert.ok(
  /data-tab="mods"[^>]*aria-selected="true"/.test(modTabShellHtml),
  '★★ 默认选中的是「mod 下载」（真的渲染了一次页面外壳；桩是 `shellStub(true)`）',
);
assert.equal(
  /data-tab="tools"[^>]*aria-selected="true"/.test(modTabShellHtml),
  false,
  '★★ 反面：同一份产物里「工具下载」**没有**被选中（两条一起才排除"两个都是 true"那一类假通过）',
);
assert.ok(
  textOf(modTabShellHtml).includes(textOf(resolved('files.tabMods'))) &&
    textOf(modTabShellHtml).includes(textOf(resolved('files.tabTools'))),
  '★ 两个 tab 都在页面外壳上（判据是两条词条都**解析出了译文**，不是"含某个字符串"）',
);
assert.ok(
  textOf(modTabShellHtml).includes(textOf(resolved('files.catalogScanning'))),
  '★ 新通道那一支的第一帧仍然画在**mod 下载**这一格里（Ruling 42；⑰ 钉的是同一屏的文案）',
);
assert.equal(
  oldShellTabHtml.includes('data-tab='),
  false,
  '★★ 反面（spec §9.12 / D1）：没有 `modFolders` 的壳上**一个 tab 都没有** —— ' +
    '那一档只有"需要桌面版 0.0.5"那一句（无条件画 tab 会让"没有这个能力"看起来像"还没加载"）',
);
/*
 * ★★ 夹具与契约逐条对账（T2 复审点名的那条交接）：`shellStub` 是**无类型**的对象字面量
 *    ⇒ 契约加一条通道而桩忘了加时，没有任何门禁会出声，而那一格在页面上的覆盖是零。
 */
assert.deepEqual(
  Object.keys(shellStub(true).modFolders ?? {}).sort(),
  Object.keys(MOD_FOLDERS_CHANNELS).sort(),
  '★★ 桌面壳桩必须逐条列出契约里的**全部**通道（`MOD_FOLDERS_CHANNELS` 是唯一真相）：' +
    '少一条 ⇒ 那一格在夹具里等于"这个壳没有这个能力"，而那正是"按钮零覆盖"的形状',
);
const toolsPanelHtml = keep(html(React.createElement(ToolsPanel, null)));
assert.ok(
  textOf(toolsPanelHtml).includes(textOf(resolved('files.toolsComingSoon'))),
  '★ 「工具下载」那一格是占位卡、而且写明"待更新"（绝不留空白：空白分不出"还没做"与"坏了"）',
);
ok(
  '㉝ tab 骨架：两个 tab 都在、默认选中「mod 下载」、没有 modFolders 时一个 tab 都不画、工具下载写明"待更新"、桩与契约逐条对账',
);

// ---------------------------------------------------------------------------
// ㉞ 按版本分组的文件夹区：折叠行 + 展开标识 + 打开文件夹（spec §9.7/§10/§12/§17）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 夹具用的是这份自检里**已有的** `folder()` / `stateOf()`（`f1` / `f1b` 这两个 id 是这一组
 *    自己写的，不是从产品里抄的常量）。
 * ⚠️★ **两个**同版本的文件夹（判修 2a）：只给一个的话，"只画第一个文件夹"那种回归
 *    （`.map` → `.slice(0, 1)` / `.find`）**完全无声** —— 而 §9.7 说的正是"一个版本下画出
 *    它的**多个**文件夹"。⇒ 断言里两个 id 都要在。
 * ⚠️★「折叠态：没有 jar 行」这一半**今天咬不住**：T4 的 `data-jar` 还不存在
 *    ⇒ `!includes('data-jar="')` 恒真（§5.32①）。它的牙齿由**另一半**补上：
 *    "折叠时**展开体整块不渲染**"（`data-folder-body` 不在产物里），那一半有刀。
 * ⚠️★ 三条与"内容"有关的空态都落在**展开体**里（spec §8：路径不存在"展开后说明"），
 *    而折叠时它们一个都不画 —— 与"头行永远看得见的那一格"是徽章（`FolderStatusBadge`）。
 */
const skeletonState = stateOf([ROW_GITHUB], {
  folders: [folder({ folderId: 'f1' }), folder({ folderId: 'f1b' })],
});
const skeletonHtml = keep(
  html(
    React.createElement(ModDownloadPanel, { state: skeletonState, onAction: noop, progress: null }),
  ),
);
assert.ok(
  skeletonHtml.includes('data-folder-id="f1"') && skeletonHtml.includes('data-folder-id="f1b"'),
  '★★ 该版本的文件夹**都**画出来了（两个同版本的 id 都在 —— 只画第一个的实现会红在这里）',
);
/*
 * ⚠️★ 这里原来有一条 `assert.equal(skeletonHtml.includes('data-jar="'), false)` ——
 *    它在 T4 之前**恒真**（`data-jar` 那时还不存在：§5.32① 那一类），T4 把它改成了
 *    **正反一对**、并且搬到 `collapsedListHtml` / `expandedListHtml` 那两个产物上
 *    （下面"折叠 / 展开两态"那一段）：折叠态没有 jar 行 **且** 展开态真的有一行。
 */
assert.match(
  skeletonHtml,
  /data-folder-id="f1"[\s\S]{0,400}?aria-expanded="false"/,
  '★★ 折叠行带展开标识（spec §8 最后一行：▸/▾ + 文案 + `aria-expanded`）',
);
assert.match(
  skeletonHtml,
  /data-folder-id="f1"[\s\S]{0,800}?data-action="open-folder"/,
  '★ 每个文件夹行都有「打开文件夹」（spec §9.13 的按钮就在这一行里）',
);
assert.equal(
  textOf(skeletonHtml).includes(textOf(resolved('files.partOneTitle'))),
  false,
  '★★ 第一部分（目录行那一块）**不再出现在这一页上**（spec §9.12）',
);
assert.equal(
  textOf(skeletonHtml).includes(textOf(resolved('files.bindLocal'))),
  false,
  '★★ 反面：v1 的「绑定本地文件」也不在。⚠️ 计划里那条断言写的是 `files.bindLocalFile`，' +
    '而**没有这个键**（`t()` 对未知 key 原样返回 key ⇒ 那条断言恒真）；这里换成真的那个键 ' +
    '`files.bindLocal` —— 而且用 `resolved()` 自钉（键名再写错一次会当场红）',
);
/*
 * ★★ 折叠 / 展开两态：`VersionFolderList` 是**纯 props** 组件 ⇒ 两次渲染。
 *    ⚠️ 这是"T4 加 jar 列表之前"折叠态"什么都没有"唯一证明得了的形状。
 */
const collapsedListHtml = keep(
  html(
    React.createElement(VersionFolderList, {
      state: skeletonState,
      page: planVersionPage(skeletonState, []),
      expanded: [],
      onToggle: noop,
      onAction: noop,
      progress: null,
    }),
  ),
);
const expandedListHtml = keep(
  html(
    React.createElement(VersionFolderList, {
      state: skeletonState,
      page: planVersionPage(skeletonState, ['f1']),
      expanded: ['f1'],
      onToggle: noop,
      onAction: noop,
      progress: null,
    }),
  ),
);
assert.equal(
  collapsedListHtml.includes('data-folder-body'),
  false,
  '★★ 折叠时**展开体整块不渲染**（"折叠态没有 jar 行"今天唯一有牙齿的判据）',
);
/*
 * ★★ T4（判修：把一条**恒真**的断言换成一正一反）—— 原来这里写的是
 *    `assert.equal(skeletonHtml.includes('data-jar="'), false)`，而 T4 之前 `data-jar`
 *    这个属性**根本不存在**（§5.32① 的第一类：断言恒真）。现在两个方向各有一条读数，
 *    而且它们必须**同时**成立才说明"折叠/展开真的分岔"：
 *      · 折叠态没有 jar 行 —— 一个"永远不画 jar 行"的实现过得了这一条；
 *      · 展开态**真的**画出那一行 —— 一个"折叠时也画"的实现过得了这一条。
 */
assert.equal(
  collapsedListHtml.includes('data-jar="'),
  false,
  '★★ 折叠态：一行 jar 都没有（T4 起这一条与下面那条**互为反面**）',
);
assert.ok(
  expandedListHtml.includes('data-jar="sodium"'),
  '★★ 而展开时那个文件夹里的 jar 行真的在（`f1` 的默认两行里有 `sodium`）—— ' +
    '与上面那条**独立**：只写"折叠时没有"的话，"永远不画 jar 行"照样绿（那正是 T4 之前那条断言的形状）',
);
assert.match(
  expandedListHtml,
  /data-folder-id="f1"[\s\S]{0,400}?aria-expanded="true"/,
  '★★ 展开态：同一个标记变成 `true`（两条一起才排除"写死 false"—— spec §9.10 要求"值随展开变化"）',
);
assert.ok(
  expandedListHtml.includes('data-folder-body="f1"'),
  '★ 而展开时那一块真的在（T4 会把 jar 列表放进它里面）',
);
/*
 * ★★ 判修 2b：**旧那一版的全套控件**（spec §9.17：A 只挪位置，不删能力）。
 *    ⚠️ 判修前的覆盖只有 `open-folder` 与 `bind-folder` ⇒ 自动更新开关 / 批量通道 /
 *    全部更新 / 重扫 / 解绑 / 版本手改**全都不见了也不会红**。
 *    ⚠️ 锚的是**产物里那颗按钮的文字与那两个下拉的内容**（不锚函数名、也不锚 class）：
 *    与 ⑱ 那一条对旧行是同一个口径。
 */
const f1Row = folderRowSpanOf(skeletonHtml, 'f1');
assert.deepEqual(
  labelsIn(f1Row),
  [
    labelOf('files.expand'),
    labelOf('files.openFolder'),
    labelOf('files.folderUpdateAll', { count: 2 }),
    labelOf('files.folderRescan'),
    labelOf('files.unbind'),
  ],
  '★★ 那一行的控件**一颗都不许少**：展开 / 打开文件夹 / 全部更新（带 `batchTargets` 的数字）/ ' +
    '重扫这个文件夹 / 解除绑定 —— 一条不许少、也不许多',
);
assert.deepEqual(
  selectsIn(f1Row).map((select) => select.values),
  [
    ['', '1.16.1'],
    ['origin', MIRROR.id],
  ],
  '★★ 两个下拉都在：版本手改（空取值 = 交回自动推断 + 状态里的版本全集）与批量通道' +
    '（`origin` + 状态里的镜像表 —— Ruling 58 / 55 的那两个唯一来源）',
);
assert.deepEqual(
  selectsIn(f1Row).map((select) => select.selected),
  ['1.16.1', 'origin'],
  '★ 而且两个的当前值都来自状态（`folder.gameVersion` / `prefs.bulkChannel`，Ruling 23 一处记忆）',
);
const rowBoxes = [...f1Row.matchAll(/<input type="checkbox"[^>]*>/g)];
assert.equal(
  rowBoxes.length,
  1,
  '★ 那一行恰好一个勾选框：整夹自动更新开关（spec §9.17 清单里的单独一项）',
);
assert.ok(
  /* ⚠️ 比 `decode(…)` 之后的产物：英文那条词条里带引号，属性值里会被转义（与 ⑱ 同一条）。 */
  decode(f1Row).includes(t('files.autoLabel', { name: 'D:\\instances\\f1\\mods' })),
  '★ 那个勾选框的可访问名里带**路径**（一页上好几个文件夹，读屏要分得开是哪一个）',
);
/*
 * ★★ 判修 4①：**过期批量通道那句解释**（`files.channelStaleHint`）。
 *    ⚠️ 那一档「全部更新」在每一行上都不画（`canUpdateFolderAll` 里那条"通道还成立"）——
 *    没有这句话，用户看到的只有"按钮怎么没了"。渲染点在**面板级**（说一次就够）。
 */
const staleChannelState = stateOf([ROW_GITHUB], {
  folders: [folder({ folderId: 'f1' })],
  bulkChannel: { mirrorId: 'gh-proxy-GONE' },
});
const staleChannelPanelHtml = keep(
  html(
    React.createElement(ModDownloadPanel, {
      state: staleChannelState,
      onAction: noop,
      progress: null,
    }),
  ),
);
assert.ok(
  textOf(staleChannelPanelHtml).includes(textOf(resolved('files.channelStaleHint'))),
  '★★ 过期通道 ⇒ 那句解释必须看得见（Ruling 64）—— 那一档那颗按钮不画，' +
    '没有这句话用户只会觉得"按钮怎么没了"',
);
assert.equal(
  textOf(skeletonHtml).includes(textOf(resolved('files.channelStaleHint'))),
  false,
  '★ 反面：通道成立时**不许**出现那句（一句只在它那一档出现的解释）',
);
/*
 * ★★ 判修 4②：Ruling 65 的**两支**在展开体里各要有一个渲染点 ——
 *    "读不了"（`!hasReading`）与"读到过、里面没有"（`hasReading && rows.length === 0`）。
 *    ⚠️ 少了后半支，扫过但是空的文件夹展开后是一个**空白框**（§8 的三种空态少一种）。
 *    ⚠️ 两条互为对照（同一份 `rows: []`，只有 `hasReading` 不同），与 ㉚ 对旧组件那一组同形。
 */
const newEmptyReadState = stateOf([ROW_GITHUB], {
  folders: [folder({ folderId: 'f-empty', hasReading: true, rows: [], unrecognized: [] })],
});
const newEmptyReadHtml = keep(
  html(
    React.createElement(VersionFolderList, {
      state: newEmptyReadState,
      page: planVersionPage(newEmptyReadState, ['f-empty']),
      expanded: ['f-empty'],
      onToggle: noop,
      onAction: noop,
      progress: null,
    }),
  ),
);
assert.ok(
  textOf(newEmptyReadHtml).includes(textOf(resolved('files.folderNoRows'))),
  '★★ 读到过而一个能识别的 mod 都没有 ⇒ 说"里面没有能识别的 mod"（Ruling 65 的后半支）',
);
assert.equal(
  textOf(newEmptyReadHtml).includes(textOf(resolved('files.folderNoReading'))),
  false,
  '★ 反面：这一档**不许**说"还没有读数"（两句话说的是两件事）',
);
const newNoReadingState = stateOf([ROW_GITHUB], {
  folders: [folder({ folderId: 'f-noreading', hasReading: false, rows: [], unrecognized: [] })],
});
const newNoReadingHtml = keep(
  html(
    React.createElement(VersionFolderList, {
      state: newNoReadingState,
      page: planVersionPage(newNoReadingState, ['f-noreading']),
      expanded: ['f-noreading'],
      onToggle: noop,
      onAction: noop,
      progress: null,
    }),
  ),
);
assert.ok(
  textOf(newNoReadingHtml).includes(textOf(resolved('files.folderNoReading'))),
  '★★ 没有成功读数 ⇒ 说"还不知道里面有什么"（Ruling 65 的前半支）',
);
assert.equal(
  textOf(newNoReadingHtml).includes(textOf(resolved('files.folderNoRows'))),
  false,
  '★★★ 反面：那一档**不许**印"里面没有能识别的 mod"—— 那是**编出来的结论**（Ruling 65 的判据）',
);
/* —— 空态（spec §8 第一行）：这个版本下一个文件夹都没绑 —— */
const noFolderState = stateOf([ROW_GITHUB], { folders: [] });
const noFolderPanelHtml = keep(
  html(
    React.createElement(ModDownloadPanel, { state: noFolderState, onAction: noop, progress: null }),
  ),
);
assert.ok(
  textOf(noFolderPanelHtml).includes(textOf(resolved('files.folderNoneVersion'))),
  '★ 空态：这个版本下没有文件夹要**说出来**（0 行 ⇒ 用户分不出"没有"与"没渲染"）',
);
assert.ok(
  noFolderPanelHtml.includes('data-action="bind-folder"'),
  '★ 而且空态里那一颗「添加文件夹」**在**（spec §8 第一行；⚠️★ G1 之前它是**唯一**的入口，' +
    '所以这一条当时同时承担着"能不能加"与"至少有一条路"两件事 —— 现在它只管前者，' +
    '下面那条管后者）',
);
/*
 * ★★ G1（最终修复波）：**已经有文件夹**的版本也必须有一个添加入口。
 *
 * 现场：修之前唯一的渲染点在 `page.folders.length === 0` 那一支里 ⇒ 一个版本只要绑过
 * 一个文件夹，就**再也没有**「添加文件夹」这条路，而 spec §2.1 第 2 条明写"一个版本下可以
 * 绑定**多个** mod 文件夹"（D3 也按这个前提写）⇒ 那半条目标在界面上根本无法达成
 * （用户只能先解绑再绑，而解绑会丢掉那个文件夹的扫描读数）。
 * ⚠️★ 判据用**有 1 个文件夹**的那一份面板（那一支里空态块**不渲染**）⇒ 产物里那颗
 *    `data-action="bind-folder"` 只可能来自**常驻的那一颗**，上面那条空态断言证不了它。
 * ★ 刀（读数在报告里）：把 `VersionFolderList` 里那个 `folderlist__actions` 那一块删掉
 *   ⇒ 这一条红（上面那条照旧绿）。
 */
const oneFolderPanelHtml = keep(
  html(
    React.createElement(ModDownloadPanel, {
      state: stateOf([ROW_GITHUB], { folders: [folder({ folderId: 'f1' })] }),
      onAction: noop,
      progress: null,
    }),
  ),
);
assert.ok(
  oneFolderPanelHtml.includes('data-folder-count="1"'),
  '★ 对照（这一条钉的是**夹具**）：这一份面板真的画出了**1 个**文件夹（`data-folder-count="1"`）' +
    '—— 否则下面那条"常驻入口在"会因为空态块也在渲染而变成空跑',
);
assert.ok(
  oneFolderPanelHtml.includes('data-action="bind-folder"'),
  '★★ G1：这一版**已经有文件夹**，而「添加文件夹」照样在（spec §2.1 第 2 条：一个版本可以绑多个）' +
    '—— 修之前这一条是**空跑**：产物里一个 `bind-folder` 都没有',
);
/* —— 迁移提示（§13.1）：原来的渲染点在第一部分，而第一部分不在这一页上了 —— */
const noticePanelHtml = keep(
  html(
    React.createElement(ModDownloadPanel, {
      state: stateOf([ROW_GITHUB], { folders: [folder({ folderId: 'f1' })], notices: [NOTE] }),
      onAction: noop,
      progress: null,
    }),
  ),
);
assert.ok(
  textOf(noticePanelHtml).includes(textOf(NOTE)),
  '★★ `notices`（迁移提示"已转为文件夹跟踪：…"）必须**看得见**（§13.1）—— ' +
    '它原来的渲染点在第一部分，而第一部分在 T3 从页面上消失 ⇒ 渲染点跟着搬到了面板上',
);
ok(
  '㉞ 按版本分组的文件夹区：两个同版本的文件夹都画出来、那一行的全套控件（展开/打开文件夹/版本手改/自动更新/批量通道/全部更新/重扫/解绑）、折叠与展开两态、过期通道那句解释、Ruling 65 的两支空态、版本空态与绑定入口（**G1 起：空态与"已经有文件夹"两档都有一颗**）、迁移提示；第一部分与 v1 的元素不再出现',
);

// ---------------------------------------------------------------------------
// ㉟ 跨版本列表 + 动作失败的落点 + 三条接线守卫（spec §9.11 / §8）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 「显示全部已绑定的文件夹」那一栏是**跨版本**的：夹具刻意放两个版本，
 *    而断言必须先证明两个都在（否则"含 f2"可能只是"只画了 f2"）。
 * ⚠️★ 动作失败那一格是**渲染点**的判据（静态渲染不跑事件处理器 ⇒ 证不了 catch 真的跑过）：
 *    把原话喂进 props，它必须出现在产物里。`openFolder` 对未知 id 会**抛**
 *    （`mod-folders.ts:941` 的 `requireFolder`），而"渲染后又被解绑"真的会发生。
 *    能红的刀：把那一格 `<Notice>` 删掉 ⇒ 红。
 * ⚠️★ 后面三条是**接线守卫**（与 ⑯/㉖/㉗ 同一族）：产物里看不见事件处理器，
 *    这里钉"那条线在、而且接的是这一行的那个 id"。
 */
const crossState = stateOf([], {
  folders: [
    folder({ folderId: 'f1', gameVersion: '1.16.1' }),
    folder({ folderId: 'f2', gameVersion: '1.8.9' }),
  ],
});
const crossHtml = keep(
  html(
    React.createElement(AllFoldersView, {
      groups: groupFoldersByVersion(crossState),
      onAction: noop,
    }),
  ),
);
assert.ok(
  crossHtml.includes('data-folder-id="f1"') && crossHtml.includes('data-folder-id="f2"'),
  '★ 对照：两个版本的文件夹都在这一栏里（下面那条"含 f2"因此不是空跑）',
);
assert.ok(
  crossHtml.includes('data-folder-id="f2"'),
  '★★ 「显示全部已绑定的文件夹」那一栏含**另一个版本**的文件夹（spec §9.11）',
);
assert.ok(
  textOf(crossHtml).includes(textOf('1.8.9')),
  '★ 分组标题也印版本号（⚠️ 这一条**只**证"1.8.9 在产物里"—— 行内那一颗由下面那条锚住）',
);
assert.match(
  crossHtml,
  /data-folder-id="f2"[\s\S]{0,400}?1\.8\.9/,
  '★★ 那个文件夹**自己那一行**要带版本标签（判修 5：不锚在行上的话，把行内那颗徽章删掉' +
    '照样绿 —— 分组标题已经印了同一个版本号，所以原来那条断言的证据是"标题"而不是"这一行"）',
);
const failedPanelHtml = keep(
  html(
    React.createElement(ModDownloadPanel, {
      state: skeletonState,
      onAction: noop,
      actionError: 'BOOM-1',
      progress: null,
    }),
  ),
);
assert.ok(
  textOf(failedPanelHtml).includes(textOf(resolved('files.actionFailed', { message: 'BOOM-1' }))),
  '★★★ 一次动作失败的原话必须**看得见**（`ModDownloadPanel` 的那一格 `Notice`）—— ' +
    '接住了却不显示，与"未处理的 rejection"对用户是同一件事（什么都没发生）',
);
const versionListCode = withoutComments(
  readFileSync(new URL('../src/components/VersionFolderList.tsx', import.meta.url), 'utf8'),
);
const downloadPanelCode = withoutComments(
  readFileSync(new URL('../src/components/ModDownloadPanel.tsx', import.meta.url), 'utf8'),
);
const fePanelCode = withoutComments(
  readFileSync(new URL('../src/components/ModFoldersData.tsx', import.meta.url), 'utf8'),
);
/*
 * ⚠️ `VersionFolderList.tsx` 的源码在**两处**被读：㊱ 里的 CT-4 源码守卫（"`homepageOf`
 *    从投影摊"）与 ㊴ 里的 G2 四条（"添加文件夹那条线带着版本"）。⇒ 定义在这里（第一次用到
 *    之前），后面直接用。
 */
const versionFolderListCode = withoutComments(
  readFileSync(new URL('../src/components/VersionFolderList.tsx', import.meta.url), 'utf8'),
);
assert.match(
  versionListCode,
  /data-action="open-folder"[\s\S]{0,400}?onAction\(\{\s*kind:\s*'open-folder',\s*folderId:\s*block\.folder\.folderId,?\s*\}\)/,
  '★★ 「打开文件夹」必须把**这一行那个** folderId 发出去（写死一个 id ⇒ 点 A 打开 B，而产物里看不出来）',
);
assert.match(
  fePanelCode,
  /openFolder:\s*async\s*\(folderId:\s*string\)[\s\S]{0,600}?catch\s*\(/,
  '★★ `handlers.openFolder` 必须在**动作层**接住那个 reject：主进程对未知 id 是**抛**，' +
    '而契约类型写的是返回 `{ok:false, reason}` ⇒ 少了这个 catch 就是一次未处理的 rejection ' +
    '（接住之后走 `actionError`，上面那条渲染点把它印出来）',
);
assert.match(
  downloadPanelCode,
  /try\s*\{[\s\S]{0,300}?await onAction\(/,
  '★★ `ModDownloadPanel` 的包装必须在 `try` 里 `await onAction(...)`：`onAction` 是**页面的接缝**，' +
    '实现换成一个会 reject 的版本时，未处理的 rejection 要在这里被接住',
);
assert.ok(
  textOf(expandedListHtml).includes(textOf('D:\\instances\\f1\\mods')),
  '★ 行里印的是**状态里那个路径**（`folder.path`）—— 写死一个目录的话，绑第二个文件夹就露馅',
);
ok(
  '㉟ 跨版本列表（含另一个版本的文件夹 + 行内版本标签）、动作失败的原话看得见、三条接线守卫（openFolder 的实参 / 动作层的 catch / 面板的 try-await）',
);

// ===========================================================================
// Task 4（A 的第四片）：展开的文件夹 —— jar 列表 + 未识别标红
// ===========================================================================
/*
 * ⚠️★ 这一组验的是**展开体里那张表**（`FolderJarList`）：已识别行（文件名 / mod 名 /
 *    本地版本 / 下载链接 / homepage / 既有徽章与操作）与**未识别行**（标红）。
 *
 * ⚠️★ 夹具必须让 `homepage` **真的非空**（T1 评审点名过的那件事）：`homepageOf` 由页面从
 *    `state.catalogRows` 组装，而带 homepage 的目录行只有 `planCatalogRows` 那一支
 *    ⇒ 夹具写 `stateOf([], …)` 会让"homepage 链接"那条**恒红、而且原因不对**。
 *    这里展开一个**已有的目录行常量**（`ROW_GITHUB`）并覆盖 `homepage`；覆盖值与常量里
 *    那个**不同** ⇒ "href 就是目录里那个值"这条同时排除了"照抄夹具常量"。
 * ⚠️★ `FolderUnrecognizedRow.reason` 是**必填**的（`'no-fabric-meta' | 'not-in-catalog'`）：
 *    计划/简报的夹具写的是 `{ fileName: 'mystery.jar' }`（**少一格**）—— 而那在本仓
 *    **不会**变成编译错（`scripts/**` 不在任何 tsconfig 里，见 ㊱ 开头那句夹具自钉的注释），
 *    它会静默落进"不是 `no-fabric-meta`"那一支 ⇒ 报成"清单外"（**说错原因**）。
 *    这里两类**各给一个** —— 旧第二部分那两句解释必须分得开（它们不许被合成一句）。
 */

/** 目录里那个 mod 的 homepage（`ROW_GITHUB` 的兜底值；这一组会**覆盖**它，见下）。 */
const HOMEPAGE_IN_CATALOG = 'https://example.invalid/sodium-project';

/*
 * ★★ 夹具自钉：`ROW_GITHUB` 那一格**真的**非空。
 *
 * ⚠️★ 为什么这一条必须存在（T4 的刀 K14 实测出来的）：`CatalogRowView.homepage` 是从
 *    "可选"改成**必填**的（T1 评审留给 T4 的待办），而 `apps/web/scripts/**`
 *    **不在任何 tsconfig 的 `include` 里**（`tsc` 不看这些文件，`tsx` 只剥类型、
 *    不做检查 —— 实测：往本文件里插一句 `const x: number = 'not-a-number';`，
 *    `pnpm -F @mcsr/web typecheck` 与这个脚本**双双照样绿**）。
 *    ⇒ "夹具忘了写 homepage"在**门禁上完全无声**，而那正是那个待办要消灭的那一种坏。
 *    类型层面的判据只能靠一次性的 `tsc` 探针（报告 §刀 K14 里给了全文与命令）；
 *    这里补的是**跑得起来**的那一条：忘写 ⇒ 这一句当场红。
 */
assert.ok(
  ROW_GITHUB.homepage,
  '夹具自钉：`ROW_GITHUB` 必须带一个非空 homepage —— 这一格是**必填**的，' +
    '而 `scripts/**` 不在任何 tsconfig 里（"忘了写"在门禁上是无声的，只有这一条抓得住）',
);

/**
 * 渲染一个文件夹**展开体里那张 jar 表**（`FolderJarList` 是纯 props 组件 ⇒ 喂一份投影就画）。
 *
 * ⚠️★ `homepageOf` 的组装**逐字照页面当年的那一句**（`new Map(state.catalogRows.map(…))`）。
 *    ⚠️★ **CT-4（最终修复波）之后页面改成了从投影摊**（`new Map(page.mods.map(…))`）——
 *    这一份**自检自己的**夹具仍然照旧（两处的值今天逐格相同，见下面那条源码守卫：
 *    它才是"页面那一侧用的是投影"的判据）。⇒ 这里不改，是因为它测的是 `FolderJarList`
 *    收到一份 Map 之后画成什么样，与那份 Map 从哪来无关。
 *    ⚠️★ **但这一组里"喂 prop"那几条证明不了"页面真的喂了它"**（判修轮订正，2026-10-04）：
 *    这一组里三格 prop（`homepageOf` / `mirrors` / `busy`）都是**自检自己传的** ⇒ 把
 *    `VersionFolderList` 那一处调用点换成空 Map / 空镜像表 / 写死 `busy={false}`，
 *    **那几条**一条都不会红（评审点名的那条：注释原来谎称"由 ㊲ 与那一处调用点兜着"，
 *    而 ㊲ 只读 `FolderJarList.tsx` / `Files.tsx` / `ModDownloadPanel.tsx` 的**源码**）。
 *    ⇒ 页面那一侧的证据是**同一组里 ⑥ 那三条**，它们打在 **`VersionFolderList` 的产物**上
 *    （⚠️★ 2026-10-04 T6 顺手改准的那句话：原稿写的是"**这一组**一条都不会红" ——
 *    而 ⑥ 就在这一组里，它**会**红：那句话比事实强，正是 AGENTS §5.24 记的那种"散文字数"）。
 *
 * ⚠️★★ T5 修复轮 1（评审 Important 1）：**`progress` 从外面喂进来**（默认 `null`）——
 *    修之前这个 helper 写死 `progress: null` ⇒ "页面把进度传下来"这件事在组件级**无从断言**。
 *    下面㊶ 里用它跑一正一反（命中 / 把 `modid` 换成别的）。
 */
function jarListHtmlOf(
  state: ModFoldersState,
  folderId: string,
  progress: PageProgress | null = null,
): string {
  const page = planVersionPage(state, [folderId]);
  const block = page.folders.find((candidate) => candidate.folder.folderId === folderId);
  assert.ok(block, `夹具自钉：\`${folderId}\` 在投影里（不在的话下面每一条断言都是空跑）`);
  return keep(
    html(
      React.createElement(FolderJarList, {
        block,
        homepageOf: new Map(state.catalogRows.map((r) => [r.modid, r.homepage ?? null])),
        mirrors: state.mirrors,
        busy: state.busy,
        onAction: noop,
        progress,
      }),
    ),
  );
}

// —— ① 一个已识别 + 两类未识别的夹具 ——
const rowWithHome = { ...ROW_GITHUB, homepage: HOMEPAGE_IN_CATALOG };
const jarState = stateOf([rowWithHome], {
  folders: [
    folder({
      folderId: 'f-jars',
      rows: [folderRow({ modid: 'sodium', name: 'Sodium' })],
      unrecognized: [
        { fileName: 'mystery.jar', reason: 'not-in-catalog' },
        { fileName: 'broken.jar', reason: 'no-fabric-meta' },
      ],
    }),
  ],
});
const jarListHtml = jarListHtmlOf(jarState, 'f-jars');
assert.ok(
  jarListHtml.includes('data-jar-count="3"'),
  '★★ 列表自己报条数（1 个已识别 + 2 个未识别）—— 与下面那些行标记**独立**的一条读数',
);
/*
 * ★ 已识别那一行：**扫描读数**（文件名不是 modid）+ mod 名 + 本地版本 + 两个链接 + 两颗按钮。
 *   ⚠️ 锚的是产物里的文字与 `href`，不锚 class（与 ⑱/㉑ 对旧行同一个口径）。
 */
assert.deepEqual(
  labelsIn(jarRowOf(jarListHtml, 'sodium')),
  [labelOf('files.updateOrigin'), labelOf('files.updateMirror')],
  '★★ 已识别的行给**既有那两颗**更新按钮（`older` + GitHub 来源 ⇒ 镜像那颗也在）：' +
    '判据与旧第二部分 `ModFoldersPanel.FolderRow`（T6 已删）**逐字相同**（`older | different-build` 且非 manual）',
);
assert.ok(
  textOf(jarRowOf(jarListHtml, 'sodium')).includes('sodium-build-A.jar') &&
    textOf(jarRowOf(jarListHtml, 'sodium')).includes('Sodium') &&
    textOf(jarRowOf(jarListHtml, 'sodium')).includes('0.1.2'),
  '★★ 那一行印的是**扫描读数**：文件名（`row.fileName`，不是 modid）+ mod 名 + 本地版本',
);
/*
 * ★★ `busy`（主进程正在写盘）：那两颗按钮**禁用**（不是消失）—— 与头行、旧那一部分
 *    逐字同一条（`disabled={busy}` 是"别在写盘期间再发一次"的唯一表达）。
 *    ⚠️ 夹具只把 `state.busy` 翻成 `true`，别的格一个都不动 ⇒ 红点只可能落在这一条上。
 */
const busyJarHtml = jarListHtmlOf({ ...jarState, busy: true }, 'f-jars');
assert.deepEqual(
  buttonsIn(jarRowOf(busyJarHtml, 'sodium')).map((button) => button.disabled),
  [true, true],
  '★★ 正在写盘 ⇒ 那两颗更新按钮都**禁用**（`busy` 从状态来，不是这一层自己记的）',
);
assert.deepEqual(
  buttonsIn(jarRowOf(jarListHtml, 'sodium')).map((button) => button.disabled),
  [false, false],
  '★ 反面：不忙时两颗都可用（只写"忙时禁用"的话，一个恒禁用的实现照样绿）',
);
assert.match(
  jarListHtml,
  /data-jar="sodium"[\s\S]{0,600}?<a[^>]+data-link="download"[^>]*href="/,
  '★★ 已识别的行给**下载链接**（`row.official.url`；`official === null` 的那一档印 `—`）—— ' +
    '⚠️ 窗口 600 字符：那一格必须排在前面几格之内（排到行尾会红，那是**排版**的判据）。' +
    '⚠️★ 判据里**必须**带 `data-link="download"`：简报那条裸 `<a[^>]+href=` **不是**这一条的判据 —— ' +
    '下面那条 homepage 的 `<a>` 也在 600 字符之内 ⇒ 把下载那一格整个删掉，裸正则**照样绿**' +
    '（刀 K4 实测过：删掉下载链接后红的是下面那条 `deepEqual`，不是这一条）',
);
assert.match(
  jarListHtml,
  /data-jar="sodium"[\s\S]{0,900}?data-link="homepage"/,
  '★★ 而且给 **homepage 链接**（`data-link="homepage"` 是它的机器读数）',
);
assert.deepEqual(
  linksIn(jarRowOf(jarListHtml, 'sodium')).map((link) => link.href),
  [SODIUM_NEW.url, HOMEPAGE_IN_CATALOG],
  '★★★ 那两颗链接的 `href` 各来自**状态**：下载那一格是 `row.official.url`、homepage 那一格是' +
    '`homepageOf` 里那个值 —— 写死一个地址、或者拿候选兜底，都会红',
);
assert.ok(
  textOf(jarListHtml).includes(textOf(resolved('files.jarUnrecognized'))),
  '★ 未识别那一行说了一句"认不出这是目录里的哪个 mod"（spec §8 那一格）',
);
// —— ② 未识别那两行：真的画出来了、**带机器读数与类名**、而且两类原因分开说 ——
const unrecognizedJarRows = [
  ...jarListHtml.matchAll(/<tr class="jarrow jar--unrecognized"[\s\S]*?<\/tr>/g),
].map((match) => match[0]);
assert.equal(
  unrecognizedJarRows.length,
  2,
  '★★ 两个未识别的条目**各占一行**（塞进一行、或者只画第一个，都会红）',
);
assert.match(
  jarListHtml,
  /<tr class="jarrow jar--unrecognized"[^>]*data-jar-unrecognized="true"/,
  '★★★ 未识别那一行带**机器读数** `data-jar-unrecognized="true"` **与**那个类名 —— ' +
    '两样都要（读数给自检、类名给 `styles.css` 上那条红规则）',
);
/** 那两行里带 `fileName` 的那一行（`fileName` 是扫描读数，必然在文件名那一格里）。 */
function unrecognizedJarRowOf(fileName: string): string {
  const found = unrecognizedJarRows.find((row) => textOf(row).includes(fileName));
  assert.ok(found, `产物里找不到未识别的那一行（${fileName}）—— 那一行没渲染出来`);
  return found;
}
assert.ok(
  textOf(jarListHtml).includes('mystery.jar') && textOf(jarListHtml).includes('broken.jar'),
  '★★ 两个未识别的**文件名**都在产物里（`fileName` 是磁盘上的内容、不翻译）',
);
assert.ok(
  textOf(unrecognizedJarRowOf('mystery.jar')).includes(
    textOf(resolved('files.folderUnrecognizedNotInCatalog', { name: 'mystery.jar' })),
  ),
  '★★ 「清单外」那一句（复用旧第二部分那条词条：它是这句话**唯一**的实现）',
);
assert.ok(
  textOf(unrecognizedJarRowOf('broken.jar')).includes(
    textOf(resolved('files.folderUnrecognizedNoMeta', { name: 'broken.jar' })),
  ),
  '★★ 「读不出 `fabric.mod.json`」那一句（与上一条各自成立 ⇒ 不是"两句都印"）',
);
assert.equal(
  textOf(unrecognizedJarRowOf('broken.jar')).includes(
    textOf(resolved('files.folderUnrecognizedNotInCatalog', { name: 'mystery.jar' })),
  ),
  false,
  '★ 反面：这一行**不许**印另一类原因的那句话（两类合成一句正是旧那一版不许做的事）',
);
// —— ③ 红是**真的**：`styles.css` 里那条规则 ——
/*
 * ⚠️★ 为什么要有这一段：`data-jar-unrecognized` 与那个类名都只是"名字"——
 *    把 `styles.css` 里那条规则删掉，那一行在屏幕上是**同一个颜色**，而上面每一条
 *    断言照样绿（§5.70：渲染得出来、但什么都不生效的类名）。
 * ⚠️ 匹配前**先剥注释**（§5.82 那个假绿）：这一段注释里就逐字写着 `.jar--unrecognized`，
 *    裸 `includes` 对"只留注释、删掉规则"恒绿 —— 下面第一条探针正是这件事的读数。
 */
const stylesCode = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
/** 剥掉 CSS 注释（只剥块注释：`//` 会咬到 `url(https://…)` 那种值）。 */
const withoutCssComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
assert.equal(
  stylesCode.includes('.jar--unrecognized'),
  true,
  '★ 探针：`styles.css` 真的读进来了（这个类名在文件里）',
);
assert.equal(
  withoutCssComments(stylesCode).includes('.jar.disabled'),
  false,
  '★★ 探针：**只在注释里**出现过的类名不算"有规则"（`.jar.disabled` 在 `styles.css` 里' +
    '只写在注释里）—— 不剥注释的话，下面那条规则断言对"删掉规则、留下注释"恒绿',
);
const unrecognizedCssRule = withoutCssComments(stylesCode).match(
  /\.jar--unrecognized[^{]*\{([^}]*)\}/,
);
assert.ok(
  unrecognizedCssRule,
  '★★★ `.jar--unrecognized` 在 `apps/web/src/styles.css` 里**有规则** —— 没有它，' +
    '未识别那一行只是"多了一个名字"，屏幕上与别的行**同一个颜色**（spec §8 / §9 的刀 ⑧）',
);
assert.match(
  unrecognizedCssRule[1],
  /color:\s*var\(--redstone\)/,
  '★★★ 而且那条规则把颜色设成**红石色**（`--redstone`：与 `.badge--problem` 同一个语义红）' +
    '—— "标红"这件事只有这一处能证',
);
/*
 * ★★ CT-12 / G1（最终修复波）：三个类名各自**有规则**（判据与上面那条同一条：先剥注释，
 *    再找 `选择器 { … }`）。
 *
 * 现场：
 *   · **CT-12**：`.modlist` / `.modlist__title` 在整份 `styles.css` 里**一条规则都没有**
 *     ⇒ 第三段的标题落回**浏览器默认的 `h3`**，而这一页每一个兄弟标题
 *     （`.folderlist__title` / `.toolspanel__title`）都是像素字体 + 弱化色
 *     —— 同一页上"这一段是什么"的字长着两个样子。
 *   · **G1**：`.folderlist__actions` 是这一波**新增的容器**（常驻的「添加文件夹」那一排）
 *     ⇒ 它必须有规则（本仓 §5.70：组件里出现的类名必须有规则）。
 * ⚠️ 判据钉**属性**而不是"类名在文件里"：只 `includes('.modlist')` 的话，
 *    上面那段注释本身就满足它（§5.82 那个假绿，与 `.jar--unrecognized` 那条同源）。
 * ★ 刀（读数在报告里）：把 `.modlist__title` 那条规则删掉（注释留着）⇒ 这一条红。
 */
for (const [selector, mustMatch, why] of [
  ['.modlist__title', /font-family:\s*var\(--font-pixel\)/, '第三段的标题要与其他标题同一种字体'],
  ['.folderlist__actions', /display:\s*flex/, '常驻的「添加文件夹」那一排要有布局规则'],
]) {
  const rule = withoutCssComments(stylesCode).match(
    new RegExp(`${selector.replace(/[.\-_]/g, (c) => `\\${c}`)}\\s*\\{([^}]*)\\}`),
  );
  assert.ok(
    rule,
    `★★ CT-12/G1：\`${selector}\` 在 \`apps/web/src/styles.css\` 里**有规则** —— ${why}`,
  );
  assert.match(rule[1], mustMatch, `★★ 而且那条规则里写着应有的那一格（${String(mustMatch)}）`);
}
/*
 * ★★ CT-4（最终修复波）：页面那一份 `modid → homepage` 的映射**从投影摊**，不再从
 *    `state.catalogRows` 另起一份 —— 两处各建一份时，同一个 modid 可能在一张表里有链接、
 *    在另一张里是 `—`（投影是唯一真相，页面只做展示联结）。
 * ★ 刀（读数在报告里）：把那一句改回 `new Map(state.catalogRows.map(…))` ⇒ 这一条红。
 */
assert.match(
  versionFolderListCode,
  /new Map\(page\.mods\.map\(\(row\) => \[row\.modid, row\.homepage\]\)\)/,
  '★★ CT-4：`VersionFolderList` 的 `homepageOf` 来自**投影**（`page.mods`）—— ' +
    '它原来是 `state.catalogRows` 的第二份映射（同一件事两处实现）',
);
// —— ④ homepage 是**查表**，不是编出来的：目录里没有这个 modid ⇒ 那一格印 `—` ——
/*
 * ★★ 这一条同时是"镜像判据"的读数：`FROW_CDN` 的目标在 `cdn.modrinth.com`，而状态里
 *    那条镜像只认 `github.com`（`MIRROR.hosts`）⇒ **只有原始那一颗**（D5 的降级）。
 *    ⚠️ 拿 `mirrors[0]` 无条件画第二颗的实现会红在这里。
 */
const noHomeState = stateOf([ROW_GITHUB], {
  folders: [folder({ folderId: 'f-nohome', rows: [FROW_CDN] })],
});
const noHomeHtml = jarListHtmlOf(noHomeState, 'f-nohome');
const noHomeRow = jarRowOf(noHomeHtml, FROW_CDN.modid);
assert.equal(
  noHomeRow.includes('data-link="homepage"'),
  false,
  '★★ 目录里没有这个 modid ⇒ homepage 那一格**不许**画链接（`homepageOf` 是一次查表：' +
    '查不到就是 `null`，不许拿别的行顶上）',
);
assert.ok(
  textOf(noHomeRow).includes('—'),
  '★ 而那一格印 `—`（空着与"没渲染"分不开 —— 与两张表里那个 `DASH` 同一个字符）',
);
assert.deepEqual(
  labelsIn(noHomeRow),
  [labelOf('files.updateOrigin')],
  '★★ 目标在 CDN ⇒ 状态里那条镜像**不适用** ⇒ 只有原始那一颗：判据是 `mirrorsForUrl`' +
    '（主机匹配只有 `mirrorsFor` 一份实现），不是"有镜像表就给"',
);
// —— ⑤ 既有 allow-list 照旧：`different-build` 有入口，`manual` / `newer` / `missing-release` 没有 ——
/*
 * ⚠️★ 与 ⑳/㉑ 对旧第二部分那两条**同一条理由**（Ruling 47/48）：主进程会拒的一律不画，
 *    而 `different-build` 是 `assertUpdatable` **放行**的那一支（夹具里 `batchable: false`
 *    是承重的：按 `batchable` 给按钮的实现在这里红）。
 */
const allowState = stateOf([ROW_GITHUB], {
  folders: [
    folder({
      folderId: 'f-allow',
      rows: [FROW_DIFFERENT_BUILD, FROW_MANUAL, FROW_NEWER, FROW_NO_RELEASE],
    }),
  ],
});
const allowRowsHtml = jarListHtmlOf(allowState, 'f-allow');
assert.deepEqual(
  labelsIn(jarRowOf(allowRowsHtml, FROW_DIFFERENT_BUILD.modid)),
  [labelOf('files.updateOrigin'), labelOf('files.updateMirror')],
  '★★ `different-build` 的行**有**那两颗更新按钮（`assertUpdatable` 放行它；`batchable` 是 false ⇒ ' +
    '判据不能是 `batchable`）',
);
for (const [what, row, hintKey] of [
  ['manual（OptiFine）', FROW_MANUAL, 'files.hintManual'],
  ['newer（只升不降）', FROW_NEWER, 'files.hintNewer'],
  ['missing-release（这一版清单里没有它）', FROW_NO_RELEASE, 'files.hintMissingRelease'],
] as const) {
  const rowHtml = jarRowOf(allowRowsHtml, row.modid);
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
    `★ ${what} 那一行要有**自己的**解释（${hintKey}）—— 它复用 ` +
      '`VERDICT_HINTS`（与第一部分、旧第二部分同一张表），不在这里另写一份',
  );
}
assert.deepEqual(
  rawKeysIn(jarListHtml),
  [],
  '★ 这一组三份产物里也没有裸 key 泄漏（⚠️ ⑬ 那条扫描跑在**这一组之前** ⇒ 新词条要在这里自钉）',
);
// —— ⑥ ★★★ 页面**真的**把三格喂下去了（判修 1：上面那五块喂的都是自检自己的夹具） ——
/*
 * ⚠️★ 为什么这一段必须在**页面那一侧**的产物上打（2026-10-04 T4 判修轮，评审点名）：
 *    上面 ①–⑤ 里的三格 prop 全是**自检自己传的** ⇒ 把 `VersionFolderList` 那一处调用点
 *    改成 `homepageOf={new Map()}` / `mirrors={[]}` / `busy={false}`，
 *    "主页列 / 镜像按钮 / 写盘期间的锁"三件事一起废掉，而上面每一条**照样绿**。
 *    ⇒ 这里用的是 `expandedListHtml`（**`VersionFolderList` 渲染出来的**那一份，
 *    夹具是 `skeletonState`：`ROW_GITHUB` 带 `SODIUM_HOMEPAGE`、`state.mirrors` 有那条
 *    GitHub 镜像、`f1` 的默认两行里有 `sodium`）—— 一条新夹具都不需要。
 * ⚠️ 判据打在 `data-folder-body="f1"` 那一段里：头行里没有这些东西（头行那一条
 *    "精确按钮集合"的断言反过来正好是这一段不含头行控件时的读数）。
 */
const pageBodyOfF1 = folderBodyOf(expandedListHtml, 'f1');
assert.match(
  pageBodyOfF1,
  /data-jar="sodium"[\s\S]{0,900}?data-link="homepage"/,
  '★★★ 展开体里那一行有 **homepage 链接** ⇒ `homepageOf` 真的从页面喂进来了' +
    '（把那一格换成 `new Map()` ⇒ 这一条红，而 ①–⑤ 照样绿 —— 它们的 map 是自检自己组的）',
);
assert.ok(
  linksIn(pageBodyOfF1).some((link) => link.href === SODIUM_HOMEPAGE),
  '★★★ 而且 `href` 就是 `ROW_GITHUB.homepage`（***自检没有替页面组 map***：' +
    '这一条走的是 `VersionFolderList` 那一处调用点，写死一个别的地址会红）',
);
assert.deepEqual(
  labelsIn(jarRowOf(pageBodyOfF1, 'sodium')),
  [labelOf('files.updateOrigin'), labelOf('files.updateMirror')],
  '★★★ 镜像那一颗**也在** ⇒ `mirrors` 真的从页面喂进来了（换成 `mirrors={[]}` ⇒ 这一条红）',
);
const busyListState = { ...skeletonState, busy: true };
const busyListHtml = keep(
  html(
    React.createElement(VersionFolderList, {
      state: busyListState,
      page: planVersionPage(busyListState, ['f1']),
      expanded: ['f1'],
      onToggle: noop,
      onAction: noop,
      progress: null,
    }),
  ),
);
assert.deepEqual(
  buttonsIn(jarRowOf(folderBodyOf(busyListHtml, 'f1'), 'sodium')).map((button) => button.disabled),
  [true, true],
  '★★★ 状态 `busy` 时那两颗按钮在展开体里也**禁用** ⇒ `busy` 真的从页面喂进来了' +
    '（换成写死 `busy={false}` ⇒ 这一条红；⚠️ 这一份是把同一个夹具的 `busy` 翻成 `true`，' +
    '别的格一个都没动）',
);
ok(
  '㊱ 展开的 jar 列表：已识别的行（文件名/mod 名/本地版本/两颗链接的 href/既有徽章与操作）+ 未识别两行（机器读数+类名+两类原因分开说）+ `styles.css` 里那条红规则真的在 + homepage 查不到就印 `—` + 既有 allow-list（`different-build` 有入口、manual/newer/missing-release 没有）+ **页面真的把 `homepageOf` / `mirrors` / `busy` 三格喂了下来**',
);

// ---------------------------------------------------------------------------
// ㊲ 单行更新的接线守卫（spec §9.13 的同族：产物里看不见事件处理器）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 「按哪条通道」没有产物可锚（静态渲染不跑事件处理器）⇒ 只由这一组**源码形状**兜着，
 *    与 ⑯/㉖/㉗/㉟ 同一条纪律。⚠️ 而 `ModPageAction` 是页面手里的那个联合：
 *    "加了成员却忘了接线"由 `Files.tsx` 的 `never` 守卫在**编译期**红（T3 判修 3），
 *    这里钉的是**接对了哪条通道**（`updateMod` 而不是别的）。
 */
const jarListCode = withoutComments(
  readFileSync(new URL('../src/components/FolderJarList.tsx', import.meta.url), 'utf8'),
);
const filesRouteCode = withoutComments(
  readFileSync(new URL('../src/routes/Files.tsx', import.meta.url), 'utf8'),
);
assert.match(
  jarListCode,
  /onAction\(\{\s*kind:\s*'update-mod',[\s\S]{0,160}?channel:\s*'origin',?\s*\}\)/,
  "★★ 「更新（原始）」送的是 `'origin'`（release 自己的地址，永远成立）",
);
assert.match(
  jarListCode,
  /onAction\(\{\s*kind:\s*'update-mod',[\s\S]{0,220}?channel:\s*\{\s*mirrorId:\s*mirror\.id,?\s*\},?\s*\}\)/,
  '★★ 「更新（镜像）」送的是 `{ mirrorId: mirror.id }`（**只送 id**，地址由主进程拼）—— ' +
    '两颗都送 `origin` 时镜像那颗是个假按钮，而产物里看不出来',
);
assert.equal(
  jarListCode.match(/kind:\s*'update-mod'/g)?.length,
  2,
  "★★ `kind: 'update-mod'` 只许出现两次（就是那两颗按钮；多一处就是第二条写盘路径）",
);
assert.match(
  jarListCode,
  /mirrorsForUrl\(mirrors,\s*row\.official\.url\)/,
  '★★ 镜像那一颗的可用性来自**状态里的镜像表 + 那一行的目标**（镜像规则只有 `mirrorsFor` 一份实现）',
);
assert.match(
  jarListCode,
  /VERDICT_BADGES\[row\.verdict\.kind\]/,
  '★★ 徽章表与第一部分 / 旧第二部分**共用一份**（`VERDICT_BADGES`）—— 在这一层另写一张表，' +
    '就是"同一个判定、两处说法"的第一个版本',
);
/*
 * ★★ 送给主进程的那个键走**共用**的 `releaseKey()`（`modCatalog.ts:302`，它的注释写着
 *    "分隔符只此一处"）。⚠️ 判修轮之前这里是手搓的第二份 `${row.modid}|${…}`
 *    （评审点名）：分隔符漂一个字符的症状只是"这一行点更新没反应"（主进程 `requirePairKey`
 *    拒），而**产物里看不出来** ⇒ 由这两条钉住（下面那条是反面：不许再手搓一份）。
 */
assert.match(
  jarListCode,
  /releaseKey\(row\.modid,\s*folder\.gameVersion\s*\?\?\s*''\)/,
  '★★ 那个键来自共用的 `releaseKey(modid, gameVersion)`（分隔符只有这一处实现）',
);
assert.equal(
  /\$\{row\.modid\}\|/.test(jarListCode),
  false,
  '★★ 反面：**不许**手搓第二份 `modid|版本`（漂一个字符 ⇒ 主进程拒，症状只是"点了没反应"）',
);
assert.match(
  downloadPanelCode,
  /kind:\s*'update-mod';\s*folderId:\s*string;\s*modid:\s*string;\s*releaseKey:\s*string;\s*channel:\s*Channel/,
  '★ `ModPageAction` 里新增的那一条带**四格**（folderId / modid / releaseKey / channel）—— ' +
    '缺一格就发不出主进程要的那个键',
);
assert.match(
  filesRouteCode,
  /case 'update-mod':\s*await handlers\.updateMod\(action\.folderId,\s*action\.modid,\s*action\.releaseKey,\s*action\.channel\);/,
  '★★ 那个动作真的被接到 `handlers.updateMod(…)` 上（联合里加了成员而不接线 ⇒ `never` 守卫在编译期红；' +
    '这一条钉的是**接对了哪条通道**）',
);
ok(
  '㊲ 单行更新的接线守卫：两颗按钮各送自己那条通道（`origin` / `{mirrorId}`，各一处）、镜像判据来自状态、徽章表共用一份、那个键走共用的 `releaseKey()`、联合新增的那一格形状、`Files.tsx` 接到 `handlers.updateMod`',
);

// ===========================================================================
// Task 5（A 的第五片）：第三段「该版本所有 mod」—— 全量 + 「已下载」 + 目标选择
// ===========================================================================
/*
 * 这一组验的是**第三段**（`VersionModList`，spec §4）：该版本目录里的**全部** mod
 *    （不是旧底部那栏"缺失的"）、与**已展开**文件夹重叠的那一行显示「已下载」而
 *    **不给**下载按钮（D5 / §9.9）、以及单个下载的目标文件夹选择（D6 / §8）。
 *
 * ⚠️★ 判断一格都不在这一层：`downloadedIn` / `downloadTargets` / `releaseVersion` / `homepage`
 *    全是**投影**（`planVersionPage`，T1）算好的 ⇒ 这一层只渲染（spec §5.1）。
 *    能红的刀（逐条读数在报告里）：
 *      · `downloadedIn.length > 0` → `>= 0`（恒真）⇒ "两个下载按钮"那条先红；
 *      · 把两颗一起画（不互斥）⇒ "已下载那一行不再有下载按钮"红；
 *      · 目标选择的闸 `> 1` → `>= 1` ⇒ "只有一个文件夹时不该有选择器"红；
 *      · 0 个目标那一支的 `disabled` / 那句解释删掉 ⇒ 那两条红；
 *      · `manual` / 没有目标那两行的闸删掉 ⇒ "只有一行有下载按钮"红。
 *
 * ⚠️★ 三格 prop（`page` / `tagLabels` / `busy`）由**页面产物**上那几条钉着（下一组）：
 *    这一组喂的是**自检自己组的那份** `state`（与 T4 判修轮同一个教训 —— 自检自己喂的 prop
 *    证明不了"页面真的喂了它"）。
 */

/** 产物里某个字面量出现了几次（简报里那个 `countOf` 的一行版）。 */
const countOf = (markup: string, needle: string): number => markup.split(needle).length - 1;

/**
 * 第三段里的一行（`data-modid="<modid>"` 那一格）。找不到就当场红。
 * ⚠️ 它与 `jarRowOf`（展开体里那一行，`data-jar`）**不是**同一个东西：两处都可能出现
 *    同一个 modid（`sodium` 既在目录里、也在文件夹里），锚错了就会拿文件夹那一行去比。
 */
function modRowOf(markup: string, modid: string): string {
  const found = markup.match(new RegExp(`<tr[^>]*data-modid="${modid}"[\\s\\S]*?</tr>`));
  assert.ok(
    found,
    `产物里找不到 data-modid="${modid}" 的那一行 —— 第三段那一行没渲染出来（或者 data-modid 不再写在那里）`,
  );
  return found[0];
}

/**
 * 渲染第三段（`VersionModList` 是纯 props 组件 ⇒ 喂 `page` + 三格就同步画完）。
 * ⚠️ `tagLabels` / `busy` 照**页面**那一处调用点喂（下一组会证明页面真的喂了）。
 * ⚠️★★ T5 修复轮 1（评审 Important 1）：**`progress` 从外面喂进来**（默认 `null`）——
 *    理由与 `jarListHtmlOf` 那一处逐字同一条（写死 `null` 时"转发真的到了这里"无法断言）。
 */
function modListHtmlOf(
  state: ModFoldersState,
  expanded: readonly string[],
  progress: PageProgress | null = null,
): string {
  return keep(
    html(
      React.createElement(VersionModList, {
        page: planVersionPage(state, expanded),
        tagLabels: state.tags,
        busy: state.busy,
        onAction: noop,
        progress,
      }),
    ),
  );
}

/*
 * ★★ 夹具：**两个**目录行 + **两个**同版本的文件夹（`f1` 里有 `sodium`、`f2` 是空的）。
 * ⚠️ 名字与 modid **不同**（`Sodium Prime` vs `sodium`）：一样的话，"印的是 `row.name`"
 *    那条断言会因为 modid 也在产物里而恒真（T4 那条"文件名里不带版本号"的同一条纪律）。
 * ⚠️ 标签用**本组自己的**一格（`MOD_TAG`），而且显示名（`TAG-RANKED-ZH`）与 key（`ranked`）
 *    大小写不同：这样"印显示名、不是印 key"那条反面断言才咬得住
 *    （用现成的 `TAG_OPTION` 时 `legal-label-zh` 里含着 `legal`，反面断言恒真）。
 */
const MOD_TAG = { key: 'ranked', labels: { zh: 'TAG-RANKED-ZH', en: 'TAG-RANKED-EN' } };
/** 这一遍语言下那个标签**应当**显示的字（两种语言各一条读数，见 ⑱ 的零汉字扫描）。 */
const MOD_TAG_SHOWN = LANG === 'en' ? MOD_TAG.labels.en : MOD_TAG.labels.zh;
const modRowFixture = (modid: string, name: string): CatalogRowView => ({
  ...ROW_GITHUB,
  modid,
  name,
  tags: [MOD_TAG.key],
  tagLabels: [MOD_TAG.labels.zh],
});
const modListState = stateOf(
  [modRowFixture('sodium', 'Sodium Prime'), modRowFixture('lithium', 'Lithium Prime')],
  {
    tags: [MOD_TAG],
    folders: [
      folder({ folderId: 'f1', rows: [folderRow({ modid: 'sodium' })] }),
      folder({ folderId: 'f2', rows: [] }),
    ],
  },
);

// —— ① 没有展开任何文件夹 ⇒ 两个 mod 都有下载按钮（D5） ——
const closedMods = modListHtmlOf(modListState, []);
assert.ok(
  closedMods.includes('data-modid="sodium"') && closedMods.includes('data-modid="lithium"'),
  '★ 对照：两个 mod **都**画出来了 —— 下面"两个下载按钮"因此不是"只画了一行"的巧合',
);
assert.equal(
  countOf(closedMods, 'data-action="download-mod"'),
  2,
  '★★ 没有展开任何文件夹 ⇒ 两个 mod 都有下载按钮（D5：不展开 = "没在你眼前下过"）',
);
assert.ok(
  textOf(closedMods).includes(
    textOf(resolved('files.versionModsTitle', { version: '1.16.1', count: 2 })),
  ),
  '★ 列表标题带**该版本**与条数（简报那条裸 `includes("1.16.1")` 会被 `data-version` 属性满足 ⇒ ' +
    '这里比的是**标题那一句话**：版本号与条数各是一格读数）',
);
assert.equal(
  textOf(closedMods).includes(textOf(resolved('files.colActions'))),
  false,
  '★★ **不再有「操作」列**（用户明确要求）：那一列的表头不许出现在第三段里',
);
// —— ② 一行里的四样东西：mod 名 / 标签徽章 / 目标版本 / homepage 链接 ——
const sodiumClosed = modRowOf(closedMods, 'sodium');
const lithiumClosed = modRowOf(closedMods, 'lithium');
assert.ok(
  textOf(sodiumClosed).includes(textOf('Sodium Prime')) &&
    textOf(sodiumClosed).includes(textOf(MOD_TAG_SHOWN)) &&
    textOf(sodiumClosed).includes(textOf(SODIUM_NEW.version)),
  '★★ 那一行印：mod 名（`row.name`）+ 标签徽章 + **目标版本**（`row.releaseVersion`）',
);
assert.equal(
  textOf(sodiumClosed).includes(MOD_TAG.key),
  false,
  `★ 反面：标签那一格印的是**显示名**（${MOD_TAG_SHOWN}），不是目录里的 key（${MOD_TAG.key}）`,
);
assert.deepEqual(
  linksIn(sodiumClosed).map((link) => link.href),
  [SODIUM_HOMEPAGE],
  '★★ homepage 那一格是**这一行**的 `row.homepage`（写死一个别的地址、或者拿 release 地址顶上，都会红）',
);
/*
 * —— ②b ★★ B2（最终修复波）：**已经有它的那个文件夹不再是下载目标** ——
 *
 * `f1` 里有 `sodium`（折叠着）⇒ 投影把它从 `sodium` 的 `downloadTargets` 里排掉
 * （主进程 `downloadMissing` 对"目标里已经有它"是**无条件拒**的）。
 * ⚠️★ 这一条与下面 ④b 那一条合起来才是完整的判据：**这里测的是"还剩一个合法目标"，
 *    那里测的是"一个都不剩"** —— 两处的表现不同（可点的按钮 / 禁用的按钮 + 一句解释）。
 */
assert.equal(
  countOf(sodiumClosed, 'data-target-picker'),
  0,
  '★★ B2：`f1` 里有 sodium ⇒ 它只剩**一个**合法目标（`f2`）⇒ 不画选择器（D6：1 个就直接下到它）',
);
assert.deepEqual(
  buttonsIn(sodiumClosed).map((button) => button.disabled),
  [false],
  '★ 而那一颗下载按钮**是可点的**（它下到 `f2` —— 一个真的接收它的文件夹）',
);
// —— ②c 多目标那一行：`sodium` 被排掉之后，`lithium` 才是"两个都能装"的那一行 ——
assert.ok(
  countOf(lithiumClosed, 'data-target-picker') === 1,
  '★★ 该版本有**两个**合法目标 ⇒ 行内给一个目标选择器（D6；⚠️ 下面那条"只有一个时不画它"是它的反面）',
);
assert.deepEqual(
  selectsIn(lithiumClosed).map((select) => select.values),
  [['f1', 'f2']],
  '★★ 选择器的选项就是**该版本可作目标**的那两个文件夹（`row.downloadTargets`，顺序 = 状态里的顺序）',
);
assert.ok(
  textOf(lithiumClosed).includes(textOf('D:\\instances\\f1\\mods')) &&
    textOf(lithiumClosed).includes(textOf('D:\\instances\\f2\\mods')),
  '★★ 选项上印的是**文件夹路径**（`page.folders` 里那一格），不是 id —— 印 `f1`/`f2` 的实现在这里红',
);
assert.equal(
  selectsIn(lithiumClosed)[0]?.selected,
  'f1',
  '★ 默认选中**第一个**可用文件夹（`<select value=X>` 里没有 X 时浏览器会静默选中第一个 ⇒ ' +
    '那一屏就在撒谎：默认值必须来自 `downloadTargets`，不是组件自己记的）',
);
// —— ③ ★★★ 展开 `f1` 之后：重叠的那一行变成「已下载」、而且**不再有**下载按钮 ——
const openedMods = modListHtmlOf(modListState, ['f1']);
const sodiumOpened = modRowOf(openedMods, 'sodium');
assert.ok(
  textOf(sodiumOpened).includes(textOf(resolved('files.alreadyDownloaded'))),
  '★★★ 与**已展开**的文件夹重叠的 mod 显示「已下载」（spec §9.9 / D5）',
);
assert.ok(
  sodiumOpened.includes('data-state="downloaded"'),
  '★ 而且带**机器读数**（文案以后再改，这条读数还在）',
);
assert.equal(
  countOf(sodiumOpened, 'data-action="download-mod"'),
  0,
  '★★★ 而且那一行**不再有**下载按钮 —— 只说"显示已下载"的话，"两个一起画"照样绿（spec §9 的刀 ⑨）',
);
assert.equal(
  countOf(sodiumOpened, 'data-target-picker'),
  0,
  '★ 那一行也不给目标选择器（它没有下载按钮，选择器没有落点）',
);
const lithiumOpened = modRowOf(openedMods, 'lithium');
assert.equal(
  countOf(lithiumOpened, 'data-action="download-mod"'),
  1,
  '★★ 不重叠的那个**仍有**下载按钮（与上面那条**互相独立**：一个"永远不画按钮"的实现过得了那条、过不了这条）',
);
// —— ④ 只有一个文件夹 ⇒ 直接下到它，不画选择器（D6 的另一半） ——
const singleTargetState = stateOf(modListState.catalogRows, {
  tags: [MOD_TAG],
  folders: [folder({ folderId: 'f1', rows: [folderRow({ modid: 'sodium' })] })],
});
const singleTargetHtml = modListHtmlOf(singleTargetState, []);
assert.equal(
  countOf(singleTargetHtml, 'data-target-picker'),
  0,
  '★★ 该版本**只有一个**文件夹 ⇒ **不画**选择器（D6：多一个选择器就是多一步没有信息量的点击）',
);
assert.equal(
  countOf(singleTargetHtml, 'data-action="download-mod"'),
  2,
  '★ 而下载按钮照旧（2 行各一颗）—— 与上一条**互相独立**（"按钮也没了"过得了那条、过不了这条）',
);
/*
 * —— ④b ★★★ B2（最终修复波）：**一个合法目标都不剩**时，说的是"它已经在了"而不是"去绑一个" ——
 *
 * 现场：这一版只有一个文件夹 `f1`，而 `f1` 里**已经有** `sodium`（折叠着 ⇒ `downloadedIn`
 * 为空）⇒ 修之前那一屏画的是一颗**可点的**按钮，点下去必然拿到主进程那句
 * "这个文件夹里已经有 sodium 了"（一条红字）。这就是这一页的规矩
 * （"会拒的一律不画/不放开"）要消灭的东西，也是 B2 那条 Critical 的现场。
 * ⚠️★ 判据是**三件事一起**：那一句解释是 `alreadyInFolder`（**不是** `noFolderForDownload`）、
 *    那颗按钮**在、而且禁用**、以及机器读数说得清是哪一支空。少了中间那半，
 *    "印了句子但按钮照旧可点"会一路绿。
 * ★ 刀（读数在报告里）：把投影里 `!presentIds.has(folder.folderId)` 那一句删掉
 *   ⇒ `f1` 重新成为合法目标 ⇒ **这一条与 ②b 那条一起红**。
 */
const sodiumSingle = modRowOf(singleTargetHtml, 'sodium');
assert.ok(
  textOf(sodiumSingle).includes(
    textOf(resolved('files.alreadyInFolder', { folder: 'D:\\instances\\f1\\mods' })),
  ),
  '★★★ B2：能装它的那个文件夹里**已经有它了** ⇒ 说这一句（用户真正的出路是"展开 f1"，' +
    '不是"再去绑一个文件夹"）',
);
assert.equal(
  textOf(sodiumSingle).includes(
    textOf(resolved('files.noFolderForDownload', { version: '1.16.1' })),
  ),
  false,
  '★★★ 反面：这一档**不许**说"没有可以下载到的文件夹" —— 用户手上明明有一个（它在 `presentIn` 里）',
);
assert.deepEqual(
  buttonsIn(sodiumSingle).map((button) => button.disabled),
  [true],
  '★★ 而那颗按钮**在、而且禁用**（禁用不是消失：旁边那句话就是答案；' +
    '"干脆不画它"会让这个数组变空 ⇒ 同样红）',
);
assert.equal(
  sodiumSingle.includes('data-no-target="already-present"'),
  true,
  '★ 机器读数：那一格说得清是哪一支空（与下面 ⑤ 的 `no-folder` 互为反面）',
);
// —— ⑤ 一个能当目标的文件夹都没有 ⇒ 按钮**禁用** + 说清为什么（spec §8） ——
const noTargetHtml = modListHtmlOf(
  stateOf(modListState.catalogRows, { tags: [MOD_TAG], folders: [] }),
  [],
);
const noTargetRow = modRowOf(noTargetHtml, 'sodium');
assert.ok(
  textOf(noTargetRow).includes(
    textOf(resolved('files.noFolderForDownload', { version: '1.16.1' })),
  ),
  '★★★ 0 个目标 ⇒ **说清为什么**（spec §8：按钮禁用并说明"先绑定一个文件夹"）—— ' +
    '一颗静默的死按钮正是这一条要消灭的东西',
);
assert.equal(
  noTargetRow.includes('data-no-target="no-folder"'),
  true,
  '★ 机器读数：这一支是"这一版一个能装的文件夹都没有"（与 ④b 的 `already-present` 互为反面 —— ' +
    '两句不同的出路各有一条读数）',
);
assert.deepEqual(
  buttonsIn(noTargetRow).map((button) => button.disabled),
  [true],
  '★★ 0 个目标时那颗按钮**在、而且禁用**（这一条同时管两件事：只印一句解释、按钮照旧可点 ⇒ 红；' +
    '而"干脆不画那颗按钮" ⇒ 这个数组是空的 ⇒ 同样红 —— 静默的死按钮与被吞掉的按钮都不是答案）',
);
// —— ⑥ 主进程必拒的那两行**一颗下载都不给**（`manual` / 没有目标） ——
/*
 * ⚠️★ `downloadMissing` 现读下来有两道"整条拒"的闸（`apps/desktop/src/mod-folders.ts`）：
 *    · `assertNotManual(row.manual, what, '下载')` ⇒ `manual`（OptiFine 那一类 54 条）必拒；
 *    · `row.candidates.length !== 1` / `official === null` ⇒ `ambiguous` 与
 *      `missing-release` 那两档**没有"该装哪一个"的答案**，也必拒。
 *    ⇒ 给它们画下载按钮就是画一颗**注定被拒**的按钮（Ruling 47/48，T8 那次 Critical 的同一条）。
 *    ⚠️★ 判据**不是**第一部分的更新 allow-list（那是"给不给更新按钮"）：这里读的是投影里
 *    **为下载准备**的两格（`releaseUrl` / `manual`），所以它不是第四份 allow-list。
 */
const refuseState = stateOf(
  [
    modRowFixture('sodium', 'Sodium Prime'),
    { ...ROW_MANUAL, modid: 'optifine', name: 'OptiFine Prime' },
    { ...ROW_AMBIGUOUS, modid: 'speedrunigt', name: 'SpeedRunIGT Prime' },
  ],
  {
    tags: [MOD_TAG],
    folders: [folder({ folderId: 'f1', rows: [folderRow({ modid: 'sodium' })] })],
  },
);
const refuseHtml = modListHtmlOf(refuseState, []);
assert.equal(
  countOf(refuseHtml, 'data-action="download-mod"'),
  1,
  '★★★ 三行里**只有 `sodium` 那一行**有下载按钮（它那一颗是**禁用**的，理由见 ④b）：' +
    '`manual` 与没有目标那两行一颗都不给（主进程必拒 ⇒ Ruling 47/48：会拒的一律不画）',
);
assert.ok(
  textOf(modRowOf(refuseHtml, 'optifine')).includes(textOf(resolved('files.hintManual'))),
  '★ `manual` 那一行给出**它自己**的解释（复用共享那条词条，不在这里另写一句）',
);
assert.ok(
  textOf(modRowOf(refuseHtml, 'speedrunigt')).includes(textOf(resolved('files.hintAmbiguous'))),
  '★ 没有目标那一行给出 `ambiguous` 的解释（复用共享的 `VERDICT_HINTS`）',
);
// —— ⑦ 目录不可用 ⇒ 既有文案、不画表（spec §8；与"这一版没有 mod"分开说） ——
const noCatalogHtml = modListHtmlOf({ ...modListState, missingStatus: 'catalog-unavailable' }, []);
assert.ok(
  textOf(noCatalogHtml).includes(textOf(resolved('files.catalogUnavailable'))),
  '★★ 目录不可用 ⇒ 用**既有**那条文案（spec §8："沿用 `catalogStatus` 的四态文案"）',
);
assert.equal(
  noCatalogHtml.includes('data-modid='),
  false,
  '★★ 而且**一张表都不画**：`catalogAvailable === false` 时"读不到目录"与"这一版没有 mod"必须分开说',
);
// —— ⑧ 目录可用、但这一版一条 mod 都没有 ⇒ 一句话（空表与"没渲染"分不开） ——
const emptyModsHtml = modListHtmlOf(stateOf([], { folders: [] }), []);
assert.ok(
  textOf(emptyModsHtml).includes(textOf(resolved('files.versionModsNone'))),
  '★ 该版本一条目录 mod 都没有 ⇒ 说一句（不许画一张空表）',
);
assert.equal(
  emptyModsHtml.includes('<table'),
  false,
  '★ 反面：那一档**连表都不画**（画一张空表与"没渲染"分不开，而且它看起来像坏了；' +
    '⚠️ 判据是 `<table` 而不是 `data-modid=` —— 后者在 `mods: []` 下**恒真**：§5.32 的第一类）',
);
// —— ⑨ 夹具自钉 + 裸 key 自钉（`scripts/**` 不在任何 tsconfig 里 ⇒ 写错了门禁是无声的） ——
/*
 * ⚠️★ 这一段照 T4 的那条（`assert.ok(ROW_GITHUB.homepage, …)`）：`apps/web/scripts/**`
 *    **不在任何 tsconfig 的 `include` 里**（`tsc` 不看它、`tsx` 只剥类型）⇒ 夹具写错
 *    在门禁上**完全无声**。下面四条钉的是"上面那些断言真的有可能红"。
 */
assert.ok(
  planVersionPage(modListState, []).mods.every((row) => row.releaseUrl !== null && !row.manual),
  '夹具自钉：那两个 mod **都能下**（否则"两个下载按钮"是一条空跑）',
);
assert.deepEqual(
  planVersionPage(modListState, []).mods.map((row) => [
    row.modid,
    row.presentIn,
    row.downloadTargets,
  ]),
  [
    ['sodium', ['f1'], ['f2']],
    ['lithium', [], ['f1', 'f2']],
  ],
  '夹具自钉（B2）：`sodium` 在 `f1` 里 ⇒ `presentIn=[f1]`、目标只剩 `f2`（选择器那两条因此挂在 ' +
    '`lithium` 上）；`lithium` 一个都不在 ⇒ 两个文件夹都能装（"排掉"与"没排掉"各有一条读数）',
);
assert.deepEqual(
  planVersionPage(modListState, []).mods.map((row) => row.downloadedIn),
  [[], []],
  '夹具自钉：没展开时 `downloadedIn` 是空的（"两个下载按钮"那条的判据）',
);
assert.deepEqual(
  planVersionPage(modListState, ['f1']).mods.map((row) => row.downloadedIn),
  [['f1'], []],
  '夹具自钉：展开 `f1` 之后**只有** `sodium` 命中（否则"不重叠的那个仍有按钮"是一条空跑）',
);
assert.deepEqual(
  rawKeysIn(closedMods + openedMods + refuseHtml + noCatalogHtml + emptyModsHtml),
  [],
  '★ 这一段五份产物里没有裸 key 泄漏（⑬ 那条扫描跑在这一组**之前** ⇒ 新词条要在这里自钉：' +
    '少一条 `en` 翻译时 i18next 会把 key 原样印出来）',
);
ok(
  '㊳ 第三段（该版本所有 mod）：全量行（mod 名 / 标签显示名 / 目标版本 / homepage 的 href）、没展开 ⇒ 每行一颗下载按钮、展开后重叠的那一行变「已下载」且**没有**下载按钮与选择器、不重叠的仍有、目标选择只在 ≥2 个**合法**目标时出现（选项是路径、默认第一个；B2："已经有它"的文件夹不算目标）、0 个目标 ⇒ 禁用 + 说明（B2：分"没有文件夹"与"能装它的文件夹里已经有它了"两句）、`manual` 与没有目标那两行一颗都不给、目录不可用 ⇒ 既有文案且不画表、没有 mod ⇒ 一句话、夹具自钉 + 裸 key 自钉',
);

// ---------------------------------------------------------------------------
// ㊴ 第三段的**喂入**与接线守卫（spec §5.1 / §9.13 的同族）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 为什么必须有这一组（T4 判修轮那条教训，逐字同一条）：上面那一组的三格 prop
 *    （`page` / `tagLabels` / `busy`）全是**自检自己传的** ⇒ 把 `ModDownloadPanel`
 *    那一处调用点改成 `page={{…mods: []}}` / `tagLabels={[]}` / `busy={false}`，
 *    上面**一条都不会红**（"页面把这三格喂空了"曾经是全绿的）。
 *    ⇒ 这一组的判据打在 **`ModDownloadPanel` 渲染出来的产物**上。
 * ⚠️ 夹具用**本组自己的**一格标签（`MOD_TAG`：显示名与 key 大小写不同）⇒ 标签那两条
 *    才咬得住；文件夹用两个（`f1` / `f1b`）⇒ 目标选择器在页面产物里也画得出来。
 * ⚠️★ 那两个文件夹刻意是**空的**（`rows: []`）：`folder()` 的默认行里**有** `sodium`
 *     ⇒ 在 B2 之后它会从 `sodium` 的 `downloadTargets` 里被排掉，于是"不忙时那颗按钮可用"
 *    那条对照会变成"恒禁用"（一条**空跑**）—— 这一组的判据是"三格 prop 真的喂下来了"，
 *    与文件夹里有什么无关，所以把行清空。
 * ⚠️★ 面板里的 `expanded` 是它自己的 `useState`（静态渲染恒为空）⇒ **「已下载」那一半
 *    在这一层证不了**（它由上一组按投影喂出来）；这一层证的是"页面真的把这三格喂下去了"。
 * ⚠️ 后四条是**接线守卫**（与 ⑯/㉖/㉗/㉟/㊲ 同一族）：产物里看不见事件处理器，
 *    这里钉"那条线在、而且只有一条"。
 */
const panelModState = stateOf([{ ...ROW_GITHUB, tags: [MOD_TAG.key] }], {
  tags: [MOD_TAG],
  folders: [folder({ folderId: 'f1', rows: [] }), folder({ folderId: 'f1b', rows: [] })],
});
assert.deepEqual(
  planVersionPage(panelModState, []).mods.map((row) => [row.presentIn, row.downloadTargets]),
  [[[], ['f1', 'f1b']]],
  '夹具自钉（B2）：这一版两个文件夹都是空的 ⇒ `sodium` 一个都不在、两个都能装' +
    '（否则下面"不忙时那颗按钮可用"会变成一条恒禁用的空跑）',
);
const panelModHtml = keep(
  html(
    React.createElement(ModDownloadPanel, { state: panelModState, onAction: noop, progress: null }),
  ),
);
assert.ok(
  panelModHtml.includes('data-modid="sodium"'),
  '★★★ 页面**真的**把 `page` 喂给了第三段（那一行出现在 `ModDownloadPanel` 的产物里）—— ' +
    '把那一格换成 `mods: []` ⇒ 这一条红，而上一组照样绿',
);
assert.ok(
  panelModHtml.indexOf('data-folder-id="f1"') < panelModHtml.indexOf('data-modid="sodium"'),
  '★★ 第三段在**文件夹区下面**（spec §4 那张图的顺序：先"这一版下的 mod 文件夹"、' +
    '再"该版本所有 mod"）—— 产物里的**先后**是这一条唯一的读数',
);
assert.equal(
  countOf(panelModHtml, 'data-action="download-mod"'),
  1,
  '★★ 而那一颗下载按钮也在页面产物里（同上：`mods: []` ⇒ 红）',
);
const panelModRow = modRowOf(panelModHtml, 'sodium');
assert.ok(
  textOf(panelModRow).includes(textOf(MOD_TAG_SHOWN)),
  '★★★ 标签徽章印的是**状态里那一格**的显示名 ⇒ `tagLabels` 真的从页面喂下来了' +
    '（换成 `tagLabels={[]}` ⇒ 那一格退回 key ⇒ 这一条与下面那条一起红）',
);
assert.equal(
  textOf(panelModRow).includes(MOD_TAG.key),
  false,
  '★★★ 反面：页面产物里不许出现裸的标签 key（`tagLabels={[]}` 时它会原样印出来）',
);
const busyPanelModHtml = keep(
  html(
    React.createElement(ModDownloadPanel, {
      state: { ...panelModState, busy: true },
      onAction: noop,
      progress: null,
    }),
  ),
);
assert.deepEqual(
  buttonsIn(modRowOf(busyPanelModHtml, 'sodium')).map((button) => button.disabled),
  [true],
  '★★★ 状态 `busy` 时那颗下载按钮**禁用** ⇒ `busy` 真的从页面喂下来了' +
    '（换成写死 `busy={false}` ⇒ 这一条红；⚠️ `downloadMissing` 第一句就是 `assertNotBusy()`，' +
    '那一档点下去必吃一句红字）',
);
assert.deepEqual(
  buttonsIn(panelModRow).map((button) => button.disabled),
  [false],
  '★ 反面：不忙时它可用（只写"忙时禁用"的话，一个恒禁用的实现照样绿）',
);
const versionModListCode = withoutComments(
  readFileSync(new URL('../src/components/VersionModList.tsx', import.meta.url), 'utf8'),
);
/*
 * ★★ 那四格**逐格**钉住（T6 判修；T5 评审点名的"守卫的声明超过它钉住的东西"）。
 *    ⚠️★ 原来只有一条 `[\s\S]{0,200}` 的窗口，它实际只钉住了 `kind` 与 `channel`
 *    —— 中间那两格**在窗口里什么都可以**（写死 `gameVersion: '1.16.1'`、或者把
 *    `folderId` 换成 `''`）⇒ 整套自检照样全绿。而这一页的夹具**全是 1.16.1**
 *    （`stateOf` 的 `gameVersion`、`folder()` 的默认版本），写死那个字符串正好落进
 *    夹具的取值里 ⇒ 它是**恰好绿**，不是被钉住。
 *    ⇒ 判据改成"每一格的**来源**都点名"（照 ㊲ 里 `handlers.updateMod(action.…)` 那一条
 *    的写法）：`modid` 来自这一行、`gameVersion` 来自 `version` 这一格、`folderId` 是
 *    那个局部量、`channel` 是 `'origin'`。任一格写死/接错 ⇒ 这一条红。
 */
assert.match(
  versionModListCode,
  /onAction\(\{\s*kind:\s*'download-mod',\s*modid:\s*row\.modid,\s*gameVersion:\s*version,\s*folderId,\s*channel:\s*'origin',?\s*\}\),?/,
  '★★ 那颗按钮把 **modid / gameVersion / folderId / channel** 一起发出去，而且**四格的来源逐格点名**' +
    "（`row.modid` / `version` / `folderId` / `'origin'` —— `channel` 是 `'origin'`：" +
    '这一次只发 release 自己的地址，理由与代价写在 `VersionModList` 的文件头）',
);
/*
 * ★ 而 `version` 那一格本身也钉住：它是**从投影/页面**喂下来的那一版（`page.version`），
 *   不是组件自己记的常量。⚠️ 少了这一条，上面那条"`gameVersion: version`"可以用一个
 *   写死的局部量兑现（`const version = '1.16.1'`）—— 恒真的那种形状又回来了。
 */
assert.match(
  versionModListCode,
  /version=\{page\.version\}/,
  '★ 那一行的 `version` 来自**投影**（`page.version`）—— 组件里不存第二份版本号',
);
assert.match(
  downloadPanelCode,
  /kind:\s*'download-mod';\s*modid:\s*string;\s*gameVersion:\s*string;\s*folderId:\s*string;\s*channel:\s*Channel/,
  '★ `ModPageAction` 里那一条带**四格**（modid / gameVersion / folderId / channel）—— ' +
    '缺一格就发不出主进程要的那四个入参（与上面那条各管一头：这里钉**类型声明**，' +
    '上面钉**调用点**）',
);
assert.equal(
  versionModListCode.match(/kind:\s*'download-mod'/g)?.length,
  1,
  '★★ 只有**一处**发这个动作（多一处就是第二条写盘路径）',
);
assert.equal(
  versionModListCode.includes('planVersionPage'),
  false,
  '★★ 第三段**不重算**任何判断（spec §5.1：`downloadedIn` / `downloadTargets` 是投影算好的）',
);
assert.match(
  versionModListCode,
  /row\.downloadedIn\.length > 0/,
  '★★ 「已下载」的判据读的是**投影那一格** `row.downloadedIn`（⚠️ 锚在**判定那一句**上：' +
    '只锚 `row.downloadedIn` 的话，"把它 alias 成一个局部量"这种改写会让守卫红、而行为一模一样）',
);
assert.match(
  versionModListCode,
  /row\.downloadTargets\.length > 1/,
  '★★ 目标选择器的闸读的是**投影那一格** `row.downloadTargets`（同上：锚在判定那一句上）',
);
assert.match(
  downloadPanelCode,
  /<VersionModList[\s\S]{0,300}?page=\{page\}[\s\S]{0,300}?tagLabels=\{state\.tags\}[\s\S]{0,300}?busy=\{state\.busy\}/,
  '★★ 面板那一处调用点把**三格**都喂下去（产物上那三条是主证据，这一条钉的是"同一处"）',
);
assert.match(
  filesRouteCode,
  /case 'download-mod':\s*await handlers\.downloadMissing\(\s*action\.modid,\s*action\.gameVersion,\s*action\.folderId,\s*action\.channel,?\s*\);/,
  '★★ 那个动作被接到 `handlers.downloadMissing(…)` 上（联合里加了成员却不接线 ⇒ `never` 守卫在' +
    '**编译期**红；这一条钉的是**接对了哪条通道**）',
);
assert.match(
  fePanelCode,
  /downloadMissing:\s*\(modid: string, gameVersion: string, folderId: string, channel: Channel\)\s*=>\s*run\(\(\)\s*=>\s*api\.downloadMissing\(modid, gameVersion, folderId, channel\)\)/,
  '★ 契约那条通道在动作层**已有**实现（`downloadMissing` 是 T8 就有的那一条：T5 复用它，' +
    '不另加一条同义通道）',
);
/*
 * ===========================================================================
 * ★★ G2（最终修复波 / spec D3）：添加文件夹那条线**带上了版本**（三层各一条）
 * ===========================================================================
 * 修之前这条线上没有任何一格版本：动作成员是 `{ kind: 'bind-folder' }`、`Files.tsx` 调
 * `handlers.bindFolder()`、动作层调 `api.bindFolder()` ⇒ 主进程只能自己推断
 * （推不出来就是 `null`），而 spec D3 要的是"在版本 X 下添加 ⇒ 预置为 X（仍可改）"。
 * ⚠️★ 三条**各钉一层**，因为漏任何一层都会**静默退回**旧行为（`bindFolder(undefined)`
 *    与"不带参数"在主进程那一侧同义）⇒ 只钉产物或只钉一处都不够：
 *    · 动作成员上那一格（类型声明）；
 *    · `Files.tsx` 的接线（值真的**从动作里**取，不是原样转一个 `undefined`）；
 *    · 动作层到契约的转发。
 * ⚠️ 第四条（`VersionFolderList.tsx` 发出的那一格）是它们的**源头**：那一格必须是
 *    `page.version`（投影里那一版），不是组件自己记的常量。
 *    ⚠️ 它的源码那份 `versionFolderListCode` 定义在文件**前面**（㊱ 的 CT-4 守卫先用它）。
 */
assert.match(
  downloadPanelCode,
  /kind:\s*'bind-folder';\s*version:\s*string \| null/,
  '★★ G2：`ModPageAction` 的 `bind-folder` 成员带着 `version: string | null`（缺这一格就传不出去了）',
);
assert.match(
  filesRouteCode,
  /case 'bind-folder':[\s\S]{0,400}?await handlers\.bindFolder\(action\.version\);/,
  '★★ G2：`Files.tsx` 把**动作上那一格**转给 `handlers.bindFolder`（写成不带参数的调用就是' +
    '「原样退回旧行为」，而那正是这一条要钉住的那一次退化）',
);
assert.match(
  fePanelCode,
  /bindFolder:\s*\(gameVersion\??: string \| null\)\s*=>\s*run\(\(\)\s*=>\s*api\.bindFolder\(gameVersion\)\)/,
  '★★ G2：动作层把那一格转发到契约（`api.bindFolder(gameVersion)` —— 与 `setFolderGameVersion` 同一条入参语义）',
);
assert.match(
  versionFolderListCode,
  /kind:\s*'bind-folder',\s*version:\s*page\.version/,
  '★★ G2：页面发出的那一格是**投影里的版本**（`page.version` = `state.gameVersion`）—— ' +
    '组件里不存第二份版本号（写死一个字符串会落进夹具的取值里 ⇒ 恰好绿）',
);
ok(
  "㊴ 第三段的喂入与接线：页面产物里**有**那一行、那颗下载按钮、标签显示名来自 `state.tags`、`busy` 时它禁用（正反各一条）、唯一一处 `kind: 'download-mod'`（送 origin）、不重算投影、面板那一处调用点喂三格、`Files.tsx` 接到 `handlers.downloadMissing`、那条通道在动作层已有实现、" +
    '而 G2 那条线（添加文件夹）在**三层**上都带着 `page.version`',
);

// ---------------------------------------------------------------------------
// ㊵ ★★ 清理：T6 删掉的那五个文件**不许**再被页面引用，而且必须真的不在树里
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 这一组是 T6 的"删干净"读数。那五个文件（`FileUpdateTable` / `FileUpdatesPanel` /
 *    `ModFoldersPanel` / `MissingModsList` / `scripts/filesrender.tsx`）已经删了，
 *    而**静态渲染看不见"某个组件又被 import 回来了"**：一个被重新 import 的组件不会让
 *    任何产物变红 —— 它只是又出现在页面上（`filesrender.tsx` ⑰ 那条**粗糙的**判据
 *    就是这种守卫的反面教材：它拿"产物里有没有某个类名"代理"有没有画出那张表"）。
 *    ⇒ 判据落在**源码**上：页面那一棵树的每一份源码里都不许再出现那四个模块名。
 * ⚠️★ 扫描面是**页面那一棵树**（`Files.tsx` + 它下面挂着的每一个组件），不只是
 *    `Files.tsx`：T5 评审点名的正是这件事 —— 计划原稿只扫 `Files.tsx` +
 *    `ModDownloadPanel.tsx`，而**最新的**那一格（`VersionModList.tsx`）不在里面
 *    ⇒ 它从已删文件 import 一个 `VERDICT_HINTS` 可以一路绿（T6 真的撞到过这个形状：
 *    那两个 import 就是从这里搬走的）。
 * ⚠️ 必须走 `withoutComments`：那几个幸存组件的**文件头注释**里逐字写着这些名字
 *    （"它原来是 `ModFoldersPanel` 的…"），不剥注释的话这一组在**正确**的产物上报红。
 * ⚠️ 第二条（文件真的不在树里）与第一条**独立**：一个被 `git restore` 回来的文件可以
 *    没有任何人 import 它 ⇒ 源码那条照样绿，只有这一条会红。
 * ★★ **CT-5（最终修复波）：`ModFoldersData.tsx` 也在扫描面里。** 它是这一页的**共用层**
 *    （`Files.tsx` + `VersionFolderList` + `VersionModList` + `ModDownloadPanel` 都 import 它），
 *    而原稿的 7 个文件里**没有它** ⇒ 从那个文件里 import 一个已删模块可以一路绿 ——
 *    而那正是这一组要防的形状（T6 从 `FileUpdateTable` 搬走 `VERDICT_HINTS` 就是一次真实的搬家）。
 * ★ 能红的刀（读数在报告里）：把 `import { VERDICT_HINTS } from '@/components/FileUpdateTable';`
 *    加回 `VersionModList.tsx` ⇒ 第一条红；再把那个文件从快照拷回来 ⇒ 第二条红；
 *    ⚠️ 加回 **`ModFoldersData.tsx`** ⇒ 现在第一条也会红（CT-5 之前它不会）。
 */
const PAGE_TREE = [
  '../src/routes/Files.tsx',
  '../src/components/ModDownloadPanel.tsx',
  '../src/components/ModFoldersData.tsx',
  '../src/components/VersionFolderList.tsx',
  '../src/components/VersionModList.tsx',
  '../src/components/FolderJarList.tsx',
  '../src/components/AllFoldersView.tsx',
  '../src/components/ToolsPanel.tsx',
] as const;
/** T6 删掉的四个**组件**（第五个是脚本，由下面第二条断言管）。 */
const DELETED_MODULES = [
  'FileUpdateTable',
  'FileUpdatesPanel',
  'ModFoldersPanel',
  'MissingModsList',
] as const;
const pageSource = PAGE_TREE.map((path) =>
  withoutComments(readFileSync(new URL(path, import.meta.url), 'utf8')),
).join('\n');
/*
 * ★ 探针（§5.38 的同一条纪律）：先证**扫描面真的读到了东西** —— 读到空串的话，
 *   下面那条"一个都不许出现"在任何输入下都成立（一条恒真的守卫比没有守卫更坏）。
 *    ⚠️ 两个词取的是**页面自己**的名字：`Files`/`ModDownloadPanel` 那两份源码里必然有。
 */
assert.ok(
  pageSource.includes('ModDownloadPanel') && pageSource.includes('VersionModList'),
  '探针：扫描面必须真的读到那几份源码（读空了的话，下面那条守卫会变成恒真）',
);
assert.deepEqual(
  DELETED_MODULES.filter((name) => pageSource.includes(name)),
  [],
  '★★ 页面那一棵树里不许再出现 T6 删掉的四个组件 —— 它们已经不在树里了，' +
    '再 import 一次就是"删了又装回来"，而静态渲染**看不见**这件事（T5 评审点名：' +
    '计划原稿只扫 Files.tsx + ModDownloadPanel.tsx，会漏掉最新的 VersionModList.tsx）',
);
const DELETED_FILES = [
  '../src/components/FileUpdateTable.tsx',
  '../src/components/FileUpdatesPanel.tsx',
  '../src/components/ModFoldersPanel.tsx',
  '../src/components/MissingModsList.tsx',
  '../scripts/filesrender.tsx',
] as const;
assert.deepEqual(
  DELETED_FILES.filter((path) => existsSync(new URL(path, import.meta.url))),
  [],
  '★★ 那五个文件必须真的**不在树里**（与上面那条独立：一个被恢复回来的文件可以没有任何人 ' +
    'import 它 ⇒ 源码那条照样绿）',
);
ok('㊵ 清理：页面那一棵树不再引用四个已删组件，那五个文件也不在树里（扫描面含 VersionModList）');

// ---------------------------------------------------------------------------
// ㊶ 下载进度与取消（子项目 C）：行内 / 批量 / 写盘相位 / 取消（spec §4、§6.8–6.11）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 这一组直接渲染 `DownloadProgressLine`（纯 props 组件）并**写死 `now`** ——
 *    速度与 ETA 是"按时间算出来的"，不写死时钟的话这一组会在慢机器上偶发地红
 *    （样本落到 3 秒窗口之外 ⇒ 显示 `—`）。夹具的 `at` 与 `now` 因此必须成对给出。
 * ⚠️★ `apps/web/scripts/**` **不在任何 tsconfig 里**（`tsc` 不看它、`tsx` 只剥类型）
 *    ⇒ 夹具写错在门禁上是无声的：本组靠**两样**兜住 ——
 *      ① 缺键由 `resolved()` 自带断言（i18next 缺键时原样返回 key ⇒ 正面断言会退化成
 *         key 比 key、反面断言直接静默变绿）；
 *      ② 定位 helper（`folderRowSpanOf` / `jarRowOf` / `modRowOf` / `folderBodyOf`）找不到
 *         那个对象就当场红。⚠️★ T5 修复轮 1（评审 Minor）订正：原稿那句"**下面每一条都带
 *         '夹具自钉'**"是**假话** —— 本组里带"夹具自钉"字样的断言一条都没有（不会因此空跑，
 *         理由就是上面那两样；评审核过同一条）。
 *
 * ⚠️★★ 本组对简报有**三处机械改准**（简报那三条判据与这个脚本的**导出面**对不上；
 *     逐条的现场、原始读数与替代措辞写在 `task-5-report.md` §④ 里）：
 *   ① 简报写 `textOf(产物).includes(t(key, vars))`，而 `textOf` 把**空白全压掉**
 *      （`decode(markup.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, '')`），`t()` 返回的
 *      那句**带空格** ⇒ 那三条在任何实现下都不可能绿。本仓既有的写法是**两边过同一个
 *      口径**（㉝ 那三条：`textOf(x).includes(textOf(resolved(key, vars)))`）⇒ 这里用
 *      `labelOf`（它就是 `textOf(resolved(...))`）。**判据的内容（哪几个数、哪句话）一字未改**。
 *   ② 同理那条正则：对着 `textOf` 的产物要写**没有空格**的那一份
 *      （`/11\.8MB\/25\.8MB·46%·.*\/s·/`）—— 它要的三个数（字节 / 百分比 / 速度）一字未改。
 *   ③ 容器那条把 `第 3/48 项` **写死成中文** ⇒ `--en` 那一遍必红（英文词条是
 *      `Item {{index}}/{{count}}`）。这里按**当前语言**取那句。⚠️★ T5 修复轮 1 订正：
 *      简报那个"1200 字符窗口"**也已经不用了**（它不是语言稳定的：实测 zh 偏移 1138 /
 *      en 1252）⇒ 窗口改成 `folderRowSpanOf()` 那一行的边界，理由与真读数写在下面那条断言上
 *      （原稿在这里写"窗口口径与简报逐字同一条"，那句话在 D5 之后就错了）。
 */
const progressSample = (received: number, at: number): TimedSample => ({
  at,
  received,
  total: 27_100_000,
});
const progressFrameOf = (over: Partial<DownloadProgress> = {}): DownloadProgress => ({
  run: 'update-mod',
  phase: 'download',
  folderId: 'f1',
  modid: 'sodium',
  fileName: 'sodium-2.5.1+1.16.1.jar',
  received: 12_400_000,
  total: 27_100_000,
  itemIndex: 1,
  itemCount: 1,
  runStartedAt: 0,
  cancelling: false,
  ...over,
});
const NOW = 10_000;
const inlineHtml = keep(
  html(
    React.createElement(DownloadProgressLine, {
      progress: {
        frame: progressFrameOf(),
        samples: [progressSample(11_400_000, NOW - 1000), progressSample(12_400_000, NOW)],
      },
      onCancel: noop,
      now: NOW,
    }),
  ),
);
assert.ok(
  textOf(inlineHtml).includes('sodium-2.5.1+1.16.1.jar'),
  '★ 行内那一条印出**文件名**（用户要知道正在下哪一个）',
);
assert.match(
  textOf(inlineHtml),
  /11\.8MB\/25\.8MB·46%·.*\/s·/,
  '★★ 行内显示含**字节 / 百分比 / 速度**（这一份夹具实测是 `11.8 MB / 25.8 MB · 46% · 976.6 KB/s`）—— ' +
    '三个数都要在，只画进度条的话这一条红',
);
assert.equal(
  textOf(inlineHtml).includes('—'),
  false,
  '★ 反面：样本够（两个、间隔 1 秒）时**不许**出现"算不出来"那个符号',
);
/*
 * ★★ T5 修复轮 1（评审 Important 1 的第 3 点）：那颗取消按钮的**身份**。
 *
 * ⚠️★ 全仓这条线今天只有**编译期**证据（`Files.tsx` 的 `never` 穷尽性守卫）⇒ 没人钉过
 *    "按钮真的画出来了、而且文案就是 `common.cancel`"。这一条钉的是**产物**那一半
 *    （⭐ 它**不**证"点它会调到 `handlers.cancelDownload`" —— 静态渲染不跑事件处理器，
 *    那条边界写在脚本末尾）。
 * ⚠️ 两边过同一个口径（`labelsIn` 归一化后的文案 vs `labelOf`）。
 */
assert.ok(
  labelsIn(inlineHtml).includes(labelOf('common.cancel')) &&
    inlineHtml.includes('data-action="cancel-download"'),
  '★★ 取消那颗按钮的身份：文案是 `common.cancel`、机器读数是 `data-action="cancel-download"`' +
    '（缺任何一半这条就红 —— 它钉的是"那个入口真的画出来了"）',
);
const noSampleHtml = keep(
  html(
    React.createElement(DownloadProgressLine, {
      progress: { frame: progressFrameOf(), samples: [] },
      onCancel: noop,
      now: NOW,
    }),
  ),
);
assert.ok(
  textOf(noSampleHtml).includes('—'),
  '★★ 样本不足 ⇒ 速度与 ETA 显示 `—`（**不猜**：D2）—— 实现里写 `?? 0` 的会红',
);
assert.equal(
  textOf(noSampleHtml).includes('0 B/s'),
  false,
  '★ 反面：那一格**不许**退成 `0 B/s`（"还没量出来"与"真的 0"是两句话）',
);
assert.ok(
  textOf(noSampleHtml).includes(
    labelOf('files.progressLine', {
      done: '11.8 MB',
      total: '25.8 MB',
      percent: '46%',
      rate: '—',
      eta: '—',
    }),
  ),
  '★ 而**百分比仍然算得出来**（它只用帧里的两个数，不需要样本 —— 把百分比也一起置成 `—` 是实现走过头）',
);
/** 单行那一句（这份帧 ⇒ 这几个数；`samples: []` ⇒ 速度与 ETA 都是 `—`）。 */
const lineCopy = labelOf('files.progressLine', {
  done: '11.8 MB',
  total: '25.8 MB',
  percent: '46%',
  rate: '—',
  eta: '—',
});
/** 批量那一句「第 3/48 项 · <文件名>」（`itemIndex` / `itemCount` 来自帧，名字也在里面）。 */
const batchCopy = resolved('files.progressBatch', {
  index: 3,
  count: 48,
  name: progressFrameOf().fileName,
});
/**
 * 同一个句子的**归一化**形式（`textOf` 那套口径，空白全压掉）。
 *
 * ⚠️★ 两个变量都要有，而且要**用对**：`batchCopy` 是**原样**（带空格），只能比
 *    `产物片段.includes(...)`（`folderRowSpanOf` 那一类）；`batchLabel` 是压过的，
 *    只能比 `textOf(产物).includes(...)`。⚠️ 拿"带空格的那一份"去比 `textOf` 的产物
 *    是一条**恒假**的断言（永远绿、什么都没测 —— `docs/pending.md §5.32①`）；
 *    反过来（压过的去比原样产物）会在**正确的**实现上报红（修复轮 2 真的踩了一次，记在报告里）。
 */
const batchLabel = textOf(batchCopy);
const batchHtml = keep(
  html(
    React.createElement(DownloadProgressLine, {
      progress: {
        frame: progressFrameOf({ run: 'update-folder-all', itemIndex: 3, itemCount: 48 }),
        samples: [],
      },
      onCancel: noop,
      /* ★★ 汇总档：`VersionFolderList` 的文件夹块那一处就是这么传的（见 ① 那一组的接线断言）。 */
      variant: 'summary',
      now: NOW,
    }),
  ),
);
assert.ok(
  textOf(batchHtml).includes(
    labelOf('files.progressBatch', { index: 3, count: 48, name: progressFrameOf().fileName }),
  ),
  '★★ 汇总档（批量）印「第 3/48 项 · <文件名>」（spec §4 的第二档；`itemIndex/itemCount` 来自帧）',
);
/*
 * ★★★ T5 修复轮 2（复审"范围外观察"里那条 spec 缺口）：**汇总档那一行里也要有字节**。
 *
 * ⚠️★ 修之前 `DownloadProgressLine` 写的是"`itemCount > 1` ⇒ 一律印批量文案"，于是
 *    批量时**四处都不印字节**（连"正在下的那一行"也不印），而 spec §4：
 *      第 1 档要求**正在下的那一行**显示 字节 / 百分比 / 速度 / ETA；
 *      第 2 档说的是在文件夹块上**另加**一行「第 3/48 项 · <文件名> …」，
 *      而它自己的例子（`12.4/27.1 MB · 46%`）里**也有字节**。
 *    ⇒ 今天用户在**最常走的那条路**（48 个 mod 的整夹「全部更新」）上看不到任何字节读数。
 * ⚠️ 这份夹具的样本是空的 ⇒ 速度 / ETA 是 `—`（`lineCopy` 里那两个格子就是 `—`）
 *    —— 字节与百分比仍然照印（它们只来自帧）。
 * ★ 能红的刀：把实现改回"`variant === 'summary' && itemCount > 1` ⇒ 只印序号句" ⇒ 这一条红。
 */
assert.ok(
  textOf(batchHtml).includes(lineCopy),
  '★★★ 汇总档**同一行里还有字节行**（`files.progressLine`：字节 / 百分比 / 速度 / ETA 四格都要在）' +
    '—— spec §4 第 2 档说的是"另加一行"、它自己的例子 `12.4/27.1 MB · 46%` 里就有字节；' +
    '把实现写回"批量只印序号句"，这一条就红',
);

/*
 * ★★★ 同一个**批量帧**、换成**行内档**（不传 `variant` ⇒ 默认 `'inline'`）：
 *      **字节行在、序号句不在**（spec §4 第 1 档："正在下的那一行"显示 字节 / 百分比 / 速度 / ETA）。
 *
 * ⚠️★ 这一条是复审那条 spec 缺口的**正面刀**：修之前行内档在 `itemCount > 1` 时只印序号句 ⇒
 *    用户在整夹「全部更新」那一趟上，连"正在下的这一项"的字节都看不到（`FolderJarList` /
 *    `VersionModList` 两处都是这样）。⚠️ 两个站点的**接线**由下面 ① 那两条断言钉着，这一条钉的是
 *    **组件在批量帧下画什么**（自喂 prop —— 那一层能证的事，见下面那一段的三层说明）。
 * ★ 能红的刀：把实现改回"**行内档**上 `itemCount > 1` ⇒ 只印序号句" ⇒ **这一条**红
 *    （修复轮 2 实测：红的就是这一条；逐字读数记在报告 §三）。
 *    ⚠️ 如果**连汇总档一起**改回"`itemCount > 1` ⇒ 只印序号句、不分档"，**先**红的会是上面
 *    汇总档那条字节断言 —— 两把刀红的点不同，别把后者当成"这一条也验过了"。
 */
const batchInlineHtml = keep(
  html(
    React.createElement(DownloadProgressLine, {
      progress: {
        frame: progressFrameOf({ run: 'update-folder-all', itemIndex: 3, itemCount: 48 }),
        samples: [],
      },
      onCancel: noop,
      now: NOW,
    }),
  ),
);
assert.ok(
  textOf(batchInlineHtml).includes(lineCopy),
  '★★★ 行内档（不传 `variant`）拿到**批量**那一帧时**照样**印字节行（`files.progressLine`）—— ' +
    '行内那一行说的是"这一项自己"的字节 / 速度 / ETA，与"整趟的第几项"是两件事（spec §4 第 1 档）',
);
assert.equal(
  textOf(batchInlineHtml).includes(batchLabel),
  false,
  '★★ 反面：行内档**不印**序号句（「第 N/M 项 · <文件名>」是**汇总档**的事）—— ' +
    '两档不分（行内也印序号）时这条红',
);

/* —— 容器层面：批量那一行真的画在**这个文件夹块**上（不是画在面板顶上） —— */
/*
 * ⚠️★ 夹具是**两个**同版本的文件夹（`f1` / `f2`，进度那一趟属于 `f1`）：只有一个的话
 *    "画在**别的**文件夹里"那一半**无从断言**（`folderRowSpanOf` 的窗口会一直开到产物末尾）。
 */
const batchListState = stateOf([ROW_GITHUB], {
  folders: [folder({ folderId: 'f1' }), folder({ folderId: 'f2' })],
});
const batchListHtml = keep(
  html(
    React.createElement(VersionFolderList, {
      state: batchListState,
      page: planVersionPage(batchListState, []),
      expanded: [],
      onToggle: noop,
      onAction: noop,
      progress: {
        frame: progressFrameOf({ run: 'update-folder-all', itemIndex: 3, itemCount: 48 }),
        samples: [],
      },
    }),
  ),
);
/*
 * ★★ 那一行画在**那个文件夹的行里**（spec §4 第二档）。
 *
 * ⚠️★★ 这里对简报有一处**判据机制**的改准（现场读数在报告 §④ D5）：
 *    简报写的是"`data-folder-id="f1"` 之后 **1200** 个字符之内"。那个数**不是语言稳定的**：
 *    同一份产物里那一句的偏移实测是 **zh 1138 / en 1252**（T5 报告 §④ D5 的现场读数；
 *    它随词条长度、下拉里有几个选项、以及「全部更新」那颗按钮上有没有数字而变）⇒ 那条断言
 *    在 --en 那一遍会在**正确**的实现上报红（en 的 1252 > 1200）。
 *    ⚠️★ T5 修复轮 1（评审 Minor）：原稿在这一段写的是 `zh ≈1196 / en ≈1305` —— 那两个数
 *    与报告里的真读数**对不上**（报告 D5 逐字写的是 1138 / 1252），这里就地改准。
 *    ⇒ 改用本文件**已有的** `folderRowSpanOf()`（它切的正是"这一行那一段"：
 *    从 `data-folder-id="X"` 到**下一个** `data-folder-id=` 为止）—— 判据的**意思**
 *    （"画在这一行里、不画在面板顶上、也不画在别的文件夹里"）一字未改，而且**更严**：
 *    下面那条反面断言把"画在别的文件夹里"这一半也真的钉住了（简报只在说明文字里提到它）。
 * ⚠️★ T5 修复轮 2：`batchCopy` 的定义挪到上面（`lineCopy` 旁边）—— 新增的那条**行内档**
 *    断言要用它断"**不**印序号句"，两处各写一份会漂。
 */
const batchRow = folderRowSpanOf(batchListHtml, 'f1');
assert.ok(
  batchRow.includes(batchCopy),
  '★★ 那一行画在**那个文件夹的行里**（spec §4 第二档："文件夹块上的汇总行"）—— ' +
    '画到面板顶上，这一条就红',
);
assert.equal(
  folderRowSpanOf(batchListHtml, 'f2').includes(batchCopy),
  false,
  '★★ 反面：**别的**文件夹那一行里一个字节都不许有它（"这一趟的进度只属于它自己那个文件夹"）',
);

/*
 * ===========================================================================
 * ★★ 页面那份 `progress` 真的走到了**三个渲染点**吗（T5 修复轮 1 / 评审 Important 1）
 * ===========================================================================
 * ⚠️★ 修之前：这一组里 `ModDownloadPanel` / `FolderJarList` / `VersionModList` 的夹具
 *    传的全是 `progress: null`，非空的只有 `DownloadProgressLine` 自己与**自喂**给
 *    `VersionFolderList` 的那一处 ⇒ 把面板那两处转发、或两个行内站点整段删掉，
 *    **两条门禁全绿、㊶ 全绿**，而界面上是"下载在跑、进度一条都不见"。
 * ⇒ 下面分三层补，每一层钉的是**不同的一环**（缺哪一环就有一种"整段删掉还全绿"的坏法）：
 *    ① 两个**行内**站点（`FolderJarList` / `VersionModList`）各自一正一反 —— 组件级、
 *       自检自己喂 prop ⇒ 证"组件收到非空载荷会画、不匹配就不画"（一正一反防"无条件画"）；
 *       ⚠️★ T5 修复轮 2：这两处的载荷换成**批量帧**（`itemCount: 48`）⇒ 断的是
 *       **字节行**（`lineCopy`）在、而**序号句**（`batchCopy`）**不在** ——
 *       行内档说的是"这一项自己"（spec §4 第 1 档），不是"整趟的第几项"；
 *    ② **面板**那一层传非空载荷 ⇒ 断言 `VersionFolderList` 与 `VersionModList` **两个站点**
 *       都出现了那一行（"两处转发都没被写成 `progress={null}`"的唯一判据），
 *       而**两处各自印什么**（汇总站点含序号句 + 字节行；行内站点含字节行、**不含**序号句）
 *       也在这里分开断（T5 修复轮 2 改准：原来两处断的是同一句序号句）；
 *    ③ `VersionFolderList` → **展开体里那一行**（`FolderJarList`）—— 面板那一层**做不到**
 *       这一环：`ModDownloadPanel` 的 `expanded` 是它自己的 `useState([])`，静态渲染展开不了
 *       ⇒ 这一环只能打在这一层（自喂），而"面板真的把载荷交给了 `VersionFolderList`"
 *       由 ② 的文件夹块那一行兜着。
 * ⚠️★ 只加在 `VersionFolderList` 自喂那一层**不算**（`folderBodyOf` 那段 doc 注释里记着
 *    T4 判修轮的同一条裁定：自检自己喂的 prop 证明不了页面真的喂了它 —— 所以 ② 必须存在）。
 */

/** 非空载荷（帧只换指认那一格；样本为空 ⇒ 内容与时钟无关）。 */
const linePayloadOf = (over: Partial<DownloadProgress>): PageProgress => ({
  frame: progressFrameOf(over),
  samples: [],
});

/* —— ① `FolderJarList`（展开体里那一行）：一正一反 —— */
/*
 * ⚠️ 夹具 `jarState` 的 `f-jars` 里有 `sodium` 那一行（见 ㊱ 那一组）；
 *    帧的 `folderId` / `modid` 都指它 ⇒ 命中；两个反面各换掉**一个**格子。
 * ⚠️★ T5 修复轮 2：载荷换成**批量帧**（`itemCount: 48`）—— 行内档在批量时**也**要印字节行、
 *    而**不**印序号句（spec §4 第 1 档说的是**正在下的那一行**，见文件头"两档"那一段）。
 */
const jarLineHtml = jarListHtmlOf(
  jarState,
  'f-jars',
  linePayloadOf({
    folderId: 'f-jars',
    modid: 'sodium',
    run: 'update-folder-all',
    itemIndex: 3,
    itemCount: 48,
  }),
);
const jarLineRow = jarRowOf(jarLineHtml, 'sodium');
assert.ok(
  textOf(jarLineRow).includes(lineCopy) && jarLineRow.includes('data-action="cancel-download"'),
  '★★★ `FolderJarList` 拿到非空 `progress` ⇒ **命中那一行**画出行内档（**字节行** `files.progressLine` + 取消按钮）' +
    '—— 把这一块整段删掉，这条就红',
);
assert.equal(
  textOf(jarLineRow).includes(batchLabel),
  false,
  '★★ 反面：行内档**不印**「第 N/M 项」（那是文件夹块上**汇总档**的事）—— ' +
    '实现写回"批量 ⇒ 行内也印序号句"这条就红（spec §4 两档分得开）',
);
const jarOtherModHtml = jarListHtmlOf(
  jarState,
  'f-jars',
  linePayloadOf({ folderId: 'f-jars', modid: 'lithium' }),
);
const jarOtherFolderHtml = jarListHtmlOf(
  jarState,
  'f-jars',
  linePayloadOf({ folderId: 'f-elsewhere', modid: 'sodium' }),
);
assert.ok(
  ![jarOtherModHtml, jarOtherFolderHtml].some(
    (markup) =>
      textOf(markup).includes(lineCopy) || markup.includes('data-action="cancel-download"'),
  ),
  '★★ 反面（两半）：换 `modid`（`lithium` —— 这一夹里没有它）与换 `folderId`（`f-elsewhere`' +
    ' —— 这一行不是它）都**一句都不画**（"无条件画"与"只比 modid"的实现都会红）',
);

/* —— ① `VersionModList`（第三段那一行）：一正一反 —— */
/*
 * ⚠️★ 第三段的命中判据里 `folderId` 是**用户选中的目标**（`VersionModList` 那一段写着理由）
 *    ⇒ 夹具 `modListState` 里 `sodium` **已经在 `f1` 里**（那条自钉在 ㊳）、目标只剩 `f2`：
 *    帧必须用 `f2` 才命中（用 `f1` 就是下面那条反面 —— 也正因为它不是恒真的，判据才咬得住）。
 * ⚠️★ T5 修复轮 2：同上，载荷换成**批量帧** ⇒ 断的是字节行在、序号句不在。
 */
const modLineHtml = modListHtmlOf(
  modListState,
  [],
  linePayloadOf({
    folderId: 'f2',
    modid: 'sodium',
    run: 'update-folder-all',
    itemIndex: 3,
    itemCount: 48,
  }),
);
const modLineRow = modRowOf(modLineHtml, 'sodium');
assert.ok(
  textOf(modLineRow).includes(lineCopy) && modLineRow.includes('data-action="cancel-download"'),
  '★★★ `VersionModList` 拿到非空 `progress` ⇒ **命中那一行**画出行内档（**字节行** + 取消按钮）' +
    '—— 批量帧下**照样**有字节（spec §4 第 1 档）',
);
assert.equal(
  textOf(modLineRow).includes(batchLabel),
  false,
  '★★ 反面：行内档**不印**「第 N/M 项」（那是文件夹块上**汇总档**的事）',
);
const modOtherModHtml = modListHtmlOf(
  modListState,
  [],
  linePayloadOf({ folderId: 'f2', modid: 'nobody' }),
);
const modOtherFolderHtml = modListHtmlOf(
  modListState,
  [],
  linePayloadOf({ folderId: 'f1', modid: 'sodium' }),
);
assert.ok(
  ![modOtherModHtml, modOtherFolderHtml].some(
    (markup) =>
      textOf(markup).includes(lineCopy) || markup.includes('data-action="cancel-download"'),
  ),
  '★★ 反面（两半）：换 `modid`（`nobody` —— 这一版里没有它）与换 `folderId`（`f1` —— ' +
    '`sodium` 的目标是 `f2`）都**一句都不画**（"无条件画"与"只比 modid"的实现都会红）',
);

/* —— ② 面板那一层：两处转发都没被写成 `progress={null}` —— */
/*
 * ⚠️ 夹具的**两个文件夹都空** ⇒ `sodium` 的目标 = `f1`（第一个合法的）⇒ 同一份非空载荷
 *    同时落在两个站点上：`VersionFolderList` 的**批量汇总行**（`folderId === 'f1'` 且
 *    `itemCount > 1`）与 `VersionModList` 的**行内**（那一行选中的目标就是 `f1`）。
 */
const panelLineState = stateOf([modRowFixture('sodium', 'Sodium Prime')], {
  tags: [MOD_TAG],
  folders: [folder({ folderId: 'f1', rows: [] }), folder({ folderId: 'f2', rows: [] })],
});
const panelLineHtml = keep(
  html(
    React.createElement(ModDownloadPanel, {
      state: panelLineState,
      onAction: noop,
      progress: linePayloadOf({
        run: 'update-folder-all',
        folderId: 'f1',
        itemIndex: 3,
        itemCount: 48,
      }),
    }),
  ),
);
/*
 * ⚠️★ T5 修复轮 2 改准：**两处各自印什么**（原来两处断的是同一句序号句 —— 那样一来
 *    "行内站点少印字节行"这件事在这一层上**咬不住**，而它正是复审咬的那条缺口）：
 *      · **汇总站点**（`VersionFolderList` 的文件夹块，`variant="summary"`）⇒ 含序号句；
 *      · **行内站点**（`VersionModList` 第三段那一行）⇒ 含**字节行**、**不含**序号句。
 */
assert.ok(
  folderRowSpanOf(panelLineHtml, 'f1').includes(batchCopy),
  '★★★ 面板把 `progress` 转发给了**汇总站点**（`VersionFolderList` 的文件夹块）：' +
    '那儿出现了「第 3/48 项 · <文件名>」—— 这一处被写成 `progress={null}` 这条就红',
);
const panelInlineRow = modRowOf(panelLineHtml, 'sodium');
assert.ok(
  textOf(panelInlineRow).includes(lineCopy),
  '★★★ 而**行内站点**（`VersionModList` 第三段那一行）印的是**字节行**（批量帧也不许只剩序号句）' +
    '—— 这一处被写成 `progress={null}`、或行内档跟着批量退化成"只印序号句"，这条就红',
);
assert.equal(
  panelInlineRow.includes(batchCopy),
  false,
  '★★ 反面：行内站点**不含**序号句（两档分得开：行内说"这一项自己"，汇总说"整趟的第几项"）',
);
assert.equal(
  countOf(panelLineHtml, 'data-action="cancel-download"'),
  2,
  '★ 而且两个站点各带一颗取消按钮（同一份载荷画了两条**各有取消入口**的行 —— 不是复写同一处）',
);

/* —— ③ `VersionFolderList` → 展开体里的 `FolderJarList`（面板那一层做不到这一环，见上） —— */
const chainListState = stateOf([ROW_GITHUB], {
  folders: [
    folder({ folderId: 'f1', rows: [folderRow({ modid: 'sodium' })] }),
    folder({ folderId: 'f2', rows: [] }),
  ],
});
const chainListHtml = keep(
  html(
    React.createElement(VersionFolderList, {
      state: chainListState,
      page: planVersionPage(chainListState, ['f1']),
      expanded: ['f1'],
      onToggle: noop,
      onAction: noop,
      progress: linePayloadOf({ folderId: 'f1', modid: 'sodium' }),
    }),
  ),
);
assert.ok(
  textOf(jarRowOf(chainListHtml, 'sodium')).includes(lineCopy) &&
    jarRowOf(chainListHtml, 'sodium').includes('data-action="cancel-download"'),
  '★★ `VersionFolderList` 把 `progress` 也交给了展开体里的 `FolderJarList`（命中那一行画出来了）' +
    '—— 这条链的最后一段（前两段由 ② 的两个站点兜着）',
);
assert.equal(
  countOf(chainListHtml, 'data-action="cancel-download"'),
  1,
  '★ 单行帧（`itemCount: 1`）下**只有行内那一条**：文件夹块上那条汇总行只在批量时画' +
    '（恒画汇总行的实现这条就红 —— spec §4 的两档）',
);
const installHtml = keep(
  html(
    React.createElement(DownloadProgressLine, {
      progress: { frame: progressFrameOf({ phase: 'install' }), samples: [] },
      onCancel: noop,
      now: NOW,
    }),
  ),
);
assert.ok(
  textOf(installHtml).includes(
    labelOf('files.progressInstall', { name: progressFrameOf().fileName }),
  ),
  '★ 写盘相位印「正在写入 …」（不是字节：那不是网络流量 —— D7）',
);
assert.equal(
  textOf(installHtml).includes('MB'),
  false,
  '★★ 而写盘相位**没有**字节也没有 ETA（同一份帧、只换相位 —— 只写"有那句写入文案"的话，' +
    '一个"照旧印字节"的实现照样绿）。' +
    '⚠️ T5 修复轮 1 核实：这一条的条件只咬"字节"那一半（`MB`）—— "也没有 ETA"那一半由' +
    '`services/api/src/download-progress-shared.test.ts` 的写盘相位那条（`view.received/total/rate/eta` 四格全是 `—`）钉着，' +
    '在这里**无法**再分一次（同一份 `samples: []` 下任何实现的 ETA 格都是 `—`）',
);
assert.deepEqual(
  buttonsIn(installHtml).map((button) => button.disabled),
  [true],
  '★★ 写盘相位：取消按钮 **disabled**（D4：那一刻中断会留下半成品）',
);
assert.ok(
  textOf(installHtml).includes(labelOf('files.progressCancelBlocked')),
  '★ 而且写明为什么不能点（置灰而不说话等于一个坏按钮）',
);
/*
 * ★★ 便宜判据 1（最终修复波）：`!view.installing` 这个分支也要有牙齿。
 *
 * ⚠️★ 上面那条只证明"写盘相位印了那句写入文案" —— 它**碰不到** `batchSentence` 里那个
 *    `!view.installing`：写盘那一帧（`progressFrameOf({ phase: 'install' })`）的
 *    `itemCount` 是 1 ⇒ 就算把 `!view.installing` 整个删掉，`itemCount > 1` 也已经是 `false`
 *    ⇒ 序号句照样不出现。⇒ 这一条把**另外两个条件都置真**（汇总档 + `itemCount: 48`），
 *    只留写盘相位挡着它。能红的刀：把 `batchSentence` 里的 `!view.installing` 删掉 ⇒ 这一条红。
 */
const installSummaryHtml = keep(
  html(
    React.createElement(DownloadProgressLine, {
      progress: {
        frame: progressFrameOf({
          phase: 'install',
          run: 'update-folder-all',
          itemIndex: 3,
          itemCount: 48,
        }),
        samples: [],
      },
      onCancel: noop,
      variant: 'summary',
      now: NOW,
    }),
  ),
);
assert.ok(
  textOf(installSummaryHtml).includes(
    labelOf('files.progressInstall', { name: progressFrameOf().fileName }),
  ),
  '★ 汇总档 + 批量（`itemCount: 48`）+ 写盘相位 ⇒ 照旧印「正在写入 …」',
);
assert.equal(
  textOf(installSummaryHtml).includes(batchLabel),
  false,
  '★★ 反面：写盘相位**不印**批量序号句（"整趟的第几项"那一刻不是用户要的读数）—— ' +
    '把 `batchSentence` 里那个 `!view.installing` 删掉，这一条就红（上一条碰不到它）',
);
const cancellingHtml = keep(
  html(
    React.createElement(DownloadProgressLine, {
      progress: { frame: progressFrameOf({ cancelling: true }), samples: [] },
      onCancel: noop,
      now: NOW,
    }),
  ),
);
assert.ok(
  textOf(cancellingHtml).includes(labelOf('files.progressCancelling')),
  '★★ `cancelling: true` ⇒ 按钮文案变「正在取消…」（用户点过之后要有回应）',
);
assert.deepEqual(
  buttonsIn(cancellingHtml).map((button) => button.disabled),
  [true],
  '★ 而且不可再点（连点两次不该发两次请求）',
);
/*
 * ★★ 一趟的汇总行（`files.lastRunSummary` + `files.lastRunCancelled`）。
 *
 * ⚠️★ 为什么要在这里加一条：`files.lastRunSummary` 在本次改动**之前没有任何渲染点**
 *    （一条死键 —— T6 把旧第二部分删掉之后就没有了），而 D4 要的是"取消**单独说**"。
 *    ⇒ 判据打在**面板的产物**上（不是打在某个组件上）：这两句话是页面级别的读数。
 * ★ 能红的刀：把面板里那一格 `<p className="moddownload__lastrun">` 删掉 ⇒ 红。
 */
const lastRunState = stateOf([ROW_GITHUB], {
  folders: [folder({ folderId: 'f1' })],
  lastRun: {
    updated: ['sodium'],
    skipped: [{ modid: 'lithium', reason: 'up-to-date' }],
    failed: [],
    cancelled: [{ modid: 'optifine', reason: 'cancelled' }],
  },
});
const lastRunHtml = keep(
  html(
    React.createElement(ModDownloadPanel, { state: lastRunState, onAction: noop, progress: null }),
  ),
);
assert.ok(
  textOf(lastRunHtml).includes(
    labelOf('files.lastRunSummary', { ok: 1, skipped: 1, failed: 0, cancelled: 1 }),
  ),
  '★★ 上一趟的汇总印出来，而且**取消单独一格**（D4：并进 `failed` 会让界面说"更新失败"，' +
    '而事实是"按你说的停了"）',
);
assert.ok(
  textOf(lastRunHtml).includes(
    labelOf('files.lastRunSkipped', { modid: 'lithium', reason: 'up-to-date' }),
  ) && textOf(lastRunHtml).includes(labelOf('files.lastRunCancelled', { modid: 'optifine' })),
  '★★ 而两类**逐条**分开印（`lastRunSkipped` / `lastRunCancelled` 是两条不同的读数）',
);
/* —— 收尾读数：状态说"没有在跑" ⇒ 页面上一条都不许剩（D6 的那条"不会停在最后一帧"） —— */
assert.equal(
  progressOf(
    { ...stateOf([ROW_GITHUB]), progress: null },
    { frame: progressFrameOf(), samples: [] },
  ),
  null,
  '★★ 状态里 `progress: null`（收尾）⇒ 页面**一律**不显示进度（推送晚到的那一帧不许复活它）',
);
assert.equal(
  progressOf({ ...stateOf([ROW_GITHUB]), progress: progressFrameOf() }, null)?.frame.modid,
  'sodium',
  '★ 反面：状态说在跑、而推送还没来过（切 tab 回来）⇒ 那一帧要能用（D6：进度住主进程）',
);
/*
 * ★★★ C1（最终修复波）：**旧桌面壳**那一档 —— `progress` 这一格**根本不在**。
 *
 * ⚠️★ 现场：0.0.5–0.0.7 的壳**有** `modFolders`（⇒ 这一页走 `ready` 那一支）但推来的状态里
 *    没有子项目 C 才加的这一格 ⇒ `state.progress` 是 `undefined`。修之前第一条判据写的是
 *    `=== null`（不成立）⇒ 返回 `{ frame: undefined }` ⇒ `FolderJarList` / `VersionModList` /
 *    `VersionFolderList` 里那句 `progress.frame.folderId` 当场 TypeError，而全仓没有
 *    error boundary ⇒ React 卸载整棵树 = **`/files` 整页白屏**（第一道洞在订阅那一句：
 *    旧壳没有 `onProgress`，同步抛，由 `subscribeProgress` 的能力检测兜住 ——
 *    那一半是 effect 里的接线，静态渲染看不见，见脚本末尾的覆盖边界）。
 * ⚠️★ 判据的形状是**把那一格从夹具对象里删掉**（不是设成 `null`）：设成 `null` 是另一条
 *    （上面那条"收尾"）已经钉住的立面，而这里要的正是"字段缺失"。
 * ★ 能红的刀（最终修复波实测）：把 `progressOf` 第一条判据改回 `state.progress === null`
 *    ⇒ 这一条红（还原后的 `sha256` 记在 `final-fix-report.md` 里）。
 */
const legacyShellState: Record<string, unknown> = { ...stateOf([ROW_GITHUB]) };
delete legacyShellState.progress;
assert.equal(
  progressOf(legacyShellState as unknown as ModFoldersState, null),
  null,
  '★★★ 旧壳（状态里**没有** `progress` 这一格）：与 `progress: null` 同义 ⇒ 一条进度都不显示 —— ' +
    '判据写 `=== null` 的实现会在这里返回 `{ frame: undefined }`，页面随即 TypeError = 整页白屏',
);
ok(
  '㊶ 下载进度与取消：行内档（**批量帧也印**字节/百分比/速度/ETA、不印序号）、样本不足显示 —、' +
    '汇总档（文件夹块上）「第 N/M 项」+ **同一条字节行**、三个渲染点的接线（两个行内站点各一正一反 + ' +
    '面板把载荷转发给两个站点，且两处各自印什么分开断）、取消按钮的身份（`common.cancel` + `data-action`）、' +
    '一趟的汇总行（含取消单独一格）、写盘相位无字节且取消置灰并说明**且不印序号句**（`itemCount: 48` 的汇总档）、' +
    '`cancelling` 变「正在取消…」、收尾之后一律不显示、' +
    '**旧壳缺 `progress` 这一格 ⇒ 与 `null` 同义、一条都不显示**（C1）',
);

// ---------------------------------------------------------------------------
// ⑬ 裸 key 泄漏（用共用的那个**具名**扫描器）—— **写在所有渲染组之后**
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 扫描器**只有这一个**（从 `ModFoldersData` import 的 `rawKeysIn` / `RAW_KEY_RE`，
 *    与 `accountrender.tsx` 里那个**同名但不同源**的各管各的页）：两处各写一个正则的话，
 *    「把扫描器改坏」不会有任何断言出声。两条探针在**扫产物之前**跑 —— 放在后面的话，
 *    一条坏掉的扫描器会被"产物里有泄漏"那条拦住，你看到的是"有泄漏"，而真正坏的是扫描器
 *    （§5.74）。
 *    ⚠️ T6 之前它住在 `FileUpdateTable.tsx`（v1 那张表与第一部分那张表共用），那个文件
 *    随 D1 删了 ⇒ 它搬到 `ModFoldersData.tsx`（搬之前 v1 的消费者已经删掉了）。
 * ⚠️★ **位置是有意的（T6 挪过一次）**：这一组原来排在 ⑬ 那个位置（①–⑫ 之后），
 *    而那时 `keep()` 已经把前面十几组产物收进 `samples` 了。T6 删掉 ①–⑫ 之后，
 *    那个位置**一份产物都还没有** —— 实测第一版打的是"渲染产物（**0 份**）里没有裸 key
 *    泄漏"：扫描器在**空串**上跑，一条恒真的守卫（§5.32① / §5.38）。
 *    ⇒ 挪到**所有渲染组之后**（㉛ 之前），并补上"样本必须非空"那条探针。
 */
assert.ok(
  samples.length > 0,
  `探针：裸 key 扫描必须真的扫到产物（这一轮 samples=${String(samples.length)} 份）—— ` +
    '0 份时下面那条断言在空串上恒真（T6 第一版就是这么写的，挪到渲染组之后才修好）',
);
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
  '泄漏扫描器（`RAW_KEY_RE`，从 `ModFoldersData` import 的那一个）必须同时认得 `files.` 与 `common.` 两个前缀',
);
const leaked = rawKeysIn(samples.join(''));
assert.deepEqual(
  leaked,
  [],
  `裸 key 泄漏：${leaked.join(', ')}（i18next 对未知 key 不报错，它会把这个 key 原样印在界面上）`,
);
ok(`★ 渲染产物（${String(samples.length)} 份）里没有裸 key 泄漏，扫描器本身也已被两条探针夹住`);

// ---------------------------------------------------------------------------
// ㉛ 英文那一遍：全部渲染产物零汉字
// ---------------------------------------------------------------------------
if (LANG === 'en') {
  /*
   * ⚠️★ 只在 `--en` 那一遍跑（词条泄漏只有英文渲染下才暴露：中文环境里 `t()` 会回退到 zh）。
   * ⚠️ 样本里**没有**中文夹具：`TAG_LABEL` / `TAG_OPTION` / `NOTE` 都是 ASCII；
   *    真实的标签显示名两种语言都在状态里（`TagOptionView.labels`）⇒ 这一遍用的就是 `en`
   *    那一份（2026-10-03 的判修顺带修掉了"英文界面上标签名是中文"）。
   *    ⚠️ T6 删掉了 `SKIP_REASON`（`lastRun.skipped[].reason` 那个夹具）：它唯一的渲染点是
   *    旧第二部分，随旧组件一起删了。
   *    主进程写死的 `notices` 仍然是中文，而那是**已接受的代价**
   *    —— 这里**不开豁免口子**：开口子的扫描在**最该抓人的那一处**是瞎的。
   * ⚠️ Task 8 的三块产物也在 `samples` 里（`foldersHtmlOf` / `missingHtmlOf`
   *    都走 `keep()`；⚠️ T3 之后 `partsHtmlOf` 没了，新页面那几组自己 `keep()`）⇒
   *    新加的那些词条（含判修轮的四条与 T3 的七条）一旦哪一条漏了 `en`，
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
 * ⚠️ 组数是**手抄的**（本仓惯例；已删的 `filesrender.tsx` 末段当年写着同一条）：它防的是
 *    "把某一段整块摘掉" —— 删掉一整组断言之后脚本照样绿、照样打印"通过 N 项"，
 *    只有这个数字会变。⇒ 改脚本就要一起改这里（改的时候**现数**，别估）。
 * ⚠️ en 比 zh 多 1：㉛ 那个零汉字扫描只在 en 那一遍跑，两个数差 1 是**正常的**，别抹平。
 * ⚠️ Task 8：18 → 28（en 19 → 29），加的正是 ⑱–㉗ 那十组；
 *    判修轮又加了 ㉘–㉚ 三组（Critical / Ruling 64 / Ruling 65）⇒ 28 → **31**、29 → **32**；
 *    收口波再加 ㉜ 一组（真实目录的 48 行真的渲染一遍）⇒ 31 → **32**、32 → **33**；
 *    A 的 T3 再加 ㉝–㉟ 三组（tab 骨架 / 版本分组的文件夹区 / 跨版本列表与接线）⇒ 32 → **35**、33 → **36**。
 *    ⚠️ 同一轮里 ㉕ 从"三块拼装 + 特性检测"缩成"只有特性检测"（那一半搬进了 ㉞）——
 *    **组数没变**（它仍然是一个 `ok()`），变的是它盖的范围。
 *    A 的 T4 再加 ㊱–㊲ 两组（展开的 jar 列表 / 单行更新的接线守卫）⇒ 35 → **37**、36 → **38**。
 *    ⚠️ 同一轮里 T3 那条**恒真**的 `!skeletonHtml.includes('data-jar="')` 被换成了
 *    "折叠没有 + 展开真的有"一正一反两条（落在㉞**已有**的那一组里）—— 组数不变。
 *    A 的 T5 再加 ㊳–㊴ 两组（第三段「该版本所有 mod」/ 它的喂入与接线守卫）
 *    ⇒ 37 → **39**、38 → **40**。
 *    ⚠️★★ 2026-10-04（A 的 **T6**）：删掉那十几组旧断言（①–⑫、⑯、⑱–㉔、㉖–㉚，
 *    见文件头那段空号清单）之后是 **14** 组（en **15**）。而 T6 自己**加了 ㊵**（清理守卫）
 *    ⇒ 40 → **14/15 这个数里已经含它**（现读：zh 14 组、en 15 组）。
 *    ⚠️ 顺带：⑬ 那一组从"①–⑫ 之后"**挪到了所有渲染组之后**（理由写在它自己那一段：
 *    在原位置时 `samples` 是空的，那条扫描在空串上恒真）。**组数不变**。
 *    ⚠️ C（下载进度与取消）的 T5 再加 ㊶ 一组（四处共用的进度行 / 批量汇总行 /
 *    一趟的汇总行 / 写盘相位与取消）⇒ 14 → **15**、15 → **16**（现读：zh 15 组、
 *    en 16 组 —— en 比 zh 多的那一个仍然是 ㉛，别抹平）。
 */
// ---------------------------------------------------------------------------
// ㊷ ★★ B2（整合包）：「整合包」那一节（spec 断言 14–16）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ **直接渲染 `ModPacksSection`**（不要走 `ModDownloadPanel`）：面板的取数在 effect 里，
 * `renderToStaticMarkup` **不跑 effect** ⇒ 面板只会渲出"加载中…"，那一节**连小卡都不画**
 * （控制器已现读确认：面板的 `catalogIndex` 恒 `null`，两道门都关着）。
 * ⚠️ `catalogIndex` 要**传真索引**（`buildIndex(realCatalog)`）；T6 修轮把它放宽成 `ModIndex | null`，
 * 传 `null` **不会编译错**、只会"整节不画" ⇒ 传 null 会让下面每一条都红得很怪。
 * ⚠️ 六个 `data-*` 钩子是**冻结契约**（T6 的文件头逐字写着它）：`data-pack-chip` / `-row` /
 * `-selected` / `-download` / `-folder` / `-empty`。
 */
const packsSectionIndex = buildIndex(realCatalog);
const PACKS_SECTION_BASE = {
  catalogIndex: packsSectionIndex,
  folders: [] as readonly never[],
  selectedPackId: null,
  onSelectPack: () => {},
  onAction: () => {},
  progress: null,
  busy: false,
};
const PACK_HOT = {
  id: 'pack-hot',
  title: 'A hot pack',
  /* ⚠️ 描述与标题里**故意不放数字**：下面 ㊷i 用"印出 `7`"来钉 `modCount` ⇒ 别的地方出数字会稀释它 ✓ */
  description: 'no digits here',
  gameVersion: '1.16.1',
  modids: ['sodium'],
  hot: true,
  /* ⚠️★ 故意让 `modCount` **不等于** `modids.length`：它是**服务端算的读数**（`pack.modids.length`），
   *    页面只许**照印**、不许自己数 —— 这条夹具让"自己数 modids"的实现当场红 ✓ */
  modCount: 7,
};
const PACK_COLD = { ...PACK_HOT, id: 'pack-cold', title: 'A cold pack', hot: false };

{
  const emptyHtml = keep(
    html(React.createElement(ModPacksSection, { ...PACKS_SECTION_BASE, packs: [] })),
  );
  assert.ok(emptyHtml.includes('data-pack-empty="yes"'), '㊷a 没有整合包 ⇒ 那一句空态要在场');
  assert.ok(!emptyHtml.includes('data-pack-row='), '㊷a 空态时不该有行');
  ok('㊷a `packs: []` ⇒ `data-pack-empty="yes"`（且没有行）');
}
{
  // ⚠️★ 小卡只在 `chipsOnly` 那一支里画（面板是**两个**实例：顶部的 `chipsOnly` + 整节不带）
  const chipsTwoHtml = keep(
    html(
      React.createElement(ModPacksSection, {
        ...PACKS_SECTION_BASE,
        packs: [PACK_HOT, PACK_COLD],
        chipsOnly: true,
      }),
    ),
  );
  assert.ok(chipsTwoHtml.includes('data-pack-chip="pack-hot"'), '㊷b 热门包要有 ★ 小卡');
  assert.ok(
    !chipsTwoHtml.includes('data-pack-chip="pack-cold"'),
    '㊷b 冷门包**不该**有 ★ 小卡（小卡只挂热门）',
  );
  ok('㊷b ★ 小卡只挂热门包（冷门包没有小卡）');
  const twoHtml = keep(
    html(
      React.createElement(ModPacksSection, { ...PACKS_SECTION_BASE, packs: [PACK_HOT, PACK_COLD] }),
    ),
  );
  assert.ok(
    twoHtml.includes('data-pack-row="pack-hot"') && twoHtml.includes('data-pack-row="pack-cold"'),
    '㊷c 两条包各一行',
  );
  assert.ok(
    twoHtml.includes('data-pack-folder="pack-hot"') &&
      twoHtml.includes('data-pack-download="pack-hot"'),
    '㊷c 行里要有目标文件夹下拉与下载按钮',
  );
  ok('㊷c 两条包各一行，且行里有 `data-pack-folder` 与 `data-pack-download`');
  assert.ok(
    /data-pack-chip="pack-hot"[^>]*aria-pressed="false"/.test(chipsTwoHtml) ||
      /aria-pressed="false"[^>]*data-pack-chip="pack-hot"/.test(chipsTwoHtml),
    '㊷d 没选中时小卡的 aria-pressed 是 false',
  );
  assert.ok(twoHtml.includes('data-pack-selected="no"'), '㊷d 没选中时那一行是 no');
  ok(
    '㊷d 未选中：小卡 `aria-pressed="false"`（顶部那一支）+ 行 `data-pack-selected="no"`（整节那一支）',
  );
}
{
  const selChipsHtml = keep(
    html(
      React.createElement(ModPacksSection, {
        ...PACKS_SECTION_BASE,
        packs: [PACK_HOT, PACK_COLD],
        selectedPackId: 'pack-hot',
        chipsOnly: true,
      }),
    ),
  );
  const selHtml = keep(
    html(
      React.createElement(ModPacksSection, {
        ...PACKS_SECTION_BASE,
        packs: [PACK_HOT, PACK_COLD],
        selectedPackId: 'pack-hot',
      }),
    ),
  );
  assert.ok(
    /data-pack-chip="pack-hot"[^>]*aria-pressed="true"/.test(selChipsHtml) ||
      /aria-pressed="true"[^>]*data-pack-chip="pack-hot"/.test(selChipsHtml),
    '㊷e 选中热门包 ⇒ **那颗小卡**（`data-pack-chip="pack-hot"`）的 aria-pressed 变 true',
  );
  assert.ok(
    /data-pack-row="pack-hot"[^>]*data-pack-selected="yes"/.test(selHtml) ||
      /data-pack-selected="yes"[^>]*data-pack-row="pack-hot"/.test(selHtml),
    '㊷e 选中 ⇒ 那一行 data-pack-selected 变 yes',
  );
  ok('㊷e 选中热门包 ⇒ 小卡 `aria-pressed="true"` 与那一行 `data-pack-selected="yes"` **一起**变');
}
{
  const noFolderHtml = keep(
    html(React.createElement(ModPacksSection, { ...PACKS_SECTION_BASE, packs: [PACK_HOT] })),
  );
  const selectTag = /<select[^>]*data-pack-folder="pack-hot"[^>]*>/.exec(noFolderHtml)?.[0] ?? '';
  assert.ok(
    selectTag.includes('disabled'),
    `㊷f 没有候选文件夹 ⇒ 下拉要 disabled（实际：${selectTag}）`,
  );
  const btnTag = /<button[^>]*data-pack-download="pack-hot"[^>]*>/.exec(noFolderHtml)?.[0] ?? '';
  assert.ok(
    btnTag.includes('disabled'),
    `㊷f 没有候选文件夹 ⇒ 下载按钮要 disabled（实际：${btnTag}）`,
  );
  ok('㊷f 有包但**没有候选文件夹** ⇒ 下拉与下载按钮都 disabled（两条独立读数）');
}
{
  const chipsHtml = keep(
    html(
      React.createElement(ModPacksSection, { ...PACKS_SECTION_BASE, packs: [], chipsOnly: true }),
    ),
  );
  assert.ok(
    !chipsHtml.includes('data-pack-empty="yes"'),
    '㊷g `chipsOnly` 那一支**不**渲染空态（顶部那一格只画小卡）',
  );
  ok('㊷g `chipsOnly` 那一支不渲染空态（空态在整节里只出现一次）');
}

/*
 * ⚠️★ ㊷h–㊷l 是 **T8 评审**（agent `594ecf38`）抓出来的四条缺口补的（它用 22 把刀实测：
 *    K13–K18 六把**全绿** ⇒ "按钮恒禁用、简介 / `modCount` / 标题全消失"整套门禁照样绿 ✗）：
 *    · spec 14 的**内容**（标题 / 简介 / `modCount` / 下拉候选 / 按钮**可用**那一侧）此前**零判据**；
 *    · spec 16 的**"说明"**此前零判据（原有两条读数其实都是"禁用"✗）；
 *    · spec ⑮ 点名的刀（"只滚不选中"）**拔不动**（静态渲染不跑 handler ⇒ 只能源码级守卫）；
 *    · `packVersionOptions` 此前**全仓零判据**。
 *    ⇒ 下面五条各自都能被一把刀点红 ✓。
 * ⚠️ 夹具标题是 ASCII（`A hot pack` / `A cold pack`）：原来用中文标题会让本组**顺序承重**
 *    —— 一旦有人把 ㊷ 挪到 ㉛（零汉字扫描）之前，en 那一遍会红在那条扫描上，而不是红在本组的判据上 ✓。
 */
const FOLDER_CANDIDATE = {
  folder: {
    folderId: 'folder-1',
    path: 'C:\\mc\\mods',
    pathExists: true,
    hasReading: true,
    gameVersion: '1.16.1',
    autoUpdate: false,
    rows: [],
    unrecognized: [],
  },
  recognizedModids: [] as readonly string[],
};
{
  const withFolderHtml = keep(
    html(
      React.createElement(ModPacksSection, {
        ...PACKS_SECTION_BASE,
        packs: [PACK_HOT],
        folders: [FOLDER_CANDIDATE] as never,
      }),
    ),
  );
  const btn = /<button[^>]*data-pack-download="pack-hot"[^>]*>/.exec(withFolderHtml)?.[0] ?? '';
  assert.ok(
    btn !== '' && !btn.includes('disabled'),
    `㊷h 有候选文件夹 ⇒ 下载按钮**不该**禁用（实际：${btn}）`,
  );
  assert.ok(
    /<option[^>]*value="[^"]*"/.test(withFolderHtml),
    '㊷h 有候选文件夹 ⇒ 下拉要有 `<option>`（候选路径）',
  );
  ok('㊷h ★ 有候选文件夹 ⇒ 下载按钮**可用** + 下拉有 `<option>` 候选（spec 14 的"可用"那一侧）');
}
{
  const rowHtml = keep(
    html(
      React.createElement(ModPacksSection, { ...PACKS_SECTION_BASE, packs: [PACK_HOT, PACK_COLD] }),
    ),
  );
  assert.ok(rowHtml.includes('A hot pack'), '㊷i 行里要印出**标题**');
  assert.ok(rowHtml.includes('no digits here'), '㊷i 行里要印出**简介**');
  /* ★ 用 `7` 钉 `modCount`：夹具的标题/简介/版本里都没有 7 ⇒ 去掉"印 `modCount`"那一格 ⇒ 这里红 ✓。
   *   同时它钉住"**照印服务端的数**、不自己数 `modids`"（夹具的 modCount=7 ≠ modids.length=1 ✓）。 */
  assert.ok(
    rowHtml.includes('7'),
    '㊷i 行里要印出服务端给的 **`modCount`**（夹具是 7；自己数 `modids` 会印 1 ⇒ 红）',
  );
  ok(
    '㊷i 行里印出标题 / 简介 / `modCount`（spec 14 的"画出什么"那三项；顺带钉住"不自己数 modids"）',
  );
}
{
  const noFolderHtml2 = keep(
    html(React.createElement(ModPacksSection, { ...PACKS_SECTION_BASE, packs: [PACK_HOT] })),
  );
  const errCount = noFolderHtml2.split('filetable__err').length - 1;
  assert.equal(
    errCount,
    1,
    `㊷j 没有候选文件夹 ⇒ 恰好**一句说明**（实际命中 ${String(errCount)} 处）`,
  );
  const withFolderErrCount =
    keep(
      html(
        React.createElement(ModPacksSection, {
          ...PACKS_SECTION_BASE,
          packs: [PACK_HOT],
          folders: [FOLDER_CANDIDATE] as never,
        }),
      ),
    ).split('filetable__err').length - 1;
  assert.equal(
    withFolderErrCount,
    0,
    `㊷j 有候选文件夹 ⇒ **不该**有那句说明（实际命中 ${String(withFolderErrCount)} 处）`,
  );
  ok('㊷j ★ 无候选 ⇒ 恰好一句说明；有候选 ⇒ 一句都没有（spec 16 的"说明"那半条）');
}
{
  const sectionSrc = readFileSync(
    new URL('../src/components/ModPacksSection.tsx', import.meta.url),
    'utf8',
  );
  assert.ok(
    sectionSrc.includes('onSelectPack(pack.id)'),
    '㊷k 小卡的 `onClick` 必须**真的选中**（`onSelectPack(pack.id)`；刀 = "只滚不选中"）',
  );
  assert.ok(
    sectionSrc.includes('scrollIntoView('),
    '㊷k 小卡的 `onClick` 必须**真的滚**（`scrollIntoView(`）',
  );
  ok('㊷k ★ 小卡 `onClick` 里"选中 + 滚"两件事都在（源码级：静态渲染证不了处理器）');
}
{
  const versions = packVersionOptions(realCatalog);
  assert.ok(
    versions.includes('1.16.1'),
    `㊷l \`packVersionOptions(真实目录)\` 必须含 1.16.1（实际前几个：${JSON.stringify(versions.slice(0, 4))}）`,
  );
  assert.deepEqual([...versions].sort(), versions, '㊷l 版本候选必须是**已排序**的');
  ok(
    `㊷l \`packVersionOptions(realCatalog)\`：含 1.16.1、已排序（共 ${String(versions.length)} 个版本）`,
  );
}

const expectedGroups = LANG === 'en' ? 28 : 27;
assert.equal(
  pass,
  expectedGroups,
  `探针：这一轮应当通过 ${String(expectedGroups)} 组（少了就说明有人把某一段摘掉了）`,
);

console.log('');
console.log(`通过 ${pass} 项。`);
console.log('');
console.log('⚠️ 这个脚本验的是**渲染**（外加 ⑭ 一个纯函数与 ㉟㊲㊴㊵ 的源码形状）：');
console.log('   没有点击、没有请求、没有真实浏览器、也没有主进程。');
console.log('   具体没被覆盖的（至少这几样）：');
console.log('     · 点一下真的走了哪条通道 / 真的弹了原生对话框 —— 静态渲染不跑事件处理器，');
console.log('       ㉟㊲㊴ 只钉住"那条接线在、而且只有一条"；');
console.log('     · tab 那两颗按钮**点下去之后**换的是哪一块（T3 的 tab 条是页面外壳的 useState，');
console.log('       静态渲染只画得到默认那一态；㉝ 证的是"默认选中"，换栏由下面的源码形状兜着）；');
console.log(
  '     · `openFolder` 那一次**真的**调用与它的 reject 被接住（㉟ 只钉"接线在"与"接住的那一格在"）；',
);
console.log('     · `useModFolders()` 的另外两条支路（订阅回包 / 失败）：⑰ 只证了**第一帧**；');
console.log('     · `hasReading` 是**主进程**算的（`readingOf(id).ok`）：㉞ 钉的是"拿到这一格');
console.log('       之后渲染成什么样"，那一格的值本身在桌面探针里；');
console.log('     · 主进程写死的中文（`notices` / `lastRun.skipped[].reason`）—— 夹具是 ASCII；');
console.log('       ⚠️ T6 删掉了旧第二部分之后，`skipped[].reason` 这一页上**没有渲染点**了；');
console.log(
  '     · 两个重复键（`optifine|1.7.2` / `speedrunigt|26.1`）的**真实**形状与 54 条 manual 的',
);
console.log('       目录级读数（那是 T1/T3 的单测与目录本身的事）。');
console.log('     ⚠️ 2026-10-04 收口波订正：**真实目录的 48 行**现在由 ㉜ 真的渲染一遍');
console.log('       （T6 之后渲染点是**第三段**：`VersionModList`）。');
console.log('     ⚠️★ T6：旧那三块（第一部分 / 旧第二部分 / 底部缺失清单）连同它们的断言一起删了');
console.log('       —— 这一页今天只有 tab 骨架 + 按版本的文件夹区 + 展开体 + 第三段。');
