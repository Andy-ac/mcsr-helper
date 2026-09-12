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
  /**
   * 生产环境的规范来源。Electron、Caddy、邮件正文里的链接都读它。
   *
   * 它是**唯一**的规范域名：`www` 和旧域名都会 301 跳到这里（见 deploy/Caddyfile）。
   * 之所以必须唯一，是因为会话 cookie 是按 host 存的 —— 同一个站点以两个域名
   * 对外时，用户会在一个域名登录、在另一个域名发现自己"掉线了"。
   */
  productionOrigin: 'https://mcsrhelper.com',
  /** 开发环境前端地址。 */
  devServerOrigin: 'http://localhost:5173',
  /**
   * 搬迁前的旧域名，现在只用于 301 跳转。
   *
   * ⚠️ 它（cloud-ip.cc）在 Spamhaus DBL 上被列名为 phishing-related（127.0.1.4）
   *    + botnet C&C（127.0.1.6），2026-09-12 复核确认（带阳性对照）。
   *    **绝不能**用它发信：每封邮件都会盖上"钓鱼/僵尸网络"的标签，
   *    而且用它测出的任何投递失败都**无法归因**（分不清是 ESP 的问题还是域名的问题）。
   *
   *    它仍然可以用作 HTTPS 站点 —— 浏览器不查 DBL，而它在公共后缀列表的
   *    PRIVATE 段，cookie 与其他 cloud-ip.cc 用户互相隔离。
   */
  legacyOrigin: 'https://legacy.example.invalid',
  /**
   * 发信用的子域。SPF / DKIM / DMARC / Return-Path 全都配在它上面，
   * 而不是配在根域上 —— 这样邮件声誉与站点声誉解耦：
   * 万一发信域被判垃圾，站点不受影响。
   */
  mailSubdomain: 'mail.mcsrhelper.com',
} as const;

/** 资源库条目的类型。 */
export const RESOURCE_KINDS = ['website', 'tool'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/** UGC 审核状态（资源库 / 日历 / 种子分享共用同一条管线）。 */
export const CONTENT_STATUSES = ['draft', 'pending', 'published', 'rejected', 'hidden'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/**
 * 用户角色。权限是"角色 × 资源类型"的二维矩阵，不做 per-item ACL。
 *
 * ⚠️ 顺序是**权限从低到高**，不是字母序 —— 界面上展示角色时
 *    （比如后台的角色选择器）读起来才像"权限递增"。
 *    `assignableRoles()` 直接返回这个数组，改这里就够了。
 *
 *   · user      普通用户：提交、编辑自己的、wiki 式编辑已上架内容
 *   · reviewer  审核员：多一组"审核"的能力
 *   · editor    内容编辑：在审核员之上，多出**决定内容以什么姿态出现在站上**
 *               的能力（精选 / 官方 / 下架），以及改任何条目的内容
 *   · admin     管理员：再多一个账号治理（改别人角色、封禁）
 *   · owner     所有者：能力上和管理员完全一样，多出来的是**等级**（见 permissions.ts
 *               的 checkRoleChange）—— 只有他能动管理员的角色，而他自己谁也动不了。
 */
export const USER_ROLES = ['user', 'reviewer', 'editor', 'admin', 'owner'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** 允许嵌入的视频平台。新增平台时必须同步更新 VideoEmbed 组件与 CSP。 */
export const VIDEO_PLATFORMS = ['bilibili', 'youtube', 'twitch'] as const;
export type VideoPlatform = (typeof VIDEO_PLATFORMS)[number];

/** 支持的语言。UI 双语；内容只打标签不翻译。 */
export const LOCALES = ['zh-CN', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * 主世界结构类型 —— **自有数据库 `MatchSeed.overworld` 的真实取值**。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 这个列表原来有 11 项，其中 5 项在 1303 万行真实数据里**一次都没出现**
 * ---------------------------------------------------------------------------
 * 原文挂着一条 TODO 说"取值是从样本里估的、没核对过"。核对完了（见
 * `docs/own-db-facts.md` §2，全表 `GROUP BY`）：真实取值**只有 6 个**。
 *
 * 被删掉的 5 项 —— `PILLAGER_OUTPOST` / `WITCH_HUT` / `OCEAN_MONUMENT` /
 * `IGLOO` / `STRONGHOLD` —— 都是**看起来合理但不存在**的猜测。
 * 它们不是"暂时没有数据"：`MatchSeed.overworld` 只有 `village / desert_temple /
 * shipwreck / ruined_portal / buried_treasure / jungle_temple` 六个值，
 * 而 Ranked 的种子筛选**只围绕这几种结构**，所以那五项永远不会出现。
 *
 * 留着它们的代价不是"多一点选项"，而是：界面会给用户一个选了必然查不到结果的
 * 筛选项，而他会以为是自己操作错了。**一个永远查不出东西的选项比没有这个选项更糟。**
 *
 * ⚠️ `JUNGLE_TEMPLE` 留着，但要知道它只占 **0.08%**（10,175 / 13,038,341）。
 *    它和主力那五个不是一个量级 —— 界面上如果按"常见结构"做排序或预选，
 *    它该排在最后。
 *
 * ⚠️ `overworld` **可以是 NULL**（1.5%），也就是"这个种子没有主世界结构"是一个
 *    **合法状态**，不是缺数据。凡是筛选/展示这个字段的地方都要能表达"无"。
 */
export const OVERWORLD_STRUCTURES = [
  'VILLAGE',
  'DESERT_TEMPLE',
  'RUINED_PORTAL',
  'SHIPWRECK',
  'BURIED_TREASURE',
  'JUNGLE_TEMPLE',
] as const;
export type OverworldStructure = (typeof OVERWORLD_STRUCTURES)[number];

/**
 * 下界结构类型 —— **自有数据库 `MatchSeed.nether` 的真实取值**。
 *
 * ✅ 已核对：全表恰好这 4 个，全大写，各约 300 万行 —— 和这个列表**一字不差**
 *    （见 `docs/own-db-facts.md` §3）。所以它没有像上面那个列表一样被改。
 *
 * ⚠️ 但约 **6%** 的行是 NULL 或空串 —— 和 `overworld` 同理，"没有下界结构"
 *    是一个合法状态。
 */
export const NETHER_STRUCTURES = ['BRIDGE', 'HOUSING', 'STABLES', 'TREASURE'] as const;
export type NetherStructure = (typeof NETHER_STRUCTURES)[number];

/**
 * Ranked Seeds 上游 `/seed` 认的 `overworld` **筛选**取值（**小写**）。
 *
 * ---------------------------------------------------------------------------
 * 它和 OVERWORLD_STRUCTURES 是两份东西，但**不是两份真相**
 * ---------------------------------------------------------------------------
 * 两处不同，而且两处都不是笔误：
 *   · **大小写**：我们对外统一大写，发往上游转小写（实测修正 1）
 *   · **成员**：上游只认 5 个 —— `jungle_temple` **不在**它的筛选词表里，
 *     尽管自有库里真的有 jungle_temple 的比赛（占 0.08%）
 *
 * 为什么不合并成一份：
 *   合并就必须在某一侧做转换，而转换要么发生在"发往上游"那一步
 *   （那就等于上游词表藏在别处，读代码的人看不见它的真实成员），
 *   要么发生在展示层（那界面就会给出一个上游不认的选项 —— 点了必然 400）。
 *
 * 为什么仍然放在同一个文件：**它们是同一件事的两个投影**，放在一起才看得出
 * 谁是谁的子集。子集关系有测试守着（constants.test.ts），所以不会漂移。
 *
 * ⚠️ 上游的词条会变，所以**校验要允许未知值通过**（只限长度和字符集）——
 *    这里列的是"界面可以主动提供的选项"，不是"上游只接受这些"。
 *    这个区别很要紧：把它当白名单用，上游每加一种结构我们就先 400 一段时间。
 */
export const UPSTREAM_OVERWORLD_FILTERS = [
  'village',
  'desert_temple',
  'shipwreck',
  'ruined_portal',
  'buried_treasure',
] as const;
export type UpstreamOverworldFilter = (typeof UPSTREAM_OVERWORLD_FILTERS)[number];

/**
 * Ranked Seeds 上游 `/seed` 认的 `nether` **筛选**取值（小写）。
 * 成员与 `NETHER_STRUCTURES` 完全相同，只差大小写。
 */
export const UPSTREAM_NETHER_FILTERS = ['bridge', 'treasure', 'housing', 'stables'] as const;
export type UpstreamNetherFilter = (typeof UPSTREAM_NETHER_FILTERS)[number];

/** 速通分类。 */
export const SPEEDRUN_CATEGORIES = ['RSG', 'SSG', 'PRACTICE'] as const;
export type SpeedrunCategory = (typeof SPEEDRUN_CATEGORIES)[number];

export const DEFAULT_GAME_VERSION = '1.16.1';

/**
 * 日历事件的标签（用户 Q1：赛事 / 社区活动 / 排位节点**都要**，用标签区分，
 * 并且用户可以自行选择显示或禁用某些标签）。
 *
 * ⚠️ 是**多选**，不是单选。社区自己办的比赛同时就是"社区活动"和"赛事"，
 * 单选会逼录入者在两个都对的答案里挑一个 —— 而无论挑哪个，筛选都会漏掉它。
 */
export const CALENDAR_TAGS = ['TOURNAMENT', 'COMMUNITY', 'RANKED_MILESTONE'] as const;
export type CalendarTag = (typeof CALENDAR_TAGS)[number];

/**
 * 赛事轮次（用户 Q20）。
 *
 * ⚠️ 它**只是一个标签，不做父子层级**。真实数据里两种形态并存：
 *   · `playoffs_s1` 是横跨 7 天的连续窗口（不分轮次）
 *   · `playoffs_s5` 是按轮次拆开的独立时间片（r1 / r2 / qf / sf / 3rd / final）
 * 硬做统一的 bracket 模型，会有一半的真实赛事填不进去。
 */
export const EVENT_STAGES = [
  'QUALIFIER',
  'ROUND',
  'QUARTERFINAL',
  'SEMIFINAL',
  'THIRD_PLACE',
  'FINAL',
] as const;
export type EventStage = (typeof EVENT_STAGES)[number];

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
