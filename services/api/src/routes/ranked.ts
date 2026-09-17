/**
 * Ranked 实时信息 —— **一个端点**：① 服务心跳（`/status`）。
 *
 * ===========================================================================
 * 为什么只有心跳那一个是**架构上被迫**的（spec §2.5 / §3）
 * ===========================================================================
 * 另外三个面板（Elo 排行榜 / 周赛榜单）与"在线人数"由**访客浏览器直连上游**，
 * 走的是访客自己的 IP —— 这是用户 2026-09-16 的裁决，也让服务器那条
 * 500 次 / 10 分钟的额度只被用掉一点点。
 * 而心跳那个主机（`packages/shared/src/ranked/const.ts` 里的 `RANKED_STATUS_UPSTREAM`）
 * **不发 CORS 头**（spec §2.5 实测）⇒ 浏览器读不到它，只能由我们取。
 * 所以那一处是"架构上被迫"的例外，不是设计偏好。
 * ⚠️ 那个地址**只写在常量里**（计划的 Global Constraints 第 1 条）：注释里再抄一遍，
 *    换域名时它会悄悄变成一句假话，而"已经不对的注释"比没有注释更贵。
 *
 * ===========================================================================
 * ⚠️★ `GET /api/ranked/live` 曾经在这里，**已经删掉**（2026-09-17）
 * ===========================================================================
 * 它不是一个"失败的服务端代理"，而是一个**没有调用者**的端点：② 的对局今天仍然由
 * 访客浏览器直连上游（上面那条裁决），所以库里留下的那个 handler 只服务"顺手收录
 * twitch 直播链接"这一个副作用 —— 而**没有人请求它就什么都不会发生**。
 * 收录那一件事因此改成 **systemd 的 oneshot + 5 分钟 timer**
 * （`services/api/src/ranked-streams.ts`，独立进程、每轮一次 GET），本文件于是回到
 * **只剩心跳一个端点**：与 §13 冻结表里那句"我们**唯一**的端点 = `GET /api/ranked/status`"
 * 重新一致。
 * ⚠️ 删它的代价是零：`apps/web` 一个请求都不打它（`lib/rankedDirect.ts` 直连上游），
 *    而"收录"那条路的原料现在从 `ranked/live-feed.ts` 直接进作业，不经过任何路由。
 *    ⇒ 下一次想加端点时先问一句"**谁**会请求它"：这一次的答案就是"没有人"。
 *
 * ===========================================================================
 * 心跳那三件事都在这个文件里，它们是一起的
 * ===========================================================================
 *   · 节流：**每 TTL 最多打一次上游**（30 秒），成功与失败**一视同仁**。
 *     ⚠️ 这一点比看起来重要：single-flight 只解决"同时到达"，
 *     解决不了"上游挂了之后每个请求都再试一次"（见下面 ★★ 那一大段）；
 *     心跳上游一分钟才出一条，而我们的访客 15 秒刷一次、还会同时开着好几个标签页 ——
 *     不节流的话上游额度会被我们自己人打满（spec §5.3：这一处每分钟最多 2 次真实调用）；
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

/** 兜底窗口：旧数据最多留十分钟（spec §5.3）。 */
const STALE_MAX_MS = 10 * 60_000;

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
  if (!Number.isFinite(value) || value < 0) return 30_000;
  /*
   * ★ 上界是兜底窗口（10 分钟），不是"随便多大都行"。
   *
   * TTL 比 10 分钟大时会出现一件事：一份**比兜底窗口还旧**的数据仍然是"新鲜"的，
   * 于是它带着 `stale: false` 回给访客 —— 面板上写着"实时"，数据却是十一分钟前的。
   * 那是 spec §5.3 唯一明令不许出现的展示形状（数据是真的、时间是假的）。
   * 实测过：TTL=20 分钟 + 上游挂了 + 11 分钟前那份数据 ⇒ 200 + `stale:false`（应该是 503）。
   * ⚠️ 否决了"只把默认值写对就行"：这个变量是**运维也能设**的接缝，
   *    而错的后果在画面上看不出来（看上去一切正常，只是数据其实很旧）。
   */
  return Math.min(value, STALE_MAX_MS);
}

/** 每 IP 的配额（spec §13 冻结：60 次 / 分钟）。 */
export const RANKED_STATUS_LIMIT = { limit: 60, windowMs: 60_000 };

/** 上游失败的那三档（`HeartbeatResult` 里 `ok: false` 那一支）。 */
type FailureKind = Extract<HeartbeatResult, { ok: false }>['kind'];

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

/*
 * ⚠️★ 两个时刻必须分开，理由是一个真发生过的缺陷（评审实测）：
 *   · `fetchedAt`     —— 这一份**数据**是什么时候拿到的：它决定数据有多旧、以及 10 分钟兜底窗口；
 *   · `lastAttemptAt` —— 我们**上一次尝试打上游**是什么时候：它决定"现在该不该再打"。
 * 合在一起写（只看 `fetchedAt`）的话，**失败之后那个判据永远为真** ——
 * 因为失败不更新 `fetchedAt` ⇒ 每个请求都打一次上游、每个请求都记一条日志，
 * 而上游越慢/越挂，我们打得越狠（正好是我们要避免的那个反馈环）。
 * ⇒ 失败时 `fetchedAt` **不动**（数据确实还是旧的），但 `lastAttemptAt` **必须动**。
 */
let lastAttemptAt = 0;

/**
 * ★ 上一次尝试失败的那一档 —— 它给"没有能用的缓存"时那条回答定码。
 *
 * ⚠️ 没有它就会出现一件事：节流把这次请求的上游调用挡掉了，于是这次请求
 * **不知道**上游现在是什么毛病（429 还是形状漂移还是挂了），只能含糊回一句
 * `upstream_unavailable` —— 而 502/`ranked_busy` 的区分（"我们的适配层要改" vs
 * "我们在被限流"）正是这个端点存在的一半意义（spec §4.2）。
 * ⚠️ 它记的是**最近一次真的尝试**的结果：过了 TTL 会再试，所以它不会永远陈旧。
 */
let lastFailureKind: FailureKind | null = null;

/** 在飞的那一次上游调用（single-flight 就靠它）。 */
let inflight: Promise<HeartbeatResult> | null = null;

/**
 * ⚠️ **仅供测试**：清掉缓存、尝试时钟、失败档与在飞的那一次。
 *
 * 为什么必须有它：这几份状态是**模块级**的，会跨用例存活 —— 不清的话
 * "TTL 内不重打上游"那类用例会被上一个用例留下的缓存蒙对（同 routes/seeds.ts
 * 的 `clearSeedsCache`，那是本仓为同一个问题开过的先例）。
 * ⚠️ `lastAttemptAt` 也必须清：留下它的话，下一个用例的第一个请求会落在
 *    "不到点"那一支上，而用例**看不出来**它为什么没有打上游。
 */
export function resetRankedStatusCache(): void {
  cached = null;
  lastAttemptAt = 0;
  lastFailureKind = null;
  inflight = null;
}

/**
 * 取一次心跳，**同一时刻只打一次上游**。
 *
 * ⚠️ `inflight` 只可能在**它自己结算的那一刻**被清掉（下面那个 `finally`），
 *    而且清之前必须做**身份判断**：`resetRankedStatusCache()` 会在有请求还在飞的时候
 *    清掉这份记录，于是后来者可能已经新起了一个 promise —— 若 `finally` 无条件写 null，
 *    它清掉的是**别人**的槽位，下一个请求就会以为"没有人在飞"而再打一次上游
 *    （同一时刻两个上游调用，正是这里要禁止的那件事；实测过：桩计数 3 而不是 2）。
 */
function load(): Promise<HeartbeatResult> {
  const existing = inflight;
  if (existing) return existing;
  const attempt = fetchHeartbeat().finally(() => {
    if (inflight === attempt) inflight = null;
  });
  inflight = attempt;
  return attempt;
}

export const rankedRoute = new Hono<{ Variables: AuthVariables }>();

rankedRoute.get('/status', async (c) => {
  // ★ 时间只在这里取一次：缓存判断与回给访客的 `serverNow` 用的是**同一个**时刻
  const now = Date.now();

  /*
   * ⚠️ `no-store` 在这里是**必须的**，不是照抄别处的习惯：心跳回答的是"现在"，
   *    任何一层缓存（浏览器 / 中间层）把它留下来，面板就会冻在上一次的值上，
   *    而画面上完全看不出来（本仓为启发式缓存排查过一轮，症状是"明明改好了还是旧的"）。
   * ⚠️ 它设在**限流判断之前**：`no-store` 是这个 handler **每一条**响应的性质
   *    （200 / 429 / 502 / 503 都是"此刻"的答案），不是"成功那条才有的"。
   *    实测过它挂在限流之后 ⇒ 429 没有这个头，而 429 恰恰是最容易被中间层留下来的
   *    那一种（"稍后再试"被缓存住，就再也不会真的试了）。
   */
  c.header('Cache-Control', 'no-store');

  const limited = hit(
    keyFor('ranked-status', clientIp(c)),
    RANKED_STATUS_LIMIT.limit,
    RANKED_STATUS_LIMIT.windowMs,
  );
  if (!limited.ok) {
    /*
     * ⚠️ 429 在**打上游之前**：限流的意义就是不让被拒的请求占用上游额度。
     * ⚠️★ `Retry-After` 是给**别的**客户端（脚本 / 以后可能有的读者）的标准字段，
     *    **不是**界面在等的东西：这一栏界面那句是 `ranked.errRateLimited`
     *    （「请求有点频繁，过一会儿再试。」），它**不收数字** —— `apps/web` 这一条路上
     *    没有任何一处读 `retryAfterSec` 或这个头（body 里那个字段是**契约**的一部分，
     *    spec §4.2；把数字印进句子的那一套在"实时分享"那一栏，走的是它自己的码）。
     * ⚠️ 早先这里的注释写的是"界面据此说『请 N 秒后再试』"，那句**不成立**（2026-09-16 终审量到）。
     */
    c.header('Retry-After', String(limited.retryAfterSec));
    return c.json({ error: 'rate_limited', retryAfterSec: limited.retryAfterSec }, 429);
  }

  /*
   * ★ 第一个判断：手上这份**数据**新不新鲜（看 `fetchedAt`）——
   *   新鲜就一次上游都不打地回它，这就是"TTL 内第二次请求不打上游"。
   */
  const cachedEntry = cached;
  if (cachedEntry !== null && now - cachedEntry.fetchedAt < ttlMs()) {
    /*
     * ★ 用 `satisfies` 而不是 `as`：少一个字段、拼错一个名字都当场编译报错
     *   —— 这份形状是**冻结契约**（spec §4.2），而它的读者是浏览器那一侧。
     */
    return c.json({
      monitor: cachedEntry.monitor,
      serverNow: now,
      fetchedAt: cachedEntry.fetchedAt,
      stale: false,
    } satisfies RankedStatusResponse);
  }

  /*
   * ★ 第二个判断：**该不该现在再打一次上游**（看 `lastAttemptAt`）。
   *   真正发起一次尝试的时刻就在这里 —— 注意它在 `await` **之前**，
   *   于是"成功"与"失败"对节流的影响完全一样（见上面 ★★ 那段）。
   */
  const due = now - lastAttemptAt >= ttlMs();
  if (due) lastAttemptAt = now;

  let justFetched = false;
  /*
   * ⚠️ 除了"到点"，还有第二种该等上游的情况：**已经有人在飞**（single-flight）。
   *    那不是我们发起的尝试，但这次请求必须搭上它 —— 否则十个同时到达的请求里
   *    只有第一个拿得到数据，其余九个会在"没有缓存 + 不到点"的状态下直接回 503。
   * ⚠️"到点 + 有人在飞"只在 TTL 比一次上游调用还短时出现（那是测试的接缝 0）：
   *    这时我们记下的尝试时刻比真正的发起者晚一点，方向是**打得更少**，不会多打。
   */
  if (due || inflight !== null) {
    const result = await load();
    if (result.ok) {
      cached = { monitor: result.monitor, fetchedAt: now };
      lastFailureKind = null;
      // ★ 这一份是刚取到的 ⇒ 下面回 `stale: false`（哪怕 TTL 被设成 0）
      justFetched = true;
    } else {
      lastFailureKind = result.kind;
      /*
       * ★ 这一行日志**在兜底判断之前**打，而且**一次尝试只打一行**（`due` ——
       *   跟着别人搭车等结果的那些请求不重复记）。
       *
       * 否决了"只在真的回 5xx 时才打"（那样更安静）：兜底成功时用户什么都看不到，
       * 而那一刻恰恰是我们**唯一**能知道上游出问题的时机 —— 另外三个面板由访客
       * 浏览器直连，它们的失败在我们这边一个字都没有（spec §3 代价 1）。
       * 把它压到"十分钟后兜底也过期了"才记，等于让一次短故障完全不留痕。
       * ⚠️ 但它也**不是**每个请求一行：真的打上游的次数被 `lastAttemptAt` 限在
       *    "每个 TTL 最多一次"，所以一次故障是**每 30 秒最多一行**
       *    （这一条曾经是假的：失败不更新 `lastAttemptAt` ⇒ 每个请求一行，见 ★★）。
       */
      if (due) console.error(`[ranked] 心跳取不到（${result.kind}）：${result.detail}`);
    }
  }

  const usable = cached;
  if (usable !== null && now - usable.fetchedAt <= STALE_MAX_MS) {
    /*
     * ★ 手上那份还在十分钟窗口内 ⇒ 给旧数据，并且**说出来**（界面会说"这是旧数据"）。
     * ⚠️ `stale` 问的是"回给你的这一份是不是刚取到的"：刚取到（自己打的，或搭上别人
     *    正在打的那一次）⇒ `false`；因为节流**没打**、或者打了但失败了 ⇒ 手上那份是旧的。
     *    再叠一个"年龄 >= TTL"是为了并发的那一种：在这里读到的可能是另一个请求刚写进去的
     *    那一份，那时它其实新鲜，标成旧数据会让界面白说一句（保守，但不是事实）。
     */
    const stale = !justFetched && now - usable.fetchedAt >= ttlMs();
    return c.json({
      monitor: usable.monitor,
      serverNow: now,
      fetchedAt: usable.fetchedAt,
      stale,
    } satisfies RankedStatusResponse);
  }

  /*
   * ⛔ 手上没有能用的缓存（从来没有过，或者已经超过十分钟）⇒ 按**最近一次尝试**失败的那一档
   *    回答，三种失败必须分开，下面三行的**顺序不是随意的**：
   *   · `bad_response` ⇒ **502**：我们的适配层要改（上游改了字段），不是上游抖了；
   *   · `busy`         ⇒ **503 + ranked_busy**：上游在限我们的流，等一下就好；
   *   · 其余           ⇒ **503 + upstream_unavailable**：上游挂了，要等它修。
   * ⚠️ 这里**不再打日志**：那次失败在它发生的那一刻已经记过一行 —— 在这条路上按请求
   *    打日志，正是这次要修掉的那个形状（一次故障变成 N 行，排障时把一件事看成 N 件）。
   * ⚠️ `lastFailureKind` 为 null 时兜到 `unavailable`：真实时钟下到不了这一支
   *    （它初值 0 ⇒ 第一个请求一定会去打一次），这一句只是类型上的兜底：
   *    与其依赖控制流分析证明它不可能发生，不如明写"读不到数据就不假装读到了"。
   */
  const kind = lastFailureKind ?? 'unavailable';
  if (kind === 'bad_response') return c.json({ error: 'upstream_bad_response' }, 502);
  if (kind === 'busy') return c.json({ error: 'ranked_busy' }, 503);
  return c.json({ error: 'upstream_unavailable' }, 503);
});
