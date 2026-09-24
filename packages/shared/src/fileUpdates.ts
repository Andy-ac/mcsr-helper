/**
 * 「本地文件自动更新」的契约与纯逻辑 —— **三边共用**（Electron 主进程 / preload / 网页）。
 *
 * ⚠️ 为什么这几样东西必须住在这里，而不是各自写在桌面端或网页端：
 *   1. `apps/desktop` **没有测试运行器**（只有 typecheck）⇒ 凡是要写断言的纯逻辑住在这里才有判据；
 *   2. 「目录 JSON 的校验」服务端与桌面端**都要做**。各写一份一定会漂，
 *      而漂的方向是"接口收了、桌面端拒了"（或反过来），两边都很自信；
 *   3. 挑最新版这条规则要被一条能红的断言钉住，而**判据落在"回滚发版"那条用例上**：
 *      上游**真的跳过了 5.8.24**，但"跳号"本身**不足以区分**两种实现
 *      （5.8.26 / 5.8.25 / 5.8.23 的字符串序恰好等于日期序）—— 号更小、日期更新时才分得开。
 *
 * ⚠️ 这里**不发网络请求、不碰文件系统**：两边各自注入数据（服务端读文件、主进程读磁盘 + 打 HTTP）。
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// 可追踪目录（服务端的 content/file-catalog.json）
// ---------------------------------------------------------------------------

/** 这一期只有 Modrinth。加来源时要**同时**加解析实现，不能只加名字。 */
export const FILE_SOURCE_PROVIDERS = ['modrinth'] as const;
export type FileSourceProvider = (typeof FILE_SOURCE_PROVIDERS)[number];

export const FileSourceSchema = z
  .object({
    provider: z.enum(FILE_SOURCE_PROVIDERS),
    /** Modrinth 的 slug 或 id（`mcsr-ranked` / `I9W1u5Ac`，API 两种都吃）。 */
    project: z.string().min(1),
    /** ★ 绑定时的核对项：jar 内 `fabric.mod.json` 的 `id` 必须等于它。 */
    modId: z.string().min(1),
    gameVersion: z.string().min(1),
    loader: z.string().min(1),
    channel: z.enum(['release', 'beta', 'alpha']),
  })
  .strict();

export const FileCatalogItemSchema = z
  .object({
    /** 稳定标识：状态文件、IPC 参数、i18n 覆盖键都用它。**发布后不许改。** */
    id: z.string().min(1),
    /** 产品名，不翻译。 */
    name: z.string().min(1),
    kind: z.enum(['mod']),
    note: z.string().optional(),
    source: FileSourceSchema,
  })
  .strict();

export const FileCatalogSchema = z
  .object({
    version: z.literal(1),
    items: z.array(FileCatalogItemSchema),
  })
  .strict();

export type FileSource = z.infer<typeof FileSourceSchema>;
export type FileCatalogItem = z.infer<typeof FileCatalogItemSchema>;
export type FileCatalog = z.infer<typeof FileCatalogSchema>;

export type CatalogParseResult =
  | { ok: true; catalog: FileCatalog }
  | { ok: false; problems: string[] };

/**
 * 校验目录。**服务端与桌面端共用这一份**（各写一份一定会漂）。
 *
 * 失败时返回**指名道姓**的问题列表：只说"目录不合法"的话，值班的人得自己猜是哪一条。
 */
export function parseFileCatalog(raw: unknown): CatalogParseResult {
  const parsed = FileCatalogSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(根)'}: ${issue.message}`,
      ),
    };
  }
  // id 必须唯一：重复的表现是"状态文件里两条记录互相当对方的"，而两边都很自信。
  const seen = new Set<string>();
  const duplicated: string[] = [];
  for (const item of parsed.data.items) {
    if (seen.has(item.id)) duplicated.push(item.id);
    seen.add(item.id);
  }
  if (duplicated.length > 0) {
    return { ok: false, problems: [`items[].id 重复：${duplicated.join(', ')}`] };
  }
  return { ok: true, catalog: parsed.data };
}

// ---------------------------------------------------------------------------
// Modrinth 的响应形状（只声明我们用到的字段）
// ---------------------------------------------------------------------------

export interface ModrinthFile {
  filename: string;
  url: string;
  size: number;
  primary?: boolean;
  hashes: { sha1?: string; sha512?: string };
}

export interface ModrinthVersion {
  id: string;
  version_number: string;
  version_type: string;
  /** ISO 8601。**挑最新版只能用它**，不能用 version_number 比大小。 */
  date_published: string;
  game_versions: string[];
  loaders: string[];
  files: ModrinthFile[];
}

/** 主文件（没有 primary 就取第一个；一个文件都没有 ⇒ null）。 */
export function primaryFileOf(version: ModrinthVersion): ModrinthFile | null {
  return version.files.find((f) => f.primary === true) ?? version.files[0] ?? null;
}

export function jarFileNameFor(version: ModrinthVersion): string | null {
  return primaryFileOf(version)?.filename ?? null;
}

/**
 * 挑"最新的一版"。
 *
 * ⚠️★ **按 `date_published` 取最大，不做版本号大小比较。**
 *    实测：上游的 release 序列是 5.8.26 / 5.8.25 / **5.8.23** / 5.8.22 —— 5.8.24 从来不存在。
 *    ⚠️ 但"跳号"这件事**单独不构成判据**：号与日期同序时，比号大小的实现也答对
 *      （测试里"上游真的跳过了号"那一条正是这种情况，它区分不了两种实现）。
 *      能咬住"比版本号"的是**回滚发版**那一条（号更小、日期更新）。
 *    任何 semver 比较在**回滚发版**时都会给出错误的答案，而错误的答案在这里的
 *    表现是"让人从新版退回旧版"，比不更新更糟。
 */
export function pickLatestVersion(
  versions: readonly ModrinthVersion[],
  source: Pick<FileSource, 'gameVersion' | 'loader' | 'channel'>,
): ModrinthVersion | null {
  const matching = versions.filter(
    (v) =>
      v.version_type === source.channel &&
      v.game_versions.includes(source.gameVersion) &&
      v.loaders.includes(source.loader),
  );
  if (matching.length === 0) return null;
  return matching.reduce((best, v) =>
    Date.parse(v.date_published) > Date.parse(best.date_published) ? v : best,
  );
}

/**
 * 本地版本与最新版本的关系。
 *
 * ⚠️ 为什么还要 `all` 这个参数：区分"本地是上游的某个旧版"与"本地这个版本号上游根本没有"。
 *    两者的动作完全不同 —— 前者点更新是**升级**，后者点更新可能是**降级**
 *    （用户装的是自编译/改过的 jar），所以文案与按钮语义都要分开。
 */
export function compareLocalToLatest(
  local: string,
  latest: ModrinthVersion,
  all: readonly ModrinthVersion[],
): 'up-to-date' | 'outdated' | 'unknown-local' {
  if (local === latest.version_number) return 'up-to-date';
  return all.some((v) => v.version_number === local) ? 'outdated' : 'unknown-local';
}

// ---------------------------------------------------------------------------
// 本机状态（只存在 userData 里，不上传）
// ---------------------------------------------------------------------------

export interface FileBinding {
  localPath: string;
  /**
   * 只表示"启动时检查并高亮"。**写盘永远要一次点击**。
   *
   * ⚠️ 它**真的**在筛选（2026-09-24 的裁决）：主进程的启动检查**只查 `autoUpdate === true` 的条目**；
   *    手动点「检查」永远查全部（那样"我想现在看一下"总有路）。所以关掉开关的代价是
   *    **启动时那一条不刷新**（界面显示的是上一次的读数，`FileItemView.lastCheckedAt` 就是给它看的）。
   *    T1 只声明字段，这条纪律的实现与注释在 `apps/desktop/src/file-updates.ts` 的一处（`startUp`）。
   */
  autoUpdate: boolean;
}

export type FileItemState =
  | { kind: 'unbound' }
  | { kind: 'missing-file'; localPath: string }
  /**
   * 已绑定、文件也在，但**这一次进程里还没有拿到过读数**（还没检查过 / 启动检查跳过了它）。
   *
   * ⚠️★ 为什么要有这一支（2026-09-24 的裁决）：没有它的时候"还没检查过"只能挤进 `error`，
   *    而界面对 `error` 的文案是"读取失败：…" ⇒ **对用户说假话**（他没读失败，是还没读）。
   *    计划里的词条本来就有"还没检查过"这一格（`files.notChecked`）⇒ 缺的是契约这一边，不是界面。
   * ⚠️ 它**不是**"可更新"：`needsUpdate` 对它返回 false（没有上游期望值就没法说要不要更新）。
   */
  | { kind: 'unchecked'; localPath: string }
  | { kind: 'current'; localPath: string; localVersion: string; latestVersion: string }
  | {
      kind: 'outdated' | 'unknown-local';
      localPath: string;
      localVersion: string;
      latestVersion: string;
      latestFileName: string;
      latestUrl: string;
      latestSha512: string;
      latestSize: number;
      disabled: boolean;
    }
  | { kind: 'error'; localPath?: string; message: string };

export interface FileItemView {
  item: FileCatalogItem;
  binding: FileBinding | null;
  localVersion: string | null;
  state: FileItemState;
  lastCheckedAt: number | null;
  /**
   * 最近一次**成功**读到的最新版本，以及读到它的时间。
   *
   * ⚠️★ 为什么要有这一格（2026-09-24 评审的必修 1）：spec §8 要求"上游连不上 ⇒ 状态 `error`
   *    **并保留上次成功的最新版本、标注它是几时读的**"。而 T1 的 `FileItemState` 里没有任何
   *    一格能同时表达"版本 + 读到它的时间"（`error` 只有 `message`）⇒ 那一句要求当时**做不到**，
   *    只能让主进程把过期读数当正常读数显示（评审判为"粉饰"，属实）。
   * ⚠️ 它**只活在内存里**（进程重启就没了）：状态文件**故意**不存最新版本 ——
   *    那是 plan 里写死的设计（落盘就会某天拿过期数字当事实说"你已是最新"）。
   *    ⇒ 冷启动 + 网络不可达时它就是 `null`，界面必须诚实地说"本次还没成功读到过"，
   *      不许编一个（主进程那句 `message` 也照这个口径写）。
   * ⚠️ 它**不代表"可以更新"**：这次检查失败时 `state` 是 `error`，`needsUpdate` 为 false，
   *    这一格只是给界面显示"上次看到的是 5.8.26（14:03 读到）"。
   */
  lastKnownLatest: { version: string; fetchedAt: number } | null;
}

/** 推给页面、也由页面当作唯一数据来源的整份状态。 */
export interface FileUpdatesState {
  catalog: FileCatalog | null;
  catalogError: string | null;
  items: FileItemView[];
  /** 正在写盘的那一条（其余条目在它结束前不许写盘）。 */
  busyItemId: string | null;
  progress: { itemId: string; percent: number | null } | null;
  lastCheckedAt: number | null;
  lastRun: { at: number; updated: string[]; failed: { itemId: string; message: string }[] } | null;
}

/**
 * 这一条现在需不需要更新（一键更新的取项判据，网页与主进程共用）。
 *
 * ⚠️ `unchecked`（还没拿到读数）**不算**要更新：没有上游期望值就说"要更新"是编出来的结论。
 *    测试里有一条断言钉着这件事（`services/api/src/file-updates-shared.test.ts` 的 kind 表）。
 */
export function needsUpdate(state: FileItemState): boolean {
  return state.kind === 'outdated' || state.kind === 'unknown-local';
}

/** `.jar.disabled` 这类被禁用的文件名（游戏不会加载它）。 */
export function isDisabledPath(localPath: string): boolean {
  return localPath.toLowerCase().endsWith('.disabled');
}

/**
 * 同一个 mod 在用户目录里有**多个副本**时，哪一个才算"版本更高"。
 *
 * ⚠️★ 这**不是**上游的"最新版"规则 —— 上游必须按 `date_published` 选（回滚发版时比版本号会选错，
 *    见 `pickLatestVersion`）。这里比的是**已经躺在用户目录里的两份副本**，按数字段逐段比：
 *    `'3.0.10'` > `'3.0.2'`（字符串序恰好相反：`'3.0.2' > '3.0.10'`），所以不能拿字符串比。
 * ⚠️ 解析不出数字段时退化成字符串序：这一支的结果只决定"先绑哪一份"，
 *    用户随时可以用 `bind(itemId)` 指定某一个具体文件。
 * ⚠️ 它住在 shared 而不是主进程里（2026-09-24 评审的顺手 6）：`apps/desktop` 没有测试运行器，
 *    留在那边就只能靠 gitignore 的探针验；搬过来之后 `services/api` 里有能红的断言钉着它。
 */
export function compareLocalVersions(a: string, b: string): number {
  const pa = a.split(/[.\-+_]/);
  const pb = b.split(/[.\-+_]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const sa = pa[i] ?? '';
    const sb = pb[i] ?? '';
    const na = /^\d+$/.test(sa) ? Number(sa) : Number.NaN;
    const nb = /^\d+$/.test(sb) ? Number(sb) : Number.NaN;
    if (Number.isFinite(na) && Number.isFinite(nb)) {
      if (na !== nb) return na - nb;
      continue;
    }
    const cmp = sa.localeCompare(sb);
    if (cmp !== 0) return cmp;
  }
  return 0;
}
