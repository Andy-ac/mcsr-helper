/**
 * Bilibili「这个直播间在不在播、多少人看」（用户第 10 条）。
 *
 * 调用方是 `services/api/src/live-status.ts`（systemd oneshot，每 3 分钟一轮）。
 *
 * ===========================================================================
 * 一、★ 库里 `handle` 存的是**房间号**（不是 uid）—— 这是选端点的唯一依据
 * ===========================================================================
 * 全仓对 bilibili 那一列的看法是**一致**的：
 *   · `packages/shared/src/live.ts` 的 `liveChannelUrl()`：纯数字 ⇒ `live.bilibili.com/<handle>`；
 *   · `liveEmbedUrl()`：`cid=<handle>`（官方活动播放器的 cid **就是房间号**）；
 *   · `parseLiveLink()`：`live.bilibili.com/<数字>` 与 `space.bilibili.com/<数字>` 都产出
 *     那个数字（`BILIBILI_NUMERIC_ID`）。
 * ⇒ 我们用 `get_info?room_id=<handle>`，**与卡片上那条链接和那个播放器指同一个房间**。
 *
 * ⚠️★ 为什么不改用 `get_status_info_by_uids`（研究实测过的另一个端点）：
 *    它按 **uid** 查，而 `handle` 里那串数字**可能是 uid**（用户贴的是
 *    `space.bilibili.com/<uid>` 时）。两种标识是**两个命名空间**，而它们会撞号 ——
 *    本机实测（`.cache/videos-live-round/probe-bili-live-status.out.txt` 的 ②）：
 *    把某个人的 **uid `7995551`** 当 `room_id` 传进去，上游回 **HTTP 200 / code 0**，
 *    返回的 `room_id=7995551` 属于**另一个人**（`uid=20144651`）⇒
 *    "查 uid"这条路会把**别人的**直播状态画在这一行上，而且**没有任何字段能看出来**。
 *    ⇒ 选房间号端点不是因为更准，而是因为它查的**就是这张卡上那个链接指向的东西**：
 *      万一存的是 uid，错的方式与卡片上那条链接**错得一样**（同一个数字），
 *      而不是"链接指向 A、徽章描述 B"这种自相矛盾。
 *    ⚠️ 代价（认下，写在报告里）：`space.bilibili.com/<n>` 那一类链接会存进一个 uid，
 *      而 `live.bilibili.com/<uid>` 可能是**别人的**房间 ⇒ 那一行的徽章可能是别人的。
 *      该修的是"贴空间号也收"这条入参（`parseLiveLink`，不在本条改动范围内），
 *      修之前这里**不假装**它能分辨。今天生产上 bilibili 行数是 **0**（实测）。
 *
 * ===========================================================================
 * 二、实测读数（2026-09-18，本机；脚本 `probe-bili-live-status.mjs`）
 * ===========================================================================
 *   · `get_info?room_id=<在播房间>` → **200，65 ms，1 506 B**，`code=0`，
 *     `data.live_status` / `data.online` / `data.room_id` / `data.uid` / `data.title` 都在；
 *   · 同一个房间离线时 `live_status=0`、`online=0`（研究那一轮量到的是 `2`）
 *     ⇒ **`0` 与 `2` 都表示"不在播"**，只有 `1` 是在播（两个读数都是实测）；
 *   · `get_info?room_id=<不存在的号>` → **200**，`{"code":1,"msg":"未找到该房间","data":[]}`；
 *   · `get_status_info_by_uids`（**我们不用的那条**）→ 200，241 ms，4/4 都返回，
 *     离线的人也在（`live_status=0`）—— 记在这里是为了让下一个人知道两条端点的差别。
 *
 * ===========================================================================
 * 三、`code` 的三档（这一层最容易写错的地方）
 * ===========================================================================
 *   | 上游回答 | 我们写什么 | 为什么 |
 *   |---|---|---|
 *   | `code=0` + `live_status=1` | `is_live=1`，人数 = `online`（是数字才写） | 真实读数 |
 *   | `code=0` + `live_status≠1` | `is_live=0`，人数 `NULL` | **查过**，没在播 |
 *   | `code=1`（未找到该房间） | `is_live=0`，人数 `NULL` | "这个房间不存在"是一个**确定的回答**（不存在的房间不可能在播）。⚠️ 代价：把"房间被删了"读成不在播，它同时让一行**陈旧的在播徽章**不会再永远挂着 —— 反过来（留着不管）才是更坏的那一种 |
 *   | 其它非 0 码（例：`-352` 风控） | **什么都不写** | 那不是对"这个人"的回答（本仓别的 live 端点上见过 -352），写下去就是把一次风控变成"大家都不在播" |
 *   | HTTP 非 200 / 超时 / 不是 JSON | **什么都不写** | 同上：`answered` 与 `failures` 分开，调用方只写 `answered` |
 *
 * ⚠️ **人数用的是 `online` 而不是别的字段**：上游的字段名是 `online`
 *    （研究 §C.7 与今天两次实测都读到的就是它）。⚠️ 它是否等于"并发观看人数"
 *    在本仓**仍未验证**（`docs/platform-api-feasibility-notes.md:721` 称其为
 *    "popularity/viewer figure"）—— 界面上那一格说的是"{{n}} 人观看"，
 *    这条不确定记在报告与 `pending` 清单里，**不靠注释假装它已经确认**。
 *
 * ===========================================================================
 * 四、为什么有"一轮最多查几个 / 一轮最多花多久"两个上限
 * ===========================================================================
 * 这条端点是**一个房间一次请求**（没有批量形式；`get_status_info_by_uids` 那种
 * 批量形式按 uid 查，理由见第一节），而作业的节拍是 3 分钟。
 * ⇒ 没有上限的话，"上游开始挂"会让一轮跑成十分钟以上：systemd 的 timer 会照常
 *    触发下一轮，而 `flock -n` 拿不到锁 ⇒ 每一轮都记成 `failed`（一个真正的"卡住"
 *    信号被噪声淹没）。两个上限让一轮的时长有**结构上的上界**：
 *    `maxRooms × timeout` 之外还有一条 60 秒的**墙钟预算**（预算用完就停手并**报出**
 *    还剩几行没查 —— 这个"没查"是可见的，不是悄悄跳过）。
 * ⚠️ 两个上限都是**故意的取舍**：宁可有几行晚一轮（≤3 分钟）更新，也不要一轮黏住。
 */
import { BROWSER_HEADERS } from '../tracking/bilibili';

const ROOM_INFO = 'https://api.live.bilibili.com/room/v1/Room/get_info';

/**
 * 一轮最多问几个房间。
 * ⚠️ 今天生产上 bilibili 行数是 **0**（2026-09-18 实测），所以这个数今天是空转的；
 *    它存在是为了"编辑某天加了 300 个 bilibili 频道"时作业不会变成十分钟一轮。
 */
export const BILIBILI_MAX_ROOMS = 100;

/** 一轮在 bilibili 这一侧的墙钟预算（毫秒）。见文件头第四节。 */
export const BILIBILI_BUDGET_MS = 60_000;

/**
 * 单次请求的超时。本机实测这条端点是 51–73 ms ⇒ 8 秒是"上游挂了"与"它只是慢"的分界，
 * 不需要照 bilibili 适配器那样给 20 秒（那一条要带完整 WBI 握手，这一条不用）。
 */
const REQUEST_TIMEOUT_MS = 8_000;

/** 「未找到该房间」。**实测**原文（`{"code":1,"msg":"未找到该房间"}`）。 */
const CODE_ROOM_NOT_FOUND = 1;

/** 一个房间的回答。`isLive` 只有两种（`answered` 里的行一定会被写）。 */
export interface BilibiliAnsweredRoom {
  /** 库里的 `handle`（房间号原文，**原样带回**，调用方靠它对上那一行）。 */
  handle: string;
  isLive: boolean;
  /** `null` = 没在播（上游那个 `online=0` 不是观看人数）或上游没给数字。 */
  viewerCount: number | null;
}

/** 一行的失败。⚠️ 每一行各一条：这一条端点**一行一个请求**，故障本来就是一行的。 */
export interface BilibiliFailedRoom {
  handle: string;
  kind: 'unavailable' | 'bad_response';
  detail: string;
}

export interface BilibiliOutcome {
  /** 上游**真的答过**的房间。调用方只从这里产生写入。 */
  answered: BilibiliAnsweredRoom[];
  /** 没答的房间。这些行**一个字段都不许写**。 */
  failures: BilibiliFailedRoom[];
  /** 因为"一轮最多查 N 个 / 预算用完"而**这一轮没问**的行数（可见，不是悄悄跳过）。 */
  skipped: number;
}

export interface BilibiliRoomsDeps {
  /** 注入假实现，测试里**绝不打真网络**。 */
  fetchImpl?: typeof fetch;
  /** 注入假时钟（**毫秒**）—— 墙钟预算那一支靠它才能在测试里红（照 `tracking/twitch.ts`）。 */
  nowMs?: () => number;
  maxRooms?: number;
  budgetMs?: number;
}

function failureDetail(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** 问一个房间。返回"这一行的结局"，**从不抛**（抛出去就等于把一轮炸掉）。 */
async function fetchRoom(
  handle: string,
  deps: BilibiliRoomsDeps,
): Promise<BilibiliAnsweredRoom | BilibiliFailedRoom> {
  const fetchImpl = deps.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(`${ROOM_INFO}?room_id=${encodeURIComponent(handle)}`, {
      // ★ 与 bilibili 适配器**同一套**请求头（`BROWSER_HEADERS` 是导出的一份）
      headers: { ...BROWSER_HEADERS, accept: 'application/json, text/plain, */*' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return { handle, kind: 'unavailable', detail: failureDetail(error) };
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    return { handle, kind: 'unavailable', detail: `读响应体失败：${failureDetail(error)}` };
  }

  if (!response.ok) {
    return {
      handle,
      kind: response.status >= 500 ? 'unavailable' : 'bad_response',
      detail: `HTTP ${String(response.status)}：${text.slice(0, 200)}`,
    };
  }

  let body: { code?: unknown; msg?: unknown; data?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return { handle, kind: 'bad_response', detail: `响应不是 JSON（开头：${text.slice(0, 200)}）` };
  }

  const code = typeof body.code === 'number' ? body.code : null;
  if (code === CODE_ROOM_NOT_FOUND) {
    // "这个房间不存在" —— 一个确定的回答（文件头第三节那一行）
    return { handle, isLive: false, viewerCount: null };
  }
  if (code !== 0) {
    return {
      handle,
      kind: 'bad_response',
      detail: `code=${String(code ?? '(没有 code)')} msg=${String(body.msg ?? '')} ⇒ 这一行不写（这不是对"这个人"的回答）`,
    };
  }

  const data = body.data as { live_status?: unknown; online?: unknown } | null | undefined;
  if (data === null || typeof data !== 'object') {
    return { handle, kind: 'bad_response', detail: 'code=0 但 data 不是对象（上游形状变了）' };
  }

  const liveStatus = typeof data.live_status === 'number' ? data.live_status : null;
  if (liveStatus === null) {
    return { handle, kind: 'bad_response', detail: 'code=0 但 data.live_status 不是数字' };
  }

  const isLive = liveStatus === 1;
  return {
    handle,
    isLive,
    /*
     * ⚠️ 没在播时 `online` 恒为 0（实测），而那个 0 **不是**"0 人观看"——
     *    它是上游对"这个房间没开播"的填空值。⇒ 写 NULL（"上游没给人数"），
     *    而不是把那个 0 传下去。真实数字只在 `is_live = 1` 时有意义。
     */
    viewerCount:
      isLive && typeof data.online === 'number' && Number.isFinite(data.online)
        ? data.online
        : null,
  };
}

/**
 * 跑一批房间（顺序问，**每行各自成败**）。
 *
 * ⚠️ 顺序而不是并发：一轮最多 100 行、单次实测 ~50 ms ⇒ 正常一轮 5 秒以内，
 *    而顺序让"上游开始变慢"这件事在日志里表现为**预算用完 + skipped>0**，
 *    而不是一堆并发请求同时超时。代价：真到了几百行时一轮会顶到预算上限
 *    （那时该做的是分轮轮转，而不是在这里加并发 —— 那是另一件事）。
 */
export async function fetchBilibiliLiveRooms(
  handles: readonly string[],
  deps: BilibiliRoomsDeps = {},
): Promise<BilibiliOutcome> {
  const nowMs = deps.nowMs ?? Date.now;
  const maxRooms = deps.maxRooms ?? BILIBILI_MAX_ROOMS;
  const budgetMs = deps.budgetMs ?? BILIBILI_BUDGET_MS;

  const outcome: BilibiliOutcome = { answered: [], failures: [], skipped: 0 };
  const startedAt = nowMs();

  for (const handle of handles) {
    if (outcome.answered.length + outcome.failures.length >= maxRooms) {
      outcome.skipped += 1;
      continue;
    }
    if (nowMs() - startedAt >= budgetMs) {
      outcome.skipped += 1;
      continue;
    }

    const result = await fetchRoom(handle, deps);
    if ('isLive' in result) outcome.answered.push(result);
    else outcome.failures.push(result);
  }
  return outcome;
}
