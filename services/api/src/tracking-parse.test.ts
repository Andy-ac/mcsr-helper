/**
 * 三个时长解析器与标签推导的**逐值契约**（spec §5.6 / §4.3）。
 *
 * ===========================================================================
 * 为什么这一组断言比别处的更值得写
 * ===========================================================================
 * 这三个函数错了**不会抛异常**。一个解析错的时长在界面上看起来完全正常，
 * 只是那一格显示的是别的数字 —— 而 `short` / `long` 两个标签会因此**全部**判错，
 * 后面没有任何一步会回头核对它（spec §5.6 原话："它们错了不会抛异常，
 * 只会让界面上显示一个错的时长、或者让标签全打错"）。
 * ⇒ 这一层**没有下游检查**，测试就是唯一的判据。所以下面一律写逐值断言，
 *   而不是"解析成功就算过"（`assert.ok(parseX(...))` 那种在本文件里等于没测）。
 *
 * ===========================================================================
 * ★ 任务清单逐字点名的那 25 条，与这里补的那几条
 * ===========================================================================
 * 标 ★ 的用例是任务清单里逐字给出的判据，一条都没动（改动它们就等于改判据）；
 * 标 + 的是这里补的，补的理由分四类，每一类都是"看起来能过、其实是错的"：
 *
 *   1. **边界的那一格**：`60` / `61` / `1199` / `1200`。判据是 `<= 60` 与 `>= 1200`，
 *      差一个 `=` 时两条用例各自沉默地错开，而中间档（300 秒）**故意不打标签**。
 *   2. **"段"的上界**（裁决写在 `tracking/parse.ts` 文件头）：`12:99`、`1:99:00`
 *      要被拒，而 `99:00` 要被**接受**成 5940。后面这条是刻意钉住的裁决 ——
 *      它写成一条断言，是为了让"改主意"变成一件会红的事，而不是一次静默的偏移。
 *   3. **总和为 0 一律 `null`**（复审裁决，理由全文在 `tracking/parse.ts` 文件头）：
 *      `'0:00'` / `'0s'` / `'PT0S'` / `'P0D'` 与 `''` / `null` / `undefined` / `'abc'`
 *      一样都返回 `null`。没有任何平台会产出一支真 0 秒的视频 —— 那些 0 是
 *      "这一格没量到"（YouTube 用 `PT0S` / `P0D` 表示已下架 / 待首播 / 拿不到时长的
 *      那些条目），而回 0 的后果是**没有报错的错标签**：`deriveTags` 立刻给一支我们
 *      一无所知的视频打上 `short`（`0 <= 60`），存进去就是一个看起来完全正常的
 *      `["short"]`。⚠️ 这条与本仓既有纪律同源（`apps/web/src/components/SeedResultCard.tsx:154-155`
 *      贴在该卡 `matchDate` 渲染上的那条"不能显示成 0"，另一个副本见
 *      `packages/shared/src/tracking.ts:59`）：`0` 只在**真的量到 0** 时才是数据，
 *      "没量到"必须是 `null` —— 两者合并之后，"这支视频没人看"与
 *      "上游这一轮没回这个字段"就再也分不开了。
 *   4. **格式之外的东西要拒**：天数在 ISO 8601 里合法（`P1D`）但在 Twitch 的
 *      `1h2m3s` 里不合法；`P1M` 是**月**不是一分钟（`PT1M` 才是）——
 *      这一对是三个解析器里最容易写错的一处，因为它读起来"显然"是分钟。
 *
 * ===========================================================================
 * ⚠️ 这个文件跑在 `services/api` 里，而函数住在 `services/api/src/tracking/parse.ts`
 * ===========================================================================
 * 理由与 `tracking-schema.test.ts` 的文件头同一条：本仓的测试运行器只在这个工作区
 * （`packages/shared` 只有 typecheck）—— 照 `live-shares-schema.test.ts` 的先例。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  deriveTags,
  parseBilibiliLength,
  parseTwitchDuration,
  parseYouTubeDuration,
} from './tracking/parse';

describe('★ 追踪视频的时长解析与标签推导（spec §5.6 / §4.3）', () => {
  describe('parseBilibiliLength（bilibili 的 `length`，`MM:SS` / `HH:MM:SS`）', () => {
    it('★ 清单给的五条：两段、三段、三位小时、前导零、单个数字的秒', () => {
      assert.equal(parseBilibiliLength('01:51'), 111);
      assert.equal(parseBilibiliLength('1:02:33'), 3753);
      assert.equal(parseBilibiliLength('12:34:56'), 45296);
      assert.equal(parseBilibiliLength('0:09'), 9);
    });

    it('+ 两段是 `分:秒`、三段是 `时:分:秒` —— 段数读错就是 spec §9.2 的 mutation ④', () => {
      // 把两段当三段（或反过来）不会报错：`02:33` 会变成 2 小时 33 分。
      assert.equal(parseBilibiliLength('02:33'), 153, '两段 = 2 分 33 秒');
      assert.equal(parseBilibiliLength('2:33:00'), 9180, '三段 = 2 时 33 分');
      assert.notEqual(parseBilibiliLength('02:33'), 2 * 3600 + 33 * 60);
    });

    it('★ 秒必须 0–59，否则拒绝（`1:99` 不许被静默当成 159 秒）', () => {
      assert.equal(parseBilibiliLength('1:99'), null);
    });

    it('+ 冒号**后面**的每一段都受 0–59 约束，不只是最后一段', () => {
      assert.equal(parseBilibiliLength('12:99'), null, '两段里的秒');
      assert.equal(parseBilibiliLength('1:02:99'), null, '三段里的秒');
      assert.equal(
        parseBilibiliLength('1:99:00'),
        null,
        '三段里的**分**（59 分以上就是该进位没进位）',
      );
      assert.equal(parseBilibiliLength('59:59'), 3599, '两段的合法上界');
      assert.equal(parseBilibiliLength('1:59:59'), 7199, '三段的合法上界');
    });

    it('+ ⚠️ 第一个冒号**之前**那一段不受 59 约束（照 parseTimecode 的裁决，不是漏了）', () => {
      // 详见 parse.ts 文件头那条裁决。这里钉住它，改主意必须是一次会红的事。
      assert.equal(
        parseBilibiliLength('99:00'),
        5940,
        '`MM:SS` 里的 MM 超过 59 仍然是明确的"99 分钟"',
      );
      assert.equal(
        parseBilibiliLength('100:00:00'),
        360_000,
        '`HH:MM:SS` 里的 HH 更不能受 59 约束',
      );
      assert.equal(
        parseBilibiliLength('9999:00'),
        599_940,
        '上限是 4 位数（理智边界，见 parse.ts）',
      );
    });

    it('+ 非法输入一律 null —— 不是 0，也不是 NaN', () => {
      for (const bad of [
        'abc',
        '-5',
        '1.5',
        '1:2:3:4',
        '1:',
        ':30',
        '1::30',
        '1:30x',
        '1m30s',
        'PT1H',
        '１:３０',
        '99999:00',
        '1 30',
      ]) {
        assert.equal(parseBilibiliLength(bad), null, `${JSON.stringify(bad)} 应当被拒`);
      }
    });

    it('+ ⚠️ 总和为 0 ⇒ null：`0:00` 是"这一格没时长"，不是"一支 0 秒的视频"', () => {
      // 裁决与理由见 `tracking/parse.ts` 文件头。回 0 的话这支视频会拿到一个
      // 看起来完全正常的 `short`（spec §4.3 的 `0 <= 60`），而没有任何异常可抓。
      assert.equal(parseBilibiliLength('0:00'), null);
      assert.equal(
        parseBilibiliLength('0:0'),
        null,
        '短写法同理 —— 判的是**总和**，不是那个字符串',
      );
    });

    it('+ null / undefined / 空串 / 纯空白 ⇒ null（上游没给这一格，不是"0 秒"）', () => {
      assert.equal(parseBilibiliLength(null), null);
      assert.equal(parseBilibiliLength(undefined), null);
      assert.equal(parseBilibiliLength(''), null);
      assert.equal(parseBilibiliLength('   '), null);
    });

    it('+ 前后空白会被 trim 掉（上游 JSON 里多一个空格不该让整条视频丢掉时长）', () => {
      assert.equal(parseBilibiliLength('  01:51  '), 111);
      assert.equal(parseBilibiliLength(' 1:02:33'), 3753);
    });
  });

  describe('parseTwitchDuration（Twitch 的 `duration`，形如 `1h2m3s`）', () => {
    it('★ 清单给的四条：三段、只有分、只有秒、只有时', () => {
      assert.equal(parseTwitchDuration('1h2m3s'), 3723);
      assert.equal(parseTwitchDuration('2m'), 120);
      assert.equal(parseTwitchDuration('45s'), 45);
      assert.equal(parseTwitchDuration('1h'), 3600);
    });

    it('+ 三段可以任意缺中间那段，顺序不能反', () => {
      assert.equal(parseTwitchDuration('1h30s'), 3630, '缺 m 段');
      assert.equal(parseTwitchDuration('2h30m'), 9000, '缺 s 段');
      assert.equal(parseTwitchDuration('1h0m0s'), 3600, '补齐的 0 段');
      assert.equal(parseTwitchDuration('10h59m59s'), 39599, '三段齐全的常见满值');
      assert.equal(
        parseTwitchDuration('1m2h'),
        null,
        '顺序反了必须拒（不能靠"有没有见过 h"来修正）',
      );
    });

    it('+ ⚠️ 没有冒号 ⇒ 段不受 59 约束：`1h99m` 就是 99 分钟（与 `99:00` 同一条裁决）', () => {
      // 与 bilibili 那条裁决同源（`tracking/parse.ts` 文件头："只有冒号**后面**的段受 0–59"）。
      // Twitch 的形状里**根本没有冒号**，59 这条规则在这里没有落点：99 分是这个格式的
      // 字面意思，不是"该进位没进位"（`1:99` 才是那种输入错）。
      // ⚠️ 真正约束这些段的只有"1–4 位数字"那条理智边界（`'99999h'` 在下面那条里被拒）。
      assert.equal(parseTwitchDuration('1h99m'), 9540, '1 小时 99 分是合法写法，不是错误');
    });

    it('+ ⚠️ 不接受 `d`（天）：spec §2.3 写明这个字段是 `1h2m3s` 形状', () => {
      // 拒绝的代价：真出现 24 小时以上的 VOD 时这一格是 null（**丢掉一个时长**），
      // 而不是一个猜出来的数。理由与下面的 ISO 那条同源 —— 窄读文档的形状。
      assert.equal(parseTwitchDuration('1d2h'), null);
      assert.equal(parseTwitchDuration('1d'), null);
    });

    it('+ 非法输入一律 null —— 不是 0，也不是 NaN', () => {
      for (const bad of [
        'nope',
        '1h 2m',
        '1h2m3',
        '1h2m3s4',
        '1h2m3ss',
        'h',
        'm2',
        '1H2M3S',
        '99999h',
        'PT1H',
        '-1h',
      ]) {
        assert.equal(parseTwitchDuration(bad), null, `${JSON.stringify(bad)} 应当被拒`);
      }
    });

    it('+ ⚠️ 总和为 0 ⇒ null（`0s` / `0h0m0s` —— Twitch 不产出一支真的 0 秒 VOD）', () => {
      assert.equal(parseTwitchDuration('0s'), null);
      assert.equal(parseTwitchDuration('0h0m0s'), null, '三段补齐的写法值一样是 0');
    });

    it('+ null / undefined / 空串 / 纯空白 ⇒ null', () => {
      assert.equal(parseTwitchDuration(null), null);
      assert.equal(parseTwitchDuration(undefined), null);
      assert.equal(
        parseTwitchDuration(''),
        null,
        '⚠️ 三个段都是可选时，空串会被正则匹配上 —— 必须有"至少一段"这条',
      );
      assert.equal(parseTwitchDuration('   '), null);
    });

    it('+ 前后空白会被 trim 掉', () => {
      assert.equal(parseTwitchDuration(' 1h2m3s '), 3723);
    });
  });

  describe('parseYouTubeDuration（YouTube 的 `contentDetails.duration`，ISO 8601）', () => {
    it('★ 清单给的四条（含 `P1DT2H` = 93600 —— **一天是允许的**）', () => {
      assert.equal(parseYouTubeDuration('PT1H2M3S'), 3723);
      assert.equal(parseYouTubeDuration('PT2M'), 120);
      assert.equal(parseYouTubeDuration('PT45S'), 45);
      assert.equal(parseYouTubeDuration('P1DT2H'), 93600);
    });

    it('+ 天/时/分/秒可以任意组合，但至少要有一段', () => {
      assert.equal(parseYouTubeDuration('P1D'), 86400, '没有 T 段是合法的 ISO（`P1D` 就是一天）');
      assert.equal(parseYouTubeDuration('PT1H'), 3600);
      assert.equal(parseYouTubeDuration('PT1M'), 60, 'T 段里的 M 才是分钟');
      assert.equal(parseYouTubeDuration('P1DT2H3M4S'), 93_784, '四段齐全');
      assert.equal(parseYouTubeDuration('P2DT30M'), 174_600, '天 + 分（跳过时与秒）');
    });

    it('+ ⚠️ 同上：ISO 也没有"59 分钟"这条规则 —— `PT99M` = 5940', () => {
      // 与 bilibili 的 `99:00` 同一条裁决（`tracking/parse.ts` 文件头）：被 0–59 约束的
      // 只有"冒号**后面**的段"，而这个形状里没有冒号。分钟数的上界是"1–4 位数字"
      // （`'P99999D'` 在下面那条非法输入里被拒），不是 59。
      assert.equal(parseYouTubeDuration('PT99M'), 5940, '99 分钟是合法的 ISO 时长');
    });

    it('+ ⚠️ `P1M` 是**月**，一律拒绝；`PT1M` 才是一分钟', () => {
      // 这一对是三个解析器里最容易写错的地方：`P1M` 读起来"显然"是一分钟，
      // 而 ISO 8601 里 T **之前**的 M 是月、Y 是年 —— 它们没有固定秒数，
      // 所以不许折算（折算出来的数看起来完全正常，见 parse.ts 文件头）。
      assert.equal(parseYouTubeDuration('P1M'), null);
      assert.equal(parseYouTubeDuration('P1Y'), null);
      assert.equal(parseYouTubeDuration('P1W'), null);
      assert.equal(parseYouTubeDuration('P1MT1M'), null);
      assert.equal(parseYouTubeDuration('PT1M'), 60);
    });

    it('+ 写在 T 段外面的时/分/秒要拒（`P1D2H`、空 T 段）', () => {
      assert.equal(parseYouTubeDuration('P1D2H'), null);
      assert.equal(parseYouTubeDuration('P1DT'), null, 'T 后面空着不是合法时长');
      assert.equal(parseYouTubeDuration('P'), null);
      assert.equal(parseYouTubeDuration('PT'), null);
    });

    it('+ 非法输入一律 null —— 不是 0，也不是 NaN', () => {
      for (const bad of [
        'nope',
        '1H2M3S',
        'pt1h2m3s',
        'P1.5D',
        'PT1.5S',
        'PT-1S',
        'PT1H2M3S5',
        'P99999D',
        'P1DT2H3M4S5',
      ]) {
        assert.equal(parseYouTubeDuration(bad), null, `${JSON.stringify(bad)} 应当被拒`);
      }
    });

    it('+ ⚠️ 总和为 0 ⇒ null：`PT0S` / `P0D` 正是 YouTube 的"拿不到时长"写法', () => {
      // 已下架 / 待首播 / 部分直播条目都会走到这里。回 0 的话它们会带着一个
      // 看起来完全正常的 `short` 入库，而且没有任何东西会报错 ——
      // 裁决与理由全文在 `tracking/parse.ts` 文件头。
      assert.equal(parseYouTubeDuration('PT0S'), null);
      assert.equal(parseYouTubeDuration('P0D'), null);
    });

    it('+ null / undefined / 空串 / 纯空白 ⇒ null', () => {
      assert.equal(parseYouTubeDuration(null), null);
      assert.equal(parseYouTubeDuration(undefined), null);
      assert.equal(parseYouTubeDuration(''), null, '⚠️ 同上：`P` 后面全可选时会匹配空串');
      assert.equal(parseYouTubeDuration('   '), null);
    });

    it('+ 前后空白会被 trim 掉', () => {
      assert.equal(parseYouTubeDuration(' PT1H2M3S '), 3723);
    });
  });

  describe('标签推导 deriveTags（spec §4.3）', () => {
    it('★ `durationSec` 为 null ⇒ 一个时长标签都不打（打一个猜的标签比不打更坏）', () => {
      assert.deepEqual(deriveTags({ durationSec: null, isLiveReplay: false }), []);
      assert.deepEqual(
        deriveTags({ durationSec: null, isLiveReplay: true }),
        ['liveReplay'],
        'liveReplay 与时长无关，null 只掐掉时长那一档',
      );
    });

    it('★ short / long，以及 liveReplay 在前', () => {
      assert.deepEqual(deriveTags({ durationSec: 30, isLiveReplay: false }), ['short']);
      assert.deepEqual(deriveTags({ durationSec: 30, isLiveReplay: true }), [
        'liveReplay',
        'short',
      ]);
      assert.deepEqual(deriveTags({ durationSec: 1500, isLiveReplay: false }), ['long']);
    });

    it('★ 中间档（300 秒）**不打标签** —— v1 的标签词表只有那三个', () => {
      assert.deepEqual(deriveTags({ durationSec: 300, isLiveReplay: false }), []);
    });

    it('+ 两个边界各差一格：60/61 与 1199/1200', () => {
      assert.deepEqual(
        deriveTags({ durationSec: 60, isLiveReplay: false }),
        ['short'],
        '≤60 含 60',
      );
      assert.deepEqual(deriveTags({ durationSec: 61, isLiveReplay: false }), []);
      assert.deepEqual(deriveTags({ durationSec: 1199, isLiveReplay: false }), []);
      assert.deepEqual(
        deriveTags({ durationSec: 1200, isLiveReplay: false }),
        ['long'],
        '≥1200 含 1200',
      );
    });

    it('+ 0 秒仍是 short —— spec §4.3 的判据逐字是 `<= 60`（解析器已不再产出 0）', () => {
      // ⚠️ 三个解析器现在把"总和为 0"折成 `null`（见 `tracking/parse.ts` 文件头），
      //    所以 0 走不到这条路上 —— 它只可能是有人绕开解析器直接写进 `duration_sec`。
      //    判据本身**不**动：spec §4.3 写的就是 `duration_sec <= 60`，
      //    在这一层重写它等于把同一条规则放进两个地方。
      assert.deepEqual(deriveTags({ durationSec: 0, isLiveReplay: false }), ['short']);
    });

    it('+ 顺序固定：`liveReplay` 恒在时长标签之前（库里的 JSON 文本要可比）', () => {
      assert.deepEqual(deriveTags({ durationSec: 1500, isLiveReplay: true }), [
        'liveReplay',
        'long',
      ]);
      assert.deepEqual(deriveTags({ durationSec: 5000, isLiveReplay: true }), [
        'liveReplay',
        'long',
      ]);
    });

    it('+ 每次返回的是新数组（调用方会把它当自己的东西用，别共享一个字面量）', () => {
      const first = deriveTags({ durationSec: 30, isLiveReplay: false });
      first.push('被调用方改过的东西');
      assert.deepEqual(
        deriveTags({ durationSec: 30, isLiveReplay: false }),
        ['short'],
        '上一个调用方改自己的数组，不许影响下一次推导',
      );
    });

    it('+ ⚠️ 负数按 spec §4.3 的判据**字面**处理 ⇒ `short`（刻意的观察值，不是我们想要的形状）', () => {
      // 判据逐字是 `duration_sec <= 60`，而 `-1 <= 60` 为真 ⇒ `short`。
      // 三个解析器只产出**正整数**或 `null`（总和为 0 也折成 `null`，见 parse.ts 文件头），
      // 所以 `-1` 走不到这条路上 —— 它只可能是有人绕开解析器直接写库。
      // ⚠️ 这里**不**加"负数 ⇒ 不打标签"那条守卫：那等于在这一层替 spec 重写判据，
      //    而该拦它的地方是写库那条路（数据层看得见 0 与负数，标签这层看不见）。
      //    代价：真出现负数时，它会拿到一个**看起来正常**的 `short`。
      //    （这条断言的作用就是把那个代价钉在明面上，而不是让它藏在代码里。）
      assert.deepEqual(deriveTags({ durationSec: -1, isLiveReplay: false }), ['short']);
    });
  });
});
