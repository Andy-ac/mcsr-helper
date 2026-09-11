/**
 * 全站共享的枚举与常量。
 *
 * ⚠️ STRUCTURE_* 枚举的取值**刻意复用你自有 MCSR Ranked 数据库里已有的取值**
 * （种子表里的 `overworld` / `nether` 字段）。这样等 v1.2 接入自有种子库时，
 * 社区提交的种子与爬取到的种子可以落在同一套 schema 下做统一查询，零迁移成本。
 * 参见 docs/v1-plan.md §3.2。
 */

export const SITE = {
  name: 'MCSR Helper',
  /** 生产环境的规范来源。买好域名后改这里，Electron 与 Caddy 都读它。 */
  productionOrigin: 'https://mcsr-helper.example.com',
  /** 开发环境前端地址。 */
  devServerOrigin: 'http://localhost:5173',
} as const;

/** 资源库条目的类型。 */
export const RESOURCE_KINDS = ['website', 'tool'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/** UGC 审核状态（资源库 / 日历 / 种子分享共用同一条管线）。 */
export const CONTENT_STATUSES = ['draft', 'pending', 'published', 'rejected', 'hidden'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/** 用户角色。只有四个，权限是"角色 × 资源类型"的二维矩阵，不做 per-item ACL。 */
export const USER_ROLES = ['user', 'reviewer', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** 允许嵌入的视频平台。新增平台时必须同步更新 VideoEmbed 组件与 CSP。 */
export const VIDEO_PLATFORMS = ['bilibili', 'youtube', 'twitch'] as const;
export type VideoPlatform = (typeof VIDEO_PLATFORMS)[number];

/** 支持的语言。UI 双语；内容只打标签不翻译。 */
export const LOCALES = ['zh-CN', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** 主世界结构类型（取值对齐自有数据库的 overworld 字段）。 */
export const OVERWORLD_STRUCTURES = [
  'VILLAGE',
  'DESERT_TEMPLE',
  'RUINED_PORTAL',
  'SHIPWRECK',
  'BURIED_TREASURE',
  'PILLAGER_OUTPOST',
  'JUNGLE_TEMPLE',
  'WITCH_HUT',
  'OCEAN_MONUMENT',
  'IGLOO',
  'STRONGHOLD',
] as const;
export type OverworldStructure = (typeof OVERWORLD_STRUCTURES)[number];

/**
 * 下界结构类型（取值对齐自有数据库的 nether 字段，即堡垒类型）。
 *
 * TODO(v1.2)：接入自有数据库时，用 `SELECT DISTINCT nether FROM MatchSeed` / `API_DB_v2`
 * 的实际取值把这个列表补全并核对大小写。目前只覆盖从样本中观察到的取值。
 */
export const NETHER_STRUCTURES = ['BRIDGE', 'HOUSING', 'STABLES', 'TREASURE'] as const;
export type NetherStructure = (typeof NETHER_STRUCTURES)[number];

/** 速通分类。 */
export const SPEEDRUN_CATEGORIES = ['RSG', 'SSG', 'PRACTICE'] as const;
export type SpeedrunCategory = (typeof SPEEDRUN_CATEGORIES)[number];

export const DEFAULT_GAME_VERSION = '1.16.1';

/** 各平台视频 ID 的形状校验（只校验形状，**绝不抓取元数据**）。 */
export const VIDEO_ID_PATTERNS: Record<VideoPlatform, RegExp> = {
  bilibili: /^BV[0-9A-Za-z]{10}$/,
  youtube: /^[A-Za-z0-9_-]{11}$/,
  twitch: /^\d{6,12}$/,
};

/** 从用户粘贴的链接里提取平台与视频 ID —— 这是唯一允许的"解析"，不产生任何网络请求。 */
export function parseVideoUrl(url: string): { platform: VideoPlatform; videoId: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;

  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  const firstSegment = parsed.pathname.split('/').filter(Boolean)[0] ?? '';

  if (host === 'bilibili.com' || host === 'b23.tv' || host.endsWith('.bilibili.com')) {
    const bv = parsed.pathname.match(/BV[0-9A-Za-z]{10}/)?.[0];
    return bv ? { platform: 'bilibili', videoId: bv } : null;
  }
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com') {
    const id = host === 'youtu.be' ? firstSegment : (parsed.searchParams.get('v') ?? firstSegment);
    return id && VIDEO_ID_PATTERNS.youtube.test(id) ? { platform: 'youtube', videoId: id } : null;
  }
  if (host === 'twitch.tv' || host === 'm.twitch.tv') {
    if (firstSegment === 'videos') {
      const id = parsed.pathname.split('/').filter(Boolean)[1] ?? '';
      return VIDEO_ID_PATTERNS.twitch.test(id) ? { platform: 'twitch', videoId: id } : null;
    }
    return null;
  }
  return null;
}
