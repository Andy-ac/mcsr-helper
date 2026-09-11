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

/** 数据库里的一行（snake_case，tags 是 JSON 文本，featured 是 0/1）。 */
interface ResourceRow {
  id: string;
  kind: string;
  title: string;
  title_en: string | null;
  url: string;
  summary: string | null;
  body: string;
  lang: string;
  tags: string;
  featured: number;
  status: string;
  created_at: number;
  updated_at: number;
}

const SELECT_COLUMNS = `
  id, kind, title, title_en, url, summary, body, lang, tags,
  featured, status, created_at, updated_at
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
    summary: row.summary,
    body: row.body,
    lang: row.lang as Resource['lang'],
    tags: parseTags(row.tags),
    featured: row.featured === 1,
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

export type ResourceInput = Omit<Resource, 'createdAt' | 'updatedAt' | 'summary'> & {
  summary?: string | null;
};

/**
 * 按 id 插入或更新。
 *
 * 用 UPSERT 而不是"先删后插"：后者的空档期会让并发读取看到"条目不存在"。
 * createdAt 只在首次插入时写入，之后保持不变（UPSERT 里用 CASE 判断）。
 */
export function upsertResource(input: ResourceInput, now = Date.now()): 'inserted' | 'updated' {
  const db = getDb();
  const normalized = normalizeResourceInput(input);

  const existing = db.prepare('SELECT id FROM resources WHERE id = ?').get(input.id) as
    | { id: string }
    | undefined;

  db.prepare(
    `INSERT INTO resources
       (id, kind, title, title_en, url, summary, body, lang, tags, featured, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       kind       = excluded.kind,
       title      = excluded.title,
       title_en   = excluded.title_en,
       url        = excluded.url,
       summary    = excluded.summary,
       body       = excluded.body,
       lang       = excluded.lang,
       tags       = excluded.tags,
       featured   = excluded.featured,
       status     = excluded.status,
       updated_at = excluded.updated_at`,
  ).run(
    input.id,
    input.kind,
    input.title,
    normalized.titleEn,
    input.url,
    normalized.summary,
    input.body,
    input.lang,
    JSON.stringify(normalized.tags),
    input.featured ? 1 : 0,
    input.status,
    now,
    now,
  );

  return existing ? 'updated' : 'inserted';
}

/**
 * 删除不在给定 id 集合里的条目 —— 让导入文件成为**唯一真相**。
 *
 * 这是刻意的：如果只 upsert 不删除，你在 JSON 里删掉一条，线上却还在，
 * 久而久之内容和文件对不上，谁也说不清哪边是对的。
 * 导入脚本会先用 dry-run 打印将要删除的条目再执行。
 */
export function deleteResourcesNotIn(ids: string[]): string[] {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM resources').all() as Array<{ id: string }>;
  const keep = new Set(ids);
  const doomed = existing.map((r) => r.id).filter((id) => !keep.has(id));

  const stmt = db.prepare('DELETE FROM resources WHERE id = ?');
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

export function countResources(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) AS n FROM resources').get() as { n: number } | undefined;
  return row?.n ?? 0;
}
