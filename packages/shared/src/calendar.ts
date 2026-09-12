/**
 * 日历事件的契约 —— **服务端和前端共用**。
 *
 * ---------------------------------------------------------------------------
 * 时间的三段式表示（用户 Q2 的决定）
 * ---------------------------------------------------------------------------
 * 「存当地时间 + 时区名，显示时转本地」。所以一个时刻由**两个字段**共同描述：
 *
 *     startsAtLocal: '2026-08-30T20:00'     ← 照抄赛事公告上写的
 *     startsAtTz:    'Asia/Shanghai'        ← IANA 名
 *
 * `startsAtUtc` 是由这两者**算出来**的（服务端在写入时算），
 * 它不是用户可以填的东西 —— 所以**不在入参 schema 里**。
 * 让客户端能提交 UTC，就等于让它可以提交一个和 local+tz 矛盾的时刻，
 * 而那时数据库里就同时存在两个互相冲突的"真相"。
 *
 * ---------------------------------------------------------------------------
 * 为什么校验要放在 shared
 * ---------------------------------------------------------------------------
 * "结束时间必须晚于开始时间"这条，服务端必须查（防绕过），
 * 但前端也应该**立刻**能查 —— 否则用户填完一整张表单、点了提交，
 * 才被服务端告知结束时间填反了。
 * 放在 shared 就是为了一次写好、两边都用同一个判据。
 */
import { z } from 'zod';
import { isValidTimeZone, wallClockToUtc } from './calendar-time';
import { CALENDAR_TAGS, EVENT_STAGES, LOCALES } from './constants';

/** 描述长度上限。和 v1-plan 里其它正文的量级一致。 */
export const EVENT_DESCRIPTION_MAX = 20000;
export const EVENT_TITLE_MAX = 200;
export const EVENT_LOCATION_MAX = 200;

/**
 * 墙钟时间：`YYYY-MM-DDTHH:mm`。
 *
 * ⚠️ 刻意**不接受**带时区后缀（`...Z` 或 `...+08:00`）的写法。
 * 那样的话同一个字段会有两种含义，而"带后缀时按后缀、不带时按 startsAtTz"
 * 是一条只有在出错时才会被人发现的规则。
 */
export const WallClockSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, { message: '时间格式应为 2026-08-30T20:00' });

/** IANA 时区名。判据是运行时认不认 —— 见 calendar-time.ts。 */
export const TimeZoneSchema = z
  .string()
  .max(64)
  .refine(isValidTimeZone, { message: '时区名无效（例如 Asia/Shanghai）' });

/** 是否整天事件。整天事件的时间部分必须是 00:00（下面 superRefine 会查）。 */
export const ALL_DAY_TIME = '00:00';

export const CalendarEventInputSchema = z
  .object({
    title: z.string().trim().min(1, { message: '标题不能为空' }).max(EVENT_TITLE_MAX),
    /**
     * 可选的英文标题。**不强制、绝不自动翻译**（Q19）。
     * 英文界面下没有它时**回退显示中文标题**，而不是留空 —— 见 Q19。
     */
    titleEn: z.string().trim().max(EVENT_TITLE_MAX).nullish(),
    descriptionMd: z.string().max(EVENT_DESCRIPTION_MAX).default(''),

    startsAtLocal: WallClockSchema,
    startsAtTz: TimeZoneSchema,

    /** 结束时间可空（很多赛事只公布开始时间）。给了 local 就必须给 tz。 */
    endsAtLocal: WallClockSchema.nullish(),
    endsAtTz: TimeZoneSchema.nullish(),

    allDay: z.boolean().default(false),

    url: z.string().trim().max(500).nullish(),
    location: z.string().trim().max(EVENT_LOCATION_MAX).nullish(),

    /** 多选，至少一个 —— 一个没有任何标签的事件在按标签筛选的界面上等于不可见。 */
    tags: z
      .array(z.enum(CALENDAR_TAGS))
      .min(1, { message: '至少选一个标签' })
      .max(CALENDAR_TAGS.length),

    stage: z.enum(EVENT_STAGES).nullish(),

    lang: z.enum(LOCALES).default('zh-CN'),

    /** 给审核员的一句话。**不属于内容**，不会出现在公开页面上。 */
    noteToReviewer: z.string().trim().max(500).nullish(),
  })
  .superRefine((v, ctx) => {
    // 1) 结束时间的两个字段必须成对出现
    const hasLocal = v.endsAtLocal !== null && v.endsAtLocal !== undefined;
    const hasTz = v.endsAtTz !== null && v.endsAtTz !== undefined;
    if (hasLocal !== hasTz) {
      ctx.addIssue({
        code: 'custom',
        path: [hasLocal ? 'endsAtTz' : 'endsAtLocal'],
        message: '结束时间需要同时给出时间和时区',
      });
      return;
    }

    // 2) 整天事件的时间部分必须是 00:00
    if (v.allDay) {
      const bad = (local: string | null | undefined) =>
        typeof local === 'string' && !local.endsWith(`T${ALL_DAY_TIME}`);
      if (bad(v.startsAtLocal)) {
        ctx.addIssue({
          code: 'custom',
          path: ['startsAtLocal'],
          message: '整天事件的开始时间应为 00:00',
        });
      }
      if (bad(v.endsAtLocal)) {
        ctx.addIssue({
          code: 'custom',
          path: ['endsAtLocal'],
          message: '整天事件的结束时间应为 00:00',
        });
      }
    }

    // 3) 结束必须晚于开始。
    //    ⚠️ 比较的是**换算成 UTC 之后**的时刻，不是字符串。
    //       跨时区时字符串比较会给出相反的答案（比如开始是 UTC+8 的 20:00、
    //       结束是 UTC 的 15:00 —— 字符串上 20:00 > 15:00，实际上开始更晚）。
    if (hasLocal && hasTz) {
      const start = wallClockToUtc(v.startsAtLocal, v.startsAtTz);
      const end = wallClockToUtc(v.endsAtLocal as string, v.endsAtTz as string);
      if (start !== null && end !== null && end <= start) {
        ctx.addIssue({
          code: 'custom',
          path: ['endsAtLocal'],
          message: '结束时间必须晚于开始时间',
        });
      }
    }
  });

export type CalendarEventInput = z.infer<typeof CalendarEventInputSchema>;

/**
 * 事件的完整形状（审核详情、作者编辑页用）。
 *
 * `startsAtUtc` 在响应里是有意义的（前端要按它排序、判断是否已结束），
 * 但它**只读** —— 入参里没有它。
 */
export interface CalendarEvent {
  id: string;
  title: string;
  titleEn: string | null;
  descriptionMd: string;
  startsAtLocal: string;
  startsAtTz: string;
  startsAtUtc: number;
  endsAtLocal: string | null;
  endsAtTz: string | null;
  endsAtUtc: number | null;
  allDay: boolean;
  url: string | null;
  location: string | null;
  tags: string[];
  stage: string | null;
  lang: string;
  authorId: string | null;
  authorName: string | null;
  status: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * ⚠️ **"已结束"是算出来的，不是状态字段**。
 *
 * 见迁移 010 里的说明：把它做成状态就需要定时任务去翻，而那任务一旦挂了，
 * 库里会静默地留着一堆"显示为未开始的历史赛事"，不报错也没人看。
 * 派生出来的东西没有这个失败模式。
 */
export function isEventPast(
  event: Pick<CalendarEvent, 'startsAtUtc' | 'endsAtUtc'>,
  now: number,
): boolean {
  // 有结束时间就按结束时间算（一场 3 小时的比赛在它结束前都不算过去）；
  // 没有结束时间就按开始时间算 —— 这是唯一能做的选择，而且它是"保守"的那一侧
  // （宁可让一个已经开始的单时刻事件显示得晚一点，也不要提前把它藏掉）。
  return (event.endsAtUtc ?? event.startsAtUtc) < now;
}

/** 标签在界面上的名字。放这里是给 M4 加标签时一个明确的填空处。 */
export const CALENDAR_TAG_LABELS: Record<string, string> = {
  TOURNAMENT: '赛事',
  COMMUNITY: '社区活动',
  RANKED_MILESTONE: '排位节点',
};

export const EVENT_STAGE_LABELS: Record<string, string> = {
  QUALIFIER: '资格赛',
  ROUND: '正赛轮次',
  QUARTERFINAL: '四分之一决赛',
  SEMIFINAL: '半决赛',
  THIRD_PLACE: '季军赛',
  FINAL: '决赛',
};
