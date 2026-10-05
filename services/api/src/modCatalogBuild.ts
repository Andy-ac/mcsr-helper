/**
 * mod 目录的**纯构建逻辑**：上游快照 + 人工配置 → 目录对象。
 *
 * 为什么它住在 `services/api/src`（而不是 `tools/*.mjs`）：
 *   ① 纯逻辑要被本包的测试直接 import（`tools/` 不在任何 tsconfig 的 include 里，
 *      类型检查与 biome 的覆盖都不一样）；
 *   ② CLI 需要 `tsx`，而 `tsx` 是本包的依赖（根目录没有）；
 *   ③ `content/` 本来就归这个服务读。
 *
 * ⚠️★ 上游字段**不许"顺手兼容"**。实测过：`target_version` / `dependencies` /
 *    `intermediary` 在两份文件里**都是数组**。第一版 spec 曾写下"extra.json 的
 *    target_version 是字符串、生成器要两种都吃"—— 那是 PowerShell `ConvertTo-Json`
 *    把单元素数组拆成标量的假象（spec §3.1 的 ⚠️★）。
 *    ⇒ 所以这里遇到标量**直接报错**，而不是悄悄包成数组：
 *    上游若真改了形状，我们要**看见**它，而不是把一个未核实的假设固化进代码。
 */
import {
  MOD_UPSTREAM_CHANNELS,
  type ModCatalog,
  type ModEntry,
  type ModMirror,
  type ModRelease,
  type ModUpstreamChannel,
} from '@mcsr/shared/modCatalog';

export class ModCatalogBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModCatalogBuildError';
  }
}

export interface BuildInput {
  modsRaw: unknown;
  extraRaw: unknown;
  overrides: unknown;
  sha256: { mods: string; extra: string };
  /**
   * ★ **Modrinth 的版本列表**（键 = project id），来自 `content/upstream/modrinth-versions-<project>.json`
   * （那是 `/v2/project/<project>/version` 响应体的**逐字节**快照）。
   *
   * ⚠️★ **必填、且刻意没有默认值**：给它一个 `{}` 默认值就等于让"快照不在"静默地变成
   *    "这个 mod 没有 release" —— 而那正是 `overrides.modrinthLatest` 要避免的那种沉默
   *    （见那一层上的注释）。缺快照时**抛**（CLI 的 `fail` 会给"先跑 --refresh"）。
   * ⚠️ 键是 **project**、不是 modid：一个 project 可以被多条 modid 引用（今天没有，但形状如此），
   *    而快照文件本身是按 project 存的（一个 project 一次抓取）。
   */
  modrinthVersionsRaw: Record<string, unknown>;
}

const MODS_URL = 'https://meta.mc.sr/schema-7/mods.json';
const EXTRA_URL = 'https://meta.mc.sr/schema-7/extra.json';
/** 生成器认识的 schema 版本。上游换了版本号 ⇒ 我们必须先核实再放行。 */
export const KNOWN_SCHEMA_VERSION = 7;

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ModCatalogBuildError(
      `${path}: 期望一个对象，实际是 ${JSON.stringify(value)?.slice(0, 40)}`,
    );
  }
  return value as Record<string, unknown>;
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string' || value === '')
    throw new ModCatalogBuildError(`${path}: 期望非空字符串`);
  return value;
}

function optionalStr(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return str(value, path);
}

function bool(value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new ModCatalogBuildError(`${path}: 期望布尔`);
  return value;
}

function strArray(value: unknown, path: string, fallback: string[] = []): string[] {
  if (value === undefined || value === null) return fallback;
  if (!Array.isArray(value)) {
    throw new ModCatalogBuildError(
      `${path}: 期望数组，实际是 ${typeof value} —— 上游若真把数组改成了标量，先核实再改这里，别顺手兼容`,
    );
  }
  return value.map((item, index) => str(item, `${path}[${index}]`));
}

/*
 * ★ 哪些上游字段是"**必须有**"的 —— 依据是实测出现率，不是感觉（评审 Important 1）。
 *
 * 量法：对 `content/upstream/` 两份快照逐字段数"有它的记录数 / 总数"（release 级分母 **555**、
 * mod 级分母 **70**；`Object.hasOwnProperty` 判在不在，不是判值真不真）：
 *
 *   release 级（555）：`version` / `url` / `sha1` / `sha512` / `size` / `target_version` /
 *     `intermediary` 都是 **555/555 = 100%**；而 `dependencies` **136/555（24.5%）**、
 *     `obsolete` **1/555（0.2%）**、`recommended` 35/555（6.3%）。
 *   mod 级（70）：`modid` / `name` / `description` / `homepage` 是 70/70；而 `traits` **9/70（12.9%）**、
 *     `incompatibilities` **14/70（20%）**、`obsolete` 1/70（1.4%）、`recommended` 4/70（5.7%）。
 *
 * ⇒ **只有 100% 的那几个**才升级成"必须有"（`str()` 管的四个本来就是硬要求，这里管数组与 `size`）。
 *   ⚠️ `dependencies` 与 release 级的 `obsolete` **不在其中**：它们的"没有"是数据的**常态**
 *   （419/555 条确实没有依赖、554/555 条确实没有 obsolete 标记），继续走 fallback 是**对的** ——
 *   把它们改成"必须有"会让生成器在下一次刷新时对**合法**数据抛错。
 *
 * ⚠️★ 为什么这件事值得两个新函数：缺一个 100% 字段时，旧的 `strArray` fallback 会把
 *   `intermediary` **静默**变成 `[]`，而 catalog 契约（`modCatalog.ts`）**接受空数组**、
 *   没有任何断言钉它 ⇒ `catalog:check` 退出 0、`--write` 照写产物、
 *   **每一道门禁都是绿的，而一个逐 release 的字段已经没了**。
 *   `size` 那边更糟：字符串会被写成 `Number.NaN`，`JSON.stringify` 出 `null`
 *   （违反 catalog 的 `z.number().int().nonnegative()`），而生成器自己从不抛。
 */
function requiredStrArray(value: unknown, path: string): string[] {
  if (value === undefined || value === null) {
    throw new ModCatalogBuildError(
      `${path}: 上游缺了这个字段（实测 555/555 条 release 都有它 ⇒ 这是改名或删字段，不是"可以省略"）`,
    );
  }
  return strArray(value, path);
}

function requiredSize(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ModCatalogBuildError(
      `${path}: 期望非负整数，实际是 ${JSON.stringify(value)?.slice(0, 40)} —— ` +
        `这里**不许**回落成 Number.NaN（NaN 经 JSON.stringify 变成 null，违反 catalog 的 size 契约，` +
        `而生成器自己从不抛 ⇒ 产物坏了却没有人被叫醒）`,
    );
  }
  return value;
}

/**
 * `overrides.upstream.<modid>.channels`（可选）—— 这一条 upstream **接受哪些发布通道**。
 *
 * ⚠️★ **认不出的通道名当场抛**（不是静默丢掉）：一个打错的字（`releases`）会让这一条
 *    upstream 变成"什么都不接受"，而它在界面上的表现正是那句"上游没有匹配的 release" ——
 *    从那里看不出是人工配置打错了字。缺省（没写这个字段）**不是**"什么都不接受"，
 *    而是"只认 release"（= 加这个字段之前的行为，由 `upstreamChannelsOf` 给）。
 * ⚠️ 空数组也抛：它的意图说不清（要"什么都不接受"就别配 `upstream`），
 *    而 `ModUpstreamShape` 那一侧的 `min(1)` 是同一个判据 —— 两处都要拦在各自的入口。
 */
function upstreamChannelsAt(value: unknown, path: string): ModUpstreamChannel[] | undefined {
  if (value === undefined || value === null) return undefined;
  const channels = strArray(value, path).map((item, index) => {
    const known = MOD_UPSTREAM_CHANNELS.find((channel) => channel === item);
    if (known === undefined) {
      throw new ModCatalogBuildError(
        `${path}[${index}]: 认不出这个发布通道 ${JSON.stringify(item)} —— ` +
          `只认 ${MOD_UPSTREAM_CHANNELS.join(' / ')}`,
      );
    }
    return known;
  });
  if (channels.length === 0) {
    throw new ModCatalogBuildError(
      `${path}: 空数组 —— 要么别写这个字段（缺省 = 只认 release），要么至少写一个通道`,
    );
  }
  return channels;
}

function hostOf(url: string, path: string): string {
  try {
    return new URL(url).host;
  } catch {
    // ⚠️ 裸 TypeError 会把**路径**丢掉（CLI 的 catch 只会打一句"生成器自己出错了"），
    //    而 host 正是 download 规则的匹配键 ⇒ 这里必须指名道姓。
    throw new ModCatalogBuildError(`${path}: 不是能解析的 URL（download 规则按它的 host 匹配）`);
  }
}

function modsOf(raw: unknown, path: string): Record<string, unknown>[] {
  const root = objectAt(raw, path);
  const schemaVersion = root.schemaVersion;
  if (schemaVersion !== KNOWN_SCHEMA_VERSION) {
    throw new ModCatalogBuildError(
      `${path}.schemaVersion: 期望 ${String(KNOWN_SCHEMA_VERSION)}，实际 ${JSON.stringify(schemaVersion)} ——` +
        `上游换了 schema 版本，这个生成器必须先核实再放行（字段的含义可能变了）`,
    );
  }
  if (!Array.isArray(root.mods)) throw new ModCatalogBuildError(`${path}.mods: 期望数组`);
  return root.mods.map((mod, index) => objectAt(mod, `${path}.mods[${index}]`));
}

interface Overrides {
  mirrors: ModMirror[];
  tagLabels: Record<string, { zh: string; en: string }>;
  tags: Record<string, string[]>;
  /**
   * `upstream`（人工层）—— 运行期"这个 mod 的最新版本去上游查"。
   *
   * ⚠️★ `channels` **可选**，缺省 = 只认 `release`（= 加这个字段之前的行为）。
   *    `draftout` 是唯一写了它的条目（`["release","beta"]`）：它的最新版只发 beta，
   *    只认 release 会一个版本都匹配不上。逐条的理由与契约写在
   *    `packages/shared/src/modCatalog.ts` 的 `ModUpstreamShape.channels` 上。
   */
  upstream: Record<
    string,
    { provider: 'modrinth'; project: string; channels?: ModUpstreamChannel[] }
  >;
  /**
   * ★★ **手工登记的 mod**（mc.sr 两份清单都不收、而我们要认得的那些）。
   *
   * 为什么需要这一层：目录里的 `mods[]` **只从两份上游快照来**（`mods.json` / `extra.json`），
   * 而"上游不收"与"我们不想认得它"是两件事。今天只有这一条路能把它登记进去，
   * 因为快照是**逐字节的上游响应体**（改了它，`--refresh` 一次就没，而且
   * `source.sha256` 那两格的含义会被弄脏）。
   *
   * 每条**必须**带 `reason`（照 `downloadRules` 的形状）：手工登记是一个**决定**，
   * 下一个人要能读到"为什么上游没有它、为什么没有 release"，而不是自己猜。
   *
   * ⚠️★ 这一层今天**只产出 mod 条目，一条 release 都不产出**（`versions` 不在这里）。
   *    理由与代价都写在 `content/mod-overrides.json` 的 `manualMods.boardraid.reason` 里：
   *    没有稳定产物地址的东西**不许**编一条 release 出来（sha1/sha512 是写盘前的唯一闸门，
   *    编一个等于把闸门拆了）。代价（认）：这样的 mod 在界面上只有"认得它"这一半能力 ——
   *    行会出现（`planFolderView` 只按 `mods[]` 里有没有这个 modid 判"清单外"），
   *    但它是 `missing-release`，没有更新按钮、也不进任何批量。
   */
  manualMods: Record<
    string,
    {
      name: string;
      homepage: string;
      description?: string;
      list: 'legal' | 'extra';
      tags: string[];
      reason: string;
    }
  >;
  downloadRules: { host: string; mode: 'auto' | 'manual'; reason: string }[];
  /**
   * ★★ **这个 mod 的 release 只从 Modrinth 取最新那一条**（2026-10-04 用户钉的判据）。
   *
   * 为什么要有它（而不是靠 `upstream` 那一层）：`upstream` 解的是**运行期**的"目标是谁"
   * （桌面端每次检查去 Modrinth 拉一份版本列表）；这一层解的是**目录里那条 release 本身**
   * —— 用户要的是"目录里 draftout 只有一条 release，就是 Modrinth 上最新那条"。
   * 两层的分工是有意的：目录那条给的是**带 sha512 的官方产物**（离线也有目标），
   * `upstream` 那条保证界面上的"最新"永远不落后于上游。
   *
   * ⚠️★ 三条判据（改这一段之前先读完）：
   *   ① **只取一条**：列在这里的 modid，`releases[]` 里**只有**下面算出来的那一条 ——
   *      上游快照（mc.sr）里那一条会被**丢掉**。不是"两条并存"。
   *   ② **`targetVersions` = 那一条 version 自己的 `game_versions`**，
   *      **不是**项目级的并集（`/v2/project/<id>` 顶层那个字段是**跨版本并集**）。
   *      实测 draftout：项目级是 `["26.1.1","26.3"]`，而最新那条 version（1.17.2）自己只声明
   *      `["26.3"]` ⇒ 这一层给出的必须是 `["26.3"]`。用户明确不接受并集：
   *      并集会让"给 26.1.1 的玩家推一个只支持 26.3 的包"。
   *   ③ **拿不到就什么都不加**：版本列表空 / 快照里没有这个 project ⇒ **0 条 release**
   *      （并且上面那条"丢掉 mc.sr 那一条"照样生效）。**绝不**退回并集、也绝不退回 mc.sr 那条陈旧记录。
   *
   * ⚠️ "最新"的口径 = **按 `date_published` 取最大**（同一时刻再按 `version_number` 定序），
   *    **不依赖**列表返回顺序 —— 上游换一下排序不该改变产物（`--check` 的地基）。
   */
  modrinthLatest: Record<string, { project: string; reason: string }>;
  default: 'auto' | 'manual';
}

function readOverrides(raw: unknown): Overrides {
  const root = objectAt(raw, 'overrides');
  const mode = (value: unknown, path: string): 'auto' | 'manual' => {
    const text = str(value, path);
    if (text !== 'auto' && text !== 'manual')
      throw new ModCatalogBuildError(`${path}: 只能是 auto / manual`);
    return text;
  };
  return {
    mirrors: (root.mirrors === undefined ? [] : (root.mirrors as unknown[])).map(
      (mirror, index) => {
        const m = objectAt(mirror, `overrides.mirrors[${index}]`);
        const prefix = str(m.prefix, `overrides.mirrors[${index}].prefix`);
        if (!prefix.endsWith('/')) {
          throw new ModCatalogBuildError(
            `overrides.mirrors[${index}].prefix 必须以 / 结尾（地址是拼出来的，少一个字符就是坏地址）`,
          );
        }
        return {
          id: str(m.id, `overrides.mirrors[${index}].id`),
          label: str(m.label, `overrides.mirrors[${index}].label`),
          prefix,
          hosts: strArray(m.hosts, `overrides.mirrors[${index}].hosts`),
        };
      },
    ),
    tagLabels:
      root.tagLabels === undefined
        ? {}
        : Object.fromEntries(
            Object.entries(objectAt(root.tagLabels, 'overrides.tagLabels')).map(([tag, label]) => {
              const l = objectAt(label, `overrides.tagLabels.${tag}`);
              return [
                tag,
                {
                  zh: str(l.zh, `overrides.tagLabels.${tag}.zh`),
                  en: str(l.en, `overrides.tagLabels.${tag}.en`),
                },
              ];
            }),
          ),
    tags:
      root.tags === undefined
        ? {}
        : Object.fromEntries(
            Object.entries(objectAt(root.tags, 'overrides.tags')).map(([modid, tags]) => [
              modid,
              strArray(tags, `overrides.tags.${modid}`),
            ]),
          ),
    upstream:
      root.upstream === undefined
        ? {}
        : Object.fromEntries(
            Object.entries(objectAt(root.upstream, 'overrides.upstream')).map(([modid, value]) => {
              const u = objectAt(value, `overrides.upstream.${modid}`);
              if (u.provider !== 'modrinth') {
                throw new ModCatalogBuildError(
                  `overrides.upstream.${modid}.provider: 这一期只认 modrinth`,
                );
              }
              const channels = upstreamChannelsAt(
                u.channels,
                `overrides.upstream.${modid}.channels`,
              );
              return [
                modid,
                {
                  provider: 'modrinth' as const,
                  project: str(u.project, `overrides.upstream.${modid}.project`),
                  /*
                   * ⚠️ 没写 `channels` 就**不让这个键出现在产物里**（与 `manualMods.description`
                   *    同一种写法）：产物是**逐字节**比较的（`--check`），而"这一条没写接受集"
                   *    与"写了一个 `undefined`"在字节上虽然一样（`JSON.stringify` 丢掉它），
                   *    显式地不带它更清楚 —— 读产物的人不必去猜那个键为什么不在。
                   */
                  ...(channels === undefined ? {} : { channels }),
                },
              ];
            }),
          ),
    downloadRules: (root.downloadRules === undefined ? [] : (root.downloadRules as unknown[])).map(
      (rule, index) => {
        const r = objectAt(rule, `overrides.downloadRules[${index}]`);
        return {
          host: str(r.host, `overrides.downloadRules[${index}].host`),
          mode: mode(r.mode, `overrides.downloadRules[${index}].mode`),
          reason: str(r.reason, `overrides.downloadRules[${index}].reason`),
        };
      },
    ),
    manualMods:
      root.manualMods === undefined
        ? {}
        : Object.fromEntries(
            Object.entries(objectAt(root.manualMods, 'overrides.manualMods')).map(
              ([modid, value]) => {
                const m = objectAt(value, `overrides.manualMods.${modid}`);
                if (modid.includes('|')) {
                  throw new ModCatalogBuildError(
                    `overrides.manualMods 的键含 '|'：${modid}（判定层的键会被它弄歧义）`,
                  );
                }
                const list = str(m.list ?? 'extra', `overrides.manualMods.${modid}.list`);
                if (list !== 'legal' && list !== 'extra') {
                  throw new ModCatalogBuildError(
                    `overrides.manualMods.${modid}.list: 只能是 legal / extra`,
                  );
                }
                const description = optionalStr(
                  m.description,
                  `overrides.manualMods.${modid}.description`,
                );
                return [
                  modid,
                  {
                    name: str(m.name, `overrides.manualMods.${modid}.name`),
                    homepage: str(m.homepage, `overrides.manualMods.${modid}.homepage`),
                    ...(description === undefined ? {} : { description }),
                    list,
                    tags: strArray(m.tags, `overrides.manualMods.${modid}.tags`),
                    // ⚠️ 必填、且**不设默认值**：手工登记是一个决定，理由必须写下来（见 Overrides 上那一段）。
                    reason: str(m.reason, `overrides.manualMods.${modid}.reason`),
                  },
                ];
              },
            ),
          ),
    modrinthLatest:
      root.modrinthLatest === undefined
        ? {}
        : Object.fromEntries(
            Object.entries(objectAt(root.modrinthLatest, 'overrides.modrinthLatest')).map(
              ([modid, value]) => {
                const m = objectAt(value, `overrides.modrinthLatest.${modid}`);
                return [
                  modid,
                  {
                    project: str(m.project, `overrides.modrinthLatest.${modid}.project`),
                    // ⚠️ 与 `manualMods.reason` 同一条规矩：必填、不设默认值 —— 这是一个决定，理由要写下来。
                    reason: str(m.reason, `overrides.modrinthLatest.${modid}.reason`),
                  },
                ];
              },
            ),
          ),
    default: mode(root.default ?? 'auto', 'overrides.default'),
  };
}

/**
 * 代码单元序的比较。
 *
 * ⚠️ **故意不用 `localeCompare`**：它的结果与 ICU/区域设置有关，而"同一份输入必须给出
 *    同一份字节"是 `--check` 的地基。`compareLocalVersions`（v1）用 localeCompare 是有理由的
 *    （它比的是两个真实版本号、要给人看），而这里只是**给数组定序**。
 */
function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** 定长小写十六进制（Modrinth 的 `hashes.sha1` / `hashes.sha512` 用）。 */
function hexOf(value: unknown, length: number, path: string): string {
  if (typeof value !== 'string' || value.length !== length || !/^[0-9a-f]+$/.test(value)) {
    throw new ModCatalogBuildError(`${path}: 期望 ${length} 位小写十六进制`);
  }
  return value;
}

/**
 * 从 Modrinth 的**一条 version**里取出这一层真正要用的那几样东西。
 *
 * ⚠️ 上游字段照旧**不许顺手兼容**（与 mc.sr 那两份同一条纪律）：形状不对就抛、带上路径。
 *    这里刻意只取"能落成一条 release"的最小集合 —— 其余的字段（`version_type`、
 *    `status`、`changelog`…）不读也不存：目录只放判定要用的东西。
 */
interface ModrinthVersionFacts {
  version: string;
  datePublished: string;
  /** ★ 这一条 version **自己**声明的游戏版本（不是项目级的并集，见 `Overrides.modrinthLatest`）。 */
  gameVersions: string[];
  url: string;
  sha1: string;
  sha512: string;
  size: number;
}

function modrinthVersionFacts(entry: unknown, at: string): ModrinthVersionFacts {
  const v = objectAt(entry, at);
  const gameVersions = requiredStrArray(v.game_versions, `${at}.game_versions`);
  if (gameVersions.length === 0) {
    throw new ModCatalogBuildError(
      `${at}.game_versions: 空数组 —— 这一版没声明它支持哪个游戏版本 ⇒ 不能拿它当目标（也不许拿项目级并集兜底）`,
    );
  }
  if (!Array.isArray(v.files) || v.files.length === 0) {
    throw new ModCatalogBuildError(`${at}.files: 期望非空数组（没有文件就没有 url / sha512）`);
  }
  const files = v.files.map((file, index) => objectAt(file, `${at}.files[${index}]`));
  // 主文件：Modrinth 用 `primary: true` 标它；没有标记时取第一条（顺序由上游给，可复现）。
  const primary = files.find((file) => file.primary === true) ?? files[0]!;
  const url = str(primary.url, `${at}.files[].url`);
  const hashes = objectAt(primary.hashes, `${at}.files[].hashes`);
  return {
    version: str(v.version_number, `${at}.version_number`),
    datePublished: str(v.date_published, `${at}.date_published`),
    gameVersions,
    url,
    sha1: hexOf(hashes.sha1, 40, `${at}.files[].hashes.sha1`),
    sha512: hexOf(hashes.sha512, 128, `${at}.files[].hashes.sha512`),
    size: requiredSize(primary.size, `${at}.files[].size`),
  };
}

/**
 * 版本列表里**最新那一条**；列表为空 ⇒ `null`（**不是**"没有这个 project"，那是上面那一层判的）。
 *
 * ⚠️★ "最新" = 按 `date_published` 最大（并列时按 `version_number` 的代码单元序），
 *    **不依赖返回顺序** —— 上游换一下排序不该改变产物（`--check` 的地基）。
 * ⚠️ `date_published` 是 ISO-8601 字符串（Modrinth 的格式带小数秒与 `Z`），
 *    同格式下的字符串比较就是时间先后比较；这里不去解析它（多一个 Date 就多一处时区口径）。
 */
function latestModrinthVersion(raw: unknown, project: string): ModrinthVersionFacts | null {
  if (!Array.isArray(raw)) {
    throw new ModCatalogBuildError(
      `modrinth[${project}]: 期望数组（那是 /v2/project/<id>/version 的响应体；快照坏了？）`,
    );
  }
  let best: ModrinthVersionFacts | null = null;
  for (const [index, entry] of raw.entries()) {
    const facts = modrinthVersionFacts(entry, `modrinth[${project}][${index}]`);
    if (best === null) {
      best = facts;
      continue;
    }
    const later =
      facts.datePublished !== best.datePublished
        ? facts.datePublished > best.datePublished
        : byCodeUnit(facts.version, best.version) > 0;
    if (later) best = facts;
  }
  return best;
}

export function buildCatalog(input: BuildInput): ModCatalog {
  const overrides = readOverrides(input.overrides);
  const sources: { list: 'legal' | 'extra'; path: string; mods: Record<string, unknown>[] }[] = [
    { list: 'legal', path: 'mods.json', mods: modsOf(input.modsRaw, 'mods.json') },
    { list: 'extra', path: 'extra.json', mods: modsOf(input.extraRaw, 'extra.json') },
  ];

  const mods: ModEntry[] = [];
  const releases: ModRelease[] = [];
  /*
   * ★★ 这些 modid 的 release **只从 Modrinth 取最新那一条**（见 `Overrides.modrinthLatest`）。
   *    ⇒ mc.sr 快照里给它们的那几条**要丢掉**（判据②：不是"两条并存"）。
   *    用 Set 而不是"在循环里查表"：这一趟要判很多次。
   */
  const modrinthOnly = new Set(Object.keys(overrides.modrinthLatest));

  for (const source of sources) {
    for (const raw of source.mods) {
      const modid = str(raw.modid, `${source.path}.mods[].modid`);
      if (modid.includes('|')) {
        // 判定层用 `modid|游戏版本` 当键（`releaseKey`）⇒ modid 里出现分隔符会让键歧义。
        throw new ModCatalogBuildError(
          `${source.path}.mods[].modid 含 '|'：${modid}（判定层的键会被它弄歧义）`,
        );
      }
      const traits = strArray(raw.traits, `${source.path}.mods[${modid}].traits`);
      const obsolete = bool(raw.obsolete, `${source.path}.mods[${modid}].obsolete`, false);
      const listTags = [source.list, ...traits, ...(obsolete ? ['obsolete'] : [])];
      const adminTags = overrides.tags[modid] ?? [];
      const tags = [...new Set([...listTags, ...adminTags])].sort(byCodeUnit);

      const entry: ModEntry = {
        modid,
        name: str(raw.name, `${source.path}.mods[${modid}].name`),
        list: source.list,
        tags,
        traits,
        obsolete,
        incompatibilities: strArray(
          raw.incompatibilities,
          `${source.path}.mods[${modid}].incompatibilities`,
        ).sort(byCodeUnit),
        upstream: overrides.upstream[modid] ?? null,
      };
      const description = optionalStr(raw.description, `${source.path}.mods[${modid}].description`);
      if (description !== undefined) entry.description = description;
      const homepage = optionalStr(raw.homepage, `${source.path}.mods[${modid}].homepage`);
      if (homepage !== undefined) entry.homepage = homepage;
      mods.push(entry);

      if (!Array.isArray(raw.versions))
        throw new ModCatalogBuildError(`${source.path}.mods[${modid}].versions: 期望数组`);
      for (const [index, rawVersion] of (raw.versions as unknown[]).entries()) {
        // 这个 modid 的 release 由 Modrinth 那一支单独给（见 `modrinthOnly`）⇒ 上游这条丢掉。
        if (modrinthOnly.has(modid)) continue;
        const at = `${source.path}.mods[${modid}].versions[${index}]`;
        const v = objectAt(rawVersion, at);
        const url = str(v.url, `${at}.url`);
        const host = hostOf(url, `${at}.url`);
        const rule = overrides.downloadRules.find((r) => r.host === host);
        releases.push({
          modid,
          version: str(v.version, `${at}.version`),
          url,
          sha1: str(v.sha1, `${at}.sha1`),
          sha512: str(v.sha512, `${at}.sha512`),
          size: requiredSize(v.size, `${at}.size`),
          targetVersions: requiredStrArray(v.target_version, `${at}.target_version`)
            .slice()
            .sort(byCodeUnit),
          dependencies: strArray(v.dependencies, `${at}.dependencies`),
          obsolete: bool(v.obsolete, `${at}.obsolete`, false),
          intermediary: requiredStrArray(v.intermediary, `${at}.intermediary`),
          download: rule ? rule.mode : overrides.default,
        });
      }
    }
  }

  /*
   * ★★ 手工登记的 mod（`overrides.manualMods`）—— **只产出 mod 条目，不产出 release**。
   *
   * 为什么放在上游两趟之后：① 重复 modid 要**当场**点名报错（同一个 modid 出现两次会在
   * `parseModCatalog` 的跨字段检查里变成一句"mods[].modid 重复"，那已经是产物层面的事了 ——
   * 而这里能说清"是人工配置与上游撞了"）；② 标签的合并规则必须与上游那一支**逐字相同**
   * （`list` + 记录里的 tags + `overrides.tags` 那一层人工标签，去重后按代码单元序排），
   * 否则同一个标签在两个来源下的排序会不一样 ⇒ `--check` 的"同一份输入同一份字节"就有了两个答案。
   */
  const upstreamModids = new Set(mods.map((mod) => mod.modid));
  for (const [modid, manual] of Object.entries(overrides.manualMods).sort(([a], [b]) =>
    byCodeUnit(a, b),
  )) {
    if (upstreamModids.has(modid)) {
      throw new ModCatalogBuildError(
        `overrides.manualMods.${modid}: 上游两份清单里已经有这个 modid 了 ⇒ ` +
          `手工登记是"上游不收"时的手段，不是覆盖上游记录的地方（要改上游那条，去改它的字段来源）`,
      );
    }
    const listTags = [manual.list, ...manual.tags];
    const adminTags = overrides.tags[modid] ?? [];
    /*
     * ⚠️ `manual.reason` **不进产物**（那不是"忘了带上"）：`ModEntry` 是**严格**校验的
     *    （`ModEntryStrictSchema`，未知键要红）⇒ 把它放进去整份目录就判不合法。
     *    它住在 `content/mod-overrides.json` 里给人读（与 `downloadRules[].reason` 同一条规矩）。
     */
    const entry: ModEntry = {
      modid,
      name: manual.name,
      list: manual.list,
      tags: [...new Set([...listTags, ...adminTags])].sort(byCodeUnit),
      traits: [],
      obsolete: false,
      incompatibilities: [],
      upstream: overrides.upstream[modid] ?? null,
      homepage: manual.homepage,
    };
    if (manual.description !== undefined) entry.description = manual.description;
    mods.push(entry);
  }

  /*
   * ★★ 「只取 Modrinth 最新那一条」这一支（`overrides.modrinthLatest`）。
   *
   * 三条判据写在 `Overrides.modrinthLatest` 上（只一条 release / targetVersions = 那一条自己的
   * `game_versions` / 拿不到就什么都不加）。这里只补两件实现上的事：
   *
   * ⚠️① **modid 必须真的在 `mods[]` 里**（否则这条 release 会被 `parseModCatalog` 的跨字段检查
   *    判成"releases[] 里的 modid 不在 mods 里" —— 那句话说不清是人工配置打错了字）。
   *    ⇒ 在这里当场抛、带上 `overrides.modrinthLatest.<modid>`。
   * ⚠️② **快照里必须有这个 project**：缺了就是仓库/快照坏了（不是"上游没版本"）⇒ **抛**，
   *    不许静默地少一条 release（那正好是用户不接受的那种沉默）。而"列表是空的"是另一回事
   *    —— 那是上游真的没有版本 ⇒ 0 条 release（判据③）。
   */
  const knownModids = new Set(mods.map((mod) => mod.modid));
  for (const [modid, spec] of Object.entries(overrides.modrinthLatest).sort(([a], [b]) =>
    byCodeUnit(a, b),
  )) {
    if (!knownModids.has(modid)) {
      throw new ModCatalogBuildError(
        `overrides.modrinthLatest.${modid}: mods[] 里没有这个 modid ⇒ 这条 release 没有归属` +
          `（要么 modid 打错了，要么得先用 manualMods 把它登记进来）`,
      );
    }
    const raw = input.modrinthVersionsRaw[spec.project];
    if (raw === undefined) {
      throw new ModCatalogBuildError(
        `modrinth[${spec.project}]: 快照不在（overrides.modrinthLatest.${modid} 引用了它）` +
          ` ⇒ 先跑 --refresh 把 content/upstream/modrinth-versions-${spec.project}.json 抓下来`,
      );
    }
    const latest = latestModrinthVersion(raw, spec.project);
    // 上游真的没有版本 ⇒ **什么都不加**（判据③）。绝不退回项目级并集、也绝不退回 mc.sr 那条。
    if (latest === null) continue;
    const host = hostOf(latest.url, `modrinth[${spec.project}].files[].url`);
    const rule = overrides.downloadRules.find((r) => r.host === host);
    releases.push({
      modid,
      version: latest.version,
      url: latest.url,
      sha1: latest.sha1,
      sha512: latest.sha512,
      size: latest.size,
      /*
       * ★★ **就是这一行承载判据②**：`latest.gameVersions` 是**这一条 version 自己**的
       *    `game_versions`；把它换成"跨所有 version 的并集"（= 项目级那个字段）正是
       *    用户明确不接受的行为（会拿一个只支持 26.3 的包去喂 26.1.1 的玩家）。
       *    `services/api/src/mod-catalog-build.test.ts` 里那条断言就是为了让它红。
       */
      targetVersions: latest.gameVersions.slice().sort(byCodeUnit),
      /*
       * ⚠️ 下面三格 Modrinth **没有对应的数据**，所以是明确的空值，不是"忘了填"：
       *    · `dependencies`：Modrinth 给的是 **project id**（`dependencies[].project_id`），
       *      而这一格在目录里是 **modid** 列表 ⇒ 转不过来（要一张 project→modid 的表，
       *      本期没有）。空数组是"我们没有这个读数"，不是"没有依赖"。
       *    · `intermediary`：那是 mc.sr 的字段（映射命名空间）。实测快照里它有 **6 种**取值
       *      （legacyfabric / ornithemc / …）⇒ 它不是常量，从 `loaders` 反推出来就是**编数据**。
       *      它不被任何产品代码读（只随目录搬运）⇒ 留空。
       *    · `obsolete`：Modrinth 的 `version_type`（release/beta/alpha）不是同一个概念 ⇒ false。
       */
      dependencies: [],
      obsolete: false,
      intermediary: [],
      download: rule ? rule.mode : overrides.default,
    });
  }

  mods.sort((a, b) => byCodeUnit(a.modid, b.modid));
  /*
   * release 的定序：`(modid, version, url)`。
   * 为什么带上 url：`(modid, version)` **不是**唯一键（同 modid 同版本号可以是两条不同范围的记录），
   * 带上 url 才能保证"同一份输入 ⇒ 同一份字节"。
   */
  releases.sort(
    (a, b) =>
      byCodeUnit(a.modid, b.modid) || byCodeUnit(a.version, b.version) || byCodeUnit(a.url, b.url),
  );

  const tagLabels = Object.fromEntries(
    Object.entries(overrides.tagLabels).sort(([a], [b]) => byCodeUnit(a, b)),
  );

  return {
    schema: 2,
    source: {
      urls: { mods: MODS_URL, extra: EXTRA_URL },
      schemaVersion: KNOWN_SCHEMA_VERSION,
      sha256: input.sha256,
    },
    mirrors: overrides.mirrors,
    tagLabels,
    mods,
    releases,
  };
}

/**
 * 确定性的序列化。**整个 `--check` 就建立在它上面**：
 * 同一份输入两次调用必须给出逐字节相同的字符串。
 */
export function catalogBytes(catalog: ModCatalog): string {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}
