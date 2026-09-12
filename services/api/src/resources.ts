/**
 * 资源库的数据访问层。
 *
 * 这是**唯一**直接写 SQL 的文件（除了 db/ 目录）。把 SQL 收在一处的好处：
 *   1. 将来换数据库驱动只改这里
 *   2. 所有查询的索引使用情况可以集中审查
 *   3. 路由层只处理 HTTP，不掺 SQL
 */
import type { DatabaseSync } from 'node:sqlite';
import {
  normalizeResourceInput,
  type Resource,
  type ResourceDetail,
  type ResourceListItem,
  type ResourceListResponse,
  type ResourceQuery,
} from '@mcsr/shared/resources';

import { getDb } from './db';

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

/** 列表项去掉 body —— 列表接口不下发正文，省带宽也省序列化时间。 */
function toListItem(resource: Resource): ResourceListItem {
  const { body: _body, ...rest } = resource;
  return rest;
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

export function listResources(query: ResourceQuery): ResourceListResponse {
  const db: DatabaseSync = getDb();

  // M1 阶段对外只暴露已发布内容。status 现在写死，
  // M2 加审核流时这里会根据"是不是审核员"分叉。
  const where: string[] = ["status = 'published'"];
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

  return {
    items: rows.map((row) => toListItem(toResource(row))),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export function getResource(id: string): ResourceDetail | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM resources WHERE id = ? AND status = 'published'`)
    .get(id) as unknown as ResourceRow | undefined;
  return row ? toResource(row) : null;
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
    for (const id of doomed) stmt.run(id);
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

/** 按 URL 查已有条目 —— 用户提交时用它防止同一个站点被提交两次。 */ export function findResourceByUrl(
  url: string,
): { id: string; title: string } | null {
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
  const rows = getDb().prepare('SELECT id, url, title FROM resources').all() as unknown as Array<{
    id: string;
    url: string;
    title: string;
  }>;
  const hit = rows.find((r) => normalize(r.url) === target);
  return hit ? { id: hit.id, title: hit.title } : null;
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
