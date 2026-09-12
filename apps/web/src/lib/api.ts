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
import type { CalendarEvent, CalendarEventInput } from '@mcsr/shared/calendar';
import type { LiveChannel, LiveChannelInput } from '@mcsr/shared/live';
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
   * 三个**单选**维度（011 新增了后两个）。不传 / 传空 = 不限。
   *
   * ⚠️ 它们和 `tags` 的语义**不同**，这一点在界面上也要看得出来：
   *   · `tags` 多选 → 任一命中（"赛事**或**社区活动"）
   *   · 这三个 → 就是这个（"我只看**职业**赛"）
   * 把单选维度也做成数组，筛选就变成了"或"，而用户想要的是"且"。
   *
   * ⚠️ 服务端会**对着枚举校验**这些值，非法值一律当"不限"。
   *    所以界面即使传了一个拼错的值，也只会多返回几条，
   *    不会返回一个"看起来完全正确的空结果"。
   */
  level?: string | null;
  scope?: string | null;
  stage?: string | null;
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
  //    但 URL 里会留一堆 `level=&scope=&stage=` 的噪音，而分享出去的链接
  //    看起来像"筛过什么"，其实什么都没筛。
  if (query.level) params.set('level', query.level);
  if (query.scope) params.set('scope', query.scope);
  if (query.stage) params.set('stage', query.stage);
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
