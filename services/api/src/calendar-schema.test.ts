/**
 * 日历入参的跨字段校验。
 *
 * ---------------------------------------------------------------------------
 * 最要紧的那一条：结束必须晚于开始，而比较必须**换算成 UTC 之后**再做
 * ---------------------------------------------------------------------------
 * 这是整个日历里最容易写错、又最难被用户发现的一条：
 *
 *   开始 '2026-08-30T12:00' @ UTC        → 12:00Z
 *   结束 '2026-08-30T15:00' @ Asia/Shanghai → 07:00Z   ← 实际比开始早 5 小时
 *
 * 按字符串比：'15:00' > '12:00'，看起来完全正常。
 * 按 UTC 比：结束比开始早了 5 小时 —— 一个负时长的赛事。
 *
 * 而"负时长"在界面上表现为"显示成 0 分钟"或干脆不显示，**不会报错**。
 * 下面那条用例就是专门挡住按字符串比较的实现的。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CalendarEventInputSchema } from '@mcsr/shared/calendar';

/** 一个合法的基线，各用例在它上面改一处。 */
function base(overrides: Record<string, unknown> = {}) {
  return {
    title: 'MCSR Ranked 第 11 赛季资格赛',
    startsAtLocal: '2026-09-05T16:00',
    startsAtTz: 'Asia/Shanghai',
    tags: ['TOURNAMENT'],
    ...overrides,
  };
}

describe('★ 日历入参校验（Q1 标签 / Q2 三段式时间）', () => {
  it('基线能通过，且默认值被填上', () => {
    const parsed = CalendarEventInputSchema.safeParse(base());
    assert.equal(parsed.success, true, parsed.success ? '' : JSON.stringify(parsed.error.issues));
    if (!parsed.success) return;
    assert.equal(parsed.data.lang, 'zh-CN', 'lang 默认 zh-CN');
    assert.equal(parsed.data.allDay, false, 'allDay 默认 false');
    assert.equal(parsed.data.descriptionMd, '', '正文默认空串');
  });

  it('★ 结束时间必须晚于开始 —— 而这条**必须换算成 UTC 再比**', () => {
    // 反面用例：字符串上 '15:00' > '12:00' 看着没问题，
    // 但 15:00 @ Asia/Shanghai 是 07:00Z，比开始（12:00Z）早了 5 小时。
    // 按字符串比较的实现会**放过它**。
    const bad = CalendarEventInputSchema.safeParse(
      base({
        startsAtLocal: '2026-08-30T12:00',
        startsAtTz: 'UTC',
        endsAtLocal: '2026-08-30T15:00',
        endsAtTz: 'Asia/Shanghai',
      }),
    );
    assert.equal(bad.success, false, '负时长必须被拒（说明比较用的是 UTC 而不是字符串）');
  });

  it('跨时区但确实晚于开始的，不能被误拒', () => {
    // 13:00Z 晚于 12:00Z —— 合法。字符串上 '13:00' < '20:00'，
    // 一个按字符串比较的实现会**误拒**它。
    const ok = CalendarEventInputSchema.safeParse(
      base({
        startsAtLocal: '2026-08-30T20:00',
        startsAtTz: 'Asia/Shanghai',
        endsAtLocal: '2026-08-30T13:00',
        endsAtTz: 'UTC',
      }),
    );
    assert.equal(ok.success, true, '合法的跨时区结束时间不该被拒');
  });

  it('结束时间的两个字段必须成对出现', () => {
    const onlyLocal = CalendarEventInputSchema.safeParse(base({ endsAtLocal: '2026-08-30T22:00' }));
    assert.equal(onlyLocal.success, false, '只给 local 不给 tz 应当被拒');

    const onlyTz = CalendarEventInputSchema.safeParse(base({ endsAtTz: 'Asia/Shanghai' }));
    assert.equal(onlyTz.success, false, '只给 tz 不给 local 应当被拒');
  });

  it('整天事件的时间部分必须是 00:00', () => {
    const bad = CalendarEventInputSchema.safeParse(base({ allDay: true }));
    assert.equal(bad.success, false, '整天事件给了 16:00 应当被拒');

    const ok = CalendarEventInputSchema.safeParse(
      base({ allDay: true, startsAtLocal: '2026-09-05T00:00' }),
    );
    assert.equal(ok.success, true);
  });

  it('标签至少一个（没有标签的事件在按标签筛选的界面上等于不可见）', () => {
    assert.equal(CalendarEventInputSchema.safeParse(base({ tags: [] })).success, false);
    assert.equal(
      CalendarEventInputSchema.safeParse(base({ tags: ['TOURNAMENT', 'COMMUNITY'] })).success,
      true,
      '多选题：社区自办的比赛同时是赛事和社区活动',
    );
    assert.equal(
      CalendarEventInputSchema.safeParse(base({ tags: ['NOT_A_TAG'] })).success,
      false,
      '不在枚举里的标签要拒绝',
    );
  });

  it('标题不能空、不能超长', () => {
    assert.equal(CalendarEventInputSchema.safeParse(base({ title: '   ' })).success, false);
    assert.equal(
      CalendarEventInputSchema.safeParse(base({ title: 'x'.repeat(201) })).success,
      false,
    );
  });

  it('非法时区名被拒（"Asia/Shangai" 少一个 h 是真实会发生的打字错误）', () => {
    assert.equal(
      CalendarEventInputSchema.safeParse(base({ startsAtTz: 'Asia/Shangai' })).success,
      false,
    );
  });

  it('⚠️ 墙钟字段不接受带时区后缀的写法', () => {
    // 同一个字段两种含义（带后缀按后缀、不带按 startsAtTz）是一条
    // 只有出错时才会被发现的规则 —— 所以干脆不接受。
    for (const bad of ['2026-09-05T16:00Z', '2026-09-05T16:00+08:00', '2026-09-05 16:00']) {
      assert.equal(
        CalendarEventInputSchema.safeParse(base({ startsAtLocal: bad })).success,
        false,
        `${bad} 应当被拒`,
      );
    }
  });

  it('★ 入参里**不能**出现 startsAtUtc（否则就有了第二个真相）', () => {
    // 让客户端能提交 UTC，就等于让它提交一个和 local+tz 矛盾的时刻，
    // 而那时数据库里会同时存在两个互相冲突的"真相"。
    const parsed = CalendarEventInputSchema.safeParse(base({ startsAtUtc: 123 }));
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(
      Object.hasOwn(parsed.data, 'startsAtUtc'),
      false,
      'startsAtUtc 必须由服务端从 local+tz 算出，不能被客户端指定',
    );
  });
});
