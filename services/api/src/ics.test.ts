/**
 * ICS 导出（RFC 5545）。
 *
 * ---------------------------------------------------------------------------
 * 这组测试里最要紧的是"折行"那两条
 * ---------------------------------------------------------------------------
 * 一个折错行的 ICS 文件**不会报错** —— 日历客户端默默解析失败，
 * 用户看到的是"订阅了但日历是空的"，然后他会以为是我们没做，
 * 而不是我们做错了。没有日志、没有提示、没有任何人会来报 bug。
 *
 * 所以那条判据必须是硬的：**把每个物理行单独做严格 UTF-8 解码**。
 * 如果一个汉字被劈成两半，那半截字节序列单独就是非法 UTF-8，
 * `fatal: true` 的解码器会直接抛 —— 这才是"切在字符边界上"的可验证定义。
 *
 * ⚠️ 而且测试数据必须是**中文**。用英文测永远发现不了：
 * ASCII 一个字符一字节，字符边界和字节边界重合，随便切都对。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CalendarEvent, EventSlot } from '@mcsr/shared/calendar';
import {
  buildIcs,
  escapeIcsText,
  foldIcsLine,
  formatIcsDate,
  formatIcsDateTime,
} from './calendar/ics';

const encoder = new TextEncoder();
/** 严格解码：不是合法 UTF-8 就抛。用来验"没有字符被劈开"。 */
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * 一段时间。**本地墙钟与 UTC 必须自洽**（同一时区的同一个时刻）。
 *
 * ⚠️⚠️ 017 起 DTSTART/DTEND 取自 `event.slots[0]`（**第一段**），
 *    而那对 `startsAt*` / `endsAt*` 只是**包络**（最早那段开始 → 最晚那段结束）。
 *    ⇒ 只覆盖包络、不覆盖 `slots` 的夹具是**自相矛盾**的：ICS 读的是第一段，
 *    所以断言会悄悄跑到夹具的默认值上去 —— 不报错，只是测了另一样东西。
 */
function slotOf(
  startsAtLocal: string,
  endsAtLocal: string | null,
  startsAtUtc: number,
  endsAtUtc: number | null,
): EventSlot {
  return { startsAtLocal, endsAtLocal, startsAtUtc, endsAtUtc };
}

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt-1',
    title: '测试赛事',
    titleEn: null,
    descriptionMd: '说明',
    /*
     * ⚠️ 017 起 `slots` 是必填的（它取代了 015 的 scheduleText 那类补充字段）。
     *    ICS 按**第一段**出 DTSTART/DTEND、按**其余各段**出 RDATE，
     *    而这个夹具的默认值必须与上面那对 starts/ends 包络**一致** ——
     *    不一致的夹具会让"DTSTART/RDATE 对不对"这类断言测到一个自相矛盾的输入。
     */
    slots: [slotOf('2026-09-05T16:00', null, Date.UTC(2026, 8, 5, 8, 0, 0), null)],
    startsAtLocal: '2026-09-05T16:00',
    startsAtTz: 'Asia/Shanghai',
    startsAtUtc: Date.UTC(2026, 8, 5, 8, 0, 0),
    endsAtLocal: null,
    endsAtTz: null,
    endsAtUtc: null,
    allDay: false,
    url: null,
    location: null,
    tags: ['TOURNAMENT'],
    stage: null,
    level: null,
    scope: null,
    /* 017 新增的两维（ICS 不用，但形状必须完整）。 */
    access: null,
    scopeDetail: [],
    // ③ 的系列：`seriesId` 是事件上的列，`seriesName` / `seriesColor` 由 JOIN 得到 ——
    // 三者都是**必填（可空值）**，所以 fixture 必须显式给出来，不能靠"字段不在就是缺省"。
    seriesId: null,
    seriesName: null,
    seriesColor: null,
    lang: 'zh-CN',
    authorId: 'u1',
    authorName: '甲',
    status: 'published',
    createdAt: 0,
    updatedAt: Date.UTC(2026, 8, 1, 0, 0, 0),
    ...overrides,
  };
}

const OPTS = {
  now: Date.UTC(2026, 8, 12, 0, 0, 0),
  domain: 'mcsrhelper.com',
  calendarName: 'MCSR Helper 日历',
  refreshMinutes: 60,
};

/** 拆分物理行（保留空行信息没用，过滤掉）。 */
function physicalLines(ics: string): string[] {
  return ics.split('\r\n').filter((l) => l.length > 0);
}

/** 按 RFC 展开折行：去掉 CRLF + 紧跟的那一个空格。 */
function unfold(ics: string): string[] {
  return ics
    .replace(/\r\n[ \t]/g, '')
    .split('\r\n')
    .filter((l) => l.length > 0);
}

describe('★ ICS 导出（验收标准：手机自带日历能订阅）', () => {
  it('★ 中文长标题折行后，每个物理行都是合法 UTF-8（没有汉字被劈开）', () => {
    // 25 个汉字 = 75 字节，正好撞上 RFC 的单行上限 —— 最容易被切坏的长度。
    // 再加长一点，确保一定触发折行。
    const title = '这是一场名字非常长的中文赛事标题用来测试折行会不会把汉字劈成两半';
    const ics = buildIcs([makeEvent({ title })], OPTS);

    const lines = physicalLines(ics);
    const summaryLines = lines.filter((l) => l.includes('SUMMARY') || /^\s/.test(l));

    // 硬判据一：把每个物理行的字节单独做严格 UTF-8 解码
    for (const line of lines) {
      assert.doesNotThrow(
        () => strictUtf8.decode(encoder.encode(line)),
        `物理行不是合法 UTF-8（说明有字符被折断了）：${JSON.stringify(line.slice(0, 40))}`,
      );
    }

    // 硬判据二：每行不超过 75 字节
    for (const line of lines) {
      const bytes = encoder.encode(line).length;
      assert.ok(bytes <= 75, `物理行 ${bytes} 字节，超过 75：${JSON.stringify(line.slice(0, 30))}`);
    }

    // 硬判据三：展开之后必须**逐字符**还原
    const unfolded = unfold(ics);
    assert.ok(
      unfolded.some((l) => l === `SUMMARY:${title}`),
      '展开后的 SUMMARY 必须与原始标题逐字符相同',
    );

    // 确认真的折了（否则上面三条在"根本没折"的情况下也会通过）
    assert.ok(
      summaryLines.length > 1,
      '这个长度的中文标题必须被折成多行 —— 一条都没折说明折行逻辑根本没生效',
    );
  });

  it('折行单元：ASCII 与中文都按字节判断、按字符切', () => {
    const ascii = 'A'.repeat(200);
    const folded = foldIcsLine(ascii);
    for (const line of folded.split('\r\n')) {
      assert.ok(encoder.encode(line).length <= 75);
    }
    assert.equal(folded.replace(/\r\n /g, ''), ascii, '展开后必须还原');

    const chinese = '汉'.repeat(50); // 150 字节
    const foldedCn = foldIcsLine(chinese);
    for (const line of foldedCn.split('\r\n')) {
      assert.doesNotThrow(() => strictUtf8.decode(encoder.encode(line)));
      assert.ok(encoder.encode(line).length <= 75);
    }
    assert.equal(foldedCn.replace(/\r\n /g, ''), chinese);
  });

  it('短行不折', () => {
    assert.equal(foldIcsLine('SUMMARY:短'), 'SUMMARY:短');
  });

  it('★ 每行都以 CRLF 结尾，包括最后一行', () => {
    const ics = buildIcs([makeEvent()], OPTS);
    assert.ok(ics.endsWith('\r\n'), '文件末尾缺少 CRLF —— 严格解析器会丢掉最后一行');
    assert.equal(ics.includes('\n\n'), false, '不应出现空行');
    // 不允许出现"裸 LF"
    assert.equal(/[^\r]\n/.test(ics), false, '出现了不是 CRLF 的换行');
  });

  it('★ UID 跨刷新稳定（否则订阅者每刷新一次就多一份重复事件）', () => {
    const a = buildIcs([makeEvent()], { ...OPTS, now: 1000 });
    const b = buildIcs([makeEvent()], { ...OPTS, now: 9999 });
    const uidOf = (s: string) => unfold(s).find((l) => l.startsWith('UID:'));
    assert.equal(uidOf(a), uidOf(b), 'UID 不该随生成时间变化');
    assert.equal(uidOf(a), 'UID:evt-1@mcsrhelper.com');
  });

  it('必填属性都在（VERSION / PRODID / UID / DTSTAMP / DTSTART）', () => {
    const lines = unfold(buildIcs([makeEvent()], OPTS));
    for (const required of [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:',
      'DTSTAMP:',
      'DTSTART:',
      'END:VEVENT',
      'END:VCALENDAR',
    ]) {
      assert.ok(
        lines.some((l) => l.startsWith(required)),
        `缺少必填属性 ${required}`,
      );
    }
    assert.ok(
      lines.some((l) => l.startsWith('PRODID:')),
      'PRODID 是必填的',
    );
  });

  it('★ 转义：反斜杠必须**先**换，否则会多出一个反斜杠', () => {
    // 若先换分号再换反斜杠，`a;b` 会变成 `a\\;b`，
    // 日历客户端读出来是一个字面反斜杠加一个分号 —— 标题被改了，没人会发现
    assert.equal(escapeIcsText('a;b'), 'a\\;b');
    assert.equal(escapeIcsText('a,b'), 'a\\,b');
    assert.equal(escapeIcsText('a\\b'), 'a\\\\b');
    assert.equal(escapeIcsText('a\nb'), 'a\\nb');

    const ics = buildIcs([makeEvent({ title: 'A;B,C\\D' })], OPTS);
    const summary = unfold(ics).find((l) => l.startsWith('SUMMARY:'));
    assert.equal(summary, 'SUMMARY:A\\;B\\,C\\\\D');
  });

  it('时间用 UTC 形式（于是完全不需要 VTIMEZONE）', () => {
    const lines = unfold(buildIcs([makeEvent()], OPTS));
    assert.ok(lines.includes('DTSTART:20260905T080000Z'), '应当是以 Z 结尾的 UTC 时刻');
    assert.equal(
      lines.some((l) => l.startsWith('BEGIN:VTIMEZONE')),
      false,
      'UTC 导出不该需要 VTIMEZONE',
    );
  });

  it('★ 整天事件的 DTEND 是**不含**的那一天', () => {
    // "9 月 5 日一天" 要写成 DTSTART 20260905 / DTEND 20260906。
    // 写成同一天的话客户端会显示成零天 —— 看不出问题的那种错。
    const lines = unfold(
      buildIcs(
        [
          makeEvent({
            allDay: true,
            // ⚠️ 整天事件的墙钟必须是 00:00（schema 会查），而这一段就是"唯一那一段"
            slots: [slotOf('2026-09-05T00:00', null, Date.UTC(2026, 8, 4, 16, 0), null)],
            startsAtLocal: '2026-09-05T00:00',
            startsAtUtc: Date.UTC(2026, 8, 4, 16, 0),
          }),
        ],
        OPTS,
      ),
    );
    assert.ok(lines.includes('DTSTART;VALUE=DATE:20260905'));
    assert.ok(lines.includes('DTEND;VALUE=DATE:20260906'), 'DTEND 必须是不含的次日');
  });

  it('★★ 整天事件的日期从**墙钟**取，不从 UTC 取（东八区不许提前一天）', () => {
    /*
     * ---------------------------------------------------------------------------
     * 这是一个真实存在过的 bug，而且**上面那条测试抓不到它**
     * ---------------------------------------------------------------------------
     * 原来写的是 `formatIcsDate(event.startsAtUtc)`，于是：
     *
     *   用户填「8 月 30 日」（Asia/Shanghai，整天）
     *   → wallClockToUtc → UTC 2026-08-29T16:00
     *   → getUTCDate() = 29
     *   → DTSTART 20260829  ← **提前了一天**
     *
     * ⚠️ 为什么上面那条测试没发现：它直接给 `startsAtUtc: Date.UTC(2026,8,5)`
     *    —— 一个 UTC 午夜，而 `startsAtLocal` 是模板默认的 09-05T16:00
     *    （本地日期也是 9 月 5 日）。**两个日期碰巧相等**，所以走哪条路都对。
     *    要抓到它，`startsAtUtc` 和 `startsAtLocal` 的**日期必须不同** ——
     *    而东八区（这个项目的主要受众）的整天事件恰好总是这样：
     *    本地 00:00 那个时刻，在 UTC 是**前一天**的 16:00。
     *
     * ⚠️ 而且**西边的时区碰巧是对的**（纽约 8/30 00:00 = UTC 8/30 04:00），
     *    所以"在开发机上看着没问题"完全不能推出"线上没问题"。
     *    下面两条用例把两侧都钉住。
     *
     * ⚠️ 夹具必须同时改 `slots`（见 `slotOf` 的注释）：ICS 的 DTSTART 取自
     *    **第一段**，只改包络的话这两个用例会一直读夹具的默认那一段，
     *    于是它们会"通过"—— 但通过的是别的输入。
     */
    const eastern = unfold(
      buildIcs(
        [
          makeEvent({
            allDay: true,
            // 北京 8/30 00:00 就是 UTC 8/29 16:00 —— 两个日期**不同**
            slots: [slotOf('2026-08-30T00:00', null, Date.UTC(2026, 7, 29, 16, 0), null)],
            startsAtLocal: '2026-08-30T00:00',
            startsAtTz: 'Asia/Shanghai',
            startsAtUtc: Date.UTC(2026, 7, 29, 16, 0),
          }),
        ],
        OPTS,
      ),
    );
    assert.ok(
      eastern.includes('DTSTART;VALUE=DATE:20260830'),
      `东八区的整天事件必须是 8 月 30 日，实际：${eastern.filter((l) => l.startsWith('DTSTART')).join()}`,
    );
    assert.ok(eastern.includes('DTEND;VALUE=DATE:20260831'));

    // 西边的时区：本地日期和 UTC 日期相同，仍然是本地那一天
    const western = unfold(
      buildIcs(
        [
          makeEvent({
            allDay: true,
            slots: [slotOf('2026-08-30T00:00', null, Date.UTC(2026, 7, 30, 4, 0), null)],
            startsAtLocal: '2026-08-30T00:00',
            startsAtTz: 'America/New_York',
            startsAtUtc: Date.UTC(2026, 7, 30, 4, 0),
          }),
        ],
        OPTS,
      ),
    );
    assert.ok(western.includes('DTSTART;VALUE=DATE:20260830'));
    assert.ok(western.includes('DTEND;VALUE=DATE:20260831'));
  });

  it('★ 整天事件跨天：结束时间按"最后一天（含）"理解，+1 之后正好对上', () => {
    /*
     * 库里存的 `ends_at_local` 是**用户填的最后一天（含）**
     * （界面上的说法是"结束日期指最后一天；只占一天就留空"），
     * 而 ICS 的 DTEND 是**不含**的 —— `+1 天` 把两者对上。
     *
     * 这条同时是"只占一天就留空"那条约定的另一半：两种输入都要落在正确的跨度上。
     */
    const twoDays = unfold(
      buildIcs(
        [
          makeEvent({
            allDay: true,
            // 用户填的最后一天是 8/31（含），所以跨度是 8/30~8/31 两天
            slots: [
              slotOf(
                '2026-08-30T00:00',
                '2026-08-31T00:00',
                Date.UTC(2026, 7, 29, 16, 0),
                Date.UTC(2026, 7, 30, 16, 0),
              ),
            ],
            startsAtLocal: '2026-08-30T00:00',
            startsAtTz: 'Asia/Shanghai',
            startsAtUtc: Date.UTC(2026, 7, 29, 16, 0),
            endsAtLocal: '2026-08-31T00:00',
            endsAtTz: 'Asia/Shanghai',
            endsAtUtc: Date.UTC(2026, 7, 30, 16, 0),
          }),
        ],
        OPTS,
      ),
    );
    assert.ok(twoDays.includes('DTSTART;VALUE=DATE:20260830'));
    assert.ok(
      twoDays.includes('DTEND;VALUE=DATE:20260901'),
      '结束填 8/31 → DTEND 必须是 9/1，跨 8/30~8/31 两天',
    );
  });

  it('整天事件跨月/跨年时日期进位正确（8/31 + 1 天 = 9/1）', () => {
    const acrossMonth = unfold(
      buildIcs(
        [
          makeEvent({
            allDay: true,
            slots: [slotOf('2026-08-31T00:00', null, Date.UTC(2026, 7, 31), null)],
            startsAtLocal: '2026-08-31T00:00',
            startsAtTz: 'UTC',
            startsAtUtc: Date.UTC(2026, 7, 31),
          }),
        ],
        OPTS,
      ),
    );
    assert.ok(acrossMonth.includes('DTSTART;VALUE=DATE:20260831'));
    assert.ok(
      acrossMonth.includes('DTEND;VALUE=DATE:20260901'),
      '8 月 31 日的次日必须是 9 月 1 日，不是"8 月 32 日"或 9 月 0 日',
    );
  });

  it('★ 没有结束时间就**不写** DTEND（不编一个默认时长）', () => {
    const without = unfold(buildIcs([makeEvent({ endsAtUtc: null })], OPTS));
    assert.equal(
      without.some((l) => l.startsWith('DTEND')),
      false,
    );

    // ⚠️ 有结束时间的那一支必须同时改 `slots`：DTEND 读的是**第一段**的结束
    const withEnd = unfold(
      buildIcs(
        [
          makeEvent({
            slots: [
              slotOf(
                '2026-09-05T16:00',
                '2026-09-05T19:00',
                Date.UTC(2026, 8, 5, 8, 0, 0),
                Date.UTC(2026, 8, 5, 11, 0, 0),
              ),
            ],
            endsAtLocal: '2026-09-05T19:00',
            endsAtUtc: Date.UTC(2026, 8, 5, 11, 0, 0),
          }),
        ],
        OPTS,
      ),
    );
    assert.ok(withEnd.includes('DTEND:20260905T110000Z'));
  });

  it('标签与阶段映射成 CATEGORIES', () => {
    const lines = unfold(
      buildIcs([makeEvent({ tags: ['TOURNAMENT', 'COMMUNITY'], stage: 'FINAL' })], OPTS),
    );
    assert.ok(lines.includes('CATEGORIES:TOURNAMENT,COMMUNITY,FINAL'));
  });

  it('URL 与 LOCATION 只在有值时出现', () => {
    const bare = unfold(buildIcs([makeEvent()], OPTS));
    assert.equal(
      bare.some((l) => l.startsWith('URL:')),
      false,
    );
    assert.equal(
      bare.some((l) => l.startsWith('LOCATION:')),
      false,
    );

    const full = unfold(
      buildIcs([makeEvent({ url: 'https://mcsrranked.com/', location: '线上' })], OPTS),
    );
    assert.ok(full.includes('URL:https://mcsrranked.com/'));
    assert.ok(full.includes('LOCATION:线上'));
  });

  it('日历级属性：名字与刷新间隔', () => {
    const lines = unfold(buildIcs([makeEvent()], OPTS));
    assert.ok(lines.includes('X-WR-CALNAME:MCSR Helper 日历'));
    assert.ok(lines.includes('REFRESH-INTERVAL;VALUE=DURATION:PT60M'));
  });

  it('空事件列表也是合法文件（订阅者还没内容时不该拿到一个坏文件）', () => {
    const ics = buildIcs([], OPTS);
    const lines = unfold(ics);
    assert.ok(lines.includes('BEGIN:VCALENDAR'));
    assert.ok(lines.includes('END:VCALENDAR'));
    assert.equal(lines.filter((l) => l.startsWith('BEGIN:VEVENT')).length, 0);
  });

  it('时间格式化：UTC 与 DATE 两种形式', () => {
    assert.equal(formatIcsDateTime(Date.UTC(2026, 8, 5, 8, 0, 0)), '20260905T080000Z');
    assert.equal(formatIcsDate(Date.UTC(2026, 8, 5)), '20260905');
    // 月份和日期都要补零 —— 不补的话 1 月 1 日会变成 202611，长度都不对
    assert.equal(formatIcsDate(Date.UTC(2026, 0, 1)), '20260101');
  });
});

/**
 * ★ 多段时间 → 一个 VEVENT + RDATE（2026-09-13，用户裁决 Q11=(b)）。
 *
 * ---------------------------------------------------------------------------
 * 这个文件里最要紧的一条是"**一段 = 一个 VEVENT**"
 * ---------------------------------------------------------------------------
 * 用户看的是**手机自带日历**：一场分三个周末打的联赛，如果按每段各出一条 VEVENT
 * 导出，在手机里就是**三条互不相干的日程**（标题一样，看起来像重复订阅）；
 * 而用户心里那是"一场赛事打了三次"。所以 DTSTART 取第一段、其余各段走 RDATE。
 *
 * ⚠️ 而 RDATE 有**两种写法**，选错的那种不会报错、只会显示错：
 *   · `RDATE:<DATE-TIME>` —— 每个实例继承 **DTSTART 的时长**；
 *   · `RDATE;VALUE=PERIOD:<start>/<end>` —— 每段写清自己的起止，
 *     所以**每段可以有不同的时长**（RFC 5545 §3.8.5.2 的示例就是这个形状）。
 * 本仓的赛事里"第一段两小时、第二段跨两天"是真实存在的形态，所以用 PERIOD。
 */
describe('★ ICS 多段时间 → 一个 VEVENT + RDATE', () => {
  it('★★ 定时 3 段：恰好 1 个 VEVENT，1 条 RDATE;VALUE=PERIOD，含 2 个 period 且时长各不相同', () => {
    /*
     * 段的时长刻意**不一致**：第一段 2 小时、第三段跨两天。
     * 这正是"不能用裸 RDATE"的判据 —— 裸形式会让每段都变成 2 小时，
     * 而手机日历里那看起来完全正常（谁记得清第二段该有几天？）。
     */
    const event = makeEvent({
      title: '三段时间的联赛',
      slots: [
        slotOf(
          '2026-09-05T16:00',
          '2026-09-05T18:00',
          Date.UTC(2026, 8, 5, 8, 0),
          Date.UTC(2026, 8, 5, 10, 0),
        ),
        slotOf(
          '2026-09-12T16:00',
          '2026-09-12T18:00',
          Date.UTC(2026, 8, 12, 8, 0),
          Date.UTC(2026, 8, 12, 10, 0),
        ),
        // 第三段跨了两天（9/19 16:00 → 9/21 18:00 本地）
        slotOf(
          '2026-09-19T16:00',
          '2026-09-21T18:00',
          Date.UTC(2026, 8, 19, 8, 0),
          Date.UTC(2026, 8, 21, 10, 0),
        ),
      ],
      /*
       * 包络 = 最早那段开始 → 最晚那段结束（**不是**第一段的结束）。
       * ⚠️ 这两者刻意不同：若实现把包装当成 DTEND，断言里的
       *    `DTEND:20260905T100000Z` 会变成 21 日 —— "三个周末连成一整块"。
       */
      startsAtLocal: '2026-09-05T16:00',
      startsAtUtc: Date.UTC(2026, 8, 5, 8, 0),
      endsAtLocal: '2026-09-21T18:00',
      endsAtUtc: Date.UTC(2026, 8, 21, 10, 0),
    });

    const lines = unfold(buildIcs([event], OPTS));

    // ① 一条事件 = 一个 VEVENT（三段不该变成三条日程）
    assert.equal(
      lines.filter((l) => l === 'BEGIN:VEVENT').length,
      1,
      '多段必须仍然只有一个 VEVENT —— 分成三个的话手机日历里就是三条日程了',
    );
    assert.equal(lines.filter((l) => l === 'END:VEVENT').length, 1);

    // ② DTSTART / DTEND 取**第一段**
    assert.ok(lines.includes('DTSTART:20260905T080000Z'), 'DTSTART 应当是第一段的开始');
    assert.ok(lines.includes('DTEND:20260905T100000Z'), 'DTEND 应当是第一段的结束');

    // ③ 只有一条 RDATE;VALUE=PERIOD，且含**两个** period（第一段由 DTSTART 表达）
    const rdates = lines.filter((l) => l.startsWith('RDATE'));
    assert.equal(rdates.length, 1, `应当只有一条 RDATE 行，实际：${rdates.join(' | ')}`);
    assert.equal(
      rdates[0],
      'RDATE;VALUE=PERIOD:20260912T080000Z/20260912T100000Z,20260919T080000Z/20260921T100000Z',
      'PERIOD 形式把每段的起止都写进去 —— 只有这样才能表达"每段时长不同"',
    );
    assert.equal(
      (rdates[0] as string).split(',').length,
      2,
      '两个 period（3 段减去 DTSTART 那一段）',
    );
    /*
     * ⚠️ 第三个 period 的跨度是 2 天，与第一段的 2 小时**不同** ——
     *    这正是裸 RDATE 做不到的那件事（裸形式会让它继承 2 小时）。
     */
    assert.ok(
      (rdates[0] as string).includes('20260919T080000Z/20260921T100000Z'),
      '第三段的时长必须原样写出来，而不是继承第一段的 2 小时',
    );
    assert.equal(
      lines.some((l) => l === 'RDATE:20260912T080000Z'),
      false,
      '定时事件不该出现裸的 RDATE（那会让每段继承第一段的时长）',
    );
  });

  it('★★ 整天 2 段：用 RDATE;VALUE=DATE，且日期从**墙钟**取（东八区不许提前一天）', () => {
    /*
     * ⚠️ 整天事件**不能**用 PERIOD：PERIOD 的值类型是 DATE-TIME（§3.3.9 的
     *    定义就是 `date-time "/" date-time`），写在 DATE 上是格式非法的属性，
     *    而客户端对格式错误**沉默**（可能整份日历都不显示）。
     *
     * ⚠️ 第二段的 `startsAtUtc` 落在 **UTC 的 9 月 4 日**，而墙钟日期是 9 月 5 日
     *    （北京 9/5 00:00 = UTC 9/4 16:00）—— 两个日期**不同**，所以这条断言
     *    真的能区分"从墙钟取"和"从 UTC 取"。（从 UTC 取的表现是整条日程提前一天，
     *    而 9 月 4 日和 9 月 5 日看起来都完全正常。）
     */
    const event = makeEvent({
      title: '两段整天赛事',
      allDay: true,
      slots: [
        {
          startsAtLocal: '2026-08-30T00:00',
          endsAtLocal: null,
          startsAtUtc: Date.UTC(2026, 7, 29, 16, 0),
          endsAtUtc: null,
        },
        {
          startsAtLocal: '2026-09-05T00:00',
          endsAtLocal: null,
          startsAtUtc: Date.UTC(2026, 8, 4, 16, 0),
          endsAtUtc: null,
        },
      ],
      startsAtLocal: '2026-08-30T00:00',
      startsAtUtc: Date.UTC(2026, 7, 29, 16, 0),
      endsAtLocal: null,
      endsAtUtc: null,
    });

    const lines = unfold(buildIcs([event], OPTS));

    assert.equal(lines.filter((l) => l === 'BEGIN:VEVENT').length, 1);
    assert.ok(lines.includes('DTSTART;VALUE=DATE:20260830'));
    assert.ok(lines.includes('DTEND;VALUE=DATE:20260831'));
    assert.ok(
      lines.includes('RDATE;VALUE=DATE:20260905'),
      `第二段必须是墙钟的 9 月 5 日（从 UTC 取会得到 9 月 4 日）。实际：${lines.filter((l) => l.startsWith('RDATE')).join(' | ')}`,
    );
    assert.equal(
      lines.some((l) => l.startsWith('RDATE;VALUE=PERIOD')),
      false,
      'PERIOD 是 DATE-TIME 专用，整天事件不能用它',
    );
  });

  it('★★★ 整天多段：每一段的**每一天**都要出现（线上真实数据那个形状）', () => {
    /*
     * ★★ 这一条守的是 2026-09-14 修掉的一个**静默丢日子**的缺陷。
     *
     * 原实现只把每一段的**首日**写进 RDATE，理由是"DATE 形式表达不了这一段有几天"。
     * 前半句对，结论错：DATE 表达不了区间，但 **RDATE 允许一串值**，而每个值的
     * 时长由 DTSTART/DTEND 决定（1 天）—— 把每一天都列出来，得到的实例集合
     * 与"一段连续的日子"逐日相同。
     *
     * ⚠️ 夹具**逐字取自线上**：`hist-playoffs-s08` 是
     *    08-23（1 天）/ 08-30~08-31（2 天）/ 09-06~09-10（5 天）。
     *    只写首日的表现是"手机日历里只有 08-23、08-30、09-06 三天"，
     *    另外 7 天**全部消失**，而订阅者看到的那份日历看起来完全正常。
     *    ⇒ 所以断言不能只查"首日在不在"（那在两种实现下都成立），
     *      要查**缺的那几天在不在**：08-31、09-07~09-10。
     *
     * ⚠️ 也刻意断言**段之间的日子不在**（08-24~08-29、09-01~09-05）——
     *    否则"把整条包络展开"（最早的开始 → 最晚的结束，一路连下来）也能通过，
     *    而那正是用户明确不想要的"看起来连着打十几天"。
     */
    const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
    const slot = (from: string, to: string | null) => ({
      startsAtLocal: `${from}T00:00`,
      endsAtLocal: to ? `${to}T00:00` : null,
      // 这些赛事在库里全是 UTC（`apply-phaseB` 断言过），所以墙钟日 = UTC 日
      startsAtUtc: day(...(from.split('-').map(Number) as [number, number, number])),
      endsAtUtc: to ? day(...(to.split('-').map(Number) as [number, number, number])) : null,
    });
    const event = makeEvent({
      title: 'MCSR Ranked 第 8 赛季季后赛',
      allDay: true,
      slots: [
        slot('2025-08-23', null),
        slot('2025-08-30', '2025-08-31'),
        slot('2025-09-06', '2025-09-10'),
      ],
      startsAtLocal: '2025-08-23T00:00',
      startsAtUtc: day(2025, 8, 23),
      endsAtLocal: '2025-09-10T00:00',
      endsAtUtc: day(2025, 9, 10),
    });

    const lines = unfold(buildIcs([event], OPTS));
    /*
     * ⚠️ 先证明**只有一个 VEVENT**（用户裁决 Q11=(b)：一场赛事在手机日历里是
     *    一条，不是三条）。少了前置，下面那些 RDATE 断言在"每段各出一个 VEVENT"
     *    的实现下也可能碰巧成立。
     */
    assert.equal(lines.filter((l) => l === 'BEGIN:VEVENT').length, 1);

    const rdate = lines.find((l) => l.startsWith('RDATE;VALUE=DATE:'));
    assert.ok(rdate, '多段整天事件必须有一条 RDATE;VALUE=DATE');

    // ① 每一段的**每一天**都在（第一段由 DTSTART/DTEND 表达，所以从 RDATE 里排除）
    for (const d of [
      '20250830',
      '20250831',
      '20250906',
      '20250907',
      '20250908',
      '20250909',
      '20250910',
    ]) {
      assert.ok(
        rdate.includes(d),
        `★ ${d} 必须出现在 RDATE 里 —— 少一天就是订阅者的日历上少一天，而且完全看不出来。实际：${rdate}`,
      );
    }
    // ② 段与段之间的空档**一天都不能有**
    for (const d of ['20250824', '20250825', '20250829', '20250901', '20250905', '20250911']) {
      assert.equal(
        rdate.includes(d),
        false,
        `★ ${d} 落在两段之间，不该出现（出现了就是"看起来连着打十几天"）。实际：${rdate}`,
      );
    }
  });

  it('★ 只有一段时**不输出** RDATE（多一条就是多一个重复实例）', () => {
    const lines = unfold(buildIcs([makeEvent()], OPTS));
    assert.equal(
      lines.some((l) => l.startsWith('RDATE')),
      false,
      '单段事件的全部时间已经由 DTSTART/DTEND 表达了',
    );
  });

  it('★ 多段整天事件里，某段没有墙钟日期时退回 UTC 取法（宁可差一天，不要一个坏字段）', () => {
    /*
     * `startsAtLocal` 理论上不可能取不到（Zod 校验过格式），但这一支是**兜底**：
     * 一个坏日期字段会让整个 VEVENT 在客户端里显示不出来，而显示成"差一天"
     * 至少是一条看得见的日程。所以兜底顺序必须与 DTSTART 那一处**完全一致**。
     */
    const event = makeEvent({
      allDay: true,
      slots: [
        {
          startsAtLocal: '2026-08-30T00:00',
          endsAtLocal: null,
          startsAtUtc: Date.UTC(2026, 7, 29, 16, 0),
          endsAtUtc: null,
        },
        {
          // 坏数据：不是 `YYYY-MM-DDTHH:mm` 形状
          startsAtLocal: '坏数据',
          endsAtLocal: null,
          startsAtUtc: Date.UTC(2026, 8, 4, 16, 0),
          endsAtUtc: null,
        },
      ],
      startsAtLocal: '2026-08-30T00:00',
      startsAtUtc: Date.UTC(2026, 7, 29, 16, 0),
    });

    const lines = unfold(buildIcs([event], OPTS));
    assert.ok(lines.includes('RDATE;VALUE=DATE:20260904'));
  });

  it('★★ 长 RDATE + 中文标题：折行后每个物理行都是合法 UTF-8，且不超过 75 字节', () => {
    /*
     * ⚠️ 与文件头那条测试同一个判据（把每个物理行单独做 `fatal: true` 的严格解码），
     *    但这一条**同时**折了两行：中文 SUMMARY（3 字节/字，25 个汉字正好 75 字节）
     *    和一条很长的 RDATE（8 段，PERIOD 形式）。
     *    RDATE 本身是纯 ASCII，所以它折不错 —— 但"折行实现只有一处"这件事
     *    只有在同一份文件里两种行都出现时才被真正覆盖到。
     */
    const title = '这是一场名字非常长的中文赛事标题用来测试折行会不会把汉字劈成两半';
    /*
     * 8 段 = 上限（`EVENT_SLOTS_MAX`），每周一段，全部按 **Asia/Shanghai（UTC+8，无夏令时）**
     * 算出墙钟字符串 —— 日期和时间两边都由同一个 UTC 时刻推导，
     * 手写的日期很容易写出 `2026-09-33` 这种"格式合法、语义是假的"数据，
     * 而那种夹具会让断言测到别的东西上去。
     */
    const base = Date.UTC(2026, 8, 5, 8, 0); // = 北京 2026-09-05 16:00
    const week = 7 * 24 * 3600 * 1000;
    const local = (ms: number): string => new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 16);
    const slots = Array.from({ length: 8 }, (_, i) => {
      const startUtc = base + i * week;
      const endUtc = startUtc + 2 * 3600 * 1000;
      return {
        startsAtLocal: local(startUtc),
        endsAtLocal: local(endUtc),
        startsAtUtc: startUtc,
        endsAtUtc: endUtc,
      };
    });
    const last = slots[slots.length - 1] as (typeof slots)[number];

    const ics = buildIcs(
      [
        makeEvent({
          title,
          slots,
          startsAtLocal: (slots[0] as (typeof slots)[number]).startsAtLocal,
          startsAtUtc: (slots[0] as (typeof slots)[number]).startsAtUtc,
          endsAtLocal: last.endsAtLocal,
          endsAtUtc: last.endsAtUtc,
        }),
      ],
      OPTS,
    );

    const lines = physicalLines(ics);
    for (const line of lines) {
      assert.doesNotThrow(
        () => strictUtf8.decode(encoder.encode(line)),
        `物理行不是合法 UTF-8（说明有字符被折断了）：${JSON.stringify(line.slice(0, 40))}`,
      );
      const bytes = encoder.encode(line).length;
      assert.ok(bytes <= 75, `物理行 ${bytes} 字节，超过 75：${JSON.stringify(line.slice(0, 30))}`);
    }

    const unfolded = unfold(ics);
    assert.ok(unfolded.includes(`SUMMARY:${title}`), '展开后的 SUMMARY 必须与原始标题逐字符相同');

    const rdate = unfolded.find((l) => l.startsWith('RDATE;VALUE=PERIOD'));
    assert.ok(rdate, '8 段应当有一条 RDATE;VALUE=PERIOD');
    assert.equal((rdate as string).split(',').length, 7, '7 个 period（8 段减去 DTSTART 那一段）');
    // 确认真的折过：否则上面那两条在"根本没折"的情况下也会通过
    assert.ok(
      lines.filter((l) => l.includes('RDATE') || /^\s/.test(l)).length > 1,
      '这条 RDATE 必须被折成多行',
    );
  });
});
