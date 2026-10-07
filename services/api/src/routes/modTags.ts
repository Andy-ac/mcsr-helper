/**
 * `/api/mod-tags` —— B1 的**人工标签层**（读公开 / 写要 `catalog.editTags`）。
 *
 * ===========================================================================
 * 为什么读是公开的
 * ===========================================================================
 * 标签本来就在公开目录里（`/api/mod-catalog` 是匿名可读的），这一层只是
 * "哪些是**我们手工设的**"那一半，没有任何非公开信息。
 * ⚠️ 但它仍然要 `no-store`：这是**管理数据**，刚被另一个人改过（整行替换，后写的赢），
 *    缓存住会让管理员看到上一份、保存时静默覆盖掉别人的改动
 *    （与 `routes/resources.ts` 的贡献者名单那一条逐字同一个理由）。
 *
 * ===========================================================================
 * 为什么**只有** DB 那一层（不含出厂值）
 * ===========================================================================
 * 编辑器要能区分"我可以改的"与"来自上游/文件的"：
 *   · 出厂值（`content/mod-overrides.json` 的 `tags`，被生成器搬进目录的 `manualTags`）
 *     在 **DB 里有行之后**就不再是"这一层的值"了（见 `mergeModTagLayer`）；
 *   · 把出厂值也塞进 `assignments` 的话，界面会把"从没人动过"显示成"管理员设过"。
 */
import { ModTagLabelInputSchema, ModTagsInputSchema, TAG_KEY_RE } from '@mcsr/shared/modCatalog';
import { Hono } from 'hono';
import { type AuthVariables, requireCapability } from '../auth/middleware';
import { readTagLayer } from '../mod-tags';

export const modTagsRoute = new Hono<{ Variables: AuthVariables }>();

/** 按代码单元序 —— 与 `packages/shared/src/modCatalog.ts` 里那条同一条（列表要稳定）。 */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

modTagsRoute.get('/', (c) => {
  const layer = readTagLayer();
  c.header('Cache-Control', 'no-store');
  return c.json({
    labels: [...layer.labels]
      .map(([tag, label]) => ({ tag, zh: label.zh, en: label.en }))
      .sort((a, b) => byCodeUnit(a.tag, b.tag)),
    assignments: Object.fromEntries(layer.assignments),
  });
});
