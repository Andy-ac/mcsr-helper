/**
 * 可审核内容类型的注册表。
 *
 * ---------------------------------------------------------------------------
 * 这一层解决什么
 * ---------------------------------------------------------------------------
 * M4 要加日历、视频、种子，它们走的是同一条管线。如果不抽出这一层，
 * 每加一类内容就要：改队列查询、加 approve/reject 路由、复制一遍权限判断 ——
 * 而"复制一遍权限判断"是权限漏洞最常见的来源。
 *
 * 有了注册表，加一类内容 = **实现一个接口 + 注册一行**。
 * 队列、审核动作、权限校验、审计留痕全都是共用的。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 只注册真正实现了的类型
 * ---------------------------------------------------------------------------
 * `REVIEWABLE_TYPES` 里现在有 `resource` 和 `calendar`（M4 加的）。
 *
 * **不要提前把没实现的类型写进去。** 提前声明的后果是所有通用代码都以为
 * 它存在（队列会去查它、类型检查会通过），而运行时报错或静默返回空 ——
 * 那正是"看起来做完了其实没有"。
 *
 * ⚠️ M4 里 `video` 和 `seed` **有意不在这里**：
 *    · `video` —— Q6 决定贴了就可见、不审核，它没有待审状态
 *    · `seed`  —— v1 的 /seeds 只做上游检索，社区分享留空，现在没有 UGC 可审
 *    理由写在 `packages/shared/src/review.ts` 的 REVIEWABLE_TYPES 旁边。
 */

import { wallClockToUtc } from '@mcsr/shared/calendar-time';
import type { Capability } from '@mcsr/shared/permissions';
import type { QueueItem, ReviewableType, ReviewDetail } from '@mcsr/shared/review';
import {
  approveEvent,
  countPendingEvents,
  type EventPayload,
  getEventRow,
  getPendingRevision,
  listPendingEvents,
  rejectEvent,
  rejectionCountForEditor,
} from '../calendar/events';
import { getDb } from '../db';
import { getResource } from '../resources';
import { approveRevision, getRevision, listReviewQueue, rejectRevision } from '../revisions';
import { findUserById } from '../users';

export interface ReviewableImpl {
  /** 审核这类内容需要的能力。见 shared/permissions.ts 的矩阵。 */
  readonly capability: Capability;

  /**
   * 待审列表。
   *
   * `viewerId` 用来算每一项的 `mine`（"这一版是不是你自己提的"）。
   * ⚠️ 它是**展示信息**，不是权限判据 —— 真正的拦截在 routes/review.ts，
   *    因为只有那里同时知道"你是谁"和"你要批准哪一版"。
   */
  listPending(
    limit: number,
    offset: number,
    viewerId: string | null,
  ): { items: QueueItem[]; total: number };

  /** 待审数量（队列页的分类型标签用）。 */
  countPending(): number;

  /** 审核详情：待审内容 + 当前线上版本 + 作者的历史。 */
  detail(id: string, viewerId: string | null): ReviewDetail | null;

  /**
   * 批准。返回 null 表示没有待审版本（可能被另一位审核员抢先处理了）。
   *
   * 返回版本号而不只是布尔：审核界面要显示"已批准 r2"，
   * 而且出问题时这是唯一能对上号的东西。
   *
   * `notify` 是给"审核结果通知"用的：投递对象和标题。它们必须在**动作之前**
   * 就取出来 —— 批完之后待审版本已经不是 pending 了，再去查就查不到收件人。
   */
  approve(
    id: string,
    reviewerId: string,
    now: number,
  ): { revision: number; notify: ReviewNotify } | null;

  /** 驳回。与 approve 同理返回版本号，界面要显示"已驳回 r2"。 */
  reject(
    id: string,
    reviewerId: string,
    reason: string,
    now: number,
  ): {
    revision: number;
    resourceRejected: boolean;
    /** 驳回之后条目**实际**是什么状态（published / hidden / rejected） */
    status: string;
    notify: ReviewNotify;
  } | null;
}

/** 审核结果要通知谁、通知什么。 */
export interface ReviewNotify {
  /** 提交这一版的人；导入的条目为 null（那就没人可通知） */
  editorId: string | null;
  title: string;
}

// ---------------------------------------------------------------------------
// 资源库
// ---------------------------------------------------------------------------

/** 一行副标题：优先用域名，比标题更能帮审核员区分条目。 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 60);
  }
}

/** 统计某个作者被驳回过几次 —— 审核员判断"这个人提交质量如何"的依据。 */
function rejectionCount(editorId: string | null): number {
  if (!editorId) return 0;
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM resource_revisions
       WHERE editor_id = ? AND status = 'rejected'`,
    )
    .get(editorId) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

/**
 * 待审版本的"通知对象"：谁提交的、标题是什么。
 *
 * ⚠️ 必须在审核动作**之前**调用。批完之后待审版本的状态已经不是 pending，
 *    再按 pending_revision 去查就拿不到了 —— 而那时邮件已经无处可发。
 */
function pendingNotify(resourceId: string): ReviewNotify {
  const row = getDb()
    .prepare(
      `SELECT rv.title, rv.editor_id
       FROM resources r
       JOIN resource_revisions rv
         ON rv.resource_id = r.id AND rv.revision = r.pending_revision
       WHERE r.id = ?`,
    )
    .get(resourceId) as { title: string; editor_id: string | null } | undefined;
  return { editorId: row?.editor_id ?? null, title: row?.title ?? '' };
}

const resourceImpl: ReviewableImpl = {
  capability: 'resource.review',

  listPending(limit, offset, viewerId) {
    const { items, total } = listReviewQueue(limit, offset);
    return {
      total,
      items: items.map((r) => ({
        type: 'resource' as const,
        id: r.resource_id,
        revision: r.revision,
        title: r.title,
        subtitle: hostOf(r.url),
        isEdit: r.is_edit === 1,
        authorName: r.author_name,
        mine: viewerId !== null && r.editor_id === viewerId,
        createdAt: r.created_at,
        // 资源库没有"过期"这个概念：一条工具页面今天有效、明年也有效。
        expired: false,
      })),
    };
  },

  countPending() {
    const row = getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM resources r
         JOIN resource_revisions rv
           ON rv.resource_id = r.id AND rv.revision = r.pending_revision
         WHERE r.pending_revision IS NOT NULL AND rv.status = 'pending'`,
      )
      .get() as { n: number } | undefined;
    return Number(row?.n ?? 0);
  },

  detail(id, viewerId) {
    const resource = getDb()
      .prepare('SELECT pending_revision, current_revision FROM resources WHERE id = ?')
      .get(id) as { pending_revision: number | null; current_revision: number | null } | undefined;
    if (!resource?.pending_revision) return null;

    const pending = getRevision(id, resource.pending_revision);
    if (!pending) return null;

    /*
     * 线上版本。
     * ⚠️ getResource 只返回**已发布**的条目 —— 这正是我们要的：
     *    一个从未发布过的条目没有"线上版本"，返回 null 是对的。
     *    （不要用 resourceExists，那个是为了"存在性检查"而刻意不过滤状态的。）
     */
    const live = getResource(id);

    const toPayload = (r: {
      kind: string;
      title: string;
      title_en: string | null;
      url: string;
      summary: string | null;
      body: string;
      lang: string;
      tags: string;
      image_url: string | null;
    }) => ({
      kind: r.kind,
      title: r.title,
      titleEn: r.title_en,
      url: r.url,
      summary: r.summary,
      body: r.body,
      lang: r.lang,
      tags: JSON.parse(r.tags) as string[],
      imageUrl: r.image_url,
    });

    return {
      item: {
        type: 'resource' as const,
        id,
        revision: resource.pending_revision,
        title: pending.title,
        subtitle: hostOf(pending.url),
        isEdit: resource.current_revision !== null,
        /*
         * ⚠️ 这里必须查一次用户表。
         *
         *    最初这里写的是 `authorName: null`（占位），结果是审核详情页上
         *    每一行都显示"未知作者" —— 而审核员判断"这条该不该收"时，
         *    **作者是谁**是最重要的上下文之一。队列页的 SQL 里本来就 JOIN 了
         *    users（所以那里是有名字的），详情页却漏了，于是同一个条目
         *    在两个页面上一个"有作者"、一个"未知作者"。
         *
         *    名字取自 users 表而不是版本快照：改名之后应该显示新名字，
         *    否则审核员会以为是两个人。
         */
        authorName: pending.editor_id
          ? (findUserById(pending.editor_id)?.display_name ?? null)
          : null,
        // 这一版是不是**当前查看者**提交的 —— 审核界面靠它提前说明
        // "你自己提的这条得由别人来批"（见 permissions.ts 的 canSelfReview）
        mine: viewerId !== null && pending.editor_id === viewerId,
        createdAt: pending.created_at,
        expired: false,
      },
      live: live
        ? toPayload({
            kind: live.kind,
            title: live.title,
            title_en: live.titleEn,
            url: live.url,
            summary: live.summary,
            body: live.body,
            lang: live.lang,
            tags: JSON.stringify(live.tags),
            image_url: live.imageUrl,
          })
        : null,
      pending: toPayload(pending),
      // 给审核员的话单独摆出来（见 shared/review.ts 里 ReviewDetail.note 的注释）
      note: pending.note_to_reviewer,
      previousRejections: rejectionCount(pending.editor_id),
    };
  },

  approve(id, reviewerId, now) {
    const before = pendingNotify(id);
    const result = approveRevision({ resourceId: id, reviewerId, now });
    return result ? { revision: result.revision, notify: before } : null;
  },

  reject(id, reviewerId, reason, now) {
    const before = pendingNotify(id);
    const result = rejectRevision({ resourceId: id, reviewerId, reason, now });
    return result
      ? {
          revision: result.revision,
          resourceRejected: result.resourceRejected,
          status: result.status,
          notify: before,
        }
      : null;
  },
};

// ---------------------------------------------------------------------------
// 日历
// ---------------------------------------------------------------------------

/**
 * 一行副标题：**时间**。
 *
 * 资源库那一条放域名（审核员靠它区分"这是哪个站"），日历对应的是"这是哪一场"
 * —— 而两场同名的比赛（比如每年都办的同一届比赛的不同赛季）唯一的区别就是时间。
 * 所以时间必须在列表里就看得见，不能等点进详情。
 *
 * 时间按**用户当初填的时区**显示（`2026-08-30 20:00 · Asia/Shanghai`），
 * 不做本地化转换：审核员要核对的是"和赛事公告上写的一样不一样"，
 * 而公告上写的就是当地时间。转成审核员自己的时区反而让他没法核对
 * （他得先在心里做一次换算，而那正是最容易出错的一步）。
 */
function eventTimeSummary(p: { startsAtLocal: string; startsAtTz: string }): string {
  return `${p.startsAtLocal.replace('T', ' ')} · ${p.startsAtTz}`;
}

/**
 * 这条内容**描述的时刻**是否已经过去（Q4c 让"过去的事件"也会进队列）。
 *
 * 判据与 shared 的 `isEventPast` 保持一致：有结束时间按结束时间算，
 * 否则按开始时间算。这里不能直接调 `isEventPast`，因为快照 payload 里
 * **没有** `startsAtUtc`（那是派生列，见 shared/calendar.ts 的说明），
 * 所以现算一次。
 *
 * ⚠️ 算不出来（时区名非法 — 理论上 Zod 已经挡住了）时**返回 false**，
 *    也就是"不标成过期"。宁可漏标一个，也不要把一条正常的事件标成历史 ——
 *    后者会让审核员直接跳过它。
 */
function eventPayloadIsPast(
  p: {
    startsAtLocal: string;
    startsAtTz: string;
    endsAtLocal: string | null;
    endsAtTz: string | null;
  },
  now: number,
): boolean {
  const start = wallClockToUtc(p.startsAtLocal, p.startsAtTz);
  if (start === null) return false;
  const end = p.endsAtLocal && p.endsAtTz ? wallClockToUtc(p.endsAtLocal, p.endsAtTz) : null;
  return (end ?? start) < now;
}

/** 快照 payload（已经是驼峰命名）→ 审核详情里的线上侧形状。这里只需要原样返回。 */
function liveEventPayload(row: {
  title: string;
  title_en: string | null;
  description_md: string;
  starts_at_local: string;
  starts_at_tz: string;
  ends_at_local: string | null;
  ends_at_tz: string | null;
  all_day: number;
  url: string | null;
  location: string | null;
  tags: string;
  stage: string | null;
  level: string | null;
  scope: string | null;
  /** ③ 迁移 013 加的列。审核详情的"线上版本"读的就是这一行，漏掉它**不会报错**。 */
  series_id: string | null;
  lang: string;
  /** 015 加的列（具体赛程）。⚠️ 同 `series_id` 的理由：这里漏掉它**不会报错**。 */
  schedule_text: string | null;
}): EventPayload {
  return {
    title: row.title,
    titleEn: row.title_en,
    descriptionMd: row.description_md,
    scheduleText: row.schedule_text ?? null,
    startsAtLocal: row.starts_at_local,
    startsAtTz: row.starts_at_tz,
    endsAtLocal: row.ends_at_local,
    endsAtTz: row.ends_at_tz,
    allDay: row.all_day === 1,
    url: row.url,
    location: row.location,
    tags: JSON.parse(row.tags) as string[],
    stage: row.stage,
    level: row.level,
    scope: row.scope,
    /*
     * ③ 系列。
     *
     * ⚠️⚠️ 这一份**手写的列→payload 映射**正是最容易漏的地方：漏掉它，
     *    审核详情页的"线上版本"就没有系列（而不会有任何报错）——
     *    审核员看到的线上侧与待审侧长得不一样，却说不清差在哪。
     *    spec §4.6 点名过这一处。
     */
    seriesId: row.series_id ?? null,
    lang: row.lang,
  };
}

/**
 * 快照 → `ReviewDetail` 要的 `Record<string, unknown>`。
 *
 * ⚠️ 这里确实需要一次断言，但它**只出现在这一个地方**，理由要写清楚：
 *    `EventPayload` 是一份具体接口（字段齐全、没有索引签名），而
 *    `ReviewDetail.live` / `.pending` 刻意是 `Record<string, unknown>` ——
 *    那个类型的存在就是为了强制前端"先判断类型再取值"（见 shared/review.ts）。
 *    具体接口**不能**赋给带索引签名的类型，这是 TS 的规则，不是设计问题。
 *
 *    把它收成一个函数，是为了避免两处调用点各写一次 `as` ——
 *    那才是"断言散落、逐渐失去意义"的开始。
 */
function asPayload(p: EventPayload): Record<string, unknown> {
  return p as unknown as Record<string, unknown>;
}

const calendarImpl: ReviewableImpl = {
  // ⚠️ 日历有自己的审核能力。写死成 resource.review 会让"只能审资源的人"
  //    顺手能审日历 —— 见 routes/review.ts 头注释里对这条的说明。
  capability: 'calendar.review',

  listPending(limit, offset, viewerId) {
    const { items, total } = listPendingEvents(limit, offset);
    const now = Date.now();
    return {
      total,
      items: items.map((e) => ({
        type: 'calendar' as const,
        id: e.id,
        revision: e.revision,
        title: e.title,
        subtitle: eventTimeSummary(e),
        isEdit: e.isEdit,
        authorName: e.editorId ? (findUserById(e.editorId)?.display_name ?? null) : null,
        mine: viewerId !== null && e.editorId === viewerId,
        createdAt: e.createdAt,
        expired: eventPayloadIsPast(e, now),
      })),
    };
  },

  countPending() {
    return countPendingEvents();
  },

  detail(id, viewerId) {
    const row = getEventRow(id);
    if (!row) return null;

    /*
     * ⚠️ 两道检查都要，而且必须**互相一致**。
     *
     * 队列（listPendingEvents / countPendingEvents）是按
     * `calendar_events.pending_revision` 指向的那一版来算的，所以详情也必须
     * 落在同一版上 —— 否则会出现"队列里看不到它、但直接敲 URL 能打开"，
     * 或者反过来的不一致。多比一次 `pending.revision !== row.pending_revision`
     * 就把这两条路径钉死成同一个判据。
     */
    if (row.pending_revision === null) return null;
    const pending = getPendingRevision(id);
    if (!pending || pending.revision !== row.pending_revision) return null;

    const p = pending.payload;

    return {
      item: {
        type: 'calendar' as const,
        id,
        revision: pending.revision,
        title: p.title,
        subtitle: eventTimeSummary(p),
        isEdit: row.current_revision !== null,
        /*
         * 作者名取自 users 表而不是快照 —— 与资源库同理：改名之后应该显示新名字。
         * （这一段是资源库那边踩过的坑：详情页漏了查用户表，于是队列页有作者、
         *  详情页显示"未知作者"。）
         */
        authorName: pending.editorId
          ? (findUserById(pending.editorId)?.display_name ?? null)
          : null,
        mine: viewerId !== null && pending.editorId === viewerId,
        createdAt: pending.createdAt,
        expired: eventPayloadIsPast(p, Date.now()),
      },
      // 从未发布过的事件没有线上版本 —— 返回 null 是正确的（审核界面据此显示"新条目"）
      live: row.current_revision !== null ? asPayload(liveEventPayload(row)) : null,
      // ⚠️ 快照里的字段名本来就是驼峰（见 calendar/events.ts 的 EventPayload 注释），
      //    所以这里不需要像资源库那样再映射一次。
      pending: asPayload(p),
      note: pending.noteToReviewer,
      previousRejections: rejectionCountForEditor(pending.editorId),
    };
  },

  approve(id, reviewerId, now) {
    /*
     * ⚠️ 先取 pending 快照 —— 要同时拿到两样东西，而且都只有**动作之前**才有：
     *   · revision：approveEvent 要求明确指向哪一版（防止批错版本）
     *   · notify：批准之后这一版不再是 pending，再查就查不到收件人了
     */
    const pending = getPendingRevision(id);
    if (!pending) return null;

    const notify = { editorId: pending.editorId, title: pending.payload.title };
    const result = approveEvent({ id, revision: pending.revision, reviewerId, now });
    return result ? { revision: result.revision, notify } : null;
  },

  reject(id, reviewerId, reason, now) {
    const pending = getPendingRevision(id);
    if (!pending) return null;

    const notify = { editorId: pending.editorId, title: pending.payload.title };
    const result = rejectEvent({ id, revision: pending.revision, reason, reviewerId, now });
    return result
      ? {
          revision: result.revision,
          resourceRejected: result.eventRejected,
          status: result.status,
          notify,
        }
      : null;
  },
};

// ---------------------------------------------------------------------------
// 注册表
// ---------------------------------------------------------------------------

/**
 * 已实现的类型。
 *
 * ⚠️ 加一行之前，先确认那个类型**真的有东西可审**。少注册的后果是
 *    "队列里看不到、点不开"，多注册的后果是"队列里有个永远空的标签"，
 *    后者更容易被当成 bug 去找。
 *
 * ⚠️ 与 `packages/shared/src/review.ts` 的 REVIEWABLE_TYPES 是**穷尽关系**：
 *    shared 里加一个类型，这里不加就编译不过（`Partial<Record<…>>` 不拦，
 *    但 `routes/review.ts` 的 registeredTypes 会让队列页少一个标签 ——
 *    所以真正的守卫在测试里，见 review 相关测试）。
 */
const IMPLEMENTATIONS: Partial<Record<ReviewableType, ReviewableImpl>> = {
  resource: resourceImpl,
  calendar: calendarImpl,
};

export function implFor(type: string): ReviewableImpl | null {
  return IMPLEMENTATIONS[type as ReviewableType] ?? null;
}

/** 已注册的类型列表。队列页的分类型标签用它，所以不会显示还没实现的类型。 */
export function registeredTypes(): ReviewableType[] {
  return Object.keys(IMPLEMENTATIONS) as ReviewableType[];
}

/**
 * 汇总队列。
 *
 * ⚠️ 一个类型查失败不能拖垮整个队列。
 *    审核员打开队列是为了干活，如果因为某一类内容的查询出错就整个页面打不开，
 *    他会以为"审核系统坏了"而今天不审了。所以单类失败时记日志、跳过。
 */
export function listQueue(
  limit: number,
  offset: number,
  viewerId: string | null,
): { items: QueueItem[]; total: number; counts: Partial<Record<ReviewableType, number>> } {
  const items: QueueItem[] = [];
  const counts: Partial<Record<ReviewableType, number>> = {};
  let total = 0;

  for (const type of registeredTypes()) {
    const impl = IMPLEMENTATIONS[type];
    if (!impl) continue;
    try {
      counts[type] = impl.countPending();
      total += counts[type] ?? 0;
      // 各类型分别取 limit 条再在内存里合并排序 —— 不是最高效的做法，
      // 但待审队列在正常状态下只有几条到几十条，而它换来的是
      // "不需要为多种内容类型写一条 UNION 的 SQL"。
      items.push(...impl.listPending(limit, offset, viewerId).items);
    } catch (error) {
      console.error(`[review] 读取 ${type} 的待审列表失败（跳过该类型）:`, error);
    }
  }

  items.sort((a, b) => a.createdAt - b.createdAt);
  return { items: items.slice(offset, offset + limit), total, counts };
}

export function getDetail(
  type: string,
  id: string,
  viewerId: string | null = null,
): ReviewDetail | null {
  return implFor(type)?.detail(id, viewerId) ?? null;
}
