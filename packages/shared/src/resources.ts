/**
 * 资源库的数据契约 —— **前后端共用同一份 schema**。
 *
 * 为什么用「共享 Zod schema」而不是「后端导出 OpenAPI、前端代码生成」：
 *
 *   方案文档里原本写的是后者。但对一个前后端**都是 TypeScript、且同一个 monorepo**
 *   的项目来说，直接共享 schema 严格更好：
 *     - 没有代码生成步骤，也就没有"忘记重新生成"导致的类型漂移
 *     - 校验与类型来自同一个定义，不可能不一致
 *     - 改一个字段，前后端同时报错，而不是等运行时才发现
 *
 *   OpenAPI 的价值在于**给非 TS 消费者**提供契约（其他语言、第三方、文档站）。
 *   等到真有这种东西的时候再加 —— 那时它可以由这份 schema 生成，不用重写。
 */
import { z } from 'zod';
import {
  CONTENT_STATUSES,
  type ContentStatus,
  LOCALES,
  type Locale,
  RESOURCE_KINDS,
  type ResourceKind,
} from './constants';

// ---------------------------------------------------------------------------
// 字段约束
// ---------------------------------------------------------------------------

const TITLE_MAX = 120;
const SUMMARY_MAX = 300;
const BODY_MAX = 40_000;
const TAG_MAX_LEN = 32;
const TAGS_MAX = 12;

/**
 * URL 校验。
 *
 * ⚠️ 只允许 http/https。`javascript:` 之类的伪协议必须在这里就被挡住 ——
 * 前端渲染时还会再挡一次，但**服务端是第一道闸**：
 * 一条存进库的 `javascript:` 链接会在每个访问者浏览器里执行。
 */
const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => /^https?:\/\//i.test(v), { message: '只允许 http:// 或 https:// 链接' })
  .refine(
    (v) => {
      try {
        const u = new URL(v);
        return u.protocol === 'http:' || u.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: '不是合法的 URL' },
  );

/**
 * 标签允许：字母（含中文）、数字、下划线、连字符、**点号**。
 *
 * 点号是必须的 —— `1.16.1` 这种版本号在 MCSR 里是最常用的标签之一。
 * 第一版漏了它，导入时直接被校验器挡下来了（这正是把校验写严的价值：
 * 问题在导入时暴露，而不是在数据库里躺了半年）。
 *
 * 仍然禁止空格和斜杠：它们要么在 URL 里需要转义，要么会让标签看起来像路径。
 */
const tag = z
  .string()
  .trim()
  .min(1)
  .max(TAG_MAX_LEN)
  .regex(/^[\p{L}\p{N}_.-]+$/u, { message: '标签只能包含字母、数字、下划线、连字符和点号' });

/**
 * 配图引用。允许两种形式：
 *   · 绝对地址  `https://...`
 *   · 站内路径  `/icons/xxx.png`（**必须**以单个 `/` 开头）
 *
 * 为什么允许站内路径：图标**自托管**在 /icons/ 下，而不是热链对方的 favicon。
 * 热链的问题很实在 —— GitHub 头像走 avatars.githubusercontent.com，
 * 在大陆访问很慢甚至不通；而我们的用户主要就在大陆。
 *
 * ⚠️ 刻意**不允许** `//evil.com/x.png` 这种协议相对写法：
 * 它会被解析成跨域地址，等于绕过了上面那条"站内"的意图。
 * `^\/[^/]` 正好排除了它以双斜杠开头的情况。
 */
const imageRef = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => /^https?:\/\//i.test(v) || /^\/[^/]/.test(v), {
    message: '配图必须是 http(s) 链接，或以单个 / 开头的站内路径',
  });

// ---------------------------------------------------------------------------
// 实体
// ---------------------------------------------------------------------------

/** 资源库条目的完整形态（数据库里的样子）。 */
export const ResourceSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(RESOURCE_KINDS),
  /** 主要标题，用条目主语言写 */
  title: z.string().trim().min(1).max(TITLE_MAX),
  /** 另一种语言的标题，可选 —— 内容不翻译，但标题允许双语以便检索 */
  titleEn: z.string().trim().max(TITLE_MAX).nullable(),
  url: httpUrl,
  /**
   * 卡片配图。**允许为空** —— 为空时前端退回到 <origin>/favicon.ico，
   * 再失败就渲染一个首字母方块。这样新条目零配置就有图，
   * 想指定正式配图的再填（可以填站内路径，把图自托管）。
   */
  imageUrl: imageRef.nullable(),
  /** 列表页用的一句话简介；为空时由 body 推导 */
  summary: z.string().trim().max(SUMMARY_MAX).nullable(),
  /** 详情页的 Markdown 正文，**渲染前必须 sanitize** */
  body: z.string().max(BODY_MAX),
  lang: z.enum(LOCALES),
  /** 子标签：自由填写，用于筛选与聚合 */
  tags: z.array(tag).max(TAGS_MAX),
  /**
   * 主要标签。和 kind 一起构成卡片上的那排徽章。
   *
   * 精选与官方是**两个独立维度**，不是互斥枚举：
   * 一个条目可以既非精选也非官方，也可以"官方但未精选"。
   * 所以用两个布尔，而不是一个 type 字段。
   */
  featured: z.boolean(),
  official: z.boolean(),
  status: z.enum(CONTENT_STATUSES),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type Resource = z.infer<typeof ResourceSchema>;

/** 列表项：**不含 body**，避免列表接口把几十 KB 的正文全传下来。 */
export const ResourceListItemSchema = ResourceSchema.omit({ body: true });
export type ResourceListItem = z.infer<typeof ResourceListItemSchema>;

/** 详情：完整对象。 */
export const ResourceDetailSchema = ResourceSchema;
export type ResourceDetail = z.infer<typeof ResourceDetailSchema>;

// ---------------------------------------------------------------------------
// 查询参数
// ---------------------------------------------------------------------------

export const RESOURCE_PAGE_SIZES = [12, 24, 48] as const;
export const DEFAULT_PAGE_SIZE = 24;

export const ResourceQuerySchema = z.object({
  kind: z.enum(RESOURCE_KINDS).optional(),
  lang: z.enum(LOCALES).optional(),
  tag: z.string().trim().max(TAG_MAX_LEN).optional(),
  /** 全文搜索：匹配标题、双语标题、简介、标签 */
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
});

export type ResourceQuery = z.infer<typeof ResourceQuerySchema>;

export const ResourceListResponseSchema = z.object({
  items: z.array(ResourceListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type ResourceListResponse = z.infer<typeof ResourceListResponseSchema>;

// ---------------------------------------------------------------------------
// 规范化（写入前统一跑一遍，保证库里只有一种形态）
// ---------------------------------------------------------------------------

/**
 * 把用户/导入文件给的字段整理成规范形态。
 *
 * 做四件事：
 *   1. summary 为空时从 body 推导（去掉 Markdown 标记，截断）
 *   2. 标签去重、排序、转小写（保证 `Tools` 和 `tools` 是同一个标签）
 *   3. 空字符串一律转成 null（英文标题、配图 URL）——
 *      库里只应该有一种"没有值"的表示，否则查询和渲染都要判断两次
 *   4. 配图 URL 做一次协议校验
 */
export function normalizeResourceInput(
  // summary / imageUrl 允许**缺省**（导入文件里常常不写），
  // 所以用可选属性，而不是 `string | null`。
  input: Pick<Resource, 'body' | 'tags' | 'titleEn'> & {
    summary?: string | null;
    imageUrl?: string | null;
  },
): { summary: string | null; tags: string[]; titleEn: string | null; imageUrl: string | null } {
  const summary = input.summary?.trim() ? input.summary.trim() : deriveSummary(input.body);

  const tags = [...new Set(input.tags.map((t) => t.trim().toLowerCase()))].sort();

  const rawImage = input.imageUrl?.trim() ?? '';
  // 绝对地址或站内路径都接受；其余（空串、javascript:、协议相对 //）一律丢掉
  const imageUrl = /^https?:\/\//i.test(rawImage) || /^\/[^/]/.test(rawImage) ? rawImage : null;

  return {
    summary: summary.slice(0, SUMMARY_MAX) || null,
    tags,
    titleEn: input.titleEn?.trim() ? input.titleEn.trim() : null,
    imageUrl,
  };
}

/** 从 Markdown 正文里提取一段纯文本摘要。刻意做得笨 —— 它只是列表页的兜底。 */
export function deriveSummary(body: string, max = SUMMARY_MAX): string {
  const text = body
    .replace(/```[\s\S]*?```/g, ' ') // 代码块
    .replace(/`([^`]*)`/g, '$1') // 行内代码
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接保留文字
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // 标题标记
    .replace(/^\s{0,3}>\s?/gm, '') // 引用
    .replace(/^\s{0,3}[-*+]\s+/gm, '') // 列表标记
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export type { ContentStatus, Locale, ResourceKind };

// ---------------------------------------------------------------------------
// 提交与审核（M2 的 UGC 管线）
// ---------------------------------------------------------------------------

/**
 * 版本的审核状态。
 *
 * ⚠️ 三个状态里**没有** "current" —— "哪一版在线上"由 `resources.current_revision`
 *    表示，而不是由版本自己的状态表示。这两个问题必须分开：
 *    一个版本可以在历史上被批准过、现在已经被新版本取代，但它**仍然是已批准**的。
 *    把它们混成一个字段，就会出现"历史版本的状态被后来者改写"这种
 *    没法审计的情况。
 */
export const REVISION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

/**
 * 提交/编辑时报上去的字段。
 *
 * ⚠️ **刻意不含 `featured` / `official` / `status`。**
 *    这三个是"编辑决定"，不是"作者填写的内容"：
 *      · featured / official 是编辑精选与官方标记，用户可以自己标就失去意义了；
 *      · status 是审核结果，由管线推进，不可能让提交者自己写。
 *    把它们排除在输入 schema 之外，而不是"收到了但忽略" ——
 *    后者会让攻击者以为字段生效了，也让读代码的人以为可以传。
 */
export const ResourceSubmissionSchema = z.object({
  kind: z.enum(RESOURCE_KINDS),
  title: z.string().trim().min(1).max(TITLE_MAX),
  titleEn: z.string().trim().max(TITLE_MAX).nullable().optional(),
  url: httpUrl,
  imageUrl: imageRef.nullable().optional(),
  summary: z.string().trim().max(SUMMARY_MAX).nullable().optional(),
  body: z.string().max(BODY_MAX),
  lang: z.enum(LOCALES),
  tags: z.array(tag).max(TAGS_MAX).default([]),
});
export type ResourceSubmission = z.infer<typeof ResourceSubmissionSchema>;

/** 审核驳回时必须给理由 —— 没有理由的驳回等于让作者瞎猜。 */
export const REJECT_REASON_MAX = 500;

export const RejectInputSchema = z.object({
  reason: z.string().trim().min(1, { message: '必须填写驳回理由' }).max(REJECT_REASON_MAX),
});
export type RejectInput = z.infer<typeof RejectInputSchema>;

/** 版本快照（数据库里的样子）。 */
export const ResourceRevisionSchema = z.object({
  id: z.string(),
  resourceId: z.string(),
  revision: z.number().int().positive(),
  /** 内容快照，字段与 ResourceSchema 一致（但不含 id / status / featured / official） */
  kind: z.enum(RESOURCE_KINDS),
  title: z.string(),
  titleEn: z.string().nullable(),
  url: z.string(),
  imageUrl: z.string().nullable(),
  summary: z.string().nullable(),
  body: z.string(),
  lang: z.enum(LOCALES),
  tags: z.array(z.string()),
  status: z.enum(REVISION_STATUSES),
  editorId: z.string().nullable(),
  editorName: z.string().nullable(),
  createdAt: z.number().int(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.number().int().nullable(),
  reviewReason: z.string().nullable(),
});
export type ResourceRevision = z.infer<typeof ResourceRevisionSchema>;

/** 待审队列里的一项。带上作者与资源标题，审核界面就不用再发一次请求。 */
export const ReviewQueueItemSchema = z.object({
  resourceId: z.string(),
  revision: z.number().int().positive(),
  title: z.string(),
  kind: z.enum(RESOURCE_KINDS),
  url: z.string(),
  /** true = 这是对**已发布**条目的修改（线上仍展示旧版）；false = 全新条目 */
  isEdit: z.boolean(),
  authorName: z.string().nullable(),
  createdAt: z.number().int(),
});
export type ReviewQueueItem = z.infer<typeof ReviewQueueItemSchema>;

export const ReviewQueueResponseSchema = z.object({
  items: z.array(ReviewQueueItemSchema),
  total: z.number().int().nonnegative(),
});
export type ReviewQueueResponse = z.infer<typeof ReviewQueueResponseSchema>;
