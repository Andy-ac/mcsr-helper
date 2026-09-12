/**
 * 日历事件的数据层。
 *
 * ---------------------------------------------------------------------------
 * 与资源库共享同一套审核语义，但**不共享同一张版本表**
 * ---------------------------------------------------------------------------
 * 设计约束 2：改已发布内容 = 拍一张新版本快照并回到 pending，**线上仍展示旧版**。
 *
 * 资源库那张 `resource_revisions` 的列是资源库专用的（kind / url / summary / tags），
 * 日历一条都用不上，所以走迁移 010 里那张**按类型多态**的 `content_revisions`
 * （内容以 JSON 存放）。
 *
 * ⚠️ 和 `revisions.ts` 一样，`reviseEvent` **只做三件事**，而且一件都不涉及
 * `calendar_events` 行的内容字段。线上内容因此完全没有被触碰 ——
 * 这不是靠"如果已发布则跳过更新"这种容易被后人改坏的判断，
 * 而是因为**修改线上内容的语句根本不在这里**。
 */
import type { CalendarEvent, CalendarEventInput } from '@mcsr/shared/calendar';
import { wallClockToUtc } from '@mcsr/shared/calendar-time';
import { newId } from '../auth/tokens';
import { getDb } from '../db';
import { findUserById } from '../users';

export const CALENDAR_TYPE = 'calendar';

interface EventRow {
  id: string;
  title: string;
  title_en: string | null;
  description_md: string;
  starts_at_local: string;
  starts_at_tz: string;
  starts_at_utc: number;
  ends_at_local: string | null;
  ends_at_tz: string | null;
  ends_at_utc: number | null;
  all_day: number;
  url: string | null;
  location: string | null;
  tags: string;
  stage: string | null;
  lang: string;
  author_id: string | null;
  current_revision: number | null;
  pending_revision: number | null;
  status: string;
  created_at: number;
  updated_at: number;
}

/**
 * 入参 → 数据库列。
 *
 * 派生 UTC 这件事**只在这里做一次**（见迁移 010 的说明：必须在写入时算，
 * 否则时区库一更新历史数据就跟着变形）。
 */
function toColumns(
  input: CalendarEventInput,
): Omit<
  EventRow,
  | 'id'
  | 'author_id'
  | 'current_revision'
  | 'pending_revision'
  | 'status'
  | 'created_at'
  | 'updated_at'
> {
  const startsAtUtc = wallClockToUtc(input.startsAtLocal, input.startsAtTz);
  const endsAtUtc =
    input.endsAtLocal && input.endsAtTz ? wallClockToUtc(input.endsAtLocal, input.endsAtTz) : null;

  /*
   * 理论上为 null 是不可能的：Zod 层已经保证格式合法、时区存在，
   * 而且校验过"结束晚于开始"。但类型上必须处理，所以**抛**而不是兜底 ——
   * 兜底（比如退化成 0）会让这条不该发生的路径变成一个静默的错误时间。
   */
  if (startsAtUtc === null) {
    throw new Error(
      `日历事件的开始时间无法换算成 UTC：${input.startsAtLocal} @ ${input.startsAtTz}`,
    );
  }

  return {
    title: input.title,
    title_en: input.titleEn ?? null,
    description_md: input.descriptionMd,
    starts_at_local: input.startsAtLocal,
    starts_at_tz: input.startsAtTz,
    starts_at_utc: startsAtUtc,
    ends_at_local: input.endsAtLocal ?? null,
    ends_at_tz: input.endsAtTz ?? null,
    ends_at_utc: endsAtUtc,
    all_day: input.allDay ? 1 : 0,
    url: input.url ?? null,
    location: input.location ?? null,
    tags: JSON.stringify(input.tags),
    stage: input.stage ?? null,
    lang: input.lang,
  };
}

/**
 * 快照的 payload 形状（存进 `content_revisions.payload` 的 JSON）。
 * 用**驼峰**而不是数据库列名：这份快照的主要读者是审核界面（前端），
 * 让前端去认识 `starts_at_local` 这种下划线命名是把存储细节漏出去。
 */
export interface EventPayload {
  title: string;
  titleEn: string | null;
  descriptionMd: string;
  startsAtLocal: string;
  startsAtTz: string;
  endsAtLocal: string | null;
  endsAtTz: string | null;
  allDay: boolean;
  url: string | null;
  location: string | null;
  tags: string[];
  stage: string | null;
  lang: string;
}

function toPayload(input: CalendarEventInput): EventPayload {
  return {
    title: input.title,
    titleEn: input.titleEn ?? null,
    descriptionMd: input.descriptionMd,
    startsAtLocal: input.startsAtLocal,
    startsAtTz: input.startsAtTz,
    endsAtLocal: input.endsAtLocal ?? null,
    endsAtTz: input.endsAtTz ?? null,
    allDay: input.allDay,
    url: input.url ?? null,
    location: input.location ?? null,
    tags: input.tags,
    stage: input.stage ?? null,
    lang: input.lang,
  };
}

/** payload → 数据库列（审核通过时把快照写回线上行用的路径）。 */
function payloadToColumns(p: EventPayload) {
  const startsAtUtc = wallClockToUtc(p.startsAtLocal, p.startsAtTz);
  const endsAtUtc = p.endsAtLocal && p.endsAtTz ? wallClockToUtc(p.endsAtLocal, p.endsAtTz) : null;
  if (startsAtUtc === null) {
    throw new Error(`待审快照里的开始时间无法换算：${p.startsAtLocal} @ ${p.startsAtTz}`);
  }
  return {
    title: p.title,
    title_en: p.titleEn,
    description_md: p.descriptionMd,
    starts_at_local: p.startsAtLocal,
    starts_at_tz: p.startsAtTz,
    starts_at_utc: startsAtUtc,
    ends_at_local: p.endsAtLocal,
    ends_at_tz: p.endsAtTz,
    ends_at_utc: endsAtUtc,
    all_day: p.allDay ? 1 : 0,
    url: p.url,
    location: p.location,
    tags: JSON.stringify(p.tags),
    stage: p.stage,
    lang: p.lang,
  };
}

/** 行 → 对外的 CalendarEvent。 */
export function toCalendarEvent(row: EventRow): CalendarEvent {
  const author = row.author_id ? findUserById(row.author_id) : null;
  return {
    id: row.id,
    title: row.title,
    titleEn: row.title_en,
    descriptionMd: row.description_md,
    startsAtLocal: row.starts_at_local,
    startsAtTz: row.starts_at_tz,
    startsAtUtc: Number(row.starts_at_utc),
    endsAtLocal: row.ends_at_local,
    endsAtTz: row.ends_at_tz,
    endsAtUtc: row.ends_at_utc === null ? null : Number(row.ends_at_utc),
    allDay: row.all_day === 1,
    url: row.url,
    location: row.location,
    // ⚠️ 展开成普通数组 —— node:sqlite 的行对象原型不是 Object.prototype，
    //    而 deepStrictEqual 会比较原型，测试里两边打印出来一模一样却判不相等
    tags: JSON.parse(row.tags) as string[],
    stage: row.stage,
    lang: row.lang,
    authorId: row.author_id,
    authorName: author?.display_name ?? null,
    status: row.status,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function getEventRow(id: string): EventRow | null {
  const row = getDb().prepare('SELECT * FROM calendar_events WHERE id = ?').get(id) as
    | EventRow
    | undefined;
  return row ?? null;
}

/**
 * 新建事件：**同时**建行和第一版快照，两者都是 pending。
 *
 * 为什么要建行而不是只建快照：审核通过后需要有地方放"线上那一版"，
 * 而行的内容字段就是那个地方。这也让 `pending_revision = 1` 从一开始就成立，
 * 审核界面不必区分"从没有过"和"有第 1 版"。
 */
export function submitEvent(input: {
  id: string;
  payload: CalendarEventInput;
  authorId: string;
  now: number;
}): { id: string; revision: number } {
  const db = getDb();
  const cols = toColumns(input.payload);

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO calendar_events
         (id, title, title_en, description_md, starts_at_local, starts_at_tz, starts_at_utc,
          ends_at_local, ends_at_tz, ends_at_utc, all_day, url, location, tags, stage, lang,
          author_id, current_revision, pending_revision, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, 'pending', ?, ?)`,
    ).run(
      input.id,
      cols.title,
      cols.title_en,
      cols.description_md,
      cols.starts_at_local,
      cols.starts_at_tz,
      cols.starts_at_utc,
      cols.ends_at_local,
      cols.ends_at_tz,
      cols.ends_at_utc,
      cols.all_day,
      cols.url,
      cols.location,
      cols.tags,
      cols.stage,
      cols.lang,
      input.authorId,
      input.now,
      input.now,
    );

    insertRevision({
      type: CALENDAR_TYPE,
      entityId: input.id,
      revision: 1,
      payload: toPayload(input.payload),
      editorId: input.authorId,
      note: input.payload.noteToReviewer ?? null,
      now: input.now,
    });

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { id: input.id, revision: 1 };
}

function insertRevision(input: {
  type: string;
  entityId: string;
  revision: number;
  payload: EventPayload;
  editorId: string;
  note: string | null;
  now: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO content_revisions
         (id, type, entity_id, revision, payload, status, editor_id, note_to_reviewer, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .run(
      newId(),
      input.type,
      input.entityId,
      input.revision,
      JSON.stringify(input.payload),
      input.editorId,
      input.note,
      input.now,
    );
}

/**
 * 修改已有事件 —— **整套设计的关键就是这个函数**。
 *
 * 它只做三件事，一件都不涉及 `calendar_events` 的内容字段：
 *   1. 拍一张新的快照（pending）
 *   2. 把 `pending_revision` 指过去
 *   3. 更新 `updated_at`
 *
 * 线上内容因此完全没有被触碰。这就是"改已发布内容不影响线上"的实现方式。
 */
export function reviseEvent(input: {
  id: string;
  payload: CalendarEventInput;
  editorId: string;
  now: number;
}): { revision: number } | { error: 'not_found' | 'already_pending' } {
  const db = getDb();
  const row = getEventRow(input.id);
  if (!row) return { error: 'not_found' };

  // 一条内容同时只允许一份待审修改 —— 先到先得，不做合并。
  // 理由见 docs 里对资源库同一条规则的说明：两份对同一段正文的改动没有安全的
  // 自动合并方式，硬合出来的中间状态会直接进入审核队列。
  const pending = db
    .prepare(
      `SELECT revision FROM content_revisions
       WHERE type = ? AND entity_id = ? AND status = 'pending'`,
    )
    .get(CALENDAR_TYPE, input.id) as { revision: number } | undefined;
  if (pending) return { error: 'already_pending' };

  /*
   * ⚠️ 版本号取 `MAX(revision)`，**不能**从 current/pending 指针推。
   *
   * 这是被测试抓出来的一个真实 bug：原来写的是
   * `Math.max(current_revision, pending_revision) + 1`，
   * 而一次修改**被驳回**之后 `pending_revision` 会被清成 NULL，
   * 于是一个已发布（current=1）、修改被驳回的事件再改一次会算出 2 ——
   * 而 2 号版本已经被那次驳回的修改占着了，直接撞上
   * `UNIQUE(type, entity_id, revision)`。
   *
   * 后果不是报错那么简单：**这个事件从此再也改不动了**，而且用户看到的是
   * 一句服务器错误，不会有任何人把它和"上次那次驳回"联系起来。
   *
   * 版本号必须是**单调递增且永不复用**的，所以真正的来源只能是历史最大值。
   */
  const maxRow = db
    .prepare(
      'SELECT COALESCE(MAX(revision), 0) AS n FROM content_revisions WHERE type = ? AND entity_id = ?',
    )
    .get(CALENDAR_TYPE, input.id) as { n: number } | undefined;
  const nextRevision = Number(maxRow?.n ?? 0) + 1;

  db.exec('BEGIN IMMEDIATE');
  try {
    insertRevision({
      type: CALENDAR_TYPE,
      entityId: input.id,
      revision: nextRevision,
      payload: toPayload(input.payload),
      editorId: input.editorId,
      note: input.payload.noteToReviewer ?? null,
      now: input.now,
    });
    db.prepare('UPDATE calendar_events SET pending_revision = ?, updated_at = ? WHERE id = ?').run(
      nextRevision,
      input.now,
      input.id,
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { revision: nextRevision };
}

export interface PendingRevision {
  revision: number;
  payload: EventPayload;
  editorId: string | null;
  noteToReviewer: string | null;
  createdAt: number;
}

export function getPendingRevision(id: string): PendingRevision | null {
  const row = getDb()
    .prepare(
      `SELECT revision, payload, editor_id, note_to_reviewer, created_at
       FROM content_revisions
       WHERE type = ? AND entity_id = ? AND status = 'pending'
       ORDER BY revision DESC LIMIT 1`,
    )
    .get(CALENDAR_TYPE, id) as
    | {
        revision: number;
        payload: string;
        editor_id: string | null;
        note_to_reviewer: string | null;
        created_at: number;
      }
    | undefined;
  if (!row) return null;
  return {
    revision: Number(row.revision),
    payload: JSON.parse(row.payload) as EventPayload,
    editorId: row.editor_id,
    noteToReviewer: row.note_to_reviewer,
    createdAt: Number(row.created_at),
  };
}

/**
 * 待审的一条日历事件 —— 审核队列与详情页要用的最小信息集。
 *
 * 时间字段直接来自**快照**（而不是 `calendar_events` 行）：审核员要看的是
 * "待审的那一版把时间改成了什么时候"，而行里放着的是**线上那一版**的时间。
 * 两者在一次修改里通常不同，拿错了会让审核员对着一份自己没在审的时间做判断。
 */
export interface PendingEventItem {
  id: string;
  revision: number;
  /** 待审版本的标题（不是线上那一版的） */
  title: string;
  startsAtLocal: string;
  startsAtTz: string;
  endsAtLocal: string | null;
  endsAtTz: string | null;
  allDay: boolean;
  editorId: string | null;
  createdAt: number;
  /** 这个事件是否**已经有线上版本**（true = 这是一次修改，线上仍是旧版） */
  isEdit: boolean;
}

/**
 * 待审列表。
 *
 * ⚠️ JOIN 条件里带 `e.pending_revision = r.revision`，而不是只按
 *    `type` + `entity_id` 找。少了这一条会把**历史上所有被驳回的版本**
 *    也当成待审的列出来 —— 因为 `content_revisions` 里同一个事件的每一版都在，
 *    只有 `calendar_events.pending_revision` 才指出"现在审的是哪一版"。
 */
export function listPendingEvents(
  limit: number,
  offset: number,
): {
  items: PendingEventItem[];
  total: number;
} {
  const db = getDb();

  const total = Number(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS n
           FROM content_revisions r
           JOIN calendar_events e ON e.id = r.entity_id AND e.pending_revision = r.revision
           WHERE r.type = ? AND r.status = 'pending'`,
        )
        .get(CALENDAR_TYPE) as { n: number }
    ).n,
  );

  const rows = db
    .prepare(
      `SELECT r.entity_id AS id, r.revision, r.payload, r.editor_id, r.created_at,
              e.current_revision
       FROM content_revisions r
       JOIN calendar_events e ON e.id = r.entity_id AND e.pending_revision = r.revision
       WHERE r.type = ? AND r.status = 'pending'
       ORDER BY r.created_at ASC
       LIMIT ? OFFSET ?`,
    )
    .all(CALENDAR_TYPE, limit, offset) as unknown as Array<{
    id: string;
    revision: number;
    payload: string;
    editor_id: string | null;
    created_at: number;
    current_revision: number | null;
  }>;

  return {
    total,
    items: rows.map((r) => {
      const p = JSON.parse(r.payload) as EventPayload;
      return {
        id: r.id,
        revision: Number(r.revision),
        title: p.title,
        startsAtLocal: p.startsAtLocal,
        startsAtTz: p.startsAtTz,
        endsAtLocal: p.endsAtLocal,
        endsAtTz: p.endsAtTz,
        allDay: p.allDay,
        editorId: r.editor_id,
        createdAt: Number(r.created_at),
        isEdit: r.current_revision !== null,
      };
    }),
  };
}

/** 待审数量（队列页的分类型标签用）。口径必须和 listPendingEvents 完全一致。 */
export function countPendingEvents(): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n
       FROM content_revisions r
       JOIN calendar_events e ON e.id = r.entity_id AND e.pending_revision = r.revision
       WHERE r.type = ? AND r.status = 'pending'`,
    )
    .get(CALENDAR_TYPE) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

/**
 * 该作者在**日历这一类**下被驳回过几次。
 *
 * ⚠️ 必须带上 `type = 'calendar'`。资源库那份统计查的是另一张表
 *    （`resource_revisions`），而这里查的是多态表 —— 不加类型条件的话，
 *    同一个人改资源库被驳回的记录也会算到他的日历提交头上，
 *    审核员看到的"被驳回过 5 次"里有一半来自另一个版块。
 */
export function rejectionCountForEditor(editorId: string | null): number {
  if (!editorId) return 0;
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM content_revisions
       WHERE type = ? AND editor_id = ? AND status = 'rejected'`,
    )
    .get(CALENDAR_TYPE, editorId) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

/**
 * 批准：把快照写回线上行，状态置为 published。
 *
 * ⚠️ 这是**唯一**一处会改 `calendar_events` 内容字段的地方，
 *    而且它只在审核通过时被调用 —— 这样"线上内容被动过"这件事
 *    只可能发生在一个有审计记录的路径上。
 */
export function approveEvent(input: {
  id: string;
  revision: number;
  reviewerId: string;
  now: number;
}): { revision: number } | null {
  const db = getDb();
  const row = getEventRow(input.id);
  if (!row) return null;

  const rev = db
    .prepare(
      `SELECT payload FROM content_revisions
       WHERE type = ? AND entity_id = ? AND revision = ? AND status = 'pending'`,
    )
    .get(CALENDAR_TYPE, input.id, input.revision) as { payload: string } | undefined;
  if (!rev) return null;

  const cols = payloadToColumns(JSON.parse(rev.payload) as EventPayload);

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `UPDATE calendar_events SET
         title = ?, title_en = ?, description_md = ?,
         starts_at_local = ?, starts_at_tz = ?, starts_at_utc = ?,
         ends_at_local = ?, ends_at_tz = ?, ends_at_utc = ?,
         all_day = ?, url = ?, location = ?, tags = ?, stage = ?, lang = ?,
         status = 'published', current_revision = ?, pending_revision = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(
      cols.title,
      cols.title_en,
      cols.description_md,
      cols.starts_at_local,
      cols.starts_at_tz,
      cols.starts_at_utc,
      cols.ends_at_local,
      cols.ends_at_tz,
      cols.ends_at_utc,
      cols.all_day,
      cols.url,
      cols.location,
      cols.tags,
      cols.stage,
      cols.lang,
      input.revision,
      input.now,
      input.id,
    );

    db.prepare(
      `UPDATE content_revisions SET status = 'approved', reviewed_by = ?, reviewed_at = ?
       WHERE type = ? AND entity_id = ? AND revision = ?`,
    ).run(input.reviewerId, input.now, CALENDAR_TYPE, input.id, input.revision);

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { revision: input.revision };
}

/**
 * 驳回。
 *
 * ⚠️ 分两种情形，而且界面上必须区分（审核员批完才知道是哪一种就晚了）：
 *   · 驳回的是一个**从未发布过**的事件 → 它的状态变成 rejected，
 *     公开接口再也看不到它（它本来也不该被看到）
 *   · 驳回的是**已发布事件的修改** → 线上那一版**必须留在原地**，
 *     状态保持 published。否则一次被驳回的修改会让线上内容凭空消失。
 */
export function rejectEvent(input: {
  id: string;
  revision: number;
  reason: string;
  reviewerId: string;
  now: number;
}): { revision: number; eventRejected: boolean; status: string } | null {
  const db = getDb();
  const row = getEventRow(input.id);
  if (!row) return null;

  const rev = db
    .prepare(
      `SELECT revision FROM content_revisions
       WHERE type = ? AND entity_id = ? AND revision = ? AND status = 'pending'`,
    )
    .get(CALENDAR_TYPE, input.id, input.revision) as { revision: number } | undefined;
  if (!rev) return null;

  const wasPublished = row.current_revision !== null;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `UPDATE content_revisions
       SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, review_reason = ?
       WHERE type = ? AND entity_id = ? AND revision = ?`,
    ).run(input.reviewerId, input.now, input.reason, CALENDAR_TYPE, input.id, input.revision);

    if (wasPublished) {
      db.prepare(
        'UPDATE calendar_events SET pending_revision = NULL, updated_at = ? WHERE id = ?',
      ).run(input.now, input.id);
    } else {
      db.prepare(
        `UPDATE calendar_events SET status = 'rejected', pending_revision = NULL, updated_at = ?
         WHERE id = ?`,
      ).run(input.now, input.id);
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const after = getEventRow(input.id);
  return {
    revision: input.revision,
    eventRejected: !wasPublished,
    status: after?.status ?? 'rejected',
  };
}

export interface ListEventsOptions {
  /** 只返回这个时刻之后（含）的事件。传 null 表示不过滤。 */
  fromUtc?: number | null;
  toUtc?: number | null;
  /** 标签筛选：命中任意一个即可（Q1 的多选语义）。 */
  tags?: string[];
  status?: string;
  limit?: number;
  offset?: number;
}

/**
 * 列表。
 *
 * ⚠️ 标签筛选用 `json_each` 在 SQL 里做，而不是取出来在内存里过滤 ——
 *    Node 的 `node:sqlite` 自带 JSON1 扩展，而这个表以后会有很多行，
 *    在内存里过滤意味着分页会算错（先 LIMIT 再过滤，页大小就不是页大小了）。
 */
export function listEvents(opts: ListEventsOptions = {}): {
  rows: EventRow[];
  total: number;
} {
  const db = getDb();
  const where: string[] = [];
  const args: Array<string | number> = [];

  where.push('status = ?');
  args.push(opts.status ?? 'published');

  if (opts.fromUtc !== null && opts.fromUtc !== undefined) {
    // 用 ends_at_utc（没有则用 starts_at_utc）判断"是否已经结束"，
    // 与 shared 的 isEventPast 保持同一个语义
    where.push('COALESCE(ends_at_utc, starts_at_utc) >= ?');
    args.push(opts.fromUtc);
  }
  if (opts.toUtc !== null && opts.toUtc !== undefined) {
    where.push('starts_at_utc <= ?');
    args.push(opts.toUtc);
  }
  if (opts.tags && opts.tags.length > 0) {
    const placeholders = opts.tags.map(() => '?').join(', ');
    where.push(
      `EXISTS (SELECT 1 FROM json_each(calendar_events.tags) AS t WHERE t.value IN (${placeholders}))`,
    );
    args.push(...opts.tags);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const total = Number(
    (
      db.prepare(`SELECT COUNT(*) AS n FROM calendar_events ${whereSql}`).get(...args) as {
        n: number;
      }
    ).n,
  );

  const rows = db
    .prepare(
      `SELECT * FROM calendar_events ${whereSql}
       ORDER BY starts_at_utc ASC LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, offset) as unknown as EventRow[];

  return { rows, total };
}

/**
 * ICS 订阅用：取**还没结束的**已发布事件，按时间正序。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 这里必须带时间过滤（Q5：「ICS 只导出未来的」）
 * ---------------------------------------------------------------------------
 * 原来这个函数只有 `WHERE status = 'published'`，也就是把**历史上所有**
 * 已发布事件一起倒给订阅者。它看起来完全正常 —— 语料里当时只有将来的事件，
 * 所以测试全绿、探针也正常。
 *
 * 但订阅是**长期**的：不筛时间的话，三个月后订阅者的手机日历里会堆上几十条
 * 早就结束的比赛，而且每加一场历史赛事就再多一条。日历变成档案库，
 * 用户能做的只有取消订阅。
 *
 * ⚠️ 判据用 `COALESCE(ends_at_utc, starts_at_utc)`，和 `listEvents`、
 *    `isEventPast` 保持**同一个语义**：一场 3 小时的比赛在它结束前都算"未来"，
 *    否则订阅者会在比赛进行到一半时看着它从日历里消失。
 *
 * ⚠️ `fromUtc` 是显式参数而不是内部取 `Date.now()`：调用方（路由）要在
 *    同一个请求里把 `now` 用于 DTSTAMP 和这里两处，用两个不同的时刻
 *    会让测试变得不可复现，也让人怀疑"到底以哪个时间为准"。
 */
export function listPublishedForIcs(fromUtc: number): EventRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM calendar_events
       WHERE status = 'published' AND COALESCE(ends_at_utc, starts_at_utc) >= ?
       ORDER BY starts_at_utc ASC`,
    )
    .all(fromUtc) as unknown as EventRow[];
}
