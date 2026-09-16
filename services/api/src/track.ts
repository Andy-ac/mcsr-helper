/**
 * 追踪视频的**一次同步** —— 由 systemd timer 每 10 分钟拉起，跑完就退。
 *
 *     node /srv/mcsr-helper/api/track.js              真正跑一轮
 *     node /srv/mcsr-helper/api/track.js --dry-run    只列待办，不抓不写
 *
 * 由 `deploy/mcsr-helper-track.timer` 触发 `deploy/mcsr-helper-track.service`，
 * 后者的 ExecStart 上套着 `flock -n`（spec §3.4）。
 *
 * ⚠️ 路径写的是**部署之后**的样子：deploy.sh 把 dist 里的内容直接解到
 *    `/srv/mcsr-helper/api/` 下（**不是** `.../api/dist/`）—— 与 `admin-cli.ts`
 *    的 usage 同一条。照着 `dist/track.js` 敲会得到 "Cannot find module"，
 *    而那个错误看起来像"文件没部署上去"。
 *
 * ⚠️★ 手工在服务器上敲它**可以**，但**绝不要加 sudo**：以 root 打开库会在 WAL 模式下
 *    生成 root 属主的 `-wal` / `-shm` 文件，之后以 mcsr 运行的 API 就**写不进去**了
 *    —— 而且是静默失败（deploy.sh 里"内容导入"那一段写着同一个坑，那里为此专门
 *    用 `runuser -u mcsr` 跑）。要手工跑就用 `sudo -u mcsr node …`。
 *    `--dry-run` 也一样：它虽然一个字段都不写，但**照样要打开库**（顺带跑迁移）。
 *
 * ===========================================================================
 * 一、为什么是一个不跑 HTTP 的 CLI（spec §3.1 的三条理由）
 * ===========================================================================
 * **① 本仓已经有两个先例**：`dist/import.js`（部署时跑一次）与 `dist/admin.js`
 *    （"在服务器上跑，不经 HTTP"，见 `admin-cli.ts` 的文件头）。`build.mjs` 的
 *    `entryPoints` 本来就是多入口的，加一个 `track` 是一行。
 * **② 它自动跟着上线**：deploy 把**整个 `dist/`** 打包上传
 *    （`tar -czf api.tgz -C services/api/dist .`），所以这里不需要改部署的产物清单。
 * **③ "可以慢点、不考虑时间" ⇒ 不需要长驻进程**：每次跑一段、做完就退，
 *    失败在 `journalctl -u mcsr-helper-track` 里可见。长驻 worker 要多一整套
 *    "它挂了谁发现"的机制，而这一轮根本没有那个预算。
 *
 * ⚠️ 明确否掉的两条路（都写下来，免得下次有人再想一遍）：
 *   · **挂进 HTTP 请求里**：bilibili 一个频道 5 秒、一次全量回填可能几十分钟，
 *     挂在请求里会把 web 进程占住（那台机器只有 2 核）。
 *   · **懒轮询 + TTL 缓存**（上一轮 ranked 的做法）：在那里是对的，在这里是**反的** ——
 *     "访客一来就触发一轮扫描"会让上游成本随访客量放大，而这一轮的约束是
 *     bilibili 的风控（§2.3：拒绝是**概率性**的）。成本结构不同，结论就不该照抄。
 *
 * ===========================================================================
 * 二、为什么它不是"后门"（信任边界与 admin-cli 同一条）
 * ===========================================================================
 * 它不监听任何端口、不接受任何网络输入。"输入"只有两处，都不是攻击者能碰的：
 *   · **数据库**：名单只有 editor+ 能改（`routes/tracking.ts` 那五个端点，spec §6.1），
 *     而游标/水位这些状态是**这个进程自己**上一轮写进去的；
 *   · **环境变量**：凭据来自 `/etc/mcsr-helper/track.env`（root 0600，见
 *     `deploy/track.env.example`），能读它的人本来就能直接改库。
 * ⇒ 它没有引入任何新的信任边界，只是把"改库 + 打上游"这件本来就必须有人做的事
 *   **变得可重复、可计划、可审计**（谁在什么时候被同步过，写在 `tracked_creators` 里）。
 * ⚠️ 它**不判权限**，也**不写审计**：权限是路由那一层的事（本仓分层纪律），
 *    而"某个博主被同步了"这件事的痕迹就是 `last_synced_at` 本身。
 *
 * ===========================================================================
 * 三、★ 失败必须非零退出（spec §6.3：这是"静默坏掉"唯一的护栏）
 * ===========================================================================
 * bilibili 的 `-412` 是**概率性**的（§2.3 实测）。⇒ 一次全量失败与一次正常的空轮询
 * 在摘要里**长得一模一样**（都是"新增 0 条 / 失败 0 个"如果没人计数的话）。
 * 所以这里做两件事，缺一不可：
 *   · **逐条打印失败**（creator / platform / 错误原文），不只是打一个"失败了 3 个"；
 *   · **有任何失败就把退出码设成 1** —— systemd 于是把这一轮记成 `failed`，
 *     `systemctl --failed` 与 `journalctl -p err` 都看得见。
 * 被否掉的做法是"退出码永远 0，靠人看日志"：代价写在 §6.3 里，就是本功能会**悄悄停摆**。
 * ⚠️ 反过来，**跳过（没凭据）不是失败**，退出码仍然是 0（spec §9.1 ⑧ 要的是"跳过并打印原因"）；
 *    一个没配 YouTube key 的机器不该每 10 分钟往 journal 里刷一条红色。
 *
 * ===========================================================================
 * 四、★★ 写库在前、推游标在后（顺序错了会**永久丢数据**）
 * ===========================================================================
 * 每一页的次序是**固定**的：
 *     ① `fetchPage`  ② `upsertVideos`  ③ `advanceCursor`
 * 两个方向都试过：
 *   · **先推游标再写** ⇒ 崩在写库上时游标已经前进了，那一页的视频**永远不会再被看到**
 *     （下一轮从下一页开始翻），而日志里只有一行"这一轮失败了" —— 静默丢数据；
 *   · **失败就不推游标**（哪怕已经写进去了）⇒ 一个永远在第二页崩的博主**每轮重抓第一页**，
 *     看起来"每轮都在跑"，实际上永远翻不到底。
 * ⇒ 现在的语义：**写成功一页就推一页的游标**（哪怕下一页崩了，这一页的进度是真的），
 *   而崩掉的那一页**一动不动**地留给下一轮（§5.1 那张表里"原地"那一格）。
 *   `advanceCursor` 只在**成功写完**之后被调用，所以"崩在写库"与"写成功"分得开。
 *
 * ===========================================================================
 * 五、★ `storedTotal` 必须恰好是 `storedVideoCount(creatorId)`
 * ===========================================================================
 * 它是 bilibili"到底了"判据（§5.1：`返回条数 < ps` **且** `已存 >= page.count`）
 * 的一半，而适配器不许读数据库 ⇒ 由这里喂进去（`PlatformAdapter.fetchPage` 的第三参）。
 * ⚠️ 这意味着**每一页都要重新数一次**：第一页写进去的那几条必须算进第二页。
 * ⚠️ 而 `storedVideoCount` 是"**这个 creator 的行数**"，一个过滤条件都没有
 *   （隐藏的也数）—— 少算会让 `reachedEnd` **永远不为真**（那个博主每轮都在重翻），
 *   多算会让它**提前为真**（最后几条视频永远抓不到）。两个方向都是"不报错的错"，
 *   完整论证在 `tracked-videos.ts` 的文件头第二节与 spec §5.1 那段残余风险。
 *
 * ===========================================================================
 * 六、"完成"数的是**翻到底**，不是"没报错"（`RunSummary` 那个 `done`）
 * ===========================================================================
 * `试 a / 完成 b / 失败 c` 里，`完成` = **这一轮翻到了列表尽头**
 * （也就是 `advanceCursor(..., done = true)` 那一次）。理由：它与库里那个
 * `backfill_done` 因此是**同一件事**，摘要和数据库不会各说各话；500 条视频的 UP 主
 * 在每轮 20 页的限制下要跑好几轮，那几轮报的是"试 1 / 完成 0 / 失败 0"。
 * ⇒ `试 - 完成 - 失败` 就是**还在翻的**（有进展但没到底），这一格在摘要里会被点名
 *   （`（还有 N 个没翻完，下一轮接着翻）`）—— 否则"试 3 / 完成 1"会让读者
 *   以为剩下两个凭空消失了。被否掉的做法是把"处理过了"算成完成：
 *   那样一个翻不完的频道每轮都报"完成 1"，而它其实卡在同一个地方。
 *
 * ===========================================================================
 * 七、为什么这个文件有 `if (isMain)` 而 `admin-cli.ts` 没有
 * ===========================================================================
 * `tracking-run.test.ts` 要 import 这个文件来测 `runOnce`/`main`，而仓库里另外两个
 * CLI 的顶层就是"跑起来"。这里必须把"被执行"与"被 import"分开，否则一 import
 * 就会真的同步一轮（测试里就是打真网络 + 写真库）。
 * ⚠️ 被否掉的做法是"把 `runOnce` 挪到另一个文件"：`build.mjs` 的 `track` 入口与
 *    计划的文件清单都指着这个文件，多一个文件只是把同一件事劈成两处。
 *
 * ===========================================================================
 * 八、★★ 时钟的单位是**秒**，不是 `Date.now()` 的毫秒
 * ===========================================================================
 * 判据在数据层里摆着：`tracked-videos.ts` 的 `INCREMENTAL_INTERVAL_SEC = 3600`
 * 是**直接**与调用方给的 `now` 相减的（`last_synced_at < now - 3600`，spec §3.2 冻结），
 * 而它的注释写着"（秒）…一小时" ⇒ `now` 只能是 **Unix 秒**。
 * 传毫秒的后果是**不报错的**：那个"一小时"变成 3.6 秒 ⇒ 每个博主每 10 分钟一轮
 * 全都被判成"该增量了"，整份名单每轮全量重扫，而 §3.3 的有界设计白写；
 * `created_at` / `last_synced_at` 也会变成 1.7e12 那种值，界面上的日期跑到 5 万年以后。
 * ⚠️ 所以 `productionDeps().now` 是 `Math.floor(Date.now() / 1000)`。
 *    `first_seen_at` 与 `published_at` 因此是同一个单位（§4.2 都注明是 Unix 秒）。
 * ⚠️ 已知的一处不一致（**不在本任务的文件里**，留给裁决，我没有改）：
 *    `routes/tracking.ts` 的三处 `const now = Date.now()` 把**毫秒**传给了
 *    `createCreator` / `updateCreator` ⇒ 经接口加进来的那几行 `created_at` / `updated_at`
 *    是毫秒，而本文件写进去的 `updated_at` / `last_synced_at` / `first_seen_at` 是秒。
 *    今天没有任何查询比较这两族（`listCreators` 只按 `created_at` 排），所以症状要等到
 *    T7 把这两个时间显示出来才会露头（`new Date(x)` 对秒是 1970、对毫秒是对的）。
 *    依据：`tracking-store.test.ts` 的 `NOW = 1_788_600_000` 明确写着"**秒**"，
 *    并且逐条断言 `created_at === NOW`。
 *
 * ===========================================================================
 * 九、防重叠**不在这里**（在 unit 里，spec §3.4）
 * ===========================================================================
 * `ExecStart=/usr/bin/flock -n /run/mcsr-helper-track.lock …`。
 * ⚠️ 为什么不在这个进程里加锁（比如写一个 pid 文件）：`Type=oneshot` 的 timer
 *    **不保证**上一轮跑完才启动下一轮，而 `PRAGMA busy_timeout = 5000` 会让两个
 *    重叠的进程**排队等着写**而不是报错 ⇒ 同一个游标会被两个进程分别推进。
 *    这件事只有"谁负责拉起进程"那一层知道（systemd），所以锁放在那里；
 *    自己实现一份要么漏（`O_EXCL` 的陈旧锁文件）要么又要一套超时与清理。
 */

import { pathToFileURL } from 'node:url';
import { TRACK_PLATFORMS, type TrackedCreator, type TrackPlatform } from '@mcsr/shared';

import { closeDb } from './db';
import {
  advanceCursor,
  pickDueCreators,
  recordFailure,
  type StoredCreator,
  storedVideoCount,
  upsertVideos,
} from './tracked-videos';
import { adapterFor, platformStatus } from './tracking';
import { NoCredentialsError, type PlatformAdapter, PlatformHandshakeError } from './tracking/types';

// ===========================================================================
// 契约（计划 T6 逐字冻结——测试靠它注入假适配器与假时钟）
// ===========================================================================

export interface RunDeps {
  /** 测试注入假实现；生产传 `adapterFor`。 */
  adapters: (platform: TrackPlatform) => PlatformAdapter;
  platformStatus: () => Record<TrackPlatform, 'ok' | 'skipped:no-credentials'>;
  now: () => number;
  limits: { backfill: number; pages: number; incremental: number };
}

export interface RunSummary {
  backfill: { tried: number; done: number; failed: number };
  incremental: { tried: number; done: number; failed: number };
  inserted: number;
  updated: number;
  platforms: Record<TrackPlatform, 'ok' | 'skipped:no-credentials' | 'failed'>;
  failures: Array<{ creatorId: string; platform: TrackPlatform; error: string }>;
}

/**
 * spec §10 冻结的每次运行上限：回填 20 个 / 翻 20 页 / 增量 40 个。
 *
 * ⚠️ **故意不给环境变量开关**（与 unit 里那些 `MCSR_*` 凭据不同）：§3.3 的配额算术
 *    （"40 个频道/次 × 24 次/天 ≈ 1000–2000 units/天，在 10000 之内"）成立的前提就是
 *    这三个数是常量。一个"顺手能调大"的限额会让那条算术无声地失效，而症状是
 *    **YouTube 配额在月中被烧光**，那时所有增量一起停 —— 与本文件第三节那个坑同类。
 *    真要改，改这里并同步改 spec §10 的冻结表。
 */
export const TRACK_LIMITS = { backfill: 20, pages: 20, incremental: 40 };

// ===========================================================================
// 引擎
// ===========================================================================

/** 一个 creator 这一轮的结局：翻到底 / 报错 / 有进展但没翻完（含被 limits 截断）。 */
type CreatorOutcome = 'done' | 'failed' | 'partial';

/** `syncCreator` 的返回：结局 + "这个平台别再碰了"（握手失败，§5.1）。 */
interface CreatorResult {
  outcome: CreatorOutcome;
  abortPlatform: boolean;
}

/** 错误 → 落进 `last_error` 与摘要的那一行文本。 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 跑一轮：挑待办 → 逐个同步 → 汇总。**唯一的写入口**（`main` 只是它的壳）。
 *
 * 有界（§3.3）：`deps.limits` 是本次运行唯一的界，逐个 creator 地生效。
 */
export async function runOnce(deps: RunDeps): Promise<RunSummary> {
  const now = deps.now();
  const status = deps.platformStatus();

  /*
   * ⚠️ 待办**从状态推导**，没有队列表（§3.2）：这条查询就是"谁到点了"的全部真相。
   *    `now` 由 deps 给（假时钟）⇒ "一小时前同步过的现在该不该跑"在测试里是确定的。
   */
  const due = pickDueCreators(now, {
    backfill: deps.limits.backfill,
    incremental: deps.limits.incremental,
  });

  const summary: RunSummary = {
    backfill: { tried: 0, done: 0, failed: 0 },
    incremental: { tried: 0, done: 0, failed: 0 },
    inserted: 0,
    updated: 0,
    // 先照 `platformStatus()` 填（ok / skipped），本轮真出事了才改写成 'failed'。
    platforms: { ...status },
    failures: [],
  };

  /** 握手失败的平台：本轮剩下的同平台 creator 一个都不许再碰（§5.1）。 */
  const abandoned = new Set<TrackPlatform>();
  /** 已经判定为"跳过"的平台（没凭据）：一次就够，不必每个 creator 各判一遍。 */
  const skipped = new Set<TrackPlatform>();

  for (const bucket of ['backfill', 'incremental'] as const) {
    for (const creator of due[bucket]) {
      if (skipped.has(creator.platform) || abandoned.has(creator.platform)) continue;

      /*
       * ★ 顺序：**先看状态，再要适配器**（`tracking/index.ts` 的文件头写着这条）。
       *   反过来的话，没凭据的平台会让 `adapters()` 抛 `NoCredentialsError` ——
       *   而 spec §9.1 ⑧ 要的是"跳过并打印原因"，不是整轮崩在这里。
       */
      if (status[creator.platform] !== 'ok') {
        skipped.add(creator.platform);
        continue;
      }

      let adapter: PlatformAdapter;
      try {
        adapter = deps.adapters(creator.platform);
      } catch (error) {
        if (error instanceof NoCredentialsError) {
          // 状态说能用、注册表却说拿不到 ⇒ 以**实际拿不到**为准，报跳过。
          summary.platforms[creator.platform] = 'skipped:no-credentials';
          skipped.add(creator.platform);
          continue;
        }
        /*
         * ⚠️ 其余一律**重新抛出去**（与 `routes/tracking.ts` 的分类表同一条纪律）：
         *    注册表里剩下的分支是我们自己的 bug（比如"平台常量加了但注册表没跟上"），
         *    把它吞成"这一轮跳过"会让它永远不被修。抛出去 = 非零退出 + 栈进 journal。
         */
        throw error;
      }

      summary[bucket].tried += 1;
      const { outcome, abortPlatform } = await syncCreator(creator, adapter, deps, now, summary);
      if (abortPlatform) abandoned.add(creator.platform);
      if (outcome === 'done') summary[bucket].done += 1;
      else if (outcome === 'failed') summary[bucket].failed += 1;
      // 'partial' 两边都不加：它既没完成也没失败，差值就是"还在翻的"（文件头第六节）。
    }
  }

  return summary;
}

/**
 * 同步一个 creator：翻页直到到底、被 limits 截断、或者出错。
 *
 * ⚠️ 它**不抛**（`NoCredentialsError` 之外的一切都在这里结掉）：一个 creator 的失败
 *    不能让整轮停下来 —— spec §3.5"三个平台各自独立失败"，而且同一个平台内部也一样。
 */
async function syncCreator(
  creator: StoredCreator,
  adapter: PlatformAdapter,
  deps: RunDeps,
  now: number,
  summary: RunSummary,
): Promise<CreatorResult> {
  // `limits.pages` 是非正整数时一页都不翻（负数在 SQLite 的 LIMIT 里是"不限"，
  // 那个坑的数据层已经堵了；这里是同一个姿态：宁可什么都不做）。
  const maxPages = Math.max(0, Math.floor(deps.limits.pages));
  let cursor = creator.lastCursor;

  try {
    for (let page = 0; page < maxPages; page += 1) {
      /*
       * ★ 每一页都重新数（文件头第五节）：第一页刚写进去的那几条必须算进第二页的
       *   判据里，否则一个正好卡在 `page.count` 上的频道永远判不到底。
       */
      const storedTotal = storedVideoCount(creator.id);

      const result = await adapter.fetchPage(creator, cursor, { storedTotal });

      // ★★ 次序不许动：先写库（文件头第四节）。
      const { inserted, updated } = upsertVideos(creator.id, creator.platform, result.videos, now);
      summary.inserted += inserted;
      summary.updated += updated;

      /*
       * ★ `reachedEnd` **压过** `nextCursor`：翻完了就没有"下次从哪继续"这回事
       *   （`advanceCursor` 那一列的注释就是"收尾时是 NULL：翻完了，下一次从第一页开始"）。
       *
       * ⚠️ 为什么不由适配器负责把游标也置 null：三个平台的"到底了"语义**不一样**
       *    （§5.4 明说"不许写成一个 if"），游标只是其中一个平台的表达方式。
       *    真出一次"reachedEnd=true 但游标还留着"时，两个方向的代价不对称：
       *      · 这里判**收尾** ⇒ 下一轮从第一页重看一遍（一次请求，upsert 幂等，**不丢数据**）；
       *      · 信游标 ⇒ `last_cursor` 停在半路，而**增量同步总是从第一页开始翻新的**
       *        （新视频在最前面），于是第 2 页以后的游标会让新视频**永远看不到** ——
       *        又一次静默丢数据，正是本任务要防的那一类。
       */
      const nextCursor = result.reachedEnd ? null : result.nextCursor;
      advanceCursor(creator.id, nextCursor, result.reachedEnd, now);

      if (result.reachedEnd) return { outcome: 'done', abortPlatform: false };

      /*
       * ⚠️★ 游标没前进 ⇒ **立刻收手**，哪怕 limits.pages 还剩很多次。
       *
       * 这是 §5.1 那张表里"不满页但已存 < page.count ⇒ 原地"那一格，也就是 §2.4
       * 实测到的形态：`code = 0`、`vlist = []`，而其实**还有数据**（被限流了）。
       * 这一页没有进展，把剩下的次数全打在同一个页面上只会推高 IP 的风险分
       * （§2.3：拒绝是概率性的）—— 而下一轮（10 分钟后）用同样的参数重试是**对的**，
       * 因为那时风控窗口已经过去。
       *
       * ⚠️ 代价写在明面上：一个**真的陷在这一页**的频道每轮只前进一页都不到，
       *    但游标与水位都照常更新（`advanceCursor` 已经跑过了），所以"它每轮都在试"
       *    这件事在管理面板与摘要里看得见。
       * ⚠️ 不比较 `result.nextCursor ?? '1'`：那个 `?? '1'` 是 bilibili 自己的规范化
       *    （§5.1 的游标定义），把它抄进 CLI 就等于把某个平台的语义写死在公共层 ——
       *    正是 §5.4 那句"三个平台的到底了语义不一样，不许写成一个 if"要防的。
       *    代价：一个全新的 creator（游标 null）被规范化成 '1' 时要多打一次请求才发现
       *    原地不动。一次请求换一层解耦，认下。
       */
      if (nextCursor === cursor) return { outcome: 'partial', abortPlatform: false };

      cursor = nextCursor;
    }

    // 翻满了 limits.pages 还没到底：不是失败，下一轮接着翻（文件头第六节）。
    return { outcome: 'partial', abortPlatform: false };
  } catch (error) {
    const message = errorText(error);

    /*
     * ★ 失败只写**这一个** creator（§3.5）：原样进 `last_error`（管理面板要显示它），
     *   计数 +1（`pickDueCreators` 的排序读的就是它 ⇒ 一直失败的会沉到后面，
     *   不会把整份名单饿死 —— `tracked-videos.ts` 文件头第七节）。
     * ⚠️ `advanceCursor` **一次都没跑** ⇒ 游标停在原地、`last_synced_at` 不动
     *   （它是成功的水位）—— 于是下一轮从同一页继续（文件头第四节）。
     */
    recordFailure(creator.id, message, now);
    summary.failures.push({ creatorId: creator.id, platform: creator.platform, error: message });
    summary.platforms[creator.platform] = 'failed';

    /*
     * ★ 握手失败 ⇒ 本轮放弃这个平台**剩下的所有** creator（§5.1 原话："不能带着空 cookie
     *   继续打（那会白吃一堆 412）"）。但只记**这一条**失败：另外那些不是"失败了"，
     *   它们只是**没轮到**，下一轮照旧到点。
     */
    return {
      outcome: 'failed',
      abortPlatform: error instanceof PlatformHandshakeError,
    };
  }
}

// ===========================================================================
// 摘要与退出码（spec §6.3）
// ===========================================================================

/** `试 a 个 / 完成 b 个 / 失败 c 个`，必要时点名"还有几个在翻"（文件头第六节）。 */
function bucketLine(counts: { tried: number; done: number; failed: number }): string {
  const base = `试 ${String(counts.tried)} 个 / 完成 ${String(counts.done)} 个 / 失败 ${String(counts.failed)} 个`;
  const inFlight = counts.tried - counts.done - counts.failed;
  return inFlight > 0 ? `${base}（还有 ${String(inFlight)} 个没翻完，下一轮接着翻）` : base;
}

/** Unix **秒** → ISO。本模块里**唯一**的单位换算点（文件头第八节）。 */
function iso(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

/**
 * spec §6.3 那份运行摘要。**失败逐条打印**，不是只打一条样例 —— 见 `runOnce` 那一节。
 *
 * ⚠️ 两个时间都是 **Unix 秒**（与整个模块、与数据层同一个单位，文件头第八节），
 *    打印时才换算成 ISO。
 */
export function formatSummary(summary: RunSummary, startedAt: number, finishedAt: number): string {
  const lines = [
    `track: 本轮 开始=${iso(startedAt)} 结束=${iso(finishedAt)}`,
    `  回填: ${bucketLine(summary.backfill)}`,
    `  增量: ${bucketLine(summary.incremental)}`,
    `  新增视频 ${String(summary.inserted)} 条 / 更新 ${String(summary.updated)} 条`,
    // 平台那一行照 `TRACK_PLATFORMS` 的冻结顺序，加第四个平台时会自动多一格。
    `  平台: ${TRACK_PLATFORMS.map((p) => `${p} ${summary.platforms[p]}`).join(' / ')}`,
  ];

  /*
   * ⚠️ 一条失败一行（§6.3 那个模板写的是"失败样例"，这里按**样例的形状**逐条打）。
   *    只打第一条的代价很具体：20 个频道全挂时，摘要里只有 1 行，
   *    而 §6.3 存在的理由正是"全量失败不能看起来像空轮询"。
   *    这次运行本身是有界的（≤ 20 + 40 个 creator），所以最坏情况也就几十行。
   */
  for (const failure of summary.failures) {
    lines.push(
      `  ⚠️ 失败样例: creator=${failure.creatorId} platform=${failure.platform} error=${failure.error}`,
    );
  }

  return lines.join('\n');
}

/**
 * 这一轮的退出码。**有失败 ⇒ 1**（文件头第三节），跳过不算。
 *
 * ⚠️ 两个来源都看一眼（`failures` 与 `platforms`）：今天它们由 `syncCreator` 同时写，
 *    所以是等价的 —— 但真出现"只改了平台状态"的那条路时，退出码仍然是响的。
 */
export function exitCodeFor(summary: RunSummary): 0 | 1 {
  const anyPlatformFailed = TRACK_PLATFORMS.some((p) => summary.platforms[p] === 'failed');
  return summary.failures.length > 0 || anyPlatformFailed ? 1 : 0;
}

// ===========================================================================
// CLI 壳
// ===========================================================================

/** 预演的正文：**只读**待办与平台状态，一个适配器都不要（所以不可能打网络）。 */
export function dryRunPlan(deps: RunDeps): string {
  const now = deps.now();
  const status = deps.platformStatus();
  const due = pickDueCreators(now, {
    backfill: deps.limits.backfill,
    incremental: deps.limits.incremental,
  });

  const lines = [
    `track: 预演（--dry-run）现在=${iso(now)}`,
    `  回填 待办 ${String(due.backfill.length)} 个（本轮上限 ${String(deps.limits.backfill)}）：`,
  ];
  for (const creator of due.backfill) lines.push(`    ${creatorRowLine(creator)}`);
  lines.push(
    `  增量 待办 ${String(due.incremental.length)} 个（本轮上限 ${String(deps.limits.incremental)}）：`,
  );
  for (const creator of due.incremental) lines.push(`    ${creatorRowLine(creator)}`);
  lines.push(
    `  平台: ${TRACK_PLATFORMS.map((p) => `${p} ${status[p]}`).join(' / ')}`,
    /*
     * ⚠️ 说的是"不动名单与视频的任何一行"，不是"什么都不写"：预演照样要**打开库**
     *    （于是全新库上会跑一次迁移），只是不碰任何业务数据。
     *    把话说过头（"不写任何一行"）会让下一个人在全新库上跑完预演之后
     *    发现多了一堆表，然后开始怀疑预演是不是真的没写。
     */
    '  ⚠️ 预演：不抓任何一页、不动名单与视频的任何一行。',
  );
  return lines.join('\n');
}

function creatorRowLine(creator: TrackedCreator): string {
  // 游标要打出来：预演最常见的用法是"它为什么卡在这一页"。
  const cursor = (creator as StoredCreator).lastCursor;
  return `${creator.id}  ${creator.platform}  ${creator.displayName}  游标=${cursor ?? '（无）'}`;
}

/** 生产用的依赖：真的注册表、真的时钟、spec §10 的限额。 */
function productionDeps(): RunDeps {
  return {
    adapters: adapterFor,
    platformStatus,
    // ★ 秒（文件头第八节）：`now - 3600` 那一小时算得对不对全看这一行。
    now: () => Math.floor(Date.now() / 1000),
    limits: TRACK_LIMITS,
  };
}

/**
 * CLI 的正文。**返回退出码**（不直接设 `process.exitCode`）—— 这样测试能断言它，
 * 而"崩了也是非零"那一半留给 `isMain` 那个 try/catch。
 */
export async function main(argv: string[], deps: RunDeps = productionDeps()): Promise<number> {
  /*
   * ⚠️ 不认识的参数**当场拒绝**，不忽略。忽略的代价很具体：一个把 `--dry-run`
   *    敲成 `--dryrun` 的人以为自己在预演，而我们**真的同步了一轮**（打了上游、
   *    写了库），而屏幕上什么区别都看不出来。返回 2 是"用法错误"的常规码。
   */
  const unknown = argv.filter((arg) => arg !== '--dry-run');
  if (unknown.length > 0) {
    console.error(`✗ 不认识的参数：${unknown.join(' ')}`);
    console.error('用法：node track.js [--dry-run]');
    return 2;
  }

  if (argv.includes('--dry-run')) {
    console.log(dryRunPlan(deps));
    return 0;
  }

  const startedAt = deps.now();
  /*
   * ⚠️ 时钟**照传**，不许在这里换成 `Date.now()`：注入假时钟是这一层唯一的可测性来源
   *    （`tracking-run.test.ts` 的每一个时间断言都对着一个固定的 NOW），
   *    换掉它等于把"一小时算得对不对"重新变成不可测的。
   */
  const summary = await runOnce(deps);
  const finishedAt = deps.now();

  console.log(formatSummary(summary, startedAt, finishedAt));
  return exitCodeFor(summary);
}

/*
 * 只有**被当作程序执行**时才跑（文件头第七节：测试 import 这个文件不该同步一轮）。
 * ⚠️ 用 URL 比较而不是 `process.argv[1]?.endsWith('track.js')`：后者在
 *    `node src/track.ts` 与 `node dist/track.js` 两种跑法下都对，但也会把一个
 *    恰好叫 track.js 的**别的**东西当成自己 —— URL 比较是精确的。
 */
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    /*
     * 逃出 `main` 的都是**我们自己的 bug** 或数据库层面的问题（一个 creator 的
     * 上游失败在 `syncCreator` 里就结掉了）。⇒ 连栈一起打进 journald 再非零退出：
     * 这种错重试永远不会成功（与 `routes/tracking.ts` 那张分类表同一条纪律）。
     */
    console.error('[track] 这一轮没能跑起来：');
    console.error(error);
    process.exitCode = 1;
  } finally {
    // WAL 收尾（`admin-cli.ts` 结尾同一句）：一次运行结束就该把库交回去。
    closeDb();
  }
}
