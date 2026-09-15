/*
 * ⚠️ 上游的 `Time` 一律是**毫秒**（`MatchInfo.time` / `weeklyRace.leaderboard[].time` /
 *    `liveMatches[].currentTime`），而 `Date` 一律是**秒**（赛季起止、心跳、周赛 endsAt）。
 *    单位搞混不会报错，只会显示成一个荒谬的数字（"0:04" 或 "4074:31"）——
 *    所以两个格式化函数都只收毫秒，秒转毫秒的那一步在调用点显式做。
 * ⚠️ 它们是纯函数并住在 shared，就是为了能被断言：`apps/web` 没有测试运行器。
 */

/** 补零。⚠️ 只用来补**固定宽度**的那几格（分/秒/毫秒），小时位不补（`1:01:01` 而不是 `01:01:01`）。 */
function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/**
 * `4:04.241` / `1:01:01.001`（周赛成绩、节点时间）。
 *
 * ⚠️ 取整方向是**向下**（`Math.floor`），而且输入先钳到 0：四舍五入会让 59_999 ms 印成
 *    `1:00` —— 一个**还没到**的时间。这类显示没有读者会去核对，只会让人觉得"表快了"。
 * ⚠️ 不足一小时**不带**小时位（`4:04.241` 而不是 `0:04:04.241`）：周赛成绩几乎都在四分钟内，
 *    一个恒为 0 的小时位只是白占一格宽度。
 */
export function formatRaceTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const millis = total % 1000;
  const secs = Math.floor(total / 1000) % 60;
  const mins = Math.floor(total / 60_000) % 60;
  const hours = Math.floor(total / 3_600_000);
  const head = hours > 0 ? `${String(hours)}:${pad(mins, 2)}` : String(mins);
  return `${head}:${pad(secs, 2)}.${pad(millis, 3)}`;
}

/**
 * `15:18` / `1:00:00`（对局已进行的时间、节点时间）。
 *
 * ⚠️ 先整除再取整（`Math.floor(ms / 1000)`），不是"先算秒再四舍五入"：把 918_454 ms 印成
 *    `15:18` 之后，毫秒部分的 454 只可能是"已经过去"的零头 —— 进位会在最后那一秒里
 *    印出一个还没到的时间（与 `formatRaceTime` 同一个理由）。
 * ⚠️ 这里**不**保留毫秒：对局进行的时间以秒为粒度就够了，而 `.000` 那三位在一张
 *    十行卡片上白白占宽度。
 */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const secs = total % 60;
  const mins = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours > 0
    ? `${String(hours)}:${pad(mins, 2)}:${pad(secs, 2)}`
    : `${String(mins)}:${pad(secs, 2)}`;
}
