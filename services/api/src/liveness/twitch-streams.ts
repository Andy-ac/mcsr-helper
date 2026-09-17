/**
 * Twitch「谁在播、多少人看」—— `helix/streams` 这一条路（用户第 10 条）。
 *
 * 调用方是 `services/api/src/live-status.ts`（systemd oneshot，每 3 分钟一轮）。
 * 与 `tracking/twitch.ts`（那个适配器管的是"某个博主的**历史视频**"）共用
 * **同一份** token 源（`createTwitchTokenSource`）与**同一条**凭据读法
 * （`twitchTokenSourceFromEnv`）—— 这一条线上只有一份"怎么跟 Twitch 认证"的代码。
 *
 * ===========================================================================
 * 一、★ 实测读数（2026-09-18，**在生产服务器上**量的，不是本机）
 * ===========================================================================
 * 本机到 `api.twitch.tv` 的 TCP 连接超时、本机也没有凭据 ⇒ 这一条只能在服务器上量。
 * 脚本与原始输出：`.cache/videos-live-round/probe-twitch-streams.{sh,mjs,out.txt}`。
 * 逐条（原文见报告）：
 *
 *   · `POST https://id.twitch.tv/oauth2/token` → **200，467 ms**，`access_token` 长度 30；
 *   · `GET helix/streams?first=100`（不带 `user_login`）→ **200，297 ms，49 639 B**，
 *     `data.length=100`，**上游确实按人数降序**（首 105 955 → 末 3 823，逐对比较为真），
 *     `type` 全是 `"live"`，**没有一条缺 `viewer_count`**；
 *   · 响应头 `ratelimit-limit=800` / `ratelimit-remaining=799` / `ratelimit-reset=1789676765`；
 *   · 库里的 **183 个** twitch 频道分 2 批（100 + 83）问完：**185 ms + 175 ms**，
 *     回来说**在播 37 个**（含 `viewer_count=0` 的条目 —— 见第三节）；
 *   · **缺失 = 不在播**（这一条是整份实现的语义地基，必须实测）：
 *     一次问「一个刚才在播的 login + 一个绝不存在的 login」→ 回来的只有前者；
 *   · 一次塞 **101 个** `user_login` → **HTTP 400**
 *     `The parameter "user_login" was malformed: the value must be less than or equal to 100`
 *     ⇒ 文档里那句"最多 100 个"**量到了**（本仓此前只有文档），切批因此**不能省**。
 *     ⚠️ 那个 400 **没有** `Ratelimit-*` 头（同一份读数里记着）。
 *
 * ===========================================================================
 * 二、★ 「上游没返回」= 不在播 —— 这条语义的代价与边界
 * ===========================================================================
 * `helix/streams?user_login=…` 只返回**此刻在播**的那些频道：问 100 个，回来 21 个，
 * 那 79 个就是"不在播"（上面那条对照实测）。⇒ 这一层返回的是"**问了哪些**" +
 * "**其中谁在播**"，让调用方自己把两者相减 —— 而不是在这里就把"没回来的"写成
 * `is_live = 0`：那样一来"上游整批失败"与"大家都没播"在调用方看来是同一件事。
 *
 * ⚠️ 边界（写下来，因为它是这条语义唯一会被推翻的方式）：上游**永远**只返回在播的
 *    频道 —— 那么"某个 login 拼错了"也会被读成"这个人不在播"。代价可接受：
 *    错的 login 是编辑手滑，而界面上的表现只是"少一个徽章"（不是一句假话）。
 *
 * ===========================================================================
 * 三、`viewer_count` 缺失与 0 的区别
 * ===========================================================================
 * 实测里既要看到"上游会给 0"（`fluwurian(0)` 这样的在播条目），也要保住
 * "读不到就是读不到"：本层把 `viewer_count` 不是数字的条目映射成 `null`
 * （**不是 0**），而 0 只有在**上游真的说了 0** 时才会出现。
 * 界面上这两件事必须分得开（`LiveChannel.viewerCount` 的注释）。
 *
 * ===========================================================================
 * 四、失败分档：**一批失败不许波及别的批，更不许变成"大家都不在播"**
 * ===========================================================================
 *   | 情况 | 档位 | 处置 |
 *   |---|---|---|
 *   | 发不出去 / 超时 | `unavailable` | 这一批不写（下一轮 3 分钟后再来） |
 *   | 401 / 403（token 或 client id 不对） | `handshake` | 整条 Twitch 这一轮放弃 |
 *   | 429 / 5xx | `unavailable` | 同上（429 的字面意思就是"退避重来"） |
 *   | 其它非 200（含 400：参数写错了） | `bad_response` | **我们要改代码**，不自愈 |
 *   | 200 但顶层不是 `data: []` | `bad_response` | 同上（当成空列表就会把所有人标成不在播） |
 *   | token 换不到 | `handshake` | 一次都不发 |
 * ⇒ 返回值里 `answered`（上游真的答过的批）与 `failures`（没答的批）**分开**，
 *   调用方只写 `answered` 里那些行。这一条是"一次网络抖动不许把所有人标成不在播"
 *   在适配层的形状（`live-status.ts` 的注释从另一侧说了同一件事）。
 */
import type { TwitchTokenSource } from '../tracking/twitch';
import { PlatformUnavailableError } from '../tracking/types';

const HELIX_STREAMS = 'https://api.twitch.tv/helix/streams';

/**
 * 一次请求最多几个 login。
 *
 * ⚠️ 100 是**实测**上限（不是抄文档）：101 个当场 HTTP 400
 *    （文件头第一节最后一条读数）。切批少了任何一批，那一批的行就永远不更新。
 */
export const TWITCH_LOGIN_BATCH = 100;

/** 单次请求的超时。照 `tracking/twitch.ts` 的 20 秒（同一家上游，同一个理由）。 */
const REQUEST_TIMEOUT_MS = 20_000;

export type TwitchFailureKind = 'unavailable' | 'handshake' | 'bad_response';

/** 一个在播的频道。`viewerCount` 为 `null` = 上游给的 `viewer_count` 不是数字。 */
export interface TwitchLiveEntry {
  login: string;
  viewerCount: number | null;
}

/** 一批的结果：**问了哪些** + **其中谁在播**（两者相减才是"不在播"，见文件头第二节）。 */
export interface TwitchAnsweredBatch {
  logins: string[];
  live: TwitchLiveEntry[];
}

/** 一批的失败：一次故障一条（不是每个 login 一条 —— 否则一次断网会打出 100 行）。 */
export interface TwitchFailedBatch {
  logins: string[];
  kind: TwitchFailureKind;
  detail: string;
}

export interface TwitchStreamsOutcome {
  /** 上游**真的答过**的批。调用方只从这里产生写入。 */
  answered: TwitchAnsweredBatch[];
  /** 没答的批。这些行**一个字段都不许写**。 */
  failures: TwitchFailedBatch[];
}

export interface TwitchStreamsDeps {
  /** 共用 `tracking/twitch.ts` 的 token 源（**不许**在这一层自己换 token）。 */
  tokens: TwitchTokenSource;
  /** `Client-Id` 头的值（`MCSR_TWITCH_ID`）。 */
  clientId: string;
  /** 注入假实现，测试里**绝不打真网络**。 */
  fetchImpl?: typeof fetch;
}

/** `fetch` 的拒绝 → 一句能进日志的话（照 `tracking/twitch.ts` 那一份）。 */
function failureDetail(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** 上游的错误体 → 一句话。⚠️ 永远**不带**请求体（token 那一侧的 POST 体里有密钥）。 */
function twitchErrorDetail(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: unknown; message?: unknown };
    const parts = [
      typeof body.error === 'string' ? `error=${body.error}` : null,
      typeof body.message === 'string' ? `message=${body.message}` : null,
    ].filter((part): part is string => part !== null);
    if (parts.length > 0) return parts.join(' ');
  } catch {
    // 不是 JSON —— 落到下面那句
  }
  return text.trim() === '' ? '（响应体是空的）' : text.slice(0, 200);
}

/**
 * 问一批 login。
 *
 * ⚠️ `user_login` 是**重复参数**（`&user_login=a&user_login=b`），不能用
 *    `Record<string, string>` 装 —— 那正是 `tracking/twitch.ts` 的 `helixJson`
 *    为核对（`?id=`）留 `repeatIds` 的同一个理由（那里写明了"换成 set 只剩最后一个"）。
 */
async function fetchBatch(
  logins: readonly string[],
  deps: TwitchStreamsDeps,
): Promise<TwitchAnsweredBatch | TwitchFailedBatch> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const query = new URLSearchParams({ first: '100' });
  for (const login of logins) query.append('user_login', login);

  let token: string;
  try {
    token = await deps.tokens.get();
  } catch (error) {
    /*
     * ★ 换 token 那一步失败的**档位要分开**，不能一律记成 `handshake`：
     *   · `PlatformUnavailableError`（发不出去 / 超时）⇒ **上游/网络**的问题，
     *     过一会儿再来，凭据一个字都没错；
     *   · `PlatformHandshakeError`（401/403、响应里没有 access_token）⇒
     *     **我们的配置或凭据**要改。
     * ⚠️ 这一条是**实测逼出来的**（2026-09-18）：本机到 `id.twitch.tv` 打不出去，
     *    第一版把这一档一律写成 `handshake`，于是日志里出现
     *    「`handshake: PlatformUnavailableError: … fetch failed`」——
     *    档位说是"凭据不对"，正文说是"联系不上"，两者打架，而运维会照着
     *    **档位**去查密钥（一个不存在的错误方向）。代价：多两个 import 与一个分支。
     */
    const kind = error instanceof PlatformUnavailableError ? 'unavailable' : 'handshake';
    return { logins: [...logins], kind, detail: failureDetail(error) };
  }

  let response: Response;
  try {
    response = await fetchImpl(`${HELIX_STREAMS}?${query.toString()}`, {
      headers: {
        // 头名逐字照文档（`Client-Id` / `Authorization`），与 `tracking/twitch.ts` 一致
        'Client-Id': deps.clientId,
        Authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return { logins: [...logins], kind: 'unavailable', detail: failureDetail(error) };
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    return {
      logins: [...logins],
      kind: 'unavailable',
      detail: `读响应体失败：${failureDetail(error)}`,
    };
  }

  if (!response.ok) {
    const detail = `HTTP ${String(response.status)}：${twitchErrorDetail(text)}`;
    if (response.status === 401 || response.status === 403) {
      return { logins: [...logins], kind: 'handshake', detail };
    }
    if (response.status === 429 || response.status >= 500) {
      return { logins: [...logins], kind: 'unavailable', detail };
    }
    /*
     * 其余（含 400）：参数写错了 —— 那是**我们要改代码**，不是上游抖了。
     * ⚠️ 这一档**不自愈**，所以它不能与 `unavailable` 合成一档（本仓
     *    `ranked-streams.ts` 那张表把 `bad_response` 单独列出来的同一条理由）。
     */
    return { logins: [...logins], kind: 'bad_response', detail };
  }

  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return {
      logins: [...logins],
      kind: 'bad_response',
      detail: `响应不是 JSON（开头：${text.slice(0, 200)}）`,
    };
  }

  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    return {
      logins: [...logins],
      kind: 'bad_response',
      detail: '响应里没有 data 数组（当成空列表就会把这一批全部标成"不在播"）',
    };
  }

  const live: TwitchLiveEntry[] = [];
  for (const item of data) {
    const entry = item as { user_login?: unknown; viewer_count?: unknown };
    if (typeof entry.user_login !== 'string' || entry.user_login === '') continue;
    live.push({
      login: entry.user_login,
      // ⚠️ 不是数字 ⇒ `null`（**不是 0**）：0 只能来自上游真的说了 0
      viewerCount:
        typeof entry.viewer_count === 'number' && Number.isFinite(entry.viewer_count)
          ? entry.viewer_count
          : null,
    });
  }
  return { logins: [...logins], live };
}

/** 切批（每批 ≤ 100，实测上限）。空数组 ⇒ 一个批都不产生。 */
export function chunkLogins(logins: readonly string[], size = TWITCH_LOGIN_BATCH): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < logins.length; i += size) out.push(logins.slice(i, i + size));
  return out;
}

/**
 * 跑完所有批（**批之间互不波及**：一批失败只记它自己，别的批照答）。
 *
 * @returns `answered`（真的答过的批）与 `failures`（没答的批）。调用方只写 `answered`。
 */
export async function fetchTwitchLiveStreams(
  logins: readonly string[],
  deps: TwitchStreamsDeps,
): Promise<TwitchStreamsOutcome> {
  const outcome: TwitchStreamsOutcome = { answered: [], failures: [] };

  for (const batch of chunkLogins(logins)) {
    const result = await fetchBatch(batch, deps);
    if ('live' in result) outcome.answered.push(result);
    else outcome.failures.push(result);
  }
  return outcome;
}
