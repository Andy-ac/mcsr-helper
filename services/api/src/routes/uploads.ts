/**
 * 图片上传与读取。
 *
 * ---------------------------------------------------------------------------
 * 为什么读接口也在 /api/ 下面
 * ---------------------------------------------------------------------------
 * 部署时只有 `/api/*` 被 Caddy 反代到 API 进程，其余路径是前端静态文件。
 * 把图片放到 `/uploads/*` 就意味着要再改一次 Caddyfile ——
 * 而那个文件已经是"每次加东西都要同步的清单"里最容易漏的一项
 * （见 docs/pending.md 5.6）。放进 /api/ 下面，部署完全不用动。
 *
 * 走 API 也带来一个实际好处：**响应头由我们自己控制**。
 * 如果把用户上传的目录直接交给 Caddy 当静态目录，那些文件会带着
 * Caddy 猜出来的 Content-Type 发出去 —— 一个伪装成图片的 HTML
 * 就能在我们域名下执行脚本。这里强制 nosniff + sandbox，从根上封掉。
 */
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';

import { type AuthVariables, requireAuth, requireVerified } from '../auth/middleware';
import { getUpload, parseUploadName, saveUpload, uploadFilePath } from '../uploads';

export const uploadsRoute = new Hono<{ Variables: AuthVariables }>();

/** 单张图片上限（和 shared 里的一致，界面用它做前置校验）。 */
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * 上传一张图。
 *
 * 权限：登录 + **邮箱已验证**。
 * 用 requireVerified 而不是 requireCapability('resource.submit')：
 * 能编辑内容的人就会需要传图（wiki 式编辑也一样），
 * 而"能不能编辑"是路由级判断（要看具体条目归谁），拿不到这里来用。
 * 邮箱验证是这套系统里"这个人是真的"的通用门槛，放这里正好。
 */
uploadsRoute.post('/', requireAuth, requireVerified, async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  /*
   * 先看 Content-Length 再读 body。
   *
   * 不是为了省事，是为了**不把 10 MB 读进内存再拒绝** ——
   * 一个不设防的上传接口，被人连续发几十兆的 body，
   * 就能把一台 1 核 1.9G 的机器打满。
   */
  const declared = Number(c.req.header('content-length') ?? '0');
  if (declared > MAX_BYTES + 4096) {
    return c.json({ error: 'too_large', maxBytes: MAX_BYTES }, 413);
  }

  const form = await c.req.parseBody({ all: false }).catch(() => null);
  if (!form) return c.json({ error: 'invalid_input' }, 400);

  const file = form.file;
  if (!(file instanceof File)) {
    return c.json({ error: 'no_file' }, 400);
  }

  // 读进来之后再量一次：Content-Length 可以是假的，甚至可以不发
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = saveUpload(bytes, user.id, Date.now());

  if (!result.ok) {
    const status = result.reason === 'too_large' ? 413 : 400;
    return c.json({ error: result.reason, maxBytes: MAX_BYTES }, status);
  }

  return c.json(
    { url: result.url, mime: result.mime, size: result.size, deduped: result.deduped },
    201,
  );
});

/**
 * 读图。**公开**（不需要登录）—— 它们要显示在所有人都能看的页面上。
 *
 * ⚠️ 响应头是这里最重要的部分：
 *   · `Content-Type` 取自**数据库里存的、由文件头推出来的**类型，
 *     绝不用扩展名猜、也绝不用请求头里的说法；
 *   · `X-Content-Type-Options: nosniff` —— 浏览器不许自作聪明改判类型；
 *   · `Content-Security-Policy: sandbox` —— 万一将来某个类型漏了，
 *     这一条也能让它在沙箱里跑不了脚本；
 *   · `immutable` 的永久缓存 —— 内容是哈希寻址的，同一个 URL 的内容
 *     永远不会变，缓存多久都是安全的。
 */
uploadsRoute.get('/:name', (c) => {
  const parsed = parseUploadName(c.req.param('name'));
  if (!parsed) return c.json({ error: 'not_found' }, 404);

  const row = getUpload(parsed.id);
  if (!row) return c.json({ error: 'not_found' }, 404);

  let bytes: Buffer;
  try {
    bytes = readFileSync(uploadFilePath(parsed.id, parsed.ext));
  } catch {
    // 数据库里有记录但文件不在 —— 只可能是人为清理或磁盘故障。
    // 返回 404 而不是 500：对浏览器来说"这张图没有"就够了。
    return c.json({ error: 'not_found' }, 404);
  }

  c.header('Content-Type', row.mime);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Content-Security-Policy', "sandbox; default-src 'none'");
  c.header('Cache-Control', 'public, max-age=31536000, immutable');
  return c.body(new Uint8Array(bytes));
});
