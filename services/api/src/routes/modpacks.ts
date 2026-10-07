/**
 * ★ B2：整合包的端点（公开两条读 + `pack.manage` 三条写 + `pack.feature` 一条热门）。
 *
 * ===========================================================================
 * 为什么读是公开的、而写是三条能力
 * ===========================================================================
 * 包的定义（标题 / 简介 / 游戏版本 / modid 清单）本来就是给所有人看的
 * （`/files` 页要按版本列出来），没有任何非公开信息。
 * 而"谁能改它"是一条内容编辑的活（`pack.manage`，reviewer 及以上），
 * "谁决定它上不上推荐位"是另一条（`pack.feature`，**只给 admin / owner**）——
 * 两条分开是刻意的，理由写在 `packages/shared/src/permissions.ts` 那两条能力上。
 *
 * ⚠️ 两条公开读走 `Cache-Control: no-store`：这是"管理数据"（与 B1 的 `/api/mod-tags` 同一条理由）——
 *    缓存住会让管理员看到上一份，而保存时静默覆盖别人的改动。
 * ⚠️ 热门**单独一条端点、挂在 `/api/admin/modpacks`**：塞进 `PATCH /api/modpacks/:id` 的话
 *    权限就是 `pack.manage` ⇒ reviewer 也能设热门，而用户的口径是只给管理员。
 * ⚠️ 写路径**必须**先过 `packInputSchema`：数据层（`../modpacks.ts`）**不去重、也不做 min(1)**，
 *    绕过它就能在库里存下重复项 / 空数组，而数据层那 9 条断言**全绿**。
 * ⚠️ "这个 modid 在不在目录里"是**另一层**：schema 管的是形状，目录管的是内容 ——
 *    两处都过了才允许落库，否则会出现"包里有拼错的 modid，界面到装的时候才发现"。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ModCatalog, parseModCatalog } from '@mcsr/shared/modCatalog';
import { packInputSchema } from '@mcsr/shared/modPacks';
import { Hono } from 'hono';
import { type AuthVariables, requireCapability } from '../auth/middleware';
import {
  createModPack,
  deleteModPack,
  listModPacks,
  readModPack,
  setModPackHot,
  updateModPack,
} from '../modpacks';
import { writeAudit } from '../users';

export const modPacksRoute = new Hono<{ Variables: AuthVariables }>();
export const adminModPacksRoute = new Hono<{ Variables: AuthVariables }>();

/**
 * 校验失败时把 Zod 的问题整理成人能读的形态（与另外九处逐字相同的一份**私有副本**）。
 *
 * ⚠️ 它是私有副本、不是共享模块：本仓的惯例就是"每个用到的路由文件抄一份"
 *    （现读 `git grep -n "function formatIssues" -- services/api/src` ⇒ 9 份函数含本文件；
 *    `../format` **不存在**）。这是计划有意为之，不要顺手抽公共模块。
 */
function formatIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues.map((i) => ({
    field: i.path.map(String).join('.') || '(root)',
    message: i.message,
  }));
}

/** 现读仓库里那份目录（只读，**不写**）—— 判"这个 modid 在不在目录里"必须靠它。 */
function catalogNow(): ModCatalog | null {
  const file = join(process.env.MCSR_CONTENT_DIR ?? '/srv/mcsr-helper/content', 'mod-catalog.json');
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const result = parseModCatalog(parsed);
    // ⚠️ 目录不合法时**拒写**：拿不到"哪些 modid 是真的"，就没法判"这个 modid 存不存在"。
    return result.ok ? result.catalog : null;
  } catch (error) {
    console.warn('[modpacks] 读不出目录，写操作一律拒:', file, error);
    return null;
  }
}

/** 入参里那些**目录里没有**的 modid（空数组 = 全都认得）。 */
function unknownMods(modids: readonly string[], catalog: ModCatalog): string[] {
  const known = new Set(catalog.mods.map((mod) => mod.modid));
  return modids.filter((modid) => !known.has(modid));
}

/** 下发给页面的形状：`modCount` 是**算出来的**，不是一个会与 `modids` 漂移的第二处真相。 */
function toWire(pack: {
  id: string;
  title: string;
  description: string;
  gameVersion: string;
  modids: string[];
  hot: boolean;
}) {
  return { ...pack, modCount: pack.modids.length };
}

// ---------------------------------------------------------------------------
// 公开读（两条）
// ---------------------------------------------------------------------------

modPacksRoute.get('/', (c) => {
  c.header('Cache-Control', 'no-store');
  const gameVersion = c.req.query('gameVersion');
  const items = listModPacks(
    gameVersion === undefined || gameVersion === '' ? {} : { gameVersion },
  );
  return c.json({ items: items.map(toWire), total: items.length });
});

modPacksRoute.get('/:id', (c) => {
  c.header('Cache-Control', 'no-store');
  const pack = readModPack(c.req.param('id'));
  return pack === null ? c.json({ error: 'not_found' }, 404) : c.json(toWire(pack));
});

// ---------------------------------------------------------------------------
// 写（三条）：`pack.manage`（reviewer 及以上）
// ---------------------------------------------------------------------------

modPacksRoute.post('/', requireCapability('pack.manage'), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const catalog = catalogNow();
  if (catalog === null) return c.json({ error: 'catalog_unavailable' }, 500);
  const body = await c.req.json().catch(() => null);
  const parsed = packInputSchema.safeParse(body ?? {});
  if (!parsed.success)
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  const missing = unknownMods(parsed.data.modids, catalog);
  if (missing.length > 0)
    return c.json({ error: 'invalid_input', reason: 'unknown_mod', modids: missing }, 400);
  const now = Date.now();
  const pack = createModPack({ ...parsed.data, actorId: user.id, now });
  writeAudit({
    actorId: user.id,
    action: 'pack.create',
    entityType: 'modpack',
    entityId: pack.id,
    reason: `title=${pack.title}`,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });
  return c.json({ ok: true, pack: toWire(pack) }, 201);
});

modPacksRoute.patch('/:id', requireCapability('pack.manage'), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const id = c.req.param('id');
  const before = readModPack(id);
  if (before === null) return c.json({ error: 'not_found' }, 404);
  const catalog = catalogNow();
  if (catalog === null) return c.json({ error: 'catalog_unavailable' }, 500);
  const body = await c.req.json().catch(() => null);
  const parsed = packInputSchema.safeParse(body ?? {});
  if (!parsed.success)
    return c.json({ error: 'invalid_input', issues: formatIssues(parsed.error) }, 400);
  const missing = unknownMods(parsed.data.modids, catalog);
  if (missing.length > 0)
    return c.json({ error: 'invalid_input', reason: 'unknown_mod', modids: missing }, 400);
  const now = Date.now();
  const pack = updateModPack({ id, ...parsed.data, now });
  if (pack === null) return c.json({ error: 'not_found' }, 404);
  /* ★ 只记**变了的那几格**（spec D11）：把 64 个 modid 抄两遍等于没记 */
  const changed: string[] = [];
  if (before.title !== pack.title) changed.push('title');
  if (before.description !== pack.description) changed.push('description');
  if (before.gameVersion !== pack.gameVersion) changed.push('gameVersion');
  if (JSON.stringify(before.modids) !== JSON.stringify(pack.modids)) changed.push('modids');
  writeAudit({
    actorId: user.id,
    action: 'pack.update',
    entityType: 'modpack',
    entityId: id,
    reason: `changed=${changed.join(',') || '(none)'}`,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });
  return c.json({ ok: true, pack: toWire(pack) });
});

modPacksRoute.delete('/:id', requireCapability('pack.manage'), (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const id = c.req.param('id');
  const before = readModPack(id);
  if (before === null) return c.json({ error: 'not_found' }, 404);
  const now = Date.now();
  if (!deleteModPack(id)) return c.json({ error: 'not_found' }, 404);
  writeAudit({
    actorId: user.id,
    action: 'pack.delete',
    entityType: 'modpack',
    entityId: id,
    // ⚠️ 包已经删了 ⇒ 这一条 reason 里的标题是**唯一**还能看出"删掉的是哪一个"的东西
    reason: `title=${before.title}`,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });
  return c.json({ ok: true, id });
});

// ---------------------------------------------------------------------------
// 热门（一条）：`pack.feature` —— **只给 admin / owner**，所以挂在 /api/admin/modpacks
// ---------------------------------------------------------------------------

adminModPacksRoute.patch('/:id/hot', requireCapability('pack.feature'), async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const hot = (body as { hot?: unknown } | null)?.hot;
  if (typeof hot !== 'boolean') {
    return c.json(
      { error: 'invalid_input', issues: [{ field: 'hot', message: 'hot 必须是布尔值。' }] },
      400,
    );
  }
  const now = Date.now();
  const pack = setModPackHot({ id, hot, now });
  if (pack === null) return c.json({ error: 'not_found' }, 404);
  writeAudit({
    actorId: user.id,
    action: 'pack.hot',
    entityType: 'modpack',
    entityId: id,
    reason: `hot=${String(hot)}`,
    ip: c.req.header('x-real-ip') ?? null,
    now,
  });
  return c.json({ ok: true, pack: toWire(pack) });
});
