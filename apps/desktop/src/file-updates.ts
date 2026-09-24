/**
 * 本地文件自动更新 —— **主进程那一侧**（唯一碰磁盘与网络的地方）。
 *
 * ⚠️★ 为什么全在这里：渲染进程加载的是**远程网页**。一旦那页被 XSS，
 *    攻击者拿到的是这条通道能做的全部事情。所以：路径**从来不出现在 IPC 参数里**，
 *    只出现在这个文件自己维护的状态文件里；页面只能按 itemId 说"绑定/更新这一条"。
 *
 * ⚠️ 写方向**到底能做什么**（2026-09-24 评审的顺手 2 要求把话说准）：远程页面
 *    **决定不了路径**（它只能给一个目录校验过的 itemId + 布尔），但它**能**按 id 触发对
 *    **已绑定条目**的写入 —— 也就是"把用户自己的 mods 目录里那一个文件换掉"。
 *    所以"写不了任意文件"成立，"什么都写不了"不成立；这条通道的爆炸半径就到这里为止。
 *
 * ⚠️ 读方向是反的：交给页面的 `FileUpdatesState` 里**确实带着已绑定条目的绝对路径**
 *    （`FileItemView.binding.localPath` / `FileItemState.localPath`，定义在
 *    `@mcsr/shared/fileUpdates`）。那是页面唯一的数据来源、路径是它的一部分
 *    ⇒ 被注入的远程源能看到这些路径（含用户名）。`preload.ts` 文件头把这条记成一次
 *    **有意接受的代价**，这里不再重复论证。
 *
 * ⚠️ 本文件里"上游"一律指 **Modrinth**（`api.modrinth.com` 取元数据、`cdn.modrinth.com`
 *    取字节）：我们服务器只提供"有哪些条目"（目录），**不是信任锚** —— 落盘的内容必须与
 *    上游给的 sha512 对得上，服务器被攻破也推不了任意 jar。
 *
 * ⚠️ 这个模块**没有测试运行器**（`apps/desktop` 只有 typecheck）⇒ 凡是要写断言的纯逻辑都住在
 *    `@mcsr/shared/fileUpdates`，断言落在 `services/api/src/file-updates-shared.test.ts`。
 *    本文件里**已经没有**独立的新判断逻辑了（`compareLocalVersions` 在 2026-09-24 的
 *    顺手 6 里被搬进了 shared）；剩下的都是"读盘 / 打网络 / 弹框"这类需要环境才能跑的编排，
 *    由 `.cache/task4-probe/` 那套桩 electron 探针覆盖（不可长期复跑）。
 */
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { FILE_UPDATES_CHANNELS } from '@mcsr/shared/desktop';
import {
  compareLocalToLatest,
  compareLocalVersions,
  type FileCatalog,
  type FileCatalogItem,
  type FileItemState,
  type FileItemView,
  type FileUpdatesState,
  isDisabledPath,
  jarFileNameFor,
  type ModrinthVersion,
  needsUpdate,
  parseFileCatalog,
  pickLatestVersion,
  primaryFileOf,
} from '@mcsr/shared/fileUpdates';
import type { MessageBoxOptions, OpenDialogOptions } from 'electron';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { unzipSync } from 'fflate';

// ---------------------------------------------------------------------------
// 状态文件（userData/file-tracking.json）
// ---------------------------------------------------------------------------

interface StateFileItem {
  localPath: string;
  autoUpdate: boolean;
  localVersion: string | null;
  localSha512: string | null;
  lastCheckedAt: number | null;
  lastUpdateAt: number | null;
  lastUpdateFrom: string | null;
  lastUpdateTo: string | null;
}
interface StateFile {
  version: 1;
  items: Record<string, StateFileItem>;
}

const CACHE_TTL_MS = 30 * 60 * 1000;

export function stateFilePath(): string {
  return join(app.getPath('userData'), 'file-tracking.json');
}

/**
 * `readStateFile()` 的结果。
 *
 * ⚠️★ 为什么是"三态"而不是 `{ state, recovered }`（2026-09-24 评审的必修 2）：
 *    备份**失败**时，旧写法仍然回一句"已备份成 …"、并交给调用方一个**空状态** ——
 *    下一步 `initFileUpdates` 就会把那个空状态写回去，**覆盖掉用户原来的坏文件**
 *    ⇒ 既说假话，又静默丢掉用户的全部绑定路径。
 *    ⇒ 现在把"备份失败"单独表达成 `fatal`：`state` 是 null（**不许**拿空状态去覆盖），
 *      调用方必须停住写入并提示用户手动处理那个文件。
 */
interface StateFileRead {
  /** 可以用的状态；`null` = 备份失败，**不许**写盘。 */
  state: StateFile | null;
  /** 备份成功后重建为空的说明（给调用方去说）。 */
  recovered: string | null;
  /** 读不出来且**备份也失败** ⇒ 停住，别再碰那个文件。 */
  fatal: string | null;
}

/**
 * 读状态文件。
 *
 * ⚠️ 坏文件**不许静默丢**：用户亲手选的文件路径在这里，丢了却什么都不说的话，
 *    下一次打开是"什么都没绑定"，而他不知道发生过什么。
 *    所以：备份成 `.corrupt-<ts>` 再重建，并把这件事交给调用方去说
 *    （`initFileUpdates` 会打日志 + 弹一次原生提示框 —— 为什么是提示框见那里）。
 * ⚠️★ **备份失败时反过来做**：一个字节都不覆盖（`state: null` + `fatal`），
 *    宁可让这一栏停住并让用户自己去处理那个文件 —— 见 `StateFileRead` 的注释。
 */
export function readStateFile(): StateFileRead {
  const file = stateFilePath();
  if (!existsSync(file)) return { state: { version: 1, items: {} }, recovered: null, fatal: null };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as StateFile;
    if (parsed.version !== 1 || typeof parsed.items !== 'object' || parsed.items === null) {
      throw new Error('unexpected shape');
    }
    const items: Record<string, StateFileItem> = {};
    for (const [id, raw] of Object.entries(parsed.items)) {
      items[id] = {
        localPath: String(raw.localPath ?? ''),
        autoUpdate: raw.autoUpdate === true,
        localVersion: raw.localVersion ?? null,
        localSha512: raw.localSha512 ?? null,
        lastCheckedAt: raw.lastCheckedAt ?? null,
        lastUpdateAt: raw.lastUpdateAt ?? null,
        lastUpdateFrom: raw.lastUpdateFrom ?? null,
        lastUpdateTo: raw.lastUpdateTo ?? null,
      };
    }
    return { state: { version: 1, items }, recovered: null, fatal: null };
  } catch (error) {
    const backup = `${file}.corrupt-${Date.now()}`;
    try {
      renameSync(file, backup);
    } catch (backupError) {
      /*
       * ⚠️★ 这一步失败 ⇒ **停住**：既不改名、也不回空状态。原先这里是 `catch { /* … *\/ }`
       * 吞掉错误，然后照样说"已备份成 …"、并让调用方拿空状态把坏文件覆盖掉 ——
       * 那等于**静默删掉用户全部的绑定路径**（评审必修 2）。
       * 代价：这一栏在用户手动处理那个文件之前是停住的（`writeStateFile` 会拒绝写入），
       * 而"改好或删掉它再启动"这句话由 `initFileUpdates` 的提示框说清楚。
       */
      return {
        state: null,
        recovered: null,
        fatal:
          `状态文件读不出来（${String(error)}），而且**备份也失败了**（${messageOf(backupError)}）。` +
          `⇒ 没有动它、也不会再写它（免得把里面的绑定路径抹掉）。` +
          `请手动处理这个文件（修好它、或删掉它）然后重启：${file}`,
      };
    }
    return {
      state: { version: 1, items: {} },
      recovered: `状态文件读不出来（${String(error)}），已备份成 ${basename(backup)}`,
      fatal: null,
    };
  }
}

/**
 * 写状态文件：临时文件 + 同卷 rename，绝不留下半个 JSON。
 *
 * ⚠️ 停住态（`stateFileWritable === false`，见 `StateFileRead.fatal`）下**拒绝写**：
 *    那是"坏文件连备份都失败"时唯一的正确动作 —— 宁可功能不可用，也不许覆盖用户的数据。
 */
export function writeStateFile(state: StateFile): void {
  if (!stateFileWritable) {
    throw new Error(stateFileBlockedReason ?? '状态文件当前不可写（读不出来且备份失败）');
  }
  const file = stateFilePath();
  const tmp = `${file}.tmp`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  renameSync(tmp, file);
}

/** 状态文件能不能写（`false` = 坏文件连备份都失败 ⇒ 什么都不许写）。 */
let stateFileWritable = true;
let stateFileBlockedReason: string | null = null;

/**
 * 内存里的状态文件副本 —— 进程内**唯一**权威（磁盘上的那份是它的落盘快照）。
 *
 * ⚠️ 只由 `initFileUpdates` 从磁盘读一次，之后每次改动都 `writeStateFile(stateFile)` 落盘。
 *    不每次现读：绑定的是一次点击的结果，两个读来源会漂。
 */
let stateFile: StateFile = { version: 1, items: {} };

// ---------------------------------------------------------------------------
// jar 元数据
// ---------------------------------------------------------------------------

/**
 * 读 jar 里的 `fabric.mod.json`。
 *
 * ⚠️ 必须带 `filter`：不带的话 fflate 会把这个 27 MB 的 jar（spec §3 的读数：27.7 MB）
 *    里**所有**条目都解压出来（里面还嵌着 20 多个 jar）—— 我们只要一个 300 字节的 JSON。
 * ⚠️ 这个函数是**同步**的（`readFileSync` + `unzipSync`）：调用点都在主进程里、
 *    都在一次点击或一次检查上，代价是那一下会阻塞主进程几十毫秒（27 MB 读盘 + 解一条）。
 *    改成流式要换一个能流式读 ZIP 的库，本期不值。
 */
export function readJarMeta(jarPath: string): { id: string; version: string } {
  const bytes = readFileSync(jarPath);
  const entries = unzipSync(new Uint8Array(bytes), {
    filter: (f) => f.name === 'fabric.mod.json',
  });
  const raw = entries['fabric.mod.json'];
  if (!raw) throw new Error('这个文件里没有 fabric.mod.json（不是 Fabric 模组？）');
  const parsed = JSON.parse(new TextDecoder().decode(raw)) as { id?: unknown; version?: unknown };
  if (typeof parsed.id !== 'string' || typeof parsed.version !== 'string') {
    throw new Error('fabric.mod.json 里没有 id / version');
  }
  return { id: parsed.id, version: parsed.version };
}

// ---------------------------------------------------------------------------
// Modrinth 客户端
// ---------------------------------------------------------------------------

/**
 * 进程内的版本列表缓存（key = Modrinth 的 project），TTL 30 分钟。
 *
 * ⚠️ **只在内存里，不落盘**（brief 那段注释写着"磁盘缓存（… + userData 下的小 JSON）"，
 *    但那段的代码只有这个 Map —— 我按代码实现，并把注释改成事实）。
 *    不落盘还有一个 spec 层面的理由：spec §6.4 明确"**不存"最新版本"**（那是每次检查的结果，
 *    落盘就会某天拿一个过期数字去说"你已是最新"），而版本列表正是那个数字的来源。
 *    代价：进程重启后第一次检查一定要打一次 Modrinth（约 220 KB，spec §3 的读数 1.9s）。
 */
interface VersionsCache {
  fetchedAt: number;
  versions: ModrinthVersion[];
}
const versionsCache = new Map<string, VersionsCache>();

async function fetchVersions(
  project: string,
  opts: { force: boolean; userAgent: string },
): Promise<ModrinthVersion[]> {
  const cached = versionsCache.get(project);
  if (!opts.force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.versions;

  const url = `https://api.modrinth.com/v2/project/${encodeURIComponent(project)}/version`;
  let lastError: unknown;
  // 最多打三次（首次 + 退避重试两次：400ms、800ms）
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': opts.userAgent } });
      /*
       * ⚠️ 这里**不按状态码分流**"哪些值得重试"：会遇到的失败是 429 / 5xx / 断网
       *    （设计里点名的就是这三种），而 4xx 只有把目录里的 project 写错时才会出现 ——
       *    那种情况下三次的结果完全一样。代价写在明处：项目名写错时会多打两次请求、
       *    多等 1.2 秒才报错（换来的是这一段代码里没有第二条"要不要重试"的判断）。
       */
      if (!res.ok) throw new Error(`上游 ${String(res.status)}`);
      const versions = (await res.json()) as ModrinthVersion[];
      versionsCache.set(project, { fetchedAt: Date.now(), versions });
      return versions;
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }
  /*
   * 退避重试用尽 ⇒ **抛**。
   *
   * ⚠️★ 这里曾经写着"保留上一次成功的读数，而不是清空成未知"，并在 `cached` 存在时把它当**正常
   *    读数**返回 —— 评审（2026-09-24 必修 1）判为**粉饰**，属实：那条路径会让一行显示成
   *    "已是最新"（正常状态），而 spec §8 要的是状态 `error` + "检查失败：…"
   *    **并保留上次成功的最新版本、标注它是几时读的**。
   * ⇒ 现在的分工：**这里只管"这次到底读到了没有"**（读到就返回、没读到就抛），
   *    "上次读到的是什么、几时读的"由调用方（`doCheck`）用内存里的 `lastKnown` 单独记，
   *    并随 `FileItemView.lastKnownLatest` 交给页面（`error` 状态下它就是唯一能看的读数）。
   *    代价：上游一个请求都不通时，每一行都会变成 `error` —— 那正是实情，
   *    而"上次读数 + 时间"在同一处 display 出来，不像以前那样拿旧数字冒充新数字。
   * ⚠️ TTL 缓存（30 分钟内、非 `force`）仍然照用：那是**这次**成功的读数，不是过期的。
   */
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// ---------------------------------------------------------------------------
// 依赖与对外状态
// ---------------------------------------------------------------------------

interface Deps {
  siteOrigin: string;
  userAgent: string;
  /** 测试与"目录拉不下时"都用得上：不加这一层，检查逻辑就只能靠真网络验证。 */
  fetchCatalog: () => Promise<{ catalog: FileCatalog | null; error: string | null }>;
}

let deps: Deps | null = null;
let current: FileUpdatesState = {
  catalog: null,
  catalogError: null,
  items: [],
  busyItemId: null,
  progress: null,
  lastCheckedAt: null,
  lastRun: null,
};

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(FILE_UPDATES_CHANNELS.onStatus, current);
  }
}

/** ★ IPC 参数只接受"目录里存在的 id"：这是对 preload 那段纪律的延续。 */
function requireItem(itemId: unknown): FileCatalogItem {
  if (typeof itemId !== 'string' || !deps) throw new Error('非法参数');
  const item = current.catalog?.items.find((i) => i.id === itemId);
  if (!item) throw new Error(`目录里没有这一条：${String(itemId)}`);
  return item;
}

/**
 * 现读本地文件的结果。
 *
 * ⚠️★ 刻意做成**显式结果类型**，不用 `throw new Error('__missing__')` 那种哨兵字符串：
 *    哨兵是"拿错误当控制流"，调用方得靠 `err.message === '__missing__'` 认出来，
 *    而这种比较一旦有人改一个字就永远为假 —— 表现是"文件不见了"被当成"读不出"。
 *    代价：多一个类型与几处分支。
 */
type LocalRead =
  | { ok: true; version: string }
  | { ok: false; reason: 'missing' | 'unreadable'; detail: string | null };

/**
 * 现读本地版本（**每次现读，不吃缓存**：缓存过的版本会在文件被换掉之后继续说旧话）。
 *
 * ⚠️ 这里**不算 sha512**：27 MB 的全量哈希只在两处需要（绑定时的记录、更新前后的核对），
 *    把它塞进每次检查（启动一次 + 每次点"检查"）等于每次多读一遍 27 MB 的盘。
 *    连带的一条**有意保留**的性质：状态文件里的 `localSha512` 是"我们**接受过**的那一份文件的
 *    哈希"（bind / update 写的），**不随每次检查刷新** —— 这正是 `update()` 第②步
 *    "同名但不是我们记的那一份 ⇒ 停下询问"能咬住"两次检查之间被换掉的文件"的原因；
 *    若每次检查都刷它，那条判据在它唯一的用武之地上会恒假。
 *    代价：状态文件里的 `localVersion`（本次读到的）与 `localSha512`（上次接受的）可能
 *    来自**两次不同的读** —— 没有任何判据读 `localVersion`（界面用的是本次检查的读数），
 *    它只是记账，所以这个不一致只影响读这份 JSON 的人。
 */
async function readLocal(localPath: string): Promise<LocalRead> {
  if (!existsSync(localPath)) return { ok: false, reason: 'missing', detail: null };
  try {
    const meta = readJarMeta(localPath);
    return { ok: true, version: meta.version };
  } catch (error) {
    return { ok: false, reason: 'unreadable', detail: messageOf(error) };
  }
}

/**
 * 27 MB 全量哈希：只在"真要写盘"与"想核对本地这份是不是上游原版"时做。
 *
 * ⚠️ 用流而不是 `readFileSync`：`readJarMeta` 那一步已经把整份文件读进内存一次，
 *    再整份读一次就是峰值多 27 MB。代价：这个函数是 async（调用点本来就在 async 里）。
 */
function sha512OfFile(path: string): Promise<string> {
  return new Promise((done, fail) => {
    const hash = createHash('sha512');
    const stream = createReadStream(path);
    stream.on('error', fail);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => done(hash.digest('hex')));
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Windows 上路径大小写不敏感 ⇒ 判"是不是同一个文件"时先归一。 */
function sameFilePath(a: string, b: string): boolean {
  const na = resolve(a);
  const nb = resolve(b);
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

/**
 * 用户目录里有同一个 mod 的多份 jar 时，先绑哪一份。
 *
 * ⚠️ 规则本身住在 `@mcsr/shared/fileUpdates` 的 `compareLocalVersions` 里（2026-09-24 评审的
 *    顺手 6 把它从本文件搬了过去）：**apps/desktop 没有测试运行器**，留在这里就只能靠
 *    gitignore 的探针验；搬到 shared 之后 `services/api/src/file-updates-shared.test.ts`
 *    里有能红的断言钉着它（包括"3.0.10 > 3.0.2"那条字符串序会给错答案的用例）。
 * ⚠️ 它**不是**上游的"最新版"规则（那是 `pickLatestVersion` 的 `date_published`）——
 *    两个函数的注释里都写清了这一点，别把其中一个的规则搬到另一个上。
 */

// ---------------------------------------------------------------------------
// 目录（我们服务器上的 GET /api/file-catalog，带 ETag）
// ---------------------------------------------------------------------------

/**
 * 上一次成功的目录读数与它的 ETag。
 *
 * ⚠️ **只在内存里**：spec §8 要求"目录拉取失败时保留上次缓存"，我把它读作
 *    "**进程内**上一次成功的读数"（拉一次成功之后再失败，界面不会变空）。
 *    跨重启的磁盘缓存本期不做：那要多一个文件、多一处"哪份是真的"的歧义，
 *    而冷启动拉不到目录时的表现是页面上写着"目录拉取失败：…"（不是空白，也不报错）。
 *    代价：服务器长时间不可达 + 应用重启过 ⇒ 目录为空。
 */
let lastCatalog: FileCatalog | null = null;
let catalogEtag: string | null = null;

async function fetchCatalogFromSite(): Promise<{
  catalog: FileCatalog | null;
  error: string | null;
}> {
  const d = deps;
  if (!d) return { catalog: null, error: '模块还没初始化' };
  const url = new URL('/api/file-catalog', d.siteOrigin).toString();
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': d.userAgent,
        ...(catalogEtag ? { 'if-none-match': catalogEtag } : {}),
      },
    });
    if (res.status === 304 && lastCatalog) return { catalog: lastCatalog, error: null };
    if (!res.ok) {
      /*
       * 500 时服务端会给出机器可读的码（`catalog_unavailable` / `catalog_invalid_json` /
       * `catalog_invalid`），而 `catalog_invalid` 还带 `problems` —— 服务端那条路由的注释
       * 写清了"problems 是我们自己的字段级说明、是调用方唯一能自己动手修的线索"，所以这里
       * 把它带进文案；`path` / `detail` 服务端故意不回显（匿名端点），文案也就拿不到。
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
        /* 响应体不是 JSON：下面的文案只说状态码 */
      }
      return {
        catalog: null,
        error: `目录拉取失败：服务器 HTTP ${String(res.status)}${detail === '' ? '' : `（${detail}）`}`,
      };
    }
    const parsed = parseFileCatalog((await res.json()) as unknown);
    if (!parsed.ok) {
      return { catalog: null, error: `目录不合法：${parsed.problems.join('；')}` };
    }
    catalogEtag = res.headers.get('etag');
    lastCatalog = parsed.catalog;
    return { catalog: parsed.catalog, error: null };
  } catch (error) {
    // 拉不到（断网 / 服务器挂了）：保留上一次成功的读数，并把原因交给页面
    return { catalog: lastCatalog, error: `目录拉取失败：${messageOf(error)}` };
  }
}

/**
 * 拉一次目录。
 *
 * ⚠️ 失败时**保留** `current.catalog`（只是把 catalogError 写上去）：spec §8 要求
 *    "保留上次缓存"，而清空的表现是"某一个栏凭空消失"。
 */
async function loadCatalog(): Promise<void> {
  const d = deps;
  if (!d) return;
  const result = await d.fetchCatalog();
  if (result.catalog) {
    current = { ...current, catalog: result.catalog, catalogError: null };
  } else {
    current = { ...current, catalogError: result.error };
  }
  current = { ...current, items: rebuildItems() };
}

// ---------------------------------------------------------------------------
// 视图（内存里的检查结果 × 状态文件里的绑定 × 本地现读）
// ---------------------------------------------------------------------------

/** 最近一次检查为某一条算出来的上游读数。 */
interface CheckFacts {
  /** 上游"最新那一版"；`null` 表示没有匹配 gameVersion/loader/channel 的版本。 */
  latest: ModrinthVersion | null;
  /** 上游返回的整份列表 —— `compareLocalToLatest` 要靠它区分 outdated 与 unknown-local。 */
  versions: ModrinthVersion[];
  error: string | null;
  checkedAt: number;
}

const checked = new Map<string, CheckFacts>();
/** 本次进程里读到的本地事实（key = itemId）。**不吃状态文件里的缓存**，见 `readLocal`。 */
const liveLocal = new Map<string, LocalRead>();
/**
 * 最近一次**成功**读到的最新版本与读到它的时间（key = itemId）。
 *
 * ⚠️★ 必修 1 的那一半：`fetchVersions` 失败时**不再**拿过期缓存冒充正常读数，
 *    于是"上次读到的是什么、几时读的"必须单独记在这里 —— 它随
 *    `FileItemView.lastKnownLatest` 交给页面（spec §8："保留上次成功的最新版本并标注时间"）。
 * ⚠️ 只活在内存里（状态文件故意不存最新版本，plan 写死的设计）；
 *    所以冷启动 + 上游不可达时它是 `null`，那句 `message` 也就照实说"本次还没成功读到过"。
 * ⚠️ 它只在**检查成功**时更新（`doCheck` 里那两个地方）；`unbind` 时跟着删。
 */
const lastKnown = new Map<string, { version: string; fetchedAt: number }>();

function viewFor(item: FileCatalogItem): FileItemView {
  const binding = stateFile.items[item.id] ?? null;
  /** 各分支共用的那几格（`lastKnownLatest` 只在"从没有过读数"时才该是 null）。 */
  const view = (
    b: StateFileItem | null,
    localVersion: string | null,
    state: FileItemState,
    lastCheckedAt: number | null,
  ): FileItemView => ({
    item,
    binding: b,
    localVersion,
    state,
    lastCheckedAt,
    lastKnownLatest: lastKnown.get(item.id) ?? null,
  });
  if (!binding || binding.localPath === '') {
    // 没绑定就谈不上"上次读到的最新版本" ⇒ 这一格是 null（不多借一次历史）
    return {
      item,
      binding: null,
      localVersion: null,
      state: { kind: 'unbound' },
      lastCheckedAt: null,
      lastKnownLatest: null,
    };
  }
  const localPath = binding.localPath;
  const facts = checked.get(item.id) ?? null;
  const lastCheckedAt = facts?.checkedAt ?? null;

  /*
   * ⚠️ 文件不见了就**不许**再显示版本号（spec §8："不许显示 0 或旧版本"）。
   *    所以这里先看一眼文件在不在，再看本次读数 —— 而"本次读数"是**进程内**的：
   *    状态文件里的 `localVersion` 是上次运行读到的，把它当现值显示正是
   *    `readLocal` 上面警告的那种"缓存过的版本在文件被换掉之后继续说旧话"。
   */
  if (!existsSync(localPath)) {
    return view(binding, null, { kind: 'missing-file', localPath }, lastCheckedAt);
  }
  const read = liveLocal.get(item.id);
  if (read && !read.ok) {
    return view(
      binding,
      null,
      { kind: 'error', localPath, message: `读不出这个文件：${read.detail ?? read.reason}` },
      lastCheckedAt,
    );
  }
  if (!read || !facts) {
    /*
     * 已绑定、文件也在，但这一次进程里还没拿到过读数 ⇒ `unchecked`（T1 契约里新加的那一支，
     * 见 `FileItemState` 的注释）。**不再借用 `error`**：那会让界面把"还没检查过"印成
     * "读取失败：…" —— 对用户说假话（他没读失败，是还没读），而计划的词条里本来就有
     * "还没检查过"这一格（`files.notChecked`）。
     * ⚠️ 什么时候会走到这里：① 启动检查跳过了它（`autoUpdate === false`，见 `startUp`）；
     *    ② 刚绑定、检查还没回来；③ 开发态（不跑启动检查）刚打开。
     *    代价：这三种情况界面都不显示版本号（`localVersion` 是 null）—— 那是真的：
     *    这一次进程里我们确实还没读到。
     */
    return view(binding, null, { kind: 'unchecked', localPath }, null);
  }
  const localVersion = read.version;
  if (facts.error) {
    // `facts.error` 的文案在 `doCheck` 里写（上游不可达的那种要说清"本次还没成功读到过"）
    return view(
      binding,
      localVersion,
      { kind: 'error', localPath, message: facts.error },
      lastCheckedAt,
    );
  }
  const latest = facts.latest;
  if (!latest) {
    return view(
      binding,
      localVersion,
      {
        kind: 'error',
        localPath,
        message: `上游没有 ${item.source.gameVersion} / ${item.source.loader} / ${item.source.channel} 的版本`,
      },
      lastCheckedAt,
    );
  }
  const cmp = compareLocalToLatest(localVersion, latest, facts.versions);
  if (cmp === 'up-to-date') {
    return view(
      binding,
      localVersion,
      {
        kind: 'current',
        localPath,
        localVersion,
        latestVersion: latest.version_number,
      },
      lastCheckedAt,
    );
  }
  const file = primaryFileOf(latest);
  /*
   * ⚠️ 没有主文件 / 没有 sha512 ⇒ **不能**进入"可更新"：`update()` 的整个安全模型是
   *    "落盘的字节必须与上游给的 sha512 一致"（spec §9：我们服务器不是信任锚）。
   *    没有哈希就没有这条判据 ⇒ 报错，而不是"下一份没校验的东西"。
   */
  if (!file?.hashes.sha512) {
    return view(
      binding,
      localVersion,
      {
        kind: 'error',
        localPath,
        message: '上游那一版没有可下载的主文件（或没有 sha512）⇒ 不能校验，拒绝更新',
      },
      lastCheckedAt,
    );
  }
  return view(
    binding,
    localVersion,
    {
      kind: cmp,
      localPath,
      localVersion,
      latestVersion: latest.version_number,
      latestFileName: jarFileNameFor(latest) ?? file.filename,
      latestUrl: file.url,
      latestSha512: file.hashes.sha512,
      latestSize: file.size,
      disabled: isDisabledPath(localPath),
    },
    lastCheckedAt,
  );
}

function rebuildItems(): FileItemView[] {
  return (current.catalog?.items ?? []).map(viewFor);
}

// ---------------------------------------------------------------------------
// 检查（只读：零下载、零写盘）
// ---------------------------------------------------------------------------

/**
 * 检查的队列。
 *
 * ⚠️ 为什么要串行：打包态**启动时**会自动检查一次，而用户在一两秒内点一下"检查"就会重叠；
 *    两个并发的检查会各自覆盖 `current.items`，后完成的那个不一定带更新的数据 ——
 *    表现是"版本号闪一下又变回去"。代价：并发时后者要等前者走完
 *    （一次最多 27 MB 的读盘 + 一次 Modrinth 的 220 KB）。
 */
let checkQueue: Promise<unknown> = Promise.resolve();

/**
 * 只读检查：读本地版本（现读）+ 取 Modrinth 版本列表（30 分钟缓存，`force` 绕过）+ 比对。
 *
 * ⚠️★ **一个字节都不写**（spec §6.4 的"只读，不写盘"、§7.2 的"全程零写盘、零下载"）：
 *    它只改内存里的 `current` 与本次读数。状态文件的写入只发生在 bind / unbind /
 *    setAutoUpdate / update 四处（那几处本来就刚读过或刚写过这个文件）。
 *    代价：每次启动后、第一次检查完成之前，页面上的行是 `unchecked`（不是拿旧读数冒充现值）。
 *
 * ⚠️★ `scope` 是**启动检查与手动检查的分界**（2026-09-24 的裁决 ③）：
 *   · `'auto'`（只有启动那一次用）：**只查 `autoUpdate === true` 的已绑定条目**；
 *   · `'all'`（页面的「检查」按钮，手动、带不带 `force` 都算）：**查全部已绑定条目**。
 *   为什么要有这条分界：`autoUpdate` 那个勾选框如果什么都不控制，用户在界面上看到的是一个
 *   **开不动的开关**（比没有它更坏）；而"我想现在就看一眼"必须有路，所以手动那一路永远查全部。
 *   代价：关掉开关的条目在启动时不刷新 —— 它显示的是**上一次的读数**（`lastCheckedAt` 就是给
 *   界面看"这是几时读的"用的）；跨重启之后连上次的读数也没有了（读数只在内存里），
 *   那时它是 `unchecked`，要点一次「检查」（这是"不吃缓存"那条纪律的另一面，见 `readLocal`）。
 */
function check(force: boolean, scope: CheckScope = 'all'): Promise<FileUpdatesState> {
  const run = checkQueue.then(
    () => doCheck(force, scope),
    () => doCheck(force, scope),
  );
  checkQueue = run.catch(() => undefined);
  return run;
}

type CheckScope = 'all' | 'auto';

async function doCheck(force: boolean, scope: CheckScope): Promise<FileUpdatesState> {
  const d = deps;
  if (!d) return current;
  /*
   * 目录：没有拉到时补一次（页面上的"检查"是用户手里唯一的重试手段），
   * 而 `force`（用户明确点"重新检查"）时**也**重拉一次 —— 走的是带 `If-None-Match` 的条件请求，
   * 服务端没换目录就回 304（几字节），换了就回新的 200。
   *
   * ⚠️ 这是本文件里唯一让 ETag 真正生效的路径：一趟正常启动里目录只拉一次，
   *    没有 `force` 的话那个 304 分支永远走不到（探针读数：目录请求 1 次、If-None-Match 0 次）。
   *    代价：用户点一次"检查"会多一个小请求（几百字节，304 时更少）；换来的是一条
   *    spec §5 明写的能力（"带 ETag"）真的被走到，且新部署的目录条目不用重启应用就能出现。
   */
  if (force || !current.catalog) await loadCatalog();
  const catalog = current.catalog;
  if (!catalog) {
    broadcast();
    return current;
  }
  for (const item of catalog.items) {
    const binding = stateFile.items[item.id];
    if (!binding || binding.localPath === '') {
      // 没绑定的条目没有本地读数可比 ⇒ 一个网络请求都不发
      checked.delete(item.id);
      liveLocal.delete(item.id);
      continue;
    }
    if (scope === 'auto' && binding.autoUpdate !== true) {
      /*
       * 启动检查放过关掉开关的条目（裁决 ③ 的 ①）。
       * ⚠️ 这里**不动 `checked` / `liveLocal`**：上一次的读数要留着 —— 界面靠它显示
       *    "上一次读到的是什么、几时读的"（`lastCheckedAt`）。删掉的话关掉开关的行会退回
       *    `unchecked`，看起来反而像坏了。
       * 代价：启动时这一条不刷新（读数可能是几小时前的），用户点一次「检查」即可 ——
       * 手动那一路（`scope: 'all'`）永远查全部。
       */
      continue;
    }
    const read = await readLocal(binding.localPath);
    liveLocal.set(item.id, read);
    if (!read.ok) {
      // 文件不见了 / 读不出：没有本地版本可比，同样不打网络（状态由 viewFor 直接给出）
      checked.delete(item.id);
      continue;
    }
    try {
      const versions = await fetchVersions(item.source.project, { force, userAgent: d.userAgent });
      const latest = pickLatestVersion(versions, item.source);
      checked.set(item.id, { latest, versions, error: null, checkedAt: Date.now() });
      /*
       * 记账"最近一次**成功**读到的最新版本 + 时间"（必修 1 / spec §8）。
       * ⚠️ 只在 `latest` 非空时记：`pickLatestVersion` 返回 null 表示"上游没有匹配
       *    gameVersion+loader+channel 的版本"——那是**读到了**（列表拿到了），
       *    但没有"最新版本"这个事实可记；此时界面显示的是那一句"上游没有 … 的版本"，
       *    把旧的 lastKnown 顶上去会变成另一种假话。
       */
      if (latest) lastKnown.set(item.id, { version: latest.version_number, fetchedAt: Date.now() });
    } catch (error) {
      /*
       * 上游拉不到（退避重试用尽 / 断网 / 429 / 5xx）⇒ 状态 `error`，**并保留上次成功的最新版本**。
       *
       * ⚠️★ 必修 1：以前这里（配合 `fetchVersions` 回退缓存）会让一行显示成正常状态，
       *    而 spec §8 要的是 error + "检查失败：…" + 上次读数与它的时间。
       * ⚠️ 文案分两种，因为这两种情况对用户的意义完全不同：
       *    · 有上次读数 ⇒ 交给 `lastKnownLatest` 显示（版本 + 时间），这里只说原因；
       *    · **从没成功读到过**（冷启动 + 网络不通）⇒ 必须**照实说**"本次还没成功读到过"，
       *      不许编一个版本号（那正是评审判过的"粉饰"）。
       */
      const fallback = lastKnown.get(item.id) ?? null;
      const why = messageOf(error);
      const message = fallback
        ? `检查失败：上游拉不到版本列表（${why}）`
        : `检查失败：上游拉不到版本列表（${why}）—— 本次还没有成功读到过最新版本，这一条现在没有可比对的读数`;
      /*
       * ⚠️ 保留上一次的 `latest` / `versions`（如果有）：它们**只**用于显示
       *    `lastKnownLatest`（`viewFor` 先看 `facts.error`，所以状态仍然是 error、
       *    `needsUpdate` 仍然是 false）。清掉的话连"上次读到的是 5.8.26"都不剩。
       */
      const previous = checked.get(item.id) ?? null;
      checked.set(item.id, {
        latest: previous?.latest ?? null,
        versions: previous?.versions ?? [],
        error: message,
        checkedAt: Date.now(),
      });
    }
  }
  current = { ...current, lastCheckedAt: Date.now(), items: rebuildItems() };
  broadcast();
  return current;
}

// ---------------------------------------------------------------------------
// 绑定 / 解绑 / 开关（只动状态文件，不碰被跟踪的文件）
// ---------------------------------------------------------------------------

function dialogParent(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

async function showOpen(options: OpenDialogOptions) {
  const win = dialogParent();
  return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options);
}

/**
 * 主进程自己弹的原生提示框。
 *
 * ⚠️ 为什么要它：spec 有两处要求"如实告诉用户"，而 T1 冻结的 `FileUpdatesState` 里**没有**
 *    承载这些文字的字段（状态文件损坏的说明、"有几个 jar 读不出"的汇总）。
 *    可选做法只有两个：改契约（会牵动 T5/T6 的组件与 i18n，属于契约变更，不在本任务范围），
 *    或者由主进程自己说 —— 这里选后者，并把这件事写在这里以便下次有人问"为什么不显示在页面上"。
 * ⚠️ 代价：这是本仓第一次由主进程弹提示框，文案**不走 i18n**（词条表在 T5/T6 才有）。
 *    只在"不说用户就不可能知道"的场合用它，不要拿它当通用反馈通道。
 * ⚠️★ **触发条件（控制器 2026-09-24 的裁决 ①，改契约的入口就这一句）**：如果 T5/T6 发现
 *    需要把"坏状态文件"或"bindFolder 的汇总"**留在页面上**（而不是靠一次原生提示框），
 *    那就由 T5/T6 提出来扩 `FileUpdatesState` —— 它们是页面那一侧，那时才知道自己真正需要什么形状。
 *    在那之前这里不改契约：为一个还没有消费者的字段去改 T1 已评审的契约，成本大于收益。
 */
function notify(title: string, message: string): void {
  console.warn(`[file-updates] ${title}：${message}`);
  const win = dialogParent();
  const box: MessageBoxOptions = {
    type: 'warning',
    title: 'MCSR Helper',
    message: title,
    detail: message,
    buttons: ['知道了'],
  };
  const shown = win ? dialog.showMessageBox(win, box) : dialog.showMessageBox(box);
  void shown.catch(() => undefined);
}

async function pickOneJar(): Promise<string | null> {
  const res = await showOpen({
    title: '选择要跟踪的模组文件',
    properties: ['openFile'],
    filters: [{ name: 'Mod jar', extensions: ['jar'] }],
  });
  const picked = res.filePaths[0];
  return res.canceled || !picked ? null : picked;
}

async function pickDirectory(): Promise<string | null> {
  const res = await showOpen({ title: '选择 mods 目录', properties: ['openDirectory'] });
  const picked = res.filePaths[0];
  return res.canceled || !picked ? null : picked;
}

/**
 * 绑定单个文件（spec §7.1）。
 *
 * 失败分支的文案（都要能到用户眼前）：用户取消 ⇒ 状态一个字节都不变、直接返回；
 * 不是 jar / 没有 fabric.mod.json / id 不匹配 ⇒ **抛**（`ipcMain.handle` 会把消息带回
 * 渲染进程的 `reject`，页面那一侧要 catch 并显示 —— T6 的事）。
 * ⚠️ 本任务里没有别的通道能把这句话交给页面：`FileUpdatesState` 里没有"这一次操作的结果"字段。
 */
async function bind(itemId: unknown): Promise<FileUpdatesState> {
  const item = requireItem(itemId);
  const picked = await pickOneJar();
  if (!picked) return current;

  let meta: { id: string; version: string };
  try {
    meta = readJarMeta(picked);
  } catch (error) {
    throw new Error(`读不出「${basename(picked)}」里的 fabric.mod.json：${messageOf(error)}`);
  }
  if (meta.id !== item.source.modId) {
    // 报出两边的 id（spec §7.1）：只说"不匹配"的话用户不知道是自己选错了文件还是插件坏了
    throw new Error(
      `这个文件里的 mod id 是「${meta.id}」，不是「${item.source.modId}」⇒ 不绑定（${basename(picked)}）`,
    );
  }

  const sha512 = await sha512OfFile(picked);
  const existing = stateFile.items[item.id];
  stateFile.items[item.id] = {
    localPath: picked,
    /*
     * 新绑定默认 `autoUpdate: true`（控制器 2026-09-24 的裁决 ③）。
     * 理由：启动检查**只查 `autoUpdate === true` 的条目** ⇒ 默认 false 的话，新绑的条目
     * 在下次启动时会被启动检查漏掉，而用户以为它被自动看着（那个勾选框看起来是开着的）。
     * 用户随时可以关掉；重新绑定时**保留他上次的选择**（`existing?.autoUpdate`）。
     */
    autoUpdate: existing?.autoUpdate ?? true,
    localVersion: meta.version,
    localSha512: sha512,
    lastCheckedAt: Date.now(),
    lastUpdateAt: existing?.lastUpdateAt ?? null,
    lastUpdateFrom: existing?.lastUpdateFrom ?? null,
    lastUpdateTo: existing?.lastUpdateTo ?? null,
  };
  writeStateFile(stateFile);
  liveLocal.set(item.id, { ok: true, version: meta.version });
  current = { ...current, items: rebuildItems() };
  broadcast();
  // spec §7.1：绑完立刻读一次版本 + 查一次 Modrinth（否则页面上这一行是 `unchecked`）
  await check(false);
  return current;
}

/**
 * 按目录绑定（spec §6.4 / §7.1 的 `bindFolder`）。
 *
 * 扫用户选的目录里 `*.jar`（`.jar.disabled` 不算：游戏不会加载它），逐个读
 * `fabric.mod.json` 的 id，与目录条目的 `modId` 对上就绑；一个 modId 有多份时取
 * **版本最高**的那一份（`compareLocalVersions`）。
 *
 * ⚠️ 只找到 `.jar.disabled` 的 modId **不绑**，并如实报告（spec §6.4）——
 *    把一个被禁用的文件绑上，用户会看到一行"可更新"，而游戏根本不加载它。
 */
async function bindFolder(): Promise<FileUpdatesState> {
  const catalog = current.catalog;
  if (!catalog || catalog.items.length === 0) {
    throw new Error('目录还没拉到（或目录里一条都没有）⇒ 对不上任何条目，先点一次「检查」重试');
  }
  const dir = await pickDirectory();
  if (!dir) return current;

  let names: string[];
  try {
    // 排序：readDir 的顺序没有任何保证，两份同版本的副本会让"绑哪一份"随机化
    names = [...readdirSync(dir)].sort();
  } catch (error) {
    throw new Error(`读不了这个目录：${messageOf(error)}`);
  }

  const found: { name: string; path: string; id: string; version: string }[] = [];
  const disabledIds = new Set<string>();
  const disabledUnreadable: string[] = [];
  const unreadable: { name: string; why: string }[] = [];
  for (const name of names) {
    const lower = name.toLowerCase();
    if (lower.endsWith('.jar')) {
      const path = join(dir, name);
      try {
        const meta = readJarMeta(path);
        found.push({ name, path, id: meta.id, version: meta.version });
      } catch (error) {
        /*
         * ⚠️ 把**原因**一起记下来。只说"读不出"的话，用户看到的是一个他没法动手的结论；
         *    而这一栏真正常见的两种原因完全不同：不是 Fabric 模组（没有 fabric.mod.json）
         *    与文件本身读不动（EFS/占用/半截文件）。探针实测过一次后者的样子：
         *    刚 copy 完就立刻读，`readFileSync` 会失败 —— 隔一会儿再读就正常了。
         */
        unreadable.push({ name, why: messageOf(error) });
      }
      continue;
    }
    if (lower.endsWith('.jar.disabled')) {
      /*
       * 已禁用的副本也读一下 id，但**只为了说实话**（"这个条目只找到已禁用的副本"）。
       * 它读不出就算了，不列进 `unreadable`：那一栏的语义是"这些 jar 我们没能用上"，
       * 而这一支的文件本来就不参与绑定。
       * ⚠️ 但它要单独记一笔：现实里那个 `mcsrranked-5.8.15.jar.disabled`
       *    **本身就不是一个合法 zip**（本机实测：fflate 报 `invalid zip data`）⇒ 读不出 id 时
       *    既不能说"只找到已禁用的副本"、也不能装作这个目录里没有它。代价：报告多一栏。
       */
      try {
        disabledIds.add(readJarMeta(join(dir, name)).id);
      } catch {
        disabledUnreadable.push(name);
      }
    }
  }

  const boundNames: string[] = [];
  const disabledOnly: string[] = [];
  const noCandidate: string[] = [];
  for (const item of catalog.items) {
    // 版本最高的那一份（同样的版本号时取文件名序靠前的那个 —— names 已经排过序）
    let best: { name: string; path: string; id: string; version: string } | null = null;
    for (const candidate of found) {
      if (candidate.id !== item.source.modId) continue;
      if (best === null || compareLocalVersions(candidate.version, best.version) > 0)
        best = candidate;
    }
    if (!best) {
      if (disabledIds.has(item.source.modId)) disabledOnly.push(item.name);
      else noCandidate.push(item.name);
      continue;
    }
    const existing = stateFile.items[item.id];
    stateFile.items[item.id] = {
      localPath: best.path,
      /*
       * 已有的开关与上次更新记录保留：按目录绑定不该悄悄关掉用户开着的自动更新。
       * ⚠️ 新绑定默认 `true`，与 `bind()` 同一个理由（启动检查只查 `autoUpdate === true` 的条目 ⇒
       *    默认 false 会让按目录绑上的条目在下次启动被漏掉，而那个勾选框看起来是开着的）。
       *    ⚠️ 这一半是控制器 ③ 只点了 `bind()`、我把同一条决定**同样应用到按目录绑定**这个入口
       *    （两个入口建的是同一种记录，默认值不一致会变成"同一件事两种行为"）；若控制器要
       *    只留 `bind()` 那一半，改回来就是这一行。
       */
      autoUpdate: existing?.autoUpdate ?? true,
      localVersion: best.version,
      localSha512: await sha512OfFile(best.path),
      lastCheckedAt: Date.now(),
      lastUpdateAt: existing?.lastUpdateAt ?? null,
      lastUpdateFrom: existing?.lastUpdateFrom ?? null,
      lastUpdateTo: existing?.lastUpdateTo ?? null,
    };
    liveLocal.set(item.id, { ok: true, version: best.version });
    boundNames.push(`${item.name} ← ${best.name}`);
  }
  writeStateFile(stateFile);
  current = { ...current, items: rebuildItems() };
  broadcast();

  const catalogIds = new Set(catalog.items.map((i) => i.source.modId));
  const strangers = found.filter((f) => !catalogIds.has(f.id)).map((f) => f.name);
  const report: string[] = [`这个目录里绑上了 ${String(boundNames.length)} 条：`];
  report.push(...(boundNames.length > 0 ? boundNames.map((s) => `  · ${s}`) : ['  ·（没有）']));
  if (strangers.length > 0) {
    report.push(
      `目录里没有这些 jar 的条目（${String(strangers.length)} 个）：${strangers.join('、')}`,
    );
  }
  if (unreadable.length > 0) {
    report.push(
      `读不出 fabric.mod.json 的（${String(unreadable.length)} 个）：${unreadable
        .map((u) => `${u.name}（${u.why}）`)
        .join('、')}`,
    );
  }
  if (disabledOnly.length > 0) {
    report.push(`只找到已禁用副本、没有绑定的：${disabledOnly.join('、')}`);
  }
  if (disabledUnreadable.length > 0) {
    report.push(
      `已禁用的副本（读不出它的 mod id，所以不知道它属于哪一条）：${disabledUnreadable.join('、')}`,
    );
  }
  if (noCandidate.length > 0) {
    report.push(`这个目录里没有找到的：${noCandidate.join('、')}`);
  }
  // ⚠️ 只在"有话说"时弹：一次普通的成功绑定不需要一个提示框挡在面前
  if (
    strangers.length > 0 ||
    unreadable.length > 0 ||
    disabledOnly.length > 0 ||
    disabledUnreadable.length > 0 ||
    noCandidate.length > 0
  ) {
    notify('按目录绑定完成', report.join('\n'));
  }

  // 绑完查一次：否则新绑上的行全是"还没检查过"
  await check(false);
  return current;
}

function unbind(itemId: unknown): FileUpdatesState {
  const item = requireItem(itemId);
  if (stateFile.items[item.id]) {
    delete stateFile.items[item.id];
    writeStateFile(stateFile);
  }
  liveLocal.delete(item.id);
  checked.delete(item.id);
  // "上次成功读到的最新版本"跟着绑定走：解绑之后没有"这一条"了，留着就是多借一次历史
  lastKnown.delete(item.id);
  current = { ...current, items: rebuildItems() };
  broadcast();
  return current;
}

function setAutoUpdate(itemId: unknown, on: unknown): FileUpdatesState {
  const item = requireItem(itemId);
  if (typeof on !== 'boolean') throw new Error('非法参数：这一项只接受布尔');
  const binding = stateFile.items[item.id];
  if (!binding || binding.localPath === '') {
    throw new Error('这一条还没绑定文件 —— 自动更新开关只对已绑定的条目有意义');
  }
  binding.autoUpdate = on;
  writeStateFile(stateFile);
  current = { ...current, items: rebuildItems() };
  broadcast();
  return current;
}

// ---------------------------------------------------------------------------
// 更新（唯一写盘的地方）
// ---------------------------------------------------------------------------

type UpdateOutcome =
  | { status: 'updated'; from: string; to: string }
  | { status: 'skipped'; message: string }
  | { status: 'failed'; message: string };

function reportProgress(itemId: string, percent: number | null): void {
  current = { ...current, progress: { itemId, percent } };
  broadcast();
}

/**
 * ②目标位置已经有文件时的确认（spec §7.3 第 2 步的"停下并询问"）。
 *
 * ⚠️ 默认按钮是**取消**（`defaultId: 1` + `cancelId: 1`）：这一支存在的全部意义就是
 *    "别覆盖掉用户自己那份"，把"覆盖"设成默认会让一次回车就把它删了。
 *    代价：真想覆盖的人要多一次鼠标移动。
 */
async function confirmOverwrite(
  targetPath: string,
  recorded: string | null,
  targetHash: string,
): Promise<boolean> {
  const win = dialogParent();
  const box: MessageBoxOptions = {
    type: 'warning',
    title: '目标位置已经有这个文件',
    message: `${basename(targetPath)} 已经在那里了。`,
    detail: [
      recorded === null
        ? '而且我们**没有**它的记录（这条绑定是刚建的，或记录被清过）。'
        : '而且它的 sha512 与我们记下的那一份不一样（可能是你自己下的，或你改动过）。',
      '',
      `已有文件：${targetPath}`,
      `已有文件的 sha512：${targetHash.slice(0, 32)}…`,
      '',
      '选「覆盖」：这个文件会被删掉，新版写在同一个位置（删掉之后不会进回收站）。',
      '选「取消」：什么都不会发生，原文件一个字节都不动。',
    ].join('\n'),
    buttons: ['覆盖它', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
  const res = win ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box);
  return res.response === 0;
}

/**
 * 被禁用的绑定（`.jar.disabled`）上的单条更新确认（2026-09-24 评审的必修 3）。
 *
 * ⚠️★ 为什么必须问：`update()` 会 `rmSync` 掉那个 `.disabled`、把新文件重命名成 `<name>.jar`
 *    —— **用户点一下按钮就把一个被禁用的 mod 启用了**，而游戏下次启动就会加载它。
 *    这不是"更新"，是"改变用户设置"，所以要一次明确的点头。
 * ⚠️ 默认按钮同样是**取消**（呼应"别做用户没要求的事"这个方向）；
 *    `updateAll` 保持**跳过**（spec §8 明写），所以一键更新不会被一个弹窗挡在中间。
 * 代价：想更新一个被禁用的副本时多一次点击（这是刻意的）。
 */
async function confirmEnable(targetPath: string): Promise<boolean> {
  const win = dialogParent();
  const box: MessageBoxOptions = {
    type: 'warning',
    title: '这一条现在是禁用状态',
    message: `${basename(targetPath)} 这一条现在以 .disabled 结尾 —— 游戏不会加载它。`,
    detail: [
      '继续更新会把它换成**启用状态**的文件：',
      `  ${targetPath}`,
      '',
      '也就是说，**游戏下次启动会加载它** —— 这改变了你现在的设置（那是禁用的意思）。',
      '原来那个 .jar.disabled 会被删掉（不进回收站）。',
      '',
      '选「继续」：换成一个启用的文件（想保持禁用，更新完把名字改回 .jar.disabled 即可）。',
      '选「取消」：什么都不会发生。',
    ].join('\n'),
    buttons: ['启用它并更新', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
  const res = win ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box);
  return res.response === 0;
}

/**
 * ③下载到 `<同目录>/<上游文件名>.part`，边下边算 sha512，并把进度推给页面。
 *
 * ⚠️ 不重试：这是 27 MB 的字节，重试要重新下完（spec 只在元数据那一步要了退避重试）。
 *    失败时调用方会把 `.part` 删掉 —— 原文件一个字节都没动。
 */
async function downloadTo(
  partPath: string,
  url: string,
  expectedSize: number,
  itemId: string,
): Promise<{ sha512: string; bytes: number }> {
  const d = deps;
  if (!d) throw new Error('模块还没初始化');
  const res = await fetch(url, { headers: { 'user-agent': d.userAgent } });
  if (!res.ok) throw new Error(`下载失败：上游 HTTP ${String(res.status)}`);
  if (!res.body) throw new Error('下载失败：上游没有给响应体');

  const headerLength = Number(res.headers.get('content-length'));
  const total = Number.isFinite(headerLength) && headerLength > 0 ? headerLength : expectedSize;
  const hash = createHash('sha512');
  let bytes = 0;
  let lastReportAt = 0;
  const handle = await open(partPath, 'w');
  try {
    const reader = res.body.getReader();
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const value = chunk.value;
      if (!value || value.byteLength === 0) continue;
      hash.update(value);
      await handle.write(value);
      bytes += value.byteLength;
      const now = Date.now();
      // 150ms 一次：27 MB 会切成几千个 chunk，每个都推一次等于把 IPC 灌满
      if (now - lastReportAt >= 150) {
        lastReportAt = now;
        reportProgress(
          itemId,
          total > 0 ? Math.min(100, Math.round((bytes / total) * 1000) / 10) : null,
        );
      }
    }
  } finally {
    await handle.close();
  }
  reportProgress(itemId, 100);
  /*
   * ⚠️ 再读一次**磁盘上**的字节数：上面那个 `bytes` 是"从网络流进来多少"，
   *    与"真的写下去了多少"是两件事（磁盘满、盘被拔、写入被中断都会有差别）。
   *    两条互相印证的读数不一致 ⇒ 直接失败（spec §7.3 第 3 步要校验字节数）。
   */
  const onDisk = statSync(partPath).size;
  if (onDisk !== bytes) {
    throw new Error(
      `写到磁盘的字节数（${String(onDisk)}）与从网络读到的（${String(bytes)}）不一致`,
    );
  }
  return { sha512: hash.digest('hex'), bytes };
}

/**
 * 真正干活的更新（spec §7.3 的五步）。返回值而不是抛，是为了让 `updateAll` 能继续下一条
 * （spec §7.4："中途不因为一条失败而停"）；IPC 那一层（`update()`）再把失败翻成 reject。
 */
async function runUpdate(itemId: string): Promise<UpdateOutcome> {
  const item = current.catalog?.items.find((i) => i.id === itemId);
  if (!item) return { status: 'failed', message: `目录里没有这一条：${itemId}` };

  const binding = stateFile.items[item.id];
  if (!binding || binding.localPath === '') {
    return { status: 'failed', message: '这一条还没有绑定文件' };
  }

  // ① 状态必须是"可更新"（outdated / unknown-local）—— 期望值只能来自一次检查
  const state = current.items.find((v) => v.item.id === item.id)?.state;
  if (!state || !needsUpdate(state)) {
    return { status: 'failed', message: '这一条现在不是「可更新」状态（先点一次「检查」）' };
  }
  if (state.kind !== 'outdated' && state.kind !== 'unknown-local') {
    // needsUpdate 只说"要不要更新"，不负责收窄类型；这一步是给它补上类型层的保证
    return {
      status: 'failed',
      message: '内部状态不一致：needsUpdate 为真但 kind 不是可更新的两种',
    };
  }
  // 按 itemId 加锁（spec §8）：连点两次时第二次直接返回"正在更新中"，不许两次写同一路径
  if (current.busyItemId !== null) {
    return { status: 'failed', message: `正在更新中：${current.busyItemId}（一次只写一个文件）` };
  }

  const localPath = binding.localPath;
  /*
   * ⚠️★ 顺手 1：上游给的文件名是**不受我们控制的字符串**，直接 `join` 进去就可能把写入引到
   *    目标目录之外（`..\\..\\x.jar`）。`basename` 把它压回一个纯文件名 —— 这条通道的第一步
   *    纪律是"路径由主进程自己决定"，而上游的字符串不该有能力推翻它。
   *    （上游真给了一个带目录的名字时，我们落盘的是它的文件名部分；URL 与 sha512 仍然是上游的，
   *     所以校验不受影响、失败也会原样报出来。）
   */
  const targetName = basename(state.latestFileName);
  const targetPath = join(dirname(localPath), targetName);
  const partPath = `${targetPath}.part`;
  const sameTarget = sameFilePath(localPath, targetPath);
  const fromVersion = state.localVersion;
  const disabling = isDisabledPath(localPath);

  current = { ...current, busyItemId: item.id, progress: null };
  broadcast();
  let renamed = false;
  try {
    /*
     * ②-a 被禁用的绑定（`.jar.disabled`）：单条更新会把它换成**启用状态**的文件，
     *     游戏下次启动就会加载它 —— 那是改变用户设置的动作，必须问一次（必修 3）。
     *     ⚠️ `updateAll` 反过来是**跳过**（spec §8 写明的），所以这里问、那里不问：
     *        用户点"一键更新"时不该被一个弹窗挡住，而"就更新这一条"是他明确指着一个文件点的。
     */
    if (disabling) {
      const ok = await confirmEnable(targetPath);
      if (!ok) {
        return { status: 'skipped', message: '这一条现在是禁用状态（.disabled），用户选择不启用' };
      }
    }

    // ②-b 目标位置已经有文件 ⇒ 先问（"同名但不是我们记的那一份"绝不覆盖）
    if (existsSync(targetPath)) {
      const targetHash = await sha512OfFile(targetPath);
      const recorded = binding.localSha512;
      if (!sameTarget || recorded === null || targetHash !== recorded) {
        const ok = await confirmOverwrite(targetPath, recorded, targetHash);
        if (!ok)
          return { status: 'skipped', message: '目标位置已经有一个同名文件，用户选择不覆盖' };
      }
    }

    /*
     * 上一次尝试留下的 `.part`（下载中途断网 / 断电，spec §8 那一行）：先清掉再下。
     * 不清的话，这次的下载会从一个**半成品**继续写（`open(partPath,'w')` 会截断，但那是运气），
     * 而且残留文件会在目录里一直躺到下一次更新。
     * ⚠️ spec 那行还要求"**并说明**"：清理做了，"说明"这一半**只进主进程日志** ——
     *    `FileUpdatesState` 里没有承载这种一次性提示的字段（与 notify() 上面那段同一个原因）。
     *    代价：用户看不到"上次留下了一个半成品、已经帮你清掉"。
     */
    if (existsSync(partPath)) {
      rmSync(partPath, { force: true });
      console.warn('[file-updates] 清掉了上一次留下的半成品：', partPath);
    }

    // ③ 下载到同目录的 .part（边下边算 sha512）
    const downloaded = await downloadTo(partPath, state.latestUrl, state.latestSize, item.id);

    // ④ 校验：sha512 与字节数都要对得上（不一致 ⇒ 抛，下面的 catch 会删掉 .part）
    if (downloaded.sha512 !== state.latestSha512) {
      throw new Error('sha512 与上游不一致 ⇒ 拒绝写入（原文件一个字节都没动）');
    }
    if (downloaded.bytes !== state.latestSize) {
      throw new Error(
        `字节数与上游不一致：下到 ${String(downloaded.bytes)}，上游写的是 ${String(state.latestSize)}`,
      );
    }

    /*
     * ⑤ 换上去。
     *
     * ⚠️ 顺序与 spec §7.3 第 4 步的字面**相反**（那里写的是"删掉旧 jar → rename"）：
     *    这里先 rename（同卷、原子的），再删掉旧名字那份。理由：先删的话，
     *    删成功而 rename 失败（被杀毒软件或正在运行的游戏占着、磁盘满）就是
     *    "用户的 jar 没了，目录里只剩一个 .part"；反过来最坏只是目录里短暂同时有两个版本。
     *    spec 那一步要的两件事都还在：不留旧副本（下面那次 rm）、同卷原子改名。
     *    代价：rename 之后、rm 之前进程被杀 ⇒ 旧的那份会留在目录里（它不在跟踪里，
     *    下次 bindFolder 也不会挑它，因为版本更低）。
     */
    renameSync(partPath, targetPath);
    renamed = true;
    if (!sameTarget) {
      try {
        rmSync(localPath, { force: true });
      } catch (error) {
        // 新版已经在位了 ⇒ 不能因为"旧副本删不掉"把这次更新判失败；但也不能装没看见
        console.warn('[file-updates] 旧副本删不掉，请手动清理：', localPath, error);
      }
    }

    // 重读确认版本（**不是**相信我们刚写的东西）
    const after = await readLocal(targetPath);
    if (!after.ok) throw new Error(`换上新文件之后读不出它：${after.detail ?? after.reason}`);
    const now = Date.now();
    /*
     * ⚠️★ 写回时**只带去这次更新拥有的那几个字段**，并且以**当前**记录为基
     *    —— 绝不用下载**之前**抓到的那份 `binding` 整条写回（评审必修 1）。
     *
     * 为什么不能整条写回：下载要几十秒，而这期间用户完全可能改「自动更新」那个勾选
     * （`setAutoUpdate` 是就地改 `stateFile` 并立刻落盘的，它没有忙守卫）⇒
     * `{...binding}` 会把那个改动**静默**覆盖回旧值（界面只在 `busyItemId` 非空时禁用勾选框，
     * 那只是"通常挡住了"，不是保证）。整条写回的失败形态是"用户改了、界面回弹、没人报错"。
     *
     * 基从哪里取：**内存里的 `stateFile`**（进程内唯一权威，`setAutoUpdate` / `bind` / `unbind`
     * 都就地改它并立刻落盘）——不重新 `readStateFile()`，因为磁盘那份是本进程自己的快照，
     * 从磁盘再读一次只会把"唯一权威"拆成两个来源（单实例锁保证了没有第二个写者）。
     * 代价：状态文件里 `lastCheckedAt` 这一格**不由更新写**（它是"检查"的事实，
     * 不在这次更新拥有的字段里）—— 换完文件后那一格显示的还是上一次检查/绑定的时间，
     * 界面上的"这次读数时间"来自内存里的检查事实，所以看不到这个差别。
     *
     * `localPath` 也在拥有的字段里：跟踪的路径要跟着上游的文件名走（上游换名是常态）。
     */
    const latestRecord = stateFile.items[item.id];
    if (!latestRecord) {
      /*
       * 下载期间这条被 `unbind` 了 ⇒ **不复活**它（用户明确解绑过），也不写状态文件。
       * 文件确实换好了 ⇒ 仍按 updated 返回；这一行此后在界面上是"未绑定"。
       */
      console.warn('[file-updates] 更新期间这一条被解绑了，不再写回它的记录：', item.id);
      current = { ...current, items: rebuildItems() };
      return { status: 'updated', from: fromVersion, to: after.version };
    }
    if (latestRecord.localPath !== localPath) {
      /*
       * 下载期间这条被**重绑到别的文件**了（`bind` / `bindFolder` 会整条换掉记录）。
       * ⇒ 用户最新的选择赢：这次更新换掉的那个文件已经不是被跟踪的那一份了，
       *   所以**一个字段都不写**（写 localPath 等于把用户的重新选择顶掉；
       *   写 version/hash 又是在描述一个不再被跟踪的文件）。只留一行日志。
       * 文件确实换好了 ⇒ 仍按 updated 返回。
       */
      console.warn(
        '[file-updates] 更新期间这一条被重绑到别的文件了，不再写回它的记录：',
        item.id,
        `${localPath} → ${latestRecord.localPath}`,
      );
      current = { ...current, items: rebuildItems() };
      return { status: 'updated', from: fromVersion, to: after.version };
    }
    stateFile.items[item.id] = {
      ...latestRecord,
      localPath: targetPath,
      localVersion: after.version,
      localSha512: await sha512OfFile(targetPath),
      lastUpdateAt: now,
      lastUpdateFrom: fromVersion,
      lastUpdateTo: state.latestVersion,
    };
    writeStateFile(stateFile);
    liveLocal.set(item.id, after);
    /*
     * 这一行现在是"已是最新"还是"上游没有这个版本"，由**重读出来的版本**与上游比出来
     * （`rebuildItems` 走的就是检查那条路）—— 不是我们把 latestVersion 直接填上去。
     * ⚠️ 已知边界：若某个 mod 的 `fabric.mod.json.version` 与 Modrinth 的 `version_number`
     *    不是同一个串（这个 mod 上两者相同，spec §3 的读数），刚更新完那一行会显示
     *    "上游没有这个版本"。sha512 已经证明字节就是上游那一份，所以这里不把它当失败。
     */
    current = { ...current, items: rebuildItems() };
    return { status: 'updated', from: fromVersion, to: after.version };
  } catch (error) {
    /*
     * 收尾：把下载到一半的 `.part` 删掉（spec §7.3 第 3 步）。
     * ⚠️ `renamed` 之后出事就不是"原地不动"了 —— 那时 .part 已经不在了（rename 走了），
     *    文案也要说清"文件已经换好"，不能让用户以为白下了一场。
     * ⚠️★ 顺手 4：**只有真的建过 `.part` 才谈"删掉它"**。原先这里无条件写"（已删掉下载到
     *    一半的 .part）"—— 而在第②步（覆盖确认 / 禁用确认）失败或 `fetch` 就被拒的情况下
     *    根本一个字节都没下过，那句话是**谎报清理**。现在按实际做过什么说。
     */
    let partNote = '';
    if (!renamed && existsSync(partPath)) {
      try {
        rmSync(partPath, { force: true });
        partNote = existsSync(partPath)
          ? '（.part 没能删掉，下次更新前会再清一次）'
          : '（已清掉下载到一半的 .part）';
      } catch {
        partNote = '（.part 没能删掉，下次更新前会再清一次）';
      }
    }
    const message = renamed
      ? `文件已经换好了，但换完之后的那一步失败：${messageOf(error)}`
      : `${messageOf(error)}${partNote}`;
    console.error('[file-updates] 更新失败：', item.id, message);
    return { status: 'failed', message };
  } finally {
    current = { ...current, busyItemId: null, progress: null, items: rebuildItems() };
    broadcast();
  }
}

/**
 * IPC 那一层：失败要能被页面看见 ⇒ 翻成 reject（`ipcMain.handle` 会把消息带回去）。
 *
 * ⚠️ 入口先过 `assertNotBusy()`：**批量进行中**（`bulkRunning`）也要拒绝，
 *    不能只在"某一条正在写盘"时拒绝 —— 见 `assertNotBusy` 的注释。
 */
async function update(itemId: unknown): Promise<FileUpdatesState> {
  const item = requireItem(itemId);
  assertNotBusy();
  const outcome = await runUpdate(item.id);
  if (outcome.status === 'failed') throw new Error(outcome.message);
  // skipped（用户自己按了"取消"）不算错误：状态原样返回，那一行还是"可更新"
  return current;
}

/**
 * 批量（`updateAll`）是否在进行中 —— **跨条目**持续到整个批量结束。
 *
 * ⚠️★ 为什么需要它（评审必修 2）：`busyItemId` 只表示"**某一个条目**正在写盘"，
 *    它在条目与条目之间是 `null`，而 `updateAll` 是一串 `runUpdate` ⇒ 那个空档里
 *    入口守卫（只看 `busyItemId`）会**放行**第二次点击 / 第二次 `updateAll()`
 *    —— 也就是"守卫只靠调用方（界面）自觉"的形状。
 *    ⇒ 批量期间用一个持续到结束的标记把它挡住（界面上的 `pending` 是第二层，不是唯一一层）。
 */
let bulkRunning = false;

/**
 * 入口守卫：**单条与批量都不许在另一个写盘流程进行中进来**。
 *
 * ⚠️ 两种拒绝的文案不同，因为用户看到的动作不同：
 *   · `bulkRunning` ⇒ "正在一键更新"（第三次点击/单条更新都撞在这上面）；
 *   · `busyItemId` 非空 ⇒ "正在更新中：<哪一条>"（两次单条更新撞在一起）。
 * 两者**都是立刻拒绝**：不排队、也不半执行（排队会让用户以为点了没反应）。
 */
function assertNotBusy(): void {
  if (bulkRunning) throw new Error('正在一键更新（一次只写一个文件）—— 等它跑完再试');
  if (current.busyItemId !== null) {
    throw new Error(`正在更新中：${current.busyItemId}（一次只写一个文件）`);
  }
}

/**
 * 让出一次事件循环。
 *
 * ⚠️ 两个用途，都是真的：
 *   ① 两次 27 MB 下载之间、以及批量起手时，主进程能处理积压的 IPC / 渲染消息
 *      （长时间只跑下载会让窗口看起来卡住）；
 *   ② 它让"批量进行中、但没有任何条目正在写盘"那一刻**真的可达**（外部消息能落在那里）
 *      —— 也就是评审必修 2 说的那个空档。⇒ `bulkRunning` 守的不再是一个理论上不可达的状态。
 * 代价：批量比"一条接一条不停手"多几个事件循环轮次（微秒级）。
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * 一键更新：**串行**逐个 `runUpdate`。
 *
 * ⚠️ 串行不是保守，spec §7.4 的理由是"27 MB × N 并行会顶满带宽，而且失败时看不清是谁失败的"。
 * ⚠️ 跳过 `.disabled` 的绑定（spec §8）：把一个被禁用的文件换上去 = 改变用户没要求的行为。
 *    这种跳过**不写进 `lastRun.failed`** —— 那一栏的语义是"失败"，混进去会让汇总说"失败 1"；
 *    而页面上那一行本身有「已禁用」徽章（T1 的 `state.disabled` 就是给它用的），解释在行内。
 *    代价：只看汇总（不看行）的用户看不出有一行被跳过了。
 * ⚠️ 另一种"没更新"会落进 `failed`：用户在覆盖确认框里按了"取消"。`lastRun` 只有
 *    `updated` / `failed` 两栏（T1 定死的形状），没有"跳过"的位置 ⇒ 它带着理由进 `failed`，
 *    汇总会说"失败 1"。代价：那句"失败"其实是用户自己的选择；要分得更细得改契约。
 * ⚠️ 整个批量期间 `bulkRunning` 为真（`finally` 里清）⇒ 这期间任何 `update()` /
 *    第二次 `updateAll()` 都被**立刻拒绝**（不是排队，也不是半执行）。
 */
async function updateAll(): Promise<FileUpdatesState> {
  assertNotBusy();
  const targets = current.items.filter(
    (v) =>
      v.binding !== null &&
      v.binding.localPath !== '' &&
      needsUpdate(v.state) &&
      !isDisabledPath(v.binding.localPath),
  );
  const updated: string[] = [];
  const failed: { itemId: string; message: string }[] = [];
  bulkRunning = true;
  try {
    await yieldToEventLoop();
    for (const view of targets) {
      const outcome = await runUpdate(view.item.id);
      if (outcome.status === 'updated') updated.push(view.item.id);
      else failed.push({ itemId: view.item.id, message: outcome.message });
      // 条目之间也放一次（见 yieldToEventLoop 的注释）
      await yieldToEventLoop();
    }
    current = { ...current, lastRun: { at: Date.now(), updated, failed } };
    broadcast();
    return current;
  } finally {
    bulkRunning = false;
  }
}

// ---------------------------------------------------------------------------
// 装配
// ---------------------------------------------------------------------------

/**
 * 注册九条通道里的八条（第九条 `onStatus` 是**推**给页面的，主进程只 `send`，没有 handler）。
 *
 * ⚠️★ 通道名一律取自 `FILE_UPDATES_CHANNELS`（`@mcsr/shared/desktop`），不写字符串字面量：
 *    写错一个字母**类型检查看不见**（它们只是字符串），而失败形态是静默的
 *    （`invoke` 没有 handler 时 reject、页面那一步"什么都没发生"）。
 *    与 preload 共用同一个常量对象之后，两边各自手写一遍从而漂移就不可能发生。
 *    剩下的一种失效是"两边都忘了注册"—— 那种情况下两处指的是同一串，排障时一眼能对上。
 */
function registerIpc(): void {
  ipcMain.handle(FILE_UPDATES_CHANNELS.getState, () => current);
  ipcMain.handle(FILE_UPDATES_CHANNELS.bind, (_event, itemId: unknown) => bind(itemId));
  ipcMain.handle(FILE_UPDATES_CHANNELS.bindFolder, () => bindFolder());
  ipcMain.handle(FILE_UPDATES_CHANNELS.unbind, (_event, itemId: unknown) => unbind(itemId));
  ipcMain.handle(FILE_UPDATES_CHANNELS.setAutoUpdate, (_event, itemId: unknown, on: unknown) =>
    setAutoUpdate(itemId, on),
  );
  ipcMain.handle(FILE_UPDATES_CHANNELS.check, (_event, force: unknown) => check(force === true));
  ipcMain.handle(FILE_UPDATES_CHANNELS.update, (_event, itemId: unknown) => update(itemId));
  ipcMain.handle(FILE_UPDATES_CHANNELS.updateAll, () => updateAll());
}

/**
 * 初始化：读状态文件 → 注册八条 IPC → 拉一次目录 → （打包态）启动检查一次。
 *
 * ⚠️★ **启动检查只有这一处**（控制器裁决）：`main.ts` 里不要再出现第二个"负责启动检查"的
 *    调用 —— 两处都负责会出现"检查两次"或"谁都没调"，而这两种都不报错。
 *    所以"什么时候检查"这件事的判据（`isPackaged`）走参数进来，而不是让调用方分两处写。
 *
 * ⚠️ 返回得很快：目录与检查都在**后台**跑（`startUp`）——
 *    `main.ts` 里这个 `await` 在创建窗口之前，而把一次网络往返放进去就是"窗口要等网络"。
 *    顺序仍然是安全的：八条 handler 已经注册好了，页面加载完之后 `getState()` 一定能拿到值。
 *
 * ⚠️ 启动时无条件写一次状态文件：让"这个功能有没有跑起来"有一个看得见、可核对的产物
 *    （全新安装时内容是 `{"version":1,"items":{}}`），同时把"坏文件重建为空"这个结果立刻落盘。
 *    代价：每次启动都写一个几十字节的 JSON（即使内容没变）。
 */
export async function initFileUpdates(ctx: {
  isPackaged: boolean;
  appVersion: string;
  siteOrigin: string;
}): Promise<void> {
  deps = {
    siteOrigin: ctx.siteOrigin,
    // Modrinth 的 API 文档要求带能标识自己的 User-Agent（spec §6.4 给了这个形状）
    userAgent: `mcsr-helper-desktop/${ctx.appVersion} (+${ctx.siteOrigin})`,
    fetchCatalog: fetchCatalogFromSite,
  };

  const read = readStateFile();
  if (read.fatal) {
    /*
     * ⚠️★ 坏文件**连备份都失败**（必修 2）：停住写入，并把准确的原因（含那个文件的路径）
     *    交给用户 —— 这一步的价值就是"宁可不工作，也不抹掉他的绑定路径"。
     *    这里**故意不写状态文件**（`stateFileWritable = false` ⇒ 后面所有写路径都会拒绝），
     *    也**故意不**注册成"什么都没绑定"的正常样子去覆盖它。
     */
    stateFileWritable = false;
    stateFileBlockedReason = read.fatal;
    stateFile = { version: 1, items: {} };
    console.error('[file-updates] 状态文件停用：', read.fatal);
    notify('本地文件的状态文件读不出来，而且备份失败', read.fatal);
  } else {
    stateFileWritable = true;
    stateFileBlockedReason = null;
    stateFile = read.state ?? { version: 1, items: {} };
    try {
      writeStateFile(stateFile);
    } catch (error) {
      console.error('[file-updates] 状态文件写不进去：', error);
    }
    if (read.recovered) notify('本地文件的状态文件读不出来', read.recovered);
  }

  registerIpc();
  current = { ...current, items: rebuildItems() };
  broadcast();

  void startUp(ctx.isPackaged).catch((error) => {
    console.error('[file-updates] 启动流程出错：', error);
  });
}

async function startUp(isPackaged: boolean): Promise<void> {
  await loadCatalog();
  broadcast();
  if (!isPackaged) {
    /*
     * 开发态不自动检查上游（spec §6.4：启动检查是"app.isPackaged 时"）。
     * ⚠️ 这一行**是**给开发者的手边判据：它说明"上面那一次启动什么都没查"，
     *    免得有人把"开发态看到的状态是空的"当成缺陷。绑定一条之后会立刻检查一次。
     */
    console.log(
      '[file-updates] 开发态：不自动检查上游（打包态才在启动时检查一次）；绑定一条之后会立刻检查。',
    );
    return;
  }
  /*
   * 启动检查（spec §6.4：`app.isPackaged` 时启动后检查一次）。
   *
   * ⚠️★ 查的是 **`autoUpdate === true` 的已绑定条目**（`scope: 'auto'`，控制器 2026-09-24 裁决 ③）。
   *    分界逐条写在这里，改之前先读完：
   *      ① **启动检查（这一处）**：只查开着开关的条目 —— 这正是那个勾选框的全部意义
   *         （spec 决定 4："开关打开 ⇒ 启动时检查并高亮/提醒"）。不筛的话开关什么都不控制，
   *         用户在界面上看到的是一个**开不动的开关**，比没有它更坏。
   *      ② **手动「检查」**（`FILE_UPDATES_CHANNELS.check`，带不带 `force`）：查**全部**已绑定条目，
   *         含关掉开关的 —— "我想现在就看一眼"永远有路，否则关掉开关等于把这个条目从界面上废掉。
   *      ③ **绑定/按目录绑定之后**：立刻查一次（那一条自己），与开关无关。
   *   代价（写在明处）：**关掉开关的条目在启动时不刷新** ⇒ 它显示的是**上一次的读数**，
   *   界面要能看出"这是几时读的"（`FileItemView.lastCheckedAt` 就是给它用的）。
   *   ⚠️ 跨重启之后连上次的读数也没有了（读数只活在内存里，见 `readLocal` 的注释）⇒
   *   那种条目显示 `unchecked`，要点一次「检查」—— 这是"不吃缓存"那条纪律的另一面，不是缺陷。
   *   ⚠️ 新绑定默认就是 `autoUpdate: true`（见 `bind()` / `bindFolder()`），所以用户不会
   *   "绑了却没被自动看着"。
   */
  console.log('[file-updates] 启动检查：读本地版本 + 查 Modrinth（只查开了自动更新的条目）');
  await check(false, 'auto');
}
