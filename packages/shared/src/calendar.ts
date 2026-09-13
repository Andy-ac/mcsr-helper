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
import {
  CALENDAR_TAGS,
  EVENT_ACCESS,
  EVENT_LEVELS,
  EVENT_SCOPES,
  LOCALES,
  SCOPE_DETAILS,
  SERIES_COLOR_KEYS,
} from './constants';

/** 描述长度上限。和 v1-plan 里其它正文的量级一致。 */
export const EVENT_DESCRIPTION_MAX = 20000;
export const EVENT_TITLE_MAX = 200;
export const EVENT_LOCATION_MAX = 200;

/**
 * 系列名的长度上限。
 *
 * 80 是**按最长的真实名字**定的：`MCSR Ranked Season 5 Playoffs` 这类
 * 带届次后缀的写法，再加一点余量。它比 `EVENT_TITLE_MAX`（200）短得多，
 * 因为系列名是**用来归类与检索**的键，不是一个标题 ——
 * 一个能写 200 字的"系列名"会让归类功能失去意义（每一条自成一系列）。
 */
export const EVENT_SERIES_MAX = 80;

/** 系列 id 的长度上限。与 `newId()` 生成的那一串同量级，够用，也能挡住异常长的输入。 */
export const SERIES_ID_MAX = 64;

/**
 * 系列名的归一化 —— **只做两件事**：`trim` + 把内部连续空白折叠成一个空格。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ (A) 分支（系列实体）下它为什么仍然必须存在
 * ---------------------------------------------------------------------------
 * ③ 已裁决为 **(A) 实体**：`calendar_series.name` 上有 `COLLATE NOCASE UNIQUE`
 * （迁移 013），于是"同一个系列"由数据库来判。但 **NOCASE 只折叠 ASCII 大小写，
 * 不折叠空白** —— `MCSR Ranked` 与 `MCSR  Ranked`（两个空格）在库眼里是
 * 两个不同的名字，会**建出两个系列**，而它们在栏目里并排显示成一模一样的两行。
 * 所以"建系列 / 找系列"之前，一律先过这个函数。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 刻意**不做大小写折叠**
 * ---------------------------------------------------------------------------
 * 大小写交给数据库的 `COLLATE NOCASE`：它让大小写变体命中同一条 UNIQUE，
 * 同时**保住用户第一次输入的显示名**（`MCSR Ranked` 不会被改写成 `mcsr ranked`）。
 * 在应用层再折叠一次就会连显示名一起改小写 —— 那看起来像我们把他的名字打错了。
 *
 * ⚠️ 空串归一成 `null`，不是 `''`：本仓的规矩是"库里只应该有一种没有值的表示"
 *    （见 resources.ts 的 normalizeResourceInput 同名处理）。`''` 和 `null` 并存的话，
 *    每个读取处都要判断两次，而漏判的那次会让一个空系列出现在栏目里。
 *
 * 放在 shared 而不是服务端，是因为**表单也要用它**：用户填完点保存前，
 * 前端要用同一个判据算出"这个名字最后会存成什么"，否则会出现在前端显示
 * `MCSR  Ranked`（两个空格）、存进去变成 `MCSR Ranked` 的错位。
 */
export function normalizeSeriesName(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const collapsed = raw.trim().replace(/\s+/g, ' ');
  return collapsed === '' ? null : collapsed;
}

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

/**
 * 一场赛事的一段时间（2026-09-13，多段时间）。
 *
 * ⚠️ **没有时区**：用户要求"时区放在最上面，只填一次即可"，
 *    所以整条事件共用一个 `startsAtTz`，每一段只有本地时间。
 * ⚠️ `endsAtLocal` 可空（很多赛事只公布开始时间）—— 留空时它在订阅里是一个时间点。
 */
export const EventSlotInputSchema = z.object({
  startsAtLocal: WallClockSchema,
  endsAtLocal: WallClockSchema.nullish(),
});

export type EventSlotInput = z.infer<typeof EventSlotInputSchema>;

/**
 * 一段时间（**读路径**用的形状，UTC 已经算好）。
 *
 * ⚠️ 与 `EventSlotInput` 的区别只有"多了两个 UTC"：入参里没有 UTC（那是服务端算的），
 *    响应里有（前端要按它排序、判断哪一段正在进行）。
 */
export interface EventSlot {
  startsAtLocal: string;
  endsAtLocal: string | null;
  startsAtUtc: number;
  endsAtUtc: number | null;
}

/** 一段时间的个数上限。3 个周末是常态，留一倍余量；再多说明该拆成多个事件。 */
export const EVENT_SLOTS_MAX = 8;

export const CalendarEventInputSchema = z
  .object({
    title: z.string().trim().min(1, { message: '标题不能为空' }).max(EVENT_TITLE_MAX),
    /**
     * 可选的英文标题。**不强制、绝不自动翻译**（Q19）。
     * 英文界面下没有它时**回退显示中文标题**，而不是留空 —— 见 Q19。
     */
    titleEn: z.string().trim().max(EVENT_TITLE_MAX).nullish(),
    descriptionMd: z.string().max(EVENT_DESCRIPTION_MAX).default(''),

    /**
     * ★ 时间：**一个时区 + 一段或多段时间**（2026-09-13 用户定稿）。
     *
     * 用户原话：「不是单纯加一个『具体时间』填写框，而是把『开始时间』
     * 『结束时间』改成允许输入多段不连续的时间（如在下面新增『添加』按钮，
     * 允许再填一组『开始时间』『结束时间』，同时时区放在最上面，只填一次即可）」。
     *
     * ⚠️ 这里说的"只填一次"就是 `startsAtTz` **只有一个** —— 每一段没有自己的时区。
     *    这是刻意的简化，也是本设计的前提：一场赛事通常在一个时区里办。
     *    （真要跨时区办，现在的答案是**拆成两个事件**，而不是让每一段各带时区。）
     * ⚠️ 服务端会按开始时间**升序重排**这些段（界面上允许乱序添加），
     *    所以入参的顺序**不承重**。
     */
    startsAtTz: TimeZoneSchema,
    slots: z
      .array(EventSlotInputSchema)
      .min(1, { message: '至少要有一段时间' })
      .max(EVENT_SLOTS_MAX, { message: `最多 ${String(EVENT_SLOTS_MAX)} 段时间` }),

    allDay: z.boolean().default(false),

    url: z.string().trim().max(500).nullish(),
    location: z.string().trim().max(EVENT_LOCATION_MAX).nullish(),

    /** 多选，至少一个 —— 一个没有任何标签的事件在按标签筛选的界面上等于不可见。 */
    tags: z
      .array(z.enum(CALENDAR_TAGS))
      .min(1, { message: '至少选一个标签' })
      .max(CALENDAR_TAGS.length),

    /**
     * 专业程度 / 参与范围 / 参赛门槛 —— **三维都可空**，见 constants.ts。
     *
     * ⚠️ 它们都是**单选**，不是数组（`scopeDetail` 除外）。理由：一场比赛的
     *    专业程度和参与范围各自只有一个答案；做成多选以后筛选就变成"或"，
     *    而用户想的是"且"。
     * ⚠️ **`stage`（轮次）在 2026-09-13 被去掉了**（用户要求）：它只是一个标签、
     *    不做父子层级，而实际录数据时"横跨一周的连续赛事"根本填不了它。
     *    数据库那一列**保留但不再读写**（与"已发布的迁移不许改"同一条纪律）。
     */
    level: z.enum(EVENT_LEVELS).nullish(),
    scope: z.enum(EVENT_SCOPES).nullish(),
    access: z.enum(EVENT_ACCESS).nullish(),

    /**
     * 「参与范围」的明细：选到「大洲」时填大洲代码、选到「国家」时填国家代码。
     *
     * ⚠️ 它是**多选**（用户举的例子就是"亚洲&大洋洲"），而且筛选语义是
     *    **命中任一即展示**（OR）—— 与 `tags` 的多选语义一致。
     * ⚠️ 与 `scope` 的联动**不在 schema 里强制**（选 GLOBAL 却填了明细不会报错）：
     *    那只是一条无意义的冗余，而不是一条会让人看错的数据。强制它要多一套
     *    跨字段规则与错误码，而收益是"少一行垃圾"。
     *    ⚠️ 但**界面**会在切换 `scope` 时把不匹配的明细清掉（那是体验，不是校验）。
     */
    scopeDetail: z.array(z.enum(SCOPE_DETAILS)).max(SCOPE_DETAILS.length).default([]),

    /**
     * 系列（③）—— 填**系列的 id**，不是名字。
     *
     * ⚠️ 事件行上**只有 id 这一个指针**，名字永远从 `calendar_series` 取
     *    （读路径 LEFT JOIN 出 `seriesName`）。在事件上再冗余一份名字是
     *    "同一件事存两份"的经典形态：系列一改名，老事件上留着旧名字，
     *    而**两边都不会报错**，只是显示不一致。
     *
     * ⚠️ 它**不进筛选栏**（不是第五个筛选维度）：筛选栏那些都是**封闭枚举**，
     *    而系列的取值集合是开放的（可能有几十个）—— 混进去会让 chip 栏排不下，
     *    也会打破"筛选栏 = 4 个维度"这条被 `check:grid` 守着的规则。
     *    系列筛选走 `?seriesId=<id>` 这个独立查询参数。
     *
     * ⚠️ 可空，而且**绝大多数事件都会是 null** —— 不属于任何系列是常态，不是"还没填"。
     */
    seriesId: z.string().trim().max(SERIES_ID_MAX).nullish(),

    lang: z.enum(LOCALES).default('zh-CN'),

    /** 给审核员的一句话。**不属于内容**，不会出现在公开页面上。 */
    noteToReviewer: z.string().trim().max(500).nullish(),
  })
  .superRefine((v, ctx) => {
    /*
     * 逐段校验（2026-09-13 起是**循环**，不再是"检查那一对"）。
     *
     * ⚠️ 这里原来写的是三条针对 `startsAtLocal`/`endsAtLocal` 的规则；
     *    多段之后它们必须逐段跑，否则"第 2 段的结束早于开始"会一路放进库里 ——
     *    而它在界面上只表现为"日历上那一条看起来比另一条矮一截"。
     */
    v.slots.forEach((slot, i) => {
      // ① 整天事件的时间部分必须是 00:00
      if (v.allDay) {
        const bad = (local: string | null | undefined) =>
          typeof local === 'string' && !local.endsWith(`T${ALL_DAY_TIME}`);
        if (bad(slot.startsAtLocal)) {
          ctx.addIssue({
            code: 'custom',
            path: ['slots', i, 'startsAtLocal'],
            message: '整天事件的开始时间应为 00:00',
          });
        }
        if (bad(slot.endsAtLocal)) {
          ctx.addIssue({
            code: 'custom',
            path: ['slots', i, 'endsAtLocal'],
            message: '整天事件的结束时间应为 00:00',
          });
        }
      }

      // ② 结束必须晚于开始。
      //    ⚠️ 比较的是**换算成 UTC 之后**的时刻，不是字符串：
      //       跨时区时字符串比较会给出相反的答案。
      if (slot.endsAtLocal !== null && slot.endsAtLocal !== undefined) {
        const start = wallClockToUtc(slot.startsAtLocal, v.startsAtTz);
        const end = wallClockToUtc(slot.endsAtLocal, v.startsAtTz);
        if (start !== null && end !== null && end <= start) {
          ctx.addIssue({
            code: 'custom',
            path: ['slots', i, 'endsAtLocal'],
            message: '结束时间必须晚于开始时间',
          });
        }
      }
    });
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

  /**
   * ★ 这场赛事的**全部时间段**（2026-09-13 起）。
   *
   * ⚠️ 下面的 `startsAt*` / `endsAt*` 是它**派生出来的包络**（最早那段的开始 /
   *    最晚那段的结束），保留它们是因为**排序、索引、系列计数、ICS 的
   *    "还没结束"筛选**全都建在那一对列上 —— 一条都不需要改。
   *    ⇒ **要判断"这场什么时候打"就读 `slots`；要排序/算时间跨度就读包络。**
   *    ⚠️ 两者不一致 = 写入路径漏了重算包络（`toColumns` 是唯一的写入点）。
   */
  slots: EventSlot[];

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
  /**
   * 轮次。**2026-09-13 起不再读写**（用户要求去掉），保留这一格只为兼容旧快照。
   * ⚠️ 新写入的事件它**永远是 null**；别照着它写新逻辑。
   */
  stage: string | null;
  /** 专业程度 / 参与范围 / 参赛门槛。**都可空** —— 排位节点没有这几维。 */
  level: string | null;
  scope: string | null;
  access: string | null;
  /** 参与范围的明细（大洲或国家代码，多选）。命中任一即算匹配。 */
  scopeDetail: string[];
  /**
   * 系列（③）。**可空** —— 绝大多数赛事不属于任何系列，这不是"还没填"。
   *
   * ⚠️ `seriesId` 是**事件行上的那一列**；`seriesName` 是**读的时候 JOIN 出来的**，
   *    不落库（理由见入参 schema 里 `seriesId` 的说明）。
   *
   * ⚠️ 加这两个字段时有三处必须同步（漏一处**没有编译错误**，因为快照 payload 是 JSON）：
   *    `CalendarEventInputSchema` / `EventPayload` / `toColumns` + `payloadToColumns`。
   *    加在界面显示层的那几处同理 —— 日历上"某个写死的字段清单"漏掉它，
   *    表现是"填了系列但界面上看不到"。
   */
  seriesId: string | null;
  /** 系列显示名。由列表/详情查询 LEFT JOIN `calendar_series` 得到；**不在事件表里**。 */
  seriesName: string | null;
  /**
   * 系列的颜色（调色板的**键**，如 `'red'`；没上色 / 不属于任何系列时是 `null`）。
   *
   * ⚠️ 和 `seriesName` 一样是**读的时候 JOIN 出来的**，不落库 —— 理由同上一段的
   *    "同一件事存两份"：owner 改一次颜色，事件行上留着的旧颜色不会报错，
   *    只会在日历上显示成上一版的颜色。
   * ⚠️ 它传的是**键**不是色值：键 → 色值由 `constants.ts` 的 `seriesColorValue()`
   *    翻，而那个函数是"两种主题下都看得见"这条论证的唯一落点。
   *    这里存 `#d9534f` 的话，主题一调，库里就全是过期的色值。
   */
  seriesColor: string | null;
  lang: string;
  authorId: string | null;
  authorName: string | null;
  status: string;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// 系列活动（③）：系列实体与它的对外形状
// ---------------------------------------------------------------------------

/**
 * 一个系列活动。
 *
 * ⚠️ `count` / `pastCount` / `nextStartsAtUtc` 都是**算出来的**，不是系列表上的列 ——
 *    它们描述的是"这个系列下面的事件现在长什么样"，而那是会随时间变的量，
 *    存起来就得有定时任务去翻（本仓对派生数据的立场见 `isEventPast` 的注释）。
 *
 * ⚠️ 计数**只数已发布的事件**（`status = 'published'`）：把已下架/待审的场次算进来，
 *    会让栏目里的数字与点进去看到的列表对不上，而那种不一致**不会报错**。
 */
export const CalendarSeriesSchema = z.object({
  id: z.string().min(1).max(SERIES_ID_MAX),
  /** 显示名。大小写唯一性由 `calendar_series.name` 的 `COLLATE NOCASE UNIQUE` 保证。 */
  name: z.string().min(1).max(EVENT_SERIES_MAX),
  /**
   * 系列颜色 —— 存**调色板的键**（`red` / `teal` …），不是色值。
   *
   * ⚠️ 为什么不是色值：色值要按主题推导（白天/黑夜两套），存在库里的话
   *    owner 选一个 `#ffffff` 就会在白天主题下把那一行变成隐形；
   *    而存键之后"哪个颜色在哪个主题下长什么样"由我们一处决定。
   * ⚠️ `null` = 没上色（界面走"无系列"那一档：白色 + 细描边）。
   */
  color: z.string().max(24).nullable(),
  /** 未结束的场次数 */
  count: z.number().int().nonnegative(),
  /** 已结束的场次数 */
  pastCount: z.number().int().nonnegative(),
  /** 最近一场未结束赛事的开始时间（UTC 毫秒）；没有未结束场次时为 null。 */
  nextStartsAtUtc: z.number().int().nonnegative().nullable(),
  /**
   * 建系列的人。**可空** —— 与 `CalendarEvent.authorId` 同一个理由：
   * 删账号不删内容（`audit_log` 与内容行都没有外键），所以这里可能指向一个
   * 已经不存在的用户，读的时候要按"没有作者"处理，而不是当成异常。
   */
  createdBy: z.string().nullable(),
  createdAt: z.number().int().nonnegative(),
});
export type CalendarSeries = z.infer<typeof CalendarSeriesSchema>;

/**
 * 系列列表的响应（`GET /api/calendar/series`）。
 *
 * ⚠️ `total` 是**系列数**，不是事件数。同一屏里同时出现"系列数"与"场次数"两个数字时，
 *    把它们弄混是最容易发生的一种错（而表现只是"数字看起来很大"，不会报错）。
 */
export const CalendarSeriesListSchema = z.object({
  items: z.array(CalendarSeriesSchema),
  total: z.number().int().nonnegative(),
});
export type CalendarSeriesList = z.infer<typeof CalendarSeriesListSchema>;

/**
 * 新建 / 改名一个系列（`POST` / `PATCH /api/calendar/series`）。
 *
 * ⚠️ 只有 `name` 一个字段：本轮**不做**系列描述、封面、单系列订阅（见 spec §4.7），
 *    因此不该先造出"填了但没人看"的字段。
 *
 * ⚠️ 写入前服务端必须过 `normalizeSeriesName`（折叠空白）—— `COLLATE NOCASE`
 *    只折叠大小写、**不折叠空白**，不过一遍会让 `MCSR Ranked` 与 `MCSR  Ranked`
 *    各建一个系列。
 */
export const CalendarSeriesInputSchema = z.object({
  name: z.string().trim().min(1, { message: '需要系列名' }).max(EVENT_SERIES_MAX),
});
export type CalendarSeriesInput = z.infer<typeof CalendarSeriesInputSchema>;

/**
 * 给一个系列上色 / 去掉颜色（`PUT /api/calendar/series/:id/color`，需求⑤）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️⚠️ 传**调色板的键**（`'red'` / `'teal'` …），**不是色值**（`#d9534f`）
 * ---------------------------------------------------------------------------
 * 色值与主题绑定：同一条线在白天主题和黑夜主题下要取不同的值才看得见，
 * 而"哪个键在哪个主题下长什么样"由 `constants.ts` 一处决定
 * （`SERIES_COLORS` + `seriesColorValue()`）。让客户端提交色值就等于把那份决定
 * 搬进库里：用户今天选的 `#d9534f` 会一直待在库里，主题一调，界面上就会出现
 * **两种红**，而两边都不报错。
 *
 * ⚠️ 枚举来自 `SERIES_COLOR_KEYS`（从 `SERIES_COLORS` 推导），不是手抄的字符串表 ——
 *    手抄的那份会在加新颜色时漂移，表现是"加了个色块，点了却 400"。
 * ⚠️ `null` 是**合法输入**，含义是「不上色」（界面走"无系列"那一档：白色 + 描边）。
 *    所以这里用 `.nullable()` 而**不是** `.optional()` —— 两者在服务端的表现不同：
 *    缺席（`{}`）应当被拒（客户端漏传字段是 bug），而 `{ color: null }` 是明确的指令。
 *    这与 `seriesId` / `level` 那几处用 `.nullish()` 不同：那些字段"不填"和"填 null"
 *    是同一个意思（没这个值），颜色这里"没传"和"调成不上色"不是。
 */
export const CalendarSeriesColorInputSchema = z.object({
  color: z.enum(SERIES_COLOR_KEYS).nullable(),
});
export type CalendarSeriesColorInput = z.infer<typeof CalendarSeriesColorInputSchema>;

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

/*
 * ⚠️ `EVENT_LEVEL_LABELS` / `EVENT_SCOPE_LABELS` **不存在，是故意的**。
 *
 * 上面两个映射里写死的是中文，那是历史遗留；而**新增**的两维从一开始就走 i18n
 * 词条（`calendar.level.*` / `calendar.scope.*`）。理由见 `CalendarReviewView`
 * 文件头：写死中文的映射在英文界面下会冒出一句中文，而这类问题只在切语言时
 * 才出现，正常路径的测试永远看不到。
 *
 * 那为什么不顺手把上面两个也搬走？——因为它们是**已上线**的中文界面唯一在用的
 * 文案来源，搬它们要同时改三处调用点（审核视图、日历卡片、ICS 之外的展示），
 * 属于另一件事。留一条注释说明"新的别学它"，比混在一起改安全。
 */
