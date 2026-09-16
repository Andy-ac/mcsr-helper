/**
 * Twitch 适配器（spec §5.3 / §5.4）—— 需要 `MCSR_TWITCH_ID` + `MCSR_TWITCH_SECRET`。
 *
 * ===========================================================================
 * 一、app access token：client credentials，**进程内缓存**
 * ===========================================================================
 * §5.3 逐字："app access token：client credentials，**进程内缓存**（有效期约 60 天，
 * 但按小时刷新足够）"。⇒ 两件事必须同时成立，缺一个都等于没缓存：
 *   1. **实例内**缓存 token（不是每次调用换一个）—— 见下面 `tokenPromise`；
 *   2. 注册表（`index.ts`）对同一套凭据**返回同一个实例** —— 因为 CLI 是**每个 creator**
 *      要一次 `deps.adapters(platform)`（`track.ts` 的 `runOnce` 就在循环里），
 *      每次都新建实例的话，20 个博主就是每轮 20 次换 token。
 *      ⚠️ 那一条在 `index.ts` 里（按凭据缓存实例），这里只负责"实例内只换一次"。
 * ⚠️ 缓存的是 **Promise** 而不是结果（照 `bilibili.ts` 的会话缓存）：两个管理员同时加博主时，
 *    "第一个请求还在路上、第二个请求也来了"是可能的，而 `if (token) return token` 那种写法
 *    会让它们各换一次 token —— 而换 token 本身也在上游的账上。
 * ⚠️ 缓存**失败**的结果也是同一份 Promise：一次失败的 token 请求不该被后面的每一个
 *    creator 立刻重打一次。反正 CLI 拿到 `PlatformHandshakeError` 就**放弃整个平台**了
 *    （§5.1），而下一轮是**新进程**（缓存跟着没了）⇒ 下一轮是干净的。
 *
 * ===========================================================================
 * 二、★★ 这个文件里最可疑的一格：`type=archive,highlight,upload`
 * ===========================================================================
 * §5.3 冻结的请求是 `Get Videos?user_id=<>&first=100&after=<cursor>&type=archive,highlight,upload`。
 * ⚠️ **Twitch 文档把 `type` 写成一个单值枚举**（`all` / `upload` / `archive` / `highlight`），
 *    而逗号分隔的列表**没有**文档依据。本机没有凭据、也没有网络，所以这一格
 *    **既没法验证、也没法证伪**。
 *
 * ⇒ 这里**照 §5.3 逐字实现**（"spec 与实测冲突时以 spec 为准"，而这次连实测都没有），
 *   并把**失败签名**与**一行修法**写在这里，好让第一个真跑的人不必从零开始查：
 *     · 失败签名：**每一个** `Get Videos` 都回 HTTP 400（`{"error":"Bad Request",…}`），
 *       于是 Twitch 这一轮**一个视频都抓不到**，而 bilibili 完全正常（平台各自独立失败）；
 *     · 一行修法：把 `TWITCH_VIDEO_TYPES` 改成 `'all'`（`all` 是这三类的并集，
 *       所以"抓全部"这个意图不变）。
 *     · ⚠️ 测试把这一格**钉住了**（`tracking-platforms.test.ts` 里那条 `type` 断言），
 *       所以改它是一个**会红**的改动，而不是一次静默偏移。
 * ⚠️ 取另一侧（直接写 `type=all`）的代价：偷偷改掉了 spec 冻结的一格，而如果
 *    逗号写法其实是被接受的，我们白白丢掉了一个"只抓这三类"的约束。
 *
 * ===========================================================================
 * 三、★ 失败分类（与 `youtube.ts` 那张表同一个形状）
 * ===========================================================================
 * | 情况                                        | 抛什么 | 处置 |
 * |---------------------------------------------|--------|------|
 * | 发不出去 / 20 秒超时                          | PlatformUnavailableError | 过一会儿再来 |
 * | HTTP 429 / 5xx                                | PlatformUnavailableError | 同上（429 的字面意思就是"退避重来"） |
 * | HTTP 401 / 403（token 不被接受、client id 不对）| PlatformHandshakeError   | **本轮放弃整个 Twitch** |
 * | token 那一步的任何失败 / 不是 JSON / 顶层形状漂移 | PlatformHandshakeError | 同上 |
 * | 单条坏了（缺 id / title）                     | TwitchRejectedError      | 这一个 creator 失败 |
 *
 * ★ 401 **不**在这里重试、也**不**清 token 缓存：CLI 拿到 `PlatformHandshakeError` 就
 *   放弃这个平台，而**下一次运行是一个新进程**（缓存跟着消失）⇒ 下一轮自然是干净的。
 *   代价（认下）：真出现"token 提前失效"时，这一轮整个 Twitch 不抓（10 分钟后恢复）。
 *
 * ===========================================================================
 * 四、★ 时间戳：RFC 3339 → **Unix 秒**（spec §4 那个 ★★ 块）
 * ===========================================================================
 * `created_at` 是 RFC 3339（`2018-11-14T21:30:18Z`），而本栏目两张表**一律 Unix 秒**。
 *
 * ⚠️ `rfc3339ToUnixSeconds` 与 `youtube.ts` 里那一份是**同一个规则的两份实现**
 *    （YouTube 给的是 ISO 8601、这里给的是 RFC 3339，形状一样、处置一样）。
 *    为什么是两份而不是搬进一个公共文件：本任务的文件表只有这两个适配器，
 *    而 `parse.ts` 是 T2 已经评审过的纯函数文件（把它的测试文件也拖进来是额外的改动面）。
 *    ⇒ **代价**：改一处要同时改另一处，而代码里没有任何东西会报错。
 *    ⚠️ 这个代价已经被一条断言抵掉了：`tracking-platforms.test.ts` 里
 *      「同一个时刻在两条路上必须是同一个秒数」把两份实现钉在一起 —— 漂了那一条会红。
 *      **别删那条断言**（它是这两份重复实现被允许存在的唯一理由）。
 *
 * ===========================================================================
 * 五、⚠️ 哪些是**文档**、哪些是**实测**（本文件没有一条来自真实响应）
 * ===========================================================================
 * 本机与本仓**一个凭据都没有**（spec §2.7 实测：`systemctl show` 里没有），
 * 所以下面每一处都是从官方文档抄下来的，**不是**一次真实调用的读数：
 *   · `POST https://id.twitch.tv/oauth2/token`（表单体里的 `client_id` / `client_secret` /
 *     `grant_type=client_credentials`）→ `access_token` / `expires_in`；
 *   · `Get Users?login=` → `data[0].id` / `login` / `display_name` / `profile_image_url`；
 *   · `Get Videos?user_id=&first=100&type=…` → `data[].id` / `title` / `created_at` /
 *     `duration`（`"1h2m3s"`，**不是秒数**）/ `view_count` / `thumbnail_url`（**模板**）/
 *     `type`（`archive` | `highlight` | `upload`）/ `pagination.cursor`；
 *   · 请求头 `Client-Id` + `Authorization: Bearer <token>`。
 * ⚠️ spec §2.6 那一整节自己标的就是**【文档】**（本仓从没量过 Twitch —— 一个凭据都没有），
 *    所以准确的说法是：**这个文件里连一条实测的字段名都没有**。
 *    唯一接近"实测"的是 spec §2.6 记下的速率限制形状（token bucket，800/分钟）与
 *    "app access token 即可、不需要用户登录"，而那两条同样是文档结论、本仓只是照抄。
 *    ⇒ **不许把本文件读成"跑通了"。**
 */

import type { TrackedCreator } from '@mcsr/shared';

import { parseTwitchDuration } from './parse';
import {
  type CreatorRef,
  type FetchedVideo,
  type FetchPage,
  InvalidCreatorInputError,
  type PlatformAdapter,
  PlatformHandshakeError,
  PlatformUnavailableError,
} from './types';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 换 token 的端点。⚠️ 客户端密钥走 **POST 表单体**，绝不进 URL（URL 会进日志与错误信息）。 */
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const HELIX_BASE = 'https://api.twitch.tv/helix';

/**
 * 每页条数。§5.3 冻结值 `first=100`，而 100 同时是文档上限（Get Videos 的 `first`）。
 */
export const TWITCH_PAGE_SIZE = 100;

/**
 * ★ §5.3 冻结的那一格 `type=`。⚠️ **读上面文件头第二节再看这一行** ——
 * 它是本文件里唯一一处"文档写着单值枚举、而我们送了一个列表"的地方，
 * 失败签名与一行修法都写在那里。
 */
export const TWITCH_VIDEO_TYPES = 'archive,highlight,upload';

/**
 * 封面的尺寸。Twitch 的 `thumbnail_url` 是**模板**（`…/thumb%{width}x%{height}.jpg`），
 * 占位符不换掉的话浏览器会把整串当路径 ⇒ 那张图 404（而界面上只是"没有图"）。
 * ⚠️ 320×180 与 YouTube 那边挑的 `medium` 是**同一个尺寸**，同一排卡片比例一致。
 */
const THUMBNAIL_WIDTH = '320';
const THUMBNAIL_HEIGHT = '180';

/** 单次请求的超时。照 `bilibili.ts` 那 20 秒。 */
const REQUEST_TIMEOUT_MS = 20_000;

/** 提前多久算"该换 token 了"。§5.3："有效期约 60 天，但**按小时刷新足够**"。 */
const TOKEN_REFRESH_MARGIN_MS = 3_600_000;

/**
 * `expires_in` 拿不到（或是个坏值）时按多久算。
 * ⚠️ 取一小时：假如真实的 TTL 更短，我们就会拿着过期 token 去撞 401 —— 那是**响亮**的
 *    （`PlatformHandshakeError` → 本轮放弃这个平台），而不是静默的错数据。
 */
const DEFAULT_TOKEN_TTL_MS = 3_600_000;

/**
 * login 的形状（2–25 个 `[A-Za-z0-9_]`）。
 *
 * ⚠️ 这条正则**故意松**：判断"这是不是一个真 login"的权威是 `Get Users`（上游回空 data
 *    就是"没有这个人"⇒ 400 让管理员改输入），而这条正则只负责两件事：
 *    把输入**发给谁**，以及挡掉一眼不对的形状（`twitch.tv/videos/123`、空白、乱码）。
 *    代价：一个乱写的词会白花一次上游请求（一次 `Get Users`，1 点配额），
 *    换的是"不用维护一份 Twitch 的用户名规则"。⚠️ 真出现比这更短的历史账号时，
 *    贴完整链接也过不来（同一条正则）—— 那时的修法是放开下限，代价是更宽的输入面。
 */
const LOGIN = /^[A-Za-z0-9_]{2,25}$/;

/** 时间戳末尾必须有的时区（`Z` 或 `±HH:MM`）。理由同 `youtube.ts`。 */
const TIMEZONE_SUFFIX = /(?:Z|[+-]\d{2}:\d{2})$/i;

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

/**
 * 上游回了一个我们**用不了**的回答，而这件事是**这一个 creator** 的事
 * （比如它的 Get Videos 回 400/404、某一条 item 缺 id）。
 * 与 `youtube.ts` 那个同名错误同一条理由（含"为什么不加 `retryable`/`code`"）。
 */
export class TwitchRejectedError extends Error {
  /** **没加平台前缀**的原文（`resolveCreator` 那里要把它贴成平台级）。 */
  readonly detail: string;

  constructor(detail: string) {
    super(`twitch: ${detail}`);
    this.name = 'TwitchRejectedError';
    this.detail = detail;
  }
}

// ---------------------------------------------------------------------------
// 响应体读取与两个纯函数
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  const text = asString(value);
  return text === null || text.trim() === '' ? null : text;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * RFC 3339 → Unix **秒**（`null` = 没有可用的时间）。
 *
 * ⚠️ 与 `youtube.ts` 里那一份是同一个规则的两份实现 —— 理由、代价与"哪条断言钉着它"
 *    写在文件头第四节。
 * ⚠️ **必须带时区**：`Date.parse('2018-11-14T21:30:18')`（没有 `Z`）在 JS 里是
 *    **本地时间**，而这台机器是 +08:00 ⇒ 存进去的值静默偏 8 小时，
 *    而 `published_at` 是公开列表的排序键（顺序看着全对）。
 * ⚠️ `0` / 负数当成"没量到"（照 `bilibili.ts:1021` 那条裁决：1970 年看起来像一条真实数据）。
 */
function rfc3339ToUnixSeconds(raw: string | null): number | null {
  if (raw === null) return null;
  const text = raw.trim();
  if (!TIMEZONE_SUFFIX.test(text)) return null;
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return null;
  const sec = Math.floor(ms / 1000);
  return sec <= 0 ? null : sec;
}

/** 封面模板的占位符换掉（两个都换：`replaceAll` 是因为上游的模板里可能各出现不止一次）。 */
function fillThumbnailTemplate(url: string | null): string | null {
  if (url === null) return null;
  return url.replaceAll('%{width}', THUMBNAIL_WIDTH).replaceAll('%{height}', THUMBNAIL_HEIGHT);
}

/** 把 `fetch` 的**拒绝**翻译成一句能进日志的话（照 `bilibili.ts` 那一份）。 */
function failureDetail(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    return `(读响应体失败：${error instanceof Error ? error.message : String(error)})`;
  }
}

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Twitch 的错误体 → 一句能进日志的话（`{"error":"Unauthorized","status":401,"message":"…"}`）。
 * ⚠️ 永远**不带 URL、也不带请求体**：换 token 的那个请求体里有 `client_secret`，
 *    而这句话会进 `last_error`（管理面板上给编辑看）与 journal。
 */
function twitchErrorDetail(text: string): string {
  const body = asRecord(parseJsonOrNull(text));
  if (body === null) return text.trim() === '' ? '（响应体是空的）' : `：${text.slice(0, 200)}`;
  const error = asNonEmptyString(body.error);
  const message = asNonEmptyString(body.message);
  const parts = [
    error === null ? null : `error=${error}`,
    message === null ? null : `message=${message}`,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? '：' + text.slice(0, 200) : `：${parts.join(' ')}`;
}

// ---------------------------------------------------------------------------
// 适配器
// ---------------------------------------------------------------------------

/** 换回来的 token 与它什么时候过期（**毫秒**，因为它是我们自己的记账值）。 */
interface TwitchToken {
  value: string;
  expiresAtMs: number;
}

export interface TwitchAdapterDeps {
  /** `MCSR_TWITCH_ID`。 */
  clientId: string;
  /** `MCSR_TWITCH_SECRET`。⚠️ 只出现在换 token 的 POST 体里，别处一次都不许出现。 */
  clientSecret: string;
  /** 注入假实现，测试里**绝不打真网络**。 */
  fetchImpl?: typeof fetch;
  /**
   * 注入假时钟（**毫秒**）。默认 `Date.now`。
   * ⚠️ 它存在的唯一理由是 token 过期那一支：没有它，那个分支只能靠真等一小时 ⇒
   *    永远没有人测它，而"缓存永远不过期"与"按小时刷新"在测试里就分不开了。
   */
  now?: () => number;
}

export function createTwitchAdapter(deps: TwitchAdapterDeps): PlatformAdapter {
  const clientId = deps.clientId;
  const clientSecret = deps.clientSecret;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowMs = deps.now ?? Date.now;

  /*
   * token 缓存（理由见文件头第一节）。⚠️ `expiresAtMs` 是**响应回来之后**才回填的
   * （TTL 就在响应体里）⇒ 它必须是可变的，所以这里不是一个纯 `const`。
   */
  let tokenPromise: Promise<TwitchToken> | null = null;
  let tokenExpiresAtMs = 0;

  /**
   * 拿 app access token（client credentials）。过期（或快过期）才真的去换。
   *
   * ⚠️ 刷新的余量最多吃掉 TTL 的一半（`Math.min`）：上游真给一个很短的 TTL 时，
   *    "提前一小时刷新"会让**每一次调用**都重新换 token —— 那是一个自造的限流，
   *    而它是这一层唯一会因为"慷慨"而变慢的地方。
   */
  async function appToken(): Promise<string> {
    const current = tokenPromise;
    if (current !== null && nowMs() < tokenExpiresAtMs) {
      return (await current).value;
    }

    /*
     * ★ 顺序就是规则：**先把 Promise 挂上去，再 await 它**（缓存的是 Promise 而不是结果，
     *   照 `bilibili.ts` 的会话缓存）。两件事同时由这三行保证：
     *   · 并发来的第二个调用拿到的是同一个 Promise ⇒ 不会各换一次 token；
     *   · **失败也留在那里**（异常照样从下面抛出去，但 `tokenPromise` 不清空）——
     *     一次失败的换 token 请求不该被后面的每一个 creator 立刻重打一次。
     *     它会在那个临时 TTL 到点之后才被替换掉。
     *     ⚠️ 而 CLI 拿到 `PlatformHandshakeError` 就**放弃整个平台**了（§5.1），
     *     所以"留着"在这里的代价几乎不存在。
     */
    const promise = fetchAppToken();
    tokenPromise = promise;
    // 临时 TTL（1 小时）：真正的 `expires_in` 要等响应回来才知道，下一行回填它。
    tokenExpiresAtMs = nowMs() + DEFAULT_TOKEN_TTL_MS;

    const fresh = await promise;
    tokenExpiresAtMs = fresh.expiresAtMs;
    return fresh.value;
  }

  /** 真的去换一次 token。**任何**失败都是 `PlatformHandshakeError`（见文件头第三节）。 */
  async function fetchAppToken(): Promise<TwitchToken> {
    const form = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    });

    let response: Response;
    try {
      response = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new PlatformUnavailableError('twitch', 'oauth2/token', failureDetail(error), {
        cause: error,
      });
    }

    const text = await safeText(response);
    if (!response.ok) {
      /*
       * ★ 这里**没有**"creator 级"的档位：token 拿不到 ⇒ 同一个客户端下的每一个 creator
       *   都会在同一个地方失败（§5.1 那句"不能带着空 cookie 继续打"的同一条）。
       */
      throw new PlatformHandshakeError(
        'twitch',
        'oauth2/token',
        `HTTP ${String(response.status)}${twitchErrorDetail(text)}（换不到 app access token —— 本轮放弃整个 Twitch，不在这里重试）`,
      );
    }

    const body = asRecord(parseJsonOrNull(text));
    const value = asNonEmptyString(body?.access_token);
    if (value === null) {
      throw new PlatformHandshakeError(
        'twitch',
        'oauth2/token',
        '响应里没有 access_token（上游的字段形状变了）',
      );
    }

    const expiresInSec = asNumber(body?.expires_in);
    const ttlMs =
      expiresInSec === null || expiresInSec <= 0 ? DEFAULT_TOKEN_TTL_MS : expiresInSec * 1000;
    const marginMs = Math.min(TOKEN_REFRESH_MARGIN_MS, Math.floor(ttlMs / 2));
    return { value, expiresAtMs: nowMs() + ttlMs - marginMs };
  }

  /**
   * 发一个 helix GET 并读出 JSON —— helix 这一层的失败分类只在这一个地方。
   *
   * ⚠️ 请求头逐字用文档里的那两格（`Client-Id` / `Authorization`）。头名本来不区分大小写，
   *    但"与文档逐字一致"省掉了下一个人去核对的一次。
   */
  async function helixJson(
    path: string,
    params: Record<string, string>,
    step: string,
  ): Promise<unknown> {
    const token = await appToken();
    const url = `${HELIX_BASE}/${path}?${new URLSearchParams(params).toString()}`;

    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: {
          'Client-Id': clientId,
          Authorization: `Bearer ${token}`,
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new PlatformUnavailableError('twitch', step, failureDetail(error), { cause: error });
    }

    const text = await safeText(response);
    if (!response.ok) {
      const detail = `${step} 回 HTTP ${String(response.status)}${twitchErrorDetail(text)}`;
      if (response.status === 401 || response.status === 403) {
        throw new PlatformHandshakeError(
          'twitch',
          step,
          `${detail}（凭据不被接受 —— 本轮放弃整个平台；下一轮是新进程，token 缓存跟着重来）`,
        );
      }
      if (response.status === 429 || response.status >= 500) {
        throw new PlatformUnavailableError(
          'twitch',
          step,
          `${detail}（过一会儿再来：本适配器不在这里重试，下一轮是 10 分钟后）`,
        );
      }
      throw new TwitchRejectedError(`${detail}：${text.slice(0, 200)}`);
    }

    const body = parseJsonOrNull(text);
    if (body === null) {
      throw new PlatformHandshakeError(
        'twitch',
        step,
        `响应不是 JSON（响应开头：${text.slice(0, 200)}）—— 当成空列表就会静默少存一整页`,
      );
    }
    return body;
  }

  /** 顶层容器不是我们认得的形状 ⇒ **平台级**（每一个 creator 都会撞上同一件事）。 */
  function requireData(body: unknown, step: string): unknown[] {
    const data = asRecord(body)?.data;
    if (!Array.isArray(data)) {
      throw new PlatformHandshakeError(
        'twitch',
        step,
        'data 不是数组（上游的字段形状变了）—— 当成空列表就会静默少存一整页',
      );
    }
    return data;
  }

  /**
   * 管理员那串东西 → login（§5.3：`twitch.tv/<login>`）。
   *
   * ⚠️ 只认**单段**路径：`twitch.tv/videos/335921245`、`twitch.tv/directory/game/…`
   *    都是两段以上 ⇒ 认不出（回一句"那不是频道链接"，管理员当场能改）。
   *    这比"取第一段当 login"好：后者的表现是拿 `videos` 去问上游，
   *    得到的空 data 被读成"这个人不存在" —— 一句**指向错误方向**的话。
   * ⚠️ 裸的 login 字符串也收（"链接或标识"，与 bilibili 收纯数字 mid 同形）。
   *    代价：它**穿过 HTTP 路由时到不了这里** —— `routes/tracking.ts` 的 `platformOfInput`
   *    只按 host 与 `@handle` 分发，一个光秃秃的 login 会被判成"认不出是哪个平台"。
   *    ⇒ 管理面板上必须贴 `twitch.tv/<login>`；这条收窄在**那个文件**里（本任务没改它），
   *      所以这里留着裸 login 的支持，并把这件事写在报告里。
   */
  function parseLoginInput(input: string): string | null {
    if (LOGIN.test(input)) return input;

    let url: URL;
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
    } catch {
      return null;
    }

    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    if (host !== 'twitch.tv' && host !== 'm.twitch.tv') return null;

    const segments = url.pathname.split('/').filter(Boolean);
    const login = segments[0];
    if (segments.length !== 1 || login === undefined || !LOGIN.test(login)) return null;
    return login;
  }

  /**
   * `twitch.tv/<login>` → `Get Users?login=` → user id + 显示名 + 头像（§5.3）。
   *
   * ⚠️ 失败分类在这里收成**三种**（路由那张表里都认得）—— 理由与代价见 `youtube.ts`
   *    文件头第四节（两边是同一件事）。
   */
  async function resolveCreator(rawInput: string): Promise<CreatorRef> {
    const input = rawInput.trim();
    if (!input) {
      throw new InvalidCreatorInputError('twitch', rawInput, '是空字符串');
    }

    const login = parseLoginInput(input);
    if (login === null) {
      throw new InvalidCreatorInputError(
        'twitch',
        input,
        '只认 twitch.tv/<login> 或一个 login（twitch.tv/videos/<id>、/directory/… 都不是频道）',
      );
    }

    try {
      const body = await helixJson('users', { login }, 'Get Users');
      const data = requireData(body, 'Get Users');
      if (data.length === 0) {
        // ★ 上游说"没有这个 login" ⇒ 入参的问题（400），不是 502（与 YouTube 空 items 同一条）。
        throw new InvalidCreatorInputError('twitch', input, `上游没有 login=${login} 这个用户`);
      }

      const user = asRecord(data[0]);
      const id = asNonEmptyString(user?.id);
      if (id === null) {
        throw new PlatformHandshakeError(
          'twitch',
          'Get Users',
          'data[0] 没有 id（上游的字段形状变了）',
        );
      }

      const displayName = asNonEmptyString(user?.display_name);
      return {
        platform: 'twitch',
        // §4.1：external_id 存 Twitch user id（而 Get Videos 也按 user_id 查 —— 两处同一个值）。
        externalId: id,
        handle: asNonEmptyString(user?.login) ?? login,
        /*
         * ⚠️ `display_name` 缺失时回落到 login：`display_name` 在库里是 `NOT NULL`，
         *    而空名字在面板上既不是名字、也看不出是占位（bilibili 那条裁决的同一件事）。
         */
        displayName: displayName ?? login,
        avatarUrl: asNonEmptyString(user?.profile_image_url),
        /*
         * ⚠️ **不填** `platformMeta`：Twitch 没有需要跨轮记住的东西 ——
         *    `Get Videos` 要的 `user_id` 已经落在 `external_id` 上，翻页游标有自己的列
         *    （`last_cursor`）。空填的话 `platform_meta` 会存一个 `{}`，
         *    而那一列"有值"与"没有"是两个状态（`storedPlatformMeta` 的注释写着这件事）。
         */
      };
    } catch (error) {
      if (error instanceof TwitchRejectedError) {
        throw new PlatformHandshakeError('twitch', 'Get Users', error.detail, { cause: error });
      }
      throw error;
    }
  }

  /**
   * `Get Videos` 一条 → `FetchedVideo`（§5.3 的字段映射）。
   *
   * ⚠️ 缺 `id` / `title` 就抛（与 `bilibili.ts` 的 `vlist[i]`、`youtube.ts` 的
   *    `playlistItems.items[i]` 同一条纪律：空 id 会让下面每一支覆盖同一行，
   *    而"跳过这一条"是静默少一支视频）。
   */
  function toFetchedVideo(raw: unknown, index: number): FetchedVideo {
    const item = asRecord(raw);
    const externalId = asNonEmptyString(item?.id);
    const title = asString(item?.title);

    if (externalId === null || title === null) {
      throw new TwitchRejectedError(
        `Get Videos 的 data[${String(index)}] 的 ${externalId === null ? 'id' : 'title'} 不是字符串（上游的字段形状变了）—— 跳过它会静默少一支视频`,
      );
    }

    return {
      externalId,
      title,
      thumbnailUrl: fillThumbnailTemplate(asNonEmptyString(item?.thumbnail_url)),
      // ★ RFC 3339 → Unix **秒**（spec §4 的 ★★ 块）。
      publishedAt: rfc3339ToUnixSeconds(asNonEmptyString(item?.created_at)),
      // ★ Task 2 的纯函数（`'1h2m3s'` → 3723、`'0s'` → null），不自己解析。
      durationSec: parseTwitchDuration(asString(item?.duration)),
      viewCount: asNumber(item?.view_count),
      /*
       * ⚠️ 恒为 `null`：`Get Videos` 的响应里**没有**评论数（§2.6 的字段清单里就没有）。
       *    库里那一列是可空的，而填 0 会让"没人评论"与"上游没给"在界面上长得一样。
       */
      commentCount: null,
      // ★ §5.3 逐字：`type === 'archive'` ⇒ 一场直播的存档。
      isLiveReplay: asNonEmptyString(item?.type) === 'archive',
    };
  }

  /**
   * 抓一页 `Get Videos`（§5.3）。
   *
   * ⚠️ `_ctx.storedTotal` **不读**：§5.4 说 Twitch 的"到底了"只看 `pagination.cursor`
   *    （"语义可靠"），所以那个参数在这里没有用武之地（参数照契约留着）。
   */
  async function fetchPage(
    creator: TrackedCreator,
    cursor: string | null,
    _ctx: { storedTotal: number },
  ): Promise<FetchPage> {
    const body = await helixJson(
      'videos',
      {
        // §5.3：按 user_id 查（`user_login` 这个参数已经不在文档里了）。
        user_id: creator.externalId,
        first: String(TWITCH_PAGE_SIZE),
        type: TWITCH_VIDEO_TYPES,
        ...(cursor === null ? {} : { after: cursor }),
      },
      'Get Videos',
    );

    const videos = requireData(body, 'Get Videos').map((raw, index) => toFetchedVideo(raw, index));

    /*
     * ★★ §5.4 逐字：**`pagination.cursor` 缺失即到底**（"语义可靠"）。
     *    · 这里**不**看"这一页是不是空的"（bilibili 那个坑的判据不属于这个平台）；
     *    · 也**不**看我们库里存了多少条（那是 bilibili 的判据的一半）。
     *    ⚠️ 残余风险（写下来）：上游真在最后一页仍回一个游标的可能性没有文档保证不存在，
     *      那时的代价是**多翻一页空页**（`limits.pages` 兜底），而不是丢数据。
     */
    const nextCursor = asNonEmptyString(asRecord(asRecord(body)?.pagination)?.cursor);
    const reachedEnd = nextCursor === null;

    return { videos, nextCursor: reachedEnd ? null : nextCursor, reachedEnd };
  }

  return { resolveCreator, fetchPage };
}
