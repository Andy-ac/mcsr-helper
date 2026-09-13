/**
 * ⑤ 收藏数（`favoriteCount`）的服务端口径。
 *
 * ---------------------------------------------------------------------------
 * 这个数字只有三条性质，而三条都属于"错了不会报错"的那一类
 * ---------------------------------------------------------------------------
 * 1. **它数的是"别人把这条加进了收藏"，不是"有多少条标记行"**。
 *    `resource_marks` 里一个人只要写过**备注或评分**就会占一行（三项合成一行），
 *    把那种行也算进去，数字就变成"标记过它的人数" —— 而界面上写的是"收藏"。
 *    这是这个功能最容易错的地方，而且**没有任何报错**：数字只是偏大。
 * 2. **它是全站聚合，不是"当前这一页"**。列表分页时按页内推算会给出一个
 *    用户一眼就能看出是错的数字（比如第 2 页显示"0 人收藏"）。
 * 3. **0 就是 0**，不是 `null` / 不显示：契约里它是必填的 `number`
 *    （`FavoriteCountSchema`），"没有人收藏"和"还没有这个数据"是两回事 ——
 *    只有评分那种"没人评过 ≠ 0 分"的字段才需要 null。
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
  const db = getDb();
  db.exec('DELETE FROM content_revisions');
  db.exec('DELETE FROM resource_revisions');
  db.exec('DELETE FROM resource_marks');
  db.exec('DELETE FROM resources');
});

async function call(
  method: string,
  path: string,
  options: { json?: unknown; cookie?: string } = {},
): Promise<{ status: number; body: Record<string, unknown>; setCookie: string | null }> {
  const headers: Record<string, string> = { origin: SITE.productionOrigin };
  if (options.json !== undefined) headers['content-type'] = 'application/json';
  if (options.cookie) headers.cookie = options.cookie;

  const response = await app.request(path, {
    method,
    headers,
    ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : {}),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (() => {
      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        return {};
      }
    })(),
    setCookie: response.headers.getSetCookie?.()[0] ?? null,
  };
}

let seq = 0;
/**
 * ⚠️ 建条目那条路（`/api/authoring/*`）需要 `content.author`（editor 及以上），
 *    而 ⑤ 的读者可以是普通用户 —— 所以角色要能指定，不能一律 'user'。
 */
async function makeUser(role: 'user' | 'editor' = 'user') {
  seq += 1;
  const email = `fav${String(seq)}.${Date.now()}@example.com`;
  await call('POST', '/api/auth/register', {
    json: { email, password: PASSWORD, displayName: `收藏${String(seq)}`, locale: 'zh-CN' },
  });
  getDb()
    .prepare('UPDATE users SET email_verified_at = ?, role = ? WHERE email = ?')
    .run(Date.now(), role, email);
  const login = await call('POST', '/api/auth/login', { json: { email, password: PASSWORD } });
  return { cookie: (login.setCookie ?? '').split(';')[0] as string };
}

let urlSeq = 0;
/** 建一条**已上架**的条目（直编新建最省事：不走审核，立刻在线上）。 */
async function published(editor: string): Promise<string> {
  urlSeq += 1;
  const res = await call('POST', '/api/authoring/resources', {
    json: {
      kind: 'website',
      title: '收藏数测试条目',
      url: `https://fav-${String(urlSeq)}.example.com/`,
      body: '正文',
      lang: 'zh-CN',
      tags: ['tools'],
    },
    cookie: editor,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id as string;
}

/** 列表里那一条的 favoriteCount。 */
async function listCount(id: string): Promise<number> {
  const res = await call('GET', '/api/resources?pageSize=48');
  assert.equal(res.status, 200);
  const item = (res.body.items as Array<{ id: string; favoriteCount: number }>).find(
    (i) => i.id === id,
  );
  assert.ok(item, '条目必须出现在列表里');
  return item.favoriteCount;
}

describe('⑤ 收藏数', () => {
  it('★ 只数 favorite=1：只写备注或评分**不算**收藏', async () => {
    const editor = await makeUser('editor');
    const reader = await makeUser();
    const id = await published(editor.cookie);

    // 先写一条只有备注的标记（这张表里它是一行，但它**不是**收藏）
    const noted = await call('PUT', `/api/resources/${id}/marks`, {
      json: { note: '我的私人备注' },
      cookie: reader.cookie,
    });
    assert.equal(noted.status, 200, JSON.stringify(noted.body));
    assert.equal(await listCount(id), 0, '只有备注不算收藏 —— 混进来数字就变成「标记过的人数」');

    // 评分同理
    const rated = await call('PUT', `/api/resources/${id}/marks`, {
      json: { rating: 4 },
      cookie: reader.cookie,
    });
    assert.equal(rated.status, 200, JSON.stringify(rated.body));
    assert.equal(await listCount(id), 0, '只有评分也不算收藏');

    // 真的收藏之后才 +1
    const faved = await call('PUT', `/api/resources/${id}/marks`, {
      json: { favorite: true },
      cookie: reader.cookie,
    });
    assert.equal(faved.status, 200, JSON.stringify(faved.body));
    assert.equal(await listCount(id), 1);

    // 取消收藏 → 回到 0（而且备注与评分**必须留着**，那是别人的私人数据）
    const un = await call('PUT', `/api/resources/${id}/marks`, {
      json: { favorite: false },
      cookie: reader.cookie,
    });
    assert.equal(un.status, 200, JSON.stringify(un.body));
    assert.equal(await listCount(id), 0);
    const marks = await call('GET', `/api/resources/${id}/marks`, { cookie: reader.cookie });
    /*
     * ⚠️ 响应形状是 `{ marks: {...} }`（见 routes/marks.ts:32）—— 我第一次写成 `body.note`，
     *    于是这条断言失败，看起来像"取消收藏把备注清掉了"。实际是**测试读错了字段**：
     *    产品行为是对的（`setMarks` 只改传了的那个字段，取消收藏不会清备注）。
     */
    const mine = (marks.body as { marks?: { note?: string | null; favorite?: boolean } }).marks;
    assert.equal(mine?.note, '我的私人备注', '取消收藏不该顺手清掉备注');
    assert.equal(mine?.favorite, false, '取消之后 favorite 必须是 false');
  });

  it('★ 它是**全站**聚合（不是「这一页」），且详情与列表一致', async () => {
    const editor = await makeUser('editor');
    const a = await makeUser();
    const b = await makeUser();
    const id = await published(editor.cookie);

    await call('PUT', `/api/resources/${id}/marks`, { json: { favorite: true }, cookie: a.cookie });
    await call('PUT', `/api/resources/${id}/marks`, { json: { favorite: true }, cookie: b.cookie });

    // 两个人的收藏都要算进去 —— 只看「我自己有没有收藏」会得到 0/1 这种一眼错的数字
    assert.equal(await listCount(id), 2, '收藏数是全站聚合，与「看的人是谁」无关');

    const detail = await call('GET', `/api/resources/${id}`);
    assert.equal(detail.status, 200);
    assert.equal(
      (detail.body as { favoriteCount?: number }).favoriteCount,
      2,
      '详情与列表必须是同一个数字（两处各自算一遍就会出现两个真相）',
    );

    // 没登录的人看到的也是同一个数字（它是公开聚合，不含任何私人信息）
    const anon = await call('GET', `/api/resources/${id}`);
    assert.equal((anon.body as { favoriteCount?: number }).favoriteCount, 2);
    assert.equal(
      'note' in (anon.body as Record<string, unknown>),
      false,
      '公开详情里**没有**备注 —— 收藏数是公开聚合，备注只给本人',
    );
  });
});
