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
/** 标签数量上限。导出是给界面用的 —— 超过它就该在点之前拦住，而不是提交后才报错。 */
export const TAGS_MAX = 12;

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

/**
 * 评分聚合。
 *
 * ⚠️ **只有平均值和人数是公开的，谁给了几分不公开**。
 *    逐个列出评分人就变成了评论系统 —— 那需要另一套东西
 *    （回复、举报、审核），是另一件事。
 *
 * ⚠️ `average` 为 null 表示**还没有人评过分**，不是 0 分。
 *    界面上这两种情况的显示完全不同（"暂无评分" vs "0.0"）。
 */
export const RatingSummarySchema = z.object({
  /** 平均分，保留一位小数；没人评分时为 null */
  average: z.number().nullable(),
  count: z.number().int().nonnegative(),
});
export type RatingSummary = z.infer<typeof RatingSummarySchema>;

/**
 * 收藏数（⑤）—— **有多少个用户把它加进了收藏**（`resource_marks` 里
 * `favorite = 1` 的行数）。
 *
 * ---------------------------------------------------------------------------
 * 为什么它是一个裸整数，而不是一个像 `RatingSummary` 那样的对象
 * ---------------------------------------------------------------------------
 * `rating` 是对象，因为它要表达**两件事**（平均分 + 人数），而且它有一个
 * **有语义的"空"**：`average: null` = "还没有人评过分"（与"平均 0 分"完全不同）。
 *
 * 收藏数只有一个数字、也只有一个"空"（0 = 还没有人收藏，而 0 分和"没人评"
 * 不会混淆）。包成 `{ count }` 只会让每个读者多一层解构，
 * 并且诱使别人往里加第二个字段 —— 那正是 `rating` 的形状，不是这个的形状。
 *
 * ⚠️ 它是**公开聚合**，与评分同一条隐私规则：**只给总数，不给"谁收藏了"**。
 *    逐个列出收藏人就变成评论/社交功能了，那需要另一套东西（回复、举报、审核）。
 *
 * ⚠️ **必填、不可空**：服务端算不出来时应该失败，而不是给一个 `null` 让前端判空。
 *    这一点与 `rating` 刻意不同，理由见上。
 *
 * ⚠️ 已知且接受的**陈旧窗口**：列表与详情都带 60 秒公共缓存，所以别人的收藏
 *    在你这里最多晚 60 秒才反映出来。评分**今天就是这个行为**（它和收藏数
 *    在同一份响应里），所以这不是新引入的不一致。自己点收藏时界面本地 ±1
 *    做即时反馈，而权威值仍然在服务端。
 */
export const FavoriteCountSchema = z.number().int().nonnegative();

/** 列表项：**不含 body**，避免列表接口把几十 KB 的正文全传下来。 */
export const ResourceListItemSchema = ResourceSchema.omit({ body: true }).extend({
  rating: RatingSummarySchema,
  favoriteCount: FavoriteCountSchema,
});
export type ResourceListItem = z.infer<typeof ResourceListItemSchema>;

/** 详情：完整对象。 */
export const ResourceDetailSchema = ResourceSchema.extend({
  rating: RatingSummarySchema,
  favoriteCount: FavoriteCountSchema,
});
export type ResourceDetail = z.infer<typeof ResourceDetailSchema>;

// ---------------------------------------------------------------------------
// 个人标记：收藏 / 备注 / 评分
// ---------------------------------------------------------------------------

/** 个人备注的长度上限。它只给自己看，所以可以比公开内容宽松一点。 */
export const PERSONAL_NOTE_MAX = 1000;

export const RATING_MIN = 1;
export const RATING_MAX = 5;

/** 我对某条内容的标记。没标记过时三项都是"空"。 */
export const ResourceMarksSchema = z.object({
  favorite: z.boolean(),
  /** 个人备注 —— **只有本人能读到** */
  note: z.string().nullable(),
  /** 1–5；null = 没评过 */
  rating: z.number().int().min(RATING_MIN).max(RATING_MAX).nullable(),
  updatedAt: z.number().int(),
});
export type ResourceMarks = z.infer<typeof ResourceMarksSchema>;

/**
 * 设置标记。
 *
 * ⚠️ 三个字段都是**可选**的，只改传了的那个 —— 和 setResourceFlags 同理：
 *    把"没传"当成 false/null 的话，一次"取消收藏"会把备注和评分一起清掉，
 *    而界面上只表现为"我点了一个按钮"。
 */
export const MarksInputSchema = z.object({
  favorite: z.boolean().optional(),
  note: z.string().trim().max(PERSONAL_NOTE_MAX).nullable().optional(),
  rating: z.number().int().min(RATING_MIN).max(RATING_MAX).nullable().optional(),
});
export type MarksInput = z.infer<typeof MarksInputSchema>;

/** 我的收藏列表里的一项：标记 + 内容摘要（够渲染一张卡片就行）。 */
export const FavoriteItemSchema = z.object({
  id: z.string(),
  kind: z.enum(RESOURCE_KINDS),
  title: z.string(),
  url: z.string(),
  imageUrl: z.string().nullable(),
  summary: z.string().nullable(),
  /** 线上是否可见 —— 被下架的条目仍留在收藏里，但不该点进去 */
  published: z.boolean(),
  marks: ResourceMarksSchema,
});
export type FavoriteItem = z.infer<typeof FavoriteItemSchema>;

/**
 * 「用来编辑的那一份」：详情 + 当前的待审状态。
 *
 * ⚠️ `pendingRevision` 只在编辑接口上返回，**不进公开的详情响应**。
 *    它要回答的是编辑页最先需要知道的那个问题：
 *    **"现在有没有别人已经提了一份修改在等审核？"**
 *
 *    没有它的话，第二个人会把整张表单填完、点提交，然后才拿到 409 ——
 *    而那时他的工作已经白做了。同一条内容被两个人同时改，
 *    唯一正确的做法是**在他动手之前**就告诉他。
 */
export type EditableResource = ResourceDetail & {
  /** 待审的版本号；null = 现在没有人提改动，可以改 */
  pendingRevision: number | null;
};

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

/**
 * 提交时附给审核员的一句话的上限。
 *
 * ⚠️ 它**不是正文**：不存在 resources 行上，永远不会出现在公开页面上。
 *    放得宽一点没意义 —— 它不是用来写内容的，是用来解释"这次改了什么、
 *    哪里我不确定、上次那处改了没有"。超过几百字的话，审核员也不会读。
 *
 * ⚠️ 必须声明在 ResourceSubmissionSchema **之前** —— schema 里要用到它。
 *    （放到后面会得到一个"变量在声明前被使用"的编译错误，看起来像循环依赖，
 *    其实只是顺序。）
 */
export const NOTE_MAX = 500;

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
  /**
   * 给审核员的一句话。可选，不进正文、不上线。
   *
   * 有用的典型场景：这是对已上架条目的修改（说明改了什么）、
   * 上一轮被驳回后重新提交（说明那处怎么改的）、
   * 或者来源存疑让审核员留个心。
   */
  note: z.string().trim().max(NOTE_MAX).nullable().optional(),
});
export type ResourceSubmission = z.infer<typeof ResourceSubmissionSchema>;

// ---------------------------------------------------------------------------
// 图片上传
// ---------------------------------------------------------------------------

/** 单张图片的大小上限。 */
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/**
 * 允许的图片类型。
 *
 * ⚠️ 这个白名单里**没有 SVG**，而且不能加。
 *    SVG 是 XML，可以内嵌 <script>；它一旦被当作图片直接提供出去，
 *    就是一条在我们域名下执行的 XSS。栅格图（png/jpg/webp/gif）没有这个问题。
 *    （服务端还会按**文件头**再验一次，不信客户端说的 content-type。）
 */
export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

/** 上传成功的返回。`url` 是站内绝对路径，直接存进 imageUrl 就行。 */
export const UploadResponseSchema = z.object({
  url: z.string(),
  mime: z.enum(IMAGE_MIME_TYPES),
  size: z.number().int().positive(),
});
export type UploadResponse = z.infer<typeof UploadResponseSchema>;

/**
 * 下架 / 恢复。
 *
 * 用一个布尔 `published` 而不是 `hidden` —— 请求里说的是**想要的结果**
 * （"让它在站上可见"），而不是"给我把那个标志位翻一下"。
 * 后者在重试、并发、或者用户连点两次时会得到相反的结果。
 */
export const ResourceVisibilitySchema = z.object({
  published: z.boolean(),
});
export type ResourceVisibility = z.infer<typeof ResourceVisibilitySchema>;

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

// ---------------------------------------------------------------------------
// 我的提交
// ---------------------------------------------------------------------------

/**
 * 「我的提交」里的一行。
 *
 * ⚠️ 它**不能**复用 ResourceListItem：那个类型只描述**已发布**的内容，
 *    而这里最关键的信息恰恰是未发布的那些状态（待审 / 已驳回）。
 *
 * `lastRejectReason` 是整个管线的闭环：审核员被强制写下的那句"需要改什么"，
 * 唯一的读者就是作者。没有这个字段，写理由就是白写。
 */
export const MySubmissionSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(CONTENT_STATUSES),
  /** 待审的版本号；没有待审内容时为 null */
  pendingRevision: z.number().int().positive().nullable(),
  /** 线上版本号；从未发布过时为 null */
  currentRevision: z.number().int().positive().nullable(),
  updatedAt: z.number().int().nonnegative(),
  /** 最近一次被驳回的理由（没有驳回记录时为 null） */
  lastRejectReason: z.string().nullable(),
  /** 最近一次审核动作的时间（通过或驳回）；还没被审过时为 null */
  reviewedAt: z.number().int().nullable(),
});
export type MySubmission = z.infer<typeof MySubmissionSchema>;

export const MySubmissionsResponseSchema = z.object({
  items: z.array(MySubmissionSchema),
});
export type MySubmissionsResponse = z.infer<typeof MySubmissionsResponseSchema>;
