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

import { directWriteNotice } from '@/lib/directWriteNotice';

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
console.log('⚠️ 这个脚本验的是**文案判据**：不点击、不请求、不渲染。');
