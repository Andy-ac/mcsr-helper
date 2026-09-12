/**
 * Ranked Seeds 上游客户端：fetch 封装 / 超时 / 错误归一化。
 *
 * ===========================================================================
 * 这个模块为什么必须存在：混合内容（mixed content）
 * ===========================================================================
 * 上游是用户**自己的**服务，地址是 `http://198.51.100.20:8001/api/v2/`，
 * 而本站是 `https://mcsrhelper.com`（见 docs/ranked-seeds-api.md §1、§2）。
 *
 * 浏览器**必定**拦掉 https 页面里对 http 的 fetch/XHR —— 不是"可能有问题"，
 * 是必然失败；而且报出来的是 CORS / mixed-content 一类看起来像"上游挂了"
 * 或"配置写错了"的错，排查方向会被带到完全错误的地方去。
 *
 * 所以链路只有一种可行形状，这个文件就是"我们"那一跳：
 *
 *     浏览器 → 我们（https，同源）→ 上游（http，服务器到服务器）
 *
 * 服务器之间的请求不受同源与混合内容限制。代理顺带带来两个好处
 * （以及必须自己扛起来的两份责任，见 docs/m4-decisions.md Q14）：
 *   ✅ 上游地址只出现在这一个文件里，前端眼里它根本不存在；
 *   ✅ 响应形状与错误码由我们统一，前端不需要知道上游长什么样；
 *   ⚠️ 必须**限流** —— 否则我们的用户能把用户自己的上游打挂（routes/seeds.ts）；
 *   ⚠️ 必须**超时** —— 否则上游卡住时我们自己的页面会一直转圈。
 *
 * ===========================================================================
 * ⚠️ 上游有五处不一致，全都在这里抹平（绝不能漏到界面上）
 * ===========================================================================
 * 1. **大小写不一致**：筛选参数要小写（`village`），而 `seedinfo` 返回大写
 *    （`VILLAGE`）。对外统一成**大写**（和项目其它地方一致），
 *    发请求时由 routes/seeds.ts 转小写。
 *    实测补充：上游对筛选参数的大小写**其实不敏感**（`overworld=VILLAGE`
 *    与 `overworld=village` 返回同样的 availableCounts：964637）。我们仍然
 *    按契约发小写 —— "契约规定小写"和"实现恰好容忍大写"是两件事，
 *    依赖后者会在上游收紧校验的那天突然失效，而失效表现是"筛选没结果"。
 * 2. **被字符串包起来的 JSON**：`end_towers` 是 `"[76, 79]"`、`variations`
 *    是 `"[\"biome:structure:plains\"]"` —— 都是**字符串**，要二次
 *    `JSON.parse` 才是数组。直接透传的话界面拿到的是一个字符串（而它长得
 *    很像数组，所以这种错会一路漏到界面上才被发现）。
 * 3. **错误不走外壳**：成功是 `{success,message,data}`，错误却是 FastAPI 的
 *    形状（实测 404 → `{"detail":"未找到ID为 … 的种子数据"}`）。
 *    所以错误一律**按 HTTP 状态码**判定，不去猜 success 字段。
 * 4. **同一个语义两个形状**：`/seed` 是平铺的 `{id, overworldSeed, …}`
 *    （`id` 就是 matchId —— 实测：`/seed` 给出 id=6124756，
 *    随后 `/seed/6124756` 返回了**完全相同**的三个种子值），
 *    而 `/seed/{matchId}` 是嵌套的 `{matchId, matchDate, seeds:{…}}`。
 *    这里统一成平铺的一条记录，否则界面要为"随机结果"和"按 ID 查"
 *    写两套读取代码，而两套代码一定会漂移。
 * 5. **matchDate 方向相反**：schema 说它是字符串，GET 却返回数字毫秒
 *    （实测 1762982331457）。写入时统一成字符串（按 schema）。
 *
 * ⚠️ 上游的错误文案**绝不透传**（Q14）：上游的 message / detail 只进服务端
 *    日志。它对用户没有意义（说的是上游自己的内部状态），而且它会变 ——
 *    前端一旦开始依赖它就永远甩不掉。日志只在这一层打：只有这一层知道
 *    上游到底说了什么，路由层再打一遍只会让人以为出了两个问题。
 */
/*
 * ⚠️ 这里已经没有 `import type { SeedString }` 了 —— 它随
 *    SeedRecord / SeedInfo / SeedFilters 一起搬去了 shared（见下面那段注释）。
 *    本文件里解析种子值的那几个函数（`asSeedString` 等）返回的是 `string`，
 *    而"必须是字符串形态"这条约束现在由 shared 的 `SeedRecord` 承载。
 */

/** 上游地址默认值（用户自己的服务）。可用 MCSR_SEED_API_BASE 覆盖。 */
const DEFAULT_BASE_URL = 'http://198.51.100.20:8001/api/v2';

/**
 * 上游请求超时。
 *
 * 5 秒是"正常响应绰绰有余、用户又不觉得页面卡死"的折中：实测上游在几十
 * 毫秒内就返回。超时的唯一后果是用户看到「种子服务暂时不可用」，
 * 这比让页面一直转圈好得多 —— 一个永不结束的请求在界面上给不出任何有用
 * 信息，用户只会反复点，而每次点击都是一次新的上游请求。
 */
const DEFAULT_TIMEOUT_MS = 5_000;

/** 上游地址（去掉结尾斜杠，便于拼路径）。 */
export function upstreamBaseUrl(): string {
  const raw = process.env.MCSR_SEED_API_BASE?.trim();
  const base = raw && raw.length > 0 ? raw : DEFAULT_BASE_URL;
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

/**
 * 超时毫秒数。可用 MCSR_SEED_TIMEOUT_MS 覆盖。
 *
 * 留这个环境变量是为了让测试能用 30ms 触发**真实的** abort 路径
 * （见 seeds-proxy.test.ts），而不是假装抛一个超时错误 ——
 * 后者测的是"我们会不会处理超时",前者测的是"超时到底会不会发生"。
 */
export function upstreamTimeoutMs(): number {
  const raw = Number.parseFloat(process.env.MCSR_SEED_TIMEOUT_MS ?? '');
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

// ---------------------------------------------------------------------------
// 结果类型
// ---------------------------------------------------------------------------

/**
 * 上游失败的**五**种归一化结果。
 *
 * ⚠️ 分成五类而不是"成功/失败"两类，是因为它们**对用户的意义完全不同**：
 *   · not_found   → 这条比赛 ID 不在库里。上游只覆盖约 80%（§3），这是**常态**
 *   · empty       → 这次**筛选**没有命中任何一条。也是常态，但和上一条不是一回事
 *   · conflict    → 这条已经录过了。用户只要知道这个，别再让他重试
 *   · rejected    → 上游说"你这个请求本身不对" = **我们的适配层写错了**
 *   · unavailable → 超时 / 不可达 / 5xx / 上游限流。暂时的问题，等一会儿再试
 *
 * ---------------------------------------------------------------------------
 * ⚠️ `empty` 是后来补的，补之前它掉进了最糟的那一类
 * ---------------------------------------------------------------------------
 * 原来只有四类，于是"筛选命中 0 条"落到 `rejected`（→ 500 internal_error）
 * 或 `badShape`（→ 502）上。也就是说：**用户叠窄了筛选条件，界面告诉他
 * "服务器出错了"**。
 *
 * 而 `/search` 正是 Q17 那套两级联动 chip 的入口 —— 叠条件是它的**正常用法**，
 * 叠几下没结果是必然会发生的事。把常态报成故障，用户唯一能做的反应是
 * 反复重试（永远越试越少），然后认为站点坏了。
 *
 * 它和 `not_found` 分开，是因为两者的**下一步不同**：
 *   · not_found → 这条比赛不在库里，可以补录（Q15 的 /save）
 *   · empty     → 库里有没有这条不知道，是**条件**太窄了，该放宽条件
 * 前端给这两种情况的文案和按钮都不一样，所以不能合并成一个码。
 */
export type UpstreamFailure = 'not_found' | 'empty' | 'conflict' | 'rejected' | 'unavailable';

/** 失败分支。`detail` **只给日志用**，绝不进任何响应体。 */
export interface UpstreamFailureResult {
  ok: false;
  kind: UpstreamFailure;
  detail: string;
}

export type UpstreamResult<T> = { ok: true; data: T } | UpstreamFailureResult;

// ---------------------------------------------------------------------------
// 归一化后的对外形状
// ---------------------------------------------------------------------------
/*
 * ⚠️ `SeedRecord` / `SeedQueryResult` / `SeedInfo` / `SeedFilters` / `SeedCreateInput`
 *    现在住在 `packages/shared/src/seed.ts`，这里只重新导出。
 *
 *    理由和主世界词表一样：**它们本来就是前后端共用的契约**。它们描述的是
 *    "服务端归一化之后、前端消费"的那一层（上游的三种畸形在这一层已经不存在了）
 *    —— 前端要写种子查询界面和补录表单就必须认识它们。
 *    放在服务端的话前端只有两条路：抄一份（两份必然漂移），或者 `any`
 *    （那就没有任何检查）。
 *
 *    这里保留 re-export，是为了让**只读这个文件的人**不必再去 shared 里找 ——
 *    适配层的读者关心的是"归一化成什么"，那个答案就在这几行。
 */
export type {
  SeedCreateInput,
  SeedFilters,
  SeedInfo,
  SeedQueryResult,
  SeedRecord,
} from '@mcsr/shared/seed';

/*
 * ⚠️ 上面那次 `export type` 只做转发，**不把名字带进本文件的类型作用域** ——
 *    所以下面还要 `import type` 一次，否则本文件里用不了它们。
 *    （这是 TS 的规则：`export ... from` 是一个纯粹的转发语句。）
 */
import type {
  SeedCreateInput,
  SeedFilters,
  SeedInfo,
  SeedQueryResult,
  SeedRecord,
} from '@mcsr/shared/seed';

// ---------------------------------------------------------------------------
// 请求
// ---------------------------------------------------------------------------

interface RequestOptions {
  method: 'GET' | 'POST';
  query?: Record<string, string | undefined>;
  body?: unknown;
}

/**
 * 发一个上游请求，并把结果归一化成 UpstreamResult。
 *
 * ⚠️ 刻意用 `globalThis.fetch` 而不是在模块顶部抓一份引用：
 *    测试靠替换 globalThis.fetch 来**杜绝真实网络**（见 seeds-proxy.test.ts），
 *    提前抓引用会让替换失效 —— 而"测试意外打到用户的生产上游、
 *    甚至真的插进去一条记录"是这个模块最不能犯的错。
 */
async function request(path: string, options: RequestOptions): Promise<UpstreamResult<unknown>> {
  const label = `${options.method} ${path}`;

  let url: string;
  try {
    const target = new URL(`${upstreamBaseUrl()}${path}`);
    for (const [name, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) target.searchParams.set(name, value);
    }
    url = target.toString();
  } catch (error) {
    // 配错的 MCSR_SEED_API_BASE 不该变成 500，更不该让整个服务起不来
    console.error('[seeds] 上游地址配置无效（MCSR_SEED_API_BASE）:', error);
    return { ok: false, kind: 'unavailable', detail: '上游地址配置无效' };
  }

  const timeoutMs = upstreamTimeoutMs();
  let response: Response;
  try {
    response = await globalThis.fetch(url, {
      method: options.method,
      headers:
        options.body === undefined
          ? { accept: 'application/json' }
          : { accept: 'application/json', 'content-type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      /*
       * ★ 超时就在这里。
       *
       * 用 AbortSignal.timeout 而不是自己 setTimeout + AbortController：
       * 少一份"忘记 clearTimeout"的可能，而且它同时中止**读取响应体**
       * （下面 .json() 的 catch 会接住那种情况）—— 一个连上就再也不发完
       * 响应体的上游，同样不能让我们自己的页面一直转圈。
       */
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const detail = describeFetchError(error, timeoutMs);
    console.error(`[seeds] 上游请求失败（${label}）：${detail}`);
    return { ok: false, kind: 'unavailable', detail };
  }

  if (!response.ok) {
    const detail = `${label} → HTTP ${String(response.status)} ${await readSnippet(response)}`;

    // 404 是常态（上游只有约 80% 覆盖），不需要在日志里刷屏
    if (response.status === 404) return { ok: false, kind: 'not_found', detail };
    // 409 是很正常的用户结果（"这条已经录过了"），也不打日志
    if (response.status === 409) return { ok: false, kind: 'conflict', detail };

    if (response.status === 429) {
      console.error(`[seeds] 上游在限我们的流（${detail}）—— 我们打得太快了`);
      return { ok: false, kind: 'unavailable', detail };
    }

    if (response.status >= 500) {
      console.error(`[seeds] 上游故障：${detail}`);
      return { ok: false, kind: 'unavailable', detail };
    }

    // 其余 4xx：上游说"你的请求本身不对"。这**不是**用户的锅，
    // 而是我们的适配层和上游对不上了 —— 归成 rejected，让路由返回 500。
    console.error(`[seeds] 上游拒绝了我们的请求（多半是适配层写错了）：${detail}`);
    return { ok: false, kind: 'rejected', detail };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    const detail = `${label} → 响应体不是合法 JSON（${describeError(error)}）`;
    console.error(`[seeds] ${detail}`);
    return { ok: false, kind: 'unavailable', detail };
  }

  const envelope = asRecord(body);
  if (!envelope) {
    console.error(`[seeds] ${label} → 响应不是 JSON 对象`);
    return { ok: false, kind: 'unavailable', detail: `${label} → 响应不是 JSON 对象` };
  }

  if (envelope.success !== true) {
    const message = typeof envelope.message === 'string' ? envelope.message : '';
    console.error(`[seeds] ${label} → success != true（message=${message}）`);
    /*
     * 200 外壳但 success:false：上游用自己的方式拒绝了，而**状态码里看不出
     * 原因**。只能看它那句话 —— 这段文字只用来分类，既不进响应，
     * 也不在日志以外的地方出现。
     *
     * ⚠️ 三类的**顺序不能换**：
     *   1. `conflict` 只可能在**写**路径上出现（只有 POST /seed 会重复录入）
     *   2. `empty` 其次 —— "没有找到符合条件的种子"这句话里通常**同时**含
     *      "没有"和"种子"，如果让 duplicate 先跑，未来某个上游文案里出现
     *      "seed" 或 "unique" 就会把一次正常空结果拐成 409"已经录过了"
     *   3. 剩下的一律 `rejected`
     *
     * ⚠️ D20：`looksLikeDuplicate` **绝不能作用在读端点上**。
     *    读端点拿到 success:false 时回 409 seed_exists（"这条比赛 ID 已经录过了"）
     *    对一次随机查询毫无意义 —— 用户没有录任何东西，却被告知重复了。
     *    而 409 的界面文案明确写着"不用再录一遍"，直接指向一个错误的下一步。
     */
    const kind: UpstreamFailure =
      options.method === 'POST' && looksLikeDuplicate(message)
        ? 'conflict'
        : looksLikeNoResults(message)
          ? 'empty'
          : 'rejected';
    return { ok: false, kind, detail: `${label} → success=false message=${message}` };
  }

  return { ok: true, data: envelope.data };
}

/** 读一小段响应体，**只为了日志**。截断是因为它可能是一整页 HTML 报错页。 */
async function readSnippet(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 200);
  } catch {
    return '(响应体读不出来)';
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * 把 fetch 抛出来的东西变成一句能排查的话。
 *
 * ⚠️ undici 把真正的网络原因塞在 `cause` 里（ECONNREFUSED / ENOTFOUND / …），
 *    只看 message 的话日志里全是 "fetch failed"，等于什么都没记。
 */
function describeFetchError(error: unknown, timeoutMs: number): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') return `超时（${String(timeoutMs)}ms）`;

  const message = error instanceof Error ? error.message : String(error);
  const cause: unknown = error instanceof Error ? error.cause : undefined;
  const code = asRecord(cause)?.code;
  return typeof code === 'string' ? `${message}（${code}）` : message;
}

/**
 * 上游 200 + `success:false` 时的兜底分类。
 *
 * 为什么需要它：重复录入按文档是 **409**，但上游的 OpenAPI 只列了 200/422
 * 两个响应，而 409 这一条我无法在不真的往用户数据库里插一条记录的前提下去
 * 核实。万一上游对重复用的是 200 + success:false，用户会看到"出错了"而不是
 * 「这条比赛 ID 已经录过了」—— 而那恰恰是这个接口最可能遇到的一种结果。
 *
 * ⚠️ 它只读**上游自己那句话**，绝不外传（Q14）。
 */
function looksLikeDuplicate(message: string): boolean {
  return /已存在|已经存在|重复|已录|exists|duplicate|unique/i.test(message);
}

/**
 * 上游用一句话说"这次没有命中任何一条"。
 *
 * ⚠️ 和 `looksLikeDuplicate` 一样，它读的也是**上游自己那句话**，
 *    而且同样绝不外传（Q14）—— 它的唯一作用是选一个归一化类别。
 *
 * ⚠️ 匹配**英文**时必须限定在"没有结果"的意思上，不能只匹配 `not found`：
 *    `POST /seed` 在 matchId 已存在时也可能说 "record not found" 之类的怪话，
 *    而那时正确的答案是 409 而不是"没查到"。所以 duplicate 的判据先跑
 *    （见 request 里的顺序），这里只兜住明显是"空结果"的说法。
 */
function looksLikeNoResults(message: string): boolean {
  return /没有|未找到|找不到|无符合|无匹配|空结果|no\s+(?:matching\s+)?(?:seed|record|result|data)|no\s+results?|not\s+found|nothing\s+found|empty/i.test(
    message,
  );
}

// ---------------------------------------------------------------------------
// 公开的上游调用
// ---------------------------------------------------------------------------

/**
 * 随机一条（可带筛选）。
 *
 * ⚠️ 随机**绝不缓存**：上游的 `/seed` 是"随机取一条"，缓存它等于把"随机"
 *    变成"永远同一条"，那不是优化，是 bug。见 routes/seeds.ts。
 */
export async function fetchRandomSeed(
  filters: SeedFilters = {},
): Promise<UpstreamResult<SeedQueryResult>> {
  const result = await request('/seed', {
    method: 'GET',
    query: {
      overworld: filters.overworld,
      nether: filters.nether,
      variations: filters.variations,
      without: filters.without,
      completion: filters.completion === undefined ? undefined : String(filters.completion),
    },
  });
  if (!result.ok) return result;

  const data = asRecord(result.data);
  /*
   * ⚠️ `data` 是 null / 缺省，在**随机查询**这条路上要读成"没有符合条件的一条"，
   *    而不是"上游返回的形状坏了"。
   *
   *    判据的边界刻意划在这里：
   *      · `data` 压根不是对象   → 上游明确说了"没有"，这是筛选叠加的正常结果
   *      · `data` 是对象但字段坏 → 形状错误（真 bug），仍然走 badShape → 502
   *    猜测猜错时的代价也不对称：把空结果报成 502，用户会一直重试而永远没结果；
   *    把一次真形状错误报成 404，用户看到"没查到"然后去放宽条件 —— 两种都不会
   *    造成数据损坏，但后者不会让人以为站点坏了。真正的线索在日志里，那里有区分。
   */
  if (!data) {
    console.error('[seeds] GET /seed → data 为空，按"没有符合条件的种子"处理');
    return { ok: false, kind: 'empty', detail: 'GET /seed → data 为空' };
  }

  const seed = normalizeSeedRecord(data);
  if (!seed) return badShape('GET /seed');

  return { ok: true, data: { seed, availableCounts: asNumber(data.availableCounts) } };
}

/** 按比赛 ID 取三个世界的种子值。 */
export async function fetchSeedByMatchId(matchId: number): Promise<UpstreamResult<SeedRecord>> {
  const result = await request(`/seed/${String(matchId)}`, { method: 'GET' });
  if (!result.ok) return result;

  const data = asRecord(result.data);
  if (!data) return badShape(`GET /seed/${String(matchId)}`);

  /*
   * ⚠️ 上游把三个种子值包在 `seeds` 里，而 `/seed` 是平铺的（不一致之四）。
   *    这里用一次展开摊平，而不是逐字段抄一遍 —— 摊平之后就只剩
   *    normalizeSeedRecord 这一份解析代码，两个端点不会"改了一个忘了另一个"。
   */
  const seeds = asRecord(data.seeds) ?? {};
  const seed = normalizeSeedRecord({ ...data, ...seeds });
  if (!seed) return badShape(`GET /seed/${String(matchId)}`);

  return { ok: true, data: seed };
}

/** 按比赛 ID 取详细信息（结构 + 变种）。 */
export async function fetchSeedInfo(matchId: number): Promise<UpstreamResult<SeedInfo>> {
  const result = await request(`/seedinfo/${String(matchId)}`, { method: 'GET' });
  if (!result.ok) return result;

  const data = asRecord(result.data);
  if (!data) return badShape(`GET /seedinfo/${String(matchId)}`);

  return {
    ok: true,
    data: {
      matchId: asNumber(data.matchId),
      /*
       * ★ 一个 ensure-uppercase，而不是"上游给大写我们就照抄"：
       *   上游哪天改成小写（它自己的筛选参数就是小写），这里不会跟着变，
       *   界面上的"村庄/VILLAGE"也不会突然对不上词表。toUpperCase 对已经
       *   是大写的值没有副作用。
       */
      overworld: asUpperString(data.overworld),
      nether: asUpperString(data.nether),
      // ★ 二次 JSON.parse（不一致之二）
      endTowers: parseTowerList(data.end_towers),
      variations: parseVariationList(data.variations),
    },
  };
}

/**
 * 把一条记录写进上游的数据库。
 *
 * ⚠️ 这是**写**接口（用户决定暂时暴露，见 docs/m4-decisions.md Q15）。
 *    守卫（登录 + 邮箱验证 + 独立限流 + 审计 + 开关）全在 routes/seeds.ts，
 *    这个函数只负责"请求形状"和"错误归一化"。
 */
export async function createSeedRecord(
  input: SeedCreateInput,
): Promise<UpstreamResult<SeedRecord | null>> {
  /*
   * 请求体形状**来自上游自己的 OpenAPI**（`GET /openapi.json` 的
   * components.schemas.SeedCreateRequest）：平铺的 matchId / matchDate /
   * overworldSeed / netherSeed / theEndSeed，只有 matchId 与两个种子是 required。
   *
   * ⚠️ 这和我们读的那份文档（说上游是 v2.0.0）有出入：上游实际是 **v2.1.0**，
   *    文档里的表格也没写 POST 的请求体。所以这里以 OpenAPI 为准。
   */
  const body: Record<string, unknown> = {
    matchId: input.matchId,
    overworldSeed: input.overworldSeed,
    netherSeed: input.netherSeed,
  };
  /*
   * 可选字段**缺省就不发**：schema 里它们是可选的，发一个 null 依赖上游把
   * "显式 null"当"没给"处理 —— 少发一个字段在两种实现下都对。
   */
  if (input.theEndSeed) body.theEndSeed = input.theEndSeed;
  if (input.matchDate) body.matchDate = input.matchDate;

  const result = await request('/seed', { method: 'POST', body });
  if (!result.ok) return result;

  const data = asRecord(result.data);
  /*
   * 上游对 POST 的 data 没给任何保证（可能是 null）——所以这里**允许**没有记录。
   * "写进去了"这件事由 HTTP 状态 + 外壳的 success 保证，不靠 data。
   */
  return { ok: true, data: data ? normalizeSeedRecord(data) : null };
}

// ---------------------------------------------------------------------------
// 解析与归一化
// ---------------------------------------------------------------------------

/**
 * 归一化一条种子记录。**解析不出来就返回 null**（由调用方报"暂时不可用"）。
 */
function normalizeSeedRecord(source: Record<string, unknown>): SeedRecord | null {
  const overworldSeed = asSeedString(source.overworldSeed);
  const netherSeed = asSeedString(source.netherSeed);

  /*
   * 主世界/下界这两个是**必须**有的（上游的 SeedCreateRequest 也把它们列为
   * required）。少一个就说明上游改了形状 —— 此时宁可报"暂时不可用"，
   * 也不要给界面一张种子值为空的卡片：用户会从那张卡片上复制到一个空字符串，
   * 而它看起来就像"这个种子就是这样"。
   */
  if (overworldSeed === null || netherSeed === null) return null;

  return {
    /*
     * /seed 上这个字段叫 `id`（实测 id 就是 matchId，见文件头不一致之四）。
     * 统一成 matchId，界面才不用为"随机结果"和"按 ID 查"写两套读取代码。
     */
    matchId: asNumber(source.matchId ?? source.id),
    matchDate: asNumber(source.matchDate),
    overworldSeed,
    netherSeed,
    theEndSeed: asSeedString(source.theEndSeed),
  };
}

/**
 * 解析"被字符串包住的 JSON 数组"（不一致之二）。
 *
 * ⚠️ 三种输入都要接住，因为上游这个 bug 随时可能被它自己修掉：
 *   · 字符串 `"[76, 79]"` → JSON.parse（**现状**）
 *   · 真的数组 `[76, 79]` → 直接用（上游修好之后）
 *   · null / undefined / 空串 → `[]`（"没有变种"和"解析失败"都归这里）
 *
 * 解析失败**不抛**：整个 seedinfo 因为一个字段坏掉就完全打不开，代价比少显示
 * 一组塔大得多。但也**不是静默**：字段名和原文片段（截断）会进日志。
 */
function parseJsonArray(value: unknown, field: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  if (typeof value !== 'string') {
    console.error(`[seeds] 上游字段 ${field} 的类型无法解析：${typeof value}`);
    return [];
  }

  const text = value.trim();
  if (text === '') return [];

  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    console.error(`[seeds] 上游字段 ${field} 解析出来不是数组：${text.slice(0, 120)}`);
    return [];
  } catch (error) {
    console.error(`[seeds] 上游字段 ${field} 不是合法 JSON：${text.slice(0, 120)}`, error);
    return [];
  }
}

/**
 * 末地塔坐标。非数字条目**丢掉**而不是原样透传 —— 界面拿它渲染不出任何东西，
 * 而一个 `null` 混进 `number[]` 会让前端的类型断言变成一句谎话。
 */
function parseTowerList(value: unknown): number[] {
  const towers: number[] = [];
  for (const item of parseJsonArray(value, 'end_towers')) {
    if (typeof item === 'number' && Number.isFinite(item)) towers.push(item);
    else if (typeof item === 'string' && /^-?\d+$/.test(item.trim())) towers.push(Number(item));
  }
  return towers;
}

/**
 * 变种词条。
 *
 * ⚠️ **不做大写转换**：它们是命名空间 id（`biome:structure:plains`），
 *    大写之后就再也匹配不上词表了。上游大小写不一致的那个问题只存在于
 *    overworld / nether 这种**枚举值**上（不一致之一）。
 * ⚠️ 也**不过滤 `end_spawn:*`**：用户说上游那个**筛选项**有 bug（所以查询参数里
 *    我们直接拒绝它，见 routes/seeds.ts），但它是这条种子的真实属性
 *    （实测 seedinfo 就返回了 `end_spawn:buried:56`）—— 从结果里剔掉等于撒谎，
 *    而且会让"界面上显示 8 条变种，词表里只有 7 种"变成无法解释的怪事。
 * ⚠️ 同样**不去重**：上游会给重复词条（实测那条就有两个 `biome:structure:plains`）。
 *    去重会毁掉一个我们无法排除的可能 —— "重复"也许是有信息的（同一类型的两座
 *    结构各贡献一条）。所以这里保持无损：**要不要按集合显示是界面的事**，
 *    界面知道自己是在列"词条"还是在数"实例"。
 */
function parseVariationList(value: unknown): string[] {
  return parseJsonArray(value, 'variations')
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item !== '');
}

/** 形状不对（上游改了字段名/结构）。归成"暂时不可用"，细节进日志。 */
function badShape(label: string): UpstreamFailureResult {
  console.error(`[seeds] 上游响应形状和预期对不上：${label}`);
  return { ok: false, kind: 'unavailable', detail: `${label} → 响应形状对不上` };
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 种子值：只接受字符串，空串视为"没给"。**绝不 Number()**（见 SeedRecord 的说明）。 */
function asSeedString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asUpperString(value: unknown): string | null {
  const text = asSeedString(value);
  return text === null ? null : text.trim().toUpperCase();
}
