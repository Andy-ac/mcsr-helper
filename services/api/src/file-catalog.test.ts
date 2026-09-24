/**
 * `GET /api/file-catalog` 的测试（可追踪文件目录）。
 *
 * ⚠️ 为什么这里 import 的是**真的 app**（`./index`）而不是自己拼一个 `new Hono()`：
 *    本期交付里有一行是"把 route 挂到 index.ts 上"，而在测试里自己挂一个 app 的话，
 *    那一行就**没有任何断言**。挂错前缀、忘了挂、或者把挂载点写成 `/api` 而 route
 *    自己的路径是 `/`，三种写法的表现都是**线上 404**，而测试照样全绿。
 *    代价：本文件因此跑在完整的中间件链上（限流、secureHeaders、sameOriginOnly、
 *    loadUser）。这个代价是**可接受**的 —— 那条链与目录内容无关，下面三行环境变量
 *    是为了让它在本文件里保持"不碰外部状态"。
 *    本仓大量测试文件是同一个形状（`marks.test.ts` / `live-shares.test.ts` …）；
 *    `seeds-proxy.test.ts` 刻意不这么写，理由写在它自己的文件头（那条路由由用户挂）。
 *
 * ⚠️ 环境变量必须在**任何** import 之前设好，所以这里的 import 是动态的（top-level await）：
 *    `./index` 的 import 期副作用 —— 开库、起 HTTP 监听、给每个请求打日志的中间件 ——
 *    全部包在它自己那两处 `process.env.NODE_ENV !== 'test'` 守卫里（现读 index.ts 里那两处 if）。
 *    不设 NODE_ENV=test 的话，这个文件会真的去开一个 127.0.0.1:3001 的监听，
 *    并打开默认的 `./data/mcsr.db`（默认值在 `src/db/index.ts`）——
 *    那不是"断言失败"，是把状态留在开发者机器上。
 *    `DB_PATH` 一并显式设成 `:memory:`：本机**确实**有一份开发用的
 *    `services/api/data/mcsr.db`（现读存在），不显式给值就等于把"测试不碰库"
 *    押在"恰好没有一条代码路径会走到 getDb()"上。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';

const { app } = await import('./index');

/** 每个用例一个临时 content 目录：坏目录不能靠改仓库里那个文件来造。 */
let dir: string;
const ORIGINAL = process.env.MCSR_CONTENT_DIR;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'file-catalog-'));
  process.env.MCSR_CONTENT_DIR = dir;
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.MCSR_CONTENT_DIR;
  else process.env.MCSR_CONTENT_DIR = ORIGINAL;
});

async function call(path: string, headers: Record<string, string> = {}) {
  return app.request(path, { headers });
}

describe('GET /api/file-catalog', () => {
  it('合法目录 ⇒ 200 + ETag，且 ETag 命中时回 304', async () => {
    writeFileSync(join(dir, 'file-catalog.json'), JSON.stringify({ version: 1, items: [] }));
    const res = await call('/api/file-catalog');
    assert.equal(res.status, 200);
    const etag = res.headers.get('etag');
    assert.ok(etag, '必须带 ETag');
    const again = await call('/api/file-catalog', { 'if-none-match': etag! });
    assert.equal(again.status, 304);
  });

  it('★ 目录缺字段 ⇒ 500 且**点名**是哪个字段（不是少一条、也不是空数组）', async () => {
    writeFileSync(
      join(dir, 'file-catalog.json'),
      JSON.stringify({
        version: 1,
        items: [
          {
            id: 'x',
            name: 'X',
            kind: 'mod',
            source: {
              provider: 'modrinth',
              project: 'p',
              gameVersion: '1.16.1',
              loader: 'fabric',
              channel: 'release',
            },
          },
        ],
      }),
    );
    const res = await call('/api/file-catalog');
    assert.equal(res.status, 500);
    const body = (await res.json()) as { error: string; problems: string[] };
    assert.equal(body.error, 'catalog_invalid');
    assert.ok(
      body.problems.some((p) => p.includes('modId')),
      `实际问题：${body.problems.join(' / ')}`,
    );
  });

  it('文件不存在 / JSON 坏掉 ⇒ 500 且 error 分得清是哪一种', async () => {
    assert.equal((await call('/api/file-catalog')).status, 500);
    writeFileSync(join(dir, 'file-catalog.json'), '{ 这不是 json');
    const res = await call('/api/file-catalog');
    assert.equal(res.status, 500);
    assert.equal(((await res.json()) as { error: string }).error, 'catalog_invalid_json');
  });
});
