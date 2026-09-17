/**
 * 资源库的数据访问层。
 *
 * 这是**唯一**直接写 SQL 的文件（除了 db/ 目录）。把 SQL 收在一处的好处：
 *   1. 将来换数据库驱动只改这里
 *   2. 所有查询的索引使用情况可以集中审查
 *   3. 路由层只处理 HTTP，不掺 SQL
 */
import type { DatabaseSync } from 'node:sqlite';
import type { RatingSummary } from '@mcsr/shared/resources';
import {
  normalizeResourceInput,
  type Resource,
  type ResourceDetail,
  type ResourceListItem,
  type ResourceListResponse,
  type ResourceQuery,
} from '@mcsr/shared/resources';
import { deleteContributors } from './contributors';
import { getDb } from './db';
import { EMPTY_RATING, favoriteCountOf, favoritesFor, ratingOf, ratingsFor } from './marks';

/** 数据库里的一行（snake_case，tags 是 JSON 文本，featured/official 是 0/1）。 */
interface ResourceRow {
  id: string;
  kind: string;
  title: string;
  title_en: string | null;
  url: string;
  image_url: string | null;
  summary: string | null;
  body: string;
  lang: string;
  tags: string;
  featured: number;
  official: number;
  status: string;
  created_at: number;
  updated_at: number;
}

const SELECT_COLUMNS = `
  id, kind, title, title_en, url, image_url, summary, body, lang, tags,
  featured, official, status, created_at, updated_at
`;

/** tags 是 JSON 文本列；解析失败不应该让整个列表 500，退化成空数组并留个日志。 */
function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is string => typeof t === 'string');
  } catch {
    console.warn('[resources] tags 不是合法 JSON，按空数组处理:', raw.slice(0, 60));
    return [];
  }
}

function toResource(row: ResourceRow): Resource {
  return {
    id: row.id,
    kind: row.kind as Resource['kind'],
    title: row.title,
    titleEn: row.title_en,
    url: row.url,
    imageUrl: row.image_url,
    summary: row.summary,
    body: row.body,
    lang: row.lang as Resource['lang'],
    tags: parseTags(row.tags),
    featured: row.featured === 1,
    official: row.official === 1,
    status: row.status as Resource['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 列表项去掉 body —— 列表接口不下发正文，省带宽也省序列化时间。
 *
 * ⚠️ `rating` 与 `favoriteCount` 都由调用方**必须传入**（它们来自另一张表的聚合，
 *    不是这一行的字段）。在函数里给它们一个默认值的话，"忘了查"会变成
 *    "永远是空的/永远是 0" —— 静默失效，而不是编译报错。
 *    两个参数都**没有默认值**，这条是刻意的（见 callers 里那次 GROUP BY）。
 */
function toListItem(
  resource: Resource,
  rating: RatingSummary,
  favoriteCount: number,
): ResourceListItem {
  const { body: _body, ...rest } = resource;
  return { ...rest, rating, favoriteCount };
}

/**
 * LIKE 的通配符转义。
 *
 * 不转义的话，用户在搜索框里打一个 `%` 就会匹配全部记录，打 `_` 会匹配任意单字符 ——
 * 看起来像"搜索坏了"。用 `\` 作转义符，配合 SQL 里的 `ESCAPE '\'`。
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

export function listResources(
  query: ResourceQuery,
  options: { includeHidden?: boolean } = {},
): ResourceListResponse {
  const db: DatabaseSync = getDb();

  /*
   * 默认只暴露已发布内容。
   *
   * `includeHidden` 是给**有下架权的人**（editor / admin）用的：
   * 下架之后那条内容就从列表里消失了 —— 没有这个开关的话，
   * 编辑者**再也找不到它**，也就无法恢复。那不是"下架"，
   * 那是"一条单向的路"。
   *
   * ⚠️ 这个开关由**路由层**按能力决定是否允许（见 routes/resources.ts），
   *    不在这里判权限 —— 数据层只管按参数查，权限判在一处。
   */
  const where: string[] = [
    options.includeHidden ? "status IN ('published', 'hidden')" : "status = 'published'",
  ];
  const params: Array<string | number> = [];

  if (query.kind) {
    where.push('kind = ?');
    params.push(query.kind);
  }
  if (query.lang) {
    where.push('lang = ?');
    params.push(query.lang);
  }
  if (query.tag) {
    // 带引号匹配，所以 `tools` 不会误配 `tools-extra`
    where.push("tags LIKE ? ESCAPE '\\'");
    params.push(`%"${escapeLike(query.tag.toLowerCase())}"%`);
  }
  if (query.q) {
    const like = `%${escapeLike(query.q)}%`;
    where.push(
      "(title LIKE ? ESCAPE '\\' OR title_en LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')",
    );
    params.push(like, like, like, like);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;

  const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM resources ${whereSql}`).get(...params) as
    | { n: number }
    | undefined;
  const total = totalRow?.n ?? 0;

  const offset = (query.page - 1) * query.pageSize;
  // node:sqlite 的行类型是 Record<string, SQLOutputValue>，与我们声明的具名接口
  // 没有结构上的重叠，所以必须先转 unknown。
  // 这是**唯一**允许这么绕的地方：SQL 与类型定义的对应关系由本文件的 SELECT_COLUMNS 保证，
  // 而它是这段代码正上方的一个常量，一眼能对照。
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM resources ${whereSql}
       ORDER BY featured DESC, updated_at DESC, id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, query.pageSize, offset) as unknown as ResourceRow[];

  /*
   * 评分与收藏数各是一次 GROUP BY 拿回来的，不是每条内容查一次 ——
   * 列表一页 24 条，那样就是 48 次查询，而它本来只需要两次。
   *
   * ⚠️ 两批聚合**用同一批 id**（`rows.map(...)`）在紧挨着的地方算：
   *    分成两处算很容易出现"某天只在一条路上加了聚合、另一条路忘了"，
   *    而那种漏掉不会有任何报错（只是数字停在 0）。
   */
  const ids = rows.map((row) => row.id);
  const ratings = ratingsFor(ids);
  const favorites = favoritesFor(ids);

  return {
    items: rows.map((row) =>
      toListItem(toResource(row), ratings.get(row.id) ?? EMPTY_RATING, favorites.get(row.id) ?? 0),
    ),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/**
 * 某个条目当前的待审版本号；没有待审内容时为 null。
 *
 * 编辑页用它回答"现在有没有别人已经提了一份修改" —— 见 shared 里
 * EditableResource 的注释。
 */
export function resourcePendingRevision(id: string): number | null {
  const row = getDb().prepare('SELECT pending_revision FROM resources WHERE id = ?').get(id) as
    | { pending_revision: number | null }
    | undefined;
  return row?.pending_revision ?? null;
}

/**
 * 设置「精选」「官方」。
 *
 * ⚠️ 只改**传了的**字段（undefined = 不动它）。
 *    把缺省当成 false 的话，一次"取消精选"的调用会把 official 也一起清掉 ——
 *    而那种 bug 在界面上表现为"我只点了一个按钮，另一个标记也消失了"。
 */
export function setResourceFlags(
  id: string,
  flags: { featured?: boolean | undefined; official?: boolean | undefined },
  now: number,
): void {
  const sets: string[] = [];
  const params: Array<string | number> = [];
  if (flags.featured !== undefined) {
    sets.push('featured = ?');
    params.push(flags.featured ? 1 : 0);
  }
  if (flags.official !== undefined) {
    sets.push('official = ?');
    params.push(flags.official ? 1 : 0);
  }
  if (sets.length === 0) return;

  params.push(now, id);
  getDb()
    .prepare(`UPDATE resources SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...params);
}

/**
 * 下架 / 恢复一条已上架的内容。
 *
 * 状态规则刻意做得很窄 —— 宁可拒绝也不猜：
 *   · **下架**：只有当前是 published 的才能下架。对一条还没上架的内容
 *     "下架"没有意义，而且会让状态变得含糊（它是"被撤下来的"还是
 *     "从没上去过"？）—— 含糊的状态几个月后一定会有人搞错。
 *   · **恢复**：没有待审版本就回到 published；有待审版本则回到 pending
 *     （说明下架期间有人改过它，那改动还没被审过，不该跟着一起上线）。
 *
 * ⚠️ 这里**不看 current_revision**：导入的条目 status 就是 published
 *    而根本没有版本号 —— 和 reviseResource 里踩过的那个坑是同一个。
 */
export function setResourceVisibility(
  id: string,
  published: boolean,
  now: number,
): { ok: true; status: string } | { ok: false; reason: 'not_found' | 'not_published' | 'already' } {
  const db = getDb();
  const row = db.prepare('SELECT status, pending_revision FROM resources WHERE id = ?').get(id) as
    | { status: string; pending_revision: number | null }
    | undefined;
  if (!row) return { ok: false, reason: 'not_found' };

  if (!published) {
    if (row.status !== 'published') return { ok: false, reason: 'not_published' };
    db.prepare('UPDATE resources SET status = ?, updated_at = ? WHERE id = ?').run(
      'hidden',
      now,
      id,
    );
    return { ok: true, status: 'hidden' };
  }

  if (row.status === 'published') return { ok: false, reason: 'already' };
  const next = row.pending_revision === null ? 'published' : 'pending';
  db.prepare('UPDATE resources SET status = ?, updated_at = ? WHERE id = ?').run(next, now, id);
  return { ok: true, status: next };
}

export function getResource(id: string): ResourceDetail | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM resources WHERE id = ? AND status = 'published'`)
    .get(id) as unknown as ResourceRow | undefined;
  /*
   * 详情只有一条，所以这里用 `ratingOf` / `favoriteCountOf` 各查一次 —— 不需要
   * 列表那条"一次 GROUP BY"的路。两者都是**必填字段**，所以都要给值。
   */
  return row
    ? { ...toResource(row), rating: ratingOf(id), favoriteCount: favoriteCountOf(id) }
    : null;
}

/**
 * 按 id 读内容，**不看状态**。
 *
 * ⚠️ 它和 getResource 是两件不同的事，不能互相替代：
 *    getResource 是给**公开页面**用的，只认已发布的内容；
 *    这个函数是给"编辑我自己那条还没上架/被驳回的条目"用的 ——
 *    那种条目从来没有出现在公开页面上，但它必须能被它的作者打开。
 *
 * 因此**绝不能**把它接到任何公开路由上：那等于把所有人没通过的草稿
 * （和它们被驳回的理由）都公开出去。调用方必须先判明"这是不是本人的条目"。
 */
export function getResourceAnyStatus(id: string): ResourceDetail | null {
  const row = getDb()
    .prepare(`SELECT ${SELECT_COLUMNS} FROM resources WHERE id = ?`)
    .get(id) as unknown as ResourceRow | undefined;
  // 未上架的内容也要带评分与收藏数：编辑页会显示它们，而这两者和"上没上架"无关
  // （收藏是**别人**对这条内容做的动作，内容被下架不会让那些收藏消失）
  return row
    ? { ...toResource(row), rating: ratingOf(id), favoriteCount: favoriteCountOf(id) }
    : null;
}

/** 侧边栏的标签云：返回出现次数最多的标签。 */
export function listTopTags(limit = 30): Array<{ tag: string; count: number }> {
  const db = getDb();
  const rows = db
    .prepare("SELECT tags FROM resources WHERE status = 'published' AND tags != '[]'")
    .all() as unknown as Array<{ tags: string }>;

  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const t of parseTags(row.tags)) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}

/**
 * ★ 全局删掉一个标签：把 `tag` 从**每一条资源**和**每一个待审版本**的 tags 里去掉。
 *
 * ---------------------------------------------------------------------------
 * 用户要求（原话）
 * ---------------------------------------------------------------------------
 * 「允许编辑者删除资源库标签，被删除的标签对应的资源保留，只是去掉其标签」
 * ⇒ 这个函数**一行都不删**：`resources` / `resource_revisions` 的行数在它跑完之后
 *   一个字节都不变，只有 `tags` 那一列（JSON 文本）会变。所以它返回的是
 *    "改了几行"，而不是"删了几条" —— 界面与审计要说的那句
 *    「资源本身保留」就挂在这两个数字上。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 为什么逐行读改写，而不是一条 UPDATE
 * ---------------------------------------------------------------------------
 * `tags` 是 **JSON 文本列**（见文件头的 `parseTags`）。在 SQL 侧只能做字符串替换，
 * 而替换 `"tools"` 这个子串会**连 `"tools-extra"` 一起命中** —— 一次误伤就静默改坏了
 * 别人的标签，而且拼出来的 JSON 还可能不合法。所以老实走 `parseTags`：
 * 读出来 → 过滤 → `JSON.stringify` 写回。解析失败的行会走 `parseTags` 的兜底
 * （记日志 + 当空数组），**绝不会**把那一列写成半个 JSON。
 * 代价是 N 次读 + M 次写（M = 真的有这个标签的行数）。标签删除是低频的治理动作，
 * 这个代价换的是"结构上不可能写坏 JSON"。
 *
 * ⚠️ **只写真的有这个标签的行**（过滤后长度没变就跳过）：否则每删一个标签都会把
 *    全库的 `tags` 重写一遍 —— 既没有意义，又会让返回给界面与审计的那个数字
 *    从"改了几行"变成"库里一共有几行"。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 哪一档 status 要动、哪一档**不能**动
 * ---------------------------------------------------------------------------
 *   · `resources` —— **不看 status，每一行都要清**。已上架的那些是标签云与筛选
 *     实际在用的（`listTopTags` 只数 `published`），但**未上架的草稿同样要清**：
 *     它一旦通过审核上架，那个"已经删掉的标签"就会跟着冒出来，而那时没有人
 *     还会想起这次删除。
 *   · `resource_revisions` —— **只动 `status = 'pending'`**。待审快照是"还没生效、
 *     但将来会生效"的内容，与上面的草稿同理。`approved` / `rejected` 是**历史快照**
 *     （005 迁移：这里是拍摄的那一刻的样子，之后不再变）—— 改写它们等于篡改历史，
 *     事后查"这一版当时长什么样"就再也查不到了；而它们**不会**自己冒到线上
 *     （线上那一版住在 `resources` 行上，上面已经清过了）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 为什么**不动 `updated_at`**（与那两个改 resources 的函数刻意不同）
 * ---------------------------------------------------------------------------
 * `setResourceFlags` / `setResourceVisibility` 都会顺手推 `updated_at`，这里不推：
 *   · 列表排序是 `featured DESC, updated_at DESC, id ASC` —— 推一次等于让
 *     **全库重新洗一遍版**：用户只点了一个「✕」，半个资源库却冒到了列表最前面，
 *     而且这件事在界面上看不出任何来源；
 *   · `updated_at` 在这个库里说的是"这条**内容**最后一次被改"，而一次全局的
 *     词汇表动作改的是**标签**、不是内容本身。
 * 这次动作的痕迹在**审计**里（动作名 `resource.tagDelete`）—— 那也是事后唯一
 * 需要它的地方。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 空标签**不在这里判**
 * ---------------------------------------------------------------------------
 * 判据在路由（那里要回 400，见 `routes/resources.ts`）。这里靠的是**精确相等**：
 * 空串匹配不到任何合法标签（tag schema 是 `min(1)`），所以即使有人绕过路由
 * 直接调它，也只会拿到 `{ resources: 0, revisions: 0 }`，**不会**变成一次全表清洗。
 *
 * ⚠️ 两侧都做 `trim().toLowerCase()`：写入路径（`normalizeResourceInput`）与小写化的
 *    筛选路径（`listResources` 里的 `query.tag.toLowerCase()`）都是用这条规则对齐标签的，
 *    这里跟它们一致 —— 否则 `Tools` 与 `tools` 会变成两个**只有删除才分得清**的东西。
 */
export function deleteTagEverywhere(tag: string): { resources: number; revisions: number } {
  const db: DatabaseSync = getDb();
  const target = tag.trim().toLowerCase();

  /** 这一行的 tags 去掉目标后长什么样；**没有变化时返回 null**（调用方据此跳过写入）。 */
  const stripped = (raw: string): string | null => {
    const tags = parseTags(raw);
    const kept = tags.filter((t) => t.trim().toLowerCase() !== target);
    return kept.length === tags.length ? null : JSON.stringify(kept);
  };

  let resources = 0;
  let revisions = 0;

  /*
   * 两条 UPDATE 必须在**同一个事务**里：删标签是一次动作，界面与审计都按
   * "这一次一共改了几行"报数。分成两个事务的话，中间那一刻的库里是
   * "资源已经没有这个标签、待审版本还挂着它"的状态 —— 而那时任何人拉一次
   * 审核队列都会看到那个本该已经不存在的标签。
   */
  db.exec('BEGIN');
  try {
    const resourceRows = db.prepare('SELECT id, tags FROM resources').all() as unknown as Array<{
      id: string;
      tags: string;
    }>;
    const setResourceTags = db.prepare('UPDATE resources SET tags = ? WHERE id = ?');
    for (const row of resourceRows) {
      const next = stripped(row.tags);
      if (next === null) continue;
      setResourceTags.run(next, row.id);
      resources += 1;
    }

    const revisionRows = db
      .prepare("SELECT id, tags FROM resource_revisions WHERE status = 'pending'")
      .all() as unknown as Array<{ id: string; tags: string }>;
    const setRevisionTags = db.prepare('UPDATE resource_revisions SET tags = ? WHERE id = ?');
    for (const row of revisionRows) {
      const next = stripped(row.tags);
      if (next === null) continue;
      setRevisionTags.run(next, row.id);
      revisions += 1;
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { resources, revisions };
}

// ---------------------------------------------------------------------------
// 写入（M1 只被导入脚本调用；M2 会加用户提交）
// ---------------------------------------------------------------------------

export type ResourceInput = Omit<Resource, 'createdAt' | 'updatedAt' | 'summary' | 'imageUrl'> & {
  // summary 与 imageUrl 允许缺省：导入文件里常常不写，
  // 前者从 body 推导，后者退回到 favicon。
  summary?: string | null;
  imageUrl?: string | null;
};

/**
 * 按 id 插入或更新。
 *
 * 用 UPSERT 而不是"先删后插"：后者的空档期会让并发读取看到"条目不存在"。
 * createdAt 只在首次插入时写入，之后保持不变（UPSERT 里用 CASE 判断）。
 *
 * source 标记这条记录的归属：'import' = 由 content/resources.json 管理，
 * 'user' = 用户提交（M2 起）。**导入脚本只会碰 'import' 的那些** ——
 * 否则每次部署都会把用户提交的内容删掉。
 */
export function upsertResource(
  input: ResourceInput,
  options: { source?: 'import' | 'user'; now?: number } = {},
): 'inserted' | 'updated' {
  const { source = 'import', now = Date.now() } = options;
  const db = getDb();
  const normalized = normalizeResourceInput(input);

  const existing = db.prepare('SELECT id FROM resources WHERE id = ?').get(input.id) as
    | { id: string }
    | undefined;

  db.prepare(
    `INSERT INTO resources
       (id, kind, title, title_en, url, image_url, summary, body, lang, tags,
        featured, official, status, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       kind       = excluded.kind,
       title      = excluded.title,
       title_en   = excluded.title_en,
       url        = excluded.url,
       image_url  = excluded.image_url,
       summary    = excluded.summary,
       body       = excluded.body,
       lang       = excluded.lang,
       tags       = excluded.tags,
       featured   = excluded.featured,
       official   = excluded.official,
       status     = excluded.status,
       source     = excluded.source,
       updated_at = excluded.updated_at`,
  ).run(
    input.id,
    input.kind,
    input.title,
    normalized.titleEn,
    input.url,
    normalized.imageUrl,
    normalized.summary,
    input.body,
    input.lang,
    JSON.stringify(normalized.tags),
    input.featured ? 1 : 0,
    input.official ? 1 : 0,
    input.status,
    source,
    now,
    now,
  );

  return existing ? 'updated' : 'inserted';
}

/**
 * 删除**导入来源**里不在给定 id 集合中的条目。
 *
 * ⚠️ 这里必须限定 `source = 'import'`。
 * 不加这个条件的后果：M2 上线后，用户提交的资源会在**每次部署**时被静默删掉，
 * 而部署脚本会报成功。这类"静默数据丢失"是最难发现也最不可接受的失败方式。
 */
export function deleteImportedNotIn(ids: string[]): string[] {
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM resources WHERE source = 'import'")
    .all() as unknown as Array<{ id: string }>;
  const keep = new Set(ids);
  const doomed = existing.map((r) => r.id).filter((id) => !keep.has(id));

  const stmt = db.prepare("DELETE FROM resources WHERE id = ? AND source = 'import'");
  db.exec('BEGIN');
  try {
    for (const id of doomed) {
      /*
       * ⚠️ 这也是**硬删除**，所以同样要清贡献者行 —— 理由与
       *    `deleteResourceDirect` 里那段一样（那张表没有指向内容的外键）。
       *    它比那条更阴：这里是**部署时**按 JSON 对齐删的，没有人盯着界面看，
       *    而孤儿行会随每次部署**累积**。导入的条目同样可以被加贡献者
       *    （author_id 是 NULL 不碍事：名单是按资源 id 记的）。
       */
      deleteContributors('resource', id);
      stmt.run(id);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return doomed;
}

/** 按来源统计，用来在导入脚本里给出"我在管多少条、别人有多少条"的清晰信息。 */
export function countBySource(): { import: number; user: number } {
  const db = getDb();
  const rows = db
    .prepare('SELECT source, COUNT(*) AS n FROM resources GROUP BY source')
    .all() as unknown as Array<{ source: string; n: number }>;
  const out = { import: 0, user: 0 };
  for (const row of rows) {
    if (row.source === 'user') out.user = row.n;
    else out.import = row.n;
  }
  return out;
}

export function countResources(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) AS n FROM resources').get() as { n: number } | undefined;
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// id 与查重（导入与用户提交共用）
// ---------------------------------------------------------------------------

/**
 * 从 URL 推导一个稳定的 slug 作 id。
 *
 * ⚠️ 导入脚本和用户提交**共用这一个实现**。
 *    各写一份的后果是：同一个站点由导入进去和由用户提交进来会得到两种不同的 id，
 *    而 id 是详情页 URL 的一部分 —— 那意味着同一个资源有了两个可访问的地址，
 *    分享出去的链接会指向"另一个"条目。
 *
 * 曾经这个函数住在 import.ts 里。搬过来的理由就是上面那条：
 * 只有一个实现，才谈得上"两边的 id 一致"。
 */
export function idFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`
      .replace(/^www\./, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 64);
  } catch {
    return url.replace(/[^a-z0-9]+/gi, '-').slice(0, 64);
  }
}

/**
 * 条目是否存在 —— **刻意不过滤发布状态**。
 *
 * ⚠️⚠️ 必须和 `getResource` 严格区分开，这个区别踩过一次：
 *
 *   `getResource` 是**公开读接口**用的，SQL 里带着 `status = 'published'`。
 *   而审核员批准的是一个 **pending** 条目、作者编辑的是自己的 **pending** 条目 ——
 *   这些条目在 `getResource` 眼里根本不存在。
 *
 *   拿 `getResource` 去判断"条目在不在"，表现是所有审核和编辑操作
 *   一律返回 `404 not_found`，**而错误码看起来像 id 传错了** ——
 *   排查时第一反应会去核对 URL、核对客户端拼的 id，
 *   完全不会想到问题出在"那个函数过滤了状态"。
 *
 *   所以这里单独给一个不带状态条件的存在性检查。名字起得不一样是刻意的：
 *   调用点写 `resourceExists(id)` 时，读代码的人会意识到它不是公开读。
 */
export function resourceExists(id: string): boolean {
  return getDb().prepare('SELECT 1 FROM resources WHERE id = ?').get(id) !== undefined;
}

/**
 * 条目的作者 id。
 *
 * 返回 `null` 有两种情况，而且**调用方必须把它们当成同一种拒绝**：
 *   · 条目不存在
 *   · 条目是导入的（author_id 为 NULL）
 * 导入的条目不归任何人所有，所以谁都不能编辑它 —— 这一点靠
 * "严格相等比较"来保证：`null !== user.id` 恒为真，权限自然被拒。
 * 如果这里改成返回一个空字符串之类的"哨兵值"，就会出现
 * "匿名提交者能改导入条目"这种漏洞。
 */
export function resourceOwner(id: string): string | null {
  const row = getDb().prepare('SELECT author_id FROM resources WHERE id = ?').get(id) as
    | { author_id: string | null }
    | undefined;
  return row?.author_id ?? null;
}

/**
 * 按 URL 查已有条目 —— 用户提交时用它防止同一个站点被提交两次。
 *
 * ⚠️ 它扫的是**所有状态**的行，包括被驳回、还没上架的。
 *    这是有意的：如果只管已上架的，作者被驳回之后重新提交同一个 URL
 *    就会长出第二条资源行（同一个站点两条记录，各有各的 id），
 *    而那正是查重想避免的事。
 *
 *    代价是调用方必须自己看清 `status`：**"URL 已存在"和"这个站点已经在站上"
 *    是两件不同的事**。一个被驳回的条目意味着"这个 URL 没人占着公开位置"，
 *    那时的正确动作是让作者去改那一条，而不是告诉他"已经收录过了"。
 */
export function findResourceByUrl(
  url: string,
): { id: string; title: string; status: string } | null {
  // 归一化之后比较：末尾斜杠、www 前缀、大小写都不该让"同一个站点"变成两条。
  const normalize = (value: string): string => {
    try {
      const u = new URL(value.trim());
      const path = u.pathname.replace(/\/+$/, '');
      return `${u.hostname.replace(/^www\./i, '').toLowerCase()}${path}${u.search}`;
    } catch {
      return value.trim().toLowerCase();
    }
  };

  const target = normalize(url);
  const rows = getDb()
    .prepare('SELECT id, url, title, status FROM resources')
    .all() as unknown as Array<{
    id: string;
    url: string;
    title: string;
    status: string;
  }>;
  const hit = rows.find((r) => normalize(r.url) === target);
  return hit ? { id: hit.id, title: hit.title, status: hit.status } : null;
}

/**
 * 给用户提交分配 id。
 *
 * 上面的 URL 查重已经挡掉了绝大多数撞车，这里只处理"两条**不同**URL
 * 推出了同一个 slug"的情况（例如 `example.com/a` 和 `example.com/A`）。
 * 加个数字后缀比直接失败好：那条内容本身是合法的，不该因为 id 撞了就提交不了。
 */
export function uniqueResourceId(url: string): string {
  const db = getDb();
  const base = idFromUrl(url) || 'resource';
  const taken = (id: string): boolean =>
    db.prepare('SELECT 1 FROM resources WHERE id = ?').get(id) !== undefined;

  if (!taken(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}-${String(n)}`;
    if (!taken(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * ② 硬删除：**真删那一行**（只有 owner 能调 —— 判据是 shared 的谓词 `canHardDelete`）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 这是本轮**唯一一条不可逆的动作**，代价必须写在这里
 * ---------------------------------------------------------------------------
 * `DELETE FROM resources` 会通过 `ON DELETE CASCADE` 连带删掉：
 *   · `resource_revisions` —— **这条内容的全部版本历史**；
 *   · `resource_marks` —— **所有人**（不只是作者）的收藏、私人备注、评分。
 * 私人备注是**别人写的东西**，而且没有备份。
 *
 * ⚠️⚠️ 但它**不会**连带删掉 `content_contributors` —— 那张表是按
 *    `(entity_type, entity_id)` 两段式指向内容的，**SQLite 建不了这种外键**
 *    （一张表的外键只能指向一张表）。所以这里必须**自己清**（下一句）。
 *    漏了它不会有任何报错：只是留下几行指向已删内容的贡献者行，
 *    而它们不违反任何约束、也不会出现在任何一条查询里 ——
 *    只会在"某人被列为某条已删内容的贡献者"这种地方安静地误导人。
 *    ⇒ 有一条测试钉着这件事（删掉一条有贡献者的资源之后，那几行必须为 0），
 *      而不是靠"下次记得写那行代码"。
 *    ⚠️ 清理放在 `DELETE FROM resources` **之前**：两条语句都在同一个同步调用里、
 *       没有中间态能被别人看到，但先删子行读起来就是"先清指向它的东西，再删它"。
 *
 * ⚠️ 权限**不在这里判**：判定在路由层（`routes/authoring.ts` 的 `DELETE` 处理里，
 *    owner 走 shared 的 `canHardDelete(role)` 谓词，editor/admin 走 `content.author`），
 *    数据层只回答**这一步能不能删** —— "谁能删"只有一处定义，不在这里再写一遍。
 *
 * ⚠️ `force` = **owner 的"一键"**：跳过"先下架"那一步。
 *    非 owner（editor/admin）必须为 `false` —— 他们删一条**已上架**的内容要先下架，
 *    路由层把这种情况回成 409 `invalid_state` + `reason: 'must_hide_first'`；
 *    那道缓冲保护的是"一次手滑不要把版本历史 + **别人的**收藏/备注/评分一起销毁"。
 *
 * ⚠️ 与既有取向的差异也是刻意的：之前两次设计都写着"治理者不给真删，
 *    因为删除不可撤销、还会把'它曾经存在过'一起抹掉"（`routes/videos.ts` 的文件头）。
 *    这次是**用户明确要求** owner 能一键真删，约束在于"只有 owner + 一次确认 + 审计"。
 */
export function deleteResourceDirect(
  id: string,
  options: { force: boolean },
): { ok: true } | { ok: false; reason: 'not_found' | 'must_hide_first' } {
  const row = getDb().prepare('SELECT status FROM resources WHERE id = ?').get(id) as
    | { status: string }
    | undefined;
  if (!row) return { ok: false, reason: 'not_found' };

  /*
   * ⚠️ 判据是 `published`（**不是**"有没有版本号"）：导入的条目 `current_revision`
   *    是 NULL 但它在线上 —— 用版本号判断会让它们绕过这道缓冲。
   *    这个坑在本仓的 rejectRevision 注释里写着（"判断线上有没有内容要看 status"）。
   */
  if (!options.force && row.status === 'published') {
    return { ok: false, reason: 'must_hide_first' };
  }

  // 见上面那段：这张表没有外键，不清就是孤儿行（唯一的落点就在这里）
  deleteContributors('resource', id);
  getDb().prepare('DELETE FROM resources WHERE id = ?').run(id);
  return { ok: true };
}
