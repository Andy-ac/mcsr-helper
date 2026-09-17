/**
 * Ranked 实时信息 —— 这一栏的失败 → **用户能看懂的一句话**。
 *
 * ===========================================================================
 * 这一层为什么存在：这三句话就是我们全部的线索
 * ===========================================================================
 * ②③④ 三个面板由访客的浏览器**直连**上游，所以上游那一边的失败我们在服务端**看不到**
 * （spec §3 代价 1：日志里一个字都没有）。⇒ 访客屏幕上那句话，就是我们关于这次失败的
 * 全部信息。于是「连不上上游」「上游回了看不懂的东西」「上游说没有这一周」必须**分开说**，
 * 而不是都塌成一句"出错了" —— 用户下一步做的事完全不同（等 / 等 / 别等了）。
 *
 * 形状照 `lib/shareErrors.ts`：一个纯函数，吃 `(error, t, fallback)`，吐出一句**已经翻译好**的话。
 * `fallback` 由调用方给（`useApiErrorText()` 的结果），它负责那些**这一层认不出来**的失败。
 *
 * ===========================================================================
 * ⚠️★ 映射写成一张**导出的表**，不是一串 if
 * ===========================================================================
 * `lib/shareErrors.ts` 上有过教训：一张谁都看不见的 `switch` 被对调两行是**全静默**的 ——
 * 界面照样渲染、类型检查照样过（每一格都是 `string`）、门禁一个都不看它。
 * ⇒ `RANKED_ERROR_KEYS` **导出**，`apps/web/scripts/rankedrender.tsx` 逐格断言它，
 *   **并且**用记录器走一遍 `describeRankedError` 的真实输出：
 *   表对了但派发不查表，同样是一个缺陷（表在那里摆着、没人用它）。
 *
 * ===========================================================================
 * ⚠️⚠️ 我们那个端点的**码，今天读得到了** —— 但状态码兜底**仍然**要留着
 * ===========================================================================
 * 服务端回的是 `{ error: 'ranked_busy' }` 这样的码（`services/api/src/routes/ranked.ts`：
 * 429 `rate_limited` / 502 `upstream_bad_response` / 503 `ranked_busy` / 503 `upstream_unavailable`）。
 * **评审修复轮 1 之前**这一层读不到它们：`fetchRankedStatus` 走的是 `lib/api.ts` 的 `request()`，
 * 而那个 GET 助手**只读状态码、不读响应体** ⇒ `ApiError.code` 恒为 `undefined`，
 * 于是 503 的两档在客户端长得一模一样，`busy` 那一格**永远走不到**。
 * ⇒ 现在这一个端点走 `request()` 的兄弟 `requestWithErrorCode()`（`api.ts`，**全仓只有它一处调用**）：
 *   非 2xx 时读响应体，把 `error` 当 `ApiError.code` 交下来 —— 503 的两档从此分得开。
 *   ⚠️ `request()` 的**行为**一个字节没变（签名还是那三个参数、消息与状态码逐字相同）；
 *      变了的是它的**函数体**——评审修复轮 2 让它转发给两条读路径共用的 `requestCore()`
 *      （轮 1 留下的两个逐字重复的函数体就是评审重要 2）。改它的行为会换掉全站约三十条 GET
 *      的错误形状，所以"要不要读体"那个开关仍然只有这一个端点打开
 *      ⇒ 别的读端点上 `code` 仍是 `undefined`：**别从这里推"全站都有码了"**
 *      （`lib/seedErrors.ts` 的文件头记着同一处断链，那里今天仍然损失更大 —— 它连 reason 都拿不到；
 *      本轮**没有**顺带修它，那是它自己的一次改动）。
 * ⚠️★ 状态码兜底（`apiStatusSource`）**不是**死代码，两条理由都真实存在：
 *   1. 服务端哪天回一个这里没登记的码（`apiCodeSource` 认不出来就回 `null`），
 *      兜底至少还说得出"哪一档"；
 *   2. 429 那一档本来就不需要码：端点契约里 429 只可能是我们自己的限流，与码的结论一致。
 * ⚠️★ 兜底里**没有 502**（评审重要 3 删掉的，理由写在这里免得它被"补回来"）：
 *   502 的契约值 `upstream_bad_response` 只可能**从 body 里的码**来（有码时照样认得出、
 *   照样说「上游返回的数据看不懂」）；而**码读不到**的 502 恰恰是**反代**自己发的
 *   （Vite 的代理 / Caddy：body 为空、上游**根本没被问到**）——
 *   那时上游是健康的、坏的是我们这条链路，说"上游返回的数据看不懂"就是**怪错了第三方**
 *   （文件头最后一节谴责 `status === 0` 的是同一件事，两处是同一种错）。
 *   ⇒ 认不出来的 502 一律回 `null`，由调用方的 `fallback` 说话：那句话本来就是**真的**
 *   （⚠️ 实测：`useApiErrorText` → `apiErrorText` 对"非 0 状态码 + 认不出来的码"回的是
 *   `auth.genericError`「出错了，请稍后再试。」—— 它一个字都没指责任何一方）。
 *   ⚠️ 这里早先引的是另一句「API 返回 HTTP 502 —— 本地开发时后端没启动？…」：**引错了**
 *   （2026-09-16 终审量到）。那一句是 `ApiError.message`，它只在 `status === 0`
 *   （连不上**我们自己的**服务器）那一支被 `apiErrorText` 用上 —— 也就是它恰恰属于
 *   "我们这条链路坏了"这一档，而这一格讲的是**反代**发的 502。结论不变（都不许怪上游），
 *   变的只是"那句话到底长什么样"。
 *   否决了"留着它，因为 `upstream_bad_response` 最常见"：最常见的那条路**已经有码了**，
 *   这一格只在码读不到时被走到，而码读不到时的 502 恰好是**最不该**赖上游的那一种。
 * 顺序是**码优先、状态码兜底**（写在 `rankedErrorDetail` 里，两个导出函数都从那一处取结论）：
 * 两者冲突时以**码**为准，因为码是服务端**特意为了区分 503 那两档**才写进 body 的。
 * 历史（它解释了 `apiStatusSource` 为什么给 503 选 `unavailable`）：码读不到的那一天，
 * 503 只能取**不会说错**的那一档 —— 反过来取 `busy` 会把"上游整个挂掉"说轻，
 * 而那会让用户以为"再等等就好"、实际上要等的是上游修好。
 *
 * ===========================================================================
 * ⚠️ 认不出来的失败**不编一句话**（`rankedErrorSource` 因此回 `null`）
 * ===========================================================================
 * 第三个参数 `fallback` 必须在**这一类**上用掉：`ApiError` 的 `status === 0`
 * ——那是**我们自己的服务器**连不上（`api.ts` 给的那条 message 比任何兜底都准）。
 * 把它说成"上游暂时读不到"是**把责任推给第三方**：用户以为要等上游，而真正没起来的是我们。
 * ⇒ `rankedErrorSource` 表达得出"我认不出来"（`RankedErrorSource | null`），
 *   而不是硬塞进七个格子里的某一个。
 *   ⚠️ 计划里那个签名写的是非 null 的 `RankedErrorSource`。**这是一处有意的偏差**：
 *     那个签名会让 `describeRankedError` 的 `fallback` 永远不被调用 ——
 *     一个"给了却用不上"的参数，与 `shareErrors.ts` 那句"给认不出来的东西一个兜底"直接矛盾。
 *     改的只是 `rankedErrorSource` 的**返回类型**（多一个 `| null`），
 *     `describeRankedError` 的签名、七格表、七个 key 一个字没动。
 * ⚠️★ 评审修复轮 2 之后，"认不出来"多了一种情形，而判据仍然只有一处：直连那个
 *   `RankedDirectError('http', …)` 没带状态码时（渲染自检**手搓**错误就会这样），
 *   `errHttp` 的 `{{status}}` 填不出来 ⇒ 一样回 `null` 走 `fallback`，
 *   而不是印出一个「上游回了一个错误（HTTP ）。」—— 那正是本轮修掉的那个缺陷的另一种写法。
 *   ⚠️ 同一轮把"这是什么失败"收进了私有的 `rankedErrorDetail()`：`rankedErrorSource` 取它的
 *   一半（source，给逐格断言用），`describeRankedError` 取另一半（`errHttp` 要的那个数字）——
 *   两半必须从**同一个判断**出来，否则就是那种会漂移的第二份规则。
 */
import { ApiError } from '@/lib/api';
import { RankedDirectError } from '@/lib/rankedDirect';

/** `t()` 的最小形状（与 `lib/shareErrors.ts` 里那一个同形，各自独立、不互相 import）。 */
export type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * 这一栏**全部**的失败来源 —— 七个，一个不多一个不少。
 *
 * ⚠️★ 2026-09-19 这一栏还多过**另一族**失败：「**这个昵称**不行」的两种 400
 *    （查无此人 / 昵称不合法，`rankedDirect.ts` 的 `RankedLookupError`）。
 *    它**不进这个文件**：容器把那两档直接渲染成 `.ranked__lookup` 里的
 *    `lookupNotFound` / `lookupInvalid`（上游对那两个 400 的回答是**确定的**、重试没用，
 *    而这一层每一句说的都是"这一次请求没成功，稍后再试"——两族的方向正好相反）。
 *    ⇒ T1 曾在这里放过一张 `RANKED_LOOKUP_ERROR_KEYS` 加一支派发，修复轮（T4）把它们
 *    **删掉了**：它们从落地起就没有任何生产调用者（"没有消费者的 key 不留"）。
 *    ⚠️ 所以读这个文件时的心智模型是**一张表、一族失败**。下次想"顺手加一条查人错误"的人
 *    请先去看容器与 `RankedPanels.tsx`：那一档住在 `.ranked__lookup` 里，不在这一层。
 *
 * 前四个（`network` / `http` / `not_found` / `bad_response`）来自**直连**
 * （`RankedDirectError` 五个原因里除去 `rated` 的那四个），后三个（`busy` / `unavailable` /
 * `rated`）来自**我们自己的端点**（`GET /api/ranked/status` 的四个码：429 `rate_limited` /
 * 502 `upstream_bad_response` / 503 `ranked_busy` / 503 `upstream_unavailable`）。
 * ⚠️★ `rated` 是**唯一两头都有**的一格：上游按访客自己的 IP 限流时，直连层直接给 `rated`
 *    （`rankedDirect.ts` 的 429 那一支）；我们那个端点被限流时，它从码或状态码来 ——
 *    而 spec §7.3 那句话（「请求有点频繁，过一会儿再试。」）对两种情况都成立，
 *    这正是它当初被写成独立一条（而不是复用全站 `rate_limited`）的理由。
 * ⚠️ **码是权威判据**（`apiCodeSource`），状态码只在码读不到或认不出来时兜底
 *    （`apiStatusSource`）—— 503 那两档**只有响应体分得开**（见文件头）。
 * ⚠️ 类型是**手抄**的联合（上游给过来的是字符串）：服务端哪天加一个码，这里不会有编译错误
 *    —— 那一支由 `rankedErrorSource` 的兜底挡住、走调用方的 `fallback`，
 *    而不是在这里假装认识它（`shareErrors.ts` 里那条 `isShareStateReason` 是同一条规矩）。
 */
export type RankedErrorSource =
  | 'network'
  | 'http'
  | 'not_found'
  | 'bad_response'
  | 'rated'
  | 'busy'
  | 'unavailable';

/**
 * ★★ source → 词条 key —— **本文件里唯一的一份映射**。
 *
 * ⚠️★ 它**导出**，唯一理由是：`apps/web` 没有测试运行器，而 `apps/web/scripts/rankedrender.tsx`
 *    要**逐格**断言这张表，再用记录器走一遍 `describeRankedError` 的真实输出
 *    （换掉两格的对应关系在全仓是**全静默**的，理由见文件头）。
 * ⚠️ 这七条 key 的**值**（中文/英文）住在 `packages/shared/src/i18n/` 里，由 T7 落地；
 *    它们不是字面量 `t('…')` 调用点了，所以 `services/api/src/i18n-keys.test.ts` 的字面量扫描
 *    覆盖不到它们 —— 存在性由渲染自检**逐格**守着（`rankedrender.tsx` 的 ⑥b：七条 × 两种语言
 *    各查一次存在性、真值与非空）。`shareErrors.ts` 的 `SHARE_STATE_REASON_KEYS`
 *    是同一处置，那条注释里写着"表里的数据不再是调用点"。
 *    ⚠️★ 这里早先写的是"存在性由渲染自检守着"，而**当时它并没有守**（2026-09-16 终审量到：
 *    那个脚本只逐格断言了这张表的**值**、并用记录器走了一遍派发，存在性那一圈是空的）。
 *    为什么那种"空"很难被发现：七条 key 里**绝大多数在产物里根本不会出现**
 *    （失败那句话在界面上是一件已经翻好的字符串，不是 key）⇒ ⑩ 的裸 key 扫描看不见它们；
 *    而"两份字典里**都**少掉同一条"对全仓的语言对齐测试同样是隐形的（两边都没有 ⇒ 对齐）。
 *    ⇒ 那个逐格循环补上了（与 ⑨ 的 `TIMELINE_LABEL_KEYS` 逐格循环同一形状、同一条理由）。
 */
export const RANKED_ERROR_KEYS: Record<RankedErrorSource, string> = {
  network: 'ranked.errNetwork',
  http: 'ranked.errHttp',
  not_found: 'ranked.errNotFound',
  bad_response: 'ranked.errBadResponse',
  busy: 'ranked.errBusy',
  unavailable: 'ranked.errUnavailable',
  rated: 'ranked.errRateLimited',
};

/*
 * ⚠️★ 这里曾经有一张 `RANKED_LOOKUP_ERROR_KEYS`（`ranked.errUserNotFound` /
 * `ranked.errInvalidIdentifier`）与 `describeRankedError` 里对应的一支，**2026-09-19
 * 修复轮（T4）删掉了**：那是**另一族**失败（"这个昵称不行"，重试没用），而容器从来没有
 * 把它交给这一层 —— 那一档渲染在 `.ranked__lookup` 里（`ranked.lookupNotFound` /
 * `lookupInvalid`）⇒ 两条词条 + 一张表 + 一支派发**没有一个生产调用者**，
 * 正是本仓"没有消费者的 key 不留"那条纪律要删的东西。
 * **别再加回来**：要加之前先指出一个会走它的调用点。
 */

/**
 * 我们那个端点回的码 → source。**认不出来的码回 `null`**（交给状态码兜底）。
 *
 * ⚠️ 这一段是**唯一能分开 503 两档**的地方（`ranked_busy` / `upstream_unavailable`），
 *    而它今天真的会被走到：`fetchRankedStatus` 走的是 `requestWithErrorCode()`，
 *    会把 body 里的 `error` 当 `ApiError.code` 交下来（评审修复轮 1，见文件头）。
 * ⚠️ 认不出来就回 `null`、**不猜**：服务端哪天多一个码，这里是唯一会"假装认识它"的地方 ——
 *    而假装认识的代价是给用户一句**方向可能错了**的话，那比一句笼统的兜底差得多。
 */
function apiCodeSource(code: string | undefined): RankedErrorSource | null {
  switch (code) {
    case 'ranked_busy':
      return 'busy';
    case 'upstream_unavailable':
      return 'unavailable';
    case 'upstream_bad_response':
      return 'bad_response';
    case 'rate_limited':
      return 'rated';
    default:
      return null;
  }
}

/**
 * 码读不到（或认不出来）时的**状态码兜底** —— 今天仍然会走到（没登记的码、没码的 429）。
 *
 * ⚠️ 只列**端点契约里钉死**的两个状态（`routes/ranked.ts`）：429 只可能是我们自己的限流、
 *    503 是那两档之一。
 *    ⚠️ 503 在这里**只能**取 `unavailable`：只有状态码时那两档长得一模一样，取"不会说错"的
 *    那一档 —— 把"上游整个挂掉"说轻（"有点忙，再等等"）等于给用户一个**错的方向**，
 *    而把"上游在限我们的流"说成"暂时读不到"只是模糊一档。**有码时根本不看这里。**
 * ⚠️★ **502 不在这里**（评审重要 3）：契约里那个 502 的码是 `upstream_bad_response`，
 *    它**有码**、由 `apiCodeSource` 说成「上游返回的数据看不懂」；而**没有码**的 502
 *    恰恰是**反代**自己发的（Vite 的代理 / Caddy：body 为空、上游根本没被问到）——
 *    两件事长得一模一样，责任方却相反，把后者说成"上游返回的数据看不懂"就是**怪错了第三方**。
 *    ⇒ 它落进下面的 `default`，由调用方的 `fallback` 说一句**真的**话
 *    （`auth.genericError`「出错了，请稍后再试。」—— 一句**笼统但方向不歪**的话，比一句
 *    把责任推给第三方的具体话好）。
 *    ⚠️ 这里早先引的是「API 返回 HTTP 502 —— 本地开发时后端没启动？…」（2026-09-16 终审量到：
 *    **引错了**）：那一句只在 `status === 0` 时才印得出来（`apiErrorText` 的最后一条分支），
 *    而本条讲的正是"状态码拿得到、责任方分不出"的那一类 —— 它的 fallback 是上面那句笼统的。
 *    其余的（0 / 404 / 500 / …）同样回 `null` ⇒ 调用方的 `fallback`，
 *    因为"我们服务器 500"与"上游 500"是两件完全不同的事，这里没有判据能分开它们，
 *    编一句"上游"只会把排查方向带偏。
 */
function apiStatusSource(status: number): RankedErrorSource | null {
  switch (status) {
    case 429:
      return 'rated';
    case 503:
      return 'unavailable';
    default:
      return null;
  }
}

/**
 * 一次问出**两件事**：这一格是谁，以及这一格要填的那个数字。
 *
 * ⚠️★ 为什么不能只问 source：`ranked.errHttp` 的冻结文案里有一个 `{{status}}` 占位符
 *    （spec §7.3：「上游回了一个错误（HTTP {{status}}）。」），而七个格子里**只有它**带占位符
 *    —— 其余六句都是完整的句子，一个变量都没有。占位符与它的取值必须在**同一处**决定：
 *    分成两处的话，"谁去填这个数字"就变成调用点的纪律，而漏填的样子是**静默**的 ——
 *    i18next 把缺的变量填成空串，用户看到「上游回了一个错误（HTTP ）。」，
 *    类型检查、lint、渲染自检一个都不报（这正是评审重要 1 修掉的缺陷）。
 * ⚠️ 说不出数字的 `http` **不猜**：`RankedDirectError` 是导出的类，渲染自检要**手搓**这些错误
 *    （T8 逐格断言那张表就是这么写的），"手搓时漏了第三个参数"因此是一个真实存在的状态 ——
 *    它今天只会印出一个空括号。⇒ 回 `null`，让调用方走 `fallback`
 *    （一句笼统但**完整**的话，好过一句带着空括号的"具体"话）。
 * ⚠️ 类型上把 `http` 那一支单列成 `{ source: 'http'; status: number }`，不是"顺手写清楚"：
 *    它让"`errHttp` 一定有数字可填"成为一条**类型**事实，下一个改这里的人不必再回去读
 *    `rankedDirect.ts` 才能确认。
 */
type RankedErrorDetail =
  | { source: 'http'; status: number }
  | { source: Exclude<RankedErrorSource, 'http'>; status: number | undefined };

function rankedErrorDetail(error: unknown): RankedErrorDetail | null {
  // 直连的五个原因**就是**五个 source，一一对应（`rankedDirect.ts` 的 `reason`）。
  if (error instanceof RankedDirectError) {
    if (error.reason === 'http') {
      return typeof error.status === 'number' ? { source: 'http', status: error.status } : null;
    }
    return { source: error.reason, status: error.status };
  }
  if (error instanceof ApiError) {
    // 按码优先：码是权威的那一个（它区分得开 503 的两档）。
    const source = apiCodeSource(error.code) ?? apiStatusSource(error.status);
    // ⚠️ 我们那个端点这一侧**没有** `http` 这一格（它的每一档都由码或状态码说清了），
    //    这里的 status 只是顺手带出来，**没有**哪一格会拿它去填占位符。
    return source === null ? null : { source, status: error.status };
  }
  return null;
}

/**
 * 把三种失败（**直连错误** / 我们 API 的 `ApiError` / 其它）归一成一个 source。
 *
 * ⚠️★ 它只是 `rankedErrorDetail()` 的**一半**（只要 source）：渲染自检要**逐格**断言这张表，
 *    按格问比按"格 + 数字"问更顺手，而"数字"那一半**只有** `describeRankedError` 用得上。
 *    两者共用同一个判断处 —— 各写一份"这是什么失败"正是那种会漂移的第二份规则。
 * ⚠️ 认不出来时返回 `null` —— **不要**把它当成"未知"以外的东西，调用方必须走 `fallback`
 *    （文件头最后一节写了为什么这一档不能编一句话）。
 */
export function rankedErrorSource(error: unknown): RankedErrorSource | null {
  return rankedErrorDetail(error)?.source ?? null;
}

/**
 * 失败 → **一句已经翻译好的话**。
 *
 * ⚠️★ 它必须**查表**（`t(RANKED_ERROR_KEYS[source])`），不是自己再写一遍映射：
 *    表对了但派发不查表，同样是一个缺陷（`shareErrors.ts` 的注释原话）。
 * ⚠️★ 选项**只给 `http` 那一格**：它是七句里唯一带 `{{status}}` 的（spec §7.3 的冻结文案）。
 *    给另外六句传选项不但没用，还会让人以为那六句可以参数化 ——
 *    下一个改文案的人会去文件里找"它们该填什么"，而那两个变量**不存在**。
 * ⚠️ 认不出来的失败走 `fallback`（`useApiErrorText()` 的结果）——见文件头最后一节：
 *    "我们自己的服务器连不上"那一档**只有**它能说对。
 * ⚠️★ 这里曾经**先判**「这个昵称有问题」那一族（`RankedLookupError`）—— 修复轮（T4）
 *    把那一支删掉了，理由与那张表同一条：**没有任何生产调用点**。它的 `kind` 里的
 *    `not_found` 与七格里那个 `not_found` 名字相近而意思完全不同（"没有**这一周**" vs
 *    "没有**这个玩家**"）：真把 `RankedLookupError` 递进来的话，它今天既不是
 *    `RankedDirectError` 也不是 `ApiError` ⇒ 落进 `fallback`，说的是一句**笼统但方向不歪**的话
 *    （"稍后再试"）—— 而那正是这一层对"我不认识这个失败"的一贯处置，不是一句假话。
 *    ⚠️ 走这一条的人是写错了调用点：容器把那一族渲染在 `.ranked__lookup` 里。
 */
export function describeRankedError(
  error: unknown,
  t: Translate,
  fallback: (error: unknown) => string,
): string {
  const detail = rankedErrorDetail(error);
  if (detail === null) return fallback(error);
  return detail.source === 'http'
    ? t(RANKED_ERROR_KEYS[detail.source], { status: detail.status })
    : t(RANKED_ERROR_KEYS[detail.source]);
}
