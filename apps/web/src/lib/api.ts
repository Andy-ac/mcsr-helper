/**
 * 前端 API 客户端。
 *
 * **始终请求相对路径 `/api/*`**：
 *   - 开发时由 Vite 的 proxy 转到 http://127.0.0.1:3001
 *   - 生产时由 Caddy 反向代理到本机的 API 进程
 * 这样同一份代码在浏览器、Electron（加载 localhost）和 Electron（加载线上域名）
 * 三种场景下行为完全一致，不需要任何环境判断。
 */

// ⚠️ VideoPlatform 从根导入：`@mcsr/shared/videos` 用它但**没有重新导出**它
//    （它住在 constants.ts），而 package.json 的 exports 里没有 "./constants"。
import type { VideoPlatform } from '@mcsr/shared';
import type { UserSelf } from '@mcsr/shared/auth';
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarSeries,
  CalendarSeriesInput,
  CalendarSeriesList,
} from '@mcsr/shared/calendar';
import type {
  LiveChannel,
  LiveChannelInput,
  UserLiveLink,
  UserLiveLinkInput,
  UserLiveLinkPatch,
} from '@mcsr/shared/live';
import type { UserRole } from '@mcsr/shared/permissions';
import type {
  FavoriteItem,
  MarksInput,
  MySubmission,
  ResourceDetail,
  ResourceListResponse,
  ResourceMarks,
  ResourceQuery,
  ResourceSubmission,
  UploadResponse,
} from '@mcsr/shared/resources';
import type { QueueItem, ReviewableType, ReviewDetail } from '@mcsr/shared/review';
import type {
  SeedCreateInput,
  SeedFilters,
  SeedInfo,
  SeedQueryResult,
  SeedRecord,
} from '@mcsr/shared/seed';
import type { Video, VideoInput } from '@mcsr/shared/videos';

export interface HealthResponse {
  status: 'ok';
  service: string;
  version: string;
  time: string;
}

/** 字段级校验错误。服务端把 Zod 的 issues 整理过之后就是这个形状。 */
export interface FieldIssue {
  field: string;
  message: string;
}

/**
 * 带上状态码的错误，让界面能区分"没找到"和"服务挂了"。
 *
 * `code` 是服务端返回的错误代码（`invalid_credentials`、`rate_limited`…）。
 * 界面靠它选文案，而**不靠匹配 message 文本** —— 后者一改文案就悄悄失效，
 * 而且是那种"测试全绿、线上文案变成英文"的失效。
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    /** 被限流时还要等多少秒（来自 Retry-After 响应头）。 */
    readonly retryAfterSec?: number,
    /** 字段级校验错误。 */
    readonly issues?: FieldIssue[],
    /**
     * 「这个链接已经收录过了」时，服务端会附上已有条目的 id。
     *
     * 带上它是因为这是个**可操作**的错误：用户真正想做的是去看那一条，
     * 而不是重新填一遍。只给一句"已存在"的话，他只能自己回列表里翻。
     */
    /**
     * 「这个链接已经收录过了」时服务端附带的上下文。
     *
     * ⚠️ 三个字段缺一不可，因为它们区分的是**三种下一步完全不同**的情况：
     *   · `existingStatus === 'published'` → 站上真的有这条，去看它
     *   · `existingMine && 非 published`   → 是我自己那条没上架的，去改它
     *   · 其它                             → 别人没上架的条目，什么都不能说
     * 只给一个 id 的话，前端就得自己猜是哪一种 —— 而"猜"就是第二份规则。
     */
    readonly existingId?: string,
    readonly existingTitle?: string,
    readonly existingStatus?: string,
    readonly existingMine?: boolean,
    /**
     * 字段级失败的**机器可读原因**（Ranked Seeds 专用）。
     *
     * ⚠️ 它是错误码下面**第二层**的跨层契约，和 `code` 是两件事：
     *   · `code`   = `invalid_input`（15 种入参错误共用一个码）
     *   · `reason` = `bad_overworld` / `end_spawn_unsupported` / …
     * 种子表单有六个字段，而"整张表下面显示一句通用错误"等于让用户自己找。
     * 界面靠 reason 把红字放到**对应的那个控件**下面。
     *
     * 服务端的 reason 清单在 `services/api/src/error-codes.test.ts` 的
     * `SEED_REASONS` 里，有测试守着（"服务端返回的每个 reason 都在清单里"）。
     * 所以这里不需要再做一层白名单 —— 多一层就多一份会漂移的规则。
     */
    readonly reason?: string,
    /**
     * 400 里按 reason 变化的那几个**结构化**字段。
     *
     * 收成一个对象而不是继续往上面加位置参数：这个构造器已经有 10 个位置参数了，
     * 再排 5 个进去，调用方迟早会把 `min` 和 `maxMs` 写反 —— 而两个都是 number，
     * 类型检查拦不住。而且这 5 个的取值**只由 reason 决定**，是一组、不是零散几个。
     *
     * ⚠️ 它们以 getter 的形式暴露在实例上（见下面的 min / allowed / …），
     *    因为 `lib/seedErrors.ts` 的 `apiExtra(error, 'min')` 读的是**顶层属性**。
     *    这样两边都不用改成对方的形状。
     */
    readonly extra?: ApiExtra,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /**
   * 这几条是 `apiExtra()` 真正会读的键。
   * 服务端那边的取值清单见 `routes/seeds.ts`，前端侧的映射见 `lib/seedErrors.ts`。
   */
  /** `bad_match_id`：该端点要求的 matchId 下界（两个端点不同） */
  get min(): number | undefined {
    return this.extra?.min;
  }
  /** `bad_overworld` / `bad_nether`：合法取值。界面可以直接渲染成选项 */
  get allowed(): string[] | undefined {
    return this.extra?.allowed;
  }
  /** `bad_completion`：完赛时间的上限（毫秒） */
  get maxMs(): number | undefined {
    return this.extra?.maxMs;
  }
  /** `use_search_endpoint`：被拒的参数名 */
  get param(): string | undefined {
    return this.extra?.param;
  }
  /** `use_search_endpoint`：应该改用哪个端点 */
  get use(): string | undefined {
    return this.extra?.use;
  }
}

/**
 * 400 `invalid_input` 里附带的结构化字段。
 *
 * ⚠️ 它们**不是**可选的可有可无的装饰：每一个都在替前端省掉一份**会漂移的常量**。
 *    比如 `min` 读不到时，界面只能用本地复制的一份 `MIN_MATCH_ID` ——
 *    而那个数字在服务端有两个（`/match` 和 `/match/:id/info` 的下界不同），
 *    复制的那一份迟早会和服务端对不上，表现是"明明存在的比赛查不到"。
 */
export interface ApiExtra {
  min?: number;
  allowed?: string[];
  maxMs?: number;
  param?: string;
  use?: string;
}

/*
 * `cache` 的来历（只在**编辑自己**那条路上会传值，匿名访客一律走默认）：
 *
 *   几个公开列表端点带 `public, max-age=60, stale-while-revalidate=300`
 *   —— 匿名访客应当吃这个缓存。但同一个 URL 在**编辑自己的浏览器里**也存了一份，
 *   于是编辑隐藏/删除一条之后界面去"刷新公开列表"，拿到的却是最多 60 秒前的
 *   那份旧响应。表现是"我明明隐藏了，公开列表里怎么还有"；他会再点一次
 *   （还是旧的），最后以为界面坏了。见 `fetchLiveChannelsFresh`。
 *
 *   默认 `undefined` = 交给浏览器按响应头决定，和加这个参数之前完全一样。
 */
async function request<T>(path: string, signal?: AbortSignal, cache?: RequestCache): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { headers: { accept: 'application/json' }, signal, cache });
  } catch (error) {
    // abort 是我方主动取消，不应该显示成错误
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('连不上 API —— 本地开发时后端可能没启动。用 pnpm dev 或 pnpm dev:web', 0);
  }

  if (!res.ok) {
    // 502/500 在本地开发里几乎总是"API 进程没起来"：Vite 的代理转发失败就是这个状态码。
    // 直接把这个猜测写进错误里，省得每次都要重新推一遍。
    const hint =
      res.status >= 500
        ? ' —— 本地开发时后端没启动？用 pnpm dev 或 pnpm dev:web，它们会一起启动 API'
        : '';
    throw new ApiError(`API 返回 HTTP ${res.status}${hint}`, res.status);
  }

  return (await res.json()) as T;
}

export function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return request<HealthResponse>('/api/health', signal);
}

/** 把查询条件拼成 query string。空值一律省略，避免产生 `?kind=&lang=&tag=` 这种噪音。 */
export function buildResourceQuery(query: Partial<ResourceQuery>, includeHidden = false): string {
  const params = new URLSearchParams();
  if (query.kind) params.set('kind', query.kind);
  if (query.lang) params.set('lang', query.lang);
  if (query.tag) params.set('tag', query.tag);
  if (query.q) params.set('q', query.q);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  // ⚠️ 这只是"我想看已下架的内容"。服务端会按能力决定给不给 —— 客户端说了不算。
  if (includeHidden) params.set('includeHidden', '1');
  const s = params.toString();
  return s ? `?${s}` : '';
}

/**
 * 资源列表。**公开**（`includeHidden` 那条除外，它要 `resource.moderate`）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ `includeHidden` 为真时**绕开浏览器缓存** —— 这不是顺手加的
 * ---------------------------------------------------------------------------
 * `/api/resources` 带 `public, max-age=60`（见 `routes/resources.ts` 的
 * PUBLIC_CACHE）。访客吃缓存是对的。但治理者点「下架」之后，页面重新拉
 * 列表，命中的是 60 秒内的旧响应 —— 那条**还在列表里**，于是他看到
 * "我明明下架了它怎么还在"，再点一次还是旧的。服务端一直是对的。
 *
 * 判据直接绑在 `includeHidden` 上，不另开一个参数：能传 `includeHidden`
 * 的就只有"看得见下架开关"的治理者（`ResourceList.tsx` 里 `showHidden`
 * 只在 `resource.moderate` 下出现），而**正是这条路**需要新鲜数据。
 * 访客那条路连 `includeHidden` 都是 false，依旧吃那 60 秒缓存。
 */
export function fetchResources(
  query: Partial<ResourceQuery>,
  signal?: AbortSignal,
  includeHidden = false,
): Promise<ResourceListResponse> {
  return request<ResourceListResponse>(
    `/api/resources${buildResourceQuery(query, includeHidden)}`,
    signal,
    includeHidden ? 'no-store' : undefined,
  );
}

export function fetchResource(id: string, signal?: AbortSignal): Promise<ResourceDetail> {
  return request<ResourceDetail>(`/api/resources/${encodeURIComponent(id)}`, signal);
}

export interface TagCount {
  tag: string;
  count: number;
}

export function fetchTags(signal?: AbortSignal): Promise<{ tags: TagCount[] }> {
  return request<{ tags: TagCount[] }>('/api/resources/tags', signal);
}

// ---------------------------------------------------------------------------
// 账号
// ---------------------------------------------------------------------------

interface ErrorPayload {
  error?: string;
  retryAfterSec?: number;
  issues?: FieldIssue[];
  /**
   * 字段级失败的机器可读原因（Ranked Seeds）。
   * ⚠️ 漏了这一个字段，种子表单就只能把六个字段的错误全堆在表单底部 ——
   *    而用户看到的是"出错了"，完全不知道是哪个输入框的问题。
   */
  reason?: string;
  /**
   * 400 里按 reason 变化的结构化字段。它们和服务端响应体里那几项**同名**，
   * 所以这里只要显式列出来，`sendJson` 就能一并交给 ApiError。
   */
  min?: number;
  allowed?: string[];
  maxMs?: number;
  param?: string;
  use?: string;
  existingId?: string;
  existingTitle?: string;
  existingStatus?: string;
  existingMine?: boolean;
}

/**
 * 发一个带 JSON body 的请求。
 *
 * ⚠️ 这里**必须**把服务端的错误信息读出来，不能像 GET 那样只看状态码。
 * 注册/登录的失败有好几种，界面要给出不同的提示：
 *   · 401 invalid_credentials → "邮箱或密码不对"
 *   · 429 rate_limited        → "请等 N 秒后再试"（N 来自 Retry-After）
 *   · 400 invalid_input       → 逐字段显示校验错误
 *   · 502 send_failed         → "邮件发送失败"
 * 全都笼统地报"出错了"，用户就完全不知道下一步该做什么。
 *
 * 关于 cookie：请求是**同源**的（开发时 Vite 代理，生产时 Caddy 代理），
 * 所以 fetch 默认的 credentials:'same-origin' 就会带上会话 cookie，
 * 不需要显式设置。
 */
async function sendJson<T>(
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('连不上 API —— 本地开发时后端可能没启动。用 pnpm dev 或 pnpm dev:web', 0);
  }

  // 错误响应也应该是 JSON，但不是所有失败都保证有 body（502 来自反代时就没有）
  const payload = (await res.json().catch(() => null)) as (T & ErrorPayload) | null;

  if (!res.ok) {
    const headerRetry = Number(res.headers.get('retry-after') ?? '') || undefined;
    throw new ApiError(
      `API 返回 HTTP ${res.status}`,
      res.status,
      payload?.error,
      payload?.retryAfterSec ?? headerRetry,
      payload?.issues,
      payload?.existingId,
      payload?.existingTitle,
      payload?.existingStatus,
      payload?.existingMine,
      payload?.reason,
      /*
       * ⚠️ 只挑出这几个**已知**的键，不是把整个 payload 摊进 extra。
       *    摊进去的话，服务端哪天多回一个 `message` 或 `error` 就会被当成
       *    "额外字段"传下去，而前端读 `error.error` 这种事谁也想不到要防。
       */
      {
        min: payload?.min,
        allowed: payload?.allowed,
        maxMs: payload?.maxMs,
        param: payload?.param,
        use: payload?.use,
      },
    );
  }

  return payload as T;
}

/** 当前登录用户。未登录时 `user` 是 null（不是错误）。 */
export function fetchMe(signal?: AbortSignal): Promise<{ user: UserSelf | null }> {
  return request<{ user: UserSelf | null }>('/api/auth/me', signal);
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  locale: 'zh-CN' | 'en';
}

/**
 * 注册。
 *
 * 返回值里**没有 user**，也不会下发会话 cookie —— 注册不自动登录，
 * 而且无论邮箱是否已注册，响应都完全一致（见 services/api/src/routes/auth.ts）。
 * 所以界面拿到这个响应之后只能显示一句中性的话，不能假装"注册成功"。
 */
export function register(input: RegisterInput): Promise<{ ok: true; message: string }> {
  return sendJson('POST', '/api/auth/register', input);
}

export function login(email: string, password: string): Promise<{ user: UserSelf }> {
  return sendJson('POST', '/api/auth/login', { email, password });
}

export function logout(): Promise<{ ok: true }> {
  return sendJson('POST', '/api/auth/logout');
}

export function sendVerifyEmail(): Promise<{ ok: true; alreadyVerified?: boolean }> {
  return sendJson('POST', '/api/auth/verify/send');
}

/**
 * 重发验证邮件 —— **不需要登录**。
 *
 * ⚠️ 它是"未验证就登不进来"这条策略的**配套出口**：
 *    登不进来的人用不了那条要登录的重发接口，
 *    所以必须有一条不需要登录的路，否则一封没送达的信就把人永久挡在门外。
 *
 * 响应与"这个邮箱注册过没有"完全无关（服务端刻意如此），
 * 所以界面只能显示一句中性的话，不能假装"已经发出去了"。
 */
export function resendVerification(email: string): Promise<{ ok: true; message: string }> {
  return sendJson('POST', '/api/auth/verify/resend', { email });
}

export function verifyEmail(token: string): Promise<{ ok: true; user: UserSelf | null }> {
  return sendJson('POST', '/api/auth/verify', { token });
}

export function requestPasswordReset(email: string): Promise<{ ok: true; message: string }> {
  return sendJson('POST', '/api/auth/reset/request', { email });
}

export function confirmPasswordReset(token: string, password: string): Promise<{ ok: true }> {
  return sendJson('POST', '/api/auth/reset/confirm', { token, password });
}

// ---------------------------------------------------------------------------
// 提交内容（M2）
// ---------------------------------------------------------------------------

/**
 * 提交/编辑的结果。
 *
 * `revision` 是这次提交产生的版本号 —— 界面拿它显示"这是第 2 次提交"，
 * 出问题时也是唯一能和服务端对上号的东西。
 */
export interface SubmissionResult {
  ok: true;
  id: string;
  revision: number;
  status: string;
  isEdit: boolean;
  /** 编辑已发布条目时，服务端明确告知**线上版本一个字都没变** */
  liveRevisionUnchanged?: boolean;
  /** 409 时服务端会说"这个链接已经收录过了"，并附上已有条目的 id */
  existingId?: string;
}

export function submitResource(input: ResourceSubmission): Promise<SubmissionResult> {
  return sendJson('POST', '/api/resources', input);
}

export function updateResource(id: string, input: ResourceSubmission): Promise<SubmissionResult> {
  return sendJson('PATCH', `/api/resources/${encodeURIComponent(id)}`, input);
}

/**
 * 我的提交。
 *
 * ⚠️ 它和 `/api/resources` 是**两个不同的东西**：公开列表只返回已发布的内容，
 *    而这个要包含待审和被驳回的条目 —— 恰恰是作者最需要看到的那些。
 *    所以返回的类型是 MySubmission，不能拿 ResourceListItem 顶替。
 */
export function fetchMySubmissions(signal?: AbortSignal): Promise<{ items: MySubmission[] }> {
  return request<{ items: MySubmission[] }>('/api/resources/mine', signal);
}

/**
 * 读一条条目**用来编辑**的完整内容（含还没上架 / 被驳回的）。
 *
 * 权限在服务端判：作者本人、或者有 `resource.editUnpublished` 的人
 * （editor / admin）能拿到；其它人 404。
 *
 * ⚠️ 编辑页**先试它、再退回公开接口**：
 *    · 作者自己的草稿 → 只有这个接口拿得到；
 *    · 别人已上架的条目（wiki 式编辑）→ 这个接口 404，公开接口拿得到。
 */
export function fetchResourceForEdit(id: string, signal?: AbortSignal): Promise<ResourceDetail> {
  return request<ResourceDetail>(`/api/resources/${encodeURIComponent(id)}/edit`, signal);
}

// ---------------------------------------------------------------------------
// 个人标记：收藏 / 备注 / 评分
// ---------------------------------------------------------------------------

/** 读我对某条内容的标记。未登录时 marks 是 null。 */
export function fetchMarks(
  id: string,
  signal?: AbortSignal,
): Promise<{ marks: ResourceMarks | null }> {
  return request<{ marks: ResourceMarks | null }>(
    `/api/resources/${encodeURIComponent(id)}/marks`,
    signal,
  );
}

/**
 * 写标记。只传要改的字段 —— 取消收藏不该顺手清掉备注和评分（服务端同理）。
 */
export function saveMarks(
  id: string,
  input: MarksInput,
): Promise<{ ok: true; marks: ResourceMarks }> {
  return sendJson('PUT', `/api/resources/${encodeURIComponent(id)}/marks`, input);
}

export function fetchFavorites(signal?: AbortSignal): Promise<{ items: FavoriteItem[] }> {
  return request<{ items: FavoriteItem[] }>('/api/me/favorites', signal);
}

// ---------------------------------------------------------------------------
// 内容治理（精选 / 官方 / 下架）—— 需要 resource.feature / resource.moderate
// ---------------------------------------------------------------------------

export function updateResourceFlags(
  id: string,
  flags: { featured?: boolean; official?: boolean },
): Promise<{ ok: true }> {
  return sendJson('PATCH', `/api/admin/resources/${encodeURIComponent(id)}/flags`, flags);
}

/**
 * 下架 / 恢复。
 *
 * ⚠️ 传的是**想要的结果**（`published`），不是"翻一下那个标志位"。
 *    后者在重试或连点两次时会得到相反的结果。
 */
export function updateResourceVisibility(
  id: string,
  published: boolean,
): Promise<{ ok: true; status: string }> {
  return sendJson('PATCH', `/api/admin/resources/${encodeURIComponent(id)}/visibility`, {
    published,
  });
}

/**
 * 上传一张图片，返回站内路径。
 *
 * ⚠️ 它**不是** sendJson：上传必须走 multipart（FormData），
 *    而且要能被浏览器算进进度。手写 JSON 的话，图片得先转成 base64 ——
 *    体积膨胀三分之一，还得先把整个文件读进内存。
 *
 * 这里**不设 Content-Type**：multipart 的 boundary 由浏览器生成，
 * 手写会漏掉它，服务端解析就会失败（而且报错信息完全指不到问题所在）。
 */
export async function uploadImage(file: File, signal?: AbortSignal): Promise<UploadResponse> {
  const body = new FormData();
  body.append('file', file);

  let res: Response;
  try {
    res = await fetch('/api/uploads', { method: 'POST', body, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('连不上 API —— 本地开发时后端可能没启动', 0);
  }

  const payload = (await res.json().catch(() => null)) as
    | (UploadResponse & { error?: string; maxBytes?: number })
    | null;

  if (!res.ok) {
    throw new ApiError(
      `上传失败 HTTP ${res.status}`,
      res.status,
      payload?.error,
      undefined,
      undefined,
      undefined,
    );
  }

  return payload as UploadResponse;
}

// ---------------------------------------------------------------------------
// 账号管理（需要 user.moderate，只有 admin 有）
// ---------------------------------------------------------------------------

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: string;
  emailVerified: boolean;
  createdAt: number;
  /** 是不是当前登录的这个人 —— 界面据此标出「我」 */
  isSelf: boolean;
}

export interface AdminUsersResponse {
  items: AdminUser[];
  total: number;
  /** 可分配的角色，按权限从低到高 */
  roles: UserRole[];
}

export function fetchAdminUsers(signal?: AbortSignal): Promise<AdminUsersResponse> {
  return request<AdminUsersResponse>('/api/admin/users', signal);
}

/**
 * 改角色。
 *
 * ⚠️ 理由**必填**（服务端的 RoleChangeInputSchema 强制），它会进审计日志。
 *    "谁在什么时候把谁变成了什么、为什么" —— 那个"为什么"是事后唯一
 *    能判断这次改动是否合理的东西。
 */
export function changeUserRole(
  id: string,
  role: UserRole,
  reason: string,
): Promise<{ ok: true; role: UserRole; previousRole?: UserRole }> {
  return sendJson('PATCH', `/api/admin/users/${encodeURIComponent(id)}/role`, { role, reason });
}

// ---------------------------------------------------------------------------
// 审核（通用的，见 shared/review.ts）
// ---------------------------------------------------------------------------

/**
 * 待审队列。
 *
 * ⚠️ 路径是 `/api/admin/queue` 而不是 `/api/admin/resources/queue`：
 *    队列**跨类型汇总**。审核员打开的是"今天有多少活"，
 *    而不是"资源库有多少活" —— 他不该挨个类型点一遍。
 */
export interface ReviewQueueResponse {
  items: QueueItem[];
  total: number;
  /** 各类型的待审数量，用于筛选标签上的角标 */
  counts: Partial<Record<ReviewableType, number>>;
  /** 服务端当前注册了哪些可审类型（前端注册表据此对齐） */
  types: ReviewableType[];
}

export function fetchReviewQueue(signal?: AbortSignal): Promise<ReviewQueueResponse> {
  return request<ReviewQueueResponse>('/api/admin/queue', signal);
}

export function fetchReviewDetail(
  type: ReviewableType,
  id: string,
  signal?: AbortSignal,
): Promise<ReviewDetail> {
  return request<ReviewDetail>(
    `/api/admin/review/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
    signal,
  );
}

export function approveReview(
  type: ReviewableType,
  id: string,
): Promise<{ ok: true; revision: number; status: string }> {
  return sendJson('POST', `/api/admin/review/${type}/${encodeURIComponent(id)}/approve`);
}

export function rejectReview(
  type: ReviewableType,
  id: string,
  reason: string,
): Promise<{ ok: true; revision: number; status: string; liveVersionKept: boolean }> {
  return sendJson('POST', `/api/admin/review/${type}/${encodeURIComponent(id)}/reject`, { reason });
}

// ===========================================================================
// M4：日历 / 视频 / Ranked Seeds
// ===========================================================================
/*
 * 这一节是全在前端和 M4 后端之间唯一的接口层。
 *
 * ⚠️ 为什么不拆成三个文件：`request` / `sendJson` 是**模块私有**的
 *    （见本文件顶部），拆文件就得把错误处理再实现一遍 ——
 *    而 `ApiError` 那套（状态码 + code + issues + existing*）是错误码契约测试
 *    守着的东西，复制一份等于把契约也复制一份、然后各自漂移。
 *
 * ⚠️ 每个函数都**只用相对路径** `/api/*`，理由见文件头（浏览器 / Electron 一致）。
 */

// ---------------------------------------------------------------------------
// 日历
// ---------------------------------------------------------------------------

export interface CalendarListResponse {
  items: CalendarEvent[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CalendarQuery {
  /** 只显示这个时刻之后**还没结束**的事件。不传 = 服务端按"当前时刻"过滤。 */
  from?: number | null;
  to?: number | null;
  /** 标签多选（Q1）。命中任意一个即可。 */
  tags?: string[];
  /**
   * 三个**单选**维度 + 一个**从属**维度。不传 / 传空 = 不限。
   *
   * ⚠️ 它们和 `tags` 的语义**不同**，这一点在界面上也要看得出来：
   *   · `tags` 多选 → 任一命中（"赛事**或**社区活动"）
   *   · 这几个 → 就是这个（"我只看**职业**赛"）
   * 把单选维度也做成数组，筛选就变成了"或"，而用户想要的是"且"。
   *
   * ⚠️ 服务端会**对着枚举校验**这些值，非法值一律当"不限"。
   *    所以界面即使传了一个拼错的值，也只会多返回几条，
   *    不会返回一个"看起来完全正确的空结果"。
   */
  level?: string | null;
  scope?: string | null;
  /**
   * 参赛门槛 —— **2026-09-13 进模型，2026-09-14 接进筛选栏**（两个日期都对，
   * 说的是两件事，所以这里把两件都写出来）。
   *
   * ⚠️ 服务端从 09-13 起就接受 `?access=`（它和 level/scope 走同一个循环），
   *    缺的只是前端把参数拼上来 —— 所以 09-14 那次是**纯前端接线**。
   * ⚠️ `stage`（轮次）与它同一轮被删掉了 —— 这里不再有那个参数。
   */
  access?: string | null;
  /**
   * 「参与范围」的**明细**（大洲或国家代码），**单选一个**。
   *
   * ⚠️ 它和上面那三个不是并列关系：选了 `scope='CONTINENT'` 才有大洲可选，
   *    选了 `'COUNTRY'` 才是国家。所以界面上那一行紧贴在「参与范围」下面。
   * ⚠️ 传的是**一个值**，而事件那一侧 `scopeDetail` 是**多值**、匹配语义是
   *    **命中任一即展示**（一场"亚洲 & 大洋洲"的赛事，选任一个大洲都该出现）。
   *    服务端那边收的是**逗号分隔**（`csv()` + `json_each` + `EXISTS`），
   *    这里只拼一个 —— 要支持"同时选两个大洲"是这里改成 join(',') 就够了，
   *    但那是**产品决定**（一次只看一个洲是不是够），不是实现限制。
   */
  scopeDetail?: string | null;
  /**
   * 系列筛选（需求③）。
   *
   * ⚠️ 参数名是 **`seriesId`**（系列的 id），**不是**系列名 —— 事件行上只有这一个
   *    指针，名字由服务端 LEFT JOIN 出来（见 `shared/calendar.ts` 的 `seriesId` 说明）。
   *    传名字上去服务端只当"不限"，表现是"筛选点了没反应"，而不会有任何报错。
   */
  seriesId?: string | null;
  page?: number;
  pageSize?: number;
}

/**
 * 公开列表。**不需要登录**（访问模型：浏览不设门槛）。
 *
 * ⚠️ `from` 是三态，而这三个意思是不同的：
 *   · 不传（undefined）→ 服务端按"现在"过滤，也就是**默认只看未来的**（Q5）
 *   · `0`             → 一个都不可能晚于它，等价于"**连已结束的也一起给我**"
 *                        （「显示已结束」开关用的就是它）
 *   · 一个时间戳      → 只看那个时刻之后还没结束的
 * 所以这里用 `!== undefined` 判断，**不能用真值判断** —— `0` 是一个有意义的值。
 */
export function fetchCalendarEvents(
  query: CalendarQuery = {},
  signal?: AbortSignal,
): Promise<CalendarListResponse> {
  const params = new URLSearchParams();
  if (query.from !== undefined && query.from !== null) params.set('from', String(query.from));
  if (query.to !== undefined && query.to !== null) params.set('to', String(query.to));
  if (query.tags && query.tags.length > 0) params.set('tags', query.tags.join(','));
  // 单选维度：null / 空串都是"不限"，一律不拼进 URL（和 buildResourceQuery 同一个约定）。
  // ⚠️ 不能把空串拼成 `?level=` —— 服务端会把它当"不限"（结果一样），
  //    但 URL 里会留一堆 `level=&scope=&access=` 的噪音，而分享出去的链接
  //    看起来像"筛过什么"，其实什么都没筛。
  if (query.level) params.set('level', query.level);
  if (query.scope) params.set('scope', query.scope);
  /*
   * ⚠️★ `scopeDetail` 单独一位，而且**必须在 `scope` 之后**拼（顺序只影响可读性，
   *    但这三个参数在 URL 里挨着出现，人才看得懂它们是同一维的两级）。
   *
   * ⚠️⚠️ 它**必须真的拼进去**：2026-09-14 的第一版把 `scopeDetail` 放进了
   *    `CalendarList` 的 `listQuery`，却漏了这一行 ⇒ **列表视图的明细筛选完全不生效**
   *    （点一个洲，列表纹丝不动，而没有任何报错）。月视图当时是对的（它逐条客户端筛），
   *    于是"同一个筛选在两个视图里行为不同"—— 那是最难被当成 bug 的一类不一致。
   */
  if (query.scopeDetail) params.set('scopeDetail', query.scopeDetail);
  if (query.access) params.set('access', query.access);
  // 系列筛选（需求③）。**空串/不传都不拼**：服务端把空串当"不限"，
  // 留着 `?seriesId=` 只会让分享出去的链接看起来像"筛过什么"。
  if (query.seriesId) params.set('seriesId', query.seriesId);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  const s = params.toString();
  return request<CalendarListResponse>(`/api/calendar${s ? `?${s}` : ''}`, signal);
}

/** 公开详情。未发布 / 已驳回的条目对公众是 404（不是 403 —— 见服务端注释）。 */
export function fetchCalendarEvent(
  id: string,
  signal?: AbortSignal,
): Promise<{ event: CalendarEvent }> {
  return request<{ event: CalendarEvent }>(`/api/calendar/${encodeURIComponent(id)}`, signal);
}

/**
 * 作者 / 编辑者读一条（**含未发布**，以及待审的那一版）。
 *
 * ⚠️ 编辑页要**先试它、再退回公开接口**，和资源库的 `fetchResourceForEdit` 同理：
 *   · 自己的草稿 → 只有这个接口拿得到
 *   · 别人已上架的事件（wiki 式编辑）→ 这个接口也拿得到（服务端对已发布的不设作者限制）
 *   · 别人的未发布草稿 → 404
 */
export function fetchCalendarForEdit(
  id: string,
  signal?: AbortSignal,
): Promise<{
  event: CalendarEvent;
  pendingRevision: number | null;
  pendingPayload: Record<string, unknown> | null;
}> {
  return request(`/api/calendar/mine/${encodeURIComponent(id)}`, signal);
}

export interface CalendarSubmitResult {
  id: string;
  revision: number;
  status: string;
}

export function submitCalendarEvent(input: CalendarEventInput): Promise<CalendarSubmitResult> {
  return sendJson('POST', '/api/calendar', input);
}

/**
 * 改一条事件 → **回到待审**，线上仍然展示旧版（设计约束 2）。
 *
 * ⚠️ 409 `already_pending` 是正常结果，不是错误：一条内容同时只允许一份
 *    待审修改。界面要把它说成"已经有人在改这一条了"，并给审核队列的入口。
 */
export function updateCalendarEvent(
  id: string,
  input: CalendarEventInput,
): Promise<CalendarSubmitResult> {
  return sendJson('PATCH', `/api/calendar/${encodeURIComponent(id)}`, input);
}

/**
 * 全部系列（`GET /api/calendar/series`）—— 需求③ 的「系列活动」栏目的数据源。
 *
 * ⚠️ **公开**：匿名访客也能看也能搜（spec §9-5 的裁决把"按字面挡游客"**否决**了），
 *    所以这里**没有**登录判断，`seriesNeedLogin` 那条词条也已随裁决删除。
 *    前端因此不需要"未登录只显示登录入口"那条分支 —— 加它会挡住本来能看的访客。
 *
 * ⚠️ **不带分页参数**：系列是人眼能扫完的量级（spec D3.9 的原话），
 *    服务端也会按 `limit` 上限截断。真到需要分页那天，改这里一处即可。
 *
 * ⚠️ **不在前端重排**：排序（未结束的在前、按下一场时间升序）**服务端已排好**。
 *    前端再排一次就是第二份排序规则，而两份规则一旦不一致，
 *    表现只是"顺序看着怪"，不会有任何报错。
 */
export function fetchCalendarSeries(signal?: AbortSignal): Promise<CalendarSeriesList> {
  return request<CalendarSeriesList>('/api/calendar/series', signal);
}

/**
 * 新建一个系列（需求③ 的写路径，t17）。
 *
 * ⚠️ 权限是 **`content.author`**（editor 及以上）—— 与"谁能建系列"的裁决一致：
 *    普通提交者从已有系列里选，选不到就留空。所以调用方必须先用
 *    `useCan('content.author')` 决定**入口显不显示**；这里不做判断（服务端会 403）。
 *
 * ⚠️ 重名会回 **409 `invalid_state` + `reason: 'series_name_taken'`** ——
 *    判重由 `calendar_series.name` 的 `COLLATE NOCASE UNIQUE` 决定（大小写变体算同一个）。
 *    界面要把它显示成 `calendar.seriesNameTaken`，**不要**自己在前端查重：
 *    前端查重必然与服务端的折叠规则漂移，而"看起来没重名、提交却被拒"最难解释。
 */
export function createCalendarSeries(
  input: CalendarSeriesInput,
): Promise<{ series: CalendarSeries }> {
  return sendJson('POST', '/api/calendar/series', input);
}

/**
 * 给一个系列改名（需求③）。
 *
 * ⚠️ 改名在"实体"模型下**是一条 UPDATE**（这正是当初选 (A) 而否掉"事件上挂名字"的理由之一：
 *    后者要扫全部事件行）。所以这里不需要、也不该去动任何事件。
 */
export function renameCalendarSeries(
  id: string,
  input: CalendarSeriesInput,
): Promise<{ series: CalendarSeries }> {
  return sendJson('PATCH', `/api/calendar/series/${encodeURIComponent(id)}`, input);
}

/**
 * 给一个系列换颜色（需求⑤，2026-09-13；权限 2026-09-14 放宽）。
 *
 * ⚠️ 权限是 **`content.author`**（编辑及以上：editor / admin / owner）——
 *    与「建系列 / 改系列名」同档，**不是**与删系列同档。第一版照用户原话
 *    「允许 owner 修改颜色」做成了 owner 专属，用户随后裁决放宽：
 *    换个颜色再点一下就回去了，是可逆的、纯装饰的动作，而删系列不可逆。
 *    ⚠️ 现实理由：**系列是编辑建的**，只给 owner 会让"谁建的谁不能调"。
 *    所以调用方用 `useCan('content.author')` 决定**入口显不显示**，
 *    这里不做判断（服务端会 403）。
 *
 * ⚠️ 传的是调色板的**键**（`'red'` … `'slate'`）或 `null`（不上色），**不是色值**：
 *    键 → 色值由 shared 的 `seriesColorValue()` 翻，而那是"两种主题下都看得见"
 *    这条论证的唯一落点（见 constants.ts 的 `SERIES_COLORS`）。
 *    这里传 `#d9534f` 的话，主题一调，界面上就会出现两种红。
 *
 * ⚠️ 回包里的 `previousColor` 不是装饰：它是"改回上一个颜色"唯一需要的信息
 *    （界面上暂时没做撤销，但排查"颜色怎么变成这个了"只能靠它）。
 */
export function setCalendarSeriesColor(
  id: string,
  color: string | null,
): Promise<{ ok: true; id: string; color: string | null; previousColor: string | null }> {
  return sendJson('PUT', `/api/calendar/series/${encodeURIComponent(id)}/color`, { color });
}

/**
 * 删除一个系列，**连带它下面的所有赛事**（2026-09-13，用户裁决）。
 *
 * ⚠️ 权限是 **owner 专属**（共享谓词 `canHardDelete`），与"谁能建/改系列"
 *    （`content.author`）**不是同一档**。理由见服务端那条端点的注释：
 *    新建和改名可逆，这一条不是 —— 它一次性硬删掉系列下每一场赛事**和它们的版本
 *    历史**，而赛事没有"先下架"那一步。所以调用方必须用 `useCanHardDelete()`
 *    决定**入口显不显示**；这里不做判断（服务端会 403）。
 *
 * ⚠️ 服务端回的 `deletedEvents` **不是可选信息**：界面要拿它把"连带删了几场"说清楚。
 *    只回 `{ ok: true }` 的话，用户点完之后无从知道代价。类型里带着它，
 *    是为了让"忘了用这个数"在编译期就看得见。
 */
export function deleteCalendarSeries(
  id: string,
): Promise<{ ok: true; id: string; deletedEvents: number }> {
  return sendJson('DELETE', `/api/calendar/series/${encodeURIComponent(id)}`);
}

/**
 * 删掉这个系列会连带删掉**多少场赛事** —— 二次确认里那个数字的来源。
 *
 * ⚠️ **不要**改用列表行上的 `count`：那是"未结束且已发布"的场次，而删除带走的是
 *    **所有**赛场（含已过去的、含未发布的）。一个「历届季后赛」系列在列表里
 *    `count` 正好是 0 ⇒ 确认框会说"不会影响任何内容"，而它正要删掉十几场。
 *
 * ⚠️ 服务端把它设成 owner 专属（与删除同权限）：它唯一用途是给删除做确认，
 *    放开就等于向任何人汇报"这个系列里有几条未发布的投稿"。
 *
 * ⚠️ 点击删除时**现取**，不缓存：列表可能已经旧了，而这个数字是给"按下去
 *    就不可逆"做决策用的。取不到就**不要**给出删除按钮 —— 宁可让人多试一次，
 *    也不能让人在错误的数量下确认。
 */
export function fetchCalendarSeriesImpact(
  id: string,
  signal?: AbortSignal,
): Promise<{ ok: true; id: string; events: number }> {
  return request<{ ok: true; id: string; events: number }>(
    `/api/calendar/series/${encodeURIComponent(id)}/impact`,
    signal,
  );
}

/**
 * ICS 订阅地址（**绝对 URL**）。
 *
 * ⚠️ 它必须是**绝对**地址而不是 `/api/calendar.ics`：
 *    这条 URL 要进手机日历客户端的"订阅"输入框，那里没有"当前页面"的概念。
 *    用 `location.origin` 而不是 shared 里的 productionOrigin —— 开发环境
 *    要指向 dev 服务器，而线上自然就是 https://mcsrhelper.com。
 *
 * ⚠️ 结尾的路径是 `/calendar.ics`（不是 `/calendar/ics`），理由见服务端注释：
 *    日历客户端会看扩展名。这个理由在**用户亲手粘贴这条 URL** 时同样成立。
 */
export function calendarIcsUrl(): string {
  const origin = globalThis.location?.origin ?? '';
  return `${origin}/api/calendar.ics`;
}

/**
 * `webcal://` 形式的订阅地址 —— 点一下就能交给系统日历（iOS / macOS 认它）。
 *
 * ⚠️ 只在能拿到 origin 时才给。拿不到时返回 null，界面就只显示"复制链接"，
 *    而不是显示一个以 `webcal://undefined` 开头的链接。
 */
export function calendarWebcalUrl(): string | null {
  const origin = globalThis.location?.origin ?? '';
  if (!origin) return null;
  // https://host → webcal://host。换成 http 的话系统不会接管。
  return calendarIcsUrl().replace(/^https?:\/\//, 'webcal://');
}

// ---------------------------------------------------------------------------
// 直接编辑（需求②）—— `/api/authoring/*`
// ---------------------------------------------------------------------------
/*
 * ⚠️ 这一族端点的共同语义：**绕过审核快照、直接写线上那一行**。
 *    它们是全站唯一会这么做的写路径，所以集中在 `/api/authoring/*` 下，
 *    权限统一是 `content.author`（editor / admin / owner，**不含 reviewer**）。
 *
 * ⚠️ 前端只负责"把表单内容送过去"，**不判断权限**成不成立：`useCan('content.author')`
 *    只决定按钮显不显示，真正的拦截在服务端（手动发请求会拿到 403）。
 */

/**
 * 直编的结果。
 *
 * ⚠️ `liveRevisionUnchanged` **两条路都会返回**（提审为 `true`、直编为 `false`），
 *    而且它是"这次改动有没有进线上那一行"的**唯一判据**。
 *    前端不许按"我调的是哪个端点"去推它 —— 同一个端点对不同状态的条目
 *    （已发布 / 草稿 / 待审）结果不同，推出来的会是对用户撒谎的那一种。
 */
export interface DirectWriteResult {
  ok: true;
  id: string;
  revision: number;
  status: string;
  liveRevisionUnchanged: boolean;
}

/** 直接保存一条资料（写线上行，不进审核队列）。 */
export function saveResourceDirect(
  id: string,
  input: ResourceSubmission,
): Promise<DirectWriteResult> {
  return sendJson('PATCH', `/api/authoring/resources/${encodeURIComponent(id)}`, input);
}

/** 直接发布一条新资料（`source` 由服务端强制为 `user`）。 */
export function createResourceDirect(input: ResourceSubmission): Promise<DirectWriteResult> {
  return sendJson('POST', '/api/authoring/resources', input);
}

/** 直接发布一场新活动（需求②，t14）—— 写线上行、不进审核队列。 */
export function createCalendarEventDirect(input: CalendarEventInput): Promise<DirectWriteResult> {
  return sendJson('POST', '/api/authoring/calendar', input);
}

/** 直接保存一场已有活动（需求②，t14）。 */
export function saveCalendarEventDirect(
  id: string,
  input: CalendarEventInput,
): Promise<DirectWriteResult> {
  return sendJson('PATCH', `/api/authoring/calendar/${encodeURIComponent(id)}`, input);
}

/**
 * 直接删除一场活动（需求②，t14）—— **一档：owner 与 editor/admin 都是一次调用直删**。
 *
 * ⚠️ 赛事与资料/视频**不同**，**不要**照抄那两类的两档写法：
 *   · **赛事没有下架入口**（全仓没有任何把 `calendar_events.status` 写成 `'hidden'` 的地方），
 *     所以"先下架，再删除"这一步在赛事上**不存在** —— 照抄会给出一个把人引向死路的提示；
 *   · 赛事也**没有**收藏/备注这类连带数据（那才是"资料/视频要两档"的原因：
 *     真删会 CASCADE 掉**别人**写的备注与评分）。
 *   ⇒ 服务端 `DELETE /api/authoring/calendar/:id` 写死 `force: true`，判据只有能力/谓词。
 */
export function deleteCalendarEventDirect(id: string): Promise<{ ok: true; id: string }> {
  return sendJson('DELETE', `/api/authoring/calendar/${encodeURIComponent(id)}`);
}

/**
 * 直接删除一条资料（真删，不可逆）—— **两档**（与删除视频**逐字同一条规则**）。
 *
 * ⚠️ 两档的**分界在路由层，不在这个函数里**：路由用 `force: isOwner` 决定要不要
 *    跳过"先下架"，所以前端读到的两种结果是**两种不同的响应**，不是同一个码的变体：
 *   · **owner**（`canHardDelete(role)`）⇒ 路由传 `force: true` ⇒ **任何 status 都直接删**；
 *   · **editor / admin**（`content.author`）⇒ 路由传 `force: false` ⇒ 内容**还在线上**时
 *     回 **409 `invalid_state` + `reason: 'must_hide_first'`**（先用
 *     `PATCH /api/admin/resources/:id/visibility` 下架，下架可恢复）；
 *   · **其它任何角色** ⇒ **403**（连 `content.author` 都没有）。
 *
 * ⚠️ 这条判据**曾经来回震荡过 (a)/(b)**，captain 已于 2026-09-13 **定案 (b) 并在服务端就地固定**
 *    （两处路由都写成 (b)，注释里写明"不要再改回 (a)"）。⇒ **前端按 (b) 写，不要再根据
 *    服务端源码去猜口径** —— 它以 `routes/authoring.ts` 为准并且不会再动。
 *   **最终事实**（行号于 2026-09-13 核对）：
 *     · **资料** `:182` → 两档（`:208` 是 `force: isOwner`）；
 *     · **视频** `:473` → 两档（`:495` 是 `force: isOwner`），那里的注释明确写着
 *       「**不要再改回 (a)** —— 那会让 editor/admin 永远删不掉视频」；
 *     · **赛事** `:335` → **一档**（`:355` 写死 `force: true`）：赛事**没有**下架入口、
 *       也没有收藏/备注这类连带数据，所以"先下架"那一步在它上面**不存在**。
 *   ⇒ 教训（保留，因为它不随口径变）：**"某类内容怎么删"要看那一类的路由**，
 *     不能从兄弟类型（甚至不能从同一个文件里的另一个端点）推 —— 我就是这么错过三次的。
 *
 * ⚠️ 前端**不做本地预判**（"它现在是 published 所以先禁用按钮"）——
 *    "能不能删"只在服务端判断；前端只负责把 403 与 409 两句话分开说清楚。
 */
export function deleteResourceDirect(id: string): Promise<{ ok: true; id: string }> {
  return sendJson('DELETE', `/api/authoring/resources/${encodeURIComponent(id)}`);
}

// ---------------------------------------------------------------------------
// 视频
// ---------------------------------------------------------------------------

export interface VideoListResponse {
  items: Video[];
  total: number;
  page: number;
  pageSize: number;
}

export interface VideoQuery {
  platform?: VideoPlatform;
  authorId?: string;
  page?: number;
  pageSize?: number;
}

/**
 * 视频墙。**公开**。
 *
 * ⚠️ 空的筛选项一律**不拼进 URL**。`?platform=` 会是一个合法的 400
 *    （platform 是封闭枚举，空串不是它的取值），而用户看到的是
 *    "查询参数不合法" —— 指不到"你把筛选清空了"这件事上。
 *
 * ---------------------------------------------------------------------------
 * `fresh` 的来历（和 `fetchLiveChannelsFresh` 是同一个 bug，见那里的长注释）
 * ---------------------------------------------------------------------------
 * `/api/videos` 带 `public, max-age=60`（见 `routes/videos.ts` 的 PUBLIC_CACHE）。
 * 匿名访客吃这个缓存是对的 —— 视频墙本来就在 rolling，晚 60 秒无所谓。
 *
 * 但**下架的人自己**的浏览器里也存着同一份缓存，于是：
 *
 *   编辑在卡片上点「隐藏」→ `refreshKey` +1 → 重新请求 `/api/videos`
 *   → 命中的是 60 秒内的旧响应 → **那条还在墙上**。
 *
 * 编辑看到的是"我明明隐藏了，它怎么还在"，再点一次（还是旧的），
 * 最后以为隐藏功能坏了。服务端一直是对的，错的是这一层缓存。
 *
 * ⚠️ 只有**有下架权的人**传 `fresh`（`Videos.tsx` 里按 `resource.moderate`
 *    分派）：访客和白名单作者仍然走缓存，那正是这条 60 秒缓存存在的意义。
 */
export function fetchVideos(
  query: VideoQuery = {},
  signal?: AbortSignal,
  fresh = false,
): Promise<VideoListResponse> {
  const params = new URLSearchParams();
  if (query.platform) params.set('platform', query.platform);
  if (query.authorId) params.set('authorId', query.authorId);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  const s = params.toString();
  return request<VideoListResponse>(
    `/api/videos${s ? `?${s}` : ''}`,
    signal,
    fresh ? 'no-store' : undefined,
  );
}

/** 我贴过的（**含被隐藏的**）。服务端不过滤状态，理由见 routes/videos.ts。 */
export function fetchMyVideos(signal?: AbortSignal): Promise<{ items: Video[] }> {
  return request<{ items: Video[] }>('/api/videos/mine', signal);
}

export interface VideoSubmitResult {
  ok: true;
  video: Video;
  /**
   * ⚠️ 这个平台的起始偏移**会不会生效**。
   *
   * B站嵌入没有官方的跳转参数 —— 服务端照样把 `startOffsetSec` 存下来
   * （那是用户提供的数据，而且 YouTube / Twitch 需要它），但会用这个字段
   * 明确告诉界面"这个平台不支持"，让界面主动说一句。
   *
   * 静默丢掉才是最差的做法：用户填了 `1:02:33`、播放器却从 0 开始，
   * 他会以为链接坏了。
   */
  startOffsetSupported: boolean;
}

export function submitVideo(input: VideoInput): Promise<VideoSubmitResult> {
  return sendJson('POST', '/api/videos', input);
}

export interface VideoDeleteResult {
  ok: true;
  id: string;
  /**
   * ⚠️ 同一个端点，两种**语义完全不同**的结果，由身份决定：
   *   · `deleted` —— 作者删自己的，**真删**（行没了）
   *   · `hidden`  —— 有 `resource.moderate` 的人删别人的，**隐藏**
   *                  （墙上没了，作者自己还看得见，而且可以被恢复）
   * 界面必须按它给出不同的说法和不同的后续操作（"恢复"只对 hidden 有意义）。
   */
  mode: 'deleted' | 'hidden';
  /** 这次调用有没有真的改变什么。空操作是 `false`（不是错误）。 */
  changed: boolean;
}

export function deleteVideo(id: string): Promise<VideoDeleteResult> {
  return sendJson('DELETE', `/api/videos/${encodeURIComponent(id)}`);
}

/**
 * 改一条视频的链接 / 标题 / 起始偏移（需求②，t14）。
 *
 * ⚠️ **这不是"绕过审核"**：视频本来就不审核（Q6：贴了就可见），所以这条路的语义
 *    与"资料/赛事的直编"不同 —— 它没有"提审"这一档可比。界面上因此**不该**用
 *    `authoring.directSave`（那句带"（不审核）"，会让人以为视频平时是要审的）。
 * ⚠️ 权限是 `content.author`（editor 及以上）；作者改自己那条走的是同一端点。
 * ⚠️ 响应形状与资料/赛事**接近但不同**：它回的是 `{ ok, video, status, liveRevisionUnchanged }`
 *    （服务端 `routes/authoring.ts` 的 `PATCH /videos/:id` 回读整行，并把 `status` 提到顶层）。
 *    ★ 顶层 `status` 是 `video.status` 的**镜像**（同一次响应、同一个值），刻意与资源/日历
 *    两条直编改写**同形** —— 有了它，`directWriteNotice(result, t)` 可以直接吃这个返回值，
 *    视频这条路径**不需要破例**去读 `video.status`。没有它的话，三个直编端点里就这一个要
 *    特判，而"某一类型要特殊处理"正是它们最容易漂移的地方。
 *    ⚠️ 仍然**不能**套 `DirectWriteResult`：那个还带 `id`/`revision`，视频这条没有版本表。
 *    两者共用的部分是 `directWriteNotice` 的入参（`status` + `liveRevisionUnchanged`），
 *    所以"该说什么"的判据仍然只有一处。
 *    ⚠️ 为什么 `status` 不能省：一条**被隐藏**的视频改完之后仍然是 `hidden`，
 *    只说"已保存"会让用户以为它回到了墙上 —— 而这件事**不会有任何报错**。
 * ⚠️ 撞上已存在的链接会回 **409 `video_exists` + `existingId`**（形状同 `submitVideo`）。
 */
export function saveVideoDirect(
  id: string,
  input: VideoInput,
): Promise<{ ok: true; video: Video; status: string; liveRevisionUnchanged: boolean }> {
  return sendJson('PATCH', `/api/authoring/videos/${encodeURIComponent(id)}`, input);
}

/** 隐藏 / 恢复。只有 `resource.moderate`（editor 及以上）能调。 */
export function setVideoVisibility(
  id: string,
  status: 'visible' | 'hidden',
): Promise<{ ok: true; id: string; status: string; changed: boolean }> {
  return sendJson('PATCH', `/api/videos/${encodeURIComponent(id)}/visibility`, { status });
}

// ---------------------------------------------------------------------------
// Ranked Seeds
// ---------------------------------------------------------------------------
/*
 * ⚠️ 这一组**全是公开的**（不需要登录）：它们只是把上游的公开数据转发过来。
 *    唯一要登录的是 `saveSeedRecord`（它会往用户自己的数据库里写记录）。
 */

/** 把筛选条件拼成上游认的形状（小写、逗号分隔）。 */
function seedFilterParams(filters: SeedFilters): string {
  const params = new URLSearchParams();
  if (filters.overworld) params.set('overworld', filters.overworld);
  if (filters.nether) params.set('nether', filters.nether);
  if (filters.variations) params.set('variations', filters.variations);
  if (filters.without) params.set('without', filters.without);
  if (filters.completion !== undefined) params.set('completion', String(filters.completion));
  const s = params.toString();
  return s ? `?${s}` : '';
}

/**
 * 随机一条（无条件）。
 *
 * ⚠️ **不要往这个端点传筛选参数** —— 服务端会返回 400 `use_search_endpoint`
 *    而不是静默忽略（Q17）。静默忽略的后果是界面把一条**不符合条件**的种子
 *    当结果展示：用户看得见，我们看不见。
 */
export function fetchRandomSeed(signal?: AbortSignal): Promise<SeedQueryResult> {
  return request<SeedQueryResult>('/api/ranked-seeds/random', signal);
}

/** 随机一条**满足条件**的（Q17 的筛选都走这里）。 */
export function searchSeed(filters: SeedFilters, signal?: AbortSignal): Promise<SeedQueryResult> {
  return request<SeedQueryResult>(`/api/ranked-seeds/search${seedFilterParams(filters)}`, signal);
}

/**
 * 按比赛 ID 取三个世界的种子值。服务端缓存 1 小时（种子值永远不会变）。
 *
 * ⚠️ 404 是**常态**（`seed_not_found`）：上游只覆盖约 80% 的历史比赛。
 *    界面要按"这条不在库里"显示，并给出补录入口 —— 不是"出错了"。
 */
export function fetchSeedByMatchId(
  matchId: number,
  signal?: AbortSignal,
): Promise<{ seed: SeedRecord; cached: boolean }> {
  return request(`/api/ranked-seeds/match/${String(matchId)}`, signal);
}

/**
 * 详细信息（结构 + 变种）。下界比 `/match` 低（老比赛可能只有 info 没有种子值）。
 */
export function fetchSeedInfo(
  matchId: number,
  signal?: AbortSignal,
): Promise<{ info: SeedInfo; cached: boolean }> {
  return request(`/api/ranked-seeds/match/${String(matchId)}/info`, signal);
}

/**
 * 补录一条（写进上游的用户数据库）。
 *
 * ⚠️ 需要登录 + 邮箱已验证 + `seed.submit` 能力，而且有**独立的、更严的**配额
 *    （每用户每小时 10 次，而且只记**成功写入**，不记填错字段）。
 *    429 时用 `error.retryAfterSec` 告诉用户还要等多久。
 */
export function saveSeedRecord(
  input: SeedCreateInput,
): Promise<{ ok: true; matchId: number; record: SeedRecord | null }> {
  return sendJson('POST', '/api/ranked-seeds/save', input);
}

// ---------------------------------------------------------------------------
// 直播频道清单
// ---------------------------------------------------------------------------
/*
 * ⚠️ 这一组和视频那一组的**权限形状相反**：
 *   · 视频：任何登录用户都能贴（Q6 的 rolling）
 *   · 直播：只有 `live.manage`（editor 及以上）—— 一份少数人维护、变动很慢的名单
 * 所以这里没有"贴一条"的公开入口，写操作全部要能力。
 */

/** 公开列表：**不需要登录**。只出 visible 的行。 */
export function fetchLiveChannels(signal?: AbortSignal): Promise<{ items: LiveChannel[] }> {
  return request<{ items: LiveChannel[] }>('/api/live', signal);
}

/**
 * 公开列表 —— 但**绕过浏览器缓存**。只给"编辑改完立刻要看结果"那条路用。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 为什么必须有它（这是一个真跑出来的 bug，不是预防性的）
 * ---------------------------------------------------------------------------
 * `GET /api/live` 带 `public, max-age=60, stale-while-revalidate=300`。匿名访客
 * 吃这个缓存是对的（名单变动很慢）。但编辑**自己**的浏览器里也存着一份同样的
 * 缓存，于是：
 *
 *   编辑点「隐藏」→ 面板刷新公开列表 → 命中的是 60 秒内的旧响应 →
 *   公开列表里**那一条还在**。编辑看到的是"我隐藏了但它还在"，
 *   再点一次（还是旧的），最后以为界面坏了。
 *
 * 实测证据（`.cache/livecache.mjs`，同一个页面里连发五次请求）：
 *   隐藏之后页面的 fetch 仍然拿到那一行，而 Resource Timing 里
 *   `transferSize: 0`（= 根本没走网络，是缓存给的）；带时间戳绕开缓存的那一次
 *   才拿到过滤后的结果 —— 也就是说**服务端一直是对的**，错的是这一层缓存。
 *
 * ---------------------------------------------------------------------------
 * 为什么是 `no-store`，而不是给地址加一个 `?ts=${Date.now()}`
 * ---------------------------------------------------------------------------
 * 假参数只是把缓存**键**换掉：它留下的是一份没人会清理的垃圾缓存条目，
 * 而且服务端日志里会多出一串毫无意义的查询串。`no-store` 说的是真话 ——
 * "这个请求不要缓存"，浏览器也照做。
 *
 * ⚠️ 只在编辑那条路上用它（`Live.tsx` 里按 `live.manage` 分派）：
 *    匿名访客仍然走 `fetchLiveChannels` 吃缓存，那是这条 60 秒缓存存在的意义。
 */
export function fetchLiveChannelsFresh(signal?: AbortSignal): Promise<{ items: LiveChannel[] }> {
  return request<{ items: LiveChannel[] }>('/api/live', signal, 'no-store');
}

/**
 * 编辑视图：**含被隐藏的行**，需要 `live.manage`。
 *
 * ⚠️ 它是**另一个端点**，不是 `fetchLiveChannels` 加一个参数：
 *    两者的缓存规则相反（公开列表可以缓存 60 秒，这一条必须 no-store）。
 *    共用一个端点的话，那条 60 秒的公共缓存迟早会把隐藏行发给别人。
 */
export function fetchLiveChannelsForManage(
  signal?: AbortSignal,
): Promise<{ items: LiveChannel[] }> {
  return request<{ items: LiveChannel[] }>('/api/live/manage', signal);
}

export function createLiveChannel(
  input: LiveChannelInput,
): Promise<{ ok: true; channel: LiveChannel }> {
  return sendJson('POST', '/api/live', input);
}

export function updateLiveChannel(
  id: string,
  input: LiveChannelInput,
): Promise<{ ok: true; channel: LiveChannel }> {
  return sendJson('PATCH', `/api/live/${encodeURIComponent(id)}`, input);
}

/** 隐藏 / 显示。空操作回 `changed: false`，那是**成功**不是错误。 */
export function setLiveChannelVisibility(
  id: string,
  status: 'visible' | 'hidden',
): Promise<{ ok: true; id: string; status: string; changed: boolean }> {
  return sendJson('PATCH', `/api/live/${encodeURIComponent(id)}/visibility`, { status });
}

export function deleteLiveChannel(id: string): Promise<{ ok: true; id: string }> {
  return sendJson('DELETE', `/api/live/${encodeURIComponent(id)}`);
}

// ---------------------------------------------------------------------------
// ④=B 私人列表：`user_live_links`（**只给自己看**，见 spec §5.3b D4b.3）
// ---------------------------------------------------------------------------

/**
 * 「我的链接」——**只有自己那几行**。
 *
 * ⚠️ 只要求登录（`requireAuth`），**不要求邮箱验证、也没有新能力**：
 *    这与收藏/备注同一档 —— 私人、低风险、不对外可见。
 *    所以**不要**给它套 `useCan(...)` 之类的门（那是"编辑维护公开名单"的形状）。
 * ⚠️ 服务端回 `no-store`：这是"我刚加完要看到它"的那类列表，
 *    任何缓存都会让用户以为没保存成功。
 */
export function fetchMyLiveLinks(signal?: AbortSignal): Promise<{ items: UserLiveLink[] }> {
  return request<{ items: UserLiveLink[] }>('/api/live/mine', signal);
}

/**
 * 加一条。
 *
 * ⚠️ **只传 `url`（+ 可选 `title`）**，平台与标识**全由服务端从链接推导**
 *    （`parseLiveLink`）：客户端指定的话，表里的 `platform` 会和链接实际指向的平台
 *    不一致，而两边都不报错。
 * ⚠️ `.strict()`：多余字段直接 400（不是被悄悄忽略）—— 所以这里**不要**顺手多传字段。
 * ⚠️ ★ **认不出的链接也收（201）**，那时 `platform`/`handle` 为 null、`url` 原样存。
 *    ⇒ 界面**不许**在前端拦"链接不合法"：那是私人列表**允许**的东西
 *    （与公开名单那个 `handle` 字段的判据完全不同，别把两边的校验抄成一份）。
 */
export function createMyLiveLink(
  input: UserLiveLinkInput,
): Promise<{ ok: true; link: UserLiveLink }> {
  return sendJson('POST', '/api/live/mine', input);
}

/**
 * 改自己那一行（`url` 或 `title`，至少给一个）。
 *
 * ⚠️ `title: null` 是**清空**（"去掉之前起的名字"），与"没传这个字段"是两件事 ——
 *    传 `undefined` 会被 `.strict()` 之外的 refine 判成"什么都没改"（400）。
 * ⚠️ 别人的行 / 不存在的行回 **404**（不是 403）：**不泄露"这一行存在但不属于你"**。
 */
export function updateMyLiveLink(
  id: string,
  patch: UserLiveLinkPatch,
): Promise<{ ok: true; link: UserLiveLink }> {
  return sendJson('PATCH', `/api/live/mine/${encodeURIComponent(id)}`, patch);
}

/** 删自己那一行。别人的行同样是 **404**（理由同上）。 */
export function deleteMyLiveLink(id: string): Promise<{ ok: true; id: string }> {
  return sendJson('DELETE', `/api/live/mine/${encodeURIComponent(id)}`);
}
