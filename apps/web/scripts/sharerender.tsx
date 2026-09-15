#!/usr/bin/env tsx
/**
 * 实时分享（live shares）· 两个**纯视图**的产物断言 —— spec §11.2 的每一条。
 *
 * 跑法（从仓库根）：
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:share
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:share -- --en
 *
 * ===========================================================================
 * 为什么渲染的是**视图**，不是页面
 * ===========================================================================
 * `renderToStaticMarkup` **不跑 effect**（也不点击、不发请求），而
 * `routes/ShareIntro.tsx` / `routes/ShareBoard.tsx` 两个页面**自己取数** ——
 * 纯 SSR 下它们永远停在"加载中"那一屏，写在页面里的任何一块都断言不到。
 * 那样的守卫**不可能红**，而"这条守卫绿着"本身是**假证据**（`docs/pending.md §5.63`：
 * 恒真的断言比没有断言更坏）。⇒ 这一栏的界面全部住在 `components/ShareCard.tsx` 的
 * `ShareIntroView` / `ShareBoardView` 里（两个都**只吃 props**），本脚本渲染那两个。
 * ⚠️ 组件名是 `ShareBoardRow`（界面上的一行），不是 `ShareRow`（库里的一行叫
 * `LiveShare`）—— 两个同名会让人分不清手里拿的是哪一个。
 *
 * ===========================================================================
 * ★★ 守的第一条：「游客看不到任何一条分享的内容」，以及它的**正确写法**
 * ===========================================================================
 * 这是本栏目唯一的那条线（spec §1.1：全站第一条"内容不给游客看"的线）。
 * ⚠️ 它的失败形状**特别隐蔽**：把内容挡在外面的**只有 `!authed` 那个分支**是**结构上**
 * 成立的，而 `board` 那一格是**值**上的清理 —— 两者不是一件事，也不能互相替代。
 * 现读 `routes/ShareBoard.tsx:198`：`userId === null` 那一支确实 `setLoaded(null)`，
 * 但它在 **effect 里**，而 effect 跑在**渲染之后** ⇒ "登出"到"清空"之间至少有一帧，
 * `authed` 已经是 `false` 而 `board` **还是满的**。
 * ⇒ ③ 渲染的不是"游客 + 空板子"（那种情况下"没有内容"是句废话），
 *   而是**"游客 + 一份满满的板子"**：那一帧产物里必须一条内容都没有。
 * （同理 `routes/ShareIntro.tsx` 的 `setSummary(null)` 也是值上的清理。）
 * ⚠️ 每一组"不许出现 X"旁边都有一条"必须出现 Y"的正向对照 —— 组件整个炸了、
 *    或者分支被挪走，"找不到 X"都自动成立（本仓在 `roleguide.tsx` 上真的踩过一次）。
 *
 * ===========================================================================
 * ⚠️⚠️ 两条"看起来对、其实恒真"的写法（本计划里已经露过面，别再犯）
 * ===========================================================================
 * ① **提交键的文案不准用 `text.includes()` 断言**：「发到看板」是
 *    「发到看板（替换你正在展示的那条）」的**前缀**（英文同理）⇒ `includes` **恒为真**
 *    ⇒ 换哪一句文案它都绿。本脚本**读那颗按钮自己的文字再比相等**
 *    （`submitButton()`），并且用一条探针把"前缀关系"钉下来，好让下一个人知道坑还在。
 * ② **夹具必须让 `board.serverNow === nowMs`**：它们是**同一个瞬间的两次读数**
 *    （本地一次、服务端一次），两者的差就是偏移量。喂两个不同的值，剩余时间那一档
 *    就不是你以为的那个数，而症状只会说"文案对不上"。
 *    ⚠️ 唯一一处**刻意**违反它的是 ① 末尾"偏移量真的被用上了"那一条：那里故意让
 *       本地钟慢 3 分钟，专门验"显示的是服务端时刻" —— 它的注释写明了用意。
 *
 * ===========================================================================
 * ⚠️★ 本文件**不会被类型检查**（这就是它必须自己盯着自己那几格 prop 的原因）
 * ===========================================================================
 * `apps/web/tsconfig.json` 的 `include` 是 `src/**`、`packages/ui/src/**`、`vite.config.ts`
 * —— **`scripts/**` 不在里面**。于是 `ShareBoardView` 的三个必填 prop
 * （`onRetry` / `onResendVerify` / `lastUpdatedAtMs`）在**调用页面**上少一个是编译错误，
 * 到了这里却是**静默**的：少传一个，`onClick` 就是 `undefined`，而产物里那颗按钮
 * 与接好线的**长得一模一样**（SSR 不渲染事件处理器）⇒ "入口在不在"那两条断言照样绿。
 * ⇒ 本脚本两道**运行时**守卫，判据写在它们自己的注释里：
 *     · `assertBoardPropsGiven` —— 三格缺一个就红（`lastUpdatedAtMs` 允许 `null`，
 *       那是"还没成功取到过"，与"没传"是两件事）；
 *     · `assertClickable` —— 两个入口必须**可点**（读 `disabled` 属性），
 *       而不是仅仅"在"。
 *
 * 不用 JSX（`createElement`）：与 `resourcerender.tsx` / `calendarrender.tsx` 同一条理由 ——
 * `scripts/**` 不在 include 里 ⇒ JSX 走 **classic runtime** ⇒ 必须 `import React from 'react'`，
 * 而 biome 的 `noUnusedImports` 会把它判成"未使用"并给一个**不安全自动修复**：
 * 谁点了那个修复，脚本就在运行时崩（`React is not defined`，指向第一处 JSX）。
 */
import assert from 'node:assert/strict';
import {
  DEFAULT_SHARE_MINUTES,
  type LiveShare,
  SHARE_KINDS,
  SHARE_LIMITS,
  SHARE_MINUTES,
  type ShareListResponse,
  type ShareStatus,
  type ShareSummary,
} from '@mcsr/shared';
import { en, zhCN } from '@mcsr/shared/i18n';
import i18n from 'i18next';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';

import { emText } from '@/components/Emphasis';
import {
  ShareBoardView,
  type ShareBoardViewProps,
  ShareIntroView,
  type ShareIntroViewProps,
} from '@/components/ShareCard';
import { ApiError } from '@/lib/api';
import { describeShareError, SHARE_STATE_REASON_KEYS } from '@/lib/shareErrors';
import { remainingMs, remainText, serverOffset, type Translate } from '@/lib/shareTime';

const LANG = process.argv.includes('--en') ? 'en' : 'zh-CN';

await i18n.use(initReactI18next).init({
  lng: LANG,
  /*
   * ⚠️ `false` 而不是 `'zh-CN'`（与 `resourcerender.tsx` 同一行、同一理由）：
   *    缺 en 词条时**原样返回 key**，于是 ⑬ 的裸 key 扫描能精确指出是哪一个 key。
   *    回退到中文的话，英文界面上冒出来的是中文，只能靠 ⑮ 的汉字扫描间接发现"某处漏了英文"。
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
const noop = (): void => undefined;

// ---------------------------------------------------------------------------
// 文本归一化与提取器
// ---------------------------------------------------------------------------

/*
 * ⚠️⚠️ `flat()` 只做**三件**事：还原实体、压掉空白、按 `em()` 的策略剥掉 `**`
 *    （第三件的理由写在它自己的注释里）。**不许**顺手把别的字符也擦掉 ——
 *    `roleguide.tsx` 那条恒真的守卫就是这么来的：它的 `norm()` 里替掉了 `*`，
 *    而"页面上不该有字面 `**`"那条断言恰好作用在**被擦过**的字符串上，
 *    于是它永远成立、运行时零保护（`docs/pending.md §5.63`）。
 *    判据：**断言必须作用在还没被处理过的那份数据上**，或者另配一条反面探针。
 */
const decode = (s: string): string =>
  s
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/**
 * 比对用的"人看到的那串字"：**两边都过它**，含空格的词条才不会因为空白差异假红。
 *
 * ⚠️★ 它顺带走一遍 `emText()`（与 `em()` **同一条剥标记策略**，那两处的一致性由
 *    `scripts/authoringNotice.ts` 的探针守着）。理由：词条里的 `**强调**` 在产物里
 *    是 `<strong>`，不剥标记的话，**带标记的词条两个方向都会错**：
 *      · "必须有这一句" ⇒ **假红**（产物里没有字面星号）；
 *      · "不许出现这一句" ⇒ **恒真**（针里带着星号，永远匹配不上任何东西）——
 *        那正是 `docs/pending.md §5.63` 那一族（守着一件**不可能发生**的事）。
 *    本栏目唯一带标记的词条是 `shares.hideHint`（`**到点**`），⑭ 里两个方向都有。
 * ⚠️⚠️ 但"产物里没有字面 `**`"那条断言**不许**用它 —— 它必须作用在**原文**上
 *    （`rawText`），否则就是 §5.63 那个事故的逐字重演：规范化函数把要断言的东西擦掉了。
 */
const flat = (s: string): string => decode(emText(s)).replace(/\s+/g, '');
/** 原样的 HTML（只还原实体）：汉字扫描与 `**` 扫描要看**属性**，所以用这一份。 */
const rawText = (html: string): string => decode(html);
/** 一段 HTML 的可见文字（属性里的内容**不算** —— 要算就用 `rawText`）。 */
const textOf = (html: string): string => flat(html.replace(/<[^>]+>/g, ' '));
const hasText = (html: string, needle: string): boolean => textOf(html).includes(flat(needle));
/*
 * 探针：`flat` 必须**真的**把 `**` 剥掉（否则上面那段注释说的两个方向都会错，
 * 而"剥没剥"在产物里看不出来 —— 这正是 §5.63 要求给布尔断言配前置探针的原因）。
 */
assert.notEqual(
  flat('a**b**c'),
  'a**b**c',
  '★ 探针：`flat` 必须剥掉 `**`（不然带标记的词条永远匹配不上）',
);
assert.equal(flat('a**b**c'), 'abc', '★ 探针：剥掉的是标记本身，被夹住的**正文**要留下');

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

/**
 * 取出所有带这个 class 的元素的**外层 HTML**（自带简化的配对扫描）。
 *
 * ⚠️ 不用"非贪婪匹配到最近的 `</tag>`"：`<span class="share__code">` 里还嵌着
 *    `<span>`，那样截出来的是**内层**那一小段 —— 断言就在错误的字符串上做了。
 *    这类"看起来在断言 A、其实断言了 B"的写法正是 §5.63 那一族。
 */
function elementsWithClass(html: string, cls: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g)) {
    const open = m[0];
    const classes = (/\bclass="([^"]*)"/.exec(open)?.[1] ?? '').split(/\s+/);
    if (!classes.includes(cls)) continue;
    const name = m[1] ?? '';
    if (VOID_TAGS.has(name)) {
      out.push(open);
      continue;
    }
    const re = new RegExp(`<(/?)${name}\\b[^>]*?>`, 'g');
    re.lastIndex = m.index + open.length;
    let depth = 1;
    /* ⚠️ 写成 `for` 而不是 `while ((close = re.exec(html)) !== null)`：
       biome 的 `noAssignInExpressions` 不许在条件里赋值（那条规则值得守）。 */
    for (let close = re.exec(html); close !== null; close = re.exec(html)) {
      if (close[1] === '/') {
        depth -= 1;
        if (depth === 0) {
          out.push(html.slice(m.index, close.index + close[0].length));
          break;
        }
      } else if (!close[0].endsWith('/>')) {
        depth += 1;
      }
    }
  }
  return out;
}

/*
 * ⚠️★ 本节**所有**断言都建立在 `elementsWithClass` 上，所以它自己有探针。
 *    没有这几条的话，下面那些"某一行里有/没有 X"可能全都作用在错误的片段上 ——
 *    那是 §5.63 那一族（看起来在断言 A，其实断言了 B），而**绿的样子完全一样**。
 */
const NESTED_FIXTURE =
  '<li class="share__row"><div class="share__rowhead">a</div><span>b</span></li>';
assert.equal(
  elementsWithClass(NESTED_FIXTURE, 'share__row').length,
  1,
  '★ 探针：class 要**整个词**相等 —— `share__rowhead` / `share__rows` 都不算 `share__row`',
);
assert.equal(
  textOf(elementsWithClass(NESTED_FIXTURE, 'share__row')[0] ?? ''),
  'ab',
  '★ 探针：取到的是**外层**元素（含里面那一层），不是"开头一小段"',
);
assert.equal(
  elementsWithClass(NESTED_FIXTURE, 'share__nosuchclass').length,
  0,
  '★ 探针：不存在的 class 一个都不许匹配（否则"产物里没有 X"恒假）',
);
assert.equal(
  textOf(elementsWithClass(NESTED_FIXTURE, 'share__rowhead')[0] ?? ''),
  'a',
  '★ 探针：同一个产物里按另一个 class 取也要取对',
);

/** 某个属性值（还原实体）。 */
const attrOf = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m === null ? null : decode(m[1] ?? '');
};

const hasClass = (attrs: string, cls: string): boolean =>
  (attrOf(attrs, 'class') ?? '').split(/\s+/).includes(cls);

/** 产物里所有按钮的「属性串 + 可见文字」。 */
function buttons(html: string): { attrs: string; text: string }[] {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    attrs: m[1] ?? '',
    text: flat((m[2] ?? '').replace(/<[^>]+>/g, ' ')),
  }));
}

/*
 * ⚠️ `\bdisabled\b` 会**误判 `aria-disabled`**（`-` 与 `d` 之间是词边界），
 *    所以判据写成"这个词独立出现"，而不是"这个子串出现过"。
 */
const isDisabled = (attrs: string): boolean => /(?:^|\s)disabled(?:\s|=|$)/.test(attrs);

/**
 * ★★ 「这个入口是**可点的**」—— 读 `disabled` 属性，而不是仅仅"入口在"。
 *
 * ⚠️ 为什么这条不是形式主义：这两个入口（重试 / 重发验证邮件）曾经是**可选 prop**
 *    + "缺省就把按钮禁掉"，于是"忘了接线"的表现是一颗**永远灰着的按钮**，
 *    而**所有门禁都绿**（渲染自检当时只看入口在不在，禁用也算在）。改成必填之后
 *    忘了传是**编译错误** —— 但那道保护**罩不到本脚本**（`scripts/**` 不受类型检查，
 *    见文件头），所以"可点"这件事必须在这里由产物自己证明。
 * ⚠️ 探针：`busy: true` 的那几次渲染里同一个按钮**必须**带 `disabled`
 *    （否则这个读取器是恒真的：永远读不到 disabled，就永远"可点"）。
 */
function assertClickable(html: string, label: string, where: string): string {
  const found = buttons(html).filter((b) => b.text === flat(label));
  assert.equal(
    found.length,
    1,
    `★★ ${where}：找不到唯一的「${label}」入口（找到 ${String(found.length)} 个）`,
  );
  assert.equal(
    isDisabled(found[0]?.attrs ?? ''),
    false,
    `★★ ${where}：「${label}」入口是 disabled 的 —— 它"在"，但按不动（那是本计划防过的一种静默失效）`,
  );
  return found[0]?.attrs ?? '';
}

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------
/*
 * ⚠️ 夹具里的**每一个字符串都是 ASCII**：`⑮` 英文那一遍会扫描产物里的汉字，
 *    中文夹具会让扫描把夹具本身当成泄漏（"英文界面里冒出了中文"）。
 * ⚠️ 夹具一律通过 `NOW` + "还剩多少毫秒"构造，理由见 `NOW` 下面那条。
 */
const NOW = 1_760_000_000_000;
const MIN = 60_000;
/** 「本地钟慢 3 分钟」那条断言用的偏移量（①）。 */
const SKEW = 3 * MIN;

const ROOM_CODE = 'A7K2P';
const ROOM_CODE_OTHER = 'B8L3Q';
const ROOM_CODE_EXPIRED = 'C9M4R';
const ROOM_CODE_HIDDEN = 'D1N5S';
const MINE_NOTE = 'mine, first room';
const SEED_MAIN_ONLY = '1234567890123456789';
const SEED_MAIN_ALL = 'OVW-ALL';
const SEED_NETHER = 'NETHER-1';
const SEED_END = 'END-2';
const SEED_RNG = 'RNG-3';

function roomItem(o: {
  id: string;
  code: string;
  note: string;
  authorName: string;
  mine: boolean;
  /** 距"现在"还剩多少毫秒（`0` = 正好到点）。⚠️ 只在 `serverNow === nowMs` 的板子上用。 */
  remain: number;
  status?: ShareStatus;
}): LiveShare {
  return {
    id: o.id,
    kind: 'room',
    payload: { code: o.code },
    note: o.note,
    authorName: o.authorName,
    createdAt: NOW - MIN,
    expiresAt: NOW + o.remain,
    status: o.status ?? 'active',
    mine: o.mine,
  };
}

function seedItem(o: {
  id: string;
  overworld: string;
  nether?: string;
  end?: string;
  rng?: string;
  note: string;
  authorName: string;
  mine: boolean;
  remain: number;
  status?: ShareStatus;
}): LiveShare {
  return {
    id: o.id,
    kind: 'seed',
    payload: { overworld: o.overworld, nether: o.nether, end: o.end, rng: o.rng },
    note: o.note,
    authorName: o.authorName,
    createdAt: NOW - MIN,
    expiresAt: NOW + o.remain,
    status: o.status ?? 'active',
    mine: o.mine,
  };
}

/** 一条 room 板子。`serverNow` 默认 `NOW` —— ★ 与 `nowMs` 是**同一个瞬间的两次读数**。 */
const roomBoard = (
  o: Partial<ShareListResponse> & { items: LiveShare[]; mine: LiveShare[] },
): ShareListResponse => ({
  kind: 'room',
  limit: SHARE_LIMITS.room,
  liveCount: 0,
  serverNow: NOW,
  truncated: false,
  ...o,
});

const seedBoard = (
  o: Partial<ShareListResponse> & { items: LiveShare[]; mine: LiveShare[] },
): ShareListResponse => ({
  kind: 'seed',
  limit: SHARE_LIMITS.seed,
  liveCount: 0,
  serverNow: NOW,
  truncated: false,
  ...o,
});

/** 我的那条 room：还剩 11 分 30 秒 ⇒ 「还剩 12 分钟」（`Math.ceil`）。 */
const MINE_ROOM = roomItem({
  id: 'r-mine',
  code: ROOM_CODE,
  note: MINE_NOTE,
  authorName: 'Me',
  mine: true,
  remain: 11 * MIN + 30_000,
});
/** 别人的那条：**说明为空**（⑪），还剩 30 秒 ⇒ 「不到 1 分钟」。 */
const THEIR_ROOM = roomItem({
  id: 'r-theirs',
  code: ROOM_CODE_OTHER,
  note: '',
  authorName: 'Anna',
  mine: false,
  remain: 30_000,
});
/** 已经到点的那条：服务端也会滤掉它，但"到点即消失"是**本地**计时负责的（⑦）。 */
const EXPIRED_ROOM = roomItem({
  id: 'r-expired',
  code: ROOM_CODE_EXPIRED,
  note: 'expired one',
  authorName: 'Bo',
  mine: false,
  remain: 0,
});
/** 我下架了的那条：只出现在「你的一条」里。 */
const HIDDEN_ROOM = roomItem({
  id: 'r-hidden',
  code: ROOM_CODE_HIDDEN,
  note: 'taken down',
  authorName: 'Me',
  mine: true,
  remain: 8 * MIN,
  status: 'hidden',
});

const ROOM_BOARD = roomBoard({
  items: [MINE_ROOM, THEIR_ROOM, EXPIRED_ROOM],
  mine: [MINE_ROOM],
  liveCount: 1,
});
const ROOM_BOARD_OTHERS_ONLY = roomBoard({ items: [THEIR_ROOM, EXPIRED_ROOM], mine: [] });
const ROOM_BOARD_NO_MINE = roomBoard({ items: [THEIR_ROOM], mine: [] });
const ROOM_BOARD_HIDDEN = roomBoard({ items: [THEIR_ROOM], mine: [HIDDEN_ROOM] });
const ROOM_BOARD_ONLY_EXPIRED = roomBoard({ items: [EXPIRED_ROOM], mine: [] });
const ROOM_BOARD_NOTHING = roomBoard({ items: [], mine: [] });

/** 只填了主世界的那条 seed（⑩）。 */
const SEED_ONLY_OVERWORLD = seedItem({
  id: 's-only',
  overworld: SEED_MAIN_ONLY,
  note: 'only overworld',
  authorName: 'Anna',
  mine: false,
  remain: 9 * MIN + 30_000,
});
/** 四个都填了的那条 —— 它是"只在填了的那几格"那条反向断言的正向对照。 */
const SEED_ALL_FOUR = seedItem({
  id: 's-all',
  overworld: SEED_MAIN_ALL,
  nether: SEED_NETHER,
  end: SEED_END,
  rng: SEED_RNG,
  note: 'all four seeds',
  authorName: 'Me',
  mine: true,
  remain: 3 * MIN,
});
const SEED_BOARD = seedBoard({
  items: [SEED_ONLY_OVERWORLD, SEED_ALL_FOUR],
  mine: [SEED_ALL_FOUR],
  liveCount: 1,
});

/** 到额度：`liveCount === limit` ⇒ 提交键必须禁用（⑫）。 */
const SEED_AT_LIMIT_MINE = Array.from({ length: SHARE_LIMITS.seed }, (_, i) =>
  seedItem({
    id: `s-mine-${String(i)}`,
    overworld: `OVW${String(i)}`,
    note: '',
    authorName: 'Me',
    mine: true,
    remain: (i + 1) * MIN,
  }),
);
const SEED_AT_LIMIT_BOARD = seedBoard({
  items: SEED_AT_LIMIT_MINE,
  mine: SEED_AT_LIMIT_MINE,
  liveCount: SHARE_LIMITS.seed,
});

const SUMMARY: ShareSummary = {
  room: { live: 3, limit: SHARE_LIMITS.room },
  seed: { live: 7, limit: SHARE_LIMITS.seed },
  serverNow: NOW,
};

// ---------------------------------------------------------------------------
// 渲染入口
// ---------------------------------------------------------------------------

const render = (node: ReactElement): string =>
  renderToStaticMarkup(
    createElement(I18nextProvider, { i18n }, createElement(MemoryRouter, null, node)),
  );

/**
 * 介绍页那一行的默认 props。**每一格都显式给**（含两格必填的），
 * 理由与下面 `assertBoardPropsGiven` 逐字相同 —— `scripts/**` 不受类型检查。
 */
const INTRO_PROPS: ShareIntroViewProps = {
  authed: true,
  summary: SUMMARY,
  summaryFailed: false,
  onRetry: noop,
};

/**
 * ★★ 介绍页的四格 prop 都给了吗 —— 与 `assertBoardPropsGiven` 同一条理由、同一个形状。
 *
 * ⚠️ 这一条是 2026-09-15 补的：`summaryFailed` / `onRetry` 是**新加的两格必填 prop**
 *    （取数失败那一档原先在界面上**不存在**，见 ② 那一节），而"必填"这道保护
 *    只罩得住**被类型检查的调用方**（`routes/ShareIntro.tsx`）—— **罩不到本脚本**。
 *    少传一格的表现是"失败那一屏永远不渲染"，而产物里没有任何东西能反映这件事。
 * ⚠️ 判据是 `undefined`，**不能**写成 falsy：`summaryFailed` 的 `false`
 *    （"这一次没失败"）是合法值，写成 falsy 会让每一个正常夹具都红。
 */
const INTRO_PROPS_GIVEN = ['authed', 'summary', 'summaryFailed', 'onRetry'] as const;

function assertIntroPropsGiven(props: ShareIntroViewProps, where: string): void {
  for (const key of INTRO_PROPS_GIVEN) {
    assert.notEqual(
      (props as unknown as Record<string, unknown>)[key],
      undefined,
      `★★ ${where}：必填 prop \`${key}\` 没有传 —— 本脚本不受类型检查保护，产物里也看不出来`,
    );
  }
  assert.equal(
    typeof props.onRetry,
    'function',
    `★★ ${where}：\`onRetry\` 必须是函数（传了 undefined 就是一颗按不动的「重试」）`,
  );
}

/* 探针：上面那个检查本身必须能命中 —— 否则"四格都传了"是一条永远不红的守卫。 */
assert.throws(
  () => {
    assertIntroPropsGiven({ ...INTRO_PROPS, onRetry: undefined }, '探针');
  },
  /onRetry/,
  '★★ 探针：介绍页缺 prop 的检查本身必须能命中（否则"四格都传了"这条是空跑）',
);

const renderIntro = (o: Partial<ShareIntroViewProps> = {}, where = '介绍页'): string => {
  const props: ShareIntroViewProps = { ...INTRO_PROPS, ...o };
  assertIntroPropsGiven(props, where);
  return render(createElement(ShareIntroView, props));
};

/**
 * 看板视图那一行的默认 props。**每一格都显式给**（含三格必填的），
 * 理由见 `assertBoardPropsGiven`。
 */
const BOARD_PROPS: ShareBoardViewProps = {
  kind: 'room',
  authed: true,
  verified: true,
  board: ROOM_BOARD,
  loadError: null,
  staleSecs: null,
  nowMs: NOW,
  lastUpdatedAtMs: NOW - 7_000,
  busy: false,
  notice: null,
  onHide: noop,
  onRestore: noop,
  onCopy: noop,
  onSubmit: noop,
  onRetry: noop,
  onResendVerify: noop,
};

/**
 * ★★ 「三格必填 prop 都显式传了」—— 一条**运行时**断言，因为这里没有编译期保护。
 *
 * ⚠️ `scripts/**` 不在 tsconfig 的 include 里（文件头那一节），所以本文件里
 *    `ShareBoardViewProps` 这个类型注解**不会被检查**：它只是给读代码的人看的。
 *    ⇒ 少传一格的表现是"那颗按钮的 `onClick` 是 `undefined`"，而产物与接好线的
 *    **完全一样**（SSR 不渲染事件处理器）⇒ 产物级断言永远发现不了。
 *    这一条把"缺一格"从**静默**变成**红**。
 * ⚠️ 判据是 `undefined`，不是 falsy：`lastUpdatedAtMs` 的 `null` 是**合法**的
 *    （"还没成功取到过"，那时"多少秒前更新"整行不渲染），与"没传"是两件事。
 */
const REQUIRED_BOARD_PROPS = ['onRetry', 'onResendVerify', 'lastUpdatedAtMs'] as const;
const HANDLER_BOARD_PROPS = [
  'onHide',
  'onRestore',
  'onCopy',
  'onSubmit',
  'onRetry',
  'onResendVerify',
] as const;

function assertBoardPropsGiven(props: ShareBoardViewProps, where: string): void {
  for (const key of REQUIRED_BOARD_PROPS) {
    assert.notEqual(
      (props as unknown as Record<string, unknown>)[key],
      undefined,
      `★★ ${where}：必填 prop \`${key}\` 没有传 —— 本脚本不受类型检查保护，产物里也看不出来`,
    );
  }
  for (const key of HANDLER_BOARD_PROPS) {
    assert.equal(
      typeof props[key],
      'function',
      `★★ ${where}：\`${key}\` 必须是函数（传了 undefined 就是一颗按不动的按钮）`,
    );
  }
}

/*
 * 探针：上面那个检查本身必须能命中 —— 否则它是一条永远不红的守卫。
 * ⚠️ 这条探针**必须**存在：它守的是"三格必填"这条唯一没有编译期保护的不变量。
 */
assert.throws(
  () => {
    assertBoardPropsGiven({ ...BOARD_PROPS, onRetry: undefined }, '探针');
  },
  /onRetry/,
  '★★ 探针：缺 prop 的检查本身必须能命中（否则"三格都传了"这条是空跑）',
);

const renderBoard = (o: Partial<ShareBoardViewProps> = {}, where = '看板'): string => {
  const props: ShareBoardViewProps = { ...BOARD_PROPS, ...o };
  assertBoardPropsGiven(props, where);
  return render(createElement(ShareBoardView, props));
};

console.log(`【${LANG}】实时分享 · 两个纯视图（渲染自检）`);

// ---------------------------------------------------------------------------
console.log('① 剩余时间的算法（lib/shareTime.ts 的三件套）');
// ---------------------------------------------------------------------------
/*
 * ⚠️ 为什么这三条必须在这里：`apps/web` **没有测试运行器**（现读 `package.json`：
 *    只有 dev / build / check:* / preview / typecheck），所以这一栏唯一被断言的
 *    算术就是本脚本。它们也是"倒计时"这件事在静态渲染里**唯一**能被钉住的那一半。
 */
assert.equal(serverOffset(NOW, NOW), 0, '同一个瞬间的两次读数 ⇒ 偏移量 0（夹具的前提）');
assert.equal(serverOffset(NOW + SKEW, NOW), SKEW, '★ 本地钟慢 3 分钟 ⇒ 偏移量 +180000');
assert.equal(serverOffset(NOW - 5_000, NOW), -5_000, '本地钟快 5 秒 ⇒ 偏移量是负数');

assert.equal(
  remainingMs(NOW + 11 * MIN + 30_000, NOW, 0),
  11 * MIN + 30_000,
  '偏移量 0 时剩余时间就是两个时刻之差',
);
assert.equal(
  remainingMs(NOW + SKEW + 11 * MIN + 30_000, NOW, SKEW),
  11 * MIN + 30_000,
  '★ 本地钟慢 3 分钟时，同一行**显示同一个数**（偏移量存在的全部意义）',
);
assert.equal(remainingMs(NOW, NOW, 0), 0, '正好到点 ⇒ 0（判据是 `> 0`，所以它不在看板上）');
assert.equal(remainingMs(NOW - 1, NOW, 0), -1, '过了一毫秒 ⇒ 负数');
assert.equal(
  remainingMs(NOW + 10 * MIN, NOW + MIN, 0),
  9 * MIN,
  '★ 同一个偏移量下，本地时钟往前走一分钟 ⇒ 剩余时间少一分钟（每秒 tick 靠的就是这个代数）',
);

/*
 * ★ `remainText` 的每一档，判据是**词条本身**（不写死译文），
 *   并且用记录器把"用的是哪一个 key、插值进去了什么"钉下来。
 */
const tRecorder = (key: string, opts?: Record<string, unknown>): string =>
  `${key}|${String(opts?.n)}`;
const remainKeyOf = (ms: number): string => remainText(ms, tRecorder as Translate);

assert.equal(remainText(690_000, t), t('shares.remainMinutes', { n: 12 }), '11 分 30 秒 ⇒ 12 分钟');
assert.equal(
  remainKeyOf(690_000),
  'shares.remainMinutes|12',
  '★ 走的是 `shares.remainMinutes`，插值进去的就是 12（不是别的数、也不是别的 key）',
);
assert.equal(
  remainText(660_001, t),
  t('shares.remainMinutes', { n: 12 }),
  '★ 剩 11 分 01 秒说「还剩 12 分钟」（向上取整是**保守**的说法）',
);
assert.equal(
  remainText(660_000, t),
  t('shares.remainMinutes', { n: 11 }),
  '正好 11 分整 ⇒ 11 分钟（边界两边不是同一档）',
);
assert.equal(remainText(60_000, t), t('shares.remainMinutes', { n: 1 }), '正好 1 分钟 ⇒ 还是分钟');
assert.equal(remainText(59_999, t), t('shares.remainUnderOne'), '差 1 毫秒进最后一分钟');
assert.equal(remainText(1, t), t('shares.remainUnderOne'), '还剩 1 毫秒');
assert.equal(remainText(0, t), '', '★ 到点 ⇒ **空串**（分钟粒度不会印出「还剩 0 分钟」）');
assert.equal(remainText(-1, t), '', '过了一毫秒也必须是空串');
assert.notEqual(
  '',
  flat(t('shares.remainUnderOne')),
  '探针：空串不是任何一句真话，调用方据此摘掉那一行',
);
ok('三件套：偏移量、剩余毫秒、三档文案（含 0 与负数的空串）');

/*
 * ★★ 偏移量真的被**用上**了：本地钟**故意**慢 3 分钟（唯一的例外，见文件头 ②）。
 *    行的 `expiresAt` 按**服务端**时刻给（+3 分钟 +11 分 30 秒）⇒ 显示「还剩 12 分钟」。
 *    组件要是拿本地钟直接减，这里会显示「还剩 15 分钟」⇒ 红。
 */
const SKEW_EXPIRES = NOW + SKEW + 11 * MIN + 30_000;
const SKEWED_BOARD = roomBoard({
  items: [
    roomItem({
      id: 'r-skew',
      code: ROOM_CODE,
      note: '',
      authorName: 'Anna',
      mine: false,
      remain: SKEW + 11 * MIN + 30_000,
    }),
  ],
  mine: [],
  serverNow: NOW + SKEW,
});
assert.notEqual(
  remainText(SKEW_EXPIRES - NOW, t),
  remainText(SKEW_EXPIRES - (NOW + SKEW), t),
  '★ 探针：按本地钟读与按服务端钟读必须给出**不同**的文案，否则下面那条是空跑',
);
const skewHtml = renderBoard(
  { board: SKEWED_BOARD, nowMs: NOW, lastUpdatedAtMs: null },
  '本地钟慢 3 分钟的板子',
);
assert.equal(
  textOf(elementsWithClass(skewHtml, 'share__remain')[0] ?? ''),
  flat(t('shares.remainMinutes', { n: 12 })),
  '★★ 本地钟慢 3 分钟时，剩余时间按**服务端**时刻算（算错就显示 15 分钟）',
);
ok('偏移量真的被用在渲染路径上（skew 探针 + 显示 12 分钟）');

// ---------------------------------------------------------------------------
/*
 * ⚠️ 编号写 `①b` 而不是把后面全体 +1：这一节与 ① 是**同一件事的另一半**
 *    （`apps/web/src/lib/` 里那两个纯模块都没有测试运行器，只能被本脚本钉住），
 *    插在 ① 后面就是它的位置；而"把 ②…⑮ 整体挪一位"要顺带改本文件里十几处
 *    交叉引用（夹具注释里的 ⑦/⑩/⑪/⑫ …）—— 那是一次与本次改动无关的重编号。
 */
console.log('①b 失败码 → 用户那一句话（lib/shareErrors.ts）');
// ---------------------------------------------------------------------------
/*
 * ⚠️★ 这一节补的是一个**全仓没有第二处**的空白：`describeShareError` 是纯函数
 *    （`(code, reason, kind) → 一句话`），只有 `routes/ShareBoard.tsx` 三个调用点，
 *    而**那三个调用点本身不在任何渲染自检的操作数里**（页面自己取数，SSR 只停在
 *    "加载中"）。⇒ 在本次改动之前，这个函数里有两处**换掉之后完全无声**的对应关系：
 *      · 三个 `invalid_state` 的 reason → 三句话：**对调两行**之后，界面照样渲染、
 *        类型照样过（三格都是 `string`）、门禁一个都不看它，而用户读到的是另一段处境的话；
 *      · `at_limit` 按 `kind` 分叉：room 那句说"先下架另一条"、seed 那句说"你已经在展示 N 条"。
 *    这两处正是 spec §5.3 / §5.4 把它们**分开**的原因（`at_limit` 之所以独立成码，
 *    就是为了让"恢复 room 被拒"和"发布 seed 超额度"各自拿到对的那一句），
 *    所以两处各自都值得被钉住。
 * ⚠️ 判据是**精确的 key**，不是"非空"：非空对"两句对调"完全免疫。
 */
/** 调用方给的兜底（`useApiErrorText()`）—— 用一个哨兵，好断言"确实走了兜底"这条路。 */
const FALLBACK = 'FALLBACK';

/** 记录器：把"用的是哪一个 key、插值进去了什么"钉下来（与 ① 的 `tRecorder` 同形）。 */
const errorSay = (key: string, opts?: Record<string, unknown>): string =>
  opts?.max === undefined ? key : `${key}|max=${String(opts.max)}`;

/** 走一遍**真实**的 `describeShareError`（表对了但派发不查表，也是缺陷）。 */
const sayOf = (error: unknown, kind: ShareKind): string =>
  describeShareError(error, errorSay as Translate, () => FALLBACK, kind);

/**
 * 一个服务端拒绝。
 *
 * ⚠️ `ApiError` 的构造器有**十个位置参数**（它自己的注释里写了为什么会这样），
 *    这里只用得到 `code` 与 `reason`（`status` 不是这一层读的东西），所以包一层 ——
 *    免得每一行都要数九个 `undefined`。
 */
const rejectionOf = (code: string, reason?: string): ApiError =>
  new ApiError(
    `server refused: ${code}`,
    409,
    code,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    reason,
  );

/* ★ 逐格断言那张表：对调任意两行、改掉任意一个 key、或往里多塞一格，这里立刻红。 */
assert.deepEqual(
  SHARE_STATE_REASON_KEYS,
  {
    expired: 'shares.errExpired',
    not_active: 'shares.errNotActive',
    not_hidden: 'shares.errNotHidden',
  },
  '★★ `invalid_state` 的三个 reason → 三句话的映射表被改了（对调两行在界面上**看不出来**）',
);

/* ★ 表是唯一的映射来源：真实输出必须按它走（否则"表是对的"什么也证明不了）。 */
assert.equal(
  sayOf(rejectionOf('invalid_state', 'expired'), 'room'),
  'shares.errExpired',
  '★★ reason=expired ⇒ 说"到点了，不能再改了"',
);
assert.equal(
  sayOf(rejectionOf('invalid_state', 'not_active'), 'room'),
  'shares.errNotActive',
  '★★ reason=not_active ⇒ 说"它现在不在展示中"',
);
assert.equal(
  sayOf(rejectionOf('invalid_state', 'not_hidden'), 'room'),
  'shares.errNotHidden',
  '★★ reason=not_hidden ⇒ 说"它本来就没有下架"',
);
assert.equal(
  sayOf(rejectionOf('invalid_state', 'ghost_state'), 'room'),
  FALLBACK,
  '★★ 认不出的第四种 reason ⇒ 走兜底，不假装知道它是什么意思（也不许崩）',
);
assert.equal(
  sayOf(new Error('not an ApiError'), 'room'),
  FALLBACK,
  '★ 不是 `ApiError` 的一律走兜底（这一条本来就在，写在旁边免得上面几条被当成全貌）',
);

/*
 * ★★ `at_limit` 的两条分支必须**按 kind 分叉**，而且 seed 那一句的 `{{max}}`
 *    只能来自 `SHARE_LIMITS.seed`：恢复那条路的 409 里**没有 `limit` 字段**
 *    （spec §5.4 的冻结形状，所以 room 与 seed 的 `at_limit` 在响应上长得一模一样）。
 * ⚠️ 下面那个 `|max=7` 是**从常量拼出来的**：把 `max` 改成从响应拿（或干脆不传），
 *    记录器拿到的就是 `undefined` ⇒ 红。
 */
const atLimitRoom = sayOf(rejectionOf('at_limit'), 'room');
const atLimitSeed = sayOf(rejectionOf('at_limit'), 'seed');
assert.equal(
  atLimitRoom,
  'shares.atLimitRestore',
  '★★ 恢复 room 被拒 ⇒ 说"先把它下架，再恢复这条"',
);
assert.equal(
  atLimitSeed,
  `shares.atLimitSeeds|max=${String(SHARE_LIMITS.seed)}`,
  '★★ 发布 seed 超额度 ⇒ 说"你在展示 N 条"，而那个 N 来自 `SHARE_LIMITS.seed`（响应里没有它）',
);
assert.notEqual(
  atLimitRoom,
  atLimitSeed,
  '★★ 同一个码的两条路必须给出**不同**的话（这正是它独立成码的原因）',
);
assert.notEqual(
  errorSay('shares.errExpired'),
  errorSay('shares.errNotActive'),
  '★ 探针：记录器本身能区分两个 key（否则上面那些"两句不同"的比较是空跑）',
);
ok('失败码：三个 reason 各说各的 + `at_limit` 按 kind 分叉（seed 的 max 来自常量）');

// ---------------------------------------------------------------------------
console.log('② 介绍页（§11.2 第 1 条）');
// ---------------------------------------------------------------------------
const introGuestNull = renderIntro({ authed: false, summary: null });
/** ⚠️ 缺陷形状：游客**却拿到了一份 summary**（页面若对游客也发了那次请求就会这样）。 */
const introGuestWithSummary = renderIntro({ authed: false, summary: SUMMARY });
const introAuthed = renderIntro({ authed: true, summary: SUMMARY });
const introAuthedLoading = renderIntro({ authed: true, summary: null });
/*
 * ★★ 取数**失败**那一档（2026-09-15 补的一块**计划空白**）。
 * ⚠️ 它在本次改动之前**在界面上不存在**：失败只能把 `summary` 留在 `null`，
 *    而视图只有"加载中"与"条数"两句 ⇒ 登录用户**一直**停在「加载中」，
 *    既没有重试，也分不出"慢"和"挂了"。契约因此多了两格**必填** prop
 *    （`summaryFailed` / `onRetry`）—— 这一档就是它们的靶子。
 */
const introAuthedFailed = renderIntro({ authed: true, summary: null, summaryFailed: true });
/** ⚠️ 缺陷形状：游客**却拿到了"取数失败"**（他这一次请求压根没发，§7.2）。 */
const introGuestFailed = renderIntro({ authed: false, summary: null, summaryFailed: true });

assert.equal(
  textOf(elementsWithClass(introGuestNull, 'shareIntro__title')[0] ?? ''),
  flat(t('nav.shares')),
  '★ 标题是栏目名（与侧栏同一个词条，不新写一句）',
);
assert.ok(
  hasText(introGuestNull, t('shares.introLead')),
  '★ 游客必须读到那句导语（它会说清"会自己消失 + 内容要登录"）',
);
const cards = elementsWithClass(introGuestNull, 'shareIntro__card');
assert.equal(cards.length, 2, `★ 两块入口卡片都要在（找到 ${String(cards.length)} 块）`);
assert.deepEqual(
  cards.map((c) => attrOf(c, 'href')),
  SHARE_KINDS.map((k) => `/shares/${k}`),
  '★ 整块可点：两块卡片各自链到 /shares/room 与 /shares/seed',
);
assert.deepEqual(
  cards.map((c) => textOf(elementsWithClass(c, 'shareIntro__cardtitle')[0] ?? '')),
  [fresh('shares.introRoomsTitle'), fresh('shares.introSeedsTitle')],
  '★ 两块卡片各有自己的标题（不是同一个词）',
);
assert.deepEqual(
  cards.map((c) => textOf(elementsWithClass(c, 'shareIntro__carddesc')[0] ?? '')),
  [fresh('shares.introRoomsDesc'), fresh('shares.introSeedsDesc')],
  '★ 两块卡片各有自己的说明',
);
assert.equal(
  textOf(elementsWithClass(introGuestNull, 'shareIntro__count')[0] ?? ''),
  flat(t('shares.introGuestCount')),
  '★ 游客那一行说的是「登录后可见」',
);

/*
 * ★★ 游客的产物里**没有任何条数**，也没有任何一条分享的内容。
 * ⚠️ 两个游客用例都要过：`summary === null`（真的游客）与"游客却拿到了 summary"
 *    （缺陷形状）—— 后者才是能红的那个：它要求"游客"这一支**压过**拿到手的条数。
 * ⚠️ 正向对照（同一节里）：登录 + 同一份 summary ⇒ 那两行条数**必须**在。
 */
assert.equal(
  hasText(introAuthed, t('shares.introCount', { n: SUMMARY.room.live })),
  true,
  '★ 正向对照：登录用户看到的是条数（这条不自证的话，下面那些"没有条数"是空跑）',
);
assert.equal(
  hasText(introAuthed, t('shares.introCount', { n: SUMMARY.seed.live })),
  true,
  '★ 正向对照：另一块卡片的条数也在',
);
for (const [where, html] of [
  ['游客（summary 为 null）', introGuestNull],
  ['游客（却拿到了 summary）', introGuestWithSummary],
] as const) {
  assert.ok(hasText(html, t('shares.introGuestCount')), `★ ${where}：必须说「登录后可见」`);
  for (const needle of [
    t('shares.introCount', { n: SUMMARY.room.live }),
    t('shares.introCount', { n: SUMMARY.seed.live }),
    ROOM_CODE,
    ROOM_CODE_OTHER,
    SEED_MAIN_ONLY,
  ]) {
    assert.equal(
      hasText(html, needle),
      false,
      `★★ ${where}的产物里出现了「${needle}」—— 条数或内容泄漏了（spec §7.2）`,
    );
  }
}
/*
 * ★ "四种情况是**四句话**"（§7.2）—— 光断言"各自显示什么"不够，
 *   还要断言**它们不互相串**：游客不该看到「加载中…」，登录未取到不该看到「登录后可见」，
 *   而**取数失败**尤其不能借用「加载中…」（那正是本次要治的那个缺陷的形状）。
 */
assert.equal(
  hasText(introGuestNull, t('common.loading')),
  false,
  '★★ 游客不该看到「加载中…」（他压根不会去取，看到它就是在撒谎）',
);
assert.equal(
  hasText(introAuthedLoading, t('common.loading')),
  true,
  '★ 正向对照：登录了但还没取到 ⇒ 说的是「加载中…」',
);
assert.equal(
  hasText(introAuthedLoading, t('shares.introGuestCount')),
  false,
  '★★ 登录用户不该看到「登录后可见」（他自己就是登录用户）',
);
assert.ok(
  hasText(introGuestNull, t('shares.introRoomsDesc')) &&
    hasText(introGuestNull, t('shares.introSeedsDesc')),
  '★ 游客拿到的两块卡片连说明都在（不是只剩标题的空壳）',
);

/*
 * ★★ 取数失败那一档 —— 本次改动**新加**的唯一一条界面状态（原先它不存在，
 *    失败被渲染成「加载中」，见上面夹具那一段）。判据分三块：
 *      ① 那一行说的是「没读到条数。」，**两张卡片都换**（它们共用同一次请求）；
 *      ② 产物里**没有**「加载中…」（失败不许长得像加载中，那是这次要治的缺陷）；
 *      ③ 有一颗**可点的**「重试」（读 `disabled` 属性，而不是"按钮在不在"）。
 * ⚠️ 正面对照就在同一节里：`introAuthed`（成功）与 `introAuthedLoading`（还在取）
 *    都**不许**出现这句话、也不许出现那颗按钮 —— 否则上面三条可能是空跑。
 */
assert.equal(
  textOf(elementsWithClass(introAuthedFailed, 'shareIntro__count')[0] ?? ''),
  flat(t('shares.countFailed')),
  '★ 取数失败 ⇒ 那一行说「没读到条数。」',
);
assert.equal(
  elementsWithClass(introAuthedFailed, 'shareIntro__count').length,
  2,
  '★ 两张卡片那一行都换成了失败句（不是只有其中一张）',
);
assert.equal(
  hasText(introAuthedFailed, t('common.loading')),
  false,
  '★★ 取数失败**不许**渲染成「加载中…」—— 那会让人一直等下去（这一档原先的缺陷就是这个）',
);
/*
 * ⚠️ 结构先于可点：下面两条（"整块只有一个" + "不许落在卡片里面"）必须在
 *    `assertClickable` **之前** —— 反过来写的话，"重试被塞进卡片里"那种改法会先撞上
 *    "找不到**唯一**的入口"（卡片里那颗 + 卡片外那颗 ⇒ 实测 3 颗），
 *    而那两条结构断言就永远没机会说话（mutation 实测过）。
 */
const failActions = elementsWithClass(introAuthedFailed, 'shareIntro__actions');
assert.equal(
  failActions.length,
  1,
  `★ 「重试」整块只有一个（两张卡片共用同一次请求，找到 ${String(failActions.length)} 块）`,
);
assert.equal(
  elementsWithClass(introAuthedFailed, 'shareIntro__card').some((card) =>
    card.includes(failActions[0] ?? ''),
  ),
  false,
  '★★ 那颗「重试」不许落在卡片**里面** —— 卡片整块是一个 `<a>`，而"可点元素套可点元素"是两个浏览器行为不一致的写法',
);
assertClickable(introAuthedFailed, t('common.retry'), '介绍页取数失败');
/* ⚠️ 「可点」这条没有反面探针（这一屏没有 `busy` 之类会禁用的状态）——
   同一支 `isDisabled` 读取器在 ④ 与 ⑤ 各有一条"`busy` ⇒ 必须 disabled"的反面控制。 */
assert.equal(
  hasText(introAuthed, t('shares.countFailed')),
  false,
  '★ 正面对照：取到了条数 ⇒ 不说失败那一句',
);
assert.equal(
  hasText(introAuthedLoading, t('shares.countFailed')),
  false,
  '★ 正面对照：还在取 ⇒ 也不说失败那一句（"慢"与"挂了"必须分得开）',
);
assert.equal(
  elementsWithClass(introAuthed, 'shareIntro__actions').length +
    elementsWithClass(introAuthedLoading, 'shareIntro__actions').length,
  0,
  '★ 正面对照：没失败时那颗「重试」不渲染（否则"失败时它必须在"是恒真的）',
);
/*
 * ★★ 游客那一支要**压过**"失败"（与 `introGuestWithSummary` 同一个形状的缺陷探针）：
 *    他这一次请求压根没发（§7.2），所以既不该看到失败句，也不该看到一颗按下去
 *    什么都不会发生的「重试」。
 */
assert.equal(
  hasText(introGuestFailed, t('shares.introGuestCount')),
  true,
  '★ 游客即使拿到"取数失败"也读「登录后可见」',
);
assert.equal(
  hasText(introGuestFailed, t('shares.countFailed')),
  false,
  '★★ 游客不该看到失败句 —— 他没有请求可失败',
);
assert.deepEqual(
  elementsWithClass(introGuestFailed, 'shareIntro__actions'),
  [],
  '★★ 游客也不该看到那颗「重试」（点了什么都不会发生）',
);
ok('介绍页：标题 + 导语 + 两块卡片；四种说法不互串（含"取数失败"那一档与它的正面对照）');

// ---------------------------------------------------------------------------
console.log('③ 看板·游客（§11.2 第 2 条）');
// ---------------------------------------------------------------------------
/**
 * ⚠️ 缺陷形状（**那一帧**，不是"忘了清理"）：`userId === null` 那一支的 `setLoaded(null)`
 *    住在 effect 里，而 effect 跑在渲染之后 ⇒ 登出后的第一帧 `authed` 已是 `false`、
 *    `board` 还是满的。内容在这一帧能不被渲染，靠的是 `!authed` 是**结构性**的那一支。
 */
const guestFullBoard = renderBoard(
  { authed: false, verified: false, board: ROOM_BOARD, lastUpdatedAtMs: NOW },
  '游客却拿到了板子',
);
const guestNoBoard = renderBoard(
  { authed: false, verified: false, board: null, lastUpdatedAtMs: null },
  '游客（没有任何数据）',
);
const authedRoomBoard = renderBoard({}, '登录 + 正常');

assert.equal(
  textOf(elementsWithClass(guestFullBoard, 'share__guesttext')[0] ?? ''),
  flat(t('shares.loginNeeded')),
  '★ 游客看到的是「登录之后才能看…」那一句',
);
const loginLink = elementsWithClass(guestFullBoard, 'share__guestlogin')[0] ?? '';
assert.equal(attrOf(loginLink, 'href'), '/login', '★ 游客要有登录入口（指向 /login）');
assert.equal(textOf(loginLink), flat(t('nav.login')), '★ 登录入口用的是全站那一个词条');

for (const [where, html] of [
  ['游客（却拿到了满满的板子）', guestFullBoard],
  ['游客（没有任何数据）', guestNoBoard],
] as const) {
  assert.ok(hasText(html, t('shares.loginNeeded')), `★ ${where}：那一句必须在`);
  for (const cls of ['share__form', 'share__submit', 'share__mine', 'share__board', 'share__row']) {
    assert.deepEqual(
      elementsWithClass(html, cls),
      [],
      `★★ ${where}的产物里出现了 \`.${cls}\` —— 内容或配方泄漏给了游客（spec §1.1）`,
    );
  }
  assert.equal(hasText(html, t('shares.formRoomCode')), false, '★★ 游客不该看到发布表单');
  for (const needle of [ROOM_CODE, ROOM_CODE_OTHER, SEED_MAIN_ONLY, MINE_NOTE]) {
    assert.equal(
      hasText(html, needle),
      false,
      `★★ ${where}的产物里出现了「${needle}」—— 内容泄漏了`,
    );
  }
}
/* 正向对照：同一节里，登录用户的产物必须**有**这些东西（否则上面全是空跑）。 */
assert.ok(hasText(authedRoomBoard, t('shares.formRoomCode')), '★ 正向对照：登录用户看得到表单');
assert.equal(
  elementsWithClass(authedRoomBoard, 'share__row').length,
  2,
  '★ 正向对照：看板上有两行',
);
assert.equal(
  hasText(authedRoomBoard, t('shares.loginNeeded')),
  false,
  '★★ 登录用户不该看到「登录之后才能看…」',
);
ok('看板·游客：只看到那句话 + 登录入口；无配方、无内容（含"登出后那一帧手里还是满板子"的形状）');

// ---------------------------------------------------------------------------
console.log('④ 看板·未验证邮箱（§11.2 第 3 条）');
// ---------------------------------------------------------------------------
const unverified = renderBoard({ verified: false }, '未验证邮箱');
const unverifiedBusy = renderBoard({ verified: false, busy: true }, '未验证邮箱（busy 探针）');

assert.equal(
  textOf(elementsWithClass(unverified, 'share__verifytext')[0] ?? ''),
  flat(t('shares.needVerify')),
  '★ 出现"先验证邮箱"那一句',
);
assertClickable(unverified, t('shares.resendVerify'), '未验证邮箱');
assert.equal(
  isDisabled(
    buttons(unverifiedBusy).find((b) => b.text === flat(t('shares.resendVerify')))?.attrs ?? '',
  ),
  true,
  '★★ 探针：`busy` 时那颗重发按钮**必须**带 disabled（否则上面那条"可点"是恒真的）',
);
assert.equal(
  elementsWithClass(unverified, 'share__row').length,
  2,
  '★ 看板**照常**（未验证只是不能发，不影响看）',
);
assert.deepEqual(
  elementsWithClass(unverified, 'share__submit'),
  [],
  '★ 未验证时**不挂**发布表单（挂上去就是一颗注定 403 的按钮）—— 正向对照在下一条',
);
assert.equal(
  elementsWithClass(authedRoomBoard, 'share__submit').length,
  1,
  '★ 正向对照：已验证的板子上表单在（所以上面那条"不在"才有意义）',
);
ok('未验证邮箱：先验证那一句 + 可点的重发入口 + 看板照常 + 不挂表单');

// ---------------------------------------------------------------------------
console.log('⑤ 看板·接口挂了（§7.5 第 4 行：绝不清空）');
// ---------------------------------------------------------------------------
const firstFail = renderBoard(
  { board: null, loadError: t('shares.loadFailed'), staleSecs: null, lastUpdatedAtMs: null },
  '第一次就没读到',
);
const refreshFail = renderBoard(
  {
    board: ROOM_BOARD,
    loadError: t('shares.loadFailed'),
    staleSecs: 7,
    lastUpdatedAtMs: NOW - 7_000,
  },
  '刷新失败但手里有旧列表',
);
const loading = renderBoard({ board: null, loadError: null, lastUpdatedAtMs: null }, '加载中');

assert.equal(
  textOf(elementsWithClass(firstFail, 'notice--bad')[0] ?? ''),
  flat(t('shares.loadFailed')),
  '★ 第一次没读到时说的是失败那一句',
);
assertClickable(firstFail, t('common.retry'), '第一次失败');
/*
 * ★ 探针：「重试可点」这条**必须有反面**，否则它可能只是"读取器看不见 disabled"。
 *    同一个板子、同一颗按钮，`busy: true` 时必须带上 disabled。
 */
assert.equal(
  isDisabled(
    buttons(
      renderBoard({
        board: ROOM_BOARD,
        loadError: t('shares.loadFailed'),
        staleSecs: 7,
        busy: true,
      }),
    ).find((b) => b.text === flat(t('common.retry')))?.attrs ?? '',
  ),
  true,
  '★★ 探针：`busy` 时那颗「重试」**必须**带 disabled（否则上面那条"可点"是恒真的）',
);
assert.deepEqual(
  elementsWithClass(firstFail, 'share__board'),
  [],
  '★ 第一次失败时没有列表可留（正向对照：刷新失败那一次**留着**旧列表）',
);

assert.equal(
  textOf(elementsWithClass(refreshFail, 'notice--info')[0] ?? ''),
  flat(t('shares.refreshFailed', { secs: 7 })),
  '★ 刷新失败时要说清"下面是 N 秒前的数据"（那个 N 必须真的在里面）',
);
assert.equal(
  elementsWithClass(refreshFail, 'share__row').length,
  2,
  '★★ 刷新失败**绝不清空**旧列表：那两行必须还在（§7.5 第 4 行）',
);
assertClickable(refreshFail, t('common.retry'), '刷新失败');
assert.equal(
  hasText(refreshFail, t('common.loading')),
  false,
  '★★ 手里有旧列表时说「加载中…」是错的（那会让人以为列表没了）',
);
assert.equal(
  hasText(loading, t('common.loading')),
  true,
  '★ 正向对照：第一次在飞、又没有错 ⇒ 说「加载中…」',
);
assert.equal(
  elementsWithClass(loading, 'share__row').length,
  0,
  '★ 正向对照：加载中确实一行都没有（于是"刷新失败还剩两行"那条有对照）',
);
assert.equal(
  hasText(refreshFail, t('shares.refreshFailed', { secs: 99 })),
  false,
  '★★ 秒数得是**真的那个**（7 秒），不是随便印一个数字',
);
ok('接口挂了：第一次失败只有错误 + 可点重试；刷新失败保留旧列表并说明有多旧');

// ---------------------------------------------------------------------------
console.log('⑥ 看板·正常：四档时长、默认值、提交键文案（§11.2 第 4、10 条）');
// ---------------------------------------------------------------------------
/*
 * ⚠️ 冻结值（spec §13）先钉常量再钉界面：只断言"选中的那一档等于 `DEFAULT_SHARE_MINUTES`"
 *    的话，把常量改成 10 那条断言**跟着走**、照样绿 —— 那是装饰。
 */
assert.deepEqual([...SHARE_MINUTES], [5, 10, 15, 20], '★★ 冻结的四档时长（spec §13）');
assert.equal(DEFAULT_SHARE_MINUTES, 5, '★★ 冻结的默认时长就是 5（spec §13）');
assert.equal(SHARE_KINDS.length, 2, '★ 冻结的两个 kind（第三个 kind 要连夹具一起补）');

const radiosOf = (html: string, name: string): string[] =>
  [...html.matchAll(/<input\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => attrOf(tag, 'name') === name);

const roomRadios = radiosOf(authedRoomBoard, 'share-minutes-room');
assert.deepEqual(
  roomRadios.map((tag) => attrOf(tag, 'value')),
  SHARE_MINUTES.map(String),
  '★ 四档时长就是那四个值（区间校验会放进来界面上选不到的值，这里钉住）',
);
const checkedRadios = roomRadios.filter((tag) => /(?:^|\s)checked(?:\s|=|$)/.test(tag));
assert.equal(
  checkedRadios.length,
  1,
  `★ 恰好一档默认选中（找到 ${String(checkedRadios.length)} 档）`,
);
assert.equal(
  attrOf(checkedRadios[0] ?? '', 'value'),
  '5',
  '★★ 默认选中的是 **5 分钟**（字面 5，不是 `DEFAULT_SHARE_MINUTES` —— 那样常量改了它也跟着改）',
);
assert.equal(
  textOf(elementsWithClass(authedRoomBoard, 'share__minuteslegend')[0] ?? ''),
  flat(t('shares.formMinutes')),
  '★ 那四档有个说明它们是干什么的 legend',
);
for (const n of SHARE_MINUTES) {
  assert.ok(
    hasText(
      elementsWithClass(authedRoomBoard, 'share__minutes')[0] ?? '',
      t('shares.minutes', { n }),
    ),
    `★ 「${t('shares.minutes', { n })}」这一档要在`,
  );
}

/*
 * ★★ 提交键的文案 —— **读那颗按钮自己的文字再比相等**。
 *
 * ⚠️⚠️ 这里**绝不能**写 `textOf(html).includes(t('shares.formSubmitRoom'))`：
 *    「发到看板」是「发到看板（替换你正在展示的那条）」的**前缀**（英文同理）
 *    ⇒ `includes` **恒为真**，换哪一句它都绿。下面那条探针把前缀关系钉下来，
 *    好让下一个人知道这个坑还在（改了文案就要重新读这一段）。
 */
const submitButton = (html: string, where: string): { attrs: string; text: string } => {
  const found = buttons(html).filter((b) => hasClass(b.attrs, 'share__submit'));
  assert.equal(
    found.length,
    1,
    `★ ${where}：应当恰好有一颗提交键（找到 ${String(found.length)} 颗）`,
  );
  return found[0] ?? { attrs: '', text: '' };
};
assert.ok(
  t('shares.formReplaceRoom').startsWith(t('shares.formSubmitRoom')),
  '★★ 探针：「发到看板」是「发到看板（替换…）」的前缀 ⇒ 这一格用 `includes` 断言就是恒真',
);
assert.notEqual(
  t('shares.formReplaceRoom'),
  t('shares.formSubmitRoom'),
  '★★ 探针：两句文案本身必须不同（相同的话下面那对断言里有一半是空跑）',
);

const liveSubmit = submitButton(authedRoomBoard, '有在展示');
assert.equal(
  liveSubmit.text,
  flat(t('shares.formReplaceRoom')),
  '★★ room 有在展示时，提交键的文案必须是"替换"那一句（替换掉的那条再也回不来，而这件事只写在按钮上）',
);
const noLiveSubmit = submitButton(
  renderBoard({ board: ROOM_BOARD_NO_MINE }, '没有在展示'),
  '没有在展示',
);
assert.equal(
  noLiveSubmit.text,
  flat(t('shares.formSubmitRoom')),
  '★★ room 没有在展示时，提交键就是「发到看板」',
);
assert.notEqual(
  noLiveSubmit.text,
  flat(t('shares.formReplaceRoom')),
  '★★ 没有在展示时**不许**出现"替换"那一句（同一颗按钮的正反两半）',
);
/* 展开发布表单那个按钮：两种状态也是两句不同的话（§7.3 那张表）。 */
assert.equal(
  textOf(elementsWithClass(authedRoomBoard, 'share__postbtn')[0] ?? ''),
  flat(t('shares.formOpenRoomAgain')),
  '★ 有在展示时展开键说「换一条」',
);
assert.equal(
  textOf(elementsWithClass(renderBoard({ board: ROOM_BOARD_NO_MINE }), 'share__postbtn')[0] ?? ''),
  flat(t('shares.formOpenRoom')),
  '★ 没有在展示时展开键说「挂一条」',
);
/* 标签页与回介绍页的路。 */
const tabs = elementsWithClass(authedRoomBoard, 'share__tab');
assert.deepEqual(
  tabs.map((tab) => textOf(tab)),
  [fresh('shares.tabRoom'), fresh('shares.tabSeed')],
  '★ 两个标签页各自一句（它们与介绍页卡片那两句**不是**同一句）',
);
assert.deepEqual(
  tabs.map((tab) => attrOf(tab, 'href')),
  SHARE_KINDS.map((k) => `/shares/${k}`),
  '★ 标签页是**真链接**（分享出去的 URL、刷新、前进后退都要落在同一屏）',
);
assert.equal(attrOf(tabs[0] ?? '', 'aria-current'), 'page', '★ 当前那一页要标出来');
assert.equal(attrOf(tabs[1] ?? '', 'aria-current'), null, '★ 另一页不标');
assert.equal(
  attrOf(elementsWithClass(authedRoomBoard, 'share__back')[0] ?? '', 'href'),
  '/shares',
  '★ 有一条回介绍页的路（看板是"内容不给游客看"的那一面）',
);
/* 「N 秒前更新」：本地两个读数相减，随本地计时走。 */
assert.equal(
  textOf(elementsWithClass(authedRoomBoard, 'share__updated')[0] ?? ''),
  flat(t('shares.updatedAgo', { secs: 7 })),
  '★ 「N 秒前更新」的秒数由 `nowMs` 与 `lastUpdatedAtMs` 现算（这里 7 秒）',
);
assert.deepEqual(
  elementsWithClass(renderBoard({ lastUpdatedAtMs: null }), 'share__updated'),
  [],
  '★★ 还没成功取到过时**整行不渲染**（写「0 秒前更新」是撒谎）—— 正向对照就是上面那条',
);
/* 截断：不许安静截断（§5.1）。 */
assert.equal(
  textOf(
    elementsWithClass(
      renderBoard({ board: { ...ROOM_BOARD, truncated: true } }),
      'share__truncated',
    )[0] ?? '',
  ),
  flat(t('shares.truncated')),
  '★ 看板被截断时要说一句',
);
assert.deepEqual(
  elementsWithClass(authedRoomBoard, 'share__truncated'),
  [],
  '★ 没截断时不说（正反两半）',
);
ok('正常：四档时长 + 默认 5 + 提交键文案（相等比较）+ 标签页/回程/新鲜度/截断');

// ---------------------------------------------------------------------------
console.log('⑦ 剩余时间三档（§11.2 第 5 条）');
// ---------------------------------------------------------------------------
/*
 * ★★ 三档必须**一起**钉，而且"已经到点"那一档要靠**正向对照**才能成立：
 *    "产物里没有 C9M4R"这句话，在组件整个炸掉、或者夹具没被渲染的时候**也成立**。
 *    ⇒ 所以先断言另外两档**在**，再断言到点那一档**不在**，并且行数恰好是 2。
 */
const rows = elementsWithClass(authedRoomBoard, 'share__row');
assert.equal(rows.length, 2, '★ 看板上有两行（夹具里给了三条，其中一条已到点）');
assert.equal(
  textOf(elementsWithClass(rows[0] ?? '', 'share__remain')[0] ?? ''),
  flat(t('shares.remainMinutes', { n: 12 })),
  '★ 第一档：还剩 11 分 30 秒 ⇒ 「还剩 12 分钟」',
);
assert.equal(
  textOf(elementsWithClass(rows[1] ?? '', 'share__remain')[0] ?? ''),
  flat(t('shares.remainUnderOne')),
  '★ 第二档：还剩 30 秒 ⇒ 「不到 1 分钟」',
);
assert.ok(hasText(authedRoomBoard, ROOM_CODE), '★ 正向对照：第一行的房间号在产物里');
assert.ok(hasText(authedRoomBoard, ROOM_CODE_OTHER), '★ 正向对照：第二行的房间号在产物里');
assert.equal(
  hasText(authedRoomBoard, ROOM_CODE_EXPIRED),
  false,
  '★★ 第三档：已经到点的那条**不在产物里**（"到点那一秒从画面上消失"由本地计时负责）',
);
assert.equal(
  hasText(authedRoomBoard, 'expired one'),
  false,
  '★★ 到点那条的**说明**也不在（否则只是房间号被换掉了而已，不能算"整行消失"）',
);
/* 整块只有过期行时：一行都没有，且说的是"现在没有人在分享"。 */
const onlyExpired = renderBoard({ board: ROOM_BOARD_ONLY_EXPIRED }, '只有一条已到点的行');
assert.deepEqual(elementsWithClass(onlyExpired, 'share__row'), [], '★ 只剩过期行时一行都不渲染');
assert.equal(
  textOf(elementsWithClass(onlyExpired, 'share__empty')[0] ?? ''),
  flat(t('shares.boardEmpty')),
  '★ 而且要说「现在没有人在分享。」—— 空看板不是"坏了"，是要有话说',
);
assert.equal(
  hasText(renderBoard({ board: ROOM_BOARD_NOTHING }, '空看板'), ROOM_CODE),
  false,
  '★ 一条都没有时当然也没有房间号',
);
ok('三档剩余时间（含正反对照与"只剩过期行"的整块画面）');

// ---------------------------------------------------------------------------
console.log('⑧ 「你」标记与「下架」按钮（§11.2 第 6 条）');
// ---------------------------------------------------------------------------
const myRow = rows[0] ?? '';
const otherRow = rows[1] ?? '';
assert.equal(elementsWithClass(myRow, 'share__you').length, 1, '★ 我自己那一行带「你」标记');
assert.deepEqual(
  elementsWithClass(otherRow, 'share__you'),
  [],
  '★★ 别人的行**没有**「你」标记（正反两半：标记在产物里确实存在，只是不在这行上）',
);
assert.equal(
  textOf(elementsWithClass(myRow, 'share__you')[0] ?? ''),
  flat(t('shares.boardYou')),
  '★ 那个标记就是「你」这一个词',
);
/*
 * ★★ 别人的行**没有下架按钮** —— 而这一条能成立，是因为下架/恢复只挂在
 *    「你的一条」那几条 `mine` 行上（结构上分开，不是靠一个 `if` 判出来的）。
 * ⚠️ 正向对照：**同一次渲染里**我自己的行确实在下架（按钮在 `share__minelist` 里）。
 */
const hideButtons = buttons(authedRoomBoard).filter((b) => b.text === flat(t('shares.hide')));
assert.equal(
  hideButtons.length,
  1,
  `★ 正向对照：我那条 active 的行有一颗「下架」（找到 ${String(hideButtons.length)} 颗）`,
);
assert.equal(isDisabled(hideButtons[0]?.attrs ?? ''), false, '★ 那颗「下架」是可点的');
assert.deepEqual(
  buttons(otherRow).filter((b) => b.text === flat(t('shares.hide'))),
  [],
  '★★ 别人的行上没有「下架」',
);
assert.deepEqual(
  buttons(myRow).filter((b) => b.text === flat(t('shares.hide'))),
  [],
  '★★ 看板上我自己的行上也没有「下架」（它长在「你的一条」里，不是长在行上）',
);
assert.equal(
  elementsWithClass(authedRoomBoard, 'share__minelist').length,
  1,
  '★ 正向对照：「你的一条」的列表在（下架按钮就住在里面）',
);
const othersOnly = renderBoard({ board: ROOM_BOARD_OTHERS_ONLY }, '只有别人的行');
assert.deepEqual(
  buttons(othersOnly).filter((b) => b.text === flat(t('shares.hide'))),
  [],
  '★★ 只看别人的行时，全页一颗「下架」都没有',
);
assert.equal(
  textOf(elementsWithClass(othersOnly, 'share__minestate')[0] ?? ''),
  flat(t('shares.mineNone')),
  '★ 而「你的一条」说的是「你现在没有挂东西。」',
);
/* 「你的一条」的四个形态（§7.3 第 2 行）—— 状态句各不相同。 */
const hiddenMine = renderBoard({ board: ROOM_BOARD_HIDDEN }, '我下架了一条');
assert.equal(
  textOf(elementsWithClass(hiddenMine, 'share__minestate')[0] ?? ''),
  flat(t('shares.mineHidden')),
  '★ 已下架未过期 ⇒ 「你下架了这一条。」',
);
const restoreButtons = buttons(hiddenMine).filter((b) => b.text === flat(t('shares.restore')));
assert.equal(restoreButtons.length, 1, '★ 那颗按钮是「恢复」');
assert.equal(isDisabled(restoreButtons[0]?.attrs ?? ''), false, '★ 「恢复」是可点的');
assert.deepEqual(
  buttons(hiddenMine).filter((b) => b.text === flat(t('shares.hide'))),
  [],
  '★ 已下架的行上没有「下架」（正反配对）',
);
assert.equal(
  textOf(elementsWithClass(authedRoomBoard, 'share__minestate')[0] ?? ''),
  flat(t('shares.mineActive')),
  '★ 有在展示 ⇒ 「你正在展示这一条。」（三种状态句是三句不同的话）',
);
assert.equal(
  hasText(authedRoomBoard, t('shares.hideHint')),
  true,
  '★ 有东西可下架时，那句"下架可恢复、**到点**不可恢复"要在',
);
assert.equal(
  hasText(othersOnly, t('shares.hideHint')),
  false,
  '★★ 没有我的行时不说那句（它说的是一个不存在的动作）—— 正向对照就是上一条',
);
ok('「你」标记 + 下架/恢复只在我自己的行上（正反两半）+ 四种状态句');

// ---------------------------------------------------------------------------
console.log('⑨ 每一行都有「复制」（§11.2 第 7 条）');
// ---------------------------------------------------------------------------
/*
 * ★ 复制是给**看的人**用的（把**别人的**房间号拷进游戏），所以别人的行才是主要用途。
 *   正向对照是"行数恰好是 2"：行数为 0 时 `every(...)` 恒真 —— 那正是空跑的形状。
 */
const copyOf = (rowHtml: string): { attrs: string; text: string }[] =>
  buttons(rowHtml).filter((b) => hasClass(b.attrs, 'share__copy'));
assert.equal(rows.length, 2, '★ 探针：两行确实渲染出来了（否则下面的 every 是空跑）');
for (const [i, row] of rows.entries()) {
  const copies = copyOf(row);
  assert.equal(
    copies.length,
    1,
    `★ 第 ${String(i + 1)} 行有「复制」（room 每行一个值 ⇒ 恰好一颗；找到 ${String(copies.length)} 颗）`,
  );
  assert.equal(copies[0]?.text, flat(t('shares.copy')), '★ 那颗按钮的文字就是「复制」');
  assert.equal(
    attrOf(copies[0]?.attrs ?? '', 'aria-label'),
    `${t('shares.copy')}: ${i === 0 ? ROOM_CODE : ROOM_CODE_OTHER}`,
    '★★ aria-label 里要带上**这一行**的那个值（一屏二十几个「复制」读屏时分不清是哪一个）',
  );
}
assert.ok(
  attrOf(copyOf(otherRow)[0]?.attrs ?? '', 'aria-label')?.includes(ROOM_CODE_OTHER),
  '★ 别人的那一行确实带着他自己的房间号',
);
assert.ok(
  buttons(othersOnly).filter((b) => hasClass(b.attrs, 'share__copy')).length > 0,
  '★ 只看别人的行时复制照样在（那是它的主要用途）',
);
/* seed 行：**每个填了的值**各一颗（⑩ 里数的是同一件事的另一半）。 */
const seedRows = elementsWithClass(
  renderBoard({ kind: 'seed', board: SEED_BOARD }, '种子板'),
  'share__row',
);
assert.equal(copyOf(seedRows[0] ?? '').length, 1, '★ 只填主世界的 seed 行 ⇒ 一颗复制');
assert.equal(copyOf(seedRows[1] ?? '').length, 4, '★ 四个都填了的 seed 行 ⇒ 四颗复制');
ok('复制：每一行都有（含别人的行），且 aria-label 指向本行自己的值');

// ---------------------------------------------------------------------------
console.log('⑩ seed 行只渲染填了的格子（§11.2 第 8 条）');
// ---------------------------------------------------------------------------
const seedHtml = renderBoard({ kind: 'seed', board: SEED_BOARD }, '种子板');
const seedRowList = elementsWithClass(seedHtml, 'share__row');
assert.equal(seedRowList.length, 2, '★ 探针：种子板上有两行');
const onlyRow = seedRowList[0] ?? '';
const allRow = seedRowList[1] ?? '';
const slotLabels = (rowHtml: string): string[] =>
  elementsWithClass(rowHtml, 'share__seedlabel').map((el) => textOf(el));
assert.deepEqual(
  slotLabels(onlyRow),
  [fresh('shares.formOverworld')],
  '★★ 只填了主世界的行**只**渲染主世界那一格',
);
assert.equal(
  elementsWithClass(onlyRow, 'share__seed').length,
  1,
  '★ 那一行只有一个格子（不是四个带破折号的空格子 —— 那看起来像"丢了"）',
);
for (const key of ['shares.formNether', 'shares.formEnd', 'shares.formRng'] as const) {
  assert.equal(hasText(onlyRow, t(key)), false, `★★ 只填主世界的那一行里出现了「${t(key)}」`);
}
assert.equal(
  textOf(elementsWithClass(onlyRow, 'share__seedvalue')[0] ?? ''),
  flat(SEED_MAIN_ONLY),
  '★ 主世界那一格显示的是它的值',
);
/*
 * ⚠️ 正向对照必须**逐行**做：那四个标签在**整页**上都在（第二行四个都填了），
 *    所以"整页没有『末地种子』"这种写法在这里恒假、毫无意义。
 */
assert.deepEqual(
  slotLabels(allRow),
  ['shares.formOverworld', 'shares.formNether', 'shares.formEnd', 'shares.formRng'].map(fresh),
  '★ 正向对照：四个都填了的那一行按固定顺序渲染四格（主世界 / 下界 / 末地 / RNG）',
);
assert.deepEqual(
  elementsWithClass(allRow, 'share__seedvalue').map((el) => textOf(el)),
  [SEED_MAIN_ALL, SEED_NETHER, SEED_END, SEED_RNG].map(flat),
  '★ 四格各自显示自己的值',
);
assert.ok(
  hasText(seedHtml, t('shares.formEnd')),
  '★ 探针：四个标签在整页上确实都在（所以上面的逐行断言才有对照）',
);
ok('seed：只渲染填了的格子（逐行正反配对）');

// ---------------------------------------------------------------------------
console.log('⑪ 说明为空时那一块不渲染（§11.2 第 9 条）');
// ---------------------------------------------------------------------------
/*
 * ★ `note` 的空值是**空串**（不是 `null`），而"渲染一个空的 `<p>`"会在两行之间
 *   留一条空白，看起来像这一行坏了。判据用 `trim()`：`'   '` 也按"没写"处理。
 * ⚠️ 正向对照：同一次渲染里，有说明的那一行**必须**有那一块（否则"找不到"恒成立）。
 */
const noteBlocks = (html: string): string[] => elementsWithClass(html, 'share__note');
assert.equal(
  noteBlocks(authedRoomBoard).length,
  1,
  `★★ 三条夹具里只有一条有说明 ⇒ 产物里只能有一块说明（找到 ${String(noteBlocks(authedRoomBoard).length)} 块）`,
);
assert.equal(
  textOf(noteBlocks(authedRoomBoard)[0] ?? ''),
  flat(MINE_NOTE),
  '★ 有说明那一条的说明文字原样渲染（渲染的是**原文**，不是归一化之后的结果）',
);
assert.deepEqual(
  noteBlocks(otherRow),
  [],
  '★★ 说明为空（空串）的那一行，`share__note` 一块都不渲染',
);
assert.ok(
  hasText(otherRow, ROOM_CODE_OTHER),
  '★ 正向对照：那一行**在**（只是没有说明那一块）—— 否则"没有说明"可能只是整行没渲染',
);
const blankNote = renderBoard(
  {
    board: roomBoard({
      items: [
        roomItem({
          id: 'r-blank',
          code: ROOM_CODE,
          note: '   ',
          authorName: 'Bo',
          mine: false,
          remain: 5 * MIN,
        }),
      ],
      mine: [],
    }),
  },
  '说明只有空白',
);
assert.deepEqual(
  noteBlocks(blankNote),
  [],
  "★★ 说明全是空白（'   '）时也当没写（服务端不做 trim，所以这种值真的存得进去）",
);
ok('说明：空串与纯空白都不渲染那一块，有说明的那一条必须有（正反配对）');

// ---------------------------------------------------------------------------
console.log('⑫ seed 到额度：提交键禁用 + 那句话（§11.2 第 11 条）');
// ---------------------------------------------------------------------------
const atLimitHtml = renderBoard({ kind: 'seed', board: SEED_AT_LIMIT_BOARD }, 'seed 到额度');
assert.equal(
  textOf(elementsWithClass(atLimitHtml, 'share__minestate')[0] ?? ''),
  flat(t('shares.mineCount', { n: SHARE_LIMITS.seed, max: SHARE_LIMITS.seed })),
  '★ seed 报的是条数（「你在展示 N / 20 条」）',
);
const limitSubmit = submitButton(atLimitHtml, 'seed 到额度');
assert.equal(
  isDisabled(limitSubmit.attrs),
  true,
  '★★ 到额度时提交键是 **disabled** 的（不是隐藏）',
);
assert.ok(
  hasText(atLimitHtml, t('shares.atLimitSeeds', { max: SHARE_LIMITS.seed })),
  '★★ 而且要说明为什么（光灰着不说原因，用户只会以为页面坏了）',
);
assert.equal(
  isDisabled(submitButton(authedRoomBoard, 'room 正常').attrs),
  false,
  '★★ 正向对照：同一份代码渲出来的 room 提交键**不**禁用（否则那个读取器是恒真的）',
);
assert.equal(
  isDisabled(
    submitButton(renderBoard({ kind: 'seed', board: SEED_BOARD }, 'seed 未到额度'), 'seed 未到额度')
      .attrs,
  ),
  false,
  '★★ 正向对照：seed 没到额度时不禁用 ⇒ 上面那条 disabled 是**额度**造成的，不是常量造成的',
);
assert.equal(
  hasText(
    renderBoard({ kind: 'seed', board: SEED_BOARD }),
    t('shares.atLimitSeeds', { max: SHARE_LIMITS.seed }),
  ),
  false,
  '★ 没到额度时不说那句话（正反两半）',
);
ok('seed 额度：禁用 + 解释，且同一份代码在未到额度时不禁用（正反对照）');

// ---------------------------------------------------------------------------
console.log('⑬ 词条：本栏目这两个视图用到的 key 都在，而且两种语言都有真值');
// ---------------------------------------------------------------------------
/*
 * ⚠️ i18next 查不到 key 时**原样返回 key**（不报错）⇒ 打错一个字母的表现是
 *    界面上印出一串 `shares.xxyy`，而它既不会被类型检查发现（`t` 的入参是 string），
 *    也不会被别的门禁发现。下面这张表是**本栏目界面用到的那一批**，逐条查。
 * ⚠️★ 表里还有 `shareErrors.ts` 交给 `t()` 的四条（`atLimitRestore` 与三条 `err*`）：
 *    那是这一栏**唯一**一条"先有词条、后有调用点、而且调用点是**拼出来的**"的路
 *    （`t(SHARE_STATE_REASON_KEYS[reason])`）⇒ `services/api/src/i18n-keys.test.ts`
 *    的"字面量 `t()`"扫描**看不见它们**，能证明它们存在的只有这里。
 * ⚠️ 那个数字是**手抄的**（本仓惯例，见 `resourcerender.tsx`）：它防的是
 *    "为了让红的变绿，把某一行从表里删掉"。
 */
const FROZEN_KEYS = [
  'nav.shares',
  'nav.login',
  'common.loading',
  'common.retry',
  'shares.introLead',
  'shares.introRoomsTitle',
  'shares.introRoomsDesc',
  'shares.introSeedsTitle',
  'shares.introSeedsDesc',
  'shares.introCount',
  'shares.introGuestCount',
  'shares.countFailed',
  'shares.tabRoom',
  'shares.tabSeed',
  'shares.backToIntro',
  'shares.loginNeeded',
  'shares.needVerify',
  'shares.resendVerify',
  'shares.mineNone',
  'shares.mineHidden',
  'shares.mineActive',
  'shares.mineCount',
  'shares.formRoomCode',
  'shares.formRoomCodeHint',
  'shares.formOpenRoom',
  'shares.formOpenRoomAgain',
  'shares.formOpenSeed',
  'shares.formOpenSeedAgain',
  'shares.formOverworld',
  'shares.formNether',
  'shares.formEnd',
  'shares.formRng',
  'shares.formSeedOptional',
  'shares.formNote',
  'shares.formNoteHint',
  'shares.formMinutes',
  'shares.minutes',
  'shares.formSubmitRoom',
  'shares.formReplaceRoom',
  'shares.formSubmitSeed',
  'shares.formSubmitting',
  'shares.boardTitle',
  'shares.boardEmpty',
  'shares.boardYou',
  'shares.boardBy',
  'shares.remainMinutes',
  'shares.remainUnderOne',
  'shares.copy',
  'shares.hide',
  'shares.restore',
  'shares.hideHint',
  'shares.atLimitSeeds',
  'shares.atLimitRestore',
  'shares.errExpired',
  'shares.errNotActive',
  'shares.errNotHidden',
  'shares.refreshFailed',
  'shares.updatedAgo',
  'shares.loadFailed',
  'shares.truncated',
] as const;
assert.equal(FROZEN_KEYS.length, 60, '探针：冻结的清单就是 60 条');
assert.equal(new Set(FROZEN_KEYS).size, FROZEN_KEYS.length, '探针：清单里没有重复');
for (const key of FROZEN_KEYS) {
  assert.ok(i18n.exists(key), `★ 词条 ${key} 在【${LANG}】里不存在（界面上会原样印出这个 key）`);
  assert.notEqual(t(key), key, `★ 词条 ${key} 在【${LANG}】里没有真值`);
}
ok(`60 个 key 在【${LANG}】里都存在且有真值`);

/** 取词条并压平（比对用）—— 集中一处，免得每处都写一遍 `flat(t(...))`。 */
function fresh(key: string, opts?: Record<string, unknown>): string {
  return flat(t(key, opts));
}

// ---------------------------------------------------------------------------
console.log('⑭ 裸 key 泄漏 + 字面的 `**`（含反面控制探针）');
// ---------------------------------------------------------------------------
const everyProduct = [
  introGuestNull,
  introGuestWithSummary,
  introAuthed,
  introAuthedLoading,
  introAuthedFailed,
  introGuestFailed,
  guestFullBoard,
  guestNoBoard,
  authedRoomBoard,
  unverified,
  firstFail,
  refreshFail,
  loading,
  onlyExpired,
  othersOnly,
  hiddenMine,
  seedHtml,
  atLimitHtml,
  skewHtml,
].join('');
const allRaw = rawText(everyProduct);

/*
 * ⚠️ 裸 key 扫描（含**属性**里的值）：`aria-label` 里漏了英文词条、别处印出 key ——
 *    这些都只有扫原文才看得见（`textOf` 会把属性整段吃掉）。
 * ⚠️ 扫描器本身必须能命中（否则它是恒真的空跑）。
 */
const BARE_KEY = /(?:shares|nav|common|auth|home)\.[A-Za-z][A-Za-z0-9.]*/g;
assert.notEqual(
  [...'shares.doesNotExist nav.nope'.matchAll(BARE_KEY)].length,
  0,
  '★ 探针：裸 key 扫描器本身必须能命中',
);
/*
 * ⚠️ 这里**不放行任何东西**：产物里合法出现的只有类名与路径
 *    （`share__row` 之类不含 `.`，`/shares/room` 不含 `.`）——
 *    放行一条就等于给泄漏开一扇门。
 */
const leakedKeys = [...new Set([...allRaw.matchAll(BARE_KEY)].map((m) => m[0]))];
assert.deepEqual(leakedKeys, [], `★★ 产物里有裸 key：${leakedKeys.join(', ')}`);

/*
 * ⚠️⚠️ 字面的 `**`：本仓词条里用 `**这样**` 表示强调（`components/Emphasis.tsx`），
 *    只有经过 `em()` / `emText()` 才会消失。落到没处理的地方，用户直接看到一对星号 ——
 *    而词条存在、两种语言对齐、字体覆盖都过，**没有任何别的检查会发现**。
 * ⚠️ 扫描必须作用在**原文**上（`allRaw`），不能用被 `flat()` 处理过的那一份：
 *    `roleguide.tsx` 那条恒真的守卫就是因为它的 `norm()` 顺手把 `*` 擦掉了（§5.63）。
 */
assert.equal(
  rawText('<p>a**b**c</p>').includes('**'),
  true,
  '★ 探针：`**` 扫描本身必须能命中一个带星号的串',
);
assert.equal(
  t('shares.hideHint').includes('**'),
  true,
  '★★ 反面控制探针：`shares.hideHint` 里的 `**` 没了 ⇒ 下面"产物里没有字面 `**`"这条退化成空跑（它是本栏目唯一带标记的词条）',
);
const hideHintBlock = elementsWithClass(authedRoomBoard, 'share__hidehint')[0] ?? '';
assert.equal(
  hideHintBlock.includes('<strong>'),
  true,
  '★ 那句提示里的强调必须真的变成了 `<strong>`（走了 `em()`）',
);
assert.equal(hideHintBlock.includes('**'), false, '★★ 那句提示里不许留下字面的 `**`');
assert.deepEqual(
  [...allRaw.matchAll(/\*\*/g)].map((m) => m[0]),
  [],
  '★★ 产物里有字面的 `**`：带标记的词条必须过 `em()`（节点）或 `emText()`（字符串上下文）',
);
/*
 * ★ 「本栏目只有这一处强调」—— 判据写成"产物里所有 `<strong>` 都来自那一句提示"，
 *   而不是一个手抄的处数：手抄的数字会在夹具增减时无意义地红，而这条能抓住
 *   "某个别的词条被谁顺手套了 `em()`"（那份强调没有对着任何设计口径）。
 */
const strongTotal = (everyProduct.match(/<strong>/g) ?? []).length;
const hintBlocks = elementsWithClass(everyProduct, 'share__hidehint');
const strongInHints = hintBlocks.reduce((n, b) => n + (b.match(/<strong>/g) ?? []).length, 0);
assert.ok(hintBlocks.length > 0, '★ 探针：至少有一处「下架/恢复」提示（否则下面那条计数是空对空）');
assert.equal(
  strongTotal,
  strongInHints,
  `★★ 产物里的 <strong> 必须全部来自那一句提示（共 ${String(strongTotal)} 处，提示里 ${String(strongInHints)} 处）`,
);
ok(
  `无裸 key、无字面 **（${String(everyProduct.length)} 字符，${String(strongTotal)} 处 <strong>）`,
);

// ---------------------------------------------------------------------------
if (LANG === 'en') {
  console.log('⑮ 英文界面里零汉字（§11.2 第 12 条）');
  /*
   * ⚠️ 扫的是**原文**（含属性）：`aria-label` / `title` / `placeholder` 里的中文
   *    同样是"英文界面上冒出了中文"。`textOf` 把属性吃掉了，所以不能用它。
   * ⚠️ `fallbackLng: false` 时缺英文词条会**原样返回 key**（由 ⑭ 抓），
   *    这一条抓的是另一类：有人把中文**写死在组件/夹具里**。
   */
  const han = [...new Set(allRaw.match(/[\u4e00-\u9fff]+/g) ?? [])];
  assert.deepEqual(han, [], `★★ 英文界面里出现了中文：${han.slice(0, 8).join(' / ')}`);
  assert.notEqual(
    [...'中文'.matchAll(/[\u4e00-\u9fff]+/g)].length,
    0,
    '★ 探针：汉字扫描器本身必须能命中',
  );
  ok('英文界面里零汉字（含属性）');
}

console.log('');
console.log(`通过 ${pass} 项。`);
console.log('');
console.log('═══════════════════════════════════════════════════════════════════════');
console.log('覆盖边界（写清楚，免得下一个人高估它）');
console.log('═══════════════════════════════════════════════════════════════════════');
console.log('⚠️ 这是一个**静态渲染**：`renderToStaticMarkup` 不跑 effect、不点击、不发请求。');
console.log('   所以下面这三件事它**证明不了**（它们都是 `routes/ShareBoard.tsx` 的 effect）：');
console.log(
  '   · **每秒 tick**：`nowMs` 每 1000ms 推进一次 —— 本脚本钉的只有"**给定时刻**显示什么"',
);
console.log(
  '     （① 里断言的"时钟往前走 ⇒ 剩余时间变少"是那个 tick 赖以为生的**代数**，不是 tick 本身）；',
);
console.log('   · **20 秒自动刷新**，以及"页面不可见时暂停"（`document.visibilityState`）；');
console.log(
  '   · **偏移量只算一次**（`useServerOffset` 的 `useRef` 跨渲染存活）：静态渲染每次都是',
);
console.log('     新的组件实例，拿不到"第二次渲染"。⇒ "倒计时会往前走"这件事**只能靠人看**。');
console.log('   同样证明不了的还有：');
console.log('   · **点击的结果**：SSR 的产物里没有事件处理器，一颗接好线的按钮与一颗 `onClick` 是');
console.log(
  '     `undefined` 的按钮**长得一模一样** —— 本脚本用的是三道运行时守卫（`assertBoardPropsGiven`、',
);
console.log(
  '     `assertIntroPropsGiven` 与"入口不能是 disabled"），而"prop 忘了传"在**页面**那一侧是编译错误；',
);
console.log(
  '   · **真的复制到剪贴板**（`navigator.clipboard`，§7.4 的失败提示）、真的发帖/下架/恢复；',
);
console.log(
  '   · **尺寸与字体**：`--fs-title-item`（房间号放大）是 `styles.css` 的事，这里只看类名；',
);
console.log(
  '   · **服务端那一半**：过期过滤、额度、401/403/409 都在 `services/api/src/live-shares.test.ts`。',
);
/*
 * ⚠️ 组数是**手抄的**（本仓惯例）：它防的是"把某一段摘掉" —— 删掉一整组断言之后
 *    脚本照样绿、照样打印"通过 N 项"，只有这个数字会变。改脚本就要一起改这里。
 */
const expectedGroups = LANG === 'en' ? 17 : 16;
assert.equal(
  pass,
  expectedGroups,
  `探针：这一轮应当通过 ${String(expectedGroups)} 组（少了就说明有人把某一段摘掉了）`,
);
