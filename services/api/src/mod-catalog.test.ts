/**
 * `GET /api/mod-catalog` 的测试（mc.sr 那套 mod 目录，schema 2）。
 *
 * ⚠️ 形状照着 `file-catalog.test.ts`（v1 那条端点）：
 *    · import 的是**真的 app**（`./index`），这样"把 route 挂到 index.ts 上"那一行
 *      才有断言 —— 挂错前缀 / 忘了挂，两种写法的表现都是线上 404，而自建 app 的测试照样绿；
 *    · 环境变量在**任何** import 之前设好 ⇒ 这里的 import 是动态的（top-level await）；
 *    · `MCSR_CONTENT_DIR` 由 `beforeEach` 设成临时目录、`afterEach` **恢复旧值**
 *      （不给回旧值的话，本文件跑完之后它指向一个已删除的目录 —— 那种性质靠巧合成立）。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';

const { app } = await import('./index');

/** 每个用例一个临时 content 目录：坏目录不能靠改仓库里那个文件来造。 */
let dir: string;
const ORIGINAL = process.env.MCSR_CONTENT_DIR;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mod-catalog-'));
  process.env.MCSR_CONTENT_DIR = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (ORIGINAL === undefined) delete process.env.MCSR_CONTENT_DIR;
  else process.env.MCSR_CONTENT_DIR = ORIGINAL;
});

// ⚠️ `async` 是必需的：`app.request` 的返回类型是 `Response | Promise<Response>`，
//    不包一层就与 `Promise<Response>` 对不上（v1 那条测试用的是同形的 async function）。
const call = async (path: string, init?: RequestInit): Promise<Response> => app.request(path, init);

/*
 * 仓库里那份真目录。
 * ⚠️ 从 `import.meta.url` 起算，**不用** `process.cwd()`：本计划里 Task 2 / Task 5 的测试
 *    都是这个写法，而两种定位方式并存迟早分叉 —— 分叉的表现是"谁被 `--test` 的 cwd
 *    变化咬到就红在一个与任务无关的地方"。
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG = join(HERE, '../../..', 'content', 'mod-catalog.json');

describe('GET /api/mod-catalog', () => {
  it('合法目录 ⇒ 200 + ETag，且 ETag 命中时回 304', async () => {
    // 把仓库里那份真目录拷进临时目录（这一条测的是端点，不是生成器）
    writeFileSync(join(dir, 'mod-catalog.json'), readFileSync(CATALOG));
    const res = await call('/api/mod-catalog');
    assert.equal(res.status, 200);
    const etag = res.headers.get('etag');
    assert.ok(etag, '必须带 ETag');
    assert.equal(res.headers.get('cache-control'), 'no-cache');
    const cached = await call('/api/mod-catalog', { headers: { 'if-none-match': etag } });
    assert.equal(cached.status, 304);
    /*
     * ⚠️★ 304 **必须**重复 200 那份校验器（RFC 7232 §4.1：304 MUST 带 200 会带的
     *    Cache-Control / ETag / …）。而判据是**相等**、不是"存在"：
     *    "带了一个不同的 ETag"同样让客户端拿不到能用的校验器 —— 那比不带更坏，
     *    因为它看起来像成功（客户端会拿一个配不上任何表示的标签继续条件请求）。
     *    ⚠️ 结构上两支共用同一个 `validator` 对象 ⇒ 这三条是**第二层**守卫（漂移在这里
     *    已经不可能发生），而不是唯一一层；补它们是为了覆盖广度，不是为了补一个洞。
     */
    assert.equal(cached.headers.get('etag'), etag, '304 的 ETag 必须与 200 的**相同**');
    assert.equal(
      cached.headers.get('cache-control'),
      res.headers.get('cache-control'),
      '304 的 Cache-Control 必须与 200 的相同',
    );
    // 304 不带表示元数据（RFC 7232 §4.1 同一条）：正文都没有，content-type 也不该有
    assert.equal(cached.headers.get('content-type'), null);
  });

  it('★ 目录缺字段 ⇒ 500 且**点名**是哪个字段', async () => {
    const raw = JSON.parse(readFileSync(CATALOG, 'utf8')) as { releases: { sha512?: string }[] };
    delete raw.releases[0]!.sha512;
    writeFileSync(join(dir, 'mod-catalog.json'), JSON.stringify(raw));
    const res = await call('/api/mod-catalog');
    assert.equal(res.status, 500);
    const body = (await res.json()) as { error: string; problems?: string[] };
    assert.equal(body.error, 'catalog_invalid');
    assert.match((body.problems ?? []).join(' '), /releases\.0\.sha512/);
    /*
     * ⚠️ `problems` 按设计**留着**（那是调用方唯一能自己动手修的线索，见路由的文件头），
     *    但它同样不许把服务器侧路径带出去 —— 与测试 4 那两条是同一个判据，
     *    区别只是这一支多一个**合法**的 `problems` 键（所以不能用"只有 error"那把尺子）。
     */
    assert.equal(JSON.stringify(body).includes(JSON.stringify(dir).slice(1, -1)), false);
  });

  it('文件不存在 / JSON 坏掉 ⇒ 500 且 error 分得清是哪一种', async () => {
    assert.equal((await call('/api/mod-catalog')).status, 500);
    assert.equal(
      ((await (await call('/api/mod-catalog')).json()) as { error: string }).error,
      'catalog_unavailable',
    );
    writeFileSync(join(dir, 'mod-catalog.json'), '{ 这不是 json');
    const res = await call('/api/mod-catalog');
    assert.equal(res.status, 500);
    assert.equal(((await res.json()) as { error: string }).error, 'catalog_invalid_json');
  });

  it('★ 失败响应里不回显服务器侧诊断信息（键集合 + 路径子串，两个 500 分支各一遍）', async () => {
    /*
     * ⚠️ 这条守的是一件**看起来无关紧要、但端点匿名可打**的事：这个接口谁都能请求，
     *    所以响应体里不该出现服务器上的绝对路径，也不该出现底层引擎的报错原文
     *    （`JSON.parse` 的报错文本里**可能带文件内容的片段**）。
     * ⚠️★ 承重的那条判据是**整个 body 只有 `error` 一个键**，而不是"没搜到路径子串"：
     *    子串判据只挡得住"路径"这一种泄露 —— 一个**非路径**的 `detail`（比如 `JSON.parse`
     *    的消息，它带文件内容片段）在子串判据下照样漏过去，而键集合判据当场红。
     *    两个只回 `{ error }` 的分支各走一遍（v1 `file-catalog.test.ts` 那两条同形）。
     * ⚠️ 第三条分支 `catalog_invalid` **按设计**多带一个 `problems`（调用方唯一能自己动手
     *    修的线索），所以它不能用 `['error']` 这条判据 —— 它由测试 2 单独守。
     * ⚠️ 它**能红**：往任一条 500 的响应体里加 `path` / `detail`，下面那个 `deepEqual` 当场红。
     */
    // ⚠️ 路径进了 JSON 文本是**转义过**的（`C:\…` 会写成 `C:\\…`），所以判据要钉在
    //    `JSON.stringify` 之后那个形状上；拿原始路径去 `includes` 在 Windows 上是**恒真**的。
    const escapedDir = JSON.stringify(dir).slice(1, -1);

    // ① 文件不存在那一支
    const missing = await call('/api/mod-catalog');
    assert.equal(missing.status, 500);
    const missingText = await missing.text();
    assert.deepEqual(Object.keys(JSON.parse(missingText) as object).sort(), ['error']);
    assert.equal(missingText.includes(dir), false);
    assert.equal(missingText.includes('\\'), false);
    assert.equal(missingText.includes(escapedDir), false);

    // ② 文件在、但不是合法 JSON 那一支
    writeFileSync(join(dir, 'mod-catalog.json'), '{ 坏');
    const broken = await call('/api/mod-catalog');
    assert.equal(broken.status, 500);
    const brokenText = await broken.text();
    assert.deepEqual(Object.keys(JSON.parse(brokenText) as object).sort(), ['error']);
    assert.equal(brokenText.includes(dir), false);
    assert.equal(brokenText.includes('\\'), false);
    assert.equal(brokenText.includes(escapedDir), false);
  });

  it('★ v1 那条端点与这个子路径不串（同一个前缀下两个路由各走各的）', async () => {
    writeFileSync(join(dir, 'mod-catalog.json'), readFileSync(CATALOG));
    writeFileSync(join(dir, 'file-catalog.json'), JSON.stringify({ version: 1, items: [] }));
    const v2 = (await (await call('/api/mod-catalog')).json()) as { schema: number };
    const v1 = (await (await call('/api/file-catalog')).json()) as { version: number };
    assert.equal(v2.schema, 2);
    assert.equal(v1.version, 1);
  });
});
