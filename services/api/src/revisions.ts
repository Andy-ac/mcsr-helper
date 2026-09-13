/**
 * 提交 → 待审 → 发布管线。
 *
 * ---------------------------------------------------------------------------
 * 这个文件要解决的核心问题
 * ---------------------------------------------------------------------------
 * M2 的验收标准有一条特别具体：
 *
 *   「用户改已发布条目 → **自动回 pending** 且**线上仍是旧版**」
 *
 * 这句话里有两个要求，而且它们看起来是矛盾的：条目要"回到待审"，
 * 同时"线上不变"。矛盾只存在于"用一个 status 字段表达一切"的模型里。
 *
 * 本项目的解法（见 005_revisions.ts 的详细说明）：
 *   · `resources` 行上的内容 = **线上版本**。作者提交修改时**根本不碰它**。
 *   · 修改写进 `resource_revisions` 做一条 pending 快照。
 *   · `resources.pending_revision` 指向那条快照，表示"有待审的改动"。
 *   · `resources.status` 保持 `published` —— 因为它描述的确实是线上的状态。
 *
 * 于是"线上仍是旧版"不是靠某段逻辑小心翼翼地保护出来的，
 * 而是**结构上不可能被改坏**：那条 UPDATE 语句压根不存在。
 */
import type { ResourceSubmission } from '@mcsr/shared/resources';
import { deriveSummary, normalizeResourceInput } from '@mcsr/shared/resources';
import { newId } from './auth/tokens';
import { getDb } from './db';

// ---------------------------------------------------------------------------
// 行类型
// ---------------------------------------------------------------------------

export interface RevisionRow {
  id: string;
  resource_id: string;
  revision: number;
  kind: string;
  title: string;
  title_en: string | null;
  url: string;
  image_url: string | null;
  summary: string | null;
  body: string;
  lang: string;
  tags: string;
  status: string;
  editor_id: string | null;
  created_at: number;
  reviewed_by: string | null;
  reviewed_at: number | null;
  review_reason: string | null;
  note_to_reviewer: string | null;
}

const REVISION_COLUMNS = `
  id, resource_id, revision, kind, title, title_en, url, image_url, summary,
  body, lang, tags, status, editor_id, created_at, reviewed_by, reviewed_at, review_reason,
  note_to_reviewer
`;

/** 把提交内容规范成快照字段。和导入走同一套规范化，两边的形态不会漂。 */
function snapshotFields(submission: ResourceSubmission) {
  const normalized = normalizeResourceInput({
    body: submission.body,
    tags: submission.tags,
    titleEn: submission.titleEn ?? null,
    summary: submission.summary ?? null,
    imageUrl: submission.imageUrl ?? null,
  });
  return {
    kind: submission.kind,
    title: submission.title,
    titleEn: normalized.titleEn,
    url: submission.url,
    // ⚠️ 规范化可能把 summary 推导出来，也可能丢弃非法的 imageUrl ——
    //    直接存原始值会让快照和它被批准后写进 resources 的内容不一致。
    imageUrl: normalized.imageUrl,
    summary: normalized.summary ?? deriveSummary(submission.body),
    body: submission.body,
    lang: submission.lang,
    tags: JSON.stringify(normalized.tags),
  };
}

// ---------------------------------------------------------------------------
// 读
// ---------------------------------------------------------------------------

export function getRevision(resourceId: string, revision: number): RevisionRow | null {
  const row = getDb()
    .prepare(
      `SELECT ${REVISION_COLUMNS} FROM resource_revisions WHERE resource_id = ? AND revision = ?`,
    )
    .get(resourceId, revision) as RevisionRow | undefined;
  return row ?? null;
}

export function listRevisions(resourceId: string): RevisionRow[] {
  return getDb()
    .prepare(
      `SELECT ${REVISION_COLUMNS} FROM resource_revisions
       WHERE resource_id = ? ORDER BY revision DESC`,
    )
    .all(resourceId) as unknown as RevisionRow[];
}

export interface QueueRow {
  resource_id: string;
  revision: number;
  title: string;
  kind: string;
  url: string;
  is_edit: number;
  author_name: string | null;
  /** 这一版是谁提交的。审核界面用它判断"是不是你自己提的" */
  editor_id: string | null;
  created_at: number;
}

/**
 * 待审队列，按提交时间从早到晚。
 *
 * `is_edit` 由 `current_revision IS NOT NULL` 推出 —— 即"这个条目已经有线上版本了"。
 * 审核界面必须把这两种情况区分开：修改一个已发布条目和提交一个新条目，
 * 审核员的心理预期完全不同（前者要对照旧版看改了什么）。
 */
export function listReviewQueue(limit = 50, offset = 0): { items: QueueRow[]; total: number } {
  const db = getDb();
  const items = db
    .prepare(
      `SELECT r.id AS resource_id, r.pending_revision AS revision,
              rv.title, rv.kind, rv.url, rv.created_at, rv.editor_id,
              (r.current_revision IS NOT NULL) AS is_edit,
              u.display_name AS author_name
       FROM resources r
       JOIN resource_revisions rv
         ON rv.resource_id = r.id AND rv.revision = r.pending_revision
       LEFT JOIN users u ON u.id = rv.editor_id
       WHERE r.pending_revision IS NOT NULL AND rv.status = 'pending'
       ORDER BY rv.created_at ASC
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as unknown as QueueRow[];

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS n FROM resources r
       JOIN resource_revisions rv
         ON rv.resource_id = r.id AND rv.revision = r.pending_revision
       WHERE r.pending_revision IS NOT NULL AND rv.status = 'pending'`,
    )
    .get() as { n: number };

  return { items, total: Number(totalRow.n) };
}

/**
 * 某个作者提交过的条目（含状态），「我的提交」列表用。
 *
 * ⚠️ 这里**必须**带上最近一次被驳回的理由。
 *
 *    没有它的话，整套驳回机制就是空转的：审核员被强制写下的那句"需要改什么"
 *    只会躺在数据库和审计日志里，而唯一需要读它的人（作者）根本看不到。
 *    他看到的只有"已驳回"三个字，于是原样再提交一次 —— 然后被同一个人
 *    用同一个理由再驳回一次。审核员写理由的成本全白费了。
 *
 * 取"最近一次"而不是"当前的"：条目可能被驳回 → 改 → 又通过，
 * 那时旧理由不该继续显示成待处理的问题。用 created_at 倒序取第一条。
 */
export function listByAuthor(authorId: string): Array<{
  id: string;
  title: string;
  status: string;
  pending_revision: number | null;
  current_revision: number | null;
  updated_at: number;
  last_reject_reason: string | null;
  reviewed_at: number | null;
}> {
  return getDb()
    .prepare(
      `SELECT r.id, r.title, r.status, r.pending_revision, r.current_revision, r.updated_at,
              (SELECT rv.review_reason FROM resource_revisions rv
                WHERE rv.resource_id = r.id AND rv.status = 'rejected'
                ORDER BY rv.created_at DESC LIMIT 1) AS last_reject_reason,
              (SELECT MAX(rv2.reviewed_at) FROM resource_revisions rv2
                WHERE rv2.resource_id = r.id) AS reviewed_at
       FROM resources r WHERE r.author_id = ? ORDER BY r.updated_at DESC`,
    )
    .all(authorId) as Array<{
    id: string;
    title: string;
    status: string;
    pending_revision: number | null;
    current_revision: number | null;
    updated_at: number;
    last_reject_reason: string | null;
    reviewed_at: number | null;
  }>;
}

// ---------------------------------------------------------------------------
// 写：提交与修改
// ---------------------------------------------------------------------------

export interface SubmitResult {
  resourceId: string;
  revision: number;
}

/**
 * 新条目提交。建 resource 行 + 第 1 版快照。
 *
 * 条目的 status 一开始是 `pending`，而不是 `draft`：
 * `draft` 的语义是"作者还没提交完"，而此刻作者已经按下了提交按钮。
 * 这个区别在审核队列里是有意义的 —— `pending` 的东西审核员才该看。
 */
export function submitNewResource(input: {
  id: string;
  submission: ResourceSubmission;
  authorId: string;
  now: number;
}): SubmitResult {
  const db = getDb();
  const fields = snapshotFields(input.submission);

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO resources
         (id, kind, title, title_en, url, image_url, summary, body, lang, tags,
          featured, official, status, source, author_id, pending_revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'pending', 'user', ?, 1, ?, ?)`,
    ).run(
      input.id,
      fields.kind,
      fields.title,
      fields.titleEn,
      fields.url,
      fields.imageUrl,
      fields.summary,
      fields.body,
      fields.lang,
      fields.tags,
      input.authorId,
      input.now,
      input.now,
    );

    db.prepare(
      `INSERT INTO resource_revisions
         (id, resource_id, revision, kind, title, title_en, url, image_url, summary,
          body, lang, tags, status, editor_id, created_at, note_to_reviewer)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    ).run(
      newId(),
      input.id,
      fields.kind,
      fields.title,
      fields.titleEn,
      fields.url,
      fields.imageUrl,
      fields.summary,
      fields.body,
      fields.lang,
      fields.tags,
      input.authorId,
      input.now,
      input.submission.note ?? null,
    );

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { resourceId: input.id, revision: 1 };
}

/**
 * 作者修改自己的条目 —— **整套设计的关键就是这个函数**。
 *
 * 注意它只做三件事，而且一件都不涉及 resources 行的内容字段：
 *   1. 拍一张新的版本快照（pending）
 *   2. 把 resources.pending_revision 指过去
 *   3. 更新 updated_at
 *
 * 线上内容因此**完全没有被触碰**。这就是验收标准里"线上仍是旧版"的实现方式 ——
 * 不是靠判断"如果已发布则跳过更新"这种容易被后人改坏的逻辑，
 * 而是因为**修改线上内容的语句根本不在这里**。
 */
export function reviseResource(input: {
  resourceId: string;
  submission: ResourceSubmission;
  editorId: string;
  now: number;
}): SubmitResult | null {
  const db = getDb();

  const resource = db
    .prepare('SELECT id, pending_revision FROM resources WHERE id = ?')
    .get(input.resourceId) as { id: string; pending_revision: number | null } | undefined;
  if (!resource) return null;

  // 已经有待审的修改时，不能再叠一条 —— 否则审核队列里会出现同一个条目的
  // 多条待审快照，审核员批准其中一条之后，另一条会变成谁的说不清。
  // 作者想继续改，应该先撤回或者等审核结果（M2 不做撤回，见 §8）。
  if (resource.pending_revision !== null) return null;

  const nextRow = db
    .prepare('SELECT COALESCE(MAX(revision), 0) AS n FROM resource_revisions WHERE resource_id = ?')
    .get(input.resourceId) as { n: number };
  const revision = Number(nextRow.n) + 1;
  const fields = snapshotFields(input.submission);

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO resource_revisions
         (id, resource_id, revision, kind, title, title_en, url, image_url, summary,
          body, lang, tags, status, editor_id, created_at, note_to_reviewer)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    ).run(
      newId(),
      input.resourceId,
      revision,
      fields.kind,
      fields.title,
      fields.titleEn,
      fields.url,
      fields.imageUrl,
      fields.summary,
      fields.body,
      fields.lang,
      fields.tags,
      input.editorId,
      input.now,
      input.submission.note ?? null,
    );

    /*
     * ⚠️⚠️ 状态只能用 CASE 有条件地改，**绝不能无条件写成 'pending'**。
     *
     * 这里踩过一次，而且踩的正是验收标准要防的那个方向：
     * 无条件 `status = 'pending'` 会让一个**已经发布**的条目从公开列表里消失 ——
     * 列表查的是 `status = 'published'`。于是"用户改了一下自己的条目"
     * 这个动作直接把那条内容从站上下线了，而它本该继续展示旧版。
     * （那个 bug 被测试里"两个方向都要断言"的写法逮到 —— 只验证"回到 pending"
     *   的测试会让它溜过去，因为状态确实变成了 pending，测试反而会通过。）
     *
     * ---------------------------------------------------------------------
     * 判据是 **status 本身**，不是 current_revision（2026-09-12 修正）
     * ---------------------------------------------------------------------
     * 原来写的是 `WHEN current_revision IS NULL THEN 'pending'`，它隐含一个假设：
     * "没有 current_revision ⟹ 从未上架过"。这个假设对用户提交的条目成立，
     * 但**对导入的条目不成立** —— 它们是从 JSON 导进来的，
     * status 直接就是 'published'，而根本没有版本号。
     *
     * 在只允许作者编辑的年代，这段代码碰不到导入的条目（author_id 是 NULL，
     * 谁都不是作者），所以那个假设一直没被挑战。wiki 式编辑一上线，
     * 第一个路人改了一条导入条目，它就会**当场从资源库里消失** ——
     * 直到审核通过才回来。这正是上面那段注释警告过的同一个 bug，
     * 只是换了一个入口。
     *
     * 所以判据改成直接看 status：
     *   · status = 'published'  → 线上有内容在展示，改一次不该让它消失
     *   · status = 'hidden'     → 被编辑者下架了，改一次也不该改变这个决定
     *   · 其它（pending/rejected/draft）→ 回到 pending，表示又有一版在等审核
     * 这既更简单（不依赖"版本号存在与否"这种间接推断），也更贴近那句话本身：
     * **status 描述的是线上内容的状态。**
     *
     * ⚠️ 'hidden' 是后来补上的：第一版只写了 published，于是"一条被下架的条目
     *    被人改了一下"会把它踢回 pending —— 而下架是一个明确的编辑决定，
     *    不该被一次内容修改（甚至只是别人路过提了个改动）顺手撤销。
     */
    db.prepare(
      `UPDATE resources
         SET pending_revision = ?,
             status = CASE WHEN status IN ('published', 'hidden') THEN status ELSE 'pending' END,
             updated_at = ?
       WHERE id = ?`,
    ).run(revision, input.now, input.resourceId);

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { resourceId: input.resourceId, revision };
}

// ---------------------------------------------------------------------------
// 写：审核
// ---------------------------------------------------------------------------

/**
 * 批准待审版本：把它**复制进** resources 行，并推进指针。
 *
 * 必须是事务：复制内容、推进 current_revision、清掉 pending_revision、
 * 标记版本为 approved —— 四件事要么全成要么全不成。
 * 中间失败会留下"内容换了但版本号没变"这种查起来极其痛苦的状态。
 */
export function approveRevision(input: {
  resourceId: string;
  reviewerId: string;
  now: number;
}): { revision: number } | null {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');

  try {
    const resource = db
      .prepare('SELECT pending_revision FROM resources WHERE id = ?')
      .get(input.resourceId) as { pending_revision: number | null } | undefined;
    if (!resource?.pending_revision) {
      db.exec('ROLLBACK');
      return null;
    }

    const rev = db
      .prepare(
        `SELECT ${REVISION_COLUMNS} FROM resource_revisions WHERE resource_id = ? AND revision = ?`,
      )
      .get(input.resourceId, resource.pending_revision) as RevisionRow | undefined;

    // 版本可能已经被另一次审核处理掉了（两个人同时点批准）。
    // 检查 status 是必须的 —— 少了它，重复批准会成功两次。
    if (rev?.status !== 'pending') {
      db.exec('ROLLBACK');
      return null;
    }

    db.prepare(
      `UPDATE resources
         SET kind = ?, title = ?, title_en = ?, url = ?, image_url = ?, summary = ?,
             body = ?, lang = ?, tags = ?,
             /*
              * ⚠️ 保留 'hidden'：内容被编辑者主动下架之后，
              *    一次修改通过审核**不该**把它悄悄恢复上架。
              *    下架是一个明确的编辑决定，只应该由人显式地撤销
              *    （见 setResourceVisibility）。写成无条件 'published' 的话，
              *    作者改个错别字就能把一条被下架的内容重新推回站上。
              */
             status = CASE WHEN status = 'hidden' THEN 'hidden' ELSE 'published' END,
             current_revision = ?, pending_revision = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(
      rev.kind,
      rev.title,
      rev.title_en,
      rev.url,
      rev.image_url,
      rev.summary,
      rev.body,
      rev.lang,
      rev.tags,
      rev.revision,
      input.now,
      input.resourceId,
    );

    db.prepare(
      `UPDATE resource_revisions
         SET status = 'approved', reviewed_by = ?, reviewed_at = ?
       WHERE id = ?`,
    ).run(input.reviewerId, input.now, rev.id);

    db.exec('COMMIT');
    return { revision: rev.revision };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * 驳回待审版本。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 驳回改的是**待审版本**，不该动"线上这一条还在不在"
 * ---------------------------------------------------------------------------
 * 所以状态规则直接看**当前状态**，不是看有没有版本号：
 *
 *   · 线上正展示着（published / hidden）→ **保持原状**。
 *     一次修改被驳回，和"这个条目该不该在站上"是两件事。
 *   · 从没上架过（pending / rejected / draft）→ 标成 'rejected'，
 *     作者在「我的提交」里看到"被驳回了"。
 *
 * ---------------------------------------------------------------------------
 * ⚠️⚠️ 这里踩过**两次**同一个坑，都是"用 current_revision 判断有没有上架过"
 * ---------------------------------------------------------------------------
 * 导入的条目（从 content/resources.json 进来的那 9 条）status 就是
 * 'published'，但 **current_revision 是 NULL** —— 它们不是走审核流程进来的，
 * 没有版本号。于是 `current_revision === null` 这个判断会把它们当成
 * "从没上架过"。
 *
 * 第一次是 reviseResource（改一条导入条目 → 状态被改成 pending → 条目消失）；
 * 第二次就是这里（**改一条导入条目被驳回 → 状态被改成 rejected → 条目消失**）。
 * 现象一样："我只改了一下，那条内容就没了。"
 *
 * 教训写在这里，因为它是这个数据模型里最容易再犯的地方：
 * **判断"线上有没有内容"要看 status，不要看 current_revision。**
 * 后者的存在只是"这一版是审核通过的"，而不是"线上有东西"。
 *
 * ⚠️ 保留 'hidden' 也是刻意的：内容被编辑者主动下架之后，
 *    一次修改被驳回不该把它悄悄恢复上架 —— 下架是一个明确的编辑决定。
 */
export function rejectRevision(input: {
  resourceId: string;
  reviewerId: string;
  reason: string;
  now: number;
}): { revision: number; resourceRejected: boolean; status: string } | null {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');

  try {
    const resource = db
      .prepare('SELECT pending_revision, current_revision, status FROM resources WHERE id = ?')
      .get(input.resourceId) as
      | { pending_revision: number | null; current_revision: number | null; status: string }
      | undefined;
    if (!resource?.pending_revision) {
      db.exec('ROLLBACK');
      return null;
    }

    const rev = db
      .prepare(
        `SELECT ${REVISION_COLUMNS} FROM resource_revisions WHERE resource_id = ? AND revision = ?`,
      )
      .get(input.resourceId, resource.pending_revision) as RevisionRow | undefined;
    if (rev?.status !== 'pending') {
      db.exec('ROLLBACK');
      return null;
    }

    db.prepare(
      `UPDATE resource_revisions
         SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, review_reason = ?
       WHERE id = ?`,
    ).run(input.reviewerId, input.now, input.reason, rev.id);

    // 线上正展示着的（published / hidden）保持原状；从没上架过的标成 rejected
    const wasLive = resource.status === 'published' || resource.status === 'hidden';
    const nextStatus = wasLive ? resource.status : 'rejected';

    db.prepare(
      `UPDATE resources SET status = ?, pending_revision = NULL, updated_at = ? WHERE id = ?`,
    ).run(nextStatus, input.now, input.resourceId);

    db.exec('COMMIT');
    return { revision: rev.revision, resourceRejected: !wasLive, status: nextStatus };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** 供测试与排查用：把某个条目的版本历史打成一行摘要。 */
export function revisionSummary(resourceId: string): string[] {
  return listRevisions(resourceId).map(
    (r) => `r${r.revision} ${r.status}${r.review_reason ? ` (${r.review_reason})` : ''}`,
  );
}

// ---------------------------------------------------------------------------
// ② 直编：不经审核，**直接写"线上那一行"**
//
// ⚠️ 这两条是 `resources` 内容字段的**第二个**（也是唯一一个额外的）写入点。
//    在此之前只有 `approveRevision` 会写它们 —— 加它们不是因为审核那条规则放松了，
//    而是因为②有了一个明确的新动作：**content.author**（editor 及以上）。
//    ⚠️ `reviewer` 拿不到那个能力，因为一旦他能直编，"审核员不能批准自己提交的东西"
//      就被掏空了（自己改、自己生效，审计里只是两条互不相干的记录）。
// ---------------------------------------------------------------------------

/**
 * 直编新建：**建出来就已经上架**（一条 `approved` 快照 + `current_revision = 1`）。
 *
 * ⚠️⚠️ `source` 必须是 `'user'`，**绝不能是 `'import'`**。
 *    导入脚本（`import.ts`）每次部署都会跑一遍"删掉库里 source='import'
 *    但不在 content/resources.json 里的条目"（`deleteImportedNotIn`）——
 *    直编建出来的条目如果被标成 import，**下一次部署就会静默消失**，
 *    而删除那一刻没有任何报错，人只会看到"我加的那条不见了"。
 *
 * ⚠️ 第 1 版快照必须**同时**写：`current_revision = 1` 而没有对应快照的话，
 *    审核详情页的"线上版本"对照会指向一条不存在的记录；
 *    而且日历那边有一个用版本号判断"有没有上架过"的历史坑（见 rejectRevision 的注释），
 *    系列/事件也会因为同一形状的判据出错。
 */
export function createResourceDirect(input: {
  id: string;
  submission: ResourceSubmission;
  actorId: string;
  now: number;
}): { revision: number } {
  const db = getDb();
  const fields = snapshotFields(input.submission);

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO resources
         (id, kind, title, title_en, url, image_url, summary, body, lang, tags,
          featured, official, status, source, author_id, current_revision, pending_revision,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'published', 'user', ?, 1, NULL, ?, ?)`,
    ).run(
      input.id,
      fields.kind,
      fields.title,
      fields.titleEn,
      fields.url,
      fields.imageUrl,
      fields.summary,
      fields.body,
      fields.lang,
      fields.tags,
      input.actorId,
      input.now,
      input.now,
    );

    db.prepare(
      `INSERT INTO resource_revisions
         (id, resource_id, revision, kind, title, title_en, url, image_url, summary,
          body, lang, tags, status, editor_id, created_at, reviewed_by, reviewed_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?)`,
    ).run(
      newId(),
      input.id,
      fields.kind,
      fields.title,
      fields.titleEn,
      fields.url,
      fields.imageUrl,
      fields.summary,
      fields.body,
      fields.lang,
      fields.tags,
      input.actorId,
      input.now,
      input.actorId,
      input.now,
    );

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { revision: 1 };
}

/**
 * 直编一条**已存在**的条目：写线上那一行 + 拍一条 `approved` 快照（同一个事务）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 与 `approveRevision` 的两个差别，都是刻意的
 * ---------------------------------------------------------------------------
 * 1. 内容**不来自待审快照**，而是来自这次请求本身 —— 直编根本没有待审版本。
 * 2. 它**不接受**"正在有待审改动"的条目（D2.6，返回 `already_pending`）。
 *    理由是一条会静默丢数据的时序：那条待审快照是基于**更早的线上版本**拍的，
 *    一旦它稍后被批准，就会把这次直编的内容**原样覆盖回去** ——
 *    没有任何报错，作者只会看到"我改的东西自己变回去了"。
 *    所以这里宁可拒绝，并让调用方先把那份待审改动处理掉（批准或驳回）。
 *
 * ⚠️ `status` 规则与 `approveRevision` **逐字一致**：下架过（`hidden`）的条目
 *    改内容之后**仍然保持下架**。下架是一个明确的编辑决定，
 *    不该被一次内容修改顺手撤销 —— 否则"下架"就变成了一个改一个错别字就能恢复的状态。
 *
 * ⚠️ 它**不动** `featured` / `official`：那两个是 `resource.feature` 的事
 *    （`ResourceSubmissionSchema` 里本来就没有它们，保持同一个立场）。
 */
export function applyDirectRevision(input: {
  resourceId: string;
  submission: ResourceSubmission;
  actorId: string;
  now: number;
}): { revision: number; status: string } | { error: 'not_found' | 'already_pending' } {
  const db = getDb();
  const fields = snapshotFields(input.submission);

  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db
      .prepare('SELECT current_revision, pending_revision FROM resources WHERE id = ?')
      .get(input.resourceId) as
      | { current_revision: number | null; pending_revision: number | null }
      | undefined;
    if (!row) {
      db.exec('ROLLBACK');
      return { error: 'not_found' };
    }
    if (row.pending_revision !== null) {
      db.exec('ROLLBACK');
      return { error: 'already_pending' };
    }

    /*
     * ⚠️⚠️ 版本号必须从 **`MAX(revision) + 1`** 推，**不能**从 `current_revision + 1` 推。
     *
     *    这是被测试抓到的一个真 bug：一条条目可能是
     *      r1（审核通过，current_revision = 1）→ r2（用户提的修改，**被驳回**）
     *    这时 `current_revision` 仍然是 1，于是 `+1` 又算出 r2 —— 撞上
     *    `resource_revisions` 的 `(resource_id, revision)` UNIQUE，
     *    直编整个 500，而错误信息是 `UNIQUE constraint failed`，
     *    和真正的原因（"驳回过的版本仍然占着号"）毫无关系。
     *
     *    用 `MAX(revision)` 就同时覆盖了两种情况：导入的条目没有任何快照 → 从 r1 开始；
     *    有历史快照的 → 接着最大的那个往下排（与 `reviseResource` 的口径**逐字一致**）。
     */
    const maxRow = db
      .prepare(
        'SELECT COALESCE(MAX(revision), 0) AS n FROM resource_revisions WHERE resource_id = ?',
      )
      .get(input.resourceId) as { n: number };
    const revision = Number(maxRow.n) + 1;

    db.prepare(
      `INSERT INTO resource_revisions
         (id, resource_id, revision, kind, title, title_en, url, image_url, summary,
          body, lang, tags, status, editor_id, created_at, reviewed_by, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?)`,
    ).run(
      newId(),
      input.resourceId,
      revision,
      fields.kind,
      fields.title,
      fields.titleEn,
      fields.url,
      fields.imageUrl,
      fields.summary,
      fields.body,
      fields.lang,
      fields.tags,
      input.actorId,
      input.now,
      input.actorId,
      input.now,
    );

    db.prepare(
      `UPDATE resources
         SET kind = ?, title = ?, title_en = ?, url = ?, image_url = ?, summary = ?,
             body = ?, lang = ?, tags = ?,
             -- ⚠️ 保留 'hidden'：理由见上面的注释与 approveRevision 里同一处
             status = CASE WHEN status = 'hidden' THEN 'hidden' ELSE 'published' END,
             current_revision = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      fields.kind,
      fields.title,
      fields.titleEn,
      fields.url,
      fields.imageUrl,
      fields.summary,
      fields.body,
      fields.lang,
      fields.tags,
      revision,
      input.now,
      input.resourceId,
    );

    db.exec('COMMIT');

    /*
     * ⚠️ 回读 status 而不是让调用方猜：下架过的条目直编之后**仍然是 hidden**
     *    （见上面 UPDATE 里的 CASE）。把它写死在路由里会让界面说"线上已可见"，
     *    而它其实还在下架状态 —— 那是对用户撒谎。
     */
    const after = db.prepare('SELECT status FROM resources WHERE id = ?').get(input.resourceId) as
      | { status: string }
      | undefined;
    return { revision, status: after?.status ?? 'published' };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
