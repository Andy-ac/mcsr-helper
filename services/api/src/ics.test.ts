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
import type { CalendarEvent } from '@mcsr/shared/calendar';
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

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt-1',
    title: '测试赛事',
    titleEn: null,
    descriptionMd: '说明',
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
      buildIcs([makeEvent({ allDay: true, startsAtUtc: Date.UTC(2026, 8, 5) })], OPTS),
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
     */
    const eastern = unfold(
      buildIcs(
        [
          makeEvent({
            allDay: true,
            startsAtLocal: '2026-08-30T00:00',
            startsAtTz: 'Asia/Shanghai',
            // 北京 8/30 00:00 就是 UTC 8/29 16:00 —— 两个日期**不同**
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
            startsAtLocal: '2026-08-30T00:00',
            startsAtTz: 'Asia/Shanghai',
            startsAtUtc: Date.UTC(2026, 7, 29, 16, 0),
            // 用户填的最后一天是 8/31（含），所以跨度是 8/30~8/31 两天
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

    const withEnd = unfold(
      buildIcs([makeEvent({ endsAtUtc: Date.UTC(2026, 8, 5, 11, 0, 0) })], OPTS),
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
