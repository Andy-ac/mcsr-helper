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
import type { ModCatalog, ModEntry, ModMirror, ModRelease } from '@mcsr/shared/modCatalog';

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
  upstream: Record<string, { provider: 'modrinth'; project: string }>;
  downloadRules: { host: string; mode: 'auto' | 'manual'; reason: string }[];
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
              return [
                modid,
                {
                  provider: 'modrinth' as const,
                  project: str(u.project, `overrides.upstream.${modid}.project`),
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

export function buildCatalog(input: BuildInput): ModCatalog {
  const overrides = readOverrides(input.overrides);
  const sources: { list: 'legal' | 'extra'; path: string; mods: Record<string, unknown>[] }[] = [
    { list: 'legal', path: 'mods.json', mods: modsOf(input.modsRaw, 'mods.json') },
    { list: 'extra', path: 'extra.json', mods: modsOf(input.extraRaw, 'extra.json') },
  ];

  const mods: ModEntry[] = [];
  const releases: ModRelease[] = [];

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
        const at = `${source.path}.mods[${modid}].versions[${index}]`;
        const v = objectAt(rawVersion, at);
        const url = str(v.url, `${at}.url`);
        const host = new URL(url).host;
        const rule = overrides.downloadRules.find((r) => r.host === host);
        releases.push({
          modid,
          version: str(v.version, `${at}.version`),
          url,
          sha1: str(v.sha1, `${at}.sha1`),
          sha512: str(v.sha512, `${at}.sha512`),
          size: typeof v.size === 'number' ? v.size : Number.NaN,
          targetVersions: strArray(v.target_version, `${at}.target_version`)
            .slice()
            .sort(byCodeUnit),
          dependencies: strArray(v.dependencies, `${at}.dependencies`),
          obsolete: bool(v.obsolete, `${at}.obsolete`, false),
          intermediary: strArray(v.intermediary, `${at}.intermediary`),
          download: rule ? rule.mode : overrides.default,
        });
      }
    }
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
