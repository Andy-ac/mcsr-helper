/**
 * `GET /api/mod-catalog` —— mc.sr 那套 mod 目录（schema 2）。
 *
 * ===========================================================================
 * 为什么是一条**新**端点，而不是把 v1 那条改宽
 * ===========================================================================
 * v1 的 `packages/shared/src/fileUpdates.ts` 三处 schema 全是 `.strict()` ⇒
 * 往目录里加字段（或加一个新的 `provider`）会让**已经装在用户机器上的 0.0.4**
 * `safeParse` 失败、整块显示"目录不合法"。而桌面版加载的是远端页面，
 * 所以"发一份新目录"与"所有人都得先升级桌面版"被绑死了。
 * ⇒ 新形状走新路径，v1 那条**一个字节都不动**。
 *
 * ===========================================================================
 * 错误码为什么复用 v1 那三个
 * ===========================================================================
 * 仓库里有一条断言在扫"服务端返回的每个 error 码都在显式清单里"
 * （`error-codes.test.ts` 的 `KNOWN_CODES` 与 `serverCodesFromSource` 那个扫描器）。
 * 复用 `catalog_unavailable` /
 * `catalog_invalid_json` / `catalog_invalid` 就不必去动那份契约；
 * 两个端点的响应体各自独立，不存在命名空间冲突。
 *
 * 诊断信息（路径、解析器原文）**只进日志**：这是一条匿名可访问的端点。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseModCatalog } from '@mcsr/shared/modCatalog';
import { Hono } from 'hono';

export const modCatalogRoute = new Hono();

function contentDir(): string {
  return process.env.MCSR_CONTENT_DIR ?? '/srv/mcsr-helper/content';
}

modCatalogRoute.get('/', (c) => {
  const file = join(contentDir(), 'mod-catalog.json');
  // ⚠️ 变量名与 `routes/fileCatalog.ts` 那两处**反过来一一对应**（raw = 文件内容、
  //    parsed = 解析结果）—— 这个文件的价值就是"与 v1 逐行对应"，名字反了会先骗到读的人。
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    console.error('[mod-catalog] 读不出目录文件:', file, error);
    return c.json({ error: 'catalog_unavailable' }, 500);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error('[mod-catalog] 目录文件不是合法 JSON:', file, error);
    return c.json({ error: 'catalog_invalid_json' }, 500);
  }

  const result = parseModCatalog(parsed);
  if (!result.ok) {
    console.error('[mod-catalog] 目录内容不合法:', file, result.problems);
    return c.json({ error: 'catalog_invalid', problems: result.problems }, 500);
  }

  /*
   * ⚠️★ 上面三步（读盘 / `JSON.parse` / 严格校验）都在下面那个 304 判断**之前** ⇒
   *    304 省的是**带宽**，不是服务端的工作量：这是 425 KB 的目录，一个条件请求照样把它
   *    整体读进来、解析、再跑一遍 zod 严格校验（端点公开无鉴权 ⇒ 条件请求打满就是一次放大）。
   *    仍然接受这个代价：① 目录是**配置**、每次部署才换一次，正常流量下 ETag 的命中率远高于
   *    写盘频率；② 要省掉这次校验就得把"校验结论"缓存起来，而那会让"部署换了文件"与
   *    "内存里那份还是旧的"重新分叉 —— `fileCatalog.ts` 的文件头已经否掉过一次这种缓存。
   *    （v1 那句"文件几 KB"在这里不成立，所以代价写在明处，不靠那句话兜着。）
   */
  const body = JSON.stringify(result.catalog);
  const etag = `"${createHash('sha256').update(body).digest('hex').slice(0, 16)}"`;
  /*
   * ⚠️★ 304 **必须**把 200 会带的那几个头再带一遍（RFC 7232 §4.1：
   *    Cache-Control / ETag / …），而这里由**同一个对象**给出（200 在那上面再加
   *    content-type，304 不加 —— 表示元数据不该出现在没有正文的响应里）。
   *    ⇒ "200 改了、304 忘了改"这种漂移在这里**不可能发生**，而不是"靠一条测试去发现"。
   *    no-cache = "可以存，但每次都要问一句"：部署换了文件之后立刻生效。
   *    与 `routes/fileCatalog.ts` 那一处逐字同构（理由的全文在那里）。
   */
  const validator = { etag, 'cache-control': 'no-cache' };
  if (c.req.header('if-none-match') === etag) return c.body(null, 304, { ...validator });

  return c.body(body, 200, { 'content-type': 'application/json; charset=utf-8', ...validator });
});
