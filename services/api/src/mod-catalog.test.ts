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
    assert.ok(etag);
    assert.equal(res.headers.get('cache-control'), 'no-cache');
    const cached = await call('/api/mod-catalog', { headers: { 'if-none-match': etag } });
    assert.equal(cached.status, 304);
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

  it('★ 失败响应里不回显服务器侧诊断信息（路径只进日志）', async () => {
    writeFileSync(join(dir, 'mod-catalog.json'), '{ 坏');
    const text = await (await call('/api/mod-catalog')).text();
    assert.equal(text.includes(dir), false);
    assert.equal(text.includes('\\'), false);
    /*
     * ⚠️ 上面第一条在 Windows 上是**恒真**的：路径进了 JSON 文本就是转义过的
     *    （`C:\…` 会写成 `C:\\…`），拿原始路径去 `includes` 永远匹配不上 ——
     *    真的回显了路径时它也不红。⇒ 判据要钉在 `JSON.stringify` 之后那个形状上
     *    （v1 那条测试的同一处就是这么写的）。
     */
    const escapedDir = JSON.stringify(dir).slice(1, -1);
    assert.equal(text.includes(escapedDir), false);
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
