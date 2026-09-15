/**
 * 实时分享的**契约层**测试：宽度预算、两种 kind 的校验、限额常量。
 *
 * ⚠️ 这些测试放在 services/api 下，是因为本仓的测试运行器只在这个工作区里
 *    （`packages/shared` 只有 typecheck）。共享模块的行为一律在这里被钉住。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const {
  SHARE_KINDS,
  SHARE_MINUTES,
  DEFAULT_SHARE_MINUTES,
  SHARE_DAYS_MIN,
  SHARE_DAYS_MAX,
  DEFAULT_SHARE_DAYS,
  SHARE_DAY_MS,
  SHARE_LIMITS,
  SHARE_NOTE_UNITS,
  SHARE_SEED_MAX,
  textWidth,
  sharePostSchema,
  parseSharePost,
  parseSharePayload,
  parseShareDays,
  durationToMs,
  RoomPostSchema,
  SeedPostSchema,
} = await import('@mcsr/shared');

describe('textWidth：20字/40字符怎么算', () => {
  it('ASCII 每个算 1', () => {
    assert.equal(textWidth('A7K2P'), 5);
    assert.equal(textWidth(''), 0);
  });

  it('汉字每个算 2 —— 20 个汉字正好用满 40 的预算', () => {
    assert.equal(textWidth('三'), 2);
    assert.equal(textWidth('一'.repeat(20)), 40);
    assert.equal(textWidth('一'.repeat(21)), 42);
  });

  it('中英混写按各自宽度相加（这是选"宽度预算"而不是"字符数"的原因）', () => {
    // "1.16 RSG " 是 9 个半角，加 3 个汉字 6 ⇒ 15
    assert.equal(textWidth('1.16 RSG 三缺一'), 9 + 6);
  });

  it('emoji 算 2（与一个汉字同宽），且不会因为在代理对上而算成 2 个字符', () => {
    assert.equal(textWidth('🏃'), 2);
    assert.equal([...'🏃'].length, 1, '探针：一个 emoji 只有一个码点');
  });

  it('全角标点算 2，半角标点算 1', () => {
    assert.equal(textWidth('，'), 2);
    assert.equal(textWidth(','), 1);
  });
});

describe('常量（冻结值，改了必须同步 spec §13）', () => {
  it('两种 kind、room 四档分钟（默认 5）、seed 1–30 天（默认 7）', () => {
    assert.deepEqual([...SHARE_KINDS], ['room', 'seed']);
    assert.deepEqual([...SHARE_MINUTES], [5, 10, 15, 20]);
    assert.equal(DEFAULT_SHARE_MINUTES, 5);
    /*
     * ★★ 种子那一套是 2026-09-16 用户改的口径：「以天为单位，最多 30 天（自行填写）」。
     *    ⚠️ 三个数（下界 / 上界 / 默认）**都要**钉：只钉上界的话，把默认值从 7 改成 30
     *       没有任何门禁会红，而它意味着"没填的人挂了整整一个月"。
     */
    assert.equal(SHARE_DAYS_MIN, 1);
    assert.equal(SHARE_DAYS_MAX, 30);
    assert.equal(DEFAULT_SHARE_DAYS, 7);
    assert.equal(SHARE_DAY_MS, 86_400_000, '一天的毫秒数只有这一处定义');
  });

  it('限额：room 1 条（语义不变量）、seed 20 条（额度）', () => {
    assert.deepEqual(SHARE_LIMITS, { room: 1, seed: 20 });
  });

  it('说明预算：room 40 单位、seed 100 单位', () => {
    assert.deepEqual(SHARE_NOTE_UNITS, { room: 40, seed: 100 });
  });

  it('种子长度上限 32', () => {
    assert.equal(SHARE_SEED_MAX, 32);
  });
});

describe('room 的 body 校验', () => {
  const ok = { code: 'A7K2P', minutes: 5 };

  it('合法：字母数字，以及 - 和 _（racetime 那类标识带连字符）', () => {
    for (const code of ['A7K2P', 'ab-12_x', 'ABC', 'a'.repeat(20)]) {
      assert.equal(sharePostSchema('room').safeParse({ ...ok, code }).success, true, code);
    }
  });

  it('非法：2 字符 / 21 字符 / 含空格 / 含中文 / 空', () => {
    for (const code of ['ab', 'a'.repeat(21), 'A7 K2', '房间号', '']) {
      assert.equal(sharePostSchema('room').safeParse({ ...ok, code }).success, false, code);
    }
  });

  it('★ 两端空白先 trim（“ A7K2P ”是合法的，存下来的是 A7K2P）', () => {
    // ⚠️ 这一条要**带类型**地断言 `data.code`，所以直接用 RoomPostSchema ——
    //    `sharePostSchema('room')` 的返回类型是 `z.ZodType`，它的 `data` 是 unknown。
    const parsed = RoomPostSchema.safeParse({ ...ok, code: ' A7K2P ' });
    assert.equal(parsed.success, true);
    assert.equal(parsed.success && parsed.data.code, 'A7K2P');
  });

  it('minutes 只接受四档里的值，不接受区间内的其它数', () => {
    for (const minutes of [...SHARE_MINUTES]) {
      assert.equal(sharePostSchema('room').safeParse({ ...ok, minutes }).success, true);
    }
    for (const minutes of [0, 7, 25, -5, 5.5]) {
      assert.equal(
        sharePostSchema('room').safeParse({ ...ok, minutes }).success,
        false,
        String(minutes),
      );
    }
  });

  it('说明选填：不传、传空串都成功；超预算就拒绝', () => {
    assert.equal(sharePostSchema('room').safeParse(ok).success, true);
    assert.equal(sharePostSchema('room').safeParse({ ...ok, note: '' }).success, true);
    assert.equal(sharePostSchema('room').safeParse({ ...ok, note: '一'.repeat(20) }).success, true);
    assert.equal(
      sharePostSchema('room').safeParse({ ...ok, note: '一'.repeat(21) }).success,
      false,
    );
    assert.equal(sharePostSchema('room').safeParse({ ...ok, note: 'a'.repeat(40) }).success, true);
    assert.equal(sharePostSchema('room').safeParse({ ...ok, note: 'a'.repeat(41) }).success, false);
  });
});

describe('seed 的 body 校验', () => {
  const ok = { overworld: '1234567890123456789', days: 7 };

  it('只有主世界也能发（其余三格选填）', () => {
    assert.equal(sharePostSchema('seed').safeParse(ok).success, true);
  });

  it('主世界必填', () => {
    assert.equal(sharePostSchema('seed').safeParse({ ...ok, overworld: '' }).success, false);
    assert.equal(sharePostSchema('seed').safeParse({ days: 7 }).success, false);
  });

  it('选填的三格留空等于不填（trim 之后变成 undefined，不是空串）', () => {
    const parsed = SeedPostSchema.safeParse({ ...ok, nether: '  ', end: '', rng: undefined });
    assert.equal(parsed.success, true);
    assert.equal(parsed.success && parsed.data.nether, undefined);
    assert.equal(parsed.success && parsed.data.end, undefined);
  });

  it('种子里不能有空白（内部也不行 —— 否则 123 456 会被当成一个种子）', () => {
    for (const seed of ['12 34', '12\t34', '12\n34']) {
      assert.equal(
        sharePostSchema('seed').safeParse({ ...ok, overworld: seed }).success,
        false,
        JSON.stringify(seed),
      );
    }
  });

  it('长度上限 32', () => {
    assert.equal(
      sharePostSchema('seed').safeParse({ ...ok, overworld: 'a'.repeat(32) }).success,
      true,
    );
    assert.equal(
      sharePostSchema('seed').safeParse({ ...ok, overworld: 'a'.repeat(33) }).success,
      false,
    );
  });

  it('说明预算 100：50 个汉字通过、51 个拒绝', () => {
    assert.equal(sharePostSchema('seed').safeParse({ ...ok, note: '一'.repeat(50) }).success, true);
    assert.equal(
      sharePostSchema('seed').safeParse({ ...ok, note: '一'.repeat(51) }).success,
      false,
    );
  });

  /*
   * ★★ `days` 是 2026-09-16 用户改的口径：「以天为单位，最多 30 天（自行填写）」。
   *    这一格与 room 的 `minutes` **不是一回事**：那边是四档枚举（界面上四个 radio），
   *    这边是 1–30 的**区间**（自己填）。
   */
  it('days：下界、默认、上界都通过（1 / 7 / 30）', () => {
    for (const days of [SHARE_DAYS_MIN, DEFAULT_SHARE_DAYS, SHARE_DAYS_MAX]) {
      assert.equal(sharePostSchema('seed').safeParse({ ...ok, days }).success, true, String(days));
    }
  });

  it('days 不传 ⇒ 冻结的默认 7 天（不是 undefined、也不是 0）', () => {
    const parsed = SeedPostSchema.safeParse({ overworld: '1' });
    assert.equal(parsed.success, true);
    assert.equal(parsed.success && parsed.data.days, DEFAULT_SHARE_DAYS);
  });

  it('days：区间外 / 小数 / 字符串 / 非数字一律拒', () => {
    for (const days of [0, 31, -1, 1.5, '7', null, true, Number.NaN]) {
      assert.equal(sharePostSchema('seed').safeParse({ ...ok, days }).success, false, String(days));
    }
    // 探针：`'7'` 与 `7` 是两种东西（JSON 里数字与字符串本来就不一样）
    assert.equal(typeof '7', 'string');
    assert.equal(sharePostSchema('seed').safeParse({ ...ok, days: '7' }).success, false);
  });

  it('★ 旧的 `minutes` 键现在是"多传了一个不认识的键" ⇒ 当场拒（不静默当天数）', () => {
    const stale = sharePostSchema('seed').safeParse({ overworld: '1', minutes: 30 });
    assert.equal(stale.success, false, '`{ minutes: 30 }` 不许被当成 30 天');
  });

  it('两个 kind 的时长键互不通用（room 也不收 `days`）', () => {
    assert.equal(sharePostSchema('room').safeParse({ code: 'A7K2P', days: 7 }).success, false);
  });
});

/*
 * ★★ `parseShareDays` 是**界面那一格**的判据（输入框给的是字符串，而服务端收到的是
 *    JSON 数字），它住在 shared 就是为了能被这一节钉住 —— `apps/web` 没有测试运行器，
 *    写在组件里那条规则只有人眼能验，而它错了的表现是"填 30 被打回"。
 */
describe('parseShareDays：界面那一格怎么读用户填的原文', () => {
  it('纯数字、在区间内 ⇒ 天数', () => {
    assert.equal(parseShareDays('1'), 1);
    assert.equal(parseShareDays('7'), 7);
    assert.equal(parseShareDays('30'), 30);
    assert.equal(parseShareDays(' 7 '), 7, '两端空白先 trim（输入框里手滑打个空格不算错）');
    assert.equal(parseShareDays('07'), 7, '前导零认（`07` 就是 7）');
  });

  it('没填 / 不是纯数字 / 小数 / 区间外 ⇒ null', () => {
    for (const raw of [
      '',
      '   ',
      'abc',
      '7.5',
      '0',
      '31',
      '-1',
      '1e1',
      '7 天',
      '+7',
      '9999',
      '３',
    ]) {
      assert.equal(parseShareDays(raw), null, JSON.stringify(raw));
    }
  });

  /*
   * ★★ 这两条路（界面读字符串 / 服务端读数字）是**同一条规则**，所以它们对同一个值
   *    必须给出同一个结论。界漂了（比如这边改成 1–31）这一条会当场红 ——
   *    而那正是"两处实现、一份规则"最容易出的那种错。
   */
  it('★★ 与 daysSchema 逐值对照：两条路对同一组输入给出同一个结论', () => {
    for (const raw of ['1', '7', '30', '0', '31', '9999']) {
      const viaText = parseShareDays(raw) !== null;
      const viaNumber = sharePostSchema('seed').safeParse({
        overworld: '1',
        days: Number(raw),
      }).success;
      assert.equal(viaText, viaNumber, `原文 ${JSON.stringify(raw)}：界面与服务端必须同结论`);
    }
  });
});

describe('parseSharePost：时长带着单位出来（唯一一处"哪个 kind 用哪个单位"）', () => {
  it('room ⇒ minutes（四档里的值），seed ⇒ days（1–30）', () => {
    const room = parseSharePost('room', { code: 'A7K2P', minutes: 15 });
    assert.deepEqual(room.ok && room.duration, { unit: 'minutes', value: 15 });

    const seed = parseSharePost('seed', { overworld: '1', days: 30 });
    assert.deepEqual(seed.ok && seed.duration, { unit: 'days', value: 30 });
  });

  /*
   * ★★ 默认档也要**带着各自的单位**出来：两边都是"不传就用默认"，而默认值
   *    一个是 5 分钟、一个是 7 天。这一条钉的是"单位不会串"（room 拿到 days
   *    的默认值那种错）。
   */
  it('不传时长 ⇒ 各自的默认档，单位不串', () => {
    const room = parseSharePost('room', { code: 'A7K2P' });
    assert.equal(room.ok, true);
    assert.deepEqual(room.ok ? room.duration : null, {
      unit: 'minutes',
      value: DEFAULT_SHARE_MINUTES,
    });

    const seed = parseSharePost('seed', { overworld: '1' });
    assert.equal(seed.ok, true);
    assert.deepEqual(seed.ok ? seed.duration : null, { unit: 'days', value: DEFAULT_SHARE_DAYS });
  });

  it('durationToMs：分钟与天各算各的 —— 同名数字差 1440 倍', () => {
    assert.equal(durationToMs({ unit: 'minutes', value: 15 }), 900_000);
    assert.equal(durationToMs({ unit: 'days', value: 30 }), 30 * 86_400_000);
    assert.equal(durationToMs({ unit: 'days', value: 1 }), SHARE_DAY_MS);
    /*
     * ⚠️ 这一条是**判据本身**：同一个数字在两个单位下差 1440 倍。写成相等的话，
     *    "单位"这件事就整个失效了 —— 而那正是"15 天被存成 15 分钟"的表现。
     * ⚠️ 用 15 而不是 7：`{ unit: 'minutes', value: 7 }` **根本构造不出来**
     *    （`ShareMinutes` 是 `5 | 10 | 15 | 20` 那个字面量联合，类型检查会拦），
     *    所以这一条只能拿两边都合法的数来比。那道类型上的门本身就是第一道防线。
     */
    assert.notEqual(
      durationToMs({ unit: 'days', value: 15 }),
      durationToMs({ unit: 'minutes', value: 15 }),
    );
  });
});

describe('parseSharePayload：读出来的那一半', () => {
  /*
   * ★ 这一条守的是 spec §3.2 的代价：payload 的形状只有应用层知道，
   *   所以"形状对不上 kind 的行"必须在**读**的时候被拦下来，而不是透传给前端。
   *   `null` = 这一行坏了，调用方跳过它并记日志。
   */
  it('形状对得上就给出解析结果', () => {
    assert.deepEqual(parseSharePayload('room', { code: 'A7K2P' }), { code: 'A7K2P' });
  });

  it('★ 形状对不上 kind 一律回 null（不是抛、不是半个对象）', () => {
    assert.equal(parseSharePayload('room', { overworld: '1' }), null, 'room 里塞了种子的形状');
    assert.equal(parseSharePayload('seed', { code: 'A7K2P' }), null, 'seed 里塞了房间号的形状');
    assert.equal(parseSharePayload('seed', {}), null, 'seed 少了必填的主世界');
    assert.equal(parseSharePayload('room', { code: 'a b' }), null, 'room 的值本身非法');
    assert.equal(parseSharePayload('room', null), null);
    assert.equal(parseSharePayload('room', 'not json'), null);
    assert.equal(parseSharePayload('room', []), null);
  });
});
