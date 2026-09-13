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
import {
  type CalendarEvent,
  type CalendarEventInput,
  type CalendarSeries,
  type CalendarSeriesInput,
  normalizeSeriesName,
} from '@mcsr/shared/calendar';
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
  /** 015 才加的列；`SELECT *` 对旧行拿到 NULL，所以读的时候 `?? null`。 */
  schedule_text: string | null;
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
  /** 011 新增的两维筛选项。可空 —— 排位节点没有专业程度/参与范围。 */
  level: string | null;
  scope: string | null;
  /** 013 新增：所属系列（③）。可空 —— "不属于任何系列"是常态，不是"还没填"。 */
  series_id: string | null;
  /**
   * 读路径上 `LEFT JOIN calendar_series` 得到的**系列显示名**（不是本表的列）。
   *
   * ⚠️ 刻意标成**可选**：`getEventRow` 走的是裸 `SELECT *`（没有 JOIN），
   *    那种路径下这个键根本不存在。写成必填会逼**每一个**查询都去 JOIN 一次，
   *    而详情页并不需要名字；所以这里用 `?`，由 `toCalendarEvent` 里的
   *    `?? null` 兜住 —— 漏了 JOIN 的表现是"系列名显示不出来"，不是崩溃。
   */
  series_name?: string | null;
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
    schedule_text: input.scheduleText ?? null,
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
    level: input.level ?? null,
    scope: input.scope ?? null,
    /**
     * ③ 系列：只存**指针**，不存名字（名字在 calendar_series 里，读时 JOIN）。
     */
    series_id: input.seriesId ?? null,
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
  /**
   * 具体赛程（**离散的多个时间段**就写在这里，一行一个）。
   *
   * ⚠️ **旧快照里没有这个键**，所以读的地方必须 `?? null`（同下面 seriesId 的理由）。
   */
  scheduleText: string | null;
  startsAtLocal: string;
  startsAtTz: string;
  endsAtLocal: string | null;
  endsAtTz: string | null;
  allDay: boolean;
  url: string | null;
  location: string | null;
  tags: string[];
  stage: string | null;
  level: string | null;
  scope: string | null;
  /**
   * ③ 系列的 id。
   *
   * ⚠️ **旧快照里没有这个键**（011 那批快照没有 level/scope，这次的快照没有 seriesId），
   *    所以读快照的地方必须写成 `p.seriesId ?? null` —— 直接取值会让"审批"在
   *    绑参处报错，而错误信息指向的是**参数个数**，和真正的原因毫无关系（F11/F25）。
   */
  seriesId: string | null;
  lang: string;
}

function toPayload(input: CalendarEventInput): EventPayload {
  return {
    title: input.title,
    titleEn: input.titleEn ?? null,
    descriptionMd: input.descriptionMd,
    scheduleText: input.scheduleText ?? null,
    startsAtLocal: input.startsAtLocal,
    startsAtTz: input.startsAtTz,
    endsAtLocal: input.endsAtLocal ?? null,
    endsAtTz: input.endsAtTz ?? null,
    allDay: input.allDay,
    url: input.url ?? null,
    location: input.location ?? null,
    tags: input.tags,
    stage: input.stage ?? null,
    level: input.level ?? null,
    scope: input.scope ?? null,
    seriesId: input.seriesId ?? null,
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
    // ⚠️ `?? null` 是**必需的**，不是防御性写法：015 之前的快照没有这个键（见 EventPayload）
    schedule_text: p.scheduleText ?? null,
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
    /*
     * ⚠️ `?? null` 而不是直接 `p.level`：快照是**历史数据**，而 011 之前的
     *    快照里根本没有这两个字段。直接取值会得到 `undefined`，
     *    而 node:sqlite 对 `undefined` 绑参是**报错**的（对 null 才正常）。
     *    也就是说：一条在 011 之前提交、一直没审的待审事件，
     *    会在审核通过的那一刻把整个审批动作炸掉 —— 而错误信息指向的是绑参数量。
     */
    level: p.level ?? null,
    scope: p.scope ?? null,
    // ③ 系列：同上面两条的理由 —— 旧快照没有这个键，`?? null` 是必需的（不是防御性写法）
    series_id: p.seriesId ?? null,
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
    scheduleText: row.schedule_text ?? null,
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
    level: row.level,
    scope: row.scope,
    /*
     * 系列（③）。`seriesId` 是事件行上那一列；`seriesName` 是读路径
     * `LEFT JOIN calendar_series` 得到的显示名 —— **不落库**，因为两份名字必然漂移
     * （系列一改名，老事件上留着旧名字，而两边都不会报错，只是显示不一致）。
     *
     * ⚠️ 两者都用 `?? null`：`series_name` 在没 JOIN 的路径（`getEventRow`）上
     *    根本不存在，而 `series_id` 对 013 之前写入的行是 NULL。
     */
    seriesId: row.series_id ?? null,
    seriesName: row.series_name ?? null,
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
         (id, title, title_en, description_md, schedule_text, starts_at_local, starts_at_tz, starts_at_utc,
          ends_at_local, ends_at_tz, ends_at_utc, all_day, url, location, tags, stage,
          level, scope, series_id, lang,
          author_id, current_revision, pending_revision, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, 'pending', ?, ?)`,
    ).run(
      input.id,
      cols.title,
      cols.title_en,
      cols.description_md,
      cols.schedule_text,
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
      cols.level,
      cols.scope,
      cols.series_id,
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
         title = ?, title_en = ?, description_md = ?, schedule_text = ?,
         starts_at_local = ?, starts_at_tz = ?, starts_at_utc = ?,
         ends_at_local = ?, ends_at_tz = ?, ends_at_utc = ?,
         all_day = ?, url = ?, location = ?, tags = ?, stage = ?,
         level = ?, scope = ?, series_id = ?, lang = ?,
         status = 'published', current_revision = ?, pending_revision = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(
      cols.title,
      cols.title_en,
      cols.description_md,
      cols.schedule_text,
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
      cols.level,
      cols.scope,
      cols.series_id,
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

  /*
   * ⚠️⚠️ 判据看 **status**，不看 `current_revision`（spec D2.14，本仓为这个坑写过两次注释）。
   *
   * `current_revision !== null` 曾经在这里，它错在**用错了字段回答"线上有没有内容"**：
   *   · 导入的条目 / 给 013 之后直编新建的条目，`status` 是 `published` 而
   *     `current_revision` 可能是 NULL（它们不是走审核流程进来的）；
   *   · 于是"改一条已发布事件 → 被驳回"会被当成"它从没上架过"，
   *     接着那条 UPDATE 把它标成 `rejected` —— **线上那场赛事凭空消失**。
   *     现象是"我只改了一下，它就不见了"，而没有任何报错。
   *
   * `revisions.ts` 的 `rejectRevision` 早就改成看状态了（那里有一段专门骂这件事的注释），
   * 日历这边是同一个 bug 的遗留写法。两处**必须逐字一致**，
   * 否则同一条规则会在两个文件里各有一套真相。
   *
   * ⚠️ 保留 `hidden` 也是刻意的：内容被下架之后，一次修改被驳回不该把它悄悄恢复上架。
   */
  const wasPublished = row.status === 'published' || row.status === 'hidden';

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
  /** 专业程度 / 参与范围 / 轮次。**单选**，`null`/缺省表示不限。 */
  level?: string | null;
  scope?: string | null;
  stage?: string | null;
  /** ③ 按系列筛（`?seriesId=`）。单值等值，和 level/scope/stage 同一档语义。 */
  seriesId?: string | null;
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
 *
 * ⚠️ 而 `level` / `scope` / `stage` 是**单值等值**条件，直接 `= ?` 就行。
 *    注意它们和 `tags` 的语义差别：标签是"任一命中"，这三个是"就是这个"。
 *    混起来的后果是"我筛了职业赛，结果业余的也出来了"，而那种错很难被看出来。
 *
 * ⚠️ 三者都用 `!== undefined && !== null` 判断，**不能用真值判断** ——
 *    它们来自查询参数，而"参数没传"和"参数传了空"必须落到同一个结果（不过滤）。
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
  // 三个单选维度。它们可空，所以 `= NULL` 永远不成立 ——
  // 但"不限"本来就不该加条件，所以这里不为"筛没填的"提供入口（见下面注释）。
  for (const [column, value] of [
    ['level', opts.level],
    ['scope', opts.scope],
    ['stage', opts.stage],
    // ③ 系列：`?seriesId=` —— 与上面三个同档（单值等值），因为"就是这个系列"是唯一读法
    ['series_id', opts.seriesId],
  ] as const) {
    if (value === undefined || value === null || value === '') continue;
    where.push(`${column} = ?`);
    args.push(value);
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
      /*
       * ⚠️ 这里多了一次 `LEFT JOIN calendar_series`，只为**显出系列名**（③）。
       *    不 JOIN 的话 `seriesName` 恒为 null —— 表现是"填了系列但界面上看不到"，
       *    而**不会报错**（这正是 011 那次 `level/scope` 漏在某个写死清单里时的形状）。
       *
       * ⚠️ `LEFT JOIN` 而不是 `JOIN`：绝大多数事件不属于任何系列，
       *    内连接会把它们**整批滤掉**（"日历突然只剩几场赛事"）。
       *
       * 计数那条（上面的 COUNT）**不 JOIN** —— 系列名与总数无关，
       * 而带 JOIN 的计数在日历表上会白白多一次查找。
       */
      `SELECT calendar_events.*, s.name AS series_name
       FROM calendar_events
       LEFT JOIN calendar_series AS s ON s.id = calendar_events.series_id
       ${whereSql}
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
      /*
       * ⚠️ 带 `LEFT JOIN calendar_series` 是为了让 ICS 的 CATEGORIES 能带上系列名
       *    （③/D3.11：RFC 的 CATEGORIES 就是为分类准备的）。
       *    JOIN 的形式与 `listEvents` 一致 —— 两处写法不同的话，
       *    下一个人只会照着其中一处改，而另一处会静默地拿不到系列名。
       */
      `SELECT calendar_events.*, s.name AS series_name
       FROM calendar_events
       LEFT JOIN calendar_series AS s ON s.id = calendar_events.series_id
       WHERE calendar_events.status = 'published'
         AND COALESCE(calendar_events.ends_at_utc, calendar_events.starts_at_utc) >= ?
       ORDER BY starts_at_utc ASC`,
    )
    .all(fromUtc) as unknown as EventRow[];
}

// ---------------------------------------------------------------------------
// 系列活动（③）：系列的读写
// ---------------------------------------------------------------------------

/** `listSeries` 的一行（聚合出来的三个数字 + 系列自己的四列）。 */
interface SeriesRow {
  id: string;
  name: string;
  created_by: string | null;
  created_at: number;
  /** 未结束的场次数 */
  upcoming: number;
  /** 已结束的场次数 */
  past: number;
  /** 最近一场未结束赛事的开始时间（UTC 毫秒）；没有则 NULL */
  next_start: number | null;
}

/**
 * 行 → 对外的 `CalendarSeries`。
 *
 * ⚠️ 逐字段展开，不用 `{ ...row }`：node:sqlite 的行对象原型不是 `Object.prototype`，
 *    而测试里的 `deepStrictEqual` 会比较原型 —— 不展开的话两边打印出来一模一样却判不相等
 *    （本仓在 videos.ts / live.ts 里都踩过这一条）。
 */
function toSeries(row: SeriesRow): CalendarSeries {
  return {
    id: row.id,
    name: row.name,
    count: Number(row.upcoming),
    pastCount: Number(row.past),
    nextStartsAtUtc: row.next_start === null ? null : Number(row.next_start),
    createdBy: row.created_by,
    createdAt: Number(row.created_at),
  };
}

/**
 * 系列列表 —— 日历页底部「系列活动」栏目与它的搜索框的数据源。
 *
 * ---------------------------------------------------------------------------
 * 三个数字是**算出来的**，而且只数已发布的事件
 * ---------------------------------------------------------------------------
 * `count` / `pastCount` / `nextStartsAtUtc` 都不是表上的列：它们描述的是
 * "这个系列下面的事件现在长什么样"，而那会随时间变（存起来就需要定时任务去翻，
 * 见 `isEventPast` 的注释）。
 *
 * ⚠️ `e.status = 'published'` 写在 **JOIN 条件里**，不是 WHERE 里 ——
 *    写进 WHERE 的话，一个"只有待审场次"的系列会**从栏目里消失**
 *    （INNER JOIN 的效果），而它明明存在。放在 ON 里，那种系列照样出现，
 *    只是三个数字都是 0。
 *
 * ⚠️ 排序在**服务端**做（`nextStartsAtUtc` 升序，没有未结束场次的排后面），
 *    并用手抄的 `s.name` 收尾把同一天的顺序钉死 —— 只按时间排的话，
 *    同一时刻的几个系列每次刷新可能换位（和 `listLiveChannels` 第二键同一个理由）。
 *
 * ⚠️ 搜索**不在这里**：系列是人眼能扫完的量级，`q` 由前端在这一次响应里过滤
 *    （spec §4.5/D3.9-(b)）。服务端再写一份匹配规则，就是第二份会漂移的真相。
 */
export function listSeries(now: number, limit = 200): CalendarSeries[] {
  const capped = Math.min(Math.max(limit, 1), 200);
  const rows = getDb()
    .prepare(
      `SELECT s.id, s.name, s.created_by, s.created_at,
              SUM(CASE WHEN COALESCE(e.ends_at_utc, e.starts_at_utc) >= ? THEN 1 ELSE 0 END) AS upcoming,
              SUM(CASE WHEN COALESCE(e.ends_at_utc, e.starts_at_utc) <  ? THEN 1 ELSE 0 END) AS past,
              MIN(CASE WHEN COALESCE(e.ends_at_utc, e.starts_at_utc) >= ? THEN e.starts_at_utc END) AS next_start
       FROM calendar_series AS s
       LEFT JOIN calendar_events AS e
              ON e.series_id = s.id AND e.status = 'published'
       GROUP BY s.id
       ORDER BY (next_start IS NULL) ASC, next_start ASC, s.name ASC
       LIMIT ?`,
    )
    .all(now, now, now, capped) as unknown as SeriesRow[];
  return rows.map(toSeries);
}

/** 按 id 读一个系列（改名之后回读用，形状与列表里的那一行一致）。 */
export function getSeries(id: string, now: number): CalendarSeries | null {
  return listSeries(now, 200).find((s) => s.id === id) ?? null;
}

/**
 * 新建系列。
 *
 * ⚠️ 重名靠 `calendar_series.name` 上的 `COLLATE NOCASE UNIQUE` 判：
 *    先查一次（友好错误），并在 catch 里**再查一次**（竞态兜底）——
 *    这与 `createLiveChannel` / `createVideo` 的写法一致：
 *    重复是这条路上的**正常**结果，不该走异常路径，但竞态时也不能把
 *    数据库错误原样抛给用户。
 */
export function createSeries(
  input: CalendarSeriesInput,
  actorId: string,
  now: number,
): { ok: true; series: CalendarSeries } | { ok: false; reason: 'name_taken' } {
  const db = getDb();
  /*
   * ⚠️ 写库前必须过 `normalizeSeriesName`：`COLLATE NOCASE` 只折叠大小写，
   *    **不折叠空白** —— 不过一遍会让 `MCSR Ranked` 与 `MCSR  Ranked` 各建一个系列，
   *    而它们在栏目里并排显示成一模一样的两行。
   */
  const name = normalizeSeriesName(input.name);
  if (name === null) {
    // schema 已经保证 trim 后非空，所以这里到不了；抛而不是兜底（见 toColumns 的先例）
    throw new Error(`系列名归一化之后为空：${JSON.stringify(input.name)}`);
  }

  const taken = findSeriesByName(name);
  if (taken) return { ok: false, reason: 'name_taken' };

  const id = newId();
  try {
    db.prepare(
      'INSERT INTO calendar_series (id, name, created_by, created_at) VALUES (?, ?, ?, ?)',
    ).run(id, name, actorId, now);
  } catch (error) {
    // 竞态兜底：只有真的能查到同名（NOCASE）才当成重名，否则原样抛
    if (findSeriesByName(name)) return { ok: false, reason: 'name_taken' };
    throw error;
  }

  return {
    ok: true,
    series: {
      id,
      name,
      count: 0,
      pastCount: 0,
      nextStartsAtUtc: null,
      createdBy: actorId,
      createdAt: now,
    },
  };
}

/** 改名。⚠️ 改名**不是**新建：`series_id` 上的引用不受影响（这也是 (A) 实体相对 (B) 单列的好处）。 */
export function renameSeries(
  id: string,
  input: CalendarSeriesInput,
): { ok: true; previousName: string } | { ok: false; reason: 'not_found' | 'name_taken' } {
  const db = getDb();
  const row = db.prepare('SELECT name FROM calendar_series WHERE id = ?').get(id) as
    | { name: string }
    | undefined;
  if (!row) return { ok: false, reason: 'not_found' };

  const name = normalizeSeriesName(input.name);
  if (name === null) throw new Error(`系列名归一化之后为空：${JSON.stringify(input.name)}`);

  const clash = findSeriesByName(name);
  if (clash && clash.id !== id) return { ok: false, reason: 'name_taken' };

  db.prepare('UPDATE calendar_series SET name = ? WHERE id = ?').run(name, id);
  // 返回改之前的名字：审计要记的是"把什么改成了什么"，而调用方手里只有新的那个
  return { ok: true, previousName: row.name };
}

/** 同名（大小写不敏感，靠列上的 COLLATE NOCASE）的系列。 */
function findSeriesByName(name: string): { id: string } | null {
  const row = getDb().prepare('SELECT id FROM calendar_series WHERE name = ?').get(name) as
    | { id: string }
    | undefined;
  return row ?? null;
}

// ---------------------------------------------------------------------------
// ② 直编（`content.author`，editor 及以上）：不经审核，**直接写"线上那一行"**
//
// ⚠️ 与 `submitEvent` / `reviseEvent` 的差别只有一处：**碰不碰线上那一行**。
//    上面那两条一句都不写 `calendar_events` 的内容字段（这正是"线上仍是旧版"
//    的实现方式，见 `reviseEvent` 的注释）；下面这三条**就是要**写它。
//    所以它们必须同时写一条 `approved` 快照并推进 `current_revision` ——
//    否则版本历史断链，审核详情页的"线上版本"也会指向不存在的记录。
// ---------------------------------------------------------------------------

/**
 * 直编写一条**已批准**的快照。
 *
 * ⚠️ 不能复用 `insertRevision`：那个函数把 `status` 写死成 `'pending'`，
 *    而直编这一版的语义就是"已经批准了"。给 `insertRevision` 加一个参数
 *    会让两条语义不同的路共用一个函数体，最后总有人传错那个参数。
 */
function insertApprovedRevision(input: {
  entityId: string;
  revision: number;
  payload: EventPayload;
  actorId: string;
  now: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO content_revisions
         (id, type, entity_id, revision, payload, status, editor_id, note_to_reviewer,
          created_at, reviewed_by, reviewed_at)
       VALUES (?, ?, ?, ?, ?, 'approved', ?, NULL, ?, ?, ?)`,
    )
    .run(
      newId(),
      CALENDAR_TYPE,
      input.entityId,
      input.revision,
      JSON.stringify(input.payload),
      input.actorId,
      input.now,
      input.actorId,
      input.now,
    );
}

/**
 * 直编新建：**建出来就已经发布**（`status = 'published'` + 第 1 版 approved 快照）。
 *
 * ⚠️ 与用户提交的唯一区别就是那三个字段：`current_revision = 1`、
 *    `pending_revision = NULL`、`status = 'published'`。
 *    写错成 `pending_revision = 1` 的话，这条"已经上架"的事件会同时挂着
 *    "有一份待审修改"，之后任何编辑都会被 409 挡住 —— 而界面上看不出原因。
 */
export function submitEventDirect(input: {
  id: string;
  payload: CalendarEventInput;
  actorId: string;
  now: number;
}): { revision: number } {
  const db = getDb();
  const cols = toColumns(input.payload);

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO calendar_events
         (id, title, title_en, description_md, schedule_text, starts_at_local, starts_at_tz, starts_at_utc,
          ends_at_local, ends_at_tz, ends_at_utc, all_day, url, location, tags, stage,
          level, scope, series_id, lang,
          author_id, current_revision, pending_revision, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, 'published', ?, ?)`,
    ).run(
      input.id,
      cols.title,
      cols.title_en,
      cols.description_md,
      cols.schedule_text,
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
      cols.level,
      cols.scope,
      cols.series_id,
      cols.lang,
      input.actorId,
      input.now,
      input.now,
    );

    insertApprovedRevision({
      entityId: input.id,
      revision: 1,
      payload: toPayload(input.payload),
      actorId: input.actorId,
      now: input.now,
    });

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { revision: 1 };
}

/**
 * 直编一条**已存在**的事件。
 *
 * ⚠️ 有待审改动时**拒绝**（`already_pending`）：那条待审快照基于更早的线上版本，
 *    一旦稍后被批准，就会把这次直编的内容**原样覆盖回去** —— 没有报错，
 *    用户只会看到"我改的东西自己变回去了"。
 *
 * ⚠️ 状态规则与 `approveEvent` 同形：`hidden` 的赛事改内容之后**仍然 hidden**。
 *    日历目前没有隐藏入口，但规则必须一致 —— 否则将来一开隐藏就会出现
 *    "改一个错别字就把它恢复上架"。
 *
 * ⚠️ 版本号取 `MAX(revision) + 1`，**不能**从 `current_revision` 推：
 *    被驳回的版本仍然占着号（`reviseEvent` 里为这个坑写过一段注释，是同一个 bug）。
 */
export function applyEventDirectRevision(input: {
  id: string;
  payload: CalendarEventInput;
  actorId: string;
  now: number;
}): { revision: number; status: string } | { error: 'not_found' | 'already_pending' } {
  const db = getDb();
  const row = getEventRow(input.id);
  if (!row) return { error: 'not_found' };
  if (row.pending_revision !== null) return { error: 'already_pending' };

  const cols = toColumns(input.payload);
  const maxRow = db
    .prepare(
      'SELECT COALESCE(MAX(revision), 0) AS n FROM content_revisions WHERE type = ? AND entity_id = ?',
    )
    .get(CALENDAR_TYPE, input.id) as { n: number } | undefined;
  const revision = Number(maxRow?.n ?? 0) + 1;

  db.exec('BEGIN IMMEDIATE');
  try {
    insertApprovedRevision({
      entityId: input.id,
      revision,
      payload: toPayload(input.payload),
      actorId: input.actorId,
      now: input.now,
    });

    db.prepare(
      `UPDATE calendar_events SET
         title = ?, title_en = ?, description_md = ?, schedule_text = ?,
         starts_at_local = ?, starts_at_tz = ?, starts_at_utc = ?,
         ends_at_local = ?, ends_at_tz = ?, ends_at_utc = ?,
         all_day = ?, url = ?, location = ?, tags = ?, stage = ?,
         level = ?, scope = ?, series_id = ?, lang = ?,
         status = CASE WHEN status = 'hidden' THEN 'hidden' ELSE 'published' END,
         current_revision = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      cols.title,
      cols.title_en,
      cols.description_md,
      cols.schedule_text,
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
      cols.level,
      cols.scope,
      cols.series_id,
      cols.lang,
      revision,
      input.now,
      input.id,
    );

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const after = getEventRow(input.id);
  return { revision, status: after?.status ?? 'published' };
}

/**
 * 直编真删一个事件。
 *
 * ⚠️ **必须在同一个事务里显式删掉它的 `content_revisions`**：那张表**没有外键**
 *    （005 刻意如此 —— 它是按类型多态的），所以不会有级联。不删就会留下永远查不到的
 *    孤儿行，里面还可能有 `status = 'pending'` 的快照 —— 表现是"队列里有一个
 *    已经不存在的事件"，点进去只会 404。
 *
 * ⚠️ 赛事没有收藏/备注这类连带数据（收藏表的外键只指向 `resources`），
 *    所以一次真删就够；资源那边不同，见 `deleteResourceDirect` 的注释。
 *
 * ⚠️⚠️ **两档在赛事上只剩一档，这是 captain 明确裁定过的**（2026-09-13，别照资源那条改回来）：
 *    那道"先下架再删"的缓冲，**唯一理由**是"不可逆地毁掉**别人**的数据" ——
 *    资源的删除会 CASCADE 掉版本历史与**所有人**的收藏/私人备注/评分，而私人备注没有备份。
 *    **赛事没有这个条件**：无收藏、无私人备注、无任何连带数据。
 *    更关键的是，那一步在赛事上**走不通**：日历**没有任何**把事件写成 `hidden` 的入口
 *    （spec §7.7 明确本轮不新开隐藏功能），所以非 force 的那一档会让 editor
 *    **永远删不掉任何一条已发布的赛事** —— 而用户需求 ② 的原话是
 *    "editor 及以上可直接增删改**资料、视频、赛事、种子**的原文本"。
 *    ⇒ 唯一调用方（`DELETE /api/authoring/calendar/:id`）传的是 `force: true`。
 *
 * ⚠️⚠️ 因此下面那个 `must_hide_first` 分支**当前没有任何调用方可达**（`force` 恒为 true）。
 *    保留它**不是因为它还在承重**，而是因为：① 三个类型的删除函数保持同一个形状，
 *    读代码的人不会以为"赛事少了半条规则"；② 将来真给赛事加了隐藏入口，
 *    开它的动作就是路由里那个布尔，而不是重写一条规则。
 *    ⚠️ 谁要改这里，先确认自己不是把一条**死分支**当成约束在遵守。
 *    （本会话已经因此吃过一次亏：规则看起来还在，其实谁也走不通。）
 *
 * ⚠️ 判据是 **`status`**，不是"有没有 `current_revision`"：导入/直编进来的事件
 *    `current_revision` 可能是 NULL 而它在线上（D2.14，本仓为这个坑写过两次注释）。
 */
export function deleteEventDirect(
  id: string,
  options: { force: boolean },
): { ok: true } | { ok: false; reason: 'not_found' | 'must_hide_first' } {
  const db = getDb();
  const row = db.prepare('SELECT status FROM calendar_events WHERE id = ?').get(id) as
    | { status: string }
    | undefined;
  if (!row) return { ok: false, reason: 'not_found' };

  /*
   * ⚠️ **不可达分支**（见函数头）：只有传 `force: false` 才可能走到这里，
   *    而当前没有任何调用方会那样传。留着它是为了让三个类型的删除函数同一个形状。
   */
  if (!options.force && row.status === 'published') {
    return { ok: false, reason: 'must_hide_first' };
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM content_revisions WHERE type = ? AND entity_id = ?').run(
      CALENDAR_TYPE,
      id,
    );
    db.prepare('DELETE FROM calendar_events WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { ok: true };
}

/**
 * 删掉一个系列，**连同它下面的所有赛事**（2026-09-13，用户裁决：连事件一起删）。
 *
 * ---------------------------------------------------------------------------
 * 为什么它必须是一个事务，而不是"循环调用 `deleteEventDirect`"
 * ---------------------------------------------------------------------------
 * `deleteEventDirect` 自己开事务。在它外面再包一层、或在循环里逐条调用，
 * 会得到**部分成功**：删掉第 3 场时抛错 ⇒ 前 2 场的版本历史已经没了、系列还在，
 * 而调用方只看到一句失败。**系列与它的赛事要么一起消失，要么一起留着。**
 * 所以这里把两步都写进同一个 `BEGIN IMMEDIATE`，并且**把修订行的清理内联进来**
 * 而不是复用那个函数 —— 复用就得给它加"别自己开事务"的参数，那是把复杂度
 * 挪进一个已经被三个调用方依赖的函数里。
 *
 * ⚠️ **修订行必须跟着删**（与 `deleteEventDirect` 同一条理由，那次是踩过的坑）：
 *    `content_revisions` 按 `type` + `entity_id` 多态引用、**没有外键**，
 *    漏删就留下永远查不到的孤儿行 —— 里面还可能有 `status = 'pending'` 的快照，
 *    表现是"审核队列里有一条已经不存在的事件"，点进去 404。
 *
 * ⚠️ **系列本身没有修订行**：`calendar_series` 不参与版本流程（改名走
 *    `series.rename` 审计，不是新版本），所以这里没有对应的第二次 DELETE。
 *    将来若给系列加了版本，这里**必须**补上，否则就是上面那个孤儿坑的翻版。
 *
 * ⚠️ 与 `deleteEventDirect` 一样，**不在这里判权限** —— 数据层只负责"删干净"，
 *    "谁能删"由路由层的谓词决定（`permissions.ts` 写明 `canHardDelete` 是唯一判据）。
 */
export function deleteSeriesCascade(
  id: string,
): { ok: true; deletedEvents: number } | { ok: false; reason: 'not_found' } {
  const db = getDb();
  const exists = db.prepare('SELECT id FROM calendar_series WHERE id = ?').get(id) as
    | { id: string }
    | undefined;
  if (!exists) return { ok: false, reason: 'not_found' };

  /*
   * ⚠️ 取 id 列表要在事务**里面**之前先取，但**不能**只按 `status='published'` 过滤：
   *    未发布的草稿同样挂着 `series_id`，漏掉它们会让 `DELETE FROM calendar_series`
   *    撞上外键（`on_delete: NO ACTION`）而整笔回滚 —— 表现是"删不掉，且不知道为什么"。
   */
  const eventIds = (
    db.prepare('SELECT id FROM calendar_events WHERE series_id = ?').all(id) as unknown as Array<{
      id: string;
    }>
  ).map((r) => r.id);

  db.exec('BEGIN IMMEDIATE');
  try {
    const dropRevisions = db.prepare(
      'DELETE FROM content_revisions WHERE type = ? AND entity_id = ?',
    );
    const dropEvent = db.prepare('DELETE FROM calendar_events WHERE id = ?');
    for (const eventId of eventIds) {
      dropRevisions.run(CALENDAR_TYPE, eventId);
      dropEvent.run(eventId);
    }
    db.prepare('DELETE FROM calendar_series WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { ok: true, deletedEvents: eventIds.length };
}

/**
 * 删掉这个系列**会连带删掉多少场赛事**（给二次确认用的只读计数）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 为什么不复用列表里的 `count`
 * ---------------------------------------------------------------------------
 * `listSeries` 那个数字是「**未结束且已发布**」的场次（见它的 SQL：
 * `e.status = 'published'` + `COALESCE(ends_at_utc, starts_at_utc) >= now`），
 * 而 `deleteSeriesCascade` 删的是**所有**赛事 —— 含已经过去的、含还没发布的。
 *
 * ⇒ 两者在**最需要正确的那种系列上恰好相反**：一个「历届季后赛」系列在列表里
 *    `count` 是 **0**（所有场次都已结束），确认框于是会说"不会影响任何内容"，
 *    而它正要删掉 15 场。**那是在用户按下最后一个按钮之前对他说谎。**
 *
 * ⇒ 所以这里数的是**真正会被删的那些行**：`WHERE series_id = ?`，不带 status/
 *    时间条件。改这个函数之前先读 `deleteSeriesCascade` 的 WHERE —— 两个查询
 *    必须始终覆盖**同一批行**，否则确认框里的数字又会变成一句假话。
 *
 * ⚠️ 返回 `null` 表示**系列不存在**（路由据此回 404），与"存在但有 0 场"（回 0）
 *    是两件不同的事 —— 混成一个 0 会让"删一个不存在的 id"看起来像成功。
 */
export function countSeriesEvents(id: string): number | null {
  const db = getDb();
  const exists = db.prepare('SELECT id FROM calendar_series WHERE id = ?').get(id) as
    | { id: string }
    | undefined;
  if (!exists) return null;
  const row = db.prepare('SELECT COUNT(*) AS n FROM calendar_events WHERE series_id = ?').get(id) as
    | { n: number }
    | undefined;
  return row?.n ?? 0;
}
