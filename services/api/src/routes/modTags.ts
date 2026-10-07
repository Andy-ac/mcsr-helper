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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type ModCatalog,
  ModTagLabelInputSchema,
  type ModTagLayer,
  ModTagsInputSchema,
  parseModCatalog,
  TAG_KEY_RE,
  tagInUse,
} from '@mcsr/shared/modCatalog';
import { Hono } from 'hono';
import { type AuthVariables, requireCapability } from '../auth/middleware';
import { deleteTagLabel, readTagLayer, setModTags, setTagLabel } from '../mod-tags';
import { writeAudit } from '../users';

export const modTagsRoute = new Hono<{ Variables: AuthVariables }>();

/**
 * 校验失败时把 Zod 的问题整理成人能读的形态（与 auth / authoring / calendar / live /
 * resources / shares / tracking / videos 那八处逐字相同）。
 *
 * ⚠️ 它是一份**私有副本**，不是一个共享模块：本仓的惯例就是"每个用到的路由文件抄一份"
 * （现读 `grep -rn "function formatIssues" services/api/src` 有八处，`../format` 不存在）。
 */
function formatIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues.map((i) => ({
    field: i.path.map(String).join('.') || '(root)',
    message: i.message,
  }));
}

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

// ---------------------------------------------------------------------------
// 写：只有 `catalog.editTags`（reviewer 及以上）能动
// ---------------------------------------------------------------------------

/** 现读仓库里那份目录（这一层只读它，**不写**）。 */
function catalogNow(): ModCatalog | null {
  const file = join(process.env.MCSR_CONTENT_DIR ?? '/srv/mcsr-helper/content', 'mod-catalog.json');
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const result = parseModCatalog(parsed);
    // ⚠️ 目录不合法时**拒写**：拿不到"哪些 modid 是真的"，就没法判"这个 modid 存不存在"。
    return result.ok ? result.catalog : null;
  } catch (error) {
    console.warn('[mod-tags] 读不出目录，写操作一律拒:', file, error);
    return null;
  }
}

/** 存进来的标签必须**已经有显示名**（DB ∪ 目录）—— 否则会下发一份自己就不合法的目录。 */
function unknownTags(tags: readonly string[], catalog: ModCatalog, layer: ModTagLayer): string[] {
  const known = new Set<string>(Object.keys(catalog.tagLabels));
  for (const tag of layer.labels.keys()) known.add(tag);
  return tags.filter((tag) => !known.has(tag));
}

modTagsRoute.put('/:modid', requireCapability('catalog.editTags'), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const catalog = catalogNow();
  if (catalog === null) return c.json({ error: 'catalog_unavailable' }, 500);

  const modid = c.req.param('modid');
  if (!catalog.mods.some((mod) => mod.modid === modid)) return c.json({ error: 'not_found' }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = ModTagsInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  }

  const layer = readTagLayer();
  const missing = unknownTags(parsed.data.tags, catalog, layer);
  if (missing.length > 0) {
    /*
     * ⚠️ 400 而不是"静默丢掉"：丢掉会写下一份**与请求不符**的标签集，
     *    而管理员以为自己已经加上了（与贡献者名单那条逐字同一个理由）。
     */
    return c.json({ error: 'invalid_input', reason: 'unknown_tag', tags: missing }, 400);
  }

  const tags = [...new Set(parsed.data.tags)].sort(byCodeUnit);
  const now = Date.now();
  setModTags({ modid, tags, actorId: user.id, now });
  writeAudit({
    actorId: user.id,
    action: 'mod_tag.set',
    entityType: 'modid',
    entityId: modid,
    reason: `tags=${tags.join(',')}`,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });
  return c.json({ ok: true, modid, tags });
});

modTagsRoute.put('/labels/:tag', requireCapability('catalog.editTags'), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const tag = c.req.param('tag');
  if (!TAG_KEY_RE.test(tag)) {
    return c.json(
      {
        error: 'invalid_input',
        issues: [{ field: 'tag', message: '标签名只允许小写字母、数字和连字符，1–32 个字符。' }],
      },
      400,
    );
  }

  const body = await c.req.json().catch(() => null);
  const parsed = ModTagLabelInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  }

  const before = readTagLayer().labels.get(tag) ?? null;
  const now = Date.now();
  setTagLabel({ tag, zh: parsed.data.zh, en: parsed.data.en, actorId: user.id, now });
  writeAudit({
    actorId: user.id,
    action: 'mod_tag_label.set',
    entityType: 'mod_tag',
    entityId: tag,
    // ★ 前后值都要记：只记"改成了什么"的话，半年后看不出这一次改了什么
    reason: `${before === null ? '（新建）' : `${before.zh}/${before.en}`} → ${parsed.data.zh}/${parsed.data.en}`,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });
  return c.json({ ok: true, tag, zh: parsed.data.zh, en: parsed.data.en });
});

modTagsRoute.delete('/labels/:tag', requireCapability('catalog.editTags'), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const tag = c.req.param('tag');
  const layer = readTagLayer();
  if (!layer.labels.has(tag)) return c.json({ error: 'not_found' }, 404);

  const catalog = catalogNow();
  if (catalog === null) return c.json({ error: 'catalog_unavailable' }, 500);

  const inUse = tagInUse({ tag, catalog, layer });
  if (inUse.used) {
    return c.json({ error: 'tag_in_use', tag, by: inUse.by.slice(0, 5) }, 409);
  }

  const now = Date.now();
  deleteTagLabel({ tag });
  writeAudit({
    actorId: user.id,
    action: 'mod_tag_label.delete',
    entityType: 'mod_tag',
    entityId: tag,
    reason: `删除 ${layer.labels.get(tag)?.zh ?? tag}`,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });
  return c.json({ ok: true, tag });
});
