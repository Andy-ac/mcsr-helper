/**
 * 直播状态 → 「直播」频道：**一轮检测** —— 由 systemd timer 每 3 分钟拉起，跑完就退。
 *
 *     node /srv/mcsr-helper/api/live-status.js      真正跑一轮
 *
 * 由 `deploy/mcsr-helper-live-status.timer` 触发
 * `deploy/mcsr-helper-live-status.service`，后者的 ExecStart 上套着 `flock -n`
 * （防重叠，见文件头第六节）。
 *
 * ⚠️ 路径写的是**部署之后**的样子：deploy.sh 把 dist 里的内容直接解到
 *    `/srv/mcsr-helper/api/` 下（**不是** `.../api/dist/`）—— 与 `track.ts` /
 *    `ranked-streams.ts` 的文件头同一条。照着 `dist/live-status.js` 敲会得到
 *    "Cannot find module"，而那个错误看起来像"文件没部署上去"。
 *
 * ⚠️★ 手工在服务器上敲它**可以**，但**绝不要加 sudo**（`track.ts` 文件头那一段逐字适用）：
 *    以 root 打开库会在 WAL 模式下生成 root 属主的 `-wal` / `-shm` 文件，之后以 `mcsr`
 *    运行的 API 就**写不进去**了 —— 而且是**静默失败**。要手工跑就用 `sudo -u mcsr node …`。
 *
 * ===========================================================================
 * 一、用户在问什么，以及这一条**推翻了一句写在页面上的承诺**
 * ===========================================================================
 * 用户第 10 条原文：「"直播"分区检测是否正在直播，将正在直播的频道按观看人数递降的
 * 顺序排列在前面，并**显示观看人数**，并允许用户在**搜索栏**搜索直播」。
 *
 * ⚠️ 在那之前，`apps/web/src/routes/Live.tsx` 的文件头与 `live.recordsChannels` 那一句
 * 一起承诺过："这一页**不检测**直播状态，所以没有「直播中」标记"。那句话是那一页
 * "能一直保持诚实的唯一原因"。这一条作业**把它推翻了** ⇒ 那一句必须被改成
 * **仍然为真**的说法（现在会有人查、但查得**不勤**），而不是删掉或者放着不管
 * （界面上那句改成了什么、代价是什么，写在 `live.recordsChannels` 的词条注释里）。
 *
 * ===========================================================================
 * 二、为什么是 CLI + timer，而不是挂进请求路径（与 `ranked-streams.ts` 第一条同一个形状）
 * ===========================================================================
 *   · **节拍是确定的** —— 没有人看页面时它照样跑（请求路径下"没人来就什么都不发生"，
 *     而那正是"这个功能到底在不在工作"最难回答的一种形态）；
 *   · **不在任何请求路径上** —— 访客的一次 GET 与这件事彻底解耦，没有任何一次请求
 *     会因为这次写库而变慢或失败；
 *   · 常驻 worker 被否掉的理由与那里逐字相同（多出"它挂了谁发现"的一整套机制）。
 *
 * ★ 节拍 **3 分钟**（那个 timer 里也写着这条理由）：上面显示的是"谁现在在播"，
 *   而这是个**给人看**的数 —— 晚 3 分钟完全可以接受。至于上游的花费：Twitch 那一条
 *   与人数无关（一次调用最多 100 个 login ⇒ 无论 3 分钟还是 1 分钟一轮，都是每轮
 *   2 次调用，见第五节），所以"更勤"换不到更多信息，只是更贵。
 *
 * ===========================================================================
 * 三、★ 只查两个平台；YouTube **这一轮不做**（写清代价，不是忘了）
 * ===========================================================================
 *   · **Twitch** —— `helix/streams`，直接给 `viewer_count`，一次 ≤100 个 login
 *     （实测：101 个当场 400）。凭据走仓库里**既有**的那一套（`MCSR_TWITCH_ID` +
 *     `MCSR_TWITCH_SECRET` → app access token），实现在 `tracking/twitch.ts` 里
 *     抽出来的 `createTwitchTokenSource`，**没有第二套**。
 *   · **bilibili** —— `get_info?room_id=`，一行一个请求（为什么不是批量端点、
 *     为什么用房间号而不是 uid：`liveness/bilibili-rooms.ts` 的文件头）。
 *   · **YouTube 直播检测这一轮不做**：唯一能发现"哪一场在播"的是
 *     `search.list?eventType=live`，而它是 **100 次/天**的**独立额度**（文档，
 *     `docs/platform-api-feasibility-notes.md:266-278`），跟频道数成正比 ⇒
 *     代价与收益不成比例。**⇒ youtube 行的 `is_live` 永远是 `NULL`**（"从没查过"），
 *     界面上那一行因此**什么标记都不显示**。这不是缺陷，是今天的能力边界，
 *     而且它**在界面上看起来就是"没有标记"**（正是这一页对"没查过"的既有说法）。
 *     ⚠️ 每一轮的那一行日志里都写着 `youtube 本轮不查`，所以"它永远是 NULL"这件事
 *     是**可见**的，不需要谁去读代码才知道。
 *   · **Kick 不在这里**：它进不了 `live_channels`（两条 CHECK + 一条测试），
 *     所以这一层连一个分支都不该为它写。
 *
 * ===========================================================================
 * 四、★★ 「平台级失败不许写进库」—— 这一条作业最容易写错的地方
 * ===========================================================================
 * 上游的失败分两种，而它们的处置**完全不同**：
 *   · **平台级**（连不上 / 超时 / 401 / 5xx / 响应形状漂了）⇒ 这一批**一个字段都不许写**：
 *     `is_live` / `viewer_count` / `live_checked_at` 全部保持原值。
 *     否则一次网络抖动会把**所有**频道标成"不在播"—— 一句我们根本没验证过的话，
 *     而且它看起来完全正常（界面上安静地少掉所有徽章）。
 *   · **逐条级**（只有某几行没答上来：bilibili 的某一行、twitch 的某一批）
 *     ⇒ **只有那几行不写**，别的行照写。一次故障也不该让另外 180 行的读数白等一轮。
 * ⇒ 所以两个取数层返回的都是 `{ answered, failures }`，而这一层**只从 `answered` 造写入**。
 *    ⚠️ 这条不变量的反面就是本轮的 mutation 之一（把 `failures` 也当"不在播"写进去）。
 *
 * ★ `NULL` 的三种来源，别混：
 *   · `is_live IS NULL` = **从没查过 / 查不到**（新行、youtube、整平台失败时保持原值）；
 *   · `is_live = 0`     = **问过上游，它说没在播**（这一条**只能由一次成功的回答产生**）；
 *   · `viewer_count IS NULL` = 上游没给人数 —— **绝不是 0**。
 *     0 与"读不到"是两句不同的话：上游真的会给 0（实测：Twitch 的在播流里有
 *     `viewer_count=0` 的条目），所以 0 只能有一个来源。
 *
 * ===========================================================================
 * 五、上游调用数的账（每一轮、每一天）
 * ===========================================================================
 *   · Twitch：**2 次** `helix/streams` + 最多 1 次换 token（token 进程内缓存 ⇒
 *     一次运行只换一次）。183 个 login（2026-09-18 生产实测）按 100 切两批。
 *     每 3 分钟一轮 ⇒ 每天 **480 轮 ≈ 960 次** streams 调用。
 *     限流头实测 `ratelimit-limit=800`（`remaining=799`）——⚠️ 那是**每分钟**的量级，
 *     而我们是 2 次/3 分钟 = **0.67 次/分钟**，离它很远。
 *   · bilibili：**一行一个请求**，今天生产上 bilibili 行数是 **0** ⇒ 今天 **0 次**。
 *     真加了 N 行，就是每轮 N 次（上限 100，且有一条 60 秒的墙钟预算）。
 *   · 与既有两个作业的关系：`track.timer`（10 分钟）打的是 bilibili `arc/search` +
 *     YouTube + Twitch `helix/users|videos`；`ranked-streams.timer`（5 分钟）打
 *     `api.mcsrranked.com/live`。**这一条是第三个**，只打上面那两个端点。
 *
 * ===========================================================================
 * 六、防重叠**不在这里**（在 unit 里）
 * ===========================================================================
 * `ExecStart=/usr/bin/flock -n /run/mcsr-helper-live-status/sync.lock /usr/bin/node
 * /srv/mcsr-helper/api/live-status.js`。理由与 `ranked-streams.service` 逐字相同
 * （`Type=oneshot` 的 timer 不保证上一轮跑完才起下一轮，而 SQLite 的 `busy_timeout`
 * 会让两个进程排队等着写而不是报错）。
 *
 * ===========================================================================
 * 七、时钟的单位是**秒**（与 `live_channels` 其余列相反，别照抄）
 * ===========================================================================
 * `now` 进的是 `live_checked_at`，而那一列是 **Unix 秒**（迁移 023 定的，
 * 与 `tracked_videos` 那一族对齐：`publishedAt` / `verify_checked_at` 全是秒）。
 * ⚠️ 而 `live_channels` 的 `created_at` / `updated_at` 是**毫秒**
 *    （`ranked-streams.ts` 文件头第五节专门写过这一条）⇒ 同一张表里两种单位，
 *    填错的后果是**不报错**的：界面上的时刻跑到 5 万年以后。
 *    ⇒ 本文件里所有时间函数都**显式**在名字或注释里带单位，没有裸的 `now`。
 *
 * ===========================================================================
 * 八、为什么这个文件有 `if (isMain)`
 * ===========================================================================
 * `live-status.test.ts` 要 import 这个文件来跑 `runOnce` / `main`（那些用例是这一轮的
 * 全部证据），而顶层直接"跑起来"的话，一 import 就会**真的打上游 + 真的写库**。
 * ⇒ 必须把"被执行"与"被 import"分开（`ranked-streams.ts` 文件头第六节同一个理由）。
 */
import { pathToFileURL } from 'node:url';

import type { LivePlatform } from '@mcsr/shared/live';
import { closeDb } from './db';
import {
  applyLiveStatus,
  type LiveStatusTarget,
  type LiveStatusUpdate,
  listLiveStatusTargets,
} from './live';
import { type BilibiliOutcome, fetchBilibiliLiveRooms } from './liveness/bilibili-rooms';
import { fetchTwitchLiveStreams, type TwitchStreamsOutcome } from './liveness/twitch-streams';
import { platformStatus, twitchCredentialsFromEnv } from './tracking';

// ===========================================================================
// 契约（测试靠它注入假的取数层与假时钟）
// ===========================================================================

/** 这一轮要处理的三个平台。⚠️ `youtube` 在里面只是为了**把它"本轮不查"说出来**。 */
export const LIVE_STATUS_PLATFORMS: readonly LivePlatform[] = ['twitch', 'bilibili', 'youtube'];

export interface RunDeps {
  /** 要查哪些行（生产传 `listLiveStatusTargets`，只含 visible）。 */
  listTargets: () => Promise<LiveStatusTarget[]> | LiveStatusTarget[];
  /**
   * 三个平台这一轮各自能不能跑（生产传 `platformStatus()`）。
   * ⚠️ 缺凭据是 **`skipped:no-credentials`（跳过）**，不是"失败"——
   *    与 `track.ts` 同一口径：没配密钥的机器上，这个作业不该每 3 分钟报一次红。
   */
  platformStatus: () => Record<LivePlatform, 'ok' | 'skipped:no-credentials'>;
  /** 问 Twitch 的若干批。**只返回结果，从不抛**（抛出去就等于把一轮炸掉）。 */
  fetchTwitch: (logins: readonly string[]) => Promise<TwitchStreamsOutcome>;
  fetchBilibili: (handles: readonly string[]) => Promise<BilibiliOutcome>;
  /** 写库（生产传 `applyLiveStatus`）。 */
  apply: (updates: readonly LiveStatusUpdate[], checkedAtSeconds: number) => number;
  /** 时钟，**Unix 秒**（文件头第七节）。 */
  nowSeconds: () => number;
}

/** 一个平台的读数。这一行日志就是照着它拼出来的。 */
export interface PlatformReport {
  platform: LivePlatform;
  /** 这一轮该平台的可见行数（**去重之前**：一行一行对齐界面上看得见的东西）。 */
  rows: number;
  /** 上游**真的答过**的行数。 */
  asked: number;
  /** 其中在播的行数。 */
  live: number;
  /** 真的写回去的行数。 */
  written: number;
  /** 上游**没答**的行数（这些行一个字段都没写）。 */
  failedRows: number;
  /** 形状不对、这个平台**根本查不了**的行数（twitch 的非 login / bilibili 的非房间号）。 */
  uncheckable: number;
  /** 因为上限或墙钟预算这一轮没问的行数（bilibili 才有）。 */
  skippedRows: number;
  /** 第一个失败原因（一次故障一条，不是每行一条）。 */
  cause: string | null;
  /** `ok` / `failed`（平台级） / `skipped:no-credentials` / `not-checked`（youtube）。 */
  status: 'ok' | 'failed' | 'skipped:no-credentials' | 'not-checked';
}

export interface RoundSummary {
  reports: PlatformReport[];
  /** 本轮真的写进去的总行数。 */
  written: number;
  startedAtSeconds: number;
  finishedAtSeconds: number;
}

/** 一轮的结局：**要打印的那一行** + 成交与否（`main` 拿它定退出码）。 */
export type RoundOutcome = { ok: true; line: string } | { ok: false; line: string };

// ===========================================================================
// 那一行长什么样
// ===========================================================================

/** Unix **秒** → ISO。本模块里**唯一**的换算点（文件头第七节）。 */
function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/** 一个平台那一段。形状刻意做成 `平台 ok/failed（…）`，好让 `journalctl | grep live-status` 一眼扫完。 */
function formatPlatform(report: PlatformReport): string {
  const notes: string[] = [];
  if (report.uncheckable > 0) notes.push(`查不了 ${String(report.uncheckable)} 行（标识形状不对）`);
  if (report.skippedRows > 0) notes.push(`本轮没问 ${String(report.skippedRows)} 行（上限/预算）`);
  if (report.failedRows > 0) {
    notes.push(
      `没答 ${String(report.failedRows)} 行（原值保留${report.cause === null ? '' : `：${report.cause}`}）`,
    );
  }
  const tail = notes.length === 0 ? '' : `；${notes.join('；')}`;

  if (report.status === 'not-checked') {
    return `${report.platform} 本轮不查（${String(report.rows)} 行保持"从没查过"）`;
  }
  if (report.status === 'skipped:no-credentials') {
    return `${report.platform} 跳过（没有凭据；${String(report.rows)} 行保持原值）`;
  }
  return (
    `${report.platform} ${report.status}（问 ${String(report.asked)} / 在播 ${String(report.live)} / ` +
    `写 ${String(report.written)}${tail}）`
  );
}

/** 成功那一行。**一行**：`journalctl -u mcsr-helper-live-status | tail -1` 就能看完整。 */
export function formatSummary(summary: RoundSummary): string {
  return (
    `live-status: 开始=${iso(summary.startedAtSeconds)} 结束=${iso(summary.finishedAtSeconds)} ` +
    `写入 ${String(summary.written)} 行 平台: ${summary.reports.map(formatPlatform).join(' ')}`
  );
}

/**
 * 失败那一行（两档共用）。
 *
 * ⚠️ 「一行都没写」这句只有在一**行都没写**时才能说 —— 所以它是算出来的，不是写死的：
 *    平台级全失败时确实是 0；写库失败时事务回滚，也是 0。
 */
export function formatFailure(kind: string, detail: string, written: number): string {
  return (
    `live-status: 本轮失败（${kind}）：${detail} —— ` +
    (written === 0
      ? '一行都没写，库里保留上一轮的读数（界面上的徽章最多晚 3 分钟）'
      : `已经写进去 ${String(written)} 行`)
  );
}

// ===========================================================================
// 引擎
// ===========================================================================

/**
 * 一个平台**这一轮到底能不能问**（形状判据）。
 *
 * ⚠️ 这两个正则**故意与各自的适配层同形但分开写**：适配层那一条管的是"发给谁"，
 *    这一条管的是"这一行值不值得发"。⛔ 它们是**两处**，改一处要想着另一处 ——
 *    代价认下（合起来会让"数据库里有什么形状"与"上游认什么形状"耦合成一件事，
 *    而后者是平台自己的规矩）。
 */
const TWITCH_LOGIN = /^[A-Za-z0-9_]{1,25}$/;
const BILIBILI_ROOM = /^\d{1,12}$/;

/** 按平台×标识把行分组：**同一个 login/房间号只问一次**，答案再摊回所有同标识的行。 */
function groupTargets(
  targets: readonly LiveStatusTarget[],
  platform: LivePlatform,
  shape: RegExp,
): { groups: Map<string, LiveStatusTarget[]>; rows: number; uncheckable: number } {
  const groups = new Map<string, LiveStatusTarget[]>();
  let rows = 0;
  let uncheckable = 0;
  for (const target of targets) {
    if (target.platform !== platform) continue;
    rows += 1;
    if (!shape.test(target.handle)) {
      uncheckable += 1;
      continue;
    }
    const list = groups.get(target.handle);
    if (list) list.push(target);
    else groups.set(target.handle, [target]);
  }
  return { groups, rows, uncheckable };
}

/**
 * ⚠️ 一行的 `viewerCount` 只允许来自**这一个逻辑**：上游给了数字就给数字，
 *    没给就 `null`（**绝不填 0** —— 那是本仓"绝不为缺失值填 0"那条）。
 */
function updatesFor(
  rows: readonly LiveStatusTarget[],
  isLive: boolean,
  viewerCount: number | null,
): LiveStatusUpdate[] {
  return rows.map((row) => ({
    id: row.id,
    isLive: isLive ? 1 : 0,
    viewerCount: isLive ? viewerCount : null,
  }));
}

/**
 * 跑一轮：读要查的行 → 分平台问上游 → **只写答过的那些行** → 报一行。
 * **唯一的写入口**（`main` 只是它的壳）。
 */
export async function runOnce(deps: RunDeps): Promise<RoundOutcome> {
  const startedAtSeconds = deps.nowSeconds();
  const targets = await deps.listTargets();
  const status = deps.platformStatus();

  const reports: PlatformReport[] = [];
  const updates: LiveStatusUpdate[] = [];

  // ---- twitch ----
  {
    const { groups, rows, uncheckable } = groupTargets(targets, 'twitch', TWITCH_LOGIN);
    const report: PlatformReport = {
      platform: 'twitch',
      rows,
      asked: 0,
      live: 0,
      written: 0,
      failedRows: 0,
      uncheckable,
      skippedRows: 0,
      cause: null,
      status: 'ok',
    };

    if (status.twitch !== 'ok') {
      report.status = 'skipped:no-credentials';
      // ⚠️ 一行都不问、一个字段都不写（缺凭据不是"没在播"）
      report.failedRows = rows;
    } else if (groups.size > 0) {
      const logins = [...groups.keys()];
      const outcome = await deps.fetchTwitch(logins);
      const liveByLogin = new Map<string, number | null>();
      for (const batch of outcome.answered) {
        for (const entry of batch.live) liveByLogin.set(entry.login, entry.viewerCount);
      }
      /*
       * ⚠️ **只有 `answered` 里的 login 才写**：`failures` 里那些行的三个字段
       *    原样留着（文件头第四节）。这一行 if 就是那条不变量本身。
       */
      for (const batch of outcome.answered) {
        for (const login of batch.logins) {
          const rowsOfLogin = groups.get(login);
          if (!rowsOfLogin) continue; // 理论到不了（login 就是从 groups 来的）
          const isLive = liveByLogin.has(login);
          const viewerCount = liveByLogin.get(login) ?? null;
          report.asked += rowsOfLogin.length;
          if (isLive) report.live += rowsOfLogin.length;
          updates.push(...updatesFor(rowsOfLogin, isLive, viewerCount));
        }
      }
      for (const batch of outcome.failures) {
        report.failedRows += batch.logins.reduce(
          (n, login) => n + (groups.get(login)?.length ?? 0),
          0,
        );
        report.cause ??= `${batch.kind}: ${batch.detail}`;
      }
      if (report.asked === 0) report.status = 'failed';
    }
    reports.push(report);
  }

  // ---- bilibili ----
  {
    const { groups, rows, uncheckable } = groupTargets(targets, 'bilibili', BILIBILI_ROOM);
    const report: PlatformReport = {
      platform: 'bilibili',
      rows,
      asked: 0,
      live: 0,
      written: 0,
      failedRows: 0,
      uncheckable,
      skippedRows: 0,
      cause: null,
      status: 'ok',
    };

    if (groups.size > 0) {
      const rooms = [...groups.keys()];
      const outcome = await deps.fetchBilibili(rooms);
      for (const room of outcome.answered) {
        const rowsOfRoom = groups.get(room.handle);
        if (!rowsOfRoom) continue;
        report.asked += rowsOfRoom.length;
        if (room.isLive) report.live += rowsOfRoom.length;
        updates.push(...updatesFor(rowsOfRoom, room.isLive, room.viewerCount));
      }
      for (const failure of outcome.failures) {
        report.failedRows += groups.get(failure.handle)?.length ?? 0;
        report.cause ??= `${failure.kind}: ${failure.detail}`;
      }
      report.skippedRows = outcome.skipped;
      if (report.asked === 0) report.status = 'failed';
    }
    reports.push(report);
  }

  // ---- youtube：这一轮不查（文件头第三节），但**要把它说出来** ----
  {
    const rows = targets.filter((target) => target.platform === 'youtube').length;
    reports.push({
      platform: 'youtube',
      rows,
      asked: 0,
      live: 0,
      written: 0,
      failedRows: 0,
      uncheckable: 0,
      skippedRows: 0,
      cause: null,
      status: 'not-checked',
    });
  }

  /*
   * ★ 写库：**一次调用、一个事务**（`applyLiveStatus`）。
   *   ⚠️ 平台之间不共用一行的状态，所以"混着写"不会互相影响；
   *      真炸了就是整批回滚（一行没写）—— 那比写进去一半更好说清楚。
   */
  let written = 0;
  try {
    written = deps.apply(updates, startedAtSeconds);
  } catch (error) {
    return {
      ok: false,
      line: formatFailure('db', error instanceof Error ? error.message : String(error), 0),
    };
  }

  /*
   * 把"写了几行"分摊回各自的平台（日志里那一段要能对上）。
   * ⚠️ 用**平台 + 行 id** 数：`updates` 里的 id 都是从 `groups` 来的，
   *    所以这里数一遍 id 集合就够了，不需要第二个计数器在别处维护。
   */
  const writtenIds = new Set(updates.map((update) => update.id));
  const idPlatform = new Map<string, LivePlatform>();
  for (const target of targets) idPlatform.set(target.id, target.platform);
  for (const report of reports) {
    let n = 0;
    for (const id of writtenIds) if (idPlatform.get(id) === report.platform) n += 1;
    report.written = n;
  }

  const finishedAtSeconds = deps.nowSeconds();
  const summary: RoundSummary = { reports, written, startedAtSeconds, finishedAtSeconds };

  /*
   * ★ 退出码的判据只有一条：**"有行要查的那个平台全都失败了"**才算这一轮失败。
   *   单平台失败但另一个成功 ⇒ 0（用户要的那半个功能还在工作），而那一行里
   *   仍然明明白白写着 `twitch failed（…）` —— 不靠退出码也该看得见。
   *
   * ⚠️★ `rows > 0` 这一半是**必须**的，而且它踩过一次：只写 `status === 'ok' || 'failed'`
   *    的话，一个**一行都没有**的平台（这里就是"bilibili 0 行时的 ok"）会冒充
   *    "还有人在工作"，于是"twitch 整个坏了"这件事**永远**报成成功 ——
   *    那正是本仓最怕的那种静默停摆（timer 照常跑、退出码全绿、库里几个月没新数据）。
   *    代价（认下）：某个平台真的一行都没有时，它的失败不会让这一轮变红 ——
   *    今天 bilibili 就是 0 行（实测），而 twitch 的成败仍然被这条判据管着。
   *    ⚠️ "没有行要查"不是失败（否则空名单的机器会每 3 分钟报一次红）；
   *      `skipped:no-credentials` 与 youtube 的 `not-checked` 同样不算。
   */
  const worked = reports.filter(
    (report) => report.rows > 0 && (report.status === 'ok' || report.status === 'failed'),
  );
  const allFailed = worked.length > 0 && worked.every((report) => report.status === 'failed');
  const line = formatSummary(summary);

  if (allFailed) {
    return { ok: false, line: `${line} —— 每一个有行要查的平台都失败了` };
  }
  return { ok: true, line };
}

// ===========================================================================
// CLI 壳
// ===========================================================================

/** 生产用的依赖：真的取数层、真的时钟（**秒**）、真的库。 */
function productionDeps(): RunDeps {
  const credentials = twitchCredentialsFromEnv();
  return {
    listTargets: listLiveStatusTargets,
    platformStatus: () => platformStatus(),
    fetchTwitch: (logins) => {
      /*
       * ⚠️ 没有凭据时**不在这里抛**：`platformStatus()` 已经把 twitch 报成
       *    `skipped:no-credentials`，`runOnce` 因此**根本不会调到这里**。
       *    这一句是给"有人绕过 status 直接调它"留的响亮失败（测试里也用它）。
       */
      if (credentials === null) {
        throw new Error('没有 Twitch 凭据（MCSR_TWITCH_ID / MCSR_TWITCH_SECRET）');
      }
      return fetchTwitchLiveStreams(logins, {
        tokens: credentials.tokens,
        clientId: credentials.clientId,
      });
    },
    fetchBilibili: (handles) => fetchBilibiliLiveRooms(handles),
    apply: applyLiveStatus,
    nowSeconds: () => Math.floor(Date.now() / 1000),
  };
}

/**
 * CLI 的正文。**返回退出码**（不直接设 `process.exitCode`）—— 这样测试能断言它，
 * 而"崩了也是非零"那一半留给 `isMain` 那个 try/catch。
 */
export async function main(argv: string[], deps: RunDeps = productionDeps()): Promise<number> {
  /*
   * ⚠️ 本作业**一个参数都没有**（timer 拉起的就是 `node live-status.js`），
   *    所以不认识的参数**当场拒绝**、退出码 2（用法错误）。
   *    理由与 `ranked-streams.ts` 逐字相同：一个被忽略的 `--dry-run` 看起来像
   *    "跑了一轮干活的"，而他以为自己在预演 —— 代价是**真的写了一次库**。
   */
  if (argv.length > 0) {
    console.error(`✗ 不认识的参数：${argv.join(' ')}`);
    console.error('用法：node live-status.js（没有参数 —— 这一个是给 systemd timer 跑的）');
    return 2;
  }

  const outcome = await runOnce(deps);

  /*
   * ★ 成功走 stdout、失败走 stderr：systemd 把它们记成不同的优先级
   *   （info / err）⇒ `journalctl -p err -u mcsr-helper-live-status` 直接就是
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
 * 只有**被当作程序执行**时才跑（文件头第八节）。
 * ⚠️ 用 URL 比较而不是 `process.argv[1]?.endsWith('live-status.js')`：
 *    后者会把一个恰好同名的**别的**东西当成自己，URL 比较是精确的。
 */
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    /*
     * 逃出 `main` 的都是**我们自己的 bug** 或数据库层面的问题（上游失败在 `runOnce`
     * 里就结掉了）⇒ 连栈一起打进 journald 再非零退出：这种错重试永远不会成功。
     */
    console.error('[live-status] 这一轮没能跑起来：');
    console.error(error);
    process.exitCode = 1;
  } finally {
    // WAL 收尾（`admin-cli.ts` / `track.ts` / `ranked-streams.ts` 结尾同一句）
    closeDb();
  }
}
