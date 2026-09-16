/**
 * 适配器**注册表** —— CLI（T6）与路由（T5）从这里拿适配器，不直接 import 某个平台。
 *
 * ===========================================================================
 * ⚠️ 为什么这个文件在**本任务**就建（计划把它排在 T8，那是错的）
 * ===========================================================================
 * T6 的 CLI 第一行就要 `import { adapterFor, platformStatus } from './tracking'`，
 * 而 T6 在 T8 **之前**落地。注册表放到 T8，T6 那个 commit 就**编译不过**
 * （本仓 `-w check` 会红），也就是说 T6 会被迫在 CLI 里写一份临时注册表，
 * 而 T8 再把那份临时表删掉 —— 两次改动、两份真相。
 * ⇒ 本任务建它，并且把 YouTube / Twitch 的**占位**也定死在这里（见下）。
 *
 * ===========================================================================
 * ★ 今天只有 bilibili 是真适配器，另外两个是**占位**
 * ===========================================================================
 * `adapterFor('youtube' | 'twitch')` 今天**抛** `NoCredentialsError`，
 * `platformStatus()` 把它们报成 `'skipped:no-credentials'`（spec §9.1 ⑧：
 * "没有凭据时 YouTube/Twitch **被跳过而不是崩**，且运行输出里有一行说明"）。
 *
 * ⚠️ 这是**故意**的：生产上**一个 key 都没有**（spec §2.7 实测 `systemctl show`），
 *    所以今天去构造一个"能用的" YouTube 适配器是无从谈起的 —— 它连一次真实请求
 *    都发不出去。抛出来（而不是返回一个"用时空转"的假适配器）的收益是：
 *    "没凭据"**不可能**被表现成"抓取失败 40 次"，那是两块完全不同的日志。
 * ⇒ T8 只做一件事：把下面那两个 `case` 换成真适配器、把 `PLATFORM_STATUS` 里那两行
 *    的值改成按环境变量判断。**签名一个都不动**（`RunDeps` 的 `adapters` /
 *    `platformStatus` 已经是这个形状，见 T6）。
 *
 * ===========================================================================
 * ⚠️ 调用方的顺序：先 `platformStatus()`，再 `adapterFor()`
 * ===========================================================================
 * 标着 `'skipped:no-credentials'` 的平台**别去要适配器** —— 那条路会抛。
 * CLI 也可以选择"照拿不误 + 抓 `NoCredentialsError`"（两者等价，因为抛出来的正是那个
 * 专用类型），但先看状态更直白：它是**常量**，一次调用就知道三个平台各自能不能用，
 * 而 `adapterFor` 一次只回答一个。
 */
import type { TrackPlatform } from '@mcsr/shared';

import { bilibiliAdapter } from './bilibili';
import { NoCredentialsError, type PlatformAdapter } from './types';

/** 一个平台这一轮的状态。`'failed'` **不在这里** —— 那是运行结果，归 T6 的 `RunSummary`。 */
export type PlatformStatus = 'ok' | 'skipped:no-credentials';

/**
 * 三个平台各需要哪些环境变量（spec §10 冻结表的"凭据环境变量"那一行逐字）。
 *
 * ⚠️ bilibili 是空数组 —— **它不是"还没配"，是"不需要"**（spec §2.7：只有 bilibili
 *    不需要凭据，这正是它先跑通整条流水线的原因）。这两件事在日志里必须分开，
 *    所以没有凭据时我们不打印"缺少：（无）"，而是根本不会为 bilibili 走到那条路
 *    （`bilibiliAdapter` 是真的，不需要检查）。
 */
const REQUIRED_ENV: Record<TrackPlatform, readonly string[]> = {
  bilibili: [],
  youtube: ['MCSR_YOUTUBE_KEY'],
  twitch: ['MCSR_TWITCH_ID', 'MCSR_TWITCH_SECRET'],
};

/**
 * 三个平台的**静态**状态。
 *
 * ⚠️ 它是 `Record<TrackPlatform, …>`：以后往 `TRACK_PLATFORMS` 加第四个平台时，
 *    这里会**编译不过**（少一个键），而不是运行时静默返回 `undefined` 再被当成"能跑"。
 */
const PLATFORM_STATUS: Record<TrackPlatform, PlatformStatus> = {
  bilibili: 'ok',
  youtube: 'skipped:no-credentials',
  twitch: 'skipped:no-credentials',
};

/**
 * 拿一个平台的适配器。**没凭据的平台抛 `NoCredentialsError`**（不是返回 null）。
 *
 * ⚠️ 为什么抛而不是返回 `null`：返回 null 会让每个调用方各写一段
 *    `if (!adapter) …`，而漏写的那一处表现为**一个 TypeError**（"Cannot read properties of
 *    null"）—— 日志里那和"接口变了"分不开。抛一个专用类型则相反：CLI 按类型就能把
 *    整个平台报成 `'skipped:no-credentials'`（spec §9.1 ⑧ 要的就是这个）。
 */
export function adapterFor(platform: TrackPlatform): PlatformAdapter {
  switch (platform) {
    case 'bilibili':
      return bilibiliAdapter;
    case 'youtube':
    case 'twitch':
      // 占位：T8 把这两行换成真适配器（凭据在才返回，不在仍然抛这个类型）。
      throw new NoCredentialsError(platform, REQUIRED_ENV[platform]);
    default:
      /*
       * 类型上够不着（`TrackPlatform` 只有三个值），但数据库的 `CHECK (platform IN (...))`
       * 与这里的两份列表是**两处**，而它们的同步靠人。真出现第四个平台时，
       * 这里给一句能读的话，而不是 `undefined.platform`。
       */
      throw new Error(`未知平台：${String(platform)}（TRACK_PLATFORMS 改了但注册表没跟上？）`);
  }
}

/**
 * 三个平台这一轮各自能不能用（spec §6.3 的运行摘要里那一行）。
 *
 * ⚠️ 返回**副本**，不是 `PLATFORM_STATUS` 本身：那个常量是模块级的，被调用方改掉之后
 *    这个进程里**所有**后续调用都跟着变（包括另一个测试用例），而"状态被谁改的"
 *    在日志里查不出来。一次浅拷贝换掉这类问题。
 */
export function platformStatus(): Record<TrackPlatform, PlatformStatus> {
  return { ...PLATFORM_STATUS };
}
