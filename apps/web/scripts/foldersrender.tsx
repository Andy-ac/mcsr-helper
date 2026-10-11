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
 * 现读：zh **45** 组、en **46** 组（㉛ 零汉字扫描只在 `--en` 那一遍跑；权威是文件末尾那条
 * `expectedGroups` 探针 —— 它数的是 `ok()` 的条数，数错时会把 `actual` / `expected` 都印出来）。
 * ⚠️★ 这一格**已经过期过两次**（T6 瘦身与 T7 加 ㊿ 之后仍写着 15/16 —— 那是 A 的 T6 之前的
 *    数）⇒ T8 加 ㊾h 与 51a–51g 时**同批**改准（本仓的"手抄的现数要同批改"那条纪律）。
 * ⚠️ 组号是**顺序**，不是历史编号 —— 现读的清单见文件末尾那条探针上面那一段。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { MOD_FOLDERS_CHANNELS } from '@mcsr/shared/desktop';
import type { DownloadProgress, TimedSample } from '@mcsr/shared/downloadProgress';
import { en, zhCN } from '@mcsr/shared/i18n';
import { instanceKeyOf, instanceKeyParts } from '@mcsr/shared/launcherInstances';
import { buildIndex, type ModRelease, parseModCatalog } from '@mcsr/shared/modCatalog';
import {
  type CatalogRowView,
  type InstanceView,
  type LauncherBindingView,
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
import { LauncherBindingPanel } from '@/components/LauncherBindingPanel';
import { ModDownloadPanel } from '@/components/ModDownloadPanel';
import {
  d1Capable,
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
import type { ModPackWire } from '@/lib/api';
import { packVersionOptions } from '@/lib/modPackEdits';
import { NAV_SECTIONS } from '@/lib/nav';
import { Files, initialTabFor, ModTabs } from '@/routes/Files';

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

/** 一格实例夹具（`InstanceView` = `LauncherInstance` + `tracked` / `confirmed`）。 */
function instanceView(over: Partial<InstanceView> & { key: string }): InstanceView {
  return {
    kind: 'multimc',
    name: over.key,
    instancePath: `D:\\instances\\${over.key}`,
    gameVersion: '1.16.1',
    loader: 'fabric 0.17.3',
    modsDir: `D:\\instances\\${over.key}\\.minecraft\\mods`,
    savesDir: `D:\\instances\\${over.key}\\.minecraft\\saves`,
    needsConfirm: false,
    tracked: true,
    confirmed: false,
    ...over,
  };
}
/** 1.16.1 上被追踪的那一个（实例层的目标）。 */
const INSTANCE_RANKED = instanceView({ key: `multimc:instances/1.16.1 - Ranked#1` });
/**
 * ★★ 刀 3 之后补的那一格：**同一个版本**（1.16.1）上**没被追踪**的那一个。
 *
 * ⚠️★ 现场（这把刀真的跑过，读数在报告里）：把 `InstancePicker` 里 `tracked === true`
 *    那一格删掉 ⇒ 整套自检**照样全绿** —— 因为原来那三个夹具的**版本各不相同**
 *    （1.16.1 / 1.16.5 / 1.8.9）⇒ `gameVersion === page.version` 那一半已经把它们挡在门外，
 *    "被追踪"那一半**没有任何判据**。
 * ⇒ 这一格只服务那一件事：它**与本组那个被追踪的实例同版**（1.16.1）⇒ 少了 `tracked`
 *    那一格时它会**混进候选里**，`㉞` 的"未追踪不画卡"当场红（`㊿a` 也会跟着红）。
 * ⚠️ 它不进 `㊿d` 那份明细（那一组自己有一份 `allInstancesState`，见那里）。
 * ⚠️★ 定义必须在**第一个用它的人之前**（`skeletonState` 在 ㉞ 那一段）：`const` 的 TDZ
 *    会让那一处抛 `ReferenceError`，而 biome 的 `noInvalidUseBeforeDeclaration`
 *    就是这么报的（它在那次收工里是 4 条红里的一条）。
 */
const INSTANCE_UNTRACKED_SAME_VERSION = instanceView({
  key: 'multimc:instances/1.16.1 - Not ticked',
  name: '1.16.1 - Not ticked',
  tracked: false,
});
/** 另一个版本上被追踪的那一个（跨版本那一栏的第二个分组）。 */
const INSTANCE_OLD = instanceView({
  key: 'multimc:instances/1.8.9 - RSG',
  name: '1.8.9 - RSG',
  gameVersion: '1.8.9',
  loader: null,
});
/** **没有被追踪**的那一个（没有 folder ⇒ 点不进实例层）。 */
const INSTANCE_UNTRACKED = instanceView({
  key: 'multimc:instances/1.16.5 - Vanilla',
  name: '1.16.5 - Vanilla',
  gameVersion: '1.16.5',
  loader: null,
  tracked: false,
  /* ⚠️ 待确认是**显示值**（`needsConfirm && !confirmed`）：这一行两样都读得到。 */
  needsConfirm: true,
});

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

/**
 * 产物里某个字面量出现了几次。
 *
 * ⚠️★ 定义在这一段（而不是第一次用到它的那一组旁边）：脚本是**顺序执行**的，
 *    而 T7 那一组（㉞ 的空态改写）在它原来的位置**之前**就要用它 ——
 *    `const` 的 TDZ 会让那句 `countOf(...)` 抛 `ReferenceError`（症状长得像"脚本写错了"，
 *    不像"少了一条断言"）。
 */
const countOf = (markup: string, needle: string): number => markup.split(needle).length - 1;

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

/**
 * `Files.tsx` 的源码（剥注释）—— **㉝ 与 ㊲/㊴ 三组都读它**。
 * ⚠️★ 定义在这里（工具段）而**不是**第一次用到它的那一组旁边：脚本是顺序执行的，
 *    而 ㉝（tab 骨架那一组）比 ㊲ 早得多 ⇒ 放在后面就是一次 TDZ 崩溃
 *    （biome 的 `noInvalidUseBeforeDeclaration` 会把这条挡住 —— 本文件那次收工里它报了 4 条红）。
 */
const filesRouteCode = withoutComments(
  readFileSync(new URL('../src/routes/Files.tsx', import.meta.url), 'utf8'),
);

console.log(
  `【${LANG}】资源下载页 · 新页面（tab 骨架 / 按版本分组的文件夹 / 展开的 jar 列表 / 第三段「该版本所有 mod」）`,
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
 * ⚠️★ Task 8 把这个桩抽成了 `shellStub(tier)`：㉕ 要用**同一个桩的老壳那一档**
 *    （`mcsr` 在、`modFolders` 不在）去证特性检测那一支 —— 两处各写一份桩的话，
 *    "0.0.4 与 0.0.5 的差别只有 `modFolders` 在不在"这件事就没有一处说得清。
 *    ⚠️★ T6（D1）把它从 boolean 扩成**三档**（`'browser' | 'old' | 'd1'`）：原因写在
 *    `shellStub` 那一段（老桌面壳 0.1.1 有 `modFolders`、没有 D1 那七格）。
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
 * ⚠️★★ **五档**（T6 从 boolean 扩成三档，T8 又加了两档）：
 *   · `'browser'` = **纯浏览器**：连 `mcsr` 都没有 ⇒ `desktopBridge()` 给 `null`；
 *   · `'zero04'` = **0.0.4 的桌面壳**：`mcsr` 在、**没有** `modFolders` —— 它是
 *     `Files.tsx` 文件头那三档里的**第②档**（"有 `mcsr`、没有 `modFolders`"）；
 *   · `'old'` = **0.1.1 的老桌面壳**：`mcsr` 在、`modFolders` 也在，**但没有 D1 那七格**
 *     —— 这一档正是"新页面拿到一份没有 `instances` / `launchers` 的状态"那个坑的现场，
 *     老壳必须被 `d1Capable()` 判成"与浏览器同一档"；
 *   · `'d1MinusOne'` = ★★ **T8 加的**：D1 那七格里**只少一格**（今天少的是
 *     `confirmInstance`）—— 它把"**少任何一格**就不够 D1"这条判据变成**可复跑**的
 *     （T6 当初用一份**一次性夹具**证过它，那份夹具跑完就删了、没进库
 *     ⇒ 那条判据当时**不可复跑**，这是 T6 交接给 T8 的四条里的第一条）。
 *     ⚠️★ 它**不是** `'old'` 的别名：`'old'` 是"七格全无"（0.1.1 的真实形状），
 *     这一档是"七格里有六格"（一个**假想的**坏壳）—— 两档要证的命题不同，
 *     而 ㊾h 会**逐格**遍历（少哪一格都红），所以这一档只是那份遍历里的一个取样点。
 *   · `'d1'` = **0.2.0 的壳**：D1 那七格**全部**在（㉝ 最后那条 `deepEqual` 把这一档
 *     与 `MOD_FOLDERS_CHANNELS` 逐条对账）。
 *   ⚠️★ `'zero04'` 与 `'old'` **不是同一档**（T6 第一版把它们并成了一个 `'old'` ⇒
 *    评审 R4：`Files.tsx` 的三档说法里第②档**一个断言都没有**了，而
 *    `files.partTwoUnavailable` 那句文案恰恰是在 T6 从 `0.0.5` 改成 `0.2.0` 的
 *    ⇒ "0.0.4 用户看到的那句话变了"这件事当时没有任何读数）。两档的**页面**产物今天
 *    一样（都判 `unavailable`），但**桩的形状**不一样，而桩的形状正是能力门的输入。
 *   ⚠️★ 四/五档**必须**是同一条联合里的值（不是两个布尔 + 开关）：那样 `modFolders`
 *    在没有它的那两档上是 `undefined`（`?.` 判据与 expand 版同义），而在另外三档上
 *    都在 —— `shellStub('old').modFolders` 因此**读得出来、也传得进 `d1Capable()`**。
 *   ⚠️ `modFolders` 那一格用**展开**而不是 `modFolders: undefined`：`{ modFolders: undefined }`
 *    与"没有这一格"在 `?.` 下结果一样，但前者会让"这个对象里有这个键"看起来成立
 *    （读桩的人会以为浏览器那一档也有那条通道）。
 * ⚠️★★ 首拉状态里**放什么都不会改变第一帧**（T6 实测，**这条是删掉一个死夹具的理由**）：
 *    静态渲染**不跑 effect** ⇒ `getState()` 的返回值**到不了** `state`
 *    ⇒ `hasLaunchers` 在这一遍恒为 `false` ⇒ 默认 tab 恒是「启动器绑定」。
 *    ⛔ 别往"给桩喂一条已绑定的启动器、把默认 tab 掰到 mod 下载"那条路上再试一次——
 *    那个常量（`STUB_LAUNCHER`）**永远够不到任何断言**，所以它已经删掉了
 *    （够不到的死夹具比注释更容易误导下一个人）。
 */
type ShellTier = 'browser' | 'zero04' | 'old' | 'd1' | 'd1MinusOne';

function shellStub(tier: ShellTier) {
  /** 0.1.1 那一档就有的那些格（D1 之前契约里的全部）；两个桌面档共用它。 */
  const preD1 = {
    /*
     * ⚠️★ 这一格的返回值**没有任何人读**（静态渲染不跑 effect，见上面那一段）——
     *    它只需要"是一个与契约同形的函数"。原来是 `{ launchers: [STUB_LAUNCHER] }`，
     *    而那个常量够不到任何断言 ⇒ T8 把它连同常量一起删了，只留形状。
     */
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
  };
  /*
   * ★★ D1（T4）：启动器绑定与实例那七格（契约 17 → 24）。照现有的形状写：
   *   两条各有自己的返回值（候选表 / 实例数组），五条是 `void`。
   *   ⚠️★ 这一组**必须与契约同批**加：上面那条 `deepEqual` 把**这个对象**与
   *   `MOD_FOLDERS_CHANNELS` 逐条对账 —— 契约加了而桩没加，`check:folders`
   *   立刻红（这正是它存在的理由）。
   *   ⚠️ 方法体**永远不会被执行**（静态渲染不跑 effect）：它们只是让
   *   `desktopBridge()?.modFolders?.probeLaunchers` 这类特性检测判成"在"。
   *   ⚠️★ **只在 `'d1'` 那一档**：`'old'`（0.1.1）里这七格一个都没有，而那就是
   *   老壳能力门要判的那件事（`d1Capable()` 的七格清单与这里是同一份判据的两面）。
   */
  const d1Only = {
    probeLaunchers: async () => [],
    listLauncherInstances: async () => [],
    setInstancePaths: async () => undefined,
    addLauncher: async () => undefined,
    removeLauncher: async () => undefined,
    setInstanceTracked: async () => undefined,
    confirmInstance: async () => undefined,
  };
  /*
   * ★★ D1（T8）：**只少一格**那一档（`'d1MinusOne'`）。
   *
   * ⚠️★ 为什么它必须是一档**桩**而不是"临时改一行、跑完改回来"：T6 当初正是用一次性夹具
   *    证的这条命题，而那份夹具**跑完就删了、没进库** ⇒ 那条判据从此**不可复跑**
   *    （本仓对"证据只住在会被清掉的地方"有成文的纪律）⇒ 交接给 T8 的活。
   * ⚠️★ 少的是 `confirmInstance`（七格里的第六格）：它**不是**任选的一格 ——
   *    D1 的"显式确认"那颗按钮走的正是它（`confirmInstance(key)`），
   *    少它就等于"这一页能看、但确认按钮调到一个不存在的函数"。
   * ⚠️★ 而"**少任何一格**都不够 D1"这条更强的命题由 ㊾h **逐格遍历**钉住
   *    （它自己造七份"少一格"的壳）⇒ 这一档只服务页面级的那一条读数
   *    （`pageShellOf('d1MinusOne')` 真的只画那句"需要桌面版"）。
   */
  const d1MinusOne = {
    probeLaunchers: d1Only.probeLaunchers,
    listLauncherInstances: d1Only.listLauncherInstances,
    setInstancePaths: d1Only.setInstancePaths,
    addLauncher: d1Only.addLauncher,
    removeLauncher: d1Only.removeLauncher,
    setInstanceTracked: d1Only.setInstanceTracked,
    /* ⛔ 这一档**故意**没有 `confirmInstance` —— 它就是"只少一格"的那一格。 */
  };
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
    ...(tier === 'browser' || tier === 'zero04'
      ? {}
      : {
          modFolders: {
            ...preD1,
            ...(tier === 'd1' ? d1Only : {}),
            ...(tier === 'd1MinusOne' ? d1MinusOne : {}),
          },
        }),
  };
}

const stubBridge = shellStub('d1');
Object.assign(globalThis, { mcsr: stubBridge });
const firstFrameHtml = keep(
  html(React.createElement(MemoryRouter, null, React.createElement(Files, null))),
);
delete (globalThis as { mcsr?: unknown }).mcsr;
assert.ok(
  textOf(firstFrameHtml).includes(textOf(resolved('files.tabLaunchers'))) ||
    textOf(firstFrameHtml).includes(textOf(resolved('files.tabMods'))),
  '★ 桌面壳里的第一帧画着 tab 条（tab 本身是页面外壳的事；它选中哪一格由 ㉝ 与 ㊾b 钉）',
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
/*
 * ⚠️★★ T6（D1）**改准了两次**，两次都是同一条纪律（"别让断言比事实软"）：
 *   ① 原判据 `firstFrameHtml.includes(catalogScanning)` 断的是"整页第一帧 = 正在扫描"，
 *      而 A8 把**没有绑启动器**的默认 tab 改成了「启动器绑定」⇒ 那一格根本不画扫描屏
 *      ⇒ 那条断言在**正确**的产物上红。**不能**靠"把默认改回去"来保它（那是把 A8 删掉）。
 *   ② 也不能靠"给桩喂一条已绑定的启动器"来保它：静态渲染**不跑 effect**
 *      ⇒ `getState()` 的返回值（`STUB_LAUNCHER`）永远到不了 `state`
 *      ⇒ `hasLaunchers` 在这一遍恒为 `false`。⛔ 别往那条路上再试一次。
 *   ⇒ 于是这一条**搬回它真正量的那个组件**：Ruling 42 要的是"首拉那一屏说的是
 *     正在扫描、不是卡住了"，而那一屏是 `ModCatalogScanning`（`Files.tsx` 的 loading
 *     支路渲染的就是它）。"整页第一帧走 loading 支路"这一条由 ⑰ 上面那两条**不**再声称
 *     —— 它由 ㉝ 第三条（tab 条画出来了）与 ㊾b（默认规则两支）分头钉。
 */
const firstFrameScanningHtml = keep(html(React.createElement(ModCatalogScanning, null)));
assert.ok(
  textOf(firstFrameScanningHtml).includes(textOf(resolved('files.catalogScanning'))),
  '★★ 首拉那一屏必须是「正在扫描…」（Ruling 42：首拉可能等一次补扫，' +
    '否则用户看到的是"这一页挂了"）',
);
assert.equal(
  textOf(firstFrameScanningHtml).includes(textOf(resolved('common.loading'))),
  false,
  '★ 它**不许**是 v1 的「加载中…」（两个世代的取数不是同一件事）',
);
ok(
  '⑰ 桌面壳桩：页面外壳第一帧画的就是 tab 条，而「正在扫描…」那一屏说的是扫描、不是 v1 的「加载中…」（Ruling 42）',
);

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
 * ⚠️★ 两种壳都真的渲染 `Files`：**0.0.4**（有 `mcsr`、没有 `modFolders`）与纯浏览器
 *    （连 `mcsr` 都没有）都该看到"需要桌面版 **0.2.0**"；而**只有**纯浏览器该看到
 *    `browserOnly` 那一句（0.0.4 是桌面壳）。
 * ⚠️★★ T6（D1）在这一段上**错过两次**，两次都记下来了（评审 R4）：
 *    ① 第一版把"0.0.4 的那一档"**并进了** `'old'`（那时 `'old'` 演的是 0.0.4）；
 *    ② T6 又把 `'old'` 定义成 **0.1.1**（有 `modFolders`、没有 D1 那七格）⇒ 于是
 *       `Files.tsx` 三档说法里的**第②档（0.0.4）一个断言都没有了**，而
 *       `files.partTwoUnavailable` 那句话恰恰是在 T6 从 `0.0.5` 改成 `0.2.0` 的。
 *    ⇒ 现在**各归各**：这一组指回 `shellStub('zero04')`（有 `mcsr`、没有 `modFolders`），
 *    而 0.1.1 那一档由 **㊾c/㊾d** 钉（那里判 `d1Capable()`、并断言整页只画那一句话）。
 *    两档的**页面**产物今天相同（都判 `unavailable`），但**桩的形状**不同 ——
 *    而桩的形状正是能力门的输入，所以两档都要各有一条读数。
 */
/* —— 0.0.4 的壳：有 `mcsr`、**没有** `modFolders` —— */
Object.assign(globalThis, { mcsr: shellStub('zero04') });
const oldShellHtml = keep(
  html(React.createElement(MemoryRouter, null, React.createElement(Files, null))),
);
delete (globalThis as { mcsr?: unknown }).mcsr;
assert.ok(
  textOf(oldShellHtml).includes(textOf(resolved('files.partTwoUnavailable'))),
  '★★ 特性检测：够不上这一页的壳（这里由 `d1Capable()` 判定）⇒ 显示"需要桌面版 0.2.0"（spec §6.8/§8）',
);
assert.equal(
  textOf(oldShellHtml).includes(textOf(resolved('common.loading'))),
  false,
  '★★ 反面（T3 之后改准）：这一档上**不再**有 v1 的「加载中…」—— 这一页现在只画 ' +
    '"需要桌面版 0.2.0"这一句（原来那句断言的是"v1 那条路照常"，而 v1 的面板在 T3 从页面上消失了）',
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
  '★ 纯浏览器同理：那一栏说清"需要桌面版 0.2.0"，而"本地文件只在桌面版里"那句照常（两句说的是两件事）',
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
  '㉕ 特性检测：0.0.4（有 `mcsr`、没有 `modFolders`）与纯浏览器都看到"需要桌面版 0.2.0"；0.1.1 那一档由 ㊾c/㊾d 钉',
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
 * ⚠️★ 「默认落在哪一格」**不能**靠"某个字符串不在场"来证（那是恒真一类，§5.32①）：
 *    这里真的渲染一次**页面外壳**（`Files` + `shellStub('d1')`，照 ⑰ 的写法），
 *    断言的是**选中态**（哪一颗按钮带 `aria-selected="true"`）。
 *    ⚠️★ tab 条住在**页面外壳**里，不在 `ModDownloadPanel` 里：计划里那条断言渲染的是面板
 *    本身，而面板在静态渲染下**永远到不了**（它的 `state` 要等 `useModFolders()` 的回包）
 *    ⇒ 只有外壳画着 tab 条，"默认选中"才断言得到（报告里记着这处偏离）。
 * ⚠️★★ D1（T6）把这一组的**默认 tab 读数改准了**：这两次渲染的壳拿到的是**加载中**的
 *    状态（静态渲染不跑 effect）⇒ `launchers` 那一格还读不出来，选中态落在 `initialTabFor`
 *    的**未绑定那一支**（「启动器绑定」）。⚠️ 它**不再**是「mod 下载」—— 那正是 A8/D1 的
 *    默认规则，而"已绑过启动器 ⇒ 落在 mod 下载"那一半由 ㊾b 用纯函数钉（这里够不到：
 *    外壳在 loading 支路拿不到 `state`）。
 *    ⚠️★ 同一条规则的**副作用**（认，写在报告里）：外壳的第一帧为「启动器绑定」时，
 *    「正在扫描…」那一屏（`ModDownloadPanel` 的 loading 支路）**不在**第一帧里 ——
 *    它是"切到 mod 下载那一格"之后的事。⇒ 本组第三条因此改成直接渲染那一格的载荷，
 *    理由写在那一段上面。
 */

/** 一次页面外壳渲染（装桩 → 渲染 `Files` → 立刻拆桩；与 ⑰ 逐字同一个写法）。 */
function pageShellOf(tier: ShellTier): string {
  Object.assign(globalThis, { mcsr: shellStub(tier) });
  const markup = keep(
    html(React.createElement(MemoryRouter, null, React.createElement(Files, null))),
  );
  delete (globalThis as { mcsr?: unknown }).mcsr;
  return markup;
}

// ---------------------------------------------------------------------------
// ㉝ tab 骨架：三个 tab、默认在「启动器绑定」、工具下载是占位（spec §4 / §9.6）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 判据全部**渲染**出来（没有一条是"扫源码"）：tab 的选中态是 `aria-selected`，
 *    而它只在产物里看得见。⚠️ 两条反面各管一种假通过：
 *      · 只断言"launchers 被选中" ⇒ "两个都选中"照样绿（下面第二条）；
 *      · 只断言"没有 modFolders 时画了那句话" ⇒ "tab 也画出来了"照样绿（第四条）。
 * ★ 能红的刀（跑过的读数在报告里）：① 把 `initialTabFor` 的两支对调 ⇒ 第一条红；
 *   ② 把 tab 条画到"没有 `modFolders`"那一支上 ⇒ 第四条红。
 */
const modTabShellHtml = pageShellOf('d1');
const oldShellTabHtml = pageShellOf('old');
assert.ok(
  /data-tab="launchers"[^>]*aria-selected="true"/.test(modTabShellHtml),
  "★★ 默认选中「启动器绑定」（真的渲染了一次页面外壳；桩是 `shellStub('d1')`）—— " +
    '这一档还没读到状态 ⇒ 走 `initialTabFor` 的"一个启动器都没绑"那一支（D1 的默认规则）',
);
assert.equal(
  /data-tab="tools"[^>]*aria-selected="true"/.test(modTabShellHtml),
  false,
  '★★ 反面：同一份产物里「工具下载」**没有**被选中（两条一起才排除"两个都是 true"那一类假通过）',
);
assert.ok(
  textOf(modTabShellHtml).includes(textOf(resolved('files.tabMods'))) &&
    textOf(modTabShellHtml).includes(textOf(resolved('files.tabTools'))),
  '★ 三个 tab 都在页面外壳上（判据是两条旧词条都**解析出了译文**，不是"含某个字符串"；' +
    '第三条 `files.tabLaunchers` 由 ㊾a 钉）',
);
assert.equal(
  oldShellTabHtml.includes('data-tab='),
  false,
  '★★ 反面（spec §9.12 / D1）：**不画 tab** 的壳上**一个 tab 都没有** —— ' +
    '那一档只有"需要桌面版 0.2.0"那一句（无条件画 tab 会让"没有这个能力"看起来像"还没加载"）。' +
    '⚠️★ 这一档**同时**是 0.1.1 的老桌面壳（有 `modFolders`、没有 D1 那七格）与纯浏览器 —— ' +
    '㊾d 单独钉"老壳真的走这一档"那一半',
);
/*
 * ⚠️★★ T6（D1）把这一条**改了两次**，两次都是同一条纪律（断言不许比事实软）：
 *   ① 原判据断"页面外壳的产物里有「正在扫描…」"；A8 把**没绑启动器**的默认 tab 改成
 *      「启动器绑定」⇒ 静态渲染（不跑 effect ⇒ `hasLaunchers` 恒 `false`）下外壳画的不是
 *      mod 下载那一格 ⇒ 那条断言在**正确**的产物上红。
 *   ② 我第一版改成"自己 `createElement` 拼一个 `role="tabpanel"` wrapper 再塞
 *      `ModCatalogScanning`" ⇒ **恒真**（那个 id 是我自己传进去的，产物里当然有那句话）。
 *      T6 的独立评审把这一条点成 R5（§5.32① 的第一类：测的是自己拼出来的字符串）。
 *   ⇒ 现在的形状（评审 R3 建议的那一条）：**渲染那一格真正的载荷**，而且把
 *   "`mods` 那一格在三个 status 支路上各画什么"**成表**钉住 ——
 *   判据全部落在产品组件自己的输出上（不是我先写一句话再断言它在那儿）。
 *   ⚠️ 两个前提各自钉死，否则这张表会变成空跑：
 *     · `Files.tsx` 的 loading 支路**真的**渲染 `ModCatalogScanning`（源码形状，剥注释后读）；
 *     · `ToolsPanel` 那一支的载荷身份由它自己的 `data-tab-panel="tools"` 钉（下面那条）。
 */
const modsBranchHtml = (payload: React.ReactElement): string =>
  keep(html(React.createElement('div', { role: 'tabpanel', id: 'modtabpanel-mods' }, payload)));
/* ⛔ 这里**不许**读模块级那个 `filesRouteCode`：同模块的 `const` 有 TDZ，
 * 在这个位置读它抛 `ReferenceError`（看起来像"断言没跑"，§5.74 那一类）⇒ 下面自己读一次。 */
const modsLoadingHtml = modsBranchHtml(React.createElement(ModCatalogScanning, null));
assert.ok(
  modsLoadingHtml.includes('role="tabpanel"') &&
    textOf(modsLoadingHtml).includes(textOf(resolved('files.catalogScanning'))),
  '★ `mods` 那一格的 **loading** 支路（挂在 `role="tabpanel"` 那一格上）画的是「正在扫描…」' +
    '（Ruling 42：首拉可能等一次补扫）',
);
assert.equal(
  textOf(modsLoadingHtml).includes(textOf(resolved('common.loading'))),
  false,
  '★ 反面：它**不许**是 v1 的「加载中…」（两个世代的取数不是同一件事）',
);
/*
 * ⚠️★ 另外两支**够不到**，如实记（不写成"已经证过"）：
 *   · `failed` 那一支的载荷是 `Files.tsx` 里的一句 `<Notice>`（`partOneStateError`），
 *     它**不在** `ModDownloadPanel` 里 —— 我实测过：拿 `stateOf([], { catalogStatus: 'unavailable' })`
 *     去渲染真面板，产物里**没有**那句话（面板对"目录不可用"有自己的说法）。
 *   · `ready` 那一支要 `mods.state` + `mods.handlers`，静态渲染不跑 effect ⇒ 拿不到。
 *   ⇒ 三支的**分派关系**改用**源码形状**钉（剥注释再读：注释里逐字写着这些名字，
 *   不剥 = 守卫被自己的注释喂饱）。⚠️ 它与下面那条 `ToolsPanel` 的钩子各管一半：
 *   源码形状管"哪一支接哪一个载荷"，钩子管"那个载荷自己的身份"。
 *   这一条**不是**运行时断言，但它真的会红：三支的顺序接错 / 少画一支 ⇒ 落空。
 */
const modsBranchSource = withoutComments(
  readFileSync(new URL('../src/routes/Files.tsx', import.meta.url), 'utf8'),
);
assert.ok(
  modsBranchSource.includes('<ModCatalogScanning />'),
  '★ `Files.tsx` 的 loading 支路**真的**渲染 `<ModCatalogScanning />`（剥注释后读源码形状）',
);
/*
 * ★★ `failed` 那一支画的是**哪一条词条**：判据**不是** `includes('files.partOneStateError')` ——
 *   那是**松**的：把 key 打成 `files.partOneStateErrorXX`（缺键 ⇒ 界面上印出这个 key 本身）
 *   仍然包含原串 ⇒ 旧写法**照样绿**（我自己的刀 5 实测过，所以这里改成表驱动）。
 *   ⇒ 现读 `Files.tsx` 里**所有** `t('files.…')` / `t('common.…')` 的 key，逐条过 `resolved()`：
 *   缺一条键 ⇒ 那条探针当场红（§5.32①：判据必须能回答"它坏了会怎么红"）。
 */
const routeKeys = [
  ...new Set(
    [...modsBranchSource.matchAll(/t\('((?:files|common)\.[A-Za-z]+)'/g)].map((m) => m[1]),
  ),
].sort();
assert.ok(
  routeKeys.includes('files.partOneStateError'),
  '★ `failed` 那一支画的是 `files.partOneStateError` 那句（现读到的 key：' +
    `${routeKeys.join(', ')}）`,
);
for (const key of routeKeys) resolved(key);
assert.ok(
  modsBranchSource.includes('<ModDownloadPanel'),
  '★ `ready` 那一支画的是 `ModDownloadPanel`（源码形状：它要 `state` + `handlers`，静态渲染够不到）',
);
/*
 * ⚠️★ 这一条**不是**给「工具下载」补内容（T10 的事），而是把"哪一格归哪个载荷"钉住：
 *    只钉 loading 那一支的话，**把三支的顺序接错**（tools 画成 mods）照样绿。
 */
assert.ok(
  keep(html(React.createElement(ToolsPanel, null))).includes('data-tab-panel="tools"'),
  '★ 前提：`ToolsPanel` 自己带 `data-tab-panel="tools"` 这个钩子（tools 那一支的载荷身份）',
);
/*
 * ⚠️★ 锚点是 **`) : selected === 'tools' ? (`** —— 这一轮**改准了一处**（改的是断言，不是实现）：
 *    T6 写的那一条锚 `"{selected === 'tools' ? ("`，而 `biome --write` 之后 `Files.tsx` 里
 *    那一句长成 `) : selected === 'tools' ? (`（`} else` 那一支不再换行）⇒ 旧锚点在**正确**的
 *    产物上落空。⚠️ 收窄/改准之后它咬的还是**同一件事**：`tools` 那一支必须接在
 *    `launchers` 之后（顺序接错 ⇒ 这一条落空），而"那个载荷自己的身份"由上面那条钩子管。
 */
assert.ok(
  modsBranchSource.includes(") : selected === 'tools' ? ("),
  "★ 而且 `Files.tsx` 真的按 `selected === 'tools'` 分派它（顺序接错会红在这里）" +
    "（⚠️ 锚点只取 `) : selected === 'tools' ? (` 那一小段：整行的形状被 biome 换行过，" +
    '锚整行会在**正确**的产物上红）',
);
/*
 * ★★ 夹具与契约逐条对账（T2 复审点名的那条交接）：`shellStub` 是**无类型**的对象字面量
 *    ⇒ 契约加一条通道而桩忘了加时，没有任何门禁会出声，而那一格在页面上的覆盖是零。
 */
assert.deepEqual(
  Object.keys(shellStub('d1').modFolders ?? {}).sort(),
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
  '㉝ tab 骨架：三个 tab 都在、默认选中「启动器绑定」、不画 tab 的壳上一个都没有、工具下载写明"待更新"、桩与契约逐条对账',
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
  /*
   * ⚠️★ D1（T7）：这个夹具现在**同时**是"版本层"的那一份（`selectedInstance === null`）
   *    ⇒ 它需要一条**被追踪的实例**，否则版本层画的是 A8 的"一个实例都没读到"那一档，
   *    而下面这几条量的东西（"这一版有哪些实例"/"一个下载入口都没有"）就成了空跑。
   *    ⚠️ `INSTANCE_RANKED` 是 1.16.1 且 `tracked: true` ⇒ 版本层恰好一张卡。
   */
  /*
   * ⚠️★ 三条实例，各有各的用处（下面那几条断言逐条点名）：
   *    · `INSTANCE_RANKED`（1.16.1，**被追踪**）⇒ 版本层**恰好**画它一张卡；
   *    · `INSTANCE_UNTRACKED`（1.16.5，未追踪）⇒ 被**版本**筛挡掉；
   *    · `INSTANCE_UNTRACKED_SAME_VERSION`（1.16.1，未追踪）⇒ 版本筛**挡不住**它，
   *      只有 `tracked === true` 那一格能挡 ⇒ 少了那一格这把刀才红得起来（读数在报告里）。
   */
  instances: [INSTANCE_RANKED, INSTANCE_UNTRACKED, INSTANCE_UNTRACKED_SAME_VERSION],
});
const skeletonHtml = keep(
  html(
    React.createElement(ModDownloadPanel, {
      state: skeletonState,
      onAction: noop,
      progress: null,
      onGoToLaunchers: noop,
    }),
  ),
);
/*
 * ★★ D1（T7）：这一条**换了量法**（原来是"该版本的两个文件夹都画出来了"）。
 *
 * 现场：那个渲染点（`VersionFolderList` 的两行）随 T7 搬进了**实例层** ——
 * 版本层**不画**文件夹行（那一整块带整夹控件，spec §4.3/§4.4）。⇒ 拿版本层的产物去断
 * "两个 id 都在"会在**正确**的实现上红。
 * ⚠️★ 判据没有放宽，只是**分层**了：
 *   · 这里 —— 版本层画的是**这一版的实例卡**（`data-instance-card`），
 *     而"这一版有几个 folder"这件事由下面那个 `data-folder-count` 的读数兜着
 *     （它在 `VersionFolderList` 的根上，折叠着也画得出来，见 `collapsedListHtml`）；
 *   · 实例层那一份（`instanceLayerHtml`，㊿b）证的正是"收窄到那一个 folder"。
 * ⚠️ 另一条独立读数：`data-folder-count="2"` 在 `collapsedListHtml` 上（下面那一组），
 *    它是"这一版有两个 folder"的**机器读数**（不是"我数了数产物里有几个 id"）。
 */
assert.ok(
  skeletonHtml.includes(`data-instance-card="${INSTANCE_RANKED.key}"`),
  '★★ 版本层画的是**这一版被追踪的实例**那张卡（`data-instance-card` = `instance.key`）',
);
assert.match(
  skeletonHtml,
  /data-instance-card="[^"]+"[\s\S]{0,600}?data-action="open-instance"/,
  '★★ 而卡上那颗「进入这个实例」在（没有它就没有"点进去"的那一步 —— A4 的入口）',
);
assert.equal(
  skeletonHtml.includes(`data-instance-card="${INSTANCE_UNTRACKED.key}"`),
  false,
  '★★ 反面：**未追踪**的实例不画卡（它没有 folder ⇒ 点进去只会看到一屏空白）—— ' +
    '⚠️ 这一条咬的是**版本**那一半（它是 1.16.5），"被追踪"那一半由下一条咬',
);
/*
 * ★★ 刀 3 之后补：**同版但没被追踪**的那一个。
 *
 * 现场：上面那条断的是 1.16.5（另一个版本）⇒ 就算实现漏了 `tracked === true` 那一格，
 * 它也会被 `gameVersion === page.version` 挡掉 ⇒ **那把刀实测全绿**（读数在报告里）。
 * ⇒ 判据换成"**同一个版本**上没被追踪的那一个不许画卡"：少了 `tracked` 那一格时，
 * 它**混进候选**，这一条当场红（而且它正是"未追踪的实例没有 folder ⇒ 点进去一屏空白"
 * 那条规矩唯一咬得住的地方）。
 */
assert.equal(
  skeletonHtml.includes(`data-instance-card="${INSTANCE_UNTRACKED_SAME_VERSION.key}"`),
  false,
  '★★★ 而**同版但未追踪**的那一个**也不许**画卡（它是"版本筛挡不住"的那一半）—— ' +
    '少了 `tracked === true` 那一格 ⇒ 这一条红（夹具自钉见 `twoLayerState` 那一段）',
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
 * ★★ D1（T7）：这一行的渲染点现在在**实例层**（`VersionFolderList` 只在 `selectedInstance`
 *    非空时画）⇒ 这一份产物用 `initialInstance: 'f1'`（**同一份夹具、同一个面板**，
 *    只是进那一层）—— 判据一个字没动，换的是"在哪一层量它"。
 *    ⚠️★ 两条断言因此必须**成对**存在：版本层里这一行**不在**（`skeletonHtml`，上面那组），
 *    实例层里它在（这一条）。只写一边的话，"行永远不画"或"两层都画行"都能过。
 */
const folderRowPanelHtml = keep(
  html(
    React.createElement(ModDownloadPanel, {
      state: skeletonState,
      onAction: noop,
      progress: null,
      onGoToLaunchers: noop,
      initialInstance: 'f1',
    }),
  ),
);
const f1Row = folderRowSpanOf(folderRowPanelHtml, 'f1');
assert.deepEqual(
  labelsIn(f1Row),
  [
    labelOf('files.expand'),
    labelOf('files.openFolder'),
    labelOf('files.folderUpdateAll', { count: 2 }),
    labelOf('files.folderRescan'),
    labelOf('files.unbind'),
    /*
     * ★★ D1（T7）：这一份产物是**实例层**，而实例层里第三段（`VersionModList` 的
     *    「下载」那颗）就在这一行的**下面** —— `folderRowSpanOf` 切的是"这个
     *    `data-folder-id` 到**下一个** `data-folder-id` 之间"，而这一块之后没有第二个
     *    `data-folder-id` ⇒ 窗口一直开到产物末尾，把那一颗也带了进来。
     *    ⚠️★ 这是 T7 之前**不存在**的一档（T7 之前版本层与实例层是同一层，
     *    而那时这一行后面没有任何下载按钮）。⇒ 判据**不放宽**：那一颗照旧点名，
     *    只是把它写成"这一段窗口的末尾多出来的那一颗"（少一颗/多一颗都会红）。
     */
    labelOf('files.downloadMod'),
  ],
  '★★ 那一行的控件**一颗都不许少**：展开 / 打开文件夹 / 全部更新（带 `batchTargets` 的数字）/ ' +
    '重扫这个文件夹 / 解除绑定 —— 一条不许少、也不许多（外加窗口末尾那一颗第三段的「下载」，见上）',
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
/*
 * ===========================================================================
 * ★★ D1（T7）：这一小段整体**换了量法**（原来量的是"手工绑定的入口"）
 * ===========================================================================
 * 现场：那两颗「添加文件夹」（`data-action="bind-folder"`，`data-bind-scope="section"` /
 * `"empty"`）与那句"这一版还没有文件夹"的空态**随 T7 从 UI 上摘掉了**（spec §7：
 * 手工绑定那两条通道**保留在契约里**、但**不再是 UI 入口**）—— 它们写的是派生结构
 * （`deriveFolders` 从被追踪的实例生成 `folders`），⇒ 下一次对账就把手工那一条抹掉，
 * 用户看到的是"加了又没了"。
 * ⇒ 那两条"必在"断言**必须同批改成"不许在"**（留着的话页面会继续给一条那种路），
 * 而"这一版一个被追踪的实例都没有"这件事**仍然要看得见** —— 它的渲染点搬到了
 * `InstancePicker`（`files.pickVersionEmpty` + 那颗去勾选的入口，A8 的第三种空态）。
 * ⚠️★ 判据**没有放松**：这里正反两条一起读（"`bind-folder` 一个都不在" +
 * "第三那档空态与它的出口在"），而"实例层里那五个整夹控件照旧齐全"由下面那一组钉。
 */
const noFolderState = stateOf([ROW_GITHUB], { folders: [], instances: [INSTANCE_UNTRACKED] });
const noFolderPanelHtml = keep(
  html(
    React.createElement(ModDownloadPanel, {
      state: noFolderState,
      onAction: noop,
      progress: null,
      onGoToLaunchers: noop,
    }),
  ),
);
assert.equal(
  countOf(noFolderPanelHtml, 'data-action="bind-folder"'),
  0,
  '★★ D1（T7）：手工绑定的入口**一个都不在**（两颗都不在了 —— spec §7）—— ' +
    `实际命中 ${String(countOf(noFolderPanelHtml, 'data-action="bind-folder"'))} 处`,
);
assert.ok(
  textOf(noFolderPanelHtml).includes(
    textOf(resolved('files.pickVersionEmpty', { version: '1.16.1' })),
  ),
  '★ 而"这一版没有被追踪的实例"要**说出来**（A8 的第三种空态：0 行 ⇒ 用户分不出"没有"与"没渲染"）',
);
assert.equal(
  countOf(noFolderPanelHtml, 'data-action="go-launchers"'),
  1,
  '★ 而它恰好给**一颗**去勾选的入口（`data-action="go-launchers"`）—— ' +
    `空态里给两颗是一步重复的点击（实际命中 ${String(countOf(noFolderPanelHtml, 'data-action="go-launchers"'))} 处）`,
);
/*
 * ★★ 反面（同一条纪律的另一半）：**有**文件夹的那一份里，那两颗同样不在 ——
 *    否则"空态没画"会被读成"整个入口都摘了"而其实常驻那一颗还在。
 * ⚠️ 用 `state.folders` 里有一条、但**这一版没有任何被追踪实例**的夹具：
 *    这一份面板的版本层照样不画任何 `bind-folder`（渲染点已经不在树里了）。
 */
const oneFolderPanelHtml = keep(
  html(
    React.createElement(ModDownloadPanel, {
      state: stateOf([ROW_GITHUB], { folders: [folder({ folderId: 'f1' })] }),
      onAction: noop,
      progress: null,
      onGoToLaunchers: noop,
    }),
  ),
);
assert.equal(
  countOf(oneFolderPanelHtml, 'data-action="bind-folder"'),
  0,
  '★★ 反面加一条：**已经有文件夹**的那一档里它也不在（原来那一颗「常驻入口」同批摘掉）—— ' +
    `实际命中 ${String(countOf(oneFolderPanelHtml, 'data-action="bind-folder"'))} 处`,
);
assert.ok(
  textOf(oneFolderPanelHtml).includes(textOf(resolved('files.pickNoInstances'))),
  '★ 对照（这一条钉的是**夹具**）：这一份里 `instances: []` ⇒ 版本层画的是**另一档**空态' +
    '（"还没读到任何实例"）—— 与上面那份"这一版没有被追踪的"是**两句话**（Ruling 65 的同一条）',
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
    folder({ folderId: INSTANCE_RANKED.key, gameVersion: '1.16.1' }),
    folder({ folderId: INSTANCE_OLD.key, gameVersion: '1.8.9' }),
  ],
  instances: [INSTANCE_RANKED, INSTANCE_OLD],
});
const crossHtml = keep(
  html(
    React.createElement(AllFoldersView, {
      instances: crossState.instances,
      gameVersion: crossState.gameVersion,
      folders: crossState.folders,
      onAction: noop,
      onOpenInstance: noop,
      onGoToLaunchers: noop,
    }),
  ),
);
assert.ok(
  crossHtml.includes(`data-instance-row="${INSTANCE_RANKED.key}"`) &&
    crossHtml.includes(`data-instance-row="${INSTANCE_OLD.key}"`),
  '★ 对照：两个版本的实例都在这一栏里（下面那条"含另一个版本"因此不是空跑）',
);
assert.ok(
  crossHtml.includes(`data-instance-row="${INSTANCE_OLD.key}"`),
  '★★ 「显示全部实例」那一栏含**另一个版本**的实例（spec §9.11）',
);
assert.ok(
  textOf(crossHtml).includes(textOf('1.8.9')),
  '★ 分组标题也印版本号（⚠️ 这一条**只**证"1.8.9 在产物里"—— 行内那一颗由下面那条锚住）',
);
{
  /*
   * ⚠️★ 这一条用**下标夹逼**而不是正则：实例 key 里带 `#` / 空格 / 斜杠（`1.8.9 - RSG`
   * 那一族），拼正则就得转义，而"转义写漏一个字符"的表现是**这条断言恒假或恒真**
   * （两种都不会有人发现）。
   */
  const at = crossHtml.indexOf(`data-instance-row="${INSTANCE_OLD.key}"`);
  const next = crossHtml.indexOf('data-instance-row="', at + 1);
  const row = next === -1 ? crossHtml.slice(at) : crossHtml.slice(at, next);
  assert.ok(
    textOf(row).includes(textOf('1.8.9')),
    '★★ 那个实例**自己那一行**要带版本标签（判修 5：不锚在行上的话，把行内那颗徽章删掉' +
      '照样绿 —— 分组标题已经印了同一个版本号，所以原来那条断言的证据是"标题"而不是"这一行"）',
  );
}
const failedPanelHtml = keep(
  html(
    React.createElement(ModDownloadPanel, {
      state: skeletonState,
      onAction: noop,
      actionError: 'BOOM-1',
      progress: null,
      onGoToLaunchers: noop,
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
/*
 * ⚠️★ `filesRouteCode` 定义在**文件前面那个工具段**（不是这里）：㉝ 那一组（比这一组早得多）
 *    就要读它 —— 原来它在这一行，而 `const` 的 TDZ 让那一处抛 `ReferenceError`
 *    （biome 的 `noInvalidUseBeforeDeclaration` 报的就是这件事：4 条红里的一条）。
 */
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

/** 产物里某个字面量出现了几次（**定义在文件前面对工具那一段** —— 顺序执行的脚本里，谁先用到谁在前面）。 */

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
 * ★★ D1（T7）：这一组的产物**都换成实例层**（`initialInstance: 'f1'`）。
 *    现场：T7 把"能下载的那一层"与"只读的那一层"分开了，而这一组量的正是**下载那一层**
 *    的四格 prop（`page` / `tagLabels` / `busy` / 那颗按钮）—— 版本层里那颗按钮
 *    **按设计不存在**（A3）⇒ 拿版本层的产物去断它就是在**正确**的实现上报红。
 *    ⚠️★ 判据一条没放宽：换的是"在哪一层量它"，而"版本层一个下载入口都没有"那一条
 *    由 ㊿a 逐条数（四个钩子各自的**实际命中数**）。
 *    ⚠️ 实例层里 `page` 换成 `scopedPage`（只有 `f1`）⇒ 目标选择器那一半从"两个候选"
 *    变成"一个候选"（而 `VersionModList` 只在 **≥2** 个合法目标时才画那个下拉）
 *    ⇒ 下面凡是量与"两个文件夹"有关的读数都改成了**实例层的那一个**。
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
/**
 * ★ 这一组的**实例层**夹具：把上面那份投影收窄到 `f1`（与面板里 `scopedPage` 逐字同一条算式）。
 * ⚠️ 它只用来**摆**面板（`initialInstance` 才是真的收窄点）：夹具这一份是为了让
 *    "目标表只剩 f1"这个前提在断言里读得出来（下面那条自钉）。
 */
const panelModScopedPage = planVersionPage(
  { ...panelModState, folders: panelModState.folders.filter((item) => item.folderId === 'f1') },
  [],
);
assert.deepEqual(
  panelModScopedPage.mods.map((row) => [row.presentIn, row.downloadTargets]),
  [[[], ['f1']]],
  '夹具自钉（T7）：实例层里只剩 `f1` 一个候选 ⇒ 目标选择器（≥2 才画）在那一层**不出现**',
);
assert.equal(
  panelModScopedPage.folders.length,
  1,
  '夹具自钉（T7）：实例层那一份投影**恰好一个** folder（收窄真的发生了）',
);
const panelModHtml = keep(
  html(
    React.createElement(ModDownloadPanel, {
      state: panelModState,
      onAction: noop,
      progress: null,
      onGoToLaunchers: noop,
      initialInstance: 'f1',
    }),
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
      onGoToLaunchers: noop,
      initialInstance: 'f1',
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
/*
 * ★★ D1（T7）：**第四条（渲染点那一格）已经删掉了**，理由写在派工文本里那句：
 *    "那个渲染点被摘掉了 ✗"。
 *
 * 现场：它原来断的是 `VersionFolderList.tsx` 里 `kind: 'bind-folder', version: page.version`
 * 那一句（那两颗「添加文件夹」的 `onClick`）。T7 把那两颗连同那句空态从 UI 上摘掉
 * （spec §7）⇒ 这一条在**正确**的实现上恒红。
 * ⚠️★ **不是"放宽"，是"那一条判据的对象不存在了"**：G2 的另外三条（上面那三条）
 * 测的是**契约形状与接线**（动作成员 / `Files.tsx` 的转发 / 动作层到 `api.bindFolder`），
 * 而契约面照旧保留 ⇒ 它们一字不动、照旧有牙齿。
 * ⚠️ 而"那条线**不再是 UI 入口**"这件事由**别的**判据钉着：㉞ 那两条
 *    `countOf(…, 'data-action="bind-folder"') === 0`（空态那一档 + 有文件夹那一档）。
 */
ok(
  "㊴ 第三段的喂入与接线：页面产物里**有**那一行、那颗下载按钮、标签显示名来自 `state.tags`、`busy` 时它禁用（正反各一条）、唯一一处 `kind: 'download-mod'`（送 origin）、不重算投影、面板那一处调用点喂三格、`Files.tsx` 接到 `handlers.downloadMissing`、那条通道在动作层已有实现、" +
    '而 G2 那条线（添加文件夹）在**契约形状与接线**那三层上一个字没变（T7 起它**不再是 UI 入口** ⇒ 原来第四条渲染点判据已删，理由在那一段注释里）',
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
      /*
       * ★★ D1（T7）：这一份**必须是实例层**（`initialInstance: 'f1'`）—— 展开体与
       * 「批量汇总行」都住在 `VersionFolderList` 里，而那一块随 T7 只在实例层画
       * （版本层只画实例卡 + 只读的两节）。⚠️ 换个层量不改判据：
       *   两处转发（汇总站点 / 行内站点）在这两层里是**同一段代码**。
       */
      initialInstance: 'f1',
      onGoToLaunchers: noop,
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
 *    ⚠️★★ 2026-10-12（D1 的 **T6**）：再加 ㊾ 一组（`/files` 的三个 tab / 默认 tab 规则 /
 *    **老桌面壳能力门**）⇒ 15 → **16**、16 → **17**。⚠️★ 而这个数字与**项数**不是一回事：
 *    上面这段记的是 `ok()` 的条数（`expectedGroups` 数的是**它**）。
 *    ⛔ **别在这段里手抄 `ok()` 的条数**（评审 Minor 2 的现场：这里先后写过 "4 条" 与
 *    "㊾a/㊾b/㊾c/㊾e"，而**两个都不是**当时那个数 —— 它们各自对应一版脚本，而脚本还在长；
 *    手抄的计数一定会过期，它旁边那句"现数"才是真判据）。
 *    ⇒ 要数就现数：`expectedGroups` 那条断言会在数错时把 `actual` / `expected` 都印出来。
 *    ⚠️★★ 2026-10-12（D1 的 **T7**）：再加 **㊿** 一组（"版本 → 实例"两层界面 / 只读明细 /
 *    A6 的整合包目标）⇒ 16 → **17**。⚠️ 同一段写过"它的 `ok()` 是 5 条" ⇒ 那也是手抄的
 *    计数，一样**别信**（同一条理由）。
 *    ⚠️ 同一轮里 ㉞ / ㊱ / ㊴ / ㊶ 那几组**换了量法**（"文件夹行"的渲染点从版本层搬进了
 *    实例层 ⇒ 那几条断言跟着换层），组数**没变**（它们各自仍然是一个 `ok()`）。
 *    ⚠️★★ 2026-10-12（D1 的 **T6 修复轮**）：㉝ 与 ⑰ 那两条**换了量法**（"整页第一帧 =
 *    正在扫描…"被 A8 的默认 tab 规则否掉 ⇒ 改成渲染那一格的载荷 + 源码形状钉三支的分派）；
 *    ⑰ 自己仍然是一个 `ok()`、㉝ 也仍然是一个 ⇒ **组数不变**。㊾ 里**加了 1 条** `ok()`
 *    （㊾f/㊾g 合并成 "A1 的另外两半"：页面标题 + 短名）⇒ 现数 **zh 37 / en 38**
 *    （差 1 仍是 ㉛；⛔ 这个数也是现读的，改了脚本**重跑**再抄）。
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

// ---------------------------------------------------------------------------
// ㊾ ★ D1（T6）：`/files` 的三个 tab（顺序 / 选中态 / 默认 tab 规则）与**老桌面壳能力门**
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 这一组是 T3 那一组（㉝）的**继任者**里"够不到的那一半"：
 *   · ㉝ 渲染的是**页面外壳**，而外壳在静态渲染下停在 loading 支路 ⇒ 它拿不到 `state`
 *     ⇒ 「已绑过启动器 ⇒ 落在 mod 下载」那一支**在那条路上永远断言不到**；
 *   · 所以默认规则由**纯函数** `initialTabFor` 在这里直接钉（两支都要），
 *     而 tab 顺序 / 选中态由**单独渲染 `ModTabs`** 钉（它是导出的纯组件，
 *     导出它的理由与 `Files.tsx` 文件头 :57 那段"纯组件才断言得到"是同一条）。
 * ⚠️★★ 老桌面壳（0.1.1）那一档是这一组**真正的**目标：线上 bundle 由服务端下发，
 *   而 0.1.1 的壳**有** `modFolders`、**没有** D1 那七格 ⇒ 新页面会拿到一份没有
 *   `instances` / `launchers` 的状态（`undefined.map` 那一类崩溃）。判据**不是**版本号比较
 *   （版本号会漂，0.0.5–0.0.7 那一段历史正是踩过这个，见 `capabilitiesOf` 那一段），
 *   而是"那七格在不在"。⚠️★ 而且这一条**真的渲染整页**（`pageShellOf('old')`）：
 *   只断纯函数的话，"判成 unavailable 了但页面照样画 tab"这种坏法**照样绿**。
 * ★ 能红的刀（读数在报告里）：把 `d1Capable` 的返回写成恒 `true` ⇒ ㊾e 两条一起红。
 */
console.log(`【${LANG}】㊾ 资源下载的三个 tab 与老桌面壳能力门`);
{
  /* ---- ㊾a：三个 tab 的顺序 + 选中态 ---- */
  const tabsHtml = keep(
    html(React.createElement(ModTabs, { tab: 'mods', onSelect: () => undefined })),
  );
  const order = ['launchers', 'mods', 'tools'].map((id) => tabsHtml.indexOf(`data-tab="${id}"`));
  assert.ok(
    order.every((at) => at >= 0),
    '㊾a 三个 tab 都要在（启动器绑定 / mod 下载 / 工具下载）',
  );
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
    '㊾a 顺序必须是 启动器绑定 → mod 下载 → 工具下载（`ModTab` 那个联合的书写顺序就是它）',
  );
  assert.ok(
    /data-tab="mods"[^>]*aria-selected="true"/.test(tabsHtml),
    '㊾a 传进去的那一格（`tab: \'mods\'`）必须带 `aria-selected="true"`（选中态落在当前那个上）',
  );
  assert.equal(
    (tabsHtml.match(/aria-selected="true"/g) ?? []).length,
    1,
    '㊾a 反面：`aria-selected="true"` 只许有一个（两个都 true 是最容易漏的假通过）',
  );
  ok('㊾a 三个 tab 顺序正确（启动器绑定 → mod 下载 → 工具下载），选中态落在当前那个上');

  /* ---- ㊾b：默认 tab 规则（纯函数，两支都要）---- */
  assert.equal(
    initialTabFor({ hasLaunchers: false }),
    'launchers',
    '㊾b 一个启动器都没绑 ⇒ 先落在「启动器绑定」（送到"mod 下载"会先告诉他"先去绑一个实例"）',
  );
  assert.equal(
    initialTabFor({ hasLaunchers: true }),
    'mods',
    '㊾b 绑过了 ⇒ 落在「mod 下载」（那一页才有东西可下）',
  );
  assert.equal(
    t('nav.files'),
    LANG === 'en' ? 'Resource downloads' : '资源下载',
    '㊾b 侧栏那一栏的显示名必须是"资源下载"（A1；⚠️ 路由 `/files` 与短名 `files` 一个字不动）',
  );
  ok(`㊾b 默认 tab 规则两支都对，而且显示名已改成"${t('nav.files')}"（A1）`);

  /* ---- ㊾f/㊾g：A1 的**另外两半**（页面标题、短名）---- */
  /*
   * ⚠️★★ 评审 R1：A1 有三半，而 T6 原来只钉了中间那一半（`nav.files`）。
   *   实测的坏法是"把 `<h1>` 硬编码成旧文案"⇒ **zh 31 项全绿**（只有 `--en` 因为
   *   "英文界面见汉字"那条通用扫描才红，而红的理由与 A1 无关）⇒ 页面标题那一半当时不可证。
   *   ⇒ 判据落在**页面产物**上：渲染 `pageShellOf('d1')`，断言里面**真的印出** `files.title`
   *   的译文。⚠️ 要用 `resolved()` 过一遍针孔探针（缺键时 `t()` 原样回 key，
   *   "含某个字符串"那类断言会变成空跑）。
   */
  const titleHtml = pageShellOf('d1');
  const titleText = textOf(resolved('files.title'));
  assert.ok(
    textOf(titleHtml).includes(titleText),
    `㊾f 页面标题必须是 t('files.title') 的译文（现读：${titleText}）—— ` +
      'A1 的"显示名 = 资源下载"要**两处**都成立（侧栏那一处由 ㊾b 钉）',
  );
  assert.equal(
    t('files.title'),
    LANG === 'en' ? 'Resource downloads' : '资源下载',
    '㊾f 而且那条词条本身必须就是「资源下载」（不是"页面印了某个别的词"）',
  );
  /*
   * ⚠️★ 短名那一半（评审 R6）：`nav.ts:80-85` 的注释说 `block: 'files'` 连着四处。
   *   ⚠️ 这一条**不是**在补一个"没有判据"的洞 —— 我现读实测过：把这个短名改成
   *   `'resourceDownloads'` ⇒ **`homerender` 两种语言都红**（红在它那条词条探针上：
   *   `home.desc.resourceDownloads` 解析不出译文）。所以短名**有**判据，
   *   只是那条判据住在**首页**那个脚本里（`homerender.tsx`），不在这里。
   *   ⇒ 这里加一条**廉价的正面自钉**：`NAV_SECTIONS` 里那一栏的短名**就是** `'files'`。
   *   它与 `homerender` 那条是**两个方向**：那边钉"短名变了会被发现"（红），
   *   这边钉"短名是哪几个字"（正），而且不依赖首页渲染。
   */
  assert.equal(
    NAV_SECTIONS.find((section) => section.to === '/files')?.block,
    'files',
    '㊾g `/files` 那一栏的短名必须是 `files`（A1：**只**改显示名；短名连着侧栏 CSS、' +
      '首页说明 `home.desc.files`、词条命名空间、路由四处）',
  );
  ok(
    `㊾f A1 的另外两半：页面标题印的是「${titleText}」，而短名仍是 \`files\`（路由与命名空间一个字没动）`,
  );
  /* ---- ㊾c/㊾d：老桌面壳（0.1.1）真的走"与浏览器同一档" ---- */
  /*
   * ⚠️★ 这两条用的是**桩**里的 `modFolders`（0.1.1 那一档：`mcsr` 在、`modFolders` 也在，
   *    但没有 D1 那七格）—— 它不是"没有 `modFolders`"那一档（那一档是 `'zero04'`，
   *    由 ㉕ 钉）。两档都判 `unavailable`，但**桩的形状不同** ⇒ 两条读数各钉一件事。
   */
  const oldShellApi = shellStub('old').modFolders;
  assert.equal(
    d1Capable(oldShellApi),
    false,
    '㊾c 少任何一格 ⇒ 这个壳不够 D1（0.1.1：有 `modFolders`、没有那七格）',
  );
  assert.equal(
    d1Capable(shellStub('d1').modFolders),
    true,
    '㊾c 契约里那七格都在 ⇒ 够 D1（判据是"格在不在"，不是版本号）',
  );
  /*
   * ⚠️★ 这两条**真的渲染整页**（`pageShellOf('old')` 会自己装桩 / 拆桩）。
   *   只断上面那两条纯函数的话，"判成 unavailable 了但页面照样画 tab / 照样去读
   *   `state.instances`"这种坏法**照样绿** —— 而那正是老壳里会白屏的那一条路。
   */
  const oldShellPage = pageShellOf('old');
  assert.ok(
    oldShellPage.includes('data-mod-folders="unavailable"'),
    '㊾d 老壳 ⇒ 与浏览器同一档：只画那一句"需要桌面版 0.2.0"（`data-mod-folders="unavailable"`）',
  );
  assert.equal(
    /data-tab="/.test(oldShellPage),
    false,
    '㊾d 老壳里**一个 tab 都不许画**（画了就像"还有一个模块没做"）',
  );
  ok('㊾c 老桌面壳被判成"不够 D1"（纯函数），而且整页真的只画那句"需要桌面版"（一个 tab 都没有）');

  /* ---- ㊾h：★ T8（T6 交接的第一条）"**少任何一格**就不够 D1" ---- */
  /*
   * ⚠️★★ 这一条要修的正是"判据**不可复跑**"：T6 当初用一份**一次性夹具**证过"老壳少
   *    `confirmInstance` 一格也判不够"，而那份夹具**跑完就删了、没进库**
   *    ⇒ 从那以后没有任何东西在守它（本仓对"证据只住在会被清掉的地方"有成文纪律）。
   *
   * ⚠️★ 判据的形状是**逐格遍历**（不是"挑一格试试"）：
   *   · 遍历的集合**从桩里现读**（`shellStub('d1')` 有、`shellStub('old')` 没有的那些名字）
   *     —— 不手抄七个键名：手抄的那一份会与 `ModFoldersData.tsx` 的 `D1_CHANNELS` 漂，
   *     而漂起来的表现是**这道门对某个壳恒 false**（`/files` 对所有人整块消失、零门禁输出）。
   *   · 它同时**反着**钉住 `D1_CHANNELS` 不许少一格：少了哪一格，删掉那一格时
   *     `d1Capable()` 仍会看剩下六格 ⇒ 下面这条当场红（"清单与判据必须逐格对齐"）。
   *   · `d1Names.length === 7` 是**覆盖面控制**：集合若因为桩被改坏而缩水，
   *     循环会静默地少跑几轮 —— 那正是"没问题"与"没扫到"分不开的那一类（§5.32②）。
   * ⚠️★ 页面级那一半单独读一次（`'d1MinusOne'` 那一档真的渲染整页）：只断纯函数的话，
   *    "判成 unavailable 了、但页面照样画 tab / 照样去读 `state.instances`"这种坏法照样绿。
   */
  const d1Api = shellStub('d1').modFolders ?? {};
  const preD1Names = new Set(Object.keys(shellStub('old').modFolders ?? {}));
  const d1Names = Object.keys(d1Api).filter((name) => !preD1Names.has(name));
  assert.equal(
    d1Names.length,
    7,
    `㊾h D1 那一组应当是**七格**（现读 ${String(d1Names.length)} 格：${d1Names.join(' / ')}）` +
      '—— 少一格多半是桩被改坏了，而下面的遍历会因为集合缩水而静默少跑几轮',
  );
  for (const missing of d1Names) {
    const minusOne: Record<string, unknown> = { ...d1Api };
    delete minusOne[missing];
    assert.equal(
      d1Capable(minusOne),
      false,
      `㊾h 只少 \`${missing}\` 这一格 ⇒ 这个壳**也不够** D1（"少任何一格"里的这一格；` +
        '判据是"格在不在"，不是版本号）',
    );
  }
  assert.equal(
    d1Capable({ ...d1Api, confirmInstance: undefined }),
    false,
    '㊾h 夹具那一档（`d1MinusOne`：少了 `confirmInstance`）走的正是上面循环里的一格 —— ' +
      '⚠️ 值写成 `undefined` 与"没有这一格"同义（`?.` 与 `typeof === function` 两条判据都这么读）',
  );
  const minusOnePage = pageShellOf('d1MinusOne');
  assert.ok(
    minusOnePage.includes('data-mod-folders="unavailable"'),
    '㊾h 只少一格的壳也走"与浏览器同一档"：整页只画那句"需要桌面版 0.2.0"',
  );
  assert.equal(
    /data-tab="/.test(minusOnePage),
    false,
    '㊾h 而它**一个 tab 都不许画**（少一格 = 这一页整块用不了；画出来会让它看起来只是"没加载"）',
  );
  ok(
    '㊾h ★ 只少**任何一格**（逐格遍历，现读 7 格）都不够 D1：纯函数逐格红，而页面级真的只画那句"需要桌面版"',
  );

  /* ---- ㊾e：那句词条得说清新版本号 ---- */
  assert.ok(
    t('files.partTwoUnavailable').includes('0.2.0'),
    '㊾e 那条"需要桌面版"的话必须说清 **0.2.0**（D1 的安装包版本；T6 之前写的是 0.0.5 ⇒ 同批改准）',
  );
  ok(`㊾e "需要桌面版 0.2.0"那句词条已经改准（${t('files.partTwoUnavailable').slice(0, 24)}）`);
}

// ---------------------------------------------------------------------------
// ㊿ ★★ D1（T7）：「版本 → 实例」两层界面（A3 / A4 / A5 / A6 / A8 / A10）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 这一组量的是 spec §4.3–§4.6 那条**分层**：
 *   · `selectedInstance === null` ⇒ **版本层**（只能看：实例卡 + 一句提示 + 只读的清单）；
 *   · 选中某个实例 ⇒ **实例层**（同一批组件收窄到那一个实例 ⇒ 四个下载入口全在）。
 * ⚠️★ A3 的判据是**"不含"**（版本层一个下载入口都没有），A4 的判据是"**只有**这一层有"
 *    ⇒ 两条必须**成对**读：只写"版本层不含"的话，一个"永远不画下载按钮"的实现照样绿 ✓。
 * ⚠️★ 夹具的实例名 / 路径全 ASCII（en 那一遍的零汉字扫描要过）。
 * ⚠️★ "未追踪的实例**没有** `data-action="open-instance"`"这一支是**承重**的：
 *    未追踪的实例没有 folder（`deriveFolders` 只派生被追踪的）⇒ 点进去是一屏空白
 *    （"点了没反应"那一类坏法）—— 它给的是"去勾选"那颗（`data-action="go-launchers"`）。
 */
/**
 * 版本层的状态：一个被追踪的实例 ⇒ 版本层画卡、实例层画它那一行。
 *
 * ⚠️★ 那一份 folder 的两格**必须各自配对**，否则 ㊿b 会在**正确**的实现上报红
 *    （而红的原因与"分层"毫无关系）：
 *      · `rows: [FROW_UPDATE]`（`sodium`，可批量）—— 「全部更新」那一颗闸（`batchTargets > 0`）
 *        与展开体里那两颗「更新」（`data-action="update-mod"`）都要它；
 *      · 而目录里**另有一条**这一版的 mod 不在那个 folder 里（`lithium`，见下面那一行
 *        `ROW_LITHIUM`）—— `download-mod` 那一颗要求"这一版的 folder 里还没有它"
 *        （`downloadTargets` 会把 `presentIn` 排掉）⇒ 没有它，那一颗画不出来。
 *    ⇒ 两条各需要一个**不同**的 mod（一个在里面、一个不在），所以夹具里两个都备着。
 */
/*
 * ★★ D1（T7）：「版本 → 实例」这一层要同时看得见"能下的"与"能更新的"两条路，
 *    而第三段那一行的「下载」只在"这个 mod **不在**这一版的任何被追踪 folder 里"时画
 *    （`planVersionPage` 的 `downloadTargets` 会把 `presentIn` 排掉 —— B2 那条）。
 *    ⇒ 目录里再补一行**不在那个 folder 里**的 mod（`lithium`）。
 *    ⚠️ 它只服务这一组（`rowId` / `name` 都写成这一组自己的），不进任何既有夹具。
 */
const ROW_LITHIUM: CatalogRowView = {
  ...ROW_GITHUB,
  rowId: 'lithium|1.16.1',
  modid: 'lithium',
  name: 'Lithium Prime',
  tags: [],
  tagLabels: [],
  candidates: [SODIUM_OLD],
  official: SODIUM_OLD,
  verdict: { kind: 'older', release: SODIUM_OLD },
  binding: null,
};
const twoLayerState = stateOf([ROW_GITHUB, ROW_LITHIUM], {
  folders: [
    folder({
      folderId: INSTANCE_RANKED.key,
      gameVersion: '1.16.1',
      rows: [FROW_UPDATE],
      unrecognized: [],
    }),
  ],
  instances: [INSTANCE_RANKED, INSTANCE_UNTRACKED, INSTANCE_UNTRACKED_SAME_VERSION, INSTANCE_OLD],
});
assert.equal(
  twoLayerState.instances.filter(
    (instance) => instance.gameVersion === '1.16.1' && instance.tracked === false,
  ).length,
  1,
  '夹具自钉（T7 / 刀 3）：1.16.1 上**恰好一个没被追踪**的实例 —— 少了它，"版本筛"' +
    '会把未追踪的全部挡在门外，`tracked` 那一格就没有判据（那把刀实测**全绿**）',
);

/**
 * ★★ ④（A5 的六样）那份明细**自己**的状态：**三档扫描状态在同一份产物里各有一行**。
 *
 * ⚠️★ 为什么不用上面那份 `twoLayerState`：它的 folder 里塞着 `FROW_UPDATE` 那一行
 *    ⇒ 扫描状态那一格印的是「已扫描」，而这一组要钉的是**三档各说各的话**；而
 *    "一个夹具服务两组判据"正是"改一处、另一组静默变松"的来源（本仓点名的坏味道）。
 * ⚠️ 三行分别是：
 *      · `INSTANCE_RANKED`（1.16.1，被追踪，folder **有**读数）⇒ `data-scan-state="scanned"`；
 *      · `INSTANCE_OLD`（1.8.9，被追踪，folder **没有**读数）⇒ `"...unscanned"`；
 *      · `INSTANCE_UNTRACKED`（1.16.5，**没被追踪** ⇒ **没有 folder**）⇒ `"...untracked"`。
 */
const allInstancesState = stateOf([ROW_GITHUB], {
  folders: [
    folder({ folderId: INSTANCE_RANKED.key, gameVersion: '1.16.1', rows: [], unrecognized: [] }),
    folder({
      folderId: INSTANCE_OLD.key,
      gameVersion: '1.8.9',
      hasReading: false,
      rows: [],
      unrecognized: [],
    }),
  ],
  instances: [INSTANCE_RANKED, INSTANCE_OLD, INSTANCE_UNTRACKED],
});
assert.deepEqual(
  planVersionPage(twoLayerState, []).mods.map((row) => row.modid),
  ['sodium', 'lithium'],
  '夹具自钉（T7）：这一版目录里恰好两条（`sodium` 在那个 folder 里、`lithium` 不在）—— ' +
    '下面"下载那一颗画得出来、更新那两颗也画得出来"两条读数各靠其中一条',
);
/*
 * ★★ A6 用的**整合包夹具**（定义在这一组开头：② 与 ⑤ 两处都要用它）。
 * ⚠️★ `catalogIndex` 必须**传真索引**（`buildIndex` 出来的）：`ModPacksSection` 在
 *    `catalogIndex === null` 时**不画行**（"可下 N 项"离了索引算不出来）⇒ 传 null 会让
 *    "那一节在不在"这一类断言红得很怪。⚠️ 索引里那一条 release 的 modid 要与包里的
 *    `modids` 对得上（`packDownloadableIn` 按 `(modid, 版本)` 查候选）。
 */
const panelPackIndex = buildIndex({
  mods: [],
  releases: [release('sodium', '0.1.3', GITHUB_URL), release('lithium', '0.1.2', CDN_URL)],
  tagLabels: {},
});
const panelPack: ModPackWire = {
  id: 'pack-a6',
  title: 'Pack A6',
  description: 'no digits here',
  gameVersion: '1.16.1',
  modids: ['sodium', 'lithium'],
  hot: false,
  modCount: 2,
};
/** 那一节里**目标实例下拉**那一段产物（正则字面量：`useRegexLiterals` 那条 lint 要求它）。 */
const packSelectOf = (markup: string): string =>
  /<select[^>]*data-pack-folder="pack-a6"[^>]*>[\s\S]{0,600}?<\/select>/.exec(markup)?.[0] ?? '';
{
  /* ---- ① 版本层（A3：清单看得见、**一个下载入口都没有**）---- */
  const versionLayerHtml = keep(
    html(
      React.createElement(ModDownloadPanel, {
        state: twoLayerState,
        onAction: noop,
        progress: null,
        onGoToLaunchers: noop,
        /* ⚠️ 包那一节的两格也喂上：A3 的另一半是"**看得见**但下不了"（两层的读数必须成对）。 */
        packs: [panelPack],
        catalogIndex: panelPackIndex,
      }),
    ),
  );
  const downloadHooks = [
    'data-action="update-folder-all"',
    'data-action="download-mod"',
    'data-action="update-mod"',
    'data-pack-download',
  ] as const;
  /*
   * ⚠️ 逐条打印实际命中数（`assert.equal` 的第三个参数就是那句读数）：
        "不含"这类断言最容易变成恒真 —— 数字印出来才看得出它真的数过。
   */
  for (const hook of downloadHooks) {
    assert.equal(
      countOf(versionLayerHtml, hook),
      0,
      `㊿a A3：版本层**不许**有下载入口（${hook} 实际命中 ${String(countOf(versionLayerHtml, hook))} 处）`,
    );
  }
  assert.ok(
    versionLayerHtml.includes(`data-instance-card="${INSTANCE_RANKED.key}"`),
    '㊿a 版本层有实例卡（`data-instance-card="<folderId>"`）—— 没有它就没有"点进去"的入口',
  );
  assert.ok(
    versionLayerHtml.includes('data-readonly-hint'),
    '㊿a 版本层有那句提示（`data-readonly-hint`）—— "为什么这里不能下"的唯一答案',
  );
  assert.ok(
    textOf(versionLayerHtml).includes(textOf(resolved('files.pickInstanceHint'))),
    '㊿a 而那句提示印的是它自己那条词条（写死一句话会让"改词条"与"改代码"两处漂）',
  );
  /* ⚠️★ 卡上要印**实例名**（`instance.name`，不是 key 的尾段）：`folders[]` 里没有这一格。 */
  assert.ok(
    versionLayerHtml.includes(INSTANCE_RANKED.name),
    '㊿a 卡上印的是 `state.instances[].name`（`folders[]` 里没有启动器类型与实例名）',
  );
  ok('㊿a A3：版本层有实例卡 + 只读提示，而四个下载钩子**一个都不在**（逐条实际命中数见上）');

  /* ---- ② 实例层（A4：**只有**这一层能下载）---- */
  const instanceLayerHtml = keep(
    html(
      React.createElement(ModDownloadPanel, {
        state: twoLayerState,
        onAction: noop,
        progress: null,
        onGoToLaunchers: noop,
        /* ⚠️ 选中那一格由自检喂（产品里由点击写它 —— 静态渲染跑不了 handler）。 */
        initialInstance: INSTANCE_RANKED.key,
        /*
         * ⚠️★ 展开态也由自检喂，理由与 `initialInstance` 同一条：`data-action="update-mod"`
         *    那一颗住在**展开体**里（`FolderJarList`），而静态渲染点不动"展开"。
         *    ⇒ 少了这一格，下面那条"四个钩子各至少一处"会因为"第三个钩子要展开才画"
         *    而在**正确**的实现上报红（那是夹具的错，不是实现的）。
         */
        initialExpanded: [INSTANCE_RANKED.key],
        /* ⚠️ 包那一节同样要喂（`data-pack-download` 是四个钩子里的第四个）。 */
        packs: [panelPack],
        catalogIndex: panelPackIndex,
      }),
    ),
  );
  /*
   * ⚠️★ 四个钩子在这**一份**产物里就能全部命中（夹具同时备了"在 folder 里的 `sodium`"
   *    与"不在的 `lithium`"，加上展开态 ⇒ 更新那两颗也画得出来）—— 四条读数各是一处
   *    **独立**的入口，少任何一处都会在它自己那一行红。
   */
  for (const hook of downloadHooks) {
    assert.ok(
      countOf(instanceLayerHtml, hook) >= 1,
      `㊿b A4：实例层必须有下载入口（${hook} 实际命中 ${String(countOf(instanceLayerHtml, hook))} 处）`,
    );
  }
  /*
   * ★★ 第四条钩子（「全部更新」）另用一份夹具补一条**独立**读数：上面那一份的 folder 是
   *    `rows: []`（为了让 `download-mod` 画得出来，见夹具那一段）⇒ 那颗按钮的四条闸
   *    过不了、它**本来就不该画**。⚠️ 这一条与上面那三条**不是**同一份产物：
   *    它证明"实例层里那条批量路径也在"（而不是"恰好上面那份画了它"）。
   *    ⚠️ 判据仍是"至少一处"，只是换了一份**该画它**的夹具 —— 两处各证一半。
   */
  const updatableInstanceHtml = keep(
    html(
      React.createElement(ModDownloadPanel, {
        state: stateOf([ROW_GITHUB], {
          folders: [folder({ folderId: INSTANCE_RANKED.key, gameVersion: '1.16.1' })],
          instances: [INSTANCE_RANKED],
        }),
        onAction: noop,
        progress: null,
        onGoToLaunchers: noop,
        initialInstance: INSTANCE_RANKED.key,
      }),
    ),
  );
  assert.ok(
    countOf(updatableInstanceHtml, 'data-action="update-folder-all"') >= 1,
    '㊿b A4：那一份**有可批量行**的实例层里「全部更新」在场（`canUpdateFolderAll` 四条闸全过）' +
      `—— 实际命中 ${String(countOf(updatableInstanceHtml, 'data-action="update-folder-all"'))} 处`,
  );
  assert.ok(
    instanceLayerHtml.includes(`data-folder-id="${INSTANCE_RANKED.key}"`),
    '㊿b 实例层画的是**它自己那一行**（收窄后的 `scopedPage.folders`）',
  );
  assert.equal(
    instanceLayerHtml.includes(`data-folder-id="${INSTANCE_OLD.key}"`),
    false,
    '㊿b 反面：**别的**实例那一行不许出现在这一层（收窄没做的话它就在）',
  );
  assert.equal(
    versionLayerHtml.includes(`data-folder-id="${INSTANCE_RANKED.key}"`),
    false,
    '㊿b 反面：版本层**不画**文件夹行（那一整块带整夹控件 ⇒ 它是实例层的）',
  );
  ok('㊿b A4：实例层四个下载钩子各至少一处，而且只有它自己那一行（版本层不画行）');

  /* ---- ③ 跨版本点行：先换目录版本、再选中（否则切过去是空白）---- */
  const openInstanceRule =
    /kind:\s*'set-catalog-version',\s*version\s*\}?[\s\S]{0,400}?setSelectedInstance\(/;
  assert.match(
    downloadPanelCode,
    openInstanceRule,
    '㊿c 点行必须**先**换目录版本（`set-catalog-version`）**再**选中那个实例 —— ' +
      '版本不同时只切实例 ⇒ 切过去看不见它（`planVersionPage` 按 `state.gameVersion` 筛）',
  );
  const catalogActionCalls = countOf(downloadPanelCode, "kind: 'set-catalog-version'");
  assert.equal(
    catalogActionCalls,
    3,
    `㊿c 全文件恰好**三处**带这一格：① 联合成员的类型声明、② 顶部那个版本下拉的 onChange、` +
      `③ 点行那一处 —— 实际命中 ${String(catalogActionCalls)} 处。` +
      '⚠️★ 这个数**恰好**是判据：少到 2 ⇒ 有人把 ③ 摘掉了（点行不再换版本，"点了没反应"）；' +
      '多到 4 ⇒ 多出第四条会改目录版本的路径（那一条要连**持久化的 prefs** 一起写）',
  );
  const versionGate = countOf(downloadPanelCode, 'if (version !== page.version)');
  assert.equal(
    versionGate,
    1,
    `㊿c 而"版本不同才换"那道闸只有**一条**（少了它 ⇒ 每次点行都多写一遍持久化的 prefs；` +
      `多了它 ⇒ 两条会改目录版本的路径）—— 实际命中 ${String(versionGate)} 处`,
  );
  assert.ok(
    downloadPanelCode.includes('folders.filter('),
    '㊿c 实例层是**收窄**（`page.folders.filter(...)`），不是另写一套组件（A10：判定一行都不改）',
  );
  ok('㊿c 点行先换版本再选中，而"换目录版本"这个动作全文件恰好三处（类型声明 + 顶部下拉 + 点行）');

  /* ---- ④ 只读明细「显示全部实例」（A5：六样都在 / 追踪与否分岔 / 不能下载）---- */
  const allInstancesHtml = keep(
    html(
      React.createElement(AllFoldersView, {
        instances: allInstancesState.instances,
        gameVersion: allInstancesState.gameVersion,
        /*
         * ⚠️★ 这一格是"扫描状态"那**一样**的唯一来源（`ModFolderView.hasReading`）：
         *    其余五样都从 `instances` 来。⚠️ 不喂它的话，被追踪的那两行都会印
         *    "未追踪"（`readingOf` 查不到 ⇒ 判成"没有这一格"）—— 那不是这一栏的错，
         *    是**自检漏喂了一格**（下面那条三档断言会当场红）。
         */
        folders: allInstancesState.folders,
        onAction: noop,
        onOpenInstance: noop,
        onGoToLaunchers: noop,
      }),
    ),
  );
  const rowOf = (key: string): string => {
    const at = allInstancesHtml.indexOf(`data-instance-row="${key}"`);
    assert.notEqual(at, -1, `㊿d 明细里找不到那一行：${key}`);
    const next = allInstancesHtml.indexOf('data-instance-row="', at + 1);
    return next === -1 ? allInstancesHtml.slice(at) : allInstancesHtml.slice(at, next);
  };
  const rankedRow = rowOf(INSTANCE_RANKED.key);
  const untrackedRow = rowOf(INSTANCE_UNTRACKED.key);
  const oldRow = rowOf(INSTANCE_OLD.key);
  /* ⚠️★ 六样**都要在**（spec §4.5）：那一栏的数据源是 `state.instances` —— `folders[]`
        里既没有 `saves`、也没有启动器类型与实例名 ⇒ 拿 folders 当数据源时这六条里有三条
        根本画不出来（不是"画得不好"，是**没有那个数据**）。 */
  const sixFacts: readonly (readonly [string, string])[] = [
    ['启动器类型', t('files.launcherKindMultimc')],
    ['实例名', INSTANCE_RANKED.name],
    ['版本', INSTANCE_RANKED.gameVersion ?? ''],
    ['mods 路径', INSTANCE_RANKED.modsDir],
    ['saves 路径', INSTANCE_RANKED.savesDir],
    ['扫描状态', t('files.scanStatusScanned')],
  ];
  for (const [what, value] of sixFacts) {
    assert.ok(
      textOf(rankedRow).includes(textOf(value)),
      `㊿d A5：那一行缺了「${what}」（期望印出 ${value}）`,
    );
  }
  /*
   * ★★ 三档**各说各的话**（Ruling 65：分不清"不知道"与"没有"的读数不许当结论用）：
   *    "没有这一格"（未追踪）与"有那一格但还没扫"是**两句话** —— 说成一句会让用户
   *    以为"扫一下就有了"，而那个实例根本还没进被追踪集合。
   *    ⚠️ 机器读数是 `data-scan-state`（短字面量），文案是词条 ⇒ 两条**独立**读数。
   */
  const scanStates: readonly (readonly [string, string, string])[] = [
    ['scanned', t('files.scanStatusScanned'), rankedRow],
    ['unscanned', t('files.scanStatusUnscanned'), oldRow],
    ['untracked', t('files.scanStatusUntracked'), untrackedRow],
  ];
  for (const [state, label, row] of scanStates) {
    assert.ok(
      row.includes(`data-scan-state="${state}"`),
      `㊿d 那一行的扫描状态必须是 ${state}（机器读数 data-scan-state）`,
    );
    assert.ok(textOf(row).includes(textOf(label)), `㊿d 而它印的是那一档自己的话（期望 ${label}）`);
  }
  assert.ok(
    rankedRow.includes('data-action="open-instance"'),
    '㊿d 被追踪的那一行**可以**点进实例层（`data-action="open-instance"`）',
  );
  assert.equal(
    untrackedRow.includes('data-action="open-instance"'),
    false,
    '㊿d 反面：**未追踪**的那一行没有"点进去"（它没有 folder ⇒ 点进去是一屏空白）',
  );
  assert.ok(
    untrackedRow.includes('data-action="go-launchers"'),
    '㊿d 而它有一颗**去勾选**的（`data-action="go-launchers"`）—— 那才是它该做的事',
  );
  for (const hook of downloadHooks) {
    assert.equal(
      countOf(allInstancesHtml, hook),
      0,
      `㊿d A5：只读明细里**不能**下载（${hook} 实际命中 ${String(countOf(allInstancesHtml, hook))} 处）`,
    );
  }
  /* ⚠️★ 只读**不等于**没有出口：打开文件夹是"找文件夹"这件事本身，不是下载 ✓。 */
  assert.ok(
    rankedRow.includes('data-action="open-folder"'),
    '㊿d 「打开文件夹」照旧留着（它不是下载 —— 用户来这一栏就是为了找到那个目录）',
  );
  /* ★ 词条改名（spec §4.5）：一条词条两个渲染点（顶部那颗按钮 + 那一栏标题）。 */
  assert.ok(
    textOf(allInstancesHtml).includes(textOf(resolved('files.allBoundFolders'))),
    '㊿d 那一栏的标题复用同一条词条（与顶部那颗按钮同一个说法）',
  );
  assert.equal(
    t('files.allBoundFolders'),
    LANG === 'en' ? 'Show all instances' : '显示全部实例',
    `㊿d 而它已经改名为"显示全部实例"（实际：${t('files.allBoundFolders')}）`,
  );
  ok('㊿d A5：只读明细六样都在、追踪与否分岔（点进去 / 去勾选）、一个下载钩子都没有');

  /* ---- ⑤ 空态（A8 的第三种）+ A6（整合包那一节收成当前这一个实例）---- */
  const emptyInstanceState = stateOf([ROW_GITHUB], {
    folders: [],
    instances: [INSTANCE_UNTRACKED],
  });
  const emptyInstanceHtml = keep(
    html(
      React.createElement(ModDownloadPanel, {
        state: emptyInstanceState,
        onAction: noop,
        progress: null,
        onGoToLaunchers: noop,
      }),
    ),
  );
  assert.ok(
    textOf(emptyInstanceHtml).includes(
      textOf(resolved('files.pickVersionEmpty', { version: '1.16.1' })),
    ),
    '㊿e A8 第三种空态：该版本没有任何被追踪实例 ⇒ 说明要在场（"没有"与"没渲染"分得开）',
  );
  assert.equal(
    countOf(emptyInstanceHtml, 'data-action="go-launchers"'),
    1,
    '㊿e 而它恰好给**一颗**去勾选的入口（`data-action="go-launchers"`）—— ' +
      `空态里给两颗是一步重复的点击（实际命中 ${String(countOf(emptyInstanceHtml, 'data-action="go-launchers"'))} 处）`,
  );
  /* A6：同一个面板 + 同一个包清单，两层各渲染一次 ⇒ 只有**实例层**有那颗 `data-pack-download`，
        而且它绑定的目标就是**当前这一个**实例（下拉里只剩它一项）。
     ⚠️ 夹具（`packState` / `panelPackIndex` / `panelPack`）里的目录索引与包**定义在这一组开头**：
        ② 那一份产物（四个下载钩子的读数）也要用同一个包，两处各造一份就会漂。 */
  const packState = stateOf([ROW_GITHUB], {
    folders: [folder({ folderId: INSTANCE_RANKED.key, rows: [], unrecognized: [] })],
    instances: [INSTANCE_RANKED],
  });
  const instanceLayerPacks = keep(
    html(
      React.createElement(ModDownloadPanel, {
        state: packState,
        onAction: noop,
        progress: null,
        onGoToLaunchers: noop,
        packs: [panelPack],
        catalogIndex: panelPackIndex,
        initialInstance: INSTANCE_RANKED.key,
      }),
    ),
  );
  assert.equal(
    countOf(instanceLayerPacks, 'data-pack-download="pack-a6"'),
    1,
    '㊿e A6：实例层里那一节在，而且那颗「装」按钮在场',
  );
  const packSelect = packSelectOf(instanceLayerPacks);
  assert.notEqual(
    packSelect,
    '',
    '㊿e A6：那一节的 `data-pack-folder` 下拉不在产物里（"目标收成一个"这条就没得量了）',
  );
  assert.equal(
    countOf(packSelect, '<option'),
    1,
    `㊿e A6：目标下拉里只剩**当前这一个**实例（实际 ${String(countOf(packSelect, '<option'))} 项）`,
  );
  assert.ok(
    packSelect.includes(`value="${INSTANCE_RANKED.key}"`),
    `㊿e A6：而它绑定的目标 = 当前选中的那个实例（期望 value="${INSTANCE_RANKED.key}"）`,
  );
  const versionLayerPacks = keep(
    html(
      React.createElement(ModDownloadPanel, {
        state: packState,
        onAction: noop,
        progress: null,
        onGoToLaunchers: noop,
        packs: [panelPack],
        catalogIndex: panelPackIndex,
      }),
    ),
  );
  assert.ok(
    versionLayerPacks.includes('data-pack-row="pack-a6"'),
    '㊿e 版本层照旧**列全**那一节的包与版本（A6 的前半条：只读、但看得见）',
  );
  assert.equal(
    countOf(versionLayerPacks, 'data-pack-download="pack-a6"'),
    0,
    '㊿e 而版本层里那颗「装」按钮**不在**（A3：下载只发生在实例层）',
  );
  ok('㊿e A8 第三种空态（说明 + 一颗去勾选）+ A6（实例层的目标收成当前这一个、版本层只列不装）');
}

// ---------------------------------------------------------------------------
// 51 ★★ D1（T8）：「启动器绑定」那一格（A7 / A8 / A12 / A14 / A15）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 组号从 51 起用 **ASCII 数字**：Unicode 的圈号到 ㊿（= 50）就没了 ——
 *    组号只是给人看的标签，与文件末尾那条 `pass` 计数无关。
 *
 * ⚠️★ 这一组量的是"用户第一次进来要做的事"，也是**唯一**能改解析结果的地方（spec §4.6）：
 *    根路径可改 / 每个实例六样 / 待确认标 + **显式确认** / 勾选框 / 两种空态 /
 *    逐块失败 + 重试 / 浏览器里那句引导。
 * ⚠️★ 判据的锚点是**产物里的机器读数**（`data-launcher-block` / `data-instance-row` /
 *    `data-instance-mods` …）与**那句原话本身**：静态渲染**不跑事件处理器**，所以
 *    "按下去真的走了哪条通道"只能由**源码形状**（下面 51g）与 `tsc` 的穷尽性守卫兜着
 *    （`makeModPageAction` 那个 `const never: never = action`）。
 * ⚠️★ 夹具的名字 / 路径一律 **ASCII**：⑱ 那条"英文产物零汉字"的扫描要在 `--en` 那一遍过
 *    （主进程写死的中文在这个脚本里一律换成 ASCII 记号，见 `NOTE` 那一段的同一条纪律）。
 *    唯一"原样印"的中文是 `BLOCK_ERROR` —— 它是**夹具**，也是 ASCII。
 * ⚠️★ 实例夹具的 `instancePath` 与 `key` **必须同源**（`instanceKeyOf` 拼出来的那一对）：
 *    这一页按"实例落在哪个根里面"把它挂到对应的启动器块下（`instancesOfBinding`），
 *    两格对不上时那一行会**一个块都不属于** ⇒ 下面每一条断言都会以"找不到那一行"红，
 *    而红的原因与产品缺陷无关（那正是"夹具写错"那一类，先修夹具）。
 */

/** 一条**读得到**的绑定（`error: null` = 这一趟读到过它，见 `LauncherBindingView`）。 */
const LAUNCHER_ROOT = 'D:\\MultiMC';
const BINDING_OK: LauncherBindingView = {
  id: `multimc:${LAUNCHER_ROOT}`,
  kind: 'multimc',
  rootPath: LAUNCHER_ROOT,
  error: null,
};
/**
 * 一块**读不动**的绑定（A14 的现场：路径被搬走 / 没权限 / 元数据坏）。
 * ⚠️ 真实那一句由主进程写（中文，带路径）；夹具用 ASCII 记号，理由见上面那一段。
 */
const BROKEN_ROOT = 'E:\\Prism';
const BLOCK_ERROR = 'LAUNCHER-BLOCK-ERROR-77: instances dir is missing';
const BINDING_BROKEN: LauncherBindingView = {
  id: `pcl2:${BROKEN_ROOT}`,
  kind: 'pcl2',
  rootPath: BROKEN_ROOT,
  error: BLOCK_ERROR,
};

/**
 * 一个**属于 `LAUNCHER_ROOT`** 的实例夹具：`instancePath` 与 `key` 由同一个函数认出来。
 * ⚠️★ 名字取 `key` 的末段（`instanceKeyParts` 的逆）—— 与 `InstancePicker` 那一处同一条。
 * ⚠️★ **夹具自钉**：那一对 `(key, instancePath)` 必须真的对得上
 *    （`instanceKeyOf(kind, 根, 实例路径) === key`）—— 面板就是按这条判据把实例挂到对应的
 *    启动器块下的，两格对不上时那一行**一个块都不属于** ⇒ 下面每一条断言都会以"找不到
 *    那一行"红，而那个红的理由与产品缺陷无关（夹具写错那一类）。
 */
function boundInstance(over: Partial<InstanceView> & { key: string }): InstanceView {
  const name = instanceKeyParts(over.key).name;
  const instancePath = `${LAUNCHER_ROOT}\\instances\\${name}`;
  assert.equal(
    instanceKeyOf('multimc', LAUNCHER_ROOT, instancePath),
    over.key,
    `夹具自钉：这个实例的 key 与它的路径对不上（${over.key} vs ${instancePath}）`,
  );
  return instanceView({
    name,
    instancePath,
    modsDir: `${instancePath}\\.minecraft\\mods`,
    savesDir: `${instancePath}\\.minecraft\\saves`,
    ...over,
  });
}
/** 被追踪、版本与 loader 都读得出来（实例行的正例）。 */
const PANEL_INSTANCE_TRACKED = boundInstance({
  key: 'multimc:instances/1.16.1 - Ranked#1',
  gameVersion: '1.16.1',
  loader: 'fabric 0.17.3',
  tracked: true,
  /* ⚠️ 显示值是 `needsConfirm && !confirmed`（`instanceViewsOf` 算好的）：这一行两样都不画。 */
  confirmed: true,
  needsConfirm: false,
});
/** **待确认**（探测判不出来）且没勾：待确认标 + 确认按钮就长在这一行上。 */
const PANEL_INSTANCE_CONFIRM = boundInstance({
  key: 'multimc:instances/1.15.2 - RSG',
  gameVersion: '1.15.2',
  loader: null,
  tracked: false,
  confirmed: false,
  needsConfirm: true,
});
/**
 * 路径**手改过**（A12）⇒ `needsConfirm` 被 `applyOverride` 清掉、也没确认过。
 * ⚠️★ 它同时是"路径输入框的初值 = **生效值**"那条判据的靶子：`modsDir` / `savesDir`
 *    两格**不是**从 `instancePath` 拼出来的探测值 ⇒ 输入框里必须是这两个手改值。
 */
const PANEL_INSTANCE_EDITED = boundInstance({
  key: 'multimc:instances/1.12.2',
  gameVersion: '1.12.2',
  tracked: false,
  confirmed: false,
  needsConfirm: false,
  modsDir: 'D:\\hand-edited\\mods',
  savesDir: 'D:\\hand-edited\\saves',
});
/** `probeLaunchers()` 的产物（候选）—— 两条，其中第二条是"官方启动器"那一档。 */
const CANDIDATES = [
  { kind: 'multimc' as const, rootPath: LAUNCHER_ROOT },
  { kind: 'official' as const, rootPath: 'C:\\Users\\someone\\AppData\\Roaming\\.minecraft' },
];

/** 这一组的默认状态：一条绑得住的启动器 + 上面那三行实例。 */
function launcherPanelState(over: Partial<ModFoldersState> = {}): ModFoldersState {
  return stateOf([], {
    launchers: [BINDING_OK],
    instances: [PANEL_INSTANCE_TRACKED, PANEL_INSTANCE_CONFIRM, PANEL_INSTANCE_EDITED],
    ...over,
  });
}

/** 一次「启动器绑定」那一格的渲染（纯 props 组件 ⇒ 自检直接喂它）。 */
const launcherBindingHtml = (over: Record<string, unknown> = {}): string =>
  keep(
    html(
      React.createElement(LauncherBindingPanel, {
        state: launcherPanelState(),
        detected: CANDIDATES,
        onAction: noop,
        busy: false,
        ...over,
      }),
    ),
  );

/**
 * 一个**启动器块**那一段产物：从 `data-launcher-block="<id>"` 起，到**下一个**块为止。
 *
 * ⚠️★ 与 `folderRowSpanOf` 同一条取舍：它不是"配平地切出那个 `<section>`"，
 *    而是"相邻两块之间的那一段"。⚠️ 代价（认）：**最后**那一块的窗口会一直伸到产物末尾
 *    ⇒ 它把后面"添加启动器"那一节也包进来；所以只在这段里找**块自己**的东西
 *    （原话 / 重试 / 它名下的行），别在这段里断"整页只有一处某东西"。
 */
function launcherBlockSpanOf(markup: string, id: string): string {
  const start = markup.indexOf(`data-launcher-block="${id}"`);
  assert.notEqual(
    start,
    -1,
    `产物里找不到 data-launcher-block="${id}" 那一块 —— 那个启动器没画出来`,
  );
  const next = markup.indexOf('data-launcher-block="', start + 1);
  return next === -1 ? markup.slice(start) : markup.slice(start, next);
}

/** 一个实例行那一段产物（从 `data-instance-row="<key>"` 到下一个行）。 */
function bindingRowSpanOf(markup: string, key: string): string {
  const start = markup.indexOf(`data-instance-row="${key}"`);
  assert.notEqual(start, -1, `产物里找不到 data-instance-row="${key}" 那一行 —— 那个实例没画出来`);
  const next = markup.indexOf('data-instance-row="', start + 1);
  return next === -1 ? markup.slice(start) : markup.slice(start, next);
}

/**
 * 产物里**某一个 `<input>`** 那个标签（按 `属性名="值"` 定位，从 `<input` 起到它自己的 `>`）。
 *
 * ⚠️★ 为什么不用正则配平：属性值里有 Windows 路径（反斜杠）与 `:`，而 `<input` 与 `>` 之间
 *    **没有**嵌套标签 ⇒ 按"下一个 `>`"截断是安全的；配平一个正则只会更难读。
 */
function inputTagOf(markup: string, attr: string, value: string): string {
  const at = markup.indexOf(`${attr}="${value}"`);
  assert.notEqual(at, -1, `产物里找不到 ${attr}="${value}" —— 那一格没画出来（或值不是这个）`);
  const start = markup.lastIndexOf('<input', at);
  assert.notEqual(
    start,
    -1,
    `${attr}="${value}" 前面没有 \`<input\` —— 那个机器读数挂在了别的标签上`,
  );
  const end = markup.indexOf('>', at);
  return markup.slice(start, end + 1);
}

{
  console.log(`【${LANG}】51 启动器绑定那一格（A7 / A8 / A12 / A14 / A15）`);

  /* ---- 51a：A7 —— 一个实例行里**六样**都在场 ---- */
  /*
   * ⚠️★ A7 的六样：实例名 / 版本 / loader / `mods`（可改）/ `saves`（可改）/ 勾选框。
   *    判据分两条腿：前三样读**文字**（`textOf`，标签与值都在），后三样读**那个 input 标签**
   *    （`value=` 是初值、`checked` 是勾选读数）—— 只读文字的话，"输入框画了但没有初值"
   *    照样绿（那是这一页最贵的一格：初值错 ⇒ 用户一按保存就把路径改坏）。
   */
  const panelHtml = launcherBindingHtml();
  const trackedRow = bindingRowSpanOf(panelHtml, PANEL_INSTANCE_TRACKED.key);
  const editedRow = bindingRowSpanOf(panelHtml, PANEL_INSTANCE_EDITED.key);
  const trackedText = textOf(trackedRow);
  /*
   * ⚠️★ 两侧都要过 `textOf`：它把**空白全压掉**（`1.16.1 - Ranked#1` ⇒ `1.16.1-Ranked#1`）
   *    ⇒ 只压一侧的话，带空格的夹具名在**正确**的产物上红（那次红的理由与产品无关）。
   */
  assert.ok(
    trackedText.includes(textOf(PANEL_INSTANCE_TRACKED.name)),
    `51a ① 实例名：那一行里要看得到 \`${PANEL_INSTANCE_TRACKED.name}\`（磁盘上的内容，原样印）`,
  );
  assert.ok(trackedText.includes('1.16.1'), '51a ② 版本：那一行里要看得到这个实例的版本');
  /*
   * ⚠️★ loader 那一格是**输入框**（A7 的"可手改"）⇒ 它的值在**属性**里，`textOf` 读不到
   *    ⇒ 判据是"那个 input 的初值" + "它自己的标签在文字里"（两个方向都要，
   *    否则"画了一个没有标签的空框"照样绿）。
   */
  assert.ok(
    inputTagOf(trackedRow, 'data-instance-loader', PANEL_INSTANCE_TRACKED.key).includes(
      `value="${PANEL_INSTANCE_TRACKED.loader}"`,
    ),
    '51a ③ loader：那一格是**可改的输入框**，初值 = 这个实例解析出来的 loader 串',
  );
  assert.ok(
    trackedText.includes(textOf(resolved('files.instanceLoaderLabel'))),
    '51a ③ 而且那一格的标签在（同一个框里既要有值、也要说清它是什么）',
  );
  const modsInput = inputTagOf(trackedRow, 'data-instance-mods', PANEL_INSTANCE_TRACKED.key);
  assert.ok(
    modsInput.includes(`value="${PANEL_INSTANCE_TRACKED.modsDir}"`),
    '51a ④ `mods` 输入框：初值必须是**生效值**（`state.instances` 里那一格）',
  );
  const savesInput = inputTagOf(trackedRow, 'data-instance-saves', PANEL_INSTANCE_TRACKED.key);
  assert.ok(
    savesInput.includes(`value="${PANEL_INSTANCE_TRACKED.savesDir}"`),
    '51a ⑤ `saves` 输入框：同上（初值 = 生效值）',
  );
  const trackedBox = inputTagOf(trackedRow, 'data-instance-tracked', PANEL_INSTANCE_TRACKED.key);
  assert.ok(
    trackedBox.includes(' checked'),
    '51a ⑥ 勾选框：被追踪的那一行真的带 `checked` 读数（否则用户看不出自己勾没勾）',
  );
  const editedBox = inputTagOf(editedRow, 'data-instance-tracked', PANEL_INSTANCE_EDITED.key);
  assert.equal(
    editedBox.includes(' checked'),
    false,
    '51a ⑥ 反面：**没被追踪**的那一行不许带 `checked`（恒画 `checked` 就分不出勾没勾）',
  );
  /*
   * ★★ "初值是**生效值**、不是探测值"那条纪律的靶子：这一行的 `modsDir` / `savesDir` 是
   *    用户手改过的（`D:\hand-edited\…`），而 `instancePath` 还在 `D:\MultiMC\instances\…`
   *    ⇒ 谁要是"自己按 instancePath 拼一个 .minecraft\mods"，这一条当场红。
   */
  assert.ok(
    inputTagOf(editedRow, 'data-instance-mods', PANEL_INSTANCE_EDITED.key).includes(
      'D:\\hand-edited\\mods',
    ),
    '51a ★ 手改过的那一行：初值是**手改后的生效值**（不是按 `instancePath` 拼出来的探测值）',
  );
  ok(
    '51a A7：一个实例行里六样都在场（名称 / 版本 / loader / mods 输入框 / saves 输入框 / 勾选框带 checked 读数），' +
      '而且路径初值是**生效值**',
  );

  /* ---- 51b：待确认标 + 显式确认（2026-10-11 控制器裁定的那条验收）---- */
  /*
   * ⚠️★ 判据是**成对**的（这是这一组唯一"必须能让去掉实现变红"的一条）：
   *   · `needsConfirm === true` ⇒ 标 **与** 按钮**两样都在**；
   *   · `needsConfirm === false`（= `confirmed` 或路径被手改过）⇒ **两样都不画**。
   *   只写前半条的话，"标在任何实例上都画"照样绿（那正是"点了确认标还在"那一类坏法）。
   */
  const confirmRow = bindingRowSpanOf(panelHtml, PANEL_INSTANCE_CONFIRM.key);
  assert.ok(
    confirmRow.includes(`data-instance-needs-confirm="${PANEL_INSTANCE_CONFIRM.key}"`),
    '51b `needsConfirm` 的那一行要有那个标（`data-instance-needs-confirm="<key>"`）',
  );
  assert.ok(
    /data-action="confirm-instance"/.test(confirmRow),
    '51b 而且要有那颗「确认这个路径」（它走 `confirmInstance(key)` ⇒ 写 `instancePrefs[key].confirmed = true`）',
  );
  for (const [why, row] of [
    ['已经被确认过（`confirmed`）', trackedRow],
    ['路径被手改过（`applyOverride` 清了 `needsConfirm`）', editedRow],
  ] as const) {
    assert.equal(
      row.includes('data-instance-needs-confirm='),
      false,
      `51b 反面（${why}）：那个标记**不许**画 —— 恒画它就是"点了确认、标还在"`,
    );
    assert.equal(
      row.includes('data-action="confirm-instance"'),
      false,
      `51b 反面（${why}）：那颗按钮**也不许**画（它已经没什么可确认的了）`,
    );
  }
  ok(
    '51b ★ 待确认标 + 「确认这个路径」只画在 `needsConfirm` 的那些行上（confirmed / 手改过 ⇒ 两样都不画）',
  );

  /* ---- 51c：A8 的两支空态（未绑定 / 已绑未勾）---- */
  /*
   * ⚠️★ 两句必须是**两句不同的话**，而且要**互斥**：判据是"这一支在场 ∧ 另一支不在场"
   *    （只断"某一支在场"的话，一个"两支都画"的实现照样绿 —— 而那时用户会被指去
   *    做一件他做不了的事："去勾一个实例"对一个还没绑启动器的用户是没有那个东西）。
   */
  const noneHtml = launcherBindingHtml({
    state: launcherPanelState({ launchers: [], instances: [] }),
    detected: [],
  });
  assert.ok(
    noneHtml.includes('data-launcher-empty="none"'),
    '51c① 一条绑定都没有 ⇒ 引导去绑定（`data-launcher-empty="none"`）',
  );
  assert.equal(
    noneHtml.includes('data-launcher-empty="untracked"'),
    false,
    '51c① 反面：那一支**不许**同时画"去勾选"（两句话说成一句会把用户指错地方）',
  );
  const untrackedHtml = launcherBindingHtml({
    state: launcherPanelState({
      instances: [PANEL_INSTANCE_CONFIRM, PANEL_INSTANCE_EDITED],
    }),
  });
  assert.ok(
    untrackedHtml.includes('data-launcher-empty="untracked"'),
    '51c② 有绑定、但一个实例都没被勾 ⇒ 引导勾选（`data-launcher-empty="untracked"`）',
  );
  assert.equal(
    untrackedHtml.includes('data-launcher-empty="none"'),
    false,
    '51c② 反面：它**不是**"未绑定"那一支（有绑定就不该再叫人去绑）',
  );
  /* ★ 而"这一版没有被追踪的实例"那第三支是 T7 的（`InstancePicker`，自检 ㊿e）—— 不在这里。 */
  ok('51c A8 的两支空态（未绑定启动器 / 已绑但一个实例都没勾）各自在场、而且互斥');

  /* ---- 51d：A14 —— 逐块失败 + 重试（一个块坏掉不许整页空）---- */
  const brokenHtml = launcherBindingHtml({
    state: launcherPanelState({
      launchers: [BINDING_BROKEN, BINDING_OK],
      instances: [PANEL_INSTANCE_TRACKED],
    }),
    detected: [],
  });
  const brokenBlock = launcherBlockSpanOf(brokenHtml, BINDING_BROKEN.id);
  assert.ok(
    brokenBlock.includes(BLOCK_ERROR),
    '51d 坏掉的那一块要画出**那句原话**（主进程写的失败原因照带，不是"出错了"这种自己编的话）',
  );
  assert.ok(
    /data-action="probe-launchers"/.test(brokenBlock),
    '51d 而它带一颗重试按钮（再枚举一遍 / 再扫一次候选）',
  );
  const healthyBlock = launcherBlockSpanOf(brokenHtml, BINDING_OK.id);
  assert.equal(
    /data-action="probe-launchers"/.test(healthyBlock),
    false,
    '51d 反面：**没坏**的那一块不带那颗按钮（它没有要重试的东西）',
  );
  assert.ok(
    healthyBlock.includes(`data-instance-row="${PANEL_INSTANCE_TRACKED.key}"`),
    '51d ★ 而它**照常渲染**：另一个块坏掉时，好的那一块的实例行必须还在（整页空 = A14 要防的那件事）',
  );
  ok('51d A14：坏掉的那一块画出原话 + 一颗重试，而**别的块照常渲染**（一个块坏掉不许整页空）');

  /* ---- 51e：A15 —— 浏览器 / 老桌面壳里那一句 + 装桌面版的引导 ---- */
  /*
   * ⚠️★★ 这一支的**边界**（如实写，不粉饰）：产品里它**够不到** —— 页面在
   *    `useModFolders().status === 'unavailable'` 时整页只画 `ModFoldersUnavailable`
   *    （`data-mod-folders="unavailable"`，老壳一个 tab 都不画），而 launchers 那一格
   *    只在 `loading` / `failed` / `ready` 三态里画（前两态各有自己的载荷）。
   *    ⇒ 它是**组件契约**上的一支（`state === null` ⇒ 这个客户端给不出那份状态），
   *    由自检**直接渲染**钉住；A15 的**页面级**那一半在 ㉕ 与 ㊾d/㊾h。
   * ⚠️★ 而它画的必须是**同一条词条**（`files.partTwoUnavailable`）—— T6 的注释明确写过
   *    "这里不需要、也不该再写一句'需要桌面版'（两处说法会漂）"：语句只有一份，
   *    两个渲染点共用它（`resolved()` 那条针孔探针保证它真的解析出了译文）。
   */
  const needDesktopHtml = launcherBindingHtml({ state: null, detected: null });
  assert.ok(
    needDesktopHtml.includes('data-launcher-needs-desktop="yes"'),
    '51e `state === null` ⇒ 这一格说的是"需要在桌面版里绑定"',
  );
  assert.ok(
    textOf(needDesktopHtml).includes(textOf(resolved('files.partTwoUnavailable'))),
    '51e 而且用的就是**页面那条词条**（不是第二句"需要桌面版" ⇒ 两处说法不会漂）',
  );
  for (const forbidden of [
    'data-instance-row=',
    'data-instance-mods=',
    'data-instance-saves=',
    'data-instance-tracked=',
    'data-launcher-block=',
    'data-launcher-empty=',
    'data-launcher-candidate=',
    'data-action="probe-launchers"',
    'data-action="add-launcher"',
  ]) {
    assert.equal(
      needDesktopHtml.includes(forbidden),
      false,
      `51e 而**别的什么都不画**：产物里不许出现 \`${forbidden}\``,
    );
  }
  /*
   * ⚠️ "装桌面版的引导"那一半只能读**源码形状**：`<DesktopDownload />` 在静态渲染下
   *    恒画 `null`（它自己 `if (desktopBridge()) return null;`，而自检里没有 preload、
   *    `/api/desktop/release` 那一次取数也不跑）⇒ 产物上**没有任何东西**可断。
   *    ⚠️ 它断的是"**用的是现成那个组件**"（页面在浏览器那一支用的就是它），
   *    不是"这一刻画出来了"。
   */
  const panelSource = withoutComments(
    readFileSync(new URL('../src/components/LauncherBindingPanel.tsx', import.meta.url), 'utf8'),
  );
  assert.ok(
    panelSource.includes('<DesktopDownload'),
    '51e 装桌面版的引导用的是**现成的那个组件**（`DesktopDownload`，与页面浏览器那一支同源）',
  );
  ok(
    '51e A15：`state === null` ⇒ 只有"需要在桌面版里绑定"那一句 + 装桌面版的引导（其余一个字节都不画）',
  );

  /* ---- 51f：候选（只列命中的）+ 手动添加（永远在的那条路）---- */
  assert.equal(
    countOf(panelHtml, 'data-launcher-candidate="'),
    CANDIDATES.length,
    '51f **只列命中的**：候选表里一条命中一行（多一行就会让人去加一个不存在的根）',
  );
  assert.ok(
    panelHtml.includes(`data-launcher-candidate="${CANDIDATES[0].kind}:${CANDIDATES[0].rootPath}"`),
    '51f 那一行的身份是"类型 + 根"（`addLauncher(kind, rootPath)` 的两个入参）',
  );
  assert.ok(
    panelHtml.includes('data-launcher-manual="yes"'),
    '51f 而"手动添加"（选类型 + 填路径）**永远在**——探测只是候选，spec §6 那条"手动指定根必须一直在"',
  );
  const noCandidateHtml = launcherBindingHtml({ detected: [] });
  assert.equal(
    countOf(noCandidateHtml, 'data-launcher-candidate="'),
    0,
    '51f 反面：一条都没命中 ⇒ 候选表一行都不画',
  );
  assert.ok(
    noCandidateHtml.includes('data-launcher-manual="yes"'),
    '51f 反面：而"手动添加"照旧在（那是"一个都没命中"时唯一的出路）',
  );
  ok('51f 候选只列命中的那几条（每条一颗「添加」），一条都没命中时只剩"手动添加"');

  /* ---- 51g：接线（源码形状）——七个动作各接哪条通道，以及 T7 交接的那颗坏按钮 ---- */
  /*
   * ⚠️★ 静态渲染**不跑处理器**，所以"按下去走哪条通道"只能读源码形状；而**第一道**守卫
   *    其实是 `tsc`：`makeModPageAction` 那个 `const never: never = action` 会让"加了成员
   *    却忘了处理"在编译期红（实测过，见那个函数头）。这里断的是**更强**的那半句：
   *    每一支**接的是哪一条通道**（漏了不会红，接错了才会 —— 而接错的表现是"点了没反应"
   *    或"点 A 做了 B"，两者都不会有任何门禁出声）。
   * ⚠️★ 表驱动：`(kind, 那一支里必须出现的那次调用)`。把任何两行对调 ⇒ 当场红。
   */
  const WIRING: readonly (readonly [string, string])[] = [
    ['select-launcher-root', 'handlers.selectLauncherRoot(action.id, action.rootPath)'],
    ['add-launcher', 'handlers.addLauncher(action.launcherKind, action.rootPath)'],
    ['remove-launcher', 'handlers.removeLauncher(action.id)'],
    ['set-instance-paths', 'handlers.setInstancePaths(action.key,'],
    ['confirm-instance', 'handlers.confirmInstance(action.key)'],
    ['set-instance-tracked', 'handlers.setInstanceTracked(action.key, action.tracked)'],
    ['probe-launchers', 'handlers.probeLaunchers()'],
  ];
  for (const [kind, call] of WIRING) {
    const start = filesRouteCode.indexOf(`case '${kind}':`);
    assert.notEqual(
      start,
      -1,
      `51g \`makeModPageAction\` 里没有 \`case '${kind}':\` 那一支（那个动作发出去没人接）`,
    );
    const next = filesRouteCode.indexOf('case ', start + 1);
    const branch = filesRouteCode.slice(start, next === -1 ? undefined : next);
    assert.ok(
      branch.includes(call),
      `51g \`${kind}\` 那一支接的必须是 \`${call}\`（现读那一支：${branch.slice(0, 120)}…）`,
    );
  }
  /*
   * ★★ T7 交接给 T8 的那颗**坏按钮**（控制器裁定 (b)）：「解绑」原来发 `unbind-folder`，
   *    而主进程的 `unbindFolder` 只是 `delete state.folders[id]` ⇒ 下一趟对账又长回来
   *    （用户看到的是"点了像成功、状态自己回来"）。计划 `:1280-1283` 点名改成
   *    `set-instance-tracked(key, false)`。⚠️ 这一条**只能**读源码形状：
   *    那颗按钮在 `VersionFolderList` 里（不是本任务的 in-scope 文件）⇒ 改的是**接缝**
   *    （`folderId` 就是 `instance.key`，spec §7 ⇒ 两个入参是同一个字符串）。
   */
  const unbindStart = filesRouteCode.indexOf("case 'unbind-folder':");
  assert.notEqual(unbindStart, -1, "51g 找不到 `case 'unbind-folder':` 那一支（锚点没了）");
  const unbindNext = filesRouteCode.indexOf('case ', unbindStart + 1);
  const unbindBranch = filesRouteCode.slice(
    unbindStart,
    unbindNext === -1 ? undefined : unbindNext,
  );
  assert.ok(
    unbindBranch.includes('handlers.setInstanceTracked(action.folderId, false)'),
    '51g ★ 「解绑」那一颗现在发的是**取消追踪**（写 `instancePrefs[key].tracked = false`）',
  );
  assert.equal(
    unbindBranch.includes('unbindFolder'),
    false,
    '51g ★ 反面：它**不再**发 `unbindFolder` —— 那一条写的是**派生结构**（`delete folders[id]`），' +
      '下一趟对账会把它长回来（"点了像成功、状态自己回来"）',
  );
  assert.ok(
    pageShellOf('d1').includes('data-tab-panel="launchers"'),
    '51g ★ T6 留下的那个钩子还在：`Files.tsx` 的 launchers 那一支仍然画着 `data-tab-panel="launchers"`',
  );
  ok(
    '51g 接线：七个动作在 `makeModPageAction` 里各接一条通道（表驱动），' +
      '而「解绑」那一颗改发取消追踪（T7 交接的坏按钮）',
  );
}

const expectedGroups = LANG === 'en' ? 46 : 45;
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
console.log(
  '     · tab 那三颗按钮**点下去之后**换的是哪一块（tab 条是页面外壳的 useState，静态渲染只画得到默认那一态；',
);
console.log(
  '       ⚠️ T6 修复轮改准：⑰/㉝ 现在钉的是"默认选中哪一格"（㉝ 第一条 + ㊾a/㊾b）与"三支各画什么载荷"',
);
console.log(
  '       （源码形状 + 那一格的载荷渲染），**不再**声称"整页第一帧就是正在扫描…"——那条被 A8 的默认 tab 规则否掉了）；',
);
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
