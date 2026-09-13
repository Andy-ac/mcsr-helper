/**
 * 日历入参的跨字段校验。
 *
 * ---------------------------------------------------------------------------
 * 时间模型（017，2026-09-13 起）：**一个时区 + 若干段**
 * ---------------------------------------------------------------------------
 * 入参里只有顶层一个 `startsAtTz`，每一段是 `{ startsAtLocal, endsAtLocal? }`。
 * 旧的"一对起止 + **每端各一个**时区"整个没了：`endsAtTz` 这个概念不存在了，
 * 于是"两个时刻在各自时区里比大小"那类用例也随之失去前提（下面两条时间用例
 * 各自写了"原来断言的是什么、为什么现在是这个形状"）。
 *
 * ---------------------------------------------------------------------------
 * 最要紧的那一条：**每一段内**结束必须晚于开始，而比较必须落在真实时刻上
 * ---------------------------------------------------------------------------
 * 这是整个日历里最容易写错、又最难被用户发现的一条：
 * "负时长"在界面上表现为"显示成 0 分钟"或干脆不显示，**不会报错**。
 *
 * ⚠️ "换算成 UTC 再比"这条规则仍然在（`wallClockToUtc`），但要诚实地说清它
 *    现在还剩多少可观测的分量：整条事件只剩一个时区之后，同一个时区里的墙钟
 *    字符串顺序与真实时刻顺序**在绝大多数输入上完全一致** —— 唯一的例外是
 *    夏令时切换那一段（见"负时长"那条用例：美东 2026-03-08 的
 *    01:30 → 02:00 在字符串上是递增的，在真实时刻上却是负的）。
 *    ⇒ 所以本文件现在守两件事：**每一段都要查**（不只是第一段），
 *      以及**比较不许退化成比字符串**。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CalendarEventInputSchema } from '@mcsr/shared/calendar';

/**
 * 一个合法的基线，各用例在它上面改一处。
 *
 * ⚠️ 017 起时间是 `slots`（至少一段）。顶层 `startsAtLocal` 已经不是入参 ——
 *    留着它的话会被 Zod 当成未知键**剥掉**，于是每一条用例都因为
 *    `slots: expected array, received undefined` 而"通过"或"失败"，
 *    而那时它们证明的东西与用例名毫无关系（这正是最坏的一种假通过）。
 */
function base(overrides: Record<string, unknown> = {}) {
  return {
    title: 'MCSR Ranked 第 11 赛季资格赛',
    startsAtTz: 'Asia/Shanghai',
    slots: [{ startsAtLocal: '2026-09-05T16:00' }],
    tags: ['TOURNAMENT'],
    ...overrides,
  };
}

/** 一段时间的简写 —— 只写这一条用例关心的那两个墙钟值。 */
function slot(startsAtLocal: string, endsAtLocal: string | null = null) {
  return { startsAtLocal, endsAtLocal };
}

/** 解析失败时的错误位置（`['slots', 1, 'endsAtLocal']` → `'slots.1.endsAtLocal'`）。 */
function issuePaths(parsed: ReturnType<typeof CalendarEventInputSchema.safeParse>): string[] {
  return parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.'));
}

describe('★ 日历入参校验（Q1 标签 / Q2 三段式时间）', () => {
  it('基线能通过，且默认值被填上', () => {
    const parsed = CalendarEventInputSchema.safeParse(base());
    assert.equal(parsed.success, true, parsed.success ? '' : JSON.stringify(parsed.error.issues));
    if (!parsed.success) return;
    assert.equal(parsed.data.lang, 'zh-CN', 'lang 默认 zh-CN');
    assert.equal(parsed.data.allDay, false, 'allDay 默认 false');
    assert.equal(parsed.data.descriptionMd, '', '正文默认空串');
    // ★ 017 新增的两维也有默认值：`scopeDetail` 是**空数组**（不是 undefined）
    //   —— 读路径按"数组"用它，`undefined` 会在 `.some()` 上直接抛。
    assert.deepEqual(parsed.data.scopeDetail, [], 'scopeDetail 默认是空数组');
    assert.equal(parsed.data.access, undefined, 'access 没填就是"没填"，不是空串');
  });

  it('★ 每一段内结束时间必须晚于开始 —— 而这条必须换算成 UTC 再比，不是比字符串', () => {
    /*
     * 反面用例（017 之后的新形状，守的仍是同一条规则）：
     *   美东 2026-03-08 凌晨 02:00 直接跳到 03:00（夏令时开始），于是墙钟上
     *   '01:30' → '02:00' 是**递增**的 —— 按字符串比较的实现会放过它；
     *   而 02:00 那个墙钟时刻落在被跳掉的那一小时里，换算出来是 06:00Z，
     *   比 01:30 的 06:30Z **更早** ⇒ 真实时长是负的，必须被拒。
     *
     * ⚠️ 017 之前这条用例用的是"两端各带一个时区"的形状
     *    （'12:00'@UTC → '15:00'@Asia/Shanghai = 07:00Z：字符串上递增、真实时刻上负 5 小时）。
     *    整条事件只剩一个时区之后那个形状不存在了，能"骗过字符串比较"的输入
     *    只剩夏令时这一处 —— 所以改写到这里，而不是把这条断言删掉或改软。
     *
     * ⚠️⚠️ 这条断言同时**钉住了 `wallClockToUtc` 对"不存在的墙钟时刻"的处理**：
     *    02:00 在美东那天并不存在（被跳掉了），当前实现把它算成 06:00Z
     *    （`calendar-time.ts` 的两遍偏移算法）。换个夏令时规则不同的第三方
     *    时区库（把不存在的时刻往前推到 03:00 EDT = 07:00Z）会让这里变红 ——
     *    而那时"负时长"其实已经不成立了。**那是实现变正确导致的红，不是回归**：
     *    届时正确的处置是换一个仍然能区分"比字符串 / 比真实时刻"的输入，
     *    或者把这层语义搬到 `calendar-time.test.ts`（它已经在按硬编码答案钉
     *    夏令时行为）—— 不要为了让它变绿而放宽这条断言。
     */
    const bad = CalendarEventInputSchema.safeParse(
      base({
        startsAtTz: 'America/New_York',
        slots: [slot('2026-03-08T01:30', '2026-03-08T02:00')],
      }),
    );
    assert.equal(bad.success, false, '负时长必须被拒（说明比较用的是真实时刻而不是字符串）');
    // 而且错要落在那一段的结束上，否则前端定位不到是哪一段写反了
    assert.deepEqual(issuePaths(bad), ['slots.0.endsAtLocal'], '错误必须指向写反的那一段');

    /*
     * ★ 逐段：**第二段**写反同样必须被拒。
     *   schema 里这条规则从"检查那一对"变成了 `slots.forEach` ——
     *   只查第一段的实现在这里会红，而它的后果是"第 2 段的负时长一路进库"，
     *   在界面上只表现为那一条日期条画得比别人矮一截。
     */
    const secondBad = CalendarEventInputSchema.safeParse(
      base({
        slots: [
          slot('2026-09-05T16:00', '2026-09-05T18:00'),
          slot('2026-09-06T18:00', '2026-09-06T16:00'),
        ],
      }),
    );
    assert.equal(secondBad.success, false, '第 2 段的结束早于开始也必须被拒（校验是逐段跑的）');
    assert.deepEqual(issuePaths(secondBad), ['slots.1.endsAtLocal'], '错误要指在第 2 段上');
  });

  it('★ 合法的多段时间不能被误拒（原名「跨时区但确实晚于开始的，不能被误拒」）', () => {
    /*
     * ---------------------------------------------------------------------
     * 原来断言的是什么 / 为什么现在换成这个形状
     * ---------------------------------------------------------------------
     * 原来：『结束写在**另一个时区**里、但换算之后确实晚于开始』这种合法组合
     *       不能被误拒（字符串上 '13:00' < '20:00'，一个按字符串比较的实现会误拒它）。
     *
     * 现在：整条事件**只有一个时区**（用户要求"时区放在最上面，只填一次即可"），
     *       所以"跨时区"这一半彻底没有了 —— 它不再是"等价于原来那条断言"，
     *       而是留下原来那条断言的**正面命题**：合法的段不能被误拒。
     *       而多段模型给它添了两个新的、同样"合法但容易被误拒"的形状，一并守在这里：
     *         ① 同一段内 end > start；
     *         ② **段的顺序不承重**（界面允许乱序添加，服务端按开始时间升序重排）。
     *       ②是真会踩的：一个"要求入参按时间递增"的实现会把一份完全合法的输入拒掉，
     *       而用户看到的是"保存失败"，永远猜不到原因。
     *
     * ⚠️ 用例名也一并改了：新模型里"跨时区"这个前提**不存在**（一条事件只有一个
     *    时区），留着一个已经不成立的名字会让下一个人以为这里在测跨时区。
     *    原名写在标题里，方便对着迁移前的失败清单核对是同一条。
     */
    const one = CalendarEventInputSchema.safeParse(
      base({ slots: [slot('2026-08-30T20:00', '2026-08-30T22:00')] }),
    );
    assert.equal(one.success, true, '同一段内结束晚于开始是合法的，不能被误拒');

    const outOfOrder = CalendarEventInputSchema.safeParse(
      base({
        slots: [
          slot('2026-09-12T16:00', '2026-09-12T18:00'), // 晚的那一段写在前面
          slot('2026-09-05T16:00', '2026-09-05T18:00'),
        ],
      }),
    );
    assert.equal(
      outOfOrder.success,
      true,
      '段的顺序不承重（服务端会重排），不能因为"没按时间递增"被误拒',
    );
  });

  it('时区只有一份：必须在顶层给全，也不能塞回每一段（旧"成对"规则的等价物）', () => {
    /*
     * ---------------------------------------------------------------------
     * 原来断言的是什么 / 为什么现在换成这个形状
     * ---------------------------------------------------------------------
     * 原来：『结束时间的两个字段必须成对出现』—— 那时开始与结束**各有一个时区**，
     *       只给 local 或只给 tz 会造出一个"半个时刻"（算不出 UTC 的那个），
     *       所以两半必须成对，缺一半必须被拒。
     *
     * 现在：多段模型把"每端一个时区"整个删掉了，整条事件只有顶层一个 `startsAtTz`，
     *       "成对"这个说法没有对象了。它的**等价命题**是下面两条，
     *       守的仍然是同一件事（时间不能缺少唯一的那份时区，也不能有两个来源）：
     *         ① 那一份**不能省** —— 省了就整条事件没有时区，每一段的墙钟时间都
     *            算不出真实时刻；而"从每一段自己的 `startsAtTz` 补回来"是旧模型的
     *            写法，现在不构成"给了时区"（Zod 把段里的未知键剥掉）。
     *         ② 反过来，段里**不许**再自带时区 —— 否则同一个时间有两个来源，
     *            而"哪一份说了算"正是一条只在出错时才被发现的规则。
     */
    const noTopTz = CalendarEventInputSchema.safeParse({
      title: '缺时区的',
      tags: ['TOURNAMENT'],
      // 旧写法：时区跟着每一段走（那时 endsAtTz 也在这一层）
      slots: [{ startsAtLocal: '2026-09-05T16:00', startsAtTz: 'Asia/Shanghai' }],
    });
    assert.equal(
      noTopTz.success,
      false,
      '顶层时区不能省 —— 也不能靠每一段自带的那个补回来（段里的时区会被剥掉）',
    );
    assert.deepEqual(issuePaths(noTopTz), ['startsAtTz'], '错误要指向顶层那一份时区');

    const smuggled = CalendarEventInputSchema.safeParse(
      base({
        slots: [
          { startsAtLocal: '2026-09-05T16:00', endsAtLocal: '2026-09-05T18:00', startsAtTz: 'UTC' },
        ],
      }),
    );
    assert.equal(smuggled.success, true, '段里多带的键不该影响其余字段（Zod 剥掉未知键）');
    if (!smuggled.success) return;
    const parsedSlot = smuggled.data.slots[0];
    assert.ok(parsedSlot, '解析之后必须还有那一段');
    assert.equal(
      Object.hasOwn(parsedSlot, 'startsAtTz'),
      false,
      '每一段只能有墙钟时间：段里自带的时区必须被丢掉，时间只认顶层那一份',
    );
    assert.deepEqual(
      parsedSlot,
      { startsAtLocal: '2026-09-05T16:00', endsAtLocal: '2026-09-05T18:00' },
      '段里只该留下两个墙钟字段',
    );
  });

  it('整天事件的时间部分必须是 00:00（每一段都要查）', () => {
    const bad = CalendarEventInputSchema.safeParse(base({ allDay: true }));
    assert.equal(bad.success, false, '整天事件给了 16:00 应当被拒');

    const ok = CalendarEventInputSchema.safeParse(
      base({ allDay: true, slots: [slot('2026-09-05T00:00')] }),
    );
    assert.equal(ok.success, true);

    /*
     * ⚠️ 017 之后这条是**逐段**跑的（schema 里的 `slots.forEach`）：
     *    只查第一段的实现会放过"3 天的赛程里第 2 天写着 16:00"，
     *    而它在界面上只表现为那一条日期条画歪了，**不报错**。
     */
    const secondBad = CalendarEventInputSchema.safeParse(
      base({ allDay: true, slots: [slot('2026-09-05T00:00'), slot('2026-09-06T16:00')] }),
    );
    assert.equal(secondBad.success, false, '第 2 段不是 00:00 同样要被拒');
    assert.deepEqual(issuePaths(secondBad), ['slots.1.startsAtLocal'], '错误要指在第 2 段上');
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

  it('⚠️ 墙钟字段不接受带时区后缀的写法（现在只剩段里的那两个字段）', () => {
    // 同一个字段两种含义（带后缀按后缀、不带按 startsAtTz）是一条
    // 只有出错时才会被发现的规则 —— 所以干脆不接受。
    //
    // ⚠️ 017 之后顶层已经没有墙钟字段了，这两个字段都在**每一段**里：
    //    两个都要测 —— 只测 `startsAtLocal` 的话，`endsAtLocal` 的写法口径
    //    哪天变了（比如允许了 'Z' 后缀）也不会有任何一条断言变红。
    for (const bad of ['2026-09-05T16:00Z', '2026-09-05T16:00+08:00', '2026-09-05 16:00']) {
      assert.equal(
        CalendarEventInputSchema.safeParse(base({ slots: [slot(bad)] })).success,
        false,
        `段里的 startsAtLocal=${bad} 应当被拒`,
      );
      assert.equal(
        CalendarEventInputSchema.safeParse(base({ slots: [slot('2026-09-05T14:00', bad)] }))
          .success,
        false,
        `段里的 endsAtLocal=${bad} 应当被拒`,
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

    /*
     * ⚠️ 017 之后"第二个真相"多了一个入口：**段里**。每一段在响应里确实带着
     *    两个 UTC（`EventSlot` 的 startsAtUtc / endsAtUtc），那是读路径派生的；
     *    入参这边必须一样地剥掉，否则客户端可以塞一个与自己 local+tz 矛盾的时刻，
     *    而读写两边会给出不同的答案 —— 且不会有任何报错。
     */
    const inSlot = CalendarEventInputSchema.safeParse(
      base({
        slots: [{ startsAtLocal: '2026-09-05T16:00', startsAtUtc: 123, endsAtUtc: 456 }],
      }),
    );
    assert.equal(inSlot.success, true);
    if (!inSlot.success) return;
    const parsedSlot = inSlot.data.slots[0];
    assert.ok(parsedSlot, '解析之后必须还有那一段');
    assert.deepEqual(
      [Object.hasOwn(parsedSlot, 'startsAtUtc'), Object.hasOwn(parsedSlot, 'endsAtUtc')],
      [false, false],
      '段里的两个 UTC 也必须被剥掉：时刻只能由服务端从 local+tz 算出来',
    );
  });
});
