/**
 * MCSR Ranked **状态页**心跳的上游。
 *
 * ===========================================================================
 * ⚠️★ 为什么这一栏只有这一个端点走我们的服务器
 * ===========================================================================
 * 心跳那个主机（`packages/shared/src/ranked/const.ts` 里的 `RANKED_STATUS_UPSTREAM`）
 * **不发 `access-control-allow-origin`**（2026-09-16 从生产服务器实测，见 spec §2.5），
 * 而另外三个主机都发 `*`。
 * ⇒ 浏览器**读不到**它的响应体，这不是"配置问题"，是对方没打算让浏览器直连。
 * 所以这一处是**架构上被迫**的例外（spec §3 的 A 方案），不是设计偏好：
 * 我们因此必须保留一个极小的服务端端点，而它每分钟最多打 2 次上游
 * （TTL 在路由那一层），占掉服务器 IP 那条 500 次 / 10 分钟额度的 4%（spec §5.3）。
 * ⚠️ 那个地址**只写在常量里**（计划的 Global Constraints 第 1 条）：注释里再抄一遍，
 *    换域名时它会悄悄变成一句假话 —— 而这一条注释正是"为什么必须由服务器去取"的全部理由，
 *    它错了，读的人就会去浏览器那一侧找答案。
 *
 * ⚠️ 这一层**只管"取回来、归一化"**：缓存、single-flight、限流、响应码全在
 * `routes/ranked.ts` —— 那一层才知道"这次请求是谁发的、手上有没有旧数据"。
 */
import {
  parseHeartbeat,
  RANKED_MONITOR_ID,
  RANKED_STATUS_UPSTREAM,
  type RankedMonitor,
} from '@mcsr/shared/ranked';

/**
 * 上游调用的结果。
 *
 * ★ 失败刻意分成**三种**而不是"成功/失败"两类，因为它们对用户的**下一步**不同
 *   （spec §4.2 的拒绝码就是照着这三档定的）：
 *   · `unavailable` → 上游抖了 / 网络不通 / 超时 / 5xx ⇒ 等一下再试（503）
 *   · `busy`        → 上游在限**我们的**流（429）⇒ 也是等一下，但那是我们打得太快（503 ranked_busy）
 *   · `bad_response`→ 上游回的东西我们**读不懂**（字段改了）⇒ **我们的适配层要改**（502）
 * ⚠️ 把 `busy` 并进 `unavailable` 是最容易顺手做的"简化"，而它的后果是界面上
 *    "上游在限流（等一下就好）"与"上游挂了（等它修）"变成同一句话 —— 后者会让用户
 *    一直等一个不会自己好起来的东西。
 */
export type HeartbeatResult =
  | { ok: true; monitor: RankedMonitor }
  | { ok: false; kind: 'unavailable' | 'busy' | 'bad_response'; detail: string };

/**
 * 超时毫秒数。可用 `MCSR_RANKED_STATUS_TIMEOUT_MS` 覆盖。
 *
 * 8 秒是 spec §5.3 的冻结值，留这个环境变量是为了测试能用 20ms **真的**触发一次
 * abort（见 ranked.test.ts），而不是假装抛一个超时错误 —— 后者测的是"我们会不会
 * 处理超时"，前者测的是"超时到底会不会发生"（同 seeds/upstream.ts 的理由）。
 */
function timeoutMs(): number {
  const raw = Number(process.env.MCSR_RANKED_STATUS_TIMEOUT_MS ?? '');
  return Number.isFinite(raw) && raw > 0 ? raw : 8_000;
}

/**
 * 把 fetch 抛出来的东西变成一句能排查的话（**只进日志**，绝不进响应体）。
 *
 * ⚠️ 只看 `message` 是不够的：undici 在连接层面失败时给它的是 "fetch failed"，
 *    真正的原因（ECONNREFUSED / ENOTFOUND / 证书…）塞在 `cause.code` 里 ——
 *    那样的日志等于什么都没有记（seeds/upstream.ts 里有同一条注释与同一个理由）。
 */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = asRecord(error.cause);
  const code = cause?.code;
  return typeof code === 'string'
    ? `${error.name}: ${error.message}（${code}）`
    : `${error.name}: ${error.message}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * 取一次上游心跳。
 *
 * ⚠️ 不收 `now`：时间一律由路由层取一次 —— 缓存与回给访客的 `serverNow`/`fetchedAt`
 *    必须是**同一个**时刻，在这一层再取一次会让它们差一个随时会变的数。
 */
export async function fetchHeartbeat(): Promise<HeartbeatResult> {
  /*
   * ⚠️ 地址可配（`MCSR_RANKED_STATUS_URL`）是**测试的接缝**：测试把它指向
   *    `https://upstream.invalid/...`（RFC 2606 保证不可解析），万一桩没装上，
   *    请求会立刻失败而不是打到真上游（同 MCSR_SEED_API_BASE 的先例）。
   */
  const url = process.env.MCSR_RANKED_STATUS_URL ?? RANKED_STATUS_UPSTREAM;

  let response: Response;
  try {
    // ⚠️ 用 globalThis.fetch（不提前抓引用）—— 测试靠替换它来杜绝真实网络。
    response = await globalThis.fetch(url, {
      headers: {
        accept: 'application/json',
        // 我们对第三方是"有名字的"来访者：否决了"不带 UA"，那会让对方无法按来源联系我们
        'user-agent': 'mcsr-helper/0.3 (+https://mcsrhelper.com)',
      },
      /*
       * 超时用 AbortSignal.timeout 而不是自己 setTimeout + AbortController：
       * 少一份"忘记 clearTimeout"的可能，而且它同时中止**读取响应体**
       * （一个连上就再也不发完响应体的上游同样不能让我们自己的请求一直挂着）。
       */
      signal: AbortSignal.timeout(timeoutMs()),
    });
  } catch (error) {
    return { ok: false, kind: 'unavailable', detail: `网络失败：${describeError(error)}` };
  }

  if (!response.ok) {
    /*
     * ★ 429 单独成档：那是"上游在限我们的流"，与"上游挂了"对用户的下一步是不同的
     *   （前者等一下就好，后者要等它修）。
     * ⚠️ 这一档的区分**只能在这里做** —— 路由层拿到的只是一个 kind，
     *    它没法再从 429 里读出这个意思（响应已经被丢掉了）。
     */
    if (response.status === 429) return { ok: false, kind: 'busy', detail: 'HTTP 429' };
    return { ok: false, kind: 'unavailable', detail: `HTTP ${String(response.status)}` };
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (error) {
    /*
     * ⚠️ 一个 200 却不是 JSON，归 `unavailable`（上游抖了 / 被前面的网关挡了），
     *    **不是** `bad_response`（我们的适配层对不上了）：那种响应体通常是一页
     *    HTML 错误页或被截断的传输，而 502 会把排查方向指向一个并不存在的字段名问题。
     *    否决了"顺手并进 bad_response"：那会让 502 同时表示两件下一步完全不同的事。
     */
    return {
      ok: false,
      kind: 'unavailable',
      detail: `响应体不是合法 JSON（${describeError(error)}）`,
    };
  }

  const monitor = parseHeartbeat(raw);
  if (!monitor) {
    /*
     * ⚠️ 这一档是**适配层出问题**（上游改了字段名/结构），与"上游抖了一下"是两件事：
     *    路由层拿 bad_response 回 502，日志里带上**是哪一格**缺了 ——
     *    那条日志存在的唯一意义就是告诉下一个人要改哪里。
     */
    return {
      ok: false,
      kind: 'bad_response',
      // ⚠️ 两句话都要留着：`parseHeartbeat` 返回 null 有**两个**来源（响应不是一个对象 /
      //    那一格不在），而日志的读者要靠它决定是去查上游还是查我们自己的适配层。
      detail: `heartbeatList 里没有 monitor ${RANKED_MONITOR_ID} 那一条（响应不是对象，或上游改了字段名/结构）`,
    };
  }

  return { ok: true, monitor };
}
