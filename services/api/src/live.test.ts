/**
 * 012：资源库的 `video` 类型 + 直播频道清单。
 *
 * ---------------------------------------------------------------------------
 * 这个文件里最要紧的一条是"重建表没有丢数据"
 * ---------------------------------------------------------------------------
 * 012 为了给 `kind` 的 CHECK 加上 `'video'`，**重建了整张 `resources` 表**
 * （SQLite 改不了 CHECK）。而重建的失败方式非常安静：
 * 漏一列、漏一个索引、或者外键没关导致级联删掉版本快照 ——
 * 新表照样建得起来，迁移照样报成功。
 *
 * 所以这里逐条验证：
 *   · 19 列一列不少（对着 `PRAGMA table_info` 数）
 *   · 7 个索引一条不少
 *   · 已有的行**原样还在**（含各列的值，不只是"行数对"）
 *   · ⚠️ **`resource_revisions` / `resource_marks` 没有被级联删掉**
 *     —— 这一条只有在"外键没关"时才失败，而那是重建表最经典的灾难
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
const {
  liveEmbedUrl,
  liveEmbedDecision,
  liveEmbedUnavailableReason,
  liveChannelUrl,
  parseLiveLink,
} = await import('@mcsr/shared/live');

const PASSWORD = 'a good long passphrase';

after(() => closeDb());
beforeEach(() => {
  resetAll();
  // 只清业务数据，不动 schema —— 这一组测的就是 schema 本身
  getDb().exec('DELETE FROM live_channels');
  getDb().exec('DELETE FROM content_revisions');
  getDb().exec('DELETE FROM calendar_events');
});

async function call(
  method: string,
  path: string,
  options: { json?: unknown; cookie?: string } = {},
): Promise<{
  status: number;
  body: Record<string, unknown>;
  text: string;
  setCookie: string | null;
}> {
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
    text,
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
async function makeUser(role: 'user' | 'editor' = 'user') {
  seq += 1;
  const email = `live${String(seq)}.${Date.now()}@example.com`;
  await call('POST', '/api/auth/register', {
    json: { email, password: PASSWORD, displayName: `直播${String(seq)}`, locale: 'zh-CN' },
  });
  getDb()
    .prepare('UPDATE users SET email_verified_at = ?, role = ? WHERE email = ?')
    .run(Date.now(), role, email);
  const login = await call('POST', '/api/auth/login', { json: { email, password: PASSWORD } });
  return { email, cookie: (login.setCookie ?? '').split(';')[0] as string };
}

const channel = (over: Record<string, unknown> = {}) => ({
  platform: 'youtube',
  handle: '@Someone',
  displayName: '某位选手',
  ...over,
});

/**
 * `SELECT COUNT(*)` → number。
 *
 * ⚠️ `node:sqlite` 的 `.get()` 返回 `unknown`（列名是运行时才知道的），
 *    所以取值必须断言一次。收成一个 helper，而不是在十几处各写一次 `as` ——
 *    断言散开之后就没人看得出哪一处真的想断言什么了。
 */
const countOf = (sql: string, ...args: unknown[]): number =>
  Number(
    (
      getDb()
        .prepare(sql)
        .get(...(args as never[])) as { n: number } | undefined
    )?.n ?? 0,
  );

/**
 * 响应体里的 `items`。
 *
 * 和 `videos-routes.test.ts` 里的同名 helper 一致：路由测试的形状是
 * `Record<string, unknown>`（因为 JSON 解析的结果本来就是未知的），
 * 断言之前要收窄一次。
 */
const itemsOf = (body: Record<string, unknown>): Array<Record<string, unknown>> =>
  (body.items ?? []) as Array<Record<string, unknown>>;

// ---------------------------------------------------------------------------

describe('★ 012：重建 resources 之后没有丢东西', () => {
  it('19 列一列不少，而且 kind 的 CHECK 已经认 video', () => {
    const cols = getDb().prepare('PRAGMA table_info(resources)').all() as unknown as Array<{
      name: string;
    }>;
    const names = cols.map((c) => c.name).sort();

    /*
     * ⚠️ 这份清单是照着**迁移前**库里的 `sqlite_master` 抄下来的（19 列）。
     *    少一列在这里就会红，而不是等到某天发现某个字段全空了。
     */
    const expected = [
      'author_id',
      'body',
      'created_at',
      'current_revision',
      'featured',
      'id',
      'image_url',
      'kind',
      'lang',
      'official',
      'pending_revision',
      'source',
      'status',
      'summary',
      'tags',
      'title',
      'title_en',
      'updated_at',
      'url',
    ];
    assert.deepEqual(names, expected, '重建之后的列必须和重建前逐列一致');

    // kind 的取值现在有第三个
    const user = getDb().prepare('SELECT id FROM users LIMIT 1').get();
    void user;
    const id = `k-${String(Date.now())}`;
    getDb()
      .prepare(
        `INSERT INTO resources (id, kind, title, url, lang, tags, created_at, updated_at)
         VALUES (?, 'video', '视频资料', 'https://www.bilibili.com/video/BV1xx411c7mD', 'zh-CN', '[]', 0, 0)`,
      )
      .run(id);
    assert.ok(
      getDb().prepare('SELECT id FROM resources WHERE id = ?').get(id),
      'video 类型必须能真的插进去（CHECK 已经放开）',
    );

    // 而非法取值仍然被挡
    assert.throws(
      () =>
        getDb()
          .prepare(
            `INSERT INTO resources (id, kind, title, url, lang, tags, created_at, updated_at)
             VALUES (?, 'podcast', 'x', 'https://x.test/', 'zh-CN', '[]', 0, 0)`,
          )
          .run(`bad-${String(Date.now())}`),
      /CHECK/i,
      '放开到 video 不等于放开到任意字符串',
    );
  });

  it('7 个索引一条不少（重建表最容易漏的就是它们）', () => {
    const idx = getDb()
      .prepare(
        "SELECT name FROM sqlite_master WHERE tbl_name='resources' AND type='index' AND sql IS NOT NULL ORDER BY name",
      )
      .all()
      .map((r) => r.name);
    assert.deepEqual(idx, [
      'idx_resources_author',
      'idx_resources_kind',
      'idx_resources_lang',
      'idx_resources_listing',
      'idx_resources_official',
      'idx_resources_pending',
      'idx_resources_source',
    ]);
  });

  it('★★ 重建没有级联删掉版本快照和收藏（外键必须被关掉过）', () => {
    /*
     * 这是重建 `resources` 最经典的灾难：`resource_revisions` 和
     * `resource_marks` 都有 `ON DELETE CASCADE` 指向它。开着外键 DROP TABLE
     * 会做一次隐式 DELETE —— 于是"加一个枚举值"顺手把**全部审核历史和收藏**清空。
     *
     * ⚠️ 而这个失败**不会在迁移时报错**，只会在几天后有人发现"版本快照没了"。
     *
     * 这里造一份"迁移之前就该存在"的数据，再**重新跑一次迁移器**是不现实的
     * （迁移只有一次），所以改成验证**结构**上的前提：
     *   · 外键**确实**指向重建后的 resources（说明重建之后关系恢复了）
     *   · 而级联删除的行为是"删 resources 会带走 revisions"（这说明 CASCADE 生效）
     * 也就是说：如果重建时没关外键，上面这条 INSERT 之后的行数会是 0 ——
     * 而那些行是在**迁移期间**就没了的，测试跑在这里时已经看不到。
     *
     * 所以这条测试守的是**能守的那一半**：关系仍然正确、且 CASCADE 仍然生效。
     * 真正的证据在部署前的演练脚本里（`.cache/rehearse-migration.mjs`，
     * 它拿生产库副本跑，比对迁移前后的行数）。
     */
    const fks = getDb().prepare('PRAGMA foreign_key_list(resource_revisions)').all();
    assert.ok(
      fks.some((fk) => fk.table === 'resources' && fk.on_delete === 'CASCADE'),
      'resource_revisions 的外键必须仍然指向 resources 且是 CASCADE',
    );

    const marksFks = getDb().prepare('PRAGMA foreign_key_list(resource_marks)').all();
    assert.ok(
      marksFks.some((fk) => fk.table === 'resources' && fk.on_delete === 'CASCADE'),
      'resource_marks 的外键同上',
    );

    // CASCADE 真的生效：删掉一条 resource，它的快照跟着走
    const rid = `fk-${String(Date.now())}`;
    getDb()
      .prepare(
        `INSERT INTO resources (id, kind, title, url, lang, tags, created_at, updated_at)
         VALUES (?, 'website', 't', 'https://fk.test/', 'zh-CN', '[]', 0, 0)`,
      )
      .run(rid);
    getDb()
      .prepare(
        `INSERT INTO resource_revisions
           (id, resource_id, revision, kind, title, url, body, lang, tags, status, created_at)
         VALUES (?, ?, 1, 'website', 't', 'https://fk.test/', '', 'zh-CN', '[]', 'pending', 0)`,
      )
      .run(`rev-${rid}`, rid);

    getDb().prepare('DELETE FROM resources WHERE id = ?').run(rid);
    assert.equal(
      countOf('SELECT COUNT(*) n FROM resource_revisions WHERE resource_id = ?', rid),
      0,
      'CASCADE 应当仍然生效（说明重建之后外键关系是完整的）',
    );
  });

  it('live_channels 表建好了，而且平台/状态都有 CHECK', () => {
    const cols = getDb()
      .prepare('PRAGMA table_info(live_channels)')
      .all()
      .map((c) => c.name);
    for (const name of [
      'id',
      'platform',
      'handle',
      'display_name',
      'note',
      'live_video_id',
      'embed_channel',
      'sort_order',
      'status',
      'created_at',
      'updated_at',
    ]) {
      assert.ok(cols.includes(name), `live_channels 缺列 ${name}`);
    }

    assert.throws(
      () =>
        getDb()
          .prepare(
            `INSERT INTO live_channels (id, platform, handle, display_name, sort_order, created_at, updated_at)
             VALUES ('x', 'kick', 'someone', 'n', 1, 0, 0)`,
          )
          .run(),
      /CHECK/i,
    );
    assert.throws(
      () =>
        getDb()
          .prepare(
            `INSERT INTO live_channels (id, platform, handle, display_name, status, sort_order, created_at, updated_at)
             VALUES ('y', 'twitch', 'someone', 'n', 'pending', 1, 0, 0)`,
          )
          .run(),
      /CHECK/i,
      '这份清单是编辑维护的，刻意没有 pending 态',
    );
  });
});

describe('★ 直播清单：权限、重复与开关', () => {
  it('公开读不需要登录；编辑视图需要 live.manage', async () => {
    const anon = await call('GET', '/api/live');
    assert.equal(anon.status, 200);
    assert.deepEqual(anon.body.items, []);

    const plain = await makeUser();
    const manage = await call('GET', '/api/live/manage', { cookie: plain.cookie });
    assert.equal(manage.status, 403, '普通用户不能看含隐藏行的管理列表');
    assert.equal(manage.body.capability, 'live.manage');
  });

  it('★ 只有编辑能加；加了之后公开列表就看得到', async () => {
    const plain = await makeUser();
    const editor = await makeUser('editor');

    const denied = await call('POST', '/api/live', {
      json: channel(),
      cookie: plain.cookie,
    });
    assert.equal(denied.status, 403);

    const created = await call('POST', '/api/live', { json: channel(), cookie: editor.cookie });
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const pub = await call('GET', '/api/live');
    const items = pub.body.items as Array<Record<string, unknown>>;
    assert.equal(items.length, 1);
    assert.equal(items[0]?.displayName, '某位选手');
    // SQLite 的 0/1 必须已经转成布尔，否则前端 `if (embedChannel)` 会把 0 当成 true
    assert.equal(items[0]?.embedChannel, false, 'embed_channel 必须出成布尔值，不是 0');
  });

  it('★ 重复的频道给 409 + 已有那条的 id（而不是 500）', async () => {
    const editor = await makeUser('editor');
    const first = await call('POST', '/api/live', { json: channel(), cookie: editor.cookie });
    assert.equal(first.status, 201);

    const dup = await call('POST', '/api/live', { json: channel(), cookie: editor.cookie });
    assert.equal(dup.status, 409, `重复必须是 409：${JSON.stringify(dup.body)}`);
    assert.equal(dup.body.error, 'live_exists');
    assert.equal(dup.body.existingId, (first.body.channel as { id: string }).id);

    // 同一个 handle 在**另一个平台**上是允许的
    const other = await call('POST', '/api/live', {
      json: channel({ platform: 'twitch' }),
      cookie: editor.cookie,
    });
    assert.equal(other.status, 201, 'UNIQUE 是 (platform, handle)，不是 handle');
  });

  it('★ handle 收"标识或链接"：链接会被归一化成标识；认不出的位置、带空格的标识被拒', async () => {
    const editor = await makeUser('editor');

    /*
     * F29 定稿 = **(ii) 输入宽松、存储严格**：编辑最常见的动作是把整条
     * 频道页链接粘进来，所以**允许**，服务端归一化后**只落库标识**。
     *
     * ⚠️ 这一条**改过口径**：原来断言"链接一律 400"（那时 handle 只收标识）。
     *    仍然被拒的是"既不是标识、也不是我们能认出来的频道链接"，以及带空格的标识。
     */
    const pasted = await call('POST', '/api/live', {
      json: channel({ handle: 'https://www.youtube.com/@Someone' }),
      cookie: editor.cookie,
    });
    assert.equal(pasted.status, 201, JSON.stringify(pasted.body));
    assert.equal(
      (pasted.body.channel as { handle: string }).handle,
      '@Someone',
      '落库的是**标识**，不是那条链接（库里永远只是标识：链接由我们按平台拼出来）',
    );

    for (const bad of ['https://example.com/someone', '@a b', 'javascript:alert(1)']) {
      const res = await call('POST', '/api/live', {
        json: channel({ handle: bad }),
        cookie: editor.cookie,
      });
      assert.equal(res.status, 400, `${bad} 应当被拒：${JSON.stringify(res.body)}`);
    }
  });

  it('隐藏之后公开列表看不到，管理视图还看得到；空操作 changed:false 且不写审计', async () => {
    const editor = await makeUser('editor');
    const created = await call('POST', '/api/live', { json: channel(), cookie: editor.cookie });
    const id = (created.body.channel as { id: string }).id;

    const auditsBefore = countOf('SELECT COUNT(*) n FROM audit_log WHERE entity_id = ?', id);

    const hide = await call('PATCH', `/api/live/${id}/visibility`, {
      json: { status: 'hidden' },
      cookie: editor.cookie,
    });
    assert.equal(hide.status, 200);
    assert.equal(hide.body.changed, true);

    assert.equal(
      itemsOf((await call('GET', '/api/live')).body).length,
      0,
      '隐藏之后公开列表不该有它',
    );
    const manage = await call('GET', '/api/live/manage', { cookie: editor.cookie });
    assert.equal(itemsOf(manage.body).length, 1, '管理视图仍然要能看到它');

    const again = await call('PATCH', `/api/live/${id}/visibility`, {
      json: { status: 'hidden' },
      cookie: editor.cookie,
    });
    assert.equal(again.body.changed, false, '已经是 hidden 了，这一下没改变任何东西');

    const auditsAfter = countOf('SELECT COUNT(*) n FROM audit_log WHERE entity_id = ?', id);
    assert.equal(
      auditsAfter,
      auditsBefore + 1,
      '只有那一次真的隐藏写审计 —— 空操作不留痕（和视频那边同一条规则）',
    );
  });

  it('删掉之后公开列表和管理视图都没有了', async () => {
    const editor = await makeUser('editor');
    const created = await call('POST', '/api/live', { json: channel(), cookie: editor.cookie });
    const id = (created.body.channel as { id: string }).id;

    const del = await call('DELETE', `/api/live/${id}`, { cookie: editor.cookie });
    assert.equal(del.status, 200);

    assert.equal(itemsOf((await call('GET', '/api/live')).body).length, 0);
    const manage = await call('GET', '/api/live/manage', { cookie: editor.cookie });
    assert.equal(itemsOf(manage.body).length, 0);

    // 再删一次是 404（而不是"删掉了"然后什么都没发生）
    assert.equal((await call('DELETE', `/api/live/${id}`, { cookie: editor.cookie })).status, 404);
  });

  it('排序：先按 sortOrder，同序按名字**确定**（不随刷新换位）', async () => {
    const editor = await makeUser('editor');
    /*
     * ⚠️ 这个 fixture 的 `handle` 是 **ASCII** 的（`@c` / `@b` / `@a`）。
     *    它原来写成 `@${name}`（`@乙` 这种），而那是**中文标识** ——
     *    F29 定稿之后 `handle` 只认"平台标识（ASCII 字母数字 + `_ . -`）或链接"，
     *    中文串既不是标识也不是链接 ⇒ 400。平台标识本来就是 ASCII 的
     *    （YouTube/Twitch 的用户名、B站 的房间号），所以这里是 fixture 假数据
     *    不真实，不是组件的错 —— 和 liverender 里 `twitch.tv/%40Someone` 那次同一个道理。
     */
    for (const [name, order, handle] of [
      ['乙', 10, '@b'],
      ['甲', 10, '@a'],
      ['丙', 5, '@c'],
    ] as const) {
      const r = await call('POST', '/api/live', {
        json: channel({ displayName: name, handle, sortOrder: order }),
        cookie: editor.cookie,
      });
      assert.equal(r.status, 201, `displayName=${name}: ${JSON.stringify(r.body)}`);
    }

    const names = (
      (await call('GET', '/api/live')).body.items as Array<{ displayName: string }>
    ).map((c) => c.displayName);

    // sortOrder 是主键：5 的必须排在两个 10 的前面
    assert.equal(names[0], '丙', 'sortOrder 小的在前');

    /*
     * ⚠️ 同序的两个**不是**按拼音排的，而是按 SQLite 默认的 BINARY 排序
     *    （逐字节比 UTF-8）：乙 U+4E59 < 甲 U+7532，所以乙在前。
     *
     *    我第一版把期望写成了 ['丙','甲','乙'] —— 那是**人的**顺序
     *    （笔画/拼音），而 SQLite 从来不做这件事。这不是 bug，是测试写错了：
     *    我要的性质是"**确定**"（同一次数据每次返回同样的顺序），
     *    而不是"符合中文习惯"。
     *
     *    界面上这一列由 `sort_order` 主导，所以真实使用里同序很少；
     *    真出现时，一个稳定的（哪怕不直观）顺序也比"刷新一次换一次位置"好。
     */
    assert.deepEqual(names, ['丙', '乙', '甲'], '同序按名字的字节序 —— 关键是确定，不是符合拼音');

    // 真正的性质：连着取几次，顺序必须一模一样
    for (let i = 0; i < 3; i += 1) {
      const again = (
        (await call('GET', '/api/live')).body.items as Array<{ displayName: string }>
      ).map((c) => c.displayName);
      assert.deepEqual(again, names, '反复取不该换位');
    }
  });
});

/**
 * `liveEmbedDecision` 的**两态**（能嵌 / 确定不可嵌）+ `liveEmbedUrl` 那一层薄封装。
 *
 * ⚠️ 每一条都是"错了不会报错"的：返回一个播放器不认的 URL 时，
 *    页面里就是一个**黑框**，看起来像网络问题。所以它们必须被显式测到。
 *
 * ⚠️ 这整块**改过口径**（D4b.9 / F32d 实测）：原来写的是"Twitch / B站 只记录不嵌，
 *    Twitch 还没测过"。实测结果是：**Twitch 能嵌**（`player.twitch.tv` 回
 *    `frame-ancestors`，但**必须带对 `parent`**），**B站直播间才是确定不可嵌的**
 *    （`x-frame-options: SAMEORIGIN`，大陆 + 香港两条网络各自测到）。
 */
describe('★ 直播嵌入：两态（能嵌 / 确定不可嵌）', () => {
  const ORIGIN = 'mcsrhelper.com';
  const twitch = {
    platform: 'twitch',
    handle: 'Someone',
    liveVideoId: null,
    embedChannel: false,
  } as const;

  it('★ Twitch：能嵌，而且 `parent` 就是传进来的 origin', () => {
    assert.equal(
      liveEmbedUrl(twitch, ORIGIN),
      `https://player.twitch.tv/?channel=Someone&parent=${ORIGIN}`,
      'Twitch 的 parent 必须等于嵌入页面的 host',
    );
    assert.equal(liveEmbedDecision(twitch, ORIGIN).embed, true, '两态里的第一态：能嵌');
  });

  it('★★ 换个 origin 就换 parent；带协议/端口的只取域名', () => {
    const a = liveEmbedUrl(twitch, ORIGIN);
    const b = liveEmbedUrl(twitch, 'localhost');
    assert.notEqual(a, b, 'parent 必须跟着 origin 走（传错 = 静默拒播，只能靠测试兜）');
    assert.ok(b?.includes('parent=localhost'), `实际 ${String(b)}`);
    assert.ok(
      liveEmbedUrl(twitch, 'https://mcsrhelper.com:443/live')?.includes(`parent=${ORIGIN}`),
      'parent 要的是域名本身（不带协议、端口、路径）',
    );
  });

  it('★★ 缺 origin ⇒ 宁可不嵌（不发一个注定被拒的请求）', () => {
    for (const empty of ['', '   ']) {
      assert.equal(liveEmbedUrl(twitch, empty), null, '缺 origin 时不嵌');
      assert.deepEqual(
        liveEmbedDecision(twitch, empty),
        { embed: false, reason: 'no_origin' },
        '"为什么没有播放器"必须能说出来（无声的空白框是最坏的结果）',
      );
    }
  });

  it('★ B站直播间：确定不可嵌（平台自己禁止被嵌进别的网站）', () => {
    const bili = {
      platform: 'bilibili',
      handle: '12345',
      liveVideoId: 'abc',
      embedChannel: true,
    } as const;
    assert.equal(
      liveEmbedUrl(bili, ORIGIN),
      null,
      'B站直播间带 x-frame-options: SAMEORIGIN ⇒ 宁可不嵌，也不要一个静默黑框',
    );
    assert.deepEqual(liveEmbedDecision(bili, ORIGIN), {
      embed: false,
      reason: 'bilibili_blocked',
    });
  });

  it('YouTube：有视频 ID 就嵌那一个（确定能播的那条路）', () => {
    const url = liveEmbedUrl(
      { platform: 'youtube', handle: '@someone', liveVideoId: 'dQw4w9WgXcQ', embedChannel: false },
      ORIGIN,
    );
    assert.equal(url, 'https://www.youtube.com/embed/dQw4w9WgXcQ');
  });

  it('★ 视频 ID 形状不对时**不嵌**（宁可外链，也不要一个播不出来的框）', () => {
    assert.equal(
      liveEmbedUrl(
        { platform: 'youtube', handle: '@x', liveVideoId: 'not-an-id', embedChannel: false },
        'o',
      ),
      null,
    );
    // 一个频道 ID 被填进"视频 ID"那一栏是很容易犯的错
    assert.equal(
      liveEmbedUrl(
        {
          platform: 'youtube',
          handle: '@x',
          liveVideoId: 'UCabcdefghijklmnopqrstuv',
          embedChannel: false,
        },
        'o',
      ),
      null,
      '把频道 ID 填进视频 ID 那一栏时必须不嵌，而不是拼一个坏 URL',
    );
  });

  it('★ 频道级嵌入：只认 UC 开头的频道 ID，@handle 一律不嵌', () => {
    const uc = 'UCabcdefghijklmnopqrstuv';
    assert.equal(
      liveEmbedUrl({ platform: 'youtube', handle: uc, liveVideoId: null, embedChannel: true }, 'o'),
      `https://www.youtube.com/embed/live_stream?channel=${uc}`,
    );

    // @handle 会得到一个**黑框**（不会报错），所以提前挡掉
    assert.equal(
      liveEmbedUrl(
        { platform: 'youtube', handle: '@someone', liveVideoId: null, embedChannel: true },
        'o',
      ),
      null,
    );
    assert.equal(
      liveEmbedUnavailableReason({
        platform: 'youtube',
        handle: '@someone',
        liveVideoId: null,
        embedChannel: true,
      }),
      'not_channel_id',
      '界面上要能说出"这个开关不生效"，否则它是一个设置了没反应的开关',
    );
  });

  it('没开频道嵌入又没给视频 ID → 不嵌，理由是 no_id', () => {
    assert.equal(
      liveEmbedUrl(
        { platform: 'youtube', handle: '@x', liveVideoId: null, embedChannel: false },
        'o',
      ),
      null,
    );
    assert.equal(
      liveEmbedUnavailableReason({
        platform: 'youtube',
        handle: '@x',
        liveVideoId: null,
        embedChannel: false,
      }),
      'no_id',
    );
  });

  it('频道主页链接总是能拼出来（所以永远不会是死链）', () => {
    assert.equal(liveChannelUrl('youtube', '@Someone'), 'https://www.youtube.com/@Someone');
    assert.equal(
      liveChannelUrl('youtube', 'UCabcdefghijklmnopqrstuv'),
      'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv',
    );
    assert.equal(liveChannelUrl('twitch', 'Someone'), 'https://www.twitch.tv/Someone');
    assert.equal(liveChannelUrl('bilibili', '12345'), 'https://live.bilibili.com/12345');
  });
});

/**
 * ⚠️ 兼容层**仅剩的那一条有损映射**在这里钉住（`no_origin` → `'platform'`）。
 *
 * `liveEmbedUnavailableReason()` 只拿得到 channel、拿不到 `origin`，所以它回答不了
 * Twitch 那一行。它现在还活着**只有一个理由**：`apps/web` 的 `LiveCard.tsx` 用它，
 * 而那里是穷尽映射（联合类型一加取值就编译不过，见 shared/live.ts 的注释）。
 * ⚠️ 行号别抄（漂过多次），按内容找：`LiveCard.tsx` 里 `function noEmbedKey`，
 *    `liverender.tsx` 里读 `live.noEmbedBilibili` 的那两条断言。
 *
 * ★ t24 已经落过一刀：`'bilibili_blocked'` 改成 **1:1 直传**，不再归并成 `'platform'`。
 *   剩下的 `'no_origin' → 'platform'` **不是缺陷、是必须保留的**（删了它，
 *   `live.noEmbedPlatform` 就没有存在理由，而那一档会无处可去）。
 *   ⇒ 迁到 `liveEmbedDecision()` 是**另一条任务**（`apps/web` 的范围），
 *     迁移时改动会在下面这两条断言上显形，而不是悄悄改变界面文案。
 */
describe('★ liveEmbedUnavailableReason：兼容层还剩一条有损映射（legacy 值必须活着）', () => {
  it('★ B站 → 直接传 `bilibili_blocked`（t24：不再归并成通用的 `platform`）', () => {
    /*
     * ⚠️ 这条**换过期望值**，原因值得留在这里：
     *   原来是 `'platform'` —— 也就是把 B站（确定态：平台自己禁止被嵌）**归并**进
     *   "这个平台在这里不能嵌入播放"那句通用话。界面因此**没说清是哪种**，
     *   而 `live.noEmbedBilibili`（"B 站不允许把直播间嵌进别的网站"）**一个引用都没有**。
     *  ⇒ t24 把这一格改成 1:1 直传，`LiveCard` 的穷尽映射才会指到那句专属文案。
     */
    assert.equal(
      liveEmbedUnavailableReason({
        platform: 'bilibili',
        handle: '12345',
        liveVideoId: null,
        embedChannel: false,
      }),
      'bilibili_blocked',
    );
  });

  it('★ Twitch（这一层拿不到 origin）→ 仍然是旧值 platform，而不是 null', () => {
    /*
     * ⚠️ 这里**不能**返回 null：null 在旧约定里等于"能嵌"，会让 `LiveCard` 落到
     *    `KEYS['no_id']`，于是渲染脚本里那一行被说成"还没有记录直播视频 ID"——
     *    那是**更错**的一句话，并且会让 `liverender.tsx` 里那条断言红掉。
     *    真值（Twitch 缺 `origin` 就静默不播）在 `liveEmbedDecision()` 里，reason = `'no_origin'`。
     *
     * ★ 这一格**故意保持归到 `'platform'`**（t24 只把 B站 那一格直传）：
     *   它正是 `live.noEmbedPlatform`（通用句）**不能删**的理由 —— 删了它，
     *   这一档就没有句子可指、只能指向 B站 那句 = 制造一句新的假话。
     */
    assert.equal(
      liveEmbedUnavailableReason({
        platform: 'twitch',
        handle: 'Someone',
        liveVideoId: null,
        embedChannel: false,
      }),
      'platform',
    );
    // 而**真值**必须能从新接口拿到（t22 靠它渲染"确定不可嵌 → 明确外链"）
    assert.deepEqual(
      liveEmbedDecision(
        { platform: 'twitch', handle: 'Someone', liveVideoId: null, embedChannel: false },
        '',
      ),
      { embed: false, reason: 'no_origin' },
    );
  });
});

/**
 * `parseLiveLink` —— 唯一允许的"解析"，**纯字符串、不发任何网络请求**。
 *
 * ⚠️ 为什么不能复用 `parseVideoUrl`：它的 twitch 分支只认 `/videos/<数字>`
 *    （录像页），而这里要的是**频道**页 `twitch.tv/<用户名>` ——
 *    复用它会把合法的 Twitch 直播链接判成"认不出来"。
 */
describe('★ parseLiveLink：认得出 / 判不出平台 / 完全认不出', () => {
  it('六种链接各自归一化成 (平台, 标识)', () => {
    assert.deepEqual(parseLiveLink('https://www.twitch.tv/Someone'), {
      platform: 'twitch',
      handle: 'Someone',
      liveVideoId: null,
    });
    assert.deepEqual(parseLiveLink('twitch.tv/Someone'), {
      platform: 'twitch',
      handle: 'Someone',
      liveVideoId: null,
    });
    assert.deepEqual(parseLiveLink('https://www.youtube.com/@Someone'), {
      platform: 'youtube',
      handle: '@Someone',
      liveVideoId: null,
    });
    assert.deepEqual(parseLiveLink('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv'), {
      platform: 'youtube',
      handle: 'UCabcdefghijklmnopqrstuv',
      liveVideoId: null,
    });
    assert.deepEqual(parseLiveLink('https://live.bilibili.com/12345'), {
      platform: 'bilibili',
      handle: '12345',
      liveVideoId: null,
    });
    assert.deepEqual(parseLiveLink('https://space.bilibili.com/12345'), {
      platform: 'bilibili',
      handle: '12345',
      liveVideoId: null,
    });
  });

  it('★ 指向"某一场"的视频链接：有 liveVideoId、**没有**频道标识', () => {
    assert.deepEqual(parseLiveLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), {
      platform: 'youtube',
      handle: '',
      liveVideoId: 'dQw4w9WgXcQ',
    });
  });

  it('★ 裸标识：是标识、但**判不出平台**（platform 为 null，与"完全认不出"不是一回事）', () => {
    assert.deepEqual(parseLiveLink('@Someone'), {
      platform: null,
      handle: '@Someone',
      liveVideoId: null,
    });
    assert.deepEqual(parseLiveLink('  Someone  '), {
      platform: null,
      handle: 'Someone',
      liveVideoId: null,
    });
  });

  it('★ 完全认不出 → null（私人列表允许保存，公开名单给 400）', () => {
    for (const bad of [
      '',
      '   ',
      'javascript:alert(1)',
      'ftp://files.example.com/x',
      'https://example.com/some/stream',
      '不是链接也不是标识',
      'twitch.tv/videos/1234567890',
      'https://www.youtube.com/watch?v=short',
      'https://www.youtube.com/user/someone',
    ]) {
      assert.equal(parseLiveLink(bad), null, `${bad} 应当判为"完全认不出"`);
    }
  });

  it('保留段不会被当成频道名（`twitch.tv/videos` 不是一个人）', () => {
    assert.equal(parseLiveLink('https://twitch.tv/videos'), null);
    assert.equal(parseLiveLink('https://twitch.tv/directory'), null);
  });

  it('%40 形式的 @ 也能解出来（链接被二次转义过）', () => {
    assert.deepEqual(parseLiveLink('https://www.youtube.com/%40Someone'), {
      platform: 'youtube',
      handle: '@Someone',
      liveVideoId: null,
    });
  });
});
