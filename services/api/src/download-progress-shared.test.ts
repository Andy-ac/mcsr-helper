/**
 * 下载进度的纯逻辑（子项目 C）：节流、滚动窗口的速度与 ETA、人话格式化。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 为什么这些必须住在共享内核里、而且必须有单测
 * ---------------------------------------------------------------------------
 *   · `apps/desktop` **没有测试运行器**（只有 typecheck）⇒ 判据住在这里才有断言；
 *   · 节流与速度这两件事**坏了都不报错**：节流写错 ⇒ 界面一顿一顿（或 IPC 被灌满）、
 *     速度写错 ⇒ 显示一个永远在跳的数。两种都"看起来在工作"。
 *
 * ★ 刀（读数写进报告）：
 *   · 把 `shouldPush` 的 `||` 改成 `&&` ⇒ "64 KB 到了但不足 100 ms"那一条红；
 *   · 把 `PROGRESS_RATE_MIN_ELAPSED_MS` 当成"没有下限" ⇒ "两个样本挨得太近 ⇒ 速度给 —"那一条红；
 *   · 把 `formatBytes(null)` 的 `—` 改成 `'0 B'` ⇒ 那一条红（"样本不足"与"真的是 0"必须分得开）。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type DownloadProgress,
  formatBytes,
  formatEta,
  formatPercent,
  formatRate,
  PROGRESS_MIN_BYTES,
  PROGRESS_MIN_INTERVAL_MS,
  progressKeyOf,
  progressLineOf,
  rateOf,
  shouldPush,
  withSample,
} from '@mcsr/shared/downloadProgress';

describe('★ 进度节流（D3：≥100 ms **或** ≥64 KB，终帧必推）', () => {
  it('★ 64 KB 到了但不足 100 ms ⇒ 推（"两次都快"那一支）', () => {
    assert.equal(
      shouldPush({
        last: { at: 1000, received: 0, total: 1_000_000 },
        next: { at: 1010, received: PROGRESS_MIN_BYTES, total: 1_000_000 },
      }),
      true,
    );
  });

  it('★ 100 ms 到了但字节没涨 ⇒ 推（"卡住了也要让用户看到它还活着"那一支）', () => {
    assert.equal(
      shouldPush({
        last: { at: 1000, received: 50_000, total: 1_000_000 },
        next: { at: 1000 + PROGRESS_MIN_INTERVAL_MS, received: 50_000, total: 1_000_000 },
      }),
      true,
    );
  });

  it('★★ 两条都不满足 ⇒ 不推（这才是"节流"本身：一个 27 MB 的 jar 有几千个 chunk）', () => {
    assert.equal(
      shouldPush({
        last: { at: 1000, received: 0, total: 1_000_000 },
        next: { at: 1049, received: PROGRESS_MIN_BYTES - 1, total: 1_000_000 },
      }),
      false,
    );
  });

  it('★ 第一次（还没有上一帧）⇒ 推；`force` ⇒ 无条件推（终帧）', () => {
    assert.equal(shouldPush({ last: null, next: { at: 0, received: 0, total: 10 } }), true);
    assert.equal(
      shouldPush({
        last: { at: 1000, received: 0, total: 10 },
        next: { at: 1001, received: 1, total: 10 },
        force: true,
      }),
      true,
    );
  });
});

describe('★ 速度与 ETA（D2：最近 3 秒的滚动窗口；样本不足给 —，不猜）', () => {
  it('★ 窗口内两个样本 ⇒ 速度 = 字节增量 / 时间差；ETA = 剩余 / 速度', () => {
    const rate = rateOf({
      samples: [
        { at: 0, received: 0, total: 10_000_000 },
        { at: 1000, received: 1_000_000, total: 10_000_000 },
      ],
      now: 1000,
      total: 10_000_000,
    });
    assert.equal(rate.bytesPerSecond, 1_000_000);
    // 还剩 9 MB，1 MB/s ⇒ 9000 ms
    assert.equal(rate.etaMs, 9000);
  });

  it('★★ 两个样本挨得太近（< 200 ms）⇒ 速度与 ETA 都给 `null`（界面显示 —）', () => {
    const rate = rateOf({
      samples: [
        { at: 1000, received: 0, total: 10_000_000 },
        { at: 1010, received: 100_000, total: 10_000_000 },
      ],
      now: 1010,
      total: 10_000_000,
    });
    assert.equal(rate.bytesPerSecond, null);
    assert.equal(rate.etaMs, null);
  });

  it('★ 只有滑动窗口里那一截算数（久远的样本不进分母）', () => {
    const rate = rateOf({
      samples: [
        { at: 0, received: 0, total: 10_000_000 }, // 窗口外（now=4000，窗口 3000）
        { at: 3000, received: 5_000_000, total: 10_000_000 },
        { at: 4000, received: 6_000_000, total: 10_000_000 },
      ],
      now: 4000,
      total: 10_000_000,
    });
    // 只用后两个：1 MB / 1 s
    assert.equal(rate.bytesPerSecond, 1_000_000);
  });

  it('★ 卡住了（窗口内字节没涨）⇒ 速度 0、ETA 仍是 `null`（不给 ∞）', () => {
    const rate = rateOf({
      samples: [
        { at: 1000, received: 500_000, total: 10_000_000 },
        { at: 3000, received: 500_000, total: 10_000_000 },
      ],
      now: 3000,
      total: 10_000_000,
    });
    assert.equal(rate.bytesPerSecond, 0);
    assert.equal(rate.etaMs, null);
  });

  it('★ 已经下完 ⇒ ETA 是 0（不是 `null`：那是"算不出来"，与"不用等了"是两件事）', () => {
    const rate = rateOf({
      samples: [
        { at: 0, received: 9_000_000, total: 10_000_000 },
        { at: 1000, received: 10_000_000, total: 10_000_000 },
      ],
      now: 1000,
      total: 10_000_000,
    });
    assert.equal(rate.etaMs, 0);
  });

  it('★★ 总长未知（`total = 0`）⇒ ETA 是 `null`，**不是** 0（T1 评审 Important 1 补的判据）', () => {
    const rate = rateOf({
      samples: [
        { at: 0, received: 0, total: 0 },
        { at: 1000, received: 1_000_000, total: 0 },
      ],
      now: 1000,
      total: 0,
    });
    assert.equal(rate.bytesPerSecond, 1_000_000, '速度不需要总长 ⇒ 照常算出来');
    assert.equal(rate.etaMs, null, '总长未知与"已经下完"是两件事：前者 `—`、后者 `0s`');
    assert.notEqual(rate.etaMs, 0);
  });
});

describe('★ 人话格式化（"样本不足"与"真的是 0"必须分得开）', () => {
  it('★ `null` / 非有限 ⇒ `—`，**不是** `0 B`', () => {
    assert.equal(formatBytes(null), '—');
    assert.equal(formatRate(null), '—');
    assert.equal(formatEta(null), '—');
    assert.equal(formatBytes(Number.POSITIVE_INFINITY), '—');
    assert.equal(formatRate(Number.NaN), '—');
    assert.equal(formatEta(Number.POSITIVE_INFINITY), '—');
    assert.notEqual(formatBytes(null), formatBytes(0));
  });

  it('★ 字节/速度/ETA 的三种量级', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(1024), '1.0 KB');
    assert.equal(formatBytes(27_100_000), '25.8 MB');
    assert.equal(formatBytes(2_147_483_648), '2.00 GB');
    assert.equal(formatRate(3_100_000), '3.0 MB/s');
    assert.equal(formatEta(5000), '5s');
    assert.equal(formatEta(65_000), '1m05s');
  });

  it('★ 百分比：总长为 0 或未知时给 `—`（不是 `Infinity%`、也不是 `0%`）', () => {
    assert.equal(formatPercent(5, 10), '50%');
    assert.equal(formatPercent(5, 0), '—');
    assert.equal(formatPercent(0, 10), '0%');
    // 边界：读数偶尔会越过总长（content-length 与真实 body 不一致）⇒ 夹到 100%
    assert.equal(formatPercent(11, 10), '100%');
  });
});

describe('★ 页面侧的样本窗口与视图模型（D6：切 tab 回来还要看得见）', () => {
  it('★★ 窗口只留最近 3 秒里的样本（不然速度会被几分钟前的读数拖着）', () => {
    const kept = withSample(
      [
        { at: 0, received: 0, total: 100 },
        { at: 9000, received: 50, total: 100 },
      ],
      { at: 10_000, received: 60, total: 100 },
    );
    assert.deepEqual(
      kept.map((sample) => sample.at),
      [9000, 10_000],
      '第 0 ms 那个样本落出了 PROGRESS_RATE_WINDOW_MS（3000）的窗口',
    );
  });

  it('★ 换项 ⇒ 键变了（样本窗口要重开，不能把上一项的字节混进来）', () => {
    const frame = (over: Partial<DownloadProgress>): DownloadProgress => ({
      run: 'update-folder-all',
      phase: 'download',
      folderId: 'f1',
      modid: 'sodium',
      fileName: 'a.jar',
      received: 0,
      total: 100,
      itemIndex: 1,
      itemCount: 2,
      runStartedAt: 0,
      cancelling: false,
      ...over,
    });
    assert.equal(
      progressKeyOf(frame({})),
      progressKeyOf(frame({ received: 50 })),
      '同一项 ⇒ 同一个键',
    );
    assert.notEqual(
      progressKeyOf(frame({})),
      progressKeyOf(frame({ itemIndex: 2 })),
      '换项 ⇒ 键必须变',
    );
    assert.notEqual(
      progressKeyOf(frame({})),
      progressKeyOf(frame({ modid: 'lithium' })),
      '换 mod ⇒ 键必须变',
    );
  });

  it('★★ 视图模型：样本够 ⇒ 三个数都算出来；样本不足 ⇒ 速度与 ETA 都是 `—`（百分比来自帧本身）', () => {
    const progress: DownloadProgress = {
      run: 'update-mod',
      phase: 'download',
      folderId: 'f1',
      modid: 'sodium',
      fileName: 'sodium-2.5.1+1.16.1.jar',
      received: 12_400_000,
      total: 27_100_000,
      itemIndex: 1,
      itemCount: 1,
      runStartedAt: 0,
      cancelling: false,
    };
    const enough = progressLineOf({
      progress,
      samples: [
        { at: 9000, received: 11_400_000, total: 27_100_000 },
        { at: 10_000, received: 12_400_000, total: 27_100_000 },
      ],
      now: 10_000,
    });
    assert.equal(enough.received, '11.8 MB');
    assert.equal(enough.total, '25.8 MB');
    assert.equal(enough.percent, '46%');
    // 1 MB / 1 s = 1_000_000 B/s；1024 进制 ⇒ 976.6 KB/s（不是 977.0 —— 期望值现算过一次）
    assert.equal(enough.rate, '976.6 KB/s');
    // 剩 14.7 MB / 1 MB per s = 14.7 s ⇒ 四舍五入 15s
    assert.equal(enough.eta, '15s');
    assert.equal(enough.installing, false);

    const none = progressLineOf({ progress, samples: [], now: 10_000 });
    assert.equal(none.percent, '46%', '百分比来自帧本身（不需要样本）');
    assert.equal(none.rate, '—');
    assert.equal(none.eta, '—');
  });

  it('★★ 总长未知（`total <= 0`）⇒ `total` 与 `percent` 同口径给 `—`（T1 评审的欠账，T5 收拾）', () => {
    /*
     * ⚠️★ 修之前 `total` 那一格印的是 `formatBytes(0)` = `'0 B'`，而同一帧的 `percent`
     *    已经是 `—` ⇒ 一个号称"算不出来"的帧同时给出两句互相矛盾的话（`rateOf` 那段
     *    注释里"与 `formatPercent` 同一口径"这条纪律当时漏了这一格）。
     */
    const view = progressLineOf({
      progress: {
        run: 'update-mod',
        phase: 'download',
        folderId: 'f1',
        modid: 'sodium',
        fileName: 'sodium.jar',
        received: 3_000_000,
        total: 0,
        itemIndex: 1,
        itemCount: 1,
        runStartedAt: 0,
        cancelling: false,
      },
      samples: [],
      now: 10_000,
    });
    assert.equal(view.total, '—', '总长未知 ⇒ 这一格与 `percent` 同口径（不是 `0 B`）');
    assert.equal(view.received, '2.9 MB', '已下多少**照常**（它不需要总长）');
    assert.equal(view.percent, '—', '总长未知 ⇒ 百分比也是 `—`（两条一起才说明它们同口径）');
  });

  it('★★ 写盘相位：视图模型**没有**字节也没有 ETA（界面才不会照旧印它们）', () => {
    const view = progressLineOf({
      progress: {
        run: 'update-mod',
        phase: 'install',
        folderId: 'f1',
        modid: 'sodium',
        fileName: 'a.jar',
        received: 27_100_000,
        total: 27_100_000,
        itemIndex: 1,
        itemCount: 1,
        runStartedAt: 0,
        cancelling: false,
      },
      samples: [],
      now: 10_000,
    });
    assert.equal(view.installing, true);
    assert.equal(view.received, '—');
    assert.equal(view.total, '—');
    assert.equal(view.rate, '—');
    assert.equal(view.eta, '—');
  });
});
