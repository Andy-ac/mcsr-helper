import { CONTINENTS } from '@mcsr/shared';
import type { EventSlot, EventSlotInput } from '@mcsr/shared/calendar';
import { EventSlotInputSchema } from '@mcsr/shared/calendar';
import { wallClockToUtc } from '@mcsr/shared/calendar-time';
import type { ReviewDetail } from '@mcsr/shared/review';
import { useTranslation } from 'react-i18next';
import { Markdown } from '@/components/Markdown';
import { fetchCalendarSeries } from '@/lib/api';
import { eventWhenAll } from '@/lib/calendarFormat';
import { useAsync } from '@/lib/useAsync';

/**
 * 日历事件的审核视图 —— 日历对"这类内容长什么样、哪几个字段值得看"的回答。
 *
 * 和 ResourceReviewView 是同一套结构的第二份实现，但有三处**日历特有**的东西，
 * 而且三处都不是装饰：
 *
 *   1. **已结束的事件要显著标出来**（Q4c）。
 *      用户明确要求"过去的事件仍然进审核队列"（而不是自动过期不进队列），
 *      所以队列里**真的会有**三个月前那场比赛。不标出来的话，审核员会把注意力
 *      花在"这时间是不是填错了"上面 —— 而对一个已经结束的活动，"该不该收"
 *      这个判断根本没法做，答案也无关紧要。
 *
 *   2. **时间要按用户填的时区原样显示**，不做本地化转换。
 *      审核员核对的是"和赛事公告上写的一样不一样"，而公告上写的是当地时间。
 *      转成审核员自己的时区反而让他没法核对 —— 他得先在心里做一次换算，
 *      而那正是最容易出错的一步。
 *
 *   3. **枚举值要显示成人话**，不能把 `RANKED_MILESTONE` 这种原始值摆出来。
 *      同一个东西在同一屏里出现两种写法（"排位节点" vs `RANKED_MILESTONE`），
 *      读的人要额外对一次号。
 *      ⚠️ 2026-09-13 起「轮次」（`stage`）不再填写、也不再显示，留下的是
 *         标签 + 专业程度 + 参与范围 + 参与范围明细 + 参赛门槛。
 *
 * ⚠️ 这些枚举的文案走 `calendar.tag.*` / `calendar.level.*` / `calendar.scope.*` /
 *    `calendar.access.*` / `calendar.continent.*` / `calendar.country.*` 词条，
 *    **不用** `shared/calendar.ts` 里的 `CALENDAR_TAG_LABELS` 这类映射 ——
 *    那些映射里写死的是中文，英文界面下会冒出一句中文，
 *    而这类问题只在切语言时才出现，正常路径的测试永远看不到。
 *    （词条的对齐由 services/api/src/i18n-keys.test.ts 守着。）
 *
 * ---------------------------------------------------------------------------
 * ⚠️⚠️ 这份「字段清单」是**手写**的，而手写清单漏一项**不会报错**
 * ---------------------------------------------------------------------------
 * `FIELDS` 里漏掉一个键的后果是"审核员根本看不到那一项"—— 没有异常、没有警告，
 * 只是那一格永远不存在。这一份**已经漏过**：015 的 `scheduleText`（后来整个字段
 * 都没了）和 ③ 的 `seriesId`（下面单开了一行）。
 *
 * 用户对 Q12 的裁决是**只把漏掉的行补上**，不把它改成"遍历 payload 的键"：
 * 遍历出来的顺序是键的插入顺序（没有阅读顺序可言），还会把 `noteToReviewer`
 * 这类**不属于内容**的键一起摆出来。⇒ 漏项只能靠"加字段时同时加这里"这条纪律，
 * 以及 `FIELDS` 每一项上的注释。
 */

type Translate = (key: string) => string;

/** 快照 payload 的一行。取值前必须先判断类型再取（见 shared/review.ts 的说明）。 */
type Row = Record<string, unknown>;

/** 快照 payload 在界面上的字段清单。顺序 = 审核员判断时的实际阅读顺序。 */
const FIELDS: {
  key: string;
  labelKey: string;
  /**
   * 取值器。默认是 `row[key]`，只有**跨键合成**的行需要它（现在只有「比赛时间」）。
   *
   * ⚠️ 它返回的东西同时决定两件事：这一行**有没有内容**（空 ⇒ 显示 `—`），
   *    以及"改动对比"里拿哪两个值去比（`same(before, after)`）。
   *    所以它返回的必须是**能直接比较**的东西 —— 对比赛时间来说就是那一串文本，
   *    而不是 `slots` 数组（数组比较要靠 JSON.stringify，而它比较的是**格式**，
   *    两个内容相同、键顺序不同的数组会被判成"改了"）。
   */
  pick?: (row: Row, t: Translate) => unknown;
  /**
   * 值的显示形式。第三个参数是**整行** —— 「参与范围明细」那一条要靠它才知道
   * 自己该用大洲还是国家那套词条（前缀由同一行的 `scope` 决定，见 `detailLabels`）。
   */
  format?: (value: unknown, t: Translate, row: Row) => string;
}[] = [
  { key: 'title', labelKey: 'calendar.fields.title' },
  { key: 'titleEn', labelKey: 'calendar.fields.titleEn' },
  /*
   * ★ 「比赛时间」—— **一行写全所有段**（2026-09-13）。
   *
   * ⚠️ 它取不到 `row[key]`：新快照把时间放在 `slots` 里，而 017 之前的快照只有
   *    `startsAtLocal` / `endsAtLocal` 那一对（见 services/api 的 `payloadSlots`）。
   *    **这正是这一行必须存在的理由**：原来那四行（开始 / 时区 / 结束 / 结束时区）
   *    在新快照上会**全部显示成 `—`** —— `EventPayload` 里根本没有 `startsAtLocal`
   *    这个键了。而"审核员看不到时间"不会报错，只会让审核页面看起来什么都有、
   *    唯独没法核对公告。
   *
   * ⚠️ 用 `eventWhenAll` 而不是 `eventWhen`：`eventWhen` 只给**第一段**，而多段赛事
   *    （用户举的例子就是"分三个周末打"）在审核页上必须**全都看得见** ——
   *    审核员核对的是"和公告上写的一样不一样"，少显示两段等于让他少核对两段，
   *    而那种漏检没有任何提示。卡片上那种"共 N 段"的写法（只有一行宽）在这里
   *    也不合适：审核页有整行的空间，直接列出来比让审核员自己去数更省事。
   */
  {
    key: 'slots',
    labelKey: 'calendar.fields.slots',
    pick: (row, t) => whenText(row, t('calendar.slotSeparator')),
  },
  /*
   * 时区。⚠️ 它**留在自己的一行**上（不并进「比赛时间」）：整条事件只有一个时区，
   * 而审核员核对时最常出的错就是"时间对、时区不对" —— 并进那一行之后，
   * 它会被埋在中间，一眼扫不过去。
   * ⚠️ 2026-09-13 起没有「结束时区」这一行了：新模型里每一段共用同一个时区
   * （用户原话"时区放在最上面，只填一次"），旧快照里那个 `endsAtTz` 属于 011/015
   * 的模型。留着一行**在所有新快照上都是 `—`** 的「结束时区」，比删掉更容易让人
   * 以为这一格漏了渲染。
   */
  { key: 'startsAtTz', labelKey: 'calendar.fields.timezone' },
  {
    key: 'allDay',
    labelKey: 'calendar.fields.allDay',
    format: (v, t) => (v === true ? t('calendar.yes') : t('calendar.no')),
  },
  {
    key: 'tags',
    labelKey: 'calendar.fields.tags',
    // 标签是枚举，要翻成人话（见文件头第 3 条）
    format: (v, t) =>
      Array.isArray(v) ? v.map((x) => t(`calendar.tag.${String(x)}`)).join('、') : '—',
  },
  /*
   * 011 新增的两维 + 2026-09-13 新增的参赛门槛与范围明细。
   *
   * ⚠️ 顺序是有意的：标签 → 专业程度 → 参与范围 → 参与范围明细 → 参赛门槛，
   *    和 ICS 的 CATEGORIES 用的是同一个顺序。同一份内容在两个地方按不同顺序排列，
   *    读的人会以为它们是不同的东西。
   *
   * ⚠️ 这几维**都可能为空**（排位节点没有门槛、没有范围可言），而 `display()` 对空值
   *    直接显示 `—`、不会调到 format —— 所以这里不需要再兜一次空值，
   *    但要知道"显示成 — 是正确的"而不是漏了渲染。
   *
   * ⚠️ 「轮次」（`stage`）**已从这份清单里删掉**（2026-09-13）：那一维不再填写，
   *    留着它只会在旧快照上冒出一格别人都没有的值。`calendar.fields.stage` /
   *    `calendar.stage.*` 这两组词条也**已经删了**（同一轮）—— 所以下面这张表里
   *    不再有任何一处指向它们。
   *    ⚠️ 唯一的例外在 `apps/web/scripts/gridrender.tsx`：那里有一条"界面上没有轮次"
   *      的反向断言，它的**针是字面量**（`'轮次'` / `'FINAL'`）而**不是** `t()` ——
   *      词条删掉之后拿 `t()` 当针会原样返回键名，那条断言就会静默恒真。
   */
  {
    key: 'level',
    labelKey: 'calendar.fields.level',
    format: (v, t) => t(`calendar.level.${String(v)}`),
  },
  {
    key: 'scope',
    labelKey: 'calendar.fields.scope',
    format: (v, t) => t(`calendar.scope.${String(v)}`),
  },
  /*
   * ★ 「参与范围明细」（2026-09-13）—— 与「参与范围」**紧挨着**：单独看一列
   *    `ASIA` / `BR` 谁也不知道那是"范围大了"还是"范围小了"，两行摆在一起才是
   *    "范围 = 大洲，具体是亚洲和大洋洲"这一句完整的话。
   */
  {
    key: 'scopeDetail',
    labelKey: 'calendar.fields.scopeDetail',
    format: (v, t, row) => detailLabels(v, row.scope, t),
  },
  /*
   * ★ 「参赛门槛」（2026-09-13）—— 与「专业程度」**不是一回事**（见 i18n 里
   *    `calendar.access` 的注释）：门槛说的是"怎么进得去"，水平说的是"有多正式"。
   *    审核员判断"这条该不该收"时，两者都要看。
   */
  {
    key: 'access',
    labelKey: 'calendar.fields.access',
    format: (v, t) => t(`calendar.access.${String(v)}`),
  },
  { key: 'location', labelKey: 'calendar.fields.location' },
  { key: 'url', labelKey: 'calendar.fields.url' },
  {
    key: 'lang',
    labelKey: 'calendar.fields.lang',
    format: (v, t) => (v === 'en' ? t('resources.langEn') : t('resources.langZh')),
  },
];

/** 任意值 → 可显示的字符串。数组用顿号连起来（中文习惯）。 */
function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.join('、') : '—';
  return String(value);
}

/**
 * 一行在界面上的值。
 *
 * ⚠️ `row` 要一起传下去：`format` 只拿到"这一格的值"的话，有些行**显示不出来** ——
 *    「参与范围明细」用的是大洲还是国家那套词条，取决于**同一行的 `scope`**。
 */
function display(value: unknown, field: (typeof FIELDS)[number], t: Translate, row: Row): string {
  if (field.format && value !== null && value !== undefined && value !== '') {
    return field.format(value, t, row);
  }
  return text(value);
}

/** 大洲代码的集合（`Set` 免掉一次 `as readonly string[]` 的断言，也顺手 O(1)）。 */
const CONTINENT_SET: ReadonlySet<string> = new Set<string>(CONTINENTS);

/**
 * 「参与范围明细」→ 人话（`calendar.continent.*` / `calendar.country.*`）。
 *
 * ⚠️⚠️ 词条前缀**不能写死一个**。明细里存的是大洲代码（`ASIA`）或国家代码（`BR`），
 *    选哪一套由 `scope` 说；而 schema 刻意**不强制**两者联动（见 shared/calendar.ts
 *    的 `scopeDetail` 注释：选 GLOBAL 却填了明细不会报错），所以这里让 `scope`
 *    只做**首选**，认不出时按代码本身属于哪一份名单来判 —— 两份名单没有交集
 *    （`ASIA` 不会出现在国家里），这个判断是确定的。
 *    写死 `country` 的后果是显示成 `calendar.country.ASIA` 那个不存在的 key，
 *    而 i18next 会把它**原样**印在页面上，且只出现在选了大洲的那几条活动上。
 *
 * ⚠️ 这段与 `routes/CalendarDetail.tsx` 里的同名一段是**刻意重复**的：两个页面拿到的
 *    数据形状不同（这里是"先判断类型再取"的 `unknown`，那边是类型齐全的
 *    `CalendarEvent`）。真正该共享的那一天，它应该落在 `lib/calendarFormat.ts` ——
 *    那个文件由另一个人拥有，本轮不动它。（改这里时**同时**看那一边。）
 */
function detailLabels(value: unknown, scope: unknown, t: Translate): string {
  if (!Array.isArray(value) || value.length === 0) return '—';
  const group = scope === 'CONTINENT' ? 'continent' : scope === 'COUNTRY' ? 'country' : null;
  return value
    .map((code) => {
      const raw = String(code);
      const prefix = group ?? (CONTINENT_SET.has(raw) ? 'continent' : 'country');
      return t(`calendar.${prefix}.${raw}`);
    })
    .join('、');
}

/**
 * 快照里的时间段 —— **含旧快照的兜底**。
 *
 * ⚠️ 这条规则在仓里有**三份**（`services/api/src/calendar/events.ts` 的 `payloadSlots`、
 *    `services/api/src/review/registry.ts` 的 `legacySlots`、这里），它们必须一起改：
 *    新快照把时间放在 `slots` 里，而 017 之前的快照只有 `startsAtLocal`/`endsAtLocal`
 *    那一对 —— 而线上**真的还有**那种快照（017 之前提交、一直没审的事件）。
 *    ⚠️ 前端这一份只能靠人记住：服务端那两个函数都是模块私有的，
 *       而"审核页看不见时间"不会报错，只会让审核员没法核对公告。
 * ⚠️ 读不出来时返回**空数组**（不是抛）：一条坏快照不该让整个审核页白屏 ——
 *    这与 `legacySlots` 的失败策略一致，而写路径那边（`payloadSlots`）是**抛**的，
 *    因为它绝不能"编一个时间"写进库里。
 */
function payloadSlots(row: Row): EventSlotInput[] {
  const parsed = EventSlotInputSchema.array().safeParse(row.slots);
  if (parsed.success && parsed.data.length > 0) return parsed.data;
  const legacy = row.startsAtLocal;
  if (typeof legacy === 'string' && legacy !== '') {
    const end = typeof row.endsAtLocal === 'string' ? row.endsAtLocal : null;
    return [{ startsAtLocal: legacy, endsAtLocal: end }];
  }
  return [];
}

/**
 * `EventSlotInput[]` → `eventWhenAll` 要的形状（**读路径**的 `EventSlot`，带两个 UTC）。
 *
 * ⚠️ 那两个 UTC 必须**如实算出来**，不能随便填 0：填 0 的话，哪天格式化改成
 *    "按 UTC 排序"或"取最早那一段"，审核页会静默地按 1970 年排 ——
 *    而 1970 这个数字在界面上根本不会出现，只有顺序是错的。
 * ⚠️ 开始时间算不出来（时区名非法）时**整段丢掉**，而不是编一个时间：
 *    宁可少显示一段，也不要让审核员拿一段不存在的赛程去和公告核对。
 */
function toEventSlots(slots: EventSlotInput[], tz: string): EventSlot[] {
  return slots.flatMap((slot) => {
    const startsAtUtc = wallClockToUtc(slot.startsAtLocal, tz);
    if (startsAtUtc === null) return [];
    return [
      {
        startsAtLocal: slot.startsAtLocal,
        endsAtLocal: slot.endsAtLocal ?? null,
        startsAtUtc,
        // 结束时间算不出来时留 null：那一格的**本地时间**仍然照原样显示，
        // 而审核员要核对的正是本地时间。
        endsAtUtc: slot.endsAtLocal ? wallClockToUtc(slot.endsAtLocal, tz) : null,
      },
    ];
  });
}

/**
 * 「比赛时间」→ 一行文本（`eventWhenAll`，**每一段都写出来**）。
 *
 * ⚠️ 复用 `lib/calendarFormat.ts` 的 `eventWhenAll`，而不是在这里再拼一遍字符串：
 *    那就成了第二份"同一天只显示钟点 / 整天事件不显示时间"的规则，
 *    两份一旦不一致，表现只是"详情页和审核页上的时间长得不一样"，**不会有任何报错**。
 * ⚠️ 空串表示"一段都读不出来"，由 `text()` 统一变成 `—`（不在这里重复决定空值长什么样）。
 */
function whenText(row: Row, separator: string): string {
  const tz = typeof row.startsAtTz === 'string' ? row.startsAtTz : '';
  const slots = toEventSlots(payloadSlots(row), tz);
  if (slots.length === 0) return '';
  return eventWhenAll({ startsAtTz: tz, allDay: row.allDay === true, slots }, separator);
}

/**
 * 两个值是否算"一样"。
 *
 * ⚠️ 用 JSON 比较而不是 `===`：`tags` 是数组，`===` 永远为假，
 *    于是每一次修改都会被标成"标签变了"，包括那些根本没动标签的修改。
 *    一个永远亮着的"已改动"标记等于没有标记。
 *    （这条和 ResourceReviewView 里是同一个坑，同一个解法。）
 */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * 这一版的事件**描述的时刻**是否已经过去。
 *
 * ⚠️ 从快照现算，而不是读 `detail.item.expired`：
 *    `item.expired` 是**服务端在响应那一刻**算的，用的是服务器时钟；
 *    而审核员可能在这个页面上坐了很久（页面不自动刷新）。两者通常一致，
 *    但"已结束"必须显示**现在**的判断 —— 开着页面过了两小时、期间比赛结束了，
 *    那一行应该立刻是对的，而不是停在打开页面时的那一刻。
 *
 * 判据与 shared 的 `isEventPast` 一致：有结束时间按结束时间算，否则按开始时间算。
 * ⚠️ 多段之后取的是**最后一段**的结束（只要还有一段没结束，这场赛事就没结束）——
 *    与 `services/api` 的 `eventPayloadIsPast` 逐字一致。
 * ⚠️⚠️ 它原来读的是 `pending.startsAtLocal`，而那个键**在 017 之后的新快照里已经不存在**
 *    （时间搬进了 `slots`）⇒ 新提交的多段赛事永远算出 `false`，
 *    Q4c 那个「已结束」标记**静默失效**（看不出任何异常，只是那一条不再被标出来）。
 *    所以这里必须走 `payloadSlots`：它是"新快照 / 旧快照"的唯一判据。
 * 算不出来（时区名非法）时返回 false，也就是宁可漏标一个，也不要把正常事件标成历史。
 */
function isPast(pending: Row): boolean {
  const startsAtTz = pending.startsAtTz;
  if (typeof startsAtTz !== 'string') return false;

  let latest: number | null = null;
  for (const slot of payloadSlots(pending)) {
    const start = wallClockToUtc(slot.startsAtLocal, startsAtTz);
    if (start === null) return false;
    const end = slot.endsAtLocal ? wallClockToUtc(slot.endsAtLocal, startsAtTz) : null;
    const point = end ?? start;
    if (latest === null || point > latest) latest = point;
  }

  if (latest === null) return false;
  return latest < Date.now();
}

export function CalendarReviewView({ detail }: { detail: ReviewDetail }) {
  const { t } = useTranslation();
  const { pending, live } = detail;
  const isEdit = live !== null;
  const past = isPast(pending);

  const descriptionMd = typeof pending.descriptionMd === 'string' ? pending.descriptionMd : '';
  const liveDescription = typeof live?.descriptionMd === 'string' ? live.descriptionMd : '';
  const bodyChanged = isEdit && !same(liveDescription, descriptionMd);

  /*
   * ★ 系列（需求③ / Q20）：要显示的是**名字**，而快照里只有 `seriesId`。
   *
   * ⚠️ 名字不在快照里（快照里只有一个 id，见 shared/calendar.ts 的说明），
   *    所以只能拿 id 去 `GET /api/calendar/series` 查 —— 这正是用户对 Q20 的裁决 (a)。
   * ⚠️ hooks **不能**条件调用：所以 `useAsync` 无条件执行，由 loader 在"两个 id 都没有"
   *    时直接返回 null（连请求都不发）。写成 `seriesId ? useAsync(...) : ...`
   *    会在审核员切换条目时改变 hook 的顺序，而 React 对这种错误的报错发生在**下一次**
   *    渲染，指向的位置和真正的原因完全对不上。
   * ⚠️ 一次请求同时喂**待审版与线上版**，不查两次：那份列表本来就是全量的
   *    （`fetchCalendarSeries` 刻意不带分页，见它的注释），而分两次请求还会多出一个
   *    "一边到了、一边还没到"的中间态 —— 在"改动前后对比"里，一个空白的旧值
   *    看起来就是"把系列删掉了"。
   */
  const pendingSeriesId = typeof pending.seriesId === 'string' ? pending.seriesId : null;
  const liveSeriesId = typeof live?.seriesId === 'string' ? live.seriesId : null;

  const seriesList = useAsync(
    async (signal) => {
      if (pendingSeriesId === null && liveSeriesId === null) return null;
      return await fetchCalendarSeries(signal);
    },
    [pendingSeriesId, liveSeriesId],
  );

  /**
   * 系列 id → 界面上显示的东西。
   *
   * ⚠️ 名字查不到时显示 **id 本身**，而不是留空、也不是写一句"未知"：
   *      · 查不到只有两种原因 —— 系列被删了、或者列表请求失败了。两种情况下审核员
   *        都还能继续判断（他至少知道"这一条挂在某个系列上"），而**空白**会让他
   *        以为这一条没填系列 —— 那是两个完全不同的结论；
   *      · 显示 id 让"这个名字没了"**看得见**（`reviewview__raw` 会把它显示成等宽小字）。
   *    ⚠️ 三种状态（还没查到 / 查不到 / 请求失败）刻意显示成**同一个东西**：
   *       对审核员来说它们的信息量完全一样（"名字暂时拿不到"），而在一个用来核对
   *       公告的页面上，一个会闪的"加载中…"比一个 id 更碍事。
   */
  function seriesName(id: string | null): { text: string; resolved: boolean } {
    if (id === null) return { text: '—', resolved: true };
    const list = seriesList.status === 'ok' ? seriesList.data : null;
    const found = list?.items.find((s) => s.id === id);
    return found ? { text: found.name, resolved: true } : { text: id, resolved: false };
  }

  const pendingSeries = seriesName(pendingSeriesId);
  const liveSeries = seriesName(liveSeriesId);
  const seriesChanged = isEdit && !same(liveSeriesId, pendingSeriesId);

  return (
    <div className="reviewview">
      {/*
        ★ Q4c：已结束的条目必须在这里、而且**在内容之前**标出来。
        放在内容之后的话，审核员已经把几千字读完、判断也做完了才看到它。
      */}
      {past ? (
        <div className="reviewview__past">
          <span className="reviewview__pastlabel">{t('calendar.pastBadge')}</span>
          <p className="reviewview__pasttext">{t('calendar.pastExplain')}</p>
        </div>
      ) : null}

      {/* 提交者给审核员的话 —— 和资源库一样放在内容前面 */}
      {detail.note ? (
        <div className="reviewview__note">
          <span className="reviewview__notelabel">{t('review.noteFromSubmitter')}</span>
          <p className="reviewview__notetext">{detail.note}</p>
        </div>
      ) : null}

      <dl className="reviewview__grid">
        {FIELDS.map((field) => {
          /*
           * ⚠️ `pick` 是给**跨键合成**的行用的（「比赛时间」：新快照读 `slots`，
           *    旧快照读 `startsAtLocal`/`endsAtLocal`）。默认的 `row[key]` 在旧快照上
           *    取到 `undefined`，那一行会显示成 `—` —— 看起来完全正常，
           *    但审核员会因此以为"这一条没填时间"。
           */
          const before = field.pick ? field.pick(live ?? {}, t) : live?.[field.key];
          const after = field.pick ? field.pick(pending, t) : pending[field.key];
          const changed = isEdit && !same(before, after);
          return (
            <div key={field.key} className={`reviewview__row${changed ? ' is-changed' : ''}`}>
              <dt>{t(field.labelKey)}</dt>
              <dd>
                {changed ? (
                  <span className="reviewview__before">
                    {display(before, field, t, live ?? {})}
                  </span>
                ) : null}
                <span className="reviewview__after">{display(after, field, t, pending)}</span>
              </dd>
            </div>
          );
        })}

        {/*
          ★ 系列（需求③ / spec D3.10）。

          ⚠️ 它**只能单开一行、不能进 `FIELDS`**：那张表是**同步**的取值/格式化表，
            而这一行的显示值要等一次网络往返（上面那个 `useAsync`）。塞进 FIELDS
            就只能显示原始 id —— 而用户对 Q20 的裁决恰恰是"按 id 去查名字再显示"。
            代价是它排在最后：审核员读的顺序因此是"标题 → 时间 → 各维度 → 系列"。
            对核对公告的人来说，系列是**归类**信息，放在末尾不影响前几行的核对。

          ⚠️ 线上版的名字用**同一次请求**解析（见上面 `seriesList` 的注释），
            否则"改系列"这个改动在审核页上根本看不出来 —— 而"某次修改把活动从
            系列里拿掉了"正是最需要审核员看一眼的那种改动。
        */}
        <div className={`reviewview__row${seriesChanged ? ' is-changed' : ''}`}>
          <dt>{t('calendar.seriesField')}</dt>
          <dd>
            {seriesChanged ? (
              <span
                className={`reviewview__before${liveSeries.resolved ? '' : ' reviewview__raw'}`}
              >
                {liveSeries.text}
              </span>
            ) : null}
            <span
              className={`reviewview__after${pendingSeries.resolved ? '' : ' reviewview__raw'}`}
            >
              {pendingSeries.text}
            </span>
          </dd>
        </div>
      </dl>

      {/*
        ⚠️ 快照里这个字段叫 `descriptionMd`，而资源库那份叫 `body`。它们不是
           同一个东西、也不该被合并：日历的事件简介是"这场比赛是什么"的几句话，
           资源库的正文是几千字的说明。共用一个 key 名会让人以为两个视图可以
           合并成一个 —— 而合并之后就得为两种长度完全不同的内容挑一种排版。
      */}
      <section className="reviewview__body">
        <h3 className="reviewview__subtitle">
          {t('calendar.fields.description')}
          {bodyChanged ? <span className="reviewview__flag">{t('review.changed')}</span> : null}
        </h3>
        <div className="reviewview__pane">
          {descriptionMd ? <Markdown>{descriptionMd}</Markdown> : <p className="muted">—</p>}
        </div>

        {/*
          旧版简介默认折叠 —— 理由与资源库那份相同：不折叠的话，一次只改了一个
          错字的修改会变成两大段文字摆在一起，审核员要自己找不同。
        */}
        {bodyChanged && liveDescription ? (
          <details className="reviewview__old">
            <summary>{t('review.showOldBody')}</summary>
            <div className="reviewview__pane reviewview__pane--old">
              <Markdown>{liveDescription}</Markdown>
            </div>
          </details>
        ) : null}
      </section>
    </div>
  );
}
