/**
 * 适配器**注册表** —— CLI（T6）与路由（T5）从这里拿适配器，不直接 import 某个平台。
 *
 * ===========================================================================
 * ⚠️ 为什么这个文件在 T3 就建了（计划把它排在 T8，那是错的）
 * ===========================================================================
 * T6 的 CLI 第一行就要 `import { adapterFor, platformStatus } from './tracking'`，
 * 而 T6 在 T8 **之前**落地。注册表放到 T8，T6 那个 commit 就**编译不过**
 * （本仓 `-w check` 会红），也就是说 T6 会被迫在 CLI 里写一份临时注册表，
 * 而 T8 再把那份临时表删掉 —— 两次改动、两份真相。
 * ⇒ T3 建它并把 YouTube / Twitch 的**占位**定死，T8 只把占位换成真适配器
 *   （**签名一个都没动**：`adapterFor` / `platformStatus` 的形状是 T3 定的，
 *   `RunDeps.adapters` / `RunDeps.platformStatus` 就是照它们写的）。
 *
 * ===========================================================================
 * ★ 三个平台都是真适配器了；凭据仍然有可能一个都没有
 * ===========================================================================
 * · `bilibili` —— **不需要任何凭据**（spec §2.7：这正是它先跑通整条流水线的原因），
 *   所以它的状态恒为 `'ok'`；
 * · `youtube` / `twitch` —— 凭据在**环境变量**里（`MCSR_YOUTUBE_KEY` /
 *   `MCSR_TWITCH_ID` + `MCSR_TWITCH_SECRET`）。**没配就跳过并打印原因**（spec §9.1 ⑧），
 *   不是崩：`adapterFor` 抛 `NoCredentialsError`、`platformStatus()` 报
 *   `'skipped:no-credentials'`，CLI 按**状态**跳过整个平台（一行日志，不是 40 条失败记录）。
 *
 * ★ 凭据是**每次调用现读** `process.env`，不是模块加载时读一次：
 *   · CLI 一次运行读一次也完全够（它开头就问 `platformStatus()`）；
 *   · 而"进程启动时读一次"会让**测试无法控制它**（`import` 发生在任何 `process.env`
 *     赋值之前），于是那几条"没凭据要跳过、配了要能用"的断言只能靠**真的去配环境**
 *     —— 那就是"测试绿不绿取决于开发机"，本仓不这么干。
 *   · 代价：一次 `process.env` 查询 ×3 个平台 ×每次调用（可忽略）。
 *
 * ===========================================================================
 * ★★ 适配器按**凭据**缓存：这是 Twitch "进程内缓存 token" 成立的前提
 * ===========================================================================
 * CLI 是**每个 creator** 要一次适配器（`track.ts` 的 `runOnce` 就在循环里），
 * 而 Twitch 的 app access token 缓存在**实例**上（§5.3："进程内缓存"）。
 * ⇒ 每次都新建实例的话，20 个博主就是每轮 20 次换 token —— 功能"看起来是对的"，
 *   只是每轮多打 20 次上游，而日志上完全看不出来。
 *
 * ⚠️ 键**必须含凭据本身**（不是只按平台缓存一个）：密钥轮换之后复用旧实例，
 *    表现是"拿着旧 client id 换来的 token 去打新客户端" ⇒ 满屏 401，
 *    而代码看起来完全正常。⇒ 凭据变了就重建（代价：轮换时多一个对象）。
 *
 * ===========================================================================
 * ⚠️ 调用方的顺序：先 `platformStatus()`，再 `adapterFor()`
 * ===========================================================================
 * 标着 `'skipped:no-credentials'` 的平台**别去要适配器** —— 那条路会抛。
 * CLI 也可以选择"照拿不误 + 抓 `NoCredentialsError`"（两者等价，因为抛出来的正是那个
 * 专用类型），但先看状态更直白：它是**常量**，一次调用就知道三个平台各自能不能用，
 * 而 `adapterFor` 一次只回答一个。
 */
import type { TrackPlatform } from '@mcsr/shared';

import { bilibiliAdapter } from './bilibili';
import { createTwitchAdapter, createTwitchTokenSource, type TwitchTokenSource } from './twitch';
import { NoCredentialsError, type PlatformAdapter } from './types';
import { createYouTubeAdapter } from './youtube';

/** 一个平台这一轮的状态。`'failed'` **不在这里** —— 那是运行结果，归 T6 的 `RunSummary`。 */
export type PlatformStatus = 'ok' | 'skipped:no-credentials';

/**
 * 三个平台各需要哪些环境变量（spec §10 冻结表的"凭据环境变量"那一行逐字）。
 *
 * ⚠️ bilibili 是空数组 —— **它不是"还没配"，是"不需要"**（spec §2.7：只有 bilibili
 *    不需要凭据，这正是它先跑通整条流水线的原因）。这两件事在日志里必须分开，
 *    所以没有凭据时我们不打印"缺少：（无）"，而是根本不会为 bilibili 走到那条路
 *    （`bilibiliAdapter` 是真的，不需要检查）。
 */
const REQUIRED_ENV: Record<TrackPlatform, readonly string[]> = {
  bilibili: [],
  youtube: ['MCSR_YOUTUBE_KEY'],
  twitch: ['MCSR_TWITCH_ID', 'MCSR_TWITCH_SECRET'],
};

const YOUTUBE_KEY_ENV = 'MCSR_YOUTUBE_KEY';
const TWITCH_ID_ENV = 'MCSR_TWITCH_ID';
const TWITCH_SECRET_ENV = 'MCSR_TWITCH_SECRET';

/**
 * 一个环境变量算不算"配了"。
 *
 * ⚠️ **空值算没配**：`MCSR_YOUTUBE_KEY=`（systemd 的 `Environment=FOO=`、或 `.env` 里的空值）
 *    与"没配"在运维眼里是同一件事，而在代码里是两件事 —— 当成"配了"会让每一个请求
 *    带着一个空 key 去打上游，得到一堆 401/403（"抓取失败"），而不是一句
 *    `platformStatus() = skipped:no-credentials`（"跳过并打印原因"，spec §9.1 ⑧）。
 * ⚠️ 值本身**不 trim**：尾随空格是一个**配置错误**，让它在上游那里响亮地失败
 *    （401/403 进 journal，一眼能看出 key 不对），比我们替它猜干净更诚实 ——
 *    后者在"密钥本身以空格结尾"那种形状下会把一个能用的密钥悄悄改坏。
 */
function envValue(name: string): string | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return null;
  return raw;
}

function hasYouTubeKey(): boolean {
  return envValue(YOUTUBE_KEY_ENV) !== null;
}

function hasTwitchCredentials(): boolean {
  return envValue(TWITCH_ID_ENV) !== null && envValue(TWITCH_SECRET_ENV) !== null;
}

/**
 * 已经建好的实例：`platform → (凭据键, 适配器)`。
 *
 * ⚠️ 只留**最后一个**（不是一张按凭据展开的表）：凭据在进程内不会来回变
 *    （变了就是一次轮换），而"留最后一个"顺手把旧实例（连同它缓存的旧 token）
 *    从内存里放掉了。
 * ⚠️ 键里含 client secret —— 它只活在这个进程的内存里，而 `process.env` 里本来就有一份。
 *    这里**不**把它打印、也不进任何错误信息。
 */
const adapterCache = new Map<TrackPlatform, { credentialKey: string; adapter: PlatformAdapter }>();

function cachedAdapter(
  platform: TrackPlatform,
  credentialKey: string,
  build: () => PlatformAdapter,
): PlatformAdapter {
  const hit = adapterCache.get(platform);
  if (hit !== undefined && hit.credentialKey === credentialKey) return hit.adapter;

  const adapter = build();
  adapterCache.set(platform, { credentialKey, adapter });
  return adapter;
}

/**
 * 拿一个平台的适配器。**没凭据的平台抛 `NoCredentialsError`**（不是返回 null）。
 *
 * ⚠️ 为什么抛而不是返回 `null`：返回 null 会让每个调用方各写一段
 *    `if (!adapter) …`，而漏写的那一处表现为**一个 TypeError**（"Cannot read properties of
 *    null"）—— 日志里那和"接口变了"分不开。抛一个专用类型则相反：CLI 按类型就能把
 *    整个平台报成 `'skipped:no-credentials'`（spec §9.1 ⑧ 要的就是这个）。
 */
export function adapterFor(platform: TrackPlatform): PlatformAdapter {
  switch (platform) {
    case 'bilibili':
      return bilibiliAdapter;

    case 'youtube': {
      const apiKey = envValue(YOUTUBE_KEY_ENV);
      if (apiKey === null) throw new NoCredentialsError('youtube', REQUIRED_ENV.youtube);
      /*
       * ⚠️ 构造它**不发任何请求**（key 进的是每一次请求的查询串，没有"连接"这一步）——
       *    与 bilibili 那个模块级 `const` 同一个性质：import 时不会打网络。
       */
      return cachedAdapter('youtube', apiKey, () => createYouTubeAdapter({ apiKey }));
    }

    case 'twitch': {
      const clientId = envValue(TWITCH_ID_ENV);
      const clientSecret = envValue(TWITCH_SECRET_ENV);
      if (clientId === null || clientSecret === null) {
        throw new NoCredentialsError('twitch', REQUIRED_ENV.twitch);
      }
      /*
       * ⚠️ 构造它也不发请求：换 token 是第一次真的要用的时候才做的（`appToken()`），
       *    所以 `import` 这个模块不会打网络 —— 这一点对测试同样重要。
       */
      return cachedAdapter('twitch', `${clientId}\u0000${clientSecret}`, () =>
        createTwitchAdapter({ clientId, clientSecret }),
      );
    }

    default:
      /*
       * 类型上够不着（`TrackPlatform` 只有三个值），但数据库的 `CHECK (platform IN (...))`
       * 与这里的两份列表是**两处**，而它们的同步靠人。真出现第四个平台时，
       * 这里给一句能读的话，而不是 `undefined.platform`。
       */
      throw new Error(`未知平台：${String(platform)}（TRACK_PLATFORMS 改了但注册表没跟上？）`);
  }
}

/**
 * 三个平台这一轮各自能不能用（spec §6.3 的运行摘要里那一行）。
 *
 * ⚠️ 每次**现算**（读一遍环境变量），不是读一个模块级常量：
 *    · 它因此天生就是**一份新对象** —— 调用方改它不会影响下一次调用
 *      （T3 的注释里写着这条，那时它靠"返回一份拷贝"实现；现在它是算出来的，同样成立，
 *      `tracking-platforms.test.ts` 那条断言两种实现都钉得住）。
 *    · 三个键**逐个写出来**（`Record<TrackPlatform, …>`）：以后往 `TRACK_PLATFORMS`
 *      加第四个平台时，这里会**编译不过**（少一个键），而不是运行时静默返回 `undefined`
 *      再被当成"能跑"。
 */
export function platformStatus(): Record<TrackPlatform, PlatformStatus> {
  return {
    bilibili: 'ok',
    youtube: hasYouTubeKey() ? 'ok' : 'skipped:no-credentials',
    twitch: hasTwitchCredentials() ? 'ok' : 'skipped:no-credentials',
  };
}

/**
 * ★ Twitch 的凭据 + token 源 —— 给**第二个**要用 Twitch 凭据的作业
 * （`live-status.ts`：每 3 分钟查一轮「谁在播、多少人看」，走 `helix/streams`）。
 *
 * ---------------------------------------------------------------------------
 * 为什么它在这里，而不在 `live-status.ts` 里自己读环境变量
 * ---------------------------------------------------------------------------
 * 凭据的**读法**（变量名 + "空值算没配" + "值本身不 trim"）只有这一份，
 * 就在这上面那几行里。第二个作业要是自己复制一份 `process.env.MCSR_TWITCH_ID`，
 * 两份会漂移 —— 而漂移的症状是"某个作业把空 key 当成配好了，然后满屏 401"
 * （`envValue` 的注释逐字写着这件事）。
 * ⚠️ 返回里同时给 `clientId`：`helix` 的请求头 `Client-Id` 就是它，
 *    而"从环境变量里读它"这件事同样只该有一个地方（与 `adapterFor('twitch')` 同源）。
 *
 * ⚠️ **没有凭据时返回 `null`，不抛**（与 `adapterFor` 不同）：调用方是 oneshot 作业，
 *    它要做的动作是"把 twitch 这一平台记成 skipped、继续跑别的平台"，而不是中断整轮。
 *    状态那一栏仍然去看 `platformStatus().twitch`，两者是同一个判据（同一个 `envValue`）。
 *
 * ⚠️ 这里**不做实例缓存**（`cachedAdapter` 那一套用不上）：作业是 oneshot，
 *    一次运行里自己拿着这一个源调若干批，缓存的意义在"实例内只换一次 token"，
 *    而那由 `createTwitchTokenSource` 的 Promise 缓存保证（文件头第一节）。
 *    代价：同一个进程里若同时用 API 侧的 `adapterFor('twitch')` 与这里，
 *    会有**两个** token（各一次换 token 调用）。今天不存在这种进程。
 */
export function twitchCredentialsFromEnv(): { clientId: string; tokens: TwitchTokenSource } | null {
  const clientId = envValue(TWITCH_ID_ENV);
  const clientSecret = envValue(TWITCH_SECRET_ENV);
  if (clientId === null || clientSecret === null) return null;
  return { clientId, tokens: createTwitchTokenSource({ clientId, clientSecret }) };
}
