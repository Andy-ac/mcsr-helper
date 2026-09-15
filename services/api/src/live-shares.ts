/**
 * 实时分享（`live_shares`）的数据访问层。
 *
 * 表结构与 payload 的两种形状在 `019_live_shares.ts` 与 `packages/shared/src/liveShares.ts`
 * 的文件头；本层与它们的分工是：
 *   · **不解析请求 body**（那是 `parseSharePost` 与路由层的事）—— 这里收的是一份
 *     已经归一化好的 `SharePayload`；
 *   · **不判权限**（除了"恢复只有本人"这一条，spec §6.1 明确要求比对 `user_id`）；
 *   · **不看时钟**：`now` 一律由调用方传进来（路由层在一个请求里取一次，
 *     `serverNow` 与它同源 —— spec §5.1 那条"同一个 now"）。
 *
 * ===========================================================================
 * ★★ 三条纪律（每一条都有一条测试钉着，改之前先读 spec 的对应小节）
 * ===========================================================================
 * ① **到点是一个查询条件，不是一次状态变更**（spec §4.1）。
 *    判据只有一句话、**只有这一处实现**：`ON_BOARD`。到点什么都不做 ——
 *    没有后台任务参与，所以不存在"任务没跑、过期内容还挂在看板上"这个故障模式。
 *
 * ② **两种限额落在两个地方，口径刻意不同**（spec §3.3 / §3.4）：
 *    · room 的"一人一条"是**语义不变量** ⇒ 数据库的部分唯一索引；它的谓词
 *      **不看过期**，所以 `createShare` 的第一步必须"先把我自己 active 的行置 replaced"。
 *    · seed 的"20 条"是**额度** ⇒ 本层在写入事务里数一遍，判据**看过期**
 *      （一条已经不在看板上的行凭什么占额度）。
 *    ⚠️ 谁把这两段"统一"掉，谁就会在"刚过期还没被回收"的那一小时里出问题。
 *
 * ③ **读出来的 payload 要过一遍 zod，坏行跳过并记日志**（spec §3.2）。
 *    数据库不知道 payload 的形状 ⇒ 一次手改库、一次回滚、将来某次迁移都可能留下
 *    "形状对不上 kind"的行。透传给前端的话，界面上会渲染出一排破折号 ——
 *    看起来像我们这个功能坏了。
 *
 * ===========================================================================
 * 行 → 对外形状**只有一处**实现
 * ===========================================================================
 * `buildItem` 是唯一的转换点：看板、`mine`、以及路由层那两个 handler 的
 * `{ item }` 都走它。多一处手写的映射，就多一处将来会漂移的地方。
 */
import type {
  LiveShare,
  ShareKind,
  ShareListResponse,
  ShareMinutes,
  SharePayload,
  ShareStatus,
  ShareSummary,
} from '@mcsr/shared';
import {
  parseSharePayload,
  SHARE_BOARD_LIMIT,
  SHARE_LIMITS,
  SHARE_RETENTION_MS,
} from '@mcsr/shared';
import { newId } from './auth/tokens';
import { getDb } from './db';

/**
 * "在不在看板上" —— **只有这一处**实现这个判据（spec §4.1）。
 *
 * ⚠️ 表名限定符不是装饰：看板查询要 `LEFT JOIN users` 取作者名，而 **users 自己
 *    也有一个 `status` 列**（004_auth）⇒ 不限定的话 SQLite 会当场报
 *    `ambiguous column name: status`（实测过）。那种错只在跑到这条查询时才出现，
 *    在 schema 上看不出来。
 * ⚠️ 判据只有一句：`status='active' AND expires_at > now`。`mine` 是**另一个**判据
 *    （它还要含 `hidden`），别把两者合并 —— 它们的差别见下面 `listMine` 的注释。
 */
const ON_BOARD = "live_shares.status = 'active' AND live_shares.expires_at > ?";

/**
 * 数据库里的一行（snake_case）。`author_name` 来自 users 的联结，不是本表的列。
 *
 * ⚠️ `kind` / `status` 直接标成 shared 里那两个联合类型：迁移 019 的 CHECK 把这两列的
 *    值域钉死了（`kind IN ('room','seed')`、`status IN ('active','hidden','replaced')`），
 *    所以这里不是"相信数据库"，而是"schema 已经保证了"。
 */
export interface LiveShareRow {
  id: string;
  user_id: string;
  kind: ShareKind;
  payload: string;
  note: string;
  status: ShareStatus;
  created_at: number;
  expires_at: number;
  /** 只有 `hidden` 时有值（CHECK 要求它与 `hidden` 同进同退）。 */
  hidden_at: number | null;
  author_name: string | null;
}

/**
 * 联结 users 时**只取 display_name**（与 `videos.ts` 同一条纪律）：
 * 绝不能写成 `u.*` 或 `SELECT *` —— users 里有 email、password_hash、mc_uuid，
 * 一个星号就会把它们连同响应发出去，而从响应上也看不出多带了东西。
 * 字段名写在这里，多带一个都必须显式加一行。
 */
const SELECT_COLUMNS = `
  live_shares.id, live_shares.user_id, live_shares.kind, live_shares.payload,
  live_shares.note, live_shares.status, live_shares.created_at, live_shares.expires_at,
  live_shares.hidden_at, u.display_name AS author_name
`;

const FROM_LIVE_SHARES = `
  FROM live_shares LEFT JOIN users u ON u.id = live_shares.user_id
`;

/*
 * ⚠️ 上面用 **LEFT JOIN** 而不是 JOIN，理由与 `contributors.ts` 同一条：
 *    外键是 `ON DELETE CASCADE`，"分享行还在、用户行没了"理论上不会发生 ——
 *    但真发生了（外键被关掉过一次、手工改过库、将来某次迁移重建表），JOIN 会让那些行
 *    **从看板上静默消失**：一个人明明挂着东西，别人却看不到，而没有任何报错。
 *    宁可显示一个没有名字的人，也不要凭空少一条分享。
 */

// ---------------------------------------------------------------------------
// 行 → 对外形状
// ---------------------------------------------------------------------------

/**
 * 解析一行的 payload；形状对不上（或根本不是 JSON）就回 `null`。
 *
 * ⚠️ `JSON.parse` 也要包起来：`payload` 那一列只有 `NOT NULL`，没有 JSON 约束 ——
 *    一次手改库完全可能留下半截 JSON，而那时候抛出来的异常会让**整条看板查询**挂掉，
 *    表现是"看板整个读不出来"，比"少一条"严重得多。
 * ⚠️ 这里**不记日志**：跳过由调用方决定 —— 列表在哪一步跳过就在哪一步记一条（`toItems`），
 *    单行那条路直接拒绝（`buildItem`）。在这里记的话，一次列表读会给同一个坏行**两条**日志
 *    （解析一次、跳过一次），而它们说的是同一件事。
 * ⚠️ 顺带写明一个**不是** bug 的重复：同一次请求里，一个坏行如果既在看板上、又是查看者自己的，
 *    会被 `listBoard` 与 `listMine` 各记一条 —— 那是**两次读**，各记各的。为它去加去重状态
 *    得不偿失（日志里 id 相同，一眼能看出是同一条）。
 */
function parsePayloadOf(row: LiveShareRow): SharePayload | null {
  let raw: unknown;
  try {
    raw = JSON.parse(row.payload);
  } catch {
    return null;
  }
  return parseSharePayload(row.kind, raw);
}

/** 一行 + 它已经解析好的 payload → 对外的形状。 */
function toItem(row: LiveShareRow, payload: SharePayload, viewerId: string): LiveShare {
  /*
   * ⚠️ 逐字段展开成**普通对象字面量**，不返回行对象本身：`node:sqlite` 的行对象
   *    原型不是 `Object.prototype`，而 `deepStrictEqual` 会比较原型 ——
   *    直接返回行的话，测试里"两边打印出来一模一样却断言失败"（videos.ts 同一条坑）。
   */
  return {
    id: row.id,
    kind: row.kind,
    payload,
    note: row.note,
    /*
     * ⚠️ 兜底成空串，而不是把那一行丢掉：这里唯一可能为 null 的情形是"用户行没了"
     *    而分享行还在（见上面 LEFT JOIN 的注释），而 `LiveShare.authorName` 是不可空的
     *    （前端按 `shares.boardBy` 渲染）。宁可显示一个没有名字的人。
     */
    authorName: row.author_name ?? '',
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    status: row.status,
    mine: row.user_id === viewerId,
  };
}

/**
 * 一行 → 对外的形状（spec §5.1 的 item）。**唯一的转换点** —— 见文件头。
 *
 * ⚠️ `_now` 今天用不到：item 的每个字段都直接来自那一行，剩余时间是前端拿
 *    `serverNow` 的偏移量自己算的（§5.1 / §7.6）。它留在签名里是因为路由层要在
 *    **同一个** `now` 下渲染 item 与 `serverNow`；下划线前缀只是告诉 biome
 *    "这个参数是**有意**不用的"，别把它删掉。
 *
 * ⚠️ 坏行在这里是 **throw**，不是"回一个空壳"：列表查询已经把它们跳过了，
 *    所以走到这里说明调用方绕过了那道过滤 —— 而把一个半个形状的对象发出去，
 *    正是整件事要避免的（spec §3.2）。
 */
export function buildItem(row: LiveShareRow, viewerId: string, _now: number): LiveShare {
  const payload = parsePayloadOf(row);
  if (!payload) {
    throw new Error(
      `分享行 ${row.id} 的 payload 与 kind=${row.kind} 对不上 —— 列表查询会跳过它，` +
        '单行那条路不该把坏形状发出去（spec §3.2）',
    );
  }
  return toItem(row, payload, viewerId);
}

/** 一批行 → 对外形状。坏行**跳过并记日志**（纪律 ③）。 */
function toItems(rows: LiveShareRow[], viewerId: string): LiveShare[] {
  const items: LiveShare[] = [];
  for (const row of rows) {
    const payload = parsePayloadOf(row);
    if (!payload) {
      console.warn(`[shares] 分享行 ${row.id} 的 payload 与 kind=${row.kind} 对不上，已跳过`);
      continue;
    }
    items.push(toItem(row, payload, viewerId));
  }
  return items;
}

/**
 * 按 id 取一行的**原始形态**（含 `user_id` 与 `status`）。
 *
 * ⚠️ 名字里的 "edit" 不是"编辑"：本栏目**没有**编辑功能（spec §9：改内容 = 下架 + 重发，
 *    这也让"条目内容不可变"成为一条可以依赖的性质）。它的用途是"把一整行拿给上层
 *    做判断/回读"：路由层用它判 404 与 `user_id`，`createShare` / 两个 setter 用它回读。
 * ⚠️ 它**不解析 payload**：判断那一行坏不坏是 `buildItem` / `toItems` 的事，
 *    而"这行在不在、是谁的"不需要 payload 是对的。
 */
export function getShareForEdit(id: string): LiveShareRow | undefined {
  const row = getDb()
    .prepare(`SELECT ${SELECT_COLUMNS} ${FROM_LIVE_SHARES} WHERE live_shares.id = ?`)
    .get(id) as unknown as LiveShareRow | undefined;
  return row;
}

// ---------------------------------------------------------------------------
// 看板 / 我的那几条
// ---------------------------------------------------------------------------

/**
 * 看板上那几行（**多取一行**，`truncated` 靠它算）。
 *
 * ⚠️ `LIMIT` 是 `SHARE_BOARD_LIMIT + 1` 而不是上限本身：只按"拿到了 200 行"就报
 *    `truncated: true` 的话，**正好 200 行**的看板会撒谎（界面上写"只显示了一部分"，
 *    而它一条都没少）。多取的那一行不用，只用来回答"还有没有"。
 */
function boardRows(kind: ShareKind, now: number): LiveShareRow[] {
  return getDb()
    .prepare(
      `SELECT ${SELECT_COLUMNS} ${FROM_LIVE_SHARES}
        WHERE live_shares.kind = ? AND ${ON_BOARD}
        ORDER BY live_shares.created_at DESC, live_shares.id ASC
        LIMIT ?`,
    )
    .all(kind, now, SHARE_BOARD_LIMIT + 1) as unknown as LiveShareRow[];
}

/**
 * 看板：所有**在展示**的行（含我自己那条），外加"是不是被截断了"（spec §5.1）。
 *
 * 排序是 `created_at DESC, id ASC`：第二个键是**稳定排序**的兜底（本仓每条列表查询
 * 都这么做）—— 同一毫秒写入的两行如果顺序不定，每次刷新看板都长得不一样，
 * 那看起来像"看板在自己变"。
 *
 * ⚠️ 上界是**保险，不是功能**（spec §9）：今天 6 个账号 × 最多 20 条也到不了。
 *    真被截断时界面必须说一句"只显示了一部分"，不许安静截断。
 */
export function listBoardWithMeta(
  kind: ShareKind,
  now: number,
  viewerId: string,
): { items: LiveShare[]; truncated: boolean } {
  const rows = boardRows(kind, now);
  const truncated = rows.length > SHARE_BOARD_LIMIT;
  const kept = truncated ? rows.slice(0, SHARE_BOARD_LIMIT) : rows;
  return { items: toItems(kept, viewerId), truncated };
}

/**
 * 看板上那几行（`truncated` 见 `listBoardWithMeta`）。
 *
 * `viewerId` 只为 item 上的 `mine` 标记 —— 板上的行是谁的都能看，但"这条是你发的"
 * 只有问的人自己知道。
 */
export function listBoard(kind: ShareKind, now: number, viewerId: string): LiveShare[] {
  return listBoardWithMeta(kind, now, viewerId).items;
}

/**
 * 我自己那几条：**未过期**的（含已下架的），`created_at DESC, id ASC`（spec §5.1）。
 *
 * ⚠️ 判据与看板**不同**，而且必须不同：`mine` 还要含 `hidden`（作者必须看得见自己
 *    刚下架的那条，否则"下架"对他表现为"凭空消失"，他会再发一遍）。
 * ⚠️ 而 `replaced` **不在里面**：它在库里已经"回不来"了（§4.1），而 `mine` 里每一行
 *    都对应界面上的一个动作（下架 / 恢复），一个没有任何动作可做的行只会在界面上
 *    变成一个没人定义过的画面。spec §5.1 的字段注释也写着「mine 里两种都可能」。
 * ⚠️ 已过期的行同样不在里面：到点之后连"恢复"都没有意义了（§4.2）。
 */
export function listMine(kind: ShareKind, userId: string, now: number): LiveShare[] {
  const rows = getDb()
    .prepare(
      `SELECT ${SELECT_COLUMNS} ${FROM_LIVE_SHARES}
        WHERE live_shares.user_id = ? AND live_shares.kind = ?
          AND live_shares.status IN ('active', 'hidden')
          AND live_shares.expires_at > ?
        ORDER BY live_shares.created_at DESC, live_shares.id ASC`,
    )
    .all(userId, kind, now) as unknown as LiveShareRow[];
  return toItems(rows, userId);
}

/**
 * **我的**额度用量：我自己的行里满足"在看板上"这个判据的条数（spec §5.1 的 `liveCount`）。
 *
 * ⚠️★ 判据**必须**与看板完全相同（同一个 `ON_BOARD`），不能只数 `status='active'`：
 *    一条刚过期、还没被回收的行**不占额度**（它已经不在看板上了，凭什么占）。
 *    这正是 §3.4 那个"部分唯一索引不看过期"的另一半 —— 索引与限额的口径不同，
 *    而它们**必须**不同，否则过期未回收的那一小时里你会发不出新的一条。
 */
export function countLive(kind: ShareKind, userId: string, now: number): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM live_shares
        WHERE live_shares.user_id = ? AND live_shares.kind = ? AND ${ON_BOARD}`,
    )
    .get(userId, kind, now) as { n: number };
  return row.n;
}

/** **全站**在展示的条数（`summarize` 用；不加 user 过滤，spec §5.2 的 `live` 是全站的）。 */
function countBoard(kind: ShareKind, now: number): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM live_shares WHERE live_shares.kind = ? AND ${ON_BOARD}`)
    .get(kind, now) as { n: number };
  return row.n;
}

/**
 * 把上面几个拼成 spec §5.1 的那一份响应。
 *
 * ⚠️★ 路由层**只调它一次**，不要在路由里再拼一遍：`serverNow` 与 `liveCount`
 *    必须是**同一个时刻**算出来的。分两处取时间的话，两者之间隔着几毫秒 ——
 *    而前端正是拿 `serverNow` 去算"还剩几分钟"的（§5.1 那条 ★）。
 */
export function buildListResponse(kind: ShareKind, userId: string, now: number): ShareListResponse {
  const board = listBoardWithMeta(kind, now, userId);
  return {
    kind,
    items: board.items,
    mine: listMine(kind, userId, now),
    limit: SHARE_LIMITS[kind],
    liveCount: countLive(kind, userId, now),
    serverNow: now,
    truncated: board.truncated,
  };
}

/** 摘要的载荷部分：`ShareSummary` 去掉 `serverNow`（那个字段由路由层补，见 `summarize`）。 */
export type ShareSummaryCounts = Omit<ShareSummary, 'serverNow'>;

/**
 * 介绍页用的摘要（spec §5.2）：两个 kind 各有多少条在展示 + 各自的额度。
 *
 * ⚠️ 这里的计数是**全站**的（介绍页那句「N 条在展示」），不是"我的" ——
 *    所以两个数都走 `countBoard`，而不是 `countLive`。
 * ⚠️ `serverNow` **不在这里**：路由层把同一个 `now` 一起写进响应
 *    （`{ ...summarize(now), serverNow: now }`），所以时间同样只有一个来源。
 */
export function summarize(now: number): ShareSummaryCounts {
  return {
    room: { live: countBoard('room', now), limit: SHARE_LIMITS.room },
    seed: { live: countBoard('seed', now), limit: SHARE_LIMITS.seed },
  };
}

// ---------------------------------------------------------------------------
// 发布
// ---------------------------------------------------------------------------

export type CreateShareResult =
  | {
      ok: true;
      /** 库里**现在**的那一行（回读的），路由层拿它做 `buildItem` 与审计。 */
      share: LiveShareRow;
      /**
       * 这一次**被换掉**了几条（只有 room 可能非 0）。
       *
       * ⚠️ 它是审计那一句"替换掉 N 条"的唯一来源（spec §6.3）：替换发生在事务里，
       *    事后按 `status='replaced'` 去数会把**历史上**被替换的行一起算进去。
       *    seed 永远是 0 —— 它是"再加一条"，不替换（spec §2 裁决 12）。
       */
      replaced: number;
    }
  | { ok: false; reason: 'at_limit'; limit: number };

/**
 * 发一条。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ **不校验重复**（spec §5.3 明文要求写进注释）
 * ---------------------------------------------------------------------------
 * 房间号与种子**都不是去重键**：同一个房间号可以被两个人同时挂着（现实里就是两个人
 * 抄了同一个房），同一个人也可以把刚下架的那条再挂一次。
 * ⇒ 想在这里加一句"这个码已经有人挂过了"之前，先读 spec §5.3 与 §10 第 5 条。
 *
 * ---------------------------------------------------------------------------
 * `expires_at = now + minutes * 60_000`，`now` 是**服务端**取的
 * ---------------------------------------------------------------------------
 * 不接受客户端传时间 —— 那等于让人自己决定什么时候过期。所以这个函数的 `now`
 * 由路由层在请求开头取一次，而不是这里再取一次（§5.3）。
 */
export function createShare(input: {
  kind: ShareKind;
  userId: string;
  payload: SharePayload;
  note: string;
  minutes: ShareMinutes;
  now: number;
}): CreateShareResult {
  const db = getDb();
  const expiresAt = input.now + input.minutes * 60_000;

  db.exec('BEGIN');
  try {
    let replaced = 0;

    if (input.kind === 'room') {
      /*
       * ⚠️★★ 这一步**不看过期**，而且它不是"顺手清理"：
       *    room 的部分唯一索引谓词是 (kind='room' AND status='active')，**它不看过期**
       *    ⇒ 一条刚过期还没被回收的行照样占着那个名额。
       *    所以"先把我自己所有 active 的 room 行置 replaced"是**让索引能成立的必需步骤**。
       *    把它改成"先查有没有、有就报错"，会让刚过期的那一小时里发不出新的一条。
       */
      const swap = db
        .prepare(
          "UPDATE live_shares SET status = 'replaced' WHERE user_id = ? AND kind = 'room' AND status = 'active'",
        )
        .run(input.userId);
      replaced = Number(swap.changes);
    } else {
      /*
       * 额度：★ 判据与看板**完全相同**（看过期），与上面 room 那一步刻意不同 ——
       *   一条已经不在看板上的行凭什么占额度。两处不一致是**有意的**，
       *   别把这两段"统一"掉。
       *
       * ⚠️ 这个"数一遍"与下面的"插进去"在**同一个事务**里，而这个服务是
       *    单进程 + 同步 SQLite 驱动（`node:sqlite`），所以两者之间**不可能**插进
       *    另一个请求（spec §3.3；`setContributors` 用的是同一条依据）。
       */
      const live = countLive(input.kind, input.userId, input.now);
      if (live >= SHARE_LIMITS[input.kind]) {
        db.exec('ROLLBACK');
        return { ok: false, reason: 'at_limit', limit: SHARE_LIMITS[input.kind] };
      }
    }

    const id = newId();
    db.prepare(
      `INSERT INTO live_shares (id, user_id, kind, payload, note, status, created_at, expires_at, hidden_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NULL)`,
    ).run(
      id,
      input.userId,
      input.kind,
      JSON.stringify(input.payload),
      input.note,
      input.now,
      expiresAt,
    );

    /*
     * 回读：返回的是**库里现在真正的那一行**，不是"我以为我写进去的那一行"。
     * ⚠️ 读不回来在逻辑上不可能（刚插进去），所以这里 throw 而不是写 `!` 或 `?? null`：
     *    真发生了就是我们自己的 bug，宁可炸在测试里，也不要往下传一个空对象。
     */
    const row = getShareForEdit(id);
    if (!row) throw new Error('刚插入的分享行读不回来 —— 说明这次写入根本没落库');

    db.exec('COMMIT');
    return { ok: true, share: row, replaced };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// ---------------------------------------------------------------------------
// 下架 / 恢复
// ---------------------------------------------------------------------------

/**
 * 这两个动作的失败原因。**它们各自对应一种不同的回应**：
 *
 * | reason | 含义 | 路由给的 HTTP |
 * |---|---|---|
 * | `not_found` | 那一行已经不在了 | 404 |
 * | `forbidden` | 恢复别人的东西（含管理员 —— 管理动作是单向的，§6.2） | 403 |
 * | `not_active` | 下架一条已经不在展示的行（hidden / replaced） | 409 `invalid_state` |
 * | `not_hidden` | 恢复一条本来就没被下架的行（active / replaced） | 409 `invalid_state` |
 * | `expired` | 到点了：两种动作都没有意义了 | 409 `invalid_state` + reason `expired` |
 * | `at_limit` | 恢复时"已经有另一条"：room 看板上还有一条 / seed 已满 20 条（§4.3） | 409 **`at_limit`**（不是 `invalid_state`）|
 *
 * ⚠️ room 那一格的"已经有另一条"**只算在看板上的**（`status='active' AND expires_at > now`）：
 *    一条 `status='active'` 但已过期的兄弟行不算，恢复会把它顶掉 —— 见 `setShareVisible`
 *    里那段 ★ 注释（判据取字面读法会让「恢复」几乎永久按不动）。
 * ⚠️ `at_limit` 那一行要**单独分支**：spec §4.2 / §13 把它定成一个独立的拒绝码，
 *    所以路由层不能在"其它失败一律 `invalid_state`"那条兜底里顺手带上它。
 * ⚠️ `not_active` / `not_hidden` 是"状态不对"这一格的两种说法：它们的区别就是**用户
 *    下一步该做什么**（刷新一下 vs 这条已经回不来了），所以不必合并成一个笼统的
 *    `invalid_state` —— 路由层会在响应里带上它。
 */
export type SetVisibilityFailure =
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'forbidden' }
  | { ok: false; reason: 'not_active' }
  | { ok: false; reason: 'not_hidden' }
  | { ok: false; reason: 'expired' }
  | { ok: false; reason: 'at_limit' };

export type SetVisibilityResult = { ok: true; share: LiveShareRow } | SetVisibilityFailure;

/**
 * 下架一条（`active → hidden`，写 `hidden_at`）。拥有者与治理者都可以走到这里 ——
 * 谁被允许调它是**路由层**的事（`share.moderate`），本函数只看状态。
 *
 * ⚠️ 三个失败分支的**顺序是刻意的**：行在不在 → 状态 → 时间。
 *    §4.2 的表里"下架一条 hidden"与"下架一条 active 但已过期"是两格，
 *    而"一条 hidden 且已过期"的行只落在第一格：它本来就不能被下架，与过没过期无关。
 */
export function setShareHidden(id: string, now: number): SetVisibilityResult {
  const db = getDb();

  db.exec('BEGIN');
  try {
    const row = getShareForEdit(id);
    if (!row) {
      db.exec('ROLLBACK');
      return { ok: false, reason: 'not_found' };
    }
    if (row.status !== 'active') {
      db.exec('ROLLBACK');
      return { ok: false, reason: 'not_active' };
    }
    // ⚠️ 判据是 `expires_at <= now` —— 它是 `ON_BOARD` 里那个 `expires_at > now` 的
    //    **反面**，边界那一毫秒必须与看板一致，否则会出现"看板上已经没有了、
    //    下架却说它还活着"的一瞬间。
    if (row.expires_at <= now) {
      db.exec('ROLLBACK');
      return { ok: false, reason: 'expired' };
    }

    db.prepare("UPDATE live_shares SET status = 'hidden', hidden_at = ? WHERE id = ?").run(now, id);

    // 回读：返回库里现在真正的那一行（与 createShare 同一条理由）
    const after = getShareForEdit(id);
    if (!after) throw new Error('刚下架的分享行读不回来 —— 说明这次写入根本没落库');

    db.exec('COMMIT');
    return { ok: true, share: after };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * 恢复一条（`hidden → active`，清掉 `hidden_at`）。
 *
 * ⚠️ `actorId` **必须**是那一行的作者（spec §6.1：恢复只有本人）—— 管理动作是单向的。
 *    路由层已经先判过一次并回 403（它要把"局外人"与"管理员"分开），这里是**数据层
 *    这一道**：权限结论不该只存在于路由里，否则将来多一条调用路径就少一道门。
 *
 * ---------------------------------------------------------------------------
 * ★ 为什么要先看额度，而不是自动顶掉当前那条（spec §4.3）
 * ---------------------------------------------------------------------------
 * 场景：我挂了一条 room → 下架 → 又发了一条新的 → 现在想恢复旧的。
 * 此时库里我**已经有一条 active 的 room**，恢复会让部分唯一索引当场报错。
 * 两个选择：自动把当前那条置 `replaced`，或者**拒绝**让我自己先下架。
 * ⇒ 选拒绝：前者是一次"**你没按、但东西被顶掉了**"，而恢复按钮上写的是"恢复这条"，
 *   谁也不会预期它顺手杀掉另一条。代价是多一步，而那一步只在"下架过、又发过、
 *   又想恢复"这个少见的组合里出现。
 *
 * ⚠️★ 但"另一条 active"指的**只是"在看板上的"那一条**（spec §4.3 的补记，2026-09-15；
 *    这一条是评审实测挖出来的一个可达 500）。一条 `status='active'` 但**已过期**的
 *    兄弟行不在看板上、自己也恢复不了，还迟早被回收任务删掉 —— 顶掉它不会让任何人
 *    看到的东西消失，所以恢复**放行**，并在**同一个事务里**先把它置 `replaced`
 *    （与发布路径同一个手法，见下面那段注释）。seed 那一支不受影响：它没有唯一索引。
 */
export function setShareVisible(id: string, now: number, actorId: string): SetVisibilityResult {
  const db = getDb();

  db.exec('BEGIN');
  try {
    const row = getShareForEdit(id);
    if (!row) {
      db.exec('ROLLBACK');
      return { ok: false, reason: 'not_found' };
    }
    // ⚠️ 归属先于状态：别人的东西"状态不对"也不该告诉他这条是什么状态
    if (row.user_id !== actorId) {
      db.exec('ROLLBACK');
      return { ok: false, reason: 'forbidden' };
    }
    if (row.status !== 'hidden') {
      db.exec('ROLLBACK');
      return { ok: false, reason: 'not_hidden' };
    }
    if (row.expires_at <= now) {
      db.exec('ROLLBACK');
      return { ok: false, reason: 'expired' };
    }

    /*
     * ★ 额度判据与 `liveCount` / seed 发布**完全相同**（同一个 `countLive`）：
     *   正在被恢复的这一行是 hidden，所以它自己不在计数里 —— 数到的正是"看板上还有几条"。
     *   ⇒ 拒的是**在看板上**的兄弟行：它看得见、有人可能正在用，顶掉它正是 §4.3 要防的那件事。
     */
    const live = countLive(row.kind, row.user_id, now);
    if (live >= SHARE_LIMITS[row.kind]) {
      db.exec('ROLLBACK');
      return { ok: false, reason: 'at_limit' };
    }

    if (row.kind === 'room') {
      /*
       * ⚠️★★ 这一步**不是**可选的，而且它正是 `countLive` 在这里不够用的原因：
       *    上面那一句带 `expires_at > now`，而 **idx_live_shares_room_one 的谓词不看过期** ——
       *    缝里藏着一个**可达的 500**：我有一条刚过期、还没被回收的 active room 行
       *    （回收任务只删 `expires_at < now - 24h` 的行 ⇒ 这个状态最长存在约 24 小时），
       *    上面那句数出来就是 0 ⇒ 恢复放行 ⇒ 紧接着的 UPDATE 撞上索引 ⇒ SQLite 抛错 ⇒ 路由 500。
       *    而按钮正好在界面上：要恢复的那条是 hidden 且没过期，它就在 `mine` 里。
       *    ⇒ 先把我自己所有 active 的 room 行（此刻只可能是那条过期未回收的）置 `replaced`，
       *      再激活目标行 —— 与发布路径（§3.4）**同一个手法**，也是索引能成立的必需步骤。
       *    ⚠️ 顺序不能颠倒：先置 replaced 再数额度的话，一条**在看板上**的兄弟行会被顶掉，
       *      而那正是 §4.3 上半节要拒绝的事。
       *    ⚠️ 只有 room 走这一步：seed 没有唯一索引，恢复一条只会在看板上多加一行，
       *      而 `countLive` 算的正是那一行。
       */
      db.prepare(
        "UPDATE live_shares SET status = 'replaced' WHERE user_id = ? AND kind = 'room' AND status = 'active'",
      ).run(row.user_id);
    }

    db.prepare("UPDATE live_shares SET status = 'active', hidden_at = NULL WHERE id = ?").run(id);

    const after = getShareForEdit(id);
    if (!after) throw new Error('刚恢复的分享行读不回来 —— 说明这次写入根本没落库');

    db.exec('COMMIT');
    return { ok: true, share: after };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// ---------------------------------------------------------------------------
// 回收
// ---------------------------------------------------------------------------

/**
 * 删掉过期超过 `SHARE_RETENTION_MS`（24 小时）的行 —— **给定时任务用的**。
 *
 * ⚠️★ 它与"到点"是**两件不同的事**：看板看不看得见一条行，完全由 `ON_BOARD` 决定
 *    （纪律 ①），所以这个函数**没跑、跑挂了、晚跑了**，都不影响任何人看到什么，
 *    只影响库的大小。这正是把"到点"做成查询条件换来的性质（spec §4.1 / §5.5）。
 *    ⇒ 调用方（`index.ts` 的定时器）要 try/catch 并只打日志，不要让它影响服务。
 *
 * ⚠️ 判据是**严格小于**：`expires_at < now - 24h`。正好 24 小时的那一条留着。
 *
 * @returns 实际删掉的行数（0 是完全正常的值）。
 */
export function deleteExpiredShares(now: number): number {
  const result = getDb()
    .prepare('DELETE FROM live_shares WHERE expires_at < ?')
    .run(now - SHARE_RETENTION_MS);
  return Number(result.changes);
}
