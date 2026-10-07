/**
 * `/admin/mods` 容器那三个派生值的**纯函数**（B1 / Task 6）。
 *
 * ⚠️★ 它们必须住在容器外面，理由是**可验证性**，不是整洁：
 *    · 渲染自检（`apps/web/scripts/modtagsrender.tsx`）走 `renderToStaticMarkup`
 *      —— **effect 一行都不跑** ⇒ 那个容器在自检里只会渲出"加载中…"那一屏，
 *      它自己的派生逻辑**永远到不了**（本仓 §5.32 第 ④ 类：读数看着有、其实什么都没测）。
 *    · 而"人工层怎么取"是这一页里**会静默删数据**的那一格：漏了目录里的出厂值
 *      （`manualTags`）⇒ 管理员一保存就写下一行不含它的 DB 记录 ⇒ 文件来的标签
 *      **真的没了，且没有任何报错**。
 *    ⇒ 抽成纯函数之后，自检**直接断言这三个函数**（那一组就是它们唯一的判据）。
 *
 * ⚠️ 语义与 `packages/shared/src/modCatalog.ts` 的 `mergeModTagLayer` **同源**
 *    （spec §2 D2）：生效标签 = 自动标签 ∪ 人工层，而人工层的取值规则只有一条。
 *    两处**各写一遍**是不行的 —— 服务端那一份决定"下发什么"，这一份决定"界面显示什么"，
 *    漂开的后果是"界面显示已勾、保存后却少了那个标签"。
 */

/**
 * 人工层（界面里可勾的那些）= `draft[modid]` ?? `DB 那一行` ?? `目录里的出厂值` ?? `[]`。
 *
 * ★ 三个来源的**顺序就是全部内容**，尤其是最后那一格：
 *   · `draft` 赢 —— 它代表"用户这一会儿在界面上的选择，还没保存"；
 *   · `DB 那一行` 赢过出厂值 —— 而"DB 里有一行**空数组**"与"DB 里没有这一行"
 *     **必须分得开**：前者是"管理员清空了它"（那是他的意图），后者是"从没设过"
 *     （这时才回落到文件来的出厂值）。用 `??` 而不是 `||` 就是为这件事 ——
 *     `||` 会把空数组当成"没有"，于是"管理员清空"当场被出厂值覆盖回来。
 *   · 出厂值那一格漏了 ⇒ 那个标签真的没了（注释见上）。
 */
export function manualTagsOf(input: {
  modid: string;
  draft: Record<string, readonly string[]>;
  assignments: Record<string, readonly string[]>;
  manualTags: Record<string, readonly string[]> | undefined;
}): readonly string[] {
  return (
    input.draft[input.modid] ??
    input.assignments[input.modid] ??
    input.manualTags?.[input.modid] ??
    []
  );
}

/**
 * 自动层（界面里不可勾、只读的那些）= 生效标签 − 人工层。
 *
 * ⚠️ 顺序照**生效那一份**（`mod.tags`）：界面上只读 chip 的顺序不该因为
 *    "哪些是自动的"而变化 —— 按差集重排的话，同一份数据在两种勾选状态下
 *    会呈现出两个顺序，看起来像标签自己跳了。
 */
export function automaticTagsOf(input: {
  tags: readonly string[];
  manual: readonly string[];
}): string[] {
  const manual = new Set(input.manual);
  return input.tags.filter((tag) => !manual.has(tag));
}

/**
 * "这一行改过没有"：两边都按**代码单元序**逐元素比。
 *
 * ⚠️★ 判据是"这一行的选择与服务器上那一行**不同**"，**不是**"点过没有"：
 *    勾一下再取消，行内容与服务器一致 ⇒ 没改过（保存键该禁用）。
 *    写成"点过没有"的话，保存键会在一个没有任何改动可保存的行上亮着，
 *    点下去发出的是一次**整行替换**（而这一页没有乐观锁，后写的赢）。
 * ⚠️ 先排序再比：顺序不是改动（`PUT` 那一侧也会去重排序）。
 *    `draft === undefined`（这一行没被碰过）⇒ 直接 false，连排序都不做。
 */
export function isDirty(input: {
  draft: readonly string[] | undefined;
  server: readonly string[];
}): boolean {
  if (input.draft === undefined) return false;
  const a = [...input.draft].sort();
  const b = [...input.server].sort();
  return a.length !== b.length || a.some((tag, i) => tag !== b[i]);
}
