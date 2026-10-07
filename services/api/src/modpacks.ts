/**
 * ★ B2：整合包的**数据层**。
 *
 * 边界（与 `mod-tags.ts` 逐字同一条）：只做"库 ↔ `ModPack`"的翻译 ——
 * **不碰 HTTP、不写审计、不判权限**。
 * ⚠️ 读那一侧对坏数据**不抛**：`modids` 解析不了 ⇒ 那条**当作不存在**
 *    （塞一个空数组会让"这个包坏了"与"这个包是空的"长得一样，而两者该做的事相反）。
 */
import { randomUUID } from 'node:crypto';
import { getDb } from './db';

export type ModPack = {
  id: string;
  title: string;
  description: string;
  gameVersion: string;
  modids: string[];
  hot: boolean;
  createdAt: number;
  updatedAt: number;
};

interface Row {
  id: string;
  title: string;
  description: string;
  game_version: string;
  modids: string;
  hot: number;
  created_at: number;
  updated_at: number;
}

const COLUMNS = 'id, title, description, game_version, modids, hot, created_at, updated_at';

/** 坏掉的一格 ⇒ `null`（**不是** `[]`，见文件头）。 */
function parseModids(raw: string, id: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('不是一个数组');
    const list = parsed.filter((x): x is string => typeof x === 'string' && x !== '');
    return list;
  } catch (error) {
    console.warn('[modpacks] 这个包的 modids 读不出来，当作没有这个包：', id, error);
    return null;
  }
}

function toPack(row: Row): ModPack | null {
  const modids = parseModids(row.modids, row.id);
  if (modids === null) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    gameVersion: row.game_version,
    modids,
    hot: row.hot === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listModPacks(input: { gameVersion?: string }): ModPack[] {
  const db = getDb();
  const rows =
    input.gameVersion === undefined
      ? (db
          .prepare(`SELECT ${COLUMNS} FROM modpacks ORDER BY created_at, rowid`)
          .all() as unknown as Row[])
      : (db
          .prepare(
            `SELECT ${COLUMNS} FROM modpacks WHERE game_version = ? ORDER BY created_at, rowid`,
          )
          .all(input.gameVersion) as unknown as Row[]);
  /* ⚠️ `ORDER BY created_at, rowid`：同一毫秒建的包顺序不该未定义（B1 的审计那条踩过） */
  return rows.map(toPack).filter((p): p is ModPack => p !== null);
}

export function readModPack(id: string): ModPack | null {
  const row = getDb().prepare(`SELECT ${COLUMNS} FROM modpacks WHERE id = ?`).get(id) as unknown as
    | Row
    | undefined;
  return row === undefined ? null : toPack(row);
}

export function createModPack(input: {
  title: string;
  description: string;
  gameVersion: string;
  modids: string[];
  actorId: string | null;
  now: number;
}): ModPack {
  const id = randomUUID();
  getDb()
    .prepare(
      'INSERT INTO modpacks (id, title, description, game_version, modids, hot, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)',
    )
    .run(
      id,
      input.title,
      input.description,
      input.gameVersion,
      JSON.stringify(input.modids),
      input.actorId,
      input.now,
      input.now,
    );
  const created = readModPack(id);
  if (created === null) throw new Error('刚写进去的包读不回来（这是数据层的 bug）');
  return created;
}

export function updateModPack(input: {
  id: string;
  title: string;
  description: string;
  gameVersion: string;
  modids: string[];
  now: number;
}): ModPack | null {
  const result = getDb()
    .prepare(
      'UPDATE modpacks SET title = ?, description = ?, game_version = ?, modids = ?, updated_at = ? WHERE id = ?',
    )
    .run(
      input.title,
      input.description,
      input.gameVersion,
      JSON.stringify(input.modids),
      input.now,
      input.id,
    );
  /* ⚠️ `node:sqlite` 的 `run().changes` 是 number（B1 实测过）⇒ 用它判"这条在不在" */
  if (result.changes === 0) return null;
  return readModPack(input.id);
}

export function deleteModPack(id: string): boolean {
  return getDb().prepare('DELETE FROM modpacks WHERE id = ?').run(id).changes > 0;
}

export function setModPackHot(input: { id: string; hot: boolean; now: number }): ModPack | null {
  const result = getDb()
    .prepare('UPDATE modpacks SET hot = ?, updated_at = ? WHERE id = ?')
    .run(input.hot ? 1 : 0, input.now, input.id);
  if (result.changes === 0) return null;
  return readModPack(input.id);
}
