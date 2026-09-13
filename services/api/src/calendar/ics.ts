/**
 * ICS（RFC 5545）导出。
 *
 * ---------------------------------------------------------------------------
 * 为什么这里要这么小心
 * ---------------------------------------------------------------------------
 * 验收标准是「**订阅的 ICS 能在手机自带日历里看到**」——
 * 也就是说，这个文件的正确性是由**别人的日历客户端**来判定的，而不是我们自己。
 *
 * 而日历客户端对格式错误的态度是**沉默**：能解析就显示，不能解析就**什么都不显示**。
 * 没有报错、没有日志、没有提示 —— 用户看到的是"订阅了但日历是空的"，
 * 然后他会以为是我们没做，而不是我们做错了。
 *
 * 所以下面每一条规则都是照着 RFC 5545 原文来的，而且都有测试守着。
 * 原文核实记录见 docs/m4-ics-notes.md。
 *
 * ---------------------------------------------------------------------------
 * ⚠️⚠️ 最容易出错的一条：折行不能切在 UTF-8 多字节序列中间
 * ---------------------------------------------------------------------------
 * RFC 5545 §3.1：
 *   · 每行**不超过 75 octets**（注意是**字节**，不是字符）
 *   · 长行通过插入 CRLF + **一个空格**来折行
 *   · 折行位置是"任意两个**字符**之间"
 *
 * 并特别写了一条 Note：
 *   "It is possible for very simple implementations to generate improperly
 *    folded lines in the middle of a UTF-8 multi-octet sequence."
 *
 * 这对我们是**必修项**：赛事标题是中文，UTF-8 下一个汉字 **3 字节**，
 * 所以 **25 个汉字 = 75 字节，正好撞上限**。
 * 按字节数硬切，就会把一个汉字劈成两半 —— 手机日历里显示成乱码，
 * 或者整个文件被拒。
 *
 * 所以下面的折行实现：**按码点迭代、按字节判断是否超限、在字符边界切开**。
 * 而且测试数据必须是**中文**的 —— 用英文测试永远发现不了这个 bug
 * （ASCII 一个字符一字节，字符边界和字节边界重合）。
 */
import type { CalendarEvent } from '@mcsr/shared/calendar';

/** 单行字节上限。RFC 5545 §3.1。 */
const MAX_LINE_OCTETS = 75;

const encoder = new TextEncoder();

/**
 * 转义 TEXT 值里的特殊字符。RFC 5545 §3.3.11。
 *
 * ⚠️ **反斜杠必须第一个换**。反过来的话，先换掉的 `;` 变成 `\;`，
 *    接着换反斜杠时会把那个刚生成的反斜杠再转义一遍，得到 `\\;` ——
 *    日历客户端读出来就是一个字面反斜杠加一个分号。
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * 折行：把一行按 RFC 5545 折成不超过 75 字节的多行。
 *
 * 折出来的物理行之间是 `CRLF + 空格`；展开时那个空格会被去掉。
 *
 * ⚠️ 第一个物理行可以有 75 字节，续行因为前面多了一个空格，只能有 74 字节内容。
 *    （RFC 说的是"行不超过 75 octets 不含换行"，对续行是否把前导空格算进去
 *    存在两种读法；按 74 算在两种读法下都合法，所以取保守的那一侧。）
 */
export function foldIcsLine(line: string): string {
  if (encoder.encode(line).length <= MAX_LINE_OCTETS) return line;

  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  let limit = MAX_LINE_OCTETS;

  // for...of 按**码点**迭代：代理对（emoji 等）不会被拆开，
  // 而字节长度单独累加 —— 这两件事分开做，正是"按字符切、按字节判断"的写法。
  for (const char of line) {
    const charBytes = encoder.encode(char).length;
    if (currentBytes + charBytes > limit) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
      limit = MAX_LINE_OCTETS - 1; // 续行前面有一个空格
    }
    current += char;
    currentBytes += charBytes;
  }
  if (current) chunks.push(current);

  return chunks.join('\r\n ');
}

/** UTC 毫秒 → `20260830T120000Z`。RFC 5545 §3.3.5 的 UTC 形式。 */
export function formatIcsDateTime(utcMs: number): string {
  const d = new Date(utcMs);
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/** UTC 毫秒 → `20260905`（DATE 形式，整天事件用）。 */
export function formatIcsDate(utcMs: number): string {
  const d = new Date(utcMs);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
}

/**
 * 本地墙钟字符串 `YYYY-MM-DDTHH:mm` → `20260905`。
 *
 * ⚠️⚠️ **整天事件的日期必须从墙钟取，绝不能从 `startsAtUtc` 取。**
 *
 * 这是一个真实存在过的 bug（探针实测，见下）：原来写的是
 * `formatIcsDate(event.startsAtUtc)`，而 `startsAtUtc` 是由「本地墙钟 + 时区」
 * 算出来的。北京 8 月 30 日 00:00 → UTC 8 月 29 日 16:00 → `getUTCDate()` = 29，
 * 于是**东八区的整天事件整体提前一天**：用户填 8 月 30 日，手机上显示 8 月 29 日。
 *
 * ⚠️ 而它**不会报错，也很难发现**：8 月 29 日和 8 月 30 日看起来都完全正常
 *    （谁记得清那场比赛到底是哪一天？）。而且**西边的时区碰巧是对的**
 *    （纽约 8/30 00:00 = UTC 8/30 04:00 → 取到 30），所以开发机在哪个时区决定了
 *    这个 bug 会不会被看见 —— 这台机器上就看不见。
 *
 * 根因是**类别错误**：整天事件表达的是"日历上的某一天"，不是"一个时刻"。
 * 把日期型的东西先换算成时刻、再取回日期，等于绕了一个会丢掉原意的来回。
 * 所以这里直接读墙钟字符串的日期部分，不做任何时区换算。
 */
export function localDateToIcs(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(local);
  if (!m) return null;
  return `${m[1] as string}${m[2] as string}${m[3] as string}`;
}

/**
 * `20260905` + n 天 → `20260910`。
 *
 * 用 `Date.UTC` 做算术：`2026-08-31 + 1` 必须得到 9 月 1 日，而月份/年份进位
 * 交给 `Date` 处理比手写闰年判断可靠。全程 UTC，所以运行机器的本地时区
 * **不参与**这次计算 —— 否则同一份数据在不同机器上会得到不同的日期。
 */
export function addIcsDays(icsDate: string, days: number): string {
  const year = Number(icsDate.slice(0, 4));
  const month = Number(icsDate.slice(4, 6));
  const day = Number(icsDate.slice(6, 8));
  return formatIcsDate(Date.UTC(year, month - 1, day) + days * 24 * 3600 * 1000);
}

/** 收集若干 `NAME:value` 行（空值跳过），折行留给最后的组装做。 */
function prop(name: string, value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  return `${name}:${value}`;
}

/**
 * ★ 一段以外的**其余各段** → `RDATE` 行（需求 ⑤ 的多段时间，用户裁决 Q11=(b)）。
 *
 * ---------------------------------------------------------------------------
 * 为什么是「一个 VEVENT + RDATE」而不是"每段一个 VEVENT"
 * ---------------------------------------------------------------------------
 * 用户的原话是「允许输入多段不连续的时间」，而他看的是**手机自带日历**。
 * 每段一个 VEVENT 的话，一场分三个周末打的联赛在手机里就是**三条互不相干的日程**，
 * 标题一样、看起来像重复订阅 —— 而他心里那是"一场赛事打了三次"。
 * RDATE 是 RFC 里为这件事准备的东西（§3.8.5.2：`RDATE` 与 `DTSTART` 一起
 * 算出 recurrenceset，"The recurrence set is generated by considering the initial
 * DTSTART property along with the ... RDATE ... properties"）——
 * 于是客户端把它们显示成同一条日程的多个时间。
 *
 * ---------------------------------------------------------------------------
 * ⚠️⚠️ 定时事件必须用 `RDATE;VALUE=PERIOD:start/end`，不能写裸的 `RDATE:<DATE-TIME>`
 * ---------------------------------------------------------------------------
 * 裸 DATE-TIME 形式的 RDATE **没有时长**：RFC 5545 §3.3.5 只定义了一个"时刻"，
 * 而客户端把这样的实例按 **DTSTART 的时长**处理 —— 也就是**每一段都继承第一段**。
 * 一场"第一段两小时、第二段跨两天"的赛事于是会在手机日历里被写成两小时，
 * 第二段那两天凭空消失，**而且不报错**（显示出来的东西看起来完全正常）。
 *
 * PERIOD 形式（§3.3.9：`period-explicit = date-time "/" date-time`）把每段的
 * 开始和结束都写进去，所以**每段可以有自己的时长**。
 * RFC 的示例本身就是这个形状（§3.8.5.2 的例子）：
 *
 *     RDATE;VALUE=PERIOD:19960403T020000Z/19960404T040000Z,19960404T010000Z/PT3H
 *
 * ⚠️ `period-explicit` 明写 **"The start MUST be before the end"** ⇒
 *    零长（start == end）和倒置的段**不能**写成 PERIOD。这种段退化成裸 DATE-TIME
 *    （见下面 `points` 那一段），而它能表达"一个时间点"这件事 —— 只要 DTSTART
 *    自己也没有 DTEND（没有结束时间的单点活动正是这种形状，见 eventLines）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️⚠️ 整天事件只能用 `RDATE;VALUE=DATE:`，而且日期**必须从墙钟取**
 * ---------------------------------------------------------------------------
 * PERIOD 的值类型是 DATE-TIME（§3.3.9 的定义就是 `date-time "/" date-time`），
 * **不能**用在 DATE 上 —— 硬写会得到一个格式非法的属性，而客户端对格式错误
 * 是沉默的（整个文件可能都不显示）。所以整天事件用逗号分隔的日期列表，
 * 与 `DTSTART;VALUE=DATE` 同一个形状（RFC 的示例：
 * `RDATE;VALUE=DATE:19970101,19970120,19970217`）。
 *
 * ⚠️⚠️ 日期**从墙钟取**，不从 `startsAtUtc` 取 —— 与 DTSTART 同一条理由
 *    （见 `localDateToIcs`：从 UTC 取会让东八区的整天事件整体提前一天，
 *    而且不报错、在开发机上还看不见）。
 *
 * ---------------------------------------------------------------------------
 * ★★ 为什么一段要**展开成一天一条**，而不是只写首日
 * ---------------------------------------------------------------------------
 * 2026-09-14 修的。原来这里只输出每一段的**首日**，理由是"DATE 形式表达不了
 * 这一段有几天，所以每段继承第一段的天数"。**前半句对，后半句是错的**：
 * DATE 确实表达不了区间，但 RDATE 允许**多个值**，而每个值的时长都由
 * DTSTART/DTEND 决定（这里是 1 天）—— 把一段里的**每一天**都列出来，
 * 得到的日历实例集合与"一段连续的日子"**逐日相同**。
 *
 * ⚠️ 这不是理论问题，线上数据就是反例：`hist-playoffs-s08` 三段是
 *    08-23（1 天）、08-30~08-31（2 天）、09-06~09-10（5 天）。只写首日的话
 *    手机日历里只出现 08-23 / 08-30 / 09-06 三天，**另外 7 天全部消失** ——
 *    而订阅者看到的是一份"看起来正常"的日历，他没有任何办法知道少了什么。
 *    （DTSTART/DTEND 描述的**第一段**本来就支持跨天，所以只有"其余各段"要展开。）
 *
 * ⚠️ 规模：8 段 × 每段天数。本仓的赛程最长 5 天，一天一个值就是 40 个日期、
 *    约 360 字节 —— 会折行（`foldIcsLine` 按码点切、按字节判断），完全正常。
 *    不做上限截断：截掉的日子会**静默消失**，而"日历少几天"正是这一条要修的东西。
 *
 * ⚠️ 只有一段时**一条 RDATE 都不输出**：DTSTART 已经就是那一段，
 *    多写一条只会在客户端里多出一个重复实例（RFC 说重复实例会被忽略，
 *    但那依赖每个客户端的实现，"忽略"不是我们能指望的）。
 */
function rdateLines(event: CalendarEvent): string[] {
  const rest = event.slots.slice(1);
  if (rest.length === 0) return [];

  if (event.allDay) {
    /*
     * 取不到墙钟日期时退回 UTC 取法（与 DTSTART 那一处完全相同的兜底顺序）：
     * 那至少是一个形状合法的日期，而一个坏字段会让整份日历都不显示。
     */
    const dates: string[] = [];
    for (const slot of rest) {
      const from = localDateToIcs(slot.startsAtLocal) ?? formatIcsDate(slot.startsAtUtc);
      /*
       * 这一段的**最后一天（含）**：库里存的 `endsAtLocal` 就是含的那一天
       * （界面上的说法是"结束日期指最后一天；只占一天就留空"，与 DTSTART/DTEND
       * 那一处的语义转换是同一个来源）。留空 ⇒ 这一段只有它自己那一天。
       */
      const to =
        (slot.endsAtLocal ? localDateToIcs(slot.endsAtLocal) : null) ??
        (slot.endsAtUtc !== null && slot.endsAtUtc > slot.startsAtUtc
          ? formatIcsDate(slot.endsAtUtc)
          : from);

      // `YYYYMMDD` 是定长字符串，字典序就是时间序 —— 可以直接比大小。
      // `to < from` 是坏数据（schema 挡着）；真出现时按"一天"处理，
      // 而不是让这个循环一个值都不产出（那会让整段静默消失）。
      for (let d = from; d <= to; d = addIcsDays(d, 1)) dates.push(d);
      if (to < from) dates.push(from);
    }
    const line = prop('RDATE;VALUE=DATE', dates.join(','));
    return line ? [line] : [];
  }

  /*
   * 定时事件：有结束时间的段写成 PERIOD，没有结束时间的段（或结束不晚于开始的
   * 坏数据）写成裸 DATE-TIME。
   *
   * ⚠️ 两种值类型**必须分成两条属性**：§3.2.20 明写
   *    "The property values MUST be of a single value type. For example,
   *    a RDATE property cannot have a combination of DATE-TIME and TIME value types."
   *    混在一条里就是坏值，而坏值的后果是客户端**整条属性都不认**。
   */
  const periods: string[] = [];
  const points: string[] = [];
  for (const slot of rest) {
    const { startsAtUtc, endsAtUtc } = slot;
    if (endsAtUtc !== null && endsAtUtc > startsAtUtc) {
      periods.push(`${formatIcsDateTime(startsAtUtc)}/${formatIcsDateTime(endsAtUtc)}`);
    } else {
      points.push(formatIcsDateTime(startsAtUtc));
    }
  }

  const lines: string[] = [];
  const periodLine = prop('RDATE;VALUE=PERIOD', periods.join(','));
  if (periodLine) lines.push(periodLine);
  const pointLine = prop('RDATE', points.join(','));
  if (pointLine) lines.push(pointLine);
  return lines;
}

export interface IcsOptions {
  /** 生成时间（DTSTAMP）。测试里传固定值，运行时传 Date.now()。 */
  now: number;
  /** UID 的后缀，用域名。（UID 必须**跨刷新稳定**，否则订阅者每刷新一次就多一份重复事件。） */
  domain: string;
  /** 日历名（X-WR-CALNAME）。多数客户端会显示它。 */
  calendarName: string;
  /** 建议的刷新间隔（分钟）。 */
  refreshMinutes?: number;
}

/**
 * 单个事件 → VEVENT 的各行（**未折行**，也未加换行）。
 *
 * ★ **一条事件 = 一个 VEVENT**，即使它有最多 8 段时间（用户裁决 Q11=(b)）：
 *   DTSTART/DTEND 取**第一段**，其余各段走 `RDATE`（见 `rdateLines`）。
 *
 * 时间一律用 **UTC 形式**（`...Z`），于是完全不需要 `VTIMEZONE` 组件。
 * 这是 Q2 那个"存 UTC 派生值"的另一半收益：以 UTC 导出时，
 * 订阅者看到的是他自己时区的正确时刻，而发布方不必维护一套时区定义。
 */
function eventLines(event: CalendarEvent, opts: IcsOptions): string[] {
  const lines: string[] = ['BEGIN:VEVENT'];

  const push = (line: string | null): void => {
    if (line) lines.push(line);
  };

  /*
   * UID 必须稳定 —— 用事件 id + 域名。
   *
   * ⚠️ 用时间戳之类的东西会让每次刷新都变成"一批新事件 + 一批消失的旧事件"，
   *    订阅者的日历里会堆满重复项。
   *
   * ★ **它在多段（017）之后仍然是稳定的**，这一点值得写清楚：UID 取自
   *   `calendar_events.id`（主键，`newId()` 生成一次就不再变），**不是**由
   *   时间、段数、标题这些会变的东西算出来的。所以：
   *     · 用户给一场赛事加一段、删一段、改时间段 —— id 不变 ⇒ UID 不变 ⇒
   *       手机日历把这次改动当成**同一条日程的更新**（那条日程从"1 段"变成"3 段"），
   *       而不是"旧的那条消失了、又来了三条新的"；
   *     · 若当初把段数或第一段的时间编进 UID，上面那个操作就会让订阅者
   *       一次性收到 1 条删除 + 3 条新增 —— 而**没有任何报错**。
   *   ⇒ 这条不变量的承重处是"UID 只依赖 id"，改 UID 的拼法之前先想清楚这一点。
   */
  push(prop('UID', `${event.id}@${opts.domain}`));
  push(prop('DTSTAMP', formatIcsDateTime(opts.now)));

  /*
   * ★★ DTSTART / DTEND 取**第一段**，**不是**那对包络（`startsAt*` / `endsAt*`）。
   *
   * ⚠️⚠️ 这是多段改动里最容易静默出错的一处，而它看起来完全正常：
   *     `calendar_events` 上那对 `starts_at_*` / `ends_at_*` 是**包络**
   *     （最早那段开始 → 最晚那段结束，见迁移 017）。拿它当 DTEND 的话，
   *     一场"三个周末打三次"的赛事会被写成
   *     **从第一个周末一直连到第三个周末**的一整块日程 ——
   *     手机日历上那三天之间的工作日也全被占满了，而**没有任何报错**，
   *     用户只会觉得"这个日历怎么这么满"。
   *     ⇒ RDATE 负责"另外那几段"，而 DTEND 只描述**第一段**。
   *
   * ⚠️ `slots` 为空时退回包络（`??` 那几处）：`slotsOfRow` 保证读路径上
   *    至少有一段（017 之前的行用包络合成），所以这条兜底只在
   *    手工构造的 CalendarEvent（测试夹具、将来的调用方）上生效 ——
   *    没有它的话这里会抛 `Cannot read properties of undefined`，
   *    而一份抛异常的文件会让**整个订阅**在客户端里变成空的。
   */
  const first = event.slots[0];
  const startsAtLocal = first?.startsAtLocal ?? event.startsAtLocal;
  const startsAtUtc = first?.startsAtUtc ?? event.startsAtUtc;
  const firstEndsAtLocal = first ? first.endsAtLocal : event.endsAtLocal;
  const firstEndsAtUtc = first ? first.endsAtUtc : event.endsAtUtc;

  if (event.allDay) {
    /*
     * ⚠️⚠️ 日期从**墙钟**取，不从 UTC 时刻取 —— 理由见 localDateToIcs 的注释
     *    （从 UTC 取会让东八区的整天事件整体提前一天，而且不报错）。
     *
     * 取不到墙钟日期时（理论上不可能，Zod 已经校验过格式）退回 UTC 取法：
     * 那至少是一个形状合法的 VEVENT，而不是一个坏掉的字段 ——
     * 一个坏字段会让**整份日历**在客户端里显示不出来（客户端对格式错误是沉默的）。
     */
    const startDate = localDateToIcs(startsAtLocal) ?? formatIcsDate(startsAtUtc);
    push(prop('DTSTART;VALUE=DATE', startDate));

    /*
     * DTEND 是**不含**的那一天（RFC 5545 §3.6.1）：
     *    "9 月 5 日一天的赛事" → DTSTART 20260905 / DTEND 20260906。
     *    写成同一天的话多数客户端会显示成**零天**，或者
     *    "9 月 5 日 00:00 到 9 月 5 日 00:00" 这种看不出问题的错。
     *
     * ⚠️ 所以这里要做一次**语义转换**，而且是整件事里最容易搞反的一步：
     *    库里存的 `ends_at_local` 是**用户填的最后一天（含）**
     *    （界面上的说法是"结束日期指最后一天；只占一天就留空"），
     *    而 ICS 的 DTEND 是**不含**的 —— 于是 `+1 天` 正好把两者对上。
     *
     *    没有结束时间时按"一天"合成：`start + 1`。
     *    这两种情况因此都正确：
     *      · 只占一天、结束留空        → DTEND = start + 1   → 显示那一天
     *      · 跨 8/30~8/31、结束填 8/31 → DTEND = 8/31 + 1    → 显示两天
     */
    const endDate = firstEndsAtLocal ? localDateToIcs(firstEndsAtLocal) : null;
    push(prop('DTEND;VALUE=DATE', addIcsDays(endDate ?? startDate, 1)));
  } else {
    push(prop('DTSTART', formatIcsDateTime(startsAtUtc)));
    /*
     * 没有结束时间时**不写 DTEND**，也不编一个默认时长。
     *
     * RFC 允许这种做法（没有 DTEND/DURATION 时事件是一个时间点）。
     * 编一个"默认 1 小时"看起来更友好，但那是**把我们的猜测写成事实** ——
     * 订阅者会拿着一场 3 小时比赛的"1 小时"安排别的事。
     */
    push(prop('DTEND', firstEndsAtUtc ? formatIcsDateTime(firstEndsAtUtc) : null));
  }

  /*
   * ★ 其余各段（多段时间）。位置紧跟在 DTSTART/DTEND 之后：RDATE 描述的
   *   是"这条日程还出现在什么时候"，与那两个属性是同一件事的延续，
   *   隔开几行只会让人读不出它们的关系。
   *
   * ⚠️ 只有一段时这里返回空数组（一条 RDATE 都不写）—— 见 `rdateLines` 的说明。
   */
  lines.push(...rdateLines(event));

  /*
   * SUMMARY 用**标题原文**，不加阶段前缀。
   * 理由：Q19 定了"绝不自动翻译"，而阶段的标签是中文的（"决赛"）——
   * 给一个英文界的用户推 `[决赛] Grand Finals` 是把两种语言混在一行里。
   * 阶段和标签走 CATEGORIES（下面），客户端会按标签着色/分组。
   */
  push(prop('SUMMARY', escapeIcsText(event.title)));

  push(prop('DESCRIPTION', event.descriptionMd ? escapeIcsText(event.descriptionMd) : null));
  push(prop('LOCATION', event.location ? escapeIcsText(event.location) : null));
  push(prop('URL', event.url ?? null));

  /*
   * Q1 的标签 + Q20 的阶段 + 011 的专业程度/参与范围都映射成 CATEGORIES ——
   * 这正是 RFC 里为"分类"准备的东西。
   *
   * ⚠️ 顺序是**从粗到细**（标签 → 轮次 → 专业程度 → 参与范围）。
   *    客户端不保证按顺序显示，但把相关的排在一起对按 CATEGORIES 分组的
   *    客户端更友好；而打乱顺序没有任何好处。
   *
   * ⚠️ 空值跳过（`prop()` 对空值返回 null，但这里是数组拼接，要自己挡掉）——
   *    拼出一个 `CATEGORIES:A,,B` 这种带空项的列表，严格的解析器会判为坏值。
   */
  const categories = [
    ...event.tags,
    ...(event.stage ? [event.stage] : []),
    ...(event.level ? [event.level] : []),
    ...(event.scope ? [event.scope] : []),
    /*
     * ③ 系列名（013）。它和上面几项是同一类东西（"这场赛事属于哪一摊"），
     * 所以走同一个属性；`escapeIcsText` 已经会转义逗号（见它的实现），
     * 所以系列名里的标点不会拼出一个坏值。
     *
     * ⚠️ 用的是 `seriesName`（LEFT JOIN 出来的显示名），不是 `seriesId` ——
     *    日历客户端里出现一串十六进制 id 对人没有意义。
     */
    ...(event.seriesName ? [event.seriesName] : []),
  ];
  if (categories.length > 0) {
    push(prop('CATEGORIES', categories.map(escapeIcsText).join(',')));
  }

  // LAST-MODIFIED 是客户端判断"要不要更新这条"的依据
  push(prop('LAST-MODIFIED', formatIcsDateTime(event.updatedAt)));

  lines.push('END:VEVENT');
  return lines;
}

/**
 * 生成一份完整的 ICS 订阅文件。
 *
 * 返回的字符串**每一行都以 CRLF 结尾**（RFC 要求），包括最后一行 ——
 * 少了末尾那个 CRLF，一些严格的解析器会把最后一行丢掉，
 * 表现是"少了一个事件"，而没人会想到是换行的问题。
 */
export function buildIcs(events: CalendarEvent[], opts: IcsOptions): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    // VERSION 和 PRODID 都是**必须**的（RFC 5545 §3.7.3 / §3.7.4）
    'VERSION:2.0',
    `PRODID:-//MCSR Helper//Calendar//${opts.domain}`,
    // CALSCALE 默认就是 GREGORIAN，写出来是为了让严格的解析器不必去猜
    'CALSCALE:GREGORIAN',
    // X-WR-CALNAME / X-WR-TIMEZONE 是事实标准（非 RFC 属性，但主流客户端都认）
    `X-WR-CALNAME:${escapeIcsText(opts.calendarName)}`,
    'X-WR-TIMEZONE:UTC',
  ];

  if (opts.refreshMinutes) {
    // 告诉客户端多久回来取一次。不写的话有的客户端会几周不来，
    // 于是"新加的赛事在订阅者那边迟迟不出现"。
    lines.push(`REFRESH-INTERVAL;VALUE=DURATION:PT${opts.refreshMinutes}M`);
    lines.push(`X-PUBLISHED-TTL:PT${opts.refreshMinutes}M`);
  }

  for (const event of events) {
    lines.push(...eventLines(event, opts));
  }

  lines.push('END:VCALENDAR');

  // 折行放在最后统一做：错开每个属性各折一次的机会，只有一处实现
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}
