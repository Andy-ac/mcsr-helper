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
  SHARE_LIMITS,
  SHARE_NOTE_UNITS,
  SHARE_SEED_MAX,
  textWidth,
  sharePostSchema,
  parseSharePayload,
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
  it('两种 kind、四档时长、默认 5', () => {
    assert.deepEqual([...SHARE_KINDS], ['room', 'seed']);
    assert.deepEqual([...SHARE_MINUTES], [5, 10, 15, 20]);
    assert.equal(DEFAULT_SHARE_MINUTES, 5);
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
  const ok = { overworld: '1234567890123456789', minutes: 10 };

  it('只有主世界也能发（其余三格选填）', () => {
    assert.equal(sharePostSchema('seed').safeParse(ok).success, true);
  });

  it('主世界必填', () => {
    assert.equal(sharePostSchema('seed').safeParse({ ...ok, overworld: '' }).success, false);
    assert.equal(sharePostSchema('seed').safeParse({ minutes: 10 }).success, false);
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
