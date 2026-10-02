/**
 * mod 目录 v2（数据来自 https://mc.sr/mods/ 的官方 JSON）—— **契约与校验**。
 *
 * ===========================================================================
 * 这一份为什么与 `fileUpdates.ts` 分成两个文件
 * ===========================================================================
 * v1 那一份是"一个 mod × 一个来源（Modrinth）× 一个游戏版本"；这一份是
 * "70 个 mod × 555 条 release × 107 个游戏版本"。两者的 schema、判据、生命周期
 * 都不一样，塞进一个文件只会让两边都难读。而**两端共用一个模块**这条纪律不变
 * （服务端与将来的桌面端/网页引用同一个文件，各写一份一定会漂）。
 *
 * ===========================================================================
 * ★★ 为什么要有"宽松"与"严格"两套校验（这是 v1 那个坑的教训）
 * ===========================================================================
 * v1 的三处 schema 全是 `.strict()`，后果是：**往目录里加一个字段，就是一次破坏性变更** ——
 * 已经装在用户机器上的桌面版会 `safeParse` 失败，整块显示"目录不合法"。
 * 而桌面版加载的是**远端页面**，所以"发个新目录"和"所有人都得先升级桌面版"被绑死了。
 *
 * 这一份拆成两套策略（**同一个 shape，只换 parse 策略**，不许各写一份）；
 * "同一个 shape"是靠下面的 `xxxShape` + 参数化函数落实的：
 *   · `ModCatalogStrictSchema` —— 仓库里的 `content/mod-catalog.json` 用它，
 *     **未知键要红**：配置打错字（`tagz` / `target_version`）必须当场被抓到，
 *     否则它会在界面上的表现是"某一栏空了"，没人查得出原因；
 *   · `ModCatalogWireSchema` —— 线上响应体用它，**未知键忽略**：
 *     以后加字段不再是一次破坏性变更，已装出去的客户端不会被一个新字段判"目录不合法"。
 *
 * ⚠️★ 实测（zod 4.6.2；`.cache/probe-zod.mjs` 的两条 + 这里逐层核对的第三条）：
 *    `.loose()` **保留**未知键、`.strict()` / `z.strictObject()` **拒绝**未知键 ——
 *    **但这两条都只在被调用的那一层生效：`.strict()` 不向下传播。**
 *    它只改自己那一层的 catchall，所以嵌套的普通 `z.object` 会**静默剥掉**未知键，
 *    而"被剥掉"与"配置里压根没写"在界面上**无法区分**。
 *    ⇒ 这就是下面**每个对象都要"一份 named shape、两套 schema"**、
 *      且**嵌套字段绝不允许在两套之间共用同一个子 schema** 的理由 ——
 *      共用一次，就等于把"严格只到根那一层"这个 bug 原样搬回来。
 *    ⇒ 目录那两层（`source`、根）因此写成**参数化**函数，把"用哪一套嵌套"当参数传进去；
 *      参数用泛型而不是 `z.ZodType`，是为了让 `z.infer` 保住 `mods: ModEntry[]`
 *      （标成 `z.ZodType` 会把它推成 `unknown[]`）。
 *
 * ⚠️ 另外：`.loose()` 这一侧解析出来的对象里会带着**根上**的未知键 ——
 *    调用方只读自己认识的字段，这没问题；但**不许**把解析结果再原样回写给服务端。
 */
import { z } from 'zod';
import { compareLocalVersions } from './fileUpdates';

/**
 * 一个 GitHub 加速站。
 *
 * ⚠️ `prefix` 必须**以 `/` 结尾**：镜像地址是 `prefix + 原 URL` 直接拼的，
 *    少了那个斜杠会拼出 `https://gh-proxy.comhttps://github.com/...` —— 一个坏地址，
 *    而它的表现是"下载失败"，看不出是配置少了一个字符。所以在这里拦。
 */
const ModMirrorShape = {
  id: z.string().min(1),
  label: z.string().min(1),
  prefix: z.url().refine((value) => value.endsWith('/'), '镜像前缀必须以 / 结尾（地址是拼出来的）'),
  /** 哪些主机上的 release 能用这个镜像（**非 GitHub 来源没有镜像**）。 */
  hosts: z.array(z.string().min(1)).min(1),
};
export const ModMirrorSchema = z.object(ModMirrorShape);
const ModMirrorStrictSchema = z.strictObject(ModMirrorShape);

/** 标签的显示名。**住在目录里**（不在 i18n 文件里）⇒ 加一个标签不需要发新版客户端。 */
const ModTagLabelShape = {
  zh: z.string().min(1),
  en: z.string().min(1),
};
export const ModTagLabelSchema = z.object(ModTagLabelShape);
const ModTagLabelStrictSchema = z.strictObject(ModTagLabelShape);

/**
 * "这个 mod 的最新版本去上游查"。
 *
 * 这一期**只有一个**（`mcsrranked` → Modrinth），而且是**显式写出来**的，不做自动判断：
 * 判据是"mc.sr 给的版本比上游旧"（实测 mc.sr 是 5.8.22、Modrinth 是 5.8.26），
 * 而那种判断没有通用依据。写错 `upstream` 会让"最新"指向错误的地方。
 */
const ModUpstreamShape = {
  provider: z.literal('modrinth'),
  project: z.string().min(1),
};
export const ModUpstreamSchema = z.object(ModUpstreamShape);
const ModUpstreamStrictSchema = z.strictObject(ModUpstreamShape);

/** `mods[]` 那一层。`upstream` 自己也是嵌套对象 ⇒ 同样走参数化（理由见文件头）。 */
function modEntryShape<U extends z.ZodType>(nested: { upstream: U }) {
  return {
    modid: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    homepage: z.string().optional(),
    /** `legal` = speedrun 合法清单；`extra` = mc.sr 列出的其他 mod。两份清单的 modid 不重叠（实测）。 */
    list: z.enum(['legal', 'extra']),
    /** ★ 界面唯一的筛选维度（另一个维度是游戏版本）。 */
    tags: z.array(z.string().min(1)),
    traits: z.array(z.string().min(1)),
    obsolete: z.boolean(),
    incompatibilities: z.array(z.string().min(1)),
    upstream: nested.upstream,
  };
}
export const ModEntrySchema = z.object(modEntryShape({ upstream: ModUpstreamSchema.nullable() }));
const ModEntryStrictSchema = z.strictObject(
  modEntryShape({ upstream: ModUpstreamStrictSchema.nullable() }),
);

/** `releases[]` 那一层。 */
const ModReleaseShape = {
  modid: z.string().min(1),
  /** 官方版本号，**逐字保留**（比对时要先剥 `+` 之后的构建元数据，见 `versionBodyOf`）。 */
  version: z.string().min(1),
  url: z.url(),
  sha1: z.string().regex(/^[0-9a-f]{40}$/),
  /** ★ 唯一完整性判据（服务端不是信任锚；镜像改了内容只会校验失败）。 */
  sha512: z.string().regex(/^[0-9a-f]{128}$/),
  size: z.number().int().nonnegative(),
  /** 原样保留上游的 `target_version`，**不展开**（展开会把 2 个重复键的歧义藏起来）。 */
  targetVersions: z.array(z.string().min(1)).min(1),
  dependencies: z.array(z.string().min(1)),
  obsolete: z.boolean(),
  /** 上游是数组（可能有多个），原样保留 —— 不假设它只有一个。 */
  intermediary: z.array(z.string().min(1)),
  /** `manual` = 只给"打开原网页"，不给更新按钮（OptiFine 那 54 条就是这一类）。 */
  download: z.enum(['auto', 'manual']),
};
export const ModReleaseSchema = z.object(ModReleaseShape);
const ModReleaseStrictSchema = z.strictObject(ModReleaseShape);

/** `source.urls` 那一层。 */
const ModSourceUrlsShape = {
  mods: z.url(),
  extra: z.url(),
};
const ModSourceUrlsSchema = z.object(ModSourceUrlsShape);
const ModSourceUrlsStrictSchema = z.strictObject(ModSourceUrlsShape);

/**
 * 两份快照各自的 sha256。
 *
 * ⚠️ 这里**故意不是** `generatedAt` 那种时间戳：时间戳会让"重新生成"永远与仓库里的
 *    字节不同，于是 `--check` 必须变成"忽略某个字段再比"（一个必然腐坏的判据）。
 *    换成快照哈希之后，`--check` 退化成**一次逐字节比较**，而且这个值有真实含义：
 *    "这份目录来自哪一份上游字节"。要生成时间就从 git 取。
 */
const ModSourceSha256Shape = {
  mods: z.string().regex(/^[0-9a-f]{64}$/),
  extra: z.string().regex(/^[0-9a-f]{64}$/),
};
const ModSourceSha256Schema = z.object(ModSourceSha256Shape);
const ModSourceSha256StrictSchema = z.strictObject(ModSourceSha256Shape);

/** `source` 那一层：`urls` 与 `sha256` 都是嵌套对象 ⇒ 同样走参数化（理由见文件头）。 */
function modSourceShape<U extends z.ZodType, H extends z.ZodType>(nested: { urls: U; sha256: H }) {
  return {
    urls: nested.urls,
    schemaVersion: z.number().int(),
    sha256: nested.sha256,
  };
}
const ModSourceSchema = z.object(
  modSourceShape({ urls: ModSourceUrlsSchema, sha256: ModSourceSha256Schema }),
);
const ModSourceStrictSchema = z.strictObject(
  modSourceShape({ urls: ModSourceUrlsStrictSchema, sha256: ModSourceSha256StrictSchema }),
);

/**
 * 目录那一层。**同一份 shape、两套嵌套** —— 参数化是为了让"严格"真能下到每一层；
 * 泛型是为了让 `z.infer` 保住 `mods: ModEntry[]`（把参数标成 `z.ZodType` 会推成 `unknown[]`）。
 *
 * ⚠️ 这里**不是**"一个字面量对象 + 两套策略"：嵌套项必须随策略整套换掉，
 *    否则 `mods[0].tagz` 这类打错字会被静默剥掉（见文件头那段机制说明）。
 */
function catalogShape<
  S extends z.ZodType,
  M extends z.ZodType,
  T extends z.ZodType,
  E extends z.ZodType,
  R extends z.ZodType,
>(nested: { source: S; mirror: M; tagLabel: T; entry: E; release: R }) {
  return {
    schema: z.literal(2),
    source: nested.source,
    mirrors: z.array(nested.mirror),
    tagLabels: z.record(z.string(), nested.tagLabel),
    mods: z.array(nested.entry),
    releases: z.array(nested.release),
  };
}

export const ModCatalogWireSchema = z.looseObject(
  catalogShape({
    source: ModSourceSchema,
    mirror: ModMirrorSchema,
    tagLabel: ModTagLabelSchema,
    entry: ModEntrySchema,
    release: ModReleaseSchema,
  }),
);
/** 仓库那一份：`z.strictObject` 只覆盖自己那一层，所以每一层都要换成 strict 那一套。 */
export const ModCatalogStrictSchema = z.strictObject(
  catalogShape({
    source: ModSourceStrictSchema,
    mirror: ModMirrorStrictSchema,
    tagLabel: ModTagLabelStrictSchema,
    entry: ModEntryStrictSchema,
    release: ModReleaseStrictSchema,
  }),
);

export type ModMirror = z.infer<typeof ModMirrorSchema>;
export type ModTagLabel = z.infer<typeof ModTagLabelSchema>;
export type ModUpstream = z.infer<typeof ModUpstreamSchema>;
export type ModEntry = z.infer<typeof ModEntrySchema>;
export type ModRelease = z.infer<typeof ModReleaseSchema>;
export type ModCatalog = z.infer<typeof ModCatalogWireSchema>;

export type ModCatalogParseResult =
  | { ok: true; catalog: ModCatalog }
  | { ok: false; problems: string[] };

/** 与 `fileUpdates.ts` 的 `parseFileCatalog` 同一种话术：失败时**指名道姓**。 */
function problemsOf(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(根)'}: ${issue.message}`);
}

/**
 * 跨字段的一致性检查。**只在严格那一侧跑**：
 * 服务端有义务拒绝服务一份坏目录（500 比"悄悄少几行"好），
 * 而客户端不该因为一个标签缺了显示名就整块不画 —— 那种情况让界面显示标签 key 本身就好。
 */
function crossChecks(catalog: ModCatalog): string[] {
  const problems: string[] = [];
  const modids = new Set<string>();
  for (const mod of catalog.mods) {
    if (modids.has(mod.modid)) problems.push(`mods[].modid 重复：${mod.modid}`);
    modids.add(mod.modid);
  }

  const mirrorIds = new Set<string>();
  for (const mirror of catalog.mirrors) {
    if (mirrorIds.has(mirror.id)) problems.push(`mirrors[].id 重复：${mirror.id}`);
    mirrorIds.add(mirror.id);
  }

  const known = new Set(catalog.mods.map((mod) => mod.modid));
  for (const release of catalog.releases) {
    if (!known.has(release.modid)) {
      problems.push(`releases[] 里的 modid 不在 mods 里：${release.modid}`);
    }
  }

  /*
   * 每个用到的标签都要有显示名。
   * ⚠️ 这一条**只有严格那一侧查**：它约束的是"仓库里那份配置"，不是"线上格式的兼容性"。
   *    没有名字的标签在界面上的表现是"显示一个英文 key"，那是缺陷、要看得见；
   *    但不值得让整份目录判不合法（客户端那一侧因此只降级、不拒绝）。
   */
  const used = new Set(catalog.mods.flatMap((mod) => mod.tags));
  for (const tag of [...used].sort()) {
    if (!(tag in catalog.tagLabels)) problems.push(`标签没有显示名：${tag}`);
  }

  return problems;
}

/**
 * 校验**仓库里那一份**（严格 + 跨字段检查）。
 *
 * ⚠️ 与 v1 一样：**错误是返回的，不是抛的**。调用方要能把 `problems` 原样交给值班的人。
 */
export function parseModCatalog(raw: unknown): ModCatalogParseResult {
  const parsed = ModCatalogStrictSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error) };
  const problems = crossChecks(parsed.data);
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, catalog: parsed.data };
}

/**
 * 校验**线上那一份**（忽略未知字段、不跑跨字段检查）。
 *
 * 代价（写下来）：一个标签缺显示名、或某条 release 引用了不存在的 modid 时，
 * 这里**不会**报错 —— 前者的表现是界面显示 key，后者的表现是那一行点不动。
 * 换来的是"服务端加字段不会把老客户端打死"。服务端那一侧是严格的，所以坏目录出不了门。
 */
export function parseModCatalogWire(raw: unknown): ModCatalogParseResult {
  const parsed = ModCatalogWireSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error) };
  return { ok: true, catalog: parsed.data };
}

// ---------------------------------------------------------------------------
// 展开与查找
// ---------------------------------------------------------------------------

/**
 * 判定层的键：`modid|游戏版本`。
 *
 * ⚠️ 分隔符只此一处。生成器**不许**让 modid 里出现 `|`（它在 `buildCatalog` 里会报错），
 *    否则这个键会有歧义 —— 两个不同的 mod 拼出同一个键，表现是"某一行的版本号串了门"。
 */
export function releaseKey(modid: string, gameVersion: string): string {
  return `${modid}|${gameVersion}`;
}

export interface ModIndex {
  /**
   * ★ 值是**数组**：`(modid, 游戏版本)` 实测不是唯一键（`optifine|1.7.2`、`speedrunigt|26.1`）。
   * ⚠️ 这个 Map 是索引的**内部状态**，按引用活着：要用 `releasesFor` 去查（它给副本），
   *    不要把它取出来就地改 —— `rowsForGameVersion` 就是在这个 Map 上遍历的。
   */
  byPair: Map<string, ModRelease[]>;
  byModid: Map<string, ModEntry>;
  /**
   * 全部游戏版本，**代码单元序**（`'1.16.1'` 排在 `'1.7.10'` **前面**）。
   * ⚠️ 消费者需要数值比较器，**不要**直接把这个数组当成可展示的顺序
   *    （版本下拉框那种"哪个排前面"是另一个决定，不在这里做）。
   */
  gameVersions: string[];
}

/**
 * 把目录展开成查找表。**只做一次**，调用方拿着它查 ——
 * 555 条 release 展开成 1761 个键，每次调用都重算是 O(n)。
 */
export function buildIndex(catalog: ModCatalog): ModIndex {
  const byPair = new Map<string, ModRelease[]>();
  const versions = new Set<string>();
  for (const release of catalog.releases) {
    for (const gameVersion of release.targetVersions) {
      versions.add(gameVersion);
      const key = releaseKey(release.modid, gameVersion);
      const list = byPair.get(key);
      if (list) list.push(release);
      else byPair.set(key, [release]);
    }
  }
  return {
    byPair,
    byModid: new Map(catalog.mods.map((mod) => [mod.modid, mod])),
    gameVersions: [...versions].sort(),
  };
}

/**
 * 某个 mod 在某个游戏版本下的候选（0 / 1 / 2+ 条）。
 *
 * ⚠️ 返回的**数组**是副本（`readonly`）：命中与不命中给的都是新数组，
 *    调用方 `.sort()` / `.push()` 都不会动到索引（`rowsForGameVersion` 就是在这个索引上遍历的）。
 * ⚠️ 但副本是**浅**的：里面的 `ModRelease` **还是目录里那些对象**（只读地看它们没问题，
 *    别去改它们的字段）。要深拷贝就得先说服自己值得那份代价。
 * ⚠️ **候选没有按版本排序**：顺序继承自目录（生成器按 `(modid, version, url)` 的
 *    代码单元序排）。想挑"最新"必须自己带比较器 —— 直接拿 `releases[0]` 当最新，
 *    在 `9.x` vs `10.x`（以及任何进位到两位数的字段）上会挑错。
 */
export function releasesFor(
  index: ModIndex,
  modid: string,
  gameVersion: string,
): readonly ModRelease[] {
  return index.byPair.get(releaseKey(modid, gameVersion))?.slice() ?? [];
}

export function modFor(index: ModIndex, modid: string): ModEntry | null {
  return index.byModid.get(modid) ?? null;
}

/**
 * 某个游戏版本下的全部行（第一部分那张表就是它）。
 * 顺序 = `mods` 的顺序（生成器已按 modid 排好）⇒ 稳定、可断言。
 *
 * ⚠️ 每一行里的 `releases` 同样**没有按版本排序**（理由见 `releasesFor`），
 *    而且类型是 `readonly` —— 调用方要排就排自己的副本。
 */
export function rowsForGameVersion(
  index: ModIndex,
  gameVersion: string,
): readonly { mod: ModEntry; releases: readonly ModRelease[] }[] {
  const rows: { mod: ModEntry; releases: readonly ModRelease[] }[] = [];
  for (const mod of index.byModid.values()) {
    const releases = releasesFor(index, mod.modid, gameVersion);
    if (releases.length > 0) rows.push({ mod, releases });
  }
  return rows;
}

/**
 * 这个 mod 的标签。⚠️ 返回**副本**（`readonly`）：`mod.tags` 是目录对象的字段，
 * 交给调用方的如果是原数组，一次就地 `.sort()` 就会改掉那份目录。
 */
export function modTagsOf(mod: ModEntry): readonly string[] {
  return [...mod.tags];
}

/**
 * 标签的显示名。
 *
 * ⚠️ 查不到时返回 `null`，**不**回退成标签本身：没有名字就是目录的缺陷
 *    （严格校验会在服务端拦住它），界面上显示一个英文 key 正是"看得见的缺陷"。
 */
export function tagLabelOf(catalog: ModCatalog, tag: string): ModTagLabel | null {
  return catalog.tagLabels[tag] ?? null;
}

/** 这个 URL 上有哪些**适用**的镜像（按 `hosts` 匹配）。不是 URL ⇒ 空数组。 */
export function mirrorsFor(catalog: ModCatalog, url: string): ModMirror[] {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return [];
  }
  return catalog.mirrors.filter((mirror) => mirror.hosts.includes(host));
}

/**
 * 镜像地址 = `prefix` + 原 URL（直拼）。
 * 实测过：加速站原样透传字节（`anchiale-3.2.0+1.8.x.jar` 经 gh-proxy.com 取回的 sha512 与官方一致）。
 * ⚠️ 因此**校验一步都不能省**：镜像改了内容只会导致 sha512 对不上（失败），不会写坏文件。
 */
export function mirrorUrl(mirror: ModMirror, url: string): string {
  return `${mirror.prefix}${url}`;
}

// ---------------------------------------------------------------------------
// 判定与文件名
// ---------------------------------------------------------------------------

/**
 * 版本主体 = `+` 之前的那一段。
 *
 * 为什么需要它（**这是承重判据，不是美化**）：实测同一版本号有两种写法 ——
 * 用户机器上 `standardsettings-2.3+1.16.1.jar` 内部写 `2.3+1.16.1`，
 * 而官方那条 release 写 `2.3+1.16-1.16.1`。
 * 若不先剥 `+`，`compareLocalVersions` 会切成
 * `['2','3','1','16','1']` vs `['2','3','1','16','1','16','1']` ⇒ 判成"本地更旧"，
 * 于是一条已经装好的同版本 mod 会被判成"可更新"（并在批量里被替换掉）。
 *
 * ⚠️ 代价（写下来）：`+` 之后的构建元数据被丢掉了，所以"主体相同、元数据不同、字节也不同"
 *    的两个 build 会被归为 `different-build`（保守：不进批量、要人显式点）。
 *    这个失败形态目前**没有现场**（18 个真实 jar 里没出现过）。
 */
export function versionBodyOf(version: string): string {
  const plus = version.indexOf('+');
  return plus === -1 ? version : version.slice(0, plus);
}

/** Windows 上非法的文件名字符 + 控制字符 + **格式控制符**（bidi 覆盖之类，名字要显示给人看）。 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: 控制字符正是**要被排除**的那一类 —— 拿掉 `\u0000-\u001f` 就等于放它们落盘
const BAD_NAME = /[\u0000-\u001f\p{Cf}<>:"|?*\\/]/u;

/** 只收 `.jar`：这是这个模块唯一会写盘的东西。 */
const JAR_SUFFIX = '.jar';

/** NTFS 单组件上限 255 个 UTF-16 单元 ⇒ 超了要在这里给 `null`，而不是让文件系统去报错。 */
const MAX_FILE_NAME_LENGTH = 255;

/**
 * Win32 **连扩展名一起**保留的设备名 —— `NUL.jar` 就是 `NUL`。
 *
 * ⚠️★ 放它们过去，`join(目录, name)` 打开的是设备而不是文件：`NUL` 写入"成功"但字节被丢弃
 *    （调用方若校验的是**下载下来的字节**而不是**落盘的文件**，就会报"已安装"），
 *    `CON`/`COM1`/`LPT1` 打开控制台/串口。这正是上面那句"必须拒绝"要挡的东西。
 * ⚠️ `(\.|$)` 是必需的：`CON` 与 `CON.jar` 都是保留名，而 `CONSOLE.jar` **不是**。
 */
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/**
 * 从下载地址推出落盘的文件名。
 *
 * ⚠️★ URL 里来的名字是**不可信输入**：它会被 `join(dir, name)` 直接拼成写盘路径 ⇒
 *    必须 `decodeURIComponent` **之后**再检查（`%2F` 解出来就是 `/`，而 `pathname` 上
 *    看到的是编码过的形式，很容易漏）。
 * 返回 `null` 表示"这个名字不能用来落盘" ⇒ 调用方必须**拒绝这次更新**，不许退回一个默认名。
 */
export function originFileNameOf(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const last = pathname.split('/').pop() ?? '';
  let decoded: string;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    return null;
  }
  // 防御性的：下面 `.jar` 那一条**已经**拒绝空名（空串不以 `.jar` 结尾），所以这一行不是判据。
  // 留着是因为"空名 / `.` / `..`"正是最容易被顺手补一个默认名的那一处 —— 把契约定在这里看得见。
  if (decoded === '' || decoded === '.' || decoded === '..') return null;
  if (decoded.length > MAX_FILE_NAME_LENGTH) return null;
  if (BAD_NAME.test(decoded)) return null;
  if (!decoded.toLowerCase().endsWith(JAR_SUFFIX)) return null;
  // 退化基名（`.jar` = 空干名、`  .jar` = 只有空白）既是隐藏文件，也会让两条 release 撞同一个
  // 落盘路径 ⇒ 干名必须真的有内容（点与空白都不算内容）。
  const stem = decoded.slice(0, -JAR_SUFFIX.length);
  if (stem.replace(/[.\s]/g, '') === '') return null;
  if (WINDOWS_RESERVED_NAME.test(decoded)) return null;
  return decoded;
}

export type LocalComparison = 'same' | 'different-build' | 'older' | 'newer' | 'unknown';

/** 比较器的一段：**字符全是数字**才算可靠（理由见 `isSortableBody`）。 */
const NUMERIC_SEGMENT = /^[0-9]+$/;

/**
 * 这个版本主体能不能**安全排序**。
 *
 * 判据不是"整串长得像不像版本号"，而是"`compareLocalVersions` 这次会不会走到它那条**不可靠**的路上"：
 * 它按 `[.\-+_]` 分词、逐段比 —— 两段都解析得出数字时走数值比较；**只要有一段的字符不全是数字**，
 * 它就退化成 `localeCompare`（那不是一个能支撑"要不要自动替换"的判据）。
 * ⇒ 于是"每一段都是数字"是"它**不会因为某一段非数字而走那条退化路**"的判据 ——
 *   注意它**不是**"整趟都不碰 `localeCompare`"：段数不等时，比较器用 `pa[i] ?? ''` 补齐，
 *   多出来的那几段落在 `''` vs 数字段上，照样走 `localeCompare`。那一处**无害**：
 *   `''.localeCompare(digits) === -1`，正好就是"短的更旧"这个**正确**结论。
 *   ⚠️ 守卫要防的是"**会给出错误高低**的那条路"（实测 `HD_U_F10` vs `HD_U_F9` ⇒ `-1`，
 *   也就是把更新的本地 jar 换成更旧的上游包），不是"有没有调到 `localeCompare`"
 *   ⇒ 判据钉在"有没有非数字段"上才不多不少。
 *
 * 为什么"整串是 `^[0-9]+(\.[0-9]+)*$`"是**过严**的：`1.16.1-2.6.13`（replaymod 的真实形状）
 * 被它整串拒掉，可分词之后是 `['1','16','1','2','6','13']` —— 每段都是数字、全程数值比较、
 * **排序可靠**。把可靠的形状也拒掉，等于白丢一次自动更新，还会让"为什么不给我更新"没答案。
 *
 * ⚠️ 代价（写下来，**实测、不是零代价**）：带**非数字段**的主体从此不排序、不进批量。
 *    实测（`content/mod-catalog.json`，555 条 release / 1761 个键）两次独立读数一致：
 *    含非数字段的 release **77** 条（auto 23 / manual 54）、去重键 **174** 个（auto 119 / manual 55），
 *    其中落在 1.16.1 且 `download=auto` 的是 **4** 个 mod ——
 *    `custom-map-resetter`（`1.4.1-1.16.x`，那个 `x`）、`krypton`（`0.1.3-SNAPSHOT`）、
 *    `noverworld`（`2.3.2-BASTION`）、`pogworld`（`1.4.0-BIOMES`）：这些行上"本地是另一种打包"
 *    从 `older`（自动）变成 `different-build`（要人点一下）。方向是保守的那一侧（少自动、不降级）。
 *    （`replaymod` 的 `1.16.1-2.6.13` **不在**这 4 个里：按分词它每段都是数字，照常排序。）
 *    而 OptiFine 那种字母版本本来就是 `manual`（见 `needsUpdate`），不受影响。
 */
function isSortableBody(body: string): boolean {
  return body.split(/[.\-+_]/).every((segment) => NUMERIC_SEGMENT.test(segment));
}

/**
 * 本地那份 vs 官方那一条。
 *
 * 判据链（**只有第一层是硬结论**）：
 *   ① `sha512` 相等 ⇒ `same`。与版本号字符串**完全无关** —— 它证的是"你手上这份字节
 *      就是官方发的那一份"。（实测：18 个真实 jar 里 7 个命中，且没有"命中了别的版本"的。）
 *   ② 不相等 ⇒ 比**版本主体**：相等 ⇒ `different-build`；两边主体都 `isSortableBody` 时才敢排先后
 *      —— 更旧 ⇒ `older`、更新 ⇒ `newer`。
 *   ③ 读不出本地版本 ⇒ `unknown`。
 *   其余（含非数字段、或比不出大小）一律 `different-build`。
 */
export function compareLocalToRelease(
  localSha512: string | null,
  localVersion: string | null,
  release: ModRelease,
): LocalComparison {
  // ⚠️ `localSha512 !== null` 是**防御性**的：参数类型允许 null，而 `release.sha512` 必填。
  if (localSha512 !== null && localSha512 === release.sha512) return 'same';
  if (localVersion === null) return 'unknown';
  const local = versionBodyOf(localVersion);
  const target = versionBodyOf(release.version);
  if (local === target) return 'different-build';
  /*
   * ★ 只在**比较器真的不可靠**时才拒绝排序（这一条是承重的，不是保守的美化）。
   *
   * 为什么：`compareLocalVersions` 是 v1 用来比**两个本地副本**的 —— 那种场合"谁在前"只影响
   * 先绑哪一个，用户随时能改；而**这里它决定"是否自动替换"**。它在非数字段上退化成 `localeCompare`，
   * 那就不是一个能支撑自动替换的判据：实测 `compareLocalVersions('HD_U_F10','HD_U_F9') = -1`
   * ⇒ 得出"本地更旧" ⇒ **把更新的本地 jar 换成更旧的上游包**（正是 mcsrranked 那条断言禁止的降级）。
   * ⇒ 有非数字段就一律归 `different-build`（要人显式点，不进批量）；**全数字段照常排序**
   *   （这一点很重要：判据是"比较器可靠不可靠"，不是"字符串像不像版本号"）。
   */
  if (!(isSortableBody(local) && isSortableBody(target))) return 'different-build';
  // 复用 v1 的比较器（返回符号数）。它按数字段逐段比，解析不出数字段时退化成字符串序。
  // ⚠️ 它内部用 localeCompare ⇒ 只用来**定"谁前谁后"**，不用来决定"要不要写盘"（那是 sha512 的活）。
  const cmp = compareLocalVersions(local, target);
  if (cmp === 0) return 'different-build';
  return cmp < 0 ? 'older' : 'newer';
}

export type ReleaseVerdict =
  | { kind: 'same'; release: ModRelease }
  | { kind: 'different-build'; release: ModRelease }
  | { kind: 'older'; release: ModRelease }
  | { kind: 'newer'; release: ModRelease }
  | { kind: 'unknown'; release: ModRelease }
  | { kind: 'ambiguous'; releases: readonly ModRelease[] }
  | { kind: 'missing-release' };

/**
 * 把"本地读数 + 候选"归成一种行状态。
 *
 * ⚠️★ 候选多于一个时**先用本地的 sha512 定案**：实测 `(modid, 游戏版本)` 真有 2 个重复键
 *    （`optifine|1.7.2` → `HD_U_E1`/`HD_U_F7`；`speedrunigt|26.1` → `14.2+26.1.x`/`14.2+26.1`）。
 *    用户手上那一份到底是哪一个，只有字节能回答；答不上来就是 `ambiguous`（**不猜**，
 *    由界面要求人明确选一个，且不进批量）。
 */
export function judgeRelease(
  localSha512: string | null,
  localVersion: string | null,
  candidates: readonly ModRelease[],
): ReleaseVerdict {
  if (candidates.length === 0) return { kind: 'missing-release' };
  if (candidates.length > 1) {
    // ⚠️ `localSha512 !== null` 是**防御性**的（参数类型允许 null）：`ModRelease.sha512` 是必填字段，
    //    所以真正的判据是下面那个 `find`，这一层只表达"没有哈希就没法定案"的意图。
    if (localSha512 !== null) {
      const exact = candidates.find((candidate) => candidate.sha512 === localSha512);
      if (exact) return { kind: 'same', release: exact };
    }
    return { kind: 'ambiguous', releases: [...candidates] };
  }
  const only = candidates[0]!;
  return { kind: compareLocalToRelease(localSha512, localVersion, only), release: only };
}

/**
 * 这一行能不能进**批量**更新。
 *
 * ★ `older` **且** `download === 'auto'` 是进批量的唯一组合。
 *   · `newer`（本地更新）进批量 = 降级；
 *   · `different-build`（同版本号不同字节）与 `ambiguous`（不知道该装哪个）都要人显式点一下
 *     —— 同一版本号的两种打包不该由程序替用户选；
 *   · `manual` 的 release **连"更新按钮"都不给**（spec §8 / schema 的注释：只给"打开原网页"），
 *     当然更不能进批量。实测 555 条里只有 `optifine`/`optifine-light`（54 条）是 `manual`，
 *     而它们的版本**正好是字母方案** —— 也就是上面那条数字段守卫归到 `different-build` 的那一类。
 *   规则收在这一个函数里，调用方不必自己记得过滤 `download`。
 */
export function needsUpdate(verdict: ReleaseVerdict): boolean {
  if (verdict.kind !== 'older') return false;
  return verdict.release.download === 'auto';
}
