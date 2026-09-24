/**
 * 可追踪文件目录（配置即代码）。
 *
 * ⚠️ 为什么不建表：它是**配置**不是用户数据 —— 与 `content/resources.json` 走同一条路
 *    （仓库里的文件、部署时同步），但**不需要 import**（没有查询/编辑需求）。
 *    建表要多一次迁移、多一层"库里的和仓库里的哪份是真的"的歧义，换不到任何东西。
 * ⚠️ 为什么不缓存成内存里的常量：这个文件**每次部署都会被覆盖**，而 API 进程只在部署时重启 ——
 *    缓存反而"更安全"是错觉；这里每次现读（文件几 KB），用 ETag 让客户端拿 304。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFileCatalog } from '@mcsr/shared/fileUpdates';
import { Hono } from 'hono';

export const fileCatalogRoute = new Hono();

/**
 * 内容目录。
 *
 * 与 `routes/desktop.ts` 的 `releasesDir()` **同一个形状**：只读，所以与 systemd 单元里的
 * `ReadWritePaths` 无关（那是写权限；`ProtectSystem=strict` 不影响读）。
 * 默认值是服务器上的真实路径，测试与本地开发用 `MCSR_CONTENT_DIR` 指到别处。
 */
function contentDir(): string {
  return process.env.MCSR_CONTENT_DIR ?? '/srv/mcsr-helper/content';
}

fileCatalogRoute.get('/', (c) => {
  const file = join(contentDir(), 'file-catalog.json');
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    // ⚠️ 500 而不是空目录：空目录的表现是"界面上什么都没有"，没有任何人会去查原因。
    // ⚠️ 这一支与下面 JSON 坏掉那一支**故意用两个 error 名**：一个是"部署没把这个文件送到"
    //    （查 deploy.sh 的清单），另一个是"文件内容坏了"（查文件本身）。合成一个的话，
    //    值班的人只能靠看 detail 猜，而 detail 是 Node 的报错原文。
    return c.json({ error: 'catalog_unavailable', path: file, detail: String(error) }, 500);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    return c.json({ error: 'catalog_invalid_json', detail: String(error) }, 500);
  }
  const result = parseFileCatalog(parsed);
  // ⚠️ 校验失败**必须 500 并且把 problems 原样带出去**，不能"跳过坏的那一条"：
  //    目录是配置，坏一条就意味着**没有**可信的期望版本，而跳过它的表现是
  //    "界面上少一条"或者"这一条永远显示最新"—— 两种都没有人会去查原因。
  if (!result.ok) return c.json({ error: 'catalog_invalid', problems: result.problems }, 500);

  const body = JSON.stringify(result.catalog);
  const etag = `"${createHash('sha256').update(body).digest('hex').slice(0, 16)}"`;
  if (c.req.header('if-none-match') === etag) return c.body(null, 304);
  return c.body(body, 200, {
    'content-type': 'application/json; charset=utf-8',
    etag,
    // no-cache = "可以存，但每次都要问一句"：这正是我们要的（部署换文件后立刻生效）。
    'cache-control': 'no-cache',
  });
});
