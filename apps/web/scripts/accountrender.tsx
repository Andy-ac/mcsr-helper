#!/usr/bin/env tsx
/**
 * 账号页「改我的昵称」的渲染自检 + 本地校验判据（2026-09-23 新增）。
 *
 * 跑法（从仓库根）：
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:account
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:account -- --en
 *
 * ---------------------------------------------------------------------------
 * 为什么账号页**必须**有自己的自检（而不是并进别的脚本）
 * ---------------------------------------------------------------------------
 * 在这之前账号页（真实路由是 `/me` —— `App.tsx` 里那句
 * `<Route path="/me" element={<Account />} />`）没有任何渲染覆盖。
 * ⚠️ 但它**不是唯一**一个没有覆盖的页面（这里原来写的是"唯一"，是错的）：
 * `apps/web/scripts/` 里 import 过 `@/routes/...` 的只有四个文件
 * （`homerender` → `Home`、`resourcerender` → `ResourceDetail`、`videorender` → `Videos`、
 * 本脚本 → `Account`）⇒ `Login` / `Register` / `PasswordReset` / `NotFound` 今天
 * **同样**没有 —— 这是现读那四个 import 数出来的。
 * 唯一沾到边的是 `roleguide.tsx`，它只渲染 `RoleGuide` 那一块组件（不是整页）。于是账号页上的
 * 任何改动都只有"类型检查过得了"这一层 —— 那是最弱的一层：
 * **词条打错一个字母、块整个没渲染、初值传空**，它一条都看不见
 * （i18next 对未知 key 不报错，原样把 key 显示出来）。
 *
 * ---------------------------------------------------------------------------
 * 守的十件事（每一件都对应一种"门禁全绿但界面是坏的"；序号与正文里的 ①…⑩ 一一对应，
 * 第十件只在 `--en` 那一遍跑）
 * ---------------------------------------------------------------------------
 *   ① **入口在**：整页渲染（真的 `Account`，注入一个已登录用户）里必须有「修改」
 *      那颗按钮、必须显示当前昵称、而且**收起态不许出现「保存」** ——
 *      最后那一条是反面的：不写它的话，"进来就是编辑态"（用户没点就看见一个输入框、
 *      还以为自己的昵称丢了）照样能过。
 *   ② **初值**：编辑态必须带着**当前昵称**打开（空输入框 = 用户以为自己名字没了）。
 *      直接喂 props 渲染 `DisplayNameField`：展开是**交互**，静态渲染里到不了。
 *   ③ **本地校验**：太短与太长必须是**两句不同的**译文，而且恰好在下界/上界上的输入要**放行**
 *      （否则判据退化成"凡输入都报错"）。
 *   ④ **错误那句真的画在表单里**，而且报"太短"时不会同时冒出"太长"那一句。
 *   ⑤ **服务端 400 那句**走既有映射 —— 如实记录现状（那一条**看不到服务端**，见 ⑤ 的说明）。
 *   ⑥ **成功后那句话**：必须真的渲染出来，而且不能与错误那几句是同一句。
 *   ⑦ **「昵称会公开显示」在收起态就说**（只有改完才说 = 用户是在不知情的情况下改了一次资料）。
 *   ⑧ **裸 key 泄漏**：词条打错一个字母就会以 `auth.xxx` 的形式露在界面上；这一节自带两条
 *      探针，把**扫描器本身**夹住（见 ⑧ 的说明）。
 *   ⑨ ★ 一条**读源码**的守卫：改名成功后必须把新用户塞回 `useAuth` 的缓存
 *      （页头才会立刻换名字；见下面单独那一节）。
 *   ⑩ **英文那一遍整页零汉字**。
 *
 * ---------------------------------------------------------------------------
 * ⚠️★ 一条**读源码**的守卫：改名成功后必须把新用户塞回 `useAuth` 的缓存
 * ---------------------------------------------------------------------------
 * 用户的要求是"改名之后**页头立刻**显示新名字，不要让人自己刷新"。那一半是
 * **交互 + 全局状态**：`renderToStaticMarkup` 不跑事件处理器、也没有第二次渲染，
 * 静态渲染**证明不了**它（写完就说是好的，正是本仓反复在治的那种假绿）。
 * ⇒ 所以这里退一步，钉**它成立的前提**：`Account.tsx` 的成功分支里必须出现
 *   `setUser(res.user)`（剥掉注释之后按源码形状找）—— 少了这一句，页头就永远
 *   显示旧名字，直到用户自己刷新。这是**回归守卫**，不是行为证明（边界写在末尾）。
 *
 * ---------------------------------------------------------------------------
 * 覆盖边界（写清楚，免得下一个人高估它）
 * ---------------------------------------------------------------------------
 * ⚠️ 没有点击、没有请求、没有真实浏览器：
 *   · 点「修改」会不会真的展开（只验到"把 `editing` 给成 true 会渲染成什么样"）；
 *   · 点保存会不会真的发 `PATCH /api/auth/me`（`renderToStaticMarkup` 一行事件处理器都不跑）；
 *   · 页头（`Layout.tsx`）在 `setUser` 之后会不会真的换名字 —— 见上面那条源码守卫；
 *   · 服务端 400 的真句子（这里喂的是**构造出来的** `ApiError`，不是真的请求）；
 *   · 用户在编辑框里继续打字会不会真的把上一次那句红字擦掉（`onChange` 也是事件处理器，
 *     `DisplayNameField` 的 `onDirty` 就是为它加的 —— 但这里一行都不跑）。
 *   这些都写在脚本末尾的输出里（那份清单说的是"至少这几样"，不是全部边界）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
  UpdateDisplayNameInputSchema,
  type UserSelf,
} from '@mcsr/shared/auth';
import { en, zhCN } from '@mcsr/shared/i18n';
import i18n from 'i18next';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';

import { DisplayNameField, displayNameError } from '@/components/DisplayNameField';
import { ApiError, type FieldIssue } from '@/lib/api';
import { AuthProvider, apiErrorText } from '@/lib/auth';
import { Account } from '@/routes/Account';

const LANG = process.argv.includes('--en') ? 'en' : 'zh-CN';

await i18n.init({
  lng: LANG,
  fallbackLng: false,
  resources: { 'zh-CN': { translation: zhCN }, en: { translation: en } },
  interpolation: { escapeValue: false },
});

/*
 * ⚠️ 刻意**不用 JSX**（用 `React.createElement`），理由与 `roleguide.tsx` /
 *    `homerender.tsx` 相同：`scripts/**` 不在 tsconfig 的 include 里 ⇒ JSX 走
 *    classic runtime ⇒ 必须 `import React from 'react'`，而 biome 的
 *    `noUnusedImports` 会把它判成未使用并提供一个**不安全自动修复** ——
 *    谁点了那个修复，脚本就在运行时崩。
 */
const html = (node: React.ReactElement): string =>
  renderToStaticMarkup(React.createElement(I18nextProvider, { i18n }, node));

/** 标签剥掉、实体还原、空白压掉 —— 只比较"人看到的那串字"。 */
const decode = (s: string) =>
  s
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
const textOf = (markup: string) => decode(markup.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, '');

const t = (key: string, opts?: Record<string, unknown>): string => i18n.t(key, opts) as string;

/**
 * 针孔探针（本仓老规矩）：词条必须**真的解析出译文**，而不是原样返回 key。
 *
 * ⚠️ 为什么每条都要它：缺键时 i18next **原样返回 key**，于是
 *   · 正面断言 `includes(t(key))` 比的是 key 与 key —— 可能照样通过；
 *   · 反面断言（"页面上没有 X"）**直接静默变绿**。
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
 * 注入的已登录用户。
 *
 * ⚠️ 昵称刻意用 **ASCII**：`--en` 那一遍要断言"整页零汉字"，而夹具里的中文
 *    会被算成产品文案（`homerender.tsx` 为同一件事把夹具里的中文排除在扫描之外，
 *    这里更干净的办法是夹具本来就没有中文 —— 那样整页都能扫，不必开豁免）。
 */
const USER: UserSelf = {
  id: 'u-rename',
  displayName: 'SpeedRunner',
  avatarUrl: null,
  role: 'user',
  mcName: null,
  createdAt: 1_756_000_000_000,
  email: 'speedrunner@example.com',
  locale: 'zh-CN',
  emailVerified: true,
  canSubmit: true,
};

/** 整页渲染：真的 `Account`（`AuthProvider` 的 `initialUser` 是给它留的注入点）。 */
const pageHtml = html(
  React.createElement(
    MemoryRouter,
    null,
    React.createElement(AuthProvider, { initialUser: USER }, React.createElement(Account, null)),
  ),
);

console.log(`【${LANG}】账号页 · 改昵称`);

// ---------------------------------------------------------------------------
// ① 入口在（整页）
// ---------------------------------------------------------------------------
const entryText = resolved('auth.nameEditAction');
const pageText = textOf(pageHtml);

assert.ok(
  pageText.includes(textOf(entryText)),
  `★ 账号页上必须有「${entryText}」这个入口 —— 没有它这个功能就只有一个接口`,
);
assert.ok(
  pageHtml.includes('namefield'),
  '★ 昵称那一块必须由 `DisplayNameField` 渲染出来（连它的外壳类都没有 ⇒ 这块根本没画）',
);
assert.ok(
  pageText.includes(textOf(USER.displayName)),
  '★ 账号页必须显示**当前**昵称（用户要先知道自己现在叫什么）',
);
/*
 * ⚠️ 反面：收起态**不许**出现「保存」。
 *    不写这一条的话，"进来就是编辑态"照样能过 —— 而那种界面会让用户
 *    看见一个已经打开的输入框，以为自己的昵称没设置过。
 */
const saveText = resolved('common.save');
assert.equal(
  pageHtml.includes(saveText),
  false,
  `★ 收起态不该出现「${saveText}」（出现 = 用户还没点就已经是编辑态了）`,
);
ok(
  `入口在 + 显示当前昵称 + 收起态没有「保存」（能红证明：喂一份含「${saveText}」的产物会被上面那条拦下）`,
);

// ---------------------------------------------------------------------------
// ② 编辑态：初值 + 「保存」+「取消」
// ---------------------------------------------------------------------------
/**
 * ⚠️ `editing` 从外面给：点「修改」→ 展开是**交互**，`renderToStaticMarkup`
 *    一行事件处理器都不跑（与 `liverender.tsx` 里行内编辑那一节同一条边界）。
 */
function fieldHtml(props: {
  editing: boolean;
  busy?: boolean;
  error?: string | null;
  saved?: string | null;
}): string {
  return html(
    React.createElement(DisplayNameField, {
      current: USER.displayName,
      editing: props.editing,
      busy: props.busy ?? false,
      error: props.error ?? null,
      saved: props.saved ?? null,
      onEdit: () => undefined,
      /*
       * ⚠️ `onDirty` 在这里**永远不会被调用**（静态渲染不跑 `onChange`）—— 它只是为了
       *    props 完整。它接的那件事（用户一打字就擦掉上一次那句红字）属于下面列出的
       *    "没被覆盖"之一，不是这里的判据。
       */
      onDirty: () => undefined,
      onSubmit: () => undefined,
      onCancel: () => undefined,
    }),
  );
}

const editHtml = fieldHtml({ editing: true });
assert.ok(
  editHtml.includes(`value="${USER.displayName}"`),
  `★ 编辑态必须带着当前昵称打开 —— 空输入框会让用户以为自己的名字丢了（找不到 value="${USER.displayName}"）`,
);
assert.ok(editHtml.includes(saveText), '★ 编辑态必须有「保存」');
assert.ok(
  editHtml.includes(resolved('common.cancel')),
  '★ 编辑态必须有「取消」（没有它，改到一半只能刷新页面）',
);
assert.equal(
  editHtml.includes(entryText),
  false,
  '★ 编辑态不该再画那个入口按钮（同一个动作出现两次，用户不知道点哪个）',
);
ok('★ 编辑态：初值 = 当前昵称 + 「保存」+「取消」，且不再画入口');

// ---------------------------------------------------------------------------
// ③ 本地校验：太短 / 太长各说各的话，边界必须放行
// ---------------------------------------------------------------------------
const shortText = resolved('auth.err.nameMin', { min: DISPLAY_NAME_MIN });
const longText = resolved('auth.err.nameMax', { max: DISPLAY_NAME_MAX });

const tooShort = displayNameError('x'.repeat(DISPLAY_NAME_MIN - 1), t);
const tooLong = displayNameError('x'.repeat(DISPLAY_NAME_MAX + 1), t);

assert.equal(tooShort, shortText, `比下限还短时必须是「${shortText}」这一句`);
assert.equal(tooLong, longText, `超过上限时必须是「${longText}」这一句`);
assert.notEqual(
  tooShort,
  tooLong,
  '★★ 两种错误必须**各说各的话** —— 同一句话等于用户不知道该怎么改',
);

/*
 * ⚠️ 边界两条：判据写成 `<=` / `>=` 的错法（"恰好 32 个字符也被拒"）在这里会红。
 *    没有它们的话，一个"凡输入都报错"的实现能通过上面全部断言。
 */
assert.equal(
  displayNameError('x'.repeat(DISPLAY_NAME_MIN), t),
  null,
  `恰好 ${String(DISPLAY_NAME_MIN)} 个字符必须**放行**（否则判据退化成"凡输入都报错"）`,
);
assert.equal(
  displayNameError('x'.repeat(DISPLAY_NAME_MAX), t),
  null,
  `恰好 ${String(DISPLAY_NAME_MAX)} 个字符必须**放行**`,
);
/* ⚠️ 首尾空白不算长度（判据是 trim 之后那串），而**只有空白**必须被拦住。 */
assert.equal(displayNameError('  SpeedRunner  ', t), null, '首尾空白不该让一个合法昵称变短或变长');
assert.notEqual(displayNameError('     ', t), null, '★ 只有空白必须在**本地**就拦住');
assert.notEqual(
  displayNameError('  x  ', t),
  null,
  '★ trim 之后太短的也要拦住（"先补够空白糊过去"这条路不许通）',
);
ok(`★ 太短 / 太长是两句不同的话（「${tooShort}」≠「${longText}」），且上下界恰好放行`);

// ---------------------------------------------------------------------------
// ④ 那两句错误**真的渲染出来了**（在输入框下面）
// ---------------------------------------------------------------------------
const shortHtml = fieldHtml({ editing: true, error: tooShort });
assert.ok(
  textOf(shortHtml).includes(textOf(shortText)),
  '★ 本地那句必须真的渲染在输入框下面 —— 算出来了但没画出来，用户看不到',
);
assert.equal(
  textOf(shortHtml).includes(textOf(longText)),
  false,
  '★ 报"太短"时不该同时出现"太长"那句（两句同时出现 = 用户不知道该改哪边）',
);
ok('★ 错误那句真的渲染在表单里，而且不会同时冒出另一句');

// ---------------------------------------------------------------------------
// ⑤ 服务端 400 那句走**既有**映射 —— 以及它今天说的是什么（描述现状）
// ---------------------------------------------------------------------------
/*
 * ★ 这一段是**如实记录现状**，不是认可它：
 *   服务端的 `issues[]` 只有 `{ field, message }`、**没有 Zod 的 code**
 *   （`services/api/src/routes/auth.ts` 的 `formatIssues`），而
 *   `lib/auth.tsx` 的 `fieldIssueText` 是**按 `code` 分支**的 ⇒ 它落到兜底那句
 *   `auth.err.invalid`，**不是**"昵称至少 2 个字符"。
 *   ⇒ 所以本地那一层（③）不是重复劳动：**具体那句话今天只有它说得出来。**
 *
 * ⚠️★ 这条断言**看不见服务端** —— 这一段原来的说法是反的（原文写着"服务端哪天开始发
 *    code，它会红"），必须改掉：下面那个 `serverIssues` 是**本地构造**的夹具，
 *    本脚本连一个服务端模块都没有 import，服务端把 `issues[]` 改成什么样它都看不到。
 *    ⇒ 把两件事分清：
 *      · 它会红的场合 = **本地这一层**的映射变了（`lib/auth.tsx` 的 `fieldIssueText`
 *        换成按 `field` 分支、或者兜底那句的 key 换了）；
 *      · 它**不会**红的场合 = 服务端开始发 `code`。那件事由**服务端那一侧**的一条断言守着：
 *        `services/api/src/auth/display-name.test.ts` 里钉 `issues[]` **键集**的那一条
 *        （键集一旦多出 `code` 就红）。那条红了，就是回来改这里和
 *        `apps/web/src/components/DisplayNameField.tsx` 里对应说明的信号。
 */
/**
 * 真 schema（`UpdateDisplayNameInputSchema` —— 就是 `PATCH /me` 校验入参的那一个）对
 * "太短"给出的那句 message。
 *
 * ⚠️ 它同时是一条**探针**：`DisplayNameSchema` 哪天不再拒绝 1 个字符（比如 `.min()` 被
 *    拿掉），这里会抛 —— 上面那段说明（"具体那句话今天只有本地这一层说得出来"）
 *    的前提也就当场塌了。
 */
function schemaShortMessage(): string {
  const parsed = UpdateDisplayNameInputSchema.safeParse({
    displayName: 'x'.repeat(DISPLAY_NAME_MIN - 1),
  });
  if (parsed.success) {
    throw new Error(
      `探针：${String(DISPLAY_NAME_MIN - 1)} 个字符必须被 UpdateDisplayNameInputSchema 拒掉` +
        '（它不拒 ⇒ 下面那份夹具的前提不成立，"本地那一层是唯一说得出来的"也就不是事实）',
    );
  }
  const message = parsed.error.issues[0]?.message;
  assert.ok(message, '探针：schema 拒掉时应当给出 message（没有它下面那份夹具是空的）');
  return message;
}

/*
 * 夹具：`message` **从真 schema 取**（见上面几行的 `schemaShortMessage()`），不手抄 ——
 * 手抄的那句话会悄悄与 `packages/shared/src/auth.ts` 漂开，而漂了也没人知道。
 * ⚠️ 但要说清楚：`apiErrorText` → `fieldIssueText` **只读 `field` 与 `code`、完全不读
 *    `message`**。所以这份夹具的 message 取什么值都不影响下面那条断言的结论 ——
 *    它**不是**"服务端会说那句话"的证据，只是让夹具不至于凭空写。
 */
const serverIssues: FieldIssue[] = [{ field: 'displayName', message: schemaShortMessage() }];
const serverText = apiErrorText(
  new ApiError('API 返回 HTTP 400', 400, 'invalid_input', undefined, serverIssues),
  t as unknown as Parameters<typeof apiErrorText>[1],
);

assert.equal(
  textOf(serverText),
  textOf(resolved('auth.err.invalid')),
  '★ 服务端 400 今天落到兜底那句（`auth.err.invalid`）—— 现状；改了就更新这条断言与注释',
);
assert.notEqual(
  textOf(serverText),
  textOf(shortText),
  '⚠️ 服务端那句与本地那句**今天不是同一句**（如实记录，不是设计）',
);
const serverHtml = fieldHtml({ editing: true, error: serverText });
assert.ok(
  textOf(serverHtml).includes(textOf(serverText)),
  '★ 服务端那句也必须真的渲染出来（它走的是同一个 `error` prop）',
);
ok(`★ 服务端 400 那句走既有映射并渲染出来（今天 = 「${serverText}」）`);

// ---------------------------------------------------------------------------
// ⑥ 成功后那句话
// ---------------------------------------------------------------------------
const savedText = resolved('auth.nameSaved');
const savedHtml = fieldHtml({ editing: false, saved: savedText });
assert.ok(
  textOf(savedHtml).includes(textOf(savedText)),
  '★ 改名成功后那句话必须真的画出来（否则用户不知道到底成了没有）',
);
assert.equal(
  pageHtml.includes(savedText),
  false,
  '★ 还没改就说"已更新"是撒谎 —— 收起态（没改过）不许出现那句',
);
for (const [name, errText] of [
  ['太短', tooShort],
  ['太长', tooLong],
  ['服务端兜底', serverText],
] as const) {
  assert.notEqual(
    textOf(savedText),
    textOf(errText),
    `★ 成功那句不能与「${name}」那句是同一句（是同一句 = 成了也像失败）`,
  );
}
ok(`★ 成功那句「${savedText}」画得出来，而且没改之前不会出现`);

// ---------------------------------------------------------------------------
// ⑦「昵称会公开显示」那句必须在**收起态**就说
// ---------------------------------------------------------------------------
const publicNote = resolved('auth.namePublicNote');
assert.ok(
  textOf(pageHtml).includes(textOf(publicNote)),
  '★ 这句必须在页面上无条件出现（只有改完才说 = 用户在不知情的情况下改了一次资料）',
);
ok('★ 「昵称会公开显示」在收起态就已经说了');

// ---------------------------------------------------------------------------
// ⑧ 裸 key 泄漏（打错一个字母就会以 `auth.xxx` 的形式露在界面上）
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 扫描器**只有这一个**（具名的 `RAW_KEY_RE`）："算泄漏"与下面的探针用的是**同一个**
 *    对象。原来的写法是两处各写一个正则字面量，而且两个长得不一样（探针那份少了 `name`
 *    那一支）⇒ "把扫描器改坏"这件事**不会有任何断言出声**，而 `ok(...)` 照旧宣称
 *    "扫描器本身能命中" —— 一条在撒谎的守卫。现在探针断言的是**这个函数的产出**。
 */
const RAW_KEY_RE = /(?:auth|common|name)\.[A-Za-z]+/g;

/**
 * 一段渲染产物里所有的裸 key（去重）。
 *
 * ⚠️ 这个 `/g` 对象被反复使用：`String.prototype.match` 每次都会先把 `lastIndex` 归零，
 *    所以调用之间不互相影响（现测：同一个对象连调两次给出同样的结果）。
 */
const rawKeysIn = (markup: string): string[] => [...new Set(markup.match(RAW_KEY_RE) ?? [])];

/*
 * ⚠️ 两条探针在**用扫描器去扫产物之前**跑，所以它们才是"先响的那一个"：放在后面的话
 *    一条坏掉的扫描器会先被下面那条断言拦住，你看到的是"产物里有泄漏"，而真正坏的
 *    是扫描器 —— 本仓 §5.74 那句"命令写错时输出长得像这一项没过"的同一类麻烦。
 *    两条都断言**这个函数的产出**（不是另一串常量的性质），而且**各有自己那一刀**：
 *    · 少了"不误报"：一条过宽的正则（`/[A-Za-z]+/g` 那种）会把正常文案里的词也算成泄漏；
 *    · 少了"能命中"：一条永不可能命中的正则会让下面那条断言变成恒真的空跑。
 *    ⚠️ 两刀都实测过（每次只跑本脚本，改完还原、sha256 与改前逐个比对）：
 *      · `RAW_KEY_RE` → `/[A-Za-z]+/g` ⇒ **第一条**探针红（`actual` 是一串普通词）；
 *      · `RAW_KEY_RE` → `/(?:authx|commonx|namex)\./g` ⇒ 第一条绿、**第二条**探针红
 *        （`actual: []` / `expected: ['auth.nameDoesNotExist']`）。
 *    ⇒ 顺序是有意的：先"不误报"再"能命中"，两条才各自都是先响的那一个。
 */
assert.deepEqual(
  rawKeysIn('SpeedRunner 与 Cancel 这两串字不是 key'),
  [],
  '泄漏扫描器不该命中普通文案里的词（否则它会变成噪声，而噪声没人再看）',
);
assert.deepEqual(
  rawKeysIn('auth.nameDoesNotExist'),
  ['auth.nameDoesNotExist'],
  '泄漏扫描器本身必须能命中（否则下面那条断言是恒真的空跑）',
);

const samples = [pageHtml, editHtml, shortHtml, savedHtml].join('');
const leaked = rawKeysIn(samples);
assert.deepEqual(leaked, [], `裸 key 泄漏：${leaked.join(', ')}`);
ok('★ 渲染结果里没有裸 key 泄漏（同一个扫描器已由上面两条探针夹住：能命中、且不误报）');

// ---------------------------------------------------------------------------
// ⑨ ★ 读源码的守卫：成功后必须把新用户塞回缓存（页头才会立刻换名字）
// ---------------------------------------------------------------------------
const accountSource = readFileSync(new URL('../src/routes/Account.tsx', import.meta.url), 'utf8');
/*
 * ⚠️ 先**剥注释**再测（`liverender.tsx` 为同一件事写过记录）：上面那段"为什么必须有这一句"
 *    的说明里逐字写着 `setUser(res.user)`，不剥的话这条断言会在代码被**删掉**之后
 *    依然通过 —— 一条只会被自己的注释喂饱的守卫。
 */
const accountCode = accountSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');
const setUserAfterRename =
  /const\s+res\s*=\s*await\s+updateDisplayName\([\s\S]{0,200}?setUser\(res\.user\)/;
assert.ok(
  setUserAfterRename.test(accountCode),
  '★ 改名成功后必须 `setUser(res.user)` —— 少了这一句，页头会一直显示旧名字，' +
    '直到用户自己刷新（而用户会把那读成"没改成功"）。这条是**源码形状**守卫，不是行为证明。',
);
/*
 * ⚠️ 能红证明：喂一份**没有** `setUser` 的成功分支（就是这一句被删掉的样子），
 *    同一判据必须认不出来 —— 否则上面那条没有区分力。
 */
assert.equal(
  setUserAfterRename.test(
    "const res = await updateDisplayName(next);\nsetEditingName(false);\nsetNameSaved(t('auth.nameSaved'));",
  ),
  false,
  '★ 能红证明：删掉 `setUser(res.user)` 的写法必须不匹配上面的判据',
);
ok('★ 源码形状：改名成功分支里 `setUser(res.user)` 在（且判据对删掉它的写法不匹配）');

// ---------------------------------------------------------------------------
// ⑩ 英文那一遍：整页零汉字
// ---------------------------------------------------------------------------
if (LANG === 'en') {
  /*
   * ⚠️ 样本里**故意包含** `serverText`：它的输入是一句中文的 `message`
   *    （真实的服务端 message 就是中文），而 `apiErrorText` 不读 message ——
   *    把中文 message 换成界面文字就是这一条要抓的那类泄漏。
   */
  const han =
    textOf([pageHtml, editHtml, shortHtml, savedHtml, serverText].join('')).match(
      /[\u4e00-\u9fff]+/g,
    ) ?? [];
  assert.deepEqual(han, [], `英文界面里出现了中文：${han.slice(0, 8).join(' / ')}`);
  ok('英文界面里零汉字（含服务端那句的输入是一句中文 message）');
}

console.log('');
console.log(`通过 ${pass} 项。`);
console.log('');
console.log('⚠️ 这个脚本验的是**渲染**（和一处源码形状）：没有点击、没有请求、也没有真实浏览器。');
console.log('   具体没被覆盖的（至少这几样）：');
console.log('     · 点「修改」是不是真的展开（只验到"editing=true 会渲染成什么样"）；');
console.log('     · 点「保存」是不是真的发出 PATCH /api/auth/me（事件处理器一行都不跑）；');
console.log(
  '     · 页头（Layout.tsx）在 setUser 之后是不是真的换了名字（只钉住 setUser 那一句在）；',
);
console.log('     · 服务端 400 的**真实**响应（这里喂的是构造出来的 ApiError，不是请求）；');
console.log('     · 在编辑框里继续打字是不是真的擦掉上一次那句红字（onChange 同样一行都不跑）。');
