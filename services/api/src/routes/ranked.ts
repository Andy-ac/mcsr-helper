/**
 * Ranked 实时信息 —— **唯一**一个走我们服务器的端点：服务心跳。
 *
 * ===========================================================================
 * 为什么只有它（spec §2.5 / §3）
 * ===========================================================================
 * 另外三个面板（实时高分对局 / Elo 排行榜 / 周赛榜单）与"在线人数"由**访客浏览器
 * 直连上游**，走的是访客自己的 IP —— 这是用户 2026-09-16 的裁决，也让服务器那条
 * 500 次 / 10 分钟的额度只被这里用掉一点点。
 * 而心跳那个主机（`status.mcsrranked.com`）**不发 CORS 头**（spec §2.5 实测）
 * ⇒ 浏览器读不到它，只能由我们取。所以这一处是"架构上被迫"的例外，不是设计偏好。
 *
 * ===========================================================================
 * 三件事都在这个文件里，它们是一起的
 * ===========================================================================
 *   · 缓存 30 秒（TTL）+ single-flight：心跳上游一分钟才出一条，而我们的访客
 *     15 秒刷一次、还会同时开着好几个标签页 —— 不合成的话上游额度会被我们自己人打满；
 *   · 兜底：上游失败时回上一次的成功结果（`stale: true`），最多留 10 分钟。
 *     ⚠️ 超过 10 分钟就**不再兜底**：十分钟前的心跳不是"实时"，而界面上那句
 *     "旧数据"也救不了它 —— 一条十分钟前的状态配一句"正在打的对局"是最坏的错
 *     （数据是真的、时间是假的）；
 *   · 每 IP 60 次 / 分钟：15 秒一刷的正常用户是 4 次/分钟，60 次是它 15 倍的余量。
 *     ⚠️ 这一处**不做**全局预算表：它每分钟最多 2 次真实上游调用，
 *     再加一层预算是多一份状态而没有多一分保护（本仓对"没人走的分支"有记录）。
 */
import type { RankedMonitor, RankedStatusResponse } from '@mcsr/shared/ranked';
import { Hono } from 'hono';
import type { AuthVariables } from '../auth/middleware';
import { clientIp, hit, keyFor } from '../auth/ratelimit';
import { fetchHeartbeat, type HeartbeatResult } from '../ranked/heartbeat';

/**
 * 缓存时长（毫秒）。可用 `MCSR_RANKED_STATUS_TTL_MS` 覆盖，默认 30 秒（spec §5.3）。
 *
 * ⚠️ 留这个环境变量是**测试的接缝**，与 `MCSR_SEED_API_BASE` 是同一种东西：
 *    "过了 TTL 会重新打上游"这一条不能靠 `await sleep(30_000)` 来验（那会把一条
 *    单元测试变成 30 秒），而 `0` 与"时间推过 30 秒"在下面走的是**同一支**判断。
 */
function ttlMs(): number {
  /*
   * ⚠️⚠️ 不能写成 `Number(process.env.MCSR_RANKED_STATUS_TTL_MS ?? '')`：
   *    `Number('')` 是 **0**（有限、而且 >= 0）⇒ 变量**没设**时会得到 TTL = 0，
   *    也就是"缓存从不生效"：每个请求都去打一次上游，15 秒一刷 × 每个访客
   *    每分钟 4 次 ⇒ 服务器那台 IP 的额度（500 次 / 10 分钟）会被自己人打满，
   *    而画面上**完全看不出来**（数据照常刷出来，只是上游在悄悄限我们的流）。
   *    实测过：写成那种形式时 ranked.test.ts 的"TTL 内不重打"那条桩计数是 2 而不是 1。
   * ⚠️ 于是"没设 / 空串"必须是**先判断**的一件事，而不是 `Number()` 的产物；
   *    而显式的 `0` 仍然要生效（测试用就是靠它，见 MCSR_SEED_API_BASE 那条先例）。
   */
  const raw = process.env.MCSR_RANKED_STATUS_TTL_MS;
  if (raw === undefined || raw.trim() === '') return 30_000;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : 30_000;
}

/** 兜底窗口：旧数据最多留十分钟（spec §5.3）。 */
const STALE_MAX_MS = 10 * 60_000;

/** 每 IP 的配额（spec §13 冻结：60 次 / 分钟）。 */
export const RANKED_STATUS_LIMIT = { limit: 60, windowMs: 60_000 };

interface Entry {
  monitor: RankedMonitor;
  /** 这份心跳**取到**的时刻（不是上游 `checkedAt`，那是一串没有时区的文本）。 */
  fetchedAt: number;
}

/*
 * ⚠️ 缓存只有一个条目，没有按上游 URL 做键的 Map。
 *    这一栏的心跳只有一个上游地址，而"缓存"在这里的回答就是"我们现在手上那份心跳"——
 *    单条目与 Map 的行为完全一样。否决了照 routes/seeds.ts 那样写 Map：
 *    那会多一份**永远只有一个键**的状态，而它唯一的用处是"将来加端点时不用改结构"；
 *    真到那一天，加的是**另一个上游**（另一个文件、另一套形状），不是这个文件的第二把键。
 */
let cached: Entry | null = null;

/** 在飞的那一次上游调用（single-flight 就靠它）。 */
let inflight: Promise<HeartbeatResult> | null = null;

/**
 * ⚠️ **仅供测试**：清掉缓存与在飞的那一次。
 *
 * 为什么必须有它：这两份状态是**模块级**的，会跨用例存活 —— 不清的话
 * "TTL 内不重打上游"那类用例会被上一个用例留下的缓存蒙对（同 routes/seeds.ts
 * 的 `clearSeedsCache`，那是本仓为同一个问题开过的先例）。
 */
export function resetRankedStatusCache(): void {
  cached = null;
  inflight = null;
}

/**
 * 取一次心跳，**同一时刻只打一次上游**。
 *
 * ⚠️ `inflight` 只可能在**它自己结算的那一刻**被清掉（下面那个 `finally`）——
 *    在它挂着的期间，后来的请求都拿到同一个 promise。所以"两个请求各打一次"
 *    在单进程里不会发生（这也是这一处不需要锁的原因）。
 */
function load(): Promise<HeartbeatResult> {
  if (inflight) return inflight;
  inflight = fetchHeartbeat().finally(() => {
    inflight = null;
  });
  return inflight;
}

export const rankedRoute = new Hono<{ Variables: AuthVariables }>();

rankedRoute.get('/status', async (c) => {
  // ★ 时间只在这里取一次：缓存判断与回给访客的 `serverNow` 用的是**同一个**时刻
  const now = Date.now();

  const limited = hit(
    keyFor('ranked-status', clientIp(c)),
    RANKED_STATUS_LIMIT.limit,
    RANKED_STATUS_LIMIT.windowMs,
  );
  if (!limited.ok) {
    /*
     * ⚠️ 429 在**打上游之前**：限流的意义就是不让被拒的请求占用上游额度。
     *    `Retry-After` 是 HTTP 标准字段，界面据此说"请 N 秒后再试"，
     *    而不是干巴巴一句"请求过于频繁"（同 routes/seeds.ts 的做法）。
     */
    c.header('Retry-After', String(limited.retryAfterSec));
    return c.json({ error: 'rate_limited', retryAfterSec: limited.retryAfterSec }, 429);
  }

  /*
   * ⚠️ `no-store` 在这里是**必须的**，不是照抄别处的习惯：心跳回答的是"现在"，
   *    任何一层缓存（浏览器 / 中间层）把它留下来，面板就会冻在上一次的值上，
   *    而画面上完全看不出来（本仓为启发式缓存排查过一轮，症状是"明明改好了还是旧的"）。
   */
  c.header('Cache-Control', 'no-store');

  let stale = false;
  if (cached === null || now - cached.fetchedAt >= ttlMs()) {
    const result = await load();
    if (result.ok) {
      cached = { monitor: result.monitor, fetchedAt: now };
    } else {
      /*
       * ★ 这一行日志**在兜底判断之前**打。
       *
       * 否决了"只在真的回 5xx 时才打"（那样更安静）：兜底成功时用户什么都看不到，
       * 而那一刻恰恰是我们**唯一**能知道上游出问题的时机 —— 另外三个面板由访客
       * 浏览器直连，它们的失败在我们这边一个字都没有（spec §3 代价 1）。
       * 把它压到"十分钟后兜底也过期了"才记，等于让一次短故障完全不留痕。
       * ⚠️ 它不会每个请求都打一次：只有**真的打了上游**（缓存过期或还没有缓存）
       * 并且失败时才会走到这里。
       */
      console.error(`[ranked] 心跳取不到（${result.kind}）：${result.detail}`);

      if (cached !== null && now - cached.fetchedAt <= STALE_MAX_MS) {
        // 手上那份还在窗口内 ⇒ 给旧数据，并且**说出来**（`stale: true`，界面会说"这是旧数据"）
        stale = true;
      } else {
        /*
         * ⛔ 三种失败必须分开回答，下面三行的**顺序不是随意的**：
         *   · `bad_response` ⇒ **502**：我们的适配层要改（上游改了字段），不是上游抖了；
         *   · `busy`         ⇒ **503 + ranked_busy**：上游在限我们的流，等一下就好；
         *   · 其余           ⇒ **503 + upstream_unavailable**：上游挂了，要等它修。
         */
        if (result.kind === 'bad_response') {
          return c.json({ error: 'upstream_bad_response' }, 502);
        }
        if (result.kind === 'busy') return c.json({ error: 'ranked_busy' }, 503);
        return c.json({ error: 'upstream_unavailable' }, 503);
      }
    }
  }

  const entry = cached;
  /*
   * ⚠️ 这里 `entry` 一定非 null（上面每一条路都保证了：要么缓存还新鲜、要么刚取到、
   *    要么已经 return 了）。这一支是**类型**上的兜底 —— 与其依赖控制流分析证明
   *    它不可能发生，不如明写一句"读不到数据就不假装读到了"。
   */
  if (entry === null) return c.json({ error: 'upstream_unavailable' }, 503);

  /*
   * ★ 用 `satisfies` 而不是 `as`：少一个字段、拼错一个名字都当场编译报错
   *   —— 这份形状是**冻结契约**（spec §4.2），而它的读者是浏览器那一侧。
   */
  return c.json({
    monitor: entry.monitor,
    serverNow: now,
    fetchedAt: entry.fetchedAt,
    stale,
  } satisfies RankedStatusResponse);
});
