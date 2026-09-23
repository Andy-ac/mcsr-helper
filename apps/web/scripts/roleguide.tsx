#!/usr/bin/env tsx
/**
 * 角色说明页（`/me` 的 `RoleGuide`）的渲染断言。
 * ⚠️ 路由是 `/me`（`apps/web/src/App.tsx` 的 `<Route path="/me" element={<Account />} />`），
 *    这一段原来写的是 `/account` —— 那个地址**不存在**（改名那一轮漏改的四处之外剩下的一处）。
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
 * `/me`。而这一页恰恰是**全仓唯一一处"一整张用户可见文案挂在动态 key 上"**：
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
import { CAPABILITIES } from '@mcsr/shared/permissions';
import i18n from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';

import { CAP_DESC_COVERED, RoleGuide } from '@/components/RoleGuide';
import { capabilitiesWithInheritedActionLabel, capabilityLabelKeys } from '@/lib/capabilities';

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
/**
 * ⚠️ `norm()` 里**多做了一步**："把星号替换成空串"。
 *
 * 那一步是给第 ③ 条用的：它拿**词条原文**（里面写着 `**`）去比页面上的字，
 * 两边都得先把标记擦掉才比得齐。所以 `norm()` 本身**不该动**。
 *
 * ⚠️⚠️ 但也正因为那一步，**它不能用来验"页面上没有星号"** ——
 *    擦掉之后的字符串里永远不会有 `**`，第 ④ 条于是**恒真**。
 *    见下面 `textOfUnstripped` 与第 ④ 条的说明。
 */
const norm = (s: string) => decode(s).replace(/\*\*/g, '').replace(/\s+/g, '');
const text = norm(html.replace(/<[^>]+>/g, ' '));

/**
 * ★ 与 `norm()` 同一条提取链路，**但不擦星号** —— 专门用来问"页面上有没有字面 `**`"。
 *
 * 提取链路必须与 `norm()` 一致（同样剥标签、同样还原实体、同样压空白），
 * 否则两者看到的就不是同一串字，"没有星号"这句话也就无从谈起。
 */
const textOfUnstripped = (markup: string) =>
  decode(markup.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, '');
const unstripped = textOfUnstripped(html);

const dict = (LANG === 'en' ? en : zhCN) as unknown as { auth: Record<string, string> };
const descs = Object.entries(dict.auth).filter(([k]) => k.startsWith('capDesc'));

/**
 * 词条取值（当前语言）。
 *
 * ⚠️ 第 ⑥ 条的"能解析"判据**就建立在 `t()` 的这个性质上**：查不到的 key
 *    不抛错、**原样返回 key** ⇒ `t(key) === key` 就是"这条词条不存在"。
 *    （本仓为此吃过一次亏：界面上一串 `moderate.gone`，而所有门禁都绿。）
 */
const t = (key: string): string => i18n.t(key) as string;

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

/**
 * ④ ★★ 强调标记必须被 `em()` 处理掉。
 *
 * ⚠️⚠️ 2026-09-14：这一条**曾经是恒真的**（本仓"门禁绿但什么都没验"那一族，
 *    记档见 `docs/pending.md §5.63`）——
 *    它当时写的是 `!text.includes('**')`，而 `text` 是 `norm(...)` 的结果，
 *    也就是**已经被"把星号替换成空串"那一步擦过一遍**的字符串 ⇒ 永远不含 `**`。
 *
 *    实测（2026-09-14，两次只差这一条断言）：
 *      · 把 `RoleGuide.tsx` 里 `em(t(RANK_NOTES[role]))` 改成裸的 `t(...)`
 *        （页面上**真的**会印出 3 个带星号的等级说明）⇒
 *        **旧断言照样全绿、脚本 exit 0**；
 *      · 换成下面这条之后再跑同一个改动 ⇒ 当场红。
 *    ⇒ 教训：**先擦掉要断言的东西，再断言它不存在**，是这类守卫最隐蔽的失效方式
 *      （同一个形状还有 `roleguide` 之外的地方要留意）。
 *
 * ⚠️ 所以这里换用 `unstripped`（同一条提取链路，**不擦星号**）。两个探针跟着钉住
 *    "两份文本的差别就是擦星号这一步"：少了它们，"这条断言有没有在验东西"
 *    又要靠人去读实现。
 */
assert.equal(
  norm('a**b**c').includes('**'),
  false,
  '探针：`norm()` 会擦掉星号 —— 这正是旧写法恒真的原因（留着当对照，别删）',
);
assert.equal(
  textOfUnstripped('a**b**c').includes('**'),
  true,
  '探针：`textOfUnstripped()` 必须**看得见**星号 —— 否则第 ④ 条还是恒真的',
);
assert.equal(
  unstripped.includes('**'),
  false,
  `★★ 渲染结果里有字面的 \`**\`（强调没走 em()）：${unstripped.slice(0, 200)}`,
);
console.log('✓ `**` 强调已被 em() 处理（没有字面星号）');

/** ⑤ ★ 英文模式：整页不许出现汉字（这条就是这次搬家的目的）。 */
if (LANG === 'en') {
  const han = text.match(/[\u4e00-\u9fff]+/g) ?? [];
  assert.deepEqual(han, [], `英文界面里出现了中文：${han.slice(0, 8).join(' / ')}`);
  console.log('✓ 英文界面里零汉字');
}

/**
 * ⑥ ★★ **每一个能力在界面上都必须显示成它自己的名字**（2026-09-15 新增）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 由头是一件**已经发生**的事，不是假想
 * ---------------------------------------------------------------------------
 * `share.moderate` 加进权限矩阵（Task 1）时，**没有人**给它加界面词条 ——
 * 于是它在账号页和这一页上显示成「**管理身份组**」：一条他并没有的权限。
 * 而那时**每一条门禁都是绿的**，因为这个脚本当时只断言"字典里的词条渲染得出来"
 * （上面第 ③ 条）—— "**每个能力都有词条**"从来没有人守过：
 * 它只是看起来像文案不对。
 *
 * ---------------------------------------------------------------------------
 * ★ 守卫走 UI 真正走的那条路
 * ---------------------------------------------------------------------------
 * `capabilityLabelKeys()` 就是 `describeCapabilities()` 内部用的那一个函数
 * （不是这里另抄一份表）：抄一份的守卫会和那两张表一起漂移，
 * 而漂移的守卫是假守卫。`CAP_DESC` 那一半同理，用的是 `RoleGuide` 导出的
 * `CAP_DESC_COVERED`（第 ⑦ 条）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 三条判据各守一半，少一条都留一个洞（下面用 a / b / c 标，避免与全脚本的 ①–⑦ 撞号）
 * ---------------------------------------------------------------------------
 *   a. **非空**   —— 表里没有 ⇒ 界面上退化成英文（`share` / `moderate`）；
 *   b. **能解析** —— 非空但打错一个字母 ⇒ 界面上显示**原始 key**（`t()` 对未知 key
 *                   不抛错、原样返回 key，所以它看起来像"界面没做完"）；
 *   c. **不撞名** —— 见下面那条：它才是 `CAP_OVERRIDES` 里那一行的守卫。
 *
 * ⚠️⚠️ **只有 a / b 的话，把 `CAP_OVERRIDES` 里 `'share.moderate'` 删掉，这里照样全绿** ——
 *    因为 `ACTION_KEYS.moderate` 兜得住它（退化成「管理身份组」而**不是**空）。
 *    ⇒ c 是"这条守卫真的能发现它声称要发现的那个缺陷"的唯一依据。
 */
const missingTypeKey = CAPABILITIES.filter((cap) => capabilityLabelKeys(cap).typeKey === null);
const missingActionKey = CAPABILITIES.filter((cap) => capabilityLabelKeys(cap).actionKey === null);
assert.deepEqual(
  missingTypeKey.map((cap) => `能力 ${cap} 在 TYPE_KEYS 里没有条目 —— 界面会把它显示成英文`),
  [],
  '这些能力没有**类型**词条：账号页会把类型那一半显示成英文（`share`），而旁边的项都是中文。' +
    '补在 `apps/web/src/lib/capabilities.ts` 的 `TYPE_KEYS` 与两本字典里。',
);
assert.deepEqual(
  missingActionKey.map(
    (cap) => `能力 ${cap} 在 CAP_OVERRIDES / ACTION_KEYS 里没有条目 —— 界面会把它显示成英文`,
  ),
  [],
  '这些能力没有**动作**词条：界面上会显示英文动作名（`moderate`）。' +
    '补在 `apps/web/src/lib/capabilities.ts` 的 `ACTION_KEYS`（通用标签）或 `CAP_OVERRIDES`' +
    '（消歧，按完整能力名）里，词条补进两本字典。',
);

/** b. 非空还不够：那个 key 必须**真的解析出译文**（打错一个字母就退回原始 key）。 */
const unresolved: string[] = [];
for (const cap of CAPABILITIES) {
  const { typeKey, actionKey } = capabilityLabelKeys(cap);
  if (typeKey !== null && t(typeKey) === typeKey) {
    unresolved.push(`能力 ${cap} 的 TYPE_KEYS 指向 ${typeKey}，但字典里没有这条词条`);
  }
  if (actionKey !== null && t(actionKey) === actionKey) {
    unresolved.push(`能力 ${cap} 的 ${actionKey} 不在字典里`);
  }
}
assert.deepEqual(
  unresolved,
  [],
  `这些能力的界面词条 key **解析不出来**（i18next 对未知 key 不抛错，而是把 key 原文显示出来）——` +
    ` 于是界面上会印着一串 key：\n${unresolved.join('\n')}`,
);

/**
 * c. ★★ 撞名：动作名一旦被消歧，用同一个动作名的**每一个**能力都必须有自己的条目。
 *
 * ⚠️ 判据（以及"为什么不能简单地要求不同能力不许共用动作词条"）写在
 *    `capabilities.ts` 的 `capabilitiesWithInheritedActionLabel()` 上面。
 *    ⚠️ 下面两条**探针**是这条断言的地基：没有它们，"这个检查能不能发现问题"
 *    又要靠人去读实现（本仓老规矩，来历见第 ④ 条那段注释）。
 */
const inheritedActionLabel = capabilitiesWithInheritedActionLabel();
assert.deepEqual(
  inheritedActionLabel,
  [],
  `这些能力的动作名在**别的能力**上已经有了自己的词条，而它们还在用兜底 ⇒ ` +
    `界面上会显示成**别人的权限名**（看起来完全正常，所以没人会发现）：` +
    `${inheritedActionLabel.join(', ')}。\n` +
    '处置：在 `apps/web/src/lib/capabilities.ts` 的 `CAP_OVERRIDES` 里按**完整能力名**' +
    '给它们各加一行，并在两本字典里补上对应词条。',
);
/*
 * 探针 A（它必须**能**报）：喂一份只消歧了 `resource.moderate` 的表，
 * 另外两个 moderate 就必须被点名。⚠️ 用 `includes` 而不是整份列表相等 ——
 * 将来再加第四个 moderate 时，这条探针不该因为"多了一行"而红。
 */
const probeCollision = capabilitiesWithInheritedActionLabel(CAPABILITIES, {
  'resource.moderate': 'auth.capActionModerateContent',
});
assert.ok(
  probeCollision.includes('share.moderate') && probeCollision.includes('user.moderate'),
  `撞名检查本身必须**能**发现问题（喂一份只消歧了 resource.moderate 的表，` +
    `必须点名 share.moderate 与 user.moderate）—— 实际报出：` +
    `${probeCollision.join(', ') || '(一个都没有)'}`,
);
/*
 * 探针 B（它必须**不**乱报）：`submit` 这一组没有任何人被消歧 ——
 * 「资源库 · 提交」「日历 · 提交」共用一个动作词条是**设计如此**（那正是两张表拼标签的初衷）。
 */
assert.deepEqual(
  capabilitiesWithInheritedActionLabel(['resource.submit', 'calendar.submit', 'video.submit'], {}),
  [],
  '撞名检查误报了：submit 这一组没有任何人被消歧，全组共用「提交」是对的',
);
console.log(`✓ ${CAPABILITIES.length} 个能力的类型 / 动作词条都在，且没有谁在用别人的标签`);

/**
 * ⑦ ★ 每个能力都要有**一句完整说明**（`CAP_DESC`），而不是只靠那个短标签。
 *
 * ⚠️ 这一条**比看起来难**：`RoleGuide` 渲染的是
 *    `t(CAP_DESC[cap] ?? '') || action.label` ⇒ 缺条目**不会**显示空白，
 *    而是退回到短标签（「资源库 · 提交」），所以**页面上看起来很正常** ——
 *    判据不能是"页面上有字"（第 ③ 条那种），只能是"这张表覆盖了它"。
 *
 * ⚠️★ 现读 `RoleGuide.tsx` 之后的事实（与"每个能力都有说明"这个直觉**相反**）：
 *    今天有**两个**能力**刻意**没有完整说明，靠短标签兜底 ——
 *    `content.author`（渲染成「内容 · 直接编辑内容」）与 `live.manage`（「直播清单 · 维护」）。
 *    给它们补一条 desc 要新增两条词条，而那两条**不在本轮冻结的 i18n 清单里**
 *    （本轮只加 `shares.*` 与三条 `auth.cap*`）。⇒ 所以这里**点名登记**这两个，
 *    而不是把断言放宽成"页面上有字就行"：
 *    下一个能力如果既没有 desc、也不在下面这张名单里，这里会当场红并点名。
 */
const DESC_FALLBACK_OK: ReadonlySet<string> = new Set(['content.author', 'live.manage']);
const uncoveredCapabilities = CAPABILITIES.filter(
  (cap) => !CAP_DESC_COVERED.has(cap) && !DESC_FALLBACK_OK.has(cap),
);
assert.deepEqual(
  uncoveredCapabilities.map(
    (cap) => `能力 ${cap} 在 RoleGuide 的 CAP_DESC 里没有条目，也不在 DESC_FALLBACK_OK 名单里`,
  ),
  [],
  '这些能力在角色说明页上只会显示一个短标签（`CAP_DESC` 缺条目会**安静地**退回到它）—— ' +
    '要么给 `RoleGuide.tsx` 的 `CAP_DESC` 加一行（并在两本字典里补词条），' +
    '要么在 `DESC_FALLBACK_OK` 里写明为什么短标签就够了。',
);
/** 反向：`CAP_DESC` 里的名字必须是**真的能力**（打错一个字母就永远不会被渲染）。 */
const staleCapDesc = [...CAP_DESC_COVERED].filter(
  (cap) => !(CAPABILITIES as readonly string[]).includes(cap),
);
assert.deepEqual(
  staleCapDesc,
  [],
  `RoleGuide 的 CAP_DESC 里这些名字在权限矩阵里**不存在**（打错了？能力被改名了？）——` +
    ` 它们永远不会被渲染：${staleCapDesc.join(', ')}`,
);
console.log(
  `✓ ${CAP_DESC_COVERED.size} 个能力有完整说明（另有 ${String(DESC_FALLBACK_OK.size)} 个刻意用短标签兜底）`,
);

console.log(`\n【${LANG}】角色说明页渲染自检通过。`);
