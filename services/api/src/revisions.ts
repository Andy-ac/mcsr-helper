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
}

const REVISION_COLUMNS = `
  id, resource_id, revision, kind, title, title_en, url, image_url, summary,
  body, lang, tags, status, editor_id, created_at, reviewed_by, reviewed_at, review_reason
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
              rv.title, rv.kind, rv.url, rv.created_at,
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

/** 某个作者提交过的条目（含状态），"我的提交"列表用。 */
export function listByAuthor(authorId: string): Array<{
  id: string;
  title: string;
  status: string;
  pending_revision: number | null;
  current_revision: number | null;
  updated_at: number;
}> {
  return getDb()
    .prepare(
      `SELECT id, title, status, pending_revision, current_revision, updated_at
       FROM resources WHERE author_id = ? ORDER BY updated_at DESC`,
    )
    .all(authorId) as Array<{
    id: string;
    title: string;
    status: string;
    pending_revision: number | null;
    current_revision: number | null;
    updated_at: number;
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
          body, lang, tags, status, editor_id, created_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
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
          body, lang, tags, status, editor_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
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
     * 正确的规则：**status 描述的是线上内容的状态。**
     *   · 有线上版本（current_revision 不为空）→ 线上没变，状态就不该变
     *   · 没有线上版本（从未通过审核）→ 回到 pending，表示又有一版在等审核
     */
    db.prepare(
      `UPDATE resources
         SET pending_revision = ?,
             status = CASE WHEN current_revision IS NULL THEN 'pending' ELSE status END,
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
             status = 'published', current_revision = ?, pending_revision = NULL, updated_at = ?
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
 * ⚠️ 驳回之后条目应该变成什么状态，**取决于它有没有线上版本**：
 *
 *   · 从来没有发布过（current_revision IS NULL）→ status = 'rejected'，
 *     它从列表里消失，作者能看到"被驳回了"。
 *   · 已经发布过（改的是老条目）→ status 保持 'published'。
 *     ⚠️ 如果这里也写成 'rejected'，那个条目的**线上版本会跟着消失** ——
 *     一个老条目只因为有人改了它一次没通过审核，就从站上没了。
 *     这正是"提交修改"和"提交新条目"必须区分对待的地方。
 */
export function rejectRevision(input: {
  resourceId: string;
  reviewerId: string;
  reason: string;
  now: number;
}): { revision: number; resourceRejected: boolean } | null {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');

  try {
    const resource = db
      .prepare('SELECT pending_revision, current_revision FROM resources WHERE id = ?')
      .get(input.resourceId) as
      | { pending_revision: number | null; current_revision: number | null }
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

    const resourceRejected = resource.current_revision === null;
    db.prepare(
      `UPDATE resources SET status = ?, pending_revision = NULL, updated_at = ? WHERE id = ?`,
    ).run(resourceRejected ? 'rejected' : 'published', input.now, input.resourceId);

    db.exec('COMMIT');
    return { revision: rev.revision, resourceRejected };
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
