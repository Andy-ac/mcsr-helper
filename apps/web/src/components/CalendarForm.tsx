import {
  CALENDAR_TAGS,
  // 「参与范围」明细的两份名单（2026-09-13）。⚠️ 词条是动态拼的（`calendar.continent.ASIA`），
  // i18n 的静态守卫扫不到它们 —— 漏一条词条的表现是界面上显示成代码本身（`BR`），不会报错。
  CONTINENTS,
  COUNTRIES,
  EVENT_ACCESS,
  EVENT_LEVELS,
  EVENT_SCOPES,
  LOCALES,
} from '@mcsr/shared';
import {
  ALL_DAY_TIME,
  type CalendarEvent,
  type CalendarEventInput,
  CalendarEventInputSchema,
  type CalendarSeries,
  EVENT_DESCRIPTION_MAX,
  EVENT_LOCATION_MAX,
  EVENT_SLOTS_MAX,
  EVENT_TITLE_MAX,
  // t17 验收第 6 条：系列名写入前必须过它（折叠空白；`NOCASE` 只折大小写）
  normalizeSeriesName,
} from '@mcsr/shared/calendar';
import { isValidTimeZone, wallClockToUtc } from '@mcsr/shared/calendar-time';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from '@/components/Form';
import { Markdown } from '@/components/Markdown';
import { ApiError, createCalendarSeries, fetchCalendarSeries } from '@/lib/api';
import { useApiErrorText } from '@/lib/auth';
import {
  CALENDAR_NOTE_MAX,
  CALENDAR_TZ_SUGGESTIONS,
  VIEWER_TZ,
  zoneOffsetLabel,
} from '@/lib/calendarFormat';
import { useCan } from '@/lib/capabilities';

/**
 * 日历事件的提交表单。**新建和编辑共用一份**。
 *
 * 理由和 ResourceForm 完全一样：两者的字段相同，差别只有"提交到哪"。
 * 抄成两份之后，加一个字段就要记得改两处，而漏改的后果是
 * "编辑时填的字段被静默丢掉" —— 用户以为保存成功了，刷新之后那个字段又空了。
 *
 * ---------------------------------------------------------------------------
 * 三道这一版特有的关，都不是装饰
 * ---------------------------------------------------------------------------
 *   1. **用 shared 的 schema 校验，但不直接显示它给的中文**（见下面 issueText）。
 *      schema 的消息是中文写死的，英文界面下会突然冒出一句中文 ——
 *      而这类问题只在**出错时**出现，正常路径永远看不到。
 *
 *   2. **时区名要能当场验真**。`Asia/Shangai`（少一个 h）不是合法时区，
 *      但它也没长成一眼假的样子。填错的后果是整场赛事在所有订阅者那里
 *      偏移几个小时，而且看起来完全正常。所以边打边验，并显示它此刻的偏移。
 *
 *   3. **结束时间必须晚于开始时间，判据是换算成 UTC 之后的时刻**，不是字符串。
 *      跨时区时字符串比较会给出相反的答案（开始是 UTC+8 的 20:00、结束是
 *      UTC 的 15:00 —— 字符串上 20:00 > 15:00，实际上开始更晚）。
 *      这里直接调 shared 的 `wallClockToUtc`，和 schema 用的是同一个函数。
 *      ⚠️ 2026-09-13 起它是**逐段**判的（一场赛事可以有多段不连续的时间），
 *      所以校验结果也逐段落回**那一段的那一行**，而不是表单顶上的一句
 *      "有字段没通过校验" —— 8 段里让用户自己找是哪一段是最糟的体验。
 */

/**
 * 表单里的**一段**比赛时间（2026-09-13，多段）。
 *
 * ⚠️ 与 shared 的 `EventSlotInput` **同形但不同义**：这里的空串是"还没填"，
 *    而 schema 那边 `startsAtLocal` 是必填的墙钟串、`endsAtLocal` 可空。
 *    空串 → null 的转换**只在 `calendarEventInputOf` 一处**做 —— 散在多处就会出现
 *    两个地方对"没填"的理解不一致，而两边都不报错。
 * ⚠️ **没有时区**：用户要求「时区放在最上面，只填一次即可」，
 *    所以整条事件共用草稿上的那一个 `startsAtTz`，每一段只有本地时间。
 */
export interface CalendarSlotDraft {
  /** 'YYYY-MM-DDTHH:mm'，或空串（还没填） */
  startsAtLocal: string;
  /** 同上；空串表示"不填结束时间"（它在订阅里是一个时间点） */
  endsAtLocal: string;
}

/** 一段空白时间。新建那一段时用它 —— 免得在 JSX 里手写一个字面量对象。 */
export function emptyCalendarSlot(): CalendarSlotDraft {
  return { startsAtLocal: '', endsAtLocal: '' };
}

/** 表单内部状态。提交时才转成 CalendarEventInput。 */
export interface CalendarDraft {
  title: string;
  titleEn: string;
  descriptionMd: string;
  /**
   * ★ **时间 = 一个时区 + 一段或多段时间**（2026-09-13，用户第 ④ 条需求）。
   *
   * ⚠️ 它替代的是原来那一对 `startsAtLocal` / `endsAtLocal`（外加 `endsAtTz`）：
   *    用户原话是「把『开始时间』『结束时间』改成允许输入多段不连续的时间
   *    （如在下面新增『添加』按钮，允许再填一组），同时时区放在最上面，只填一次即可」。
   * ⚠️ 段**不在这里排序**：服务端写入时会按开始时间升序重排（schema 里写着
   *    "入参的顺序**不承重**"），界面保持用户输入的顺序 —— 理由见下面渲染处的注释。
   */
  slots: CalendarSlotDraft[];
  startsAtTz: string;
  allDay: boolean;
  url: string;
  location: string;
  tags: string[];
  /**
   * 专业程度 / 参与范围 / 参赛门槛（011 + 2026-09-13）。空串 = 不填。
   *
   * ⚠️ 这几维都用**空串**表示"没填"，而不是 `null` —— 它们是 `<select>`
   *    的值，而 DOM 里"没选"就是空串。真正转成 `null` 发生在提交那一步
   *    （`draft.level || null`），只在一个地方做，见 `calendarEventInputOf`。
   * ⚠️ **`stage`（轮次）在 2026-09-13 被去掉了**（用户第 ⑥ 条要求），
   *    所以这里没有它 —— 而它当年在这里的那一格正是"多加一个维度"这条路上
   *    最省事的那一步，别照着旧版本把它加回来。
   */
  level: string;
  scope: string;
  access: string;
  /**
   * 「参与范围」的明细：`scope` 选到「大洲」时放大洲代码，选到「国家」时放国家代码。
   *
   * ⚠️ 它是**多选**（用户举的例子就是"亚洲&大洋洲"），语义与 `tags` 一致：
   *    命中任一即算匹配。做成单选的话，一场跨两个大洲的赛事只能在两条记录之间搬。
   * ⚠️ 切换 `scope` 时界面会清掉**不匹配的**明细（见 `setScope`）——
   *    那是**体验**不是校验：schema 不强制这条（它只是一条无意义的冗余），
   *    但界面上留着上一半的取值会让人以为选上了。
   */
  scopeDetail: string[];
  lang: string;
  /**
   * 系列活动（③）。`''` = **不归到任何系列**（绝大多数赛事如此，这不是"还没填"）。
   *
   * ⚠️ 与 `level` / `scope` / `access` 同一个约定：`<select>` 的"没选"就是空串，
   *    真正转成 `null` 只发生在 `calendarEventInputOf()` 一处。
   */
  seriesId: string;
  /**
   * 当前系列的**显示名**。它只服务界面（下拉框里那一项要显示名字），
   * **不参与提交** —— 名字由服务端从 `calendar_series` JOIN 出来
   * （见 `shared/calendar.ts` 的 `seriesName` 说明）。
   *
   * ⚠️ 留着它的理由是一个**会说谎的界面**：系列列表还没到（或请求失败）时，
   *    `<select value="s9">` 在没有任何 option 命中时显示的是**第一个** option，
   *    而草稿里仍然是 `s9` —— 用户看到"不填"，保存后却还挂着原来那个系列。
   */
  seriesName: string;
  noteToReviewer: string;
}

export function emptyCalendarDraft(): CalendarDraft {
  return {
    title: '',
    titleEn: '',
    descriptionMd: '',
    /*
     * ★ 起手就是**一段空白时间**，而不是空数组。
     *
     * ⚠️ 空数组会让表单渲染成"没有任何时间输入框、下面却挂着一句『至少要有一段时间』"
     *    —— 用户看到一句抱怨，却看不到那个需要改的东西（要改的东西是一个按钮，
     *    而按钮在抱怨下面）。schema 的 `.min(1)` 是**兜底**，不是起手状态。
     */
    slots: [emptyCalendarSlot()],
    /*
     * ⚠️ 默认值必须是**用户自己的时区**，不能是 'UTC' 或 'Asia/Shanghai'。
     *
     * 绝大多数录入者填的是自己所在时区的那场比赛，而 UTC 是一个会静默出错
     * 的默认值：填表的人不会去改一个看起来已经填好的字段，于是每场赛事都偏移
     * 几个小时 —— 而偏移几个小时的赛事时间看起来完全正常。
     */
    startsAtTz: VIEWER_TZ,
    allDay: false,
    url: '',
    location: '',
    tags: [],
    level: '',
    scope: '',
    access: '',
    scopeDetail: [],
    lang: LOCALES[0],
    // 新建时**默认不属于任何系列** —— 系列要人去选，默认挂上一个就是在替用户猜
    seriesId: '',
    seriesName: '',
    noteToReviewer: '',
  };
}

/** 已有事件 → 草稿。编辑页用它预填。 */
export function draftFromEvent(event: CalendarEvent): CalendarDraft {
  return {
    title: event.title,
    titleEn: event.titleEn ?? '',
    descriptionMd: event.descriptionMd,
    /*
     * ★ `event.slots` **直接映射**成草稿的段（多段模型下没有"另一个真相"）。
     *
     * ⚠️ 兜底那一条分支：服务端读旧行时会用包络**合成一段**（`slotsOfRow`，
     *    017 之前的行没有 `time_slots`），所以正常情况下 `slots` 不会是空的。
     *    留着它是因为"空数组"在这里的后果特别难查：表单会渲染出**零行**时间输入框、
     *    却挂着一条"至少要有一段时间" —— 用户既看不到要改什么，也加不出东西来。
     */
    slots:
      event.slots.length > 0
        ? event.slots.map((s) => ({
            startsAtLocal: s.startsAtLocal,
            endsAtLocal: s.endsAtLocal ?? '',
          }))
        : [{ startsAtLocal: event.startsAtLocal, endsAtLocal: event.endsAtLocal ?? '' }],
    startsAtTz: event.startsAtTz,
    allDay: event.allDay,
    url: event.url ?? '',
    location: event.location ?? '',
    tags: event.tags,
    level: event.level ?? '',
    scope: event.scope ?? '',
    access: event.access ?? '',
    // ⚠️ 复制一份（`[...]`）：草稿会被就地改（切换 scope 时过滤明细），
    // 直接共用事件对象上那个数组会让"取消编辑"也改到刚取回来的那一条。
    scopeDetail: [...event.scopeDetail],
    lang: event.lang,
    // ③：编辑时**必须把系列带进来**，否则"改一个无关字段"会静默把系列丢掉
    seriesId: event.seriesId ?? '',
    seriesName: event.seriesName ?? '',
    // ⚠️ 「给审核员的话」**不在事件的字段里**（它不属于内容，服务端也不存它）。
    //     所以编辑时它总是从空白开始 —— 复现上一轮那句话反而会让人以为
    //     那是内容的一部分。
    noteToReviewer: '',
  };
}

// ---------------------------------------------------------------------------
// 墙钟字符串的切分
// ---------------------------------------------------------------------------

/** 'YYYY-MM-DDTHH:mm' → 'HH:mm'；空或格式不对时返回空串。 */
function timeOf(local: string): string {
  return /T(\d{2}:\d{2})/.exec(local)?.[1] ?? '';
}

/** 'YYYY-MM-DD' → 'HH:mm' 拼回完整的墙钟串。输入为空时返回空串。 */
function withTime(value: string, hhmm: string): string {
  if (!value) return '';
  return `${value.slice(0, 10)}T${hhmm}`;
}

/** 'YYYY-MM-DDTHH:mm' → 'YYYY-MM-DD'（给 `<input type="date">` 用）。 */
function dateOf(local: string): string {
  return local ? local.slice(0, 10) : '';
}

// ---------------------------------------------------------------------------
// 校验错误 → 文案
// ---------------------------------------------------------------------------

/** Zod issue 的结构子集。**不 import zod** —— 前端不该为了一个类型多一个依赖。 */
interface Issue {
  code?: string;
  path: readonly PropertyKey[];
  message: string;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * 把一个 schema 校验问题翻译成当前语言的文案，并指出该挂到哪个控件上。
 *
 * ⚠️ **不读 `issue.message`**。schema 里的消息是中文写死的
 *    （'结束时间必须晚于开始时间'），直接显示它会在英文界面上冒出一句中文。
 *    这里按 `(字段, code)` 分派，和 lib/auth.tsx 的 `fieldIssueText` 是同一套做法。
 *
 * ⚠️ 有两处按 `code` 分不出是哪条规则（同一个字段上挂着不同的 custom issue），
 *    这时用**和 schema 相同的判据**再算一次来决定文案 —— 而不是去匹配消息文本。
 *    匹配消息文本是这个项目已经证伪过一次的写法：文案一改，分支静默失效。
 *
 * ⚠️ 返回的 `key` 是**错误要挂到的那个控件的路径**，不是字段名：
 *    逐段的错误路径是 `['slots', i, 'startsAtLocal']`，拼成 `slots.0.startsAtLocal`，
 *    由那一行自己去 `fieldError()` 找它。若把它压成 `'slots'`，
 *    所有段的错误会挤在段列表下面一句话里（"时间填错了"），
 *    而用户要在 8 段里自己找是哪一段 —— 那正是多段最需要避免的一种体验。
 */
function issueText(
  issue: Issue,
  draft: CalendarDraft,
  t: Translate,
): { key: string; text: string } {
  const path = issue.path.map((p) => String(p));
  const field = path[0] ?? '';
  // 长度类的问题在 Zod 里统一是 too_big，字段名决定文案
  const tooBig = issue.code === 'too_big';

  switch (field) {
    case 'title':
      return {
        key: field,
        text: tooBig
          ? t('calendar.errTitleTooLong', { max: EVENT_TITLE_MAX })
          : t('calendar.errTitleRequired'),
      };
    case 'titleEn':
      return { key: field, text: t('calendar.errTitleTooLong', { max: EVENT_TITLE_MAX }) };
    case 'descriptionMd':
      return { key: field, text: t('calendar.errDescTooLong', { max: EVENT_DESCRIPTION_MAX }) };
    case 'location':
      return { key: field, text: t('calendar.errLocationTooLong', { max: EVENT_LOCATION_MAX }) };
    case 'url':
      return { key: field, text: t('calendar.errUrlTooLong') };
    case 'noteToReviewer':
      return { key: field, text: t('calendar.errNoteTooLong', { max: CALENDAR_NOTE_MAX }) };
    case 'tags':
      return { key: field, text: t('calendar.errTagsMin') };
    case 'scopeDetail':
      // 唯一可能的失败是"选得比名单还多"，那不是用户能做的事（名单本身有上限）。
      // 仍然给它一条话说：`errGeneric` 至少指向了正确的一格。
      return { key: field, text: t('calendar.errGeneric') };

    case 'startsAtTz': {
      if (tooBig) return { key: field, text: t('calendar.errTzTooLong') };
      /*
       * ⚠️ 空值必须先判：`isValidTimeZone('')` 是 false，不先判就会把
       *    "时区没填"说成"这个时区名无效" —— 而用户根本还没打任何东西。
       *    （2026-09-13 之前这里还多一条"结束时间需要同时给出时间和时区"，
       *     `endsAtTz` 那个字段随多段模型一起没了。）
       */
      const value = draft.startsAtTz.trim();
      if (value === '') return { key: field, text: t('calendar.errTzRequired') };
      return { key: field, text: t('calendar.errInvalidTz') };
    }

    case 'slots': {
      /*
       * ★ 这一支要处理**两种形状**，而且它们不是同一类错误（判据是路径的深度）：
       *
       *   · 只有一段路径（`['slots']`）—— 数组本身的 min/max，
       *     挂在**段列表整体**下面（"至少要有一段时间"/"最多 8 段时间"）。
       *   · 三段路径（`['slots', i, 'startsAtLocal'|'endsAtLocal']`）—— 逐段的校验，
       *     必须落回**第 i 段的那一行**（见 shared 的 superRefine 里那两条 addIssue）。
       */
      if (path.length === 1) {
        return {
          key: 'slots',
          text: tooBig
            ? t('calendar.errSlotsMax', { max: EVENT_SLOTS_MAX })
            : t('calendar.errSlotsMin'),
        };
      }

      // 路径原样拼成 key：`slots.0.endsAtLocal` —— 渲染处按同一把 key 找它
      const key = path.join('.');
      const which = path[2];
      const slot = draft.slots[Number(path[1])];
      const value =
        which === 'startsAtLocal' ? (slot?.startsAtLocal ?? '') : (slot?.endsAtLocal ?? '');

      /*
       * 空值：只有**开始时间是必填的**（结束留空 = 不填，schema 那边是 `.nullish()`）。
       * 空值有两种来路，而两种都不该说"格式不对"：
       *   · `invalid_type` —— 这个 key 根本没给
       *   · 空串 —— 表单原样传字符串，用户还没填
       * 对一个空输入框说"格式应为 2026-08-30T20:00"，用户得自己先猜出"原来它是必填的"。
       */
      if (which === 'startsAtLocal' && value === '') {
        return { key, text: t('calendar.errSlotStartRequired') };
      }
      // 不是 custom 就只剩正则那一条（格式不对）
      if (issue.code !== 'custom') return { key, text: t('calendar.errWallClock') };
      /*
       * custom 有两类：整天事件的时间必须是 00:00，以及"结束必须晚于开始"。
       * 判据用的是 schema 里那句话本身（`endsWith('T00:00')`）。
       *
       * ⚠️ 从这个表单里走不到第一条：勾了「整天」之后时间输入框会换成
       *    日期选择器，时间部分在结构上就只能是 00:00。留着它是为了让
       *    这个映射对**任何**来源的 payload 都成立，而不是只对当前这份 UI 成立。
       */
      if (draft.allDay && !value.endsWith(`T${ALL_DAY_TIME}`)) {
        return { key, text: t('calendar.errAllDayTime') };
      }
      return {
        key,
        text: draft.allDay ? t('calendar.errAllDayEndOrder') : t('calendar.errEndBeforeStart'),
      };
    }

    default:
      return { key: field || 'form', text: t('calendar.errGeneric') };
  }
}

/**
 * 「参与范围明细」的候选项 —— **跟着 `scope` 走**。
 *
 * ⚠️ 两份名单共用同一个字段 `scopeDetail`，但它们**不重叠**
 *    （`SCOPE_DETAILS = 大洲 ∪ 国家`）。所以切换 scope 时必须清掉不匹配的那些，
 *    否则保存下来的是一个"选了大洲却带着国家代码"的明细 —— 筛选时它匹配不上
 *    任何东西，而界面上看起来是选过的。
 * ⚠️ `GLOBAL`（以及"不填"）返回**空数组**：那两档没有明细可选，
 *    渲染处也正因此整块不渲染。
 */
export function scopeDetailOptions(scope: string): readonly string[] {
  if (scope === 'CONTINENT') return CONTINENTS;
  if (scope === 'COUNTRY') return COUNTRIES;
  return [];
}

/**
 * 切换 `scope` 之后**还留得下**的那些明细。
 *
 * ---------------------------------------------------------------------------
 * 为什么单独抽成一个导出的纯函数（而不是写在 `setScope` 的闭包里）
 * ---------------------------------------------------------------------------
 * 这条规则是"**体验**而不是校验"（schema 刻意不强制，见 `scopeDetail` 的注释），
 * 也就是说**服务端永远不会替我们兜底**：清错了，库里就真的存着一条无意义的冗余，
 * 而界面上看不出任何异常。闭包里的那条 `filter` 没有任何验证点 ——
 * 纯 node SSR 不跑交互，`renderToStaticMarkup` 也发不出 change 事件。
 * ⇒ 抽成纯函数，让自检脚本能直接驱动它。这和 `calendarEventInputOf` 是同一条理由
 *   （见它的头注释），也同样是**生产路径真的会调它**（`setScope` 就是用这个）。
 *
 * ⚠️ 顺序按 `current` 原样保留，不按名单顺序重排：用户勾选的先后不重要，
 *    但"我勾的那个还在不在"必须一眼看得出来。
 */
export function keepScopeDetail(scope: string, current: readonly string[]): string[] {
  const keep = scopeDetailOptions(scope);
  return current.filter((code) => keep.includes(code));
}

// ---------------------------------------------------------------------------
// 表单
// ---------------------------------------------------------------------------

export function CalendarForm({
  initial,
  actionLabel,
  busyLabel,
  busy,
  onSubmit,
  secondaryAction,
}: {
  initial: CalendarDraft;
  actionLabel: string;
  busyLabel: string;
  busy: boolean;
  onSubmit: (input: CalendarEventInput) => void;
  /**
   * 「直接保存 / 直接发布」（需求②）—— **只有有 `content.author` 的页面会传**。
   *
   * ⚠️ 与 `ResourceForm` 的 `secondaryAction` **同形**：调用方要么整块给、要么整块不给，
   *    不会出现"传了 label 忘了传 onSubmit"这种半截状态。
   * ⚠️ 它**不判断能力**：表单里写一份"谁是编辑"就是第二份规则
   *    （见 `permissions.ts` 的头注释）。传不传由页面按 `useCan('content.author')` 决定。
   */
  secondaryAction?: {
    label: string;
    busyLabel: string;
    onSubmit: (input: CalendarEventInput) => void;
  };
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<CalendarDraft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState(false);

  /*
   * ---------------------------------------------------------------------------
   * 系列活动（③）：一份列表 + 一个"新建"入口
   * ---------------------------------------------------------------------------
   * · **从已有系列里选**对所有人开放（系列是公开数据，见 spec §9-5）；
   *   只有**新建**限 `content.author`（D3.5）。
   * · ⚠️ 能力判断走 `useCan` —— 它是权限矩阵的**同一份来源**，页面/组件里不写
   *   "谁是编辑"（见 permissions.ts 的头注释）。
   *   ⚠️ 刻意**不**用"调用方传没传 `secondaryAction`"来判断：今天两者恰好同一档，
   *      但把它们绑在一起是一条隐藏耦合 —— 哪天直编按钮按类型开关，
   *      系列入口会跟着一起消失，而且**不会有任何报错**。
   * · ⚠️ **列表拿不到不算错误**：它只是一个可选的辅助列表，表单不该因此变红。
   *      那时仍然可用的是"当前这一条已经挂着的那个系列"（见下面的 seriesOptions）。
   */
  const canAuthor = useCan('content.author');
  const errorText = useApiErrorText();
  const [seriesList, setSeriesList] = useState<CalendarSeries[]>([]);
  const [seriesCreating, setSeriesCreating] = useState(false);
  const [seriesName, setSeriesName] = useState('');
  const [seriesBusy, setSeriesBusy] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchCalendarSeries(controller.signal)
      .then((res) => setSeriesList(res.items))
      .catch(() => {
        // 静默：见上面那一条。排序也**不在这里做** —— 服务端已经排好（api.ts 的注释）。
      });
    return () => controller.abort();
  }, []);

  /*
   * 「整天」来回切换时要还原用户原来填的钟点。
   *
   * ⚠️ 这就是需求里那句"取消勾选时**不要**silently 留着 00:00"。
   *    没有这个 ref 的话，用户填了 20:00 → 勾上整天（被改成 00:00）→
   *    发现勾错了 → 取消勾选，得到 00:00。他的输入被吃掉了，而且没有任何提示。
   */
  /**
   * 「整天」来回切换时要还原用户原来填的**每一段**的钟点。
   *
   * ⚠️ 这就是需求里那句"取消勾选时**不要**silently 留着 00:00"。
   *    没有这个 ref 的话，用户填了 20:00 → 勾上整天（被改成 00:00）→
   *    发现勾错了 → 取消勾选，得到 00:00。他的输入被吃掉了，而且没有任何提示。
   * ⚠️ 2026-09-13 起它按**段的下标**存：多段之后"记一个钟点"是不够的，
   *    3 段赛事勾一下再取消，会得到 3 段一模一样的 00:00。
   */
  const lastTimed = useRef<{ start: string; end: string }[]>([]);

  function set<K extends keyof CalendarDraft>(key: K, value: CalendarDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    // 改过的字段立刻撤掉上一次提交留下的错误 —— 否则用户改对了，
    // 那行红字还挂在那里，他会以为没改进去。
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  /** 按**路径**撤掉一条错误（逐段的错误键是 `slots.0.startsAtLocal` 这种，不是字段名）。 */
  function clearError(...keys: string[]) {
    setErrors((prev) => {
      const next = { ...prev };
      let touched = false;
      for (const key of keys) {
        if (key in next) {
          delete next[key];
          touched = true;
        }
      }
      return touched ? next : prev;
    });
  }

  /**
   * 改某一段的时间输入框。`allDay` 时只收到日期部分，钟点固定为 00:00。
   *
   * ⚠️ 它**同时撤掉这一段上两个时间框的错误**（不是只撤当前这个框的）：
   *    "结束必须晚于开始"是**一对值**的性质，用户改开始时间就是在改那个判据本身，
   *    只撤结束那一格的红字会让它挂在原地——而它可能已经不成立了。
   */
  function setSlot(index: number, which: keyof CalendarSlotDraft, raw: string) {
    /*
     * ⚠️ 新值在这里算好，更新的**更新函数保持纯粹**（只做数组映射）。
     *    把 `lastTimed` 那次赋值写进 updater 里会在并发渲染下跑两遍 ——
     *    而它记的正是"用户上次填的钟点"，记错一次就是切换「整天」时
     *    悄悄吐出别人那一段的时间。
     */
    const value = draft.allDay ? withTime(raw, ALL_DAY_TIME) : raw.slice(0, 16);
    if (!draft.allDay) {
      const before = lastTimed.current[index] ?? { start: '', end: '' };
      lastTimed.current[index] =
        which === 'startsAtLocal'
          ? { ...before, start: timeOf(value) }
          : { ...before, end: timeOf(value) };
    }

    setDraft((prev) => ({
      ...prev,
      slots: prev.slots.map((slot, i) => {
        if (i !== index) return slot;
        // 整天事件：`<input type="date">` 只给 'YYYY-MM-DD'，钟点固定 00:00。
        // ⚠️ schema 那边会拒掉别的钟点（superRefine 的第一条），
        //    界面在这里就让它**填不出**别的值，而不是填完再报错。
        return which === 'startsAtLocal'
          ? { ...slot, startsAtLocal: value }
          : { ...slot, endsAtLocal: value };
      }),
    }));
    clearError(`slots.${String(index)}.startsAtLocal`, `slots.${String(index)}.endsAtLocal`);
  }

  /**
   * 「添加一段时间」——**只往后追加**，不插到中间、也不重排。
   *
   * ⚠️ 不重排的理由见渲染处那段注释（打字打到一半被挪走会丢焦点）。
   * ⚠️ 新加的那一段必然是空的，所以顺手撤掉"至少要有一段时间"那条组级错误：
   *    用户点这个按钮就是在解决那件事，红字还留着就是在骂他刚做的动作。
   */
  function addSlot() {
    setDraft((prev) =>
      prev.slots.length >= EVENT_SLOTS_MAX
        ? prev
        : { ...prev, slots: [...prev.slots, emptyCalendarSlot()] },
    );
    clearError('slots');
  }

  /**
   * 删掉某一段。**只剩一段时不给这个入口**（唯一那段不能被删 ——
   * 删掉之后表单就变成"一场没有时间的赛事"，而 schema 一定会拒它）。
   *
   * ⚠️ 删完必须把**所有**错误清掉：错误是按 `slots.<下标>` 存的，
   *    少了一段之后原来的第 2 段变成第 1 段 —— 留着旧红字会让它挂到
   *    **另一段**头上，而那种错位没有任何东西会报错。
   */
  function removeSlot(index: number) {
    setDraft((prev) =>
      prev.slots.length <= 1 ? prev : { ...prev, slots: prev.slots.filter((_, i) => i !== index) },
    );
    setErrors({});
  }

  function toggleAllDay(next: boolean) {
    if (next === draft.allDay) return;
    if (next) {
      lastTimed.current = draft.slots.map((slot) => ({
        start: timeOf(slot.startsAtLocal),
        end: timeOf(slot.endsAtLocal),
      }));
    }
    /*
     * 取消勾选时还原记住的钟点；本来就没填过时间的，用 00:00 起头
     * （它会显示在输入框里，用户可以改）。
     * ⚠️ `withTime('')` 返回空串 ⇒ 本来就没填的那一段**仍然是空的**，
     *    不会被这个切换塞进一个 00:00（那会让"没填"变成"填了午夜"）。
     */
    const remembered = lastTimed.current;
    setDraft((prev) => ({
      ...prev,
      allDay: next,
      slots: prev.slots.map((slot, i) => ({
        startsAtLocal: withTime(
          slot.startsAtLocal,
          next ? ALL_DAY_TIME : remembered[i]?.start || ALL_DAY_TIME,
        ),
        endsAtLocal: withTime(
          slot.endsAtLocal,
          next ? ALL_DAY_TIME : remembered[i]?.end || ALL_DAY_TIME,
        ),
      })),
    }));
    setErrors({});
  }

  /**
   * 切换「参与范围」。
   *
   * ⚠️ 必须顺手清掉**不匹配的**明细（大洲 ↔ 国家），这是**体验**不是校验：
   *    schema 刻意不强制这条（选 GLOBAL 却留着明细只是一条无意义的冗余，
   *    不会让人看错数据，见 `scopeDetail` 的注释）。但界面上留着上一半的取值
   *    会让人**以为它选上了** —— 而它在那张表里已经不存在了，
   *    保存之后它会凭空出现在详情页上。
   * ⚠️ 判据在 `keepScopeDetail` 那个纯函数里（它有一条自检的验证点，
   *    见那个函数的注释 —— 这条规则服务端不会替我们兜底）。
   */
  function setScope(next: string) {
    setDraft((prev) => ({
      ...prev,
      scope: next,
      scopeDetail: keepScopeDetail(next, prev.scopeDetail),
    }));
    clearError('scope', 'scopeDetail');
  }

  /** 明细的 chip 多选。顺序跟着名单走（和标签同一条约定）：集合一样时 payload 就该一模一样。 */
  function toggleScopeDetail(code: string) {
    const source = scopeDetailOptions(draft.scope);
    const next = draft.scopeDetail.includes(code)
      ? draft.scopeDetail.filter((x) => x !== code)
      : source.filter((x) => draft.scopeDetail.includes(x) || x === code);
    set('scopeDetail', [...next]);
  }

  function toggleTag(tag: string) {
    const next = draft.tags.includes(tag)
      ? draft.tags.filter((x) => x !== tag)
      : // 保持 CALENDAR_TAGS 的顺序：标签集合一样时产生的 payload 就该一模一样
        CALENDAR_TAGS.filter((x) => draft.tags.includes(x) || x === tag);
    set('tags', [...next]);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const data = buildEvent();
    if (data) onSubmit(data);
  }

  /**
   * 「直接保存 / 直接发布」（需求②，t14）—— 同一个表单、**同一份校验**，
   * 只是提交到另一条路（写线上行，不进审核队列）。
   *
   * ⚠️ 它复用 `buildEvent()` 而不是自己再校验一遍：两条路各自校验的话，
   *    迟早出现"提审能过、直编报错"（或反过来）的分叉，而用户看到的是
   *    "同一个表单，换个按钮就说我填错了"。
   */
  function submitDirect() {
    const data = buildEvent();
    if (data && secondaryAction) secondaryAction.onSubmit(data);
  }

  /**
   * 新建一个系列（③ 的写路径）。
   *
   * ⚠️ **不在前端查重**（spec D3.5 + `api.ts` 的注释）：判重是 `calendar_series.name`
   *    的 `COLLATE NOCASE UNIQUE`，前端自己比一遍必然与服务端的折叠规则漂移，
   *    而"看起来没重名、提交却被拒"是最难解释的一种失败。
   *    ⇒ 这里**只接住** 409 `invalid_state` + `reason: 'series_name_taken'` 并说人话。
   */
  async function createSeries() {
    /*
     * ⚠️ 归一化必须用 **shared 的 `normalizeSeriesName`**，不能只 `.trim()`（t17 验收第 6 条）：
     *    判重是数据库的 `COLLATE NOCASE UNIQUE` —— 它只折叠**大小写**、**不折叠空白**。
     *    所以 `MCSR  Ranked`（两个空格）与 `MCSR Ranked` 在库里是**两个系列**，
     *    而服务端写入前会用 `normalizeSeriesName` 折叠空白 ⇒ 若前端不折：
     *      · 我在本地列表里加的、和草稿里显示的名字，会与服务端实际存下的**不是同一个**；
     *      · 用户看到的"我建的系列名"与他下次在栏目里看到的不一致（而两边都不报错）。
     *    ⇒ 前端和写库**同一个判据**（这也是 shared 把它放在共享层的原因，见其注释）。
     *    ⚠️ 仍然**不在前端查重**（spec D3.5）：判重是服务端的事，见下面 catch 里那条注释。
     */
    const name = normalizeSeriesName(seriesName) ?? '';
    if (name === '' || seriesBusy) return;
    setSeriesBusy(true);
    setSeriesError(null);
    try {
      const { series } = await createCalendarSeries({ name });
      // 建完**直接选中它**：用户点"新建系列"就是想用它，再让他回列表里找一遍是白费一道工
      setSeriesList((prev) => [...prev, series]);
      setDraft((prev) => ({ ...prev, seriesId: series.id, seriesName: series.name }));
      setSeriesCreating(false);
      setSeriesName('');
    } catch (error) {
      setSeriesError(
        error instanceof ApiError &&
          error.code === 'invalid_state' &&
          error.reason === 'series_name_taken'
          ? t('calendar.seriesNameTaken')
          : errorText(error),
      );
    } finally {
      setSeriesBusy(false);
    }
  }

  /**
   * 校验并整理出提交体。**两条提交路径共用这一处**（见 `submitDirect`）。
   * 返回 `null` = 校验没过（错误已写进 `errors`，调用方什么都不用做）。
   */
  function buildEvent(): CalendarEventInput | null {
    /*
     * ⚠️ 用**共享 schema** 校验，而不是在界面里手写一遍规则。
     *    手写一份的后果是两边慢慢分叉：界面放行服务端会拒的内容，
     *    或者界面拦下服务端允许的内容 —— 而两种都不会有报错。
     */
    const candidate = calendarEventInputOf(draft);

    const parsed = CalendarEventInputSchema.safeParse(candidate);
    if (!parsed.success) {
      /*
       * ⚠️ 键是 `issueText` 给出的**控件路径**（逐段的是 `slots.0.endsAtLocal`），
       *    不是字段名 —— 渲染处按同一把键去找它，所以这两边必须共用 `issueText`，
       *    不能各拼一套。拼错的表现是"红字消失了"，而它不会报错。
       */
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const { key, text } = issueText(issue, draft, t);
        // 每个控件只留第一条：同一条规则可能报多条，叠在一起反而看不清
        if (!next[key]) next[key] = text;
      }
      setErrors(next);
      return null;
    }

    setErrors({});
    return parsed.data;
  }

  // ---- 实时校验（不等提交） ----

  const startTzTrimmed = draft.startsAtTz.trim();

  const live: Record<string, string> = {};
  if (startTzTrimmed !== '' && !isValidTimeZone(startTzTrimmed)) {
    live.startsAtTz = t('calendar.errInvalidTz');
  }
  /*
   * 逐段的"结束晚于开始"实时提示。
   *
   * 两端都还没填全时不算 —— 那会在一张还空着的表单上先亮一条红字。
   * 判据和 schema 一样是**换算成 UTC 之后的时刻**（见文件头第 3 条）；
   * 时区名非法时 `wallClockToUtc` 返回 null，于是这一段自然不报 ——
   * 那种情况下该说的是上面那条"这个时区名无效"。
   *
   * ⚠️ 结果按 `slots.<i>.endsAtLocal` 存放，落到**那一段的那一行**上。
   */
  draft.slots.forEach((slot, i) => {
    if (!slot.startsAtLocal || !slot.endsAtLocal) return;
    const startUtc = wallClockToUtc(slot.startsAtLocal, startTzTrimmed);
    const endUtc = wallClockToUtc(slot.endsAtLocal, startTzTrimmed);
    if (startUtc !== null && endUtc !== null && endUtc <= startUtc) {
      live[`slots.${String(i)}.endsAtLocal`] = draft.allDay
        ? t('calendar.errAllDayEndOrder')
        : t('calendar.errEndBeforeStart');
    }
  });

  /** 字段下的红字。实时结果优先 —— 它反映的是**现在**输入框里的内容。 */
  const fieldError = (key: string) => {
    const text = live[key] ?? errors[key];
    return text ? <p className="fielderr">{text}</p> : null;
  };

  // 时区名合法时显示它此刻的偏移，作为"这个时区名真的存在"的当场确认
  const tzHint = (zone: string, fallback: string): string => {
    if (zone === '' || !isValidTimeZone(zone)) return fallback;
    const offset = zoneOffsetLabel(zone);
    return offset ? t('calendar.tzOffsetHint', { offset }) : fallback;
  };

  /** 某一格的输入值：整天事件只给日期部分（`<input type="date">` 的 value 形状）。 */
  const slotValue = (local: string): string => (draft.allDay ? dateOf(local) : local);

  /**
   * 「参与范围明细」的候选项与词条前缀 —— **跟着 `scope` 走**。
   *
   * ⚠️ 名单本身在 `scopeDetailOptions`（纯函数、自检脚本能直接驱动它）；
   *    这里只补上词条前缀。渲染处已经由
   *    `scope === 'CONTINENT' || 'COUNTRY'` 把门，而 `scopeDetailOptions`
   *    对其它档返回空数组 ⇒ 那两个变量的取值只可能是"洲"或"国家"。
   */
  const detailOptions = scopeDetailOptions(draft.scope);
  const detailKeyPrefix = draft.scope === 'CONTINENT' ? 'calendar.continent.' : 'calendar.country.';

  /** 段数到顶时「添加」按钮禁用 —— 再点也不会有第 9 段（schema 的 `.max` 会拒）。 */
  const slotsFull = draft.slots.length >= EVENT_SLOTS_MAX;

  /*
   * 下拉框的选项 = 服务端给的列表 +（必要时）**当前这一条已经挂着的那个系列**。
   *
   * ⚠️ 少了后半段就会**静默说谎**：`<select value="s9">` 在没有任何 option 命中时
   *    显示的是**第一个** option（这里是"不填"），而草稿里仍然是 `s9`。
   *    列表请求还没回来、请求失败、或刚刚新建完，都会走到这一档。
   */
  const seriesOptions: { id: string; name: string }[] = seriesList.map((s) => ({
    id: s.id,
    name: s.name,
  }));
  if (draft.seriesId !== '' && !seriesOptions.some((s) => s.id === draft.seriesId)) {
    seriesOptions.push({ id: draft.seriesId, name: draft.seriesName || draft.seriesId });
  }

  return (
    <form className="authform submitform" onSubmit={submit} noValidate>
      {/*
        时区建议值。用 `<datalist>` 而不是 `<select>`：
        世界上有几百个 IANA 时区，列全不可能，而下拉框等于把列不出来的
        那些真实时区变成了"填不进去"。datalist 是"可以选、也可以自己打"。
      */}
      <datalist id="cal-tz-options">
        {CALENDAR_TZ_SUGGESTIONS.map((tz) => (
          <option key={tz} value={tz} />
        ))}
      </datalist>

      <div className="formrow">
        <Field id="cal-lang" label={t('calendar.fields.lang')} hint={t('submit.hintLang')}>
          <select
            id="cal-lang"
            className="mcsr-field__input"
            value={draft.lang}
            onChange={(e) => set('lang', e.target.value)}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {t(l === 'zh-CN' ? 'resources.langZh' : 'resources.langEn')}
              </option>
            ))}
          </select>
        </Field>

        {/*
          专业程度 / 参与范围 / 参赛门槛 —— **同一排的三个可空单选标签**，
          它们是一类东西：都用来让筛选更准，都不参与时间定位。

          ⚠️ 这里原来是「轮次」（`stage`），**2026-09-13 按用户第 ⑥ 条要求删掉了**：
              轮次不做父子层级、只是个标签，而录数据时"横跨一周的连续赛事"根本填不了它
              —— 那种赛事被逼着在六个选项里挑一个错的。
              位置上顶替它的是「参赛门槛」（`EVENT_ACCESS`），一个真的能回答
              "怎么才能进"的维度。
          ⚠️ 三处都保留了"选择不填"的空选项，而且文案**不是** `stageNone`：
              `stageNone`（"不填"）说的是"这场还没到那个轮次"—— 那个含义对
              专业程度/参与范围/参赛门槛**完全不成立**（它们对排位节点这类活动是
              **根本不存在**）。所以这里用 `dimNone`（"不适用 / 不限"），
              否则录入者会以为自己漏了一项，然后随便选一个把数据污染掉。
        */}
        <Field id="cal-level" label={t('calendar.fields.level')} hint={t('calendar.hintLevel')}>
          <select
            id="cal-level"
            className="mcsr-field__input"
            value={draft.level}
            onChange={(e) => set('level', e.target.value)}
          >
            <option value="">{t('calendar.dimNone')}</option>
            {EVENT_LEVELS.map((l) => (
              <option key={l} value={l}>
                {t(`calendar.level.${l}`)}
              </option>
            ))}
          </select>
        </Field>

        <Field id="cal-scope" label={t('calendar.fields.scope')} hint={t('calendar.hintScope')}>
          <select
            id="cal-scope"
            className="mcsr-field__input"
            value={draft.scope}
            /*
             * ⚠️ 走 `setScope` 而不是通用的 `set`：换范围时要顺手把**不匹配的明细**
             *    清掉（大洲 ↔ 国家是两份不重叠的名单）。理由见 setScope 的注释 ——
             *    那是**体验**，schema 不强制这条。
             */
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="">{t('calendar.dimNone')}</option>
            {EVENT_SCOPES.map((s) => (
              <option key={s} value={s}>
                {t(`calendar.scope.${s}`)}
              </option>
            ))}
          </select>
        </Field>

        <Field id="cal-access" label={t('calendar.fields.access')} hint={t('calendar.hintAccess')}>
          <select
            id="cal-access"
            className="mcsr-field__input"
            value={draft.access}
            onChange={(e) => set('access', e.target.value)}
          >
            <option value="">{t('calendar.dimNone')}</option>
            {EVENT_ACCESS.map((a) => (
              <option key={a} value={a}>
                {t(`calendar.access.${a}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/*
        ★ 「参与范围明细」（2026-09-13，用户第 ⑥ 条：「参赛范围非全球时允许选具体信息
          （如大洲）」）—— **只在选到「大洲」或「国家」时出现**。

        ⚠️ 它放在「参与范围」那一排**下面**，而不是塞进上面那个 2×2 的 grid：
            它是从属于「参与范围」的**二级选择**，塞进 grid 会变成"第五个维度"，
            而它和 `scope` 的关系（谁决定谁）在视觉上就看不出来了。
        ⚠️ 选到「全球」时**整块不渲染**（不是灰掉）：全球范围的赛事没有"哪些大洲"
            可言，留一块灰按钮会让人以为那里还能填。
        ⚠️ 多选、命中任一即算匹配 —— 用户举的例子就是"亚洲 & 大洋洲"，
            单选会逼这场赛事在两条记录之间搬来搬去。
      */}
      {draft.scope === 'CONTINENT' || draft.scope === 'COUNTRY' ? (
        <div className="mcsr-field scopedetail">
          <span className="mcsr-field__label">{t('calendar.fields.scopeDetail')}</span>
          <div className="tagpicker__row">
            {detailOptions.map((code) => (
              <button
                key={code}
                type="button"
                className={`tagchip${draft.scopeDetail.includes(code) ? ' tagchip--on' : ''}`}
                onClick={() => toggleScopeDetail(code)}
                aria-pressed={draft.scopeDetail.includes(code)}
              >
                {/*
                  ⚠️ 这里是**动态**词条键（`calendar.continent.ASIA`），
                     i18n 的静态守卫（services/api/src/i18n-keys.test.ts 守卫三）
                     只认字面量 ⇒ 它扫不到这两族。所以漏一条词条的表现是
                     界面上显示成代码本身（`BR`）—— 那比冒出一个裸 key 更不显眼，
                     只能靠渲染自检抓。加国家/大洲时**记得同时补中英各一条**。
                */}
                {t(`${detailKeyPrefix}${code}`)}
              </button>
            ))}
          </div>
          {fieldError('scopeDetail')}
          <p className="mcsr-field__hint">{t('calendar.hintScopeDetail')}</p>
        </div>
      ) : null}

      <Field id="cal-title" label={t('calendar.fields.title')} hint={t('calendar.hintTitle')}>
        <input
          id="cal-title"
          className="mcsr-field__input mcsr-field__input--prose"
          value={draft.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder={t('calendar.titlePlaceholder')}
          required
        />
        {fieldError('title')}
      </Field>

      <Field
        id="cal-title-en"
        label={t('calendar.fields.titleEn')}
        hint={t('calendar.hintTitleEn')}
      >
        <input
          id="cal-title-en"
          className="mcsr-field__input mcsr-field__input--prose"
          value={draft.titleEn}
          onChange={(e) => set('titleEn', e.target.value)}
          placeholder={t('calendar.titleEnPlaceholder')}
        />
        {fieldError('titleEn')}
      </Field>

      {/*
        「整天」放在时间输入框**前面**：它决定下面那两个框长什么样
        （日期选择器 / 日期时间选择器）。放在后面的话，用户先填完时间，
        再勾上，会看到刚刚填的东西被换掉。
      */}
      <div className="mcsr-field calendar-form__allday">
        <label className="listfilter" htmlFor="cal-allday">
          <input
            id="cal-allday"
            type="checkbox"
            checked={draft.allDay}
            onChange={(e) => toggleAllDay(e.target.checked)}
          />
          {t('calendar.fields.allDay')}
        </label>
        <p className="mcsr-field__hint">{t('calendar.hintAllDay')}</p>
      </div>

      {/*
        ★ 时区：**整条事件只有一个，填一次**（用户原话：「时区放在最上面，
          只填一次即可」）。

        ⚠️ 所以它**不在**每一段里重复。这是刻意的简化，也是多段模型的前提：
           一场赛事通常在一个时区里办，而每段各带一个时区会让"跨时区换算"
           在事件内部就开始互相打架（哪一段用哪个时区显示？包络又怎么算？）。
           真要跨时区办，本仓的答案是**拆成两个事件**。
        ⚠️ 它排在段列表**前面**：下面每一段填的都是"这个时区里的本地时间"，
           先定时区再填时间，读起来才是一句话。
      */}
      <div className="formrow">
        <Field
          id="cal-tz"
          label={t('calendar.fields.timezone')}
          hint={tzHint(startTzTrimmed, t('calendar.hintTimezone'))}
        >
          <input
            id="cal-tz"
            className="mcsr-field__input"
            list="cal-tz-options"
            value={draft.startsAtTz}
            onChange={(e) => set('startsAtTz', e.target.value)}
            placeholder="Asia/Shanghai"
            autoComplete="off"
            spellCheck={false}
            required
          />
          {fieldError('startsAtTz')}
        </Field>
      </div>

      {/*
        ★★ 比赛时间：**多段不连续的时间**（2026-09-13，用户第 ④ 条需求原话：
          「把『开始时间』『结束时间』改成允许输入多段不连续的时间（如在下面新增
          『添加』按钮，允许再填一组『开始时间』『结束时间』，同时时区放在最上面，
          只填一次即可）」）。

        ⚠️⚠️ **界面不替用户重排这些段**，理由是一条具体的坏后果而不是洁癖：
            用户在第 3 段打到一半时，按开始时间重排会把它挪到第 1 行，
            React 按位置复用 DOM ⇒ **输入焦点当场丢掉**，剩下的半句话
            落进另一段。而重排在功能上**什么都不换**：段是按开始时间排序存进库的，
            那是服务端写入时做的事（schema 里写着"入参的顺序不承重"）。
            少排一次 = 少一类"打字打到一半东西跑了"的 bug，代价是用户在
            提交前看到的顺序可能不是时间顺序 —— 而那一眼在提交后的详情页上有。
        ⚠️ 每段只有本地时间、没有自己的时区（时区在上面那一格，只填一次）。
        ⚠️ 每一段都有**自己的无障碍名字**（`aria-label` 里带「第 N 段」）：
            屏幕阅读器里那几组"开始时间/结束时间"长得一模一样，没有序号，
            用户分不清自己正在改哪一段。
      */}
      <div className="mcsr-field slotlist">
        <span className="mcsr-field__label">{t('calendar.fields.slots')}</span>

        {draft.slots.map((slot, i) => {
          /*
           * ⚠️ **刻意用下标当 key**，并且显式关掉这条 lint 规则（它是 `suspicious`，
           *    默认的担心在这里不成立，理由有三条）：
           *      · 段行**没有任何内部状态**：两个输入框的值全部来自草稿（受控），
           *        id / aria-label 也由下标推导 ⇒ 复用 DOM 节点时不会有"上一段的残留"；
           *      · 段的**顺序永不改变**（不重排、只在末尾追加、删除时整体重编下标）
           *        ⇒ 下标与段的对应关系是稳定的；
           *      · 换成一个随机 id 会带来一个真实的坏处：**纯 SSR 的快照每次不同**，
           *        而本仓的渲染自检正是拿那份快照做断言的。
           *    另外，用内容（开始时间）当 key 更糟：用户每敲一个字符 key 就变一次，
           *    React 会**重建那一行**，输入焦点当场丢掉。
           */
          return (
            <div
              className="slotrow"
              // biome-ignore lint/suspicious/noArrayIndexKey: 段行无内部状态、顺序永不改变，且随机 key 会破坏 SSR 快照的可断言性（理由见上面的注释）
              key={i}
            >
              <div className="slotrow__head">
                {/*
                  ⚠️ 序号在**行首**是给眼睛的（哪一段到哪一段），下面输入框的
                     `aria-label` 里也带上它 —— 那是给读屏的。两处都必要：
                     行首那个是纯视觉的分隔，读屏不会把它当输入框的名字读出来。
                */}
                <span className="slotrow__index">{t('calendar.slotLabel', { n: i + 1 })}</span>
                {/*
                  ⚠️ **只有一段时不给这个按钮**。唯一那一段被删掉之后，表单会变成
                     "一场没有时间的赛事" —— schema 一定会拒（`.min(1)`），
                     而用户在界面上找不到任何东西可以补救。
                */}
                {draft.slots.length > 1 ? (
                  <button
                    type="button"
                    className="ghostbtn slotrow__remove"
                    onClick={() => removeSlot(i)}
                  >
                    {t('calendar.removeSlot')}
                  </button>
                ) : null}
              </div>

              <div className="slotrow__fields">
                <Field
                  id={`cal-slot-${String(i)}-start`}
                  label={t('calendar.fields.startsAt')}
                  /*
                   * ⚠️ 提示只在**第一段**下面出现一次。
                   *    同一句话在 8 行里重复 8 遍会让这一块看着像 8 组必填的大字段，
                   *    而它对每一段说的话是一模一样的。
                   */
                  hint={i === 0 ? t('calendar.hintStartsAt') : undefined}
                >
                  <input
                    id={`cal-slot-${String(i)}-start`}
                    className="mcsr-field__input"
                    /*
                     * ⚠️ 值是**原样的墙钟字符串**，不是 `new Date(...)` 的结果。
                     *    `<input type="datetime-local">` 的 value 恰好就是
                     *    'YYYY-MM-DDTHH:mm'，和数据库里那个字段一字不差。
                     *    中间过一次 Date 就会引入"按本机时区解释"这个陷阱
                     *    （calendar-time.ts 开头专门警告过它）。
                     */
                    type={draft.allDay ? 'date' : 'datetime-local'}
                    value={slotValue(slot.startsAtLocal)}
                    onChange={(e) => setSlot(i, 'startsAtLocal', e.target.value)}
                    /*
                     * ⚠️ `aria-label` 会**覆盖** `<label>` 作为可访问名字 ——
                     *    所以它必须把字段名一起带上。只写「第 1 段」的话，
                     *    读屏会把这几个框念成一排没有名字的输入框。
                     */
                    aria-label={`${t('calendar.slotLabel', { n: i + 1 })} · ${t('calendar.fields.startsAt')}`}
                    required
                  />
                  {fieldError(`slots.${String(i)}.startsAtLocal`)}
                </Field>

                <Field
                  id={`cal-slot-${String(i)}-end`}
                  label={t('calendar.fields.endsAt')}
                  hint={
                    i === 0
                      ? draft.allDay
                        ? t('calendar.hintEndsAtAllDay')
                        : t('calendar.hintEndsAt')
                      : undefined
                  }
                >
                  <input
                    id={`cal-slot-${String(i)}-end`}
                    className="mcsr-field__input"
                    type={draft.allDay ? 'date' : 'datetime-local'}
                    value={slotValue(slot.endsAtLocal)}
                    onChange={(e) => setSlot(i, 'endsAtLocal', e.target.value)}
                    aria-label={`${t('calendar.slotLabel', { n: i + 1 })} · ${t('calendar.fields.endsAt')}`}
                  />
                  {fieldError(`slots.${String(i)}.endsAtLocal`)}
                </Field>
              </div>
            </div>
          );
        })}

        {/*
          「至少要有一段时间」/「最多 8 段时间」—— 这两条是**段列表整体**的错误
          （路径是 `['slots']`），所以挂在列表下面，而不是任何一行上。
        */}
        {fieldError('slots')}

        <div className="slotlist__actions">
          <button
            type="button"
            className="ghostbtn"
            /* 到顶时**禁用**：再点也变不出第 9 段（schema 的 `.max` 会拒它） */
            disabled={slotsFull}
            onClick={addSlot}
          >
            {t('calendar.addSlot')}
          </button>
          {/*
            ⚠️ 禁用必须**说清为什么**：一个点不动的按钮不解释一句，
               用户只会以为是页面卡了。到顶时换成那句"最多 8 段时间"。
          */}
          <p className="mcsr-field__hint">
            {slotsFull
              ? t('calendar.errSlotsMax', { max: EVENT_SLOTS_MAX })
              : t('calendar.hintSlots')}
          </p>
        </div>
      </div>

      <div className="formrow">
        <Field
          id="cal-location"
          label={t('calendar.fields.location')}
          hint={t('calendar.hintLocation')}
        >
          <input
            id="cal-location"
            className="mcsr-field__input mcsr-field__input--prose"
            value={draft.location}
            onChange={(e) => set('location', e.target.value)}
            placeholder={t('calendar.locationPlaceholder')}
          />
          {fieldError('location')}
        </Field>

        <Field id="cal-url" label={t('calendar.fields.url')} hint={t('calendar.hintUrl')}>
          <input
            id="cal-url"
            className="mcsr-field__input mcsr-field__input--prose"
            type="url"
            value={draft.url}
            onChange={(e) => set('url', e.target.value)}
            placeholder="https://"
          />
          {fieldError('url')}
        </Field>
      </div>

      {/*
        标签多选。**至少一个**（schema 的 .min(1)）——
        一个没有任何标签的事件在按标签筛选的界面上等于不可见，
        而"提交成功了但谁也看不到"是最难排查的一种失败。
      */}
      <div className="mcsr-field">
        <span className="mcsr-field__label">{t('calendar.fields.tags')}</span>
        <div className="tagpicker__row">
          {CALENDAR_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`tagchip${draft.tags.includes(tag) ? ' tagchip--on' : ''}`}
              onClick={() => toggleTag(tag)}
              aria-pressed={draft.tags.includes(tag)}
            >
              {t(`calendar.tag.${tag}`)}
            </button>
          ))}
        </div>
        {fieldError('tags')}
        <p className="mcsr-field__hint">{t('calendar.hintTags')}</p>
      </div>

      {/*
        ----------------------------------------------------------------------
        系列活动（需求③）
        ----------------------------------------------------------------------
        · 系列的**名字是用户内容**，不翻译 —— 选项直接显示 `name`。
        · ⚠️ 那个"什么都不选"的空选项走 `calendar.seriesNone`（值「不填」）。
          2026-09-14 之前它**借用**的是 `calendar.stageNone`，理由是"那一轮不新增词条"。
          ⚠️ 借用已经还回去了：`stageNone` 随「轮次」那一维一起删掉，而"借用"的代价
          正好在这一轮显形 —— 删 stage 的词条会顺手把系列下拉框的空选项弄没，
          两者除了恰好都叫「不填」之外没有任何关系。
          ⚠️ 值刻意**不是** `dimNone`（「不适用 / 不限」）：不属于任何系列是**常态**，
          不是"这一维不适用"（那说的是专业程度/范围/门槛对排位节点不适用）。
        · ⚠️ 错误只落在这个字段下面：重名是**这一格**的问题。挂成整张表单的红条会让
          用户去别处找一个不在那里的错。
      */}
      <Field id="cal-series" label={t('calendar.seriesField')} hint={t('calendar.seriesFieldHint')}>
        <select
          id="cal-series"
          className="mcsr-field__input"
          value={draft.seriesId}
          onChange={(e) => {
            const id = e.target.value;
            const picked = seriesOptions.find((s) => s.id === id);
            setDraft((prev) => ({ ...prev, seriesId: id, seriesName: picked?.name ?? '' }));
          }}
        >
          <option value="">{t('calendar.seriesNone')}</option>
          {seriesOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        {/*
          「新建系列」只对 `content.author` 出现（D3.5）。⚠️ 不是灰按钮 ——
          看不见比看得见点不动好（本仓一贯的立场）。
        */}
        {canAuthor ? (
          seriesCreating ? (
            <div className="seriescreate">
              <input
                className="mcsr-field__input"
                value={seriesName}
                onChange={(e) => {
                  setSeriesName(e.target.value);
                  setSeriesError(null);
                }}
                aria-label={t('calendar.seriesField')}
                autoComplete="off"
              />
              <button
                type="button"
                className="ghostbtn"
                disabled={seriesBusy || seriesName.trim() === ''}
                onClick={() => void createSeries()}
              >
                {t('common.confirm')}
              </button>
              <button
                type="button"
                className="ghostbtn"
                onClick={() => {
                  setSeriesCreating(false);
                  setSeriesName('');
                  setSeriesError(null);
                }}
              >
                {t('common.cancel')}
              </button>
            </div>
          ) : (
            <button type="button" className="ghostbtn" onClick={() => setSeriesCreating(true)}>
              {t('calendar.seriesCreate')}
            </button>
          )
        ) : null}

        {/*
          ⚠️ 派生出来的 `seriesError` 走一个**纯展示组件**，而不是把上面那行 `<p>` 写在这里。
             理由（t17 验收 [9]「重名提示出现」）：这句话唯一的生产路径是**收到 409 之后**
             `setSeriesError`（见 `createSeries` 的 catch），而纯 node SSR **不跑 effect、
             也不能触发一次真实提交** ⇒ 留在抽屉里就永远断言不到，于是它会落回本仓反复在治
             的那一类："有界面、有词条、门禁全绿，但没有任何断言真的看过它"。
             ⇒ 抽成 `SeriesErrorNote` 后，自检脚本能直接把它渲染出来、断言**重名那句真的出现**。
             ⚠️ 刻意**不**改 `CalendarForm` 的 props 形状：为了测试给生产组件开一个
             `initialSeriesError` 之类的口子，是把"测试需要"写进生产接口 —— 那个口子既不
             对应任何真实状态，也会长期留在签名里。这里抽出去的是**展示**，不是**状态**。
        */}
        <SeriesErrorNote text={seriesError} />
      </Field>

      <div className="mcsr-field">
        <div className="bodytabs">
          <span className="mcsr-field__label">{t('calendar.fields.description')}</span>
          <div className="bodytabs__switch">
            <button
              type="button"
              className={preview ? '' : 'is-active'}
              onClick={() => setPreview(false)}
            >
              {t('submit.writeTab')}
            </button>
            <button
              type="button"
              className={preview ? 'is-active' : ''}
              onClick={() => setPreview(true)}
            >
              {t('submit.previewTab')}
            </button>
          </div>
        </div>

        {preview ? (
          // 预览走的是和详情页**同一个** Markdown 组件，过滤规则一致 ——
          // 各写一套的话，用户会看到"预览正常、发布后一半内容不见了"。
          <div className="bodypreview">
            {draft.descriptionMd.trim() ? (
              <Markdown>{draft.descriptionMd}</Markdown>
            ) : (
              <p className="muted">{t('submit.previewEmpty')}</p>
            )}
          </div>
        ) : (
          <textarea
            id="cal-desc"
            className="mcsr-field__input mcsr-field__input--prose mcsr-field__input--tall"
            rows={8}
            value={draft.descriptionMd}
            onChange={(e) => set('descriptionMd', e.target.value)}
            placeholder={t('calendar.descriptionPlaceholder')}
          />
        )}
        {/*
          ⚠️ 刻意**不设 maxLength**：超长时浏览器会安静地截断粘贴进来的内容，
            而用户以为整段都存下来了。宁可让他提交后看到一句"太长了"。
        */}
        <p className="mcsr-field__hint">
          {t('calendar.hintDescription', {
            used: draft.descriptionMd.length,
            max: EVENT_DESCRIPTION_MAX,
          })}
        </p>
        {fieldError('descriptionMd')}
      </div>

      {/*
        给审核员的话。
        ⚠️ 它和正文分开摆、并且写清楚"不会出现在活动页面上" ——
           紧挨着正文框的话，用户会以为那也是要发布的内容。
      */}
      <div className="mcsr-field notebox">
        <label className="mcsr-field__label" htmlFor="cal-note">
          {t('submit.note')}
        </label>
        <textarea
          id="cal-note"
          className="mcsr-field__input mcsr-field__input--prose"
          rows={3}
          value={draft.noteToReviewer}
          onChange={(e) => set('noteToReviewer', e.target.value)}
          placeholder={t('calendar.notePlaceholder')}
        />
        <p className="mcsr-field__hint">
          {t('calendar.hintNote', {
            used: draft.noteToReviewer.trim().length,
            max: CALENDAR_NOTE_MAX,
          })}
        </p>
        {fieldError('noteToReviewer')}
      </div>

      <div className="authform__actions">
        <button type="submit" className="cta" disabled={busy}>
          {busy ? busyLabel : actionLabel}
        </button>
        {/*
          「直接保存 / 直接发布」（需求②）—— 只有 editor 及以上看得到（页面决定传不传）。
          ⚠️ `type="button"`：它不是表单的默认提交键，点它走的是**另一条路**
             （写线上行、不进审核队列）。写成 submit 会让回车键也触发它 ——
             而回车是用户"填完了"的肌肉记忆，那时他想要的是提审。
          ⚠️ 主次按钮的样式刻意不同（`cta` vs `ghostbtn`）并且文案里都带"（不审核）"：
             看错按钮的代价是"以为提审了其实直接上线了"，或反过来。
        */}
        {secondaryAction ? (
          <button
            type="button"
            className="ghostbtn"
            disabled={busy}
            onClick={submitDirect}
            title={t('authoring.directHint')}
          >
            {busy ? secondaryAction.busyLabel : secondaryAction.label}
          </button>
        ) : null}
        <span className="submitform__note">{t('calendar.reviewNote')}</span>
      </div>
    </form>
  );
}

/**
 * 建系列失败时的一句话（需求③ / t17 验收 [9]「重名提示出现」）。
 *
 * ---------------------------------------------------------------------------
 * 为什么单独抽成组件，而不是留在表单里的一个 `{seriesError ? <p/> : null}`
 * ---------------------------------------------------------------------------
 * 那句话**只有一条生产路径**：`createSeries()` 收到服务端的 409
 * `invalid_state` + `reason: 'series_name_taken'` 之后 `setSeriesError`。而纯 node SSR
 * **不跑 effect、也发不出请求** ⇒ 只要它还嵌在抽屉里，自检脚本就永远看不到它，
 * 于是它虽然"有界面、有词条、门禁全绿"，却**没有任何断言真的看过它** ——
 * 本仓反复在治的正是这个形状（"门禁绿"不等于"有人验过"）。
 *
 * ⚠️ 抽出来的是**展示**，不是**状态**：`seriesError` 仍由表单自己派生。
 *    刻意**没有**给 `CalendarForm` 加 `initialSeriesError` 之类的 prop ——
 *    那种口子只服务于测试、不对应任何真实状态，而且会永久留在生产签名里。
 *
 * ⚠️ 文案由**调用方**（`createSeries` 的 catch）翻好再传进来，而不是在这里按
 *    `reason` 再判一次：`reason` → 人话的映射只应有一份，写第二份迟早与第一份分叉。
 *    这里同时兜住 `errorText(error)` 的其它失败 —— 空串也**不渲染**，避免出现一个没字的红框。
 */
export function SeriesErrorNote({ text }: { text: string | null }) {
  if (!text) return null;
  return <p className="fielderr">{text}</p>;
}

/**
 * 草稿 → 提交体。**纯函数、没有校验**（校验在 `buildEvent` 里走共享 schema）。
 *
 * ---------------------------------------------------------------------------
 * 为什么单独抽出来，而且必须由**生产路径**调用（不是只在测试里用一份）
 * ---------------------------------------------------------------------------
 * 需求③ 的"把事件归到系列"这一跳（`seriesId`）在界面上的验证点是"选一个已有系列 →
 * 提交体里带上它"。若把映射留在 `buildEvent` 里（它读整个草稿 + 会 `setErrors`），
 * 自检脚本就无法驱动它 —— 于是这一跳只能靠人眼看，而"人眼看"在输出上与"验过了"
 * **无法区分**（本仓反复吃亏的形状）。
 *
 * ⚠️ 2026-09-13 起它还承载**多段时间**那一跳（`slots` + `startsAtTz`）—— 那是本轮
 *    最容易抄错的映射（旧的 `startsAtLocal`/`endsAtLocal`/`endsAtTz` 三个字段现在
 *    只剩一个数组），而它同样是纯函数、自检脚本能直接驱动。
 *
 * ⚠️ 关键：抽出来之后 `buildEvent` **必须真的调它**。如果测试用这个函数、生产走另一份
 *    等价代码，那断言证明的就不是用户实际执行的那条路 —— 这正是"守卫因为错误的原因通过"。
 *
 * ⚠️ 空串 → `null` 的转换（`seriesId` / `level` / `scope` / `access` / `titleEn` /
 *    `url` / `location` / 每一段的 `endsAtLocal` / `noteToReviewer`）**只在这一处**做：
 *    草稿里空串表示"没填"，而服务端 schema 要的是 `null`。散在多处就会出现两个字段
 *    对"没填"的理解不一致，而两边都不报错。
 *
 * ⚠️ **刻意不写返回类型**（靠推断）：这里产出的是**待校验的输入**，而 schema 的
 *    `CalendarEventInput` 是**输出**（`tags` 已是枚举、`allDay` 已填上默认值）。
 *    标成输出类型会逼出 `as` 转型，而转型恰好会把这个函数最该被检查的地方
 *    （"映射出来的东西 schema 收不收"）**静默关掉**。
 *    ⚠️ 也别去取 schema 的输入类型：`apps/web` 的 dependencies 里**没有 zod**
 *    （只 `import type` 也解析不到）。表单草稿里 `level`/`scope`/`access` 本来就是
 *    **普通字符串** —— 收紧成枚举会让"用户选了非法值"变成编译错误，而不是一条界面红字。
 */
export function calendarEventInputOf(draft: CalendarDraft) {
  return {
    title: draft.title.trim(),
    titleEn: draft.titleEn.trim() || null,
    descriptionMd: draft.descriptionMd,
    // 时区**整条只有一个**（用户要求"只填一次"），所以在段的数组外面
    startsAtTz: draft.startsAtTz.trim(),
    /*
     * ★ 逐段映射。两点刻意为之：
     *
     * ⚠️ **不排序**。段按开始时间排序是**服务端写入时**做的事（schema 里写着
     *    "入参的顺序不承重"）。在这里排一次就等于有了两份排序规则，而它们分叉时
     *    不会有任何报错 —— 只有"库里的顺序和界面上的顺序不一样"。
     * ⚠️ 结束时间空串 → `null`（schema 是 `.nullish()`）；`startsAtLocal` 原样透传，
     *    **不做**"缺了就丢掉这一段"的补救：丢掉的话，用户少填一格会看到
     *    "至少要有一段时间"，而真正的原因（这一段缺开始时间）不在那句话里。
     */
    slots: draft.slots.map((slot) => ({
      startsAtLocal: slot.startsAtLocal,
      endsAtLocal: slot.endsAtLocal || null,
    })),
    allDay: draft.allDay,
    url: draft.url.trim() || null,
    location: draft.location.trim() || null,
    tags: draft.tags,
    // 空串 → null（草稿里这几个维度都是空串表示"没填"）
    level: draft.level || null,
    scope: draft.scope || null,
    access: draft.access || null,
    /*
     * ⚠️ 明细**原样传**，不做"scope 是 GLOBAL 就清空"的加工：清不匹配的那一步
     *    发生在用户切 scope 的那一刻（`setScope`），那是**体验**。在这里再清一次
     *    就等于多了一份"什么时候该清"的规则，而它与界面上的那份迟早分叉 ——
     *    表现是"我明明选了，提交完却没了"，且两边都不报错。
     */
    scopeDetail: draft.scopeDetail,
    // ③：同上，空串 → null（"不归到任何系列"）
    seriesId: draft.seriesId || null,
    lang: draft.lang,
    noteToReviewer: draft.noteToReviewer.trim() || null,
  };
}
