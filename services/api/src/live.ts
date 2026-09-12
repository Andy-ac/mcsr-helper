/**
 * 直播频道清单的数据层。
 *
 * 表结构和字段语义见 `packages/shared/src/live.ts` 的文件头。
 * 这里只管存取，不管"能不能嵌" —— 那是 `liveEmbedUrl()` 的事，
 * 而且**必须只有一份**（前端也要用它决定渲染什么）。
 */
import type { LiveChannelInput, LivePlatform } from '@mcsr/shared/live';
import { newId } from './auth/tokens';
import { getDb } from './db';

interface LiveRow {
  id: string;
  platform: string;
  handle: string;
  display_name: string;
  note: string | null;
  live_video_id: string | null;
  embed_channel: number;
  sort_order: number;
  status: string;
  created_at: number;
  updated_at: number;
}

/**
 * 行 → 对外形状。
 *
 * ⚠️ 逐字段展开成普通对象字面量，不用 `{ ...row }`：
 *    node:sqlite 的行对象原型不是 `Object.prototype`，而测试里的
 *    `deepStrictEqual` 会比较原型 —— 不展开的话两边打印出来一模一样却判不相等。
 *    （这条坑在本仓踩过不止一次，见 videos.ts / calendar/events.ts 里同样的注释。）
 */
function toChannel(row: LiveRow) {
  return {
    id: row.id,
    platform: row.platform as LivePlatform,
    handle: row.handle,
    displayName: row.display_name,
    note: row.note,
    liveVideoId: row.live_video_id,
    // SQLite 没有 boolean：0/1 → false/true，只在这一处转
    embedChannel: row.embed_channel === 1,
    sortOrder: Number(row.sort_order),
    status: row.status,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

/**
 * 公开列表：只出 visible，按 sortOrder 再按名字。
 *
 * ⚠️ 排序的第二键是 `display_name`，不是 `id`。
 *    只按 sort_order 排的话，同序的两行顺序由 SQLite 自己决定 ——
 *    而它对同一份数据可以给出不同的顺序（尤其是加了索引之后），
 *    表现是"刷新一次，两个主播换了位置"。第二键把顺序钉死。
 */
export function listLiveChannels(includeHidden = false) {
  const sql = includeHidden
    ? 'SELECT * FROM live_channels ORDER BY sort_order ASC, display_name ASC'
    : "SELECT * FROM live_channels WHERE status = 'visible' ORDER BY sort_order ASC, display_name ASC";
  const rows = getDb().prepare(sql).all() as unknown as LiveRow[];
  return rows.map(toChannel);
}

export function getLiveChannel(id: string) {
  const row = getDb().prepare('SELECT * FROM live_channels WHERE id = ?').get(id) as
    | LiveRow
    | undefined;
  return row ? toChannel(row) : null;
}

/** 同平台同频道是否已经有了（`UNIQUE(platform, handle)` 的友好版本）。 */
export function findLiveChannelByHandle(platform: string, handle: string) {
  const row = getDb()
    .prepare('SELECT * FROM live_channels WHERE platform = ? AND handle = ?')
    .get(platform, handle) as LiveRow | undefined;
  return row ? toChannel(row) : null;
}

export function createLiveChannel(
  input: LiveChannelInput,
  now: number,
):
  | { ok: true; channel: ReturnType<typeof toChannel> }
  | { ok: false; existing: ReturnType<typeof toChannel> } {
  /*
   * ⚠️ 先查一次再插入，而不是靠 UNIQUE 异常发现重复：
   *    重复是这份清单最常见的**正常**结果（同一个主播被两个人加），
   *    让它走异常路径就等于让常见情况走异常路径（和资源库 / 视频那边同一个决定）。
   *    catch 仍然保留作竞态兜底。
   */
  const existing = findLiveChannelByHandle(input.platform, input.handle);
  if (existing) return { ok: false, existing };

  const id = newId();
  try {
    getDb()
      .prepare(
        `INSERT INTO live_channels
           (id, platform, handle, display_name, note, live_video_id, embed_channel,
            sort_order, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'visible', ?, ?)`,
      )
      .run(
        id,
        input.platform,
        input.handle,
        input.displayName,
        input.note ?? null,
        input.liveVideoId ?? null,
        input.embedChannel ? 1 : 0,
        input.sortOrder,
        now,
        now,
      );
  } catch (error) {
    // 竞态兜底：只有真的能查到同一个 (platform, handle) 才当成重复
    const race = findLiveChannelByHandle(input.platform, input.handle);
    if (race) return { ok: false, existing: race };
    throw error;
  }

  const created = getLiveChannel(id);
  if (!created) throw new Error(`直播频道 ${id} 插入成功却读不回来`);
  return { ok: true, channel: created };
}

/** 全量更新一行（编辑表单就是"把这一行改成这样"）。 */
export function updateLiveChannel(
  id: string,
  input: LiveChannelInput,
  now: number,
):
  | { ok: true; channel: NonNullable<ReturnType<typeof getLiveChannel>> }
  | { ok: false; reason: 'not_found' | 'taken' } {
  const db = getDb();
  const row = db.prepare('SELECT id FROM live_channels WHERE id = ?').get(id) as
    | { id: string }
    | undefined;
  if (!row) return { ok: false, reason: 'not_found' };

  /*
   * 改 handle 之后可能撞上另一行 —— 先查出来并**指回那一行**，
   * 而不是让 UNIQUE 抛一个用户看不懂的错。
   */
  const clash = findLiveChannelByHandle(input.platform, input.handle);
  if (clash && clash.id !== id) return { ok: false, reason: 'taken' };

  db.prepare(
    `UPDATE live_channels SET
       platform = ?, handle = ?, display_name = ?, note = ?, live_video_id = ?,
       embed_channel = ?, sort_order = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    input.platform,
    input.handle,
    input.displayName,
    input.note ?? null,
    input.liveVideoId ?? null,
    input.embedChannel ? 1 : 0,
    input.sortOrder,
    now,
    id,
  );

  const updated = getLiveChannel(id);
  if (!updated) throw new Error(`直播频道 ${id} 更新之后读不回来`);
  return { ok: true, channel: updated };
}

/**
 * 隐藏 / 显示。
 *
 * ⚠️ 和视频那边一样是**真删之外的第二条路**，而且顺序也一致：
 *    编辑先隐藏（可恢复），确认真不要了再删。
 *    直接删掉会让"手滑"变成一个不可撤销的动作。
 */
export function setLiveChannelStatus(
  id: string,
  status: 'visible' | 'hidden',
  now: number,
): { ok: true; status: string; changed: boolean } | { ok: false; reason: 'not_found' } {
  const db = getDb();
  const row = db.prepare('SELECT status FROM live_channels WHERE id = ?').get(id) as
    | { status: string }
    | undefined;
  if (!row) return { ok: false, reason: 'not_found' };

  const changed = row.status !== status;
  if (changed) {
    db.prepare('UPDATE live_channels SET status = ?, updated_at = ? WHERE id = ?').run(
      status,
      now,
      id,
    );
  }
  return { ok: true, status, changed };
}

export function deleteLiveChannel(id: string): boolean {
  return getDb().prepare('DELETE FROM live_channels WHERE id = ?').run(id).changes > 0;
}
