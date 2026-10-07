/**
 * ★ B1：人工标签层的**数据层**（那两张表）。
 *
 * 边界：这里只做"库 ↔ `ModTagLayer`"的翻译 —— **不碰 HTTP、不写审计、不判权限**
 * （那些在 `routes/modTags.ts` 里）。
 * ⚠️ 读那一侧**永远不抛**：一个坏掉的 JSON 格子不该让整条 `/api/mod-catalog` 500
 *    （目录是所有人下载时要用的东西，而标签是锦上添花）。
 */
import type { ModTagLabel, ModTagLayer } from '@mcsr/shared/modCatalog';
import { getDb } from './db';

interface AssignmentRow {
  modid: string;
  tags: string;
}
interface LabelRow {
  tag: string;
  zh: string;
  en: string;
}

/**
 * 一个格子坏掉时的读数（`console.warn` 之后当作**没有这一行**）。
 *
 * ⚠️ 解析不了时返回 `null`，**不是** `[]`：`[]` 在这张表里**已经有了一个意思** ——
 *    "管理员把它清空了"（见 `024_mod_tags.ts` 文件头：**空数组也会留下那一行**）。
 *    把坏 JSON 读成 `[]` 会让"这一格坏了"和"管理员清空了它"长得一模一样，
 *    而两者该做的事**相反**：前者要回落到目录里的出厂值，后者要盖住出厂值。
 */
function parseTags(raw: string, modid: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('不是一个数组');
    return parsed.filter((tag): tag is string => typeof tag === 'string' && tag !== '');
  } catch (error) {
    console.warn('[mod-tags] 人工标签那一格读不出来，当作没有：', modid, error);
    return null;
  }
}

/** 读整层（一次两条 SELECT）。⚠️ 只返回 **DB 里真有行**的 modid（"出厂值"不在这一层）。 */
export function readTagLayer(): ModTagLayer {
  const db = getDb();
  const assignmentRows = db
    .prepare('SELECT modid, tags FROM mod_tag_assignments')
    .all() as unknown as AssignmentRow[];
  const labelRows = db
    .prepare('SELECT tag, zh, en FROM mod_tag_labels')
    .all() as unknown as LabelRow[];

  /*
   * ⚠️ 坏掉的格子**整行丢掉**（不是塞一个空数组进去）：这样"这一格坏了"在
   *    上层看起来与"DB 里根本没有这一行"完全一样，也就是**回落到出厂值** ——
   *    这正是"当作没有"这四个字的意思。
   */
  const assignments = new Map<string, readonly string[]>();
  for (const row of assignmentRows) {
    const tags = parseTags(row.tags, row.modid);
    if (tags !== null) assignments.set(row.modid, tags);
  }

  const labels = new Map<string, ModTagLabel>();
  for (const row of labelRows) labels.set(row.tag, { zh: row.zh, en: row.en });

  return { assignments, labels };
}

/** 整行替换某个 mod 的人工标签（**空数组也会留下一行**：见迁移文件头）。 */
export function setModTags(input: {
  modid: string;
  tags: readonly string[];
  actorId: string | null;
  now: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO mod_tag_assignments (modid, tags, updated_by, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (modid) DO UPDATE SET tags = excluded.tags,
                                         updated_by = excluded.updated_by,
                                         updated_at = excluded.updated_at`,
    )
    .run(input.modid, JSON.stringify(input.tags), input.actorId, input.now);
}

/** 新建 / 改名一个标签的显示名（同一行 upsert）。 */
export function setTagLabel(input: {
  tag: string;
  zh: string;
  en: string;
  actorId: string | null;
  now: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO mod_tag_labels (tag, zh, en, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (tag) DO UPDATE SET zh = excluded.zh,
                                       en = excluded.en,
                                       updated_by = excluded.updated_by,
                                       updated_at = excluded.updated_at`,
    )
    .run(input.tag, input.zh, input.en, input.actorId, input.now);
}

/** 删掉一个显示名。返回"本来有没有那一行"（`false` 不是错误）。 */
export function deleteTagLabel(input: { tag: string }): boolean {
  const result = getDb().prepare('DELETE FROM mod_tag_labels WHERE tag = ?').run(input.tag);
  return Number(result.changes) > 0;
}
