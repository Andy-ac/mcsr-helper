/**
 * 这一栏的**冻结常量**：端点地址、刷新间隔、条数、直连请求选项。
 *
 * ⚠️ 上游域名**只允许出现在这个文件里**（计划的 Global Constraints 第 1 条）：
 *    测试文件、直连层、端点实现里一律不许再写一次真实域名 —— 端点地址只有这一份，
 *    换域名（或加第三个入口）时改的是一行，而不是满仓 Search & Replace。
 */
import type { RankedTab } from './types';

/** ② 高分对局取前几场（spec §13「高分对局条数」）。 */
export const RANKED_LIVE_TOP = 10;

/** ③ 排行榜取前几名（上游实测给 150 条，我们只印前 100，spec §13「排行榜条数」）。 */
export const RANKED_ELO_TOP = 100;

/**
 * 每个面板的轮询间隔（毫秒）：状况 15s / 对局 10s / 排行榜 60s / 周赛 60s（spec §5.1）。
 *
 * ⚠️ 它是**穷尽 `Record`**（加第五个标签页时会编译报错），而不是一串 if：
 *    漏配一个面板的间隔，在 if 版本里表现为"这个标签页永远不刷新"，
 *    而那件事没有任何门禁能发现（页面看着完全正常）。
 * ⚠️ 这四个数是 spec §13 的冻结值：它们同时决定"多实时"与"多费访客自己的额度"
 *    （上游限流 500 次 / 10 分钟 / **访客 IP**），改一个都要同时改 spec §5.1 那张表。
 */
export const RANKED_POLL_MS: Record<RankedTab, number> = {
  status: 15_000,
  live: 10_000,
  elo: 60_000,
  weekly: 60_000,
};

/** 浏览器直连的**主入口**（上游文档说缓存 5 秒、推荐）。 */
export const RANKED_UPSTREAM_PRIMARY = 'https://api.mcsrranked.com';

/**
 * 浏览器直连的**兜底入口**：只在**网络错误/超时**时对同一路径重试一次（spec §5.2）。
 * ⚠️ 4xx/5xx **不重试** —— 那是上游在回答我们（"这一周不存在"就是一个合法的 400），
 *    重试只会把访客的额度再烧一次，还把一个确定的答案变成一次慢等待。
 */
export const RANKED_UPSTREAM_ALT = 'https://mcsrranked.com/api';

/**
 * 心跳里「Game Server」那一格在 `heartbeatList` / `uptimeList` 里的键。
 *
 * ⚠️ 它是**字符串**而不是数字：上游那个对象是 `{"2": [...]}`
 *    （JSON 的键永远是字符串），写成 `2` 去查表会读不到任何东西，
 *    而失败的样子是"状态永远是加载中"，看起来像网络问题。
 * ⚠️ 为什么是 `2` 而不是别的：上游的状态页把 Game Server 排在第二格（spec §2.2 实测）。
 *    这一栏只关心**游戏服务器**（②的对局、③的排行榜都在它上面），API/Store/Wiki 三格与我们无关。
 */
export const RANKED_MONITOR_ID = '2';

/**
 * 服务心跳的上游（**只能由我们的服务器去取**）。
 *
 * ⚠️ 这个主机**不发 `access-control-allow-origin`**（spec §2.5 实测）⇒
 *    浏览器读不到它的响应体。这不是"配置问题"，是对方没打算让浏览器直连，
 *    所以它是这一栏**唯一**必须走我们服务器的请求，也是我们唯一的服务端端点。
 * ⚠️ 名字里带 `STATUS_` 是故意的：它和上面两个直连入口**不是一类东西**，
 *    别为了让三段代码长得像而把它塞进直连层的入口表里 —— 那会让"心跳由谁发"这件事
 *    再也看不出来，而它正是这一栏架构上唯一的例外（spec §3）。
 */
export const RANKED_STATUS_UPSTREAM =
  'https://status.mcsrranked.com/api/status-page/heartbeat/mcsrranked';

/**
 * ★★ 直连请求的选项 —— **每一次**直连都必须带上它。
 *
 * ---------------------------------------------------------------------------
 * 实测（spec §2.5）：上游给了 `ETag` + `cache-control: max-age=14400`（4 小时）
 * ---------------------------------------------------------------------------
 * `api.mcsrranked.com` 的响应头是 `cache-control: max-age=14400` + `ETag`。
 * ⇒ 浏览器不特别指定的话，**第二次请求可能根本不发出去**，直接用 4 小时前的缓存
 *   ⇒ 「实时」面板会**冻住**（人数不动、对局还是那几场），
 *     而**从网络上完全看不出来**：DevTools 的网络面板里连一条请求都没有，
 *     控制台里也一个字都没有。这是本栏目最容易犯、也最难从画面上看出来的错。
 * ⇒ `cache: 'no-store'` 不是"优化"，它是这个面板**能不能实时**的前提。
 *   本仓同一个坑已经踩过一次：`fetchLiveChannelsFresh` 就是为此存在的。
 *
 * `credentials: 'omit'` 与 `referrerPolicy: 'no-referrer'`：访客直连意味着**访客的 IP 会到第三方**
 * （这是用户为了不占服务器限流额度而选的代价，spec §3 代价 2）。
 * 既然躲不掉，就把**能少给的东西少给**：不带任何 cookie、不带来源页地址。
 * ⚠️ 否决了"带 `credentials: 'include'` 也许能拿到更全的数据"：我们不登录、也没打算登录，
 *    带 cookie 只会把访客的第三方身份一起送过去，换不到任何一个字段。
 */
export const RANKED_FETCH_OPTIONS = {
  cache: 'no-store',
  credentials: 'omit',
  referrerPolicy: 'no-referrer',
} as const;

/**
 * 直连带的请求头。
 *
 * ⚠️ **只带 CORS 安全列表内的头**：`accept` 是安全列表里的（不会触发预检），
 *    而任何自定义头（`x-…`）都会让浏览器先发一次 `OPTIONS`
 *    —— 上游的 `OPTIONS` 我们**没验过**（spec §5.1 明确写了这一条）。
 *    万一它不回 `access-control-allow-headers`，结果不是"少一个头"，
 *    而是**整个请求失败**，且看起来像网络问题。
 * ⚠️ 也**不要**在这里写 `content-type`：GET 没有请求体，写了只会平白多触发一次预检。
 */
export const RANKED_FETCH_HEADERS = { accept: 'application/json' } as const;
