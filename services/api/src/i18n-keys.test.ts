/**
 * 词条的三条机械守卫 —— **契约层的三条不变量，全部是纯静态可判的**。
 *
 * ---------------------------------------------------------------------------
 * 为什么这个文件要长出来（三次真实事故，各自都"测试全绿"）
 * ---------------------------------------------------------------------------
 * 1. **插值写成单花括号**：`en.ts` 里写过 `favoriteCount: '{count} saved'`。
 *    i18next 对单花括号**不替换、原样显示** ⇒ 英文界面直接显示字面的 `{count} saved`。
 *    而"中英逐条对齐"那条断言比的是**键**、不比**值**，语法层完全是空的。
 * 2. **占位符两侧不一致**：`zh` 有 `{{count}}` 而 `en` 漏了 —— 同样是键对齐而语法不对齐。
 * 3. **`t('…')` 写了不存在的键**：web-eng 踩过 `t('moderate.gone')`（真位置是 `marks.gone`）。
 *    `t()` 对未知 key **原样返回 key**、不抛错，于是界面上出现那串原始 key。
 *
 * ⚠️ **这三条为什么类型检查与 lint 都拦不住**：
 *    · `apps/web/src/i18n.ts` 用的是**未类型化**的 i18next 实例（`import i18n from 'i18next'`），
 *      `packages/shared/src/i18n/index.ts` 里那个 `TranslationKey` **定义了但从未被接上**
 *      ⇒ `t()` 接受任意字符串；
 *    · 两份字典是两个独立的字面量对象，值都是 `string`，**键与值的语法都不会被编译器检查**；
 *    · `check-font-coverage` 也拦不住（`{` `}` 都是 ASCII，属于字体覆盖范围）。
 *    ⇒ 所以只能靠这里的三条断言。它们是**静态**的：不需要渲染、不需要 router、不需要数据。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 为什么"遍历字典对象 + 扫源码文本"而不是"渲染页面再找原始 key"
 * ---------------------------------------------------------------------------
 * 渲染方案对**路由页**（`EditResource` / `SubmitResource` / `MarksPanel`）无效：
 * 在 `renderToStaticMarkup` 下既没有 router 也没有数据，组件只会停在 loading/空态，
 * 断言于是**退化成真** —— 那是**假绿**，比没有覆盖更危险（本仓已为此吃过一次亏）。
 * 第 3 条扫的是**源码文本**，因此覆盖全部文件，与能否渲染无关。
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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

// ---------------------------------------------------------------------------
// 静态扫描：从源码里抽 `t('字面量键')`
// ---------------------------------------------------------------------------

/**
 * 抽出**字面量**的 `t('…')` / `t("…")` 实参。
 *
 * ⚠️ 三条边界，每一条都是为了让守卫"只红在真错上"：
 *   · **只认字面量**：`t(someVar)` / `t(\`a.${b}\`)` **一律跳过** —— 尝试推断动态键
 *     只会制造假红，而假红的下场是有人给守卫加白名单，把真错一起放过。
 *   · **拒绝反斜杠**：`[^'\\]+` 让我不处理转义引号（词条键里不需要），
 *     换来的是"绝不会把半个字符串当成键"。
 *   · **每段必须是标识符、且至少两段**：这条挡掉真实出现过的假阳性 ——
 *     源码**注释**里写着 `` `t(...)` ``（讲用法），naive 抽取会得到 `'...'`
 *     并把它当成一个不存在的键。
 */
export function extractLiteralKeys(src: string): string[] {
  const re = /\bt\(\s*(?:'([^'\\]+)'|"([^"\\]+)")\s*(?:,|\))/g;
  const out: string[] = [];
  for (const m of src.matchAll(re)) {
    const key = m[1] ?? m[2];
    if (!key) continue;
    const parts = key.split('.');
    if (parts.length < 2) continue;
    if (!parts.every((p) => /^[A-Za-z][A-Za-z0-9]*$/.test(p))) continue;
    out.push(key);
  }
  return out;
}

/** 列出目录下所有 .ts/.tsx（递归）。 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** 抽取一份 value 里的 `{{ident}}` 占位符集合（只认双花括号）。 */
function placeholders(value: string): Set<string> {
  return new Set(
    [...value.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g)].map((m) => m[1] as string),
  );
}

/** 字典的 `路径 → 值` 映射。 */
function valueMap(dict: unknown): Map<string, string> {
  const out = new Map<string, string>();
  for (const path of leafPaths(dict)) {
    const v = lookup(dict as Record<string, unknown>, path);
    if (typeof v === 'string') out.set(path, v);
  }
  return out;
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

  // -------------------------------------------------------------------------
  // 守卫一：插值语法 —— 两份字典的**值**里都不许出现单花括号
  // -------------------------------------------------------------------------
  /**
   * ⚠️ 为什么必须**遍历对象**、而不是正则扫 `en.ts` / `zh-CN.ts` 的**源码文本**：
   *    `zh-CN.ts` 的注释里**写着**单花括号 `{count}`（就是在解释这个坑本身）。
   *    扫源码会**红在一个正确的地方**，而实现者最可能的处置是给注释加白名单 ——
   *    那正好把守卫废掉。遍历对象天然不含注释，所以**连去注释机制都不需要**。
   */
  it('两份字典的值里不出现单花括号插值（i18next 会原样显示，不替换）', () => {
    const bad: string[] = [];
    for (const [locale, dict] of [
      ['zh-CN', zhCN],
      ['en', en],
    ] as const) {
      for (const [key, value] of valueMap(dict)) {
        // 匹配"单花括号"，即不是 `{{…}}` 的 `{ident}` 形态
        if (/(?<!\{)\{[A-Za-z_][A-Za-z0-9_]*\}(?!\})/.test(value)) {
          bad.push(`${locale} ${key} = ${JSON.stringify(value)}`);
        }
      }
    }
    assert.deepEqual(
      bad,
      [],
      '单花括号不会被 i18next 替换，会**原样显示**给用户（例如 `{count} saved`）。' +
        '计数一律写 `{{count}}`。',
    );
  });

  // -------------------------------------------------------------------------
  // 守卫二：两侧占位符集合必须相等（这条现有测试根本看不到）
  // -------------------------------------------------------------------------
  /**
   * 比"中英键对齐"更强：键一样但**占位符**不一样时，界面同样会坏 ——
   * zh 写 `{{count}}` 而 en 漏了，英文界面就会缺一个数字，而且不报错。
   */
  it('同一个 key 在两种语言里的 {{占位符}} 集合必须相同', () => {
    const zh = valueMap(zhCN);
    const english = valueMap(en);
    const mismatched: string[] = [];

    for (const [key, zhValue] of zh) {
      const enValue = english.get(key);
      if (enValue === undefined) continue; // 键缺失由上面那条断言负责
      const a = [...placeholders(zhValue)].sort();
      const b = [...placeholders(enValue)].sort();
      if (a.join(',') !== b.join(',')) {
        mismatched.push(`${key}: zh=[${a.join(' ')}] en=[${b.join(' ')}]`);
      }
    }

    assert.deepEqual(
      mismatched,
      [],
      '同一个 key 在两侧的占位符集合不一致 —— 界面上会缺值或多出一个花括号，而 i18next 不报错。',
    );
  });

  // -------------------------------------------------------------------------
  // 守卫三（★ 本轮新增，替代"给路由页加渲染覆盖"）：字面量键必须真实存在
  // -------------------------------------------------------------------------
  /**
   * ⚠️ 这一条替代的是"把入口片段渲染进脚本"的方案，理由是**可验证的**：
   *    `EditResource` / `SubmitResource` 是**路由页**，在 `renderToStaticMarkup` 下
   *    没有 router、没有数据 ⇒ 只会停在 loading/空态，断言**退化成真**（假绿）；
   *    而且即便补上，也只覆盖到其中一个键。
   *    扫源码文本没有这两个问题：覆盖全部文件、不依赖任何渲染条件。
   *
   * ⚠️ 已知的**既有盲区**（本轮记账、不修）：`MarksPanel`（详情页）至今没有任何
   *    渲染覆盖。这条静态守卫能兜住它的**键存在性**，兜不住它的渲染正确性。
   */
  it('源码里 t(字面量) 的每个键都在 zh-CN 字典里存在（缺一个 = 界面显示原始 key）', () => {
    const here = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    const repo = resolve(here, '..', '..', '..');
    const roots = [join(repo, 'apps', 'web', 'src'), join(repo, 'services', 'api', 'src')];
    /*
     * ⚠️ **跳过本文件自己**：下面那条反面控制里写着两个"故意不存在"的键当夹具，
     *    它们就在这个文件的源码里。若把自己也扫进去，夹具会**冒充真缺陷**上报 ——
     *    那就变成了"锁把配钥匙的人自己锁在门外"。
     *    （这不是假想的：第一版没排除自己时，10 处报警里有 3 处就是这些夹具。）
     */
    const selfFile = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const known = new Set(leafPaths(zhCN));
    const missing: string[] = [];
    const scannedPaths: string[] = [];

    for (const root of roots) {
      for (const file of walk(root)) {
        if (resolve(file) === resolve(selfFile)) continue;
        scannedPaths.push(resolve(file));
        for (const key of extractLiteralKeys(readFileSync(file, 'utf8'))) {
          if (!known.has(key)) {
            missing.push(`${file.slice(repo.length + 1)} → t('${key}')`);
          }
        }
      }
    }

    /*
     * ★ 覆盖面的**显式**控制（本轮新增）。
     *
     * ⚠️ 由头：只断言"missing 为空"是不够的 —— 扫描器**少扫了文件**时结果同样为空，
     *    而"扫到了但没问题"与"压根没扫"在输出上长得一模一样（本仓已吃过三次
     *    "检查因为错误的原因而通过"）。所以这里把覆盖面本身变成断言：
     *      ① 两个根目录必须**存在**（目录被改名/挪位时立刻红，而不是静默少扫）；
     *      ② 必须**真的扫到**一个已知的目标文件（下面用 `CalendarList.tsx`，
     *         它是本轮改动的核心页面之一）；
     *      ③ 从那个文件里必须**真能抽出键**、且至少一个在字典里存在 ——
     *         这是"扫描器对真实源码有效"的正面控制，与下面那条反面控制并列。
     */
    for (const root of roots) {
      assert.ok(statSync(root).isDirectory(), `应扫的目录不存在：${root.slice(repo.length + 1)}`);
    }
    const probe = 'apps/web/src/routes/CalendarList.tsx';
    assert.ok(
      scannedPaths.some((p) => p.endsWith(probe.replaceAll('/', '\\')) || p.endsWith(probe)),
      `覆盖面退化：没有扫到 ${probe}（扫了 ${String(scannedPaths.length)} 个文件）—— ` +
        '那会让"没问题"与"没扫到"变成同一个结果。',
    );
    const probeKeys = extractLiteralKeys(readFileSync(join(repo, probe), 'utf8'));
    assert.ok(
      probeKeys.some((k) => known.has(k)),
      `${probe} 里没有抽出任何一个存在的键（抽出 ${String(probeKeys.length)} 个）—— ` +
        '正面控制失败，说明扫描器对真实源码失效了。',
    );

    // 反面控制：扫描器本身必须**能**发现问题 —— 否则上面那条是"因为找不到而通过"。
    // 用两个真实存在过的错法当夹具（不是编的）：`moderate.gone` 是 web-eng 踩过的，
    // `authoring.thisKeyDoesNotExist` 是"统一前缀 + 瞎编后半段"的典型。
    const fixture = `t('moderate.gone') t('authoring.thisKeyDoesNotExist') t('marks.gone')`;
    const fixtureMissing = extractLiteralKeys(fixture).filter((k) => !known.has(k));
    assert.deepEqual(
      fixtureMissing.sort(),
      ['authoring.thisKeyDoesNotExist', 'moderate.gone'],
      '扫描器自身失效了：它没能从夹具里认出那两个不存在的键（夹具里的 marks.gone 是**存在**的，' +
        '不该被报出来）。这条反面控制是整套守卫的地基 —— 没有它，上面那条只是"因为找不到而通过"。',
    );
    // 也断言"存在的键不会被误报"（防止把守卫做成"凡 t(...) 都红"）
    assert.equal(known.has('marks.gone'), true, 'marks.gone 应当存在（夹具里的正例）');

    assert.deepEqual(
      missing,
      [],
      `有 ${missing.length} 处 t('字面量键') 指向**不存在**的词条 —— ` +
        'i18next 对未知 key 不抛错、原样返回 key，所以界面上会显示这串原始 key：\n' +
        `${missing.join('\n')}\n` +
        `（本次扫描了 ${String(scannedPaths.length)} 个文件；覆盖面控制与正例控制均通过，说明扫描器本身是有效的。）`,
    );
  });

  // -------------------------------------------------------------------------
  // 守卫四（★ 本轮新增）：键**作为数据**被引用时也必须真实存在
  // -------------------------------------------------------------------------
  /**
   * 由头（**真实发生过一次**）：`apps/web/src/lib/submissionErrors.ts:76` 写着
   * `action: { to: …, labelKey: 'submit.goEditMine' }` —— 键先存进对象字段，
   * 再由渲染处交给 `t()`。上面那条只认 `t('字面量')`，**扫不到它**，
   * 而后果一模一样：`t()` 对未知键**原样返回** ⇒ 那颗按钮的文字就是一串
   * `submit.goEditMine`。shared-eng 当时就是发现它缺，才补了那个键。
   *
   * ---------------------------------------------------------------------------
   * ⚠️ 为什么不走"类型穷尽"（先评估过，不是跳过）
   * ---------------------------------------------------------------------------
   * 先例是 `ResourceForm.tsx:419` 的 `resourceKindLabel(k, t)` + 穷尽 `KIND_KEYS`：
   * 漏改**编译不过**，零误伤、零运行成本 —— 那是更好的方案。但 `labelKey` 这一族
   * 散布在 6 个文件、彼此**没有共同的枚举**可穷尽（审核视图 14 处、`Layout` 导航
   * 6 处、`ResourceList` 的 tab 4 处、`submissionErrors` 7 处…），要强行类型化
   * 就得改 `apps/web/**` 的业务结构 —— 超出本任务边界（"只改测试文件"）。
   * ⇒ 改用**窄正则**：只认 `labelKey:` 后跟字符串字面量；两处类型声明
   *    （`labelKey: string`）后面没有引号，**天然不匹配**，无需白名单。
   *
   * ⚠️ **绝不放宽**上面那条 `t('…')` 的规则：放宽会把源码注释里的 `t(...)`
   *    与 `'authoring.ts'` 这类文件名串一起拉进来 —— 为了让一条检查更宽
   *    而误伤另一条判据，是这类守卫最容易走进的死胡同。
   */
  it('★ 源码里 labelKey 字面量引用的词条键必须存在（键当数据传递的那条路）', () => {
    const here = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    const repo = resolve(here, '..', '..', '..');
    const roots = [join(repo, 'apps', 'web', 'src'), join(repo, 'services', 'api', 'src')];
    // 与本文件其它守卫一致：跳过自己（夹具/注释里的示例键不当真缺陷上报）
    const selfFile = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const known = new Set(leafPaths(zhCN));

    const re = /\blabelKey:\s*(?:'([^'\\]+)'|"([^"\\]+)")/g;
    const found: Array<{ file: string; line: number; key: string }> = [];

    for (const root of roots) {
      for (const file of walk(root)) {
        if (resolve(file) === resolve(selfFile)) continue;
        const src = readFileSync(file, 'utf8');
        for (const m of src.matchAll(re)) {
          const key = m[1] ?? m[2];
          if (!key) continue;
          // 与守卫三同样的形状判据：每段是标识符、且至少两段
          const parts = key.split('.');
          if (parts.length < 2) continue;
          if (!parts.every((p) => /^[A-Za-z][A-Za-z0-9]*$/.test(p))) continue;
          const line = src.slice(0, m.index ?? 0).split('\n').length;
          found.push({ file: file.slice(repo.length + 1), line, key });
        }
      }
    }

    /*
     * ★ 下限断言：**按实测完整值给**（017 这一轮实测 **40 处**），不是窄清单里的 9。
     *
     * ⚠️⚠️ 为什么是"实测值"而不是 9（这条是 t34 的全部意义）：
     *    9 只是 `*Errors.ts` 那两个文件的**窄清单**；守卫实际扫的是两个根下的全部
     *    `.ts/.tsx`（本轮实测：`apps/web/src` 40 处 + `services/api/src` 0 处 = 40）。
     *    下限写 9 ⇒ **丢掉另外三十多处覆盖也不会红** —— 那就落进本仓反复吃亏的那一族：
     *    **有一条断言在，但它守不住它声称守的东西**（同族：恒真的探针、"没跑 ≠ 绿"、守卫自扫夹具）。
     *    ⇒ 下限必须钉在**实测值**上。
     *
     * ⚠️ 代价与正确做法：这个数字**会随代码增长**（以后有人新增这类引用时这里会红）。
     *    那时**把它改成新的实测值**即可 —— 这正是想要的：让人来确认"多出来的是真的"，
     *    而不是让覆盖悄悄缩水。往下降只允许在引用真的被删掉时，并且要说明原因。
     *
     * ---------------------------------------------------------------------------
     * ⚠️ 41 → 40（017，2026-09-13）：**引用确实被删掉了**，不是扫描器漏扫
     * ---------------------------------------------------------------------------
     * 这一条正是上面那句"往下降只允许在引用真的被删掉时，并且要说明原因"的第一次适用：
     *   · `apps/web/src/components/CalendarReviewView.tsx` 的字段表把
     *     「开始时间 / 结束时间 / 结束时区」三行并成了一行「比赛时间」
     *     （`calendar.fields.slots`，对应新模型里"一个时区 + 多段时间"）；
     *   · 同一张表里的「轮次」整行没了（`stage` 这一维被用户去掉）。
     *   ⇒ 删掉 4 个字面量（`startsAt` / `endsAt` / `endsTz` / `stage`）、
     *     新增 3 个（`slots` / `scopeDetail` / `access`），净 −1：41 → 40。
     *
     * ⚠️ 怎么排除"漏扫"（这一步不能省，否则降下限与"扫描器坏了"是同一个结果）：
     *    ① 下面那条 `missing` 守卫同时给出本次实测条数，而它是绿的 ——
     *       也就是说扫到的这些 key **逐个都在** `zh-CN` 词条表里；
     *    ② 逐文件数过：`CalendarReviewView` 13（原 14）、`ResourceReviewView` 8、
     *       `submissionErrors` 7、`Layout` 6、`ResourceList` 4、`seedErrors` 2。
     *    ⇒ 少的那一个恰好是上面那次字段表合并，没有第二种解释。
     *
     * ⚠️ 另外：`submissionErrors.ts:45` 与 `seedErrors.ts:394` 的 `labelKey: string`
     *    是**类型声明**，后面没有引号 ⇒ 上面的正则**天然不匹配**，所以
     *    **不需要白名单**。不要为了"让它更干净"加白名单：那会把这条守卫
     *    退化成"只要进了白名单就不查"，反而废掉它。
     */
    const EXPECTED_LABEL_KEY_LITERALS = 40;
    assert.ok(
      found.length >= EXPECTED_LABEL_KEY_LITERALS,
      `只扫到 ${String(found.length)} 处 labelKey 字面量（期望 ≥${String(EXPECTED_LABEL_KEY_LITERALS)}）` +
        ' —— 扫描器漏扫了，此时"没问题"与"没扫到"是同一个结果。' +
        '（若引用确实被删掉了，请把这个下限改成新的实测值并在注释里说明原因。）',
    );

    const missing = found.filter((f) => !known.has(f.key));
    assert.deepEqual(
      missing.map((m) => `${m.file}:${m.line} → labelKey: '${m.key}'`),
      [],
      '这些 labelKey 指向**不存在**的词条。t() 对未知键不抛错、原样返回 key，' +
        '所以界面上会出现那串原始 key（按钮文字就是它）。' +
        `（本次扫到 ${String(found.length)} 处 labelKey 字面量。）`,
    );
  });
});
