#!/usr/bin/env tsx
/**
 * 角色说明页（`/account` 的 `RoleGuide`）的渲染断言。
 *
 * 跑法（从仓库根）：
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:roleguide
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:roleguide -- --en
 *
 * ---------------------------------------------------------------------------
 * 为什么单独一个脚本
 * ---------------------------------------------------------------------------
 * `RoleGuide` 在这之前**没有被任何自检覆盖**：`check:grid` 验网格与卡片、
 * `check:live` 验直播卡、`check:authoring` 验一句文案的映射 —— 它们都不渲染
 * `/account`。而这一页恰恰是**全仓唯一一处"一整张用户可见文案挂在动态 key 上"**：
 *
 *     t(CAP_DESC[capability] ?? '') || action.label
 *
 * 少一行、或 key 里打错一个字母，**都不会报错**：要么安静地退化成短标签，
 * 要么直接显示原始 key。逐字面量 grep 词条 key 的守卫（`i18n-keys.test.ts`）
 * 看不到这种间接引用 —— 这是本仓反复记档的形状（`RANK_NOTES` 那次就是这么漏的，
 * 注释还在组件里）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 这一页原本是**中文写死在组件里**的（`CAP_TEXT`）
 * ---------------------------------------------------------------------------
 * 2026-09-13 迁进 `packages/shared/src/i18n/` 之前，`CAP_TEXT` 里那 14 条只有中文 ——
 * 也就是说**英文界面下角色说明是整段中文**。搬家之后，"英文界面里还有没有中文"
 * 这件事必须有人守着，否则下次再加一条又会漏。
 * ⇒ 下面第 ④ 条：**英文模式下渲染结果里零汉字**。
 */
import assert from 'node:assert/strict';
import { en, zhCN } from '@mcsr/shared/i18n';
import i18n from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';

import { RoleGuide } from '@/components/RoleGuide';

const LANG = process.argv.includes('--en') ? 'en' : 'zh-CN';

await i18n.init({
  lng: LANG,
  fallbackLng: false,
  resources: { 'zh-CN': { translation: zhCN }, en: { translation: en } },
  interpolation: { escapeValue: false },
});

/*
 * ⚠️ 这里刻意**不用 JSX**，用 `createElement`：
 *    本文件的 JSX 会走 **classic runtime**（`scripts/**` 不在 `tsconfig` 的 `include` 里，
 *    所以 `jsx: react-jsx` 对 tsx 不生效）⇒ 必须 `import React from 'react'`，
 *    而 biome 的 `noUnusedImports` 会把它判成**未使用**并提供一个**不安全的自动修复** ——
 *    谁点了那个修复，脚本就会在运行时 `ReferenceError: React is not defined`。
 *    用 `createElement` 既能显式用上 React、又不依赖 JSX 变换，两边都干净。
 *    （`gridrender.tsx` / `liverender.tsx` 同样必须 import React，只是它们另外
 *      显式用到了 `React.`，所以不会触发那条警告。）
 */
const html = renderToStaticMarkup(
  createElement(I18nextProvider, { i18n }, createElement(RoleGuide)),
);

/** 标签剥掉、实体还原、空白压掉 —— 只比较"人看到的那串字"。 */
const decode = (s: string) =>
  s
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
const norm = (s: string) => decode(s).replace(/\*\*/g, '').replace(/\s+/g, '');
const text = norm(html.replace(/<[^>]+>/g, ' '));

const dict = (LANG === 'en' ? en : zhCN) as unknown as { auth: Record<string, string> };
const descs = Object.entries(dict.auth).filter(([k]) => k.startsWith('capDesc'));

/** ① 这条永远先跑：条数为 0 的话下面三条会**全部空转通过**。 */
assert.ok(descs.length > 0, '字典里一条 capDesc* 都没有 —— 下面的断言等于没验');
console.log(`✓ 字典里有 ${descs.length} 条能力说明`);

/** ② 不许出现裸 key（打错一个字母就会以 `auth.capDescXxx` 的形式露出来）。 */
const leaked = [...new Set(html.match(/auth\.[A-Za-z]+/g) ?? [])];
assert.deepEqual(leaked, [], `裸 key 泄漏：${leaked.join(', ')}`);
console.log('✓ 没有词条 key 泄漏');

/** ③ 每条说明都**真的渲染出来了** —— 不是"没泄漏"就算过（那可能只是没渲染）。 */
const missing = descs.filter(([, v]) => !text.includes(norm(v)));
assert.deepEqual(
  missing.map(([k]) => k),
  [],
  `这些词条没有出现在渲染结果里（key 打错？还是那个能力没被任何角色覆盖？）：${missing.map(([k]) => k).join(', ')}`,
);
console.log(`✓ ${descs.length} 条能力说明全部来自词条`);

/** ④ 强调标记必须被 `em()` 处理掉。 */
assert.ok(!text.includes('**'), `渲染结果里有字面 ** ：${html.slice(0, 200)}`);
console.log('✓ `**` 强调已被 em() 处理（没有字面星号）');

/** ⑤ ★ 英文模式：整页不许出现汉字（这条就是这次搬家的目的）。 */
if (LANG === 'en') {
  const han = text.match(/[\u4e00-\u9fff]+/g) ?? [];
  assert.deepEqual(han, [], `英文界面里出现了中文：${han.slice(0, 8).join(' / ')}`);
  console.log('✓ 英文界面里零汉字');
}

console.log(`\n【${LANG}】角色说明页渲染自检通过。`);
