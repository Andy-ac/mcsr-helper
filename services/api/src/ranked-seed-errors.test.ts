/**
 * 「种子库里没有这一场」那条判据的测试（`apps/web/src/lib/seedErrors.ts` 的 `describeSeedQueryError`）。
 *
 * ===========================================================================
 * 为什么它住在 `services/api`（而不是 `apps/web`）
 * ===========================================================================
 * `apps/web` **没有测试运行器**（本仓只有 `node --import tsx --test` 这一套）⇒ 跨包读
 * `apps/web/src/lib/*` 是 `ranked-direct.test.ts` 立下的先例，本文件照它写。
 *
 * ===========================================================================
 * ★★ 它守的是什么：一条**常态**被报成**故障**的那类错
 * ===========================================================================
 * 种子库只覆盖约 **80%** 的比赛（`services/api/src/routes/seeds.ts` 的 404 与
 * `docs/ranked-live-spec.md` §3.2 都写着）⇒ "这场比赛的种子不在库里"是**常态**，
 * 而"这一次没读到"是**故障**：两者的下一步**相反**（一个别再点了，一个值得再点一次）。
 *
 * ⚠️★ 判据**只能靠状态码**：`fetchSeedByMatchId` 走的是 `lib/api.ts` 的公共 `request()`，
 *    而它**不读响应体**（`api.ts` 那一大段逐字写着为什么、以及"让所有 GET 都读体"
 *    这个方案为什么被否决过）⇒ **所有 GET** 的 `ApiError.code` 恒为 `undefined`。
 *    种子这条读路径上"不在库里"的**唯一**回答就是 **404**（`routes/seeds.ts` 那两条 404
 *    都是同一件事），所以 `seedErrors.ts` 把 `status === 404` 补进了那条判据。
 *
 * ⚠️★★ **这条判据今天没有别的家**：`apps/web` 没有测试运行器、渲染自检（`rankedrender.tsx`）
 *    喂的是**已经算好的状态**（`seeds: { … }`），容器读 `window.location` 在 Node 里渲染不了
 *    ⇒ 少了本文件，`status === 404` 那一行被删掉时**全仓没有任何东西会红**，
 *    而界面上只是把 20% 的常态说成了一句假话（"种子暂时读不到。"）。
 *    ⚠️ 这也正是 T1 报告 §5 决策 3 把它记成"没有自动化判据"的那一件事 —— 本文件就是补上的那一条。
 *
 * ===========================================================================
 * ⚠️★ 两个不走寻常路的写法，各自的**理由与代价**（照本仓"注释要说为什么"的规矩）
 * ===========================================================================
 * 1. **`@/` 这个别名在这里由本文件自己接**（`registerHooks`，见下面那一段）。
 *    `seedErrors.ts` 里那一句 `import { ApiError } from '@/lib/api'` 用的是 web 的
 *    `tsconfig.json` 才有的别名，而 `services/api/tsconfig.json` **故意没有**它：
 *    加上它之后 `tsc -p services/api/tsconfig.json` 会顺着那句 import 把
 *    `apps/web/src/lib/api.ts` **整个拉进 api 这个项目**，而那个文件用的是 DOM 的
 *    `RequestCache`（api 的 `lib` 是 `["ES2023"]`）⇒ 实测**五条类型错**，与这次改动无关。
 *    ⚠️ 把 `"DOM"` 加进 api 的 `lib` 是**更坏**的修法（一个 Node 服务不该有 DOM 类型）。
 *    ⚠️ 影响面：本 hook 只接管 `@/` 开头的 specifier（`services/api` 里没有别的东西用它），
 *    而且它只活在**跑这一个测试文件的进程**里（`node --test` 每个文件一个子进程）。
 *    ⚠️★ **`registerHooks()` 要 Node ≥ 22.15**（nodejs.org 的 `module` 文档：**Added in: v22.15.0**，
 *    Customization Hooks 的历史表也写着 “v22.15.0 Add support for synchronous and in-thread hooks”）。
 *    这就是根 `package.json` 的 `engines` 从 `>=22` 提到 `>=22.15` 的**唯一**理由
 *    （2026-09-19 复评 M10；理由也写在那个文件的 `//engines` 里）—— 在 22.0–22.14 上
 *    整个 api 测试套件会在 import 那一刻红成 `registerHooks is not a function`，
 *    而那条错误指向本文件、不指向 node 版本。
 * 2. **两条 import 的路径是"算出来"的**（不是字面量）：TypeScript 只对**字面量**
 *    specifier 做模块解析 ⇒ 非字面量的动态 import 拿到的是 `any`，**不会**把
 *    `apps/web/src/lib/*` 拖进 `services/api` 这个项目的类型检查（上面那五条错就是这么来的）。
 *    ⚠️★ 代价写清：本文件里对 `seedErrors` 的**签名没有类型检查**（下面用两份手写的
 *    接口把形状记下来）—— 判据仍然在，它是**运行期**的断言，而那也正是它存在的理由。
 *    ⚠️ 也**不许**改成字面量：那会让整个 api 项目的 typecheck 当场红
 *    （不是这个测试红 —— 是**每一个** `pnpm -w check` 都红）。
 *
 * ⚠️ 本文件**绝不出真实网络**：两个方向都把出口堵死了 —— 多数用例只构造 `ApiError` 再调一个
 *    纯函数；而"读路径上的 `code` 恒为 `undefined`"那一条走**真的** `fetchSeedByMatchId()`，
 *    但 `globalThis.fetch` 已被换成桩（照 `ranked.test.ts` 的 `mockUpstream`），
 *    桩还会数调用次数（"那一发真的发出去了"本身是判据）。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** `apps/web/src` 的绝对路径（本文件在 `services/api/src/` ⇒ 从它往上三级是仓库根）。 */
const WEB_SRC = fileURLToPath(new URL('../../../apps/web/src/', import.meta.url));

/*
 * ⚠️★ 必须在下面那两条 import **之前**注册（它们是动态的，所以这里的顺序就是执行顺序）。
 * ⚠️ 解析要自己带扩展名：这是**同步**的 resolve hook，`shortCircuit: true` 之后
 *    tsx 那一步"补 `.ts`"的兜底就轮不到了 ⇒ 不带扩展名会 ENOENT（实测过一次）。
 * ⚠️ 映射不到时**当场抛**：静默回落会让下面那些断言在"另一个模块"上跑。
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('@/')) return nextResolve(specifier, context);
    const base = path.join(WEB_SRC, specifier.slice(2));
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
      if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
    throw new Error(`ranked-seed-errors.test.ts：映射不到 \`${specifier}\`（见文件头第 1 条）`);
  },
});

/* ⚠️ 路径写成**变量**：见文件头第 2 条（字面量会把 web 的源码拖进这个项目的 typecheck）。 */
const SEED_ERRORS_PATH = '../../../apps/web/src/lib/seedErrors';
const API_PATH = '../../../apps/web/src/lib/api';

/** `describeSeedQueryError` 的结果形状（手写一份：跨包那一头没有类型检查）。 */
interface SeedQueryFailure {
  kind: 'not_found' | 'no_match' | 'unavailable' | 'rate_limited' | 'field' | 'other';
  message: string;
  hint?: string;
}
const { describeSeedQueryError } = (await import(SEED_ERRORS_PATH)) as {
  describeSeedQueryError: (
    error: unknown,
    t: (key: string, options?: Record<string, unknown>) => string,
    fallback: (error: unknown) => string,
    context: 'search' | 'lookup',
    fallbackMin?: number,
  ) => SeedQueryFailure;
};
const { ApiError, fetchSeedByMatchId } = (await import(API_PATH)) as {
  ApiError: new (
    message: string,
    status: number,
    code?: string,
  ) => Error & {
    status: number;
    code?: string;
  };
  fetchSeedByMatchId: (
    matchId: number,
    signal?: AbortSignal,
  ) => Promise<{ seed: unknown; cached: boolean }>;
};

/**
 * 存根翻译器：回 `[key]`。
 *
 * ⚠️ 判据是 `kind`（调用方选下一步靠的就是它），文案由词条给 —— 所以这里把 key 原样
 *    露出来，谁改走了哪一条分支一眼看得出（`ranked-shared.test.ts` 的桩同形）。
 */
const t = (key: string): string => `[${key}]`;

/** 调用方给的兜底（`useApiErrorText()` 的结果）—— 一个哨兵，好断言"确实走了兜底那条路"。 */
const fallback = (): string => 'FALLBACK';

/** 一条读路径上的 `ApiError`（**没有** code：见文件头，这是那条路的真实形状）。 */
const getError = (status: number): InstanceType<typeof ApiError> =>
  new ApiError(`HTTP ${String(status)}`, status);

describe('describeSeedQueryError：404 ⇒ not_found（按状态码，不按错误码）', () => {
  it('★★ 探针：真正的**读路径**上 `ApiError.code` 恒为 `undefined`（即使响应体里带着一个码）', async (t) => {
    /*
     * ⚠️★ 这一条**必须**走真的读函数（`fetchSeedByMatchId` → `lib/api.ts` 的 `request()`），
     *    而且**桩掉 `fetch`**（照 `ranked.test.ts` 的 `mockUpstream` 先例）——
     *    它原来是自己 `new ApiError(…, 404)` 再断言 `code === undefined`，
     *    那断的是**构造器的性质**（构造器当然不会凭空造一个码出来），`request()` 哪天
     *    改成读错误体（一次跨切面改动，`api.ts:310` 那一段写着它为什么被否决），
     *    那条探针**照样绿** —— 一条不可能红的守卫（本仓 §5.63）。
     * ⚠️★ 桩回来的响应体**逐字**照服务端那条 404 写（`routes/seeds.ts` 的
     *    `{"error":"seed_not_found"}`）：这正是"我方的状态码判据是不是还站得住"要问的东西 ——
     *    体里有一个码，而这条读路径**不读它**。
     * ⚠️ 本文件其余用例仍然自己构造 `ApiError`：它们问的是"给定这样一个错误，
     *    `describeSeedQueryError` 怎么分档"，而这个**形状**由本用例钉住。
     */
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: 'seed_not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    });
    let caught: unknown = null;
    try {
      /* ⚠️ 这个 id 谁都不碰（桩不发真实请求）：随便挑一个真实存在的比赛 id，形如 13304815 */
      await fetchSeedByMatchId(13_304_815);
    } catch (error) {
      caught = error;
    }
    assert.equal(calls, 1, '★ 探针：那一发真的发出去了（不是自己构造的 `ApiError`）');
    assert.ok(caught instanceof ApiError, '★ 探针：404 抛的是 `ApiError`（这条读路径的形状）');
    assert.equal(caught.status, 404, '★ 而状态码是真的在那儿（唯一的判据就建立在它上面）');
    assert.equal(
      caught.code,
      undefined,
      '读路径的 `ApiError` 带上了 `code`（响应体里的 `error` 被读进来了）⇒ 本文件守的那条判据（按状态码）已经不是真实形状了，回去读 `api.ts` 那一段',
    );
  });

  it('★★★ 404 ⇒ `kind: not_found` —— "这场比赛的种子不在库里"是**常态**，不是故障', () => {
    const failure = describeSeedQueryError(getError(404), t, fallback, 'lookup');
    assert.equal(
      failure.kind,
      'not_found',
      '一个 404（约 20% 的比赛就是它）没有映射成 `not_found` ⇒ 界面上会把它说成「种子暂时读不到。」（一句假话，而且用户会对着一个永远查不到的 id 反复点）',
    );
    assert.notEqual(
      failure.message,
      'FALLBACK',
      '★ 而且走的是 `seed_not_found` 那一条分支（不是 default 那条兜底）',
    );
  });

  it('★★★ 反方向：其它状态码**不许**被映射成 `not_found`（它们说的是"值得再试一次"）', () => {
    /*
     * ⚠️★ 判据写成"**不**等于 `not_found`"而不是"等于 `other`"：`api.ts` 哪天开始读
     *    错误体（那是一次跨切面改动），429 会变成 `rate_limited`、502 会变成
     *    `seed_service_unavailable` —— 那些都是**更准**的结果，不该让这一条无谓地红。
     *    这一条要守的是"**别把故障说成常态**"，也就是**这一个不等号**。
     */
    for (const status of [400, 401, 403, 429, 500, 502, 503]) {
      const failure = describeSeedQueryError(getError(status), t, fallback, 'lookup');
      assert.notEqual(
        failure.kind,
        'not_found',
        `HTTP ${String(status)} 被映射成了 \`not_found\`（把"这一次没读到"说成"库里没有这一场" ⇒ 用户永远等不到它出现，也不会再点一次）`,
      );
    }
  });

  it('★★ 错误码**优先于**状态码：404 上带了一个真的码时，那个码说了算', () => {
    /*
     * ⚠️ 这一条钉的是 `error.code ?? (…status === 404…)` 那个 `??` 的**方向**：
     *    写成"不看 code"的话，一个"404 但意思是别的"的响应会被吞进 `not_found`。
     *    今天读路径上没有这种端点 —— 而正因为没有，写反了不会有任何现象
     *    （这一个用例就是那个"以后"的护栏）。
     */
    const failure = describeSeedQueryError(
      new ApiError('bad input', 404, 'invalid_input'),
      t,
      fallback,
      'lookup',
    );
    assert.notEqual(
      failure.kind,
      'not_found',
      '信封里明明有一个码（`invalid_input`），却被状态码 404 抢走了判据 —— 那是"同一个状态码下有两种含义"被硬判成了一档',
    );
  });

  it('★ 不是 `ApiError` 的东西（网络层抛的 TypeError）⇒ 走调用方给的那一句兜底', () => {
    const failure = describeSeedQueryError(new TypeError('fetch failed'), t, fallback, 'lookup');
    assert.equal(failure.kind, 'other', '★ 不是 ApiError ⇒ 连状态码都没有 ⇒ 只能交给兜底');
    assert.equal(failure.message, 'FALLBACK', '★ 而兜底那一句是调用方给的（不是这里编的）');
  });

  it('★★ 调用方真正用的那一格：这两档的 `kind` **必须不同**（同一个属性开两个不同的画面）', () => {
    /*
     * ⚠️★ 这是"两种处境"最直白的形式：容器（`routes/Ranked.tsx` 的 `toggleSeed`）只认
     *    `failure.kind === 'not_found'`，其余一律 `failed`（可重试）。两档同值时，
     *    界面上只剩一句话，而**没有任何门禁看得出来**它说错了哪一半。
     */
    const notFound = describeSeedQueryError(getError(404), t, fallback, 'lookup');
    const unavailable = describeSeedQueryError(getError(503), t, fallback, 'lookup');
    assert.notEqual(
      notFound.kind,
      unavailable.kind,
      '两档的 kind 一样 ⇒ 界面上那两句不同的话里有一句永远不会出现',
    );
  });
});

describe('调用点只有一处判据：`routes/Ranked.tsx` 不许自己再写一遍"什么算 not_found"', () => {
  /*
   * ⚠️★ 为什么这条源码级守卫也要有（判据"只有一处"这件事本身的判据）：
   *    映射写对了一半、调用点又自己写了一遍 `status === 404`，两份判据就会漂 ——
   *    而漂掉之后**两处都还是绿的**（每一处单独看都对）。本仓对这类"两份会漂的真相"
   *    有过记录（`weeklySeed` 那条重复词条就是同一条取舍的来由）。
   * ⚠️★ 判据作用在**剥掉注释**的源码上：那个文件里那段注释**逐字写着**
   *    「这里**不许**再写一遍 `status === 404` 或 `code === 'seed_not_found'` 的分支」
   *    ⇒ 不剥注释的话，这一条会被那段说明本身满足（`formPreventsDefault` 踩过同一个坑）。
   * ⚠️ 代价写清：哪一天有人**真的**需要在那一处再判一次状态码，这一条会红 ——
   *    那是**对的**（那种改动要么把判据搬回 `seedErrors.ts`，要么显式改掉这一条）。
   */
  const source = readFileSync(
    new URL('../../../apps/web/src/routes/Ranked.tsx', import.meta.url),
    'utf8',
  );
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('★ 探针：注释真的被剥掉了（那段说明里逐字带着要禁的那两种写法）', () => {
    assert.notEqual(stripped, source, '★ 探针：剥注释那一步真的做了（否则下面两条判据是空跑）');
    assert.ok(
      /status\s*===\s*404/.test(source),
      '★ 探针：**原文**里确实有 `status === 404`（注释里那一句）—— 剥掉它之后下面那条才有区分力',
    );
    assert.equal(
      /status\s*===\s*404/.test(stripped),
      false,
      '★★ 而**代码**（非注释）里一个 `status === 404` 都没有：那一档由 `seedErrors.ts` 一处判',
    );
  });

  it("★★ 那一处调的是 `describeSeedQueryError`，而且只按 `kind === 'not_found'` 分岔", () => {
    assert.ok(
      /describeSeedQueryError\(/.test(stripped),
      '★★ 第四格状态（种子）的失败分类没有走 `describeSeedQueryError` ⇒ 判据变成了两份',
    );
    assert.ok(
      /kind\s*===\s*'not_found'/.test(stripped),
      "★★ 而它是按 `kind === 'not_found'` 分岔的（按 `status` / `message` 分岔会让那两档漂）",
    );
    assert.equal(
      /'seed_not_found'/.test(stripped),
      false,
      '★★ 调用点自己写了一遍错误码判据 ⇒ 与 `seedErrors.ts` 那一处会漂，而漂掉之后两处都还是绿的',
    );
  });
});
