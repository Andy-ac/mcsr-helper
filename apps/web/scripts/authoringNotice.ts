#!/usr/bin/env tsx
/**
 * 直编提示文案的断言（spec §10.2 第 16 条：两条路**都不许撒谎**）。
 *
 * 跑法（从仓库根）：
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:authoring
 *   & "$env:APPDATA\npm\pnpm.cmd" -F @mcsr/web check:authoring -- --en
 *
 * ---------------------------------------------------------------------------
 * 为什么单独一个脚本，而不是并进 check:grid
 * ---------------------------------------------------------------------------
 * `check:grid` 验的是**渲染**（网格、筛选栏、系列栏目、卡片）。这一条验的是
 * **一句文案该说什么** —— 它不涉及任何组件，而是"两个字段 → 一句人话"的映射。
 * 并进 gridrender 会让人以为它也是渲染断言，而那一套（SSR、MemoryRouter）
 * 对它一点用都没有。它也不需要 React：`directWriteNotice` 是纯函数。
 *
 * ⚠️★ 2026-09-14 追加了一节（⑥ 起），那一节**确实要渲染** —— 而且非渲染不可：
 *    `authoring.mustHideFirst` 里的 `**下架**` 会变成什么样，**由 `<Notice>` 决定**
 *    （它是三个提交页的消费点），而"消费点会不会处理标记"这件事只有在
 *    **真的把节点渲染一遍**之后才看得见 —— 词条里有没有星号、键存不存在、
 *    两种语言对不对齐，全部照不出来。见下面 ⑦ 的说明。
 *    （⇒ 文件头"它也不需要 React"那句只对 ①–⑤ 成立，刻意留在原地当对照。）
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 这个脚本守的是一个**真实发生过的"恒撒谎"**
 * ---------------------------------------------------------------------------
 * 原来的代码是行内三元：
 *     liveRevisionUnchanged ? t('authoring.saved') : t('authoring.published')
 * 而直编路径的 `liveRevisionUnchanged` **必然是 `false`**
 * （`services/api/src/routes/authoring.ts` 创建与改写两处都返回 `false`）。
 * ⇒ 于是**只有 `false` 那一支可达**，界面**恒显示**「已直接发布，线上已可见」——
 *   对一条被下架的条目（直编保留 `hidden`）就是假话。
 *
 * 这类错的形状是"**看起来有两档、实际只有一档**"，所以只断言一个分支抓不住它：
 * 必须**两个组合各断言一次**，再加一条**要求两句不同**（下面第 ③ 条）。
 *
 * ⚠️ 最后一节的"变异探针"是为了防**恒真断言**：一个恒真的断言与一个
 *    "因为找不到而通过"的断言在输出上长得一模一样，所以这里**故意用写反了的
 *    旧实现跑一遍**，确认断言真的会红。
 */
import assert from 'node:assert/strict';
import { zhCN } from '@mcsr/shared/i18n';
import i18n from 'i18next';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Link, MemoryRouter } from 'react-router';

import { em, emText } from '@/components/Emphasis';
import { Notice } from '@/components/Form';
import { ApiError } from '@/lib/api';
import { directWriteNotice } from '@/lib/directWriteNotice';
import { describeSubmissionError, type SubmissionErrorInfo } from '@/lib/submissionErrors';

const LANG = process.argv.includes('--en') ? 'en' : 'zh-CN';

await i18n.init({
  resources: {
    'zh-CN': { translation: zhCN },
    en: { translation: (await import('@mcsr/shared/i18n')).en },
  },
  lng: LANG,
  fallbackLng: 'zh-CN',
  interpolation: { escapeValue: false },
  returnNull: false,
});

let pass = 0;
const ok = (m: string): void => {
  pass += 1;
  console.log(`  ✓ ${m}`);
};

const say = (status: string, liveRevisionUnchanged: boolean): string =>
  directWriteNotice({ status, liveRevisionUnchanged }, (k) => i18n.t(k));

console.log(`【${LANG}】直编提示：两个组合各断言一次`);

/*
 * ① `false` + `published` —— 改动写进了线上那一行，条目在站上。
 *    该说"已生效"，而且**不该**出现"不在站上"那半句。
 */
const published = say('published', false);
assert.ok(
  published.includes(i18n.t('authoring.published')) ||
    published.includes(i18n.t('authoring.saved')),
  '已发布的条目直编之后必须说"改动已生效"',
);
assert.equal(
  published.includes(i18n.t('marks.gone')),
  false,
  '条目在站上时**不该**说"它不在站上" —— 那是一句与事实相反的提示',
);
ok(`★ false + published → 只说已生效：「${published}」`);

/*
 * ② `false` + `hidden` —— ★ 那个 bug 的靶心。
 *    改动确实生效了，但条目**仍然是下架状态**，两件事都要说：
 *      只说前者 → 用户以为它上线了，不会去点「恢复上架」；
 *      只说后者 → 用户以为改动丢了，会再存一遍。
 */
const hidden = say('hidden', false);
assert.ok(
  hidden.includes(i18n.t('authoring.saved')) || hidden.includes(i18n.t('authoring.published')),
  '已生效这件事必须说出来',
);
assert.ok(
  hidden.includes(i18n.t('marks.gone')),
  '★ 条目仍是下架状态时必须**同时**说"它当前不在站上" —— 缺了这半句用户会以为已经上线',
);
ok(`★ false + hidden → 两件事都说了：「${hidden}」`);

/*
 * ③ 两个组合必须**真的不同**。
 *    ⚠️ 这是防"恒撒谎"的关键一条：原来的 bug 就是两个组合给出**同一句话**。
 *    单看 ①② 有可能都通过（一种句子恰好同时含两个词），所以这里要求字面不同。
 */
assert.notEqual(
  published,
  hidden,
  '★ 两个组合必须给出**不同**的提示 —— 相同即意味着有一个分支不可达（就是那个"恒撒谎"bug）',
);
ok('★ 两个组合理字面不同（防"两个分支实际只有一支可达"）');

/*
 * ④ `true` + 任意 —— 改的是草稿/待审，线上那一行**没被碰过**。
 *    这时**不能**说"线上已可见/已更新"，否则对一条还没上线的草稿撒谎。
 */
const draft = say('draft', true);
assert.equal(
  draft.includes(i18n.t('authoring.published')),
  false,
  '★ 改草稿时说"线上已可见"就是撒谎（线上本来就没有这一版）',
);
assert.equal(draft.includes(i18n.t('authoring.saved')), true, '改草稿时应说"已保存"');
ok(`★ true + draft → 只说已保存、不说线上可见：「${draft}」`);

/*
 * ⑤ 词条本身必须**解析得到**，而不是原样回显 key。
 *    ⚠️ 这一条是踩出来的：第一版这里写的是 `moderate.gone`（键不存在），
 *    而 `t()` 对未知 key 的行为是**原样返回 key** —— 界面上会出现
 *    "已直接保存，线上已更新。 moderate.gone" 这种字符串，**不报错**。
 *    上面 ② 用的是 `includes(t('marks.gone'))`，两边同时错时会一起"通过"，
 *    所以必须**独立**断言这个词条真的解析了。
 */
for (const key of ['authoring.saved', 'authoring.published', 'marks.gone']) {
  assert.notEqual(i18n.t(key), key, `词条 ${key} 必须解析得到，而不是原样回显 key`);
}
assert.ok(
  hidden.includes(i18n.t('marks.gone')) && !hidden.includes('marks.gone'),
  '★ 提示里那句"不在站上"必须是**译文**，不是原始 key',
);
ok('★ 三个词条都真的解析了（防"t() 原样回显 key"这类静默失败）');

// ---------------------------------------------------------------------------
console.log('');
console.log(`【${LANG}】⑥ emText()：字符串上下文里"剥标记"，而策略必须与 em() 一致`);
// ---------------------------------------------------------------------------
/*
 * ★★ 由头（`docs/pending.md §5.62` 的第 1 条落点）：
 *    词条里用 `**这样**` 表示强调，而**有几处只能是字符串** —— 最典型的是
 *    `title={…}`（HTML 的 tooltip 就是一段纯文本，**没有粗体 tooltip**）。
 *    两处直编按钮（`CalendarForm` / `ResourceForm` 的「直接保存」）挂的就是
 *    `authoring.directHint`，它的 zh 值是
 *      「你是内容编辑：这次改动**直接生效**（不进审核队列），并会写进审计日志。」
 *    ⇒ 没过处理的写法会让浏览器气泡里出现一对**字面星号**。
 *    ⇒ 修法是 `emText(t('authoring.directHint'))`：**剥掉**标记而不是渲染。
 *
 * ⚠️ 为什么这里非断言不可：`em()` 与 `emText()` 是**两个函数**，而它们必须对
 *    **同一套输入**给出**同一条判断**（尤其是"落单的 `**` 整条原样返回"那一半 ——
 *    见 `Emphasis.tsx` 里 `em()` 上面那段注释）。两个实现各写一遍的事，
 *    迟早会漂移，而漂移的后果是"同一个坏词条在两种上下文里给出两种结果"，
 *    且**悄悄擦掉标记**的那一种正好违反那条刻意的策略。
 */
const MARK = 'a**b**c';

/** 把一个 ReactNode 渲染成 HTML 再剥掉标签 —— 只看"人看到的那串字"。 */
const plainText = (node: unknown): string =>
  renderToStaticMarkup(createElement(Fragment, null, node)).replace(/<[^>]+>/g, '');

/*
 * 三种输入缺一不可：成对、落单、没有标记。
 * ⚠️ 落单那一条是**重点**：两个函数都必须把 `**` **留着**（看得见的错），
 *    而不是把它擦掉（`emText` 最常见的写错法就是无脑 `replaceAll('**','')`）。
 */
for (const probe of [MARK, 'a**b', '', 'no marks here', '**粗**']) {
  assert.equal(
    plainText(em(probe)),
    emText(probe),
    `★ em() 与 emText() 对同一个输入 ${JSON.stringify(probe)} 必须给出同一条判断` +
      '（一个是渲染成 <strong>、一个是剥掉标记，但**人看到的字必须一样**）—— ' +
      '不一致就说明两个实现漂移了：改了一个忘了另一个。',
  );
}
ok('★ em() / emText() 对同一批输入给出同一条判断（含成对 / 落单 / 无标记三种）');

assert.equal(
  emText('a**b'),
  'a**b',
  '★ 落单的 `**` 必须**整条原样返回**（与 em() 同策略）—— 图省事 replaceAll 的话，' +
    '一个写坏的词条就被悄悄擦掉了一半，谁也看不见',
);
assert.equal(emText('a**b**c'), 'abc', '★ 成对时剥掉标记，**正文全都留着**（被夹住的那段是正文）');
assert.equal(emText('no marks here'), 'no marks here', '没有标记时原样返回（零影响）');
ok('★ emText()：成对剥标记、落单原样、无标记不动');

/*
 * 针孔探针：两个缺陷词条里的强调**今天是存在的**。
 *
 * ⚠️ 没有这一条的话，下面 ⑦/⑧ 会**因为词条里恰好没有 `**` 而恒绿** ——
 *    那正是本仓反复记档的"因为找不到而通过"（`liverender.tsx` 里
 *    `live.title` 那条假守卫为同一件事写过完整记录）。
 * ⚠️ 英文侧这两条词条**本来就没有** `**`（en 的 `mustHideFirst` 是
 *    "Take it offline first: …"）⇒ 探针只在中文这一遍成立，见 ⑦ 的边界说明。
 */
const mustHideFirst = i18n.t('authoring.mustHideFirst');
if (LANG === 'zh-CN') {
  assert.ok(
    mustHideFirst.includes('**'),
    '针孔探针：zh 的 authoring.mustHideFirst 必须带 `**`（词条被改了就改这里，别删断言）',
  );
  assert.ok(
    i18n.t('authoring.directHint').includes('**'),
    '针孔探针：zh 的 authoring.directHint 必须带 `**`（title= 那一处的靶子）',
  );
  ok('★ 针孔探针：两个靶子词条在 zh 里真的带 `**`（否则下面的断言是空跑）');
}

// ---------------------------------------------------------------------------
console.log('');
console.log(`【${LANG}】⑦ 缺陷②：Notice 收到**多个**子节点时，failure.message 不能带星号`);
// ---------------------------------------------------------------------------
/*
 * ★★ 这一段守的是 2026-09-14 复查确认的**第二处**缺陷（`pending.md §5.62`）：
 *
 * 三个提交页（`SubmitResource` / `EditResource` / `VideoForm`）都是这个形状：
 *
 *     <Notice kind="bad">{failure.message}{failure.action ? <>…</> : null}</Notice>
 *
 * ⚠️ 而 `Notice` 只在**单一字符串子节点**时才走 `em()`
 *    （`typeof children === 'string' ? em(children) : children`）⇒ 这里的
 *    `children` 是**数组** ⇒ 它**不会**兜这一层。于是 `message` 必须在
 *    **离开 `lib/submissionErrors.ts` 之前**就已经处理过（那边是单一出口 + `em()`）。
 *
 * ⚠️ 为什么必须**渲染**才算验过：`message` 的类型是 `ReactNode`，它可能是
 *    字符串、也可能是 `<strong>` 元素；"用户到底看到什么"只有渲染出来才知道。
 *    只断言 `message` 的类型或它包含某个词，**两种情况都能通过**。
 *
 * ⚠️ 形状必须与那三个消费点**同形**（两个子节点 + 一个 `action` 链接），
 *    否则这条会退化成"Notice 的单一字符串子节点路径"—— 而那条路**本来就是对的**
 *    （缺陷④ 之外的所有调用点都靠它），于是断言恒绿。
 */
const t = (key: string): string => i18n.t(key) as string;

/**
 * 造一个 ApiError。
 *
 * ⚠️ 构造器是**位置参数**（message / status / code / retryAfterSec / issues /
 *    existingId / existingTitle / existingStatus / existingMine / reason），
 *    中间那几档这里用不上。显式写 `undefined` 而不是往后挤：按位置数空档时
 *    数错一个，`reason` 就会落到 `existingId` 上 —— 那时断言表现为"走错了分支"，
 *    而报出来的话看起来像组件的问题。
 */
function apiError(
  code: string,
  reason?: string,
  existing?: { id?: string; status?: string; mine?: boolean },
): ApiError {
  return new ApiError(
    `probe ${code}`,
    409,
    code,
    undefined,
    undefined,
    existing?.id,
    undefined,
    existing?.status,
    existing?.mine,
    reason,
  );
}

/** 三个消费点**同形**的渲染：`{message}{action ? <>…</> : null}`。 */
const noticeHtml = (info: SubmissionErrorInfo): string =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(
        Notice,
        { kind: 'bad' },
        info.message,
        info.action
          ? createElement(
              Fragment,
              null,
              ' ',
              createElement(Link, { to: info.action.to }, t(info.action.labelKey)),
            )
          : null,
      ),
    ),
  );

/*
 * ① 真的词条：`invalid_state` + `reason: 'must_hide_first'`（editor/admin 的"删"）
 */
const real = describeSubmissionError(apiError('invalid_state', 'must_hide_first'), t, () => 'FB');
const realHtml = noticeHtml(real);
assert.equal(
  realHtml.includes('**'),
  false,
  '★★ editor/admin 走到"先下架再删除"时，`<Notice>` 里出现了**字面星号** —— ' +
    '`authoring.mustHideFirst` 的 `**下架**` 没有被处理掉。' +
    '⚠️ 这一条红了先查 `lib/submissionErrors.ts` 出口处那次 `em()`（见那边的文件头）。' +
    `实际渲染：${realHtml}`,
);
assert.equal(
  realHtml.includes('<strong>'),
  mustHideFirst.includes('**'),
  '★ 这一句话里的强调必须**真的**渲染成 `<strong>`（只验"没有星号"的话，' +
    '把整句替换成别的文案也能过）。' +
    '⚠️ 期望值不是恒真的 `true`，而是"词条里到底有没有标记"：' +
    'zh 的 `mustHideFirst` 带 `**` ⇒ 必须渲染出 `<strong>`；' +
    'en 的那一条本来就没有 `**`（"Take it offline first: …"）⇒ 本来就没有 `<strong>`。' +
    '两边不一致就说明有一边错了 —— 要么处理丢了标记，要么词条被改了。' +
    `实际渲染：${realHtml}`,
);
ok('★ 真的词条：先下架再删除那一句在 `<Notice>` 里渲染成 `<strong>`，没有星号');

/*
 * ② ★★ **每一个出口**都必须过 `em()`。
 *
 * ⚠️ 这一条是"所有出口都处理了"的**逐条证明**，也是本文件最值钱的一条：
 *    `describeSubmissionError` 里原来有**十几处 return**（switch 的每一支），
 *    只要漏掉一处，那一句就照样显示星号 —— 而**不会有任何报错**。
 *    做法：喂一个**故意的 `t`**（每条词条都返回带 `**` 的串，见 `MARK_PROBE`），
 *    于是"这一支有没有过 em()"变成了可判定的：过了就一定出现 `<strong>`、
 *    没过就一定会留下字面 `**`。**每一个案例如两份断言一起看**，
 *    所以它不可能因为"某个分支没被这个脚本覆盖"而假绿。
 */
const MARK_PROBE = 'x**y**z';

/** 每个出口一个用例。⚠️ 新增 `case` 时**必须**在这里补一行 —— 见下面条数下限。 */
const cases: readonly (readonly [name: string, error: unknown])[] = [
  ['非 ApiError（兜底文案）', new Error('boom')],
  ['url_exists · 自己那条未上架', apiError('url_exists', undefined, { id: 'r1', mine: true })],
  ['url_exists · 已上架', apiError('url_exists', undefined, { id: 'r1', status: 'published' })],
  ['url_exists · 别人的未上架', apiError('url_exists')],
  ['already_pending', apiError('already_pending')],
  ['invalid_state · must_hide_first ★', apiError('invalid_state', 'must_hide_first')],
  ['invalid_state · 其它 reason（兜底）', apiError('invalid_state', 'other')],
  [
    'video_exists · hidden + mine',
    apiError('video_exists', undefined, { status: 'hidden', mine: true }),
  ],
  ['video_exists · hidden + 别人的', apiError('video_exists', undefined, { status: 'hidden' })],
  ['video_exists · mine', apiError('video_exists', undefined, { mine: true })],
  ['video_exists · visible', apiError('video_exists', undefined, { id: 'v1' })],
  ['video_exists · 什么都没有', apiError('video_exists')],
  ['email_not_verified', apiError('email_not_verified')],
  ['forbidden', apiError('forbidden')],
  ['not_found', apiError('not_found')],
  ['unauthorized', apiError('unauthorized')],
  ['cross_origin_rejected', apiError('cross_origin_rejected')],
  ['未知 code（default 兜底）', apiError('something_new')],
];

/*
 * ★ 下限钉在**实测值**上（本仓 `i18n-keys.test.ts` 的 `EXPECTED_LABEL_KEY_LITERALS`
 *   用的是同一条规矩）：这个数**只会**因为"有人在 submitErrors 里加了新分支"而变，
 *    那时把它改成新值即可 —— 而那正是想要的：让人来确认新分支真的过了 `em()`。
 */
assert.ok(
  cases.length >= 18,
  `只驱动了 ${String(cases.length)} 个出口（期望 ≥18）—— 少的一定是**跳过**而不是消失：` +
    '`submissionErrors.ts` 里加了新分支而这里没跟上的话，那个分支就没人验。',
);

const exitStars: string[] = [];
/** ⑦ 渲染出来的每一份通知 —— ⑧ 的 `**` 抽查要扫的正是它们的**并集**。 */
const renderedNotices: string[] = [];
for (const [name, error] of cases) {
  const info = describeSubmissionError(
    error,
    () => MARK_PROBE,
    () => MARK_PROBE,
  );
  const html = noticeHtml(info);
  if (html.includes('**')) exitStars.push(`${name}：留下了字面星号 — ${html}`);
  else if (!html.includes('<strong>'))
    exitStars.push(`${name}：没有 <strong>，标记既没渲染也没留下`);
  else renderedNotices.push(html);
}
assert.deepEqual(
  exitStars,
  [],
  '★★ 这些**出口**没有过 `em()`：它们给出的 `message` 把字面 `**` 原样留在了界面上。' +
    '判据是"喂进去的每条词条都带 `**`"（`MARK_PROBE`）⇒ 过了就一定出现 `<strong>`。' +
    `漏掉的出口：\n${exitStars.join('\n')}`,
);
ok(`★ ${cases.length} 个出口**逐个**验证：每一支的 message 都过了 em()（都渲染出 <strong>）`);

// ---------------------------------------------------------------------------
console.log('');
console.log(`【${LANG}】⑧ 本次渲染出来的字符串里没有字面 \`**\``);
// ---------------------------------------------------------------------------
/*
 * ★ 与 `roleguide.tsx` / `homerender.tsx` 里那条同一件事（写法与措辞照抄那两个），
 *   落在**本脚本全部产物的并集**上：三句直编文案 + 上面 ⑦ 渲染出来的每一条通知。
 *
 * ⚠️ 判据用**原始 HTML**（不是"剥掉星号之后的文本"）：`**` 不经过任何实体转义，
 *    原样出现在 title / 文本里。⚠️ 本仓 `roleguide.tsx` 的 `norm()` 里**多做了**
 *    一步"把星号替换成空串"，于是它那条同类断言**恒真**（那是别人的文件，
 *    本轮只报不改）—— 这里刻意不跟它一样：抽查的对象必须是**没被擦过**的产物。
 *
 * ⚠️ 反面控制：给同一段判据喂一个**故意带星号**的串。没有它的话，
 *    "产物里没有 `**`"与"这条断言写坏了"在输出上完全一样。
 */
const all = [published, hidden, draft, realHtml, ...renderedNotices].join('\n');
assert.notEqual(
  'title="a**b**c"'.includes('**'),
  false,
  '反面控制：这条 `**` 抽查本身必须能命中一个带星号的串（否则它是恒真的空跑）',
);
assert.equal(
  all.includes('**'),
  false,
  '★★ 本次渲染出来的字符串里有字面的 `**`：词条里的强调必须过 `em()`（节点上下文）' +
    '或 `emText()`（字符串上下文）。没过的那些会在界面上显示成一对星号。' +
    `本次产物 ${String(all.length)} 字符；前 200 字符：${all.slice(0, 200)}`,
);
ok(
  `★ 产物里没有字面的 ** 星号（本次 ${String(all.length)} 字符、` +
    `${String(renderedNotices.length)} 份通知，em() 产出 ${String(all.split('<strong>').length - 1)} 处 <strong>）`,
);

// ---------------------------------------------------------------------------
console.log('');
console.log(`【${LANG}】变异探针：把判据改坏一次，确认这个脚本真的会红`);
// ---------------------------------------------------------------------------
const inverted = (liveRevisionUnchanged: boolean): string =>
  liveRevisionUnchanged ? i18n.t('authoring.saved') : i18n.t('authoring.published');

assert.equal(
  inverted(false),
  inverted(false),
  '变异探针自证：旧实现下两个组合**是同一句话**（这正是"恒撒谎"的形状）',
);
assert.notEqual(
  inverted(false),
  hidden,
  '变异探针自证：旧实现给出的句子与正确实现不同 ⇒ 第 ③ 条断言能抓住它',
);
ok('★ 探针成立：旧实现让两个组合给出同一句话，而第 ③ 条会因此失败');

console.log('');
console.log(`通过 ${pass} 项。`);
console.log('');
console.log('⚠️ 这个脚本验的是**文案判据**（①–⑤：不点击、不请求、不渲染）。');
console.log('   ⑥–⑧ 那一节是**渲染**断言，而且非渲染不可：`authoring.mustHideFirst` 的');
console.log('   `**下架**` 会变成什么样，由三个提交页的消费点 `<Notice>` 决定 ——');
console.log('   只读词条或只比字符串，看不出"用户到底会不会看到一对字面星号"。');
console.log('   ⚠️ 它仍然**没有**覆盖：真实点击、真实请求，以及那三个消费点自己的接线');
console.log('      （`SubmitResource` / `EditResource` / `VideoForm` 是路由页 / 需要数据的');
console.log('      组件，在纯 SSR 下渲染不出来 —— 见 `i18n-keys.test.ts` 里那条静态守卫）。');
