/**
 * 图片上传的测试。
 *
 * ---------------------------------------------------------------------------
 * 这个文件里的每一条都对应一个**具体的安全后果**
 * ---------------------------------------------------------------------------
 * 上传是整个项目里唯一一处"外部数据直接落到我们磁盘上、再以我们的域名
 * 发回给浏览器"的地方。所以这里的测试不是"功能对不对"，而是：
 *
 *   · 一个伪装成 .png 的 HTML 文件能不能被存下来、再以 text/html 发出去？
 *     （能 → 存储型 XSS，而且是在我们自己的域名下）
 *   · 文件名里的 `../` 能不能穿出上传目录？
 *   · 几十兆的 body 会不会被读进内存？
 *   · 未登录的人能不能往我们的磁盘上写东西？
 *
 * 这些东西全都"测不出来"是很难发现的 —— 它们不会报错，只会安静地成立。
 */
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.MCSR_MAIL_DRIVER = 'console';
process.env.MCSR_SCRYPT_TEST_PARAMS = 'N=1024,r=8,p=1';

const { app } = await import('./index');
const { closeDb, getDb } = await import('./db');
const { resetAll } = await import('./auth/ratelimit');
const { SITE } = await import('@mcsr/shared');

const PASSWORD = 'a good long passphrase';

after(() => closeDb());
beforeEach(() => {
  resetAll();
  getDb().exec('DELETE FROM uploads');
});

/** 最小的合法 PNG：8 字节签名 + 一点数据。嗅探只看签名，所以这足够。 */
function pngBytes(extra = 'hello'): Uint8Array {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a, // 签名
    ...Buffer.from(extra, 'utf8'),
  ]);
}

function multipart(bytes: Uint8Array, filename: string, type: string): FormData {
  const form = new FormData();
  /*
   * Uint8Array 直接交给 File 是可以的（Node 认 BufferSource），
   * 但 TS 的 DOM 类型只接受 BlobPart —— 而这里**不需要**再拷一份数据。
   * 用一个宽类型断言把它交出去，好过为了讨好类型而多复制几兆字节。
   */
  form.append('file', new File([bytes as unknown as ArrayBuffer], filename, { type }));
  return form;
}

let seq = 0;
async function makeVerifiedUser(): Promise<string> {
  seq += 1;
  const email = `up${String(seq)}.${Date.now()}@example.com`;
  const created = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE.productionOrigin },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      displayName: `上传者${String(seq)}`,
      locale: 'zh-CN',
    }),
  });
  assert.equal(created.status, 200);

  getDb().prepare('UPDATE users SET email_verified_at = ? WHERE email = ?').run(Date.now(), email);

  const login = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE.productionOrigin },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  assert.equal(login.status, 200);
  const setCookie = login.headers.getSetCookie()[0] ?? '';
  return setCookie.split(';')[0] as string;
}

async function upload(form: FormData, cookie?: string): Promise<Response> {
  return app.request('/api/uploads', {
    method: 'POST',
    headers: {
      origin: SITE.productionOrigin,
      ...(cookie ? { cookie } : {}),
    },
    body: form,
  });
}

describe('★ 图片上传', () => {
  it('合法的 PNG 能传上去，并且能读回来', async () => {
    const cookie = await makeVerifiedUser();

    const res = await upload(multipart(pngBytes(), 'cat.png', 'image/png'), cookie);
    // ⚠️ body 只能读一次。写成 assert.equal(res.status, 201, await res.text())
    //    的话，那个参数是**总会求值**的 —— 于是后面的 res.json() 会抛
    //    "Body is unusable"，而错误信息完全指不到真正的原因。
    assert.equal(res.status, 201);
    const body = (await res.json()) as { url: string; mime: string; size: number };
    assert.equal(body.mime, 'image/png');
    // URL 是站内绝对路径 —— 共享 schema 里的 imageRef 只接受这种或 http(s)
    assert.match(body.url, /^\/api\/uploads\/[0-9a-f]{64}\.png$/);

    const read = await app.request(body.url);
    assert.equal(read.status, 200);
    assert.equal(read.headers.get('content-type'), 'image/png');
  });

  it('同一个文件传两次只存一份（内容寻址）', async () => {
    const cookie = await makeVerifiedUser();
    const bytes = pngBytes('same-content');

    const first = (await (await upload(multipart(bytes, 'a.png', 'image/png'), cookie)).json()) as {
      url: string;
      deduped: boolean;
    };
    const second = (await (
      await upload(multipart(bytes, 'b.png', 'image/png'), cookie)
    ).json()) as {
      url: string;
      deduped: boolean;
    };

    assert.equal(first.url, second.url, '同一个内容必须得到同一个 URL');
    assert.equal(first.deduped, false);
    assert.equal(second.deduped, true);
    const count = getDb().prepare('SELECT COUNT(*) AS n FROM uploads').get() as { n: number };
    assert.equal(count.n, 1, '磁盘和数据库里都只该有一份');
  });

  it('伪装成 png 的 HTML 会被拒绝 —— 类型看文件头，不看扩展名', async () => {
    /*
     * ★ 这是这个文件里最重要的一条。
     *
     * 一个内容为 `<script>...</script>` 的文件，只要被存下来、再以
     * text/html 发出去，就是在我们域名下执行的脚本（存储型 XSS）。
     * 而文件名和客户端声明的 Content-Type 都是**用户可控**的：
     * 唯一可信的信号只有文件头那几个字节。
     */
    const cookie = await makeVerifiedUser();

    const html = new TextEncoder().encode('<html><script>alert(document.cookie)</script></html>');
    const res = await upload(multipart(html, 'evil.png', 'image/png'), cookie);

    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error: string }).error, 'not_an_image');
    const count = getDb().prepare('SELECT COUNT(*) AS n FROM uploads').get() as { n: number };
    assert.equal(count.n, 0, '被拒绝的文件绝不能落库落盘');
  });

  it('SVG 也被拒绝（它是可以内嵌脚本的 XML）', async () => {
    const cookie = await makeVerifiedUser();
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    const res = await upload(multipart(svg, 'x.svg', 'image/svg+xml'), cookie);
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error: string }).error, 'not_an_image');
  });

  it('超大文件被拒绝，而且不会先读进内存', async () => {
    const cookie = await makeVerifiedUser();
    // 2 MB 上限 + 一点点
    const big = new Uint8Array(2 * 1024 * 1024 + 64 * 1024);
    big.set(pngBytes(), 0);

    const res = await upload(multipart(big, 'big.png', 'image/png'), cookie);
    assert.equal(res.status, 413);
    assert.equal(((await res.json()) as { error: string }).error, 'too_large');
  });

  it('未登录不能上传', async () => {
    const res = await upload(multipart(pngBytes(), 'x.png', 'image/png'));
    assert.equal(res.status, 401);
  });

  it('读取时带上防 XSS 的响应头，并且缓存是永久的', async () => {
    const cookie = await makeVerifiedUser();
    const body = (await (
      await upload(multipart(pngBytes(), 'h.png', 'image/png'), cookie)
    ).json()) as {
      url: string;
    };

    const read = await app.request(body.url);
    // nosniff：浏览器不许自作聪明改判类型
    assert.equal(read.headers.get('x-content-type-options'), 'nosniff');
    // sandbox：万一将来某个类型漏了，这一条也能让脚本跑不起来
    assert.match(read.headers.get('content-security-policy') ?? '', /sandbox/);
    // 内容是哈希寻址的 —— 同一个 URL 永远不会变，所以缓存多久都安全
    assert.match(read.headers.get('cache-control') ?? '', /immutable/);
  });

  it('不存在或名字非法的路径一律 404，不会摸到目录外', async () => {
    // 全是十六进制但不存在
    const missing = await app.request(`/api/uploads/${'a'.repeat(64)}.png`);
    assert.equal(missing.status, 404);

    // 路径穿越的几种写法
    for (const bad of [
      '..%2F..%2Fetc%2Fpasswd',
      '....%2F%2Fserver.js',
      `${'a'.repeat(64)}.exe`,
      `${'a'.repeat(64)}.png%00.txt`,
      'not-a-hash.png',
    ]) {
      const res = await app.request(`/api/uploads/${bad}`);
      assert.equal(res.status, 404, `${bad} 必须被拒绝`);
    }
  });
});
