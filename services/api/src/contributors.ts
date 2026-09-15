/**
 * 贡献者的数据访问层 —— **通用**，不叫 `resourceContributors`。
 *
 * 用户原话的最后一句是「这套逻辑之后在其他板块还要用到」，所以这一层的每一个
 * 函数都按 `(entityType, entityId)` 两段式收参，**没有一处假设被贡献的是资源**：
 * 加一个板块时，这一层一个字都不用改（改的是 shared 里那个闭集加一个值、
 * 以及那个板块自己的路由里传入一个 `exists`）。
 *
 * 表结构、字段含义、"为什么没有外键指向被贡献的那一行"的代价说明，都在
 * `packages/shared/src/contributors.ts` 与 `018_content_contributors.ts` 的文件头。
 *
 * ===========================================================================
 * ⚠️ 这一层的唯一一条铁律：**不写孤儿行**
 * ===========================================================================
 * 孤儿行 = `(entity_type, entity_id)` 指向一行不存在的内容的贡献者记录。
 * 它是这个设计里最容易发生、而且**最不会报错**的失败：
 *   · 数据本身合法（没有约束能挡住它）；
 *   · 查询照常返回（名单上多一个名字）；
 *   · 表现是"某人被列为他根本改不了的那条内容的贡献者"，几个月后才有人问。
 *
 * 所以两条写入路径各有一道**结构性的**防线，而不是靠调用方自觉：
 *   · `setContributors` **必须**拿到一个 `exists()` 回调（不是可选的）——
 *     数据层不知道"内容住在哪张表"，但正因如此，它不能假装自己能查；
 *     把这件事变成**必填参数**，就不会出现"某条新路径忘了判在不在"。
 *     而且它在**事务里**被调用：路由先判一次存在性、再解析 body（有 await），
 *     中间那条内容可能已经被别人删掉 —— 只在路由里判就是典型的 TOCTOU。
 *   · 删除那一侧（`deleteContributors`）由**每一处硬删除**自己调，
 *     并有一条测试钉着（见 `DELETE_FROM resources` 的两处调用点）。
 */
import type { Contributor, ContributorEntityType } from '@mcsr/shared';
import { CONTRIBUTORS_MAX } from '@mcsr/shared';
import { getDb } from './db';

/** 数据库里的一行。`display_name` 来自 JOIN，可能为空（见下面 LEFT JOIN 的理由）。 */
interface ContributorRow {
  user_id: string;
  display_name: string | null;
  added_by: string | null;
  created_at: number;
}

const SELECT_COLUMNS = `
  c.user_id, u.display_name, c.added_by, c.created_at
`;

function toContributor(row: ContributorRow): Contributor {
  return {
    userId: row.user_id,
    // ⚠️ 不写 `?? row.user_id` 之类的兜底：那个判断属于**界面**
    //    （见 shared 里 Contributor.displayName 的注释）。数据层替它决定的话，
    //    "这个人的显示名就叫他的 id"和"这个人没有显示名"就分不开了。
    displayName: row.display_name,
    addedBy: row.added_by,
    createdAt: row.created_at,
  };
}

/**
 * 一条内容当前的贡献者名单。
 *
 * 排序是**稳定**的：`created_at` 升序，同一时刻再加 `user_id` 兜底。
 * ⚠️ 理由与本仓其它列表完全一样（见 listResources 的 `id ASC`）：同一时刻写入的
 *    几行如果顺序不定，同一个人每次刷新看到的名单顺序都不一样 ——
 *    看起来像"名单在变"，而实际上它一个字都没改。
 *    这里特别容易踩到：管理界面的保存是"整份替换"，一次 PUT 加进来的几个人
 *    往往**共用同一个 `now`**（同一个请求里一个时间戳）。
 */
export function listContributors(
  entityType: ContributorEntityType,
  entityId: string,
): Contributor[] {
  const rows = getDb()
    .prepare(
      `SELECT ${SELECT_COLUMNS}
         FROM content_contributors c
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.entity_type = ? AND c.entity_id = ?
        ORDER BY c.created_at ASC, c.user_id ASC`,
    )
    .all(entityType, entityId) as unknown as ContributorRow[];
  return rows.map(toContributor);
}

/*
 * ⚠️ 上面用 **LEFT JOIN** 而不是 JOIN。
 *
 * 外键是 `ON DELETE CASCADE`，所以"贡献者行还在、用户行没了"这件事**理论上**
 * 不会发生 —— 但真发生了（外键被关掉过一次、手工改过库、将来某次迁移重建表），
 * JOIN 会让那些行**从名单上静默消失**：一个人明明被加进去了，管理界面里看不到。
 * 而 LEFT JOIN 的代价只是 `displayName` 可能是 null，shared 的注释里已经写明
 * 调用方要能接受它。**宁可显示一个没有名字的人，也不要凭空少一个人。**
 */

/** 这个人是不是这一条的贡献者。判据全是数据，不看角色（用户要求"不单独作为身份组"）。 */
export function isContributor(
  entityType: ContributorEntityType,
  entityId: string,
  userId: string,
): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM content_contributors
        WHERE entity_type = ? AND entity_id = ? AND user_id = ?`,
    )
    .get(entityType, entityId, userId);
  return row !== undefined;
}

/**
 * 这个人**能直接改哪几条**（某个板块下）。
 *
 * ⚠️ 存在的理由是**批量**：列表页要给每一条算"我能直编吗"。
 *    写成 N 次 `isContributor` 的话，一页 24 条就是 24 次查询 ——
 *    而它本来只需要一次（与 listResources 里"评分/收藏各一次 GROUP BY"同一条理由）。
 * 返回 Set 而不是数组：调用点是 `ids.has(id)`，Set 的语义也更贴切（名单是集合）。
 */
export function contributorEntityIds(
  userId: string,
  entityType: ContributorEntityType,
): Set<string> {
  const rows = getDb()
    .prepare('SELECT entity_id FROM content_contributors WHERE user_id = ? AND entity_type = ?')
    .all(userId, entityType) as unknown as Array<{ entity_id: string }>;
  return new Set(rows.map((r) => r.entity_id));
}

/**
 * 清掉一条内容的全部贡献者行 —— **给硬删除路径用的**。
 *
 * ⚠️ 这是"表里没有外键指向内容"那个代价的落点：不调它**不会报错**，
 *    只会留下孤儿行。所以每一处 `DELETE FROM resources`（或别的板块将来的
 *    等价语句）**旁边**都必须有这一句，而且有测试钉着。
 *
 * ⚠️ 它只删行、不判权限、不看内容在不在 —— 权限判定在路由层，
 *    而"这条还在不在"在删除路径上本来就已经问过了。
 *
 * @returns 实际删掉的行数（给调用方写日志/审计用；0 是完全正常的值 —— 资源可以没有贡献者）。
 */
export function deleteContributors(entityType: ContributorEntityType, entityId: string): number {
  const result = getDb()
    .prepare('DELETE FROM content_contributors WHERE entity_type = ? AND entity_id = ?')
    .run(entityType, entityId);
  return Number(result.changes);
}

/**
 * 改名单的入参。
 *
 * `userIds` 是**替换之后的完整名单**（空数组 = 清空，合法：资源可以没有贡献者）。
 * `exists` 是"被贡献的那一行还在不在"——见文件头那条铁律。
 */
export interface SetContributorsInput {
  entityType: ContributorEntityType;
  entityId: string;
  userIds: readonly string[];
  /** 谁在改。写进 `added_by`；账号注销后那一列会被置空，但行留着。 */
  actorId: string | null;
  now: number;
  /**
   * 被贡献的那一行**现在**还在不在。数据层不知道它住在哪张表，
   * 所以这件事只能由知道的人传进来 —— **必填**，不是可选（见文件头）。
   */
  exists: () => boolean;
}

/**
 * 失败原因。**分三种**，因为它们对应三种不同的 HTTP 响应与三种不同的下一步：
 *
 * | reason | 含义 | 路由给的 HTTP | 为什么不能合并 |
 * |---|---|---|---|
 * | `not_found` | 被贡献的那一行已经不在了 | **404** | 请求本身没问题，是**目标**没了；用户该刷新页面 |
 * | `unknown_user` | 名单里有不存在的 userId | **400** | 请求内容有问题；**改一下重发就能成功**，必须能区分 |
 * | `too_many` | 去重后仍然超过 `CONTRIBUTORS_MAX` | **400**（与 schema 同码） | 同上是入参问题，但**要说清是"人太多"** |
 *
 * ⚠️ 为什么不把 `unknown_user` 静默成"跳过那几个人"：见文件头 ——
 *    那样存下来的是孤儿行，而且**永远匹配不上任何人**（那个 id 根本不存在），
 *    表现是"我明明加了他，他却没有权限"，没有任何报错。
 * ⚠️ 为什么不靠外键的报错兜底：`user_id` 上确实有外键，但撞上它是一个
 *    `SQLITE_CONSTRAINT_FOREIGNKEY` 异常 ⇒ 路由只会回 500 `internal_error`，
 *    调用方看到的是"服务器出错"，而真正的问题是**请求里有一个不存在的 id**。
 */
export type SetContributorsFailure =
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'unknown_user'; userIds: string[] }
  | { ok: false; reason: 'too_many'; max: number };

export type SetContributorsResult =
  | {
      ok: true;
      /** **实际**新增的人（幂等时是空数组）。路由用它算 `added` 的数字、审计用它写"加了谁"。 */
      added: Contributor[];
      /** **实际**移除的人（幂等时是空数组）。 */
      removed: Contributor[];
      /** 替换之后的完整名单（已按稳定顺序排好）。 */
      items: Contributor[];
    }
  | SetContributorsFailure;

/**
 * 整份替换一条内容的贡献者名单。
 *
 * ---------------------------------------------------------------------------
 * 为什么是整份替换，而不是 add/remove 两个接口
 * ---------------------------------------------------------------------------
 * 与 shared 里 `ContributorsInputSchema` 的注释同一条：管理界面本来就是
 * "勾选一组人、点保存"，而增量接口要处理"同时加了又删了""加的人已经在里面"
 * 这些并发情况，每一条都要一个状态码。整份替换是**幂等**的 ——
 * 保存按钮被点两下不会有事，而这正是它最常遇到的失败。
 *
 * ---------------------------------------------------------------------------
 * 实现上的三个决定
 * ---------------------------------------------------------------------------
 * 1. **全部在一个事务里**（先删差集、再插差集，然后回读）。
 *    中途失败就整体回滚 —— 不留"删掉了一半、还没插进去"的半份名单。
 *    ⚠️ 这不是理论问题：名单被清空一次是不可见的，管理界面刷新之后只会
 *       看到"一个人都没有"，而没人会想到刚才那次请求其实失败了。
 *
 * 2. **只动差集，不是 DELETE 全表 + INSERT 全表**。
 *    两者对"最终名单"是等价的（都等于传进来的那一份），但差集保住了
 *    没被改动那几行的 `created_at` 与 `added_by`：
 *      · `created_at` 变了 ⇒ 名单顺序会跳（见 listContributors 的排序说明）；
 *      · `added_by` 变了 ⇒ "谁把他加进去的"变成"最后一个改名单的人"，
 *        而那正是这条信息唯一的用途。
 *
 * 3. **先去掉重复的 id**（同一个 id 传两次）。
 *    主键 `(entity_type, entity_id, user_id)` 会挡住第二次插入，但那是一条
 *    约束错误 ⇒ 500。去重之后，"重复传同一个 id"变成一次正常的幂等调用，
 *    而且"人数上限"判定的是**去重之后**的人数（传 60 个、其中 20 个重复 ⇒ 40 人，合法）。
 */
export function setContributors(input: SetContributorsInput): SetContributorsResult {
  const db = getDb();

  // ⚠️ 事务从这一句之前开始：存在性检查必须与写入**同一个事务**，否则
  //    检查通过了、写的瞬间那条内容已经被删掉 —— 结果正是我们要杜绝的孤儿行。
  db.exec('BEGIN');
  try {
    if (!input.exists()) {
      db.exec('ROLLBACK');
      return { ok: false, reason: 'not_found' };
    }

    // 去重（决定 3）。用 Set 而不是数组 includes：50 个人时两者差不多，
    // 但这里的语义本来就是集合，写成 Set 才读得懂。
    const desired = [...new Set(input.userIds)];

    if (desired.length > CONTRIBUTORS_MAX) {
      db.exec('ROLLBACK');
      return { ok: false, reason: 'too_many', max: CONTRIBUTORS_MAX };
    }

    /*
     * 每一个 userId 都必须真的存在（决定见 SetContributorsFailure 的注释）。
     *
     * ⚠️ **一次查询**查完，不是 N 次：名单上限 50，逐个查就是 50 次往返；
     *    而这条路径（保存名单）本来就是"改一批人"。
     *    占位符个数按名单长度生成 —— 名单是**用户提供的数组**，所以只能这样拼；
     *    但拼进去的只有 `?` 的个数，**没有一个值进入 SQL 文本**。
     */
    const userRows =
      desired.length === 0
        ? []
        : (db
            .prepare(
              `SELECT id, display_name FROM users WHERE id IN (${desired.map(() => '?').join(', ')})`,
            )
            .all(...desired) as unknown as Array<{ id: string; display_name: string | null }>);

    const knownUsers = new Map(userRows.map((r) => [r.id, r.display_name]));
    const unknown = desired.filter((id) => !knownUsers.has(id));
    if (unknown.length > 0) {
      db.exec('ROLLBACK');
      // 排序只是为了让同一份错误在两次调用里长得一样（前端能按它写稳定的文案）
      return { ok: false, reason: 'unknown_user', userIds: [...unknown].sort() };
    }

    // 改之前的名单。`removed` 与审计里的"删了谁"都来自它。
    const before = listContributors(input.entityType, input.entityId);
    const beforeIds = new Set(before.map((c) => c.userId));
    const desiredIds = new Set(desired);

    const toRemove = before.filter((c) => !desiredIds.has(c.userId));
    const toAdd = desired.filter((id) => !beforeIds.has(id));

    const removeStmt = db.prepare(
      'DELETE FROM content_contributors WHERE entity_type = ? AND entity_id = ? AND user_id = ?',
    );
    for (const person of toRemove) {
      removeStmt.run(input.entityType, input.entityId, person.userId);
    }

    const insertStmt = db.prepare(
      `INSERT INTO content_contributors (entity_type, entity_id, user_id, added_by, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const id of toAdd) {
      insertStmt.run(input.entityType, input.entityId, id, input.actorId, input.now);
    }

    // 回读：返回的是**库里现在真正的那一份**，不是"我以为我写进去的那一份"。
    // ⚠️ 两者不等只可能因为并发，而回读是唯一能发现它的方式 ——
    //    这也让调用方（与它背后的界面）看到的东西与下一次刷新完全一致。
    const items = listContributors(input.entityType, input.entityId);

    db.exec('COMMIT');

    /*
     * ⚠️ `createdAt` 用的是**同一个** `input.now`（调用方在请求开始时取的），
     *    而不是每行各取一次 `Date.now()` —— 否则同一次保存进来的几个人会拿到
     *    几个不同的时间戳，名单顺序就取决于那几毫秒的差别（见 listContributors）。
     */
    const added: Contributor[] = toAdd.map((id) => ({
      userId: id,
      displayName: knownUsers.get(id) ?? null,
      addedBy: input.actorId,
      createdAt: input.now,
    }));

    return { ok: true, added, removed: toRemove, items };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
