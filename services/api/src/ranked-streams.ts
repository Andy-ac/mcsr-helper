/**
 * Ranked 实时信息 → 「直播」频道：**一轮收录** —— 由 systemd timer 每 5 分钟拉起，跑完就退。
 *
 *     node /srv/mcsr-helper/api/ranked-streams.js      真正跑一轮
 *
 * 由 `deploy/mcsr-helper-ranked-streams.timer` 触发
 * `deploy/mcsr-helper-ranked-streams.service`，后者的 ExecStart 上套着 `flock -n`
 * （防重叠，见文件头第七节）。
 *
 * ⚠️ 路径写的是**部署之后**的样子：deploy.sh 把 dist 里的内容直接解到
 *    `/srv/mcsr-helper/api/` 下（**不是** `.../api/dist/`）—— 与 `admin-cli.ts` /
 *    `track.ts` 的文件头同一条。照着 `dist/ranked-streams.js` 敲会得到
 *    "Cannot find module"，而那个错误看起来像"文件没部署上去"。
 *
 * ⚠️★ 手工在服务器上敲它**可以**，但**绝不要加 sudo**（`track.ts` 文件头那一段逐字适用）：
 *    以 root 打开库会在 WAL 模式下生成 root 属主的 `-wal` / `-shm` 文件，之后以 `mcsr`
 *    运行的 API 就**写不进去**了 —— 而且是**静默失败**。要手工跑就用 `sudo -u mcsr node …`。
 *
 * ===========================================================================
 * 一、为什么是 CLI + timer，而不是挂进请求路径（2026-09-17 用户的裁决）
 * ===========================================================================
 * 用户要求：「从现在开始抓取 ranked 实时信息的 twitch 直播链接，将其自动添加至本应用的
 * 『直播』频道」。上一版（commit `a0a597f`）把它挂在 `GET /api/ranked/live` 这**一个请求**
 * 上，而那个前提是**假的**：② 的对局面板由**访客浏览器直连上游**（spec §3 的 A 方案，
 * 2026-09-16 用户裁决），于是那个端点**一个调用者都没有** ⇒ 线上一个频道都不会被收录，
 * 而门禁全绿。用户随后裁决：**改成一个小 systemd 作业（oneshot + 5 分钟 timer）**，
 * 与 `mcsr-helper-track.{service,timer}` 同形。三条理由：
 *   · **节拍是确定的** —— 没有人看页面时它照样跑（请求路径下"没人来就什么都不发生"，
 *     而那正是"这个功能到底在不在工作"最难回答的一种形态）；
 *   · **不在任何请求路径上** —— 访客的一次 GET 与这件事彻底解耦，没有任何一次请求
 *     会因为这次写库而变慢或失败（上一版为此写了一整套"吞掉一切"的契约，现在没了必要）；
 *   · **不动面板的断言套件** —— ② 的对局面板仍然是浏览器直连，`rankedrender.tsx` 那套
 *     断言一行都不用改（A 方案本身**没有**被推翻，见 `docs/ranked-live-spec.md` §3）。
 *
 * ⚠️ 被否掉的两条路（写下来，免得下次有人再想一遍）：
 *   · **挂进请求路径**（上一版）：没有调用者就是死代码 —— 路由与它的 handler 已经删掉了；
 *   · **常驻 worker / 在 API 进程里开一个定时器**：那要多一整套"它挂了谁发现"的机制
 *     （长驻进程的记忆、重启后的补偿、与新版本部署的竞态），而这一轮根本没有那个预算。
 *     oneshot 的失败形状是最简单的一种：退出码 + 一行日志（第三节）。
 *
 * ===========================================================================
 * 二、这条路上**没有任何凭据**（所以单元里没有 `EnvironmentFile`）
 * ===========================================================================
 * 上游 `api.mcsrranked.com` 的 `/live` 是**公开端点**（spec §2.1 实测：浏览器直连、
 * 不带任何 key/token 就取得到，那正是 A 方案成立的前提）。⇒ 本作业**不需要**凭据，
 * 单元里因此**故意不写** `EnvironmentFile=/etc/mcsr-helper/track.env`
 * （`track.{service}` 里有，因为那个作业真的要用 YouTube/Twitch 的密钥）。
 * ⚠️ 代价与收益：`EnvironmentFile` 给的是**整个进程**的环境 —— 这个作业一个密钥都用不上，
 *    让它看得见只是平白多一个泄漏面。⇒ 缺凭据在这里**不可能发生**，
 *    所以也没有 `track.ts` 那种"跳过并打印原因"的分支（那一条是给 `track.env` 写的）。
 *
 * ===========================================================================
 * 三、★ 失败必须非零退出，而且**一次运行只打一行**（唯一的护栏）
 * ===========================================================================
 * 上游的失败分三档（`RankedLiveFeedResult` 的 `ok:false`）：`unavailable`（抖了/超时/5xx）、
 * `busy`（429，在限我们的流）、`bad_response`（200 但形状读不懂 ⇒ 我们的适配层要改）；
 * 加上第四档这里自己产生的 `db`（写库失败）。四档**都要**做两件事：
 *   · **打一行**到 stderr（进 journald 时是 err 级 ⇒ `journalctl -p err` 看得见）；
 *   · **退出码 1** ⇒ systemd 把这一轮记成 `failed`，`systemctl --failed` 看得见。
 * 被否掉的做法是"退出码永远 0，靠人看日志"：那种实现会**悄悄停摆**
 * （timer 照常触发、部署脚本报成功、`list-timers` 一片健康，而库里几个月没有一行新的），
 * 这正是 `track.ts` 文件头第三节那个坑的同一个形状。
 *
 * ⚠️★ **一行**是刻意的，而且是这一版改掉的东西：上一版在**模块里**打日志
 *    （`live-feed.ts` 的 `[ranked-live] /live 取不到…` + `ingest.ts` 的 `[ranked-live] 自动收录失败…`），
 *    那在**请求路径**下是对的（一次尝试要能被多个请求共用一条记录）。
 *    而 oneshot 里"一次尝试"与"一轮"是**同一件事** ⇒ 两处各打一行就是把一次故障
 *    看成两次（`live-feed.ts` 自己写着那条规则的另一个形状："一个请求一行，
 *    等于把一次上游故障看成 N 次"）。⇒ 现在**只有 `main` 打印**，
 *    被调用的两层（`loadRankedLive` / `ingestRankedLiveChannels`）都把失败**返回**上来。
 *
 * ===========================================================================
 * 四、入库规则**不在这个文件里**（在 `ranked/ingest.ts`，那一份是冻结的）
 * ===========================================================================
 * 只要 twitch、`display_name` **就是** twitch login（不是选手的 MCSR 昵称）、
 * 标签 `["ranked"]`（不新增字段标记来源）、`sort_order = 1000`（排在编辑录的那些后面）、
 * `live_video_id = NULL`、**只插不改**（`DO NOTHING` 的 NULL 安全版本，
 * 因为 `UNIQUE (platform, handle, live_video_id)` 对 NULL 不生效 —— 那是本仓踩过的坑）。
 * ⚠️★ 运维那一条也写在那里，这里只重复结论：编辑想让某个自动收录的频道消失，
 *    正确的动作是**隐藏**，不是删除 —— 删掉把三列腾空了，下一轮（≤5 分钟）它就会回来，
 *    而隐藏之后那一行还在，三列仍然被占着，作业不会再加一条。
 *
 * ===========================================================================
 * 五、★ 时钟的单位是**毫秒**（与 `track.ts` 的**秒**不同，别照抄）
 * ===========================================================================
 * `now` 进的是 `live_channels` 的 `created_at` / `updated_at`，而 `live_channels` 这一族
 * 从第一天起就是**毫秒**：`routes/live.ts` 那一群写接口全是 `Date.now()`
 * （`createLiveChannel(input, Date.now())` …）。⇒ 这里也用毫秒，两个写入口才是同一个单位。
 * ⚠️ 与 `track.ts` 相反（那个作业的 `now` 必须是**秒**，因为 `tracked-videos.ts` 拿它
 *    直接与 `INCREMENTAL_INTERVAL_SEC = 3600` 相减）。填错的后果是**不报错**的：
 *    界面上的日期跑到 5 万年以后，而两个入口写进去的时间从此不能互相比较。
 *
 * ===========================================================================
 * 六、为什么这个文件有 `if (isMain)` 而 `admin-cli.ts` 没有
 * ===========================================================================
 * `ranked.test.ts` 要 import 这个文件来跑 `runOnce` / `main`（那些用例是这一轮的全部证据），
 * 而顶层直接"跑起来"的话，一 import 就会**真的打一次上游 + 真的写库**。
 * ⇒ 必须把"被执行"与"被 import"分开（`track.ts` 文件头第七节同一个理由）。
 *
 * ===========================================================================
 * 七、防重叠**不在这里**（在 unit 里）
 * ===========================================================================
 * `ExecStart=/usr/bin/flock -n /run/mcsr-helper-ranked-streams/sync.lock /usr/bin/node
 * /srv/mcsr-helper/api/ranked-streams.js`。`Type=oneshot` 的 timer **不保证**上一轮跑完
 * 才启动下一轮，而 `PRAGMA busy_timeout` 会让两个重叠的进程**排队等着写**而不是报错。
 * ⚠️ 锁文件必须在 `RuntimeDirectory=` 建的目录里（`/run` 本身是 root 所有 0755，
 *    以 `User=mcsr` 跑的本单元在那层建不出文件 —— 单元里那一段注释有完整的事故与修法）。
 *
 * ===========================================================================
 * 八、这一条的代价（写在明面上）
 * ===========================================================================
 * 上游限流是 **500 次 / 10 分钟 / IP**（spec §2.1）。本作业**每轮恰好 1 次** GET，
 * 5 分钟一轮 ⇒ **0.2 次/分钟 = 额度的 0.4%**。相比之下心跳（30 秒 TTL）是 2 次/分钟 = 4%，
 * 两者加起来约 **4.4%**。⇒ 这一条**不**把"服务器出口 IP 承担所有访客"那条被否决的 B 方案
 *    又建一遍：**访客看到的东西一次都不经过我们**，作业也不在任何请求路径上。
 * ⚠️ 上一版把它设计成"最多每 30 秒一次"（= 4%，与心跳相当），那一份账今天**不再成立** ——
 *    spec §3 记的是上面这一版的实数。真改了这里的节拍，spec §3 的账要跟着改。
 *
 * ⚠️ 已知的边界（`pending.md` 有面向编辑的完整版）：**上游只对一部分选手给 `liveUrl`**
 *    （对局里约一半的选手那一格是 `null`，spec §2.2 的形状也是这样）⇒ 这个作业收录的是
 *    "上游愿意告诉我们的那些直播"；而且它**只加不减**：某个人下播之后那一行仍然在名单里，
 *    直到编辑隐藏它（下架不是这个作业的事，也不该是）。
 */
import { pathToFileURL } from 'node:url';

import { closeDb } from './db';
import { ingestRankedLiveChannels } from './ranked/ingest';
import { loadRankedLive, type RankedLiveFeedResult } from './ranked/live-feed';

// ===========================================================================
// 契约（测试靠它注入假的取数层与假时钟）
// ===========================================================================

export interface RunDeps {
  /** 取一份 `/live` 载荷。生产传 `loadRankedLive`；测试注入假实现 ⇒ **不可能**打到网络。 */
  load: () => Promise<RankedLiveFeedResult>;
  /** 时钟，**毫秒**（文件头第五节：与 `live_channels` 那一族写入口同一个单位）。 */
  now: () => number;
}

/**
 * 一轮的读数。
 *
 * ★ 三个数满足 `candidates === inserted + existing` —— 摘要里那一行就是照这个写的，
 *   而这条恒等式是**能红**的（`ranked.test.ts` 拿它当判据）：一旦某个分支把
 *   "已经在库"与"新插进去"数错，那一行自己就会露馅（本仓对"看起来对的计数"有记录，
 *   §5.47：一个错得不自洽的计数比没有计数更危险）。
 */
export interface RoundSummary {
  /** 载荷里认出来的 twitch 频道数（**去重后**，`rankedTwitchChannels` 的产物长度）。 */
  candidates: number;
  inserted: number;
  /** `candidates - inserted`：已经在库里（或并发下被别人先插了）的那些。 */
  existing: number;
  startedAt: number;
  finishedAt: number;
}

/**
 * 一轮的结局：**要打印的那一行** + 成交与否（`main` 拿它定退出码）。
 *
 * ⚠️ 这一层不打印（文件头第三节）：于是"一次运行恰好一行"是**结构上**成立的，
 *    而不是靠三处各自克制。
 */
export type RoundOutcome = { ok: true; line: string } | { ok: false; line: string };

// ===========================================================================
// 那一行长什么样
// ===========================================================================

/** Unix **毫秒** → ISO。本模块里**唯一**的单位换算点（文件头第五节）。 */
function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * 成功那一行。**一行**，因为它要能被 `journalctl | grep ranked-streams` 一眼看完整。
 *
 * ⚠️ 字段是刻意选的：`载荷 N 个` 回答"上游这一轮告诉了我们多少"，
 *    `新增 M 条 / 已在库 K 条` 回答"这一轮真的改了什么" —— 两个**都不为零**才是正常形状
 *    （一个恒为 0 的 `新增` 要么是名单已经收全了，要么是这个作业坏了；
 *    后者在 stderr 与退出码上，不在这一行里，所以这一行**只报事实、不猜**）。
 */
export function formatSummary(summary: RoundSummary): string {
  return (
    `ranked-streams: 开始=${iso(summary.startedAt)} 结束=${iso(summary.finishedAt)} ` +
    `载荷 ${String(summary.candidates)} 个 twitch 频道 / 新增 ${String(summary.inserted)} 条 / ` +
    `已在库 ${String(summary.existing)} 条`
  );
}

/**
 * 失败那一行。四档（`unavailable` / `busy` / `bad_response` / `db`）共用它 ——
 * 形状一样、档位不同，于是 `journalctl -p err | grep ranked-streams` 一行就能归因。
 *
 * ⚠️ `written` 是**已经写进去的条数**：上游失败时它必然是 0（那一步根本没走到），
 *    而写库失败时它**可能大于 0**（循环里第 3 条才炸，前 2 条是真的进去了）。
 *    把它印出来是这一行唯一的"诚实性"要求：说"一条都没写"而实际写进去两条，
 *    会让下一次排查从一个错的事实开始。
 */
export function formatFailure(kind: string, detail: string, written: number): string {
  return (
    `ranked-streams: 本轮失败（${kind}）：${detail} —— ` +
    (written === 0 ? '一条都没写，直播名单保持原样' : `已经写进去 ${String(written)} 条`)
  );
}

// ===========================================================================
// 引擎
// ===========================================================================

/**
 * 跑一轮：取一份 `/live` → 认 twitch 频道 → 插进 `live_channels` → 报一行。
 * **唯一的写入口**（`main` 只是它的壳）。
 *
 * ★ 四级次序，每一步失败都当场收手（**什么都不写**）：
 *   ① `deps.load()` 失败（上游那三档）⇒ 失败行，`written = 0`；
 *   ② 载荷**不是这一轮取回来的**（`fromUpstream === false`，即 30 秒内的缓存）⇒ **跳过**：
 *      `fromUpstream` 存在的意义就是那句"只有真的从上游取回来的那一份才入库"
 *      （`live-feed.ts` 文件头），同一个进程里已经有人取过并为它入过库，重复入库没有意义。
 *      ⚠️ 在本作业里这一支**打不到**（每次运行都是新进程、只调一次 `load`）——
 *      留着它是因为它是那个模块的**不变量**，而"沉默地什么都不做"比这一行日志更坏：
 *      真有人把本作业挂进一个常驻进程，这一行就是唯一的解释；
 *   ③ 写库失败 ⇒ 失败行带 `db` 档与**已经写进去的条数**；
 *   ④ 成功 ⇒ 摘要行。
 */
export async function runOnce(deps: RunDeps): Promise<RoundOutcome> {
  const startedAt = deps.now();

  const loaded = await deps.load();
  if (!loaded.ok) {
    return { ok: false, line: formatFailure(loaded.kind, loaded.detail, 0) };
  }

  if (!loaded.fromUpstream) {
    return {
      ok: true,
      line:
        'ranked-streams: 本轮跳过：这一份载荷来自缓存（不是这一轮从上游取回来的），' +
        '不重复入库（收录只发生在真的取回来的那一次）',
    };
  }

  /*
   * ⚠️ 收录是**只插不改**的（`insertLiveChannelIfAbsent`），所以这一句重复执行是幂等的：
   *    编辑改过（改名 / 改标签 / 隐藏）的那些行**一个字都不会被覆盖**。
   * ⚠️ `now` 用 `deps.now()`（毫秒，文件头第五节），不是 `Date.now()`：
   *    注入假时钟是这一层唯一的可测性来源（`ranked.test.ts` 的时间断言都对着一个固定的 NOW）。
   */
  const result = await ingestRankedLiveChannels(loaded.data, deps.now());
  if (result.error !== null) {
    return { ok: false, line: formatFailure('db', result.error, result.inserted) };
  }

  return {
    ok: true,
    line: formatSummary({
      candidates: result.candidates,
      inserted: result.inserted,
      /*
       * ⚠️ `existing` 是**算出来的**，不是量出来的（2026-09-19 终审指出）：`候选 - 新增`
       *    在数学上恒等于"本来就在库里的条数"，所以摘要里那个恒等式
       *    `载荷 N = 新增 M + 已在库 K` **永远不会**失败 —— 它是账目，不是守卫。
       *    真正被测试钉住的是两个**独立的**数：`candidates`（从载荷里数出来的 twitch 频道）
       *    与 `inserted`（真的插进去的行数）。⇒ 别把这一行当成一致性检查。
       */
      existing: result.candidates - result.inserted,
      startedAt,
      finishedAt: deps.now(),
    }),
  };
}

// ===========================================================================
// CLI 壳
// ===========================================================================

/** 生产用的依赖：真的取数层、真的时钟（**毫秒**）。 */
function productionDeps(): RunDeps {
  return {
    load: loadRankedLive,
    now: () => Date.now(),
  };
}

/**
 * CLI 的正文。**返回退出码**（不直接设 `process.exitCode`）—— 这样测试能断言它，
 * 而"崩了也是非零"那一半留给 `isMain` 那个 try/catch。
 */
export async function main(argv: string[], deps: RunDeps = productionDeps()): Promise<number> {
  /*
   * ⚠️ 本作业**一个参数都没有**（timer 拉起的就是 `node ranked-streams.js`），
   *    所以不认识的参数**当场拒绝**、退出码 2（用法错误）。
   *    被否掉的做法是"忽略多余的参数"：系统管理员把 `track.js --dry-run` 的习惯带过来时，
   *    一个被忽略的参数看起来像"跑了一轮干活的"，而他以为自己在预演 ——
   *    代价是**真的写了一次库**，而屏幕上什么区别都看不出来。
   */
  if (argv.length > 0) {
    console.error(`✗ 不认识的参数：${argv.join(' ')}`);
    console.error('用法：node ranked-streams.js（没有参数 —— 这一个是给 systemd timer 跑的）');
    return 2;
  }

  const outcome = await runOnce(deps);

  /*
   * ★ 成功走 stdout、失败走 stderr：systemd 把它们记成不同的优先级
   *   （info / err）⇒ `journalctl -p err -u mcsr-helper-ranked-streams` 直接就是
   *   "这个作业什么时候坏过"，不必读全文。
   */
  if (outcome.ok) {
    console.log(outcome.line);
    return 0;
  }
  console.error(outcome.line);
  return 1;
}

/*
 * 只有**被当作程序执行**时才跑（文件头第六节：测试 import 这个文件不该打上游、更不该写库）。
 * ⚠️ 用 URL 比较而不是 `process.argv[1]?.endsWith('ranked-streams.js')`：
 *    后者会把一个恰好同名的**别的**东西当成自己，URL 比较是精确的（`track.ts` 同一条）。
 */
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    /*
     * 逃出 `main` 的都是**我们自己的 bug** 或数据库层面的问题（上游失败在 `runOnce`
     * 里就结掉了）⇒ 连栈一起打进 journald 再非零退出：这种错重试永远不会成功
     * （与 `routes/tracking.ts` 那张分类表同一条纪律）。
     */
    console.error('[ranked-streams] 这一轮没能跑起来：');
    console.error(error);
    process.exitCode = 1;
  } finally {
    // WAL 收尾（`admin-cli.ts` / `track.ts` 结尾同一句）：一次运行结束就该把库交回去。
    closeDb();
  }
}
