/**
 * 界面上用到的"间接 key"必须真实存在。
 *
 * ---------------------------------------------------------------------------
 * 这个测试来自一个**渲染出来才发现**的 bug
 * ---------------------------------------------------------------------------
 * 账号页的角色名和账号管理页的角色下拉框都不是写死的文案，而是
 * `t(ROLE_LABEL_KEYS[role])` —— 一份"角色 → 词条 key"的映射。
 *
 * 加第二个角色（editor）时，映射里加了 `auth.roleEditor`，
 * 但**词条本身漏了**。后果是界面上直接显示出 `auth.roleEditor` 这个原始 key。
 *
 * ⚠️ 为什么类型检查和 lint 都抓不到：
 *    · `ROLE_LABEL_KEYS` 的类型是 `Record<UserRole, string>`，值就是普通字符串，
 *      编译器不知道它必须是一个存在的词条 key；
 *    · i18next 的 `t()` 对未知 key 的行为是**原样返回 key**，不抛错；
 *    · 所以从代码到测试全绿，只有真的把页面渲染出来看一眼才会发现。
 *
 * 现在把它变成一条断言：映射里的每个 key 都必须在所有语言里存在。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ROLE_LABEL_KEYS } from '@mcsr/shared/permissions';

const { en, zhCN } = await import('@mcsr/shared/i18n');

/** 按 'a.b' 取值；取不到返回 undefined。 */
function lookup(dict: Record<string, unknown>, key: string): unknown {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/**
 * 收集一棵词条树里所有叶子（字符串）的完整路径。
 *
 * 只收字符串：词条树里除了文案不该有别的东西，出现非字符串的叶子
 * 本身就是个问题，但那是另一条断言的事（见下面"两种语言对齐"）。
 */
function leafPaths(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix];
  if (typeof node !== 'object' || node === null) return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leafPaths(value, prefix ? `${prefix}.${key}` : key),
  );
}

describe('★ 词条 key 的存在性', () => {
  it('角色名映射里的每个 key 都真实存在（两种语言都要有）', () => {
    for (const [role, key] of Object.entries(ROLE_LABEL_KEYS)) {
      for (const [locale, dict] of [
        ['zh-CN', zhCN as unknown as Record<string, unknown>],
        ['en', en as unknown as Record<string, unknown>],
      ] as const) {
        const value = lookup(dict, key);
        assert.equal(
          typeof value,
          'string',
          `${locale} 里找不到词条 ${key}（角色 ${role}）—— ` +
            '界面上会直接显示出这个 key。加角色时别忘了补词条。',
        );
      }
    }
  });

  /**
   * 两种语言**逐条对齐**。
   *
   * 上面那条只守 ROLE_LABEL_KEYS 那一个映射，而"遗漏词条"这件事跟映射无关：
   * 只要在 zh-CN 里加了一条、忘了加 en（或者反过来），结果就完全一样 ——
   * 英文界面上冒出一行 `auth.verifyBlockTitle`。
   *
   * 类型检查抓不到（两个文件是两个独立的字面量对象），lint 也抓不到，
   * i18next 更是**不报错**：查不到的 key 原样返回。
   * 所以只能靠这条断言，它是我加词条时的唯一安全网。
   */
  it('zh-CN 和 en 的词条完全对齐（少一条 = 界面上冒出一个原始 key）', () => {
    const zh = new Set(leafPaths(zhCN));
    const english = new Set(leafPaths(en));

    const missingInEn = [...zh].filter((key) => !english.has(key)).sort();
    const missingInZh = [...english].filter((key) => !zh.has(key)).sort();

    assert.deepEqual(
      { missingInEn, missingInZh },
      { missingInEn: [], missingInZh: [] },
      '两种语言的词条对不上。i18next 对缺失的 key 不抛错，而是把 key 原文显示出来 —— ' +
        '补完再提交，别让用户看见 auth.somethingMissing。',
    );
  });
});
