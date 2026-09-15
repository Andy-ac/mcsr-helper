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

  // -------------------------------------------------------------------------
  // 守卫五（★ 2026-09-14 新增）：`**强调**` 只能落在**会处理标记**的形状里
  // -------------------------------------------------------------------------
  /**
   * 守的是一个**真的发生过**的界面缺陷（`docs/pending.md §5.62`）：
   * 词条里用 `**这样**` 表示强调（中英都是），界面靠 `components/Emphasis.tsx` 的
   * `em()` 渲染成 `<strong>`。而**落到字符串上下文**（`title=` / `aria-label=`）或
   * **落进一个不会处理标记的组件**时，用户看到的是一对**字面星号** ——
   * 而词条存在、两种语言对齐、字体覆盖全过，**上面四条守卫一条都拦不住它**。
   *
   * ---------------------------------------------------------------------------
   * ⚠️⚠️ 为什么不能做成"±N 行里出现过 `em(` 就算过"（这一条是**踩过的坑**）
   * ---------------------------------------------------------------------------
   * 2026-09-14 的复查里先写过一版**窗口启发式**（"调用点 ±3 行内找 `em(`"），
   * 它报了 10 个可疑点，逐个读代码之后**7 个是假警报** —— 因为渲染点常常离调用点
   * 隔着一个组件（`<Field hint={…}>` 与 `<Notice>{…}</Notice>` **自己就会** `em()`）。
   * ⇒ 窗口匹配的两个方向都不可靠：**够宽就误报，够窄就漏报**。
   * 所以这里的判据是**紧贴调用点的形状**（结构性的、不含行距），
   * 并且把"哪些形状是允许的、为什么允许"**逐条写出来**（下面 `SHAPES` 那张表）。
   *
   * ---------------------------------------------------------------------------
   * ⚠️ 判据的来源必须分开：**key 集合从"加载后的字典"来**（不扫字典源码）
   * ---------------------------------------------------------------------------
   * 因为源码里的值会**折行**（`en.ts` 的 `directHint` 就是三行字符串拼接），
   * 按源码 grep `\*\*` 会**不全** —— 本仓已有先例（`check-font-coverage.mjs`
   * 与 `zh-CN.ts` 注释里那两段都记着"扫源码会漏"）。遍历对象天然没有这个问题。
   *
   * ---------------------------------------------------------------------------
   * 覆盖边界（写清楚，免得下一个人高估它）
   * ---------------------------------------------------------------------------
   * ⚠️ 它**看不见**这些：
   *   · **拼出来的 key**（`t(\`calendar.continent.${code}\`)`）：静态扫描只认字面量，
   *     拼出来的那一类由 `roleguide.tsx` 的渲染断言与 `DYNAMIC_KEYS` 那张白名单分别处置；
   *   · **CSS 的 `content:` / `::before`**：词条要是被写进样式表，这里一个都扫不到；
   *   · **组件内部的接线**：`<Notice>` 只在**单一字符串子节点**时才 `em()` ——
   *     这一条断言能判"是不是单一字符串子节点"，判不了"Notice 里那句 `typeof` 还在不在"
   *     （那一半由 `Form.tsx` 的两条接线自证兜住，见下面 `WIRING`）。
   *     而"渲染点离调用点更远"的那些（值先存进 state 再交给组件）只能进白名单，
   *     每一条都要写理由。
   */
  it('★ 带 `**` 的词条，每处 t(字面量) 都必须在会处理标记的形状里（或写明理由的白名单）', () => {
    const herePath = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const repo = resolve(dirname(herePath), '..', '..', '..');
    const roots = [join(repo, 'apps', 'web', 'src'), join(repo, 'apps', 'desktop', 'src')];

    /**
     * ★ 允许的四种**形状**（分类器只认这四种，其余一律 `unsafe`），以及它们
     *   为什么允许 —— 这一张表就是这条守卫的判据本身，**放宽它等于废掉这条守卫**。
     *
     * | 形状 | 长什么样 | 为什么允许 |
     * |---|---|---|
     * | `em` | `em(t('k'))` | 直接的渲染点，`em()` 把 `**x**` 变成 `<strong>` |
     * | `emText` | `emText(t('k'))`（多用于 `title={…}`） | **字符串上下文**：原生 tooltip 里没有粗体，所以这里只**剥掉**标记 |
     * | `field-hint` | `<Field … hint={… t('k') …}>` | `Field` 自己会 `em(hint)`（`Form.tsx`，见 `WIRING` 自证） |
     * | `notice-child` | `<Notice …>{t('k')}</Notice>` | 单一**字符串**子节点 ⇒ `Notice` 会 `em(children)`（同上） |
     *
     * ⚠️ `notice-child` 的"单一字符串子节点"这半句是关键：`<Notice>{a}{b}</Notice>`
     *    （两个子节点）**不在**这个形状里 —— 那时 `children` 是数组，
     *    `Notice` 的 `typeof children === 'string'` 为假 ⇒ **不处理标记**。
     *    2026-09-14 修掉的两处缺陷里，有一处正是这个形状（`failure.message` + 链接）。
     */
    const AUTO_SHAPES = ['em', 'emText', 'field-hint', 'notice-child'] as const;
    type Shape = (typeof AUTO_SHAPES)[number] | 'unsafe';

    /**
     * ★★ **唯一的清单**：每个带 `**` 的词条、**每一处**字面量调用点，都必须在下面
     *    出现**一次**（`count` 是同一个文件里同一形状的条数）。
     *
     * ⚠️ 判据是"清单 == 实测"，所以**任何**漂移都会红，包括：
     *   · 有人新写一个**裸**的 `t('带星号的键')` ⇒ 多出一条 `unsafe`（**这就是要抓的**）；
     *   · 有人把某处的 `em(...)` 删掉 ⇒ 那一行的形状从 `em` 变成 `unsafe`；
     *   · 有人把某处**修好**（比如把一个 `unsafe` 改成 `em(...)`）⇒ 少一条 ⇒ 也红，
     *     那时**应当**把这一行删掉并说明原因（本仓 `EXPECTED_LABEL_KEY_LITERALS`
     *     用的是同一条规矩：**让人来确认，而不是让覆盖悄悄变化**）。
     *
     * `kind` 三种取值，含义不同、**绝不能混**：
     *   · `auto`        —— 形状由分类器判定，`shape` 必须与实测一致；
     *   · `why-safe`    —— 形状匹配不到（`unsafe`），但**确实安全**，理由 **必须**写在 `why`；
     *   · `open-defect` —— 形状匹配不到，而且**是真的缺陷、还没修**（只报告）。
     *     ⚠️ 这一类**不是**"允许的形状"，它在这里是为了让守卫**知道**它存在、
     *     并且**修好之后这一行会消失 ⇒ 守卫变红 ⇒ 有人来更新**。别把它当安全形状读。
     *     ★ 今天这张表里是 **0 条**。它被用掉过一次（2026-09-14）：本轮复查发现
     *     `EditResource.tsx` 的危险区里 `authoring.mustHideFirst` 是**裸**调用
     *     （同一段里 `deleteImpact` 走了 `em()`、这一条没有 ⇒ editor/admin 会看到
     *     「要先**下架**再删除」的一对字面星号）。当时先把它记成 `open-defect`
     *     （因为"只报告不改"），随后被授权修掉，那一行就删掉了 —— 这正是
     *     "清单描述现状"的示例：**修缮会让这条守卫变红，而红就是让人来更新清单**。
     */
    const EXPECTED_SITES: readonly {
      file: string;
      key: string;
      shape: Shape;
      count: number;
      kind: 'auto' | 'why-safe' | 'open-defect';
      why?: string;
    }[] = [
      {
        file: 'apps/web/src/routes/Home.tsx',
        key: 'home.statusHint',
        shape: 'em',
        count: 1,
        kind: 'auto',
      },
      {
        /*
         * 贡献者面板里那句「你是这一条的贡献者：改动**直接生效**」（2026-09-14）。
         *
         * ⚠️ 它加进来时这条守卫**当场就红了**（那时调用点还不存在），报的是
         * "既没有字面量调用点、也不在任何白名单里" —— 这正是它该有的行为：
         * 词条先加、界面后接的那段时间里，守卫逼着人要么把它接上、要么显式登记。
         * 这里登记的是**已经接好**的那一处（`em(...)`），不是豁免。
         */
        file: 'apps/web/src/components/ContributorPanel.tsx',
        key: 'resourceContrib.directEdit',
        shape: 'em',
        count: 1,
        kind: 'auto',
      },
      {
        file: 'apps/web/src/components/RoleGuide.tsx',
        key: 'auth.roleGuideIntro',
        shape: 'em',
        count: 1,
        kind: 'auto',
      },
      {
        file: 'apps/web/src/routes/ReviewDetail.tsx',
        key: 'review.selfReviewBlocked',
        shape: 'notice-child',
        count: 1,
        kind: 'auto',
      },
      {
        file: 'apps/web/src/routes/ReviewDetail.tsx',
        key: 'review.editExplain',
        shape: 'em',
        count: 1,
        kind: 'auto',
      },
      {
        file: 'apps/web/src/routes/EditResource.tsx',
        key: 'edit.liveUnchanged',
        shape: 'em',
        count: 1,
        kind: 'auto',
      },
      {
        file: 'apps/web/src/components/ModerationBar.tsx',
        key: 'moderate.hiddenNote',
        shape: 'em',
        count: 1,
        kind: 'auto',
      },
      {
        file: 'apps/web/src/components/MarksPanel.tsx',
        key: 'marks.noteHint',
        shape: 'em',
        count: 1,
        kind: 'auto',
      },
      {
        file: 'apps/web/src/components/VideoForm.tsx',
        key: 'videos.hintUrl',
        shape: 'field-hint',
        count: 1,
        kind: 'auto',
      },
      {
        file: 'apps/web/src/routes/Seeds.tsx',
        key: 'seedsPage.resultStale',
        shape: 'em',
        count: 1,
        kind: 'auto',
      },
      {
        file: 'apps/web/src/components/SeedSaveForm.tsx',
        key: 'seedsPage.saveWarning',
        shape: 'notice-child',
        count: 1,
        kind: 'auto',
      },
      {
        file: 'apps/web/src/components/SeedSaveForm.tsx',
        key: 'seedsPage.saveQuotaNote',
        shape: 'em',
        count: 1,
        kind: 'auto',
      },
      {
        file: 'apps/web/src/routes/Live.tsx',
        key: 'live.recordsChannels',
        shape: 'em',
        count: 1,
        kind: 'auto',
      },
      {
        file: 'apps/web/src/components/LiveManagePanel.tsx',
        key: 'liveManage.hintUrl',
        shape: 'field-hint',
        count: 1,
        kind: 'auto',
      },
      {
        file: 'apps/web/src/components/CalendarForm.tsx',
        key: 'authoring.directHint',
        shape: 'emText',
        count: 1,
        kind: 'auto',
      },
      {
        /*
         * 「直接保存 / 直接发布」那个按钮的 tooltip 现在**按身份**给（2026-09-14）：
         * 编辑读 `authoring.directHint`（"你是内容编辑…"），**贡献者**读
         * `resourceContrib.directEdit`（"你是**这一条**的贡献者…"）。
         *
         * ⚠️ 之前剥标记的是 `ResourceForm`（它自己 `emText(t('authoring.directHint'))`），
         *    而那一处**必须**搬到调用点：贡献者也会看到这个按钮之后，tooltip 变成
         *    了两句里挑一句（`title: canAuthor ? … : …`），表单不可能再自己挑 ——
         *    而裸 `t()` 传给一个 prop 在**源码形状**上是 `unsafe`。
         *    ⇒ 三个调用点各自写 `emText(...)`，于是它们都落进 `emText` 这个**自动**形状，
         *      一分白名单都不用加。⚠️ 这也正是"允许形状"那张表要的形态：
         *      能自动判的，就不要写成豁免（豁免会漂移，形状不会）。
         */
        file: 'apps/web/src/routes/EditResource.tsx',
        key: 'authoring.directHint',
        shape: 'emText',
        count: 1,
        kind: 'auto',
      },
      {
        file: 'apps/web/src/routes/EditResource.tsx',
        key: 'resourceContrib.directEdit',
        shape: 'emText',
        count: 1,
        kind: 'auto',
      },
      {
        file: 'apps/web/src/routes/SubmitResource.tsx',
        key: 'authoring.directHint',
        shape: 'emText',
        count: 1,
        kind: 'auto',
      },
      {
        file: 'apps/web/src/routes/CalendarEdit.tsx',
        key: 'authoring.deleteImpact',
        shape: 'em',
        count: 1,
        kind: 'auto',
      },
      {
        file: 'apps/web/src/routes/EditResource.tsx',
        key: 'authoring.deleteImpact',
        shape: 'em',
        count: 1,
        kind: 'auto',
      },
      {
        file: 'apps/web/src/components/LiveManagePanel.tsx',
        key: 'liveManage.errUrlNotLink',
        shape: 'unsafe',
        count: 1,
        kind: 'why-safe',
        why:
          '值先存进 `errors.url`（一个 Record<string,string>），随后在同一个文件的 ' +
          "`<Field … hint={errors.url ?? t('liveManage.hintUrl')}>` 上交给 `Field` —— " +
          '而 `Field` 会对 hint 调 `em()`（见 WIRING 自证：Form.tsx 里 `em(hint)` + ' +
          '"hint 只挂在 Field 上"）。⇒ **渲染点是安全的**，只是离调用点隔着一个变量，' +
          '静态形状匹配不到它。⚠️ 这一条的前提是"errors.url 只喂给 hint"——' +
          '哪天有人把它喂给 title= 或 aria-label=，这里必须跟着改。',
      },
      {
        file: 'apps/web/src/routes/EditResource.tsx',
        key: 'authoring.alreadyPending',
        shape: 'unsafe',
        count: 1,
        kind: 'why-safe',
        why:
          '值存进 state（`setDirectNotice({ ok: false, text: t(...) })`），随后渲染成 ' +
          '`<Notice kind={…}>{directNotice.text}</Notice>` —— **单一字符串子节点**，' +
          "所以 `Notice` 会对它调 `em()`（`typeof children === 'string'` 那一支）。" +
          '⇒ 安全，但形状匹配不到（中间隔着一个 state）。' +
          '⚠️ 前提是"这个 text 只喂给 Notice 的子节点位置"；喂给 `title=` 就不安全了。',
      },
      {
        file: 'apps/web/src/lib/submissionErrors.ts',
        key: 'authoring.mustHideFirst',
        shape: 'unsafe',
        count: 1,
        kind: 'why-safe',
        why:
          '这是**模块内部的出口**：整个 `switch` 已抽进 `describeRawSubmissionError`，' +
          '它的返回类型 `RawSubmissionErrorInfo` 里 `message` 是 **string**；' +
          '对外的 `describeSubmissionError` **只有一个 return**，整体套一次 `em()`。' +
          '⇒ "所有出口都过 em()"是**结构 + 类型**保证的（第二条 return 会让这句话不成立）。' +
          '运行时的逐出口证明在 `apps/web/scripts/authoringNotice.ts`（喂带 `**` 的探针，' +
          '每一个出口都必须渲染出 `<strong>`）。',
      },
      {
        file: 'apps/web/src/routes/EditResource.tsx',
        key: 'authoring.mustHideFirst',
        shape: 'em',
        count: 1,
        kind: 'auto',
      },
    ];

    /**
     * ★ 白名单 B：**拼出来的 key**（没有字面量调用点）。
     *    ⚠️ 这一张不是"免检通道"：下面同时断言
     *      ① 这些键**确实**没有任何字面量调用点（哪天有人写了字面量，它就必须从这里搬走）；
     *      ② 它们**唯一的渲染点**长什么样（`RoleGuide.tsx` 里的两处 `em(t(表[?]))`）——
     *         那张表自己写错/少一行不会有任何报错，所以渲染点必须被钉住。
     */
    const DYNAMIC_KEYS: readonly { key: string; why: string }[] = [
      {
        key: 'auth.rankNoteOwner',
        why: 'RoleGuide 的 RANK_NOTES 表按角色取（`t(RANK_NOTES[role])`）',
      },
      { key: 'auth.rankNoteAdmin', why: '同上（RANK_NOTES）' },
      { key: 'auth.rankNoteReviewer', why: '同上（RANK_NOTES）' },
      { key: 'auth.capDescResourceEditAny', why: 'RoleGuide 的 CAP_DESC 表按能力名取' },
      { key: 'auth.capDescResourceEditUnpublished', why: '同上（CAP_DESC）' },
      { key: 'auth.capDescResourceModerate', why: '同上（CAP_DESC）' },
      {
        /*
         * `share.moderate` 的完整说明（2026-09-15，实时分享）。
         *
         * ⚠️ 它属于**这张**表而不是 `UNWIRED_KEYS`：词条加进来的**同一个任务**
         * 就在 `RoleGuide.tsx` 的 `CAP_DESC` 里接了它 ⇒ 它已经有渲染点，
         * 只是那个渲染点是**拼出来的 key**（`t(CAP_DESC[cap])`）。
         * 放进 `UNWIRED_KEYS` 会红在"清单里描述的调用点源码里已经没有了"那一边
         * （第 ⑥ 条断言这些键**必须**没有字面量调用点，第 ⑨ 条要求有覆盖）。
         */
        key: 'auth.capDescShareModerate',
        why: 'RoleGuide 的 CAP_DESC 表按能力名取（`share.moderate`，渲染点同上）',
      },
    ];

    /**
     * ★ 白名单 C：带 `**`、但**今天没有任何调用点**的词条（第 ⑨ 条完整性检查要它）。
     *
     * ⚠️ 为什么需要这张表：第 ⑨ 条要求"每一个带 `**` 的 key 都要么有字面量调用点、
     *    要么在白名单上" —— 没有它的话，一个"词条写好了但界面还没接"的条目会被
     *    要求**立刻**有覆盖，而那时最省事的处置往往是**把 `**` 从词条里删掉**
     *    （等于把问题藏起来）。有了这张表，处置是"写清打算接到哪"。
     *
     * ★ 今天这张表里是 **1 条**（27 个带 `**` 的键：19 个有字面量调用点 +
     *    7 个动态 + 1 个还没接）。⚠️ 这条注释以前写的是"0 条（24 个 ……18 + 6）"——
     *    那是**陈旧**的：本轮（2026-09-15）新增两条之后实测 27，
     *    而当时那条注释里的 24 也已经比实测少 1（字面量那半边是 19 不是 18）。
     *
     * ⚠️ `shares.hideHint` 是这一张表**第一次**真正被用到 —— 理由写在下面那一条里。
     */
    const UNWIRED_KEYS: readonly { key: string; why: string }[] = [
      {
        /*
         * ★ 「下架之后看板上就没有了，随时可以恢复。**到点**之后就不能恢复了。」
         *
         * ⚠️ 它今天确实**没有人渲染**：渲染它的 `ShareMineBar` 是 Task 5 才建的
         * （本任务只加词条与守卫，页面在 T5–T7）。⇒ 此刻的唯一正确处置是
         * **登记**，而不是把 `**` 从词条里删掉（那等于把"强调还没接上"藏起来），
         * 也不是在这里写一个**指向还不存在的文件**的 `EXPECTED_SITES` 条目
         * （那会让第 ⑤ 条"清单 == 实测"红在一个不存在的东西上）。
         * ★ Task 5 建好 `ShareMineBar` 之后：把它从这张表**搬进** `EXPECTED_SITES`
         * （按渲染点的真实形状登记，多半是 `em` 或 `field-hint`）。
         */
        key: 'shares.hideHint',
        why:
          '渲染点是 Task 5 才建的 `ShareMineBar`（此刻还没有这个文件）；' +
          '建成之后按真实形状搬进 EXPECTED_SITES',
      },
    ];

    /**
     * ★★ 把**注释**挖成空格（**等长**、换行保留 ⇒ 行号不漂）。
     *
     * ⚠️ 为什么非做不可（这一条是**实测撞出来的**，不是预防性设计）：
     *    本守卫第一版直接在源码文本上找 `t('…')`，结果**当场报了一个假警报** ——
     *    `Emphasis.tsx` 的**文档注释**里写着
     *    「把 `t('authoring.directHint')` 原样放进去，浏览器气泡里就是一对星号」，
     *    而那句话是在**解释**这个缺陷，不是调用点。
     *    假警报的下场是可预料的：下一个人给守卫加一条"注释不算"的白名单，
     *    然后**真缺陷也一起被放过**（`check-font-coverage.mjs` 与 `zh-CN.ts`
     *    的注释里为同一件事写过记录）。
     *
     * ⚠️ 但"挖注释"必须**认得字符串**：本仓到处都是 `'https://…'`，
     *    朴素实现会把 `//` 当成行注释开头、把这一行**后面**的东西一起挖掉 ——
     *    那会**漏掉真调用点**（比假警报更坏：它是静默的）。
     *    所以这里按状态机走：字符串 / 模板串里的 `//` **不是**注释；
     *    而模板串里的 `${…}` **仍然是代码**（要找的调用点可能就在那里面）。
     *    ⇒ 三条都由下面 `BLANK_PROBES` 逐条证。
     */
    function blankComments(src: string): string {
      const out = src.split('');
      const stack: string[] = [];
      const wipe = (from: number, to: number): void => {
        for (let k = from; k < to && k < src.length; k += 1) {
          if (src[k] !== '\n') out[k] = ' ';
        }
      };
      let i = 0;
      while (i < src.length) {
        const ch = src[i] as string;
        const top = stack[stack.length - 1];
        if (top === "'" || top === '"') {
          if (ch === '\\') i += 2;
          else {
            if (ch === top) stack.pop();
            i += 1;
          }
          continue;
        }
        if (top === '`') {
          if (ch === '\\') i += 2;
          else if (ch === '`') {
            stack.pop();
            i += 1;
          } else if (ch === '$' && src[i + 1] === '{') {
            stack.push('{');
            i += 2;
          } else i += 1;
          continue;
        }
        // 代码态（顶层，或模板串 `${}` 里面）
        if (ch === '/' && src[i + 1] === '/') {
          const nl = src.indexOf('\n', i);
          const end = nl === -1 ? src.length : nl;
          wipe(i, end);
          i = end;
          continue;
        }
        if (ch === '/' && src[i + 1] === '*') {
          const close = src.indexOf('*/', i + 2);
          const end = close === -1 ? src.length : close + 2;
          wipe(i, end);
          i = end;
          continue;
        }
        if (ch === "'" || ch === '"' || ch === '`') {
          stack.push(ch);
          i += 1;
          continue;
        }
        if (ch === '}' && top === '{') {
          stack.pop();
          i += 1;
          continue;
        }
        i += 1;
      }
      return out.join('');
    }

    /** 抽出一次 `t('字面量')` 调用的实参括号位置。 */
    function callEnd(src: string, paren: number): number {
      let depth = 0;
      let quote: string | null = null;
      for (let i = paren; i < src.length; i += 1) {
        const ch = src[i] as string;
        if (quote) {
          if (ch === '\\') i += 1;
          else if (ch === quote) quote = null;
          continue;
        }
        if (ch === "'" || ch === '"' || ch === '`') quote = ch;
        else if (ch === '(') depth += 1;
        else if (ch === ')') {
          depth -= 1;
          if (depth === 0) return i + 1;
        }
      }
      return src.length;
    }

    /**
     * ⚠️ 判据是**紧贴调用点**的结构（没有行距参数）：函数一律不成比例地放宽，
     *    因为"放宽到能过"的那一天，它同时也放过了真缺陷。
     */
    function classify(src: string, at: number, paren: number): Shape {
      const before = src.slice(Math.max(0, at - 48), at);
      if (/(?:^|[^\w$.])emText\(\s*$/.test(before)) return 'emText';
      if (/(?:^|[^\w$.])em\(\s*$/.test(before)) return 'em';
      // <Field … hint={ … t('k') … }>：`hint={` 之后没有闭合的 `}`（那会说明属性已经结束）
      const hintAt = src.lastIndexOf('hint={', at);
      if (hintAt >= 0 && !/[}<]/.test(src.slice(hintAt + 6, at))) return 'field-hint';
      // <Notice …>{t('k')}</Notice>：**整个**子节点表达式就是这一次调用
      const braceAt = src.lastIndexOf('{', at);
      if (braceAt >= 0 && src.slice(braceAt + 1, at).trim() === '') {
        const end = callEnd(src, paren);
        const closeAt = src.indexOf('}', end);
        if (closeAt >= 0 && src.slice(end, closeAt).trim() === '') {
          const lt = src.lastIndexOf('<', braceAt);
          const tag = lt >= 0 ? /^([A-Za-z][\w.]*)/.exec(src.slice(lt + 1))?.[1] : undefined;
          if (tag === 'Notice') return 'notice-child';
        }
      }
      return 'unsafe';
    }

    const CALL = /\bt\(\s*(?:'([^'\\]+)'|"([^"\\]+)")\s*(?:,|\))/g;

    /** 从一段源码里抽出"某个 key 的调用点"及其形状。 */
    function sitesIn(
      file: string,
      src: string,
      marked: Set<string>,
    ): {
      file: string;
      line: number;
      key: string;
      shape: Shape;
    }[] {
      const out: { file: string; line: number; key: string; shape: Shape }[] = [];
      for (const m of src.matchAll(CALL)) {
        const key = m[1] ?? m[2];
        if (!key || !marked.has(key)) continue;
        const at = m.index ?? 0;
        const paren = at + m[0].indexOf('(');
        out.push({
          file,
          key,
          shape: classify(src, at, paren),
          line: src.slice(0, at).split('\n').length,
        });
      }
      return out;
    }

    /*
     * ① ★ key 集合来自**加载后的字典**（不扫源码、不 grep）—— 见本节说明。
     */
    const marked = new Set<string>();
    for (const dict of [zhCN, en]) {
      for (const [key, value] of valueMap(dict)) if (value.includes('**')) marked.add(key);
    }
    assert.ok(
      marked.size >= 27,
      `只有 ${String(marked.size)} 个词条带 \`**\`（实测 27）—— 少了多半是**词条被改坏**：` +
        '把强调标记去掉之后，这些词条在字符串上下文里就不再有星号，下面整条守卫会跟着空转。' +
        '（确实有意删掉时，把 27 改成新的实测值并在注释里说明。）' +
        '⚠️ 2026-09-15：下限从 24 改成 27 —— 本轮新增 `shares.hideHint` 与 ' +
        '`auth.capDescShareModerate` 两条（+2），而 24 这个数**当时就已经比实测少 1**' +
        '（实测 25：19 个字面量调用点 + 6 个动态，注释里却写着 18 + 6）。' +
        '按本文件的规矩（下限钉在**实测值**上）钉到 27。',
    );
    // 针孔探针：两个**真的修过**的靶子必须在集合里（否则下面的断言是在验空气）
    for (const key of [
      'authoring.directHint',
      'authoring.mustHideFirst',
      'liveManage.hintUrl',
      'videos.hintUrl',
    ]) {
      assert.ok(marked.has(key), `针孔探针：${key} 必须带 \`**\`（它是本守卫的靶子之一）`);
    }

    /*
     * ② 覆盖面控制：两个根目录都必须存在（改名/挪位时立刻红，而不是静默少扫）。
     */
    for (const root of roots) {
      assert.ok(
        statSync(root).isDirectory(),
        `应扫的目录不存在：${root.slice(repo.length + 1)} —— 少扫一个根，` +
          '"没问题"与"没扫到"就是同一个结果。',
      );
    }

    /*
     * ③ 扫源码（两个根），按 (文件, 键, 形状) 汇总。
     */
    const measured = new Map<string, number>();
    const scanned: string[] = [];
    /** 文件 → 挖掉注释之后的那份源码（形状判定与属性归属都在它上面做）。 */
    const codeOf = new Map<string, string>();
    let total = 0;
    for (const root of roots) {
      for (const file of walk(root)) {
        const rel = file.slice(repo.length + 1).replaceAll('\\', '/');
        scanned.push(rel);
        const code = blankComments(readFileSync(file, 'utf8'));
        codeOf.set(rel, code);
        for (const site of sitesIn(rel, code, marked)) {
          total += 1;
          const entry = `${site.file} :: ${site.key} :: ${site.shape}`;
          measured.set(entry, (measured.get(entry) ?? 0) + 1);
        }
      }
    }
    assert.ok(
      scanned.includes('apps/web/src/components/RoleGuide.tsx'),
      '覆盖面退化：没有扫到 apps/web/src/components/RoleGuide.tsx（那是带 `**` 的词条的集中地）',
    );
    assert.ok(
      total >= 21,
      `只扫到 ${String(total)} 处带 \`**\` 的词条调用点（实测 21）—— 扫描器漏扫了，` +
        '此时"没问题"与"没扫到"是同一个结果。',
    );
    /*
     * ★ 真实世界里那条假警报的回归：`Emphasis.tsx` 的**注释**里就写着
     *   `t('authoring.directHint')`（那一段正是"为什么需要 emText"的说明）。
     *   它必须**不**被当成调用点 —— 这是"注释要被挖掉"那件事的活证据。
     */
    assert.equal(
      [...measured.keys()].some((e) => e.startsWith('apps/web/src/components/Emphasis.tsx ::')),
      false,
      'Emphasis.tsx 被扫出了调用点 —— 那里 `t(…)` 只出现在**注释**里（讲 emText 为什么存在），' +
        '多半是注释没被挖掉。假警报会诱出白名单，而白名单会连真缺陷一起放过。',
    );

    /*
     * ④ ★ 分类器**自证**（反面控制在最后一条）：同一个提取器 + 分类器，
     *    喂一段夹具，四种允许形状各命中一次，**裸调用必须被判成 unsafe** ——
     *    没有这一条，"分类器写坏了"与"所有调用点都安全"在输出上无法区分。
     */
    const FIXTURE = [
      "const a = em(t('authoring.directHint'));",
      "const b = emText(t('authoring.directHint'));",
      'const c = <Field id="x" hint={t(\'videos.hintUrl\')} />;',
      'const d = <Notice kind="info">{t(\'seedsPage.saveWarning\')}</Notice>;',
      "const e = <p>{t('authoring.mustHideFirst')}</p>;",
    ].join('\n');
    const fixtureShapes = sitesIn('fixture.tsx', blankComments(FIXTURE), marked).map(
      (s) => s.shape,
    );
    assert.deepEqual(
      fixtureShapes,
      ['em', 'emText', 'field-hint', 'notice-child', 'unsafe'],
      '分类器自证失败：`em` / `emText` / `Field 的 hint` / `Notice 的单一字符串子节点` ' +
        '四种形状必须各命中一次，而**裸调用必须判成 unsafe** —— ' +
        '这一条不成立的话，下面那条"全都安全"是因为它把什么都当成了安全。',
    );

    /*
     * ④b ★ "挖注释"这一步本身也要有探针 —— 它有两个方向都会出错：
     *    挖太少（注释里的 `t(…)` 变成假警报，诱出白名单）与
     *    挖太多（字符串里的 `//` 被当成注释开头 ⇒ 漏掉**真**调用点，静默）。
     */
    const BLANK_PROBES: readonly (readonly [name: string, src: string, want: number])[] = [
      ['行注释里的 t(…) 不算调用点', "// t('authoring.directHint')\nconst x = 1;", 0],
      ['块注释里的 t(…) 不算调用点', "/* t('authoring.directHint') */\nconst x = 1;", 0],
      [
        '字符串里的 // 不能把同一行后面的调用点一起挖掉',
        "const u = 'https://e.x/y';\nconst a = em(t('authoring.directHint'));",
        1,
      ],
      [
        '模板串里的插值部分仍然是代码（那里面可能就有调用点）',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: 这条探针**就是要**让夹具里出现字面的插值写法 —— 改成模板串的话插值会被求值，探针就变成别的东西了
        "const s = `x ${t('authoring.directHint')} y`;",
        1,
      ],
    ];
    for (const [name, src, want] of BLANK_PROBES) {
      const code = blankComments(src);
      assert.equal(code.length, src.length, `挖注释必须**等长**（否则行号会漂）：${name}`);
      assert.equal(
        sitesIn('probe.tsx', code, marked).length,
        want,
        `"挖注释"探针失败（期望 ${String(want)} 处）：${name}`,
      );
    }
    /* 行号必须还对得上（挖注释会把字符换成空格，绝不能把换行也吃掉） */
    assert.equal(
      sitesIn(
        'probe.tsx',
        blankComments("/* a\nb\nc */ const a = em(t('authoring.directHint'));"),
        marked,
      )[0]?.line,
      3,
      '挖注释之后行号必须仍然是**原文件的行号**（换行被吃掉的话，报出来的位置会指向别处）',
    );

    /*
     * ⑤ ★★ 清单 == 实测。任何漂移都红，报出来的两个方向要分得清：
     *    "多出来"= 有人新写了调用点（**裸的那种就是要抓的**）；"少了"= 有调用点消失了。
     */
    const expectedEntries: string[] = [];
    for (const row of EXPECTED_SITES) {
      assert.ok(
        row.kind === 'auto' || (row.why ?? '').length > 60,
        `${row.file} 的 ${row.key} 被列成了 ${row.kind}，但没写清理由 —— ` +
          '白名单必须"每一条都能读懂为什么"，否则它就是静默跳过。',
      );
      expectedEntries.push(`${row.file} :: ${row.key} :: ${row.shape} ×${String(row.count)}`);
    }
    const measuredEntries = [...measured.entries()].map(([e, n]) => `${e} ×${String(n)}`);
    const appeared = measuredEntries.filter((e) => !expectedEntries.includes(e)).sort();
    const vanished = expectedEntries.filter((e) => !measuredEntries.includes(e)).sort();
    assert.deepEqual(
      { 新出现或形状变了: appeared, 消失或形状变了: vanished },
      { 新出现或形状变了: [], 消失或形状变了: [] },
      '★ 带 `**` 的词条调用点与清单不一致 —— **这不是"测试坏了"，而是"该更新一份清单了"**。\n' +
        '· 「新出现或形状变了」里如果是 **unsafe**：那是一处**裸调用**，用户会看到一对字面星号 ⇒ ' +
        '用 `em()`（节点上下文）/ `emText()`（title、aria-label 这类字符串上下文）/ ' +
        '`Field` 的 `hint` / **单一字符串子节点**的 `Notice` 之一重写它。\n' +
        '· 新出现的那一处如果形状匹配不到但**确实安全**（值先存进 state、或在模块出口统一处理）：' +
        '加进 `EXPECTED_SITES`，`kind` 写 `why-safe`，并把 `why` **写成下一个人能读懂的理由**。\n' +
        '· 「消失或形状变了」= 清单里描述的调用点**源码里已经没有了**。绝大多数情况是' +
        '**有人把它修好了** ⇒ **要做的不是改这条断言，而是把 `EXPECTED_SITES` 里那一行删掉**' +
        "（清单描述的是现状）。⚠️ 如果删掉的那一行原本是 `kind: 'open-defect'`：" +
        '恭喜，那个**已知缺陷已经不存在了** —— 删掉这一行即可。\n' +
        '· 如果你**并没有**改过那处源码，那说明扫描器漏扫了：先查 `blankComments()` 与两个根目录。\n' +
        `（本次扫了 ${String(scanned.length)} 个文件、${String(total)} 处调用点。）`,
    );

    /*
     * ⑥ 白名单 B 不是黑洞：那些键**确实**没有字面量调用点，而且它们的渲染点
     *    被钉住了（表写错/少一行不会有任何报错，所以渲染点必须有人守）。
     */
    for (const row of DYNAMIC_KEYS) {
      assert.equal(
        measuredEntries.some((e) => e.includes(`:: ${row.key} ::`)),
        false,
        `${row.key} 被列进了"拼出来的 key"白名单，但它**有了**字面量调用点（${row.why}）—— ` +
          '这时它必须从白名单里搬走，改由 EXPECTED_SITES 逐处列出。',
      );
    }
    const roleGuide = readFileSync(join(repo, 'apps/web/src/components/RoleGuide.tsx'), 'utf8');
    for (const needle of ['em(t(RANK_NOTES[role]))', 'em(t(CAP_DESC[action.capability]']) {
      assert.ok(
        roleGuide.includes(needle),
        `RoleGuide.tsx 里找不到 \`${needle}\` —— 动态 key（RANK_NOTES / CAP_DESC 那 6 条）` +
          '唯一的安全保障就是"渲染点走 em()"，它变了这条白名单立刻失去理由。',
      );
    }

    /*
     * ⑦ ★ 允许形状的**理由本身**也要被守住：`field-hint` 与 `notice-child` 之所以安全，
     *    靠的是 `Form.tsx` 里那两行接线。它们被改掉时，上面那张表就变成了空话 ——
     *    所以这里把"理由"也变成断言。
     */
    const formSrc = readFileSync(join(repo, 'apps/web/src/components/Form.tsx'), 'utf8');
    assert.ok(
      /em\(hint\)/.test(formSrc),
      'Form.tsx 里找不到 `em(hint)` —— `field-hint` 这个允许形状的理由没了（Field 不再处理标记）',
    );
    assert.ok(
      /typeof children === 'string'\s*\?\s*em\(children\)/.test(formSrc),
      "Form.tsx 里找不到 `typeof children === 'string' ? em(children)` —— " +
        '`notice-child` 这个允许形状的理由没了（Notice 不再处理标记）',
    );

    /*
     * ⑧ ⚠️ `hint` 这个属性名必须**只**挂在 `<Field>` 上：上面的分类只看属性名，
     *    若哪天有人给别的组件也传 `hint=`，那个组件的 hint **不一定**会 `em()`，
     *    而分类器会照样判成安全（静默放过）。
     */
    const hintOwners = new Set<string>();
    for (const rel of scanned) {
      if (!rel.startsWith('apps/web/src/')) continue;
      const src = codeOf.get(rel) ?? '';
      for (const m of src.matchAll(/\bhint=\{/g)) {
        const lt = src.lastIndexOf('<', m.index ?? 0);
        const tag = lt >= 0 ? /^([A-Za-z][\w.]*)/.exec(src.slice(lt + 1))?.[1] : undefined;
        if (tag) hintOwners.add(tag);
      }
    }
    assert.deepEqual(
      [...hintOwners].sort(),
      ['Field'],
      '`hint=` 挂到了别的组件上 —— 分类器把"hint 属性"当成安全形状，' +
        '依据是"只有 `Field` 收 hint 且它会 `em(hint)`"。多出来的那个组件必须先确认会不会处理标记。',
    );

    /*
     * ⑨ ★★ 完整性：字典里**每一个**带 `**` 的 key 都必须落进这条守卫的视野 ——
     *    要么有字面量调用点（出现在 `EXPECTED_SITES` 里），要么在 `DYNAMIC_KEYS`
     *    （拼出来的 key）或 `UNWIRED_KEYS`（今天没人渲染）白名单里。
     *
     * ⚠️⚠️ 少了这一条就有一个**静默洞**：某个带 `**` 的词条如果只被**拼出来的 key**
     *    引用（新写一处 `t(某张表[x])`），它就没有任何字面量调用点 ⇒
     *    上面每一条断言**都不会提到它** —— 而这正是本任务最怕的形状（静默跳过）。
     *    这一条把它变成"要么有覆盖，要么在白名单上写明理由"。
     */
    const coveredKeys = new Set([
      ...EXPECTED_SITES.map((r) => r.key),
      ...DYNAMIC_KEYS.map((r) => r.key),
      ...UNWIRED_KEYS.map((r) => r.key),
    ]);
    assert.deepEqual(
      [...marked].filter((key) => !coveredKeys.has(key)).sort(),
      [],
      '这些带 `**` 的词条**既没有字面量调用点、也不在任何白名单里** ⇒ 这条守卫看不见它们。' +
        '两种处置：① 它由拼出来的 key 渲染 ⇒ 加进 `DYNAMIC_KEYS`（写清渲染点在哪）；' +
        '② 它今天**根本没人渲染**（词条先写好、界面还没接） ⇒ 加进 `UNWIRED_KEYS`（写清接到哪）。' +
        '⚠️ 不要让它停在"没人提到"的状态 —— 那正是这条守卫要消灭的静默。',
    );
  });
});
