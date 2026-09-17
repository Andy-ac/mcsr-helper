/**
 * 用户第 10 条的服务端那一半：**排序**（在播的按人数降序在前）、**三个新字段**、
 * **搜索用的纯函数**，以及它们与既有两个写入口的相互作用。
 *
 * ---------------------------------------------------------------------------
 * 这个文件里最要紧的一条：**四类行混在一起时的逐行顺序**
 * ---------------------------------------------------------------------------
 * 用户的原话是"正在直播的频道按观看人数递降的顺序排列在前面"，而"其余的行"
 * 必须（用户没说的话里最容易被写坏的那半）**保持今天的顺序** ——
 * 这四类行：① 在播且有人数 ② 在播但人数为 NULL ③ 不在播 ④ 从没查过。
 * ⇒ 所以这里的断言**逐行逐 id** 比对，而不是"在播的排前面"（那种断言在
 *    "③ 与 ④ 混在一起顺序错乱"时照样为真）。
 *
 * ⚠️ 用真实 SQLite（`:memory:` + 真的迁移），不 mock 数据层：
 *    这一轮里"`NULL` 排在数字后面"这件事**是 SQL 的性质**（SQLite 的 DESC 把 NULL
 *    排最后），mock 掉它等于把被测的那件事拿掉了。本机实测见
 *    `.cache/videos-live-round/probe-023-sqlite.mjs` 的 ②。
 */
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AuthVariables } from './auth/middleware';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.MCSR_MAIL_DRIVER = 'console';
process.env.MCSR_SCRYPT_TEST_PARAMS = 'N=1024,r=8,p=1';

const { loadUser, sameOriginOnly } = await import('./auth/middleware');
const { closeDb, getDb } = await import('./db');
const { MIGRATION_NAMES } = await import('./db/migrate');
const { liveRoute } = await import('./routes/live');
const { applyLiveStatus, listLiveChannels, listLiveStatusTargets, updateLiveChannel } =
  await import('./live');
const { filterLiveChannels } = await import('@mcsr/shared/live');
const { SITE } = await import('@mcsr/shared');

/*
 * 只挂本模块的测试应用（照 `ranked.test.ts` 的理由）：刻意**不** import `index.ts`，
 * 那样"这条路由自己设了 Cache-Control"才是一句真的断言。
 * ⚠️ 挂载点是 `/api` 而不是 `/api/live`：`liveRoute` 里的路径**自带** `/live` 前缀
 *    （`index.ts:175` 也是 `app.route('/api', liveRoute)`）。写成 `/api/live` 会得到 404，
 *    而那个 404 看起来像"路由没注册"。
 */
const app = new Hono<{ Variables: AuthVariables }>();
app.use('/api/*', sameOriginOnly);
app.use('/api/*', loadUser);
app.route('/api', liveRoute);

after(() => closeDb());
beforeEach(() => {
  getDb().exec('DELETE FROM live_channels');
});

let seq = 0;

interface Row {
  displayName: string;
  platform?: 'twitch' | 'bilibili' | 'youtube';
  handle?: string;
  sortOrder?: number;
  status?: 'visible' | 'hidden';
  isLive?: 0 | 1 | null;
  viewerCount?: number | null;
  liveCheckedAt?: number | null;
  note?: string | null;
  tags?: string[];
}

/** 直接写一行（**三列一起给**，默认全是 NULL = "从没查过"）。返回它的 id。 */
function insert(row: Row): string {
  seq += 1;
  const id = `c${String(seq)}`;
  getDb()
    .prepare(
      `INSERT INTO live_channels
         (id, platform, handle, display_name, note, tags, live_video_id, embed_channel,
          sort_order, status, created_at, updated_at, is_live, viewer_count, live_checked_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, 0, 0, ?, ?, ?)`,
    )
    .run(
      id,
      row.platform ?? 'twitch',
      row.handle ?? 'someone',
      row.displayName,
      row.note ?? null,
      row.tags && row.tags.length > 0 ? JSON.stringify(row.tags) : null,
      row.sortOrder ?? 100,
      row.status ?? 'visible',
      row.isLive === undefined ? null : row.isLive,
      row.viewerCount === undefined ? null : row.viewerCount,
      row.liveCheckedAt === undefined ? null : row.liveCheckedAt,
    );
  return id;
}

const order = (): string[] => listLiveChannels().map((channel) => channel.id);

describe('★ 公开列表的排序：四类行混在一起时的逐行顺序', () => {
  it('在播（有人数，降序）→ 在播（人数 NULL）→ 其余（今天那两个键，一个字没改）', () => {
    /*
     * 刻意把"今天那个顺序"与"最直觉的那个错法"拉开：
     *   · `tie-a`（从没查过，sort_order=1）排在一个不在播的行（sort_order=2）**前面** ——
     *     这才是今天的顺序；
     *   · 而 `ORDER BY is_live = 1 DESC` 那种写法（NULL 求值为 NULL、DESC 下排最后）
     *     会把**所有**"从没查过"的行甩到"不在播"的后面 ⇒ 这条断言会红。
     */
    const never1 = insert({ displayName: '从没查过 A', sortOrder: 1 });
    const offline2 = insert({ displayName: '不在播 B', sortOrder: 2, isLive: 0, liveCheckedAt: 1 });
    const never3 = insert({ displayName: '从没查过 C', sortOrder: 3 });
    const offline4 = insert({ displayName: '不在播 D', sortOrder: 4, isLive: 0, liveCheckedAt: 1 });
    const liveNoCount = insert({
      displayName: '在播但没人数的 E',
      sortOrder: 5,
      isLive: 1,
      viewerCount: null,
      liveCheckedAt: 1,
    });
    const liveSmall = insert({
      displayName: '在播 10 人的 F',
      sortOrder: 6,
      isLive: 1,
      viewerCount: 10,
      liveCheckedAt: 1,
    });
    const liveBig = insert({
      displayName: '在播 5000 人的 G',
      sortOrder: 7,
      isLive: 1,
      viewerCount: 5000,
      liveCheckedAt: 1,
    });

    assert.deepEqual(
      order(),
      [liveBig, liveSmall, liveNoCount, never1, offline2, never3, offline4],
      '顺序必须是：在播（人数降序，NULL 的排在有点数的后面）→ 其余按 sort_order, display_name（今天那两个字一个字没改）',
    );
  });

  it('在播内部**真的**按人数降序（把两条在播行的人数交换 ⇒ 顺序跟着换）', () => {
    const a = insert({
      displayName: 'A',
      sortOrder: 1,
      isLive: 1,
      viewerCount: 100,
      liveCheckedAt: 1,
    });
    const b = insert({
      displayName: 'B',
      sortOrder: 2,
      isLive: 1,
      viewerCount: 900,
      liveCheckedAt: 1,
    });
    assert.deepEqual(order(), [b, a], '900 人的应当排在 100 人的前面');

    // 交换人数 ⇒ 顺序必须跟着换（否则上面那条只是"按 sort_order 排好看了"）
    getDb().prepare('UPDATE live_channels SET viewer_count = 900 WHERE id = ?').run(a);
    getDb().prepare('UPDATE live_channels SET viewer_count = 100 WHERE id = ?').run(b);
    assert.deepEqual(order(), [a, b], '人数交换之后顺序必须跟着换');
  });

  it('★ 人数为 NULL 的在播行排在"人数为 0"的后面 —— NULL 不是 0', () => {
    /*
     * ⚠️★ 夹具的 `sort_order` 是**故意反着给**的：人数为 NULL 的那一行排在**前面**
     *    （sort_order 1），真的有 0 人的那一行排在后面（sort_order 2）。
     *    这样"把人数 NULL 当成 0 参与排序"（`COALESCE(viewer_count, 0)`）会算出一个
     *    **不同**的顺序（两条并列在 0 ⇒ 落到第三键 sort_order），于是这一条断言才有区分力：
     *    实测见 `.cache/videos-live-round/run-mutations.out.txt` 的 M3。
     *    ⚠️ 第一版把两行的 sort_order 按"0 人在前"给，那一刀切进去**照样绿** ——
     *      一条在该红时不红的断言比没有断言更坏（本仓那条纪律）。
     */
    const none = insert({
      displayName: '在播人数 NULL',
      sortOrder: 1,
      isLive: 1,
      viewerCount: null,
      liveCheckedAt: 1,
    });
    const zero = insert({
      displayName: '在播 0 人',
      sortOrder: 2,
      isLive: 1,
      viewerCount: 0,
      liveCheckedAt: 1,
    });
    const never = insert({ displayName: '从没查过', sortOrder: 3 });
    assert.deepEqual(
      order(),
      [zero, none, never],
      '0 是一个**上游说过的数**（要排在前面），NULL 是"没给"（排在有点数的后面、但仍在其余行之前）',
    );
  });

  it('一个在播的行也没有时，顺序与今天**逐行相同**（回归）', () => {
    const a = insert({ displayName: 'B 名', sortOrder: 100 });
    const b = insert({ displayName: 'A 名', sortOrder: 100 });
    const c = insert({ displayName: 'C 名', sortOrder: 50 });
    assert.deepEqual(order(), [c, b, a], 'sort_order 优先，同序按 display_name（今天的判据）');
  });
});

describe('★ 新排序的可见性：hidden 行仍然只在 manage 里出现', () => {
  it('公开列表不含 hidden；manage 列表含，而且同样按新键排', () => {
    const hidden = insert({
      displayName: '隐藏的',
      status: 'hidden',
      isLive: 1,
      viewerCount: 9999,
      liveCheckedAt: 1,
    });
    const visible = insert({ displayName: '公开的' });
    assert.deepEqual(order(), [visible], '公开列表只出 visible');
    assert.deepEqual(
      listLiveChannels(true).map((channel) => channel.id),
      [hidden, visible],
      'manage 列表含隐藏行，而且隐藏的那一行在播 ⇒ 它排在最前',
    );
  });
});

describe('★ `/api/live` 的三个新字段（NULL 的语义一路传到底）', () => {
  it('is_live / viewer_count / live_checked_at 三列的 NULL 原样变成 null（**不是 false / 不是 0**）', async () => {
    insert({ displayName: '从没查过' });
    insert({ displayName: '问过没在播', isLive: 0, viewerCount: null, liveCheckedAt: 1789000000 });
    insert({ displayName: '在播 42 人', isLive: 1, viewerCount: 42, liveCheckedAt: 1789000001 });

    const response = await app.request('/api/live', { headers: { origin: SITE.productionOrigin } });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      items: Array<{
        displayName: string;
        isLive: boolean | null;
        viewerCount: number | null;
        liveCheckedAt: number | null;
      }>;
    };

    const byName = new Map(body.items.map((item) => [item.displayName, item]));
    assert.equal(
      byName.get('从没查过')?.isLive,
      null,
      'is_live IS NULL ⇒ isLive: null（**不是 false**）',
    );
    assert.equal(byName.get('问过没在播')?.isLive, false, 'is_live = 0 ⇒ false（这次是"问过"）');
    assert.equal(
      byName.get('问过没在播')?.viewerCount,
      null,
      'viewer_count IS NULL ⇒ null（**不是 0**）',
    );
    assert.equal(byName.get('在播 42 人')?.isLive, true);
    assert.equal(byName.get('在播 42 人')?.viewerCount, 42);
    assert.equal(
      byName.get('在播 42 人')?.liveCheckedAt,
      1789000001,
      'liveCheckedAt 是 Unix 秒，原样下发',
    );
    assert.equal(
      body.items[0]?.displayName,
      '在播 42 人',
      '在播的必须排在第一个（这一条同时证明三个字段没有打乱排序）',
    );
    assert.equal(
      response.headers.get('cache-control'),
      'public, max-age=60, stale-while-revalidate=300',
    );
  });
});

describe('★ 写回去的那一层（applyLiveStatus）', () => {
  it('三列一起写，时刻是**Unix 秒**', () => {
    const id = insert({ displayName: 'x' });
    const written = applyLiveStatus([{ id, isLive: 1, viewerCount: 321 }], 1789000002);
    assert.equal(written, 1);
    /*
     * ⚠️ 展开成普通对象再比：`node:sqlite` 的行对象**原型不是 `Object.prototype`**，
     *    而 `deepStrictEqual` 会比较原型 —— 不展开的话两边打印出来一模一样却判不相等
     *    （这一条坑本仓踩过不止一次，见 `live.ts` 里 `toChannel` 的注释）。
     */
    const row = {
      ...(getDb()
        .prepare('SELECT is_live, viewer_count, live_checked_at FROM live_channels WHERE id = ?')
        .get(id) as { is_live: number; viewer_count: number; live_checked_at: number }),
    };
    assert.deepEqual(row, { is_live: 1, viewer_count: 321, live_checked_at: 1789000002 });
  });

  it('"不在播 + 人数 NULL"写得进去（0 与 NULL 是两句不同的话）', () => {
    const id = insert({ displayName: 'x', isLive: 1, viewerCount: 999, liveCheckedAt: 1 });
    applyLiveStatus([{ id, isLive: 0, viewerCount: null }], 1789000003);
    const row = {
      ...(getDb()
        .prepare('SELECT is_live, viewer_count, live_checked_at FROM live_channels WHERE id = ?')
        .get(id) as { is_live: number; viewer_count: number | null; live_checked_at: number }),
    };
    assert.deepEqual(row, { is_live: 0, viewer_count: null, live_checked_at: 1789000003 });
  });

  it('★ 一批里有一行写不进去 ⇒ **整批回滚**（不留"一半是这一轮"的状态）', () => {
    const good = insert({ displayName: 'good', isLive: 1, viewerCount: 1, liveCheckedAt: 1 });
    const bad = insert({ displayName: 'bad' });

    assert.throws(
      () =>
        applyLiveStatus(
          [
            { id: good, isLive: 1, viewerCount: 500 },
            // ⚠️ CHECK (is_live IN (0,1)) —— 3 会被数据库拒绝
            { id: bad, isLive: 3 as unknown as 0 | 1, viewerCount: 1 },
          ],
          1789000004,
        ),
      /CHECK/,
      '越过 CHECK 的取值必须让这一批抛出来（这条断言同时钉住"CHECK 还在"）',
    );

    const after1 = {
      ...(getDb()
        .prepare('SELECT is_live, viewer_count, live_checked_at FROM live_channels WHERE id = ?')
        .get(good) as { is_live: number; viewer_count: number; live_checked_at: number }),
    };
    assert.deepEqual(
      after1,
      { is_live: 1, viewer_count: 1, live_checked_at: 1 },
      '第一行必须原样不动（事务回滚）—— 否则库里会留下"一半是这一轮的时刻"',
    );
  });

  it('空批次什么都不做，而且**不留下打开的事务**（后面的写还能成功）', () => {
    const id = insert({ displayName: 'x' });
    assert.equal(applyLiveStatus([], 1789000005), 0);
    // 事务没关掉的话这一句会报 "cannot start a transaction within a transaction"
    assert.equal(applyLiveStatus([{ id, isLive: 0, viewerCount: null }], 1789000006), 1);
  });
});

describe('★ 编辑改了一行的**身份** ⇒ 那三列必须清回 NULL', () => {
  it('换 handle ⇒ 三列清空（"直播中"不许跟着旧频道跑到新频道上）', () => {
    const id = insert({
      displayName: 'x',
      handle: 'oldname',
      isLive: 1,
      viewerCount: 777,
      liveCheckedAt: 1,
    });
    const result = updateLiveChannel(
      id,
      {
        url: 'https://www.twitch.tv/newname',
        displayName: 'x',
        note: null,
        tags: [],
        embedChannel: false,
        sortOrder: 100,
        platform: 'twitch',
        handle: 'newname',
        liveVideoId: null,
      },
      1789000100,
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      {
        isLive: result.channel.isLive,
        viewerCount: result.channel.viewerCount,
        liveCheckedAt: result.channel.liveCheckedAt,
      },
      { isLive: null, viewerCount: null, liveCheckedAt: null },
      '身份变了 ⇒ 三列回到"从没查过"（下一轮 ≤3 分钟就会补上真话）',
    );
  });

  it('只改名字 / 说明 / 标签 ⇒ 那三列**一个字都不动**', () => {
    const id = insert({
      displayName: 'x',
      handle: 'someone',
      isLive: 1,
      viewerCount: 777,
      liveCheckedAt: 1,
    });
    const result = updateLiveChannel(
      id,
      {
        url: 'https://www.twitch.tv/someone',
        displayName: '改过的名字',
        note: '改过的说明',
        tags: ['ranked'],
        embedChannel: false,
        sortOrder: 100,
        platform: 'twitch',
        handle: 'someone',
        liveVideoId: null,
      },
      1789000101,
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.channel.viewerCount, 777, '身份没变 ⇒ 读数仍然成立，不许抹掉');
    assert.equal(result.channel.liveCheckedAt, 1);
  });
});

describe('★ 采集作业要查哪些行', () => {
  it('只出 visible；三个平台的形状原样带出（形状判断不在这一层）', () => {
    const visible = insert({ displayName: 'v', platform: 'twitch', handle: 'Someone' });
    insert({ displayName: 'h', status: 'hidden', platform: 'twitch', handle: 'Hidden' });
    const bili = insert({ displayName: 'b', platform: 'bilibili', handle: '21452505' });
    const yt = insert({ displayName: 'y', platform: 'youtube', handle: '@Someone' });
    const targets = listLiveStatusTargets();
    assert.deepEqual(
      targets.map((target) => target.id).sort(),
      [visible, bili, yt].sort(),
      'hidden 的行不进这一轮（代价：编辑取消隐藏之后要等下一轮才有标记）',
    );
    assert.deepEqual(
      targets.find((target) => target.id === bili),
      { id: bili, platform: 'bilibili', handle: '21452505' },
    );
  });
});

describe('★ 搜索用的纯函数（filterLiveChannels）', () => {
  const rows = [
    { displayName: 'Someone', tags: ['ranked', '速通'], note: '每天开播' },
    { displayName: 'Another', tags: [], note: null },
  ];

  it('空查询返回全部（而且是**一份新数组**，调用方可以随便改）', () => {
    const out = filterLiveChannels(rows, '   ');
    assert.equal(out.length, 2);
    assert.notEqual(out, rows, '必须是一份新数组（返回入参的话调用方一排序就改了原数据）');
  });

  it('名字 / 标签 / 说明都能命中，且忽略大小写', () => {
    assert.deepEqual(
      filterLiveChannels(rows, 'SOME').map((r) => r.displayName),
      ['Someone'],
    );
    assert.deepEqual(
      filterLiveChannels(rows, '速通').map((r) => r.displayName),
      ['Someone'],
    );
    assert.deepEqual(
      filterLiveChannels(rows, '每天').map((r) => r.displayName),
      ['Someone'],
    );
  });

  it('★ 不搜 handle：搜频道标识搜不到（它在卡片上根本不显示）', () => {
    const withHandle = [{ displayName: 'Someone', tags: [], note: null, handle: 'InvisibleLogin' }];
    assert.deepEqual(
      filterLiveChannels(withHandle, 'InvisibleLogin'),
      [],
      'handle 不在搜索面里 —— 用户看不见的东西不该成为筛选依据（这是**有意的**，不是漏了）',
    );
  });

  it('筛不出东西时返回空数组（页面靠它说"没有匹配的频道"，而不是"还没有收录任何频道"）', () => {
    assert.deepEqual(filterLiveChannels(rows, 'zzzz-no-such-channel'), []);
  });
});

describe('★ 迁移登记（023）', () => {
  it('023_live_status 在登记表里，而且是**最后一条**', () => {
    assert.equal(
      MIGRATION_NAMES.at(-1),
      '023_live_status',
      '不登记 = 不跑，症状是"代码看着对、库里没有那三列"（020/021 两轮都踩过）',
    );
  });
});
