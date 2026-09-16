/**
 * `packages/shared/src/tracking.ts` 的**时间单位契约**：`toMillis()`。
 *
 * ===========================================================================
 * ⚠️ 这个文件住在 `services/api` 下，是因为本仓的测试运行器只在这个工作区里
 *    （`packages/shared` 只有 typecheck）—— 与 `live-shares-schema.test.ts`、
 *    `tracking-schema.test.ts` 同一个理由：**共享模块的行为一律在这里被钉住**。
 * ===========================================================================
 *
 * ===========================================================================
 * ★★ 为什么这个函数值得单独一个文件
 * ===========================================================================
 * spec §4 的 ★★ 块（2026-09-16）裁决：`tracked_creators` / `tracked_videos`
 * **整张表一律 Unix 秒**；而本仓其它表和浏览器那一套（`new Date(ms)`）是**毫秒**。
 * ⇒ 这两张表的值一旦不经 `toMillis()` 就渲染，界面会显示 **1970 年** ——
 *   而类型上讲，`number` 进 `new Date()` 完全合法，**编译器一个字都不会说**。
 *   那是"看起来绿的功能其实不动"里最典型的一种，所以这条契约要有测试，
 *   而且两头都要钉：`null` 那一侧（本仓纪律：没有值就是 null，不是 0）与
 *   `0` 那一侧（0 是一个**合法时刻**，不能被当成"没有值"吃掉）。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { toMillis } = await import('@mcsr/shared');

/** 与 `tracking-schema.test.ts` / `tracking-store.test.ts` 共用的那个"现在"（**秒**）。 */
const NOW = 1_788_600_000;

/*
 * ⚠️ `toMillis` 的返回类型是 `number | null`（那正是 null 那条契约在类型上的样子），
 *    所以每个用例先把它收窄一次再往下用。`assert.ok(x !== null)` 是**断言签名**
 *    （node 的 `ok` 声明是 `asserts value`）⇒ 类型跟着收窄，不用 `as number`
 *    那种把检查绕过去的写法（绕过去就等于这一层没有类型可言）。
 */
function millis(sec: number | null | undefined): number {
  const ms = toMillis(sec);
  assert.ok(ms !== null, `${String(sec)} 是一个有值的秒数，换算不该返回 null`);
  return ms;
}

describe('toMillis：本栏目唯一的"秒 → 毫秒"换算点', () => {
  it('秒 × 1000 ⇒ 毫秒，而且换算出来的真的不是 1970', () => {
    assert.equal(toMillis(NOW), 1_788_600_000_000);
    /*
     * ★ 断言的**理由**，不只是数的形状：不经这个函数渲染会显示 1970。
     *   所以这里把"正确"与"错误"并排钉死 —— 少乘 1000 的那一版（也就是这条契约
     *   存在的全部原因）会落在 1970 年，一眼看得出来是错的。
     */
    assert.equal(new Date(millis(NOW)).toISOString(), '2026-09-05T09:20:00.000Z');
    assert.equal(
      new Date(NOW).getUTCFullYear(),
      1970,
      '裸的秒值喂给 new Date ⇒ 1970 年（这就是 toMillis 必须存在的原因）',
    );
  });

  it('null 与 undefined 一律返回 null（不是 0、也不是 NaN）', () => {
    assert.equal(toMillis(null), null);
    assert.equal(toMillis(undefined), null);
    // 反面控制：要是写成 `sec || 0`，上面两条会变成 0 —— 0 毫秒 = 1970-01-01，
    // 在界面上看起来像一条真实数据（本仓纪律：拿不到就是 null，不许退化成 0）。
    assert.notEqual(toMillis(null), 0);
    assert.notEqual(toMillis(undefined), 0);
    assert.ok(!Number.isNaN(toMillis(null)), 'NaN 渲染出来是 "Invalid Date"，同样是一条假数据');
  });

  it('★ 0 秒**要**换算成 0，不能被当成"没有值"吃掉（两个方向都不许错）', () => {
    /*
     * 反面同样是一条真缺陷：`sec || null` 这种写法会把 0 变成 null ——
     * 而 0 是一个合法的 Unix 时刻（1970-01-01T00:00:00Z）。
     * `TrackedVideo.publishedAt` 那句注释说的"0 只在真的量到 0 时才是数据"，
     * 在这里就是这一条：判断'有没有值'只能看 `== null`，不能看真假。
     */
    assert.equal(toMillis(0), 0);
    assert.equal(new Date(millis(0)).toISOString(), '1970-01-01T00:00:00.000Z');
  });

  it('负数与小数原样 × 1000（不做取整、不做钳制 —— 换算就是换算）', () => {
    // 负数：1970 年之前的时刻（上游理论上给得出来，bilibili 的 created 是秒）。
    assert.equal(toMillis(-1), -1000);
    // 小数：本栏目所有时间列都是 INTEGER（迁移 020），所以这一条只是说明
    // 这个函数**不**替调用方兜底 —— 真出现小数那是上游/库的 bug，不该被这里抹平。
    assert.equal(toMillis(1.5), 1500);
  });

  it('★ `INCREMENTAL_INTERVAL_SEC = 3600` 与它是同一个单位（一处用错的判据）', () => {
    /*
     * 这一条把"两张表的秒"与数据层那个一小时的口径**钉在一起**：
     * `pickDueCreators` 拿 `now - 3600` 与 `last_synced_at` 比，两个都是秒。
     * 若哪天有人把 `last_synced_at` 改成毫秒，`toMillis` 出来的值会变成
     * 1.7e15 那种数（下面第二条断言正是那个形状）—— 界面上仍"能显示"，
     * 只是显示成几万年之后。⇒ 把两边同时钉在 1000 倍的关系上。
     */
    const oneHourLater = NOW + 3600;
    assert.equal(millis(oneHourLater) - millis(NOW), 3600 * 1000, '一小时 = 3600000 毫秒');
    assert.ok(millis(NOW) < 1e13, '秒换算出来的毫秒是 1e12 量级；1e15 量级说明上游那侧已经是毫秒');
  });
});
