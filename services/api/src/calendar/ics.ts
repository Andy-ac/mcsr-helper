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
 * 时间一律用 **UTC 形式**（`...Z`），于是完全不需要 `VTIMEZONE` 组件。
 * 这是 Q2 那个"存 UTC 派生值"的另一半收益：以 UTC 导出时，
 * 订阅者看到的是他自己时区的正确时刻，而发布方不必维护一套时区定义。
 */
function eventLines(event: CalendarEvent, opts: IcsOptions): string[] {
  const lines: string[] = ['BEGIN:VEVENT'];

  const push = (line: string | null): void => {
    if (line) lines.push(line);
  };

  // UID 必须稳定 —— 用事件 id + 域名。用时间戳之类的东西会让每次刷新
  // 都变成"一批新事件 + 一批消失的旧事件"，订阅者的日历里会堆满重复项。
  push(prop('UID', `${event.id}@${opts.domain}`));
  push(prop('DTSTAMP', formatIcsDateTime(opts.now)));

  if (event.allDay) {
    /*
     * ⚠️⚠️ 日期从**墙钟**取，不从 UTC 时刻取 —— 理由见 localDateToIcs 的注释
     *    （从 UTC 取会让东八区的整天事件整体提前一天，而且不报错）。
     *
     * 取不到墙钟日期时（理论上不可能，Zod 已经校验过格式）退回 UTC 取法：
     * 那至少是一个形状合法的 VEVENT，而不是一个坏掉的字段 ——
     * 一个坏字段会让**整份日历**在客户端里显示不出来（客户端对格式错误是沉默的）。
     */
    const startDate = localDateToIcs(event.startsAtLocal) ?? formatIcsDate(event.startsAtUtc);
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
    const endDate = event.endsAtLocal ? localDateToIcs(event.endsAtLocal) : null;
    push(prop('DTEND;VALUE=DATE', addIcsDays(endDate ?? startDate, 1)));
  } else {
    push(prop('DTSTART', formatIcsDateTime(event.startsAtUtc)));
    /*
     * 没有结束时间时**不写 DTEND**，也不编一个默认时长。
     *
     * RFC 允许这种做法（没有 DTEND/DURATION 时事件是一个时间点）。
     * 编一个"默认 1 小时"看起来更友好，但那是**把我们的猜测写成事实** ——
     * 订阅者会拿着一场 3 小时比赛的"1 小时"安排别的事。
     */
    push(prop('DTEND', event.endsAtUtc ? formatIcsDateTime(event.endsAtUtc) : null));
  }

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
