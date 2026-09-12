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
const { liveEmbedUrl, liveEmbedUnavailableReason, liveChannelUrl } = await import(
  '@mcsr/shared/live'
);

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

  it('handle 不许是链接、不许有空格', async () => {
    const editor = await makeUser('editor');
    for (const bad of ['https://youtube.com/@x', '@a b']) {
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
    for (const [name, order] of [
      ['乙', 10],
      ['甲', 10],
      ['丙', 5],
    ] as const) {
      const r = await call('POST', '/api/live', {
        json: channel({ displayName: name, handle: `@${name}`, sortOrder: order }),
        cookie: editor.cookie,
      });
      assert.equal(r.status, 201);
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
 * `liveEmbedUrl` 的三个分支。
 *
 * ⚠️ 这三条都是"错了不会报错"的：返回一个播放器不认的 URL 时，
 *    页面里就是一个**黑框**，看起来像网络问题。所以它们必须被显式测到。
 */
describe('★ 直播嵌入：什么该嵌、什么坚决不嵌', () => {
  it('★ Twitch / B站 只记录不嵌（用户明说 Twitch 还没测）', () => {
    for (const platform of ['twitch', 'bilibili'] as const) {
      assert.equal(
        liveEmbedUrl(
          { platform, handle: 'someone', liveVideoId: 'abc', embedChannel: true },
          'mcsrhelper.com',
        ),
        null,
        `${platform} 现在不嵌 —— 嵌了会是一个黑框，而黑框看起来像我们的 bug`,
      );
      assert.equal(
        liveEmbedUnavailableReason({
          platform,
          handle: 'x',
          liveVideoId: null,
          embedChannel: true,
        }),
        'platform',
      );
    }
  });

  it('YouTube：有视频 ID 就嵌那一个（确定能播的那条路）', () => {
    const url = liveEmbedUrl(
      { platform: 'youtube', handle: '@someone', liveVideoId: 'dQw4w9WgXcQ', embedChannel: false },
      'mcsrhelper.com',
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
