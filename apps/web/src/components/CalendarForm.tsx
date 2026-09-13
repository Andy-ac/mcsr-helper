import { CALENDAR_TAGS, EVENT_LEVELS, EVENT_SCOPES, EVENT_STAGES, LOCALES } from '@mcsr/shared';
import {
  ALL_DAY_TIME,
  type CalendarEvent,
  type CalendarEventInput,
  CalendarEventInputSchema,
  type CalendarSeries,
  EVENT_DESCRIPTION_MAX,
  EVENT_LOCATION_MAX,
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
 */

/** 表单内部状态。提交时才转成 CalendarEventInput。 */
export interface CalendarDraft {
  title: string;
  titleEn: string;
  descriptionMd: string;
  /** 'YYYY-MM-DDTHH:mm'，或空串（还没填） */
  startsAtLocal: string;
  startsAtTz: string;
  /** 同上；空串表示"不填结束时间" */
  endsAtLocal: string;
  endsAtTz: string;
  allDay: boolean;
  url: string;
  location: string;
  tags: string[];
  /** 空串 = 不填轮次（stage 是可选的） */
  stage: string;
  /**
   * 专业程度 / 参与范围（011 新增）。空串 = 不填。
   *
   * ⚠️ 三个维度都用**空串**表示"没填"，而不是 `null` —— 它们是 `<select>`
   *    的值，而 DOM 里"没选"就是空串。真正转成 `null` 发生在提交那一步
   *    （`draft.stage || null`），只在一个地方做，见 buildInput。
   */
  level: string;
  scope: string;
  lang: string;
  /**
   * 系列活动（③）。`''` = **不归到任何系列**（绝大多数赛事如此，这不是"还没填"）。
   *
   * ⚠️ 与 `stage` / `level` / `scope` 同一个约定：`<select>` 的"没选"就是空串，
   *    真正转成 `null` 只发生在 `buildEvent()` 一处。
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
    startsAtLocal: '',
    /*
     * ⚠️ 默认值必须是**用户自己的时区**，不能是 'UTC' 或 'Asia/Shanghai'。
     *
     * 绝大多数录入者填的是自己所在时区的那场比赛，而 UTC 是一个会静默出错
     * 的默认值：填表的人不会去改一个看起来已经填好的字段，于是每场赛事都偏移
     * 几个小时 —— 而偏移几个小时的赛事时间看起来完全正常。
     */
    startsAtTz: VIEWER_TZ,
    endsAtLocal: '',
    endsAtTz: '',
    allDay: false,
    url: '',
    location: '',
    tags: [],
    stage: '',
    level: '',
    scope: '',
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
    startsAtLocal: event.startsAtLocal,
    startsAtTz: event.startsAtTz,
    endsAtLocal: event.endsAtLocal ?? '',
    endsAtTz: event.endsAtTz ?? '',
    allDay: event.allDay,
    url: event.url ?? '',
    location: event.location ?? '',
    tags: event.tags,
    stage: event.stage ?? '',
    level: event.level ?? '',
    scope: event.scope ?? '',
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
 */
function issueText(
  issue: Issue,
  draft: CalendarDraft,
  t: Translate,
): { field: string; text: string } {
  const field = String(issue.path[0] ?? '');
  // 长度类的问题在 Zod 里统一是 too_big，字段名决定文案
  const tooBig = issue.code === 'too_big';

  switch (field) {
    case 'title':
      return {
        field,
        text: tooBig
          ? t('calendar.errTitleTooLong', { max: EVENT_TITLE_MAX })
          : t('calendar.errTitleRequired'),
      };
    case 'titleEn':
      return { field, text: t('calendar.errTitleTooLong', { max: EVENT_TITLE_MAX }) };
    case 'descriptionMd':
      return { field, text: t('calendar.errDescTooLong', { max: EVENT_DESCRIPTION_MAX }) };
    case 'location':
      return { field, text: t('calendar.errLocationTooLong', { max: EVENT_LOCATION_MAX }) };
    case 'url':
      return { field, text: t('calendar.errUrlTooLong') };
    case 'noteToReviewer':
      return { field, text: t('calendar.errNoteTooLong', { max: CALENDAR_NOTE_MAX }) };
    case 'tags':
      return { field, text: t('calendar.errTagsMin') };

    case 'startsAtTz':
    case 'endsAtTz': {
      if (tooBig) return { field, text: t('calendar.errTzTooLong') };
      /*
       * 同一个字段上有两条 custom：时区名非法（TimeZoneSchema 的 refine），
       * 以及"结束时间需要同时给出时间和时区"（superRefine，路径会落在
       * 缺的那一侧）。用 isValidTimeZone 再判一次就知道是哪一条。
       *
       * ⚠️ 而空值必须先判：`isValidTimeZone('')` 是 false，落到下面那句
       *    "结束时间需要同时给出时间和时区" 上，会在用户**漏填开始时间的时区**
       *    时说一句关于结束时间的话。（这条是由 .cache/calverify.ts 跑出来的，
       *    不是想出来的。）
       */
      const value = (field === 'startsAtTz' ? draft.startsAtTz : draft.endsAtTz).trim();
      if (value === '') {
        return {
          field,
          text:
            field === 'startsAtTz' ? t('calendar.errTzRequired') : t('calendar.errEndNeedsBoth'),
        };
      }
      if (!isValidTimeZone(value)) return { field, text: t('calendar.errInvalidTz') };
      return { field, text: t('calendar.errEndNeedsBoth') };
    }

    case 'startsAtLocal':
    case 'endsAtLocal': {
      const value = field === 'startsAtLocal' ? draft.startsAtLocal : draft.endsAtLocal;
      /*
       * 空值放在最前，因为它有两种来路，而两种都不该说"格式不对"：
       *   · `invalid_type` —— 这个 key 根本没给
       *   · `invalid_format` —— 给了但空串（表单原样传字符串，空表单走的是这条）
       * 对一个空输入框说"格式应为 2026-08-30T20:00"，用户得自己先猜出
       * "原来它是必填的"。
       */
      if (issue.code === 'invalid_type' || value === '') {
        return {
          field,
          text:
            field === 'startsAtLocal'
              ? t('calendar.errStartRequired')
              : t('calendar.errEndNeedsBoth'),
        };
      }
      // 不是 custom 就只剩正则那一条（格式不对）
      if (issue.code !== 'custom') return { field, text: t('calendar.errWallClock') };
      /*
       * custom 有两类：整天事件的时间必须是 00:00，以及"结束必须晚于开始"。
       * 判据用的是 schema 里那句话本身（`endsWith('T00:00')`）。
       *
       * ⚠️ 从这个表单里走不到第一条：勾了「整天」之后时间输入框会换成
       *    日期选择器，时间部分在结构上就只能是 00:00。留着它是为了让
       *    这个映射对**任何**来源的 payload 都成立，而不是只对当前这份 UI 成立。
       */
      if (draft.allDay && !value.endsWith(`T${ALL_DAY_TIME}`)) {
        return { field, text: t('calendar.errAllDayTime') };
      }
      return {
        field,
        text: draft.allDay ? t('calendar.errAllDayEndOrder') : t('calendar.errEndBeforeStart'),
      };
    }

    default:
      return { field: field || 'form', text: t('calendar.errGeneric') };
  }
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
  const lastTimed = useRef({ start: '', end: '' });

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

  /** 填时间输入框。`allDay` 时只收到日期部分，钟点固定为 00:00。 */
  function setStart(raw: string) {
    if (draft.allDay) {
      set('startsAtLocal', withTime(raw, ALL_DAY_TIME));
      return;
    }
    // 有的实现会给出带秒的值，这里统一截到分钟 —— schema 只认 'HH:mm'
    const value = raw.slice(0, 16);
    lastTimed.current.start = timeOf(value);
    set('startsAtLocal', value);
  }

  function setEnd(raw: string) {
    if (draft.allDay) {
      set('endsAtLocal', withTime(raw, ALL_DAY_TIME));
      return;
    }
    const value = raw.slice(0, 16);
    lastTimed.current.end = timeOf(value);
    set('endsAtLocal', value);
    /*
     * 结束时区默认跟开始一致 —— 一场比赛的首尾几乎总在同一个时区里，
     * 让用户再填一遍是白费一道工。仍然是**独立字段**，可以改：
     * 跨时区的线上赛确实存在，硬绑成"跟开始一样"会让那种赛事填不出来。
     */
    if (value !== '' && draft.endsAtTz.trim() === '') set('endsAtTz', draft.startsAtTz);
  }

  function toggleAllDay(next: boolean) {
    if (next === draft.allDay) return;
    if (next) {
      lastTimed.current = { start: timeOf(draft.startsAtLocal), end: timeOf(draft.endsAtLocal) };
    }
    // 取消勾选时还原记住的钟点；本来就没填过时间的，用 00:00 起头（它会显示在输入框里）
    const startTime = next ? ALL_DAY_TIME : lastTimed.current.start || ALL_DAY_TIME;
    const endTime = next ? ALL_DAY_TIME : lastTimed.current.end || ALL_DAY_TIME;
    setDraft((prev) => ({
      ...prev,
      allDay: next,
      startsAtLocal: withTime(prev.startsAtLocal, startTime),
      endsAtLocal: withTime(prev.endsAtLocal, endTime),
    }));
    setErrors({});
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
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const { field, text } = issueText(issue, draft, t);
        // 每个字段只留第一条：同一条规则可能报多条，叠在一起反而看不清
        if (!next[field]) next[field] = text;
      }
      setErrors(next);
      return null;
    }

    setErrors({});
    return parsed.data;
  }

  // ---- 实时校验（不等提交） ----

  const startTzTrimmed = draft.startsAtTz.trim();
  const endTzTrimmed = draft.endsAtTz.trim();

  const live: Record<string, string> = {};
  if (startTzTrimmed !== '' && !isValidTimeZone(startTzTrimmed)) {
    live.startsAtTz = t('calendar.errInvalidTz');
  }
  if (endTzTrimmed !== '' && !isValidTimeZone(endTzTrimmed)) {
    live.endsAtTz = t('calendar.errInvalidTz');
  }
  /*
   * "结束晚于开始"的实时提示。
   * 两端都还没填全时不算 —— 那会在一张还空着的表单上先亮一条红字。
   * 判据和 schema 一样是**换算成 UTC 之后的时刻**（见文件头第 3 条）。
   */
  if (draft.startsAtLocal && startTzTrimmed && draft.endsAtLocal && endTzTrimmed) {
    const startUtc = wallClockToUtc(draft.startsAtLocal, startTzTrimmed);
    const endUtc = wallClockToUtc(draft.endsAtLocal, endTzTrimmed);
    if (startUtc !== null && endUtc !== null && endUtc <= startUtc) {
      live.endsAtLocal = draft.allDay
        ? t('calendar.errAllDayEndOrder')
        : t('calendar.errEndBeforeStart');
    }
  }

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

  const startValue = draft.allDay ? dateOf(draft.startsAtLocal) : draft.startsAtLocal;
  const endValue = draft.allDay ? dateOf(draft.endsAtLocal) : draft.endsAtLocal;

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

        <Field id="cal-stage" label={t('calendar.fields.stage')} hint={t('calendar.hintStage')}>
          <select
            id="cal-stage"
            className="mcsr-field__input"
            value={draft.stage}
            onChange={(e) => set('stage', e.target.value)}
          >
            {/* 空选项 = 不填。stage 是可选的，而"必须选一个"会逼录入者猜一个错的 */}
            <option value="">{t('calendar.stageNone')}</option>
            {EVENT_STAGES.map((s) => (
              <option key={s} value={s}>
                {t(`calendar.stage.${s}`)}
              </option>
            ))}
          </select>
        </Field>

        {/*
          011 新增的两维。和 stage 放同一排，因为它们是同一类东西：
          **都是可空的单选标签**，都用来让筛选更准。

          ⚠️ 两处都保留了"不填"的空选项，而且文案和 stage 那条不同：
          stage 那条说的是"不填"，这两条说的是**"不适用"** ——
          因为排位节点这类事件本来就没有专业程度可言，
          "不填"会让录入者觉得自己漏了一项，而"不适用/不限"才是事实。
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
            onChange={(e) => set('scope', e.target.value)}
          >
            <option value="">{t('calendar.dimNone')}</option>
            {EVENT_SCOPES.map((s) => (
              <option key={s} value={s}>
                {t(`calendar.scope.${s}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>

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

      <div className="formrow">
        <Field
          id="cal-starts"
          label={t('calendar.fields.startsAt')}
          hint={t('calendar.hintStartsAt')}
        >
          <input
            id="cal-starts"
            className="mcsr-field__input"
            /*
             * ⚠️ 值是**原样的墙钟字符串**，不是 `new Date(...)` 的结果。
             *    `<input type="datetime-local">` 的 value 恰好就是
             *    'YYYY-MM-DDTHH:mm'，和数据库里那个字段一字不差。
             *    中间过一次 Date 就会引入"按本机时区解释"这个陷阱
             *    （calendar-time.ts 开头专门警告过它）。
             */
            type={draft.allDay ? 'date' : 'datetime-local'}
            value={startValue}
            onChange={(e) => setStart(e.target.value)}
            required
          />
          {fieldError('startsAtLocal')}
        </Field>

        <Field
          id="cal-starts-tz"
          label={t('calendar.fields.timezone')}
          hint={tzHint(startTzTrimmed, t('calendar.hintTimezone'))}
        >
          <input
            id="cal-starts-tz"
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

      <div className="formrow">
        <Field
          id="cal-ends"
          label={t('calendar.fields.endsAt')}
          hint={draft.allDay ? t('calendar.hintEndsAtAllDay') : t('calendar.hintEndsAt')}
        >
          <input
            id="cal-ends"
            className="mcsr-field__input"
            type={draft.allDay ? 'date' : 'datetime-local'}
            value={endValue}
            onChange={(e) => setEnd(e.target.value)}
          />
          {fieldError('endsAtLocal')}
        </Field>

        <Field
          id="cal-ends-tz"
          label={t('calendar.fields.endsTz')}
          hint={tzHint(endTzTrimmed, t('calendar.hintEndsTz'))}
        >
          <input
            id="cal-ends-tz"
            className="mcsr-field__input"
            list="cal-tz-options"
            value={draft.endsAtTz}
            onChange={(e) => set('endsAtTz', e.target.value)}
            placeholder="Asia/Shanghai"
            autoComplete="off"
            spellCheck={false}
          />
          {fieldError('endsAtTz')}
        </Field>
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
        · ⚠️ 那个"什么都不选"的空选项**借用** `calendar.stageNone`（它的值就是
          「不填」）：本轮**不新增词条**（`packages/shared` 不在本任务范围内）。
          下一轮补上 `calendar.seriesNone` 时只换**这一处** —— `t()` 调用全仓共两处
          （stage 自己那个下拉框 + 这一处）。⚠️ 本注释自己也写着这个词条名，
          所以 grep `calendar.stageNone` 会得到**三**处命中，别把注释当成第三处引用。
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
          <option value="">{t('calendar.stageNone')}</option>
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
 * ⚠️ 关键：抽出来之后 `buildEvent` **必须真的调它**。如果测试用这个函数、生产走另一份
 *    等价代码，那断言证明的就不是用户实际执行的那条路 —— 这正是"守卫因为错误的原因通过"。
 *
 * ⚠️ 空串 → `null` 的转换（`seriesId` / `stage` / `level` / `scope` / `titleEn` /
 *    `url` / `location` / `endsAt*` / `noteToReviewer`）**只在这一处**做：草稿里空串
 *    表示"没填"，而服务端 schema 要的是 `null`。散在多处就会出现两个字段对"没填"
 *    的理解不一致，而两边都不报错。
 *
 * ⚠️ **刻意不写返回类型**（靠推断）：这里产出的是**待校验的输入**，而 schema 的
 *    `CalendarEventInput` 是**输出**（`tags` 已是枚举、`allDay` 已填上默认值）。
 *    标成输出类型会逼出 `as` 转型，而转型恰好会把这个函数最该被检查的地方
 *    （"映射出来的东西 schema 收不收"）**静默关掉**。
 *    ⚠️ 也别去取 schema 的输入类型：`apps/web` 的 dependencies 里**没有 zod**
 *    （只 `import type` 也解析不到）。表单草稿里 `level`/`scope`/`stage` 本来就是
 *    **普通字符串** —— 收紧成枚举会让"用户选了非法值"变成编译错误，而不是一条界面红字。
 */
export function calendarEventInputOf(draft: CalendarDraft) {
  return {
    title: draft.title.trim(),
    titleEn: draft.titleEn.trim() || null,
    descriptionMd: draft.descriptionMd,
    startsAtLocal: draft.startsAtLocal,
    startsAtTz: draft.startsAtTz.trim(),
    // ⚠️ 结束时间这一对**原样透传**，不做"缺一个就一起丢掉"的补救。
    //    丢掉的话，用户填了结束时区忘了时间会看到一条"什么都没说"的失败，
    //    而 schema 里本来就有一条专门解释这件事的规则。
    endsAtLocal: draft.endsAtLocal || null,
    endsAtTz: draft.endsAtTz.trim() || null,
    allDay: draft.allDay,
    url: draft.url.trim() || null,
    location: draft.location.trim() || null,
    tags: draft.tags,
    stage: draft.stage || null,
    // 空串 → null（草稿里三个维度都是空串表示"没填"）
    level: draft.level || null,
    scope: draft.scope || null,
    // ③：同上，空串 → null（"不归到任何系列"）
    seriesId: draft.seriesId || null,
    lang: draft.lang,
    noteToReviewer: draft.noteToReviewer.trim() || null,
  };
}
