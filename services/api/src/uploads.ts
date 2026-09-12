/**
 * 本地上传的图片。
 *
 * ---------------------------------------------------------------------------
 * 为什么不直接把文件写进数据库
 * ---------------------------------------------------------------------------
 * SQLite 存 blob 是可行的，但每张图都会进 WAL、进备份、进每一次全表扫描的
 * 页面缓存。图片是**大而只写一次**的东西，它和"行"的访问模式完全不同，
 * 塞在一起只会让数据库变慢、让备份变大。
 *
 * 所以：文件落盘，数据库里只留一行索引（谁传的、什么类型、多大、什么时候）。
 *
 * ---------------------------------------------------------------------------
 * 三条安全约束，每一条都不能省
 * ---------------------------------------------------------------------------
 *   1. **文件名由内容决定**（sha256）。用户提供的文件名一个字节都不参与路径，
 *      所以 `../../etc/passwd` 这种构造在这个形状下不存在。
 *   2. **类型从文件头推**，不信 `Content-Type`、更不信扩展名。
 *      一个叫 `cat.png` 的 HTML 文件，如果被当成 `text/html` 发出去，
 *      就是在我们域名下执行的一段脚本 —— 存储型 XSS。
 *   3. **拒绝 SVG**（不在白名单里）。它是可以内嵌脚本的 XML。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ImageMimeType } from '@mcsr/shared/resources';
import { IMAGE_MAX_BYTES } from '@mcsr/shared/resources';
import { getDb } from './db';

/** 上传目录。默认放在数据库旁边，部署时由 deploy.sh 建好并交给 API 进程的用户。 */
function uploadDir(): string {
  return process.env.UPLOAD_DIR ?? './data/uploads';
}

function subDir(hash: string): string {
  // 两级目录：单目录塞几万个文件之后，有些文件系统会明显变慢
  return join(uploadDir(), hash.slice(0, 2));
}

/**
 * 按**文件头**判断类型。认不出来就返回 null —— 调用方必须把它当作拒绝的理由。
 *
 * 这些魔数都很短，而且位置固定，值得手写：引入一个图片库来读类型，
 * 意味着多一个依赖、多一条供应链；而这里要的信息只有"前几个字节长什么样"。
 */
export function sniffImageMime(bytes: Uint8Array): ImageMimeType | null {
  const b = bytes;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return 'image/jpeg';
  }
  // GIF: "GIF87a" / "GIF89a"
  if (
    b.length >= 6 &&
    b[0] === 0x47 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x38 &&
    (b[4] === 0x37 || b[4] === 0x39) &&
    b[5] === 0x61
  ) {
    return 'image/gif';
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

const EXT_BY_MIME: Record<ImageMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export type SaveResult =
  | { ok: true; url: string; mime: ImageMimeType; size: number; deduped: boolean }
  | { ok: false; reason: 'too_large' | 'not_an_image' | 'empty' };

export interface UploadRow {
  id: string;
  mime: string;
  size: number;
}

/**
 * 存一张图，返回可直接写进 `imageUrl` 的站内路径。
 *
 * 内容寻址的副作用是**天然去重**：同一个文件传两次只占一份空间，
 * 第二次只是命中已有记录。用户重试上传（网络抖动、点快了）很常见，
 * 所以这不是理论上的优化。
 */
export function saveUpload(bytes: Uint8Array, uploaderId: string, now: number): SaveResult {
  if (bytes.length === 0) return { ok: false, reason: 'empty' };
  if (bytes.length > IMAGE_MAX_BYTES) return { ok: false, reason: 'too_large' };

  const mime = sniffImageMime(bytes);
  if (!mime) return { ok: false, reason: 'not_an_image' };

  const hash = createHash('sha256').update(bytes).digest('hex');
  const ext = EXT_BY_MIME[mime];
  const url = `/api/uploads/${hash}.${ext}`;

  const db = getDb();
  const existing = db.prepare('SELECT id FROM uploads WHERE id = ?').get(hash) as
    | { id: string }
    | undefined;
  if (existing) {
    return { ok: true, url, mime, size: bytes.length, deduped: true };
  }

  const dir = subDir(hash);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `${hash}.${ext}`);

  /*
   * ⚠️ 先写数据库还是先写文件？
   *
   * 先写文件：万一数据库写失败，会留下一个没人引用的文件（无害，可清理）。
   * 先写数据库：万一文件写失败，数据库里会有一条指向不存在文件的记录 ——
   * 页面上的图会 404，而且是**永久**的，因为去重逻辑会让重传直接返回这条坏记录。
   *
   * 所以顺序是：先落盘，再登记。
   */
  if (!existsSync(target)) {
    writeFileSync(target, bytes);
  }

  db.prepare(
    'INSERT INTO uploads (id, sha256, mime, ext, size, uploader_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(hash, hash, mime, ext, bytes.length, uploaderId, now);

  return { ok: true, url, mime, size: bytes.length, deduped: false };
}

/** 按 id（= sha256）取登记信息。找不到返回 null。 */
export function getUpload(id: string): UploadRow | null {
  const row = getDb().prepare('SELECT id, mime, size FROM uploads WHERE id = ?').get(id) as
    | UploadRow
    | undefined;
  return row ?? null;
}

/** 文件在磁盘上的位置。**只有内部用** —— 调用方必须先验 id 的格式。 */
export function uploadFilePath(id: string, ext: string): string {
  return join(subDir(id), `${id}.${ext}`);
}

/**
 * 把 `sha256.ext` 拆成 id 和扩展名。
 *
 * ⚠️ 用户可控的字符串进路径之前必须过这一关：只允许十六进制 + 白名单扩展名。
 *    没有这一步的话，`GET /api/uploads/..%2F..%2Fetc%2Fpasswd` 之类的构造
 *    就有了发挥余地 —— 即使前面有 sha256 索引挡着，也不该让这种字符串
 *    走到 `join()` 里去。
 */
export function parseUploadName(name: string): { id: string; ext: string } | null {
  const match = /^([0-9a-f]{64})\.([a-z0-9]{1,5})$/.exec(name);
  if (!match) return null;
  const id = match[1] as string;
  const ext = match[2] as string;
  if (!Object.values(EXT_BY_MIME).includes(ext)) return null;
  return { id, ext };
}
