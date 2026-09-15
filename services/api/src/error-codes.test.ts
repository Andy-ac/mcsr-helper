/**
 * 错误码契约：**服务端返回的每个 code，前端都有人处理**。
 *
 * ---------------------------------------------------------------------------
 * 这个测试来自一个真实的、而且很难发现的 bug
 * ---------------------------------------------------------------------------
 * 服务端返回的是：
 *
 *     return c.json({ error: 'url_exists', ... }, 409)
 *
 * 而前端写的是：
 *
 *     case 'duplicate_url': ...
 *
 * 名字对不上 → 匹配不上任何分支 → 掉进兜底文案「出错了，请稍后再试。」。
 * 于是"这个链接已经收录过了"（一个完全正常、可操作的结果）在界面上
 * 显示成了"服务器出错了"，用户唯一的反应是再点一次提交、然后再失败一次。
 *
 * ---------------------------------------------------------------------------
 * 为什么单元测试和接口测试都抓不到它
 * ---------------------------------------------------------------------------
 *   · **类型检查**：两边都是 string，没有任何类型关系可以检查；
 *   · **接口测试**：它断言的是"服务端返回 409 + code 是 url_exists" ——
 *     这是对的，也是它该测的。至于**前端认不认这个名字**，接口测试看不见；
 *   · **界面测试**：只有真的手动提交一个重复链接才会出现。
 *
 * 所以需要一条**跨层**的测试：把服务端真正会返回的 code 集合，和前端
 * 真正处理了的 code 集合对起来。这个文件就是它。
 *
 * ⚠️ 它的设计要点：`KNOWN_CODES` 是一份**显式清单**，而测试同时验证
 *    "源码里扫描出来的 code ⊆ 清单"。于是**新加一个错误码就会红**，
 *    逼加的人当场决定"界面要怎么显示它" —— 而不是等三个月后
 *    有人看着一个红框来问"这是什么意思"。
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const SRC = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = join(SRC, '..', '..', '..');

/**
 * 服务端**可能**返回的全部错误码。
 *
 * ⚠️ 加新码时同时要做的两件事（这个测试会强制你想一遍）：
 *   1. 加到这里；
 *   2. 决定界面显示什么 —— 要么在前端某个映射里加一个 case，
 *      要么加到下面的 INTENTIONALLY_GENERIC 里并写明理由。
 */
const KNOWN_CODES: readonly string[] = [
  // ---- 认证 ----
  'account_suspended',
  'invalid_credentials',
  'invalid_token',
  'send_failed',
  'email_not_verified',
  'unauthorized',
  // ---- 通用 ----
  'invalid_input',
  'invalid_query',
  'not_found',
  'rate_limited',
  'internal_error',
  'cross_origin_rejected',
  // ---- 内容提交 ----
  'url_exists',
  'video_exists',
  'already_pending',
  'forbidden',
  // ---- 图片上传（`error: result.reason` 这种写法扫描扫不到，所以只能列出来）----
  'too_large',
  'not_an_image',
  'empty',
  'no_file',
  // ---- 审核 ----
  'self_review',
  'nothing_pending',
  'unknown_type',
  // ---- 账号治理 ----
  'last_admin',
  /** 不能改其他管理员的角色（管理员之间平级） */
  'admin_peer',
  /** 管理员不能降级自己 */
  'admin_self',
  /** 管理员不能把别人升成管理员 */
  'admin_promote',
  /** owner 不可触碰（两个方向都不行） */
  'owner_immutable',
  // ---- 内容治理 ----
  'invalid_state',
  // ---- Ranked Seeds 代理（M4）----
  /** 上游没有这条 matchId（上游只覆盖约 80%，这是**常态**，不是错误） */
  'seed_not_found',
  /** 上游说这条 matchId 已经录过了（409） */
  'seed_exists',
  /** 上游超时 / 不可达 / 5xx / 上游限流 */
  'seed_service_unavailable',
  /** 写接口被运维开关关掉了（MCSR_SEED_WRITE_DISABLED） */
  'seed_write_disabled',
  // ---- 直播频道清单 ----
  /**
   * 同一个平台下同一个频道已经记过了（409）。
   *
   * ⚠️ 这是这份清单**最常见**的正常结果（同一个主播被两个人加），
   *    所以它必须有一条能操作的文案 —— 走 apiErrorText，
   *    理由和 video_exists 完全一样：登记成"某个页面自己处理"
   *    就等于把一个还没做的事写成做完了。
   */
  'live_exists',
  // ---- 实时分享（live shares）----
  /**
   * 额度用尽：seed 已经有 20 条在展示（发布时拒），或者恢复一条时看板上还有另一条
   * （room / seed 都会拒）。
   *
   * ⚠️ 它是一个**独立的码**，不是 `invalid_state` 的一种（spec §4.2 / §13）：
   *    界面上那句话与别的失败完全不同（"先下架一条再加"，不是"操作失败了"）。
   *    把它并回 `invalid_state` 的话，前端唯一能拿到的东西是 `reason`，
   *    而它落不进任何一条文案分支 —— 用户看到的就是兜底那句。
   */
  'at_limit',
];

/**
 * ───────────────────────────────────────────────────────────────────────────
 * `reason` 词表 —— 错误码下面**那一层**的跨层契约
 * ───────────────────────────────────────────────────────────────────────────
 * Ranked Seeds 的字段级错误走的是 `{ error: 'invalid_input', reason: '...' }`：
 * 一个通用错误码 + 一个**机器可读**的 reason。理由见 routes/seeds.ts 的说明
 * （"字段级校验不该各发明一个错误码"）—— 15 种入参错误各来一个码，会让上面
 * 那张 KNOWN_CODES 表变成一份没人看得完的清单。
 *
 * ⚠️ 但那个决定有代价，而且代价正好落在**这个文件**上：上面的扫描器只认
 *    `error: 'xxx'`，看不见 `reason: 'xxx'`。也就是说 reason 这一层
 *    **逃出了跨层契约测试的覆盖范围**。
 *
 *    而这正是这个文件存在的原因所指的那类 bug（服务端 `url_exists` vs
 *    前端 `duplicate_url`）往下沉了一层之后的样子：
 *      · 服务端改一个 reason 的名字 → 前端那条分支永远不会命中
 *      · 前端按错误的 reason 分组 → 红字出现在**另一个输入框**下面
 *    两种都不报错，测试也不会红 —— 除非有人把两份对起来看。下面就是那个"对一次"。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 这份清单**只覆盖 Ranked Seeds**，不是全站的 reason 词汇表
 * ---------------------------------------------------------------------------
 * `reason` 这个字段名在别的模块里也在用，而且**各说各的**：
 *   · uploads  —— `too_large` / `not_an_image` / `empty` / `no_file`
 *   · marks    —— `bad_marks`
 *   · moderation —— `not_published` / `nothing_to_change`
 *   · resources —— `duplicate` / `already` / `invalid`
 * 所以"全站 reason 必须在一张表里"是**做不到也不该做**的：它们是各自模块
 * 内部的字段级说明，不是一份全局协议。
 *
 * 这里只收 `/api/ranked-seeds/*` 那三条路由会吐出来的 reason，因为**只有它
 * 需要前端按 reason 定位控件**（种子表单有六个字段，把红字全堆在表单底部
 * 等于让用户自己找）。别的模块的 reason 值不归这里管。
 *
 * ⚠️ 扫描范围因此必须跟着收窄（见 serverReasonsFromSource）。
 *    放过整个 services/api 会把上面那些别的模块的 reason 一起扫进来，
 *    而它们加进来只会让这张表失去意义 —— 一张"什么都有"的清单等于没有清单。
 */
const SEED_REASONS: readonly string[] = [
  // ---- 筛选参数（/search 与 /random）----
  /** variations / without 超过 512 字符 */
  'filter_too_long',
  /** variations / without 里有词条语法之外的字符（多半是有人在拿它做别的事） */
  'filter_bad_chars',
  /** 筛选里出现了 `end_spawn:*` —— 上游那个词条有 bug，**只拒筛选不拒结果** */
  'end_spawn_unsupported',
  /** overworld 取值不在词表里（400 时带 allowed 列表，界面可以直接渲染成选项） */
  'bad_overworld',
  /** nether 同上 */
  'bad_nether',
  /** completion 不是合理的毫秒数（400 时带 maxMs） */
  'bad_completion',
  /** 筛选参数被发到了 /random —— 那是**接错端点**，不是忽略一下就行 */
  'use_search_endpoint',

  // ---- matchId（两个端点的下界不同，所以 400 时带 min）----
  'bad_match_id',

  // ---- 补录（/save）----
  /** 请求体不是一个对象 */
  'body_not_object',
  'bad_overworld_seed',
  'bad_nether_seed',
  'bad_the_end_seed',
  'bad_match_date',

  /*
   * ---- 上游说"这次一条都没命中"（404，不是错误）----
   *
   * ⚠️ 它和 `seed_not_found`（"这条 matchId 不在库里"）**共用同一个错误码**，
   *    靠这个 reason 区分。两者的下一步完全不同：
   *      · 没 reason → 这条比赛不在库里，可以**补录**（/save）
   *      · no_match  → 是**条件**太窄了，该放宽条件
   *    界面要据此显示不同的话和不同的按钮。
   */
  'no_match',
];

/**
 * 故意走通用文案的码 —— 每一条都要有理由。
 *
 * 这里的每一行都是一个判断："这个失败**没有**比'出错了'更有用的说法，
 * 或者它压根不在用户能触发的那条路径上"。
 */
const INTENTIONALLY_GENERIC: Record<string, string> = {
  internal_error: '真的出错了，兜底文案就是准确的说法',
  invalid_query: '只可能来自 GET 列表的查询参数，用户碰不到',
  last_admin: '账号管理页会显示"不能降级最后一个管理员"（见 AdminUsers.tsx）',
  admin_peer: '账号管理页会说明"其他管理员的角色不能改"，并提前把选择框禁掉',
  admin_self: '账号管理页会说明"管理员不能降级自己"',
  admin_promote: '账号管理页会说明"管理员不能把别人升成管理员"',
  owner_immutable: '账号管理页会说明"涉及 owner 的角色只能在服务器上改"',
  nothing_pending: '审核页对 409 有自己的处理（"已经被另一位审核员处理了"）',
  self_review: '审核页会**提前**把批准按钮禁掉并说明原因（见 useCanSelfReview）',
  unknown_type: '审核页对未知类型有自己的处理',
  no_file: '上传控件自己处理（它知道是哪个输入框出的问题）',
  too_large: '上传控件自己处理（能给出具体的 MB 上限）',
  not_an_image: '上传控件自己处理',
  empty: '上传控件自己处理',
  // auth.tsx 的 apiErrorText 处理了这些 —— 它们在"通用失败"里已经说清楚了
  account_suspended: 'apiErrorText',
  invalid_credentials: 'apiErrorText',
  invalid_token: 'apiErrorText',
  send_failed: 'apiErrorText',
  email_not_verified: 'apiErrorText + 提交页也有专门的提示',
  unauthorized: 'apiErrorText + 提交页有专门的"会话过期"提示',
  invalid_input: 'apiErrorText（字段级错误由表单逐字段显示）',
  rate_limited: 'apiErrorText（会带上还要等多少秒）',
  not_found: '提交页/编辑页各自有更准确的说法',
  already_pending: '提交页有专门提示',
  forbidden: '提交页有专门提示',
  url_exists: '提交页有三种不同的说法（已上架 / 自己没上架 / 别人没上架）',
  /*
   * 视频墙的"这个视频已经有人贴过了"。
   *
   * ⚠️ 它**必须**有一条真实的界面文案，不能登记成"某个页面自己处理"就完事 ——
   *    那条路径现在还不存在，登记成已处理等于把一个还没做的事写成做完了。
   *    所以走 apiErrorText（见 apps/web/src/lib/auth.tsx 的 case）。
   */
  video_exists: 'apiErrorText（"这个视频已经在站上了"）',
  cross_origin_rejected: '提交页有专门提示',
  invalid_state: '治理条自己显示通用失败提示（"这条内容现在的状态不允许这个操作"）',
  /*
   * ---- Ranked Seeds（M4）----
   *
   * ⚠️ 这四条**不是**"没有更好的说法"，而是"更好的说法还没写出来"：
   *    /seeds 页面（种子检索 + 补录表单）还没有做，所以现在没有任何前端
   *    映射能处理它们。登记在这里是**有意的妥协** —— 契约测试至少会逼着
   *    下一个人看见它们，而不是让服务端静静地返回一个谁都不认识的 code。
   *
   * ⚠️ Ranked Seeds 的四个码**已接进 apiErrorText**（2026-09-12 晚），所以从这里移走了。
   *    当初登记在这里是对的（那时 /seeds 页面确实不存在），但留着会让下一个人
   *    以为它们仍然没有文案 —— 而"待办清单里的东西其实做完了"和
   *    "以为做完了其实没做"一样有害，只是方向相反。
   */
  /*
   * ---- 实时分享（live shares）----
   *
   * ⚠️ 它与上面 Ranked Seeds 当初那四条是同一个处境 —— 但**已经有界面了**
   *    （2026-09-15 Task 7 落地了看板页 `/shares/room` 与 `/shares/seed`），
   *    所以这里说的**不是**"待办"：界面用的是这个栏目**自己**的词条，
   *    而这个码本来就不该有通用文案（理由见下）。
   *
   * ⚠️ 它**不能**走 `apiErrorText`：这个码要说的是"你在展示的已经满了，先下架一条"，
   *    与通用的"操作失败了"是两回事，而词条已经冻结（spec §8 的
   *    `shares.atLimitSeeds` / `shares.atLimitRestore`）—— 那两句话要由**看板页**
   *    自己渲染，因为它才拿得到 `limit` 与"我发的那几条"（通用映射两样都没有）。
   */
  at_limit:
    '界面用的是这个栏目自己的词条（shares.atLimitSeeds / shares.atLimitRestore），不走通用映射',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full) && !full.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/**
 * 去掉注释再扫。
 *
 * ⚠️ 这一条是血泪：这个文件自己在注释里写了
 *     `前端：case 'duplicate_url': ...`（作为那个 bug 的说明），
 *    而扫描器把它当成了一条真实分支，于是报了一个**假**问题。
 *    一道会误报的防线比没有防线更糟 —— 人会很快学会忽略它。
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 服务端源码里字面量写出来的 `error: 'xxx'`。 */
function serverCodesFromSource(): Set<string> {
  const found = new Set<string>();
  for (const file of walk(join(SRC))) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(/error:\s*'([a-z_]+)'/g)) found.add(m[1] as string);
  }
  return found;
}

/**
 * Ranked Seeds 那两条路由/适配层里写出来的 `reason`。
 *
 * ⚠️ **扫描范围刻意收窄到这两个文件**，理由见上面 SEED_REASONS 的说明：
 *    `reason` 这个名字在别的模块里也在用（uploads / marks / moderation /
 *    resources），放开整个 src 会把它们一起扫进来，而它们是各自模块内部的
 *    字段级说明、不归这张表管。
 *
 * 两种写法都要扫，因为代码里两处都用了：
 *   · `{ ok: false, reason: 'filter_too_long' }` —— 解析函数直接返回
 *   · `invalidInput(c, 'bad_match_id', …)`      —— 路由吐响应
 * 只扫前一种会漏掉半张表，而漏掉的那半张恰恰是路由直接返回的那些。
 */
const SEED_SOURCES = ['routes/seeds.ts', 'seeds/upstream.ts'];

function serverReasonsFromSource(): Set<string> {
  const found = new Set<string>();
  for (const rel of SEED_SOURCES) {
    const src = stripComments(readFileSync(join(SRC, rel), 'utf8'));
    for (const m of src.matchAll(/reason:\s*'([a-z_]+)'/g)) found.add(m[1] as string);
    for (const m of src.matchAll(/invalidInput\(\s*c\s*,\s*'([a-z_]+)'/g))
      found.add(m[1] as string);
  }
  return found;
}

/** 前端两个错误映射里 `case 'xxx':` 处理过的码。 */
function clientHandledCodes(): Set<string> {
  const found = new Set<string>();

  // submissionErrors.ts 整个文件就是一个 switch，直接扫
  const subErrors = stripComments(
    readFileSync(join(REPO, 'apps', 'web', 'src', 'lib', 'submissionErrors.ts'), 'utf8'),
  );
  for (const m of subErrors.matchAll(/case\s+'([a-z_]+)':/g)) found.add(m[1] as string);

  /*
   * ⚠️ auth.tsx 里有**两套** switch，不能整个文件扫：
   *   · `fieldIssueText` 处理的是 **Zod 的 issue code**（invalid_string、
   *     too_small…）—— 那是字段级校验，和这里的 API 错误码是两回事；
   *   · `apiErrorText` 才是处理 API 错误码的那个。
   * 第一版直接扫了整个文件，于是把 `invalid_string` 之类当成了"前端在处理
   * 服务端从不返回的码"，报了一堆假问题 —— 一道会误报的防线比没有防线更糟，
   * 因为人很快就会学会忽略它。
   */
  const auth = stripComments(
    readFileSync(join(REPO, 'apps', 'web', 'src', 'lib', 'auth.tsx'), 'utf8'),
  );
  const start = auth.indexOf('export function apiErrorText');
  const end = auth.indexOf('export function useApiErrorText');
  assert.ok(start >= 0 && end > start, 'apiErrorText 的边界找不到了，扫描逻辑需要更新');
  for (const m of auth.slice(start, end).matchAll(/case\s+'([a-z_]+)':/g)) {
    found.add(m[1] as string);
  }

  return found;
}

describe('★ 错误码契约（服务端 ↔ 前端）', () => {
  it('服务端返回的每个 code 都在显式清单里', () => {
    const fromSource = serverCodesFromSource();
    const missing = [...fromSource].filter((c) => !KNOWN_CODES.includes(c)).sort();

    assert.deepEqual(
      missing,
      [],
      `服务端出现了清单里没有的错误码：${missing.join(', ')}。\n` +
        '请把它加进 KNOWN_CODES，并决定界面要怎么显示它 —— ' +
        '不加的话，用户看到的会是兜底的「出错了，请稍后再试。」。',
    );
  });

  it('清单里的每个 code 都确有其人，没有过期的死条目', () => {
    const fromSource = serverCodesFromSource();
    // 上传那几个是 `error: result.reason` 拼出来的，扫描看不见，所以豁免
    const UNSCANNABLE = [
      // 上传那几个是 `error: result.reason` 拼出来的
      'too_large',
      'not_an_image',
      'empty',
      'no_file',
      /*
       * 改角色的几个是 `error: judgement.reason` —— 码来自
       * shared/permissions.ts 的 `RoleChangeDenial` **联合类型**。
       * 它比"源码里扫到字面量"更严格：加一个新原因而不处理，编译就报错。
       * （扫描器看不见动态值，所以这里豁免；豁免的理由是"有更强的保障"。）
       */
      'admin_self',
      'admin_promote',
      'admin_peer',
      'owner_immutable',
    ];
    const gone = KNOWN_CODES.filter((c) => !fromSource.has(c) && !UNSCANNABLE.includes(c)).sort();

    assert.deepEqual(
      gone,
      [],
      `清单里有服务端已经不再返回的码：${gone.join(', ')}。\n` +
        '留着它们会让下一个人以为这条分支还有用。',
    );
  });

  it('每个 code 都有人处理，或者是**显式**选择了通用文案', () => {
    const handled = clientHandledCodes();
    const orphans = KNOWN_CODES.filter(
      (c) => !handled.has(c) && !(c in INTENTIONALLY_GENERIC),
    ).sort();

    assert.deepEqual(
      orphans,
      [],
      `这些码既没有前端映射，也没有在 INTENTIONALLY_GENERIC 里写明理由：${orphans.join(', ')}`,
    );
  });

  it('前端映射里的码都是真实存在的（没有认错名字的分支）', () => {
    /*
     * ★ 这一条正是那个 bug 的直接守卫：
     *   前端 `case 'duplicate_url'` 而服务端返回 `url_exists` ——
     *   一个永远匹配不上的分支，看起来像有处理，实际上什么都没有。
     */
    const handled = clientHandledCodes();
    const wrong = [...handled].filter((c) => !KNOWN_CODES.includes(c)).sort();

    assert.deepEqual(
      wrong,
      [],
      `前端在处理服务端**从不返回**的码：${wrong.join(', ')}。\n` +
        '这多半是服务端改过名字而前端没跟上 —— 那条分支实际上永远不会命中。',
    );
  });

  // -------------------------------------------------------------------------
  // 下面两条守的是 `reason` 那一层 —— 见 KNOWN_REASONS 上面的说明
  // -------------------------------------------------------------------------

  it('服务端返回的每个 reason 都在显式清单里', () => {
    const fromSource = serverReasonsFromSource();
    const missing = [...fromSource].filter((r) => !SEED_REASONS.includes(r)).sort();

    assert.deepEqual(
      missing,
      [],
      `Ranked Seeds 出现了清单里没有的 reason：${missing.join(', ')}。\n` +
        '请把它加进 SEED_REASONS，并决定界面把这条红字放在哪个控件下面 —— ' +
        '不加的话，前端只能退回到"整张表单下面显示一句通用错误"。',
    );
  });

  it('清单里的每个 reason 都确有其人，没有过期的死条目', () => {
    const fromSource = serverReasonsFromSource();
    const gone = SEED_REASONS.filter((r) => !fromSource.has(r)).sort();

    assert.deepEqual(
      gone,
      [],
      `清单里有 Ranked Seeds 已经不再返回的 reason：${gone.join(', ')}。\n` +
        '留着它们会让下一个人以为前端还要处理这条分支。',
    );
  });
});
