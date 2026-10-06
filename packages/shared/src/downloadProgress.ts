/**
 * 下载进度的**纯逻辑**（三边共用：Electron 主进程 / preload / 网页）。
 *
 * ⚠️ 这里**不碰时钟、不碰 I/O、不发网络**：样本由调用方盖时间戳给进来
 *    （主进程那一条路用 `Date.now()`），所以这些函数是可以写死期望值的纯函数。
 *
 * ⚠️★ 为什么"算不出来"必须是 `null` 而不是 0：
 *    0 与"还没有样本"在界面上是两句完全不同的话（"0 MB/s"看着像卡住了，
 *    `—` 看着像"还没量出来"）。把它们折成同一个值，用户就会以为下载卡了。
 */

/** 主进程推给页面的进度帧（spec §3）。 */
export interface DownloadProgress {
  /** 这一趟是谁发起的 */
  run: 'update-mod' | 'update-folder-all' | 'download-missing' | 'download-pack';
  /** 下载阶段有字节；写盘阶段没有 */
  phase: 'download' | 'install';
  folderId: string;
  modid: string;
  fileName: string;
  /** 本项的字节（写盘阶段保持最后那一次读数） */
  received: number;
  total: number;
  /** 批量时的项序（1 起；单行下载时 itemIndex = itemCount = 1） */
  itemIndex: number;
  itemCount: number;
  /** 本趟开始时间（epoch ms），页面自己算已用时 */
  runStartedAt: number;
  /** 这一趟是否已被要求取消（页面据此把按钮变成"正在取消…"） */
  cancelling: boolean;
}

/** 下载器每收一个 chunk 给一次的读数（**没有时间**：时钟由上报方盖）。 */
export interface ByteSample {
  received: number;
  total: number;
}

/** 盖过时间戳的样本（节流与速度窗口都用它）。 */
export interface TimedSample extends ByteSample {
  at: number;
}

/** D3 的节流下限：距上次 ≥ 100 ms **或** 新增 ≥ 64 KB 才推一帧。 */
export const PROGRESS_MIN_INTERVAL_MS = 100;
export const PROGRESS_MIN_BYTES = 64 * 1024;

/** D2 的速度/ETA 滚动窗口，以及"样本够不够"的最短用时（首 200 ms 显示 `—`）。 */
export const PROGRESS_RATE_WINDOW_MS = 3000;
export const PROGRESS_RATE_MIN_ELAPSED_MS = 200;

/**
 * 这一帧该不该推（D3）。
 *
 * ⚠️ 是 `||` 不是 `&&`：两条下限各自成立就够 —— 大 jar 的前几秒可能一次就吃进 64 KB，
 *    而慢速连接上 100 ms 可能只涨几百字节。任缺一条都会让界面在某些网络下"像死了"。
 */
export function shouldPush(input: {
  last: TimedSample | null;
  next: TimedSample;
  force?: boolean;
}): boolean {
  if (input.force === true) return true;
  const { last, next } = input;
  if (last === null) return true;
  return (
    next.at - last.at >= PROGRESS_MIN_INTERVAL_MS ||
    next.received - last.received >= PROGRESS_MIN_BYTES
  );
}

/**
 * 速度与 ETA（D2 的滚动窗口）。
 *
 * 判据（每一条都对应一种"看起来在工作"的坏法）：
 *   · 窗口内少于两个样本，或首尾间隔 < `PROGRESS_RATE_MIN_ELAPSED_MS` ⇒ 都给 `null`；
 *   · 窗口内字节没涨 ⇒ 速度 **0**（这是真的读数）、ETA 给 `null`（剩余/0 没有意义）；
 *   · 已经下完 ⇒ ETA 是 **0**（"不用等了"与"算不出来"是两件事）。
 */
export function rateOf(input: { samples: readonly TimedSample[]; now: number; total: number }): {
  bytesPerSecond: number | null;
  etaMs: number | null;
} {
  const inWindow = input.samples.filter(
    (sample) => input.now - sample.at <= PROGRESS_RATE_WINDOW_MS,
  );
  const first = inWindow[0];
  const last = inWindow[inWindow.length - 1];
  if (first === undefined || last === undefined || inWindow.length < 2) {
    return { bytesPerSecond: null, etaMs: null };
  }
  const elapsed = last.at - first.at;
  if (elapsed < PROGRESS_RATE_MIN_ELAPSED_MS) return { bytesPerSecond: null, etaMs: null };
  const moved = last.received - first.received;
  if (moved <= 0) return { bytesPerSecond: 0, etaMs: null };
  const bytesPerSecond = (moved / elapsed) * 1000;
  /*
   * ⚠️★ T1 评审（Important 1）：**总长未知（`total = 0`）不是"已经下完"**。
   *    同一个模块里 `formatPercent` 把 `total = 0` 当"未知"（给 `—`），而这里若照
   *    `remaining <= 0 ? 0` 走，界面会同时印出 `total = '0 B'`、`percent = '—'` 与 `ETA = '0s'`
   *    —— 一个号称"算不出来"的帧却给了"不用等了"的读数（与 D2 的"不猜"直接冲突）。
   *    ⇒ 与 `formatPercent` 同一口径：总长未知 ⇒ ETA 给 `null`（速度不需要 `total`，保留）。
   */
  if (!(input.total > 0)) return { bytesPerSecond, etaMs: null };
  const remaining = input.total - last.received;
  return {
    bytesPerSecond,
    etaMs: remaining <= 0 ? 0 : Math.round((remaining / bytesPerSecond) * 1000),
  };
}

/** "算不出来"那一格（D2：首 200 ms 里速度与 ETA 都显示它，**不猜**）。 */
const DASH = '—';

export function formatBytes(n: number | null): string {
  if (n === null || !Number.isFinite(n) || n < 0) return DASH;
  if (n < 1024) return `${String(Math.round(n))} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatRate(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null || !Number.isFinite(bytesPerSecond) || bytesPerSecond < 0)
    return DASH;
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatEta(etaMs: number | null): string {
  if (etaMs === null || !Number.isFinite(etaMs) || etaMs < 0) return DASH;
  const seconds = Math.round(etaMs / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  return `${String(Math.floor(seconds / 60))}m${String(seconds % 60).padStart(2, '0')}s`;
}

/** 百分比。总长未知（0）⇒ `—`；超了夹到 100%（`content-length` 与真实 body 会不一致）。 */
export function formatPercent(received: number, total: number): string {
  if (!(total > 0)) return DASH;
  return `${String(Math.min(100, Math.round((received / total) * 100)))}%`;
}

/**
 * 记住一个新样本：**只留滚动窗口里的那些**。
 *
 * ⚠️ 用"最新样本的时间"当窗口右端（而不是调用方的时钟）：样本是**按时间推进**来的，
 *    它们的顺序天然就是时间序 ⇒ 少一个参数、少一处可以传错的钟。
 */
export function withSample(
  samples: readonly TimedSample[],
  next: TimedSample,
): readonly TimedSample[] {
  return [...samples, next].filter((sample) => next.at - sample.at <= PROGRESS_RATE_WINDOW_MS);
}

/**
 * 一个进度帧属于"哪一项"。**换项 ⇒ 键变** ⇒ 页面的样本窗口据此重开。
 *
 * ⚠️★ 为什么需要它：速度是"这一项"的速度。把上一项的字节留在窗口里，
 *    换项后的第一个速度会是**负数**（或一个荒唐的大数），而界面照旧把它印出来。
 *    `itemIndex` 在批量里换项时一定会变，`modid` 兜住"同一项被重下"那种情形。
 */
export function progressKeyOf(frame: DownloadProgress): string {
  return `${frame.folderId}|${frame.modid}|${String(frame.itemIndex)}`;
}

/** 进度行的**视图模型**：判断在这里，组件只排版（T5 的 `DownloadProgressLine` 消费它）。 */
export interface ProgressLineView {
  /** 正在下/正在写的那一个文件（用户要知道是哪一个）。 */
  fileName: string;
  /** 这两格已经是成句（`'11.8 MB'`）；写盘相位与"算不出来"都是 `—`。 */
  received: string;
  total: string;
  percent: string;
  rate: string;
  eta: string;
  /** 批量时的项序（单行时 `itemIndex === itemCount === 1`，界面据此决定要不要画那一行）。 */
  itemIndex: number;
  itemCount: number;
  /** 写盘相位（**没有字节** —— 那不是网络流量；取消按钮也要置灰）。 */
  installing: boolean;
  cancelling: boolean;
}

/**
 * 把一帧 + 样本窗口翻成"要印的那几个字符串"。
 *
 * ⚠️ 写盘相位**不印字节**（`installing` 那一支把三格都置成 `—`）：那一刻的"已下多少"
 *    已经不是进度了（下载早就完成），印一个不动的数字只会让人以为卡住了。
 */
export function progressLineOf(input: {
  progress: DownloadProgress;
  samples: readonly TimedSample[];
  now: number;
}): ProgressLineView {
  const { progress } = input;
  const installing = progress.phase === 'install';
  const rate = installing
    ? { bytesPerSecond: null, etaMs: null }
    : rateOf({ samples: input.samples, now: input.now, total: progress.total });
  return {
    fileName: progress.fileName,
    received: installing ? DASH : formatBytes(progress.received),
    /*
     * ⚠️★ T5（显示路径的拥有者收拾 T1 评审记下的那条账）：**总长未知**（`total <= 0`）时
     *    这一格与 `percent` **同口径**给 `DASH`。
     *
     * 修之前 `formatBytes(0)` 印的是 `'0 B'` ⇒ 同一个"算不出来"的帧会同时给出
     * `total = '0 B'` 与 `percent = '—'`（两句互相矛盾的话），而 `rateOf` 刚刚才为
     * 同一件事把 ETA 收成 `null`（那段注释里写着"与 `formatPercent` 同一口径"）——
     * `total` 那一格是这条口径上漏掉的一处。
     * ⚠️ `formatBytes` **不改**：它只是"把字节数印成人话"，`0` 在那里是**真的 0**；
     *    "总长未知"是**这一格**的判断（与 `formatPercent` / `rateOf` 的判断同一处口径）。
     */
    total: installing || !(progress.total > 0) ? DASH : formatBytes(progress.total),
    percent: installing ? DASH : formatPercent(progress.received, progress.total),
    rate: formatRate(rate.bytesPerSecond),
    eta: formatEta(rate.etaMs),
    itemIndex: progress.itemIndex,
    itemCount: progress.itemCount,
    installing,
    cancelling: progress.cancelling,
  };
}
