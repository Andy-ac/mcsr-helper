/**
 * 墙钟 ↔ UTC 换算的测试。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 为什么这组测试里全是**写死的期望值**
 * ---------------------------------------------------------------------------
 * 时区换算的 bug 有一个恶劣的性质：**它不报错**。
 * 把 '2026-08-30T20:00' + Asia/Shanghai 算成 2026-08-30T20:00Z（少了 8 小时）
 * 得到的是一个格式完全正确、数值完全错误的时间戳。
 * 任何人肉眼看这个数字都看不出问题，而线上表现是"赛事时间差了 8 小时" ——
 * 用户以为公告写错了，不会来报 bug。
 *
 * 所以这里的期望值**全部是手算成 Date.UTC(...) 的常量**，
 * 而不是"用另一个函数算一遍再比对" —— 后者只能证明两个函数一致，
 * 证明不了它们都对。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isValidTimeZone, utcToWallClock, wallClockToUtc } from '@mcsr/shared/calendar-time';

describe('★ 墙钟 ↔ UTC 换算（Q2 的三段式时间）', () => {
  it('★ 北京时间 20:00 必须换算成 12:00Z —— 而不是 20:00Z', () => {
    const utc = wallClockToUtc('2026-08-30T20:00', 'Asia/Shanghai');
    assert.equal(utc, Date.UTC(2026, 7, 30, 12, 0, 0));

    // 反面断言：明确挡住"把本地时间当 UTC"这个最常见的写法。
    // 没有这一条的话，一个忽略时区的实现也能通过上面那条（只要它恰好返回 null）。
    assert.notEqual(utc, Date.UTC(2026, 7, 30, 20, 0, 0));
  });

  it('UTC 时区是恒等变换', () => {
    assert.equal(wallClockToUtc('2026-08-30T12:00', 'UTC'), Date.UTC(2026, 7, 30, 12, 0, 0));
  });

  it('★ 夏令时：同一个墙钟时刻，冬夏的 UTC 不一样', () => {
    // 美东 2026-03-08 起进入夏令时。3/7 还是 EST(-5)，3/9 已是 EDT(-4)。
    assert.equal(
      wallClockToUtc('2026-03-07T12:00', 'America/New_York'),
      Date.UTC(2026, 2, 7, 17, 0, 0),
      '3/7 正午美东应当是 17:00Z（EST，-5）',
    );
    assert.equal(
      wallClockToUtc('2026-03-09T12:00', 'America/New_York'),
      Date.UTC(2026, 2, 9, 16, 0, 0),
      '3/9 正午美东应当是 16:00Z（EDT，-4）',
    );
  });

  it('中国没有夏令时：冬夏偏移一致', () => {
    const winter = wallClockToUtc('2026-01-15T20:00', 'Asia/Shanghai');
    const summer = wallClockToUtc('2026-08-15T20:00', 'Asia/Shanghai');
    assert.ok(winter !== null && summer !== null);
    // 两个时刻在各自的日期里都应当是"当地 20:00 = 当天 12:00Z"
    assert.equal(winter, Date.UTC(2026, 0, 15, 12, 0, 0));
    assert.equal(summer, Date.UTC(2026, 7, 15, 12, 0, 0));
  });

  it('跨日的负偏移：美西晚上会跑到第二天 UTC', () => {
    // 洛杉矶 2026-08-30 20:00 (PDT, -7) → 2026-08-31 03:00Z
    assert.equal(
      wallClockToUtc('2026-08-30T20:00', 'America/Los_Angeles'),
      Date.UTC(2026, 7, 31, 3, 0, 0),
    );
  });

  it('★ 往返一致：显示回来的必须和用户当初填的逐字符相同', () => {
    // 这条守的是"审核界面把用户填的时间原样显示"——
    // 差一个字符，录入者就会以为自己填错了，而其实是我们换算过又换回来了。
    const cases: Array<[string, string]> = [
      ['2026-08-30T20:00', 'Asia/Shanghai'],
      ['2026-01-15T20:00', 'Asia/Shanghai'],
      ['2026-03-07T12:00', 'America/New_York'],
      ['2026-03-09T12:00', 'America/New_York'],
      ['2026-08-30T12:00', 'UTC'],
      ['2026-12-31T23:59', 'Europe/London'],
    ];
    for (const [local, tz] of cases) {
      const utc = wallClockToUtc(local, tz);
      assert.ok(utc !== null, `${local} @ ${tz} 应当能换算`);
      assert.equal(utcToWallClock(utc, tz), local, `${local} @ ${tz} 往返后变了`);
    }
  });

  it('⚠️ 非法时区名返回 null（不是抛异常，也不是猜一个）', () => {
    // 'Asia/Shangai' 少一个 h —— 这正是真实的打字错误形态
    assert.equal(wallClockToUtc('2026-08-30T20:00', 'Asia/Shangai'), null);
    assert.equal(wallClockToUtc('2026-08-30T20:00', ''), null);
    assert.equal(isValidTimeZone('Asia/Shanghai'), true);
    assert.equal(isValidTimeZone('Asia/Shangai'), false);
    assert.equal(isValidTimeZone(''), false);
  });

  it('⚠️ 格式不对返回 null', () => {
    for (const bad of [
      '2026-8-30T20:00', // 月份没补零
      '2026-08-30 20:00', // 空格而不是 T
      '2026-08-30T20:00:00.000', // 带毫秒
      '2026-08-30',
      '',
    ]) {
      assert.equal(wallClockToUtc(bad, 'Asia/Shanghai'), null, `${bad} 应当被拒`);
    }
  });

  it('小时 24 的午夜不会变成 25 点', () => {
    // hour12:false 在部分实现下把午夜渲染成 "24:00"，`% 24` 是为了收住它。
    // 取一个午夜时刻，确认换算后再显示回来仍然是 00:00。
    const utc = wallClockToUtc('2026-08-30T00:00', 'Asia/Shanghai');
    assert.ok(utc !== null);
    assert.equal(utcToWallClock(utc, 'Asia/Shanghai'), '2026-08-30T00:00');
  });
});
