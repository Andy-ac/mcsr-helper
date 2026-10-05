/**
 * 抓目录 + 上游解析 —— 从 `mod-folders.ts` **原样搬出来**的（Task 6；切法是 2026-10-03 复审
 * 给的那一份：`mod-folder-catalog.ts` = 抓取 + 上游）。
 *
 * ===========================================================================
 * 这一份负责什么
 * ===========================================================================
 *   · `queueLoadCatalog` —— 抓 `/api/mod-catalog`（超时、失败分类、坏 JSON 分开）；
 *   · `resolveUpstream` —— 把 `upstream != null` 的 mod 的**上游最新版**解析出来
 *     （spec §7.2 / D1；抓不到就**不放进 map**，目标退回目录里那条候选）；
 *   · 那五格状态（目录 / 索引 / 状态 / 错误 / 上游 map）住在这里，外面**只读**。
 *
 * ===========================================================================
 * 两条纪律（搬过来之后一条都没变）
 * ===========================================================================
 *   ① **拉失败时保留上一次成功的目录**（spec §8）：只换 `catalogStatus` / `catalogError`
 *      —— 清空的表现是"整个第一部分凭空消失"；
 *   ② 抓取是**串行**的（`loadQueue`）：启动那一路与手动的 `rescan()` 都会来拉，
 *      并发 fetch 同一个 425 KB 端点除了浪费带宽什么也换不到，而且**后一次覆盖前一次**
 *      ⇒ "启动时读到的是哪一份"会取决于谁先回来。
 *
 * ===========================================================================
 * 与 `mod-folders.ts` 的方向：**单向**（它 import 我，我 import 它 = 错）
 * ===========================================================================
 * ⇒ 两个外部依赖由 `initCatalog` **注入**（基址 / user-agent 来自 `main.ts` 那一份；
 *   notice 往上走）。反向 import 会成环，而 ESM 的环在初始化顺序上会咬人。
 * 代价（认）：本模块多一个"必须先 `initCatalog`"的前提 —— 没 init 时 `queueLoadCatalog`
 *   会抛"模块还没初始化"（**不会**静默地抓一个错地址）。
 */
import { type ModrinthVersion, primaryFileOf } from '@mcsr/shared/fileUpdates';
import {
  buildIndex,
  type ModCatalog,
  type ModEntry,
  type ModIndex,
  type ModRelease,
  parseModCatalogWire,
  pickLatestUpstreamVersion,
  releasesFor,
  upstreamChannelsOf,
} from '@mcsr/shared/modCatalog';
import { fetchVersions, messageOf } from './file-updates';

/**
 * 抓目录的超时（15 秒）。
 *
 * ⚠️ v1 那条 `fetchCatalogFromSite` 没有超时（它用 ETag + 条件请求，而断网时
 * `fetch` 自己会失败）。这一条**故意带超时**：`/api/mod-catalog` 是 425 KB 的目录，
 * 一个半死的连接会把"目录不可用"拖到 TCP 自己超时（几十秒），而页面上那段时间
 * 什么都没有。超时之后走的是同一条"保留上次缓存 + 说明原因"的路。
 */
const CATALOG_TIMEOUT_MS = 15_000;

/**
 * 上游（Modrinth）那一侧的固定一格：这一期的 mod 全是 Fabric。
 *
 * ⚠️★ **通道（`channel`）不在这里** —— 它随每一条 `upstream` 走（`upstream.channels`，
 *    缺省 = 只认 `release`）：draftout 的最新版只发 beta，只认 release 会一个版本都匹配不上。
 *    规则与挑选实现住在 `@mcsr/shared/modCatalog` 的 `upstreamChannelsOf` /
 *    `pickLatestUpstreamVersion`（那边能用单元测试钉住，"更新的 beta 赢过更旧的 release"
 *    这条判据必须能红）。
 */
const UPSTREAM_LOADER = 'fabric';

interface CatalogDeps {
  siteOrigin: string;
  userAgent: string;
}

let deps: CatalogDeps | null = null;
let onNotice: (text: string) => void = () => {};

/** 接上依赖与"说明往哪走"（见文件头那段：不这么做就成环）。 */
export function initCatalog(opts: {
  siteOrigin: string;
  userAgent: string;
  notice: (text: string) => void;
}): void {
  deps = { siteOrigin: opts.siteOrigin, userAgent: opts.userAgent };
  onNotice = opts.notice;
}

/**
 * 目录（**最后一次成功的读数**）与它的状态。
 *
 * ⚠️ 拉失败时**保留**上一次成功的目录（spec §8 的"保留上次缓存"，与 v1 同一条决定），
 *    只把 `catalogStatus` / `catalogError` 换掉 —— 清空的表现是"整个第一部分凭空消失"。
 */
let catalog: ModCatalog | null = null;
let catalogIndex: ModIndex | null = null;
let catalogStatus: 'ok' | 'unavailable' | 'invalid' = 'unavailable';
let catalogError: string | null = null;

/** 上游解析结果（**键 = modid**，T1 的 `upstreamLatest`）。抓不到就不放进来 —— 见 `resolveUpstream`。 */
let upstreamLatest: ReadonlyMap<string, ModRelease> = new Map();

// ---------------------------------------------------------------------------
// 只读访问口（外面不许直接改这几格：写它们的只有下面那两条路）
// ---------------------------------------------------------------------------

/** 最后一次成功的目录（`null` = 一次都没拉到）。 */
export function catalogOf(): ModCatalog | null {
  return catalog;
}

/** 目录的索引（`null` = 还没拉到）—— 调用的判据是"入参要在目录里查得到"。 */
export function catalogIndexOf(): ModIndex | null {
  return catalogIndex;
}

export function catalogStatusOf(): 'ok' | 'unavailable' | 'invalid' {
  return catalogStatus;
}

export function catalogErrorOf(): string | null {
  return catalogError;
}

export function upstreamLatestOf(): ReadonlyMap<string, ModRelease> {
  return upstreamLatest;
}

// ---------------------------------------------------------------------------
// 抓目录（`/api/mod-catalog`）
// ---------------------------------------------------------------------------

function setCatalogFailure(status: 'unavailable' | 'invalid', message: string): void {
  catalogStatus = status;
  catalogError = message;
}

function requireDeps(): CatalogDeps {
  if (deps === null) throw new Error('模块还没初始化');
  return deps;
}

async function loadCatalog(): Promise<void> {
  const d = requireDeps();
  const url = new URL('/api/mod-catalog', d.siteOrigin).toString();
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': d.userAgent },
      // 超时（见 CATALOG_TIMEOUT_MS）。**不要 ETag**：这条端点每次都要重新校验，
      // 而"上次那份还能不能用"是服务端的事（它每次返回 200 的完整体）。
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    });
    if (!res.ok) {
      /*
       * 失败**分类**（brief：要能区分 404 / 500 / 坏 JSON）：
       *   · 404 ⇒ 这条端点在服务器上不存在（部署漏了？）—— 与 500 分开说，因为修法不同；
       *   · 5xx ⇒ 服务端读不出/解析不了那份目录，响应体里带 `catalog_*` 机器码与 `problems`
       *     （复用 v1 那三个码，见 `services/api/src/routes/modCatalog.ts`）⇒ 原样带给用户。
       */
      let detail = '';
      try {
        const body = (await res.json()) as { error?: unknown; problems?: unknown };
        const code = typeof body.error === 'string' ? body.error : '';
        const problems = Array.isArray(body.problems)
          ? body.problems.filter((p): p is string => typeof p === 'string').join('；')
          : '';
        detail = [code, problems].filter((s) => s !== '').join(' —— ');
      } catch {
        /* 响应体不是 JSON：下面只说状态码 */
      }
      const suffix = detail === '' ? '' : `（${detail}）`;
      setCatalogFailure(
        'unavailable',
        res.status === 404
          ? `目录不可用：服务器上没有这条端点（HTTP 404）${suffix}`
          : `目录拉取失败：服务器 HTTP ${String(res.status)}${suffix}`,
      );
      return;
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch (error) {
      setCatalogFailure('invalid', `目录的响应体不是合法 JSON：${messageOf(error)}`);
      return;
    }
    const parsed = parseModCatalogWire(body);
    if (!parsed.ok) {
      // 不合契约 ⇒ `invalid`（与"拉不到"分开：这一条是"服务器给了东西，但东西不对"）
      setCatalogFailure(
        'invalid',
        `目录不合契约：${parsed.problems.slice(0, 3).join('；')}${parsed.problems.length > 3 ? ' …' : ''}`,
      );
      return;
    }
    catalog = parsed.catalog;
    catalogIndex = buildIndex(parsed.catalog);
    catalogStatus = 'ok';
    catalogError = null;
    await resolveUpstream(parsed.catalog);
  } catch (error) {
    // 断网 / 超时 / DNS：保留上一次成功的目录（见 `catalog` 的注释）
    setCatalogFailure('unavailable', `目录拉取失败：${messageOf(error)}`);
  }
}

/**
 * 把抓目录串起来（**同一时刻只有一次在跑**）。
 *
 * ⚠️ 启动那一路（`startUp`）与手动的 `rescan()` 都会来拉目录，而"两次并发 fetch 同一个
 * 425 KB 端点"除了浪费带宽什么也换不到 —— 更重要的是**后一次的结果会覆盖前一次**，
 * 于是"启动时那次读到的目录"取决于谁先回来。⇒ 用一条串行队列把顺序固定下来。
 */
let loadQueue: Promise<void> = Promise.resolve();

export function queueLoadCatalog(): Promise<void> {
  const next = loadQueue.then(
    () => loadCatalog(),
    () => loadCatalog(),
  );
  loadQueue = next.catch(() => undefined);
  return next;
}

// ---------------------------------------------------------------------------
// 上游解析（spec §7.2 / D1）—— 抓不到就**不放进 map**
// ---------------------------------------------------------------------------

/** 一条上游 release 与另一条是不是同一条（判据 = 字节 + 版本号 + 地址）。 */
function sameRelease(a: ModRelease, b: ModRelease): boolean {
  return a.version === b.version && a.url === b.url && a.sha512 === b.sha512;
}

/**
 * 把一条 Modrinth 版本**收窄**成目录里那种 `ModRelease`。
 *
 * ⚠️ 任何一格对不上契约（没有主文件 / 哈希形状不对 / size 不是非负整数 / 一个游戏版本都没有）
 *    一律 `null` ⇒ 调用方**把这一条从 map 里去掉**（brief：抓不到 / 契约不符 ⇒ 不放进 map，
 *    不是抛错）。方向是安全的：目标退回目录里那条候选，而"只有 `older` 进批量"
 *    保证这仍然是安全的（界面不会因此报错）。
 * ⚠️ `download: 'auto'` 是**这个地方**的判断：上游那一条是能直接下的字节
 *    （`manual` 在目录里表示"只给打开原网页"，而 Modrinth 的版本没有这个概念）。
 */
function upstreamRelease(mod: ModEntry, version: ModrinthVersion): ModRelease | null {
  const file = primaryFileOf(version);
  if (file === null) return null;
  const sha512 = file.hashes.sha512;
  const sha1 = file.hashes.sha1;
  if (typeof sha512 !== 'string' || !/^[0-9a-f]{128}$/.test(sha512)) return null;
  if (typeof sha1 !== 'string' || !/^[0-9a-f]{40}$/.test(sha1)) return null;
  if (!Number.isInteger(file.size) || file.size < 0) return null;
  if (version.game_versions.length === 0) return null;
  if (typeof version.version_number !== 'string' || version.version_number === '') return null;
  return {
    modid: mod.modid,
    version: version.version_number,
    url: file.url,
    sha1,
    sha512,
    size: file.size,
    targetVersions: [...version.game_versions],
    dependencies: [],
    obsolete: false,
    intermediary: [],
    download: 'auto',
  };
}

/**
 * 这个 mod 的哪些游戏版本**可能**用到上游。
 *
 * ⚠️★ 判据是"判定层会不会去问上游"，而那是 `resolveTarget` 的事（T1）：
 *    上游**只在目录在这一版下恰好一条候选时**才参与（Ruling 17）⇒ 0 条或多候选的游戏版本
 *    根本不会用到 `upstreamLatest`，把它们算进来只会让"多个版本必须一致"这条判据
 *    因为无关的版本而失败。
 */
function upstreamGameVersions(c: ModCatalog, index: ModIndex, modid: string): string[] {
  const versions = new Set<string>();
  for (const release of c.releases) {
    if (release.modid !== modid) continue;
    for (const gameVersion of release.targetVersions) {
      if (releasesFor(index, modid, gameVersion).length === 1) versions.add(gameVersion);
    }
  }
  return [...versions].sort();
}

/**
 * 抓所有 `upstream != null` 的 mod 的上游最新版。
 *
 * ⚠️★ **map 只按 `modid` 键控**（T1 的 `upstreamLatest`），而"最新版"是**按游戏版本**解析的
 *    ⇒ 一个 mod 在多个游戏版本上各有一条唯一候选时，同一个 modid 会有多个候选目标。
 *    这里的态度是：**所有相关版本必须解析出同一条**，否则**整个 modid 都不用**
 *    （退回目录那条候选）。理由：把 A 版本的上游包当成 B 版本那一行的目标，
 *    等于给用户一个"更新到另一个游戏版本"的按钮 —— 那是会写坏目录的坏法。
 *    今天（现读 `content/mod-catalog.json`）只有 `mcsrranked` 有 `upstream`，
 *    而它只有 `1.16.1` 那一条 release ⇒ 这一支永远只有一个版本，判据是给将来准备的。
 */
async function resolveUpstream(c: ModCatalog): Promise<void> {
  const d = requireDeps();
  const index = catalogIndexOf();
  if (index === null) throw new Error('目录还没拉到（这条操作的入参要在目录里查得到）');
  const out = new Map<string, ModRelease>();

  for (const mod of c.mods) {
    const upstream = mod.upstream;
    if (upstream === null) continue;
    const gameVersions = upstreamGameVersions(c, index, mod.modid);
    if (gameVersions.length === 0) continue; // 判定层永远不会问上游 ⇒ 连请求都不发

    let versions: ModrinthVersion[];
    try {
      // 复用 v1 的抓取（TTL 缓存 + 退避重试三次）；**不** force：这是启动时的一次检查
      versions = await fetchVersions(upstream.project, {
        force: false,
        userAgent: d.userAgent,
      });
    } catch (error) {
      onNotice(`上游版本没拿到（${mod.modid}）：${messageOf(error)} —— 目标退回目录里那条候选`);
      continue;
    }

    const resolved: ModRelease[] = [];
    let unusable = false;
    // 这一条 upstream **接受哪些通道**（没写 = 只认 release，见 `upstreamChannelsOf`）。
    const channels = upstreamChannelsOf(upstream);
    for (const gameVersion of gameVersions) {
      const latest = pickLatestUpstreamVersion(versions, {
        gameVersion,
        loader: UPSTREAM_LOADER,
        channels,
      });
      const release = latest === null ? null : upstreamRelease(mod, latest);
      if (release === null) {
        unusable = true;
        break;
      }
      resolved.push(release);
    }
    const first = resolved[0];
    if (unusable || first === undefined) {
      onNotice(`上游版本没拿到（${mod.modid}）：上游没有匹配的 release —— 目标退回目录里那条候选`);
      continue;
    }
    if (!resolved.every((release) => sameRelease(release, first))) {
      onNotice(
        `上游解析在多个游戏版本上不一致（${mod.modid}）：这一次不用上游 —— 目标退回目录里那条候选`,
      );
      continue;
    }
    out.set(mod.modid, first);
  }

  upstreamLatest = out;
}
