/**
 * `packages/shared/src/tracking.ts` 的**时间单位契约**：`toMillis()`。
 *
 * ===========================================================================
 * ⚠️ 这个文件住在 `services/api` 下，是因为本仓的测试运行器只在这个工作区里
 *    （`packages/shared` 只有 typecheck）—— 与 `live-shares-schema.test.ts`、
 *    `tracking-schema.test.ts` 同一个理由：**共享模块的行为一律在这里被钉住**。
 * ===========================================================================
 *
 * ===========================================================================
 * ★★ 为什么这个函数值得单独一个文件
 * ===========================================================================
 * spec §4 的 ★★ 块（2026-09-16）裁决：`tracked_creators` / `tracked_videos`
 * **整张表一律 Unix 秒**；而本仓其它表和浏览器那一套（`new Date(ms)`）是**毫秒**。
 * ⇒ 这两张表的值一旦不经 `toMillis()` 就渲染，界面会显示 **1970 年** ——
 *   而类型上讲，`number` 进 `new Date()` 完全合法，**编译器一个字都不会说**。
 *   那是"看起来绿的功能其实不动"里最典型的一种，所以这条契约要有测试，
 *   而且两头都要钉：`null` 那一侧（本仓纪律：没有值就是 null，不是 0）与
 *   `0` 那一侧（0 是一个**合法时刻**，不能被当成"没有值"吃掉）。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { toMillis } = await import('@mcsr/shared');
/*
 * 第 9 条（2026-09-19）的那一批取值域 / 预设 / 查询串构造器。
 * ⚠️ 它们**全部**住在 `packages/shared/src/tracking.ts`，而那个包**没有测试运行器**
 *    （它只有 typecheck）⇒ 这个文件是它们唯一的断言执行者。这一节的存在理由与
 *    `toMillis` 那一节逐字相同（文件头的 ★★ 段）。
 */
const {
  TRACKED_SORTS,
  TRACKED_VIDEO_TAGS,
  TRACKED_MAX_DURATION_SEC,
  TRACKED_MAX_TIMESTAMP_SEC,
  TRACKED_DURATION_PRESETS,
  TRACKED_DURATION_PRESET_IDS,
  TRACKED_TIME_RANGES,
  TRACKED_TIME_RANGE_IDS,
  TrackedVideoQuerySchema,
  buildTrackedVideoQuery,
  trackedDurationRange,
  trackedSinceSec,
} = await import('@mcsr/shared');
/** `deriveTags` 是服务端那一侧的实现 —— 标签清单必须与它**同一份**（不是抄一遍）。 */
const { deriveTags } = await import('./tracking/parse');

/** 与 `tracking-schema.test.ts` / `tracking-store.test.ts` 共用的那个"现在"（**秒**）。 */
const NOW = 1_788_600_000;

/*
 * ⚠️ `toMillis` 的返回类型是 `number | null`（那正是 null 那条契约在类型上的样子），
 *    所以每个用例先把它收窄一次再往下用。`assert.ok(x !== null)` 是**断言签名**
 *    （node 的 `ok` 声明是 `asserts value`）⇒ 类型跟着收窄，不用 `as number`
 *    那种把检查绕过去的写法（绕过去就等于这一层没有类型可言）。
 */
function millis(sec: number | null | undefined): number {
  const ms = toMillis(sec);
  assert.ok(ms !== null, `${String(sec)} 是一个有值的秒数，换算不该返回 null`);
  return ms;
}

describe('toMillis：本栏目唯一的"秒 → 毫秒"换算点', () => {
  it('秒 × 1000 ⇒ 毫秒，而且换算出来的真的不是 1970', () => {
    assert.equal(toMillis(NOW), 1_788_600_000_000);
    /*
     * ★ 断言的**理由**，不只是数的形状：不经这个函数渲染会显示 1970。
     *   所以这里把"正确"与"错误"并排钉死 —— 少乘 1000 的那一版（也就是这条契约
     *   存在的全部原因）会落在 1970 年，一眼看得出来是错的。
     */
    assert.equal(new Date(millis(NOW)).toISOString(), '2026-09-05T09:20:00.000Z');
    assert.equal(
      new Date(NOW).getUTCFullYear(),
      1970,
      '裸的秒值喂给 new Date ⇒ 1970 年（这就是 toMillis 必须存在的原因）',
    );
  });

  it('null 与 undefined 一律返回 null（不是 0、也不是 NaN）', () => {
    assert.equal(toMillis(null), null);
    assert.equal(toMillis(undefined), null);
    // 反面控制：要是写成 `sec || 0`，上面两条会变成 0 —— 0 毫秒 = 1970-01-01，
    // 在界面上看起来像一条真实数据（本仓纪律：拿不到就是 null，不许退化成 0）。
    assert.notEqual(toMillis(null), 0);
    assert.notEqual(toMillis(undefined), 0);
    assert.ok(!Number.isNaN(toMillis(null)), 'NaN 渲染出来是 "Invalid Date"，同样是一条假数据');
  });

  it('★ 0 秒**要**换算成 0，不能被当成"没有值"吃掉（两个方向都不许错）', () => {
    /*
     * 反面同样是一条真缺陷：`sec || null` 这种写法会把 0 变成 null ——
     * 而 0 是一个合法的 Unix 时刻（1970-01-01T00:00:00Z）。
     * `TrackedVideo.publishedAt` 那句注释说的"0 只在真的量到 0 时才是数据"，
     * 在这里就是这一条：判断'有没有值'只能看 `== null`，不能看真假。
     */
    assert.equal(toMillis(0), 0);
    assert.equal(new Date(millis(0)).toISOString(), '1970-01-01T00:00:00.000Z');
  });

  it('负数与小数原样 × 1000（不做取整、不做钳制 —— 换算就是换算）', () => {
    // 负数：1970 年之前的时刻（上游理论上给得出来，bilibili 的 created 是秒）。
    assert.equal(toMillis(-1), -1000);
    // 小数：本栏目所有时间列都是 INTEGER（迁移 020），所以这一条只是说明
    // 这个函数**不**替调用方兜底 —— 真出现小数那是上游/库的 bug，不该被这里抹平。
    assert.equal(toMillis(1.5), 1500);
  });

  it('★ `INCREMENTAL_INTERVAL_SEC = 3600` 与它是同一个单位（一处用错的判据）', () => {
    /*
     * 这一条把"两张表的秒"与数据层那个一小时的口径**钉在一起**：
     * `pickDueCreators` 拿 `now - 3600` 与 `last_synced_at` 比，两个都是秒。
     * 若哪天有人把 `last_synced_at` 改成毫秒，`toMillis` 出来的值会变成
     * 1.7e15 那种数（下面第二条断言正是那个形状）—— 界面上仍"能显示"，
     * 只是显示成几万年之后。⇒ 把两边同时钉在 1000 倍的关系上。
     */
    const oneHourLater = NOW + 3600;
    assert.equal(millis(oneHourLater) - millis(NOW), 3600 * 1000, '一小时 = 3600000 毫秒');
    assert.ok(millis(NOW) < 1e13, '秒换算出来的毫秒是 1e12 量级；1e15 量级说明上游那侧已经是毫秒');
  });
});

// ---------------------------------------------------------------------------
// 第 9 条：筛选 / 排序的取值域、预设，以及**查询串的构造**（2026-09-19）
// ---------------------------------------------------------------------------

/**
 * 这一节守的是**界面与服务端之间那条看不见的接线**。
 *
 * ⚠️★ 它值得存在的唯一理由是实测出来的：这个 API **静默忽略未知查询参数**
 *    （2026-09-19 生产实测：`?sort=views` 与不带它逐条相同、`?tag=ranked` 与不带参数
 *    逐字节相同），所以"界面上写错一个参数名"的表现是**什么都不发生** ——
 *    点了下拉框、列表纹丝不动，日志里一行异常都没有。
 *    ⇒ 这里把两个方向都钉住：每个筛选字段都必须真的进查询串，而查出来的**每一个键**
 *      都必须是 schema 认识的键。
 */
describe('第 9 条：筛选与排序的契约（取值域 / 预设 / 查询串）', () => {
  it('★ 标签清单与 `deriveTags` 的产出完全一致（不是抄一遍的三个字符串）', () => {
    /*
     * ⚠️ 这条断言防的是"两处各写一份标签清单"：`deriveTags` 是**产出**标签的地方，
     *    而 `TRACKED_VIDEO_TAGS` 是**筛**标签的地方。产出改了、筛选没改的表现是
     *    "库里有一类视频，而筛那一类的下拉框里没有它"（或者反过来：筛一个永远
     *    筛不出东西的值）。所以这里把 `deriveTags` 真的跑一遍，取几个能覆盖
     *    三条分支的输入（直播回放 / 短片 / 长片 / 既非短片也非长片）。
     */
    const produced = new Set<string>();
    for (const input of [
      { durationSec: null, isLiveReplay: true },
      { durationSec: null, isLiveReplay: false },
      { durationSec: 1, isLiveReplay: false },
      { durationSec: 60, isLiveReplay: true },
      { durationSec: 61, isLiveReplay: false },
      { durationSec: 1199, isLiveReplay: false },
      { durationSec: 1200, isLiveReplay: false },
      { durationSec: 7200, isLiveReplay: true },
    ]) {
      for (const tag of deriveTags(input)) produced.add(tag);
    }
    assert.deepEqual(
      [...produced].sort(),
      [...TRACKED_VIDEO_TAGS].sort(),
      '`deriveTags` 能产出的标签与 `TRACKED_VIDEO_TAGS` 对不上 —— ' +
        '少一个 ⇒ 下拉框里没有那一档（那一类视频筛不出来）；多一个 ⇒ 筛一个永远不会出现的值',
    );
    // 反面控制：探针本身要能发现漂移（把清单临时改掉的那一版会红在上面）
    assert.notDeepEqual([...produced].sort(), [...TRACKED_VIDEO_TAGS, 'liveReplay'].sort());
  });

  it('★★ 四档时长预设**恰好切开** 0…86400：每一秒都落进恰好一档（不重叠、不留缝）', () => {
    /*
     * ⚠️★ 这是这一节最值钱的一条：四档是**闭区间**，边界写成 59 / 299 / 899 还是
     *    60 / 300 / 900 在代码上只差三个数字，而错了的表现**没有任何地方会报错** ——
     *    一支恰好 5 分钟的视频会同时出现在「1–5 分钟」和「5–15 分钟」两个筛选里。
     *    ⇒ 扫一遍整个区间（8.6 万次，毫秒级），每秒必须**恰好**命中一档。
     *    ⚠️ 真扫而不是只测边界：只测边界的话，"中间某两档的空隙"（比如把 5to15 写成
     *       400–899）照样绿，而那一档筛出来的东西就是错的。
     */
    const hits = (sec: number): number =>
      TRACKED_DURATION_PRESETS.filter(
        (row) => sec >= row.minSec && (row.maxSec === null || sec <= row.maxSec),
      ).length;
    const wrong: string[] = [];
    for (let sec = 0; sec <= TRACKED_MAX_DURATION_SEC; sec += 1) {
      const n = hits(sec);
      if (n !== 1) wrong.push(`${String(sec)}s ⇒ 命中 ${String(n)} 档`);
    }
    assert.deepEqual(
      wrong.slice(0, 5),
      [],
      `有四档没切开的地方（共 ${String(wrong.length)} 个秒数）：${wrong.slice(0, 5).join('、')}`,
    );
    // 边界逐个数一次（红的时候一眼看得出是哪个边界）
    assert.deepEqual(
      [59, 60, 299, 300, 899, 900].map(
        (sec) =>
          TRACKED_DURATION_PRESETS.find(
            (row) => sec >= row.minSec && (row.maxSec === null || sec <= row.maxSec),
          )?.id,
      ),
      ['lt1', '1to5', '1to5', '5to15', '5to15', 'gt15'],
      '59/60、299/300、899/900 三对边界必须分别落在相邻的两档里',
    );
    // 最后一档**没有上界**（写成 86400 的话，"24 小时以上"就一条都筛不出来）
    assert.equal(
      TRACKED_DURATION_PRESETS.at(-1)?.maxSec,
      null,
      '最后一档是"15 分钟以上"，它的上界必须是 null（写成数字就是一个真实的上界）',
    );
  });

  it('★ 预设 id → durMin/durMax：「全部」与"认不出的 id"都是**两个都不传**', () => {
    assert.deepEqual(trackedDurationRange('1to5'), { durMin: 60, durMax: 299 });
    assert.deepEqual(trackedDurationRange('lt1'), { durMin: 0, durMax: 59 });
    /*
     * ⚠️ 最后一档**只有 durMin**：多带一个 `durMax` 会让"15 分钟以上"变成一个闭区间。
     *    `deepEqual` 会把那个多出来的键红出来（这正是选它而不是断言两个字段的原因）。
     */
    assert.deepEqual(trackedDurationRange('gt15'), { durMin: 900 });
    /*
     * ⚠️★★ 认不出的 id 与「全部」返回的是**同一个东西**（空对象 = 两个都不传）。
     *    这里**不许**返回 `{ durMin: 0 }` 之类的"退化成某种筛选"：地址栏被改坏时
     *    用户看到的必须是今天那份**不筛时长**的列表（与 `readTrackedPlatform` 把
     *    认不出的分区退化成「全部」是同一条纪律）。
     *    0 在这里是有意义的（`lt1` 的下界就是 0），所以"有没有值"只能看键在不在。
     */
    assert.deepEqual(trackedDurationRange(undefined), {});
    assert.deepEqual(trackedDurationRange('nope' as never), {});
    assert.equal(
      'durMin' in trackedDurationRange(undefined),
      false,
      '「全部」必须是"没有这个键"，不是一个值为 undefined 的键（前者不拼进查询串）',
    );
    // 探针：四个 id 每一个都得认出点什么（清单与实现在一起漂时会红）
    for (const id of TRACKED_DURATION_PRESET_IDS) {
      assert.ok(trackedDurationRange(id).durMin !== undefined, `${id} 是清单里的 id，却查不出区间`);
    }
  });

  it('★ 时间范围预设 → since：天数 × 86400，`nowSec` 由调用方给（这一层不看时钟）', () => {
    const NOW_SEC = 1_788_600_000;
    assert.equal(trackedSinceSec('7d', NOW_SEC), NOW_SEC - 7 * 86400);
    assert.equal(trackedSinceSec('30d', NOW_SEC), NOW_SEC - 30 * 86400);
    assert.equal(trackedSinceSec('1y', NOW_SEC), NOW_SEC - 365 * 86400);
    /*
     * ⚠️ 两个方向都要钉：
     *   · 认不出的 id ⇒ `undefined`（不传 `since` = 不限时间，理由同上一条）；
     *   · 「全部」也走同一条路 —— 界面那一侧因此不需要第二个分支。
     */
    assert.equal(trackedSinceSec(undefined, NOW_SEC), undefined);
    assert.equal(trackedSinceSec('nope' as never, NOW_SEC), undefined);
    // 探针：三档的天数**互不相同**（都写成 7 的话上面三条里会有两条同时成立）
    assert.equal(
      new Set(TRACKED_TIME_RANGES.map((row) => row.days)).size,
      TRACKED_TIME_RANGES.length,
    );
    for (const id of TRACKED_TIME_RANGE_IDS) {
      assert.ok(trackedSinceSec(id, NOW_SEC) !== undefined, `${id} 是清单里的 id，却算不出 since`);
    }
  });

  it('★★ 查询串构造器：每个字段都真的进串，且**没有一个键是 schema 不认识的**', () => {
    /*
     * ★★ 这一条就是"缓存键"那件事的守卫。
     *
     * ⚠️ 这个端点带 `Cache-Control: public, max-age=60`，而**缓存键就是 URL**
     *    （本仓没有任何手写的 cache key：`grep proxy_cache` 零命中，也没有进程内缓存）。
     *    ⇒ 漏拼一个参数 = 两个不同的筛选得到**同一个 URL** ⇒ 它们互相串数据。
     *    症状是"我选了播放量倒序，出来还是刚才那批"，而用户会以为"只是刷新慢"。
     *
     * ⚠️ 方向二（多拼一个 schema 不认识的键）同样致命：服务端**静默忽略**未知参数，
     *    所以 `sortby=views` 会得到一份**看着完全正常**的响应 —— 列表纹丝不动，
     *    而没有任何地方会红。下面两条断言把两个方向都钉住。
     */
    const full = buildTrackedVideoQuery({
      page: 3,
      pageSize: 24,
      platform: 'twitch',
      creatorId: 'c-1',
      tag: 'short',
      durMin: 60,
      durMax: 299,
      since: 1_700_000_000,
      until: 1_700_500_000,
      sort: 'views',
    });
    const keys = [...new URLSearchParams(full).keys()].sort();
    const schemaKeys = Object.keys(TrackedVideoQuerySchema.shape).sort();

    /*
     * ① 每个 schema 键都必须能被拼出来 —— 除了那两个"**不拼默认值**"的：
     *    `page=1` 与 `sort=new`（本仓既定约定：分享出去的地址里不留和默认一样的参数）。
     *    ⚠️ 用 `filter` 精确地把它们排除掉，而不是断言"键集合差不多"：
     *      那两个例外是**枚举出来的**，多一个例外这条断言就会红。
     */
    assert.deepEqual(
      schemaKeys.filter((key) => !['page', 'sort'].includes(key)),
      keys.filter((key) => !['page', 'sort'].includes(key)),
      '查询串的键与 schema 的键对不上 —— 少一个 = 不同筛选共用一条缓存；' +
        '多一个 = 服务端**静默忽略**它（界面看起来正常，筛选其实没生效）',
    );
    // ② 被排除的那两个键在"非默认值"下确实会出现（否则上面那条会以"把它们一起漏掉"的方式通过）
    assert.ok(keys.includes('page'), 'page=3 不是默认值，必须拼进查询串');
    assert.ok(keys.includes('sort'), "sort='views' 不是默认值，必须拼进查询串");
    assert.equal(new URLSearchParams(full).get('pageSize'), '24');
    assert.equal(new URLSearchParams(full).get('sort'), 'views');
    assert.equal(new URLSearchParams(full).get('durMin'), '60');
    assert.equal(new URLSearchParams(full).get('creatorId'), 'c-1');
    assert.equal(new URLSearchParams(full).get('tag'), 'short');
    assert.equal(new URLSearchParams(full).get('since'), '1700000000');
    assert.equal(new URLSearchParams(full).get('platform'), 'twitch');
  });

  it('★ 查询串：默认值不拼、`undefined` 不拼成空值、返回值带问号', () => {
    // 只有必填两项时，`page=1`（默认）不出现
    const minimal = buildTrackedVideoQuery({ page: 1, pageSize: 24 });
    assert.equal(minimal, '?pageSize=24');
    assert.equal(minimal.startsWith('?'), true, '返回值要带问号（调用方直接接在路径后面）');

    /*
     * ⚠️★ "不拼"与"拼一个空值"是两件事：`?tag=` 在服务端是 **400**
     *    （`z.enum` 的封闭枚举里没有空串），而 `?creatorId=` 同样是 400（`min(1)`）。
     *    ⇒ 一个值为 `undefined` 的字段只能**不出现**。
     */
    const withUndefined = buildTrackedVideoQuery({
      page: 1,
      pageSize: 24,
      platform: undefined,
      creatorId: undefined,
      tag: undefined,
      durMin: undefined,
      durMax: undefined,
      since: undefined,
      until: undefined,
      sort: 'new',
    });
    assert.equal(withUndefined, '?pageSize=24', 'undefined 与默认值一律不拼（拼成空值会 400）');
    assert.equal(withUndefined.includes('='), true, '探针：这一串确实有参数（不是"什么都没拼"）');

    /*
     * ⚠️ 反过来：`durMin: 0` 是**合法值**（`lt1` 那一档的下界），必须拼出来 ——
     *    用 `if (input.durMin)` 那种真假判断的写法会把它吃掉，而症状是
     *    "选了「<1 分钟」之后，0–59 秒的视频里那几条 0 秒的不见了"。
     */
    assert.equal(
      buildTrackedVideoQuery({ page: 1, pageSize: 24, durMin: 0 }).includes('durMin=0'),
      true,
      'durMin=0 是一个真实的下界，不许被真假判断吃掉',
    );
  });

  it('★ schema：每个新参数的非法值都 ⇒ 失败（未知参数被静默忽略，所以判据必须在 schema 里）', () => {
    /** 一个参数一个反例 + 同一个参数的合法值（两条一起验，防止"全都拒绝"这种坏法）。 */
    const cases: ReadonlyArray<{ bad: Record<string, string>; good: Record<string, string> }> = [
      { bad: { sort: 'views-desc' }, good: { sort: 'views' } },
      { bad: { sort: '' }, good: { sort: 'new' } },
      // ⚠️ 这一条就是实测抓到的那个例子（生产上 `?tag=ranked` 与不带参数逐字节相同）
      { bad: { tag: 'ranked' }, good: { tag: 'liveReplay' } },
      { bad: { tag: '' }, good: { tag: 'long' } },
      { bad: { creatorId: '' }, good: { creatorId: 'c-1' } },
      { bad: { creatorId: '   ' }, good: { creatorId: 'c-2' } },
      { bad: { durMin: 'abc' }, good: { durMin: '60' } },
      { bad: { durMin: '-1' }, good: { durMin: '0' } },
      {
        bad: { durMax: String(TRACKED_MAX_DURATION_SEC + 1) },
        good: { durMax: String(TRACKED_MAX_DURATION_SEC) },
      },
      { bad: { durMax: '1.5' }, good: { durMax: '59' } },
      { bad: { since: 'abc' }, good: { since: '0' } },
      { bad: { until: '-5' }, good: { until: '1700000000' } },
      // ⚠️★ 毫秒写进秒的位置：没有上界时它会变成一份**空列表**（看起来像"这段时间没有视频"）
      {
        bad: { since: String(Date.now()) },
        good: { since: String(Math.floor(Date.now() / 1000)) },
      },
      { bad: { durMin: '900', durMax: '60' }, good: { durMin: '60', durMax: '900' } },
      { bad: { since: '200', until: '100' }, good: { since: '100', until: '200' } },
    ];
    for (const { bad, good } of cases) {
      const failed = TrackedVideoQuerySchema.safeParse(bad);
      assert.equal(
        failed.success,
        false,
        `${JSON.stringify(bad)} 必须**被拒**（未知/非法参数被静默忽略，所以判据只能在这里）`,
      );
      assert.equal(
        TrackedVideoQuerySchema.safeParse(good).success,
        true,
        `${JSON.stringify(good)} 是合法值，不该被拒 —— 否则上面那条只是"什么都拒绝"`,
      );
    }
    // 一个合法的组合：区间两端相等也是闭区间的一部分（`durMin === durMax` 是"恰好这么多秒"）
    assert.equal(
      TrackedVideoQuerySchema.safeParse({ durMin: '60', durMax: '60' }).success,
      true,
      '闭区间的两端相等（60…60）是合法的 —— 反了才该被拒',
    );
  });

  it('★ `TRACKED_MAX_TIMESTAMP_SEC` 必须远在任何真实发布时间之后（否则它会拒掉合法请求）', () => {
    /*
     * ⚠️ 这个上界唯一的作用是把**单位错误**（毫秒）变成 400；它一旦小于真实的
     *    Unix 秒值，正常的时间筛选就会 400 —— 而那种红会出现在用户那里，
     *    不是在这里。所以钉两条：它远大于"今天"，而且今天确实在它下面。
     */
    const nowSec = Math.floor(Date.now() / 1000);
    assert.ok(
      TRACKED_MAX_TIMESTAMP_SEC > nowSec,
      `上界（${String(TRACKED_MAX_TIMESTAMP_SEC)}）必须在"现在"（${String(nowSec)}）之后`,
    );
    assert.ok(
      TRACKED_MAX_TIMESTAMP_SEC - nowSec > 50 * 365 * 86400,
      '上界要留出**至少 50 年**的余量：一个"刚好够用"的界会在某一天开始拒绝合法请求，' +
        '而那种红会出现在用户那里，不是在这里',
    );
    assert.ok(
      TRACKED_MAX_TIMESTAMP_SEC <= 9_999_999_999,
      '10 位以内 ⇒ 毫秒（今天约 1.7e12）一定落在它外面，这正是这个界存在的理由',
    );
  });

  it('★ 排序键的取值域只有两个（多一个就要同时改数据层的 `ORDER BY`）', () => {
    assert.deepEqual([...TRACKED_SORTS], ['new', 'views']);
  });
});
