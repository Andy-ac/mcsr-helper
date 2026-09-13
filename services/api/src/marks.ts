/**
 * 个人标记的读写：收藏 / 备注 / 评分。
 *
 * 三条纪律写在这里，因为它们都是"很容易写错、错了也不报错"的地方：
 *   1. **备注只进不出** —— 没有任何函数返回别人的备注；
 *   2. **没评过 ≠ 0 分** —— 聚合只看 rating IS NOT NULL 的行；
 *   3. **只改传了的字段** —— 取消收藏不该顺手清掉备注和评分。
 */
import type { MarksInput, RatingSummary, ResourceMarks } from '@mcsr/shared/resources';
import { getDb } from './db';

/** 还没有人评过分。**不是 0 分** —— 界面上要显示"暂无评分"。 */
export const EMPTY_RATING: RatingSummary = { average: null, count: 0 };

/** 空标记：从没标记过的人看到的就是这个。 */
export const EMPTY_MARKS: ResourceMarks = {
  favorite: false,
  note: null,
  rating: null,
  updatedAt: 0,
};

interface MarkRow {
  favorite: number;
  note: string | null;
  rating: number | null;
  updated_at: number;
}

function toMarks(row: MarkRow | undefined): ResourceMarks {
  if (!row) return EMPTY_MARKS;
  return {
    favorite: row.favorite === 1,
    note: row.note,
    rating: row.rating,
    updatedAt: row.updated_at,
  };
}

/** 读我对某条内容的标记。 */
export function getMarks(userId: string, resourceId: string): ResourceMarks {
  const row = getDb()
    .prepare(
      'SELECT favorite, note, rating, updated_at FROM resource_marks WHERE user_id = ? AND resource_id = ?',
    )
    .get(userId, resourceId) as MarkRow | undefined;
  return toMarks(row);
}

/**
 * 写标记（不存在就建行）。
 *
 * ⚠️ 只改**传了的**字段。用 `undefined` 表示"不动它"，
 *    而 `null` 表示"清空"（比如把评分取消）。这两种意图在界面上都存在：
 *    · 点"取消收藏" → 只传 favorite:false，备注和评分必须留着；
 *    · 点"清除评分" → 传 rating:null。
 */
export function setMarks(
  userId: string,
  resourceId: string,
  input: MarksInput,
  now: number,
): ResourceMarks {
  const db = getDb();
  const current = getMarks(userId, resourceId);

  const next = {
    favorite: input.favorite ?? current.favorite,
    note: input.note === undefined ? current.note : input.note,
    rating: input.rating === undefined ? current.rating : input.rating,
  };

  /*
   * 三项都空了就把行删掉，而不是留一行全空的。
   *
   * 为什么在意这个：收藏列表按行的存在与否来查，留一堆空行会让
   * "我收藏了 20 条"变成"我的收藏里有 20 条，其中 18 条什么都不显示"。
   */
  if (!next.favorite && next.note === null && next.rating === null) {
    db.prepare('DELETE FROM resource_marks WHERE user_id = ? AND resource_id = ?').run(
      userId,
      resourceId,
    );
    return { ...EMPTY_MARKS, updatedAt: now };
  }

  db.prepare(
    `INSERT INTO resource_marks (user_id, resource_id, favorite, note, rating, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, resource_id) DO UPDATE SET
       favorite = excluded.favorite,
       note = excluded.note,
       rating = excluded.rating,
       updated_at = excluded.updated_at`,
  ).run(
    userId,
    resourceId,
    next.favorite ? 1 : 0,
    next.note === null || next.note === '' ? null : next.note,
    next.rating,
    now,
    now,
  );

  return getMarks(userId, resourceId);
}

/** 某人收藏过的全部条目（含备注与评分），最近改动在前。 */
export function listFavorites(userId: string): Array<{
  id: string;
  kind: string;
  title: string;
  url: string;
  image_url: string | null;
  summary: string | null;
  status: string;
  favorite: number;
  note: string | null;
  rating: number | null;
  updated_at: number;
}> {
  /*
   * ⚠️ 不按 status 过滤：条目被下架/驳回之后**仍然应该留在收藏列表里**
   *    （用户收藏的是"这个东西"，不是"这条记录"）。前端据此显示成不可点。
   *    过滤掉的话，被下架的条目会从收藏里凭空消失，而用户会以为是自己删的。
   */
  return getDb()
    .prepare(
      `SELECT r.id, r.kind, r.title, r.url, r.image_url, r.summary, r.status,
              m.favorite, m.note, m.rating, m.updated_at
       FROM resource_marks m
       JOIN resources r ON r.id = m.resource_id
       WHERE m.user_id = ?
       ORDER BY m.updated_at DESC`,
    )
    .all(userId) as unknown as Array<{
    id: string;
    kind: string;
    title: string;
    url: string;
    image_url: string | null;
    summary: string | null;
    status: string;
    favorite: number;
    note: string | null;
    rating: number | null;
    updated_at: number;
  }>;
}

/** 单条内容的评分聚合。 */
export function ratingOf(resourceId: string): RatingSummary {
  const row = getDb()
    .prepare(
      `SELECT AVG(rating) AS avg, COUNT(*) AS n
       FROM resource_marks WHERE resource_id = ? AND rating IS NOT NULL`,
    )
    .get(resourceId) as { avg: number | null; n: number } | undefined;
  return summarize(row);
}

/**
 * 多条内容的评分聚合（列表页用）。
 *
 * 一次查完再在内存里拼，而不是每条内容查一次 —— 列表一页 24 条，
 * 24 次查询在 SQLite 上不至于慢，但那是"每加一条内容就多一次查询"的形状，
 * 而它本来只需要一次 GROUP BY。
 */
export function ratingsFor(resourceIds: string[]): Map<string, RatingSummary> {
  const out = new Map<string, RatingSummary>();
  if (resourceIds.length === 0) return out;

  const placeholders = resourceIds.map(() => '?').join(', ');
  const rows = getDb()
    .prepare(
      `SELECT resource_id, AVG(rating) AS avg, COUNT(*) AS n
       FROM resource_marks
       WHERE rating IS NOT NULL AND resource_id IN (${placeholders})
       GROUP BY resource_id`,
    )
    .all(...resourceIds) as unknown as Array<{
    resource_id: string;
    avg: number | null;
    n: number;
  }>;

  for (const row of rows) out.set(row.resource_id, summarize(row));
  return out;
}

/**
 * 多条内容的**收藏数**聚合（列表页用）。
 *
 * ⚠️ 与 `ratingsFor` **逐字同形**，理由也一模一样：列表一页 24 条，每条查一次
 *    就是 24 次查询，而它本来只需要一次 `GROUP BY`。这不是"顺手优化"，
 *    而是本仓对列表聚合的既有形状 —— 两处的写法必须看起来一样，
 *    否则下一个人只会照着其中一处改。
 *
 * ⚠️ **只数 `favorite = 1` 的行**。`resource_marks` 里一个人只要写过**备注或评分**
 *    就会有一行（`setMarks` 把三项合在一行里），把那种行也算进来，这个数字就变成
 *    "标记过它的人数"，而界面上写的是"收藏" —— 那是两个不同的数。
 *    （迁移 013 的 `idx_marks_favorite ... WHERE favorite = 1` 正是服务这条查询的。）
 *
 * ⚠️ 返回 **Map，查不到的 id 由调用方补 0**，而不是在这里把传入的 id 全部填满：
 *    调用方本来就要 `?? 0`；而那个 `0` 必须是**真的 0**（没有人收藏就是 0），
 *    不能变成 `undefined` —— 字段在契约里是**必填非空**的。
 */
export function favoritesFor(resourceIds: string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (resourceIds.length === 0) return out;

  const placeholders = resourceIds.map(() => '?').join(', ');
  const rows = getDb()
    .prepare(
      `SELECT resource_id, COUNT(*) AS n
       FROM resource_marks
       WHERE favorite = 1 AND resource_id IN (${placeholders})
       GROUP BY resource_id`,
    )
    .all(...resourceIds) as unknown as Array<{ resource_id: string; n: number }>;

  for (const row of rows) out.set(row.resource_id, Number(row.n));
  return out;
}

/**
 * 单条内容的收藏数（详情页用，与 `ratingOf` 对应）。
 *
 * ⚠️ **没有人收藏时必须回 0，不是 null**：契约里 `favoriteCount` 是必填的
 *    `number`（见 shared/resources.ts 的 `FavoriteCountSchema`）。收藏数没有
 *    "还没有这个数据"这种状态 —— `0` 就是 0，这与 `rating.average` 为 null
 *    表示"还没有人评过分"是两种情况，不能互相套用。
 */
export function favoriteCountOf(resourceId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM resource_marks WHERE favorite = 1 AND resource_id = ?')
    .get(resourceId) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

/** 把 SQL 的 AVG/COUNT 结果整成对外的形状：没评过分时 average 是 null，不是 0。 */
function summarize(row: { avg: number | null; n: number } | undefined): RatingSummary {
  const count = Number(row?.n ?? 0);
  if (count === 0 || row?.avg === null || row?.avg === undefined) {
    return { average: null, count: 0 };
  }
  // 保留一位小数：4.66666 显示成 4.7，而不是让界面上出现一串小数
  return { average: Math.round(Number(row.avg) * 10) / 10, count };
}
